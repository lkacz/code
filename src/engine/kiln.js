// Wypał ciągły — the kiln.
//
// Three gaps met in one place: power DEMAND was thin (four generation modules
// feeding a handful of consumers), crafting was instant, free and station-less
// (main.js doCraft), and hand-smelting a heat recipe one tile at a time did not
// scale. reactions.js already knew how to turn clay into brick and silver ore
// into an ingot — it just had no way to do it in bulk while you walked away.
//
// Build a sealed brick chamber, load raw blocks inside, feed the kiln sustained
// heat (adjacent lava/fire) or grid energy, and it applies the game's EXISTING
// heat recipes to everything eligible inside at a metered rate.
//
// All authoritative state lives in TILES (the chamber shape, the loaded blocks,
// the fuel), so the `tiles` plane already carries the whole truth to guests. The
// fractional progress accumulator is runtime-only, exactly like reactions' own
// chargeMap — nothing here needs a stream plane or an hact intent.
import { T } from '../constants.js';

(function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  const CFG = {
    MAX_CHAMBER: 64,      // capped flood-fill: a pathological base cannot eat a frame
    FIRE_PER_SEC: 1.0,    // progress/sec from a live flame or lava face
    ENERGY_PER_SEC: 1.6,  // energy drawn/sec when running on the grid instead
    ENERGY_RATE: 0.85,    // progress/sec when electrically heated
    COST_PER_FIRE: 1.0,   // progress needed to transmute one tile
    RESCAN_SEC: 1.4,      // chamber revalidation cadence
    MAX_KILNS: 48,        // tracked kilns (hard bound)
    WAKE_MAX_SEC: 600,    // wake catch-up window (chamber-bounded output anyway)
  };

  const kilns = new Map();   // "x,y" -> {x,y,progress,chamber:[],rescan,lit}
  let stats = { fired: 0, lit: 0 };

  const key = (x, y) => x + ',' + y;
  function observeTransition(change, x, y, extra){
    try{
      const d = MM.discovery;
      if(d && typeof d.observe === 'function'){
        d.observe('tile_transition', Object.assign({
          change,
          target:{ x:x + 0.5, y:y + 0.5 }
        }, extra || {}));
      }
    }catch(e){}
  }
  function getSafe(getTile, x, y){
    try{ const t = getTile(x, y); return t === undefined ? T.STONE : t; }catch(e){ return T.STONE; }
  }
  function isWall(t){ return t === T.BRICK || t === T.KILN || t === T.STONE || t === T.GRANITE || t === T.BASALT || t === T.OBSIDIAN; }
  function isLoadable(t){ return t !== T.AIR && t !== T.WATER && t !== T.LAVA; }

  function noteKiln(x, y){
    if(kilns.size >= CFG.MAX_KILNS) return;
    const k = key(x | 0, y | 0);
    if(!kilns.has(k)) kilns.set(k, { x: x | 0, y: y | 0, progress: 0, chamber: [], rescan: 0, lit: false });
  }
  function clearKiln(x, y){ kilns.delete(key(x | 0, y | 0)); }

  // The sealed volume above/around the kiln mouth. Capped flood-fill over
  // non-wall cells; escaping the cap means the chamber is not sealed.
  function chamberAt(x, y, getTile){
    const seen = new Set();
    const out = [];
    const stack = [[x, y - 1]];
    while(stack.length){
      const [cx, cy] = stack.pop();
      const k = key(cx, cy);
      if(seen.has(k)) continue;
      seen.add(k);
      if(seen.size > CFG.MAX_CHAMBER) return null;   // leaked: not a sealed kiln
      const t = getSafe(getTile, cx, cy);
      if(isWall(t)) continue;                        // the shell
      out.push({ x: cx, y: cy, t });
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return out;
  }

  // Sustained heat: a flame or lava on the kiln's own faces, else the grid.
  function heatRate(k, dt, getTile){
    for(const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]){
      const t = getSafe(getTile, k.x + dx, k.y + dy);
      if(t === T.LAVA || t === T.MOTHER_LAVA) return CFG.FIRE_PER_SEC;
      try{ if(MM.fire && MM.fire.isBurning && MM.fire.isBurning(k.x + dx, k.y + dy)) return CFG.FIRE_PER_SEC; }catch(e){}
    }
    try{
      if(MM.dynamo && MM.dynamo.absorbNear){
        const got = MM.dynamo.absorbNear(k.x + 0.5, k.y + 0.5, CFG.ENERGY_PER_SEC * dt, getTile, 4);
        // dynamo.absorbNear returns {amount,...} — there is no `taken` key, so the
        // old read was always 0: electric heating was dead while still draining.
        const taken = got && Number.isFinite(Number(got.amount)) ? Number(got.amount) : 0;
        if(taken > 0) return CFG.ENERGY_RATE * (taken / Math.max(1e-6, CFG.ENERGY_PER_SEC * dt));
      }
    }catch(e){ /* no grid */ }
    return 0;
  }

  // Transmute ONE eligible tile inside the chamber through the shared recipe
  // table — the kiln invents no chemistry of its own.
  function fireOnce(k, getTile, setTile){
    const R = MM.reactions;
    if(!R || !R.apply) return false;
    for(const cell of k.chamber){
      if(!isLoadable(cell.t)) continue;
      let res = null;
      try{ res = R.apply('heat', cell.x, cell.y, getTile, setTile, { source: 'kiln' }); }catch(e){ res = null; }
      if(res && !res.charging){
        stats.fired++;
        const changed = Array.isArray(res.changed) ? res.changed : [];
        for(const c of changed){
          if(c && c.oldTile === T.CLAY && c.newTile === T.BRICK && getSafe(getTile, c.x, c.y) === T.BRICK){
            observeTransition('clay_to_brick', c.x, c.y, {
              from:T.CLAY,
              to:T.BRICK,
              source:'kiln'
            });
            break;
          }
        }
        try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((cell.x + 0.5) * 20, (cell.y + 0.5) * 20, 'common'); }catch(e){}
        return true;
      }
    }
    return false;
  }

  function update(dt, player, getTile, setTile){
    if(!(dt > 0) || typeof getTile !== 'function' || typeof setTile !== 'function') return;
    if(!kilns.size) return;
    const SIM = MM.worldSim;
    for(const [k2, k] of kilns){
      // Far kilns are FROZEN (worldSim gate) — this loop used to run full-rate
      // for every kiln everywhere, chamber rescans included. On wake the whole
      // absence arrives as one step: the fire that burned unwatched has baked
      // its batches by the time anyone is back to open the chamber. The step
      // cap is generous because output is chamber-bounded anyway (fireOnce
      // returns false when nothing eligible remains and progress zeroes).
      const step = SIM ? SIM.wakeDt(dt, k.x, k.y, CFG.WAKE_MAX_SEC) : dt;
      if(step === null) continue;
      if(getSafe(getTile, k.x, k.y) !== T.KILN){ kilns.delete(k2); continue; }
      k.rescan -= step;
      if(k.rescan <= 0){
        k.rescan = CFG.RESCAN_SEC;
        k.chamber = chamberAt(k.x, k.y, getTile) || [];
      }
      if(!k.chamber.length){ k.lit = false; continue; }
      // heatRate probes the CURRENT heat source over the whole step: lava is
      // persistent so a woken lava-fired kiln credits its full absence; a flame
      // that died out while frozen credits nothing (the documented compromise —
      // fire is a frozen neighbor-coupled system with no closed form).
      const rate = heatRate(k, step, getTile);
      const wasLit = k.lit;
      k.lit = rate > 0;
      if(k.lit && !wasLit) stats.lit++;
      if(!k.lit) continue;
      k.progress += rate * step;
      while(k.progress >= CFG.COST_PER_FIRE){
        k.progress -= CFG.COST_PER_FIRE;
        if(!fireOnce(k, getTile, setTile)){ k.progress = 0; break; }  // nothing left to bake
      }
    }
  }

  function reset(){ kilns.clear(); stats = { fired: 0, lit: 0 }; }
  function snapshot(){ return { v: 1, list: [...kilns.values()].slice(0, CFG.MAX_KILNS).map(k => ({ x: k.x, y: k.y })) }; }
  function restore(data){
    kilns.clear();
    if(data && Array.isArray(data.list)){
      for(const raw of data.list.slice(0, CFG.MAX_KILNS)){
        if(!raw) continue;
        const x = Number(raw.x), y = Number(raw.y);
        if(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 30000000 && y > -1000 && y < 1000) noteKiln(x, y);
      }
    }
    return true;
  }
  function metrics(){
    let lit = 0;
    for(const k of kilns.values()) if(k.lit) lit++;
    return { kilns: kilns.size, lit, fired: stats.fired };
  }

  MM.kiln = { update, reset, snapshot, restore, metrics, noteKiln, clearKiln, CFG,
    _debug: { chamberAt, heatRate, fireOnce, isWall, kilns: () => kilns } };
})();

export const kiln = (typeof window !== 'undefined' && window.MM) ? window.MM.kiln : globalThis.MM && globalThis.MM.kiln;
export default kiln;
