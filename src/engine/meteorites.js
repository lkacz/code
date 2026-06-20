import { CHUNK_W, T, INFO, WORLD_H } from '../constants.js';

const meteorites = (function(){
  const MM = window.MM = window.MM || {};
  const STORE_KEY = 'mm_meteorites_v1';
  const DAY_SECONDS = 600;
  const MIN_WAIT_DAYS = 7;
  const MAX_WAIT_DAYS = 10;
  const MIN_WAIT = DAY_SECONDS * MIN_WAIT_DAYS;
  const MAX_WAIT = DAY_SECONDS * MAX_WAIT_DAYS;
  const MAX_METEORS = 2;
  const MAX_EMBERS = 140;
  const MAX_DEBRIS = 60;
  const MAX_PLUMES = 34;
  const MAX_BEACON_WAVES = 8;
  const MAX_GRAVITY_BURSTS = 6;
  const GRAVITY = 7.5;
  const BEACON_SCAN_RADIUS = 44;
  const BEACON_FIELD_RADIUS = 34;
  const BEACON_DEFLECT_RADIUS = 18;
  const BEACON_HARD_DEFLECT_RADIUS = 10;
  const BEACON_SCAN_INTERVAL = 0.12;
  const BEACON_BOUNCE_MIN_DISTANCE = 60;
  const BEACON_BOUNCE_MAX_DISTANCE = 96;
  const BEACON_BOUNCE_CLEARANCE = 48;
  const MAX_BEACON_DEFLECTIONS_PER_METEOR = 4;
  const BASE_TERRAIN_BUDGET = 8;
  const STRESSED_TERRAIN_BUDGET = 4;

  const meteors = [];
  const terrainJobs = [];
  const embers = [];
  const debris = [];
  const plumes = [];
  const shockwaves = [];
  const scorches = [];
  const beaconWaves = [];
  const gravityBursts = [];
  const plumeSprites = new Map();
  let enabled = false;
  let nextIn = 0;
  let spawned = 0;
  let impacts = 0;
  let deflections = 0;
  let lastDeflection = null;
  let screenFlash = 0;
  let lastImpact = null;
  let shakeT = 0;
  let shakeMax = 0;
  let shakeAmp = 0;
  let shakeSeed = 0;

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
  function rand(a,b){ return a + Math.random()*(b-a); }
  function frameMs(){
    return (typeof window !== 'undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
  }
  function rollNext(){ nextIn = rand(MIN_WAIT, MAX_WAIT); }
  function loadedNextIn(data){
    if(!data || !Number.isFinite(data.nextIn) || !(data.nextIn>0)) return 0;
    const raw=+data.nextIn;
    if((data.v|0)>=2) return clamp(raw, 1, MAX_WAIT);
    return raw>=MIN_WAIT ? clamp(raw, MIN_WAIT, MAX_WAIT) : 0;
  }
  function saveSettings(){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify({v:2,enabled,nextIn:Math.round(nextIn)})); }catch(e){}
  }
  function loadSettings(){
    try{
      const raw=localStorage.getItem(STORE_KEY);
      if(!raw) return;
      const d=JSON.parse(raw);
      if(!d || typeof d!=='object') return;
      enabled = d.enabled === true;
      nextIn = loadedNextIn(d);
    }catch(e){}
  }
  loadSettings();
  if(!(nextIn>0)) rollNext();

  function tileInfo(t){ return INFO[t] || INFO[T.AIR]; }
  function isGas(t){ return !!(tileInfo(t) && tileInfo(t).gas); }
  function meteorGroundTile(t){
    return t===T.GRASS || t===T.SAND || t===T.STONE || t===T.SNOW ||
      t===T.ICE || t===T.MUD || t===T.OBSIDIAN || t===T.COAL ||
      t===T.DIAMOND || t===T.IRIDIUM || t===T.METEORIC_IRON ||
      t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE;
  }
  function protectedTile(t){
    return t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC ||
      t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE ||
      t===T.ANTIGRAVITY_BEACON;
  }
  function meteorShattersTile(t){
    if(t===T.AIR || t===T.WATER || t===T.LAVA || isGas(t)) return false;
    if(protectedTile(t) || meteorGroundTile(t)) return false;
    return true;
  }
  function hotTileForFloor(old,edge,central){
    if(central) return T.LAVA;
    if(old===T.SAND) return T.GLASS;
    if(edge<0.46) return Math.random()<0.72 ? T.OBSIDIAN : T.METEORIC_IRON;
    if(old===T.STONE || old===T.COAL || old===T.STEEL || old===T.METEORIC_IRON || old===T.OBSIDIAN) return Math.random()<0.90 ? T.OBSIDIAN : T.STONE;
    return Math.random()<0.82 ? T.OBSIDIAN : T.STONE;
  }
  function meteorCoreTile(){
    const r=Math.random();
    if(r<0.13) return T.IRIDIUM;
    if(r<0.52) return T.METEORIC_IRON;
    if(r<0.76) return T.COAL;
    return T.OBSIDIAN;
  }
  function readTile(getTile,x,y){
    if(typeof getTile!=='function') return T.AIR;
    try{ return getTile(x,y); }catch(e){ return T.AIR; }
  }
  function beaconKey(b){
    if(!b) return '';
    const x=Number.isFinite(b.tx) ? b.tx : Math.floor(b.x);
    const y=Number.isFinite(b.ty) ? b.ty : Math.floor(b.y);
    return x+','+y;
  }
  function nearestBeacon(cx,cy,getTile,radius,opts){
    if(typeof getTile!=='function' || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    opts=opts||{};
    const excluded=opts.exclude ? new Set(opts.exclude) : null;
    const r=clamp(Number(radius)||BEACON_SCAN_RADIUS,1,BEACON_SCAN_RADIUS);
    const minX=Math.floor(cx-r);
    const maxX=Math.ceil(cx+r);
    const minY=Math.max(1,Math.floor(cy-r));
    const maxY=Math.min(WORLD_H-4,Math.ceil(cy+r));
    let best=null;
    let bestD2=r*r+1;
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        if(readTile(getTile,x,y)!==T.ANTIGRAVITY_BEACON) continue;
        if(excluded && excluded.has(x+','+y)) continue;
        const bx=x+0.5, by=y+0.5;
        const dx=bx-cx, dy=by-cy;
        const d2=dx*dx+dy*dy;
        if(d2<bestD2){
          bestD2=d2;
          best={x:bx,y:by,tx:x,ty:y,d2,d:Math.sqrt(d2)};
        }
      }
    }
    return best;
  }
  function surfaceNear(x,guessY,getTile){
    const wg=MM.worldGen;
    let center=Number.isFinite(guessY) ? Math.round(guessY) : null;
    if(center==null){
      try{ if(wg && wg.surfaceHeight) center=wg.surfaceHeight(Math.round(x)); }catch(e){ center=null; }
    }
    if(center==null || !Number.isFinite(center)) center=62;
    const from=Math.max(1,center-18);
    const to=Math.min(WORLD_H-4,center+24);
    for(let y=from; y<=to; y++){
      const t=readTile(getTile,x,y);
      if(meteorGroundTile(t) || t===T.LAVA) return y;
    }
    for(let y=1; y<WORLD_H-3; y++){
      const t=readTile(getTile,x,y);
      if(meteorGroundTile(t) || t===T.LAVA) return y;
    }
    return null;
  }
  function craterSurfaceNear(x,impactY,getTile){
    let center=Number.isFinite(impactY) ? Math.round(impactY) : null;
    try{
      const wg=MM.worldGen;
      if(wg && wg.surfaceHeight){
        const sy=wg.surfaceHeight(Math.round(x));
        if(Number.isFinite(sy) && (center==null || Math.abs(sy-center)<=18)) center=sy;
      }
    }catch(e){}
    if(center==null || !Number.isFinite(center)) return surfaceNear(x,impactY,getTile);
    center=clamp(Math.round(center),2,WORLD_H-5);
    const solidAt=(y)=>{
      const t=readTile(getTile,x,y);
      return meteorGroundTile(t) || t===T.LAVA;
    };
    if(solidAt(center)){
      let y=center;
      const minY=Math.max(1,center-12);
      while(y>minY && solidAt(y-1)) y--;
      return y;
    }
    for(let d=1; d<=14; d++){
      const down=center+d;
      if(down<WORLD_H-3 && solidAt(down)) return down;
      const up=center-d;
      if(up>1 && solidAt(up)) return up;
    }
    return surfaceNear(x,impactY,getTile);
  }
  function goodTargetTile(t){
    return meteorGroundTile(t) && !protectedTile(t);
  }
  function pickTarget(player,getTile,opts){
    opts=opts||{};
    if(Number.isFinite(opts.x) && Number.isFinite(opts.y)){
      return {x:Math.round(opts.x), y:clamp(Math.round(opts.y),2,WORLD_H-5)};
    }
    const px=(player && Number.isFinite(player.x)) ? player.x : 0;
    const facing=(player && Number.isFinite(player.facing) && player.facing<0) ? -1 : 1;
    const candidates=[];
    if(opts.nearHero !== false) candidates.push(facing*(18+Math.random()*10));
    for(let i=0;i<24;i++){
      const side=Math.random()<0.5 ? -1 : 1;
      candidates.push(side*(24+Math.random()*76));
    }
    for(const off of candidates){
      const tx=Math.round(px+off);
      const sy=surfaceNear(tx,null,getTile);
      if(sy==null) continue;
      const t=readTile(getTile,tx,sy);
      if(goodTargetTile(t)) return {x:tx,y:sy};
    }
    const tx=Math.round(px+facing*26);
    const sy=surfaceNear(tx,null,getTile);
    return {x:tx,y:sy==null?62:sy};
  }
  function pushCapped(arr,item,max){
    if(arr.length>=max) arr.shift();
    arr.push(item);
  }
  function emitTrailEmber(m){
    if(embers.length>=MAX_EMBERS) return;
    const ms=frameMs();
    if(ms>34 && Math.random()<0.62) return;
    const side=(Math.random()-0.5)*0.9;
    pushCapped(embers,{
      x:m.x+side,
      y:m.y+side*0.25,
      vx:-m.vx*0.06+(Math.random()-0.5)*3.2,
      vy:-m.vy*0.04+(Math.random()-0.5)*2.2,
      life:0,
      max:0.38+Math.random()*0.48,
      size:0.06+Math.random()*0.10,
      hue:Math.random()<0.22?'white':(Math.random()<0.55?'gold':'orange')
    },MAX_EMBERS);
  }
  function smokeAt(x,y,power){
    try{
      if(MM.particles && MM.particles.spawnSmoke){
        MM.particles.spawnSmoke(x*(MM.TILE||20),y*(MM.TILE||20),power||2,{tileX:Math.floor(x),tileY:Math.floor(y),tileSize:MM.TILE||20});
      }
    }catch(e){}
  }
  function plumeSprite(shade){
    if(typeof document==='undefined' || !document.createElement) return null;
    const q=clamp(Math.round((shade||56)/8)*8,32,96);
    let sprite=plumeSprites.get(q);
    if(sprite) return sprite;
    const size=72;
    const c=document.createElement('canvas');
    c.width=size;
    c.height=size;
    const g=c.getContext && c.getContext('2d');
    if(!g || !g.createRadialGradient) return null;
    const cx=size/2, cy=size/2;
    const grad=g.createRadialGradient(cx,cy,2,cx,cy,size*0.48);
    grad.addColorStop(0,'rgba('+q+','+q+','+q+',0.46)');
    grad.addColorStop(0.48,'rgba('+q+','+q+','+q+',0.18)');
    grad.addColorStop(1,'rgba('+q+','+q+','+q+',0)');
    g.fillStyle=grad;
    g.beginPath();
    g.arc(cx,cy,size*0.48,0,Math.PI*2);
    g.fill();
    plumeSprites.set(q,c);
    return c;
  }
  function burstAt(x,y,tier,count){
    try{
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(x*(MM.TILE||20),y*(MM.TILE||20),tier||'epic',count||12);
      else if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(x*(MM.TILE||20),y*(MM.TILE||20),tier||'epic');
    }catch(e){}
  }
  function playReadyAudio(name){
    try{
      if(MM.audio && MM.audio.play && MM.audio.isReady && MM.audio.isReady()) MM.audio.play(name);
    }catch(e){}
  }
  function splashAt(x,y,intensity){
    try{ if(MM.particles && MM.particles.spawnSplash) MM.particles.spawnSplash(x*(MM.TILE||20),y*(MM.TILE||20),intensity||1); }catch(e){}
  }
  function emitWaterImpactFx(cx,cy,intensity){
    const stress=frameMs()>30;
    const n=stress ? 6 : 18;
    for(let i=0;i<n;i++){
      const ox=rand(-3.4,3.4)*(0.45+intensity*0.12);
      const oy=rand(-0.8,0.6);
      splashAt(cx+ox,cy+oy,1.0+intensity*0.34);
      pushCapped(plumes,{
        x:cx+ox*0.28,
        y:cy+oy,
        vx:rand(-0.42,0.42),
        vy:rand(-1.45,-0.42),
        life:0,
        max:rand(1.3,2.8),
        r:rand(0.32,0.78)*(1+intensity*0.10),
        shade:Math.floor(rand(122,188))
      },MAX_PLUMES);
    }
    try{ if(MM.gases && MM.gases.add) MM.gases.add('steam',cx,cy-0.4,{power:1.3+intensity*0.45,cells:8}); }catch(e){}
  }
  function queueBeaconWave(b,m){
    if(!b || !m) return;
    pushCapped(beaconWaves,{
      x0:b.x,
      y0:b.y,
      x1:m.x,
      y1:m.y,
      life:0,
      max:0.58,
      width:0.22+Math.min(0.18,(m.intensity||1)*0.05),
      phase:Math.random()*Math.PI*2
    },MAX_BEACON_WAVES);
  }
  function queueGravityBurst(b,m){
    if(!b) return;
    pushCapped(gravityBursts,{
      x:b.x,
      y:b.y,
      life:0,
      max:3.25,
      radius:9.5+Math.min(4.5,(m && m.intensity ? m.intensity : 1)*2.1),
      power:21+Math.min(10,(m && m.intensity ? m.intensity : 1)*4),
      seed:Math.random()*Math.PI*2
    },MAX_GRAVITY_BURSTS);
  }
  function inverseGravityAt(x,y){
    let lift=0;
    for(const b of gravityBursts){
      const age=clamp(b.life/b.max,0,1);
      const dx=x-b.x, dy=y-b.y;
      const d=Math.hypot(dx,dy);
      if(d>=b.radius) continue;
      const spatial=1-d/b.radius;
      const temporal=0.25+0.75*Math.sin(Math.PI*age);
      lift+=b.power*spatial*temporal;
    }
    return lift;
  }
  function applyGravityBurstToPlayer(dt,player){
    if(!player || !gravityBursts.length) return;
    const lift=inverseGravityAt(player.x,player.y);
    if(!(lift>0)) return;
    player.vy-=lift*dt;
    if(player.vy<-11) player.vy=-11;
    player.onGround=false;
  }
  function emitBeaconDeflectFx(m,b){
    deflections++;
    const rt=m && m.redirectTarget;
    lastDeflection={
      x:+m.x.toFixed(2),
      y:+m.y.toFixed(2),
      beaconX:+b.x.toFixed(2),
      beaconY:+b.y.toFixed(2),
      d:+Math.hypot(m.x-b.x,m.y-b.y).toFixed(2),
      targetX:rt ? +rt.x.toFixed(2) : null,
      targetY:rt ? +rt.y.toFixed(2) : null,
      t:0
    };
    queueBeaconWave(b,m);
    queueGravityBurst(b,m);
    const stress=frameMs()>30;
    const emberCount=stress ? 12 : 28;
    for(let i=0;i<emberCount;i++){
      const a=Math.random()*Math.PI*2;
      const sp=rand(1.5,6.8)*(1+(m.intensity||1)*0.08);
      pushCapped(embers,{
        x:b.x+rand(-0.18,0.18),
        y:b.y+rand(-0.18,0.18),
        vx:Math.cos(a)*sp,
        vy:Math.sin(a)*sp-rand(0.5,2.4),
        life:0,
        max:rand(0.35,0.95),
        size:rand(0.05,0.13),
        hue:Math.random()<0.55?'white':'gold'
      },MAX_EMBERS);
    }
    const plumeCount=stress ? 3 : 7;
    for(let i=0;i<plumeCount;i++){
      pushCapped(plumes,{
        x:b.x+rand(-0.65,0.65),
        y:b.y+rand(-0.45,0.45),
        vx:rand(-0.28,0.28),
        vy:rand(-0.75,-0.15),
        life:0,
        max:rand(0.7,1.6),
        r:rand(0.18,0.42),
        shade:Math.floor(rand(92,148))
      },MAX_PLUMES);
    }
    screenFlash=Math.max(screenFlash,0.34);
    startShake(0.22,3.2);
    burstAt(b.x,b.y,'epic',14);
    try{ if(typeof window.msg==='function') window.msg('Beacon antygrawitacyjny odchylil meteoryt'); }catch(e){}
    playReadyAudio('charge');
  }
  function bounceDirection(m,b){
    const vx=Number(m && m.vx)||0;
    if(Math.abs(vx)>0.1) return vx>=0 ? 1 : -1;
    const mx=Number(m && m.x);
    if(Number.isFinite(mx) && Number.isFinite(b && b.x) && Math.abs(mx-b.x)>0.2) return mx<b.x ? 1 : -1;
    return Math.random()<0.5 ? -1 : 1;
  }
  function validBounceLanding(tx,originalX,originalY,b,getTile){
    if(Math.abs(tx-b.x)<BEACON_BOUNCE_CLEARANCE) return null;
    if(Math.abs(tx-originalX)<BEACON_BOUNCE_CLEARANCE) return null;
    const sy=craterSurfaceNear(tx,originalY,getTile);
    if(sy==null) return null;
    const t=readTile(getTile,tx,sy);
    if(protectedTile(t)) return null;
    if(goodTargetTile(t) || t===T.LAVA || t===T.WATER || t===T.ICE) return {x:tx,y:sy};
    return null;
  }
  function chainedBeaconBounceTarget(b,originalX,originalY,awaySide,getTile,exclude){
    for(let d=BEACON_BOUNCE_MIN_DISTANCE; d<=BEACON_BOUNCE_MAX_DISTANCE; d+=8){
      const probeX=b.x+awaySide*d;
      const probeY=craterSurfaceNear(Math.round(probeX),originalY,getTile);
      const next=nearestBeacon(probeX,probeY==null ? originalY : probeY,getTile,BEACON_DEFLECT_RADIUS+6,{exclude});
      if(!next) continue;
      const tx=Math.round(next.x+awaySide*7);
      const target=validBounceLanding(tx,originalX,originalY,b,getTile);
      if(target) return target;
    }
    return null;
  }
  function chooseBounceTarget(m,b,getTile){
    const awaySide=bounceDirection(m,b);
    const original=m && m.target ? m.target : {x:b.x,y:b.y};
    const originalX=Number.isFinite(original && original.x) ? original.x : b.x;
    const originalY=Number.isFinite(original && original.y) ? original.y : b.y;
    const chained=chainedBeaconBounceTarget(b,originalX,originalY,awaySide,getTile,m && m.usedBeaconKeys ? m.usedBeaconKeys : []);
    if(chained) return chained;
    const candidates=[];
    for(let i=0;i<8;i++){
      const side=i<5 ? awaySide : -awaySide;
      const min=BEACON_BOUNCE_MIN_DISTANCE + (i%3)*6;
      const span=Math.max(1,BEACON_BOUNCE_MAX_DISTANCE-min);
      candidates.push(side*(min+Math.random()*span));
    }
    for(const off of candidates){
      const tx=Math.round(b.x+off);
      const target=validBounceLanding(tx,originalX,originalY,b,getTile);
      if(target) return target;
    }
    const fallbackX=Math.round(b.x+awaySide*((BEACON_BOUNCE_MIN_DISTANCE+BEACON_BOUNCE_MAX_DISTANCE)*0.5));
    const fallbackY=craterSurfaceNear(fallbackX,originalY,getTile);
    return {x:fallbackX,y:clamp(fallbackY==null ? Math.round(b.y) : fallbackY,2,WORLD_H-6)};
  }
  function retargetMeteorForBounce(m,b,getTile){
    const target=chooseBounceTarget(m,b,getTile);
    const aimX=target.x+0.5+rand(-0.45,0.45);
    const aimY=target.y-0.25;
    const dx=aimX-m.x;
    const arcTime=clamp(Math.abs(dx)/22,2.25,3.65);
    m.vx=dx/arcTime;
    m.vy=(aimY-m.y-0.5*GRAVITY*arcTime*arcTime)/arcTime;
    m.vy=Math.min(m.vy,-6.5-(m.intensity||1)*1.2);
    m.life=Math.max(m.life,arcTime+3.25);
    m.target={x:target.x,y:target.y,deflected:true};
    m.redirectTarget={x:target.x+0.5,y:target.y};
    m.cachedBeacon=nearestBeacon(target.x,target.y,getTile,BEACON_SCAN_RADIUS,{exclude:m.usedBeaconKeys||[]});
    return target;
  }
  function deflectMeteorFromBeacon(m,b,getTile){
    if(!m || !b) return false;
    if((m.deflectionCount||0)>=MAX_BEACON_DEFLECTIONS_PER_METEOR) return false;
    const dx=m.x-b.x;
    const dy=m.y-b.y;
    const d=Math.hypot(dx,dy)||1;
    const key=beaconKey(b);
    m.usedBeaconKeys=Array.isArray(m.usedBeaconKeys) ? m.usedBeaconKeys : [];
    if(m.usedBeaconKeys.includes(key)) return false;
    m.usedBeaconKeys.push(key);
    m.deflected=true;
    m.deflectionCount=(m.deflectionCount||0)+1;
    m.deflectedAt={x:m.x,y:m.y,d};
    m.deflectedBy={x:b.x,y:b.y};
    retargetMeteorForBounce(m,b,getTile);
    emitBeaconDeflectFx(m,b);
    return true;
  }
  function applyBeaconField(m,dt,getTile){
    if(!m || (m.deflectionCount||0)>=MAX_BEACON_DEFLECTIONS_PER_METEOR) return false;
    m.beaconScanT=(Number.isFinite(m.beaconScanT)?m.beaconScanT:0)-dt;
    let b=m.cachedBeacon || null;
    if(!b || m.beaconScanT<=0){
      m.beaconScanT=BEACON_SCAN_INTERVAL;
      const exclude=m.usedBeaconKeys||[];
      const target=m.target || {x:m.x,y:m.y};
      const targetBeacon=nearestBeacon(target.x,target.y,getTile,BEACON_SCAN_RADIUS,{exclude});
      const currentBeacon=nearestBeacon(m.x,m.y,getTile,BEACON_FIELD_RADIUS,{exclude});
      b=currentBeacon || targetBeacon;
      m.cachedBeacon=b;
    }
    if(!b) return false;
    const d=Math.hypot(m.x-b.x,m.y-b.y);
    const target=m.target || {x:m.x,y:m.y};
    const targetD=Math.hypot(target.x-b.x,target.y-b.y);
    const protectedTarget=targetD<BEACON_FIELD_RADIUS;
    const fieldRadius=protectedTarget ? BEACON_FIELD_RADIUS : BEACON_DEFLECT_RADIUS*1.35;
    const triggerRadius=protectedTarget ? BEACON_DEFLECT_RADIUS : BEACON_HARD_DEFLECT_RADIUS;
    if(d<triggerRadius || d<BEACON_HARD_DEFLECT_RADIUS){
      return deflectMeteorFromBeacon(m,b,getTile);
    }
    if(d<fieldRadius){
      const dx=m.x-b.x, dy=m.y-b.y;
      const len=Math.hypot(dx,dy)||1;
      const strength=(1-d/fieldRadius)*(protectedTarget ? 30 : 24);
      m.vx+=(dx/len)*strength*dt;
      m.vy-=Math.max(0.2,(1-Math.abs(dy/len)))*strength*0.38*dt;
    }
    return false;
  }
  function markWorldChanged(){
    try{ if(typeof window.__mmMarkWorldChanged==='function') window.__mmMarkWorldChanged('meteorite'); }catch(e){}
  }
  function startShake(duration,amp){
    const d=clamp(Number(duration)||0,0,2.2);
    const a=clamp(Number(amp)||0,0,26);
    if(!(d>0 && a>0)) return;
    const current=shakeT>0 && shakeMax>0 ? shakeAmp*(shakeT/shakeMax) : 0;
    if(a>=current){
      shakeT=d;
      shakeMax=d;
      shakeAmp=a;
      shakeSeed=Math.random()*Math.PI*2;
    } else {
      shakeT=Math.max(shakeT,d*0.55);
      shakeMax=Math.max(shakeMax,d);
    }
  }
  function screenShakeOffset(now){
    if(!(shakeT>0 && shakeMax>0 && shakeAmp>0)) return {x:0,y:0};
    const k=clamp(shakeT/shakeMax,0,1);
    const amp=shakeAmp*k*k;
    const t=((Number.isFinite(now)?now:((typeof performance!=='undefined' && performance.now)?performance.now():Date.now()))||0)*0.055;
    return {
      x:(Math.sin(t*1.73+shakeSeed)+Math.sin(t*3.91+shakeSeed*0.47)*0.45)*amp,
      y:(Math.cos(t*2.11+shakeSeed*1.37)+Math.sin(t*5.03+shakeSeed)*0.35)*amp*0.72
    };
  }
  function notifyTerrainChange(x,y,oldTile,newTile,getTile,setTile){
    if(oldTile===newTile) return;
    try{
      if(newTile===T.AIR && MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y);
      else if(newTile!==T.AIR && MM.fallingSolids && MM.fallingSolids.afterPlacement) MM.fallingSolids.afterPlacement(x,y);
    }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{
      if(newTile===T.LAVA && MM.fire && MM.fire.noteLava){
        MM.fire.noteLava(x,y,{priority:true,fast:true});
        if(MM.fire.heatAround) MM.fire.heatAround(x,y,getTile,setTile,{includeCenter:false});
      }
    }catch(e){}
    if(oldTile===T.WATER || oldTile===T.ICE) splashAt(x+0.5,y+0.5,0.8);
    if(tileInfo(oldTile).flammable && newTile===T.AIR) smokeAt(x+0.5,y+0.4,0.8);
  }
  function hashUnit(seed,n){
    const v=Math.sin(seed*12.9898 + n*78.233)*43758.5453;
    return v-Math.floor(v);
  }
  function smoothUnit(seed,n){
    const i=Math.floor(n);
    const f=n-i;
    const a=hashUnit(seed,i);
    const b=hashUnit(seed,i+1);
    const t=f*f*(3-f*2);
    return a+(b-a)*t;
  }
  function craterColumnNoise(seed,x){
    return (smoothUnit(seed,x*0.18)-0.5)*0.72 +
      (smoothUnit(seed+17.13,x*0.47)-0.5)*0.34 +
      (hashUnit(seed+31.7,x*1.91)-0.5)*0.18;
  }
  function buildCraterOps(cx,cy,intensity,getTile,opts){
    opts=opts||{};
    const impactY=clamp(Math.round(Number.isFinite(opts.surfaceY)?opts.surfaceY:cy),2,WORLD_H-6);
    const seed=Number.isFinite(opts.seed) ? +opts.seed : rand(1,1000000);
    const scale=clamp(Number(opts.scale)||rand(0.68,1.42),0.62,1.55);
    const baseRx=8.8+intensity*4.25;
    const leftRx=clamp(baseRx*scale*rand(0.82,1.30),10.5,24.5);
    const rightRx=clamp(baseRx*scale*rand(0.82,1.30),10.5,24.5);
    const ry=clamp((4.0+intensity*2.15)*rand(0.70,1.40),3.6,10.8);
    const basinShift=rand(-0.16,0.16)*(leftRx+rightRx)*0.5;
    const bowlPower=rand(0.52,1.04);
    const roughness=rand(0.08,0.24);
    const terraceStrength=Math.random()<0.42 ? rand(0.20,0.62) : 0;
    const terraceAt=rand(0.38,0.72);
    const rimRaiseChance=rand(0.16,0.46);
    const lavaSpan=hashUnit(seed+9.5,0)>0.58 ? 1 : 0;
    const ops=[];
    const floorCells=[];
    function addOp(phase,x,y,t,d,place){
      if(y<1 || y>=WORLD_H-3 || !Number.isFinite(x)) return;
      ops.push({phase,x,y,t,d,place:!!place});
    }
    for(let x=Math.floor(cx-leftRx-3); x<=Math.ceil(cx+rightRx+3); x++){
      const dx=(x+0.5)-(cx+basinShift);
      const localRx=dx<0 ? leftRx : rightRx;
      const colNoise=craterColumnNoise(seed,x);
      const noisyRx=localRx*clamp(1+colNoise*roughness,0.78,1.24);
      const edge=Math.abs(dx)/Math.max(0.1,noisyRx);
      if(edge>1.18) continue;
      const surface=craterSurfaceNear(x,impactY,getTile);
      if(surface==null) continue;
      if(edge<=1.0){
        const curve=Math.max(0,1-edge*edge);
        let depth=1.05+Math.pow(curve,bowlPower)*ry;
        depth+=colNoise*ry*0.16;
        if(terraceStrength && edge>terraceAt && edge<terraceAt+0.22) depth-=terraceStrength*ry;
        if(edge>0.70 && hashUnit(seed+23.4,x)>0.84) depth-=1.1+hashUnit(seed+24.1,x)*1.2;
        if(edge<0.18 && hashUnit(seed+29.9,x)>0.72) depth+=0.8+hashUnit(seed+30.6,x)*1.0;
        depth=clamp(Math.floor(depth),1,12);
        const startY=Math.max(1,Math.floor(surface-1));
        const floorY=Math.min(WORLD_H-4,Math.floor(surface+depth));
        for(let y=startY; y<=floorY; y++){
          addOp(0,x,y,T.AIR,Math.abs(dx)+(y-surface)*0.18,false);
        }
        const old=readTile(getTile,x,floorY);
        const central=edge<(0.14+hashUnit(seed+2.2,x)*0.10) && intensity>0.8;
        addOp(1,x,floorY,hotTileForFloor(old,edge,central),Math.abs(dx),true);
        floorCells.push({x,floorY,edge,d:Math.abs(dx)});
        if(edge<0.52 && floorY+1<WORLD_H-3){
          const mineral=hashUnit(seed+37.2,x*1.73+floorY*0.37);
          const t=edge<0.24 ? meteorCoreTile() : (mineral<0.42 ? T.METEORIC_IRON : (mineral<0.68 ? T.COAL : T.OBSIDIAN));
          addOp(1,x,floorY+1,t,Math.abs(dx)+0.7,true);
        }
      }
      if(edge>0.88 && edge<1.18){
        const rimRoll=hashUnit(seed+43.5,x*0.91);
        const rimY=Math.max(1,surface-1-(edge<1.04 && rimRoll<rimRaiseChance?1:0)+(rimRoll>0.90?1:0));
        addOp(1,x,rimY,rimRoll<0.74?T.OBSIDIAN:T.STONE,Math.abs(dx)+2,true);
        if(edge<1.07 && hashUnit(seed+47.8,x)>0.72){
          addOp(1,x,Math.min(WORLD_H-4,rimY+1),hashUnit(seed+48.5,x)<0.62?T.STONE:T.OBSIDIAN,Math.abs(dx)+2.4,true);
        }
      }
    }
    floorCells.sort((a,b)=>a.d-b.d || a.floorY-b.floorY);
    const core=floorCells[0] || {x:Math.floor(cx),floorY:clamp(impactY+Math.round(ry),2,WORLD_H-4),d:0};
    const coreX=core.x;
    const floorY=core.floorY;
    for(let x=coreX-lavaSpan; x<=coreX+lavaSpan; x++) addOp(1,x,floorY,T.LAVA,0.01+Math.abs(x-coreX)*0.04,true);
    const depositCells=floorCells.filter(c=>c.edge<0.62);
    if(depositCells.length<4){
      const seen=new Set(depositCells.map(c=>c.x+','+c.floorY));
      for(const c of floorCells){
        const key=c.x+','+c.floorY;
        if(seen.has(key)) continue;
        seen.add(key);
        depositCells.push(c);
        if(depositCells.length>=4) break;
      }
    }
    depositCells.sort((a,b)=>{
      const ah=hashUnit(seed+59.1,a.x*2.11+a.floorY*0.19);
      const bh=hashUnit(seed+59.1,b.x*2.11+b.floorY*0.19);
      return ah-bh;
    });
    const usedDeposits=new Set();
    function addDeposit(tile,offsetY,dBase){
      for(const c of depositCells){
        const y=c.floorY+offsetY;
        if(y>=WORLD_H-3) continue;
        const key=c.x+','+y;
        if(usedDeposits.has(key)) continue;
        usedDeposits.add(key);
        addOp(1,c.x,y,tile,dBase+c.edge,true);
        return true;
      }
      return false;
    }
    addDeposit(T.IRIDIUM,1,0.05);
    addDeposit(T.METEORIC_IRON,1+Math.round(hashUnit(seed+64.4,1)),0.30);
    addDeposit(T.COAL,1+Math.round(hashUnit(seed+65.2,2)),0.32);
    if(intensity>1.2) addDeposit(T.IRIDIUM,2,0.35);
    ops.sort((a,b)=>a.phase-b.phase || a.d-b.d);
    return ops;
  }
  function applyCraterOp(op,getTile,setTile){
    if(!op || op.y<1 || op.y>=WORLD_H-3 || !Number.isFinite(op.x)) return false;
    const old=readTile(getTile,op.x,op.y);
    if(old===op.t) return false;
    if(protectedTile(old)) return false;
    if(op.phase===0 && old===T.AIR) return false;
    if(op.phase===1 && !op.place && op.t!==T.LAVA && old===T.AIR && Math.random()<0.72) return false;
    setTile(op.x,op.y,op.t);
    notifyTerrainChange(op.x,op.y,old,op.t,getTile,setTile);
    return true;
  }
  function queueCrater(cx,cy,intensity,getTile,preparedOps,setTile,opts){
    opts=opts||{};
    const ops=Array.isArray(preparedOps) ? preparedOps : buildCraterOps(cx,cy,intensity,getTile);
    if(opts.instant && typeof setTile==='function'){
      for(const op of ops) applyCraterOp(op,getTile,setTile);
      return ops.length;
    }
    if(ops.length){
      const chunks=new Set();
      for(const op of ops) if(op && Number.isFinite(op.x)) chunks.add(Math.floor(op.x/CHUNK_W));
      terrainJobs.push({ops,i:0,x:cx,y:cy,chunks});
    }
    return ops.length;
  }
  function applyTerrainJobs(getTile,setTile){
    if(!terrainJobs.length || typeof getTile!=='function' || typeof setTile!=='function') return;
    let budget=frameMs()>28 ? STRESSED_TERRAIN_BUDGET : BASE_TERRAIN_BUDGET;
    while(budget>0 && terrainJobs.length){
      const job=terrainJobs[0];
      while(budget>0 && job.i<job.ops.length){
        const op=job.ops[job.i++];
        budget--;
        applyCraterOp(op,getTile,setTile);
      }
      if(job.i>=job.ops.length){ terrainJobs.shift(); markWorldChanged(); }
      else break;
    }
  }
  function emitImpactFx(cx,cy,intensity,waterHit){
    impacts++;
    lastImpact={x:cx,y:cy,t:0};
    screenFlash=Math.max(screenFlash,1.28);
    startShake(0.78+intensity*0.18,9.5+intensity*5.2);
    const stress=frameMs()>30;
    const debrisCount=stress ? 5 : 12;
    const emberCount=stress ? 18 : 44;
    for(let i=0;i<debrisCount;i++){
      const a=rand(-Math.PI*0.95,-Math.PI*0.05);
      const sp=rand(4.0,11.5)*(0.75+intensity*0.18);
      pushCapped(debris,{
        x:cx+rand(-0.55,0.55),
        y:cy+rand(-0.35,0.45),
        vx:Math.cos(a)*sp,
        vy:Math.sin(a)*sp-rand(0,2.4),
        life:0,
        max:rand(0.85,1.75),
        rot:Math.random()*Math.PI,
        spin:rand(-8,8),
        hot:Math.random()<0.58
      },MAX_DEBRIS);
    }
    for(let i=0;i<emberCount;i++){
      const a=Math.random()*Math.PI*2;
      const sp=rand(1.5,8.8)*(0.75+intensity*0.12);
      pushCapped(embers,{
        x:cx+rand(-0.8,0.8),
        y:cy+rand(-0.45,0.35),
        vx:Math.cos(a)*sp,
        vy:Math.sin(a)*sp-rand(1.5,5.5),
        life:0,
        max:rand(0.55,1.35),
        size:rand(0.08,0.20),
        hue:Math.random()<0.16?'white':(Math.random()<0.54?'gold':'orange')
      },MAX_EMBERS);
    }
    const plumeCount=stress ? 7 : 14;
    for(let i=0;i<plumeCount;i++){
      pushCapped(plumes,{
        x:cx+rand(-3.8,3.8),
        y:cy+rand(-0.8,1.2),
        vx:rand(-0.48,0.48),
        vy:rand(-1.25,-0.35),
        life:0,
        max:rand(2.6,5.2),
        r:rand(0.44,1.05)*(1+intensity*0.16),
        shade:Math.floor(rand(38,82))
      },MAX_PLUMES);
    }
    if(waterHit) emitWaterImpactFx(cx,cy,1.15+intensity*0.25);
    for(let i=0;i<4;i++) smokeAt(cx+rand(-3.4,3.4),cy+rand(-1.4,1.4),2.1+intensity*0.55);
    burstAt(cx,cy,'epic',28);
    try{ if(MM.gases && MM.gases.add) MM.gases.add('hot',cx,cy-0.6,{power:2.6+intensity*0.55,cells:12}); }catch(e){}
    playReadyAudio('meteor');
    playReadyAudio('explosion');
    try{ if(typeof window.msg==='function') window.msg('Krater @ x='+Math.round(cx)); }catch(e){}
  }
  function hurtActors(cx,cy,intensity){
    const radius=8.0+intensity*2.3;
    try{ if(MM.mobs && MM.mobs.blastRadius) MM.mobs.blastRadius(cx,cy,radius,34+intensity*10); }catch(e){}
    try{
      if(MM.bosses && MM.bosses.damageAt){
        const d=34+intensity*11;
        MM.bosses.damageAt(Math.round(cx),Math.round(cy),d);
        MM.bosses.damageAt(Math.round(cx)+1,Math.round(cy),d*0.6);
        MM.bosses.damageAt(Math.round(cx)-1,Math.round(cy),d*0.6);
      }
    }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt) MM.ufo.damageAt(Math.round(cx),Math.round(cy),48+intensity*13); }catch(e){}
    try{ if(MM.plants && MM.plants.scorchAt) MM.plants.scorchAt(cx,cy,radius); }catch(e){}
    const pl=(typeof window!=='undefined' && window.player) || null;
    if(pl && typeof window.damageHero==='function'){
      const d=Math.hypot(pl.x-cx,pl.y-cy);
      if(d<radius+1.6){
        const k=1-Math.min(1,d/(radius+1.6));
        window.damageHero(24+Math.round(k*(68+intensity*20)),{srcX:cx,srcY:cy,kb:7+k*10,kbY:-5.5-k*5,launch:-7.5-k*5.2,invulMs:1050,cause:'meteor'});
      }
    }
  }
  function impactAt(wx,wy,getTile,setTile,intensity,preparedOps,opts){
    opts=opts||{};
    const cx=Math.floor(wx)+0.5;
    const cy=clamp(Math.floor(wy),2,WORLD_H-5);
    const hit=readTile(getTile,Math.floor(cx),Math.floor(cy));
    const waterHit=!!opts.waterHit || hit===T.WATER || hit===T.ICE;
    queueCrater(cx,cy,intensity||1,getTile,preparedOps,setTile,{instant:true});
    markWorldChanged();
    emitImpactFx(cx,cy,intensity||1,waterHit);
    hurtActors(cx,cy,intensity||1);
    return true;
  }
  function forceSpawn(opts,player,getTile){
    opts=opts||{};
    if(meteors.length>=MAX_METEORS) return null;
    const target=pickTarget(player,getTile,opts);
    if(!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    const intensity=clamp(Number(opts.intensity)||rand(1.12,1.58),0.85,2.2);
    const surfaceY=clamp(craterSurfaceNear(target.x,target.y,getTile)||target.y,2,WORLD_H-6);
    const side=opts.side || (Math.random()<0.5 ? -1 : 1);
    const fallTime=rand(2.05,2.72);
    const distance=rand(54,82);
    const startX=target.x - side*distance;
    const startY=Math.max(-42,surfaceY-rand(58,82));
    const aimX=target.x+0.5+rand(-0.55,0.55);
    const aimY=surfaceY-0.2;
    const vx=(aimX-startX)/fallTime;
    const vy=(aimY-startY-0.5*GRAVITY*fallTime*fallTime)/fallTime;
    const cachedBeacon=nearestBeacon(target.x,surfaceY,getTile,BEACON_SCAN_RADIUS);
    const m={
      x:startX,y:startY,vx,vy,
      target:{x:target.x,y:surfaceY},
      life:fallTime+3.0,
      t:0,
      trail:[],
      intensity,
      rot:Math.random()*Math.PI*2,
      spin:rand(-5.5,5.5),
      waterEntryFx:false,
      waterHit:false,
      beaconScanT:0,
      cachedBeacon
    };
    meteors.push(m);
    spawned++;
    try{ if(typeof window.msg==='function') window.msg('Niebo przecina meteoryt...'); }catch(e){}
    return m;
  }
  function destroyFlyThroughTile(x,y,t,getTile,setTile,intensity){
    if(!meteorShattersTile(t) || typeof setTile!=='function') return false;
    setTile(x,y,T.AIR);
    notifyTerrainChange(x,y,t,T.AIR,getTile,setTile);
    if(Math.random()<0.35) burstAt(x+0.5,y+0.5,'rare',4);
    if(tileInfo(t).flammable) smokeAt(x+0.5,y+0.5,0.7+intensity*0.2);
    return true;
  }
  function updateMeteor(m,dt,getTile,setTile,player){
    const speed=Math.hypot(m.vx,m.vy);
    const steps=clamp(Math.ceil(speed*dt/0.34),1,10);
    const sdt=dt/steps;
    for(let i=0;i<steps;i++){
      m.life-=sdt;
      m.t+=sdt;
      m.vy+=GRAVITY*sdt;
      m.x+=m.vx*sdt;
      m.y+=m.vy*sdt;
      m.rot+=m.spin*sdt;
      if(!m.trail.length || Math.hypot(m.x-m.trail[m.trail.length-1].x,m.y-m.trail[m.trail.length-1].y)>0.78){
        m.trail.push({x:m.x,y:m.y,t:m.t});
        if(m.trail.length>28) m.trail.shift();
      }
      if(Math.random()<0.22) emitTrailEmber(m);
      if(applyBeaconField(m,sdt,getTile)) continue;
      const tx=Math.floor(m.x), ty=Math.floor(m.y);
      const t=readTile(getTile,tx,ty);
      if(!m.waterEntryFx && (t===T.WATER || t===T.ICE)){
        m.waterEntryFx=true;
        m.waterHit=true;
        emitWaterImpactFx(m.x,m.y,m.intensity);
      }
      if(ty>=WORLD_H-3 || (ty>=1 && meteorGroundTile(t))){
        impactAt(m.x,m.y,getTile,setTile,m.intensity,null,{waterHit:m.waterHit});
        return true;
      }
      destroyFlyThroughTile(tx,ty,t,getTile,setTile,m.intensity);
      if(m.life<=0){
        const rt=m.redirectTarget;
        if(rt && Number.isFinite(rt.x) && Number.isFinite(rt.y)) impactAt(rt.x,rt.y,getTile,setTile,m.intensity,null,{waterHit:m.waterHit});
        else impactAt(m.x,m.y,getTile,setTile,m.intensity,null,{waterHit:m.waterHit});
        return true;
      }
      const pl=player || (typeof window!=='undefined' ? window.player : null);
      if(pl && typeof window.damageHero==='function'){
        const d=Math.hypot(pl.x-m.x,pl.y-m.y);
        if(d<0.9) window.damageHero(38,{srcX:m.x,srcY:m.y,kb:7,kbY:-6,launch:-9,invulMs:950,cause:'meteor'});
      }
    }
    return false;
  }
  function updateFx(dt){
    if(screenFlash>0) screenFlash=Math.max(0,screenFlash-dt*1.85);
    if(shakeT>0) shakeT=Math.max(0,shakeT-dt);
    if(lastImpact){
      lastImpact.t+=dt;
      if(lastImpact.t>7) lastImpact=null;
    }
    if(lastDeflection){
      lastDeflection.t+=dt;
      if(lastDeflection.t>7) lastDeflection=null;
    }
    for(let i=beaconWaves.length-1;i>=0;i--){
      const w=beaconWaves[i];
      w.life+=dt;
      if(w.life>=w.max) beaconWaves.splice(i,1);
    }
    for(let i=gravityBursts.length-1;i>=0;i--){
      const b=gravityBursts[i];
      b.life+=dt;
      if(b.life>=b.max) gravityBursts.splice(i,1);
    }
    for(let i=shockwaves.length-1;i>=0;i--){
      const s=shockwaves[i];
      s.life+=dt;
      s.r=s.max*Math.min(1,s.life/s.ttl);
      if(s.life>=s.ttl) shockwaves.splice(i,1);
    }
    for(let i=scorches.length-1;i>=0;i--){
      const s=scorches[i];
      s.life+=dt;
      if(s.life>=s.ttl) scorches.splice(i,1);
    }
    for(let i=plumes.length-1;i>=0;i--){
      const p=plumes[i];
      p.life+=dt;
      p.x+=p.vx*dt;
      p.y+=p.vy*dt;
      p.r+=dt*0.38;
      p.vy-=dt*0.15;
      p.vy-=inverseGravityAt(p.x,p.y)*0.04*dt;
      if(p.life>=p.max) plumes.splice(i,1);
    }
    for(let i=debris.length-1;i>=0;i--){
      const d=debris[i];
      d.life+=dt;
      d.x+=d.vx*dt;
      d.y+=d.vy*dt;
      d.vy+=(13.5-inverseGravityAt(d.x,d.y))*dt;
      d.vx*=1-Math.min(0.16,dt*0.45);
      d.rot+=d.spin*dt;
      if(d.life>=d.max || d.y>=WORLD_H) debris.splice(i,1);
    }
    for(let i=embers.length-1;i>=0;i--){
      const e=embers[i];
      e.life+=dt;
      e.x+=e.vx*dt;
      e.y+=e.vy*dt;
      e.vy+=(5.5-inverseGravityAt(e.x,e.y)*0.45)*dt;
      e.vx*=1-Math.min(0.12,dt*0.3);
      if(e.life>=e.max || e.y>=WORLD_H) embers.splice(i,1);
    }
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || !Number.isFinite(dt)) return;
    if(enabled && !meteors.length && !terrainJobs.length){
      nextIn-=dt;
      if(nextIn<=0){
        forceSpawn({nearHero:false},player,getTile);
        rollNext();
        saveSettings();
      }
    }
    for(let i=meteors.length-1;i>=0;i--){
      if(updateMeteor(meteors[i],dt,getTile,setTile,player)) meteors.splice(i,1);
    }
    applyGravityBurstToPlayer(dt,player || (typeof window!=='undefined' ? window.player : null));
    applyTerrainJobs(getTile,setTile);
    updateFx(dt);
  }
  function tileVisibleFn(canDrawTile){
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    return (x,y)=> !visible || visible(Math.floor(x),Math.max(0,Math.min(WORLD_H-1,Math.floor(y))));
  }
  function drawMeteor(ctx,TILE,m){
    const ang=Math.atan2(m.vy,m.vx);
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let i=m.trail.length-1;i>0;i--){
      const a=m.trail[i], b=m.trail[i-1];
      const k=i/m.trail.length;
      ctx.strokeStyle='rgba(255,110,26,'+(0.08+0.34*k)+')';
      ctx.lineWidth=TILE*(0.10+0.42*k);
      ctx.beginPath();
      ctx.moveTo(a.x*TILE,a.y*TILE);
      ctx.lineTo(b.x*TILE,b.y*TILE);
      ctx.stroke();
      ctx.strokeStyle='rgba(255,232,120,'+(0.10+0.28*k)+')';
      ctx.lineWidth=TILE*(0.035+0.13*k);
      ctx.beginPath();
      ctx.moveTo(a.x*TILE,a.y*TILE);
      ctx.lineTo(b.x*TILE,b.y*TILE);
      ctx.stroke();
    }
    const px=m.x*TILE, py=m.y*TILE;
    const glowR=TILE*2.4;
    const glow=ctx.createRadialGradient(px,py,1,px,py,glowR);
    glow.addColorStop(0,'rgba(255,255,236,0.95)');
    glow.addColorStop(0.18,'rgba(255,216,91,0.86)');
    glow.addColorStop(0.48,'rgba(255,78,22,0.42)');
    glow.addColorStop(1,'rgba(255,24,0,0)');
    ctx.fillStyle=glow;
    ctx.beginPath(); ctx.arc(px,py,glowR,0,Math.PI*2); ctx.fill();
    ctx.translate(px,py);
    ctx.rotate(ang);
    ctx.fillStyle='#fff7c9';
    ctx.beginPath(); ctx.ellipse(0,0,TILE*0.42,TILE*0.30,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ff6a21';
    ctx.beginPath(); ctx.ellipse(-TILE*0.08,TILE*0.04,TILE*0.34,TILE*0.22,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(60,22,14,0.68)';
    ctx.lineWidth=2;
    ctx.stroke();
    ctx.restore();
  }
  function drawScorch(ctx,TILE,s){
    const age=s.life/s.ttl;
    const alpha=Math.max(0,1-age);
    const cx=s.x*TILE, cy=s.y*TILE;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const g=ctx.createRadialGradient(cx,cy,1,cx,cy,s.rx*TILE);
    g.addColorStop(0,'rgba(255,122,25,'+(0.28*alpha)+')');
    g.addColorStop(0.36,'rgba(255,61,19,'+(0.18*alpha)+')');
    g.addColorStop(1,'rgba(255,24,0,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.ellipse(cx,cy+s.ry*TILE*0.25,s.rx*TILE,s.ry*TILE,0,0,Math.PI*2); ctx.fill();
    for(let i=0;i<8;i++){
      const a=(i*0.77 + s.x*0.19 + s.y*0.11) % (Math.PI*2);
      const r0=TILE*(0.45+((i*17)%9)*0.09);
      const r1=TILE*(1.5+((i*23)%13)*0.22);
      ctx.strokeStyle='rgba(255,184,68,'+(0.30*alpha)+')';
      ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*r0,cy+Math.sin(a)*r0*0.55);
      ctx.lineTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1*0.42);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawBeaconWave(ctx,TILE,w){
    const age=clamp(w.life/w.max,0,1);
    const alpha=Math.pow(1-age,1.15);
    const x0=w.x0*TILE, y0=w.y0*TILE;
    const x1=w.x1*TILE, y1=w.y1*TILE;
    const dx=x1-x0, dy=y1-y0;
    const len=Math.hypot(dx,dy)||1;
    const nx=-dy/len, ny=dx/len;
    const head=clamp(age*1.75,0,1);
    const tail=clamp(head-0.42,0,1);
    const segments=10;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let pass=0; pass<2; pass++){
      ctx.strokeStyle=pass===0 ? 'rgba(196,107,255,'+(0.34*alpha)+')' : 'rgba(124,247,255,'+(0.78*alpha)+')';
      ctx.lineWidth=TILE*(pass===0 ? (w.width*1.75) : w.width);
      ctx.beginPath();
      for(let i=0;i<=segments;i++){
        const t=tail+(head-tail)*(i/segments);
        const pulse=Math.sin(t*Math.PI*4+w.phase+age*10)*(1-Math.abs(t-head))*TILE*0.34;
        const px=x0+dx*t+nx*pulse;
        const py=y0+dy*t+ny*pulse;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.stroke();
    }
    const hx=x0+dx*head, hy=y0+dy*head;
    ctx.strokeStyle='rgba(238,220,255,'+(0.78*alpha)+')';
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.arc(hx,hy,TILE*(0.35+age*0.35),0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
  function drawGravityBurst(ctx,TILE,b){
    const age=clamp(b.life/b.max,0,1);
    const alpha=Math.sin(Math.PI*age);
    if(!(alpha>0)) return;
    const cx=b.x*TILE, cy=b.y*TILE;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<3;i++){
      const phase=(age+i*0.23)%1;
      const r=b.radius*TILE*(0.22+phase*0.86);
      const a=alpha*(1-phase)*0.42;
      ctx.strokeStyle='rgba(196,107,255,'+a+')';
      ctx.lineWidth=2.2-i*0.35;
      ctx.beginPath();
      ctx.ellipse(cx,cy,r,r*0.38,0,0,Math.PI*2);
      ctx.stroke();
    }
    for(let i=0;i<9;i++){
      const a=b.seed+i*0.698;
      const rr=b.radius*TILE*(0.14+((i*17)%9)/18);
      const x=cx+Math.cos(a)*rr;
      const y=cy+Math.sin(a)*rr*0.36;
      const lift=TILE*(0.65+age*2.4+((i*11)%7)*0.08);
      ctx.strokeStyle='rgba(124,247,255,'+(alpha*0.32)+')';
      ctx.lineWidth=1.1;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+Math.sin(age*8+i)*TILE*0.12,y-lift);
      ctx.stroke();
    }
    ctx.restore();
  }
  function draw(ctx,TILE,canDrawTile){
    const tileVisible=tileVisibleFn(canDrawTile);
    ctx.save();
    for(const s of scorches){
      if(tileVisible(s.x,s.y)) drawScorch(ctx,TILE,s);
    }
    for(const b of gravityBursts){
      if(tileVisible(b.x,b.y)) drawGravityBurst(ctx,TILE,b);
    }
    for(const w of beaconWaves){
      if(tileVisible(w.x0,w.y0) || tileVisible(w.x1,w.y1)) drawBeaconWave(ctx,TILE,w);
    }
    for(const sw of shockwaves){
      if(!tileVisible(sw.x,sw.y)) continue;
      const k=Math.max(0,1-sw.life/sw.ttl);
      ctx.save();
      ctx.globalCompositeOperation=sw.dust?'source-over':'lighter';
      ctx.strokeStyle=sw.dust ? 'rgba(190,150,105,'+(0.34*k)+')' : 'rgba(255,235,170,'+(0.62*k)+')';
      ctx.lineWidth=(sw.dust?4.5:2.2)*k+0.7;
      ctx.beginPath();
      ctx.ellipse(sw.x*TILE,sw.y*TILE,sw.r*TILE,sw.r*TILE*0.32,0,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
    for(const p of plumes){
      if(!tileVisible(p.x,p.y)) continue;
      const age=p.life/p.max;
      const alpha=Math.pow(1-age,1.45)*0.36;
      const q=p.shade|0;
      const sp=plumeSprite(q);
      if(sp && ctx.drawImage){
        const s=p.r*TILE*4.2;
        ctx.save();
        ctx.globalAlpha=alpha*1.9;
        ctx.drawImage(sp,p.x*TILE-s*0.5,p.y*TILE-s*0.5,s,s);
        ctx.restore();
      } else {
        ctx.fillStyle='rgba('+q+','+q+','+q+','+alpha+')';
        ctx.beginPath(); ctx.arc(p.x*TILE,p.y*TILE,p.r*TILE*2.2,0,Math.PI*2); ctx.fill();
      }
    }
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const e of embers){
      if(!tileVisible(e.x,e.y)) continue;
      const alpha=1-e.life/e.max;
      ctx.fillStyle=e.hue==='white' ? 'rgba(255,255,230,'+(0.95*alpha)+')' : (e.hue==='gold' ? 'rgba(255,214,82,'+(0.86*alpha)+')' : 'rgba(255,91,28,'+(0.78*alpha)+')');
      const s=Math.max(1.2,e.size*TILE);
      ctx.fillRect(e.x*TILE-s*0.5,e.y*TILE-s*0.5,s,s);
    }
    ctx.restore();
    for(const d of debris){
      if(!tileVisible(d.x,d.y)) continue;
      const alpha=1-d.life/d.max;
      ctx.save();
      ctx.translate(d.x*TILE,d.y*TILE);
      ctx.rotate(d.rot||0);
      if(d.hot){
        ctx.globalCompositeOperation='lighter';
        ctx.fillStyle='rgba(255,96,24,'+(0.35*alpha)+')';
        ctx.fillRect(-TILE*0.20,-TILE*0.16,TILE*0.40,TILE*0.32);
        ctx.globalCompositeOperation='source-over';
      }
      ctx.fillStyle='rgba(58,50,46,'+(0.92*alpha)+')';
      ctx.fillRect(-TILE*0.18,-TILE*0.15,TILE*0.36,TILE*0.30);
      ctx.fillStyle='rgba(230,206,150,'+(0.32*alpha)+')';
      ctx.fillRect(-TILE*0.15,-TILE*0.13,TILE*0.12,TILE*0.05);
      ctx.restore();
    }
    for(const m of meteors){
      if(!tileVisible(m.x,m.y) && !tileVisible(m.target.x,m.target.y)) continue;
      drawMeteor(ctx,TILE,m);
    }
    ctx.restore();
  }
  function drawScreen(ctx,W,H){
    if(!(screenFlash>0)) return;
    const a=Math.min(0.54,screenFlash*0.38);
    ctx.save();
    ctx.globalCompositeOperation='screen';
    const g=ctx.createRadialGradient(W*0.5,H*0.36,1,W*0.5,H*0.36,Math.max(W,H)*0.78);
    g.addColorStop(0,'rgba(255,245,205,'+a+')');
    g.addColorStop(0.35,'rgba(255,127,38,'+(a*0.42)+')');
    g.addColorStop(1,'rgba(255,60,0,0)');
    ctx.fillStyle=g;
    ctx.fillRect(0,0,W,H);
    ctx.restore();
  }
  function clearActive(){
    meteors.length=0;
    embers.length=0;
    debris.length=0;
    plumes.length=0;
    shockwaves.length=0;
    scorches.length=0;
    beaconWaves.length=0;
    gravityBursts.length=0;
    screenFlash=0;
    lastImpact=null;
    lastDeflection=null;
    shakeT=0;
    shakeMax=0;
    shakeAmp=0;
  }
  function setEnabled(value){
    enabled=value===true;
    if(!(nextIn>0)) rollNext();
    if(!enabled) clearActive();
    saveSettings();
    return true;
  }
  function rollSchedule(){
    rollNext();
    saveSettings();
    return true;
  }
  function snapshot(){
    return {v:2,enabled,nextIn:+Math.max(0,nextIn).toFixed(2),spawned,impacts,deflections};
  }
  function restore(data){
    clearActive();
    terrainJobs.length=0;
    if(data && typeof data==='object'){
      enabled=data.enabled===true;
      nextIn=loadedNextIn(data);
      spawned=Math.max(0,(data.spawned|0)||0);
      impacts=Math.max(0,(data.impacts|0)||0);
      deflections=Math.max(0,(data.deflections|0)||0);
    }
    if(!(nextIn>0)) rollNext();
    saveSettings();
    return true;
  }
  function reset(){
    clearActive();
    terrainJobs.length=0;
    rollNext();
    saveSettings();
  }
  function metrics(){
    let queued=0;
    for(const j of terrainJobs) queued+=Math.max(0,j.ops.length-j.i);
    return {
      enabled,
      nextIn:+Math.max(0,nextIn).toFixed(1),
      nextInDays:+(Math.max(0,nextIn)/DAY_SECONDS).toFixed(2),
      minWaitDays:MIN_WAIT_DAYS,
      maxWaitDays:MAX_WAIT_DAYS,
      meteors:meteors.length,
      terrainJobs:terrainJobs.length,
      queuedOps:queued,
      embers:embers.length,
      debris:debris.length,
      plumes:plumes.length,
      beaconWaves:beaconWaves.length,
      gravityBursts:gravityBursts.length,
      impacts,
      deflections,
      spawned,
      shake:+Math.max(0,shakeT).toFixed(2),
      lastImpact,
      lastDeflection
    };
  }
  function isChunkBusy(cx){
    if(!Number.isFinite(cx)) return false;
    for(const job of terrainJobs){
      if(job && job.chunks && job.chunks.has(cx)) return true;
    }
    return false;
  }

  const api={
    update,
    draw,
    drawScreen,
    screenShakeOffset,
    forceSpawn,
    setEnabled,
    rollSchedule,
    reset,
    clearActive,
    snapshot,
    restore,
    metrics,
    isChunkBusy,
    _debug:{impactAt,queueCrater,applyTerrainJobs,pickTarget,nearestBeacon,meteors,terrainJobs,embers,debris,plumes,beaconWaves,gravityBursts,shockwaves,scorches}
  };
  MM.meteorites=api;
  return api;
})();

export { meteorites };
export default meteorites;
