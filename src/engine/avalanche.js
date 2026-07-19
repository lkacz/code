// Avalanches: a deep snowpack (3+ stacked SNOW tiles) resting on a slope lets
// go when something DISTURBS it — a body running or thumping down above it, a
// mined-out tile (main.js pokes disturb() from the break chokepoint), an
// explosion, or the debug button. The slab releases as a WAVE marching
// downhill: column after column the pack (all but the rooted base tile) tears
// out and hands its mass to the ordinary falling-solids sim, nudged one column
// downslope so the snow visibly travels. Bodies caught underneath are buried
// through the existing crush/burial system (snow buries — weight 0.15 — it
// does not crush), and the new hover-pile resolver mounds the debris around
// them instead of stacking one flickering cell.
//
// Multiplayer contract: host-only sim (main.js world step). Tile removals and
// the re-settled snow replicate over the tiles plane; the drift spray rides
// the 'drift' plane; the in-flight entities are host visuals only (guests see
// the pack vanish and the mound arrive — the readable part of the story).
// Disturbance listens to the host hero AND every MM.coopBodies entry, so a
// guest sprinting across a cornice sets it off exactly like the host.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSkyOpenTile } from './material_physics.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const CFG = {
    MIN_DEPTH: 3,        // owner spec: 3+ stacked snow tiles make a slab
    KEEP_BASE: 1,        // the rooted bottom tile stays — slopes are not stripped bare
    SLOPE_DROP: 2,       // neighbour surface must sit at least this much lower
    SLOPE_PROBE: 3,      // columns ahead used to measure the drop
    RUN_MAX: 22,         // longest release run (columns) per avalanche
    WAVE_STEP_MS: 75,    // per-column delay — the tear visibly marches downhill
    COL_COOLDOWN_S: 30,  // a released column cannot re-trigger for this long
    DISTURB_SPEED: 2.6,  // horizontal body speed that counts as a disturbance
    DISTURB_LAND_VY: 4,  // fall speed whose thump counts as a disturbance
    SWEEP_MS: 130,       // body-disturbance probe throttle
    DEPTH_SCAN: 8,       // deepest pack considered (scan budget)
    SURFACE_SCAN: 70,    // rows scanned under the worldgen anchor for a surface
    NUDGE: 1,            // released tiles re-enter the fall one column downslope
  };

  const releases = [];        // scheduled column tears: {x, dir, at}
  const colCooldown = new Map(); // x -> epoch ms until which the column is spent
  let sweepAtMs = 0;
  let triggered = 0, tilesReleased = 0, noted = false;

  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function isSnow(t){ return t===T.SNOW || t===T.TOXIC_SNOW; }
  function surfaceAnchor(x){
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(x)); if(Number.isFinite(s)) return s; }
    }catch(e){}
    return 30;
  }
  // First blocking tile of the column (same "open sky" reading the drifts use).
  function surfaceTop(x,getTile){
    const from=Math.max(WORLD_TOP+1, Math.floor(surfaceAnchor(x))-40);
    const until=Math.min(WORLD_BOTTOM, from+CFG.SURFACE_SCAN);
    for(let y=from;y<until;y++){
      if(!isSkyOpenTile(getTile(x,y))) return y;
    }
    return -1;
  }
  function snowDepthAt(x,getTile){
    const top=surfaceTop(x,getTile);
    if(top<0 || !isSnow(getTile(x,top))) return {top:-1,depth:0};
    let d=0;
    while(d<CFG.DEPTH_SCAN && isSnow(getTile(x,top+d))) d++;
    return {top,depth:d};
  }
  // Downhill = the side whose surface sits lower; null when the ground is flat.
  function slopeDirAt(x,getTile){
    const here=surfaceTop(x,getTile);
    if(here<0) return null;
    for(const dir of [1,-1]){
      const there=surfaceTop(x+dir*CFG.SLOPE_PROBE,getTile);
      if(there>=0 && there-here>=CFG.SLOPE_DROP) return dir;
    }
    return null;
  }
  function colSpent(x){
    const until=colCooldown.get(x)||0;
    return until>nowMs();
  }
  function markSpent(x){
    if(colCooldown.size>400) colCooldown.clear();
    colCooldown.set(x,nowMs()+CFG.COL_COOLDOWN_S*1000);
  }

  // A disturbance at (x,y): if a deep slab on a slope sits at/near the column,
  // schedule the downhill release wave. Returns the run length (0 = no slide).
  function disturb(x,y,power,getTile){
    getTile=getTile || (MM.world && MM.world.getTile);
    if(typeof getTile!=='function') return 0;
    x=Math.floor(Number(x));
    if(!Number.isFinite(x)) return 0;
    for(const probe of [x,x-1,x+1,x-2,x+2]){
      if(colSpent(probe)) continue;
      const {top,depth}=snowDepthAt(probe,getTile);
      if(depth<CFG.MIN_DEPTH) continue;
      // the thump must actually reach the pack: same column area, above or into it
      if(Number.isFinite(y) && Math.abs(Math.floor(y)-top)>10) continue;
      const dir=slopeDirAt(probe,getTile);
      if(!dir) continue;
      return startSlide(probe,dir,getTile,Math.max(1,Number(power)||1));
    }
    return 0;
  }
  function startSlide(x0,dir,getTile,power){
    const t0=nowMs();
    const runCap=Math.min(CFG.RUN_MAX, 8+Math.round(power*6));
    let run=0;
    for(let i=0;i<runCap;i++){
      const x=x0+dir*i;
      if(colSpent(x)) break;
      const {depth}=snowDepthAt(x,getTile);
      if(depth<(i===0?CFG.MIN_DEPTH:2)) break; // the tear follows the deep pack
      releases.push({x, dir, at:t0+i*CFG.WAVE_STEP_MS});
      markSpent(x);
      run++;
    }
    if(run>0){
      triggered++;
      try{ if(MM.audio && MM.audio.play) MM.audio.play('thud',{x:x0+0.5,y:surfaceTop(x0,getTile)}); }catch(e){}
      try{ if(typeof window!=='undefined' && typeof window.msg==='function' && run>=4) window.msg('Lawina! Zbocze rusza…'); }catch(e){}
      if(!noted){
        noted=true;
        try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('avalanche','Głęboki śnieg na zboczu schodzi lawiną po wstrząsie!'); }catch(e){}
      }
    }
    return run;
  }
  function releaseColumn(r,getTile,setTile){
    const {top,depth}=snowDepthAt(r.x,getTile);
    if(depth<=CFG.KEEP_BASE) return 0;
    const F=MM.fallingSolids;
    let released=0;
    for(let i=0;i<depth-CFG.KEEP_BASE;i++){
      const y=top+i;
      const t=getTile(r.x,y);
      if(!isSnow(t)) break;
      setTile(r.x,y,T.AIR);
      if(getTile(r.x,y)!==T.AIR) break;
      try{ if(F && F.onTileRemoved) F.onTileRemoved(r.x,y); }catch(e){}
      // the mass re-enters the fall one column downslope — the slide travels
      const nx=(getTile(r.x+r.dir*CFG.NUDGE,y)===T.AIR) ? r.x+r.dir*CFG.NUDGE : r.x;
      try{ if(F && F.spawnLoose) F.spawnLoose(nx,y,t); }catch(e){}
      released++;
    }
    if(released>0){
      tilesReleased+=released;
      const tile=(MM&&MM.TILE)||20;
      try{
        const P=MM.particles;
        if(P && P.spawnFlakes) P.spawnFlakes((r.x+0.5)*tile,(top+0.4)*tile,{mat:'snow',count:4+released*2,dir:r.dir,loose:true});
      }catch(e){}
    }
    return released;
  }
  // Bodies disturb the pack: a sprint across it or a heavy landing ON it.
  function sweepBody(b,getTile){
    if(!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return;
    const vyNow=Number(b.vy)||0;
    const vyPrev=Number(b._avVyPrev)||0;
    b._avVyPrev=vyNow;
    const running=Math.abs(Number(b.vx)||0)>=CFG.DISTURB_SPEED;
    const landed=vyPrev>CFG.DISTURB_LAND_VY && vyNow<0.6;
    if(!running && !landed) return;
    disturb(b.x,b.y+1,landed?1.4:1,getTile);
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || typeof getTile!=='function' || typeof setTile!=='function') return;
    const t=nowMs();
    if(t-sweepAtMs>=CFG.SWEEP_MS){
      sweepAtMs=t;
      sweepBody(player,getTile);
      const bodies=(typeof MM!=='undefined' && MM.coopBodies)||null;
      if(bodies && bodies.length){ for(const b of bodies){ if(b && !b.dead) sweepBody(b,getTile); } }
    }
    if(!releases.length) return;
    for(let i=releases.length-1;i>=0;i--){
      const r=releases[i];
      if(r.at>t) continue;
      releases.splice(i,1);
      releaseColumn(r,getTile,setTile);
    }
  }

  function reset(){
    releases.length=0;
    colCooldown.clear();
    sweepAtMs=0;
    triggered=0; tilesReleased=0; noted=false;
  }
  function metrics(){
    return {pending:releases.length, cooldowns:colCooldown.size, triggered, tilesReleased};
  }

  MM.avalanche={update, disturb, reset, metrics, config:CFG,
    _debug:{releases, colCooldown, snowDepthAt, slopeDirAt, surfaceTop, startSlide, releaseColumn, sweepBody}};
})();

export const avalanche = (typeof window!=='undefined' && window.MM) ? window.MM.avalanche : globalThis.MM && globalThis.MM.avalanche;
export default avalanche;
