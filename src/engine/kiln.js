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
  };

  const kilns = new Map();   // "x,y" -> {x,y,progress,chamber:[],rescan,lit}
  let stats = { fired: 0, lit: 0 };

  const key = (x, y) => x + ',' + y;
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
        const taken = got && Number.isFinite(Number(got.taken)) ? Number(got.taken) : (Number(got) || 0);
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
        try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((cell.x + 0.5) * 20, (cell.y + 0.5) * 20, 'common'); }catch(e){}
        return true;
      }
    }
    return false;
  }

  function update(dt, player, getTile, setTile){
    if(!(dt > 0) || typeof getTile !== 'function' || typeof setTile !== 'function') return;
    if(!kilns.size) return;
    for(const [k2, k] of kilns){
      if(getSafe(getTile, k.x, k.y) !== T.KILN){ kilns.delete(k2); continue; }
      k.rescan -= dt;
      if(k.rescan <= 0){
        k.rescan = CFG.RESCAN_SEC;
        k.chamber = chamberAt(k.x, k.y, getTile) || [];
      }
      if(!k.chamber.length){ k.lit = false; continue; }
      const rate = heatRate(k, dt, getTile);
      const wasLit = k.lit;
      k.lit = rate > 0;
      if(k.lit && !wasLit) stats.lit++;
      if(!k.lit) continue;
      k.progress += rate * dt;
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
        if(Number.isFinite(x) && Number.isFinite(y)) noteKiln(x, y);
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
