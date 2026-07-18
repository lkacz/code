// Sandstorm regressions: the hot-east mirror of the blizzard.
//   * wind-driven, not cloud-driven: no storm below WIND_MIN, natural intensity
//     ramps with gale-force wind over a desert band
//   * volume-true sand ledger: lifted crest tiles == deposited dunes + airborne
//   * dunes are UNSTABLE_SAND under the same stack caps (3 / 6 storm) and the
//     same hero-AABB protection as snow deposition
//   * forced (FIRE_SHAMAN ritual) storms are owner-scoped like clouds.startStorm
// Run: node tools/sandstorm-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
MM.T = T;
MM.TILE = 20;

// --- stubs: hot desert east of x=0, cold turf west; flat surface at y=30 ---
const SURF = 30;
MM.worldGen = {
  temperature: x => (x >= 0 ? 0.85 : 0.10),
  surfaceHeight: () => SURF,
};
let windSpeed = 0;
MM.wind = { speed: () => windSpeed };
const played = [];
MM.audio = { play: (n) => played.push(n) };

const tiles = new Map();
const key = (x, y) => Math.floor(x) + ',' + Math.floor(y);
function baseTile(x, y){
  if(y < SURF) return T.AIR;
  return x >= 0 ? T.SAND : T.GRASS;
}
function getTile(x, y){
  x = Math.floor(x); y = Math.floor(y);
  if(y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return T.STONE;
  const k = key(x, y);
  return tiles.has(k) ? tiles.get(k) : baseTile(x, y);
}
function setTile(x, y, t){
  x = Math.floor(x); y = Math.floor(y);
  if(y >= WORLD_MIN_Y && y < WORLD_MAX_Y) tiles.set(key(x, y), t);
}

globalThis.player = { x: 40, y: SURF - 2, w: 0.7, h: 0.95 };

const { sandstorm } = await import('../src/engine/sandstorm.js');
assert.ok(sandstorm, 'sandstorm module exports');
const CFG = sandstorm.config;

function advance(seconds){
  const steps = Math.ceil(seconds * 20);
  for(let i = 0; i < steps; i++) sandstorm.update(getTile, setTile, 0.05);
}
function crestAt(x){
  // a one-tile sand crest standing proud of its neighbours
  setTile(x, SURF - 1, T.SAND);
}
function duneDepth(x){
  let d = 0;
  for(let y = WORLD_MIN_Y + 2; y < WORLD_MAX_Y - 1; y++){
    if(getTile(x, y) === T.UNSTABLE_SAND){
      let yy = y;
      while(getTile(x, yy) === T.UNSTABLE_SAND){ d++; yy++; }
      break;
    }
    if(getTile(x, y) !== T.AIR && getTile(x, y) !== T.UNSTABLE_SAND && y >= SURF - 12) break;
  }
  return d;
}
function countDunes(x0, x1){
  let n = 0;
  for(let x = x0; x <= x1; x++)
    for(let y = SURF - 12; y <= SURF + 2; y++)
      if(getTile(x, y) === T.UNSTABLE_SAND) n++;
  return n;
}
// Mass conservation ground truth: total sand-family tiles across the whole
// possible reshaping window (lifts within ±BAND of the player, deposits a
// further downwind reach beyond). One lifted tile == one airborne unit.
function countSandFamily(){
  let n = 0;
  for(let x = -180; x <= 360; x++)
    for(let y = SURF - 14; y <= SURF + 4; y++){
      const t = getTile(x, y);
      if(t === T.SAND || t === T.UNSTABLE_SAND) n++;
    }
  return n;
}
function reset(){
  tiles.clear();
  sandstorm.reset();
  MM.coopBodies = [];
  played.length = 0;
  player.x = 40; player.y = SURF - 2;
}

// --- 1. weak wind: the desert stays quiet -----------------------------------
reset();
windSpeed = CFG.WIND_MIN - 1.5;
advance(10);
{
  const m = sandstorm.metrics();
  assert.equal(m.lifted, 0, 'no crest erosion below WIND_MIN');
  assert.equal(m.intensity, 0, 'no storm intensity below WIND_MIN');
  assert.equal(countDunes(-120, 160), 0, 'no dunes minted in calm weather');
}

// --- 2. gale over the desert: sand erodes and settles as dunes, volume-true --
reset();
windSpeed = 6.8;
for(let x = 12; x <= 130; x += 3) crestAt(x);
const sandBefore = countSandFamily();
advance(30);
{
  const m = sandstorm.metrics();
  assert.ok(m.natural > 0.5, `gale-force wind over a desert reads as a natural sandstorm (${m.natural})`);
  assert.ok(m.lifted > 4, `the desert erodes under the gale (lifted ${m.lifted})`);
  const dunes = countDunes(-120, 260);
  assert.ok(dunes > 0, 'lifted sand settles as UNSTABLE_SAND dunes');
  assert.equal(m.lifted, m.deposited + Math.round(m.airborne),
    `event ledger is volume-true: lifted(${m.lifted}) == deposited(${m.deposited}) + airborne(${m.airborne})`);
  assert.equal(countSandFamily(), sandBefore - Math.round(m.airborne),
    'mass conservation: the world lost exactly the suspended sand, nothing else');
  assert.equal(countDunes(-120, -2), 0, 'the cold-west turf band gets no dunes (climate gate)');
}

// --- 3. after the wind dies airborne sand settles out (ledger closes) -------
windSpeed = 0;
advance(40);
{
  const m = sandstorm.metrics();
  assert.ok(m.airborne < 1, `suspended sand rains out after the storm (airborne ${m.airborne})`);
  assert.equal(countSandFamily(), sandBefore - Math.round(m.airborne),
    'mass conservation still holds after the storm settles');
}

// --- 4. stack caps: ordinary blow 3, forced storm 6 (mirrors snow caps) -----
reset();
assert.equal(CFG.DUNE_STACK_MAX, 3, 'ordinary dune cap mirrors SNOW_STACK_MAX');
assert.equal(CFG.DUNE_STACK_STORM, 6, 'ritual dune cap mirrors SNOW_STACK_STORM');
player.x = -400; player.y = SURF - 2; // hero far away: no AABB interference
for(let i = 0; i < 40; i++) sandstorm._debug.depositSandUnit(60, getTile, setTile);
{
  let deepest = 0;
  for(let x = 50; x <= 70; x++) deepest = Math.max(deepest, duneDepth(x));
  assert.ok(deepest > 0, 'deposits landed');
  assert.ok(deepest <= CFG.DUNE_STACK_MAX, `calm-weather dunes respect the cap (deepest ${deepest})`);
}
reset();
player.x = -400;
sandstorm.startStorm(60, 1, { source: 'qa', ownerId: 'sandstorm-test' });
for(let i = 0; i < 80; i++) sandstorm._debug.depositSandUnit(60, getTile, setTile);
{
  let deepest = 0;
  for(let x = 45; x <= 75; x++) deepest = Math.max(deepest, duneDepth(x));
  assert.ok(deepest > CFG.DUNE_STACK_MAX, 'a forced storm drifts deeper than the calm cap');
  assert.ok(deepest <= CFG.DUNE_STACK_STORM, `storm dunes respect the storm cap (deepest ${deepest})`);
}

// --- 5. hero protection: sand never solidifies inside the hero AABB ---------
reset();
sandstorm.startStorm(60, 1, { source: 'qa', ownerId: 'sandstorm-test' });
player.x = 60.5; player.y = SURF - 1.4;
for(let i = 0; i < 60; i++) sandstorm._debug.depositSandUnit(60, getTile, setTile);
{
  let inside = 0;
  for(let x = 58; x <= 63; x++){
    for(let y = SURF - 6; y <= SURF; y++){
      if(getTile(x, y) !== T.UNSTABLE_SAND) continue;
      if(Math.abs(x + 0.5 - player.x) < 1.6 && Math.abs(y + 0.5 - player.y) < 2.4) inside++;
    }
  }
  assert.equal(inside, 0, 'the snow-style hero guard blocks minting into (or right around) the hero');
}

for(const dead of [false, true]){
  reset();
  sandstorm.startStorm(60, 1, { source: 'qa', ownerId: 'sandstorm-test' });
  player.x = -400;
  const guest={x:60.5,y:SURF-1.4,w:0.7,h:0.95,dead};
  MM.coopBodies=[guest];
  assert.equal(sandstorm._debug.bodyBlocksSandAt(60,SURF-2),true,`${dead?'dead':'live'} guest uses the shared dune footprint`);
  for(let i = 0; i < 60; i++) sandstorm._debug.depositSandUnit(60, getTile, setTile);
  let inside=0;
  for(let x=58;x<=63;x++) for(let y=SURF-6;y<=SURF;y++){
    if(getTile(x,y)!==T.UNSTABLE_SAND) continue;
    if(Math.abs(x+0.5-guest.x)<1.6 && Math.abs(y+0.5-guest.y)<2.4) inside++;
  }
  assert.equal(inside,0,`${dead?'dead':'live'} guest cannot be buried by sandstorm deposition`);
}

// --- 6. forced storms are owner-scoped like clouds.startStorm ---------------
reset();
const started = sandstorm.startStorm(50, 1, { source: 'weather_shaman', ownerId: 'shaman:FIRE:1' });
assert.equal(started.source, 'weather_shaman', 'forced storm records its source');
assert.ok(played.includes('sandstorm'), 'starting a storm howls through the audio registry');
assert.ok(sandstorm.isActive(), 'forced storm is active regardless of wind');
assert.ok(sandstorm.intensityAt(60) > 0.9, 'full ritual intensity inside the desert band');
assert.equal(sandstorm.intensityAt(-200), 0, 'no sandstorm outside the hot climate band');
assert.equal(sandstorm.stopStorm({ ownerId: 'someone-else' }), false, 'a foreign owner cannot stop the ritual storm');
assert.ok(sandstorm.isActive(), 'storm survives the foreign stop attempt');
assert.equal(sandstorm.stopStorm({ source: 'weather_shaman', ownerId: 'shaman:FIRE:1' }), true, 'the owner stops its own storm');
assert.equal(sandstorm.isActive(), false, 'storm is gone after the owner stop');

// --- 7. cold climate refuses erosion entirely --------------------------------
reset();
windSpeed = 6.8;
setTile(-50, SURF - 1, T.SAND); // a sandy crest in the cold west
assert.equal(sandstorm._debug.tryLiftAt(-50, getTile, setTile), false, 'cold-band sand never lifts');
assert.equal(getTile(-50, SURF - 1), T.SAND, 'the crest tile is untouched');

console.log('sandstorm-sim: all assertions passed');
