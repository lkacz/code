// Deterministic Node test for the weather / water-cycle core (no browser needed).
// Verifies: sun-driven evaporation with mass conservation, condensation into clouds,
// oversized clouds raining and depositing real water tiles, temperature-drop (night)
// rain triggering, cloud merging ("cumulation"), snow in cold climates (no tile
// deposit — mass sublimates back to vapor), incoming border clouds, lightning strikes
// (chest transmutation + hero electrocution), the storm front lifecycle, and API safety.
// Run: node tools/clouds-sim.test.mjs
import { strict as assert } from 'assert';

const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8,CHEST_COMMON:9,CHEST_RARE:10,CHEST_EPIC:11,ICE:12};
const CHEST_IDS = [T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC];
globalThis.window = globalThis; // clouds.js attaches to window.MM

// Mutable climate knob so individual tests can freeze/thaw the world
let TEMP = 0.7;
globalThis.MM = {
  T, WORLD_H:140, TILE:20,
  worldGen: {
    temperature: ()=>TEMP,
    surfaceHeight: ()=>90,
    settings: {seaLevel:95},
    worldSeed: 12345,
  },
  water: {
    addSource(x,y,gt,st){ if(gt(x,y)===T.AIR){ st(x,y,T.WATER); return true; } return false; },
    onTileChanged(){}, disturb(){},
  },
  particles: { spawnSplash(){}, spawnBubble(){} },
};

const { clouds } = await import('../src/engine/clouds.js');
assert.ok(clouds, 'clouds module exports');
const CFG = clouds.config;
const DEF = Object.assign({}, CFG); // restore knobs between scenarios

// Sparse world: bedrock from y=90 down, open sky above; supports negative x.
const H = 140;
let tiles;
const getTile = (x,y)=>{ if(y<0||y>=H) return T.STONE; const v=tiles.get(x+','+y); return v===undefined ? (y>=90? T.STONE : T.AIR) : v; };
const setTile = (x,y,v)=>{ if(y>=0&&y<H) tiles.set(x+','+y,v); };
const countWater = ()=>{ let c=0; for(const v of tiles.values()) if(v===T.WATER) c++; return c; };
const step = (n,dt=1/30)=>{ for(let i=0;i<n;i++) clouds.update(getTile,setTile,dt); };
function resetWorld(){
  tiles = new Map();
  clouds.reset();
  Object.assign(CFG, DEF);
  // keep untracked moisture out of the books by default; tests opt back in
  CFG.BORDER_SPAWN = false;
  CFG.STORMS = false;
  TEMP = 0.7;
  globalThis.player = {x:0};
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
globalThis.player = {x:0, y:89, hp:100, maxHp:100};
const sres = clouds.strike(0, getTile, setTile);
assert.ok(sres && sres.chest, 'strike transmuted the impact tile');
assert.ok(CHEST_IDS.includes(getTile(sres.x,sres.y)), 'impact tile is now a chest');
assert.ok(globalThis.player.hp < 100, `hero at ground zero was electrocuted (hp=${globalThis.player.hp})`);
assert.equal(clouds.metrics().chests, 1, 'strike counter tracks the chest');
const hpAfter = globalThis.player.hp;
globalThis.player.hpInvul = 0; // drop i-frames so only distance protects the hero
const far = clouds.strike(40, getTile, setTile);
assert.ok(far && far.chest, 'distant strike still makes a chest');
assert.equal(globalThis.player.hp, hpAfter, 'distant strike cannot hurt the hero');
// water strike: no chest — the surface erupts instead
for(let x=58;x<66;x++) setTile(x,89,T.WATER);
const wres = clouds.strike(61, getTile, setTile);
assert.ok(wres && !wres.chest, 'water strike does not create a chest');
assert.equal(getTile(61,89), T.WATER, 'water tile is unchanged');

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

// --- 14. API safety: junk input never throws ---
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
