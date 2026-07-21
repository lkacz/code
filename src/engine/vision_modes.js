// Equipment-powered night/thermal vision.
//
// The renderer deliberately knows nothing about the world or entity registries:
// main.js supplies the viewport, current fog visibility and an already-bounded
// target list. This keeps the effect cheap and, more importantly, prevents a
// vision item from becoming a world scanner or a wallhack by accident.
//
// Safe rendering contracts:
//   * pass `isTileVisible(wx, wy)` to clip the terrain tint to the current
//     line-of-sight mask, OR
//   * pass `fogWillRenderAfter:true` when the ordinary opaque fog overlay is
//     guaranteed to be painted after this effect.
// Without either contract drawOverlay() fails closed and paints nothing.
// Thermal targets additionally require `isVisible(target) === true`, an
// explicit `target.visible/currentlyVisible === true`, or
// `targetsAreVisible:true` for a list pre-filtered by the caller.

const root = typeof window !== 'undefined' ? window : globalThis;
root.MM = root.MM || {};

export const VISION_MODES = Object.freeze({
  OFF: 'off',
  NIGHT: 'night',
  THERMAL: 'thermal',
});

const VALID_MODES = new Set(Object.values(VISION_MODES));
const MAX_LEVEL = 4;

export const VISION_LIMITS = Object.freeze({
  maxVisibilityChecks: 8192,
  maxTargetInspect: 256,
  maxThermalTargets: Object.freeze([0, 16, 24, 36, 48]),
  thermalRangeTiles: Object.freeze([0, 8, 12, 17, 24]),
  maxNoiseMarks: 360,
  maxScanlines: 180,
});

const DEFAULTS = Object.freeze({
  nightDrain: Object.freeze([0, 0.45, 0.62, 0.82, 1.05]),
  thermalDrain: Object.freeze([0, 0.75, 1.0, 1.3, 1.65]),
  minStartSeconds: 0.65,
  switchCooldown: 0.22,
  depletedCooldown: 0.8,
});

function finite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function sanitizeVisionLevel(value, fallback = 1) {
  const safeFallback = Math.max(1, Math.min(MAX_LEVEL, Math.floor(finite(fallback, 1))));
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(finite(value, safeFallback))));
}

export function sanitizeVisionMode(value) {
  return typeof value === 'string' && VALID_MODES.has(value) ? value : VISION_MODES.OFF;
}

export function sanitizeVisionSnapshot(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { v: 1, mode: VISION_MODES.OFF, level: 1 };
  }
  return {
    v: 1,
    mode: sanitizeVisionMode(data.mode),
    level: sanitizeVisionLevel(data.level, 1),
  };
}

function sanitizeDrainTable(value, fallback) {
  const out = fallback.slice();
  if (!Array.isArray(value)) return out;
  for (let i = 1; i <= MAX_LEVEL; i++) {
    out[i] = Math.max(0.01, Math.min(100, finite(value[i], fallback[i])));
  }
  return out;
}

function sanitizeConfig(options) {
  const raw = options && typeof options === 'object' ? options : {};
  return {
    nightDrain: sanitizeDrainTable(raw.nightDrain, DEFAULTS.nightDrain),
    thermalDrain: sanitizeDrainTable(raw.thermalDrain, DEFAULTS.thermalDrain),
    minStartSeconds: Math.max(0.1, Math.min(5, finite(raw.minStartSeconds, DEFAULTS.minStartSeconds))),
    switchCooldown: Math.max(0, Math.min(3, finite(raw.switchCooldown, DEFAULTS.switchCooldown))),
    depletedCooldown: Math.max(0.1, Math.min(10, finite(raw.depletedCooldown, DEFAULTS.depletedCooldown))),
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

function normalizeViewport(ctx, view) {
  const raw = view && typeof view === 'object' ? view : {};
  const canvas = ctx && ctx.canvas ? ctx.canvas : null;
  const canvasWidth = canvas ? finite(canvas.width, 0) : 0;
  const canvasHeight = canvas ? finite(canvas.height, 0) : 0;
  const x = finite(raw.x, 0);
  const y = finite(raw.y, 0);
  const width = Math.max(0, Math.min(16384, finite(raw.width, canvasWidth)));
  const height = Math.max(0, Math.min(16384, finite(raw.height, canvasHeight)));
  const tileSize = Math.max(1, Math.min(512, finite(raw.tileSize, finite(raw.TILE, 20))));
  return {
    x, y, width, height, tileSize,
    worldX: finite(raw.worldX, finite(raw.sx, 0)),
    worldY: finite(raw.worldY, finite(raw.sy, 0)),
  };
}

function contextCanPaint(ctx) {
  return !!(ctx && typeof ctx.save === 'function' && typeof ctx.restore === 'function' && typeof ctx.fillRect === 'function');
}

// Adds a current-visibility clip. The number of callback calls and path
// segments is bounded by the visible viewport and maxVisibilityChecks.
function applyVisibilityClip(ctx, view, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.fogWillRenderAfter === true) return { ok: true, clipped: false, checks: 0 };
  if (typeof opts.isTileVisible !== 'function') return { ok: false, reason: 'visibility-contract', checks: 0 };
  if (typeof ctx.beginPath !== 'function' || typeof ctx.rect !== 'function' || typeof ctx.clip !== 'function') {
    return { ok: false, reason: 'clip-api', checks: 0 };
  }

  const cols = Math.max(0, Math.ceil(view.width / view.tileSize));
  const rows = Math.max(0, Math.ceil(view.height / view.tileSize));
  const checksNeeded = cols * rows;
  if (checksNeeded > VISION_LIMITS.maxVisibilityChecks) {
    return { ok: false, reason: 'visibility-budget', checks: 0 };
  }

  let checks = 0;
  let runs = 0;
  ctx.beginPath();
  for (let row = 0; row < rows; row++) {
    let runStart = -1;
    for (let col = 0; col <= cols; col++) {
      let visible = false;
      if (col < cols) {
        checks++;
        try {
          visible = opts.isTileVisible(Math.floor(view.worldX + col), Math.floor(view.worldY + row)) === true;
        } catch (_error) {
          visible = false;
        }
      }
      if (visible && runStart < 0) runStart = col;
      if (!visible && runStart >= 0) {
        const px = view.x + runStart * view.tileSize;
        const py = view.y + row * view.tileSize;
        const w = Math.min(view.width - runStart * view.tileSize, (col - runStart) * view.tileSize);
        const h = Math.min(view.tileSize, view.height - row * view.tileSize);
        if (w > 0 && h > 0) {
          ctx.rect(px, py, w, h);
          runs++;
        }
        runStart = -1;
      }
    }
  }
  if (runs <= 0) return { ok: false, reason: 'no-visible-tiles', checks };
  ctx.clip();
  return { ok: true, clipped: true, checks, runs };
}

// Stable integer noise: animated in coarse time steps by update(), never by
// Math.random(), so the phosphor grain does not flicker erratically.
function hash01(seed) {
  let n = seed | 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}

function nightPalette(level) {
  return {
    liftAlpha: [0, 0.15, 0.2, 0.25, 0.3][level],
    tintAlpha: [0, 0.08, 0.1, 0.115, 0.13][level],
    grain: [0, 90, 150, 230, VISION_LIMITS.maxNoiseMarks][level],
    scanAlpha: [0, 0.045, 0.05, 0.055, 0.06][level],
  };
}

function drawNightOverlay(ctx, view, level, phase) {
  const palette = nightPalette(level);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `rgba(22,150,69,${palette.liftAlpha})`;
  ctx.fillRect(view.x, view.y, view.width, view.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(0,47,20,${palette.tintAlpha})`;
  ctx.fillRect(view.x, view.y, view.width, view.height);

  const lineSpacing = Math.max(4, Math.ceil(view.height / VISION_LIMITS.maxScanlines));
  ctx.fillStyle = `rgba(2,17,8,${palette.scanAlpha})`;
  let scanlines = 0;
  const offset = Math.floor(phase * 9) % lineSpacing;
  for (let py = view.y + offset; py < view.y + view.height && scanlines < VISION_LIMITS.maxScanlines; py += lineSpacing) {
    ctx.fillRect(view.x, py, view.width, 1);
    scanlines++;
  }

  const areaScale = Math.min(1, (view.width * view.height) / (960 * 540));
  const grainCount = Math.min(VISION_LIMITS.maxNoiseMarks, Math.ceil(palette.grain * Math.max(0.25, areaScale)));
  const frame = Math.floor(phase * 12);
  ctx.fillStyle = 'rgba(151,255,174,0.075)';
  for (let i = 0; i < grainCount; i++) {
    const px = view.x + hash01(i * 2 + frame * 977) * view.width;
    const py = view.y + hash01(i * 2 + 1 + frame * 577) * view.height;
    ctx.fillRect(Math.floor(px), Math.floor(py), i % 7 === 0 ? 2 : 1, 1);
  }
  return { scanlines, grain: grainCount };
}

function drawThermalTerrain(ctx, view, level) {
  const alpha = [0, 0.48, 0.52, 0.56, 0.6][level];
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(2,13,45,${alpha})`;
  ctx.fillRect(view.x, view.y, view.width, view.height);
  ctx.fillStyle = `rgba(24,67,119,${0.035 + level * 0.008})`;
  const bands = Math.min(12, 4 + level * 2);
  for (let i = 0; i < bands; i++) {
    const py = view.y + ((i + 0.5) / bands) * view.height;
    ctx.fillRect(view.x, Math.floor(py), view.width, 1);
  }
  return { bands };
}

function targetIsLiving(target, options) {
  if (!target || typeof target !== 'object') return false;
  if (typeof options.isLiving === 'function') {
    try { return options.isLiving(target) === true; } catch (_error) { return false; }
  }
  if (target.living === false || target.dead === true || target.removed === true) return false;
  if (Number.isFinite(Number(target.hp)) && Number(target.hp) <= 0) return false;
  return true;
}

function targetIsVisible(target, options) {
  if (typeof options.isVisible === 'function') {
    try { return options.isVisible(target) === true; } catch (_error) { return false; }
  }
  if (options.targetsAreVisible === true) return true;
  return target.visible === true || target.currentlyVisible === true;
}

function normalizeTargetBounds(target, view, options) {
  if (typeof options.toScreen === 'function') {
    try {
      const b = options.toScreen(target, view);
      if (b && [b.x, b.y, b.w, b.h].every(v => Number.isFinite(Number(v)))) {
        return { x: Number(b.x), y: Number(b.y), w: Math.max(1, Number(b.w)), h: Math.max(1, Number(b.h)), center: b.center === true };
      }
    } catch (_error) {}
    return null;
  }
  if (Number.isFinite(Number(target.screenX)) && Number.isFinite(Number(target.screenY))) {
    return {
      x: Number(target.screenX), y: Number(target.screenY),
      w: Math.max(1, finite(target.screenW, view.tileSize * finite(target.w, 0.8))),
      h: Math.max(1, finite(target.screenH, view.tileSize * finite(target.h, 1))),
      center: target.screenCenter !== false,
    };
  }
  if (!Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))) return null;
  return {
    x: view.x + (Number(target.x) - view.worldX) * view.tileSize,
    y: view.y + (Number(target.y) - view.worldY) * view.tileSize,
    w: Math.max(1, view.tileSize * Math.max(0.1, finite(target.w, 0.8))),
    h: Math.max(1, view.tileSize * Math.max(0.1, finite(target.h, 1))),
    center: target.center !== false,
  };
}

function boundsOnScreen(bounds, view) {
  const left = bounds.center ? bounds.x - bounds.w * 0.5 : bounds.x;
  const top = bounds.center ? bounds.y - bounds.h * 0.5 : bounds.y;
  return left < view.x + view.width && left + bounds.w > view.x && top < view.y + view.height && top + bounds.h > view.y;
}

function targetWorldDistance(target, view, options) {
  if (!Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))) return 0;
  const origin = options.origin && typeof options.origin === 'object' ? options.origin : null;
  const ox = origin && Number.isFinite(Number(origin.x)) ? Number(origin.x) : view.worldX + view.width / view.tileSize * 0.5;
  const oy = origin && Number.isFinite(Number(origin.y)) ? Number(origin.y) : view.worldY + view.height / view.tileSize * 0.5;
  return Math.hypot(Number(target.x) - ox, Number(target.y) - oy);
}

function drawWarmTarget(ctx, target, level, phase) {
  const bounds = target.bounds;
  const left = bounds.center ? bounds.x - bounds.w * 0.5 : bounds.x;
  const top = bounds.center ? bounds.y - bounds.h * 0.5 : bounds.y;
  const cx = left + bounds.w * 0.5;
  const cy = top + bounds.h * 0.5;
  const heat = clamp01(target.heat);
  const pulse = 0.92 + Math.sin(phase * 4 + target.index * 0.73) * 0.08;
  const glowRadius = Math.max(bounds.w, bounds.h) * (0.8 + level * 0.08);

  if (typeof ctx.createRadialGradient === 'function') {
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    gradient.addColorStop(0, `rgba(255,247,144,${(0.26 + heat * 0.2) * pulse})`);
    gradient.addColorStop(0.45, `rgba(255,88,24,${(0.18 + heat * 0.14) * pulse})`);
    gradient.addColorStop(1, 'rgba(255,35,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2);
  }

  // Translucent heat GLAZE, not an opaque blob: the creature's real sprite —
  // already rendered under the thermal terrain wash — shows through tinted hot,
  // which is what the goggles promise ("widoczne istoty stają się ciepłymi
  // sylwetkami"). An opaque ellipse turned every species into the same egg.
  const bodyColor = heat > 0.66 ? '255,243,154' : (heat > 0.33 ? '255,155,47' : '255,85,51');
  if (typeof ctx.beginPath === 'function' && typeof ctx.ellipse === 'function' && typeof ctx.fill === 'function') {
    ctx.fillStyle = `rgba(${bodyColor},${(0.28 + heat * 0.12) * pulse})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(2, bounds.w * 0.5), Math.max(2, bounds.h * 0.52), 0, 0, Math.PI * 2);
    ctx.fill();
    // hotter core sits high in the chest, not dead-center — reads as a body
    ctx.fillStyle = `rgba(255,247,180,${(0.18 + heat * 0.14) * pulse})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy - bounds.h * 0.12, Math.max(1.5, bounds.w * 0.3), Math.max(1.5, bounds.h * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = `rgba(${bodyColor},0.34)`;
    ctx.fillRect(left + bounds.w * 0.08, top + bounds.h * 0.05, bounds.w * 0.84, bounds.h * 0.9);
  }
  // soft designator rim — a faint bracket, not a hard white box over the sprite
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeStyle = `rgba(255,248,188,${0.24 + heat * 0.16})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 1, top - 1, bounds.w + 2, bounds.h + 2);
  }
}

export function createVisionModel(options) {
  const cfg = sanitizeConfig(options);
  let mode = VISION_MODES.OFF;
  let level = 1;
  let cooldown = 0;
  let phase = 0;
  let energySpent = 0;
  let lastCollect = { inspected: 0, accepted: 0 };

  function drainFor(nextMode = mode, nextLevel = level) {
    const l = sanitizeVisionLevel(nextLevel, level);
    if (nextMode === VISION_MODES.NIGHT) return cfg.nightDrain[l];
    if (nextMode === VISION_MODES.THERMAL) return cfg.thermalDrain[l];
    return 0;
  }

  function hasStartEnergy(energy, nextMode, nextLevel, opts) {
    if (opts && opts.unlimited === true) return true;
    if (!energy) return false;
    const needed = drainFor(nextMode, nextLevel) * cfg.minStartSeconds;
    try {
      if (typeof energy.canSpend === 'function') return energy.canSpend(needed) === true;
      if (typeof energy.info === 'function') {
        const info = energy.info();
        return !!(info && Number.isFinite(Number(info.energy)) && Number(info.energy) >= needed);
      }
    } catch (_error) {}
    return false;
  }

  function setMode(nextMode, nextLevel, energy, opts) {
    const requested = sanitizeVisionMode(nextMode);
    const requestedLevel = sanitizeVisionLevel(nextLevel, level);
    if (requested === VISION_MODES.OFF) {
      const changed = mode !== VISION_MODES.OFF;
      mode = VISION_MODES.OFF;
      level = requestedLevel;
      return { changed, mode, level: 0, cooldown };
    }
    if (requested === mode) {
      const changed = requestedLevel !== level;
      level = requestedLevel;
      return { changed, mode, level, cooldown };
    }
    if (cooldown > 0 && !(opts && opts.bypassCooldown === true)) {
      return { changed: false, mode, level: mode === VISION_MODES.OFF ? 0 : level, blocked: 'cooldown', cooldown };
    }
    if (!hasStartEnergy(energy, requested, requestedLevel, opts)) {
      return { changed: false, mode, level: mode === VISION_MODES.OFF ? 0 : level, blocked: 'energy', cooldown };
    }
    mode = requested;
    level = requestedLevel;
    cooldown = cfg.switchCooldown;
    return { changed: true, mode, level, cooldown };
  }

  function cycle(available, energy, opts) {
    const caps = available && typeof available === 'object' ? available : {};
    const night = Math.max(0, Math.min(MAX_LEVEL, Math.floor(finite(caps.night, 0))));
    const thermal = Math.max(0, Math.min(MAX_LEVEL, Math.floor(finite(caps.thermal, 0))));
    const modes = [VISION_MODES.OFF];
    if (night > 0) modes.push(VISION_MODES.NIGHT);
    if (thermal > 0) modes.push(VISION_MODES.THERMAL);
    const at = Math.max(0, modes.indexOf(mode));
    const next = modes[(at + 1) % modes.length];
    return setMode(next, next === VISION_MODES.NIGHT ? night : (next === VISION_MODES.THERMAL ? thermal : level), energy, opts);
  }

  function reconcileAvailability(available) {
    const caps = available && typeof available === 'object' ? available : {};
    const cap = mode === VISION_MODES.NIGHT ? finite(caps.night, 0) : (mode === VISION_MODES.THERMAL ? finite(caps.thermal, 0) : MAX_LEVEL);
    const safeCap = Math.max(0, Math.min(MAX_LEVEL, Math.floor(cap)));
    if (mode !== VISION_MODES.OFF && safeCap <= 0) {
      mode = VISION_MODES.OFF;
      return { changed: true, mode, level: 0, reason: 'unequipped' };
    }
    if (mode !== VISION_MODES.OFF && level > safeCap) {
      level = safeCap;
      return { changed: true, mode, level, reason: 'level-clamped' };
    }
    return { changed: false, mode, level: mode === VISION_MODES.OFF ? 0 : level };
  }

  function spendEnergy(energy, cost) {
    try {
      if (energy && typeof energy.spendContinuous === 'function') {
        const paid = energy.spendContinuous(cost);
        if (paid === true) return cost;
        return Math.max(0, Math.min(cost, finite(paid, 0)));
      }
      if (energy && typeof energy.spend === 'function' && energy.spend(cost) === true) return cost;
    } catch (_error) {}
    return 0;
  }

  function remainingEnergy(energy) {
    try {
      if (energy && typeof energy.info === 'function') {
        const data = energy.info();
        if (data && Number.isFinite(Number(data.energy))) return Math.max(0, Number(data.energy));
      }
    } catch (_error) {}
    return null;
  }

  function update(dt, energy, opts) {
    const rawStep = Math.max(0, finite(dt, 0));
    cooldown = Math.max(0, cooldown - Math.min(0.25, rawStep));
    const step = Math.min(0.1, rawStep);
    phase = (phase + step) % 4096;
    if (mode === VISION_MODES.OFF || step <= 0) return { on: false, changed: false, spent: 0, cooldown };
    if (opts && opts.unlimited === true) return { on: true, changed: false, spent: 0, cooldown };
    const cost = drainFor() * step;
    const spent = spendEnergy(energy, cost);
    energySpent += spent;
    const remaining = remainingEnergy(energy);
    if (spent < cost - 1e-7 || (remaining !== null && remaining <= 1e-7)) {
      mode = VISION_MODES.OFF;
      cooldown = Math.max(cooldown, cfg.depletedCooldown);
      return { on: false, changed: true, depleted: true, spent, cooldown };
    }
    return { on: true, changed: false, spent, cooldown };
  }

  function drawOverlay(ctx, viewInput, opts) {
    if (mode === VISION_MODES.OFF) return { drawn: false, reason: 'off' };
    if (!contextCanPaint(ctx)) return { drawn: false, reason: 'context' };
    const view = normalizeViewport(ctx, viewInput);
    if (view.width <= 0 || view.height <= 0) return { drawn: false, reason: 'viewport' };
    ctx.save();
    let visibility;
    try {
      visibility = applyVisibilityClip(ctx, view, opts);
    } catch (_error) {
      ctx.restore();
      return { drawn: false, reason: 'visibility-error', visibilityChecks: 0 };
    }
    if (!visibility.ok) {
      ctx.restore();
      return { drawn: false, reason: visibility.reason, visibilityChecks: visibility.checks || 0 };
    }
    let detail;
    try {
      detail = mode === VISION_MODES.NIGHT
        ? drawNightOverlay(ctx, view, level, phase)
        : drawThermalTerrain(ctx, view, level);
    } finally {
      ctx.restore();
    }
    return { drawn: true, mode, level, visibilityChecks: visibility.checks || 0, clipped: visibility.clipped, ...detail };
  }

  function collectThermalTargets(targets, viewInput, opts) {
    const optionsSafe = opts && typeof opts === 'object' ? opts : {};
    if (mode !== VISION_MODES.THERMAL || !Array.isArray(targets)) {
      lastCollect = { inspected: 0, accepted: 0 };
      return [];
    }
    const view = normalizeViewport(null, viewInput);
    const maxInspect = Math.min(targets.length, VISION_LIMITS.maxTargetInspect);
    const maxTargets = VISION_LIMITS.maxThermalTargets[level];
    const range = VISION_LIMITS.thermalRangeTiles[level];
    const accepted = [];
    let inspected = 0;
    for (let i = 0; i < maxInspect && accepted.length < maxTargets; i++) {
      const target = targets[i];
      inspected++;
      if (!targetIsLiving(target, optionsSafe) || !targetIsVisible(target, optionsSafe)) continue;
      if (targetWorldDistance(target, view, optionsSafe) > range) continue;
      const bounds = normalizeTargetBounds(target, view, optionsSafe);
      if (!bounds || !boundsOnScreen(bounds, view)) continue;
      accepted.push({
        target,
        bounds,
        heat: clamp01(Number.isFinite(Number(target.heat)) ? Number(target.heat) : 0.72),
        index: i,
      });
    }
    lastCollect = { inspected, accepted: accepted.length };
    return accepted;
  }

  function drawThermalTargets(ctx, targets, viewInput, opts) {
    if (mode !== VISION_MODES.THERMAL) return { drawn: 0, inspected: 0 };
    if (!contextCanPaint(ctx)) return { drawn: 0, inspected: 0, reason: 'context' };
    const prepared = collectThermalTargets(targets, viewInput, opts);
    if (prepared.length <= 0) return { drawn: 0, inspected: lastCollect.inspected };
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'source-over';
      for (const target of prepared) drawWarmTarget(ctx, target, level, phase);
    } finally {
      ctx.restore();
    }
    return { drawn: prepared.length, inspected: lastCollect.inspected };
  }

  function draw(ctx, view, opts) {
    const overlay = drawOverlay(ctx, view, opts);
    let targets = { drawn: 0, inspected: 0 };
    if (overlay.drawn && mode === VISION_MODES.THERMAL && opts && Array.isArray(opts.targets)) {
      targets = drawThermalTargets(ctx, opts.targets, view, opts);
    }
    return { overlay, targets };
  }

  function snapshot() {
    return { v: 1, mode, level };
  }

  function restore(data) {
    const safe = sanitizeVisionSnapshot(data);
    mode = safe.mode;
    level = safe.level;
    cooldown = 0;
    phase = 0;
    lastCollect = { inspected: 0, accepted: 0 };
    return snapshot();
  }

  function reset() {
    mode = VISION_MODES.OFF;
    level = 1;
    cooldown = 0;
    phase = 0;
    energySpent = 0;
    lastCollect = { inspected: 0, accepted: 0 };
  }

  function info() {
    return {
      mode,
      level: mode === VISION_MODES.OFF ? 0 : level,
      selectedLevel: level,
      cooldown,
      drainPerSecond: drainFor(),
      energySpent,
      thermalRangeTiles: mode === VISION_MODES.THERMAL ? VISION_LIMITS.thermalRangeTiles[level] : 0,
      lastCollect: { ...lastCollect },
    };
  }

  return {
    setMode,
    cycle,
    reconcileAvailability,
    update,
    draw,
    drawOverlay,
    collectThermalTargets,
    drawThermalTargets,
    snapshot,
    restore,
    reset,
    info,
    isOn: () => mode !== VISION_MODES.OFF,
    mode: () => mode,
    level: () => mode === VISION_MODES.OFF ? 0 : level,
    drainFor,
  };
}

export const visionModes = createVisionModel();
root.MM.visionModes = visionModes;
root.MM.createVisionModel = createVisionModel;

export default visionModes;
