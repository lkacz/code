import { T, INFO, WORLD_H, isAutumnLeaf, isLeaf } from '../constants.js';

const root = typeof window !== 'undefined' ? window : globalThis;
root.MM = root.MM || {};

const DAY_SECONDS = 600;
const DAYS_PER_SEASON = 10;
const TRANSITION_DAYS = 2;
const HALF_TRANSITION_DAYS = TRANSITION_DAYS / 2;

const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_ALIASES = {
  spring: 'spring',
  wiosna: 'spring',
  summer: 'summer',
  lato: 'summer',
  autumn: 'autumn',
  jesien: 'autumn',
  fall: 'autumn',
  winter: 'winter',
  zima: 'winter',
};
const BASE_PROFILES = {
  spring: {
    id: 'spring', label: 'Wiosna',
    temperatureDelta: 0.04,
    animalSpawnMult: 1.45,
    windMult: 0.85,
    squallChanceMult: 0.75,
    stormChanceMult: 0.85,
    stormFeedMult: 0.90,
    rainRateMult: 1.05,
    borderMoistureMult: 1.10,
    freezeStrength: 0,
    thawStrength: 1,
    snowStrength: 0,
    snowMeltStrength: 0.75,
    leafGrowStrength: 1,
    leafDropStrength: 0,
  },
  summer: {
    id: 'summer', label: 'Lato',
    temperatureDelta: 0.14,
    animalSpawnMult: 1.05,
    windMult: 0.16,
    squallChanceMult: 0.10,
    stormChanceMult: 2.40,
    stormFeedMult: 1.70,
    rainRateMult: 1.65,
    borderMoistureMult: 1.55,
    freezeStrength: 0,
    thawStrength: 1,
    snowStrength: 0,
    snowMeltStrength: 1,
    leafGrowStrength: 0.35,
    leafDropStrength: 0,
  },
  autumn: {
    id: 'autumn', label: 'Jesien',
    temperatureDelta: -0.03,
    animalSpawnMult: 0.58,
    windMult: 1.80,
    squallChanceMult: 2.40,
    stormChanceMult: 0.90,
    stormFeedMult: 0.85,
    rainRateMult: 0.95,
    borderMoistureMult: 0.95,
    freezeStrength: 0.05,
    thawStrength: 0.25,
    snowStrength: 0.18,
    snowMeltStrength: 0.18,
    leafGrowStrength: 0,
    leafDropStrength: 1,
  },
  winter: {
    id: 'winter', label: 'Zima',
    temperatureDelta: -0.35,
    animalSpawnMult: 0.34,
    windMult: 1.10,
    squallChanceMult: 1.25,
    stormChanceMult: 0.35,
    stormFeedMult: 0.55,
    rainRateMult: 0.65,
    borderMoistureMult: 0.70,
    freezeStrength: 1,
    thawStrength: 0,
    snowStrength: 1,
    snowMeltStrength: 0,
    leafGrowStrength: 0,
    leafDropStrength: 0.20,
  },
};

const NUMERIC_KEYS = [
  'temperatureDelta',
  'animalSpawnMult',
  'windMult',
  'squallChanceMult',
  'stormChanceMult',
  'stormFeedMult',
  'rainRateMult',
  'borderMoistureMult',
  'freezeStrength',
  'thawStrength',
  'snowStrength',
  'snowMeltStrength',
  'leafGrowStrength',
  'leafDropStrength',
];
const DISABLED_PROFILE = Object.freeze({
  id: 'off',
  label: 'Sezony OFF',
  temperatureDelta: 0,
  animalSpawnMult: 1,
  windMult: 1,
  squallChanceMult: 1,
  stormChanceMult: 1,
  stormFeedMult: 1,
  rainRateMult: 1,
  borderMoistureMult: 1,
  freezeStrength: 0,
  thawStrength: 0,
  snowStrength: 0,
  snowMeltStrength: 0,
  leafGrowStrength: 0,
  leafDropStrength: 0,
});

const PROFILE_RANGES = {
  temperatureDelta: [-0.65, 0.35],
  animalSpawnMult: [0.05, 3],
  windMult: [0, 3],
  squallChanceMult: [0, 4],
  stormChanceMult: [0, 4],
  stormFeedMult: [0, 3],
  rainRateMult: [0, 3],
  borderMoistureMult: [0, 3],
  freezeStrength: [0, 1],
  thawStrength: [0, 1],
  snowStrength: [0, 1],
  snowMeltStrength: [0, 1],
  leafGrowStrength: [0, 1],
  leafDropStrength: [0, 1],
};

for(const key of Object.keys(BASE_PROFILES)) Object.freeze(BASE_PROFILES[key]);
Object.freeze(BASE_PROFILES);
Object.freeze(SEASON_ORDER);

const CFG = {
  scanRadius: 96,
  scanCols: 20,
  scanInterval: 0.22,
  relocationBurstDistance: 32,
  relocationBurstScans: 8,
  relocationBurstCols: 48,
  relocationBurstPassesPerTick: 1,
  relocationMaxOpsPerTick: 8,
  surfaceAbove: 24,
  surfaceBelow: 42,
  freezeTemp: 0.28,
  thawTemp: 0.43,
  snowTemp: 0.30,
  snowMeltTemp: 0.46,
  maxOpsPerTick: 6,
  maxLeafOpsPerTick: 2,
  relocationMaxLeafOpsPerTick: 3,
  slowFrameSkipMs: 34,
  effectEpochSeconds: 5,
};

let elapsedSeconds = 0;
let scanAcc = 0;
let scanCursor = 0;
let forcedSeason = null;
let enabled = true;
let cachedState = null;
let cachedAt = -1;
let lastScan = emptyScanMetrics();
let lastScanCenterX = null;
let relocationBurstRemaining = 0;
const recentEvents = [];
const listeners = new Set();

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function mod(n, m){ return ((n % m) + m) % m; }
function smoothstep(a, b, x){
  const t = clamp((x - a) / Math.max(1e-9, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function seasonByIndex(index){ return BASE_PROFILES[SEASON_ORDER[mod(index, SEASON_ORDER.length)]]; }
function finiteNumber(v, fallback){ return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }
function cleanProfileNumber(key, value, fallback){
  const range = PROFILE_RANGES[key] || [-Infinity, Infinity];
  return clamp(finiteNumber(value, fallback), range[0], range[1]);
}
function safeInt(v, fallback, min, max){
  const n = Math.floor(finiteNumber(v, fallback));
  return clamp(n, min, max);
}
function emptyScanMetrics(){
  return {
    columns: 0,
    ops: 0,
    leafOps: 0,
    surfaceLookups: 0,
    tempLookups: 0,
    cursor: 0,
    ms: 0,
    relocation: false,
    deferred: false,
    deferReason: '',
    changed: {freeze: 0, thaw: 0, snow: 0, snowMelt: 0, leafGrow: 0, leafDrop: 0},
  };
}
function scanConfig(){
  const radius = safeInt(CFG.scanRadius, 96, 8, 512);
  const span = radius * 2 + 1;
  return {
    radius,
    span,
    cols: safeInt(CFG.scanCols, 20, 1, Math.min(96, span)),
    interval: clamp(finiteNumber(CFG.scanInterval, 0.22), 0.05, 2),
    maxOps: safeInt(CFG.maxOpsPerTick, 6, 1, 24),
    maxLeafOps: safeInt(CFG.maxLeafOpsPerTick, 2, 0, 8),
    relocationDistance: safeInt(CFG.relocationBurstDistance, 32, 0, 512),
    relocationScans: safeInt(CFG.relocationBurstScans, 8, 0, 16),
    relocationCols: safeInt(CFG.relocationBurstCols, 48, 1, Math.min(160, span)),
    relocationPassesPerTick: safeInt(CFG.relocationBurstPassesPerTick, 1, 1, 1),
    relocationMaxOps: safeInt(CFG.relocationMaxOpsPerTick, 8, 1, 16),
    relocationMaxLeafOps: safeInt(CFG.relocationMaxLeafOpsPerTick, 3, 0, 8),
    slowFrameSkipMs: safeInt(CFG.slowFrameSkipMs, 34, 0, 250),
    epochSeconds: clamp(finiteNumber(CFG.effectEpochSeconds, 5), 0.5, 60),
  };
}

function cloneProfile(src){
  const base = src || BASE_PROFILES.spring;
  const out = {id: base.id || 'spring', label: base.label || 'Wiosna'};
  if(base.from) out.from = base.from;
  if(base.to) out.to = base.to;
  if(Number.isFinite(base.blend)) out.blend = clamp(base.blend, 0, 1);
  for(const key of NUMERIC_KEYS){
    out[key] = cleanProfileNumber(key, base[key], key.endsWith('Mult') ? 1 : 0);
  }
  return Object.freeze(out);
}

function mixProfiles(from, to, blend){
  if(!from || !to) return cloneProfile(BASE_PROFILES.spring);
  if(from.id === to.id) return cloneProfile(from);
  const out = {id: to.id, label: to.label, from: from.id, to: to.id, blend};
  for(const key of NUMERIC_KEYS){
    const a = cleanProfileNumber(key, from[key], 0);
    const b = cleanProfileNumber(key, to[key], a);
    out[key] = a + (b - a) * blend;
  }
  return Object.freeze(out);
}

function stateAtDays(days){
  const totalDays = Math.max(0, finiteNumber(days, 0));
  const seasonNumber = Math.floor(totalDays / DAYS_PER_SEASON);
  const seasonIndex = mod(seasonNumber, SEASON_ORDER.length);
  const dayInSeason = totalDays - seasonNumber * DAYS_PER_SEASON;
  let fromIndex = seasonIndex;
  let toIndex = seasonIndex;
  let blend = 1;
  let transition = false;

  if(seasonNumber > 0 && dayInSeason < HALF_TRANSITION_DAYS){
    fromIndex = mod(seasonIndex - 1, SEASON_ORDER.length);
    toIndex = seasonIndex;
    blend = 0.5 + 0.5 * smoothstep(0, HALF_TRANSITION_DAYS, dayInSeason);
    transition = true;
  } else if(dayInSeason >= DAYS_PER_SEASON - HALF_TRANSITION_DAYS){
    fromIndex = seasonIndex;
    toIndex = mod(seasonIndex + 1, SEASON_ORDER.length);
    blend = 0.5 * smoothstep(DAYS_PER_SEASON - HALF_TRANSITION_DAYS, DAYS_PER_SEASON, dayInSeason);
    transition = true;
  }

  const from = seasonByIndex(fromIndex);
  const to = seasonByIndex(toIndex);
  const profile = mixProfiles(from, to, blend);
  const label = transition && from.id !== to.id
    ? from.label + ' -> ' + to.label
    : seasonByIndex(seasonIndex).label;
  return {
    day: Math.floor(totalDays) + 1,
    dayFloat: totalDays + 1,
    seasonDay: dayInSeason + 1,
    seasonIndex,
    season: SEASON_ORDER[seasonIndex],
    label,
    transition,
    from: from.id,
    to: to.id,
    blend,
    nextInDays: DAYS_PER_SEASON - dayInSeason,
    profile,
  };
}

function currentState(){
  if(forcedSeason){
    const idx = SEASON_ORDER.indexOf(forcedSeason);
    const raw = idx >= 0 ? seasonByIndex(idx) : BASE_PROFILES.spring;
    return {
      day: Math.floor(elapsedSeconds / DAY_SECONDS) + 1,
      dayFloat: elapsedSeconds / DAY_SECONDS + 1,
      seasonDay: 1,
      seasonIndex: Math.max(0, idx),
      season: raw.id,
      label: raw.label + ' (debug)',
      transition: false,
      from: raw.id,
      to: raw.id,
      blend: 1,
      nextInDays: DAYS_PER_SEASON,
      profile: cloneProfile(raw),
      forced: true,
    };
  }
  if(cachedState && cachedAt === elapsedSeconds) return cachedState;
  cachedAt = elapsedSeconds;
  cachedState = stateAtDays(elapsedSeconds / DAY_SECONDS);
  return cachedState;
}

function profile(){ return enabled ? currentState().profile : DISABLED_PROFILE; }

function emit(type, payload){
  const ev = Object.freeze(Object.assign({
    type,
    atSeconds: +elapsedSeconds.toFixed(3),
    day: Math.floor(elapsedSeconds / DAY_SECONDS) + 1,
  }, payload || {}));
  recentEvents.push(ev);
  while(recentEvents.length > 24) recentEvents.shift();
  for(const fn of listeners){
    try{ fn(ev); }catch(e){}
  }
  return ev;
}

function subscribe(fn){
  if(typeof fn !== 'function') return ()=>{};
  listeners.add(fn);
  return ()=>listeners.delete(fn);
}

function checkSeasonEvents(prev, next){
  if(!prev || !next) return;
  if(prev.season !== next.season){
    emit('seasonChanged', {from: prev.season, to: next.season, label: next.label});
  }
}

function worldGen(){
  return root.MM && root.MM.worldGen ? root.MM.worldGen : null;
}
function worldSeed(){
  const wg = worldGen();
  return wg && Number.isFinite(wg.worldSeed) ? wg.worldSeed | 0 : 1;
}
function seaLevel(){
  const wg = worldGen();
  return wg && wg.settings && Number.isFinite(wg.settings.seaLevel) ? wg.settings.seaLevel : 62;
}
function surfaceHeight(x, getTile){
  const wg = worldGen();
  try{ if(wg && typeof wg.surfaceHeight === 'function') return wg.surfaceHeight(Math.round(x)); }catch(e){}
  if(typeof getTile === 'function'){
    for(let y = 1; y < WORLD_H - 1; y++){
      const t = getTile(x, y);
      if(!skyOpenTile(t) && t !== T.WATER) return y;
    }
  }
  return seaLevel();
}
function baseTemperature(x){
  const wg = worldGen();
  try{ if(wg && typeof wg.temperature === 'function') return wg.temperature(Math.round(x)); }catch(e){}
  return 0.5;
}
function cycleInfo(){
  const bg = root.MM && root.MM.background;
  if(bg && typeof bg.getCycleInfo === 'function'){
    try{
      const c = bg.getCycleInfo();
      if(c && typeof c.isDay === 'boolean' && Number.isFinite(c.tDay)) return c;
    }catch(e){}
  }
  return null;
}
function diurnalTemperatureDelta(info){
  const c = info || cycleInfo();
  if(!c) return 0;
  const t = clamp(finiteNumber(c.tDay, 0.5), 0, 1);
  const sun = Math.sin(t * Math.PI);
  // Smaller than the cloud model's air swing: terrain changes should lag behind
  // weather, but winter nights and warm middays still matter mechanically.
  return c.isDay ? (-0.025 + 0.105 * sun) : (-0.075 - 0.075 * sun);
}
function currentDiurnalTemperatureDelta(){ return diurnalTemperatureDelta(cycleInfo()); }
function temperatureAt(x, row, baseTemp, prof, dayTempDelta){
  const clim = Number.isFinite(baseTemp) ? baseTemp : baseTemperature(x);
  const lapse = Math.max(0, seaLevel() - finiteNumber(row, seaLevel())) * 0.004;
  const p = prof || profile();
  const daily = Number.isFinite(dayTempDelta) ? dayTempDelta : currentDiurnalTemperatureDelta();
  return clim + finiteNumber(p.temperatureDelta, 0) + daily - lapse;
}

function isGas(t){
  const info = INFO[t];
  return !!(info && info.gas);
}
function skyOpenTile(t){
  return t === T.AIR || isLeaf(t) || isGas(t);
}
function skyExposed(x, y, getTile, maxScan){
  if(typeof getTile !== 'function') return true;
  const limit = Math.max(4, maxScan || 36);
  for(let yy = y - 1, n = 0; yy >= 0 && n < limit; yy--, n++){
    const t = getTile(x, yy);
    if(!skyOpenTile(t) && t !== T.WATER) return false;
  }
  return true;
}
function wakeWater(x, y, getTile){
  try{ if(root.MM.water && root.MM.water.onTileChanged) root.MM.water.onTileChanged(x, y, getTile); }catch(e){}
}
function notifyTileChanged(x, y, old, tile, getTile){
  if(old === T.WATER || tile === T.WATER || old === T.ICE || tile === T.ICE) wakeWater(x, y, getTile);
}
function replaceTile(x, y, tile, getTile, setTile){
  if(!Number.isFinite(x) || !Number.isFinite(y) || y < 0 || y >= WORLD_H) return false;
  if(typeof getTile !== 'function' || typeof setTile !== 'function') return false;
  const old = getTile(x, y);
  if(old === tile) return false;
  setTile(x, y, tile);
  if(getTile(x, y) !== tile) return false;
  notifyTileChanged(x, y, old, tile, getTile);
  return true;
}
function hash01(x, y, salt){
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
function seasonalPass(strength, x, y, salt, base, gain, epochSeconds){
  const s = clamp(finiteNumber(strength, 0), 0, 1);
  if(s >= 0.98) return true;
  const chance = clamp((base || 0) + s * (gain || 0), 0, 0.95);
  const epoch = Math.floor(elapsedSeconds / Math.max(0.5, finiteNumber(epochSeconds, CFG.effectEpochSeconds)));
  const seedSalt = (worldSeed() ^ Math.imul(epoch + 1, 2654435761)) | 0;
  return hash01(x, y, salt ^ seedSalt) < chance;
}

function columnContext(x, getTile, metrics, dayTempDelta){
  const surf = surfaceHeight(x, getTile);
  const baseTemp = baseTemperature(x);
  if(metrics){
    metrics.surfaceLookups++;
    metrics.tempLookups++;
  }
  return {surface: surf, baseTemp, dayTempDelta: Number.isFinite(dayTempDelta) ? dayTempDelta : currentDiurnalTemperatureDelta()};
}

function resolveSurface(x, getTile, ctx){
  if(ctx && Number.isFinite(ctx.surface)) return ctx.surface;
  if(Number.isFinite(ctx)) return ctx;
  return surfaceHeight(x, getTile);
}

function columnTemp(x, y, prof, ctx){
  return temperatureAt(
    x,
    y,
    ctx && Number.isFinite(ctx.baseTemp) ? ctx.baseTemp : undefined,
    prof,
    ctx && Number.isFinite(ctx.dayTempDelta) ? ctx.dayTempDelta : undefined
  );
}

function scanBounds(surf, above, below){
  return {
    y0: Math.max(1, Math.floor(surf - above)),
    y1: Math.min(WORLD_H - 2, Math.floor(surf + below)),
  };
}

function applyFreezeColumn(x, getTile, setTile, prof, ctx, epochSeconds){
  prof = prof || profile();
  const strength = clamp(finiteNumber(prof.freezeStrength, 0), 0, 1);
  if(strength <= 0.04) return false;
  const surf = resolveSurface(x, getTile, ctx);
  const {y0, y1} = scanBounds(surf, CFG.surfaceAbove, CFG.surfaceBelow);
  for(let y = y0; y <= y1; y++){
    if(getTile(x, y) !== T.WATER) continue;
    if(getTile(x, y - 1) === T.WATER) continue;
    const above = getTile(x, y - 1);
    if(!skyOpenTile(above) && above !== T.SNOW) continue;
    if(columnTemp(x, y, prof, ctx) > CFG.freezeTemp + (1 - strength) * 0.08) return false;
    if(!seasonalPass(strength, x, y, 101, 0.10, 0.58, epochSeconds)) return false;
    return replaceTile(x, y, T.ICE, getTile, setTile);
  }
  return false;
}

function applyThawColumn(x, getTile, setTile, prof, ctx, epochSeconds){
  prof = prof || profile();
  const strength = clamp(finiteNumber(prof.thawStrength, 0), 0, 1);
  if(strength <= 0.04) return false;
  const surf = resolveSurface(x, getTile, ctx);
  const {y0, y1} = scanBounds(surf, CFG.surfaceAbove, CFG.surfaceBelow);
  for(let y = y0; y <= y1; y++){
    if(getTile(x, y) !== T.ICE) continue;
    if(columnTemp(x, y, prof, ctx) < CFG.thawTemp - strength * 0.05) continue;
    if(!skyExposed(x, y, getTile, 40)) continue;
    if(!seasonalPass(strength, x, y, 211, 0.08, 0.45, epochSeconds)) return false;
    return replaceTile(x, y, T.WATER, getTile, setTile);
  }
  return false;
}

function applySnowColumn(x, getTile, setTile, prof, ctx, epochSeconds){
  prof = prof || profile();
  const strength = clamp(finiteNumber(prof.snowStrength, 0), 0, 1);
  if(strength <= 0.05) return false;
  const surf = resolveSurface(x, getTile, ctx);
  const y = Math.max(1, Math.min(WORLD_H - 2, Math.floor(surf)));
  const t = getTile(x, y);
  if(t !== T.GRASS && t !== T.MUD) return false;
  if(!skyExposed(x, y, getTile, 42)) return false;
  if(columnTemp(x, y, prof, ctx) > CFG.snowTemp + (1 - strength) * 0.06) return false;
  if(!seasonalPass(strength, x, y, 151, 0.05, 0.46, epochSeconds)) return false;
  return replaceTile(x, y, T.SNOW, getTile, setTile);
}

function applySnowMeltColumn(x, getTile, setTile, prof, ctx, epochSeconds){
  prof = prof || profile();
  const strength = clamp(finiteNumber(prof.snowMeltStrength, 0), 0, 1);
  if(strength <= 0.05) return false;
  const surf = resolveSurface(x, getTile, ctx);
  const {y0, y1} = scanBounds(surf, 3, 5);
  for(let y = y0; y <= y1; y++){
    if(getTile(x, y) !== T.SNOW) continue;
    if(!skyExposed(x, y, getTile, 40)) continue;
    if(columnTemp(x, y, prof, ctx) < CFG.snowMeltTemp - strength * 0.06) continue;
    if(!seasonalPass(strength, x, y, 251, 0.06, 0.44, epochSeconds)) return false;
    const below = getTile(x, y + 1);
    const next = below === T.WATER || below === T.ICE ? T.WATER : T.GRASS;
    return replaceTile(x, y, next, getTile, setTile);
  }
  return false;
}

function springLeafOffsets(){
  return [
    [0, -3], [-1, -2], [0, -2], [1, -2],
    [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
    [-1, 0], [1, 0], [0, 1],
  ];
}
const LEAF_OFFSETS = springLeafOffsets();

function applySpringLeavesColumn(x, getTile, setTile, prof, ctx, epochSeconds){
  prof = prof || profile();
  const strength = clamp(finiteNumber(prof.leafGrowStrength, 0), 0, 1);
  if(strength <= 0.05) return false;
  const surf = resolveSurface(x, getTile, ctx);
  const y0 = Math.max(2, Math.floor(surf - 18));
  const y1 = Math.min(WORLD_H - 3, Math.floor(surf + 4));
  for(let y = y0; y <= y1; y++){
    if(getTile(x, y) !== T.WOOD) continue;
    if(!skyExposed(x, y, getTile, 32)) continue;
    if(columnTemp(x, y, prof, ctx) < 0.30) continue;
    if(!seasonalPass(strength, x, y, 307, 0.04, 0.38, epochSeconds)) continue;
    for(const [ox, oy] of LEAF_OFFSETS){
      const tx = x + ox, ty = y + oy;
      if(ty <= 1 || ty >= WORLD_H - 1) continue;
      const cur = getTile(tx, ty);
      if(isAutumnLeaf(cur)){
        if(!skyExposed(tx, ty, getTile, 30)) continue;
        return replaceTile(tx, ty, T.LEAF, getTile, setTile);
      }
      if(cur !== T.AIR) continue;
      if(!skyExposed(tx, ty, getTile, 30)) continue;
      return replaceTile(tx, ty, T.LEAF, getTile, setTile);
    }
  }
  return false;
}

function autumnLeafColor(x, y){
  return hash01(x, y, 719 ^ worldSeed()) < 0.58 ? T.AUTUMN_LEAF_ORANGE : T.AUTUMN_LEAF_RED;
}

function dropAutumnLeaf(x, y, tile, getTile, setTile){
  const trees = root.MM && root.MM.trees;
  if(trees && typeof trees.dropSeasonalLeaf === 'function'){
    try{ if(trees.dropSeasonalLeaf(x, y, tile, getTile, setTile)) return true; }catch(e){}
  }
  return replaceTile(x, y, T.AIR, getTile, setTile);
}

function applyAutumnLeavesColumn(x, getTile, setTile, prof, ctx, epochSeconds){
  prof = prof || profile();
  const strength = clamp(finiteNumber(prof.leafDropStrength, 0), 0, 1);
  if(strength <= 0.05) return false;
  const surf = resolveSurface(x, getTile, ctx);
  const y0 = Math.max(1, Math.floor(surf - 28));
  const y1 = Math.min(WORLD_H - 2, Math.floor(surf + 8));
  for(let y = y0; y <= y1; y++){
    const tile = getTile(x, y);
    if(tile === T.LEAF){
      if(strength < 0.45) continue;
      if(!skyExposed(x, y, getTile, 28)) continue;
      if(!seasonalPass(strength, x, y, 397, 0.08, 0.42, epochSeconds)) return false;
      return replaceTile(x, y, autumnLeafColor(x, y), getTile, setTile);
    }
    if(!isAutumnLeaf(tile)) continue;
    if(!skyExposed(x, y, getTile, 28)) continue;
    if(!seasonalPass(strength, x, y, 401, 0.04, 0.34, epochSeconds)) return false;
    return dropAutumnLeaf(x, y, tile, getTile, setTile);
  }
  return false;
}

function playerScanCenter(player){
  const p = player || root.player || {};
  return Math.floor(finiteNumber(p.x, 0));
}

function queueRelocationBurst(player, sc){
  const cx = playerScanCenter(player);
  if(lastScanCenterX == null){
    lastScanCenterX = cx;
    return false;
  }
  const dist = Math.abs(cx - lastScanCenterX);
  if(!(sc && sc.relocationDistance > 0) || dist < sc.relocationDistance) return false;
  lastScanCenterX = cx;
  scanCursor = 0;
  relocationBurstRemaining = Math.max(relocationBurstRemaining, sc.relocationScans);
  return true;
}

function recentFrameMs(){
  return finiteNumber(root.__mmFrameMs, 0);
}

function deferSeasonScan(sc){
  if(!sc || !(sc.slowFrameSkipMs > 0)) return false;
  const ms = recentFrameMs();
  return ms > sc.slowFrameSkipMs;
}

function markDeferredScan(reason){
  const m = emptyScanMetrics();
  m.deferred = true;
  m.deferReason = reason || '';
  lastScan = m;
  return m;
}

function runScan(getTile, setTile, player, opts){
  if(typeof getTile !== 'function' || typeof setTile !== 'function') return;
  const sc = scanConfig();
  const started = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  const cx = playerScanCenter(player);
  const prof = profile();
  const dayTempDelta = currentDiurnalTemperatureDelta();
  const cols = safeInt(opts && opts.cols, sc.cols, 1, Math.min(160, sc.span));
  const maxOps = safeInt(opts && opts.maxOps, sc.maxOps, 1, 64);
  const maxLeafOps = safeInt(opts && opts.maxLeafOps, sc.maxLeafOps, 0, Math.min(16, maxOps));
  let ops = 0;
  let leafOps = 0;
  const metrics = emptyScanMetrics();
  metrics.cursor = scanCursor;
  metrics.relocation = !!(opts && opts.relocation);
  for(let i = 0; i < cols; i++){
    const wx = cx - sc.radius + ((scanCursor + i) % sc.span);
    const ctx = columnContext(wx, getTile, metrics, dayTempDelta);
    metrics.columns++;
    if(ops < maxOps && applyFreezeColumn(wx, getTile, setTile, prof, ctx, sc.epochSeconds)){ ops++; metrics.changed.freeze++; }
    if(ops < maxOps && applyThawColumn(wx, getTile, setTile, prof, ctx, sc.epochSeconds)){ ops++; metrics.changed.thaw++; }
    if(ops < maxOps && applySnowColumn(wx, getTile, setTile, prof, ctx, sc.epochSeconds)){ ops++; metrics.changed.snow++; }
    if(ops < maxOps && applySnowMeltColumn(wx, getTile, setTile, prof, ctx, sc.epochSeconds)){ ops++; metrics.changed.snowMelt++; }
    if(ops < maxOps && leafOps < maxLeafOps && applySpringLeavesColumn(wx, getTile, setTile, prof, ctx, sc.epochSeconds)){ ops++; leafOps++; metrics.changed.leafGrow++; }
    if(ops < maxOps && leafOps < maxLeafOps && applyAutumnLeavesColumn(wx, getTile, setTile, prof, ctx, sc.epochSeconds)){ ops++; leafOps++; metrics.changed.leafDrop++; }
    if(ops >= maxOps) break;
  }
  scanCursor = (scanCursor + cols) % sc.span;
  metrics.ops = ops;
  metrics.leafOps = leafOps;
  metrics.deferred = ops >= maxOps || leafOps >= maxLeafOps;
  if(started) metrics.ms = +Math.max(0, (performance.now() - started)).toFixed(3);
  lastScan = metrics;
  return metrics;
}

function update(dt, getTile, setTile, player){
  if(!enabled) return;
  if(!(dt > 0) || !Number.isFinite(dt)) return;
  const prevState = currentState();
  elapsedSeconds += Math.min(dt, 0.2);
  cachedState = null;
  cachedAt = -1;
  const nextState = currentState();
  checkSeasonEvents(prevState, nextState);
  if(typeof getTile !== 'function' || typeof setTile !== 'function') return;
  const sc = scanConfig();
  queueRelocationBurst(player, sc);
  scanAcc += dt;
  let passes = 0;
  if(scanAcc >= sc.interval){
    scanAcc = 0;
    passes = 1;
  }
  if(relocationBurstRemaining > 0){
    passes = Math.max(passes, Math.min(sc.relocationPassesPerTick, relocationBurstRemaining));
  }
  if(passes <= 0) return;
  if(deferSeasonScan(sc)){
    scanAcc = Math.min(scanAcc, sc.interval * 0.75);
    markDeferredScan('frame');
    return;
  }
  for(let i = 0; i < passes; i++){
    const relocation = relocationBurstRemaining > 0;
    runScan(getTile, setTile, player, relocation ? {
      cols: sc.relocationCols,
      maxOps: sc.relocationMaxOps,
      maxLeafOps: sc.relocationMaxLeafOps,
      relocation: true,
    } : null);
    if(relocation) relocationBurstRemaining = Math.max(0, relocationBurstRemaining - 1);
  }
}

function scanNow(getTile, setTile, player){
  if(!enabled) return null;
  const m = runScan(getTile, setTile, player);
  if(m) emit('scanDebug', {columns: m.columns, ops: m.ops, changed: Object.assign({}, m.changed)});
  return m || null;
}

function setEnabled(value){
  const next = value !== false;
  if(enabled === next) return true;
  enabled = next;
  scanAcc = 0;
  lastScan = emptyScanMetrics();
  cachedState = null;
  cachedAt = -1;
  emit(next ? 'seasonEnabled' : 'seasonDisabled', {enabled: next});
  return true;
}

function isEnabled(){ return enabled; }

function reset(){
  elapsedSeconds = 0;
  scanAcc = 0;
  scanCursor = 0;
  lastScanCenterX = null;
  relocationBurstRemaining = 0;
  forcedSeason = null;
  enabled = true;
  cachedState = null;
  cachedAt = -1;
  lastScan = emptyScanMetrics();
  recentEvents.length = 0;
}

function snapshot(){
  return {
    v: 2,
    elapsedSeconds: +elapsedSeconds.toFixed(3),
    scanCursor: scanCursor | 0,
  };
}

function restore(data){
  reset();
  if(!data || typeof data !== 'object') return false;
  elapsedSeconds = clamp(finiteNumber(data.elapsedSeconds, 0), 0, 60 * 60 * 24 * 3650);
  scanCursor = safeInt(data.scanCursor, 0, 0, 4096);
  return true;
}

function scanMetricsSnapshot(scan, relocationRemaining){
  const s = scan || emptyScanMetrics();
  return {
    columns: s.columns | 0,
    ops: s.ops | 0,
    leafOps: s.leafOps | 0,
    surfaceLookups: s.surfaceLookups | 0,
    tempLookups: s.tempLookups | 0,
    cursor: s.cursor | 0,
    ms: +finiteNumber(s.ms, 0).toFixed(3),
    relocation: !!s.relocation,
    deferred: !!s.deferred,
    deferReason: String(s.deferReason || ''),
    relocationRemaining: relocationRemaining | 0,
    changed: Object.assign({}, s.changed),
  };
}

function metrics(){
  const s = currentState();
  const p = s.profile;
  if(!enabled){
    return {
      day: s.day,
      dayFloat: +s.dayFloat.toFixed(2),
      seasonDay: +s.seasonDay.toFixed(2),
      season: 'off',
      label: DISABLED_PROFILE.label,
      transition: false,
      from: s.season,
      to: s.season,
      blend: 1,
      nextInDays: 0,
      temperatureDelta: 0,
      diurnalTemperatureDelta: 0,
      animalSpawnMult: 1,
      windMult: 1,
      stormChanceMult: 1,
      rainRateMult: 1,
      freezeStrength: 0,
      thawStrength: 0,
      snowStrength: 0,
      snowMeltStrength: 0,
      leafGrowStrength: 0,
      leafDropStrength: 0,
      scan: scanMetricsSnapshot(null, 0),
      events: recentEvents.slice(-6),
      forced: !!s.forced,
      enabled: false,
    };
  }
  return {
    day: s.day,
    dayFloat: +s.dayFloat.toFixed(2),
    seasonDay: +s.seasonDay.toFixed(2),
    season: s.season,
    label: s.label,
    transition: s.transition,
    from: s.from,
    to: s.to,
    blend: +s.blend.toFixed(3),
    nextInDays: +s.nextInDays.toFixed(2),
    temperatureDelta: +finiteNumber(p.temperatureDelta, 0).toFixed(3),
    diurnalTemperatureDelta: +currentDiurnalTemperatureDelta().toFixed(3),
    animalSpawnMult: +finiteNumber(p.animalSpawnMult, 1).toFixed(3),
    windMult: +finiteNumber(p.windMult, 1).toFixed(3),
    stormChanceMult: +finiteNumber(p.stormChanceMult, 1).toFixed(3),
    rainRateMult: +finiteNumber(p.rainRateMult, 1).toFixed(3),
    freezeStrength: +finiteNumber(p.freezeStrength, 0).toFixed(3),
    thawStrength: +finiteNumber(p.thawStrength, 0).toFixed(3),
    snowStrength: +finiteNumber(p.snowStrength, 0).toFixed(3),
    snowMeltStrength: +finiteNumber(p.snowMeltStrength, 0).toFixed(3),
    leafGrowStrength: +finiteNumber(p.leafGrowStrength, 0).toFixed(3),
    leafDropStrength: +finiteNumber(p.leafDropStrength, 0).toFixed(3),
    scan: scanMetricsSnapshot(lastScan, relocationBurstRemaining),
    events: recentEvents.slice(-6),
    forced: !!s.forced,
    enabled: true,
  };
}

function normalizeSeasonId(id){
  let raw = String(id == null ? '' : id).trim().toLowerCase();
  try{ raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }catch(e){}
  return SEASON_ALIASES[raw] || raw;
}

function forceSeason(id){
  if(id == null || id === 'natural'){
    const was = forcedSeason;
    forcedSeason = null;
    cachedState = null;
    cachedAt = -1;
    if(was) emit('seasonNatural', {from: was, to: currentState().season, label: currentState().label});
    return true;
  }
  const key = normalizeSeasonId(id);
  if(!BASE_PROFILES[key]) return false;
  const was = currentState().season;
  forcedSeason = key;
  cachedState = null;
  cachedAt = -1;
  emit('seasonForced', {from: was, to: key, label: seasonByIndex(SEASON_ORDER.indexOf(key)).label});
  return true;
}

function setDay(day){
  const prev = currentState();
  const d = Math.max(1, finiteNumber(day, 1));
  elapsedSeconds = (d - 1) * DAY_SECONDS;
  cachedState = null;
  cachedAt = -1;
  checkSeasonEvents(prev, currentState());
  return true;
}

function advanceDays(days){
  const n = finiteNumber(days, 0);
  if(!Number.isFinite(n) || n === 0) return false;
  return setDay(elapsedSeconds / DAY_SECONDS + 1 + n);
}

function jumpToNextTransition(){
  const prev = currentState();
  forcedSeason = null;
  const totalDays = Math.max(0, elapsedSeconds / DAY_SECONDS);
  const seasonNumber = Math.floor(totalDays / DAYS_PER_SEASON);
  const seasonStart = seasonNumber * DAYS_PER_SEASON;
  const dayInSeason = totalDays - seasonStart;
  let targetDays;
  if(dayInSeason >= DAYS_PER_SEASON - HALF_TRANSITION_DAYS){
    targetDays = (seasonNumber + 1) * DAYS_PER_SEASON + HALF_TRANSITION_DAYS * 0.5;
  } else {
    targetDays = seasonStart + DAYS_PER_SEASON - HALF_TRANSITION_DAYS * 0.5;
  }
  elapsedSeconds = clamp(targetDays * DAY_SECONDS, 0, 60 * 60 * 24 * 3650);
  cachedState = null;
  cachedAt = -1;
  const next = currentState();
  checkSeasonEvents(prev, next);
  emit('transitionJump', {from: next.from, to: next.to, label: next.label, blend: +next.blend.toFixed(3)});
  return true;
}

function eventPlayer(opts){
  const p = opts && opts.player ? opts.player : root.player;
  return p && Number.isFinite(p.x) ? p : {x: 0, y: seaLevel()};
}
function addEventClouds(px, count, mass, spread){
  const clouds = root.MM && root.MM.clouds;
  if(!clouds || typeof clouds.addCloud !== 'function') return 0;
  let made = 0;
  const n = safeInt(count, 1, 0, 8);
  const s = clamp(finiteNumber(spread, 120), 10, 420);
  for(let i = 0; i < n; i++){
    const off = n <= 1 ? 0 : (-s * 0.5 + s * (i / Math.max(1, n - 1)));
    const jitter = (hash01(Math.round(px), i, 913) - 0.5) * s * 0.22;
    const c = clouds.addCloud(px + off + jitter, null, mass);
    if(c) made++;
  }
  return made;
}
function forceSeasonEvent(id, opts){
  if(!enabled) return false;
  const key = normalizeSeasonId(id || currentState().season);
  if(!BASE_PROFILES[key]) return false;
  const p = eventPlayer(opts || {});
  const clouds = root.MM && root.MM.clouds;
  const wind = root.MM && root.MM.wind;
  const dir = p && p.facing < 0 ? -1 : 1;
  let ok = false;
  let event = key;
  if(key === 'spring'){
    event = 'spring-rain';
    if(clouds && typeof clouds.startStorm === 'function'){ clouds.startStorm(58, 0.55); ok = true; }
    ok = addEventClouds(p.x, 3, 10, 150) > 0 || ok;
    if(wind && typeof wind.forceSquall === 'function') ok = wind.forceSquall(dir, 1.45, 24) || ok;
  } else if(key === 'summer'){
    event = 'summer-storm';
    if(clouds && typeof clouds.startStorm === 'function'){ clouds.startStorm(92, 1); ok = true; }
    ok = addEventClouds(p.x, 4, 16, 190) > 0 || ok;
    if(wind && typeof wind.forceSquall === 'function') ok = wind.forceSquall(dir, 3.6, 34) || ok;
  } else if(key === 'autumn'){
    event = 'autumn-gale';
    if(wind && typeof wind.forceSquall === 'function') ok = wind.forceSquall(dir, 4.7, 56) || ok;
    if(clouds && typeof clouds.startStorm === 'function'){ clouds.startStorm(42, 0.45); ok = true; }
    ok = addEventClouds(p.x, 2, 8, 180) > 0 || ok;
  } else if(key === 'winter'){
    event = 'winter-blizzard';
    if(wind && typeof wind.forceSquall === 'function') ok = wind.forceSquall(dir, 3.8, 70) || ok;
    if(clouds && typeof clouds.startStorm === 'function'){ clouds.startStorm(72, 0.62); ok = true; }
    ok = addEventClouds(p.x, 3, 12, 170) > 0 || ok;
  }
  if(ok) emit('seasonEventForced', {season: key, event});
  return ok;
}

const api = {
  update,
  reset,
  snapshot,
  restore,
  profile,
  metrics,
  temperatureAt,
  forceSeason,
  setEnabled,
  isEnabled,
  setDay,
  advanceDays,
  jumpToNextTransition,
  forceSeasonEvent,
  scanNow,
  subscribe,
  config: CFG,
  constants: {DAY_SECONDS, DAYS_PER_SEASON, TRANSITION_DAYS},
  _debug: {
    stateAtDays,
    seasonOrder: SEASON_ORDER,
    baseProfiles: BASE_PROFILES,
    applyFreezeColumn,
    applyThawColumn,
    applySnowColumn,
    applySnowMeltColumn,
    applySpringLeavesColumn,
    applyAutumnLeavesColumn,
    queueRelocationBurst,
    columnContext,
    diurnalTemperatureDelta,
    forceSeasonEvent,
  },
};

root.MM.seasons = api;

export const seasons = api;
export default seasons;
