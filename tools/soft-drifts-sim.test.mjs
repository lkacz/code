// Soft-drift regressions: decorative run-through accumulation.
//   * registry-driven sub-tile levels (1..10): winter snowfall builds snow
//     fluff, autumn wind shakes leaf litter out of canopies, thick smoke
//     films the ground with soot
//   * a full drift mints a REAL tile (SNOW joins the snowpack under the same
//     stack cap; leaf litter becomes the passable LEAF_PILE) and the next
//     drift starts on the raised surface — soot never solidifies
//   * any body at speed (player or MM.coopBodies) kicks a drift — or a
//     LEAF_PILE tile — apart into flake particles
//   * ghost 'drift' plane mirrors pwat: bounded display-only windows, cleared
//     cells poof into flakes on the watcher side
// Run: node tools/soft-drifts-sim.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, INFO, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
MM.T = T;
MM.TILE = 20;

// --- stubs: flat turf at y=30, a leaf canopy over columns 10..14 -------------
const SURF = 30;
let desertClimate = 0.5; // worldGen.temperature — raise past 0.72 for a desert band
MM.worldGen = { surfaceHeight: () => SURF, temperature: () => desertClimate };
let prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 0 };
let colTemp = 0.5;
MM.seasons = { profile: () => prof, temperatureAt: () => colTemp };
let windSpeed = 0;
MM.wind = { speed: () => windSpeed };
// The soot fallout consumes the smoke module's seams: denseCells drives the
// deposition, consumeAt records the mass the film removed from the air. The
// stub mimics a FED fire — plume density stays constant while consumption is
// tallied — so the scenarios stay deterministic in bounded time.
let smokePlume = null;   // Map "x,y" -> density of a test-authored plume cell
let smokeConsumed = 0;   // mass the fallout claims to have taken from the air
MM.smoke = {
  densityAt: (x, y) => (smokePlume && smokePlume.get(Math.floor(x) + ',' + Math.floor(y))) || 0,
  denseCells: (minD, limit) => {
    const out = [];
    if(!smokePlume) return out;
    for(const [k, d] of smokePlume){
      if(out.length >= limit) break;
      if(!(d >= minD)) continue;
      const [x, y] = k.split(',').map(Number);
      out.push({ x, y, d, age: 120 });
    }
    return out;
  },
  consumeAt: (_x, _y, amount) => { smokeConsumed += amount; return amount; },
};
let cloudsSnowing = false; // a summoned (ICE_SHAMAN) blizzard snowing overhead
let rainStorm = false;     // a live rain storm (drives the soot wash)
MM.clouds = { metrics: () => ({ storm: { active: rainStorm } }), isSnowingAt: () => cloudsSnowing };
let sandstormK = 0; // live sandstorm intensity (natural or FIRE_SHAMAN ritual)
MM.sandstorm = { intensityAt: () => sandstormK };
const flakeCalls = [];
MM.particles = { spawnFlakes: (x, y, opts) => flakeCalls.push({ x, y, opts }) };
const notes = [];
MM.discovery = { note: (k) => notes.push(k) };

const tiles = new Map();
const key = (x, y) => Math.floor(x) + ',' + Math.floor(y);
let canopy = false;
function baseTile(x, y){
  x = Math.floor(x); y = Math.floor(y);
  if(canopy && y === SURF - 6 && x >= 10 && x <= 14) return T.LEAF;
  return y < SURF ? T.AIR : T.GRASS;
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

globalThis.player = { x: 200, y: SURF - 2, w: 0.7, h: 0.95, vx: 0, vy: 0 };

const { softDrifts } = await import('../src/engine/soft_drifts.js');
assert.ok(softDrifts, 'soft_drifts module exports');
const CFG = softDrifts.config;
const DBG = softDrifts._debug;

// tight band + heavy sampling keeps the stochastic scenarios fast and stable
CFG.BAND = 4;
CFG.SAMPLES = 40;

function advance(seconds){
  const steps = Math.ceil(seconds * 20);
  for(let i = 0; i < steps; i++) softDrifts.update(0.05, player, getTile, setTile);
}
function forceSweep(){
  DBG.setSweepAt(-1e9);
  softDrifts.update(0.001, player, getTile, setTile);
}
function countTiles(t, x0, x1){
  let n = 0;
  for(let x = x0; x <= x1; x++)
    for(let y = SURF - 12; y <= SURF + 2; y++)
      if(getTile(x, y) === t) n++;
  return n;
}
function maxStack(t, x0, x1){
  let best = 0;
  for(let x = x0; x <= x1; x++){
    let run = 0;
    for(let y = SURF - 12; y <= SURF + 2; y++){
      if(getTile(x, y) === t){ run++; best = Math.max(best, run); }
      else run = 0;
    }
  }
  return best;
}
function reset(){
  tiles.clear();
  softDrifts.reset();
  MM.coopBodies = [];
  flakeCalls.length = 0;
  notes.length = 0;
  prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 0 };
  colTemp = 0.5; windSpeed = 0; smokePlume = null; smokeConsumed = 0; canopy = false; rainStorm = false;
  desertClimate = 0.5; cloudsSnowing = false; sandstormK = 0;
  player.x = 200; player.y = SURF - 2; player.vx = 0; player.vy = 0;
}

// --- 0. the wire material order is a pinned contract -------------------------
assert.deepEqual(softDrifts.materials, ['snow', 'leaves', 'soot', 'sand', 'pollen'],
  'the drift-plane wire ids are indices into this pinned material order (append-only)');
assert.equal(softDrifts.UNITS, 10, 'sub-tile levels per cell');
assert.ok(INFO[T.LEAF_PILE] && INFO[T.LEAF_PILE].passable && INFO[T.LEAF_PILE].flammable
  && INFO[T.LEAF_PILE].drop === 'leaf' && INFO[T.LEAF_PILE].leafLitter,
  'LEAF_PILE is a passable, flammable, leaf-dropping litter tile');

// --- 1. calm mid-season weather: nothing accumulates -------------------------
reset();
player.x = 0;
advance(8);
assert.equal(softDrifts.count(), 0, 'no drift cells without an active source');
assert.equal(countTiles(T.SNOW, -20, 20) + countTiles(T.LEAF_PILE, -20, 20), 0, 'no tiles minted in calm weather');

// --- 2. winter snowfall: fluff builds, full drifts join the snowpack ---------
reset();
player.x = 0;
prof = { snowStrength: 1, leafDropStrength: 0, leafGrowStrength: 0 };
colTemp = 0.2;
advance(4);
assert.ok(softDrifts.count() > 0, `snowfall builds fluff cells (${softDrifts.count()})`);
advance(40);
{
  const m = softDrifts.metrics();
  assert.ok(m.minted.snow > 0, `full snow drifts mint real SNOW tiles (${m.minted.snow})`);
  assert.ok(countTiles(T.SNOW, -8, 8) > 0, 'the snowpack is standing on the turf');
  assert.ok(maxStack(T.SNOW, -8, 8) <= DBG.MATS.snow.stackMax,
    `drift-minted snowpack respects the ${DBG.MATS.snow.stackMax}-tile ordinary cap (${maxStack(T.SNOW, -8, 8)})`);
}
// warm weather melts the leftover fluff away
prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 0 };
colTemp = 0.8;
advance(45);
assert.equal(softDrifts.count(), 0, 'warm air decays the remaining fluff to nothing');

// --- 3. autumn breeze under a canopy: litter lands only below/near leaves ----
// (wind sits BELOW the gale threshold — a real gale spreads litter downwind,
//  which is scenario 8's contract, not this one's)
reset();
canopy = true;
player.x = 12;
prof = { snowStrength: 0, leafDropStrength: 1, leafGrowStrength: 0 };
windSpeed = 3.0;
advance(40);
{
  let outside = 0;
  for(const c of DBG.cells.values()) if(c.x < 8 || c.x > 16) outside++;
  assert.equal(outside, 0, 'leaf litter stays under (or a wind-step from) the canopy');
  const m = softDrifts.metrics();
  assert.ok(m.minted.leaves > 0, `full litter drifts mint LEAF_PILE tiles (${m.minted.leaves})`);
  assert.ok(countTiles(T.LEAF_PILE, 8, 16) > 0, 'a leaf pile stands under the canopy');
  assert.ok(maxStack(T.LEAF_PILE, 8, 16) <= DBG.MATS.leaves.stackMax,
    `litter piles respect their ${DBG.MATS.leaves.stackMax}-tile cap`);
}
// spring rots the piles away again
prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 1 };
windSpeed = 0;
advance(45);
assert.equal(countTiles(T.LEAF_PILE, 8, 16), 0, 'spring rots the minted leaf piles back to air');

// --- 3b. a spring/summer bloom gale actually carries pollen (leafGrowStrength) --
// Locks pollen into naturalStormTarget's loop: it was minted into MATS but omitted
// from the hardcoded gale list, so the whole gale (+ its pollen_gale discovery) was
// unreachable in normal play until fixed.
reset();
player.x = 12;
prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 1 };
windSpeed = 5.0; // within pollen's gale band (windMin 3.4 .. windFull 6.2), snow/sand/leaves all below their season/climate gates
advance(40);
assert.ok([...DBG.cells.values()].some(c => c.m === 'pollen'),
  'a spring bloom gale deposits pollen drifts (pollen is in the natural gale loop)');

// --- 4. thick smoke films the ground with soot; soot never solidifies --------
// The PLUME drives the fallout: each dense smoke cell projects straight down
// onto the ground beneath it, and every deposited unit consumes smoke mass.
reset();
player.x = 50;
smokePlume = new Map();
for(const x of [48, 49, 50, 51, 52]) smokePlume.set(x + ',' + (SURF - 1), 4);
advance(45);
{
  const m = softDrifts.metrics();
  assert.ok(m.byMat.soot > 0, `smoke films the ground with soot cells (${m.byMat.soot})`);
  assert.ok(smokeConsumed > 0, 'deposition consumes smoke mass — the smog becomes the film');
  let over = 0;
  for(const c of DBG.cells.values()) if(c.m === 'soot' && c.u > DBG.MATS.soot.maxUnits) over++;
  assert.equal(over, 0, `the soot film never exceeds ${DBG.MATS.soot.maxUnits} units`);
  assert.equal(m.minted.soot, 0, 'soot never mints a SOFT tile');
  assert.equal(countTiles(T.SNOW, 44, 56) + countTiles(T.LEAF_PILE, 44, 56), 0, 'no soft block appears under the smoke');
}
// …but a MAXED film under continued fall can compress into a graphite seam.
// The body-deposition guard blocks the columns around the hero, and the
// shipping compressP (0.12) leaves only a handful of expected events in the
// remaining columns — raise the roll for the test window so the scenario is
// effectively deterministic, then restore it.
{
  const pWas = DBG.MATS.soot.compressP;
  DBG.MATS.soot.compressP = 0.5;
  advance(180);
  DBG.MATS.soot.compressP = pWas;
  const m = softDrifts.metrics();
  assert.ok(m.minted.graphite > 0, `sustained dense smoke compresses maxed films into GRAPHITE (${m.minted.graphite})`);
  assert.ok(countTiles(T.GRAPHITE, 44, 56) > 0, 'a graphite seam stands where the film was');
  assert.ok(notes.includes('graphite'), 'the first compression lands in the discovery journal');
}

// --- 4b. the fallout works UNDER A ROOF — the indoor-fire regression ---------
// The retired open-sky column scan probed the sky ABOVE the roof and never saw
// the smog pooled inside a building; the plume-driven fallout stains the
// indoor floor the settled smoke actually rests on.
reset();
player.x = 70;
for(let x = 66; x <= 74; x++) setTile(x, SURF - 8, T.STONE); // the roof
smokePlume = new Map();
for(const x of [68, 69, 70, 71, 72]) smokePlume.set(x + ',' + (SURF - 1), 1.1);
advance(60);
{
  const m = softDrifts.metrics();
  assert.ok(m.byMat.soot > 0, `dense smog under a roof films the indoor floor (${m.byMat.soot})`);
  let indoor = 0;
  for(const c of DBG.cells.values()) if(c.m === 'soot' && c.x >= 68 && c.x <= 72 && c.y === SURF - 1) indoor++;
  assert.ok(indoor > 0, 'the film sits on the indoor floor cells themselves');
}

// --- 4c. a plume hanging beyond the fall scan stains nothing -----------------
reset();
player.x = 90;
smokePlume = new Map([['90,' + (SURF - 7), 4]]); // 6 open rows above the turf
advance(20);
assert.equal(softDrifts.metrics().byMat.soot, 0, 'smoke high above the ground drops no film');

// --- 4d. a passing gas puff must not stomp the film --------------------------
// A burning tile breathes REAL hot-air tiles into the room every ~0.85s; the
// puffs rise through floor-level cells, and the validator used to delete any
// film whose cell was not exactly AIR — indoor soot vanished within seconds.
reset();
DBG.cells.set('100,' + (SURF - 1), { x: 100, y: SURF - 1, m: 'soot', u: 5 });
setTile(100, SURF - 1, T.HOT_AIR);
advance(2);
assert.ok(DBG.cells.has('100,' + (SURF - 1)), 'a transient gas tile crossing the cell leaves the film alone');
setTile(100, SURF - 1, T.STONE);
advance(2);
assert.equal(DBG.cells.has('100,' + (SURF - 1)), false, 'a solid occupying the cell still culls the film');

// --- 4e. rain washes only the films the sky actually rains on ----------------
{
  const fadeWas = CFG.FADE_DAYS;
  CFG.FADE_DAYS = 9999; // isolate the wash from the baseline fade
  reset();
  for(let x = 108; x <= 116; x++) setTile(x, SURF - 8, T.STONE); // roof
  DBG.cells.set('112,' + (SURF - 1), { x: 112, y: SURF - 1, m: 'soot', u: 6 }); // indoors
  DBG.cells.set('130,' + (SURF - 1), { x: 130, y: SURF - 1, m: 'soot', u: 3 }); // open sky
  rainStorm = true;
  advance(60);
  rainStorm = false;
  assert.equal(DBG.cells.has('130,' + (SURF - 1)), false, 'an exposed film washes away in the rain');
  const sheltered = DBG.cells.get('112,' + (SURF - 1));
  assert.ok(sheltered && sheltered.u >= 5, `a roofed film shrugs the storm off (${sheltered && sheltered.u})`);
  CFG.FADE_DAYS = fadeWas;
}

// --- 5. a run PLOUGHS the drift: 50% back in place, 40% wake, 10% ahead ------
// The volume hangs airborne for SETTLE_SEC, then settles into the SAME row
// only — the directly adjacent columns and the source cell itself.
CFG.FADE_DAYS = 9999; // freeze the baseline fade: these scenarios pin exact unit counts
reset();
DBG.cells.set('100,' + (SURF - 1), { x: 100, y: SURF - 1, m: 'leaves', u: 10 });
player.x = 100.5; player.y = SURF - 0.05; player.vx = 0.4; // a slow walk survives
forceSweep();
assert.equal(DBG.cells.get('100,' + (SURF - 1)).u, 10, 'a slow walk does not disturb the drift');
player.vx = 3; // a run ploughs it
forceSweep();
player.vx = 0;
assert.equal(DBG.cells.has('100,' + (SURF - 1)), false, 'the run kicks the drift out of its cell');
assert.ok(softDrifts.metrics().settling > 0, 'the ploughed volume hangs airborne before settling');
assert.ok(flakeCalls.length > 0 && flakeCalls[0].opts.mat === 'leaves', 'the plough bursts into leaf flakes');
assert.ok(notes.includes('soft_drifts'), 'the first plough by the player lands in the discovery journal');
advance(2);
{
  const same = DBG.cells.get('100,' + (SURF - 1));
  const wake = DBG.cells.get('99,' + (SURF - 1));
  const ahead = DBG.cells.get('101,' + (SURF - 1));
  assert.equal(same && same.u, 5, '50% settles back in place after a moment');
  assert.equal(wake && wake.u, 4, "40% lands in the runner's wake");
  assert.equal(ahead && ahead.u, 1, '10% lands ahead of the run');
  let total = 0, offRow = 0;
  for(const c of DBG.cells.values()){ total += c.u; if(c.y !== SURF - 1) offRow++; }
  assert.equal(total, 10, 'nothing vanishes');
  assert.equal(offRow, 0, 'airborne fluff only lands in the SAME row — never up or down a slope');
}

// --- 5a. LANDING in a drift thumps it aside: 50% in place, 25% per side ------
reset();
DBG.cells.set('120,' + (SURF - 1), { x: 120, y: SURF - 1, m: 'snow', u: 8 });
player.x = 120.5; player.y = SURF - 0.05; player.vx = 0; player.vy = 6; // falling fast
forceSweep(); // the sweep sees the fall…
player.vy = 0; // …physics zeroes vy on the impact frame…
forceSweep(); // …and the TRANSITION is the thump
assert.equal(DBG.cells.has('120,' + (SURF - 1)), false, 'the landing thump kicks the drift apart');
advance(2);
{
  const same = DBG.cells.get('120,' + (SURF - 1));
  const left = DBG.cells.get('119,' + (SURF - 1));
  const right = DBG.cells.get('121,' + (SURF - 1));
  assert.equal(same && same.u, 4, '50% settles back where you landed');
  assert.equal(left && left.u, 2, '25% puffs out to the left');
  assert.equal(right && right.u, 2, '25% puffs out to the right');
}

// --- 5a2. a blocked side redirects its share back onto the source ------------
reset();
setTile(131, SURF - 1, T.GRASS); // wall to the right: that cell is not in-row receptive
DBG.cells.set('130,' + (SURF - 1), { x: 130, y: SURF - 1, m: 'sand', u: 8 });
player.x = 130.5; player.y = SURF - 0.05; player.vx = 0; player.vy = 6;
forceSweep(); player.vy = 0; forceSweep();
advance(2);
{
  const same = DBG.cells.get('130,' + (SURF - 1));
  const left = DBG.cells.get('129,' + (SURF - 1));
  let total = 0;
  for(const c of DBG.cells.values()) total += c.u;
  assert.equal(total, 8, 'a blocked side loses nothing');
  assert.equal(left && left.u, 2, 'the open side takes its 25%');
  assert.equal(same && same.u, 6, 'the blocked share settles back onto the source cell');
}

// --- 5a3. a coop body ploughs exactly like the host hero ---------------------
reset();
DBG.cells.set('160,' + (SURF - 1), { x: 160, y: SURF - 1, m: 'snow', u: 5 });
MM.coopBodies = [{ x: 160.5, y: SURF - 0.05, w: 0.7, h: 0.95, vx: 4, vy: 0 }];
forceSweep();
MM.coopBodies = [];
assert.equal(DBG.cells.has('160,' + (SURF - 1)), false, 'a coop body at speed ploughs the drift too');
advance(2);
{
  let total = 0;
  for(const c of DBG.cells.values()) total += c.u;
  assert.equal(total, 5, 'the coop plough conserves the volume as well');
}

// --- 5a4. the minted LEAF_PILE tile shreds into a FULL block of litter -------
reset();
setTile(140, SURF - 1, T.LEAF_PILE);
player.x = 140.5; player.y = SURF - 0.05; player.vx = 3;
forceSweep();
player.vx = 0;
assert.equal(getTile(140, SURF - 1), T.AIR, 'running through a leaf pile shreds it back to air');
assert.ok(flakeCalls.some(f => f.opts.mat === 'leaves' && f.opts.count >= 10), 'the pile bursts into a big leaf shower');
advance(2);
{
  let total = 0, piles = 0;
  for(const c of DBG.cells.values()) if(c.m === 'leaves') total += c.u;
  for(let x = 130; x <= 150; x++) for(let y = SURF - 6; y <= SURF; y++) if(getTile(x, y) === T.LEAF_PILE) piles++;
  assert.equal(total, softDrifts.UNITS, 'the shredded block spreads its full volume, split like a run plough');
  assert.equal(piles, 0, 'the split never instantly re-mints a pile');
  assert.equal((DBG.cells.get('139,' + (SURF - 1)) || {}).u, 4, "the block's wake share lands behind the runner");
}

// --- 5b. materials do not mix in one cell: a new fall grinds the old down ----
reset();
DBG.cells.set('80,' + (SURF - 1), { x: 80, y: SURF - 1, m: 'snow', u: 5 });
for(let i = 0; i < 3; i++) DBG.addUnits(80, 'leaves', getTile, setTile);
{
  const c = DBG.cells.get('80,' + (SURF - 1));
  assert.ok(c && c.m === 'snow' && c.u === 2, 'each falling leaf erodes one unit of the snow cover first');
}
for(let i = 0; i < 3; i++) DBG.addUnits(80, 'leaves', getTile, setTile);
{
  const c = DBG.cells.get('80,' + (SURF - 1));
  assert.ok(c && c.m === 'leaves' && c.u === 1, 'once the old cover is gone the new material claims the cell');
}

// --- 5d. left alone, everything soft fades over ~FADE_DAYS of game time ------
CFG.FADE_DAYS = 1; // back to the shipping fade scale
reset();
// a season accelerator would OVERRIDE the compressed baseline below (spring
// rot is 0.10/tick — slower than the test's 0.29 pBase) and flake the fade
prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 0 };
windSpeed = 0;
DBG.cells.set('60,' + (SURF - 1), { x: 60, y: SURF - 1, m: 'leaves', u: 5 });
player.x = 60;
advance(10);
assert.equal(softDrifts.count(), 1, 'at the 1-day fade scale a drift survives a quiet stretch');
{
  const fadeWas = CFG.FADE_DAYS;
  CFG.FADE_DAYS = 0.02; // compress the day so the test can watch a full fade
  // 60 s at the compressed scale: the per-tick fade roll is stochastic and a
  // 30 s window still had a rare tail where 5 units survived (observed in the
  // full check chain) — double the budget instead of chasing the RNG
  advance(60);
  assert.equal(softDrifts.count(), 0, 'left alone, the drift fades away within the configured day');
  CFG.FADE_DAYS = fadeWas;
}

// --- 6. ghost 'drift' plane: bounded windows, watcher-side poof inference ----
reset();
DBG.cells.set('5,29', { x: 5, y: 29, m: 'snow', u: 6 });
DBG.cells.set('6,29', { x: 6, y: 29, m: 'leaves', u: 3 });
{
  const rows = softDrifts.ghostLevelsIn(0, 20, 10, 35);
  assert.equal(rows.length, 2, 'the host reads drift rows inside the window');
  softDrifts.reset();
  const n = softDrifts.ghostApplyLevelsWindow(0, 20, 10, 35, rows);
  assert.equal(n, 2, 'the watcher applies the streamed rows');
  assert.equal(DBG.cells.get('5,29').m, 'snow', 'material survives the wire roundtrip');
  assert.equal(DBG.cells.get('6,29').u, 3, 'units survive the wire roundtrip');
  // a cell the host cleared at level >=4 poofs into flakes on the watcher
  flakeCalls.length = 0;
  softDrifts.ghostApplyLevelsWindow(0, 20, 10, 35, [[6, 29, 3, 1]]);
  assert.equal(softDrifts.count(), 1, 'the window is authoritative — stale cells clear');
  assert.ok(flakeCalls.length > 0 && flakeCalls[0].opts.mat === 'snow', 'the cleared >=4 cell poofs into flakes for the watcher');
  // garbage rows are refused, oversized windows are clamped
  const bad = softDrifts.ghostApplyLevelsWindow(0, 20, 9999, 9999, [[2, 29, 99, 0], [3, 29, 0, 0], ['x', 29, 5, 0]]);
  assert.equal(bad, 0, 'out-of-range units and bogus coordinates are refused');
}

// --- 7. jesienna zamieć: a real gale carries leaves DOWNWIND of the trees ----
reset();
canopy = true;
player.x = 12;
prof = { snowStrength: 0, leafDropStrength: 1, leafGrowStrength: 0 };
windSpeed = 2.0;
advance(3);
assert.equal(softDrifts.metrics().storm.active, false, 'a mild autumn breeze is not a gale');
windSpeed = 6.0;
advance(30);
{
  const m = softDrifts.metrics();
  assert.equal(m.storm.active, true, 'autumn + gale-force wind reads as a leaf storm');
  assert.equal(m.storm.mat, 'leaves', 'the natural autumn gale carries leaves');
  assert.ok(m.storm.blownIn > 0, `the gale blows litter in (${m.storm.blownIn})`);
  let downwind = 0;
  for(const c of DBG.cells.values()) if(c.m === 'leaves' && c.x > 16) downwind++;
  assert.ok(downwind > 0, `litter lands downwind, beyond the canopy shadow (${downwind})`);
}
windSpeed = 0;
advance(4);
assert.equal(softDrifts.metrics().storm.active, false, 'the gale dies with the wind');

// --- 8. śnieżna zamieć: winter gale blows snow off upwind snowfields ---------
// The real winter profile keeps leafDropStrength HIGH (the last leaves fall) —
// the freezing gale must still read as a snow blizzard, never a leaf storm.
reset();
player.x = 0;
prof = { snowStrength: 1, leafDropStrength: 1, leafGrowStrength: 0 };
colTemp = 0.2;
windSpeed = 6.5;
DBG.cells.set('-6,' + (SURF - 1), { x: -6, y: SURF - 1, m: 'snow', u: 8 });
advance(25);
{
  const m = softDrifts.metrics();
  assert.equal(m.storm.active, true, 'winter + gale-force cold wind reads as a snow blizzard');
  assert.equal(m.storm.mat, 'snow', 'snow takes precedence over the winter leaf drop (frozen leaves do not fly)');
  assert.ok(m.storm.blownIn > 0, `the blizzard blows fresh snow in (${m.storm.blownIn})`);
  assert.equal(m.storm.moved, undefined, 'landed drifts LIE STILL — no passive downwind marching survives in the metrics');
}
// warm climate refuses the snow gale even in a winter wind
colTemp = 0.7;
advance(6);
assert.equal(softDrifts.metrics().storm.mat === 'snow' && softDrifts.metrics().storm.active, false,
  'a warm column cannot host a snow blizzard');

// --- 8b. summoned blizzard: the ICE_SHAMAN's clouds drive the snow gale ------
reset();
player.x = 0;
prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 0 }; // NOT winter
colTemp = 0.2;
windSpeed = 6.5;
advance(4);
assert.equal(softDrifts.metrics().storm.active, false, 'cold wind alone is no blizzard out of season');
cloudsSnowing = true; // the summoned blizzard snows overhead
advance(6);
{
  const m = softDrifts.metrics();
  assert.equal(m.storm.active, true, 'a summoned blizzard drives the snow gale out of season');
  assert.equal(m.storm.mat, 'snow', 'the summoned gale carries snow');
}
cloudsSnowing = false;
advance(5);
assert.equal(softDrifts.metrics().storm.active, false, 'the gale fades when the summoned blizzard ends');

// --- 8c. pustynna zamieć: desert wind + the sandstorm/ritual coupling --------
reset();
player.x = 0;
desertClimate = 0.85;
windSpeed = 6.0;
advance(30);
{
  const m = softDrifts.metrics();
  assert.equal(m.storm.active, true, 'gale-force wind over the desert reads as a sand gale');
  assert.equal(m.storm.mat, 'sand', 'the desert gale carries sand');
  assert.ok(m.byMat.sand > 0, `fine sand films the ground (${m.byMat.sand})`);
}
advance(30);
{
  const m = softDrifts.metrics();
  assert.ok(m.minted.sand > 0, `full sand drifts mint UNSTABLE_SAND dunes (${m.minted.sand})`);
  assert.ok(maxStack(T.UNSTABLE_SAND, -8, 8) <= DBG.MATS.sand.stackMax,
    `drift-minted dunes respect the ${DBG.MATS.sand.stackMax}-tile cap`);
}
// ritual coupling: no natural wind at all — a forced (FIRE_SHAMAN) sandstorm
// alone drives the fine-sand gale at its own intensity
reset();
desertClimate = 0.85;
sandstormK = 0.9;
advance(3);
{
  const m = softDrifts.metrics();
  assert.equal(m.storm.active, true, 'a ritual sandstorm drives the sand gale without any wind');
  assert.equal(m.storm.mat, 'sand', 'the adopted gale carries sand');
}
sandstormK = 0;
advance(5);
assert.equal(softDrifts.metrics().storm.active, false, 'the sand gale dies with the sandstorm');

// --- 9. forced gales are owner-scoped (ritual contract) ----------------------
reset();
assert.equal(softDrifts.startStorm('plasma', 30, 1, {}), null, 'unknown materials cannot be forced');
// the smog gale is conjured-only: the soot shaman (or debug menu) forces it,
// and while it runs the black fall needs no smoke source at all
{
  const smog = softDrifts.startStorm('soot', 30, 0.9, { source: 'qa', ownerId: 'S' });
  assert.ok(smog && smog.mat === 'soot', 'the soot gale can be conjured');
  advance(12);
  assert.ok(softDrifts.metrics().byMat.soot > 0, `a conjured smog films the ground from thin air (${softDrifts.metrics().byMat.soot})`);
  assert.equal(softDrifts.stopStorm({ ownerId: 'S' }), true, 'the conjurer stops the smog');
}
reset();
{
  const t = softDrifts.startStorm('leaves', 30, 0.8, { source: 'qa', ownerId: 'A' });
  assert.ok(t && t.mat === 'leaves', 'a forced leaf gale starts');
  advance(0.5);
  assert.equal(softDrifts.metrics().storm.active, true, 'the forced gale is live without any wind');
  assert.equal(softDrifts.stopStorm({ ownerId: 'B' }), false, 'a different owner cannot stop it');
  assert.equal(softDrifts.stopStorm({ ownerId: 'A' }), true, 'its owner stops it');
  advance(2);
  assert.equal(softDrifts.metrics().storm.active, false, 'the gale is gone after the owner stop');
}

// --- 10. gale state rides the drift plane, sanitized on the watcher ----------
reset();
softDrifts.startStorm('snow', 30, 0.9, { source: 'qa' });
advance(0.5);
{
  const wire = softDrifts.ghostStormOut();
  assert.ok(Array.isArray(wire) && wire[0] === 0 && wire[1] >= 80 && Math.abs(wire[2]) === 1,
    'ghostStormOut encodes [wireMat, intensity 0..100, dir]');
  softDrifts.reset();
  assert.equal(softDrifts.ghostApplyStorm([9, 90, 1]), false, 'an unknown wire id is refused on the watcher');
  assert.equal(softDrifts.ghostApplyStorm([2, 90, 1]), true, 'the conjured smog gale mirrors to the watcher');
  assert.equal(softDrifts.ghostApplyStorm([1, 250, 1]), true, 'intensity is clamped, not trusted');
  assert.ok(DBG.ghostStormNow() && DBG.ghostStormNow().k === 1, 'clamped mirror intensity');
  softDrifts.ghostApplyStorm(null);
  assert.equal(DBG.ghostStormNow(), null, 'a null gale clears the mirror');
}

// --- 10b. debug seams: seedAround pours by the SAME rules, clearAll wipes ----
reset();
{
  const landed = softDrifts.seedAround(0, 3, 'leaves', 6, getTile, setTile);
  assert.equal(landed, 42, 'a debug pour lands 6 units in each of the 7 flat columns');
  assert.equal(softDrifts.count(), 7, 'one drift cell per column');
  assert.equal(softDrifts.seedAround(0, 3, 'lava', 6, getTile, setTile), 0, 'unknown materials are refused');
  assert.ok(softDrifts.seedAround(200, 9999, 'snow', 1, getTile, setTile) <= 49, 'the pour radius is clamped');
  const wiped = softDrifts.clearAll();
  assert.ok(wiped > 0 && softDrifts.count() === 0, 'clearAll wipes the fluff ledger');
}

// --- 11. audit hardening: scan budget, eviction, poof budget, storm clamps ---
reset();
{
  // an open mineshaft is not a surface — the bounded scan refuses it instead
  // of probing hundreds of rows every tick
  for(let y = SURF; y < SURF + 200; y++) setTile(300, y, T.AIR);
  assert.equal(DBG.surfaceCell(300, getTile), null, 'a deep open shaft yields no drift surface (bounded scan)');
  // map-cap eviction prefers a far-away stale cell over the oldest entry
  const capWas = CFG.MAP_CAP;
  CFG.MAP_CAP = 4;
  for(let i = 0; i < 4; i++) DBG.cells.set((500 + i) + ',' + (SURF - 1), { x: 500 + i, y: SURF - 1, m: 'snow', u: 3 });
  assert.equal(DBG.addUnits(0, 'snow', getTile, setTile), true, 'a full map still accepts a fresh near cell');
  assert.ok(DBG.cells.has('0,' + (SURF - 1)), 'the fresh cell landed');
  assert.equal(DBG.cells.size, 4, 'the cap held — a far stale cell was evicted for it');
  CFG.MAP_CAP = capWas;
  // watcher-side poof inference is budgeted per applied window
  softDrifts.reset();
  for(let i = 0; i < 20; i++) DBG.cells.set(i + ',29', { x: i, y: 29, m: 'snow', u: 6 });
  flakeCalls.length = 0;
  softDrifts.ghostApplyLevelsWindow(0, 20, 30, 35, []);
  assert.ok(flakeCalls.length > 0 && flakeCalls.length <= CFG.POOF_BUDGET,
    `cleared-cell poofs stay within the budget (${flakeCalls.length} <= ${CFG.POOF_BUDGET})`);
  // forced gales cannot be made eternal
  softDrifts.reset();
  const eternal = softDrifts.startStorm('leaves', 999999, 1, {});
  assert.ok(eternal && eternal.duration <= CFG.STORM_MAX_SECONDS, `forced duration is clamped (${eternal.duration})`);
  softDrifts.stopStorm();
}

// --- 12. drawStorm: sim-hold spawn gate + underground fade -------------------
reset();
{
  const gfx = { fills: 0, save(){}, restore(){}, fillRect(){ this.fills++; }, createLinearGradient(){ return { addColorStop(){} }; } };
  softDrifts.startStorm('snow', 30, 0.9, {});
  advance(0.3); // stormUpd publishes the view
  player.x = 200; player.y = SURF - 2;
  flakeCalls.length = 0;
  // held sim (pause/ceremony): the haze may draw but no flakes stream
  softDrifts.drawStorm(gfx, 20, 190, 20, 40, 20, false);
  await new Promise(r => setTimeout(r, 150));
  softDrifts.drawStorm(gfx, 20, 190, 20, 40, 20, false);
  assert.equal(flakeCalls.length, 0, 'a held sim spawns no storm flakes (they could not age)');
  assert.ok(gfx.fills > 0, 'the haze itself still draws under the pause dim');
  // live sim: flakes stream into the view
  await new Promise(r => setTimeout(r, 150));
  softDrifts.drawStorm(gfx, 20, 190, 20, 40, 20, true);
  await new Promise(r => setTimeout(r, 200));
  softDrifts.drawStorm(gfx, 20, 190, 20, 40, 20, true);
  assert.ok(flakeCalls.length > 0, `a live sim streams storm flakes (${flakeCalls.length})`);
  // deep underground the gale fades out entirely — no white-out in a mine
  gfx.fills = 0;
  flakeCalls.length = 0;
  player.y = SURF + 25;
  await new Promise(r => setTimeout(r, 150));
  softDrifts.drawStorm(gfx, 20, 190, 20, 40, 20, true);
  assert.equal(gfx.fills + flakeCalls.length, 0, 'a hero deep underground sees no gale haze or flakes');
  player.y = SURF - 2;
  softDrifts.stopStorm();
}

// --- 13. pinned source shapes: the seams this system rides on ----------------
const here = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(join(here, '../src/main.js'), 'utf8');
const hostSrc = readFileSync(join(here, '../src/engine/ghost_host.js'), 'utf8');
const clientSrc = readFileSync(join(here, '../src/engine/ghost_client.js'), 'utf8');
const particlesSrc = readFileSync(join(here, '../src/engine/particles.js'), 'utf8');
const discoverySrc = readFileSync(join(here, '../src/engine/discovery.js'), 'utf8');
const uiSrc = readFileSync(join(here, '../src/engine/ui.js'), 'utf8');

assert.equal((mainSrc.match(/SOFT_DRIFTS\.update\(/g) || []).length, 1,
  'exactly ONE soft-drift step call in main.js — the host/solo world step (runHeroStep must never simulate the world)');
assert.ok(/if\(SANDSTORM && SANDSTORM\.update\) SANDSTORM\.update\(getTile, setTile, dt\);\s*\n\s*if\(SOFT_DRIFTS && SOFT_DRIFTS\.update\) SOFT_DRIFTS\.update\(dt, player, getTile, setTile\);/.test(mainSrc),
  'the drift step rides the weather block of the world step, right after the sandstorm');
assert.ok(/if\(SOFT_DRIFTS && SOFT_DRIFTS\.draw\) SOFT_DRIFTS\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible\);/.test(mainSrc),
  'drift mounds render fog-gated in the world pass');
assert.ok(/if\(SOFT_DRIFTS && SOFT_DRIFTS\.reset\) SOFT_DRIFTS\.reset\(\);/.test(mainSrc),
  'world regen clears the drift ledger');

assert.ok(/drift: 700/.test(hostSrc) && /function driftTick\(s, t\)/.test(hostSrc),
  'the host streams the drift plane on its own cadence');
assert.ok(/if\(!any && !s\.driftWas\) return;/.test(hostSrc) && /s\.lastDriftSig = sig;/.test(hostSrc),
  'the drift plane latches (a clearing packet follows the last dusty one) and sig-skips duplicates');
assert.ok(/const packet = \{ t: 'drift', w: payload, p: printsPayload, i: icePayload \};/.test(hostSrc) && /if\(gale\) packet\.s = gale;/.test(hostSrc),
  'drift windows broadcast as their own packet type, with footprints, icicles and the gale riding along');
assert.ok(/D\.ghostPrintsIn \? \(D\.ghostPrintsIn\(w\[0\], w\[1\], w\[2\], w\[3\]\) \|\| \[\]\) : \[\]/.test(hostSrc),
  'the host reads footprint windows from soft_drifts');
assert.ok(/D\.ghostApplyPrintsWindow\(\+w\[0\], \+w\[1\], \+w\[2\], \+w\[3\], w\[4\]\);/.test(clientSrc),
  'the watcher applies footprint windows display-only');
assert.ok(/IC\.ghostApplyIciclesWindow\(\+w\[0\], \+w\[1\], \+w\[2\], \+w\[3\], w\[4\]\);/.test(clientSrc),
  'the watcher applies icicle windows display-only');
assert.ok(/gale = D\.ghostStormOut \? D\.ghostStormOut\(\) : null;/.test(hostSrc) && /if\(gale\) any = true;/.test(hostSrc),
  'an active gale counts as plane activity (a storm with no drifts yet still streams)');
assert.ok(/pl\.t === 'drift'/.test(clientSrc) && /D\.ghostApplyLevelsWindow\(\+w\[0\], \+w\[1\], \+w\[2\], \+w\[3\], w\[4\]\);/.test(clientSrc),
  'the watcher applies drift windows display-only');
assert.ok(/D\.ghostApplyStorm\(Array\.isArray\(pl\.s\) \? pl\.s : null\);/.test(clientSrc),
  'the watcher mirrors the gale from the same packet (null clears it)');
assert.ok(/timers\.drift \|\| 0\) < 200/.test(clientSrc), 'the drift apply is rate-floored against hostile spam');
assert.ok(/if\(SOFT_DRIFTS && SOFT_DRIFTS\.drawStorm\) SOFT_DRIFTS\.drawStorm\(ctx,TILE,sx,sy,viewX,viewY,!paused && !uiOverlayHold\(\)\);/.test(mainSrc),
  'the gale haze draws right after the sandstorm haze, with flake spawning gated on the sim hold');
assert.equal((discoverySrc.match(/leaf_gale/g) || []).length, 2, 'the leaf-gale discovery is registered in both catalog tables');
assert.equal((discoverySrc.match(/snow_gale/g) || []).length, 2, 'the snow-gale discovery is registered in both catalog tables');

assert.ok(/function injectDriftDebugPanel\(actions, menuPanel\)/.test(uiSrc) && /driftDebugBox/.test(uiSrc)
  && /Zaspy i zamiecie \(debug\):/.test(uiSrc),
  'the developer toolbox carries the drift/gale panel');
assert.ok(/'Zamiec sniezna'/.test(uiSrc) && /'Zamiec lisciowa'/.test(uiSrc) && /'Zamiec piaskowa'/.test(uiSrc) && /'Zamiec sadzy'/.test(uiSrc),
  'every gale — snow, leaves, sand, soot — has a force button in the toolbox');
assert.ok(/'Usyp snieg'/.test(uiSrc) && /'Usyp liscie'/.test(uiSrc) && /'Usyp sadze'/.test(uiSrc) && /'Usyp piasek'/.test(uiSrc),
  'every material has a pour button in the toolbox');
assert.ok(/injectDriftDebugPanel,/.test(uiSrc), 'the panel is registered in the ui api aggregate');
assert.ok(/if\(MM\.ui && MM\.ui\.injectDriftDebugPanel\) MM\.ui\.injectDriftDebugPanel\(\{/.test(mainSrc)
  && /SOFT_DRIFTS\.startStorm\(mat, 60, 0\.95, \{source:'debug'\}\)/.test(mainSrc)
  && /SOFT_DRIFTS\.seedAround\(Math\.floor\(player\.x\), 9, mat, 6, getTile, setTile\)/.test(mainSrc)
  && /SOFT_DRIFTS\.clearAll\(\)/.test(mainSrc),
  'main.js wires the drift debug panel to the module seams (gale/seed/clear/metrics)');

assert.ok(/spawnFlakes/.test(particlesSrc) && /kind==='flake'/.test(particlesSrc),
  'particles carry the flake kind the drifts burst into');
assert.equal((discoverySrc.match(/soft_drifts/g) || []).length, 2,
  'the soft_drifts discovery is registered in both catalog tables');

console.log('soft-drifts-sim: all assertions passed');
