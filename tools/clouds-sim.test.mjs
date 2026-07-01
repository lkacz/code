// Deterministic Node test for the weather / water-cycle core (no browser needed).
// Verifies: sun-driven evaporation with mass conservation, condensation into clouds,
// oversized clouds raining and depositing real water tiles, temperature-drop (night)
// rain triggering, cloud merging ("cumulation"), snow in cold climates (no tile
// deposit — mass sublimates back to vapor), incoming border clouds, lightning strikes
// (chest transmutation + hero electrocution), the storm front lifecycle, and API safety.
// Run: node tools/clouds-sim.test.mjs
import { strict as assert } from 'assert';

const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8,CHEST_COMMON:9,CHEST_RARE:10,CHEST_EPIC:11,ICE:12,POISON_GAS:28,FUEL_GAS:29,DYNAMO:30,DYNAMO_SLOT:31};
const CHEST_IDS = [T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC];
globalThis.window = globalThis; // clouds.js attaches to window.MM

// Mutable climate knob so individual tests can freeze/thaw the world
let TEMP = 0.7;
const WORLD_MIN_Y = -140;
const WORLD_MAX_Y = 280;
globalThis.MM = {
  T, WORLD_H:140, WORLD_MIN_Y, WORLD_MAX_Y, TILE:20,
  INFO: {
    [T.AIR]: {passable:true},
    [T.LEAF]: {passable:true},
    [T.WATER]: {passable:true},
    [T.POISON_GAS]: {passable:true, gas:true},
    [T.FUEL_GAS]: {passable:true, gas:true},
    [T.DYNAMO]: {passable:false},
    [T.DYNAMO_SLOT]: {passable:true},
  },
  worldGen: {
    temperature: ()=>TEMP,
    surfaceHeight: ()=>90,
    settings: {seaLevel:95},
    worldSeed: 12345,
  },
  water: {
    addSource(x,y,gt,st){ const t=gt(x,y); if(t===T.AIR || t===T.POISON_GAS || t===T.FUEL_GAS){ st(x,y,T.WATER); return true; } return false; },
    onTileChanged(){}, disturb(){},
  },
  particles: { spawnSplash(){}, spawnBubble(){} },
};

const { clouds } = await import('../src/engine/clouds.js');
assert.ok(clouds, 'clouds module exports');
const CFG = clouds.config;
const DEF = Object.assign({}, CFG); // restore knobs between scenarios

// Sparse world: bedrock from y=90 down, open sky above; supports negative x.
let tiles;
const getTile = (x,y)=>{ if(y<WORLD_MIN_Y||y>=WORLD_MAX_Y) return T.STONE; const v=tiles.get(x+','+y); return v===undefined ? (y>=90? T.STONE : T.AIR) : v; };
const setTile = (x,y,v)=>{ if(y>=WORLD_MIN_Y&&y<WORLD_MAX_Y) tiles.set(x+','+y,v); };
const countWater = ()=>{ let c=0; for(const v of tiles.values()) if(v===T.WATER) c++; return c; };
const step = (n,dt=1/30)=>{ for(let i=0;i<n;i++) clouds.update(getTile,setTile,dt); };
function resetWorld(){
  tiles = new Map();
  clouds.reset();
  Object.assign(CFG, DEF);
  // keep untracked moisture out of the books by default; tests opt back in
  CFG.BORDER_SPAWN = false;
  CFG.STORMS = false;
  CFG.LIGHTNING_TELEPORT_CHANCE = 0;
  TEMP = 0.7;
  globalThis.player = {x:0};
  delete MM.dynamo;
  clouds.setWindOverride(null);
  clouds.setCycleOverride({cycleT:0.25, isDay:true, tDay:0.5}); // midday by default
}
const countChests = ()=>{ let c=0; for(const v of tiles.values()) if(CHEST_IDS.includes(v)) c++; return c; };
// Mass conservation: everything that evaporated must live somewhere we track.
// (rainMass counts mass shed by clouds; deposited tiles/fractions descend from it.)
function assertConserved(label){
  const m = clouds.metrics();
  const sum = m.vapor + m.cloudMass + m.rainMass;
  assert.ok(Math.abs(m.evapMass - sum) < 1e-3, `${label}: conservation (evap=${m.evapMass.toFixed(4)} vs sinks=${sum.toFixed(4)})`);
}

// --- 1. Evaporation: a sunlit pool loses volume to vapor; mass is conserved ---
resetWorld();
CFG.BORDER_SPAWN = false;       // no untracked moisture entering the books
CFG.EVAP_BASE = DEF.EVAP_BASE*30; // accelerate so the test runs in seconds
CFG.HUM_CAP = 200;              // disable humidity throttling for steady rates
for(let x=-15;x<15;x++){ setTile(x,88,T.WATER); setTile(x,89,T.WATER); } // 60-tile pool
step(300); // 10 s of midday sun
let m = clouds.metrics();
assert.ok(m.evapMass > 0.5, `sunlit pool evaporates (evapMass=${m.evapMass.toFixed(3)})`);
assertConserved('early evaporation');
step(900); // 40 s total: per-column debt crosses 1.0 → real tiles removed
assert.ok(countWater() < 60, `surface tiles were removed (left=${countWater()})`);
assertConserved('after tile removal');

// --- 2. Condensation: regional vapor nucleates a cloud near the pool ---
m = clouds.metrics();
assert.ok(m.clouds >= 1, `vapor condensed into a cloud (clouds=${m.clouds})`);
const dbg = clouds._debug();
assert.ok(dbg.clouds.some(c=>Math.abs(c.x)<150), 'cloud formed over the evaporating region');

// --- 3. Night: no sun, no evaporation ---
resetWorld();
CFG.BORDER_SPAWN = false; CFG.EVAP_BASE = DEF.EVAP_BASE*30;
for(let x=-15;x<15;x++) setTile(x,88,T.WATER);
clouds.setCycleOverride({cycleT:0.75, isDay:false, tDay:0.5});
step(600);
assert.equal(clouds.metrics().evapMass, 0, 'no evaporation at night');

// --- 4. A very large cloud rains and deposits real water tiles below ---
resetWorld();
CFG.BORDER_SPAWN = false; CFG.EVAP_BASE = 0; // isolate the rain path
const big = clouds.addCloud(0, 70, 40);
assert.ok(big, 'addCloud returns the cloud');
step(30); // 1 s
assert.ok(clouds._debug().clouds[0].raining, 'oversized cloud started raining');
step(30*60); // 60 s of rain
m = clouds.metrics();
assert.ok(m.rainMass > 5, `cloud shed mass as rain (rainMass=${m.rainMass.toFixed(2)})`);
const deposited = countWater();
assert.ok(deposited >= 5, `rain materialized as water tiles (got ${deposited})`);
// every unit shed is a tile on the ground or fractional column debt
const d4 = clouds._debug();
assert.ok(Math.abs(m.rainMass - (deposited + d4.depFrac)) < 1e-3,
  `rain mass accounted for (shed=${m.rainMass.toFixed(3)} tiles=${deposited} frac=${d4.depFrac.toFixed(3)})`);
assert.ok(d4.clouds[0].mass < 40, 'cloud lost the rained mass');

resetWorld();
CFG.BORDER_SPAWN = false; CFG.EVAP_BASE = 0; CFG.LIGHTNING_BASE = 0;
for(let x=-120; x<=120; x++) setTile(x,89,T.POISON_GAS);
clouds.addCloud(0,70,40);
{
  const oldRandom = Math.random;
  Math.random = ()=>0.5;
  try{ step(30*60); }
  finally{ Math.random = oldRandom; }
}
let rainReplacedGas = false;
for(let x=-120; x<=120; x++){ if(getTile(x,89)===T.WATER){ rainReplacedGas = true; break; } }
assert.equal(rainReplacedGas, true, 'rain can occupy a gas cell directly above real ground');

// --- 5. Temperature drop triggers rain: stable by day, raining at night ---
resetWorld();
CFG.BORDER_SPAWN = false; CFG.EVAP_BASE = 0;
clouds.addCloud(0, 70, 19); // below daytime capacity (~23), above nighttime (~15)
step(30*20); // 20 s of day
assert.ok(!clouds._debug().clouds[0].raining, 'cloud holds its water in warm daylight');
assert.equal(clouds.metrics().rainMass, 0, 'no rain fell during the day');
clouds.setCycleOverride({cycleT:0.75, isDay:false, tDay:0.5}); // night: capacity drops
step(30*10);
assert.ok(clouds._debug().clouds[0].raining, 'night cooling condensed the cloud into rain');
assert.ok(clouds.metrics().rainMass > 0, 'rain fell after the temperature drop');

// --- 6. Overlapping clouds merge (cumulation), conserving mass ---
resetWorld();
CFG.BORDER_SPAWN = false; CFG.EVAP_BASE = 0;
clouds.addCloud(-2, 70, 6);
clouds.addCloud(2, 70, 6);
step(60); // 2 s — covers a merge pass
m = clouds.metrics();
assert.equal(m.clouds, 1, 'overlapping clouds merged into one');
assert.ok(Math.abs(m.cloudMass-12) < 0.2, `merged mass conserved (got ${m.cloudMass.toFixed(2)})`);

// --- 7. Cold climate: precipitation falls as snow, no water tiles deposited ---
resetWorld();
CFG.BORDER_SPAWN = false; CFG.EVAP_BASE = 0;
TEMP = 0.05;
clouds.addCloud(0, 70, 30);
step(30*10);
const d7 = clouds._debug();
assert.ok(d7.clouds[0].raining && d7.clouds[0].snowing, 'cold storm snows');
assert.ok(clouds.metrics().rainMass > 0, 'snow sheds cloud mass');
assert.equal(countWater(), 0, 'snow does not deposit water tiles');
assert.ok(clouds.metrics().vapor > 0, 'snowed mass sublimated back to vapor');

// --- 8. New weather blows in from beyond the simulated band ---
resetWorld();
CFG.EVAP_BASE = 0; CFG.BORDER_SPAWN = true;
clouds.setWindOverride(1.5);
step(30*240); // 4 min: incoming spawn is probabilistic but virtually certain by now
assert.ok(clouds.metrics().clouds >= 1, 'cloud drifted in from another region');

// --- 9. Lightning strike: transmutes the hit tile into a chest, hurts a close hero ---
resetWorld();
CFG.EVAP_BASE = 0;
let chargedByLightning=0;
MM.heroEnergy = {
  chargeExternal(amount,opts){
    assert.equal(opts && opts.cause, 'lightning', 'lightning charge is tagged with its cause');
    const p=globalThis.player;
    const before=p.energy||0;
    p.energy=Math.min(p.maxEnergy,before+amount);
    chargedByLightning += p.energy-before;
    return p.energy-before;
  }
};
globalThis.player = {x:0, y:89, hp:100, maxHp:100, energy:10, maxEnergy:100};
const sres = clouds.strike(0, getTile, setTile);
assert.ok(sres && sres.chest, 'strike transmuted the impact tile');
assert.ok(CHEST_IDS.includes(getTile(sres.x,sres.y)), 'impact tile is now a chest');
assert.ok(globalThis.player.hp < 100, `hero at ground zero was electrocuted (hp=${globalThis.player.hp})`);
assert.equal(sres.energy, 50, 'lightning hit reports the hero energy charge');
assert.equal(chargedByLightning, 50, 'lightning charges the hero by +50 energy');
assert.equal(globalThis.player.energy, 60, 'hero energy meter increases by the lightning charge');
assert.equal(clouds.metrics().chests, 1, 'strike counter tracks the chest');
const hpAfter = globalThis.player.hp;
globalThis.player.hpInvul = 0; // drop i-frames so only distance protects the hero
const far = clouds.strike(40, getTile, setTile);
assert.ok(far && far.chest, 'distant strike still makes a chest');
assert.equal(globalThis.player.hp, hpAfter, 'distant strike cannot hurt the hero');
assert.equal(chargedByLightning, 50, 'distant lightning does not grant free energy');
// water strike: no chest — the surface erupts instead
for(let x=58;x<66;x++) setTile(x,89,T.WATER);
const wres = clouds.strike(61, getTile, setTile);
assert.ok(wres && !wres.chest, 'water strike does not create a chest');
assert.equal(getTile(61,89), T.WATER, 'water tile is unchanged');
delete MM.heroEnergy;

resetWorld();
CFG.EVAP_BASE = 0;
setTile(0,-40,T.STONE);
globalThis.player = {x:0, y:-41, hp:100, maxHp:100, energy:0, maxEnergy:100};
const skyStrike = clouds.strike(0, getTile, setTile);
assert.ok(skyStrike && skyStrike.chest, 'debug lightning follows a sky-layer hero into the upper world');
assert.equal(skyStrike.y, -40, 'sky-layer lightning hits the first sky-island surface');
assert.ok(CHEST_IDS.includes(getTile(0,-40)), 'sky-layer lightning can transmute a sky-island tile');
assert.ok(globalThis.player.hp < 100, 'sky-layer lightning can damage a nearby hero');

resetWorld();
CFG.EVAP_BASE = 0; CFG.BORDER_SPAWN = false; CFG.LIGHTNING_BASE = 0;
const oldSurfaceHeight = MM.worldGen.surfaceHeight;
const oldSeaLevel = MM.worldGen.settings.seaLevel;
const oldRandom2 = Math.random;
MM.worldGen.surfaceHeight = () => -42;
MM.worldGen.settings.seaLevel = -35;
Math.random = () => 0.5;
try{
  clouds.setWindOverride(0);
  setTile(0,-40,T.STONE);
  const skyCloud = clouds.addCloud(0,-62,80);
  assert.ok(skyCloud && skyCloud.alt < 0, 'sky weather can start above a sky island');
  step(30*10);
  assert.ok(clouds._debug().clouds[0].alt < 0, 'sky cloud cruising altitude remains in the upper world');
  let skyWater=false;
  for(let x=-8; x<=8; x++) if(getTile(x,-41)===T.WATER) skyWater=true;
  assert.equal(skyWater, true, 'sky rain deposits water onto a sky-island surface');
} finally {
  MM.worldGen.surfaceHeight = oldSurfaceHeight;
  MM.worldGen.settings.seaLevel = oldSeaLevel;
  Math.random = oldRandom2;
}

resetWorld();
CFG.EVAP_BASE = 0;
setTile(0,50,T.POISON_GAS);
const gasStrike = clouds.strike(0, getTile, setTile);
assert.ok(gasStrike && gasStrike.chest, 'lightning ignores gas and still hits the first real surface');
assert.equal(gasStrike.y, 90, 'gas is not treated as a roof or strike target');
assert.equal(getTile(0,50), T.POISON_GAS, 'lightning passing through gas leaves it in place');

resetWorld();
CFG.EVAP_BASE = 0;
CFG.LIGHTNING_DYNAMO_ATTRACT_CHANCE = 1;
CFG.LIGHTNING_DYNAMO_ATTRACT_RADIUS = 7;
setTile(4,40,T.DYNAMO);
setTile(4,41,T.DYNAMO_SLOT);
setTile(4,42,T.DYNAMO);
let drainedDynamo = null;
MM.dynamo = {
  drainAt(x,y,amount){
    drainedDynamo = {x,y,amount};
    return {amount:23};
  },
  onTileChanged(){},
};
const dynamoStrike = clouds.strike(0, getTile, setTile);
assert.ok(dynamoStrike && dynamoStrike.dynamo, 'nearby exposed vertical dynamo attracts lightning');
assert.equal(dynamoStrike.x, 4, 'lightning retargets to the vertical dynamo column');
assert.equal(dynamoStrike.y, 40, 'lightning hits the exposed top casing');
assert.equal(getTile(4,40), T.AIR, 'lightning destroys one vertical dynamo casing');
assert.equal(getTile(4,41), T.DYNAMO_SLOT, 'remaining slot is left as damaged machine debris');
assert.equal(dynamoStrike.chest, false, 'dynamo lightning hit does not become a loot chest');
assert.deepEqual(drainedDynamo, {x:4,y:41,amount:999}, 'lightning drains the dynamo battery before destroying it');
delete MM.dynamo;

// --- 9b. Rare lightning curse: a hit can teleport the hero 500-1500 blocks away ---
resetWorld();
CFG.EVAP_BASE = 0;
CFG.LIGHTNING_TELEPORT_CHANCE = 1;
globalThis.player = {x:0, y:89, vx:2, vy:3, hp:100, maxHp:100};
const oldRandom = Math.random;
let randomI = 0;
const randomVals = [0.1, 0.0, 0.75, 0.5]; // chest, chance, direction, distance
Math.random = ()=> randomVals[randomI++] ?? 0.5;
try{
  const tres = clouds.strike(0, getTile, setTile);
  assert.ok(tres && tres.teleport, 'lightning hit reported a teleport');
  assert.ok(tres.teleport.distance>=500 && tres.teleport.distance<=1500,
    `teleport distance in range (${tres.teleport.distance})`);
  assert.ok(globalThis.player.x>=500 && globalThis.player.x<=1501, `player moved far away (x=${globalThis.player.x})`);
  assert.equal(globalThis.player.y, 89, 'player landed on the dry surface');
  assert.equal(globalThis.player.vx, 0, 'teleport clears horizontal velocity');
  assert.equal(globalThis.player.vy, 0, 'teleport clears vertical velocity');
} finally {
  Math.random = oldRandom;
}

resetWorld();
CFG.EVAP_BASE = 0;
CFG.LIGHTNING_TELEPORT_CHANCE = 1;
globalThis.player = {x:0, y:89, vx:2, vy:3, hp:5, maxHp:100};
Math.random = ()=>0.1;
try{
  const fatal = clouds.strike(0, getTile, setTile);
  assert.ok(fatal && fatal.dmg>0, 'fatal lightning still applies damage');
  assert.equal(fatal.teleport, null, 'fatal lightning does not teleport after respawn');
  assert.equal(globalThis.player.hp, 100, 'fatal lightning uses the existing respawn path');
} finally {
  Math.random = oldRandom;
}

resetWorld();
CFG.EVAP_BASE = 0;
CFG.LIGHTNING_TELEPORT_CHANCE = 1;
setTile(1000,90,T.WATER);
globalThis.player = {x:0, y:89, vx:2, vy:3, hp:100, maxHp:100};
randomI = 0;
Math.random = ()=> randomVals[randomI++] ?? 0.5;
try{
  const waterTarget = clouds.strike(0, getTile, setTile);
  assert.ok(waterTarget && waterTarget.teleport, 'water-target strike still finds a teleport spot');
  assert.notEqual(Math.floor(globalThis.player.x), 1000, 'teleport skips the water landing column');
  assert.equal(getTile(Math.floor(globalThis.player.x),90), T.STONE, 'teleport lands over dry support');
} finally {
  Math.random = oldRandom;
}

// --- 10. Storm front: heavy rain, frequent lightning chests, then calm again ---
resetWorld();
CFG.EVAP_BASE = 0;
globalThis.player = {x:0, y:89, hp:100, maxHp:100};
clouds.startStorm(80, 1);
assert.ok(clouds.metrics().storm.active, 'storm started');
step(30*81); // ride out the front
let sm = clouds.metrics();
assert.ok(sm.rainMass > 3, `storm poured heavy rain (rainMass=${sm.rainMass.toFixed(2)})`);
assert.ok(sm.strikes >= 1, `storm produced lightning (strikes=${sm.strikes})`);
assert.ok(countChests() >= 1, `lightning transmuted tiles into chests (got ${countChests()})`);
assert.ok(!sm.storm.active, 'storm blew over after its duration');

// --- 11. Far-field pruning keeps the humidity/debt maps bounded for travellers ---
resetWorld();
CFG.EVAP_BASE = DEF.EVAP_BASE*30; CFG.HUM_CAP = 200;
for(let x=-15;x<15;x++) setTile(x,88,T.WATER);
step(600); // 20 s of sun builds vapor and per-column removal debt
let mB = clouds.metrics();
assert.ok(mB.vapor > 0.2, 'vapor accumulated near the pool');
assert.ok(clouds._debug().evapAcc.size > 0, 'evaporation debt tracked per column');
let debtBefore = 0; for(const a of clouds._debug().evapAcc.values()) debtBefore += a;
globalThis.player = {x:100000}; // teleport far away
step(60); // a couple of condense ticks at the new location
assert.ok(clouds.metrics().vapor < 1e-6, 'left-behind humidity folded into the reserve');
assert.equal(clouds._debug().evapAcc.size, 0, 'stale evaporation debt pruned');
// the fold is volume-true: reserve gains the moisture (vapor + clouds) and pays
// back the unredeemed evaporation debt, ending exactly balanced
const farExpected = mB.farBudget + mB.vapor + mB.cloudMass - debtBefore;
assert.ok(Math.abs(clouds.metrics().farBudget - farExpected) < 0.01,
  `reserve balanced after pruning (got ${clouds.metrics().farBudget.toFixed(3)}, expected ${farExpected.toFixed(3)})`);

// --- 12. Hardened inputs: junk can't stall or crash the weather ---
resetWorld();
CFG.EVAP_BASE = DEF.EVAP_BASE*30; CFG.HUM_CAP = 200;
for(let x=-5;x<5;x++) setTile(x,88,T.WATER);
clouds.setCycleOverride({isDay:true}); // malformed (no tDay): ignored, midday stays
step(300);
assert.ok(clouds.metrics().evapMass > 0, 'malformed cycle override did not stall the sun');
assert.equal(clouds.strike(0), null, 'strike without accessors fails closed (no MM.world here)');
const fat = clouds.addCloud(0, null, 5000);
assert.ok(fat.r <= 2.6+Math.sqrt(80)*1.05+1e-9, `cloud radius capped for huge masses (r=${fat.r.toFixed(2)})`);
clouds.update('junk','junk',1/30); // guarded: no throw
clouds.update(getTile,setTile,'junk');

// --- 13. Perf smoke: a busy storm minute simulates quickly ---
resetWorld();
CFG.BORDER_SPAWN = true; CFG.STORMS = true;
globalThis.player = {x:0, y:89, hp:100, maxHp:100};
for(let x=-100;x<100;x++) setTile(x,88,T.WATER);
clouds.startStorm(60, 1);
const tPerf = Date.now();
step(30*60);
const perfMs = Date.now()-tPerf;
console.log('perf: 60 s of storm over water simulated in '+perfMs+' ms');
assert.ok(perfMs < 5000, `storm update stays cheap (took ${perfMs} ms)`);

// --- 14. Save/restore: weather simulation persists without cosmetic bloat ---
resetWorld();
CFG.EVAP_BASE = 0; CFG.BORDER_SPAWN = false;
clouds.injectVapor(96, 3.25);
const savedCloud = clouds.addCloud(8, 70, 12);
savedCloud.depAcc = 0.6;
savedCloud.raining = true;
clouds.startStorm(45, 0.7);
step(10);
const snap = clouds.snapshot();
assert.ok(snap && snap.v === 1, 'weather snapshot has a version');
assert.ok(Array.isArray(snap.clouds) && snap.clouds.length >= 1, 'weather snapshot carries cloud parcels');
assert.ok(Array.isArray(snap.vapor) && snap.vapor.length >= 1, 'weather snapshot carries regional vapor');
assert.ok(snap.storm && snap.storm.active, 'weather snapshot carries active storm state');
assert.equal(Object.hasOwn(snap, 'drops'), false, 'weather snapshot omits cosmetic raindrops');
assert.equal(Object.hasOwn(snap, 'wisps'), false, 'weather snapshot omits cosmetic wisps');
assert.equal(Object.hasOwn(snap, 'bolts'), false, 'weather snapshot omits cosmetic lightning bolts');
clouds.reset();
assert.equal(clouds.metrics().clouds, 0, 'reset clears clouds before restore');
assert.equal(clouds.restore(snap), true, 'weather restore accepts a valid snapshot');
const restored = clouds.metrics();
assert.ok(restored.clouds >= 1, 'weather restore brings clouds back');
assert.ok(restored.vapor > 3, `weather restore preserves vapor mass (${restored.vapor.toFixed(2)})`);
assert.ok(restored.storm.active, 'weather restore resumes the active storm');
const restoredCloud = clouds._debug().clouds[0];
assert.ok(Array.isArray(restoredCloud.puffs) && restoredCloud.puffs.length > 0, 'weather restore rebuilds cloud puff art from seeds');
assert.equal(restoredCloud.sprite, null, 'weather restore does not persist canvas sprite caches');
assert.equal(clouds.restore(null), false, 'weather restore rejects missing payloads without throwing');

// --- 15. API safety: junk input never throws ---
clouds.setWindOverride('junk'); clouds.setWindOverride(null);
clouds.setCycleOverride('junk'); clouds.setCycleOverride(null);
assert.equal(clouds.addCloud(NaN, null, 10), null, 'addCloud rejects junk x');
assert.equal(clouds.strike(NaN, getTile, setTile), null, 'strike rejects junk x');
clouds.startStorm('junk','junk'); clouds.reset();
clouds.update(getTile,setTile,NaN);
clouds.update(getTile,setTile,-1);
delete globalThis.player; // update must survive a missing player
clouds.update(getTile,setTile,1/30);
clouds.reset();
const mEnd = clouds.metrics();
assert.equal(mEnd.clouds+mEnd.drops, 0, 'reset clears all weather state');

console.log('OK: all cloud / water-cycle simulation tests passed');
