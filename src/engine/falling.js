// Falling-solid physics: rigid bodies (stone clusters, diamonds) + granular sand.
// Event-driven design: tile edits queue "instability checks" (a Set of cells); the
// per-frame processor releases unstable tiles into moving entities. Sand obeys an
// angle-of-repose rule (a grain topples when a side and the cell below it are open),
// so piles relax into natural 45° slopes and avalanches propagate frame by frame.
import { CHUNK_W, T, INFO, WORLD_H } from '../constants.js';
window.MM = window.MM || {};
(function(){
  const G_AIR = 60,  G_WATER = 25;            // gravity (tiles/s^2); buoyancy reduces it in water
  const VMAX_AIR = 55, VMAX_WATER = 9;        // terminal velocity for rigid blocks
  const SAND_VMAX_AIR = 70, SAND_VMAX_WATER = 7; // sand drifts down slowly through water
  const QUEUE_BUDGET = 360;                   // instability checks per frame (cascades span frames)
  const QUEUE_BUDGET_LOW_FPS = 120;
  const QUEUE_BUDGET_CRITICAL = 48;
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
  const BUILD_BREAK_EFFECT_MS = 900;

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
  const buildBreaks = []; // short-lived visual flashes where player-built structure snapped
  const settledRubble = new Set(); // structural debris that already fell and should not become a new building frame
  // Tile accessors supplied by main.js; update() refreshes them so event-driven
  // helpers (onTileRemoved etc.) always see the live world.
  let getTile = null, setTile = null;
  function init(gt, st){ getTile = gt; setTile = st; }
  const key = (x,y)=>x+','+y;
  function supportSignature(x,y){
    if(!getTile) return '';
    return getTile(x,y)+'/'+getTile(x,y+1)+'/'+getTile(x-1,y)+'/'+getTile(x+1,y)+'/'+getTile(x,y-1);
  }
  function markQuiet(x,y){
    if(!getTile || y<0 || y>=WORLD_H) return;
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
  function passable(t){ return t===T.AIR || t===T.WATER || (t!==T.DYNAMO_SLOT && t!==T.TELEPORTER && !!(INFO[t] && INFO[t].passable)); }
  function isGas(t){ return !!(INFO[t] && INFO[t].gas); }
  function notifyGasChange(x,y,oldTile,newTile){
    if(oldTile===newTile || (!isGas(oldTile) && !isGas(newTile))) return;
    try{ const g=window.MM && MM.gases; if(g && g.onTileChanged) g.onTileChanged(x,y,oldTile,newTile); }catch(e){}
  }
  function isStructural(t){ return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK || t===T.STEEL || t===T.METEORIC_IRON || t===T.IRIDIUM || t===T.OBSIDIAN; }
  function isFragileFalling(t){ return t===T.GLASS; }
  function isLooseRigid(t){ return t===T.DIAMOND || t===T.ELECTRONICS; }
  function isRigidObject(t){
    const info=INFO[t];
    if(!info) return false;
    if(info.chestTier) return true;
    if(t===T.TELEPORTER) return true;
    if(info.machine && t!==T.DYNAMO_SLOT && t!==T.COPPER_WIRE && t!==T.WATER_PIPE) return true;
    return false;
  }
  function isMountedFixture(t){
    return t===T.TORCH;
  }
  function isPlayerBuiltMaterial(t){
    const info=INFO[t];
    if(!info || !info.color || info.passable || info.chestTier || info.gas || info.machine || info.looseItem) return false;
    if(t===T.AIR || t===T.WATER || t===T.LAVA || t===T.SAND || t===T.BEDROCK) return false;
    if(t===T.TORCH || t===T.WIRE || t===T.COPPER_WIRE || t===T.GRAVE) return false;
    if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) return false;
    return true;
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
    if(isTrackedPlayerBuild(x,y)) return true;
    if(isSettledRubble(x,y)) return false;
    if(!getTile || !legacyBuildMaterial(t) || !isPlayerBuiltMaterial(t)) return false;
    if(!aboveGeneratedSurface(x,y)) return false;
    if(t===T.WOOD && likelyTreeWood(x,y)) return false;
    if(knownTreeTile(x,y)) return false;
    const k=key(x,y);
    if(playerBuilt.size>PLAYER_BUILT_SAVE_CAP) playerBuilt.clear();
    playerBuilt.add(k);
    quietStable.delete(k);
    return true;
  }
  function isRubbleTrackedMaterial(t){
    return isStructural(t) || isPlayerBuiltMaterial(t);
  }
  function isObjectFooting(t){
    const info=INFO[t];
    if(t===T.AIR || t===T.WATER || t===T.LAVA || t===T.DYNAMO_SLOT) return false;
    if(info && (info.gas || info.passable || info.looseItem)) return false;
    return true;
  }
  function isObjectBrace(t){
    const info=INFO[t];
    if(t===T.AIR || t===T.WATER || t===T.LAVA || t===T.DYNAMO_SLOT) return false;
    if(info && (info.gas || info.passable || info.looseItem || info.machine || info.chestTier)) return false;
    return true;
  }
  function objectAnchorAt(x,y){
    if(y+1>=WORLD_H) return true;
    if(isObjectFooting(getTile(x,y+1))) return true;
    if(isObjectBrace(getTile(x-1,y)) || isObjectBrace(getTile(x+1,y)) || isObjectBrace(getTile(x,y-1))) return true;
    return false;
  }
  function isLoadBearingSupport(t){
    const info=INFO[t];
    if(passable(t) || isStructural(t) || isFragileFalling(t) || isLooseRigid(t)) return false;
    if(t===T.DYNAMO_SLOT) return false;
    if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC) return false;
    if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) return false;
    if(info && (info.machine || info.looseItem || info.gas)) return false;
    return true;
  }
  function spawn(x,y,t,rubble,stress){ active.push({x,yFloat:y,type:t,vy:0,wet:false,rubble:!!rubble,windCarry:0,stress:Math.max(0,Math.min(1,stress||0))}); }
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
    if(type===T.SAND) return 0.22;
    if(type===T.GLASS) return 0.16;
    if(type===T.DIAMOND || type===T.ELECTRONICS) return 0.09;
    if(type===T.ALIEN_BIOMASS) return 0.085;
    if(type===T.SNOW) return 0.075;
    if(type===T.GRASS || type===T.DIRT) return 0.065;
    if(type===T.WOOD) return 0.06;
    if(type===T.ICE || type===T.MUD || type===T.COAL) return 0.045;
    if(type===T.STONE) return rubble ? 0.022 : 0.014;
    if(type===T.GRANITE) return rubble ? 0.018 : 0.011;
    if(type===T.RADIOACTIVE_ORE) return 0.012;
    if(type===T.BASALT || type===T.BEDROCK) return 0.009;
    if(type===T.OBSIDIAN || type===T.ANTIMATTER_CRYSTAL) return 0.010;
    if(type===T.IRIDIUM) return 0.008;
    if(type===T.METEORIC_IRON) return 0.007;
    if(type===T.STEEL) return 0.006;
    return 0.035;
  }
  function canWindShift(x,y,dir){
    if(y<0 || y>=WORLD_H) return false;
    if(!passable(getTile(x+dir,y))) return false;
    if(playerBlocks(x+dir,y)) return false;
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

  // Never solidify a tile inside the player — the entity rests on them until they move
  function playerBlocks(x,y){ const p=window.player; if(!p) return false; return x+1 > p.x-p.w/2 && x < p.x+p.w/2 && y+1 > p.y-p.h/2 && y < p.y+p.h/2; }
  function rubbleCrushes(t){ return isFragileFalling(t) || t===T.WIRE || t===T.COPPER_WIRE || t===T.ELECTRONICS; }
  function crushTile(x,y){
    const t=getTile(x,y);
    if(!rubbleCrushes(t)) return false;
    setTile(x,y,T.AIR);
    forgetSettledRubble(x,y);
    queueAroundRemoval(x,y);
    if(isFragileFalling(t)) breakFragile(x,y);
    return true;
  }

  // Write a settled solid into the world, displacing (not destroying) any water there
  function occupy(x,y,type){
    let yy=y; while(yy>0 && !passable(getTile(x,yy))) yy--; // cell may have been claimed this frame — stack upward
    const was=getTile(x,yy);
    if(was===T.WATER) displaceWater(x,yy);
    setTile(x,yy,type);
    forgetSettledRubble(x,yy);
    notifyGasChange(x,yy,was,type);
    if(was===T.WATER) notifyWater(x,yy);
    return yy;
  }

  function clampY(y){
    const yy=Math.floor(y);
    return Number.isFinite(yy) ? Math.max(0, Math.min(WORLD_H-1, yy)) : 0;
  }
  function finiteX(x){ return Number.isFinite(x) && Math.abs(x)<10000000; }
  function validFallingType(t){ return Number.isInteger(t) && !!INFO[t]; }
  function restoredRigid(raw){
    if(!raw || !finiteX(raw.x) || !Number.isFinite(raw.y) || !validFallingType(raw.type)) return null;
    return {
      x:Math.floor(raw.x),
      yFloat:Math.max(0,Math.min(WORLD_H-1,raw.y)),
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
      yFloat:Math.max(0,Math.min(WORLD_H-1,raw.y)),
      vy:Number.isFinite(raw.vy)?Math.max(-120,Math.min(120,raw.vy)):0,
      windCarry:Number.isFinite(raw.windCarry)?Math.max(-4,Math.min(4,raw.windCarry)):0,
      wet:false
    };
  }
  function dropY(x,y){
    let yy=clampY(y);
    while(yy>0 && !passable(getTile(x,yy))) yy--;
    while(yy<WORLD_H-1 && passable(getTile(x,yy+1))) yy++;
    return yy;
  }
  function rollDepth(x,y){
    let yy=clampY(y), d=0;
    while(d<32 && yy<WORLD_H-1 && passable(getTile(x,yy+1))){ yy++; d++; }
    return d;
  }
  function chooseSandRollDir(x,y,originX,step){
    if(y+1>=WORLD_H) return 0;
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
      }
    }
    return cluster.length>0;
  }
  function isBuiltPillarMaterial(t){
    const info=INFO[t];
    if(!info || !info.color || info.chestTier) return false;
    if(info.passable || info.machine || info.looseItem || info.gas) return false;
    if(t===T.AIR || t===T.WATER || t===T.LAVA || t===T.TORCH || t===T.WIRE || t===T.GRAVE || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE) return false;
    if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT || t===T.ELECTRONICS) return false;
    return true;
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
      if(t!==T.WIRE && !passable(t) && !isFragileFalling(t)) return true;
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
    const below=y+1>=WORLD_H ? T.STONE : getTile(x,y+1);
    if(y+1<WORLD_H && (passable(below) || rubbleCrushes(below))){
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
  function settleSand(sx,fromY){
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
    if(type===T.STEEL) return 5;
    if(type===T.METEORIC_IRON) return 4;
    if(type===T.IRIDIUM) return 4;
    if(type===T.OBSIDIAN) return 3;
    return 4;
  }
  function chooseRubbleRollDir(x,y,type,originX,step){
    if(y+1>=WORLD_H) return 0;
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
  function settleRubble(sx,fromY,type){
    let x=Math.floor(sx);
    if(!Number.isFinite(x)) x=0;
    let y=clampY(fromY);
    while(y>0 && !passable(getTile(x,y))) y--;
    while(y<WORLD_H-1){
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
      while(y>0 && !passable(getTile(x,y))) y--;
      while(y<WORLD_H-1){
        const below=getTile(x,y+1);
        if(passable(below)){ y++; continue; }
        if(crushTile(x,y+1)){ y++; continue; }
        break;
      }
    }
    const restY=occupy(x,y,type);
    markSettledRubble(x,restY,type);
    queueAroundSettle(x,restY);
    return restY;
  }

  // --- Instability queue ---
  function queueCheck(x,y){
    if(y<0 || y>=WORLD_H) return;
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
    const trackedBuild=isTrackedPlayerBuild(x,y);
    if(quietStable.has(ck)){
      const sig=supportSignature(x,y);
      if(!trackedBuild && quietStable.get(ck)===sig) return;
      quietStable.delete(ck);
    }
    const t=getTile(x,y);
    if(t===T.SAND){
      if(y+1>=WORLD_H) return; // bottom row is bedrock-stable
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
      if(y+1<WORLD_H && passable(getTile(x,y+1))){ setTile(x,y,T.AIR); spawn(x,y,t); queueAroundRemoval(x,y); }
    } else if(isFragileFalling(t)){
      if(processFragileAt(x,y,processed)) return;
    } else if(t===T.WIRE){
      processWireAt(x,y,processed);
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
    if(t===T.STEEL) return 18;
    if(t===T.IRIDIUM) return 20;
    if(t===T.METEORIC_IRON) return 17;
    if(t===T.OBSIDIAN) return 13;
    return 11;
  }
  function structuralTransferCost(x,y,nx,ny){
    if(nx===x && ny<y) return 0.35;
    if(nx===x && ny>y) return 0.20;
    return 1.00;
  }
  function isCityLikeCluster(cluster, hasReinforced){
    const wg=window.MM && MM.worldGen;
    if(!wg || !wg.biomeType) return !!hasReinforced;
    for(const c of cluster){ try{ if(wg.biomeType(c.x)===8) return true; }catch(e){} }
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
    return isCityTerrainAnchor(x,y,t) || isWideStructuralSlabAnchor(x,y,t);
  }
  function isCityColumn(x){
    const wg=window.MM && MM.worldGen;
    if(!wg || !wg.biomeType) return false;
    try{ return wg.biomeType(x)===8; }catch(e){ return false; }
  }
  function shouldAuditTile(x,y,t){
    if(claimLegacyPlayerBuild(x,y,t)) return true;
    if(isRigidObject(t) || isMountedFixture(t)) return true;
    if(t===T.GLASS || t===T.WIRE || t===T.ELECTRONICS || t===T.STEEL || t===T.METEORIC_IRON || t===T.IRIDIUM) return true;
    if(isStructural(t)) return isCityColumn(x) && !isStructuralAnchor(x,y,t);
    return false;
  }
  function auditCell(x,y){
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
    if(t===T.ELECTRONICS){
      if(y+1<WORLD_H && passable(getTile(x,y+1))) queueCheck(x,y);
      return;
    }
    if(t===T.WIRE){
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
    for(let y=0; y<WORLD_H-3; y++) auditCell(wx,y);
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
    if(t===T.IRIDIUM) return {strength:28, weight:1.22, compression:0.16, lateral:0.86, flex:1.24, down:0.24, warn:0.38, fail:0.985};
    if(t===T.METEORIC_IRON) return {strength:26, weight:1.45, compression:0.17, lateral:0.93, flex:1.18, down:0.27, warn:0.36, fail:0.975};
    if(t===T.STEEL) return {strength:24, weight:1.35, compression:0.18, lateral:1.02, flex:1.18, down:0.27, warn:0.34, fail:0.970};
    if(t===T.ANTIMATTER_CRYSTAL) return {strength:22, weight:1.05, compression:0.24, lateral:1.18, flex:0.72, down:0.28, warn:0.20, fail:0.860};
    if(t===T.OBSIDIAN) return {strength:19, weight:1.30, compression:0.43, lateral:1.08, flex:0.92, down:0.26, warn:0.24, fail:0.930};
    if(t===T.DIAMOND) return {strength:18, weight:1.08, compression:0.30, lateral:1.22, flex:0.76, down:0.25, warn:0.22, fail:0.870};
    if(t===T.BASALT) return {strength:17, weight:1.24, compression:0.40, lateral:1.06, flex:0.95, down:0.25, warn:0.25, fail:0.925};
    if(t===T.GRANITE) return {strength:15, weight:1.18, compression:0.38, lateral:1.06, flex:0.96, down:0.24, warn:0.26, fail:0.920};
    if(t===T.RADIOACTIVE_ORE) return {strength:13.5, weight:1.52, compression:0.46, lateral:1.22, flex:0.76, down:0.30, warn:0.22, fail:0.880};
    if(t===T.STONE) return {strength:12, weight:1.05, compression:0.37, lateral:1.05, flex:1.00, down:0.21, warn:0.28, fail:0.930};
    if(t===T.WOOD) return {strength:7.6, weight:0.72, compression:0.26, lateral:0.90, flex:1.12, down:0.17, warn:0.42, fail:0.925};
    if(t===T.COAL) return {strength:6.8, weight:0.86, compression:0.48, lateral:1.20, flex:0.76, down:0.22, warn:0.20, fail:0.830};
    if(t===T.ALIEN_BIOMASS) return {strength:5.6, weight:0.62, compression:0.30, lateral:0.98, flex:1.24, down:0.16, warn:0.36, fail:0.900};
    if(t===T.GLASS) return {strength:3.4, weight:0.88, compression:0.70, lateral:1.45, flex:0.55, down:0.28, warn:0.18, fail:0.720};
    if(t===T.ELECTRONICS) return {strength:3.2, weight:0.72, compression:0.64, lateral:1.50, flex:0.55, down:0.24, warn:0.18, fail:0.760};
    if(t===T.ICE) return {strength:5.4, weight:0.82, compression:0.55, lateral:1.28, flex:0.70, down:0.24, warn:0.22, fail:0.840};
    if(t===T.SNOW) return {strength:4.8, weight:0.72, compression:0.54, lateral:1.22, flex:0.78, down:0.22, warn:0.22, fail:0.830};
    if(t===T.DIRT || t===T.GRASS || t===T.MUD) return {strength:6.5, weight:1.00, compression:0.42, lateral:1.15, flex:0.86, down:0.22, warn:0.25, fail:0.880};
    return {strength:8, weight:1.00, compression:0.35, lateral:1.05, flex:1.00, down:0.20, warn:BUILD_STRESS_WARN, fail:BUILD_STRESS_FAIL};
  }
  function builtSupportStrength(t){ return builtMaterialProfile(t).strength; }
  function builtVerticalCompressionCost(t){ return builtMaterialProfile(t).compression; }
  function builtTransferCost(from,to){
    const p=builtMaterialProfile(to.t);
    const fromFlex=Math.max(0.55,builtMaterialProfile(from.t).flex);
    if(to.x===from.x && to.y<from.y) return builtVerticalCompressionCost(to.t);
    if(to.x===from.x && to.y>from.y) return p.down*p.weight;
    return (p.lateral*p.weight)/fromFlex;
  }
  function isBuildAnchorTile(t){
    const info=INFO[t];
    if(passable(t) || isFragileFalling(t) || isLooseRigid(t)) return false;
    if(t===T.DYNAMO_SLOT || t===T.WIRE || t===T.COPPER_WIRE) return false;
    if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC) return false;
    if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT || t===T.GRAVE) return false;
    if(info && (info.machine || info.looseItem || info.gas)) return false;
    return true;
  }
  function builtSupportMultiplier(c,componentKeys){
    if(c.y+1>=WORLD_H) return 1;
    let best=0;
    const belowKey=key(c.x,c.y+1);
    if(!componentKeys.has(belowKey) && isBuildAnchorTile(getTile(c.x,c.y+1))) best=Math.max(best,1);
    for(const dir of [-1,1]){
      const sideKey=key(c.x+dir,c.y);
      if(!componentKeys.has(sideKey) && isBuildAnchorTile(getTile(c.x+dir,c.y))) best=Math.max(best,0.62);
    }
    const aboveKey=key(c.x,c.y-1);
    if(!componentKeys.has(aboveKey) && isBuildAnchorTile(getTile(c.x,c.y-1))) best=Math.max(best,0.72);
    return best;
  }
  function supportedBuiltKeys(component,componentKeys,supports){
    const best=new Map();
    const byKey=new Map(component.map(c=>[key(c.x,c.y),c]));
    const q=[];
    for(const c of supports){
      const budget=builtSupportStrength(c.t)*c.mult;
      const k=key(c.x,c.y);
      best.set(k,budget);
      q.push({x:c.x,y:c.y,budget});
    }
    let head=0;
    while(head<q.length){
      const cur=q[head++];
      const curKey=key(cur.x,cur.y);
      const curCell=byKey.get(curKey);
      if(!curCell || cur.budget < (best.get(curKey) ?? -Infinity)) continue;
      const ns=[[cur.x+1,cur.y],[cur.x-1,cur.y],[cur.x,cur.y+1],[cur.x,cur.y-1]];
      for(const n of ns){
        const nk=key(n[0],n[1]);
        if(!componentKeys.has(nk)) continue;
        const next=byKey.get(nk);
        if(!next) continue;
        const nextBudget=cur.budget-builtTransferCost(curCell,next);
        if(nextBudget<0) continue;
        if(nextBudget <= (best.get(nk) ?? -Infinity)) continue;
        best.set(nk,nextBudget);
        q.push({x:n[0],y:n[1],budget:nextBudget});
      }
    }
    return best;
  }
  function canSupportPlacement(px,py,pt){
    if(!getTile || !isPlayerBuiltMaterial(pt)) return {ok:true, applies:false};
    px=Math.floor(px); py=Math.floor(py);
    if(!Number.isFinite(px) || !Number.isFinite(py) || py<0 || py>=WORLD_H) return {ok:false, reason:'Brak podparcia'};
    const virtualKey=key(px,py);
    const virtualTile=(x,y)=> (x===px && y===py) ? pt : getTile(x,y);
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
    const supports=[];
    for(const c of component){
      let mult=0;
      if(c.y+1>=WORLD_H) mult=1;
      const belowKey=key(c.x,c.y+1);
      if(!componentKeys.has(belowKey) && isBuildAnchorTile(virtualTile(c.x,c.y+1))) mult=Math.max(mult,1);
      for(const dir of [-1,1]){
        const sideKey=key(c.x+dir,c.y);
        if(!componentKeys.has(sideKey) && isBuildAnchorTile(virtualTile(c.x+dir,c.y))) mult=Math.max(mult,0.62);
      }
      const aboveKey=key(c.x,c.y-1);
      if(!componentKeys.has(aboveKey) && isBuildAnchorTile(virtualTile(c.x,c.y-1))) mult=Math.max(mult,0.72);
      if(mult>0) supports.push(Object.assign({mult},c));
    }
    if(!supports.length) return {ok:false, reason:'Brak podparcia'};
    const stable=supportedBuiltKeys(component,componentKeys,supports);
    if(!stable.has(virtualKey)) return {ok:false, reason:'Brak podparcia'};
    const failing=overstressedBuiltCells(component,stable,new Set());
    if(failing.some(c=>key(c.x,c.y)===virtualKey)) return {ok:false, reason:'Za duze naprezenie'};
    if(failing.length) return {ok:false, reason:'Konstrukcja peknie'};
    return {ok:true, applies:true};
  }
  function buildStressRatio(c,budget){
    if(!Number.isFinite(budget)) return 0;
    return Math.max(0,Math.min(1,1-budget/Math.max(1,builtSupportStrength(c.t))));
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
      if(ratio>=builtMaterialProfile(c.t).fail) out.push(Object.assign({stress:ratio},c));
    }
    return out;
  }
  function recordBuildStress(component,best,fallingKeys){
    if(buildStress.size>BUILD_STRESS_CAP) buildStress.clear();
    for(const c of component) buildStress.delete(key(c.x,c.y));
    for(const c of component){
      const k=key(c.x,c.y);
      if(fallingKeys && fallingKeys.has(k)) continue;
      const budget=best.get(k);
      if(!Number.isFinite(budget)) continue;
      const ratio=buildStressRatio(c,budget);
      if(ratio>=builtMaterialProfile(c.t).warn) buildStress.set(k,+ratio.toFixed(3));
    }
  }
  function releaseBuiltCells(cells){
    if(!cells.length) return false;
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
    }
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
    if(sy+1>=WORLD_H || isLoadBearingSupport(belowStart) || isStructuralAnchor(sx,sy+1,belowStart)){ processed.add(key(sx,sy)); markQuiet(sx,sy); return false; } // directly supported
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
      if(y+1>=WORLD_H){ directSupport=true; }
      const below=getTile(x,y+1);
      if(isStructuralAnchor(x,y+1,below)) directSupport=true;
      if(isLoadBearingSupport(below)) directSupport=true;
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
    return falling.length>0;
  }

  // Freeze in-flight material into tiles so it can never be lost. Sand gets a
  // granular side-roll here too; otherwise autosave can turn a cascade into a chimney.
  function dropToRest(x, fromY, type, rubble){
    if(type===T.SAND) return settleSand(x,fromY);
    if(isFragileFalling(type)) return breakFragile(x,fromY);
    if(rubble && isRubbleTrackedMaterial(type)) return settleRubble(x,fromY,type);
    let y=Math.max(0, Math.min(WORLD_H-1, Math.floor(fromY)));
    while(y<WORLD_H-1 && passable(getTile(x,y+1))) y++;
    const restY=occupy(x,y,type);
    queueCheck(x,restY);
    return restY;
  }
  // The v5 save persists tiles only — airborne entities would vanish on reload.
  // buildSaveObject() calls this right before serializing chunks.
  function settleAll(){
    if(!getTile) return;
    let guard=0;
    while((auditJobs.length || unstable.size || active.length || sandActive.length) && guard++<24){
      drainAuditJobs();
      drainQueueForSettle();
      const blocks=[...active].sort((a,b)=>b.yFloat-a.yFloat);
      active.length=0;
      for(const b of blocks) dropToRest(b.x, b.yFloat, b.type, b.rubble);
      const grains=[...sandActive].sort((a,b)=>b.yFloat-a.yFloat);
      sandActive.length=0;
      for(const s of grains) dropToRest(s.x, s.yFloat, T.SAND);
    }
    active.length=0;
    sandActive.length=0;
  }

  // --- Entity integration (swept, cell-by-cell — large dt cannot tunnel through floors) ---
  function update(gt,st,dt){
    if(!(dt>0) || !isFinite(dt)) return;
    init(gt,st);
    const frameMs=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    processAuditJobs(frameMs>40 ? 1 : (frameMs>24 ? 2 : 5));
    processQueue();
    // Overload guard: a pathological cascade can't accumulate unbounded entities
    if(sandActive.length>3000){ const excess=sandActive.splice(0, sandActive.length-3000).sort((a,b)=>b.yFloat-a.yFloat); for(const s of excess) dropToRest(s.x, s.yFloat, T.SAND); }
    if(active.length>ACTIVE_RIGID_CAP){
      const excess=active.splice(0, active.length-ACTIVE_RIGID_CAP).sort((a,b)=>b.yFloat-a.yFloat);
      for(const b of excess) dropToRest(b.x,b.yFloat,b.type,b.rubble);
    }

    for(let i=active.length-1;i>=0;i--){
      const b=active[i];
      const inWater = getTile(b.x, Math.floor(b.yFloat))===T.WATER;
      if(inWater && !b.wet){ b.wet=true; splash(b.x,b.yFloat,b.vy); notifyWater(b.x,Math.floor(b.yFloat)); if(b.vy>VMAX_WATER*1.6) b.vy=VMAX_WATER*1.6; }
      else if(!inWater) b.wet=false;
      applyWindToFalling(b,b.type,dt,inWater);
      b.vy += (inWater?G_WATER:G_AIR)*dt;
      const cap=inWater?VMAX_WATER:VMAX_AIR; if(b.vy>cap) b.vy=cap;
      let remaining=b.vy*dt, settledAt=-1;
      while(remaining>0){
        const yi=Math.floor(b.yFloat);
        if(yi>=WORLD_H-1){ b.yFloat=WORLD_H-1; settledAt=WORLD_H-1; break; }
        let below=getTile(b.x,yi+1);
        if(b.rubble && isStructural(b.type) && crushTile(b.x,yi+1)) below=T.AIR;
        if(!passable(below)){ settledAt=yi; break; }
        const dist=(yi+1)-b.yFloat;
        if(remaining<dist){ b.yFloat+=remaining; remaining=0; }
        else { b.yFloat=yi+1; remaining-=dist; }
      }
      if(settledAt>=0){
        if(playerBlocks(b.x,settledAt)){ b.vy=0; b.yFloat=settledAt; continue; } // rest on the player until they move
        if(isFragileFalling(b.type)){ breakFragile(b.x,settledAt); active.splice(i,1); continue; }
        if(b.rubble && isRubbleTrackedMaterial(b.type)) settleRubble(b.x,settledAt,b.type);
        else occupy(b.x,settledAt,b.type);
        active.splice(i,1);
      }
    }

    for(let i=sandActive.length-1;i>=0;i--){
      const s=sandActive[i];
      const inWater = getTile(s.x, Math.floor(s.yFloat))===T.WATER;
      if(inWater && !s.wet){ s.wet=true; splash(s.x,s.yFloat,s.vy); if(s.vy>SAND_VMAX_WATER*1.6) s.vy=SAND_VMAX_WATER*1.6; }
      else if(!inWater) s.wet=false;
      applyWindToFalling(s,T.SAND,dt,inWater);
      s.vy += (inWater?G_WATER:G_AIR)*dt;
      const cap=inWater?SAND_VMAX_WATER:SAND_VMAX_AIR; if(s.vy>cap) s.vy=cap;
      let remaining=s.vy*dt, blockedAt=-1;
      while(remaining>0){
        const yi=Math.floor(s.yFloat);
        if(yi>=WORLD_H-1){ s.yFloat=WORLD_H-1; blockedAt=WORLD_H-1; break; }
        if(!passable(getTile(s.x,yi+1))){ blockedAt=yi; break; }
        const dist=(yi+1)-s.yFloat;
        if(remaining<dist){ s.yFloat+=remaining; remaining=0; }
        else { s.yFloat=yi+1; remaining-=dist; }
      }
      if(blockedAt<0) continue;
      const yi=blockedAt;
      if(yi<WORLD_H-1){ // grain rolls down slopes (also under water)
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
      if(playerBlocks(s.x,yi)){ s.vy=0; s.yFloat=yi; continue; }
      settleSand(s.x,yi);
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
  function drawCracks(ctx,x,y,TILE,ratio,alpha,offset){
    const a=Math.max(0,Math.min(1,alpha));
    const w=Math.max(1.4,TILE*(0.045+0.045*ratio));
    const shift=(offset||0)*TILE;
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.lineWidth=w+1.8;
    ctx.strokeStyle='rgba(42,9,4,'+(0.34+0.32*a).toFixed(3)+')';
    ctx.beginPath();
    ctx.moveTo(x+TILE*0.18+shift,y+TILE*0.28);
    ctx.lineTo(x+TILE*0.43,y+TILE*0.45);
    ctx.lineTo(x+TILE*0.31,y+TILE*0.72);
    ctx.moveTo(x+TILE*0.56-shift,y+TILE*0.16);
    ctx.lineTo(x+TILE*0.72,y+TILE*0.40);
    ctx.lineTo(x+TILE*0.63,y+TILE*0.70);
    ctx.moveTo(x+TILE*0.24,y+TILE*0.78);
    ctx.lineTo(x+TILE*0.46,y+TILE*0.62);
    ctx.lineTo(x+TILE*0.58,y+TILE*0.80);
    ctx.stroke();
    ctx.lineWidth=w;
    ctx.strokeStyle='rgba(255,230,96,'+(0.48+0.46*a).toFixed(3)+')';
    ctx.beginPath();
    ctx.moveTo(x+TILE*0.18+shift,y+TILE*0.28);
    ctx.lineTo(x+TILE*0.43,y+TILE*0.45);
    ctx.lineTo(x+TILE*0.31,y+TILE*0.72);
    ctx.moveTo(x+TILE*0.56-shift,y+TILE*0.16);
    ctx.lineTo(x+TILE*0.72,y+TILE*0.40);
    ctx.lineTo(x+TILE*0.63,y+TILE*0.70);
    ctx.moveTo(x+TILE*0.24,y+TILE*0.78);
    ctx.lineTo(x+TILE*0.46,y+TILE*0.62);
    ctx.lineTo(x+TILE*0.58,y+TILE*0.80);
    ctx.stroke();
  }
  function drawBuildStress(ctx,TILE,tileVisible){
    if(!buildStress.size || !getTile) return;
    const now=(typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const pulse=0.72+0.28*Math.sin(now*0.012);
    ctx.save();
    for(const [raw,ratio] of buildStress){
      const c=parseCellKey(raw);
      if(!c){ buildStress.delete(raw); continue; }
      if(!isTrackedPlayerBuild(c.x,c.y)){ buildStress.delete(raw); continue; }
      if(!tileVisible(c.x,c.y)) continue;
      const x=c.x*TILE, y=c.y*TILE;
      const danger=Math.max(0,Math.min(1,(ratio-BUILD_STRESS_WARN)/(1-BUILD_STRESS_WARN)));
      const a=Math.max(0,Math.min(1,0.42+danger*0.58))*pulse;
      ctx.fillStyle='rgba(255,54,32,'+(0.10+0.30*a).toFixed(3)+')';
      ctx.fillRect(x,y,TILE,TILE);
      ctx.strokeStyle='rgba(255,190,54,'+(0.36+0.44*a).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,TILE*(0.035+0.035*danger));
      ctx.strokeRect(x+1,y+1,Math.max(1,TILE-2),Math.max(1,TILE-2));
      drawCracks(ctx,x,y,TILE,ratio,a,Math.sin(now*0.018+c.x*0.7+c.y*0.2)*0.025*danger);
      if(ratio>=BUILD_STRESS_DANGER){
        ctx.fillStyle='rgba(255,238,120,'+(0.28+0.34*a).toFixed(3)+')';
        ctx.beginPath();
        ctx.moveTo(x+TILE*0.50,y+TILE*0.12);
        ctx.lineTo(x+TILE*0.60,y+TILE*0.34);
        ctx.lineTo(x+TILE*0.42,y+TILE*0.34);
        ctx.closePath();
        ctx.fill();
      }
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
      drawCracks(ctx,x,y,TILE,b.ratio,a,Math.sin((b.seed+age)*0.03)*0.035);
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
      if(b.stress>0) drawCracks(ctx,x,y,TILE,b.stress,Math.max(0.35,b.stress),0);
    }
    if(sandActive.length){ ctx.fillStyle=INFO[T.SAND].color; for(const s of sandActive){ if(!tileVisible(s.x,s.yFloat)) continue; ctx.fillRect(s.x*TILE,s.yFloat*TILE,TILE,TILE); } }
    drawBuildBreaks(ctx,TILE,tileVisible);
  }

  // --- Public event API (names kept stable for main.js / undo) ---
  function onTileRemoved(x,y){ forgetManualCityBuild(x,y); forgetPlayerBuild(x,y); forgetSettledRubble(x,y); queueAroundRemoval(x,y); checkBuiltPillarAround(x,y); }
  function recheckNeighborhood(x,y){ forgetSettledRubble(x,y); syncManualCityBuild(x,y); syncPlayerBuild(x,y); queueCheck(x,y); queueAroundRemoval(x,y); checkBuiltPillarAround(x,y); } // undo can both add and remove tiles
  function afterPlacement(x,y){ forgetSettledRubble(x,y); rememberManualCityBuild(x,y); rememberPlayerBuild(x,y); queueAroundSettle(x,y); checkBuiltPillarAround(x,y); }
  function maybeStart(x,y){ queueCheck(x,y); }

  function reset(){ active.length=0; sandActive.length=0; unstable.clear(); quietStable.clear(); auditJobs.length=0; auditPending.clear(); auditLast.clear(); manualCityBuilt.clear(); playerBuilt.clear(); buildStress.clear(); buildBreaks.length=0; settledRubble.clear(); }
  function metrics(){ return {queue:unstable.size, audit:auditJobs.length, active:active.length, sand:sandActive.length, debris:settledRubble.size, built:playerBuilt.size, stress:buildStress.size, breaks:buildBreaks.length}; }
  function parseSavedKey(k){
    if(typeof k!=='string' || k.length>=32) return null;
    const ix=k.indexOf(',');
    if(ix<=0 || ix!==k.lastIndexOf(',')) return null;
    const x=+k.slice(0,ix), y=+k.slice(ix+1);
    if(!finiteX(x) || !Number.isFinite(y) || y<0 || y>=WORLD_H) return null;
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
    return {
      v:5,
      active:active.map(b=>restoredRigid({x:b.x,y:b.yFloat,type:b.type,vy:b.vy,windCarry:b.windCarry||0,rubble:!!b.rubble})).filter(Boolean).map(b=>({x:b.x,y:b.yFloat,type:b.type,vy:b.vy,windCarry:b.windCarry||0,rubble:!!b.rubble})),
      sand:sandActive.map(s=>restoredSand({x:s.x,y:s.yFloat,vy:s.vy,windCarry:s.windCarry||0})).filter(Boolean).map(s=>({x:s.x,y:s.yFloat,vy:s.vy,windCarry:s.windCarry||0})),
      queue:[...unstable].map(parseSavedKey).filter(Boolean).slice(0,6000),
      built,
      playerBuilt:playerBuiltOut,
      debris
    };
  }catch(e){ return null; } }
  function restore(s){ reset(); if(!s||typeof s!=='object') return; try{
    if(Array.isArray(s.active)) for(const b of s.active){ const r=restoredRigid(b); if(r && active.length<ACTIVE_RIGID_CAP) active.push(r); }
    if(Array.isArray(s.sand)) for(const g of s.sand){ const r=restoredSand(g); if(r && sandActive.length<3000) sandActive.push(r); }
    if(Array.isArray(s.queue)) for(const k of s.queue){ const kk=parseSavedKey(k); if(kk && unstable.size<6000) unstable.add(kk); }
    if(Array.isArray(s.built)) for(const k of s.built){ const kk=parseSavedKey(k); if(kk && manualCityBuilt.size<20000) manualCityBuilt.add(kk); }
    if(Array.isArray(s.playerBuilt)) for(const k of s.playerBuilt){ const kk=parseSavedKey(k); if(kk && playerBuilt.size<PLAYER_BUILT_SAVE_CAP) playerBuilt.add(kk); }
    if(Array.isArray(s.debris)) for(const k of s.debris){ const kk=parseSavedKey(k); if(kk && settledRubble.size<22000) settledRubble.add(kk); }
    for(const k of playerBuilt){ if(unstable.size>=6000) break; unstable.add(k); }
  }catch(e){} }

  function _debug(){
    return {
      stress:[...buildStress].map(([raw,ratio])=>Object.assign({ratio},parseCellKey(raw)||{})).filter(c=>Number.isFinite(c.x)),
      breaks:buildBreaks.map(b=>({x:b.x,y:b.y,ratio:b.ratio,age:((typeof performance !== 'undefined' && performance.now)?performance.now():Date.now())-b.born})),
      thresholds:{warn:BUILD_STRESS_WARN,danger:BUILD_STRESS_DANGER,fail:BUILD_STRESS_FAIL}
    };
  }

  MM.fallingSolids={init,update,draw,onTileRemoved,maybeStart,reset,recheckNeighborhood,afterPlacement,canSupportPlacement,auditChunks,settleAll,snapshot,restore,metrics,_debug};
})();
// ESM export (progressive migration)
export const fallingSolids = (typeof window!=='undefined' && window.MM) ? window.MM.fallingSolids : undefined;
export default fallingSolids;
