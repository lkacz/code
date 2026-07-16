// Dynamic water system: cellular fluid simulation + spring-based surface waves + layered FX.
//
// Simulation (sub-tile level, deterministic, volume conserving):
//   Every water cell holds an integer fill level of 1..UNITS (UNITS=10) — one unit is
//   1/10 of a block. A tile is T.WATER whenever it holds >=1 unit; partial levels live
//   in a sparse side map so tile storage, saves, and every external T.WATER consumer
//   keep working unchanged. Rules: downward compaction (no floating partial cells),
//   gravity drops, edge spills, same-row equalization in half-difference steps
//   (surfaces meet smoothly instead of in one-block walls), lateral downhill seeking,
//   and hydrostatic pressure leveling that fills a basin bottom-up in units so the
//   final surface is flat across the whole basin to within 1/10 of a block. Bodies too
//   large to flood-fill within budget get a 1D surface-band leveler instead, so oceans
//   still flatten globally (no window-boundary steps) and keep feeding open drains.
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
  // Sub-tile fill levels. UNITS per full block; `partial` holds only 1..UNITS-1
  // entries keyed by packed cell key — a T.WATER tile with no entry is full.
  const UNITS = 10;
  const partial = new Map(); // packed key -> 1..UNITS-1
  // Packed numeric cell key (shared with the pressure solver): the offset keeps it
  // non-negative for y-1 probes at WORLD_TOP; world spans <504 rows so 512 slots per
  // column cannot alias. Numeric keys avoid string churn on hot paths.
  const LPK = (x,y)=> x*512 + (y-WORLD_TOP+8);
  const active = new Set(); // packed LPK cell keys
  // Cells that settled laterally but may still need pressure leveling (consumed per pass)
  const pressureSeeds = new Set(); // packed LPK cell keys
  let passiveScanOffset = 0;
  const PASSIVE_SCAN_RADIUS = 240;
  const PASSIVE_SCAN_SPAN = PASSIVE_SCAN_RADIUS*2+1;
  const PASSIVE_SCAN_INTERVAL = 0.10;
  const PASSIVE_SCAN_BURST_LIMIT = 3;
  const PASSIVE_SCAN_COLS_IDLE = 64;
  const PASSIVE_SCAN_COLS_ACTIVE = 24;
  const PASSIVE_SCAN_COLS_BUSY = 8;
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
  // Round-robin cursor for the leveling pass (last packed seed key attempted):
  // keeps EQ_BODIES-per-pass budgets fair across the whole seeded span.
  let pressureSweepKey = -Infinity;
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
  const TOXIC_WATER_SECONDS_FALLBACK = 600; // one in-game day
  const SUN_DRY_MIN = 0.18;
  const wetSand = new Map(); // "x,y" -> {x,y,wet}
  const wetClay = new Map(); // "x,y" -> {x,y,wet}
  const dryMud = new Map();  // "x,y" -> {x,y,dry}
  const dryClay = new Map(); // "x,y" -> {x,y,dry}
  const toxicWater = new Map(); // packed key -> seconds until it clears back to ordinary water
  let materialScanAcc = 0;
  let materialScanOffset = 0;

  // ---------------- FX state ----------------
  const springs = new Map();        // x -> {o:px offset, v:px/s, y:surface tile row, seen:frame}
  const pendingImpulse = new Map(); // x -> accumulated velocity kick, applied when column renders
  const PENDING_IMPULSE_CAP = 256;
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
  // Hot-path sets (active/next/pressureSeeds) use packed numeric LPK keys: 'x,y'
  // strings allocated per mark/neighbor were thousands of short-lived allocations
  // per tick under flow, and their lexicographic sort dominated the tick order cost.
  // The y guard keeps out-of-world marks from aliasing another column's packed slot
  // (they were silent no-ops as strings, and stay no-ops here).
  const PK_MIN_Y=WORLD_TOP-4, PK_MAX_Y=WORLD_BOTTOM+4;
  function pkToStr(pk){ const x=Math.floor(pk/512); return x+','+(pk-x*512+WORLD_TOP-8); }
  function mark(x,y){ if(y>=PK_MIN_Y && y<=PK_MAX_Y) active.add(LPK(x,y)); }
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
  function dayLengthSeconds(){
    try{
      const c=MM.seasons && MM.seasons.constants;
      if(c && Number.isFinite(c.DAY_SECONDS) && c.DAY_SECONDS>0) return c.DAY_SECONDS;
    }catch(e){}
    return TOXIC_WATER_SECONDS_FALLBACK;
  }
  function toxicDuration(opts){
    const max=Math.max(1,dayLengthSeconds()*2);
    const raw=opts && Number.isFinite(opts.seconds) ? opts.seconds : dayLengthSeconds();
    return Math.max(0.1,Math.min(max,raw));
  }
  function toxicKey(x,y){ return LPK(Math.floor(x),Math.floor(y)); }
  function markToxicWaterCell(x,y,seconds){
    x=Math.floor(x); y=Math.floor(y);
    if(!validTile(x,y)) return false;
    const pk=toxicKey(x,y);
    const ttl=Number.isFinite(seconds) ? Math.max(0.1,seconds) : dayLengthSeconds();
    const had=toxicWater.has(pk);
    const prev=toxicWater.get(pk)||0;
    if(!had || ttl>prev+1){
      toxicWater.set(pk,ttl);
      invalidateOverlayCache();
    }
    return true;
  }
  function clearToxicWaterCell(x,y){
    const ok=toxicWater.delete(toxicKey(x,y));
    if(ok) invalidateOverlayCache();
    return ok;
  }
  function isToxicAt(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!validTile(x,y) || !toxicWater.has(toxicKey(x,y))) return false;
    return typeof getTile!=='function' || getSafe(getTile,x,y,T.STONE)===T.WATER;
  }
  function polluteAt(x,y,getTile,setTile,opts){
    x=Math.floor(x); y=Math.floor(y);
    if(!validTile(x,y) || typeof getTile!=='function') return false;
    const radius=Math.max(0,Math.min(6,Math.floor(Number.isFinite(opts && opts.radius)?opts.radius:0)));
    const ttl=toxicDuration(opts);
    let polluted=false;
    for(let dy=-radius; dy<=radius; dy++){
      for(let dx=-radius; dx<=radius; dx++){
        if(Math.abs(dx)+Math.abs(dy)>radius) continue;
        const wx=x+dx, wy=y+dy;
        if(!validTile(wx,wy)) continue;
        if(getSafe(getTile,wx,wy,T.STONE)!==T.WATER) continue;
        polluted = markToxicWaterCell(wx,wy,ttl) || polluted;
        wakeWaterCell(wx,wy,false);
        disturb(wx, opts && opts.source==='rotten_meat' ? 18 : 42);
      }
    }
    if(polluted) hurrySolver();
    return polluted;
  }
  function updateToxicWater(getTile,dt){
    if(!toxicWater.size) return;
    let changed=false;
    // Deleting the current entry / overwriting existing keys during Map iteration
    // is safe; the previous copy-spread allocated the whole map every tick.
    for(const [pk,ttl] of toxicWater){
      const x=Math.floor(pk/512), y=pk-x*512+WORLD_TOP-8;
      const alive=validTile(x,y) && getSafe(getTile,x,y,T.STONE)===T.WATER;
      const next=(Number.isFinite(ttl)?ttl:0)-dt;
      if(!alive || next<=0){
        toxicWater.delete(pk);
        changed=true;
      } else {
        toxicWater.set(pk,next);
      }
    }
    if(changed) invalidateOverlayCache();
  }
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
    const slotX=x+dx, outX=x+dx*2;
    if(!validDynamoSlot(slotX,y,getTile,'vertical')) return null;
    if(!canFill(getTile(outX,y))) return null;
    // A vertical dynamo is a cross-flow turbine. It may be driven either by
    // hydraulic head in a dam or by a real downhill discharge on its far side
    // (river / mill-race layout). Requiring one of those two pressure sources
    // prevents a motionless one-tile puddle on level ground from making power.
    const hasHydraulicHead=getTile(x,y-1)===T.WATER;
    const hasDownhillDischarge=y+1<WORLD_BOTTOM && canFill(getTile(outX,y+1));
    if(!hasHydraulicHead && !hasDownhillDischarge) return null;
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
  // Covered surface mouths (roofed one-tall tunnels at the waterline) must be filled by
  // the pressure solver while the edge cell stays connected to the source body — moving
  // units in directly can strand a droplet in the mouth and stall the fill. Open voids
  // are handled by unit equalization instead.
  function surfaceLevelTarget(x,y,dx,getTile){
    if(getTile(x,y)!==T.WATER || getTile(x,y-1)===T.WATER) return null;
    const nx=x+dx;
    if(!surfaceVoidCanLevel(nx,y,getTile)) return null;
    const covered=!isAir(getTile(nx,y-1)) && getTile(nx,y-1)!==T.WATER;
    if(!covered) return null;
    if(waterDepthFrom(x,y,getTile,32)<2) return null;
    return {x:nx,y,covered:true};
  }
  function canSurfaceLevel(x,y,getTile){
    return !!(surfaceLevelTarget(x,y,-1,getTile) || surfaceLevelTarget(x,y,1,getTile));
  }
  // Any pending sub-tile work at (x,y)? Used by wake scans and settle checks: a cell is
  // unsettled while water below it has headroom, a same-row water neighbor sits >=2
  // units lower, or >=2 of its units could spread into an adjacent open cell.
  function canEqualize(x,y,getTile){
    const lvl=levelUnits(getTile,x,y);
    if(lvl<=0) return false;
    if(y+1<WORLD_BOTTOM && getTile(x,y+1)===T.WATER && levelUnits(getTile,x,y+1)<UNITS) return true;
    for(const dx of [-1,1]){
      const nt=getTile(x+dx,y);
      if(nt===T.WATER){
        if(lvl-levelUnits(getTile,x+dx,y)>=2) return true;
      } else if(lvl>=2 && canFill(nt) && getTile(x,y-1)!==T.WATER){
        return true;
      }
    }
    return false;
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
      const lvl=levelUnits(getTile,sx,y);
      if(lvl<=0) continue;
      moveUnits(sx,y,x,y,lvl,getTile,setTile);
      next.add(LPK(x,y));
      markNeighbors(next,x,y);
      markNeighbors(next,sx,y);
      if(pressureSeeds.size<2000) pressureSeeds.add(LPK(x,y));
      pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.7);
      disturb(x, 36);
      return true;
    }
    return false;
  }
  function recordDynamoWater(x,slotY,getTile,units){
    if(slotY==null) return;
    const vol=(Number.isFinite(units)?units:UNITS)/UNITS;
    try{ if(MM.dynamo && MM.dynamo.recordFlow) MM.dynamo.recordFlow(x,slotY,T.WATER,vol,getTile); }catch(e){}
  }
  function recordDynamoSideWater(slotX,slotY,getTile,units){
    const vol=1.35*(Number.isFinite(units)?units:UNITS)/UNITS;
    try{ if(MM.dynamo && MM.dynamo.recordFlow) MM.dynamo.recordFlow(slotX,slotY,T.WATER,vol,getTile); }catch(e){}
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
  // ---- Sub-tile level accounting ----
  // levelUnits: current fill of a cell in units (0 = no water). Lazily purges stale
  // partial entries left behind when an external system overwrote the tile directly.
  function levelUnits(getTile,x,y){
    if(getSafe(getTile,x,y,T.STONE)!==T.WATER){
      partial.delete(LPK(x,y));
      return 0;
    }
    const v=partial.get(LPK(x,y));
    return v===undefined ? UNITS : v;
  }
  // setUnits: absolute write of a cell's fill, handling AIR<->WATER tile transitions
  // (and their gas/reaction/material hooks). The single mutation choke point of the sim.
  function setUnits(x,y,units,getTile,setTile){
    const kk=LPK(x,y);
    const cur=getSafe(getTile,x,y,T.STONE);
    if(units<=0){
      partial.delete(kk);
      clearToxicWaterCell(x,y);
      if(cur===T.WATER){ setTile(x,y,T.AIR); notifyGasChange(x,y,T.WATER,T.AIR); }
      return;
    }
    if(units>=UNITS) partial.delete(kk); else partial.set(kk,units);
    if(cur!==T.WATER) writeExternalTile(x,y,T.WATER,getTile,setTile);
  }
  // moveUnits: transfer n units between two cells; volume-conserving by construction.
  // Caller guarantees the source holds >=n and the destination has capacity for n.
  function moveUnits(sx,sy,dx,dy,n,getTile,setTile){
    if(!(n>0)) return 0;
    const src=levelUnits(getTile,sx,sy);
    const take=Math.min(n,src);
    if(take<=0) return 0;
    const sourceToxicTtl=toxicWater.get(toxicKey(sx,sy))||0;
    setUnits(sx,sy,src-take,getTile,setTile);
    setUnits(dx,dy,levelUnits(getTile,dx,dy)+take,getTile,setTile);
    if(sourceToxicTtl>0) markToxicWaterCell(dx,dy,sourceToxicTtl);
    return take;
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
    setUnits(water.x,water.y,0,getTile,setTile);
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
    setUnits(water.x,water.y,0,getTile,setTile);
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
  // The material processors iterate their Maps directly (insertion order — still
  // deterministic): snapshotting + lexicographically sorting up to 2400 keys per
  // map per tick was pure allocation/sort overhead for a budget of 56 entries.
  // Entries are only deleted (safe mid-iteration) or moved to a DIFFERENT map.
  function processWetSand(getTile,setTile,dt,budget){
    let left=budget;
    for(const [kk,rec] of wetSand){
      if(left--<=0) break;
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
    let left=budget;
    for(const [kk,rec] of wetClay){
      if(left--<=0) break;
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
    let left=budget;
    for(const [kk,rec] of dryMud){
      if(left--<=0) break;
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
    let left=budget;
    for(const [kk,rec] of dryClay){
      if(left--<=0) break;
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
    if(!Number.isFinite(x) || !Number.isFinite(impulse) || Math.abs(x)>=10000000) return;
    const xi = Math.floor(x);
    if(!pendingImpulse.has(xi) && pendingImpulse.size>=PENDING_IMPULSE_CAP){
      const oldest=pendingImpulse.keys().next();
      if(!oldest.done) pendingImpulse.delete(oldest.value);
    }
    let nv = (pendingImpulse.get(xi)||0) + impulse;
    if(nv>420) nv=420; else if(nv<-420) nv=-420;
    pendingImpulse.set(xi, nv);
  }

  // World generation finished a chunk spanning tile columns [x0..x1]: queue a boundary
  // wake (processed in update, where tile accessors are available).
  function noteChunkGenerated(x0,x1){
    if(!Number.isFinite(x0) || !Number.isFinite(x1)) return;
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
        if(canFill(getTile(wx,y+1)) || canDropThroughDynamo(wx,y,getTile) || canSideFlowThroughDynamo(wx,y,getTile) || canSurfaceLevel(wx,y,getTile) || canEqualize(wx,y,getTile)){ mark(wx,y); woke=true; break; }                 // can fall / equalize
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
    updateToxicWater(getTile,dt);
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
    {
      passiveScanAcc=Math.min(passiveScanAcc+dt, PASSIVE_SCAN_INTERVAL*PASSIVE_SCAN_BURST_LIMIT);
      const passes=Math.min(PASSIVE_SCAN_BURST_LIMIT, Math.floor(passiveScanAcc/PASSIVE_SCAN_INTERVAL));
      if(passes>0){
        passiveScanAcc-=passes*PASSIVE_SCAN_INTERVAL;
        if(active.size<32){
          for(let pass=0; pass<passes && active.size<32; pass++){
            const idle=(active.size===0 && pressureSeeds.size===0);
            runPassiveActivationScan(getTile, idle ? PASSIVE_SCAN_COLS_IDLE : PASSIVE_SCAN_COLS_ACTIVE);
          }
        } else {
          // Busy sim: a hard cutoff starved the scan completely, so dormant anomalies
          // (steep shore ramps, chunk-seam walls) never woke while ANY water churned
          // anywhere. Trickle a few columns per interval so they still self-heal.
          runPassiveActivationScan(getTile, PASSIVE_SCAN_COLS_BUSY);
        }
      }
      if(active.size===0 && pressureSeeds.size===0) return;
    }
    const size = active.size;
    const MAX = Math.min(2400, 360 + Math.floor(size*0.40));
    // Cooldown decay
    if(lateralCooldown.size){
      for(const [cx,val] of lateralCooldown){ const nv=val-dt; if(nv<=0) lateralCooldown.delete(cx); else lateralCooldown.set(cx,nv); }
    }
    let processed=0; const next=new Set();
    const keys=[...active]; keys.sort((a,b)=>a-b);
    lateralAcc += dt; const lateralStep = lateralAcc >= LATERAL_INTERVAL; if(lateralStep) lateralAcc=0;
    for(const key of keys){
      if(processed++>MAX){ next.add(key); continue; }
      const sx=Math.floor(key/512), sy=key-sx*512+WORLD_TOP-8;
      const lvl=levelUnits(getTile,sx,sy);
      if(lvl<=0) continue;
      // Downward compaction: water below with headroom swallows this cell's units —
      // partial cells can never float over partial cells (no walls of water).
      if(sy+1<WORLD_BOTTOM && getTile(sx,sy+1)===T.WATER){
        const bLvl=levelUnits(getTile,sx,sy+1);
        if(bLvl<UNITS){
          moveUnits(sx,sy,sx,sy+1,Math.min(lvl,UNITS-bLvl),getTile,setTile);
          next.add(LPK(sx,sy+1)); markNeighbors(next,sx,sy+1); markNeighbors(next,sx,sy);
          if(levelUnits(getTile,sx,sy)>0) next.add(key);
          continue;
        }
      }
      // Gravity (multi-cell drop) — the falling parcel is the cell's whole content
      const fall=waterFallTarget(sx,sy,getTile);
      if(fall){
        const ny=fall.y;
        moveUnits(sx,sy,sx,ny,lvl,getTile,setTile);
        next.add(LPK(sx,ny)); markNeighbors(next,sx,ny); markNeighbors(next,sx,sy);
        recordDynamoWater(sx,fall.slotY,getTile,lvl);
        if(ny-sy>=2 && lvl>=3) noteFall(sx,sy,ny);
        if(ny-sy>=2) pullAdjacentIntoDrainMouth(sx,sy,next,getTile,setTile);
        continue;
      }
      let moved=false;
      if(!canSideFlowThroughDynamo(sx,sy,getTile)){
        const inlet=sideDrainInletTarget(sx,sy,getTile);
        if(inlet){
          moveUnits(sx,sy,inlet.x,inlet.y,lvl,getTile,setTile);
          next.add(LPK(inlet.x,inlet.y));
          markNeighbors(next,inlet.x,inlet.y);
          markNeighbors(next,sx,sy);
          if(pressureSeeds.size<2000) pressureSeeds.add(LPK(inlet.x,inlet.y));
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
          moveUnits(sx,sy,flow.outX,flow.outY,lvl,getTile,setTile);
          next.add(LPK(flow.outX,flow.outY));
          markNeighbors(next,flow.outX,flow.outY);
          markNeighbors(next,sx,sy);
          recordDynamoSideWater(flow.slotX,flow.slotY,getTile,lvl);
          if(pressureSeeds.size<2000) pressureSeeds.add(LPK(flow.outX,flow.outY));
          pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.6);
          disturb(flow.outX, 52);
          moved=true;
          break;
        }
        if(moved) continue;
        for(const dx of (((sx+sy)&1)?[-1,1]:[1,-1])){
          const flow=surfaceLevelTarget(sx,sy,dx,getTile);
          if(!flow) continue;
          // A roofed surface mouth must be filled by the pressure solver while the
          // edge cell stays connected to the source body. Moving units in directly
          // can strand a droplet in the mouth and stall the rest of the fill.
          next.add(key);
          if(pressureSeeds.size<2000) pressureSeeds.add(key);
          pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.9);
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
          for(const dx of order){ if(canFill(getTile(sx+dx,sy)) && canFill(getTile(sx+dx,sy+1))){ moveUnits(sx,sy,sx+dx,sy+1,lvl,getTile,setTile); next.add(LPK(sx+dx,sy+1)); markNeighbors(next,sx+dx,sy+1); disturb(sx+dx,46); moved=true; break; } }
          if(moved) continue;
        }
        // Diagonal top-up: a lower neighboring surface with headroom directly below a
        // passable side cell receives our units — surfaces merge smoothly instead of
        // stopping one block apart.
        if(getTile(sx,sy-1)!==T.WATER){
          for(const dx of (((sx+sy)&1)?[-1,1]:[1,-1])){
            if(!canFill(getTile(sx+dx,sy))) continue;
            if(sy+1>=WORLD_BOTTOM || getTile(sx+dx,sy+1)!==T.WATER) continue;
            const bLvl=levelUnits(getTile,sx+dx,sy+1);
            if(bLvl>=UNITS) continue;
            moveUnits(sx,sy,sx+dx,sy+1,Math.min(lvl,UNITS-bLvl),getTile,setTile);
            next.add(LPK(sx+dx,sy+1)); markNeighbors(next,sx+dx,sy+1); markNeighbors(next,sx,sy);
            disturb(sx+dx, 22);
            moved=true;
            break;
          }
          if(moved){ if(levelUnits(getTile,sx,sy)>0) next.add(key); continue; }
        }
        // Same-row equalization in half-difference steps: the core sub-tile rule.
        // Moves floor(diff/2) units toward a lower water neighbor, or floor(lvl/2)
        // into a supported open cell. Strictly decreases the local height difference,
        // so it cannot oscillate; it stops at a 1-unit (1/10 block) residual, which is
        // the sim's surface tolerance. Only head-free cells spread into voids — cells
        // under pressure use the pressurized push below.
        for(const dx of (((sx+sy)&1)?[-1,1]:[1,-1])){
          const nx=sx+dx;
          const nt=getTile(nx,sy);
          if(nt===T.WATER){
            const d=lvl-levelUnits(getTile,nx,sy);
            if(d<2) continue;
            moveUnits(sx,sy,nx,sy,Math.floor(d/2),getTile,setTile);
            next.add(key); next.add(LPK(nx,sy)); markNeighbors(next,nx,sy);
            moved=true;
            break;
          }
          if(lvl>=2 && canFill(nt) && getTile(sx,sy-1)!==T.WATER){
            // supported: solid floor or full water below the receiving cell
            const nb=sy+1<WORLD_BOTTOM ? getTile(nx,sy+1) : T.STONE;
            if(canFill(nb)) continue; // a drop: spill logic owns it
            if(nb===T.WATER && levelUnits(getTile,nx,sy+1)<UNITS) continue; // top-up owns it
            moveUnits(sx,sy,nx,sy,Math.floor(lvl/2),getTile,setTile);
            next.add(key); next.add(LPK(nx,sy)); markNeighbors(next,nx,sy);
            if(pressureSeeds.size<2000) pressureSeeds.add(LPK(nx,sy));
            disturb(nx, 18);
            moved=true;
            break;
          }
        }
        if(moved) continue;
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
          const best=candidates[0]; if(best.score>0){ moveUnits(sx,sy,sx+best.dx,sy,lvl,getTile,setTile); next.add(LPK(sx+best.dx,sy)); markNeighbors(next,sx+best.dx,sy); moved=true; }
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
            moveUnits(sx,sy,nx,sy,lvl,getTile,setTile);
            next.add(LPK(nx,sy)); markNeighbors(next,sx,sy); markNeighbors(next,nx,sy);
            if(pressureSeeds.size<2000) pressureSeeds.add(LPK(nx,sy));
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
          if(sy+1<WORLD_BOTTOM && (canFill(getTile(sx,sy+1)) || (getTile(sx,sy+1)===T.WATER && levelUnits(getTile,sx,sy+1)<UNITS))) next.add(key);
          else {
            // A cell with head facing a same-level opening is a flood front whose feed
            // refills asynchronously — keep it hot or the advance stalls between ticks
            const pushable = getTile(sx,sy-1)===T.WATER && (
              (isAir(getTile(sx-1,sy)) && sy+1<WORLD_BOTTOM && !canFill(getTile(sx-1,sy+1))) ||
              (isAir(getTile(sx+1,sy)) && sy+1<WORLD_BOTTOM && !canFill(getTile(sx+1,sy+1))));
            if(pushable) next.add(key);
            else if(pressureSeeds.size<2000) pressureSeeds.add(key);
          }
        } else if(isAir(getTile(sx-1,sy)) || isAir(getTile(sx+1,sy)) || isAir(getTile(sx,sy+1)) || canDropThroughDynamo(sx,sy,getTile) || canSideFlowThroughDynamo(sx,sy,getTile) || canSurfaceLevel(sx,sy,getTile) || canEqualize(sx,sy,getTile)) next.add(key);
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
        const {touchedXs, touchedTops, variance, hadTransfers} = result;
        if(hadTransfers){
          // Short cooldown: long blanket cooldowns choke drains (e.g. a lake emptying
          // into a dug shaft re-levels every pass, freezing its own outflow columns)
          const COOLDOWN=0.25;
          for(const x of touchedXs) lateralCooldown.set(x, Math.max(lateralCooldown.get(x)||0, COOLDOWN));
          // Re-mark touched columns but KEEP the rest of the active set: clearing it here
          // killed in-progress flood fronts elsewhere (cells the leveling didn't touch)
          // and left bodies permanently unsettled.
          for(const x of touchedXs){
            // Surface re-mark: climb from the touched row instead of scanning the whole
            // column from the top of the world (~400 probes per column at ocean scale).
            let ty=touchedTops ? touchedTops.get(x) : undefined;
            if(ty!=null){
              if(getTile(x,ty)===T.WATER){
                while(ty-1>=WORLD_TOP && getTile(x,ty-1)===T.WATER) ty--;
                active.add(LPK(x,ty));
              } else { // touched cell drained dry: the column's water sits below it
                const stop=Math.min(WORLD_BOTTOM, ty+64);
                for(let y=ty+1; y<stop; y++){ if(getTile(x,y)===T.WATER){ active.add(LPK(x,y)); break; } }
              }
            }
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

  function markNeighbors(set,x,y){
    set.add(LPK(x-1,y)); set.add(LPK(x+1,y));
    if(y-1>=PK_MIN_Y) set.add(LPK(x,y-1));
    if(y+1<=PK_MAX_Y) set.add(LPK(x,y+1));
  }
  function hurrySolver(){
    lateralAcc=Math.max(lateralAcc,LATERAL_INTERVAL);
    pressureAcc=Math.max(pressureAcc,pressureIntervalCurrent*0.88);
  }
  function wakeWaterCell(x,y,includeNeighbors){
    if(y<PK_MIN_Y || y>PK_MAX_Y) return;
    mark(x,y);
    if(includeNeighbors) markNeighbors(active,x,y);
    if(pressureSeeds.size<2400) pressureSeeds.add(LPK(x,y));
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
      setUnits(x,y,UNITS,getTile,setTile);
      wakeWaterCell(x,y,false); hurrySolver(); disturb(x,140);
      return true;
    }
    if(cur===T.WATER){
      setUnits(x,y,UNITS,getTile,setTile); // a source tops a partial cell up to a full block
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
  // A solid is about to overwrite the water at (x,y): conserve volume by moving its
  // units to the nearest opening — topping up the column's surface first, then the air
  // above it, else a cell beside it.
  function displaceAt(x,y,getTile,setTile){
    const units=levelUnits(getTile,x,y);
    if(units<=0) return false;
    let ty=y-1, steps=0;
    while(ty>=WORLD_TOP && getTile(x,ty)===T.WATER && steps<MAX_VERTICAL_SCAN){ ty--; steps++; }
    if(ty>=WORLD_TOP && isAir(getTile(x,ty))){
      let rem=units;
      const surfY=ty+1;
      if(surfY<=y-1){ // partial surface cell above the displaced cell absorbs first
        const sLvl=levelUnits(getTile,x,surfY);
        if(sLvl<UNITS){ const add=Math.min(rem,UNITS-sLvl); setUnits(x,surfY,sLvl+add,getTile,setTile); rem-=add; }
      }
      if(rem>0) setUnits(x,ty,rem,getTile,setTile);
      partial.delete(LPK(x,y)); // the caller overwrites this tile next
      wakeWaterCell(x,ty,false); hurrySolver(); disturb(x,90); return true;
    }
    for(const dx of [-1,1]){
      const nt=getTile(x+dx,y);
      if(isAir(nt)){
        setUnits(x+dx,y,units,getTile,setTile);
        partial.delete(LPK(x,y));
        wakeWaterCell(x+dx,y,false); hurrySolver(); disturb(x+dx,70); return true;
      }
      if(nt===T.WATER){
        const nl=levelUnits(getTile,x+dx,y);
        if(nl<UNITS && UNITS-nl>=units){
          setUnits(x+dx,y,nl+units,getTile,setTile);
          partial.delete(LPK(x,y));
          wakeWaterCell(x+dx,y,false); hurrySolver(); disturb(x+dx,70); return true;
        }
      }
    }
    return false; // fully sealed pocket — the units are lost
  }
  // A weather system wants to turn the water at (x,y) into a solid FULL block
  // (e.g. seasonal ice). Leveled surfaces are usually partial cells, and freezing
  // a 4/10 cell into ice that later thaws back to a 10/10 water block would mint
  // volume every winter. Make the cell volume-true first: top it up by borrowing
  // the deficit from the full water directly below (the new ice sheet visibly
  // "draws down" the body it freezes over). Returns false when that is impossible
  // (thin films with nothing below) — such cells should stay liquid.
  function solidifyAt(x,y,getTile,setTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!validTile(x,y) || typeof getTile!=='function' || typeof setTile!=='function') return false;
    const u=levelUnits(getTile,x,y);
    if(u<=0) return false;
    if(u>=UNITS) return true;
    const deficit=UNITS-u;
    if(y+1<WORLD_BOTTOM && getTile(x,y+1)===T.WATER){
      const below=levelUnits(getTile,x,y+1);
      if(below>deficit){ // keep at least one unit so the row below stays water
        moveUnits(x,y+1,x,y,deficit,getTile,setTile);
        wakeWaterCell(x,y+1,true);
        hurrySolver();
        return true;
      }
    }
    return false;
  }

  // ---------------- Rendering ----------------
  function toxicSegmentFraction(wx,top,bot){
    let hits=0, total=0;
    for(let y=top; y<=bot; y++){
      total++;
      if(toxicWater.has(toxicKey(wx,y))) hits++;
    }
    return total>0 ? hits/total : 0;
  }
  const TOXIC_BLEND_X=Object.freeze([[-2,0.16],[-1,0.42],[0,1],[1,0.42],[2,0.16]]);
  const TOXIC_BLEND_Y=Object.freeze([[-1,0.28],[0,1],[1,0.28]]);
  function toxicVisualFraction(wx,top,bot,getTile){
    if(!toxicWater.size) return 0;
    const height=Math.max(1,bot-top+1);
    const step=Math.max(1,Math.floor(height/12));
    let toxicWeight=0, waterWeight=0;
    const sampled=new Set();
    for(let sy=top; sy<=bot; sy+=step) sampled.add(sy);
    sampled.add(bot);
    for(const sy of sampled){
      for(const [dx,xw] of TOXIC_BLEND_X){
        for(const [dy,yw] of TOXIC_BLEND_Y){
          const x=wx+dx, y=sy+dy, weight=xw*yw;
          if(getSafe(getTile,x,y,T.STONE)!==T.WATER) continue;
          waterWeight+=weight;
          if(toxicWater.has(toxicKey(x,y))) toxicWeight+=weight;
        }
      }
    }
    return waterWeight>0 ? Math.max(0,Math.min(1,toxicWeight/waterWeight)) : 0;
  }
  function mixedRgba(normal,toxic,mix){
    const t=Math.max(0,Math.min(1,Number(mix)||0)), u=1-t;
    const r=Math.round(normal[0]*u+toxic[0]*t), g=Math.round(normal[1]*u+toxic[1]*t), b=Math.round(normal[2]*u+toxic[2]*t);
    const a=Math.max(0,Math.min(1,normal[3]*u+toxic[3]*t));
    return 'rgba('+r+','+g+','+b+','+a.toFixed(3)+')';
  }
  function addWaterGradientStops(gradient,open,toxicMix){
    if(open){
      gradient.addColorStop(0,mixedRgba([120,198,252,.58],[170,255,96,.62],toxicMix));
      gradient.addColorStop(.17,mixedRgba([56,140,238,.72],[52,190,106,.78],toxicMix));
      gradient.addColorStop(1,mixedRgba([8,28,86,.93],[13,72,46,.95],toxicMix));
    }else{
      gradient.addColorStop(0,mixedRgba([46,108,206,.72],[74,155,88,.76],toxicMix));
      gradient.addColorStop(1,mixedRgba([6,22,70,.93],[10,54,38,.94],toxicMix));
    }
  }
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

    // 1. Scan visible columns into contiguous water segments. Each segment carries its
    // top cell's sub-tile fill: the rest surface sits (UNITS-lvl)/UNITS of a tile below
    // the cell top, so partial cells render as genuinely shallow water.
    const cols=new Array(n); let anyWater=false;
    for(let xi=0; xi<n; xi++){
      const wx=x0+xi; let segs=null; let y=yTop;
      while(y<=yBot){
        if(getTile(wx,y)===T.WATER && tileVisible(wx,y)){
          const top=y; while(y<=yBot && getTile(wx,y)===T.WATER && tileVisible(wx,y)) y++;
          const pv=partial.get(LPK(wx,top));
          const lvl=pv===undefined ? UNITS : pv;
          const frac=(UNITS-lvl)/UNITS;
          const bot=y-1;
          (segs||(segs=[])).push({top, bot, lvl, frac, rest:top*TILE+frac*TILE, open: (top>WORLD_TOP && isAir(getTile(wx,top-1))) || lvl<UNITS, surf:0, yl:0, yr:0,
            toxicCore:toxicSegmentFraction(wx,top,bot), toxic:toxicVisualFraction(wx,top,bot,getTile)});
        } else y++;
      }
      if(segs){ anyWater=true; cols[xi]=segs; }
    }
    // Give every segment matching contamination values at shared column edges.
    // Horizontal overlay gradients then meet on the exact same color instead of
    // exposing even a faint one-pixel boundary between independently drawn cells.
    function neighborToxic(segs,sg){
      if(!segs) return sg.toxic;
      let best=null, overlap=0;
      for(const other of segs){
        const shared=Math.min(sg.bot,other.bot)-Math.max(sg.top,other.top)+1;
        if(shared>overlap){ overlap=shared; best=other; }
      }
      return best ? best.toxic : sg.toxic;
    }
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs) continue;
      for(const sg of segs){
        const lt=neighborToxic(xi>0?cols[xi-1]:null,sg);
        const rt=neighborToxic(xi<n-1?cols[xi+1]:null,sg);
        sg.toxicL=(sg.toxic+lt)*0.5;
        sg.toxicR=(sg.toxic+rt)*0.5;
      }
    }

    // 2. Surface springs: create/realign for visible surfaces, apply kicks, integrate, couple.
    // Springs rest at the fractional surface height, so sub-tile level changes read as a
    // smooth rise/settle instead of snapping.
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs || !segs[0].open) continue;
      const s0=segs[0], wx=x0+xi;
      const restPx=s0.top*TILE + s0.frac*TILE;
      let spr=springs.get(wx);
      if(!spr){ springs.set(wx,{o:0,v:0,y:s0.top,rest:restPx,seen:frameNo}); }
      else {
        const prevRest=Number.isFinite(spr.rest) ? spr.rest : spr.y*TILE;
        if(Math.abs(prevRest-restPx)>0.01){
          // Water level moved (flow/leveling): keep the visual height and let the
          // spring relax to the new rest level — reads as a smooth rise/settle.
          // Clamp tightly: a generous carry makes spill fronts bulge unnaturally.
          let carry=spr.o + (prevRest - restPx);
          const lim=TILE*0.6;
          if(carry>lim) carry=lim; else if(carry<-lim) carry=-lim;
          spr.o=carry;
        }
        spr.rest=restPx; spr.y=s0.top;
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

    // 3. Visual surface height per segment (spring + layered ambient swell). Waves damp
    // out on shallow films so a 1/10-block sheet doesn't oscillate below its own floor.
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs) continue;
      const wx=x0+xi;
      const s0=segs[0];
      const restPx=s0.top*TILE + s0.frac*TILE;
      let px=restPx;
      if(s0.open){
        const spr=springs.get(wx);
        const depthPx=(s0.bot+1)*TILE - restPx;
        const waveScale=Math.max(0.12, Math.min(1, depthPx/(TILE*0.6)));
        const amb=(Math.sin(wx*0.5+tSec*1.6)*1.1 + Math.sin(wx*0.17-tSec*0.8)*0.8 + Math.sin(wx*1.7+tSec*2.8)*0.5 + Math.sin(wx*0.06+tSec*0.45)*1.1)*waveScale;
        px += amb + (spr? spr.o*waveScale : 0);
        const lo=restPx - TILE*0.9; if(px<lo) px=lo;               // never far above the rest level
        const hi=(s0.bot+1)*TILE - 1; if(px>hi) px=hi;             // never below own body
      }
      s0.surf=px;
      for(let si=1; si<segs.length; si++){
        const sg=segs[si];
        sg.surf=sg.top*TILE + sg.frac*TILE + (sg.open? Math.sin(wx*0.9+tSec*2.1)*1.2 : 0);
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
          // Join only near-equal rest surfaces (within ~1 tile): averaging across taller
          // steps turns spill fronts and shore lips into unnatural bulges. Compared on
          // rest heights (tile row + sub-tile fill), never on the animated wave heights —
          // otherwise big waves momentarily un-join columns and the body shatters into
          // capped pillars.
          lf=xi>0? cols[xi-1] : null; rt=xi<n-1? cols[xi+1] : null;
          if(lf && Math.abs(lf[0].rest-sg.rest)<=TILE*1.2){ yL=(lf[0].surf+sg.surf)/2; joinedL=true; }
          if(rt && Math.abs(rt[0].rest-sg.rest)<=TILE*1.2){ yR=(rt[0].surf+sg.surf)/2; joinedR=true; }
        }
        sg.yl=yL; sg.yr=yR;
        const capPx=Math.min(TILE*0.42, Math.max(0,((sg.bot+1)*TILE-sg.surf)*0.6)); // thin films get thin caps
        sg.lCap=sg.open && !joinedL ? capPx : 0;
        sg.rCap=sg.open && !joinedR ? capPx : 0;
        const lOpenSide=sg.open && !joinedL && (isAir(getTile(wx-1,sg.top)) || !!lf);
        const rOpenSide=sg.open && !joinedR && (isAir(getTile(wx+1,sg.top)) || !!rt);
        sg.lSoft=lOpenSide ? TILE*0.14 : 0;
        sg.rSoft=rOpenSide ? TILE*0.14 : 0;
        const botPx=(sg.bot+1)*TILE;
        // Anchor the depth gradient at the rest surface, not the animated wave height:
        // per-column wave phases otherwise shift the gradient and paint vertical bands.
        // Wave crests above the rest line clamp to the gradient's surface color.
        const topMin=sg.rest;
        const grad=g.createLinearGradient(0,topMin,0,topMin+TILE*9);
        addWaterGradientStops(grad,sg.open,sg.toxic);
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
        for(let si=0; si<segs.length; si++){
          const sg=segs[si];
          if(Math.max(sg.toxic,sg.toxicL,sg.toxicR)<=0.005) continue;
          const acidGradient=g.createLinearGradient(xpx,0,xpx+TILE,0);
          const acidLeft=0.18*Math.pow(sg.toxicL,0.82), acidRight=0.18*Math.pow(sg.toxicR,0.82);
          acidGradient.addColorStop(0,'rgba(140,255,70,'+acidLeft.toFixed(3)+')');
          acidGradient.addColorStop(1,'rgba(140,255,70,'+acidRight.toFixed(3)+')');
          g.fillStyle=acidGradient;
          drawWaterSegmentPath(g,xpx,TILE,sg,(sg.bot+1)*TILE);
          g.fill();
          if(!SIMPLE && sg.open){
            const pulse=0.45+0.55*Math.sin(tSec*3.8+wx*0.73);
            g.strokeStyle='rgba(202,255,120,'+((0.05+0.27*pulse)*sg.toxic).toFixed(3)+')';
            g.lineWidth=1.8;
            g.beginPath(); drawWaterTopPath(g,xpx,TILE,sg,-0.5); g.stroke();
            if(hash32(wx,Math.floor(tSec*3))%17===0){
              const bx=xpx+4+(hash32(wx,91)%Math.max(4,TILE-8));
              const by=sg.surf+4+(hash32(wx,137)%Math.max(5,Math.min(TILE*2,(sg.bot-sg.top+1)*TILE)));
              g.fillStyle='rgba(216,255,126,'+(0.42*sg.toxic).toFixed(3)+')';
              g.beginPath(); g.ellipse(bx,by,1.8,1.1,0,0,Math.PI*2); g.fill();
            }
          }
        }
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
                g.fillStyle=mixedRgba([190,232,255,a],[185,255,116,a*1.16],sg.toxic);
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
        const crestGradient=g.createLinearGradient(xpx,0,xpx+TILE,0);
        crestGradient.addColorStop(0,mixedRgba([255,255,255,.38],[222,255,146,.48],s0.toxicL));
        crestGradient.addColorStop(1,mixedRgba([255,255,255,.38],[222,255,146,.48],s0.toxicR));
        g.strokeStyle=crestGradient; g.lineWidth=1.6;
        g.beginPath(); drawWaterTopPath(g,xpx,TILE,s0,0); g.stroke();
        const underglowGradient=g.createLinearGradient(xpx,0,xpx+TILE,0);
        underglowGradient.addColorStop(0,mixedRgba([170,215,255,.10],[140,255,106,.18],s0.toxicL));
        underglowGradient.addColorStop(1,mixedRgba([170,215,255,.10],[140,255,106,.18],s0.toxicR));
        g.strokeStyle=underglowGradient; g.lineWidth=4;
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
  const RESTORE_LEVELS_CAP = 50000;
  const RESTORE_TOXIC_WATER_CAP = 50000;
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
    partial.clear();
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
    pressureSweepKey=-Infinity;
    reactionBudget=0;
    wetSand.clear();
    wetClay.clear();
    dryMud.clear();
    dryClay.clear();
    toxicWater.clear();
    materialScanAcc=0;
    materialScanOffset=0;
  }
  function snapshot(){
    try{
      const activeList=[];
      for(const pk of active){
        const x=Math.floor(pk/512), y=pk-Math.floor(pk/512)*512+WORLD_TOP-8;
        if(!validRestoreCoord(x,y)) continue;
        activeList.push([x,y]);
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
      const levels=[];
      for(const [pk,u] of partial){
        if(levels.length>=RESTORE_LEVELS_CAP) break;
        const x=Math.floor(pk/512), y=pk-x*512+WORLD_TOP-8;
        if(!validRestoreCoord(x,y)) continue;
        const uu=Math.floor(u);
        if(!(uu>=1) || uu>=UNITS) continue;
        levels.push([x,y,uu]);
      }
      const toxic=[];
      for(const [pk,ttl] of toxicWater){
        if(toxic.length>=RESTORE_TOXIC_WATER_CAP) break;
        const x=Math.floor(pk/512), y=pk-x*512+WORLD_TOP-8;
        if(!validRestoreCoord(x,y)) continue;
        toxic.push([x,y,clampFinite(ttl,0,dayLengthSeconds()*2,dayLengthSeconds())]);
      }
      return {
        v:3,
        active:activeList,
        levels,
        toxic,
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
  function boundedRestoreLimit(rows,cap){
    return Array.isArray(rows) ? Math.min(rows.length,Math.max(0,Math.floor(cap)||0)) : 0;
  }
  function restore(s){ reset(); if(!s||typeof s!=='object') return; try{
    if(Array.isArray(s.active)){
      const limit=boundedRestoreLimit(s.active,RESTORE_ACTIVE_CAP);
      for(let i=0;i<limit;i++){
        const a=s.active[i];
        const kk=parseRestoreKey(a);
        if(kk && active.size<RESTORE_ACTIVE_CAP){
          const ix=kk.indexOf(',');
          active.add(LPK(+kk.slice(0,ix),+kk.slice(ix+1)));
        }
      }
    }
    // v1 saves carried ripple visuals; replay them as gentle wave kicks
    if(Array.isArray(s.ripples)){
      const limit=boundedRestoreLimit(s.ripples,RESTORE_ACTIVE_CAP);
      for(let i=0;i<limit;i++){
        const r=s.ripples[i];
        if(r && Number.isFinite(r.L) && Number.isFinite(r.R)) disturb(Math.floor((r.L+r.R)/2),60);
      }
    }
    // v3: sub-tile fill levels. Pre-v3 saves (or entries beyond the cap) restore as
    // full cells — the tile grid itself stays authoritative for where water exists.
    if(Array.isArray(s.levels)){
      const limit=boundedRestoreLimit(s.levels,RESTORE_LEVELS_CAP);
      for(let i=0;i<limit;i++){
        const row=s.levels[i];
        if(!Array.isArray(row) || row.length<3 || partial.size>=RESTORE_LEVELS_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), u=Math.floor(Number(row[2]));
        if(!validRestoreCoord(x,y) || !(u>=1) || u>=UNITS) continue;
        partial.set(LPK(Math.floor(x),Math.floor(y)),u);
      }
    }
    if(Array.isArray(s.toxic)){
      const limit=boundedRestoreLimit(s.toxic,RESTORE_TOXIC_WATER_CAP);
      for(let i=0;i<limit;i++){
        const row=s.toxic[i];
        if(!Array.isArray(row) || row.length<2 || toxicWater.size>=RESTORE_TOXIC_WATER_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), ttl=Number(row[2]);
        if(!validRestoreCoord(x,y)) continue;
        toxicWater.set(LPK(Math.floor(x),Math.floor(y)),clampFinite(ttl,0,dayLengthSeconds()*2,dayLengthSeconds()));
      }
    }
    if(Array.isArray(s.lateral)){
      const limit=boundedRestoreLimit(s.lateral,RESTORE_LATERAL_CAP);
      for(let i=0;i<limit;i++){
        const row=s.lateral[i];
        if(!Array.isArray(row) || row.length<2 || lateralCooldown.size>=RESTORE_LATERAL_CAP) continue;
        const x=Number(row[0]), val=Number(row[1]);
        if(Number.isFinite(x) && Math.abs(x)<10000000 && Number.isFinite(val) && val>0) lateralCooldown.set(Math.floor(x),Math.max(0,Math.min(5,val)));
      }
    }
    if(Array.isArray(s.wet)){
      const limit=boundedRestoreLimit(s.wet,RESTORE_MATERIAL_CAP);
      for(let i=0;i<limit;i++){
        const row=s.wet[i];
        if(!Array.isArray(row) || row.length<2 || wetSand.size>=RESTORE_MATERIAL_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), wet=Number(row[2]);
        if(validRestoreCoord(x,y)) wetSand.set(Math.floor(x)+','+Math.floor(y),{x:Math.floor(x),y:Math.floor(y),wet:clampFinite(wet,0,20,0)});
      }
    }
    if(Array.isArray(s.clayWet)){
      const limit=boundedRestoreLimit(s.clayWet,RESTORE_MATERIAL_CAP);
      for(let i=0;i<limit;i++){
        const row=s.clayWet[i];
        if(!Array.isArray(row) || row.length<2 || wetClay.size>=RESTORE_MATERIAL_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), wet=Number(row[2]);
        if(validRestoreCoord(x,y)) wetClay.set(Math.floor(x)+','+Math.floor(y),{x:Math.floor(x),y:Math.floor(y),wet:clampFinite(wet,0,20,0)});
      }
    }
    if(Array.isArray(s.dry)){
      const limit=boundedRestoreLimit(s.dry,RESTORE_MATERIAL_CAP);
      for(let i=0;i<limit;i++){
        const row=s.dry[i];
        if(!Array.isArray(row) || row.length<2 || dryMud.size>=RESTORE_MATERIAL_CAP) continue;
        const x=Number(row[0]), y=Number(row[1]), dry=Number(row[2]);
        if(validRestoreCoord(x,y)) dryMud.set(Math.floor(x)+','+Math.floor(y),{x:Math.floor(x),y:Math.floor(y),dry:clampFinite(dry,0,30,0)});
      }
    }
    if(Array.isArray(s.clayDry)){
      const limit=boundedRestoreLimit(s.clayDry,RESTORE_MATERIAL_CAP);
      for(let i=0;i<limit;i++){
        const row=s.clayDry[i];
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
  const EQ_GLOBAL_BODY_SOFT_CAP=5000; // larger bodies use the bounded window + band path
  const EQ_BODY_CAP=6500;   // safety caps for the two flood fills
  const EQ_VOID_CAP=9000;
  const EQ_RATE=720;        // min sub-tile units moved per body per pass (72 blocks)
  const EQ_RATE_MAX=3600;   // rate scales with body size up to this (360 blocks/pass)
  const EQ_BODIES=3;        // bodies equalized per pass
  const EQ_TIME_BUDGET_MS=3;// per-pass wall budget; leftover seeds resume next pass
  const EQ_BAND_SPAN=280;   // surface-band walk half-width for oversized bodies
  const EQ_BAND_DEPTH=24;   // how deep a column run is probed during the band walk

  function runPressureLeveling(getTile,setTile){
    const world = (typeof window!=='undefined' && window.MM && MM.world) ? MM.world : null;
    const rawReadTile = world && typeof world.peekTile==='function'
      ? (x,y)=>world.peekTile(x,y,T.STONE)
      : getTile;
    // Per-body memoized reads: the flood fills probe interior cells 4-6x each
    // (neighbor scans + sill checks). Nothing mutates tiles until a body's final
    // transfer loop, and the cache is cleared before each body's seed check, so
    // the cached view is always exact. Y spans <512 rows, so a packed numeric
    // key avoids string churn.
    const tileCache=new Map();
    // Packed numeric cell key (module-level LPK): used for the read cache and the
    // flood-fill membership sets — string keys per neighbor probe dominated the
    // solver's profile via allocation churn.
    const PK=LPK;
    const readTile=(x,y)=>{
      const kk=PK(x,y);
      let v=tileCache.get(kk);
      if(v===undefined){ v=rawReadTile(x,y); tileCache.set(kk,v); }
      return v;
    };
    // Sub-tile fill of a cell through the cached tile view; `partial` is authoritative
    // for levels and is only mutated by this pass's own transfers (applied after all
    // reads for a body are done), so this is exact.
    const cellUnits=(x,y)=>{
      if(readTile(x,y)!==T.WATER) return 0;
      const v=partial.get(PK(x,y));
      return v===undefined ? UNITS : v;
    };
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
    // Open spill = a body cell can gravity-drain (drop below, or sideways over an
    // edge). Detected inline during the body flood fill: a separate whole-body scan
    // (plus the windowed re-collect it used to trigger) doubled the solver's cost.
    const cellSpills=(x,y)=>{
      if(y+1>=WORLD_BOTTOM) return false;
      if(canFill(readTile(x,y+1))) return true;
      return (canFill(readTile(x-1,y)) && canFill(readTile(x-1,y+1))) ||
             (canFill(readTile(x+1,y)) && canFill(readTile(x+1,y+1)));
    };
    // Flood fills carry numeric coords beside the string-key sets: parsing keys per
    // popped cell dominated the solver's profile (and churned the GC) on big bodies.
    const collectBody = (sx,sy,windowLimit,softCap)=>{
      const bodyKeys=new Set([PK(sx,sy)]);
      const bodyCoords=[sx,sy];        // flat [x0,y0,x1,y1,…] in discovery order
      const stack=[sx,sy];
      let minSurf=WORLD_BOTTOM, maxSurf=WORLD_TOP, overflow=false, hasSpill=cellSpills(sx,sy);
      while(stack.length){
        const cy=stack.pop(), cx=stack.pop();
        if(cy<minSurf) minSurf=cy;
        if(cy>maxSurf) maxSurf=cy;
        for(let d=0;d<4;d++){
          const nx=cx+(d===0?-1:d===1?1:0), ny=cy+(d===2?-1:d===3?1:0);
          if(windowLimit!=null && Math.abs(nx-sx)>windowLimit) continue;
          if(ny<WORLD_TOP || ny>=WORLD_BOTTOM) continue;
          const nk=PK(nx,ny);
          if(bodyKeys.has(nk) || readTile(nx,ny)!==T.WATER) continue;
          if(!pressureConnected(cx,cy,nx,ny)) continue;
          bodyKeys.add(nk); bodyCoords.push(nx,ny); stack.push(nx,ny);
          if(!hasSpill && cellSpills(nx,ny)) hasSpill=true;
          if(bodyKeys.size>EQ_BODY_CAP || (softCap && bodyKeys.size>softCap)){ overflow=true; stack.length=0; break; }
          // Spilling bodies are re-collected windowed anyway (gravity + the bounded
          // window own drains): stop the exploratory global fill as soon as a spill
          // shows up instead of walking the whole body first.
          if(softCap && hasSpill){ stack.length=0; break; }
        }
      }
      return {bodyKeys,bodyCoords,minSurf,maxSurf,overflow,hasSpill,windowLimit};
    };
    const touchedXs=new Set(); const touchedTops=new Map(); // x -> min touched y (surface hint)
    let variance=null; let hadTransfers=false;
    const noteTouched=(x,y)=>{
      touchedXs.add(x);
      const cur=touchedTops.get(x);
      if(cur===undefined || y<cur) touchedTops.set(x,y);
    };
    const noteMoved=(movedUnits)=>{
      if(movedUnits>0){
        hadTransfers=true;
        const spread=Math.min(12,Math.ceil(movedUnits/UNITS));
        if(variance==null || spread>variance) variance=spread;
      }
    };
    // Cell-accurate equalization of one collected body.
    // 2. container: void reachable below the body's highest surface. At the surface
    // row itself, only covered mouths / existing lower water columns are admitted:
    // open dry shore remains a wall, while cave lips and one-tile-low water notches
    // can level.
    const solveBody=(bodyInfo,sx)=>{
      const {bodyKeys,bodyCoords,minSurf,windowLimit}=bodyInfo;
      const floorRow=minSurf+1;
      const contKeys=new Set(bodyKeys); const contCoords=bodyCoords.slice();
      const q=bodyCoords.slice();
      while(q.length){
        const cy=q.pop(), cx=q.pop();
        for(let d=0;d<4;d++){
          const nx=cx+(d===0?-1:d===1?1:0), ny=cy+(d===2?-1:d===3?1:0);
          if(windowLimit!=null && Math.abs(nx-sx)>windowLimit) continue;
          if(ny<minSurf || ny>=WORLD_BOTTOM) continue;
          const nk=PK(nx,ny);
          if(contKeys.has(nk) || !canFill(readTile(nx,ny))) continue;
          if(ny<floorRow && !surfaceVoidCanLevel(nx,ny,readTile)) continue;
          contKeys.add(nk); contCoords.push(nx,ny); q.push(nx,ny);
          // Container past the cap = effectively unbounded (open floors, mega
          // caverns): skip ON PURPOSE, exactly like the shipped solver. Leveling a
          // body against open ground would flatten its stable 1-unit-per-column
          // taper, and every flattening re-arms the local spread rule — the puddle
          // would creep across the whole map. Bounded windows plus the surface band
          // pass own the oversized cases instead.
          if(contKeys.size>EQ_VOID_CAP) return;
        }
      }
      // 3. bottom-up equilibrium fill of the container with the body's volume, in
      // sub-tile units. Full rows take UNITS per cell; the topmost partial row splits
      // the remainder evenly across its columns, so the final surface is flat across
      // the whole basin to within one unit (1/10 of a block).
      const byRow=new Map();
      for(let i=0;i<contCoords.length;i+=2){ const x=contCoords[i], y=contCoords[i+1]; let a=byRow.get(y); if(!a){ a=[]; byRow.set(y,a); } a.push(x); }
      const rowsDesc=[...byRow.keys()].sort((a,b)=>b-a);
      let vol=0;
      for(let i=0;i<bodyCoords.length;i+=2) vol+=cellUnits(bodyCoords[i],bodyCoords[i+1]);
      const targetUnits=new Map(); // packed cell key -> units
      for(const y of rowsDesc){
        if(vol<=0) break;
        const xs=byRow.get(y);
        const cap=xs.length*UNITS;
        if(vol>=cap){ for(const x of xs) targetUnits.set(PK(x,y),UNITS); vol-=cap; }
        else {
          // Partial surface row: covered mouths are preferred so caves flood instead
          // of leaving a dry notch; then existing water cells for stability; the
          // remainder units cluster nearest the seeded body instead of teleporting to
          // the container's far edge. Rank keys are precomputed — evaluating tile
          // reads inside the comparator cost O(n log n) redundant getTile calls.
          const base=Math.floor(vol/xs.length);
          let extra=vol-base*xs.length;
          const ranked=xs.map(x=>({
            x,
            c:surfaceVoidCanLevel(x,y,readTile) && !isAir(readTile(x,y-1)) ? 0 : 1,
            w:bodyKeys.has(PK(x,y))?0:1,
            d:Math.abs(x-sx)
          }));
          ranked.sort((a,b)=> a.c-b.c || a.w-b.w || a.d-b.d || a.x-b.x);
          for(const r of ranked){
            const u=base+(extra>0?1:0);
            if(extra>0) extra--;
            if(u>0) targetUnits.set(PK(r.x,y),u);
          }
          vol=0;
        }
      }
      // 4. rate-limited move: drain the highest surplus cells into the deepest deficits.
      // Sources clear top-down and destinations fill bottom-up, so every intermediate
      // state is gravity-consistent and each unit moved conserves volume exactly.
      let spillFloor=WORLD_BOTTOM;
      for(let i=0;i<bodyCoords.length;i+=2){
        const bx=bodyCoords[i], by=bodyCoords[i+1];
        for(const dx of [-1,1]){
          const nx=bx+dx;
          if(isPressureSillCell(nx,by) && readTile(bx,by+1)===T.WATER) spillFloor=Math.min(spillFloor,by+1);
          if(isOpenLipWall(bx,by,dx)) spillFloor=Math.min(spillFloor,by);
        }
      }
      // Sources = body cells above their target level; dests = container cells below
      // theirs (including partial body surface cells that need topping up).
      const sources=[]; const dests=[];
      for(let i=0;i<bodyCoords.length;i+=2){
        const bx=bodyCoords[i], by=bodyCoords[i+1];
        if(by>=spillFloor) continue;
        const cur=cellUnits(bx,by);
        const tgt=targetUnits.get(PK(bx,by))||0;
        if(cur>tgt) sources.push({x:bx,y:by,give:cur-tgt});
      }
      for(const [tk,u] of targetUnits){
        const x=Math.floor(tk/512), y=tk-x*512+WORLD_TOP-8;
        const cur=cellUnits(x,y);
        if(u>cur) dests.push({x,y,take:u-cur});
      }
      if(!sources.length || !dests.length) return; // already at equilibrium
      sources.sort((a,b)=> a.y-b.y || a.x-b.x); // highest first
      dests.sort((a,b)=> b.y-a.y || a.x-b.x);   // deepest first
      // Wide bodies move ~1 unit per column per pass instead of a fixed trickle:
      // a fixed rate made ocean-scale redistribution take O(area) passes.
      let budget=Math.min(EQ_RATE_MAX, Math.max(EQ_RATE, bodyKeys.size));
      let movedUnits=0, si=0, di=0;
      while(budget>0 && si<sources.length && di<dests.length){
        const s=sources[si], d=dests[di];
        const n=Math.min(budget,s.give,d.take);
        const done=moveUnits(s.x,s.y,d.x,d.y,n,getTile,setTile);
        if(done<=0) break;
        s.give-=done; d.take-=done; budget-=done; movedUnits+=done;
        mark(d.x,d.y); markNeighbors(active,d.x,d.y); markNeighbors(active,s.x,s.y);
        noteTouched(s.x,s.y); noteTouched(d.x,d.y);
        if(s.give<=0) si++;
        if(d.take<=0) di++;
      }
      noteMoved(movedUnits);
    };
    // Oversized bodies (oceans, mega-caverns) cannot be cell-flood-filled within
    // budget; flatten their open surface as a 1D column band instead. The walk
    // follows the top water run of each column while consecutive runs share a row,
    // so basins separated by solid lips stay hydraulically separate. Each pass moves
    // top-cell units from above-average columns to below-average ones (rate-limited),
    // which both levels sealed oceans without window-boundary steps and feeds the
    // drawdown cone around a drain from the far field.
    const bandLevel=(seedX,seedY)=>{
      tileCache.clear(); // prior transfers this pass mutated tiles
      let top=seedY;
      if(readTile(seedX,top)!==T.WATER) return;
      while(top-1>=WORLD_TOP && readTile(seedX,top-1)===T.WATER) top--;
      let bot=top;
      while(bot+1<WORLD_BOTTOM && bot-top<EQ_BAND_DEPTH && readTile(seedX,bot+1)===T.WATER) bot++;
      const cols=[{x:seedX,top,bot}];
      for(const dir of [-1,1]){
        let pt=top, pb=bot;
        for(let step=1; step<=EQ_BAND_SPAN; step++){
          const x=seedX+dir*step;
          let f=-1; // water within the previous run's row span = surface-connected
          for(let y=pt; y<=pb; y++){ if(readTile(x,y)===T.WATER){ f=y; break; } }
          if(f<0) break;
          let t2=f; while(t2-1>=WORLD_TOP && readTile(x,t2-1)===T.WATER) t2--;
          let b2=f; while(b2+1<WORLD_BOTTOM && b2-t2<EQ_BAND_DEPTH && readTile(x,b2+1)===T.WATER) b2++;
          cols.push({x,top:t2,bot:b2});
          pt=t2; pb=b2;
        }
      }
      if(cols.length<8) return; // tiny band: the cell solver already covers it
      cols.sort((a,b)=>a.x-b.x);
      let loElev=Infinity, hiElev=-Infinity;
      for(const c of cols){
        c.fill=cellUnits(c.x,c.top);
        c.openAbove=c.top-1>=WORLD_TOP && canFill(readTile(c.x,c.top-1));
        c.elev=(WORLD_BOTTOM-c.top)*UNITS + c.fill;
        if(c.elev<loElev) loElev=c.elev;
        if(c.elev>hiElev) hiElev=c.elev;
      }
      // Only bulk imbalances (>= a full block of surface difference) are band work:
      // trimming sub-block lumps belongs to local equalization — band-topping thin
      // films re-arms their spread rule and creeps a puddle across the whole map.
      if(hiElev-loElev<UNITS) return;
      // Pair the highest surfaces directly with the lowest. Sharing toward the mean
      // moves (imbalance/width) per column, which rounds to ZERO units for a narrow
      // drawdown cone inside a wide flat ocean — the cliff around a drain would
      // never erode. Per pass each column donates at most its top cell and rises at
      // most one row, so every intermediate state stays gravity-consistent.
      const byHigh=[...cols].sort((a,b)=> b.elev-a.elev || a.x-b.x);
      const byLow=[...cols].sort((a,b)=> a.elev-b.elev || a.x-b.x);
      let budget=Math.min(EQ_RATE_MAX, Math.max(EQ_RATE, cols.length*3));
      let moved=0, hi=0, lo=0;
      while(budget>0 && hi<byHigh.length && lo<byLow.length){
        const s=byHigh[hi], d=byLow[lo];
        if(s===d) break;
        const gap=s.elev-d.elev;
        if(gap<2) break; // the extreme pair is level: every other pair is closer
        const takeCap=(UNITS-d.fill)+(d.openAbove?UNITS:0);
        if(takeCap<=0){ lo++; continue; }
        if(s.fill<=0){ hi++; continue; }
        const n=Math.min(budget, s.fill, Math.floor(gap/2), takeCap);
        if(n<=0){ hi++; continue; }
        let done=0;
        const into=Math.min(n, UNITS-d.fill); // top-up the destination's top cell first
        if(into>0) done+=moveUnits(s.x,s.top,d.x,d.top,into,getTile,setTile);
        if(done===into && n-done>0 && d.openAbove){ // remainder starts the row above
          done+=moveUnits(s.x,s.top,d.x,d.top-1,n-done,getTile,setTile);
        }
        if(done<=0){ hi++; continue; }
        s.fill-=done; s.elev-=done;
        const newFill=d.fill+done;
        if(newFill<=UNITS) d.fill=newFill;
        else {
          d.top=d.top-1; d.fill=newFill-UNITS;
          d.openAbove=d.top-1>=WORLD_TOP && canFill(readTile(d.x,d.top-1));
        }
        d.elev+=done;
        budget-=done; moved+=done;
        mark(s.x,s.top); mark(d.x,d.top);
        markNeighbors(active,d.x,d.top); markNeighbors(active,s.x,s.top);
        if(pressureSeeds.size<2000){ pressureSeeds.add(LPK(s.x,s.top)); pressureSeeds.add(LPK(d.x,d.top)); }
        noteTouched(s.x,s.top); noteTouched(d.x,d.top);
        if(s.fill<=0) hi++;
        if((UNITS-d.fill)+(d.openAbove?UNITS:0)<=0) lo++;
      }
      noteMoved(moved);
    };
    const seedSet=new Set(active); for(const kk of pressureSeeds) seedSet.add(kk); pressureSeeds.clear();
    const seeds=[...seedSet]; if(!seeds.length) return null; seeds.sort((a,b)=>a-b);
    // Fair sweep: only EQ_BODIES bodies run per pass, so a fixed left-to-right order
    // would let westernmost ±EQ_WINDOW bodies starve everything east of them (a
    // breach 200 columns away would never get solver attention). Resume each pass
    // just past the last seed the previous pass attempted, wrapping around.
    let startIdx=0;
    if(pressureSweepKey>-Infinity){
      let lo=0, hi=seeds.length;
      while(lo<hi){ const mid=(lo+hi)>>1; if(seeds[mid]<=pressureSweepKey) lo=mid+1; else hi=mid; }
      startIdx=lo>=seeds.length ? 0 : lo;
    }
    const processed=new Set(); // packed cell keys of bodies already handled this pass
    let bodies=0, stoppedAt=-1;
    const passT0=(typeof performance!=='undefined' && performance.now) ? performance.now() : 0;
    const deterministicBudget=!!(typeof window!=='undefined' && window.MM && MM.waterDeterministicPressureBudget);
    for(let n=0; n<seeds.length; n++){
      const seedIdx=(startIdx+n)%seeds.length;
      // Body-count and wall-clock budget: whatever is left resumes next pass instead
      // of being dropped (dropped seeds froze settled-but-unleveled bodies for good).
      if(bodies>=EQ_BODIES || (!deterministicBudget && bodies>0 && passT0 && performance.now()-passT0>EQ_TIME_BUDGET_MS)){ stoppedAt=n; break; }
      const key=seeds[seedIdx];
      pressureSweepKey=key;
      if(processed.has(key)) continue; // seed keys ARE packed cell keys (module LPK)
      const sx=Math.floor(key/512), sy=key-Math.floor(key/512)*512+WORLD_TOP-8;
      // Previous body's transfers mutated tiles: start each body from a fresh view.
      tileCache.clear();
      if(readTile(sx,sy)!==T.WATER) continue;
      // 1. connected water body (4-neighbor flood fill). Try the whole loaded body
      // first so wide lakes truly level. Oversized or spilling bodies fall back to
      // the bounded local window (open-air descent stays window-bounded, exactly the
      // shipped drain semantics) and additionally get the surface band pass so the
      // far field still flattens and keeps feeding the drain.
      let bodyInfo=collectBody(sx,sy,null,EQ_GLOBAL_BODY_SOFT_CAP);
      const bounded=bodyInfo.overflow || bodyInfo.hasSpill;
      if(bounded) bodyInfo=collectBody(sx,sy,EQ_WINDOW);
      const bc=bodyInfo.bodyCoords;
      for(let i=0;i<bc.length;i+=2) processed.add(PK(bc[i],bc[i+1]));
      bodies++;
      // Single-row bodies that are actively spilling (residual sheets draining into
      // a breach) are local-equalization territory: the solver's even re-split would
      // fight their stable taper every pass and its column cooldowns throttle the
      // very trickle that drains them. Sealed films (trench pours) still get the
      // solve — it converges to a flat film and then stops for good.
      const singleRow=bodyInfo.maxSurf===bodyInfo.minSurf;
      const drainingFilm=singleRow && bodyInfo.hasSpill;
      if(!bodyInfo.overflow && bodyInfo.bodyKeys.size>=2 && !drainingFilm) solveBody(bodyInfo,sx);
      // Single-row bodies can never pass the band's >=1-block-range gate (all tops
      // share a row): skip the walk instead of paying for it every pass.
      if(bounded && !singleRow) bandLevel(sx,sy);
    }
    if(stoppedAt>=0){
      for(let n=stoppedAt; n<seeds.length && pressureSeeds.size<2000; n++){
        const rk=seeds[(startIdx+n)%seeds.length];
        if(!processed.has(rk)) pressureSeeds.add(rk);
      }
    } else pressureSweepKey=-Infinity; // full sweep completed: restart from the west
    return {touchedXs, touchedTops, variance, hadTransfers};
  }

  function metrics(){ return {active:active.size, partials:partial.size, springs:springs.size, streams:streams.length, wetSand:wetSand.size, wetClay:wetClay.size, dryMud:dryMud.size, dryClay:dryClay.size, toxicWater:toxicWater.size, passiveScanColumns:passiveScanLastColumns, pressureMs:+pressureLastMs.toFixed(3), overlayCacheHits, overlayFullRenders, overlayReuseMs:+overlayReuseWindowMs().toFixed(2)}; }
  // Test/debug introspection (not used by the game loop)
  function _debug(){
    const levels=[];
    for(const [pk,u] of partial){ const x=Math.floor(pk/512), y=pk-x*512+WORLD_TOP-8; levels.push([x,y,u]); }
    const toxic=[];
    for(const [pk,ttl] of toxicWater){ const x=Math.floor(pk/512), y=pk-x*512+WORLD_TOP-8; toxic.push([x,y,ttl]); }
    return {active:[...active].map(pkToStr), seeds:[...pressureSeeds].map(pkToStr), cooldown:[...lateralCooldown.entries()], levels, toxicWater:toxic, wetSand:[...wetSand.values()], wetClay:[...wetClay.values()], dryMud:[...dryMud.values()], dryClay:[...dryClay.values()], restoreCaps:{active:RESTORE_ACTIVE_CAP,levels:RESTORE_LEVELS_CAP,toxic:RESTORE_TOXIC_WATER_CAP,material:RESTORE_MATERIAL_CAP}, pressureAcc, pressureIntervalCurrent, pressureLastMs, pressureMaxMs, passiveScanAcc, passiveScanOffset, passiveScanLastColumns, passiveScanTotalColumns, materialScanAcc, materialScanOffset};
  }
  // Sub-tile fill of a cell in units of 1/UNITS block (0 = no water, UNITS = full).
  function levelAt(x,y,getTile){
    if(typeof getTile!=='function' || !validTile(Math.floor(x),Math.floor(y))) return 0;
    return levelUnits(getTile,Math.floor(x),Math.floor(y));
  }

  MM.water = {update, addSource, drawOverlay, onTileChanged, onTilesChangedBatch, displaceAt, solidifyAt, disturb, noteChunkGenerated, reset, snapshot, restore, metrics, levelAt, polluteAt, isToxicAt, UNITS, _debug};
})();
// ESM export (progressive migration)
export const water = (typeof window!=='undefined' && window.MM) ? window.MM.water : undefined;
export default water;
