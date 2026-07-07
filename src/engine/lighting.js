// Cave lighting: a windowed integer light field (0..15) computed from three
// source families — skylight (per-column top-down scan: a solid roof stops it,
// water and leaves attenuate it), tile emitters (torch, lava, glowing chests)
// and live tile fire (MM.fire.isBurning hook) — spread by a bucket-queue BFS.
// Solid cells RECEIVE light (their exposed face renders lit) but never
// propagate it, so walls stay light-tight and a torch cannot shine through
// rock. Underground cells darken by depth and by missing light; the overlay is
// painted as one 1px-per-tile ImageData blitted with image smoothing enabled,
// which gives smooth radial falloff without per-frame gradient allocation.
//
// The field recomputes only when something can change it: a tile edit inside
// (or above — skylight!) the window, the window itself moving, the day-night
// bucket flipping, the hero crossing a tile (faint personal glow), or — while
// any tile fire burns — a 500 ms heartbeat. A full recompute is a few
// thousand integer cells, well under a millisecond.
//
// Gameplay seam: lightAt(x,y) → 0..1. Unknown cells (outside the computed
// window) report the skylight estimate above the surface and 0 (dark) below,
// so cave-only spawn gating degrades to the legacy depth-only behavior away
// from the player. mobs.js uses this to keep PELZACZE out of torch-lit camps.
import { T, INFO, WORLD_MIN_Y, WORLD_MAX_Y, isLeaf } from '../constants.js';

(function(){
  window.MM = window.MM || {};
  const L = {};

  const LEVELS = 15;
  const PAD = 10;            // window margin beyond the view, tiles
  const SKY_SCAN_UP = 24;    // roof lookback above the window for the skylight scan
  const FIRE_LEVEL = 12;
  const EMITTERS = {
    [T.TORCH]: 13,
    [T.LAVA]: 12,
    [T.MOTHER_LAVA]: 12,
    [T.CHEST_COMMON]: 4,
    [T.CHEST_RARE]: 5,
    [T.CHEST_EPIC]: 6
  };

  const cfg = {
    enabled: true,
    heroGlow: 5,          // faint adaptation glow so darkness never soft-locks
    surfaceRamp: 5,       // tiles below the surface before full darkness applies
    darkBase: 0.86,       // overlay alpha cap right below the ramp
    darkDepthGain: 0.003, // extra cap per tile of depth…
    darkDepthMax: 0.09,   // …up to this bonus (deep caves ~0.95)
    gamma: 1.5            // (1-light)^gamma — midtones stay readable
  };

  let field = null;        // {x0,y0,w,h,level:Uint8Array,surf:Int32Array,dayBucket,heroKey}
  let fieldDirty = true;
  let lastOpts = null;     // remembered {getTile,surfaceHeight,daylight} for lightAt fallback
  let lastComputeAt = 0;
  let canvas = null, canvasCtx = null, imageData = null, pixelsDirty = true;
  const metrics = { computes: 0, lastMs: 0 };

  function blocksLight(t){
    if(t === T.AIR) return false;
    const inf = INFO[t];
    return !inf || !inf.passable;
  }

  // Pure compute: returns {level,surf} for the window. Exposed as L._compute
  // for the deterministic Node test.
  function computeField(win, opts){
    const { x0, y0, w, h } = win;
    const getTile = opts.getTile;
    const daylight = Math.max(0, Math.min(1, Number.isFinite(opts.daylight) ? opts.daylight : 1));
    const skyLevel = Math.round(LEVELS * daylight);
    const level = new Uint8Array(w * h);
    const solid = new Uint8Array(w * h); // 0 open, 1 blocks, 2 water (extra cost)
    const surf = new Int32Array(w);

    for(let i = 0; i < w; i++){
      const wx = x0 + i;
      let s = 0;
      try{ s = opts.surfaceHeight ? opts.surfaceHeight(wx) : 0; }catch(e){ s = 0; }
      surf[i] = s;
      // Skylight: march down from above both the window and the local surface,
      // so roofs up to SKY_SCAN_UP above the view still cast interior shadow.
      let sky = skyLevel;
      const yStart = Math.max(WORLD_MIN_Y, Math.min(y0, s - 1) - SKY_SCAN_UP);
      const yEnd = Math.min(WORLD_MAX_Y, y0 + h);
      for(let y = yStart; y < yEnd; y++){
        const t = getTile(wx, y);
        const inWin = y >= y0;
        const idx = (y - y0) * w + i;
        if(inWin && sky > level[idx]) level[idx] = sky; // cell sees the incoming light (top face)
        if(blocksLight(t)) sky = 0;
        else if(t === T.WATER) sky = Math.max(0, sky - 2);
        else if(isLeaf(t)) sky = Math.max(0, sky - 1);
        if(inWin){
          solid[idx] = blocksLight(t) ? 1 : (t === T.WATER ? 2 : 0);
          let e = EMITTERS[t] || 0;
          if(!e && opts.burningAt){ try{ if(opts.burningAt(wx, y)) e = FIRE_LEVEL; }catch(err){} }
          if(e){
            if(e > level[idx]) level[idx] = e;
            solid[idx] = solid[idx] === 1 ? 0 : solid[idx]; // sources always shine outward
          }
        }
        // NOTE: no early break — even with sky exhausted the loop keeps
        // filling solid[]/emitter seeds for the rest of the column.
      }
    }

    if(opts.hero && cfg.heroGlow > 0){
      const hx = Math.floor(opts.hero.x) - x0, hy = Math.floor(opts.hero.y) - y0;
      if(hx >= 0 && hx < w && hy >= 0 && hy < h){
        const idx = hy * w + hx;
        if(cfg.heroGlow > level[idx]) level[idx] = cfg.heroGlow;
      }
    }

    // Bucket-queue BFS (Dial): exact for step costs 1 (open) / 2 (into water).
    const buckets = [];
    for(let b = 0; b <= LEVELS; b++) buckets.push([]);
    for(let idx = 0; idx < level.length; idx++) if(level[idx] > 0) buckets[level[idx]].push(idx);
    for(let Lv = LEVELS; Lv > 1; Lv--){
      const q = buckets[Lv];
      for(let qi = 0; qi < q.length; qi++){
        const idx = q[qi];
        if(level[idx] !== Lv || solid[idx] === 1) continue; // stale entry / opaque
        const cx = idx % w, cy = (idx / w) | 0;
        for(let d = 0; d < 4; d++){
          const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if(nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nidx = ny * w + nx;
          const nl = Lv - (solid[nidx] === 2 ? 2 : 1);
          if(nl > level[nidx]){ level[nidx] = nl; buckets[nl].push(nidx); }
        }
      }
    }
    return { level, surf };
  }

  function darkAlphaFor(levelValue, depth){
    if(depth <= 0) return 0;
    const ramp = Math.min(1, depth / cfg.surfaceRamp);
    const cap = cfg.darkBase + Math.min(cfg.darkDepthMax, depth * cfg.darkDepthGain);
    const light = levelValue / LEVELS;
    return cap * ramp * Math.pow(1 - light, cfg.gamma);
  }

  function ensure(sx, sy, viewX, viewY, opts){
    if(!opts || typeof opts.getTile !== 'function') return field;
    const x0 = Math.floor(sx) - PAD, y0 = Math.floor(sy) - PAD;
    const w = Math.max(1, Math.ceil(viewX) + PAD * 2 + 2);
    const h = Math.max(1, Math.ceil(viewY) + PAD * 2 + 2);
    const dayBucket = Math.round((Number.isFinite(opts.daylight) ? opts.daylight : 1) * 24);
    const heroKey = opts.hero ? (Math.floor(opts.hero.x) + ',' + Math.floor(opts.hero.y)) : '';
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let fireTick = false;
    if(opts.burningAt && now - lastComputeAt > 500){
      try{ fireTick = !!(MM.fire && MM.fire.count && MM.fire.count() > 0); }catch(e){}
    }
    const stale = !field || field.x0 !== x0 || field.y0 !== y0 || field.w !== w || field.h !== h ||
      field.dayBucket !== dayBucket || field.heroKey !== heroKey || fieldDirty || fireTick;
    lastOpts = opts;
    if(!stale) return field;
    const t0 = now;
    const { level, surf } = computeField({ x0, y0, w, h }, opts);
    field = { x0, y0, w, h, level, surf, dayBucket, heroKey };
    fieldDirty = false;
    pixelsDirty = true;
    lastComputeAt = now;
    metrics.computes++;
    metrics.lastMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
    return field;
  }

  function lightAt(x, y){
    // Disabled = "no lighting model": report dark/unknown so consumers that
    // gate on brightness (crawler spawns) fall back to legacy depth behavior.
    if(!cfg.enabled) return 0;
    x = Math.floor(x); y = Math.floor(y);
    if(field){
      const i = x - field.x0, j = y - field.y0;
      if(i >= 0 && i < field.w && j >= 0 && j < field.h) return field.level[j * field.w + i] / LEVELS;
    }
    // Outside the window: skylight estimate above ground, dark below.
    if(lastOpts && lastOpts.surfaceHeight){
      try{
        const s = lastOpts.surfaceHeight(x);
        if(y <= s) return Math.max(0, Math.min(1, Number.isFinite(lastOpts.daylight) ? lastOpts.daylight : 1));
      }catch(e){}
    }
    return 0;
  }

  function darkAlphaAt(x, y){
    if(!cfg.enabled) return 0;
    x = Math.floor(x); y = Math.floor(y);
    if(!field) return 0;
    const i = x - field.x0, j = y - field.y0;
    if(i < 0 || i >= field.w || j < 0 || j >= field.h) return 0;
    return darkAlphaFor(field.level[j * field.w + i], y - field.surf[i]);
  }

  function onTileChanged(x, y){
    if(!field){ fieldDirty = true; return; }
    x = Math.floor(x); y = Math.floor(y);
    // A change above the window still matters (skylight column scan).
    if(x >= field.x0 - 1 && x < field.x0 + field.w + 1 && y < field.y0 + field.h + 1) fieldDirty = true;
  }

  function draw(ctx, TILE, sx, sy, viewX, viewY, opts){
    if(!cfg.enabled || typeof document === 'undefined') return;
    if(typeof window !== 'undefined' && window.__mmNoCaveFX) return; // visual-QA escape hatch
    const f = ensure(sx, sy, viewX, viewY, opts || {});
    if(!f) return;
    if(!canvas){
      canvas = document.createElement('canvas');
      canvasCtx = canvas.getContext('2d');
    }
    if(canvas.width !== f.w || canvas.height !== f.h){
      canvas.width = f.w; canvas.height = f.h;
      imageData = canvasCtx.createImageData(f.w, f.h);
      pixelsDirty = true;
    }
    if(pixelsDirty){
      const px = imageData.data;
      for(let j = 0; j < f.h; j++){
        const wy = f.y0 + j;
        for(let i = 0; i < f.w; i++){
          const idx = j * f.w + i;
          const a = darkAlphaFor(f.level[idx], wy - f.surf[i]);
          const o = idx * 4;
          px[o] = 6; px[o + 1] = 8; px[o + 2] = 16; // cool cave black, not pure ink
          px[o + 3] = Math.round(a * 255);
        }
      }
      canvasCtx.putImageData(imageData, 0, 0);
      pixelsDirty = false;
    }
    const ox = (opts && opts.originX) || 0, oy = (opts && opts.originY) || 0;
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true; // 1px/tile → bilinear = smooth light falloff
    ctx.drawImage(canvas, (f.x0 - ox) * TILE, (f.y0 - oy) * TILE, f.w * TILE, f.h * TILE);
    ctx.imageSmoothingEnabled = prevSmooth;
  }

  function reset(){ field = null; fieldDirty = true; pixelsDirty = true; lastOpts = null; }

  L.ensure = ensure;
  L.lightAt = lightAt;
  L.darkAlphaAt = darkAlphaAt;
  L.onTileChanged = onTileChanged;
  L.draw = draw;
  L.reset = reset;
  L.config = cfg;
  L.metrics = metrics;
  L.LEVELS = LEVELS;
  L._compute = computeField;
  L._darkAlphaFor = darkAlphaFor;

  MM.lighting = L;
})();
// ESM export (progressive migration)
export const lighting = (typeof window !== 'undefined' && window.MM) ? window.MM.lighting : undefined;
export default lighting;
