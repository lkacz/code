// Falling-solid physics: rigid bodies (stone clusters, diamonds) + granular sand.
// Event-driven design: tile edits queue "instability checks" (a Set of cells); the
// per-frame processor releases unstable tiles into moving entities. Sand obeys an
// angle-of-repose rule (a grain topples when a side and the cell below it are open),
// so piles relax into natural 45° slopes and avalanches propagate frame by frame.
import { CHUNK_W, T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, HERO_BODY_W, HERO_BODY_H } from '../constants.js';
import {
  buildMaterialProfile as sharedBuildMaterialProfile,
  fallingWindResponseForMaterial,
  isBuildAnchorTile as sharedBuildAnchorTile,
  isBuildFoundationTile as sharedBuildFoundationTile,
  isBuiltPillarMaterial as sharedBuiltPillarMaterial,
  isFragileFallingMaterial,
  isGasTile,
  isLoadBearingSupportTile,
  isLegacyPhysicsAuditMaterial,
  isLooseRigidMaterial,
  isMountedFixtureTile,
  isNaturalFloatingAnchorTile,
  isNaturalFloatingCohesionTile,
  isObjectCrushableSupportTile,
  isObjectBraceTile,
  isObjectFootingTile,
  isPassableForFalling,
  isPlayerBuiltMaterial as sharedPlayerBuiltMaterial,
  isRigidObjectTile,
  isRubbleTrackedMaterial as sharedRubbleTrackedMaterial,
  isStructuralMaterial,
  isUfoVaultMaterial,
  isWeakFillMaterial,
  structuralRubbleRollLimit,
  structuralSupportStrengthForMaterial
} from './material_physics.js';
import { heroLoadWeight } from './hero_crush.js';
import { authoritativeBodyBlocksCell, COOP_BODY_ONLY } from './body_footprint.js';
import { skyBiomeNaturalFabricTile } from './world_layers.js';
window.MM = window.MM || {};
(function(){
  const G_AIR = 60,  G_WATER = 25;            // gravity (tiles/s^2); buoyancy reduces it in water
  const VMAX_AIR = 55, VMAX_WATER = 9;        // terminal velocity for rigid blocks
  const SAND_VMAX_AIR = 70, SAND_VMAX_WATER = 7; // sand drifts down slowly through water
  const QUEUE_BUDGET = 360;                   // instability checks per frame (cascades span frames)
  const QUEUE_BUDGET_LOW_FPS = 120;
  const QUEUE_BUDGET_CRITICAL = 48;
  const CHANGE_BATCH_WAKE_CAP = 128;
  const CLUSTER_CAP = 4000;                   // larger structural clusters are treated as bedrock-stable
  const ACTIVE_RIGID_CAP = 1100;              // settle huge city cascades in chunks instead of dragging FPS for seconds
  const SAND_SETTLE_ROLL_LIMIT = 96;          // save-time grains must pile, not stack straight up
  const CHUNK_AUDIT_INTERVAL_MS = 2200;       // visible city chunks are rechecked occasionally, not every frame
  const BUILT_PILLAR_CAP = 2200;              // covers every world-height ordinary pillar narrow enough to be unstable
  const PLAYER_BUILT_CAP = 2600;              // per-component cap for user-built structural checks
  const PLAYER_BUILT_SAVE_CAP = 26000;
  const BUILD_STRESS_CAP = 5000;
  const BUILD_STRESS_WARN = 0.28;
  const BUILD_STRESS_DANGER = 0.68;
  const BUILD_STRESS_FAIL = 0.94;
  const BUILD_FLOW_RESISTANCE_SCALE = 3.8;
  const BUILD_FLOW_REACH_SCALE = 1.18;
  const BUILD_FLOW_LOAD_STRESS = 0.56;
  const BUILD_FLOW_TRANSFER_STRESS = 0.035;
  const BUILD_BEARING_CAPACITY_SCALE = 3.0;
  const BUILD_BEARING_BACKING_LIMIT = 28;
  const BUILD_BEARING_CRUSH_RATIO = 1.05;
  const BUILD_BREAK_EFFECT_MS = 900;
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const active = [];          // rigid blocks {x,yFloat,type,vy,wet,rubble}
  const sandActive = [];      // flowing sand grains {x,yFloat,vy,wet}
  const unstable = new Set(); // 'x,y' cells awaiting a stability check
  const quietStable = new Map(); // key -> local tile signature last proven stable
  const auditJobs = [];       // chunk stability scans {cx,lx}
  const auditPending = new Set();
  const auditLast = new Map();
  const manualCityBuilt = new Set(); // player/event placed city tiles; generated city stays on city-collapse logic
  const playerBuilt = new Set(); // user placed build materials; natural terrain is intentionally excluded
  const buildStress = new Map(); // key -> 0..1 warning intensity for supported-but-near-limit blocks
  const buildStressFlow = new Map(); // key -> normalized direction where load is flowing
  const buildBreaks = []; // short-lived visual flashes where player-built structure snapped
  const buildBearingLoads = new WeakMap(); // supported-built Map -> external footing load map
  const buildFlowDirections = new WeakMap(); // supported-built Map -> cell force-flow directions
  const buildPressureRatios = new WeakMap(); // supported-built Map -> visible pressure receiver ratios
  const settledRubble = new Set(); // structural debris that already fell and should not become a new building frame
  // Protected structures (e.g. procedurally placed NPC houses) are exempt from every
  // collapse pathway here — they neither get claimed as player builds, audited, nor
  // toppled, and they never queue for sand/glass/pillar processing. The player can
  // still mine them: onTileRemoved frees the slot, so damage is permanent and other
  // systems (NPC house integrity) react to it, but nothing collapses on its own.
  const protectedBuilds = new Set(); // 'x,y' cells owned by a managed structure
  const PROTECTED_SAVE_CAP = 40000;
  // Tile accessors supplied by main.js; update() refreshes them so event-driven
  // helpers (onTileRemoved etc.) always see the live world.
  let getTile = null, setTile = null;
  function init(gt, st){ getTile = gt; setTile = st; }
  const key = (x,y)=>x+','+y;
  function normalizedWorldCell(x,y){
    if(!finiteX(x) || !Number.isFinite(y)) return null;
    x=Math.floor(x); y=Math.floor(y);
    return inWorldY(y) ? {x,y} : null;
  }
  function inWorldY(y){ return Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function activeAuditRange(){
    const p=(typeof window!=='undefined' && window.player) ? window.player : null;
    const py=(p && Number.isFinite(p.y)) ? p.y : WORLD_H/2;
    if(py<0) return {top:WORLD_TOP, bottom:Math.min(WORLD_BOTTOM-1,WORLD_H-1)};
    if(py>=WORLD_H) return {top:Math.max(WORLD_TOP,WORLD_H), bottom:WORLD_BOTTOM-1};
    return {top:Math.max(WORLD_TOP,0), bottom:Math.min(WORLD_BOTTOM-1,WORLD_H-1)};
  }
  function constructionBackgroundTile(x,y){
    try{
      const w=window.MM && MM.world;
      const t=(w && w.getConstructionBackground) ? w.getConstructionBackground(x,y) : T.AIR;
      return sharedPlayerBuiltMaterial(t) ? t : T.AIR;
    }catch(e){ return T.AIR; }
  }
  function buildSupportTile(x,y,tileFn){
    const fg=(tileFn || getTile)(x,y);
    if(sharedBuildFoundationTile(fg) || sharedBuildAnchorTile(fg)) return fg;
    const bg=constructionBackgroundTile(x,y);
    return bg!==T.AIR ? bg : fg;
  }
  function isProtectedBuild(x,y){ return protectedBuilds.has(key(x,y)); }
  function protectBuild(x,y){
    const cell=normalizedWorldCell(x,y);
    if(!cell || protectedBuilds.size>=PROTECTED_SAVE_CAP) return false;
    const k=key(cell.x,cell.y);
    protectedBuilds.add(k);
    // A protected tile is, by definition, stable: drop any pending churn for it.
    unstable.delete(k);
    playerBuilt.delete(k);
    manualCityBuilt.delete(k);
    return true;
  }
  function unprotectBuild(x,y){
    const cell=normalizedWorldCell(x,y);
    return !!cell && protectedBuilds.delete(key(cell.x,cell.y));
  }
  function protectStructure(cells){
    if(!Array.isArray(cells)) return 0;
    let n=0;
    const scan=Math.min(cells.length,PROTECTED_SAVE_CAP);
    for(let i=0;i<scan && protectedBuilds.size<PROTECTED_SAVE_CAP;i++){
      let c=null;
      try{ c=cells[i]; }catch(e){ continue; }
      if(c && protectBuild(c.x,c.y)) n++;
    }
    return n;
  }
  function supportSignature(x,y){
    if(!getTile) return '';
    return getTile(x,y)+'|'+constructionBackgroundTile(x,y)+'/'+
      getTile(x,y+1)+'|'+constructionBackgroundTile(x,y+1)+'/'+
      getTile(x-1,y)+'|'+constructionBackgroundTile(x-1,y)+'/'+
      getTile(x+1,y)+'|'+constructionBackgroundTile(x+1,y)+'/'+
      getTile(x,y-1)+'|'+constructionBackgroundTile(x,y-1);
  }
  function markQuiet(x,y){
    if(!getTile || !inWorldY(y)) return;
    if(quietStable.size>12000) quietStable.clear();
    quietStable.set(key(x,y), supportSignature(x,y));
  }
  function markQuietCluster(cluster){
    for(const c of cluster) markQuiet(c.x,c.y);
  }
  function rubbleCanLeaveCell(c,fallingKeys){
    if(!c) return false;
    const below=getTile(c.x,c.y+1);
    if(passable(below) || rubbleCrushes(below)) return true;
    if(fallingKeys && fallingKeys.has(key(c.x,c.y+1))) return true;
    for(const dir of [-1,1]){
      if(!passable(getTile(c.x+dir,c.y))) continue;
      const diag=getTile(c.x+dir,c.y+1);
      if(passable(diag) || rubbleCrushes(diag)) return true;
    }
    return false;
  }

  // Falling solids pass through passable fixtures instead of treating torches,
  // leaves, wires, graves, lava, etc. as invisible foundations.
  function passable(t){ return isPassableForFalling(t); }
  function notifyGasChange(x,y,oldTile,newTile){
    if(oldTile===newTile || (!isGasTile(oldTile) && !isGasTile(newTile))) return;
    try{ const g=window.MM && MM.gases; if(g && g.onTileChanged) g.onTileChanged(x,y,oldTile,newTile); }catch(e){}
  }
  function isStructural(t){ return isStructuralMaterial(t); }
  function isFragileFalling(t){ return isFragileFallingMaterial(t); }
  function isLooseRigid(t){ return isLooseRigidMaterial(t); }
  function isRigidObject(t){ return isRigidObjectTile(t); }
  function isMountedFixture(t){ return isMountedFixtureTile(t); }
  function isPlayerBuiltMaterial(t){ return sharedPlayerBuiltMaterial(t); }
  function isNaturalSkyCohesionAt(x,y,t){
    if(y>=0 || isTrackedPlayerBuild(x,y)) return false;
    if(isNaturalFloatingCohesionTile(t)) return true;
    // Themed sky biome fabric (world_layers SKY_BIOMES): mirage sand, wreck
    // steel, ember coal etc. are natural island mass in THEIR region only —
    // the same materials keep full physics everywhere else (incl. the neutral
    // home sky), and player-placed tiles are already excluded above.
    try{ return skyBiomeNaturalFabricTile(window.MM && MM.worldGen, x, t); }catch(e){ return false; }
  }
  function naturalFloatingAnchorAt(x,y,t){
    return y<0 && isNaturalFloatingAnchorTile(t);
  }
  function naturalFloatingAnchorNear(x,y){
    if(y>=0) return false;
    const ns=[[0,0],[1,0],[-1,0],[0,-1],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]];
    for(const n of ns){
      if(naturalFloatingAnchorAt(x+n[0],y+n[1],getTile(x+n[0],y+n[1]))) return true;
    }
    return false;
  }
  function rememberPlayerBuild(x,y){
    if(!getTile || !isPlayerBuiltMaterial(getTile(x,y))) return;
    const k=key(x,y);
    if(playerBuilt.size>PLAYER_BUILT_SAVE_CAP) playerBuilt.clear();
    playerBuilt.add(k);
    quietStable.delete(k);
  }
  function forgetPlayerBuild(x,y){
    const k=key(x,y);
    playerBuilt.delete(k);
    buildStress.delete(k);
    buildStressFlow.delete(k);
  }
  function syncPlayerBuild(x,y){
    forgetPlayerBuild(x,y);
    rememberPlayerBuild(x,y);
  }
  function isTrackedPlayerBuild(x,y){
    const k=key(x,y);
    if(!playerBuilt.has(k)) return false;
    if(isPlayerBuiltMaterial(getTile(x,y))) return true;
    playerBuilt.delete(k);
    buildStress.delete(k);
    return false;
  }
  function legacyBuildMaterial(t){
    return isPlayerBuiltMaterial(t);
  }
  function knownTreeTile(x,y){
    const tr=window.MM && MM.trees;
    try{
      if(tr && tr._tileTreeIds && tr._tileTreeIds.has && tr._tileTreeIds.has(key(x,y))) return true;
      if(tr && tr._fallenTreeTiles && tr._fallenTreeTiles.has && tr._fallenTreeTiles.has(key(x,y))) return true;
    }catch(e){}
    return false;
  }
  function likelyTreeWood(x,y){
    if(getTile(x,y)!==T.WOOD || knownTreeTile(x,y)) return knownTreeTile(x,y);
    let vertical=1;
    for(let yy=y-1; yy>=y-4 && getTile(x,yy)===T.WOOD; yy--) vertical++;
    for(let yy=y+1; yy<=y+4 && getTile(x,yy)===T.WOOD; yy++) vertical++;
    if(vertical<2) return false;
    for(let yy=y-5; yy<=y+2; yy++){
      for(let xx=x-4; xx<=x+4; xx++){
        const t=getTile(xx,yy);
        if(t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED) return true;
      }
    }
    return false;
  }
  function claimLegacyPlayerBuild(x,y,t){
    if(isProtectedBuild(x,y)) return false;
    if(isTrackedPlayerBuild(x,y)) return true;
    if(isSettledRubble(x,y)) return false;
    if(!getTile || !legacyBuildMaterial(t) || !isPlayerBuiltMaterial(t)) return false;
    if(!aboveGeneratedSurface(x,y)) return false;
    if(isNaturalSkyCohesionAt(x,y,t)) return false;
    if(t===T.WOOD && likelyTreeWood(x,y)) return false;
    if(knownTreeTile(x,y)) return false;
    const k=key(x,y);
    if(playerBuilt.size>PLAYER_BUILT_SAVE_CAP) playerBuilt.clear();
    playerBuilt.add(k);
    quietStable.delete(k);
    return true;
  }
  function isRubbleTrackedMaterial(t){ return sharedRubbleTrackedMaterial(t); }
  function isObjectFooting(t){ return isObjectFootingTile(t); }
  function isObjectBrace(t){ return isObjectBraceTile(t); }
  function objectAnchorAt(x,y){
    if(y+1>=WORLD_BOTTOM) return true;
    if(isObjectFooting(getTile(x,y+1))) return true;
    // Sky-island relics (solar gear etc.) legitimately rest on natural island
    // fabric like glass shells or meteor dust.
    if(isNaturalSkyCohesionAt(x,y+1,getTile(x,y+1))) return true;
    if(isObjectBrace(getTile(x-1,y)) || isObjectBrace(getTile(x+1,y)) || isObjectBrace(getTile(x,y-1))) return true;
    return false;
  }
  function isDynamoTile(t){ return t===T.DYNAMO || t===T.DYNAMO_SLOT; }
  function dynamoCellsAt(x,y){
    const d=window.MM && MM.dynamo;
    let cells=[];
    try{ if(d && d.structureCellsAt) cells=d.structureCellsAt(x,y,getTile) || []; }catch(e){ cells=[]; }
    if(!Array.isArray(cells) || !cells.length){
      const t=getTile(x,y);
      return isDynamoTile(t) ? [{x,y,t,role:'orphan'}] : [];
    }
    const seen=new Set();
    const out=[];
    for(const c of cells){
      const cx=Math.floor(c.x), cy=Math.floor(c.y);
      const t=getTile(cx,cy);
      if(!isDynamoTile(t)) continue;
      const k=key(cx,cy);
      if(seen.has(k)) continue;
      seen.add(k);
      out.push({x:cx,y:cy,t,role:c.role});
    }
    return out;
  }
  function completeDynamoCellsAt(x,y){
    const cells=dynamoCellsAt(x,y);
    if(cells.length!==3) return null;
    let casings=0, slots=0;
    for(const c of cells){
      if(c.t===T.DYNAMO) casings++;
      else if(c.t===T.DYNAMO_SLOT) slots++;
    }
    return casings===2 && slots===1 ? cells : null;
  }
  function dynamoCompositeAnchorAt(cells,cellKeys){
    for(const c of cells){
      if(c.y+1>=WORLD_BOTTOM) return true;
      const belowKey=key(c.x,c.y+1);
      if(!cellKeys.has(belowKey) && isObjectFooting(getTile(c.x,c.y+1))) return true;
      const sideChecks=[[c.x-1,c.y],[c.x+1,c.y],[c.x,c.y-1]];
      for(const p of sideChecks){
        if(cellKeys.has(key(p[0],p[1]))) continue;
        if(isObjectBrace(getTile(p[0],p[1]))) return true;
      }
    }
    return false;
  }
  function crushDynamoWeakFootings(cells,cellKeys){
    const crushed=new Set();
    for(const c of cells){
      const x=c.x, y=c.y+1;
      if(y>=WORLD_BOTTOM || cellKeys.has(key(x,y))) continue;
      const support=getTile(x,y);
      if(!isObjectCrushableSupportTile(support)) continue;
      const k=key(x,y);
      if(crushed.has(k)) continue;
      crushed.add(k);
      setTile(x,y,T.AIR);
      forgetPlayerBuild(x,y);
      forgetSettledRubble(x,y);
      if(isFragileFalling(support)) breakFragile(x,y);
      else spawn(x,y,support,isRubbleTrackedMaterial(support),0.85);
      queueAroundRemoval(x,y);
      releaseBackgroundAt(x,y);
    }
  }
  function processDynamoCompositeAt(x,y,processed){
    if(!isDynamoTile(getTile(x,y))) return false;
    const cells=completeDynamoCellsAt(x,y);
    if(!cells) return false;
    const cellKeys=new Set(cells.map(c=>key(c.x,c.y)));
    for(const c of cells){
      const ck=key(c.x,c.y);
      if(processed) processed.add(ck);
      unstable.delete(ck);
    }
    if(dynamoCompositeAnchorAt(cells,cellKeys)){
      markQuietCluster(cells);
      return true;
    }
    crushDynamoWeakFootings(cells,cellKeys);
    for(const c of cells){
      if(getTile(c.x,c.y)!==c.t) continue;
      setTile(c.x,c.y,T.AIR);
      spawn(c.x,c.y,c.t,false);
      queueAroundRemoval(c.x,c.y);
    }
    releaseBackgroundCluster(cells);
    return true;
  }
  function isLoadBearingSupport(t){ return isLoadBearingSupportTile(t); }
  function isStructuralFootingSupport(t){ return isLoadBearingSupport(t) || isWeakFillMaterial(t); }
  function spawn(x,y,t,rubble,stress){ active.push({x,yFloat:y,type:t,vy:0,wet:false,rubble:!!rubble,windCarry:0,stress:Math.max(0,Math.min(1,stress||0))}); }
  // When physics tears a foreground cell out of a structure, the back wall
  // behind it (house/city interior backdrop on the construction-background
  // layer) breaks loose with it: it leaves the background layer and falls as an
  // ordinary foreground block. Called only at grid-cell collapse sites — never
  // from entity-landing shatter, which happens at unrelated coordinates.
  function releaseBackgroundAt(x,y){
    try{
      const w=window.MM && MM.world;
      if(!w || !w.getConstructionBackground || !w.clearConstructionBackground) return;
      const bg=w.getConstructionBackground(x,y);
      if(!bg || bg===T.AIR) return;
      w.clearConstructionBackground(x,y);
      if(isFragileFalling(bg)){ breakFragile(x,y); return; }
      if(passable(getTile(x,y))) spawn(x,y,bg,isRubbleTrackedMaterial(bg),0.75);
      // else: an intact foreground block still fills the cell — the wall face
      // behind it simply crumbles away.
    }catch(e){}
  }
  // Interior back walls live behind AIR cells, so a collapsing shell never
  // overlaps them directly. When a whole cluster breaks loose, peel every
  // contiguous backdrop region touching the released cells: the rooms those
  // back walls belonged to are gone, and the panels fall as foreground blocks
  // instead of hovering as a ghost outline of the old building.
  function releaseBackgroundCluster(cells){
    try{
      const w=window.MM && MM.world;
      if(!w || !w.getConstructionBackground || !w.clearConstructionBackground) return;
      const stack=[];
      for(const c of cells){
        const cx=Number.isFinite(c.x)?c.x:null;
        if(cx===null) continue;
        for(const d of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
          if(w.getConstructionBackground(c.x+d[0],c.y+d[1])!==T.AIR) stack.push([c.x+d[0],c.y+d[1]]);
        }
      }
      if(!stack.length) return;
      const seen=new Set();
      let released=0;
      while(stack.length && released<512){
        const cell=stack.pop();
        const bx=cell[0], by=cell[1];
        const k=bx+','+by;
        if(seen.has(k)) continue;
        seen.add(k);
        if(w.getConstructionBackground(bx,by)===T.AIR) continue;
        releaseBackgroundAt(bx,by);
        released++;
        stack.push([bx+1,by],[bx-1,by],[bx,by+1],[bx,by-1]);
      }
    }catch(e){}
  }
  function spawnSand(x,y){ sandActive.push({x,yFloat:y,vy:0,wet:false,windCarry:0}); }
  function isSettledRubble(x,y){
    const k=key(x,y);
    if(!settledRubble.has(k)) return false;
    if(isRubbleTrackedMaterial(getTile(x,y))) return true;
    settledRubble.delete(k);
    return false;
  }
  function markSettledRubble(x,y,type){
    if(!isRubbleTrackedMaterial(type)) return;
    if(settledRubble.size>22000) settledRubble.clear();
    settledRubble.add(key(x,y));
  }
  function forgetSettledRubble(x,y){ settledRubble.delete(key(x,y)); }

  function notifyWater(x,y){ try{ const w=window.MM && MM.water; if(w && w.onTileChanged && getTile) w.onTileChanged(x,y,getTile); }catch(e){} }
  // A solid settling into a water cell pushes the water out (up or sideways) instead of deleting it
  function displaceWater(x,y){ try{ const w=window.MM && MM.water; if(w && w.displaceAt) w.displaceAt(x,y,getTile,setTile); }catch(e){} }
  function splash(x,yFloat,vy){ try{ const p=window.MM && MM.particles; if(p && p.spawnSplash){ const TILE=MM.TILE||20; p.spawnSplash((x+0.5)*TILE, Math.floor(yFloat)*TILE, Math.min(1, Math.abs(vy)/20)); } const w=window.MM && MM.water; if(w && w.disturb) w.disturb(x, Math.min(300, Math.abs(vy)*14)); }catch(e){} }

  function windSpeedAt(x,y){
    try{
      const w=window.MM && MM.wind;
      if(!w) return 0;
      const v=typeof w.speedAt === 'function'
        ? w.speedAt(x,y,getTile)
        : (typeof w.speed === 'function' ? w.speed() : 0);
      return Number.isFinite(v) ? Math.max(-6, Math.min(6, v)) : 0;
    }catch(e){ return 0; }
  }
  function fallingWindResponse(type,rubble){
    return fallingWindResponseForMaterial(type,rubble);
  }
  function canWindShift(x,y,dir){
    if(!inWorldY(y)) return false;
    if(!passable(getTile(x+dir,y))) return false;
    if(bodyBlocks(x+dir,y)) return false;
    return true;
  }
  function applyWindToFalling(e,type,dt,inWater){
    if(!e || !(dt>0)) return false;
    const sp=windSpeedAt(e.x+0.5,e.yFloat);
    if(Math.abs(sp)<0.08) return false;
    const response=fallingWindResponse(type,!!e.rubble) * (inWater ? 0.18 : 1);
    if(response<=0) return false;
    e.windCarry=Math.max(-2.2, Math.min(2.2, (e.windCarry||0) + sp*response*dt));
    let moved=false, guard=0;
    while(Math.abs(e.windCarry)>=1 && guard++<2){
      const dir=e.windCarry<0 ? -1 : 1;
      const y=Math.floor(e.yFloat);
      if(!canWindShift(e.x,y,dir)){ e.windCarry*=0.35; break; }
      e.x+=dir;
      e.windCarry-=dir;
      moved=true;
    }
    return moved;
  }

  // The host-only probe feeds crush/jump load accounting. World settlement uses
  // the shared probe below so live and dead authoritative guests get equal AABBs.
  function hostPlayerBlocks(x,y){ const p=window.player; if(!p) return false; const w=Number.isFinite(p.w)&&p.w>0?p.w:HERO_BODY_W, h=Number.isFinite(p.h)&&p.h>0?p.h:HERO_BODY_H; return x+1 > p.x-w/2 && x < p.x+w/2 && y+1 > p.y-h/2 && y < p.y+h/2; }
  function bodyBlocks(x,y){ return authoritativeBodyBlocksCell(x,y); }
  function guestBodyBlocks(x,y){ return authoritativeBodyBlocksCell(x,y,COOP_BODY_ONLY); }
  function forcedBodyFreeRest(startX,startY){
    for(let radius=0;radius<=8;radius++){
      const offsets=radius===0?[0]:[-radius,radius];
      for(const dx of offsets){
        const x=startX+dx;
        let y=clampY(startY);
        while(y>WORLD_TOP && !passable(getTile(x,y))) y--;
        if(!passable(getTile(x,y))) continue;
        while(y<WORLD_BOTTOM-1 && passable(getTile(x,y+1))) y++;
        if(!bodyBlocks(x,y)) return {x,y};
      }
    }
    return null;
  }
  // Live-settle sentinel: the roll/stack target landed on a body — keep the
  // entity hovering instead of materializing a tile onto him (returned by
  // occupy/settleSand/settleRubble when force is falsy).
  const BODY_REST=-2;
  // Hover-pile resolver: entities resting on a body used to all freeze in the
  // SAME cell (drawn on top of each other — an avalanche read as one flickering
  // block; the older stack-upward rule extruded an absurd 1-wide tower instead).
  // Now each hover cell holds ONE entity: the next claimant is shed sideways
  // with a nudge so it resumes falling BESIDE the body, and only when both
  // sides are walled does the pile grow a row upward. Claims are rebuilt every
  // frame from the entities that actually stay hovering.
  const hoverClaims=new Set();
  function restOnBody(e,x,y){
    let cy=y, guard=0;
    // Never park inside the body itself: ride up to the crown first — the
    // load sits ON the head, not across the torso (the visual overlap bug).
    while(guard++<8 && bodyBlocks(x,cy) && inWorldY(cy-1) && passable(getTile(x,cy-1))) cy-=1;
    const crown=cy;
    const k0=key(x,cy);
    if(!hoverClaims.has(k0)){ hoverClaims.add(k0); e.vy=0; e.yFloat=cy; return true; }
    // shed: a free passable side cell — the entity rolls off the mound and keeps falling
    const dirs=((x+cy)&1)?[1,-1]:[-1,1];
    for(const dir of dirs){
      if(!inWorldY(cy) || !passable(getTile(x+dir,cy))) continue;
      if(hoverClaims.has(key(x+dir,cy))) continue;
      e.x=x+dir; e.yFloat=cy; e.vy=2.2;
      return false; // airborne again — lands next to the body on its own
    }
    while(guard++<10){
      cy-=1;
      if(cy<=WORLD_TOP || !passable(getTile(x,cy))) break;
      const k=key(x,cy);
      if(!hoverClaims.has(k)){ hoverClaims.add(k); e.vy=0; e.yFloat=cy; return true; }
    }
    e.vy=0; e.yFloat=crown; // walled-in worst case: overlap beats losing the entity
    return true;
  }
  // A docked entity rests on the crown above a body. Left to gravity it would
  // drift off its cell every frame and release the hover claim, letting the
  // whole pile play musical chairs on one cell and never spread. While the body
  // is still underneath, keep it parked and hold its claim so later arrivals
  // shed around it; when the body leaves, it resumes falling on its own.
  function dockedOnBody(e){
    if(e.vy!==0) return false;
    const x=e.x, y=Math.floor(e.yFloat);
    return bodyBlocks(x,y+1) || bodyBlocks(x,y+2);
  }
  // Load currently resting on the hero (hovering entities). main.js uses this to
  // block jumping under a pile — jump-spam used to ratchet the hero up through
  // his own debris, extruding a 1-wide chimney — and to crush when it is too heavy.
  // A resting entity now parks on the CROWN cell above the body (restOnBody
  // climbs out of the torso), so "resting on the hero" means the hero is in
  // the entity's cell OR directly beneath it.
  function heroRests(x,yi){ return hostPlayerBlocks(x,yi) || hostPlayerBlocks(x,yi+1); }
  function heroRestingLoad(){
    let count=0, weight=0;
    for(const b of active){
      if(b.vy!==0) continue;
      if(!heroRests(b.x,Math.floor(b.yFloat))) continue;
      count++; weight+=heroLoadWeight(b.type);
    }
    for(const s of sandActive){
      if(s.vy!==0) continue;
      if(!heroRests(s.x,Math.floor(s.yFloat))) continue;
      count++; weight+=heroLoadWeight(T.SAND);
    }
    return {count,weight};
  }
  function rubbleCrushes(t){ return isObjectCrushableSupportTile(t); }
  function crushTile(x,y){
    const t=getTile(x,y);
    if(!rubbleCrushes(t)) return false;
    setTile(x,y,T.AIR);
    forgetSettledRubble(x,y);
    queueAroundRemoval(x,y);
    if(isFragileFalling(t)) breakFragile(x,y);
    else spawn(x,y,t,isRubbleTrackedMaterial(t),0.85);
    releaseBackgroundAt(x,y);
    return true;
  }

  // Write a settled solid into the world, displacing (not destroying) any water there.
  // Every authoritative body is a block too: live settles hover; forced settles
  // preserve the host's overhead-stack rule and divert around remote footprints,
  // so a tile is never serialized through a guest body.
  function occupy(x,y,type,force){
    let yy=y; while(yy>WORLD_TOP && !passable(getTile(x,yy))) yy--; // cell may have been claimed this frame — stack upward
    if(bodyBlocks(x,yy)){
      if(!force) return BODY_REST;
      if(guestBodyBlocks(x,yy)){
        const rest=forcedBodyFreeRest(x,yy);
        if(!rest) return BODY_REST;
        x=rest.x; yy=rest.y;
      } else {
        let hy=yy;
        while(hy>WORLD_TOP && (bodyBlocks(x,hy) || !passable(getTile(x,hy)))) hy--;
        if(!passable(getTile(x,hy)) || bodyBlocks(x,hy)) return BODY_REST;
        yy=hy;
      }
    }
    const was=getTile(x,yy);
    if(was===T.WATER) displaceWater(x,yy);
    setTile(x,yy,type);
    forgetSettledRubble(x,yy);
    notifyGasChange(x,yy,was,type);
    if(was===T.WATER) notifyWater(x,yy);
    return {x,y:yy};
  }

  function clampY(y){
    const yy=Math.floor(y);
    return Number.isFinite(yy) ? Math.max(WORLD_TOP, Math.min(WORLD_BOTTOM-1, yy)) : 0;
  }
  function finiteX(x){ return Number.isFinite(x) && Math.abs(x)<10000000; }
  function validFallingType(t){ return Number.isInteger(t) && !!INFO[t]; }
  function restoredRigid(raw){
    if(!raw || !finiteX(raw.x) || !Number.isFinite(raw.y) || !validFallingType(raw.type)) return null;
    return {
      x:Math.floor(raw.x),
      yFloat:Math.max(WORLD_TOP,Math.min(WORLD_BOTTOM-1,raw.y)),
      type:raw.type,
      vy:Number.isFinite(raw.vy)?Math.max(-120,Math.min(120,raw.vy)):0,
      windCarry:Number.isFinite(raw.windCarry)?Math.max(-4,Math.min(4,raw.windCarry)):0,
      wet:false,
      rubble:!!raw.rubble
    };
  }
  function restoredSand(raw){
    if(!raw || !finiteX(raw.x) || !Number.isFinite(raw.y)) return null;
    return {
      x:Math.floor(raw.x),
      yFloat:Math.max(WORLD_TOP,Math.min(WORLD_BOTTOM-1,raw.y)),
      vy:Number.isFinite(raw.vy)?Math.max(-120,Math.min(120,raw.vy)):0,
      windCarry:Number.isFinite(raw.windCarry)?Math.max(-4,Math.min(4,raw.windCarry)):0,
      wet:false
    };
  }
  function dropY(x,y){
    let yy=clampY(y);
    while(yy>WORLD_TOP && !passable(getTile(x,yy))) yy--;
    while(yy<WORLD_BOTTOM-1 && passable(getTile(x,yy+1))) yy++;
    return yy;
  }
  function rollDepth(x,y){
    let yy=clampY(y), d=0;
    while(d<32 && yy<WORLD_BOTTOM-1 && passable(getTile(x,yy+1))){ yy++; d++; }
    return d;
  }
  function chooseSandRollDir(x,y,originX,step){
    if(y+1>=WORLD_BOTTOM) return 0;
    const dirs=[];
    for(const dir of [-1,1]){
      if(passable(getTile(x+dir,y)) && passable(getTile(x+dir,y+1))) dirs.push({dir, depth:rollDepth(x+dir,y+1)});
    }
    if(!dirs.length) return 0;
    if(dirs.length===1) return dirs[0].dir;
    if(dirs[0].depth!==dirs[1].depth) return dirs[0].depth>dirs[1].depth ? dirs[0].dir : dirs[1].dir;
    return ((originX + y + step) & 1) ? 1 : -1;
  }
  function queueAroundSettle(x,y){
    queueCheck(x,y); queueCheck(x,y-1);
    queueCheck(x-1,y); queueCheck(x+1,y);
    queueCheck(x-1,y-1); queueCheck(x+1,y-1);
  }
  function glassAnchorAt(x,y){
    if(naturalFloatingAnchorNear(x,y)) return true;
    const ns=[[1,0],[-1,0],[0,-1],[0,1]];
    for(const n of ns){
      const t=getTile(x+n[0],y+n[1]);
      if(isLoadBearingSupport(t) || isStructural(t)) return true;
    }
    return false;
  }
  function processFragileAt(sx,sy,processed){
    if(getTile(sx,sy)!==T.GLASS || processed.has(key(sx,sy))) return false;
    const stack=[[sx,sy]], seen=new Set(), cluster=[];
    let anchored=false, capped=false;
    while(stack.length){
      const [x,y]=stack.pop();
      const k=key(x,y);
      if(seen.has(k) || getTile(x,y)!==T.GLASS) continue;
      seen.add(k);
      cluster.push({x,y});
      if(glassAnchorAt(x,y)) anchored=true;
      if(cluster.length>512){ capped=true; anchored=true; break; }
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    for(const c of cluster){ const ck=key(c.x,c.y); processed.add(ck); unstable.delete(ck); }
    if(anchored || capped){ markQuietCluster(cluster); return false; }
    for(const c of cluster){
      if(getTile(c.x,c.y)===T.GLASS){
        setTile(c.x,c.y,T.AIR);
        spawn(c.x,c.y,T.GLASS);
        queueAroundRemoval(c.x,c.y);
        releaseBackgroundAt(c.x,c.y);
      }
    }
    return cluster.length>0;
  }
  function isBuiltPillarMaterial(t){
    return sharedBuiltPillarMaterial(t);
  }
  function aboveGeneratedSurface(x,y){
    const wg=window.MM && MM.worldGen;
    if(!wg || !wg.surfaceHeight) return false;
    try{
      if(wg.biomeType && wg.biomeType(x)===8 && !manualCityBuilt.has(key(x,y))) return false;
      return y < wg.surfaceHeight(x);
    }catch(e){ return false; }
  }
  function rememberManualCityBuild(x,y){
    if(!getTile || !isBuiltPillarMaterial(getTile(x,y))) return;
    const wg=window.MM && MM.worldGen;
    if(!wg || !wg.biomeType || !wg.surfaceHeight) return;
    try{
      if(wg.biomeType(x)!==8 || y>=wg.surfaceHeight(x)) return;
      if(manualCityBuilt.size>20000) manualCityBuilt.clear();
      manualCityBuilt.add(key(x,y));
    }catch(e){}
  }
  function forgetManualCityBuild(x,y){
    manualCityBuilt.delete(key(x,y));
  }
  function syncManualCityBuild(x,y){
    forgetManualCityBuild(x,y);
    rememberManualCityBuild(x,y);
  }
  function canJoinBuiltPillar(x,y){
    if(isSettledRubble(x,y)) return false;
    const t=getTile(x,y);
    return isBuiltPillarMaterial(t) && aboveGeneratedSurface(x,y);
  }
  function pillarSideBrace(t){
    return isLoadBearingSupport(t) || isStructural(t);
  }
  function maxContiguousRun(xs){
    if(!xs.length) return 0;
    xs.sort((a,b)=>a-b);
    let best=1, run=1;
    for(let i=1;i<xs.length;i++){
      if(xs[i]===xs[i-1]+1) run++;
      else if(xs[i]!==xs[i-1]) run=1;
      if(run>best) best=run;
    }
    return best;
  }
  function pillarRowHasBrace(row,componentKeys){
    for(const c of row.cells){
      for(const dir of [-1,1]){
        const k=key(c.x+dir,c.y);
        if(componentKeys.has(k)) continue;
        if(pillarSideBrace(getTile(c.x+dir,c.y))) return true;
      }
    }
    return false;
  }
  function chooseToppleDir(cells){
    let left=0, right=0;
    for(const c of cells){
      if(passable(getTile(c.x-1,c.y))) left++;
      if(passable(getTile(c.x+1,c.y))) right++;
    }
    if(left!==right) return left>right ? -1 : 1;
    const c=cells[0] || {x:0,y:0};
    return ((c.x*31+c.y*17)&1) ? 1 : -1;
  }
  function toppleBuiltPillar(cells){
    if(!cells.length) return false;
    const dir=chooseToppleDir(cells);
    const bottom=cells.reduce((m,c)=>Math.max(m,c.y),-Infinity);
    for(const c of cells){
      if(getTile(c.x,c.y)===c.t) setTile(c.x,c.y,T.AIR);
      queueAroundRemoval(c.x,c.y);
    }
    releaseBackgroundCluster(cells);
    const ordered=[...cells].sort((a,b)=>b.y-a.y);
    const minX=cells.reduce((m,c)=>Math.min(m,c.x),Infinity);
    const maxX=cells.reduce((m,c)=>Math.max(m,c.x),-Infinity);
    for(const c of ordered){
      const clearWidth=dir>0 ? (maxX-c.x+1) : (c.x-minX+1);
      let offset=Math.max(1, clearWidth + Math.floor((bottom-c.y+1)/2));
      let tx=c.x;
      for(let step=offset; step>=0; step--){
        const nx=c.x+dir*step;
        if(passable(getTile(nx,c.y))){ tx=nx; break; }
      }
      if(c.t===T.SAND) spawnSand(tx,c.y);
      else spawn(tx,c.y,c.t,isRubbleTrackedMaterial(c.t));
    }
    return true;
  }
  function overLimitBuiltPillarCells(component,componentKeys){
    const rows=new Map();
    let minY=Infinity, maxY=-Infinity;
    for(const c of component){
      minY=Math.min(minY,c.y);
      maxY=Math.max(maxY,c.y);
      let row=rows.get(c.y);
      if(!row){ row={cells:[], xs:[], allSteel:true, brace:false}; rows.set(c.y,row); }
      row.cells.push(c);
      row.xs.push(c.x);
      if(c.t!==T.STEEL) row.allSteel=false;
    }
    for(const row of rows.values()){
      row.width=Math.max(1,maxContiguousRun(row.xs));
      row.brace=pillarRowHasBrace(row,componentKeys);
    }
    let segmentBottom=null, minWidth=Infinity, ratio=100, prevWidth=Infinity;
    for(let y=maxY; y>=minY; y--){
      const row=rows.get(y);
      if(!row) continue;
      if(segmentBottom==null || row.width<prevWidth){
        segmentBottom=y;
        minWidth=Infinity;
        ratio=100;
      }
      minWidth=Math.min(minWidth,row.width);
      ratio=Math.min(ratio,row.allSteel?100:10);
      prevWidth=row.width;
      const span=segmentBottom-y+1;
      const limit=Math.max(1,minWidth) * ratio;
      if(span>limit) return component.filter(c=>c.y<=y);
      if(row.brace){
        segmentBottom=null;
        minWidth=Infinity;
        ratio=100;
        prevWidth=Infinity;
      }
    }
    return null;
  }
  function checkBuiltPillarAt(sx,sy,checked){
    if(!getTile || !canJoinBuiltPillar(sx,sy)) return false;
    const startKey=key(sx,sy);
    if(checked && checked.has(startKey)) return false;
    const stack=[[sx,sy]], seen=new Set(), component=[];
    while(stack.length){
      const [x,y]=stack.pop();
      const k=key(x,y);
      if(seen.has(k) || !canJoinBuiltPillar(x,y)) continue;
      seen.add(k);
      component.push({x,y,t:getTile(x,y)});
      if(component.length>BUILT_PILLAR_CAP){
        if(checked) for(const sk of seen) checked.add(sk);
        return false;
      }
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    if(checked) for(const k of seen) checked.add(k);
    if(component.length<2) return false;
    const collapse=overLimitBuiltPillarCells(component,seen);
    if(collapse && collapse.length){
      const collapseKeys=new Set(collapse.map(c=>key(c.x,c.y)));
      const changed=toppleBuiltPillar(collapse);
      markQuietCluster(component.filter(c=>!collapseKeys.has(key(c.x,c.y))));
      return changed;
    }
    markQuietCluster(component);
    return false;
  }
  function checkBuiltPillarAround(x,y){
    if(!getTile) return false;
    const candidates=[[x,y],[x,y-1],[x,y+1],[x-1,y],[x+1,y],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]];
    const checked=new Set();
    let changed=false;
    for(const c of candidates){
      if(checkBuiltPillarAt(c[0],c[1],checked)) changed=true;
    }
    return changed;
  }
  function breakFragile(x,y){
    queueAroundSettle(x,y);
    try{
      const p=window.MM && MM.particles;
      if(p && p.spawnSplash){
        const TILE=MM.TILE||20;
        p.spawnSplash((x+0.5)*TILE,(Math.floor(y)+0.5)*TILE,0.25);
      }
    }catch(e){}
    return -1;
  }
  function wireAnchorAt(x,y){
    const ns=[[1,0],[-1,0],[0,-1],[0,1]];
    for(const n of ns){
      const t=getTile(x+n[0],y+n[1]);
      if(t===T.WIRE) continue;
      if(n[1]===1 ? isObjectFooting(t) : isObjectBrace(t)) return true;
    }
    return false;
  }
  function processWireAt(sx,sy,processed){
    if(getTile(sx,sy)!==T.WIRE || processed.has(key(sx,sy))) return;
    const stack=[[sx,sy]], seen=new Set(), cluster=[];
    let anchored=false, capped=false;
    while(stack.length){
      const [x,y]=stack.pop();
      const k=key(x,y);
      if(seen.has(k) || getTile(x,y)!==T.WIRE) continue;
      seen.add(k);
      cluster.push({x,y});
      if(wireAnchorAt(x,y)) anchored=true;
      if(cluster.length>512){ capped=true; anchored=true; break; }
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    for(const c of cluster){ const ck=key(c.x,c.y); processed.add(ck); unstable.delete(ck); }
    if(anchored || capped) return;
    for(const c of cluster){
      if(getTile(c.x,c.y)===T.WIRE){
        setTile(c.x,c.y,T.AIR);
        queueAroundRemoval(c.x,c.y);
      }
    }
  }
  function processRigidObjectAt(x,y){
    const t=getTile(x,y);
    if(!isRigidObject(t) || objectAnchorAt(x,y)) return false;
    const below=y+1<WORLD_BOTTOM ? getTile(x,y+1) : T.BEDROCK;
    if(y+1<WORLD_BOTTOM && isObjectCrushableSupportTile(below)){
      setTile(x,y+1,T.AIR);
      forgetPlayerBuild(x,y+1);
      forgetSettledRubble(x,y+1);
      if(isFragileFalling(below)) breakFragile(x,y+1);
      else spawn(x,y+1,below,isRubbleTrackedMaterial(below),0.85);
      queueAroundRemoval(x,y+1);
      releaseBackgroundAt(x,y+1);
    }
    setTile(x,y,T.AIR);
    spawn(x,y,t,false);
    queueAroundRemoval(x,y);
    return true;
  }
  function processMountedFixtureAt(x,y){
    const t=getTile(x,y);
    if(!isMountedFixture(t) || objectAnchorAt(x,y)) return false;
    setTile(x,y,T.AIR);
    queueAroundRemoval(x,y);
    try{
      const p=window.MM && MM.particles;
      if(p && p.spawnSplash){
        const TILE=MM.TILE||20;
        p.spawnSplash((x+0.5)*TILE,(y+0.5)*TILE,0.12);
      }
    }catch(e){}
    return true;
  }
  function processSettledRubbleAt(x,y){
    if(!isSettledRubble(x,y)) return false;
    const t=getTile(x,y);
    const below=y+1>=WORLD_BOTTOM ? T.STONE : getTile(x,y+1);
    if(y+1<WORLD_BOTTOM && (passable(below) || rubbleCrushes(below))){
      setTile(x,y,T.AIR);
      forgetSettledRubble(x,y);
      if(rubbleCrushes(below)) crushTile(x,y+1);
      spawn(x,y,t,true);
      queueAroundRemoval(x,y);
      return true;
    }
    markQuiet(x,y);
    return true;
  }
  function settleSand(sx,fromY,force){
    let x=Math.floor(sx);
    if(!Number.isFinite(x)) x=0;
    let y=dropY(x,fromY);
    const originX=x;
    let guard=0;
    while(guard++<SAND_SETTLE_ROLL_LIMIT){
      const dir=chooseSandRollDir(x,y,originX,guard);
      if(!dir) break;
      x+=dir;
      y=dropY(x,y+1);
    }
    // Bodies block live grains; forced settles pile above every footprint.
    if(bodyBlocks(x,y)){
      if(!force) return BODY_REST;
      if(guestBodyBlocks(x,y)){
        const rest=forcedBodyFreeRest(x,y);
        if(!rest) return BODY_REST;
        x=rest.x; y=rest.y;
      } else {
        let hy=y;
        while(hy>WORLD_TOP && (bodyBlocks(x,hy) || !passable(getTile(x,hy)))) hy--;
        if(!passable(getTile(x,hy)) || bodyBlocks(x,hy)) return BODY_REST;
        y=hy;
      }
    }
    if(!passable(getTile(x,y))) return -1;
    const was=getTile(x,y);
    if(was===T.WATER) displaceWater(x,y);
    setTile(x,y,T.SAND);
    notifyGasChange(x,y,was,T.SAND);
    if(was===T.WATER) notifyWater(x,y);
    queueAroundSettle(x,y);
    return y;
  }
  function structuralRollLimit(type){
    return structuralRubbleRollLimit(type);
  }
  function chooseRubbleRollDir(x,y,type,originX,step){
    if(y+1>=WORLD_BOTTOM) return 0;
    const dirs=[];
    for(const dir of [-1,1]){
      if(passable(getTile(x+dir,y)) && passable(getTile(x+dir,y+1))) dirs.push({dir, depth:rollDepth(x+dir,y+1)});
    }
    if(!dirs.length) return 0;
    if(dirs.length===1) return dirs[0].dir;
    if(dirs[0].depth!==dirs[1].depth) return dirs[0].depth>dirs[1].depth ? dirs[0].dir : dirs[1].dir;
    const bias=type===T.STEEL ? 1 : -1;
    return ((originX + y + step + bias) & 1) ? 1 : -1;
  }
  function settleRubble(sx,fromY,type,force){
    let x=Math.floor(sx);
    if(!Number.isFinite(x)) x=0;
    let y=clampY(fromY);
    while(y>WORLD_TOP && !passable(getTile(x,y))) y--;
    while(y<WORLD_BOTTOM-1){
      const below=getTile(x,y+1);
      if(passable(below)){ y++; continue; }
      if(crushTile(x,y+1)){ y++; continue; }
      break;
    }
    const originX=x;
    const limit=structuralRollLimit(type);
    let guard=0;
    while(guard++<limit){
      const dir=chooseRubbleRollDir(x,y,type,originX,guard);
      if(!dir) break;
      x+=dir;
      y=clampY(y+1);
      while(y>WORLD_TOP && !passable(getTile(x,y))) y--;
      while(y<WORLD_BOTTOM-1){
        const below=getTile(x,y+1);
        if(passable(below)){ y++; continue; }
        if(crushTile(x,y+1)){ y++; continue; }
        break;
      }
    }
    const rest=occupy(x,y,type,force);
    if(rest===BODY_REST) return BODY_REST;
    markSettledRubble(rest.x,rest.y,type);
    queueAroundSettle(rest.x,rest.y);
    return rest.y;
  }

  // --- Instability queue ---
  function queueCheck(x,y){
    const cell=normalizedWorldCell(x,y);
    if(!cell) return;
    x=cell.x; y=cell.y;
    const k=key(x,y);
    if(getTile && quietStable.has(k)){
      const sig=supportSignature(x,y);
      if(quietStable.get(k)===sig) return;
      quietStable.delete(k);
    }
    unstable.add(k);
  }
  // Removing (x,y) can destabilize: the cell above (straight fall), the sides and
  // upper diagonals (sand toppling into the new gap), and the cell below — it is the
  // freshly exposed pile top and may already violate the repose angle.
  function queueAroundRemoval(x,y){
    queueCheck(x,y-1); queueCheck(x,y+1);
    queueCheck(x-1,y); queueCheck(x+1,y);
    queueCheck(x-1,y-1); queueCheck(x+1,y-1);
  }

  function release(x,y){ setTile(x,y,T.AIR); spawnSand(x,y); queueAroundRemoval(x,y); }

  function checkCell(x,y,processed){
    const ck=key(x,y);
    if(protectedBuilds.has(ck)){ markQuiet(x,y); return; }
    const trackedBuild=isTrackedPlayerBuild(x,y);
    if(quietStable.has(ck)){
      const sig=supportSignature(x,y);
      if(!trackedBuild && quietStable.get(ck)===sig) return;
      quietStable.delete(ck);
    }
    const t=getTile(x,y);
    // Natural sky fabric (island shells, glass/dust ribbons at y<0 the player did
    // not place) is exempt from every fall path, mirroring shouldAuditTile.
    if(!trackedBuild && isNaturalSkyCohesionAt(x,y,t)){ markQuiet(x,y); return; }
    if(t===T.SAND){
      if(y+1>=WORLD_BOTTOM) return; // bottom row is bedrock-stable
      if(passable(getTile(x,y+1))){ release(x,y); return; }
      // Static repose: undisturbed sand holds slopes up to 2 tiles per column, so
      // worldgen dunes (commonly slope 2) stay put and dig-triggered cascades die out
      // at natural terrain instead of sweeping the whole biome flat. Only genuinely
      // oversteep faces (drop >= 3 beside the grain) slide. In-flight grains in
      // update() still roll to gentler 45° piles, keeping poured sand granular.
      const L = passable(getTile(x-1,y)) && passable(getTile(x-1,y+1)) && passable(getTile(x-1,y+2));
      const R = passable(getTile(x+1,y)) && passable(getTile(x+1,y+1)) && passable(getTile(x+1,y+2));
      if(L||R) release(x,y);
    } else if(trackedBuild){
      if(processPlayerBuiltAt(x,y,processed)) return;
    } else if(isLooseRigid(t)){
      if(y+1<WORLD_BOTTOM && passable(getTile(x,y+1))){ setTile(x,y,T.AIR); spawn(x,y,t); queueAroundRemoval(x,y); releaseBackgroundAt(x,y); }
    } else if(isFragileFalling(t)){
      if(processFragileAt(x,y,processed)) return;
    } else if(t===T.WIRE){
      processWireAt(x,y,processed);
    } else if(isDynamoTile(t)){
      if(processDynamoCompositeAt(x,y,processed)) return;
    } else if(isRigidObject(t)){
      if(processRigidObjectAt(x,y)) return;
    } else if(isMountedFixture(t)){
      if(processMountedFixtureAt(x,y)) return;
    } else if(isSettledRubble(x,y)){
      if(processSettledRubbleAt(x,y)) return;
    } else if(isStructural(t)){
      if(processStructuralAt(x,y,processed)) return;
    }
    markQuiet(x,y);
  }

  function processQueue(){
    if(!unstable.size) return;
    const frameMs=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    let budget=frameMs>40 ? QUEUE_BUDGET_CRITICAL : (frameMs>24 ? QUEUE_BUDGET_LOW_FPS : QUEUE_BUDGET);
    const processed=new Set(); // per-frame structural-cluster dedupe
    for(const k of unstable){
      if(budget--<=0) break; // leftovers (big avalanches) continue next frame
      unstable.delete(k);
      const ix=k.indexOf(','); checkCell(+k.slice(0,ix), +k.slice(ix+1), processed);
    }
  }
  function drainQueueForSettle(){
    let guard=0;
    while(unstable.size && guard++<64) processQueue();
  }
  function structuralSupportStrength(t){
    return structuralSupportStrengthForMaterial(t);
  }
  function structuralTransferCost(x,y,nx,ny){
    if(nx===x && ny<y) return 0.35;
    if(nx===x && ny>y) return 0.20;
    return 1.00;
  }
  function isCityLikeCluster(cluster, hasReinforced){
    const wg=window.MM && MM.worldGen;
    if(!wg || !wg.biomeType) return !!hasReinforced;
    // Only surface cells make a cluster "city-like": sky islands hovering above a
    // devastated-city district must not inherit its collapse rules.
    for(const c of cluster){ try{ if(c.y>=0 && wg.biomeType(c.x)===8) return true; }catch(e){} }
    return false;
  }
  function isCityTerrainAnchor(x,y,t){
    if(!isStructural(t)) return false;
    const wg=window.MM && MM.worldGen;
    if(!wg || !wg.biomeType || !wg.surfaceHeight) return false;
    try{ return wg.biomeType(x)===8 && y>=wg.surfaceHeight(x); }catch(e){ return false; }
  }
  function isWideStructuralSlabAnchor(x,y,t){
    if(!isStructural(t)) return false;
    const wg=window.MM && MM.worldGen;
    try{ if(wg && wg.biomeType && wg.biomeType(x)===8) return false; }catch(e){}
    let run=1;
    for(const dir of [-1,1]){
      for(let step=1; step<=16; step++){
        if(isStructural(getTile(x+dir*step,y))) run++;
        else break;
      }
    }
    return run>=32;
  }
  function isStructuralAnchor(x,y,t){
    // Natural sky-island fabric (basalt/granite keels etc. at y<0 that the player
    // did not place) self-anchors: the audit already exempts it (shouldAuditTile),
    // and the disturbance path must agree or mining near an island rains it down.
    return naturalFloatingAnchorAt(x,y,t) || naturalFloatingAnchorNear(x,y) || isNaturalSkyCohesionAt(x,y,t) || isCityTerrainAnchor(x,y,t) || isWideStructuralSlabAnchor(x,y,t);
  }
  function isCityColumn(x){
    const wg=window.MM && MM.worldGen;
    if(!wg || !wg.biomeType) return false;
    try{ return wg.biomeType(x)===8; }catch(e){ return false; }
  }
  function shouldAuditTile(x,y,t){
    if(claimLegacyPlayerBuild(x,y,t)) return true;
    if(isNaturalSkyCohesionAt(x,y,t)) return false;
    if(isDynamoTile(t)) return true;
    if(isRigidObject(t) || isMountedFixture(t)) return true;
    if(isLooseRigid(t)) return true;
    if(isLegacyPhysicsAuditMaterial(t)) return true;
    if(isStructural(t)) return isCityColumn(x) && !isStructuralAnchor(x,y,t);
    return false;
  }
  function auditCell(x,y){
    if(isProtectedBuild(x,y)) return;
    const t=getTile(x,y);
    if(!shouldAuditTile(x,y,t)) return;
    if(isTrackedPlayerBuild(x,y)){
      queueCheck(x,y);
      return;
    }
    if(t===T.GLASS){
      queueCheck(x,y);
      return;
    }
    if(isLooseRigid(t)){
      if(y+1<WORLD_BOTTOM && passable(getTile(x,y+1))) queueCheck(x,y);
      return;
    }
    if(t===T.WIRE){
      queueCheck(x,y);
      return;
    }
    if(isDynamoTile(t)){
      queueCheck(x,y);
      return;
    }
    if(isRigidObject(t) || isMountedFixture(t)){
      queueCheck(x,y);
      return;
    }
    if(isStructural(t)){
      if(isStructuralAnchor(x,y,t)) return;
      queueCheck(x,y);
    }
  }
  function scanAuditColumn(wx){
    const range=activeAuditRange();
    for(let y=range.top; y<=range.bottom-3; y++) auditCell(wx,y);
  }
  function scanAuditChunk(cx){
    const left=cx*CHUNK_W;
    for(let lx=0; lx<CHUNK_W; lx++) scanAuditColumn(left+lx);
    auditLast.set(cx,Date.now());
  }
  function queueChunkAudit(cx,force){
    if(!Number.isFinite(cx)) return;
    cx=Math.floor(cx);
    const now=Date.now();
    if(!force && auditLast.has(cx) && now-auditLast.get(cx)<CHUNK_AUDIT_INTERVAL_MS) return;
    if(auditPending.has(cx)) return;
    auditPending.add(cx);
    auditJobs.push({cx,lx:0});
  }
  function auditChunks(chunks,opts){
    if(!Array.isArray(chunks)) return 0;
    const force=!!(opts && opts.force);
    if(opts && opts.immediate){
      let n=0;
      for(const cx of chunks){ if(Number.isFinite(cx)){ scanAuditChunk(Math.floor(cx)); n++; } }
      return n;
    }
    const before=auditJobs.length;
    chunks.forEach(cx=>queueChunkAudit(cx,force));
    return auditJobs.length-before;
  }
  function processAuditJobs(columnBudget){
    if(!auditJobs.length || !getTile) return;
    let budget=Math.max(1,columnBudget|0);
    while(budget>0 && auditJobs.length){
      const job=auditJobs[0];
      const wx=job.cx*CHUNK_W+job.lx;
      scanAuditColumn(wx);
      job.lx++;
      budget--;
      if(job.lx>=CHUNK_W){
        auditJobs.shift();
        auditPending.delete(job.cx);
        auditLast.set(job.cx,Date.now());
      }
    }
  }
  function drainAuditJobs(){
    let guard=0;
    while(auditJobs.length && guard++<4096) processAuditJobs(64);
  }
  function supportedSpanKeys(clusterKeys, supports){
    const best=new Map();
    const q=[];
    for(const c of supports){
      const budget=structuralSupportStrength(c.t);
      const k=key(c.x,c.y);
      best.set(k,budget);
      q.push({x:c.x,y:c.y,budget});
    }
    let head=0;
    while(head<q.length){
      const cur=q[head++];
      const curKey=key(cur.x,cur.y);
      if(cur.budget < (best.get(curKey) ?? -Infinity)) continue;
      const ns=[[cur.x+1,cur.y],[cur.x-1,cur.y],[cur.x,cur.y+1],[cur.x,cur.y-1]];
      for(const n of ns){
        const nk=key(n[0],n[1]);
        if(!clusterKeys.has(nk)) continue;
        const nextBudget=cur.budget-structuralTransferCost(cur.x,cur.y,n[0],n[1]);
        if(nextBudget<0) continue;
        if(nextBudget <= (best.get(nk) ?? -Infinity)) continue;
        best.set(nk,nextBudget);
        q.push({x:n[0],y:n[1],budget:nextBudget});
      }
    }
    return best;
  }

  function builtMaterialProfile(t){
    return sharedBuildMaterialProfile(t);
  }
  function builtSupportStrength(t){
    const p=builtMaterialProfile(t);
    return p ? p.strength : 0;
  }
  function builtVerticalCompressionCost(t){
    const p=builtMaterialProfile(t);
    return p ? p.compression : Infinity;
  }
  function builtTransferCost(from,to){
    const p=builtMaterialProfile(to.t);
    const fromProfile=builtMaterialProfile(from.t);
    if(!p || !fromProfile) return Infinity;
    const fromFlex=Math.max(0.55,fromProfile.flex);
    if(to.x===from.x && to.y<from.y) return builtVerticalCompressionCost(to.t);
    if(to.x===from.x && to.y>from.y) return p.down*p.weight;
    return (p.lateral*p.weight)/fromFlex;
  }
  function isBuildAnchorTile(t){
    return sharedBuildAnchorTile(t);
  }
  function isBuildFoundationTile(t){
    return sharedBuildFoundationTile(t);
  }
  function builtSupportContacts(c,componentKeys,tileFn){
    const tileAt=(x,y)=>buildSupportTile(x,y,tileFn || getTile);
    const out=[];
    if(c.y+1>=WORLD_BOTTOM) return [{x:c.x,y:c.y+1,t:T.BEDROCK,mult:1,worldEdge:true}];
    const belowKey=key(c.x,c.y+1);
    let t=tileAt(c.x,c.y+1);
    if(!componentKeys.has(belowKey) && isBuildFoundationTile(t)) out.push({x:c.x,y:c.y+1,t,mult:1});
    for(const dir of [-1,1]){
      const sideKey=key(c.x+dir,c.y);
      t=tileAt(c.x+dir,c.y);
      if(!componentKeys.has(sideKey) && isBuildAnchorTile(t)) out.push({x:c.x+dir,y:c.y,t,mult:0.62});
    }
    const aboveKey=key(c.x,c.y-1);
    t=tileAt(c.x,c.y-1);
    if(!componentKeys.has(aboveKey) && isBuildAnchorTile(t)) out.push({x:c.x,y:c.y-1,t,mult:0.72});
    return out;
  }
  function builtSupportMultiplier(c,componentKeys){
    return builtSupportContacts(c,componentKeys,getTile).reduce((best,s)=>Math.max(best,s.mult),0);
  }
  function builtSelfWeight(t){
    const p=builtMaterialProfile(t);
    return p ? Math.max(0.1,p.weight || 1) : Infinity;
  }
  function builtFlowCapacity(c){
    return Math.max(1,builtSupportStrength(c.t)*BUILD_FLOW_RESISTANCE_SCALE);
  }
  function builtResidualBudget(c,ratio){
    return builtSupportStrength(c.t)*(1-Math.max(0,ratio));
  }
  function bearingCellCapacity(t){
    if(t===T.BEDROCK) return Infinity;
    const p=builtMaterialProfile(t);
    if(p){
      const compression=Math.max(0.12,Math.min(0.85,p.compression || 0.4));
      return Math.max(1.5,p.strength*(1.15-compression*0.45));
    }
    if(isStructural(t)) return structuralSupportStrength(t)*0.95;
    return isBuildFoundationTile(t) ? 2.5 : 0;
  }
  function bearingBackingScore(x,y,componentKeys){
    if(y>=WORLD_BOTTOM) return BUILD_BEARING_BACKING_LIMIT;
    const start=key(x,y);
    const seen=new Set([start]);
    const q=[[x,y]];
    let score=0, head=0;
    while(head<q.length && score<BUILD_BEARING_BACKING_LIMIT){
      const [cx,cy]=q[head++];
      if(cy<y-1 || cy>y+7 || Math.abs(cx-x)>4) continue;
      const k=key(cx,cy);
      if(componentKeys && componentKeys.has(k)) continue;
      const t=buildSupportTile(cx,cy,getTile);
      if(t===T.BEDROCK){ score=BUILD_BEARING_BACKING_LIMIT; break; }
      if(!isBuildFoundationTile(t)) continue;
      score++;
      for(const n of [[cx,cy+1],[cx-1,cy],[cx+1,cy],[cx,cy-1]]){
        const nk=key(n[0],n[1]);
        if(seen.has(nk)) continue;
        seen.add(nk);
        q.push(n);
      }
    }
    return Math.max(1,score);
  }
  function bearingCapacityAt(x,y,t,componentKeys){
    const base=bearingCellCapacity(t);
    if(!Number.isFinite(base)) return Infinity;
    return base*Math.sqrt(bearingBackingScore(x,y,componentKeys))*BUILD_BEARING_CAPACITY_SCALE;
  }
  function supportCostMap(component,componentKeys,supports,byKey){
    const cost=new Map();
    const q=[];
    for(const c of supports){
      const k=key(c.x,c.y);
      cost.set(k,0);
      q.push({x:c.x,y:c.y});
    }
    let head=0;
    while(head<q.length){
      const cur=q[head++];
      const curKey=key(cur.x,cur.y);
      const curCell=byKey.get(curKey);
      const curCost=cost.get(curKey);
      if(!curCell || !Number.isFinite(curCost)) continue;
      const ns=[[cur.x+1,cur.y],[cur.x-1,cur.y],[cur.x,cur.y+1],[cur.x,cur.y-1]];
      for(const n of ns){
        const nk=key(n[0],n[1]);
        if(!componentKeys.has(nk)) continue;
        const next=byKey.get(nk);
        if(!next) continue;
        const nextCost=curCost+builtTransferCost(curCell,next);
        if(nextCost >= (cost.get(nk) ?? Infinity)) continue;
        cost.set(nk,nextCost);
        q.push({x:n[0],y:n[1]});
      }
    }
    return cost;
  }
  function normalizedFlowVector(dx,dy){
    const m=Math.hypot(dx,dy);
    if(!(m>0)) return null;
    return {dx:+(dx/m).toFixed(3),dy:+(dy/m).toFixed(3)};
  }
  function averageFlowVector(vectors){
    let dx=0, dy=0, n=0;
    for(const v of vectors){
      if(!v || !Number.isFinite(v.dx) || !Number.isFinite(v.dy)) continue;
      dx+=v.dx;
      dy+=v.dy;
      n++;
    }
    if(!n) return null;
    return normalizedFlowVector(dx/n,dy/n);
  }
  function buildFlowDirectionFor(c,k,cost,componentKeys,supportContacts){
    const contacts=supportContacts.get(k) || [];
    let bestMult=0;
    for(const s of contacts){
      bestMult=Math.max(bestMult,s.mult || 0);
    }
    if(bestMult>0){
      const tied=contacts.filter(s=>Math.abs((s.mult || 0)-bestMult)<0.0001).map(s=>normalizedFlowVector(s.x-c.x, s.y-c.y));
      return averageFlowVector(tied);
    }
    const curCost=cost.get(k);
    if(!Number.isFinite(curCost)) return null;
    let bestCost=curCost;
    const best=[];
    for(const n of [[c.x+1,c.y],[c.x-1,c.y],[c.x,c.y+1],[c.x,c.y-1]]){
      const nk=key(n[0],n[1]);
      if(!componentKeys.has(nk)) continue;
      const nCost=cost.get(nk);
      if(!Number.isFinite(nCost) || nCost>=curCost-0.0001) continue;
      if(nCost<bestCost-0.0001){
        best.length=0;
        bestCost=nCost;
      }
      if(Math.abs(nCost-bestCost)<0.0001) best.push({x:n[0],y:n[1]});
    }
    return averageFlowVector(best.map(b=>normalizedFlowVector(b.x-c.x,b.y-c.y)));
  }
  function pressureReceiverKeysFor(c,k,cost,componentKeys,byKey,supportContacts,lastDir,guard){
    let cur=c, curKey=k, dir=lastDir||null;
    for(let step=guard||0; step<PLAYER_BUILT_CAP; step++){
      const contacts=supportContacts.get(curKey) || [];
      if(contacts.length) return [curKey];
      const curCost=cost.get(curKey);
      if(!Number.isFinite(curCost)) return [curKey];
      let bestCost=curCost;
      const best=[];
      for(const n of [[cur.x+1,cur.y],[cur.x-1,cur.y],[cur.x,cur.y+1],[cur.x,cur.y-1]]){
        const nk=key(n[0],n[1]);
        if(!componentKeys.has(nk)) continue;
        const nCost=cost.get(nk);
        if(!Number.isFinite(nCost) || nCost>=curCost-0.0001) continue;
        if(nCost<bestCost-0.0001){
          best.length=0;
          bestCost=nCost;
        }
        if(Math.abs(nCost-bestCost)<0.0001) best.push({k:nk,x:n[0],y:n[1],dir:{dx:Math.sign(n[0]-cur.x),dy:Math.sign(n[1]-cur.y)}});
      }
      if(!best.length) return [curKey];
      if(dir){
        const straight=best.filter(b=>b.dir.dx===dir.dx && b.dir.dy===dir.dy);
        if(!straight.length) return [curKey];
        best.length=0;
        best.push(...straight);
      }
      if(best.length>1){
        const out=new Set();
        for(const b of best){
          const next=byKey.get(b.k);
          if(!next) out.add(b.k);
          else pressureReceiverKeysFor(next,b.k,cost,componentKeys,byKey,supportContacts,b.dir,step+1).forEach(r=>out.add(r));
        }
        return [...out];
      }
      dir=best[0].dir;
      curKey=best[0].k;
      cur=byKey.get(curKey);
      if(!cur) return [curKey];
    }
    return [curKey];
  }
  function supportedBuiltKeys(component,componentKeys,supports,tileFn){
    const best=new Map();
    const byKey=new Map(component.map(c=>[key(c.x,c.y),c]));
    if(!supports.length) return best;
    const pureVerticalColumn=component.length>0 && component.every(c=>c.x===component[0].x);
    const supportMult=new Map();
    const supportContacts=new Map();
    for(const c of supports){
      const k=key(c.x,c.y);
      supportMult.set(k,Math.max(supportMult.get(k) || 0,c.mult || 0));
      supportContacts.set(k,builtSupportContacts(c,componentKeys,tileFn || getTile));
    }
    const cost=supportCostMap(component,componentKeys,supports,byKey);
    const load=new Map();
    const bearingLoads=new Map();
    const flowDirs=new Map();
    const pressureRatios=new Map();
    const supported=component.filter(c=>{
      const k=key(c.x,c.y);
      if(!Number.isFinite(cost.get(k))) return false;
      load.set(k,builtSelfWeight(c.t));
      return true;
    });
    supported.sort((a,b)=>(cost.get(key(b.x,b.y)) || 0)-(cost.get(key(a.x,a.y)) || 0));
    for(const c of supported){
      const k=key(c.x,c.y);
      const cCost=cost.get(k) || 0;
      let force=load.get(k) || 0;
      const localSupport=supportMult.get(k) || 0;
      if(localSupport>0){
        const absorbed=Math.min(force,builtFlowCapacity(c)*localSupport*0.85);
        const contacts=supportContacts.get(k) || [];
        const total=contacts.reduce((sum,s)=>sum+s.mult,0) || 1;
        for(const s of contacts){
          if(s.worldEdge) continue;
          const sk=key(s.x,s.y);
          bearingLoads.set(sk,(bearingLoads.get(sk) || 0)+absorbed*(s.mult/total));
        }
        force=Math.max(0,force-absorbed);
      }
      if(force<=0) continue;
      const carryLimit=builtFlowCapacity(c)*(builtMaterialProfile(c.t).fail/BUILD_FLOW_LOAD_STRESS);
      const transmitForce=Math.min(force,carryLimit);
      const exits=[];
      const ns=[[c.x+1,c.y],[c.x-1,c.y],[c.x,c.y+1],[c.x,c.y-1]];
      for(const n of ns){
        const nk=key(n[0],n[1]);
        if(!componentKeys.has(nk)) continue;
        const next=byKey.get(nk);
        if(!next) continue;
        const nCost=cost.get(nk);
        if(!Number.isFinite(nCost) || nCost>=cCost-0.0001) continue;
        const penalty=builtTransferCost(c,next);
        exits.push({k:nk,score:1/Math.max(0.2,0.2+penalty+nCost*0.04),penalty});
      }
      if(!exits.length) continue;
      exits.sort((a,b)=>b.score-a.score);
      const cutoff=exits[Math.min(2,exits.length-1)].score;
      const chosen=exits.filter((e,i)=>i<3 || Math.abs(e.score-cutoff)<0.000001);
      const total=chosen.reduce((sum,e)=>sum+e.score,0) || 1;
      for(const e of chosen){
        const transferred=transmitForce*(e.score/total)*(1+e.penalty*BUILD_FLOW_TRANSFER_STRESS);
        load.set(e.k,(load.get(e.k) || 0)+transferred);
      }
    }
    for(const c of supported){
      const k=key(c.x,c.y);
      const reachRatio=(cost.get(k) || 0)/Math.max(1,builtSupportStrength(c.t)*BUILD_FLOW_REACH_SCALE);
      const localSupport=supportMult.get(k) || 0;
      const capacity=builtFlowCapacity(c)*(1+localSupport*0.55);
      const loadRatio=pureVerticalColumn ? 0 : ((load.get(k) || builtSelfWeight(c.t))/capacity)*BUILD_FLOW_LOAD_STRESS;
      const ratio=Math.max(reachRatio,loadRatio);
      best.set(k,builtResidualBudget(c,ratio));
      const flow=buildFlowDirectionFor(c,k,cost,componentKeys,supportContacts);
      if(flow) flowDirs.set(k,flow);
      const pressureKeys=pressureReceiverKeysFor(c,k,cost,componentKeys,byKey,supportContacts);
      for(const pressureKey of pressureKeys){
        if(ratio>(pressureRatios.get(pressureKey) || 0)) pressureRatios.set(pressureKey,ratio);
      }
    }
    buildBearingLoads.set(best,bearingLoads);
    buildFlowDirections.set(best,flowDirs);
    buildPressureRatios.set(best,pressureRatios);
    return best;
  }
  function canSupportPlacement(px,py,pt){
    if(!getTile || !isPlayerBuiltMaterial(pt)) return {ok:true, applies:false};
    px=Math.floor(px); py=Math.floor(py);
    if(!Number.isFinite(px) || !Number.isFinite(py) || !inWorldY(py)) return {ok:false, reason:'Brak podparcia'};
    const virtualKey=key(px,py);
    const virtualTile=(x,y)=> (x===px && y===py) ? pt : getTile(x,y);
    const virtualSupportTile=(x,y)=> (x===px && y===py) ? pt : buildSupportTile(x,y,virtualTile);
    const virtualBuildAt=(x,y)=>{
      if(x===px && y===py) return true;
      const k=key(x,y);
      return playerBuilt.has(k) && isPlayerBuiltMaterial(getTile(x,y));
    };
    const stack=[[px,py]], seen=new Set(), component=[];
    while(stack.length){
      const [x,y]=stack.pop();
      const k=key(x,y);
      if(seen.has(k) || !virtualBuildAt(x,y)) continue;
      seen.add(k);
      component.push({x,y,t:virtualTile(x,y)});
      if(component.length>PLAYER_BUILT_CAP) return {ok:true, applies:true};
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    if(!seen.has(virtualKey)) return {ok:false, reason:'Brak podparcia'};
    const componentKeys=new Set(component.map(c=>key(c.x,c.y)));
    const componentByKey=new Map(component.map(c=>[key(c.x,c.y),c]));
    const supports=[];
    for(const c of component){
      let mult=0;
      if(c.y+1>=WORLD_BOTTOM) mult=1;
      const belowKey=key(c.x,c.y+1);
      if(!componentKeys.has(belowKey) && isBuildFoundationTile(virtualSupportTile(c.x,c.y+1))) mult=Math.max(mult,1);
      for(const dir of [-1,1]){
        const sideKey=key(c.x+dir,c.y);
        if(!componentKeys.has(sideKey) && isBuildAnchorTile(virtualSupportTile(c.x+dir,c.y))) mult=Math.max(mult,0.62);
      }
      const aboveKey=key(c.x,c.y-1);
      if(!componentKeys.has(aboveKey) && isBuildAnchorTile(virtualSupportTile(c.x,c.y-1))) mult=Math.max(mult,0.72);
      if(mult>0) supports.push(Object.assign({mult},c));
    }
    if(!supports.length) return {ok:false, reason:'Brak podparcia'};
    const stable=supportedBuiltKeys(component,componentKeys,supports,virtualSupportTile);
    const pressureCells=pressureStressCells(component,stable,new Set(),{byKey:componentByKey,tileFn:virtualTile,requireTracked:false}).map(c=>({x:c.x,y:c.y,ratio:c.ratio}));
    if(!stable.has(virtualKey)) return {ok:false, reason:'Brak podparcia', pressureCells};
    const failing=overstressedBuiltCells(component,stable,new Set());
    if(failing.some(c=>key(c.x,c.y)===virtualKey)) return {ok:false, reason:'Za duze naprezenie', pressureCells};
    if(failing.length) return {ok:false, reason:'Konstrukcja peknie', pressureCells};
    return {ok:true, applies:true, pressureCells};
  }
  function buildStressRatio(c,budget){
    if(!Number.isFinite(budget)) return 0;
    return Math.max(0,Math.min(1,1-budget/Math.max(1,builtSupportStrength(c.t))));
  }
  function pressureStressCells(component,best,fallingKeys,opts){
    const pressures=buildPressureRatios.get(best);
    if(!pressures || !pressures.size) return [];
    const byKey=(opts && opts.byKey) || new Map(component.map(c=>[key(c.x,c.y),c]));
    const tileAt=(opts && opts.tileFn) || getTile;
    const requireTracked=!(opts && opts.requireTracked===false);
    const out=[];
    for(const [raw,ratio] of pressures){
      if(fallingKeys && fallingKeys.has(raw)) continue;
      const c=parseCellKey(raw);
      if(!c) continue;
      if(requireTracked && !isTrackedPlayerBuild(c.x,c.y)) continue;
      const src=byKey.get(raw) || c;
      const p=builtMaterialProfile(tileAt(c.x,c.y));
      if(p && ratio>=p.warn) out.push({x:c.x,y:c.y,t:src.t,ratio:+Math.max(0,Math.min(1,ratio)).toFixed(3)});
    }
    return out;
  }
  function recordBuildBreak(x,y,t,ratio){
    if(buildBreaks.length>220) buildBreaks.splice(0, buildBreaks.length-220);
    const now=(typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    buildBreaks.push({x,y,t,ratio:Math.max(0.5,Math.min(1,ratio||1)),born:now,life:BUILD_BREAK_EFFECT_MS,seed:((x*928371+y*364479)&255)});
  }
  function overstressedBuiltCells(component,best,fallingKeys){
    if(!best || !best.size) return [];
    const out=[];
    for(const c of component){
      const k=key(c.x,c.y);
      if(fallingKeys && fallingKeys.has(k)) continue;
      const budget=best.get(k);
      if(!Number.isFinite(budget)) continue;
      const ratio=buildStressRatio(c,budget);
      const p=builtMaterialProfile(c.t);
      if(p && ratio>=p.fail) out.push(Object.assign({stress:ratio},c));
    }
    return out;
  }
  function recordBuildStress(component,best,fallingKeys){
    if(buildStress.size>BUILD_STRESS_CAP){ buildStress.clear(); buildStressFlow.clear(); }
    const flows=buildFlowDirections.get(best);
    const pressures=buildPressureRatios.get(best);
    const pressureCells=pressureStressCells(component,best,fallingKeys);
    for(const c of component){
      const k=key(c.x,c.y);
      buildStress.delete(k);
      buildStressFlow.delete(k);
    }
    if(pressures && pressures.size){
      for(const c of pressureCells){
        const k=key(c.x,c.y);
        buildStress.set(k,c.ratio);
        const flow=flows && flows.get(k);
        if(flow) buildStressFlow.set(k,flow);
      }
      return;
    }
    for(const c of component){
      const k=key(c.x,c.y);
      if(fallingKeys && fallingKeys.has(k)) continue;
      const budget=best.get(k);
      if(!Number.isFinite(budget)) continue;
      const ratio=buildStressRatio(c,budget);
      const p=builtMaterialProfile(c.t);
      if(p && ratio>=p.warn){
        buildStress.set(k,+ratio.toFixed(3));
        const flow=flows && flows.get(k);
        if(flow) buildStressFlow.set(k,flow);
      }
    }
  }
  function canCrushBearingSupport(t){
    if(t===T.BEDROCK || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || isUfoVaultMaterial(t)) return false;
    return isBuildFoundationTile(t);
  }
  function crushBearingSupport(x,y,t,ratio){
    if(!canCrushBearingSupport(t) || getTile(x,y)!==t) return false;
    setTile(x,y,T.AIR);
    forgetPlayerBuild(x,y);
    forgetSettledRubble(x,y);
    recordBuildBreak(x,y,t,ratio);
    if(isFragileFalling(t)) breakFragile(x,y);
    else if(isRubbleTrackedMaterial(t) || isPlayerBuiltMaterial(t) || isStructural(t)) spawn(x,y,t,true,ratio);
    queueAroundRemoval(x,y);
    releaseBackgroundAt(x,y);
    return true;
  }
  function crushOverloadedBearingSupports(best,componentKeys){
    const loads=buildBearingLoads.get(best);
    if(!loads || !loads.size || !getTile || !setTile) return false;
    let changed=false;
    for(const [raw,force] of loads){
      const c=parseCellKey(raw);
      if(!c || !Number.isFinite(force) || force<=0) continue;
      const t=getTile(c.x,c.y);
      if(!canCrushBearingSupport(t)) continue;
      const cap=bearingCapacityAt(c.x,c.y,t,componentKeys);
      if(!Number.isFinite(cap) || cap<=0) continue;
      const ratio=force/cap;
      if(ratio>=BUILD_BEARING_CRUSH_RATIO && crushBearingSupport(c.x,c.y,t,Math.min(1,ratio))) changed=true;
    }
    return changed;
  }
  function requeueBuiltComponent(component,processed){
    for(const c of component){
      const k=key(c.x,c.y);
      if(processed) processed.delete(k);
      quietStable.delete(k);
      unstable.add(k);
    }
  }
  function releaseBuiltCells(cells){
    if(!cells.length) return false;
    const released=[];
    for(const c of cells){
      const t=getTile(c.x,c.y);
      if(t!==c.t) continue;
      setTile(c.x,c.y,T.AIR);
      forgetPlayerBuild(c.x,c.y);
      forgetManualCityBuild(c.x,c.y);
      recordBuildBreak(c.x,c.y,c.t,Number.isFinite(c.stress)?c.stress:1);
      if(c.t===T.SAND) spawnSand(c.x,c.y);
      else spawn(c.x,c.y,c.t,isRubbleTrackedMaterial(c.t),Number.isFinite(c.stress)?c.stress:1);
      queueAroundRemoval(c.x,c.y);
      released.push(c);
    }
    releaseBackgroundCluster(released);
    return true;
  }
  function processPlayerBuiltAt(sx,sy,processed){
    const startKey=key(sx,sy);
    if(!isTrackedPlayerBuild(sx,sy) || processed.has(startKey)) return false;
    const stack=[[sx,sy]], seen=new Set(), component=[];
    while(stack.length){
      const [x,y]=stack.pop();
      const k=key(x,y);
      if(seen.has(k) || !isTrackedPlayerBuild(x,y)) continue;
      seen.add(k);
      component.push({x,y,t:getTile(x,y)});
      if(component.length>PLAYER_BUILT_CAP){
        for(const sk of seen) processed.add(sk);
        markQuietCluster(component);
        return false;
      }
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    for(const c of component){ const ck=key(c.x,c.y); processed.add(ck); unstable.delete(ck); }
    if(!component.length) return false;
    const componentKeys=new Set(component.map(c=>key(c.x,c.y)));
    const supports=[];
    for(const c of component){
      const mult=builtSupportMultiplier(c,componentKeys);
      if(mult>0) supports.push(Object.assign({mult},c));
    }
    let falling=component;
    let stableKeys=new Map();
    if(supports.length){
      stableKeys=supportedBuiltKeys(component,componentKeys,supports);
      falling=component.filter(c=>!stableKeys.has(key(c.x,c.y)));
    }
    const fallingKeys=new Set(falling.map(c=>key(c.x,c.y)));
    if(stableKeys.size){
      for(const c of overstressedBuiltCells(component,stableKeys,fallingKeys)){
        const k=key(c.x,c.y);
        if(fallingKeys.has(k)) continue;
        falling.push(c);
        fallingKeys.add(k);
      }
    }
    if(stableKeys.size && crushOverloadedBearingSupports(stableKeys,componentKeys)){
      requeueBuiltComponent(component,processed);
      recordBuildStress(component,stableKeys,fallingKeys);
      return true;
    }
    recordBuildStress(component,stableKeys,fallingKeys);
    if(falling.length){
      const changed=releaseBuiltCells(falling);
      markQuietCluster(component.filter(c=>!fallingKeys.has(key(c.x,c.y))));
      return changed;
    }
    markQuietCluster(component);
    return false;
  }

  // --- Stone cluster stability ---
  // Flood-fills connected stone, aborting as soon as any member rests on a supporting
  // tile (non-passable, non-stone) — the common "still supported" case stays cheap.
  function processStructuralAt(sx,sy,processed){
    if(!isStructural(getTile(sx,sy)) || processed.has(key(sx,sy))) return false;
    if(isSettledRubble(sx,sy)) return processSettledRubbleAt(sx,sy);
    if(isStructuralAnchor(sx,sy,getTile(sx,sy))){ processed.add(key(sx,sy)); markQuiet(sx,sy); return false; }
    const belowStart=getTile(sx,sy+1);
    if(sy+1>=WORLD_BOTTOM || isStructuralFootingSupport(belowStart) || isStructuralAnchor(sx,sy+1,belowStart)){ processed.add(key(sx,sy)); markQuiet(sx,sy); return false; } // directly supported
    const stack=[[sx,sy]]; const seen=new Set(); const cluster=[]; const supports=[];
    let supported=false, hasSteel=false;
    while(stack.length){
      const [x,y]=stack.pop(); const k=key(x,y);
      if(seen.has(k)) continue;
      const t=getTile(x,y);
      if(!isStructural(t)) continue;
      if(isSettledRubble(x,y)) continue;
      if(isStructuralAnchor(x,y,t)) continue;
      seen.add(k); cluster.push({x,y,t});
      if(t===T.STEEL) hasSteel=true;
      let directSupport=false;
      if(y+1>=WORLD_BOTTOM){ directSupport=true; }
      const below=getTile(x,y+1);
      if(isStructuralAnchor(x,y+1,below)) directSupport=true;
      if(isStructuralFootingSupport(below)) directSupport=true;
      if(directSupport){
        supported=true;
        supports.push({x,y,t});
      }
      if(cluster.length>CLUSTER_CAP){ if(supports.length) supported=true; break; }
      // Grounded cells are enough to support a span; do not flood through them into
      // the whole city foundation, or one undercut building becomes a huge stable cluster.
      if(directSupport) continue;
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    for(const c of cluster){ const ck=key(c.x,c.y); processed.add(ck); unstable.delete(ck); }
    if(!isCityLikeCluster(cluster, hasSteel)){ markQuietCluster(cluster); return false; }
    let falling=cluster;
    if(supported){
      const stable=supportedSpanKeys(new Set(cluster.map(c=>key(c.x,c.y))), supports);
      falling=cluster.filter(c=>!stable.has(key(c.x,c.y)));
      if(!falling.length){ markQuietCluster(cluster); return false; }
    }
    const fallingKeys=new Set(falling.map(c=>key(c.x,c.y)));
    falling=falling.filter(c=>rubbleCanLeaveCell(c,fallingKeys));
    if(!falling.length){ markQuietCluster(cluster); return false; }
    for(const c of falling){
      const {x,y}=c;
      const t=getTile(x,y);
      if(isStructural(t)){ setTile(x,y,T.AIR); spawn(x,y,t,true); }
    }
    // Anything that sat on the cluster (sand, diamonds) is now unsupported
    for(const c of falling) queueAroundRemoval(c.x,c.y);
    releaseBackgroundCluster(falling);
    return falling.length>0;
  }

  // Freeze in-flight material into tiles so it can never be lost. Sand gets a
  // granular side-roll here too; otherwise autosave can turn a cascade into a chimney.
  function dropToRest(x, fromY, type, rubble){
    if(type===T.SAND) return settleSand(x,fromY,true);
    if(isFragileFalling(type)) return breakFragile(x,fromY);
    if(rubble && isRubbleTrackedMaterial(type)) return settleRubble(x,fromY,type,true);
    let y=clampY(fromY);
    while(y<WORLD_BOTTOM-1 && passable(getTile(x,y+1))) y++;
    const rest=occupy(x,y,type,true);
    if(rest===BODY_REST) return BODY_REST;
    queueCheck(rest.x,rest.y);
    return rest.y;
  }
  // Freeze as much in-flight material as possible before save. If every legal
  // resting cell in the bounded body-avoidance scan is blocked, keep the entity
  // in the v5 active/sand snapshot as a serializable escrow instead of dropping
  // its mass or writing a solid through an authoritative body.
  function settleAll(){
    if(!getTile) return;
    let guard=0;
    while((auditJobs.length || unstable.size || active.length || sandActive.length) && guard++<24){
      drainAuditJobs();
      drainQueueForSettle();
      const blocks=[...active].sort((a,b)=>b.yFloat-a.yFloat);
      active.length=0;
      for(const b of blocks){
        if(dropToRest(b.x, b.yFloat, b.type, b.rubble)===BODY_REST) active.push(b);
      }
      const grains=[...sandActive].sort((a,b)=>b.yFloat-a.yFloat);
      sandActive.length=0;
      for(const s of grains){
        if(dropToRest(s.x, s.yFloat, T.SAND)===BODY_REST) sandActive.push(s);
      }
    }
  }

  // --- Entity integration (swept, cell-by-cell — large dt cannot tunnel through floors) ---
  function launchFromSpringEntity(entity,springX,springY,kind){
    const spring=(typeof window!=='undefined' && window.MM) ? window.MM.springPlatforms : null;
    if(!spring || typeof spring.launchEntity!=='function') return false;
    return !!spring.launchEntity(entity,springX,springY,getTile,{kind,forward:false});
  }

  function moveFallingEntityUp(e,gt,dt){
    if(!e || !(e.vy<0) || !(dt>0)) return false;
    let remaining=Math.min(3.5, -e.vy*dt);
    let moved=false;
    while(remaining>0){
      const yi=Math.floor(e.yFloat);
      if(yi<=WORLD_TOP){ e.yFloat=WORLD_TOP; e.vy=0; break; }
      const aboveY=yi-1;
      if(!passable(gt(e.x,aboveY))){ e.vy=0; break; }
      const frac=e.yFloat-yi;
      const step=Math.min(remaining, frac>1e-5 ? frac : 1);
      e.yFloat-=step;
      remaining-=step;
      moved=true;
    }
    return moved;
  }

  function update(gt,st,dt){
    if(!(dt>0) || !isFinite(dt)) return;
    init(gt,st);
    const frameMs=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    processAuditJobs(frameMs>40 ? 1 : (frameMs>24 ? 2 : 5));
    processQueue();
    hoverClaims.clear(); // hover-pile claims live one frame — rebuilt below
    // Pre-reserve every already-docked crown cell BEFORE anything falls this
    // frame, so a new arrival always sees the parked entity's claim (regardless
    // of array order) and sheds around it instead of stacking into the same cell.
    for(const b of active) if(dockedOnBody(b)) hoverClaims.add(key(b.x,Math.floor(b.yFloat)));
    for(const s of sandActive) if(dockedOnBody(s)) hoverClaims.add(key(s.x,Math.floor(s.yFloat)));
    // Overload guard: a pathological cascade can't accumulate unbounded entities
    if(sandActive.length>3000){ const excess=sandActive.splice(0, sandActive.length-3000).sort((a,b)=>b.yFloat-a.yFloat); for(const s of excess) dropToRest(s.x, s.yFloat, T.SAND); }
    if(active.length>ACTIVE_RIGID_CAP){
      const excess=active.splice(0, active.length-ACTIVE_RIGID_CAP).sort((a,b)=>b.yFloat-a.yFloat);
      for(const b of excess) dropToRest(b.x,b.yFloat,b.type,b.rubble);
    }

    for(let i=active.length-1;i>=0;i--){
      const b=active[i];
      // parked on a body's crown: hold still (and hold the claim) until it leaves
      if(dockedOnBody(b)){ hoverClaims.add(key(b.x,Math.floor(b.yFloat))); continue; }
      const inWater = getTile(b.x, Math.floor(b.yFloat))===T.WATER;
      if(inWater && !b.wet){ b.wet=true; splash(b.x,b.yFloat,b.vy); notifyWater(b.x,Math.floor(b.yFloat)); if(b.vy>VMAX_WATER*1.6) b.vy=VMAX_WATER*1.6; }
      else if(!inWater) b.wet=false;
      applyWindToFalling(b,b.type,dt,inWater);
      b.vy += (inWater?G_WATER:G_AIR)*dt;
      const cap=inWater?VMAX_WATER:VMAX_AIR; if(b.vy>cap) b.vy=cap;
      if(b.vy<0){ moveFallingEntityUp(b,getTile,dt); continue; }
      // null = still falling; any finite row (including negative sky-section rows) = resting spot
      let remaining=b.vy*dt, settledAt=null, springAt=null;
      while(remaining>0){
        const yi=Math.floor(b.yFloat);
        if(yi>=WORLD_BOTTOM-1){ b.yFloat=WORLD_BOTTOM-1; settledAt=WORLD_BOTTOM-1; break; }
        let below=getTile(b.x,yi+1);
        if(b.rubble && isStructural(b.type) && crushTile(b.x,yi+1)) below=T.AIR;
        if(!passable(below)){ settledAt=yi; if(below===T.SPRING_PLATFORM) springAt={x:b.x,y:yi+1}; break; }
        const dist=(yi+1)-b.yFloat;
        if(remaining<dist){ b.yFloat+=remaining; remaining=0; }
        else { b.yFloat=yi+1; remaining-=dist; }
      }
      if(settledAt!==null){
        if(springAt && launchFromSpringEntity(b,springAt.x,springAt.y,'falling')){
          b.yFloat=settledAt;
          continue;
        }
        if(bodyBlocks(b.x,settledAt)){ restOnBody(b,b.x,settledAt); continue; } // rest on a body until it moves (pile, not overlap)
        if(isFragileFalling(b.type)){ breakFragile(b.x,settledAt); active.splice(i,1); continue; }
        // roll/stack target may land on the hero even when settledAt did not — hover, never bury
        const rest=(b.rubble && isRubbleTrackedMaterial(b.type)) ? settleRubble(b.x,settledAt,b.type) : occupy(b.x,settledAt,b.type);
        if(rest===BODY_REST){ restOnBody(b,b.x,settledAt); continue; }
        active.splice(i,1);
      }
    }

    for(let i=sandActive.length-1;i>=0;i--){
      const s=sandActive[i];
      // parked on a body's crown: hold still (and hold the claim) until it leaves
      if(dockedOnBody(s)){ hoverClaims.add(key(s.x,Math.floor(s.yFloat))); continue; }
      const inWater = getTile(s.x, Math.floor(s.yFloat))===T.WATER;
      if(inWater && !s.wet){ s.wet=true; splash(s.x,s.yFloat,s.vy); if(s.vy>SAND_VMAX_WATER*1.6) s.vy=SAND_VMAX_WATER*1.6; }
      else if(!inWater) s.wet=false;
      applyWindToFalling(s,T.SAND,dt,inWater);
      s.vy += (inWater?G_WATER:G_AIR)*dt;
      const cap=inWater?SAND_VMAX_WATER:SAND_VMAX_AIR; if(s.vy>cap) s.vy=cap;
      if(s.vy<0){ moveFallingEntityUp(s,getTile,dt); continue; }
      // null = still falling; negative rows are valid resting spots in the sky sections
      let remaining=s.vy*dt, blockedAt=null, springAt=null;
      while(remaining>0){
        const yi=Math.floor(s.yFloat);
        if(yi>=WORLD_BOTTOM-1){ s.yFloat=WORLD_BOTTOM-1; blockedAt=WORLD_BOTTOM-1; break; }
        const below=getTile(s.x,yi+1);
        if(!passable(below)){ blockedAt=yi; if(below===T.SPRING_PLATFORM) springAt={x:s.x,y:yi+1}; break; }
        const dist=(yi+1)-s.yFloat;
        if(remaining<dist){ s.yFloat+=remaining; remaining=0; }
        else { s.yFloat=yi+1; remaining-=dist; }
      }
      if(blockedAt===null) continue;
      const yi=blockedAt;
      if(springAt && launchFromSpringEntity(s,springAt.x,springAt.y,'sand')){
        s.yFloat=yi;
        continue;
      }
      if(yi<WORLD_BOTTOM-1){ // grain rolls down slopes (also under water)
        const canL = passable(getTile(s.x-1,yi)) && passable(getTile(s.x-1,yi+1));
        const canR = passable(getTile(s.x+1,yi)) && passable(getTile(s.x+1,yi+1));
        if(canL||canR){
          let dir=(canL&&canR)?(Math.random()<0.5?-1:1):(canL?-1:1);
          if(canL && canR){
            const ws=windSpeedAt(s.x+0.5,yi);
            if(Math.abs(ws)>1.0) dir=ws<0?-1:1;
          }
          s.x+=dir; s.yFloat=yi+0.05; if(s.vy>8) s.vy=8; continue;
        }
      }
      if(bodyBlocks(s.x,yi)){ restOnBody(s,s.x,yi); continue; }
      if(settleSand(s.x,yi)===BODY_REST){ restOnBody(s,s.x,yi); continue; } // roll target landed on a body
      sandActive.splice(i,1);
    }
  }

  function parseCellKey(k){
    const ix=typeof k==='string' ? k.indexOf(',') : -1;
    if(ix<=0) return null;
    const x=+k.slice(0,ix), y=+k.slice(ix+1);
    if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {x,y};
  }
  function drawCracks(ctx,x,y,TILE,ratio,alpha,offset,mode){
    const a=Math.max(0,Math.min(1,alpha));
    const snap=mode==='snap';
    const w=snap ? Math.max(1.2,TILE*(0.035+0.040*ratio)) : Math.max(1,TILE*(0.020+0.024*ratio));
    const shift=(offset||0)*TILE;
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.lineWidth=w+(snap?1.4:1.1);
    ctx.strokeStyle=snap ? 'rgba(48,16,8,'+(0.24+0.34*a).toFixed(3)+')' : 'rgba(10,12,14,'+(0.24+0.28*a).toFixed(3)+')';
    ctx.beginPath();
    ctx.moveTo(x+TILE*0.22+shift,y+TILE*0.34);
    ctx.lineTo(x+TILE*0.43,y+TILE*0.49);
    ctx.lineTo(x+TILE*0.37,y+TILE*0.68);
    if(ratio>0.58 || snap){
      ctx.moveTo(x+TILE*0.48-shift*0.4,y+TILE*0.31);
      ctx.lineTo(x+TILE*0.61,y+TILE*0.46);
      ctx.lineTo(x+TILE*0.57,y+TILE*0.62);
    }
    if(snap){
      ctx.moveTo(x+TILE*0.25,y+TILE*0.76);
      ctx.lineTo(x+TILE*0.45,y+TILE*0.63);
      ctx.lineTo(x+TILE*0.59,y+TILE*0.79);
    }
    ctx.stroke();
    ctx.lineWidth=w;
    ctx.strokeStyle=snap ? 'rgba(255,214,116,'+(0.24+0.34*a).toFixed(3)+')' : 'rgba(232,238,234,'+(0.24+0.32*a).toFixed(3)+')';
    ctx.beginPath();
    ctx.moveTo(x+TILE*0.22+shift,y+TILE*0.34);
    ctx.lineTo(x+TILE*0.43,y+TILE*0.49);
    ctx.lineTo(x+TILE*0.37,y+TILE*0.68);
    if(ratio>0.58 || snap){
      ctx.moveTo(x+TILE*0.48-shift*0.4,y+TILE*0.31);
      ctx.lineTo(x+TILE*0.61,y+TILE*0.46);
      ctx.lineTo(x+TILE*0.57,y+TILE*0.62);
    }
    if(snap){
      ctx.moveTo(x+TILE*0.25,y+TILE*0.76);
      ctx.lineTo(x+TILE*0.45,y+TILE*0.63);
      ctx.lineTo(x+TILE*0.59,y+TILE*0.79);
    }
    ctx.stroke();
  }
  function drawBuildStress(ctx,TILE,tileVisible){
    if(!buildStress.size || !getTile) return;
    const now=(typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const pulse=0.80+0.20*Math.sin(now*0.010);
    ctx.save();
    for(const [raw,ratio] of buildStress){
      const c=parseCellKey(raw);
      if(!c){ buildStress.delete(raw); buildStressFlow.delete(raw); continue; }
      if(!isTrackedPlayerBuild(c.x,c.y)){ buildStress.delete(raw); buildStressFlow.delete(raw); continue; }
      if(!tileVisible(c.x,c.y)) continue;
      const x=c.x*TILE, y=c.y*TILE;
      const danger=Math.max(0,Math.min(1,(ratio-BUILD_STRESS_WARN)/(1-BUILD_STRESS_WARN)));
      const a=Math.max(0,Math.min(1,0.42+danger*0.54))*pulse;
      ctx.fillStyle='rgba(202,210,206,'+(0.055+0.095*danger).toFixed(3)+')';
      ctx.fillRect(x,y,TILE,TILE);
      ctx.strokeStyle='rgba(228,234,230,'+(0.34+0.40*a).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,TILE*(0.026+0.020*danger));
      ctx.strokeRect(x+1.5,y+1.5,Math.max(1,TILE-3),Math.max(1,TILE-3));
      const sweep=(now*0.0014+c.x*0.19+c.y*0.11)%1;
      ctx.strokeStyle='rgba(246,248,244,'+(0.18+0.32*danger).toFixed(3)+')';
      ctx.lineWidth=Math.max(0.85,TILE*(0.014+0.012*danger));
      ctx.beginPath();
      ctx.moveTo(x+TILE*(0.12+sweep*0.55),y+TILE*0.15);
      ctx.lineTo(x+TILE*(0.02+sweep*0.55),y+TILE*0.84);
      ctx.stroke();
      const flow=buildStressFlow.get(raw);
      if(flow && Number.isFinite(flow.dx) && Number.isFinite(flow.dy)){
        const cx=x+TILE*0.5, cy=y+TILE*0.5;
        const len=TILE*(0.24+0.12*danger);
        const sx=cx-flow.dx*len*0.55, sy=cy-flow.dy*len*0.55;
        const ex=cx+flow.dx*len*0.55, ey=cy+flow.dy*len*0.55;
        ctx.strokeStyle='rgba(210,222,218,'+(0.28+0.30*a).toFixed(3)+')';
        ctx.lineWidth=Math.max(1,TILE*(0.020+0.010*danger));
        ctx.beginPath();
        ctx.moveTo(sx,sy);
        ctx.lineTo(ex,ey);
        ctx.stroke();
        const chase=(now*0.0022+c.x*0.13+c.y*0.07)%1;
        const p0=Math.max(0,Math.min(1,chase-0.35)), p1=Math.max(0,Math.min(1,chase-0.08));
        if(p1>p0){
          ctx.strokeStyle='rgba(248,252,246,'+(0.18+0.30*danger).toFixed(3)+')';
          ctx.lineWidth=Math.max(0.8,TILE*(0.012+0.008*danger));
          ctx.beginPath();
          ctx.moveTo(sx+(ex-sx)*p0,sy+(ey-sy)*p0);
          ctx.lineTo(sx+(ex-sx)*p1,sy+(ey-sy)*p1);
          ctx.stroke();
        }
      }
      drawCracks(ctx,x,y,TILE,ratio,a,Math.sin(now*0.014+c.x*0.7+c.y*0.2)*0.014*danger,'stress');
    }
    ctx.restore();
  }
  function drawBuildBreaks(ctx,TILE,tileVisible){
    if(!buildBreaks.length) return;
    const now=(typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    ctx.save();
    for(let i=buildBreaks.length-1;i>=0;i--){
      const b=buildBreaks[i];
      const age=now-b.born;
      if(age>=b.life){ buildBreaks.splice(i,1); continue; }
      if(!tileVisible(b.x,b.y)) continue;
      const t=1-age/b.life;
      const x=b.x*TILE, y=b.y*TILE;
      const cx=x+TILE*0.5, cy=y+TILE*0.5;
      const a=Math.max(0,Math.min(1,t))*b.ratio;
      ctx.fillStyle='rgba(255,42,24,'+(0.12+0.22*a).toFixed(3)+')';
      ctx.fillRect(x,y,TILE,TILE);
      drawCracks(ctx,x,y,TILE,b.ratio,a,Math.sin((b.seed+age)*0.03)*0.035,'snap');
      ctx.lineWidth=Math.max(1,TILE*(0.03+0.05*a));
      ctx.strokeStyle='rgba(255,218,94,'+(0.30+0.55*a).toFixed(3)+')';
      ctx.beginPath();
      for(let s=0;s<6;s++){
        const ang=(b.seed*0.017+s*1.047)+age*0.002;
        const r0=TILE*(0.16+0.02*s);
        const r1=TILE*(0.42+0.18*(1-t));
        ctx.moveTo(cx+Math.cos(ang)*r0, cy+Math.sin(ang)*r0);
        ctx.lineTo(cx+Math.cos(ang)*r1, cy+Math.sin(ang)*r1);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function draw(ctx,TILE,canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const tileVisible = (x,y)=> !visibleTile || visibleTile(Math.floor(x),Math.floor(y));
    drawBuildStress(ctx,TILE,tileVisible);
    for(const b of active){
      if(!tileVisible(b.x,b.yFloat)) continue;
      const x=b.x*TILE, y=b.yFloat*TILE;
      ctx.fillStyle=INFO[b.type].color;
      ctx.fillRect(x,y,TILE,TILE);
      if(b.stress>0) drawCracks(ctx,x,y,TILE,b.stress,Math.max(0.35,b.stress),0,'snap');
    }
    if(sandActive.length){ ctx.fillStyle=INFO[T.SAND].color; for(const s of sandActive){ if(!tileVisible(s.x,s.yFloat)) continue; ctx.fillRect(s.x*TILE,s.yFloat*TILE,TILE,TILE); } }
    drawBuildBreaks(ctx,TILE,tileVisible);
  }

  // --- Public event API (names kept stable for main.js / undo) ---
  function onTileRemoved(x,y){ const c=normalizedWorldCell(x,y); if(!c) return false; x=c.x;y=c.y; unprotectBuild(x,y); forgetManualCityBuild(x,y); forgetPlayerBuild(x,y); forgetSettledRubble(x,y); queueAroundRemoval(x,y); checkBuiltPillarAround(x,y); return true; }
  function recheckNeighborhood(x,y){ const c=normalizedWorldCell(x,y); if(!c) return false; x=c.x;y=c.y; forgetSettledRubble(x,y); syncManualCityBuild(x,y); syncPlayerBuild(x,y); queueCheck(x,y); queueAroundRemoval(x,y); checkBuiltPillarAround(x,y); return true; } // undo can both add and remove tiles
  function afterPlacement(x,y){ const c=normalizedWorldCell(x,y); if(!c) return false; x=c.x;y=c.y; forgetSettledRubble(x,y); rememberManualCityBuild(x,y); rememberPlayerBuild(x,y); queueAroundSettle(x,y); checkBuiltPillarAround(x,y); return true; }
  function sanitizeBatchCells(cells,limit){
    if(!Array.isArray(cells) || !cells.length) return [];
    const out=[];
    const seen=new Set();
    const max=Math.max(1,limit|0);
    const scan=Math.min(cells.length,max*4);
    for(let i=0;i<scan;i++){
      if(out.length>=max) break;
      let c=null;
      try{ c=cells[i]; }catch(e){ continue; }
      if(!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const x=Math.floor(c.x), y=Math.floor(c.y);
      if(!finiteX(x) || !inWorldY(y)) continue;
      const kk=key(x,y);
      if(seen.has(kk)) continue;
      seen.add(kk);
      out.push({x,y});
    }
    return out;
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
    const out=[];
    const used=new Set();
    const add=(x,y)=>{
      if(out.length>=cap || !Number.isFinite(y)) return;
      const kk=key(x,y);
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
  function onTilesChangedBatch(removedCells,placedCells,opts){
    opts=opts||{};
    const wakeCap=Math.max(16,Math.min(256,(opts.wakeCap|0)||CHANGE_BATCH_WAKE_CAP));
    const removed=sanitizeBatchCells(removedCells,6000);
    const placed=sanitizeBatchCells(placedCells,6000);
    for(const c of removed){
      unprotectBuild(c.x,c.y);
      forgetManualCityBuild(c.x,c.y);
      forgetPlayerBuild(c.x,c.y);
      forgetSettledRubble(c.x,c.y);
    }
    for(const c of placed){
      forgetSettledRubble(c.x,c.y);
      rememberManualCityBuild(c.x,c.y);
      rememberPlayerBuild(c.x,c.y);
    }
    for(const c of selectBatchWakeCells(removed,wakeCap)){
      queueAroundRemoval(c.x,c.y);
      checkBuiltPillarAround(c.x,c.y);
    }
    for(const c of selectBatchWakeCells(placed,wakeCap)){
      queueAroundSettle(c.x,c.y);
      checkBuiltPillarAround(c.x,c.y);
    }
    return {removed:removed.length,placed:placed.length};
  }
  function maybeStart(x,y){ queueCheck(x,y); }
  function isPlayerBuiltAt(x,y){ const c=normalizedWorldCell(x,y); return !!c && isTrackedPlayerBuild(c.x,c.y); }
  // Re-loosen a tile the burial resolver pulled off the hero: the entity rests
  // on an authoritative body and settles normally once it steps away.
  function spawnLoose(x,y,t){
    if(!validFallingType(t) || !finiteX(x) || !Number.isFinite(y)) return false;
    x=Math.floor(x); y=clampY(y);
    if(t===T.SAND) spawnSand(x,y); else spawn(x,y,t,isRubbleTrackedMaterial(t));
    return true;
  }
  function isSettledRubbleAt(x,y){
    const cell=normalizedWorldCell(x,y);
    return !!cell && isSettledRubble(cell.x,cell.y);
  }

  function reset(){ active.length=0; sandActive.length=0; unstable.clear(); quietStable.clear(); auditJobs.length=0; auditPending.clear(); auditLast.clear(); manualCityBuilt.clear(); playerBuilt.clear(); buildStress.clear(); buildStressFlow.clear(); buildBreaks.length=0; settledRubble.clear(); protectedBuilds.clear(); }
  function metrics(){ return {queue:unstable.size, audit:auditJobs.length, active:active.length, sand:sandActive.length, debris:settledRubble.size, built:playerBuilt.size, stress:buildStress.size, breaks:buildBreaks.length, protected:protectedBuilds.size}; }
  function parseSavedKey(k){
    if(typeof k!=='string' || k.length>=32) return null;
    const ix=k.indexOf(',');
    if(ix<=0 || ix!==k.lastIndexOf(',')) return null;
    const x=+k.slice(0,ix), y=+k.slice(ix+1);
    if(!finiteX(x) || !Number.isFinite(y) || !inWorldY(y)) return null;
    return Math.floor(x)+','+Math.floor(y);
  }
  function keyTile(k){
    const kk=parseSavedKey(k);
    if(!kk || !getTile) return null;
    const ix=kk.indexOf(',');
    return {k:kk,x:+kk.slice(0,ix),y:+kk.slice(ix+1),t:getTile(+kk.slice(0,ix),+kk.slice(ix+1))};
  }
  function snapshot(){ try{
    const built=[];
    for(const raw of manualCityBuilt){
      const cell=keyTile(raw);
      if(cell && isBuiltPillarMaterial(cell.t)) built.push(cell.k);
      if(built.length>=20000) break;
    }
    const playerBuiltOut=[];
    for(const raw of playerBuilt){
      const cell=keyTile(raw);
      if(cell && isPlayerBuiltMaterial(cell.t)) playerBuiltOut.push(cell.k);
      if(playerBuiltOut.length>=PLAYER_BUILT_SAVE_CAP) break;
    }
    const debris=[];
    for(const raw of settledRubble){
      const cell=keyTile(raw);
      if(cell && isRubbleTrackedMaterial(cell.t)) debris.push(cell.k);
      if(debris.length>=22000) break;
    }
    const protectedOut=[];
    for(const raw of protectedBuilds){
      const kk=parseSavedKey(raw);
      if(kk) protectedOut.push(kk);
      if(protectedOut.length>=PROTECTED_SAVE_CAP) break;
    }
    return {
      v:5,
      active:active.map(b=>restoredRigid({x:b.x,y:b.yFloat,type:b.type,vy:b.vy,windCarry:b.windCarry||0,rubble:!!b.rubble})).filter(Boolean).map(b=>({x:b.x,y:b.yFloat,type:b.type,vy:b.vy,windCarry:b.windCarry||0,rubble:!!b.rubble})),
      sand:sandActive.map(s=>restoredSand({x:s.x,y:s.yFloat,vy:s.vy,windCarry:s.windCarry||0})).filter(Boolean).map(s=>({x:s.x,y:s.yFloat,vy:s.vy,windCarry:s.windCarry||0})),
      queue:[...unstable].map(parseSavedKey).filter(Boolean).slice(0,6000),
      built,
      playerBuilt:playerBuiltOut,
      debris,
      protected:protectedOut
    };
  }catch(e){ return null; } }
  function restoreEntries(items,scanCap,visit){
    if(!Array.isArray(items)) return;
    const n=Math.min(items.length,Math.max(0,scanCap|0));
    for(let i=0;i<n;i++){
      try{ visit(items[i]); }catch(e){}
    }
  }
  function restore(s){ reset(); if(!s||typeof s!=='object') return; try{
    restoreEntries(s.active,ACTIVE_RIGID_CAP,b=>{ const r=restoredRigid(b); if(r && active.length<ACTIVE_RIGID_CAP) active.push(r); });
    restoreEntries(s.sand,3000,g=>{ const r=restoredSand(g); if(r && sandActive.length<3000) sandActive.push(r); });
    restoreEntries(s.queue,6000,k=>{ const kk=parseSavedKey(k); if(kk && unstable.size<6000) unstable.add(kk); });
    restoreEntries(s.built,20000,k=>{ const kk=parseSavedKey(k); if(kk && manualCityBuilt.size<20000) manualCityBuilt.add(kk); });
    restoreEntries(s.playerBuilt,PLAYER_BUILT_SAVE_CAP,k=>{ const kk=parseSavedKey(k); if(kk && playerBuilt.size<PLAYER_BUILT_SAVE_CAP) playerBuilt.add(kk); });
    restoreEntries(s.debris,22000,k=>{ const kk=parseSavedKey(k); if(kk && settledRubble.size<22000) settledRubble.add(kk); });
    restoreEntries(s.protected,PROTECTED_SAVE_CAP,k=>{ const kk=parseSavedKey(k); if(kk && protectedBuilds.size<PROTECTED_SAVE_CAP) protectedBuilds.add(kk); });
    for(const k of playerBuilt){ if(unstable.size>=6000) break; if(protectedBuilds.has(k)) continue; unstable.add(k); }
  }catch(e){} }

  function _debug(){
    return {
      stress:[...buildStress].map(([raw,ratio])=>Object.assign({ratio},buildStressFlow.get(raw)||{},parseCellKey(raw)||{})).filter(c=>Number.isFinite(c.x)),
      breaks:buildBreaks.map(b=>({x:b.x,y:b.y,ratio:b.ratio,age:((typeof performance !== 'undefined' && performance.now)?performance.now():Date.now())-b.born})),
      thresholds:{warn:BUILD_STRESS_WARN,danger:BUILD_STRESS_DANGER,fail:BUILD_STRESS_FAIL}
    };
  }

  MM.fallingSolids={init,update,draw,onTileRemoved,onTilesChangedBatch,maybeStart,reset,recheckNeighborhood,afterPlacement,canSupportPlacement,isPlayerBuiltAt,spawnLoose,isSettledRubbleAt,heroRestingLoad,auditChunks,settleAll,snapshot,restore,metrics,protectStructure,protectBuild,unprotectBuild,isProtectedBuild,_debug};
})();
// ESM export (progressive migration)
export const fallingSolids = (typeof window!=='undefined' && window.MM) ? window.MM.fallingSolids : undefined;
export default fallingSolids;
