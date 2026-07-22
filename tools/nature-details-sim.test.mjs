// Nature-details wave regressions (2026-07-19):
//   * falling.js hover-pile: entities resting on a body spread into a mound
//     (one entity per cell; overflow is shed sideways) instead of overlapping
//   * avalanche.js: a deep snow slab on a slope releases downhill on a shock
//   * icicles.js: cold overhangs grow icicles that drip, drop on a thaw and
//     leave collectible ice
//   * thin_ice.js: frozen lake sheet — glaze, creak, break back to WATER
//   * geothermal.js: lava heats rock/metal heats water — organic hot springs
//   * sky_moods.js: dawn valley fog (mob sight shrinks) + cold-night aurora
//   * weather_instruments.js: live-wind weathervane + bolt-banking rod
//   * graffiti.js: whitelisted soot stencils on backed cells, save + wire
//   * soft_drifts: footprints (incl. wire windows) + dirty-snow stain rule
//   * mobs.js nature drives + fog sight multiplier (source + pure fns)
// Run: node tools/nature-details-sim.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.window = globalThis;
globalThis.MM = {};

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', p), 'utf8');

const { T, INFO, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
MM.T = T;
MM.TILE = 20;

// --- shared configurable stub world -----------------------------------------
let surfFn = () => 30;
let climate = 0.5;
MM.worldGen = { surfaceHeight: (x) => surfFn(x), temperature: () => climate };
let colTemp = 0.5;
let prof = { snowStrength: 0, leafDropStrength: 0, leafGrowStrength: 0 };
MM.seasons = { profile: () => prof, temperatureAt: () => colTemp };
let windNow = 0, cloudinessNow = 0.3;
MM.wind = { speed: () => windNow, metrics: () => ({ cloudiness: cloudinessNow }) };
let cycle = { isDay: true, tDay: 0.5, tNight: 0 };
MM.background = { getCycleInfo: () => cycle };
const audioCalls = [];
MM.audio = { play: (k) => audioCalls.push(k) };
const notes = [];
MM.discovery = { note: (k) => notes.push(k) };
const flakeCalls = [];
MM.particles = { spawnFlakes: (x, y, o) => flakeCalls.push({ x, y, o }), spawnSplash: () => {}, spawnSparks: () => {} };
const iceDrops = [];
MM.drops = { spawnResource: (x, y, res, qty) => { iceDrops.push({ x, y, res, qty }); return { id: 1 }; } };
let heroEnergyAdded = 0;
MM.heroEnergy = { add: (n) => { heroEnergyAdded += n; } };
MM.water = { levelAt: () => 10, UNITS: 10, onTileChanged: () => {}, disturb: () => {} };
MM.coopBodies = [];

const tiles = new Map();
const key = (x, y) => Math.floor(x) + ',' + Math.floor(y);
function baseTile(x, y){
  const s = surfFn(Math.floor(x));
  return y < s ? T.AIR : T.STONE;
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
function resetWorld(){ tiles.clear(); }

globalThis.player = { x: 200, y: 28.5, w: 0.7, h: 0.95, vx: 0, vy: 0, hp: 50, maxHp: 100 };

// ============================================================================
// 0) tile + material contracts for the new solids
// ============================================================================
{
  const MP = await import('../src/engine/material_physics.js');
  assert.equal(INFO[T.THIN_ICE].thinIce, true, 'THIN_ICE advertises itself');
  assert.equal(INFO[T.THIN_ICE].drop, null, 'THIN_ICE never drops a resource (it melts back to water)');
  assert.equal(MP.materialPhysicsRoute(T.THIN_ICE), 'natural-hazard', 'thin ice rides the natural-hazard route');
  // machines route as rigid objects: an unsupported instrument pops loose and
  // falls instead of hovering (objectAnchorAt), while staying walk-through
  assert.equal(MP.materialPhysicsRoute(T.LIGHTNING_ROD), 'rigid-object', 'the rod is a rigid machine fixture');
  assert.equal(MP.materialPhysicsRoute(T.WEATHERVANE), 'rigid-object', 'the vane is a rigid machine fixture');
  assert.equal(MP.isPassableForFalling(T.LIGHTNING_ROD), true, 'falling material passes through the thin mast');
  assert.equal(INFO[T.LIGHTNING_ROD].powerSource, true, 'the rod is a power source');
  assert.equal(INFO[T.LIGHTNING_ROD].energyCapacity, 120, 'rod capacity pinned (mirrors weather_instruments CFG)');
  console.log('scenario 0 (tile contracts) ok');
}

// ============================================================================
// 1) falling.js hover-pile: no two resting entities share a cell over a body
// ============================================================================
const { fallingSolids } = await import('../src/engine/falling.js');
{
  resetWorld();
  surfFn = () => 30;
  player.x = 5.5; player.y = 29.5; player.vx = 0; player.vy = 0;
  fallingSolids.reset();
  for(let i = 0; i < 5; i++) fallingSolids.spawnLoose(5, 20 - i * 2, T.SNOW);
  for(let i = 0; i < 120; i++) fallingSolids.update(getTile, setTile, 0.05);
  const snap = fallingSolids.snapshot();
  const resting = (snap.active || []).filter(b => b.vy === 0);
  const cells = new Set();
  for(const b of resting){
    const k = b.x + ',' + Math.floor(b.y);
    assert.ok(!cells.has(k), 'hover-pile: no two resting entities overlap one cell (' + k + ')');
    cells.add(k);
    // the crown rule: nothing may rest INSIDE the body footprint (5,29 is the
    // hero cell) — the load rides ON the head, never across the torso
    assert.ok(k !== '5,29', 'no resting entity overlaps the body cell itself');
  }
  // the shed mass settled as real tiles NEXT to the body instead of towering
  const besides = [getTile(4, 29), getTile(6, 29), getTile(4, 28), getTile(6, 28)].filter(t => t === T.SNOW).length;
  assert.ok(besides + resting.length >= 3, 'the pile spread around the body (tiles beside + hovering mound)');
  const fallingSrc = src('src/engine/falling.js');
  assert.match(fallingSrc, /function restOnBody\(e,x,y\)/, 'the hover-pile resolver exists');
  assert.match(fallingSrc, /hoverClaims\.clear\(\); \/\/ hover-pile claims live one frame/, 'claims are rebuilt every frame');
  assert.match(fallingSrc, /restOnBody\(b,b\.x,settledAt\)/, 'rigid entities route through the resolver');
  assert.match(fallingSrc, /restOnBody\(s,s\.x,yi\)/, 'sand grains route through the resolver');
  console.log('scenario 1 (hover-pile) ok');
}

// ============================================================================
// 2) avalanche: a deep slab on a slope releases downhill on a shock
// ============================================================================
const { avalanche } = await import('../src/engine/avalanche.js');
{
  resetWorld();
  fallingSolids.reset();
  avalanche.reset();
  // high shelf x<=9 (surface 20), low ground x>=10 (surface 27) — a real drop
  surfFn = (x) => (x <= 9 ? 20 : 27);
  // a 4-deep snow slab on the shelf edge
  for(let x = 4; x <= 9; x++) for(let d = 0; d < 4; d++) setTile(x, 20 + d, T.SNOW);
  // (snow occupies rows 20..23; put stone floor back under it)
  for(let x = 4; x <= 9; x++) for(let y = 24; y < 30; y++) setTile(x, y, T.STONE);
  avalanche.config.WAVE_STEP_MS = 0; // release the whole run in one frame
  const run = avalanche.disturb(7, 20, 2, getTile);
  assert.ok(run >= 2, 'the shock released a multi-column run (' + run + ')');
  avalanche.update(0.05, player, getTile, setTile);
  const m = avalanche.metrics();
  assert.ok(m.tilesReleased >= 4, 'the slab tore out tiles (' + m.tilesReleased + ')');
  assert.equal(getTile(7, 20), T.AIR, 'the top of the pack is gone');
  assert.ok(fallingSolids.metrics().active > 0 || fallingSolids.snapshot().active.length > 0
    || m.tilesReleased > 0, 'the mass re-entered the falling sim');
  assert.ok(notes.includes('avalanche'), 'the avalanche discovery fired');
  // spent columns cool down; the untouched pack NEXT DOOR may still slide (a
  // second legitimate avalanche), so probe the cooldown ledger directly
  assert.ok(avalanche._debug.colCooldown.size >= 2, 'released columns are marked spent');
  const spentX = [...avalanche._debug.colCooldown.keys()][0];
  assert.ok(avalanche._debug.colCooldown.get(spentX) > performance.now(), 'the cooldown is a future deadline');
  console.log('scenario 2 (avalanche) ok');
}

// ============================================================================
// 3) icicles: grow in the cold, drop on a thaw, leave collectible ice
// ============================================================================
const { icicles } = await import('../src/engine/icicles.js');
{
  resetWorld();
  icicles.reset();
  surfFn = () => 30;
  // an overhang: solid slab at y=10 (x 0..24), snow ON TOP of it, air below,
  // and a floor to shatter on
  for(let x = 0; x <= 24; x++){ setTile(x, 10, T.STONE); setTile(x, 9, T.SNOW); }
  player.x = 12; player.y = 13;
  colTemp = 0.2;
  icicles.update(2, player, getTile, setTile);
  const grown = icicles.metrics().hanging;
  assert.ok(grown >= 2, 'cold overhangs grew icicles (' + grown + ')');
  const lenBefore = [...icicles._debug.hang.values()][0].len;
  for(let i = 0; i < 100; i++) icicles.update(0.1, player, getTile, setTile);
  const lenAfter = [...icicles._debug.hang.values()][0].len;
  assert.ok(lenAfter > lenBefore, 'icicles grow while it stays cold');
  assert.ok(audioCalls.includes('drip'), 'the cave kap-kap drip fired');
  // thaw: everything lets go, shards fall, shatter, and some leave ice lumps
  for(const c of icicles._debug.hang.values()) c.len = 0.9; // mature teeth — the drop roll applies
  colTemp = 0.6;
  for(let i = 0; i < 80 && icicles.metrics().hanging + icicles.metrics().shards > 0; i++) icicles.update(0.1, player, getTile, setTile);
  assert.equal(icicles.metrics().hanging, 0, 'the thaw dropped every icicle');
  assert.ok(icicles.metrics().fallen >= grown, 'fallen counter tracks the drops');
  assert.ok(iceDrops.length >= 1 && iceDrops.every(d => d.res === 'ice'), 'big shards left collectible ice');
  assert.ok(notes.includes('icicle'), 'the icicle discovery fired');
  // wire windows: [x,y,len10] rows, display-only mirror on the watcher
  colTemp = 0.2;
  icicles.reset();
  icicles.update(2, player, getTile, setTile);
  const rows = icicles.ghostIciclesIn(0, 0, 24, 20);
  assert.ok(rows.length >= 2 && rows.every(r => r.length === 3 && r[2] >= 0 && r[2] <= 10), 'icicle wire rows are bounded triples');
  const applied = icicles.ghostApplyIciclesWindow(0, 0, 24, 20, rows);
  assert.equal(applied, rows.length, 'the watcher mirror applied the window');
  assert.equal(icicles.ghostApplyIciclesWindow(0, 0, 24, 20, [[3, 10, 99], ['x', 2, 3]]), 1, 'garbage rows are dropped, lengths clamped');
  // Scripted arena events need a bounded release seam.  A distant cave must
  // not shed its ceiling merely because a guardian changed phase elsewhere.
  icicles.reset();
  icicles._debug.hang.set('12,12', {x:12,y:12,len:0.8,maxLen:1,drip:5});
  icicles._debug.hang.set('212,12', {x:212,y:12,len:0.8,maxLen:1,drip:5});
  assert.equal(icicles.dropAround(12,12,20,10),1,'bounded icicle release drops only spikes inside its requested area');
  assert.equal(icicles._debug.hang.has('12,12'),false,'near icicle enters the falling-shard simulation');
  assert.equal(icicles._debug.hang.has('212,12'),true,'remote icicle remains attached after a local release');
  assert.equal(icicles.dropAround(NaN,12,20,10),0,'bounded icicle release rejects invalid centers without touching world state');
  // striking a hanging tip: a light poke, the spike shatters IN PLACE (no
  // falling shard that would hit the striker a second time), ice may drop
  icicles.reset();
  iceDrops.length = 0;
  let heroPokes = 0, pokeDmg = 0;
  globalThis.damageHero = (n) => { heroPokes++; pokeDmg = n; return true; };
  setTile(12, 12, T.STONE); // the spike needs its ceiling or validation culls it
  icicles._debug.hang.set('12,12', { x: 12, y: 12, len: 0.8, maxLen: 1, drip: 5 });
  // a STATIONARY body is never poked — the spike may even grow into it (AFK safety)
  player.x = 12.5; player.y = 13.6; player.vx = 0; player.vy = 0;
  icicles.update(0.05, player, getTile, setTile);
  assert.equal(heroPokes, 0, 'a motionless body under a spike takes nothing');
  assert.ok(icicles._debug.hang.has('12,12'), 'the spike stays hanging over the AFK body');
  player.vx = 1.2;
  icicles.update(0.05, player, getTile, setTile);
  assert.equal(heroPokes, 1, 'walking into a mature icicle pokes once');
  assert.equal(pokeDmg, icicles.config.STRIKE_DMG, 'the poke is the light STRIKE_DMG, not shard damage');
  assert.ok(!icicles._debug.hang.has('12,12'), 'the struck spike snapped off');
  assert.equal(icicles.metrics().shards, 0, 'a struck spike never becomes a falling shard');
  delete globalThis.damageHero;
  // per-icicle variation is deterministic from the cell (watcher parity)
  icicles.reset();
  icicles.update(2, player, getTile, setTile);
  const lens = [...icicles._debug.hang.values()].map(c => c.maxLen);
  assert.ok(new Set(lens.map(v => v.toFixed(3))).size > 1, 'icicles carry varied growth ceilings (' + lens.length + ' teeth)');
  assert.ok(lens.every(v => v >= icicles.config.MIN_MAX_LEN && v <= 1), 'variation stays inside the pinned band');
  console.log('scenario 3 (icicles) ok');
}

// ============================================================================
// 4) thin ice: glaze, creak under load, break back to the WATER it froze from
// ============================================================================
const { thinIce } = await import('../src/engine/thin_ice.js');
{
  resetWorld();
  thinIce.reset();
  audioCalls.length = 0;
  surfFn = () => 28; // lake basin: water surface at y=28
  for(let x = 0; x <= 9; x++){ setTile(x, 28, T.WATER); setTile(x, 29, T.WATER); }
  player.x = 30.5; player.y = 26.5; // on shore — never frozen in
  colTemp = 0.2;
  thinIce.config.BAND = 40;
  // 140 half-second ticks: the freeze pass samples RANDOM columns each tick,
  // and a 60-tick budget left a ~20% tail where only 5/10 columns glazed
  for(let i = 0; i < 140 && thinIce.metrics().frozen < 6; i++) thinIce.update(0.5, player, getTile, setTile);
  assert.ok(thinIce.metrics().frozen >= 6, 'the frost glazed the lake (' + thinIce.metrics().frozen + ')');
  const pane = [...thinIce._debug.panes.values()][0];
  assert.equal(getTile(pane.x, pane.y), T.THIN_ICE, 'the surface water became THIN_ICE');
  assert.equal(getTile(pane.x, pane.y + 1), T.WATER, 'only the surface froze');
  // walk out: stress builds, the pane creaks, then breaks into water
  player.x = pane.x + 0.5; player.y = pane.y - 0.6; player.vy = 0;
  let broke = false;
  for(let i = 0; i < 80; i++){
    thinIce.update(0.05, player, getTile, setTile);
    if(getTile(pane.x, pane.y) === T.WATER){ broke = true; break; }
  }
  assert.ok(broke, 'a standing body eventually breaks the pane');
  assert.ok(audioCalls.includes('creak'), 'the pane creaked before breaking');
  assert.ok(notes.includes('thin_ice'), 'the thin-ice discovery fired');
  assert.ok(thinIce.metrics().broken >= 1, 'break metric counts');
  // thaw: warm samples melt the glaze back to open water on their own
  // Center the sampler over this tiny synthetic lake. Keeping the player thirty
  // columns away made the random-column integration check needlessly flaky even
  // though real lakes span far more than ten cells.
  player.x = 4.5; player.y = 20.5;
  thinIce.config.BAND = 10;
  colTemp = 0.6;
  for(let i = 0; i < 200 && thinIce.metrics().melted < 2; i++) thinIce.update(0.5, player, getTile, setTile);
  assert.ok(thinIce.metrics().melted >= 2, 'a thaw gives the glaze back to the lake');
  console.log('scenario 4 (thin ice) ok');
}

// ============================================================================
// 5) geothermal: conduction — lava -> rock/metal -> warm water; hero comfort
// ============================================================================
const { geothermal } = await import('../src/engine/geothermal.js');
{
  resetWorld();
  geothermal.reset();
  surfFn = () => 40;
  // organic spring: water on a stone bed with lava right under it
  setTile(5, 26, T.WATER);
  setTile(5, 27, T.STONE);
  setTile(5, 28, T.LAVA);
  assert.ok(geothermal.heatAt(5, 27, getTile) >= geothermal.config.WARM_AT, 'the bed rock is hot');
  assert.equal(geothermal.warmWaterAt(5, 26, getTile), true, 'water over hot rock is a warm pool');
  // a cold pool: same shape but the lava is far away through earth
  setTile(15, 26, T.WATER);
  setTile(15, 27, T.STONE);
  for(let d = 28; d <= 33; d++) setTile(15, d, T.DIRT);
  setTile(15, 34, T.LAVA);
  assert.equal(geothermal.warmWaterAt(15, 26, getTile), false, 'earth insulates — no spring');
  // metal conducts where stone cannot: a steel spine down to the same depth
  setTile(25, 26, T.WATER);
  setTile(25, 27, T.STEEL);
  for(let d = 28; d <= 31; d++) setTile(25, d, T.STEEL);
  setTile(25, 32, T.LAVA);
  assert.equal(geothermal.warmWaterAt(25, 26, getTile), true, 'a metal spine carries the heat up');
  setTile(35, 26, T.WATER);
  setTile(35, 27, T.STONE);
  for(let d = 28; d <= 31; d++) setTile(35, d, T.STONE);
  setTile(35, 32, T.LAVA);
  assert.equal(geothermal.warmWaterAt(35, 26, getTile), false, 'the same depth through stone stays cold');
  // hero comfort: soaking heals and flags the swim-chill exemption
  player.x = 5.5; player.y = 26.5; player.hp = 40; player.maxHp = 100;
  geothermal.updateHero(1, player, getTile);
  assert.equal(geothermal.heroInWarmWater(), true, 'the soak is flagged for the swim-chill exemption');
  assert.ok(player.hp > 40, 'the spring heals slowly');
  // pool registry feeds the mob bathing drive (random column sampling — spin it)
  for(let i = 0; i < 60 && !geothermal.poolsNear(5, 10).length; i++) geothermal._debug.poolScan(5, getTile);
  assert.ok(geothermal.poolsNear(5, 10).length >= 1, 'the pool registry found the spring');
  assert.ok(notes.includes('hot_spring'), 'the hot-spring discovery fired');
  console.log('scenario 5 (geothermal) ok');
}

// ============================================================================
// 6) sky moods: dawn valley fog shrinks mob sight; cold clear night = aurora
// ============================================================================
const { skyMoods } = await import('../src/engine/sky_moods.js');
{
  skyMoods.reset();
  // a valley at dawn, calm air
  surfFn = (x) => (Math.abs(x - 200) < 8 ? 34 : 27);
  cycle = { isDay: true, tDay: 0.03, tNight: 0 };
  windNow = 0.4;
  player.x = 200; player.y = 33;
  for(let i = 0; i < 80; i++) skyMoods.update(0.1, player);
  assert.ok(skyMoods.fogLevel() > 0.5, 'dawn valley fog builds (' + skyMoods.fogLevel().toFixed(2) + ')');
  assert.ok(skyMoods.mobSightMult() < 0.8, 'creature sight shrinks in the fog');
  assert.ok(notes.includes('morning_fog'), 'the fog discovery fired');
  // the sun climbs, the wind rises — the fog burns off
  cycle = { isDay: true, tDay: 0.5, tNight: 0 };
  for(let i = 0; i < 100; i++) skyMoods.update(0.1, player);
  assert.ok(skyMoods.fogLevel() < 0.1, 'midday burns the fog off');
  // aurora: cold clear night in a frozen climate + the energy trickle
  climate = 0.2; cloudinessNow = 0.2;
  cycle = { isDay: false, tDay: 0, tNight: 0.5 };
  heroEnergyAdded = 0;
  for(let i = 0; i < 80; i++) skyMoods.update(0.1, player);
  assert.ok(skyMoods.auroraLevel() > 0.4, 'the aurora lights up (' + skyMoods.auroraLevel().toFixed(2) + ')');
  assert.ok(heroEnergyAdded > 0, 'the charged sky trickles hero energy');
  assert.ok(notes.includes('aurora'), 'the aurora discovery fired');
  // cloud cover kills it
  cloudinessNow = 0.9;
  for(let i = 0; i < 120; i++) skyMoods.update(0.1, player);
  assert.ok(skyMoods.auroraLevel() < 0.1, 'an overcast sky hides the aurora');
  // debug pins
  skyMoods.forceMood('fog', 0.8);
  for(let i = 0; i < 40; i++) skyMoods.update(0.1, player);
  assert.ok(skyMoods.fogLevel() > 0.6, 'the debug pin forces the fog');
  skyMoods.forceMood('fog', 0);
  climate = 0.5; cloudinessNow = 0.3; cycle = { isDay: true, tDay: 0.5, tNight: 0 };
  // startMood: the demo rolls in at full immediately and burns off on its own
  skyMoods.startMood('fog');
  skyMoods.update(0.1, player);
  assert.ok(skyMoods.metrics().forced.fog > 0.9, 'startMood pins the fog at full at once');
  for(let i = 0; i < 30; i++) skyMoods.update(0.1, player);
  assert.ok(skyMoods.fogLevel() > 0.5, 'the started fog is visibly up within seconds');
  for(let i = 0; i < 500; i++) skyMoods.update(0.1, player);
  assert.equal(skyMoods.metrics().forced.fog, 0, 'the demo burns off by itself (no stuck pin)');
  assert.ok(skyMoods.fogLevel() < 0.1, 'midday reclaims the sky after the demo');
  console.log('scenario 6 (sky moods) ok');
}

// ============================================================================
// 7) weather instruments: scan, rod targeting, banked bolts, network drain
// ============================================================================
const { weatherInstruments } = await import('../src/engine/weather_instruments.js');
{
  resetWorld();
  weatherInstruments.reset();
  surfFn = () => 30;
  setTile(3, 29, T.WEATHERVANE);
  setTile(8, 25, T.LIGHTNING_ROD);
  player.x = 5; player.y = 28.5;
  weatherInstruments.update(2, player, getTile);
  const m0 = weatherInstruments.metrics();
  assert.equal(m0.vanes, 1, 'the vane registered');
  assert.equal(m0.rods, 1, 'the rod registered');
  // the rod stands in the open column — a strike near it re-aims onto it
  const target = weatherInstruments.rodTargetNear(10, 2, getTile);
  assert.ok(target && target.x === 8 && target.y === 25, 'the strike re-aims at the rod');
  const banked = weatherInstruments.strikeRod(8, 25);
  assert.ok(banked && banked.banked > 0, 'the bolt banked charge');
  assert.equal(weatherInstruments.energyAt(8, 25), weatherInstruments.config.ROD_STRIKE_ENERGY, 'energyAt reads the buffer');
  const got = weatherInstruments.drainAt(8, 25, 20);
  assert.equal(got.amount, 20, 'the network drains the rod like any battery');
  assert.ok(notes.includes('lightning_rod'), 'the rod discovery fired');
  assert.ok(notes.includes('weathervane'), 'the vane discovery fired');
  // a buried rod is shadowed — no attraction through solid ground
  setTile(8, 20, T.STONE);
  assert.equal(weatherInstruments.rodTargetNear(8, 2, getTile), null, 'a roofed rod does not attract');
  // clouds wiring pins: rod priority + the rod-is-shelter ruling
  const cloudsSrc = src('src/engine/clouds.js');
  assert.match(cloudsSrc, /findDynamoLightningTarget\(xi,fromRow,getTile\) \|\| findRodLightningTarget\(xi,fromRow,getTile\) \|\| firstBlockingTile\(xi,fromRow,getTile\)/,
    'strike targeting prefers dynamos, then rods, then terrain');
  assert.match(cloudsSrc, /res\.sheltered=true; \/\/ the rod IS the shelter/, 'nobody fries next to their own mast');
  // energy-source branches exist everywhere SMR got one
  assert.match(src('src/engine/teleporters.js'), /kind:'rod'/, 'teleporter networks know the rod source');
  assert.match(src('src/engine/vending.js'), /kind:'rod'/, 'vending pays from the rod, never a free generic source');
  assert.match(src('src/engine/mechs.js'), /function externalRodDrainNear\(m,amount,getTile\)/, 'mechs drink banked bolts');
  console.log('scenario 7 (weather instruments) ok');
}

// ============================================================================
// 8) graffiti: whitelist, backing, save round-trip, wire sanitization
// ============================================================================
const { graffiti } = await import('../src/engine/graffiti.js');
{
  resetWorld();
  graffiti.reset();
  surfFn = () => 30;
  assert.deepEqual(graffiti.GLYPHS, ['arrow', 'x', 'heart', 'dot'], 'the stencil whitelist is pinned');
  assert.equal(graffiti.paintAt(5, 30, 'arrow', 1, getTile), true, 'a solid tile face takes the pigment');
  assert.equal(graffiti.paintAt(5, 20, 'x', 1, getTile), false, 'empty air takes no mark');
  assert.equal(graffiti.paintAt(6, 30, 'evil', 1, getTile), false, 'unknown glyphs are refused');
  MM.world = { getConstructionBackground: (x, y) => (x === 7 && y === 25 ? T.BRICK : T.AIR) };
  assert.equal(graffiti.paintAt(7, 25, 'heart', -1, getTile), true, 'a back wall behind open air is valid backing');
  delete MM.world;
  const snap = graffiti.snapshot();
  assert.equal(snap.marks.length, 2, 'snapshot carries both marks');
  graffiti.reset();
  graffiti.restore(snap);
  assert.equal(graffiti.metrics().marks, 2, 'restore round-trips');
  // wire: wholesale sanitized replace, garbage dropped
  const n = graffiti.ghostApply([[1, 30, 0, 1], [2, 30, 2, -1], [9999999999, 5, 0, 1], ['x', 1, 0, 1], [3, 30, 99, 1]]);
  assert.ok(n >= 3 && n <= 4, 'the watcher mirror sanitizes rows (' + n + ')');
  assert.ok(notes.includes('graffiti'), 'the graffiti discovery fired');
  // eraseAt bumps the version (the gfx plane sig-skips on it)
  const v0 = graffiti.ghostVersion();
  graffiti.eraseAt(1, 30);
  assert.ok(graffiti.ghostVersion() > v0, 'erasing bumps the plane version');
  console.log('scenario 8 (graffiti) ok');
}

// ============================================================================
// 9) soft drifts: footprints + dirty snow (runtime rules + wire)
// ============================================================================
const { softDrifts } = await import('../src/engine/soft_drifts.js');
{
  resetWorld();
  softDrifts.reset();
  surfFn = () => 30;
  const D = softDrifts._debug;
  // a snow drift the hero walks through: a print appears, no volume changes
  for(let i = 0; i < 5; i++) D.addUnitAtCell(4, 29, 'snow', getTile, setTile);
  const body = { x: 4.5, y: 29.0, w: 0.7, h: 0.95, vx: 0.6, vy: 0 };
  D.stampBodyPrints(body);
  assert.equal(softDrifts.metrics().prints, 1, 'a slow walk stamps a footprint');
  assert.equal(D.cells.get('4,29').u, 5, 'prints never change drift volume');
  // dirty snow: soot falling ON snow stains instead of grinding
  const uBefore = D.cells.get('4,29').u;
  D.addUnitAtCell(4, 29, 'soot', getTile, setTile);
  const c = D.cells.get('4,29');
  assert.equal(c.u, uBefore, 'the snow volume survives the soot fall');
  assert.ok(c.d > 0, 'the cell carries a dirt stain instead');
  assert.equal(c.m, 'snow', 'the cell stays snow');
  // other pairs still grind 1:1 (leaves on snow erode)
  D.addUnitAtCell(4, 29, 'leaves', getTile, setTile);
  assert.equal(D.cells.get('4,29').u, uBefore - 1, 'non-soot pairs keep the grind rule');
  // wire: level rows carry the stain as an optional 5th; print rows apply
  const rows = softDrifts.ghostLevelsIn(0, 20, 10, 35);
  const stained = rows.find(r => r[0] === 4 && r[1] === 29);
  assert.ok(stained && stained.length >= 5 && stained[4] > 0, 'the stain rides the wire row');
  softDrifts.ghostApplyLevelsWindow(0, 20, 10, 35, rows);
  assert.ok(D.cells.get('4,29').d > 0, 'the watcher rebuilds the stain');
  const prows = softDrifts.ghostPrintsIn(0, 20, 10, 35);
  assert.ok(prows.length === 1 && prows[0].length === 5, 'print wire rows are [x,y,wire,dir,age10]');
  const pn = softDrifts.ghostApplyPrintsWindow(0, 20, 10, 35, prows);
  assert.equal(pn, 1, 'the watcher applies print windows');
  assert.equal(softDrifts.ghostApplyPrintsWindow(0, 20, 10, 35, [[2, 29, 0, 1, 9999], ['x']]), 1, 'garbage print rows are dropped, ages clamped');
  // bare-terrain prints: fresh snowpack (and sand) hold a boot mark even where
  // no drift fluff has accumulated — flagged `surf`, riding the wire as a 6th
  softDrifts.reset();
  for(const x of [10, 11, 12]) setTile(x, 30, T.SNOW);
  const walker = { x: 11.5, y: 29.0, w: 0.7, h: 0.95, vx: 0.8, vy: 0 };
  D.stampBodyPrints(walker, getTile);
  assert.ok(softDrifts.metrics().prints >= 1, 'a bare snow tile takes a surface print');
  const srows = softDrifts.ghostPrintsIn(0, 20, 20, 35);
  assert.ok(srows.some(r => r.length >= 6 && r[5] === 1), 'surface prints carry the 6th wire flag');
  setTile(11, 30, T.SAND);
  const sandWalker = { x: 11.5, y: 29.0, w: 0.7, h: 0.95, vx: 0.8, vy: 0 };
  D.stampBodyPrints(sandWalker, getTile);
  const sandPrint = [...D.prints.values()].find(p => p.x === 11 && p.m === 'sand');
  assert.ok(sandPrint && sandPrint.surf, 'sand terrain takes surface prints too');
  console.log('scenario 9 (footprints + dirty snow) ok');
}

// ============================================================================
// 10) mobs: nature drives (pure fns + source wiring) and the fog sight hook
// ============================================================================
{
  const mobsSrc = src('src/engine/mobs.js');
  assert.match(mobsSrc, /naturePass\(now, player, getTile\);/, 'the nature pass runs in the mob update');
  assert.match(mobsSrc, /const drive=m\._natureDrive;/, 'the calm wander consults the carried drive');
  assert.match(mobsSrc, /natureDriveStep\(m,spec,drive,ctx\);/, 'the drive steers instead of the random wander');
  assert.match(mobsSrc, /const fogSight = \(typeof MM!=='undefined' && MM\.skyMoods && MM\.skyMoods\.mobSightMult\) \? MM\.skyMoods\.mobSightMult\(\) : 1;/,
    'morning fog shortens creature sight');
  assert.match(mobsSrc, /NATURE_DRINKERS=\{DEER:1,RABBIT:1,SQUIRREL:1,GOAT:1,BIRD:1,ZABA:1,JASZCZUR:1\}/, 'the drinker species table is pinned');
  assert.match(mobsSrc, /NATURE_PREDATORS=\{WOLF:1,BEAR:1\}/, 'the ambush species table is pinned');
  assert.match(mobsSrc, /MM\.geothermal\.poolsNear\) \? MM\.geothermal\.poolsNear\(px,NATURE_BAND\) : \[\]/, 'bathing reads the geothermal pool registry');
  assert.match(mobsSrc, /function forEachLive\(fn\)/, 'the zero-alloc live iterator exists (animal tracks)');
  const { mobs } = await import('../src/engine/mobs.js');
  assert.ok(mobs && typeof mobs.forEachLive === 'function', 'forEachLive is exported');
  // storm omen (pure): rising wind + a brewing drift gale => birds startle
  windNow = 3.4;
  MM.softDrifts.metrics = softDrifts.metrics; // real module — no storm: no omen
  assert.equal(mobs._debugNature.natureStormOmen(0), null, 'calm systems: no omen');
  const realMetrics = softDrifts.metrics;
  softDrifts.metrics = () => ({ storm: { active: true, natural: 0.4 } });
  MM.softDrifts = softDrifts;
  const omen = mobs._debugNature.natureStormOmen(0);
  assert.ok(omen && (omen.dir === 1 || omen.dir === -1), 'a brewing gale + rising wind = the omen birds read');
  softDrifts.metrics = realMetrics;
  windNow = 0;
  // cold snap (pure)
  prof = { snowStrength: 0.5 };
  assert.equal(mobs._debugNature.natureColdSnap(0), true, 'deep snowfall reads as a cold snap');
  prof = { snowStrength: 0 };
  colTemp = 0.5;
  console.log('scenario 10 (mob nature drives) ok');
}

// ============================================================================
// 11) integration pins: main.js seams, ui panel, ghost planes, audio, journal
// ============================================================================
{
  const mainSrc = src('src/main.js');
  const uiSrc = src('src/engine/ui.js');
  const hostSrc = src('src/engine/ghost_host.js');
  const clientSrc = src('src/engine/ghost_client.js');
  const audioSrc = src('src/engine/audio.js');
  const discoverySrc = src('src/engine/discovery.js');
  // world-step updates (host-only sim) + hero-side comfort in runHeroStep
  for(const line of [
    /if\(AVALANCHE && AVALANCHE\.update\) AVALANCHE\.update\(dt, player, getTile, setTile\);/,
    /if\(ICICLES && ICICLES\.update\) ICICLES\.update\(dt, player, getTile, setTile\);/,
    /if\(THIN_ICE_SIM && THIN_ICE_SIM\.update\) THIN_ICE_SIM\.update\(dt, player, getTile, setTile\);/,
    /if\(GEOTHERMAL && GEOTHERMAL\.update\) GEOTHERMAL\.update\(dt, player, getTile, setTile\);/,
    /if\(SKY_MOODS && SKY_MOODS\.update\) SKY_MOODS\.update\(dt, player\);/,
    /if\(WEATHER_INSTRUMENTS && WEATHER_INSTRUMENTS\.update\) WEATHER_INSTRUMENTS\.update\(dt, player, getTile\);/,
    /if\(GRAFFITI && GRAFFITI\.update\) GRAFFITI\.update\(dt, player, getTile\);/,
  ]) assert.match(mainSrc, line, 'world-step wiring: ' + line);
  assert.match(mainSrc, /if\(GEOTHERMAL && GEOTHERMAL\.updateHero\) GEOTHERMAL\.updateHero\(dt, player, getTile\);[\s\S]{0,200}if\(SKY_MOODS && SKY_MOODS\.update\) SKY_MOODS\.update\(dt, player\);[\s\S]{0,400}updateMining\(dt\);/,
    'runHeroStep carries ONLY the hero-side comfort systems (no world writes)');
  // draws
  assert.match(mainSrc, /SKY_MOODS\.drawAurora\(ctx,TILE,sx,sy,viewX,viewY,camRenderX,camRenderY\);/, 'aurora draws behind the clouds, camera-anchored');
  assert.match(mainSrc, /SKY_MOODS\.drawFog\(ctx,TILE,sx,sy,viewX,viewY,camRenderX,camRenderY\);/, 'fog draws over the world haze, camera-anchored');
  assert.match(mainSrc, /ICICLES\.draw\(ctx,TILE,worldFxVisible\);/, 'icicles draw fog-gated');
  assert.match(mainSrc, /THIN_ICE_SIM\.draw\(ctx,TILE,worldFxVisible\);/, 'ice cracks draw fog-gated');
  assert.match(mainSrc, /GEOTHERMAL\.draw\(ctx,TILE,worldFxVisible\);/, 'spring wisps draw fog-gated');
  assert.match(mainSrc, /WEATHER_INSTRUMENTS\.draw\(ctx,TILE,worldFxVisible\);/, 'instruments draw fog-gated');
  assert.match(mainSrc, /GRAFFITI\.draw\(ctx,TILE,worldFxVisible\);/, 'graffiti draws fog-gated');
  // chokepoints + save + key
  assert.match(mainSrc, /AVALANCHE\.disturb\(mineTx,mineTy,1\.2,getTile\)/, 'mining pokes the avalanche trigger');
  assert.match(mainSrc, /if\(tId===T\.THIN_ICE\)\{[\s\S]{0,400}setForegroundConfirmed\(mineTx,mineTy,T\.WATER\)/, 'mining thin ice reopens the lake');
  assert.match(mainSrc, /graffiti: timedSavePart\('graffiti'/, 'graffiti marks ride the save');
  assert.match(mainSrc, /GRAFFITI\.restore\) GRAFFITI\.restore\(data\.graffiti\);/, 'and restore on load');
  assert.match(mainSrc, /function paintGraffitiAtCursor\(cycle\)/, 'the G-key paint helper exists');
  assert.match(mainSrc, /MM\.collectSoot=\(n\)=>/, 'ploughed thick soot pays out pigment');
  assert.match(mainSrc, /ghostHeroGraffiti:\(tx,ty,glyph,dir\)=>\{/, 'the hero-intent bridge seam re-validates backing');
  // recipes + hotbar
  assert.match(mainSrc, /id:'soot_pigment', name:'Sadza \(pigment\)', cost:\{coal:1\}/, 'coal crushes into pigment');
  assert.match(mainSrc, /id:'weathervane', name:'Wiatrowskaz', cost:\{steel:1, wood:2\}/, 'the vane recipe');
  assert.match(mainSrc, /id:'lightning_rod', name:'Piorunochron', cost:\{steel:3, silverWire:2\}/, 'the rod recipe');
  assert.match(mainSrc, /'WEATHERVANE','LIGHTNING_ROD','RESPAWN_TOTEM'\]/, 'the instruments joined the utility hot-select group');
  // ghost gfx plane + intent
  assert.match(hostSrc, /gfx: 2500/, 'the gfx plane has a low-Hz cadence');
  assert.match(hostSrc, /function gfxTick\(s, t\)/, 'the host streams the graffiti plane');
  assert.match(hostSrc, /if\(v === s\.lastGfxVersion\) return;/, 'the gfx plane sig-skips on the version counter');
  assert.match(hostSrc, /pl\.a === 'gfx'/, 'handleHeroAct owns the graffiti branch');
  assert.match(hostSrc, /G\.validGlyph\(glyph\)/, 'the host whitelists the claimed glyph');
  assert.match(clientSrc, /pl\.t === 'gfx'/, 'the watcher applies the graffiti plane');
  assert.match(clientSrc, /_heroGfx: \(x, y, glyph, dir\) => heroIntents\.gfx\(x, y, glyph, dir\),/, 'the QA seam sends the intent');
  // debug panel: every feature has a one-click trigger
  assert.match(uiSrc, /function injectNatureDebugPanel\(actions, menuPanel\)/, 'the nature debug panel exists');
  assert.match(uiSrc, /injectNatureDebugPanel,/, 'the panel is registered in the ui api aggregate');
  for(const btn of ['Usyp stok sniegu', 'Wyzwol lawine', 'Zasiej sople', 'Strac sople', 'Zamroz tafle', 'Zbuduj gorace zrodlo',
    'Nawiej mgle', 'Rozpal zorze', 'Daj instrumenty', 'Piorun w maszt', 'Wymus zachowania', 'Namaluj znak'])
    assert.ok(uiSrc.includes("'" + btn + "'"), 'debug button present: ' + btn);
  assert.match(mainSrc, /if\(MM\.ui && MM\.ui\.injectNatureDebugPanel\) MM\.ui\.injectNatureDebugPanel\(\{/, 'main wires the nature panel');
  // audio + journal
  assert.match(audioSrc, /drip:\s+\(o\)=>/, 'the drip one-shot exists');
  assert.match(audioSrc, /creak:\s+\(o\)=>/, 'the creak one-shot exists');
  for(const k of ['avalanche', 'icicle', 'thin_ice', 'hot_spring', 'morning_fog', 'aurora', 'weathervane', 'lightning_rod', 'waterhole', 'storm_birds', 'graffiti'])
    assert.equal((discoverySrc.match(new RegExp(k + ':', 'g')) || []).length, 2, "discovery '" + k + "' registered in both catalog tables");
  console.log('scenario 11 (integration pins) ok');
}

console.log('nature-details-sim: all assertions passed');
