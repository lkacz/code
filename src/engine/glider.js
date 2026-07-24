// Lotnia — the glider.
//
// wind.js:applyToHero already computed a per-body exposure sample every frame
// and only ever wrote `vx`: the weather could nudge you sideways but never
// carry you. Vertical travel was strictly ladders, springs and towers, which
// made the sky biomes (|x| >= 600) a construction problem rather than a
// journey.
//
// Hold JUMP while falling with a glider stowed and the canopy opens: your fall
// slows to a crawl, the wind that barely nudged you now carries you, and rising
// air over lava, fires and geothermal springs lifts you HIGHER than you started.
//
// Takes a body-like param throughout (never window.player), so a coop body
// glides exactly like the host — CLAUDE.md rule 3. Movement only: it writes no
// tile and needs no stream plane, since pose already streams.
import { T } from '../constants.js';

(function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  const CFG = {
    OPEN_VY: 0.9,        // must already be falling this fast before it catches
    GLIDE_VY: 2.6,       // terminal fall speed under canopy (gravity is ~21)
    WIND_PULL: 3.1,      // how hard the weather carries you, per second
    MAX_GLIDE_VX: 9.5,   // horizontal speed cap while gliding
    DRAG_RATE: 24,       // canopy easing toward its target, per second — MUST out-pace gravity (40)
    THERMAL_SCAN: 9,     // tiles below to look for rising air
    THERMAL_MAX_VY: -3.4,// the strongest a thermal can ever haul you up
    STALL_SPEED: 13,     // beyond this the canopy is torn out of your hands
  };

  let state = { open: false, t: 0, lift: 0 };

  function getSafe(getTile, x, y){
    try{ const t = getTile(x, y); return t === undefined ? T.STONE : t; }catch(e){ return T.STONE; }
  }
  // Anything that pushes hot air upward makes a thermal column.
  function isHeatSource(t){ return t === T.LAVA || t === T.MOTHER_LAVA || t === T.HOT_AIR || t === T.STEAM; }

  // Does the body have a canopy to open? A crafted tool flag rather than a gear
  // KIND: the gear system's house law is one function stat per item, and a
  // glider is a verb, not a stat.
  function hasGlider(body){
    if(body && body.glider === true) return true;
    if(body && body.glider === false) return false;
    const inv = root.inv;
    // main.js persists the crafted Lotnia as inv.tools.glider (the recipe writes
    // it, the save round-trips it). Reading only inv.glider meant the canopy
    // could never open for anyone.
    return !!(inv && (inv.glider || (inv.tools && inv.tools.glider)));
  }

  // 0..1 strength of rising air under this column, plus geothermal warmth.
  function thermalAt(x, y, getTile){
    let lift = 0;
    for(let i = 1; i <= CFG.THERMAL_SCAN; i++){
      const t = getSafe(getTile, Math.floor(x), Math.floor(y) + i);
      if(isHeatSource(t)) lift += (1 - i / CFG.THERMAL_SCAN);
      else if(t !== T.AIR && t !== T.WATER) break; // the column is capped by rock
    }
    try{
      if(MM.fire && MM.fire.isBurning){
        for(let dx = -1; dx <= 1; dx++){
          for(let i = 1; i <= 4; i++){
            if(MM.fire.isBurning(Math.floor(x) + dx, Math.floor(y) + i)) lift += 0.22;
          }
        }
      }
    }catch(e){ /* fire not loaded */ }
    try{
      if(MM.geothermal && MM.geothermal.heatAt){
        const h = Number(MM.geothermal.heatAt(Math.floor(x), Math.floor(y) + 1));
        if(Number.isFinite(h) && h > 0) lift += Math.min(0.6, h * 0.5);
      }
    }catch(e){ /* geothermal not loaded */ }
    return Math.max(0, Math.min(1.6, lift));
  }

  function windPush(body, getTile){
    try{
      if(MM.wind && MM.wind.speedAt) return Number(MM.wind.speedAt(body.x, body.y, getTile)) || 0;
      if(MM.wind && MM.wind.speed) return Number(MM.wind.speed()) || 0;
    }catch(e){}
    return 0;
  }

  // The whole feature. Returns a report so callers/QA can see what happened.
  function step(body, dt, getTile, opts){
    const out = { open: false, lift: 0, wind: 0, reason: '' };
    if(!body || !(dt > 0) || typeof getTile !== 'function') return out;
    opts = opts || {};
    if(!opts.holdingJump){ state.open = false; out.reason = 'released'; return out; }
    if(body.onGround){ state.open = false; out.reason = 'grounded'; return out; }
    if(opts.inWater){ state.open = false; out.reason = 'water'; return out; }
    if(!hasGlider(body)){ out.reason = 'none'; return out; }
    const vy = Number(body.vy) || 0;
    if(!state.open && vy < CFG.OPEN_VY){ out.reason = 'notfalling'; return out; }
    // a dive faster than the canopy can take rips it back shut
    if(vy > CFG.STALL_SPEED){ state.open = false; out.reason = 'stall'; return out; }

    state.open = true;
    state.t += dt;
    out.open = true;

    const lift = thermalAt(body.x, body.y, getTile);
    out.lift = lift;
    // physics() already added a FULL gravity step (MOVE.GRAV * playerSpeedMultiplier
    // = 40 tiles/s^2, capped at 40 tiles/s) before this runs, so a per-frame
    // DECREMENT is simply out-accelerated by it — and the runaway vy then trips
    // STALL_SPEED and shuts the canopy. The canopy therefore eases toward a
    // TARGET: rising air moves that target below zero (a real climb), and
    // DRAG_RATE must be large enough to swallow gravity.
    const target = lift > 0.05
      ? Math.max(CFG.THERMAL_MAX_VY, CFG.GLIDE_VY - lift * (CFG.GLIDE_VY - CFG.THERMAL_MAX_VY))
      : CFG.GLIDE_VY;
    if(vy > target) body.vy = Math.max(target, vy - (vy - target) * Math.min(1, dt * CFG.DRAG_RATE));

    const w = windPush(body, getTile);
    out.wind = w;
    if(Math.abs(w) > 0.05){
      const vx = Number(body.vx) || 0;
      const pulled = vx + w * CFG.WIND_PULL * dt * 0.1;
      body.vx = Math.max(-CFG.MAX_GLIDE_VX, Math.min(CFG.MAX_GLIDE_VX, pulled));
    }
    return out;
  }

  function isOpen(){ return !!state.open; }
  function reset(){ state = { open: false, t: 0, lift: 0 }; }
  function metrics(){ return { open: !!state.open, t: +state.t.toFixed(2) }; }

  MM.glider = { step, isOpen, reset, metrics, hasGlider, CFG, _debug: { thermalAt, isHeatSource, state: () => state } };
})();

export const glider = (typeof window !== 'undefined' && window.MM) ? window.MM.glider : globalThis.MM && globalThis.MM.glider;
export default glider;
