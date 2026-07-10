// Elemental gatekeepers: deterministic east/west lairs plus standalone boss fights.
// These are not procedural block bosses. They are authored elemental species with
// arena control, phase logic, telegraphed hazards, sidekick mechanics, and one-time
// heart rewards.
import { CHUNK_W, WORLD_H, T } from '../constants.js';
import { isBlastProtectedTile, isGeneratedStructureReplaceableTile, isReplaceableNaturalOpenTile, isSolidCollisionTile as isSolid } from './material_physics.js';
import { STORY_LORE } from './story_lore.js';
import { worldGen as WG } from './worldgen.js';
import { applyBossStatus, bossElectricDamageMult, bossStatusFor, tickBossStatus } from './boss_status.js';

const guardianLairs = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  const CFG = {
    DISTANCE: 10000,
    SEARCH_BLOCKS: 52000,
    AWAKEN_RADIUS: 92,
    COMBAT_RADIUS: 140,
    LEASH_RADIUS: 172,
    LEASH_Y: 74,
    AMBIENT_MIN_CD: 18,
    AMBIENT_MAX_CD: 62,
    HAZARD_CAP: 220,
    EFFECT_CAP: 260,
    ENTITY_CAP: 12,
    LAIR_WIDTH: 112,
    STORM_MIN_INTERVAL: 40,
    STORM_MAX_INTERVAL: 60,
    STORM_LIVE_CAP: 1,
    STORM_FALL_MIN: 0.28,
    STORM_FALL_MAX: 0.42,
    STORM_IMPACT_INTENSITY: 1.65,
    DEATH_BLAST_INTENSITY: 4.2,
    DEATH_BLAST_SCALE: 1.62,
    DEATH_BLAST_GRACE_MS: 3200,
    GHOST_TALK_RADIUS: 18,
    LIGHTNING_THRESHOLD: 0.20,
    LIGHTNING_MIN_RATE: 6,
    LIGHTNING_MAX_RATE: 10,
  };

  const SPEC = {
    fire: {
      dir: 1,
      label: 'East Fire Guardian',
      bossName: 'Ignivar, the Solar Wyrm',
      heartKey: 'heartFire',
      heartLabel: 'Heart of Fire',
      accent: '#ff6a21',
      accent2: '#ffd15a',
      dark: '#3a1008',
      sidekicks: [
        {role:'flare', name:'Cinder Oracle', hp:180, radius:1.05},
        {role:'bulwark', name:'Magma Hound', hp:230, radius:1.18}
      ]
    },
    ice: {
      dir: -1,
      label: 'West Ice Guardian',
      bossName: 'Aurex, the Rime Sovereign',
      heartKey: 'heartIce',
      heartLabel: 'Heart of Ice',
      accent: '#9deeff',
      accent2: '#d9fbff',
      dark: '#102538',
      sidekicks: [
        {role:'mirror', name:'Aurora Mirror', hp:170, radius:1.0},
        {role:'sentinel', name:'Glacier Sentinel', hp:240, radius:1.18}
      ]
    }
  };

  const cache = new Map();
  const state = {
    defeated: {fire:false, ice:false},
    awakened: {fire:false, ice:false},
    ambientCd: {fire:28, ice:34},
    stormCd: {fire:null, ice:null},
    stormMsgCd: {fire:0, ice:0},
    stormImpactSfxCd: {fire:0, ice:0},
    weatherCd: {fire:0, ice:0},
    lightningCarry: {fire:0, ice:0},
    lightningRate: {fire:0, ice:0},
    lightningMsgCd: {fire:0, ice:0},
    cloudStrikeCd: {fire:0, ice:0},
    ghosts: {fire:null, ice:null},
    underground: {enabled:false, x:null, y:null, seed:0, materialized:false},
    awakenSeq: 1
  };
  let entities = [];
  const hazards = [];
  const effects = [];
  let entitySeq = 1;
  let lastGetTile = null;
  let lastSetTile = null;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function finite(v,d){ return Number.isFinite(v) ? v : d; }
  function lerp(a,b,t){ return a+(b-a)*clamp(t,0,1); }
  function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }
  function mulberry32(a){ a=a>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function seedFor(kind,x){ return (((WG.worldSeed||1) ^ Math.imul(Math.round(x)|0, kind==='fire'?0x9e3779b1:0x85ebca6b))>>>0); }
  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function sfx(id,opts){ try{ if(MM.audio && MM.audio.play) MM.audio.play(id,opts); }catch(e){} }
  function playerRef(){ return root.player || null; }
  function progressHearts(){
    try{ if(MM.progress && MM.progress.guardianHearts) return MM.progress.guardianHearts() || {}; }catch(e){}
    return {};
  }
  function isDefeated(kind){
    const hearts = progressHearts();
    return !!(state.defeated[kind] || hearts[kind]);
  }
  function markWorldChanged(){ try{ if(typeof root.__mmMarkWorldChanged === 'function') root.__mmMarkWorldChanged(); }catch(e){} }

  function biomeOk(kind,x){
    let b=1;
    try{ b = WG.biomeType ? WG.biomeType(x) : 1; }catch(e){}
    if(b===5 || b===6 || b===8) return false;
    if(kind==='fire') return b!==2;
    if(kind==='ice') return b!==3;
    return true;
  }
  function surfaceAt(x){
    try{ return clamp(Math.round(WG.surfaceHeight(Math.round(x))), 14, WORLD_H-18); }catch(e){ return 64; }
  }
  function smoothScore(x){
    const s=surfaceAt(x);
    let maxDelta=0;
    for(let dx=-10; dx<=10; dx+=2) maxDelta=Math.max(maxDelta, Math.abs(surfaceAt(x+dx)-s));
    return Math.max(0, 1 - maxDelta/12);
  }
  function candidateScore(kind,x){
    if(!biomeOk(kind,x)) return -1;
    const s=surfaceAt(x);
    if(s<18 || s>WORLD_H-22) return -1;
    const smooth=smoothScore(x);
    let b=1; try{ b=WG.biomeType ? WG.biomeType(x) : 1; }catch(e){}
    let pref=0.4;
    if(kind==='fire') pref = (b===7?1.0:b===3?0.85:b===1?0.65:0.45);
    if(kind==='ice') pref = (b===2?1.0:b===7?0.72:b===1?0.55:0.42);
    return smooth*0.68 + pref*0.32;
  }
  function anchorFor(kind){
    const spec=SPEC[kind];
    if(!spec) return null;
    const key='anchor:'+kind+':'+(WG.worldSeed||0);
    if(cache.has(key)) return cache.get(key);
    const sign=spec.dir;
    let best=null, bestScore=-1;
    for(let i=0;i<1500;i++){
      const jitter=Math.round((WG.randSeed(sign*(i+11)*13.71 + (kind==='fire'?4.2:8.4))-0.5)*28);
      const x=sign*(CFG.DISTANCE + i*32 + jitter);
      if(sign*x<CFG.DISTANCE) continue;
      const sc=candidateScore(kind,x);
      if(sc>bestScore){ bestScore=sc; best=x; }
      if(i>80 && sc>0.86) break;
      if(i*32>CFG.SEARCH_BLOCKS && best!=null) break;
    }
    if(best==null) best=sign*CFG.DISTANCE;
    cache.set(key,best);
    return best;
  }

  function makeLayout(kind){
    const spec=SPEC[kind];
    const ax=anchorFor(kind);
    const r=mulberry32(seedFor(kind,ax));
    const s=surfaceAt(ax);
    const floorY=clamp(s, 24, WORLD_H-18);
    const ops=[];
    const glows=[];
    let minX=ax, maxX=ax, minY=floorY, maxY=floorY;
    function bound(x,y){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return;
      ops.push({x,y,t,f:force?1:0});
      bound(x,y);
    }
    function rect(x0,y0,w,h,t,force){
      for(let y=y0;y<y0+h;y++) for(let x=x0;x<x0+w;x++) put(x,y,t,force);
    }
    function clear(x0,y0,w,h){ rect(x0,y0,w,h,T.AIR,true); }
    function pillar(x,y0,y1,t,cap){
      const a=Math.min(y0,y1), b=Math.max(y0,y1);
      for(let y=a;y<=b;y++) put(x,y,t,true);
      if(cap){ put(x-1,a,cap,true); put(x+1,a,cap,true); }
    }
    function arch(cx,base,w,h,t){
      for(let i=-w;i<=w;i++){
        const yy=base-Math.round(Math.sqrt(Math.max(0,1-(i*i)/(w*w)))*h);
        put(cx+i,yy,t,true);
        if(Math.abs(i)>w-3) for(let y=yy;y<=base;y++) put(cx+i,y,t,true);
      }
    }

    clear(ax-52,floorY-28,105,28);
    for(let x=ax-56;x<=ax+56;x++){
      const wave=Math.round(Math.sin((x-ax)*0.22)*1.3);
      for(let y=floorY+wave;y<=floorY+5;y++){
        const edge=Math.abs(x-ax)>48 || y>=floorY+4;
        if(kind==='fire') put(x,y,edge?T.OBSIDIAN:(r()<0.18?T.STEEL:T.BASALT),true);
        else put(x,y,edge?T.STONE:(r()<0.26?T.ICE:T.SNOW),true);
      }
    }

    if(kind==='fire'){
      for(let x=ax-48;x<=ax+48;x++){
        const d=Math.abs(x-ax);
        if((d>25 && d<39) || (d>6 && d<11)){
          put(x,floorY,T.LAVA,true);
          put(x,floorY+1,T.LAVA,true);
        }
      }
      rect(ax-8,floorY-2,17,2,T.STEEL,true);
      rect(ax-11,floorY,23,2,T.OBSIDIAN,true);
      for(const sx of [-36,-24,24,36]){
        pillar(ax+sx,floorY-18,floorY,T.OBSIDIAN,T.STEEL);
        put(ax+sx,floorY-19,T.TORCH,true);
        glows.push({x:ax+sx+0.5,y:floorY-18.5,r:7,kind});
      }
      arch(ax,floorY-6,31,18,T.OBSIDIAN);
      rect(ax-3,floorY-11,7,7,T.AIR,true);
      for(let k=0;k<9;k++){
        const x=ax-42+k*10;
        put(x,floorY-1,T.TORCH,true);
      }
    }else{
      for(let x=ax-48;x<=ax+48;x++){
        const d=Math.abs(x-ax);
        if((d>28 && d<40) || (d>8 && d<13)){
          put(x,floorY,T.WATER,true);
          put(x,floorY-1,T.ICE,true);
        }
      }
      rect(ax-9,floorY-2,19,2,T.ICE,true);
      rect(ax-13,floorY,27,2,T.STONE,true);
      for(const sx of [-38,-26,26,38]){
        pillar(ax+sx,floorY-17,floorY,T.ICE,T.DIAMOND);
        for(let y=floorY-16;y<floorY-6;y+=3) put(ax+sx+(sx<0?-1:1),y,T.SNOW,true);
        glows.push({x:ax+sx+0.5,y:floorY-18.5,r:7,kind});
      }
      arch(ax,floorY-7,32,17,T.ICE);
      rect(ax-4,floorY-12,9,8,T.AIR,true);
      for(let k=0;k<8;k++){
        const x=ax-42+k*12;
        put(x,floorY-1,k%2?T.DIAMOND:T.TORCH,true);
      }
    }

    const sidekickSpawns = kind==='fire'
      ? [{role:'flare',x:ax-28,y:floorY-10},{role:'bulwark',x:ax+30,y:floorY-3}]
      : [{role:'mirror',x:ax-30,y:floorY-11},{role:'sentinel',x:ax+28,y:floorY-4}];
    return {
      kind, ax, x:ax, floorY, bossX:ax, bossY:floorY-16,
      sidekickSpawns,
      minX:minX-2, maxX:maxX+2, minY:minY-2, maxY:maxY+2,
      ops, glows,
      seed:seedFor(kind,ax),
      label:spec.label,
    };
  }
  function layoutFor(kind){
    if(!SPEC[kind]) return null;
    const key='layout:'+kind+':'+(WG.worldSeed||0);
    if(cache.has(key)) return cache.get(key);
    const L=makeLayout(kind);
    cache.set(key,L);
    return L;
  }
  function anchorsInRange(minX,maxX){
    return ['ice','fire'].map(kind=>layoutFor(kind)).filter(L=>L && L.ax>=minX && L.ax<=maxX)
      .sort((a,b)=>a.ax-b.ax).map(L=>({kind:L.kind,x:L.ax,ax:L.ax,minX:L.minX,maxX:L.maxX,floorY:L.floorY}));
  }
  function nearest(x,dir,kind){
    const layouts = kind ? [layoutFor(kind)] : [layoutFor('ice'), layoutFor('fire')];
    const sign=dir<0?-1:1;
    let best=null, bd=Infinity;
    for(const L of layouts){
      if(!L) continue;
      const d=(L.ax-x)*sign;
      if(d<=2) continue;
      if(d<bd){ bd=d; best=L; }
    }
    return best;
  }
  function undergroundBiomeOk(x){
    // The surface mouth winds up to ~10 blocks off the anchor, so keep the whole
    // gate footprint (not just the anchor column) out of ocean/lake/city biomes.
    for(let dx=-12; dx<=12; dx+=2){
      let b=1;
      try{ b = WG.biomeType ? WG.biomeType(Math.round(x)+dx) : 1; }catch(e){}
      if(b===5 || b===6 || b===8) return false;
    }
    return true;
  }
  function undergroundSurfaceX(seed){
    const base=clamp(Math.round((WG.randSeed(seed*0.017+41.3)-0.5)*180),-220,220);
    // Keep the original seeded spot when it is already solid ground so existing
    // worlds are undisturbed; only relocate when it fell in ocean/lake/city, by
    // walking outward to the nearest clear column near the start.
    if(undergroundBiomeOk(base)) return base;
    // Radius up to 440 so the outward walk spans the full [-220,220] band from any
    // base (a base near one edge would otherwise never reach clear ground at the other).
    for(let r=1;r<=440;r++){
      const a=clamp(base-r,-220,220);
      if(a!==base && undergroundBiomeOk(a)) return a;
      const b=clamp(base+r,-220,220);
      if(b!==base && undergroundBiomeOk(b)) return b;
    }
    return base;
  }
  function undergroundAnchor(){
    const seed=Number(WG.worldSeed)||1;
    const saved=state.underground || {};
    let x=Number.isFinite(saved.x) ? Math.round(saved.x) : null;
    if(x==null) x=undergroundSurfaceX(seed);
    x=clamp(x,-220,220);
    let y=Number.isFinite(saved.y) ? Math.round(saved.y) : null;
    if(y==null) y=clamp(WORLD_H-16, surfaceAt(x)+54, WORLD_H-14);
    y=clamp(y, 86, WORLD_H-14);
    return {x,y,seed:seed|0};
  }
  function makeUndergroundGateLayout(){
    const anchor=undergroundAnchor();
    const ax=anchor.x;
    const gateY=anchor.y;
    const topY=clamp(surfaceAt(ax)-1, 8, gateY-26);
    const ops=[];
    const openCells=new Map();
    let minX=ax, maxX=ax, minY=topY, maxY=gateY;
    function bound(x,y){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return;
      ops.push({x,y,t,f:force?1:0});
      bound(x,y);
    }
    function rememberOpen(x,y){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return;
      openCells.set(x+','+y,{x,y});
    }
    function clear(x,y){ rememberOpen(x,y); put(x,y,T.AIR,true); }
    function alienWall(y,x,side){
      const r=WG.randSeed((x+side*19.7)*0.37+y*1.11+(anchor.seed||1)*0.013);
      if(r>0.82) return T.ANTIMATTER_CRYSTAL;
      if(r>0.58) return T.METEOR_DUST;
      if(r>0.36) return T.IRIDIUM;
      return T.ALIEN_BIOMASS;
    }
    function centerAt(y){
      const d=(y-topY)/Math.max(1,gateY-topY);
      const wave=Math.sin(d*Math.PI*3.2+(anchor.seed||1)*0.0009)*8;
      const small=Math.sin(y*0.29+(anchor.seed||1)*0.011)*2.3;
      return Math.round(ax+wave+small);
    }
    let prev=centerAt(topY);
    for(let y=topY-4; y<=topY+4; y++){
      const c=centerAt(clamp(y,topY,gateY));
      for(let x=c-4; x<=c+4; x++) clear(x,y);
      for(let x=c-6; x<=c+6; x++){
        if(x<c-4 || x>c+4) put(x,y,alienWall(y,x,x<c?-1:1),true);
      }
    }
    for(let y=topY; y<=gateY+1; y++){
      const c=centerAt(y);
      const a=Math.min(prev,c), b=Math.max(prev,c);
      const w=(y%19<8) ? 3 : 2;
      for(let x=a-w; x<=b+w; x++) clear(x,y);
      for(let x=a-w-2; x<=b+w+2; x++){
        if(x>=a-w && x<=b+w) continue;
        put(x,y,alienWall(y,x,x<c?-1:1),true);
      }
      if((y-topY)%11===0){
        put(c-w-2,y,T.ANTIMATTER_CRYSTAL,true);
        put(c+w+2,y,T.METEOR_DUST,true);
      }
      prev=c;
    }
    const chamberX=centerAt(gateY);
    for(let y=gateY-9; y<=gateY+8; y++){
      for(let x=chamberX-19; x<=chamberX+19; x++){
        const dx=(x-chamberX)/19, dy=(y-gateY)/9;
        const edge=dx*dx+dy*dy>0.82;
        if(edge) put(x,y,alienWall(y,x,x<chamberX?-1:1),true);
        else clear(x,y);
      }
    }
    for(let dx=-8; dx<=8; dx++){
      put(chamberX+dx,gateY+7,T.IRIDIUM,true);
      if(Math.abs(dx)>=5) put(chamberX+dx,gateY-6,T.ANTIMATTER_CRYSTAL,true);
    }
    for(let dy=-6; dy<=5; dy++){
      put(chamberX-6,gateY+dy,T.ANTIMATTER_CRYSTAL,true);
      put(chamberX+6,gateY+dy,T.ANTIMATTER_CRYSTAL,true);
    }
    for(let dx=-4; dx<=4; dx++){
      clear(chamberX+dx,gateY-4);
      clear(chamberX+dx,gateY-3);
      clear(chamberX+dx,gateY-2);
      if(Math.abs(dx)===4) put(chamberX+dx,gateY-5,T.METEOR_DUST,true);
    }
    put(chamberX,gateY+3,T.ALIEN_BIOMASS,true);
    put(chamberX-1,gateY+4,T.METEOR_DUST,true);
    put(chamberX+1,gateY+4,T.METEOR_DUST,true);
    const finalOps=new Map();
    for(const o of ops) finalOps.set(o.x+','+o.y,o);
    const bedrockHalo=new Map();
    for(const cell of openCells.values()){
      for(let yy=cell.y-6; yy<=cell.y+6; yy++){
        for(let xx=cell.x-6; xx<=cell.x+6; xx++){
          if(yy<topY+2) continue;
          const d=Math.max(Math.abs(xx-cell.x),Math.abs(yy-cell.y));
          if(d<3 || d>6) continue;
          const k=xx+','+yy;
          if(finalOps.has(k)) continue;
          bedrockHalo.set(k,{x:xx,y:yy});
        }
      }
    }
    for(const c of [...bedrockHalo.values()].sort((a,b)=>a.y-b.y || a.x-b.x)) put(c.x,c.y,T.BEDROCK,true);
    const sealCells=[];
    const sealX=centerAt(topY);
    for(let y=topY-1; y<=topY+3; y++){
      for(let x=sealX-3; x<=sealX+3; x++){
        const edge=Math.abs(x-sealX)===3 || y===topY-1 || y===topY+3;
        put(x,y,edge?T.IRIDIUM:T.ANTIMATTER_CRYSTAL,true);
        sealCells.push({x,y});
      }
    }
    return {
      kind:'underground',
      x:chamberX,
      y:gateY,
      mouthX:centerAt(topY),
      mouthY:topY,
      sealed:true,
      seal:{
        x:sealX,
        y:topY,
        cells:sealCells.length,
        bedrockCells:bedrockHalo.size,
        bedrockThickness:3
      },
      design:{
        schema:'mole_surface_gate_v2',
        zones:['sealed_mouth','bedrock_conduit','alien_antechamber'],
        sealed:true,
        bedrockThickness:3
      },
      minX:minX-2,
      maxX:maxX+2,
      minY:minY-2,
      maxY:maxY+2,
      ops,
      seed:anchor.seed
    };
  }
  function undergroundGateLayout(){
    const a=undergroundAnchor();
    const key='underground:'+a.seed+':'+a.x+':'+a.y;
    if(cache.has(key)) return cache.get(key);
    const U=makeUndergroundGateLayout();
    cache.set(key,U);
    return U;
  }
  function applyToChunk(arr,cx){
    if(!arr) return;
    const cmin=cx*CHUNK_W, cmax=cmin+CHUNK_W-1;
    for(const kind of ['fire','ice']){
      const L=layoutFor(kind);
      if(!L || L.maxX<cmin || L.minX>cmax) continue;
      for(const o of L.ops){
        if(o.x<cmin || o.x>cmax || o.y<0 || o.y>=WORLD_H) continue;
        const lx=o.x-cmin, idx=o.y*CHUNK_W+lx;
        const cur=arr[idx];
        if(o.f || isGeneratedStructureReplaceableTile(cur) || isReplaceableNaturalOpenTile(cur,true)) arr[idx]=o.t;
      }
    }
    if(state.underground && state.underground.enabled){
      const U=undergroundGateLayout();
      if(U && !(U.maxX<cmin || U.minX>cmax)){
        for(const o of U.ops){
          if(o.x<cmin || o.x>cmax || o.y<0 || o.y>=WORLD_H) continue;
          const lx=o.x-cmin, idx=o.y*CHUNK_W+lx;
          const cur=arr[idx];
          if(o.f || isGeneratedStructureReplaceableTile(cur) || isReplaceableNaturalOpenTile(cur,true)) arr[idx]=o.t;
        }
      }
    }
  }

  function addEffect(e){
    if(effects.length>=CFG.EFFECT_CAP) effects.shift();
    effects.push(e);
  }
  function addHazard(h){
    if(hazards.length>=CFG.HAZARD_CAP) hazards.shift();
    hazards.push(h);
  }
  function terrainChanged(tx,ty,getTile){
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
  }
  function setTileSafe(tx,ty,t,getTile,setTile,opts){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    if(ty<1 || ty>=WORLD_H-3) return false;
    const cur=getTile(tx,ty);
    if(cur!==T.AIR && isBlastProtectedTile(cur) && !(opts && opts.forceStory)) return false;
    const replace = opts && opts.replaceSolid;
    if(!replace && !(isReplaceableNaturalOpenTile(cur,true) || isGeneratedStructureReplaceableTile(cur) || cur===T.SNOW || cur===T.ICE)) return false;
    setTile(tx,ty,t);
    terrainChanged(tx,ty,getTile);
    return true;
  }
  function damageHero(amount, srcX, srcY, cause){
    const p=playerRef();
    if(!p || !(amount>0)) return;
    try{
      if(typeof root.damageHero === 'function'){
        root.damageHero(amount,{srcX,srcY,kb:5,kbY:-4,cause:cause||'guardian'});
        return;
      }
    }catch(e){}
    if(typeof p.hp==='number') p.hp=Math.max(0,p.hp-amount);
  }
  function damageCompanionAt(x,y,dmg,cause){
    try{
      if(MM.companions && MM.companions.damageAtWorld) return !!MM.companions.damageAtWorld(x,y,dmg,{source:'guardian',cause:cause||'guardian',srcX:x,srcY:y,knockback:4});
    }catch(e){}
    return false;
  }

  function makeEntity(kind,role,x,y,opts){
    const spec=SPEC[kind];
    const side=spec.sidekicks.find(s=>s.role===role);
    const boss=role==='boss';
    const seed=((opts && opts.seed) || seedFor(kind,x) ^ entitySeq)>>>0;
    const hp=boss ? (kind==='fire'?920:980) : (side ? side.hp : 90);
    return {
      id:entitySeq++,
      kind, role,
      name: boss ? spec.bossName : ((side && side.name) || spec.label),
      boss, x, y, vx:0, vy:0, homeX:x, homeY:y,
      hp, maxHp:hp, radius: boss ? (kind==='fire'?2.6:2.75) : ((side && side.radius)||1),
      t:0, aiT:0, attackCd: boss ? 1.6 : 1.0, specialCd: boss ? 4.0 : 2.2,
      phase:0, dir:spec.dir, seed, rng:mulberry32(seed), hitFlash:0,
      shieldHint:0, weakHint:0, awakening:(opts && opts.awakening)||0, ambient:!!(opts && opts.ambient),
      dead:false, lastContact:0,
    };
  }
  function activeKind(kind){ return entities.some(e=>!e.dead && e.kind===kind); }
  function activeBoss(kind){ return entities.find(e=>!e.dead && e.kind===kind && e.boss) || null; }
  function sidekickCount(kind){
    let n=0;
    for(const e of entities) if(!e.dead && e.kind===kind && !e.boss) n++;
    return n;
  }
  function hasHazards(kind){
    for(const h of hazards) if(h && h.kind===kind) return true;
    return false;
  }
  function clearElementActive(kind){
    for(let i=entities.length-1;i>=0;i--) if(entities[i].kind===kind) entities.splice(i,1);
    for(let i=hazards.length-1;i>=0;i--) if(hazards[i].kind===kind) hazards.splice(i,1);
    for(let i=effects.length-1;i>=0;i--) if(effects[i].kind===kind) effects.splice(i,1);
  }
  function inGuardianNeighbourhood(kind,player,L){
    if(!player || !Number.isFinite(player.x)) return true;
    L = L || layoutFor(kind);
    return Math.abs(player.x-L.ax)<=CFG.LEASH_RADIUS && Math.abs((player.y||L.floorY)-L.floorY)<=CFG.LEASH_Y;
  }
  function playerInsideGuardianArena(kind,player,L){
    if(!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
    L = L || layoutFor(kind);
    if(!L) return false;
    const hw=Math.max(0.35, finite(player.w,0.7)*0.5);
    const top=player.y-finite(player.h,0.95);
    const bottom=player.y;
    const padX=4, padTop=8, padBottom=6;
    return player.x+hw>=L.minX-padX && player.x-hw<=L.maxX+padX
      && bottom>=L.minY-padTop && top<=L.maxY+padBottom;
  }
  function sleepGuardian(kind){
    if(!SPEC[kind]) return false;
    const had=state.awakened[kind] || activeKind(kind) || hasHazards(kind);
    clearElementActive(kind);
    state.awakened[kind]=false;
    resetStorm(kind);
    resetWeather(kind);
    return !!had;
  }
  function randomEntity(kind,rng){
    let picked=null, seen=0;
    for(const e of entities){
      if(e.dead || e.kind!==kind) continue;
      seen++;
      if((rng?rng():Math.random())<1/seen) picked=e;
    }
    return picked;
  }
  function spawnGuardian(kind,role,opts){
    opts=opts||{};
    if(!SPEC[kind]) return null;
    if(entities.length>=CFG.ENTITY_CAP) return null;
    const L=layoutFor(kind);
    const boss=role==='boss';
    let x=Number.isFinite(opts.x) ? opts.x : (boss ? L.bossX : L.ax + SPEC[kind].dir*24);
    let y=Number.isFinite(opts.y) ? opts.y : (boss ? L.bossY : L.floorY-6);
    if(!boss && L.sidekickSpawns){
      const s=L.sidekickSpawns.find(v=>v.role===role);
      if(s && !Number.isFinite(opts.x)){ x=s.x; y=s.y; }
    }
    const e=makeEntity(kind,role,x,y,opts);
    entities.push(e);
    addEffect({type:'spawn',kind,x:e.x,y:e.y,t:0,max:1.1,r:boss?8:4});
    sfx(boss?'roar':'spark',{x:e.x,y:e.y});
    return e;
  }
  function awaken(kind,opts){
    opts=opts||{};
    if(!SPEC[kind]) return false;
    if(isDefeated(kind) && !opts.debug) return false;
    if(activeKind(kind) && !opts.force) return false;
    const L=layoutFor(kind);
    state.awakened[kind]=true;
    resetStorm(kind);
    resetWeather(kind);
    summonGuardianWeather(kind,true,L);
    const awakening=state.awakenSeq++;
    spawnGuardian(kind,'boss',{x:L.bossX,y:L.bossY,seed:L.seed^0xb055,awakening});
    for(const s of L.sidekickSpawns) spawnGuardian(kind,s.role,{x:s.x,y:s.y,seed:L.seed^Math.round(s.x*17),awakening});
    say(SPEC[kind].label+' awakens at '+Math.round(L.ax)+' blocks.');
    markWorldChanged();
    return true;
  }
  function spawnAmbientSidekick(kind,player){
    if(!player || isDefeated(kind)) return false;
    if(sidekickCount(kind)>=2 || activeBoss(kind)) return false;
    const spec=SPEC[kind];
    const side=spec.sidekicks[(Math.random()<0.5)?0:1];
    const ahead=spec.dir*(18+Math.random()*34);
    const x=Math.round(player.x + ahead);
    const y=finite(player.y, surfaceAt(x)-4)-4;
    const e=spawnGuardian(kind,side.role,{x,y,ambient:true,seed:seedFor(kind,x)^0xa11});
    if(e) say(side.name+' is stalking the '+(kind==='fire'?'eastern heat':'western frost')+'.');
    return !!e;
  }
  function resetStorm(kind){
    if(!SPEC[kind]) return;
    state.stormCd[kind]=null;
    state.stormMsgCd[kind]=0;
    state.stormImpactSfxCd[kind]=0;
  }
  function resetWeather(kind){
    if(!SPEC[kind]) return;
    state.weatherCd[kind]=0;
    state.lightningCarry[kind]=0;
    state.lightningRate[kind]=0;
    state.lightningMsgCd[kind]=0;
    state.cloudStrikeCd[kind]=0;
  }
  function summonGuardianWeather(kind,force,L){
    const C=MM.clouds;
    L = L || layoutFor(kind);
    if(!C || !L) return false;
    state.weatherCd[kind]-=force?999:0;
    if(!force && state.weatherCd[kind]>0) return false;
    state.weatherCd[kind]=18;
    try{ if(C.startStorm) C.startStorm(130,0.95); }catch(e){}
    const metrics=(C.metrics ? C.metrics() : null) || {};
    const cloudCount=Number(metrics.clouds)||0;
    if(C.addCloud && cloudCount<10){
      const offsets=[-70,-38,-12,16,44,76];
      for(let i=0;i<offsets.length;i++){
        const x=L.ax+offsets[i]+(Math.random()-0.5)*8;
        const alt=Math.max(3,L.floorY-42-Math.random()*14);
        const mass=22+Math.random()*18;
        try{ C.addCloud(x,alt,mass); }catch(e){}
      }
    }
    return true;
  }

  function targetPoint(p,lead){
    if(!p) return {x:0,y:0};
    return {x:p.x+(p.vx||0)*(lead||0), y:p.y+(p.vy||0)*(lead||0)};
  }
  function forEntityBodyCircle(e,fn,baseX,baseY,scale){
    const bx=Number.isFinite(baseX)?baseX:e.x, by=Number.isFinite(baseY)?baseY:e.y;
    const k=Number.isFinite(scale)?scale:1;
    if(e.kind==='fire' && e.boss){
      for(let i=0;i<9;i++){
        const a=e.t*2.4+i*0.62;
        const cx=bx - e.dir*i*1.15 + Math.sin(a)*1.5;
        const cy=by + Math.cos(a*0.9)*1.1 + i*0.12;
        if(fn(cx,cy,(i===0?1.9:1.1)*k)===false) return false;
      }
      return true;
    }
    if(e.kind==='ice' && e.boss){
      if(fn(bx,by,1.9*k)===false) return false;
      if(fn(bx-2.0,by+0.4,1.15*k)===false) return false;
      if(fn(bx+2.0,by+0.4,1.15*k)===false) return false;
      if(fn(bx,by-1.8,1.0*k)===false) return false;
      return true;
    }
    return fn(bx,by,(e.radius||1)*k)!==false;
  }
  function circleSolidAt(cx,cy,r,getTile){
    if(typeof getTile!=='function') return false;
    const minX=Math.floor(cx-r), maxX=Math.floor(cx+r);
    const minY=Math.floor(cy-r), maxY=Math.floor(cy+r);
    for(let ty=minY; ty<=maxY; ty++){
      if(ty<0 || ty>=WORLD_H) continue;
      for(let tx=minX; tx<=maxX; tx++){
        let t=T.STONE;
        try{ t=getTile(tx,ty); }catch(e){ t=T.STONE; }
        if(!isSolid(t)) continue;
        const qx=clamp(cx,tx,tx+1), qy=clamp(cy,ty,ty+1);
        if(dist2(cx,cy,qx,qy)<=r*r) return true;
      }
    }
    return false;
  }
  function entityCollidesTerrainAt(e,x,y,getTile){
    let hit=false;
    const scale=e.boss?0.72:0.82;
    forEntityBodyCircle(e,(cx,cy,r)=>{
      if(circleSolidAt(cx,cy,Math.max(0.35,r),getTile)){ hit=true; return false; }
      return true;
    },x,y,scale);
    return hit;
  }
  function nudgeEntityOutOfTerrain(e,getTile){
    if(!entityCollidesTerrainAt(e,e.x,e.y,getTile)) return false;
    const ox=e.x, oy=e.y;
    for(let r=0.25;r<=3.25;r+=0.25){
      for(let i=0;i<12;i++){
        const a=i/12*Math.PI*2;
        const nx=ox+Math.cos(a)*r, ny=oy+Math.sin(a)*r;
        if(!entityCollidesTerrainAt(e,nx,ny,getTile)){ e.x=nx; e.y=ny; e.vx=0; e.vy=0; return true; }
      }
    }
    return false;
  }
  function moveEntityPhysical(e,dt,getTile){
    if(typeof getTile!=='function'){
      e.x+=e.vx*dt; e.y+=e.vy*dt; return;
    }
    const maxDisp=Math.max(Math.abs(e.vx||0),Math.abs(e.vy||0))*dt;
    const steps=Math.min(8,Math.max(1,Math.ceil(maxDisp/0.32)));
    const sdt=dt/steps;
    for(let i=0;i<steps;i++){
      const ox=e.x, oy=e.y;
      e.x+=e.vx*sdt;
      if(entityCollidesTerrainAt(e,e.x,e.y,getTile)){ e.x=ox; e.vx=0; }
      e.y+=e.vy*sdt;
      if(entityCollidesTerrainAt(e,e.x,e.y,getTile)){ e.y=oy; e.vy=0; }
      if(e.vx===0 && e.vy===0) break;
    }
    nudgeEntityOutOfTerrain(e,getTile);
  }
  function moveToward(e,tx,ty,dt,stiff,damp,maxSpeed,getTile){
    const ax=(tx-e.x)*(stiff||2.4) - e.vx*(damp||1.9);
    const ay=(ty-e.y)*(stiff||2.4) - e.vy*(damp||1.9);
    e.vx=clamp(e.vx+ax*dt,-maxSpeed,maxSpeed);
    e.vy=clamp(e.vy+ay*dt,-maxSpeed,maxSpeed);
    moveEntityPhysical(e,dt,getTile);
  }
  function bossPhase(e){
    const f=1-clamp(e.hp/e.maxHp,0,1);
    return f>0.68?2:(f>0.36?1:0);
  }
  function sidekickShieldMult(e){
    if(!e || !e.boss) return 1;
    const n=sidekickCount(e.kind);
    if(n<=0) return 1;
    return e.kind==='fire' ? Math.max(0.48, 1-n*0.23) : Math.max(0.52, 1-n*0.21);
  }

  function spawnFireMeteor(e,p,n,L){
    L = L || layoutFor(e.kind);
    for(let i=0;i<n;i++){
      const lead=targetPoint(p,0.45+i*0.08);
      const x=clamp(lead.x + (e.rng()-0.5)*(12+i*2), L.ax-45, L.ax+45);
      const y=clamp(lead.y, L.floorY-22, L.floorY-4);
      addHazard({type:'impact',kind:'fire',x,y,r:2.4+i*0.18,t:0,delay:0.82+i*0.08,life:0.36,dmg:19+i*2,source:e.id});
    }
    say('Ignivar calls down burning stars.');
  }
  function spawnFireLance(e,p){
    const lead=targetPoint(p,0.72);
    addHazard({type:'beam',kind:'fire',x1:e.x,y1:e.y,x2:lead.x,y2:lead.y,r:0.85,t:0,delay:0.55,life:0.72,dmg:17,source:e.id});
  }
  function spawnFireRing(e,L){
    L = L || layoutFor(e.kind);
    addHazard({type:'ring',kind:'fire',x:L.ax,y:L.floorY-1,r0:5,r1:34,t:0,delay:0.38,life:1.6,dmg:13,source:e.id});
  }
  function spawnIceShards(e,p,n){
    for(let i=0;i<n;i++){
      const aim=targetPoint(p,0.48+i*0.04);
      let dx=aim.x-e.x, dy=aim.y-e.y;
      const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
      const spread=(e.rng()-0.5)*(0.24+(i%2)*0.12);
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const vx=(dx*ca-dy*sa)*(11.5+i*0.45);
      const vy=(dx*sa+dy*ca)*(11.5+i*0.45)-0.8;
      addHazard({type:'projectile',kind:'ice',x:e.x+dx*1.2,y:e.y+dy*1.2,vx,vy,r:0.35,t:0,life:4.2,dmg:11+(i%3),source:e.id});
    }
  }
  function spawnIceWalls(e,p,getTile,setTile,L){
    L = L || layoutFor(e.kind);
    const center=Math.round(clamp(p.x, L.ax-38, L.ax+38));
    const gap=Math.round(p.x);
    const cols=[center-10,center-7,center-4,center+4,center+7,center+10];
    for(const x of cols){
      if(Math.abs(x-gap)<=2) continue;
      for(let h=0;h<6;h++) setTileSafe(x,L.floorY-1-h,T.ICE,getTile,setTile,{replaceSolid:false});
      addEffect({type:'iceWall',kind:'ice',x:x+0.5,y:L.floorY-3,t:0,max:0.75,r:4});
    }
    say('Aurex raises a maze of ice.');
  }
  function spawnBlizzard(e,p,L){
    L = L || layoutFor(e.kind);
    addHazard({type:'blizzard',kind:'ice',x:clamp(p.x,L.ax-44,L.ax+44),y:clamp(p.y,L.floorY-22,L.floorY-3),r:7.5,t:0,life:4.8,dmg:5,source:e.id,pulse:0});
  }

  function updateFireBoss(e,p,getTile,dt,L){
    L = L || layoutFor(e.kind);
    const ph=bossPhase(e);
    e.phase=ph;
    const orbit=20+ph*5;
    const tx=L.ax + Math.sin(e.t*(0.72+ph*0.12))*orbit;
    const ty=L.floorY - 16 + Math.sin(e.t*1.37)*3.8 - ph*1.4;
    moveToward(e,tx,ty,dt,1.9+ph*0.4,2.0,7+ph*1.4,getTile);
    e.attackCd-=dt;
    if(e.attackCd<=0){
      const roll=e.rng();
      if(roll<0.36) spawnFireLance(e,p);
      else if(roll<0.72) spawnFireMeteor(e,p,3+ph,L);
      else spawnFireRing(e,L);
      e.attackCd=lerp(3.0,1.85,ph/2) + e.rng()*0.55;
    }
  }
  function updateIceBoss(e,p,getTile,setTile,dt,L){
    L = L || layoutFor(e.kind);
    const ph=bossPhase(e);
    e.phase=ph;
    const tx=L.ax + Math.sin(e.t*(0.58+ph*0.08))*18;
    const ty=L.floorY - 15 + Math.cos(e.t*1.15)*4.8 - ph*1.1;
    moveToward(e,tx,ty,dt,1.75+ph*0.35,2.05,6.2+ph,getTile);
    e.attackCd-=dt;
    if(e.attackCd<=0){
      const roll=e.rng();
      if(roll<0.45) spawnIceShards(e,p,5+ph*2);
      else if(roll<0.76) spawnIceWalls(e,p,getTile,setTile,L);
      else spawnBlizzard(e,p,L);
      e.attackCd=lerp(3.2,2.05,ph/2) + e.rng()*0.55;
    }
  }
  function updateSidekick(e,p,getTile,setTile,dt,L){
    L = L || layoutFor(e.kind);
    e.attackCd-=dt;
    const aim=targetPoint(p,0.3);
    if(e.kind==='fire' && e.role==='flare'){
      moveToward(e, aim.x - e.dir*9 + Math.sin(e.t*2.2)*4, clamp(aim.y-4,L.floorY-16,L.floorY-5), dt, 2.2, 2.4, 6.5,getTile);
      if(e.attackCd<=0){
        let dx=aim.x-e.x, dy=aim.y-e.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
        addHazard({type:'projectile',kind:'fire',x:e.x,y:e.y,vx:dx*8.2,vy:dy*8.2-0.4,r:0.42,t:0,life:3.5,dmg:8,source:e.id});
        e.attackCd=1.55+e.rng()*0.75;
      }
    }else if(e.kind==='fire'){
      moveToward(e, clamp(aim.x-e.dir*3,L.ax-40,L.ax+40), L.floorY-2, dt, 3.1, 2.6, 7.8,getTile);
      if(e.attackCd<=0){
        addHazard({type:'impact',kind:'fire',x:clamp(aim.x,L.ax-42,L.ax+42),y:L.floorY-1,r:1.8,t:0,delay:0.45,life:0.28,dmg:10,source:e.id});
        e.attackCd=2.1+e.rng()*0.7;
      }
    }else if(e.kind==='ice' && e.role==='mirror'){
      moveToward(e, aim.x + e.dir*8 + Math.sin(e.t*2.0)*5, clamp(aim.y-5,L.floorY-17,L.floorY-5), dt, 2.0, 2.3, 6,getTile);
      if(e.attackCd<=0){ spawnIceShards(e,p,2); e.attackCd=1.7+e.rng()*0.7; }
    }else{
      moveToward(e, clamp(aim.x+e.dir*5,L.ax-40,L.ax+40), L.floorY-2, dt, 2.8, 2.5, 5.8,getTile);
      if(e.attackCd<=0){
        const x=Math.round(clamp(aim.x,L.ax-39,L.ax+39));
        for(let h=0;h<4;h++) setTileSafe(x,L.floorY-1-h,T.ICE,getTile,setTile,{replaceSolid:false});
        addEffect({type:'iceWall',kind:'ice',x:x+0.5,y:L.floorY-2,t:0,max:0.55,r:3});
        e.attackCd=2.6+e.rng()*0.8;
      }
    }
  }
  function separateHeroFromCircle(p,cx,cy,r,e,dt){
    if(!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    const left=p.x-hw, right=p.x+hw, top=p.y-hh, bottom=p.y+hh;
    const qx=clamp(cx,left,right), qy=clamp(cy,top,bottom);
    let dx=qx-cx, dy=qy-cy;
    let d2=dx*dx+dy*dy;
    let pushOverride=null;
    if(d2>=r*r) return false;
    if(d2<0.0001){
      const dl=Math.abs(cx-left), dr=Math.abs(right-cx), dtp=Math.abs(cy-top), db=Math.abs(bottom-cy);
      const m=Math.min(dl,dr,dtp,db);
      pushOverride=Math.max(0.012,r-m+0.012);
      if(m===dl){ dx=-1; dy=0; d2=1; }
      else if(m===dr){ dx=1; dy=0; d2=1; }
      else if(m===dtp){ dx=0; dy=-1; d2=1; }
      else { dx=0; dy=1; d2=1; }
    }
    const d=Math.sqrt(d2)||1;
    const push=pushOverride!=null ? pushOverride : (r-d)+0.012;
    const nx=dx/d, ny=dy/d;
    p.x+=nx*push;
    p.y+=ny*push;
    if(nx>0.2 && (p.vx||0)<(e.vx||0)) p.vx=Math.max(p.vx||0,(e.vx||0)*0.45);
    else if(nx<-0.2 && (p.vx||0)>(e.vx||0)) p.vx=Math.min(p.vx||0,(e.vx||0)*0.45);
    if(ny<-0.55){
      if((p.vy||0)>0) p.vy=0;
      p.onGround=true;
      if(typeof p.jumpCount==='number') p.jumpCount=0;
      if(dt) p.x+=(e.vx||0)*dt*0.65;
    }else if(ny>0.45 && (p.vy||0)<0) p.vy=0;
    return true;
  }
  function separateHeroFromEntity(e,p,dt){
    if(!e || e.dead || !p) return false;
    let hit=false;
    forEntityBodyCircle(e,(cx,cy,r)=>{
      if(separateHeroFromCircle(p,cx,cy,r+(e.boss?0.05:0.16),e,dt)) hit=true;
      return true;
    },e.x,e.y,0.88);
    return hit;
  }
  function updateContact(e,p,dt){
    if(!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const touched=separateHeroFromEntity(e,p,dt) || entityHitContains(e,p.x,p.y,e.boss?0.75:0.95);
    if(touched){
      e.lastContact-=dt;
      if(e.lastContact<=0){
        damageHero(e.boss?18:9,e.x,e.y,'guardian_contact');
        e.lastContact=0.75;
      }
    }else e.lastContact=0;
  }
  function updateEntity(e,p,getTile,setTile,dt){
    e.t+=dt;
    if(e.hitFlash>0) e.hitFlash-=dt;
    if(e.weakHint>0) e.weakHint-=dt;
    if(e.stormResetMsgCd>0) e.stormResetMsgCd-=dt;
    const L=layoutFor(e.kind);
    if(e.boss){
      if(e.kind==='fire') updateFireBoss(e,p,getTile,dt,L);
      else updateIceBoss(e,p,getTile,setTile,dt,L);
    }else updateSidekick(e,p,getTile,setTile,dt,L);
    updateContact(e,p,dt);
    if(e.ambient && p && Math.abs(e.x-p.x)>120) e.dead=true;
    if(e.boss && Math.abs(e.x-L.ax)>CFG.COMBAT_RADIUS) e.dead=true;
  }

  function resetEntityHealthFromStorm(e,h){
    if(!e || e.dead) return false;
    const wasLow=e.hp<e.maxHp;
    e.hp=e.maxHp;
    e.hitFlash=0.55;
    e.shieldHint=0;
    addEffect({type:'reset',kind:e.kind,x:e.x,y:e.y,t:0,max:0.85,r:(e.radius||1)*4.2});
    if(wasLow && (!e.stormResetMsgCd || e.stormResetMsgCd<=0)){
      say(e.name+' is restored by the '+(e.kind==='fire'?'falling fire':'falling ice')+'.');
      e.stormResetMsgCd=3.5;
    }
    if(h) h.resetEntity=e.id;
    return true;
  }
  function stormMeteorEntityHit(h){
    for(const e of entities){
      if(e.dead || e.kind!==h.kind) continue;
      if(entityHitContains(e,h.x,h.y,h.r||0.35)) return e;
    }
    return null;
  }
  function stormMeteorCount(kind){
    let n=0;
    for(const h of hazards) if(h.type==='stormMeteor' && h.kind===kind) n++;
    return n;
  }
  function stormTarget(kind,boss,p,rng,L){
    L = L || layoutFor(kind);
    const roll=rng();
    if(p && roll<0.68){
      return {x:clamp(p.x+(rng()-0.5)*24,L.ax-46,L.ax+46), y:clamp(p.y,L.floorY-22,L.floorY-2)};
    }
    if(roll<0.84){
      const e=randomEntity(kind,rng);
      if(e) return {x:clamp(e.x+(rng()-0.5)*2.6,L.ax-46,L.ax+46), y:clamp(e.y,L.floorY-24,L.floorY-2)};
    }
    return {x:clamp(L.ax+(rng()-0.5)*92,L.ax-46,L.ax+46), y:L.floorY-2};
  }
  function entityHitScore(e,x,y,extraR){
    const add=extraR||0;
    let best=Infinity;
    if(e.kind==='fire' && e.boss){
      for(let i=0;i<9;i++){
        const a=e.t*2.4+i*0.62;
        const cx=e.x - e.dir*i*1.15 + Math.sin(a)*1.5;
        const cy=e.y + Math.cos(a*0.9)*1.1 + i*0.12;
        const r=(i===0?1.9:1.1)+add;
        const d=dist2(x,y,cx,cy);
        if(d<=r*r && d<best) best=d;
      }
      return best;
    }
    if(e.kind==='ice' && e.boss){
      let r=1.9+add;
      let d=dist2(x,y,e.x,e.y);
      if(d<=r*r) best=d;
      r=1.15+add;
      d=dist2(x,y,e.x-2.0,e.y+0.4);
      if(d<=r*r && d<best) best=d;
      d=dist2(x,y,e.x+2.0,e.y+0.4);
      if(d<=r*r && d<best) best=d;
      r=1.0+add;
      d=dist2(x,y,e.x,e.y-1.8);
      if(d<=r*r && d<best) best=d;
      return best;
    }
    const r=(e.radius||1)+add;
    const d=dist2(x,y,e.x,e.y);
    return d<=r*r ? d : Infinity;
  }
  function entityHitContains(e,x,y,extraR){
    return entityHitScore(e,x,y,extraR)<Infinity;
  }
  function spawnStormMeteor(kind,boss,p,L){
    L = L || layoutFor(kind);
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    const target=stormTarget(kind,boss,p,rng,L);
    const side=rng()<0.5?-1:1;
    const fallTime=CFG.STORM_FALL_MIN+rng()*(CFG.STORM_FALL_MAX-CFG.STORM_FALL_MIN);
    const startX=target.x - side*(7+rng()*9);
    const startY=Math.min(L.floorY-26, target.y-18-rng()*10);
    const impactY=clamp(Math.max(target.y+1,L.floorY-1+(rng()-0.5)*4),3,WORLD_H-5);
    const aimX=target.x+(rng()-0.5)*1.2;
    const vx=(aimX-startX)/fallTime;
    const vy=(impactY-startY)/fallTime;
    const speed=Math.sqrt(vx*vx+vy*vy);
    addHazard({
      type:'stormMeteor',kind,x:startX,y:startY,vx,vy,r:kind==='fire'?0.42:0.48,t:0,life:fallTime+0.45,
      speed,impactY,dmg:kind==='fire'?25:22,trail:[],explodeR:kind==='fire'?7.2:6.6,
      intensity:CFG.STORM_IMPACT_INTENSITY,source:boss?boss.id:0
    });
  }
  function stormInterval(kind,boss){
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    return CFG.STORM_MIN_INTERVAL + rng()*(CFG.STORM_MAX_INTERVAL-CFG.STORM_MIN_INTERVAL);
  }
  function scheduleStormMeteor(kind,boss){
    state.stormCd[kind]=stormInterval(kind,boss);
  }
  function updateStorm(kind,boss,p,dt,L){
    state.stormImpactSfxCd[kind]=Math.max(0,(state.stormImpactSfxCd[kind]||0)-dt);
    if(!boss || boss.dead || !(boss.hp/boss.maxHp<0.5)){ state.stormCd[kind]=null; return; }
    L = L || layoutFor(kind);
    state.stormMsgCd[kind]-=dt;
    if(state.stormMsgCd[kind]<=0){
      say((kind==='fire'?'The eastern sky opens in fire.':'The western sky breaks into ice.'));
      state.stormMsgCd[kind]=9.5;
    }
    if(state.stormCd[kind]==null){
      scheduleStormMeteor(kind,boss);
      return;
    }
    state.stormCd[kind]-=dt;
    if(state.stormCd[kind]>0) return;
    if(stormMeteorCount(kind)>=CFG.STORM_LIVE_CAP){
      state.stormCd[kind]=0.25;
      return;
    }
    spawnStormMeteor(kind,boss,p,L);
    scheduleStormMeteor(kind,boss);
  }
  function lightningTarget(kind,boss,p,rng,L){
    L = L || layoutFor(kind);
    const roll=rng();
    if(p && roll<0.72){
      return {x:clamp(p.x+(rng()-0.5)*14,L.ax-48,L.ax+48), y:L.floorY-1};
    }
    if(roll<0.88){
      const e=randomEntity(kind,rng);
      if(e) return {x:clamp(e.x+(rng()-0.5)*5,L.ax-48,L.ax+48), y:L.floorY-1};
    }
    return {x:clamp(L.ax+(rng()-0.5)*96,L.ax-48,L.ax+48), y:L.floorY-1};
  }
  function lightningBranches(x0,y0,x1,y1,rng){
    const branches=[];
    const n=2+Math.floor(rng()*3);
    for(let i=0;i<n;i++){
      const f=0.18+rng()*0.58;
      const sx=lerp(x0,x1,f)+(rng()-0.5)*2.5;
      const sy=lerp(y0,y1,f);
      const len=2.2+rng()*4.2;
      const dir=rng()<0.5?-1:1;
      branches.push({x1:sx,y1:sy,x2:sx+dir*(2+rng()*5),y2:sy+len});
    }
    return branches;
  }
  function spawnSkyLightning(kind,boss,p,L){
    L = L || layoutFor(kind);
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    const target=lightningTarget(kind,boss,p,rng,L);
    const fromY=Math.max(2,L.floorY-48-rng()*18);
    const fromX=target.x+(rng()-0.5)*10;
    addHazard({
      type:'skyLightning',kind,x1:fromX,y1:fromY,x2:target.x,y2:target.y,r:1.45,t:0,delay:0.08+rng()*0.12,life:0.28,
      dmg:kind==='fire'?16:15,branches:lightningBranches(fromX,fromY,target.x,target.y,rng),hit:false,source:boss?boss.id:0
    });
  }
  function impactLightningTerrain(h,getTile,setTile){
    const tx=Math.round(h.x2), ty=Math.round(h.y2);
    if(h.kind==='fire'){
      setTileSafe(tx,ty,T.HOT_AIR,getTile,setTile,{replaceSolid:false});
      try{ if(MM.fire && MM.fire.ignite) MM.fire.ignite(tx,ty,getTile,setTile); }catch(e){}
    }else{
      setTileSafe(tx,ty,T.ICE,getTile,setTile,{replaceSolid:false});
      setTileSafe(tx,ty-1,T.SNOW,getTile,setTile,{replaceSolid:false});
    }
    addEffect({type:'burst',kind:h.kind,x:h.x2,y:h.y2,t:0,max:0.32,r:4.5});
  }
  function emitStormImpactFx(h){
    const tile=MM.TILE||20;
    try{
      if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(h.x*tile,h.y*tile,'epic',{sound:false});
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(h.x*tile,h.y*tile,h.kind==='fire'?'epic':'rare',14);
      if(h.kind==='fire' && MM.particles && MM.particles.spawnSmoke) MM.particles.spawnSmoke(h.x*tile,h.y*tile,1.2,{tileX:Math.floor(h.x),tileY:Math.floor(h.y),tileSize:tile});
    }catch(e){}
    if(state.stormImpactSfxCd[h.kind]<=0){
      sfx('explosion',{x:h.x,y:h.y});
      state.stormImpactSfxCd[h.kind]=0.18;
    }
  }
  function updateLightningWeather(kind,boss,p,dt,getTile,setTile,L){
    state.weatherCd[kind]=Math.max(0,(state.weatherCd[kind]||0)-dt);
    if(!boss || boss.dead) return;
    L = L || layoutFor(kind);
    summonGuardianWeather(kind,false,L);
    const hpFrac=boss.hp/boss.maxHp;
    if(!(hpFrac<CFG.LIGHTNING_THRESHOLD)){
      state.lightningCarry[kind]=0;
      return;
    }
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    if(!(state.lightningRate[kind]>0)) state.lightningRate[kind]=CFG.LIGHTNING_MIN_RATE + rng()*(CFG.LIGHTNING_MAX_RATE-CFG.LIGHTNING_MIN_RATE);
    state.lightningMsgCd[kind]-=dt;
    if(state.lightningMsgCd[kind]<=0){
      say((kind==='fire'?'Ignivar burns the storm open.':'Aurex fractures the stormfront.'));
      state.lightningMsgCd[kind]=8.5;
    }
    state.lightningCarry[kind]+=dt*state.lightningRate[kind];
    const n=Math.min(4,Math.floor(state.lightningCarry[kind]));
    if(n>0){
      state.lightningCarry[kind]-=n;
      for(let i=0;i<n;i++) spawnSkyLightning(kind,boss,p,L);
    }
    state.cloudStrikeCd[kind]-=dt;
    if(state.cloudStrikeCd[kind]<=0){
      const x=clamp((p && Number.isFinite(p.x) ? p.x : L.ax)+(rng()-0.5)*52,L.ax-52,L.ax+52);
      try{ if(MM.clouds && MM.clouds.strike) MM.clouds.strike(x,getTile,setTile); }catch(e){}
      state.cloudStrikeCd[kind]=0.45+rng()*0.35;
    }
  }

  function impactTerrain(h,getTile,setTile){
    const tx=Math.round(h.x), ty=Math.round(h.y);
    const storm=h.type==='stormMeteor';
    const burstR=storm ? (h.explodeR || (h.kind==='fire'?7.2:6.6)) : null;
    if(storm){
      const M=MM.meteorites;
      if(M && typeof M.impactAt==='function'){
        try{
          const classId=h.kind==='ice' ? 'ice' : 'iron';
          const intensity=Number.isFinite(h.intensity) ? h.intensity : CFG.STORM_IMPACT_INTENSITY;
          return M.impactAt(h.x,h.y,getTile,setTile,intensity,null,{classId,site:'guardian_lair',skipActorDamage:true});
        }catch(e){}
      }
      emitStormImpactFx(h);
    }
    if(h.kind==='fire'){
      for(let dx=-1;dx<=1;dx++) setTileSafe(tx+dx,ty,T.LAVA,getTile,setTile,{replaceSolid:false});
      if(storm){
        for(let dx=-1;dx<=1;dx++) setTileSafe(tx+dx,ty-1,T.LAVA,getTile,setTile,{replaceSolid:false});
        setTileSafe(tx,ty-2,T.HOT_AIR,getTile,setTile,{replaceSolid:false});
      }
      try{ if(MM.fire && MM.fire.ignite) for(let i=0;i<5;i++) MM.fire.ignite(tx-2+i,ty,getTile,setTile); }catch(e){}
      addEffect({type:'burst',kind:'fire',x:h.x,y:h.y,t:0,max:storm?0.95:0.7,r:burstR || (h.r||2.5)*2.2});
    }else{
      for(let dx=-2;dx<=2;dx++) setTileSafe(tx+dx,ty,T.ICE,getTile,setTile,{replaceSolid:false});
      if(storm) for(let dx=-2;dx<=2;dx++) setTileSafe(tx+dx,ty-1,T.ICE,getTile,setTile,{replaceSolid:false});
      setTileSafe(tx,ty-1,T.SNOW,getTile,setTile,{replaceSolid:false});
      addEffect({type:'burst',kind:'ice',x:h.x,y:h.y,t:0,max:storm?0.95:0.75,r:burstR || (h.r||2.2)*2.0});
    }
  }
  function pointLineDist(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1, len2=dx*dx+dy*dy || 1;
    const t=clamp(((px-x1)*dx+(py-y1)*dy)/len2,0,1);
    const x=x1+dx*t, y=y1+dy*t;
    return Math.hypot(px-x,py-y);
  }
  function clipLineToSolid(x1,y1,x2,y2,getTile){
    if(typeof getTile!=='function') return null;
    const dx=x2-x1, dy=y2-y1;
    const steps=Math.max(1,Math.min(80,Math.ceil(Math.sqrt(dx*dx+dy*dy)/0.35)));
    let last={x:x1,y:y1};
    for(let i=1;i<=steps;i++){
      const f=i/steps, x=x1+dx*f, y=y1+dy*f;
      let solid=false;
      try{ solid=isSolid(getTile(Math.floor(x),Math.floor(y))); }catch(e){ solid=true; }
      if(solid) return last;
      last={x,y};
    }
    return null;
  }
  function updateHazards(dt,p,getTile,setTile){
    for(let i=hazards.length-1;i>=0;i--){
      const h=hazards[i];
      h.t+=dt;
      let remove=false;
      if(h.type==='skyLightning'){
        if(h.t>=h.delay && !h.hit){
          h.hit=true;
          if(p && pointLineDist(p.x,p.y,h.x1,h.y1,h.x2,h.y2)<h.r) damageHero(h.dmg,h.x2,h.y2,'guardian_lightning');
          damageCompanionAt(h.x2,h.y2,h.dmg,'guardian_lightning');
          impactLightningTerrain(h,getTile,setTile);
        }
        remove=h.t>h.delay+h.life;
      }else if(h.type==='stormMeteor'){
        const speed=h.speed || Math.hypot(h.vx||0,h.vy||0);
        const steps=clamp(Math.ceil(speed*dt/0.72),1,8);
        const sdt=dt/steps;
        for(let s=0;s<steps;s++){
          h.x+=(h.vx||0)*sdt;
          h.y+=(h.vy||0)*sdt;
          if(!h.trail) h.trail=[];
          const last=h.trail[h.trail.length-1];
          if(!last || dist2(h.x,h.y,last.x,last.y)>1.0){
            h.trail.push({x:h.x,y:h.y,t:h.t});
            if(h.trail.length>10) h.trail.shift();
          }
          const struck=stormMeteorEntityHit(h);
          if(struck){
            resetEntityHealthFromStorm(struck,h);
            impactTerrain(h,getTile,setTile);
            remove=true;
            break;
          }
          if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+0.78)*(h.r+0.78)){
            damageHero(h.dmg,h.x,h.y,'guardian_storm_meteor');
            impactTerrain(h,getTile,setTile);
            remove=true;
            break;
          }
          let struckBlock=false;
          if(typeof getTile==='function'){
            try{ struckBlock=isSolid(getTile(Math.floor(h.x),Math.floor(h.y))); }catch(e){ struckBlock=true; }
          }
          if(struckBlock || h.y>=h.impactY || h.t>h.life){
            if(!struckBlock) h.y=h.impactY;
            const landed=stormMeteorEntityHit(h);
            if(landed) resetEntityHealthFromStorm(landed,h);
            if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+1.25)*(h.r+1.25)) damageHero(h.dmg,h.x,h.y,'guardian_storm_meteor');
            damageCompanionAt(h.x,h.y,h.dmg,'guardian_storm_meteor');
            impactTerrain(h,getTile,setTile);
            remove=true;
            break;
          }
        }
      }else if(h.type==='projectile'){
        h.x+=h.vx*dt; h.y+=h.vy*dt; h.vy+=(h.kind==='fire'?4.5:2.2)*dt;
        if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+0.75)*(h.r+0.75)){ damageHero(h.dmg,h.x,h.y,'guardian_projectile'); remove=true; }
        else if(damageCompanionAt(h.x,h.y,h.dmg,'guardian_projectile')) remove=true;
        else if(h.t>h.life || h.y>WORLD_H+5) remove=true;
        else if(typeof getTile==='function' && !isReplaceableNaturalOpenTile(getTile(Math.floor(h.x),Math.floor(h.y)),true)) remove=true;
        if(remove) impactTerrain(h,getTile,setTile);
      }else if(h.type==='impact'){
        if(h.t>=h.delay && !h.hit){
          h.hit=true;
          if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+0.85)*(h.r+0.85)) damageHero(h.dmg,h.x,h.y,'guardian_impact');
          damageCompanionAt(h.x,h.y,h.dmg,'guardian_impact');
          impactTerrain(h,getTile,setTile);
        }
        remove=h.t>h.delay+h.life;
      }else if(h.type==='beam'){
        if(h.t>=h.delay){
          if(!h.clipped){
            const hit=clipLineToSolid(h.x1,h.y1,h.x2,h.y2,getTile);
            if(hit){ h.x2=hit.x; h.y2=hit.y; }
            h.clipped=true;
          }
          const f=(h.t-h.delay)/Math.max(0.01,h.life);
          if(p && pointLineDist(p.x,p.y,h.x1,h.y1,h.x2,h.y2)<h.r+0.45) damageHero(h.dmg,h.x1,h.y1,'guardian_beam');
          if(f>0.25 && !h.scored){
            h.scored=true;
            const steps=10;
            for(let s=2;s<steps;s+=2){
              const x=h.x1+(h.x2-h.x1)*(s/steps), y=h.y1+(h.y2-h.y1)*(s/steps);
              if(h.kind==='fire') setTileSafe(Math.round(x),Math.round(y),T.HOT_AIR,getTile,setTile,{replaceSolid:false});
            }
          }
        }
        remove=h.t>h.delay+h.life;
      }else if(h.type==='ring'){
        if(h.t>=h.delay){
          const f=clamp((h.t-h.delay)/h.life,0,1);
          const r=lerp(h.r0,h.r1,f);
          if(p){
            const d=Math.hypot(p.x-h.x,p.y-h.y);
            if(Math.abs(d-r)<1.5) damageHero(h.dmg,h.x,h.y,'guardian_ring');
          }
          if(!h.scored && f>0.55){
            h.scored=true;
            for(let k=0;k<16;k++){
              const a=k/16*Math.PI*2;
              setTileSafe(Math.round(h.x+Math.cos(a)*r),Math.round(h.y+Math.sin(a)*r),T.LAVA,getTile,setTile,{replaceSolid:false});
            }
          }
        }
        remove=h.t>h.delay+h.life+0.15;
      }else if(h.type==='blizzard'){
        h.pulse=(h.pulse||0)-dt;
        if(p && dist2(h.x,h.y,p.x,p.y)<h.r*h.r){
          if(h.pulse<=0){ damageHero(h.dmg,h.x,h.y,'guardian_blizzard'); h.pulse=0.55; }
          if(typeof p.vx==='number') p.vx*=0.88;
        }
        if(h.t>h.life) remove=true;
      }
      if(remove) hazards.splice(i,1);
    }
  }
  function updateEffects(dt){
    for(let i=effects.length-1;i>=0;i--){ const e=effects[i]; e.t+=dt; if(e.t>e.max) effects.splice(i,1); }
  }
  function updateGhosts(dt,player){
    for(const kind of ['fire','ice']){
      const g=state.ghosts[kind];
      if(!g) continue;
      g.t=(Number(g.t)||0)+dt;
      g.talkT=Math.max(0,(Number(g.talkT)||0)-dt);
      if(player && Number.isFinite(player.x) && dist2(player.x,player.y||g.y,g.x,g.y)<CFG.GHOST_TALK_RADIUS*CFG.GHOST_TALK_RADIUS){
        g.talkT=Math.max(g.talkT,5.5);
        g.seen=true;
      }
    }
  }
  function terrainAccess(getTile,setTile){
    const W=MM.world || root.world;
    return {
      getTile: typeof getTile==='function' ? getTile : (lastGetTile || (W && W.getTile)),
      setTile: typeof setTile==='function' ? setTile : (lastSetTile || (W && W.setTile))
    };
  }
  function protectHeroFromDeathBlast(){
    const p=playerRef();
    if(!p) return;
    const now=(root.performance && root.performance.now) ? root.performance.now() : Date.now();
    p.hpInvul=Math.max(Number(p.hpInvul)||0, now+CFG.DEATH_BLAST_GRACE_MS);
    if(Number.isFinite(p.hp) && p.hp<1) p.hp=1;
  }
  function guardianDeathBlast(e,getTile,setTile){
    if(!e || !e.boss) return false;
    addEffect({type:'burst',kind:e.kind,x:e.x,y:e.y,t:0,max:2.2,r:34});
    protectHeroFromDeathBlast();
    const M=MM.meteorites;
    const access=terrainAccess(getTile,setTile);
    if(!M || typeof M.impactAt!=='function' || typeof access.getTile!=='function' || typeof access.setTile!=='function') return false;
    const L=layoutFor(e.kind);
    const classId=e.kind==='ice' ? 'ice' : 'iron';
    try{
      return !!M.impactAt(e.x,L.floorY-1,access.getTile,access.setTile,CFG.DEATH_BLAST_INTENSITY,null,{
        classId,
        site:'guardian_defeat',
        surfaceY:L.floorY-1,
        colossal:true,
        scale:CFG.DEATH_BLAST_SCALE,
        skipActorDamage:true
      });
    }catch(err){ return false; }
  }
  function roughItemScore(item){
    if(!item) return 0;
    let s=0;
    if(typeof item.attackDamage==='number') s+=item.attackDamage*6;
    if(typeof item.fireDps==='number') s+=item.fireDps*5;
    if(typeof item.fireRange==='number') s+=item.fireRange*2;
    if(typeof item.energyCost==='number') s-=item.energyCost*0.45;
    if(typeof item.energyCapacityBonus==='number') s+=item.energyCapacityBonus*0.55;
    if(item.weaponType==='bow' && typeof item.fireCooldown==='number') s+=(0.6-item.fireCooldown)*40;
    return Math.max(0,Math.round(s));
  }
  function itemScore(item){
    try{ if(MM.inventory && MM.inventory.itemScore) return Number(MM.inventory.itemScore(item))||0; }catch(e){}
    return roughItemScore(item);
  }
  function bestWeaponScore(){
    const INV=MM.inventory;
    let best=0;
    try{
      if(INV && INV.items){
        const list=INV.items('weapon') || [];
        for(const it of list) best=Math.max(best,itemScore(it));
      }
    }catch(e){}
    try{
      if(INV && INV.equippedItem) best=Math.max(best,itemScore(INV.equippedItem('weapon')));
    }catch(e){}
    return best;
  }
  function scaleRewardAbove(item,minScore){
    const want=Math.max(90,Number(minScore)||0);
    let score=itemScore(item);
    if(score>want) return item;
    const add=Math.ceil((want+28-score)/5);
    item.fireDps=Math.max(Number(item.fireDps)||0, (Number(item.fireDps)||0)+add);
    return item;
  }
  function makeGhostRewardItem(kind){
    const best=bestWeaponScore();
    if(kind==='fire'){
      return scaleRewardAbove({
        id:'guardian_fire_relic',
        kind:'weapon',
        weaponType:'flame',
        name:'Solar Mercy',
        tier:'epic',
        unique:'guardian_fire',
        fireDps:24,
        fireRange:12.5,
        energyCapacityBonus:50,
        desc:'A released gatekeeper relic. Its stream outclasses your old weapons.'
      }, best+45);
    }
    return scaleRewardAbove({
      id:'guardian_ice_relic',
      kind:'weapon',
      weaponType:'electric',
      name:'Rime Quietus',
      tier:'epic',
      unique:'guardian_ice',
      fireDps:26,
      fireRange:13,
      energyCost:4,
      energyCapacityBonus:90,
      desc:'A released gatekeeper relic. Cold logic bends into a perfect beam.'
    }, best+45);
  }
  function grantFallbackGhostReward(kind){
    const inv=root.inv;
    if(!inv) return false;
    if(typeof inv.iridium==='number') inv.iridium+=18;
    if(typeof inv.meteorDust==='number') inv.meteorDust+=40;
    if(typeof inv.antimatter==='number') inv.antimatter+=8;
    try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
    say((kind==='fire'?'Solar':'Rime')+' ghost leaves rare matter in your pack.');
    return true;
  }
  function grantGhostReward(kind){
    const g=state.ghosts[kind];
    if(!g || g.rewarded) return false;
    const item=makeGhostRewardItem(kind);
    let ok=false;
    try{ ok=!!(MM.inventory && MM.inventory.grantItem && MM.inventory.grantItem(item,{equip:true,essential:true,markNew:true})); }catch(e){ ok=false; }
    if(!ok) ok=grantFallbackGhostReward(kind);
    if(ok){
      g.rewarded=true;
      g.rewardId=item.id;
      say('The released guardian grants '+item.name+'.');
      markWorldChanged();
    }
    return ok;
  }
  function guardiansBothDefeated(){
    return isDefeated('fire') && isDefeated('ice');
  }
  function ghostSpeech(kind){
    const other=kind==='fire'?'ice':'fire';
    const metaphor = STORY_LORE.metaphor && STORY_LORE.metaphor.guardians ? STORY_LORE.metaphor.guardians : {};
    const selfMeta = kind==='fire' ? metaphor.east_fire : metaphor.west_ice;
    const otherMeta = other==='fire' ? metaphor.east_fire : metaphor.west_ice;
    const selfLine = selfMeta && selfMeta.symbol ? ' I wore the shape of '+selfMeta.symbol+'.' : '';
    const otherLine = otherMeta && otherMeta.symbol ? ' The next gate carries '+otherMeta.symbol+'.' : '';
    if(guardiansBothDefeated()){
      return 'The simulation lets me breathe at last. Fire and ice are free.'+selfLine+' Near the first steps of this world, an alien passage has opened downward to the underground gate.';
    }
    if(other==='ice'){
      return 'The simulation lets me breathe at last. I guarded this gate because the code demanded it.'+selfLine+otherLine+' The west still holds ice: seek Aurex beyond -10000 blocks.';
    }
    return 'The simulation lets me breathe at last. I guarded this gate because the code demanded it.'+selfLine+otherLine+' The east still holds fire: seek Ignivar beyond +10000 blocks.';
  }
  function ghostGroundY(kind,x,fallbackY,getTile){
    const L=layoutFor(kind);
    const start=Math.max(2,Math.floor(Math.min(fallbackY,L.floorY)-18));
    const end=Math.min(WORLD_H-4,Math.floor(L.floorY+18));
    if(typeof getTile==='function'){
      for(let y=start;y<=end;y++){
        try{
          const here=getTile(Math.round(x),y);
          const below=getTile(Math.round(x),y+1);
          if(!isSolid(here) && isSolid(below)) return y+0.15;
        }catch(e){}
      }
    }
    return clamp(fallbackY,3,WORLD_H-5);
  }
  function spawnGuardianGhost(kind,e){
    if(!SPEC[kind]) return null;
    const L=layoutFor(kind);
    const p=playerRef();
    const old=state.ghosts[kind] || {};
    const nearPlayer=!!(p && inGuardianNeighbourhood(kind,p));
    const side=(p && Number.isFinite(p.x) && p.x<L.ax) ? 1 : -1;
    const access=terrainAccess();
    let x=nearPlayer ? p.x+side*2.4 : ((e && Number.isFinite(e.x)) ? e.x-SPEC[kind].dir*4 : L.ax);
    x=clamp(x,L.ax-42,L.ax+42);
    const fallbackY=nearPlayer ? (p.y-0.5) : L.floorY-4;
    const y=ghostGroundY(kind,x,fallbackY,access.getTile);
    const g={
      kind,
      x,
      y,
      t:0,
      talkT:14,
      rewarded:!!old.rewarded,
      rewardId:old.rewardId || null,
      seen:!!old.seen
    };
    state.ghosts[kind]=g;
    grantGhostReward(kind);
    say(ghostSpeech(kind));
    addEffect({type:'burst',kind,x:g.x,y:g.y,t:0,max:1.6,r:8});
    markWorldChanged();
    return g;
  }
  function materializeUndergroundGate(getTile,setTile){
    if(!state.underground || !state.underground.enabled) return 0;
    const access=terrainAccess(getTile,setTile);
    if(typeof access.getTile!=='function' || typeof access.setTile!=='function') return 0;
    const U=undergroundGateLayout();
    let changed=0;
    for(const o of U.ops){
      let cur=null;
      try{ cur=access.getTile(o.x,o.y); }catch(e){ cur=null; }
      if(cur===o.t) continue;
      if(setTileSafe(o.x,o.y,o.t,access.getTile,access.setTile,{replaceSolid:true,forceStory:true})) changed++;
    }
    if(changed>0){
      state.underground.materialized=true;
      markWorldChanged();
    }
    return changed;
  }
  function enableUndergroundGate(getTile,setTile,opts){
    opts=opts||{};
    if(!opts.force && !guardiansBothDefeated()) return false;
    const anchor=undergroundAnchor();
    const was=!state.underground.enabled;
    state.underground.enabled=true;
    state.underground.x=anchor.x;
    state.underground.y=anchor.y;
    state.underground.seed=anchor.seed;
    const changed=(state.underground.materialized && !opts.force) ? 0 : materializeUndergroundGate(getTile,setTile);
    if(was){
      const U=undergroundGateLayout();
      say('An alien passage opens near '+Math.round(U.mouthX)+'. It descends to the underground gate.');
      markWorldChanged();
    }
    return was || changed>0;
  }
  function maybeEnableUndergroundGate(getTile,setTile){
    if(!guardiansBothDefeated()) return false;
    return enableUndergroundGate(getTile,setTile);
  }

  function awardHeart(kind){
    const spec=SPEC[kind];
    let newly=true, progressHandled=false;
    try{ if(MM.progress && MM.progress.markGuardianHeart){ newly=!!MM.progress.markGuardianHeart(kind); progressHandled=true; } }catch(e){}
    if(!progressHandled){
      const inv=root.inv;
      newly=!(inv && (Number(inv[spec.heartKey])||0)>0);
    }
    state.defeated[kind]=true;
    state.awakened[kind]=false;
    if(newly){
      const inv=root.inv;
      if(inv && spec.heartKey){ inv[spec.heartKey]=(Number(inv[spec.heartKey])||0)+1; }
      try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
      say(spec.heartLabel+' acquired.');
    }else say(spec.heartLabel+' already beats in your story.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-guardian-defeated',{detail:{kind,name:spec.bossName,heart:spec.heartKey,newReward:newly}})); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-boss-killed',{detail:{name:spec.bossName,guardian:true,kind}})); }catch(e){}
    try{ if(MM.guardianAftermath && MM.guardianAftermath.start) MM.guardianAftermath.start(kind); }catch(e){}
    markWorldChanged();
  }
  function defeatEntity(e){
    if(!e || e.dead) return;
    e.dead=true;
    addEffect({type:'burst',kind:e.kind,x:e.x,y:e.y,t:0,max:e.boss?1.35:0.8,r:e.boss?14:6});
    sfx(e.boss?'explosion':'spark',{x:e.x,y:e.y});
    if(e.boss){
      guardianDeathBlast(e);
      awardHeart(e.kind);
      spawnGuardianGhost(e.kind,e);
      maybeEnableUndergroundGate();
      resetStorm(e.kind);
      resetWeather(e.kind);
      for(const other of entities){ if(other.kind===e.kind) other.dead=true; }
      // Signature relics rain from the felled guardian (engine/drops.js)
      try{ if(MM.drops && MM.drops.rollGuardianDrop) MM.drops.rollGuardianDrop(e.kind,e.x,e.y,{boss:true}); }catch(err){}
    }else{
      say(e.name+' breaks.');
      try{ if(MM.drops && MM.drops.rollGuardianDrop) MM.drops.rollGuardianDrop(e.kind,e.x,e.y,{role:e.role}); }catch(err){}
    }
  }
  function weaponElement(opts){
    if(!opts) return '';
    const raw=[
      opts.element,
      opts.kind,
      opts.type,
      opts.stream,
      opts.cause,
      opts.weaponType
    ].filter(v=>v!=null).join(' ').toLowerCase();
    if(/\b(hose|water|aqua|wet|douse)\b/.test(raw)) return 'water';
    if(/\b(flame|fire|heat|burn)\b/.test(raw)) return 'fire';
    return raw;
  }
  function guardianWeaknessMultiplier(e,opts){
    if(!e || !opts) return 1;
    const element=weaponElement(opts);
    if(e.kind==='fire' && element==='water') return e.boss ? 4.25 : 3.35;
    if(e.kind==='ice' && element==='fire') return e.boss ? 2.45 : 2.05;
    return 1;
  }
  function announceWeaknessHit(e,element){
    if(!e || e.weakHint>0) return;
    if(e.kind==='fire' && element==='water') say(e.name+' hisses and cracks under the water jet.');
    else if(e.kind==='ice' && element==='fire') say(e.name+' fractures under the flame.');
    e.weakHint=2.0;
  }
  function noteCombatEvent(detail){
    try{
      if(typeof window!=='undefined' && typeof window.dispatchEvent==='function' && typeof CustomEvent==='function'){
        window.dispatchEvent(new CustomEvent('mm-combat-event',{detail}));
      }
    }catch(e){}
  }
  function hitEntity(e,dmg,opts){
    if(!e || e.dead || !(dmg>0)) return false;
    let amount=Math.max(0.5,dmg);
    if(e.boss){
      const mult=sidekickShieldMult(e);
      amount*=mult;
      if(mult<0.95 && e.shieldHint<=0){ say(e.name+' is shielded by its sidekicks.'); e.shieldHint=2.5; }
    }
    const element=weaponElement(opts);
    // weakened elemental matrix (boss_status.js): a soaked guardian conducts
    const conduct=/electric|shock|laser|lightning/.test(element) ? bossElectricDamageMult(e._elemStatus) : 1;
    if(conduct>1) amount*=conduct;
    const weak=guardianWeaknessMultiplier(e,opts);
    if(weak>1){
      amount*=weak;
      announceWeaknessHit(e,element);
      addEffect({type:'burst',kind:e.kind,x:e.x,y:e.y,t:0,max:0.32,r:(e.radius||1)*3.2});
      noteCombatEvent({
        kind:'elemental',
        source:'hero',
        target:'guardian',
        x:e.x,
        y:e.y-0.55,
        amount,
        element,
        cause:element==='fire'?'heat_bonus':'water_bonus',
        bonusDamagePct:Math.round((weak-1)*100),
        major:true,
        power:Math.max(1.15,Math.min(2.4,weak*0.55))
      });
    }
    e.hp-=amount;
    e.hitFlash=0.18;
    e.shieldHint=Math.max(0,(e.shieldHint||0)-0.1);
    addEffect({type:'hit',kind:e.kind,x:e.x,y:e.y,t:0,max:0.24,r:e.radius*2});
    if(e.hp<=0) defeatEntity(e);
    return true;
  }
  function entityAtTile(tx,ty){
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    const x=tx+0.5, y=ty+0.5;
    let best=null, bd=Infinity;
    for(const e of entities){
      if(e.dead) continue;
      const d=entityHitScore(e,x,y,0.55);
      if(d<bd){ bd=d; best=e; }
    }
    return best;
  }
  function damageAt(tx,ty,dmg,opts){
    const e=entityAtTile(tx,ty);
    if(!e) return false;
    return hitEntity(e, Math.max(0.5, Number(dmg)||1), opts);
  }
  function attackAt(tx,ty,bonus){
    return damageAt(tx,ty, 4+Math.max(0,Number(bonus)||0));
  }
  function targetsForTurret(sx,sy,range,onlyBoss){
    const out=[];
    const r2=(Number(range)||0)*(Number(range)||0);
    for(const e of entities){
      if(e.dead) continue;
      if(onlyBoss && onlyBoss!==true && onlyBoss!==e) continue;
      if(onlyBoss===true && !e.boss) continue;
      const d2=dist2(sx,sy,e.x,e.y);
      if(d2>r2) continue;
      out.push({kind:'guardian',guardian:e,raw:e,x:e.x,y:e.y,tx:Math.floor(e.x),ty:Math.floor(e.y),hp:e.hp,d2});
    }
    out.sort((a,b)=>a.d2-b.d2);
    return out;
  }
  function nearestForTurret(sx,sy,range,onlyBoss){
    const t=targetsForTurret(sx,sy,range,onlyBoss);
    return t.length ? t[0] : null;
  }
  function collideHero(p,dt){
    p=p || playerRef();
    if(!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    let hit=false;
    for(const e of entities){
      if(e.dead) continue;
      if(separateHeroFromEntity(e,p,dt)) hit=true;
    }
    return hit;
  }

  function update(dt,player,getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(typeof dt!=='number' || !(dt>0)) return;
    dt=Math.min(0.1,dt);
    player=player || playerRef();
    const hearts=progressHearts();
    for(const kind of ['fire','ice']) if(hearts[kind]) state.defeated[kind]=true;
    maybeEnableUndergroundGate(getTile,setTile);
    if(player && Number.isFinite(player.x)){
      for(const kind of ['fire','ice']){
        const spec=SPEC[kind];
        const L=layoutFor(kind);
        const sideDistance=player.x*spec.dir;
        if((state.awakened[kind] || activeBoss(kind)) && !inGuardianNeighbourhood(kind,player,L)) sleepGuardian(kind);
        if(!isDefeated(kind) && playerInsideGuardianArena(kind,player,L)) awaken(kind);
        if(!isDefeated(kind) && sideDistance>=CFG.DISTANCE && !activeKind(kind)){
          const depth=clamp((sideDistance-CFG.DISTANCE)/9000,0,1);
          state.ambientCd[kind]-=dt*(0.55+depth*1.8);
          if(state.ambientCd[kind]<=0){
            spawnAmbientSidekick(kind,player);
            state.ambientCd[kind]=lerp(CFG.AMBIENT_MAX_CD,CFG.AMBIENT_MIN_CD,depth)*(0.75+Math.random()*0.5);
          }
        }
      }
    }
    for(let i=entities.length-1;i>=0;i--){
      const e=entities[i];
      if(e.dead){ entities.splice(i,1); continue; }
      if(e.shieldHint>0) e.shieldHint-=dt;
      // weakened matrix tick: burn = half DoT, chill = 20% slow (scaled dt —
      // guardians never hard-freeze; boss_status downgrades freeze to chill)
      const elem=tickBossStatus(bossStatusFor(e),dt);
      if(elem.damage>0 && !e.dead) hitEntity(e,elem.damage,{source:'status',cause:'burn_dot'});
      if(e.dead){ entities.splice(i,1); continue; }
      updateEntity(e,player,getTile,setTile,dt*elem.speedMult);
      if(e.dead) entities.splice(i,1);
    }
    const fireBoss=activeBoss('fire'), iceBoss=activeBoss('ice');
    const fireLayout=fireBoss ? layoutFor('fire') : null;
    const iceLayout=iceBoss ? layoutFor('ice') : null;
    updateStorm('fire',fireBoss,player,dt,fireLayout);
    updateStorm('ice',iceBoss,player,dt,iceLayout);
    updateLightningWeather('fire',fireBoss,player,dt,getTile,setTile,fireLayout);
    updateLightningWeather('ice',iceBoss,player,dt,getTile,setTile,iceLayout);
    updateHazards(dt,player,getTile,setTile);
    updateEffects(dt);
    updateGhosts(dt,player);
  }

  function makeDrawView(camX,camY,W,H,TILE,zoom){
    if(!Number.isFinite(camX) || !Number.isFinite(camY) || !(W>0) || !(H>0) || !(TILE>0)) return null;
    const z=(Number.isFinite(zoom) && zoom>0) ? zoom : 1;
    const margin=18;
    return {x0:camX-margin,y0:camY-margin,x1:camX+W/(TILE*z)+margin,y1:camY+H/(TILE*z)+margin};
  }
  function inDrawView(view,x,y,r){
    if(!view) return true;
    const m=r||0;
    return x+m>=view.x0 && x-m<=view.x1 && y+m>=view.y0 && y-m<=view.y1;
  }
  function tileVisible(canDrawTile,x,y,view,r){
    if(!inDrawView(view,x,y,r)) return false;
    return typeof canDrawTile!=='function' || canDrawTile(Math.floor(x),Math.floor(y));
  }
  function rgba(hex,a){
    if(typeof hex!=='string' || hex[0]!=='#' || hex.length<7) return 'rgba(255,255,255,'+clamp(a,0,1).toFixed(3)+')';
    const n=parseInt(hex.slice(1,7),16);
    return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+clamp(a,0,1).toFixed(3)+')';
  }
  function drawLairGlows(ctx,TILE,canDrawTile,view){
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    for(const kind of ['fire','ice']){
      const L=layoutFor(kind), spec=SPEC[kind];
      if(!L || !tileVisible(canDrawTile,L.ax,L.floorY-10,view,48)) continue;
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      for(const g of L.glows){
        const pulse=0.65+Math.sin(now*2+g.x)*0.22;
        const R=g.r*TILE*(0.8+pulse*0.25);
        const grad=ctx.createRadialGradient(g.x*TILE,g.y*TILE,2,g.x*TILE,g.y*TILE,R);
        grad.addColorStop(0,rgba(spec.accent,0.30));
        grad.addColorStop(1,rgba(spec.accent,0));
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.arc(g.x*TILE,g.y*TILE,R,0,Math.PI*2); ctx.fill();
      }
      const arenaR=34*TILE;
      const grad=ctx.createRadialGradient(L.ax*TILE,(L.floorY-8)*TILE,4,L.ax*TILE,(L.floorY-8)*TILE,arenaR);
      grad.addColorStop(0,rgba(spec.accent,activeKind(kind)?0.18:0.08));
      grad.addColorStop(1,rgba(spec.accent,0));
      ctx.fillStyle=grad; ctx.fillRect((L.ax-40)*TILE,(L.floorY-30)*TILE,80*TILE,34*TILE);
      ctx.restore();
    }
  }
  function drawUndergroundGateGlow(ctx,TILE,canDrawTile,view){
    if(!state.underground || !state.underground.enabled) return;
    const U=undergroundGateLayout();
    if(!U || !tileVisible(canDrawTile,U.x,U.y,view,34)) return;
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    const pulse=0.72+Math.sin(now*2.7)*0.18;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const grad=ctx.createRadialGradient(U.x*TILE,U.y*TILE,2,U.x*TILE,U.y*TILE,24*TILE*pulse);
    grad.addColorStop(0,'rgba(196,107,255,0.34)');
    grad.addColorStop(0.42,'rgba(121,201,93,0.16)');
    grad.addColorStop(1,'rgba(196,107,255,0)');
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.arc(U.x*TILE,U.y*TILE,24*TILE*pulse,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(245,248,255,0.44)';
    ctx.lineWidth=Math.max(1,TILE*0.08);
    ctx.beginPath(); ctx.arc(U.x*TILE,U.y*TILE,(5.5+Math.sin(now*3.1)*0.6)*TILE,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  function drawHazards(ctx,TILE,canDrawTile,view){
    for(const h of hazards){
      const hx=Number.isFinite(h.x)?h.x:h.x1, hy=Number.isFinite(h.y)?h.y:h.y1;
      if(!tileVisible(canDrawTile,hx,hy,view,h.explodeR||h.r||8)) continue;
      const spec=SPEC[h.kind];
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      if(h.type==='projectile'){
        const pulse=0.6+0.4*Math.sin(h.t*18);
        ctx.fillStyle=rgba(spec.accent,0.75);
        ctx.shadowColor=spec.accent; ctx.shadowBlur=12;
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(3,h.r*TILE*(0.9+pulse*0.25)),0,Math.PI*2); ctx.fill();
      }else if(h.type==='skyLightning'){
        const armed=h.t>=h.delay;
        const f=armed ? clamp(1-(h.t-h.delay)/Math.max(0.01,h.life),0,1) : clamp(h.t/h.delay,0,1)*0.45;
        const core=h.kind==='fire'?'255,240,185':'235,252,255';
        ctx.shadowColor=h.kind==='fire'?spec.accent:spec.accent2;
        ctx.shadowBlur=armed?22:8;
        const passes=[
          [7,rgba(spec.accent,0.20+f*0.26)],
          [3.2,'rgba('+core+','+(0.30+f*0.50).toFixed(3)+')'],
          [1.4,'rgba(255,255,255,'+(0.25+f*0.72).toFixed(3)+')']
        ];
        for(const pass of passes){
          ctx.strokeStyle=pass[1]; ctx.lineWidth=Math.max(1,pass[0]);
          ctx.beginPath(); ctx.moveTo(h.x1*TILE,h.y1*TILE); ctx.lineTo(h.x2*TILE,h.y2*TILE); ctx.stroke();
          if(h.branches){
            ctx.lineWidth=Math.max(1,pass[0]*0.48);
            for(const b of h.branches){
              ctx.beginPath(); ctx.moveTo(b.x1*TILE,b.y1*TILE); ctx.lineTo(b.x2*TILE,b.y2*TILE); ctx.stroke();
            }
          }
        }
      }else if(h.type==='stormMeteor'){
        ctx.shadowColor=spec.accent; ctx.shadowBlur=18;
        if(h.trail && h.trail.length>1){
          for(let i=1;i<h.trail.length;i++){
            const a=i/h.trail.length;
            ctx.strokeStyle=rgba(spec.accent,a*0.55);
            ctx.lineWidth=Math.max(1,TILE*(h.r||0.4)*(0.45+a*0.8));
            ctx.beginPath();
            ctx.moveTo(h.trail[i-1].x*TILE,h.trail[i-1].y*TILE);
            ctx.lineTo(h.trail[i].x*TILE,h.trail[i].y*TILE);
            ctx.stroke();
          }
        }
        ctx.fillStyle=h.kind==='fire'?spec.accent2:'#ffffff';
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(3,(h.r||0.4)*TILE*1.35),0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=rgba(spec.accent,0.82);
        ctx.lineWidth=Math.max(1,TILE*0.08);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(5,(h.r||0.4)*TILE*2.2),0,Math.PI*2); ctx.stroke();
      }else if(h.type==='impact'){
        const armed=h.t>=h.delay;
        const f=armed ? clamp((h.t-h.delay)/Math.max(0.01,h.life),0,1) : clamp(h.t/h.delay,0,1);
        ctx.strokeStyle=rgba(spec.accent,armed?0.75:0.30+f*0.35);
        ctx.lineWidth=Math.max(2,TILE*0.08);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,h.r*TILE*(armed?1+f*0.55:0.35+f*0.65),0,Math.PI*2); ctx.stroke();
        if(!armed){
          ctx.beginPath(); ctx.moveTo((h.x-h.r)*TILE,h.y*TILE); ctx.lineTo((h.x+h.r)*TILE,h.y*TILE); ctx.moveTo(h.x*TILE,(h.y-h.r)*TILE); ctx.lineTo(h.x*TILE,(h.y+h.r)*TILE); ctx.stroke();
        }
      }else if(h.type==='beam'){
        const armed=h.t>=h.delay;
        ctx.strokeStyle=rgba(spec.accent,armed?0.80:0.32);
        ctx.lineWidth=(armed? h.r*2.2 : 0.35)*TILE;
        ctx.shadowColor=spec.accent; ctx.shadowBlur=armed?18:6;
        ctx.beginPath(); ctx.moveTo(h.x1*TILE,h.y1*TILE); ctx.lineTo(h.x2*TILE,h.y2*TILE); ctx.stroke();
      }else if(h.type==='ring'){
        const armed=h.t>=h.delay;
        const f=armed?clamp((h.t-h.delay)/h.life,0,1):clamp(h.t/h.delay,0,1);
        const r=armed?lerp(h.r0,h.r1,f):h.r0*f;
        ctx.strokeStyle=rgba(spec.accent,armed?0.70:0.32);
        ctx.lineWidth=Math.max(2,TILE*0.14);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,r*TILE,0,Math.PI*2); ctx.stroke();
      }else if(h.type==='blizzard'){
        const f=clamp(1-h.t/h.life,0,1);
        const grad=ctx.createRadialGradient(h.x*TILE,h.y*TILE,2,h.x*TILE,h.y*TILE,h.r*TILE);
        grad.addColorStop(0,'rgba(210,250,255,'+(0.18*f).toFixed(3)+')');
        grad.addColorStop(1,'rgba(80,190,255,0)');
        ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,h.r*TILE,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }
  function drawFireEntity(ctx,TILE,e,now){
    const spec=SPEC.fire;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.shadowColor=spec.accent; ctx.shadowBlur=e.boss?20:12;
    if(e.boss){
      for(let i=8;i>=0;i--){
        const a=e.t*2.4+i*0.62;
        const x=e.x - e.dir*i*1.15 + Math.sin(a)*1.5;
        const y=e.y + Math.cos(a*0.9)*1.1 + i*0.12;
        const r=(i===0?1.85:1.15)*(1+Math.sin(now*0.006+i)*0.08);
        const grad=ctx.createRadialGradient(x*TILE,y*TILE,2,x*TILE,y*TILE,r*TILE);
        grad.addColorStop(0,i===0?spec.accent2:spec.accent);
        grad.addColorStop(1,rgba(spec.dark,0.15));
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.arc(x*TILE,y*TILE,r*TILE,0,Math.PI*2); ctx.fill();
      }
      ctx.fillStyle='#fff3bb';
      ctx.beginPath();
      ctx.moveTo((e.x+e.dir*2.3)*TILE,e.y*TILE);
      ctx.lineTo((e.x-e.dir*0.2)*TILE,(e.y-1.25)*TILE);
      ctx.lineTo((e.x-e.dir*0.2)*TILE,(e.y+1.25)*TILE);
      ctx.closePath(); ctx.fill();
    }else{
      ctx.fillStyle=e.role==='flare'?spec.accent2:spec.accent;
      ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,e.radius*TILE,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=rgba(spec.accent2,0.6); ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.radius+0.55+Math.sin(e.t*4)*0.2)*TILE,0,Math.PI*2); ctx.stroke();
    }
    if(e.hitFlash>0){ ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')'; ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.radius+1)*TILE,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
  function drawIceEntity(ctx,TILE,e,now){
    const spec=SPEC.ice;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.shadowColor=spec.accent; ctx.shadowBlur=e.boss?18:10;
    const x=e.x*TILE, y=e.y*TILE;
    if(e.boss){
      ctx.fillStyle=rgba(spec.accent,0.68);
      for(const s of [-1,1]){
        ctx.beginPath();
        ctx.moveTo(x,y-TILE*0.35);
        ctx.lineTo(x+s*TILE*3.4,y+TILE*0.25);
        ctx.lineTo(x+s*TILE*1.1,y+TILE*1.35);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle=spec.accent2;
      ctx.beginPath();
      ctx.moveTo(x,y-TILE*2.2); ctx.lineTo(x+TILE*1.25,y); ctx.lineTo(x,y+TILE*2.0); ctx.lineTo(x-TILE*1.25,y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#ffffff'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(x,y-TILE*2.1); ctx.lineTo(x,y+TILE*1.9); ctx.moveTo(x-TILE*1.15,y); ctx.lineTo(x+TILE*1.15,y); ctx.stroke();
      for(let i=0;i<6;i++){
        const a=e.t*1.5+i*Math.PI/3;
        ctx.fillStyle=rgba(spec.accent2,0.55);
        ctx.beginPath(); ctx.arc(x+Math.cos(a)*TILE*3.0,y+Math.sin(a)*TILE*1.8,TILE*0.25,0,Math.PI*2); ctx.fill();
      }
    }else{
      ctx.fillStyle=e.role==='mirror'?spec.accent2:spec.accent;
      ctx.beginPath();
      ctx.moveTo(x,y-TILE*e.radius); ctx.lineTo(x+TILE*e.radius,y); ctx.lineTo(x,y+TILE*e.radius); ctx.lineTo(x-TILE*e.radius,y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=1.5; ctx.stroke();
    }
    if(e.hitFlash>0){ ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')'; ctx.beginPath(); ctx.arc(x,y,(e.radius+1)*TILE,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
  function drawEntityHealth(ctx,TILE,e){
    if(!e.boss && e.hp/e.maxHp>0.98) return;
    const w=(e.boss?9:4.5)*TILE, h=e.boss?5:3;
    const x=e.x*TILE-w/2, y=(e.y-e.radius-1.4)*TILE;
    const spec=SPEC[e.kind];
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(x,y,w,h);
    ctx.fillStyle=spec.accent; ctx.fillRect(x,y,w*clamp(e.hp/e.maxHp,0,1),h);
    if(e.boss && sidekickCount(e.kind)>0){
      ctx.strokeStyle=rgba(spec.accent2,0.75); ctx.lineWidth=1; ctx.strokeRect(x-2,y-2,w+4,h+4);
    }
  }
  function drawEffects(ctx,TILE,canDrawTile,view){
    for(const e of effects){
      if(!tileVisible(canDrawTile,e.x,e.y,view,e.r||4)) continue;
      const spec=SPEC[e.kind] || SPEC.fire;
      const f=clamp(e.t/e.max,0,1);
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      if(e.type==='burst'){
        const grad=ctx.createRadialGradient(e.x*TILE,e.y*TILE,2,e.x*TILE,e.y*TILE,(e.r||4)*TILE*(0.35+f*0.55));
        grad.addColorStop(0,rgba(spec.accent2||spec.accent,0.34*(1-f)));
        grad.addColorStop(1,rgba(spec.accent,0));
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.r||4)*TILE*(0.35+f*0.55),0,Math.PI*2); ctx.fill();
      }
      ctx.strokeStyle=rgba(spec.accent,0.75*(1-f));
      ctx.lineWidth=Math.max(1,(1-f)*4);
      ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.r||4)*TILE*(0.25+f),0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
  function ghostEntries(){
    return ['fire','ice'].map(kind=>state.ghosts[kind]).filter(Boolean);
  }
  function hasGhosts(){
    return !!(state.ghosts.fire || state.ghosts.ice);
  }
  function drawRounded(ctx,x,y,w,h,r){
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x,y,w,h,r);
    else {
      ctx.moveTo(x+r,y);
      ctx.lineTo(x+w-r,y);
      ctx.quadraticCurveTo(x+w,y,x+w,y+r);
      ctx.lineTo(x+w,y+h-r);
      ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      ctx.lineTo(x+r,y+h);
      ctx.quadraticCurveTo(x,y+h,x,y+h-r);
      ctx.lineTo(x,y+r);
      ctx.quadraticCurveTo(x,y,x+r,y);
    }
  }
  function drawGhostBubble(ctx,x,y,text){
    if(!text) return;
    const words=String(text).split(/\s+/).filter(Boolean);
    const lines=[];
    let line='';
    ctx.save();
    ctx.font='12px system-ui';
    ctx.textBaseline='top';
    const maxW=238;
    for(const w of words){
      const next=line ? line+' '+w : w;
      const width=ctx.measureText ? ctx.measureText(next).width : next.length*7;
      if(line && width>maxW){ lines.push(line); line=w; }
      else line=next;
    }
    if(line) lines.push(line);
    const visible=lines.slice(0,5);
    const bw=Math.max(156,Math.min(270,visible.reduce((m,l)=>Math.max(m,ctx.measureText?ctx.measureText(l).width:80),0)+24));
    const bh=visible.length*15+16;
    const bx=x-bw*0.5, by=y-bh-24;
    ctx.shadowColor='rgba(0,0,0,0.28)';
    ctx.shadowBlur=6;
    ctx.fillStyle='rgba(238,248,255,0.93)';
    drawRounded(ctx,bx,by,bw,bh,10);
    ctx.fill();
    ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(64,78,99,0.62)';
    ctx.lineWidth=1.1;
    drawRounded(ctx,bx,by,bw,bh,10);
    ctx.stroke();
    ctx.fillStyle='rgba(238,248,255,0.88)';
    ctx.beginPath(); ctx.arc(x-7,y-20,4,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x-2,y-12,2.5,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#142235';
    visible.forEach((l,i)=>ctx.fillText(l,bx+12,by+8+i*15));
    ctx.restore();
  }
  function drawGuardianGhosts(ctx,TILE,canDrawTile,view){
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    for(const g of ghostEntries()){
      if(!tileVisible(canDrawTile,g.x,g.y,view,12)) continue;
      const spec=SPEC[g.kind] || SPEC.ice;
      const bob=Math.sin((g.t||0)*2.2+g.x)*0.18;
      const x=g.x*TILE, y=(g.y-0.35+bob)*TILE;
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.shadowColor=spec.accent2 || spec.accent;
      ctx.shadowBlur=18;
      const aura=ctx.createRadialGradient(x,y,2,x,y,TILE*4.2);
      aura.addColorStop(0,rgba(spec.accent2||spec.accent,0.26));
      aura.addColorStop(1,rgba(spec.accent,0));
      ctx.fillStyle=aura;
      ctx.beginPath(); ctx.arc(x,y,TILE*4.2,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=0.84;
      ctx.fillStyle=rgba(spec.accent2||spec.accent,0.78);
      ctx.beginPath();
      ctx.moveTo(x,y-TILE*1.35);
      ctx.lineTo(x+TILE*0.95,y-TILE*0.25);
      ctx.lineTo(x+TILE*0.55,y+TILE*1.05);
      ctx.lineTo(x,y+TILE*1.42);
      ctx.lineTo(x-TILE*0.55,y+TILE*1.05);
      ctx.lineTo(x-TILE*0.95,y-TILE*0.25);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.72)';
      ctx.lineWidth=1.4;
      ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.82)';
      ctx.fillRect(x-TILE*0.35,y-TILE*0.2,TILE*0.18,TILE*0.18);
      ctx.fillRect(x+TILE*0.17,y-TILE*0.2,TILE*0.18,TILE*0.18);
      for(let i=0;i<5;i++){
        const a=now*1.7+i*1.26+g.x*0.03;
        ctx.fillStyle=rgba(i%2?spec.accent:spec.accent2,0.42);
        ctx.fillRect(x+Math.cos(a)*TILE*1.8-1.5,y+Math.sin(a*1.2)*TILE*1.1-1.5,3,3);
      }
      ctx.restore();
      if((g.talkT||0)>0) drawGhostBubble(ctx,x,y-TILE*2.0,ghostSpeech(g.kind));
    }
  }
  function draw(ctx,TILE,canDrawTile,camX,camY,W,H,zoom){
    const view=makeDrawView(camX,camY,W,H,TILE,zoom);
    drawLairGlows(ctx,TILE,canDrawTile,view);
    drawUndergroundGateGlow(ctx,TILE,canDrawTile,view);
    if(!entities.length && !hazards.length && !effects.length && !hasGhosts()) return;
    const now=(typeof performance!=='undefined') ? performance.now() : 0;
    drawHazards(ctx,TILE,canDrawTile,view);
    for(const e of entities){
      if(!tileVisible(canDrawTile,e.x,e.y,view,(e.radius||1)+5)) continue;
      if(e.kind==='fire') drawFireEntity(ctx,TILE,e,now);
      else drawIceEntity(ctx,TILE,e,now);
      drawEntityHealth(ctx,TILE,e);
    }
    drawEffects(ctx,TILE,canDrawTile,view);
    drawGuardianGhosts(ctx,TILE,canDrawTile,view);
  }
  function drawHUD(ctx,W,H,camX,camY,zoom,TILE,canDrawTile){
    const p=playerRef(); if(!p) return;
    let best=null, bd=Infinity;
    for(const e of entities){
      if(e.dead || !e.boss || !tileVisible(canDrawTile,e.x,e.y)) continue;
      const d=Math.abs(e.x-p.x)+Math.abs(e.y-p.y)*0.25;
      if(d<bd){ bd=d; best=e; }
    }
    if(!best) return;
    const sx=(best.x-camX)*TILE*zoom, sy=(best.y-camY)*TILE*zoom;
    if(sx>36 && sx<W-36 && sy>36 && sy<H-36) return;
    const ang=Math.atan2(sy-H/2,sx-W/2);
    const ex=W/2+Math.cos(ang)*(Math.min(W,H)/2-44), ey=H/2+Math.sin(ang)*(Math.min(W,H)/2-44);
    const spec=SPEC[best.kind];
    ctx.save(); ctx.translate(ex,ey); ctx.rotate(ang);
    ctx.fillStyle=rgba(spec.accent,0.9);
    ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(-8,-8); ctx.lineTo(-8,8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function resetUnderground(){
    state.underground.enabled=false;
    state.underground.x=null;
    state.underground.y=null;
    state.underground.seed=0;
    state.underground.materialized=false;
  }
  function cleanGhostSnapshot(kind){
    const g=state.ghosts[kind];
    if(!g) return null;
    return {
      kind,
      x:+finite(g.x,layoutFor(kind).ax).toFixed(2),
      y:+finite(g.y,layoutFor(kind).floorY-4).toFixed(2),
      talkT:+Math.max(0,Number(g.talkT)||0).toFixed(2),
      rewarded:!!g.rewarded,
      rewardId:typeof g.rewardId==='string' ? g.rewardId.slice(0,64) : null,
      seen:!!g.seen
    };
  }
  function restoreGhost(kind,src){
    if(!src || typeof src!=='object'){ state.ghosts[kind]=null; return; }
    const L=layoutFor(kind);
    state.ghosts[kind]={
      kind,
      x:clamp(Number(src.x)||L.ax,L.ax-54,L.ax+54),
      y:clamp(Number(src.y)||L.floorY-4,2,WORLD_H-5),
      t:0,
      talkT:clamp(Number(src.talkT)||0,0,18),
      rewarded:!!src.rewarded,
      rewardId:typeof src.rewardId==='string' ? src.rewardId.slice(0,64) : null,
      seen:!!src.seen
    };
  }
  function cleanUndergroundSnapshot(){
    return {
      enabled:!!state.underground.enabled,
      x:Number.isFinite(state.underground.x) ? Math.round(state.underground.x) : null,
      y:Number.isFinite(state.underground.y) ? Math.round(state.underground.y) : null,
      seed:Number(state.underground.seed)||0,
      materialized:!!state.underground.materialized
    };
  }
  function restoreUnderground(src){
    resetUnderground();
    if(!src || typeof src!=='object') return;
    if(!src.enabled) return;
    const a=undergroundAnchor();
    state.underground.enabled=true;
    state.underground.x=Number.isFinite(src.x) ? clamp(Math.round(src.x),-220,220) : a.x;
    state.underground.y=Number.isFinite(src.y) ? clamp(Math.round(src.y),86,WORLD_H-14) : a.y;
    state.underground.seed=Number(src.seed)||a.seed;
    state.underground.materialized=!!src.materialized;
  }
  function ghostStatus(kind){
    const g=state.ghosts[kind];
    if(!g) return null;
    return {
      kind,
      x:g.x,
      y:g.y,
      rewarded:!!g.rewarded,
      rewardId:g.rewardId||null,
      text:ghostSpeech(kind)
    };
  }
  function undergroundStatus(){
    const U=(state.underground && state.underground.enabled) ? undergroundGateLayout() : null;
    return {
      enabled:!!(state.underground && state.underground.enabled),
      x:U ? U.x : state.underground.x,
      y:U ? U.y : state.underground.y,
      mouthX:U ? U.mouthX : null,
      mouthY:U ? U.mouthY : null,
      materialized:!!(state.underground && state.underground.materialized)
    };
  }
  function reset(){
    entities=[]; hazards.length=0; effects.length=0;
    state.defeated.fire=false; state.defeated.ice=false;
    state.awakened.fire=false; state.awakened.ice=false;
    state.ambientCd.fire=28; state.ambientCd.ice=34;
    state.ghosts.fire=null; state.ghosts.ice=null;
    resetUnderground();
    resetStorm('fire'); resetStorm('ice');
    resetWeather('fire'); resetWeather('ice');
  }
  function clearActive(){ entities=[]; hazards.length=0; effects.length=0; state.awakened.fire=false; state.awakened.ice=false; resetStorm('fire'); resetStorm('ice'); resetWeather('fire'); resetWeather('ice'); }
  function snapshot(){
    return {
      v:2,
      defeated:{fire:!!state.defeated.fire, ice:!!state.defeated.ice},
      awakened:{fire:!!state.awakened.fire, ice:!!state.awakened.ice},
      ambientCd:{fire:+state.ambientCd.fire.toFixed(2), ice:+state.ambientCd.ice.toFixed(2)},
      ghosts:{fire:cleanGhostSnapshot('fire'), ice:cleanGhostSnapshot('ice')},
      underground:cleanUndergroundSnapshot()
    };
  }
  function restore(d){
    clearActive();
    state.ghosts.fire=null; state.ghosts.ice=null;
    resetUnderground();
    if(!d || typeof d!=='object') return false;
    state.defeated.fire=!!(d.defeated && d.defeated.fire);
    state.defeated.ice=!!(d.defeated && d.defeated.ice);
    state.awakened.fire=!!(d.awakened && d.awakened.fire);
    state.awakened.ice=!!(d.awakened && d.awakened.ice);
    if(d.ambientCd){
      state.ambientCd.fire=clamp(Number(d.ambientCd.fire)||28,1,300);
      state.ambientCd.ice=clamp(Number(d.ambientCd.ice)||34,1,300);
    }
    const hearts=progressHearts();
    if(hearts.fire) state.defeated.fire=true;
    if(hearts.ice) state.defeated.ice=true;
    if(d.ghosts){
      restoreGhost('fire',d.ghosts.fire);
      restoreGhost('ice',d.ghosts.ice);
    }
    restoreUnderground(d.underground);
    return true;
  }
  function markDefeated(kind){
    if(!SPEC[kind]) return false;
    state.defeated[kind]=true;
    state.awakened[kind]=false;
    resetStorm(kind);
    resetWeather(kind);
    maybeEnableUndergroundGate();
    return true;
  }
  function forceAwaken(kind){
    return awaken(kind,{debug:true,force:true});
  }
  function status(){
    return {
      defeated:{fire:isDefeated('fire'), ice:isDefeated('ice')},
      lairs:{fire:layoutFor('fire'), ice:layoutFor('ice')},
      entities:entities.map(e=>({id:e.id,kind:e.kind,role:e.role,name:e.name,hp:e.hp,maxHp:e.maxHp,x:e.x,y:e.y,boss:e.boss})),
      ghosts:{fire:ghostStatus('fire'), ice:ghostStatus('ice')},
      underground:undergroundStatus(),
      hazards:hazards.length,
      storm:{fire:!!(activeBoss('fire') && activeBoss('fire').hp/activeBoss('fire').maxHp<0.5), ice:!!(activeBoss('ice') && activeBoss('ice').hp/activeBoss('ice').maxHp<0.5)},
      lightning:{fire:!!(activeBoss('fire') && activeBoss('fire').hp/activeBoss('fire').maxHp<CFG.LIGHTNING_THRESHOLD), ice:!!(activeBoss('ice') && activeBoss('ice').hp/activeBoss('ice').maxHp<CFG.LIGHTNING_THRESHOLD)}
    };
  }
  function metrics(){
    const fb=activeBoss('fire'), ib=activeBoss('ice');
    let bosses=0, sidekicks=0, stormMeteors=0, lightningBolts=0;
    for(const e of entities){ if(e.boss) bosses++; else sidekicks++; }
    for(const h of hazards){
      if(h.type==='stormMeteor') stormMeteors++;
      else if(h.type==='skyLightning') lightningBolts++;
    }
    return {
      alive:entities.length, bosses, sidekicks,
      hazards:hazards.length, stormMeteors, lightningBolts,
      storm:{fire:!!(fb && fb.hp/fb.maxHp<0.5), ice:!!(ib && ib.hp/ib.maxHp<0.5)},
      stormNextIn:{
        fire:state.stormCd.fire==null ? null : +Math.max(0,state.stormCd.fire).toFixed(1),
        ice:state.stormCd.ice==null ? null : +Math.max(0,state.stormCd.ice).toFixed(1)
      },
      lightning:{fire:!!(fb && fb.hp/fb.maxHp<CFG.LIGHTNING_THRESHOLD), ice:!!(ib && ib.hp/ib.maxHp<CFG.LIGHTNING_THRESHOLD)},
      lightningRate:{fire:+(state.lightningRate.fire||0).toFixed(1), ice:+(state.lightningRate.ice||0).toFixed(1)},
      defeated:{fire:isDefeated('fire'),ice:isDefeated('ice')},
      ghosts:ghostEntries().length,
      underground:undergroundStatus()
    };
  }
  function _debug(){ return {state, entities, hazards, effects, undergroundGateLayout, materializeUndergroundGate, makeGhostRewardItem, ghostSpeech}; }

  const api={config:CFG, specs:SPEC, anchorFor, layoutFor, undergroundGateLayout, anchorsInRange, nearest, applyToChunk,
    update, draw, drawHUD, attackAt, damageAt, collideHero, spawnGuardian, forceAwaken, markDefeated,
    enableUndergroundGate,
    targetsForTurret, nearestForTurret, reset, clearActive, snapshot, restore, status, metrics,
    clearCache:()=>cache.clear(), _debug};
  MM.guardianLairs=api;
  MM.guardians=api;
  // weakened-matrix registry: weapons splash statuses into guardians through
  // MM.bossStatus.applyRadius (shared with every other boss family)
  try{
    if(MM.bossStatus && MM.bossStatus.registerSystem){
      MM.bossStatus.registerSystem('guardianLairs',{
        applyRadius(wx,wy,r,kind,opts){
          let n=0;
          for(const e of entities){
            if(!e || e.dead) continue;
            const rr=r+(e.radius||1);
            const dx=e.x-wx, dy=e.y-wy;
            if(dx*dx+dy*dy>rr*rr) continue;
            if(applyBossStatus(bossStatusFor(e),kind,opts)) n++;
          }
          return n;
        }
      });
    }
  }catch(e){}
  return api;
})();

export { guardianLairs };
export default guardianLairs;
