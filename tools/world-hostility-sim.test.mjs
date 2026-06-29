// Regression test for the long-distance world hostility gradient.
// The center stays gentle; far right gets hotter/volcanic/meteor-heavy, and far
// left gets colder/windier with ice hazards. Combat systems must read the same
// shared gradient instead of drifting into local one-off rules.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.msg = () => {};
let simNow = 0;
globalThis.performance = { now:()=>simNow };
const store = new Map();
globalThis.localStorage = {
  getItem:k=>store.has(k)?store.get(k):null,
  setItem:(k,v)=>{ store.set(k,String(v)); },
  removeItem:k=>{ store.delete(k); },
};

const { T, INFO } = await import('../src/constants.js');
const { worldHostility } = await import('../src/engine/world_hostility.js');
const { worldGen } = await import('../src/engine/worldgen.js');

const CENTER_X = 0;
const FAR_RIGHT_X = 50000;
const FAR_LEFT_X = -50000;

const center = worldHostility.at(CENTER_X);
const hot = worldHostility.at(FAR_RIGHT_X);
const cold = worldHostility.at(FAR_LEFT_X);

assert.equal(center.side, 'center', 'origin is the neutral center');
assert.equal(hot.side, 'hot', 'far right is the hot branch');
assert.equal(cold.side, 'cold', 'far left is the cold branch');
assert.ok(hot.hostility > 0.98 && cold.hostility > 0.98, 'far regions reach full hostility');
assert.ok(hot.temperatureBias > 0.15, 'hot branch warms climate');
assert.ok(cold.temperatureBias < -0.15, 'cold branch cools climate');
assert.ok(cold.windExtremeMult > hot.windExtremeMult, 'cold branch is the extreme-wind branch');
assert.ok(hot.volcanoGateDelta < center.volcanoGateDelta, 'hot branch lowers volcano spawn gates');

worldGen.worldSeed = 20260616;
worldGen.clearCaches();
function avgTemp(from, to, step){
  let n=0, sum=0;
  for(let x=from; x<=to; x+=step){ sum+=worldGen.temperature(x); n++; }
  return sum / Math.max(1,n);
}
assert.ok(worldHostility.climateTemperature(FAR_RIGHT_X, 0.5) > 0.65, 'worldgen temperature hook can strongly warm the hot branch');
assert.ok(worldHostility.climateTemperature(FAR_LEFT_X, 0.5) < 0.35, 'worldgen temperature hook can strongly cool the cold branch');
const hotTemp = avgTemp(5000, 60000, 137);
const coldTemp = avgTemp(-60000, -5000, 137);
assert.ok(hotTemp > coldTemp + 0.18, `broad far-right climate is warmer than broad far-left climate (${hotTemp.toFixed(3)} vs ${coldTemp.toFixed(3)})`);

const { seasons } = await import('../src/engine/seasons.js');
globalThis.player = {x:CENTER_X, y:28, hp:100, maxHp:100, vx:0, vy:0};
seasons.reset();
seasons.forceSeason('autumn');
const autumnCenter = seasons.profile();
globalThis.player.x = FAR_LEFT_X;
const autumnCold = seasons.profile();
assert.ok(autumnCold.windMult > autumnCenter.windMult * 1.5, 'far-left autumn strongly amplifies wind within the configured cap');
assert.ok(autumnCold.snowStrength > autumnCenter.snowStrength, 'far-left autumn carries early snow pressure');
globalThis.player.x = FAR_RIGHT_X;
const autumnHot = seasons.profile();
assert.ok(autumnHot.temperatureDelta > autumnCenter.temperatureDelta, 'far-right seasons lean warmer');

const { meteorites } = await import('../src/engine/meteorites.js');
const coldWeights = meteorites._debug.classWeightsAt(FAR_LEFT_X);
const hotWeights = meteorites._debug.classWeightsAt(FAR_RIGHT_X);
assert.ok(coldWeights.ice > hotWeights.ice * 4, 'cold branch heavily favors ice meteorites');
assert.ok(hotWeights.radioactive > coldWeights.radioactive, 'hot branch favors radioactive meteorites');
assert.ok(hotWeights.iron > coldWeights.iron, 'hot branch favors hot mineral meteorites');
globalThis.player.x = FAR_RIGHT_X;
const meteorMetrics = meteorites.metrics();
assert.ok(meteorMetrics.scheduleBoundsDays.max < 10, 'hostile regions shorten meteor schedule bounds');

const { mobs } = await import('../src/engine/mobs.js');
function flatGrassTile(x,y){
  if(y < 0 || y > 140) return T.STONE;
  if(y === 30) return T.GRASS;
  if(y > 30) return T.STONE;
  return T.AIR;
}
mobs.clearAll();
globalThis.player.x = CENTER_X;
assert.equal(mobs.forceSpawn('RABBIT', {x:CENTER_X, y:29}, flatGrassTile), true, 'center rabbit can spawn');
const centerRabbit = mobs.serialize().list.find(m=>m.id==='RABBIT');
mobs.clearAll();
globalThis.player.x = FAR_RIGHT_X;
assert.equal(mobs.forceSpawn('RABBIT', {x:FAR_RIGHT_X, y:29}, flatGrassTile), true, 'far rabbit can spawn');
const farRabbit = mobs.serialize().list.find(m=>m.id==='RABBIT');
assert.ok(centerRabbit && farRabbit, 'rabbit snapshots are available');
assert.ok(farRabbit.maxHp > centerRabbit.maxHp, 'far-region mobs persist higher max HP');
assert.ok(farRabbit.hostility > 0.9, 'mob snapshot records regional hostility for migration/debugging');
mobs.clearAll();

let bossTiles = new Map();
function bossKey(x,y){ return Math.floor(x)+','+Math.floor(y); }
function bossGetTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y < 0 || y >= 140) return T.STONE;
  return bossTiles.get(bossKey(x,y)) ?? (y >= 90 ? T.STONE : T.AIR);
}
function bossSetTile(x,y,t){ bossTiles.set(bossKey(x,y), t); }
globalThis.MM.T = T;
globalThis.MM.INFO = INFO;
globalThis.MM.WORLD_H = 140;
globalThis.MM.TILE = 20;
globalThis.MM.worldGen = { surfaceHeight:()=>90, biomeType:()=>0, settings:{seaLevel:95} };
globalThis.MM.world = { getTile:bossGetTile, setTile:bossSetTile };
globalThis.MM.water = { onTileChanged(){}, disturb(){} };
globalThis.MM.particles = { spawnBurst(){}, spawnSplash(){} };

const { bosses } = await import('../src/engine/bosses.js');
function bossHpSum(m){ return m.parts.reduce((sum,p)=>sum+p.maxHp, 0); }
bosses.reset();
globalThis.player = {x:CENTER_X, y:88, hp:100, maxHp:100, xp:0, vx:0, vy:0, hpInvul:0, tool:'basic'};
bossTiles = new Map();
const centerBoss = bosses.forceSpawn(bossGetTile, {x:CENTER_X, seed:777, freeze:true, archetype:'walker'});
const farBoss = bosses.forceSpawn(bossGetTile, {x:FAR_RIGHT_X, seed:777, freeze:true, archetype:'walker'});
assert.ok(centerBoss && farBoss, 'bosses spawn in center and far regions');
assert.equal(farBoss.parts.length, centerBoss.parts.length, 'same seed keeps the same boss body plan');
assert.ok(bossHpSum(farBoss) > bossHpSum(centerBoss) * 2, 'far-region bosses have substantially tougher parts');
assert.ok(farBoss.attackDmg > centerBoss.attackDmg, 'far-region bosses hit harder');

// --- Debug-menu tuning: intensity scales strength, reach stretches the ramp ---
const probeX = 12000;
worldHostility.setTuning({intensity:1, reach:1});
const baseProbe = worldHostility.at(probeX).hostility;
assert.ok(baseProbe > 0.05 && baseProbe < 0.95, 'probe sits on the slope so tuning effects are observable');
assert.ok(Math.abs(worldHostility.setTuning({intensity:2}).intensity - 2) < 1e-9, 'setTuning returns the applied intensity');
assert.ok(Math.abs(worldHostility.at(probeX).hostility - baseProbe * 2) < 1e-6, 'intensity multiplies the hostility curve');
worldHostility.setTuning({intensity:0});
assert.equal(worldHostility.at(probeX).side, 'center', 'zero intensity flattens the ramp to a gentle center');
assert.equal(worldHostility.at(FAR_RIGHT_X).hostility, 0, 'zero intensity disables difficulty even at the far edge');
worldHostility.setTuning({intensity:1, reach:0.5});
assert.ok(worldHostility.at(probeX).hostility > baseProbe, 'shorter reach makes the ramp bite sooner');
worldHostility.setTuning({intensity:1, reach:2});
assert.ok(worldHostility.at(probeX).hostility < baseProbe, 'longer reach makes the ramp more gradual');
const clamped = worldHostility.setTuning({intensity:99, reach:99});
assert.ok(clamped.intensity <= 3 && clamped.reach <= 4, 'tuning is clamped to safe bounds the UI cannot exceed');
worldHostility.setTuning({intensity:1, reach:1});
assert.deepEqual(worldHostility.getTuning(), {intensity:1, reach:1}, 'tuning restores cleanly to defaults');

console.log('world-hostility-sim: all assertions passed');
