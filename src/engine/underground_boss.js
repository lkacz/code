import { CHUNK_W, WORLD_H, WORLD_SECTION_H, WORLD_MAX_Y, T } from '../constants.js';
import {
  isBlastProtectedTile,
  isGeneratedStructureReplaceableTile,
  isReplaceableNaturalOpenTile,
  isSolidCollisionTile as isSolid
} from './material_physics.js';
import { worldGen as WG } from './worldgen.js';
import { guardianLairs as GUARDIANS } from './guardian_lairs.js';
import { applyBossStatus, bossElectricDamageMult, bossStatusFor, tickBossStatus } from './boss_status.js';

const undergroundBoss = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const CFG = {
    AWAKEN_RADIUS: 48,
    AWAKEN_Y: 42,
    LEASH_RADIUS: 92,
    LEASH_Y: 62,
    EFFECT_CAP: 180,
    HAZARD_CAP: 120,
    BOSS_HP: 1560,
    DRONE_HP: 280,
    BURROW_SPEED: 16,
    BURROW_RADIUS: 2.35,
    DRONE_TUNNEL_RADIUS: 1.25,
    TUNNEL_X_MARGIN: 38,
    TUNNEL_TOP_MARGIN: 18,
    BOMB_ARM_TIME: 1.05,
    BOMB_BLAST_LIFE: 0.52,
    BOMB_RADIUS: 4.2,
    ZOMBIE_GOLEM_HEALTH_RATIO: 0.50,
    ZOMBIE_GOLEM_SPAWN_SECONDS: 30,
    ZOMBIE_GOLEM_FIRST_DELAY: 30,
    ZOMBIE_GOLEM_WAVE_SIZE: 2,
    ZOMBIE_GOLEM_MAX_ACTIVE: 4,
    ZOMBIE_GOLEM_HP: 230,
    ZOMBIE_GOLEM_DAMAGE: 14,
    ZOMBIE_GOLEM_RADIUS: 1.28,
    GAS_FEAR_SECONDS: 2.6,
    GAS_FEAR_BURROW_DELAY: 0.20,
    GAS_DAMAGE_MULT: 2.65,
    CONTACT_CD: 0.78,
    SAVE_MARK_MIN_INTERVAL: 850,
    DEATH_BLAST_INTENSITY: 5.2,
    DEATH_BLAST_SCALE: 2.85
  };
  const SPEC = {
    kind: 'earth',
    bossName: 'Nyxolith Excavator, the Root Kernel',
    heartKey: 'heartEarth',
    heartLabel: 'Heart of Earth',
    accent: '#c46bff',
    accent2: '#79c95d',
    dark: '#1d1528'
  };
  const state = {
    unlocked: false,
    defeated: false,
    awakened: false,
    heartAwarded: false,
    materialized: false,
    seq: 1,
    hintCd: 0,
    lastCrater: null,
    tunnelsCarved: 0,
    lastWorldChangeMark: -Infinity,
    debugRematch: false
  };
  const cache = new Map();
  let entities = [];
  let hazards = [];
  let effects = [];
  let lastGetTile = null;
  let lastSetTile = null;

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const finite = (v,f)=>Number.isFinite(Number(v)) ? Number(v) : f;
  const dist2 = (ax,ay,bx,by)=>{ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; };
  const tileKey = (x,y)=>x+','+y;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  const HAS_DEEP_WORLD = WORLD_BOTTOM > WORLD_H + 24;

  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function sfx(id,opts){ try{ if(MM.audio && MM.audio.play) MM.audio.play(id,opts); }catch(e){} }
  function nowMs(){
    try{ if(root.performance && typeof root.performance.now === 'function') return root.performance.now(); }catch(e){}
    try{ return Date.now(); }catch(e){ return 0; }
  }
  function markWorldChanged(force){
    const now=nowMs();
    if(!force && Number.isFinite(state.lastWorldChangeMark) && now-state.lastWorldChangeMark<CFG.SAVE_MARK_MIN_INTERVAL) return false;
    state.lastWorldChangeMark=now;
    try{
      if(typeof root.__mmMarkWorldChanged === 'function') root.__mmMarkWorldChanged('underground_boss');
      else if(root.saveState) root.saveState();
    }catch(e){}
    return true;
  }
  function playerRef(){ return root.player || null; }
  function progressHearts(){
    let hearts = {};
    try{ if(MM.progress && MM.progress.guardianHearts) hearts = MM.progress.guardianHearts() || {}; }catch(e){ hearts = {}; }
    const inv = root.inv || {};
    if((Number(inv.heartFire)||0)>0) hearts.fire = 1;
    if((Number(inv.heartIce)||0)>0) hearts.ice = 1;
    if((Number(inv.heartEarth)||0)>0) hearts.earth = 1;
    return hearts;
  }
  function gateEnabled(){
    try{
      const s = GUARDIANS && GUARDIANS.status ? GUARDIANS.status() : null;
      return !!(s && s.underground && s.underground.enabled);
    }catch(e){ return false; }
  }
  function isUnlocked(){
    const hearts = progressHearts();
    if((hearts.fire && hearts.ice) || gateEnabled()) state.unlocked = true;
    return !!state.unlocked;
  }
  function isDefeated(){
    const hearts = progressHearts();
    if(hearts.earth) state.defeated = true;
    return !!state.defeated;
  }
  function gateLayout(){
    try{
      if(GUARDIANS && GUARDIANS.undergroundGateLayout) return GUARDIANS.undergroundGateLayout();
    }catch(e){}
    const seed = Number(WG.worldSeed)||1;
    const x = Math.round((WG.randSeed(seed*0.017+41.3)-0.5)*180);
    return {kind:'underground', x:clamp(x,-220,220), y:WORLD_H-16, mouthX:x, mouthY:68, seed};
  }
  function makeLayout(){
    const U = gateLayout() || {};
    const ax = Math.round(finite(U.x,0));
    const gateY = Math.round(finite(U.y,WORLD_H-16));
    const deepDrop = HAS_DEEP_WORLD ? clamp(Math.round((WORLD_BOTTOM-WORLD_H)*0.55), WORLD_SECTION_H-4, WORLD_SECTION_H+26) : 7;
    const floorMin = HAS_DEEP_WORLD ? Math.max(WORLD_H+34, gateY+44) : 104;
    const floorMax = HAS_DEEP_WORLD ? WORLD_BOTTOM-24 : WORLD_H-7;
    const floorY = clamp(gateY+deepDrop, floorMin, floorMax);
    const seed = Number(U.seed)||Number(WG.worldSeed)||1;
    const rx = 48;
    const complexSchema = 'mole_burrow_complex_v2';
    const approachShellThickness = 3;
    const approachShellOuter = approachShellThickness+2;
    const top = Math.max(HAS_DEEP_WORLD ? gateY+8 : 10,floorY-34);
    const bottom = Math.min(WORLD_BOTTOM-4,floorY+4);
    const ops = [];
    let minX=ax, maxX=ax, minY=top, maxY=bottom;
    function bound(x,y){ if(x<minX) minX=x; if(x>maxX) maxX=x; if(y<minY) minY=y; if(y>maxY) maxY=y; }
    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_BOTTOM-3) return;
      ops.push({x,y,t,f:force?1:0});
      bound(x,y);
    }
    function clear(x,y){ put(x,y,T.AIR,true); }
    function shellTile(x,y){
      const r = WG.randSeed(x*0.311+y*1.773+seed*0.0091);
      if(r>0.91) return T.ANTIMATTER_CRYSTAL;
      if(r>0.72) return T.IRIDIUM;
      if(r>0.54) return T.ALIEN_BIOMASS;
      if(r>0.34) return T.BASALT;
      return T.GRANITE;
    }
    for(let y=top; y<=bottom; y++){
      for(let x=ax-rx-4; x<=ax+rx+4; x++){
        const dx=(x-ax)/rx;
        const dy=(y-(floorY-14))/22;
        const d=dx*dx+dy*dy;
        if(y>=floorY){
          if(Math.abs(x-ax)<=rx-3) put(x,y, y===floorY ? shellTile(x,y) : (Math.abs(x-ax)%7===0?T.IRIDIUM:T.BASALT), true);
          else if(d<1.24) put(x,y,shellTile(x,y),true);
        }else if(d<0.95){
          clear(x,y);
        }else if(d<1.20){
          put(x,y,shellTile(x,y),true);
        }
      }
    }
    for(let dx=-34; dx<=34; dx++){
      if(Math.abs(dx)%8===0) put(ax+dx,floorY-1,T.METEOR_DUST,true);
      if(Math.abs(dx)===26 || Math.abs(dx)===27){
        put(ax+dx,floorY-2,T.IRIDIUM,true);
        put(ax+dx,floorY-3,T.ANTIMATTER_CRYSTAL,true);
      }
    }
    for(const side of [-1,1]){
      const px=ax+side*29;
      for(let y=floorY-11; y<=floorY-4; y++){
        put(px,y,T.ANTIMATTER_CRYSTAL,true);
        if(y%2===0) put(px-side,y,T.METEOR_DUST,true);
      }
      for(let x=px-side*3; x!==px+side*4; x+=side) put(x,floorY-4,T.IRIDIUM,true);
    }
    const vaultVents = [];
    function carveVaultVent(side,index,offsetY,reach){
      const startX=ax+side*(rx-3);
      let lastY=floorY+offsetY;
      for(let i=0;i<=reach;i++){
        const x=startX+side*i;
        const y=Math.round(floorY+offsetY + Math.sin(i*0.48+seed*0.002+index)*1.7 + (i/reach)*side*0.8);
        for(let yy=y-2; yy<=y+2; yy++){
          if(Math.abs(yy-y)<=1) clear(x,yy);
          else put(x,yy,shellTile(x,yy),true);
        }
        if(i%5===0) put(x,y+2,T.METEOR_DUST,true);
        lastY=y;
      }
      vaultVents.push({side,x:startX+side*reach,y:lastY,reach});
    }
    carveVaultVent(-1,1,-22,18);
    carveVaultVent(1,2,-20,22);
    carveVaultVent(-1,3,-13,26);
    carveVaultVent(1,4,-12,18);
    const bridgeX = Math.round(finite(U.x,ax));
    const bridgeY = Math.round(finite(U.y,floorY-8));
    const mazeEntryY = clamp(bridgeY+6, 4, Math.max(5,floorY-18));
    const mazeExitY = Math.max(mazeEntryY+10,floorY-8);
    const mazeOpen = new Map();
    const mazeWalls = new Map();
    const mazeLadders = new Map();
    const mazeGuides = new Map();
    const mazePath = [];
    const mazeBranches = [];
    let mazeMinX=bridgeX, mazeMaxX=bridgeX, mazeMinY=mazeEntryY, mazeMaxY=mazeEntryY;
    function mazeBound(x,y){
      if(x<mazeMinX) mazeMinX=x; if(x>mazeMaxX) mazeMaxX=x;
      if(y<mazeMinY) mazeMinY=y; if(y>mazeMaxY) mazeMaxY=y;
    }
    function mazeSet(map,x,y){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_BOTTOM-3) return;
      map.set(tileKey(x,y),{x,y});
      mazeBound(x,y);
    }
    function mazeClearCell(x,y,r){
      const rr=Math.max(1,Math.ceil(r||2));
      const rx=Math.max(1.2,Number(r)||2);
      const ry=Math.max(1.1,rx*0.82);
      for(let yy=Math.floor(y-rr); yy<=Math.ceil(y+rr); yy++){
        for(let xx=Math.floor(x-rr); xx<=Math.ceil(x+rr); xx++){
          const dx=(xx-x)/rx, dy=(yy-y)/ry;
          if(dx*dx+dy*dy<=1.15) mazeSet(mazeOpen,xx,yy);
        }
      }
    }
    function randMaze(i){ return WG.randSeed(seed*0.0217+i*17.37); }
    function mainTunnelXAt(y){
      const t=clamp((y-mazeEntryY)/Math.max(1,mazeExitY-mazeEntryY),0,1);
      const taper=0.62+Math.sin(t*Math.PI)*0.38;
      const drift=Math.sin(t*Math.PI*3.25+seed*0.0017)*17*taper + Math.sin(t*Math.PI*8.1+seed*0.0043)*6;
      const pull=lerp(bridgeX,ax,t);
      return clamp(Math.round(pull+drift),ax-36,ax+36);
    }
    function carveLine(a,b,r,ladderEvery){
      const steps=Math.max(1,Math.ceil(Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y))*2));
      for(let i=0;i<=steps;i++){
        const t=i/steps;
        const x=lerp(a.x,b.x,t), y=lerp(a.y,b.y,t);
        mazeClearCell(x,y,r);
        if(ladderEvery && Math.abs(b.y-a.y)>=3 && Math.abs(b.x-a.x)<=2 && i%ladderEvery===0) mazeSet(mazeLadders,x,y);
      }
    }
    let last={x:bridgeX,y:mazeEntryY};
    mazePath.push({x:bridgeX,y:mazeEntryY});
    for(let y=mazeEntryY; y<=mazeExitY; y++){
      const t=clamp((y-mazeEntryY)/Math.max(1,mazeExitY-mazeEntryY),0,1);
      const x=mainTunnelXAt(y);
      const p={x,y};
      carveLine(last,p,2.25+Math.sin(t*Math.PI)*0.28,0);
      if((y-mazeEntryY)%5===0) mazePath.push({x,y});
      if((y-mazeEntryY)%9===0) mazeSet(mazeGuides,x,y+2);
      last=p;
    }
    function carveBranch(rootT,side,reach,drop,index){
      const sy=Math.round(lerp(mazeEntryY+7,mazeExitY-8,rootT));
      const sx=mainTunnelXAt(sy);
      const steps=Math.max(16,Math.round(reach*0.9+Math.abs(drop)*0.8));
      let prev={x:sx,y:sy};
      const points=[];
      for(let i=0;i<=steps;i++){
        const t=i/steps;
        const wobble=Math.sin(t*Math.PI*2.35+seed*0.002+index)*5 + Math.sin(t*Math.PI*5.1+index)*2.4;
        const x=clamp(Math.round(sx + side*(reach*t + wobble*Math.sin(t*Math.PI))), ax-58, ax+58);
        const y=clamp(Math.round(sy + drop*t + Math.sin(t*Math.PI*1.7+index)*3.5), mazeEntryY+3, floorY-12);
        const p={x,y};
        carveLine(prev,p,1.75+(i%5===0?0.25:0),0);
        if(i%7===0) mazeSet(mazeGuides,x,y+1);
        if(i%6===0) points.push({x,y});
        prev=p;
      }
      mazeBranches.push({side,rootY:sy,endX:prev.x,endY:prev.y,points});
    }
    carveBranch(0.18,-1,24+Math.round(randMaze(40)*12),8+Math.round(randMaze(41)*8),1);
    carveBranch(0.34,1,30+Math.round(randMaze(42)*14),-4+Math.round(randMaze(43)*11),2);
    carveBranch(0.52,-1,34+Math.round(randMaze(44)*13),10+Math.round(randMaze(45)*10),3);
    carveBranch(0.70,1,27+Math.round(randMaze(46)*16),7+Math.round(randMaze(47)*9),4);
    for(const t of [0.16,0.46,0.78]){
      const cy=Math.round(lerp(mazeEntryY+5,mazeExitY-5,t));
      for(let y=cy-4; y<=cy+4; y++){
        const x=mainTunnelXAt(y);
        if(mazeOpen.has(tileKey(x,y))) mazeSet(mazeLadders,x,y);
      }
    }
    mazePath.push({x:ax,y:mazeExitY});
    // Weld the burrow approach up into the sealed surface-gate chamber. Without this
    // the approach's own bedrock shell caps the top of its entry tunnel, plugging the
    // chamber floor and severing the three zones into two unreachable structures.
    // The sealed gate above supplies containment for this throat, so the shell must
    // not re-cap it (see the throat exclusion in the shell pass below).
    const throatX = bridgeX;
    const throatTop = clamp(Math.round(bridgeY), mazeEntryY-16, mazeEntryY);
    for(let y=throatTop; y<=mazeEntryY; y++) mazeClearCell(throatX,y,2.3);
    for(const cell of mazeOpen.values()){
      for(let yy=cell.y-approachShellOuter; yy<=cell.y+approachShellOuter; yy++){
        for(let xx=cell.x-approachShellOuter; xx<=cell.x+approachShellOuter; xx++){
          const k=tileKey(xx,yy);
          if(mazeOpen.has(k)) continue;
          const shellD=Math.max(Math.abs(xx-cell.x),Math.abs(yy-cell.y));
          if(shellD<approachShellThickness || shellD>approachShellOuter) continue;
          const dx=(xx-ax)/rx;
          const dy=(yy-(floorY-14))/22;
          if(yy>floorY-15 && yy<floorY && dx*dx+dy*dy<0.88) continue;
          if(yy<=mazeEntryY && Math.abs(xx-throatX)<=approachShellOuter) continue;
          mazeSet(mazeWalls,xx,yy);
        }
      }
    }
    [...mazeWalls.values()].sort((a,b)=>a.y-b.y || a.x-b.x).forEach(c=>put(c.x,c.y,T.BEDROCK,true));
    [...mazeOpen.values()].sort((a,b)=>a.y-b.y || a.x-b.x).forEach(c=>clear(c.x,c.y));
    [...mazeLadders.values()].sort((a,b)=>a.y-b.y || a.x-b.x).forEach(c=>put(c.x,c.y,T.LADDER,true));
    [...mazeGuides.values()].sort((a,b)=>a.y-b.y || a.x-b.x).forEach(c=>{
      const k=tileKey(c.x,c.y);
      if(mazeOpen.has(k) && !mazeLadders.has(k)) put(c.x,c.y,T.METEOR_DUST,true);
    });
    for(let dx=-6; dx<=6; dx++){
      if(Math.abs(dx)<=2) clear(ax+dx,floorY-5);
      put(ax+dx,floorY-2,Math.abs(dx)<=2?T.METEOR_DUST:T.ANTIMATTER_CRYSTAL,true);
    }
    const approach = {
      entryX:bridgeX,
      entryY:mazeEntryY,
      exitX:ax,
      exitY:mazeExitY,
      minX:mazeMinX-2,
      maxX:mazeMaxX+2,
      minY:mazeMinY-2,
      maxY:mazeMaxY+2,
      kind:'organicTunnelNetwork',
      shellThickness:approachShellThickness,
      branches:mazeBranches.length,
      turns:mazePath.length-1,
      path:mazePath.map(p=>({x:p.x,y:p.y})),
      branchPaths:mazeBranches.map(b=>({side:b.side,rootY:b.rootY,endX:b.endX,endY:b.endY,points:b.points})),
      openCells:mazeOpen.size,
      bedrockCells:mazeWalls.size,
      ladderCells:mazeLadders.size
    };
    const vault = {
      kind:'excavatorVault',
      centerX:ax,
      top,
      floorY,
      rx,
      vents:vaultVents,
      sidekickDocks:[{x:ax-29,y:floorY-6.2},{x:ax+29,y:floorY-6.2}]
    };
    const complex = {
      schema:complexSchema,
      surfaceGateSchema:U.design && U.design.schema ? U.design.schema : null,
      zones:['sealed_surface_gate','armored_burrow_approach','excavator_vault'],
      containment:{tile:T.BEDROCK, minThickness:approachShellThickness},
      progression:{sealed:!!U.sealed, requiresFireAndIce:true},
      visualLanguage:{
        containment:T.BEDROCK,
        guide:T.METEOR_DUST,
        machineBones:T.IRIDIUM,
        alienSeal:T.ANTIMATTER_CRYSTAL
      }
    };
    return {
      kind:'underground',
      ax, x:ax,
      gateX:bridgeX,
      gateY:mazeEntryY,
      gateChamberY:bridgeY,
      mouthX:finite(U.mouthX,bridgeX),
      mouthY:finite(U.mouthY,bridgeY-30),
      floorY,
      bossX:ax,
      bossY:floorY-3.7,
      anchorSpawns:[{x:ax-29,y:floorY-6.2,side:-1},{x:ax+29,y:floorY-6.2,side:1}],
      droneSpawns:[{role:'cutter',x:ax-29,y:floorY-6.2,side:-1},{role:'backfill',x:ax+29,y:floorY-6.2,side:1}],
      minX:minX-2, maxX:maxX+2, minY:minY-2, maxY:maxY+2,
      tunnelMinX:minX-2-CFG.TUNNEL_X_MARGIN,
      tunnelMaxX:maxX+2+CFG.TUNNEL_X_MARGIN,
      tunnelMinY:Math.max(4,minY-2-CFG.TUNNEL_TOP_MARGIN),
      tunnelMaxY:floorY-3,
      seed,
      complex,
      approach,
      vault,
      maze:approach,
      ops
    };
  }
  function layoutFor(){
    const U = gateLayout() || {};
    const key = 'underground-boss:'+(Number(WG.worldSeed)||0)+':'+Math.round(finite(U.x,0))+':'+Math.round(finite(U.y,WORLD_H-16));
    if(cache.has(key)) return cache.get(key);
    const L = makeLayout();
    cache.set(key,L);
    return L;
  }
  function replaceableForArena(t,force){
    if(force) return true;
    if(isGeneratedStructureReplaceableTile(t) || isReplaceableNaturalOpenTile(t,true)) return true;
    return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.DIRT || t===T.GRASS ||
      t===T.MUD || t===T.CLAY || t===T.WET_CLAY || t===T.SNOW || t===T.ICE || t===T.COAL ||
      t===T.GRASS_SNOW || t===T.FROZEN_DIRT || t===T.FROZEN_SAND || t===T.FROZEN_CLAY ||
      t===T.RADIOACTIVE_ORE || t===T.ALIEN_BIOMASS || t===T.METEOR_DUST || t===T.ANTIMATTER_CRYSTAL;
  }
  function applyOpsToArray(arr,cx,originY,height){
    if(!arr || !isUnlocked()) return;
    const L = layoutFor();
    const cmin = cx*CHUNK_W, cmax = cmin+CHUNK_W-1;
    const y0=Math.floor(originY), y1=y0+Math.max(0,Math.floor(height||0))-1;
    if(L.maxX<cmin || L.minX>cmax || L.maxY<y0 || L.minY>y1) return;
    for(const o of L.ops){
      if(o.x<cmin || o.x>cmax || o.y<y0 || o.y>y1) continue;
      const lx=o.x-cmin, ly=o.y-y0, idx=ly*CHUNK_W+lx;
      const cur=arr[idx];
      if(replaceableForArena(cur,!!o.f)) arr[idx]=o.t;
    }
  }
  function applyToChunk(arr,cx){
    applyOpsToArray(arr,cx,0,WORLD_H);
  }
  function applyToSection(arr,cx,sy){
    if(!Number.isFinite(sy)) return;
    applyOpsToArray(arr,cx,Math.floor(sy)*WORLD_SECTION_H,WORLD_SECTION_H);
  }
  function terrainChanged(tx,ty,getTile){
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
  }
  function setTileKnown(tx,ty,cur,t,getTile,setTile,opts){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    if(ty<1 || ty>=WORLD_BOTTOM-3) return false;
    const force=!!(opts && opts.forceStory);
    if(cur!==T.AIR && isBlastProtectedTile(cur) && !force) return false;
    if(!replaceableForArena(cur,force || !!(opts && opts.replaceSolid))) return false;
    if(cur===t) return false;
    setTile(tx,ty,t);
    terrainChanged(tx,ty,getTile);
    return true;
  }
  function setTileSafe(tx,ty,t,getTile,setTile,opts){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    let cur=T.AIR;
    try{ cur=getTile(tx,ty); }catch(e){ return false; }
    return setTileKnown(tx,ty,cur,t,getTile,setTile,opts);
  }
  function materializeArena(getTile,setTile){
    if(!isUnlocked()) return 0;
    getTile = getTile || lastGetTile;
    setTile = setTile || lastSetTile;
    if(typeof getTile!=='function' || typeof setTile!=='function') return 0;
    const L = layoutFor();
    let changed=0;
    for(const o of L.ops){
      let cur=T.AIR;
      try{ cur=getTile(o.x,o.y); }catch(e){ cur=T.AIR; }
      if(cur===o.t) continue;
      if(setTileKnown(o.x,o.y,cur,o.t,getTile,setTile,{replaceSolid:true,forceStory:!!o.f})) changed++;
    }
    if(changed>0){
      state.materialized=true;
      markWorldChanged(true);
    }
    return changed;
  }
  function addEffect(e){
    if(effects.length>=CFG.EFFECT_CAP) effects.shift();
    effects.push(e);
  }
  function addHazard(h){
    if(hazards.length>=CFG.HAZARD_CAP) hazards.shift();
    hazards.push(h);
  }
  function makeCore(L){
    return {
      id:'earth-core-'+(state.seq++),
      kind:'earth',
      role:'core',
      name:SPEC.bossName,
      boss:true,
      x:L.bossX,
      y:L.bossY,
      vx:0,
      vy:0,
      dir:1,
      radius:3.05,
      hp:CFG.BOSS_HP,
      maxHp:CFG.BOSS_HP,
      t:0,
      hitFlash:0,
      contactCd:0,
      mode:'emerge',
      modeT:4.8,
      vulnerable:true,
      targetX:L.bossX,
      targetY:L.bossY,
      burrowT:0,
      lastCarveX:null,
      lastCarveY:null,
      shardCd:0.8,
      pillarCd:2.2,
      pulseCd:4.2,
      caveCd:3.1,
      drillCd:0,
      bombCd:0.55,
      zombieCd:CFG.ZOMBIE_GOLEM_SPAWN_SECONDS,
      zombieAwakened:false,
      gasFearT:0,
      gasFearX:null,
      gasFearY:null,
      shieldHint:0
    };
  }
  function makeDrone(a,index){
    const role=a.role || (index===0?'cutter':'backfill');
    return {
      id:'earth-drone-'+index+'-'+(state.seq++),
      kind:'earth',
      role:'drone',
      droneRole:role,
      name:role==='cutter' ? 'Cutter Drill Drone' : 'Backfill Drill Drone',
      boss:false,
      x:a.x,
      y:a.y,
      vx:0,
      vy:0,
      side:a.side,
      dir:a.side || 1,
      radius:1.42,
      hp:CFG.DRONE_HP,
      maxHp:CFG.DRONE_HP,
      t:0,
      shotCd:1.3+index*0.45,
      carveCd:0.35+index*0.2,
      sealCd:1.0+index*0.35,
      bombCd:role==='backfill' ? 1.1 : 1.8,
      hitFlash:0,
      contactCd:0
    };
  }
  function makeZombieGolem(pos,index){
    pos=pos||{};
    const seed=(Math.floor((pos.x||0)*97+(pos.y||0)*131+state.seq*17)>>>0) || (state.seq*37);
    return {
      id:'earth-zombie-golem-'+(state.seq++),
      kind:'earth',
      role:'zombieGolem',
      name:index%2 ? 'Rotten Tunnel Golem' : 'Zombie Stone Golem',
      boss:false,
      zombie:true,
      seed,
      x:Number.isFinite(pos.x) ? pos.x : layoutFor().ax,
      y:Number.isFinite(pos.y) ? pos.y : layoutFor().floorY-3,
      vx:0,
      vy:0,
      side:pos.side<0?-1:1,
      dir:pos.side<0?-1:1,
      radius:CFG.ZOMBIE_GOLEM_RADIUS,
      hp:CFG.ZOMBIE_GOLEM_HP,
      maxHp:CFG.ZOMBIE_GOLEM_HP,
      t:0,
      attackCd:0.25+Math.random()*0.35,
      jumpCd:0.25+Math.random()*0.55,
      hitFlash:0,
      contactCd:0,
      grounded:false,
      spawnT:0.55
    };
  }
  function fryZombieGolem(z){
    if(!z || z.dead || z.role!=='zombieGolem') return false;
    z.role='friedGolem';
    z.name='Fried Tunnel Golem';
    z.zombie=false;
    z.friendly=true;
    z.hp=clamp(Number(z.hp)||1,1,Number(z.maxHp)||CFG.ZOMBIE_GOLEM_HP);
    z.attackCd=0.18;
    z.jumpCd=0.25;
    z.spawnT=0.65;
    z.hitFlash=0.10;
    addEffect({type:'burst',kind:'earth',x:z.x,y:z.y-0.55,t:0,max:0.80,r:7});
    addEffect({type:'sparks',kind:'earth',x:z.x,y:z.y-0.55,t:0,max:0.55,r:5});
    say('Zombi golem zostal upieczony i odwraca sie przeciwko Nyxolithowi.');
    sfx('fire',{x:z.x,y:z.y});
    return true;
  }
  function activeCore(){ return entities.find(e=>e && !e.dead && e.boss); }
  function activeDrones(){ return entities.filter(e=>e && !e.dead && e.role==='drone' && e.hp>0); }
  function activeZombieGolems(){ return entities.filter(e=>e && !e.dead && e.role==='zombieGolem' && e.hp>0); }
  function activeFriedGolems(){ return entities.filter(e=>e && !e.dead && e.role==='friedGolem' && e.hp>0); }
  function activeDroneCount(){
    let n=0;
    for(const e of entities) if(e && !e.dead && e.role==='drone' && e.hp>0) n++;
    return n;
  }
  function activeZombieGolemCount(){
    return activeZombieGolems().length;
  }
  function inNeighbourhood(p,L){
    if(!p) return false;
    L = L || layoutFor();
    return Math.abs((p.x||0)-L.ax)<=CFG.LEASH_RADIUS && Math.abs((p.y||L.floorY)-L.floorY)<=CFG.LEASH_Y;
  }
  function nearAwaken(p,L){
    if(!p) return false;
    L = L || layoutFor();
    return Math.abs((p.x||0)-L.ax)<=CFG.AWAKEN_RADIUS && Math.abs((p.y||L.floorY)-L.floorY)<=CFG.AWAKEN_Y;
  }
  function clampArenaX(x,margin,L){
    L=L || layoutFor();
    const m=Number.isFinite(margin) ? margin : 7;
    return clamp(finite(x,L.ax),L.minX+m,L.maxX-m);
  }
  function clampArenaY(y,topMargin,floorMargin,L){
    L=L || layoutFor();
    const top=Number.isFinite(topMargin) ? topMargin : 7;
    const floor=Number.isFinite(floorMargin) ? floorMargin : 4.2;
    return clamp(finite(y,L.floorY-8),L.minY+top,L.floorY-floor);
  }
  function clampTunnelX(x,margin,L){
    L=L || layoutFor();
    const m=Number.isFinite(margin) ? margin : 7;
    const min=Number.isFinite(L.tunnelMinX) ? L.tunnelMinX : L.minX-CFG.TUNNEL_X_MARGIN;
    const max=Number.isFinite(L.tunnelMaxX) ? L.tunnelMaxX : L.maxX+CFG.TUNNEL_X_MARGIN;
    return clamp(finite(x,L.ax),min+m,max-m);
  }
  function clampTunnelY(y,topMargin,floorMargin,L){
    L=L || layoutFor();
    const top=Number.isFinite(topMargin) ? topMargin : 7;
    const floor=Number.isFinite(floorMargin) ? floorMargin : 4.2;
    const min=Number.isFinite(L.tunnelMinY) ? L.tunnelMinY : L.minY-CFG.TUNNEL_TOP_MARGIN;
    return clamp(finite(y,L.floorY-8),min+top,L.floorY-floor);
  }
  function clampBurrowPoint(x,y,L){
    return {x:clampTunnelX(x,7,L), y:clampTunnelY(y,7,4.2,L)};
  }
  function clearActive(){
    entities = [];
    hazards.length = 0;
    effects.length = 0;
    state.awakened = false;
    state.debugRematch = false;
  }
  function awaken(opts){
    opts=opts||{};
    if(!isUnlocked() && !opts.force) return false;
    if(isDefeated() && !opts.debug) return false;
    const L = layoutFor();
    clearActive();
    materializeArena(opts.getTile,opts.setTile);
    entities.push(makeCore(L));
    (L.droneSpawns || L.anchorSpawns || []).forEach((a,i)=>entities.push(makeDrone(a,i)));
    state.awakened = true;
    state.debugRematch = !!opts.debug;
    addEffect({type:'burst',x:L.bossX,y:L.bossY,kind:'earth',t:0,max:1.4,r:18});
    say(SPEC.bossName+' starts cutting tunnels beneath the alien gate.');
    sfx('explosion',{x:L.bossX,y:L.bossY});
    return true;
  }
  function sleep(){
    if(!state.awakened && !entities.length && !hazards.length) return false;
    clearActive();
    say(SPEC.bossName+' sinks back into the substrate.');
    return true;
  }
  function damageHero(amount,srcX,srcY,cause){
    if(!(amount>0)) return false;
    try{
      if(typeof root.damageHero === 'function'){
        root.damageHero(amount,{srcX,srcY,kb:5,kbY:-3.5,cause:cause||'underground_boss'});
        return true;
      }
    }catch(e){}
    const p=playerRef();
    if(p && typeof p.hp==='number') p.hp=Math.max(0,p.hp-amount);
    return true;
  }
  function circleBlocked(x,y,r,getTile){
    if(typeof getTile!=='function') return false;
    const minX=Math.floor(x-r), maxX=Math.floor(x+r);
    const minY=Math.floor(y-r), maxY=Math.floor(y+r);
    const rr=r*r;
    for(let ty=minY; ty<=maxY; ty++){
      for(let tx=minX; tx<=maxX; tx++){
        const cx=tx+0.5, cy=ty+0.5;
        const dx=Math.max(Math.abs(cx-x)-0.5,0);
        const dy=Math.max(Math.abs(cy-y)-0.5,0);
        if(dx*dx+dy*dy>rr) continue;
        try{ if(isSolid(getTile(tx,ty))) return true; }catch(e){}
      }
    }
    return false;
  }
  function movePhysical(e,dt,getTile,L){
    if(!e || (e.boss && e.mode==='burrow')) return;
    L = L || layoutFor();
    const maxSp = e.role==='zombieGolem' ? 5.4 : (e.hp/e.maxHp<0.3 ? 5.0 : (e.hp/e.maxHp<0.65 ? 4.25 : 3.55));
    e.vx = clamp(e.vx,-maxSp,maxSp);
    e.vy = clamp(e.vy+18*dt,-10,12);
    e.grounded=false;
    const tunnelMin=Number.isFinite(L.tunnelMinX) ? L.tunnelMinX : L.minX-CFG.TUNNEL_X_MARGIN;
    const tunnelMax=Number.isFinite(L.tunnelMaxX) ? L.tunnelMaxX : L.maxX+CFG.TUNNEL_X_MARGIN;
    const tunnelTop=Number.isFinite(L.tunnelMinY) ? L.tunnelMinY : L.minY-CFG.TUNNEL_TOP_MARGIN;
    const minX=(e.boss ? tunnelMin : L.minX)+5;
    const maxX=(e.boss ? tunnelMax : L.maxX)-5;
    const minY=(e.boss ? tunnelTop : L.minY)+3;
    let nx=e.x+e.vx*dt;
    if(nx-e.radius<minX){ nx=minX+e.radius; e.vx=Math.abs(e.vx)*0.35; }
    if(nx+e.radius>maxX){ nx=maxX-e.radius; e.vx=-Math.abs(e.vx)*0.35; }
    if(circleBlocked(nx,e.y,e.radius*0.78,getTile)) e.vx*=-0.45;
    else e.x=nx;
    let ny=e.y+e.vy*dt;
    if(ny+e.radius>L.floorY-0.12){ ny=L.floorY-e.radius-0.12; e.vy=0; e.grounded=true; }
    if(ny-e.radius<minY){ ny=minY+e.radius; e.vy=Math.abs(e.vy)*0.2; }
    if(circleBlocked(e.x,ny,e.radius*0.76,getTile)){
      if(e.vy>0){ e.vy=0; e.grounded=true; }
      else e.vy=Math.abs(e.vy)*0.25;
    }else e.y=ny;
    e.vx*=Math.max(0,1-dt*1.55);
  }
  function excavatableTile(t){
    if(t===T.AIR || t===T.WATER || t===T.LAVA) return false;
    return !isBlastProtectedTile(t);
  }
  function tunnelRimTile(x,y,L){
    L = L || layoutFor();
    const r=WG.randSeed((x+L.seed*0.01)*0.47+y*1.93);
    if(r>0.88) return T.ANTIMATTER_CRYSTAL;
    if(r>0.66) return T.METEOR_DUST;
    if(r>0.46) return T.ALIEN_BIOMASS;
    return T.BASALT;
  }
  function carveTunnelAt(x,y,r,getTile,setTile,opts){
    opts=opts||{};
    if(typeof getTile!=='function' || typeof setTile!=='function') return 0;
    const L=opts.layout || layoutFor();
    const radius=Math.max(0.6,Number(r)||CFG.BURROW_RADIUS);
    const tunnelMin=Number.isFinite(L.tunnelMinX) ? L.tunnelMinX : L.minX-8;
    const tunnelMax=Number.isFinite(L.tunnelMaxX) ? L.tunnelMaxX : L.maxX+8;
    const minX=Math.max(Math.floor(tunnelMin-4),Math.floor(x-radius-2));
    const maxX=Math.min(Math.ceil(tunnelMax+4),Math.ceil(x+radius+2));
    const minY=Math.max(2,Math.floor(y-radius-2));
    const maxY=Math.min(WORLD_BOTTOM-4,Math.ceil(y+radius+2));
    let changed=0, rim=0;
    for(let ty=minY; ty<=maxY; ty++){
      for(let tx=minX; tx<=maxX; tx++){
        const dx=(tx+0.5-x)/radius;
        const dy=(ty+0.5-y)/(radius*0.78);
        const d=dx*dx+dy*dy;
        let cur=T.AIR;
        try{ cur=getTile(tx,ty); }catch(e){ cur=T.AIR; }
        if(d<=1){
          if(excavatableTile(cur) && setTileKnown(tx,ty,cur,T.AIR,getTile,setTile,{replaceSolid:true})){
            changed++;
          }
        }else if(d<=1.55 && cur!==T.AIR && excavatableTile(cur) && rim<5 && WG.randSeed(tx*7.17+ty*3.31+state.seq*0.19)>0.68){
          if(setTileKnown(tx,ty,cur,tunnelRimTile(tx,ty,L),getTile,setTile,{replaceSolid:true})) rim++;
        }
      }
    }
    if(changed>0){
      state.tunnelsCarved += changed;
      addEffect({type:'tunnel',kind:'earth',x,y,t:0,max:0.55,r:radius+2});
      if(opts.noise!==false && changed>4) sfx('dig',{x,y});
      markWorldChanged(false);
    }
    return changed;
  }
  function pickBurrowTarget(core,p,L){
    L = L || layoutFor();
    const phase=phaseFor(core);
    const px=p && Number.isFinite(p.x) ? p.x : L.ax;
    const py=p && Number.isFinite(p.y) ? p.y : L.floorY-8;
    const sideTowardPlayer = px>=L.ax ? 1 : -1;
    const wallSide = Math.random()<0.72 ? sideTowardPlayer : -sideTowardPlayer;
    let x, y;
    if(Math.random() < (phase>=3 ? 0.78 : 0.62)){
      const wallInner = wallSide>0 ? L.maxX+8 : L.minX-8;
      const wallOuter = wallSide>0 ? L.tunnelMaxX-8 : L.tunnelMinX+8;
      x = lerp(wallInner, wallOuter, 0.35+Math.random()*0.62);
      y = py + (Math.random()-0.48)*(phase>=3?30:22);
      if(Math.random()<0.25) y = L.minY-7-Math.random()*CFG.TUNNEL_TOP_MARGIN;
    }else{
      const away = core && Number.isFinite(core.x) && px>=core.x ? 1 : -1;
      const flip = Math.random()<0.45 ? -1 : 1;
      x = px + away*flip*(18+Math.random()*(phase>=3?30:22));
      if(Math.abs(x-(core?core.x:L.ax))<14) x = (core?core.x:L.ax) - away*(24+Math.random()*14);
      y = py + (Math.random()-0.42)*(phase>=3?24:18);
    }
    if(phase>=2 && Math.random()<0.45) y -= 8+Math.random()*8;
    return clampBurrowPoint(x,y,L);
  }
  function exposureDuration(core){
    const phase=phaseFor(core);
    const deadDrones=2-activeDroneCount();
    return (phase>=3?2.55:phase>=2?3.2:4.1)+deadDrones*0.85;
  }
  function burrowDuration(core){
    const phase=phaseFor(core);
    return (phase>=3?1.15:phase>=2?1.45:1.85)+activeDroneCount()*0.32;
  }
  function startWindup(core,p,L){
    if(!core || core.dead) return;
    const target=pickBurrowTarget(core,p,L);
    core.mode='windup';
    core.vulnerable=true;
    core.modeT=0.62;
    core.targetX=target.x;
    core.targetY=target.y;
    core.vx*=0.25;
    core.vy*=0.1;
    addEffect({type:'warning',kind:'earth',x:target.x,y:target.y,t:0,max:0.72,r:8});
  }
  function startBurrow(core,getTile,setTile,L){
    if(!core || core.dead) return;
    L = L || layoutFor();
    core.mode='burrow';
    core.vulnerable=false;
    core.modeT=burrowDuration(core);
    core.burrowT=0;
    core.vx=0;
    core.vy=0;
    core.lastCarveX=null;
    core.lastCarveY=null;
    core.bombCd=0.28+Math.random()*0.24;
    carveTunnelAt(core.x,core.y,CFG.BURROW_RADIUS,getTile,setTile,{noise:false,layout:L});
    addEffect({type:'tunnel',kind:'earth',x:core.x,y:core.y,t:0,max:0.8,r:10});
  }
  function finishBurrow(core){
    if(!core || core.dead) return;
    core.mode='emerge';
    core.vulnerable=true;
    core.modeT=exposureDuration(core);
    core.shardCd=0.24;
    core.pillarCd=0.95;
    core.pulseCd=0.55;
    core.caveCd=1.2;
    core.bombCd=1.3;
    core.vx=0;
    core.vy=0;
    addEffect({type:'burst',kind:'earth',x:core.x,y:core.y,t:0,max:0.9,r:13});
    spawnPulse(core,phaseFor(core));
  }
  function predictPlayer(p,lead){
    if(!p) return {x:0,y:0};
    return {x:finite(p.x,0)+finite(p.vx,0)*lead, y:finite(p.y,0)+finite(p.vy,0)*lead};
  }
  function spawnShard(from,p,power){
    if(!from || !p) return;
    const lead = 0.35+Math.random()*0.45;
    const target = predictPlayer(p,lead);
    let dx=target.x-from.x, dy=target.y-from.y;
    const d=Math.hypot(dx,dy)||1;
    dx/=d; dy/=d;
    const sp=(8.5+Math.random()*2.2)*(power||1);
    addHazard({
      type:'shard',
      kind:'earth',
      x:from.x+dx*(from.radius||1.2),
      y:from.y+dy*(from.radius||1.2),
      vx:dx*sp,
      vy:dy*sp-0.65,
      r:0.34,
      t:0,
      life:3.8,
      dmg:10+Math.round(3*(power||1)),
      hit:false
    });
  }
  function spawnPillar(p,spread,L){
    L = L || layoutFor();
    const baseX = p ? finite(p.x,L.ax) : L.ax;
    const x = clamp(baseX+(Math.random()-0.5)*(spread||22), L.ax-40, L.ax+40);
    addHazard({type:'pillar',kind:'earth',x,y:L.floorY-1,delay:0.8,t:0,life:1.0,r:2.4,dmg:18,hit:false});
  }
  function spawnPulse(core,phase){
    if(!core) return;
    addHazard({type:'pulse',kind:'earth',x:core.x,y:core.y,t:0,delay:0.25,life:1.55,r0:3,r1:phase>=3?28:22,dmg:14,hit:false});
  }
  function spawnCaveRock(p,phase,L){
    L = L || layoutFor();
    const x = clamp((p?finite(p.x,L.ax):L.ax)+(Math.random()-0.5)*30, L.ax-42, L.ax+42);
    addHazard({type:'fallrock',kind:'earth',x,y:L.minY+5,vx:(Math.random()-0.5)*1.2,vy:1.6+phase*0.25,r:0.72,t:0,life:7,dmg:18+phase*3,hit:false});
  }
  function spawnBurrowBomb(from,phase,L){
    if(!from) return false;
    L = L || layoutFor();
    const dir=from.dir<0?-1:1;
    const bx=clampTunnelX(finite(from.x,L.ax)-dir*(1.0+Math.random()*1.6),2,L);
    const by=clampTunnelY(finite(from.y,L.floorY-5)+0.6+Math.random()*0.8,2,2.5,L);
    addHazard({
      type:'burrowBomb',
      kind:'earth',
      x:bx,
      y:by,
      r:CFG.BOMB_RADIUS + Math.max(0,phase-1)*0.55,
      delay:CFG.BOMB_ARM_TIME*(0.86+Math.random()*0.22),
      life:CFG.BOMB_BLAST_LIFE,
      t:0,
      dmg:22+phase*5,
      hit:false,
      exploded:false
    });
    addEffect({type:'sparks',kind:'earth',x:bx,y:by,t:0,max:0.42,r:4});
    return true;
  }
  function findZombieSpawnSpot(p,L,getTile,index){
    L = L || layoutFor();
    const px=p && Number.isFinite(p.x) ? p.x : L.ax;
    const dir=index%2===0 ? -1 : 1;
    const offsets=[dir*15,-dir*15,dir*23,-dir*23,dir*9,-dir*9,dir*31,-dir*31];
    for(const off of offsets){
      const tx=Math.round(clamp(px+off,L.minX+8,L.maxX-8));
      for(const fy of [L.floorY,L.floorY-1,L.floorY+1,L.floorY-2,L.floorY+2]){
        if(fy<4 || fy>=WORLD_BOTTOM-2) continue;
        try{
          const floor=getTile ? getTile(tx,fy) : T.BASALT;
          const body=getTile ? getTile(tx,fy-1) : T.AIR;
          const head=getTile ? getTile(tx,fy-2) : T.AIR;
          if(isSolid(floor) && !isSolid(body) && !isSolid(head)){
            return {x:tx+0.5,y:fy-1,side:px>=tx ? 1 : -1};
          }
        }catch(e){}
      }
    }
    const fallbackX=clamp(px+dir*18,L.minX+8,L.maxX-8);
    return {x:fallbackX,y:L.floorY-CFG.ZOMBIE_GOLEM_RADIUS-0.14,side:px>=fallbackX ? 1 : -1};
  }
  function spawnZombieGolemWave(core,p,L,getTile){
    if(!core || core.dead || core.hp/core.maxHp>=CFG.ZOMBIE_GOLEM_HEALTH_RATIO) return 0;
    L = L || layoutFor();
    const room=Math.max(0,CFG.ZOMBIE_GOLEM_MAX_ACTIVE-activeZombieGolemCount());
    const n=Math.min(CFG.ZOMBIE_GOLEM_WAVE_SIZE,room);
    if(n<=0) return 0;
    let spawned=0, soundX=0, soundY=0;
    for(let i=0;i<n;i++){
      const spot=findZombieSpawnSpot(p,L,getTile,i);
      const z=makeZombieGolem(spot,i);
      z.vx=(p && p.x<z.x ? -1 : 1)*(1.2+Math.random()*0.9);
      z.vy=-2.4-Math.random()*1.2;
      entities.push(z);
      soundX+=z.x;
      soundY+=z.y;
      spawned++;
      addEffect({type:'burst',kind:'earth',x:z.x,y:z.y-0.5,t:0,max:0.75,r:6});
      addEffect({type:'sparks',kind:'earth',x:z.x,y:z.y-0.6,t:0,max:0.48,r:4});
    }
    if(spawned>0){
      say('Zombie golemy wyrywaja sie z tuneli Nyxolithu.');
      sfx('hurt',{x:soundX/spawned,y:soundY/spawned});
    }
    return spawned;
  }
  function scareCoreFromGas(core,x,y,L){
    if(!core || core.dead) return false;
    L = L || layoutFor();
    const sx=Number.isFinite(Number(x)) ? Number(x) : core.x;
    const sy=Number.isFinite(Number(y)) ? Number(y) : core.y;
    const dx=core.x-sx, dy=core.y-sy;
    const d=Math.hypot(dx,dy)||1;
    const awayX=dx/d || (core.dir<0?-1:1);
    const awayY=dy/d;
    const panic=clampBurrowPoint(core.x+awayX*(22+Math.random()*16), core.y+awayY*9-5-Math.random()*6, L);
    core.gasFearT=CFG.GAS_FEAR_SECONDS;
    core.gasFearX=sx;
    core.gasFearY=sy;
    core.targetX=panic.x;
    core.targetY=panic.y;
    core.vx+=awayX*3.8;
    core.vy+=Math.min(0,awayY*2.0)-1.4;
    core.shieldHint=Math.max(core.shieldHint||0,0.7);
    addEffect({type:'warning',kind:'earth',x:core.x,y:core.y,t:0,max:0.52,r:10});
    addEffect({type:'sparks',kind:'earth',x:sx,y:sy,t:0,max:0.40,r:4});
    if(core.mode!=='burrow'){
      core.mode='windup';
      core.vulnerable=true;
      core.modeT=Math.min(finite(core.modeT,1),CFG.GAS_FEAR_BURROW_DELAY);
    }
    if(state.hintCd<=0){
      say('Nyxolith chokes on the gas and dives for cleaner stone.');
      state.hintCd=2.2;
    }
    sfx('dig',{x:core.x,y:core.y});
    return true;
  }
  function detonateBurrowBomb(h,p,getTile,setTile,L){
    if(!h || h.exploded) return 0;
    h.exploded=true;
    addEffect({type:'bomb',kind:'earth',x:h.x,y:h.y,t:0,max:0.72,r:h.r+2});
    sfx('explosion',{x:h.x,y:h.y});
    if(p && !h.hit && Math.hypot(finite(p.x,0)-h.x,finite(p.y,0)-h.y)<h.r+0.9){
      h.hit=true;
      damageHero(h.dmg,h.x,h.y,'earth_burrow_bomb');
    }
    if(typeof getTile!=='function' || typeof setTile!=='function') return 0;
    let changed=0, rim=0;
    const minX=Math.floor(h.x-h.r-1), maxX=Math.ceil(h.x+h.r+1);
    const minY=Math.floor(h.y-h.r-1), maxY=Math.ceil(h.y+h.r+1);
    for(let ty=minY; ty<=maxY; ty++){
      for(let tx=minX; tx<=maxX; tx++){
        if(ty<2 || ty>=WORLD_BOTTOM-3) continue;
        const dx=(tx+0.5-h.x)/h.r;
        const dy=(ty+0.5-h.y)/(h.r*0.86);
        const d=dx*dx+dy*dy;
        if(d>1.28) continue;
        let cur=T.AIR;
        try{ cur=getTile(tx,ty); }catch(e){ cur=T.AIR; }
        if(!excavatableTile(cur)) continue;
        if(d<0.72){
          if(setTileKnown(tx,ty,cur,T.AIR,getTile,setTile,{replaceSolid:true})) changed++;
        }else if(rim<10 && setTileKnown(tx,ty,cur,tunnelRimTile(tx,ty,L),getTile,setTile,{replaceSolid:true})){
          rim++;
        }
      }
    }
    if(changed>0){
      state.tunnelsCarved += changed;
      markWorldChanged(false);
    }
    return changed;
  }
  function phaseFor(core){
    if(!core) return 1;
    const r=core.hp/core.maxHp;
    return r<0.3 ? 3 : (r<0.65 ? 2 : 1);
  }
  function updateZombieGolemSpawner(core,p,dt,L,getTile){
    if(!core || core.dead) return;
    const below=core.hp/core.maxHp<CFG.ZOMBIE_GOLEM_HEALTH_RATIO;
    if(!below){
      core.zombieAwakened=false;
      core.zombieCd=CFG.ZOMBIE_GOLEM_SPAWN_SECONDS;
      return;
    }
    if(!core.zombieAwakened){
      core.zombieAwakened=true;
      core.zombieCd=Math.min(finite(core.zombieCd,CFG.ZOMBIE_GOLEM_FIRST_DELAY),CFG.ZOMBIE_GOLEM_FIRST_DELAY);
      addEffect({type:'warning',kind:'earth',x:core.x,y:core.y,t:0,max:1.1,r:14});
      say('Nyxolith budzi zombi golemy w scianach tunelu.');
    }
    core.zombieCd=Math.max(0,finite(core.zombieCd,CFG.ZOMBIE_GOLEM_SPAWN_SECONDS)-dt);
    if(core.zombieCd<=0){
      spawnZombieGolemWave(core,p,L,getTile);
      core.zombieCd=CFG.ZOMBIE_GOLEM_SPAWN_SECONDS;
    }
  }
  function updateCore(core,p,getTile,setTile,dt,L){
    L = L || layoutFor();
    const phase=phaseFor(core);
    core.t+=dt;
    core.hitFlash=Math.max(0,core.hitFlash-dt);
    core.contactCd=Math.max(0,core.contactCd-dt);
    core.shieldHint=Math.max(0,core.shieldHint-dt);
    core.bombCd=Math.max(0,finite(core.bombCd,1)-dt);
    core.gasFearT=Math.max(0,finite(core.gasFearT,0)-dt);
    if(core.mode==='burrow'){
      core.modeT-=dt;
      core.burrowT+=dt;
      const target=clampBurrowPoint(core.targetX,core.targetY,L);
      core.targetX=target.x;
      core.targetY=target.y;
      const tx=target.x, ty=target.y;
      const dx=tx-core.x, dy=ty-core.y;
      const d=Math.hypot(dx,dy)||1;
      const speed=CFG.BURROW_SPEED*(1+phase*0.11+activeDroneCount()*0.06);
      const step=Math.min(d,speed*dt);
      core.x+=dx/d*step;
      core.y+=dy/d*step;
      core.dir=dx>=0?1:-1;
      const cdx=core.lastCarveX==null?999:core.x-core.lastCarveX;
      const cdy=core.lastCarveY==null?999:core.y-core.lastCarveY;
      if(cdx*cdx+cdy*cdy>0.36){
        carveTunnelAt(core.x,core.y,CFG.BURROW_RADIUS+phase*0.18,getTile,setTile,{layout:L});
        core.lastCarveX=core.x;
        core.lastCarveY=core.y;
      }
      if(core.bombCd<=0){
        spawnBurrowBomb(core,phase,L);
        core.bombCd=(phase>=3?0.58:phase>=2?0.78:0.98)*(0.78+Math.random()*0.44);
      }
      if(Math.random()<dt*(phase>=3?2.4:1.5)) spawnCaveRock({x:core.x,y:core.y},phase,L);
      if(d<1.05 || core.modeT<=0) finishBurrow(core);
      return;
    }
    if(core.mode==='windup'){
      core.modeT-=dt;
      core.vx*=Math.max(0,1-dt*5);
      core.vy*=Math.max(0,1-dt*5);
      if(Math.random()<dt*10) addEffect({type:'sparks',kind:'earth',x:core.x+(Math.random()-0.5)*5,y:core.y+(Math.random()-0.5)*3,t:0,max:0.35,r:3});
      if(core.modeT<=0) startBurrow(core,getTile,setTile,L);
      return;
    }
    core.mode='emerge';
    core.vulnerable=true;
    core.modeT-=dt;
    if(p){
      const afraid=core.gasFearT>0 && Number.isFinite(core.gasFearX);
      const dir = afraid ? (core.x>=core.gasFearX ? 1 : -1) : (finite(p.x,core.x)>=core.x ? 1 : -1);
      core.dir=dir;
      const desired = dir*(afraid ? (phase>=3?13:11) : (phase>=3?12:phase>=2?9.5:7.5));
      core.vx += desired*dt;
      if(!afraid && phase>=2 && Math.abs(p.x-core.x)<10 && Math.abs(p.y-core.y)<8 && Math.abs(core.vy)<0.1){
        core.vy -= 4.6+phase*0.9;
      }
    }
    movePhysical(core,dt,getTile,L);
    core.shardCd-=dt;
    core.pillarCd-=dt;
    core.pulseCd-=dt;
    core.caveCd-=dt;
    if(core.shardCd<=0){
      const n=phase>=3?3:(phase>=2?2:1);
      for(let i=0;i<n;i++) spawnShard(core,p,1+phase*0.12);
      core.shardCd=(phase>=3?0.82:phase>=2?1.12:1.45)*(0.82+Math.random()*0.36);
    }
    if(core.pillarCd<=0){
      spawnPillar(p,phase>=3?34:24,L);
      if(phase>=3) spawnPillar(p,38,L);
      core.pillarCd=(phase>=3?1.65:phase>=2?2.15:3.1)*(0.86+Math.random()*0.3);
    }
    if(core.pulseCd<=0){
      spawnPulse(core,phase);
      core.pulseCd=(phase>=3?3.0:4.2)*(0.85+Math.random()*0.3);
    }
    if(core.caveCd<=0){
      const n=phase>=3?3:(phase>=2?2:1);
      for(let i=0;i<n;i++) spawnCaveRock(p,phase,L);
      core.caveCd=(phase>=3?2.25:3.2)*(0.9+Math.random()*0.35);
    }
    if(core.bombCd<=0){
      spawnBurrowBomb(core,phase,L);
      core.bombCd=(phase>=3?2.2:3.2)*(0.85+Math.random()*0.42);
    }
    if(core.modeT<=0) startWindup(core,p,L);
  }
  function updateDrone(d,p,getTile,setTile,dt,L){
    L = L || layoutFor();
    d.t+=dt;
    d.hitFlash=Math.max(0,d.hitFlash-dt);
    d.contactCd=Math.max(0,d.contactCd-dt);
    d.shotCd-=dt;
    d.carveCd-=dt;
    d.sealCd-=dt;
    d.bombCd-=dt;
    const core=activeCore();
    const targetX=d.droneRole==='cutter'
      ? (p ? finite(p.x,d.x)+d.side*5 : d.x+d.side*4)
      : (core ? core.x-d.side*7 : d.x-d.side*4);
    const targetY=d.droneRole==='cutter'
      ? (p ? clamp(finite(p.y,d.y)-1.2,L.minY+6,L.floorY-4) : d.y)
      : (core ? clamp(core.y+2,L.minY+6,L.floorY-3) : d.y);
    const dx=targetX-d.x, dy=targetY-d.y;
    const dist=Math.hypot(dx,dy)||1;
    d.vx += dx/dist*dt*(d.droneRole==='cutter'?7.2:5.8);
    d.vy += dy/dist*dt*(d.droneRole==='cutter'?3.0:2.2);
    d.dir=dx>=0?1:-1;
    movePhysical(d,dt,getTile,L);
    if(d.carveCd<=0){
      carveTunnelAt(d.x,d.y,CFG.DRONE_TUNNEL_RADIUS,getTile,setTile,{noise:false,layout:L});
      d.carveCd=d.droneRole==='cutter' ? 0.42 : 0.72;
    }
    if(d.droneRole==='backfill' && d.sealCd<=0 && getTile && setTile){
      const bx=Math.round(d.x-d.side*2), by=Math.round(d.y+1);
      if(!p || dist2(p.x,p.y,bx+0.5,by+0.5)>12.25){
        const cur=getTile(bx,by);
        if(cur===T.AIR && by>2 && by<WORLD_BOTTOM-4){
          const t=Math.random()<0.55?T.METEOR_DUST:T.BASALT;
          if(setTileKnown(bx,by,cur,t,getTile,setTile,{replaceSolid:false})){
            markWorldChanged(false);
            addEffect({type:'sparks',kind:'earth',x:bx+0.5,y:by+0.5,t:0,max:0.4,r:3});
          }
        }
      }
      d.sealCd=1.4+Math.random()*0.8;
    }
    if(d.shotCd<=0){
      if(d.droneRole==='cutter') spawnShard(d,p,0.88);
      else spawnCaveRock(d,1,L);
      d.shotCd=d.droneRole==='cutter' ? 1.25+Math.random()*0.55 : 1.75+Math.random()*0.9;
    }
    if(d.bombCd<=0){
      spawnBurrowBomb(d,d.droneRole==='backfill'?2:1,L);
      d.bombCd=d.droneRole==='backfill' ? 2.1+Math.random()*0.9 : 3.0+Math.random()*1.2;
    }
  }
  function updateZombieGolem(z,p,getTile,setTile,dt,L){
    void setTile;
    L = L || layoutFor();
    z.t+=dt;
    z.spawnT=Math.max(0,finite(z.spawnT,0)-dt);
    z.hitFlash=Math.max(0,z.hitFlash-dt);
    z.contactCd=Math.max(0,z.contactCd-dt);
    z.attackCd=Math.max(0,finite(z.attackCd,0)-dt);
    z.jumpCd=Math.max(0,finite(z.jumpCd,0)-dt);
    if(p){
      const dx=finite(p.x,z.x)-z.x;
      const dy=finite(p.y,z.y)-z.y;
      const dir=dx>=0 ? 1 : -1;
      z.dir=dir;
      z.vx += dir*dt*(Math.abs(dx)>1.1 ? 11.5 : 4.2);
      if(z.grounded && z.jumpCd<=0 && (Math.abs(dx)>2.2 || dy<-1.0)){
        z.vy=Math.min(z.vy,-7.4-Math.random()*1.8);
        z.jumpCd=0.85+Math.random()*0.55;
      }
      const reach=(z.radius||1)+0.55;
      if(z.spawnT<=0 && z.attackCd<=0 && Math.abs(dx)<reach && Math.abs(dy)<2.05){
        z.attackCd=0.78+Math.random()*0.22;
        z.vx+=dir*1.6;
        addEffect({type:'hit',kind:'earth',x:p.x,y:p.y-0.55,t:0,max:0.28,r:3.5});
        damageHero(CFG.ZOMBIE_GOLEM_DAMAGE,z.x,z.y-0.6,'earth_zombie_golem');
      }
    }
    movePhysical(z,dt,getTile,L);
    if(z.y>WORLD_BOTTOM+8 || z.x<L.minX-16 || z.x>L.maxX+16) z.dead=true;
  }
  function friedGolemTarget(z){
    let best=null, bd=Infinity;
    for(const e of entities){
      if(!e || e.dead || e===z || e.friendly) continue;
      if(e.boss && !coreVulnerable(e)) continue;
      if(!(e.boss || e.role==='drone' || e.role==='zombieGolem')) continue;
      const d=dist2(z.x,z.y,e.x,e.y);
      if(d<bd){ bd=d; best=e; }
    }
    return best;
  }
  function friedGolemStrike(z,target){
    if(!z || !target || target.dead) return false;
    const dmg=12+Math.min(10,(Number(z.hp)||0)*0.045);
    target.hp-=dmg;
    target.hitFlash=0.18;
    addEffect({type:'hit',kind:'earth',x:target.x,y:target.y,t:0,max:0.30,r:(target.radius||1)*2.1});
    sparksTarget(target.x,target.y);
    if(target.hp<=0) defeatEntity(target);
    return true;
  }
  function sparksTarget(x,y){
    addEffect({type:'sparks',kind:'earth',x,y,t:0,max:0.32,r:4});
  }
  function updateFriedGolem(z,p,getTile,setTile,dt,L){
    void p; void setTile;
    L = L || layoutFor();
    z.t+=dt;
    z.spawnT=Math.max(0,finite(z.spawnT,0)-dt);
    z.hitFlash=Math.max(0,z.hitFlash-dt);
    z.contactCd=Math.max(0,z.contactCd-dt);
    z.attackCd=Math.max(0,finite(z.attackCd,0)-dt);
    z.jumpCd=Math.max(0,finite(z.jumpCd,0)-dt);
    const target=friedGolemTarget(z);
    if(target){
      const dx=target.x-z.x, dy=target.y-z.y;
      const dir=dx>=0 ? 1 : -1;
      z.dir=dir;
      z.vx += dir*dt*(Math.abs(dx)>1.1 ? 10.2 : 3.6);
      if(z.grounded && z.jumpCd<=0 && (Math.abs(dx)>2.0 || dy<-1.0)){
        z.vy=Math.min(z.vy,-7.0-Math.random()*1.4);
        z.jumpCd=0.92+Math.random()*0.48;
      }
      const reach=(z.radius||1)+((target.radius||1)*0.66)+0.48;
      if(z.spawnT<=0 && z.attackCd<=0 && Math.abs(dx)<reach && Math.abs(dy)<2.2){
        z.attackCd=0.72+Math.random()*0.24;
        z.vx+=dir*1.35;
        friedGolemStrike(z,target);
      }
    }else{
      z.vx*=Math.max(0,1-dt*1.8);
    }
    movePhysical(z,dt,getTile,L);
    if(z.y>WORLD_BOTTOM+8 || z.x<L.minX-16 || z.x>L.maxX+16) z.dead=true;
  }
  function hitHeroCircle(p,x,y,r,dmg,cause,h){
    if(!p || h.hit) return false;
    const hw=Math.max(0.25,(p.w||0.7)*0.5);
    const hh=Math.max(0.35,(p.h||0.95)*0.5);
    const cx=clamp(x,p.x-hw,p.x+hw);
    const cy=clamp(y,p.y-hh,p.y+hh);
    if(dist2(cx,cy,x,y)>r*r) return false;
    h.hit=true;
    return damageHero(dmg,x,y,cause);
  }
  function updateHazards(dt,p,getTile,setTile,L){
    L = L || layoutFor();
    for(let i=hazards.length-1;i>=0;i--){
      const h=hazards[i];
      h.t+=dt;
      if(h.type==='shard'){
        h.vy += 7*dt;
        h.x += h.vx*dt;
        h.y += h.vy*dt;
        if(hitHeroCircle(p,h.x,h.y,h.r+0.32,h.dmg,'earth_shard',h)){
          addEffect({type:'hit',kind:'earth',x:h.x,y:h.y,t:0,max:0.35,r:3});
          hazards.splice(i,1);
          continue;
        }
        const tx=Math.floor(h.x), ty=Math.floor(h.y);
        let blocked=false;
        try{ blocked=!!(getTile && isSolid(getTile(tx,ty))); }catch(e){}
        if(blocked || h.y>=L.floorY-0.2){
          addEffect({type:'sparks',kind:'earth',x:h.x,y:Math.min(h.y,L.floorY-0.5),t:0,max:0.45,r:4});
          hazards.splice(i,1);
          continue;
        }
      }else if(h.type==='pillar'){
        if(h.t>=h.delay && !h.armed){
          h.armed=true;
          let pillarChanged=0;
          addEffect({type:'pillar',kind:'earth',x:h.x,y:h.y,t:0,max:0.45,r:7});
          const tx=Math.round(h.x);
          for(let yy=Math.max(2,L.floorY-10); yy<=L.floorY-2; yy+=2){
            if(setTile && getTile && Math.random()<0.34 && setTileSafe(tx+(yy%4===0?1:-1),yy,T.METEOR_DUST,getTile,setTile,{forceStory:false})) pillarChanged++;
          }
          if(pillarChanged>0) markWorldChanged(false);
        }
        if(h.armed && !h.hit && p && Math.abs(p.x-h.x)<h.r && p.y>L.floorY-13 && p.y<L.floorY+2){
          h.hit=true;
          damageHero(h.dmg,h.x,h.y,'earth_pillar');
        }
        if(h.t>=h.delay+h.life){ hazards.splice(i,1); continue; }
      }else if(h.type==='pulse'){
        if(h.t>=h.delay){
          const f=clamp((h.t-h.delay)/Math.max(0.01,h.life),0,1);
          const r=lerp(h.r0,h.r1,f);
          if(p && !h.hit){
            const d=Math.hypot(p.x-h.x,p.y-h.y);
            if(Math.abs(d-r)<1.35){
              h.hit=true;
              damageHero(h.dmg,h.x,h.y,'earth_pulse');
            }else if(d<r && d>1){
              p.vx = finite(p.vx,0)+(h.x-p.x)/d*dt*6.5;
              p.vy = finite(p.vy,0)+(h.y-p.y)/d*dt*3.5;
            }
          }
        }
        if(h.t>=h.delay+h.life){ hazards.splice(i,1); continue; }
      }else if(h.type==='fallrock'){
        h.vy += 12*dt;
        h.x += h.vx*dt;
        h.y += h.vy*dt;
        if(hitHeroCircle(p,h.x,h.y,h.r+0.55,h.dmg,'falling_substrate',h)){
          addEffect({type:'sparks',kind:'earth',x:h.x,y:h.y,t:0,max:0.5,r:5});
          hazards.splice(i,1);
          continue;
        }
        const tx=Math.floor(h.x), ty=Math.floor(h.y);
        let blocked=false;
        try{ blocked=!!(getTile && isSolid(getTile(tx,ty))); }catch(e){}
        if(blocked || h.y>=L.floorY-0.35){
          addEffect({type:'burst',kind:'earth',x:h.x,y:Math.min(h.y,L.floorY-0.4),t:0,max:0.65,r:6});
          hazards.splice(i,1);
          continue;
        }
      }else if(h.type==='burrowBomb'){
        if(h.t>=h.delay && !h.exploded) detonateBurrowBomb(h,p,getTile,setTile,L);
        if(h.exploded && h.t>=h.delay+h.life){
          hazards.splice(i,1);
          continue;
        }
      }
      const minX=(Number.isFinite(L.tunnelMinX)?L.tunnelMinX:L.minX)-12;
      const maxX=(Number.isFinite(L.tunnelMaxX)?L.tunnelMaxX:L.maxX)+12;
      if(h.t>h.life+2+(h.delay||0) || h.x<minX || h.x>maxX || h.y<0 || h.y>WORLD_BOTTOM){ hazards.splice(i,1); }
    }
  }
  function updateEffects(dt){
    for(let i=effects.length-1;i>=0;i--){
      effects[i].t+=dt;
      if(effects[i].t>=effects[i].max) effects.splice(i,1);
    }
  }
  function coreVulnerable(e){
    return !!(e && e.boss && e.mode!=='burrow' && e.vulnerable!==false);
  }
  function deathBlast(e,getTile,setTile){
    if(!e) return false;
    const L = layoutFor();
    addEffect({type:'burst',kind:'earth',x:e.x,y:e.y,t:0,max:2.4,r:38});
    try{
      const p=playerRef();
      if(p && Number.isFinite(p.hp) && p.hp<1) p.hp=1;
    }catch(err){}
    const M=MM.meteorites;
    if(M && typeof M.impactAt==='function' && typeof getTile==='function' && typeof setTile==='function'){
      try{
        const ok=!!M.impactAt(e.x,L.floorY-1,getTile,setTile,CFG.DEATH_BLAST_INTENSITY,null,{
          classId:'antimatter',
          site:'underground_boss_defeat',
          surfaceY:L.floorY-1,
          colossal:true,
          scale:CFG.DEATH_BLAST_SCALE,
          skipActorDamage:true
        });
        if(ok){
          state.lastCrater={x:e.x,y:L.floorY-1,meteorite:true};
          return true;
        }
      }catch(err){}
    }
    const R=18;
    for(let dy=-R; dy<=R; dy++){
      for(let dx=-R; dx<=R; dx++){
        const d=Math.hypot(dx,dy*1.12);
        if(d>R || Math.random()>(1-d/R)*0.95+0.05) continue;
        const tx=Math.round(e.x+dx), ty=Math.round(L.floorY-3+dy);
        if(ty<2 || ty>=WORLD_BOTTOM-3 || !setTile || !getTile) continue;
        const cur=getTile(tx,ty);
        if(isBlastProtectedTile(cur)) continue;
        setTile(tx,ty,d>R*0.74 ? (Math.random()<0.5?T.METEOR_DUST:T.BASALT) : T.AIR);
        terrainChanged(tx,ty,getTile);
      }
    }
    markWorldChanged(true);
    state.lastCrater={x:e.x,y:L.floorY-1,meteorite:false};
    return true;
  }
  function awardHeart(){
    let newly=true, progressHandled=false;
    try{
      if(MM.progress && MM.progress.markGuardianHeart){
        newly=!!MM.progress.markGuardianHeart('earth');
        progressHandled=true;
      }
    }catch(e){}
    const inv=root.inv;
    if(!progressHandled) newly=!(inv && (Number(inv[SPEC.heartKey])||0)>0);
    state.defeated=true;
    state.awakened=false;
    state.heartAwarded=true;
    if(newly){
      if(inv) inv[SPEC.heartKey]=(Number(inv[SPEC.heartKey])||0)+1;
      try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
      say(SPEC.heartLabel+' acquired.');
    }else{
      say(SPEC.heartLabel+' already beats in your story.');
    }
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-guardian-defeated',{detail:{kind:'earth',name:SPEC.bossName,heart:SPEC.heartKey,newReward:newly,underground:true}})); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-boss-killed',{detail:{name:SPEC.bossName,guardian:true,kind:'earth',underground:true}})); }catch(e){}
    try{ if(MM.guardianAftermath && MM.guardianAftermath.start) MM.guardianAftermath.start('earth'); }catch(e){}
    markWorldChanged(true);
    return newly;
  }
  function defeatEntity(e){
    if(!e || e.dead) return;
    e.dead=true;
    addEffect({type:'burst',kind:'earth',x:e.x,y:e.y,t:0,max:e.boss?1.5:0.8,r:e.boss?16:7});
    sfx(e.boss?'explosion':'spark',{x:e.x,y:e.y});
    if(e.boss){
      deathBlast(e,lastGetTile,lastSetTile);
      awardHeart();
      for(const other of entities) other.dead=true;
      hazards.length=0;
    }else if(e.role==='zombieGolem'){
      say(e.name+' rozpada sie na zgnily gruz.');
    }else{
      say(e.name+' fractures.');
    }
  }
  function isArrowDamage(opts){
    return !!(opts && (opts.kind==='arrow' || opts.type==='arrow' || opts.projectile==='arrow' || opts.source==='arrow'));
  }
  function isGasDamage(opts){
    return !!(opts && (opts.element==='gas' || opts.kind==='gas' || opts.type==='gas' || opts.poison || opts.toxic));
  }
  function deflectArrow(e,opts){
    if(!e || !e.boss) return false;
    const x=Number.isFinite(Number(opts && opts.x)) ? Number(opts.x) : e.x;
    const y=Number.isFinite(Number(opts && opts.y)) ? Number(opts.y) : e.y;
    e.hitFlash=0.10;
    addEffect({type:'sparks',kind:'earth',x,y,t:0,max:0.36,r:4.5});
    addEffect({type:'hit',kind:'earth',x:e.x,y:e.y,t:0,max:0.24,r:6});
    if(state.hintCd<=0){
      say('Strzala odbija sie od pancerza Nyxolithu.');
      state.hintCd=1.8;
    }
    sfx('spark',{x,y});
    return 'bounce';
  }
  function hitEntity(e,dmg,opts){
    if(!e || e.dead || !(dmg>0)) return false;
    let amount=Math.max(0.5,Number(dmg)||1);
    // weakened elemental matrix (boss_status.js): a soaked target conducts
    const elemRaw=String((opts && (opts.element||opts.kind||opts.cause))||'').toLowerCase();
    if(/electric|shock|laser|lightning/.test(elemRaw)) amount*=bossElectricDamageMult(e._elemStatus);
    if(e.boss && isArrowDamage(opts)) return deflectArrow(e,opts);
    if(e.boss && isGasDamage(opts)){
      scareCoreFromGas(e,opts && opts.x,opts && opts.y,layoutFor());
      amount*=CFG.GAS_DAMAGE_MULT;
    }
    if(e.boss && !coreVulnerable(e)){
      if(state.hintCd<=0){
        say('The excavator is under the rock. Follow the fresh tunnel and hit it when it surfaces.');
        state.hintCd=2.5;
      }
      addEffect({type:'sparks',kind:'earth',x:e.x,y:e.y,t:0,max:0.22,r:4});
      return false;
    }
    e.hp-=amount;
    e.hitFlash=0.18;
    addEffect({type:'hit',kind:'earth',x:e.x,y:e.y,t:0,max:0.28,r:(e.radius||1)*2.2});
    if(e.hp<=0) defeatEntity(e);
    return true;
  }
  function entityHitScore(e,x,y,r){
    const d=Math.hypot(e.x-x,e.y-y)-(e.radius||1)-r;
    return d<=0 ? d : Infinity;
  }
  function entityAtTile(tx,ty){
    const x=tx+0.5, y=ty+0.5;
    let best=null, bd=Infinity;
    for(const e of entities){
      if(e.dead) continue;
      if(e.friendly) continue;
      if(e.boss && !coreVulnerable(e)) continue;
      const d=entityHitScore(e,x,y,0.66);
      if(d<bd){ bd=d; best=e; }
    }
    return best;
  }
  function damageAt(tx,ty,dmg,opts){
    const e=entityAtTile(tx,ty);
    if(!e) return false;
    return hitEntity(e,dmg,opts);
  }
  function heatAt(tx,ty,getTile,setTile,opts){
    void getTile; void setTile; void opts;
    const x=Number(tx)+0.5, y=Number(ty)+0.5;
    if(!Number.isFinite(x) || !Number.isFinite(y)) return false;
    for(const e of entities){
      if(!e || e.dead || e.role!=='zombieGolem') continue;
      const reach=Math.max(1.0,(e.radius||1)*0.82);
      if(Math.abs(x-e.x)<=reach && Math.abs(y-e.y)<=Math.max(1.2,(e.radius||1)*1.15)){
        return fryZombieGolem(e);
      }
    }
    return false;
  }
  function attackAt(tx,ty,bonus){
    return damageAt(tx,ty,5+Math.max(0,Number(bonus)||0));
  }
  function separateHeroFromEntity(e,p,dt){
    if(!e || !p || e.dead) return false;
    if(e.boss && e.mode==='burrow') return false;
    const hw=Math.max(0.25,(p.w||0.7)*0.5);
    const hh=Math.max(0.35,(p.h||0.95)*0.5);
    const cx=clamp(e.x,p.x-hw,p.x+hw);
    const cy=clamp(e.y,p.y-hh,p.y+hh);
    let dx=cx-e.x, dy=cy-e.y;
    let d=Math.hypot(dx,dy);
    const min=(e.radius||1)+0.04;
    if(d>=min) return false;
    if(d<0.001){ dx=p.x-e.x || 1; dy=p.y-e.y || -0.2; d=Math.hypot(dx,dy)||1; }
    const nx=dx/d, ny=dy/d;
    const push=(min-d)*0.72;
    p.x += nx*push;
    p.y += ny*push*0.45;
    p.vx = finite(p.vx,0)+nx*5.2*dt;
    p.vy = finite(p.vy,0)+ny*3.0*dt;
    e.contactCd=Math.max(0,(e.contactCd||0)-dt);
    if(!e.friendly && e.contactCd<=0){
      e.contactCd=CFG.CONTACT_CD;
      const contactDmg=e.boss?18:(e.role==='zombieGolem'?7:9);
      const cause=e.boss?'earth_excavator_contact':(e.role==='zombieGolem'?'earth_zombie_golem_contact':'earth_drone_contact');
      damageHero(contactDmg,e.x,e.y,cause);
    }
    return true;
  }
  function collideHero(p,dt){
    p=p || playerRef();
    if(!p) return false;
    let hit=false;
    for(const e of entities) if(separateHeroFromEntity(e,p,Math.min(0.1,dt||0.016))) hit=true;
    return hit;
  }
  function update(dt,player,getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(!(dt>0) || !Number.isFinite(dt)) return;
    dt=Math.min(0.1,dt);
    player=player || playerRef();
    state.hintCd=Math.max(0,(state.hintCd||0)-dt);
    if(isDefeated() && !state.debugRematch){
      if(entities.length || hazards.length) clearActive();
      updateEffects(dt);
      return;
    }
    if(!isUnlocked()){
      updateEffects(dt);
      return;
    }
    const L = layoutFor();
    if(!state.materialized && player && Math.abs(player.x-L.ax)<132 && Math.abs(player.y-L.floorY)<96) materializeArena(getTile,setTile);
    if(state.awakened && player && !inNeighbourhood(player,L)){
      sleep();
      updateEffects(dt);
      return;
    }
    if(!state.awakened && !activeCore() && player && nearAwaken(player,L) && !isDefeated()){
      awaken({getTile,setTile});
    }
    // weakened matrix tick (boss_status.js): burn = half DoT, chill slows the
    // whole entity 20% by scaling its behaviour dt; freeze never lands here
    let coreDtMult=1;
    for(const e of entities){
      if(e.dead) continue;
      const elem=tickBossStatus(bossStatusFor(e),dt);
      // a burrowed core is under the rock: no DoT ticks (and no hint spam)
      if(elem.damage>0 && !(e.boss && !coreVulnerable(e))) hitEntity(e,elem.damage,{kind:'status',cause:'burn_dot'});
      e._statusDtMult=elem.speedMult;
      if(e.boss) coreDtMult=elem.speedMult;
    }
    const core = activeCore();
    if(core){
      updateCore(core,player,getTile,setTile,dt*coreDtMult,L);
      updateZombieGolemSpawner(core,player,dt,L,getTile);
    }
    for(const e of entities){
      if(e.dead || e.boss) continue;
      const edt=dt*(e._statusDtMult||1);
      if(e.role==='drone') updateDrone(e,player,getTile,setTile,edt,L);
      else if(e.role==='zombieGolem') updateZombieGolem(e,player,getTile,setTile,edt,L);
      else if(e.role==='friedGolem') updateFriedGolem(e,player,getTile,setTile,edt,L);
    }
    updateHazards(dt,player,getTile,setTile,L);
    collideHero(player,dt);
    for(let i=entities.length-1;i>=0;i--) if(entities[i].dead) entities.splice(i,1);
    updateEffects(dt);
  }
  function rgba(hex,a){
    if(typeof hex!=='string' || hex[0]!=='#' || hex.length<7) return 'rgba(255,255,255,'+clamp(a,0,1).toFixed(3)+')';
    const n=parseInt(hex.slice(1,7),16);
    return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+clamp(a,0,1).toFixed(3)+')';
  }
  function makeDrawView(camX,camY,W,H,TILE,zoom){
    if(!Number.isFinite(camX) || !Number.isFinite(camY) || !(W>0) || !(H>0) || !(TILE>0)) return null;
    const z=(Number.isFinite(zoom) && zoom>0) ? zoom : 1;
    const margin=18;
    return {x0:camX-margin,y0:camY-margin,x1:camX+W/(TILE*z)+margin,y1:camY+H/(TILE*z)+margin};
  }
  function inView(view,x,y,r){
    if(!view) return true;
    const m=r||0;
    return x+m>=view.x0 && x-m<=view.x1 && y+m>=view.y0 && y-m<=view.y1;
  }
  function tileVisible(canDrawTile,x,y,view,r){
    if(!inView(view,x,y,r)) return false;
    return typeof canDrawTile!=='function' || canDrawTile(Math.floor(x),Math.floor(y));
  }
  function drawArenaGlow(ctx,TILE,canDrawTile,view){
    if(!isUnlocked()) return;
    const L=layoutFor();
    if(!tileVisible(canDrawTile,L.ax,L.floorY-12,view,54)) return;
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    const pulse=0.75+Math.sin(now*2.1)*0.16;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const grad=ctx.createRadialGradient(L.ax*TILE,(L.floorY-12)*TILE,4,L.ax*TILE,(L.floorY-12)*TILE,44*TILE*pulse);
    grad.addColorStop(0,'rgba(196,107,255,0.22)');
    grad.addColorStop(0.45,'rgba(121,201,93,0.10)');
    grad.addColorStop(1,'rgba(196,107,255,0)');
    ctx.fillStyle=grad;
    ctx.fillRect((L.ax-52)*TILE,(L.floorY-40)*TILE,104*TILE,48*TILE);
    ctx.restore();
  }
  function drawDrill(ctx,TILE,len,rad,spin,accent){
    ctx.fillStyle='#2b2433';
    ctx.beginPath();
    ctx.moveTo(TILE*1.9,-rad*TILE);
    ctx.lineTo(TILE*(1.9+len),0);
    ctx.lineTo(TILE*1.9,rad*TILE);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle=rgba(accent||SPEC.accent2,0.88);
    ctx.lineWidth=Math.max(1,TILE*0.11);
    for(let i=0;i<5;i++){
      const px=TILE*(2.05+i*len/5);
      const off=Math.sin(spin+i)*rad*TILE*0.38;
      ctx.beginPath();
      ctx.moveTo(px,-rad*TILE+off);
      ctx.lineTo(px+TILE*0.46,rad*TILE-off);
      ctx.stroke();
    }
    ctx.fillStyle=rgba(accent||SPEC.accent2,0.80);
    ctx.beginPath(); ctx.arc(TILE*(1.9+len),0,Math.max(2,TILE*0.18),0,Math.PI*2); ctx.fill();
  }
  function drawTreads(ctx,TILE,t,scale){
    scale=scale||1;
    ctx.fillStyle='rgba(10,8,15,0.92)';
    ctx.fillRect(-TILE*2.6*scale,TILE*1.16*scale,TILE*4.7*scale,TILE*0.78*scale);
    ctx.fillStyle='rgba(92,82,106,0.95)';
    for(let i=0;i<8;i++){
      const x=(-2.45+i*0.62+((t*2)%0.62))*TILE*scale;
      if(x>TILE*2.25*scale) continue;
      ctx.fillRect(x,TILE*1.22*scale,TILE*0.30*scale,TILE*0.64*scale);
    }
  }
  function drawExcavatorBody(ctx,TILE,e,phase){
    const spin=e.t*(9+phase*1.6);
    drawTreads(ctx,TILE,e.t,1);
    ctx.fillStyle='rgba(16,13,24,0.85)';
    ctx.beginPath(); ctx.ellipse(-TILE*0.55,TILE*0.42,TILE*2.35,TILE*1.25,0,0,Math.PI*2); ctx.fill();
    const shell=ctx.createLinearGradient(-TILE*2.8,-TILE*1.8,TILE*2.8,TILE*1.8);
    shell.addColorStop(0,'#1d1528');
    shell.addColorStop(0.35,'#58466b');
    shell.addColorStop(0.68,'#7d5a92');
    shell.addColorStop(1,'#2c1d3c');
    ctx.fillStyle=shell;
    ctx.beginPath(); ctx.ellipse(-TILE*0.35,-TILE*0.15,TILE*2.75,TILE*1.82,-0.08,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=rgba(SPEC.accent,0.72);
    ctx.lineWidth=Math.max(1,TILE*0.10);
    ctx.stroke();
    ctx.fillStyle=rgba(SPEC.accent2,0.78);
    ctx.fillRect(-TILE*1.75,-TILE*1.10,TILE*1.25,TILE*0.25);
    ctx.fillRect(-TILE*1.75,-TILE*0.55,TILE*1.65,TILE*0.22);
    ctx.fillStyle='#24182f';
    ctx.beginPath(); ctx.ellipse(TILE*1.55,-TILE*0.22,TILE*1.25,TILE*1.15,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(220,255,225,0.78)';
    ctx.stroke();
    ctx.fillStyle=rgba(SPEC.accent2,0.95);
    ctx.beginPath(); ctx.arc(TILE*1.88,-TILE*0.50,TILE*0.22,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=rgba(SPEC.accent,0.82);
    ctx.beginPath(); ctx.arc(TILE*1.70,TILE*0.10,TILE*0.16,0,Math.PI*2); ctx.fill();
    drawDrill(ctx,TILE,2.75,0.68,spin,SPEC.accent2);
    for(const side of [-1,1]){
      ctx.strokeStyle=rgba(SPEC.accent2,0.74);
      ctx.lineWidth=Math.max(1,TILE*0.16);
      ctx.beginPath();
      ctx.moveTo(-TILE*0.5,side*TILE*0.45);
      ctx.quadraticCurveTo(TILE*1.1,side*TILE*1.4,TILE*2.45,side*TILE*1.75);
      ctx.stroke();
      ctx.fillStyle='#22172e';
      ctx.beginPath(); ctx.arc(TILE*2.55,side*TILE*1.78,TILE*0.26,0,Math.PI*2); ctx.fill();
    }
  }
  function drawCore(ctx,TILE,e,now){
    const x=e.x*TILE, y=e.y*TILE;
    const phase=phaseFor(e);
    if(e.mode==='burrow'){
      const tx=finite(e.targetX,e.x)*TILE, ty=finite(e.targetY,e.y)*TILE;
      const ang=Math.atan2(ty-y,tx-x);
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle=rgba(SPEC.accent2,0.34);
      ctx.lineWidth=Math.max(2,TILE*0.24);
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(tx,ty); ctx.stroke();
      const wake=ctx.createRadialGradient(x,y,2,x,y,TILE*(5.4+Math.sin(e.t*10)*0.5));
      wake.addColorStop(0,rgba(SPEC.accent2,0.30));
      wake.addColorStop(0.5,rgba(SPEC.accent,0.14));
      wake.addColorStop(1,rgba(SPEC.accent,0));
      ctx.fillStyle=wake;
      ctx.beginPath(); ctx.ellipse(x,y,TILE*5.6,TILE*2.1,ang,0,Math.PI*2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(ang);
      ctx.shadowColor=SPEC.accent2;
      ctx.shadowBlur=14;
      ctx.globalCompositeOperation='source-over';
      drawDrill(ctx,TILE,2.35,0.60,e.t*14,SPEC.accent2);
      ctx.fillStyle='rgba(42,31,55,0.86)';
      ctx.beginPath(); ctx.ellipse(-TILE*0.55,0,TILE*1.7,TILE*0.95,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=rgba(SPEC.accent,0.70); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const glow=ctx.createRadialGradient(x,y,2,x,y,TILE*(e.radius*3.2));
    glow.addColorStop(0,rgba(SPEC.accent,0.22));
    glow.addColorStop(1,rgba(SPEC.accent,0));
    ctx.fillStyle=glow;
    ctx.beginPath(); ctx.arc(x,y,TILE*(e.radius*3.2),0,Math.PI*2); ctx.fill();
    if(e.mode==='windup'){
      const tx=finite(e.targetX,e.x)*TILE, ty=finite(e.targetY,e.y)*TILE;
      ctx.strokeStyle=rgba(SPEC.accent2,0.72);
      ctx.lineWidth=Math.max(2,TILE*0.12);
      ctx.beginPath(); ctx.arc(tx,ty,TILE*(4.5+Math.sin(e.t*16)*0.5),0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(e.dir<0?-1:1,1);
    ctx.shadowColor=SPEC.accent;
    ctx.shadowBlur=10+phase*2;
    ctx.globalCompositeOperation='source-over';
    drawExcavatorBody(ctx,TILE,e,phase);
    if(e.hitFlash>0){
      ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')';
      ctx.beginPath(); ctx.arc(0,0,TILE*(e.radius+0.8),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawDrone(ctx,TILE,e){
    const x=e.x*TILE, y=e.y*TILE;
    const dir=e.dir<0?-1:1;
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(dir,1);
    ctx.shadowColor=e.droneRole==='cutter'?SPEC.accent:SPEC.accent2;
    ctx.shadowBlur=10;
    ctx.globalCompositeOperation='source-over';
    drawTreads(ctx,TILE,e.t,0.48);
    ctx.fillStyle=e.droneRole==='cutter' ? '#45305a' : '#2d3c30';
    ctx.beginPath(); ctx.ellipse(-TILE*0.35,-TILE*0.08,TILE*1.18,TILE*0.78,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=rgba(e.droneRole==='cutter'?SPEC.accent:SPEC.accent2,0.78);
    ctx.lineWidth=Math.max(1,TILE*0.08);
    ctx.stroke();
    if(e.droneRole==='cutter'){
      drawDrill(ctx,TILE,1.35,0.38,e.t*12,SPEC.accent);
      ctx.fillStyle=rgba(SPEC.accent2,0.92);
      ctx.beginPath(); ctx.arc(TILE*0.38,-TILE*0.28,TILE*0.13,0,Math.PI*2); ctx.fill();
    }else{
      ctx.fillStyle='rgba(121,201,93,0.82)';
      ctx.beginPath();
      ctx.moveTo(TILE*1.05,-TILE*0.52);
      ctx.lineTo(TILE*1.85,-TILE*0.18);
      ctx.lineTo(TILE*1.05,TILE*0.50);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle=rgba(SPEC.accent,0.78);
      ctx.fillRect(-TILE*1.35,-TILE*0.55,TILE*0.72,TILE*0.34);
    }
    if(e.hitFlash>0){
      ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')';
      ctx.beginPath(); ctx.arc(0,0,TILE*(e.radius+0.8),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawZombieGolem(ctx,TILE,e){
    const x=e.x*TILE, y=e.y*TILE;
    const dir=e.dir<0?-1:1;
    const fried=e.role==='friedGolem' || e.friendly;
    const pulse=0.55+Math.sin(e.t*8+e.seed*0.01)*0.18;
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(dir,1);
    ctx.shadowColor=fried?'#ffd08a':'#9fd267';
    ctx.shadowBlur=9+5*pulse;
    ctx.globalCompositeOperation='source-over';

    const footY=TILE*0.93;
    ctx.fillStyle='rgba(24,18,24,0.88)';
    ctx.fillRect(-TILE*0.95,footY,TILE*0.74,TILE*0.34);
    ctx.fillRect(TILE*0.22,footY,TILE*0.88,TILE*0.34);

    const body=ctx.createLinearGradient(-TILE*1.2,-TILE*1.9,TILE*1.15,TILE*0.95);
    body.addColorStop(0,fried?'#563016':'#293421');
    body.addColorStop(0.45,fried?'#b86b2c':'#73525c');
    body.addColorStop(1,fried?'#5a291c':'#34263a');
    ctx.fillStyle=body;
    ctx.strokeStyle='rgba(13,9,16,0.72)';
    ctx.lineWidth=Math.max(1,TILE*0.08);
    ctx.beginPath();
    ctx.moveTo(-TILE*1.10,TILE*0.62);
    ctx.lineTo(-TILE*0.82,-TILE*1.38);
    ctx.lineTo(TILE*0.28,-TILE*1.78);
    ctx.lineTo(TILE*1.04,-TILE*0.72);
    ctx.lineTo(TILE*0.88,TILE*0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle=fried?'rgba(255,194,103,0.82)':'rgba(105,142,67,0.82)';
    ctx.fillRect(-TILE*0.64,-TILE*1.02,TILE*0.42,TILE*0.22);
    ctx.fillRect(TILE*0.05,-TILE*0.48,TILE*0.54,TILE*0.18);
    ctx.fillStyle=fried?'rgba(255,227,168,0.62)':'rgba(196,107,255,0.52)';
    ctx.beginPath();
    ctx.arc(-TILE*0.16,-TILE*0.38,TILE*(0.20+pulse*0.04),0,Math.PI*2);
    ctx.fill();

    ctx.fillStyle=fried?'#b86b2c':'#5d6f34';
    ctx.beginPath();
    ctx.ellipse(TILE*0.38,-TILE*2.04,TILE*0.58,TILE*0.42,-0.08,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle='rgba(20,14,20,0.70)';
    ctx.stroke();
    ctx.fillStyle=fried?'#ffe3a8':'#d7ff9b';
    ctx.fillRect(TILE*0.20,-TILE*2.10,TILE*0.12,TILE*0.09);
    ctx.fillRect(TILE*0.52,-TILE*2.07,TILE*0.12,TILE*0.09);
    ctx.fillStyle='rgba(17,13,18,0.86)';
    ctx.fillRect(TILE*0.24,-TILE*2.08,TILE*0.04,TILE*0.06);
    ctx.fillRect(TILE*0.56,-TILE*2.05,TILE*0.04,TILE*0.06);

    ctx.strokeStyle=fried?'rgba(190,100,42,0.94)':'rgba(88,116,58,0.94)';
    ctx.lineWidth=Math.max(2,TILE*0.17);
    for(const side of [-1,1]){
      ctx.beginPath();
      ctx.moveTo(-TILE*0.48, -TILE*0.82+side*TILE*0.05);
      ctx.quadraticCurveTo(-TILE*1.34, -TILE*0.15+side*TILE*0.18, -TILE*1.52, TILE*0.78+side*TILE*0.10);
      ctx.stroke();
    }
    ctx.fillStyle='rgba(204,214,149,0.82)';
    ctx.beginPath();
    ctx.arc(-TILE*1.52,TILE*0.78,TILE*0.18,0,Math.PI*2);
    ctx.fill();

    if(e.spawnT>0){
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.globalAlpha=clamp(e.spawnT/0.55,0,1);
      ctx.strokeStyle=rgba(SPEC.accent2,0.80);
      ctx.lineWidth=Math.max(1,TILE*0.10);
      ctx.beginPath();
      ctx.arc(0,-TILE*0.58,TILE*(1.6-e.spawnT),0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
    if(e.hitFlash>0){
      ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')';
      ctx.beginPath(); ctx.arc(0,-TILE*0.6,TILE*(e.radius+0.8),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawHealth(ctx,TILE,e){
    if(e.boss && !coreVulnerable(e)) return;
    if(!e.boss && e.hp/e.maxHp>0.98) return;
    const w=(e.boss?12:5)*TILE;
    const h=e.boss?5:3;
    const x=e.x*TILE-w/2, y=(e.y-e.radius-1.45)*TILE;
    ctx.fillStyle='rgba(0,0,0,0.58)';
    ctx.fillRect(x,y,w,h);
    ctx.fillStyle=e.boss && e.mode==='windup' ? SPEC.accent2 : SPEC.accent;
    ctx.fillRect(x,y,w*clamp(e.hp/e.maxHp,0,1),h);
    if(e.boss && e.mode==='windup'){ ctx.strokeStyle=rgba(SPEC.accent2,0.82); ctx.strokeRect(x-2,y-2,w+4,h+4); }
  }
  function drawHazards(ctx,TILE,canDrawTile,view){
    for(const h of hazards){
      if(!tileVisible(canDrawTile,h.x,h.y,view,h.r||8)) continue;
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      if(h.type==='shard'){
        ctx.shadowColor=SPEC.accent; ctx.shadowBlur=12;
        ctx.fillStyle=rgba(SPEC.accent,0.82);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(3,(h.r||0.35)*TILE),0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=rgba(SPEC.accent2,0.46);
        ctx.beginPath(); ctx.moveTo((h.x-h.vx*0.045)*TILE,(h.y-h.vy*0.045)*TILE); ctx.lineTo(h.x*TILE,h.y*TILE); ctx.stroke();
      }else if(h.type==='pillar'){
        const armed=h.t>=h.delay;
        const f=armed ? clamp((h.t-h.delay)/h.life,0,1) : clamp(h.t/h.delay,0,1);
        ctx.strokeStyle=rgba(armed?SPEC.accent2:SPEC.accent,armed?0.75:0.42);
        ctx.lineWidth=Math.max(2,TILE*(armed?0.28:0.10));
        ctx.beginPath(); ctx.moveTo(h.x*TILE,(h.y-12)*TILE); ctx.lineTo(h.x*TILE,(h.y+1)*TILE); ctx.stroke();
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,TILE*(h.r*(0.55+f*0.55)),0,Math.PI*2); ctx.stroke();
      }else if(h.type==='pulse'){
        const f=h.t<h.delay ? clamp(h.t/h.delay,0,1)*0.15 : clamp((h.t-h.delay)/h.life,0,1);
        const r=h.t<h.delay ? h.r0*f : lerp(h.r0,h.r1,f);
        ctx.strokeStyle=rgba(SPEC.accent,0.78*(1-f*0.45));
        ctx.lineWidth=Math.max(2,TILE*0.15);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,r*TILE,0,Math.PI*2); ctx.stroke();
      }else if(h.type==='fallrock'){
        ctx.shadowColor=SPEC.accent2; ctx.shadowBlur=10;
        ctx.fillStyle=rgba(SPEC.accent2,0.72);
        ctx.fillRect((h.x-h.r)*TILE,(h.y-h.r)*TILE,h.r*2*TILE,h.r*2*TILE);
        ctx.strokeStyle=rgba(SPEC.accent,0.55); ctx.strokeRect((h.x-h.r)*TILE,(h.y-h.r)*TILE,h.r*2*TILE,h.r*2*TILE);
      }else if(h.type==='burrowBomb'){
        const armed=h.t>=h.delay;
        const blink=0.55+Math.sin(h.t*18)*0.35;
        ctx.shadowColor=armed?'#ffcf7a':SPEC.accent;
        ctx.shadowBlur=armed?22:12;
        ctx.fillStyle='rgba(28,18,20,0.94)';
        ctx.beginPath(); ctx.ellipse(h.x*TILE,h.y*TILE,TILE*0.76,TILE*0.52,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=rgba(armed?'#ffb347':SPEC.accent2,0.75+blink*0.20);
        ctx.beginPath(); ctx.arc((h.x+0.18)*TILE,(h.y-0.08)*TILE,TILE*0.18,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=rgba(armed?'#ffcf7a':SPEC.accent,0.42+blink*0.28);
        ctx.lineWidth=Math.max(1,TILE*0.08);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,TILE*(h.r*(armed?0.72:0.32)),0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawEffects(ctx,TILE,canDrawTile,view){
    for(const e of effects){
      if(!tileVisible(canDrawTile,e.x,e.y,view,e.r||8)) continue;
      const f=clamp(e.t/e.max,0,1);
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      if(e.type==='pillar'){
        ctx.strokeStyle=rgba(SPEC.accent2,0.62*(1-f));
        ctx.lineWidth=Math.max(2,TILE*(0.38*(1-f)));
        ctx.beginPath(); ctx.moveTo(e.x*TILE,(e.y-12)*TILE); ctx.lineTo(e.x*TILE,(e.y+1)*TILE); ctx.stroke();
      }else if(e.type==='bomb'){
        const r=(e.r||5)*TILE*(0.22+f*1.08);
        ctx.strokeStyle='rgba(255,188,91,'+(0.86*(1-f)).toFixed(3)+')';
        ctx.lineWidth=Math.max(2,TILE*0.18);
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,r,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle='rgba(255,93,41,'+(0.20*(1-f)).toFixed(3)+')';
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,r*0.58,0,Math.PI*2); ctx.fill();
      }else{
        const r=(e.r||5)*TILE*(0.35+f*0.9);
        const grad=ctx.createRadialGradient(e.x*TILE,e.y*TILE,2,e.x*TILE,e.y*TILE,r);
        grad.addColorStop(0,rgba(e.type==='sparks'?SPEC.accent2:SPEC.accent,0.34*(1-f)));
        grad.addColorStop(1,rgba(SPEC.accent,0));
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,r,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=rgba(SPEC.accent2,0.65*(1-f));
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,r*0.72,0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function draw(ctx,TILE,canDrawTile,camX,camY,W,H,zoom){
    const view=makeDrawView(camX,camY,W,H,TILE,zoom);
    drawArenaGlow(ctx,TILE,canDrawTile,view);
    if(!entities.length && !hazards.length && !effects.length) return;
    drawHazards(ctx,TILE,canDrawTile,view);
    const now=(typeof performance!=='undefined') ? performance.now() : 0;
    for(const e of entities){
      if(!tileVisible(canDrawTile,e.x,e.y,view,(e.radius||1)+5)) continue;
      if(e.boss) drawCore(ctx,TILE,e,now);
      else if(e.role==='zombieGolem' || e.role==='friedGolem') drawZombieGolem(ctx,TILE,e);
      else drawDrone(ctx,TILE,e);
      drawHealth(ctx,TILE,e);
    }
    drawEffects(ctx,TILE,canDrawTile,view);
  }
  function drawHUD(ctx,W,H,camX,camY,zoom,TILE,canDrawTile){
    const core=activeCore();
    if(!core || !tileVisible(canDrawTile,core.x,core.y,null)) return;
    const sx=(core.x-camX)*TILE*zoom, sy=(core.y-camY)*TILE*zoom;
    if(sx>36 && sx<W-36 && sy>36 && sy<H-36) return;
    const ang=Math.atan2(sy-H/2,sx-W/2);
    const ex=W/2+Math.cos(ang)*(Math.min(W,H)/2-44);
    const ey=H/2+Math.sin(ang)*(Math.min(W,H)/2-44);
    ctx.save();
    ctx.translate(ex,ey);
    ctx.rotate(ang);
    ctx.fillStyle=rgba(SPEC.accent,0.92);
    ctx.beginPath();
    ctx.moveTo(15,0);
    ctx.lineTo(-8,-8);
    ctx.lineTo(-8,8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function targetsForTurret(sx,sy,range,onlyBoss){
    const out=[];
    const r2=(Number(range)||0)*(Number(range)||0);
    for(const e of entities){
      if(e.dead) continue;
      if(e.friendly) continue;
      if(e.boss && !coreVulnerable(e)) continue;
      if(onlyBoss && onlyBoss!==true && onlyBoss!==e) continue;
      if(onlyBoss===true && !e.boss) continue;
      const d2=dist2(sx,sy,e.x,e.y);
      if(d2>r2) continue;
      out.push({kind:'underground',underground:e,raw:e,x:e.x,y:e.y,tx:Math.floor(e.x),ty:Math.floor(e.y),hp:e.hp,d2});
    }
    out.sort((a,b)=>a.d2-b.d2);
    return out;
  }
  function nearestForTurret(sx,sy,range,onlyBoss){
    const t=targetsForTurret(sx,sy,range,onlyBoss);
    return t.length?t[0]:null;
  }
  function landingSpot(getTile){
    const L=layoutFor();
    const offsets=[0,-4,4,-8,8,-12,12,-18,18,-26,26,-34,34,-42,42];
    for(const off of offsets){
      const tx=Math.round(L.ax+off);
      const floorYs=[L.floorY,L.floorY-1,L.floorY+1,L.floorY-2,L.floorY+2];
      for(const fy of floorYs){
        if(fy<3 || fy>=WORLD_BOTTOM-2) continue;
        try{
          const floor=getTile ? getTile(tx,fy) : T.BASALT;
          const body=getTile ? getTile(tx,fy-1) : T.AIR;
          const head=getTile ? getTile(tx,fy-2) : T.AIR;
          if(isSolid(floor) && !isSolid(body) && !isSolid(head)) return {x:tx+0.5,y:fy-1,tileX:tx,surface:fy,layout:L};
        }catch(e){}
      }
    }
    return {x:L.ax+0.5,y:L.floorY-3,tileX:Math.round(L.ax),surface:L.floorY,fallback:true,layout:L};
  }
  function cleanEntity(e){
    return {
      id:String(e.id||'').slice(0,48),
      role:e.role,
      friendly:!!e.friendly,
      x:+finite(e.x,0).toFixed(2),
      y:+finite(e.y,0).toFixed(2),
      vx:+finite(e.vx,0).toFixed(2),
      vy:+finite(e.vy,0).toFixed(2),
      hp:+clamp(Number(e.hp)||0,0,5000).toFixed(1),
      maxHp:+clamp(Number(e.maxHp)||1,1,5000).toFixed(1),
      dir:e.dir<0?-1:1,
      side:e.side<0?-1:1,
      mode:e.mode||null,
      modeT:+finite(e.modeT,0).toFixed(2),
      vulnerable:e.vulnerable!==false,
      targetX:+finite(e.targetX,e.x).toFixed(2),
      targetY:+finite(e.targetY,e.y).toFixed(2),
      burrowT:+finite(e.burrowT,0).toFixed(2),
      droneRole:e.droneRole||null,
      t:+finite(e.t,0).toFixed(2),
      shotCd:+finite(e.shotCd,1).toFixed(2),
      carveCd:+finite(e.carveCd,0.4).toFixed(2),
      sealCd:+finite(e.sealCd,1).toFixed(2),
      shardCd:+finite(e.shardCd,1).toFixed(2),
      pillarCd:+finite(e.pillarCd,2).toFixed(2),
      pulseCd:+finite(e.pulseCd,4).toFixed(2),
      caveCd:+finite(e.caveCd,3).toFixed(2),
      bombCd:+finite(e.bombCd,1).toFixed(2),
      zombieCd:+finite(e.zombieCd,CFG.ZOMBIE_GOLEM_SPAWN_SECONDS).toFixed(2),
      zombieAwakened:!!e.zombieAwakened,
      gasFearT:+finite(e.gasFearT,0).toFixed(2),
      gasFearX:e.gasFearX==null ? null : +finite(e.gasFearX,e.x).toFixed(2),
      gasFearY:e.gasFearY==null ? null : +finite(e.gasFearY,e.y).toFixed(2),
      attackCd:+finite(e.attackCd,0).toFixed(2),
      jumpCd:+finite(e.jumpCd,0).toFixed(2),
      spawnT:+finite(e.spawnT,0).toFixed(2),
      seed:Math.max(0,Number(e.seed)||0)
    };
  }
  function cleanMode(mode){
    return mode==='burrow' || mode==='windup' || mode==='emerge' ? mode : 'emerge';
  }
  function cleanDroneRole(role,index){
    if(role==='cutter' || role==='backfill') return role;
    return index===1 ? 'backfill' : 'cutter';
  }
  function restoreEntity(src){
    if(!src || typeof src!=='object') return null;
    const L=layoutFor();
    if(src.role==='core'){
      const e=makeCore(L);
      const mode=cleanMode(src.mode);
      const target=clampBurrowPoint(src.targetX,src.targetY);
      e.id=String(src.id||e.id).slice(0,48);
      e.x=clampTunnelX(src.x,8);
      e.y=clampTunnelY(src.y,6,4.2);
      e.vx=clamp(finite(src.vx,0),-8,8);
      e.vy=clamp(finite(src.vy,0),-10,12);
      e.dir=src.dir<0?-1:1;
      e.maxHp=CFG.BOSS_HP;
      e.hp=clamp(Number(src.hp)||e.maxHp,0,e.maxHp);
      e.mode=mode;
      e.vulnerable=mode!=='burrow';
      e.modeT=clamp(finite(src.modeT,mode==='burrow'?1.0:2.0),0,8);
      e.targetX=target.x;
      e.targetY=target.y;
      e.burrowT=clamp(finite(src.burrowT,0),0,20);
      e.t=clamp(finite(src.t,0),0,3600);
      e.shotCd=clamp(finite(src.shotCd,e.shotCd),0,8);
      e.carveCd=clamp(finite(src.carveCd,e.carveCd),0,4);
      e.sealCd=clamp(finite(src.sealCd,e.sealCd),0,8);
      e.shardCd=clamp(finite(src.shardCd,e.shardCd),0,8);
      e.pillarCd=clamp(finite(src.pillarCd,e.pillarCd),0,10);
      e.pulseCd=clamp(finite(src.pulseCd,e.pulseCd),0,12);
      e.caveCd=clamp(finite(src.caveCd,e.caveCd),0,10);
      e.bombCd=clamp(finite(src.bombCd,e.bombCd),0,8);
      e.zombieCd=clamp(finite(src.zombieCd,e.zombieCd),0,CFG.ZOMBIE_GOLEM_SPAWN_SECONDS);
      e.zombieAwakened=!!src.zombieAwakened;
      e.gasFearT=clamp(finite(src.gasFearT,src.fireFearT||0),0,CFG.GAS_FEAR_SECONDS);
      e.gasFearX=Number.isFinite(Number(src.gasFearX)) ? finite(src.gasFearX,e.x) : (Number.isFinite(Number(src.fireFearX)) ? finite(src.fireFearX,e.x) : null);
      e.gasFearY=Number.isFinite(Number(src.gasFearY)) ? finite(src.gasFearY,e.y) : (Number.isFinite(Number(src.fireFearY)) ? finite(src.fireFearY,e.y) : null);
      return e;
    }
    if(src.role==='drone' || src.role==='anchor'){
      const index=(String(src.id||'').indexOf('drone-1')>=0 || String(src.id||'').indexOf('anchor-1')>=0)?1:0;
      const spawn=(L.droneSpawns||L.anchorSpawns||[])[index] || (L.droneSpawns||L.anchorSpawns||[])[0];
      const e=makeDrone(spawn,index);
      const droneRole=cleanDroneRole(src.droneRole,index);
      e.id=String(src.id||e.id).slice(0,48);
      e.droneRole=droneRole;
      e.name=droneRole==='cutter'?'Cutter Drill Drone':'Backfill Drill Drone';
      e.x=clampArenaX(src.x,8);
      e.y=clampArenaY(src.y,6,3);
      e.vx=clamp(finite(src.vx,0),-8,8);
      e.vy=clamp(finite(src.vy,0),-10,12);
      e.side=src.side<0?-1:(index===0?-1:1);
      e.dir=src.dir<0?-1:1;
      e.maxHp=CFG.DRONE_HP;
      e.hp=clamp(Number(src.hp)||e.maxHp,0,e.maxHp);
      e.t=clamp(finite(src.t,0),0,3600);
      e.shotCd=clamp(finite(src.shotCd,e.shotCd),0,8);
      e.carveCd=clamp(finite(src.carveCd,e.carveCd),0,4);
      e.sealCd=clamp(finite(src.sealCd,e.sealCd),0,8);
      e.bombCd=clamp(finite(src.bombCd,e.bombCd),0,8);
      return e;
    }
    if(src.role==='zombieGolem' || src.role==='zombie_golem' || src.role==='friedGolem'){
      const e=makeZombieGolem({
        x:clampArenaX(src.x,7),
        y:clampArenaY(src.y,5,2.2),
        side:src.side<0?-1:1
      }, 0);
      e.id=String(src.id||e.id).slice(0,48);
      e.name=String(src.name||e.name).slice(0,48);
      if(src.role==='friedGolem' || src.friendly){
        e.role='friedGolem';
        e.name=e.name || 'Fried Tunnel Golem';
        e.zombie=false;
        e.friendly=true;
      }
      e.seed=Math.max(1,Number(src.seed)||e.seed);
      e.x=clampArenaX(src.x,7);
      e.y=clampArenaY(src.y,5,2.2);
      e.vx=clamp(finite(src.vx,0),-8,8);
      e.vy=clamp(finite(src.vy,0),-10,12);
      e.side=src.side<0?-1:1;
      e.dir=src.dir<0?-1:1;
      e.maxHp=CFG.ZOMBIE_GOLEM_HP;
      e.hp=clamp(Number(src.hp)||e.maxHp,0,e.maxHp);
      e.t=clamp(finite(src.t,0),0,3600);
      e.attackCd=clamp(finite(src.attackCd,e.attackCd),0,4);
      e.jumpCd=clamp(finite(src.jumpCd,e.jumpCd),0,4);
      e.spawnT=clamp(finite(src.spawnT,0),0,1);
      return e;
    }
    return null;
  }
  function snapshot(){
    return {
      v:1,
      unlocked:!!state.unlocked,
      defeated:!!state.defeated,
      awakened:!!state.awakened,
      heartAwarded:!!state.heartAwarded,
      materialized:!!state.materialized,
      seq:Math.max(1,state.seq|0),
      tunnelsCarved:Math.max(0,Number(state.tunnelsCarved)||0),
      entities:entities.filter(e=>e && !e.dead).slice(0,8).map(cleanEntity),
      lastCrater:state.lastCrater ? {x:+finite(state.lastCrater.x,0).toFixed(1), y:+finite(state.lastCrater.y,0).toFixed(1), meteorite:!!state.lastCrater.meteorite} : null
    };
  }
  function reset(){
    clearActive();
    state.unlocked=false;
    state.defeated=false;
    state.heartAwarded=false;
    state.materialized=false;
    state.seq=1;
    state.hintCd=0;
    state.lastCrater=null;
    state.tunnelsCarved=0;
    state.lastWorldChangeMark=-Infinity;
    cache.clear();
  }
  function restore(d){
    clearActive();
    if(!d || typeof d!=='object'){
      state.unlocked=false;
      state.defeated=false;
      state.heartAwarded=false;
      state.materialized=false;
      state.lastWorldChangeMark=-Infinity;
      return false;
    }
    state.unlocked=!!d.unlocked;
    state.defeated=!!d.defeated;
    state.heartAwarded=!!d.heartAwarded;
    state.materialized=!!d.materialized;
    state.seq=Math.max(1,Number(d.seq)|0);
    state.tunnelsCarved=Math.max(0,Number(d.tunnelsCarved)||0);
    state.lastWorldChangeMark=-Infinity;
    state.lastCrater=d.lastCrater && Number.isFinite(Number(d.lastCrater.x)) && Number.isFinite(Number(d.lastCrater.y))
      ? {x:+finite(d.lastCrater.x,0).toFixed(1), y:+finite(d.lastCrater.y,0).toFixed(1), meteorite:!!d.lastCrater.meteorite}
      : null;
    if(isUnlocked()) state.unlocked=true;
    if(isDefeated()){
      clearActive();
      return true;
    }
    if(d.awakened && Array.isArray(d.entities)){
      entities=d.entities.map(restoreEntity).filter(Boolean);
      state.awakened=entities.some(e=>e.boss);
    }
    return true;
  }
  function markDefeated(){
    state.defeated=true;
    state.awakened=false;
    clearActive();
    return true;
  }
  function forceAwaken(getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    state.unlocked=true;
    return awaken({debug:true,force:true,getTile:lastGetTile,setTile:lastSetTile});
  }
  function status(){
    const L=layoutFor();
    return {
      unlocked:isUnlocked(),
      defeated:isDefeated(),
      awakened:!!state.awakened,
      lair:{x:L.ax,y:L.floorY,gateX:L.gateX,gateY:L.gateY,minX:L.minX,maxX:L.maxX,minY:L.minY,maxY:L.maxY,tunnelMinX:L.tunnelMinX,tunnelMaxX:L.tunnelMaxX,tunnelMinY:L.tunnelMinY},
      entities:entities.map(e=>({id:e.id,role:e.role,droneRole:e.droneRole||null,name:e.name,hp:e.hp,maxHp:e.maxHp,x:e.x,y:e.y,boss:!!e.boss,zombie:!!e.zombie,friendly:!!e.friendly,mode:e.mode||null,vulnerable:e.boss?coreVulnerable(e):true})),
      hazards:hazards.length,
      bombs:hazards.filter(h=>h.type==='burrowBomb').length,
      zombieGolems:activeZombieGolemCount(),
      friedGolems:activeFriedGolems().length,
      mode:activeCore() ? activeCore().mode : null,
      gasFear:activeCore() ? +(activeCore().gasFearT||0).toFixed(2) : 0,
      tunnelsCarved:state.tunnelsCarved||0,
      materialized:!!state.materialized
    };
  }
  function metrics(){
    const core=activeCore();
    return {
      alive:entities.length,
      bosses:core?1:0,
      drones:activeDrones().length,
      zombieGolems:activeZombieGolemCount(),
      friedGolems:activeFriedGolems().length,
      hazards:hazards.length,
      bombs:hazards.filter(h=>h.type==='burrowBomb').length,
      effects:effects.length,
      unlocked:isUnlocked(),
      defeated:isDefeated(),
      mode:core ? core.mode : null,
      vulnerable:core ? coreVulnerable(core) : false,
      gasFear:core ? +(core.gasFearT||0).toFixed(2) : 0,
      tunnelsCarved:state.tunnelsCarved||0,
      hp:core ? +core.hp.toFixed(1) : 0,
      materialized:!!state.materialized
    };
  }
  function _debug(){
    return {
      state, entities, hazards, effects, layoutFor, materializeArena, awardHeart, deathBlast, tileKey,
      forceBurrow:(x,y)=>{
        const core=activeCore();
        if(!core) return false;
        const L=layoutFor();
        const target=clampBurrowPoint(Number.isFinite(x)?x:core.x+18,Number.isFinite(y)?y:core.y-4,L);
        core.targetX=target.x;
        core.targetY=target.y;
        startBurrow(core,lastGetTile,lastSetTile,L);
        return true;
      },
      forceEmerge:()=>{
        const core=activeCore();
        if(!core) return false;
        finishBurrow(core);
        return true;
      },
      forceZombieWave:()=>{
        const core=activeCore();
        if(!core) return 0;
        core.hp=Math.min(core.hp,core.maxHp*(CFG.ZOMBIE_GOLEM_HEALTH_RATIO-0.01));
        core.zombieAwakened=true;
        core.zombieCd=0;
        return spawnZombieGolemWave(core,playerRef(),layoutFor(),lastGetTile);
      }
    };
  }

  const api = {
    config:CFG,
    spec:SPEC,
    layoutFor,
    landingSpot,
    applyToChunk,
    applyToSection,
    materializeArena,
    update,
    draw,
    drawHUD,
    attackAt,
    damageAt,
    heatAt,
    collideHero,
    targetsForTurret,
    nearestForTurret,
    forceAwaken,
    markDefeated,
    clearActive,
    reset,
    snapshot,
    restore,
    status,
    metrics,
    clearCache:()=>cache.clear(),
    _debug
  };
  MM.undergroundBoss=api;
  MM.earthBoss=api;
  // weakened-matrix registry adapter (shared boss_status helper)
  try{
    if(MM.bossStatus && MM.bossStatus.registerSystem){
      MM.bossStatus.registerSystem('undergroundBoss',{
        applyRadius(wx,wy,r,kind,opts){
          let n=0;
          for(const e of entities){
            if(!e || e.dead || e.friendly) continue;
            if(e.boss && !coreVulnerable(e)) continue; // burrowed: splashes glance off the rock
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

export { undergroundBoss };
export default undergroundBoss;
