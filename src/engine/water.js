// Dynamic water system: cellular fluid simulation + spring-based surface waves + layered FX.
//
// Simulation (tile level, deterministic, volume conserving):
//   gravity drops, edge spills, lateral downhill seeking, hydrostatic pressure leveling.
// Presentation (strictly cosmetic — never mutates tiles):
//   * one damped oscillator ("surface spring") per water column; neighbor coupling makes
//     disturbances travel outward as waves (player dives, falling blocks, waterfalls, flow)
//   * smooth continuous surface mesh (per-column quads sharing edge heights)
//   * depth-graded translucent body, animated caustic web, drifting light shafts,
//     surface sheen + sparkle glints, shoreline foam
//   * waterfall streams with bright cores, falling streaks and impact mist
//   * ambient bubbles in deep water (rendered by the shared particle module)
// Everything draws to a transform-aware offscreen layer; effects are clipped to the
// water shape with 'source-atop' compositing, then the layer blends onto the scene in
// one drawImage.
import { isFoliageTile, isGasTile, isSunTransparentTile, isWaterFillTile, isWaterOpenTile } from './material_physics.js';

window.MM = window.MM || {};
(function(){
  const {T, WORLD_H} = MM;
  const WORLD_TOP = Number.isFinite(MM.WORLD_MIN_Y) ? MM.WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(MM.WORLD_MAX_Y) ? MM.WORLD_MAX_Y : WORLD_H;

  // ---------------- Simulation state ----------------
  const active = new Set(); // 'x,y'
  // Cells that settled laterally but may still need pressure leveling (consumed per pass)
  const pressureSeeds = new Set();
  let passiveScanOffset = 0;
  const PASSIVE_SCAN_RADIUS = 240;
  const PASSIVE_SCAN_SPAN = PASSIVE_SCAN_RADIUS*2+1;
  const PASSIVE_SCAN_INTERVAL = 0.10;
  const PASSIVE_SCAN_BURST_LIMIT = 3;
  const PASSIVE_SCAN_COLS_IDLE = 64;
  const PASSIVE_SCAN_COLS_ACTIVE = 24;
  let passiveScanAcc = 0;
  let passiveScanLastColumns = 0;
  let passiveScanTotalColumns = 0;
  // Boundaries of freshly generated chunks awaiting a water wake (drained in update)
  const chunkWakes = [];
  // Lateral energy cooldown after pressure smoothing
  const lateralCooldown = new Map(); // x -> seconds remaining
  const LATERAL_INTERVAL = 0.075;
  const TILE_CHANGE_BATCH_WAKE_CAP = 24;
  let lateralAcc = 0;
  // Adaptive pressure leveling cadence
  const PRESSURE_INTERVAL_MIN = 0.18;
  const PRESSURE_INTERVAL_BASE = 0.40;
  const PRESSURE_INTERVAL_MAX = 0.90;
  let pressureIntervalCurrent = PRESSURE_INTERVAL_BASE;
  let pressureAcc = 0;
  let pressureLastMs = 0;
  let pressureMaxMs = 0;
  // Vertical scan bound (displacement search)
  const MAX_VERTICAL_SCAN = 48;
  const WATER_REACTION_BUDGET_BASE = 48;
  let reactionBudget = 0;
  // Ambient material reactions:
  //   water + sand -> mud consumes one water cell after a short, varied soak;
  //   water + clay -> wet clay; sunlit mud/wet clay dries and releases steam.
  const MATERIAL_SCAN_INTERVAL = 0.22;
  const MATERIAL_SCAN_RADIUS = 220;
  const MATERIAL_SCAN_SPAN = MATERIAL_SCAN_RADIUS*2+1;
  const MATERIAL_SCAN_COLS_IDLE = 36;
  const MATERIAL_SCAN_COLS_ACTIVE = 16;
  const MATERIAL_QUEUE_CAP = 2400;
  const MATERIAL_PROCESS_CAP = 56;
  const WET_SAND_SECONDS = 2.2;
  const CLAY_HYDRATE_SECONDS = 1.8;
  const MUD_DRY_SECONDS = 5.5;
  const WET_CLAY_DRY_SECONDS = 45;
  const WET_CLAY_DRY_PROGRESS_CAP = WET_CLAY_DRY_SECONDS*1.5;
  const SUN_DRY_MIN = 0.18;
  const wetSand = new Map(); // "x,y" -> {x,y,wet}
  const wetClay = new Map(); // "x,y" -> {x,y,wet}
  const dryMud = new Map();  // "x,y" -> {x,y,dry}
  const dryClay = new Map(); // "x,y" -> {x,y,dry}
  let materialScanAcc = 0;
  let materialScanOffset = 0;

  // ---------------- FX state ----------------
  const springs = new Map();        // x -> {o:px offset, v:px/s, y:surface tile row, seen:frame}
  const pendingImpulse = new Map(); // x -> accumulated velocity kick, applied when column renders
  const streams = [];               // waterfalls {x, y0, y1, ttl}
  const STREAM_TTL = 0.5;
  const SPR_K = 50;                 // spring stiffness toward rest level (1/s^2)
  const SPR_D = 3.6;                // damping (1/s)
  const SPR_SPREAD = 30;            // neighbor coupling (1/s^2 per px of height difference)
  let frameNo = 0;
  let lastOverlayTime = performance.now();
  let offCanvas = null, offCtx = null;
  const OVERLAY_CACHE_INTERVAL_MS = 1000/120;
  const OVERLAY_PIXEL_SCALE_MAX = 2.5;
  const OVERLAY_PIXEL_BUDGET = 10000000;
  let lastOverlayRefresh = 0;
  let overlayCache = {valid:false};
  let overlayCacheHits = 0;
  let overlayFullRenders = 0;

  function k(x,y){ return x+","+y; }
  function mark(x,y){ active.add(k(x,y)); }
  function isGas(t){ return isGasTile(t); }
  function isLeaf(t){ return isFoliageTile(t); }
  function isAir(t){ return isWaterOpenTile(t); }
  function canFill(t){ return isWaterFillTile(t); }
  function overlayPixelScale(ctx,wpx,hpx){
    let scale=1;
    try{
      if(ctx && typeof ctx.getTransform==='function'){
        const m=ctx.getTransform();
        const sx=Math.hypot(Number(m.a)||0, Number(m.b)||0);
        const sy=Math.hypot(Number(m.c)||0, Number(m.d)||0);
        scale=Math.max(sx,sy);
      }
    }catch(e){ scale=1; }
    if(!Number.isFinite(scale) || scale<=1.05) return 1;
    const area=Math.max(1,wpx*hpx);
    const areaCap=Math.sqrt(OVERLAY_PIXEL_BUDGET/area);
    scale=Math.min(OVERLAY_PIXEL_SCALE_MAX, areaCap, scale);
    if(scale<=1.05) return 1;
    return Math.max(1, Math.ceil(scale*2)/2);
  }
  function currentFrameMs(){
    return (typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
  }
  function overlayReuseWindowMs(){
    const ms=currentFrameMs();
    if(ms>40) return 1000/24;
    if(ms>26) return 1000/40;
    try{
      const cap=window.__mmFrameCap;
      if(cap && !cap.unlocked && Number.isFinite(cap.effectiveFps) && cap.effectiveFps>0){
        return Math.max(OVERLAY_CACHE_INTERVAL_MS, 1000/Math.min(120,Math.max(30,cap.effectiveFps)));
      }
    }catch(e){}
    return OVERLAY_CACHE_INTERVAL_MS;
  }
  function invalidateOverlayCache(){
    overlayCache.valid=false;
    lastOverlayRefresh=0;
  }
  function validTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function activeScanRange(){
    const p=(typeof window!=='undefined' && window.player);
    const py=(p && Number.isFinite(p.y)) ? p.y : 70;
    if(py<0) return {top:WORLD_TOP+1, bottom:Math.min(WORLD_BOTTOM-1,Math.max(1,WORLD_H-1))};
    if(py>=WORLD_H) return {top:Math.max(WORLD_TOP+1,WORLD_H), bottom:WORLD_BOTTOM-1};
    return {top:Math.max(WORLD_TOP+1,1), bottom:Math.min(WORLD_BOTTOM-1,WORLD_H-1)};
  }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function validDynamoSlot(x,y,getTile,orientation){
    try{ return !!(MM.dynamo && MM.dynamo.isValidSlot && MM.dynamo.isValidSlot(x,y,getTile,orientation)); }catch(e){ return false; }
  }
  function canDropThroughDynamo(x,y,getTile){
    return y+2<WORLD_BOTTOM && validDynamoSlot(x,y+1,getTile,'horizontal') && canFill(getTile(x,y+2));
  }
  function sideDynamoFlowTarget(x,y,dx,getTile){
    if(getTile(x,y-1)!==T.WATER) return null;
    const slotX=x+dx, outX=x+dx*2;
    if(!validDynamoSlot(slotX,y,getTile,'vertical')) return null;
    if(!canFill(getTile(outX,y))) return null;
    return {slotX,slotY:y,outX,outY:y};
  }
  function canSideFlowThroughDynamo(x,y,getTile){
    return !!(sideDynamoFlowTarget(x,y,-1,getTile) || sideDynamoFlowTarget(x,y,1,getTile));
  }
  function waterDepthFrom(x,y,getTile,maxDepth){
    let d=0;
    const lim=Math.max(1, maxDepth||32);
    while(y+d<WORLD_BOTTOM && d<lim && getTile(x,y+d)===T.WATER) d++;
    return d;
  }
  function surfaceVoidCanLevel(x,y,getTile){
    if(y<=WORLD_TOP || y+1>=WORLD_BOTTOM || !canFill(getTile(x,y))) return false;
    const above=getTile(x,y-1);
    const below=getTile(x,y+1);
    return below===T.WATER || (!isAir(above) && above!==T.WATER);
  }
  function surfaceLevelTarget(x,y,dx,getTile){
    if(getTile(x,y)!==T.WATER || getTile(x,y-1)===T.WATER) return null;
    const nx=x+dx;
    if(!surfaceVoidCanLevel(nx,y,getTile)) return null;
    const covered=!isAir(getTile(nx,y-1)) && getTile(nx,y-1)!==T.WATER;
    const srcDepth=waterDepthFrom(x,y,getTile,32);
    if(covered){
      if(srcDepth<2) return null;
    } else {
      const dstDepth=waterDepthFrom(nx,y+1,getTile,32);
      if(srcDepth<=dstDepth+1) return null;
    }
    return {x:nx,y,covered};
  }
  function canSurfaceLevel(x,y,getTile){
    return !!(surfaceLevelTarget(x,y,-1,getTile) || surfaceLevelTarget(x,y,1,getTile));
  }
  function verticalDropDepth(x,y,getTile,maxDepth){
    let d=0, yy=y+1;
    const lim=Math.max(1,maxDepth||16);
    while(yy<WORLD_BOTTOM && d<lim && canFill(getTile(x,yy))){ d++; yy++; }
    return d;
  }
  function sideDrainInletTarget(x,y,getTile){
    if(y+1>=WORLD_BOTTOM) return null;
    const order=((x+y)&1)?[-1,1]:[1,-1];
    for(const dx of order){
      const nx=x+dx;
      if(!canFill(getTile(nx,y))) continue;
      if(verticalDropDepth(nx,y,getTile,8)<4) continue;
      return {x:nx,y};
    }
    return null;
  }
  function waterFallTarget(x,y,getTile){
    const MAX_FALL=12;
    let ny=y, steps=0, slotY=null;
    while(ny+1<WORLD_BOTTOM && steps<MAX_FALL){
      const belowY=ny+1;
      if(canFill(getTile(x,belowY))){
        ny=belowY;
        steps++;
        continue;
      }
      if(belowY+1<WORLD_BOTTOM && validDynamoSlot(x,belowY,getTile,'horizontal') && canFill(getTile(x,belowY+1))){
        if(slotY==null) slotY=belowY;
        ny=belowY+1;
        steps+=2;
        continue;
      }
      break;
    }
    return ny>y ? {y:ny, slotY} : null;
  }
  function pullAdjacentIntoDrainMouth(x,y,next,getTile,setTile){
    if(y+1>=WORLD_BOTTOM || !canFill(getTile(x,y)) || !canFill(getTile(x,y+1))) return false;
    const order=((x+y)&1)?[-1,1]:[1,-1];
    for(const dx of order){
      const sx=x+dx;
      if(getTile(sx,y)!==T.WATER) continue;
      setTile(sx,y,T.AIR);
      writeExternalTile(x,y,T.WATER,getTile,setTile);
      next.add(k(x,y));
      markNeighbors(next,x,y);
      markNeighbors(next,sx,y);
      if(pressureSeeds.size<2000) pressureSeeds.add(k(x,y));
      pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.7);
      disturb(x, 36);
      return true;
    }
    return false;
  }
  function recordDynamoWater(x,slotY,getTile){
    if(slotY==null) return;
    try{ if(MM.dynamo && MM.dynamo.recordFlow) MM.dynamo.recordFlow(x,slotY,T.WATER,1,getTile); }catch(e){}
  }
  function recordDynamoSideWater(slotX,slotY,getTile){
    try{ if(MM.dynamo && MM.dynamo.recordFlow) MM.dynamo.recordFlow(slotX,slotY,T.WATER,1.35,getTile); }catch(e){}
  }
  function notifyGasChange(x,y,oldTile,newTile){
    if(oldTile===newTile || (!isGas(oldTile) && !isGas(newTile))) return;
    try{ if(MM.gases && MM.gases.onTileChanged) MM.gases.onTileChanged(x,y,oldTile,newTile); }catch(e){}
  }
  function reactionApi(){
    try{ return MM.reactions || null; }catch(e){ return null; }
  }
  function hasWaterRecipes(){
    const api=reactionApi();
    try{ return !!(api && api.canStimulus && api.canStimulus('water')); }catch(e){ return false; }
  }
  function applyWaterReactionAt(x,y,getTile,setTile){
    if(reactionBudget<=0 || typeof getTile!=='function' || typeof setTile!=='function') return false;
    if(!hasWaterRecipes()) return false;
    const t=getTile(x,y);
    if(t===T.AIR || t===T.WATER || isGas(t)) return false;
    reactionBudget--;
    const api=reactionApi();
    try{ return !!(api && api.apply && api.apply('water',x,y,getTile,setTile,{source:'water'})); }catch(e){ return false; }
  }
  function applyWaterReactionsNear(x,y,getTile,setTile){
    if(!hasWaterRecipes()) return false;
    let changed=false;
    const dirs=[[0,1],[1,0],[-1,0],[0,-1]];
    for(const d of dirs){
      if(reactionBudget<=0) break;
      changed = applyWaterReactionAt(x+d[0],y+d[1],getTile,setTile) || changed;
    }
    return changed;
  }
  function writeExternalTile(x,y,v,getTile,setTile){
    const old=typeof getTile==='function' ? getTile(x,y) : undefined;
    setTile(x,y,v);
    notifyGasChange(x,y,old,v);
    if(v===T.WATER){
      applyWaterReactionsNear(x,y,getTile,setTile);
      queueMaterialAround(x,y,getTile);
    }
  }
  function hash32(x,y){ let h=(x|0)*374761393+(y|0)*668265263; h=(h^(h>>>13))*1274126177; return (h^(h>>>16))>>>0; }
  function hash32Salt(x,y,salt){
    let h=Math.imul(x|0,374761393) ^ Math.imul(y|0,668265263) ^ Math.imul(salt|0,2246822519);
    h=Math.imul(h^(h>>>13),1274126177);
    return (h^(h>>>16))>>>0;
  }
  function rand01(x,y,salt){ return hash32Salt(x,y,salt)/4294967296; }
  function materialReactionsEnabled(){
    return Number.isFinite(T.SAND) && Number.isFinite(T.WATER) && Number.isFinite(T.MUD);
  }
  function clayReactionsEnabled(){
    return materialReactionsEnabled() && Number.isFinite(T.CLAY) && Number.isFinite(T.WET_CLAY);
  }
  function countAdjacentWater(x,y,getTile){
    let n=0;
    if(getSafe(getTile,x,y-1,T.AIR)===T.WATER) n++;
    if(getSafe(getTile,x-1,y,T.AIR)===T.WATER) n++;
    if(getSafe(getTile,x+1,y,T.AIR)===T.WATER) n++;
    if(getSafe(getTile,x,y+1,T.AIR)===T.WATER) n++;
    return n;
  }
  function adjacentWaterCell(x,y,getTile){
    const dirs=[[0,-1],[-1,0],[1,0],[0,1]];
    const start=hash32Salt(x,y,311)%dirs.length;
    for(let i=0;i<dirs.length;i++){
      const d=dirs[(start+i)%dirs.length];
      const wx=x+d[0], wy=y+d[1];
      if(getSafe(getTile,wx,wy,T.AIR)===T.WATER) return {x:wx,y:wy};
    }
    return null;
  }
  function queueWetSand(x,y,getTile){
    if(!materialReactionsEnabled() || !validTile(x,y)) return false;
    x=Math.floor(x); y=Math.floor(y);
    if(getSafe(getTile,x,y,T.AIR)!==T.SAND || countAdjacentWater(x,y,getTile)<=0) return false;
    const kk=k(x,y);
    if(!wetSand.has(kk)){
      if(wetSand.size>=MATERIAL_QUEUE_CAP) return false;
      wetSand.set(kk,{x,y,wet:0});
    }
    return true;
  }
  function queueDryMud(x,y,getTile){
    if(!materialReactionsEnabled() || !validTile(x,y)) return false;
    x=Math.floor(x); y=Math.floor(y);
    if(getSafe(getTile,x,y,T.AIR)!==T.MUD) return false;
    const kk=k(x,y);
    if(!dryMud.has(kk)){
      if(dryMud.size>=MATERIAL_QUEUE_CAP) return false;
      dryMud.set(kk,{x,y,dry:0});
    }
    return true;
  }
  function queueWetClay(x,y,getTile){
    if(!clayReactionsEnabled() || !validTile(x,y)) return false;
    x=Math.floor(x); y=Math.floor(y);
    if(getSafe(getTile,x,y,T.AIR)!==T.CLAY || countAdjacentWater(x,y,getTile)<=0) return false;
    const kk=k(x,y);
    if(!wetClay.has(kk)){
      if(wetClay.size>=MATERIAL_QUEUE_CAP) return false;
      wetClay.set(kk,{x,y,wet:0});
    }
    return true;
  }
  function queueDryClay(x,y,getTile){
    if(!clayReactionsEnabled() || !validTile(x,y)) return false;
    x=Math.floor(x); y=Math.floor(y);
    if(getSafe(getTile,x,y,T.AIR)!==T.WET_CLAY) return false;
    const kk=k(x,y);
    if(!dryClay.has(kk)){
      if(dryClay.size>=MATERIAL_QUEUE_CAP) return false;
      dryClay.set(kk,{x,y,dry:0});
    }
    return true;
  }
  function queueMaterialAround(x,y,getTile){
    if(!materialReactionsEnabled() || typeof getTile!=='function') return false;
    let queued=false;
    const cells=[[0,0],[1,0],[-1,0],[0,1],[0,-1]];
    for(const d of cells){
      const tx=Math.floor(x)+d[0], ty=Math.floor(y)+d[1];
      queued = queueWetSand(tx,ty,getTile) || queued;
      queued = queueDryMud(tx,ty,getTile) || queued;
      queued = queueWetClay(tx,ty,getTile) || queued;
      queued = queueDryClay(tx,ty,getTile) || queued;
    }
    return queued;
  }
  function currentSunIntensity(){
    try{
      const s=MM.solar;
      if(s && s._debug && typeof s._debug.daylight==='function'){
        const v=Number(s._debug.daylight());
        if(Number.isFinite(v)) return Math.max(0,Math.min(1,v));
      }
      if(s && typeof s.metrics==='function'){
        const m=s.metrics();
        const v=Number(m && m.sun);
        if(Number.isFinite(v)) return Math.max(0,Math.min(1,v));
      }
    }catch(e){}
    try{
      const bg=MM.background;
      const c=bg && (typeof bg.timeInfo==='function' ? bg.timeInfo() : (typeof bg.getCycleInfo==='function' ? bg.getCycleInfo() : null));
      if(c && Number.isFinite(Number(c.cycleT))){
        const t=((Number(c.cycleT)%1)+1)%1;
        return t>=0.5 ? 0 : Math.max(0,Math.sin((t/0.5)*Math.PI));
      }
      if(c && typeof c.isDay==='boolean' && Number.isFinite(Number(c.tDay))){
        return c.isDay ? Math.max(0,Math.sin(Math.max(0,Math.min(1,Number(c.tDay)))*Math.PI)) : 0;
      }
    }catch(e){}
    return 1;
  }
  function skyExposedToSun(x,y,getTile){
    if(typeof getTile!=='function') return true;
    for(let yy=y-1; yy>=WORLD_TOP; yy--){
      if(!isSunTransparentTile(getSafe(getTile,x,yy,T.STONE))) return false;
    }
    return true;
  }
  function materialThreshold(base,x,y,salt){
    return base*(0.72+rand01(x,y,salt)*0.66);
  }
  function notifySolidMaterialChange(x,y,oldTile,newTile,getTile,setTile){
    if(oldTile===newTile) return;
    try{ if(MM.fallingSolids && MM.fallingSolids.recheckNeighborhood) MM.fallingSolids.recheckNeighborhood(x,y); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement) MM.fallingSolids.afterPlacement(x,y); }catch(e){}
    try{ if(MM.volcano && MM.volcano.onTileChanged) MM.volcano.onTileChanged(x,y,newTile,getTile,setTile); }catch(e){}
  }
  function writeGasTile(x,y,t,getTile,setTile){
    if(typeof setTile!=='function') return false;
    const old=getSafe(getTile,x,y,T.AIR);
    try{
      if(typeof setTile.transient==='function') setTile.transient(x,y,t);
      else setTile(x,y,t);
      notifyGasChange(x,y,old,t);
      return true;
    }catch(e){ return false; }
  }
  function emitMudSteam(x,y,getTile,setTile){
    try{
      if(MM.gases && MM.gases.add && MM.gases.add('steam',x,y,{power:0.45,cells:1,getTile,setTile})>0) return true;
    }catch(e){}
    if(!Number.isFinite(T.STEAM)) return false;
    const spots=[[0,-1],[-1,-1],[1,-1],[0,-2],[-1,0],[1,0]];
    for(const d of spots){
      const tx=x+d[0], ty=y+d[1];
      if(!validTile(tx,ty) || getSafe(getTile,tx,ty,T.STONE)!==T.AIR) continue;
      if(writeGasTile(tx,ty,T.STEAM,getTile,setTile)) return true;
    }
    return false;
  }
  function absorbWaterIntoSand(rec,getTile,setTile){
    if(typeof setTile!=='function' || getSafe(getTile,rec.x,rec.y,T.AIR)!==T.SAND) return false;
    const water=adjacentWaterCell(rec.x,rec.y,getTile);
    if(!water) return false;
    setTile(water.x,water.y,T.AIR);
    setTile(rec.x,rec.y,T.MUD);
    notifySolidMaterialChange(rec.x,rec.y,T.SAND,T.MUD,getTile,setTile);
    wetSand.delete(k(rec.x,rec.y));
    if(dryMud.size<MATERIAL_QUEUE_CAP) dryMud.set(k(rec.x,rec.y),{x:rec.x,y:rec.y,dry:0});
    wakeWaterCell(water.x,water.y,true);
    markNeighbors(active,rec.x,rec.y);
    hurrySolver();
    disturb(water.x, -45);
    try{ const p=MM.particles; if(p && p.spawnSplash) p.spawnSplash((water.x+0.5)*(MM.TILE||20),(water.y+0.5)*(MM.TILE||20),0.22); }catch(e){}
    return true;
  }
  function hydrateClay(rec,getTile,setTile){
    if(typeof setTile!=='function' || !clayReactionsEnabled() || getSafe(getTile,rec.x,rec.y,T.AIR)!==T.CLAY) return false;
    const water=adjacentWaterCell(rec.x,rec.y,getTile);
    if(!water) return false;
    setTile(water.x,water.y,T.AIR);
    setTile(rec.x,rec.y,T.WET_CLAY);
    notifySolidMaterialChange(rec.x,rec.y,T.CLAY,T.WET_CLAY,getTile,setTile);
    wetClay.delete(k(rec.x,rec.y));
    if(dryClay.size<MATERIAL_QUEUE_CAP) dryClay.set(k(rec.x,rec.y),{x:rec.x,y:rec.y,dry:0});
    wakeWaterCell(water.x,water.y,true);
    markNeighbors(active,rec.x,rec.y);
    hurrySolver();
    disturb(water.x, -38);
    return true;
  }
  function dryMudToSand(rec,getTile,setTile){
    if(typeof setTile!=='function' || getSafe(getTile,rec.x,rec.y,T.AIR)!==T.MUD) return false;
    setTile(rec.x,rec.y,T.SAND);
    notifySolidMaterialChange(rec.x,rec.y,T.MUD,T.SAND,getTile,setTile);
    emitMudSteam(rec.x,rec.y,getTile,setTile);
    dryMud.delete(k(rec.x,rec.y));
    if(countAdjacentWater(rec.x,rec.y,getTile)>0) queueWetSand(rec.x,rec.y,getTile);
    return true;
  }
  function dryWetClayToClay(rec,getTile,setTile){
    if(typeof setTile!=='function' || !clayReactionsEnabled() || getSafe(getTile,rec.x,rec.y,T.AIR)!==T.WET_CLAY) return false;
    setTile(rec.x,rec.y,T.CLAY);
    notifySolidMaterialChange(rec.x,rec.y,T.WET_CLAY,T.CLAY,getTile,setTile);
    emitMudSteam(rec.x,rec.y,getTile,setTile);
    dryClay.delete(k(rec.x,rec.y));
    if(countAdjacentWater(rec.x,rec.y,getTile)>0) queueWetClay(rec.x,rec.y,getTile);
    return true;
  }
  function runMaterialScan(getTile,cols){
    if(!materialReactionsEnabled() || typeof getTile!=='function') return false;
    const p=(typeof window!=='undefined' && window.player);
    const cx=(p && isFinite(p.x)) ? Math.floor(p.x) : 0;
    const columns=Math.max(0,Math.floor(cols)||0);
    let queued=false;
    const yr=activeScanRange();
    for(let i=0;i<columns;i++){
      const wx = cx - MATERIAL_SCAN_RADIUS + ((materialScanOffset+i)%MATERIAL_SCAN_SPAN);
      for(let y=yr.top;y<yr.bottom;y++){
        const t=getSafe(getTile,wx,y,T.AIR);
        if(t===T.SAND) queued = queueWetSand(wx,y,getTile) || queued;
        else if(t===T.MUD) queued = queueDryMud(wx,y,getTile) || queued;
        else if(t===T.CLAY) queued = queueWetClay(wx,y,getTile) || queued;
        else if(t===T.WET_CLAY) queued = queueDryClay(wx,y,getTile) || queued;
      }
    }
    materialScanOffset=(materialScanOffset+columns)%MATERIAL_SCAN_SPAN;
    return queued;
  }
  function processWetSand(getTile,setTile,dt,budget){
    const keys=[...wetSand.keys()].sort();
    let left=budget;
    for(const kk of keys){
      if(left--<=0) break;
      const rec=wetSand.get(kk);
      if(!rec){ continue; }
      if(getSafe(getTile,rec.x,rec.y,T.AIR)!==T.SAND){ wetSand.delete(kk); continue; }
      const water=countAdjacentWater(rec.x,rec.y,getTile);
      if(water<=0){
        rec.wet=Math.max(0,(rec.wet||0)-dt*0.7);
        if(rec.wet<=0) wetSand.delete(kk);
        continue;
      }
      rec.wet=(rec.wet||0)+dt*(0.85+Math.min(3,water)*0.35);
      if(rec.wet>=materialThreshold(WET_SAND_SECONDS,rec.x,rec.y,401)) absorbWaterIntoSand(rec,getTile,setTile);
      else wetSand.set(kk,rec);
    }
    return Math.max(0,left);
  }
  function processWetClay(getTile,setTile,dt,budget){
    const keys=[...wetClay.keys()].sort();
    let left=budget;
    for(const kk of keys){
      if(left--<=0) break;
      const rec=wetClay.get(kk);
      if(!rec){ continue; }
      if(getSafe(getTile,rec.x,rec.y,T.AIR)!==T.CLAY){ wetClay.delete(kk); continue; }
      const water=countAdjacentWater(rec.x,rec.y,getTile);
      if(water<=0){
        rec.wet=Math.max(0,(rec.wet||0)-dt*0.7);
        if(rec.wet<=0) wetClay.delete(kk);
        continue;
      }
      rec.wet=(rec.wet||0)+dt*(0.9+Math.min(3,water)*0.38);
      if(rec.wet>=materialThreshold(CLAY_HYDRATE_SECONDS,rec.x,rec.y,421)) hydrateClay(rec,getTile,setTile);
      else wetClay.set(kk,rec);
    }
    return Math.max(0,left);
  }
  function processDryMud(getTile,setTile,dt,budget,sun){
    const keys=[...dryMud.keys()].sort();
    let left=budget;
    for(const kk of keys){
      if(left--<=0) break;
      const rec=dryMud.get(kk);
      if(!rec){ continue; }
      if(getSafe(getTile,rec.x,rec.y,T.AIR)!==T.MUD){ dryMud.delete(kk); continue; }
      if(sun<SUN_DRY_MIN || !skyExposedToSun(rec.x,rec.y,getTile)){
        rec.dry=Math.max(0,(rec.dry||0)-dt*0.45);
        dryMud.set(kk,rec);
        continue;
      }
      rec.dry=(rec.dry||0)+dt*sun;
      if(rec.dry>=materialThreshold(MUD_DRY_SECONDS,rec.x,rec.y,409)) dryMudToSand(rec,getTile,setTile);
      else dryMud.set(kk,rec);
    }
    return Math.max(0,left);
  }
  function processDryClay(getTile,setTile,dt,budget,sun){
    const keys=[...dryClay.keys()].sort();
    let left=budget;
    for(const kk of keys){
      if(left--<=0) break;
      const rec=dryClay.get(kk);
      if(!rec){ continue; }
      if(getSafe(getTile,rec.x,rec.y,T.AIR)!==T.WET_CLAY){ dryClay.delete(kk); continue; }
      if(sun<SUN_DRY_MIN || !skyExposedToSun(rec.x,rec.y,getTile)){
        rec.dry=Math.max(0,(rec.dry||0)-dt*0.45);
        dryClay.set(kk,rec);
        continue;
      }
      rec.dry=(rec.dry||0)+dt*sun;
      if(rec.dry>=materialThreshold(WET_CLAY_DRY_SECONDS,rec.x,rec.y,429)) dryWetClayToClay(rec,getTile,setTile);
      else dryClay.set(kk,rec);
    }
    return Math.max(0,left);
  }
  function updateMaterialReactions(getTile,setTile,dt){
    if(!materialReactionsEnabled() || !(dt>0) || typeof getTile!=='function' || typeof setTile!=='function') return;
    materialScanAcc=Math.min(materialScanAcc+dt,MATERIAL_SCAN_INTERVAL*3);
    const passes=Math.min(3,Math.floor(materialScanAcc/MATERIAL_SCAN_INTERVAL));
    if(passes>0){
      materialScanAcc-=passes*MATERIAL_SCAN_INTERVAL;
      const cols=(active.size || wetSand.size || wetClay.size || dryMud.size || dryClay.size) ? MATERIAL_SCAN_COLS_ACTIVE : MATERIAL_SCAN_COLS_IDLE;
      for(let i=0;i<passes;i++) runMaterialScan(getTile,cols);
    }
    let budget=MATERIAL_PROCESS_CAP;
    budget=processWetSand(getTile,setTile,dt,budget);
    if(budget>0) budget=processWetClay(getTile,setTile,dt,budget);
    const sun=budget>0 ? currentSunIntensity() : 0;
    if(budget>0) budget=processDryMud(getTile,setTile,dt,budget,sun);
    if(budget>0) processDryClay(getTile,setTile,dt,budget,sun);
  }

  // Public wave kick: positive impulse pushes the surface down (entry), negative lifts it.
  function disturb(x, impulse){
    if(typeof x!=='number' || typeof impulse!=='number' || !isFinite(impulse)) return;
    const xi = Math.floor(x);
    let nv = (pendingImpulse.get(xi)||0) + impulse;
    if(nv>420) nv=420; else if(nv<-420) nv=-420;
    pendingImpulse.set(xi, nv);
  }

  // World generation finished a chunk spanning tile columns [x0..x1]: queue a boundary
  // wake (processed in update, where tile accessors are available).
  function noteChunkGenerated(x0,x1){
    if(typeof x0!=='number' || typeof x1!=='number') return;
    if(chunkWakes.length<64) chunkWakes.push({x0,x1});
  }

  // A multi-cell gravity drop = waterfall: keep a short-lived stream visual alive while
  // flow continues, splash + kick the surface springs at the impact point.
  function noteFall(x,y0,y1){
    let st=null;
    for(const s of streams){ if(s.x===x && Math.abs(s.y1-y1)<=2 && s.y0<=y1 && y0<=s.y1+2){ st=s; break; } }
    if(st){ st.ttl=STREAM_TTL; if(y0<st.y0) st.y0=y0; st.y1=y1; }
    else if(streams.length<48){
      streams.push({x,y0,y1,ttl:STREAM_TTL});
      try{ const p=MM.particles; if(p && p.spawnSplash) p.spawnSplash((x+0.5)*(MM.TILE||20), (y1+0.6)*(MM.TILE||20), 0.35); }catch(e){}
    }
    disturb(x, 120);
  }

  function runPassiveActivationScan(getTile, columns){
    const cols=Math.max(0, Math.floor(columns)||0);
    if(cols<=0) return false;
    const p=(typeof window!=='undefined' && window.player);
    const cx=(p && isFinite(p.x))? Math.floor(p.x) : 0;
    let woke=false;
    const yr=activeScanRange();
    for(let i=0;i<cols;i++){
      const wx = cx - PASSIVE_SCAN_RADIUS + ((passiveScanOffset+i)%PASSIVE_SCAN_SPAN);
      for(let y=yr.top;y<yr.bottom;y++){
        if(getTile(wx,y)!==T.WATER) continue;
        if(canFill(getTile(wx,y+1)) || canDropThroughDynamo(wx,y,getTile) || canSideFlowThroughDynamo(wx,y,getTile) || canSurfaceLevel(wx,y,getTile)){ mark(wx,y); woke=true; break; }                 // can fall
        const lA=isAir(getTile(wx-1,y)), rA=isAir(getTile(wx+1,y));
        if(!lA && !rA) continue;
        if(getTile(wx,y-1)===T.WATER){ mark(wx,y); woke=true; break; }                // can push (head)
        // can spill or seek: a drop somewhere along an open same-row path
        let drop=false;
        for(const dx of [-1,1]){
          if((dx<0 && !lA) || (dx>0 && !rA)) continue;
          for(let s2=1;s2<=6 && !drop;s2++){
            const tx=wx+dx*s2;
            if(!isAir(getTile(tx,y))) break;
            if(canFill(getTile(tx,y+1))) drop=true;
          }
          if(drop) break;
        }
        if(drop){ mark(wx,y); woke=true; break; }
      }
    }
    passiveScanOffset=(passiveScanOffset+cols)%PASSIVE_SCAN_SPAN;
    passiveScanLastColumns+=cols;
    passiveScanTotalColumns+=cols;
    return woke;
  }

  function update(getTile,setTile,dt){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function' || typeof setTile!=='function') return;
    passiveScanLastColumns=0;
    reactionBudget = hasWaterRecipes()
      ? Math.min(160, WATER_REACTION_BUDGET_BASE + Math.floor(active.size*0.03))
      : 0;
    updateMaterialReactions(getTile,setTile,dt);
    // Newly generated chunks: wake water along their boundary columns. World generation
    // can place caves right beside dormant water (or water beside old caves) and nothing
    // else notifies the sim about that seam.
    if(chunkWakes.length){
      for(let n=0;n<2 && chunkWakes.length;n++){
        const {x0,x1}=chunkWakes.shift();
        let woke=false;
        const world = (typeof window!=='undefined' && window.MM && MM.world) ? MM.world : null;
        const peek = world && typeof world.peekTile==='function'
          ? (x,y,fallback)=>world.peekTile(x,y,fallback)
          : (x,y)=>getTile(x,y);
        const yr=activeScanRange();
        for(const wx of [x0-1,x0,x1,x1+1]){
          for(let y=yr.top;y<yr.bottom;y++){
            if(peek(wx,y,T.AIR)!==T.WATER) continue;
            if(canFill(peek(wx,y+1,T.STONE)) || isAir(peek(wx-1,y,T.STONE)) || isAir(peek(wx+1,y,T.STONE))){ mark(wx,y); woke=true; }
          }
        }
        if(woke){
          pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.88);
          lateralAcc=Math.max(lateralAcc,LATERAL_INTERVAL);
        }
      }
    }
    // Passive activation slice: sweep a window around the player (worlds extend into
    // negative x — an absolute 0..N sweep would never reach half the map). Runs whenever
    // the sim is mostly idle, and also wakes pressurized cells facing a side opening —
    // not just fall candidates — so dormant anomalies (suspended layers, chunk seams)
    // self-heal instead of hanging forever.
    if(active.size<32){
      passiveScanAcc=Math.min(passiveScanAcc+dt, PASSIVE_SCAN_INTERVAL*PASSIVE_SCAN_BURST_LIMIT);
      const passes=Math.min(PASSIVE_SCAN_BURST_LIMIT, Math.floor(passiveScanAcc/PASSIVE_SCAN_INTERVAL));
      if(passes>0){
        passiveScanAcc-=passes*PASSIVE_SCAN_INTERVAL;
        for(let pass=0; pass<passes && active.size<32; pass++){
          const idle=(active.size===0 && pressureSeeds.size===0);
          runPassiveActivationScan(getTile, idle ? PASSIVE_SCAN_COLS_IDLE : PASSIVE_SCAN_COLS_ACTIVE);
        }
      }
      if(active.size===0 && pressureSeeds.size===0) return;
    } else {
      passiveScanAcc=0;
    }
    const size = active.size;
    const MAX = Math.min(2400, 360 + Math.floor(size*0.40));
    // Cooldown decay
    if(lateralCooldown.size){
      for(const [cx,val] of lateralCooldown){ const nv=val-dt; if(nv<=0) lateralCooldown.delete(cx); else lateralCooldown.set(cx,nv); }
    }
    let processed=0; const next=new Set();
    const keys=[...active]; keys.sort();
    lateralAcc += dt; const lateralStep = lateralAcc >= LATERAL_INTERVAL; if(lateralStep) lateralAcc=0;
    for(const key of keys){
      if(processed++>MAX){ next.add(key); continue; }
      const [sx,sy] = key.split(',').map(Number);
      if(getTile(sx,sy)!==T.WATER) continue;
      // Gravity (multi-cell drop)
      const fall=waterFallTarget(sx,sy,getTile);
      if(fall){
        const ny=fall.y;
        setTile(sx,sy,T.AIR); writeExternalTile(sx,ny,T.WATER,getTile,setTile); next.add(k(sx,ny)); markNeighbors(next,sx,ny); markNeighbors(next,sx,sy);
        recordDynamoWater(sx,fall.slotY,getTile);
        if(ny-sy>=2) noteFall(sx,sy,ny);
        if(ny-sy>=2) pullAdjacentIntoDrainMouth(sx,sy,next,getTile,setTile);
        continue;
      }
      let moved=false;
      if(!canSideFlowThroughDynamo(sx,sy,getTile)){
        const inlet=sideDrainInletTarget(sx,sy,getTile);
        if(inlet){
          setTile(sx,sy,T.AIR);
          writeExternalTile(inlet.x,inlet.y,T.WATER,getTile,setTile);
          next.add(k(inlet.x,inlet.y));
          markNeighbors(next,inlet.x,inlet.y);
          markNeighbors(next,sx,sy);
          if(pressureSeeds.size<2000) pressureSeeds.add(k(inlet.x,inlet.y));
          pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.55);
          disturb(inlet.x, 34);
          continue;
        }
      }
      const lateralEvaluated = lateralStep && !(lateralCooldown.get(sx)>0);
      if(lateralEvaluated){
        const dynOrder=((sx+sy)&1)?[-1,1]:[1,-1];
        for(const dx of dynOrder){
          const flow=sideDynamoFlowTarget(sx,sy,dx,getTile);
          if(!flow) continue;
          setTile(sx,sy,T.AIR);
          writeExternalTile(flow.outX,flow.outY,T.WATER,getTile,setTile);
          next.add(k(flow.outX,flow.outY));
          markNeighbors(next,flow.outX,flow.outY);
          markNeighbors(next,sx,sy);
          recordDynamoSideWater(flow.slotX,flow.slotY,getTile);
          if(pressureSeeds.size<2000) pressureSeeds.add(k(flow.outX,flow.outY));
          pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.6);
          disturb(flow.outX, 52);
          moved=true;
          break;
        }
        if(moved) continue;
        for(const dx of (((sx+sy)&1)?[-1,1]:[1,-1])){
          const flow=surfaceLevelTarget(sx,sy,dx,getTile);
          if(!flow) continue;
          if(flow.covered){
            // A roofed surface mouth must be filled by the pressure solver while the
            // edge cell stays connected to the source body. Moving this tile directly
            // can strand a one-cell droplet in the mouth and stall the rest of the fill.
            next.add(key);
            if(pressureSeeds.size<2000) pressureSeeds.add(key);
            pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.9);
            moved=true;
            break;
          }
          setTile(sx,sy,T.AIR);
          writeExternalTile(flow.x,flow.y,T.WATER,getTile,setTile);
          next.add(k(flow.x,flow.y));
          markNeighbors(next,flow.x,flow.y);
          markNeighbors(next,sx,sy);
          if(pressureSeeds.size<2000) pressureSeeds.add(k(flow.x,flow.y));
          pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.6);
          disturb(flow.x, 26);
          moved=true;
          break;
        }
        if(moved) continue;
        // Edge spills — the same-row side cell must be passable too: a diagonal-only
        // check lets water clip through solid wall corners into sealed pockets
        const leftBelowAir = sy+1<WORLD_BOTTOM && canFill(getTile(sx-1,sy)) && canFill(getTile(sx-1,sy+1));
        const rightBelowAir= sy+1<WORLD_BOTTOM && canFill(getTile(sx+1,sy)) && canFill(getTile(sx+1,sy+1));
        function dropDepth(x){ let d=0, yy=sy+1; while(yy<WORLD_BOTTOM && canFill(getTile(x,yy)) && d<8){ d++; yy++; } return d; }
        if(leftBelowAir || rightBelowAir){
          let order=[];
            if(leftBelowAir && rightBelowAir){ const dl=dropDepth(sx-1); const dr=dropDepth(sx+1); order = dl>dr?[-1,1]:dr>dl?[1,-1]:(((sx+sy)&1)?[-1,1]:[1,-1]); }
            else order = leftBelowAir?[-1]:[1];
          for(const dx of order){ if(canFill(getTile(sx+dx,sy)) && canFill(getTile(sx+dx,sy+1))){ setTile(sx,sy,T.AIR); writeExternalTile(sx+dx,sy+1,T.WATER,getTile,setTile); next.add(k(sx+dx,sy+1)); markNeighbors(next,sx+dx,sy+1); disturb(sx+dx,46); moved=true; break; } }
          if(moved) continue;
        }
        // Lateral downhill seeking: only move sideways when a drop exists within range —
        // otherwise a lone puddle random-walks across flat ground forever.
        const RANGE=6; const candidates=[];
        for(const dx of [-1,1]){
          const nx=sx+dx; if(!isAir(getTile(nx,sy))) continue;
          if(sy+1<WORLD_BOTTOM && canFill(getTile(nx,sy+1))){ // immediate drop
            let drop=0, yy=sy+1; while(yy<WORLD_BOTTOM && canFill(getTile(nx,yy)) && drop<8){ drop++; yy++; }
            candidates.push({dx,score:100-drop}); continue;
          }
          let width=0, foundLower=false, floorConsistency=0;
          for(let step=1; step<=RANGE; step++){
            const tx=sx+dx*step; if(!isAir(getTile(tx,sy))) break;
            if(sy+1<WORLD_BOTTOM && canFill(getTile(tx,sy+1))){ foundLower=true; break; }
            floorConsistency++; width++;
          }
          if(!foundLower) continue;
          candidates.push({dx,score:width + floorConsistency*0.3 + 6});
        }
        if(candidates.length){
          candidates.sort((a,b)=> b.score - a.score || (((sx+sy)&1)? b.dx - a.dx : a.dx - b.dx));
          const best=candidates[0]; if(best.score>0){ setTile(sx,sy,T.AIR); writeExternalTile(sx+best.dx,sy,T.WATER,getTile,setTile); next.add(k(sx+best.dx,sy)); markNeighbors(next,sx+best.dx,sy); moved=true; }
        }
        // Pressurized sideways push: a cell with hydraulic head (water directly above)
        // seeps into a same-level opening even with no drop in range — quick local
        // response when a wall is mined out. The receiver has air above (no head), so it
        // can never push the unit back: no oscillation. Roof-capped runs (1-tall tunnels)
        // are filled by pressure leveling instead, which joins dry columns below the
        // waterline. Open surface cells have no head, so lone puddles can't random-walk.
        if(!moved && getTile(sx,sy-1)===T.WATER){
          for(const dx of (((sx+sy)&1)?[-1,1]:[1,-1])){
            const nx=sx+dx;
            if(!isAir(getTile(nx,sy))) continue;
            if(!(sy+1<WORLD_BOTTOM) || canFill(getTile(nx,sy+1))) continue; // a drop: spill logic owns it
            setTile(sx,sy,T.AIR); writeExternalTile(nx,sy,T.WATER,getTile,setTile);
            next.add(k(nx,sy)); markNeighbors(next,sx,sy); markNeighbors(next,nx,sy);
            if(pressureSeeds.size<2000) pressureSeeds.add(k(nx,sy));
            // bring the next leveling pass forward so the new column rises promptly
            pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.6);
            disturb(nx, 30);
            moved=true; break;
          }
        }
      }
      if(!moved){
        if(lateralEvaluated){
          // Fully evaluated and stable: leave the hot set, but stay visible to pressure leveling
          if(sy+1<WORLD_BOTTOM && canFill(getTile(sx,sy+1))) next.add(key);
          else {
            // A cell with head facing a same-level opening is a flood front whose feed
            // refills asynchronously — keep it hot or the advance stalls between ticks
            const pushable = getTile(sx,sy-1)===T.WATER && (
              (isAir(getTile(sx-1,sy)) && sy+1<WORLD_BOTTOM && !canFill(getTile(sx-1,sy+1))) ||
              (isAir(getTile(sx+1,sy)) && sy+1<WORLD_BOTTOM && !canFill(getTile(sx+1,sy+1))));
            if(pushable) next.add(key);
            else if(pressureSeeds.size<2000) pressureSeeds.add(key);
          }
        } else if(isAir(getTile(sx-1,sy)) || isAir(getTile(sx+1,sy)) || isAir(getTile(sx,sy+1)) || canDropThroughDynamo(sx,sy,getTile) || canSideFlowThroughDynamo(sx,sy,getTile) || canSurfaceLevel(sx,sy,getTile)) next.add(key);
        else if(pressureSeeds.size<2000) pressureSeeds.add(key); // skipped under cooldown: stay visible to leveling
      }
    }
    active.clear(); for(const kk of next) active.add(kk);
    // Pressure leveling scheduling
    pressureAcc += dt;
    if(pressureAcc >= pressureIntervalCurrent && active.size < 1800){
      pressureAcc=0;
      const pressureT0=(typeof performance!=='undefined' && performance.now) ? performance.now() : 0;
      const result=runPressureLeveling(getTile,setTile);
      if(pressureT0){
        pressureLastMs=performance.now()-pressureT0;
        if(pressureLastMs>pressureMaxMs) pressureMaxMs=pressureLastMs;
      }
      if(result){
        const {touchedXs, variance, hadTransfers} = result;
        if(hadTransfers){
          // Short cooldown: long blanket cooldowns choke drains (e.g. a lake emptying
          // into a dug shaft re-levels every pass, freezing its own outflow columns)
          const COOLDOWN=0.25;
          for(const x of touchedXs) lateralCooldown.set(x, Math.max(lateralCooldown.get(x)||0, COOLDOWN));
          // Re-mark touched columns but KEEP the rest of the active set: clearing it here
          // killed in-progress flood fronts elsewhere (cells the leveling didn't touch)
          // and left bodies permanently unsettled.
          for(const x of touchedXs){
            // find first water tile in column (cheap linear; columns small on average)
            for(let y=WORLD_TOP;y<WORLD_BOTTOM;y++){ if(getTile(x,y)===T.WATER){ active.add(k(x,y)); break; } }
            // gentle alternating wave kick so leveling reads as sloshing, not teleporting
            disturb(x, (x&1)? 56 : -56);
          }
        }
        if(variance!=null){
          let v=variance; if(v>12) v=12; const t=v/12; // 0..1
          const target = PRESSURE_INTERVAL_MAX - (PRESSURE_INTERVAL_MAX-PRESSURE_INTERVAL_MIN)*t;
          pressureIntervalCurrent = pressureIntervalCurrent*0.7 + target*0.3;
        }
      }
    }
    if(active.size>6000){
      // Hard cap active set deterministically (already sorted earlier); avoids O(n^2) deletes mid-iteration
      const limited = [...active].slice(0,6000);
      active.clear();
      for(const id of limited) active.add(id);
    }
  }

  function markNeighbors(set,x,y){ set.add(k(x-1,y)); set.add(k(x+1,y)); set.add(k(x,y-1)); set.add(k(x,y+1)); }
  function hurrySolver(){
    lateralAcc=Math.max(lateralAcc,LATERAL_INTERVAL);
    pressureAcc=Math.max(pressureAcc,pressureIntervalCurrent*0.88);
  }
  function wakeWaterCell(x,y,includeNeighbors){
    mark(x,y);
    if(includeNeighbors) markNeighbors(active,x,y);
    if(pressureSeeds.size<2400) pressureSeeds.add(k(x,y));
  }
  function wakeWaterAround(x,y,getTile,rx,ry){
    if(typeof getTile!=='function') return false;
    const cx=Math.floor(x), cy=Math.floor(y);
    const xRad=Math.max(1, Math.floor(rx||5));
    const yRad=Math.max(1, Math.floor(ry||4));
    let woke=false;
    for(let yy=Math.max(WORLD_TOP,cy-yRad); yy<=Math.min(WORLD_BOTTOM-1,cy+yRad); yy++){
      for(let xx=cx-xRad; xx<=cx+xRad; xx++){
        if(getTile(xx,yy)!==T.WATER) continue;
        wakeWaterCell(xx,yy,false);
        woke=true;
      }
    }
    if(woke) hurrySolver();
    return woke;
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
      const kk=k(x,y);
      if(used.has(kk)) return;
      used.add(kk);
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
  function addSource(x,y,getTile,setTile){
    if(!validTile(x,y) || typeof getTile!=='function' || typeof setTile!=='function') return false;
    if(hasWaterRecipes()) reactionBudget=Math.max(reactionBudget,4);
    const cur=getTile(x,y);
    if(cur===T.AIR || isGas(cur)){
      writeExternalTile(x,y,T.WATER,getTile,setTile);
      wakeWaterCell(x,y,false); hurrySolver(); disturb(x,140);
      return true;
    }
    if(cur===T.WATER){
      wakeWaterCell(x,y,false); hurrySolver();
      applyWaterReactionsNear(x,y,getTile,setTile);
      queueMaterialAround(x,y,getTile);
      return true;
    }
    const reacted=applyWaterReactionAt(x,y,getTile,setTile);
    if(reacted) queueMaterialAround(x,y,getTile);
    return reacted;
  }
  function onTileChanged(x,y,getTile){
    // Edits are usually player/mining/worldgen events. Wake a modest region so
    // shelves, drain mouths, and cave bores react on the next tick instead of waiting
    // for the passive scan to rediscover settled water.
    invalidateOverlayCache();
    wakeWaterAround(x,y,getTile,5,4);
    queueMaterialAround(x,y,getTile);
  }
  function onTilesChangedBatch(cells,getTile,opts){
    invalidateOverlayCache();
    const cap=Math.max(4,Math.min(48,(opts && opts.cap)|0 || TILE_CHANGE_BATCH_WAKE_CAP));
    const selected=selectBatchWakeCells(cells,cap);
    let woke=false;
    for(const c of selected){
      woke = wakeWaterAround(c.x,c.y,getTile,5,4) || woke;
      queueMaterialAround(c.x,c.y,getTile);
    }
    if(woke) hurrySolver();
    return selected.length;
  }
  // A solid is about to overwrite the water at (x,y): conserve volume by moving that
  // unit to the nearest opening — above the column it belongs to, else beside it.
  function displaceAt(x,y,getTile,setTile){
    let ty=y-1, steps=0;
    while(ty>=WORLD_TOP && getTile(x,ty)===T.WATER && steps<MAX_VERTICAL_SCAN){ ty--; steps++; }
    if(ty>=WORLD_TOP && isAir(getTile(x,ty))){ writeExternalTile(x,ty,T.WATER,getTile,setTile); wakeWaterCell(x,ty,false); hurrySolver(); disturb(x,90); return true; }
    for(const dx of [-1,1]){ if(isAir(getTile(x+dx,y))){ writeExternalTile(x+dx,y,T.WATER,getTile,setTile); wakeWaterCell(x+dx,y,false); hurrySolver(); disturb(x+dx,70); return true; } }
    return false; // fully sealed pocket — the unit is lost
  }

  // ---------------- Rendering ----------------
  function drawWaterTopPath(g,xpx,TILE,sg,offset){
    const yL=sg.yl+(offset||0), yR=sg.yr+(offset||0);
    const lCap=sg.lCap||0, rCap=sg.rCap||0;
    const xL=xpx+(sg.lSoft||0), xR=xpx+TILE-(sg.rSoft||0);
    if(lCap>0){
      g.moveTo(xL,yL+lCap);
      g.quadraticCurveTo(xpx+TILE*0.07,yL+lCap*0.42,xpx+TILE*0.30,yL);
    } else {
      g.moveTo(xL,yL);
    }
    if(rCap>0){
      g.lineTo(xpx+TILE*0.70,yR);
      g.quadraticCurveTo(xpx+TILE*0.93,yR+rCap*0.42,xR,yR+rCap);
    } else {
      g.lineTo(xR,yR);
    }
  }
  function drawWaterSegmentPath(g,xpx,TILE,sg,botPx){
    const yL=sg.yl, yR=sg.yr;
    const lTopY=yL+(sg.lCap||0), rTopY=yR+(sg.rCap||0);
    const lSoft=sg.lSoft||0, rSoft=sg.rSoft||0;
    const xL=xpx+lSoft;
    g.beginPath();
    drawWaterTopPath(g,xpx,TILE,sg,0);
    if(rSoft>0) g.quadraticCurveTo(xpx+TILE-rSoft*0.18,(rTopY+botPx)*0.5,xpx+TILE,botPx);
    else g.lineTo(xpx+TILE,botPx);
    g.lineTo(xpx,botPx);
    if(lSoft>0) g.quadraticCurveTo(xpx+lSoft*0.18,(lTopY+botPx)*0.5,xL,lTopY);
    else g.lineTo(xL,lTopY);
    g.closePath();
  }
  function drawOverlay(ctx,TILE,getTile,sx,sy,vx,vy,canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const tileVisible = (x,y)=> !visibleTile || visibleTile(x,y);
    const now=performance.now();
    const x0=sx-2, x1=sx+vx+2, n=x1-x0+1;
    const yTop=Math.max(WORLD_TOP, sy-6), yBot=Math.min(WORLD_BOTTOM-1, sy+vy+6);
    if(n<=0 || yBot<yTop) return;
    const ox=x0*TILE, oy=yTop*TILE;
    const wpx=n*TILE, hpx=(yBot-yTop+1)*TILE;
    const pixelScale=overlayPixelScale(ctx,wpx,hpx);
    const swpx=Math.max(1,Math.ceil(wpx*pixelScale));
    const shpx=Math.max(1,Math.ceil(hpx*pixelScale));
    const reuseWindow=overlayReuseWindowMs();
    const canReuse=!!(offCanvas && overlayCache.valid &&
      now-lastOverlayRefresh<reuseWindow &&
      overlayCache.x0===x0 && overlayCache.yTop===yTop && overlayCache.n===n && overlayCache.yBot===yBot &&
      overlayCache.wpx===wpx && overlayCache.hpx===hpx &&
      overlayCache.pixelScale===pixelScale && overlayCache.swpx===swpx && overlayCache.shpx===shpx);
    if(canReuse){
      overlayCacheHits++;
      ctx.save();
      ctx.imageSmoothingEnabled=true;
      ctx.drawImage(offCanvas, 0,0, swpx,shpx, ox,oy, wpx,hpx);
      ctx.restore();
      return;
    }
    const dtMs=Math.min(50, Math.max(4, now-lastOverlayTime)); lastOverlayTime=now;
    const dt=dtMs/1000, tSec=now/1000;
    frameNo++;
    const SIMPLE = n>220; // zoomed far out: keep waves + body, drop the expensive garnish

    // 1. Scan visible columns into contiguous water segments
    const cols=new Array(n); let anyWater=false;
    for(let xi=0; xi<n; xi++){
      const wx=x0+xi; let segs=null; let y=yTop;
      while(y<=yBot){
        if(getTile(wx,y)===T.WATER && tileVisible(wx,y)){
          const top=y; while(y<=yBot && getTile(wx,y)===T.WATER && tileVisible(wx,y)) y++;
          (segs||(segs=[])).push({top, bot:y-1, open: top>0 && isAir(getTile(wx,top-1)), surf:0, yl:0, yr:0});
        } else y++;
      }
      if(segs){ anyWater=true; cols[xi]=segs; }
    }

    // 2. Surface springs: create/realign for visible surfaces, apply kicks, integrate, couple
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs || !segs[0].open) continue;
      const s0=segs[0], wx=x0+xi;
      let spr=springs.get(wx);
      if(!spr){ springs.set(wx,{o:0,v:0,y:s0.top,seen:frameNo}); }
      else {
        if(spr.y!==s0.top){
          // Water level moved a whole tile (flow/leveling): keep the visual height and let
          // the spring relax to the new rest level — reads as a smooth rise/settle.
          // Clamp tightly: a generous carry makes spill fronts bulge unnaturally.
          let carry=spr.o + (spr.y - s0.top)*TILE;
          const lim=TILE*0.6;
          if(carry>lim) carry=lim; else if(carry<-lim) carry=-lim;
          spr.o=carry; spr.y=s0.top;
        }
        spr.seen=frameNo;
      }
    }
    if(pendingImpulse.size){
      for(const [px,imp] of pendingImpulse){
        const spr=springs.get(px);
        if(spr){ spr.v+=imp; pendingImpulse.delete(px); }
      }
      if(pendingImpulse.size>256) pendingImpulse.clear(); // kicks far offscreen eventually expire
    }
    for(const [px,spr] of springs){
      spr.v += (-SPR_K*spr.o - SPR_D*spr.v)*dt;
      spr.o += spr.v*dt;
      if(spr.o>TILE*1.4) spr.o=TILE*1.4; else if(spr.o<-TILE*1.4) spr.o=-TILE*1.4;
      if(spr.seen!==frameNo && frameNo-spr.seen>240 && Math.abs(spr.o)<0.2 && Math.abs(spr.v)<0.4) springs.delete(px);
    }
    for(let pass=0; pass<2; pass++){
      for(let xi=1; xi<n; xi++){
        const a=springs.get(x0+xi-1), b=springs.get(x0+xi);
        if(!a || !b || Math.abs(a.y-b.y)>2) continue;
        const d=(a.o-b.o)*SPR_SPREAD*dt*0.5;
        a.v-=d; b.v+=d;
      }
    }

    // 3. Visual surface height per segment (spring + layered ambient swell)
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs) continue;
      const wx=x0+xi;
      const s0=segs[0];
      let px=s0.top*TILE;
      if(s0.open){
        const spr=springs.get(wx);
        const amb=Math.sin(wx*0.5+tSec*1.6)*1.1 + Math.sin(wx*0.17-tSec*0.8)*0.8 + Math.sin(wx*1.7+tSec*2.8)*0.5 + Math.sin(wx*0.06+tSec*0.45)*1.1;
        px += amb + (spr? spr.o : 0);
        const lo=s0.top*TILE - TILE*0.9; if(px<lo) px=lo;          // never above the air tile
        const hi=s0.bot*TILE + TILE*0.5; if(px>hi) px=hi;          // never below own body
      }
      s0.surf=px;
      for(let si=1; si<segs.length; si++){
        const sg=segs[si];
        sg.surf=sg.top*TILE + (sg.open? Math.sin(wx*0.9+tSec*2.1)*1.2 : 0);
      }
    }

    if(!anyWater && !streams.length){ overlayCache.valid=false; return; }

    // 4. Offscreen layer (world-pixel space) — base shape, then clipped effects
    if(!offCanvas){ offCanvas=document.createElement('canvas'); offCtx=offCanvas.getContext('2d'); }
    if(offCanvas.width<swpx || offCanvas.height<shpx || offCanvas.width>swpx*1.6 || offCanvas.height>shpx*1.6){
      offCanvas.width=swpx;
      offCanvas.height=shpx;
      overlayCache.valid=false;
    }
    const g=offCtx;
    g.imageSmoothingEnabled=true;
    g.setTransform(1,0,0,1,0,0);
    g.globalCompositeOperation='source-over';
    g.clearRect(0,0,offCanvas.width,offCanvas.height);
    g.setTransform(pixelScale,0,0,pixelScale,-ox*pixelScale,-oy*pixelScale);

    // 4a. Base body: per-column water shapes with shared edge heights.
    // Exposed top edges get rounded caps so lakes stop as water, not square UI blocks.
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs) continue;
      const wx=x0+xi, xpx=wx*TILE;
      for(let si=0; si<segs.length; si++){
        const sg=segs[si];
        let yL=sg.surf, yR=sg.surf;
        let joinedL=false, joinedR=false;
        let lf=null, rt=null;
        if(si===0){
          // Join only near-equal surfaces (≤1 row): averaging across taller steps turns
          // spill fronts and shore lips into unnatural bulges
          lf=xi>0? cols[xi-1] : null; rt=xi<n-1? cols[xi+1] : null;
          if(lf && Math.abs(lf[0].top-sg.top)<=1){ yL=(lf[0].surf+sg.surf)/2; joinedL=true; }
          if(rt && Math.abs(rt[0].top-sg.top)<=1){ yR=(rt[0].surf+sg.surf)/2; joinedR=true; }
        }
        sg.yl=yL; sg.yr=yR;
        sg.lCap=sg.open && !joinedL ? TILE*0.42 : 0;
        sg.rCap=sg.open && !joinedR ? TILE*0.42 : 0;
        const lOpenSide=sg.open && !joinedL && (isAir(getTile(wx-1,sg.top)) || (lf && Math.abs(lf[0].top-sg.top)>1));
        const rOpenSide=sg.open && !joinedR && (isAir(getTile(wx+1,sg.top)) || (rt && Math.abs(rt[0].top-sg.top)>1));
        sg.lSoft=lOpenSide ? TILE*0.14 : 0;
        sg.rSoft=rOpenSide ? TILE*0.14 : 0;
        const botPx=(sg.bot+1)*TILE;
        const topMin=Math.min(yL,yR,sg.surf);
        const grad=g.createLinearGradient(0,topMin,0,topMin+TILE*9);
        if(sg.open){
          grad.addColorStop(0,'rgba(120,198,252,0.58)');
          grad.addColorStop(0.16,'rgba(56,140,238,0.72)');
          grad.addColorStop(1,'rgba(8,28,86,0.93)');
        } else { // sealed under rock: murkier, darker
          grad.addColorStop(0,'rgba(46,108,206,0.72)');
          grad.addColorStop(1,'rgba(6,22,70,0.93)');
        }
        g.fillStyle=grad;
        drawWaterSegmentPath(g,xpx,TILE,sg,botPx);
        g.fill();
      }
    }

    // 4b. Waterfall streams (part of the base shape so the clipped effects also catch them)
    if(streams.length){
      for(let i=streams.length-1;i>=0;i--){
        const st=streams[i]; st.ttl-=dt;
        if(st.ttl<=0){ streams.splice(i,1); continue; }
        if(st.x<x0-1 || st.x>x1+1) continue;
        let streamVisible=false;
        for(let yy=Math.max(yTop,st.y0|0); yy<=Math.min(yBot,st.y1|0); yy++){
          if(tileVisible(st.x,yy)){ streamVisible=true; break; }
        }
        if(!streamVisible) continue;
        const fade=Math.min(1, st.ttl/0.18);
        const xc=st.x*TILE+TILE/2;
        const yA=Math.max(oy, st.y0*TILE), yB=Math.min(oy+hpx, (st.y1+1)*TILE);
        if(yB<=yA) continue;
        const w=TILE*0.55*fade;
        const wob=Math.sin(tSec*9+st.x*1.7)*1.5;
        const sgGrad=g.createLinearGradient(0,yA,0,yB);
        sgGrad.addColorStop(0,'rgba(160,210,255,0.45)');
        sgGrad.addColorStop(1,'rgba(110,180,250,0.75)');
        g.fillStyle=sgGrad;
        g.fillRect(xc-w/2+wob, yA, w, yB-yA);
        g.fillStyle='rgba(225,242,255,0.40)';
        g.fillRect(xc-w*0.18+wob, yA, w*0.36, yB-yA);
        // falling streak highlights
        g.fillStyle='rgba(255,255,255,0.55)';
        const span=yB-yA;
        for(let k2=0;k2<4;k2++){
          const dy2=((tSec*240)+(k2*53)+(st.x*31))%span;
          g.fillRect(xc-2+Math.sin(k2*2.4+st.x)*2.2+wob, yA+dy2, 2.6, 9);
        }
        // impact mist + crown
        const ir=TILE*(0.55+0.3*Math.sin(tSec*11+st.x))*fade;
        g.fillStyle='rgba(255,255,255,'+(0.16*fade).toFixed(3)+')';
        g.beginPath(); g.ellipse(xc, yB, ir*1.5, ir*0.55, 0, 0, Math.PI*2); g.fill();
        g.strokeStyle='rgba(255,255,255,'+(0.22*fade).toFixed(3)+')'; g.lineWidth=1.5;
        g.beginPath(); g.ellipse(xc, yB, ir*1.1, ir*0.4, 0, Math.PI, Math.PI*2); g.stroke();
        try{ const p=MM.particles; if(p && p.spawnBubble && Math.random()<0.12) p.spawnBubble(xc+(Math.random()-0.5)*TILE, yB+TILE*0.6); }catch(e){}
      }
    }

    // 4c. Effects clipped to the water shape
    if(anyWater){
      g.globalCompositeOperation='source-atop';
      let causticBudget = SIMPLE? 0 : 1000;
      for(let xi=0; xi<n; xi++){
        const segs=cols[xi]; if(!segs) continue;
        const wx=x0+xi, xpx=wx*TILE;
        // caustic web: interference of two traveling sine fields, fading with depth.
        // Short dim dashes — wide bright rectangles read as floating UI chips at zoom.
        if(causticBudget>0){
          for(let si=0; si<segs.length && causticBudget>0; si++){
            const sg=segs[si]; if(!sg.open || sg.bot-sg.top<2) continue;
            const kMax=Math.min(6, sg.bot-sg.top+1);
            for(let k2=2;k2<=kMax;k2++){
              const v1=Math.sin(wx*0.81+tSec*2.05+k2*1.31)*Math.sin(wx*0.353-tSec*1.37+k2*0.91);
              if(v1>0.55){
                const a=(v1-0.55)*0.22/(1+k2*0.35);
                const h2=hash32(wx,k2);
                g.fillStyle='rgba(190,232,255,'+a.toFixed(3)+')';
                g.fillRect(xpx+2+(h2%11), sg.surf+k2*TILE+((h2>>3)%11), 5+(h2&7), 1.6);
                causticBudget--;
              }
            }
          }
        }
        const s0=segs[0]; if(!s0.open) continue;
        // drifting light shafts in deeper open water
        if(!SIMPLE && (s0.bot-s0.top)>=3){
          const sh=Math.sin(wx*0.13+tSec*0.35)*Math.sin(wx*0.041-tSec*0.11+1.7);
          if(sh>0.55){
            g.fillStyle='rgba(235,248,255,'+((sh-0.55)*0.16).toFixed(3)+')';
            g.beginPath();
            g.moveTo(xpx,s0.surf); g.lineTo(xpx+TILE,s0.surf);
            g.lineTo(xpx+TILE+TILE*1.6, s0.surf+TILE*6.5); g.lineTo(xpx+TILE*1.6, s0.surf+TILE*6.5);
            g.closePath(); g.fill();
          }
        }
        // surface sheen: bright crest + soft underglow band
        g.strokeStyle='rgba(255,255,255,0.38)'; g.lineWidth=1.6;
        g.beginPath(); drawWaterTopPath(g,xpx,TILE,s0,0); g.stroke();
        g.strokeStyle='rgba(170,215,255,0.10)'; g.lineWidth=4;
        g.beginPath(); drawWaterTopPath(g,xpx,TILE,s0,3); g.stroke();
        // whitecap: agitated water (steep slope) breaks into foam along the crest
        const slope=Math.abs(s0.yr-s0.yl);
        if(slope>2.2){
          const fa=Math.min(0.55, (slope-2.2)*0.16);
          g.strokeStyle='rgba(255,255,255,'+fa.toFixed(3)+')'; g.lineWidth=3;
          g.beginPath(); drawWaterTopPath(g,xpx,TILE,s0,-0.5); g.stroke();
        }
        if(!SIMPLE){
          // sparkle glints twinkling along the surface (soft dots, not literal crosses)
          const step2=Math.floor(tSec*2.2), h3=hash32(wx,step2);
          if(h3%23===0){
            const a=Math.sin((tSec*2.2-step2)*Math.PI);
            const gx=xpx+((h3>>4)%TILE), gy=s0.surf+1+((h3>>8)%4);
            g.fillStyle='rgba(255,255,255,'+(a*0.5).toFixed(3)+')';
            g.fillRect(gx-1.5,gy-0.5,4,1.6);
            g.fillStyle='rgba(255,255,255,'+(a*0.85).toFixed(3)+')';
            g.fillRect(gx-0.5,gy-0.5,1.6,1.6);
          }
          // shoreline foam wisps
          const lT=getTile(wx-1,s0.top), rT=getTile(wx+1,s0.top);
          const lShore=!isAir(lT) && lT!==T.WATER, rShore=!isAir(rT) && rT!==T.WATER;
          if(lShore||rShore){
            const bob=Math.sin(tSec*3.1+wx*1.3)*1.4;
            g.fillStyle='rgba(255,255,255,'+(0.16+0.08*Math.sin(tSec*4+wx)).toFixed(3)+')';
            if(lShore) g.fillRect(xpx+TILE*0.08, s0.yl+Math.max(0,s0.lCap*0.25)-1+bob*0.5, TILE*0.30, 3);
            if(rShore) g.fillRect(xpx+TILE*0.62, s0.yr+Math.max(0,s0.rCap*0.25)-1-bob*0.5, TILE*0.30, 3);
          }
          // sparse ambient bubbles drifting up through deep water
          if((s0.bot-s0.top)>=4 && Math.random()<0.0022*(dtMs/16)){
            try{ const p=MM.particles; if(p && p.spawnBubble) p.spawnBubble((wx+0.2+Math.random()*0.6)*TILE, (s0.top+1+Math.random()*(s0.bot-s0.top-1))*TILE); }catch(e){}
          }
        }
      }
      g.globalCompositeOperation='source-over';
    }

    // 5. Composite the layer in one blend (smoothing on: soft edges under zoom)
    ctx.save();
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(offCanvas, 0,0, swpx,shpx, ox,oy, wpx,hpx);
    ctx.restore();
    lastOverlayRefresh=now;
    overlayFullRenders++;
    overlayCache={valid:true,x0,yTop,n,yBot,wpx,hpx,pixelScale,swpx,shpx};
  }

  const RESTORE_ACTIVE_CAP = 4000;
  const RESTORE_LATERAL_CAP = 1200;
  const RESTORE_MATERIAL_CAP = 1200;
  function validRestoreCoord(x,y){
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x)<10000000 && y>=WORLD_TOP && y<WORLD_BOTTOM;
  }
  function parseRestoreKey(raw){
    let x,y;
    if(Array.isArray(raw) && raw.length===2){ x=raw[0]; y=raw[1]; }
    else if(typeof raw==='string'){
      const comma=raw.indexOf(',');
      if(comma<=0) return null;
      x=+raw.slice(0,comma); y=+raw.slice(comma+1);
    } else return null;
    if(!validRestoreCoord(x,y)) return null;
    return Math.floor(x)+','+Math.floor(y);
  }
  function clampFinite(v,min,max,fallback){
    return Number.isFinite(v) ? Math.max(min,Math.min(max,v)) : fallback;
  }
  function reset(){
    active.clear();
    pressureSeeds.clear();
    lateralCooldown.clear();
    springs.clear();
    pendingImpulse.clear();
    streams.length=0;
    chunkWakes.length=0;
    overlayCache={valid:false};
    overlayCacheHits=0;
    overlayFullRenders=0;
    lastOverlayRefresh=0;
    passiveScanOffset=0;
    passiveScanAcc=0;
    passiveScanLastColumns=0;
    passiveScanTotalColumns=0;
    lateralAcc=0;
    pressureIntervalCurrent=PRESSURE_INTERVAL_BASE;
    pressureAcc=0;
    pressureLastMs=0;
    pressureMaxMs=0;
    reactionBudget=0;
    wetSand.clear();
    wetClay.clear();
    dryMud.clear();
    dryClay.clear();
    materialScanAcc=0;
    materialScanOffset=0;
  }
  function snapshot(){
    try{
      const activeList=[];
      for(const raw of active){
        const kk=parseRestoreKey(raw);
        if(!kk) continue;
        const ix=kk.indexOf(',');
        activeList.push([+kk.slice(0,ix),+kk.slice(ix+1)]);
        if(activeList.length>=RESTORE_ACTIVE_CAP) break;
      }
      const lateral=[];
      for(const [x,val] of lateralCooldown){
        if(!Number.isFinite(x) || !Number.isFinite(val) || val<=0) continue;
        lateral.push([Math.floor(x),Math.max(0,Math.min(5,val))]);
        if(lateral.length>=RESTORE_LATERAL_CAP) break;
      }
      const wet=[];
      for(const rec of wetSand.values()){
        if(!rec || !validRestoreCoord(rec.x,rec.y)) continue;
        wet.push([Math.floor(rec.x),Math.floor(rec.y),clampFinite(rec.wet,0,20,0)]);
        if(wet.length>=RESTORE_MATERIAL_CAP) break;
      }
      const clayWet=[];
      for(const rec of wetClay.values()){
        if(!rec || !validRestoreCoord(rec.x,rec.y)) continue;
        clayWet.push([Math.floor(rec.x),Math.floor(rec.y),clampFinite(rec.wet,0,20,0)]);
        if(clayWet.length>=RESTORE_MATERIAL_CAP) break;
      }
      const dry=[];
      for(const rec of dryMud.values()){
        if(!rec || !validRestoreCoord(rec.x,rec.y)) continue;
        dry.push([Math.floor(rec.x),Math.floor(rec.y),clampFinite(rec.dry,0,30,0)]);
        if(dry.length>=RESTORE_MATERIAL_CAP) break;
      }
      const clayDry=[];
      for(const rec of dryClay.values()){
        if(!rec || !validRestoreCoord(rec.x,rec.y)) continue;
        clayDry.push([Math.floor(rec.x),Math.floor(rec.y),clampFinite(rec.dry,0,WET_CLAY_DRY_PROGRESS_CAP,0)]);
        if(clayDry.length>=RESTORE_MATERIAL_CAP) break;
      }
      return {
        v:2,
        active:activeList,
        lateral,
        wet,
        clayWet,
        dry,
        clayDry,
        passiveScanOffset:Number.isFinite(passiveScanOffset)?Math.floor(passiveScanOffset):0,
        passiveScanAcc:clampFinite(passiveScanAcc,0,PASSIVE_SCAN_INTERVAL*PASSIVE_SCAN_BURST_LIMIT,0),
        pressureIntervalCurrent:clampFinite(pressureIntervalCurrent,PRESSURE_INTERVAL_MIN,PRESSURE_INTERVAL_MAX,PRESSURE_INTERVAL_BASE),
        pressureAcc:clampFinite(pressureAcc,0,10,0),
        lateralAcc:clampFinite(lateralAcc,0,5,0),
        materialScanOffset:Number.isFinite(materialScanOffset)?Math.floor(materialScanOffset):0,
        materialScanAcc:clampFinite(materialScanAcc,0,MATERIAL_SCAN_INTERVAL*3,0)
      };
    }catch(e){ return null; }
  }
  function restore(s){ if(!s||typeof s!=='object') return; reset(); try{
    if(Array.isArray(s.active)){
      for(const a of s.active){
        const kk=parseRestoreKey(a);
        if(kk && active.size<RESTORE_ACTIVE_CAP) active.add(kk);
      }
    }
    // v1 saves carried ripple visuals; replay them as gentle wave kicks
    if(Array.isArray(s.ripples)) for(const r of s.ripples){ if(r && Number.isFinite(r.L) && Number.isFinite(r.R)) disturb(Math.floor((r.L+r.R)/2), 60); }
    if(Array.isArray(s.lateral)){
      for(const row of s.lateral){
        if(!Array.isArray(row) || row.length<2 || lateralCooldown.size>=RESTORE_LATERAL_CAP) continue;
        const x=Number(row[0]), val=Number(row[1]);
        if(Number.isFinite(x) && Math.abs(x)<10000000 && Number.isFinite(val) && val>0) lateralCooldown.set(Math.floor(x),Math.max(0,Math.min(5,val)));
      }
    }
    if(Array.isArray(s.wet)){
      for(const row of s.wet){
        if(!Array.isArray(row) || row.length<2 || wetSand.size>=RESTORE_MATERIAL_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), wet=Number(row[2]);
        if(validRestoreCoord(x,y)) wetSand.set(Math.floor(x)+','+Math.floor(y),{x:Math.floor(x),y:Math.floor(y),wet:clampFinite(wet,0,20,0)});
      }
    }
    if(Array.isArray(s.clayWet)){
      for(const row of s.clayWet){
        if(!Array.isArray(row) || row.length<2 || wetClay.size>=RESTORE_MATERIAL_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), wet=Number(row[2]);
        if(validRestoreCoord(x,y)) wetClay.set(Math.floor(x)+','+Math.floor(y),{x:Math.floor(x),y:Math.floor(y),wet:clampFinite(wet,0,20,0)});
      }
    }
    if(Array.isArray(s.dry)){
      for(const row of s.dry){
        if(!Array.isArray(row) || row.length<2 || dryMud.size>=RESTORE_MATERIAL_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), dry=Number(row[2]);
        if(validRestoreCoord(x,y)) dryMud.set(Math.floor(x)+','+Math.floor(y),{x:Math.floor(x),y:Math.floor(y),dry:clampFinite(dry,0,30,0)});
      }
    }
    if(Array.isArray(s.clayDry)){
      for(const row of s.clayDry){
        if(!Array.isArray(row) || row.length<2 || dryClay.size>=RESTORE_MATERIAL_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), dry=Number(row[2]);
        if(validRestoreCoord(x,y)) dryClay.set(Math.floor(x)+','+Math.floor(y),{x:Math.floor(x),y:Math.floor(y),dry:clampFinite(dry,0,WET_CLAY_DRY_PROGRESS_CAP,0)});
      }
    }
    if(Number.isFinite(s.passiveScanOffset)) passiveScanOffset=Math.max(0,Math.floor(s.passiveScanOffset));
    if(Number.isFinite(s.passiveScanAcc)) passiveScanAcc=clampFinite(s.passiveScanAcc,0,PASSIVE_SCAN_INTERVAL*PASSIVE_SCAN_BURST_LIMIT,0);
    if(Number.isFinite(s.pressureIntervalCurrent)) pressureIntervalCurrent=clampFinite(s.pressureIntervalCurrent,PRESSURE_INTERVAL_MIN,PRESSURE_INTERVAL_MAX,PRESSURE_INTERVAL_BASE);
    if(Number.isFinite(s.pressureAcc)) pressureAcc=clampFinite(s.pressureAcc,0,10,0);
    if(Number.isFinite(s.lateralAcc)) lateralAcc=clampFinite(s.lateralAcc,0,5,0);
    if(Number.isFinite(s.materialScanOffset)) materialScanOffset=Math.max(0,Math.floor(s.materialScanOffset));
    if(Number.isFinite(s.materialScanAcc)) materialScanAcc=clampFinite(s.materialScanAcc,0,MATERIAL_SCAN_INTERVAL*3,0);
  }catch(e){} }

  // ---- Hydrostatic equalization (true communicating vessels) ----
  // For each seeded body: flood-fill the connected loaded water body (or a bounded
  // window for oversized/spilling bodies), flood-fill the reachable void container
  // without crossing above its own highest surface, then move volume toward the
  // bottom-up equilibrium fill of that container. Pressure emerges naturally through
  // U-bends, risers, galleries, and mined bores. Open-air shore lips still hold, but
  // covered surface mouths and one-tile-low water columns participate so lakes can
  // flood caves without leaving dry notches. Volume is conserved exactly; moves are
  // rate-limited so large equalizations read as flow over a second or two.
  const EQ_WINDOW=40;       // half-width for the oversized-body fallback window
  const EQ_GLOBAL_BODY_SOFT_CAP=1600; // larger bodies use the bounded window path
  const EQ_BODY_CAP=6500;   // safety caps for the two flood fills
  const EQ_VOID_CAP=9000;
  const EQ_RATE=72;         // max units moved per body per pass
  const EQ_BODIES=3;        // bodies equalized per pass

  function runPressureLeveling(getTile,setTile){
    const world = (typeof window!=='undefined' && window.MM && MM.world) ? MM.world : null;
    const readTile = world && typeof world.peekTile==='function'
      ? (x,y)=>world.peekTile(x,y,T.STONE)
      : getTile;
    const isPressureSillCell=(x,y)=>{
      if(readTile(x,y)!==T.WATER) return false;
      const above=readTile(x,y-1);
      if(above===T.WATER) return false;
      if(!isAir(above) && !isLeaf(above)) return false;
      const below=readTile(x,y+1);
      return below!==T.WATER && !canFill(below);
    };
    const isOpenLipWall=(x,y,dx)=>{
      const wall=readTile(x+dx,y);
      if(wall===T.WATER || canFill(wall)) return false;
      const over=readTile(x+dx,y-1);
      if(!isAir(over) && over!==T.WATER && !isLeaf(over)) return false;
      let receivingWater=false;
      for(let yy=y-1; yy<=Math.min(WORLD_BOTTOM-1,y+6); yy++){
        if(readTile(x+dx*2,yy)===T.WATER){ receivingWater=true; break; }
      }
      if(!receivingWater) return false;
      return true;
    };
    const pressureConnected=(x,y,nx,ny)=>{
      // Surface water crossing the top of a solid lip/tree trunk is overflow, not
      // a submerged pipe. Let local flow spill it across, but do not let the
      // pressure solver equalize both basins below the lip.
      if(ny===y){
        const aSill=isPressureSillCell(x,y), bSill=isPressureSillCell(nx,ny);
        const aDeep=readTile(x,y+1)===T.WATER, bDeep=readTile(nx,ny+1)===T.WATER;
        if((aSill && bDeep) || (bSill && aDeep)) return false;
      }
      return true;
    };
    const collectBody = (sx,sy,windowLimit,softCap)=>{
      const seedKey=sx+','+sy;
      const bodySet=new Set([seedKey]);
      const stack=[seedKey];
      let minSurf=WORLD_BOTTOM, overflow=false;
      while(stack.length){
        const ck=stack.pop(); const ci=ck.indexOf(','); const cx=+ck.slice(0,ci), cy=+ck.slice(ci+1);
        if(cy<minSurf) minSurf=cy;
        for(let d=0;d<4;d++){
          const nx=cx+(d===0?-1:d===1?1:0), ny=cy+(d===2?-1:d===3?1:0);
          if(windowLimit!=null && Math.abs(nx-sx)>windowLimit) continue;
          if(ny<WORLD_TOP || ny>=WORLD_BOTTOM) continue;
          const nk=nx+','+ny;
          if(bodySet.has(nk) || readTile(nx,ny)!==T.WATER) continue;
          if(!pressureConnected(cx,cy,nx,ny)) continue;
          bodySet.add(nk); stack.push(nk);
          if(bodySet.size>EQ_BODY_CAP || (softCap && bodySet.size>softCap)){ overflow=true; stack.length=0; break; }
        }
      }
      return {bodySet,minSurf,overflow,windowLimit};
    };
    const bodyHasOpenSpill = (bodySet)=>{
      for(const ck of bodySet){
        const ci=ck.indexOf(','); const x=+ck.slice(0,ci), y=+ck.slice(ci+1);
        if(y+1<WORLD_BOTTOM && canFill(readTile(x,y+1))) return true;
        for(const dx of [-1,1]){
          if(y+1<WORLD_BOTTOM && canFill(readTile(x+dx,y)) && canFill(readTile(x+dx,y+1))) return true;
        }
      }
      return false;
    };
    const seedSet=new Set(active); for(const kk of pressureSeeds) seedSet.add(kk); pressureSeeds.clear();
    const seeds=[...seedSet]; if(!seeds.length) return null; seeds.sort();
    const processed=new Set(); // cells of bodies already handled this pass
    const touchedXs=new Set(); let variance=null; let hadTransfers=false; let bodies=0;
    for(const key of seeds){
      if(bodies>=EQ_BODIES) break;
      if(processed.has(key)) continue;
      const ci0=key.indexOf(','); const sx=+key.slice(0,ci0), sy=+key.slice(ci0+1);
      if(readTile(sx,sy)!==T.WATER) continue;
      // 1. connected water body (4-neighbor flood fill). Try the whole loaded body
      // first so wide lakes truly level; if it is too large, fall back to the old
      // local window so oceans and mega-caverns still get bounded incremental work.
      let bodyInfo=collectBody(sx,sy,null,EQ_GLOBAL_BODY_SOFT_CAP);
      if(bodyInfo.overflow || bodyHasOpenSpill(bodyInfo.bodySet)) bodyInfo=collectBody(sx,sy,EQ_WINDOW);
      const {bodySet,minSurf,overflow,windowLimit}=bodyInfo;
      for(const bk of bodySet) processed.add(bk);
      bodies++;
      if(overflow || bodySet.size<2) continue;
      // 2. container: void reachable below the body's highest surface. At the surface
      // row itself, only covered mouths / existing lower water columns are admitted:
      // open dry shore remains a wall, while cave lips and one-tile-low water notches
      // can level.
      const floorRow=minSurf+1;
      const contSet=new Set(bodySet); const q=[...bodySet]; let voidOver=false;
      while(q.length){
        const ck=q.pop(); const ci=ck.indexOf(','); const cx=+ck.slice(0,ci), cy=+ck.slice(ci+1);
        for(let d=0;d<4;d++){
          const nx=cx+(d===0?-1:d===1?1:0), ny=cy+(d===2?-1:d===3?1:0);
          if(windowLimit!=null && Math.abs(nx-sx)>windowLimit) continue;
          if(ny<minSurf || ny>=WORLD_BOTTOM) continue;
          const nk=nx+','+ny;
          if(contSet.has(nk) || !canFill(readTile(nx,ny))) continue;
          if(ny<floorRow && !surfaceVoidCanLevel(nx,ny,readTile)) continue;
          contSet.add(nk); q.push(nk);
          if(contSet.size>EQ_VOID_CAP){ voidOver=true; q.length=0; break; }
        }
      }
      if(voidOver) continue;
      // 3. bottom-up equilibrium fill of the container with the body's volume
      const byRow=new Map();
      for(const ck of contSet){ const ci=ck.indexOf(','); const x=+ck.slice(0,ci), y=+ck.slice(ci+1); let a=byRow.get(y); if(!a){ a=[]; byRow.set(y,a); } a.push(x); }
      const rowsDesc=[...byRow.keys()].sort((a,b)=>b-a);
      let vol=bodySet.size;
      const target=new Set();
      for(const y of rowsDesc){
        if(vol<=0) break;
        const xs=byRow.get(y);
        if(xs.length<=vol){ for(const x of xs) target.add(x+','+y); vol-=xs.length; }
        else {
          // Partial surface row: covered mouths are preferred so caves flood instead
          // of leaving a dry notch; otherwise keep existing cells for stability.
          xs.sort((a,b)=>{
            const ak=a+','+y, bk=b+','+y;
            const ac=surfaceVoidCanLevel(a,y,readTile) && !isAir(readTile(a,y-1)) ? 0 : 1;
            const bc=surfaceVoidCanLevel(b,y,readTile) && !isAir(readTile(b,y-1)) ? 0 : 1;
            const aw=bodySet.has(ak)?0:1, bw=bodySet.has(bk)?0:1;
            return ac-bc || aw-bw || a-b;
          });
          for(let i=0;i<vol;i++) target.add(xs[i]+','+y);
          vol=0;
        }
      }
      // 4. rate-limited move: drain the highest surplus cells into the deepest deficits.
      // Sources clear top-down and destinations fill bottom-up, so every intermediate
      // state is gravity-consistent and each unit moved conserves volume exactly.
      let spillFloor=WORLD_BOTTOM;
      for(const bk of bodySet){
        const ci=bk.indexOf(','); const bx=+bk.slice(0,ci), by=+bk.slice(ci+1);
        for(const dx of [-1,1]){
          const nx=bx+dx;
          if(isPressureSillCell(nx,by) && readTile(bx,by+1)===T.WATER) spillFloor=Math.min(spillFloor,by+1);
          if(isOpenLipWall(bx,by,dx)) spillFloor=Math.min(spillFloor,by);
        }
      }
      const sources=[]; const dests=[];
      const rowOf=(s)=>+s.slice(s.indexOf(',')+1);
      for(const bk of bodySet){ if(!target.has(bk) && rowOf(bk)<spillFloor) sources.push(bk); }
      for(const tk of target){ if(!bodySet.has(tk)) dests.push(tk); }
      if(!sources.length || !dests.length) continue; // already at equilibrium
      sources.sort((a,b)=> rowOf(a)-rowOf(b) || a.localeCompare(b)); // highest first
      dests.sort((a,b)=> rowOf(b)-rowOf(a) || a.localeCompare(b));   // deepest first
      const K=Math.min(EQ_RATE, sources.length, dests.length);
      for(let i=0;i<K;i++){
        const sk=sources[i], dk=dests[i];
        const sci=sk.indexOf(','); const sxx=+sk.slice(0,sci), syy=+sk.slice(sci+1);
        const dci=dk.indexOf(','); const dxx=+dk.slice(0,dci), dyy=+dk.slice(dci+1);
        setTile(sxx,syy,T.AIR); writeExternalTile(dxx,dyy,T.WATER,getTile,setTile);
        mark(dxx,dyy); markNeighbors(active,dxx,dyy); markNeighbors(active,sxx,syy);
        touchedXs.add(sxx); touchedXs.add(dxx);
      }
      if(K>0){
        hadTransfers=true;
        const spread=Math.min(12,K); if(variance==null || spread>variance) variance=spread;
      }
    }
    return {touchedXs, variance, hadTransfers};
  }

  function metrics(){ return {active:active.size, springs:springs.size, streams:streams.length, wetSand:wetSand.size, wetClay:wetClay.size, dryMud:dryMud.size, dryClay:dryClay.size, passiveScanColumns:passiveScanLastColumns, pressureMs:+pressureLastMs.toFixed(3), overlayCacheHits, overlayFullRenders, overlayReuseMs:+overlayReuseWindowMs().toFixed(2)}; }
  // Test/debug introspection (not used by the game loop)
  function _debug(){ return {active:[...active], seeds:[...pressureSeeds], cooldown:[...lateralCooldown.entries()], wetSand:[...wetSand.values()], wetClay:[...wetClay.values()], dryMud:[...dryMud.values()], dryClay:[...dryClay.values()], pressureAcc, pressureIntervalCurrent, pressureLastMs, pressureMaxMs, passiveScanAcc, passiveScanOffset, passiveScanLastColumns, passiveScanTotalColumns, materialScanAcc, materialScanOffset}; }

  MM.water = {update, addSource, drawOverlay, onTileChanged, onTilesChangedBatch, displaceAt, disturb, noteChunkGenerated, reset, snapshot, restore, metrics, _debug};
})();
// ESM export (progressive migration)
export const water = (typeof window!=='undefined' && window.MM) ? window.MM.water : undefined;
export default water;
