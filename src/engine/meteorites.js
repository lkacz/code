import { CHUNK_W, T, INFO, WORLD_H, WORLD_MAX_Y } from '../constants.js';
import { isGasTile, isMeteorForestSiteTile, isMeteorImpactGroundTile, isMeteorLifeSiteTile, isMeteorProtectedTile, isMeteorSettlementSiteTile, isMeteorWaterSiteTile } from './material_physics.js';
import { worldHostility as HOSTILITY } from './world_hostility.js';
import { damageBlastCreatures } from './explosion_damage.js';

const meteorites = (function(){
  const MM = window.MM = window.MM || {};
  const STORE_KEY = 'mm_meteorites_v1';
  const DAY_SECONDS = 600;
  const MIN_WAIT_DAYS = 7;
  const MAX_WAIT_DAYS = 10;
  const MIN_WAIT = DAY_SECONDS * MIN_WAIT_DAYS;
  const MAX_WAIT = DAY_SECONDS * MAX_WAIT_DAYS;
  // Hard floor on the scheduled wait, even after the hostility frequency mult shortens it.
  const MIN_SCHEDULE_DAYS = 1.75;
  const MAX_METEORS = 2;
  const MAX_EMBERS = 140;
  const MAX_DEBRIS = 60;
  const MAX_PLUMES = 34;
  const MAX_BEACON_WAVES = 8;
  const MAX_GRAVITY_BURSTS = 6;
  const MAX_SIREN_PULSES = 12;
  const MAX_CRATER_RECORDS = 96;
  const MAX_IMPACT_CONSEQUENCES = 48;
  const GRAVITY = 7.5;
  const BEACON_SCAN_RADIUS = 44;
  const BEACON_FIELD_RADIUS = 34;
  const BEACON_DEFLECT_RADIUS = 18;
  const BEACON_HARD_DEFLECT_RADIUS = 10;
  const BEACON_SCAN_INTERVAL = 0.12;
  const BEACON_EMPTY_SCAN_INTERVAL = 0.75;
  const BEACON_BOUNCE_MIN_DISTANCE = 60;
  const BEACON_BOUNCE_MAX_DISTANCE = 96;
  const BEACON_BOUNCE_CLEARANCE = 48;
  const MAX_BEACON_DEFLECTIONS_PER_METEOR = 4;
  const BASE_TERRAIN_BUDGET = 8;
  const STRESSED_TERRAIN_BUDGET = 4;
  const SIREN_SCAN_RADIUS = 70;
  const SIREN_ALERT_RADIUS = 58;
  const CRATER_LAKE_STEP_CAP = 2;
  const CRATER_ECOLOGY_CHECKS_PER_SECOND = 4;
  const CRATER_ECOLOGY_MAX_BATCH = 2;
  const CRATER_ECOLOGY_INTERVAL = 6.0;
  const STRESSED_FRAME_MS = 22;
  const CRITICAL_FRAME_MS = 30;
  const METEOR_WATER_WAKE_CAP = 22;
  const METEOR_FALLING_WAKE_CAP = 96;
  const METEOR_SMOKE_WAKE_CAP = 18;
  const METEOR_SPLASH_WAKE_CAP = 18;

  const meteors = [];
  const terrainJobs = [];
  const embers = [];
  const debris = [];
  const plumes = [];
  const shockwaves = [];
  const scorches = [];
  const beaconWaves = [];
  const gravityBursts = [];
  const sirenPulses = [];
  const craterRecords = [];
  const impactConsequences = [];
  const plumeSprites = new Map();
  const beaconIndex = new Map();
  const sirenIndex = new Map();
  let enabled = false;
  let nextIn = 0;
  let spawned = 0;
  let impacts = 0;
  let deflections = 0;
  let sirenAlerts = 0;
  let craterLakeOps = 0;
  let craterEcologyOps = 0;
  let meteorMutations = 0;
  let lakeCursor = 0;
  let ecologyCursor = 0;
  let ecologyBudgetAcc = 0;
  let ecologyTime = 0;
  let lastDeflection = null;
  let lastSirenAlert = null;
  let lastScan = null;
  let lastConsequence = null;
  let screenFlash = 0;
  let lastImpact = null;
  let shakeT = 0;
  let shakeMax = 0;
  let shakeAmp = 0;
  let shakeSeed = 0;
  const classCounts = {iron:0, iridium:0, ice:0, radioactive:0, antimatter:0, biological:0};
  const consequenceCounts = {settlement:0, forest:0, lake:0, meadow:0, wildlands:0};
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const METEOR_CLASSES = {
    iron:{id:'iron',label:'zelazny',weight:38,intensityMult:1.00,craterScale:1.00,lakeRate:1.0,ember:'iron',trailOuter:'rgba(255,110,26,',trailInner:'rgba(255,232,120,',glow1:'rgba(255,255,236,0.95)',glow2:'rgba(255,216,91,0.86)',glow3:'rgba(255,78,22,0.42)',body:'#fff7c9',core:'#ff6a21',deposits:[{tile:T.METEORIC_IRON,count:2},{tile:T.COAL,count:1},{tile:T.OBSIDIAN,count:1,chance:0.55}]},
    iridium:{id:'iridium',label:'irydowy',weight:16,intensityMult:1.07,craterScale:1.05,lakeRate:1.0,ember:'iridium',trailOuter:'rgba(184,215,255,',trailInner:'rgba(238,250,255,',glow1:'rgba(244,250,255,0.98)',glow2:'rgba(184,215,255,0.84)',glow3:'rgba(90,130,255,0.38)',body:'#f4fbff',core:'#b8d7ff',deposits:[{tile:T.IRIDIUM,count:2},{tile:T.METEORIC_IRON,count:1},{tile:T.COAL,count:1}]},
    ice:{id:'ice',label:'lodowy',weight:13,intensityMult:0.88,craterScale:0.92,lakeRate:1.75,ember:'ice',trailOuter:'rgba(122,210,255,',trailInner:'rgba(232,252,255,',glow1:'rgba(250,255,255,0.96)',glow2:'rgba(157,238,255,0.76)',glow3:'rgba(58,150,255,0.32)',body:'#effdff',core:'#8fd6ff',deposits:[{tile:T.ICE,count:3},{tile:T.SNOW,count:2},{tile:T.METEOR_DUST,count:1,chance:0.50}]},
    radioactive:{id:'radioactive',label:'radioaktywny',weight:11,intensityMult:1.02,craterScale:1.02,lakeRate:0.85,ember:'radioactive',trailOuter:'rgba(108,255,78,',trailInner:'rgba(230,255,142,',glow1:'rgba(245,255,213,0.96)',glow2:'rgba(138,255,79,0.78)',glow3:'rgba(50,190,43,0.34)',body:'#f3ffd4',core:'#8aff4f',deposits:[{tile:T.RADIOACTIVE_ORE,count:2},{tile:T.METEOR_DUST,count:2},{tile:T.METEORIC_IRON,count:1}]},
    antimatter:{id:'antimatter',label:'antymaterialny',weight:5,intensityMult:1.20,craterScale:1.16,lakeRate:0.70,ember:'antimatter',trailOuter:'rgba(204,92,255,',trailInner:'rgba(124,247,255,',glow1:'rgba(255,242,255,0.98)',glow2:'rgba(211,107,255,0.84)',glow3:'rgba(74,247,255,0.36)',body:'#fff2ff',core:'#d36bff',deposits:[{tile:T.ANTIMATTER_CRYSTAL,count:1},{tile:T.IRIDIUM,count:1},{tile:T.OBSIDIAN,count:2}]},
    biological:{id:'biological',label:'biologiczny',weight:9,intensityMult:0.96,craterScale:0.98,lakeRate:1.20,ember:'biological',trailOuter:'rgba(111,224,91,',trailInner:'rgba(255,190,122,',glow1:'rgba(244,255,217,0.95)',glow2:'rgba(121,201,93,0.78)',glow3:'rgba(255,101,131,0.28)',body:'#ecffd9',core:'#79c95d',deposits:[{tile:T.ALIEN_BIOMASS,count:3},{tile:T.METEOR_DUST,count:2},{tile:T.COAL,count:1}]}
  };
  const METEOR_CLASS_IDS = Object.keys(METEOR_CLASSES);

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
  function rand(a,b){ return a + Math.random()*(b-a); }
  function frameMs(){
    return (typeof window !== 'undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
  }
  function perfTier(){
    const ms=frameMs();
    return ms>CRITICAL_FRAME_MS ? 2 : (ms>STRESSED_FRAME_MS ? 1 : 0);
  }
  function playerX(fallback){
    const p = typeof window !== 'undefined' ? window.player : null;
    return p && Number.isFinite(p.x) ? p.x : fallback;
  }
  function rollNext(anchorX){
    const h=HOSTILITY.at(Number.isFinite(anchorX) ? anchorX : playerX(0));
    const raw=rand(MIN_WAIT, MAX_WAIT) / Math.max(1, h.meteorFrequencyMult || 1);
    nextIn = clamp(raw, DAY_SECONDS * MIN_SCHEDULE_DAYS, MAX_WAIT);
  }
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

  function classProfile(id){
    if(id && METEOR_CLASSES[id]) return METEOR_CLASSES[id];
    return METEOR_CLASSES.iron;
  }
  function ecologyKindForProfile(profile){
    profile=classProfile(profile && profile.id);
    if(profile.id==='radioactive') return 'glow';
    if(profile.id==='biological') return 'alien';
    if(profile.id==='ice') return 'lake';
    if(profile.id==='antimatter') return 'steam';
    return 'mineral';
  }
  function ecologyLabel(kind){
    if(kind==='glow') return 'radioaktywne pole';
    if(kind==='alien') return 'obca flora';
    if(kind==='lake') return 'miska jeziorna';
    if(kind==='steam') return 'kominy parowe';
    return 'mineralny szyb';
  }
  function makeCraterEcology(profile,raw){
    raw=raw||{};
    const kind=['glow','alien','lake','steam','mineral'].includes(raw.kind || raw.k) ? (raw.kind || raw.k) : ecologyKindForProfile(profile);
    return {
      kind,
      cursor:Math.max(0,(raw.cursor==null ? raw.c : raw.cursor)|0),
      t:Math.max(0,Number(raw.t)||0),
      stage:Math.max(0,(raw.stage==null ? raw.s : raw.stage)|0),
      plants:Math.max(0,(raw.plants==null ? raw.p : raw.plants)|0),
      minerals:Math.max(0,(raw.minerals==null ? raw.m : raw.minerals)|0),
      vents:Math.max(0,(raw.vents==null ? raw.v : raw.vents)|0),
      glow:Math.max(0,(raw.glow==null ? raw.g : raw.glow)|0),
      last:Number.isFinite(raw.last) ? raw.last : ecologyTime
    };
  }
  function packCraterEcology(eco){
    if(!eco) return null;
    return {
      k:eco.kind,
      c:eco.cursor|0,
      t:+Math.max(0,eco.t||0).toFixed(2),
      s:eco.stage|0,
      p:eco.plants|0,
      m:eco.minerals|0,
      v:eco.vents|0,
      g:eco.glow|0
    };
  }
  function craterEcologyScore(eco){
    if(!eco) return 0;
    return Math.max(0,(eco.stage|0)+(eco.plants|0)+(eco.minerals|0)+(eco.vents|0)+(eco.glow|0));
  }
  function activeEcologyCraters(){
    let n=0;
    for(const c of craterRecords) if(c && craterEcologyScore(c.ecology)>0) n++;
    return n;
  }
  function craterEcologyDrawQuality(){
    const tier=perfTier();
    const active=activeEcologyCraters();
    if(tier>=2 || active>48) return 0;
    if(tier>=1 || active>24) return 1;
    return 2;
  }
  function craterEcologyDrawCap(quality){
    return quality<=0 ? 4 : (quality===1 ? 10 : 18);
  }
  function classWeightsAt(x){
    const out={};
    for(const k of METEOR_CLASS_IDS){
      const base=METEOR_CLASSES[k].weight||1;
      out[k]=base * HOSTILITY.meteorClassWeightMult(k, x);
    }
    return out;
  }
  function classFromOpts(opts,x){
    opts=opts||{};
    const id=opts.classId || opts.kind || opts.type || opts.meteorClass;
    if(id && METEOR_CLASSES[id]) return METEOR_CLASSES[id];
    let total=0;
    const weights=classWeightsAt(x);
    for(const k of METEOR_CLASS_IDS) total+=weights[k]||1;
    let r=Math.random()*Math.max(1,total);
    for(const k of METEOR_CLASS_IDS){
      r-=weights[k]||1;
      if(r<=0) return METEOR_CLASSES[k];
    }
    return METEOR_CLASSES.iron;
  }
  function classCountBump(profile){
    if(!profile) return;
    if(classCounts[profile.id]==null) classCounts[profile.id]=0;
    classCounts[profile.id]++;
  }
  function copyClassCounts(){
    return Object.assign({}, classCounts);
  }
  function resetClassCounts(src){
    for(const k of METEOR_CLASS_IDS) classCounts[k]=0;
    if(!src || typeof src!=='object') return;
    for(const k of METEOR_CLASS_IDS) classCounts[k]=Math.max(0,(src[k]|0)||0);
  }
  function copyConsequenceCounts(){
    return Object.assign({}, consequenceCounts);
  }
  function resetConsequenceCounts(src){
    for(const k in consequenceCounts) consequenceCounts[k]=0;
    if(!src || typeof src!=='object') return;
    for(const k in consequenceCounts) consequenceCounts[k]=Math.max(0,(src[k]|0)||0);
  }
  function tileInfo(t){ return INFO[t] || INFO[T.AIR]; }
  function isGas(t){ return isGasTile(t); }
  function meteorGroundTile(t){
    return isMeteorImpactGroundTile(t);
  }
  function protectedTile(t){
    return isMeteorProtectedTile(t);
  }
  function meteorShattersTile(t){
    if(t===T.AIR || t===T.WATER || t===T.LAVA || isGas(t)) return false;
    if(protectedTile(t) || meteorGroundTile(t)) return false;
    return true;
  }
  function hotTileForFloor(old,edge,central,profile){
    profile=classProfile(profile && profile.id);
    if(profile.id==='ice'){
      if(central) return T.ICE;
      if(old===T.SAND && edge<0.28) return T.GLASS;
      return edge<0.62 ? T.ICE : T.SNOW;
    }
    if(profile.id==='radioactive' && (central || edge<0.22)) return T.RADIOACTIVE_ORE;
    if(profile.id==='biological' && (central || edge<0.34)) return T.ALIEN_BIOMASS;
    if(profile.id==='antimatter' && central) return Math.random()<0.72 ? T.ANTIMATTER_CRYSTAL : T.LAVA;
    if(central) return T.LAVA;
    if(old===T.SAND) return T.GLASS;
    if(edge<0.46) return Math.random()<0.72 ? T.OBSIDIAN : T.METEORIC_IRON;
    if(old===T.STONE || old===T.GRANITE || old===T.BASALT || old===T.BEDROCK || old===T.COAL || old===T.STEEL || old===T.METEORIC_IRON || old===T.OBSIDIAN) return Math.random()<0.90 ? T.OBSIDIAN : T.STONE;
    return Math.random()<0.82 ? T.OBSIDIAN : T.STONE;
  }
  function meteorCoreTile(profile){
    profile=classProfile(profile && profile.id);
    if(profile.id==='iridium') return Math.random()<0.70 ? T.IRIDIUM : T.METEORIC_IRON;
    if(profile.id==='ice') return Math.random()<0.70 ? T.ICE : T.SNOW;
    if(profile.id==='radioactive') return Math.random()<0.70 ? T.RADIOACTIVE_ORE : T.METEOR_DUST;
    if(profile.id==='antimatter') return Math.random()<0.68 ? T.ANTIMATTER_CRYSTAL : T.IRIDIUM;
    if(profile.id==='biological') return Math.random()<0.72 ? T.ALIEN_BIOMASS : T.METEOR_DUST;
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
  function beaconAtTile(x,y){
    x=Math.floor(x); y=Math.floor(y);
    return {x:x+0.5,y:y+0.5,tx:x,ty:y};
  }
  function sirenAtTile(x,y){
    x=Math.floor(x); y=Math.floor(y);
    return {x:x+0.5,y:y+0.5,tx:x,ty:y};
  }
  function onTileChanged(x,y,oldTile,newTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const k=x+','+y;
    if(newTile===T.ANTIGRAVITY_BEACON){
      beaconIndex.set(k,beaconAtTile(x,y));
      return true;
    }
    if(newTile===T.METEOR_SIREN){
      sirenIndex.set(k,sirenAtTile(x,y));
      return true;
    }
    if(oldTile===T.ANTIGRAVITY_BEACON || beaconIndex.has(k)){
      beaconIndex.delete(k);
      return true;
    }
    if(oldTile===T.METEOR_SIREN || sirenIndex.has(k)){
      sirenIndex.delete(k);
      return true;
    }
    return false;
  }
  function nearestIndexedBeacon(cx,cy,getTile,radius,excluded){
    if(!beaconIndex.size || typeof getTile!=='function') return null;
    const r2=radius*radius;
    let best=null;
    let bestD2=r2+1;
    const stale=[];
    for(const [k,b] of beaconIndex){
      if(excluded && excluded.has(k)) continue;
      if(readTile(getTile,b.tx,b.ty)!==T.ANTIGRAVITY_BEACON){
        stale.push(k);
        continue;
      }
      const dx=b.x-cx, dy=b.y-cy;
      const d2=dx*dx+dy*dy;
      if(d2<bestD2){
        bestD2=d2;
        best=b;
      }
    }
    for(const k of stale) beaconIndex.delete(k);
    if(!best) return null;
    return {x:best.x,y:best.y,tx:best.tx,ty:best.ty,d2:bestD2,d:Math.sqrt(bestD2)};
  }
  function nearestBeacon(cx,cy,getTile,radius,opts){
    if(typeof getTile!=='function' || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    opts=opts||{};
    const excluded=opts.exclude ? new Set(opts.exclude) : null;
    const r=clamp(Number(radius)||BEACON_SCAN_RADIUS,1,BEACON_SCAN_RADIUS);
    const indexed=nearestIndexedBeacon(cx,cy,getTile,r,excluded);
    if(indexed) return indexed;
    const minX=Math.floor(cx-r);
    const maxX=Math.ceil(cx+r);
    const minY=Math.max(1,Math.floor(cy-r));
    const maxY=Math.min(WORLD_BOTTOM-4,Math.ceil(cy+r));
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
        onTileChanged(x,y,T.AIR,T.ANTIGRAVITY_BEACON);
      }
    }
    return best;
  }
  function nearestIndexedSiren(cx,cy,getTile,radius){
    if(!sirenIndex.size || typeof getTile!=='function') return null;
    const r2=radius*radius;
    let best=null;
    let bestD2=r2+1;
    const stale=[];
    for(const [k,s] of sirenIndex){
      if(readTile(getTile,s.tx,s.ty)!==T.METEOR_SIREN){
        stale.push(k);
        continue;
      }
      const dx=s.x-cx, dy=s.y-cy;
      const d2=dx*dx+dy*dy;
      if(d2<bestD2){
        bestD2=d2;
        best=s;
      }
    }
    for(const k of stale) sirenIndex.delete(k);
    if(!best) return null;
    return {x:best.x,y:best.y,tx:best.tx,ty:best.ty,d2:bestD2,d:Math.sqrt(bestD2)};
  }
  function nearestSiren(cx,cy,getTile,radius){
    if(typeof getTile!=='function' || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const r=clamp(Number(radius)||SIREN_SCAN_RADIUS,1,SIREN_SCAN_RADIUS);
    const indexed=nearestIndexedSiren(cx,cy,getTile,r);
    if(indexed) return indexed;
    const minX=Math.floor(cx-r);
    const maxX=Math.ceil(cx+r);
    const minY=Math.max(1,Math.floor(cy-r));
    const maxY=Math.min(WORLD_BOTTOM-4,Math.ceil(cy+r));
    let best=null;
    let bestD2=r*r+1;
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        if(readTile(getTile,x,y)!==T.METEOR_SIREN) continue;
        const sx=x+0.5, sy=y+0.5;
        const dx=sx-cx, dy=sy-cy;
        const d2=dx*dx+dy*dy;
        if(d2<bestD2){
          bestD2=d2;
          best={x:sx,y:sy,tx:x,ty:y,d2,d:Math.sqrt(d2)};
        }
        onTileChanged(x,y,T.AIR,T.METEOR_SIREN);
      }
    }
    return best;
  }
  function queueSirenPulse(s,m){
    if(!s) return;
    pushCapped(sirenPulses,{
      x:s.x,
      y:s.y,
      mx:m && Number.isFinite(m.x) ? m.x : null,
      my:m && Number.isFinite(m.y) ? m.y : null,
      life:0,
      max:1.15,
      phase:Math.random()*Math.PI*2
    },MAX_SIREN_PULSES);
  }
  function alertSirenForMeteor(m,getTile){
    if(!m || m.sirenAlerted) return false;
    const target=m.target || {x:m.x,y:m.y};
    const s=nearestSiren(target.x,target.y,getTile,SIREN_SCAN_RADIUS);
    if(!s || s.d>SIREN_ALERT_RADIUS) return false;
    m.sirenAlerted=true;
    sirenAlerts++;
    lastSirenAlert={
      x:+s.x.toFixed(2),
      y:+s.y.toFixed(2),
      targetX:+target.x.toFixed(2),
      targetY:+target.y.toFixed(2),
      classId:m.classId || 'iron',
      d:+s.d.toFixed(2),
      t:0
    };
    queueSirenPulse(s,m);
    screenFlash=Math.max(screenFlash,0.20);
    try{ if(typeof window.msg==='function') window.msg('Syrena meteorytowa: wykryto meteoryt '+(classProfile(m.classId).label||'')); }catch(e){}
    try{ if(MM.audio && MM.audio.play && (!MM.audio.isReady || MM.audio.isReady())) MM.audio.play('alarm',{x:s.x,y:s.y}); }catch(e){}
    return true;
  }
  function surfaceNear(x,guessY,getTile){
    const wg=MM.worldGen;
    let center=Number.isFinite(guessY) ? Math.round(guessY) : null;
    if(center==null){
      try{ if(wg && wg.surfaceHeight) center=wg.surfaceHeight(Math.round(x)); }catch(e){ center=null; }
    }
    if(center==null || !Number.isFinite(center)) center=62;
    const from=Math.max(1,center-18);
    const to=Math.min(WORLD_BOTTOM-4,center+24);
    for(let y=from; y<=to; y++){
      const t=readTile(getTile,x,y);
      if(meteorGroundTile(t) || t===T.LAVA) return y;
    }
    for(let y=1; y<WORLD_BOTTOM-3; y++){
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
    center=clamp(Math.round(center),2,WORLD_BOTTOM-5);
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
      if(down<WORLD_BOTTOM-3 && solidAt(down)) return down;
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
      return {x:Math.round(opts.x), y:clamp(Math.round(opts.y),2,WORLD_BOTTOM-5)};
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
    const profile=classProfile(m && m.classId);
    const hue=profile.ember==='iron' ? (Math.random()<0.22?'white':(Math.random()<0.55?'gold':'orange')) : profile.ember;
    pushCapped(embers,{
      x:m.x+side,
      y:m.y+side*0.25,
      vx:-m.vx*0.06+(Math.random()-0.5)*3.2,
      vy:-m.vy*0.04+(Math.random()-0.5)*2.2,
      life:0,
      max:0.38+Math.random()*0.48,
      size:0.06+Math.random()*0.10,
      hue
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
  function playReadyAudio(name,opts){
    try{
      if(MM.audio && MM.audio.play && MM.audio.isReady && MM.audio.isReady()) MM.audio.play(name,opts);
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
  function triggerAntimatterBurst(x,y,intensity){
    if(!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const power=Math.max(0.5,Number(intensity)||1);
    queueGravityBurst({x,y},{intensity:power});
    screenFlash=Math.max(screenFlash,1.05);
    startShake(0.38+power*0.08,5.5+power*2.3);
    const stress=frameMs()>30;
    const n=stress ? 8 : 18;
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2;
      const sp=rand(1.8,7.2)*(0.85+power*0.12);
      pushCapped(embers,{
        x:x+rand(-0.22,0.22),
        y:y+rand(-0.22,0.22),
        vx:Math.cos(a)*sp,
        vy:Math.sin(a)*sp-rand(0.4,2.2),
        life:0,
        max:rand(0.35,0.95),
        size:rand(0.05,0.13),
        hue:Math.random()<0.55?'antimatter':'ice'
      },MAX_EMBERS);
    }
    try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(x*(MM.TILE||20),y*(MM.TILE||20),'rare',12); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('beam',{x,y}); }catch(e){}
    return true;
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
    playReadyAudio('charge',{x:b.x,y:b.y});
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
    return {x:fallbackX,y:clamp(fallbackY==null ? Math.round(b.y) : fallbackY,2,WORLD_BOTTOM-6)};
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
    if(b && readTile(getTile,b.tx,b.ty)!==T.ANTIGRAVITY_BEACON){
      b=null;
      m.cachedBeacon=null;
      m.beaconScanT=0;
    }
    if(m.beaconScanT<=0){
      const exclude=m.usedBeaconKeys||[];
      const target=m.target || {x:m.x,y:m.y};
      const targetBeacon=nearestBeacon(target.x,target.y,getTile,BEACON_SCAN_RADIUS,{exclude});
      const currentBeacon=nearestBeacon(m.x,m.y,getTile,BEACON_FIELD_RADIUS,{exclude});
      b=currentBeacon || targetBeacon;
      m.cachedBeacon=b;
      m.beaconScanT=b ? BEACON_SCAN_INTERVAL : BEACON_EMPTY_SCAN_INTERVAL;
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
  function createTerrainChangeBatch(cx,cy,intensity){
    return {x:cx,y:cy,intensity:intensity||1,removed:[],placed:[],water:[],smoke:[],splash:[],ufoConcrete:0};
  }
  function addMeteorUfoConcrete(count){
    const n=Math.max(0,Math.floor(Number(count)||0));
    if(!n) return false;
    const inv=(typeof window!=='undefined' && window.inv) ? window.inv : null;
    if(!inv) return false;
    if(typeof inv.ufoConcrete!=='number') inv.ufoConcrete=0;
    inv.ufoConcrete+=n;
    try{ if(typeof window.updateInventoryHud==='function') window.updateInventoryHud(); }catch(e){}
    try{
      if(typeof window.dispatchEvent==='function' && typeof CustomEvent!=='undefined'){
        window.dispatchEvent(new CustomEvent('mm-resources-change',{detail:{key:'ufoConcrete',gained:n,source:'meteor'}}));
      }
    }catch(e){}
    markWorldChanged();
    return true;
  }
  function pushCell(list,x,y){
    if(!list || !Number.isFinite(x) || !Number.isFinite(y)) return;
    list.push({x:Math.floor(x),y:Math.floor(y)});
  }
  function selectBatchWakeCells(cells,cap){
    if(!Array.isArray(cells) || !cells.length || !(cap>0)) return [];
    const byX=new Map();
    for(const c of cells){
      if(!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const x=Math.floor(c.x), y=Math.floor(c.y);
      let rec=byX.get(x);
      if(!rec){ rec={x,minY:y,maxY:y}; byX.set(x,rec); }
      else {
        if(y<rec.minY) rec.minY=y;
        if(y>rec.maxY) rec.maxY=y;
      }
    }
    const xs=[...byX.keys()].sort((a,b)=>a-b);
    if(!xs.length) return [];
    const out=[];
    const used=new Set();
    const add=(x,y)=>{
      if(out.length>=cap || !Number.isFinite(y)) return;
      const k=x+','+y;
      if(used.has(k)) return;
      used.add(k);
      out.push({x,y});
    };
    const stride=Math.max(1,Math.ceil(xs.length/Math.max(1,Math.floor(cap*0.5))));
    for(let offset=0; offset<stride && out.length<cap; offset++){
      for(let i=offset; i<xs.length && out.length<cap; i+=stride){
        const rec=byX.get(xs[i]);
        add(rec.x,rec.minY);
        add(rec.x,rec.maxY);
      }
    }
    return out;
  }
  function flushTerrainChangeBatch(batch,getTile,setTile){
    if(!batch) return;
    try{
      const f=MM.fallingSolids;
      if(f && typeof f.onTilesChangedBatch==='function') f.onTilesChangedBatch(batch.removed,batch.placed,{source:'meteor',x:batch.x,y:batch.y,wakeCap:METEOR_FALLING_WAKE_CAP});
      else if(f){
        for(const c of selectBatchWakeCells(batch.removed,METEOR_FALLING_WAKE_CAP)) if(f.onTileRemoved) f.onTileRemoved(c.x,c.y);
        for(const c of selectBatchWakeCells(batch.placed,METEOR_FALLING_WAKE_CAP)) if(f.afterPlacement) f.afterPlacement(c.x,c.y);
      }
    }catch(e){}
    try{
      const w=MM.water;
      if(w && typeof w.onTilesChangedBatch==='function') w.onTilesChangedBatch(batch.water,getTile,{source:'meteor',x:batch.x,y:batch.y,cap:METEOR_WATER_WAKE_CAP});
      else if(w && w.onTileChanged){
        for(const c of selectBatchWakeCells(batch.water,METEOR_WATER_WAKE_CAP)) w.onTileChanged(c.x,c.y,getTile);
      }
    }catch(e){}
    for(const c of selectBatchWakeCells(batch.splash,METEOR_SPLASH_WAKE_CAP)) splashAt(c.x+0.5,c.y+0.5,0.8);
    for(const c of selectBatchWakeCells(batch.smoke,METEOR_SMOKE_WAKE_CAP)) smokeAt(c.x+0.5,c.y+0.4,0.8);
    addMeteorUfoConcrete(batch.ufoConcrete);
  }
  function notifyTerrainChange(x,y,oldTile,newTile,getTile,setTile,batch){
    if(oldTile===newTile) return;
    if(batch){
      if(oldTile===T.UFO_CONCRETE) batch.ufoConcrete=(batch.ufoConcrete||0)+1;
      if(newTile===T.AIR) pushCell(batch.removed,x,y);
      else pushCell(batch.placed,x,y);
      pushCell(batch.water,x,y);
      if(oldTile===T.WATER || oldTile===T.ICE) pushCell(batch.splash,x,y);
      if(tileInfo(oldTile).flammable && newTile===T.AIR) pushCell(batch.smoke,x,y);
      try{
        if(newTile===T.LAVA && MM.fire && MM.fire.noteLava){
          MM.fire.noteLava(x,y,{priority:true,fast:true});
          if(MM.fire.heatAround) MM.fire.heatAround(x,y,getTile,setTile,{includeCenter:false});
        }
      }catch(e){}
      return;
    }
    if(oldTile===T.UFO_CONCRETE) addMeteorUfoConcrete(1);
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
    const profile=classProfile((opts.profile && opts.profile.id) || opts.classId || opts.kind || opts.type);
    const colossal=opts.colossal===true;
    const impactY=clamp(Math.round(Number.isFinite(opts.surfaceY)?opts.surfaceY:cy),2,WORLD_BOTTOM-6);
    const seed=Number.isFinite(opts.seed) ? +opts.seed : rand(1,1000000);
    const scale=clamp((Number(opts.scale)||rand(0.68,1.42))*(profile.craterScale||1),colossal?1.18:0.62,colossal?3.15:1.85);
    const baseRx=8.8+intensity*4.25;
    const leftRx=clamp(baseRx*scale*rand(0.82,1.30),colossal?18.0:10.5,colossal?46.0:24.5);
    const rightRx=clamp(baseRx*scale*rand(0.82,1.30),colossal?18.0:10.5,colossal?46.0:24.5);
    const ry=clamp((4.0+intensity*2.15)*rand(0.70,1.40),colossal?7.0:3.6,colossal?20.0:10.8);
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
      if(y<1 || y>=WORLD_BOTTOM-3 || !Number.isFinite(x)) return;
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
        depth=clamp(Math.floor(depth),1,colossal?22:12);
        const startY=Math.max(1,Math.floor(surface-1));
        const floorY=Math.min(WORLD_BOTTOM-4,Math.floor(surface+depth));
        for(let y=startY; y<=floorY; y++){
          addOp(0,x,y,T.AIR,Math.abs(dx)+(y-surface)*0.18,false);
        }
        const old=readTile(getTile,x,floorY);
        const central=edge<(0.14+hashUnit(seed+2.2,x)*0.10) && intensity>0.8;
        addOp(1,x,floorY,hotTileForFloor(old,edge,central,profile),Math.abs(dx),true);
        floorCells.push({x,floorY,edge,d:Math.abs(dx)});
        if(edge<0.52 && floorY+1<WORLD_BOTTOM-3){
          const mineral=hashUnit(seed+37.2,x*1.73+floorY*0.37);
          const t=edge<0.24 ? meteorCoreTile(profile) : (mineral<0.42 ? (profile.id==='ice'?T.ICE:T.METEORIC_IRON) : (mineral<0.68 ? (profile.id==='biological'?T.ALIEN_BIOMASS:T.COAL) : T.OBSIDIAN));
          addOp(1,x,floorY+1,t,Math.abs(dx)+0.7,true);
        }
      }
      if(edge>0.88 && edge<1.18){
        const rimRoll=hashUnit(seed+43.5,x*0.91);
        const rimY=Math.max(1,surface-1-(edge<1.04 && rimRoll<rimRaiseChance?1:0)+(rimRoll>0.90?1:0));
        addOp(1,x,rimY,rimRoll<0.74?T.OBSIDIAN:T.STONE,Math.abs(dx)+2,true);
        if(edge<1.07 && hashUnit(seed+47.8,x)>0.72){
          addOp(1,x,Math.min(WORLD_BOTTOM-4,rimY+1),hashUnit(seed+48.5,x)<0.62?T.STONE:T.OBSIDIAN,Math.abs(dx)+2.4,true);
        }
      }
    }
    floorCells.sort((a,b)=>a.d-b.d || a.floorY-b.floorY);
    const core=floorCells[0] || {x:Math.floor(cx),floorY:clamp(impactY+Math.round(ry),2,WORLD_BOTTOM-4),d:0};
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
        if(y>=WORLD_BOTTOM-3) continue;
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
    for(const dep of profile.deposits || []){
      if(!dep || dep.tile==null) continue;
      const count=Math.max(1,dep.count|0);
      for(let i=0;i<count;i++){
        if(dep.chance!=null && hashUnit(seed+70.3+i,dep.tile*1.7+i)>dep.chance) continue;
        const offset=1+((i + Math.round(hashUnit(seed+71.9,dep.tile+i)))%3);
        addDeposit(dep.tile,offset,0.18+i*0.06);
      }
    }
    ops.sort((a,b)=>a.phase-b.phase || a.d-b.d);
    return ops;
  }
  function applyCraterOp(op,getTile,setTile,batch){
    if(!op || op.y<1 || op.y>=WORLD_BOTTOM-3 || !Number.isFinite(op.x)) return false;
    const old=readTile(getTile,op.x,op.y);
    if(old===op.t) return false;
    if(protectedTile(old)) return false;
    if(op.phase===0 && old===T.AIR) return false;
    if(op.phase===1 && !op.place && op.t!==T.LAVA && old===T.AIR && Math.random()<0.72) return false;
    setTile(op.x,op.y,op.t);
    notifyTerrainChange(op.x,op.y,old,op.t,getTile,setTile,batch);
    return true;
  }
  function queueCrater(cx,cy,intensity,getTile,preparedOps,setTile,opts){
    opts=opts||{};
    const ops=Array.isArray(preparedOps) ? preparedOps : buildCraterOps(cx,cy,intensity,getTile,opts);
    if(opts.instant && typeof setTile==='function'){
      const batch=createTerrainChangeBatch(cx,cy,intensity);
      for(const op of ops) applyCraterOp(op,getTile,setTile,batch);
      flushTerrainChangeBatch(batch,getTile,setTile);
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
  function setTileNotified(x,y,t,getTile,setTile){
    if(typeof setTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    if(y<1 || y>=WORLD_BOTTOM-3) return false;
    const old=readTile(getTile,x,y);
    if(old===t || protectedTile(old)) return false;
    setTile(x,y,t);
    notifyTerrainChange(x,y,old,t,getTile,setTile);
    return true;
  }
  function impactSiteKind(cx,cy,getTile){
    let water=0, forest=0, built=0, life=0;
    for(let y=Math.floor(cy)-5; y<=Math.floor(cy)+7; y++){
      if(y<1 || y>=WORLD_BOTTOM-3) continue;
      for(let x=Math.floor(cx)-8; x<=Math.floor(cx)+8; x++){
        const t=readTile(getTile,x,y);
        if(isMeteorWaterSiteTile(t)) water++;
        if(isMeteorForestSiteTile(t)) forest++;
        if(isMeteorLifeSiteTile(t)) life++;
        if(isMeteorSettlementSiteTile(t)) built++;
      }
    }
    if(built>=5) return 'settlement';
    if(water>=12) return 'lake';
    if(forest>=10) return 'forest';
    if(life>=18) return 'meadow';
    return 'wildlands';
  }
  function consequenceMessage(site,profile){
    const label=(profile && profile.label) || 'meteoryt';
    if(site==='settlement') return 'Beacon ocalil baze, ale odbity '+label+' uderzyl w zabudowania.';
    if(site==='forest') return 'Beacon ocalil baze, ale odbity '+label+' zniszczyl fragment lasu.';
    if(site==='lake') return 'Beacon ocalil baze, ale odbity '+label+' skazil zbiornik wodny.';
    if(site==='meadow') return 'Beacon ocalil baze, ale odbity '+label+' zmienil zywa lake.';
    return 'Beacon ocalil baze: odbity '+label+' spadl w dziki teren.';
  }
  function consequenceSeverity(site){
    if(site==='settlement') return 4;
    if(site==='forest' || site==='lake') return 3;
    if(site==='meadow') return 2;
    return 1;
  }
  function recordImpactConsequence(cx,cy,profile,site,opts){
    opts=opts||{};
    if(!opts.deflected) return null;
    profile=classProfile(profile && profile.id);
    const key=consequenceCounts[site]!=null ? site : 'wildlands';
    consequenceCounts[key]++;
    const rec={
      x:+cx.toFixed(2),
      y:+cy.toFixed(2),
      classId:profile.id,
      label:profile.label,
      site:key,
      severity:consequenceSeverity(key),
      message:consequenceMessage(key,profile),
      t:0
    };
    pushCapped(impactConsequences,rec,MAX_IMPACT_CONSEQUENCES);
    lastConsequence=rec;
    try{ if(typeof window.msg==='function') window.msg(rec.message); }catch(e){}
    return rec;
  }
  function pushCraterRecord(cx,cy,intensity,profile,site,opts){
    opts=opts||{};
    const colossal=opts.colossal===true;
    const rScale=colossal ? 1.42 : 1;
    const r=clamp(Math.round((9.5+intensity*4.8)*(profile.craterScale||1)*rScale),colossal?24:8,colossal?58:30);
    pushCapped(craterRecords,{
      x:+cx.toFixed(2),
      y:+cy.toFixed(2),
      r,
      classId:profile.id,
      label:profile.label,
      site:site||'wildlands',
      redirected:!!opts.deflected,
      rain:0,
      water:0,
      filled:false,
      age:0,
      cursor:0,
      ecology:makeCraterEcology(profile)
    },MAX_CRATER_RECORDS);
    return craterRecords[craterRecords.length-1];
  }
  function surfaceScatterTile(tile,cx,cy,count,radius,getTile,setTile){
    let placed=0;
    const tries=Math.max(8,count*5);
    for(let i=0;i<tries && placed<count;i++){
      const x=Math.floor(cx+rand(-radius,radius));
      const surf=craterSurfaceNear(x,cy,getTile);
      if(surf==null) continue;
      const y=Math.max(1,surf-1);
      const cur=readTile(getTile,x,y);
      const below=readTile(getTile,x,y+1);
      if(cur!==T.AIR && !isGas(cur) && cur!==T.WATER) continue;
      if(below===T.AIR || isGas(below)) continue;
      if(setTileNotified(x,y,tile,getTile,setTile)) placed++;
    }
    return placed;
  }
  function freezeNearbyWater(cx,cy,intensity,getTile,setTile){
    let n=0;
    const r=Math.round(5+intensity*2);
    for(let y=Math.floor(cy)-5; y<=Math.floor(cy)+6; y++){
      if(y<1 || y>=WORLD_BOTTOM-3) continue;
      for(let x=Math.floor(cx)-r; x<=Math.floor(cx)+r; x++){
        if(Math.hypot(x+0.5-cx,y+0.5-cy)>r+1) continue;
        const t=readTile(getTile,x,y);
        if(t===T.WATER && setTileNotified(x,y,T.ICE,getTile,setTile)) n++;
        else if(t===T.LAVA && setTileNotified(x,y,T.OBSIDIAN,getTile,setTile)) n++;
      }
    }
    return n;
  }
  function seedMeteorPlants(cx,cy,intensity,getTile){
    let n=0;
    const types=['fern','berrybush','reed','sunflower'];
    if(!MM.plants || typeof MM.plants.sow!=='function') return 0;
    const attempts=8+Math.round(intensity*4);
    for(let i=0;i<attempts;i++){
      const x=Math.floor(cx+rand(-10,10));
      const type=types[(Math.random()*types.length)|0];
      try{ if(MM.plants.sow(type,x,getTile)) n++; }catch(e){}
    }
    return n;
  }
  function applyMeteorAftermath(cx,cy,intensity,profile,getTile,setTile,site,opts){
    opts=opts||{};
    profile=classProfile(profile && profile.id);
    const stress=frameMs()>30;
    const radius=clamp(8+intensity*4,8,opts.colossal===true?42:22);
    let changed=0;
    if(profile.id==='ice'){
      changed+=freezeNearbyWater(cx,cy,intensity,getTile,setTile);
      changed+=surfaceScatterTile(T.SNOW,cx,cy,stress?3:7,radius,getTile,setTile);
      try{ if(MM.gases && MM.gases.add) MM.gases.add('steam',cx,cy-0.6,{power:0.8+intensity*0.2,cells:5}); }catch(e){}
    } else if(profile.id==='radioactive'){
      changed+=surfaceScatterTile(T.METEOR_DUST,cx,cy,stress?4:9,radius,getTile,setTile);
      changed+=surfaceScatterTile(T.RADIOACTIVE_ORE,cx,cy,stress?2:4,radius*0.72,getTile,setTile);
      try{ if(MM.gases && MM.gases.add) MM.gases.add('poison',cx,cy-0.2,{power:1.5+intensity*0.38,cells:10}); }catch(e){}
      try{ if(MM.mobs && MM.mobs.poisonRadius) meteorMutations+=MM.mobs.poisonRadius(cx,cy,radius,{dur:10,dps:2}); }catch(e){}
      meteorMutations+=changed;
    } else if(profile.id==='antimatter'){
      changed+=surfaceScatterTile(T.METEOR_DUST,cx,cy,stress?3:6,radius,getTile,setTile);
      queueGravityBurst({x:cx,y:cy}, {intensity:intensity+1.0});
      screenFlash=Math.max(screenFlash,1.55);
    } else if(profile.id==='biological'){
      changed+=surfaceScatterTile(T.METEOR_DUST,cx,cy,stress?5:11,radius,getTile,setTile);
      changed+=surfaceScatterTile(T.ALIEN_BIOMASS,cx,cy,stress?3:7,radius*0.82,getTile,setTile);
      meteorMutations+=changed + seedMeteorPlants(cx,cy,intensity,getTile);
    } else if(profile.id==='iridium'){
      changed+=surfaceScatterTile(T.METEOR_DUST,cx,cy,stress?1:3,radius*0.70,getTile,setTile);
    }
    if(changed>0) markWorldChanged();
    return changed;
  }
  function craterRainActive(c){
    try{ return !!(MM.clouds && MM.clouds.isRainingAt && MM.clouds.isRainingAt(c.x)); }catch(e){ return false; }
  }
  function fillCraterLakeCell(c,getTile,setTile){
    if(!c || c.filled || typeof setTile!=='function') return false;
    const r=clamp(c.r|0,6,58);
    const cols=r*2+1;
    const yMin=Math.max(1,Math.floor(c.y)-1);
    const yMax=Math.min(WORLD_BOTTOM-4,Math.floor(c.y+Math.max(5,r*0.55)+4));
    const start=(c.cursor|0) % cols;
    for(let n=0;n<Math.min(cols,24);n++){
      const idx=(start+n)%cols;
      const dx=idx-r;
      const x=Math.floor(c.x+dx);
      if(Math.abs(dx)>r) continue;
      for(let y=yMax; y>=yMin; y--){
        const cur=readTile(getTile,x,y);
        if(cur!==T.AIR && !isGas(cur)) continue;
        const below=readTile(getTile,x,y+1);
        if(below!==T.WATER && (below===T.AIR || isGas(below))) continue;
        if(setTileNotified(x,y,T.WATER,getTile,setTile)){
          try{ if(MM.water && MM.water.addSource) MM.water.addSource(x,y,getTile,setTile); }catch(e){}
          c.cursor=(idx+1)%cols;
          c.water=(c.water|0)+1;
          craterLakeOps++;
          if(c.water>=Math.max(8,Math.round(r*1.4))) c.filled=true;
          markWorldChanged();
          return true;
        }
      }
    }
    c.cursor=(start+24)%cols;
    return false;
  }
  function updateCraterLakes(dt,getTile,setTile){
    if(!craterRecords.length || typeof getTile!=='function' || typeof setTile!=='function') return;
    const tier=perfTier();
    if(tier>=2) return;
    const checks=Math.min(tier>=1 ? 1 : CRATER_LAKE_STEP_CAP,craterRecords.length);
    for(let i=0;i<checks;i++){
      lakeCursor=(lakeCursor+1)%craterRecords.length;
      const c=craterRecords[lakeCursor];
      if(!c) continue;
      c.age=Math.min(999999,(c.age||0)+dt);
      if(c.filled || !craterRainActive(c)) continue;
      const profile=classProfile(c.classId);
      c.rain=(c.rain||0)+dt*0.55*(profile.lakeRate||1);
      if(c.rain>=1){
        c.rain-=1;
        fillCraterLakeCell(c,getTile,setTile);
      }
    }
  }
  function nextCraterColumn(c,eco,scale){
    const r=clamp(c.r|0,6,58);
    const span=Math.max(2,Math.round(r*(scale||0.82)));
    const n=(eco.cursor|0);
    eco.cursor=(n+1)%(span*2+1);
    return Math.floor(c.x + ((n*7)%(span*2+1))-span);
  }
  function placeCraterGroundTile(c,eco,tile,getTile,setTile,opts){
    opts=opts||{};
    for(let tries=0; tries<8; tries++){
      const x=nextCraterColumn(c,eco,opts.scale||0.74);
      const surface=craterSurfaceNear(x,c.y,getTile);
      if(surface==null) continue;
      const y=clamp(surface + (opts.buried ? 1+((eco.cursor+tries)%2) : 0),1,WORLD_BOTTOM-4);
      const cur=readTile(getTile,x,y);
      const info=tileInfo(cur);
      if(protectedTile(cur) || (info && info.machine)) continue;
      if(opts.openOnly && cur!==T.AIR && !isGas(cur) && cur!==T.WATER) continue;
      if(setTileNotified(x,y,tile,getTile,setTile)) return true;
    }
    return false;
  }
  function placeCraterAirTile(c,eco,tile,getTile,setTile){
    for(let tries=0; tries<8; tries++){
      const x=nextCraterColumn(c,eco,0.66);
      const surface=craterSurfaceNear(x,c.y,getTile);
      if(surface==null) continue;
      const y=Math.max(1,surface-1);
      const cur=readTile(getTile,x,y);
      if(cur!==T.AIR && !isGas(cur)) continue;
      if(setTileNotified(x,y,tile,getTile,setTile)) return true;
    }
    return false;
  }
  function seedAlienBloom(c,eco,getTile,setTile){
    const x=nextCraterColumn(c,eco,0.92);
    const surface=craterSurfaceNear(x,c.y,getTile);
    if(surface!=null){
      const soil=readTile(getTile,x,surface);
      if(soil!==T.ALIEN_BIOMASS && soil!==T.METEOR_DUST && soil!==T.GRASS && soil!==T.MUD){
        setTileNotified(x,surface,T.ALIEN_BIOMASS,getTile,setTile);
      }
    }
    try{
      if(MM.plants && typeof MM.plants.sow==='function' && MM.plants.sow('alienbloom',x,getTile)){
        eco.plants++;
        meteorMutations++;
        return true;
      }
    }catch(e){}
    return false;
  }
  function runGlowEcology(c,eco,getTile,setTile){
    let changed=false;
    if(eco.glow<Math.max(5,Math.round((c.r||10)*0.75))){
      const tile=(eco.glow%4===3) ? T.RADIOACTIVE_ORE : T.METEOR_DUST;
      if(placeCraterGroundTile(c,eco,tile,getTile,setTile,{scale:0.86,buried:tile===T.RADIOACTIVE_ORE})){
        eco.glow++;
        changed=true;
      }
    }
    try{
      if(MM.gases && MM.gases.add && eco.glow>0 && Math.random()<0.45){
        MM.gases.add('poison',c.x+rand(-1.4,1.4),c.y-0.5,{power:0.22,cells:1,getTile,setTile});
        changed=true;
      }
    }catch(e){}
    try{
      if(MM.plants && typeof MM.plants.mutateAt==='function'){
        const n=MM.plants.mutateAt(c.x,c.y,Math.max(4,(c.r||8)*0.55),getTile,setTile)|0;
        if(n>0){ eco.plants+=n; meteorMutations+=n; changed=true; }
      }
    }catch(e){}
    return changed;
  }
  function runAlienEcology(c,eco,getTile,setTile){
    let changed=false;
    if(eco.stage<Math.max(6,Math.round((c.r||10)*0.55))){
      const tile=(eco.stage%3===2) ? T.METEOR_DUST : T.ALIEN_BIOMASS;
      if(placeCraterGroundTile(c,eco,tile,getTile,setTile,{scale:0.96})){
        eco.stage++;
        changed=true;
      }
    }
    if(eco.plants<Math.max(3,Math.round((c.r||10)*0.35))){
      changed = seedAlienBloom(c,eco,getTile,setTile) || changed;
    }
    return changed;
  }
  function runMineralEcology(c,eco,getTile,setTile){
    if(eco.minerals>=Math.max(5,Math.round((c.r||10)*0.50))) return false;
    const profile=classProfile(c.classId);
    let tile=T.METEORIC_IRON;
    if(profile.id==='iridium' && eco.minerals%3===1) tile=T.IRIDIUM;
    else if(eco.minerals%4===2) tile=T.COAL;
    else if(profile.id==='iron' && eco.minerals%5===4) tile=T.OBSIDIAN;
    if(placeCraterGroundTile(c,eco,tile,getTile,setTile,{scale:0.62,buried:true})){
      eco.minerals++;
      return true;
    }
    return false;
  }
  function runSteamEcology(c,eco,getTile,setTile){
    let changed=false;
    if(eco.vents<Math.max(4,Math.round((c.r||10)*0.38))){
      if(placeCraterAirTile(c,eco,T.STEAM,getTile,setTile)){
        eco.vents++;
        changed=true;
      }
    }
    try{
      if(MM.gases && MM.gases.add && Math.random()<0.70){
        MM.gases.add('steam',c.x+rand(-Math.max(1,(c.r||10)*0.35),Math.max(1,(c.r||10)*0.35)),c.y-0.6,{power:0.35,cells:1,getTile,setTile});
        changed=true;
      }
    }catch(e){}
    if(eco.minerals<3 && placeCraterGroundTile(c,eco,T.OBSIDIAN,getTile,setTile,{scale:0.56,buried:true})){
      eco.minerals++;
      changed=true;
    }
    return changed;
  }
  function runCraterEcologyStep(c,getTile,setTile){
    if(!c || typeof getTile!=='function' || typeof setTile!=='function') return false;
    const profile=classProfile(c.classId);
    if(!c.ecology) c.ecology=makeCraterEcology(profile);
    const eco=c.ecology;
    if(eco.kind==='lake'){
      if(craterRainActive(c)) return fillCraterLakeCell(c,getTile,setTile);
      return false;
    }
    if(eco.kind==='glow') return runGlowEcology(c,eco,getTile,setTile);
    if(eco.kind==='alien') return runAlienEcology(c,eco,getTile,setTile);
    if(eco.kind==='steam') return runSteamEcology(c,eco,getTile,setTile);
    return runMineralEcology(c,eco,getTile,setTile);
  }
  function updateCraterEcology(dt,getTile,setTile){
    if(!(dt>0) || !craterRecords.length || typeof getTile!=='function' || typeof setTile!=='function') return;
    const tier=perfTier();
    if(tier>=2){
      ecologyBudgetAcc=0;
      return;
    }
    ecologyTime+=Math.min(10,dt);
    const maxBatch=tier>=1 ? 1 : CRATER_ECOLOGY_MAX_BATCH;
    const rate=tier>=1 ? Math.max(1,CRATER_ECOLOGY_CHECKS_PER_SECOND*0.5) : CRATER_ECOLOGY_CHECKS_PER_SECOND;
    ecologyBudgetAcc=Math.min(maxBatch,ecologyBudgetAcc + dt*rate);
    const checks=Math.min(craterRecords.length,maxBatch,Math.floor(ecologyBudgetAcc));
    if(checks<=0) return;
    ecologyBudgetAcc-=checks;
    for(let i=0;i<checks;i++){
      ecologyCursor=(ecologyCursor+1)%craterRecords.length;
      const c=craterRecords[ecologyCursor];
      if(!c) continue;
      if(!c.ecology) c.ecology=makeCraterEcology(classProfile(c.classId));
      const eco=c.ecology;
      const elapsed=Math.max(0,Math.min(60,ecologyTime-(Number.isFinite(eco.last)?eco.last:ecologyTime)));
      eco.last=ecologyTime;
      eco.t=(eco.t||0)+elapsed;
      if(eco.t<CRATER_ECOLOGY_INTERVAL) continue;
      eco.t-=CRATER_ECOLOGY_INTERVAL;
      if(runCraterEcologyStep(c,getTile,setTile)){
        craterEcologyOps++;
        markWorldChanged();
      }
    }
  }
  function countCraterMaterials(c,getTile){
    const counts={};
    if(!c || typeof getTile!=='function') return counts;
    const r=clamp(c.r|0,6,58);
    const yMin=Math.max(1,Math.floor(c.y)-3);
    const yMax=Math.min(WORLD_BOTTOM-4,Math.floor(c.y+r*0.70+6));
    for(let y=yMin; y<=yMax; y++){
      for(let x=Math.floor(c.x-r); x<=Math.floor(c.x+r); x++){
        if(Math.hypot(x+0.5-c.x,(y+0.5-c.y)*1.7)>r+3) continue;
        const t=readTile(getTile,x,y);
        if(t===T.IRIDIUM) counts.iridium=(counts.iridium||0)+1;
        else if(t===T.METEORIC_IRON) counts.meteoricIron=(counts.meteoricIron||0)+1;
        else if(t===T.RADIOACTIVE_ORE) counts.radioactiveOre=(counts.radioactiveOre||0)+1;
        else if(t===T.ALIEN_BIOMASS) counts.alienBiomass=(counts.alienBiomass||0)+1;
        else if(t===T.METEOR_DUST) counts.meteorDust=(counts.meteorDust||0)+1;
        else if(t===T.ANTIMATTER_CRYSTAL) counts.antimatter=(counts.antimatter||0)+1;
        else if(t===T.ICE || t===T.SNOW) counts.ice=(counts.ice||0)+1;
        else if(t===T.WATER) counts.water=(counts.water||0)+1;
      }
    }
    return counts;
  }
  function scanNearestCrater(player,getTile){
    if(!craterRecords.length){
      lastScan={ok:false,reason:'no-craters',t:0};
      try{ if(typeof window.msg==='function') window.msg('Skaner kraterow: brak znanych kraterow'); }catch(e){}
      return lastScan;
    }
    const px=(player && Number.isFinite(player.x)) ? player.x : 0;
    const py=(player && Number.isFinite(player.y)) ? player.y : 0;
    let best=null, bestD=Infinity;
    for(const c of craterRecords){
      const d=Math.hypot(c.x-px,c.y-py);
      if(d<bestD){ bestD=d; best=c; }
    }
    if(!best) return null;
    const materials=countCraterMaterials(best,getTile);
    if(!best.ecology) best.ecology=makeCraterEcology(classProfile(best.classId));
    const eco=best.ecology;
    lastScan={
      ok:true,
      x:best.x,
      y:best.y,
      r:best.r,
      classId:best.classId,
      label:best.label,
      site:best.site,
      redirected:!!best.redirected,
      water:best.water|0,
      filled:!!best.filled,
      dist:+bestD.toFixed(1),
      ecology:{
        kind:eco.kind,
        label:ecologyLabel(eco.kind),
        stage:eco.stage|0,
        plants:eco.plants|0,
        minerals:eco.minerals|0,
        vents:eco.vents|0,
        glow:eco.glow|0
      },
      materials,
      t:0
    };
    const materialText=Object.keys(materials).filter(k=>materials[k]>0).slice(0,4).join(', ') || 'brak probek';
    try{ if(typeof window.msg==='function') window.msg('Skan krateru: '+best.label+' / '+ecologyLabel(eco.kind)+' / '+best.site+' / '+materialText); }catch(e){}
    return lastScan;
  }
  function emitImpactFx(cx,cy,intensity,waterHit,profile,site,opts){
    profile=classProfile(profile && profile.id);
    opts=opts||{};
    const colossal=opts.colossal===true;
    impacts++;
    lastImpact={x:cx,y:cy,t:0,classId:profile.id,label:profile.label,site:site||'wildlands',redirected:!!opts.deflected};
    screenFlash=Math.max(screenFlash,colossal?1.85:1.28);
    startShake((colossal?1.15:0.78)+intensity*0.18,(colossal?15.5:9.5)+intensity*5.2);
    const stress=frameMs()>30;
    const impactHue=profile.ember || 'iron';
    const debrisCount=stress ? (colossal?8:5) : (colossal?20:12);
    const emberCount=stress ? (colossal?28:18) : (colossal?72:44);
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
        hue:impactHue==='iron' ? (Math.random()<0.16?'white':(Math.random()<0.54?'gold':'orange')) : impactHue
      },MAX_EMBERS);
    }
    const plumeCount=stress ? (colossal?11:7) : (colossal?24:14);
    for(let i=0;i<plumeCount;i++){
      pushCapped(plumes,{
        x:cx+rand(-3.8,3.8),
        y:cy+rand(-0.8,1.2),
        vx:rand(-0.48,0.48),
        vy:rand(-1.25,-0.35),
        life:0,
        max:rand(2.6,5.2),
        r:rand(0.44,1.05)*(1+intensity*0.16),
        shade:profile.id==='ice' ? Math.floor(rand(128,190)) : (profile.id==='radioactive' ? Math.floor(rand(70,118)) : Math.floor(rand(38,82)))
      },MAX_PLUMES);
    }
    if(waterHit) emitWaterImpactFx(cx,cy,1.15+intensity*0.25);
    for(let i=0;i<4;i++) smokeAt(cx+rand(-3.4,3.4),cy+rand(-1.4,1.4),2.1+intensity*0.55);
    burstAt(cx,cy,'epic',28);
    try{ if(MM.gases && MM.gases.add) MM.gases.add('hot',cx,cy-0.6,{power:2.6+intensity*0.55,cells:12}); }catch(e){}
    playReadyAudio('meteor',{x:cx,y:cy});
    playReadyAudio('explosion',{x:cx,y:cy});
    try{
      if(typeof window.msg==='function'){
        const displaced=opts.deflected ? ' (odbity: '+(site||'teren')+')' : '';
        window.msg('Krater '+profile.label+' @ x='+Math.round(cx)+displaced);
      }
    }catch(e){}
  }
  function hurtActors(cx,cy,intensity){
    const radius=8.0+intensity*2.3;
    damageBlastCreatures(MM,cx,cy,radius,34+intensity*10,{source:'meteor',cause:'meteor_blast'});
    try{
      if(MM.guardianLairs && MM.guardianLairs.damageAt){
        const d=38+intensity*12;
        const blastOpts={kind:'explosion',source:'meteor',cause:'meteor_blast',terrainDamage:true};
        MM.guardianLairs.damageAt(Math.round(cx),Math.round(cy),d,blastOpts);
        MM.guardianLairs.damageAt(Math.round(cx)+1,Math.round(cy),d*0.6,blastOpts);
        MM.guardianLairs.damageAt(Math.round(cx)-1,Math.round(cy),d*0.6,blastOpts);
      }
    }catch(e){}
    try{
      if(MM.bosses && MM.bosses.damageAt){
        const d=34+intensity*11;
        const blastOpts={kind:'explosion',source:'meteor',cause:'meteor_blast',terrainDamage:true};
        MM.bosses.damageAt(Math.round(cx),Math.round(cy),d,blastOpts);
        MM.bosses.damageAt(Math.round(cx)+1,Math.round(cy),d*0.6,blastOpts);
        MM.bosses.damageAt(Math.round(cx)-1,Math.round(cy),d*0.6,blastOpts);
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
    const profile=classProfile((opts.profile && opts.profile.id) || opts.classId || opts.kind || opts.type);
    const cx=Math.floor(wx)+0.5;
    const cy=clamp(Math.floor(wy),2,WORLD_BOTTOM-5);
    const hit=readTile(getTile,Math.floor(cx),Math.floor(cy));
    const waterHit=!!opts.waterHit || hit===T.WATER || hit===T.ICE;
    const site=opts.site || impactSiteKind(cx,cy,getTile);
    const pow=intensity||1;
    queueCrater(cx,cy,pow,getTile,preparedOps,setTile,Object.assign({},opts,{instant:true,classId:profile.id,profile,surfaceY:Number.isFinite(opts.surfaceY)?opts.surfaceY:cy}));
    pushCraterRecord(cx,cy,pow,profile,site,opts);
    recordImpactConsequence(cx,cy,profile,site,opts);
    applyMeteorAftermath(cx,cy,pow,profile,getTile,setTile,site,opts);
    markWorldChanged();
    emitImpactFx(cx,cy,pow,waterHit,profile,site,opts);
    if(!opts.skipActorDamage) hurtActors(cx,cy,pow);
    return true;
  }
  function forceSpawn(opts,player,getTile){
    opts=opts||{};
    if(meteors.length>=MAX_METEORS) return null;
    const target=pickTarget(player,getTile,opts);
    if(!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    const profile=classFromOpts(opts,target.x);
    const host=HOSTILITY.at(target.x);
    const baseIntensity=clamp(Number(opts.intensity)||rand(1.12,1.58),0.85,2.2);
    const intensity=clamp(baseIntensity*(profile.intensityMult||1)*(host.meteorIntensityMult||1),0.78,3.35);
    const surfaceY=clamp(craterSurfaceNear(target.x,target.y,getTile)||target.y,2,WORLD_BOTTOM-6);
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
      classId:profile.id,
      classLabel:profile.label,
      rot:Math.random()*Math.PI*2,
      spin:rand(-5.5,5.5),
      waterEntryFx:false,
      waterHit:false,
      beaconScanT:0,
      cachedBeacon
    };
    meteors.push(m);
    spawned++;
    classCountBump(profile);
    alertSirenForMeteor(m,getTile);
    try{ if(typeof window.msg==='function') window.msg('Niebo przecina meteoryt '+profile.label+'...'); }catch(e){}
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
      if(ty>=WORLD_BOTTOM-3 || (ty>=1 && meteorGroundTile(t))){
        impactAt(m.x,m.y,getTile,setTile,m.intensity,null,{waterHit:m.waterHit,classId:m.classId,deflected:!!m.deflected});
        return true;
      }
      destroyFlyThroughTile(tx,ty,t,getTile,setTile,m.intensity);
      if(m.life<=0){
        const rt=m.redirectTarget;
        if(rt && Number.isFinite(rt.x) && Number.isFinite(rt.y)) impactAt(rt.x,rt.y,getTile,setTile,m.intensity,null,{waterHit:m.waterHit,classId:m.classId,deflected:!!m.deflected});
        else impactAt(m.x,m.y,getTile,setTile,m.intensity,null,{waterHit:m.waterHit,classId:m.classId,deflected:!!m.deflected});
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
    if(lastSirenAlert){
      lastSirenAlert.t+=dt;
      if(lastSirenAlert.t>9) lastSirenAlert=null;
    }
    if(lastScan && lastScan.t!=null){
      lastScan.t+=dt;
      if(lastScan.t>18) lastScan=null;
    }
    if(lastConsequence && lastConsequence.t!=null){
      lastConsequence.t+=dt;
      if(lastConsequence.t>18) lastConsequence=null;
    }
    for(let i=sirenPulses.length-1;i>=0;i--){
      const s=sirenPulses[i];
      s.life+=dt;
      if(s.life>=s.max) sirenPulses.splice(i,1);
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
      if(d.life>=d.max || d.y>=WORLD_BOTTOM) debris.splice(i,1);
    }
    for(let i=embers.length-1;i>=0;i--){
      const e=embers[i];
      e.life+=dt;
      e.x+=e.vx*dt;
      e.y+=e.vy*dt;
      e.vy+=(5.5-inverseGravityAt(e.x,e.y)*0.45)*dt;
      e.vx*=1-Math.min(0.12,dt*0.3);
      if(e.life>=e.max || e.y>=WORLD_BOTTOM) embers.splice(i,1);
    }
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || !Number.isFinite(dt)) return;
    if(enabled && !meteors.length && !terrainJobs.length){
      nextIn-=dt;
      if(nextIn<=0){
        forceSpawn({nearHero:false},player,getTile);
        rollNext(player && Number.isFinite(player.x) ? player.x : undefined);
        saveSettings();
      }
    }
    for(let i=meteors.length-1;i>=0;i--){
      if(updateMeteor(meteors[i],dt,getTile,setTile,player)) meteors.splice(i,1);
    }
    applyGravityBurstToPlayer(dt,player || (typeof window!=='undefined' ? window.player : null));
    applyTerrainJobs(getTile,setTile);
    updateCraterLakes(dt,getTile,setTile);
    updateCraterEcology(dt,getTile,setTile);
    updateFx(dt);
  }
  function tileVisibleFn(canDrawTile){
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    return (x,y)=> !visible || visible(Math.floor(x),Math.max(0,Math.min(WORLD_BOTTOM-1,Math.floor(y))));
  }
  function drawMeteor(ctx,TILE,m){
    const profile=classProfile(m && m.classId);
    const ang=Math.atan2(m.vy,m.vx);
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let i=m.trail.length-1;i>0;i--){
      const a=m.trail[i], b=m.trail[i-1];
      const k=i/m.trail.length;
      ctx.strokeStyle=(profile.trailOuter||'rgba(255,110,26,')+(0.08+0.34*k)+')';
      ctx.lineWidth=TILE*(0.10+0.42*k);
      ctx.beginPath();
      ctx.moveTo(a.x*TILE,a.y*TILE);
      ctx.lineTo(b.x*TILE,b.y*TILE);
      ctx.stroke();
      ctx.strokeStyle=(profile.trailInner||'rgba(255,232,120,')+(0.10+0.28*k)+')';
      ctx.lineWidth=TILE*(0.035+0.13*k);
      ctx.beginPath();
      ctx.moveTo(a.x*TILE,a.y*TILE);
      ctx.lineTo(b.x*TILE,b.y*TILE);
      ctx.stroke();
    }
    const px=m.x*TILE, py=m.y*TILE;
    const glowR=TILE*2.4;
    const glow=ctx.createRadialGradient(px,py,1,px,py,glowR);
    glow.addColorStop(0,profile.glow1 || 'rgba(255,255,236,0.95)');
    glow.addColorStop(0.18,profile.glow2 || 'rgba(255,216,91,0.86)');
    glow.addColorStop(0.48,profile.glow3 || 'rgba(255,78,22,0.42)');
    glow.addColorStop(1,'rgba(255,24,0,0)');
    ctx.fillStyle=glow;
    ctx.beginPath(); ctx.arc(px,py,glowR,0,Math.PI*2); ctx.fill();
    ctx.translate(px,py);
    ctx.rotate(ang);
    ctx.fillStyle=profile.body || '#fff7c9';
    ctx.beginPath(); ctx.ellipse(0,0,TILE*0.42,TILE*0.30,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=profile.core || '#ff6a21';
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
  function drawSirenPulse(ctx,TILE,s){
    const age=clamp(s.life/s.max,0,1);
    const alpha=Math.pow(1-age,1.2);
    const cx=s.x*TILE, cy=s.y*TILE;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<3;i++){
      const phase=(age+i*0.22)%1;
      const r=TILE*(0.55+phase*4.8);
      ctx.strokeStyle='rgba(255,159,69,'+(alpha*(1-phase)*0.58)+')';
      ctx.lineWidth=1.8-i*0.25;
      ctx.beginPath();
      ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.stroke();
    }
    if(Number.isFinite(s.mx) && Number.isFinite(s.my)){
      const mx=s.mx*TILE, my=s.my*TILE;
      const dash=8+Math.sin(age*18+s.phase)*3;
      ctx.strokeStyle='rgba(255,225,120,'+(0.42*alpha)+')';
      ctx.lineWidth=1.2;
      if(ctx.setLineDash) ctx.setLineDash([dash,6]);
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.lineTo(mx,my);
      ctx.stroke();
    }
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
  function drawCraterEcology(ctx,TILE,c,quality){
    const eco=c && c.ecology;
    const score=craterEcologyScore(eco);
    if(score<=0) return false;
    quality=quality==null ? 2 : clamp(quality|0,0,2);
    const px=c.x*TILE, py=(c.y+0.45)*TILE;
    const r=clamp(c.r|0,6,58)*TILE;
    const pulse=Math.sin((typeof performance!=='undefined'?performance.now():0)*0.0017 + c.x*0.13)*0.5+0.5;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    if(eco.kind==='glow'){
      const a=Math.min(0.34,0.09+score*0.018);
      if(quality>=2){
        const g=ctx.createRadialGradient(px,py,1,px,py,r*(0.72+score*0.015));
        g.addColorStop(0,'rgba(155,255,90,'+(a*0.95)+')');
        g.addColorStop(0.42,'rgba(90,230,70,'+(a*0.45)+')');
        g.addColorStop(1,'rgba(90,230,70,0)');
        ctx.fillStyle=g;
        ctx.beginPath(); ctx.ellipse(px,py,r*0.82,r*0.28,0,0,Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle='rgba(110,238,82,'+(quality ? a*0.48 : Math.min(0.14,a*0.34))+')';
        ctx.beginPath(); ctx.ellipse(px,py,r*(quality?0.66:0.48),r*(quality?0.21:0.13),0,0,Math.PI*2); ctx.fill();
      }
      const glowN=quality>=2 ? 9 : (quality===1 ? 5 : 2);
      for(let i=0;i<Math.min(glowN,2+eco.glow);i++){
        const dx=((i*37)%17-8)/9*r*0.44;
        const dy=((i*19)%11-5)/10*r*0.18;
        ctx.fillStyle='rgba(190,255,120,'+(0.20+0.16*pulse)+')';
        ctx.fillRect(px+dx,py+dy,Math.max(1.5,TILE*0.10),Math.max(1.5,TILE*0.10));
      }
    } else if(eco.kind==='alien'){
      ctx.strokeStyle='rgba(122,238,108,'+(0.18+0.10*pulse)+')';
      ctx.lineWidth=quality ? 1.2 : 1;
      const vineN=quality>=2 ? 10 : (quality===1 ? 5 : 3);
      for(let i=0;i<Math.min(vineN,2+eco.stage+eco.plants);i++){
        const a=i*2.399+c.x*0.07;
        const rr=r*(0.18+((i*11)%13)/22);
        const x=px+Math.cos(a)*rr;
        const y=py+Math.sin(a)*rr*0.28;
        ctx.beginPath();
        ctx.moveTo(x,y);
        ctx.quadraticCurveTo(x+Math.sin(a)*TILE*0.30,y-TILE*(0.35+pulse*0.22),x+Math.cos(a)*TILE*0.18,y-TILE*(0.62+pulse*0.28));
        ctx.stroke();
      }
    } else if(eco.kind==='steam'){
      const ventN=quality>=2 ? 7 : (quality===1 ? 4 : 2);
      for(let i=0;i<Math.min(ventN,1+eco.vents);i++){
        const x=px+(((i*29)%17)-8)/8*r*0.34;
        const y=py-r*0.10;
        ctx.strokeStyle='rgba(205,240,255,'+(0.16+0.12*pulse)+')';
        ctx.lineWidth=quality ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(x,y);
        ctx.bezierCurveTo(x+TILE*0.22,y-TILE*0.45,x-TILE*0.18,y-TILE*0.85,x+TILE*0.10,y-TILE*1.18);
        ctx.stroke();
      }
    } else if(eco.kind==='mineral'){
      ctx.strokeStyle='rgba(190,216,230,'+Math.min(0.28,0.08+eco.minerals*0.025)+')';
      ctx.lineWidth=quality ? 1.1 : 1;
      const mineralN=quality>=2 ? 8 : (quality===1 ? 5 : 3);
      for(let i=0;i<Math.min(mineralN,eco.minerals);i++){
        const x=px+(((i*31)%19)-9)/10*r*0.42;
        const y=py+(((i*13)%7)-3)/8*r*0.16;
        ctx.beginPath();
        ctx.moveTo(x-TILE*0.15,y+TILE*0.10);
        ctx.lineTo(x+TILE*0.15,y-TILE*0.10);
        ctx.moveTo(x+TILE*0.10,y+TILE*0.12);
        ctx.lineTo(x+TILE*0.24,y-TILE*0.04);
        ctx.stroke();
      }
    } else if(eco.kind==='lake'){
      if((c.water|0)>0 || c.filled){
        ctx.fillStyle='rgba(80,160,255,'+(0.10+Math.min(0.18,(c.water||0)*0.006))+')';
        ctx.beginPath(); ctx.ellipse(px,py,r*0.50,r*0.16,0,0,Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
    return true;
  }
  function draw(ctx,TILE,canDrawTile){
    const tileVisible=tileVisibleFn(canDrawTile);
    const craterQuality=craterEcologyDrawQuality();
    const craterCap=craterEcologyDrawCap(craterQuality);
    let cratersDrawn=0;
    ctx.save();
    for(const c of craterRecords){
      if(c && tileVisible(c.x,c.y) && drawCraterEcology(ctx,TILE,c,craterQuality)){
        cratersDrawn++;
        if(cratersDrawn>=craterCap) break;
      }
    }
    for(const s of scorches){
      if(tileVisible(s.x,s.y)) drawScorch(ctx,TILE,s);
    }
    for(const b of gravityBursts){
      if(tileVisible(b.x,b.y)) drawGravityBurst(ctx,TILE,b);
    }
    for(const s of sirenPulses){
      if(tileVisible(s.x,s.y) || (Number.isFinite(s.mx) && tileVisible(s.mx,s.my))) drawSirenPulse(ctx,TILE,s);
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
      ctx.fillStyle=e.hue==='white' ? 'rgba(255,255,230,'+(0.95*alpha)+')' :
        (e.hue==='gold' ? 'rgba(255,214,82,'+(0.86*alpha)+')' :
        (e.hue==='iridium' ? 'rgba(184,215,255,'+(0.82*alpha)+')' :
        (e.hue==='ice' ? 'rgba(157,238,255,'+(0.78*alpha)+')' :
        (e.hue==='radioactive' ? 'rgba(138,255,79,'+(0.80*alpha)+')' :
        (e.hue==='antimatter' ? 'rgba(211,107,255,'+(0.84*alpha)+')' :
        (e.hue==='biological' ? 'rgba(121,201,93,'+(0.78*alpha)+')' : 'rgba(255,91,28,'+(0.78*alpha)+')'))))));
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
    sirenPulses.length=0;
    screenFlash=0;
    lastImpact=null;
    lastDeflection=null;
    lastSirenAlert=null;
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
    return {
      v:4,
      enabled,
      nextIn:+Math.max(0,nextIn).toFixed(2),
      spawned,
      impacts,
      deflections,
      sirenAlerts,
      craterLakeOps,
      craterEcologyOps,
      meteorMutations,
      classCounts:copyClassCounts(),
      consequenceCounts:copyConsequenceCounts(),
      craters:craterRecords.map(c=>({
        x:c.x,y:c.y,r:c.r,classId:c.classId,label:c.label,site:c.site,redirected:!!c.redirected,
        rain:+Math.max(0,c.rain||0).toFixed(2),water:c.water|0,filled:!!c.filled,age:+Math.max(0,c.age||0).toFixed(1),cursor:c.cursor|0,
        eco:packCraterEcology(c.ecology)
      })).slice(-MAX_CRATER_RECORDS),
      consequences:impactConsequences.map(c=>({
        x:c.x,y:c.y,classId:c.classId,label:c.label,site:c.site,severity:c.severity|0,message:c.message,t:+Math.max(0,c.t||0).toFixed(1)
      })).slice(-MAX_IMPACT_CONSEQUENCES)
    };
  }
  function restore(data){
    clearActive();
    terrainJobs.length=0;
    beaconIndex.clear();
    sirenIndex.clear();
    craterRecords.length=0;
    impactConsequences.length=0;
    lastScan=null;
    lastConsequence=null;
    sirenAlerts=0;
    craterLakeOps=0;
    craterEcologyOps=0;
    meteorMutations=0;
    lakeCursor=0;
    ecologyCursor=0;
    ecologyBudgetAcc=0;
    ecologyTime=0;
    resetClassCounts();
    resetConsequenceCounts();
    if(data && typeof data==='object'){
      enabled=data.enabled===true;
      nextIn=loadedNextIn(data);
      spawned=Math.max(0,(data.spawned|0)||0);
      impacts=Math.max(0,(data.impacts|0)||0);
      deflections=Math.max(0,(data.deflections|0)||0);
      sirenAlerts=Math.max(0,(data.sirenAlerts|0)||0);
      craterLakeOps=Math.max(0,(data.craterLakeOps|0)||0);
      craterEcologyOps=Math.max(0,(data.craterEcologyOps|0)||0);
      meteorMutations=Math.max(0,(data.meteorMutations|0)||0);
      resetClassCounts(data.classCounts);
      resetConsequenceCounts(data.consequenceCounts);
      if(Array.isArray(data.craters)){
        for(const raw of data.craters.slice(-MAX_CRATER_RECORDS)){
          if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
          const profile=classProfile(raw.classId);
          craterRecords.push({
            x:+raw.x,
            y:+raw.y,
            r:clamp((raw.r|0)||12,6,58),
            classId:profile.id,
            label:profile.label,
            site:typeof raw.site==='string' ? raw.site.slice(0,24) : 'wildlands',
            redirected:raw.redirected===true,
            rain:Math.max(0,Number(raw.rain)||0),
            water:Math.max(0,(raw.water|0)||0),
            filled:raw.filled===true,
            age:Math.max(0,Number(raw.age)||0),
            cursor:Math.max(0,(raw.cursor|0)||0),
            ecology:makeCraterEcology(profile,raw.eco || raw.ecology)
          });
        }
      }
      if(Array.isArray(data.consequences)){
        for(const raw of data.consequences.slice(-MAX_IMPACT_CONSEQUENCES)){
          if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
          const profile=classProfile(raw.classId);
          const site=consequenceCounts[raw.site]!=null ? raw.site : 'wildlands';
          impactConsequences.push({
            x:+raw.x,
            y:+raw.y,
            classId:profile.id,
            label:profile.label,
            site,
            severity:consequenceSeverity(site),
            message:typeof raw.message==='string' && raw.message.length<=180 ? raw.message : consequenceMessage(site,profile),
            t:Math.max(0,Number(raw.t)||0)
          });
        }
        if(impactConsequences.length) lastConsequence=impactConsequences[impactConsequences.length-1];
      }
    }
    if(!(nextIn>0)) rollNext();
    saveSettings();
    return true;
  }
  function reset(){
    clearActive();
    terrainJobs.length=0;
    beaconIndex.clear();
    sirenIndex.clear();
    craterRecords.length=0;
    impactConsequences.length=0;
    lastScan=null;
    lastConsequence=null;
    sirenAlerts=0;
    craterLakeOps=0;
    craterEcologyOps=0;
    meteorMutations=0;
    lakeCursor=0;
    ecologyCursor=0;
    ecologyBudgetAcc=0;
    ecologyTime=0;
    resetClassCounts();
    resetConsequenceCounts();
    spawned=0;
    impacts=0;
    deflections=0;
    rollNext();
    saveSettings();
  }
  function metrics(){
    let queued=0;
    for(const j of terrainJobs) queued+=Math.max(0,j.ops.length-j.i);
    const host=HOSTILITY.at(playerX(0));
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
      sirenPulses:sirenPulses.length,
      beacons:beaconIndex.size,
      sirens:sirenIndex.size,
      craters:craterRecords.length,
      lakeCraters:craterRecords.filter(c=>c && (c.water>0 || c.filled)).length,
      ecologyCraters:activeEcologyCraters(),
      craterPerfTier:perfTier(),
      craterDrawQuality:craterEcologyDrawQuality(),
      craterEcologyBudget:+Math.max(0,ecologyBudgetAcc||0).toFixed(2),
      impactConsequences:impactConsequences.length,
      consequenceCounts:copyConsequenceCounts(),
      craterLakeOps,
      craterEcologyOps,
      meteorMutations,
      impacts,
      deflections,
      sirenAlerts,
      spawned,
      shake:+Math.max(0,shakeT).toFixed(2),
      lastImpact,
      lastDeflection,
      lastSirenAlert,
      lastScan,
      lastConsequence,
      classCounts:copyClassCounts(),
      hostility:+host.hostility.toFixed(3),
      hostilitySide:host.side,
      scheduleBoundsDays:HOSTILITY.meteorScheduleBoundsDays(host.x, MIN_WAIT_DAYS, MAX_WAIT_DAYS, MIN_SCHEDULE_DAYS)
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
    impactAt,
    setEnabled,
    onTileChanged,
    rollSchedule,
    reset,
    clearActive,
    snapshot,
    restore,
    metrics,
    isChunkBusy,
    scanNearestCrater,
    triggerAntimatterBurst,
      _debug:{impactAt,queueCrater,applyTerrainJobs,pickTarget,nearestBeacon,nearestSiren,beaconIndex,sirenIndex,meteors,terrainJobs,embers,debris,plumes,beaconWaves,gravityBursts,sirenPulses,shockwaves,scorches,craterRecords,impactConsequences,METEOR_CLASSES,classWeightsAt,scanNearestCrater,updateCraterLakes,updateCraterEcology,runCraterEcologyStep,perfTier,craterEcologyDrawQuality,selectBatchWakeCells}
  };
  MM.meteorites=api;
  return api;
})();

export { meteorites };
export default meteorites;
