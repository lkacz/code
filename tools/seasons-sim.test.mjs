import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {
  worldGen: {
    temperature: () => 0.55,
    surfaceHeight: () => 12,
    settings: {seaLevel: 62},
  },
  water: {onTileChanged(){ waterWakes++; }},
};

let waterWakes = 0;
const { T } = await import('../src/constants.js');
const { seasons } = await import('../src/engine/seasons.js');

assert.ok(seasons, 'seasons module exports');
assert.equal(seasons.constants.DAYS_PER_SEASON, 10, 'season calendar changes every 10 days');
assert.equal(seasons.constants.TRANSITION_DAYS, 2, 'season effects blend over a two-day boundary');

const springStart = seasons._debug.stateAtDays(0);
assert.equal(springStart.season, 'spring', 'new worlds start in spring');
assert.equal(springStart.profile.leafGrowStrength, 0, 'seasonal leaf growth is disabled');
assert.equal(Object.isFrozen(seasons.profile()), true, 'public season profile is immutable');
assert.equal(seasons.metrics().terrainEffectsEnabled, true, 'automatic seasonal terrain mutations use the safe terrain job by default');

const justBeforeSummer = seasons._debug.stateAtDays(10 - 1e-6);
const atSummerBoundary = seasons._debug.stateAtDays(10);
assert.equal(justBeforeSummer.transition, true, 'last day before a season boundary is a transition');
assert.equal(atSummerBoundary.transition, true, 'first day after a season boundary is still transitioning');
assert.ok(Math.abs(justBeforeSummer.profile.temperatureDelta - atSummerBoundary.profile.temperatureDelta) < 1e-6,
  'temperature is continuous across the season flip');
assert.ok(Math.abs(justBeforeSummer.profile.windMult - atSummerBoundary.profile.windMult) < 1e-6,
  'wind multiplier is continuous across the season flip');
assert.ok(seasons._debug.stateAtDays(11).profile.windMult < 0.25, 'summer eventually becomes nearly calm');
assert.ok(seasons._debug.stateAtDays(29).profile.windMult > 1.2, 'autumn transition ramps toward strong wind');
assert.ok(seasons._debug.stateAtDays(21).profile.animalSpawnMult < 0.8, 'autumn reduces animal abundance after the blend');
assert.ok(seasons._debug.stateAtDays(31).profile.freezeStrength > 0.9, 'winter becomes fully freezing after its blend');

const oldBackground = MM.background;
const springProfile = seasons._debug.baseProfiles.spring;
MM.background = {getCycleInfo(){ return {cycleT:0.25, isDay:true, tDay:0.5}; }};
const noonTemp = seasons.temperatureAt(0, 62, 0.55, springProfile);
assert.ok(seasons.metrics().diurnalTemperatureDelta > 0.07, 'season metrics expose warm midday terrain temperature');
MM.background = {getCycleInfo(){ return {cycleT:0.75, isDay:false, tDay:0.5}; }};
const nightTemp = seasons.temperatureAt(0, 62, 0.55, springProfile);
assert.ok(seasons.metrics().diurnalTemperatureDelta < -0.12, 'season metrics expose cold midnight terrain temperature');
assert.ok(noonTemp - nightTemp > 0.20, 'seasonal terrain temperature follows the day/night cycle');
MM.background = oldBackground;

let tiles;
const key = (x, y) => x + ',' + y;
const getTile = (x, y) => {
  if(y < 0 || y >= 140) return T.STONE;
  return tiles.get(key(x, y)) ?? T.AIR;
};
const setTile = (x, y, t) => {
  if(t === T.AIR) tiles.delete(key(x, y));
  else tiles.set(key(x, y), t);
};
function resetTiles(){
  tiles = new Map();
  waterWakes = 0;
  seasons.reset();
}

resetTiles();
setTile(0, 10, T.WATER);
setTile(0, 11, T.STONE);
seasons.forceSeason('winter');
const beforeDisabledDay = seasons.metrics().dayFloat;
assert.equal(seasons.setEnabled(false), true, 'debug can disable the seasonal system');
assert.equal(seasons.isEnabled(), false, 'disabled seasonal system reports its toggle state');
assert.equal(seasons.metrics().enabled, false, 'season metrics expose disabled state');
assert.equal(seasons.metrics().season, 'off', 'disabled season metrics hide active season from consumers');
assert.equal(seasons.profile().id, 'off', 'disabled season profile is neutral');
assert.equal(Object.isFrozen(seasons.profile()), true, 'disabled season profile is immutable');
assert.equal(seasons.profile().windMult, 1, 'disabled season profile neutralizes wind multiplier');
assert.equal(seasons.profile().freezeStrength, 0, 'disabled season profile neutralizes terrain effects');
seasons.update(0.25, getTile, setTile, {x:0, y:9});
assert.equal(getTile(0, 10), T.WATER, 'disabled seasonal system skips terrain scanner mutations');
assert.equal(seasons.metrics().dayFloat, beforeDisabledDay, 'disabled seasonal system pauses its calendar clock');
assert.equal(seasons.scanNow(getTile, setTile, {x:96, y:9}), null, 'disabled seasonal scan-now is a no-op');
assert.equal(seasons.forceSeasonEvent('winter', {player:{x:12, y:8, facing:1}}), false, 'disabled seasonal system blocks forced seasonal events');
assert.equal(seasons.setEnabled(true), true, 'debug can re-enable the seasonal system');
assert.equal(seasons.isEnabled(), true, 're-enabled seasonal system reports active state');
seasons.update(0.25, getTile, setTile, {x:4, y:9});
assert.equal(getTile(0, 10), T.ICE, 're-enabled seasonal system resumes terrain mutations through the safe terrain job');
assert.ok(seasons.metrics().terrain.prepared >= 1, 'safe terrain job prepares candidates before applying them');
assert.ok(seasons.metrics().terrain.applied >= 1, 'safe terrain job applies candidates through the bounded commit path');

resetTiles();
setTile(0, 10, T.WATER);
setTile(0, 11, T.STONE);
assert.equal(seasons.forceSeason('zima'), true, 'debug forcing accepts Polish season names');
assert.equal(seasons.metrics().season, 'winter', 'Polish debug alias maps to winter');
assert.equal(seasons.forceSeason('jesie\u0144'), true, 'debug forcing normalizes accented Polish season names');
assert.equal(seasons.metrics().season, 'autumn', 'accented Polish debug alias maps to autumn');
seasons.forceSeason('winter');
seasons.scanNow(getTile, setTile, {x:96, y:9});
assert.equal(getTile(0, 10), T.ICE, 'winter freezes exposed water near the active world');
assert.ok(waterWakes > 0, 'freezing wakes adjacent water simulation');

resetTiles();
setTile(0, 10, T.WATER);
setTile(0, 11, T.STONE);
seasons.forceSeason('winter');
const beforeScanDay = seasons.metrics().dayFloat;
const scanMetrics = seasons.scanNow(getTile, setTile, {x:96, y:9});
assert.equal(getTile(0, 10), T.ICE, 'debug scan-now applies the same winter freeze scanner immediately');
assert.ok(scanMetrics && scanMetrics.ops <= seasons.config.maxOpsPerTick, 'debug scan-now respects the bounded mutation budget');
assert.equal(seasons.metrics().dayFloat, beforeScanDay, 'debug scan-now does not advance the season clock');

resetTiles();
setTile(0, 10, T.WATER);
setTile(0, 11, T.STONE);
let surfaceCalls = 0;
let tempCalls = 0;
const oldSurfaceHeight = MM.worldGen.surfaceHeight;
const oldTemperature = MM.worldGen.temperature;
MM.worldGen.surfaceHeight = () => { surfaceCalls++; return 12; };
MM.worldGen.temperature = () => { tempCalls++; return 0.55; };
try{
  seasons.forceSeason('winter');
  seasons.scanNow(getTile, setTile, {x:96, y:9});
  assert.ok(surfaceCalls <= 25, 'season scanner reuses one surface lookup per scanned column');
  assert.ok(tempCalls <= 25, 'season scanner reuses one temperature lookup per scanned column');
} finally {
  MM.worldGen.surfaceHeight = oldSurfaceHeight;
  MM.worldGen.temperature = oldTemperature;
}

resetTiles();
setTile(0, 10, T.ICE);
setTile(0, 11, T.STONE);
seasons.forceSeason('spring');
seasons.scanNow(getTile, setTile, {x:96, y:9});
assert.equal(getTile(0, 10), T.WATER, 'spring thaws exposed lake ice back into water where the basin can hold it');

resetTiles();
setTile(0, 10, T.ICE);
setTile(0, 11, T.STONE);
seasons.forceSeason('summer');
seasons.scanNow(getTile, setTile, {x:96, y:9});
assert.equal(getTile(0, 10), T.WATER, 'warm seasons thaw exposed ice back into water');

resetTiles();
setTile(0, 12, T.GRASS);
setTile(0, 13, T.STONE);
seasons.forceSeason('winter');
seasons.scanNow(getTile, setTile, {x:96, y:9});
assert.equal(getTile(0, 12), T.SNOW, 'winter lays exposed snow over grass near the active world');

resetTiles();
setTile(0, 12, T.SNOW);
setTile(0, 13, T.STONE);
seasons.forceSeason('summer');
seasons.scanNow(getTile, setTile, {x:96, y:9});
assert.equal(getTile(0, 12), T.GRASS, 'warm seasons melt exposed seasonal snow back to grass');

resetTiles();
setTile(0, 12, T.WOOD);
setTile(0, 13, T.STONE);
seasons.forceSeason('spring');
seasons.update(0.25, getTile, setTile, {x:96, y:12});
assert.equal([...tiles.values()].includes(T.LEAF), false, 'spring no longer grows extra leaves around exposed trunks');

resetTiles();
setTile(0, 10, T.LEAF);
setTile(0, 12, T.WOOD);
setTile(0, 13, T.STONE);
seasons.forceSeason('autumn');
seasons.update(0.25, getTile, setTile, {x:96, y:12});
assert.equal(getTile(0, 10), T.LEAF, 'autumn no longer recolors exposed leaves');
seasons.reset();
seasons.forceSeason('autumn');
seasons.scanNow(getTile, setTile, {x:96, y:12});
assert.equal(getTile(0, 10), T.LEAF, 'autumn scan-now also leaves tree foliage untouched');

{
  const savedCfg = Object.assign({}, seasons.config);
  resetTiles();
  Object.assign(seasons.config, {
    autoTerrainEffects: true,
    scanRadius: 4,
    scanCols: 1,
    scanInterval: 10,
    maxOpsPerTick: 1,
    relocationBurstDistance: 5,
    relocationBurstScans: 4,
    relocationBurstCols: 9,
    relocationBurstPassesPerTick: 4,
    relocationMaxOpsPerTick: 8,
  });
  setTile(40, 10, T.LEAF);
  setTile(40, 12, T.WOOD);
  setTile(40, 13, T.STONE);
  seasons.forceSeason('autumn');
  seasons.update(0.05, getTile, setTile, {x:0, y:12});
  assert.equal(getTile(40, 10), T.LEAF, 'distant leaves are not changed before the player relocates there');
  seasons.update(0.05, getTile, setTile, {x:40, y:12});
  assert.equal(getTile(40, 10), T.LEAF, 'relocation burst does not recolor leaves');
  for(let i = 0; i < 4; i++){
    seasons.update(0.05, getTile, setTile, {x:40, y:12});
  }
  assert.equal(getTile(40, 10), T.LEAF, 'relocation burst keeps leaves untouched across follow-up ticks');
  assert.equal(seasons.metrics().scan.relocation, true, 'season metrics mark the catch-up scan as relocation-driven');
  Object.assign(seasons.config, savedCfg);
}

{
  const savedCfg = Object.assign({}, seasons.config);
  resetTiles();
  Object.assign(seasons.config, {
    autoTerrainEffects: true,
    scanRadius: 12,
    scanCols: 25,
    scanInterval: 0.01,
    maxOpsPerTick: 20,
    maxLeafOpsPerTick: 2,
    relocationBurstDistance: 5,
    relocationBurstScans: 4,
    relocationBurstCols: 25,
    relocationBurstPassesPerTick: 4,
    relocationMaxOpsPerTick: 20,
    relocationMaxLeafOpsPerTick: 3,
  });
  for(let x = 28; x <= 40; x++){
    setTile(x, 10, T.LEAF);
    setTile(x, 12, T.WOOD);
    setTile(x, 13, T.STONE);
  }
  seasons.forceSeason('autumn');
  seasons.update(0.005, getTile, setTile, {x:0, y:12});
  seasons.update(0.02, getTile, setTile, {x:34, y:12});
  const relocationScan = seasons.metrics().scan;
  assert.equal(relocationScan.relocation, true, 'travel catch-up scan is marked as relocation work');
  assert.equal(relocationScan.leafOps, 0, 'travel catch-up does not perform seasonal leaf mutations');
  assert.equal(relocationScan.changed.leafDrop, 0, 'relocation does not recolor or drop foliage');
  Object.assign(seasons.config, savedCfg);
}

{
  const savedCfg = Object.assign({}, seasons.config);
  resetTiles();
  Object.assign(seasons.config, {
    autoTerrainEffects: true,
    prepareAheadDays: 3,
    terrainPlanRadius: 12,
    terrainPlanColsPerTick: 25,
    terrainPlanMaxCandidatesPerTick: 8,
    terrainApplyInterval: 0.01,
    terrainApplyOpsPerTick: 1,
  });
  setTile(0, 10, T.WATER);
  setTile(0, 11, T.STONE);
  seasons.setDay(29);
  seasons.update(0.25, getTile, setTile, {x:4, y:9});
  assert.equal(getTile(0, 10), T.WATER, 'winter terrain can be prepared before winter without applying early');
  assert.equal(seasons.metrics().terrain.target, 'winter', 'pre-season terrain plan targets the upcoming winter');
  assert.ok(seasons.metrics().terrain.queued >= 1, 'pre-season terrain plan queues future freeze work');
  seasons.setDay(31);
  seasons.update(0.25, getTile, setTile, {x:4, y:9});
  assert.equal(getTile(0, 10), T.ICE, 'prepared winter terrain applies once winter is active');
  Object.assign(seasons.config, savedCfg);
}

{
  const savedCfg = Object.assign({}, seasons.config);
  resetTiles();
  Object.assign(seasons.config, {
    autoTerrainEffects: true,
    terrainPlanRadius: 12,
    terrainPlanColsPerTick: 25,
    terrainPlanMaxCandidatesPerTick: 8,
    terrainApplyInterval: 0.01,
    terrainApplyOpsPerTick: 1,
    terrainPlayerMarginTiles: 1.25,
  });
  setTile(0, 10, T.WATER);
  setTile(0, 11, T.STONE);
  seasons.forceSeason('winter');
  seasons.update(0.25, getTile, setTile, {x:0, y:10, w:0.7, h:0.95});
  assert.equal(getTile(0, 10), T.WATER, 'safe terrain job never mutates tiles inside the player safety bubble');
  assert.ok(seasons.metrics().terrain.playerProtected >= 1, 'terrain metrics expose player-protected skipped commits');
  seasons.update(0.25, getTile, setTile, {x:4, y:10, w:0.7, h:0.95});
  assert.equal(getTile(0, 10), T.ICE, 'player-protected terrain work applies after the player is clear');
  Object.assign(seasons.config, savedCfg);
}

{
  const savedCfg = Object.assign({}, seasons.config);
  const savedSurfaceHeight = MM.worldGen.surfaceHeight;
  const savedTemperature = MM.worldGen.temperature;
  resetTiles();
  Object.assign(seasons.config, {
    autoTerrainEffects: true,
    terrainPlanRadius: 16,
    terrainPlanColsPerTick: 25,
    terrainPlanMaxCandidatesPerTick: 8,
    terrainApplyInterval: 0.01,
    terrainApplyOpsPerTick: 1,
  });
  MM.worldGen.surfaceHeight = () => 62;
  MM.worldGen.temperature = () => 0.66;
  setTile(0, 62, T.WATER);
  setTile(0, 63, T.STONE);
  seasons.forceSeason('winter');
  seasons.update(0.25, getTile, setTile, {x:4, y:40});
  assert.equal(getTile(0, 62), T.ICE, 'full winter freezes exposed surface water in warmer terrain through the safe terrain job');
  MM.worldGen.surfaceHeight = savedSurfaceHeight;
  MM.worldGen.temperature = savedTemperature;
  Object.assign(seasons.config, savedCfg);
}

{
  const savedCfg = Object.assign({}, seasons.config);
  const savedSurfaceHeight = MM.worldGen.surfaceHeight;
  const savedTemperature = MM.worldGen.temperature;
  resetTiles();
  Object.assign(seasons.config, {
    autoTerrainEffects: true,
    effectEpochSeconds: 0.5,
    terrainPlanRadius: 16,
    terrainPlanColsPerTick: 25,
    terrainPlanMaxCandidatesPerTick: 8,
    terrainApplyInterval: 0.01,
    terrainApplyOpsPerTick: 1,
  });
  MM.worldGen.surfaceHeight = () => 62;
  setTile(0, 62, T.WATER);
  setTile(0, 63, T.STONE);
  MM.worldGen.temperature = () => 0.92;
  seasons.forceSeason('winter');
  seasons.update(0.25, getTile, setTile, {x:4, y:40});
  assert.equal(getTile(0, 62), T.WATER, 'terrain planner can initially reject water that is still too warm');
  MM.worldGen.temperature = () => 0.55;
  seasons.update(0.25, getTile, setTile, {x:4, y:40});
  seasons.update(0.25, getTile, setTile, {x:4, y:40});
  seasons.update(0.25, getTile, setTile, {x:4, y:40});
  assert.equal(getTile(0, 62), T.ICE, 'terrain planner retries climate-dependent misses instead of ignoring a column for the whole season');
  MM.worldGen.surfaceHeight = savedSurfaceHeight;
  MM.worldGen.temperature = savedTemperature;
  Object.assign(seasons.config, savedCfg);
}

{
  const savedCfg = Object.assign({}, seasons.config);
  resetTiles();
  Object.assign(seasons.config, {
    autoTerrainEffects: true,
    terrainPlanRadius: 16,
    terrainPlanColsPerTick: 25,
    terrainPlanMaxCandidatesPerTick: 16,
    terrainApplyInterval: 0.01,
    terrainApplyOpsPerTick: 1,
  });
  for(let x = -4; x <= 4; x++){
    setTile(x, 12, T.GRASS);
    setTile(x, 13, T.STONE);
  }
  setTile(4, 10, T.WATER);
  setTile(4, 11, T.STONE);
  seasons.forceSeason('winter');
  seasons.update(0.25, getTile, setTile, {x:0, y:30});
  assert.equal(getTile(4, 10), T.ICE, 'freeze terrain work is prioritized ahead of snow work so visible water is not starved');
  assert.equal(seasons.metrics().terrain.changed.freeze, 1, 'terrain metrics record the prioritized freeze operation');
  Object.assign(seasons.config, savedCfg);
}

seasons.reset();
seasons.setDay(26);
let m = seasons.metrics();
assert.equal(m.season, 'autumn', 'debug day setter lands in the expected calendar season');
assert.ok(m.scan && typeof m.scan.ops === 'number', 'season metrics expose bounded scan telemetry');
const snap = seasons.snapshot();
seasons.reset();
assert.equal(seasons.metrics().season, 'spring', 'reset returns to spring');
assert.equal(seasons.restore(snap), true, 'season clock restores from save data');
assert.equal(seasons.metrics().season, 'autumn', 'restored season clock keeps the calendar position');

const events = [];
const unsub = seasons.subscribe(e => events.push(e));
seasons.reset();
seasons.setDay(11);
unsub();
assert.ok(events.some(e => e.type === 'seasonChanged' && e.to === 'summer'), 'season clock emits season-change events for debug systems');

seasons.reset();
assert.equal(seasons.jumpToNextTransition(), true, 'debug can jump to the next smooth season transition');
m = seasons.metrics();
assert.equal(m.transition, true, 'transition jump lands inside a blended season window');
assert.ok(m.label.includes('->'), 'transition jump exposes the from-to label for debug');
assert.ok(m.events.some(e => e.type === 'transitionJump'), 'transition jump records a debug event');

let stormCalls = 0;
let cloudAdds = 0;
let squalls = 0;
const oldClouds = MM.clouds;
const oldWind = MM.wind;
MM.clouds = {
  startStorm(duration, intensity){ stormCalls++; return {duration, intensity}; },
  addCloud(){ cloudAdds++; return {ok:true}; },
};
MM.wind = {
  forceSquall(){ squalls++; return true; },
};
seasons.forceSeason('summer');
assert.equal(seasons.forceSeasonEvent(null, {player:{x:12, y:8, facing:1}}), true, 'debug can force the current season danger event');
assert.ok(stormCalls >= 1 && cloudAdds >= 1 && squalls >= 1, 'summer event drives clouds and wind through existing engines');
assert.ok(seasons.metrics().events.some(e => e.type === 'seasonEventForced' && e.event === 'summer-storm'), 'forced seasonal event is recorded in metrics');
stormCalls = 0; cloudAdds = 0; squalls = 0;
assert.equal(seasons.forceSeasonEvent('winter', {player:{x:12, y:8, facing:-1}}), true, 'debug can force a specific winter blizzard event');
assert.ok(stormCalls >= 1 && cloudAdds >= 1 && squalls >= 1, 'winter event also drives clouds and wind');
MM.clouds = oldClouds;
MM.wind = oldWind;

const oldCfg = Object.assign({}, seasons.config);
resetTiles();
setTile(0, 10, T.WATER);
setTile(0, 11, T.STONE);
Object.assign(seasons.config, {scanRadius: NaN, scanCols: Infinity, scanInterval: -5, maxOpsPerTick: Infinity});
seasons.forceSeason('winter');
assert.doesNotThrow(() => seasons.update(0.25, getTile, setTile, {x:96, y:9}), 'invalid season scan config falls back safely');
Object.assign(seasons.config, oldCfg);

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const cloudSrc = await readFile(new URL('../src/engine/clouds.js', import.meta.url), 'utf8');
const windSrc = await readFile(new URL('../src/engine/wind.js', import.meta.url), 'utf8');
const mobSrc = await readFile(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const seasonSrc = await readFile(new URL('../src/engine/seasons.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ seasons as SEASONS \}/, 'main imports the seasons engine');
assert.match(mainSrc, /seasons:\s*timedSavePart\('seasons',[^\n]*SEASONS && SEASONS\.snapshot/, 'save payload includes seasons');
assert.match(mainSrc, /SEASONS\.restore\(data\.seasons\)/, 'load path restores seasons');
assert.match(mainSrc, /SEASONS\.update\(dt, getTile, setTile, player, seasonUpdateContext\(\)\)/, 'main loop updates seasons with viewport safety context before weather systems');
assert.match(mainSrc, /function seasonUpdateContext\(\)/, 'main exposes viewport/input context for safe seasonal terrain commits');
assert.match(mainSrc, /injectSeasonDebugPanel/, 'main wires the season debug panel');
assert.match(mainSrc, /SEASONS\.scanNow\(getTile,setTile,player\)/, 'season debug panel can trigger an immediate bounded scan');
assert.match(mainSrc, /SEASONS\.jumpToNextTransition\(\)/, 'season debug panel can jump to a smooth transition');
assert.match(mainSrc, /MOBS\.spawnSeasonalHallmark/, 'season debug panel can spawn hallmark animals');
assert.match(mainSrc, /SEASONS\.forceSeasonEvent/, 'season debug panel can force seasonal danger events');
assert.match(mainSrc, /setEnabled:\(enabled\)=>/, 'main wires the seasonal debug on/off toggle');
assert.match(seasonSrc, /function setEnabled/, 'season engine exposes a debug enable toggle');
assert.match(seasonSrc, /diurnalTemperatureDelta/, 'season terrain scanner reads the day/night temperature swing');
assert.match(seasonSrc, /dayTempDelta/, 'season scanner caches the daily temperature offset per scan');
assert.match(seasonSrc, /spring-rain/, 'season engine names the spring rain event');
assert.match(seasonSrc, /summer-storm/, 'season engine names the summer storm event');
assert.match(seasonSrc, /autumn-gale/, 'season engine names the autumn gale event');
assert.match(seasonSrc, /winter-blizzard/, 'season engine names the winter blizzard event');
assert.match(cloudSrc, /temperatureDelta/, 'cloud temperatures include seasonal temperature deltas');
assert.match(cloudSrc, /stormChanceMult/, 'cloud storm chance reads seasonal multipliers');
assert.match(cloudSrc, /rainRateMult/, 'cloud rain rate reads seasonal multipliers');
assert.match(windSrc, /windMult/, 'wind model reads seasonal wind multipliers');
assert.match(windSrc, /squallChanceMult/, 'wind squalls read seasonal transition multipliers');
assert.match(mobSrc, /animalSpawnMult/, 'mob ecology reads seasonal animal abundance');
assert.match(mobSrc, /spec\.organic===false/, 'seasonal animal abundance does not affect robots or machines');
assert.match(uiSrc, /injectSeasonDebugPanel/, 'UI exposes season debug controls');
assert.match(uiSrc, /Przejscie/, 'season debug panel exposes a transition test button');
assert.match(uiSrc, /Zwierze sezonu/, 'season debug panel exposes hallmark animal spawning');
assert.match(uiSrc, /Zdarzenie sezonu/, 'season debug panel exposes current seasonal events');
assert.match(uiSrc, /seasonDebugToggle/, 'season debug panel exposes a system on-off toggle');

console.log('seasons-sim: all assertions passed');
