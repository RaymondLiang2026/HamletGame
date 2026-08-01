/* =========================================================================
   HAMLET · 王子的复仇 — 横版过关小游戏（增强版）
   纯前端 HTML5 Canvas + JavaScript · 无外部引擎 · Web Audio 合成音效
   特性：阶梯难度 / 合成 BGM & 音效 / 视差分层画面 / 得分系统 / 远程武器
   ========================================================================= */
'use strict';

// ---------- 画布 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960, H = 540;
ctx.imageSmoothingEnabled = false;

// ---------- 物理常量 ----------
const GRAVITY = 0.62;
const MOVE_SPEED = 3.7;
const AIR_ACCEL = 0.5;
const FRICTION = 0.78;
const JUMP_VEL = -13.2;
const MAX_FALL = 16;

// ---------- 状态 ----------
const STATE = { TITLE:'title', PLAY:'play', CLEAR:'clear', WIN:'win', LOSE:'lose' };
let state = STATE.TITLE;
let currentLevel = 0;
let camX = 0, frame = 0;
let shakeT = 0, shakeMag = 0;

// ---------- 得分（跨关累计）----------
let score = 0;
let comboTimer = 0, comboCount = 0;
// 结算分项
let breakdown = { kill:0, rescue:0, boss:0, clear:0, hpBonus:0, timeBonus:0 };

// ---------- 跨关保留能力 ----------
let hasCompanion = false;   // 已救出奥菲莉亚
let hasBow = false;         // 已拾取亡魂之弓（第二关后保留）

// ---------- 输入 ----------
const keys = {};
const KEYMAP = {
  ArrowLeft:'left', KeyA:'left',
  ArrowRight:'right', KeyD:'right',
  ArrowUp:'jump', KeyW:'jump', Space:'jump',
  KeyJ:'atk', KeyK:'atk',
  KeyF:'ranged', KeyZ:'ranged'
};
window.addEventListener('keydown', e=>{
  if (KEYMAP[e.code]){ keys[KEYMAP[e.code]] = true; if(e.code==='Space'||e.code.startsWith('Arrow')) e.preventDefault(); }
});
window.addEventListener('keyup', e=>{ if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });

function bindTouch(id, key){
  const el = document.getElementById(id); if(!el) return;
  const on = e=>{ e.preventDefault(); keys[key]=true; };
  const off = e=>{ e.preventDefault(); keys[key]=false; };
  el.addEventListener('touchstart', on, {passive:false});
  el.addEventListener('touchend', off, {passive:false});
  el.addEventListener('touchcancel', off, {passive:false});
  el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
}
bindTouch('tLeft','left'); bindTouch('tRight','right'); bindTouch('tJump','jump'); bindTouch('tAtk','atk');
if ('ontouchstart' in window) document.getElementById('touch').style.display='block';

// ---------- 工具 ----------
function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
function clamp(v,a,b){ return v<a?a:v>b?b:v; }
function rand(a,b){ return a + Math.random()*(b-a); }
function shake(mag,t){ shakeMag=Math.max(shakeMag,mag); shakeT=Math.max(shakeT,t); }

// ---------- 特效：粒子 / 浮字 / 烟花 ----------
let floaters = [], particles = [], fireworks = [];
function addFloater(x,y,text,color,size){ floaters.push({x,y,text,color,size:size||14,life:56}); }
function burst(x,y,color,n=8,spd=3){
  for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2; particles.push({x,y,vx:Math.cos(a)*rand(1,spd),vy:Math.sin(a)*rand(1,spd)-1,life:rand(20,44),color,size:rand(2,4),g:0.18}); }
}
function spark(x,y,dir,color){ // 攻击火花（定向）
  for(let i=0;i<10;i++){ const a=(dir>0?0:Math.PI)+rand(-0.9,0.9); const s=rand(2,6); particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(12,26),color,size:rand(2,4),g:0.1}); }
}
function ripple(x,y){ particles.push({x,y,vx:0,vy:0,life:34,color:'rgba(200,235,255,0.8)',size:2,g:0,ripple:2}); }
function launchFirework(x,y){
  const colors=['#e8c25a','#e23b3b','#7fd4ee','#8ee88e','#ff9bd0','#fff'];
  const c=colors[(Math.random()*colors.length)|0];
  for(let i=0;i<26;i++){ const a=Math.PI*2*i/26; const s=rand(2.4,4.2); fireworks.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(34,52),color:c,size:rand(2,3.5)}); }
}

// =========================================================================
//  音频引擎（Web Audio API 纯代码合成，无外部音频文件）
// =========================================================================
const Sound = {
  ctx:null, master:null, musicGain:null, sfxGain:null,
  enabled:true, started:false,
  // BGM 调度
  seq:null, bass:null, tempo:0.28, wave:'square', bassWave:'triangle',
  step:0, nextTime:0, timer:null, curName:null,

  init(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled=false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.20; this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.5; this.sfxGain.connect(this.master);
  },
  unlock(){ this.init(); if (this.ctx && this.ctx.state==='suspended') this.ctx.resume(); this.started=true; },

  // 单音（SFX）
  blip(freq, dur, type='square', vol=0.4, when=0, slideTo=null){
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1,slideTo), t+dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t+dur+0.02);
  },
  noise(dur, vol=0.3, when=0){
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const n = Math.floor(this.ctx.sampleRate*dur);
    const buf = this.ctx.createBuffer(1,n,this.ctx.sampleRate); const d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    const src=this.ctx.createBufferSource(); src.buffer=buf;
    const g=this.ctx.createGain(); g.gain.value=vol;
    const f=this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=800;
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t);
  },

  // SFX 事件
  jump(){ this.blip(320,0.16,'square',0.35,0,620); },
  hit(){ this.blip(180,0.08,'square',0.4,0,90); this.noise(0.06,0.25); },
  rangedFire(){ this.blip(720,0.12,'sawtooth',0.28,0,240); },
  hurt(){ this.blip(200,0.25,'sawtooth',0.4,0,70); },
  pickup(){ [0,1,2,3].forEach((i)=>this.blip([523,659,784,1047][i],0.12,'triangle',0.4,i*0.08)); },
  bossHit(){ this.blip(120,0.12,'square',0.45,0,60); this.noise(0.08,0.3); },
  clear(){ [523,659,784,1047,1319].forEach((f,i)=>this.blip(f,0.18,'square',0.4,i*0.11)); },
  lose(){ [392,330,262,196].forEach((f,i)=>this.blip(f,0.34,'sawtooth',0.4,i*0.18)); },
  rescue(){ [659,784,988,1319,1047,1319].forEach((f,i)=>this.blip(f,0.22,'triangle',0.42,i*0.13)); },

  // 背景音乐（音调序列循环）
  setMusic(name){
    if (this.curName===name && this.timer) return;
    this.curName = name; this.step = 0;
    const M = MUSIC[name] || MUSIC.castle;
    this.seq = M.seq; this.bass = M.bass; this.tempo = M.tempo; this.wave = M.wave; this.bassWave = M.bassWave||'triangle';
    if (!this.ctx || !this.enabled){ return; }
    this.nextTime = this.ctx.currentTime + 0.05;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(()=>this.schedule(), 25);
  },
  schedule(){
    if (!this.ctx || !this.enabled) return;
    while (this.nextTime < this.ctx.currentTime + 0.18){
      const n = this.seq[this.step % this.seq.length];
      const dur = this.tempo * (n.d||1);
      if (n.f){
        const o=this.ctx.createOscillator(); const g=this.ctx.createGain();
        o.type=this.wave; o.frequency.setValueAtTime(n.f, this.nextTime);
        g.gain.setValueAtTime(0.0001,this.nextTime);
        g.gain.exponentialRampToValueAtTime(0.5,this.nextTime+0.02);
        g.gain.exponentialRampToValueAtTime(0.0001,this.nextTime+dur*0.9);
        o.connect(g); g.connect(this.musicGain); o.start(this.nextTime); o.stop(this.nextTime+dur);
      }
      // 低音
      if (this.bass){
        const bn = this.bass[this.step % this.bass.length];
        if (bn){
          const bo=this.ctx.createOscillator(); const bg=this.ctx.createGain();
          bo.type=this.bassWave; bo.frequency.setValueAtTime(bn, this.nextTime);
          bg.gain.setValueAtTime(0.0001,this.nextTime);
          bg.gain.exponentialRampToValueAtTime(0.35,this.nextTime+0.02);
          bg.gain.exponentialRampToValueAtTime(0.0001,this.nextTime+dur*0.95);
          bo.connect(bg); bg.connect(this.musicGain); bo.start(this.nextTime); bo.stop(this.nextTime+dur);
        }
      }
      this.nextTime += dur; this.step++;
    }
  },
  stopMusic(){ if (this.timer){ clearInterval(this.timer); this.timer=null; } this.curName=null; },
  toggle(){ this.enabled=!this.enabled; if(!this.enabled){ this.stopMusic(); } return this.enabled; }
};

// 音乐主题（频率序列，d=时值倍数，f 缺省为休止）
const N = { C4:262,D4:294,E4:330,F4:349,G4:392,A4:440,B4:494,C5:523,D5:587,E5:659,F5:698,G5:784,A5:880,
            C3:131,D3:147,E3:165,F3:175,G3:196,A3:220,B3:247,C2:65,G2:98,A2:110,E2:82,F2:87 };
const MUSIC = {
  // 城堡：庄重的小调进行曲
  castle:{ tempo:0.30, wave:'square', bassWave:'triangle',
    seq:[{f:N.A4,d:1},{f:N.C5,d:1},{f:N.E5,d:1},{f:N.C5,d:1},{f:N.B4,d:1},{f:N.G4,d:1},{f:N.A4,d:2},
         {f:N.F4,d:1},{f:N.A4,d:1},{f:N.C5,d:1},{f:N.A4,d:1},{f:N.G4,d:1},{f:N.E4,d:1},{f:N.F4,d:2}],
    bass:[N.A2,0,N.E2,0,N.F2,0,N.C3,0,N.D3,0,N.G2,0,N.A2,0] },
  // 墓地：阴森缓慢
  graveyard:{ tempo:0.36, wave:'triangle', bassWave:'sine',
    seq:[{f:N.E4,d:2},{f:N.G4,d:1},{f:N.F4,d:1},{f:N.E4,d:2},{f:N.D4,d:2},
         {f:N.C4,d:2},{f:N.E4,d:1},{f:N.G4,d:1},{f:N.A4,d:2},{f:0,d:2}],
    bass:[N.E2,0,0,0,N.C2,0,0,0,N.A2,0,0,0,N.G2,0,0,0] },
  // 湖边：柔和忧伤
  lake:{ tempo:0.32, wave:'sine', bassWave:'sine',
    seq:[{f:N.G4,d:1},{f:N.A4,d:1},{f:N.B4,d:2},{f:N.A4,d:1},{f:N.G4,d:1},{f:N.E4,d:2},
         {f:N.D4,d:1},{f:N.E4,d:1},{f:N.G4,d:2},{f:N.A4,d:2}],
    bass:[N.G2,0,N.D3,0,N.E2,0,N.C3,0,N.G2,0,N.A2,0] },
  // 宫廷/Boss：紧张急促
  court:{ tempo:0.20, wave:'sawtooth', bassWave:'square',
    seq:[{f:N.A4,d:1},{f:N.A4,d:1},{f:N.C5,d:1},{f:N.A4,d:1},{f:N.E5,d:1},{f:N.A4,d:1},{f:N.F5,d:1},{f:N.E5,d:1},
         {f:N.D5,d:1},{f:N.C5,d:1},{f:N.B4,d:1},{f:N.A4,d:1},{f:N.G4,d:1},{f:N.A4,d:2}],
    bass:[N.A2,N.A2,N.A2,N.A2,N.F2,N.F2,N.G2,N.G2,N.E2,N.E2,N.A2,N.A2] }
};

// =========================================================================
//  关卡数据（含阶梯难度 tune / 音乐主题 / 第二关道具）
// =========================================================================
const GROUND_Y = 480;

// 主题调色板（更精心的色调）
const THEMES = {
  castle:   { sky1:'#3a2a3f', sky2:'#170f1c', far:'#2a2030', mid:'#3a2c3a', ground:'#4a3a3f', groundTop:'#6b5040', accent:'#e8c25a', warm:true,  deco:'torch',  fog:'rgba(232,180,90,0.05)' },
  graveyard:{ sky1:'#12203a', sky2:'#050a16', far:'#101a2e', mid:'#182238', ground:'#242a34', groundTop:'#39435a', accent:'#9fc4e0', warm:false, deco:'tomb',   fog:'rgba(150,180,220,0.06)' },
  lake:     { sky1:'#0e3242', sky2:'#04141c', far:'#0e2e34', mid:'#12403c', ground:'#204236', groundTop:'#367a54', accent:'#7fd4ee', warm:false, deco:'reed',   fog:'rgba(120,210,180,0.05)' },
  court:    { sky1:'#3a1220', sky2:'#0e0308', far:'#2a0e18', mid:'#3a1622', ground:'#3a2028', groundTop:'#6b333d', accent:'#e23b3b', warm:true,  deco:'banner', fog:'rgba(226,60,60,0.06)' }
};

function makeGround(segments){
  return segments.map(([x,w])=>({ x, y:GROUND_Y, w, h:H-GROUND_Y, type:'ground' }));
}

const LEVELS = [
  // ---------------- 第一幕：城堡（几乎无压力）----------------
  {
    theme:'castle', music:'castle', act:'第一幕', name:'艾尔西诺城堡', sub:'鬼魂的召唤',
    width:3000, spawn:{x:60,y:380},
    tune:{ hpMul:1.0, spdMul:0.72, dmgMul:0.5, aggro:170 },
    quote:'先王的鬼魂显现于城墙，道出被弑真相。',
    ground: makeGround([[0,900],[980,760],[1820,1180]]),
    platforms:[ {x:560,y:392,w:140,h:20},{x:1500,y:360,w:130,h:20},{x:1360,y:300,w:110,h:20},{x:2200,y:380,w:150,h:20} ],
    enemies:[ {type:'guard',x:520},{type:'guard',x:1120},{type:'guard',x:1600},{type:'guard',x:2100},{type:'guard',x:2600} ],
    goal:2880
  },
  // ---------------- 第二幕：墓地（引入远程道具，难度上升）----------------
  {
    theme:'graveyard', music:'graveyard', act:'第二幕', name:'教堂墓地', sub:'掘墓人与骷髅',
    width:3500, spawn:{x:60,y:380},
    tune:{ hpMul:1.0, spdMul:0.95, dmgMul:0.8, aggro:250 },
    quote:'"生存还是毁灭" —— 哈姆雷特在墓穴间徘徊。此处可拾取【亡魂之弓】，解锁远程攻击（F/Z）。',
    ground: makeGround([[0,680],[760,560],[1400,560],[2040,900],[3020,480]]),
    platforms:[ {x:660,y:380,w:110,h:20},{x:1240,y:340,w:120,h:20},{x:1540,y:300,w:110,h:20},{x:1820,y:360,w:120,h:20},{x:2360,y:360,w:130,h:20},{x:2620,y:290,w:120,h:20},{x:2880,y:360,w:120,h:20} ],
    // 道具：亡魂之弓，放在第一处平台上方，玩家很早就能拿到
    item:{ x:700, y:GROUND_Y-96, w:26, h:34, kind:'bow' },
    enemies:[ {type:'skeleton',x:430},{type:'guard',x:900},{type:'skeleton',x:1300},{type:'skeleton',x:1600},{type:'skeleton',x:2120},{type:'guard',x:2260},{type:'skeleton',x:2560},{type:'skeleton',x:2760},{type:'guard',x:3120} ],
    goal:3340
  },
  // ---------------- 彩蛋幕：湖边 救奥菲莉亚 ----------------
  {
    theme:'lake', music:'lake', act:'彩蛋幕', name:'柳树湖畔', sub:'拯救奥菲莉亚',
    width:2700, spawn:{x:60,y:380}, isRescue:true, timeLimit:48,
    tune:{ hpMul:1.1, spdMul:1.05, dmgMul:0.85, aggro:280 },
    quote:'奥菲莉亚坠入湖中！在她沉没前击退敌人、赶到她身边。',
    ground: makeGround([[0,540],[620,380],[1100,380],[1580,320],[2020,680]]),
    platforms:[ {x:540,y:380,w:90,h:20},{x:1020,y:360,w:90,h:20},{x:1500,y:360,w:90,h:20},{x:1940,y:340,w:100,h:20} ],
    water:true,
    enemies:[ {type:'guard',x:360},{type:'skeleton',x:780},{type:'skeleton',x:1220},{type:'guard',x:1720},{type:'skeleton',x:2080},{type:'guard',x:2300} ],
    rescue:{ x:2500, y:GROUND_Y-70 }, goal:2500
  },
  // ---------------- 终幕：宫廷 Boss克劳迪奥 ----------------
  {
    theme:'court', music:'court', act:'终幕', name:'王座大厅', sub:'弑君者克劳迪奥',
    width:1900, spawn:{x:60,y:380},
    tune:{ hpMul:1.15, spdMul:1.1, dmgMul:0.95, aggro:320 },
    quote:'"毒剑与毒酒" —— 与篡位的叔父克劳迪奥做最后的了断。',
    ground: makeGround([[0,1900]]),
    platforms:[ {x:360,y:360,w:120,h:20},{x:800,y:320,w:120,h:20},{x:1240,y:360,w:120,h:20} ],
    enemies:[ {type:'guard',x:520},{type:'guard',x:940} ],
    boss:{ x:1560, y:GROUND_Y-96 }, goal:null
  }
];

// =========================================================================
//  世界 / 实体
// =========================================================================
let level, player, enemies=[], projectiles=[], arrows=[], companion=null;
let rescueObj=null, boss=null, itemObj=null;
let timeLeft=0, goalX=null, levelKills=0;

const BOW = { ammoMax:8, cd:22, regen:105, arrowSpeed:9.2, range:430, dmgEnemy:2, dmgBoss:1 };

function makePlayer(spawn){
  return { x:spawn.x, y:spawn.y, w:28, h:40, vx:0, vy:0, onGround:false, facing:1,
    hp:120, maxHp:120, attacking:0, atkCd:0, invuln:0, dead:false, walkT:0,
    ammo:hasBow?BOW.ammoMax:0, ammoMax:BOW.ammoMax, rangedCd:0, regenT:0 };
}

const ENEMY_BASE = {
  guard:   { w:30, h:42, hp:2, speed:1.25, dmg:16, jump:false },
  skeleton:{ w:28, h:40, hp:2, speed:2.0,  dmg:12, jump:true }
};
function makeEnemy(e, tune){
  const b = ENEMY_BASE[e.type] || ENEMY_BASE.guard;
  const hp = Math.max(1, Math.round(b.hp * tune.hpMul));
  return { type:e.type, x:e.x, y:0, w:b.w, h:b.h, vx:0, vy:0, onGround:false, dir:-1,
    alive:true, hurt:0, walkT:0, home:e.x,
    hp, maxHp:hp, speed:b.speed*tune.spdMul, dmg:Math.round(b.dmg*tune.dmgMul), aggro:tune.aggro, canJump:b.jump };
}
function makeBoss(b){
  return { x:b.x, y:b.y, w:52, h:96, vx:0, vy:0, onGround:false, dir:-1,
    hp:26, maxHp:26, alive:true, hurt:0, phase:1, phaseScored:false, state:'idle',
    timer:80, chargeT:0, dead:false, walkT:0, invuln:0 };
}
function makeCompanion(x,y){ return { x, y, w:24, h:38, vx:0, vy:0, onGround:false, facing:1, hp:70, maxHp:70, atkCd:0, walkT:0, hurt:0, mode:'follow' }; }

function loadLevel(idx){
  level = LEVELS[idx];
  const tune = level.tune;
  player = makePlayer(level.spawn);
  enemies = level.enemies.map(e=>makeEnemy(e, tune));
  projectiles = []; arrows = [];
  boss = level.boss ? makeBoss(level.boss) : null;
  goalX = level.goal;
  rescueObj = level.rescue ? {x:level.rescue.x, y:level.rescue.y, w:26, h:34, saved:false, sink:0} : null;
  itemObj = (level.item && !hasBow) ? {x:level.item.x, y:level.item.y, w:level.item.w, h:level.item.h, kind:level.item.kind, taken:false, bob:0} : null;
  timeLeft = level.timeLimit ? level.timeLimit*60 : 0;
  levelKills = 0; camX = 0; frame = 0;
  floaters=[]; particles=[]; fireworks=[];
  companion = hasCompanion ? makeCompanion(player.x-40, player.y) : null;
  document.getElementById('ophRow').style.display = companion ? 'block' : 'none';
  document.getElementById('ammoRow').style.display = hasBow ? 'block' : 'none';
  Sound.setMusic(level.music);
  updateHUD();
  showLevelName(level.act+' · '+level.name, level.sub);
}

// ---------- 碰撞 / 移动 ----------
function solids(){ return level.ground.concat(level.platforms); }
function moveEntity(ent){
  ent.x += ent.vx;
  for (const s of solids()){
    if (rectsOverlap(ent, s)){
      if (ent.vx>0) ent.x = s.x - ent.w; else if (ent.vx<0) ent.x = s.x + s.w;
      ent.vx = 0;
    }
  }
  ent.vy = clamp(ent.vy + GRAVITY, -999, MAX_FALL);
  ent.y += ent.vy; ent.onGround=false;
  for (const s of solids()){
    if (rectsOverlap(ent, s)){
      if (ent.vy>0){ ent.y=s.y-ent.h; ent.vy=0; ent.onGround=true; }
      else if (ent.vy<0){ ent.y=s.y+s.h; ent.vy=0; }
    }
  }
  ent.x = clamp(ent.x, 0, level.width - ent.w);
}
function fellOut(ent){ return ent.y > H + 40; }

// =========================================================================
//  得分系统
// =========================================================================
function addScore(pts, x, y, cat){
  score += pts;
  if (cat && breakdown[cat]!=null) breakdown[cat]+=pts;
  if (x!=null) addFloater(x, y, '+'+pts, '#e8c25a', 16);
  const el = document.getElementById('scoreVal');
  el.textContent = score;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function registerKillCombo(){
  if (comboTimer>0) comboCount++; else comboCount=1;
  comboTimer = 150;
  const cel = document.getElementById('combo');
  if (comboCount>=2){ cel.textContent = 'COMBO ×'+comboCount; } else cel.textContent='';
}
function comboMult(){ return 1 + Math.max(0, comboCount-1)*0.25; }

// =========================================================================
//  更新：主角（近战 + 远程）
// =========================================================================
let prevJump=false, prevRanged=false;

function damagePlayer(dmg, fromX){
  if (player.invuln>0 || player.dead) return;
  player.hp -= dmg; player.invuln = 64;
  player.vx = (player.x < fromX ? -1:1) * -5; player.vy = -5;
  shake(6,10); Sound.hurt();
  addFloater(player.x+player.w/2, player.y-6, '-'+dmg, '#ff6b6b');
  burst(player.x+player.w/2, player.y+player.h/2, '#e23b3b', 8);
  comboTimer=0; comboCount=0; document.getElementById('combo').textContent='';
  if (player.hp<=0){ player.hp=0; player.dead=true; killPlayer('"其余的，只是沉默。" 哈姆雷特倒下了。'); }
  updateHUD();
}
function killPlayer(text){
  Sound.lose(); Sound.stopMusic();
  document.getElementById('loseTitle').textContent='殒 命';
  document.getElementById('loseText').textContent = text || '哈姆雷特倒下了。';
  document.getElementById('loseScore').textContent = '本局得分：'+score;
  burst(player.x+player.w/2, player.y+player.h/2, '#e23b3b', 20, 5);
  setState(STATE.LOSE);
}

function fireArrow(){
  const f = player.facing;
  arrows.push({ x: player.x + (f>0?player.w:0), y: player.y+16, vx: f*BOW.arrowSpeed, w:20, h:6,
                dist:0, from:'player', facing:f });
  player.ammo--; player.rangedCd = BOW.cd; player.regenT = 0;
  Sound.rangedFire();
  spark(player.x + (f>0?player.w:0), player.y+18, f, '#b98bff');
}

function updatePlayer(){
  if (player.dead) return;
  const acc = player.onGround ? 1 : AIR_ACCEL/MOVE_SPEED;
  if (keys.left){ player.vx -= MOVE_SPEED*acc*0.5; player.facing=-1; }
  if (keys.right){ player.vx += MOVE_SPEED*acc*0.5; player.facing=1; }
  player.vx = clamp(player.vx, -MOVE_SPEED, MOVE_SPEED);
  if (!keys.left && !keys.right && player.onGround) player.vx *= FRICTION;

  if (keys.jump && !prevJump && player.onGround){ player.vy=JUMP_VEL; Sound.jump(); burst(player.x+player.w/2, player.y+player.h,'#d8cfe0',5,2); }
  prevJump = keys.jump;

  // 近战
  if (player.atkCd>0) player.atkCd--;
  if (keys.atk && player.atkCd<=0){ player.attacking=12; player.atkCd=20; }
  if (player.attacking>0) player.attacking--;

  // 远程（拾取后）
  if (player.rangedCd>0) player.rangedCd--;
  if (hasBow){
    player.regenT++;
    if (player.regenT>=BOW.regen && player.ammo<player.ammoMax){ player.ammo++; player.regenT=0; }
    if (keys.ranged && !prevRanged && player.rangedCd<=0 && player.ammo>0) fireArrow();
  }
  prevRanged = keys.ranged;

  moveEntity(player);
  if (player.onGround && Math.abs(player.vx)>0.5) player.walkT += 0.28; else if(!player.onGround) player.walkT=0.5; else player.walkT=0;
  if (player.invuln>0) player.invuln--;

  if (fellOut(player)){
    if (level.water) killPlayer('哈姆雷特坠入湖中，随奥菲莉亚沉没……');
    else killPlayer('哈姆雷特跌入深渊。');
    return;
  }

  // 近战判定
  if (player.attacking>6){
    const range=36, ah=30;
    const ax = player.facing>0 ? player.x+player.w : player.x-range;
    const box = {x:ax, y:player.y+4, w:range, h:ah};
    let struck=false;
    for (const en of enemies){ if (en.alive && en.hurt<=0 && rectsOverlap(box,en)){ hitEnemy(en,1); struck=true; } }
    if (boss && boss.alive && boss.hurt<=0 && boss.invuln<=0 && rectsOverlap(box,boss)){ hitBoss(1); struck=true; }
    if (struck) spark(ax+(player.facing>0?range:0), player.y+18, player.facing, '#ffe08a');
  }

  // 拾取道具
  if (itemObj && !itemObj.taken && rectsOverlap(player, itemObj)){
    itemObj.taken = true; hasBow = true;
    player.ammo = player.ammoMax;
    document.getElementById('ammoRow').style.display='block';
    Sound.pickup();
    burst(itemObj.x+itemObj.w/2, itemObj.y+itemObj.h/2, '#b98bff', 24, 5);
    addFloater(itemObj.x, itemObj.y-14, '获得【亡魂之弓】! 按 F/Z 远程攻击', '#b98bff', 15);
    addScore(150, itemObj.x, itemObj.y-30, 'kill');
    shake(4,10);
  }
  updateHUD();
}

function hitEnemy(en, dmg){
  en.hp -= dmg; en.hurt=16;
  en.vx = (en.x<player.x?-1:1)*5; en.vy=-3;
  Sound.hit();
  burst(en.x+en.w/2, en.y+en.h/2, en.type==='skeleton'?'#e6ecf5':'#d8b45a', 8);
  if (en.hp<=0){
    en.alive=false; levelKills++;
    registerKillCombo();
    const base = en.type==='skeleton'?120:100;
    const pts = Math.round(base * comboMult());
    addScore(pts, en.x+en.w/2, en.y-4, 'kill');
    burst(en.x+en.w/2, en.y+en.h/2, '#8b1a1a', 14, 4);
    // 敌人偶尔掉落弹药
    if (hasBow && player.ammo<player.ammoMax && Math.random()<0.4){ player.ammo++; addFloater(en.x+en.w/2, en.y-22,'+1 箭','#b98bff',12); }
    shake(3,6);
  } else {
    addFloater(en.x+en.w/2, en.y-4, '-'+dmg, '#ffd36b');
  }
}

// =========================================================================
//  更新：敌人 / Boss / 弹射物 / 箭矢 / 随从 / 救援
// =========================================================================
function updateEnemies(){
  for (const en of enemies){
    if (!en.alive) continue;
    if (en.hurt>0) en.hurt--;
    const dist = (player.x+player.w/2)-(en.x+en.w/2), ad=Math.abs(dist);
    if (ad < en.aggro){ en.dir = dist>0?1:-1; en.vx = en.dir*en.speed; }
    else { if (en.x<en.home-70) en.dir=1; else if (en.x>en.home+70) en.dir=-1; en.vx = en.dir*en.speed*0.6; }
    if (en.canJump && en.onGround && ad<en.aggro && Math.random()<0.02) en.vy=-9;
    moveEntity(en);
    if (Math.abs(en.vx)>0.3) en.walkT += 0.2;
    if (fellOut(en)) en.alive=false;
    if (en.alive && rectsOverlap(player,en)) damagePlayer(en.dmg, en.x+en.w/2);
  }
}

function hitBoss(dmg){
  boss.hp -= dmg; boss.hurt=12; boss.invuln=8;
  Sound.bossHit();
  burst(boss.x+boss.w/2, boss.y+30, '#e23b3b', 10);
  addFloater(boss.x+boss.w/2, boss.y-6, '-'+dmg, '#ffd36b');
  shake(4,8);
  if (boss.hp<=boss.maxHp*0.5 && !boss.phaseScored){ boss.phaseScored=true; addScore(500, boss.x+boss.w/2, boss.y-20, 'boss'); addFloater(boss.x+boss.w/2, boss.y-40,'第一阶段击破!','#e8c25a',15); }
  if (boss.hp<=0){
    boss.hp=0; boss.alive=false; boss.dead=true;
    addScore(1000, boss.x+boss.w/2, boss.y-20, 'boss');
    burst(boss.x+boss.w/2, boss.y+40, '#e23b3b', 30, 6); shake(10,30);
    winGame();
  }
  updateHUD();
}
function updateBoss(){
  if (!boss || !boss.alive) return;
  if (boss.hurt>0) boss.hurt--; if (boss.invuln>0) boss.invuln--;
  boss.phase = boss.hp<=boss.maxHp*0.5 ? 2 : 1;
  const dist=(player.x+player.w/2)-(boss.x+boss.w/2); boss.dir=dist>0?1:-1; boss.timer--;
  if (boss.state==='idle'){
    boss.vx = boss.dir*(boss.phase===2?1.5:1.0);
    if (boss.timer<=0){ if (Math.random()<0.5){ boss.state='throw'; boss.timer=28; } else { boss.state='charge'; boss.chargeT=0; boss.timer=(boss.phase===2?60:80); } }
  } else if (boss.state==='throw'){
    boss.vx=0;
    if (boss.timer===14){ const n=boss.phase===2?2:1; for(let i=0;i<n;i++) projectiles.push({x:boss.x+boss.w/2,y:boss.y+30,vx:boss.dir*(5+i*1.5),vy:-3-i,w:16,h:16,from:'boss',life:180}); Sound.blip(160,0.14,'sawtooth',0.3,0,90); shake(3,6); }
    if (boss.timer<=0){ boss.state='idle'; boss.timer=rand(60,110); }
  } else if (boss.state==='charge'){
    boss.vx = boss.dir*(boss.phase===2?6.5:5.2); boss.chargeT++;
    if (boss.timer<=0){ boss.state='idle'; boss.timer=rand(70,120); }
  }
  moveEntity(boss);
  if (Math.abs(boss.vx)>0.5) boss.walkT += 0.15;
  if (rectsOverlap(player,boss)) damagePlayer(boss.state==='charge'?20:15, boss.x+boss.w/2);
}

function updateProjectiles(){
  for (const p of projectiles){
    p.vy += GRAVITY*0.4; p.x+=p.vx; p.y+=p.vy; p.life--;
    for (const s of solids()){ if (rectsOverlap(p,s)){ p.life=0; burst(p.x,p.y,'#6fbf4f',6); } }
    if (p.from==='boss' && rectsOverlap(p,player)){ p.life=0; damagePlayer(14,p.x); burst(p.x,p.y,'#6fbf4f',8); }
  }
  projectiles = projectiles.filter(p=>p.life>0 && p.y<H+60 && p.x>-40 && p.x<level.width+40);
}

// 箭矢（射程限制）
function updateArrows(){
  for (const a of arrows){
    a.x += a.vx; a.dist += Math.abs(a.vx);
    let done=false;
    for (const s of solids()){ if (rectsOverlap(a,s)){ done=true; break; } }
    if (!done){
      for (const en of enemies){ if (en.alive && en.hurt<=0 && rectsOverlap(a,en)){ hitEnemy(en, BOW.dmgEnemy); done=true; break; } }
    }
    if (!done && boss && boss.alive && boss.hurt<=0 && boss.invuln<=0 && rectsOverlap(a,boss)){ hitBoss(BOW.dmgBoss); done=true; }
    // 射程到达 → 消散（体现"打不到远处"）
    if (a.dist >= BOW.range){ done=true; burst(a.x, a.y, 'rgba(185,139,255,0.7)', 6, 2); }
    if (done) a.dead=true;
    // 飞行拖尾
    if (frame%2===0) particles.push({x:a.x, y:a.y, vx:0, vy:0, life:10, color:'rgba(185,139,255,0.6)', size:2, g:0});
  }
  arrows = arrows.filter(a=>!a.dead && a.x>-30 && a.x<level.width+30);
}

function updateCompanion(){
  if (!companion) return; const c=companion;
  if (c.hp<=0) c.mode='down';
  const targetX = player.x - (player.facing>0? 46 : -46);
  const dx = targetX - c.x;
  if (Math.abs(dx)>8){ c.vx = clamp(dx*0.12,-3.4,3.4); c.facing = dx>0?1:-1; } else c.vx*=0.6;
  if (c.onGround && (player.y < c.y-30) && Math.abs(dx)<80) c.vy = JUMP_VEL*0.9;
  moveEntity(c);
  if (Math.abs(c.vx)>0.4) c.walkT += 0.2;
  if (fellOut(c)){ c.x=player.x-40; c.y=player.y-60; c.vy=0; }
  if (c.hurt>0) c.hurt--;
  if (c.mode==='down'){ updateHUD(); return; }
  if (c.atkCd>0) c.atkCd--;
  if (c.atkCd<=0){
    let best=null,bd=140;
    for (const en of enemies){ if(en.alive){ const d=Math.abs(en.x-c.x); if(d<bd){bd=d;best=en;} } }
    if (best && best.hurt<=0){ c.atkCd=40; c.facing=best.x>c.x?1:-1; hitEnemy(best,1); addFloater(c.x+c.w/2,c.y-4,'助攻!','#7fd4ee',12); }
    else if (boss && boss.alive && Math.abs(boss.x-c.x)<160 && boss.hurt<=0){ c.atkCd=50; hitBoss(1); addFloater(c.x+c.w/2,c.y-4,'助攻!','#7fd4ee',12); }
  }
  for (const en of enemies){ if(en.alive && rectsOverlap(c,en) && c.hurt<=0){ c.hp-=8; c.hurt=40; burst(c.x+c.w/2,c.y+10,'#7fd4ee',6);} }
  updateHUD();
}

function updateRescue(){
  if (!rescueObj) return; const r=rescueObj; r.sink+=0.15;
  if (!r.saved){
    if (frame%12===0) ripple(r.x, GROUND_Y+18);
    timeLeft--;
    if (timeLeft<=0){ killPlayer('时间耗尽 —— 奥菲莉亚沉入湖底，随水流去。'); return; }
  }
  if (!r.saved && Math.abs((player.x+player.w/2)-r.x)<48 && Math.abs(player.y-r.y)<84){
    r.saved=true; hasCompanion=true;
    companion = makeCompanion(player.x-30, player.y);
    document.getElementById('ophRow').style.display='block';
    Sound.rescue();
    // 剩余时间转化为奖励分
    const tb = Math.ceil(timeLeft/60)*30;
    addScore(1500, r.x, r.y-20, 'rescue');
    if (tb>0){ addScore(tb, r.x, r.y-44, 'timeBonus'); addFloater(r.x, r.y-64, '时间奖励!', '#7fd4ee', 14); }
    for(let i=0;i<3;i++) launchFirework(W/2+rand(-140,140), rand(110,230));
    addFloater(r.x, r.y-20, '获救！奥菲莉亚加入', '#7fd4ee', 16);
    shake(5,12);
    setTimeout(()=>{ if(state===STATE.PLAY) levelComplete(); }, 1000);
  }
  updateHUD();
}

function updateFX(){
  if (comboTimer>0){ comboTimer--; if (comboTimer<=0){ comboCount=0; document.getElementById('combo').textContent=''; } }
  for (const f of floaters){ f.y-=0.6; f.life--; }
  floaters = floaters.filter(f=>f.life>0);
  for (const p of particles){ if(p.ripple){ p.ripple+=0.9; } else { p.vy += (p.g||0.18); p.x+=p.vx; p.y+=p.vy; } p.life--; }
  particles = particles.filter(p=>p.life>0);
  for (const fw of fireworks){ fw.vy+=0.06; fw.x+=fw.vx; fw.y+=fw.vy; fw.vx*=0.97; fw.life--; }
  fireworks = fireworks.filter(f=>f.life>0);
  if (itemObj && !itemObj.taken) itemObj.bob += 0.08;
  if (shakeT>0){ shakeT--; if(shakeT<=0) shakeMag=0; }
}

// =========================================================================
//  流程控制 / HUD / 结算
// =========================================================================
function setState(s){
  state = s;
  document.getElementById('hud').classList.toggle('hidden', s!==STATE.PLAY);
  document.getElementById('scorePanel').classList.toggle('hidden', s!==STATE.PLAY);
  document.getElementById('muteBtn').classList.toggle('hidden', s===STATE.TITLE);
  document.getElementById('titleScreen').classList.toggle('hidden', s!==STATE.TITLE);
  document.getElementById('levelClearScreen').classList.toggle('hidden', s!==STATE.CLEAR);
  document.getElementById('winScreen').classList.toggle('hidden', s!==STATE.WIN);
  document.getElementById('loseScreen').classList.toggle('hidden', s!==STATE.LOSE);
}
function showLevelName(main, sub){
  const el=document.getElementById('levelName');
  el.innerHTML = main+'<small>'+sub+'</small>'; el.classList.add('fade');
  setTimeout(()=>el.classList.remove('fade'), 1900);
}
function updateHUD(){
  document.getElementById('playerHp').style.width = (player.hp/player.maxHp*100)+'%';
  document.getElementById('levelLabel').textContent = level.act+' · '+level.name;
  document.getElementById('scoreVal').textContent = score;
  if (companion) document.getElementById('ophHp').style.width = Math.max(0,companion.hp/companion.maxHp*100)+'%';
  if (hasBow){
    document.getElementById('ammoVal').textContent = player.ammo;
    document.getElementById('ammoMax').textContent = player.ammoMax;
    document.getElementById('ammoCd').textContent = player.rangedCd>0 ? '（冷却…）' : (player.ammo<=0?'（补充中…）':'');
  }
  const tr=document.getElementById('timerRow');
  if (level.isRescue && rescueObj && !rescueObj.saved){ tr.style.display='block'; document.getElementById('timer').textContent=Math.ceil(timeLeft/60); }
  else tr.style.display='none';
}

function scoreTableHTML(rows, total){
  let h='';
  for (const [k,v] of rows){ if (v>0) h+='<div class="row"><span>'+k+'</span><span>+'+v+'</span></div>'; }
  h+='<div class="row total"><span>总分</span><span>'+total+'</span></div>';
  return h;
}

function levelComplete(){
  Sound.clear();
  // 过关奖励：基础通关 + 剩余血量
  const clearBonus = 300;
  const hpBonus = Math.round(player.hp*4);
  addScore(clearBonus, null,null,'clear');
  addScore(hpBonus, null,null,'hpBonus');
  if (currentLevel >= LEVELS.length-1){ winGame(); return; }
  const next = LEVELS[currentLevel+1];
  document.getElementById('clearText').textContent = '下一幕：'+next.act+' · '+next.name+'（'+next.sub+'）';
  document.getElementById('clearScore').innerHTML = scoreTableHTML([
    ['通关奖励', clearBonus], ['剩余血量奖励', hpBonus]
  ], score);
  setState(STATE.CLEAR);
}
function winGame(){
  Sound.clear(); Sound.stopMusic();
  document.getElementById('winQuote').textContent = boss && boss.dead
    ? '克劳迪奥伏诛，先王沉冤得雪。哈姆雷特与获救的奥菲莉亚并肩而立 —— 这一次，故事有了不同的结局。'
    : '复仇已成，奥菲莉亚获救。';
  document.getElementById('winScore').innerHTML = scoreTableHTML([
    ['击败敌人', breakdown.kill], ['拯救奥菲莉亚', breakdown.rescue], ['Boss 战', breakdown.boss],
    ['通关奖励', breakdown.clear], ['血量奖励', breakdown.hpBonus], ['时间奖励', breakdown.timeBonus]
  ], score);
  for(let i=0;i<6;i++) setTimeout(()=>launchFirework(rand(200,760), rand(120,260)), i*220);
  setState(STATE.WIN);
}
function nextLevel(){ currentLevel++; loadLevel(currentLevel); setState(STATE.PLAY); }
function startGame(){
  currentLevel=0; score=0; comboCount=0; comboTimer=0;
  hasCompanion=false; hasBow=false;
  breakdown={kill:0,rescue:0,boss:0,clear:0,hpBonus:0,timeBonus:0};
  loadLevel(0); setState(STATE.PLAY);
}
function restartLevel(){ loadLevel(currentLevel); setState(STATE.PLAY); }

function updateCamera(){ camX = clamp(player.x+player.w/2-W/2, 0, Math.max(0, level.width-W)); }
function checkGoal(){ if (goalX!=null && player.x+player.w/2>=goalX) levelComplete(); }

function update(){
  frame++;
  if (state!==STATE.PLAY) return;
  updatePlayer();
  if (state!==STATE.PLAY) return;
  updateEnemies();
  updateBoss();
  updateProjectiles();
  updateArrows();
  updateCompanion();
  if (level.isRescue) updateRescue(); else checkGoal();
  updateCamera();
  updateFX();
}

// =========================================================================
//  渲染
// =========================================================================
function px(x){ return Math.round(x - camX + (shakeT>0?rand(-shakeMag,shakeMag):0)); }
function py(y){ return Math.round(y + (shakeT>0?rand(-shakeMag,shakeMag):0)); }
function box(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(px(x),py(y),Math.ceil(w),Math.ceil(h)); }
function boxS(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h)); } // 屏幕坐标（视差）

function drawBackground(){
  const t = THEMES[level.theme];
  const g = ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,t.sky1); g.addColorStop(1,t.sky2);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // 天体
  ctx.save(); ctx.globalAlpha=0.92;
  const moonX = 770 - camX*0.06, moonY=88;
  if (t.warm){ // 城堡/宫廷：暖色月/烛光晕
    const rg=ctx.createRadialGradient(moonX,moonY,4,moonX,moonY,60); rg.addColorStop(0,'#ffe9b0'); rg.addColorStop(1,'rgba(255,200,90,0)');
    ctx.fillStyle=rg; ctx.fillRect(moonX-70,moonY-70,140,140);
    ctx.fillStyle='#ffe6a0'; ctx.beginPath(); ctx.arc(moonX,moonY,30,0,Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle='#eef3fb'; ctx.beginPath(); ctx.arc(moonX,moonY,34,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=t.sky1; ctx.globalAlpha=0.5; ctx.beginPath(); ctx.arc(moonX+13,moonY-6,29,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // 星星（冷色主题）
  if (!t.warm){ ctx.fillStyle='rgba(255,255,255,0.55)'; for(let i=0;i<60;i++){ const sx=((i*137 - camX*0.05)%W+W)%W, sy=(i*47)%190; ctx.fillRect(sx,sy,2,2); } }

  // 远景层（0.2x）
  ctx.fillStyle=t.far;
  for(let i=-1;i<12;i++){ const bx=((i*260 - camX*0.2)%(W+260)+(W+260))%(W+260)-130;
    if (level.theme==='castle'||level.theme==='court'){ ctx.fillRect(bx,150,120,H); ctx.beginPath(); ctx.moveTo(bx,150); ctx.lineTo(bx+60,110); ctx.lineTo(bx+120,150); ctx.fill(); }
    else if (level.theme==='graveyard'){ ctx.beginPath(); ctx.moveTo(bx-30,H); ctx.lineTo(bx+90,230); ctx.lineTo(bx+210,H); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(bx-40,H); ctx.lineTo(bx+80,260); ctx.lineTo(bx+200,H); ctx.fill(); }
  }
  // 中景层（0.5x）
  ctx.fillStyle=t.mid;
  for(let i=-1;i<10;i++){ const bx=((i*340 - camX*0.5)%(W+340)+(W+340))%(W+340)-170;
    if (level.theme==='castle'||level.theme==='court'){ ctx.fillRect(bx,250,150,H); for(let w=0;w<3;w++) ctx.fillRect(bx+20+w*45,235,26,20); }
    else if (level.theme==='graveyard'){ ctx.fillRect(bx,320,110,H); }
    else { ctx.beginPath(); ctx.moveTo(bx,H); ctx.lineTo(bx+100,320); ctx.lineTo(bx+200,H); ctx.fill(); }
  }
  // 氛围雾
  ctx.fillStyle=t.fog; ctx.fillRect(0,H*0.45,W,H*0.55);
}

function drawTerrain(){
  const t = THEMES[level.theme];
  for (const s of level.ground){
    box(s.x, s.y, s.w, s.h, t.ground);
    box(s.x, s.y, s.w, 8, t.groundTop);
    // 砖墙 / 泥土纹理
    ctx.save(); ctx.beginPath(); ctx.rect(px(s.x),py(s.y),s.w,s.h); ctx.clip();
    if (level.theme==='castle'||level.theme==='court'){
      ctx.strokeStyle='rgba(0,0,0,0.22)'; ctx.lineWidth=1;
      for(let ry=s.y+16; ry<s.y+s.h; ry+=18){ ctx.beginPath(); ctx.moveTo(px(s.x),py(ry)); ctx.lineTo(px(s.x+s.w),py(ry)); ctx.stroke(); }
      let row=0; for(let ry=s.y+16; ry<s.y+s.h; ry+=18){ const off=(row%2)*30; for(let rx=s.x-off; rx<s.x+s.w; rx+=60){ ctx.beginPath(); ctx.moveTo(px(rx),py(ry)); ctx.lineTo(px(rx),py(ry+18)); ctx.stroke(); } row++; }
      // 高光砖
      ctx.fillStyle='rgba(255,220,150,0.05)'; for(let rx=s.x; rx<s.x+s.w; rx+=120) ctx.fillRect(px(rx),py(s.y+8),40,10);
    } else {
      ctx.fillStyle='rgba(0,0,0,0.2)'; for(let gx=s.x; gx<s.x+s.w; gx+=34) ctx.fillRect(px(gx),py(s.y+8),2,s.h-8);
      ctx.fillStyle='rgba(255,255,255,0.04)'; for(let gx=s.x+12; gx<s.x+s.w; gx+=48) ctx.fillRect(px(gx),py(s.y+8),16,3);
    }
    ctx.restore();
  }
  for (const p of level.platforms){ box(p.x,p.y,p.w,p.h,t.groundTop); box(p.x,p.y+p.h,p.w,4,'rgba(0,0,0,0.32)'); box(p.x,p.y,p.w,2,'rgba(255,255,255,0.12)'); }

  // 湖水
  if (level.water){
    const drawWater=(wx,ww)=>{ ctx.fillStyle='rgba(70,160,200,0.5)'; ctx.fillRect(px(wx),py(GROUND_Y+14),ww,H);
      ctx.fillStyle='rgba(210,240,255,0.35)'; for(let x=wx;x<wx+ww;x+=22) ctx.fillRect(px(x+((frame/6)%22)),py(GROUND_Y+16+Math.sin((x+frame)/18)*2),11,2); };
    for (let i=0;i<level.ground.length-1;i++){ const a=level.ground[i],b=level.ground[i+1]; drawWater(a.x+a.w, b.x-(a.x+a.w)); }
    const last=level.ground[level.ground.length-1]; drawWater(last.x+last.w, level.width-(last.x+last.w)+200);
  }
  drawDecor();
}

function drawDecor(){
  const t=THEMES[level.theme];
  if (t.deco==='torch'){
    for(let x=200;x<level.width;x+=340){
      box(x,300,8,64,'#4a3320');
      const fy=298+Math.sin((frame+x)/6)*3;
      const rg=ctx.createRadialGradient(px(x+4),py(fy-8),2,px(x+4),py(fy-8),40); rg.addColorStop(0,'rgba(255,200,90,0.35)'); rg.addColorStop(1,'rgba(255,200,90,0)');
      ctx.fillStyle=rg; ctx.fillRect(px(x-36),py(fy-48),80,80);
      box(x-4,fy-14,16,16,'#ff9b2e'); box(x-2,fy-22,12,12,'#ffd36b'); box(x+1,fy-28,6,8,'#fff0c0');
    }
  } else if (t.deco==='tomb'){
    for(let x=140;x<level.width;x+=230){ const th=40+((x*7)%30);
      box(x,GROUND_Y-th,26,th,'#4a4f45'); box(x-4,GROUND_Y-th,34,10,'#5c6154');
      ctx.fillStyle='#33372c'; ctx.fillRect(px(x+6),py(GROUND_Y-th+14),14,4); ctx.fillRect(px(x+11),py(GROUND_Y-th+10),4,14); }
    for(let x=320;x<level.width;x+=520){ box(x,GROUND_Y-130,14,130,'#241f16'); box(x-32,GROUND_Y-120,42,10,'#241f16'); box(x+14,GROUND_Y-108,38,10,'#241f16'); box(x-52,GROUND_Y-112,30,8,'#241f16'); }
    // 幽绿雾气
    ctx.fillStyle='rgba(120,180,140,0.05)'; for(let x=100;x<level.width;x+=200) ctx.fillRect(px(x+Math.sin(frame/40+x)*10),py(GROUND_Y-30),120,30);
  } else if (t.deco==='reed'){
    box(200,GROUND_Y-170,20,170,'#3a2f1e');
    ctx.strokeStyle='rgba(90,160,100,0.55)'; ctx.lineWidth=2;
    for(let i=0;i<16;i++){ const bx=130+i*12; ctx.beginPath(); ctx.moveTo(px(bx),py(GROUND_Y-170)); ctx.lineTo(px(bx+Math.sin((frame+i*30)/30)*6),py(GROUND_Y-56)); ctx.stroke(); }
    for(let x=60;x<level.width;x+=64){ const sway=Math.sin((frame+x)/24)*4; ctx.strokeStyle='#3f6b4a'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(px(x),py(GROUND_Y)); ctx.lineTo(px(x+sway),py(GROUND_Y-44)); ctx.stroke(); }
  } else if (t.deco==='banner'){
    ctx.fillStyle='#7a1420'; ctx.fillRect(px(0),py(GROUND_Y-2),level.width,6);
    ctx.fillStyle='#5a0e18'; for(let x=0;x<level.width;x+=60) ctx.fillRect(px(x+20),py(GROUND_Y-2),20,6);
    for(let x=140;x<level.width;x+=300){ box(x,120,10,200,'#3a2028'); box(x-18,140,46,90,'#8b1a1a'); box(x-14,150,38,4,'#e8c25a');
      ctx.fillStyle='#e8c25a'; ctx.beginPath(); ctx.arc(px(x+5),py(180),9,0,Math.PI*2); ctx.fill(); }
    box(1660,GROUND_Y-120,80,120,'#5c313d'); box(1650,GROUND_Y-150,100,40,'#6d3a48'); box(1680,GROUND_Y-176,40,30,'#e8c25a');
  }
}

function drawGoal(){
  if (goalX==null) return; const gy=GROUND_Y;
  box(goalX,gy-140,6,140,'#d6ddea');
  const wave=Math.sin(frame/10)*4;
  ctx.fillStyle = level.theme==='court'?'#e23b3b':'#e8c25a';
  ctx.beginPath(); ctx.moveTo(px(goalX+6),py(gy-138)); ctx.lineTo(px(goalX+54+wave),py(gy-126)); ctx.lineTo(px(goalX+6),py(gy-112)); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#1a1206'; ctx.font='bold 14px monospace'; ctx.textAlign='center'; ctx.fillText('♛', px(goalX+26), py(gy-121));
}

function drawItem(){
  if (!itemObj || itemObj.taken) return; const it=itemObj;
  const bob = Math.sin(it.bob)*6;
  // 光晕
  const rg=ctx.createRadialGradient(px(it.x+it.w/2),py(it.y+it.h/2+bob),2,px(it.x+it.w/2),py(it.y+it.h/2+bob),36);
  rg.addColorStop(0,'rgba(185,139,255,0.5)'); rg.addColorStop(1,'rgba(185,139,255,0)');
  ctx.fillStyle=rg; ctx.fillRect(px(it.x-18),py(it.y-18+bob),it.w+36,it.h+36);
  // 亡魂之弓：弓身 + 幽光弦
  const cx=px(it.x+it.w/2), cy=py(it.y+it.h/2+bob);
  ctx.strokeStyle='#c9a24a'; ctx.lineWidth=4;
  ctx.beginPath(); ctx.arc(cx, cy, 15, -Math.PI*0.55, Math.PI*0.55); ctx.stroke();
  ctx.strokeStyle='rgba(185,139,255,0.9)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx+9, cy-13); ctx.lineTo(cx+9, cy+13); ctx.stroke();
  // 小骷髅挂饰（呼应墓地/Yorick）
  boxS(cx-4,cy-4,8,8,'#e6ecf5'); ctx.fillStyle='#1a1a1a'; ctx.fillRect(cx-3,cy-2,2,2); ctx.fillRect(cx+1,cy-2,2,2);
  ctx.fillStyle='#b98bff'; ctx.font='bold 11px monospace'; ctx.textAlign='center';
  if (Math.floor(frame/30)%2===0) ctx.fillText('亡魂之弓', cx, cy-24);
}

// ---------- 角色 ----------
function drawPlayer(){
  const p=player;
  if (p.invuln>0 && Math.floor(frame/4)%2===0 && !p.dead) return;
  const x=p.x, y=p.y, f=p.facing;
  const moving = p.onGround && Math.abs(p.vx)>0.5;
  const bob = moving ? Math.sin(p.walkT)*2 : (p.onGround?Math.sin(frame/40)*1:0);
  const legSwing = moving ? Math.sin(p.walkT)*6 : 0;
  // 腿
  box(x+4, y+28, 8, 12+legSwing, '#242836');
  box(x+16, y+28, 8, 12-legSwing, '#242836');
  // 弓（背在身后，拾取后）
  if (hasBow && p.rangedCd<BOW.cd-6){
    ctx.strokeStyle='#c9a24a'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.arc(px(x+p.w/2-f*6), py(y+16-bob), 12, -Math.PI*0.5, Math.PI*0.5); ctx.stroke();
  }
  // 躯干 + 金腰带
  box(x+3, y+12-bob, 22, 18, '#1f2430'); box(x+3, y+22-bob, 22, 3, '#e8c25a'); box(x+3, y+12-bob, 22, 4, '#2e3547');
  // 披风
  ctx.fillStyle='#5a1020';
  ctx.beginPath(); ctx.moveTo(px(x+(f>0?3:22)),py(y+12-bob)); ctx.lineTo(px(x+(f>0?-8:33)),py(y+34)); ctx.lineTo(px(x+(f>0?8:17)),py(y+30-bob)); ctx.closePath(); ctx.fill();
  // 头
  box(x+7, y-2-bob, 16, 16, '#e6c9a8'); box(x+6, y-6-bob, 18, 7, '#3a2a1a');
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(f>0?16:9)), py(y+3-bob), 3,3);
  // 远程拉弓姿态
  if (hasBow && p.rangedCd>BOW.cd-8){
    ctx.strokeStyle='#c9a24a'; ctx.lineWidth=3;
    const bx=x+(f>0?p.w+6:-6);
    ctx.beginPath(); ctx.arc(px(bx),py(y+16-bob),13,-Math.PI*0.5,Math.PI*0.5, f<0); ctx.stroke();
    ctx.strokeStyle='rgba(185,139,255,0.9)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(px(bx),py(y+3-bob)); ctx.lineTo(px(x+p.w/2),py(y+16-bob)); ctx.lineTo(px(bx),py(y+29-bob)); ctx.stroke();
    return;
  }
  // 剑
  ctx.strokeStyle='#dfe4ef'; ctx.lineWidth=3;
  if (p.attacking>0){
    const ex=f>0?x+p.w+30:x-30;
    ctx.strokeStyle='rgba(220,230,255,0.45)'; ctx.lineWidth=6;
    ctx.beginPath(); ctx.arc(px(x+p.w/2),py(y+18),30, f>0?-0.7:Math.PI-0.7, f>0?0.7:Math.PI+0.7); ctx.stroke();
    ctx.strokeStyle='#dfe4ef'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(px(x+p.w/2),py(y+18-bob)); ctx.lineTo(px(ex),py(y+14)); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(px(x+(f>0?p.w-2:2)),py(y+18-bob)); ctx.lineTo(px(x+(f>0?p.w+14:-14)),py(y+6-bob)); ctx.stroke();
  }
  box(x+(f>0?p.w-4:0), y+16-bob, 4,6,'#e8c25a');
}

function drawGuard(en){
  if (!en.alive) return; const x=en.x,y=en.y, hurt=en.hurt>0&&Math.floor(frame/2)%2===0;
  const ls=Math.sin(en.walkT)*5;
  box(x+4,y+28,8,12+ls,'#3a2a24'); box(x+16,y+28,8,12-ls,'#3a2a24');
  box(x+3,y+12,24,18,hurt?'#fff':'#7a4030'); box(x+3,y+12,24,4,hurt?'#fff':'#93513c');
  box(x+8,y-2,16,16,hurt?'#fff':'#c9a48f'); box(x+6,y-8,20,8,hurt?'#fff':'#8a8f9c'); box(x+6,y-2,20,3,'#8a8f9c');
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(en.dir>0?18:9)),py(y+3),3,3);
  ctx.strokeStyle='#7a5a3a'; ctx.lineWidth=3; const sx=en.dir>0?x+en.w:x;
  ctx.beginPath(); ctx.moveTo(px(sx),py(y-6)); ctx.lineTo(px(sx+en.dir*10),py(y+34)); ctx.stroke();
  box(sx+en.dir*10-2,y-12,4,10,hurt?'#fff':'#cfd6e4'); drawMiniHP(en);
}
function drawSkeleton(en){
  if (!en.alive) return; const x=en.x,y=en.y, hurt=en.hurt>0&&Math.floor(frame/2)%2===0;
  const c=hurt?'#fff':'#e6ecf5', ls=Math.sin(en.walkT)*5;
  box(x+5,y+28,6,12+ls,c); box(x+17,y+28,6,12-ls,c); box(x+6,y+12,16,16,c);
  ctx.fillStyle=hurt?'#ccc':'#8a8f9c'; for(let i=0;i<3;i++) ctx.fillRect(px(x+7),py(y+15+i*4),14,2);
  box(x+7,y-4,14,14,c);
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(en.dir>0?15:9)),py(y+1),3,4); ctx.fillRect(px(x+(en.dir>0?10:14)),py(y+1),3,4); ctx.fillRect(px(x+12),py(y+7),4,3);
  ctx.strokeStyle=hurt?'#fff':'#9a8a5a'; ctx.lineWidth=3; const sx=en.dir>0?x+en.w:x;
  ctx.beginPath(); ctx.moveTo(px(sx),py(y+14)); ctx.lineTo(px(sx+en.dir*16),py(y+4)); ctx.stroke(); drawMiniHP(en);
}
function drawMiniHP(en){ if (en.hp>=en.maxHp) return; const w=en.w, r=Math.max(0,en.hp/en.maxHp); box(en.x,en.y-10,w,4,'#000'); box(en.x+1,en.y-9,(w-2)*r,2,'#8ee88e'); }

function drawBoss(){
  if (!boss || !boss.alive) return; const b=boss,x=b.x,y=b.y, hurt=b.hurt>0&&Math.floor(frame/2)%2===0;
  const robe=hurt?'#fff':(b.phase===2?'#7a0f1a':'#8b1a1a');
  ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(px(x-6),py(y+10),b.w+12,b.h-10);
  box(x,y+26,b.w,b.h-26,robe); box(x,y+26,b.w,6,hurt?'#fff':'#a82530');
  ctx.fillStyle='#e8c25a'; for(let i=0;i<3;i++) ctx.fillRect(px(x+8),py(y+40+i*16),b.w-16,3);
  box(x+12,y+2,28,26,hurt?'#fff':'#c9a48f'); box(x+12,y+18,28,10,hurt?'#eee':'#5a4030');
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(b.dir>0?30:16)),py(y+10),4,4);
  box(x+10,y-8,32,12,'#e8c25a');
  ctx.fillStyle='#e8c25a'; ctx.beginPath(); for(let i=0;i<4;i++){ const cx=x+12+i*8; ctx.moveTo(px(cx),py(y-8)); ctx.lineTo(px(cx+4),py(y-16)); ctx.lineTo(px(cx+8),py(y-8)); } ctx.fill();
  ctx.fillStyle='#e23b3b'; ctx.fillRect(px(x+24),py(y-6),4,4);
  ctx.strokeStyle=hurt?'#fff':'#b9c0d0'; ctx.lineWidth=4; const sx=b.dir>0?x+b.w:x;
  ctx.beginPath(); ctx.moveTo(px(sx),py(y+40)); ctx.lineTo(px(sx+b.dir*30),py(y+20)); ctx.stroke();
  if (b.state==='charge'){ ctx.strokeStyle='rgba(226,59,59,0.5)'; ctx.lineWidth=8; ctx.beginPath(); ctx.moveTo(px(sx),py(y+40)); ctx.lineTo(px(sx+b.dir*40),py(y+16)); ctx.stroke(); }
  // 血条
  const bw=W*0.6, bx=W*0.2, by=44;
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(bx-3,by-3,bw+6,20);
  ctx.fillStyle='#3a0d0d'; ctx.fillRect(bx,by,bw,14);
  ctx.fillStyle='#e23b3b'; ctx.fillRect(bx,by,bw*Math.max(0,b.hp/b.maxHp),14);
  ctx.fillStyle='#e8c25a'; ctx.font='bold 13px monospace'; ctx.textAlign='center'; ctx.fillText('克 劳 迪 奥  CLAUDIUS  ['+(b.phase===2?'狂怒':'第一阶段')+']', W/2, by-8);
}

function drawCompanion(){
  if (!companion) return; const c=companion,x=c.x,y=c.y,down=c.mode==='down', hurt=c.hurt>0&&Math.floor(frame/2)%2===0;
  if (down) ctx.globalAlpha=0.4;
  const ls=Math.sin(c.walkT)*4;
  box(x+5,y+26,5,12+ls,'#c9d0e0'); box(x+14,y+26,5,12-ls,'#c9d0e0');
  ctx.fillStyle=hurt?'#fff':'#7fd4ee'; ctx.beginPath(); ctx.moveTo(px(x+2),py(y+30)); ctx.lineTo(px(x+8),py(y+12)); ctx.lineTo(px(x+16),py(y+12)); ctx.lineTo(px(x+22),py(y+30)); ctx.closePath(); ctx.fill();
  box(x+7,y+10,10,10,hurt?'#fff':'#eaf3f8'); box(x+6,y-4,12,14,'#e6c9a8'); box(x+5,y-8,14,8,'#caa24a');
  ctx.fillStyle='#ff9bd0'; ctx.fillRect(px(x+6),py(y-9),3,3); ctx.fillRect(px(x+12),py(y-9),3,3);
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(c.facing>0?12:8)),py(y+1),2,2);
  ctx.globalAlpha=1;
  if (c.hp<c.maxHp && !down) drawMiniHP({x:c.x,y:c.y,w:c.w,hp:c.hp,maxHp:c.maxHp});
}

function drawRescue(){
  if (!rescueObj || rescueObj.saved) return; const r=rescueObj;
  const bob=Math.sin(r.sink*0.6)*4, sinkY=r.y+Math.min(30,r.sink*0.6);
  box(r.x-8,sinkY+bob,16,16,'#7fd4ee'); box(r.x-6,sinkY-8+bob,12,12,'#e6c9a8'); box(r.x-7,sinkY-12+bob,14,6,'#caa24a');
  ctx.strokeStyle='#e6c9a8'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(px(r.x+4),py(sinkY+bob)); ctx.lineTo(px(r.x+10),py(sinkY-14+bob)); ctx.stroke();
  ctx.fillStyle='#ff9bd0'; for(let i=0;i<4;i++) ctx.fillRect(px(r.x-30+i*18+Math.sin((frame+i*40)/20)*4),py(GROUND_Y+22+Math.sin((frame+i*30)/16)*2),4,4);
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2; const rr=(frame%60)/60*30;
  ctx.beginPath(); ctx.ellipse(px(r.x),py(sinkY+18),rr,rr*0.3,0,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='bold 12px monospace'; ctx.textAlign='center';
  if (Math.floor(frame/30)%2===0) ctx.fillText('救我！', px(r.x), py(sinkY-24+bob));
}

function drawArrows(){
  for (const a of arrows){
    ctx.save();
    // 幽灵箭：紫色光束 + 箭头
    ctx.strokeStyle='rgba(185,139,255,0.9)'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(px(a.x),py(a.y+3)); ctx.lineTo(px(a.x - a.facing*14),py(a.y+3)); ctx.stroke();
    ctx.fillStyle='#d8c2ff'; ctx.beginPath();
    ctx.moveTo(px(a.x + a.facing*6),py(a.y+3)); ctx.lineTo(px(a.x),py(a.y)); ctx.lineTo(px(a.x),py(a.y+6)); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
function drawProjectiles(){
  for (const p of projectiles){ box(p.x-6,p.y-6,12,10,'#e8c25a'); ctx.fillStyle='#6fbf4f'; ctx.fillRect(px(p.x-4),py(p.y-4),8,4); ctx.fillStyle='rgba(111,191,79,0.6)'; ctx.beginPath(); ctx.arc(px(p.x),py(p.y-8),3,0,Math.PI*2); ctx.fill(); }
}
function drawFX(){
  for (const p of particles){ ctx.globalAlpha=Math.max(0,p.life/40); if(p.ripple){ ctx.strokeStyle=p.color; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(px(p.x),py(p.y),p.ripple*3,p.ripple,0,0,Math.PI*2); ctx.stroke(); } else box(p.x,p.y,p.size,p.size,p.color); }
  ctx.globalAlpha=1;
  for (const fw of fireworks){ ctx.globalAlpha=Math.max(0,fw.life/50); boxS(fw.x,fw.y,fw.size,fw.size,fw.color); }
  ctx.globalAlpha=1;
  ctx.textAlign='center';
  for (const f of floaters){ ctx.globalAlpha=Math.max(0,f.life/56); ctx.fillStyle=f.color; ctx.font='bold '+f.size+'px monospace'; ctx.fillText(f.text, px(f.x), py(f.y)); }
  ctx.globalAlpha=1;
}

function render(){
  drawBackground(); drawTerrain(); drawGoal(); drawItem();
  if (rescueObj) drawRescue();
  drawProjectiles(); drawArrows();
  for (const en of enemies){ if(en.type==='skeleton') drawSkeleton(en); else drawGuard(en); }
  drawBoss(); drawCompanion(); drawPlayer(); drawFX();
  if (level.isRescue && rescueObj && !rescueObj.saved && timeLeft/60<10){ ctx.fillStyle='rgba(226,59,59,'+(0.12+Math.abs(Math.sin(frame/8))*0.1)+')'; ctx.fillRect(0,0,W,H); }
}

// =========================================================================
//  主循环 & 事件
// =========================================================================
function loop(){ update(); render(); requestAnimationFrame(loop); }

document.getElementById('startBtn').onclick = ()=>{ Sound.unlock(); startGame(); };
document.getElementById('nextBtn').onclick = ()=>{ Sound.unlock(); nextLevel(); };
document.getElementById('restartBtn').onclick = ()=>{ Sound.unlock(); restartLevel(); };
document.getElementById('restartWinBtn').onclick = ()=>{ Sound.unlock(); startGame(); };
document.getElementById('muteBtn').onclick = function(){
  const on = Sound.toggle();
  this.textContent = on ? '🔊 音效开' : '🔇 音效关';
  if (on && state===STATE.PLAY) Sound.setMusic(level.music);
};

loadLevel(0);
setState(STATE.TITLE);
loop();
