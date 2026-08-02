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
// 六段结构：0城堡 1宫廷 2逃亡 3湖边彩蛋 4英格兰 5墓地/王座终章
const ACT_CASTLE=0, ACT_COURT=1, ACT_ESCAPE=2, ACT_LAKE=3, ACT_ENGLAND=4, ACT_FINAL=5;
let actIndex = 0;                    // 0..5 => 六段
let frame = 0;
let camX = 0, camY = 0;
let shakeT = 0, shakeMag = 0;
let flashT = 0, flashColor = 'rgba(255,255,255,0)';

// 计分
let score = 0, comboTimer = 0, comboCount = 0;
let stats = { time:0, kills:0, boxes:0, secrets:0 };

// 贯穿分支的全局变量
let opheliaSaved = true;             // 湖边彩蛋结果，默认 true，失败置 false，影响英格兰/终章与结局
let hasBow = false;                  // 是否已拾取亡魂之弓
let bowLost = false;                 // 亡魂之弓被鬼魂夺走（湖边彩蛋失败），远程永久失效
let darkMode = false;                // 失败路线的阴郁哥特模式（终章）
let poisonT = 0;                     // 终章溺死路线：哈姆雷特中毒倒计时（帧），>0 时持续掉血
let laertesDefeated = false;         // 终章中段 Boss 雷欧提斯是否已被击败

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
    dismissBossGuide();
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
  // 疯朋克奥菲莉亚：失真尖啸音效（去调锯齿簇 + 噪声，强化朋克疯癫形象）
  punkGlitch(){ if(!this.ctx||!this.enabled) return;
    [138,146,207].forEach((f,i)=>this.blip(f*(1+i*0.04),.5,'sawtooth',.15,i*.02,f*0.6));
    this.noise(.34,.13,0,600);
    this.blip(440,.28,'sawtooth',.09,.05,110);
  },
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
    bass:[N.A2,N.A2,N.A2,N.A2,N.F2,N.F2,N.F2,N.F2,N.E2,N.E2,N.E2,N.E2] },
  // 逃亡（第三幕）：急促不安的追逃，快速拨奏 + 心跳般的低音
  escape:{ tempo:.13, wave:'square', bassWave:'triangle', perc:[1,0,0,1,0,0,1,0],
    seq:[{f:N.A4},{f:N.B4},{f:N.C5},{f:N.B4},{f:N.A4},{f:N.G4},{f:N.A4},{f:N.E4},{f:N.F4},{f:N.G4},{f:N.A4},{f:N.C5},{f:N.B4},{f:N.A4}],
    bass:[N.A2,0,N.A2,0,N.E2,0,N.F2,0,N.G2,0,N.E2,0] },
  // 英格兰（第四幕）：异域海洋风，弗里几亚色彩 + 手鼓
  england:{ tempo:.19, wave:'triangle', bassWave:'sawtooth', perc:[1,0,1,1,0,1,0,1],
    seq:[{f:N.E4},{f:N.F4},{f:N.A4},{f:N.G4},{f:N.F4},{f:N.E4,d:2},{f:N.A4},{f:N.As4},{f:N.C5},{f:N.As4},{f:N.A4},{f:N.G4},{f:N.F4},{f:N.E4,d:2}],
    bass:[N.E2,0,N.F2,0,N.E2,0,N.A2,0,N.E2,0,N.F2,0] }
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
  dlgBar:$('dlgBar'), dlgLeft:$('dlgLeft'), dlgRight:$('dlgRight'), bossGuide:$('bossGuide'),
  storyScreen:$('storyScreen'), storyAct:$('storyAct'), storyTitle:$('storyTitle'), storyBody:$('storyBody'),
  skipBtn:$('skipBtn'), storyBtn:$('storyBtn'),
  titleScreen:$('titleScreen'), startBtn:$('startBtn'),
  levelClearScreen:$('levelClearScreen'), clearText:$('clearText'), clearScore:$('clearScore'), nextBtn:$('nextBtn'),
  winScreen:$('winScreen'), winQuote:$('winQuote'), winScore:$('winScore'), restartWinBtn:$('restartWinBtn'),
  loseScreen:$('loseScreen'), loseTitle:$('loseTitle'), loseText:$('loseText'), loseScore:$('loseScore'), restartBtn:$('restartBtn')
};
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }
let bossGuideTimer=null;
function showBossGuide(){
  if(actIndex!==ACT_CASTLE || !dom.bossGuide) return;
  clearTimeout(bossGuideTimer);
  show(dom.bossGuide);
  requestAnimationFrame(()=>dom.bossGuide.classList.add('show'));
  bossGuideTimer=setTimeout(dismissBossGuide, 5000);
}
function dismissBossGuide(){
  if(!dom || !dom.bossGuide || dom.bossGuide.classList.contains('hidden')) return;
  clearTimeout(bossGuideTimer); bossGuideTimer=null;
  dom.bossGuide.classList.remove('show');
  setTimeout(()=>{ if(dom.bossGuide && !dom.bossGuide.classList.contains('show')) hide(dom.bossGuide); }, 360);
}

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
  if(darkMode && actIndex===ACT_FINAL) sky = ['#0a0710','#160a1c','#050308'];
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
// 逃亡：错落的宫墙屋脊与逃亡剪影
function silhouetteRooftops(bx, groundH){
  const base=groundH*0.6;
  for(let i=0;i<4;i++){ const px=bx+i*80; const h=[30,60,20,45][i]; ctx.fillRect(px,base-h,64,groundH-(base-h)); ctx.beginPath(); ctx.moveTo(px-4,base-h); ctx.lineTo(px+32,base-h-22); ctx.lineTo(px+68,base-h); ctx.closePath(); ctx.fill(); }
}
// 英格兰：海崖 + 帆船桅杆
function silhouetteCoast(bx, groundH){
  const base=groundH*0.68;
  ctx.beginPath(); ctx.moveTo(bx,groundH); ctx.lineTo(bx,base); ctx.lineTo(bx+70,base-30); ctx.lineTo(bx+150,base-10); ctx.lineTo(bx+230,base-40); ctx.lineTo(bx+320,base-6); ctx.lineTo(bx+320,groundH); ctx.closePath(); ctx.fill();
  // 帆船
  const sx=bx+180; ctx.fillRect(sx,base-70,3,64); ctx.beginPath(); ctx.moveTo(sx+3,base-66); ctx.lineTo(sx+34,base-40); ctx.lineTo(sx+3,base-30); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(sx,base-66); ctx.lineTo(sx-30,base-42); ctx.lineTo(sx,base-32); ctx.closePath(); ctx.fill();
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
  { name:'第三幕 · 逃亡', en:'ACT III — The Flight', music:'escape',
    theme:{ sky:['#20182a','#181020','#0a0610'], far:'#1c1526', mid:'#2a2038', moon:true, fog:0.07,
      drawFar:(bx,gh)=>silhouetteRooftops(bx,gh), drawMid:(bx,gh)=>silhouetteDeadTrees(bx,gh) },
    ground:'#33283e', groundTop:'#4a3a5a', accent:'#c9a6ff' },
  { name:'彩蛋关 · 柳树湖畔', en:'HIDDEN — The Willow Lake', music:'lake',
    theme:{ sky:['#243448','#1c2a3a','#101a26'], far:'#1e2c3c', mid:'#2a3c50', moon:true, fog:0.07,
      drawFar:(bx,gh)=>silhouetteTrees(bx,gh), drawMid:(bx,gh)=>silhouetteTrees(bx+40,gh) },
    ground:'#2e4258', groundTop:'#3e5a76', accent:'#7fd4ee' },
  { name:'第四幕 · 英格兰', en:'ACT IV — England', music:'england',
    theme:{ sky:['#2a3040','#22303e','#101a26'], far:'#233240', mid:'#33485a', moon:true, fog:0.06,
      drawFar:(bx,gh)=>silhouetteCoast(bx,gh), drawMid:(bx,gh)=>silhouetteCoast(bx+60,gh) },
    ground:'#39505e', groundTop:'#4e6c7a', accent:'#7fe0c8' },
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
  if(act>=2){ S.coat='#120c1a'; S.wear=1; S.hair='#1c1512'; S.eye='#f0e4c8'; S.cape=true; }
  if(act===ACT_LAKE){ S.coat='#0e0a16'; S.wear=2; S.wet=true; S.coatHi='#241c30'; }
  if(act===ACT_ENGLAND){ // 英格兰：异域海旅战服，风尘仆仆
    S.wear=2; S.coat='#122028'; S.coatHi='#1e3640'; S.coatShadow='#08131a'; S.trim='#3a6a6a'; S.epaulet='#7a9a8a'; S.accent='#7fe0c8'; S.eye='#e8f0e0';
  }
  if(act===ACT_FINAL){
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

  // 递进式服饰细节：随幕数增加装饰（第一幕简洁 → 终章最精细；成功路线金饰，失败路线暗紫破损）
  const orn = S.gold? S.accent : (S.doom? '#6a3a7c' : S.trim);
  if(act>=1){ px(-2+lean*0.4, torsoY-2, 4, 2, orn); }                          // 领口金属扣
  if(act>=2){ px(-6+lean*0.4, torsoY+3, 12, 1, orn); px(-5+lean*0.4, torsoY+7, 11, 1, S.coatShadow); } // 胸前斜纹绶带
  if(act>=3){ px(-10+lean*0.4, torsoY+3, 2, 4, orn); px(9+lean*0.4, torsoY+3, 2, 4, orn); }             // 肩部流苏
  if(act>=4){ px(3+lean*0.4, torsoY+5, 3, 3, orn); px(4+lean*0.4, torsoY+6, 1, 1, S.gold?'#fff0c0':(S.doom?'#2a1030':'#1a1420')); } // 胸前勋章/纹章
  if(S.doom && act>=5){ px(-4+lean*0.4, torsoY+10, 5, 1, '#2a0f30'); px(1+lean*0.4, torsoY+15, 3, 1, '#2a0f30'); } // 终章失败：破损裂纹

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

// Boss 绘制分发（按 kind）：克劳迪奥 / 恶灵老王 / 小丑波洛涅斯 / 英格兰刺客 / 雷欧提斯
function drawBoss(b){
  const cx=b.x+b.w/2, cy=b.y+b.h, f=b.facing;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(cx,cy,b.w*0.5,5,0,0,6.283); ctx.fill();
  // 阶段光环（颜色随 kind）
  const auraBase = { claudius:(b.phase===1?'rgba(200,170,90,':(b.phase===2?'rgba(200,90,90,':'rgba(255,40,40,')),
    ghostking:'rgba(143,208,255,', clown:'rgba(255,155,208,', assassin:'rgba(127,224,200,', laertes:'rgba(255,90,90,',
    rosencrantz:'rgba(127,184,232,', guildenstern:'rgba(127,224,168,' }[b.kind] || 'rgba(200,170,90,';
  ctx.save(); ctx.globalAlpha=0.35+0.2*Math.sin(frame*0.1); const g=ctx.createRadialGradient(cx,cy-b.h*0.5,4,cx,cy-b.h*0.5,b.h); g.addColorStop(0,auraBase+'0.5)'); g.addColorStop(1,auraBase+'0)'); ctx.fillStyle=g; ctx.fillRect(cx-b.w,cy-b.h*1.5,b.w*2,b.h*1.6); ctx.restore();
  ctx.translate(cx,cy); ctx.scale(f,1);
  const w=b.hitFlash>0; const t=frame; const H=b.h;
  if(b.kind==='ghostking') drawBossGhostKing(b,w,t,H);
  else if(b.kind==='clown') drawBossClown(b,w,t,H);
  else if(b.kind==='rosencrantz') drawBossCourtier(b,w,t,H,'#2a5a8a','#7fb8e8','#c9a24a');
  else if(b.kind==='guildenstern') drawBossCourtier(b,w,t,H,'#2a6a4a','#7fe0a8','#c9a24a');
  else if(b.kind==='assassin') drawBossAssassin(b,w,t,H);
  else if(b.kind==='laertes') drawBossLaertes(b,w,t,H);
  else drawBossClaudius(b,w,t,H);
  ctx.restore();
}
// 克劳迪奥（终章最终 Boss）
function drawBossClaudius(b,w,t,H){
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
  px(-9,-H,18,3,tint('#8a6a4a',w));
  ctx.fillStyle=tint('#e8c25a',w);
  px(-10,-H-6,20,5,tint('#e8c25a',w));
  for(let i=0;i<4;i++) px(-9+i*6,-H-10,3,5,tint('#e8c25a',w));
  px(-9+2,-H-9,2,2,'#e23b3b');px(-9+14,-H-9,2,2,'#7fd4ee');
  px(-6,-H+6,3,1,'#2a1810');px(2,-H+6,3,1,'#2a1810');
  px(-5,-H+7,3,2,tint(b.phase>=3?'#ff3030':'#e8dcc0',w));px(2,-H+7,3,2,tint(b.phase>=3?'#ff3030':'#e8dcc0',w));
  px(-3,-H+7,1,2,'#1a1410');px(3,-H+7,1,2,'#1a1410');
  px(-4,-H+12,8,1,'#3a1818');
  px(-5,-H+13,10,3,tint('#3a2a20',w));
  // 权杖剑
  px(12,-H+10,5,5,tint('#c9a24a',w));
  px(13,-H-12,3,26,tint('#d8d4c4',w));
  px(12,-H-14,5,4,tint('#e8c25a',w));
  const phaseColor=b.phase===1?'rgba(200,170,90,':(b.phase===2?'rgba(200,90,90,':'rgba(255,40,40,');
  if(b.atkT>0){ ctx.strokeStyle=phaseColor+'0.6)';ctx.lineWidth=4;ctx.beginPath();ctx.arc(12,-H+14,28,-1.2,0.9);ctx.stroke(); }
}
// 恶灵 · 老哈姆雷特国王（第一幕关底 Boss，死神操纵的先王亡魂）
function drawBossGhostKing(b,w,t,H){
  const sway=Math.sin(t*0.06)*3;
  ctx.globalAlpha=0.9;
  // 幽灵飘尾（无腿）
  ctx.fillStyle=tint('#2a4a66',w);
  ctx.beginPath();ctx.moveTo(-14,-22);ctx.lineTo(14,-22);
  ctx.lineTo(10+sway,-4);ctx.lineTo(4,2);ctx.lineTo(-2,-4);ctx.lineTo(-8,3);ctx.lineTo(-14+sway,-6);ctx.closePath();ctx.fill();
  // 甲胄躯干（先王的板甲）
  px(-13,-H+16,26,32,tint('#3a5a72',w));
  px(8,-H+16,5,32,tint('#4a6e88',w));
  px(-13,-H+16,4,32,tint('#22384a',w));
  px(-13,-H+16,26,4,tint('#8fd0ff',w));
  // 死神披风（暗影兜帽向上翻）
  ctx.fillStyle=tint('#0e1a26',w); ctx.beginPath();ctx.moveTo(-13,-H+18);ctx.lineTo(-26-Math.sin(t*0.07)*4,-4);ctx.lineTo(-4,-18);ctx.closePath();ctx.fill();
  // 头盔 + 王冠
  px(-9,-H,18,16,tint('#5a7a92',w));
  ctx.fillStyle=tint('#c9d8e8',w); px(-10,-H-6,20,5,tint('#c9d8e8',w));
  for(let i=0;i<4;i++) px(-9+i*6,-H-10,3,5,tint('#c9d8e8',w));
  // 空洞发光的眼
  ctx.fillStyle='rgba(160,230,255,'+(0.7+0.3*Math.sin(t*0.2))+')';
  px(-5,-H+6,4,3,'rgba(160,230,255,0.9)'); px(2,-H+6,4,3,'rgba(160,230,255,0.9)');
  // 幽光饰
  ctx.fillStyle='rgba(143,208,255,0.5)'; px(-4,-H+12,8,1,'rgba(143,208,255,0.5)');
  // 幽魂巨剑（先王佩剑）
  px(12,-H+8,5,5,tint('#4a6e88',w));
  px(13,-H-16,3,30,tint('#bfe4ff',w));
  px(13,-H-16,1,30,'#eaffff');
  if(b.atkT>0){ ctx.strokeStyle='rgba(143,208,255,0.7)';ctx.lineWidth=4;ctx.beginPath();ctx.arc(12,-H+12,28,-1.2,0.9);ctx.stroke(); }
  ctx.globalAlpha=1;
}
// 小丑 · 波洛涅斯（第二幕关底 Boss，伪装成小丑的老臣）
function drawBossClown(b,w,t,H){
  const bob=Math.sin(t*0.12)*2;
  // 花纹长袍下摆
  ctx.fillStyle=tint('#7a2a5a',w);
  ctx.beginPath();ctx.moveTo(-14,-24);ctx.lineTo(14,-24);ctx.lineTo(19,0);ctx.lineTo(-19,0);ctx.closePath();ctx.fill();
  // 腿（条纹裤）
  px(-10,-26,8,26,tint('#d84a8a',w)); px(3,-26,8,26,tint('#2a8a8a',w));
  // 躯干 菱格小丑服
  px(-13,-H+16+bob,26,32,tint('#c93a7a',w));
  for(let i=0;i<4;i++) for(let j=0;j<4;j++){ if((i+j)%2) px(-13+i*7,-H+16+bob+j*8,7,8,tint('#2a9a9a',w)); }
  // 皱领
  px(-14,-H+14+bob,28,5,tint('#f0e8d0',w));
  // 头（惨白脸）
  px(-9,-H+bob,18,16,tint('#f0e8e0',w));
  // 小丑帽（三角铃铛）
  ctx.fillStyle=tint('#d84a8a',w); ctx.beginPath();ctx.moveTo(-9,-H+bob);ctx.lineTo(-14,-H-12+bob);ctx.lineTo(-2,-H+2+bob);ctx.closePath();ctx.fill();
  ctx.fillStyle=tint('#2a9a9a',w); ctx.beginPath();ctx.moveTo(9,-H+bob);ctx.lineTo(14,-H-12+bob);ctx.lineTo(2,-H+2+bob);ctx.closePath();ctx.fill();
  ctx.fillStyle=tint('#e8c25a',w); ctx.beginPath();ctx.arc(-14,-H-12+bob,2.5,0,6.283);ctx.fill(); ctx.beginPath();ctx.arc(14,-H-12+bob,2.5,0,6.283);ctx.fill();
  // 夸张笑脸妆
  px(-5,-H+5+bob,3,3,'#3a1818'); px(3,-H+5+bob,3,3,'#3a1818');
  ctx.strokeStyle=tint('#c93a3a',w); ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,-H+9+bob,5,0.1,Math.PI-0.1); ctx.stroke();
  // 权杖（藏刃）
  px(12,-H+10+bob,4,4,tint('#c9a24a',w)); px(13,-H-10+bob,2,24,tint('#d8d4c4',w));
  ctx.fillStyle=tint('#c93a7a',w); ctx.beginPath();ctx.arc(14,-H-12+bob,4,0,6.283);ctx.fill();
  if(b.atkT>0){ ctx.strokeStyle='rgba(255,155,208,0.7)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(12,-H+14+bob,24,-1.2,0.9);ctx.stroke(); }
}
// 英格兰雇佣刺客队长（第四幕关底 Boss）
function drawBossAssassin(b,w,t,H){
  ctx.fillStyle=tint('#14322e',w);
  ctx.beginPath();ctx.moveTo(-12,-22);ctx.lineTo(12,-22);ctx.lineTo(16,0);ctx.lineTo(-16,0);ctx.closePath();ctx.fill();
  px(-9,-26,7,26,tint('#0e2420',w)); px(3,-26,7,26,tint('#0a1c18',w));
  // 皮甲躯干
  px(-12,-H+14,24,32,tint('#1e463e',w));
  px(7,-H+14,5,32,tint('#2e665a',w));
  px(-12,-H+14,4,32,tint('#0e2420',w));
  px(-12,-20,24,4,tint('#7fe0c8',w)); // 腰带
  // 斗篷兜帽
  ctx.fillStyle=tint('#0a1c18',w); ctx.beginPath();ctx.moveTo(-11,-H+16);ctx.lineTo(-22-Math.sin(t*0.09)*3,-4);ctx.lineTo(-4,-16);ctx.closePath();ctx.fill();
  // 兜帽头
  px(-9,-H,18,15,tint('#123830',w));
  px(-9,-H+9,18,3,tint('#0a1c18',w));
  // 面巾下的冷眼
  px(-5,-H+5,3,2,tint('#8ffce0',w)); px(3,-H+5,3,2,tint('#8ffce0',w));
  // 双短刃
  px(10,-H+12,3,3,'#5a4a3a'); px(11,-H+2,2,16,tint('#d8f0e8',w));
  px(-13,-H+14,3,3,'#5a4a3a'); px(-13,-H+4,2,14,tint('#d8f0e8',w));
  if(b.atkT>0){ ctx.strokeStyle='rgba(127,224,200,0.7)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(10,-H+14,22,-1.2,0.9);ctx.stroke(); }
}
// 雷欧提斯（终章中段 Boss，毒剑决斗）
function drawBossLaertes(b,w,t,H){
  px(-9,-26,7,26,tint('#2a2438',w)); px(3,-26,7,26,tint('#1e1a2a',w));
  px(-11,-H+14,22,32,tint('#3a3050',w));
  px(6,-H+14,5,32,tint('#4a4066',w));
  px(-11,-H+14,4,32,tint('#241e34',w));
  px(-11,-H+14,22,4,tint('#8a7ac0',w));
  // 披风
  ctx.fillStyle=tint('#241a3a',w); ctx.beginPath();ctx.moveTo(-10,-H+16);ctx.lineTo(-22-Math.sin(t*0.08)*3,-2);ctx.lineTo(-4,-16);ctx.closePath();ctx.fill();
  // 头（贵族青年，怒容）
  px(-8,-H,16,15,tint('#c9a98c',w));
  px(-8,-H-2,16,5,tint('#6a4a2a',w)); // 深色短发
  px(-5,-H+5,3,2,'#2a1810'); px(2,-H+5,3,2,'#2a1810');
  px(-5,-H+4,3,1,'#1a120e'); px(2,-H+4,3,1,'#1a120e'); // 锁眉
  // 毒剑（剑尖泛绿）
  px(11,-H+12,3,4,tint('#c9a24a',w));
  px(12,-H-16,2,28,tint('#d8d4c4',w));
  ctx.fillStyle='rgba(150,255,110,'+(0.5+0.3*Math.sin(t*0.2))+')'; px(12,-H-16,2,8,'rgba(150,255,110,0.8)');
  if(b.atkT>0){ ctx.strokeStyle='rgba(150,255,110,0.7)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(11,-H+14,26,-1.2,0.9);ctx.stroke(); }
}
// 罗森格兰兹 / 吉尔登斯顿（第三幕双人小 Boss，宫廷朝臣）—— 以主色区分两人
function drawBossCourtier(b,w,t,H,robe,trim,gold){
  const bob=Math.sin(t*0.1)*1.5;
  // 长袍下摆
  ctx.fillStyle=tint(robe,w);
  ctx.beginPath();ctx.moveTo(-13,-22);ctx.lineTo(13,-22);ctx.lineTo(17,0);ctx.lineTo(-17,0);ctx.closePath();ctx.fill();
  // 腿
  px(-9,-24,7,24,tint('#2a2a32',w)); px(3,-24,7,24,tint('#20202a',w));
  // 躯干（宫廷礼服 + 金边）
  px(-12,-H+16+bob,24,32,tint(robe,w));
  px(7,-H+16+bob,5,32,tint(trim,w));
  px(-12,-H+16+bob,4,32,'rgba(0,0,0,0.25)');
  px(-12,-H+16+bob,24,4,tint(gold,w));
  px(-2,-H+16+bob,4,32,tint(gold,w)); // 前襟金扣带
  // 披风
  ctx.fillStyle=tint(robe,w); ctx.globalAlpha=0.85;
  ctx.beginPath();ctx.moveTo(-11,-H+18+bob);ctx.lineTo(-22-Math.sin(t*0.08)*3,-2);ctx.lineTo(-4,-16);ctx.closePath();ctx.fill();
  ctx.globalAlpha=1;
  // 皱领
  px(-13,-H+14+bob,26,4,tint('#e8e0d0',w));
  // 头
  px(-8,-H+bob,16,15,tint('#c9a98c',w));
  px(-8,-H-2+bob,16,5,tint('#3a2a1a',w)); // 短发
  px(-5,-H+5+bob,3,2,'#2a1810'); px(2,-H+5+bob,3,2,'#2a1810');
  // 羽毛便帽
  ctx.fillStyle=tint(robe,w); px(-9,-H-4+bob,18,4,tint(robe,w));
  ctx.fillStyle=tint(trim,w); ctx.beginPath();ctx.moveTo(8,-H-4+bob);ctx.lineTo(16,-H-12+bob);ctx.lineTo(10,-H-2+bob);ctx.closePath();ctx.fill();
  // 细剑
  px(11,-H+12+bob,3,4,tint(gold,w));
  px(12,-H-14+bob,2,26,tint('#d8d4c4',w));
  px(12,-H-14+bob,1,26,'#f0f0f0');
  if(b.atkT>0){ ctx.strokeStyle=hexToRgba(trim,0.7);ctx.lineWidth=3;ctx.beginPath();ctx.arc(11,-H+14+bob,24,-1.2,0.9);ctx.stroke(); }
}
function hexToRgba(hex,a){ const n=parseInt(hex.slice(1),16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')'; }

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
  // 明显拾取提示文字
  ctx.font='bold 9px "Courier New",monospace'; ctx.textAlign='center';
  ctx.fillStyle='rgba(8,6,14,0.6)'; ctx.fillRect(-92,-40,184,13);
  ctx.strokeStyle='rgba(185,139,255,0.7)'; ctx.lineWidth=1; ctx.strokeRect(-92,-40,184,13);
  ctx.fillStyle='#e8dcff'; ctx.fillText('拾取 亡魂之弓 — 解锁远程攻击 [F/Z键]', 0, -30);
  ctx.textAlign='left';
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

/* -------------------------------------------------------------------------
   跳跃能力常量 & 关卡通行性保障（修复"密集地刺无法通过"问题）
   由玩家物理（JUMP_VEL/GRAVITY/MOVE_SPEED）保守推导：
     起跳峰高 ≈ 12.6²/(2·0.62) ≈ 128px；同高水平位移 ≈ 3.4·40 ≈ 136px
   取保守值，确保任何地刺/坑洞段都存在"相邻落脚点间距 ≤ 最大跳跃距离"的通行路径。
   ------------------------------------------------------------------------- */
const MAX_JUMP_UP = 118;        // 起跳最大可达上升高度（校验用，保守）
const MAX_JUMP_DX = 128;        // 同高度最大水平跳跃距离（校验用，保守）
const BRIDGE_GAP  = 116;        // 落脚点间隙超过此值必须补踏脚石（留余量 < MAX_JUMP_DX）
const STEP_UP     = 64;         // 补的踏脚石相对地面的抬升高度（< MAX_JUMP_UP）
const MAX_PIT_W   = 110;        // 单个坑/地刺段的最大宽度（≤ 可跳距离，绝不做死路）

// 收集所有可站立表面（地面 + 单向平台 + 移动平台，移动平台按行程取覆盖范围）
function levelFootholds(lv){
  const fh=[];
  for(const p of lv.platforms){ fh.push({x1:p.x, x2:p.x+p.w, y:p.y}); }
  for(const m of lv.movers){
    const rx = m.axis==='x' ? (m.range||0) : 0;
    const bx = (m.baseX!==undefined?m.baseX:m.x), by=(m.baseY!==undefined?m.baseY:m.y);
    fh.push({x1:bx-rx, x2:bx+m.w+rx, y:by});
  }
  return fh;
}
// 通行性校验：玩家起点落脚点能否经"可跳跃边"到达终点落脚点（BFS）
// 返回 {ok:true} 或 {ok:false, reason, gap, atX}
function validateTraversable(lv){
  const fh=levelFootholds(lv);
  if(!fh.length) return {ok:false, reason:'无任何落脚点'};
  const goalX = lv.goalX || (lv.width-140);
  const findGround=(x)=>{ let best=-1,bd=1e9; for(let i=0;i<fh.length;i++){ const f=fh[i]; if(x>=f.x1-6&&x<=f.x2+6){ const d=Math.abs(f.y-GROUND_TOP); if(d<bd){bd=d;best=i;} } } return best; };
  const s=findGround(lv.playerStart.x), g=findGround(goalX);
  if(s<0) return {ok:false, reason:'起点无落脚点', atX:lv.playerStart.x};
  if(g<0) return {ok:false, reason:'终点无落脚点', atX:goalX};
  const canJump=(a,b)=>{
    const gap = Math.max(b.x1-a.x2, a.x1-b.x2, 0); // 边缘水平间隙（重叠取 0）
    const rise = a.y - b.y;                        // b 比 a 高多少
    return gap<=MAX_JUMP_DX && rise<=MAX_JUMP_UP;
  };
  const seen=new Array(fh.length).fill(false); const q=[s]; seen[s]=true;
  while(q.length){ const i=q.shift(); if(i===g) return {ok:true};
    for(let j=0;j<fh.length;j++){ if(!seen[j] && canJump(fh[i],fh[j])){ seen[j]=true; q.push(j); } } }
  // 定位最大断裂间隙（供报错）
  let worst=0, atX=0;
  const gs=lv.platforms.filter(p=>p.type==='ground'&&Math.abs(p.y-GROUND_TOP)<1).map(p=>({x1:p.x,x2:p.x+p.w})).sort((a,b)=>a.x1-b.x1);
  for(let i=0;i<gs.length-1;i++){ const gap=gs[i+1].x1-gs[i].x2; if(gap>worst){ worst=gap; atX=gs[i].x2; } }
  return {ok:false, reason:'起点无法跳跃抵达终点（存在过宽断点）', gap:worst, atX};
}
// 通行性保障：对任何过宽的地面间隙均匀补入踏脚石（保留地刺，只确保可跳过）
function ensureTraversable(lv){
  const grounds=lv.platforms.filter(p=>p.type==='ground'&&Math.abs(p.y-GROUND_TOP)<1)
    .map(p=>({x1:p.x,x2:p.x+p.w})).sort((a,b)=>a.x1-b.x1);
  const spans=[];
  for(const gp of grounds){
    if(spans.length && gp.x1<=spans[spans.length-1].x2+1) spans[spans.length-1].x2=Math.max(spans[spans.length-1].x2,gp.x2);
    else spans.push({x1:gp.x1,x2:gp.x2});
  }
  for(let i=0;i<spans.length-1;i++){
    const leftEdge=spans[i].x2, rightEdge=spans[i+1].x1, gap=rightEdge-leftEdge;
    if(gap<=BRIDGE_GAP) continue;
    const n=Math.ceil(gap/BRIDGE_GAP)-1;   // 需补的踏脚石数量
    for(let k=1;k<=n;k++){
      const cxc=leftEdge+gap*k/(n+1);
      // 该处附近若已有可达落脚平台则不重复补
      const covered=lv.platforms.some(p=>p.type!=='ground'&&p.x<cxc+22&&p.x+p.w>cxc-22&&p.y>=GROUND_TOP-MAX_JUMP_UP&&p.y<=GROUND_TOP-20);
      if(covered) continue;
      lv.platforms.push({x:cxc-30, y:GROUND_TOP-STEP_UP, w:60, h:14, type:'plat', bridge:true});
    }
  }
}

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
  let cx=0, justPit=false;
  const segLen = width/3;
  while(cx < width-260){
    // 决定是否挖坑（第一段少，后段多）——坑后必须紧跟安全地面，绝不连续挖坑
    const seg = cx/segLen; // 0..3
    const pitChance = (cfg.pitBase||0.12) + seg*0.05;
    const makePit = !justPit && cx>360 && cx<width-360 && rng()<pitChance;
    if(makePit){
      // 坑宽严格限制在可跳范围内（≤ MAX_PIT_W），保证单跳即可越过，绝不做无落脚死路
      let pitW = 56 + rng()*44;                 // 56..100
      pitW = Math.min(pitW, MAX_PIT_W);
      // 坑底放危险（地刺/毒/水），但坑两侧地面即为落脚点
      const hzType = cfg.pitHazard || (rng()<0.5?'spike':'poison');
      lv.hazards.push({x:cx, y:GROUND_TOP+30, w:pitW, h:LEVEL_H-GROUND_TOP-30, type:hzType==='void'?'water':hzType});
      // 坑略宽时中间再放一块踏脚平台，进一步降低难度
      if(pitW>86){ lv.platforms.push({x:cx+pitW/2-30,y:GROUND_TOP-STEP_UP,w:60,h:14,type:'plat'}); }
      cx += pitW;
      justPit=true;                             // 标记：下一段强制为安全地面
      continue;                                 // 坑后不生成悬浮平台层，保持通道清晰
    } else {
      justPit=false;
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
function fixCastlePreCheckpointSpikeTrap(lv){
  const firstCheckpointX = lv.checkpoints[0] ? lv.checkpoints[0].x : lv.width / 3;
  const trap = lv.hazards.find(h=>h.type==='spike' && h.x < firstCheckpointX);
  if(!trap) return;
  lv.movers.push({
    x:trap.x + trap.w / 2 - 42, y:GROUND_TOP - 96, w:84, h:14, type:'plat',
    axis:'x', range:54, speed:0.72, phase:0,
    baseX:trap.x + trap.w / 2 - 42, baseY:GROUND_TOP - 96
  });
}

function pickEnemyType(cfg, rng, seg){
  const pool = cfg.enemies || ['patrol','archer','shield'];
  // 后段更容易出现盾兵/精英
  const r=rng();
  if(seg>=1.8 && cfg.elite && r<0.12) return 'elite';
  return pool[(rng()*pool.length)|0];
}

/* --------- 各段构建（六段：城堡/宫廷/逃亡/湖边彩蛋/英格兰/终章） --------- */
function appendBossArena(lv, kind, flags){
  const ax = lv.width - 660;
  // 平整 Boss 决斗场地（覆盖末段），并清空进场后的坑与散兵
  lv.platforms.push({x:ax-60, y:GROUND_TOP, w:lv.width-(ax-60), h:LEVEL_H-GROUND_TOP, type:'ground'});
  lv.hazards = lv.hazards.filter(h=> (h.x+(h.w||0)) < ax-40);
  lv.enemySpawns = lv.enemySpawns.filter(s=> s.x < ax-40);
  lv.breakables = lv.breakables.filter(b=> b.x < ax-40);
  // 侧翼平台（躲避 AOE）
  lv.platforms.push({x:ax+140, y:GROUND_TOP-140, w:90, h:14, type:'plat'});
  lv.platforms.push({x:lv.width-260, y:GROUND_TOP-140, w:90, h:14, type:'plat'});
  lv.bossArena={x:ax, y:GROUND_TOP};
  lv.bossPlan=[Object.assign({kind, triggerX:ax+40, started:false, defeated:false}, flags||{})];
  lv.checkpoints.push({x:ax-180, y:GROUND_TOP, active:false, bossGate:true});
  lv.completeMode='boss';
  lv.goalX=lv.width-120;
}
function buildAct(idx){
  actIndex=idx;
  let lv;
  if(idx===ACT_CASTLE){ // 第一幕 城堡 —— 关底 Boss：恶灵版老哈姆雷特国王
    lv=buildStandard({seed:101, width:5200, enemies:['patrol','archer','shield'], enemyChance:0.5, pitBase:0.1, pitHazard:'spike'});
    lv.triggers.push({x:lv.width*0.42, y:GROUND_TOP-120, w:80, h:120, type:'ghost', fired:false, key:'ghost'});
    lv.segments=[{x:0,name:'城墙入口'},{x:lv.width/3,name:'守卫哨塔'},{x:lv.width*2/3,name:'鬼魂之墙'}];
    fixCastlePreCheckpointSpikeTrap(lv);
    appendBossArena(lv,'ghostking',{completesLevel:true});
  } else if(idx===ACT_COURT){ // 第二幕 宫廷 —— 前段拾取亡魂之弓；关底 Boss：小丑波洛涅斯
    lv=buildStandard({seed:202, width:5600, enemies:['patrol','archer','shield'], enemyChance:0.55, pitBase:0.12, pitHazard:'spike'});
    // 亡魂之弓：本幕前段拾取（关卡开始不久即出现）
    lv.bowPickup={x:lv.width*0.12, y:GROUND_TOP-40, w:34, h:34, taken:false};
    lv.segments=[{x:0,name:'宫廷回廊'},{x:lv.width/3,name:'追逐奥菲莉亚'},{x:lv.width*2/3,name:'小丑的舞台'}];
    appendBossArena(lv,'clown',{completesLevel:true});
  } else if(idx===ACT_ESCAPE){ // 第三幕 逃亡 —— 疯朋克奥菲莉亚背景游荡；关底双人小 Boss 罗森格兰兹/吉尔登斯顿；后段彩蛋入口
    lv=buildStandard({seed:303, width:6200, enemies:['patrol','archer','shield','skeleton'], enemyChance:0.6, pitBase:0.16, pitHazard:'poison', elite:true});
    lv.punkOphelia={ baseX:lv.width*0.22, x:lv.width*0.22, phase:0, lineT:150, lineI:0 };
    lv.triggers.push({x:lv.width*0.55, y:GROUND_TOP-120, w:60, h:120, type:'egghint', fired:false, key:'egghint'});
    lv.segments=[{x:0,name:'宫廷走廊'},{x:lv.width/3,name:'仓皇出逃'},{x:lv.width*2/3,name:'旧友的埋伏 →'}];
    appendBossArena(lv,'rosencrantz',{});
    const raX=lv.width-660;
    lv.bossPlan=[
      { kind:'rosencrantz',  triggerX:raX+40, started:false, defeated:false, pairFirst:true },
      { kind:'guildenstern', triggerX:raX,    started:false, defeated:false, completesLevel:true }
    ];
  } else if(idx===ACT_LAKE){ // 彩蛋关 湖边（限时救援疯朋克奥菲莉亚）
    lv=buildStandard({seed:404, width:5200, enemies:['patrol','archer','skeleton'], enemyChance:0.5, pitBase:0.28, maxPit:120, pitHazard:'void'});
    lv.water=true;
    lv.rescue={x:lv.width-360, y:GROUND_TOP-10, w:40, h:40, fired:false, saved:false};
    lv.triggers.push({x:lv.width-360, y:GROUND_TOP-30, w:40, h:40, type:'rescue', fired:false, key:'rescue'});
    lv.timeLimit=70; lv.timeLeft=70; lv.completeMode='rescue';
    lv.segments=[{x:0,name:'湖畔小径'},{x:lv.width/3,name:'湍流跳跃'},{x:lv.width*2/3,name:'奥菲莉亚！'}];
    lv.goalX=lv.width-330;
  } else if(idx===ACT_ENGLAND){ // 第四幕 英格兰 —— 船舱/海岸/异域；关底 Boss：刺客队长
    lv=buildStandard({seed:505, width:5800, enemies:['patrol','archer','shield','skeleton'], enemyChance:0.58, pitBase:0.15, maxPit:110, pitHazard:'void', elite:true});
    lv.segments=[{x:0,name:'颠簸船舱'},{x:lv.width/3,name:'登陆海岸'},{x:lv.width*2/3,name:'异域荒滩'}];
    appendBossArena(lv,'assassin',{completesLevel:true});
  } else { // 第五幕 墓地/宫廷走廊/王座（终章：中段雷欧提斯 + 最终克劳迪奥）
    lv=buildAct5();
  }
  ensureTraversable(lv);          // 通行性保障：确保任何地刺/坑洞段都有可跳过的落脚点
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

  // ---- 宫廷走廊段（segW..2segW）：盾兵+精英连战 + 毒池陷阱 + 中段 Boss 雷欧提斯 ----
  buildGroundRange(lv,rng,segW,segW*2,{enemies:['shield','patrol','archer'],chance:0.62,pitHazard:'poison',pitBase:0.2,elite:true,poisonExtra:true});
  // 精英护卫连续战
  lv.enemySpawns.push({type:'elite',x:segW+segW*0.55,y:GROUND_TOP});
  lv.enemySpawns.push({type:'shield',x:segW+segW*0.6,y:GROUND_TOP});
  lv.enemySpawns.push({type:'shield',x:segW+segW*0.66,y:GROUND_TOP});
  // 雷欧提斯决斗场地：铺平走廊后段
  const laertesX = segW*2 - 520;
  lv.platforms.push({x:laertesX-160, y:GROUND_TOP, w:640, h:LEVEL_H-GROUND_TOP, type:'ground'});
  lv.hazards = lv.hazards.filter(h=> !(h.x> laertesX-180 && h.x< laertesX+420));
  lv.enemySpawns = lv.enemySpawns.filter(s=> !(s.x> laertesX-40 && s.x< laertesX+420));
  lv.checkpoints.push({x:segW*2-220, y:GROUND_TOP, active:false, bossGate:true});

  // ---- 王座大厅段（2segW..end）：最终 Boss ----
  // 平整战斗场地
  lv.platforms.push({x:segW*2, y:GROUND_TOP, w:width-segW*2, h:LEVEL_H-GROUND_TOP, type:'ground'});
  // 侧翼小平台
  lv.platforms.push({x:segW*2+260, y:GROUND_TOP-140, w:90, h:14, type:'plat'});
  lv.platforms.push({x:width-460, y:GROUND_TOP-140, w:90, h:14, type:'plat'});
  lv.bossArena={x:segW*2+120, y:GROUND_TOP};
  lv.completeMode='finale';
  lv.bossPlan=[
    { kind:'laertes',  triggerX:laertesX,       started:false, defeated:false, midboss:true },
    { kind:'claudius', triggerX:segW*2+150,     started:false, defeated:false, final:true }
  ];

  lv.secretTotal=lv.chests.length;
  return lv;
}

// 在 [x0,x1) 范围内铺设地面段与内容（供第五幕分段使用）
function buildGroundRange(lv,rng,x0,x1,cfg){
  let cx=x0, justPit=false;
  while(cx<x1-200){
    const seg=(cx-x0)/(x1-x0)*3;
    const makePit = !justPit && cx>x0+300 && cx<x1-300 && rng()<(cfg.pitBase||0.14);
    if(makePit){
      let pitW=Math.min(56+rng()*44, MAX_PIT_W);   // 56..100, ≤ 可跳距离
      lv.hazards.push({x:cx,y:GROUND_TOP+30,w:pitW,h:LEVEL_H-GROUND_TOP-30,type:cfg.pitHazard==='void'?'water':cfg.pitHazard||'spike'});
      if(pitW>86) lv.platforms.push({x:cx+pitW/2-28,y:GROUND_TOP-STEP_UP,w:56,h:14,type:'plat'});
      cx+=pitW; justPit=true; continue;
    } else {
      justPit=false;
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
  const gold = (act===ACT_FINAL && opheliaSaved && !darkMode);
  const doom = (act===ACT_FINAL && (!opheliaSaved||darkMode));
  g.addColorStop(0, doom?'rgba(90,50,120,0.5)':(gold?'rgba(232,194,90,0.4)':'rgba(120,110,150,0.3)'));
  g.addColorStop(1,'rgba(0,0,0,0)');
  c.fillStyle=g; c.fillRect(0,0,180,240);
  // 立绘：临时把全局 ctx 切换到 portrait 画布再复用 drawHamlet
  drawHamletOn(c, 90, 210, 3.4, act);
  // 幕标注
  c.fillStyle= doom?'#c9a6e0':(gold?'#e8c25a':'#c4b98f'); c.font='11px serif'; c.textAlign='center';
  c.fillText(['第一幕','第二幕','第三幕','彩蛋关','第四幕','第五幕'][act]||'', 90, 232);
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
      { zh:'（穿过城墙守卫，直面城堡深处被死神攫住的先王亡魂）' }
    ]}
  ],
  a1_reveal:[
    { act:'ACT I · 尾声', title:'毒杀的真相', portrait:0, lines:[
      { zh:'恶灵溃散，先王的亡魂终于得以安息。临别，他吐露了那桩罪行——' },
      { zh:'“午睡的花园里，克劳迪奥将毒液灌入我的耳中，夺走我的生命、王冠与王后。”', speak:true,
        en:'“Upon my secure hour thy uncle stole, with juice of cursed hebona in a vial.”' },
      { zh:'哈姆雷特握紧拳头：我必以父之名，向克劳迪奥复仇。' }
    ]}
  ],
  a2_open:[
    { act:'ACT II · 第二幕', title:'宫廷 · 追逐与装疯', portrait:1, lines:[
      { zh:'宫廷回廊，哈姆雷特追上惊惶的奥菲莉亚，想要倾诉。' },
      { zh:'奥菲莉亚：“殿下，我父亲说……我们不该再相见。”', speak:true },
      { zh:'话音未落，老臣波洛涅斯闯入，一把将女儿带走，消失在回廊尽头。' },
      { zh:'哈姆雷特：“虽是疯言，却自有条理。”佯装疯癫，他要揭穿这宫廷的伪装。', speak:true,
        en:'“Though this be madness, yet there is method in\'t.”' },
      { zh:'（前段拾取【亡魂之弓】；关底揪出伪装成小丑的波洛涅斯）' }
    ]}
  ],
  a3_open:[
    { act:'ACT III · 第三幕', title:'逃亡 · 疯癫的奥菲莉亚', portrait:2, lines:[
      { zh:'误杀之名压顶，克劳迪奥的爪牙四处追缉。哈姆雷特被迫亡命奔逃。' },
      { zh:'走廊与旷野之间，疯癫的奥菲莉亚披散着头发游荡，口中反复吟唱着断碎的歌谣……' },
      { zh:'奥菲莉亚：“他死了，去了，小姐；他死了，去了。”', speak:true,
        en:'“He is dead and gone, lady, he is dead and gone.”' },
      { zh:'（一路奔逃，后段将出现通往湖边的小径）' }
    ]}
  ],
  egg_enter:[
    { act:'HIDDEN · 隐藏彩蛋关', title:'柳树湖畔 · 落水', portrait:3, lines:[
      { zh:'湖边小径尽头，柳树斜倚溪畔。疯癫的奥菲莉亚攀上枝头，编织花环。' },
      { zh:'枝断，她坠入湍流！衣裙浮起，歌声渐渺……' },
      { zh:'哈姆雷特狂奔而来——必须在她沉没前赶到！', speak:true },
      { zh:'（限时救援：水面即死，跳跃平台冲向奥菲莉亚。成功她将加入你，失败你将永失亡魂之弓）' }
    ]}
  ],
  egg_saved:[
    { act:'HIDDEN · 得救', title:'奥菲莉亚得救', portrait:3, lines:[
      { zh:'金色的光自天而降，花瓣漫天，水面泛起温柔的涟漪。' },
      { zh:'哈姆雷特将她拥入怀中，奥菲莉亚缓缓睁眼，疯狂散去。' },
      { zh:'哈姆雷特：“你可以怀疑星辰是火……但永远不要怀疑我的爱。”', speak:true,
        en:'“Doubt thou the stars are fire… but never doubt I love.”' },
      { zh:'她拾起长弓与短刃，将并肩与你走向之后的每一场血战。' }
    ]}
  ],
  egg_lost:[
    { act:'HIDDEN · 逝去', title:'奥菲莉亚沉湖', portrait:3, lines:[
      { zh:'水流太急，花环沉没。奥菲莉亚随着歌声，一起沉入幽暗的水底。' },
      { zh:'她的魂魄自水中升起，苍白而怨怼，夺走了哈姆雷特手中的【亡魂之弓】——' },
      { zh:'“你没能抓住我……那么，这亡魂的馈赠，也随我而去吧。”', speak:true },
      { zh:'哈姆雷特自此永失远程之力，只余手中长剑。丹麦的天空堕入更深的黑暗……' }
    ]}
  ],
  a4_open:[
    { act:'ACT IV · 第四幕', title:'英格兰 · 海上的阴谋', portrait:4, lines:[
      { zh:'克劳迪奥以“养病”为名，将哈姆雷特遣往英格兰，同行的是两名旧友与一封密信。' },
      { zh:'颠簸的船舱里，哈姆雷特窃得那封信——信上赫然写着：船一靠岸，即刻取他性命。' },
      { zh:'哈姆雷特：“我要将计就计，改写这封催命的信。”', speak:true,
        en:'“Being thus benetted round with villainies…”' },
      { zh:'（登陆异域海岸，识破并反杀英格兰雇佣的刺客队长）' }
    ]}
  ],
  a4_end:[
    { act:'ACT IV · 尾声', title:'雷欧提斯的誓言', portrait:4, lines:[
      { zh:'刺客授首，阴谋破产。哈姆雷特踏上归途，重返丹麦。' },
      { zh:'而在王座之侧，为父复仇的雷欧提斯，正与克劳迪奥密谋一场毒剑的决斗。' },
      { zh:'雷欧提斯：“哪怕在教堂里，我也要割断他的喉咙！”', speak:true,
        en:'“To cut his throat i\' the church.”' },
      { zh:'（终章将至：墓地 → 宫廷走廊 → 王座大厅）' }
    ]}
  ],
  a5_open_saved:[
    { act:'ACT V · 第五幕', title:'墓地 · 王座 · 最终决战', portrait:5, lines:[
      { zh:'黎明将至。哈姆雷特携奥菲莉亚，穿过墓地，直取王座。' },
      { zh:'霍拉旭随行相伴：“殿下，命运的时刻到了。”', speak:true },
      { zh:'（墓地→走廊→王座：先决斗雷欧提斯，再与克劳迪奥三阶段决战）' }
    ]}
  ],
  a5_open_lost:[
    { act:'ACT V · 第五幕', title:'墓地 · 王座 · 最终决战', portrait:5, lines:[
      { zh:'冷雨不歇，枯枝与乌鸦盘踞。哈姆雷特独自穿过阴郁的墓地。' },
      { zh:'霍拉旭追上前来：“殿下，纵是深渊，我也随你同去。”', speak:true },
      { zh:'（墓地→走廊→王座：独自决斗雷欧提斯，再面对克劳迪奥三阶段决战）' }
    ]}
  ],
  a5_yorick:[
    { act:'ACT V · 墓地', title:'可怜的约克里克', portrait:5, lines:[
      { zh:'掘出的头骨在掌中。哈姆雷特凝视良久。' },
      { zh:'哈姆雷特：“唉，可怜的约克里克！霍拉旭，我认得他。”', speak:true,
        en:'“Alas, poor Yorick! I knew him, Horatio.”' },
      { zh:'生死一线，皆归尘土。而复仇，仍未了结。' }
    ]}
  ],
  laertes_saved:[
    { act:'ACT V · 决斗', title:'替你挡下的毒剑', portrait:5, lines:[
      { zh:'雷欧提斯的毒剑刺向哈姆雷特要害——奥菲莉亚扑身而上，用短刃挡开了那致命一击！' },
      { zh:'奥菲莉亚：“我不会再让你离开我。去吧，把该结束的了结。”', speak:true },
      { zh:'哈姆雷特毫发无伤，直取王座。' }
    ]}
  ],
  laertes_lost:[
    { act:'ACT V · 决斗', title:'淬毒的一击', portrait:5, lines:[
      { zh:'雷欧提斯的毒剑擦过哈姆雷特的臂膀——剧毒瞬间在血脉中蔓延！' },
      { zh:'哈姆雷特咬牙拔剑：“时间无多……在毒发之前，必须了结这一切！”', speak:true },
      { zh:'（中毒倒计时开始，须在毒发前击败克劳迪奥）' }
    ]}
  ]
};

// Boss 登场过场（按 kind）
const BOSS_INTRO = {
  ghostking:[{ act:'ACT I · 城堡深处', title:'恶灵 · 老哈姆雷特国王', portrait:0, lines:[
    { zh:'先王的亡魂被死神攫住，扭曲成一具泛着幽蓝的恶灵。' },
    { zh:'恶灵：“复仇……复仇……却认不得自己的孩儿……”', speak:true },
    { zh:'哈姆雷特：“父亲，我来解开您身上的枷锁！”', speak:true }
  ]}],
  clown:[{ act:'ACT II · 小丑的舞台', title:'小丑 · 波洛涅斯', portrait:1, lines:[
    { zh:'一个涂着惨白笑妆的小丑翻着筋斗登场，铃铛叮当——正是伪装的波洛涅斯！' },
    { zh:'波洛涅斯：“简洁乃智慧之魂，殿下，可惜您已疯得没了魂！”', speak:true,
      en:'“Brevity is the soul of wit.”' },
    { zh:'哈姆雷特：“那就让我，戳穿你这层可笑的伪装！”', speak:true }
  ]}],
  rosencrantz:[{ act:'ACT III · 湖边小径', title:'旧友的背叛 · 罗森格兰兹与吉尔登斯顿', portrait:2, lines:[
    { zh:'两名昔日同窗自阴影中现身，奉克劳迪奥之命前来缉拿——罗森格兰兹与吉尔登斯顿。' },
    { zh:'罗森格兰兹：“殿下，别怪我们。国王的差遣，我们不敢不从。”', speak:true },
    { zh:'哈姆雷特：“像海绵一样吸干国王的恩宠，也终将被他一把攥干。”', speak:true,
      en:'“He keeps them, like an ape, in the corner of his jaw.”' },
    { zh:'（双人夹击：先击破罗森格兰兹，再迎战暴怒的吉尔登斯顿）' }
  ]}],
  guildenstern:[{ act:'ACT III · 湖边小径', title:'吉尔登斯顿 · 暴怒反扑', portrait:2, lines:[
    { zh:'见同伙倒下，吉尔登斯顿拔剑咆哮，扑向哈姆雷特。' },
    { zh:'吉尔登斯顿：“你杀了他！那就用命来偿！”', speak:true },
    { zh:'哈姆雷特：“你们把我当笛子吹奏，却奏不出我半分心声！”', speak:true,
      en:'“You would play upon me… you cannot play upon me.”' }
  ]}],
  assassin:[{ act:'ACT IV · 异域荒滩', title:'英格兰雇佣刺客队长', portrait:4, lines:[
    { zh:'海岸尽头，一队黑衣刺客现身，为首者双刃泛着寒光。' },
    { zh:'刺客队长：“丹麦王付了双倍的金子——王子，你的旅程到此为止。”', speak:true },
    { zh:'哈姆雷特：“回去告诉他，催命的信，我已替他改好了。”', speak:true }
  ]}],
  laertes:[{ act:'ACT V · 宫廷走廊', title:'雷欧提斯 · 毒剑决斗', portrait:5, lines:[
    { zh:'走廊尽头，雷欧提斯拔剑而立，剑尖淬着克劳迪奥给的剧毒。' },
    { zh:'雷欧提斯：“为我父亲波洛涅斯，为我妹妹奥菲莉亚——受死吧！”', speak:true },
    { zh:'哈姆雷特：“来吧，雷欧提斯。我们本不必如此。”', speak:true }
  ]}],
  claudius:[{ act:'ACT V · 王座大厅', title:'弑君者克劳迪奥', portrait:5, lines:[
    { zh:'王座之上，克劳迪奥缓缓起身，握紧毒剑。' },
    { zh:'克劳迪奥：“我的罪孽腥臭熏天，直冲云霄。”', speak:true,
      en:'“O, my offence is rank, it smells to heaven.”' },
    { zh:'哈姆雷特：“恶贼，受死！为我父亲，为丹麦！”', speak:true }
  ]}]
};
// Boss 阶段狂暴化台词
const BOSS_PHASE_LINES = {
  claudius:{ 2:{ zh:'克劳迪奥：“绝望的病症，要用绝望的药石来医。”', en:'“Diseases desperate grown by desperate appliance are relieved.”' },
             3:{ zh:'克劳迪奥：“我的话飞上天，我的心却坠向地——皆化虚空！”', en:'“My words fly up, my thoughts remain below.”' } },
  ghostking:{ 2:{ zh:'恶灵：“黑暗吞没了我……连你的脸也认不清了！”', en:'' } },
  clown:{ 2:{ zh:'波洛涅斯：“这出戏……可还没演完呢！”', en:'' } },
  assassin:{ 2:{ zh:'刺客队长：“既然一击不成，那就乱刃分尸！”', en:'' } }
};

// 非阻断顶部对白栏 · 各段实时台词（left=哈姆雷特，right=登场角色）
function DL(side,name,zh,en){ return {side,name,zh,en:en||''}; }
const CHATTER = {
  // 第一幕 城堡：霍拉旭、马塞勒斯/伯纳多、先王鬼魂、克劳迪奥（远景）
  0:[ DL('right','马塞勒斯','丹麦国里，一定有些不可告人的坏事。','Something is rotten in the state of Denmark.'),
      DL('left','哈姆雷特','这城堡的每一块石头，都记得我父亲的脚步。'),
      DL('right','霍拉旭','殿下，那鬼魂昨夜又一次出现了。','My lord, I think I saw him yesternight.'),
      DL('left','哈姆雷特','若他今夜再来，纵是地狱裂口，我也要与他说话。','If it assume my noble father\'s person, I\'ll speak to it.'),
      DL('right','鬼魂 · 先王','为我复仇——莫让丹麦的御榻沦为荒淫的温床。','Revenge his foul and most unnatural murder.'),
      DL('left','哈姆雷特','说吧，我已备好双翼，飞去复仇。','Haste me to know\'t, that I may sweep to my revenge.') ],
  // 第二幕 宫廷：奥菲莉亚、波洛涅斯、乔特鲁德、克劳迪奥（远景）
  1:[ DL('right','奥菲莉亚','殿下，我把您的信都退回来了……','I did repel his letters.'),
      DL('left','哈姆雷特','进尼姑庵去吧——别做罪人的母亲。','Get thee to a nunnery.'),
      DL('right','波洛涅斯','（低语）他疯了，可疯里自有条理。','Though this be madness, yet there is method in\'t.'),
      DL('right','乔特鲁德','哈姆雷特，你已大大触怒了你的父亲。','Hamlet, thou hast thy father much offended.'),
      DL('left','哈姆雷特','母亲，是您大大触怒了我的父亲。','Mother, you have my father much offended.'),
      DL('right','克劳迪奥（远景）','显贵人的疯病，是不能不加提防的。','Madness in great ones must not unwatch\'d go.') ],
  // 第三幕 逃亡：疯奥菲莉亚、罗森格兰兹/吉尔登斯顿、霍拉旭、克劳迪奥爪牙
  2:[ DL('right','奥菲莉亚（疯）','这是迷迭香，是为了记忆……','There\'s rosemary, that\'s for remembrance.'),
      DL('left','哈姆雷特','她的疯，比这满朝的清醒更叫人心碎。'),
      DL('right','罗森格兰兹','殿下，国王差我们来，请您交出尸体。','My lord, you must tell us where the body is.'),
      DL('left','哈姆雷特','你们把我当海绵？国王榨干时，你们终将一无所有。','He keeps them, like an ape, in the corner of his jaw.'),
      DL('right','奥菲莉亚（疯）','他不会回来了吗？他不会回来了吗？','And will he not come again?'),
      DL('right','霍拉旭','殿下当心，克劳迪奥的爪牙就在身后！') ],
  // 彩蛋关 湖边：哈姆雷特、疯奥菲莉亚
  3:[ DL('left','哈姆雷特','撑住！我这就来——别沉下去！'),
      DL('right','奥菲莉亚（疯）','花环好美……水好凉……','Come, my coach! Good night, ladies.'),
      DL('left','哈姆雷特','别让柳枝折断——把手给我！') ],
  // 第四幕 英格兰：英格兰使者/海盗、刺客队长、雷欧提斯（过场预告）
  4:[ DL('left','哈姆雷特','这封催命的信，如今要了他们自己的命。'),
      DL('right','英格兰使者','丹麦来的贵客，这风浪可还受得住？'),
      DL('right','刺客队长','丹麦王的金子，可不容易赚啊。'),
      DL('left','哈姆雷特','海风也知道，我不会死在这异乡。'),
      DL('right','雷欧提斯（预告）','等着我，杀我父者——丹麦见分晓。') ],
  // 第五幕 终章：霍拉旭、掘墓人、乔特鲁德、雷欧提斯、克劳迪奥
  5:[ DL('left','哈姆雷特','生存还是毁灭，这是个问题。','To be, or not to be, that is the question.'),
      DL('right','掘墓人','我造的坟墓比房子还结实，能住到末日审判。','The houses he makes last till doomsday.'),
      DL('left','哈姆雷特','可怜的约里克！我认得他，霍拉旭。','Alas, poor Yorick! I knew him, Horatio.'),
      DL('right','乔特鲁德','（举杯）我为你的胜利干杯，哈姆雷特。','The queen carouses to thy fortune, Hamlet.'),
      DL('right','霍拉旭','殿下，若您倒下，我愿讲述您的故事。','I am more an antique Roman than a Dane.') ]
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
let bowHintT=0;                      // 拾弓提示条常驻计时（帧）
let activeBossEntry=null;            // 当前激活的 Boss 计划条目

/* -------------------------------------------------------------------------
   非阻断式顶部对白栏（不切出 PLAY 状态，不暂停游戏，自动推进）
   ------------------------------------------------------------------------- */
const Dialog = {
  queue:[], src:[], cur:null, hold:0, gap:0, loop:true,
  push(lines){ (lines||[]).forEach(l=>{ this.queue.push(l); this.src.push(l); }); },
  clear(){ this.queue=[]; this.src=[]; this.cur=null; this.hold=0; this.gap=0; this._hideBoth(); },
  _hideBoth(){ if(dom.dlgLeft){ dom.dlgLeft.classList.remove('show'); dom.dlgRight.classList.remove('show'); } },
  _fill(el,l){ if(!el) return; el.querySelector('.who').textContent=l.name; el.querySelector('.zh').textContent=l.zh; el.querySelector('.en').textContent=l.en||''; },
  update(){
    if(!dom.dlgLeft) return;
    if(this.hold>0){ this.hold--; if(this.hold===0){ (this.cur.side==='left'?dom.dlgLeft:dom.dlgRight).classList.remove('show'); this.gap=26; } return; }
    if(this.gap>0){ this.gap--; return; }
    if(!this.queue.length){
      // 循环播放本段台词，使顶部对白栏贯穿整关始终常驻（间隔一段静默）
      if(this.loop && this.src.length){ this.queue=this.src.slice(); this.gap=340; }
      return;
    }
    const l=this.queue.shift(); this.cur=l;
    const el = l.side==='left'?dom.dlgLeft:dom.dlgRight;
    (l.side==='left'?dom.dlgRight:dom.dlgLeft).classList.remove('show');
    this._fill(el,l); el.classList.add('show');
    this.hold = 150 + Math.min(180, l.zh.length*5);
  }
};

function makePlayer(x,y){
  return {
    x, y:y-PLAYER_H, w:PLAYER_W, h:PLAYER_H, vx:0, vy:0, facing:1,
    onGround:false, hp:150, maxHp:150, invuln:0,
    atkT:0, atkCd:0, rangedCd:0, ammo:8, maxAmmo:12,
    energy:0, maxEnergy:100, pose:{type:'idle',frame:0,t:0},
    coyote:0, jumpBuf:0, hurtT:0, ultActive:0, dead:false
  };
}
function makeCompanion(kind){
  return { kind, x:player?player.x-40:40, y:GROUND_TOP-40, w:20, h:40, vx:0, vy:0,
    facing:1, onGround:false, hp:80, maxHp:80, active:true, atkT:0, atkCd:0, shootCd:60, invuln:0 };
}
const BOSSDEF = {
  ghostking:{ name:'恶灵 · 老哈姆雷特国王', label:'恶灵先王 · THE WRAITH KING', w:48,h:98, phases:3, hp:170, music:'boss', summon:true, ranged:'spectral', dash:false, ult:false },
  clown:    { name:'小丑 · 波洛涅斯',       label:'小丑波洛涅斯 · THE FOOL',     w:44,h:90, phases:2, hp:120, music:'palace', summon:false, ranged:'throw', dash:true, ult:false },
  rosencrantz:  { name:'罗森格兰兹',        label:'罗森格兰兹 · ROSENCRANTZ',    w:40,h:86, phases:1, hp:90,  music:'boss', summon:false, ranged:'arrow', dash:false, ult:false, midboss:true },
  guildenstern: { name:'吉尔登斯顿',        label:'吉尔登斯顿 · GUILDENSTERN',   w:40,h:86, phases:1, hp:100, music:'boss', summon:false, ranged:false, dash:true,  ult:false, midboss:true },
  assassin: { name:'英格兰雇佣刺客队长',    label:'刺客队长 · ASSASSIN CAPTAIN', w:44,h:92, phases:2, hp:180, music:'england', summon:true, ranged:'dagger', dash:true, ult:false },
  laertes:  { name:'雷欧提斯',              label:'雷欧提斯 · LAERTES（毒剑）',  w:42,h:90, phases:1, hp:150, music:'boss', summon:false, ranged:false, dash:true, ult:false, poisonBlade:true, midboss:true },
  claudius: { name:'克劳迪奥',              label:'克劳迪奥 · CLAUDIUS',         w:44,h:90, phases:3, get hp(){return opheliaSaved?210:240;}, get music(){return opheliaSaved?'hero':'boss';}, summon:true, ranged:'poison', dash:true, ult:true, final:true }
};
function makeBoss(kind){
  const D=BOSSDEF[kind]; const hp=D.hp;
  return { kind, def:D, x:(level.bossArena?level.bossArena.x+200:level.width-460), y:GROUND_TOP-D.h, w:D.w, h:D.h, vx:0, vy:0, facing:-1,
    hp, maxHp:hp, phase:1, phases:D.phases, arenaMinX:0, onGround:false, hitFlash:0, invuln:0,
    atkT:0, atkCd:80, moveT:0, state:'idle', summonCd:200, dashCd:160, poisonCd:120,
    ultCd:300, enraged:false, dead:false, deathT:0 };
}

function loadLevel(idx, keepScore){
  level = buildAct(idx);
  darkMode = (idx===ACT_FINAL && !opheliaSaved);
  enemies=[]; projectiles=[]; rocks=[]; particles=[]; floaters=[]; petals=[]; texts=[];
  level.enemySpawns.forEach(s=>{ const e=makeEnemy(s.type,s.x,s.y); enemies.push(e); });
  player=makePlayer(level.playerStart.x, level.playerStart.y);
  if(!hasBow) player.ammo=0;
  companion=null;
  // 湖边彩蛋成功后，奥菲莉亚在英格兰幕与终章全程助战
  if((idx===ACT_ENGLAND||idx===ACT_FINAL) && opheliaSaved){ companion=makeCompanion('ophelia'); }
  boss=null; bossStarted=false; activeBossEntry=null; poisonT=0;
  respawn={x:level.playerStart.x, y:level.playerStart.y};
  checkpointActive=null; goalReached=false; deathFade=0; midFired={}; bowHintT=0;
  goalLocked=false;
  // 非阻断顶部对白栏：清空并压入本段开场台词
  Dialog.clear(); if(CHATTER[idx]) Dialog.push(CHATTER[idx]);
  // 分支相关的登场角色台词：终章若奥菲莉亚生还，她随侍在侧
  if(idx===ACT_FINAL && opheliaSaved){
    Dialog.push([ DL('right','奥菲莉亚','我在你身边，我的殿下——这一次，我不会离开。'),
      DL('left','哈姆雷特','有你在，纵是毒剑，也伤不到我的心。') ]);
  } else if(idx===ACT_FINAL && !opheliaSaved){
    Dialog.push([ DL('right','奥菲莉亚 · 亡魂','（湖底的歌声）他不会回来了吗……','He will not come again.') ]);
  }
  // HUD
  dom.levelLabel.textContent = ACTS[idx].name;
  dom.timerRow.style.display = (idx===ACT_LAKE)?'block':'none';
  updateBowHintUI();
  // 音乐
  let mus = ACTS[idx].music;
  if(idx===ACT_FINAL) mus = opheliaSaved? 'hero':'imperial';
  Sound.setMusic(mus, 1);
  updateHUD();
}
function updateBowHintUI(){
  if(!dom.hintRanged) return;
  if(bowLost){ dom.hintRanged.classList.add('locked'); dom.hintLock.textContent='(亡魂之弓已被夺走)'; }
  else if(hasBow){ dom.hintRanged.classList.remove('locked'); dom.hintLock.textContent=''; }
  else { dom.hintRanged.classList.add('locked'); dom.hintLock.textContent='(第二幕拾取亡魂之弓解锁)'; }
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
    addFloater(player.x+player.w/2, player.y-52, '按 F 或 Z 键可发射远程箭矢', '#e6d0ff', 14);
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
  if(tr.type==='ghost'){ // 第一幕鬼魂现身
    showStory([{act:'ACT I · 城墙', title:'鬼魂现身', portrait:0, lines:[
      { zh:'城墙尽头，寒雾翻涌。先王的鬼魂再度显形，抬手直指城堡深处。' },
      { zh:'鬼魂：“为我复仇——但那被死神攫住的躯壳，已认不得你了。”', speak:true,
        en:'“Taint not thy mind…”' },
      { zh:'（继续深入，直面恶灵版的老哈姆雷特国王）' }
    ]}], ()=>{ state=STATE.PLAY; addFloater(player.x,player.y-30,'深入城堡！','#e8c25a',15); });
  } else if(tr.type==='egghint'){ // 第三幕：通往湖边的线索
    showStory([{act:'HIDDEN · 线索', title:'湖边的歌声', portrait:2, lines:[
      { zh:'风里飘来断续的歌谣——是奥菲莉亚，就在前方的湖边小径。' },
      { zh:'哈姆雷特：“那歌声……她独自在湖边，太危险了。”', speak:true },
      { zh:'（抵达本幕终点，将进入隐藏彩蛋关 · 柳树湖畔）' }
    ]}], ()=>{ state=STATE.PLAY; });
  } else if(tr.type==='yorick'){ // 终章墓地
    showStory(STORY.a5_yorick, ()=>{ state=STATE.PLAY; });
  } else if(tr.type==='rescue'){ // 湖畔救援成功
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
function startBoss(entry){
  activeBossEntry=entry; entry.started=true; bossStarted=true;
  boss=makeBoss(entry.kind);
  const D=boss.def;
  let mus = D.music || 'boss';
  if(entry.final) mus = opheliaSaved?'hero':'boss';
  Sound.setMusic(mus, 1.1);
  const intro = BOSS_INTRO[entry.kind] || [];
  showStory(intro, ()=>{
    state=STATE.PLAY;
    addFloater(boss.x+boss.w/2, boss.y-20, 'BOSS 战 · '+D.name, ACTS[actIndex].accent||'#e8c25a', 16);
    showBossGuide();
  });
}
// Boss 计划驱动：所有含 level.bossPlan 的关卡通用（城堡/宫廷/英格兰关底 + 终章雷欧提斯&克劳迪奥）
function updateBossPlan(){
  if(state!==STATE.PLAY || player.dead) return;
  if(boss){ updateBoss(); updateBossUlt(); return; }
  const plan=level.bossPlan;
  for(const entry of plan){
    if(entry.defeated) continue;      // 已击败：跳过，检查下一个
    if(entry.started) return;         // 已开始但 boss 为空（过场中）：等待
    if(player.x+player.w > entry.triggerX){ startBoss(entry); return; }
    return;                           // 顺序触发：必须先击败前一个
  }
}
function damageBoss(dmg, fromX, ranged){
  if(!boss||boss.dead||boss.invuln>0) return;
  boss.hp-=dmg; boss.hitFlash=6; boss.invuln=6;
  boss.vx=(boss.x+boss.w/2>fromX?1:-1)*1.5;
  spark(boss.x+boss.w/2, boss.y+boss.h*0.4, boss.x+boss.w/2>fromX?1:-1, '#ffb0b0');
  shake(3,6); Sound.bossHit();
  player.energy=Math.min(player.maxEnergy, player.energy+ (ranged?3:5));
  const ratio=boss.hp/boss.maxHp, ph=boss.phases;
  if(ph>=3){
    if(ratio<=0.66 && boss.phase===1) bossPhaseTransition(2);
    else if(ratio<=0.33 && boss.phase===2) bossPhaseTransition(3);
  } else if(ph===2){
    if(ratio<=0.5 && boss.phase===1) bossPhaseTransition(2);
  }
  if(boss.hp<=0){ boss.hp=0; onBossDefeated(); }
}
function bossPhaseTransition(ph){
  boss.phase=ph; boss.invuln=90; boss.atkCd=60;
  Sound.bossPhase(); shake(10,24); flash(ph>=3?'rgba(200,20,20,0.4)':'rgba(200,120,40,0.3)',18);
  for(let i=0;i<26;i++) burst(boss.x+boss.w/2, boss.y+boss.h/2, ph>=3?'#ff4040':'#ffb060', 1, 5);
  const line=(BOSS_PHASE_LINES[boss.kind]||{})[ph];
  const lines=[];
  if(line) lines.push({ zh:line.zh, speak:true, en:line.en });
  lines.push({ zh: ph>=3?'血色染透战场——用尽全部力量，了结这一切！':'敌人形态骤变，攻势愈发凶猛！' });
  state=STATE.STORY;
  showStory([{act:'BOSS · 阶段 '+ph, title:(boss.def.name+' · 狂暴化'), portrait:actIndex, lines}], ()=>{ state=STATE.PLAY;
    if(boss.kind==='claudius' && ph===2){ // 克劳迪奥二阶段生成障碍毒池
      level.hazards.push({x:boss.x-200,y:GROUND_TOP-4,w:70,h:10,type:'poison'});
      level.hazards.push({x:boss.x+140,y:GROUND_TOP-4,w:70,h:10,type:'poison'});
    }
    if(boss.kind==='claudius'){ Sound.setMusic(opheliaSaved?'hero':'imperial', ph>=3?1.6:1.3); }
    addFloater(boss.x+boss.w/2, boss.y-20, '阶段 '+ph, ph>=3?'#ff4040':'#ffb060', 16);
  });
}
function updateBoss(){
  if(!boss) return;
  const b=boss, D=b.def;
  if(b.hitFlash>0)b.hitFlash--; if(b.invuln>0)b.invuln--;
  if(b.dead){ b.deathT--; return; }
  const px=player.x+player.w/2, ex=b.x+b.w/2;
  b.facing=px<ex?-1:1;
  const d=Math.abs(px-ex);
  const solids=solidsList();
  // 接触伤害
  if(!player.dead && player.invuln<=0 && rectsOverlap(player,b)) damagePlayer(b.phase>=3?11:7, ex);
  // 计时
  if(b.atkCd>0)b.atkCd--; if(b.summonCd>0)b.summonCd--; if(b.dashCd>0)b.dashCd--;
  if(b.poisonCd>0)b.poisonCd--; if(b.ultCd>0)b.ultCd--; if(b.atkT>0)b.atkT--;
  // 移动逼近
  if(b.state!=='dash'){ b.vx += (px<ex?-1:1)* (b.phase>=2?0.14:0.1); b.vx=clamp(b.vx,-(1.3+b.phase*0.3),(1.3+b.phase*0.3)); }
  // 近战
  if(d<64 && b.atkCd<=0){ b.atkT=22; b.atkCd = b.phase>=2?54:70; }
  if(b.atkT===10){ const hb=b.facing>0?{x:b.x+b.w,y:b.y,w:52,h:b.h}:{x:b.x-52,y:b.y,w:52,h:b.h}; if(!player.dead&&player.invuln<=0&&rectsOverlap(hb,player)) damagePlayer(b.phase>=3?12:8, ex); }
  // 召唤喽啰（具 summon 能力者）
  if(D.summon && b.phase===1 && b.summonCd<=0 && enemies.length<4){ b.summonCd=260; summonMinions(); }
  if(D.summon && b.phase>=2 && b.summonCd<=0 && enemies.length<3){ b.summonCd=340; summonMinions(); }
  // 远程（具 ranged 能力者，二阶段起）
  if(D.ranged && b.phase>=2 && b.poisonCd<=0){ b.poisonCd=110; enemyShootFromBoss(D.ranged==='poison'?'poison':'arrow'); if(D.ranged==='dagger' && Math.random()<0.5) enemyShootFromBoss('arrow'); }
  // 冲锋（具 dash 能力者；三阶段 Boss 二阶段起、其余从一阶段起）
  const dashPhase = b.phases>=3 ? 2 : 1;
  if(D.dash && b.phase>=dashPhase && b.dashCd<=0 && d>120 && d<360 && b.onGround){ b.state='dash'; b.dashT=24; b.dashCd=200; b.vx=(px<ex?-1:1)*8; addFloater(ex,b.y-16,'冲锋!','#ff8080',13); }
  if(b.state==='dash'){ b.dashT--; if(b.dashT<=0){ b.state='idle'; b.vx*=0.4; } }
  // 终极技（具 ult 能力者，三阶段）
  if(D.ult && b.phase===3 && b.ultCd<=0){ b.ultCd=320; bossUlt(); }
  stepPhysics(b, solids);
  const minX=(level.bossArena?level.bossArena.x:0)-40;
  b.x=clamp(b.x, minX, level.width-b.w);
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
  projectiles.push({owner:'enemy', x:sx,y:sy, vx:Math.cos(ang)*4.6, vy:Math.sin(ang)*4.6-1, w:12,h:4, dmg:boss.phase>=3?8:6, kind, life:170, ang});
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
      if(!player.dead && !onHigh && Math.abs((player.x+player.w/2)-bossUltX)<240){ player.invuln=0; damagePlayer(16, bossUltX); }
      else addFloater(player.x, player.y-20, '躲开了!', '#8ee88e', 14);
    }
  }
}
function onBossDefeated(){
  const entry=activeBossEntry, kind=boss.kind, D=boss.def;
  boss.dead=true; boss.deathT=120; bossStarted=false;
  Sound.stopMusic(); shake(16,40); flash('rgba(255,255,255,0.5)',20);
  for(let i=0;i<50;i++) burst(boss.x+boss.w/2, boss.y+boss.h*rand(0.1,0.9), i%2?'#e8c25a':'#fff', 1, 5);
  addScore(2000);
  // 清场敌人
  enemies.forEach(e=>{ if(!e.dying) killEnemy(e); });
  if(entry) entry.defeated=true;
  addFloater(boss.x+boss.w/2, boss.y-30, D.name+' 伏诛! +2000', '#e8c25a', 18);

  if(entry && entry.midboss){          // 终章中段 Boss 雷欧提斯：不结束关卡
    laertesDefeated=true; Sound.jingle('victory');
    onLaertesDefeated();
    return;
  }
  if(entry && entry.final){            // 终章最终 Boss 克劳迪奥：进入结局
    Sound.jingle(opheliaSaved?'epicwin':'somber');
    setTimeout(()=>{ startEnding(); }, 1600);
    return;
  }
  if(entry && entry.pairFirst){        // 第三幕双人小 Boss 第一人倒下：唤起第二人，不结束关卡
    Sound.jingle('victory');
    const nm=D.name;
    boss=null; activeBossEntry=null;
    showStory([{act:'ACT III · 双人夹击', title:nm+' 倒下', portrait:2, lines:[
      { zh:nm+'踉跄倒地——另一名旧友咆哮着拔剑扑来！' },
      { zh:'哈姆雷特：“一个偿了命，还有一个——一并了结。”', speak:true }
    ]}], ()=>{ state=STATE.PLAY; addFloater(player.x,player.y-30,'击破一人！迎战下一人','#e8c25a',15); });
    return;
  }
  // 关底 Boss（城堡恶灵先王 / 宫廷小丑 / 英格兰刺客队长）：完成本关
  Sound.jingle('victory');
  const clearText = { ghostking:'★ 恶灵先王得以安息 ★', clown:'★ 小丑波洛涅斯伏诛 ★', assassin:'★ 刺客队长授首 ★', guildenstern:'★ 罗森格兰兹与吉尔登斯顿伏诛 ★' }[kind] || (ACTS[actIndex].name+' 完成');
  activeBossEntry=null;
  setTimeout(()=>{ completeLevel(clearText); }, 1200);
}
// 雷欧提斯（终章中段）被击败：分支后果 —— 救到奥菲莉亚则替挡毒剑，否则中毒倒计时
function onLaertesDefeated(){
  const pages = opheliaSaved ? STORY.laertes_saved : STORY.laertes_lost;
  setTimeout(()=>{
    showStory(pages, ()=>{
      state=STATE.PLAY;
      boss=null; activeBossEntry=null;          // 清除中段 Boss，玩家前进即可触发克劳迪奥
      if(!opheliaSaved){
        poisonT = 60*45;                         // 未救到：中毒 45 秒倒计时
        addFloater(player.x, player.y-34, '☠ 中毒！45 秒内击败克劳迪奥', '#9bff6a', 15);
        Sound.setMusic('imperial', 1.2);
      } else {
        addFloater(player.x, player.y-34, '奥菲莉亚为你挡下了毒剑！', '#ffd0e6', 15);
        Sound.setMusic('hero', 1.2);
      }
    });
  }, 1000);
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
  // Boss 战失败：重置 Boss，并允许玩家从 Boss 战前检查点重新触发本轮 Boss
  if(boss){ boss=null; bossStarted=false; bossUltTimer=0;
    dismissBossGuide();
    if(activeBossEntry){ activeBossEntry.started=false; }
    activeBossEntry=null;
    // 清除 boss 阶段生成的毒池
    level.hazards=level.hazards.filter(h=>!(h.type==='poison'&&level.bossArena&&h.x>level.bossArena.x-260&&h.y<GROUND_TOP));
    if(level.bossArena) enemies=enemies.filter(e=>e.x<level.bossArena.x); // 清 boss 场喽啰
  }
  projectiles=[]; rocks=[];
  const spawnX = Number.isFinite(respawn&&respawn.x) ? respawn.x : level.playerStart.x;
  const spawnY = Number.isFinite(respawn&&respawn.y) ? respawn.y : level.playerStart.y;
  respawn={x:spawnX, y:spawnY};
  player=makePlayer(spawnX, spawnY);
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
    if(player.x>level.goalX-80){ hintPulse=1; if(!player.dead) addFloaterThrottled(); }
    return;
  }
  // 仅"goal"模式关卡（第三幕逃亡）靠抵达终点完成；boss/rescue/finale 由各自逻辑处理
  if(level.completeMode!=='goal') return;
  if(!goalReached && player.x+player.w > level.goalX){ goalReached=true; completeLevel(); }
}
let _lastHint=0;
function addFloaterThrottled(){
  if(frame-_lastHint<90){ return; } _lastHint=frame;
  addFloater(player.x+player.w/2, player.y-30, '前路封锁：先触发过场！', '#ff8a8a', 14);
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
  showStory(STORY.egg_saved, ()=>{ completeLevel('★ 奥菲莉亚得救 ★'); });
}
function opheliaLost(){
  opheliaSaved=false;
  // 亡魂之弓被鬼魂夺走：远程攻击永久失效
  hasBow=false; bowLost=true; if(player) player.ammo=0;
  updateBowHintUI(); updateHUD();
  Sound.stopMusic(); Sound.jingle('somber');
  flash('rgba(40,30,70,0.5)',24);
  for(let i=0;i<40;i++) ripple(player.x+rand(-100,100), GROUND_TOP+rand(0,20));
  state=STATE.STORY;
  showStory(STORY.egg_lost, ()=>{ completeLevel('✝ 奥菲莉亚沉湖 · 亡魂之弓被夺 ✝'); });
}

// 幕间推进（六段：0城堡→1宫廷→2逃亡→3湖边彩蛋→4英格兰→5终章）
function proceedAfterClear(){
  hide(dom.levelClearScreen);
  const done=actIndex;
  if(done===ACT_CASTLE){ chainStory([STORY.a1_reveal, STORY.a2_open], ()=>startAct(ACT_COURT)); }
  else if(done===ACT_COURT){ chainStory([STORY.a3_open], ()=>startAct(ACT_ESCAPE)); }
  else if(done===ACT_ESCAPE){ chainStory([STORY.egg_enter], ()=>startAct(ACT_LAKE)); }
  else if(done===ACT_LAKE){ chainStory([STORY.a4_open], ()=>startAct(ACT_ENGLAND)); }
  else if(done===ACT_ENGLAND){ chainStory([STORY.a4_end, opheliaSaved?STORY.a5_open_saved:STORY.a5_open_lost], ()=>startAct(ACT_FINAL)); }
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
  Dialog.update();                 // 非阻断顶部对白栏（不暂停游戏）
  updatePunkOphelia();             // 第三幕背景疯癫奥菲莉亚
  // 湖畔彩蛋倒计时
  if(actIndex===ACT_LAKE){ level.timeLeft -= 1/60; dom.timer.textContent=Math.max(0,Math.ceil(level.timeLeft));
    if(level.rescue && level.rescue.saved){}
    else if(level.timeLeft<=0){ opheliaLost(); return; }
  }
  // 中毒倒计时（终章未救到奥菲莉亚：雷欧提斯毒剑）
  if(poisonT>0){
    poisonT--;
    dom.timer.textContent=Math.max(0,Math.ceil(poisonT/60));
    if(frame%42===0 && !player.dead){ player.hp-=2; if(player.hp<=0){ player.hp=0; onPlayerDeath(); return; } else { updateHUD(); flash('rgba(120,200,60,0.12)',6); } }
    if(poisonT<=0 && !player.dead){ damagePlayer(999, player.x); return; }
  }
  // Boss 计划驱动（城堡/宫廷/英格兰关底 + 终章雷欧提斯&克劳迪奥）
  if(level.bossPlan){ updateBossPlan(); }
  // 阴郁模式环境（终章失败路线）
  if(actIndex===ACT_FINAL && darkMode){
    if(frame%40===0){ crows.push({x:camX-30,y:camY+rand(20,120),vx:rand(1.2,2.2),flap:0}); }
    if(frame%6===0) petals.push({x:camX+rand(0,VW),y:camY-10,vx:rand(-.5,.1),vy:rand(.4,1),rot:rand(0,6.28),vr:.08,size:rand(3,5),color:'#5a4a3a',ph:rand(0,6.28),life:300});
  }
  // 湖畔/英格兰花瓣、海雾氛围
  if(actIndex===ACT_LAKE && frame%20===0) spawnPetal(camX+rand(0,VW), camY-10, '#dfeaf5');
  if(actIndex===ACT_ENGLAND && frame%30===0) spawnPetal(camX+rand(0,VW), camY-10, 'rgba(210,225,235,0.6)');
  checkLevelProgress();
  updateCamera();
  if(++hudTick%4===0) updateHUD();
}
// 第三幕背景：疯癫朋克奥菲莉亚缓慢游荡 + 疯话
function updatePunkOphelia(){
  const po=level.punkOphelia; if(!po) return;
  po.phase+=0.02;
  po.x = po.baseX + Math.sin(po.phase)*70;
  po.lineT--; if(po.lineT<=0){ po.lineT=280;
    const madLines=['他死了，去了，小姐……','这是三色堇，是为了思念。','明天是圣瓦伦丁节……','他不会回来了吗？'];
    po.lineI=(po.lineI+1)%madLines.length;
    if(Math.abs(po.x-player.x)<VW*0.7){ addFloater(po.x, GROUND_TOP-90, madLines[po.lineI], '#d6a8e8', 12); Sound.punkGlitch(); }
  }
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
  const label=(boss.def&&boss.def.label)||'BOSS';
  ctx.fillText(label + (boss.phases>1?('   第 '+boss.phase+' 阶段'):''), W/2, by-6);
  // 底
  ctx.fillStyle='#3a0d0d'; ctx.fillRect(bx,by,bw,10);
  const ratio=clamp(boss.hp/boss.maxHp,0,1);
  const col = boss.phase>=3?'#ff2020':(boss.phase===2?'#ff7040':'#e23b3b');
  const g=ctx.createLinearGradient(bx,0,bx,by+10); g.addColorStop(0,'#ff9b9b'); g.addColorStop(1,col);
  ctx.fillStyle=g; ctx.fillRect(bx,by,bw*ratio,10);
  // 阶段分隔线
  ctx.fillStyle='rgba(0,0,0,0.6)';
  if(boss.phases>=3){ ctx.fillRect(bx+bw*0.66,by,2,10); ctx.fillRect(bx+bw*0.33,by,2,10); }
  else if(boss.phases===2){ ctx.fillRect(bx+bw*0.5,by,2,10); }
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
  show(dom.hud); show(dom.scorePanel); show(dom.muteBtn); show(dom.ctrlHint); show(dom.dlgBar);
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
