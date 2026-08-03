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

const STATE = { NICKNAME_SETUP:'nickname_setup', TITLE:'title', STORY:'story', PLAY:'play', CLEAR:'clear', WIN:'win', LOSE:'lose' };
let state = STATE.NICKNAME_SETUP;
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
let opheliaWounded = false;          // 生还线第五幕：奥菲莉亚替挡毒剑后倒下
let ghostOpheliaFinale = false;      // 生还线最终战：亡魂奥菲莉亚半透明助战
// 终章最终战（克劳迪奥）画面特效状态（帧驱动，禁止 setInterval/setTimeout）
let finalLightning = { next:0, flashes:0, nextFlash:0, boltUntil:0, segs:[] };
let finalBossEntryFrame = -1;        // 克劳迪奥进场暗化特效起始 frame，-1 表示未触发

/* --- 第四幕「船舱战斗区」子状态 + 船只摇晃（全部严格 ACT_ENGLAND / cabin guard，绝不影响其它幕） --- */
let cabinActive=false;               // 是否正处于船舱场景（此时 level 已切换为 cabinLevel）
let cabinPhase=null;                 // null|'opening'|'toCabin'|'inCabin'|'active'|'toDeck'|'inDeck'
let cabinPhaseT=0;                   // 当前过场阶段计时（帧）
let cabinFade=0;                     // 进/出船舱的画面淡黑遮罩 alpha 0..1
let cabinLevel=null, deckLevel=null; // 船舱关卡对象 / 保存的甲板关卡对象引用
let deckSnap=null;                   // 进舱前甲板实体快照（enemies/boss/相机等），返回时恢复
let cabinReturn=null;                // 返回甲板时玩家坐标与朝向
let cabinDoorTr=null;                // 触发进入的舱门 trigger（用于门开动画）
let cabinCleared=false;              // 舱内战斗是否全部肃清（用于解锁甲板刺客队长 Boss）
let cabinWave=0, cabinWaveState='idle', cabinWaveT=0;   // 波次索引 / 状态 / 计时
let cabinPrompt=null;                // 常驻交互提示文案（靠近才显示、离开消失），每帧重置
let playerSlowT=0;                   // 舷窗水柱命中后的减速 debuff 帧数
/* --- 船体摇晃（仅第四幕、仅作用于玩家；舱内与其它幕均为 0） --- */
let shipRock=true;                   // 船体摇晃总开关
let rockAngle=0;                     // 当前帧船体倾斜角（rad），驱动整屏视觉倾斜
let rockOffset=0;                    // 当前帧船体像素级偏移，用于背景/甲板视觉呼应

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
/* -------- 视差 & 背景特效工具（纯程序化，无外部资源） --------
   三层视差以 camX 为水平滚动量：远景 0.2 / 中景 0.5 / 近景 0.8。
   parallaxOff(factor,period) 返回 [0,period) 的回绕偏移，配合
   `for(let bx=-off; bx<W+period; bx+=period)` 平铺，保证不出现空洞。 */
function parallaxOff(factor, period){ let o=(camX*factor)%period; if(o<0)o+=period; return o; }
// 基于整数索引的确定性伪随机（静态元素用，避免每帧跳动）
function hnoise(i){ const s=Math.sin(i*12.9898+78.233)*43758.5453; return s-Math.floor(s); }
// 全屏冲击波（阶段切换）：从中心扩散的白色圆环，帧驱动
let shockwaves=[];
function spawnShockwave(){ shockwaves.push({t:0, max:46}); if(shockwaves.length>4) shockwaves.shift(); }
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

function canForceExitCabin(){
  return state===STATE.PLAY && actIndex===ACT_ENGLAND && cabinActive && cabinPhase==='active';
}
function handleCabinEscExit(e){
  if(!(e.code==='Escape'||e.key==='Escape'||e.keyCode===27) || !canForceExitCabin()) return false;
  startCabinExit();
  addScreenFloater(W/2,150,'ESC 强制撤离 · 返回甲板','#ffe0b0',15,90);
  e.preventDefault(); e.stopImmediatePropagation();
  return true;
}
// 趣味关卡 / 第四幕船舱 Esc 退出需要最高优先级捕获，避免 story/pause/messageBoard 等状态先吃掉按键。
window.addEventListener('keydown', e=>{
  if(handleCabinEscExit(e)) return;
  if(e.code==='Escape' && bonusLevel){
    e.preventDefault(); e.stopImmediatePropagation();
    exitBonus(state==='messageBoard');
    return;
  }
}, true);
// 二级保险：document 捕获阶段再次强制拦截 Esc（exitBonus / 船舱强制撤离均幂等），确保任何状态下都能退出。
document.addEventListener('keydown', e=>{
  if(handleCabinEscExit(e)) return;
  if((e.code==='Escape'||e.key==='Escape'||e.keyCode===27) && bonusLevel){
    exitBonus(false);
    e.stopImmediatePropagation(); e.preventDefault();
  }
}, true);

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

function bindVirtualButton(id,key){
  const el=document.getElementById(id); if(!el) return;
  const on=e=>{ e.preventDefault(); if(!keys[key]){ if(key==='jump')jumpEdge=true; if(key==='atk')atkEdge=true; if(key==='ranged')rangedEdge=true; } keys[key]=true; };
  const off=e=>{ e.preventDefault(); keys[key]=false; };
  el.addEventListener('touchstart',on,{passive:false});
  el.addEventListener('touchend',off,{passive:false});
  el.addEventListener('touchcancel',off,{passive:false});
}
function initVirtualPad(){
  bindVirtualButton('vLeft','left');
  bindVirtualButton('vRight','right');
  bindVirtualButton('vJump','jump');
  bindVirtualButton('vAttack','atk');
  bindVirtualButton('vRange','ranged');
}
function checkOrientation(){
  const hint=document.getElementById('rotateHint');
  if(!hint) return;
  const isPortrait=window.innerHeight>window.innerWidth;
  hint.style.display=isPortrait?'flex':'none';
}
initVirtualPad();
window.addEventListener('resize',checkOrientation);
window.addEventListener('orientationchange',checkOrientation);
checkOrientation();

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
  custom:false, custMusic:null, custSecIdx:0, custNextT:0,
  // ---- 层一：真实管弦乐素材（CC0 OGG，base64 内嵌于 bgm-assets.js）运行时解码为 AudioBuffer 循环铺底 ----
  orchBuf:{}, orchLoading:{}, orchSrc:null, orchBedGain:null, orchName:null,
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
    try {
      [138,146,207].forEach((f,i)=>this.blip(f*(1+i*0.04),.5,'sawtooth',.15,i*.02,f*0.6));
      this.noise(.34,.13,0,600);
      this.blip(440,.28,'sawtooth',.09,.05,110);
    } catch {}
  },
  // ---- 通用合成助手（供 ≥3s 角色个性音效使用）----
  // 灵活振荡器：freq 可为常量或 [起,止] 做指数扫频；env 定义包络；dest 可指定连接节点（默认 sfx gain）
  voiceOsc(o){ if(!this.ctx||!this.enabled) return null;
    const t=this.ctx.currentTime+(o.when||0), dur=o.dur||1;
    const osc=this.ctx.createOscillator(), g=this.ctx.createGain();
    osc.type=o.type||'sine';
    if(Array.isArray(o.f)){ osc.frequency.setValueAtTime(o.f[0],t); osc.frequency.exponentialRampToValueAtTime(Math.max(1,o.f[1]),t+dur); }
    else osc.frequency.setValueAtTime(o.f,t);
    if(o.vib){ // 颤音：额外 LFO 调制主频
      const lfo=this.ctx.createOscillator(), lg=this.ctx.createGain();
      lfo.frequency.value=o.vib.rate||6; lg.gain.value=o.vib.depth||6;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t+dur+.05);
    }
    const vol=o.vol||.2, atk=o.atk||.04, rel=o.rel||dur*.4;
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(vol,t+atk);
    g.gain.setValueAtTime(vol,t+Math.max(atk,dur-rel));
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    if(o.dist){ const ws=this.ctx.createWaveShaper(); ws.curve=this.distCurve(o.dist); ws.oversample='2x'; osc.connect(ws); ws.connect(g); }
    else osc.connect(g);
    g.connect(o.dest||this.sg);
    osc.start(t); osc.stop(t+dur+.05);
    return g;
  },
  distCurve(k){ const n=256, c=new Float32Array(n), deg=Math.PI/180;
    for(let i=0;i<n;i++){ const x=i*2/n-1; c[i]=(3+k)*x*20*deg/(Math.PI+k*Math.abs(x)); } return c; },
  // 带反馈的延迟链，返回可作为 dest 的输入节点（用于回响/空灵效果）
  makeEcho(time,fb,when){ if(!this.ctx||!this.enabled) return this.sg;
    const inp=this.ctx.createGain(), d=this.ctx.createDelay(1.0), fbg=this.ctx.createGain(), wet=this.ctx.createGain();
    d.delayTime.value=time; fbg.gain.value=fb; wet.gain.value=.9;
    inp.connect(this.sg); inp.connect(d); d.connect(fbg); fbg.connect(d); d.connect(wet); wet.connect(this.sg);
    return inp;
  },
  // 持续白噪声（带滤波），用于环境/军鼓等，dur 秒
  noiseBed(dur,vol,filterType,freq,q,when){ if(!this.ctx||!this.enabled) return;
    const t=this.ctx.currentTime+(when||0), n=Math.floor(this.ctx.sampleRate*dur);
    const b=this.ctx.createBuffer(1,n,this.ctx.sampleRate), dt=b.getChannelData(0);
    for(let i=0;i<n;i++) dt[i]=Math.random()*2-1;
    const s=this.ctx.createBufferSource(); s.buffer=b;
    const f=this.ctx.createBiquadFilter(); f.type=filterType||'bandpass'; f.frequency.value=freq||600; if(q)f.Q.value=q;
    const g=this.ctx.createGain();
    g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+.15);
    g.gain.setValueAtTime(vol,t+dur*.7); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    s.connect(f); f.connect(g); g.connect(this.sg); s.start(t); s.stop(t+dur+.02);
  },
  // ================= 舞台配音叠加层：环境音 + 合成配音 =================
  stageReverbMix(dur, wet=.55){ if(!this.ctx||!this.enabled) return this.sg;
    const inp=this.ctx.createGain(), dry=this.ctx.createGain(), d=this.ctx.createDelay(1.0), fb=this.ctx.createGain(), wg=this.ctx.createGain();
    dry.gain.value=Math.max(0.05, 1-wet); d.delayTime.value=.28; fb.gain.value=.38; wg.gain.value=wet;
    inp.connect(dry); dry.connect(this.sg); inp.connect(d); d.connect(fb); fb.connect(d); d.connect(wg); wg.connect(this.sg);
    return inp;
  },
  stageAmbience(dur=4.0){ this.safe(function(){
    const t=this.ctx.currentTime, d=Math.max(1.2, dur), rev=this.stageReverbMix(d,.62);
    // 木地板脚步回响：低频敲击 + 舞台反射，避免覆盖既有 SFX，仅通过 gain 混合叠加。
    for(let w=.12; w<d; w+=.72+Math.random()*.18){
      this.voiceOsc({type:'triangle', f:[105,62], dur:.18, vol:.045, atk:.006, rel:.13, when:w, dest:rev});
      this.noiseBed(.12,.018,'lowpass',360,1.2,w);
    }
    // 观众席静谧感：极低白噪声 + 高通滤波，若有若无。
    this.noiseBed(d,.012,'highpass',2400,.8,0);
    // 弦乐低鸣底托：120-180Hz 极低音量，慢速颤动。
    this.voiceOsc({type:'sine', f:138, dur:d, vol:.035, atk:.8, rel:1.2, vib:{rate:.9,depth:8}, dest:rev});
    this.voiceOsc({type:'sine', f:174, dur:d, vol:.018, atk:1.0, rel:1.2, vib:{rate:1.2,depth:5}, dest:rev});
  }); },
  syntheticVoice(kind, lineIndex=0){ this.safe(function(){
    const dur=2.3 + (lineIndex%3)*.45, rev=this.stageReverbMix(dur+.8,.7);
    if(kind==='ghostking' || kind==='ghost'){
      this.voiceOsc({type:'sine', f:[82,148], dur:dur, vol:.22, atk:.55, rel:.9, vib:{rate:2.2,depth:5}, dest:rev});
      this.voiceOsc({type:'triangle', f:[124,88], dur:dur, vol:.09, atk:.7, rel:.9, dest:rev});
      this.noiseBed(dur,.018,'lowpass',210,2,0);
    } else if(kind==='clown' || kind==='polonius'){
      this.voiceOsc({type:'triangle', f:[220,330], dur:Math.min(2.5,dur), vol:.18, atk:.08, rel:.45, vib:{rate:6,depth:10}, dest:rev});
      this.voiceOsc({type:'sine', f:280, dur:Math.min(2.1,dur), vol:.07, atk:.05, rel:.35, vib:{rate:6,depth:7}, dest:rev});
    } else if(kind==='claudius'){
      const lp=this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=520; lp.Q.value=1.4; lp.connect(rev);
      this.voiceOsc({type:'sawtooth', f:[55,96], dur:dur+.3, vol:.20, atk:.35, rel:.85, dest:lp});
      this.voiceOsc({type:'sawtooth', f:[82,72], dur:dur+.3, vol:.11, atk:.4, rel:.85, dest:lp});
    } else if(kind==='laertes'){
      for(let i=0;i<4;i++) this.voiceOsc({type:'square', f:320+i*45, dur:.42, vol:.12, atk:.015, rel:.22, when:i*.38, dest:rev});
      this.noiseBed(1.8,.035,'highpass',1200,2,0);
    } else if(kind==='horatio'){
      this.voiceOsc({type:'sine', f:262, dur:dur, vol:.10, atk:.45, rel:.8, dest:rev});
      this.voiceOsc({type:'sine', f:393, dur:dur, vol:.06, atk:.5, rel:.8, dest:rev});
      this.voiceOsc({type:'triangle', f:524, dur:dur, vol:.032, atk:.65, rel:.8, dest:rev});
    } else if(kind==='hamletStage'){
      this.voiceOsc({type:'sine', f:[118,145], dur:Math.max(2.6,dur), vol:.14, atk:.45, rel:.95, vib:{rate:3.1,depth:4}, dest:rev});
      this.voiceOsc({type:'triangle', f:[176,132], dur:Math.max(2.6,dur), vol:.055, atk:.6, rel:.95, dest:rev});
    } else if(kind==='assassin'){
      this.voiceAssassin();
    }
  }); },
  storyVoiceCue(piece, page, lineIndex){ this.safe(function(){
    if(!piece || !piece.speak) return;
    const text=(piece.text||'')+' '+((page&&page.title)||'')+' '+((page&&page.act)||'');
    let kind=null;
    if(/老哈姆雷特|恶灵|鬼魂|先王/.test(text)) kind='ghostking';
    else if(/波洛涅斯|小丑/.test(text)) kind='polonius';
    else if(/克劳迪奥|弑君者/.test(text)) kind='claudius';
    else if(/雷欧提斯/.test(text)) kind='laertes';
    else if(/霍拉旭/.test(text)) kind='horatio';
    else if(/哈姆雷特/.test(text)) kind='hamletStage';
    else if(/刺客/.test(text)) kind='assassin';
    if(kind){ this.stageAmbience(4.0); this.syntheticVoice(kind,lineIndex||0); }
  }); },
  monologueVoiceCue(lineIndex){ this.safe(function(){ this.monologueSpeak(lineIndex||0); }); },
  // ===== 第五幕独白 · 合成低沉英伦男声（卷福式）朗读台词 =====
  // 基频100–130Hz，正弦+少量锯齿(0.8:0.2)；ADSR(a.02 d.1 s.85 r.3)；6Hz±3Hz颤音0.2s后渐入；DelayNode 0.15s/反馈0.3/湿声~30%舞台混响；每行1.5–3s
  monologueSpeak(lineIndex){ this.safe(function(){
    if(!this.ctx) return;
    const ctx=this.ctx, t=ctx.currentTime, idx=lineIndex||0;
    const lines=(typeof ACT5_MONOLOGUE!=='undefined')?ACT5_MONOLOGUE:null;
    const en=(lines&&lines[idx]&&lines[idx].en)?lines[idx].en:'';
    const dur=Math.min(3.0, Math.max(1.5, 1.55 + en.length*0.02));   // 依台词长度 1.5–3s
    const f0=112 + ((idx%3)-1)*9;                                    // 100–130Hz 基频，逐行微起伏
    // —— 舞台混响：DelayNode 0.15s + 反馈0.3 + 湿声~30% ——
    const bus=ctx.createGain(), dry=ctx.createGain(), wet=ctx.createGain(), dl=ctx.createDelay(1.0), fb=ctx.createGain();
    dry.gain.value=0.7; wet.gain.value=0.3; dl.delayTime.value=0.15; fb.gain.value=0.3;
    bus.connect(dry); bus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet);
    dry.connect(this.sg); wet.connect(this.sg);
    // —— ADSR 包络（attack .02 / decay .1 → sustain .85 / release .3）——
    const env=ctx.createGain(); env.connect(bus);
    const peak=0.20, sus=peak*0.85;
    env.gain.setValueAtTime(0.0001,t);
    env.gain.exponentialRampToValueAtTime(peak,t+0.02);                       // attack
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002,sus),t+0.12);       // decay→sustain(.85)
    env.gain.setValueAtTime(Math.max(0.0002,sus),t+Math.max(0.14,dur-0.3));
    env.gain.exponentialRampToValueAtTime(0.0001,t+dur);                      // release .3s
    // —— 颤音 LFO：6Hz，±3Hz，0.2s 后渐入 ——
    const lfo=ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=6;
    const lfoG=ctx.createGain();
    lfoG.gain.setValueAtTime(0.0001,t); lfoG.gain.setValueAtTime(0.0001,t+0.2); lfoG.gain.linearRampToValueAtTime(3,t+0.6);
    lfo.connect(lfoG); lfo.start(t); lfo.stop(t+dur+0.05);
    // —— 主体：正弦为主 + 少量锯齿（0.8:0.2），句尾轻微下滑更似人声 ——
    const oSine=ctx.createOscillator(), gSine=ctx.createGain();
    oSine.type='sine'; oSine.frequency.setValueAtTime(f0,t); oSine.frequency.linearRampToValueAtTime(f0*0.92,t+dur);
    gSine.gain.value=0.8; lfoG.connect(oSine.frequency); oSine.connect(gSine); gSine.connect(env);
    const oSaw=ctx.createOscillator(), gSaw=ctx.createGain(), lp=ctx.createBiquadFilter();
    oSaw.type='sawtooth'; oSaw.frequency.setValueAtTime(f0,t); oSaw.frequency.linearRampToValueAtTime(f0*0.92,t+dur);
    gSaw.gain.value=0.2; lp.type='lowpass'; lp.frequency.value=1400; lp.Q.value=0.7;
    lfoG.connect(oSaw.frequency); oSaw.connect(gSaw); gSaw.connect(lp); lp.connect(env);
    oSine.start(t); oSine.stop(t+dur+0.05); oSaw.start(t); oSaw.stop(t+dur+0.05);
  }); },
  // ===== 第五幕独白 · NT Live 风格管弦配乐（弦乐床+铜管主题+高音弦律+大鼓）=====
  // 全程贯穿：慢速渐入→（末行 tutti）→慢速渐出；循环时长≥45s；所有音量变化经 exponentialRampToValueAtTime，绝不硬切
  monologueScore(){ this.safe(function(){
    if(!this.ctx || this._monoScore) return;                        // 防重复叠加
    const ctx=this.ctx, t0=ctx.currentTime;
    const bus=ctx.createGain();
    bus.gain.setValueAtTime(0.0001,t0); bus.gain.exponentialRampToValueAtTime(0.6,t0+3.0);   // 慢速渐入
    bus.connect(this.master);
    const S={ bus:bus, nodes:[] }; this._monoScore=S;
    const reg=n=>{ S.nodes.push(n); return n; };
    const beat=0.5, total=48, nBeats=Math.ceil(total/beat);         // 96拍≈48s（≥45s）
    // c 小三和弦：root C3=130.81 / 三度 Eb3=155.56 / 五度 G3=196.00
    const chord=[130.81,155.56,196.00];
    // —— 弦乐床：三独立振荡器持续音，低音量，4Hz 颤音 ——
    chord.forEach((f,i)=>{
      const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f;
      const filt=ctx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=900; filt.Q.value=0.5;
      const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(0.05-i*0.008,t0+2.4);
      const trem=ctx.createOscillator(); trem.type='sine'; trem.frequency.value=4;
      const tremG=ctx.createGain(); tremG.gain.value=0.012;
      trem.connect(tremG); tremG.connect(g.gain);
      o.connect(filt); filt.connect(g); g.connect(bus);
      o.start(t0); o.stop(t0+total+0.5); trem.start(t0); trem.stop(t0+total+0.5); reg(o); reg(trem);
    });
    // —— 大鼓：每4拍一次 50–80Hz 脉冲 ——
    for(let b=0;b<nBeats;b+=4){ const t=t0+b*beat;
      const o=ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(78,t); o.frequency.exponentialRampToValueAtTime(50,t+0.22);
      const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.5,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t+0.6);
    }
    // —— 铜管主题：200–350Hz 锯齿，附点节奏，低通滤波 ——
    const brassSeq=[220,0,262,294,0,330,294,262];
    const bf=ctx.createBiquadFilter(); bf.type='lowpass'; bf.frequency.value=1100; bf.Q.value=0.8; bf.connect(bus);
    for(let b=0;b<nBeats;b++){ const f=brassSeq[b%brassSeq.length]; if(!f) continue;
      const dotted=((b%2)===0)?beat*1.5:beat*0.5, t=t0+b*beat;      // 附点/短 交替
      const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.setValueAtTime(f,t);
      const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.07,t+0.04); g.gain.exponentialRampToValueAtTime(0.0001,t+dotted*0.95);
      o.connect(g); g.connect(bf); o.start(t); o.stop(t+dotted+0.05);
    }
    // —— 高音弦律：600–800Hz 正弦旋律 ——
    const melo=[659,784,698,0,659,587,659,0];
    for(let b=0;b<nBeats;b++){ const f=melo[b%melo.length]; if(!f) continue;
      const t=t0+b*beat, o=ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(f,t);
      const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.045,t+0.08); g.gain.exponentialRampToValueAtTime(0.0001,t+beat*0.9);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t+beat+0.05);
    }
  }); },
  // 末行满编 tutti：总线音量指数上扬（绝不硬切）
  monologueScoreTutti(){ this.safe(function(){
    if(!this._monoScore || !this.ctx) return;
    const t=this.ctx.currentTime, g=this._monoScore.bus.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.max(0.0001,g.value),t); g.exponentialRampToValueAtTime(0.92,t+2.0);
  }); },
  // 独白结束：总线音量指数渐出后停止全部节点
  monologueScoreStop(){ this.safe(function(){
    const S=this._monoScore; if(!S || !this.ctx){ this._monoScore=null; return; }
    const t=this.ctx.currentTime, g=S.bus.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(Math.max(0.0001,g.value),t); g.exponentialRampToValueAtTime(0.0001,t+2.5); // 慢速渐出
    setTimeout(()=>{ (S.nodes||[]).forEach(n=>{ try{ n.stop&&n.stop(); }catch{} }); try{ S.bus.disconnect(); }catch{} }, 2800);
    this._monoScore=null;
  }); },
  // ================= 各角色 ≥3s 个性音效 =================
  // 老哈姆雷特鬼魂：低沉回响警告声（100-200Hz，渐强后渐弱，加回响，3s）
  voiceGhost(){ this.safe(function(){ const echo=this.makeEcho(.28,.4);
    this.voiceOsc({type:'sine', f:[100,150], dur:3.0, vol:.30, atk:.9, rel:1.4, dest:echo});
    this.voiceOsc({type:'triangle', f:[200,120], dur:3.0, vol:.14, atk:1.1, rel:1.5, dest:echo});
    this.noiseBed(3.0,.05,'lowpass',180,4);
    this.voiceOsc({type:'sine', f:66, dur:3.0, vol:.10, atk:1.2, rel:1.4});
  }); },
  // 波洛涅斯（伪装小丑）：喜剧性木管上行 400→700，后接 2s 泡泡音（≈3s）
  voicePolonius(){ this.safe(function(){
    [400,500,600,700].forEach((f,i)=>this.voiceOsc({type:'triangle', f:f, dur:.22, vol:.20, atk:.02, rel:.12, when:i*.16}));
    // 泡泡：随机快速短促上滑音，覆盖 ~2s
    for(let i=0;i<16;i++){ const w=.75+i*.12+Math.random()*.04, bf=360+Math.random()*520;
      this.voiceOsc({type:'sine', f:[bf,bf*1.7], dur:.13, vol:.12, atk:.01, rel:.09, when:w}); }
  }); },
  // 克劳迪奥：威胁性低音铜管（50-150Hz，锯齿波，3s 渐强）
  voiceClaudius(){ this.safe(function(){
    this.voiceOsc({type:'sawtooth', f:[50,150], dur:3.0, vol:.28, atk:2.2, rel:.6});
    this.voiceOsc({type:'sawtooth', f:[75,225], dur:3.0, vol:.12, atk:2.4, rel:.6}); // 五度叠加
    this.noiseBed(3.0,.04,'lowpass',140,2);
  }); },
  // 雷欧提斯：剑鸣（2000→800Hz 渐降，加短混响，3s 由金属余韵填满）
  voiceLaertes(){ this.safe(function(){ const echo=this.makeEcho(.16,.42);
    this.voiceOsc({type:'triangle', f:[2000,800], dur:.5, vol:.22, atk:.005, rel:.4, dest:echo});
    this.voiceOsc({type:'sine', f:[3000,1200], dur:.5, vol:.12, atk:.005, rel:.4, dest:echo}); // 泛音
    this.noiseBed(.18,.10,'highpass',2600,6);
    // 金属余韵：递减的高频铃音铺满剩余 ~2.5s
    [1600,1300,1050,880].forEach((f,i)=>this.voiceOsc({type:'triangle', f:f, dur:.9-i*.12, vol:.09-i*.015, atk:.01, rel:.7, when:.5+i*.55, dest:echo}));
  }); },
  // 霍拉旭：温和弦乐（440+550Hz 正弦和声，3s 渐入渐出）
  voiceHoratio(){ this.safe(function(){
    this.voiceOsc({type:'sine', f:440, dur:3.0, vol:.16, atk:1.1, rel:1.3});
    this.voiceOsc({type:'sine', f:550, dur:3.0, vol:.13, atk:1.2, rel:1.3}); // 大三度和声
    this.voiceOsc({type:'triangle', f:330, dur:3.0, vol:.08, atk:1.3, rel:1.3});
  }); },
  // 英格兰刺客队长：军鼓节奏（噪声 + 低通，0.2s 一击，持续 3s）
  voiceAssassin(){ this.safe(function(){
    let w=0; for(let i=0;i<15;i++){ const accent=(i%4===0); this.noiseBed(.16, accent?.22:.13,'lowpass', accent?260:200, 1, w);
      if(accent) this.voiceOsc({type:'sine', f:90, dur:.14, vol:.14, atk:.005, rel:.1, when:w}); w+=.2; }
  }); },
  // ================= 奥菲莉亚三态：脚步 / 笑声 / 环境音 =================
  // 脚步：normal 轻柔优雅高频短促；punk 急促（由调用侧随机间隔控制）；ghost 无
  opheliaStep(mode){ this.safe(function(){
    if(mode==='ghost') return;
    if(mode==='punk'){ this.voiceOsc({type:'square', f:[520,300], dur:.09, vol:.10, atk:.004, rel:.06}); this.noise(.04,.05,0,900); }
    else { this.voiceOsc({type:'triangle', f:[760,620], dur:.15, vol:.07, atk:.01, rel:.1}); }
  }); },
  // 笑声：normal 轻柔女声笑声；punk 失真疯笑；ghost 空灵回响疯笑（均 ≥3s，严格按规格合成）
  opheliaLaugh(mode){
    if(!this.ctx || this.ctx.state!=='running' || !this.enabled) return;   // 必须 running 才触发
    const ac=this.ctx, t0=ac.currentTime;
    if(mode==='normal'){
      // sine 520Hz + LFO 6Hz(±30Hz)；3 个 0.25s 脉冲(0→0.3→0)，间隔 0.1s；余音淡出，总 ≥3s
      const osc=ac.createOscillator(), g=ac.createGain();
      const lfo=ac.createOscillator(), lg=ac.createGain();
      osc.type='sine'; osc.frequency.setValueAtTime(520,t0);
      lfo.type='sine'; lfo.frequency.setValueAtTime(6,t0); lg.gain.setValueAtTime(30,t0);
      lfo.connect(lg); lg.connect(osc.frequency);
      g.gain.setValueAtTime(0.0001,t0);
      let tp=t0;
      for(let i=0;i<3;i++){ g.gain.setValueAtTime(0.0001,tp); g.gain.linearRampToValueAtTime(0.3,tp+0.06); g.gain.linearRampToValueAtTime(0.0001,tp+0.25); tp+=0.35; }
      g.gain.linearRampToValueAtTime(0.06,tp+0.1); g.gain.exponentialRampToValueAtTime(0.0001,t0+3.1); // 余音淡出
      osc.connect(g); g.connect(this.sg);
      osc.start(t0); lfo.start(t0); osc.stop(t0+3.2); lfo.stop(t0+3.2);
    } else if(mode==='punk'){
      // sawtooth 380Hz + WaveShaper(200)；频率跳跃 380→620→280→500 各 0.3s(共1.2s)；后接 1.8s 余音，总 ≥3s
      const osc=ac.createOscillator(), ws=ac.createWaveShaper(), g=ac.createGain();
      ws.curve=this.distCurve(200); ws.oversample='2x';
      osc.type='sawtooth';
      const jumps=[380,620,280,500]; jumps.forEach((f,i)=>osc.frequency.setValueAtTime(f, t0+i*0.3));
      osc.frequency.setValueAtTime(500, t0+1.2);
      g.gain.setValueAtTime(0.0001,t0); g.gain.linearRampToValueAtTime(0.24,t0+0.05);
      g.gain.setValueAtTime(0.24,t0+1.2); g.gain.exponentialRampToValueAtTime(0.0001,t0+3.0); // 1.8s 余音渐降
      osc.connect(ws); ws.connect(g); g.connect(this.sg);
      osc.start(t0); osc.stop(t0+3.1);
    } else { // ghost
      // sine 340Hz + DelayNode(0.45s, feedback 0.35, 约3次回响)；淡入1s/持续1s/淡出1s，总 ≥3s
      const osc=ac.createOscillator(), g=ac.createGain();
      const d=ac.createDelay(1.0), fb=ac.createGain(), wet=ac.createGain();
      d.delayTime.setValueAtTime(0.45,t0); fb.gain.setValueAtTime(0.35,t0); wet.gain.setValueAtTime(0.7,t0);
      osc.type='sine'; osc.frequency.setValueAtTime(340,t0);
      osc.frequency.linearRampToValueAtTime(300,t0+3.0);
      g.gain.setValueAtTime(0.0001,t0); g.gain.linearRampToValueAtTime(0.22,t0+1.0);
      g.gain.setValueAtTime(0.22,t0+2.0); g.gain.linearRampToValueAtTime(0.0001,t0+3.0);
      osc.connect(g); g.connect(this.sg); g.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(this.sg);
      osc.start(t0); osc.stop(t0+3.1);
    }
  },
  // 环境音：normal 轻微宫廷弦乐氛围；punk 失真电吉他风噪音；ghost 空灵哼唱
  opheliaAmbient(mode){ this.safe(function(){
    if(mode==='punk'){ // 低沉失真噪音铺底 3s
      this.noiseBed(3.2,.05,'bandpass',420,2.5);
      this.voiceOsc({type:'sawtooth', f:[110,104], dur:3.2, vol:.06, atk:1.0, rel:1.2, dist:12});
    } else if(mode==='ghost'){ // 空灵哼唱：正弦 350Hz 极低音量缓慢颤动
      this.voiceOsc({type:'sine', f:350, dur:3.4, vol:.06, atk:1.2, rel:1.4, vib:{rate:2.5,depth:6}});
      this.voiceOsc({type:'sine', f:525, dur:3.4, vol:.03, atk:1.4, rel:1.4});
    } else { // normal 轻微宫廷弦乐氛围（低音量持续和声）
      this.voiceOsc({type:'triangle', f:294, dur:3.2, vol:.05, atk:1.1, rel:1.3});
      this.voiceOsc({type:'sine', f:392, dur:3.2, vol:.045, atk:1.2, rel:1.3});
    }
  }); },
  // 奥菲莉亚笑声/疯笑防重叠：返回是否成功触发（占用 dur 秒）
  _voiceBusyUntil:0,
  now(){ return this.ctx?this.ctx.currentTime:0; },
  tryLaugh(mode,dur){ if(!this.ctx || this.ctx.state!=='running' || !this.enabled) return false;
    const t=this.ctx.currentTime; if(t<this._voiceBusyUntil) return false;
    this._voiceBusyUntil=t+(dur||3.2); this.opheliaLaugh(mode); return true;
  },
  safe(fn){ try { this.unlock(); if(this.enabled && typeof fn==='function') fn.call(this); } catch {} },
  characterCue(kind){ this.safe(function(){
    const cues={
      hamlet:()=>{ [262,330,392].forEach((f,i)=>this.blip(f,.18,'sawtooth',.18,i*.08)); },
      ghost:()=>this.voiceGhost(),                 // 老哈姆雷特鬼魂 ≥3s
      ophelia:()=>this.opheliaLaugh('normal'),      // 正常奥菲莉亚出场：轻柔笑声
      punkOphelia:()=>this.opheliaLaugh('punk'),    // 朋克奥菲莉亚出场：失真疯笑
      ghostOphelia:()=>this.opheliaLaugh('ghost'),  // 亡魂奥菲莉亚出场：空灵疯笑
      clown:()=>this.voicePolonius(),               // 波洛涅斯（小丑）≥3s
      polonius:()=>this.voicePolonius(),
      laertes:()=>this.voiceLaertes(),              // 雷欧提斯 ≥3s
      claudius:()=>this.voiceClaudius(),            // 克劳迪奥 ≥3s
      horatio:()=>this.voiceHoratio(),              // 霍拉旭 ≥3s
      assassin:()=>this.voiceAssassin()             // 英格兰刺客队长 ≥3s
    };
    (cues[kind]||(()=>{}))();
  }); },
  battleCue(kind){ this.safe(function(){
    const cues={
      hamletAttack:()=>{ this.noise(.08,.12,0,1800); this.blip(980,.08,'triangle',.18,0,520); },
      ghostHit:()=>{ this.noise(.28,.16,0,520); this.blip(160,.32,'sine',.18,0,60); },
      punkLaugh:()=>{ this.punkGlitch(); this.blip(740,.2,'sawtooth',.16,0,160); this.blip(930,.18,'sawtooth',.12,.08,180); },
      ghostOpheliaAttack:()=>{ this.noise(.28,.1,0,220); [523,659,880].forEach((f,i)=>this.blip(f,.18,'sine',.13,i*.06)); },
      ghostOpheliaVanish:()=>{ this.noise(1.3,.12,0,180); [392,330,262,196].forEach((f,i)=>this.blip(f,.55,'triangle',.16,i*.18)); },
      clownHit:()=>{ this.bellHit(1047,0,.12); this.noise(.12,.14,0,900); },
      laertesStrike:()=>{ this.noise(.06,.12,0,2600); this.blip(1600,.08,'triangle',.14,0,700); },
      claudiusHeavy:()=>{ this.noise(.22,.18,0,180); this.blip(88,.36,'sawtooth',.28,0,55); }
    };
    (cues[kind]||(()=>{}))();
  }); },
  // ---- Boss 待机音（≥3s 标志性音，各 Boss 独特）----
  bossIdle(kind){ this.safe(function(){
    if(kind==='ghostking'){ this.voiceGhost(); }                       // 低沉哼鸣回响
    else if(kind==='clown'){ this.voicePolonius(); }                   // 夸张哈哈笑
    else if(kind==='assassin'){                                        // 金属铠甲碰撞
      [0,0.14,0.3,0.55,0.9,1.3].forEach((w,i)=>{ this.noise(.08,.13,w,2600); this.blip(240-i*14,.09,'square',.10,w,110); });
      this.noiseBed(1.6,.05,'bandpass',1800,3,0);
    }
    else if(kind==='laertes'){                                         // 毒剑嗡嗡（低频颤动）
      this.voiceOsc({type:'sawtooth', f:210, dur:3.0, vol:.10, atk:.5, rel:1.1, vib:{rate:22,depth:16}, dist:6});
      this.voiceOsc({type:'sawtooth', f:315, dur:3.0, vol:.05, atk:.6, rel:1.1, vib:{rate:22,depth:10}});
    }
    else if(kind==='claudius'){                                        // 威压深呼吸（吸-呼）
      this.noiseBed(1.4,.12,'lowpass',300,2,0);
      this.noiseBed(1.6,.14,'lowpass',200,2,1.5);
      this.voiceOsc({type:'sine', f:[70,55], dur:3.2, vol:.10, atk:1.2, rel:1.4});
    }
  }); },
  // ---- Boss 移动音（按步频触发；鬼魂无脚步改低频风声）----
  bossMove(kind){ this.safe(function(){
    if(kind==='ghostking'){ this.noise(.16,.05,0,240); this.voiceOsc({type:'sine', f:[80,60], dur:.24, vol:.05, atk:.02, rel:.16}); }
    else if(kind==='clown'){ this.blip(200,.08,'square',.10,0,120); this.noise(.05,.06,0,1400); }
    else if(kind==='assassin'){ this.noise(.06,.10,0,1800); this.blip(150,.08,'square',.10,0,90); }
    else if(kind==='laertes'){ this.noise(.05,.07,0,1600); this.blip(240,.06,'triangle',.08,0,160); }
    else if(kind==='claudius'){ this.noise(.07,.10,0,500); this.blip(90,.12,'sawtooth',.12,0,55); }
    else { this.noise(.05,.06,0,1500); }
  }); },
  // ---- Boss 攻击挥击音 ----
  bossAttack(kind){ this.safe(function(){
    this.swing();
    if(kind==='claudius') this.blip(120,.14,'sawtooth',.14,0,70);
    else if(kind==='laertes') this.blip(1400,.10,'triangle',.12,0,600);
    else if(kind==='ghostking') this.blip(180,.14,'sine',.12,0,90);
    else if(kind==='assassin') this.noise(.06,.10,0,2200);
    else if(kind==='clown') this.blip(500,.10,'square',.12,0,300);
  }); },
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
  // ===== 层一：真实管弦乐铺底（CC0 素材）解码与循环播放 =====
  _b64ToBuf(dataUri){
    const b64 = dataUri.indexOf(',')>=0 ? dataUri.slice(dataUri.indexOf(',')+1) : dataUri;
    const bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for(let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  },
  // 解码指定素材为 AudioBuffer（带缓存/去重），返回 Promise（失败 resolve(null) → 退化为纯合成兜底）
  loadOrch(name){
    if(this.orchBuf[name]) return Promise.resolve(this.orchBuf[name]);
    const store = (typeof window!=='undefined' && window.__ORCH_BGM__) || null;
    const src = store && store[name];
    if(!src || !this.ctx) return Promise.resolve(null);
    if(this.orchLoading[name]) return this.orchLoading[name];
    const p = new Promise(res=>{
      try {
        const buf = this._b64ToBuf(src);
        const ret = this.ctx.decodeAudioData(buf, ab=>{ this.orchBuf[name]=ab; res(ab); }, ()=>res(null));
        if(ret && typeof ret.then==='function') ret.then(ab=>{ this.orchBuf[name]=ab; res(ab); }).catch(()=>res(null));
      } catch { res(null); }
    });
    this.orchLoading[name] = p;
    return p;
  },
  startOrchBed(name,vol){
    if(!this.ctx || !this.enabled) return;
    this.loadOrch(name).then(ab=>{
      if(!ab || this.orchName!==name || !this.enabled) return;   // 素材缺失或已切走则放弃（纯合成层继续运行）
      this.stopOrchBed();
      const s = this.ctx.createBufferSource(); s.buffer = ab; s.loop = true;
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol||0.5), t+1.4);   // 平滑淡入，禁止硬切
      s.connect(g); g.connect(this.master);
      s.start(); this.orchSrc = s; this.orchBedGain = g;
    });
  },
  setOrchVol(v){
    if(!this.orchBedGain || !this.ctx) return;
    const t = this.ctx.currentTime, g = this.orchBedGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, v), t+0.6);                 // Boss 阶段音量平滑递增
  },
  stopOrchBed(){
    if(!this.orchSrc) return;
    try {
      const s = this.orchSrc, g = this.orchBedGain, t = this.ctx.currentTime;
      if(g){ g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001,g.gain.value),t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.4); }
      setTimeout(()=>{ try{ s.stop(); }catch{} }, 460);
    } catch {}
    this.orchSrc = null; this.orchBedGain = null;
  },
  // 根据当前曲目与强度，启动/切换/调音量/停止真实管弦乐铺底（hero/imperial 专用）
  _updateOrchBed(name){
    const orchName = (name==='hero'||name==='imperial') ? name : null;
    if(!this.ctx || !this.enabled){ this.orchName = orchName; return; }
    if(orchName){
      const bedVol = Math.min(0.72, 0.30 + 0.24*Math.min(1.8, this.intensity));  // 随 intensity(Boss阶段) 0.30→~0.72
      if(this.orchName!==orchName){ this.orchName = orchName; this.stopOrchBed(); this.startOrchBed(orchName, bedVol); }
      else if(this.orchSrc){ this.setOrchVol(bedVol); }
      else { this.startOrchBed(orchName, bedVol); }
    } else if(this.orchName){
      this.orchName = null; this.stopOrchBed();
    }
  },
  setMusic(name,intensity){
    this.intensity = intensity||1;
    this._updateOrchBed(name);                                                  // 层一铺底与合成层并行叠加
    if(this.cur===name && this.timer){ return; }
    this.cur=name; this.step=0;
    const M=MUSIC[name]||MUSIC.castle;
    this.custom=!!M.custom;
    if(this.custom){
      // 自定义平滑合成路径（最终 Boss 战 hero/imperial 专用；其它 BGM 不受影响）
      this.custMusic=M; this.custSecIdx=0;
      if(!this.ctx||!this.enabled) return;
      this.custNextT=this.ctx.currentTime+.08;
      if(this.timer) clearInterval(this.timer);
      this.timer=setInterval(()=>this.sched(),40);
      return;
    }
    this.seq=M.seq; this.bass=M.bass; this.perc=M.perc; this.tempo=M.tempo;
    this.wave=M.wave; this.bassWave=M.bassWave||'triangle';
    this.water=!!M.water; this.bell=!!M.bell; this.organ=!!M.organ; this.choir=!!M.choir; this.brass=!!M.brass;
    this.harm=M.harm||null; this.harmWave=M.harmWave||'triangle'; this.timpani=!!M.timpani;
    if(!this.ctx||!this.enabled) return;
    this.nextT=this.ctx.currentTime+.06;
    if(this.timer) clearInterval(this.timer);
    this.timer=setInterval(()=>this.sched(),25);
  },
  boostIntensity(v){ this.intensity=v; if(this.orchName) this._updateOrchBed(this.cur); },
  sched(){
    if(!this.ctx||!this.enabled) return;
    if(this.custom){ this._schedCustom(); return; }
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
        if(this.harm){ const hn=this.harm[i%this.harm.length]; if(hn){ const ho=this.ctx.createOscillator(), hg=this.ctx.createGain(); ho.type=this.harmWave; ho.frequency.setValueAtTime(hn,this.nextT); hg.gain.setValueAtTime(.0001,this.nextT); hg.gain.exponentialRampToValueAtTime(.30*inten,this.nextT+.02); hg.gain.exponentialRampToValueAtTime(.0001,this.nextT+dur*.85); ho.connect(hg); hg.connect(this.mg); ho.start(this.nextT); ho.stop(this.nextT+dur); } }
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
      if(this.perc && this.perc[i%this.perc.length]){ this.noise(.05,.18*inten,this.nextT-this.ctx.currentTime,1600); if(this.timpani){ const to=this.ctx.createOscillator(), tg=this.ctx.createGain(); to.type='sine'; to.frequency.setValueAtTime(130,this.nextT); to.frequency.exponentialRampToValueAtTime(52,this.nextT+.18); tg.gain.setValueAtTime(.0001,this.nextT); tg.gain.exponentialRampToValueAtTime(.55*inten,this.nextT+.008); tg.gain.exponentialRampToValueAtTime(.0001,this.nextT+.34); to.connect(tg); tg.connect(this.mg); to.start(this.nextT); to.stop(this.nextT+.36); } }
      if(this.bell && i%16===0) this.bellHit(196,this.nextT-this.ctx.currentTime);
      if(this.organ && i%8===0) this.bellHit(98,this.nextT-this.ctx.currentTime,.10);
      if(this.water && Math.random()<.22) this.noise(.18,.05,this.nextT-this.ctx.currentTime,300);
      this.nextT+=dur; this.step++;
    }
  },
  // ===== 自定义平滑 BGM 调度（最终 Boss 战 hero/imperial 专用）=====
  // 按段落增量调度：每次仅排入即将开始的一个段落（约 0.8s 前瞻），
  // 段落之间靠 arrangement 取模无缝循环；intensity 每段实时读取（跟随 Boss 阶段）。
  _schedCustom(){
    const M=this.custMusic; if(!M||!M.arrangement) return;
    const look=0.8;
    while(this.custNextT < this.ctx.currentTime + look){
      const arr=M.arrangement, name=arr[this.custSecIdx % arr.length];
      try { M.renderSection(this, name, this.custNextT, this.intensity); } catch {}
      this.custNextT += (M.sectionBeats[name]||16) * M.beat;
      this.custSecIdx++;
    }
  },
  // 平滑单音：绝对时间 t 起音，独立 osc+gain（+可选滤波），指数淡入淡出，可选线性滑音。
  // 频率用 setValueAtTime 锚定、滑音用 linearRampToValueAtTime；增益 setValueAtTime(极小)→exp 起音→exp 收音(0.0001)，绝不硬切。
  musNote(o){
    if(!this.ctx||!this.enabled) return;
    const t=o.t, dur=o.dur;
    const peak=Math.max(0.0002, o.vol||0.2);
    const atk=Math.min(o.atk||0.03, dur*0.4);
    const rel=Math.min(o.rel||dur*0.5, dur*0.8);
    const osc=this.ctx.createOscillator(), g=this.ctx.createGain();
    osc.type=o.type||'sine';
    osc.frequency.setValueAtTime(o.f, t);                                   // 起始频率锚定
    if(o.to && o.to!==o.f) osc.frequency.linearRampToValueAtTime(o.to, t+dur*(o.glide||1)); // 滑音平滑过渡
    g.gain.setValueAtTime(0.0001, t);                                       // 从极小值起（exp 不能从 0）
    g.gain.exponentialRampToValueAtTime(peak, t+atk);                       // 平滑淡入
    const relStart=Math.max(t+atk+0.005, t+dur-rel);
    g.gain.setValueAtTime(peak, relStart);                                  // 维持峰值
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);                     // 平滑收音，禁止硬切
    if(o.filter){
      const bf=this.ctx.createBiquadFilter();
      bf.type=o.filter.type||'lowpass';
      bf.frequency.setValueAtTime(o.filter.freq||900, t);
      if(o.filter.q) bf.Q.setValueAtTime(o.filter.q, t);
      osc.connect(bf); bf.connect(g);
    } else { osc.connect(g); }
    g.connect(o.dest||this.mg);
    osc.start(t); osc.stop(t+dur+0.06);
    return g;
  },
  // 平滑噪声脉冲（军鼓/击打），绝对时间；同样 exp 淡入淡出。
  musNoise(t,dur,vol,ftype,freq,q){
    if(!this.ctx||!this.enabled) return;
    const n=Math.max(1,Math.floor(this.ctx.sampleRate*dur));
    const b=this.ctx.createBuffer(1,n,this.ctx.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    const s=this.ctx.createBufferSource(); s.buffer=b;
    const f=this.ctx.createBiquadFilter(); f.type=ftype||'lowpass'; f.frequency.setValueAtTime(freq||400,t); if(q) f.Q.setValueAtTime(q,t);
    const g=this.ctx.createGain();
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002,vol),t+0.006);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    s.connect(f); f.connect(g); g.connect(this.mg); s.start(t); s.stop(t+dur+0.03);
  },
  // 定音鼓：低频脉冲 sine（音高快速下滑）+ 短 decay + 低通噪声击打。
  musTimpani(t,freq,vol){
    if(!this.ctx||!this.enabled) return;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type='sine'; o.frequency.setValueAtTime(freq,t); o.frequency.exponentialRampToValueAtTime(Math.max(20,freq*0.4),t+0.18);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002,vol),t+0.006); g.gain.exponentialRampToValueAtTime(0.0001,t+0.34);
    o.connect(g); g.connect(this.mg); o.start(t); o.stop(t+0.36);
    this.musNoise(t,0.11,vol*0.4,'lowpass',200,1);
  },
  stopMusic(){ if(this.timer){ clearInterval(this.timer); this.timer=null; } this.cur=null; this.custom=false; this.custMusic=null; this.stopOrchBed(); this.orchName=null; if(this._monoScore) this.monologueScoreStop(); },
  toggle(){ this.enabled=!this.enabled; if(!this.enabled) this.stopMusic(); return this.enabled; }
};
(function hardenSoundAPI(){
  Object.keys(Sound).forEach(k=>{
    if(typeof Sound[k] !== 'function' || k==='safe') return;
    const fn=Sound[k];
    Sound[k]=function(...args){ try { return fn.apply(this,args); } catch {} };
  });
})();

// ---- 终章双结局 BGM 生成器（长序列使一轮循环 ≥30s）----
// tuples: [freq, dur, bassFreq]；freq/bassFreq 为 0 表示休止
function _seqFromTuples(tuples){
  const seq=[], bass=[];
  for(const tp of tuples){ const f=tp[0], d=tp[1]||1, bf=tp[2]||0;
    seq.push(d!==1?{f,d}:{f}); bass.push(bf); }
  return { seq, bass };
}
// 三声部行：[主旋律f, 时值d, 低音bassF, 和声harmF]，0 表示该声部休止
function _seq3(rows){
  const seq=[], bass=[], harm=[];
  for(const r of rows){ const f=r[0], d=r[1]||1, bf=r[2]||0, hf=r[3]||0;
    seq.push(d!==1?{f,d}:{f}); bass.push(bf); harm.push(hf); }
  return { seq, bass, harm };
}
// ============================================================================
// hero（生还线）：英雄交响 —— 纯 Web Audio 平滑合成，段落 A(弦乐铺垫)→B(铜管三连音主题)
// →C(全奏冲锋)→A'(变奏)→B→C→A→B→C 循环。BPM≈140（每拍≈0.43s），单轮 ≈61.7s（≥60s）。
// 每音独立 osc+gain，setValueAtTime 锚定频率、增益 exp 淡入/淡出（收音目标 0.0001），彻底消除硬切卡顿。
// ============================================================================
function _buildHeroMusic(){
  const beat=60/140;                                   // ≈0.4286s
  const arrangement=['A','B','C','A2','B','C','A','B','C'];
  const sectionBeats={A:16,B:16,C:16,A2:16};
  const loopDur=arrangement.reduce((s,n)=>s+sectionBeats[n],0)*beat;   // ≈61.7s

  // 段落 A 弦乐铺垫：正弦波和声（主音 440 + 泛音 880 + 528Hz），4 拍一和弦，低音量渐入
  const PAD=[ [440,880,528], [349,698,440], [392,784,494], [330,659,392] ];
  // 段落 B/C 铜管主旋律（16 拍，每拍一音，作三连音强弱弱发声），中高音区
  const MEL=[N.A4,N.C5,N.E5,N.A5, N.G5,N.E5,N.C5,N.D5, N.F5,N.A5,N.G5,N.E5, N.D5,N.C5,N.B4,N.A4];
  const BASSLINE=[N.A2,N.A2,N.A2,N.A2, N.E2,N.E2,N.E2,N.C3, N.F2,N.F2,N.C3,N.C3, N.G2,N.G2,N.E2,N.A2];

  function pad(S,t0,inten,vol){
    for(let c=0;c<4;c++){
      const t=t0+c*4*beat, chord=PAD[c];
      chord.forEach((f,vi)=>S.musNote({t,f,dur:4.35*beat,type:'sine',                 // 相邻和弦交叠 0.35 拍平滑衔接
        vol:(vol||0.09)*inten*(vi===2?0.7:1), atk:0.6, rel:2.2*beat}));               // 长 attack 渐入
    }
  }
  // 铜管三连音：sawtooth（主）+ triangle（叠加）模拟铜管；每拍 3 连音，首拍强、后两弱（强弱弱）
  function brassTriplets(S,t0,inten,volScale,lead){
    const sub=beat/3;
    for(let b=0;b<16;b++){
      const f=MEL[b], t=t0+b*beat;
      for(let k=0;k<3;k++){
        const tt=t+k*sub, v=(k===0?0.15:0.085)*inten*(volScale||1);
        S.musNote({t:tt,f,dur:sub*1.15,type:'sawtooth',vol:v,atk:0.012,rel:sub*0.6});  // 略微交叠(1.15)消除颗粒断裂
        S.musNote({t:tt,f,dur:sub*1.15,type:'triangle',vol:v*0.6,atk:0.012,rel:sub*0.6});
        if(lead&&k===0) S.musNote({t:tt,f:f*2,dur:sub*1.1,type:'square',vol:0.06*inten,atk:0.01,rel:sub*0.5}); // 小号冲锋（方波高频）
      }
    }
  }
  function bassLine(S,t0,inten,volScale){
    for(let b=0;b<16;b++) S.musNote({t:t0+b*beat,f:BASSLINE[b],dur:beat*0.98,type:'square',
      vol:0.18*inten*(volScale||1),atk:0.02,rel:beat*0.5});
  }
  // ===== 层二：多声部合成（8-12 独立音轨叠加，不改现有节点）=====
  // 弦乐铺底和弦（4 拍一和弦，每和弦音双振荡器微 detune 制造合唱式厚度）——弦乐铺底 + 和声填充
  const STR=[ [N.A2,N.E3,N.A3], [N.F2,N.C3,N.F3], [N.G2,N.D3,N.G3], [N.E2,N.B2,N.E3] ];
  function stringBed(S,t0,inten,vol){
    for(let c=0;c<4;c++){ const t=t0+c*4*beat, chord=STR[c];
      chord.forEach(f=>{
        S.musNote({t,f,dur:4.4*beat,type:'sawtooth',vol:(vol||0.05)*inten,atk:0.7,rel:2.4*beat,filter:{type:'lowpass',freq:1200,q:0.6}});
        S.musNote({t,f:f*1.003,dur:4.4*beat,type:'triangle',vol:(vol||0.05)*inten*0.7,atk:0.8,rel:2.4*beat}); // +0.3% detune 合唱厚度
      });
    }
  }
  // 低音线：根音低八度 sine，支撑重量感
  function subBass(S,t0,inten,vol){
    for(let b=0;b<16;b++){ const f=BASSLINE[b]*0.5; S.musNote({t:t0+b*beat,f,dur:beat*0.97,type:'sine',vol:(vol||0.16)*inten,atk:0.03,rel:beat*0.5}); }
  }
  // ===== 层三：和声高层 —— 主旋律上方大三度(*5/4)+纯五度(*3/2)，正弦+微 detune 增丰满 =====
  function harmonyVoices(S,t0,inten,volScale){
    for(let b=0;b<16;b++){ const f=MEL[b], t=t0+b*beat;
      S.musNote({t,f:f*1.25,       dur:beat*0.95,type:'sine',vol:0.075*inten*(volScale||1),atk:0.02,rel:beat*0.5}); // 大三度
      S.musNote({t,f:f*1.25*1.004, dur:beat*0.95,type:'sine',vol:0.045*inten*(volScale||1),atk:0.02,rel:beat*0.5}); // 大三度 detune
      S.musNote({t,f:f*1.5,        dur:beat*0.95,type:'sine',vol:0.06*inten*(volScale||1), atk:0.02,rel:beat*0.5}); // 纯五度
    }
  }
  // 副旋律：三角波对句（旋律的呼应声部）
  const COUNTER=[N.E4,N.G4,N.A4,N.C5, N.B4,N.G4,N.E4,N.F4, N.A4,N.C5,N.E4,N.G4, N.F4,N.E4,N.D4,N.E4];
  function counterMel(S,t0,inten,vol){
    for(let b=0;b<16;b++) S.musNote({t:t0+(b+0.5)*beat,f:COUNTER[b],dur:beat*0.7,type:'triangle',vol:(vol||0.06)*inten,atk:0.02,rel:beat*0.4});
  }
  // 泛音层：主旋律高两个八度的稀疏 sine 闪光
  function overtones(S,t0,inten){
    for(let b=0;b<16;b+=2) S.musNote({t:t0+b*beat,f:MEL[b]*4,dur:beat*1.4,type:'sine',vol:0.03*inten,atk:0.05,rel:beat*0.9});
  }
  // 打击乐补充：军鼓反拍 + 镲片长吊音
  function extraPerc(S,t0,inten){
    for(let b=0;b<16;b++){ if(b%4===2) S.musNoise(t0+b*beat,0.16,0.09*inten,'highpass',2400,0.8); } // 军鼓反拍
    S.musNoise(t0,1.2,0.05*inten,'highpass',6000,0.5);   // 镲片起段长吊音
    S.musNoise(t0+8*beat,1.2,0.05*inten,'highpass',6000,0.5);
  }
  // 层三 合唱感：C 段结尾多正弦微 detune 叠加模拟人声"啊"合唱
  function choirPad(S,t0,inten){
    const chord=[N.A4,N.C5,N.E5,N.A5];
    chord.forEach(f=>{ [1,1.004,0.996].forEach((d,i)=>
      S.musNote({t:t0,f:f*d,dur:16*beat*0.98,type:'sine',vol:(i===0?0.06:0.035)*inten,atk:1.4,rel:4*beat,filter:{type:'lowpass',freq:2200,q:0.4}})); });
  }
  return {
    custom:true, beat, arrangement, sectionBeats, loopDur,
    renderSection(S,name,t0,inten){
      if(name==='A'){ pad(S,t0,inten,0.09); stringBed(S,t0,inten,0.05); subBass(S,t0,inten,0.14); overtones(S,t0,inten*0.6); }
      else if(name==='A2'){                                                            // A' 变奏：pad + 三角波琶音对句
        pad(S,t0,inten,0.10); stringBed(S,t0,inten,0.055); subBass(S,t0,inten,0.15); counterMel(S,t0,inten,0.05);
        const arp=[N.A4,N.C5,N.E5,N.C5, N.G4,N.B4,N.D5,N.B4, N.F4,N.A4,N.C5,N.A4, N.E4,N.G4,N.B4,N.G4];
        for(let b=0;b<16;b++) S.musNote({t:t0+b*beat,f:arp[b],dur:beat*0.9,type:'triangle',vol:0.075*inten,atk:0.02,rel:beat*0.5});
      }
      else if(name==='B'){                                                             // B：主题 + 层二铺底 + 层三和声
        brassTriplets(S,t0,inten,1,false); bassLine(S,t0,inten,1); pad(S,t0,inten,0.05);
        stringBed(S,t0,inten,0.06); subBass(S,t0,inten,0.16); harmonyVoices(S,t0,inten,1); counterMel(S,t0,inten,0.06); extraPerc(S,t0,inten*0.8);
      }
      else if(name==='C'){                                                             // 全奏冲锋：铜管+方波小号+低音+定音鼓每拍强击 + 全层叠加 + 合唱高层
        brassTriplets(S,t0,inten,1.15,true); bassLine(S,t0,inten,1.1); pad(S,t0,inten,0.06);
        for(let b=0;b<16;b++) S.musTimpani(t0+b*beat, b%4===0?98:110, (b%4===0?0.5:0.32)*inten);
        stringBed(S,t0,inten,0.07); subBass(S,t0,inten,0.18); harmonyVoices(S,t0,inten,1.2); counterMel(S,t0,inten,0.07);
        overtones(S,t0,inten); extraPerc(S,t0,inten); choirPad(S,t0,inten);           // 生还线结尾合唱感
      }
    }
  };
}
// ============================================================================
// imperial（溺死线）：帝国进行曲风 —— 纯 Web Audio 平滑合成，序(低音大提琴)→A(铜管附点主题,
// 低通滤波)→A→B(弦乐反主题+竖琴)→A强奏→B→A→序 循环。BPM≈100（每拍 0.6s），单轮 ≈67.2s（≥60s）。
// 全部音符 setValueAtTime 锚定 + 长音 linearRampToValueAtTime 滑音，增益 exp 淡入淡出，无硬切。
// ============================================================================
function _buildImperialMusic(){
  const beat=60/100;                                   // 0.6s
  const arrangement=['I','A','A','B','As','B','A','I'];
  const sectionBeats={I:8,A:16,B:16,As:16};
  const loopDur=arrangement.reduce((s,n)=>s+sectionBeats[n],0)*beat;   // 67.2s

  // A 铜管附点动机（8 拍 motif，×2=16 拍）：长短短（0.75/0.25 附点）模拟 Imperial March 节奏型
  const MOTIF=[[N.A3,1],[N.A3,1],[N.A3,1],[N.F3,0.75],[N.C4,0.25],[N.A3,1.5],[N.F3,0.5],[N.C4,1],[N.A3,1]];
  // B 弦乐反主题：中音区哀鸣下行旋律
  const LAMENT=[[N.E5,2],[N.D5,1],[N.C5,1],[N.B4,2],[N.A4,2],[N.C5,1],[N.B4,1],[N.A4,2],[N.G4,2],[N.A4,1],[N.E4,1]];
  const HARP=[N.A4,N.C5,N.E5,N.A5];

  // 铜管动机一遍（strong=强奏：加高八度 + 定音鼓/军鼓）；锯齿波经低通滤波器截高频，音色厚重
  function motifOnce(S,t0,inten,volScale,strong){
    let bt=0;
    for(const [f,d] of MOTIF){
      const t=t0+bt*beat, dur=d*beat;
      S.musNote({t,f,dur:dur*0.98,type:'sawtooth',vol:0.16*inten*(volScale||1),atk:0.02,rel:dur*0.4,filter:{type:'lowpass',freq:strong?1100:850,q:0.7}});
      S.musNote({t,f:f*2/3,dur:dur*0.98,type:'sawtooth',vol:0.09*inten*(volScale||1),atk:0.02,rel:dur*0.4,filter:{type:'lowpass',freq:700,q:0.7}}); // 小调下方五度和声
      if(strong) S.musNote({t,f:f*2,dur:dur*0.9,type:'sawtooth',vol:0.07*inten,atk:0.02,rel:dur*0.4,filter:{type:'lowpass',freq:1600}});
      bt+=d;
    }
    const bassNotes=[N.A2,N.A2,N.F2,N.C3];
    for(let k=0;k<4;k++) S.musNote({t:t0+k*2*beat,f:bassNotes[k],dur:2*beat*0.96,type:'sawtooth',vol:0.2*inten*(volScale||1),atk:0.03,rel:beat*0.6,filter:{type:'lowpass',freq:400}});
    if(strong) for(let b=0;b<8;b++){ S.musTimpani(t0+b*beat,b%2===0?73:98,(b%2===0?0.45:0.3)*inten); S.musNoise(t0+b*beat,0.1,0.12*inten,'lowpass',2000,1); }
  }
  // ===== 层二：多声部合成（低沉小调铺底，8-12 轨叠加，不改现有节点）=====
  const IMPSTR=[ [N.A2,N.C3,N.E3], [N.A2,N.C3,N.E3], [N.F2,N.A2,N.C3], [N.C3,N.E3,N.G3] ]; // 小调和弦：Am Am F C
  // 弦乐铺底：低通锯齿+三角微 detune 长音，阴森厚重（弦乐铺底 + 和声填充）
  function darkStringBed(S,t0,inten,vol){
    for(let c=0;c<4;c++){ const t=t0+c*4*beat, chord=IMPSTR[c];
      chord.forEach(f=>{
        S.musNote({t,f,dur:4.4*beat,type:'sawtooth',vol:(vol||0.05)*inten,atk:0.9,rel:2.4*beat,filter:{type:'lowpass',freq:600,q:0.7}});
        S.musNote({t,f:f*0.997,dur:4.4*beat,type:'triangle',vol:(vol||0.05)*inten*0.6,atk:1.0,rel:2.4*beat,filter:{type:'lowpass',freq:500,q:0.6}}); // -0.3% detune
      });
    }
  }
  // 低音线：动机根音再低八度 sine 撑底
  function subBassImp(S,t0,inten,vol){
    const roots=[N.A2,N.A2,N.F2,N.C3];
    for(let k=0;k<4;k++) S.musNote({t:t0+k*4*beat,f:roots[k]*0.5,dur:4*beat*0.96,type:'sine',vol:(vol||0.18)*inten,atk:0.2,rel:beat*0.8});
  }
  // 低沉铜管长音铺垫（低通厚重 drone）
  function lowBrassPad(S,t0,inten,vol){
    const roots=[N.A2,N.A2,N.F2,N.C3];
    for(let k=0;k<4;k++) S.musNote({t:t0+k*4*beat,f:roots[k],dur:4*beat*0.94,type:'sawtooth',vol:(vol||0.06)*inten,atk:0.5,rel:beat,filter:{type:'lowpass',freq:520,q:0.8}});
  }
  // ===== 层三：和声高层（小调）—— 动机上方小三度(*6/5)+纯五度(*3/2)，正弦+微 detune =====
  function harmonyMinor(S,t0,inten,volScale){
    let bt=0;
    for(const [f,d] of MOTIF){ const t=t0+bt*beat, dur=d*beat;
      S.musNote({t,f:f*1.2,       dur:dur*0.95,type:'sine',vol:0.055*inten*(volScale||1),atk:0.03,rel:dur*0.4,filter:{type:'lowpass',freq:1400}}); // 小三度
      S.musNote({t,f:f*1.2*0.996, dur:dur*0.95,type:'sine',vol:0.03*inten*(volScale||1), atk:0.03,rel:dur*0.4});                                  // 小三度 detune
      S.musNote({t,f:f*1.5,       dur:dur*0.95,type:'sine',vol:0.045*inten*(volScale||1),atk:0.03,rel:dur*0.4,filter:{type:'lowpass',freq:1600}}); // 纯五度
      bt+=d;
    }
  }
  // 军鼓进行曲节奏（每小节，非强奏段也铺底）+ 低沉大鼓
  function militaryPerc(S,t0,inten){
    for(let b=0;b<16;b++){
      if(b%4===0) S.musNoise(t0+b*beat,0.09,0.10*inten,'highpass',2000,0.9);
      if(b%2===1) S.musNoise(t0+b*beat,0.06,0.05*inten,'highpass',3000,0.8);   // 军鼓弱拍
      if(b%4===0) S.musTimpani(t0+b*beat,55,0.22*inten);                        // 大鼓每小节
    }
  }
  // 冷色泛音（高音区稀疏 sine，营造压抑空旷）
  function coldShimmer(S,t0,inten){
    const hi=[N.E5,N.C5,N.A4,N.E5];
    for(let k=0;k<4;k++) S.musNote({t:t0+k*4*beat,f:hi[k],dur:3*beat,type:'sine',vol:0.028*inten,atk:0.6,rel:1.5*beat,filter:{type:'lowpass',freq:2600}});
  }
  // 低沉铜锣：段落起点的一击（低频簇 + 噪声）
  function gong(S,t0,inten){ S.musTimpani(t0,44,0.34*inten); S.musNoise(t0,0.8,0.08*inten,'lowpass',900,0.6); }
  return {
    custom:true, beat, arrangement, sectionBeats, loopDur,
    renderSection(S,name,t0,inten){
      if(name==='I'){                                                                  // 序：低音大提琴（sine+sawtooth 50–100Hz）缓慢拉奏（长 attack + 滑音）
        S.musNote({t:t0,f:55,to:65,dur:4*beat,type:'sine',vol:0.18*inten,atk:1.0,rel:1.5});
        S.musNote({t:t0,f:55,to:65,dur:4*beat,type:'sawtooth',vol:0.06*inten,atk:1.1,rel:1.5,filter:{type:'lowpass',freq:200}});
        S.musNote({t:t0+4*beat,f:73,to:82,dur:4*beat,type:'sine',vol:0.18*inten,atk:1.0,rel:1.5});
        S.musNote({t:t0+4*beat,f:73,to:82,dur:4*beat,type:'sawtooth',vol:0.06*inten,atk:1.1,rel:1.5,filter:{type:'lowpass',freq:200}});
        gong(S,t0,inten); coldShimmer(S,t0,inten*0.7);
      }
      else if(name==='A'){                                                             // A：动机 + 层二铺底 + 层三小调和声 + 进行曲军鼓
        motifOnce(S,t0,inten,1,false); motifOnce(S,t0+8*beat,inten,1,false);
        darkStringBed(S,t0,inten,0.055); subBassImp(S,t0,inten,0.17); lowBrassPad(S,t0,inten,0.055);
        harmonyMinor(S,t0,inten,1); harmonyMinor(S,t0+8*beat,inten,1); militaryPerc(S,t0,inten);
      }
      else if(name==='As'){                                                            // A 强奏：全层压迫 + 冷色泛音 + 铜锣
        motifOnce(S,t0,inten,1.2,true); motifOnce(S,t0+8*beat,inten,1.2,true);
        darkStringBed(S,t0,inten,0.07); subBassImp(S,t0,inten,0.2); lowBrassPad(S,t0,inten,0.07);
        harmonyMinor(S,t0,inten,1.2); harmonyMinor(S,t0+8*beat,inten,1.2);
        militaryPerc(S,t0,inten); coldShimmer(S,t0,inten); gong(S,t0,inten);
      }
      else if(name==='B'){                                                             // 弦乐反主题：正弦哀鸣 + 三角波竖琴点缀
        let bt=0;
        for(const [f,d] of LAMENT){
          const t=t0+bt*beat, dur=d*beat;
          S.musNote({t,f,dur:dur*0.96,type:'sine',vol:0.15*inten,atk:0.08,rel:dur*0.45});
          S.musNote({t,f:f*0.5,dur:dur*0.96,type:'sine',vol:0.06*inten,atk:0.1,rel:dur*0.45}); // 低八度铺底
          S.musNote({t,f:f*1.5,dur:dur*0.96,type:'sine',vol:0.04*inten,atk:0.12,rel:dur*0.45}); // 层三 纯五度和声
          bt+=d;
        }
        for(let b=0;b<16;b++) S.musNote({t:t0+b*beat,f:HARP[b%4],dur:beat*0.5,type:'triangle',vol:0.06*inten,atk:0.01,rel:beat*0.3}); // 竖琴琶音
        const bn=[N.A2,N.F2,N.G2,N.E2];
        for(let k=0;k<4;k++) S.musNote({t:t0+k*4*beat,f:bn[k],dur:4*beat*0.92,type:'sine',vol:0.12*inten,atk:0.1,rel:beat});
        darkStringBed(S,t0,inten,0.045); subBassImp(S,t0,inten,0.14);                  // 层二铺底（弱）
      }
    }
  };
}

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
  // 第五幕 成功路线：英雄交响曲（怪物猎人式恢弘，多声部+定音鼓，单轮≈44s，引子→A→B→A→尾声，见 _buildHeroMusic）
  hero:_buildHeroMusic(),
  // 第五幕 失败路线：帝国进行曲式压迫（低沉铜管、附点节奏、军鼓+大鼓+小调和声，单轮≈43s，见 _buildImperialMusic）
  imperial:_buildImperialMusic(),
  // 第一幕关底 恶灵先王：中世纪宫廷弦乐 + 低沉风琴，渐进紧张
  wraith:{ tempo:.28, wave:'triangle', bassWave:'sine', organ:true, perc:[1,0,0,0,1,0,0,0],
    seq:[{f:N.D4},{f:N.F4},{f:N.A4},{f:N.D5,d:2},{f:N.C5},{f:N.A4},{f:N.F4,d:2},{f:N.E4},{f:N.G4},{f:N.As4},{f:N.A4,d:2},{f:N.F4},{f:N.D4},{f:N.E4,d:2},{f:N.D4},{f:N.A4},{f:N.C5},{f:N.A4}],
    bass:[N.D2,0,N.A2,0,N.F2,0,N.D2,0,N.E2,0,N.A2,0,N.D2,0,N.G2,0,N.A2,0] },
  // 终章中段 雷欧提斯：悲壮弦乐、大提琴主旋律感（与 hero/imperial 明显不同）
  lament:{ tempo:.30, wave:'triangle', bassWave:'sine', choir:true, perc:[1,0,0,0,0,0,1,0],
    seq:[{f:N.A3},{f:N.C4},{f:N.E4},{f:N.D4,d:2},{f:N.C4},{f:N.B3},{f:N.A3,d:2},{f:N.E4},{f:N.G4},{f:N.F4},{f:N.E4,d:2},{f:N.D4},{f:N.C4},{f:N.E4,d:2},{f:N.A3},{f:N.E4},{f:N.D4},{f:N.C4,d:2}],
    bass:[N.A2,0,N.E2,0,N.F2,0,N.A2,0,N.C3,0,N.E2,0,N.F2,0,N.E2,0,N.A2,0] },
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

const SUPABASE_URL = 'https://vxndmttnbjpuawawnwwp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4bmRtdHRuYmpwdWF3YXdud3dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NjM2NTIsImV4cCI6MjEwMTEzOTY1Mn0.IjpjW5UpwhbdXFi__uwzdOKRgdsO89khwSFMg9UON2A';
const PLAYER_UUID_KEY = 'hamlet_player_uuid';
const PLAYER_NICKNAME_KEY = 'hamlet_player_nickname';
const PLAYER_NICKNAME_CONFIRMED_KEY = 'hamlet_nickname_confirmed';
let supabaseClient = null;
let currentPlayer = { id:null, uuid:null, nickname:null, ready:false };

try {
  if(window.supabase && typeof window.supabase.createClient === 'function'){
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch { supabaseClient = null; }

function safeStorageGet(key){ try { return localStorage.getItem(key); } catch{ return null; } }
function safeStorageSet(key, value){ try { localStorage.setItem(key, value); } catch{} }
function makeBrowserUuid(){
  if(window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'hamlet-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
}
function nicknameWidth(text){
  let width=0;
  for(const ch of text){ width += ch.charCodeAt(0)>127 ? 2 : 1; }
  return width;
}
function clampNicknameInput(text){
  let out='', width=0, ascii=0, wide=0;
  for(const ch of String(text||'').trim().replace(/\s+/g, ' ')){
    const isWide = ch.charCodeAt(0)>127;
    const add = isWide ? 2 : 1;
    if(width + add > 20) break;
    if(isWide){ if(wide>=10) break; wide++; }
    else { if(ascii>=15) break; ascii++; }
    out += ch; width += add;
  }
  return out;
}
function normalizeNickname(value){ return clampNicknameInput(value); }
function isValidNickname(value){ return normalizeNickname(value).length>0; }
function isNicknameConfirmed(){ return safeStorageGet(PLAYER_NICKNAME_CONFIRMED_KEY)==='1'; }
function confirmNickname(){ safeStorageSet(PLAYER_NICKNAME_CONFIRMED_KEY, '1'); }
function makeRandomNickname(){ return '无名王子_'+Math.random().toString(36).slice(2,6); }
function getPlayerNickname(){ return currentPlayer.nickname || normalizeNickname(safeStorageGet(PLAYER_NICKNAME_KEY)) || ''; }
function saveNickname(nickname){ safeStorageSet(PLAYER_NICKNAME_KEY, nickname); currentPlayer.nickname=nickname; updateNicknameHud(); }
function syncPlayerProfile(){
  if(!supabaseClient || !currentPlayer.uuid || !currentPlayer.nickname) return Promise.resolve(currentPlayer);
  return supabaseClient.from('players').upsert({ browser_uuid:currentPlayer.uuid, nickname:currentPlayer.nickname }, { onConflict:'browser_uuid' }).select('id,nickname,browser_uuid').single()
    .then(({ data, error })=>{
      if(error) throw error;
      if(data) currentPlayer = { id:data.id, uuid:data.browser_uuid||currentPlayer.uuid, nickname:data.nickname||currentPlayer.nickname, ready:true };
      return currentPlayer;
    }).catch(()=>currentPlayer);
}
function ensurePlayerProfile(){
  if(currentPlayer.ready) return Promise.resolve(currentPlayer);
  let uuid = safeStorageGet(PLAYER_UUID_KEY);
  let nickname = normalizeNickname(safeStorageGet(PLAYER_NICKNAME_KEY));
  if(!uuid){ uuid = makeBrowserUuid(); safeStorageSet(PLAYER_UUID_KEY, uuid); }
  if(!isValidNickname(nickname)) nickname = makeRandomNickname();
  currentPlayer = { id:null, uuid, nickname, ready:true };
  saveNickname(nickname);
  return syncPlayerProfile();
}
function waitForNickname(forceEdit=false, requireConfirmedName=false){
  const stored = normalizeNickname(safeStorageGet(PLAYER_NICKNAME_KEY));
  if(!forceEdit && isValidNickname(stored) && isNicknameConfirmed()) return ensurePlayerProfile();
  return new Promise(resolve=>{
    const finish = (nickname, confirmed)=>{ saveNickname(nickname); if(confirmed) confirmNickname(); hide(dom.nicknameScreen); ensurePlayerProfile().then(resolve); };
    const update = ()=>{
      const clamped=clampNicknameInput(dom.nicknameInput.value);
      if(clamped!==dom.nicknameInput.value) dom.nicknameInput.value=clamped;
      dom.nicknameCount.textContent='宽度 '+nicknameWidth(dom.nicknameInput.value)+'/20（ASCII≤15，中文≤10）';
      dom.nicknameError.textContent='';
    };
    dom.nicknameInput.value=stored; update(); show(dom.nicknameScreen); setTimeout(()=>dom.nicknameInput.focus(), 0);
    dom.nicknameConfirmBtn.onclick=()=>{ const nickname=normalizeNickname(dom.nicknameInput.value); if(!nickname){ dom.nicknameError.textContent=requireConfirmedName?'请输入昵称，尊贵的灵魂。':'请输入昵称，或点击跳过使用随机昵称。'; return; } finish(nickname, true); };
    dom.nicknameSkipBtn.onclick=()=>finish(makeRandomNickname(), false);
    dom.nicknameSkipBtn.style.display=requireConfirmedName?'none':'';
    dom.nicknameInput.oninput=update;
    dom.nicknameInput.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); dom.nicknameConfirmBtn.click(); } };
  });
}
function updateNicknameHud(){
  if(dom && dom.nicknameValue) dom.nicknameValue.textContent = getPlayerNickname() || '待命名';
}

const dom = {
  hud:$('hud'), playerHp:$('playerHp'), ophRow:$('ophRow'), ophHp:$('ophHp'),
  ammoRow:$('ammoRow'), ammoVal:$('ammoVal'), ammoMax:$('ammoMax'), ammoCd:$('ammoCd'),
  levelLabel:$('levelLabel'), timerRow:$('timerRow'), timer:$('timer'),
  scorePanel:$('scorePanel'), scoreVal:$('scoreVal'), combo:$('combo'),
  muteBtn:$('muteBtn'), ctrlHint:$('ctrlHint'), hintRanged:$('hintRanged'), hintLock:$('hintLock'),
  levelName:$('levelName'),
  dlgBar:$('dlgBar'), dlgLeft:$('dlgLeft'), dlgRight:$('dlgRight'), bossGuide:$('bossGuide'),
  storyScreen:$('storyScreen'), storyFx:$('storyFx'), storyAct:$('storyAct'), storyTitle:$('storyTitle'), storyBody:$('storyBody'), storyPortrait:$('portraitCanvas'),
  skipBtn:$('skipBtn'), storyBtn:$('storyBtn'),
  titleScreen:$('titleScreen'), startBtn:$('startBtn'),
  levelClearScreen:$('levelClearScreen'), clearText:$('clearText'), clearScore:$('clearScore'), nextBtn:$('nextBtn'),
  winScreen:$('winScreen'), winQuote:$('winQuote'), winScore:$('winScore'), restartWinBtn:$('restartWinBtn'),
  loseScreen:$('loseScreen'), loseTitle:$('loseTitle'), loseText:$('loseText'), loseScore:$('loseScore'), restartBtn:$('restartBtn'),
  messageBoard:$('messageBoard'), messageTitle:$('messageTitle'), messagePrompt:$('messagePrompt'), messageInput:$('messageInput'),
  messageCount:$('messageCount'), messageError:$('messageError'), messageSubmitBtn:$('messageSubmitBtn'), messageCloseBtn:$('messageCloseBtn'), messageList:$('messageList'),
  nicknameScreen:$('nicknameScreen'), nicknameInput:$('nicknameInput'), nicknameCount:$('nicknameCount'), nicknameError:$('nicknameError'),
  nicknameConfirmBtn:$('nicknameConfirmBtn'), nicknameSkipBtn:$('nicknameSkipBtn'), nicknameValue:$('nicknameValue'), nicknameEditBtn:$('nicknameEditBtn')
};
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }
function applyRuntimeUiFixes(){
  updateDialogueBarOffset();
}
function updateDialogueBarOffset(){
  if(!dom.dlgBar) return;
  let top = 90;
  if(dom.hud && dom.hud.getBoundingClientRect){
    const stage = canvas.parentElement;
    const hudRect = dom.hud.getBoundingClientRect();
    const stageRect = stage && stage.getBoundingClientRect ? stage.getBoundingClientRect() : { top:0 };
    const hudBottom = Math.ceil(hudRect.bottom - stageRect.top);
    if(hudBottom > 0) top = hudBottom + 10;
  }
  dom.dlgBar.style.top = top + 'px';
}
applyRuntimeUiFixes();
window.addEventListener('resize', updateDialogueBarOffset);
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
  updateNicknameHud();
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
function addFloater(x,y,text,color,size){ floaters.push({x,y,text,color,size:size||14,life:56,max:56,world:true}); }
function addScreenFloater(x,y,text,color,size,life){
  if(!floaters) return;
  floaters.push({x,y,text,color,size:size||14,life:life||120,max:life||120,world:false});
}
function drawTextPanel(x,y,w,h,fill,stroke){
  ctx.fillStyle=fill||'rgba(8,6,14,0.78)'; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle=stroke||'rgba(232,194,90,0.55)'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h);
}

function updateParticles(){
  updateWeatherParticles();
  for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=p.g; if(p.grow)p.size+=p.grow; if(p.ripple)p.ripple+=1.4; if(--p.life<=0) particles.splice(i,1); }
  for(let i=fireworks.length-1;i>=0;i--){ const p=fireworks[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.06; if(--p.life<=0) fireworks.splice(i,1); }
  for(let i=floaters.length-1;i>=0;i--){ const f=floaters[i]; f.y-=0.7; if(--f.life<=0) floaters.splice(i,1); }
  for(let i=petals.length-1;i>=0;i--){ const p=petals[i]; p.x+=p.vx+Math.sin(frame*0.04+p.ph)*0.5; p.y+=p.vy; p.rot+=p.vr; if(p.y>level.height+40||--p.life<=0) petals.splice(i,1); }
  for(let i=crows.length-1;i>=0;i--){ const c=crows[i]; c.x+=c.vx; c.flap+=0.3; if(c.x<camX-200||c.x>camX+VW+400) crows.splice(i,1); }
  for(let i=shockwaves.length-1;i>=0;i--){ const s=shockwaves[i]; if(++s.t>=s.max) shockwaves.splice(i,1); }
}
function spawnPetal(x,y,color){ petals.push({x,y,vx:rand(-.6,.4),vy:rand(.6,1.6),rot:rand(0,6.28),vr:rand(-.1,.1),size:rand(3,6),color:color||'#ffd0e6',ph:rand(0,6.28),life:rand(200,400)}); }

const WEATHER_MAX = 50;
const weatherPool = [];
let weatherKind = '';
for(let i=0;i<WEATHER_MAX;i++) weatherPool.push({active:false});
function currentWeatherKind(){
  if(actIndex===ACT_CASTLE) return 'snow';
  if(actIndex===ACT_ESCAPE) return 'petal';
  if(actIndex===ACT_FINAL) return opheliaSaved && !darkMode ? 'gold' : 'ember';
  return '';
}
function resetWeatherParticle(p, kind, initial){
  p.active=true; p.kind=kind; p.rot=rand(0,6.28); p.vr=rand(-0.04,0.04); p.phase=rand(0,6.28);
  p.x=rand(camX-20, camX+VW+20);
  p.y=initial ? rand(camY-20, camY+VH+20) : camY-20;
  if(kind==='snow'){ p.vx=rand(-0.18,0.18); p.vy=rand(0.22,0.48); p.size=rand(1,2.4); p.color='rgba(245,250,255,0.82)'; }
  else if(kind==='petal'){ p.vx=rand(-0.35,0.18); p.vy=rand(0.35,0.85); p.size=rand(3,6); p.color='rgba(222,64,142,0.78)'; p.vr=rand(-0.08,0.08); }
  else if(kind==='ember'){ p.y=initial ? rand(camY+20, camY+VH+30) : camY+VH+20; p.vx=rand(-0.2,0.22); p.vy=rand(-0.8,-0.28); p.size=rand(1.5,3.2); p.color=Math.random()<0.5?'rgba(255,96,36,0.78)':'rgba(255,172,62,0.68)'; p.vr=rand(-0.1,0.1); }
  else { p.y=initial ? rand(camY+20, camY+VH+30) : camY+VH+20; p.vx=rand(-0.12,0.12); p.vy=rand(-0.55,-0.18); p.size=rand(1.5,3.6); p.color='rgba(255,220,112,0.74)'; }
}
function ensureWeatherPool(kind){
  if(kind!==weatherKind){ weatherKind=kind; for(const p of weatherPool) p.active=false; }
  if(!kind) return;
  const target = kind==='snow' ? 42 : (kind==='petal' ? 36 : 32);
  let active=0;
  for(const p of weatherPool) if(p.active) active++;
  for(const p of weatherPool){ if(active>=target) break; if(!p.active){ resetWeatherParticle(p, kind, true); active++; } }
}
function updateWeatherParticles(){
  const kind=currentWeatherKind();
  ensureWeatherPool(kind);
  if(!kind || state!==STATE.PLAY) return;
  for(const p of weatherPool){
    if(!p.active) continue;
    p.phase+=0.025; p.rot+=p.vr; p.x+=p.vx+Math.sin(frame*0.018+p.phase)*0.12; p.y+=p.vy;
    if(p.x<camX-30||p.x>camX+VW+30||p.y<camY-35||p.y>camY+VH+35) resetWeatherParticle(p, kind, false);
  }
}
function drawWeatherParticles(){
  if(!weatherKind) return;
  ctx.save();
  for(const p of weatherPool){
    if(!p.active) continue;
    ctx.globalAlpha=weatherKind==='snow'?0.9:0.78; ctx.fillStyle=p.color;
    if(p.kind==='snow'){ ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,6.283); ctx.fill(); }
    else { ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size/2,-p.size/3,p.size,p.size*0.66); ctx.restore(); }
  }
  ctx.restore(); ctx.globalAlpha=1;
}

/* -------------------------------------------------------------------------
   构图规则模块（Composition Rules）
   -------------------------------------------------------------------------
   五幕共享的装饰排布策略，把"元素堆叠"改为"艺术构图"：
   - 三分法锚点：视觉重心放在 1/3、2/3 交点，而非画面中央
   - 焦点/留白：每幕定义焦点 X 与呼吸区带，主角活动区少堆装饰
   - 节奏化位置：边缘密-中央疏的非均匀分布 + 黄金比例扰动
   - S 形/弧形引导线：装饰沿曲线排布形成视觉引导
   - 色彩呼应：全幕共享一枚焦点色，用于点睛（火焰/月光/金饰）
   仅影响装饰绘制，不修改平台/碰撞/角色坐标。
   ------------------------------------------------------------------------- */
// 焦点 X（构图重心，屏幕坐标）
function compFocalX(act){
  switch(act){
    case ACT_CASTLE:  return W*0.666;   // 城堡：右2/3远塔为焦点
    case ACT_COURT:   return W*0.5;     // 宫廷：中心王座轴
    case ACT_ESCAPE:  return W*0.333;   // 逃亡：左1/3远山
    case ACT_ENGLAND: return W*0.666;   // 海景：右2/3灯塔月柱
    case ACT_FINAL:   return W*0.5;     // 终局：中央崩塌焦点
  }
  return W*0.5;
}
// 留白区带 - 主角视线附近减少装饰
function compBreathingBand(act){
  const fx=compFocalX(act);
  // 焦点区正下方给玩家留出"透气"通道
  return [fx-70, fx+70];
}
// 焦点色 - 全幕呼应
function compAccent(act){
  switch(act){
    case ACT_CASTLE:  return 'rgba(232,204,120,0.9)'; // 火把金
    case ACT_COURT:   return 'rgba(232,194,90,0.85)'; // 宫廷金
    case ACT_ESCAPE:  return 'rgba(224,168,216,0.85)';// 朋克粉紫
    case ACT_ENGLAND: return 'rgba(255,190,90,0.85)'; // 灯塔橙
    case ACT_FINAL:   return 'rgba(255,120,40,0.9)';  // 熔岩橙
  }
  return 'rgba(220,220,220,0.8)';
}
// 艺术节奏位置：返回 [0..1] 之间的 count 个非均匀位置
// edgeBias 越大越偏向边缘（框景效果），centerGap 强制中央留白
function compRhythm(seed, count, edgeBias, centerGap){
  const eb = edgeBias!==undefined ? edgeBias : 0.45;
  const cg = centerGap!==undefined ? centerGap : 0.10;
  const arr=[];
  for(let i=0;i<count;i++){
    const base=(i+0.5)/count;
    // 边缘偏置：中心区域推向两侧
    const centerDist=Math.abs(base-0.5)*2;
    const push=(1-centerDist)*eb*0.35*(hnoise(seed*11+i*7)-0.5);
    // 黄金比例扰动
    const jitter=(hnoise(seed*3+i*13)-0.5)*0.10;
    let x=base+push+jitter;
    // 中央留白：位于 [0.5-cg, 0.5+cg] 时往边缘推
    if(x>0.5-cg && x<0.5+cg){
      x = x<0.5 ? (0.5-cg) - (0.5-cg-x)*0.6 : (0.5+cg) + (x-0.5-cg)*0.6;
    }
    arr.push(clamp(x, 0.03, 0.97));
  }
  return arr;
}
// S 形引导线 Y 位移（t∈[0..1]，用于装饰沿曲线排布）
function compGuideY(t, amp){
  return Math.sin(t*Math.PI)*amp + Math.sin(t*Math.PI*2)*amp*0.28;
}
// 屏幕横向密度渐变（中央稀疏，两端密集）
function compDensityAt(nx){ return 0.35 + Math.abs(nx-0.5)*2 * 0.65; }
// 屏幕 x 是否在留白带内（true = 应保留，避免堆装饰）
function compInBreathing(x, act){
  const [b0,b1]=compBreathingBand(act);
  return (x>b0 && x<b1);
}
// 屏幕横向"三分法"锚点
function compThirds(){ return [W*0.333, W*0.667]; }

/* -------------------------------------------------------------------------
   6. 背景绘制（视差层，屏幕空间；不受世界缩放影响）
   每幕不同氛围；失败路线 darkMode 会切换阴郁哥特配色
   ------------------------------------------------------------------------- */
function drawBackground(){
  const theme = ACTS[actIndex].theme;
  // 第四幕船舱战斗区：昏暗压迫的铆钉金属舱室（铆钉壁纹/舷窗蓝光/摇摆吊灯光锥），最华丽配置
  if(cabinActive){ drawCabinBackground(frame); return; }
  // 第四幕 英格兰：专用精细化海景（天空/月光/云层/三层波浪/倒影/帆船/灯塔/前景岩礁）
  if(actIndex===ACT_ENGLAND){
    // 船体摇晃像素级视觉呼应：整体海景随 rockOffset 轻微上下浮动
    ctx.save();
    ctx.translate(0, rockOffset);
    drawEnglandBackground(frame);
    ctx.restore();
    drawSceneDecorations();
    drawWeatherParticles();
    drawAmbientBg();
    drawActAmbientFx();
    return;
  }
  // 天空渐变
  let sky = theme.sky;
  if(darkMode && actIndex===ACT_FINAL) sky = ['#0a0710','#160a1c','#050308'];
  const grd = ctx.createLinearGradient(0,0,0,H);
  grd.addColorStop(0, sky[0]); grd.addColorStop(0.5, sky[1]); grd.addColorStop(1, sky[2]);
  ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
  // 第五幕 Boss<30% 血量：天空渐染暗红压迫
  drawFinalSkyTint();

  // 远景层视差专属新增元素（山脊/城堡废墟等，视差 0.2）
  drawFarLayerFx();

  // 月亮 / 光源（远景，视差 0.05）
  if(theme.moon){
    const mx = W*0.78 - (camX*0.05)%W, my=H*0.22;
    const mg = ctx.createRadialGradient(mx,my,4,mx,my,60);
    const moonC = darkMode? 'rgba(180,150,210,':'rgba(240,235,210,';
    mg.addColorStop(0, moonC+'0.95)'); mg.addColorStop(1, moonC+'0)');
    ctx.fillStyle=mg; ctx.beginPath(); ctx.arc(mx,my,60,0,6.283); ctx.fill();
    ctx.fillStyle= darkMode?'#c9b6e0':'#f2eecf'; ctx.beginPath(); ctx.arc(mx,my,26,0,6.283); ctx.fill();
    drawMoonCloudFlicker(mx,my);   // 云层遮月闪烁（第一幕冷月）
  }

  // 远景剪影层（视差 0.2）
  const off1 = parallaxOff(0.2,320);
  ctx.fillStyle = darkMode? '#0d0814' : theme.far;
  for(let bx=-off1-320; bx<W+320; bx+=320){ theme.drawFar(bx, H); }

  // 中景层（视差 0.5）
  const off2 = parallaxOff(0.5,260);
  ctx.fillStyle = darkMode? '#140b1e' : theme.mid;
  for(let bx=-off2-260; bx<W+260; bx+=260){ theme.drawMid(bx, H); }

  // 中景层视差专属新增元素（城垛/柱廊/挂毯/电线杆/废墟，视差 0.5）
  drawMidLayerFx();

  // 程序化场景装饰与天气（近景 0.8），均在背景层绘制，不参与碰撞。
  drawSceneDecorations();
  drawWeatherParticles();

  // 环境浮层：雾/雨/花瓣/乌鸦
  drawAmbientBg();
  // 各幕动态特效（守卫/鬼魂/死神/花瓣/偷窥/乌鸦/窗光/滚动浓雾等）
  drawActAmbientFx();
}
/* ============================================================
   视差分层新增背景元素（远景 0.2 / 中景 0.5）——确定性静态，index 伪随机
   ============================================================ */
function drawFarLayerFx(){
  drawFarFxPlus();   // 【新增】远景加倍层（先绘制，置于原远景之后=更远）
  if(actIndex===ACT_ESCAPE){
    // 第三幕远景：荒野山脊剪影
    const off=parallaxOff(0.2,W); ctx.save(); ctx.fillStyle=darkMode?'#120c1a':'#171020';
    for(let seg=-1; seg<=1; seg++){ const bx=-off+seg*W; ctx.beginPath(); ctx.moveTo(bx,H); ctx.lineTo(bx,H*0.5);
      for(let x=0;x<=W;x+=40){ const n=hnoise((x/40)|0); ctx.lineTo(bx+x, H*0.5 - n*70 - Math.sin(x*0.01)*20); }
      ctx.lineTo(bx+W,H); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  } else if(actIndex===ACT_FINAL){
    // 第五幕远景：多层天空云带 + 焦点式废墟群落
    // 云带保持横向流动，但在中央焦点上方留出"天光洞口"效果（drawFinalCloudBands 内已实现放射式）
    drawFinalCloudBands();
    // 极远层：只在两侧远端各画 1 段矮小残墙（框景），不再全屏 tile
    ctx.save(); ctx.fillStyle=darkMode?'#0f0714':'#140d1b';
    drawRuinedRampart(-40, H*0.44);              // 左端一段
    drawRuinedRampart(W-260, H*0.44);            // 右端一段
    ctx.restore();
    // 远景城堡废墟：中央 1 座大废墟为焦点（最高最阔），两侧对称各 1 座递减小废墟
    // 视差保持 0.2，但按"金字塔式"锚定构图，而不是全屏铺 tile
    const off=parallaxOff(0.2, W*2);
    ctx.save(); ctx.fillStyle=darkMode?'#160b1c':'#1c1424';
    // 焦点主废墟（中央，最完整最高）
    drawRuinSilhouette(W*0.5 - 180 - off*0.05, H*0.5);
    // 两侧副废墟（更远更破，尺寸小 65%）
    ctx.save();
    ctx.translate(W*0.10 - off*0.03, 0); ctx.scale(0.65, 0.75);
    drawRuinSilhouetteFar(0, H*0.46/0.75);
    ctx.restore();
    ctx.save();
    ctx.translate(W*0.82 - off*0.03, 0); ctx.scale(0.7, 0.8);
    drawRuinSilhouetteFar(0, H*0.46/0.8);
    ctx.restore();
    ctx.restore();
  }
}
function drawMidLayerFx(){
  const off=parallaxOff(0.5,300);
  if(actIndex===ACT_CASTLE){
    // 第一幕中景：城垛（雉堞）保留连续墙面（近景基底需要连贯），但装饰节奏化
    ctx.save(); ctx.fillStyle='#20263f';
    const top=H*0.30;
    // 连续城墙基线（覆盖整屏）
    ctx.fillRect(0, top, W, H*0.12);
    // 齿垛：非均匀节奏——两侧密集，中央稀疏（引导玩家视线到中央焦点主塔）
    for(let m=0;m<32;m++){
      // 节奏：位置按 m 号非均匀映射，跳过中央 [0.42,0.58]
      const nx = m/32;
      if(nx>0.42 && nx<0.58) continue; // 中央留缺口
      if(m%2!==0) continue; // 保持齿垛间隔
      const px = nx*W;
      const merlonW = 20 + (nx<0.2 || nx>0.8 ? 4 : 0); // 边缘齿垛稍高
      ctx.fillRect(px, top-12, 22, 12);
    }
    // 城垛旗帜：仅 3 面，放在三分法锚点（左1/3、右2/3、极右角落）
    drawParapetFlag(W*0.333, top-12, frame*0.03);
    drawParapetFlag(W*0.667, top-12, frame*0.03+2);
    drawParapetFlag(W*0.90,  top-12, frame*0.03+3.5);
    ctx.restore();
  } else if(actIndex===ACT_COURT){
    // 第二幕中景：宫廷柱廊透视（左右各 2 根高柱）+ 挂毯花纹
    drawCourtColonnade();
  } else if(actIndex===ACT_ESCAPE){
    // 第三幕中景：破败电线杆 + 电线（由 drawMidFxPlus 统一处理艺术排布，这里留空避免双绘）
  } else if(actIndex===ACT_FINAL){
    // 第五幕中景：塌陷墙壁 + 断裂柱子 - 改为"两侧对称崩塌，中央留通道"
    ctx.save(); ctx.fillStyle=darkMode?'#221530':'#2a2038';
    const off=parallaxOff(0.5, W*2);
    // 左右各 1 大段崩塌墙（框景），中央留一段空地作"王座前庭"
    drawBrokenWall(-30 - off*0.02, H*0.56);
    drawBrokenWall(W*0.62 - off*0.02, H*0.56);
    // 中央焦点：一根倾斜断柱指向中心（引导视线）
    ctx.save();
    ctx.translate(W*0.42 - off*0.02, H*0.56);
    ctx.rotate(0.15);
    ctx.fillRect(0, -66, 14, 66);
    ctx.fillRect(-4, -66, 22, 6);
    ctx.restore();
    ctx.restore();
  }
  drawMidFxPlus();   // 【新增】中景加倍层
}

function drawSceneDecorations(){
  const t=frame*0.025;
  const nearOff=(camX*0.8)%320;
  if(actIndex===ACT_CASTLE){
    // 城堡近景：火把沿三分法两侧+顶部横旗仅左右框景两面，中央留白
    // 3 支火把 - 强对比大小：左侧焦点大火把 + 右侧对称 + 中远侧点缀
    const torches=[
      {x:W*0.18, y:H*0.42, s:1.15},        // 左侧近景大焰
      {x:W*0.82, y:H*0.44, s:1.05},        // 右侧对称
      {x:W*0.05, y:H*0.5,  s:0.75}         // 极左角落小焰（点缀）
    ];
    torches.forEach((f,i)=>{ ctx.save(); ctx.translate(0,0); ctx.scale(1,1);
      drawWallTorch(f.x - nearOff*0.15, f.y+Math.sin(i)*6, t+i*1.3); ctx.restore(); });
    // 2 面横旗只出现在左1/3与右2/3门柱位置，形成"入口"暗示
    drawBanner(W*0.28 - (nearOff%520)*0.4, H*0.28, '#7a1e2a', '#e8c25a', t);
    drawBanner(W*0.72 - (nearOff%520)*0.4, H*0.30, '#4a2a5a', '#e8c25a', t+2.1);
  } else if(actIndex===ACT_COURT){
    // 宫廷近景：地面对称三烛台（左1/3、中、右2/3）+ 顶部两幅落地长幕（框景）
    // 中央烛台略高 -> 汇聚视线到中轴（王座感）
    drawCandelabrum(W*0.28 - (nearOff%880)*0.15, H*0.60+Math.sin(t)*3, t);
    drawCandelabrum(W*0.5  - (nearOff%880)*0.15, H*0.56+Math.sin(t+1.2)*3, t+1.2);  // 中央高
    drawCandelabrum(W*0.72 - (nearOff%880)*0.15, H*0.60+Math.sin(t+2.3)*3, t+2.3);
    // 两幅落地长幕（左右框景）
    drawDrapery(W*0.03 - (nearOff%880)*0.10, H*0.05, 88, 200, t);
    drawDrapery(W*0.89 - (nearOff%880)*0.10, H*0.05, 88, 200, t+1.5);
  } else if(actIndex===ACT_ESCAPE){
    // 逃亡近景：枯树沿 S 形引导线排布（远端左倾-中段右倾-近端左倾）
    // 只用 4 棵大小差异极大的枯树，制造"节奏与呼吸"
    const trees=[
      {tx:0.14, h:60, sc:1.0},   // 左前景大树（视觉锚）
      {tx:0.38, h:44, sc:0.75},  // 中远小树
      {tx:0.62, h:52, sc:0.85},  // 中右
      {tx:0.90, h:66, sc:1.1}    // 右前景大树（对称锚，稍大）
    ];
    trees.forEach((tr,i)=>{
      const gx = tr.tx*W - (nearOff%720)*0.20;
      const gy = H*0.72 + compGuideY(tr.tx, 8);
      ctx.save(); ctx.translate(gx, gy); ctx.scale(tr.sc, tr.sc);
      drawDeadTreeDecor(0, 0, tr.h); ctx.restore();
    });
    // 花丛聚簇（不再均匀 24 朵，改为 3 个花簇分别在 1/6、1/2 留白外、5/6）
    const clusters=[[W*0.16,H*0.80,7],[W*0.5,H*0.83,4],[W*0.84,H*0.79,7]];
    clusters.forEach((c,ci)=>{
      const cx0=c[0]-(nearOff%600)*0.18, cy0=c[1];
      for(let k=0;k<c[2];k++){
        const ang=(k/c[2])*Math.PI*2 + ci;
        const rr=6+hnoise(ci*7+k)*14;
        drawGroundFlower(cx0+Math.cos(ang)*rr, cy0+Math.sin(ang)*rr*0.5, ci*17+k);
      }
    });
  } else if(actIndex===ACT_ENGLAND){
    // 英格兰海景已由 drawEnglandBackground 统一绘制（含波浪/帆船/灯塔），此处不再叠加旧的绳索/铁锚残留
  } else if(actIndex===ACT_FINAL){
    // 终局近景重构：中央王座为焦点，左右两侧对称"崩塌前景"框景，中间通道留白
    // 王座保持中央焦点位置
    drawThrone(W/2-(camX*0.2%80), H*0.58, darkMode);
    // 骷髅：8 处沿"战场遗骸弧线"排布（远近弧线感），避开中央 30% 通道
    for(let i=0;i<8;i++){
      const t=i/7;
      const nx=t<0.5 ? 0.06+t*0.55 : 0.44+t*0.55; // 跳过 [0.39,0.44] 中央
      const sx=nx*W - (nearOff%620)*0.12;
      const sy=H*0.82 + compGuideY(t, 14);
      drawSkullDecor(sx, sy, i);
    }
    // 碎石：仅在两侧堆积（框景），中央通道保持干净
    ctx.save(); ctx.fillStyle=darkMode?'rgba(30,20,40,0.9)':'rgba(46,36,58,0.9)';
    for(let side=0;side<2;side++){
      const sign = side===0?-1:1;
      const anchor = side===0? W*0.16 : W*0.84;
      for(let i=0;i<11;i++){
        const spread = 60 + hnoise(side*20+i)*90;
        const rx = anchor + sign*spread - (nearOff%620)*0.18*sign;
        const ry = H*0.86 + hnoise(i+side*17)*30;
        const s  = 3 + hnoise(i+side*29+3)*6;
        ctx.beginPath(); ctx.moveTo(rx,ry); ctx.lineTo(rx+s,ry-s*0.6);
        ctx.lineTo(rx+s*1.8,ry); ctx.lineTo(rx+s*0.9,ry+s*0.5); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
    // 断柱：5 根不再均匀 7 根堆叠 - 采用"教堂式"层次：
    // 两侧最矮的柱础(type=2) + 中景倾倒断柱(type=1) + 焦点两侧对称直立残柱(type=0)
    const cols=[
      {x:W*0.08, y:H*0.84, type:2},                  // 左边缘柱础
      {x:W*0.24, y:H*0.83, type:1},                  // 左倾倒
      {x:W*0.34, y:H*0.80, type:0},                  // 左焦点直立
      {x:W*0.66, y:H*0.80, type:0},                  // 右焦点直立（对称）
      {x:W*0.78, y:H*0.83, type:1},                  // 右倾倒（镜像）
      {x:W*0.94, y:H*0.84, type:2}                   // 右边缘柱础
    ];
    cols.forEach((c,i)=>{
      const cx = c.x - (nearOff%720)*0.22;
      drawBrokenColumnBg(cx, c.y, c.type, i*11);
    });
    // 破碎盔甲/武器：6 处，与骷髅弧线交错，形成"战场余烬"排布
    for(let i=0;i<6;i++){
      const t=(i+0.5)/6;
      const nx = t<0.5 ? 0.08+t*0.45 : 0.47+t*0.45;
      const ax = nx*W - (nearOff%620)*0.16;
      const ay = H*0.87 + compGuideY(t+0.15, 10);
      drawArmorDebris(ax, ay, i*7+3);
    }
    // 熔岩裂缝地面：由函数内部做"两侧密-中央稀"分布
    const ph3dec = boss && boss.kind==='claudius' && boss.phase>=3;
    drawLavaCrackGround(nearOff, ph3dec);
    // 燃烧破旗：2 处严格对称三分法（左1/3、右2/3），旗杆倾向中央如"哀悼战旗"
    drawBurningFlag(W*0.30 - (camX*0.8)%W*0.001, H*0.88, frame*0.05);
    drawBurningFlag(W*0.70 - (camX*0.8)%W*0.001, H*0.89, frame*0.05+2.2);
  }
  drawSceneDecoPlus();   // 【新增】近景装饰加倍层
}
function drawWallTorch(x,y,t){
  ctx.save(); ctx.fillStyle='#2a1c18'; ctx.fillRect(x-3,y-8,6,28); ctx.fillStyle='#6a4a2a'; ctx.fillRect(x-9,y+4,18,5);
  const flame=9+Math.sin(t*5)*3; const g=ctx.createRadialGradient(x,y-flame*.2,2,x,y,22); g.addColorStop(0,'rgba(255,230,120,.85)'); g.addColorStop(.45,'rgba(255,96,36,.65)'); g.addColorStop(1,'rgba(255,56,16,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,22,0,6.283); ctx.fill();
  ctx.fillStyle='#ffb43e'; ctx.beginPath(); ctx.moveTo(x,y-18-flame*.25); ctx.quadraticCurveTo(x+8,y-6,x,y+5); ctx.quadraticCurveTo(x-8,y-6,x,y-18-flame*.25); ctx.fill(); ctx.restore();
}
function drawBanner(x,y,cloth,gold,t){
  const wave=Math.sin(t*3+x*.03)*7; ctx.save(); ctx.fillStyle='#322338'; ctx.fillRect(x-4,y-8,42,5); ctx.fillStyle=cloth; ctx.beginPath(); ctx.moveTo(x,y); ctx.quadraticCurveTo(x+24+wave,y+12,x+38,y); ctx.lineTo(x+34+wave*.4,y+72); ctx.lineTo(x+19,y+58); ctx.lineTo(x+4-wave*.3,y+72); ctx.closePath(); ctx.fill(); ctx.fillStyle=gold; ctx.globalAlpha=.7; ctx.fillRect(x+16,y+10,5,42); ctx.restore();
}
function drawCandelabrum(x,y,t){
  ctx.save(); ctx.strokeStyle='#b89342'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y-44); ctx.moveTo(x,y-28); ctx.quadraticCurveTo(x-22,y-30,x-22,y-48); ctx.moveTo(x,y-28); ctx.quadraticCurveTo(x+22,y-30,x+22,y-48); ctx.stroke(); ctx.fillStyle='#c9a24a'; ctx.fillRect(x-18,y-4,36,5);
  [-22,0,22].forEach((dx,i)=>{ const fy=y-52+Math.sin(t*6+i)*2; ctx.fillStyle='rgba(255,215,120,.35)'; ctx.beginPath(); ctx.arc(x+dx,fy,13,0,6.283); ctx.fill(); ctx.fillStyle='#ffd66a'; ctx.beginPath(); ctx.arc(x+dx,fy,4,0,6.283); ctx.fill(); }); ctx.restore();
}
function drawDrapery(x,y,w,h,t){
  ctx.save(); const g=ctx.createLinearGradient(x,0,x+w,0); g.addColorStop(0,'rgba(75,18,52,.78)'); g.addColorStop(.5,'rgba(132,35,82,.84)'); g.addColorStop(1,'rgba(70,14,46,.78)'); ctx.fillStyle=g; ctx.beginPath(); ctx.moveTo(x,y); for(let i=0;i<=6;i++){ const px=x+w*i/6, py=y+h+Math.sin(t*2+i)*10; ctx.lineTo(px,py); } ctx.lineTo(x+w,y); ctx.closePath(); ctx.fill(); ctx.strokeStyle='rgba(232,194,90,.35)'; ctx.strokeRect(x,y,w,5); ctx.restore();
}
function drawDeadTreeDecor(x,y,h){
  ctx.save(); ctx.strokeStyle='rgba(64,43,52,.82)'; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+8,y-h); ctx.moveTo(x+6,y-h*.55); ctx.lineTo(x-22,y-h*.8); ctx.moveTo(x+7,y-h*.7); ctx.lineTo(x+32,y-h*.95); ctx.moveTo(x+4,y-h*.42); ctx.lineTo(x+26,y-h*.56); ctx.stroke(); ctx.restore();
}
function drawGroundFlower(x,y,i){
  ctx.save(); ctx.translate(x,y); ctx.fillStyle=i%3?'rgba(210,64,130,.72)':'rgba(245,190,220,.7)'; for(let p=0;p<4;p++){ ctx.rotate(1.57); ctx.fillRect(0,-1,5,2); } ctx.fillStyle='rgba(180,140,50,.7)'; ctx.fillRect(-1,-1,2,2); ctx.restore();
}
/* ------- 第四幕 英格兰·流亡之路 精细化海景（全部由 frame 时间驱动，无 setInterval） ------- */
let englandFx=null;
function ensureEnglandFx(){
  if(englandFx) return englandFx;
  const clouds=[]; for(let i=0;i<5;i++){ clouds.push({ x:rand(-100,W+100), y:H*rand(0.06,0.34), s:rand(0.7,1.5), sp:rand(0.10,0.28), seed:rand(0,10) }); }
  const ships=[]; for(let i=0;i<2;i++){ ships.push({ x:rand(W*0.2,W*0.8), sp:rand(0.10,0.20)*(i?-1:1), sc:rand(0.85,1.2), sails:1+(i%2) }); }
  const sparkles=[]; for(let i=0;i<10;i++){ sparkles.push({ fx:rand(0.05,0.95), fy:rand(0.02,0.9), ph:rand(0,6.28), sp:rand(0.06,0.16) }); }
  englandFx={clouds,ships,sparkles};
  return englandFx;
}
function drawEnglandBackground(t){
  const fx=ensureEnglandFx();
  const horizon=H*0.66;                     // 海平线：海面占下方约 1/3
  const moonX=W*0.80, moonY=H*0.20, moonR=28;
  // --- 天空渐变：深蓝→中蓝→近海平线蓝 ---
  const g=ctx.createLinearGradient(0,0,0,horizon);
  g.addColorStop(0,'#050d1a'); g.addColorStop(0.55,'#0d2040'); g.addColorStop(1,'#1a3a5c');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,horizon);
  // --- 月亮外圈三层光晕 ---
  [[75,0.05],[55,0.09],[40,0.14]].forEach(([r,a])=>{ ctx.fillStyle='rgba(230,240,255,'+a+')'; ctx.beginPath(); ctx.arc(moonX,moonY,r,0,6.283); ctx.fill(); });
  // --- 月光锥：月亮向海面延伸的半透明锥形 ---
  ctx.save(); ctx.fillStyle='rgba(255,255,255,0.05)';
  ctx.beginPath(); ctx.moveTo(moonX-moonR*0.6,moonY); ctx.lineTo(moonX+moonR*0.6,moonY);
  ctx.lineTo(moonX+70,horizon); ctx.lineTo(moonX-70,horizon); ctx.closePath(); ctx.fill(); ctx.restore();
  // --- 月亮本体 ---
  ctx.fillStyle='#f4f8ff'; ctx.beginPath(); ctx.arc(moonX,moonY,moonR,0,6.283); ctx.fill();
  ctx.fillStyle='rgba(210,225,245,0.5)'; ctx.beginPath(); ctx.arc(moonX+8,moonY-4,6,0,6.283); ctx.fill(); // 环形山暗斑
  // --- 云层：4-6 个不规则多边形，缓慢横向漂移 ---
  fx.clouds.forEach(c=>{
    const cx=((c.x + t*c.sp) % (W+240)) - 120;
    drawEnglandCloud(cx, c.y, c.s, c.seed);
  });
  // --- 远景帆船：海平线处缓慢漂移的深色剪影 ---
  fx.ships.forEach(s=>{
    let sx=(s.x + t*s.sp);
    const span=W+160; sx=((sx%span)+span)%span - 80;
    drawEnglandShip(sx, horizon-2, s.sc, s.sails);
  });
  // --- 中景：右侧英格兰港口灯塔 ---
  drawLighthouse(W*0.16 - (camX*0.2)%40, horizon, t);
  // --- 海面三层波浪（远/中/近，各自速度不同的正弦波） ---
  ctx.fillStyle='#0a1e35'; ctx.fillRect(0,horizon,W,H-horizon);   // 海底基色
  drawWaveLayer(horizon+6,  4, 0.010, 0.6, '#0a1e35', t);          // 远层：低频慢速
  drawWaveLayer(horizon+22, 5, 0.020, 1.1, '#0d2a4a', t);          // 中层：中频中速
  drawWaveLayer(horizon+42, 7, 0.032, 1.9, '#103254', t);          // 近层：高频快速
  drawWaveHighlight(horizon+14, 3, 0.045, 2.0, 'rgba(100,160,220,0.4)', t); // 顶层高光
  // --- 月光倒影：月亮正下方竖向光柱，高度随波浪抖动 ---
  ctx.save();
  const beamW=24, jitter=Math.sin(t*0.12)*6;
  const bg=ctx.createLinearGradient(0,horizon,0,H);
  bg.addColorStop(0,'rgba(255,255,255,0.24)'); bg.addColorStop(1,'rgba(255,255,255,0.04)');
  ctx.fillStyle=bg;
  for(let y=horizon; y<H; y+=6){ const w=beamW*(0.6+0.4*Math.sin(t*0.1+y*0.08))+jitter*0.2; ctx.fillRect(moonX-w/2, y, w, 4); }
  ctx.restore();
  // --- 碎波光点：随机散布小白点，随机闪烁 ---
  ctx.save();
  fx.sparkles.forEach(sp=>{
    const px=sp.fx*W, py=horizon + sp.fy*(H-horizon);
    const a=0.15+0.35*Math.max(0,Math.sin(t*sp.sp+sp.ph));
    ctx.fillStyle='rgba(220,240,255,'+a.toFixed(3)+')';
    ctx.beginPath(); ctx.arc(px,py,1+ (sp.ph%1>0.5?1:0),0,6.283); ctx.fill();
  });
  ctx.restore();
  // --- 前景：底部岩礁/码头石块 + 苔藓绿点缀 ---
  drawEnglandRocks();
}
function drawEnglandCloud(cx, cy, s, seed){
  ctx.save(); ctx.fillStyle='rgba(200,220,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx+22*s, cy-8*s);
  ctx.lineTo(cx+48*s, cy-6*s+Math.sin(seed)*3);
  ctx.lineTo(cx+72*s, cy-10*s);
  ctx.lineTo(cx+96*s, cy-2*s);
  ctx.lineTo(cx+84*s, cy+6*s);
  ctx.lineTo(cx+40*s, cy+8*s);
  ctx.lineTo(cx+12*s, cy+6*s);
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawEnglandShip(sx, sy, sc, sails){
  ctx.save(); ctx.translate(sx,sy); ctx.scale(sc,sc); ctx.fillStyle='#0a1628';
  // 船体：梯形，底宽约 34
  ctx.beginPath(); ctx.moveTo(-17,0); ctx.lineTo(17,0); ctx.lineTo(12,7); ctx.lineTo(-12,7); ctx.closePath(); ctx.fill();
  // 桅杆
  ctx.fillRect(-1,-30,2,30);
  // 帆：1-2 个三角形
  ctx.beginPath(); ctx.moveTo(1,-28); ctx.lineTo(15,-6); ctx.lineTo(1,-6); ctx.closePath(); ctx.fill();
  if(sails>1){ ctx.beginPath(); ctx.moveTo(-1,-24); ctx.lineTo(-13,-6); ctx.lineTo(-1,-6); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
function drawLighthouse(x, groundY, t){
  ctx.save();
  const h=90, w=20, topY=groundY-h;
  // 塔身：石塔轮廓
  ctx.fillStyle='#1a2a3a';
  ctx.beginPath(); ctx.moveTo(x-w/2, groundY); ctx.lineTo(x-w*0.32, topY); ctx.lineTo(x+w*0.32, topY); ctx.lineTo(x+w/2, groundY); ctx.closePath(); ctx.fill();
  // 石墙纹理：短横线密集排列模拟砖石
  ctx.strokeStyle='rgba(90,120,150,0.35)'; ctx.lineWidth=1;
  for(let yy=topY+6; yy<groundY-2; yy+=5){ const ww=(w*0.32 + (yy-topY)/h*w*0.18); ctx.beginPath(); ctx.moveTo(x-ww,yy); ctx.lineTo(x+ww,yy); ctx.stroke(); }
  // 灯室
  ctx.fillStyle='#25384a'; ctx.fillRect(x-8, topY-12, 16, 12);
  ctx.fillStyle='#141f2a'; ctx.fillRect(x-10, topY-16, 20, 4); // 檐
  // 顶部橙黄光点：周期性闪烁
  const glow=0.5+0.5*Math.sin(t*0.08);
  ctx.fillStyle='rgba(255,180,70,'+(0.4+0.5*glow).toFixed(3)+')';
  ctx.beginPath(); ctx.arc(x, topY-6, 3, 0, 6.283); ctx.fill();
  const lg=ctx.createRadialGradient(x,topY-6,1,x,topY-6,22); lg.addColorStop(0,'rgba(255,190,90,'+(0.35*glow).toFixed(3)+')'); lg.addColorStop(1,'rgba(255,190,90,0)');
  ctx.fillStyle=lg; ctx.beginPath(); ctx.arc(x,topY-6,22,0,6.283); ctx.fill();
  ctx.restore();
}
function drawWaveLayer(yBase, amp, freq, speed, color, t){
  ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(0,yBase);
  for(let x=0;x<=W;x+=8){ const y=yBase+Math.sin(x*freq + t*0.03*speed)*amp; ctx.lineTo(x,y); }
  ctx.lineTo(W,H); ctx.closePath(); ctx.fill();
}
function drawWaveHighlight(yBase, amp, freq, speed, color, t){
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.beginPath();
  for(let x=0;x<=W;x+=6){ const y=yBase+Math.sin(x*freq + t*0.03*speed)*amp; if(x===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }
  ctx.stroke(); ctx.restore();
}
function drawEnglandRocks(){
  ctx.save();
  const off=(camX*0.7)%W, baseY=H-4;
  ctx.fillStyle='#1a1a2a';
  // 前景岩礁：3 组，按黄金分割排布——左1/3小、右2/3大主礁、极右小礁角落
  // 主礁位于灯塔正下方一侧（呼应灯塔焦点）
  const reefs=[
    {cx:0.16, w:180, hMul:0.9},   // 左次礁
    {cx:0.60, w:260, hMul:1.15},  // 右主礁（焦点，最阔最高）
    {cx:0.94, w:110, hMul:0.75}   // 极右角落点缀
  ];
  reefs.forEach(reef=>{
    const bx = reef.cx*W - off*0.06 - reef.w/2;
    ctx.beginPath();
    ctx.moveTo(bx, H);
    ctx.lineTo(bx+6*reef.hMul, baseY-18*reef.hMul);
    ctx.lineTo(bx+34, baseY-26*reef.hMul);
    ctx.lineTo(bx+70, baseY-14*reef.hMul);
    ctx.lineTo(bx+reef.w*0.5, baseY-30*reef.hMul);  // 峰
    ctx.lineTo(bx+reef.w*0.72, baseY-22*reef.hMul);
    ctx.lineTo(bx+reef.w*0.9, baseY-12*reef.hMul);
    ctx.lineTo(bx+reef.w, H);
    ctx.closePath(); ctx.fill();
    // 苔藓绿点缀 - 只在主礁与次礁上有（点睛）
    if(reef.w>=180){
      ctx.fillStyle='#2d4a2d';
      ctx.fillRect(bx+30, baseY-24*reef.hMul, 4, 3);
      ctx.fillRect(bx+reef.w*0.35, baseY-28*reef.hMul, 4, 3);
      ctx.fillRect(bx+reef.w*0.65, baseY-24*reef.hMul, 3, 3);
      ctx.fillStyle='#1a1a2a';
    }
  });
  ctx.restore();
}
function drawThrone(x,y,doom){
  ctx.save(); ctx.fillStyle=doom?'rgba(42,24,54,.82)':'rgba(82,54,24,.82)'; ctx.fillRect(x-48,y-100,96,124); ctx.fillStyle=doom?'rgba(92,58,112,.72)':'rgba(200,150,60,.7)'; ctx.fillRect(x-54,y-108,108,12); for(let i=0;i<5;i++) ctx.fillRect(x-42+i*21,y-132,10,28); ctx.fillStyle='rgba(0,0,0,.25)'; ctx.fillRect(x-34,y-72,68,68); ctx.restore();
}
function drawSkullDecor(x,y,i){
  ctx.save(); ctx.translate(x,y); ctx.rotate(Math.sin(i)*0.2); ctx.fillStyle='rgba(218,210,185,.62)'; ctx.beginPath(); ctx.arc(0,-5,9,0,6.283); ctx.fill(); ctx.fillRect(-7,0,14,9); ctx.fillStyle='rgba(20,14,18,.72)'; ctx.fillRect(-5,-7,4,4); ctx.fillRect(2,-7,4,4); ctx.fillRect(-1,-1,2,4); ctx.restore();
}
function drawDepthOccluders(){
  const off=(camX*0.95)%260;
  ctx.save();
  if(actIndex===ACT_CASTLE){
    ctx.fillStyle='rgba(46,50,74,0.34)';
    for(let x=-off-120;x<W+260;x+=260){
      ctx.fillRect(x, H*0.18, 42, H*0.64);
      ctx.fillStyle='rgba(20,22,35,0.22)'; ctx.fillRect(x+8,H*0.18,4,H*0.64); ctx.fillRect(x+30,H*0.18,3,H*0.64);
      ctx.fillStyle='rgba(72,78,108,0.30)'; ctx.fillRect(x-8,H*0.16,58,12); ctx.fillRect(x-10,H*0.82,62,16);
      ctx.fillStyle='rgba(46,50,74,0.34)';
    }
  } else if(actIndex===ACT_COURT){
    const sway=Math.sin(frame*0.018)*8;
    [{x:-26-sway,w:82},{x:W-56+sway,w:82}].forEach(d=>{
      const g=ctx.createLinearGradient(d.x,0,d.x+d.w,0); g.addColorStop(0,'rgba(58,10,42,.68)'); g.addColorStop(.55,'rgba(128,28,78,.52)'); g.addColorStop(1,'rgba(48,8,38,.38)'); ctx.fillStyle=g;
      ctx.beginPath(); ctx.moveTo(d.x,0); ctx.lineTo(d.x+d.w,0); ctx.lineTo(d.x+d.w-18,H*.7); ctx.quadraticCurveTo(d.x+d.w*.5,H*.76,d.x+12,H*.7); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='rgba(232,194,90,.28)'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(d.x+d.w*.5,0); ctx.lineTo(d.x+d.w*.48,H*.68); ctx.stroke();
    });
  }
  ctx.restore();
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

/* ============================================================
   新增：各幕动态特效层（帧驱动 / 确定性伪随机 / 固定粒子池，无外部资源）
   全部屏幕空间绘制，仅影响渲染，不参与碰撞/物理。
   ============================================================ */
// 第五幕：Boss<30% 血量时天空渐染暗红（背景阶段调用）
function drawFinalSkyTint(){
  if(actIndex!==ACT_FINAL || !(boss && boss.kind==='claudius' && (!boss.dead || boss.deathT>0))) return;
  const ratio=boss.hp/boss.maxHp;
  const ph3=boss.phase>=3;
  // 阶段三：无视血量强制深红/黑红压顶；否则仅血量<30% 时渐显
  let k;
  if(ph3) k=(0.88+0.12*Math.sin(frame*0.1));
  else { if(ratio>=0.3) return; k=clamp((0.3-ratio)/0.3,0,1)*(0.85+0.15*Math.sin(frame*0.08)); }
  if(bossRageT>0) k=Math.min(1.25, k+ (bossRageT/90)*0.4);   // 阶段切换瞬间进一步加深
  const g=ctx.createLinearGradient(0,0,0,H);
  if(ph3){
    g.addColorStop(0,'rgba(120,8,14,'+(0.52*k).toFixed(3)+')');
    g.addColorStop(0.5,'rgba(64,4,12,'+(0.40*k).toFixed(3)+')');
    g.addColorStop(1,'rgba(10,0,4,'+(0.26*k).toFixed(3)+')');
  } else {
    g.addColorStop(0,'rgba(96,12,18,'+(0.42*k).toFixed(3)+')');
    g.addColorStop(0.5,'rgba(56,8,16,'+(0.30*k).toFixed(3)+')');
    g.addColorStop(1,'rgba(20,2,8,'+(0.14*k).toFixed(3)+')');
  }
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
}
// 第一幕：云层缓慢遮月，制造冷月闪烁
function drawMoonCloudFlicker(mx,my){
  if(actIndex!==ACT_CASTLE) return;
  ctx.save();
  for(let i=0;i<3;i++){
    const speed=0.18+i*0.09;
    let x=((frame*speed + i*170) % (W+320)) - 160;
    const y=my-8+i*10;
    ctx.fillStyle='rgba(22,26,46,0.5)';
    ctx.beginPath(); ctx.ellipse(x,y,84,20,0,0,6.283); ctx.fill();
  }
  ctx.restore();
}
// 第五幕远景：城堡废墟轮廓（断裂塔楼，period 360）
function drawRuinSilhouette(bx, baseY){
  ctx.beginPath();
  ctx.moveTo(bx,H); ctx.lineTo(bx,baseY+30);
  ctx.lineTo(bx+30,baseY+30); ctx.lineTo(bx+30,baseY-10);
  ctx.lineTo(bx+50,baseY-10); ctx.lineTo(bx+56,baseY+6); ctx.lineTo(bx+70,baseY-30);
  ctx.lineTo(bx+90,baseY-30); ctx.lineTo(bx+96,baseY+4); ctx.lineTo(bx+120,baseY+4);
  ctx.lineTo(bx+120,baseY-64); ctx.lineTo(bx+150,baseY-64); ctx.lineTo(bx+150,baseY+10);
  ctx.lineTo(bx+190,baseY+10); ctx.lineTo(bx+200,baseY-22); ctx.lineTo(bx+220,baseY+18);
  ctx.lineTo(bx+260,baseY+18); ctx.lineTo(bx+270,baseY-42); ctx.lineTo(bx+300,baseY-42);
  ctx.lineTo(bx+300,baseY+30); ctx.lineTo(bx+360,baseY+30); ctx.lineTo(bx+360,H);
  ctx.closePath(); ctx.fill();
}
// 第五幕中景：塌陷墙壁 + 断裂柱子（period 300）
function drawBrokenWall(bx,y){
  ctx.beginPath();
  ctx.moveTo(bx,H); ctx.lineTo(bx,y);
  ctx.lineTo(bx+40,y); ctx.lineTo(bx+48,y-30); ctx.lineTo(bx+60,y+4);
  ctx.lineTo(bx+90,y-14); ctx.lineTo(bx+96,y+10); ctx.lineTo(bx+130,y+10);
  ctx.lineTo(bx+130,H); ctx.closePath(); ctx.fill();
  const colx=bx+210;
  ctx.fillRect(colx, y-46, 16, H-(y-46));
  ctx.fillRect(colx-5, y-46, 26, 6);
  ctx.save(); ctx.translate(colx+8,y-52); ctx.rotate(0.32); ctx.fillRect(-9,-8,18,14); ctx.restore();
}
// 第五幕极远层：更矮更破的城墙轮廓（period 300）
function drawRuinedRampart(bx,y){
  ctx.beginPath(); ctx.moveTo(bx,H); ctx.lineTo(bx,y+20);
  for(let x=0;x<=300;x+=30){ const n=hnoise(((bx+x)/30|0)&255); const top=y+20-n*36-(x%60===0?18:0); ctx.lineTo(bx+x, top); if(x%60===0){ ctx.lineTo(bx+x+14, top); ctx.lineTo(bx+x+14, top+10); ctx.lineTo(bx+x+30, top+10);} }
  ctx.lineTo(bx+300,H); ctx.closePath(); ctx.fill();
}
// 第五幕远景更远处的城堡废墟剪影（比主废墟更瘦更尖，period 360）
function drawRuinSilhouetteFar(bx, baseY){
  ctx.beginPath();
  ctx.moveTo(bx,H); ctx.lineTo(bx,baseY+40);
  ctx.lineTo(bx+40,baseY+40); ctx.lineTo(bx+40,baseY-28); ctx.lineTo(bx+58,baseY-46); ctx.lineTo(bx+76,baseY-28); ctx.lineTo(bx+76,baseY+8);
  ctx.lineTo(bx+140,baseY+8); ctx.lineTo(bx+150,baseY-20); ctx.lineTo(bx+160,baseY+8);
  ctx.lineTo(bx+210,baseY+8); ctx.lineTo(bx+210,baseY-58); ctx.lineTo(bx+228,baseY-72); ctx.lineTo(bx+246,baseY-58); ctx.lineTo(bx+246,baseY+20);
  ctx.lineTo(bx+300,baseY+20); ctx.lineTo(bx+312,baseY-14); ctx.lineTo(bx+324,baseY+20);
  ctx.lineTo(bx+360,baseY+20); ctx.lineTo(bx+360,H);
  ctx.closePath(); ctx.fill();
}
// 第五幕天空：多层缓动云带（三层不同速度/高度/透明度，压迫风暴天）
function drawFinalCloudBands(){
  ctx.save();
  const doom = (typeof opheliaSaved!=='undefined') && !opheliaSaved;
  const bands=[ {y:H*0.10,h:34,sp:0.22,a:0.30,col:doom?'40,26,58':'34,40,66'},
                {y:H*0.20,h:28,sp:0.36,a:0.24,col:doom?'52,30,64':'40,48,74'},
                {y:H*0.30,h:22,sp:0.52,a:0.18,col:doom?'64,36,72':'48,56,84'} ];
  for(let bi=0;bi<bands.length;bi++){ const bd=bands[bi];
    // 每层 5 朵云，按非均匀节奏排布：两侧密集，中央焦点上方稀薄（"天光洞口"感）
    for(let c=0;c<5;c++){
      const seed=bi*97+c*53;
      // 位置：0.10 / 0.28 / 空/ 0.72 / 0.90（中央 [0.4-0.6] 留白）
      const anchors=[0.10, 0.28, 0.50, 0.72, 0.90];
      const nx=anchors[c];
      // 中央那朵变小变淡（模拟阳光从裂开的云层洒下焦点）
      const centerness = 1 - Math.min(1, Math.abs(nx-0.5)/0.5);
      const rw = (90 + (seed%5)*22) * (1 - centerness*0.55);
      const rh = bd.h * (1 - centerness*0.35);
      const alpha = bd.a * (1 - centerness*0.55);
      const drift=(frame*bd.sp + c*(W/5+40) + seed*7);
      // 云沿慢速漂移，但保持"锚位" - drift 只用作轻微游走
      const x = nx*W + Math.sin(drift*0.01)*30;
      const y = bd.y + ((seed%7)-3)*4;
      const g=ctx.createRadialGradient(x,y,4,x,y,rw);
      g.addColorStop(0,'rgba('+bd.col+','+alpha.toFixed(3)+')');
      g.addColorStop(1,'rgba('+bd.col+',0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(x,y,rw,rh,0,0,6.283); ctx.fill();
    }
  }
  // 中央焦点的一束天光（焦点色呼应，暗示光柱穿云）
  if(!doom){
    const beamX=W*0.5, beamTop=H*0.06, beamBot=H*0.42;
    const g=ctx.createLinearGradient(beamX, beamTop, beamX, beamBot);
    g.addColorStop(0,'rgba(240,220,160,0.14)');
    g.addColorStop(1,'rgba(240,220,160,0)');
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(beamX-30, beamTop); ctx.lineTo(beamX+30, beamTop);
    ctx.lineTo(beamX+80, beamBot); ctx.lineTo(beamX-80, beamBot);
    ctx.closePath(); ctx.fill();
  } else {
    // doom 版：中央为血色雾柱（悲剧氛围）
    const beamX=W*0.5, beamTop=H*0.06, beamBot=H*0.42;
    const g=ctx.createLinearGradient(beamX, beamTop, beamX, beamBot);
    g.addColorStop(0,'rgba(120,20,40,0.08)');
    g.addColorStop(1,'rgba(120,20,40,0)');
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.moveTo(beamX-40, beamTop); ctx.lineTo(beamX+40, beamTop);
    ctx.lineTo(beamX+90, beamBot); ctx.lineTo(beamX-90, beamBot);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
// 第五幕近景：断裂石柱（type 0 直立残柱 / 1 斜倒柱 / 2 柱础带断块），确定性外观
function drawBrokenColumnBg(x,y,type,i){
  ctx.save();
  const col=darkMode?'#241634':'#2c2440', edge=darkMode?'#160c22':'#1c1630';
  const h=60+hnoise(i*5)*70, w=16+hnoise(i*5+2)*8;
  if(type===1){ // 斜倒断柱
    ctx.translate(x,y); ctx.rotate(-0.5-hnoise(i)*0.3);
    ctx.fillStyle=col; ctx.fillRect(0,-w/2,h,w);
    ctx.fillStyle=edge; for(let s=1;s<4;s++) ctx.fillRect(s*h/4,-w/2,2,w);
    ctx.fillStyle=col; ctx.fillRect(-6,-w/2-4,10,w+8);
  } else if(type===2){ // 柱础 + 散落断块
    ctx.fillStyle=col; ctx.fillRect(x-w,y-10,w*2,12); ctx.fillRect(x-w*0.7,y-24,w*1.4,16);
    ctx.fillStyle=edge; ctx.fillRect(x-w,y-2,w*2,3);
    ctx.save(); ctx.translate(x+w*1.3,y-6); ctx.rotate(0.4+hnoise(i+3)); ctx.fillStyle=col; ctx.fillRect(-8,-6,16,12); ctx.restore();
  } else { // 直立残柱（顶部断裂）
    ctx.fillStyle=col; ctx.fillRect(x-w/2,y-h,w,h);
    ctx.fillStyle=edge; for(let s=1;s<5;s++) ctx.fillRect(x-w/2, y-h+s*h/5, w, 2);
    ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(x-w/2,y-h); ctx.lineTo(x-w/2+4,y-h-8+hnoise(i+1)*6); ctx.lineTo(x+2,y-h-2); ctx.lineTo(x+w/2,y-h-9+hnoise(i+2)*6); ctx.lineTo(x+w/2,y-h); ctx.closePath(); ctx.fill();
    ctx.fillStyle=darkMode?'#3a2a52':'#42385a'; ctx.fillRect(x-w/2-4,y-h+2,w+8,4);
  }
  ctx.restore();
}
// 第五幕近景：散落的破碎盔甲 / 折断武器（确定性外观）
function drawArmorDebris(x,y,i){
  ctx.save(); ctx.translate(x,y);
  const t=i%3, met=darkMode?'#4a4356':'#5a5468', dk=darkMode?'#2a2436':'#332d42';
  if(t===0){ // 破头盔
    ctx.fillStyle=met; ctx.beginPath(); ctx.arc(0,0,9,Math.PI,0); ctx.fill(); ctx.fillRect(-9,0,18,3);
    ctx.fillStyle=dk; ctx.fillRect(-2,-8,4,8);
  } else if(t===1){ // 折断的剑
    ctx.rotate(0.5+hnoise(i)*0.6); ctx.fillStyle=met; ctx.fillRect(0,-2,26,4); ctx.fillStyle=dk; ctx.fillRect(-8,-3,8,6); ctx.fillRect(-3,-6,3,12);
  } else { // 破盾
    ctx.rotate(-0.3-hnoise(i)*0.4); ctx.fillStyle=dk; ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(11,-6); ctx.lineTo(9,10); ctx.lineTo(0,16); ctx.lineTo(-9,10); ctx.lineTo(-11,-6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle=met; ctx.lineWidth=1.5; ctx.stroke();
  }
  ctx.restore();
}
// 第五幕近景地面：熔岩裂缝（脉动发光，ph3 更亮更密）
function drawLavaCrackGround(nearOff, ph3){
  ctx.save(); ctx.lineCap='round';
  const pulse=0.5+0.5*Math.sin(frame*0.1);
  const cnt=ph3?9:5;
  ctx.shadowColor='rgba(255,90,20,0.9)'; ctx.shadowBlur=(ph3?16:10)*pulse+4;
  // 熔岩裂缝：两侧密集，中央保持通道（王座通道感）
  // 左右各分一半数量，位置从边缘向中央递减但不到达焦点区
  for(let side=0;side<2;side++){
    const sign = side===0?-1:1;
    const anchorNX = side===0? 0.15 : 0.85;
    const halfCnt = Math.ceil(cnt/2);
    for(let i=0;i<halfCnt;i++){
      const spread = 0.02 + i*(0.28/halfCnt) + hnoise(i+side*17)*0.05;
      const nx = anchorNX + sign*spread;
      // 跳过中央通道 [0.42,0.58]
      if(nx>0.42 && nx<0.58) continue;
      const cx = nx*W - (nearOff%97)*0.6*sign;
      const baseY = H*0.9 + hnoise(i+2+side*7)*22;
      const g = ph3 ? (0.55+0.4*pulse) : (0.32+0.3*pulse);
      ctx.strokeStyle = 'rgba(255,'+((80+60*pulse)|0)+',26,'+g.toFixed(3)+')';
      ctx.lineWidth = (ph3?2.2:1.5)+pulse*1.6;
      ctx.beginPath(); ctx.moveTo(cx, baseY);
      // 裂缝走向偏向中央（"指向"焦点，形成隐形箭头感）
      for(let j=1;j<=5;j++){
        const jitter = (hnoise(i*7+j+side*11)-0.5)*40;
        const x = cx + jitter - sign*j*4;
        const y = baseY - j*10;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.shadowBlur=0; ctx.restore();
}
// 第五幕近景：燃烧的破旗残骸（旗杆 + 撕裂布面 + 火焰/火星）
function drawBurningFlag(x,y,t){
  ctx.save();
  ctx.strokeStyle=darkMode?'#1c1424':'#241a30'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y-58); ctx.stroke();
  // 撕裂旗面
  const sway=Math.sin(t)*5;
  ctx.fillStyle=darkMode?'rgba(90,20,28,0.9)':'rgba(110,26,34,0.9)';
  ctx.beginPath(); ctx.moveTo(x,y-56);
  ctx.lineTo(x+34+sway,y-50); ctx.lineTo(x+22,y-42); ctx.lineTo(x+36+sway,y-34);
  ctx.lineTo(x+18,y-30); ctx.lineTo(x+28+sway,y-22); ctx.lineTo(x,y-24); ctx.closePath(); ctx.fill();
  // 火焰
  for(let f=0;f<4;f++){ const fx=x+8+f*8+Math.sin(t*3+f)*3, fy=y-30-f*6; const fl=6+Math.sin(t*6+f)*3;
    const g=ctx.createRadialGradient(fx,fy,1,fx,fy,fl+4); g.addColorStop(0,'rgba(255,230,120,0.9)'); g.addColorStop(0.5,'rgba(255,90,30,0.6)'); g.addColorStop(1,'rgba(255,60,20,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(fx,fy,fl+4,0,6.283); ctx.fill(); }
  // 火星
  ctx.fillStyle='rgba(255,180,80,0.85)';
  for(let s=0;s<5;s++){ const sp=(t*40+s*30)%80; ctx.fillRect(x+10+Math.sin(t*2+s)*10, y-30-sp, 2, 2); }
  ctx.restore();
}
// 第一幕城垛上的三角旗帜（随风摆动）
function drawParapetFlag(x,y,t){
  ctx.save();
  ctx.strokeStyle='#2c2636'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y-26); ctx.stroke();
  const w=Math.sin(t)*4;
  ctx.fillStyle='#6a1e2a';
  ctx.beginPath(); ctx.moveTo(x,y-26); ctx.lineTo(x+22+w,y-21); ctx.lineTo(x,y-15); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// 第二幕中景：宫廷柱廊透视（左右各 2 根高柱）+ 墙面挂毯几何花纹
function drawCourtColonnade(){
  ctx.save();
  const off=parallaxOff(0.5,120), top=H*0.16, bot=H*0.64;
  ctx.strokeStyle='rgba(150,96,158,0.20)'; ctx.lineWidth=1;
  for(let bx=-off-120; bx<W+120; bx+=120){
    for(let yy=top; yy<bot; yy+=44){
      ctx.beginPath(); ctx.moveTo(bx+60,yy); ctx.lineTo(bx+90,yy+22); ctx.lineTo(bx+60,yy+44); ctx.lineTo(bx+30,yy+22); ctx.closePath(); ctx.stroke();
    }
  }
  [{x:52,w:34},{x:150,w:22},{x:W-52,w:34},{x:W-150,w:22}].forEach(c=>drawTallColumn(c.x,c.w));
  ctx.restore();
}
function drawTallColumn(cx,w){
  const top=H*0.08, bot=H*0.7;
  const g=ctx.createLinearGradient(cx-w/2,0,cx+w/2,0);
  g.addColorStop(0,'rgba(40,30,52,0.9)'); g.addColorStop(0.5,'rgba(74,58,92,0.9)'); g.addColorStop(1,'rgba(34,24,44,0.9)');
  ctx.fillStyle=g; ctx.fillRect(cx-w/2, top, w, bot-top);
  ctx.fillStyle='rgba(96,76,116,0.9)'; ctx.fillRect(cx-w/2-5, top, w+10, 12); ctx.fillRect(cx-w/2-6, bot-10, w+12, 12);
  ctx.strokeStyle='rgba(20,14,28,0.5)'; ctx.lineWidth=1;
  for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(cx+i*w*0.28,top+12); ctx.lineTo(cx+i*w*0.28,bot-10); ctx.stroke(); }
}
// 第三幕中景：破败电线杆
function drawPowerPole(x,y){
  ctx.fillStyle='rgba(24,16,26,0.85)';
  ctx.fillRect(x-2,y-72,4,72);
  ctx.fillRect(x-16,y-58,32,4);
  ctx.fillRect(x-12,y-48,24,3);
}
// ---- 动态特效总调度 ----
function drawActAmbientFx(){
  if(actIndex===ACT_CASTLE){ drawActGuards(); drawGhostFigure(); drawCastleReaper(); drawGroundFog(); }
  else if(actIndex===ACT_COURT){ drawWindowLight(); drawPoloniusPeek(); }
  else if(actIndex===ACT_ESCAPE){ drawEscapeCrow(); }
  else if(actIndex===ACT_ENGLAND){ drawSeagulls(); drawEnglandSplash(); drawThinRain(); }
  drawActAmbientPlus();   // 【新增】动态特效加倍层（鬼魂残影/额外守卫/乌鸦群）
}
// 第一幕：地面浓雾滚动（固定 14 团，帧驱动位置，无每帧 new）
function drawGroundFog(){
  ctx.save();
  const N=14, baseY=H*0.80;
  for(let i=0;i<N;i++){
    const speed=0.25+hnoise(i)*0.45, w=90+hnoise(i+3)*80;
    let x=((i*140 - frame*speed) % (W+240)); if(x<0)x+=W+240; x-=120;
    const y=baseY + Math.sin(frame*0.01+i)*8 + hnoise(i+7)*24;
    const a=0.05+hnoise(i+1)*0.06;
    const g=ctx.createRadialGradient(x,y,4,x,y,w);
    g.addColorStop(0,'rgba(190,196,216,'+a.toFixed(3)+')'); g.addColorStop(1,'rgba(190,196,216,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(x,y,w,w*0.4,0,0,6.283); ctx.fill();
  }
  ctx.restore();
}
// 第一幕：背景守卫剪影缓慢左右巡逻
function drawActGuards(){
  ctx.save();
  for(let i=0;i<3;i++){
    const cx=W*(0.22+i*0.28)+Math.sin(frame*0.005+i*2.1)*90;
    const dir=Math.cos(frame*0.005+i*2.1)>=0?1:-1;
    drawGuardSilhouette(cx, H*0.46, dir);
  }
  ctx.restore();
}
function drawGuardSilhouette(x,y,dir){
  ctx.save(); ctx.translate(x,y); ctx.scale(dir,1);
  ctx.fillStyle='rgba(8,8,16,0.55)';
  ctx.fillRect(-4,-26,8,26);
  ctx.beginPath(); ctx.arc(0,-30,5,0,6.283); ctx.fill();
  ctx.fillRect(-6,-34,12,4);
  const st=Math.sin(frame*0.15)*3;
  ctx.fillRect(-4,0,3,10+st); ctx.fillRect(2,0,3,10-st);
  ctx.fillRect(7,-40,2,44);
  ctx.beginPath(); ctx.moveTo(8,-40); ctx.lineTo(5,-46); ctx.lineTo(11,-46); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// 第一幕：老哈姆雷特鬼魂半透明身影（呼吸式淡入淡出 0→0.4→0）
function drawGhostFigure(){
  const a=0.2-0.2*Math.cos(frame*0.018); if(a<0.02) return;
  const x=W*0.5+Math.sin(frame*0.0035)*200, y=H*0.36+Math.sin(frame*0.02)*6;
  ctx.save(); ctx.globalAlpha=a;
  const g=ctx.createRadialGradient(x,y,4,x,y,54);
  g.addColorStop(0,'rgba(150,190,220,0.5)'); g.addColorStop(1,'rgba(150,190,220,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,54,0,6.283); ctx.fill();
  ctx.fillStyle='rgba(184,212,236,0.7)';
  ctx.beginPath(); ctx.moveTo(x,y-40); ctx.lineTo(x-14,y+42); ctx.lineTo(x+14,y+42); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(x,y-40,10,0,6.283); ctx.fill();
  ctx.fillStyle='rgba(220,200,140,0.7)';
  for(let i=-1;i<=1;i++) ctx.fillRect(x+i*7-1,y-56,3,8);
  ctx.fillRect(x-10,y-50,20,3);
  ctx.fillStyle='rgba(30,50,70,0.6)'; ctx.fillRect(x-5,y-42,3,3); ctx.fillRect(x+2,y-42,3,3);
  ctx.restore();
}
// 第一幕：偶发死神轮廓从一侧飘过（约每 70s 一次）
function drawCastleReaper(){
  const period=4200, cross=560, ph=frame%period; if(ph>=cross) return;
  const p=ph/cross, x=-80+p*(W+160), y=H*0.30+Math.sin(p*8)*22, a=Math.sin(p*Math.PI)*0.5;
  ctx.save(); ctx.globalAlpha=a; ctx.translate(x,y);
  ctx.fillStyle='rgba(4,4,10,0.9)';
  ctx.beginPath(); ctx.moveTo(0,-30); ctx.quadraticCurveTo(-20,-10,-16,46); ctx.lineTo(16,46); ctx.quadraticCurveTo(20,-10,0,-30); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(0,0,0,0.92)'; ctx.beginPath(); ctx.ellipse(0,-18,7,10,0,0,6.283); ctx.fill();
  ctx.strokeStyle='rgba(4,4,10,0.9)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(18,-42); ctx.lineTo(18,48); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(18,-42); ctx.quadraticCurveTo(-2,-54,-14,-42); ctx.stroke();
  ctx.restore();
}
// 第二幕：宫廷窗格光影在地面缓慢移动
function drawWindowLight(){
  ctx.save();
  for(let i=0;i<3;i++){
    const x=((frame*0.25 + i*260) % (W+260)) - 130;
    ctx.fillStyle='rgba(220,214,255,0.05)';
    ctx.beginPath(); ctx.moveTo(x,H*0.55); ctx.lineTo(x+70,H*0.55); ctx.lineTo(x+120,H); ctx.lineTo(x+50,H); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(40,30,52,0.06)'; ctx.fillRect(x+34,H*0.55,4,H*0.45);
  }
  ctx.restore();
}
// 第二幕：波洛涅斯剪影在右侧帷幕后偷窥（缓慢探出缩回，位于帷幕遮挡层之下）
function drawPoloniusPeek(){
  const emerge=clamp(Math.sin(frame*0.006),0,1); if(emerge<=0.02) return;
  const bx=W-40-emerge*30, by=H*0.42;
  ctx.save(); ctx.globalAlpha=0.5; ctx.fillStyle='rgba(20,10,26,0.85)';
  ctx.beginPath(); ctx.arc(bx,by,9,0,6.283); ctx.fill();
  ctx.fillRect(bx-4,by+9,18,42);
  ctx.fillStyle='rgba(180,180,190,0.5)';
  ctx.beginPath(); ctx.moveTo(bx-6,by+2); ctx.lineTo(bx+2,by+16); ctx.lineTo(bx+6,by+2); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// 第三幕：偶发乌鸦剪影从左到右快速掠过（约每 37s 一次）
function drawEscapeCrow(){
  const period=2200, cross=180, ph=frame%period; if(ph>=cross) return;
  const p=ph/cross, x=-40+p*(W+80), y=H*0.22+Math.sin(p*10)*30, fl=Math.sin(frame*0.5)*6;
  ctx.save(); ctx.strokeStyle='rgba(6,6,12,0.85)'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(x-9,y-fl); ctx.lineTo(x,y); ctx.lineTo(x+9,y-fl); ctx.stroke();
  ctx.restore();
}
// 第四幕：海鸥剪影 V 形飞过
function drawSeagulls(){
  const period=1600, cross=520, ph=frame%period; if(ph>=cross) return;
  const p=ph/cross, bx=-60+p*(W+120), by=H*0.20+Math.sin(p*4)*14, fl=Math.sin(frame*0.3)*4;
  ctx.save(); ctx.strokeStyle='rgba(220,225,235,0.5)'; ctx.lineWidth=1.6;
  [[0,0],[-16,10],[16,10],[-32,20],[32,20]].forEach(([dx,dy])=>{ const x=bx+dx,y=by+dy;
    ctx.beginPath(); ctx.moveTo(x-6,y+fl*0.5); ctx.quadraticCurveTo(x,y-3,x,y); ctx.quadraticCurveTo(x,y-3,x+6,y+fl*0.5); ctx.stroke(); });
  ctx.restore();
}
// 第四幕：海浪拍打浪花溅起（白色粒子弧线，帧驱动无 new）
function drawEnglandSplash(){
  const horizon=H*0.66; ctx.save(); ctx.strokeStyle='rgba(220,240,255,0.4)'; ctx.lineWidth=1.4;
  for(let i=0;i<6;i++){
    const ph=(frame*0.05+i*1.3)%6.283, s=Math.sin(ph); if(s<0.4) continue;
    let x=((i*180 - (camX*0.5)) % (W+180)); x=((x%(W+180))+(W+180))%(W+180)-90;
    const y=horizon+18+Math.sin(i)*10, h=10+s*16;
    for(let d=-2;d<=2;d++){ ctx.beginPath(); ctx.moveTo(x,y); ctx.quadraticCurveTo(x+d*6,y-h,x+d*12,y-h*0.3); ctx.stroke(); }
  }
  ctx.restore();
}
// 第四幕：风雨斜线（细）
function drawThinRain(){
  ctx.save(); ctx.strokeStyle='rgba(180,200,225,0.14)'; ctx.lineWidth=1;
  for(let i=0;i<50;i++){ const seed=i*53; const x=((seed*17)%W + frame*3)%W; const y=((seed*29)%H + frame*7)%H;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-3,y+12); ctx.stroke(); }
  ctx.restore();
}

/* =========================================================================
   【新增·叠加层】一二三幕视觉加倍 + 地图结构装饰（全部为叠加，不改动原绘制）
   - draw*Plus：屏幕空间/视差绘制，挂在原有分层函数末尾，不参与碰撞与主线逻辑
   - drawStructureDecor：世界空间，绘制新增地图结构（城垛多层/登塔/迷宫）的装饰
   ========================================================================= */
// —— 远景加倍：第一幕第二圈外城墙；第三幕远景三层山脊 ——
function drawFarFxPlus(){
  if(actIndex===ACT_CASTLE){
    // 城堡远景：不再均匀 300 像素填 tile 城墙，改为"焦点主塔 + 逐级衰减副塔"
    // 主塔位于右2/3焦点，副塔沿两侧递减，形成层次分明的天际线
    const off=parallaxOff(0.14, W); ctx.save();
    ctx.fillStyle=darkMode?'#0b0712':'#141a30';
    // 底部一条稀薄的远景城墙基线（薄，不喧宾夺主）
    const wallTop=H*0.32;
    ctx.fillRect(0, wallTop, W, H*0.03);
    // 焦点主塔（右2/3锚）
    const towers=[
      {x:W*0.666, hg:130, w:56, cren:5}, // 主塔（焦点，最高最阔）
      {x:W*0.32,  hg:88,  w:38, cren:4}, // 左副塔（次焦）
      {x:W*0.14,  hg:56,  w:26, cren:3}, // 左远塔（递减）
      {x:W*0.86,  hg:70,  w:30, cren:3}, // 右远塔（对称递减）
      {x:W*0.50,  hg:36,  w:22, cren:2}  // 中央矮塔（谷底填充）
    ];
    for(const t of towers){
      const tx = t.x - (off*(t.hg/130))%W*0.001; // 主塔视差略慢
      // 塔身
      ctx.fillRect(tx - t.w/2, wallTop - t.hg + wallTop*0, wallTop - (wallTop - t.hg), 0); // 无操作占位
      ctx.fillRect(tx - t.w/2, wallTop - t.hg, t.w, t.hg + H*0.02);
      // 齿垛
      for(let m=0;m<t.cren;m++){
        if(m%2===0) ctx.fillRect(tx - t.w/2 + m*(t.w/t.cren), wallTop - t.hg - 8, t.w/t.cren*0.7, 8);
      }
      // 焦点主塔顶部小尖顶（画龙点睛）
      if(t.hg>=100){
        ctx.beginPath();
        ctx.moveTo(tx - t.w*0.3, wallTop - t.hg - 8);
        ctx.lineTo(tx, wallTop - t.hg - 24);
        ctx.lineTo(tx + t.w*0.3, wallTop - t.hg - 8);
        ctx.closePath(); ctx.fill();
      }
    }
    // 主塔窗光（焦点色呼应）
    ctx.fillStyle = compAccent(ACT_CASTLE);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(W*0.666 - 3, wallTop - 90, 6, 6);
    ctx.fillRect(W*0.666 - 3, wallTop - 60, 6, 5);
    ctx.globalAlpha = 1;
    ctx.restore();
  } else if(actIndex===ACT_ESCAPE){
    // 逃亡远景：主峰放在左1/3焦点，副峰递减向右延伸（构图有"引导"）
    ctx.save();
    // 极远层：单一大主峰 + 2 座副峰（不再全屏波浪填满）
    const peaks=[
      {cx:0.33, h:110, col:darkMode?'#0d0914':'#130d1b', par:0.08}, // 焦点主峰
      {cx:0.62, h:78,  col:darkMode?'#0f0b16':'#150f1d', par:0.10}, // 次峰
      {cx:0.88, h:56,  col:darkMode?'#110b18':'#17101f', par:0.11}  // 远端小峰
    ];
    for(const p of peaks){
      const off=parallaxOff(p.par, W*2);
      ctx.fillStyle=p.col;
      const cx=p.cx*W - off*0.5;
      const baseY=H*0.5;
      ctx.beginPath();
      ctx.moveTo(cx - p.h*1.2, H);
      ctx.lineTo(cx - p.h*1.2, baseY);
      // 主峰折线
      for(let x=-1;x<=1;x+=0.05){
        const px=cx + x*p.h*1.2;
        const py=baseY - (1 - Math.abs(x)) * p.h + hnoise((px/10)|0) * 8;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(cx + p.h*1.2, H);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}
// —— 中景加倍：第一幕加旗帜/城垛；第二幕加柱廊；第三幕加电线杆+枯树中层 ——
function drawMidFxPlus(){
  ctx.save();
  if(actIndex===ACT_CASTLE){
    // 城堡中景：不再 tile 4 面同尺寸旗，改为"焦点大旗 + 两侧对称小旗"（三分法）
    const off=parallaxOff(0.5, W*2);
    const flags=[
      {cx:0.333, c:'#7a2230', h:56, w:1.3, par:0.32},  // 左1/3焦点大王旗
      {cx:0.666, c:'#2a4a7a', h:52, w:1.2, par:0.34},  // 右2/3副旗
      {cx:0.14,  c:'#5a2a5a', h:32, w:0.8, par:0.30},  // 左远小旗
      {cx:0.86,  c:'#6a5a20', h:30, w:0.8, par:0.30}   // 右远小旗
    ];
    for(const f of flags){
      const fx = f.cx*W - off*f.par*0.02;
      ctx.save(); ctx.translate(fx, H*0.30); ctx.scale(f.w, 1);
      drawMidBanner(0, 0, f.c, f.h);
      ctx.restore();
    }
  } else if(actIndex===ACT_COURT){
    // 宫廷中景：柱廊改为"透视汇聚"——柱子间距逐渐收窄，把视线导向中心王座
    // 左3根+右3根，越靠近中心越窄；柱高逐渐降低（伪透视）
    const off=parallaxOff(0.5, W*2);
    const cols=[
      {cx:0.06,  h:H*0.42, w:1.0},
      {cx:0.20,  h:H*0.38, w:0.90},
      {cx:0.36,  h:H*0.34, w:0.80},
      {cx:0.64,  h:H*0.34, w:0.80},  // 右侧镜像
      {cx:0.80,  h:H*0.38, w:0.90},
      {cx:0.94,  h:H*0.42, w:1.0}
    ];
    cols.forEach((c,i)=>{
      const cx = c.cx*W - off*0.02;
      ctx.save(); ctx.translate(cx, H*0.24); ctx.scale(c.w, 1);
      drawMidPillar(0, 0, c.h, i);
      ctx.restore();
    });
  } else if(actIndex===ACT_ESCAPE){
    // 逃亡中景：电线杆沿逃亡路线延伸——远端多、近端稀（暗示"距离越拉越远"）
    const off=parallaxOff(0.5, W*2);
    // 4 根电线杆按黄金分割距离排列，非等距
    const poles=[0.12, 0.30, 0.55, 0.86];
    poles.forEach((tx,i)=>{
      const px = tx*W - off*0.02;
      const py = H*0.58 + i*4; // 越近略低（伪透视）
      drawMidPole(px, py);
    });
    // 电线连续贯穿（画一条从左到右的完整电线，随风摆动，形成引导线）
    ctx.strokeStyle='rgba(20,16,24,0.55)'; ctx.lineWidth=1;
    ctx.beginPath();
    let prev=null;
    poles.forEach((tx,i)=>{
      const px=tx*W - off*0.02;
      const py=(H*0.58+i*4)-58 + Math.sin(frame*0.02+i)*4;
      if(!prev){ ctx.moveTo(px, py); }
      else { ctx.quadraticCurveTo((prev[0]+px)/2, (prev[1]+py)/2 + 8, px, py); }
      prev=[px,py];
    });
    ctx.stroke();
    // 中层枯树：两侧对称各 1 棵（框景）
    drawMidDeadTree(W*0.08 - off*0.02, H*0.62, 0.9);
    drawMidDeadTree(W*0.92 - off*0.02, H*0.60, 1.05);
  }
  ctx.restore();
}
function drawMidBanner(x,y,c,h){
  const w=Math.sin(frame*0.05+x)*3;
  ctx.fillStyle='#2a2a30'; ctx.fillRect(x-1,y-8,3,10);
  ctx.fillStyle=c; ctx.beginPath(); ctx.moveTo(x-7,y); ctx.lineTo(x+7,y);
  ctx.lineTo(x+7+w,y+h); ctx.lineTo(x,y+h-6); ctx.lineTo(x-7+w,y+h); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(0,0,0,0.18)'; ctx.fillRect(x-1,y,2,h-4);
}
function drawMidPillar(x,yTop,h,i){
  ctx.fillStyle=darkMode?'#1c1626':'#3a3052'; ctx.fillRect(x-8,yTop,16,h);
  ctx.fillStyle=darkMode?'#2a2038':'#4a4068'; ctx.fillRect(x-11,yTop-6,22,7); ctx.fillRect(x-11,yTop+h-2,22,7);
  ctx.strokeStyle='rgba(216,184,240,0.18)'; ctx.lineWidth=1;
  for(let s=1;s<5;s++){ const fx=x-5+ (i%2? Math.sin(s)*1.5:0); ctx.beginPath(); ctx.moveTo(fx,yTop+4); ctx.lineTo(fx,yTop+h-4); ctx.stroke(); }
}
function drawMidPole(x,yBase){
  ctx.strokeStyle=darkMode?'#141018':'#1a141f'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(x,yBase); ctx.lineTo(x,yBase-70); ctx.stroke();
  ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x-12,yBase-60); ctx.lineTo(x+12,yBase-60); ctx.stroke();
  ctx.strokeStyle='rgba(20,16,24,0.5)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(x+12,yBase-58); ctx.quadraticCurveTo(x+60,yBase-46,x+108,yBase-58); ctx.stroke();
}
function drawMidDeadTree(x,yBase,s){
  ctx.save(); ctx.translate(x,yBase); ctx.scale(s,s); ctx.strokeStyle=darkMode?'rgba(18,14,22,0.75)':'rgba(24,18,28,0.7)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-56);
  ctx.moveTo(0,-34); ctx.lineTo(-18,-52); ctx.moveTo(0,-40); ctx.lineTo(16,-58); ctx.moveTo(0,-48); ctx.lineTo(-10,-66); ctx.stroke();
  ctx.restore();
}
// —— 近景装饰加倍：第一幕砖缝/水坑/破石柱/火把；第二幕地毯/烛台/吊灯；第三幕落叶/花瓣 ——
function drawSceneDecoPlus(){
  const nOff=parallaxOff(0.8,W);
  if(actIndex===ACT_CASTLE){
    // 前景城垛砖缝纹理带（保留：地面砖纹是"底"，需要覆盖整个宽度）
    ctx.save(); const by=H-46;
    for(let x=-((camX*0.9)%64); x<W; x+=64){ for(let r=0;r<2;r++){ const yy=by+r*22;
      ctx.fillStyle=(Math.floor(x/64)+r)%2? '#33313c':'#3c3a46'; ctx.fillRect(x,yy,64,22);
      ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1; ctx.strokeRect(x+0.5,yy+0.5,64,22); } }
    ctx.restore();
    // 水坑：2 处三分法（呼应主塔倒影）
    [ [W*0.28,'#2a3550'], [W*0.72,'#243048'] ].forEach((p,i)=>{
      const px=(p[0]-(camX*0.9)%W+W)%W;
      drawPuddle(px, H*0.9, 78, p[1], i);
    });
    // 前景破碎石柱：只保留 2 根作为"两侧框景"（原 3 根等距 → 2 根边缘）
    [ [W*0.06,72],[W*0.94,64] ].forEach(c=>{
      const px=(c[0]-(camX*0.85)%W+W)%W;
      drawBrokenColumn(px, H*0.86, c[1]);
    });
    // 场景火把：仅左右两端各 1 支（引路灯感），中间留白
    drawSceneTorch(W*0.08 - (camX*0.85)%W*0.001, H*0.72, true);
    drawSceneTorch(W*0.92 - (camX*0.85)%W*0.001, H*0.72, true);
  } else if(actIndex===ACT_COURT){
    // 几何纹路地毯——中央菱形金纹作为"中轴引导"，边缘素色
    ctx.save(); const cy=H-30;
    for(let x=-((camX*0.9)%80); x<W; x+=80){
      const centerness = 1 - Math.min(1, Math.abs((x+40) - W/2) / (W*0.4));
      ctx.fillStyle=(Math.floor(x/80)%2)?'#5a1e28':'#6a2430';
      ctx.fillRect(x,cy,80,30);
      // 中央菱形加金
      if(centerness > 0.2){
        ctx.strokeStyle='rgba(232,194,90,'+(0.35+centerness*0.5).toFixed(2)+')';
        ctx.lineWidth=2; ctx.strokeRect(x+6,cy+5,68,20);
        ctx.beginPath(); ctx.moveTo(x+40,cy+5); ctx.lineTo(x+52,cy+15);
        ctx.lineTo(x+40,cy+25); ctx.lineTo(x+28,cy+15); ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();
    // 场景烛台：3 处，中央 1 个高，两侧对称——朝王座聚拢
    const candlesX=[W*0.24, W*0.5, W*0.76];
    candlesX.forEach((cx,i)=>{
      const px=(cx-(camX*0.85)%W+W)%W;
      drawSceneCandle(px, i===1? H*0.62 : H*0.66, i);
    });
    // 中央吊灯（金色焦点色呼应）
    drawChandelier(W*0.5, H*0.14);
  } else if(actIndex===ACT_ESCAPE){
    // 落叶：从右上到左下的斜向"风向"分布（不再全屏 26 片均匀）
    // 12 片落叶沿一条隐形斜线漂移，营造风向感
    ctx.save();
    for(let i=0;i<12;i++){
      const t=i/12;
      // 落叶从右上飘到左下，形成对角引导线
      const baseX = W*(0.95 - t*0.9);
      const baseY = H*(0.55 + t*0.4);
      const wobble = Math.sin(frame*0.03+i)*10;
      const x = ((baseX + frame*0.4) - (camX*0.9)%W + W)%W;
      const y = baseY + wobble;
      const rot=frame*0.02+i*1.7;
      ctx.save(); ctx.translate(x,y); ctx.rotate(rot);
      ctx.fillStyle=(i%2)?'#8a5a2a':'#a8862e'; ctx.fillRect(-3,-2,6,4);
      ctx.restore();
    }
    ctx.restore();
    // 花瓣：奥菲莉亚气息—— 集中在右上到左下的空气流场（不再全屏均匀）
    for(let i=0;i<12;i++){
      const seed=i*57;
      const cols=['#ffd0e6','#ffffff','#e0c8ff'];
      const t=(i+frame*0.001)%1;
      const x=((0.15 + t*0.7)*W + Math.sin(frame*0.02+seed)*40)%W;
      const y=((0.15 + t*0.5)*H + Math.cos(frame*0.03+seed)*30)%H;
      ctx.save(); ctx.globalAlpha=0.55+Math.sin(frame*0.03+seed)*0.2;
      ctx.fillStyle=cols[seed%3]; ctx.translate(x,y); ctx.rotate(frame*0.02+seed);
      ctx.beginPath(); ctx.ellipse(0,0,4,2.2,0,0,6.283); ctx.fill(); ctx.restore();
    }
  }
}
function drawPuddle(x,y,w,col,seed){
  ctx.save(); const g=ctx.createLinearGradient(x,y-6,x,y+8); g.addColorStop(0,'rgba(150,180,220,0.35)'); g.addColorStop(1,col);
  ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(x,y,w,9,0,0,6.283); ctx.fill();
  ctx.strokeStyle='rgba(190,210,235,0.35)'; ctx.lineWidth=1;
  for(let r=0;r<3;r++){ const rr=((frame*0.6+seed*30+r*20)% (w)); ctx.globalAlpha=1-rr/w; ctx.beginPath(); ctx.ellipse(x,y,rr,rr*0.13,0,0,6.283); ctx.stroke(); }
  ctx.restore(); ctx.globalAlpha=1;
}
function drawBrokenColumn(x,yBase,h){
  ctx.save(); ctx.fillStyle=darkMode?'#241c2e':'#4a4658'; ctx.fillRect(x-11,yBase-h,22,h);
  ctx.fillStyle=darkMode?'#180f1f':'#3a3648'; ctx.beginPath(); ctx.moveTo(x-11,yBase-h); ctx.lineTo(x+11,yBase-h); ctx.lineTo(x+6,yBase-h-9); ctx.lineTo(x-6,yBase-h-4); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1; for(let s=1;s<4;s++){ ctx.beginPath(); ctx.moveTo(x-6,yBase-h*s/4); ctx.lineTo(x+6,yBase-h*s/4); ctx.stroke(); }
  ctx.fillStyle=darkMode?'#4a4658':'#5a5668'; ctx.fillRect(x-14,yBase-6,28,6);
  ctx.restore();
}
function drawSceneTorch(x,y,lit){
  ctx.save(); ctx.strokeStyle='#3a2a1a'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y+26); ctx.stroke();
  ctx.fillStyle='#2a1a10'; ctx.beginPath(); ctx.arc(x,y,4,0,6.283); ctx.fill();
  if(lit){ const fl=Math.sin(frame*0.3+x)*2; const g=ctx.createRadialGradient(x,y-6,1,x,y-6,18+fl); g.addColorStop(0,'rgba(255,220,120,0.9)'); g.addColorStop(0.5,'rgba(255,150,40,0.5)'); g.addColorStop(1,'rgba(255,120,20,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y-6,18+fl,0,6.283); ctx.fill();
    ctx.fillStyle='#ffd45a'; ctx.beginPath(); ctx.moveTo(x,y-16-fl); ctx.quadraticCurveTo(x+5,y-6,x,y-2); ctx.quadraticCurveTo(x-5,y-6,x,y-16-fl); ctx.fill();
  } else { ctx.fillStyle='#3a2f26'; ctx.beginPath(); ctx.arc(x,y-6,4,0,6.283); ctx.fill();
    ctx.strokeStyle='rgba(120,120,130,0.35)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,y-10); ctx.lineTo(x-2,y-18); ctx.moveTo(x,y-10); ctx.lineTo(x+2,y-20); ctx.stroke(); }
  ctx.restore();
}
function drawSceneCandle(x,y,i){
  ctx.save(); ctx.fillStyle='#8a7a5a'; ctx.fillRect(x-2,y,4,16); ctx.fillStyle='#c7b58e'; ctx.fillRect(x-5,y+16,10,3);
  const b=0.6+0.4*Math.abs(Math.sin(frame*0.2+i)); const g=ctx.createRadialGradient(x,y-4,1,x,y-4,12); g.addColorStop(0,'rgba(255,230,150,'+b+')'); g.addColorStop(1,'rgba(255,180,60,0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y-4,12,0,6.283); ctx.fill();
  ctx.fillStyle='#ffe28a'; ctx.beginPath(); ctx.ellipse(x,y-4,2,4,0,0,6.283); ctx.fill(); ctx.restore();
}
function drawChandelier(x,y){
  ctx.save(); ctx.strokeStyle='#8a7a3a'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,y); ctx.stroke();
  ctx.fillStyle='#b89a3a'; ctx.beginPath(); ctx.ellipse(x,y,30,10,0,0,6.283); ctx.fill();
  for(let a=0;a<6;a++){ const ax=x+Math.cos(a/6*6.283)*30, ay=y+Math.sin(a/6*6.283)*8; const b=0.55+0.35*Math.abs(Math.sin(frame*0.18+a));
    const g=ctx.createRadialGradient(ax,ay-6,1,ax,ay-6,14); g.addColorStop(0,'rgba(255,225,140,'+b+')'); g.addColorStop(1,'rgba(255,180,60,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(ax,ay-6,14,0,6.283); ctx.fill();
    ctx.fillStyle='#ffe08a'; ctx.beginPath(); ctx.ellipse(ax,ay-6,2,4,0,0,6.283); ctx.fill(); }
  ctx.restore();
}
// —— 动态 FX 加倍：第一幕鬼魂三重残影+额外守卫；第三幕 V 形乌鸦+月穿云 ——
function drawActAmbientPlus(){
  if(actIndex===ACT_CASTLE){
    drawGhostAfterimages();
    drawExtraGuards();
  } else if(actIndex===ACT_ESCAPE){
    drawCrowFlock();
  }
}
function drawGhostAfterimages(){
  // 在原有鬼魂之外叠加 2 层时间差残影（共 3 层视觉）
  ctx.save();
  for(let k=1;k<=2;k++){ const ph=frame*0.02 - k*0.5; const gx=W*0.5 + Math.sin(ph)*160 - (camX*0.3)%W; const gy=H*0.4 + Math.cos(ph*0.7)*30;
    ctx.globalAlpha=0.12/k; ctx.fillStyle='#bfe0ff';
    ctx.beginPath(); ctx.ellipse(gx,gy,14,26,0,0,6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(gx,gy-24,9,0,6.283); ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha=1;
}
function drawExtraGuards(){
  // 额外一组高处巡逻守卫剪影（不同高度/路线）
  ctx.save(); ctx.fillStyle='rgba(10,10,16,0.5)';
  const routes=[{y:H*0.5,spd:0.4,sp:0},{y:H*0.62,spd:-0.3,sp:2.1},{y:H*0.44,spd:0.25,sp:4.2}];
  for(const r of routes){ const gx=((frame*r.spd+r.sp*120)%W+W)%W; ctx.save(); ctx.translate(gx,r.y);
    ctx.fillRect(-4,-22,8,22); ctx.beginPath(); ctx.arc(0,-26,5,0,6.283); ctx.fill(); ctx.fillRect(4,-18,10,2); ctx.restore(); }
  ctx.restore();
}
function drawCrowFlock(){
  // 3 只乌鸦 V 形飞过（周期性横穿）
  ctx.save(); ctx.fillStyle=darkMode?'#0a0810':'#100c16';
  const base=((frame*1.1)% (W+240))-120; const wing=Math.sin(frame*0.35)*5;
  const set=[{dx:0,dy:0},{dx:-22,dy:-14},{dx:-22,dy:14}];
  for(const c of set){ const cx=base+c.dx, cy=H*0.22+c.dy+Math.sin(frame*0.02+c.dx)*8;
    ctx.beginPath(); ctx.moveTo(cx-8,cy); ctx.quadraticCurveTo(cx,cy-6-wing,cx,cy); ctx.quadraticCurveTo(cx+8,cy-6-wing,cx+8,cy); ctx.quadraticCurveTo(cx,cy+2,cx-8,cy); ctx.fill(); }
  ctx.restore();
}
// —— 世界空间：新增地图结构（城垛多层/登塔/迷宫）的装饰绘制 ——
function drawStructureDecor(){
  if(!level || !level._decor) return;
  for(const d of level._decor){
    if(d.x < camX-120 || d.x > camX+W+120) continue;
    switch(d.type){
      case 'merlon': ctx.fillStyle='#4a4658'; for(let m=0;m<4;m++){ ctx.fillRect(d.x+m*22, d.y-10, 12, 10); } break;
      case 'brokencol': drawBrokenColumn(d.x, d.y, d.h||40); break;
      case 'torch': drawSceneTorch(d.x, d.y, d.lit!==false); break;
      case 'painting': ctx.fillStyle='#3a2a1a'; ctx.fillRect(d.x-2,d.y-2,28,36); ctx.fillStyle='#7a5a3a'; ctx.fillRect(d.x,d.y,24,32); ctx.fillStyle='#caa25a'; ctx.fillRect(d.x+4,d.y+4,16,10); break;
      case 'carpet': ctx.fillStyle='#5a1e28'; ctx.fillRect(d.x,d.y,d.w||90,6); ctx.strokeStyle='rgba(232,194,90,0.6)'; ctx.lineWidth=1; ctx.strokeRect(d.x+3,d.y+1,(d.w||90)-6,4); break;
      case 'bookshelf': ctx.fillStyle='#3a2818'; ctx.fillRect(d.x,d.y-34,30,34); for(let r=0;r<3;r++){ for(let b=0;b<5;b++){ ctx.fillStyle=['#7a3a3a','#3a5a7a','#6a6a3a'][(r+b)%3]; ctx.fillRect(d.x+3+b*5,d.y-32+r*11,4,9); } } break;
      case 'candlerow': for(let c=0;c<3;c++) drawSceneCandle(d.x+c*12, d.y, c); break;
      case 'curtain': ctx.fillStyle=darkMode?'#2a1420':'#6a2440'; for(let f=0;f<4;f++){ const sw=Math.sin(frame*0.05+f)*2; ctx.beginPath(); ctx.moveTo(d.x+f*9,d.y); ctx.quadraticCurveTo(d.x+f*9+4+sw,d.y+22,d.x+f*9,d.y+44); ctx.lineTo(d.x+f*9+9,d.y+44); ctx.quadraticCurveTo(d.x+f*9+5+sw,d.y+22,d.x+f*9+9,d.y); ctx.closePath(); ctx.fill(); } break;
      case 'weaponrack': ctx.strokeStyle='#5a4a2a'; ctx.lineWidth=2; ctx.strokeRect(d.x,d.y-30,26,30); ctx.strokeStyle='#aab'; for(let s=0;s<3;s++){ ctx.beginPath(); ctx.moveTo(d.x+5+s*8,d.y-2); ctx.lineTo(d.x+5+s*8,d.y-28); ctx.stroke(); } break;
      case 'window': { const g=ctx.createLinearGradient(d.x,d.y-34,d.x,d.y); g.addColorStop(0,'rgba(120,150,210,0.55)'); g.addColorStop(1,'rgba(40,50,90,0.2)'); ctx.fillStyle=g; ctx.fillRect(d.x,d.y-34,30,34); ctx.strokeStyle='#2a2030'; ctx.lineWidth=2; ctx.strokeRect(d.x,d.y-34,30,34); ctx.beginPath(); ctx.moveTo(d.x+15,d.y-34); ctx.lineTo(d.x+15,d.y); ctx.moveTo(d.x,d.y-17); ctx.lineTo(d.x+30,d.y-17); ctx.stroke(); } break;
      case 'forkmark': ctx.strokeStyle='#c8b070'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x,d.y-24); ctx.lineTo(d.x-10,d.y-30); ctx.moveTo(d.x,d.y-24); ctx.lineTo(d.x+10,d.y-30); ctx.stroke(); ctx.fillStyle='rgba(200,176,112,0.9)'; ctx.font='9px sans-serif'; ctx.fillText('岔路', d.x-9, d.y-34); break;
      case 'vine': ctx.strokeStyle='rgba(80,130,70,0.7)'; ctx.lineWidth=2; for(let v=0;v<5;v++){ const vx=d.x+v*10; ctx.beginPath(); ctx.moveTo(vx,d.y-70); for(let s=0;s<7;s++){ ctx.lineTo(vx+Math.sin(frame*0.02+s+v)*4, d.y-70+s*11); } ctx.stroke(); ctx.fillStyle='rgba(90,150,80,0.6)'; ctx.beginPath(); ctx.ellipse(vx+3,d.y-30,3,5,0.6,0,6.283); ctx.fill(); } break;
      case 'rubble': ctx.fillStyle=darkMode?'#241c2e':'#3a3040'; ctx.fillRect(d.x,d.y-40,20,40); for(let s=0;s<6;s++){ ctx.fillStyle=(s%2)?'#4a4050':'#2f2838'; ctx.fillRect(d.x-6+ (s%3)*9, d.y-6+ (s%2)*6, 8, 6); } ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.strokeRect(d.x+0.5,d.y-40.5,20,40); break;
      case 'abyss': { const g=ctx.createLinearGradient(d.x,d.y,d.x,d.y+90); g.addColorStop(0,'rgba(0,0,0,0.0)'); g.addColorStop(1,'rgba(0,0,0,0.75)'); ctx.fillStyle=g; ctx.fillRect(d.x-40,d.y,120,90); ctx.strokeStyle='rgba(80,70,90,0.5)'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(d.x-40,d.y+2); ctx.lineTo(d.x+80,d.y+2); ctx.stroke(); } break;
      case 'opheliahint': { const vis=Math.sin(frame*0.012+d.ph); if(vis>0.5){ ctx.save(); ctx.globalAlpha=(vis-0.5)*2*0.55; ctx.fillStyle='#e8d0f0'; ctx.beginPath(); ctx.ellipse(d.x,d.y,8,20,0,0,6.283); ctx.fill(); ctx.beginPath(); ctx.arc(d.x,d.y-22,6,0,6.283); ctx.fill(); ctx.fillStyle='rgba(255,150,190,0.5)'; ctx.fillRect(d.x-8,d.y-4,16,18); ctx.restore(); ctx.globalAlpha=1; } } break;
    }
  }
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
  ctx.fillRect(bx,base-8,260,4);
}
function silhouetteThroneHall(bx, groundH){
  const base=groundH*0.56, dome=base-84;
  ctx.beginPath(); ctx.moveTo(bx,groundH); ctx.lineTo(bx,base+20);
  ctx.quadraticCurveTo(bx+80,dome,bx+160,base+20);
  ctx.lineTo(bx+160,groundH); ctx.closePath(); ctx.fill();
  for(let i=0;i<4;i++){ const px=bx+190+i*34; ctx.fillRect(px,base-20,18,groundH-base+20); ctx.fillRect(px-4,base-28,26,8); }
}
// 逃亡：枯树林轮廓与逃亡剪影
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
  { name:'第三幕 · 疯狂的恋人', en:'ACT III — The Mad Lovers', music:'escape',
    theme:{ sky:['#20182a','#181020','#0a0610'], far:'#17121f', mid:'#2a2038', moon:true, fog:0.10,
      drawFar:(bx,gh)=>silhouetteDeadTrees(bx,gh), drawMid:(bx,gh)=>silhouetteDeadTrees(bx+50,gh) },
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
   黑色现代军装战服、暗扣领口、肩章、修身；深色微卷凌乱头发；
   高颧骨深眼窝、眉头微锁、锐利忧郁眼神；站姿略前倾富戏剧张力。
   act:0..4  stage 决定服装/面部/磨损/色彩；pose 决定姿态帧
   ------------------------------------------------------------------------- */
function hamletStyle(act){
  // 依据幕数返回造型参数（每幕色调与细节标志明显区分）
  const S = {
    coat:'#141018', coatHi:'#2a2236', coatShadow:'#0a070d', trim:'#3a3348',
    epaulet:'#8a7a4a', hair:'#241c18', skin:'#c9a98c', skinShade:'#a3805f',
    eye:'#e8dcc0', accent:'#e8c25a', wear:0, wet:false, gold:false, doom:false, cape:false,
    court:false, torn:false, naval:false, hairHi:null, tense:0
  };
  // 第一幕 城堡：基础黑色简洁战服，偏灰冷调
  if(act===ACT_CASTLE){ S.coat='#14141c'; S.coatHi='#2c3040'; S.coatShadow='#0a0a10'; S.trim='#33384a'; S.epaulet='#7e7c6a'; S.skin='#c2a488'; }
  // 第二幕 宫廷：宫廷外套细节 + 金色纽扣，颜色稍暖，头发有纹理
  if(act===ACT_COURT){ S.coat='#1c1424'; S.coatHi='#3a2c42'; S.trim='#5a4462'; S.epaulet='#b09a52'; S.skin='#d2b190'; S.skinShade='#a8825e'; S.hair='#2a1e16'; S.hairHi='#4a3420'; S.eye='#f0e4c8'; S.court=true; }
  // 第三幕 逃亡：战服破损，灰尘泥土，表情紧绷
  if(act===ACT_ESCAPE){ S.coat='#131019'; S.coatHi='#241d2c'; S.trim='#42364e'; S.epaulet='#8a7c5a'; S.hair='#1c1512'; S.skin='#b89a7c'; S.skinShade='#8a6a4c'; S.eye='#ede0c4'; S.wear=2; S.torn=true; S.tense=1; }
  if(act===ACT_LAKE){ S.coat='#0e0a16'; S.wear=2; S.wet=true; S.coatHi='#241c30'; S.cape=true; }
  // 第四幕 英格兰：航海风斗篷（深蓝外层），整体蓝灰，风尘仆仆
  if(act===ACT_ENGLAND){
    S.wear=2; S.naval=true; S.tense=1;
    S.coat='#16222e'; S.coatHi='#25404e'; S.coatShadow='#0a141c'; S.trim='#3a6a72'; S.epaulet='#7a9aa0'; S.accent='#7fe0c8'; S.eye='#e8f0e0'; S.skin='#bfa588'; S.skinShade='#8c6f52';
  }
  // 第五幕 最终决战：成功=金色明亮 / 失败=暗紫破损
  if(act===ACT_FINAL){
    S.cape=true; S.wear=2;
    if(opheliaSaved && !darkMode){ S.gold=true; S.coat='#1c1226'; S.trim='#c9a24a'; S.epaulet='#e8c25a'; S.coatHi='#3a2c4e'; S.eye='#fff4d0'; S.accent='#ffe08a'; }
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

  // 第四幕 航海斗篷：深蓝外层，边缘像素飘动（绘于身体后方）
  if(S.naval){
    const flut=Math.sin(t*0.18)*3, flut2=Math.cos(t*0.13)*2;
    ctx.fillStyle='#12303e';
    ctx.beginPath();
    ctx.moveTo(-8, -46);
    ctx.lineTo(7, -46);
    ctx.lineTo(13+flut, -26);
    ctx.lineTo(15+flut, -6);
    ctx.lineTo(9+flut2, -2);
    ctx.lineTo(2, -8);
    ctx.lineTo(-6, -3);
    ctx.lineTo(-13-flut, -8);
    ctx.lineTo(-11, -30);
    ctx.closePath(); ctx.fill();
    // 斗篷内衬高光条与飘动像素边
    ctx.fillStyle='#1e4658'; px(-9, -44, 3, 30, '#1e4658');
    px(9+flut, -24, 3, 4, '#0c2028'); px(11+flut, -14, 2, 4, '#0c2028'); // 飘动边缘破碎像素
    px(-12-flut, -22, 2, 4, '#0c2028');
  }

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

  // 每幕差异化服饰细节（明显可辨，非仅调色）
  // 第二幕 宫廷：金色纽扣（1-2 颗醒目）+ 暖色胸前绶带
  if(S.court){
    px(-2+lean*0.4, torsoY+3, 3, 3, '#e8c25a'); px(-2+lean*0.4, torsoY+9, 3, 3, '#e8c25a'); // 金纽扣
    px(-1+lean*0.4, torsoY+4, 1, 1, '#fff0c0'); px(-1+lean*0.4, torsoY+10, 1, 1, '#fff0c0'); // 高光
    px(-6+lean*0.4, torsoY+2, 12, 1, '#7a5a48'); // 暖色绶带
  }
  // 第三幕 逃亡：破损像素撕裂边 + 灰尘泥土斑点
  if(S.torn){
    px(6+lean*0.4, torsoY+9, 3, 2, S.coatShadow); px(7+lean*0.4, torsoY+11, 2, 3, S.coatShadow); // 下摆撕裂缺口
    px(-7+lean*0.4, torsoY+14, 2, 2, S.coatShadow);
    px(-4+lean*0.4, torsoY+16, 3, 2, 'rgba(120,96,60,0.55)'); px(3+lean*0.4, torsoY+13, 2, 2, 'rgba(110,88,54,0.5)'); // 泥土
    px(1+lean*0.4, torsoY+6, 2, 1, 'rgba(150,130,100,0.4)'); // 灰尘
  }
  // 第四幕 英格兰：航海勋章/锚形纹章 + 风化磨痕
  if(S.naval){
    px(2+lean*0.4, torsoY+5, 4, 4, '#9ab8be'); px(3+lean*0.4, torsoY+6, 2, 3, '#16222e'); // 锚形勋章
    px(3+lean*0.4, torsoY+7, 2, 1, '#9ab8be');
    px(-6+lean*0.4, torsoY+3, 11, 1, '#3a6a72'); // 海军斜纹
    px(-5+lean*0.4, torsoY+11, 2, 2, 'rgba(150,175,180,0.35)'); // 盐渍风化
  }
  // 第五幕 成功：金边发光装甲；失败：暗紫破碎裂纹
  if(S.gold){
    px(-9+lean*0.4, torsoY-1, 6, 1, '#ffe08a'); px(6+lean*0.4, torsoY-1, 5, 1, '#ffe08a'); // 肩章金边
    px(6+lean*0.4, torsoY, 2, 20, S.accent); px(-6+lean*0.4, torsoY+2, 1, 16, S.accent); // 盔甲金边
    px(-2+lean*0.4, torsoY+4, 4, 1, '#fff0c0'); px(-2+lean*0.4, torsoY+9, 4, 1, '#fff0c0');
  }
  if(S.doom){
    px(-5+lean*0.4, torsoY+6, 6, 1, '#2a0f30'); px(2+lean*0.4, torsoY+10, 4, 1, '#3a1540'); // 装甲裂纹
    px(-6+lean*0.4, torsoY+15, 3, 2, S.coatShadow); px(5+lean*0.4, torsoY+13, 3, 3, S.coatShadow); // 破碎缺口
    px(-3+lean*0.4, torsoY+2, 2, 4, '#4a2a5c');
  }

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
  if(S.hairHi){ // 第二幕 头发纹理高光
    px(-5+lean*0.6, headY-2, 2, 4, S.hairHi); px(1+lean*0.6, headY-2, 2, 3, S.hairHi); px(4+lean*0.6, headY-1, 1, 3, S.hairHi);
  }
  if(S.wet){ // 湿发效果：高光条
    ctx.fillStyle='rgba(150,180,210,0.5)'; px(-5+lean*0.6, headY-2, 2, 5, 'rgba(150,180,210,0.5)'); px(2+lean*0.6, headY-2, 2, 4, 'rgba(150,180,210,0.5)');
  }
  // 眉头微锁（S.tense 时更紧绷：眉毛下压内聚）
  if(S.tense){
    px(-4+lean*0.6, headY+4, 4, 1, '#140d0a'); px(0+lean*0.6, headY+4, 4, 1, '#140d0a');
    px(-1+lean*0.6, headY+3, 2, 1, '#140d0a'); // 眉间竖纹
  } else {
    px(-4+lean*0.6, headY+4, 3, 1, '#1a120e');
    px(1+lean*0.6, headY+4, 3, 1, '#1a120e');
  }
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

function drawOpheliaFigure(mode, t, wounded){
  const ghost = mode==='ghost';
  const punk = mode==='punk';
  if(wounded){ ctx.rotate(-0.72); ctx.translate(-8,10); }
  ctx.save();
  // 影子
  if(!ghost){ ctx.fillStyle='rgba(0,0,0,0.26)'; ctx.beginPath(); ctx.ellipse(0,0,13,3.3,0,0,6.283); ctx.fill(); }

  if(ghost){
    // === 亡魂奥菲莉亚（朋克母本鬼魂化）：短发皮衣短裙渔网靴，蓝白幽光半透明 ===
    const breathe=0.62+0.12*Math.sin(t*0.035);   // 整体 alpha 约 0.5~0.75，周期≈3s
    const floatY=Math.sin(t*0.04)*2.5;
    const hairSwing=Math.sin(t*0.055)*2.4;
    const hemSwing=Math.sin(t*0.06)*2.2;
    ctx.translate(0,floatY);
    // 灵体光晕：头/上半身后方呼吸蓝白光
    ctx.save(); ctx.globalAlpha=breathe*0.55;
    const glow=ctx.createRadialGradient(0,-34,4,0,-34,38);
    glow.addColorStop(0,'rgba(234,246,255,0.62)'); glow.addColorStop(0.45,'rgba(169,203,242,0.22)'); glow.addColorStop(1,'rgba(127,168,220,0)');
    ctx.fillStyle=glow; ctx.beginPath(); ctx.ellipse(0,-31,24,32,0,0,6.283); ctx.fill();
    ctx.restore();
    ctx.globalAlpha=breathe;
    // 腿部：朋克母本渔网裤袜，鬼魂化为浅蓝银线
    px(-6,-14,4,14,'#7FA8DC'); px(2,-14,4,14,'#6E93C8');
    ctx.strokeStyle='rgba(234,246,255,0.62)'; ctx.lineWidth=0.8;
    for(let yy=-13; yy<-1; yy+=3){ ctx.beginPath(); ctx.moveTo(-6,yy); ctx.lineTo(-2,yy+3); ctx.moveTo(2,yy); ctx.lineTo(6,yy+3); ctx.stroke(); }
    // 厚底靴：下半身额外虚化
    ctx.save(); ctx.globalAlpha=breathe*0.62;
    px(-7,-2,5,3,'#6E93C8'); px(2,-2,5,3,'#6E93C8');
    px(-6,-1,3,1,'#EAF6FF'); px(3,-1,3,1,'#EAF6FF');
    ctx.restore();
    // 深紫碎花短裙的原廓形，裙摆随风轻摆并淡化下缘
    ctx.fillStyle='#A9CBF2'; ctx.beginPath(); ctx.moveTo(-8,-22); ctx.lineTo(8,-22); ctx.lineTo(11+hemSwing*0.35,-12+hemSwing); ctx.lineTo(-11+hemSwing*0.25,-12-hemSwing*0.25); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.globalAlpha=breathe*0.5; ctx.fillStyle='#BFDBFF'; ctx.fillRect(-10,-14,20,2); ctx.restore();
    [[-7,-19],[-2,-15],[3,-19],[7,-14],[0,-20]].forEach(([fx,fy])=>{ ctx.fillStyle='#F2FAFF'; ctx.fillRect(fx,fy,2,2); });
    // 深 V 紧身上衣 + 皮革短外套翻领，保留朋克剪影改为幽蓝
    px(-6,-32,12,11,'#7FA8DC');
    ctx.fillStyle='#6E93C8'; ctx.beginPath(); ctx.moveTo(-4,-32); ctx.lineTo(4,-32); ctx.lineTo(0,-24); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#8FB7E6';
    px(-8,-32,3,13,'#8FB7E6'); px(5,-32,3,13,'#8FB7E6');
    ctx.beginPath(); ctx.moveTo(-8,-32); ctx.lineTo(-4,-30); ctx.lineTo(-5,-27); ctx.lineTo(-8,-28); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8,-32); ctx.lineTo(4,-30); ctx.lineTo(5,-27); ctx.lineTo(8,-28); ctx.closePath(); ctx.fill();
    px(6,-38,3,3,'#E6F2FF');
    // 颈环、坠饰与腕环
    px(-3,-33,6,1.4,'#6E93C8'); px(-1,-32,2,1,'#EAF6FF');
    px(6,-30,3,1.4,'#7FA8DC');
    // 头（蓝白肤色）
    ctx.fillStyle='#E6F2FF'; ctx.beginPath(); ctx.ellipse(0,-42,6,7.2,0,0,6.283); ctx.fill();
    // 利落短发 + 凌乱刘海：沿用朋克母本，发丝随 t 轻摆
    ctx.fillStyle='#7FA8DC';
    ctx.beginPath(); ctx.moveTo(-7,-44); ctx.quadraticCurveTo(-4,-53+hairSwing,3,-51); ctx.quadraticCurveTo(9,-50-hairSwing,8,-42); ctx.lineTo(7,-40); ctx.lineTo(4,-46+hairSwing); ctx.lineTo(1,-40); ctx.lineTo(-2,-47-hairSwing); ctx.lineTo(-5,-40); ctx.closePath(); ctx.fill();
    px(-8,-46,3,8,'#6E93C8'); px(6,-46,3,7,'#6E93C8');
    px(-6,-49,2,3,'#EAF6FF'); px(1,-50,2,3,'#EAF6FF'); px(4,-47,1.5,3,'#EAF6FF');
    ctx.strokeStyle='rgba(242,250,255,0.72)'; ctx.lineWidth=1; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-8,-41); ctx.quadraticCurveTo(-10,-36,-8+hairSwing*0.4,-33); ctx.moveTo(8,-41); ctx.quadraticCurveTo(10,-36,8-hairSwing*0.4,-33); ctx.stroke();
    // 发间小花（幽光花瓣）
    ctx.fillStyle='#F2FAFF'; ctx.fillRect(-6,-50,2,2); ctx.fillStyle='#BFDBFF'; ctx.fillRect(0,-52,2,2); ctx.fillStyle='#F2FAFF'; ctx.fillRect(5,-49,2,2); ctx.fillStyle='#BFDBFF'; ctx.fillRect(-3,-51,1.6,1.6);
    // 妆容：冷蓝眼影、半开目、淡蓝唇线与平和微笑
    ctx.fillStyle='rgba(159,196,238,0.72)'; ctx.fillRect(-4,-44,3,2.4); ctx.fillRect(2,-44,3,2.4);
    ctx.fillStyle='#6E93C8'; ctx.fillRect(-3.4,-43,1.6,1); ctx.fillRect(2,-43,1.6,1);
    ctx.strokeStyle='#9FC4EE'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-2,-37.4); ctx.quadraticCurveTo(0,-36.2,2,-37.4); ctx.stroke();
    ctx.fillStyle='rgba(234,246,255,0.45)'; ctx.fillRect(-4.4,-40,1.5,1.5); ctx.fillRect(3,-40,1.5,1.5);
    // 环绕灵魂光点：frame+i 驱动淡入淡出
    for(let i=0;i<6;i++){
      const tw=(Math.sin(frame*0.035+i*1.45)+1)*0.5;
      if(tw<0.12) continue;
      const ang=i*1.18+frame*0.012, rr=14+(i%3)*6;
      const sxp=Math.cos(ang)*rr*0.75, syp=-29+Math.sin(ang*1.25)*24;
      ctx.globalAlpha=breathe*tw*0.85; ctx.fillStyle=i%2?'#EAF6FF':'#BFDBFF';
      const sz=1+(i%2); ctx.fillRect(sxp,syp,sz,sz);
    }
    ctx.globalAlpha=1;
    ctx.restore(); return;
  }

  if(punk){
    // === 朋克奥菲莉亚（推倒重做，朋克妆造，绝非和服/日式）===
    // 腿部：黑色渔网裤袜（斜线纹）
    px(-6,-14,4,14,'#1a1a1a'); px(2,-14,4,14,'#1a1a1a');
    ctx.strokeStyle='rgba(90,90,90,0.6)'; ctx.lineWidth=0.8;
    for(let yy=-13; yy<-1; yy+=3){ ctx.beginPath(); ctx.moveTo(-6,yy); ctx.lineTo(-2,yy+3); ctx.moveTo(2,yy); ctx.lineTo(6,yy+3); ctx.stroke(); }
    // 黑色厚底靴
    px(-7,-2,5,3,'#0d0d0d'); px(2,-2,5,3,'#0d0d0d');
    // 碎花短裙（深紫底 + 白色小花纹）
    ctx.fillStyle='#7a4a7a'; ctx.beginPath(); ctx.moveTo(-8,-22); ctx.lineTo(8,-22); ctx.lineTo(11,-12); ctx.lineTo(-11,-12); ctx.closePath(); ctx.fill();
    [[-7,-19],[-2,-15],[3,-19],[7,-14],[0,-20]].forEach(([fx,fy])=>{ ctx.fillStyle='#f0e8f0'; ctx.fillRect(fx,fy,2,2); });
    // 黑色紧身上衣（深 V）
    px(-6,-32,12,11,'#2a2a2a');
    ctx.fillStyle='#1a1a1a'; ctx.beginPath(); ctx.moveTo(-4,-32); ctx.lineTo(4,-32); ctx.lineTo(0,-24); ctx.closePath(); ctx.fill(); // 深 V 领
    // 深灰皮革短外套（带翻领）
    ctx.fillStyle='#484848';
    px(-8,-32,3,13,'#484848'); px(5,-32,3,13,'#484848'); // 外套两襟
    ctx.beginPath(); ctx.moveTo(-8,-32); ctx.lineTo(-4,-30); ctx.lineTo(-5,-27); ctx.lineTo(-8,-28); ctx.closePath(); ctx.fill(); // 左翻领
    ctx.beginPath(); ctx.moveTo(8,-32); ctx.lineTo(4,-30); ctx.lineTo(5,-27); ctx.lineTo(8,-28); ctx.closePath(); ctx.fill();  // 右翻领
    px(6,-38,3,3,'#e8c8d8'); // 手（露出）
    // 颈部：细黑项链/颈环
    px(-3,-33,6,1.4,'#0d0d0d'); px(-1,-32,2,1,'#c23b73');
    // 腕部皮环
    px(6,-30,3,1.4,'#3a2a2a');
    // 头（偏苍白面颊 #F0E8F0）
    ctx.fillStyle='#f0e8f0'; ctx.beginPath(); ctx.ellipse(0,-42,6,7.2,0,0,6.283); ctx.fill();
    // 利落黑色短发（#1A1A1A）+ 受光高光 #404040，不规则侧分凌乱多缕
    ctx.fillStyle='#1a1a1a';
    ctx.beginPath(); ctx.moveTo(-7,-44); ctx.quadraticCurveTo(-4,-53,3,-51); ctx.quadraticCurveTo(9,-50,8,-42); ctx.lineTo(7,-40); ctx.lineTo(4,-46); ctx.lineTo(1,-40); ctx.lineTo(-2,-47); ctx.lineTo(-5,-40); ctx.closePath(); ctx.fill(); // 凌乱刘海缺口
    px(-8,-46,3,8,'#1a1a1a'); px(6,-46,3,7,'#1a1a1a'); // 两侧短发（利落，不过肩）
    px(-6,-49,2,3,'#404040'); px(1,-50,2,3,'#404040'); // 受光高光缕
    px(4,-47,1.5,3,'#404040');
    // 发间小花（淡黄/粉，3-4 个小方块）
    ctx.fillStyle='#f5d97a'; ctx.fillRect(-6,-50,2,2); ctx.fillStyle='#f3b6c6'; ctx.fillRect(0,-52,2,2); ctx.fillStyle='#f5d97a'; ctx.fillRect(5,-49,2,2); ctx.fillStyle='#f3b6c6'; ctx.fillRect(-3,-51,1.6,1.6);
    // 妆容：紫色眼影扩散 + 深玫红唇
    ctx.fillStyle='rgba(139,92,246,0.75)'; ctx.fillRect(-4,-44,3,2.4); ctx.fillRect(2,-44,3,2.4);
    ctx.fillStyle='#1a1a1a'; ctx.fillRect(-3.4,-43,1.6,1.6); ctx.fillRect(2,-43,1.6,1.6); // 眼
    ctx.fillStyle='#C23B73'; ctx.fillRect(-2,-37,4,1.6); // 深玫红唇
    ctx.restore(); return;
  }

  // === 正常奥菲莉亚（第二幕）：琥珀棕长发 + 米白宫廷裙，暖色柔和 ===
  // 米白宫廷裙 + 2-3 层裙摆
  ctx.fillStyle='#F5F0E0';
  ctx.beginPath(); ctx.moveTo(-6,-30); ctx.lineTo(6,-30); ctx.lineTo(15,0); ctx.lineTo(-15,0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(198,186,156,0.75)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(-11,-6); ctx.quadraticCurveTo(0,-10,11,-6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-13,-2); ctx.quadraticCurveTo(0,-6,13,-2); ctx.stroke();
  px(-6,-31,12,3,'#E8DFC6'); // 束腰
  // V 领
  ctx.fillStyle='#EDE3CB'; ctx.beginPath(); ctx.moveTo(-5,-33); ctx.lineTo(5,-33); ctx.lineTo(0,-27); ctx.closePath(); ctx.fill();
  // 手臂（米白袖）+ 手（暖粉）
  px(-9,-28,3,10,'#F0E6D0'); px(6,-28,3,10,'#F0E6D0');
  px(-9,-19,3,3,'#FFDAB9'); px(6,-19,3,3,'#FFDAB9');
  // 左腕浅色手链（点线）
  ctx.fillStyle='#FFF8E0'; ctx.fillRect(-9,-20,3,1); ctx.fillStyle='#E9DFC2'; ctx.fillRect(-9,-18.5,3,1);
  // 头（暖粉肤色）
  ctx.fillStyle='#FFDAB9'; ctx.beginPath(); ctx.ellipse(0,-42,6,7.2,0,0,6.283); ctx.fill();
  // 长直发中分，琥珀棕 #A0522D，垂过肩，发梢稍弯
  ctx.fillStyle='#A0522D';
  ctx.beginPath(); ctx.moveTo(-7,-45); ctx.quadraticCurveTo(0,-52,7,-45); ctx.lineTo(5,-43); ctx.quadraticCurveTo(0,-47,-5,-43); ctx.closePath(); ctx.fill(); // 顶发+中分
  ctx.beginPath(); ctx.moveTo(-7,-46); ctx.quadraticCurveTo(-12,-32,-8,-20); ctx.quadraticCurveTo(-5,-17,-5,-22); ctx.quadraticCurveTo(-6,-34,-4,-44); ctx.closePath(); ctx.fill(); // 左长发
  ctx.beginPath(); ctx.moveTo(7,-46); ctx.quadraticCurveTo(12,-32,8,-20); ctx.quadraticCurveTo(5,-17,5,-22); ctx.quadraticCurveTo(6,-34,4,-44); ctx.closePath(); ctx.fill(); // 右长发
  px(-9,-24,2,4,'#B5673A'); px(7,-24,2,4,'#B5673A'); // 发梢高光
  // 眼 + 微笑（唇 #E9967A）
  ctx.fillStyle='#3a2a28'; ctx.fillRect(-3.2,-43,1.6,2); ctx.fillRect(2,-43,1.6,2);
  ctx.strokeStyle='#E9967A'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(-2.4,-37.4); ctx.quadraticCurveTo(0,-35.8,2.4,-37.4); ctx.stroke();
  ctx.restore();
}

// 随从：奥菲莉亚（成功）或霍拉旭
function drawCompanion(c){
  const cx=c.x+c.w/2, cy=c.y+c.h, f=c.facing;
  ctx.save();
  ctx.translate(cx,cy); ctx.scale(f,1);
  const t=frame; const legS=c.vx!==0?Math.sin(t*0.35)*2.5:0;
  if(c.kind==='ophelia'){
    drawOpheliaFigure(opheliaWounded?'punk':'punk', t, opheliaWounded);
    if(c.atkT>0 && !opheliaWounded){ ctx.fillStyle='rgba(214,80,154,0.55)'; ctx.beginPath(); ctx.arc(13,-24,5,0,6.283); ctx.fill(); }
  } else {
    // 霍拉旭：学者装，稳重
    ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0,0,c.w*0.5,3,0,0,6.283); ctx.fill();
    px(-7+legS,-14,5,14,'#2a2430'); px(2-legS,-14,5,14,'#1e1a26');
    px(-7,-32,14,18,'#3a3448'); px(4,-32,3,18,'#4a4258');
    px(-7,-32,14,3,'#5a4a2a');
    px(-5,-42,10,10,'#c9a98c');
    px(-5,-45,10,5,'#4a3a2a');
    px(-3,-38,2,2,'#2a2018');px(1,-38,2,2,'#2a2018');
    px(6,-26,7,2,'#c8c4b4');
    if(c.atkT>0){ ctx.strokeStyle='rgba(220,220,200,0.5)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(4,-24,12,-0.5,0.8);ctx.stroke(); }
  }
  ctx.restore();
}

function drawPunkOpheliaLayer(){
  const po=level&&level.punkOphelia; if(!po) return;
  ctx.save(); ctx.translate(po.x, GROUND_TOP); ctx.scale(po.dir||1,1); ctx.globalAlpha=0.92;
  drawOpheliaFigure('punk', frame, false);
  ctx.restore();
}
function drawCourtOpheliaLayer(){
  const co=level&&level.courtOphelia; if(!co) return;
  ctx.save(); ctx.translate(co.x, GROUND_TOP); ctx.scale(co.dir||1,1); ctx.globalAlpha=0.96;
  drawOpheliaFigure('normal', frame, false);
  ctx.restore();
}

function drawGhostOpheliaFinale(){
  if(!ghostOpheliaFinale || !boss || boss.kind!=='claudius') return;
  const gx=boss.x+boss.w/2-58+Math.sin(frame*0.04)*10, gy=GROUND_TOP;
  ctx.save(); ctx.translate(gx, gy); drawOpheliaFigure('ghost', frame, false); ctx.restore();
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
  const style=platformStyleForAct();
  if(p.color) style.body=style.top=p.color;
  const topH=p.type==='plat'?4:6;
  ctx.fillStyle=style.body; ctx.fillRect(p.x,p.y,p.w,p.h);
  ctx.fillStyle=style.top; ctx.fillRect(p.x,p.y,p.w,topH);
  drawPlatformTexture(p, style, topH);
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(p.x,p.y+p.h-3,p.w,3);
}
function platformStyleForAct(){
  if(darkMode) return {kind:'final', body:'#140f18', top:'#24182a', line:'rgba(232,194,90,.65)', shade:'rgba(0,0,0,.35)'};
  if(actIndex===ACT_CASTLE) return {kind:'stone', body:'#3f4350', top:'#606675', line:'rgba(210,216,220,.18)', shade:'rgba(0,0,0,.24)'};
  if(actIndex===ACT_COURT) return {kind:'marble', body:'#c7b58e', top:'#ead9b4', line:'rgba(95,70,105,.20)', shade:'rgba(255,255,255,.18)'};
  if(actIndex===ACT_ESCAPE || actIndex===ACT_LAKE) return {kind:'wood', body:'#3b2418', top:'#65402a', line:'rgba(210,150,86,.25)', shade:'rgba(0,0,0,.24)'};
  if(actIndex===ACT_ENGLAND) return {kind:'shipwood', body:'#405a61', top:'#668089', line:'rgba(190,230,230,.20)', shade:'rgba(0,0,0,.26)'};
  return {kind:'final', body:'#121014', top:'#28232e', line:'rgba(232,194,90,.58)', shade:'rgba(255,255,255,.10)'};
}
function drawPlatformTexture(p, s, topH){
  ctx.save();
  ctx.beginPath(); ctx.rect(p.x,p.y,p.w,p.h); ctx.clip();
  if(s.kind==='stone'){
    ctx.strokeStyle=s.line; ctx.lineWidth=1;
    for(let x=p.x-(p.x%38);x<p.x+p.w;x+=38){ ctx.beginPath(); ctx.moveTo(x,p.y+topH); ctx.lineTo(x,p.y+p.h); ctx.stroke(); }
    for(let y=p.y+topH+18;y<p.y+p.h;y+=18){ ctx.beginPath(); ctx.moveTo(p.x,y); ctx.lineTo(p.x+p.w,y); ctx.stroke(); }
    ctx.fillStyle='rgba(20,20,24,.22)'; for(let x=p.x+12;x<p.x+p.w;x+=53){ const chip=((x*17+p.y*7)%11); ctx.fillRect(x,p.y+topH+8+chip,4,2); ctx.fillRect(x+18,p.y+topH+22-chip*.4,2,2); }
  } else if(s.kind==='marble'){
    ctx.strokeStyle=s.line; ctx.lineWidth=1.4;
    for(let i=0;i<8;i++){ const y=p.y+topH+((i*19+p.x*.07)%Math.max(22,p.h)); ctx.beginPath(); ctx.moveTo(p.x-20,y); for(let x=p.x-20;x<=p.x+p.w+20;x+=28){ ctx.lineTo(x,y+Math.sin(x*.035+i)*7); } ctx.stroke(); }
    ctx.fillStyle='rgba(255,255,255,.13)'; ctx.fillRect(p.x,p.y+topH,p.w,3);
  } else if(s.kind==='wood' || s.kind==='shipwood'){
    ctx.strokeStyle=s.line; ctx.lineWidth=1;
    for(let y=p.y+topH+7;y<p.y+p.h;y+=9){ ctx.beginPath(); ctx.moveTo(p.x,y); for(let x=p.x;x<=p.x+p.w;x+=26){ ctx.lineTo(x,y+Math.sin(x*.04+y*.05)*1.8); } ctx.stroke(); }
    ctx.strokeStyle='rgba(0,0,0,.22)'; for(let x=p.x-(p.x%46);x<p.x+p.w;x+=46){ ctx.beginPath(); ctx.moveTo(x,p.y+topH); ctx.lineTo(x,p.y+p.h); ctx.stroke(); }
    if(s.kind==='shipwood'){ ctx.fillStyle='rgba(20,24,28,.55)'; for(let x=p.x+18;x<p.x+p.w;x+=46){ ctx.beginPath(); ctx.arc(x,p.y+topH+8,2,0,6.283); ctx.arc(x,p.y+p.h-9,2,0,6.283); ctx.fill(); } }
  } else {
    const g=ctx.createLinearGradient(p.x,p.y,p.x,p.y+p.h); g.addColorStop(0,'rgba(255,255,255,.10)'); g.addColorStop(.45,'rgba(255,255,255,.025)'); g.addColorStop(1,'rgba(0,0,0,.34)'); ctx.fillStyle=g; ctx.fillRect(p.x,p.y,p.w,p.h);
    ctx.strokeStyle=s.line; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(p.x,p.y+topH+2); ctx.lineTo(p.x+p.w,p.y+topH+2); ctx.stroke();
    for(let x=p.x+20;x<p.x+p.w;x+=70){ ctx.beginPath(); ctx.moveTo(x,p.y+topH+6); ctx.lineTo(x+38,p.y+p.h-6); ctx.stroke(); }
  }
  ctx.fillStyle=s.shade; if(p.type==='plat'){ for(let x=p.x;x<p.x+p.w;x+=24) ctx.fillRect(x,p.y+topH,1,p.h-topH); }
  ctx.restore();
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
  } else if(tr.type==='bonusEntrance'){
    const a=0.28+0.22*Math.sin(frame*0.09);
    ctx.fillStyle='rgba(232,194,90,'+a+')'; ctx.fillRect(tr.x,tr.y,tr.w,tr.h);
    ctx.strokeStyle='rgba(255,235,160,0.8)'; ctx.lineWidth=2; ctx.strokeRect(tr.x,tr.y,tr.w,tr.h);
  ctx.save(); ctx.textAlign='center';
  ctx.font='bold 12px "Courier New",monospace';
  drawTextPanel(tr.x+tr.w/2-74,tr.y-42,148,34,'rgba(8,6,14,0.82)','rgba(255,235,160,0.72)');
  ctx.fillStyle='#fff2b0'; ctx.fillText('★ 趣味挑战 ★', tr.x+tr.w/2, tr.y-27);
  ctx.fillText('跳上来即可进入（可选）', tr.x+tr.w/2, tr.y-12);
    ctx.fillStyle='#1a1206'; ctx.font='18px serif'; ctx.fillText('★', tr.x+tr.w/2, tr.y+tr.h/2+6);
    ctx.restore();
  } else if(tr.type==='ladder'){
    // 梯子：两根立柱 + 横档，顶部提示"↑ 攀爬"
    ctx.save();
    ctx.strokeStyle='#7a5a34'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(tr.x+5, tr.y); ctx.lineTo(tr.x+5, tr.y+tr.h);
    ctx.moveTo(tr.x+tr.w-5, tr.y); ctx.lineTo(tr.x+tr.w-5, tr.y+tr.h); ctx.stroke();
    ctx.strokeStyle='#a5793f'; ctx.lineWidth=2;
    for(let y=tr.y+8; y<tr.y+tr.h; y+=16){ ctx.beginPath(); ctx.moveTo(tr.x+5,y); ctx.lineTo(tr.x+tr.w-5,y); ctx.stroke(); }
    ctx.fillStyle='rgba(255,230,150,'+(0.55+0.25*Math.sin(frame*0.12))+')';
    ctx.font='bold 11px "Courier New",monospace'; ctx.textAlign='center';
    ctx.fillText('↑攀爬', tr.x+tr.w/2, tr.y-6);
    ctx.restore();
  } else if(tr.type==='door'){
    // 舱门：木门 + 拱顶 + 门环；_open(0..1) 时门板向内旋开
    ctx.save();
    const op = tr._open||0;
    // 门框 / 门洞（门开时露出内部幽暗）
    ctx.fillStyle='#241a12'; ctx.fillRect(tr.x-2, tr.y-2, tr.w+4, tr.h+4);
    if(op>0){ const g=ctx.createLinearGradient(tr.x,tr.y,tr.x,tr.y+tr.h); g.addColorStop(0,'rgba(30,40,46,0.9)'); g.addColorStop(1,'rgba(6,10,14,0.98)'); ctx.fillStyle=g; ctx.fillRect(tr.x,tr.y,tr.w,tr.h);
      // 内部溢出的冷光
      ctx.fillStyle='rgba(120,180,200,'+(0.10+0.08*Math.sin(frame*0.2))+')'; ctx.fillRect(tr.x+2,tr.y+2,tr.w-4,tr.h-4); }
    // 门板：以左侧铰链为轴，透视压缩宽度模拟旋开
    ctx.save();
    ctx.translate(tr.x, tr.y);
    const persp = 1 - op*0.82;            // 门板可见宽度随开度收缩
    ctx.transform(persp,0, -op*0.34,1, 0,0);
    ctx.fillStyle='#3b2416'; ctx.fillRect(0, 0, tr.w, tr.h);
    ctx.fillStyle='#5e3d22'; ctx.fillRect(2, 2, tr.w-4, tr.h-4);
    ctx.strokeStyle='#2a1a0e'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(tr.w/2, 3); ctx.lineTo(tr.w/2, tr.h-3); ctx.stroke();
    ctx.fillStyle='#c9a24a'; ctx.beginPath(); ctx.arc(tr.w-7, tr.h*0.5, 2.5, 0, 6.283); ctx.fill();
    ctx.restore();
    // 标签 / 提示（提示由 cabinPrompt 常驻绘制，这里只画门名）
    ctx.fillStyle='rgba(255,220,150,'+(0.4+0.25*Math.sin(frame*0.1))+')';
    ctx.font='bold 10px "Courier New",monospace'; ctx.textAlign='center';
    ctx.fillText(cabinCleared?'舱门（已肃清）':'舱门', tr.x+tr.w/2, tr.y-4);
    ctx.restore();
  } else if(tr.type==='peak'){
    if(tr.fired) return;
    const a=0.12+0.12*Math.sin(frame*0.09);
    ctx.fillStyle='rgba(255,230,150,'+a+')'; ctx.fillRect(tr.x,tr.y,tr.w,tr.h);
    ctx.fillStyle='rgba(255,238,180,0.8)'; ctx.font='16px serif'; ctx.textAlign='center';
    ctx.fillText('✦', tr.x+tr.w/2, tr.y+tr.h*0.7);
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
  ctx.font='bold 11px "Courier New",monospace'; ctx.textAlign='center';
  drawTextPanel(-124,-52,248,24,'rgba(8,6,14,0.86)','rgba(185,139,255,0.85)');
  ctx.fillStyle='#f2e8ff'; ctx.fillText('拾取【亡魂之弓】解锁远程攻击 [F/Z]', 0, -36);
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
const BONUS_PLATFORM_CONFIGS = [
  { platformX: 520, hint: '↑ 跳上来挑战趣味关卡（可选）' },
  { platformX: 700, hint: '↑ 跳上来挑战趣味关卡（可选）' },
  { platformX: 600, hint: '↑ 跳上来挑战趣味关卡（可选）' },
  { platformX: 520, hint: '↑ 跳上来挑战趣味关卡（可选）' },
  { platformX: 420, hint: '↑ 跳上来挑战趣味关卡（可选）' },
];

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
function safeGroundSpots(lv){
  return (lv.platforms||[]).filter(p=>p.type==='ground'&&Math.abs(p.y-GROUND_TOP)<1&&p.w>=PLAYER_W+80)
    .map(p=>({x1:p.x+46,x2:p.x+p.w-46,y:p.y,mid:p.x+p.w/2,w:p.w})).filter(s=>s.x2>s.x1)
    .sort((a,b)=>a.x1-b.x1);
}
function pointOverlapsBonusEntrance(lv, x, y){
  const body={x:x-PLAYER_W/2,y:y-PLAYER_H,w:PLAYER_W,h:PLAYER_H};
  return (lv.triggers||[]).some(tr=>tr.type==='bonusEntrance' && rectsOverlap(body,{x:tr.x-18,y:tr.y-18,w:tr.w+36,h:tr.h+36}));
}
// 检查点与趣味入口攀爬塔的水平距离（用于避免存档点落在入口正下方/攀爬区）
function bonusColumnDist(lv, x){
  let d=Infinity;
  (lv.triggers||[]).forEach(tr=>{ if(tr.type==='bonusEntrance') d=Math.min(d, Math.abs((tr.x+tr.w/2)-x)); });
  return d;
}
function checkpointHazardRisk(lv, x, y){
  const foot={x:x-PLAYER_W/2-8,y:y-8,w:PLAYER_W+16,h:16};
  return (lv.hazards||[]).some(h=>{
    const nearX = h.x < x+48 && h.x+(h.w||0) > x-48;
    const nearY = Math.abs((h.y||GROUND_TOP)-y) < 80;
    return nearX && nearY || rectsOverlap(foot,{x:h.x,y:h.y,w:h.w||0,h:h.h||0});
  });
}
function safeSpawnPoint(lv, x, preferY){
  const spots=safeGroundSpots(lv);
  let best=null, bestScore=Infinity;
  for(const s of spots){
    const sx=clamp(Number.isFinite(x)?x:s.mid, s.x1, s.x2);
    if(checkpointHazardRisk(lv, sx, s.y)) continue;
    if(pointOverlapsBonusEntrance(lv, sx, s.y)) continue;
    // 软性惩罚：远离趣味入口攀爬塔（<150px 记大额惩罚，仍保留可行解不至于无点可选）
    const colPen = bonusColumnDist(lv, sx)<150 ? 600 : 0;
    // 软性惩罚：远离分支入口（地洞口/宝箱/攀爬台），避免复活落在分支入口误触/坑边
    const brPen = branchAvoidDist(lv, sx)<120 ? 500 : 0;
    const score=Math.abs(sx-(Number.isFinite(x)?x:s.mid)) + Math.abs((preferY||GROUND_TOP)-s.y)*2 + colPen + brPen;
    if(score<bestScore){ best={x:sx,y:s.y}; bestScore=score; }
  }
  if(best) return best;
  const g=spots[0] || {x1:80,x2:180,y:GROUND_TOP,mid:80};
  return {x:clamp(Number.isFinite(x)?x:g.mid, g.x1, g.x2), y:g.y};
}
function sanitizeLevelCheckpoints(lv){
  lv.playerStart=safeSpawnPoint(lv, lv.playerStart&&lv.playerStart.x, lv.playerStart&&lv.playerStart.y);
  for(const cp of lv.checkpoints||[]){
    const safe=safeSpawnPoint(lv, cp.x, cp.y);
    cp.x=safe.x; cp.y=safe.y;
  }
}
function safeRespawnValue(raw){
  if(!level) return {x:80,y:GROUND_TOP};
  const x=Number.isFinite(raw&&raw.x)?raw.x:level.playerStart.x;
  const y=Number.isFinite(raw&&raw.y)?raw.y:level.playerStart.y;
  const safe=safeSpawnPoint(level,x,y);
  if(raw&&raw._bossGate) safe._bossGate=true;
  return safe;
}
function teleportPlayerToSafeRespawn(label){
  respawn=safeRespawnValue(respawn);
  player.x=respawn.x; player.y=respawn.y-PLAYER_H; player.vx=0; player.vy=0; player.invuln=Math.max(player.invuln||0,60);
  if(label) addFloater(player.x+player.w/2, player.y-16, label, '#e8c25a', 12);
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
    shieldUp:type==='shield', shieldBroken:false, elite:type==='elite',
    ignoreShipTilt:true   // 船只摇晃力只作用于玩家；敌兵/NPC 不受影响
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
    addCastleMultiTier(lv);   // 【新增】多层城垛台阶结构
  } else if(idx===ACT_COURT){ // 第二幕 宫廷 —— 前段拾取亡魂之弓；关底 Boss：小丑波洛涅斯
    lv=buildStandard({seed:202, width:5600, enemies:['patrol','archer','shield'], enemyChance:0.55, pitBase:0.12, pitHazard:'spike'});
    // 亡魂之弓：本幕前段拾取（关卡开始不久即出现）
    lv.bowPickup={x:lv.width*0.12, y:GROUND_TOP-40, w:34, h:34, taken:false};
    // 正常形象奥菲莉亚：宫廷裙装、发型整洁，慢速温柔徘徊，仅作场景 NPC 装饰
    lv.courtOphelia={ baseX:lv.width*0.30, x:lv.width*0.30, phase:0, dir:1 };
    lv.segments=[{x:0,name:'宫廷回廊'},{x:lv.width/3,name:'追逐奥菲莉亚'},{x:lv.width*2/3,name:'小丑的舞台'}];
    appendBossArena(lv,'clown',{completesLevel:true});
    addCourtTower(lv);   // 【新增】塔楼内部垂直攀登结构
  } else if(idx===ACT_ESCAPE){ // 第三幕 逃亡 —— 疯朋克奥菲莉亚背景游荡；关底双人小 Boss 罗森格兰兹/吉尔登斯顿；后段彩蛋入口
    lv=buildStandard({seed:303, width:6200, enemies:['patrol','archer','shield','skeleton'], enemyChance:0.6, pitBase:0.16, pitHazard:'poison', elite:true});
    lv.punkOphelia={ baseX:lv.width*0.22, x:lv.width*0.22, phase:0, lineT:90, lineI:0, dir:1 };
    lv.triggers.push({x:lv.width*0.55, y:GROUND_TOP-120, w:60, h:120, type:'egghint', fired:false, key:'egghint'});
    lv.segments=[{x:0,name:'宫廷走廊'},{x:lv.width/3,name:'仓皇出逃'},{x:lv.width*2/3,name:'旧友的埋伏 →'}];
    appendBossArena(lv,'rosencrantz',{});
    const raX=lv.width-660;
    lv.bossPlan=[
      { kind:'rosencrantz',  triggerX:raX+40, started:false, defeated:false, pairFirst:true },
      { kind:'guildenstern', triggerX:raX,    started:false, defeated:false, completesLevel:true }
    ];
    addEscapeMaze(lv);   // 【新增】迷宫式多路径结构
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
  if(idx!==ACT_LAKE) createBonusEntrance(lv, idx);
  if(idx!==ACT_LAKE) createBranchPaths(lv, idx);   // 垂直分叉路（额外探索分支，不破坏主线）
  ensureTraversable(lv);          // 分支开挖后再次保障主线可跳跃通过（幂等）
  sanitizeLevelCheckpoints(lv);    // 统一校正出生点/检查点，避免坑内、空中、边缘或入口触发区/分支入口复活
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
   12. 剧情过场系统（逐行淡入 + 粒子 + 矢量剪影立绘）
   ------------------------------------------------------------------------- */
let storyFxCtx=dom.storyFx?dom.storyFx.getContext('2d'):null;
let storyPortraitCtx=dom.storyPortrait?dom.storyPortrait.getContext('2d'):null;
let storyPages=[], storyPageIdx=0, storyDoneCb=null;
let storyPieces=[], storyLineIdx=0, storyLineTick=0, storyComplete=false, storyPage=null;
let storyParticles=[];
const STORY_LINE_DELAY = 18;

function drawHamletOn(c, cx, cy, scale, act){
  const saved=ctx; ctx=c;
  ctx.save(); ctx.translate(cx,cy); ctx.scale(scale,scale);
  drawHamlet(0,0,1,{type:'idle',t:frame*0.5}, act);
  ctx.restore();
  ctx=saved;
}
function buildPagePieces(page){
  const arr=[];
  (page.lines||[]).forEach(ln=>{
    if(ln.zh) arr.push({text:ln.zh, cls: ln.speak?'zh speak':'zh', speak:!!ln.speak});
    if(ln.en) arr.push({text:ln.en, cls:'en', speak:false});
  });
  return arr;
}
function clearInputEdges(){ jumpEdge=false; atkEdge=false; rangedEdge=false; }
function showStory(pages, onDone){
  storyPages=pages; storyPageIdx=0; storyDoneCb=onDone;
  clearInputEdges(); state=STATE.STORY;
  hideAllOverlays(); show(dom.storyScreen);
  loadStoryPage();
}
function storyThemeAct(page){ return page && page.portrait!==undefined ? page.portrait : actIndex; }
function loadStoryPage(){
  storyPage=storyPages[storyPageIdx];
  dom.storyAct.textContent=storyPage.act||'';
  dom.storyTitle.textContent=storyPage.title||'';
  storyPieces=buildPagePieces(storyPage); storyLineIdx=0; storyLineTick=0; storyComplete=false;
  if(Sound.enabled) Sound.stageAmbience(4.8);
  resetStoryParticles(storyThemeAct(storyPage));
  renderStory();
  renderStoryPortrait();
}
function escapeHtml(text){ return String(text).replace(/[&<>"]/g, ch=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch])); }
function renderStory(){
  let html='';
  for(let i=0;i<Math.min(storyLineIdx,storyPieces.length);i++){
    const pc=storyPieces[i];
    html+='<p class="'+pc.cls+'" style="animation-delay:'+(i*45)+'ms">'+escapeHtml(pc.text)+'</p>';
  }
  dom.storyBody.innerHTML=html;
  // 文字超出固定高度时自动滚到底部，保证最新出现的对白始终可见（按钮区固定在卡片底部不受影响）
  dom.storyBody.scrollTop = dom.storyBody.scrollHeight;
}
function renderStoryPortrait(){
  const pc = document.getElementById('portraitCanvas');
  if(!pc) return;
  const pCtx = pc.getContext('2d');
  const pw = pc.width, ph = pc.height;
  pCtx.clearRect(0, 0, pw, ph);
  const act = storyThemeAct(storyPage||{});
  const savedCtx = ctx;
  ctx = pCtx;
  try {
    drawHamletPortrait(pw / 2, ph - 20, 4.0, act);
  } finally {
    ctx = savedCtx;
  }
}
function tickStory(){
  updateStoryFx();
  renderStoryPortrait();
  if(storyComplete) return;
  storyLineTick++;
  if(storyLineTick>=STORY_LINE_DELAY){
    storyLineTick=0; storyLineIdx++;
    if(Sound.enabled){
      Sound.blip(rand(360,560),.025,'triangle',.05);
      Sound.storyVoiceCue(storyPieces[storyLineIdx-1], storyPage, storyLineIdx-1);
    }
    if(storyLineIdx>=storyPieces.length){ storyLineIdx=storyPieces.length; storyComplete=true; }
    renderStory();
  }
}
function storyAdvance(){
  if(!storyComplete){ storyLineIdx=storyPieces.length; storyComplete=true; renderStory(); return; }
  storyPageIdx++;
  if(storyPageIdx>=storyPages.length){
    const cb=storyDoneCb; storyDoneCb=null; hide(dom.storyScreen); clearStoryFx(); clearInputEdges();
    if(cb) cb();
  } else loadStoryPage();
}
function resetStoryParticles(act){
  storyParticles=[];
  const count= act===ACT_FINAL ? 60 : (act===ACT_COURT ? 52 : 48);
  for(let i=0;i<count;i++) storyParticles.push(makeStoryParticle(act, true));
}
function makeStoryParticle(act, initial){
  const finalGold = act===ACT_FINAL && opheliaSaved && !darkMode;
  const finalDoom = act===ACT_FINAL && (!opheliaSaved || darkMode);
  const p={ x:rand(0,W), y:initial?rand(0,H):rand(-30,0), r:rand(1.2,3.6), a:rand(.28,.82), rot:rand(0,6.28) };
  if(act===ACT_CASTLE) Object.assign(p,{kind:'star', color:'rgba(235,242,255,.86)', vx:rand(-.12,.12), vy:rand(.25,.72)});
  else if(act===ACT_COURT) Object.assign(p,{kind:'candle', color:'rgba(255,204,92,.78)', vx:rand(-.2,.2), vy:rand(-.42,-.08), wave:rand(.01,.03)});
  else if(act===ACT_ESCAPE || act===ACT_LAKE) Object.assign(p,{kind:'petal', color:Math.random()<.5?'rgba(216,90,154,.78)':'rgba(150,82,190,.72)', vx:rand(-.7,.45), vy:rand(.12,.58), vr:rand(-.05,.05)});
  else if(act===ACT_ENGLAND) Object.assign(p,{kind:'mist', color:'rgba(160,214,236,.58)', vx:rand(.35,1.05), vy:rand(-.08,.08)});
  else Object.assign(p,{kind:'aura', color:finalGold?'rgba(232,194,90,.66)':(finalDoom?'rgba(152,92,210,.58)':'rgba(220,220,255,.55)'), vx:rand(-.22,.22), vy:rand(-.34,.12)});
  return p;
}
function updateStoryFx(){
  if(!storyFxCtx) return;
  const act=storyThemeAct(storyPage||{}), c=storyFxCtx;
  c.clearRect(0,0,W,H);
  const bg=c.createLinearGradient(0,0,0,H);
  bg.addColorStop(0, act===ACT_ENGLAND?'#07111a':(act===ACT_COURT?'#120b16':(act===ACT_FINAL && !opheliaSaved?'#08050d':'#070610')));
  bg.addColorStop(1, '#020106'); c.fillStyle=bg; c.fillRect(0,0,W,H);
  drawStoryParticles(c, act);
  drawStorySilhouette(c, W-148, H-36, 4.15, act, 'rightHamlet', true);
}
function clearStoryFx(){ if(storyFxCtx) storyFxCtx.clearRect(0,0,W,H); if(storyPortraitCtx && dom.storyPortrait) storyPortraitCtx.clearRect(0,0,dom.storyPortrait.width,dom.storyPortrait.height); storyParticles=[]; }
function activeStorySide(){ const pc=storyPieces[Math.max(0, Math.min(storyLineIdx-1, storyPieces.length-1))]; return pc && pc.speak ? 'right' : 'left'; }
function drawStoryParticles(c, act){
  for(let i=0;i<storyParticles.length;i++){
    const p=storyParticles[i]; p.x+=p.vx; p.y+=p.vy; p.rot+=(p.vr||0);
    if(p.wave) p.x+=Math.sin(frame*p.wave+p.rot)*.25;
    if(p.y>H+30 || p.y<-45 || p.x<-45 || p.x>W+45) storyParticles[i]=makeStoryParticle(act, false);
    c.save(); c.globalAlpha=p.a; c.fillStyle=p.color;
    if(p.kind==='petal'){ c.translate(p.x,p.y); c.rotate(p.rot); c.beginPath(); c.moveTo(0,-p.r*2); c.lineTo(p.r*1.8,-p.r*.3); c.lineTo(p.r*.5,p.r*1.8); c.lineTo(-p.r*1.5,p.r*.8); c.closePath(); c.fill(); }
    else if(p.kind==='mist'){ c.beginPath(); c.ellipse(p.x,p.y,p.r*2.4,p.r*.9,0,0,6.283); c.fill(); }
    else { c.beginPath(); c.arc(p.x,p.y,p.r,0,6.283); c.fill(); }
    c.restore();
  }
}
function drawStorySilhouette(c, x, y, s, act, side, active){
  const breath=active ? 1 + Math.sin(frame*.08)*.02 : .985;
  const finalGold = act===ACT_FINAL && opheliaSaved && !darkMode;
  const finalDoom = act===ACT_FINAL && (!opheliaSaved || darkMode);
  c.save(); c.translate(x,y); c.scale((side==='left'?1:-1)*s*breath,s*breath); c.globalAlpha=active?.62:.34;
  const aura=c.createRadialGradient(0,-42,4,0,-42,54);
  aura.addColorStop(0, finalGold?'rgba(232,194,90,.28)':(finalDoom?'rgba(96,45,135,.32)':'rgba(120,130,170,.22)'));
  aura.addColorStop(1,'rgba(0,0,0,0)'); c.fillStyle=aura; c.fillRect(-70,-116,140,128);
  if(side==='right') drawVectorOpheliaPortrait(c, opheliaPortraitMode(act), active);
  else drawHamletOn(c, 0, 0, 1, act);
  c.restore();
}
function opheliaPortraitMode(act){
  if(act===ACT_FINAL && ghostOpheliaFinale) return 'ghost';
  if(act>=ACT_ESCAPE) return 'punk';
  return 'normal';
}
function drawVectorOpheliaPortrait(c, mode, active){
  const ghost=mode==='ghost', punk=mode==='punk';
  if(ghost){ c.globalAlpha*=.82; }
  c.fillStyle=ghost?'rgba(135,205,255,.34)':(punk?'rgba(201,160,220,.42)':'rgba(242,220,205,.5)'); c.beginPath(); c.ellipse(0,6,24,76,0,0,6.283); c.fill();
  const dress=ghost?'rgba(175,225,255,.52)':(punk?'#C9A0DC':'#e9d9e8');
  c.fillStyle=dress; c.beginPath(); c.moveTo(-20,-18); c.quadraticCurveTo(0,-26,21,-18); c.lineTo(35,76); c.lineTo(-35,76); c.closePath(); c.fill();
  if(punk){ c.fillStyle='#E8A0A0'; c.beginPath(); c.moveTo(-22,-19); c.lineTo(-30,52); c.lineTo(-5,20); c.lineTo(4,52); c.lineTo(15,18); c.lineTo(31,52); c.lineTo(22,-19); c.closePath(); c.fill(); c.strokeStyle='#F5EEF7'; c.lineWidth=1.2; c.beginPath(); c.moveTo(-18,0); c.lineTo(20,40); c.stroke(); }
  else if(ghost){ c.strokeStyle='rgba(220,250,255,.7)'; c.lineWidth=1; for(let i=-2;i<=2;i++) { c.beginPath(); c.moveTo(i*5,-62); c.bezierCurveTo(i*9,-36,i*4,-16,i*7,20); c.stroke(); } }
  else { c.fillStyle='#f5ecd8'; c.beginPath(); c.moveTo(-24,-18); c.lineTo(24,-18); c.lineTo(28,66); c.lineTo(-28,66); c.closePath(); c.fill(); }
  c.fillStyle=ghost?'rgba(220,248,255,.72)':(punk?'#f0d8de':'#f5d7bd'); c.beginPath(); c.ellipse(0,-42,13,17,0,0,6.283); c.fill();
  if(punk){ c.fillStyle='#B98FCF'; c.beginPath(); c.moveTo(-20,-46); c.quadraticCurveTo(-8,-72,12,-61); c.quadraticCurveTo(28,-48,13,-20); c.lineTo(7,-43); c.lineTo(-7,-25); c.lineTo(-11,-42); c.lineTo(-20,-25); c.closePath(); c.fill(); ['#F5D97A','#F3B6C6','#FFF6C0','#FFFFFF'].forEach((color,i)=>{ c.fillStyle=color; c.beginPath(); c.arc(-13+i*8,-61+(i%2)*4,3,0,6.283); c.fill(); }); }
  else if(ghost){ c.strokeStyle='rgba(210,242,255,.78)'; c.lineWidth=2; c.beginPath(); c.moveTo(-10,-58); c.bezierCurveTo(-27,-37,-19,-10,-25,12); c.moveTo(11,-58); c.bezierCurveTo(28,-35,19,-8,25,14); c.stroke(); }
  else { c.fillStyle='#5b3a2b'; c.beginPath(); c.moveTo(-15,-48); c.quadraticCurveTo(0,-64,16,-49); c.lineTo(13,-24); c.quadraticCurveTo(2,-30,-12,-23); c.closePath(); c.fill(); c.fillRect(10,-47,5,26); }
  c.fillStyle=ghost?'rgba(30,60,82,.74)':(punk?'rgba(178,143,207,.9)':'#3a2a28'); c.fillRect(-6,-43,3,2); c.fillRect(4,-43,3,2);
  c.fillStyle=punk?'#E29A9A':'#b86b72'; c.fillRect(-4,-33,8,2);
  if(active){ c.strokeStyle=ghost?'rgba(220,250,255,.8)':(punk?'rgba(201,160,220,.8)':'rgba(232,194,90,.58)'); c.lineWidth=1.3; c.beginPath(); c.arc(0,-42,20,0,6.283); c.stroke(); }
}
function drawVectorHamletPortrait(c, act, gold, doom){
  const coat=doom?'#100818':'#09090d', hi=doom?'#30203c':'#20232a', trim=gold?'#d6ae45':(doom?'#5d3f78':'#45424e');
  c.fillStyle='rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(0,2,25,80,0,0,6.283); c.fill();
  c.fillStyle=coat; c.beginPath(); c.moveTo(-25,-20); c.lineTo(-44,48); c.lineTo(-34,80); c.lineTo(0,90); c.lineTo(34,80); c.lineTo(44,48); c.lineTo(25,-20); c.closePath(); c.fill();
  c.fillStyle=hi; c.beginPath(); c.moveTo(-16,-18); c.lineTo(0,82); c.lineTo(16,-18); c.lineTo(5,-8); c.lineTo(0,12); c.lineTo(-5,-8); c.closePath(); c.fill();
  c.strokeStyle=trim; c.lineWidth=1.1; c.beginPath(); c.moveTo(-18,-16); c.lineTo(-7,30); c.moveTo(18,-16); c.lineTo(7,30); c.stroke();
  c.fillStyle=trim; c.fillRect(-32,-16,18,4); c.fillRect(14,-16,18,4);
  for(let i=0;i<Math.min(5,act+1);i++){ c.fillStyle=i%2?trim:'#0f1016'; c.beginPath(); c.arc(0,-6+i*12,1.45,0,6.283); c.fill(); }
  if(act>=2){ c.strokeStyle=trim; c.lineWidth=1.4; c.beginPath(); c.moveTo(-22,4); c.lineTo(21,42); c.stroke(); }
  if(act>=4){ c.fillStyle=gold?'#f3d36a':'#2d2032'; c.fillRect(20,10,7,10); c.fillRect(-27,10,7,10); }
  if(doom){ c.strokeStyle='#5d3f78'; c.lineWidth=1.2; c.beginPath(); c.moveTo(-18,32); c.lineTo(-8,43); c.moveTo(10,50); c.lineTo(23,62); c.stroke(); }
  c.fillStyle='#d3a884'; c.beginPath(); c.moveTo(-14,-64); c.quadraticCurveTo(-18,-48,-12,-35); c.lineTo(-5,-27); c.lineTo(6,-27); c.lineTo(14,-36); c.quadraticCurveTo(18,-50,13,-64); c.quadraticCurveTo(0,-73,-14,-64); c.fill();
  c.fillStyle='rgba(80,44,34,.26)'; c.beginPath(); c.moveTo(-12,-47); c.lineTo(-3,-30); c.lineTo(-13,-37); c.fill(); c.beginPath(); c.moveTo(12,-47); c.lineTo(3,-30); c.lineTo(13,-37); c.fill();
  c.fillStyle='#15100f'; c.beginPath(); c.moveTo(-18,-61); c.quadraticCurveTo(-8,-78,10,-70); c.quadraticCurveTo(21,-62,14,-47); c.lineTo(10,-62); c.quadraticCurveTo(-2,-56,-15,-60); c.fill();
  c.strokeStyle='#2a1a19'; c.lineWidth=1.2; c.beginPath(); c.moveTo(-10,-50); c.lineTo(-3,-51); c.moveTo(4,-51); c.lineTo(11,-50); c.stroke();
  c.fillStyle='#070709'; c.fillRect(-8,-48,4,1.5); c.fillRect(5,-48,4,1.5);
  c.strokeStyle='#6d4d42'; c.lineWidth=.9; c.beginPath(); c.moveTo(-8,-36); c.quadraticCurveTo(0,-31,8,-36); c.stroke();
  c.strokeStyle='rgba(245,218,180,.34)'; c.beginPath(); c.moveTo(-13,-45); c.lineTo(-8,-34); c.moveTo(13,-45); c.lineTo(8,-34); c.stroke();
}
function runSceneFade(done){
  if(!dom.sceneFade){ done(); return; }
  dom.sceneFade.classList.add('show');
  setTimeout(()=>{ done(); setTimeout(()=>dom.sceneFade.classList.remove('show'), 40); }, 400);
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
      { zh:'雷欧提斯的毒剑刺向哈姆雷特要害——奥菲莉亚以实体扑身保护，用短刃挡开毒锋，却被剑尖划伤倒下。' },
      { zh:'奥菲莉亚：“我不会再让你离开我。去吧，把该结束的了结。”', speak:true },
      { zh:'哈姆雷特毫发无伤，奥菲莉亚倒在花瓣与暗紫皮革之间；她的灵魂将随你直面王座。' }
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
    { zh:'若奥菲莉亚已替哈姆雷特挡剑，她将以蓝白亡魂之姿浮现，与弑君者同归于尽。' },
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
let bonusLevel=null;                 // 趣味支线状态：与 actIndex/currentAct 隔离
let bonusReturn=null;                // 进入趣味关前的回档点
let bonusBoardAct=0;
let bonusExitCooldownUntil=0;         // 退出趣味关后短暂冷却，避免回到主线入口后立刻重进

const BONUS_TITLES = ['登高挑战','宫廷回廊',"Monica's Test",'英格兰迷宫','决战前的独白'];
// 第五幕「决战前的独白」·全屏戏剧演出台词（To be or not to be，中英对照，逐行淡入）
const ACT5_MONOLOGUE = [
  { en:'To be, or not to be, that is the question:', zh:'生存还是毁灭，这是一个值得考虑的问题；' },
  { en:"Whether 'tis nobler in the mind to suffer", zh:'究竟是默然忍受命运暴虐的毒箭，' },
  { en:'The slings and arrows of outrageous fortune,', zh:'还是挺身反抗人世无涯的苦难，' },
  { en:'Or to take arms against a sea of troubles,', zh:'通过斗争把它们扫清，' },
  { en:'And by opposing end them? To die: to sleep;', zh:'这两种行为，哪一种更为高贵？死了；睡着了；' },
  { en:'No more; and by a sleep to say we end', zh:'什么都完了；倘若在这一种睡眠之中，' },
  { en:'The heart-ache and the thousand natural shocks.', zh:'心头的创痛，以及无数血肉之躯难免的打击，都能从此消失，' },
  { en:'The rest is silence.', zh:'此外仅余沉默。' }
];
function messageWidth(text){
  let width=0;
  for(const ch of text){ width += ch.charCodeAt(0)>127 ? 2 : 1; }
  return width;
}
function clampMessageInput(text){
  let out='', width=0, ascii=0, wide=0;
  for(const ch of text){
    const isWide = ch.charCodeAt(0)>127;
    const add = isWide ? 2 : 1;
    if(width + add > 20) break;
    if(isWide){ if(wide>=10) break; wide++; }
    else { if(ascii>=15) break; ascii++; }
    out += ch; width += add;
  }
  return out;
}
function messageStorageKey(act){ return 'hamlet_messages_act'+act; }
function messageThrottleKey(act){ return 'hamlet_message_last_act'+act; }
function normalizeMessageRow(row){
  if(typeof row==='string') return { nickname:'本地玩家', content:row, level:null };
  return { nickname:row.nickname||'匿名勇士', content:String(row.content||''), level:row.level };
}
function getMessages(act){
  try { return JSON.parse(safeStorageGet(messageStorageKey(act))||'[]').map(normalizeMessageRow).filter(v=>v.content); }
  catch{ return []; }
}
function setMessages(act, messages){ safeStorageSet(messageStorageKey(act), JSON.stringify(messages.slice(-30))); }
function paintMessages(messages){
  if(!dom.messageList) return;
  dom.messageList.textContent='';
  if(!messages.length){ const empty=document.createElement('div'); empty.className='msg'; empty.textContent='暂无留言，成为第一个记录者。'; dom.messageList.appendChild(empty); return; }
  messages.slice(0,20).forEach(msg=>{ const item=document.createElement('div'); item.className='msg'; item.textContent=(msg.nickname?msg.nickname+'：':'')+msg.content; dom.messageList.appendChild(item); });
}
function renderMessageList(act){ paintMessages(getMessages(act).slice().reverse()); }
async function loadRemoteMessages(act){
  if(!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('messages').select('nickname,content,level,created_at').eq('level', act).order('created_at', { ascending:false }).limit(20);
    if(error) throw error;
    if(Array.isArray(data)) paintMessages(data.map(normalizeMessageRow));
  } catch {}
}
function updateMessageMeta(){
  if(!dom.messageInput) return;
  const clamped=clampMessageInput(dom.messageInput.value);
  if(clamped!==dom.messageInput.value) dom.messageInput.value=clamped;
  dom.messageCount.textContent='宽度 '+messageWidth(dom.messageInput.value)+'/20（ASCII≤15，中文≤10）';
  dom.messageError.textContent='';
}
function openMessageBoard(act, title, promptText){
  bonusBoardAct=act;
  state='messageBoard';
  dom.messageTitle.textContent=title;
  dom.messagePrompt.textContent=promptText;
  dom.messageInput.value='';
  updateMessageMeta();
  renderMessageList(act);
  loadRemoteMessages(act);
  hideAllOverlays(); show(dom.messageBoard);
}
async function submitMessage(){
  const act=bonusBoardAct;
  const text=clampMessageInput((dom.messageInput.value||'').trim());
  const now=Date.now();
  const last=Number(safeStorageGet(messageThrottleKey(act))||0);
  if(!text){ dom.messageError.textContent='留言不能为空'; return; }
  if(now-last<5*60*1000){ dom.messageError.textContent='同一浏览器每关每5分钟限提交1条'; return; }
  const playerProfile = await ensurePlayerProfile();
  const message = { nickname:playerProfile.nickname||'匿名勇士', content:text, level:act };
  const messages=getMessages(act); messages.push(message); setMessages(act,messages);
  safeStorageSet(messageThrottleKey(act), String(now));
  dom.messageInput.value=''; updateMessageMeta(); renderMessageList(act);
  if(!supabaseClient){ dom.messageError.textContent='网络不可用，已保存到本地留言板'; return; }
  try {
    const { error } = await supabaseClient.from('messages').insert({ player_id:playerProfile.id, nickname:message.nickname, content:text, level:act });
    if(error) throw error;
    dom.messageError.textContent='已同步到全球留言板';
    loadRemoteMessages(act);
  } catch {
    dom.messageError.textContent='网络失败，已保存到本地留言板';
  }
}
function closeMessageBoard(){
  hide(dom.messageBoard);
  if(bonusLevel) exitBonus(true);
  else state=STATE.PLAY;
}

/* -------------------------------------------------------------------------
   非阻断式顶部对白栏（不切出 PLAY 状态，不暂停游戏，自动推进）
   ------------------------------------------------------------------------- */
const Dialog = {
  queue:[], src:[], cur:null, hold:0, gap:0, loop:true,
  isActive(){ return !!(this.cur && this.hold>0); },
  push(lines){ (lines||[]).forEach(l=>{ this.queue.push(l); this.src.push(l); }); },
  clear(){ this.queue=[]; this.src=[]; this.cur=null; this.hold=0; this.gap=0; this._hideBoth(); },
  _hideBoth(){ if(dom.dlgLeft){ dom.dlgLeft.classList.remove('show'); dom.dlgRight.classList.remove('show'); } },
  _speakerName(l){
    if(l.side==='left' && l.name==='哈姆雷特'){
      const nickname=getPlayerNickname();
      if(nickname) return '哈姆雷特（'+nickname+'）';
    }
    return l.name;
  },
  _fill(el,l){ if(!el) return; el.querySelector('.who').textContent=this._speakerName(l); el.querySelector('.zh').textContent=l.zh; el.querySelector('.en').textContent=l.en||''; },
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

function buildBonusLevel(bonusAct){
  const n=bonusAct;
  const lv={ width:1800, height:LEVEL_H, groundTop:GROUND_TOP,
    platforms:[], hazards:[], movers:[], breakables:[], chests:[], enemySpawns:[], checkpoints:[], triggers:[], pickups:[], rockEmitters:[],
    segments:[{x:0,name:'隐藏挑战（可选）'}], goalX:1640, playerStart:{x:70,y:GROUND_TOP}, completeMode:'bonus', bonusAct:n, bonusFinished:false };
  if(bonusAct===1){
    // 第一幕：Z 字形登高挑战 —— 左右来回逐层跳跃，踩上顶点平台通关
    lv.width=720; lv.height=760; lv.goalX=360; lv.playerStart={x:80,y:GROUND_TOP};
    lv.platforms.push({x:0,y:GROUND_TOP,w:lv.width,h:LEVEL_H-GROUND_TOP,type:'ground'}); // 全宽兜底地面（失手可重来）
    const LX=100, RX=lv.width/2-60, PW=160; // 左列 x / 右列 x / 平台宽度
    // [x, 距地面高度]，左右交替，每层 85px（≤95 普通跳跃可达）
    [[RX,85],[LX,170],[RX,255],[LX,340],[RX,425]].forEach(s=>lv.platforms.push({x:s[0],y:GROUND_TOP-s[1],w:PW,h:14,type:'plat'}));
    lv.platforms.push({x:40,y:GROUND_TOP-510,w:lv.width-80,h:16,type:'plat',board:true}); // 顶点平台（近全宽胜利区）
  } else if(bonusAct===2){
    // 第二幕：左右来回消灭敌人 —— 三波（左/中/右），高低台交错，全灭即胜
    lv.width=1600; lv.goalX=lv.width-140;
    lv.platforms.push({x:0,y:GROUND_TOP,w:lv.width,h:LEVEL_H-GROUND_TOP,type:'ground'});
    lv.platforms.push({x:300,y:GROUND_TOP-90,w:150,h:14,type:'plat'});
    lv.platforms.push({x:760,y:GROUND_TOP-100,w:150,h:14,type:'plat'});
    lv.platforms.push({x:1220,y:GROUND_TOP-90,w:150,h:14,type:'plat'});
    // 第一波（左区）
    lv.enemySpawns.push({type:'patrol',x:220,y:GROUND_TOP});
    lv.enemySpawns.push({type:'patrol',x:400,y:GROUND_TOP});
    lv.enemySpawns.push({type:'archer',x:360,y:GROUND_TOP-90});
    // 第二波（中区）
    lv.enemySpawns.push({type:'shield',x:720,y:GROUND_TOP});
    lv.enemySpawns.push({type:'patrol',x:920,y:GROUND_TOP});
    lv.enemySpawns.push({type:'archer',x:820,y:GROUND_TOP-100});
    // 第三波（右区）
    lv.enemySpawns.push({type:'patrol',x:1200,y:GROUND_TOP});
    lv.enemySpawns.push({type:'shield',x:1380,y:GROUND_TOP});
    lv.enemySpawns.push({type:'patrol',x:1320,y:GROUND_TOP-90});
    lv.pickups.push({x:600,y:GROUND_TOP-18,w:12,h:12,kind:'heart',taken:false});
    lv.pickups.push({x:1080,y:GROUND_TOP-18,w:12,h:12,kind:'heart',taken:false});
  } else if(bonusAct===3){
    // 第三幕：横向移动平台跳跃 —— 移动平台 + 固定休息台交替，左到右推进
    lv.width=2340; lv.goalX=2160;
    lv.platforms.push({x:0,y:GROUND_TOP,w:260,h:LEVEL_H-GROUND_TOP,type:'ground'});
    lv.platforms.push({x:2040,y:GROUND_TOP,w:300,h:LEVEL_H-GROUND_TOP,type:'ground'});
    lv.hazards.push({x:260,y:GROUND_TOP+10,w:1780,h:LEVEL_H-GROUND_TOP,type:'spike'});
    const RESTY=GROUND_TOP-46;
    // 固定休息台（给玩家喘息空间）
    [[300,120],[740,120],[1180,120],[1620,120]].forEach(r=>lv.platforms.push({x:r[0],y:RESTY,w:r[1],h:14,type:'plat'}));
    // 横向移动平台（宽 96、速度 0.65、来回 range 70）
    [520,960,1400,1840].forEach((bx,i)=>{ const by=RESTY-(i%2)*24; lv.movers.push({x:bx,y:by,w:96,h:12,type:'plat',axis:'x',range:70,speed:0.65,phase:i*0.9,baseX:bx,baseY:by}); });
    lv.deaths=0;
  } else if(bonusAct===4){
    // 第四幕：横向障碍跑 —— 矮墙 / 坑道交替，坑内有踏脚石低路，右侧终点
    lv.width=2100; lv.goalX=1960;
    lv.platforms.push({x:0,y:GROUND_TOP,w:850,h:LEVEL_H-GROUND_TOP,type:'ground'});
    lv.platforms.push({x:950,y:GROUND_TOP,w:750,h:LEVEL_H-GROUND_TOP,type:'ground'});
    lv.platforms.push({x:1800,y:GROUND_TOP,w:300,h:LEVEL_H-GROUND_TOP,type:'ground'});
    // 矮墙（需跳过，ground 类型阻挡）
    lv.platforms.push({x:520,y:GROUND_TOP-70,w:44,h:70,type:'ground'});
    lv.platforms.push({x:1350,y:GROUND_TOP-84,w:44,h:84,type:'ground'});
    // 坑道中的踏脚石（可走低路跨坑）
    lv.platforms.push({x:870,y:GROUND_TOP-40,w:60,h:14,type:'plat'});
    lv.platforms.push({x:1720,y:GROUND_TOP-40,w:60,h:14,type:'plat'});
    // 第二道矮墙前的高路平台（可绕过）
    lv.platforms.push({x:1230,y:GROUND_TOP-72,w:110,h:14,type:'plat'});
  } else {
    // 第五幕：横向+垂直混合 —— 前段横向推进，后段 Z 字形登高（8 层）至顶点特效区
    lv.width=1200; lv.height=760; lv.goalX=360;
    lv.platforms.push({x:0,y:GROUND_TOP,w:lv.width,h:LEVEL_H-GROUND_TOP,type:'ground'}); // 全宽兜底地面
    // 前段横向跳台
    lv.platforms.push({x:380,y:GROUND_TOP-70,w:110,h:14,type:'plat'});
    lv.platforms.push({x:560,y:GROUND_TOP-70,w:110,h:14,type:'plat'});
    // 后段 Z 字形登高（左列 740 / 右列 920，每层 66px，共 7 层 + 顶点）
    const LX=740, RX=920, PW=150;
    [[RX,66],[LX,132],[RX,198],[LX,264],[RX,330],[LX,396],[RX,462]].forEach(s=>lv.platforms.push({x:s[0],y:GROUND_TOP-s[1],w:PW,h:14,type:'plat'}));
    lv.platforms.push({x:700,y:GROUND_TOP-528,w:400,h:16,type:'plat',board:true}); // 顶点特效区
    // 决战前的独白：进入后先播放一段全屏戏剧演出，结束/跳过后再开始登高
    lv.monologue={ t:0, line:0, lineT:0, fade:0, walk:0, facing:1, ending:false, done:false, skipped:false, skipRect:null,
      px:W*0.5, walkDir:1, stepT:0, phase:0, phaseT:0, turnScale:1, lastVoiceLine:-1,
      pose:_monoBasePose(), smoke:_monoInitSmoke(), headX:W*0.5, headTopY:H*0.28 };
  }
  placeBonusExitPortal(lv, bonusAct);
  return lv;
}
function placeBonusExitPortal(lv, bonusAct){
  const portal = { w:56, h:104 };
  if(bonusAct===1 || bonusAct===5){
    const top=lv.platforms.find(p=>p.board);
    if(top){
      portal.x=top.x+top.w-portal.w-28;
      portal.y=top.y-portal.h;
    }
  }
  if(portal.x===undefined){
    portal.x=Math.max(80, Math.min(lv.goalX || lv.width-120, lv.width-portal.w-60));
    portal.y=GROUND_TOP-portal.h;
  }
  lv.exitPortal=portal;
}
// 为趣味关入口高台寻找“无障碍安全落点”：必须落在一整块连续地面上（主线无需跳跃通过），
// 且高台左右预留余量内没有坑/地刺，绝不放在必经跳跃平台或坑口上，避免主线前进误触入口。
function findSafeBonusPlatformX(lv, platformW, fallbackX){
  const margin = 180;                          // 高台距坑/地面边缘的安全余量（> 触发框半宽 + 跳跃余量）
  const minX = 380;                            // 避开出生点附近
  const maxX = lv.width * 0.55;                // 优先前中段，便于玩家发现
  const grounds = (lv.platforms||[])
    .filter(p=>p.type==='ground')
    .slice().sort((a,b)=>a.x-b.x);
  for(const g of grounds){
    const lo = Math.max(g.x + margin, minX);              // 该地面段可放置高台左边界的下限
    const hi = Math.min(g.x + g.w - margin - platformW, maxX); // 上限（右侧同样留余量）
    if(hi < lo) continue;                                 // 该段太窄，跳过
    const px = Math.round((lo + hi) / 2);
    // 校验：高台覆盖范围 ±margin 内没有任何坑/地刺/毒等 hazard
    const hasHazard = (lv.hazards||[]).some(h=>
      (h.x < px + platformW + margin) && (h.x + (h.w||0) > px - margin));
    if(hasHazard) continue;
    return px;
  }
  return fallbackX;
}
function groundSegAt(lv, x){
  const gs=(lv.platforms||[]).filter(p=>p.type==='ground' && x>=p.x && x<=p.x+p.w).sort((a,b)=>b.w-a.w)[0];
  return gs?{x1:gs.x, x2:gs.x+gs.w}:null;
}
function createBonusEntrance(lv, mainAct){
  const bonusAct = mainAct===ACT_ENGLAND ? 4 : (mainAct===ACT_FINAL ? 5 : mainAct+1);
  const cfg = BONUS_PLATFORM_CONFIGS[mainAct-1] || BONUS_PLATFORM_CONFIGS[0];
  const platformW = 150, platformH = 14;
  const fallbackX = Math.min(Math.max(380, cfg.platformX), Math.max(380, lv.width-260));
  let baseX = findSafeBonusPlatformX(lv, platformW, fallbackX);
  // 与已有空中平台（桥/踏脚石）保持横向偏移，避免入口贴着主线跳跃落点；偏移后仍须落在同一整块地面上
  const seg = groundSegAt(lv, baseX);
  const insideSeg = (bx)=> !seg || (bx-70>=seg.x1+40 && bx+platformW+30<=seg.x2-40);
  const existingPlats = (lv.platforms||[]).filter(p=>p.type!=='ground' && Math.abs(p.y-(GROUND_TOP-140))<160);
  const tooClose = (bx)=> existingPlats.some(p=> bx < p.x+p.w+platformW && bx+platformW > p.x-platformW);
  if(tooClose(baseX)){
    for(const cand of [baseX+platformW+60, baseX-platformW-60, baseX+2*(platformW+60)]){
      if(insideSeg(cand) && !tooClose(cand)){ baseX=cand; break; }
    }
  }
  // 入口高台：抬到「地面起跳峰值(≈GROUND_TOP-172)」之上，普通行进/跳跃绝不触发；须专程踩踏脚石攀爬
  const entranceY = GROUND_TOP - 196;
  // 之字形踏脚石（逐级抬升，rise<MAX_JUMP_UP / gap<MAX_JUMP_DX，单跳可达），整体紧凑落在安全地面段内
  lv.platforms.push({x:baseX+40, y:GROUND_TOP-72,  w:80,  h:platformH, type:'plat', color:'#b7972f', bonusStep:true});
  lv.platforms.push({x:baseX-60, y:GROUND_TOP-140, w:80,  h:platformH, type:'plat', color:'#bf9f37', bonusStep:true});
  lv.platforms.push({x:baseX,    y:entranceY,      w:platformW, h:platformH, type:'plat', color:'#c8a84b', bonusPad:true});
  // 触发区：必须「站上入口高台」才触发（贴台面上方 40px），不再悬浮于主线跳跃路径头顶
  lv.triggers.push({x:baseX+platformW/2-32, y:entranceY-40, w:64, h:40, type:'bonusEntrance', fired:false, persist:true, bonusAct, hint:cfg.hint});
  // 清理攀爬区间内的敌人/陷阱，保证专程攀爬过程安全
  const safeMin = baseX-100, safeMax = baseX+platformW+100;
  if(lv.enemySpawns) lv.enemySpawns = lv.enemySpawns.filter(s=>s.x<safeMin || s.x>safeMax);
  if(lv.hazards) lv.hazards = lv.hazards.filter(h=>h.x+(h.w||0)<safeMin || h.x>safeMax);
}

/* =========================================================================
   垂直分叉路机制 createBranchPaths(lv, actIdx)
   —— 每幕新增"额外探索分支"，绝不破坏主线通关。在 createBonusEntrance 之后调用，
      随后再次 ensureTraversable + sanitizeLevelCheckpoints（见 buildAct 尾部）。
   物理依据：单跳峰高≈128px（校验保守值 MAX_JUMP_UP=118），无二段跳。
   "连跳2次" = 借助一块踏脚台：地面→踏脚台(升96)→高台(再升104)，
      高台离地 200px（>118，单跳直达不了），必须连跳两次。
   ========================================================================= */
// 分支入口的横向回避距离（供检查点/出生点回避，仿照 bonusColumnDist）
function branchAvoidDist(lv, x){
  let d=Infinity;
  (lv._branchAvoid||[]).forEach(a=>{ d=Math.min(d, Math.abs(a.x-x)); });
  return d;
}
function branchGrounds(lv){
  return (lv.platforms||[]).filter(p=>p.type==='ground'&&Math.abs(p.y-GROUND_TOP)<1)
    .map(p=>({x1:p.x,x2:p.x+p.w,ref:p})).sort((a,b)=>a.x1-b.x1);
}
function branchNearBonus(lv, x, pad){ return bonusColumnDist(lv, x) < pad; }
function branchNearBoss(lv, x, pad){
  if(lv.bossArena && x > lv.bossArena.x - pad) return true;
  if(lv.bossPlan){ for(const b of lv.bossPlan){ if(b && Number.isFinite(b.triggerX) && Math.abs(b.triggerX-x)<pad+260) return true; } }
  return false;
}
function branchRegionHasHazard(lv, x0, x1){
  return (lv.hazards||[]).some(h=> h.x < x1 && h.x+(h.w||0) > x0);
}
function branchClearRegion(lv, x0, x1){
  if(lv.enemySpawns) lv.enemySpawns = lv.enemySpawns.filter(s=> s.x<x0 || s.x>x1);
  if(lv.hazards) lv.hazards = lv.hazards.filter(h=> h.x+(h.w||0)<x0 || h.x>x1);
}
// 在地面段上寻找可安放"上置结构（占地 footW）"的起跳中心 x，避开 bonus/boss/已占用/地刺
// 说明：分支平台（踏脚台/甲板/多层）为悬浮平台，可向右悬挑；只需起跳点脚下有地面即可
function pickBranchAnchor(lv, targetX, footW, occupied){
  const segs=branchGrounds(lv); let best=null,bd=Infinity;
  for(const s of segs){
    const lo=s.x1+50, hi=s.x2-50;     // 起跳点须在地面段内且距边≥50
    if(hi<lo) continue;
    for(let cx=Math.ceil(lo); cx<=hi; cx+=24){
      if(branchNearBonus(lv,cx,200)) continue;
      if(branchNearBoss(lv,cx,300)) continue;
      if(occupied.some(o=>Math.abs(o-cx)<Math.max(280,footW+80))) continue;
      if(branchRegionHasHazard(lv,cx-42,cx+42)) continue;   // 起跳点脚下无坑/地刺
      const d=Math.abs(cx-targetX); if(d<bd){ bd=d; best=cx; }
    }
  }
  return best;
}
// 为地下密道寻找一段"够宽、可开缺口并两侧留地"的地面段（扫描段内所有可行缺口位置）
function pickCarveSpot(lv, targetX, gapW, occupied){
  const segs=branchGrounds(lv); let best=null,bd=Infinity;
  for(const s of segs){
    const w=s.x2-s.x1; if(w < gapW+160) continue;   // 两侧各留 ≥80px 地面
    const loG=s.x1+80, hiG=s.x2-80-gapW;
    for(let gapX=Math.ceil(loG); gapX<=hiG; gapX+=24){
      const cx=gapX+gapW/2;
      if(branchNearBonus(lv,cx,240)) continue;
      if(branchNearBoss(lv,cx,340)) continue;
      if(occupied.some(o=>Math.abs(o-cx)<340)) continue;
      const d=Math.abs(cx-targetX); if(d<bd){ bd=d; best={gapX,cx,seg:s}; }
    }
  }
  return best;
}
// 在主线地面上开一处缺口（拆分覆盖的地面段），返回是否成功
function carveGroundGap(lv, gapX, gapW){
  const gx2=gapX+gapW; const keep=[]; const add=[]; let changed=false;
  for(const p of lv.platforms){
    if(p.type!=='ground' || Math.abs(p.y-GROUND_TOP)>=1){ keep.push(p); continue; }
    const px2=p.x+p.w;
    if(px2<=gapX || p.x>=gx2){ keep.push(p); continue; } // 不相交
    changed=true;
    if(p.x < gapX-6){ add.push(Object.assign({},p,{w:gapX-p.x})); }        // 左段
    if(px2 > gx2+6){ add.push(Object.assign({},p,{x:gx2, w:px2-gx2})); }   // 右段
  }
  if(changed){ lv.platforms = keep.concat(add); }
  return changed;
}
// 通用：水平中段"向上高台分支"（连跳2次 + 高台隐藏宝箱触发区）
function addUpperBranch(lv, cx){
  const stepY=GROUND_TOP-96, topY=GROUND_TOP-200;
  lv.platforms.push({x:cx-38, y:stepY, w:76,  h:14, type:'plat', branch:true});           // 踏脚台（连跳第1跳）
  lv.platforms.push({x:cx-24, y:topY,  w:130, h:14, type:'plat', branch:true, branchTop:true}); // 高台（连跳第2跳）
  lv.chests.push({x:cx+26, y:topY-22, w:28, h:22, open:false, taken:false, reward:'score', branch:true, label:'发现隐藏宝藏！'});
  branchClearRegion(lv, cx-70, cx+90);
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:cx, r:120});
}
// 通用：水平中后段"向下密道分支"（同关卡地形实现进/出，主线用踏脚石安全跨越）
function addUnderPassage(lv, spot){
  const gapX=spot.gapX, gapW=200, gx2=gapX+gapW;
  const floorY=GROUND_TOP+78;
  // 先移除缺口横向范围内、贴近地表的旧空中平台，避免挡住下落/顶部跨越
  lv.platforms = lv.platforms.filter(p=> p.type==='ground' || p.branch ||
    !(p.x < gx2+8 && p.x+p.w > gapX-8 && p.y < GROUND_TOP && p.y > GROUND_TOP-170));
  carveGroundGap(lv, gapX, gapW);
  // 主线安全跨越：顶部两块踏脚石（覆盖缺口，ensureTraversable 视为已补）
  lv.platforms.push({x:gapX+22,  y:GROUND_TOP-56, w:60, h:14, type:'plat', branch:true, bridge:true});
  lv.platforms.push({x:gapX+118, y:GROUND_TOP-56, w:60, h:14, type:'plat', branch:true, bridge:true});
  // 下层密道地板（一段可行走的下沉通道）
  lv.platforms.push({x:gapX+18, y:floorY, w:164, h:14, type:'plat', branch:true, tunnel:true});
  // 密道尽头小奖励触发区（音效+提示文字，复用宝箱机制）
  lv.chests.push({x:gapX+142, y:floorY-22, w:28, h:22, open:false, taken:false, reward:'ammo', branch:true, label:'密道尽头 · 发现补给！'});
  // 出口踏脚台：从密道地板跳回主线右侧地面
  lv.platforms.push({x:gapX+134, y:GROUND_TOP-8, w:58, h:14, type:'plat', branch:true});
  // 入口/密道区域清怪清陷阱，保证进出安全
  branchClearRegion(lv, gapX-30, gx2+30);
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:spot.cx, r:150});
}
function createBranchPaths(lv, actIdx){
  lv._branchAvoid = lv._branchAvoid||[];
  const W=lv.width, occupied=[];
  // 各幕的目标横向位置（按需回避 boss/彩蛋区，act5 放在墓地/前段走廊避开双 Boss 场）
  let upperT, underT, featT;
  if(actIdx===ACT_FINAL){ upperT=W*0.11; underT=W*0.19; featT=W*0.43; }
  else { upperT=W*0.44; underT=W*0.66; featT=W*0.30; }
  // (1) 向上高台分支（五幕都加）
  const upX = pickBranchAnchor(lv, upperT, 160, occupied);
  if(upX!=null){ addUpperBranch(lv, upX); occupied.push(upX); }
  // (2) 向下密道分支（五幕都加）
  const spot = pickCarveSpot(lv, underT, 200, occupied);
  if(spot){ addUnderPassage(lv, spot); occupied.push(spot.cx); }
  // (3) 各幕特色分支
  if(actIdx===ACT_CASTLE){ addCastleParapet(lv, pickBranchAnchor(lv, featT, 200, occupied), occupied); }
  else if(actIdx===ACT_ENGLAND){ addShipCabin(lv, pickBranchAnchor(lv, featT, 300, occupied), occupied); }
  else if(actIdx===ACT_FINAL){ addCastleFloors(lv, pickBranchAnchor(lv, featT, 300, occupied), occupied); }
}
// 第一幕特色：城垛可攀爬区（梯子触发区 → 城垛顶平台 + 俯瞰提示）
function addCastleParapet(lv, cx, occupied){
  if(cx==null) return;
  const topY=GROUND_TOP-150;
  lv.platforms.push({x:cx-70, y:topY, w:150, h:14, type:'plat', branch:true, parapet:true}); // 城垛顶
  // 梯子触发区：贴城垛左沿，从地面直达城垛顶
  lv.triggers.push({x:cx-70-14, y:topY, w:28, h:GROUND_TOP-topY, type:'ladder', persist:true, key:'ladder_'+Math.round(cx)});
  // 俯瞰提示（登顶触发一次）
  lv.triggers.push({x:cx-30, y:topY-46, w:100, h:44, type:'peak', fired:false, key:'peak_'+Math.round(cx)});
  lv.chests.push({x:cx+30, y:topY-22, w:28, h:22, open:false, taken:false, reward:'score', branch:true, viaLadder:true, label:'城垛藏宝！'});
  branchClearRegion(lv, cx-110, cx+110);
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:cx, r:110});
  occupied.push(cx);
}
// 第四幕特色：船舱门 → 小战斗区（独立平台 + 1~2 敌人 + 宝箱），打完可回主线
function addShipCabin(lv, cx, occupied){
  if(cx==null) return;
  const stepY=GROUND_TOP-70, deckY=GROUND_TOP-150;
  // 先清理入口区地面陷阱/散兵（在加入甲板战斗兵之前，避免被误删）
  branchClearRegion(lv, cx-60, cx+210);
  lv.platforms.push({x:cx-38, y:stepY, w:76,  h:14, type:'plat', branch:true});            // 上船踏脚台（起跳点在 cx）
  lv.platforms.push({x:cx-20, y:deckY, w:220, h:14, type:'plat', branch:true, cabin:true}); // 船舱甲板（战斗区，向右悬挑）
  // 舱门（甲板右侧）：门形状 + 触发区，进入提示
  lv.triggers.push({x:cx+168, y:deckY-52, w:30, h:52, type:'door', persist:true, fired:false, key:'door_'+Math.round(cx)});
  // 小战斗区：1~2 名敌人在甲板上
  lv.enemySpawns.push({type:'patrol', x:cx+70,  y:deckY});
  lv.enemySpawns.push({type:'archer', x:cx+150, y:deckY});
  lv.chests.push({x:cx+110, y:deckY-22, w:28, h:22, open:false, taken:false, reward:'ammo', branch:true, label:'船舱宝箱！'});
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:cx, r:120});
  occupied.push(cx);
}
// 第五幕特色：城堡多层楼（多层平台 + 楼梯连接，可在不同高度作战），不碰 Boss 主线
function addCastleFloors(lv, cx, occupied){
  if(cx==null) return;
  const t1=GROUND_TOP-80, t2=GROUND_TOP-160, t3=GROUND_TOP-240;
  lv.platforms.push({x:cx-70, y:t1, w:150, h:14, type:'plat', branch:true, floorTier:1});
  lv.platforms.push({x:cx-10, y:t2, w:150, h:14, type:'plat', branch:true, floorTier:2});
  lv.platforms.push({x:cx+50, y:t3, w:150, h:14, type:'plat', branch:true, floorTier:3});
  lv.enemySpawns.push({type:'skeleton', x:cx,    y:t1});
  lv.enemySpawns.push({type:'patrol',   x:cx+60, y:t2});
  lv.chests.push({x:cx+110, y:t3-22, w:28, h:22, open:false, taken:false, reward:'score', branch:true, label:'城堡顶层 · 王室珍藏！'});
  branchClearRegion(lv, cx-90, cx+210);
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:cx, r:130});
  occupied.push(cx);
}
/* =========================================================================
   【新增·叠加】一二三幕地图结构复杂化（全部为单向平台/梯子/装饰，主线地面不改动）
   - 单向平台(type:'plat')仅从上方落定、不阻挡水平移动，因此绝不影响主线跑动/碰撞
   - 装饰写入 lv._decor（世界层，由 drawStructureDecor 绘制），不参与碰撞
   ========================================================================= */
// 第一幕：多层城垛台阶（3-4 段高度递增，逐级梯子攀爬 + 中段守卫 + 顶部俯瞰藏宝）
function addCastleMultiTier(lv){
  const bx=2600; lv._decor=lv._decor||[];
  const tiers=[
    {x:bx,     y:GROUND_TOP-80,  w:150},
    {x:bx+120, y:GROUND_TOP-155, w:140},
    {x:bx+240, y:GROUND_TOP-230, w:130},
    {x:bx+360, y:GROUND_TOP-305, w:120}
  ];
  // 先清理该区域地面陷阱/散兵，随后再放置本结构的守卫（避免被清掉）
  branchClearRegion(lv, bx-100, bx+520);
  // 地面 → 第一级 起跳踏台
  lv.platforms.push({x:bx-70, y:GROUND_TOP-40, w:70, h:14, type:'plat', color:'#43414f', branch:true});
  tiers.forEach((t,i)=>{
    lv.platforms.push({x:t.x, y:t.y, w:t.w, h:14, type:'plat', color:'#4a4658', branch:true, parapetTier:i+1});
    lv._decor.push({type:'merlon', x:t.x+t.w-56, y:t.y});       // 城垛齿垛
    if(i%2===0) lv._decor.push({type:'torch', x:t.x+16, y:t.y-30, lit:true});
    else        lv._decor.push({type:'torch', x:t.x+16, y:t.y-30, lit:false});
    // 逐级梯子：从本级攀爬到上一更高级
    if(i<tiers.length-1){ const nt=tiers[i+1];
      lv.triggers.push({x:nt.x-16, y:nt.y, w:26, h:t.y-nt.y+14, type:'ladder', persist:true, key:'castleTier_'+i}); }
  });
  lv._decor.push({type:'brokencol', x:tiers[0].x+120, y:tiers[0].y, h:40});
  lv._decor.push({type:'brokencol', x:tiers[1].x+118, y:tiers[1].y, h:34});
  // 中段守卫 2-3（不同高度）
  lv.enemySpawns.push({type:'patrol', x:tiers[0].x+80, y:tiers[0].y});
  lv.enemySpawns.push({type:'archer', x:tiers[1].x+80, y:tiers[1].y});
  lv.enemySpawns.push({type:'shield', x:tiers[2].x+70, y:tiers[2].y});
  // 破石柱遮蔽（破坏物）
  lv.breakables.push({x:tiers[1].x+96, y:tiers[1].y-26, w:22, h:26, kind:'box', hp:2, hitT:0, dead:false, drop:'ammo'});
  // 顶层：俯瞰视野提示 + 藏宝
  const top=tiers[tiers.length-1];
  lv.triggers.push({x:top.x+10, y:top.y-46, w:100, h:44, type:'peak', fired:false, key:'castleTierPeak'});
  lv.chests.push({x:top.x+80, y:top.y-24, w:28, h:22, open:false, taken:false, reward:'score', branch:true, viaLadder:true, label:'城垛之巅 · 俯瞰全城的珍藏！'});
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:bx+200, r:300});
}
// 第二幕：塔楼内部垂直攀登（5 层螺旋、逐层变窄、可见楼梯踏台、每层不同宫廷装饰）
function addCourtTower(lv){
  const cx=2000, floors=5; lv._decor=lv._decor||[];
  branchClearRegion(lv, cx-120, cx+300);
  // 登塔起步踏台
  lv.platforms.push({x:cx-70, y:GROUND_TOP-38, w:70, h:14, type:'plat', color:'#a89468', branch:true});
  for(let i=0;i<floors;i++){
    const Yi=GROUND_TOP-70-i*68, w=170-i*22, fx=cx-10 + (i%2?30:-10);
    lv.platforms.push({x:fx, y:Yi, w:w, h:14, type:'plat', color:'#b8a478', branch:true, towerFloor:i+1});
    // 可见楼梯踏台（连接下一层）
    if(i>=1) lv.platforms.push({x:cx+ (i%2?46:6), y:Yi+34, w:48, h:12, type:'plat', color:'#9c8a64', branch:true, towerStair:true});
    // 每层不同宫廷装饰
    if(i===0){ lv._decor.push({type:'weaponrack', x:fx+w-30, y:Yi}); lv.enemySpawns.push({type:'patrol', x:fx+w/2, y:Yi}); }
    else if(i===1){ lv._decor.push({type:'painting', x:fx+8, y:Yi-34}); lv._decor.push({type:'carpet', x:fx+12, y:Yi-6, w:w-24}); lv.breakables.push({x:fx+w-26, y:Yi-26, w:22, h:26, kind:'box', hp:2, hitT:0, dead:false, drop:'coin'}); }
    else if(i===2){ lv._decor.push({type:'bookshelf', x:fx+6, y:Yi}); lv._decor.push({type:'candlerow', x:fx+w-42, y:Yi-2}); lv.enemySpawns.push({type:'archer', x:fx+w/2, y:Yi}); }
    else if(i===3){ lv._decor.push({type:'window', x:fx+8, y:Yi}); lv._decor.push({type:'curtain', x:fx+w-34, y:Yi-44}); lv.chests.push({x:fx+14, y:Yi-24, w:28, h:22, open:false, taken:false, reward:'ammo', branch:true, label:'塔楼窗畔 · 补给！'}); }
  }
  // 顶层：波洛涅斯偷窥处（帷幕 + 俯瞰 + 珍藏）
  const topY=GROUND_TOP-70-(floors-1)*68;
  lv._decor.push({type:'curtain', x:cx-6, y:topY-44});
  lv.triggers.push({x:cx-6, y:topY-46, w:96, h:44, type:'peak', fired:false, key:'courtTowerPeak'});
  lv.chests.push({x:cx+40, y:topY-24, w:28, h:22, open:false, taken:false, reward:'score', branch:true, label:'塔顶 · 波洛涅斯的窥视处'});
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:cx+80, r:300});
}
// 第三幕：迷宫式多路径（上/中/下三线 + 岔路标记 + 死路藏宝 + 藤蔓隐路 + 汇合下坡）
function addEscapeMaze(lv){
  const x0=1900, gy=GROUND_TOP, midY=gy-110, upperY=gy-200; lv._decor=lv._decor||[];
  branchClearRegion(lv, x0-60, x0+1060);   // 保持三线区域地面陷阱清空，主线更顺
  // 岔路口入口踏台 + 标记
  lv.platforms.push({x:x0-70, y:gy-56, w:64, h:14, type:'plat', color:'#4a3020', branch:true});
  lv._decor.push({type:'forkmark', x:x0-38, y:gy-56});
  // 中线平台链
  const midXs=[x0+40, x0+230, x0+430, x0+640, x0+850];
  midXs.forEach((mx,i)=> lv.platforms.push({x:mx, y:midY-(i%2?12:0), w:120, h:14, type:'plat', color:'#3f2a1a', branch:true, maze:'mid'}));
  // 上线平台链（更高，需从中线再跳）
  const upXs=[x0+140, x0+340, x0+560, x0+770];
  upXs.forEach((ux,i)=> lv.platforms.push({x:ux, y:upperY-(i%2?0:10), w:110, h:14, type:'plat', color:'#38261a', branch:true, maze:'up'}));
  // 死路：上线尽头再向上一段，尽头藏宝，需折返（藤蔓遮挡）
  const deadX=x0+950;
  lv.platforms.push({x:deadX, y:upperY-70, w:120, h:14, type:'plat', color:'#2f2016', branch:true, maze:'dead'});
  lv.chests.push({x:deadX+82, y:upperY-70-24, w:28, h:22, open:false, taken:false, reward:'score', branch:true, label:'死路尽头 · 隐藏宝箱！'});
  lv._decor.push({type:'vine', x:deadX-12, y:upperY-70});
  lv._decor.push({type:'rubble', x:x0+520, y:midY});          // 破墙分隔迷宫
  lv._decor.push({type:'abyss', x:x0+300, y:gy});             // 下线一侧深渊（纯视觉，无碰撞）
  // 敌人分布在中/上线
  lv.enemySpawns.push({type:'archer',   x:midXs[1]+60, y:midY});
  lv.enemySpawns.push({type:'skeleton', x:upXs[1]+55,  y:upperY});
  lv.enemySpawns.push({type:'patrol',   x:midXs[3]+60, y:midY});
  // 三线后段汇合 → 回主线的下坡踏台
  lv.platforms.push({x:x0+980, y:gy-64, w:64, h:14, type:'plat', color:'#4a3020', branch:true});
  // 岔路口奥菲莉亚指引剪影（3 处，帧驱动隐现）
  lv._decor.push({type:'opheliahint', x:x0+70,  y:gy-120,     ph:0.0});
  lv._decor.push({type:'opheliahint', x:x0+430, y:midY-58,    ph:2.1});
  lv._decor.push({type:'opheliahint', x:x0+770, y:upperY-48,  ph:4.2});
  (lv._branchAvoid=lv._branchAvoid||[]).push({x:x0+520, r:640});
}
function saveBonusReturn(entranceTrigger){
  return { actIndex, respawn:{x:player.x,y:player.y+player.h}, hp:player.hp, ammo:player.ammo, score, stats:Object.assign({},stats), entrance: entranceTrigger ? {x:entranceTrigger.x, y:entranceTrigger.y, w:entranceTrigger.w, h:entranceTrigger.h} : null };
}
function restoreMainMusic(){
  let mus=ACTS[actIndex]?ACTS[actIndex].music:'castle';
  if(actIndex===ACT_FINAL) mus=opheliaSaved?'hero':'imperial';
  Sound.setMusic(mus, 1);
}
function enterBonus(actNumber, entranceTrigger){
  if(bonusLevel || frame<bonusExitCooldownUntil) return;
  bonusReturn=saveBonusReturn(entranceTrigger); bonusLevel={act:actNumber, kind:BONUS_TITLES[actNumber-1]};
  level=buildBonusLevel(actNumber); player=makePlayer(level.playerStart.x, level.playerStart.y); player.hp=bonusReturn.hp; player.ammo=bonusReturn.ammo;
  enemies=[]; projectiles=[]; rocks=[]; particles=[]; floaters=[]; petals=[]; texts=[]; boss=null; bossStarted=false; companion=null;
  level.enemySpawns.forEach(s=>enemies.push(makeEnemy(s.type,s.x,s.y)));
  respawn={x:level.playerStart.x,y:level.playerStart.y}; camX=0; camY=0; state=STATE.PLAY; Dialog.clear();
  dom.levelLabel.textContent='趣味支线 · '+bonusLevel.kind; dom.timerRow.style.display='none';
  // 第五幕「决战前的独白」：以 NT Live 风格管弦配乐替代常规 BGM 贯穿全程演出
  if(actNumber===5){ Sound.stopMusic(); Sound.monologueScore(); } else { Sound.setMusic(ACTS[actNumber-1].music, .85); }
  addFloater(player.x+60, player.y-30, '隐藏挑战开始 · Esc 放弃返回', '#e8c25a', 14);
}
function exitBonus(success){
  const saved=bonusReturn; const done=bonusLevel;
  if(!saved) return;
  bonusLevel=null; bonusReturn=null; bonusExitCooldownUntil=frame+18; hide(dom.messageBoard);
  keys.left=keys.right=keys.jump=keys.attack=keys.ranged=false;
  jumpEdge=atkEdge=rangedEdge=false;
  loadLevel(saved.actIndex, true);
  score=saved.score; stats=saved.stats; dom.scoreVal.textContent=score;
  respawn=safeRespawnValue({x:saved.respawn.x,y:saved.respawn.y});
  let safeX = respawn.x;
  let safeY = respawn.y;
  if(saved.entrance){
    const safe=safeSpawnPoint(level, saved.entrance.x - PLAYER_W - 36, saved.respawn.y);
    safeX=safe.x; safeY=safe.y; respawn=safe;
  }
  player=makePlayer(safeX, safeY); player.hp=saved.hp; player.ammo=saved.ammo; player.vx=0; player.vy=0; player.invuln=90;
  camX=clamp(player.x-VW/2,0,level.width-VW); camY=clamp(player.y-VH*0.55,0,level.height-VH);
  state=STATE.PLAY; goalReached=false; restoreMainMusic(); updateHUD();
  if(success && done) addFloater(player.x+player.w/2, player.y-35, '支线完成：'+done.kind, '#e8c25a', 14);
  else addFloater(player.x+player.w/2, player.y-35, '已返回主线检查点', '#c9b06a', 14);
}

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
  ghostking:{ name:'恶灵 · 老哈姆雷特国王', label:'恶灵先王 · THE WRAITH KING', w:48,h:98, phases:3, hp:170, music:'wraith', summon:true, ranged:'spectral', dash:false, ult:false },
  clown:    { name:'小丑 · 波洛涅斯',       label:'小丑波洛涅斯 · THE FOOL',     w:44,h:90, phases:2, hp:120, music:'palace', summon:false, ranged:'throw', dash:true, ult:false },
  rosencrantz:  { name:'罗森格兰兹',        label:'罗森格兰兹 · ROSENCRANTZ',    w:40,h:86, phases:1, hp:90,  music:'boss', summon:false, ranged:'arrow', dash:false, ult:false, midboss:true },
  guildenstern: { name:'吉尔登斯顿',        label:'吉尔登斯顿 · GUILDENSTERN',   w:40,h:86, phases:1, hp:100, music:'boss', summon:false, ranged:false, dash:true,  ult:false, midboss:true },
  assassin: { name:'英格兰雇佣刺客队长',    label:'刺客队长 · ASSASSIN CAPTAIN', w:44,h:92, phases:2, hp:180, music:'england', summon:true, ranged:'dagger', dash:true, ult:false },
  laertes:  { name:'雷欧提斯',              label:'雷欧提斯 · LAERTES（毒剑）',  w:42,h:90, phases:1, hp:150, music:'lament', summon:false, ranged:false, dash:true, ult:false, poisonBlade:true, midboss:true },
  claudius: { name:'克劳迪奥',              label:'克劳迪奥 · CLAUDIUS',         w:44,h:90, phases:3, get hp(){return opheliaSaved?210:240;}, get music(){return opheliaSaved?'hero':'imperial';}, summon:true, ranged:'poison', dash:true, ult:true, final:true }
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
  if(idx!==ACT_FINAL){ opheliaWounded=false; ghostOpheliaFinale=false; }
  else { ghostOpheliaFinale=false; }
  // 湖边彩蛋成功后，奥菲莉亚在英格兰幕与终章全程助战
  if((idx===ACT_ENGLAND||idx===ACT_FINAL) && opheliaSaved){ companion=makeCompanion('ophelia'); }
  boss=null; bossStarted=false; activeBossEntry=null; poisonT=0;
  shockwaves=[];
  respawn={x:level.playerStart.x, y:level.playerStart.y};
  checkpointActive=null; goalReached=false; deathFade=0; midFired={}; bowHintT=0;
  goalLocked=false;
  // 第四幕船舱子状态复位（切换任意幕都彻底清零，绝不残留影响其它幕）
  cabinActive=false; cabinPhase=null; cabinPhaseT=0; cabinFade=0;
  rockAngle=0; rockOffset=0;
  cabinLevel=null; deckLevel=null; deckSnap=null; cabinReturn=null; cabinDoorTr=null;
  cabinCleared=false; cabinWave=0; cabinWaveState='idle'; cabinWaveT=0; cabinPrompt=null; playerSlowT=0;
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
  if(idx===ACT_LAKE) addScreenFloater(W/2, 148, '救援奥菲莉亚：倒计时内抵达水中花环，水面即死', '#dfeaf5', 15, 150);
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
  // 舷窗水柱减速 debuff：临时降低移动速度与加速度（仅船舱内会被置位）
  const slowed = playerSlowT>0;
  const maxSpd = slowed ? MOVE_SPEED*0.45 : MOVE_SPEED;
  if(move){ p.facing=move; p.vx += move*(p.onGround?0.9:AIR_ACCEL)*(slowed?0.5:1); p.vx=clamp(p.vx,-maxSpd,maxSpd); }
  else if(p.onGround){ p.vx*=FRICTION; if(Math.abs(p.vx)<0.15)p.vx=0; }
  // 跳跃（土狼时间 + 缓冲）
  if(p.onGround) p.coyote=6; else if(p.coyote>0) p.coyote--;
  if(jumpEdge) p.jumpBuf=7; else if(p.jumpBuf>0) p.jumpBuf--;
  // 梯子攀爬（第一幕城垛分支）：站在梯子触发区内、按上/跳键则匀速上爬，覆盖普通起跳
  const onLadder = !bonusLevel && level.triggers && level.triggers.some(tr=>tr.type==='ladder'
    && rectsOverlap({x:p.x,y:p.y,w:p.w,h:p.h}, tr));
  if(onLadder && keys.jump){ p.vy=-3.4; p.onGround=false; p.coyote=0; p.jumpBuf=0; p._climbing=true; }
  else { p._climbing=false; if(p.jumpBuf>0 && p.coyote>0){ p.vy=JUMP_VEL; p.onGround=false; p.coyote=0; p.jumpBuf=0; Sound.jump(); burst(p.x+p.w/2,p.y+p.h,'rgba(180,175,190,0.7)',5,2); } }
  if(!keys.jump && p.vy<-4) p.vy*=0.86; // 短跳
  // 攻击
  if(atkEdge && p.atkCd<=0 && p.hurtT<=0){
    if(p.energy>=p.maxEnergy && bossStarted){ ultAttack(); }
    else { p.atkT=12; p.atkCd=22; p._swingHits=new Set(); p.pose.type='atk'; p.pose.frame=0; Sound.battleCue('hamletAttack'); }
  }
  if(p.atkT>0){ doMelee(); }
  // 远程
  if(rangedEdge && hasBow && p.rangedCd<=0 && p.ammo>0 && p.hurtT<=0){ fireArrow(); }
  // 计时器
  if(p.atkT>0)p.atkT--; if(p.atkCd>0)p.atkCd--; if(p.rangedCd>0)p.rangedCd--;
  if(p.invuln>0)p.invuln--; if(p.hurtT>0)p.hurtT--; if(p.ultActive>0)p.ultActive--;
  // 物理
  const solids=solidsList();
  // 第四幕船只摇晃：仅对玩家施加正弦力（敌兵/NPC 不受影响；舱内与其它幕 rockAngle/rockOffset=0）
  // 用户指定公式为唯一玩家摇晃力来源，旧 shipTiltParams 对 player 的 ax 施力已移除。
  if(actIndex===ACT_ENGLAND && shipRock && !cabinActive){
    // 大浪阶段（清舱后 Boss 战前）：振幅系数 ×1.5、频率 ×1.5
    const surge = cabinCleared ? 1.5 : 1.0;
    const f = frame * 0.015 * surge;
    rockAngle = Math.sin(f) * 0.04 * surge;
    const rockDir = 1;
    p.vy += Math.cos(f) * 0.018 * surge * rockDir;
    p.x  += Math.sin(f + 1) * 0.12 * surge;
    rockOffset = Math.sin(f) * 6 * surge;
  } else {
    // 舱内或其它幕：不施力、无视觉倾斜
    rockAngle = 0; rockOffset = 0;
  }
  stepPhysics(p, solids);
  // 掉出世界底部
  if(p.y>level.height+40){ if(bonusLevel){ if(level.deaths!==undefined) level.deaths++; p.x=respawn.x; p.y=respawn.y-PLAYER_H; p.vy=0; p.hp=p.maxHp; p.invuln=60; return; } if(actIndex===3) drownPlayer(); else damagePlayer(30, p.x); if(!p.dead){ teleportPlayerToSafeRespawn('已传送回安全检查点'); } }
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
      if(rectsOverlap(feet,hz)){
        if(actIndex===3){ drownPlayer(); }
        else if(cabinActive){ // 船舱活板门下的海水：大额掉血 + 溅起水花 + 传送回舱口
          for(let i=0;i<12;i++) ripple(p.x+rand(-14,14), GROUND_TOP+rand(0,14));
          burst(p.x+p.w/2, GROUND_TOP+8, 'rgba(150,200,235,0.85)', 14, 5);
          damagePlayer(45, hz.x+hz.w/2); if(!p.dead){ p.vy=-6; teleportPlayerToSafeRespawn('落入海水！传送回舱口'); }
        }
        else { damagePlayer(20,hz.x+hz.w/2); if(!p.dead){ p.vy=-6; teleportPlayerToSafeRespawn('已传送回安全检查点'); } } return; }
    } else if(hz.type==='spike'){
      if(rectsOverlap(feet,hz)){ if(bonusLevel){ if(level.deaths!==undefined) level.deaths++; p.x=respawn.x; p.y=respawn.y-PLAYER_H; p.vy=0; p.hp=p.maxHp; p.invuln=50; addFloater(p.x+p.w/2,p.y-16,'死亡次数 '+level.deaths,'#ff8a8a',13); return; } damagePlayer(14, p.x+ (p.x<hz.x+hz.w/2? -20:20)); if(!p.dead){ p.vy=-7; } return; }
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
      cp.active=true; checkpointActive=cp; respawn=safeRespawnValue(cp);
      addFloater(respawn.x, respawn.y-52, '检查点', ACTS[actIndex].accent, 14); Sound.checkpoint();
      if(cp.bossGate) respawn._bossGate=true;
    }
  }
  // 触发区
  for(const tr of level.triggers){ if(tr.fired && !tr.persist) continue;
    const overlapping = rectsOverlap({x:player.x,y:player.y,w:player.w,h:player.h}, tr);
    if(tr.type==='bonusEntrance' && tr._reentryLock && !overlapping) tr._reentryLock=false;
    if(overlapping && !(tr.type==='bonusEntrance' && tr._reentryLock)){ fireTrigger(tr); }
  }
  // 隐藏宝箱
  for(const ch of level.chests){ if(ch.taken) continue;
    if(rectsOverlap(player, {x:ch.x,y:ch.y,w:ch.w,h:ch.h})){
      ch.taken=true; ch.open=true; stats.secrets++; Sound.pickup();
      const tag = ch.label || '隐藏宝箱!';
      for(let i=0;i<14;i++) burst(ch.x+ch.w/2, ch.y+ch.h/2, '#e8c25a', 1, 3);
      if(ch.reward==='ammo' && hasBow){ player.ammo=Math.min(player.maxAmmo,player.ammo+6); addFloater(ch.x+ch.w/2,ch.y-8,tag+' +6 箭','#c9a6ff',14); }
      else { addScore(200); addFloater(ch.x+ch.w/2,ch.y-8,tag+' +200','#e8c25a',14); }
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
  } else if(tr.type==='hint'){
    addFloater(player.x+player.w/2, player.y-44, tr.msg || '换条路试试！', '#e8c25a', 15);
  } else if(tr.type==='yorick'){ // 终章墓地
    showStory(STORY.a5_yorick, ()=>{ state=STATE.PLAY; });
  } else if(tr.type==='rescue'){ // 湖畔救援成功
    rescueOphelia();
  } else if(tr.type==='bonusEntrance'){
    enterBonus(tr.bonusAct, tr);
    tr._reentryLock = true;
  } else if(tr.type==='ladder'){
    // 攀爬区：实际爬升在 updatePlayer 中处理；此处仅保持 persist，不做动作
    tr.fired=false; // 允许持续绘制与后续再触发（幂等）
  } else if(tr.type==='peak'){ // 城垛之巅：俯瞰提示（登顶一次）
    addFloater(player.x+player.w/2, player.y-40, '登上城垛之巅 · 俯瞰全城 Elsinore', '#ffe6a0', 15);
    Sound.checkpoint();
  } else if(tr.type==='door'){ // 船舱门：进入交互改由靠近 + ↑ 处理（updateCabinDeckPrompt），此处仅保持持续绘制
    tr.fired=false; // persist 门体持续绘制
  }
}

/* =========================================================================
   第四幕「船舱战斗区」子系统 —— 玩法 / 陷阱 / 华丽视觉 / 船只摇晃
   全部以 ACT_ENGLAND / cabinActive / cabinPhase 严格 guard，绝不触碰其它幕。
   ========================================================================= */
// 船只摇晃参数：仅第四幕生效；舱内 tilt=0；大浪阶段（清舱后 Boss 前）幅度加大、周期缩短。
function shipTiltParams(){
  if(actIndex!==ACT_ENGLAND || cabinActive) return {amp:0, period:180};
  if(cabinCleared) return {amp:0.06, period:120};   // 大浪阶段：±0.06 rad，周期 2s
  return {amp:0.035, period:180};                   // 常规颠簸：±0.035 rad，周期 3s
}
// 波次配置（越后波越强：patrol→skeleton/archer→shield→shield/elite）
const CABIN_WAVES = [
  [{type:'patrol',x:300},{type:'patrol',x:600}],
  [{type:'skeleton',x:260},{type:'patrol',x:470},{type:'archer',x:700}],
  [{type:'shield',x:300},{type:'archer',x:680},{type:'skeleton',x:470}],
  [{type:'shield',x:280},{type:'shield',x:700},{type:'elite',x:470}]
];
function findCabinDoor(){
  if(!level||!level.triggers) return null;
  for(const tr of level.triggers){ if(tr.type==='door') return tr; }
  return null;
}
// 甲板：靠近舱门显示提示，按 ↑ 进入；返回 true 表示本帧开始进舱
function updateCabinDeckPrompt(){
  const tr=findCabinDoor();
  if(tr){
    const near = Math.abs((player.x+player.w/2)-(tr.x+tr.w/2))<64 && Math.abs((player.y+player.h/2)-(tr.y+tr.h/2))<98;
    if(near){
      if(!cabinCleared){
        cabinPrompt='↑ 进入舱门';
        if(jumpEdge && player.onGround){ jumpEdge=false; startCabinEnter(tr); return true; }
      } else {
        cabinPrompt='舱室已肃清 · 甲板刺客队长现身';
      }
    }
  }
  // 未清舱却逼近 Boss 区：提示先去船舱（避免误以为主线卡死）
  if(!cabinCleared && level.bossArena && player.x+player.w > level.bossArena.x-260 && player.x < level.bossArena.x+60){
    cabinPrompt='刺客队长尚未现身——先潜入船舱肃清伏兵';
  }
  return false;
}
function startCabinEnter(tr){
  cabinDoorTr=tr; if(tr) tr._open=0;
  cabinReturn={x:player.x, y:player.y, facing:player.facing};
  cabinPhase='opening'; cabinPhaseT=0;
  player.vx=0; player.vy=0;
  Sound.blip(300,.2,'square',.24); Sound.noise(.35,.14,0,460);
  addScreenFloater(W/2,150,'推开舱门 · 潜入船舱','#ffe0b0',15,80);
}
function startCabinExit(){
  if(!cabinActive || cabinPhase!=='active') return;
  cabinPhase='toDeck'; cabinPhaseT=0; cabinPrompt=null;
  player.vx=0; player.vy=0; player.jumpBuf=0; player.coyote=0;
  Sound.blip(300,.2,'square',.22);
}
// 过场状态机（开门→淡黑→切场→淡入→战斗；返回同理）
function updateCabinTransition(){
  cabinPhaseT++;
  const DOOR_T=42, FADE_T=22;
  if(cabinPhase==='opening'){
    if(cabinDoorTr) cabinDoorTr._open=Math.min(1, cabinPhaseT/DOOR_T);
    if(cabinPhaseT>=DOOR_T){ cabinPhase='toCabin'; cabinPhaseT=0; }
  } else if(cabinPhase==='toCabin'){
    cabinFade=Math.min(1, cabinPhaseT/FADE_T);
    if(cabinFade>=1){ enterCabinScene(); cabinPhase='inCabin'; cabinPhaseT=0; }
  } else if(cabinPhase==='inCabin'){
    cabinFade=Math.max(0, 1-cabinPhaseT/FADE_T);
    if(cabinFade<=0){ cabinFade=0; cabinPhase='active'; cabinPhaseT=0; startCabinWave(0); }
  } else if(cabinPhase==='toDeck'){
    cabinFade=Math.min(1, cabinPhaseT/FADE_T);
    if(cabinFade>=1){ exitCabinScene(); cabinPhase='inDeck'; cabinPhaseT=0; }
  } else if(cabinPhase==='inDeck'){
    cabinFade=Math.max(0, 1-cabinPhaseT/FADE_T);
    if(cabinFade<=0){ cabinFade=0; cabinPhase=null; cabinPhaseT=0; }
  }
}
function enterCabinScene(){
  deckLevel=level;
  // 快照甲板实体，返回时原样恢复（不重建关卡，保留击杀/宝箱/位置进度）
  deckSnap={ enemies, projectiles, rocks, boss, bossStarted, activeBossEntry, respawn };
  if(!cabinLevel) cabinLevel=buildCabinLevel();
  cabinResetTraps();
  level=cabinLevel; cabinActive=true;
  enemies=[]; projectiles=[]; rocks=[]; boss=null; bossStarted=false; activeBossEntry=null;
  player.x=cabinLevel.playerStart.x; player.y=cabinLevel.playerStart.y-PLAYER_H;
  player.vx=0; player.vy=0; player.invuln=60; player.facing=1;
  respawn={x:cabinLevel.playerStart.x, y:cabinLevel.playerStart.y};
  camX=clamp(player.x-VW/2, 0, cabinLevel.width-VW); camY=clamp(player.y-VH*0.55, 0, cabinLevel.height-VH);
  cabinWave=0; cabinWaveState='idle'; playerSlowT=0;
  if(dom.levelLabel) dom.levelLabel.textContent='英格兰流亡 · 船舱战斗区';
  Sound.setMusic('england', .95);
}
function exitCabinScene(){
  level=deckLevel; cabinActive=false;
  if(deckSnap){ enemies=deckSnap.enemies; projectiles=deckSnap.projectiles; rocks=deckSnap.rocks;
    boss=deckSnap.boss; bossStarted=deckSnap.bossStarted; activeBossEntry=deckSnap.activeBossEntry; respawn=deckSnap.respawn; }
  const rx=cabinReturn?cabinReturn.x:(deckLevel.playerStart.x), ry=cabinReturn?cabinReturn.y:(deckLevel.playerStart.y-PLAYER_H);
  player.x=rx; player.y=ry; player.vx=0; player.vy=0; player.invuln=60; player.facing=1;
  camX=clamp(player.x-VW/2, 0, level.width-VW); camY=clamp(player.y-VH*0.55, 0, level.height-VH);
  playerSlowT=0;
  if(dom.levelLabel) dom.levelLabel.textContent=ACTS[ACT_ENGLAND].name;
  Sound.setMusic('england', 1);
  addScreenFloater(W/2,150, cabinCleared?'船舱肃清 · 返回甲板，刺客队长现身！':'返回甲板','#ffe0b0',15,140);
}
// 构建独立船舱关卡（连续地面 + 两处活板门缺口 + 板条箱障碍 + 海水陷阱）
function buildCabinLevel(){
  const width=960, floorH=LEVEL_H-GROUND_TOP;
  const lv={ width, height:LEVEL_H, groundTop:GROUND_TOP,
    platforms:[], hazards:[], movers:[], breakables:[], chests:[], enemySpawns:[],
    checkpoints:[], triggers:[], pickups:[], rockEmitters:[], segments:[],
    goalX:width-40, playerStart:{x:64,y:GROUND_TOP}, exitX:916, isCabin:true, completeMode:'none' };
  // 活板门缺口范围
  const traps=[ {x:316,w:88}, {x:560,w:88} ];
  // 连续地面（在活板门处留缺口，缺口由可开合的门板填补）
  let cur=0;
  for(const t of traps){ if(t.x>cur) lv.platforms.push({x:cur, y:GROUND_TOP, w:t.x-cur, h:floorH, type:'ground'}); cur=t.x+t.w; }
  if(cur<width) lv.platforms.push({x:cur, y:GROUND_TOP, w:width-cur, h:floorH, type:'ground'});
  // 活板门门板（关闭时填补缺口成为可站立地面；开启时移出视野→掉入下方海水）
  lv.trapdoors=[];
  traps.forEach((t,i)=>{
    const plank={x:t.x, y:GROUND_TOP, w:t.w, h:floorH, type:'ground', trapPlank:true};
    lv.platforms.push(plank);
    const water={x:t.x+4, y:GROUND_TOP+42, w:t.w-8, h:floorH-42, type:'water', _hidden:true};   // 缺口下方海水（关闭时隐藏）
    lv.hazards.push(water);
    lv.trapdoors.push({ x:t.x, w:t.w, plank, water, phase:(i*150)|0, period:300, openDur:96, warnLead:120, open:false, warn:false });
  });
  // 板条箱障碍（不规则 hnoise 布局，作为 solids 阻挡走位；控制在安全落脚区）
  lv.crates=[];
  const crateSpots=[190, 452, 704, 848];
  crateSpots.forEach((bx,i)=>{
    const s=24+((hnoise(i*7+3)*8)|0);
    const cx=bx + (hnoise(i*5+1)*30-15);
    const cr={x:cx, y:GROUND_TOP-s, w:s, h:s, tilt:(hnoise(i*3)*0.4-0.2)};
    lv.crates.push(cr);
    lv.platforms.push({x:cr.x, y:cr.y, w:cr.w, h:s, type:'ground', crate:true});
  });
  // 头顶压缩天花板（覆盖左/中区，逼玩家向右推进）
  lv.ceiling={ x:88, w:452, h:36, restY:GROUND_TOP-262, lowY:GROUND_TOP-66, y:GROUND_TOP-262, phase:40, period:360, warnLead:66, descentT:96, hitCd:0, warn:false };
  // 舷窗（可爆裂喷海水的三处）
  lv.portholes=[ {x:210,y:GROUND_TOP-152,burstT:0,broken:false}, {x:486,y:GROUND_TOP-160,burstT:0,broken:false}, {x:770,y:GROUND_TOP-150,burstT:0,broken:false} ];
  lv._portT=0;
  return lv;
}
function cabinResetTraps(){
  const lv=cabinLevel; if(!lv) return;
  lv.trapdoors.forEach((t,i)=>{ t.phase=(i*150)|0; t.open=false; t.warn=false; t.plank.y=GROUND_TOP; if(t.water) t.water._hidden=true; });
  if(lv.ceiling){ lv.ceiling.phase=40; lv.ceiling.y=lv.ceiling.restY; lv.ceiling.warn=false; lv.ceiling.hitCd=0; }
  lv.portholes.forEach(p=>{ p.burstT=0; p.broken=false; }); lv._portT=0;
}
function startCabinWave(i){
  cabinWave=i;
  const spec=CABIN_WAVES[i];
  for(const s of spec){
    const e=makeEnemy(s.type, s.x, GROUND_TOP, {hpBonus:i});
    e.ignoreShipTilt=true;
    enemies.push(e);
    // 入场烟雾爆破
    burst(s.x, GROUND_TOP-18, '#39424a', 16, 4);
    smoke(s.x, GROUND_TOP-22, 'rgba(90,104,116,0.6)'); smoke(s.x-6, GROUND_TOP-30, 'rgba(60,72,84,0.5)'); smoke(s.x+6, GROUND_TOP-26, 'rgba(70,82,96,0.5)');
  }
  Sound.blip(170,.14,'square',.2); Sound.noise(.22,.12,0,600);
  cabinWaveState='fighting';
  addScreenFloater(W/2,150,'第 '+(i+1)+' / '+CABIN_WAVES.length+' 波 · 雇佣刺客来袭','#ffcf9a',15,110);
}
function updateCabin(){
  updateCabinTraps();
  if(cabinWaveState==='fighting'){
    if(!enemies.some(e=>!e.dying)){
      cabinWaveState='cleared'; cabinWaveT=frame;
      if(cabinWave+1<CABIN_WAVES.length) addScreenFloater(W/2,150,'本波肃清 · 准备迎战下一波','#c9e0a0',14,80);
    }
  } else if(cabinWaveState==='cleared'){
    if(frame-cabinWaveT>96){
      if(cabinWave+1<CABIN_WAVES.length) startCabinWave(cabinWave+1);
      else { cabinWaveState='done'; cabinCleared=true;
        addScreenFloater(W/2,150,'船舱肃清完毕！走到右侧舱口 ↑ / ESC 返回甲板','#ffe6a0',15,180);
        Sound.checkpoint(); }
    }
  } else if(cabinWaveState==='done'){
    checkCabinReturn();
  }
}
function checkCabinReturn(){
  const ex=cabinLevel.exitX;
  const near=Math.abs((player.x+player.w/2)-ex)<52 && player.onGround;
  if(near){ cabinPrompt='↑ / ESC 返回甲板'; if(jumpEdge){ jumpEdge=false; startCabinExit(); } }
}
// 陷阱统一更新：活板门开合 / 天花板下压 / 舷窗爆裂水柱 + 减速 debuff
function updateCabinTraps(){
  const lv=cabinLevel; if(!lv) return;
  if(playerSlowT>0) playerSlowT--;
  // 活板门：周期开合，开启前 warnLead 帧红光警示
  for(const t of lv.trapdoors){
    t.phase=(t.phase+1)%t.period;
    const wantOpen = t.phase < t.openDur;
    t.warn = (!wantOpen) && (t.phase > t.period - t.warnLead);
    if(wantOpen && !t.open){ t.open=true; t.plank.y=LEVEL_H+400; if(t.water) t.water._hidden=false; Sound.noise(.22,.12,0,420); }
    else if(!wantOpen && t.open){ t.open=false; t.plank.y=GROUND_TOP; if(t.water) t.water._hidden=true; }
    // 落水视觉（伤害/传送由 checkHazards 的 water 分支处理）
    if(t.open && player.x+player.w>t.x && player.x<t.x+t.w && player.y+player.h>GROUND_TOP+6 && frame%3===0){
      for(let i=0;i<3;i++) ripple(player.x+rand(-8,8), GROUND_TOP+rand(0,10));
    }
  }
  updateCabinCeiling(lv);
  updateCabinPortholes(lv);
}
function updateCabinCeiling(lv){
  const c=lv.ceiling; if(!c) return;
  c.phase=(c.phase+1)%c.period;
  const p=c.phase;
  const descStart=c.warnLead, descEnd=c.warnLead+c.descentT, holdEnd=descEnd+90, retEnd=holdEnd+80;
  c.warn = p<c.warnLead;
  let ty;
  if(p<descStart) ty=c.restY;
  else if(p<descEnd) ty=lerp(c.restY, c.lowY, (p-descStart)/c.descentT);
  else if(p<holdEnd) ty=c.lowY;
  else if(p<retEnd) ty=lerp(c.lowY, c.restY, (p-holdEnd)/(retEnd-holdEnd));
  else ty=c.restY;
  c.y=ty;
  if(p===0){ Sound.noise(.32,.14,0,300); Sound.blip(120,.32,'sawtooth',.16,0,80); }   // 液压声（预警起）
  if(p===descStart){ Sound.blip(90,.4,'sawtooth',.2,0,60); Sound.noise(.4,.16,0,240); }
  // 压迫玩家：头顶接触即下压 + 阶段性伤害
  if(c.hitCd>0) c.hitCd--;
  const ceilBottom=c.y+c.h;
  if(player.x+player.w>c.x && player.x<c.x+c.w && player.y<ceilBottom && ty>c.restY+40){
    player.y=ceilBottom; if(player.vy<0) player.vy=0; player.vy+=0.6;
    if(c.hitCd<=0){ damagePlayer(8, player.x+player.w/2); c.hitCd=34; }
  }
}
function updateCabinPortholes(lv){
  lv._portT=(lv._portT||0)+1;
  if(lv._portT>300){ lv._portT=0;
    const cand=lv.portholes.filter(pt=>pt.burstT<=0);
    if(cand.length){ const pt=cand[(Math.random()*cand.length)|0]; pt.burstT=110; pt.broken=true;
      Sound.noise(.4,.2,0,700); Sound.blip(200,.2,'sawtooth',.14,0,90);
      for(let i=0;i<10;i++) burst(pt.x, pt.y+8, 'rgba(200,235,250,0.8)', 1, 4); }
  }
  for(const pt of lv.portholes){
    if(pt.burstT>0){ pt.burstT--;
      if(frame%2===0 && particles.length<220){
        particles.push({x:pt.x+rand(-7,7), y:pt.y+8, vx:rand(-1.2,1.2), vy:rand(3,6), life:rand(16,30), max:30, color:'rgba(180,222,244,0.75)', size:rand(2,4), g:0.22});
      }
      // 水柱列命中玩家 → 减速 debuff
      if(player.x+player.w>pt.x-12 && player.x<pt.x+12 && player.y+player.h>pt.y+6){
        playerSlowT=Math.max(playerSlowT,42);
        if(frame%14===0) addFloater(player.x+player.w/2, player.y-18, '水柱 · 减速!', '#a8d8f0', 12);
      }
    } else if(pt.burstT<=0) pt.broken=false;
  }
}
/* -------- 船舱视觉：昏暗铆钉金属舱室背景（屏幕空间，带轻微视差） -------- */
function drawCabinBackground(t){
  // 底色：深灰 + 铁锈棕渐变
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#161a1e'); g.addColorStop(0.55,'#121417'); g.addColorStop(1,'#0a0b0d');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  const off=(camX*0.85);
  // 金属板缝 + 铆钉点阵
  ctx.save();
  const panelW=132, panelH=118;
  for(let py=-panelH; py<H+panelH; py+=panelH){
    for(let bx=-((off%panelW)+panelW); bx<W+panelW; bx+=panelW){
      // 板面明暗（强对比）
      const shade=0.06+0.05*Math.sin((bx+py)*0.02);
      ctx.fillStyle='rgba(50,60,66,'+shade.toFixed(3)+')'; ctx.fillRect(bx+3,py+3,panelW-6,panelH-6);
      ctx.strokeStyle='rgba(8,10,12,0.7)'; ctx.lineWidth=2; ctx.strokeRect(bx+2,py+2,panelW-4,panelH-4);
      ctx.strokeStyle='rgba(120,132,138,0.14)'; ctx.lineWidth=1; ctx.strokeRect(bx+3,py+3,panelW-6,panelH-6);
      // 铆钉
      ctx.fillStyle='rgba(150,160,166,0.5)';
      const rr=[[10,10],[panelW-10,10],[10,panelH-10],[panelW-10,panelH-10],[panelW/2,panelH/2]];
      for(const r of rr){ ctx.beginPath(); ctx.arc(bx+r[0],py+r[1],2.1,0,6.283); ctx.fill(); }
      // 铁锈斑（确定性）
      const rn=hnoise(((bx*0.13)|0)*7+((py*0.11)|0));
      if(rn>0.7){ ctx.fillStyle='rgba(90,52,30,0.22)'; ctx.beginPath(); ctx.arc(bx+panelW*0.3+rn*30, py+panelH*0.4, 8+rn*10, 0, 6.283); ctx.fill(); }
    }
  }
  ctx.restore();
  // 舷窗（透出海浪波动蓝光，正弦波动）
  const portOff=(camX*0.85);
  const ports=[210,486,770];
  for(let k=0;k<ports.length;k++){
    const wx=ports[k]-portOff, wy=GROUND_TOP-152;
    if(wx<-60||wx>W+60) continue;
    ctx.save();
    // 外圈铁环
    ctx.fillStyle='#2a3238'; ctx.beginPath(); ctx.arc(wx,wy,30,0,6.283); ctx.fill();
    ctx.fillStyle='#3c464e'; ctx.beginPath(); ctx.arc(wx,wy,26,0,6.283); ctx.fill();
    // 玻璃内海景蓝光（正弦波动）
    ctx.beginPath(); ctx.arc(wx,wy,22,0,6.283); ctx.clip();
    const sg=ctx.createLinearGradient(wx,wy-22,wx,wy+22);
    sg.addColorStop(0,'rgba(40,90,130,0.9)'); sg.addColorStop(1,'rgba(14,40,66,0.95)'); ctx.fillStyle=sg; ctx.fillRect(wx-24,wy-24,48,48);
    ctx.strokeStyle='rgba(150,210,240,0.55)'; ctx.lineWidth=1.5;
    for(let i=0;i<3;i++){ const yy=wy-8+i*10+Math.sin(t*0.05+i+k)*4; ctx.beginPath(); ctx.moveTo(wx-22,yy); for(let xx=-22;xx<=22;xx+=6){ ctx.lineTo(wx+xx, yy+Math.sin(xx*0.25+t*0.06+i)*2.2); } ctx.stroke(); }
    ctx.restore();
    // 铆钉环
    ctx.fillStyle='rgba(150,160,166,0.6)';
    for(let a=0;a<8;a++){ const ang=a/8*6.283; ctx.beginPath(); ctx.arc(wx+Math.cos(ang)*28, wy+Math.sin(ang)*28, 1.8, 0, 6.283); ctx.fill(); }
    // 舷窗冷光晕
    const halo=ctx.createRadialGradient(wx,wy,6,wx,wy,70); halo.addColorStop(0,'rgba(70,140,190,0.18)'); halo.addColorStop(1,'rgba(70,140,190,0)'); ctx.fillStyle=halo; ctx.beginPath(); ctx.arc(wx,wy,70,0,6.283); ctx.fill();
  }
  // 摇摆吊灯 + 动态光锥（正弦摆动，光锥随之投射）
  const lampX=[150,430,700];
  for(let k=0;k<lampX.length;k++){
    const lx=lampX[k]-portOff*1.0, ly=GROUND_TOP-232;
    if(lx<-80||lx>W+80) continue;
    const sw=Math.sin(t*0.03 + k*1.7)*0.28;      // 摆角
    const bob=Math.cos(t*0.03 + k*1.7);
    ctx.save();
    // 吊索
    ctx.strokeStyle='rgba(20,24,26,0.9)'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(lx,ly-46); ctx.lineTo(lx+Math.sin(sw)*40, ly); ctx.stroke();
    const hx=lx+Math.sin(sw)*40, hy=ly;
    // 光锥（半透明扇形，随摆动扫动 → 模拟动态阴影移动）
    const cone=ctx.createLinearGradient(hx,hy,hx,GROUND_TOP);
    cone.addColorStop(0,'rgba(255,224,150,0.16)'); cone.addColorStop(1,'rgba(255,210,120,0)');
    ctx.fillStyle=cone; ctx.beginPath(); ctx.moveTo(hx,hy);
    ctx.lineTo(hx-70+sw*120, GROUND_TOP); ctx.lineTo(hx+70+sw*120, GROUND_TOP); ctx.closePath(); ctx.fill();
    // 灯体
    ctx.fillStyle='#3a3026'; ctx.beginPath(); ctx.moveTo(hx-10,hy-8); ctx.lineTo(hx+10,hy-8); ctx.lineTo(hx+6,hy+8); ctx.lineTo(hx-6,hy+8); ctx.closePath(); ctx.fill();
    const bulb=0.7+0.25*Math.sin(t*0.2+k);
    ctx.fillStyle='rgba(255,226,150,'+bulb.toFixed(2)+')'; ctx.beginPath(); ctx.arc(hx,hy+4,4,0,6.283); ctx.fill();
    const gl=ctx.createRadialGradient(hx,hy+4,2,hx,hy+4,26); gl.addColorStop(0,'rgba(255,226,150,0.5)'); gl.addColorStop(1,'rgba(255,226,150,0)'); ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(hx,hy+4,26,0,6.283); ctx.fill();
    ctx.restore();
  }
  // 顶部与底部压暗横带，强化压迫感
  const tb=ctx.createLinearGradient(0,0,0,H*0.28); tb.addColorStop(0,'rgba(0,0,0,0.6)'); tb.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=tb; ctx.fillRect(0,0,W,H*0.28);
}
/* -------- 船舱陷阱世界层：活板门/天花板/舷窗水柱/板条箱/返回舱口 -------- */
function drawCabinTraps(){
  const lv=cabinLevel; if(!lv) return;
  // 板条箱（翻倒木箱：木板条 + 铁角，覆盖在 solid 平台上）
  for(const cr of lv.crates){
    ctx.save(); ctx.translate(cr.x+cr.w/2, cr.y+cr.h/2); ctx.rotate(cr.tilt*0.35);
    ctx.fillStyle='#6a4a2a'; ctx.fillRect(-cr.w/2,-cr.h/2,cr.w,cr.h);
    ctx.fillStyle='#835a34'; ctx.fillRect(-cr.w/2+2,-cr.h/2+2,cr.w-4,cr.h-4);
    ctx.strokeStyle='#3a2814'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(-cr.w/2,-cr.h/6); ctx.lineTo(cr.w/2,-cr.h/6); ctx.moveTo(-cr.w/2,cr.h/6); ctx.lineTo(cr.w/2,cr.h/6);
    ctx.moveTo(-cr.w/2,-cr.h/2); ctx.lineTo(cr.w/2,cr.h/2); ctx.stroke();
    ctx.fillStyle='#2c2012'; const cS=4; ctx.fillRect(-cr.w/2,-cr.h/2,cS,cS); ctx.fillRect(cr.w/2-cS,-cr.h/2,cS,cS); ctx.fillRect(-cr.w/2,cr.h/2-cS,cS,cS); ctx.fillRect(cr.w/2-cS,cr.h/2-cS,cS,cS);
    ctx.restore();
  }
  // 活板门
  for(const t of lv.trapdoors){
    if(t.open){
      // 缺口：深黑 + 底部海水微光
      ctx.fillStyle='rgba(4,8,10,0.9)'; ctx.fillRect(t.x, GROUND_TOP, t.w, 46);
      ctx.fillStyle='rgba(40,90,130,'+(0.5+0.2*Math.sin(frame*0.1))+')'; ctx.fillRect(t.x+4, GROUND_TOP+40, t.w-8, 8);
      ctx.strokeStyle='rgba(150,210,240,0.5)'; ctx.lineWidth=1.4;
      for(let i=0;i<t.w;i+=18){ const wy=GROUND_TOP+42+Math.sin(frame*0.12+i)*2; ctx.beginPath(); ctx.moveTo(t.x+i,wy); ctx.lineTo(t.x+i+10,wy); ctx.stroke(); }
    } else {
      // 关闭：金属活板门面 + 铰链
      ctx.fillStyle='#39434a'; ctx.fillRect(t.x, GROUND_TOP, t.w, 10);
      ctx.strokeStyle='rgba(10,12,14,0.8)'; ctx.lineWidth=2; ctx.strokeRect(t.x+1, GROUND_TOP+1, t.w-2, 8);
      ctx.fillStyle='rgba(150,160,166,0.6)'; ctx.beginPath(); ctx.arc(t.x+7,GROUND_TOP+5,2,0,6.283); ctx.arc(t.x+t.w-7,GROUND_TOP+5,2,0,6.283); ctx.fill();
    }
    // 预警红色热光闪烁（开启前 2s）
    if(t.warn){
      const a=0.35+0.35*Math.sin(frame*0.4);
      ctx.fillStyle='rgba(255,60,40,'+a.toFixed(3)+')'; ctx.fillRect(t.x, GROUND_TOP-3, t.w, 4);
      const gg=ctx.createLinearGradient(0,GROUND_TOP-30,0,GROUND_TOP); gg.addColorStop(0,'rgba(255,40,30,0)'); gg.addColorStop(1,'rgba(255,50,36,'+(0.16*a+0.06).toFixed(3)+')'); ctx.fillStyle=gg; ctx.fillRect(t.x, GROUND_TOP-30, t.w, 30);
      ctx.fillStyle='rgba(255,120,90,'+a.toFixed(2)+')'; ctx.font='bold 11px "Courier New",monospace'; ctx.textAlign='center'; ctx.fillText('⚠', t.x+t.w/2, GROUND_TOP-8); ctx.textAlign='left';
    }
  }
  // 天花板压缩机构
  const c=lv.ceiling;
  if(c){
    ctx.save();
    // 主体金属条
    ctx.fillStyle='#2b333a'; ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle='#39434a'; ctx.fillRect(c.x+2, c.y+2, c.w-4, c.h-6);
    ctx.strokeStyle='rgba(8,10,12,0.8)'; ctx.lineWidth=2; ctx.strokeRect(c.x+1, c.y+1, c.w-2, c.h-2);
    // 底面尖刺齿（威胁感）
    ctx.fillStyle='#525c63';
    for(let x=c.x+6; x<c.x+c.w-6; x+=20){ ctx.beginPath(); ctx.moveTo(x, c.y+c.h); ctx.lineTo(x+6, c.y+c.h+8); ctx.lineTo(x+12, c.y+c.h); ctx.closePath(); ctx.fill(); }
    // 铆钉
    ctx.fillStyle='rgba(150,160,166,0.5)';
    for(let x=c.x+12; x<c.x+c.w; x+=40){ ctx.beginPath(); ctx.arc(x, c.y+8, 2, 0, 6.283); ctx.fill(); }
    // 两侧液压杆
    ctx.strokeStyle='#4a545b'; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(c.x+8, 0); ctx.lineTo(c.x+8, c.y); ctx.moveTo(c.x+c.w-8, 0); ctx.lineTo(c.x+c.w-8, c.y); ctx.stroke();
    ctx.restore();
    // 下降预警：红色横向扫光条
    if(c.warn){
      const a=0.4+0.35*Math.sin(frame*0.45);
      const scanY=c.y+c.h+6 + ((frame*4)%(GROUND_TOP-(c.y+c.h)-6));
      ctx.fillStyle='rgba(255,50,40,'+(0.22*a).toFixed(3)+')'; ctx.fillRect(c.x, c.y+c.h, c.w, GROUND_TOP-(c.y+c.h));
      ctx.fillStyle='rgba(255,90,70,'+a.toFixed(3)+')'; ctx.fillRect(c.x, scanY-2, c.w, 3);
      ctx.fillStyle='rgba(255,140,100,'+a.toFixed(2)+')'; ctx.font='bold 12px "Courier New",monospace'; ctx.textAlign='center'; ctx.fillText('⚠ 天花板下降 ⚠', c.x+c.w/2, c.y+c.h+16); ctx.textAlign='left';
    }
  }
  // 舷窗爆裂水柱（蓝白半透明粒子束，粒子飞溅由 particles 处理）
  for(const pt of lv.portholes){
    if(pt.burstT>0){
      const a=clamp(pt.burstT/40,0,1);
      const jg=ctx.createLinearGradient(pt.x,pt.y,pt.x,GROUND_TOP);
      jg.addColorStop(0,'rgba(210,240,252,'+(0.55*a).toFixed(3)+')'); jg.addColorStop(0.5,'rgba(150,210,240,'+(0.4*a).toFixed(3)+')'); jg.addColorStop(1,'rgba(120,190,230,'+(0.12*a).toFixed(3)+')');
      ctx.fillStyle=jg;
      const wob=Math.sin(frame*0.3)*3;
      ctx.beginPath(); ctx.moveTo(pt.x-5,pt.y); ctx.lineTo(pt.x+5,pt.y); ctx.lineTo(pt.x+10+wob, GROUND_TOP); ctx.lineTo(pt.x-10+wob, GROUND_TOP); ctx.closePath(); ctx.fill();
      // 破裂舷窗闪白
      ctx.fillStyle='rgba(230,248,255,'+(0.3*a).toFixed(3)+')'; ctx.beginPath(); ctx.arc(pt.x,pt.y,10,0,6.283); ctx.fill();
    }
  }
  // 返回舱口（清舱后开启）
  if(cabinWaveState==='done'){
    const ex=lv.exitX, ey=GROUND_TOP-52;
    const a=0.5+0.3*Math.sin(frame*0.12);
    ctx.fillStyle='#241a12'; ctx.fillRect(ex-16, ey, 32, 52);
    const dg=ctx.createLinearGradient(ex-14,ey,ex-14,ey+52); dg.addColorStop(0,'rgba(120,180,200,'+(0.3*a).toFixed(3)+')'); dg.addColorStop(1,'rgba(30,50,66,0.9)'); ctx.fillStyle=dg; ctx.fillRect(ex-14,ey+2,28,48);
    ctx.strokeStyle='rgba(255,235,160,'+a.toFixed(2)+')'; ctx.lineWidth=2; ctx.strokeRect(ex-14,ey+2,28,48);
    ctx.fillStyle='rgba(255,235,160,'+a.toFixed(2)+')'; ctx.font='bold 10px "Courier New",monospace'; ctx.textAlign='center'; ctx.fillText('返回甲板', ex, ey-6); ctx.textAlign='left';
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
  if(opheliaWounded) return;
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
  if(entry.final) mus = opheliaSaved?'hero':'imperial';
  const isFinalClaudius = entry.final && entry.kind==='claudius';
  if(isFinalClaudius){                     // 克劳迪奥进场：暗化特效 + 电闪状态复位
    finalBossEntryFrame=frame; finalLightning.next=frame+70; finalLightning.boltUntil=0; finalLightning.flashes=0;
  }
  if(entry.final){
    ghostOpheliaFinale = opheliaSaved && opheliaWounded;
    if(ghostOpheliaFinale){ companion=null; Sound.characterCue('ghostOphelia'); }
  }
  // 出场前以较低强度起 BGM（过场阶段 ~2s 淡入观感），Boss 正式开打再提升
  Sound.setMusic(mus, entry.final?0.45:1.1);
  const intro = BOSS_INTRO[entry.kind] || [];
  showStory(intro, ()=>{
    state=STATE.PLAY;
    if(entry.final) Sound.setMusic(mus, 1.2);   // 开打提升音量/音层
    addFloater(boss.x+boss.w/2, boss.y-20, 'BOSS 战 · '+D.name, ACTS[actIndex].accent||'#e8c25a', 16);
    const cue={ghostking:'ghost', clown:'clown', assassin:'assassin', laertes:'laertes', claudius:'claudius'}[entry.kind];
    if(cue) Sound.characterCue(cue);
    showBossGuide();
  });
}
// Boss 计划驱动：所有含 level.bossPlan 的关卡通用（城堡/宫廷/英格兰关底 + 终章雷欧提斯&克劳迪奥）
function updateBossPlan(){
  if(state!==STATE.PLAY || player.dead) return;
  if(boss){ updateBoss(); updateBossUlt(); return; }
  // 第四幕：船舱是刺客队长 Boss 的前置闸门——舱内未肃清前不触发甲板 Boss
  // （仅当本关确实存在舱门时才 gate，避免舱门缺失时主线卡死）
  if(actIndex===ACT_ENGLAND && !cabinCleared && !cabinActive && level.triggers && level.triggers.some(t=>t.type==='door')) return;
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
  shake(3,6);
  if(boss.kind==='ghostking') Sound.battleCue('ghostHit');
  else if(boss.kind==='clown') Sound.battleCue('clownHit');
  else if(boss.kind==='laertes') Sound.battleCue('laertesStrike');
  else if(boss.kind==='claudius') Sound.battleCue('claudiusHeavy');
  else Sound.bossHit();
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
let bossRageT = 0, bossRagePhase = 1;   // 第五幕 Boss 阶段切换狂暴视觉计时（帧）
function bossPhaseTransition(ph){
  boss.phase=ph; boss.invuln=90; boss.atkCd=60;
  Sound.bossPhase(); shake(10,24); flash(ph>=3?'rgba(200,20,20,0.4)':'rgba(200,120,40,0.3)',18);
  if(boss.kind==='claudius'){ spawnShockwave(); bossRageT=90; bossRagePhase=ph; }   // 第五幕阶段切换：全屏圆形冲击波 + 狂暴视觉爆发
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
  if(bossRageT>0) bossRageT--;
  if(b.hitFlash>0)b.hitFlash--; if(b.invuln>0)b.invuln--;
  if(ghostOpheliaFinale && b.kind==='claudius' && frame%96===0){
    b.hp=Math.max(0,b.hp-5); b.hitFlash=8; Sound.battleCue('ghostOpheliaAttack'); ripple(b.x+b.w/2, b.y+b.h*0.45); addFloater(b.x+b.w/2, b.y-18, '亡魂奥菲莉亚助战', '#bfe4ff', 12);
    if(b.hp<=0){ onBossDefeated(); return; }
  }
  if(b.dead){ b.deathT--; return; }
  const px=player.x+player.w/2, ex=b.x+b.w/2;
  b.facing=px<ex?-1:1;
  const d=Math.abs(px-ex);
  const solids=solidsList();
  bossIdleMoveSfx(b);
  // 接触伤害
  if(!player.dead && player.invuln<=0 && rectsOverlap(player,b)) damagePlayer(b.phase>=3?11:7, ex);
  // 计时
  if(b.atkCd>0)b.atkCd--; if(b.summonCd>0)b.summonCd--; if(b.dashCd>0)b.dashCd--;
  if(b.poisonCd>0)b.poisonCd--; if(b.ultCd>0)b.ultCd--; if(b.atkT>0)b.atkT--;
  // 移动逼近
  if(b.state!=='dash'){ b.vx += (px<ex?-1:1)* (b.phase>=2?0.14:0.1); b.vx=clamp(b.vx,-(1.3+b.phase*0.3),(1.3+b.phase*0.3)); }
  // 近战
  if(d<64 && b.atkCd<=0){ b.atkT=22; b.atkCd = b.phase>=2?54:70; Sound.bossAttack(b.kind); }
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
// Boss 待机音（各自周期）与移动音（按步频）：用 Sound.ctx.currentTime 做周期调度，禁止 setInterval
// 时间戳挂在 boss 对象上，boss=null 时自然失效，无泄漏
function bossIdleMoveSfx(b){
  if(!(Sound.ctx && Sound.ctx.state==='running' && Sound.enabled)) return;
  const now=Sound.ctx.currentTime;
  // 待机音：各 Boss 独立周期（秒）
  const period={ghostking:15, assassin:8, laertes:6, claudius:9, clown:7, rosencrantz:10, guildenstern:10}[b.kind]||12;
  if(b.idleNextT===undefined) b.idleNextT=now+2+Math.random()*2;
  if(now>=b.idleNextT){ b.idleNextT=now+period+Math.random()*3; Sound.bossIdle(b.kind); }
  // 移动音：Boss 有明显水平位移时按步频触发（鬼魂在 bossMove 内改为低频风声）
  if(Math.abs(b.vx)>0.6 && b.onGround){
    if(b.stepNextT===undefined) b.stepNextT=0;
    if(now>=b.stepNextT){ b.stepNextT=now+clamp(0.36-Math.abs(b.vx)*0.03,0.14,0.36); Sound.bossMove(b.kind); }
  }
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
async function syncBossKill(kind, bossName, x, y){
  if(!supabaseClient) return;
  try {
    const playerProfile = await ensurePlayerProfile();
    const { data, error } = await supabaseClient.from('boss_kills').insert({ player_id:playerProfile.id, nickname:playerProfile.nickname||'匿名勇士', act:kind }).select('kill_rank').single();
    if(error) throw error;
    if(data && data.kill_rank){ addFloater(x, y, '你是第 '+data.kill_rank+' 位击杀 '+bossName+' 的勇士', '#7fd4ee', 16); }
  } catch {}
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
  syncBossKill(kind, D.name, boss.x+boss.w/2, boss.y-54);

  if(entry && entry.midboss){          // 终章中段 Boss 雷欧提斯：不结束关卡
    laertesDefeated=true; Sound.jingle('victory');
    onLaertesDefeated();
    return;
  }
  if(entry && entry.final){            // 终章最终 Boss 克劳迪奥：进入结局
    if(ghostOpheliaFinale){ Sound.battleCue('ghostOpheliaVanish'); }
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
        dom.timerRow.style.display='block';
        addFloater(player.x, player.y-34, '☠ 中毒！45 秒内击败克劳迪奥', '#9bff6a', 15);
        Sound.setMusic('imperial', 1.2);
      } else {
        opheliaWounded=true;
        if(companion){ companion.hp=1; companion.active=true; companion.atkT=0; }
        for(let i=0;i<24;i++) spawnPetal(player.x+rand(-80,80), player.y-rand(0,70), '#d85a9a');
        addFloater(player.x, player.y-34, '奥菲莉亚受伤倒下，亡魂将随你进王座', '#ffd0e6', 15);
        Sound.characterCue('ghostOphelia');
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
  respawn=safeRespawnValue({x:spawnX,y:spawnY,_bossGate:respawn&&respawn._bossGate});
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
  runSceneFade(()=>{
    const done=actIndex;
    if(done===ACT_CASTLE){ chainStory([STORY.a1_reveal, STORY.a2_open], ()=>startAct(ACT_COURT)); }
    else if(done===ACT_COURT){ chainStory([STORY.a3_open], ()=>startAct(ACT_ESCAPE)); }
    else if(done===ACT_ESCAPE){ chainStory([STORY.egg_enter], ()=>startAct(ACT_LAKE)); }
    else if(done===ACT_LAKE){ chainStory([STORY.a4_open], ()=>startAct(ACT_ENGLAND)); }
    else if(done===ACT_ENGLAND){ chainStory([STORY.a4_end, opheliaSaved?STORY.a5_open_saved:STORY.a5_open_lost], ()=>startAct(ACT_FINAL)); }
  });
}
function chainStory(list, done){
  let i=0;
  const next=()=>{ if(i>=list.length){ done(); return; } const pages=list[i++]; showStory(pages, next); };
  next();
}
function startAct(idx){
  runSceneFade(()=>{
    loadLevel(idx, true);
    camX=clamp(player.x-VW/2,0,level.width-VW); camY=clamp(player.y-VH*0.55,0,level.height-VH);
    state=STATE.PLAY; clearInputEdges();
    showLevelName(ACTS[idx].name, ACTS[idx].en);
  });
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
const ENDING_TEXT_WIN = '毒剑之后，奥菲莉亚的蓝白亡魂从王座阴影中浮现，缠住克劳迪奥，与弑君者同归于尽。哈姆雷特完成复仇，也倒在毒与伤痕之中；三具尸身横陈，丹麦只剩霍拉旭讲述真相。';
const ENDING_TEXT_LOSE = '奥菲莉亚已沉入湖底。雷欧提斯的毒在哈姆雷特血脉中扩散，他带毒冲入王座厅，与克劳迪奥决战到底。复仇完成，哈姆雷特与弑君者双双倒下。';
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
  titleEl.textContent = win? '终 · 原著悲剧（三死）' : '终 · 沉默悲剧（双死）';
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
  else if(state===STATE.PLAY){ if(bonusLevel) updateBonusPlay(); else updatePlay(); }
  else if(state==='ending'){ updateEnding(); }
  else if(state==='messageBoard'){ updateMessageMeta(); }

  updateParticles();
  // 边沿复位（每帧末尾）
  jumpEdge=false; atkEdge=false; rangedEdge=false;
}
let hudTick=0;
function updatePlay(){
  stats.time += 1/60;
  cabinPrompt=null;   // 交互提示每帧重置，靠近才显示
  // 第四幕船舱过场（开门/淡黑/淡入/返回）阶段：冻结常规更新，只推进过场
  if(cabinPhase && cabinPhase!=='active'){ updateCabinTransition(); updateCamera(); if(++hudTick%4===0) updateHUD(); return; }
  // 甲板上靠近舱门：显示提示并处理"↑ 进入"（返回 true 表示本帧已开始进舱，跳过后续）
  if(actIndex===ACT_ENGLAND && !cabinActive && cabinPhase===null){ if(updateCabinDeckPrompt()) return; }
  // 舱内返回甲板必须在 updatePlayer 消耗 jumpEdge 前处理；否则提示存在但按 ↑ 会被跳跃缓冲吃掉。
  if(cabinActive && cabinPhase==='active' && cabinWaveState==='done'){
    checkCabinReturn();
    if(cabinPhase==='toDeck'){ updateCabinTransition(); updateCamera(); if(++hudTick%4===0) updateHUD(); return; }
  }
  updateMovers();
  updatePlayer();
  if(player.dead) return; // 死亡后进入 LOSE
  updateEnemies();
  updateCompanion();
  updateProjectiles();
  updateRocks();
  updatePickups();
  updateTriggersAndCheckpoints();
  // 第四幕船舱战斗区：波次推进 + 陷阱机制 + 返回甲板
  if(cabinActive && cabinPhase==='active') updateCabin();
  Dialog.update();                 // 非阻断顶部对白栏（不暂停游戏）
  updatePunkOphelia();             // 第三幕背景疯癫奥菲莉亚
  updateCourtOphelia();            // 第二幕背景正常奥菲莉亚（宫廷 NPC）
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
  // 终章生还版：亡魂奥菲莉亚助战——空灵疯笑（10-15s）+ 空灵哼唱环境音
  if(ghostOpheliaFinale && boss && boss.kind==='claudius' && !boss.dead){
    if(!level._ghostOph) level._ghostOph={};
    level._ghostOph.x = boss.x+boss.w/2-58;
    scheduleOpheliaAudio(level._ghostOph,'ghost',false);
  }
  // 阴郁模式环境（终章失败路线）
  if(actIndex===ACT_FINAL && darkMode){
    if(frame%40===0){ crows.push({x:camX-30,y:camY+rand(20,120),vx:rand(1.2,2.2),flap:0}); }
    if(frame%6===0) petals.push({x:camX+rand(0,VW),y:camY-10,vx:rand(-.5,.1),vy:rand(.4,1),rot:rand(0,6.28),vr:.08,size:rand(3,5),color:'#5a4a3a',ph:rand(0,6.28),life:300});
  }
  // 湖畔/英格兰花瓣、海雾氛围
  if(actIndex===ACT_LAKE && frame%20===0) spawnPetal(camX+rand(0,VW), camY-10, '#dfeaf5');
  if(actIndex===ACT_ENGLAND && !cabinActive && frame%30===0) spawnPetal(camX+rand(0,VW), camY-10, 'rgba(210,225,235,0.6)');
  checkLevelProgress();
  updateCamera();
  if(++hudTick%4===0) updateHUD();
}
// 第三幕背景：疯癫朋克奥菲莉亚缓慢游荡 + 疯话
function updatePunkOphelia(){
  const po=level.punkOphelia; if(!po) return;
  po.phase+=0.010;
  // 局部徘徊：跨度收窄，峰值速度 ≈ 0.5*span*phaseInc = 0.5*900*0.010 = 4.5px/帧 ≈ 1.3x 正常速度（不超 2x）
  const span=Math.min(900, Math.max(360, level.width*0.16));
  const nextX = po.baseX + (Math.sin(po.phase)*0.5+0.5)*span;
  const moving=Math.abs(nextX-po.x)>0.6;
  po.dir = nextX>=po.x ? 1 : -1;
  po.x = nextX;
  // 花瓣轨迹：走过留下粉色花瓣，2~3s 后消失（life 120~180 帧）
  if(moving && frame%12===0 && petals.length<70){
    petals.push({x:po.x+rand(-8,8), y:GROUND_TOP-rand(6,30), vx:rand(-.3,.3), vy:rand(.3,.9),
      rot:rand(0,6.28), vr:rand(-.12,.12), size:rand(3,5), color: Math.random()<0.5?'#e86ab0':'#ffc0dc',
      ph:rand(0,6.28), life:randi(120,180)});
  }
  scheduleOpheliaAudio(po,'punk',moving);
  po.lineT--; if(po.lineT<=0){ po.lineT=220;
    const madLines=[
      {zh:'他死了，去了，小姐……', en:'He is dead and gone, lady.'},
      {zh:'这是迷迭香，是为了记忆。', en:'There\'s rosemary, that\'s for remembrance.'},
      {zh:'明天是圣瓦伦丁节……', en:'Tomorrow is Saint Valentine\'s day.'},
      {zh:'晚安，女士们；晚安。', en:'Good night, ladies; good night.'},
      {zh:'他不会回来了吗？', en:'And will he not come again?'}
    ];
    po.lineI=(po.lineI+1)%madLines.length;
    const screenX=(po.x-camX)*ZOOM;
    if(screenX>W*0.34 && screenX<W*0.66){ const line=madLines[po.lineI]; addFloater(po.x, GROUND_TOP-92, line.zh+' / '+line.en, '#C9A0DC', 11); }
  }
}
// 第二幕背景：正常形象奥菲莉亚（宫廷裙装）缓慢温柔徘徊，仅作场景 NPC 装饰，不参与战斗
function updateCourtOphelia(){
  const co=level.courtOphelia; if(!co) return;
  co.phase+=0.006;
  // 峰值速度 ≈ 0.5*span*phaseInc = 0.5*560*0.006 = 1.68px/帧 ≈ 0.5x 正常速度（温柔飘逸 0.4-0.6x）
  const span=Math.min(560, Math.max(300, level.width*0.11));
  const nextX = co.baseX + (Math.sin(co.phase)*0.5+0.5)*span;
  const moving=Math.abs(nextX-co.x)>0.4;
  co.dir = nextX>=co.x ? 1 : -1;
  co.x = nextX;
  // 花瓣偶发飘落（粉色小花瓣，旋转 + 缓落），限量复用 petals 池
  if(frame%36===0 && petals.length<60){
    petals.push({x:camX+rand(0,VW), y:camY-8, vx:rand(-.4,.2), vy:rand(.4,.9),
      rot:rand(0,6.28), vr:rand(-.1,.1), size:rand(3,5),
      color: Math.random()<0.5?'#ffc0dc':'#f7a8cf', ph:rand(0,6.28), life:randi(220,340)});
  }
  scheduleOpheliaAudio(co,'normal',moving);
}
// 奥菲莉亚三态音效调度：脚步（切换态触发不重叠）/ 笑声（随机定时）/ 环境音（循环）/ 朋克疯语吟诵
// 全部用 Sound.now()(=AudioContext.currentTime) 管理，笑声经 Sound.tryLaugh 防重叠。
function scheduleOpheliaAudio(o, mode, moving){
  if(!Sound.enabled || !Sound.ctx || Sound.ctx.state!=='running') return;  // 必须 running 才调度
  const now=Sound.now();
  // 仅当角色在画面内才发声，避免离屏噪音
  const sx=(o.x-camX)*ZOOM; const onScreen = sx>-40 && sx<W+40;
  if(o._aNext===undefined){
    o._aStep=now+0.4; o._aAmb=now+0.6;
    o._aLaugh=now + laughGap(mode);
    o._aChant=now + 15; o._aNext=1;
  }
  if(!onScreen){ // 离屏时推迟笑声计时，避免回到画面时一次性补触发
    if(o._aLaugh - now > 20) o._aLaugh = now + laughGap(mode);
    return;
  }
  // 笑声/疯笑倒计时提示（调试友好）：随机定时，经 tryLaugh 防重叠，dur 对齐 3s+ 音效实长
  const laughDur = mode==='punk'?3.1:(mode==='ghost'?3.1:3.2);
  // 环境音循环（约 3s 一段）
  if(now>=o._aAmb){ Sound.opheliaAmbient(mode); o._aAmb=now + (mode==='punk'?3.0:(mode==='ghost'?3.4:3.1)); }
  // 脚步：normal 每 ~0.15s；punk 急促不规则 0.1-0.2s；ghost 无脚步
  if(moving && mode!=='ghost' && now>=o._aStep){
    Sound.opheliaStep(mode);
    o._aStep = now + (mode==='punk'? (0.1+Math.random()*0.1) : 0.15);
  }
  // 笑声/疯笑：随机定时，经 tryLaugh 防重叠
  if(now>=o._aLaugh){
    if(Sound.tryLaugh(mode, laughDur)){
      o._aLaugh = now + laughGap(mode);
    } else { o._aLaugh = now + 0.5; } // 被占用则稍后重试
  }
  // 朋克疯语吟诵：高频颤音，每 15s
  if(mode==='punk' && now>=o._aChant){
    Sound.safe(function(){ this.voiceOsc({type:'sine', f:450, dur:3.0, vol:.10, atk:.2, rel:1.0, vib:{rate:8,depth:20}}); });
    o._aChant = now + 15;
  }
}
// 各态笑声随机间隔：normal 8-14s，punk 6-10s，ghost 10-16s
function laughGap(mode){ return mode==='punk'?rand(6,10):(mode==='ghost'?rand(10,16):rand(8,14)); }

function finishBonus(){
  if(!bonusLevel || level.bonusFinished) return;
  level.bonusFinished=true;
  const act=bonusLevel.act;
  if(act===2) addScore(350);
  if(act===3) addScore(1400);
  if(act===4) Dialog.push([DL('left','哈姆雷特','海雾也有出口，心中的迷宫亦然。')]);
  openMessageBoard(act, BONUS_TITLES[act-1], act===1 ? '你是第'+(Number(localStorage.getItem('hamlet_peak_count')||0)+1)+'个到达顶峰' : '留下这一关的挑战记录。');
  if(act===1) localStorage.setItem('hamlet_peak_count', String(Number(localStorage.getItem('hamlet_peak_count')||0)+1));
}
function updateBonusPlay(){
  stats.time += 1/60;
  // 第五幕「决战前的独白」：全屏戏剧演出期间冻结操作，演出结束/跳过后再进入登高
  if(bonusLevel.act===5 && level.monologue && !level.monologue.done){
    updateBonusMonologue();
    keys.left=keys.right=keys.jump=keys.atk=keys.ranged=false;
    jumpEdge=atkEdge=rangedEdge=false;
    if(++hudTick%4===0) updateHUD();
    return;
  }
  updateMovers(); updatePlayer();
  if(player.dead) return;
  if(bonusLevel.act!==5){ updateEnemies(); updateProjectiles(); updatePickups(); }
  if(level.exitPortal && rectsOverlap(player, level.exitPortal)){
    flash('#e8c25a',14);
    exitBonus(true);
    return;
  }
  if(bonusLevel.act===1 || bonusLevel.act===5){
    // 登高关：踩上顶点平台（脚部落在平台面 ±16px 且横向处于平台范围内）才算通关
    const top=level.platforms.find(p=>p.board);
    if(top && player.onGround){
      const feet=player.y+player.h;
      if(player.x+player.w>top.x && player.x<top.x+top.w && Math.abs(feet-top.y)<=16){
        if(!level.bonusFinished && bonusLevel.act===5){ flash('#e8c25a',20); shake(6,20); } // 第五幕顶点特效
        finishBonus();
      }
    }
  } else if(bonusLevel.act===2){
    if(enemies.length===0) finishBonus(); // 消灭全部敌人即通关
  } else if(player.x+player.w>level.goalX){
    finishBonus();
  }
  updateCamera();
  if(++hudTick%4===0) updateHUD();
}
// 独白动作阶段时长（帧）：0踱步 1站定 2蹲下 3起身 4抬手独白 5转身
const MONO_PHASE_DUR=[160,50,72,58,132,46];
function updateBonusMonologue(){
  const m=level.monologue; if(!m||m.done) return;
  m.t++;
  if(m.t===1) Sound.stageAmbience(28.0);
  m.walk += 0.016;                      // 兼容旧字段
  // —— 烟雾缓慢横移（确定性漂移，避免每帧乱跳位置由 spd 决定）——
  if(m.smoke){ for(const s of m.smoke){ s.x+=s.spd; if(s.x<-180) s.x=W+180; else if(s.x>W+180) s.x=-180; } }
  // —— 骨骼动作状态机 ——
  m.phaseT++;
  if(m.phase===0){                       // 踱步：横向移动 + 步频推进
    m.stepT+=0.135;
    m.px+=m.walkDir*0.95;
    if(m.px>W*0.63){ m.px=W*0.63; m.walkDir=-1; }
    else if(m.px<W*0.37){ m.px=W*0.37; m.walkDir=1; }
    m.facing=m.walkDir;
  }
  if(m.phase===5){                       // 转身：收窄 scaleX，中点翻面
    const p=clamp(m.phaseT/MONO_PHASE_DUR[5],0,1);
    m.turnScale=0.28+0.72*Math.abs(Math.cos(p*Math.PI));
    if(m.phaseT===((MONO_PHASE_DUR[5]/2)|0)) m.facing*=-1;
  } else {
    m.turnScale+=(1-m.turnScale)*0.2;
  }
  if(m.phaseT>=MONO_PHASE_DUR[m.phase]){ m.phaseT=0; m.phase=(m.phase+1)%6; }
  // —— 关节角度平滑插值到目标位姿 ——
  const tp=_monoTargetPose(m), k=0.13;
  for(const key in tp) m.pose[key]+=(tp[key]-m.pose[key])*k;
  // —— 台词推进（沿用 m.t 计时，中英对照逐行）——
  const lines=ACT5_MONOLOGUE, introF=70, perLine=175;
  if(m.ending){ m.fade+=2.2; if(m.fade>=70){ m.done=true; Sound.monologueScoreStop(); Sound.setMusic(ACTS[4].music, .85); } return; } // 独白结束：停配乐并切回登高关 BGM
  if(m.t<introF) return;                // 开场聚光灯淡入
  const local=m.t-introF;
  m.line=Math.floor(local/perLine);
  m.lineT=local-m.line*perLine;
  if(m.line<lines.length && m.line!==m.lastVoiceLine){ m.lastVoiceLine=m.line; Sound.monologueVoiceCue(m.line); if(m.line===lines.length-1) Sound.monologueScoreTutti(); } // 末行触发满编 tutti
  if(m.line>=lines.length){ m.line=lines.length-1; m.ending=true; m.fade=0; }
}
function skipBonusMonologue(){
  const m=(bonusLevel && level && level.monologue) ? level.monologue : null;
  if(m && !m.done && !m.ending){ m.ending=true; m.fade=0; m.skipped=true; }
}

/* -------------------------------------------------------------------------
   27. 主循环：渲染
   ------------------------------------------------------------------------- */
function render(){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  if(state===STATE.TITLE || state===STATE.NICKNAME_SETUP){ drawTitleScene(); }
  else if(state==='ending'){ drawEndingScene(); return; }
  else {
    // 第四幕英格兰：整个视角随海浪周期性轻微倾斜，由作用于玩家的 rockAngle 驱动。
    // 仅包裹渲染阶段，物理/碰撞坐标完全不受影响；舱内 rockAngle=0，大浪阶段幅度已在物理中加大。
    let tilt = 0;
    if(actIndex===ACT_ENGLAND && state===STATE.PLAY && !cabinActive){
      tilt = rockAngle;
    }
    if(tilt){
      ctx.save();
      // 旋转前先铺满略大区域，用背景色填满旋转露出的四角，避免黑边
      ctx.fillStyle='#071019'; ctx.fillRect(-80,-80,W+160,H+160);
      ctx.translate(W/2,H/2); ctx.rotate(tilt); ctx.translate(-W/2,-H/2);
    }
    drawBackground();
    drawDepthOccluders();
    // 世界层
    ctx.save();
    let sx=0, sy=0;
    if(shakeT>0){ sx=rand(-shakeMag,shakeMag); sy=rand(-shakeMag,shakeMag); }
    ctx.translate(sx,sy);
    ctx.scale(ZOOM,ZOOM);
    ctx.translate(-camX,-camY);
    drawWorld();
    drawWorldTextLayer();
    ctx.restore();
    // 前景氛围（屏幕空间）
    drawForeground();
    if(tilt) ctx.restore();   // 结束视角倾斜，UI 与画面特效不受倾斜影响
    // 最终战（克劳迪奥）画面特效：电闪雷鸣 / 狂风骤雨 / 进场暗化（世界之后、UI 之前，屏幕空间）
    drawFinalBattleFx();
    // 屏幕闪光
    if(flashT>0){ ctx.fillStyle=flashColor; ctx.globalAlpha=clamp(flashT/16,0,1); ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
    if(poisonT>0) drawPoisonSpreadOverlay();
    // Boss 血条 & 能量条
    if(bossStarted && boss && !boss.dead) drawBossBar();
    if(bossStarted && player && !player.dead) drawEnergyBar();
    if(bonusLevel) drawBonusOverlay();
    drawScreenFloaters();
    // 第四幕船舱进/出过场：全屏淡黑遮罩（覆盖 UI 之上，确保切换无缝）
    if(cabinFade>0){ ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle='rgba(0,0,0,'+clamp(cabinFade,0,1).toFixed(3)+')'; ctx.fillRect(0,0,W,H); ctx.restore(); }
    if(actIndex===3 && state===STATE.PLAY) {/* timer in HUD */}
  }
}
function drawWorld(){
  // 只绘制视野内
  const vx0=camX-40, vx1=camX+VW+40;
  for(const p of level.platforms){ if(p.x+p.w<vx0||p.x>vx1)continue; drawPlatform(p); }
  for(const m of level.movers){ if(m.x+m.w<vx0||m.x>vx1)continue; drawPlatform(m); }
  drawStructureDecor();   // 【新增】新增地图结构（城垛多层/登塔/迷宫）的世界层装饰
  for(const hz of level.hazards){ if(hz._hidden||hz.x+hz.w<vx0||hz.x>vx1)continue; drawHazard(hz); }
  for(const bk of level.breakables){ if(bk.dead||bk.x+bk.w<vx0||bk.x>vx1)continue; drawBreakable(bk); }
  for(const ch of level.chests){ if(ch.taken||ch.x>vx1||ch.x+ch.w<vx0)continue; drawChest(ch); }
  for(const tr of level.triggers){ if(tr.x+tr.w<vx0||tr.x>vx1)continue; if(tr.type==='bonusEntrance')continue; drawTrigger(tr); }
  for(const cp of level.checkpoints){ if(cp.x<vx0||cp.x>vx1)continue; drawCheckpoint(cp); }
  for(const it of level.pickups){ if(it.taken||it.x>vx1||it.x+it.w<vx0)continue; drawPickupItem(it); }
  if(level.exitPortal) drawBonusExitPortal(level.exitPortal);
  // 目标门
  if(!goalReached && (actIndex<3 || bonusLevel)) drawGoal(level.goalX, GROUND_TOP);
  // 落石
  for(const r of rocks){ if(r.warn>0){ ctx.fillStyle='rgba(255,80,80,'+(0.3+0.3*Math.sin(frame*0.4))+')'; ctx.fillRect(r.x, GROUND_TOP-140, r.w, 6); ctx.fillStyle='rgba(255,120,120,0.6)'; ctx.font='12px serif'; ctx.textAlign='center'; ctx.fillText('!', r.x+r.w/2, GROUND_TOP-130); }
    ctx.fillStyle='#6a5a52'; ctx.fillRect(r.x,r.y,r.w,r.h); ctx.fillStyle='#4a3e38'; ctx.fillRect(r.x+3,r.y+3,r.w-6,r.h-6); }
  // 独立背景角色层：第三幕朋克奥菲莉亚只游走不碰撞
  drawPunkOpheliaLayer();
  drawCourtOpheliaLayer();         // 第二幕正常奥菲莉亚背景 NPC
  // 抛射物
  for(const pr of projectiles){ drawProjectile(pr); }
  // 敌人
  for(const e of enemies){ if(e.x+e.w<vx0||e.x>vx1)continue; drawEnemy(e); }
  // 随从
  if(companion && companion.active) drawCompanion(companion);
  // Boss
  if(boss && !boss.dead){ drawGhostOpheliaFinale(); drawBoss(boss); }
  else if(boss && boss.dead && boss.deathT>0){ ctx.save(); ctx.globalAlpha=clamp(boss.deathT/120,0,1); drawBoss(boss); ctx.restore(); }
  // 玩家
  if(player && !player.dead){ drawPlayerWorld(); }
  // 第四幕船舱陷阱层（世界空间）：活板门警示/缺口、天花板扫光、舷窗水柱、板条箱
  if(cabinActive) drawCabinTraps();
  // 粒子/花瓣
  drawParticlesWorld();
}
function drawBonusExitPortal(portal){
  const cx=portal.x+portal.w/2, base=portal.y+portal.h;
  const pulse=0.55+0.25*Math.sin(frame*0.12);
  ctx.save();
  const g=ctx.createLinearGradient(cx, portal.y, cx, base);
  g.addColorStop(0,'rgba(255,238,150,0.08)');
  g.addColorStop(0.45,'rgba(232,194,90,'+(0.36+pulse*0.18)+')');
  g.addColorStop(1,'rgba(255,176,42,0.18)');
  ctx.fillStyle=g; ctx.fillRect(portal.x, portal.y, portal.w, portal.h);
  ctx.strokeStyle='rgba(255,235,160,0.9)'; ctx.lineWidth=2; ctx.strokeRect(portal.x+4, portal.y+4, portal.w-8, portal.h-8);
  ctx.globalAlpha=0.55; ctx.fillStyle='#e8c25a'; ctx.beginPath(); ctx.ellipse(cx, base-6, portal.w*0.52, 8, 0, 0, Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
  for(let i=0;i<3;i++){ const x=portal.x+10+i*18; ctx.fillStyle='rgba(255,230,120,'+(0.28+0.18*Math.sin(frame*0.1+i))+')'; ctx.fillRect(x, portal.y+8, 5, portal.h-18); }
  ctx.font='bold 13px "Courier New","Songti SC",monospace'; ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillStyle='#fff0a8';
  ctx.fillText('[ 出口 → 主线 ]', cx, portal.y-8);
  ctx.restore();
}
function drawWorldTextLayer(){
  if(!level) return;
  const vx0=camX-40, vx1=camX+VW+40;
  for(const tr of level.triggers){ if(tr.x+tr.w<vx0||tr.x>vx1)continue; if(tr.type==='bonusEntrance') drawTrigger(tr); }
  if(level.bowPickup) drawBowPickup(level.bowPickup);
  drawWorldFloaters();
}
function drawBonusOverlay(){
  ctx.save();
  ctx.fillStyle='rgba(8,6,14,0.62)'; ctx.fillRect(16,86,250,48);
  ctx.strokeStyle='rgba(232,194,90,.45)'; ctx.strokeRect(16,86,250,48);
  ctx.fillStyle=ACTS[Math.min(actIndex,ACT_FINAL)].accent; ctx.font='bold 15px "Courier New",monospace'; ctx.textAlign='left';
  ctx.fillText(bonusLevel.kind, 28, 108);
  ctx.fillStyle='#c4b98f'; ctx.font='12px "Courier New",monospace';
  ctx.fillText('可选支线 · Esc 放弃返回主线', 28, 126);
  if(level.deaths!==undefined){ ctx.fillStyle='#ff8a8a'; ctx.fillText('本局死亡次数 '+level.deaths, W-190, 104); }
  if(level.monologue && !level.monologue.done) drawBonusMonologueScene();
  ctx.restore();
}
// ===== 第五幕「决战前的独白」：全屏 Canvas 戏剧演出（参考 NT Live 卷福版舞台演出感）=====
function drawBonusMonologueScene(){
  const m=level.monologue; if(!m||m.done) return;
  const introA=clamp(m.t/45,0,1);
  const endA=m.ending ? 1-clamp(m.fade/70,0,1) : 1;
  const alpha=clamp(introA*endA,0,1);
  if(alpha<=0) return;
  const px=m.px;                                 // 舞台踱步位置（由动作状态机驱动）
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=alpha;
  ctx.fillStyle='#040408'; ctx.fillRect(0,0,W,H); // 戏剧黑场（全屏覆盖玩法层）
  _monoBackdrop(m);            // 层1 背景海报
  _monoStage(m);               // 层2 NT Live 舞台场景
  _monoSpotlight(m, px);       // 层3 聚光灯
  _monoHamlet(m, px);          // 层4 骨骼哈姆雷特
  _monoSubtitles(m, alpha);    // 层5 舞台对白框
  ctx.globalAlpha=1;
  _monoSkipButton(m);          // 右下角固定跳过（始终不透明、置于最上层）
  ctx.restore();
}
// 层1 背景海报：近黑舞台底色 + 强暗角 + 中央巨幅低饱和半透明卷福立绘（戏剧海报感）
function _monoBackdrop(m){
  ctx.save();
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#050506'); bg.addColorStop(0.5,'#08080b'); bg.addColorStop(1,'#0a0a0d');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
  const warm=!!(typeof opheliaSaved!=='undefined' && opheliaSaved);
  // 头顶戏剧性背光晕（"To be or not to be" 空远沉思氛围）
  const halo=ctx.createRadialGradient(W*0.5,H*0.30,10,W*0.5,H*0.30,240);
  halo.addColorStop(0, warm?'rgba(60,50,28,0.5)':'rgba(34,40,66,0.5)'); halo.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=halo; ctx.fillRect(0,0,W,H);
  // 巨幅半透明向量立绘（略微仰头：整体微幅上仰旋转；低饱和 tint；alpha≈0.22 增存在感但不抢前景）
  ctx.save();
  ctx.translate(W*0.5, H*0.5); ctx.rotate(-0.035); ctx.scale(2.86,2.86);
  // 立绘投影层（更深、下移，增强体积与海报厚度）
  ctx.save(); ctx.globalAlpha=0.12; ctx.filter='brightness(0) blur(2px)'; ctx.translate(2.5,4); drawVectorHamletPortrait(ctx, 4, warm, !warm); ctx.restore();
  // 立绘主层（不改公共函数，仅在此调用时叠加 tint/对比）
  ctx.globalAlpha=0.22;
  ctx.filter='saturate(0.26) brightness(0.86) contrast(1.12)';
  drawVectorHamletPortrait(ctx, 4, warm, !warm);
  ctx.filter='none'; ctx.globalAlpha=1;
  // —— 额外精细明暗/描边层（叠在海报之上提升张力，不触碰公共函数）——
  const fh=ctx.createRadialGradient(-2,-58,2,-2,-58,26);
  fh.addColorStop(0, warm?'rgba(255,238,200,0.22)':'rgba(200,214,255,0.18)'); fh.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=fh; ctx.beginPath(); ctx.ellipse(-2,-52,20,26,0,0,6.283); ctx.fill();       // 仰头受光面
  ctx.fillStyle='rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.moveTo(2,-70); ctx.lineTo(16,-64); ctx.lineTo(12,-30); ctx.lineTo(2,-30); ctx.closePath(); ctx.fill(); // 背光侧加深
  ctx.strokeStyle=warm?'rgba(214,174,69,0.34)':'rgba(120,104,150,0.3)'; ctx.lineWidth=1.1;
  ctx.beginPath(); ctx.moveTo(-25,-20); ctx.lineTo(-44,48); ctx.moveTo(25,-20); ctx.lineTo(44,48); ctx.stroke(); // 肩胸轮廓光
  ctx.restore();
  // 单色调 tint 使海报融入舞台（配合更高 alpha 略降）
  ctx.globalAlpha=1;
  ctx.fillStyle = warm?'rgba(30,24,12,0.26)':'rgba(13,15,26,0.28)';
  ctx.fillRect(0,0,W,H);
  // 强四周暗角
  const vig=ctx.createRadialGradient(W*0.5,H*0.5,W*0.17,W*0.5,H*0.5,W*0.82);
  vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(0.6,'rgba(0,0,0,0.42)'); vig.addColorStop(1,'rgba(0,0,0,0.95)');
  ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);
  ctx.globalAlpha=1;
  ctx.restore();
}
// 确定性伪随机（基于索引，保证道具位置逐帧稳定）
function _srand(i){ const x=Math.sin(i*127.1+31.7)*43758.5453; return x-Math.floor(x); }
// 独白烟雾粒子初始化
function _monoInitSmoke(){
  const a=[];
  for(let i=0;i<7;i++){ const r=_srand(i*5+1);
    a.push({ x:_srand(i*5+2)*W, y:H*(0.80+0.14*_srand(i*5+3)), r:70+r*70, spd:(0.12+_srand(i*5+4)*0.22)*(r<0.5?-1:1), seed:_srand(i*5+5)*6.283 }); }
  return a;
}
// 层2 NT Live 舞台场景：透视木地板 + 玩具锡兵 + 侧幕帷幕 + 倒椅 + 地面烟雾
function _monoStage(m){
  ctx.save();
  const floorY=H*0.72;
  // —— 透视木地板（更强对比 + 板缝加深 + 板缘高光 + 板间投影）——
  const fg=ctx.createLinearGradient(0,floorY,0,H);
  fg.addColorStop(0,'#3a2818'); fg.addColorStop(0.4,'#241811'); fg.addColorStop(1,'#080503');
  ctx.fillStyle=fg; ctx.fillRect(0,floorY,W,H-floorY);
  const vpx=W*0.5;
  // 纵向木板（深缝 + 板缘高光，向舞台深处收敛）
  for(let i=-8;i<=8;i++){ const bx=W*0.5+i*70, tx=vpx+(bx-vpx)*0.14;
    ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(bx,H); ctx.lineTo(tx,floorY); ctx.stroke();
    ctx.strokeStyle='rgba(120,88,52,0.18)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(bx+3,H); ctx.lineTo(tx+2,floorY); ctx.stroke();
  }
  // 横向板缝（近疏远密，透视）+ 缝下高光
  for(let i=1;i<=9;i++){ const t=i/9, y=floorY+(H-floorY)*t*t;
    ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=1.8; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    ctx.strokeStyle='rgba(130,96,58,0.14)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,y+2); ctx.lineTo(W,y+2); ctx.stroke();
  }
  // 木纹深浅条纹
  ctx.strokeStyle='rgba(90,64,38,0.22)'; ctx.lineWidth=1;
  for(let i=0;i<26;i++){ const gy=floorY+_srand(i*2+11)*(H-floorY); const gx=_srand(i*2+12)*W; ctx.beginPath(); ctx.moveTo(gx-30,gy); ctx.quadraticCurveTo(gx,gy+2.5,gx+30,gy); ctx.stroke(); }
  // —— 地面体积雾（每团由 3 个错位叠加的 radial-gradient 组成，缓慢横移飘动）——
  if(m.smoke) for(const s of m.smoke){
    const rr=s.r*(0.82+0.18*Math.sin(frame*0.011+s.seed));
    for(let b=0;b<3;b++){
      const ox=Math.sin(s.seed*1.7+b*2.1+frame*0.006)*rr*0.4, oy=Math.cos(s.seed+b*1.3)*rr*0.16*(b+1);
      const br=rr*(0.62+0.24*b), a=0.075/(b+1);
      const g=ctx.createRadialGradient(s.x+ox,s.y+oy,0,s.x+ox,s.y+oy,br);
      g.addColorStop(0,'rgba(158,160,170,'+a+')'); g.addColorStop(0.55,'rgba(144,146,156,'+(a*0.5)+')'); g.addColorStop(1,'rgba(140,142,152,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(s.x+ox,s.y+oy,br,br*0.5,0,0,6.283); ctx.fill();
    }
  }
  // —— 散落玩具锡兵（11 个，放大 + 细节化，确定性分布，近大远小，避开脚下正中）——
  const N=11;
  for(let i=0;i<N;i++){
    const rx=_srand(i*3+21), ry=_srand(i*3+22), rk=_srand(i*3+23);
    let sxp=W*0.08+rx*W*0.84;
    const syp=floorY+18+ry*(H-floorY-30);
    if(Math.abs(sxp-m.px)<70){ sxp += (sxp<m.px?-1:1)*(70+rk*26); }
    const depth=(syp-floorY)/(H-floorY);
    const scl=0.72+depth*0.9;                            // 近大远小
    _monoSoldier(sxp, syp, (15+rk*8)*scl, rk>0.6, i);
  }
  // —— 散乱道具：倒下/歪斜的木椅 ——
  _monoChair(W*0.17, floorY+(H-floorY)*0.6, 1.35, 1.0);
  _monoChair(W*0.85, floorY+(H-floorY)*0.4, -0.32, 0.82);
  // —— 侧幕/舞台帷幕（左右厚重垂坠，带竖向褶皱 + 顶部帷幔）——
  _monoDrape(-1); _monoDrape(1);
  ctx.restore();
}
// 单个玩具锡兵（放大细节化：头盔 + 持枪 + 底座圆盘，绿/锡灰配色 + 高光投影）
function _monoSoldier(x,y,h,fallen,i){
  ctx.save(); ctx.translate(x,y);
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0,2,h*0.5,h*0.14,0,0,6.283); ctx.fill();
  if(fallen) ctx.rotate(1.4+_srand(i+7)*0.3);
  const green='#3f5238', greenHi='#6f855c', tin='#9aa48c', dk='#1e261a';
  // 底座圆盘（上亮下暗）
  ctx.fillStyle=tin; ctx.beginPath(); ctx.ellipse(0,-h*0.02,h*0.32,h*0.1,0,0,6.283); ctx.fill();
  ctx.fillStyle=dk; ctx.beginPath(); ctx.ellipse(0,-h*0.02,h*0.32,h*0.1,0,0,Math.PI); ctx.fill();
  // 腿
  ctx.strokeStyle=green; ctx.lineWidth=h*0.12; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-h*0.09,-h*0.08); ctx.lineTo(-h*0.11,-h*0.42); ctx.moveTo(h*0.09,-h*0.08); ctx.lineTo(h*0.11,-h*0.42); ctx.stroke();
  // 躯干（军绿制服 + 受光高光）
  ctx.fillStyle=green; ctx.beginPath();
  ctx.moveTo(-h*0.15,-h*0.4); ctx.lineTo(h*0.15,-h*0.4); ctx.lineTo(h*0.17,-h*0.78); ctx.lineTo(-h*0.17,-h*0.78); ctx.closePath(); ctx.fill();
  ctx.fillStyle=greenHi; ctx.fillRect(-h*0.15,-h*0.76,h*0.08,h*0.36);
  // 手臂 + 斜持步枪（带刺刀）
  ctx.strokeStyle=green; ctx.lineWidth=h*0.09; ctx.beginPath(); ctx.moveTo(-h*0.12,-h*0.66); ctx.lineTo(h*0.2,-h*0.6); ctx.stroke();
  ctx.strokeStyle=dk; ctx.lineWidth=h*0.07; ctx.beginPath(); ctx.moveTo(h*0.02,-h*0.5); ctx.lineTo(h*0.34,-h*1.02); ctx.stroke();
  ctx.strokeStyle=tin; ctx.lineWidth=h*0.04; ctx.beginPath(); ctx.moveTo(h*0.3,-h*0.96); ctx.lineTo(h*0.4,-h*1.12); ctx.stroke();
  // 头 + 头盔（盔顶 + 盔檐 + 盔高光）
  ctx.fillStyle='#caa77e'; ctx.beginPath(); ctx.arc(0,-h*0.86,h*0.13,0,6.283); ctx.fill();
  ctx.fillStyle=green; ctx.beginPath(); ctx.arc(0,-h*0.9,h*0.17,Math.PI,0); ctx.closePath(); ctx.fill();
  ctx.fillStyle=dk; ctx.fillRect(-h*0.19,-h*0.9,h*0.38,h*0.05);
  ctx.fillStyle=greenHi; ctx.beginPath(); ctx.arc(-h*0.05,-h*0.93,h*0.06,Math.PI,0); ctx.fill();
  ctx.restore();
}
// 倒下/歪斜的木椅剪影
function _monoChair(x,y,rot,scl){
  ctx.save(); ctx.translate(x,y); ctx.rotate(rot); ctx.scale(scl,scl);
  ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(0,4,34,7,0,0,6.283); ctx.fill();
  ctx.strokeStyle='#160f09'; ctx.lineWidth=5; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-20,0); ctx.lineTo(20,0); ctx.stroke();          // 座
  ctx.beginPath(); ctx.moveTo(-20,0); ctx.lineTo(-24,-34); ctx.stroke();       // 靠背
  ctx.beginPath(); ctx.moveTo(-14,-6); ctx.lineTo(-22,-34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-16,0); ctx.lineTo(-18,26); ctx.moveTo(16,0); ctx.lineTo(18,26); ctx.stroke(); // 前腿
  ctx.strokeStyle='rgba(90,66,40,0.5)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(-20,-2); ctx.lineTo(20,-2); ctx.stroke();
  ctx.restore();
}
// 侧幕帷幕（side=-1 左 / 1 右）：厚重垂坠 + 明暗交替竖向褶皱 + 顶部帷幔/流苏
function _monoDrape(side){
  ctx.save();
  const dw=132, x0= side<0?0:W-dw;
  // 主体深色垂坠（向舞台内侧渐隐，颜色更浓）
  const g=ctx.createLinearGradient(x0,0,x0+dw,0);
  if(side<0){ g.addColorStop(0,'#0a0604'); g.addColorStop(0.55,'rgba(14,9,6,0.8)'); g.addColorStop(1,'rgba(14,9,6,0)'); }
  else { g.addColorStop(0,'rgba(14,9,6,0)'); g.addColorStop(0.45,'rgba(14,9,6,0.8)'); g.addColorStop(1,'#0a0604'); }
  ctx.fillStyle=g; ctx.fillRect(x0,0,dw,H);
  // 竖向褶皱：多条明暗交替的竖向渐变褶 + 褶脊高光
  for(let i=0;i<6;i++){
    const fx=x0+ (side<0? 8+i*20 : dw-8-i*20);
    const fold=ctx.createLinearGradient(fx-9,0,fx+9,0);
    fold.addColorStop(0,'rgba(0,0,0,0.5)'); fold.addColorStop(0.5,'rgba(96,60,36,0.16)'); fold.addColorStop(1,'rgba(0,0,0,0.5)');
    ctx.fillStyle=fold; ctx.beginPath();
    ctx.moveTo(fx-9,0); ctx.quadraticCurveTo(fx-9+side*5,H*0.5,fx-9,H);
    ctx.lineTo(fx+9,H); ctx.quadraticCurveTo(fx+9+side*5,H*0.5,fx+9,0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(120,80,48,0.22)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(fx,0); ctx.quadraticCurveTo(fx+side*5,H*0.5,fx,H); ctx.stroke();
  }
  // 顶部帷幔（横向垂坠弧瓣 + 流苏）
  const vh=64;
  const vg=ctx.createLinearGradient(0,0,0,vh); vg.addColorStop(0,'#1a0f08'); vg.addColorStop(1,'rgba(10,6,4,0.2)');
  ctx.fillStyle=vg; ctx.fillRect(x0,0,dw,vh*0.5);
  ctx.fillStyle='rgba(10,6,4,0.85)';
  for(let i=0;i<6;i++){ const sx=x0+i*(dw/5.5); ctx.beginPath(); ctx.moveTo(sx,vh*0.5); ctx.quadraticCurveTo(sx+dw/11,vh*0.92,sx+dw/5.5,vh*0.5); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle='rgba(150,110,50,0.4)'; ctx.lineWidth=1;
  for(let i=0;i<=Math.floor(dw/16);i++){ const sx=x0+i*16; ctx.beginPath(); ctx.moveTo(sx,vh*0.55); ctx.lineTo(sx,vh*0.72); ctx.stroke(); }
  ctx.restore();
}
// 通用光锥
function _monoCone(topX,botX,topHalf,botHalf,tint,str){
  const topY=-18, botY=H*0.94;
  ctx.beginPath(); ctx.moveTo(topX-topHalf,topY); ctx.lineTo(topX+topHalf,topY);
  ctx.lineTo(botX+botHalf,botY); ctx.lineTo(botX-botHalf,botY); ctx.closePath();
  const g=ctx.createLinearGradient(topX,topY,botX,botY);
  g.addColorStop(0,'rgba('+tint+','+str+')'); g.addColorStop(0.4,'rgba('+tint+','+(str*0.55)+')');
  g.addColorStop(0.75,'rgba('+tint+','+(str*0.22)+')'); g.addColorStop(1,'rgba('+tint+',0.01)');
  ctx.fillStyle=g; ctx.fill();
}
// 层3 聚光灯：主硬边聚光锥 + 地面光池 + 淡倒影 + 锥内尘埃，另加两束更弱侧光
function _monoSpotlight(m, px){
  const warm=!!(typeof opheliaSaved!=='undefined' && opheliaSaved);
  const tint=warm?'255,242,205':'225,235,255';
  const footY=H*0.9, bottomY=H*0.96;
  ctx.save();
  // 两束更弱侧光（丰富舞台层次）
  _monoCone(W*0.26, px-46, 20, 96, tint, 0.09);
  _monoCone(W*0.74, px+46, 20, 96, tint, 0.09);
  // 主聚光锥
  const topX=W*0.5+(px-W*0.5)*0.32;
  _monoCone(topX, px, 34, 138, tint, 0.30);
  // 亮核
  _monoCone(topX, px, 13, 58, '255,255,248', 0.24);
  // 地面光池 + 淡倒影
  const pool=ctx.createRadialGradient(px,footY,8,px,footY,125);
  pool.addColorStop(0,'rgba(255,255,245,0.64)'); pool.addColorStop(0.42,'rgba('+tint+',0.34)'); pool.addColorStop(1,'rgba('+tint+',0)');
  ctx.fillStyle=pool; ctx.beginPath(); ctx.ellipse(px,footY,132,25,0,0,6.283); ctx.fill();
  ctx.globalAlpha*=0.25; ctx.fillStyle='rgba('+tint+',0.42)'; ctx.beginPath(); ctx.ellipse(px,footY+31,82,11,0,0,6.283); ctx.fill();
  ctx.globalAlpha=1;
  // 锥内受光尘埃/烟尘
  for(let i=0;i<16;i++){ const d=(frame*0.002+i*0.063)%1, x=topX+(px-topX)*d+Math.sin(frame*0.015+i)*34, y=-18+(bottomY+18)*d; ctx.fillStyle='rgba('+tint+','+(0.02+0.025*Math.sin(frame*0.025+i))+')'; ctx.beginPath(); ctx.arc(x,y,1.1+(i%3)*0.35,0,6.283); ctx.fill(); }
  ctx.restore();
}
// 基础站立位姿（关节角度，弧度）；角度约定：腿0向下+向前，躯干0向上+前倾，手臂0下垂+前摆
function _monoBasePose(){
  return { torso:0.02, head:0, thighF:0.06, shinF:-0.05, thighB:-0.06, shinB:-0.03,
           shF:0.12, elF:0.12, shB:-0.12, elB:0.12,
           tilt:0, lean:0, handOpen:0.25, hemSway:0 };   // 扩展：重心侧倾/前后倾/前手张开度/下摆摆动
}
// 各动作阶段的目标位姿（状态机每帧插值逼近）
function _monoTargetPose(m){
  switch(m.phase){
    case 0: {                              // 踱步：双腿交替、手臂反向摆动 + 重心侧移
      const sw=Math.sin(m.stepT);
      return { torso:0.08, head:-0.02,
        thighF:0.05+0.48*sw,  shinF:-0.15-0.32*Math.max(0,sw),
        thighB:0.05-0.48*sw,  shinB:-0.15-0.32*Math.max(0,-sw),
        shF:0.15-0.48*sw, elF:0.32, shB:0.15+0.48*sw, elB:0.32,
        tilt:0.06*Math.sin(m.stepT*0.5), lean:0.05, handOpen:0.2, hemSway:0.5*sw };
    }
    case 1: return { torso:0.03, head:0.0, thighF:0.06, shinF:-0.05, thighB:-0.06, shinB:-0.03, shF:0.12, elF:0.12, shB:-0.12, elB:0.12, tilt:0.04, lean:0.0, handOpen:0.25, hemSway:0.1 }; // 站定（重心微移）
    case 2: return { torso:0.46, head:0.28, thighF:0.86, shinF:-0.96, thighB:0.74, shinB:-1.06, shF:0.95, elF:0.95, shB:0.35, elB:0.62, tilt:0.0, lean:0.5, handOpen:0.85, hemSway:-0.3 }; // 蹲下俯身拾物（前倾、伸手）
    case 3: return { torso:0.10, head:0.04, thighF:0.10, shinF:-0.08, thighB:-0.08, shinB:-0.03, shF:0.20, elF:0.20, shB:-0.10, elB:0.18, tilt:0.0, lean:0.12, handOpen:0.5, hemSway:0.1 }; // 起身
    case 4: return { torso:-0.06, head:-0.19, thighF:0.05, shinF:-0.05, thighB:-0.09, shinB:-0.02, shF:1.34, elF:1.72, shB:-0.16, elB:0.14, tilt:-0.05, lean:-0.08, handOpen:1.0, hemSway:0.15 }; // 抬手独白（掌心朝上、头微仰、手掌摊开）
    case 5: return _monoBasePose();        // 转身（narrow 由 turnScale 处理）
    default: return _monoBasePose();
  }
}
// 前向运动学：以髋为原点求各关节坐标
function _monoFK(pose){
  const thighLen=76, shinLen=80, torsoLen=132, headNeck=46, upperLen=54, foreLen=52, legSpread=11, shW=30;
  const hipL={x:-legSpread,y:0}, hipR={x:legSpread,y:0};
  const kneeF={x:hipR.x+Math.sin(pose.thighF)*thighLen, y:hipR.y+Math.cos(pose.thighF)*thighLen};
  const footF={x:kneeF.x+Math.sin(pose.shinF)*shinLen, y:kneeF.y+Math.cos(pose.shinF)*shinLen};
  const kneeB={x:hipL.x+Math.sin(pose.thighB)*thighLen, y:hipL.y+Math.cos(pose.thighB)*thighLen};
  const footB={x:kneeB.x+Math.sin(pose.shinB)*shinLen, y:kneeB.y+Math.cos(pose.shinB)*shinLen};
  const neck={x:Math.sin(pose.torso)*torsoLen, y:-Math.cos(pose.torso)*torsoLen};
  const shC={x:Math.sin(pose.torso)*torsoLen*0.9, y:-Math.cos(pose.torso)*torsoLen*0.9};
  const shoulderF={x:shC.x+shW*0.5, y:shC.y+4}, shoulderB={x:shC.x-shW*0.5, y:shC.y+4};
  const elbowF={x:shoulderF.x+Math.sin(pose.shF)*upperLen, y:shoulderF.y+Math.cos(pose.shF)*upperLen};
  const handF={x:elbowF.x+Math.sin(pose.elF)*foreLen, y:elbowF.y+Math.cos(pose.elF)*foreLen};
  const elbowB={x:shoulderB.x+Math.sin(pose.shB)*upperLen, y:shoulderB.y+Math.cos(pose.shB)*upperLen};
  const handB={x:elbowB.x+Math.sin(pose.elB)*foreLen, y:elbowB.y+Math.cos(pose.elB)*foreLen};
  const headC={x:neck.x+Math.sin(pose.torso+pose.head)*headNeck, y:neck.y-Math.cos(pose.torso+pose.head)*headNeck};
  return {hipL,hipR,kneeF,footF,kneeB,footB,neck,shC,shoulderF,shoulderB,elbowF,handF,elbowB,handB,headC};
}
// 层4 骨骼哈姆雷特：分段关节人物，随动作状态机做关键帧插值动画，聚光自上而下打光
function _monoHamlet(m, px){
  const warm=!!(typeof opheliaSaved!=='undefined' && opheliaSaved);
  const footY=H*0.9;
  const P=_monoFK(m.pose);
  const maxFootY=Math.max(P.footF.y, P.footB.y);
  const breath=Math.sin(frame*0.045)*1.4;      // 呼吸微动
  const gold=warm?'#c8a24a':'#5a4a72';
  // 锥形四边形肢体助手：a(宽wA)→b(宽wB)渐变收窄，col 主色，hi 受光侧高光；含关节圆头（肩/肘/髋/腕），肘部微弯、腕部收窄
  const limb=(a,b,wA,wB,col,hi)=>{
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1, nx=-dy/len, ny=dx/len;
    ctx.fillStyle=col; ctx.beginPath();
    ctx.moveTo(a.x+nx*wA*0.5, a.y+ny*wA*0.5);
    ctx.quadraticCurveTo((a.x+b.x)/2+nx*(wA+wB)*0.28, (a.y+b.y)/2+ny*(wA+wB)*0.28, b.x+nx*wB*0.5, b.y+ny*wB*0.5); // 外侧肘部微弯
    ctx.lineTo(b.x-nx*wB*0.5, b.y-ny*wB*0.5);
    ctx.quadraticCurveTo((a.x+b.x)/2-nx*(wA+wB)*0.22, (a.y+b.y)/2-ny*(wA+wB)*0.22, a.x-nx*wA*0.5, a.y-ny*wA*0.5);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x,a.y,wA*0.5,0,6.283); ctx.fill();   // 起点关节圆头
    ctx.beginPath(); ctx.arc(b.x,b.y,wB*0.5,0,6.283); ctx.fill();   // 终点关节圆头（腕/踝收窄）
    if(hi){ ctx.strokeStyle=hi; ctx.lineWidth=Math.max(1,wB*0.16); ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(a.x+nx*wA*0.30, a.y+ny*wA*0.30); ctx.lineTo(b.x+nx*wB*0.30, b.y+ny*wB*0.30); ctx.stroke(); }
  };
  // 手掌助手：以腕点为基、朝向由 elbow→wrist 决定；skin 肤色，open 张开度(0握拢→1摊开)；绘掌+简化四指+拇指+掌背暗面
  const hand=(wrist,elbow,skin,open)=>{
    const ang=Math.atan2(wrist.y-elbow.y, wrist.x-elbow.x), op=clamp(open==null?0.4:open,0,1);
    ctx.save(); ctx.translate(wrist.x,wrist.y); ctx.rotate(ang);
    ctx.fillStyle=skin; ctx.beginPath(); ctx.ellipse(3.2,0,6.4,5,0,0,6.283); ctx.fill();   // 掌
    ctx.strokeStyle=skin; ctx.lineCap='round'; const spread=0.36*op;
    for(let f=0;f<4;f++){ const a2=(f-1.5)*spread, fl=(8.8-Math.abs(f-1.5)*1.2)*(0.72+0.28*op); ctx.lineWidth=2.5-f*0.24; ctx.beginPath(); ctx.moveTo(7.5,0); ctx.lineTo(7.5+Math.cos(a2)*fl, Math.sin(a2)*fl); ctx.stroke(); } // 四指
    ctx.lineWidth=2.9; ctx.beginPath(); ctx.moveTo(2.4,3.2); ctx.lineTo(2.4+Math.cos(1.15)*6.6, 3.2+Math.sin(1.15)*6.6); ctx.stroke(); // 拇指
    ctx.fillStyle='rgba(70,44,32,0.30)'; ctx.beginPath(); ctx.ellipse(3.4,2.2,4.8,2.5,0,0,6.283); ctx.fill();   // 掌背暗面
    ctx.restore();
  };
  ctx.save();
  ctx.translate(px, footY);
  ctx.scale(m.facing*m.turnScale, 1);
  ctx.rotate((m.pose.lean||0)*0.05 + (m.pose.tilt||0)*0.05);   // 重心偏移/沉思时上身微斜（lean/tilt 驱动）
  ctx.translate(0, -maxFootY + breath);
  // 落地投影
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(0, maxFootY-breath+4, 60, 12, 0, 0, 6.283); ctx.fill();
  // —— 后腿（偏暗）——
  limb(P.hipL, P.kneeB, 21, 16, '#0a0a0f', null); limb(P.kneeB, P.footB, 16, 12, '#050508', null);
  ctx.fillStyle='#020203'; ctx.beginPath(); ctx.ellipse(P.footB.x+6, P.footB.y-3, 15, 7, 0, 0, 6.283); ctx.fill();
  // —— 后臂（偏暗，躯干之后）——
  limb(P.shoulderB, P.elbowB, 14, 11, '#0b0b12', null); limb(P.elbowB, P.handB, 11, 8.5, '#0e0e16', null);
  hand(P.handB, P.elbowB, '#caa47e', 0.15);
  // ===== 躯干黑色军装外套（卷福版：方肩/收腰/展摆 · 高立领 · 肩章 · 排扣 · 斜绶带 · 顶光衣褶）=====
  const Hc=P.headC;                                   // 头心（后续脸/领/记录头顶均用）
  const goldHi = warm?'#f5dd90':'#a08cbc';            // 金属受光高光
  const goldDk = warm?'#7f6220':'#382a4e';            // 金属暗部
  const hemY=66, sway=(m.pose.hemSway||0)*7;   // 下摆随动作左右摆动（hemSway 驱动）
  // 肩章绘制（金呢底 + 绲边高光 + 流苏 + 肩扣）
  const drawEp=(sx,sy,dir)=>{ ctx.save();
    ctx.fillStyle=goldDk; ctx.beginPath(); ctx.moveTo(sx-3*dir,sy-4.5); ctx.lineTo(sx+16*dir,sy-4); ctx.lineTo(sx+18*dir,sy+1); ctx.lineTo(sx+16*dir,sy+4); ctx.lineTo(sx-3*dir,sy+4.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle=gold; ctx.beginPath(); ctx.moveTo(sx-2*dir,sy-3.2); ctx.lineTo(sx+14*dir,sy-3); ctx.lineTo(sx+16*dir,sy+0.6); ctx.lineTo(sx+14*dir,sy+3); ctx.lineTo(sx-2*dir,sy+3.2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle=goldHi; ctx.lineWidth=0.9; ctx.beginPath(); ctx.moveTo(sx-2*dir,sy-3.2); ctx.lineTo(sx+14*dir,sy-3); ctx.stroke();
    ctx.fillStyle=goldHi; ctx.beginPath(); ctx.arc(sx+3*dir,sy-0.4,1.1,0,6.283); ctx.fill();
    ctx.strokeStyle=gold; ctx.lineWidth=0.8; for(let k=0;k<4;k++){ const fx=sx+(15+k*1.5)*dir; ctx.beginPath(); ctx.moveTo(fx,sy+2); ctx.lineTo(fx+1.5*dir,sy+8); ctx.stroke(); }
    ctx.restore(); };
  // 外套主体（硬朗剪影，顶光渐变：肩胸偏亮、下摆渐暗）
  const coat=ctx.createLinearGradient(0,P.shC.y,0,hemY);
  coat.addColorStop(0,'#2c2c35'); coat.addColorStop(0.34,'#181820'); coat.addColorStop(0.7,'#0e0e15'); coat.addColorStop(1,'#050508');
  ctx.fillStyle=coat;
  ctx.beginPath();
  ctx.moveTo(P.shoulderB.x-7, P.shoulderB.y-1);
  ctx.lineTo(P.shoulderF.x+7, P.shoulderF.y-1);
  ctx.lineTo(P.hipR.x+14, 4);
  ctx.lineTo(P.hipR.x+11+sway, hemY);          // 外套下摆（hemSway 摆动）
  ctx.lineTo(P.hipL.x-11+sway, hemY);
  ctx.lineTo(P.hipL.x-14, 4);
  ctx.closePath(); ctx.fill();
  // 胸口受光软高光块
  const chestHi=ctx.createLinearGradient(0,P.shC.y+4,0,24);
  chestHi.addColorStop(0, warm?'rgba(255,232,180,0.22)':'rgba(206,216,255,0.17)'); chestHi.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=chestHi; ctx.beginPath(); ctx.moveTo(-3,P.shC.y+6); ctx.lineTo(P.shoulderF.x+2,P.shoulderF.y+4); ctx.lineTo(9,20); ctx.lineTo(-9,20); ctx.closePath(); ctx.fill();
  // 衣褶明暗（下摆放射暗褶 + 少量高光褶）
  ctx.lineCap='round';
  ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=2.4;
  for(let i=-2;i<=2;i++){ ctx.beginPath(); ctx.moveTo(i*2.4,10); ctx.quadraticCurveTo(i*5.4,38,i*11,hemY); ctx.stroke(); }
  ctx.strokeStyle=warm?'rgba(255,230,175,0.10)':'rgba(200,212,255,0.09)'; ctx.lineWidth=1.2;
  for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(i*4,12); ctx.quadraticCurveTo(i*10,36,i*12,hemY-6); ctx.stroke(); }
  // 中央门襟缝 + 领口深 V
  ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(P.neck.x+1,P.neck.y+6); ctx.lineTo(1,hemY-4); ctx.stroke();
  ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(P.neck.x-1,P.neck.y+6); ctx.lineTo(-1,hemY-4); ctx.stroke();
  // 斜向绶带（左肩→右腰，缎面高光）
  ctx.save();
  const sashG=ctx.createLinearGradient(P.shoulderB.x,P.shoulderB.y, P.hipR.x, 8);
  sashG.addColorStop(0.05, warm?'#8a1220':'#3a2450'); sashG.addColorStop(0.55, warm?'#b8202e':'#4e3268'); sashG.addColorStop(1, warm?'#6a0e18':'#2a1a3c');
  ctx.strokeStyle=sashG; ctx.lineWidth=8; ctx.lineCap='butt';
  ctx.beginPath(); ctx.moveTo(P.shoulderB.x+2,P.shoulderB.y+3); ctx.lineTo(P.hipR.x+6,10); ctx.stroke();
  ctx.strokeStyle=warm?'rgba(255,180,150,0.35)':'rgba(190,170,230,0.3)'; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(P.shoulderB.x,P.shoulderB.y+1); ctx.lineTo(P.hipR.x+4,7); ctx.stroke();
  ctx.restore();
  // 束腰（皮革 + 金属带扣）
  ctx.fillStyle='#050507'; ctx.fillRect(P.hipL.x-13,-7,(P.hipR.x-P.hipL.x)+26,11);
  ctx.fillStyle=goldDk; ctx.fillRect(P.hipL.x-13,-2,(P.hipR.x-P.hipL.x)+26,3);
  ctx.fillStyle=gold; ctx.fillRect(P.hipL.x-13,-3,(P.hipR.x-P.hipL.x)+26,1.4);
  ctx.fillStyle=goldHi; ctx.fillRect(-4,-6,8,7); ctx.fillStyle=goldDk; ctx.fillRect(-2.5,-4.5,5,4);
  // 一排金属纽扣（右门襟：投影 + 底金 + 亮金 + 高光点）
  for(let i=0;i<6;i++){ const t=i/5.3, bx=P.neck.x*(1-t)+3.2, by=(P.neck.y+9)*(1-t)+(hemY-16)*t;
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(bx+0.6,by+0.8,2.5,0,6.283); ctx.fill();
    ctx.fillStyle=goldDk; ctx.beginPath(); ctx.arc(bx,by,2.4,0,6.283); ctx.fill();
    ctx.fillStyle=gold; ctx.beginPath(); ctx.arc(bx,by,1.7,0,6.283); ctx.fill();
    ctx.fillStyle=goldHi; ctx.beginPath(); ctx.arc(bx-0.6,by-0.7,0.8,0,6.283); ctx.fill(); }
  // 肩章（左右各一，清晰细节）
  drawEp(P.shoulderF.x, P.shoulderF.y, 1); drawEp(P.shoulderB.x, P.shoulderB.y, -1);
  // 顶光肩背高光
  ctx.fillStyle=warm?'rgba(255,236,185,0.14)':'rgba(210,220,255,0.12)';
  ctx.beginPath(); ctx.moveTo(P.shoulderB.x, P.shoulderB.y); ctx.lineTo(P.shoulderF.x, P.shoulderF.y); ctx.lineTo(5,-8); ctx.lineTo(-8,-8); ctx.closePath(); ctx.fill();
  // —— 前腿（军裤：深色 + 侧缝高光 + 皮靴反光）——
  limb(P.hipR, P.kneeF, 23, 17, '#15151c', warm?'rgba(255,228,175,0.10)':'rgba(200,210,255,0.09)'); limb(P.kneeF, P.footF, 17, 13, '#0b0b12', null);
  ctx.strokeStyle=warm?'rgba(255,228,175,0.10)':'rgba(200,210,255,0.09)'; ctx.lineWidth=1.4; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(P.hipR.x+3,2); ctx.lineTo(P.kneeF.x+2,P.kneeF.y); ctx.lineTo(P.footF.x+2,P.footF.y-6); ctx.stroke();
  ctx.fillStyle='#050506'; ctx.beginPath(); ctx.ellipse(P.footF.x+7, P.footF.y-3, 18, 8, 0, 0, 6.283); ctx.fill();
  ctx.fillStyle='rgba(120,120,140,0.25)'; ctx.beginPath(); ctx.ellipse(P.footF.x+3, P.footF.y-5, 7, 2.4, 0, 0, 6.283); ctx.fill();
  // —— 颈：梯形（上窄下宽）自然衔接头→肩，含胸锁乳突肌暗示、下颌投影、喉结 + 高立领（金边勾勒）——
  const nTopL=Hc.x-4.5, nTopR=Hc.x+4.5, nBotL=P.neck.x-7, nBotR=P.neck.x+7, nTopY=Hc.y+10, nBotY=P.neck.y+2, nMidY=(nTopY+nBotY)/2;
  const neckG=ctx.createLinearGradient(0,nTopY,0,nBotY);
  neckG.addColorStop(0,'#c89a72'); neckG.addColorStop(1,'#8a6144');
  ctx.fillStyle=neckG; ctx.beginPath(); ctx.moveTo(nTopL,nTopY); ctx.lineTo(nBotL,nBotY); ctx.lineTo(nBotR,nBotY); ctx.lineTo(nTopR,nTopY); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(40,22,16,0.5)'; ctx.beginPath(); ctx.ellipse(Hc.x,nTopY-0.5,5,2.6,0,0,6.283); ctx.fill();   // 下颌投影暗带
  ctx.strokeStyle='rgba(70,42,30,0.34)'; ctx.lineWidth=1.4; ctx.lineCap='round';                                  // 胸锁乳突肌暗示（两条斜向暗线）
  ctx.beginPath(); ctx.moveTo(nTopL+1.5,nTopY+1); ctx.lineTo(nBotL+3,nBotY-1); ctx.moveTo(nTopR-1.5,nTopY+1); ctx.lineTo(nBotR-3,nBotY-1); ctx.stroke();
  ctx.strokeStyle='rgba(255,236,205,0.22)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(nTopL+0.6,nTopY+1.5); ctx.lineTo(nBotL+2,nBotY-2); ctx.stroke();  // 颈侧受光高光
  ctx.fillStyle='rgba(150,104,72,0.55)'; ctx.beginPath(); ctx.ellipse(Hc.x+0.5,nMidY,1.8,2.4,0,0,6.283); ctx.fill();       // 喉结微凸
  ctx.fillStyle='rgba(255,232,198,0.18)'; ctx.beginPath(); ctx.ellipse(Hc.x-0.4,nMidY-0.6,0.9,1.2,0,0,6.283); ctx.fill();  // 喉结受光高光
  ctx.fillStyle='#0c0c14'; ctx.beginPath();
  ctx.moveTo(P.neck.x-14,P.neck.y+7); ctx.lineTo(Hc.x-8,Hc.y+13); ctx.lineTo(Hc.x+8,Hc.y+13); ctx.lineTo(P.neck.x+14,P.neck.y+7);
  ctx.lineTo(P.neck.x+10,P.neck.y-7); ctx.lineTo(P.neck.x-10,P.neck.y-7); ctx.closePath(); ctx.fill();
  ctx.strokeStyle=gold; ctx.lineWidth=1.1; ctx.beginPath(); ctx.moveTo(Hc.x-8,Hc.y+12.5); ctx.lineTo(P.neck.x-13,P.neck.y+6); ctx.moveTo(Hc.x+8,Hc.y+12.5); ctx.lineTo(P.neck.x+13,P.neck.y+6); ctx.stroke();
  // ===== 头部（卷福风格：瘦长棱角脸 · 高颧骨 · 深眼窝 · 高鼻梁 · 薄唇 · 顶光塑体，忧郁凝重）=====
  ctx.save(); ctx.translate(Hc.x, Hc.y);              // 以头心为局部原点
  // 脸型（多段折线：额角→太阳穴→高颧骨→下颌角→尖下巴）
  const skin=ctx.createLinearGradient(0,-26,0,22);
  skin.addColorStop(0,'#e9cba4'); skin.addColorStop(0.44,'#d3a67e'); skin.addColorStop(0.8,'#a9764f'); skin.addColorStop(1,'#7d5238');
  ctx.fillStyle=skin;
  ctx.beginPath();
  ctx.moveTo(0,-24); ctx.lineTo(-8,-23); ctx.lineTo(-11.5,-15);
  ctx.lineTo(-12.5,-4); ctx.lineTo(-10,4); ctx.lineTo(-7.5,11);
  ctx.lineTo(-4,18); ctx.lineTo(0,20.5); ctx.lineTo(4,18); ctx.lineTo(7.5,11);
  ctx.lineTo(10,4); ctx.lineTo(12.5,-4); ctx.lineTo(11.5,-15); ctx.lineTo(8,-23);
  ctx.closePath(); ctx.fill();
  // 背光侧整脸暗面（右半，顶光下体积）
  ctx.fillStyle='rgba(58,34,26,0.24)';
  ctx.beginPath(); ctx.moveTo(2,-22); ctx.lineTo(8,-23); ctx.lineTo(11.5,-15); ctx.lineTo(12.5,-4); ctx.lineTo(10,4); ctx.lineTo(7.5,11); ctx.lineTo(4,18); ctx.lineTo(2,10); ctx.closePath(); ctx.fill();
  // 颧骨下凹陷阴影（两侧，收出高颧骨）
  ctx.fillStyle='rgba(72,40,30,0.30)';
  ctx.beginPath(); ctx.moveTo(-12,-3); ctx.lineTo(-5,1); ctx.lineTo(-8,9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12,-3); ctx.lineTo(5,1); ctx.lineTo(8,9); ctx.closePath(); ctx.fill();
  // 颧骨受光高光棱
  ctx.fillStyle='rgba(255,238,205,0.22)';
  ctx.beginPath(); ctx.ellipse(-8,-6,3.2,1.8,-0.5,0,6.283); ctx.fill();
  ctx.beginPath(); ctx.ellipse(8,-6,3.2,1.8,0.5,0,6.283); ctx.fill();
  // 深眼窝（眉骨投影暗带 + 上眼睑投影）
  ctx.fillStyle='rgba(30,18,16,0.42)';
  ctx.beginPath(); ctx.moveTo(-11,-11); ctx.lineTo(-2,-9); ctx.lineTo(-3,-4); ctx.lineTo(-10,-5); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(11,-11); ctx.lineTo(2,-9); ctx.lineTo(3,-4); ctx.lineTo(10,-5); ctx.closePath(); ctx.fill();
  // 眉（浓、微蹙、突出眉骨）
  ctx.strokeStyle='#2a1c17'; ctx.lineWidth=1.8; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-9.5,-10.5); ctx.quadraticCurveTo(-6,-11.6,-2.2,-9.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9.5,-10.5); ctx.quadraticCurveTo(6,-11.6,2.2,-9.6); ctx.stroke();
  // 眼（深陷、外角下垂、眼神凝重不笑）
  ctx.fillStyle='rgba(226,220,208,0.9)';
  ctx.beginPath(); ctx.ellipse(-6,-6,2.6,1.5,0.06,0,6.283); ctx.fill();
  ctx.beginPath(); ctx.ellipse(6,-6,2.6,1.5,-0.06,0,6.283); ctx.fill();
  ctx.fillStyle='#4a3524';
  ctx.beginPath(); ctx.arc(-6.2,-6.4,1.3,0,6.283); ctx.fill(); ctx.beginPath(); ctx.arc(6.2,-6.4,1.3,0,6.283); ctx.fill();
  ctx.fillStyle='#0a0708';
  ctx.beginPath(); ctx.arc(-6.2,-6.4,0.6,0,6.283); ctx.fill(); ctx.beginPath(); ctx.arc(6.2,-6.4,0.6,0,6.283); ctx.fill();
  ctx.strokeStyle='rgba(20,12,12,0.85)'; ctx.lineWidth=1.1;
  ctx.beginPath(); ctx.moveTo(-8.6,-6.6); ctx.quadraticCurveTo(-6,-8,-3.4,-6.4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8.6,-6.6); ctx.quadraticCurveTo(6,-8,3.4,-6.4); ctx.stroke();
  ctx.strokeStyle='rgba(60,38,30,0.4)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(-8.2,-4.4); ctx.lineTo(-3.8,-4.6); ctx.moveTo(8.2,-4.4); ctx.lineTo(3.8,-4.6); ctx.stroke();
  // 高鼻梁（受光鼻梁高光 + 单侧鼻影 + 鼻头/鼻孔）
  ctx.strokeStyle='rgba(255,240,210,0.5)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(-1.4,-9); ctx.lineTo(-1.8,2); ctx.stroke();
  ctx.fillStyle='rgba(70,40,30,0.34)'; ctx.beginPath(); ctx.moveTo(0.4,-8); ctx.lineTo(2.6,2); ctx.lineTo(0.2,3); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(50,30,24,0.5)'; ctx.beginPath(); ctx.ellipse(-2.4,3.4,1.1,0.8,0,0,6.283); ctx.fill(); ctx.beginPath(); ctx.ellipse(1.4,3.4,1.1,0.8,0,0,6.283); ctx.fill();
  ctx.fillStyle='rgba(255,235,205,0.28)'; ctx.beginPath(); ctx.ellipse(-1.4,2.6,1.6,1.2,0,0,6.283); ctx.fill();
  // 人中 + 薄唇（上下唇分明、微抿平压）
  ctx.strokeStyle='rgba(70,44,34,0.4)'; ctx.lineWidth=0.7; ctx.beginPath(); ctx.moveTo(-0.4,5); ctx.lineTo(-0.4,7.6); ctx.stroke();
  ctx.strokeStyle='rgba(40,22,20,0.85)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(-4.4,8.4); ctx.quadraticCurveTo(-1,9,-0.4,8.7); ctx.quadraticCurveTo(1,9,4.4,8.4); ctx.stroke();
  ctx.strokeStyle='rgba(120,70,60,0.5)'; ctx.lineWidth=0.9; ctx.beginPath(); ctx.moveTo(-4,7.9); ctx.quadraticCurveTo(0,7.4,4,7.9); ctx.stroke();
  ctx.fillStyle='rgba(150,92,78,0.4)'; ctx.beginPath(); ctx.ellipse(0,9.8,3.2,1.1,0,0,6.283); ctx.fill();
  ctx.fillStyle='rgba(60,34,26,0.3)'; ctx.beginPath(); ctx.ellipse(0,12,2.6,1.4,0,0,6.283); ctx.fill();
  // 颧骨—下颌硬线条：用细暗线压出更锐利的戏剧脸型，避免圆润卡通感
  ctx.strokeStyle='rgba(52,30,24,0.46)'; ctx.lineWidth=0.9; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-11,-2); ctx.lineTo(-8,7); ctx.lineTo(-4,17); ctx.moveTo(11,-2); ctx.lineTo(8,7); ctx.lineTo(4,17); ctx.stroke();
  ctx.strokeStyle='rgba(255,232,200,0.20)'; ctx.lineWidth=0.72;
  ctx.beginPath(); ctx.moveTo(-10,-7); ctx.lineTo(-4,-5); ctx.moveTo(10,-7); ctx.lineTo(4,-5); ctx.stroke();
  // ===== 发型（偏分立体短发：底层暗块 + 中层体积 + 数条发丝高光 + 顶部受光）=====
  ctx.fillStyle='#0c0b10';
  ctx.beginPath();
  ctx.moveTo(-12.5,-4); ctx.lineTo(-13,-16); ctx.quadraticCurveTo(-9,-27,0,-27.5);
  ctx.quadraticCurveTo(10,-27,13,-15); ctx.lineTo(12.5,-4);
  ctx.lineTo(9,-9); ctx.quadraticCurveTo(8,-20,-1,-19.5);
  ctx.quadraticCurveTo(-8,-19,-9.5,-11); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#191521';
  ctx.beginPath(); ctx.moveTo(-11,-16); ctx.quadraticCurveTo(-6,-25,3,-24);
  ctx.quadraticCurveTo(-2,-19,-3,-15); ctx.quadraticCurveTo(-8,-18,-11,-13); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(150,140,160,0.32)'; ctx.lineWidth=0.8; ctx.lineCap='round';
  for(let i=0;i<11;i++){ const sx=-10+i*2.15; ctx.beginPath(); ctx.moveTo(sx,-23+i*0.32); ctx.quadraticCurveTo(sx+4.2,-17,sx+1.8+i*0.35,-8+i*0.25); ctx.stroke(); }
  ctx.strokeStyle='rgba(90,80,100,0.5)'; ctx.lineWidth=0.7;
  for(let i=0;i<4;i++){ const sx=-6+i*4; ctx.beginPath(); ctx.moveTo(sx,-24); ctx.quadraticCurveTo(sx+3,-17,sx+1,-11); ctx.stroke(); }
  ctx.fillStyle=warm?'rgba(255,236,190,0.28)':'rgba(210,222,255,0.22)';
  ctx.beginPath(); ctx.ellipse(-2,-22,6,2.4,-0.25,0,6.283); ctx.fill();
  ctx.restore();                                     // 头部局部坐标复位
  // —— 前臂（独白手势臂，最前层：军装袖 + 金袖口 + 修长手掌）——
  limb(P.shoulderF, P.elbowF, 16, 12.5, '#1e1e27', warm?'rgba(255,228,175,0.12)':'rgba(200,210,255,0.10)'); limb(P.elbowF, P.handF, 12.5, 8.5, '#22222d', warm?'rgba(255,228,175,0.10)':'rgba(200,210,255,0.09)');
  ctx.save(); ctx.translate(P.handF.x,P.handF.y); ctx.rotate(Math.atan2(P.handF.y-P.elbowF.y,P.handF.x-P.elbowF.x));
  ctx.fillStyle=goldDk; ctx.fillRect(-7,-6,4,12); ctx.fillStyle=gold; ctx.fillRect(-7,-6,1.6,12); ctx.restore();   // 金袖口
  hand(P.handF, P.elbowF, '#d8b083', m.pose.handOpen);   // 修长手掌（张开度随位姿）
  ctx.restore();
  // 记录头顶屏幕坐标供对白框定位
  m.headX=px; m.headTopY=footY-maxFootY+breath+(Hc.y-24);
}
// 层5 舞台对白框：跟随哈姆雷特头顶，仅渲染当前行（中英对照），逐行淡入、无残影
function _monoSubtitles(m, alpha){
  if(m.t<70 && !m.ending) return;
  const lines=ACT5_MONOLOGUE, idx=clamp(m.line,0,lines.length-1);
  const c=lines[idx];
  const lineA=m.ending?1:clamp(m.lineT/38,0,1);   // 本行淡入系数
  const a=alpha*lineA;
  // 测量框宽（贴合当前行文本）
  ctx.save(); ctx.textAlign='center'; ctx.textBaseline='alphabetic';
  ctx.font='italic bold 17px Georgia,serif'; const wEn=ctx.measureText(c.en).width;
  ctx.font='bold 18px "Songti SC",serif'; const wZh=ctx.measureText(c.zh).width;
  const boxW=clamp(Math.max(wEn,wZh)+56, 260, W-140), boxH=78;
  let cx=clamp(m.headX, boxW/2+16, W-boxW/2-16);
  let boxY=clamp(m.headTopY-boxH-22, 40, H-260);   // 头顶上方
  const bx=cx-boxW/2;
  // 对白框底衬 + 细边框
  ctx.globalAlpha=alpha;
  const bg=ctx.createLinearGradient(0,boxY,0,boxY+boxH);
  bg.addColorStop(0,'rgba(6,6,10,0.90)'); bg.addColorStop(1,'rgba(6,6,10,0.80)');
  ctx.fillStyle=bg; ctx.fillRect(bx,boxY,boxW,boxH);
  ctx.strokeStyle='rgba(214,174,69,0.55)'; ctx.lineWidth=1.4; ctx.strokeRect(bx+0.5,boxY+0.5,boxW-1,boxH-1);
  // 指向人物的小三角
  ctx.fillStyle='rgba(6,6,10,0.90)'; ctx.beginPath(); ctx.moveTo(cx-8,boxY+boxH); ctx.lineTo(cx+8,boxY+boxH); ctx.lineTo(cx,boxY+boxH+11); ctx.closePath(); ctx.fill();
  // 名牌
  ctx.textAlign='left'; ctx.fillStyle='rgba(214,174,69,0.92)'; ctx.font='bold 12px "Courier New",monospace';
  ctx.fillText('哈姆雷特 · HAMLET', bx+12, boxY-8);
  // 仅当前行文本（淡入、清晰、无叠字残影）
  ctx.textAlign='center'; ctx.globalAlpha=a;
  ctx.shadowColor='rgba(0,0,0,0.82)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2;
  ctx.fillStyle='#f4d66d'; ctx.font='italic bold 17px Georgia,serif'; ctx.fillText(c.en, cx, boxY+32);
  ctx.fillStyle='#fff4e2'; ctx.font='bold 18px "Songti SC",serif'; ctx.fillText(c.zh, cx, boxY+60);
  ctx.shadowBlur=0; ctx.shadowOffsetY=0; ctx.globalAlpha=1;
  ctx.restore();
}
// 右下角固定跳过按钮（记录命中区供点击/触摸判定）
function _monoSkipButton(m){
  const w=132, h=34, x=W-w-18, y=H-h-14;
  m.skipRect={x,y,w,h};
  const pulse=0.6+0.25*Math.sin(frame*0.12);
  ctx.save();
  ctx.fillStyle='rgba(10,8,16,0.82)'; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle='rgba(214,174,69,'+pulse+')'; ctx.lineWidth=1.6; ctx.strokeRect(x,y,w,h);
  ctx.fillStyle='#f3d36a'; ctx.font='bold 14px "Courier New",monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('跳过 SKIP ▶', x+w/2, y+h/2+1);
  ctx.restore();
}
function drawPlayerWorld(){
  const p=player;
  // 无敌闪烁
  if(p.invuln>0 && (frame>>2)%2===0 && p.hurtT<=0){} else {
    if(p.ultActive>0){ ctx.save(); ctx.globalAlpha=0.5; const g=ctx.createRadialGradient(p.x+p.w/2,p.y+p.h/2,4,p.x+p.w/2,p.y+p.h/2,60); g.addColorStop(0,'rgba(232,194,90,0.6)'); g.addColorStop(1,'rgba(232,194,90,0)'); ctx.fillStyle=g; ctx.fillRect(p.x-40,p.y-30,p.w+80,p.h+60); ctx.restore(); }
    drawHamlet(p.x+p.w/2, p.y+p.h, p.facing, p.pose, actIndex);
    drawPlayerNickname(p);
  }
}
function drawPlayerNickname(p){
  return; // 已禁用头顶昵称牌
  const nickname=getPlayerNickname();
  const dlgLeft = document.getElementById('dlgLeft');
  const dlgRight = document.getElementById('dlgRight');
  const dlgShowing = (dlgLeft && dlgLeft.classList.contains('show')) ||
                     (dlgRight && dlgRight.classList.contains('show'));
  if(!nickname || dlgShowing) return;
  ctx.save();
  ctx.font='bold 12px "Courier New","Songti SC",monospace';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  const x=p.x+p.w/2, y=p.y-10;
  const textWidth=ctx.measureText(nickname).width;
  ctx.fillStyle='rgba(0,0,0,0.52)';
  ctx.fillRect(x-textWidth/2-5, y-8, textWidth+10, 16);
  ctx.strokeStyle='rgba(232,194,90,0.35)';
  ctx.strokeRect(x-textWidth/2-5, y-8, textWidth+10, 16);
  ctx.fillStyle='#f0e9d6';
  ctx.fillText(nickname, x, y+1);
  ctx.restore();
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
}
function drawWorldFloaters(){
  for(const f of floaters){
    if(f.world===false) continue;
    ctx.globalAlpha=clamp(f.life/f.max,0,1); ctx.font='bold '+f.size+'px "Courier New",serif'; ctx.textAlign='center';
    const tw=ctx.measureText(f.text).width, pad=6;
    drawTextPanel(f.x-tw/2-pad,f.y-f.size-7,tw+pad*2,f.size+10,'rgba(8,6,14,0.72)','rgba(232,194,90,0.38)');
    ctx.fillStyle=f.color; ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,0.8)'; ctx.strokeText(f.text,f.x,f.y); ctx.fillText(f.text,f.x,f.y);
  }
  ctx.globalAlpha=1; ctx.textAlign='left';
}
function drawScreenFloaters(){
  for(const f of floaters){
    if(f.world!==false) continue;
    ctx.globalAlpha=clamp(f.life/f.max,0,1); ctx.font='bold '+f.size+'px "Courier New",serif'; ctx.textAlign='center';
    const tw=ctx.measureText(f.text).width, pad=8;
    drawTextPanel(f.x-tw/2-pad,f.y-f.size-8,tw+pad*2,f.size+12,'rgba(8,6,14,0.82)','rgba(232,194,90,0.55)');
    ctx.fillStyle=f.color; ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,0.85)'; ctx.strokeText(f.text,f.x,f.y); ctx.fillText(f.text,f.x,f.y);
  }
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
  // 第四幕船舱：更昏暗压迫的暗角遮罩（明暗对比强）
  if(cabinActive){
    const g=ctx.createRadialGradient(W/2,H*0.42,H*0.18,W/2,H*0.5,H*0.95);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(0.6,'rgba(4,8,10,0.42)'); g.addColorStop(1,'rgba(2,4,6,0.86)');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }
  // 常驻交互提示（靠近舱门 / 舱内返回口时显示，离开消失）
  if(cabinPrompt){
    ctx.save(); ctx.textAlign='center'; ctx.font='bold 15px "Courier New",monospace';
    const tw=ctx.measureText(cabinPrompt).width, pad=16;
    const pulse=0.6+0.25*Math.sin(frame*0.14);
    drawTextPanel(W/2-tw/2-pad, H-78, tw+pad*2, 32, 'rgba(8,6,14,0.86)', 'rgba(255,220,150,'+pulse.toFixed(2)+')');
    ctx.fillStyle='#ffe6a0'; ctx.fillText(cabinPrompt, W/2, H-56);
    ctx.restore(); ctx.textAlign='left';
  }
}
function worldToScreen(wx,wy){ return { x:(wx-camX)*ZOOM, y:(wy-camY)*ZOOM }; }
// 最终 Boss（克劳迪奥）画面特效：电闪雷鸣 / 狂风骤雨 / 进场暗化。屏幕空间绘制，帧驱动无定时器。
function drawFinalBattleFx(){
  if(!(boss && boss.kind==='claudius' && state===STATE.PLAY && (!boss.dead || boss.deathT>0))) return;
  const now=frame;
  ctx.save();
  // ---- 进场暗化：约 2s（120 帧）从画面中央向外扩散的黑色遮罩，alpha 由高到低 ----
  if(finalBossEntryFrame>=0){
    const el=now-finalBossEntryFrame;
    if(el<120){
      const p=el/120, a=0.72*(1-p), r=W*0.14+p*W*0.78;
      const g=ctx.createRadialGradient(W/2,H/2,r*0.15,W/2,H/2,r);
      g.addColorStop(0,'rgba(0,0,0,'+a.toFixed(3)+')'); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    } else finalBossEntryFrame=-1;
  }
  const doom = !opheliaSaved;
  const ratio=clamp(boss.hp/boss.maxHp,0,1);
  const intensity=clamp((boss.phase-1)/((boss.phases-1)||1),0,1);   // 战斗激烈程度 0..1
  // ---- 顶部风暴乌云 + 全屏暗角，压迫氛围 ----
  const cloud=ctx.createLinearGradient(0,0,0,H*0.4);
  cloud.addColorStop(0, doom?'rgba(24,16,40,0.55)':'rgba(14,20,40,0.5)'); cloud.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=cloud; ctx.fillRect(0,0,W,H*0.4);
  for(let c=0;c<5;c++){ const cx=((now*0.6+c*230)%(W+300))-150, cy=H*0.06+c*14; const cg=ctx.createRadialGradient(cx,cy,6,cx,cy,120); cg.addColorStop(0, doom?'rgba(40,26,60,0.5)':'rgba(30,40,66,0.45)'); cg.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=cg; ctx.beginPath(); ctx.ellipse(cx,cy,120,44,0,0,6.283); ctx.fill(); }
  // ---- 背景远处连续背景闪（低亮度、云层内辉映；微闪频率加倍，双频叠加更躁动） ----
  const bgL=Math.max(0, Math.sin(now*0.07)*Math.sin(now*0.017)) + 0.5*Math.max(0, Math.sin(now*0.14)*Math.sin(now*0.034));
  if(bgL>0.25){ const bg=ctx.createLinearGradient(0,0,0,H*0.5); bg.addColorStop(0,(doom?'rgba(150,120,200,':'rgba(150,190,235,')+(0.10*bgL).toFixed(3)+')'); bg.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=bg; ctx.fillRect(0,0,W,H*0.5); }
  // ---- 动态全屏暗角：压迫感随战斗激烈程度（阶段/剩余血量）加深，阶段切换瞬间进一步收紧 ----
  const vigA=(doom?0.6:0.55)+intensity*0.22+(1-ratio)*0.10 + (bossRageT>0?(bossRageT/90)*0.12:0);
  const vig=ctx.createRadialGradient(W/2,H*0.5,H*0.35,W/2,H*0.5,H*0.95); vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1, (doom?'rgba(8,4,16,':'rgba(4,6,16,')+clamp(vigA,0,0.9).toFixed(3)+')'); ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);
  // ---- 暴雨三层：远景蒙雨（细、慢）/ 中景斜雨（中、倾斜）/ 近景暴雨（粗长、快）+ 地面溅水 ----
  const gust=1+0.55*Math.sin(now*0.018)+0.2*Math.sin(now*0.05);
  ctx.strokeStyle=(doom?'rgba(170,155,215,':'rgba(150,195,245,')+'0.22)'; ctx.lineWidth=1;                       // 远景蒙雨
  for(let i=0;i<70;i++){ const seed=i*61, spd=5+(i%3)*2; const x=((seed*17)%W+now*spd*0.35)%W; const y=((seed*23)%H+now*spd)%H; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+3*gust,y+9); ctx.stroke(); }
  ctx.strokeStyle=(doom?'rgba(200,185,240,':'rgba(190,220,255,')+'0.42)'; ctx.lineWidth=1.6;                     // 中景斜雨
  for(let i=0;i<64;i++){ const seed=i*97, spd=13+(i%4)*4; const x=((seed*13)%W+now*spd*0.5)%W; const y=((seed*29)%H+now*spd)%H; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+6*gust,y+20); ctx.stroke(); }
  ctx.strokeStyle=(doom?'rgba(215,205,245,':'rgba(210,235,255,')+'0.55)'; ctx.lineWidth=2.2;                     // 近景暴雨（粗长快）
  for(let i=0;i<48;i++){ const seed=i*131, spd=22+(i%4)*5; const x=((seed*13)%W+now*spd*0.6)%W; const y=((seed*37)%H+now*spd)%H; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+9*gust,y+32); ctx.stroke(); }
  ctx.strokeStyle=(doom?'rgba(225,215,250,':'rgba(225,242,255,')+'0.62)'; ctx.lineWidth=3.4;                     // 超近景贴脸暴雨（极粗、极快、拖影长）
  for(let i=0;i<26;i++){ const seed=i*173, spd=34+(i%5)*6; const x=((seed*7)%W+now*spd*0.75)%W; const y=((seed*41)%H+now*spd)%H; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+13*gust,y+46); ctx.stroke(); }
  ctx.strokeStyle=(doom?'rgba(200,185,240,':'rgba(200,225,255,')+'0.5)'; ctx.lineWidth=1;                        // 地面溅水弧线
  for(let i=0;i<14;i++){ const x=((i*137+((now*7)%400))*7)%W; const ph=(now*0.2+i)%6.283; const r=1.5+Math.abs(Math.sin(ph))*3; ctx.beginPath(); ctx.arc(x,H*0.9+Math.sin(i)*6,r,Math.PI,0); ctx.stroke(); }
  // 横掠阵风纹（全屏斜向流动）
  ctx.strokeStyle=(doom?'rgba(190,175,225,':'rgba(200,210,235,')+'0.08)'; ctx.lineWidth=2;
  for(let s=0;s<7;s++){ const yy=((now*6+s*80)%(H+120))-60; ctx.beginPath(); ctx.moveTo(-20,yy); ctx.quadraticCurveTo(W*0.5, yy-18*gust, W+20, yy-4); ctx.stroke(); }
  // ---- 电闪雷鸣：每 random(2000,5000)ms（约 120~300 帧）触发一次，每次连闪 2~3 下 ----
  if(now>=finalLightning.next){
    finalLightning.next=now+randi(120,300);
    finalLightning.flashes=randi(3,4);
    finalLightning.nextFlash=now;
  }
  if(finalLightning.flashes>0 && now>=finalLightning.nextFlash){
    finalLightning.flashes--;
    const dur=randi(6,12);                       // 每次约 0.1~0.2s
    finalLightning.nextFlash=now+dur+randi(2,6);
    finalLightning.boltUntil=now+dur; finalLightning.boltDur=dur;
    // 主干折线（顶部向下，之字形）
    const segs=[]; let x=rand(W*0.2,W*0.8), y=0; segs.push([x,y]);
    while(y<H*0.72){ y+=rand(26,52); x+=rand(-46,46); segs.push([clamp(x,0,W),y]); }
    finalLightning.segs=segs;
    // 分叉支路：从主干中段抽点向外斜插短支
    const forks=[];
    for(let k=0;k<randi(4,6);k++){
      const idx=randi(2,Math.max(2,segs.length-2)); let fx=segs[idx][0], fy=segs[idx][1];
      const dir=Math.random()<0.5?-1:1, br=[[fx,fy]], n=randi(3,5);
      for(let j=0;j<n;j++){ fy+=rand(18,34); fx+=dir*rand(10,34); br.push([clamp(fx,0,W),fy]); }
      forks.push(br);
    }
    finalLightning.forks=forks;
    if(Sound.ctx && Sound.ctx.state==='running' && Sound.enabled){ Sound.noise(0.6,0.22,0,140); Sound.blip(52,0.5,'sawtooth',0.14,0,34); }
    shake(7,12);
  }
  if(now<finalLightning.boltUntil){
    const segs=finalLightning.segs, rem=clamp((finalLightning.boltUntil-now)/(finalLightning.boltDur||6),0,1);
    const chain=(pts,w,col)=>{ if(!pts||!pts.length)return; ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); ctx.strokeStyle=col; ctx.lineWidth=w; ctx.stroke(); };
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.shadowColor = doom?'rgba(180,150,255,0.9)':'rgba(150,210,255,0.9)'; ctx.shadowBlur=18;
    chain(segs,6,doom?'rgba(200,180,255,0.5)':'rgba(190,225,255,0.5)');
    (finalLightning.forks||[]).forEach(f=>chain(f,3,doom?'rgba(200,180,255,0.45)':'rgba(190,225,255,0.45)'));
    ctx.shadowBlur=0;
    chain(segs,2.4,'#ffffff'); chain(segs,1,doom?'rgba(230,215,255,0.95)':'rgba(235,245,255,0.95)');
    (finalLightning.forks||[]).forEach(f=>chain(f,1.3,'#ffffff'));
    ctx.restore();
    // 全屏片状闪光（更亮、带路线色调，随剩余时间淡出）
    const sheet=ctx.createLinearGradient(0,0,0,H);
    sheet.addColorStop(0, doom?'rgba(210,195,255,'+(0.42*rem).toFixed(3)+')':'rgba(225,240,255,'+(0.42*rem).toFixed(3)+')');
    sheet.addColorStop(1,'rgba(255,255,255,'+(0.14*rem).toFixed(3)+')');
    ctx.fillStyle=sheet; ctx.fillRect(0,0,W,H);
  } else if(finalLightning.segs && finalLightning.segs.length && now<finalLightning.boltUntil+10){
    // ---- 闪后短暂残留电弧（淡出的细线余辉） ----
    const ea=clamp((finalLightning.boltUntil+10-now)/10,0,1)*0.4;
    ctx.save(); ctx.globalAlpha=ea; ctx.strokeStyle=doom?'rgba(200,180,255,0.9)':'rgba(190,225,255,0.9)'; ctx.lineWidth=1;
    const s=finalLightning.segs; ctx.beginPath(); ctx.moveTo(s[0][0],s[0][1]); for(let i=1;i<s.length;i++) ctx.lineTo(s[i][0],s[i][1]); ctx.stroke(); ctx.restore();
  }
  // ---- Boss 血量<30%：地面裂缝发光（确定性走向，脉动辉光） ----
  if(ratio<0.3){
    const k=clamp((0.3-ratio)/0.3,0,1), pulse=0.5+0.5*Math.sin(now*0.12);
    ctx.save(); ctx.lineCap='round'; ctx.shadowColor='rgba(255,80,20,0.9)'; ctx.shadowBlur=12*k;
    ctx.strokeStyle='rgba(255,'+((70+50*pulse)|0)+',30,'+(0.3+0.45*k*pulse).toFixed(3)+')'; ctx.lineWidth=1.5+k*2.5;
    for(let i=0;i<6;i++){ const cx=W*(0.08+i*0.17); ctx.beginPath(); ctx.moveTo(cx,H);
      for(let j=1;j<=4;j++){ const x=cx+(hnoise(i*7+j)-0.5)*54, y=H-j*20; ctx.lineTo(x,y); } ctx.stroke(); }
    ctx.restore();
  }
  // ---- 阶段切换全屏圆形冲击波（从中心向外扩散，白色→透明） ----
  for(const sw of shockwaves){
    const p=sw.t/sw.max, r=p*W*0.92, a=(1-p)*0.6;
    ctx.save(); ctx.lineCap='round';
    ctx.strokeStyle='rgba(255,255,255,'+a.toFixed(3)+')'; ctx.lineWidth=6*(1-p)+1;
    ctx.beginPath(); ctx.arc(W/2,H/2,r,0,6.283); ctx.stroke();
    ctx.strokeStyle='rgba(255,220,180,'+(a*0.55).toFixed(3)+')'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(W/2,H/2,r*0.72,0,6.283); ctx.stroke();
    ctx.restore();
  }
  // ---- 战场烟雾 / 尘埃：底部缓升的低透明烟团，营造焦土氛围 ----
  for(let i=0;i<7;i++){ const seed=i*89; const sx=((seed*11 + now*0.4)%(W+240))-120; const rise=(now*0.5+seed)%180; const sy=H*0.94-rise*0.5; const rr=40+rise*0.5+(seed%4)*10;
    const sg=ctx.createRadialGradient(sx,sy,4,sx,sy,rr); const sa=clamp(0.16*(1-rise/180),0,0.16);
    sg.addColorStop(0,(doom?'rgba(50,36,58,':'rgba(46,42,54,')+sa.toFixed(3)+')'); sg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=sg; ctx.beginPath(); ctx.ellipse(sx,sy,rr,rr*0.6,0,0,6.283); ctx.fill(); }
  // 飘浮尘埃微粒（缓慢横移的暖色微点）
  ctx.fillStyle=(doom?'rgba(200,150,120,0.28)':'rgba(190,180,160,0.26)');
  for(let i=0;i<24;i++){ const seed=i*137; const dx=((seed*7 + now*(0.6+ (seed%3)*0.3))%(W+40))-20; const dy=(seed*13 + Math.sin(now*0.02+seed)*20)%H; ctx.fillRect(dx,dy,2,2); }
  // ---- 阶段三专属：四角焰火（角落腾起的火光辉映，脉动） ----
  if(boss.phase>=3){
    const pf=0.6+0.4*Math.sin(now*0.13);
    const corners=[[0,H],[W,H],[0,H*0.62],[W,H*0.62]];
    for(let ci=0;ci<corners.length;ci++){ const cx=corners[ci][0], cy=corners[ci][1]; const rr=(120+ci*20)*pf;
      const fg=ctx.createRadialGradient(cx,cy,6,cx,cy,rr); fg.addColorStop(0,'rgba(255,150,50,'+(0.30*pf).toFixed(3)+')'); fg.addColorStop(0.5,'rgba(220,60,24,'+(0.16*pf).toFixed(3)+')'); fg.addColorStop(1,'rgba(120,10,10,0)');
      ctx.fillStyle=fg; ctx.beginPath(); ctx.arc(cx,cy,rr,0,6.283); ctx.fill();
      // 上腾火舌
      for(let f=0;f<3;f++){ const fx=cx+(ci%2===0?1:-1)*(20+f*16); const fy=cy-((now*2+f*40+ci*30)%140); const fl=6+Math.sin(now*0.2+f+ci)*3;
        const lg=ctx.createRadialGradient(fx,fy,1,fx,fy,fl+3); lg.addColorStop(0,'rgba(255,220,120,0.7)'); lg.addColorStop(1,'rgba(255,90,30,0)'); ctx.fillStyle=lg; ctx.beginPath(); ctx.arc(fx,fy,fl+3,0,6.283); ctx.fill(); }
    }
    // ---- 阶段三专属：Boss 周围缠绕的血色电弧（世界坐标转屏幕） ----
    const bs=worldToScreen(boss.x+boss.w/2, boss.y+boss.h/2);
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.shadowColor='rgba(255,40,40,0.9)'; ctx.shadowBlur=10;
    const arcR=(boss.w*ZOOM)*0.9;
    for(let k=0;k<5;k++){ const a0=(now*0.06+k*1.256)%6.283; ctx.strokeStyle='rgba(255,'+(60+k*20)+',60,'+(0.5-k*0.05).toFixed(3)+')'; ctx.lineWidth=2;
      ctx.beginPath(); let ax=bs.x+Math.cos(a0)*arcR*0.4, ay=bs.y+Math.sin(a0)*arcR*0.4; ctx.moveTo(ax,ay);
      for(let s=1;s<=5;s++){ const ang=a0+s*0.5; const rr=arcR*(0.4+s*0.12)+ (hnoise(k*7+s+ (now>>2)%17)-0.5)*14; ax=bs.x+Math.cos(ang)*rr; ay=bs.y+Math.sin(ang)*rr; ctx.lineTo(ax,ay); }
      ctx.stroke(); }
    ctx.shadowBlur=0; ctx.restore();
  }
  ctx.restore();
}
function drawPoisonSpreadOverlay(){
  const ratio=clamp(poisonT/(60*45),0,1), danger=1-ratio;
  ctx.save();
  ctx.strokeStyle='rgba(155,255,106,'+(0.18+danger*0.35)+')'; ctx.lineWidth=2;
  for(let i=0;i<7;i++){ const y=H*(0.18+i*0.11)+Math.sin(frame*0.04+i)*8; ctx.beginPath(); ctx.moveTo(0,y); for(let x=0;x<W;x+=70) ctx.lineTo(x,y+Math.sin(frame*0.06+x*0.02+i)*10); ctx.stroke(); }
  const g=ctx.createRadialGradient(W/2,H/2,H*0.2,W/2,H/2,H*0.8); g.addColorStop(0,'rgba(80,180,60,0)'); g.addColorStop(1,'rgba(80,180,60,'+(0.12+danger*0.22)+')'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(155,255,106,0.88)'; ctx.font='bold 13px "Courier New",monospace'; ctx.textAlign='center'; ctx.fillText('毒素扩散 · '+Math.ceil(poisonT/60)+'s', W/2, 118);
  ctx.restore();
}
let curSeg=-1;
function drawSegmentBanner(){
  if(!level.segments||state!==STATE.PLAY) return;
  let seg=0; for(let i=0;i<level.segments.length;i++){ if(player.x>=level.segments[i].x) seg=i; }
  if(seg!==curSeg){ curSeg=seg; segBannerT=90; }
  if(segBannerT>0){ segBannerT--; ctx.save(); ctx.globalAlpha=clamp(segBannerT/30,0,1)*0.9; drawTextPanel(12,40,190,28,'rgba(8,6,14,0.82)','rgba(232,194,90,0.48)'); ctx.fillStyle=ACTS[actIndex].accent; ctx.font='bold 16px serif'; ctx.textAlign='center'; ctx.fillText('· '+level.segments[seg].name+' ·', 107, 59); ctx.restore(); }
}
let segBannerT=0;

/* -------------------------------------------------------------------------
   28. Boss 血条 / 能量条 / 标题 / 结局场景
   ------------------------------------------------------------------------- */
function drawBossBar(){
  const bw=560, bx=(W-bw)/2, by=26;
  ctx.fillStyle='rgba(8,6,14,0.82)'; ctx.fillRect(bx-4,by-18,bw+8,34);
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
  ctx.fillStyle='rgba(8,6,14,0.78)'; ctx.fillRect(bx-2,by-2,bw+4,12);
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
  // 人物剪影：双线均为悲剧，生还线三死，溺死线哈姆雷特与克劳迪奥双死
  const gy=H-104;
  ctx.save(); ctx.translate(W/2-46, gy+10); ctx.rotate(-0.92); drawHamletOn(ctx, 0, 0, 2.2, ACT_FINAL); ctx.restore();
  ctx.save(); ctx.translate(W/2+44, gy+8); ctx.rotate(0.82);
  ctx.fillStyle= win?'#5a1420':'#4a1428'; ctx.fillRect(-16,-58,32,58); ctx.fillStyle='#e8c25a'; ctx.fillRect(-18,-64,36,6); ctx.fillStyle='#b89878'; ctx.fillRect(-10,-80,20,16); ctx.restore();
  if(win){ ctx.save(); ctx.translate(W/2, gy-2); drawOpheliaFigure('ghost', frame, false); ctx.restore(); }
  else { ctx.save(); ctx.globalAlpha=.42; ctx.translate(W/2+6, gy-20); drawOpheliaFigure('ghost', frame, false); ctx.restore(); }
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
  [dom.titleScreen,dom.storyScreen,dom.levelClearScreen,dom.winScreen,dom.loseScreen,dom.messageBoard,dom.nicknameScreen].forEach(hide);
}
function configureNicknameSetupCopy(){
  const title = dom.nicknameScreen.querySelector('h2');
  const hint = dom.nicknameScreen.querySelector('.nicknameHint');
  if(title) title.textContent='想起你的灵魂';
  if(hint) hint.textContent='把名字写进丹麦夜色。昵称会用于留言板与击杀排行。ASCII 最多 15 字符，中文/非 ASCII 最多 10 字符，混合宽度不超过 20。';
  dom.nicknameConfirmBtn.textContent='确认，我记起来了';
}
function enterTitleScreen(){
  hide(dom.nicknameScreen);
  show(dom.titleScreen);
  state=STATE.TITLE;
}
function enterNicknameSetup(forceEdit=false){
  configureNicknameSetupCopy();
  hideAllOverlays();
  hide(dom.titleScreen);
  state=STATE.NICKNAME_SETUP;
  waitForNickname(forceEdit, true).then(enterTitleScreen);
}
function initializeTitleFlow(){
  configureNicknameSetupCopy();
  hideAllOverlays();
  if(isNicknameConfirmed()) enterTitleScreen();
  else enterNicknameSetup(false);
}
async function startGame(){
  Sound.unlock();
  score=0; comboCount=0; comboTimer=0; stats={time:0,kills:0,boxes:0,secrets:0};
  opheliaSaved=true; hasBow=false; darkMode=false; opheliaWounded=false; ghostOpheliaFinale=false;
  dom.scoreVal.textContent='0';
  show(dom.hud); show(dom.scorePanel); show(dom.muteBtn); show(dom.ctrlHint); show(dom.dlgBar);
  updateDialogueBarOffset();
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
dom.messageSubmitBtn.addEventListener('click', submitMessage);
dom.messageCloseBtn.addEventListener('click', closeMessageBoard);
dom.messageInput.addEventListener('input', updateMessageMeta);
dom.nicknameEditBtn.addEventListener('click', ()=>enterNicknameSetup(true));
updateNicknameHud();
// 结局推进：点击画布 / 回车
canvas.addEventListener('click', (e)=>{
  if(state==='ending'){ endingProceed(); return; }
  // 第五幕独白：点击右下角跳过按钮
  const m=(bonusLevel && level && level.monologue) ? level.monologue : null;
  if(m && !m.done && m.skipRect){
    const r=canvas.getBoundingClientRect();
    const cx=(e.clientX-r.left)*(W/r.width), cy=(e.clientY-r.top)*(H/r.height);
    const s=m.skipRect;
    if(cx>=s.x && cx<=s.x+s.w && cy>=s.y && cy<=s.y+s.h) skipBonusMonologue();
  }
});
window.addEventListener('keydown', e=>{
  if((e.code==='Enter'||e.code==='Space') && bonusLevel && level && level.monologue && !level.monologue.done){
    skipBonusMonologue(); e.preventDefault();
  }
});
window.addEventListener('keydown', e=>{ if((e.code==='Enter'||e.code==='Space') && state==='ending'){ endingProceed(); } });
// 首次任意键解锁音频
window.addEventListener('keydown', ()=>Sound.unlock(), {once:true});
window.addEventListener('pointerdown', ()=>Sound.unlock(), {once:true});
// 持续保障：任何用户交互后确保 AudioContext 处于 running（应对切换标签页导致的再次挂起）
['click','keydown','touchstart','pointerdown'].forEach(ev=>document.addEventListener(ev, ()=>{ if(Sound.ctx && Sound.ctx.state==='suspended') Sound.ctx.resume(); }));

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

// 首帧按昵称确认状态进入两层菜单
initializeTitleFlow();
