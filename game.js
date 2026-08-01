/* =========================================================================
   HAMLET · 王子的复仇 — 五幕横版史诗
   纯前端 HTML5 Canvas + JS · Web Audio 程序化合成 · 五幕剧情 / 打字机过场
   全部图形由 Canvas 代码绘制，全部音乐音效由 AudioContext 合成，无任何外部依赖。
   ========================================================================= */
'use strict';

/* -------------------------------------------------------------------------
   0. 画布 / 常量 / 全局状态
   ------------------------------------------------------------------------- */
const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d');       // 可临时切换到立绘小画布
const W = 960, H = 540;              // 画布像素尺寸
const ZOOM = 1.5;                    // 世界缩放：镜头拉近，人物更大
const VW = W / ZOOM, VH = H / ZOOM;  // 世界可视范围 640 x 360
ctx.imageSmoothingEnabled = false;

const GRAVITY = 0.62, MOVE_SPEED = 3.4, AIR_ACCEL = 0.5, FRICTION = 0.78;
const JUMP_VEL = -12.6, MAX_FALL = 15;

const STATE = { TITLE:'title', STORY:'story', PLAY:'play', CLEAR:'clear', WIN:'win', LOSE:'lose' };
let state = STATE.TITLE;
let actIndex = 0;                    // 0..4 => 第一幕..第五幕
let frame = 0;
let camX = 0, camY = 0;
let shakeT = 0, shakeMag = 0;
let flashT = 0, flashColor = 'rgba(255,255,255,0)';

// 计分
let score = 0, comboTimer = 0, comboCount = 0;
let stats = { time:0, kills:0, boxes:0, secrets:0 };

// 贯穿分支的全局变量
let opheliaSaved = true;             // 第四幕结果，默认 true，失败会置 false，影响第五幕与结局
let hasBow = false;                  // 是否已拾取亡魂之弓
let darkMode = false;                // 失败路线的阴郁哥特模式（第五幕）

/* -------------------------------------------------------------------------
   1. 工具函数
   ------------------------------------------------------------------------- */
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function rand(a,b){ return a + Math.random()*(b-a); }
function randi(a,b){ return (a + Math.random()*(b-a+1))|0; }
function lerp(a,b,t){ return a+(b-a)*t; }
function rectsOverlap(a,b){ return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y; }
function dist(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx,dy); }
function shake(m,t){ shakeMag=Math.max(shakeMag,m); shakeT=Math.max(shakeT,t); }
function flash(c,t){ flashColor=c; flashT=Math.max(flashT,t); }
// 确定性随机（用于关卡生成）
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

/* -------------------------------------------------------------------------
   2. 输入
   ------------------------------------------------------------------------- */
const keys = {};
const KEYMAP = {
  ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right',
  ArrowUp:'jump', KeyW:'jump', Space:'jump',
  KeyJ:'atk', KeyK:'atk', KeyL:'atk',
  KeyF:'ranged', KeyZ:'ranged'
};
let jumpEdge=false, atkEdge=false, rangedEdge=false; // 上升沿检测

window.addEventListener('keydown', e=>{
  const k = KEYMAP[e.code];
  if(k){
    if(!keys[k]){
      if(k==='jump') jumpEdge=true;
      if(k==='atk') atkEdge=true;
      if(k==='ranged') rangedEdge=true;
    }
    keys[k]=true;
    if(e.code==='Space'||e.code.startsWith('Arrow')) e.preventDefault();
  }
  if((e.code==='Enter'||e.code==='Space') && state===STATE.STORY){ storyAdvance(); e.preventDefault(); }
});
window.addEventListener('keyup', e=>{ const k=KEYMAP[e.code]; if(k) keys[k]=false; });

function bindTouch(id,key){
  const el=document.getElementById(id); if(!el) return;
  const on=e=>{ e.preventDefault(); if(!keys[key]){ if(key==='jump')jumpEdge=true; if(key==='atk')atkEdge=true; if(key==='ranged')rangedEdge=true; } keys[key]=true; };
  const off=e=>{ e.preventDefault(); keys[key]=false; };
  el.addEventListener('touchstart',on,{passive:false});
  el.addEventListener('touchend',off,{passive:false});
  el.addEventListener('touchcancel',off,{passive:false});
  el.addEventListener('mousedown',on); el.addEventListener('mouseup',off); el.addEventListener('mouseleave',off);
}
bindTouch('tLeft','left'); bindTouch('tRight','right'); bindTouch('tJump','jump'); bindTouch('tAtk','atk'); bindTouch('tRanged','ranged');
if('ontouchstart' in window){ const t=document.getElementById('touch'); if(t) t.style.display='block'; }

/* -------------------------------------------------------------------------
   3. 音频引擎（Web Audio 合成）
   每幕风格迥异循环 BGM + Boss 曲 + 过场短曲 + SFX；静音开关；手势解锁
   ------------------------------------------------------------------------- */
const N = { C2:65,D2:73,E2:82,F2:87,G2:98,A2:110,B2:123,
  C3:131,D3:147,Ds3:156,E3:165,F3:175,G3:196,Gs3:208,A3:220,As3:233,B3:247,
  C4:262,Cs4:277,D4:294,Ds4:311,E4:330,F4:349,Fs4:370,G4:392,Gs4:415,A4:440,As4:466,B4:494,
  C5:523,Cs5:554,D5:587,Ds5:622,E5:659,F5:698,G5:784,A5:880,B5:988,C6:1047 };

const Sound = {
  ctx:null, master:null, mg:null, sg:null, enabled:true,
  seq:null, bass:null, perc:null, tempo:.3, wave:'square', bassWave:'triangle',
  water:false, bell:false, organ:false, choir:false, brass:false, intensity:1,
  step:0, nextT:0, timer:null, cur:null,
  init(){
    if(this.ctx) return;
    const AC = window.AudioContext||window.webkitAudioContext;
    if(!AC){ this.enabled=false; return; }
    this.ctx=new AC();
    this.master=this.ctx.createGain(); this.master.gain.value=.85; this.master.connect(this.ctx.destination);
    this.mg=this.ctx.createGain(); this.mg.gain.value=.20; this.mg.connect(this.master);
    this.sg=this.ctx.createGain(); this.sg.gain.value=.5; this.sg.connect(this.master);
  },
  unlock(){ this.init(); if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume(); },
  blip(f,d,type='square',vol=.4,when=0,slide=null){
    if(!this.ctx||!this.enabled) return;
    const t=this.ctx.currentTime+when;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(f,t);
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(1,slide),t+d);
    g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+.008);
    g.gain.exponentialRampToValueAtTime(.0001,t+d);
    o.connect(g); g.connect(this.sg); o.start(t); o.stop(t+d+.02);
  },
  noise(d,vol=.3,when=0,hp=800){
    if(!this.ctx||!this.enabled) return;
    const t=this.ctx.currentTime+when, n=Math.floor(this.ctx.sampleRate*d);
    const b=this.ctx.createBuffer(1,n,this.ctx.sampleRate), dt=b.getChannelData(0);
    for(let i=0;i<n;i++) dt[i]=(Math.random()*2-1)*(1-i/n);
    const s=this.ctx.createBufferSource(); s.buffer=b;
    const g=this.ctx.createGain(); g.gain.value=vol;
    const f=this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=hp;
    s.connect(f); f.connect(g); g.connect(this.sg); s.start(t);
  },
  bellHit(f,when=0,vol=.18){
    if(!this.ctx||!this.enabled) return;
    const t=this.ctx.currentTime+when;
    [1,2.01,3.03].forEach((m,i)=>{
      const o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type='sine'; o.frequency.value=f*m;
      g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(vol/(i+1),t+.01);
      g.gain.exponentialRampToValueAtTime(.0001,t+1.3);
      o.connect(g); g.connect(this.mg); o.start(t); o.stop(t+1.4);
    });
  },
  // ---- SFX ----
  jump(){ this.blip(300,.16,'square',.30,0,600); },
  hit(){ this.blip(170,.08,'square',.38,0,90); this.noise(.06,.20); },
  swing(){ this.noise(.10,.12,0,1200); this.blip(520,.08,'triangle',.14,0,760); },
  rangedFire(){ this.blip(760,.12,'sawtooth',.24,0,220); this.noise(.05,.10,0,2000); },
  hurt(){ this.blip(200,.24,'sawtooth',.36,0,70); this.noise(.05,.16); },
  pickup(){ [523,659,784,1047,1319].forEach((f,i)=>this.blip(f,.12,'triangle',.36,i*.06)); },
  coin(){ this.blip(880,.06,'square',.22); this.blip(1320,.08,'square',.20,.05); },
  breakBox(){ this.noise(.18,.28,0,500); this.blip(140,.12,'square',.24,0,70); },
  bossHit(){ this.blip(110,.12,'square',.42,0,60); this.noise(.08,.26); },
  bossPhase(){ [147,131,110,98].forEach((f,i)=>this.blip(f,.4,'sawtooth',.4,i*.14)); this.noise(.5,.2,0,200); },
  lose(){ this.stopMusic(); [392,330,262,196,147].forEach((f,i)=>this.blip(f,.38,'sawtooth',.4,i*.2)); },
  rescue(){ [659,784,988,1319,1047,1319,1568,2093].forEach((f,i)=>this.blip(f,.22,'triangle',.4,i*.11)); },
  checkpoint(){ [523,784,1047].forEach((f,i)=>this.blip(f,.16,'triangle',.34,i*.08)); },
  charge(){ this.blip(180,.5,'sawtooth',.3,0,720); },
  ult(){ [110,146,196,262,392].forEach((f,i)=>this.blip(f,.5,'sawtooth',.44,i*.06,f*2)); this.noise(.6,.3,0,120); },
  // ---- 过场短曲 ----
  jingle(name){
    if(!this.ctx||!this.enabled) return;
    const J=JINGLES[name]||JINGLES.victory; let w=0;
    J.seq.forEach(n=>{
      if(n.f){ this.blip(n.f,J.tempo*(n.d||1)*.95,J.wave,.4,w); if(J.bass) this.blip(n.f/2,J.tempo*(n.d||1),'triangle',.2,w); }
      w+=J.tempo*(n.d||1);
    });
  },
  // ---- 循环 BGM ----
  setMusic(name,intensity){
    this.intensity = intensity||1;
    if(this.cur===name && this.timer){ return; }
    this.cur=name; this.step=0;
    const M=MUSIC[name]||MUSIC.castle;
    this.seq=M.seq; this.bass=M.bass; this.perc=M.perc; this.tempo=M.tempo;
    this.wave=M.wave; this.bassWave=M.bassWave||'triangle';
    this.water=!!M.water; this.bell=!!M.bell; this.organ=!!M.organ; this.choir=!!M.choir; this.brass=!!M.brass;
    if(!this.ctx||!this.enabled) return;
    this.nextT=this.ctx.currentTime+.06;
    if(this.timer) clearInterval(this.timer);
    this.timer=setInterval(()=>this.sched(),25);
  },
  boostIntensity(v){ this.intensity=v; },
  sched(){
    if(!this.ctx||!this.enabled) return;
    const inten=this.intensity;
    while(this.nextT < this.ctx.currentTime+.18){
      const i=this.step, n=this.seq[i%this.seq.length], dur=this.tempo*(n.d||1);
      if(n.f){
        const o=this.ctx.createOscillator(), g=this.ctx.createGain();
        o.type=this.wave; o.frequency.setValueAtTime(n.f,this.nextT);
        const vol=.5*inten;
        g.gain.setValueAtTime(.0001,this.nextT); g.gain.exponentialRampToValueAtTime(vol,this.nextT+.02);
        g.gain.exponentialRampToValueAtTime(.0001,this.nextT+dur*.9);
        o.connect(g); g.connect(this.mg); o.start(this.nextT); o.stop(this.nextT+dur);
        // 合唱/铜管叠一层高八度或五度
        if(this.choir||this.brass){
          const o2=this.ctx.createOscillator(), g2=this.ctx.createGain();
          o2.type=this.choir?'sine':'sawtooth'; o2.frequency.setValueAtTime(n.f*(this.choir?2:1.5),this.nextT);
          g2.gain.setValueAtTime(.0001,this.nextT); g2.gain.exponentialRampToValueAtTime(vol*.5,this.nextT+.03);
          g2.gain.exponentialRampToValueAtTime(.0001,this.nextT+dur*.9);
          o2.connect(g2); g2.connect(this.mg); o2.start(this.nextT); o2.stop(this.nextT+dur);
        }
      }
      if(this.bass){
        const bn=this.bass[i%this.bass.length];
        if(bn){
          const bo=this.ctx.createOscillator(), bg=this.ctx.createGain();
          bo.type=this.bassWave; bo.frequency.setValueAtTime(bn,this.nextT);
          bg.gain.setValueAtTime(.0001,this.nextT); bg.gain.exponentialRampToValueAtTime(.36*inten,this.nextT+.02);
          bg.gain.exponentialRampToValueAtTime(.0001,this.nextT+dur*.95);
          bo.connect(bg); bg.connect(this.mg); bo.start(this.nextT); bo.stop(this.nextT+dur);
        }
      }
      if(this.perc && this.perc[i%this.perc.length]) this.noise(.05,.18*inten,this.nextT-this.ctx.currentTime,1600);
      if(this.bell && i%16===0) this.bellHit(196,this.nextT-this.ctx.currentTime);
      if(this.organ && i%8===0) this.bellHit(98,this.nextT-this.ctx.currentTime,.10);
      if(this.water && Math.random()<.22) this.noise(.18,.05,this.nextT-this.ctx.currentTime,300);
      this.nextT+=dur; this.step++;
    }
  },
  stopMusic(){ if(this.timer){ clearInterval(this.timer); this.timer=null; } this.cur=null; },
  toggle(){ this.enabled=!this.enabled; if(!this.enabled) this.stopMusic(); return this.enabled; }
};

const MUSIC = {
  // 第一幕 城堡：中世纪宫廷，弦乐 + 鲁特琴（triangle 拨奏感）
  castle:{ tempo:.30, wave:'triangle', bassWave:'triangle',
    seq:[{f:N.A4},{f:N.C5},{f:N.E5},{f:N.C5},{f:N.B4},{f:N.G4},{f:N.A4,d:2},{f:N.F4},{f:N.A4},{f:N.C5},{f:N.A4},{f:N.G4},{f:N.E4},{f:N.F4,d:2}],
    bass:[N.A2,0,N.E2,0,N.F2,0,N.C3,0,N.D3,0,N.G2,0,N.A2,0] },
  // 第二幕 宫廷 装疯：不安的宫廷华尔兹
  palace:{ tempo:.26, wave:'square', bassWave:'triangle',
    seq:[{f:N.E4},{f:N.A4},{f:N.C5},{f:N.B4},{f:N.A4},{f:N.G4,d:2},{f:N.F4},{f:N.A4},{f:N.D5},{f:N.C5},{f:N.B4},{f:N.A4,d:2},{f:N.G4},{f:N.E4,d:2}],
    bass:[N.A2,N.E3,N.E3,N.F2,N.C3,N.C3,N.D3,N.A2,N.A2,N.E2,N.E3,N.E3] },
  // 第三幕 剧院/内室：阴郁哥特，管风琴 + 钟声
  theater:{ tempo:.38, wave:'sawtooth', bassWave:'sine', bell:true, organ:true,
    seq:[{f:N.D4,d:2},{f:N.F4},{f:N.E4},{f:N.D4,d:2},{f:N.C4,d:2},{f:N.A3,d:2},{f:N.D4},{f:N.F4},{f:N.A4,d:2},{f:0,d:2}],
    bass:[N.D2,0,0,0,N.A2,0,0,0,N.F2,0,0,0,N.G2,0,0,0] },
  // 第四幕 湖边：紧张急促弦乐拨奏 + 水声
  lake:{ tempo:.15, wave:'triangle', bassWave:'sine', water:true,
    seq:[{f:N.E4},{f:N.G4},{f:N.E4},{f:N.A4},{f:N.E4},{f:N.G4},{f:N.C5},{f:N.B4},{f:N.A4},{f:N.G4},{f:N.A4},{f:N.E4},{f:N.D4},{f:N.E4}],
    bass:[N.A2,0,N.A2,0,N.F2,0,N.F2,0,N.C3,0,N.E2,0] },
  // 第五幕 成功路线：英雄交响曲（铜管 + 合唱层次，怪物猎人式激昂宏大）
  hero:{ tempo:.20, wave:'sawtooth', bassWave:'square', brass:true, choir:true, perc:[1,0,0,1,0,0,1,0,1,0,0,1],
    seq:[{f:N.A4},{f:N.A4},{f:N.C5},{f:N.E5},{f:N.A5},{f:N.G5},{f:N.E5},{f:N.C5,d:2},{f:N.D5},{f:N.F5},{f:N.A5,d:2},{f:N.G5},{f:N.E5},{f:N.A4,d:2}],
    bass:[N.A2,N.A2,N.A2,N.E2,N.F2,N.F2,N.C3,N.C3,N.D3,N.D3,N.G2,N.G2,N.A2,N.A2] },
  // 第五幕 失败路线：帝国进行曲式压迫（低沉铜管、不祥节奏）
  imperial:{ tempo:.24, wave:'sawtooth', bassWave:'square', brass:true, perc:[1,0,0,1,0,0,1,1,0,0],
    seq:[{f:N.A3},{f:N.A3},{f:N.A3},{f:N.F3},{f:0,d:.5},{f:N.C4},{f:N.A3},{f:N.F3},{f:0,d:.5},{f:N.C4},{f:N.A3,d:2},{f:N.E4},{f:N.E4},{f:N.E4},{f:N.F4},{f:0,d:.5},{f:N.C4},{f:N.Gs3},{f:N.F3},{f:0,d:.5},{f:N.C4},{f:N.A3,d:2}],
    bass:[N.A2,N.A2,N.A2,N.F2,N.F2,N.C3,N.A2,N.A2,N.F2,N.F2,N.C3,N.A2] },
  // Boss 通用（第五幕之前的高潮，如第三幕内室激战）
  boss:{ tempo:.17, wave:'sawtooth', bassWave:'square', perc:[1,0,1,0,1,0,1,0], brass:true,
    seq:[{f:N.A4},{f:N.C5},{f:N.E5},{f:N.C5},{f:N.A4},{f:N.F5},{f:N.E5},{f:N.C5},{f:N.D5},{f:N.F5},{f:N.A5},{f:N.G5},{f:N.E5},{f:N.C5}],
    bass:[N.A2,N.A2,N.A2,N.A2,N.F2,N.F2,N.F2,N.F2,N.E2,N.E2,N.E2,N.E2] }
};
const JINGLES = {
  victory:{ tempo:.15, wave:'square', bass:true, seq:[{f:N.C5},{f:N.E5},{f:N.G5},{f:N.C5},{f:N.E5},{f:N.G5},{f:N.C5,d:3}] },
  somber:{ tempo:.24, wave:'triangle', bass:true, seq:[{f:N.E4},{f:N.G4},{f:N.C5},{f:N.B4},{f:N.G4,d:2},{f:N.A4},{f:N.C5,d:3}] },
  epicwin:{ tempo:.17, wave:'sawtooth', bass:true, seq:[{f:N.A4},{f:N.C5},{f:N.E5},{f:N.A5},{f:N.G5},{f:N.E5},{f:N.F5},{f:N.A5,d:4}] },
  fanfare:{ tempo:.13, wave:'square', bass:true, seq:[{f:N.G4},{f:N.C5},{f:N.E5},{f:N.G5},{f:N.C6,d:3}] }
};

/* -------------------------------------------------------------------------
   4. DOM 引用 & HUD
   ------------------------------------------------------------------------- */
const $ = id => document.getElementById(id);
const dom = {
  hud:$('hud'), playerHp:$('playerHp'), ophRow:$('ophRow'), ophHp:$('ophHp'),
  ammoRow:$('ammoRow'), ammoVal:$('ammoVal'), ammoMax:$('ammoMax'), ammoCd:$('ammoCd'),
  levelLabel:$('levelLabel'), timerRow:$('timerRow'), timer:$('timer'),
  scorePanel:$('scorePanel'), scoreVal:$('scoreVal'), combo:$('combo'),
  muteBtn:$('muteBtn'), ctrlHint:$('ctrlHint'), hintRanged:$('hintRanged'), hintLock:$('hintLock'),
  levelName:$('levelName'),
  storyScreen:$('storyScreen'), storyAct:$('storyAct'), storyTitle:$('storyTitle'), storyBody:$('storyBody'),
  skipBtn:$('skipBtn'), storyBtn:$('storyBtn'),
  titleScreen:$('titleScreen'), startBtn:$('startBtn'),
  levelClearScreen:$('levelClearScreen'), clearText:$('clearText'), clearScore:$('clearScore'), nextBtn:$('nextBtn'),
  winScreen:$('winScreen'), winQuote:$('winQuote'), winScore:$('winScore'), restartWinBtn:$('restartWinBtn'),
  loseScreen:$('loseScreen'), loseTitle:$('loseTitle'), loseText:$('loseText'), loseScore:$('loseScore'), restartBtn:$('restartBtn')
};
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }

function addScore(n, tag){
  score += n;
  if(tag==='kill') stats.kills++;
  dom.scoreVal.textContent = score;
  dom.scoreVal.classList.remove('pop'); void dom.scoreVal.offsetWidth; dom.scoreVal.classList.add('pop');
}
function bumpCombo(){
  comboCount++; comboTimer=120;
  if(comboCount>1) dom.combo.textContent = 'COMBO x'+comboCount;
}
function updateHUD(){
  if(!player) return;
  dom.playerHp.style.width = clamp(player.hp/player.maxHp*100,0,100)+'%';
  if(companion && companion.active){
    dom.ophRow.style.display='block';
    dom.ophHp.style.width = clamp(companion.hp/companion.maxHp*100,0,100)+'%';
  } else dom.ophRow.style.display='none';
  if(hasBow){
    dom.ammoRow.style.display='block';
    dom.ammoVal.textContent = player.ammo;
    dom.ammoMax.textContent = player.maxAmmo;
    dom.ammoCd.textContent = player.rangedCd>0 ? '（冷却…）' : '';
  } else dom.ammoRow.style.display='none';
}

/* -------------------------------------------------------------------------
   5. 粒子 / 飘字 / 环境特效
   ------------------------------------------------------------------------- */
let particles=[], floaters=[], fireworks=[], petals=[], crows=[];
function burst(x,y,c,n=8,sp=3,g=0.18){
  for(let i=0;i<n;i++){ const a=Math.random()*6.283; particles.push({x,y,vx:Math.cos(a)*rand(1,sp),vy:Math.sin(a)*rand(1,sp)-1,life:rand(20,44),max:44,color:c,size:rand(2,4),g}); }
}
function spark(x,y,dir,c){
  for(let i=0;i<10;i++){ const a=(dir>0?0:Math.PI)+rand(-0.9,0.9),s=rand(2,6); particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(12,26),max:26,color:c,size:rand(2,4),g:0.1}); }
}
function ripple(x,y){ particles.push({x,y,vx:0,vy:0,life:34,max:34,color:'rgba(200,235,255,0.8)',size:2,g:0,ripple:2}); }
function smoke(x,y,c){ particles.push({x,y,vx:rand(-.6,.6),vy:rand(-1.4,-.4),life:rand(30,60),max:60,color:c||'rgba(120,110,140,0.5)',size:rand(3,6),g:-0.01,grow:.08}); }
function launchFirework(x,y){
  const cs=['#e8c25a','#e23b3b','#7fd4ee','#8ee88e','#ff9bd0','#fff'], c=cs[(Math.random()*cs.length)|0];
  for(let i=0;i<26;i++){ const a=6.283*i/26,s=rand(2.4,4.2); fireworks.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(34,52),max:52,color:c,size:rand(2,3.5)}); }
}
function addFloater(x,y,text,color,size){ floaters.push({x,y,text,color,size:size||14,life:56,max:56}); }

function updateParticles(){
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=p.g; if(p.grow)p.size+=p.grow; if(p.ripple)p.ripple+=1.4; if(--p.life<=0) particles.splice(i,1); }
  for(let i=fireworks.length-1;i>=0;i--){ const p=fireworks[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.06; if(--p.life<=0) fireworks.splice(i,1); }
  for(let i=floaters.length-1;i>=0;i--){ const f=floaters[i]; f.y-=0.7; if(--f.life<=0) floaters.splice(i,1); }
  for(let i=petals.length-1;i>=0;i--){ const p=petals[i]; p.x+=p.vx+Math.sin(frame*0.04+p.ph)*0.5; p.y+=p.vy; p.rot+=p.vr; if(p.y>level.height+40||--p.life<=0) petals.splice(i,1); }
  for(let i=crows.length-1;i>=0;i--){ const c=crows[i]; c.x+=c.vx; c.flap+=0.3; if(c.x<camX-200||c.x>camX+VW+400) crows.splice(i,1); }
}
function spawnPetal(x,y,color){ petals.push({x,y,vx:rand(-.6,.4),vy:rand(.6,1.6),rot:rand(0,6.28),vr:rand(-.1,.1),size:rand(3,6),color:color||'#ffd0e6',ph:rand(0,6.28),life:rand(200,400)}); }

/* -------------------------------------------------------------------------
   6. 背景绘制（视差层，屏幕空间；不受世界缩放影响）
   每幕不同氛围；失败路线 darkMode 会切换阴郁哥特配色
   ------------------------------------------------------------------------- */
function drawBackground(){
  const theme = ACTS[actIndex].theme;
  // 天空渐变
  let sky = theme.sky;
  if(darkMode && actIndex===4) sky = ['#0a0710','#160a1c','#050308'];
  const grd = ctx.createLinearGradient(0,0,0,H);
  grd.addColorStop(0, sky[0]); grd.addColorStop(0.5, sky[1]); grd.addColorStop(1, sky[2]);
  ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);

  // 月亮 / 光源
  if(theme.moon){
    const mx = W*0.78 - (camX*0.05)%W, my=H*0.22;
    const mg = ctx.createRadialGradient(mx,my,4,mx,my,60);
    const moonC = darkMode? 'rgba(180,150,210,':'rgba(240,235,210,';
    mg.addColorStop(0, moonC+'0.95)'); mg.addColorStop(1, moonC+'0)');
    ctx.fillStyle=mg; ctx.beginPath(); ctx.arc(mx,my,60,0,6.283); ctx.fill();
    ctx.fillStyle= darkMode?'#c9b6e0':'#f2eecf'; ctx.beginPath(); ctx.arc(mx,my,26,0,6.283); ctx.fill();
  }

  // 远景剪影层（视差 0.2）
  const off1 = (camX*0.2)%320;
  ctx.fillStyle = darkMode? '#0d0814' : theme.far;
  for(let bx=-off1-320; bx<W+320; bx+=320){ theme.drawFar(bx, H); }

  // 中景层（视差 0.45）
  const off2 = (camX*0.45)%260;
  ctx.fillStyle = darkMode? '#140b1e' : theme.mid;
  for(let bx=-off2-260; bx<W+260; bx+=260){ theme.drawMid(bx, H); }

  // 环境浮层：雾/雨/花瓣/乌鸦
  drawAmbientBg();
}

function drawAmbientBg(){
  const theme = ACTS[actIndex].theme;
  // 雾气带
  ctx.save();
  const fogA = darkMode?0.14:(theme.fog||0.05);
  ctx.fillStyle = 'rgba(180,180,210,'+fogA+')';
  for(let i=0;i<3;i++){ const y=H*0.55 + i*40 + Math.sin(frame*0.01+i)*8; ctx.fillRect(0,y,W,26); }
  ctx.restore();
}

// 具体背景剪影绘制器（供 theme.drawFar / drawMid 使用）
function silhouetteCastle(bx, groundH){
  ctx.beginPath();
  const base=groundH*0.62;
  ctx.moveTo(bx,groundH);
  ctx.lineTo(bx,base+40); ctx.lineTo(bx+30,base+40); ctx.lineTo(bx+30,base);
  ctx.lineTo(bx+60,base); ctx.lineTo(bx+60,base-40);
  ctx.lineTo(bx+90,base-40); ctx.lineTo(bx+90,base);
  ctx.lineTo(bx+150,base); ctx.lineTo(bx+150,base-70);
  ctx.lineTo(bx+180,base-70); ctx.lineTo(bx+180,base+30);
  ctx.lineTo(bx+240,base+30); ctx.lineTo(bx+240,base+50);
  ctx.lineTo(bx+320,base+50); ctx.lineTo(bx+320,groundH);
  ctx.closePath(); ctx.fill();
}
function silhouettePalace(bx, groundH){
  ctx.beginPath();
  const base=groundH*0.58;
  ctx.moveTo(bx,groundH); ctx.lineTo(bx,base+30);
  for(let i=0;i<5;i++){ const px=bx+i*52; ctx.lineTo(px,base+30); ctx.lineTo(px+10,base-20); ctx.lineTo(px+20,base+30); ctx.lineTo(px+52,base+30); }
  ctx.lineTo(bx+260,groundH); ctx.closePath(); ctx.fill();
}
function silhouetteTrees(bx, groundH){
  const base=groundH*0.7;
  for(let i=0;i<4;i++){ const px=bx+i*80+20; ctx.beginPath(); ctx.moveTo(px,groundH); ctx.lineTo(px-6,base); ctx.lineTo(px+6,base); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(px,base-8,22,0,6.283); ctx.fill(); }
}
function silhouetteDeadTrees(bx, groundH){
  const base=groundH*0.72;
  ctx.strokeStyle=ctx.fillStyle; ctx.lineWidth=3;
  for(let i=0;i<3;i++){ const px=bx+i*100+30; ctx.beginPath(); ctx.moveTo(px,groundH); ctx.lineTo(px,base); ctx.moveTo(px,base+18); ctx.lineTo(px-16,base-2); ctx.moveTo(px,base+30); ctx.lineTo(px+18,base+6); ctx.moveTo(px,base+6); ctx.lineTo(px-12,base-16); ctx.stroke(); }
}
function silhouetteGraves(bx, groundH){
  const base=groundH*0.8;
  for(let i=0;i<6;i++){ const px=bx+i*54+20; ctx.fillRect(px,base,16,groundH-base); ctx.beginPath(); ctx.arc(px+8,base,8,Math.PI,0); ctx.fill(); }
}
function silhouetteColumns(bx, groundH){
  const base=groundH*0.5;
  for(let i=0;i<5;i++){ const px=bx+i*56+16; ctx.fillRect(px,base,22,groundH-base); ctx.fillRect(px-4,base-8,30,10); }
  ctx.fillRect(bx,base-8,W>0?260:260,0);
}

/* -------------------------------------------------------------------------
   7. 五幕主题（背景配色 + 剪影绘制器）
   ------------------------------------------------------------------------- */
const ACTS = [
  { name:'第一幕 · 城堡', en:'ACT I — The Castle', music:'castle',
    theme:{ sky:['#1a2038','#141a30','#0a0c18'], far:'#1b2138', mid:'#232a45', moon:true, fog:0.05,
      drawFar:(bx,gh)=>silhouetteCastle(bx,gh), drawMid:(bx,gh)=>silhouetteCastle(bx+40,gh) },
    ground:'#3a3550', groundTop:'#4a4468', accent:'#e8c25a' },
  { name:'第二幕 · 宫廷', en:'ACT II — The Court', music:'palace',
    theme:{ sky:['#2a2338','#221b30','#120c1a'], far:'#2a2440', mid:'#3a3052', moon:false, fog:0.04,
      drawFar:(bx,gh)=>silhouettePalace(bx,gh), drawMid:(bx,gh)=>silhouetteColumns(bx,gh) },
    ground:'#4a3d5c', groundTop:'#6a5a80', accent:'#d8b8f0' },
  { name:'第三幕 · 剧院/内室', en:'ACT III — The Play', music:'theater',
    theme:{ sky:['#1a1420','#140e1a','#080510'], far:'#191320', mid:'#241a30', moon:true, fog:0.09,
      drawFar:(bx,gh)=>silhouetteColumns(bx,gh), drawMid:(bx,gh)=>silhouetteColumns(bx+30,gh) },
    ground:'#332840', groundTop:'#4a3a5e', accent:'#b98bff' },
  { name:'第四幕 · 湖畔', en:'ACT IV — The Lake', music:'lake',
    theme:{ sky:['#243448','#1c2a3a','#101a26'], far:'#1e2c3c', mid:'#2a3c50', moon:true, fog:0.07,
      drawFar:(bx,gh)=>silhouetteTrees(bx,gh), drawMid:(bx,gh)=>silhouetteTrees(bx+40,gh) },
    ground:'#2e4258', groundTop:'#3e5a76', accent:'#7fd4ee' },
  { name:'第五幕 · 墓地与王座', en:'ACT V — Grave & Throne', music:'hero',
    theme:{ sky:['#241a2e','#1a1020','#0a0510'], far:'#1e1526', mid:'#2c2038', moon:true, fog:0.08,
      drawFar:(bx,gh)=>silhouetteGraves(bx,gh), drawMid:(bx,gh)=>silhouetteColumns(bx,gh) },
    ground:'#3a2f48', groundTop:'#52405e', accent:'#e8c25a' }
];

/* -------------------------------------------------------------------------
   8. 主角哈姆雷特绘制（Canvas 像素/矢量，随幕演进）
   参考 Benedict Cumberbatch 2015 NT Live 舞台造型：
   黑色现代军装战服、暗扣领口、肩章、修身；深色微卷凌乱头发；
   高颧骨深眼窝、眉头微锁、锐利忧郁眼神；站姿略前倾富戏剧张力。
   act:0..4  stage 决定服装/面部/磨损/色彩；pose 决定姿态帧
   ------------------------------------------------------------------------- */
function hamletStyle(act){
  // 依据幕数返回造型参数
  const S = {
    coat:'#141018', coatHi:'#2a2236', coatShadow:'#0a070d', trim:'#3a3348',
    epaulet:'#8a7a4a', hair:'#241c18', skin:'#c9a98c', skinShade:'#a3805f',
    eye:'#e8dcc0', accent:'#e8c25a', wear:0, wet:false, gold:false, doom:false, cape:false
  };
  if(act>=1){ S.coat='#161020'; S.trim='#4a3a58'; S.epaulet='#9a8850'; S.skinShade='#9a7050'; }
  if(act>=2){ S.coat='#120c1a'; S.wear=1; S.hair='#1c1512'; S.eye='#f0e4c8'; }
  if(act>=3){ S.coat='#0e0a16'; S.wear=2; S.wet=true; S.cape=true; S.coatHi='#241c30'; }
  if(act>=4){
    S.cape=true; S.wear=2;
    if(opheliaSaved && !darkMode){ S.gold=true; S.coat='#181022'; S.trim='#c9a24a'; S.epaulet='#e8c25a'; S.coatHi='#2e2440'; S.eye='#fff4d0'; }
    else { S.doom=true; S.coat='#0a0710'; S.trim='#4a2a5c'; S.epaulet='#5a4a6a'; S.hair='#181018'; S.skin='#a890a0'; S.skinShade='#6a5070'; S.eye='#c0a8d0'; S.coatHi='#1a1020'; S.wear=3; }
  }
  return S;
}

// px 助手：世界坐标下画一个像素块
function px(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(x,y,w,h); }

// 绘制哈姆雷特。cx,cy = 脚底中心；facing ±1；pose 对象 {type,frame,t}
function drawHamlet(cx, cy, facing, pose, act){
  const S = hamletStyle(act);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(facing, 1);
  // 整体像素单元约 2px；角色高约 44
  const t = pose.t||0;
  const walk = pose.type==='walk';
  const jump = pose.type==='jump';
  const atk  = pose.type==='atk';
  const hurt = pose.type==='hurt';
  const ranged = pose.type==='ranged';
  const bob = walk ? Math.sin(t*0.4)*1.2 : 0;
  const lean = 1.5; // 站姿略前倾
  // 腿部动画
  let legPhase = walk ? Math.sin(t*0.4) : 0;
  const legSwing = walk ? legPhase*4 : 0;
  // 手臂
  let armSwing = walk ? -legPhase*3 : 0;

  // 影子
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 0, 12, 3.5, 0,0,6.283); ctx.fill();

  // 悲怆/失败光影
  if(S.doom){ ctx.save(); ctx.globalAlpha=0.5; const g=ctx.createRadialGradient(0,-24,2,0,-24,30); g.addColorStop(0,'rgba(120,60,150,0.4)'); g.addColorStop(1,'rgba(120,60,150,0)'); ctx.fillStyle=g; ctx.fillRect(-30,-54,60,54); ctx.restore(); }
  if(S.gold){ ctx.save(); ctx.globalAlpha=0.4+0.2*Math.sin(frame*0.08); const g=ctx.createRadialGradient(0,-26,2,0,-26,32); g.addColorStop(0,'rgba(232,194,90,0.35)'); g.addColorStop(1,'rgba(232,194,90,0)'); ctx.fillStyle=g; ctx.fillRect(-32,-58,64,58); ctx.restore(); }

  const baseY = -bob;
  // ---- 腿 ----
  // 后腿
  px(-6+ (jump?-2:legSwing), baseY-16, 5, 16+(jump?-3:0), S.coatShadow);
  // 前腿
  px(1 - (jump?-3:legSwing), baseY-16, 5, 16+(jump?-2:0), S.coat);
  // 靴
  px(-7+(jump?-2:legSwing), baseY-3, 7, 4, '#0a0a0e');
  px(0-(jump?-3:legSwing), baseY-3, 7, 4, '#0a0a0e');

  // ---- 外套 / 躯干（略前倾）----
  const torsoY = baseY-38;
  // 长外套下摆
  ctx.fillStyle=S.coat;
  ctx.beginPath();
  ctx.moveTo(-8, torsoY+8);
  ctx.lineTo(9, torsoY+8);
  ctx.lineTo(11+lean, baseY-14);
  ctx.lineTo(-9+lean*0.5, baseY-12);
  ctx.closePath(); ctx.fill();
  if(S.cape){ // 战斗披风摆动
    ctx.fillStyle=S.coatShadow;
    ctx.beginPath();
    ctx.moveTo(-7,torsoY+4);
    ctx.lineTo(-13-Math.sin(t*0.2)*2, baseY-8);
    ctx.lineTo(-4, baseY-14);
    ctx.closePath(); ctx.fill();
  }
  // 躯干主体（修身）
  px(-8+lean*0.4, torsoY, 17, 20, S.coat);
  // 高光边
  px(6+lean*0.4, torsoY, 3, 20, S.coatHi);
  px(-8+lean*0.4, torsoY, 2, 20, S.coatShadow);
  // 暗扣领口中缝 + 扣子
  px(-1+lean*0.4, torsoY, 2, 18, S.coatShadow);
  ctx.fillStyle=S.gold?S.accent:'#3a3348';
  for(let i=0;i<4;i++) px(-3+lean*0.4, torsoY+2+i*4, 2, 2, S.trim);
  // 磨损细节
  if(S.wear>=2){ px(-6+lean*0.4, torsoY+12, 3, 2, S.coatShadow); px(4+lean*0.4, torsoY+6, 2, 3, S.coatShadow); }
  if(S.wear>=3){ px(0+lean*0.4, torsoY+14, 4, 2, '#2a1a2e'); }

  // 肩章
  px(-9+lean*0.4, torsoY-1, 6, 4, S.epaulet);
  px(6+lean*0.4, torsoY-1, 5, 4, S.epaulet);
  // 肩章扣子
  px(-8+lean*0.4, torsoY, 2, 2, S.gold?'#fff0c0':'#c9b98a');
  px(8+lean*0.4, torsoY, 2, 2, S.gold?'#fff0c0':'#c9b98a');

  // ---- 手臂 & 武器 ----
  drawHamletArm(S, act, torsoY, baseY, lean, {atk,ranged,walk,jump,armSwing,t,pose});

  // ---- 头 ----
  const headY = torsoY-14;
  // 脖子
  px(-2+lean*0.5, headY+10, 5, 4, S.skinShade);
  // 头颅
  px(-6+lean*0.6, headY, 12, 12, S.skin);
  // 颧骨/下颌阴影（高颧骨深眼窝）
  px(-6+lean*0.6, headY+7, 3, 4, S.skinShade);
  px(4+lean*0.6, headY+2, 2, 8, S.skinShade);
  // 头发（深色微卷凌乱有型）
  ctx.fillStyle=S.hair;
  px(-7+lean*0.6, headY-3, 14, 6, S.hair);
  px(-7+lean*0.6, headY-1, 3, 8, S.hair);
  px(5+lean*0.6, headY-1, 3, 6, S.hair);
  // 凌乱发丝
  px(-8+lean*0.6, headY-2, 2, 3, S.hair);
  px(6+lean*0.6, headY-4, 3, 3, S.hair);
  if(S.wear>=2){ px(-9+lean*0.6, headY+1, 2, 4, S.hair); } // 更乱
  if(S.wet){ // 湿发效果：高光条
    ctx.fillStyle='rgba(150,180,210,0.5)'; px(-5+lean*0.6, headY-2, 2, 5, 'rgba(150,180,210,0.5)'); px(2+lean*0.6, headY-2, 2, 4, 'rgba(150,180,210,0.5)');
  }
  // 眉头微锁
  px(-4+lean*0.6, headY+4, 3, 1, '#1a120e');
  px(1+lean*0.6, headY+4, 3, 1, '#1a120e');
  // 眼睛（锐利忧郁）
  ctx.fillStyle=S.eye; px(-4+lean*0.6, headY+5, 3, 2, S.eye); px(2+lean*0.6, headY+5, 2, 2, S.eye);
  px(-2+lean*0.6, headY+5, 1, 2, '#1a1410'); px(3+lean*0.6, headY+5, 1, 2, '#1a1410'); // 瞳
  if(hurt){ // 受伤情绪化：闭眼皱眉
    px(-4+lean*0.6, headY+5, 5, 2, S.skinShade); px(2+lean*0.6, headY+5, 3, 2, S.skinShade);
  }
  // 眼窝阴影
  px(-5+lean*0.6, headY+4, 1, 4, S.skinShade);
  // 嘴/颌
  px(-2+lean*0.6, headY+9, 4, 1, hurt?'#5a2020':S.skinShade);

  ctx.restore();
}

function drawHamletArm(S, act, torsoY, baseY, lean, o){
  const shX = 7+lean*0.4, shY = torsoY+3;
  // 武器演进：act0 拳/短匕；act1-2 短剑；act>=3 亡魂之弓（远程），近战改细剑；act4 击剑细剑
  let atkArc=0;
  if(o.atk){ atkArc = Math.sin(clamp((o.pose.frame||0)/8,0,1)*Math.PI)*1.3; }
  // 手臂（前臂）
  ctx.save();
  ctx.translate(shX, shY);
  let armAng = o.armSwing*0.15;
  if(o.atk) armAng = -1.1 + atkArc; // 挥砍
  else if(o.ranged) armAng = -0.2;
  else if(o.jump) armAng = -0.5;
  ctx.rotate(armAng);
  // 上臂
  px(0, 0, 4, 10, S.coat);
  px(0, 0, 1, 10, S.coatHi);
  // 手
  px(0, 9, 4, 3, S.skin);

  // 武器
  if(act===0){
    // 短匕/拳感：短小匕首
    px(4, 8, 8, 2, '#c9c4b0'); px(4, 7, 3, 1, '#8a7a4a');
  } else if(act<=2){
    // 短剑
    px(3, 4, 3, 3, '#8a7a4a'); // 护手
    px(3, -12, 3, 16, '#d8d4c4'); // 剑身
    px(3, -12, 1, 16, '#fff');
  } else {
    // 细剑 épée / rapier（第五幕最精美）
    px(3, 5, 4, 2, S.gold?'#e8c25a':'#9a8850'); // 护手（碗形）
    px(4, 5, 2, 3, S.gold?'#e8c25a':'#8a7a4a');
    px(4, -20, 2, 25, '#e6e2d4'); // 细长剑身
    px(4, -20, 1, 25, '#ffffff');
    if(o.atk){ // 挥击残影
      ctx.strokeStyle=S.gold?'rgba(232,194,90,0.6)':'rgba(220,220,240,0.5)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,0,24,-1.2,-1.2+atkArc); ctx.stroke();
    }
  }
  ctx.restore();

  // 拉弓姿态（远程，act>=2 拾取后）
  if(o.ranged && hasBow){
    ctx.save(); ctx.translate(shX+2, shY+2);
    ctx.strokeStyle='#6a4a2a'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(8,4,10,-1.1,1.1); ctx.stroke();
    ctx.strokeStyle='rgba(200,220,255,0.7)'; ctx.beginPath(); ctx.moveTo(8+10*Math.cos(-1.1),4+10*Math.sin(-1.1)); ctx.lineTo(3,4); ctx.lineTo(8+10*Math.cos(1.1),4+10*Math.sin(1.1)); ctx.stroke();
    // 亡魂之弓幽光
    ctx.fillStyle='rgba(150,120,220,0.5)'; ctx.beginPath(); ctx.arc(10,4,3,0,6.283); ctx.fill();
    ctx.restore();
  }
}

// 全身立绘（过场用，放大版，居中于给定屏幕坐标）
function drawHamletPortrait(sx, sy, scale, act){
  ctx.save();
  ctx.translate(sx, sy); ctx.scale(scale, scale);
  drawHamlet(0,0,1,{type:'idle',t:frame*0.5},act);
  ctx.restore();
}

/* -------------------------------------------------------------------------
   9. 敌人 / 随从 / Boss 绘制
   ------------------------------------------------------------------------- */
function drawEnemy(e){
  const cx=e.x+e.w/2, cy=e.y+e.h, f=e.facing;
  // 死亡淡出
  const alpha = e.dying? clamp(e.deathT/26,0,1) : 1;
  ctx.save(); ctx.globalAlpha=alpha;
  // 影子
  if(!e.dying){ ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cx,cy,e.w*0.5,3,0,0,6.283); ctx.fill(); }
  ctx.translate(cx,cy); ctx.scale(f,1);
  // 受击闪白
  const white = e.hitFlash>0;
  const t=frame + e.seed;
  if(e.type==='patrol') drawPatrol(e,t,white);
  else if(e.type==='archer') drawArcher(e,t,white);
  else if(e.type==='shield') drawShield(e,t,white);
  else if(e.type==='skeleton') drawSkeleton(e,t,white);
  else if(e.type==='elite') drawElite(e,t,white);
  ctx.restore();
  // 敌人小血条
  if(!e.dying && e.hp<e.maxHp){
    const bw=e.w, bx=e.x, by=e.y-6;
    // 用世界坐标画（在世界变换内调用），这里改由外部；简单画
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(cx-bw/2, by, bw,3);
    ctx.fillStyle= e.elite?'#ff9b5a':'#e23b3b'; ctx.fillRect(cx-bw/2, by, bw*(e.hp/e.maxHp),3);
  }
}
function tint(c,white){ return white?'#ffffff':c; }

function drawPatrol(e,t,w){ // 巡逻兵：戴盔近战守卫
  const H=e.h;
  const legS = e.vx!==0? Math.sin(t*0.3)*3:0;
  px(-7+legS,-14,5,14,tint('#3a2f2a',w)); px(2-legS,-14,5,14,tint('#2a221e',w));
  px(-8,-14,3,4,'#1a1410');px(3,-14,3,4,'#1a1410');
  // 躯干 铠甲
  px(-8,-H+8,16,20,tint('#5a4a3a',w));
  px(5,-H+8,3,20,tint('#6a5a48',w));
  px(-8,-H+8,2,20,tint('#3a2f26',w));
  // 腰带
  px(-8,-16,16,3,tint('#2a2018',w));
  // 头盔
  px(-6,-H,12,10,tint('#7a6a52',w));
  px(-6,-H,12,3,tint('#3a3020',w));
  px(-2,-H+4,4,2,tint('#1a1410',w)); // 面罩缝
  // 剑
  px(6,-H+12,3,3,'#8a7a4a'); px(7,-H-2,2,16,tint('#c8c4b4',w));
  if(e.atkT>0){ ctx.strokeStyle='rgba(220,220,200,0.5)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(6,-H+14,16,-1,0.6);ctx.stroke(); }
}
function drawArcher(e,t,w){ // 弓箭手：轻甲远程
  const H=e.h;
  px(-6,-13,5,13,tint('#2a3a2a',w)); px(1,-13,5,13,tint('#1e2e1e',w));
  px(-7,-13,3,3,'#141a10');px(1,-13,3,3,'#141a10');
  px(-7,-H+7,14,18,tint('#3a5a3a',w));
  px(4,-H+7,3,18,tint('#4a6a4a',w));
  // 兜帽
  px(-6,-H,12,9,tint('#243824',w));
  px(-6,-H+8,12,2,tint('#1a2a1a',w));
  px(-3,-H+4,2,2,tint('#e8dcc0',w));px(1,-H+4,2,2,tint('#e8dcc0',w));
  // 弓
  ctx.strokeStyle=tint('#7a5a2a',w);ctx.lineWidth=2;ctx.beginPath();ctx.arc(9,-H+13,11,-1.2,1.2);ctx.stroke();
  ctx.strokeStyle='rgba(230,230,230,0.6)';ctx.beginPath();ctx.moveTo(9+11*Math.cos(-1.2),-H+13+11*Math.sin(-1.2));ctx.lineTo(e.aimT>0?2:5,-H+13);ctx.lineTo(9+11*Math.cos(1.2),-H+13+11*Math.sin(1.2));ctx.stroke();
}
function drawShield(e,t,w){ // 盾牌兵：正面高防
  const H=e.h;
  px(-7,-15,6,15,tint('#40382e',w)); px(2,-15,6,15,tint('#302820',w));
  px(-8,-15,3,4,'#1a1410');px(3,-15,3,4,'#1a1410');
  px(-8,-H+8,16,22,tint('#4a4038',w));
  px(-8,-H+8,2,22,tint('#2a241e',w));
  // 头盔（全盔）
  px(-6,-H,12,11,tint('#6a5a48',w));
  px(-5,-H+4,10,2,tint('#1a1410',w));
  // 大盾（面朝前方）
  const sd = e.shieldUp? 0 : 2;
  px(7,-H+4-sd,7,26,tint(e.shieldBroken?'#5a3a2a':'#8a6a3a',w));
  px(9,-H+8-sd,3,18,tint(e.shieldBroken?'#3a2418':'#a88a4a',w));
  px(9,-H+15-sd,3,4,tint('#c9b06a',w)); // 盾徽
  if(e.shieldBroken){ px(8,-H+10,5,3,'#2a1a10'); px(10,-H+18,3,4,'#2a1a10'); }
  // 短锤
  px(-9,-H+14,3,3,'#5a4a3a');
}
function drawSkeleton(e,t,w){ // 骷髅（墓地变体）：会跳
  const H=e.h;
  const legS = e.vx!==0?Math.sin(t*0.4)*3:0;
  ctx.strokeStyle=tint('#d8d4c8',w);ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(-3,0-legS*0);ctx.lineTo(-5+legS,0);ctx.moveTo(3,0);ctx.lineTo(5-legS,0);
  ctx.moveTo(-3,-14);ctx.lineTo(-5+legS,0);ctx.moveTo(3,-14);ctx.lineTo(5-legS,0);ctx.stroke();
  // 脊柱+肋
  ctx.beginPath();ctx.moveTo(0,-H+8);ctx.lineTo(0,-14);ctx.stroke();
  ctx.lineWidth=2;
  for(let i=0;i<4;i++){ ctx.beginPath();ctx.moveTo(0,-H+10+i*3);ctx.lineTo(-5,-H+9+i*3);ctx.moveTo(0,-H+10+i*3);ctx.lineTo(5,-H+9+i*3);ctx.stroke(); }
  // 头骨
  px(-5,-H,10,9,tint('#e8e2d2',w));
  px(-3,-H+3,3,3,'#1a1410');px(1,-H+3,3,3,'#1a1410'); // 眼窝
  px(-1,-H+7,2,2,'#1a1410');
  // 生锈弯刀
  px(6,-H+12,2,3,'#5a4a3a'); ctx.strokeStyle=tint('#9a8a6a',w);ctx.lineWidth=2;ctx.beginPath();ctx.arc(4,-H+2,10,-0.5,1.2);ctx.stroke();
  // 眼窝幽光
  ctx.fillStyle='rgba(120,220,180,0.6)';px(-3,-H+3,2,2,'rgba(120,220,180,0.6)');px(1,-H+3,2,2,'rgba(120,220,180,0.6)');
}
function drawElite(e,t,w){ // 精英/小Boss：更大更华丽
  const H=e.h;
  px(-9,-18,7,18,tint('#3a2030',w)); px(3,-18,7,18,tint('#2a1622',w));
  px(-10,-18,4,5,'#0a0a0e');px(4,-18,4,5,'#0a0a0e');
  // 躯干 华丽铠
  px(-11,-H+10,22,28,tint('#5a2a3a',w));
  px(7,-H+10,4,28,tint('#7a3a4a',w));
  px(-11,-H+10,3,28,tint('#3a1a26',w));
  px(-11,-20,22,4,tint('#c9a24a',w)); // 金腰带
  // 披风
  ctx.fillStyle=tint('#4a1020',w); ctx.beginPath();ctx.moveTo(-9,-H+12);ctx.lineTo(-16-Math.sin(t*0.1)*3,-4);ctx.lineTo(-4,-14);ctx.closePath();ctx.fill();
  // 头盔带角
  px(-8,-H,16,13,tint('#6a3a4a',w));
  px(-9,-H-4,4,6,tint('#c9a24a',w));px(5,-H-4,4,6,tint('#c9a24a',w)); // 角
  px(-4,-H+5,3,2,tint('#ff5a5a',w));px(2,-H+5,3,2,tint('#ff5a5a',w)); // 红眼
  // 巨剑/戟
  px(9,-H+6,4,4,'#8a7a4a'); px(10,-H-8,3,22,tint('#d0ccbc',w));
  if(e.atkT>0){ ctx.strokeStyle='rgba(255,120,120,0.5)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(9,-H+12,22,-1.2,0.8);ctx.stroke(); }
}

// 随从：奥菲莉亚（成功）或霍拉旭
function drawCompanion(c){
  const cx=c.x+c.w/2, cy=c.y+c.h, f=c.facing;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cx,cy,c.w*0.5,3,0,0,6.283); ctx.fill();
  ctx.translate(cx,cy); ctx.scale(f,1);
  const t=frame; const legS=c.vx!==0?Math.sin(t*0.35)*2.5:0;
  if(c.kind==='ophelia'){
    // 光辉裙装
    if(opheliaSaved){ ctx.save(); ctx.globalAlpha=0.3+0.15*Math.sin(frame*0.1); const g=ctx.createRadialGradient(0,-22,2,0,-22,26); g.addColorStop(0,'rgba(180,220,255,0.5)');g.addColorStop(1,'rgba(180,220,255,0)'); ctx.fillStyle=g; ctx.fillRect(-26,-48,52,48); ctx.restore(); }
    // 裙摆
    ctx.fillStyle='#8ab8d8'; ctx.beginPath();ctx.moveTo(-8,-16);ctx.lineTo(8,-16);ctx.lineTo(11,0);ctx.lineTo(-11,0);ctx.closePath();ctx.fill();
    px(-6,-30,12,16,'#a8d0e8');
    px(4,-30,2,16,'#c0e0f0');
    // 头发（长发）
    px(-6,-42,12,10,'#c9a24a'); px(-8,-40,3,14,'#c9a24a'); px(5,-40,3,14,'#c9a24a');
    px(-5,-40,10,8,'#f0d8b0'); // 脸
    px(-3,-36,2,2,'#3a2a20');px(1,-36,2,2,'#3a2a20');
    // 手（可持花或助攻光）
    px(6,-26,3,3,'#f0d8b0');
    if(c.atkT>0){ ctx.fillStyle='rgba(180,220,255,0.7)'; ctx.beginPath();ctx.arc(12,-24,5,0,6.283);ctx.fill(); }
  } else {
    // 霍拉旭：学者装，稳重
    px(-7+legS,-14,5,14,'#2a2430'); px(2-legS,-14,5,14,'#1e1a26');
    px(-7,-32,14,18,'#3a3448'); px(4,-32,3,18,'#4a4258');
    px(-7,-32,14,3,'#5a4a2a'); // 学者披肩
    px(-5,-42,10,10,'#c9a98c'); // 脸
    px(-5,-45,10,5,'#4a3a2a'); // 短发
    px(-3,-38,2,2,'#2a2018');px(1,-38,2,2,'#2a2018');
    // 匕首助攻
    px(6,-26,7,2,'#c8c4b4');
    if(c.atkT>0){ ctx.strokeStyle='rgba(220,220,200,0.5)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(4,-24,12,-0.5,0.8);ctx.stroke(); }
  }
  ctx.restore();
}

// Boss 克劳迪奥
function drawBoss(b){
  const cx=b.x+b.w/2, cy=b.y+b.h, f=b.facing;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(cx,cy,b.w*0.5,5,0,0,6.283); ctx.fill();
  // 阶段光环
  const phaseColor = b.phase===1?'rgba(200,170,90,':(b.phase===2?'rgba(200,90,90,':'rgba(255,40,40,');
  ctx.save(); ctx.globalAlpha=0.35+0.2*Math.sin(frame*0.1); const g=ctx.createRadialGradient(cx,cy-b.h*0.5,4,cx,cy-b.h*0.5,b.h); g.addColorStop(0,phaseColor+'0.5)'); g.addColorStop(1,phaseColor+'0)'); ctx.fillStyle=g; ctx.fillRect(cx-b.w,cy-b.h*1.5,b.w*2,b.h*1.6); ctx.restore();
  ctx.translate(cx,cy); ctx.scale(f,1);
  const w=b.hitFlash>0; const t=frame;
  const H=b.h;
  // 王袍下摆
  ctx.fillStyle=tint(b.phase>=3?'#3a0a0a':'#4a1428',w);
  ctx.beginPath();ctx.moveTo(-14,-24);ctx.lineTo(14,-24);ctx.lineTo(20,0);ctx.lineTo(-20,0);ctx.closePath();ctx.fill();
  // 腿
  px(-10,-26,8,26,tint('#2a1420',w)); px(3,-26,8,26,tint('#1e0e18',w));
  // 躯干
  px(-14,-H+16,28,34,tint(b.phase>=3?'#5a1414':'#5a1a2e',w));
  px(9,-H+16,5,34,tint(b.phase>=3?'#7a2020':'#7a2a3e',w));
  px(-14,-H+16,4,34,tint('#3a0e1a',w));
  // 金饰王袍
  px(-14,-H+16,28,4,tint('#c9a24a',w));
  px(-2,-H+16,4,32,tint('#c9a24a',w));
  // 披风
  ctx.fillStyle=tint(b.phase>=3?'#5a0a0a':'#6a1428',w); ctx.beginPath();ctx.moveTo(-12,-H+18);ctx.lineTo(-24-Math.sin(t*0.08)*4,-2);ctx.lineTo(-6,-20);ctx.closePath();ctx.fill();
  // 头 + 王冠
  px(-9,-H,18,16,tint('#b89878',w));
  px(-9,-H,18,3,tint('#8a6a4a',w)); // 发际
  // 王冠
  ctx.fillStyle=tint('#e8c25a',w);
  px(-10,-H-6,20,5,tint('#e8c25a',w));
  for(let i=0;i<4;i++) px(-9+i*6,-H-10,3,5,tint('#e8c25a',w));
  px(-9+2,-H-9,2,2,'#e23b3b');px(-9+14,-H-9,2,2,'#7fd4ee'); // 宝石
  // 面部：阴狠
  px(-6,-H+6,3,1,'#2a1810');px(2,-H+6,3,1,'#2a1810'); // 眉
  px(-5,-H+7,3,2,tint(b.phase>=3?'#ff3030':'#e8dcc0',w));px(2,-H+7,3,2,tint(b.phase>=3?'#ff3030':'#e8dcc0',w));
  px(-3,-H+7,1,2,'#1a1410');px(3,-H+7,1,2,'#1a1410');
  px(-4,-H+12,8,1,'#3a1818'); // 冷笑
  // 胡须
  px(-5,-H+13,10,3,tint('#3a2a20',w));
  // 武器：权杖剑
  px(12,-H+10,5,5,tint('#c9a24a',w));
  px(13,-H-12,3,26,tint('#d8d4c4',w));
  px(12,-H-14,5,4,tint('#e8c25a',w));
  if(b.atkT>0){ ctx.strokeStyle=phaseColor+'0.6)';ctx.lineWidth=4;ctx.beginPath();ctx.arc(12,-H+14,28,-1.2,0.9);ctx.stroke(); }
  ctx.restore();
}

/* -------------------------------------------------------------------------
   10. 世界物件绘制（平台/地形/机关/箱子/宝箱/检查点/触发区/拾取/终点）
   ------------------------------------------------------------------------- */
function drawPlatform(p){
  const A=ACTS[actIndex];
  let top=A.groundTop, body=A.ground;
  if(darkMode){ top='#2a2033'; body='#180f20'; }
  if(p.type==='plat'){ // 悬浮平台
    ctx.fillStyle=body; ctx.fillRect(p.x,p.y,p.w,p.h);
    ctx.fillStyle=top; ctx.fillRect(p.x,p.y,p.w,4);
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(p.x,p.y+p.h-3,p.w,3);
    // 边缘砖纹
    ctx.fillStyle='rgba(0,0,0,0.15)';
    for(let i=0;i<p.w;i+=24) ctx.fillRect(p.x+i,p.y+4,1,p.h-4);
  } else { // 地面
    ctx.fillStyle=body; ctx.fillRect(p.x,p.y,p.w,p.h);
    ctx.fillStyle=top; ctx.fillRect(p.x,p.y,p.w,6);
    ctx.fillStyle=darkMode?'#3a2a44':A.accent; ctx.globalAlpha=0.25; ctx.fillRect(p.x,p.y,p.w,2); ctx.globalAlpha=1;
    ctx.fillStyle='rgba(0,0,0,0.2)';
    for(let i=0;i<p.w;i+=32){ ctx.fillRect(p.x+i,p.y+6,1,p.h-6); }
    for(let j=6;j<p.h;j+=28){ ctx.fillRect(p.x,p.y+j,p.w,1); }
  }
}
function drawHazard(hz){
  if(hz.type==='water'){
    const grd=ctx.createLinearGradient(0,hz.y,0,hz.y+hz.h);
    grd.addColorStop(0, darkMode?'rgba(40,30,70,0.85)':'rgba(60,120,160,0.75)');
    grd.addColorStop(1, darkMode?'rgba(10,8,24,0.95)':'rgba(20,50,80,0.95)');
    ctx.fillStyle=grd; ctx.fillRect(hz.x,hz.y,hz.w,hz.h);
    // 波纹
    ctx.strokeStyle= darkMode?'rgba(150,120,200,0.4)':'rgba(200,235,255,0.5)'; ctx.lineWidth=1.5;
    for(let i=0;i<hz.w;i+=40){ const wy=hz.y+3+Math.sin(frame*0.05+i*0.1)*2; ctx.beginPath();ctx.moveTo(hz.x+i,wy);ctx.lineTo(hz.x+i+20,wy);ctx.stroke(); }
  } else if(hz.type==='spike'){
    ctx.fillStyle='#6a6470';
    for(let i=hz.x;i<hz.x+hz.w;i+=14){ ctx.beginPath(); ctx.moveTo(i,hz.y+hz.h); ctx.lineTo(i+7,hz.y); ctx.lineTo(i+14,hz.y+hz.h); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle='#c9c4d0'; for(let i=hz.x;i<hz.x+hz.w;i+=14){ ctx.beginPath(); ctx.moveTo(i+5,hz.y+hz.h);ctx.lineTo(i+7,hz.y);ctx.lineTo(i+9,hz.y+hz.h);ctx.closePath();ctx.fill(); }
  } else if(hz.type==='poison'){
    const grd=ctx.createLinearGradient(0,hz.y,0,hz.y+hz.h);
    grd.addColorStop(0,'rgba(120,200,80,0.7)'); grd.addColorStop(1,'rgba(40,90,30,0.9)');
    ctx.fillStyle=grd; ctx.fillRect(hz.x,hz.y,hz.w,hz.h);
    ctx.fillStyle='rgba(180,255,120,0.5)';
    for(let i=0;i<hz.w;i+=30){ const bx=hz.x+i+((frame*0.5+i)%hz.w? (Math.sin(frame*0.06+i)*4):0); const by=hz.y+((frame*0.6+i*7)%hz.h); ctx.beginPath();ctx.arc(hz.x+i+10,hz.y+hz.h-((frame*0.5+i*13)%hz.h),3,0,6.283);ctx.fill(); }
  }
}
function drawBreakable(bk){
  if(bk.dead) return;
  const shake = bk.hitT>0? Math.sin(bk.hitT*2)*2:0;
  ctx.save(); ctx.translate(shake,0);
  if(bk.kind==='coffin'){
    ctx.fillStyle='#4a3826'; ctx.fillRect(bk.x,bk.y,bk.w,bk.h);
    ctx.fillStyle='#5e4a30'; ctx.fillRect(bk.x+2,bk.y+2,bk.w-4,4);
    ctx.fillStyle='#2a2018'; ctx.fillRect(bk.x+bk.w/2-2,bk.y+6,4,bk.h-12);
    ctx.fillRect(bk.x+4,bk.y+bk.h/2-2,bk.w-8,4);
    ctx.fillStyle='#c9b06a'; ctx.fillRect(bk.x+bk.w/2-4,bk.y+bk.h/2-4,8,8);
  } else {
    ctx.fillStyle='#6a4a2a'; ctx.fillRect(bk.x,bk.y,bk.w,bk.h);
    ctx.fillStyle='#8a6238'; ctx.fillRect(bk.x+2,bk.y+2,bk.w-4,bk.h-4);
    ctx.fillStyle='#4a3016'; ctx.fillRect(bk.x,bk.y+bk.h/2-1,bk.w,2); ctx.fillRect(bk.x+bk.w/2-1,bk.y,2,bk.h);
    // 铁角
    ctx.fillStyle='#3a2a1a'; ctx.fillRect(bk.x,bk.y,4,4); ctx.fillRect(bk.x+bk.w-4,bk.y,4,4); ctx.fillRect(bk.x,bk.y+bk.h-4,4,4); ctx.fillRect(bk.x+bk.w-4,bk.y+bk.h-4,4,4);
  }
  ctx.restore();
}
function drawChest(ch){
  if(ch.taken){ return; }
  const yb = ch.open? -2:0;
  ctx.fillStyle='#5a3a1a'; ctx.fillRect(ch.x,ch.y+4,ch.w,ch.h-4);
  ctx.fillStyle='#7a5228'; ctx.fillRect(ch.x+2,ch.y+6,ch.w-4,ch.h-8);
  ctx.fillStyle='#c9a24a'; ctx.fillRect(ch.x,ch.y+yb,ch.w,6); // 盖
  ctx.fillStyle='#e8c25a'; ctx.fillRect(ch.x+ch.w/2-3,ch.y+ch.h-8,6,5); // 锁
  if(!ch.open){ ctx.fillStyle='rgba(232,194,90,'+(0.3+0.3*Math.sin(frame*0.15))+')'; ctx.fillRect(ch.x-2,ch.y-2,ch.w+4,ch.h+4); }
}
function drawCheckpoint(cp){
  const lit = cp.active;
  // 旗杆
  ctx.fillStyle='#3a3348'; ctx.fillRect(cp.x-1,cp.y-46,3,46);
  // 旗
  ctx.fillStyle= lit? ACTS[actIndex].accent : '#5a5464';
  const wave=Math.sin(frame*0.1)*3;
  ctx.beginPath();ctx.moveTo(cp.x+2,cp.y-46);ctx.lineTo(cp.x+22+wave,cp.y-40);ctx.lineTo(cp.x+2,cp.y-32);ctx.closePath();ctx.fill();
  if(lit){ ctx.fillStyle='rgba(232,194,90,'+(0.2+0.2*Math.sin(frame*0.12))+')'; ctx.beginPath();ctx.arc(cp.x,cp.y-2,16,0,6.283);ctx.fill(); }
}
function drawTrigger(tr){
  if(tr.fired && !tr.persist) return;
  if(tr.type==='ghost'){
    const a=0.15+0.15*Math.sin(frame*0.08);
    ctx.fillStyle='rgba(150,220,255,'+a+')'; ctx.fillRect(tr.x,tr.y,tr.w,tr.h);
    ctx.strokeStyle='rgba(180,230,255,0.5)';ctx.lineWidth=1;ctx.strokeRect(tr.x,tr.y,tr.w,tr.h);
    // 幽灵符文
    ctx.fillStyle='rgba(200,240,255,0.6)'; ctx.font='16px serif'; ctx.textAlign='center';
    ctx.fillText('✟', tr.x+tr.w/2, tr.y+tr.h/2);
  } else if(tr.type==='intel'){
    if(tr.fired) return;
    const a=0.2+0.2*Math.sin(frame*0.1+tr.x);
    ctx.fillStyle='rgba(216,184,240,'+a+')'; ctx.fillRect(tr.x,tr.y,tr.w,tr.h);
    ctx.fillStyle='rgba(240,220,255,0.8)'; ctx.font='14px serif'; ctx.textAlign='center';
    ctx.fillText('📜', tr.x+tr.w/2, tr.y+tr.h*0.6);
  } else if(tr.type==='yorick'){
    // 约克里克头骨
    ctx.fillStyle='#e8e2d2'; ctx.beginPath(); ctx.arc(tr.x+tr.w/2, tr.y+tr.h-8, 10,0,6.283); ctx.fill();
    ctx.fillStyle='#1a1410'; ctx.fillRect(tr.x+tr.w/2-5,tr.y+tr.h-11,4,4); ctx.fillRect(tr.x+tr.w/2+1,tr.y+tr.h-11,4,4);
    ctx.fillRect(tr.x+tr.w/2-2,tr.y+tr.h-4,4,3);
    const a=0.15+0.15*Math.sin(frame*0.1); ctx.fillStyle='rgba(180,220,180,'+a+')'; ctx.beginPath();ctx.arc(tr.x+tr.w/2,tr.y+tr.h-8,16,0,6.283);ctx.fill();
  } else if(tr.type==='rescue'){
    // 奥菲莉亚在水中
    if(tr.fired) return;
    const oy = tr.y + Math.sin(frame*0.05)*2;
    ctx.fillStyle='#a8d0e8'; ctx.fillRect(tr.x+tr.w/2-6, oy, 12, 8);
    ctx.fillStyle='#c9a24a'; ctx.fillRect(tr.x+tr.w/2-7, oy-6, 14, 7); // 头发漂浮
    ctx.fillStyle='#f0d8b0'; ctx.fillRect(tr.x+tr.w/2-4, oy-4, 8, 5);
    // 花瓣环绕
    if(frame%12===0) spawnPetal(tr.x+tr.w/2+rand(-14,14), oy-4, '#ffd0e6');
    ctx.strokeStyle='rgba(255,255,255,0.4)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(tr.x+tr.w/2,oy+4,14+Math.sin(frame*0.1)*3,0,6.283);ctx.stroke();
  }
}
function drawBowPickup(bp){
  if(bp.taken) return;
  const yb=Math.sin(frame*0.08)*4;
  ctx.save(); ctx.translate(bp.x+bp.w/2, bp.y+bp.h/2+yb);
  ctx.fillStyle='rgba(150,120,220,'+(0.25+0.2*Math.sin(frame*0.12))+')'; ctx.beginPath();ctx.arc(0,0,22,0,6.283);ctx.fill();
  // 弓
  ctx.strokeStyle='#8a6a3a';ctx.lineWidth=3;ctx.beginPath();ctx.arc(2,0,13,-1.3,1.3);ctx.stroke();
  ctx.strokeStyle='rgba(200,180,255,0.9)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(2+13*Math.cos(-1.3),13*Math.sin(-1.3));ctx.lineTo(-6,0);ctx.lineTo(2+13*Math.cos(1.3),13*Math.sin(1.3));ctx.stroke();
  ctx.fillStyle='#c9a6ff';ctx.beginPath();ctx.arc(-2,0,3,0,6.283);ctx.fill();
  ctx.restore();
}
function drawGoal(gx, gy){
  // 终点：光门/旗
  ctx.fillStyle='#2a2440'; ctx.fillRect(gx-2, gy-90, 4, 90);
  const grd=ctx.createLinearGradient(gx-20,0,gx+20,0);
  grd.addColorStop(0,'rgba(232,194,90,0)');grd.addColorStop(0.5,'rgba(232,194,90,'+(0.3+0.2*Math.sin(frame*0.08))+')');grd.addColorStop(1,'rgba(232,194,90,0)');
  ctx.fillStyle=grd; ctx.fillRect(gx-20,gy-90,40,90);
  ctx.fillStyle=ACTS[actIndex].accent; ctx.font='12px serif'; ctx.textAlign='center'; ctx.fillText('▲ 前进', gx, gy-96);
}
function drawPickupItem(it){
  if(it.taken) return;
  const yb=Math.sin(frame*0.1+it.x)*3;
  ctx.save(); ctx.translate(it.x+it.w/2,it.y+it.h/2+yb);
  if(it.kind==='heart'){
    ctx.fillStyle='#e23b3b'; ctx.beginPath();
    ctx.moveTo(0,3); ctx.bezierCurveTo(-6,-4,-9,2,0,8); ctx.bezierCurveTo(9,2,6,-4,0,3); ctx.fill();
    ctx.fillStyle='rgba(255,120,120,0.4)';ctx.beginPath();ctx.arc(0,2,10,0,6.283);ctx.fill();
  } else if(it.kind==='ammo'){
    ctx.fillStyle='#c9a6ff'; ctx.fillRect(-1,-6,2,12); ctx.beginPath();ctx.moveTo(-4,-6);ctx.lineTo(0,-10);ctx.lineTo(4,-6);ctx.closePath();ctx.fill();
    ctx.fillStyle='#e6d0ff'; ctx.fillRect(-3,5,6,2);
  } else { // coin/score
    ctx.fillStyle='#e8c25a'; ctx.beginPath();ctx.arc(0,0,6,0,6.283);ctx.fill();
    ctx.fillStyle='#fff0c0'; ctx.beginPath();ctx.arc(-1.5,-1.5,2,0,6.283);ctx.fill();
  }
  ctx.restore();
}

/* -------------------------------------------------------------------------
   11. 关卡生成
   ------------------------------------------------------------------------- */
const GROUND_TOP = 600;         // 地面顶部世界 Y
const LEVEL_H = 760;            // 世界高度
const PLAYER_W = 22, PLAYER_H = 44;

let level = null;               // 当前关卡数据
// 实时实体数组
let player=null, companion=null, boss=null;
let enemies=[], projectiles=[], rocks=[], texts=[];

const ENEMY_BASE = {
  patrol:{ w:22,h:34, hp:3, speed:1.0, dmg:8, score:100 },
  archer:{ w:22,h:34, hp:2, speed:0.7, dmg:7, score:130 },
  shield:{ w:26,h:38, hp:5, speed:0.7, dmg:9, score:160 },
  skeleton:{ w:20,h:34, hp:2, speed:1.2, dmg:7, score:110 },
  elite:{ w:32,h:50, hp:16, speed:0.9, dmg:14, score:400 }
};

function makeEnemy(type, x, y, opts){
  const b=ENEMY_BASE[type];
  const hpScale = 1 + actIndex*0.3;
  const e = {
    type, x, y:y-b.h, w:b.w, h:b.h, vx:0, vy:0,
    hp: Math.round(b.hp*hpScale) + (opts&&opts.hpBonus||0),
    maxHp:0, speed:b.speed*(1+actIndex*0.05), dmg:b.dmg+actIndex*2, score:b.score,
    facing:-1, onGround:false, hitFlash:0, dying:false, deathT:0, invuln:0,
    atkT:0, atkCd:0, aimT:0, shootCd:randi(60,120), state:'patrol', seed:randi(0,999),
    patrolMin:x-rand(60,140), patrolMax:x+rand(60,140), jumpCd:0,
    shieldUp:type==='shield', shieldBroken:false, elite:type==='elite'
  };
  e.maxHp=e.hp;
  if(opts&&opts.patrolMin!==undefined){ e.patrolMin=opts.patrolMin; e.patrolMax=opts.patrolMax; }
  return e;
}

// 生成一段标准关卡地形+内容
function buildStandard(cfg){
  const rng = mulberry32(cfg.seed);
  const width = cfg.width;
  const lv = {
    width, height:LEVEL_H, groundTop:GROUND_TOP,
    platforms:[], hazards:[], movers:[], breakables:[], chests:[], enemySpawns:[],
    checkpoints:[], triggers:[], pickups:[], rockEmitters:[],
    segments:cfg.segments||[], goalX:width-140, playerStart:{x:80,y:GROUND_TOP},
    bg:null, isBoss:false
  };
  // 起始安全地面
  let cx=0;
  const segLen = width/3;
  while(cx < width-260){
    // 决定是否挖坑（第一段少，后段多）
    const seg = cx/segLen; // 0..3
    const pitChance = (cfg.pitBase||0.12) + seg*0.05;
    const makePit = cx>360 && cx<width-360 && rng()<pitChance;
    if(makePit){
      const pitW = 70 + rng()*(cfg.maxPit||90);
      // 坑底放危险
      const hzType = cfg.pitHazard || (rng()<0.5?'spike':'poison');
      lv.hazards.push({x:cx, y:GROUND_TOP+30, w:pitW, h:LEVEL_H-GROUND_TOP-30, type:hzType==='void'?'water':hzType});
      // 若坑较宽，中间放跳板
      if(pitW>110){ lv.platforms.push({x:cx+pitW/2-30,y:GROUND_TOP-70,w:60,h:14,type:'plat'}); }
      cx += pitW;
    } else {
      const gw = 200 + rng()*260;
      lv.platforms.push({x:cx, y:GROUND_TOP, w:gw+4, h:LEVEL_H-GROUND_TOP, type:'ground'});
      // 地面上的内容
      const gx = cx, gwid=gw;
      // 破坏箱
      if(rng()<0.5 && cx>300){
        const bx=gx+rand(40,gwid-60);
        lv.breakables.push({x:bx, y:GROUND_TOP-26, w:26, h:26, kind:cfg.coffin?'coffin':'box', hp:2, hitT:0, dead:false, drop: rng()<0.4?'heart':(rng()<0.6?'ammo':'coin')});
      }
      // 敌人
      if(cx>420 && rng()<(cfg.enemyChance||0.55)){
        const type = pickEnemyType(cfg, rng, seg);
        lv.enemySpawns.push({type, x:gx+gwid*0.5, y:GROUND_TOP});
      }
      cx += gw + (10+rng()*30);
    }
    // 悬浮平台层（探索/隐藏）
    if(rng()<0.6){
      const py = GROUND_TOP - (90 + rng()*180);
      const pw = 60 + rng()*80;
      const ppx = clamp(cx - 120 + rng()*80, 40, width-120);
      lv.platforms.push({x:ppx, y:py, w:pw, h:14, type:'plat'});
      // 平台上可能有敌人/箱子/金币
      const r=rng();
      if(r<0.3){ lv.enemySpawns.push({type: rng()<0.5?'archer':'patrol', x:ppx+pw/2, y:py}); }
      else if(r<0.55){ lv.pickups.push({x:ppx+pw/2-6,y:py-18,w:12,h:12,kind:'coin',taken:false}); }
      // 更高的隐藏平台 + 宝箱
      if(rng()<0.22){
        const hy=py-(70+rng()*40);
        lv.platforms.push({x:ppx+20,y:hy,w:56,h:12,type:'plat'});
        lv.chests.push({x:ppx+34,y:hy-24,w:28,h:22,open:false,taken:false,reward: rng()<0.5?'ammo':'score'});
        lv.secretCount=(lv.secretCount||0)+1;
      }
    }
    // 移动平台
    if(rng()<0.14 && cx>600 && cx<width-400){
      lv.movers.push({x:cx-60, y:GROUND_TOP-120, w:70, h:14, type:'plat',
        axis: rng()<0.5?'x':'y', range:60+rng()*80, speed:0.6+rng()*0.6, phase:rng()*6.28, baseX:cx-60, baseY:GROUND_TOP-120});
    }
  }
  // 收尾终点地面
  lv.platforms.push({x:width-260, y:GROUND_TOP, w:260, h:LEVEL_H-GROUND_TOP, type:'ground'});
  // 检查点（每段一个）
  lv.checkpoints.push({x:segLen*1, y:GROUND_TOP, active:false});
  lv.checkpoints.push({x:segLen*2, y:GROUND_TOP, active:false});
  // 段落标签
  if(!lv.segments.length){
    lv.segments=[{x:0,name:'入口区'},{x:segLen,name:'中段挑战'},{x:segLen*2,name:'关卡高潮'}];
  }
  return lv;
}
function pickEnemyType(cfg, rng, seg){
  const pool = cfg.enemies || ['patrol','archer','shield'];
  // 后段更容易出现盾兵/精英
  const r=rng();
  if(seg>=1.8 && cfg.elite && r<0.12) return 'elite';
  return pool[(rng()*pool.length)|0];
}

/* --------- 各幕构建 --------- */
function buildAct(idx){
  actIndex=idx;
  let lv;
  if(idx===0){ // 第一幕 城堡
    lv=buildStandard({seed:101, width:5200, enemies:['patrol','archer','shield'], enemyChance:0.5, pitBase:0.1, pitHazard:'spike'});
    // 鬼魂触发区（关卡高潮前）
    lv.triggers.push({x:lv.width-900, y:GROUND_TOP-120, w:80, h:120, type:'ghost', fired:false, key:'ghost'});
    lv.segments=[{x:0,name:'城墙入口'},{x:lv.width/3,name:'守卫哨塔'},{x:lv.width*2/3,name:'鬼魂之墙'}];
  } else if(idx===1){ // 第二幕 宫廷
    lv=buildStandard({seed:202, width:5600, enemies:['patrol','archer','shield'], enemyChance:0.55, pitBase:0.12, pitHazard:'spike'});
    // 情报收集区 x3
    const spots=[lv.width*0.25, lv.width*0.5, lv.width*0.72];
    spots.forEach((sx,i)=> lv.triggers.push({x:sx, y:GROUND_TOP-40, w:36, h:40, type:'intel', fired:false, key:'intel'+i}) );
    lv.intelTotal=3; lv.intelGot=0;
    lv.segments=[{x:0,name:'宫廷回廊'},{x:lv.width/3,name:'密探周旋'},{x:lv.width*2/3,name:'戏中戏台'}];
  } else if(idx===2){ // 第三幕 剧院/内室
    lv=buildStandard({seed:303, width:6000, enemies:['patrol','archer','shield'], enemyChance:0.6, pitBase:0.14, pitHazard:'poison', elite:true});
    // 亡魂之弓拾取（本幕中段）
    lv.bowPickup={x:lv.width*0.34, y:GROUND_TOP-120, w:34, h:34, taken:false};
    lv.platforms.push({x:lv.width*0.34-30, y:GROUND_TOP-70, w:90, h:14, type:'plat'});
    // 戏中戏触发（本幕高潮）
    lv.triggers.push({x:lv.width*0.62, y:GROUND_TOP-140, w:70, h:140, type:'ghost', fired:false, key:'play'});
    // 波洛涅斯误杀触发（近终点）
    lv.triggers.push({x:lv.width-1000, y:GROUND_TOP-120, w:60, h:120, type:'ghost', fired:false, key:'polonius'});
    lv.segments=[{x:0,name:'内室长廊'},{x:lv.width/3,name:'亡魂之弓'},{x:lv.width*2/3,name:'戏中戏'}];
  } else if(idx===3){ // 第四幕 湖畔（限时救援）
    lv=buildStandard({seed:404, width:5200, enemies:['patrol','archer','skeleton'], enemyChance:0.5, pitBase:0.28, maxPit:120, pitHazard:'void'});
    // 大片水域危险
    lv.water=true;
    // 奥菲莉亚在终点水中
    lv.rescue={x:lv.width-360, y:GROUND_TOP-10, w:40, h:40, fired:false, saved:false};
    lv.triggers.push({x:lv.width-360, y:GROUND_TOP-30, w:40, h:40, type:'rescue', fired:false, key:'rescue'});
    lv.timeLimit=70; lv.timeLeft=70;
    lv.segments=[{x:0,name:'湖畔小径'},{x:lv.width/3,name:'湍流跳跃'},{x:lv.width*2/3,name:'奥菲莉亚！'}];
    lv.goalX=lv.width-330;
  } else { // 第五幕 墓地/宫廷走廊/王座厅（最终关，内容+50%）
    lv=buildAct5();
  }
  lv.secretTotal = lv.chests.length;
  return lv;
}

function buildAct5(){
  // 三段独立区域拼接，总宽 ≥9000
  const rng=mulberry32(505);
  const segW=3100;
  const width=segW*3+300;
  const lv={ width, height:LEVEL_H, groundTop:GROUND_TOP,
    platforms:[], hazards:[], movers:[], breakables:[], chests:[], enemySpawns:[],
    checkpoints:[], triggers:[], pickups:[], rockEmitters:[],
    segments:[{x:0,name:'墓地'},{x:segW,name:'宫廷走廊'},{x:segW*2,name:'王座大厅'}],
    goalX:width-260, playerStart:{x:80,y:GROUND_TOP}, isBoss:true };

  // ---- 墓地段（0..segW）：骷髅/巡逻/弓箭 + 塌陷墓穴 + 落石 ----
  buildGroundRange(lv,rng,0,segW,{enemies:['skeleton','patrol','archer'],chance:0.6,coffin:true,pitHazard:'spike',pitBase:0.16});
  lv.triggers.push({x:segW*0.5, y:GROUND_TOP-40, w:40, h:40, type:'yorick', fired:false, key:'yorick'});
  lv.rockEmitters.push({x:segW*0.7, y:120, interval:110, t:0, range:260});
  lv.rockEmitters.push({x:segW*0.85, y:120, interval:90, t:40, range:260});
  lv.checkpoints.push({x:segW-200, y:GROUND_TOP, active:false});

  // ---- 宫廷走廊段（segW..2segW）：盾兵+精英连战 + 毒池陷阱 ----
  buildGroundRange(lv,rng,segW,segW*2,{enemies:['shield','patrol','archer'],chance:0.62,pitHazard:'poison',pitBase:0.2,elite:true,poisonExtra:true});
  // 精英护卫连续战
  lv.enemySpawns.push({type:'elite',x:segW+segW*0.55,y:GROUND_TOP});
  lv.enemySpawns.push({type:'shield',x:segW+segW*0.6,y:GROUND_TOP});
  lv.enemySpawns.push({type:'shield',x:segW+segW*0.66,y:GROUND_TOP});
  lv.checkpoints.push({x:segW*2-220, y:GROUND_TOP, active:false, bossGate:true});

  // ---- 王座大厅段（2segW..end）：Boss ----
  // 平整战斗场地
  lv.platforms.push({x:segW*2, y:GROUND_TOP, w:width-segW*2, h:LEVEL_H-GROUND_TOP, type:'ground'});
  // 侧翼小平台
  lv.platforms.push({x:segW*2+260, y:GROUND_TOP-140, w:90, h:14, type:'plat'});
  lv.platforms.push({x:width-460, y:GROUND_TOP-140, w:90, h:14, type:'plat'});
  lv.bossArena={x:segW*2+120, y:GROUND_TOP};
  lv.bossTrigger={x:segW*2+150, w:120};

  lv.secretTotal=lv.chests.length;
  return lv;
}

// 在 [x0,x1) 范围内铺设地面段与内容（供第五幕分段使用）
function buildGroundRange(lv,rng,x0,x1,cfg){
  let cx=x0;
  while(cx<x1-200){
    const seg=(cx-x0)/(x1-x0)*3;
    const makePit = cx>x0+300 && cx<x1-300 && rng()<(cfg.pitBase||0.14);
    if(makePit){
      const pitW=70+rng()*80;
      lv.hazards.push({x:cx,y:GROUND_TOP+30,w:pitW,h:LEVEL_H-GROUND_TOP-30,type:cfg.pitHazard==='void'?'water':cfg.pitHazard||'spike'});
      if(pitW>110) lv.platforms.push({x:cx+pitW/2-28,y:GROUND_TOP-70,w:56,h:14,type:'plat'});
      cx+=pitW;
    } else {
      const gw=200+rng()*220;
      lv.platforms.push({x:cx,y:GROUND_TOP,w:gw+4,h:LEVEL_H-GROUND_TOP,type:'ground'});
      if(rng()<0.5){ lv.breakables.push({x:cx+rand(40,gw-60),y:GROUND_TOP-26,w:26,h:26,kind:cfg.coffin?'coffin':'box',hp:2,hitT:0,dead:false,drop:rng()<0.4?'heart':(rng()<0.6?'ammo':'coin')}); }
      if(cx>x0+400 && rng()<(cfg.chance||0.55)){ lv.enemySpawns.push({type:pickEnemyType(cfg,rng,seg),x:cx+gw*0.5,y:GROUND_TOP}); }
      cx+=gw+(10+rng()*24);
    }
    if(rng()<0.55){
      const py=GROUND_TOP-(90+rng()*160), pw=60+rng()*70, ppx=clamp(cx-120+rng()*70,x0+40,x1-120);
      lv.platforms.push({x:ppx,y:py,w:pw,h:14,type:'plat'});
      const r=rng();
      if(r<0.3) lv.enemySpawns.push({type:rng()<0.5?'archer':'patrol',x:ppx+pw/2,y:py});
      else if(r<0.55) lv.pickups.push({x:ppx+pw/2-6,y:py-18,w:12,h:12,kind:'coin',taken:false});
      if(rng()<0.2){ const hy=py-(70+rng()*40); lv.platforms.push({x:ppx+20,y:hy,w:52,h:12,type:'plat'}); lv.chests.push({x:ppx+32,y:hy-24,w:28,h:22,open:false,taken:false,reward:rng()<0.5?'ammo':'score'}); }
    }
    if(cfg.poisonExtra && rng()<0.12 && cx>x0+500){
      lv.hazards.push({x:cx-60,y:GROUND_TOP-4,w:80,h:10,type:'poison'});
    }
  }
}

/* -------------------------------------------------------------------------
   12. 剧情过场系统（打字机 + 全身立绘）
   ------------------------------------------------------------------------- */
// 立绘小画布（纯 Canvas 绘制，插入到过场遮罩中）
let portraitCanvas=null, portraitCtx=null;
(function initPortrait(){
  portraitCanvas=document.createElement('canvas');
  portraitCanvas.width=180; portraitCanvas.height=240;
  portraitCanvas.style.cssText='position:absolute;right:5%;top:50%;transform:translateY(-50%);width:150px;height:200px;image-rendering:pixelated;filter:drop-shadow(0 0 18px rgba(232,194,90,.25));pointer-events:none;opacity:.92';
  dom.storyScreen.appendChild(portraitCanvas);
})();
function renderPortrait(act){
  const c=portraitCtx||(portraitCtx=portraitCanvas.getContext('2d'));
  c.clearRect(0,0,180,240);
  c.imageSmoothingEnabled=false;
  // 背景光晕
  const g=c.createRadialGradient(90,120,10,90,120,110);
  const gold = (act>=4 && opheliaSaved && !darkMode);
  const doom = (act>=4 && (!opheliaSaved||darkMode));
  g.addColorStop(0, doom?'rgba(90,50,120,0.5)':(gold?'rgba(232,194,90,0.4)':'rgba(120,110,150,0.3)'));
  g.addColorStop(1,'rgba(0,0,0,0)');
  c.fillStyle=g; c.fillRect(0,0,180,240);
  // 立绘：临时把全局 ctx 切换到 portrait 画布再复用 drawHamlet
  drawHamletOn(c, 90, 210, 3.4, act);
  // 幕标注
  c.fillStyle= doom?'#c9a6e0':(gold?'#e8c25a':'#c4b98f'); c.font='11px serif'; c.textAlign='center';
  c.fillText(['第一幕','第二幕','第三幕','第四幕','第五幕'][act], 90, 232);
}
// 用给定 context 绘制哈姆雷特（复用 drawHamlet：临时切换全局 ctx）
function drawHamletOn(c, cx, cy, scale, act){
  const saved=ctx; ctx=c;
  ctx.save(); ctx.translate(cx,cy); ctx.scale(scale,scale);
  drawHamlet(0,0,1,{type:'idle',t:frame*0.5}, act);
  ctx.restore();
  ctx=saved;
}

let storyPages=[], storyPageIdx=0, storyDoneCb=null;
let typePieces=[], typePieceIdx=0, typeChar=0, typing=false, typeTick=0;

function buildPagePieces(page){
  const arr=[];
  (page.lines||[]).forEach(ln=>{
    if(ln.zh) arr.push({text:ln.zh, cls: ln.speak?'zh speak':'zh'});
    if(ln.en) arr.push({text:ln.en, cls:'en'});
  });
  return arr;
}
function showStory(pages, onDone){
  storyPages=pages; storyPageIdx=0; storyDoneCb=onDone;
  state=STATE.STORY;
  hideAllOverlays(); show(dom.storyScreen);
  loadStoryPage();
}
function loadStoryPage(){
  const page=storyPages[storyPageIdx];
  dom.storyAct.textContent=page.act||'';
  dom.storyTitle.textContent=page.title||'';
  typePieces=buildPagePieces(page); typePieceIdx=0; typeChar=0; typing=true; typeTick=0;
  renderStory();
  renderPortrait(page.portrait!==undefined?page.portrait:actIndex);
}
function renderStory(){
  let html='';
  for(let i=0;i<typePieces.length;i++){
    const pc=typePieces[i];
    if(i<typePieceIdx) html+='<p class="'+pc.cls+'">'+pc.text+'</p>';
    else if(i===typePieceIdx){ html+='<p class="'+pc.cls+'">'+pc.text.slice(0,typeChar)+(typing?'<span class="cursor">&nbsp;</span>':'')+'</p>'; break; }
  }
  dom.storyBody.innerHTML=html;
}
function tickStory(){
  if(!typing) return;
  typeTick++;
  if(typeTick%2!==0) return;
  const pc=typePieces[typePieceIdx];
  if(!pc){ typing=false; return; }
  typeChar++;
  if(Sound.enabled && typeChar%2===0) Sound.blip(rand(400,600),.02,'square',.06);
  if(typeChar>=pc.text.length){
    typePieceIdx++; typeChar=0;
    if(typePieceIdx>=typePieces.length){ typing=false; }
  }
  renderStory();
}
function storyAdvance(){
  if(typing){ // 立即显示整页
    typing=false; typePieceIdx=typePieces.length; renderStory(); return;
  }
  storyPageIdx++;
  if(storyPageIdx>=storyPages.length){
    const cb=storyDoneCb; storyDoneCb=null; hide(dom.storyScreen);
    if(cb) cb();
  } else loadStoryPage();
}

/* -------------------------------------------------------------------------
   13. 剧情文本（忠于原剧本，中英对照）
   ------------------------------------------------------------------------- */
const STORY = {
  a1_open:[
    { act:'ACT I · 第一幕', title:'艾尔西诺城堡 · 鬼魂现身', portrait:0, lines:[
      { zh:'寒夜，丹麦艾尔西诺城堡的城墙上，霜风刺骨。' },
      { zh:'一个熟悉的身影自黑暗中浮现——那是先王，哈姆雷特的父亲。' },
      { zh:'鬼魂（先王）：“听着，若你曾爱过你的父亲……”', speak:true },
      { zh:'“毒害你父亲性命的那条毒蛇，如今正戴着他的王冠。”', speak:true,
        en:'“The serpent that did sting thy father\'s life now wears his crown.”' },
      { zh:'哈姆雷特握紧了拳：我必以父之名，向克劳迪奥复仇。' }
    ]}
  ],
  a1_end:[
    { act:'ACT I · 尾声', title:'誓言', portrait:0, lines:[
      { zh:'鬼魂消散于晨雾。哈姆雷特立誓，将真相埋进心底。' },
      { zh:'哈姆雷特：“记住你——是的，我要抹去记忆里一切琐碎，只留下这复仇的血誓。”', speak:true,
        en:'“Remember thee! Yea, from the table of my memory I\'ll wipe away all trivial fond records.”' }
    ]}
  ],
  a2_open:[
    { act:'ACT II · 第二幕', title:'宫廷 · 装疯试探', portrait:1, lines:[
      { zh:'为麻痹克劳迪奥，哈姆雷特佯装疯癫，在宫廷爪牙间周旋。' },
      { zh:'他暗中收集情报，谋划一出“戏中戏”，要让弑君者当众露出马脚。' },
      { zh:'哈姆雷特：“虽是疯言，却自有条理。”', speak:true,
        en:'“Though this be madness, yet there is method in\'t.”' },
      { zh:'（收集散落的三份情报，触发戏中戏计划）' }
    ]}
  ],
  a2_end:[
    { act:'ACT II · 尾声', title:'戏中戏', portrait:1, lines:[
      { zh:'情报齐备。哈姆雷特请来伶人，排演一出影射弑君的戏。' },
      { zh:'哈姆雷特：“这出戏，便是我捕住国王良心的罗网。”', speak:true,
        en:'“The play\'s the thing wherein I\'ll catch the conscience of the king.”' }
    ]}
  ],
  a3_open:[
    { act:'ACT III · 第三幕', title:'剧院 / 内室 · 生死抉择', portrait:2, lines:[
      { zh:'夜深，哈姆雷特独立于幽暗内室，面对生与死的诘问。' },
      { zh:'哈姆雷特：“生存还是毁灭，这是一个值得考虑的问题。”', speak:true,
        en:'“To be, or not to be: that is the question.”' },
      { zh:'戏中戏即将上演，真相将逼克劳迪奥现形。' },
      { zh:'（本幕可拾取【亡魂之弓】，解锁远程攻击）' }
    ]}
  ],
  a3_play:[
    { act:'ACT III · 戏中戏', title:'良心的罗网', portrait:2, lines:[
      { zh:'戏台之上，毒杀之景重演。克劳迪奥面色骤变，仓皇离席！' },
      { zh:'哈姆雷特：“他心虚了——鬼魂所言，字字为真！”', speak:true },
    ]},
  ],
  a3_polonius:[
    { act:'ACT III · 内室', title:'帘后的血', portrait:2, lines:[
      { zh:'内室帘后传来窸窣声响。哈姆雷特以为是克劳迪奥，一剑刺出！' },
      { zh:'倒下的却是老臣波洛涅斯。哈姆雷特：“我错认了你，可怜的、多管闲事的蠢材。”', speak:true,
        en:'“Thou wretched, rash, intruding fool, farewell!”' }
    ]}
  ],
  a3_end:[
    { act:'ACT III · 尾声', title:'弦已满', portrait:2, lines:[
      { zh:'真相已明，血债已启。克劳迪奥惊怒，欲除哈姆雷特而后快。' },
      { zh:'而奥菲莉亚，因父亲之死与爱人之狂，神思愈发恍惚……' }
    ]}
  ],
  a4_open:[
    { act:'ACT IV · 第四幕', title:'柳树湖畔 · 奥菲莉亚落水', portrait:3, lines:[
      { zh:'柳树斜倚溪畔。悲恸的奥菲莉亚攀上枝头，编织花环。' },
      { zh:'枝断，她坠入湍流！衣裙浮起，歌声渐渺……' },
      { zh:'哈姆雷特狂奔而来——在她沉没前，赶到她身边！', speak:true },
      { zh:'（限时救援：水面即死，跳跃平台赶到奥菲莉亚身边）' }
    ]}
  ],
  a4_saved:[
    { act:'ACT IV · 得救', title:'奥菲莉亚得救', portrait:3, lines:[
      { zh:'金色的光自天而降，花瓣漫天，水面泛起温柔的涟漪。' },
      { zh:'哈姆雷特将她拥入怀中，奥菲莉亚缓缓睁眼。' },
      { zh:'奥菲莉亚：“你来了……”', speak:true },
      { zh:'哈姆雷特：“你可以怀疑星辰是火，怀疑太阳会移动，怀疑真理是谎言——但永远不要怀疑我的爱。”', speak:true,
        en:'“Doubt thou the stars are fire… but never doubt I love.”' },
      { zh:'她将并肩与你走向最终的决战。' }
    ]}
  ],
  a4_lost:[
    { act:'ACT IV · 逝去', title:'奥菲莉亚已逝', portrait:3, lines:[
      { zh:'水流太急，花环沉没。奥菲莉亚随着歌声一起，沉入幽暗的水底。' },
      { zh:'哈姆雷特跪在岸边，泪与雨水交织。' },
      { zh:'哈姆雷特：“我爱奥菲莉亚，四万个兄弟的爱加起来，也抵不过我。”', speak:true,
        en:'“I loved Ophelia: forty thousand brothers could not make up my sum.”' },
      { zh:'自此，丹麦的天空堕入更深的黑暗……' }
    ]}
  ],
  a5_open_saved:[
    { act:'ACT V · 第五幕', title:'墓地 · 王座 · 最终决战', portrait:4, lines:[
      { zh:'黎明将至。哈姆雷特携奥菲莉亚，穿过墓地，直取王座。' },
      { zh:'霍拉旭随行相伴：“殿下，命运的时刻到了。”', speak:true },
      { zh:'（墓地→宫廷走廊→王座厅，与克劳迪奥三阶段决战）' }
    ]}
  ],
  a5_open_lost:[
    { act:'ACT V · 第五幕', title:'墓地 · 王座 · 最终决战', portrait:4, lines:[
      { zh:'冷雨不歇，枯枝与乌鸦盘踞。哈姆雷特独自穿过阴郁的墓地。' },
      { zh:'霍拉旭追上前来：“殿下，纵是深渊，我也随你同去。”', speak:true },
      { zh:'（墓地→宫廷走廊→王座厅，独自面对克劳迪奥三阶段决战）' }
    ]}
  ],
  a5_yorick:[
    { act:'ACT V · 墓地', title:'可怜的约克里克', portrait:4, lines:[
      { zh:'掘出的头骨在掌中。哈姆雷特凝视良久。' },
      { zh:'哈姆雷特：“唉，可怜的约克里克！霍拉旭，我认得他。”', speak:true,
        en:'“Alas, poor Yorick! I knew him, Horatio.”' },
      { zh:'生死一线，皆归尘土。而复仇，仍未了结。' }
    ]}
  ]
};

// Boss 阶段台词（克劳迪奥，中英对照）
const BOSS_LINES = {
  p1:{ zh:'克劳迪奥：“我的罪孽腥臭熏天，直冲云霄。”', en:'“O, my offence is rank, it smells to heaven.”' },
  p2:{ zh:'克劳迪奥：“绝望的病症，要用绝望的药石来医。”', en:'“Diseases desperate grown by desperate appliance are relieved.”' },
  p3:{ zh:'克劳迪奥：“我的话飞上天，我的心却坠向地——皆化虚空！”', en:'“My words fly up, my thoughts remain below.”' }
};

/* -------------------------------------------------------------------------
   14. 关卡加载 / 玩家 / 随从 / Boss 实例
   ------------------------------------------------------------------------- */
let respawn={x:80,y:GROUND_TOP};
let checkpointActive=null;
let goalLocked=false, goalReached=false;
let deathFade=0;
let bossStarted=false;
let midFired={};                     // 已触发的过场 key
let hintPulse=0;

function makePlayer(x,y){
  return {
    x, y:y-PLAYER_H, w:PLAYER_W, h:PLAYER_H, vx:0, vy:0, facing:1,
    onGround:false, hp:100, maxHp:100, invuln:0,
    atkT:0, atkCd:0, rangedCd:0, ammo:8, maxAmmo:12,
    energy:0, maxEnergy:100, pose:{type:'idle',frame:0,t:0},
    coyote:0, jumpBuf:0, hurtT:0, ultActive:0, dead:false
  };
}
function makeCompanion(kind){
  return { kind, x:player?player.x-40:40, y:GROUND_TOP-40, w:20, h:40, vx:0, vy:0,
    facing:1, onGround:false, hp:80, maxHp:80, active:true, atkT:0, atkCd:0, shootCd:60, invuln:0 };
}
function makeBoss(){
  const hp = opheliaSaved? 200 : 240; // 失败路线更难
  return { x:level.width-460, y:GROUND_TOP-90, w:44, h:90, vx:0, vy:0, facing:-1,
    hp, maxHp:hp, phase:1, onGround:false, hitFlash:0, invuln:0,
    atkT:0, atkCd:80, moveT:0, state:'idle', summonCd:200, dashCd:160, poisonCd:120,
    ultCd:300, enraged:false, dead:false, deathT:0, phaseAnnounced:{1:true,2:false,3:false} };
}

function loadLevel(idx, keepScore){
  level = buildAct(idx);
  darkMode = (idx===4 && !opheliaSaved);
  enemies=[]; projectiles=[]; rocks=[]; particles=[]; floaters=[]; petals=[]; texts=[];
  level.enemySpawns.forEach(s=>{ const e=makeEnemy(s.type,s.x,s.y); enemies.push(e); });
  player=makePlayer(level.playerStart.x, level.playerStart.y);
  if(!hasBow) player.ammo=0;
  companion=null;
  if(idx===4 && opheliaSaved){ companion=makeCompanion('ophelia'); }
  boss=null; bossStarted=false;
  respawn={x:level.playerStart.x, y:level.playerStart.y};
  checkpointActive=null; goalReached=false; deathFade=0; midFired={};
  // 目标门是否上锁
  goalLocked = (idx===0)||(idx===1)||(idx===2);
  if(!keepScore){ /* 保留累计分数跨幕 */ }
  // HUD
  dom.levelLabel.textContent = ACTS[idx].name;
  dom.timerRow.style.display = (idx===3)?'block':'none';
  // 亡魂之弓 UI
  if(hasBow){ dom.hintRanged.classList.remove('locked'); dom.hintLock.textContent=''; }
  else { dom.hintRanged.classList.add('locked'); dom.hintLock.textContent='(拾取亡魂之弓解锁)'; }
  // 音乐
  let mus = ACTS[idx].music;
  if(idx===4) mus = opheliaSaved? 'hero':'imperial';
  Sound.setMusic(mus, 1);
  updateHUD();
}

/* -------------------------------------------------------------------------
   15. 物理与碰撞
   ------------------------------------------------------------------------- */
function solidsList(){
  // 返回可碰撞矩形（地面全实心；平台/移动平台单向顶部）
  return level.platforms.concat(level.movers);
}
function stepPhysics(ent, solids){
  // 水平
  ent.x += ent.vx;
  for(const s of solids){
    if(s.type!=='ground') continue; // 只有地面墙体阻挡水平
    if(rectsOverlap(ent,s)){
      if(ent.vx>0) ent.x = s.x - ent.w;
      else if(ent.vx<0) ent.x = s.x + s.w;
      ent.vx=0;
    }
  }
  // 垂直
  ent.vy = Math.min(ent.vy+GRAVITY, MAX_FALL);
  const prevBottom = ent.y + ent.h;
  ent.y += ent.vy;
  ent.onGround=false;
  for(const s of solids){
    if(rectsOverlap(ent,s)){
      if(s.type==='ground'){
        if(ent.vy>0){ ent.y=s.y-ent.h; ent.vy=0; ent.onGround=true; }
        else if(ent.vy<0){ ent.y=s.y+s.h; ent.vy=0; }
      } else { // 单向平台：仅下落且脚从上方越过时落定
        if(ent.vy>=0 && prevBottom<=s.y+ (s._dy||0) +6){ ent.y=s.y-ent.h; ent.vy=0; ent.onGround=true; if(s.carry){ ent.x+=s._dx||0; } }
      }
    }
  }
}

function updateMovers(){
  for(const m of level.movers){
    const nx = m.baseX + (m.axis==='x'? Math.sin(frame*0.02*m.speed+m.phase)*m.range : 0);
    const ny = m.baseY + (m.axis==='y'? Math.sin(frame*0.02*m.speed+m.phase)*m.range : 0);
    m._dx = nx-m.x; m._dy = ny-m.y; m.carry=true;
    m.x=nx; m.y=ny;
  }
}

/* -------------------------------------------------------------------------
   16. 战斗辅助
   ------------------------------------------------------------------------- */
function playerAttackBox(){
  const reach = (actIndex>=3)?34:26;
  return player.facing>0
    ? {x:player.x+player.w-4, y:player.y+6, w:reach, h:player.h-10}
    : {x:player.x+4-reach, y:player.y+6, w:reach, h:player.h-10};
}
function dealDamageToEnemy(e, dmg, fromX, knock, fromRanged){
  if(e.dying||e.invuln>0) return false;
  // 盾兵正面防御
  if(e.type==='shield' && !e.shieldBroken){
    const frontRight = e.facing>0, playerRight = player.x>e.x;
    const blockedFront = (e.facing>0 && playerRight===false) ? false : true;
    const attackFromFront = (e.facing>0 && fromX<e.x+e.w/2) || (e.facing<0 && fromX>e.x+e.w/2);
    if(attackFromFront){
      if(fromRanged){ // 远程可破防
        e.shieldHits=(e.shieldHits||0)+1;
        if(e.shieldHits>=2){ e.shieldBroken=true; addFloater(e.x+e.w/2,e.y-10,'破防!','#ffd0a0',13); Sound.breakBox(); }
        else { spark(fromX, e.y+e.h/2, player.x<e.x?1:-1, '#c9c4b4'); Sound.hit(); return false; }
      } else {
        spark(fromX, e.y+e.h/2, player.x<e.x?1:-1, '#c9c4b4'); Sound.hit(); addFloater(e.x+e.w/2,e.y-8,'挡!','#c9c4d0',12); return false;
      }
    }
  }
  e.hp-=dmg; e.hitFlash=6; e.invuln=8;
  e.vx = (e.x+e.w/2>fromX?1:-1)*(knock||3.5);
  e.vy=-2;
  spark(e.x+e.w/2, e.y+e.h/2, e.x+e.w/2>fromX?1:-1, '#ffef9a');
  shake(3,6);
  player.energy=Math.min(player.maxEnergy, player.energy+ (fromRanged?4:6));
  if(e.hp<=0){ killEnemy(e); return true; }
  Sound.hit();
  return true;
}
function killEnemy(e){
  e.dying=true; e.deathT=26; e.vx*=0.5;
  burst(e.x+e.w/2, e.y+e.h/2, e.elite?'#ff9b5a':'#c9b06a', e.elite?18:12, e.elite?4:3);
  if(e.type==='skeleton'){ // 碎裂
    for(let i=0;i<8;i++) burst(e.x+e.w/2, e.y+e.h*rand(0.2,0.9), '#e8e2d2', 2, 3);
  }
  addScore(e.score, 'kill'); bumpCombo();
  addFloater(e.x+e.w/2, e.y-6, '+'+e.score, '#e8c25a', 14);
  player.energy=Math.min(player.maxEnergy, player.energy+12);
  Sound.hit();
  // 掉落
  if(Math.random()<0.35){ dropItem(e.x+e.w/2, e.y+e.h/2, Math.random()<0.5?'heart':'ammo'); }
}
function dropItem(x,y,kind){ level.pickups.push({x:x-6,y:y-6,w:12,h:12,kind,taken:false,vy:-2,drop:true}); }

function damagePlayer(dmg, fromX){
  if(player.invuln>0||player.dead) return;
  player.hp-=dmg; player.invuln=60; player.hurtT=20;
  player.vx=(player.x> fromX?1:-1)*4; player.vy=-4;
  player.pose.type='hurt'; player.pose.frame=0;
  flash('rgba(180,20,20,0.35)',10); shake(6,10); Sound.hurt();
  updateHUD();
  if(player.hp<=0){ player.hp=0; onPlayerDeath(); }
}

/* -------------------------------------------------------------------------
   17. 玩家更新
   ------------------------------------------------------------------------- */
function doMelee(){
  const box=playerAttackBox();
  for(const e of enemies){ if(e.dying) continue; if(player._swingHits.has(e)) continue;
    if(rectsOverlap(box,e)){ if(dealDamageToEnemy(e, actIndex>=3?4:3, player.x+player.w/2, 4, false)) player._swingHits.add(e); else player._swingHits.add(e); } }
  if(boss && !boss.dead && rectsOverlap(box,boss) && !player._swingHits.has(boss)){ damageBoss(6, player.x+player.w/2, false); player._swingHits.add(boss); }
  for(const bk of level.breakables){ if(bk.dead) continue; if(rectsOverlap(box,bk) && !player._swingHits.has(bk)){ hitBreakable(bk); player._swingHits.add(bk); } }
}
function fireArrow(){
  player.ammo--; player.rangedCd=20;
  player.pose.type='ranged'; player.pose.frame=0;
  const dir=player.facing;
  projectiles.push({owner:'player', x:player.x+player.w/2+dir*12, y:player.y+16, vx:dir*9, vy:0, w:12, h:4, dmg:5, kind:'arrow', life:120});
  spark(player.x+player.w/2+dir*12, player.y+16, dir, '#c9a6ff');
  Sound.rangedFire();
  updateHUD();
}
function ultAttack(){
  player.energy=0; player.ultActive=30; player.atkCd=40;
  Sound.ult(); shake(10,20); flash('rgba(232,194,90,0.4)',14);
  addFloater(player.x+player.w/2, player.y-16, '亡魂之怒!', '#e8c25a', 20);
  for(let i=0;i<30;i++) burst(player.x+player.w/2, player.y+player.h/2, i%2?'#e8c25a':'#c9a6ff', 1, 6);
  for(const e of enemies){ if(!e.dying && dist(e.x+e.w/2,e.y+e.h/2,player.x+player.w/2,player.y+player.h/2)<160){ dealDamageToEnemy(e, 12, player.x+player.w/2, 8, true); } }
  if(boss && !boss.dead && dist(boss.x+boss.w/2,boss.y+boss.h/2,player.x+player.w/2,player.y+player.h/2)<200){ damageBoss(30, player.x+player.w/2, true); }
}
function hitBreakable(bk){
  bk.hp--; bk.hitT=6; Sound.hit();
  if(bk.hp<=0){ bk.dead=true; stats.boxes++; addScore(40); Sound.breakBox();
    burst(bk.x+bk.w/2,bk.y+bk.h/2, bk.kind==='coffin'?'#5e4a30':'#8a6238', 12, 3);
    if(bk.drop) dropItem(bk.x+bk.w/2,bk.y+bk.h/2,bk.drop);
    addFloater(bk.x+bk.w/2,bk.y-6,'+40','#c9b06a',12);
  }
}

function updatePlayer(){
  const p=player;
  if(p.dead) return;
  let move=0;
  if(keys.left) move=-1; if(keys.right) move=1;
  if(move){ p.facing=move; p.vx += move*(p.onGround?0.9:AIR_ACCEL); p.vx=clamp(p.vx,-MOVE_SPEED,MOVE_SPEED); }
  else if(p.onGround){ p.vx*=FRICTION; if(Math.abs(p.vx)<0.15)p.vx=0; }
  // 跳跃（土狼时间 + 缓冲）
  if(p.onGround) p.coyote=6; else if(p.coyote>0) p.coyote--;
  if(jumpEdge) p.jumpBuf=7; else if(p.jumpBuf>0) p.jumpBuf--;
  if(p.jumpBuf>0 && p.coyote>0){ p.vy=JUMP_VEL; p.onGround=false; p.coyote=0; p.jumpBuf=0; Sound.jump(); burst(p.x+p.w/2,p.y+p.h,'rgba(180,175,190,0.7)',5,2); }
  if(!keys.jump && p.vy<-4) p.vy*=0.86; // 短跳
  // 攻击
  if(atkEdge && p.atkCd<=0 && p.hurtT<=0){
    if(p.energy>=p.maxEnergy && bossStarted){ ultAttack(); }
    else { p.atkT=12; p.atkCd=22; p._swingHits=new Set(); p.pose.type='atk'; p.pose.frame=0; Sound.swing(); }
  }
  if(p.atkT>0){ doMelee(); }
  // 远程
  if(rangedEdge && hasBow && p.rangedCd<=0 && p.ammo>0 && p.hurtT<=0){ fireArrow(); }
  // 计时器
  if(p.atkT>0)p.atkT--; if(p.atkCd>0)p.atkCd--; if(p.rangedCd>0)p.rangedCd--;
  if(p.invuln>0)p.invuln--; if(p.hurtT>0)p.hurtT--; if(p.ultActive>0)p.ultActive--;
  // 物理
  const solids=solidsList();
  stepPhysics(p, solids);
  // 掉出世界底部
  if(p.y>level.height+40){ if(actIndex===3) drownPlayer(); else damagePlayer(30, p.x); if(!p.dead){ p.y=respawn.y-PLAYER_H; p.x=respawn.x; p.vy=0; } }
  // 危险区
  checkHazards();
  // 姿态
  if(p.hurtT>0) p.pose.type='hurt';
  else if(p.atkT>0) p.pose.type='atk';
  else if(!p.onGround) p.pose.type='jump';
  else if(Math.abs(p.vx)>0.4) p.pose.type='walk';
  else p.pose.type='idle';
  p.pose.frame++; p.pose.t += Math.abs(p.vx)>0.4?Math.abs(p.vx):1;
  // 边界
  p.x=clamp(p.x, 0, level.width-p.w);
}

function checkHazards(){
  const p=player;
  const feet={x:p.x+2,y:p.y+p.h-6,w:p.w-4,h:8};
  const body={x:p.x+3,y:p.y+4,w:p.w-6,h:p.h-8};
  for(const hz of level.hazards){
    if(hz.type==='water'){
      if(rectsOverlap(feet,hz)){ if(actIndex===3){ drownPlayer(); } else { damagePlayer(20,hz.x+hz.w/2); if(!p.dead){ p.vy=-6; p.x=respawn.x; p.y=respawn.y-PLAYER_H; } } return; }
    } else if(hz.type==='spike'){
      if(rectsOverlap(feet,hz)){ damagePlayer(14, p.x+ (p.x<hz.x+hz.w/2? -20:20)); if(!p.dead){ p.vy=-7; } return; }
    } else if(hz.type==='poison'){
      if(rectsOverlap(body,hz)){ if(frame%20===0) damagePlayer(6, p.x); if(frame%8===0) smoke(p.x+p.w/2, p.y+p.h, 'rgba(140,220,90,0.4)'); }
    }
  }
}
function drownPlayer(){
  if(player.dead) return;
  player.dead=true; ripple(player.x+player.w/2, GROUND_TOP); Sound.hurt();
  for(let i=0;i<10;i++) ripple(player.x+rand(-10,10), GROUND_TOP+rand(0,10));
  onPlayerDeath();
}

/* -------------------------------------------------------------------------
   18. 敌人 AI
   ------------------------------------------------------------------------- */
function updateEnemies(){
  const solids=solidsList();
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(e.hitFlash>0)e.hitFlash--;
    if(e.invuln>0)e.invuln--;
    if(e.dying){ e.deathT--; e.vy+=GRAVITY*0.5; e.y+=e.vy; e.x+=e.vx; e.vx*=0.9; if(e.deathT<=0) enemies.splice(i,1); continue; }
    const px=player.x+player.w/2, py=player.y+player.h/2;
    const ex=e.x+e.w/2, ey=e.y+e.h/2;
    const d=dist(px,py,ex,ey);
    e.facing = px<ex?-1:1;
    // 玩家伤害接触（近战身体）
    if(!player.dead && player.invuln<=0 && rectsOverlap(player,e) && !e.dying){ damagePlayer(e.dmg, ex); }

    if(e.type==='patrol'||e.type==='skeleton'){
      const detect = e.type==='skeleton'?260:220;
      if(d<detect && Math.abs(py-ey)<80){ // 追击
        e.vx += (px<ex?-1:1)*0.12; e.vx=clamp(e.vx,-e.speed*1.4,e.speed*1.4);
        if(d<40 && e.atkCd<=0){ e.atkT=14; e.atkCd=50; if(rectsOverlap(playerNear(e),player)) {} }
        if(e.type==='skeleton' && e.onGround && e.jumpCd<=0 && Math.abs(px-ex)<120 && py<ey-10){ e.vy=-9; e.jumpCd=90; }
      } else { // 巡逻
        if(e.x<e.patrolMin) e.facing=1; if(e.x>e.patrolMax) e.facing=-1;
        e.vx += e.facing*0.08; e.vx=clamp(e.vx,-e.speed,e.speed);
      }
    } else if(e.type==='archer'){
      const detect=340;
      if(d<detect){
        if(d<120){ e.vx += (px<ex?1:-1)*0.14; } // 拉开距离
        else if(d>230){ e.vx += (px<ex?-1:1)*0.08; }
        else e.vx*=0.8;
        e.vx=clamp(e.vx,-e.speed,e.speed);
        if(e.shootCd<=0){ e.aimT=24; e.shootCd=140; }
        if(e.aimT>0){ e.aimT--; if(e.aimT===1){ enemyShoot(e, px, py, 'arrow'); } }
      } else e.vx*=0.8;
    } else if(e.type==='shield'){
      const detect=260;
      e.shieldUp = (d<200);
      if(d<detect){ e.vx += (px<ex?-1:1)*0.06; e.vx=clamp(e.vx,-e.speed,e.speed);
        if(d<44 && e.atkCd<=0){ e.atkT=16; e.atkCd=70; }
      } else e.vx*=0.85;
    } else if(e.type==='elite'){
      const detect=380;
      if(d<detect){
        if(e.dashCd<=0 && d>120 && d<300 && e.onGround){ e.state='dash'; e.dashT=26; e.dashCd=180; e.vx=(px<ex?-1:1)*7; }
        else if(e.state!=='dash'){ e.vx += (px<ex?-1:1)*0.1; e.vx=clamp(e.vx,-e.speed*1.2,e.speed*1.2); }
        if(d<60 && e.atkCd<=0){ e.atkT=20; e.atkCd=70; }
      }
      if(e.state==='dash'){ e.dashT--; if(e.dashT<=0){ e.state='patrol'; e.vx*=0.4; } }
      if(e.dashCd>0)e.dashCd--;
    }
    // 攻击命中判定
    if(e.atkT>0){ e.atkT--; if(e.atkT===6){ const hb=playerNear(e); if(!player.dead && player.invuln<=0 && rectsOverlap(hb,player)) damagePlayer(e.dmg, ex); } }
    if(e.atkCd>0)e.atkCd--; if(e.shootCd>0)e.shootCd--; if(e.jumpCd>0)e.jumpCd--;
    // 物理
    stepPhysics(e, solids);
    // 防止走出关卡
    e.x=clamp(e.x,0,level.width-e.w);
    if(e.y>level.height+60){ enemies.splice(i,1); }
  }
}
function playerNear(e){ const reach=e.elite?46:30; return e.facing>0? {x:e.x+e.w,y:e.y,w:reach,h:e.h} : {x:e.x-reach,y:e.y,w:reach,h:e.h}; }
function enemyShoot(e, tx, ty, kind){
  const sx=e.x+e.w/2, sy=e.y+e.h*0.4;
  const ang=Math.atan2(ty-sy, tx-sx);
  const sp=kind==='poison'?4:5.2;
  projectiles.push({owner:'enemy', x:sx, y:sy, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp, w:12,h:4, dmg:e.dmg, kind, life:160, ang});
  Sound.rangedFire();
}

/* -------------------------------------------------------------------------
   19. 抛射物 / 落石 / 拾取
   ------------------------------------------------------------------------- */
function updateProjectiles(){
  const solids=level.platforms;
  for(let i=projectiles.length-1;i>=0;i--){
    const pr=projectiles[i];
    pr.x+=pr.vx; pr.y+=pr.vy; if(pr.kind==='poison') pr.vy+=0.12;
    pr.life--;
    if(pr.kind==='poison') smoke(pr.x,pr.y,'rgba(140,220,90,0.4)');
    let dead=pr.life<=0;
    // 命中地形
    for(const s of solids){ if(s.type==='ground' && pr.x>s.x&&pr.x<s.x+s.w&&pr.y>s.y&&pr.y<s.y+s.h){ dead=true; break; } }
    if(pr.owner==='player'){
      for(const e of enemies){ if(!e.dying && rectsOverlap({x:pr.x-4,y:pr.y-2,w:8,h:6}, e)){ dealDamageToEnemy(e, pr.dmg, pr.x, 5, true); dead=true; break; } }
      if(!dead && boss && !boss.dead && rectsOverlap({x:pr.x-4,y:pr.y-2,w:8,h:6}, boss)){ damageBoss(pr.dmg, pr.x, true); dead=true; }
      if(!dead) for(const bk of level.breakables){ if(!bk.dead && rectsOverlap({x:pr.x-4,y:pr.y-2,w:8,h:6},bk)){ hitBreakable(bk); dead=true; break; } }
    } else {
      if(!player.dead && player.invuln<=0 && rectsOverlap({x:pr.x-4,y:pr.y-2,w:8,h:6}, player)){ damagePlayer(pr.dmg, pr.x); dead=true; }
      // 随从可挡
      if(!dead && companion && companion.active && rectsOverlap({x:pr.x-4,y:pr.y-2,w:8,h:6}, companion)){ companion.hp-=pr.dmg; dead=true; }
    }
    if(dead){ spark(pr.x,pr.y, pr.vx>0?-1:1, pr.kind==='poison'?'#9bff6a':(pr.owner==='player'?'#c9a6ff':'#ffb060')); projectiles.splice(i,1); }
  }
}
function updateRocks(){
  if(!level.rockEmitters) return;
  for(const em of level.rockEmitters){
    if(Math.abs(player.x-em.x)<em.range){ em.t--; if(em.t<=0){ em.t=em.interval; rocks.push({x:em.x+rand(-em.range*0.6,em.range*0.6), y:em.y, vy:0, w:20,h:20, warn:40}); } }
  }
  for(let i=rocks.length-1;i>=0;i--){ const r=rocks[i];
    if(r.warn>0){ r.warn--; continue; }
    r.vy=Math.min(r.vy+0.5, 12); r.y+=r.vy;
    if(!player.dead && player.invuln<=0 && rectsOverlap({x:r.x,y:r.y,w:r.w,h:r.h}, player)){ damagePlayer(16, r.x+r.w/2); r._hit=true; }
    // 落地
    for(const s of level.platforms){ if(s.type==='ground' && r.x+r.w>s.x&&r.x<s.x+s.w&&r.y+r.h>s.y&&r.y<s.y+20){ burst(r.x+r.w/2,r.y+r.h,'#6a5a52',8,3); shake(4,6); rocks.splice(i,1); r._done=true; break; } }
    if(r._done) continue;
    if(r.y>level.height+40||r._hit) rocks.splice(i,1);
  }
}
function updatePickups(){
  for(const it of level.pickups){ if(it.taken) continue;
    if(it.drop && it.vy!==undefined){ it.vy+=GRAVITY*0.4; it.y+=it.vy; for(const s of level.platforms){ if(s.type==='ground'&&it.x+it.w>s.x&&it.x<s.x+s.w&&it.y+it.h>s.y&&it.y<s.y+16){ it.y=s.y-it.h; it.vy=0; break; } } }
    if(rectsOverlap(player,it)){ it.taken=true; collectItem(it); }
  }
}
function collectItem(it){
  if(it.kind==='heart'){ player.hp=Math.min(player.maxHp,player.hp+20); addFloater(it.x,it.y-8,'+20 HP','#ff8a8a',13); Sound.pickup(); }
  else if(it.kind==='ammo'){ if(hasBow){ player.ammo=Math.min(player.maxAmmo,player.ammo+4); addFloater(it.x,it.y-8,'+4 箭','#c9a6ff',13);} else { addScore(20);} Sound.coin(); }
  else { addScore(20); addFloater(it.x,it.y-8,'+20','#e8c25a',12); Sound.coin(); }
  updateHUD();
}

/* -------------------------------------------------------------------------
   20. 触发区 / 检查点 / 随从
   ------------------------------------------------------------------------- */
function updateTriggersAndCheckpoints(){
  // 检查点
  for(const cp of level.checkpoints){
    if(!cp.active && Math.abs((player.x+player.w/2)-cp.x)<26 && player.y+player.h>cp.y-60){
      cp.active=true; checkpointActive=cp; respawn={x:cp.x, y:cp.y};
      addFloater(cp.x, cp.y-52, '检查点', ACTS[actIndex].accent, 14); Sound.checkpoint();
      if(cp.bossGate) respawn._bossGate=true;
    }
  }
  // 触发区
  for(const tr of level.triggers){ if(tr.fired && !tr.persist) continue;
    if(rectsOverlap({x:player.x,y:player.y,w:player.w,h:player.h}, tr)){ fireTrigger(tr); }
  }
  // 隐藏宝箱
  for(const ch of level.chests){ if(ch.taken) continue;
    if(rectsOverlap(player, {x:ch.x,y:ch.y,w:ch.w,h:ch.h})){
      ch.taken=true; ch.open=true; stats.secrets++; Sound.pickup();
      for(let i=0;i<14;i++) burst(ch.x+ch.w/2, ch.y+ch.h/2, '#e8c25a', 1, 3);
      if(ch.reward==='ammo' && hasBow){ player.ammo=Math.min(player.maxAmmo,player.ammo+6); addFloater(ch.x+ch.w/2,ch.y-8,'隐藏宝箱! +6 箭','#c9a6ff',14); }
      else { addScore(200); addFloater(ch.x+ch.w/2,ch.y-8,'隐藏宝箱! +200','#e8c25a',14); }
      updateHUD();
    }
  }
  // 亡魂之弓拾取
  if(level.bowPickup && !level.bowPickup.taken && rectsOverlap(player, level.bowPickup)){
    level.bowPickup.taken=true; hasBow=true; player.ammo=player.maxAmmo;
    dom.hintRanged.classList.remove('locked'); dom.hintLock.textContent='';
    Sound.pickup(); flash('rgba(150,120,220,0.3)',12);
    for(let i=0;i<20;i++) burst(level.bowPickup.x+17, level.bowPickup.y+17, '#c9a6ff',1,4);
    addFloater(level.bowPickup.x+17, level.bowPickup.y-10, '获得【亡魂之弓】! 远程攻击已解锁 [F]', '#c9a6ff', 15);
    showStory([{act:'ACT III · 亡魂之弓', title:'先王的馈赠', portrait:2, lines:[
      { zh:'一柄泛着幽光的弓自石台升起——【亡魂之弓】。' },
      { zh:'哈姆雷特：“亡魂相助，让复仇之矢，穿透一切阻碍。”', speak:true },
      { zh:'（按 F / Z 发射亡魂之矢；弹药可从箱子与敌人处补充）' }
    ]}], ()=>{ state=STATE.PLAY; });
    updateHUD();
  }
}
function fireTrigger(tr){
  tr.fired=true;
  if(tr.type==='ghost' && tr.key==='ghost'){ // 第一幕鬼魂
    showStory([{act:'ACT I · 城墙', title:'鬼魂现身', portrait:0, lines:[
      { zh:'城墙尽头，寒雾翻涌。先王的鬼魂再度显形，抬手直指王座的方向。' },
      { zh:'鬼魂：“为我复仇——但莫伤你母亲，把她交给上苍。”', speak:true,
        en:'“Taint not thy mind, nor let thy soul contrive against thy mother aught.”' }
    ]}], ()=>{ goalLocked=false; state=STATE.PLAY; addFloater(player.x,player.y-30,'前路已开！','#e8c25a',15); });
  } else if(tr.type==='intel'){ level.intelGot=(level.intelGot||0)+1; addScore(60); Sound.coin();
    addFloater(tr.x+tr.w/2, tr.y-8, '情报 '+level.intelGot+'/'+level.intelTotal, '#d8b8f0', 14);
    burst(tr.x+tr.w/2, tr.y+tr.h/2, '#d8b8f0', 10, 3);
    if(level.intelGot>=level.intelTotal){ goalLocked=false;
      showStory(STORY.a2_end, ()=>{ state=STATE.PLAY; addFloater(player.x,player.y-30,'戏中戏就绪！','#e8c25a',15); });
    }
  } else if(tr.key==='play'){ // 第三幕 戏中戏
    showStory(STORY.a3_play, ()=>{ goalLocked=false; state=STATE.PLAY; });
  } else if(tr.key==='polonius'){ // 误杀波洛涅斯
    showStory(STORY.a3_polonius, ()=>{ state=STATE.PLAY; });
  } else if(tr.type==='yorick'){ // 第五幕墓地
    showStory(STORY.a5_yorick, ()=>{ state=STATE.PLAY; });
  } else if(tr.type==='rescue'){ // 第四幕救援成功
    rescueOphelia();
  }
}
function updateCompanion(){
  const c=companion; if(!c||!c.active) return;
  const solids=solidsList();
  const targetX = player.x - player.facing*40;
  if(Math.abs(c.x-targetX)>14){ c.vx += (c.x<targetX?1:-1)*0.4; c.vx=clamp(c.vx,-3.4,3.4); c.facing=c.vx<0?-1:1; }
  else c.vx*=0.7;
  // 跟随跳跃
  if(c.onGround && player.y+player.h < c.y-20 && Math.abs(c.x-player.x)<120) c.vy=-10;
  if(c.x<0)c.x=0;
  stepPhysics(c, solids);
  if(c.y>level.height+40){ c.x=player.x; c.y=player.y; c.vy=0; }
  // 助攻：向最近敌人/Boss 射光
  if(c.shootCd>0)c.shootCd--;
  if(c.atkT>0)c.atkT--;
  let tgt=null, td=1e9;
  for(const e of enemies){ if(e.dying)continue; const dd=dist(e.x,e.y,c.x,c.y); if(dd<300&&dd<td){td=dd;tgt=e;} }
  if(boss&&!boss.dead){ const dd=dist(boss.x,boss.y,c.x,c.y); if(dd<340&&dd<td){td=dd;tgt=boss;} }
  if(tgt && c.shootCd<=0){ c.shootCd=90; c.atkT=12; c.facing = tgt.x<c.x?-1:1;
    const sx=c.x+c.w/2, sy=c.y+c.h*0.4, ang=Math.atan2((tgt.y+tgt.h/2)-sy,(tgt.x+tgt.w/2)-sx);
    projectiles.push({owner:'player', x:sx,y:sy, vx:Math.cos(ang)*7, vy:Math.sin(ang)*7, w:10,h:4, dmg:4, kind:'aid', life:120});
    Sound.blip(880,.1,'triangle',.14);
  }
}

/* -------------------------------------------------------------------------
   21. Boss（克劳迪奥）三阶段
   ------------------------------------------------------------------------- */
function startBoss(){
  bossStarted=true;
  boss=makeBoss();
  Sound.setMusic(opheliaSaved?'hero':'boss', 1.1);
  // 触发首段对白
  showStory([{act:'ACT V · 王座大厅', title:'弑君者克劳迪奥', portrait:4, lines:[
    { zh:'王座之上，克劳迪奥缓缓起身，握紧毒剑。' },
    { zh:BOSS_LINES.p1.zh, speak:true, en:BOSS_LINES.p1.en },
    { zh:'哈姆雷特：“恶贼，受死！为我父亲，为丹麦！”', speak:true }
  ]}], ()=>{ state=STATE.PLAY; addFloater(boss.x+boss.w/2, boss.y-20, 'BOSS 战 · 第一阶段', '#e8c25a', 16); });
}
function damageBoss(dmg, fromX, ranged){
  if(!boss||boss.dead||boss.invuln>0) return;
  boss.hp-=dmg; boss.hitFlash=6; boss.invuln=6;
  boss.vx=(boss.x+boss.w/2>fromX?1:-1)*1.5;
  spark(boss.x+boss.w/2, boss.y+boss.h*0.4, boss.x+boss.w/2>fromX?1:-1, '#ffb0b0');
  shake(3,6); Sound.bossHit();
  player.energy=Math.min(player.maxEnergy, player.energy+ (ranged?3:5));
  const ratio=boss.hp/boss.maxHp;
  if(ratio<=0.66 && boss.phase===1){ bossPhaseTransition(2); }
  else if(ratio<=0.33 && boss.phase===2){ bossPhaseTransition(3); }
  if(boss.hp<=0){ boss.hp=0; onBossDefeated(); }
}
function bossPhaseTransition(ph){
  boss.phase=ph; boss.invuln=90; boss.atkCd=60;
  Sound.bossPhase(); shake(10,24); flash(ph===3?'rgba(200,20,20,0.4)':'rgba(200,120,40,0.3)',18);
  for(let i=0;i<26;i++) burst(boss.x+boss.w/2, boss.y+boss.h/2, ph===3?'#ff4040':'#ffb060', 1, 5);
  const line = ph===2?BOSS_LINES.p2:BOSS_LINES.p3;
  state=STATE.STORY;
  showStory([{act:'ACT V · 阶段 '+ph, title: ph===2?'狂暴化':'终极之力', portrait:4, lines:[
    { zh: line.zh, speak:true, en: line.en },
    { zh: ph===2?'克劳迪奥形态骤变，毒箭与障壁横生！':'背景染血，王座厅笼罩在最终的杀意之中——哈姆雷特，用尽你全部的力量！' }
  ]}], ()=>{ state=STATE.PLAY;
    if(ph===2){ // 生成障碍毒池
      level.hazards.push({x:boss.x-200,y:GROUND_TOP-4,w:70,h:10,type:'poison'});
      level.hazards.push({x:boss.x+140,y:GROUND_TOP-4,w:70,h:10,type:'poison'});
      Sound.setMusic(opheliaSaved?'hero':'imperial',1.3);
    }
    if(ph===3){ Sound.setMusic(opheliaSaved?'hero':'imperial',1.6); }
    addFloater(boss.x+boss.w/2, boss.y-20, '阶段 '+ph, ph===3?'#ff4040':'#ffb060', 16);
  });
}
function updateBoss(){
  if(!boss) return;
  const b=boss;
  if(b.hitFlash>0)b.hitFlash--; if(b.invuln>0)b.invuln--;
  if(b.dead){ b.deathT--; return; }
  const px=player.x+player.w/2, ex=b.x+b.w/2;
  b.facing=px<ex?-1:1;
  const d=Math.abs(px-ex);
  const solids=solidsList();
  // 接触伤害
  if(!player.dead && player.invuln<=0 && rectsOverlap(player,b)) damagePlayer(b.phase>=3?18:12, ex);
  // 计时
  if(b.atkCd>0)b.atkCd--; if(b.summonCd>0)b.summonCd--; if(b.dashCd>0)b.dashCd--;
  if(b.poisonCd>0)b.poisonCd--; if(b.ultCd>0)b.ultCd--; if(b.atkT>0)b.atkT--;
  // 移动逼近
  if(b.state!=='dash'){ b.vx += (px<ex?-1:1)* (b.phase>=2?0.14:0.1); b.vx=clamp(b.vx,-(1.3+b.phase*0.3),(1.3+b.phase*0.3)); }
  // 近战
  if(d<64 && b.atkCd<=0){ b.atkT=22; b.atkCd=70; if(b.phase>=2)b.atkCd=54; }
  if(b.atkT===10){ const hb=b.facing>0?{x:b.x+b.w,y:b.y,w:52,h:b.h}:{x:b.x-52,y:b.y,w:52,h:b.h}; if(!player.dead&&player.invuln<=0&&rectsOverlap(hb,player)) damagePlayer(b.phase>=3?20:14, ex); }
  // P1 召唤
  if(b.phase===1 && b.summonCd<=0 && enemies.length<4){ b.summonCd=260; summonMinions(); }
  // P2 毒箭
  if(b.phase===2 && b.poisonCd<=0){ b.poisonCd=110; enemyShootFromBoss('poison'); if(Math.random()<0.5) enemyShootFromBoss('poison'); }
  if(b.phase>=2 && b.summonCd<=0 && enemies.length<3){ b.summonCd=340; summonMinions(); }
  // 冲锋（P2/P3）
  if(b.phase>=2 && b.dashCd<=0 && d>120 && d<360 && b.onGround){ b.state='dash'; b.dashT=24; b.dashCd=200; b.vx=(px<ex?-1:1)*8; addFloater(ex,b.y-16,'冲锋!','#ff8080',13); }
  if(b.state==='dash'){ b.dashT--; if(b.dashT<=0){ b.state='idle'; b.vx*=0.4; } }
  // P3 终极技
  if(b.phase===3 && b.ultCd<=0){ b.ultCd=320; bossUlt(); }
  stepPhysics(b, solids);
  b.x=clamp(b.x, level.bossArena.x-40, level.width-b.w);
}
function summonMinions(){
  Sound.blip(120,.4,'sawtooth',.3,0,60); shake(4,8);
  const n=1+ (Math.random()<0.5?1:0);
  for(let i=0;i<n;i++){ const sx=boss.x+rand(-120,120); const e=makeEnemy(Math.random()<0.5?'skeleton':'patrol', clamp(sx,level.bossArena.x,level.width-40), GROUND_TOP); e.x=clamp(sx,level.bossArena.x,level.width-40); enemies.push(e); burst(e.x+e.w/2,e.y+e.h/2,'#8a5aff',10,3); }
  addFloater(boss.x+boss.w/2, boss.y-16, '召唤喽啰!', '#c9a6ff', 13);
}
function enemyShootFromBoss(kind){
  const sx=boss.x+boss.w/2, sy=boss.y+boss.h*0.3;
  const ang=Math.atan2((player.y+player.h/2)-sy,(player.x+player.w/2)-sx);
  projectiles.push({owner:'enemy', x:sx,y:sy, vx:Math.cos(ang)*4.6, vy:Math.sin(ang)*4.6-1, w:12,h:4, dmg:boss.phase>=3?14:10, kind, life:170, ang});
  Sound.rangedFire();
}
function bossUlt(){
  // 终极技：大范围血色冲击（telegraph 后爆发）
  addFloater(boss.x+boss.w/2, boss.y-24, '毒杀之刃!', '#ff3030', 18); Sound.charge(); shake(6,20);
  const bx=boss.x+boss.w/2;
  bossUltTimer=48; bossUltX=bx;
}
let bossUltTimer=0, bossUltX=0;
function updateBossUlt(){
  if(bossUltTimer>0){ bossUltTimer--;
    // telegraph 光带
    if(bossUltTimer%4===0) for(let i=0;i<6;i++) burst(bossUltX+rand(-200,200), GROUND_TOP-rand(0,120), '#ff5050', 1, 3);
    if(bossUltTimer===1){ // 爆发
      flash('rgba(220,20,20,0.5)',16); shake(14,26); Sound.ult();
      for(let i=0;i<40;i++) burst(bossUltX+rand(-220,220), GROUND_TOP-rand(0,140), '#ff3030', 1, 6);
      // 若玩家在地面且未处于侧翼高台，受重创
      const onHigh = player.y+player.h < GROUND_TOP-90;
      if(!player.dead && !onHigh && Math.abs((player.x+player.w/2)-bossUltX)<240){ player.invuln=0; damagePlayer(26, bossUltX); }
      else addFloater(player.x, player.y-20, '躲开了!', '#8ee88e', 14);
    }
  }
}
function onBossDefeated(){
  boss.dead=true; boss.deathT=120; bossStarted=false;
  Sound.stopMusic(); shake(16,40); flash('rgba(255,255,255,0.5)',20);
  for(let i=0;i<50;i++) burst(boss.x+boss.w/2, boss.y+boss.h*rand(0.1,0.9), i%2?'#e8c25a':'#fff', 1, 5);
  addScore(2000);
  // 清场敌人
  enemies.forEach(e=>{ if(!e.dying) killEnemy(e); });
  addFloater(boss.x+boss.w/2, boss.y-30, '克劳迪奥伏诛! +2000', '#e8c25a', 18);
  Sound.jingle(opheliaSaved?'epicwin':'somber');
  setTimeout(()=>{ startEnding(); }, 1600);
}

/* -------------------------------------------------------------------------
   22. 死亡 / 检查点复活
   ------------------------------------------------------------------------- */
function onPlayerDeath(){
  player.dead=true;
  Sound.lose();
  burst(player.x+player.w/2, player.y+player.h/2, '#8b1a1a', 16, 4);
  state=STATE.LOSE;
  const bossFail = bossStarted;
  dom.loseTitle.textContent = bossFail? '决战失利' : '殒 命';
  dom.loseText.innerHTML = bossFail
    ? '“时代脱节了……”哈姆雷特倒下，但复仇仍未终结。<br>从 Boss 战前的检查点重整旗鼓。'
    : '“其余的，只是沉默。”——但命运给了你再来一次的机会。<br>从最近的检查点重生。';
  dom.loseScore.textContent = '当前得分 '+score;
  dom.restartBtn.textContent = bossFail? '从 Boss 战前重来' : '从检查点重生';
  hideAllOverlays(); show(dom.loseScreen);
}
function respawnAtCheckpoint(){
  hide(dom.loseScreen);
  // Boss 战失败：重置 Boss
  if(boss){ boss=null; bossStarted=false; bossUltTimer=0;
    // 清除 boss 阶段生成的毒池
    level.hazards=level.hazards.filter(h=>!(h.type==='poison'&&h.x>level.bossArena.x-260&&h.y<GROUND_TOP));
    enemies=enemies.filter(e=>e.x<level.bossArena.x); // 清 boss 场喽啰
  }
  projectiles=[]; rocks=[];
  player=makePlayer(respawn.x, respawn.y);
  if(!hasBow) player.ammo=0;
  player.invuln=90;
  camX=clamp(player.x-VW/2,0,level.width-VW); camY=clamp(player.y-VH*0.55,0,level.height-VH);
  let mus=ACTS[actIndex].music; if(actIndex===4) mus=opheliaSaved?'hero':'imperial';
  Sound.setMusic(mus,1);
  state=STATE.PLAY; updateHUD();
}

/* -------------------------------------------------------------------------
   23. 关卡完成 / 幕间过场链
   ------------------------------------------------------------------------- */
function checkLevelProgress(){
  // 目标门解锁提示
  if(goalLocked){
    // 到达终点但未解锁：提示
    if(player.x>level.goalX-80){
      hintPulse=1;
      if(!player.dead) addFloaterThrottled();
    }
    return;
  }
  if(actIndex===3) return; // 湖畔靠救援/超时
  if(!goalReached && player.x+player.w > level.goalX){ goalReached=true; completeLevel(); }
}
let _lastHint=0;
function addFloaterThrottled(){
  if(frame-_lastHint<90){ return; } _lastHint=frame;
  let msg='前路封锁：';
  if(actIndex===0) msg+='先去触发鬼魂过场！';
  else if(actIndex===1) msg+='收集全部情报（'+(level.intelGot||0)+'/'+level.intelTotal+'）！';
  else if(actIndex===2) msg+='先触发戏中戏！';
  addFloater(player.x+player.w/2, player.y-30, msg, '#ff8a8a', 14);
}
function levelBonus(){
  const hpBonus=Math.round(player.hp*3);
  addScore(hpBonus);
  return hpBonus;
}
function completeLevel(customText){
  state=STATE.CLEAR;
  Sound.stopMusic(); Sound.jingle('victory');
  const hpBonus=levelBonus();
  dom.clearText.textContent = customText || (ACTS[actIndex].name+' 完成');
  dom.clearScore.innerHTML =
    row('本幕击杀', stats.kills) +
    row('累计得分', score) +
    row('残血奖励', '+'+hpBonus) +
    '<div class="row total"><span>SCORE</span><span>'+score+'</span></div>';
  hideAllOverlays(); show(dom.levelClearScreen);
}
function row(a,b){ return '<div class="row"><span>'+a+'</span><span>'+b+'</span></div>'; }

// 湖畔：救援成功 / 超时
function rescueOphelia(){
  if(level.rescue) level.rescue.saved=true;
  opheliaSaved=true;
  Sound.stopMusic(); Sound.rescue();
  flash('rgba(255,235,180,0.5)',30); shake(6,20);
  for(let i=0;i<60;i++){ spawnPetal(player.x+rand(-120,120), player.y-rand(0,120), '#ffd0e6'); }
  for(let i=0;i<30;i++) burst(player.x+rand(-40,40), player.y+rand(-20,40), '#ffe8b0', 1, 3);
  state=STATE.STORY;
  showStory(STORY.a4_saved, ()=>{ completeLevel('★ 奥菲莉亚得救 ★'); });
}
function opheliaLost(){
  opheliaSaved=false;
  Sound.stopMusic(); Sound.jingle('somber');
  flash('rgba(40,30,70,0.5)',24);
  for(let i=0;i<40;i++) ripple(player.x+rand(-100,100), GROUND_TOP+rand(0,20));
  state=STATE.STORY;
  showStory(STORY.a4_lost, ()=>{ completeLevel('✝ 奥菲莉亚已逝 ✝'); });
}

// 幕间推进
function proceedAfterClear(){
  hide(dom.levelClearScreen);
  const done=actIndex;
  if(done===0){ chainStory([STORY.a1_end, STORY.a2_open], ()=>startAct(1)); }
  else if(done===1){ chainStory([STORY.a3_open], ()=>startAct(2)); }
  else if(done===2){ chainStory([STORY.a3_end, STORY.a4_open], ()=>startAct(3)); }
  else if(done===3){ chainStory([ opheliaSaved?STORY.a5_open_saved:STORY.a5_open_lost ], ()=>startAct(4)); }
}
function chainStory(list, done){
  let i=0;
  const next=()=>{ if(i>=list.length){ done(); return; } const pages=list[i++]; showStory(pages, next); };
  next();
}
function startAct(idx){
  loadLevel(idx, true);
  camX=clamp(player.x-VW/2,0,level.width-VW); camY=clamp(player.y-VH*0.55,0,level.height-VH);
  state=STATE.PLAY;
  showLevelName(ACTS[idx].name, ACTS[idx].en);
}
function showLevelName(name, en){
  dom.levelName.innerHTML=name+'<small>'+en+'</small>';
  dom.levelName.classList.add('fade');
  setTimeout(()=>dom.levelName.classList.remove('fade'), 2200);
}

/* -------------------------------------------------------------------------
   24. 结局（分支：成功=金色英雄 / 失败=暗紫缺憾）
   ------------------------------------------------------------------------- */
let ending=null;
const ENDING_TEXT_WIN = '丹麦的黑暗终于散去，哈姆雷特以父之名完成复仇，奥菲莉亚重获新生，两人并肩站在曙光中——这是命运给予的，唯一一次温柔。';
const ENDING_TEXT_LOSE = '复仇已成，但代价是她。丹麦的王冠染满鲜血，胜利的哈姆雷特站在空荡荡的王座前，那个名字，他再也没能说出口。';
const ENDING_QUOTE_WIN = { en:'Good night, sweet prince: and flights of angels sing thee to thy rest.', zh:'晚安，亲爱的王子，愿成群的天使用歌声送你安息。' };
const ENDING_QUOTE_LOSE = { en:'The rest is silence.', zh:'其余皆是沉默。' };

function startEnding(){
  state='ending';
  hideAllOverlays();
  ending={ t:0, success:opheliaSaved, text: opheliaSaved?ENDING_TEXT_WIN:ENDING_TEXT_LOSE,
    typed:0, phase:0, creditY:VH+40, done:false };
  Sound.setMusic(opheliaSaved?'hero':'imperial', opheliaSaved?1.4:1.0);
  if(!opheliaSaved) Sound.boostIntensity(0.9);
}
function updateEnding(){
  const e=ending; e.t++;
  // 打字机
  if(e.t>60 && e.typed<e.text.length){ if(e.t%3===0){ e.typed++; if(Sound.enabled&&e.typed%2===0)Sound.blip(rand(380,560),.02,'square',.05); } }
  // 环境
  if(e.success){ if(e.t%4===0) spawnPetal(camX+rand(0,W), camY-10, Math.random()<0.5?'#ffd0e6':'#ffe8a0'); if(e.t%30===0) launchFirework(camX+rand(120,W-120), camY+rand(40,160)); }
  else { if(e.t%5===0) petals.push({x:camX+rand(0,W),y:camY-10,vx:rand(-.6,.2),vy:rand(.5,1.2),rot:rand(0,6.28),vr:rand(-.1,.1),size:rand(3,6),color:'#6a5a3a',ph:rand(0,6.28),life:400}); }
  // 字幕上升阶段
  if(e.typed>=e.text.length){ e.phase=1; e.creditY-=0.4; }
}
function endingProceed(){ if(state==='ending'){ showStats(); } }
function computeRating(){
  const t=stats.time;
  let g='C';
  if(score>=6500 && stats.kills>=40) g='S';
  else if(score>=5000) g='A';
  else if(score>=3500) g='B';
  else g='C';
  return g;
}
function fmtTime(s){ const m=(s/60)|0, ss=(s%60)|0; return m+'分'+(ss<10?'0':'')+ss+'秒'; }
function showStats(){
  state=STATE.WIN;
  const win=opheliaSaved;
  const rating=computeRating();
  const q= win?ENDING_QUOTE_WIN:ENDING_QUOTE_LOSE;
  const titleEl=dom.winScreen.querySelector('.title');
  titleEl.textContent = win? '终 · 曙光结局' : '终 · 缺憾结局';
  titleEl.style.color = win? '#e8c25a' : '#b98bff';
  titleEl.style.textShadow = win? '3px 3px 0 #000,0 0 24px rgba(232,194,90,.5)' : '3px 3px 0 #000,0 0 24px rgba(185,139,255,.5)';
  dom.winQuote.innerHTML = '「'+q.en+'」<br><span style="color:'+(win?'#c4b98f':'#a892c4')+'">'+q.zh+'</span>';
  dom.winScore.innerHTML =
    row('通关用时', fmtTime(stats.time)) +
    row('总击杀', stats.kills) +
    row('破坏箱', stats.boxes) +
    row('奥菲莉亚', win?'得救':'已逝') +
    '<div class="row total" style="color:'+(win?'#e8c25a':'#b98bff')+'"><span>评级 '+rating+'</span><span>'+score+'</span></div>';
  dom.winScore.style.color = win? '#d8d0e0':'#d0c4e0';
  hideAllOverlays(); show(dom.winScreen);
  Sound.jingle(win?'epicwin':'somber');
}

/* -------------------------------------------------------------------------
   25. 相机
   ------------------------------------------------------------------------- */
function updateCamera(){
  if(!player||!level) return;
  const tx=clamp(player.x+player.w/2 - VW/2, 0, Math.max(0,level.width-VW));
  const ty=clamp(player.y+player.h/2 - VH*0.55, 0, Math.max(0,level.height-VH));
  camX=lerp(camX, tx, 0.11);
  camY=lerp(camY, ty, 0.11);
}

/* -------------------------------------------------------------------------
   26. 主循环：更新
   ------------------------------------------------------------------------- */
function update(){
  frame++;
  // 计时器
  if(shakeT>0){ shakeT--; if(shakeT<=0)shakeMag=0; }
  if(flashT>0)flashT--;
  if(comboTimer>0){ comboTimer--; if(comboTimer<=0){ comboCount=0; dom.combo.textContent=''; } }

  if(state===STATE.STORY){ tickStory(); }
  else if(state===STATE.PLAY){ updatePlay(); }
  else if(state==='ending'){ updateEnding(); }

  updateParticles();
  // 边沿复位（每帧末尾）
  jumpEdge=false; atkEdge=false; rangedEdge=false;
}
let hudTick=0;
function updatePlay(){
  stats.time += 1/60;
  updateMovers();
  updatePlayer();
  if(player.dead) return; // 死亡后进入 LOSE
  updateEnemies();
  updateCompanion();
  updateProjectiles();
  updateRocks();
  updatePickups();
  updateTriggersAndCheckpoints();
  // 湖畔倒计时
  if(actIndex===3){ level.timeLeft -= 1/60; dom.timer.textContent=Math.max(0,Math.ceil(level.timeLeft));
    if(level.rescue && level.rescue.saved){}
    else if(level.timeLeft<=0){ opheliaLost(); return; }
  }
  // 最终幕 Boss
  if(actIndex===4){
    if(!bossStarted && !boss && player.x+player.w > level.bossArena.x + 40){ startBoss(); return; }
    if(boss){ updateBoss(); updateBossUlt(); }
    // 阴郁模式环境
    if(darkMode){ if(frame%40===0){ crows.push({x:camX-30,y:camY+rand(20,120),vx:rand(1.2,2.2),flap:0}); } if(frame%6===0) petals.push({x:camX+rand(0,VW),y:camY-10,vx:rand(-.5,.1),vy:rand(.4,1),rot:rand(0,6.28),vr:.08,size:rand(3,5),color:'#5a4a3a',ph:rand(0,6.28),life:300}); }
  }
  // 第四幕花瓣氛围
  if(actIndex===3 && frame%20===0) spawnPetal(camX+rand(0,VW), camY-10, '#dfeaf5');
  checkLevelProgress();
  updateCamera();
  if(++hudTick%4===0) updateHUD();
  // 能量条通过 HUD? 简单用 combo 行右侧无；能量用 boss 条附近绘制在 render
}

/* -------------------------------------------------------------------------
   27. 主循环：渲染
   ------------------------------------------------------------------------- */
function render(){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  if(state===STATE.TITLE){ drawTitleScene(); }
  else if(state==='ending'){ drawEndingScene(); return; }
  else {
    drawBackground();
    // 世界层
    ctx.save();
    let sx=0, sy=0;
    if(shakeT>0){ sx=rand(-shakeMag,shakeMag); sy=rand(-shakeMag,shakeMag); }
    ctx.translate(sx,sy);
    ctx.scale(ZOOM,ZOOM);
    ctx.translate(-camX,-camY);
    drawWorld();
    ctx.restore();
    // 前景氛围（屏幕空间）
    drawForeground();
    // 屏幕闪光
    if(flashT>0){ ctx.fillStyle=flashColor; ctx.globalAlpha=clamp(flashT/16,0,1); ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
    // Boss 血条 & 能量条
    if(bossStarted && boss && !boss.dead) drawBossBar();
    if(bossStarted && player && !player.dead) drawEnergyBar();
    if(actIndex===3 && state===STATE.PLAY) {/* timer in HUD */}
  }
}
function drawWorld(){
  // 只绘制视野内
  const vx0=camX-40, vx1=camX+VW+40;
  for(const p of level.platforms){ if(p.x+p.w<vx0||p.x>vx1)continue; drawPlatform(p); }
  for(const m of level.movers){ if(m.x+m.w<vx0||m.x>vx1)continue; drawPlatform(m); }
  for(const hz of level.hazards){ if(hz.x+hz.w<vx0||hz.x>vx1)continue; drawHazard(hz); }
  for(const bk of level.breakables){ if(bk.dead||bk.x+bk.w<vx0||bk.x>vx1)continue; drawBreakable(bk); }
  for(const ch of level.chests){ if(ch.taken||ch.x>vx1||ch.x+ch.w<vx0)continue; drawChest(ch); }
  for(const tr of level.triggers){ if(tr.x+tr.w<vx0||tr.x>vx1)continue; drawTrigger(tr); }
  for(const cp of level.checkpoints){ if(cp.x<vx0||cp.x>vx1)continue; drawCheckpoint(cp); }
  if(level.bowPickup) drawBowPickup(level.bowPickup);
  for(const it of level.pickups){ if(it.taken||it.x>vx1||it.x+it.w<vx0)continue; drawPickupItem(it); }
  // 目标门
  if(!goalReached && (actIndex<3)) drawGoal(level.goalX, GROUND_TOP);
  // 落石
  for(const r of rocks){ if(r.warn>0){ ctx.fillStyle='rgba(255,80,80,'+(0.3+0.3*Math.sin(frame*0.4))+')'; ctx.fillRect(r.x, GROUND_TOP-140, r.w, 6); ctx.fillStyle='rgba(255,120,120,0.6)'; ctx.font='12px serif'; ctx.textAlign='center'; ctx.fillText('!', r.x+r.w/2, GROUND_TOP-130); }
    ctx.fillStyle='#6a5a52'; ctx.fillRect(r.x,r.y,r.w,r.h); ctx.fillStyle='#4a3e38'; ctx.fillRect(r.x+3,r.y+3,r.w-6,r.h-6); }
  // 抛射物
  for(const pr of projectiles){ drawProjectile(pr); }
  // 敌人
  for(const e of enemies){ if(e.x+e.w<vx0||e.x>vx1)continue; drawEnemy(e); }
  // 随从
  if(companion && companion.active) drawCompanion(companion);
  // Boss
  if(boss && !boss.dead) drawBoss(boss);
  else if(boss && boss.dead && boss.deathT>0){ ctx.save(); ctx.globalAlpha=clamp(boss.deathT/120,0,1); drawBoss(boss); ctx.restore(); }
  // 玩家
  if(player && !player.dead){ drawPlayerWorld(); }
  // 粒子/飘字/花瓣
  drawParticlesWorld();
}
function drawPlayerWorld(){
  const p=player;
  // 无敌闪烁
  if(p.invuln>0 && (frame>>2)%2===0 && p.hurtT<=0){} else {
    if(p.ultActive>0){ ctx.save(); ctx.globalAlpha=0.5; const g=ctx.createRadialGradient(p.x+p.w/2,p.y+p.h/2,4,p.x+p.w/2,p.y+p.h/2,60); g.addColorStop(0,'rgba(232,194,90,0.6)'); g.addColorStop(1,'rgba(232,194,90,0)'); ctx.fillStyle=g; ctx.fillRect(p.x-40,p.y-30,p.w+80,p.h+60); ctx.restore(); }
    drawHamlet(p.x+p.w/2, p.y+p.h, p.facing, p.pose, actIndex);
  }
}
function drawProjectile(pr){
  ctx.save(); ctx.translate(pr.x,pr.y);
  const ang=Math.atan2(pr.vy,pr.vx); ctx.rotate(ang);
  if(pr.kind==='poison'){ ctx.fillStyle='#9bff6a'; ctx.beginPath(); ctx.arc(0,0,4,0,6.283); ctx.fill(); ctx.fillStyle='rgba(155,255,106,0.4)'; ctx.beginPath();ctx.arc(0,0,7,0,6.283);ctx.fill(); }
  else { ctx.fillStyle= pr.owner==='player'?'#c9a6ff':(pr.kind==='aid'?'#a8d8ff':'#d8b088'); ctx.fillRect(-6,-1.5,12,3); ctx.beginPath();ctx.moveTo(6,-3);ctx.lineTo(10,0);ctx.lineTo(6,3);ctx.closePath();ctx.fill();
    if(pr.owner==='player'){ ctx.fillStyle='rgba(200,166,255,0.4)'; ctx.fillRect(-10,-1,8,2); } }
  ctx.restore();
}
function drawParticlesWorld(){
  for(const p of particles){ ctx.globalAlpha=clamp(p.life/p.max,0,1);
    if(p.ripple){ ctx.strokeStyle=p.color; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(p.x,p.y,p.ripple,0,6.283); ctx.stroke(); }
    else { ctx.fillStyle=p.color; ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size); } }
  ctx.globalAlpha=1;
  for(const f of fireworks){ ctx.globalAlpha=clamp(f.life/f.max,0,1); ctx.fillStyle=f.color; ctx.fillRect(f.x-f.size/2,f.y-f.size/2,f.size,f.size); }
  ctx.globalAlpha=1;
  for(const pt of petals){ ctx.save(); ctx.globalAlpha=clamp(pt.life/60,0,1); ctx.translate(pt.x,pt.y); ctx.rotate(pt.rot); ctx.fillStyle=pt.color; ctx.fillRect(-pt.size/2,-pt.size/3,pt.size,pt.size*0.66); ctx.restore(); }
  ctx.globalAlpha=1;
  for(const f of floaters){ ctx.globalAlpha=clamp(f.life/f.max,0,1); ctx.fillStyle=f.color; ctx.font='bold '+f.size+'px "Courier New",serif'; ctx.textAlign='center'; ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.strokeText(f.text,f.x,f.y); ctx.fillText(f.text,f.x,f.y); }
  ctx.globalAlpha=1; ctx.textAlign='left';
}
function drawForeground(){
  // 乌鸦（阴郁模式）
  for(const c of crows){ const scr=worldToScreen(c.x,c.y); ctx.save(); ctx.translate(scr.x,scr.y); ctx.strokeStyle='#0a0a10'; ctx.lineWidth=2; const fl=Math.sin(c.flap)*4; ctx.beginPath(); ctx.moveTo(-6,-fl); ctx.lineTo(0,0); ctx.lineTo(6,-fl); ctx.stroke(); ctx.restore(); }
  // 暗黑模式暗角
  if(darkMode){ const g=ctx.createRadialGradient(W/2,H/2,H*0.3,W/2,H/2,H*0.8); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(10,4,16,0.7)'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
  else { const g=ctx.createRadialGradient(W/2,H/2,H*0.35,W/2,H/2,H*0.85); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,0.4)'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
  // 段落名提示（世界分段）
  drawSegmentBanner();
}
function worldToScreen(wx,wy){ return { x:(wx-camX)*ZOOM, y:(wy-camY)*ZOOM }; }
let curSeg=-1;
function drawSegmentBanner(){
  if(!level.segments||state!==STATE.PLAY) return;
  let seg=0; for(let i=0;i<level.segments.length;i++){ if(player.x>=level.segments[i].x) seg=i; }
  if(seg!==curSeg){ curSeg=seg; segBannerT=90; }
  if(segBannerT>0){ segBannerT--; ctx.save(); ctx.globalAlpha=clamp(segBannerT/30,0,1)*0.9; ctx.fillStyle=ACTS[actIndex].accent; ctx.font='bold 16px serif'; ctx.textAlign='center'; ctx.fillText('· '+level.segments[seg].name+' ·', W/2, 64); ctx.restore(); }
}
let segBannerT=0;

/* -------------------------------------------------------------------------
   28. Boss 血条 / 能量条 / 标题 / 结局场景
   ------------------------------------------------------------------------- */
function drawBossBar(){
  const bw=560, bx=(W-bw)/2, by=26;
  ctx.fillStyle='rgba(8,6,14,0.7)'; ctx.fillRect(bx-4,by-18,bw+8,34);
  ctx.strokeStyle='rgba(232,194,90,0.5)'; ctx.lineWidth=1; ctx.strokeRect(bx-4,by-18,bw+8,34);
  ctx.fillStyle='#c4b98f'; ctx.font='12px "Courier New",serif'; ctx.textAlign='center';
  ctx.fillText('克劳迪奥 · CLAUDIUS  第 '+boss.phase+' 阶段', W/2, by-6);
  // 底
  ctx.fillStyle='#3a0d0d'; ctx.fillRect(bx,by,bw,10);
  const ratio=clamp(boss.hp/boss.maxHp,0,1);
  const col = boss.phase===3?'#ff2020':(boss.phase===2?'#ff7040':'#e23b3b');
  const g=ctx.createLinearGradient(bx,0,bx,by+10); g.addColorStop(0,'#ff9b9b'); g.addColorStop(1,col);
  ctx.fillStyle=g; ctx.fillRect(bx,by,bw*ratio,10);
  // 阶段分隔线 66% 33%
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(bx+bw*0.66,by,2,10); ctx.fillRect(bx+bw*0.33,by,2,10);
  ctx.textAlign='left';
}
function drawEnergyBar(){
  const bw=160, bx=14, by=H-58;
  ctx.fillStyle='rgba(8,6,14,0.6)'; ctx.fillRect(bx-2,by-2,bw+4,12);
  ctx.fillStyle='#2a2440'; ctx.fillRect(bx,by,bw,8);
  const r=clamp(player.energy/player.maxEnergy,0,1);
  const full=r>=1;
  const g=ctx.createLinearGradient(bx,0,bx+bw,0); g.addColorStop(0,'#7fd4ee'); g.addColorStop(1, full?'#e8c25a':'#b98bff');
  ctx.fillStyle=g; ctx.fillRect(bx,by,bw*r,8);
  ctx.fillStyle= full?'#e8c25a':'#8f96ab'; ctx.font='11px "Courier New",serif'; ctx.textAlign='left';
  ctx.fillText(full?'终极反击就绪! [J]':'能量 ENERGY', bx, by-6);
  if(full && (frame>>3)%2===0){ ctx.strokeStyle='#e8c25a'; ctx.strokeRect(bx-2,by-2,bw+4,12); }
}

function drawTitleScene(){
  // 画布背景剧场化（标题 DOM 覆盖其上）
  const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#1a1526'); g.addColorStop(1,'#040307');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#12101c';
  for(let bx=-((frame*0.2)%320);bx<W+320;bx+=320) silhouetteCastle(bx,H);
  // 月
  ctx.fillStyle='rgba(240,235,210,0.9)'; ctx.beginPath(); ctx.arc(W*0.8,H*0.24,30,0,6.283); ctx.fill();
}

function wrapText(text, x, y, maxW, lh){
  const chars=text.split('');
  let line='', yy=y;
  for(let i=0;i<chars.length;i++){ const test=line+chars[i]; if(ctx.measureText(test).width>maxW && line){ ctx.fillText(line,x,yy); line=chars[i]; yy+=lh; } else line=test; }
  if(line) ctx.fillText(line,x,yy);
  return yy;
}
function drawEndingScene(){
  const e=ending; const win=e.success;
  // 背景
  const g=ctx.createLinearGradient(0,0,0,H);
  if(win){ g.addColorStop(0,'#3a2a10'); g.addColorStop(0.5,'#6a4a18'); g.addColorStop(1,'#1a1206'); }
  else { g.addColorStop(0,'#160a1c'); g.addColorStop(0.5,'#0e0714'); g.addColorStop(1,'#050308'); }
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  // 王座厅：光柱
  for(let i=0;i<5;i++){ const cx=100+i*190; ctx.fillStyle= win?'rgba(232,194,90,0.06)':'rgba(120,90,160,0.05)'; ctx.fillRect(cx-30,0,60,H); }
  // 立柱
  ctx.fillStyle= win?'#4a3a1e':'#241a30';
  for(let i=0;i<6;i++){ const cx=60+i*170; ctx.fillRect(cx,120,34,H-120); ctx.fillRect(cx-6,110,46,14); }
  // 王座
  ctx.fillStyle= win?'#5a4420':'#2a1a30'; ctx.fillRect(W/2-40,H-220,80,120);
  ctx.fillStyle= win?'#e8c25a':'#4a3a5a'; ctx.fillRect(W/2-44,H-230,88,14);
  for(let i=0;i<3;i++) ctx.fillRect(W/2-30+i*24,H-250,10,24);
  // 中央光/尘
  if(win){ const lg=ctx.createRadialGradient(W/2,H*0.3,10,W/2,H*0.3,220); lg.addColorStop(0,'rgba(255,240,190,'+(0.3+0.1*Math.sin(frame*0.05))+')'); lg.addColorStop(1,'rgba(255,240,190,0)'); ctx.fillStyle=lg; ctx.fillRect(0,0,W,H); }
  // 人物剪影（哈姆雷特 + 同伴）
  const gy=H-104;
  drawHamletOn(ctx, W/2-30, gy, 2.6, 4);
  // 同伴
  ctx.save(); ctx.translate(W/2+34, gy);
  if(win){ // 奥菲莉亚
    ctx.fillStyle='#a8d0e8'; ctx.beginPath();ctx.moveTo(-14,-30);ctx.lineTo(14,-30);ctx.lineTo(20,0);ctx.lineTo(-20,0);ctx.closePath();ctx.fill();
    ctx.fillStyle='#a8d0e8'; ctx.fillRect(-10,-56,20,26);
    ctx.fillStyle='#c9a24a'; ctx.fillRect(-11,-78,22,20);
    ctx.fillStyle='#f0d8b0'; ctx.fillRect(-9,-74,18,14);
    ctx.fillStyle='#3a2a20'; ctx.fillRect(-5,-68,3,3); ctx.fillRect(3,-68,3,3);
  } else { // 霍拉旭扶住
    ctx.fillStyle='#3a3448'; ctx.fillRect(-10,-56,20,56);
    ctx.fillStyle='#c9a98c'; ctx.fillRect(-9,-74,18,18);
    ctx.fillStyle='#4a3a2a'; ctx.fillRect(-9,-78,18,6);
  }
  ctx.restore();
  // 花瓣/落叶
  drawParticlesScreen();
  // 文本
  ctx.fillStyle= win?'#ffe8b0':'#c9b6e0'; ctx.font='20px "Songti SC",serif'; ctx.textAlign='center';
  const shown=e.text.slice(0,e.typed);
  const baseY = e.phase? clamp(e.creditY,120,H*0.36) : H*0.36;
  ctx.save(); ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=8;
  wrapText(shown, W/2, baseY, W*0.72, 30);
  ctx.restore();
  // 尾句 & 字幕
  if(e.typed>=e.text.length){
    const q= win?ENDING_QUOTE_WIN:ENDING_QUOTE_LOSE;
    ctx.fillStyle= win?'#e8c25a':'#b98bff'; ctx.font='italic 16px serif';
    ctx.fillText('「'+q.en+'」', W/2, clamp(e.creditY+80,180,H*0.62));
    ctx.fillStyle= win?'#c4b98f':'#a892c4'; ctx.font='14px serif';
    ctx.fillText(q.zh, W/2, clamp(e.creditY+108,200,H*0.62+28));
    ctx.fillStyle='rgba(255,255,255,'+(0.4+0.3*Math.sin(frame*0.1))+')'; ctx.font='13px "Courier New",serif';
    ctx.fillText('点击 / 回车 查看通关统计 ▸', W/2, H-30);
  }
  ctx.textAlign='left';
}
function drawParticlesScreen(){
  for(const pt of petals){ const s=worldToScreen(pt.x,pt.y); if(state!=='ending'){} ctx.save(); ctx.globalAlpha=clamp(pt.life/60,0,1); ctx.translate(state==='ending'?pt.x-camX:s.x, state==='ending'?pt.y-camY:s.y); ctx.rotate(pt.rot); ctx.fillStyle=pt.color; ctx.fillRect(-pt.size/2,-pt.size/3,pt.size,pt.size*0.66); ctx.restore(); }
  for(const f of fireworks){ ctx.globalAlpha=clamp(f.life/f.max,0,1); ctx.fillStyle=f.color; ctx.fillRect(f.x-camX,f.y-camY,f.size,f.size); }
  ctx.globalAlpha=1;
}

/* -------------------------------------------------------------------------
   29. 覆盖层管理 & 事件
   ------------------------------------------------------------------------- */
function hideAllOverlays(){
  [dom.titleScreen,dom.storyScreen,dom.levelClearScreen,dom.winScreen,dom.loseScreen].forEach(hide);
}
function startGame(){
  Sound.unlock();
  score=0; comboCount=0; comboTimer=0; stats={time:0,kills:0,boxes:0,secrets:0};
  opheliaSaved=true; hasBow=false; darkMode=false;
  dom.scoreVal.textContent='0';
  show(dom.hud); show(dom.scorePanel); show(dom.muteBtn); show(dom.ctrlHint);
  hideAllOverlays();
  actIndex=0;
  camX=0; camY=0;
  showStory(STORY.a1_open, ()=>startAct(0));
}

// 按钮
dom.startBtn.addEventListener('click', startGame);
dom.storyBtn.addEventListener('click', storyAdvance);
dom.skipBtn.addEventListener('click', ()=>{ const cb=storyDoneCb; storyDoneCb=null; hide(dom.storyScreen); if(cb)cb(); });
dom.nextBtn.addEventListener('click', proceedAfterClear);
dom.restartBtn.addEventListener('click', respawnAtCheckpoint);
dom.restartWinBtn.addEventListener('click', ()=>{ hideAllOverlays(); show(dom.titleScreen); state=STATE.TITLE; Sound.stopMusic(); });
dom.muteBtn.addEventListener('click', ()=>{ Sound.unlock(); const on=Sound.toggle(); dom.muteBtn.textContent= on?'🔊 音效开':'🔇 音效关'; if(on){ let mus=ACTS[actIndex]?ACTS[actIndex].music:'castle'; if(actIndex===4)mus=opheliaSaved?'hero':'imperial'; if(bossStarted)mus=opheliaSaved?'hero':'boss'; if(state===STATE.PLAY)Sound.setMusic(mus,1); } });
// 结局推进：点击画布 / 回车
canvas.addEventListener('click', ()=>{ if(state==='ending') endingProceed(); });
window.addEventListener('keydown', e=>{ if((e.code==='Enter'||e.code==='Space') && state==='ending'){ endingProceed(); } });
// 首次任意键解锁音频
window.addEventListener('keydown', ()=>Sound.unlock(), {once:true});
window.addEventListener('pointerdown', ()=>Sound.unlock(), {once:true});

/* -------------------------------------------------------------------------
   30. 主循环
   ------------------------------------------------------------------------- */
let lastT=0, acc=0;
function loop(t){
  requestAnimationFrame(loop);
  if(!lastT)lastT=t;
  let dt=t-lastT; lastT=t; if(dt>100)dt=100;
  acc+=dt;
  // 固定步长 60fps
  let steps=0;
  while(acc>=1000/60 && steps<3){ update(); acc-=1000/60; steps++; }
  render();
}
requestAnimationFrame(loop);

// 首帧标题渲染
state=STATE.TITLE;
