/* =========================================================================
   HAMLET · 王子的复仇 — 横版过关小游戏
   纯前端 HTML5 Canvas + JavaScript，无外部引擎
   全部图形由代码绘制（像素/简约风）
   ========================================================================= */
'use strict';

// ---------- 画布与逻辑分辨率 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960, H = 540;
ctx.imageSmoothingEnabled = false;

// ---------- 物理常量 ----------
const GRAVITY = 0.62;
const MOVE_SPEED = 3.6;
const AIR_ACCEL = 0.5;
const FRICTION = 0.78;
const JUMP_VEL = -13.2;
const MAX_FALL = 16;

// ---------- 游戏状态 ----------
const STATE = { TITLE:'title', PLAY:'play', CLEAR:'clear', WIN:'win', LOSE:'lose' };
let state = STATE.TITLE;
let currentLevel = 0;
let camX = 0;
let frame = 0;
let kills = 0;
let levelKills = 0;
let shakeT = 0, shakeMag = 0;

// ---------- 输入 ----------
const keys = {};
const KEYMAP = {
  ArrowLeft:'left', KeyA:'left',
  ArrowRight:'right', KeyD:'right',
  ArrowUp:'jump', KeyW:'jump', Space:'jump',
  KeyJ:'atk', KeyK:'atk', KeyL:'atk'
};
window.addEventListener('keydown', e=>{
  if (KEYMAP[e.code]){ keys[KEYMAP[e.code]] = true; if(e.code==='Space'||e.code.startsWith('Arrow')) e.preventDefault(); }
});
window.addEventListener('keyup', e=>{ if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });

// 触屏控制
function bindTouch(id, key){
  const el = document.getElementById(id);
  const on = e=>{ e.preventDefault(); keys[key]=true; };
  const off = e=>{ e.preventDefault(); keys[key]=false; };
  el.addEventListener('touchstart', on, {passive:false});
  el.addEventListener('touchend', off, {passive:false});
  el.addEventListener('touchcancel', off, {passive:false});
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}
bindTouch('tLeft','left'); bindTouch('tRight','right'); bindTouch('tJump','jump'); bindTouch('tAtk','atk');
if ('ontouchstart' in window) document.getElementById('touch').style.display='block';

// ---------- 工具 ----------
function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
function clamp(v,a,b){ return v<a?a:v>b?b:v; }
function rand(a,b){ return a + Math.random()*(b-a); }
function shake(mag,t){ shakeMag=Math.max(shakeMag,mag); shakeT=Math.max(shakeT,t); }

// 浮动伤害/文字
let floaters = [];
function addFloater(x,y,text,color){ floaters.push({x,y,text,color,life:50}); }
// 粒子
let particles = [];
function burst(x,y,color,n=8,spd=3){
  for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2; particles.push({x,y,vx:Math.cos(a)*rand(1,spd),vy:Math.sin(a)*rand(1,spd)-1,life:rand(20,40),color,size:rand(2,4)}); }
}

// =========================================================================
//  关卡数据
// =========================================================================
const GROUND_Y = 480;           // 地面顶部 y
const TILE = 40;

// 主题调色板
const THEMES = {
  castle:   { sky1:'#1a2238', sky2:'#0b1020', ground:'#3a3f4d', groundTop:'#565c6e', accent:'#d4af37', deco:'torch', mood:'城堡·夜' },
  graveyard:{ sky1:'#171a26', sky2:'#05070c', ground:'#2f3324', groundTop:'#454a33', accent:'#9fb4c9', deco:'tomb',  mood:'墓地·雾' },
  lake:     { sky1:'#0e2a3a', sky2:'#04121c', ground:'#243a33', groundTop:'#365a4c', accent:'#5bc0de', deco:'reed',  mood:'湖边·月' },
  court:    { sky1:'#2a1220', sky2:'#0c0308', ground:'#3a2028', groundTop:'#5c313d', accent:'#e23b3b', deco:'banner',mood:'宫廷·血' }
};

// 地面段构造器：segments=[[startX,widthTiles],...]，其余为深坑/水
function makeGround(segments){
  return segments.map(([x,w])=>({ x:x, y:GROUND_Y, w:w, h:H-GROUND_Y, type:'ground' }));
}

const LEVELS = [
  // ---------------- 第一幕：城堡 ----------------
  {
    theme:'castle', act:'第一幕', name:'艾尔西诺城堡', sub:'鬼魂的召唤',
    label:'第一幕', width:3200, spawn:{x:60,y:380},
    quote:'先王的鬼魂显现于城墙，道出被弑真相。',
    ground: makeGround([[0,760],[840,700],[1620,900],[2620,580]]),
    platforms:[
      {x:520,y:390,w:120,h:20,type:'solid'},
      {x:1560,y:360,w:120,h:20,type:'solid'},
      {x:1400,y:300,w:110,h:20,type:'solid'},
      {x:2200,y:380,w:140,h:20,type:'solid'},
      {x:2380,y:300,w:120,h:20,type:'solid'},
    ],
    enemies:[
      {type:'guard',x:420,y:0},
      {type:'guard',x:980,y:0},
      {type:'guard',x:1300,y:0},
      {type:'guard',x:1780,y:0},
      {type:'guard',x:2000,y:0},
      {type:'guard',x:2500,y:0},
      {type:'guard',x:2900,y:0},
    ],
    goal:3060
  },
  // ---------------- 第二幕：墓地 ----------------
  {
    theme:'graveyard', act:'第二幕', name:'教堂墓地', sub:'掘墓人与骷髅',
    label:'第二幕', width:3400, spawn:{x:60,y:380},
    quote:'"生存还是毁灭" —— 哈姆雷特在墓穴间徘徊，亡魂苏醒。',
    ground: makeGround([[0,640],[720,540],[1360,520],[1980,900],[2980,420]]),
    platforms:[
      {x:640,y:380,w:100,h:20,type:'solid'},
      {x:1200,y:340,w:120,h:20,type:'solid'},
      {x:1500,y:300,w:110,h:20,type:'solid'},
      {x:1780,y:360,w:120,h:20,type:'solid'},
      {x:2300,y:360,w:130,h:20,type:'solid'},
      {x:2560,y:290,w:120,h:20,type:'solid'},
      {x:2820,y:360,w:120,h:20,type:'solid'},
    ],
    enemies:[
      {type:'skeleton',x:400,y:0},
      {type:'guard',x:800,y:0},
      {type:'skeleton',x:1250,y:0},
      {type:'skeleton',x:1550,y:0},
      {type:'skeleton',x:2050,y:0},
      {type:'guard',x:2200,y:0},
      {type:'skeleton',x:2500,y:0},
      {type:'skeleton',x:2700,y:0},
      {type:'guard',x:3050,y:0},
    ],
    goal:3260
  },
  // ---------------- 第三幕（彩蛋）：湖边 救奥菲莉亚 ----------------
  {
    theme:'lake', act:'彩蛋幕', name:'柳树湖畔', sub:'拯救奥菲莉亚',
    label:'彩蛋', width:2600, spawn:{x:60,y:380},
    isRescue:true, timeLimit:45,           // 秒
    quote:'奥菲莉亚坠入湖中！在她沉没前击退敌人、赶到她身边。',
    ground: makeGround([[0,520],[600,360],[1080,360],[1560,300],[1980,620]]),  // 段间为湖水（危险）
    platforms:[
      {x:520,y:380,w:90,h:20,type:'solid'},
      {x:1000,y:360,w:90,h:20,type:'solid'},
      {x:1480,y:360,w:90,h:20,type:'solid'},
      {x:1900,y:340,w:100,h:20,type:'solid'},
    ],
    water:true,   // 坑=水，落水即失败
    enemies:[
      {type:'guard',x:360,y:0},
      {type:'skeleton',x:760,y:0},
      {type:'skeleton',x:1200,y:0},
      {type:'guard',x:1700,y:0},
      {type:'skeleton',x:2050,y:0},
      {type:'guard',x:2260,y:0},
    ],
    rescue:{x:2420,y:GROUND_Y-70},   // 奥菲莉亚落水点
    goal:2420
  },
  // ---------------- 终幕：宫廷 Boss克劳迪奥 ----------------
  {
    theme:'court', act:'终幕', name:'王座大厅', sub:'弑君者克劳迪奥',
    label:'终幕', width:1800, spawn:{x:60,y:380},
    quote:'"毒剑与毒酒" —— 与篡位的叔父克劳迪奥做最后的了断。',
    ground: makeGround([[0,1800]]),
    platforms:[
      {x:360,y:360,w:120,h:20,type:'solid'},
      {x:760,y:320,w:120,h:20,type:'solid'},
      {x:1160,y:360,w:120,h:20,type:'solid'},
    ],
    enemies:[
      {type:'guard',x:500,y:0},
      {type:'guard',x:900,y:0},
    ],
    boss:{x:1500,y:GROUND_Y-96},
    goal:null
  }
];

// =========================================================================
//  世界 / 实体
// =========================================================================
let level;               // 当前关卡配置
let player;              // 主角
let enemies = [];        // 敌人
let projectiles = [];    // 弹射物（Boss/敌人）
let companion = null;    // 奥菲莉亚随从
let rescueObj = null;    // 待救的奥菲莉亚（彩蛋关）
let boss = null;         // Boss克劳迪奥
let timeLeft = 0;        // 彩蛋关倒计时（帧）
let goalX = null;        // 终点旗帜 x
let hasCompanion = false;// 是否已获得随从（跨关保留）

function makePlayer(spawn){
  return {
    x:spawn.x, y:spawn.y, w:28, h:40,
    vx:0, vy:0, onGround:false, facing:1,
    hp:100, maxHp:100,
    attacking:0, atkCd:0, invuln:0, dead:false,
    walkT:0
  };
}

function makeEnemy(e){
  const base = { x:e.x, y:(e.y||0), vx:0, vy:0, onGround:false, dir:-1, alive:true, hurt:0, atkCd:0, walkT:0, home:e.x };
  if (e.type==='guard')   return {...base, type:'guard',   w:30, h:42, hp:3, maxHp:3, speed:1.2, dmg:14, aggro:220};
  if (e.type==='skeleton')return {...base, type:'skeleton',w:28, h:40, hp:2, maxHp:2, speed:2.0, dmg:11, aggro:300};
  return {...base, type:'guard', w:30, h:42, hp:3, maxHp:3, speed:1.2, dmg:14, aggro:220};
}

function makeBoss(b){
  return {
    x:b.x, y:b.y, w:52, h:96, vx:0, vy:0, onGround:false, dir:-1,
    hp:60, maxHp:60, alive:true, hurt:0,
    phase:1, state:'idle', timer:90, chargeT:0, dead:false, walkT:0, invuln:0
  };
}

function makeCompanion(x,y){
  return { x:x, y:y, w:24, h:38, vx:0, vy:0, onGround:false, facing:1, hp:60, maxHp:60, atkCd:0, walkT:0, mode:'follow' };
}

// 载入关卡
function loadLevel(idx){
  level = LEVELS[idx];
  player = makePlayer(level.spawn);
  enemies = level.enemies.map(makeEnemy);
  projectiles = [];
  boss = level.boss ? makeBoss(level.boss) : null;
  goalX = level.goal;
  rescueObj = level.rescue ? {x:level.rescue.x, y:level.rescue.y, w:26, h:34, saved:false, sink:0} : null;
  timeLeft = level.timeLimit ? level.timeLimit*60 : 0;
  levelKills = 0;
  camX = 0; frame = 0;
  floaters=[]; particles=[];
  // 随从：一旦救出，后续关卡保留
  companion = hasCompanion ? makeCompanion(player.x-40, player.y) : null;
  if (companion) document.getElementById('ophRow').style.display='block';
  else document.getElementById('ophRow').style.display='none';
  updateHUD();
  showLevelName(level.act+' · '+level.name, level.sub);
}

// =========================================================================
//  碰撞：实体与地形
// =========================================================================
function solids(){ return level.ground.concat(level.platforms); }

// 逐轴移动 + 与实体碰撞解算，返回落地/撞墙信息
function moveEntity(ent){
  // 水平
  ent.x += ent.vx;
  for (const s of solids()){
    if (rectsOverlap(ent, s)){
      if (ent.vx > 0) ent.x = s.x - ent.w;
      else if (ent.vx < 0) ent.x = s.x + s.w;
      ent.vx = 0;
    }
  }
  // 垂直
  ent.vy = clamp(ent.vy + GRAVITY, -999, MAX_FALL);
  ent.y += ent.vy;
  ent.onGround = false;
  for (const s of solids()){
    if (rectsOverlap(ent, s)){
      if (ent.vy > 0){ ent.y = s.y - ent.h; ent.vy = 0; ent.onGround = true; }
      else if (ent.vy < 0){ ent.y = s.y + s.h; ent.vy = 0; }
    }
  }
  // 关卡左右边界
  ent.x = clamp(ent.x, 0, level.width - ent.w);
}

// 判断是否掉出世界（坑/水）
function fellOut(ent){ return ent.y > H + 40; }

// =========================================================================
//  更新逻辑
// =========================================================================
let prevJump = false;

function damagePlayer(dmg, fromX){
  if (player.invuln>0 || player.dead) return;
  player.hp -= dmg;
  player.invuln = 60;
  player.vx = (player.x < fromX ? -1 : 1) * -5;   // 击退
  player.vy = -5;
  shake(6,10);
  addFloater(player.x+player.w/2, player.y-6, '-'+dmg, '#ff6b6b');
  burst(player.x+player.w/2, player.y+player.h/2, '#e23b3b', 8);
  if (player.hp<=0){ player.hp=0; player.dead=true; killPlayer('"其余的，只是沉默。" 哈姆雷特倒下了。'); }
  updateHUD();
}

function killPlayer(text){
  document.getElementById('loseTitle').textContent='殒 命';
  document.getElementById('loseText').textContent = text || '哈姆雷特倒下了。';
  burst(player.x+player.w/2, player.y+player.h/2, '#e23b3b', 20, 5);
  setState(STATE.LOSE);
}

function updatePlayer(){
  if (player.dead) return;
  const acc = player.onGround ? 1 : AIR_ACCEL/MOVE_SPEED;
  if (keys.left){ player.vx -= MOVE_SPEED*acc*0.5; player.facing=-1; }
  if (keys.right){ player.vx += MOVE_SPEED*acc*0.5; player.facing=1; }
  player.vx = clamp(player.vx, -MOVE_SPEED, MOVE_SPEED);
  if (!keys.left && !keys.right && player.onGround) player.vx *= FRICTION;

  // 跳跃（边沿触发）
  if (keys.jump && !prevJump && player.onGround){ player.vy = JUMP_VEL; burst(player.x+player.w/2, player.y+player.h, '#c9d0e0', 5, 2); }
  prevJump = keys.jump;

  // 攻击
  if (player.atkCd>0) player.atkCd--;
  if (keys.atk && player.atkCd<=0){ player.attacking = 12; player.atkCd = 22; }
  if (player.attacking>0) player.attacking--;

  moveEntity(player);
  if (player.onGround && Math.abs(player.vx)>0.5) player.walkT += 0.25; else player.walkT=0;
  if (player.invuln>0) player.invuln--;

  // 掉出世界
  if (fellOut(player)){
    if (level.water) killPlayer('哈姆雷特坠入湖中，随奥菲莉亚沉没……');
    else killPlayer('哈姆雷特跌入深渊。');
  }

  // 攻击判定
  if (player.attacking>6){
    const range = 34, ah = 30;
    const ax = player.facing>0 ? player.x+player.w : player.x-range;
    const atkBox = {x:ax, y:player.y+4, w:range, h:ah};
    for (const en of enemies){
      if (en.alive && en.hurt<=0 && rectsOverlap(atkBox, en)) hitEnemy(en, 1);
    }
    if (boss && boss.alive && boss.hurt<=0 && boss.invuln<=0 && rectsOverlap(atkBox, boss)) hitBoss(1);
  }
  updateHUD();
}

function hitEnemy(en, dmg){
  en.hp -= dmg; en.hurt = 16;
  en.vx = (en.x < player.x ? -1 : 1) * 5;
  en.vy = -3;
  burst(en.x+en.w/2, en.y+en.h/2, en.type==='skeleton'?'#dfe4ef':'#c9a24a', 8);
  addFloater(en.x+en.w/2, en.y-4, '-'+dmg, '#ffd36b');
  if (en.hp<=0){
    en.alive=false; kills++; levelKills++;
    burst(en.x+en.w/2, en.y+en.h/2, '#8b1a1a', 14, 4);
    shake(3,6);
    updateHUD();
  }
}

function updateEnemies(){
  for (const en of enemies){
    if (!en.alive) continue;
    if (en.hurt>0) en.hurt--;
    const dist = (player.x+player.w/2) - (en.x+en.w/2);
    const adist = Math.abs(dist);
    // AI：靠近则追击，否则在出生点附近巡逻
    if (adist < en.aggro){
      en.dir = dist>0?1:-1;
      en.vx = en.dir * en.speed;
    } else {
      // 巡逻
      if (en.x < en.home-70) en.dir=1;
      else if (en.x > en.home+70) en.dir=-1;
      en.vx = en.dir * en.speed*0.6;
    }
    // 骷髅偶尔跳跃
    if (en.type==='skeleton' && en.onGround && adist<en.aggro && Math.random()<0.02) en.vy = -9;
    moveEntity(en);
    if (Math.abs(en.vx)>0.3) en.walkT += 0.2;
    // 掉出世界
    if (fellOut(en)){ en.alive=false; }
    // 接触伤害
    if (rectsOverlap(player, en)) damagePlayer(en.dmg, en.x+en.w/2);
  }
}

// ---------- Boss：克劳迪奥 ----------
function hitBoss(dmg){
  boss.hp -= dmg; boss.hurt = 12; boss.invuln = 10;
  burst(boss.x+boss.w/2, boss.y+30, '#e23b3b', 10);
  addFloater(boss.x+boss.w/2, boss.y-6, '-'+dmg, '#ffd36b');
  shake(4,8);
  if (boss.hp<=0){
    boss.hp=0; boss.alive=false; boss.dead=true;
    burst(boss.x+boss.w/2, boss.y+40, '#e23b3b', 30, 6);
    shake(10,30);
    winGame();
  }
  updateHUD();
}

function updateBoss(){
  if (!boss || !boss.alive) return;
  if (boss.hurt>0) boss.hurt--;
  if (boss.invuln>0) boss.invuln--;
  boss.hp <= boss.maxHp*0.5 ? boss.phase=2 : boss.phase=1;
  const dist = (player.x+player.w/2) - (boss.x+boss.w/2);
  boss.dir = dist>0?1:-1;
  boss.timer--;

  if (boss.state==='idle'){
    // 缓慢逼近
    boss.vx = boss.dir * (boss.phase===2?1.6:1.0);
    if (boss.timer<=0){
      const r = Math.random();
      if (r<0.5){ boss.state='throw'; boss.timer=28; }
      else { boss.state='charge'; boss.chargeT=0; boss.timer=(boss.phase===2?70:90); }
    }
  } else if (boss.state==='throw'){
    boss.vx=0;
    if (boss.timer===14){
      // 掷毒酒杯
      const n = boss.phase===2?2:1;
      for(let i=0;i<n;i++){
        projectiles.push({x:boss.x+boss.w/2, y:boss.y+30, vx:boss.dir*(5+i*1.5), vy:-3-i, w:16, h:16, type:'cup', from:'boss', life:180});
      }
      shake(3,6);
    }
    if (boss.timer<=0){ boss.state='idle'; boss.timer=rand(60,110); }
  } else if (boss.state==='charge'){
    // 冲锋
    boss.vx = boss.dir * (boss.phase===2?7:5.5);
    boss.chargeT++;
    if (boss.timer<=0){ boss.state='idle'; boss.timer=rand(70,120); }
  }

  moveEntity(boss);
  if (Math.abs(boss.vx)>0.5) boss.walkT += 0.15;
  // 接触伤害
  if (rectsOverlap(player, boss)) damagePlayer(boss.state==='charge'?22:16, boss.x+boss.w/2);
}

// ---------- 弹射物 ----------
function updateProjectiles(){
  for (const p of projectiles){
    p.vy += GRAVITY*0.4;
    p.x += p.vx; p.y += p.vy; p.life--;
    // 命中地形消失
    for (const s of solids()){ if (rectsOverlap(p,s)){ p.life=0; burst(p.x,p.y,'#6fbf4f',6); } }
    if (p.from==='boss' && rectsOverlap(p, player)){ p.life=0; damagePlayer(14, p.x); burst(p.x,p.y,'#6fbf4f',8); }
  }
  projectiles = projectiles.filter(p=>p.life>0 && p.y<H+60 && p.x>-40 && p.x<level.width+40);
}

// ---------- 随从：奥菲莉亚 ----------
function updateCompanion(){
  if (!companion) return;
  const c = companion;
  if (c.hp<=0){ c.mode='down'; }
  // 跟随
  const targetX = player.x - (player.facing>0? 46 : -46);
  const dx = targetX - c.x;
  if (Math.abs(dx) > 8){ c.vx = clamp(dx*0.12, -3.4, 3.4); c.facing = dx>0?1:-1; }
  else c.vx *= 0.6;
  // 玩家跳，随从也追高（简易）
  if (c.onGround && (player.y < c.y-30) && Math.abs(dx)<80) c.vy = JUMP_VEL*0.9;
  moveEntity(c);
  if (Math.abs(c.vx)>0.4) c.walkT += 0.2;
  if (fellOut(c)){ c.x = player.x-40; c.y = player.y-60; c.vy=0; }  // 传送回主角身边

  if (c.mode==='down') return;
  // 辅助攻击：攻击最近的敌人/Boss
  if (c.atkCd>0) c.atkCd--;
  if (c.atkCd<=0){
    let best=null, bd=140;
    for (const en of enemies){ if(en.alive){ const d=Math.abs(en.x-c.x); if(d<bd){bd=d;best=en;} } }
    if (best && best.hurt<=0){ c.atkCd=40; c.facing = best.x>c.x?1:-1; hitEnemy(best,1); addFloater(c.x+c.w/2,c.y-4,'助攻!','#5bc0de'); }
    else if (boss && boss.alive && Math.abs(boss.x-c.x)<160 && boss.hurt<=0){ c.atkCd=50; hitBoss(1); addFloater(c.x+c.w/2,c.y-4,'助攻!','#5bc0de'); }
  }
  // 随从被敌人接触受伤
  for (const en of enemies){ if(en.alive && rectsOverlap(c,en) && c.hurt<=0){ c.hp-=8; c.hurt=40; burst(c.x+c.w/2,c.y+10,'#5bc0de',6);} }
  if (c.hurt>0) c.hurt--;
  updateHUD();
}

// ---------- 彩蛋关：拯救奥菲莉亚 ----------
function updateRescue(){
  if (!rescueObj) return;
  const r = rescueObj;
  r.sink += 0.15;   // 缓缓下沉动画
  // 倒计时
  if (!r.saved){
    timeLeft--;
    if (timeLeft<=0){
      killPlayer('时间耗尽 —— 奥菲莉亚沉入湖底，随水流去。');
      return;
    }
  }
  // 玩家到达 => 获救
  if (!r.saved && Math.abs((player.x+player.w/2)-(r.x)) < 46 && Math.abs(player.y-r.y)<80){
    r.saved = true;
    hasCompanion = true;
    companion = makeCompanion(player.x-30, player.y);
    document.getElementById('ophRow').style.display='block';
    burst(r.x, r.y, '#5bc0de', 24, 5);
    addFloater(r.x, r.y-20, '获救！奥菲莉亚加入', '#5bc0de');
    shake(5,12);
    setTimeout(()=>{ if(state===STATE.PLAY) levelComplete(); }, 900);
  }
  updateHUD();
}

// =========================================================================
//  流程控制 / HUD
// =========================================================================
function setState(s){
  state = s;
  document.getElementById('hud').classList.toggle('hidden', s!==STATE.PLAY);
  document.getElementById('titleScreen').classList.toggle('hidden', s!==STATE.TITLE);
  document.getElementById('levelClearScreen').classList.toggle('hidden', s!==STATE.CLEAR);
  document.getElementById('winScreen').classList.toggle('hidden', s!==STATE.WIN);
  document.getElementById('loseScreen').classList.toggle('hidden', s!==STATE.LOSE);
}

function showLevelName(main, sub){
  const el = document.getElementById('levelName');
  el.innerHTML = main + '<small>'+sub+'</small>';
  el.classList.add('fade');
  setTimeout(()=>el.classList.remove('fade'), 1900);
}

function updateHUD(){
  document.getElementById('playerHp').style.width = (player.hp/player.maxHp*100)+'%';
  document.getElementById('levelLabel').textContent = level.act+' · '+level.name;
  document.getElementById('scoreLabel').textContent = '击败 '+kills;
  if (companion){
    document.getElementById('ophHp').style.width = Math.max(0,companion.hp/companion.maxHp*100)+'%';
  }
  const tr = document.getElementById('timerRow');
  if (level.isRescue && rescueObj && !rescueObj.saved){
    tr.style.display='block';
    document.getElementById('timer').textContent = Math.ceil(timeLeft/60);
  } else tr.style.display='none';
}

function levelComplete(){
  if (currentLevel >= LEVELS.length-1){ winGame(); return; }
  const next = LEVELS[currentLevel+1];
  document.getElementById('clearText').textContent = '下一幕：'+next.act+' · '+next.name+'（'+next.sub+'）';
  setState(STATE.CLEAR);
}

function winGame(){
  document.getElementById('winQuote').textContent = level.name==='王座大厅'
    ? '克劳迪奥伏诛，先王沉冤得雪。哈姆雷特与获救的奥菲莉亚并肩而立 —— 这一次，故事有了不同的结局。'
    : '复仇已成，奥菲莉亚获救。';
  setState(STATE.WIN);
}

function nextLevel(){ currentLevel++; loadLevel(currentLevel); setState(STATE.PLAY); }

function startGame(){ currentLevel=0; kills=0; hasCompanion=false; loadLevel(0); setState(STATE.PLAY); }

function restartLevel(){ loadLevel(currentLevel); setState(STATE.PLAY); }

// 相机
function updateCamera(){
  const target = player.x + player.w/2 - W/2;
  camX = clamp(target, 0, Math.max(0, level.width - W));
}

// 终点旗帜检测
function checkGoal(){
  if (goalX==null) return;
  if (player.x+player.w/2 >= goalX){ levelComplete(); }
}

// 浮动文字/粒子
function updateFX(){
  for (const f of floaters){ f.y -= 0.6; f.life--; }
  floaters = floaters.filter(f=>f.life>0);
  for (const p of particles){ p.vy += 0.18; p.x+=p.vx; p.y+=p.vy; p.life--; }
  particles = particles.filter(p=>p.life>0);
  if (shakeT>0){ shakeT--; if(shakeT<=0) shakeMag=0; }
}

// =========================================================================
//  主更新
// =========================================================================
function update(){
  frame++;
  if (state!==STATE.PLAY) return;
  updatePlayer();
  if (state!==STATE.PLAY) return;   // 玩家可能已死亡
  updateEnemies();
  updateBoss();
  updateProjectiles();
  updateCompanion();
  if (level.isRescue) updateRescue();
  else checkGoal();
  updateCamera();
  updateFX();
}

// =========================================================================
//  渲染
// =========================================================================
function px(x){ return Math.round(x - camX + (shakeT>0?rand(-shakeMag,shakeMag):0)); }
function py(y){ return Math.round(y + (shakeT>0?rand(-shakeMag,shakeMag):0)); }
function box(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(px(x),py(y),Math.ceil(w),Math.ceil(h)); }

function drawBackground(){
  const t = THEMES[level.theme];
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,t.sky1); g.addColorStop(1,t.sky2);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // 月亮
  ctx.save();
  ctx.globalAlpha=0.9;
  ctx.fillStyle = level.theme==='court' ? '#e2b04b' : '#e8ecf5';
  const moonX = 760 - camX*0.15, moonY=90;
  ctx.beginPath(); ctx.arc(moonX,moonY,38,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=t.sky1; ctx.globalAlpha=0.5;
  ctx.beginPath(); ctx.arc(moonX+14,moonY-6,32,0,Math.PI*2); ctx.fill();
  ctx.restore();

  // 远景城墙/山（视差）
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for(let i=0;i<40;i++){
    const bx = (i*220 - camX*0.3);
    if (level.theme==='castle' || level.theme==='court'){
      ctx.fillRect(((bx%(W+220))+W+220)%(W+220)-110, 200, 90, 300);
    }
  }
  // 星星
  if (level.theme!=='court'){
    ctx.fillStyle='rgba(255,255,255,0.5)';
    for(let i=0;i<50;i++){ const sx=((i*137 - camX*0.1)%W+W)%W; const sy=(i*53)%180; ctx.fillRect(sx,sy,2,2); }
  }
}

function drawTerrain(){
  const t = THEMES[level.theme];
  // 地面段
  for (const s of level.ground){
    box(s.x, s.y, s.w, s.h, t.ground);
    box(s.x, s.y, s.w, 8, t.groundTop);
    // 纹理
    ctx.fillStyle='rgba(0,0,0,0.18)';
    for(let gx=s.x; gx<s.x+s.w; gx+=40){ ctx.fillRect(px(gx),py(s.y+8),2,s.h-8); }
  }
  // 悬浮平台
  for (const p of level.platforms){
    box(p.x, p.y, p.w, p.h, t.groundTop);
    box(p.x, p.y+p.h, p.w, 4, 'rgba(0,0,0,0.3)');
  }
  // 湖水（彩蛋关：坑填充水）
  if (level.water){
    for (let i=0;i<level.ground.length-1;i++){
      const a=level.ground[i], b=level.ground[i+1];
      const wx=a.x+a.w, ww=b.x-(a.x+a.w);
      const wy=GROUND_Y+14;
      ctx.fillStyle='rgba(60,150,190,0.55)';
      ctx.fillRect(px(wx),py(wy),ww,H-wy);
      // 波纹
      ctx.fillStyle='rgba(200,235,255,0.35)';
      for(let wxx=wx; wxx<wx+ww; wxx+=24){ ctx.fillRect(px(wxx+((frame/6)%24)),py(wy+2+Math.sin((wxx+frame)/20)*2),12,2); }
    }
    // 结尾湖面
    const last=level.ground[level.ground.length-1];
    const ex=last.x+last.w;
    ctx.fillStyle='rgba(60,150,190,0.55)';
    ctx.fillRect(px(ex),py(GROUND_Y+14),level.width-ex+200,H);
  }
  drawDecor();
}

function drawDecor(){
  const t = THEMES[level.theme];
  if (t.deco==='torch'){
    for(let x=180;x<level.width;x+=360){
      box(x,300,8,60,'#4a3320');
      const fy=298+Math.sin((frame+x)/6)*3;
      box(x-4,fy-14,16,16,'#ff9b2e'); box(x-2,fy-22,12,12,'#ffd36b');
    }
  } else if (t.deco==='tomb'){
    for(let x=140;x<level.width;x+=250){
      const th=rand(40,70);
      box(x,GROUND_Y-th,26,th,'#5a5f52'); box(x-4,GROUND_Y-th,34,10,'#6d7364');
      ctx.fillStyle='#3a3f33'; ctx.fillRect(px(x+6),py(GROUND_Y-th+14),14,4); ctx.fillRect(px(x+11),py(GROUND_Y-th+10),4,14);
    }
    // 枯树
    for(let x=320;x<level.width;x+=520){ box(x,GROUND_Y-120,14,120,'#2a2418'); box(x-30,GROUND_Y-120,40,10,'#2a2418'); box(x+14,GROUND_Y-110,36,10,'#2a2418'); }
  } else if (t.deco==='reed'){
    for(let x=60;x<level.width;x+=70){
      const sway=Math.sin((frame+x)/24)*4;
      ctx.strokeStyle='#3f6b4a'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(px(x),py(GROUND_Y)); ctx.lineTo(px(x+sway),py(GROUND_Y-46)); ctx.stroke();
    }
    // 柳树
    box(200,GROUND_Y-160,20,160,'#3a2f1e');
    ctx.strokeStyle='rgba(90,150,90,0.6)'; ctx.lineWidth=2;
    for(let i=0;i<14;i++){ const bx=140+i*12; ctx.beginPath(); ctx.moveTo(px(bx),py(GROUND_Y-160)); ctx.lineTo(px(bx+Math.sin((frame+i*30)/30)*6),py(GROUND_Y-60)); ctx.stroke(); }
  } else if (t.deco==='banner'){
    // 红毯
    ctx.fillStyle='#7a1420'; ctx.fillRect(px(0),py(GROUND_Y-2),level.width,6);
    for(let x=120;x<level.width;x+=300){
      box(x,120,10,200,'#3a2028');
      box(x-18,140,46,90,'#8b1a1a'); box(x-14,150,38,4,'#d4af37');
      // 家徽
      ctx.fillStyle='#d4af37'; ctx.beginPath(); ctx.arc(px(x+5),py(180),10,0,Math.PI*2); ctx.fill();
    }
    // 王座
    box(1640,GROUND_Y-120,80,120,'#5c313d'); box(1630,GROUND_Y-150,100,40,'#6d3a48');
    box(1660,GROUND_Y-176,40,30,'#d4af37');  // 椅背金饰
  }
}

function drawGoal(){
  if (goalX==null) return;
  const gy=GROUND_Y;
  box(goalX,gy-140,6,140,'#cfd6e4');
  const wave=Math.sin(frame/10)*4;
  ctx.fillStyle = level.theme==='court'?'#e23b3b':'#d4af37';
  ctx.beginPath();
  ctx.moveTo(px(goalX+6),py(gy-138));
  ctx.lineTo(px(goalX+52+wave),py(gy-126));
  ctx.lineTo(px(goalX+6),py(gy-112));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle='#1a1206'; ctx.font='bold 14px monospace'; ctx.textAlign='center';
  ctx.fillText('♛', px(goalX+26), py(gy-122));
}

// ---------- 角色绘制 ----------
function drawPlayer(){
  const p=player;
  if (p.invuln>0 && Math.floor(frame/4)%2===0 && !p.dead) return; // 受伤闪烁
  const x=p.x, y=p.y, f=p.facing;
  const bob = p.onGround ? Math.sin(p.walkT)*2 : 0;
  // 腿
  ctx.save();
  const legSwing = Math.sin(p.walkT)*6;
  box(x+4, y+28, 8, 12+ (p.onGround?legSwing*0+0:0), '#2b2f3a');
  box(x+16, y+28, 8, 12, '#2b2f3a');
  if (p.onGround && Math.abs(p.vx)>0.5){ box(x+4,y+28,8,12+legSwing,'#2b2f3a'); box(x+16,y+28,8,12-legSwing,'#2b2f3a'); }
  // 躯干（黑色紧身衣 + 金腰带）
  box(x+3, y+12-bob, 22, 18, '#1f2430');
  box(x+3, y+22-bob, 22, 3, '#d4af37');
  box(x+3, y+12-bob, 22, 4, '#2e3547');
  // 披风
  ctx.fillStyle='#5a1020';
  ctx.beginPath();
  ctx.moveTo(px(x + (f>0?3:22)), py(y+12-bob));
  ctx.lineTo(px(x + (f>0?-8:33)), py(y+34));
  ctx.lineTo(px(x + (f>0?8:17)), py(y+30-bob));
  ctx.closePath(); ctx.fill();
  // 头
  box(x+7, y-2-bob, 16, 16, '#e6c9a8');   // 脸
  box(x+6, y-6-bob, 18, 7, '#3a2a1a');    // 头发
  // 眼睛（朝向）
  ctx.fillStyle='#1a1a1a';
  ctx.fillRect(px(x+(f>0?16:9)), py(y+3-bob), 3,3);
  // 剑（rapier）
  ctx.strokeStyle='#dfe4ef'; ctx.lineWidth=3;
  ctx.beginPath();
  if (p.attacking>0){
    const ex = f>0 ? x+p.w+30 : x-30;
    ctx.moveTo(px(x+p.w/2), py(y+18-bob));
    ctx.lineTo(px(ex), py(y+14));
    // 挥砍弧光
    ctx.strokeStyle='rgba(220,230,255,0.5)'; ctx.lineWidth=6;
    ctx.beginPath(); ctx.arc(px(x+p.w/2), py(y+18), 30, f>0?-0.6:Math.PI-0.6, f>0?0.6:Math.PI+0.6); ctx.stroke();
    ctx.strokeStyle='#dfe4ef'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(px(x+p.w/2), py(y+18-bob)); ctx.lineTo(px(ex), py(y+14));
  } else {
    ctx.moveTo(px(x+(f>0?p.w-2:2)), py(y+18-bob));
    ctx.lineTo(px(x+(f>0?p.w+14:-14)), py(y+6-bob));
  }
  ctx.stroke();
  // 剑柄护手
  box(x+(f>0?p.w-4:0), y+16-bob, 4,6,'#d4af37');
}

function drawGuard(en){
  if (!en.alive) return;
  const x=en.x, y=en.y, hurt=en.hurt>0 && Math.floor(frame/2)%2===0;
  const c = hurt?'#ffffff':'#6d3a2a';
  const legSwing=Math.sin(en.walkT)*5;
  box(x+4,y+28,8,12+legSwing,'#3a2a24'); box(x+16,y+28,8,12-legSwing,'#3a2a24');
  box(x+3,y+12,24,18, hurt?'#fff':'#7a4030');   // 铠甲
  box(x+3,y+12,24,4, hurt?'#fff':'#93513c');
  box(x+8,y-2,16,16, hurt?'#fff':'#c9a48f');     // 脸
  box(x+6,y-8,20,8, hurt?'#fff':'#8a8f9c');      // 头盔
  box(x+6,y-2,20,3,'#8a8f9c');                   // 盔沿
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(en.dir>0?18:9)),py(y+3),3,3);
  // 长矛
  ctx.strokeStyle='#7a5a3a'; ctx.lineWidth=3;
  ctx.beginPath(); const sx=en.dir>0?x+en.w:x; ctx.moveTo(px(sx),py(y-6)); ctx.lineTo(px(sx+en.dir*10),py(y+34)); ctx.stroke();
  box(sx+en.dir*10-2,y-12,4,10, hurt?'#fff':'#cfd6e4');
  drawMiniHP(en);
}

function drawSkeleton(en){
  if (!en.alive) return;
  const x=en.x,y=en.y, hurt=en.hurt>0 && Math.floor(frame/2)%2===0;
  const c=hurt?'#ffffff':'#e6e9f0';
  const legSwing=Math.sin(en.walkT)*5;
  box(x+5,y+28,6,12+legSwing,c); box(x+17,y+28,6,12-legSwing,c);
  // 肋骨
  box(x+6,y+12,16,16,c);
  ctx.fillStyle=hurt?'#ccc':'#8a8f9c'; for(let i=0;i<3;i++) ctx.fillRect(px(x+7),py(y+15+i*4),14,2);
  box(x+7,y-4,14,14,c);   // 头骨
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(en.dir>0?15:9)),py(y+1),3,4); ctx.fillRect(px(x+(en.dir>0?10:14)),py(y+1),3,4);
  ctx.fillRect(px(x+12),py(y+7),4,3);
  // 生锈弯刀
  ctx.strokeStyle=hurt?'#fff':'#9a8a5a'; ctx.lineWidth=3;
  ctx.beginPath(); const sx=en.dir>0?x+en.w:x; ctx.moveTo(px(sx),py(y+14)); ctx.lineTo(px(sx+en.dir*16),py(y+4)); ctx.stroke();
  drawMiniHP(en);
}

function drawMiniHP(en){
  if (en.hp>=en.maxHp) return;
  const w=en.w, ratio=Math.max(0,en.hp/en.maxHp);
  box(en.x, en.y-10, w, 4, '#000');
  box(en.x+1, en.y-9, (w-2)*ratio, 2, '#7ad67a');
}

function drawBoss(){
  if (!boss || !boss.alive) return;
  const b=boss, x=b.x, y=b.y, hurt=b.hurt>0 && Math.floor(frame/2)%2===0;
  const robe = hurt?'#ffffff':(b.phase===2?'#7a0f1a':'#8b1a1a');
  // 阴影/披风
  ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(px(x-6),py(y+10),b.w+12,b.h-10);
  // 长袍
  box(x, y+26, b.w, b.h-26, robe);
  box(x, y+26, b.w, 6, hurt?'#fff':'#a82530');
  // 金饰纹
  ctx.fillStyle='#d4af37'; for(let i=0;i<3;i++) ctx.fillRect(px(x+8),py(y+40+i*16),b.w-16,3);
  // 头 & 脸
  box(x+12, y+2, 28, 26, hurt?'#fff':'#c9a48f');
  box(x+12, y+18, 28, 10, hurt?'#eee':'#5a4030'); // 胡须
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(b.dir>0?30:16)),py(y+10),4,4);
  // 王冠
  box(x+10, y-8, 32, 12, '#d4af37');
  ctx.fillStyle='#d4af37';
  ctx.beginPath();
  for(let i=0;i<4;i++){ const cx=x+12+i*8; ctx.moveTo(px(cx),py(y-8)); ctx.lineTo(px(cx+4),py(y-16)); ctx.lineTo(px(cx+8),py(y-8)); }
  ctx.fill();
  ctx.fillStyle='#e23b3b'; ctx.fillRect(px(x+24),py(y-6),4,4);
  // 毒剑
  ctx.strokeStyle=hurt?'#fff':'#b9c0d0'; ctx.lineWidth=4;
  const sx=b.dir>0?x+b.w:x;
  ctx.beginPath(); ctx.moveTo(px(sx),py(y+40)); ctx.lineTo(px(sx+b.dir*30),py(y+20)); ctx.stroke();
  if (b.state==='charge'){ ctx.strokeStyle='rgba(226,59,59,0.5)'; ctx.lineWidth=8; ctx.beginPath(); ctx.moveTo(px(sx),py(y+40)); ctx.lineTo(px(sx+b.dir*40),py(y+16)); ctx.stroke(); }
  // Boss 血条（顶部）
  drawBossBar();
}

function drawBossBar(){
  const bw=W*0.6, bx=W*0.2, by=42;
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(bx-3,by-3,bw+6,20);
  ctx.fillStyle='#3a0d0d'; ctx.fillRect(bx,by,bw,14);
  ctx.fillStyle='#e23b3b'; ctx.fillRect(bx,by,bw*Math.max(0,boss.hp/boss.maxHp),14);
  ctx.fillStyle='#d4af37'; ctx.font='bold 13px monospace'; ctx.textAlign='center';
  ctx.fillText('克 劳 迪 奥  CLAUDIUS', W/2, by-8);
}

function drawCompanion(){
  if (!companion) return;
  const c=companion, x=c.x,y=c.y, down=c.mode==='down';
  const hurt=c.hurt>0 && Math.floor(frame/2)%2===0;
  if (down){ ctx.globalAlpha=0.4; }
  const legSwing=Math.sin(c.walkT)*4;
  box(x+5,y+26,5,12+legSwing,'#c9d0e0'); box(x+14,y+26,5,12-legSwing,'#c9d0e0');
  // 裙（蓝白）
  ctx.fillStyle=hurt?'#fff':'#5bc0de';
  ctx.beginPath(); ctx.moveTo(px(x+2),py(y+30)); ctx.lineTo(px(x+8),py(y+12)); ctx.lineTo(px(x+16),py(y+12)); ctx.lineTo(px(x+22),py(y+30)); ctx.closePath(); ctx.fill();
  box(x+7,y+10,10,10,hurt?'#fff':'#eaf3f8');  // 上身
  box(x+6,y-4,12,14,'#e6c9a8');   // 脸
  box(x+5,y-8,14,8,'#caa24a');    // 金发
  // 花环
  ctx.fillStyle='#ff9bd0'; ctx.fillRect(px(x+6),py(y-9),3,3); ctx.fillRect(px(x+12),py(y-9),3,3);
  ctx.fillStyle='#1a1a1a'; ctx.fillRect(px(x+(c.facing>0?12:8)),py(y+1),2,2);
  ctx.globalAlpha=1;
  if (c.hp<c.maxHp && !down) drawMiniHP({x:c.x,y:c.y,w:c.w,hp:c.hp,maxHp:c.maxHp});
}

function drawRescue(){
  if (!rescueObj || rescueObj.saved) return;
  const r=rescueObj;
  const bob=Math.sin(r.sink*0.6)*4;
  const sinkY = r.y + Math.min(30, r.sink*0.6);  // 逐渐下沉
  // 求救的奥菲莉亚（半沉水中）
  box(r.x-8, sinkY+bob, 16, 16, '#5bc0de');   // 露出的身体
  box(r.x-6, sinkY-8+bob, 12, 12, '#e6c9a8'); // 脸
  box(r.x-7, sinkY-12+bob, 14, 6, '#caa24a'); // 头发
  // 举起的手
  ctx.strokeStyle='#e6c9a8'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(px(r.x+4),py(sinkY+bob)); ctx.lineTo(px(r.x+10),py(sinkY-14+bob)); ctx.stroke();
  // 漂浮的花
  ctx.fillStyle='#ff9bd0';
  for(let i=0;i<4;i++){ ctx.fillRect(px(r.x-30+i*18+Math.sin((frame+i*40)/20)*4),py(GROUND_Y+22+Math.sin((frame+i*30)/16)*2),4,4); }
  // 涟漪
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2;
  const rr=(frame%60)/60*30;
  ctx.beginPath(); ctx.ellipse(px(r.x),py(sinkY+18),rr,rr*0.3,0,0,Math.PI*2); ctx.stroke();
  // 呼救文字
  ctx.fillStyle='#fff'; ctx.font='bold 12px monospace'; ctx.textAlign='center';
  if (Math.floor(frame/30)%2===0) ctx.fillText('救我！', px(r.x), py(sinkY-24+bob));
}

function drawProjectiles(){
  for (const p of projectiles){
    // 毒酒杯
    box(p.x-6,p.y-6,12,10,'#d4af37');
    ctx.fillStyle='#6fbf4f'; ctx.fillRect(px(p.x-4),py(p.y-4),8,4);
    ctx.fillStyle='rgba(111,191,79,0.6)'; ctx.beginPath(); ctx.arc(px(p.x),py(p.y-8),3,0,Math.PI*2); ctx.fill();
  }
}

function drawFX(){
  for (const p of particles){ ctx.globalAlpha=Math.max(0,p.life/40); box(p.x,p.y,p.size,p.size,p.color); }
  ctx.globalAlpha=1;
  ctx.font='bold 14px monospace'; ctx.textAlign='center';
  for (const f of floaters){ ctx.globalAlpha=Math.max(0,f.life/50); ctx.fillStyle=f.color; ctx.fillText(f.text, px(f.x), py(f.y)); }
  ctx.globalAlpha=1;
}

function render(){
  drawBackground();
  drawTerrain();
  drawGoal();
  if (rescueObj) drawRescue();
  drawProjectiles();
  for (const en of enemies){ if(en.type==='skeleton') drawSkeleton(en); else drawGuard(en); }
  drawBoss();
  drawCompanion();
  drawPlayer();
  drawFX();

  // 彩蛋关低时间红色警示
  if (level.isRescue && rescueObj && !rescueObj.saved && timeLeft/60 < 10){
    ctx.fillStyle='rgba(226,59,59,'+(0.12+Math.abs(Math.sin(frame/8))*0.1)+')';
    ctx.fillRect(0,0,W,H);
  }
}

// =========================================================================
//  主循环
// =========================================================================
function loop(){
  update();
  render();
  requestAnimationFrame(loop);
}

// 按钮
document.getElementById('startBtn').onclick = startGame;
document.getElementById('nextBtn').onclick = nextLevel;
document.getElementById('restartBtn').onclick = restartLevel;
document.getElementById('restartWinBtn').onclick = startGame;

// 初始预载首关以便标题背景（不进入 PLAY）
loadLevel(0);
setState(STATE.TITLE);
loop();
