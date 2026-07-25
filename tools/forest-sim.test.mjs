// Żywy las — seed dispersal, saplings and succession (src/engine/forest.js).
// Before this, trees.buildTree had ZERO callers outside worldgen: a clearcut or
// a burn scar was permanent for the save.
// Run: node tools/forest-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, CHUNK_W } = await import('../src/constants.js');
const { forest: F } = await import('../src/engine/forest.js');

const tiles = new Map();
const k = (x, y) => x + ',' + y;
const get = (x, y) => tiles.has(k(x, y)) ? tiles.get(k(x, y)) : (y >= 60 ? T.STONE : T.AIR);
const set = (x, y, t) => tiles.set(k(x, y), t);
function ground(x0, x1, y){ for(let x = x0; x <= x1; x++) set(x, y, T.GRASS); }
function tree(x, top){ for(let i = 0; i < 4; i++) set(x, top - i, T.WOOD); set(x, top - 4, T.LEAF); }

const realRandom = Math.random;
try {
  // ------------------------------------------------------------ soil detection
  {
    F.reset(); tiles.clear();
    ground(0, 40, 59);
    assert.equal(F._debug.soilTopAt(10, get, 59), 59, 'open grass is a seedbed');
    tiles.clear();
    assert.equal(F._debug.soilTopAt(10, get, 59), null, 'bare stone is not a seedbed');
  }

  // --------------------------------------------------- shade + spacing suppress
  // This is what keeps an OLD forest stable instead of collapsing into a thicket.
  {
    F.reset(); tiles.clear();
    ground(0, 40, 59);
    assert.equal(F._debug.suppressed(10, 58, get), false, 'open ground is free to sprout');
    tree(12, 58);
    assert.equal(F._debug.suppressed(10, 58, get), true, 'a neighbouring trunk suppresses a sprout (spacing)');
    tiles.clear(); ground(0, 40, 59);
    set(10, 56, T.LEAF);
    assert.equal(F._debug.suppressed(10, 58, get), true, 'an established canopy shades out competitors');
  }

  // ------------------------------- a real stand must ACTUALLY sow (regression) --
// Two independent blockers shipped in the first cut: disperse() looked for a
// parent with the SEEDBED predicate (which requires the trunk's own cell to be
// air, so a real tree could never match), and the seed throw was structurally
// shorter than the parent's own suppression box. Either one alone made the
// entire feature inert. Pin both.
{
  F.reset(); tiles.clear();
  ground(0, 120, 59);
  for(const x of [20, 30, 40, 50]) for(let i = 1; i <= 4; i++) set(x, 59 - i, T.WOOD);
  const savedS = MM.seasons, savedW = MM.wind;
  try {
    MM.seasons = { profile: () => ({ leafDropStrength: 1, leafGrowStrength: 1 }) };
    MM.wind = { speed: () => 1.4 };
    let sown = 0;
    for(let i = 0; i < 400 && sown === 0; i++) sown += F._debug.disperse(35, 58, get);
    assert.ok(sown > 0, 'a surviving stand actually sows seed');
  } finally { MM.seasons = savedS; MM.wind = savedW; }

  // negative control: a clearcut sows nothing at all
  F.reset(); tiles.clear(); ground(0, 120, 59);
  let none = 0;
  for(let i = 0; i < 200; i++) none += F._debug.disperse(35, 58, get);
  assert.equal(none, 0, 'a clearcut with no parents left sows nothing');

  // every seed must clear the parent's own MIN_GAP box, or it is rejected by
  // construction and the forest can never spread
  F.reset(); tiles.clear(); ground(0, 120, 59);
  for(let i = 1; i <= 5; i++) set(60, 59 - i, T.WOOD);
  for(let i = 0; i < 120; i++){
    F.reset();
    assert.equal(F.plantSeed(60, 58, get), true, 'a parent always manages to sow');
    const s = [...F._debug.saplings().values()][0];
    const d = Math.abs(s.x - 60);
    assert.ok(d > F.CFG.MIN_GAP, 'a seed clears the parent MIN_GAP box (' + d + ')');
    assert.ok(d <= F.CFG.WIND_CARRY, 'a seed never outruns WIND_CARRY (' + d + ')');
  }
}

// ----------------------------------------------------------- species carry-over
  {
    F.reset(); tiles.clear();
    ground(0, 40, 59);
    assert.equal(F._debug.variantNear(10, 58, get), null, 'ordinary forest regrows ordinary trees');
    set(14, 57, T.LIGHT_WOOD);
    assert.equal(F._debug.variantNear(10, 58, get), 'lightwood', 'a lightwood stand regrows lightwood');
    tiles.clear(); ground(0, 40, 59);
    set(14, 57, T.HARD_WOOD);
    assert.equal(F._debug.variantNear(10, 58, get), 'hardwood', 'a hardwood stand regrows hardwood');
  }

  // ----------------------------------------------------------------- seasonality
  {
    const saved = MM.seasons;
    try {
      MM.seasons = { profile: () => ({ leafDropStrength: 1, leafGrowStrength: 1 }) };
      const autumn = F._debug.seasonSeedBoost();
      MM.seasons = { profile: () => ({ leafDropStrength: 0, leafGrowStrength: 1 }) };
      const summer = F._debug.seasonSeedBoost();
      MM.seasons = { profile: () => ({ leafDropStrength: 0, leafGrowStrength: 0 }) };
      const winter = F._debug.seasonSeedBoost();
      assert.ok(autumn > summer, 'autumn sheds the most seed');
      assert.ok(winter < summer, 'nothing germinates under deep winter');
      assert.ok(winter >= 0, 'the boost never goes negative');
    } finally { MM.seasons = saved; }
  }

  // ---------------------------------------------------------- sprout -> maturity
  {
    F.reset(); tiles.clear();
    ground(0, 40, 59);
    let day = 10;
    MM.seasons = { metrics: () => ({ dayFloat: day }), profile: () => ({ leafDropStrength: 1, leafGrowStrength: 1 }) };

    assert.equal(F.plantSeed(10, 58, get), true, 'a seed takes on clear lit soil');
    assert.equal(F.metrics().saplings, 1, 'the sapling is tracked');

    F.update(0.1, {x:10,y:58}, get, set);           // establishes the day baseline
    day += F.CFG.SPROUT_DAYS + 0.05;
    F.update(0.1, {x:10,y:58}, get, set);
    const sprouted = [...F._debug.saplings().values()][0];
    assert.ok(sprouted && sprouted.sprouted, 'the seed sprouts after its germination time');
    assert.equal(get(sprouted.x, sprouted.y), T.SAPLING, 'a visible sapling tile appears in the world');

    // maturity hands off to the REAL tree builder
    let built = null;
    MM.trees = { buildTree: (view, lx, s, variant, wx) => { built = { lx, s, variant, wx }; }, canGrowTreeAt: () => true };
    day += F.CFG.MATURE_DAYS;
    F.update(0.1, {x:10,y:58}, get, set);
    assert.ok(built, 'a mature sapling is grown by trees.buildTree, not a bespoke lookalike');
    assert.equal(built.variant, 'oak', 'the species carries through to the builder');
    assert.equal(F.metrics().matured, 1, 'the maturation is counted');
    assert.equal(F.metrics().saplings, 0, 'the sapling record is consumed');
    MM.trees = undefined;
  }

  // ------------------------------------------------- a disturbed sapling is lost
  {
    F.reset(); tiles.clear();
    ground(0, 40, 59);
    let day = 5;
    MM.seasons = { metrics: () => ({ dayFloat: day }), profile: () => ({ leafDropStrength: 0, leafGrowStrength: 1 }) };
    F.plantSeed(10, 58, get);
    F.update(0.1, {x:10,y:58}, get, set);
    // the seed scatters a few columns downwind, so pave over where it ACTUALLY is
    const planted = [...F._debug.saplings().values()][0];
    assert.ok(planted, 'a seed was planted');
    set(planted.x, planted.y + 1, T.STONE);     // someone paved over the soil
    day += 1;
    F.update(0.1, {x:10,y:58}, get, set);
    assert.equal(F.metrics().saplings, 0, 'a sapling whose soil is destroyed is forgotten');
  }

  // ------------------------------------------------------------------ boundedness
  {
    F.reset(); tiles.clear();
    ground(-400, 400, 59);
    for(let x = -350; x < 350; x++) F.plantSeed(x, 58, get);
    assert.ok(F.metrics().saplings <= F.CFG.MAX_SAPLINGS,
      'tracked saplings are hard-bounded (' + F.metrics().saplings + ')');
  }

  // ------------------------------------------------------- the live-world adapter
  // buildTree writes into a flat chunk array; the adapter maps that onto setTile
  // so a regrown tree is geometrically identical to a worldgen one.
  {
    F.reset(); tiles.clear();
    const view = F._debug.liveChunkView(get, set, 100, 32);
    view[5 * CHUNK_W + 32] = T.WOOD;             // local x = lx  ->  world x = 100
    assert.equal(get(100, 5), T.WOOD, 'an adapter write lands at the right world column');
    view[5 * CHUNK_W + 33] = T.LEAF;             // one to the right
    assert.equal(get(101, 5), T.LEAF, 'adapter columns are offset correctly');
    assert.equal(view[5 * CHUNK_W + 32], T.WOOD, 'the adapter reads the live world back');
  }

  // ----------------------------------------------------------------- persistence
  {
    F.reset(); tiles.clear();
    ground(0, 40, 59);
    F.plantSeed(10, 58, get);
    const snap = F.snapshot();
    assert.equal(snap.list.length, 1, 'saplings ride the save');
    F.reset();
    assert.equal(F.metrics().saplings, 0, 'reset clears them');
    F.restore(snap);
    assert.equal(F.metrics().saplings, 1, 'a reload keeps a regrowing forest');
    F.restore({ list: [{ x: 'x', y: 3 }, { x: 5, y: 1e9 }, { x: 9e9, y: 58 }, { x: 7, y: 58, age: 'NaN', variant: 'x'.repeat(90) }] });
    assert.ok(F.metrics().saplings <= 1, 'hostile save rows are rejected, not trusted');
    for(const s of F._debug.saplings().values()){
      assert.ok(Number.isFinite(s.age), 'a restored age is always finite');
      assert.ok(!s.variant || s.variant.length <= 16, 'a restored variant is bounded');
    }
  }
} finally {
  Math.random = realRandom;
  MM.seasons = undefined;
  MM.trees = undefined;
}

// -------------------------------------------------------------- wiring contract
{
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const modSrc = await readFile(new URL('../src/engine/forest.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /FOREST\.update\(dt, player, getTile, setTile\)/, 'the forest is ticked each frame');
  assert.match(mainSrc, /forest: timedSavePart/, 'regrowth is saved');
  assert.match(modSrc, /TR\.buildTree\(view, lx/, 'maturity reuses the real tree builder');
  // plants.js:164 reads window.player for its seeding window — deliberately NOT copied
  const code = modSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/window\.player/.test(code), 'forest.js never reads window.player (CLAUDE.md rule 3)');
}

console.log('forest-sim: all assertions passed');
