// Żywy las — seed dispersal, saplings and succession.
//
// Before this, a cut forest was gone for the save: trees.buildTree had ZERO
// callers outside worldgen, so every clearcut and every burn scar fire.js made
// was permanent. The world was a one-way extraction surface.
//
// The loop: mature canopies shed seeds (autumn hardest), wind carries them, a
// seed on lit moist soil becomes a sapling, and a sapling matures over in-game
// days into a REAL species-correct tree — grown by handing trees.buildTree a
// live-world adapter, so a regrown oak is geometrically identical to a
// worldgen one rather than a bespoke lookalike. Canopy shade stalls competitors
// so an old forest stays stable instead of turning into a thicket.
//
// Host-authoritative and body-agnostic: growth is decided from the WORLD, never
// from window.player (plants.js:164 reads window.player for its seeding window —
// deliberately NOT copied here, per CLAUDE.md rule 3). Regrown tiles land through
// setTile, which the `tiles` stream plane already mirrors to every guest.
import { T, CHUNK_W, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, isAutumnLeaf } from '../constants.js';

(function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  const CFG = {
    MAX_SAPLINGS: 220,     // hard bound on tracked saplings
    SEED_SCAN_SEC: 9,      // seconds between dispersal scans
    SEED_RADIUS: 26,       // tiles either side of the scan anchor
    SPROUT_DAYS: 0.55,     // game days seed -> visible sapling
    MATURE_DAYS: 2.6,      // game days sapling -> full tree
    SHADE_RADIUS: 3,       // an established canopy suppresses this many tiles
    WIND_CARRY: 7,         // max tiles a seed is blown from its parent
    SEEDS_PER_SCAN: 3,     // dispersal attempts per scan (bounded work)
    MIN_GAP: 4,            // trees will not sprout closer together than this
  };
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const saplings = new Map();   // "x,y" -> {x,y,age,variant,sprouted}
  let scanAcc = 0;
  let lastDay = null;
  let stats = { sown: 0, sprouted: 0, matured: 0 };

  const key = (x, y) => x + ',' + y;
  function getSafe(getTile, x, y){
    try{ const t = getTile(x, y); return t === undefined ? T.STONE : t; }catch(e){ return T.STONE; }
  }
  function isSoil(t){ return t === T.GRASS || t === T.DIRT || t === T.GRASS_SNOW; }
  function isTrunk(t){ return t === T.WOOD || t === T.GOLDEN_WOOD || t === T.LIGHT_WOOD || t === T.HARD_WOOD; }
  function isCanopy(t){ return t === T.LEAF || isAutumnLeaf(t); }
  function isClear(t){ return t === T.AIR; }

  function dayNow(){
    try{
      const s = MM.seasons;
      if(s && s.metrics){ const m = s.metrics(); if(m && Number.isFinite(m.dayFloat)) return m.dayFloat; }
    }catch(e){}
    return null;
  }
  function seasonSeedBoost(){
    try{
      const p = MM.seasons && MM.seasons.profile ? MM.seasons.profile() : null;
      if(!p) return 1;
      // autumn drops the most seed; nothing germinates under deep winter
      const drop = Number(p.leafDropStrength);
      const grow = Number(p.leafGrowStrength);
      if(Number.isFinite(grow) && grow <= 0) return 0.15;
      return 1 + (Number.isFinite(drop) ? drop : 0) * 1.4;
    }catch(e){ return 1; }
  }
  function windShift(){
    try{
      const w = MM.wind;
      if(w && w.speed){
        const s = Number(w.speed()) || 0;
        return Math.max(-CFG.WIND_CARRY, Math.min(CFG.WIND_CARRY, Math.round(s * 0.9)));
      }
    }catch(e){}
    return 0;
  }

  // Ground level under a column, or null when there is no open soil surface.
  function soilTopAt(x, getTile, fromY){
    const y0 = Math.max(WORLD_TOP + 1, Math.floor(fromY) - 24);
    const y1 = Math.min(WORLD_BOTTOM - 2, Math.floor(fromY) + 24);
    for(let y = y0; y <= y1; y++){
      if(isSoil(getSafe(getTile, x, y)) && isClear(getSafe(getTile, x, y - 1))) return y;
    }
    return null;
  }
  // Shade + spacing: an existing canopy or a neighbouring trunk blocks a sprout,
  // which is what keeps a mature forest stable rather than a thicket.
  function suppressed(x, y, getTile){
    for(let dx = -CFG.MIN_GAP; dx <= CFG.MIN_GAP; dx++){
      for(let dy = -2; dy <= 2; dy++){
        if(isTrunk(getSafe(getTile, x + dx, y + dy))) return true;
      }
    }
    for(let dy = 1; dy <= CFG.SHADE_RADIUS; dy++){
      if(isCanopy(getSafe(getTile, x, y - dy))) return true;
    }
    return false;
  }
  function headroom(x, y, getTile){
    for(let dy = 1; dy <= 5; dy++) if(!isClear(getSafe(getTile, x, y - dy))) return false;
    return true;
  }

  // Which species belongs here? Read it off the surviving neighbours so a
  // regrown patch matches the forest it came from.
  function variantNear(x, y, getTile){
    for(let dx = -CFG.SEED_RADIUS; dx <= CFG.SEED_RADIUS; dx++){
      for(let dy = -6; dy <= 2; dy++){
        const t = getSafe(getTile, x + dx, y + dy);
        if(t === T.LIGHT_WOOD) return 'lightwood';
        if(t === T.HARD_WOOD) return 'hardwood';
      }
    }
    return null;
  }

  // Sow one seed downwind of a surviving parent tree.
  function sowNear(x, y, getTile){
    if(saplings.size >= CFG.MAX_SAPLINGS) return false;
    // The seed must clear the parent's OWN MIN_GAP suppression box (suppressed()
    // scans +-MIN_GAP and finds the parent trunk) or it is rejected by
    // construction. Natural wind is |speed| <= ~1.6 in fair weather, so the old
    // windShift+jitter could never exceed 3 tiles < MIN_GAP 4 — the two rules
    // were mutually exclusive and nothing ever sowed. Wind now biases DIRECTION
    // and DISTANCE, not whether the seed clears at all.
    const drift = windShift();
    const dir = drift !== 0 ? (drift > 0 ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1);
    const span = Math.max(1, CFG.WIND_CARRY - CFG.MIN_GAP);
    const throwDist = Math.min(CFG.WIND_CARRY,
      CFG.MIN_GAP + 1 + Math.floor(Math.random() * span) + Math.abs(drift));
    const tx = Math.floor(x) + dir * throwDist;
    const top = soilTopAt(tx, getTile, y);
    if(top == null) return false;
    const sy = top - 1;
    if(!isClear(getSafe(getTile, tx, sy))) return false;
    if(!headroom(tx, sy, getTile)) return false;
    if(suppressed(tx, sy, getTile)) return false;
    const k = key(tx, sy);
    if(saplings.has(k)) return false;
    saplings.set(k, { x: tx, y: sy, age: 0, variant: variantNear(tx, sy, getTile), sprouted: false });
    stats.sown++;
    return true;
  }

  // Find surviving parents near the anchor and let them disperse.
  function disperse(anchorX, anchorY, getTile){
    const boost = seasonSeedBoost();
    if(boost <= 0.2) return 0;
    let sown = 0;
    for(let i = 0; i < CFG.SEEDS_PER_SCAN; i++){
      const px = Math.floor(anchorX) + Math.floor((Math.random() * 2 - 1) * CFG.SEED_RADIUS);
      // A parent stands ON the soil, so its base occupies the very cell
      // soilTopAt() requires to be AIR — using that predicate here meant a real
      // tree could NEVER be found and nothing ever sowed. Locate the trunk base
      // directly instead. Two stacked trunk cells = a real stem (every buildTree
      // variant is >=3 tall), so a lone player-placed plank is not a seed source.
      let top = null;
      const py0 = Math.max(WORLD_TOP + 1, Math.floor(anchorY) - 24);
      const py1 = Math.min(WORLD_BOTTOM - 2, Math.floor(anchorY) + 24);
      for(let y = py0; y <= py1; y++){
        if(isTrunk(getSafe(getTile, px, y)) && isTrunk(getSafe(getTile, px, y - 1))
          && isSoil(getSafe(getTile, px, y + 1))){ top = y + 1; break; }
      }
      if(top == null) continue;
      if(Math.random() > Math.min(0.95, 0.35 * boost)) continue;
      if(sowNear(px, top - 1, getTile)) sown++;
    }
    return sown;
  }

  // --- maturation --------------------------------------------------------------
  // A live-world view shaped like a worldgen chunk array, so trees.buildTree can
  // grow a REAL species-correct tree straight into the running world instead of
  // us re-implementing (and drifting from) its geometry.
  function liveChunkView(getTile, setTile, originX, lx){
    return new Proxy({}, {
      get(_t, prop){
        const idx = Number(prop);
        if(!Number.isInteger(idx)) return undefined;
        const y = Math.floor(idx / CHUNK_W), localX = idx - y * CHUNK_W;
        return getSafe(getTile, originX + (localX - lx), y);
      },
      set(_t, prop, value){
        const idx = Number(prop);
        if(!Number.isInteger(idx)) return true;
        const y = Math.floor(idx / CHUNK_W), localX = idx - y * CHUNK_W;
        try{ setTile(originX + (localX - lx), y, value); }catch(e){ /* fine */ }
        return true;
      },
    });
  }
  function mature(s, getTile, setTile){
    const TR = MM.trees;
    if(!TR || !TR.buildTree) return false;
    const lx = Math.floor(CHUNK_W / 2);
    const view = liveChunkView(getTile, setTile, s.x, lx);
    const variant = s.variant || 'oak';
    try{
      if(TR.canGrowTreeAt && !TR.canGrowTreeAt(view, lx, s.y + 1, variant)) return false;
    }catch(e){ /* the check is advisory here — the world is not a real chunk */ }
    try{
      TR.buildTree(view, lx, s.y + 1, variant, s.x, false);
    }catch(e){ return false; }
    stats.matured++;
    return true;
  }

  function update(dt, player, getTile, setTile){
    if(!(dt > 0) || typeof getTile !== 'function' || typeof setTile !== 'function') return;
    const day = dayNow();
    const dDays = (day != null && lastDay != null && day > lastDay) ? (day - lastDay) : 0;
    if(day != null) lastDay = day;

    // dispersal is anchored on the ACTIVE area, but the decision is made from the
    // world (surviving parents), never from who is standing there
    scanAcc += dt;
    if(scanAcc >= CFG.SEED_SCAN_SEC){
      scanAcc = 0;
      const ax = player && Number.isFinite(player.x) ? player.x : 0;
      const ay = player && Number.isFinite(player.y) ? player.y : 60;
      disperse(ax, ay, getTile);
    }
    if(!saplings.size || dDays <= 0) return;

    for(const [k, s] of saplings){
      s.age += dDays;
      // something built/flooded over it, or it got mined: forget it
      const here = getSafe(getTile, s.x, s.y);
      if(!isClear(here) && here !== T.SAPLING){ saplings.delete(k); continue; }
      if(!isSoil(getSafe(getTile, s.x, s.y + 1))){ saplings.delete(k); continue; }
      if(!s.sprouted && s.age >= CFG.SPROUT_DAYS){
        s.sprouted = true;
        stats.sprouted++;
        try{ setTile(s.x, s.y, T.SAPLING); }catch(e){}
        continue;
      }
      if(s.sprouted && s.age >= CFG.MATURE_DAYS){
        saplings.delete(k);
        try{ if(getSafe(getTile, s.x, s.y) === T.SAPLING) setTile(s.x, s.y, T.AIR); }catch(e){}
        mature(s, getTile, setTile);
      }
    }
  }

  function reset(){ saplings.clear(); scanAcc = 0; lastDay = null; stats = { sown: 0, sprouted: 0, matured: 0 }; }
  function snapshot(){
    return { v: 1, list: [...saplings.values()].slice(0, CFG.MAX_SAPLINGS).map(s => ({
      x: s.x | 0, y: s.y | 0, age: +Number(s.age || 0).toFixed(3), variant: s.variant || null, sprouted: !!s.sprouted })) };
  }
  function restore(data){
    saplings.clear();
    if(data && Array.isArray(data.list)){
      for(const raw of data.list.slice(0, CFG.MAX_SAPLINGS)){
        if(!raw) continue;
        const x = Number(raw.x), y = Number(raw.y), age = Number(raw.age);
        if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if(Math.abs(x) > 30000000) continue; // same |x| envelope every restorer uses
        if(y <= WORLD_TOP || y >= WORLD_BOTTOM) continue;
        const variant = typeof raw.variant === 'string' && raw.variant.length <= 16 ? raw.variant : null;
        saplings.set(key(x | 0, y | 0), {
          x: x | 0, y: y | 0,
          age: Number.isFinite(age) ? Math.max(0, Math.min(99, age)) : 0,
          variant, sprouted: !!raw.sprouted });
      }
    }
    return true;
  }
  function metrics(){ return { saplings: saplings.size, sown: stats.sown, sprouted: stats.sprouted, matured: stats.matured }; }

  MM.forest = {
    update, reset, snapshot, restore, metrics,
    plantSeed: (x, y, getTile) => sowNear(x, y, getTile),
    CFG,
    _debug: { saplings: () => saplings, soilTopAt, suppressed, variantNear, disperse, mature, seasonSeedBoost, liveChunkView },
  };
})();

export const forest = (typeof window !== 'undefined' && window.MM) ? window.MM.forest : globalThis.MM && globalThis.MM.forest;
export default forest;
