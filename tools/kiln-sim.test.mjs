// Wypał ciągły — the kiln (src/engine/kiln.js).
// Closes three gaps at once: thin power demand, instant/free/station-less
// crafting, and hand-smelting that does not scale. It invents no chemistry —
// it applies reactions.js's EXISTING heat recipes in bulk.
// Run: node tools/kiln-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
await import('../src/engine/reactions.js');           // the real recipe table
const { kiln: K } = await import('../src/engine/kiln.js');

const tiles = new Map();
const kk = (x, y) => x + ',' + y;
const get = (x, y) => tiles.has(kk(x, y)) ? tiles.get(kk(x, y)) : T.STONE;
const set = (x, y, t) => tiles.set(kk(x, y), t);

// a sealed 3x2 brick chamber with the kiln mouth at the bottom
function buildChamber(){
  tiles.clear();
  for(let x = 4; x <= 8; x++) for(let y = 6; y <= 11; y++) set(x, y, T.BRICK);
  for(let x = 5; x <= 7; x++) for(let y = 8; y <= 9; y++) set(x, y, T.AIR);
  set(6, 10, T.KILN);
}

// ------------------------------------------------------------ chamber sealing
{
  K.reset(); buildChamber();
  const ch = K._debug.chamberAt(6, 10, get);
  assert.ok(ch && ch.length === 6, 'a sealed brick chamber is found (' + (ch && ch.length) + ' cells)');

  // punch a hole: the volume leaks and must be rejected, NOT flood the world
  set(5, 8, T.AIR); set(4, 8, T.AIR); set(3, 8, T.AIR);
  for(let x = -50; x <= 3; x++) set(x, 8, T.AIR);
  assert.equal(K._debug.chamberAt(6, 10, get), null, 'an unsealed chamber is rejected, not flood-filled forever');

  // and the scan is hard-capped either way
  tiles.clear(); set(6, 10, T.KILN);
  for(let x = -200; x <= 200; x++) for(let y = 0; y <= 9; y++) set(x, y, T.AIR);
  assert.equal(K._debug.chamberAt(6, 10, get), null, 'a pathological open volume can never eat a frame');
}

// -------------------------------------------------------------------- fuelling
{
  K.reset(); buildChamber();
  const k = { x: 6, y: 10 };
  assert.equal(K._debug.heatRate(k, 0.1, get), 0, 'a cold kiln does nothing');

  set(6, 11, T.LAVA);
  assert.ok(K._debug.heatRate(k, 0.1, get) > 0, 'lava on a face fires the kiln');

  buildChamber();
  const savedFire = MM.fire;
  MM.fire = { isBurning: (x, y) => x === 6 && y === 11 };
  assert.ok(K._debug.heatRate(k, 0.1, get) > 0, 'a live flame fires it too');
  MM.fire = savedFire;

  // ...or the electrical grid, which is what gives power a real consumer
  buildChamber();
  const savedDyn = MM.dynamo;
  MM.dynamo = { absorbNear: (x, y, amount) => ({ amount: amount }) }; // the REAL dynamo API shape
  assert.ok(K._debug.heatRate(k, 0.1, get) > 0, 'the grid can heat it instead (new power DEMAND)');
  MM.dynamo = savedDyn;
}

// ------------------------------------------------------- it bakes real recipes
{
  K.reset(); buildChamber();
  set(6, 11, T.LAVA);
  // load the chamber with clay — reactions.js already knows clay -> brick
  set(5, 8, T.CLAY); set(6, 8, T.CLAY); set(7, 8, T.CLAY);
  K.noteKiln(6, 10);
  assert.equal(K.metrics().kilns, 1, 'the kiln is tracked');

  let ticks = 0;
  while(ticks < 400 && K.metrics().fired < 3){ K.update(0.1, null, get, set); ticks++; }
  assert.ok(K.metrics().fired >= 3, 'the kiln bakes every eligible tile in the chamber (' + K.metrics().fired + ')');
  assert.equal(get(5, 8), T.BRICK, 'clay came out as brick — the SHARED recipe, not bespoke chemistry');
  assert.equal(get(6, 8), T.BRICK, 'the whole batch fired, unattended');

  // it is METERED, not instant: that is what makes it a station you walk away from
  K.reset(); buildChamber();
  set(6, 11, T.LAVA); set(5, 8, T.CLAY);
  K.noteKiln(6, 10);
  K.update(0.05, null, get, set);
  assert.equal(get(5, 8), T.CLAY, 'a single brief tick does not transmute anything');
}

// ------------------------------------------------------------- nothing to bake
{
  K.reset(); buildChamber();
  set(6, 11, T.LAVA);
  K.noteKiln(6, 10);
  for(let i = 0; i < 50; i++) K.update(0.1, null, get, set);
  assert.equal(K.metrics().fired, 0, 'an empty chamber bakes nothing and does not spin');
  assert.equal(K.metrics().lit, 1, 'but it does report itself lit');
}

// ------------------------------------------------------------------ lifecycle
{
  K.reset(); buildChamber();
  K.noteKiln(6, 10);
  set(6, 10, T.AIR);                      // mined out
  K.update(0.1, null, get, set);
  assert.equal(K.metrics().kilns, 0, 'a mined-out kiln stops being tracked');

  K.reset();
  for(let i = 0; i < 500; i++) K.noteKiln(i, 0);
  assert.ok(K.metrics().kilns <= K.CFG.MAX_KILNS, 'tracked kilns are hard-bounded (' + K.metrics().kilns + ')');
}

// ----------------------------------------------------------------- persistence
{
  K.reset(); buildChamber();
  K.noteKiln(6, 10);
  const snap = K.snapshot();
  assert.equal(snap.list.length, 1, 'kilns ride the save');
  K.reset();
  assert.equal(K.metrics().kilns, 0, 'reset clears them');
  K.restore(snap);
  assert.equal(K.metrics().kilns, 1, 'a reload keeps the kiln you built');
  K.restore({ list: [{ x: 'x', y: 1 }, { x: 2, y: 3 }] });
  assert.equal(K.metrics().kilns, 1, 'a hostile save row is rejected, not trusted');
}

// -------------------------------------------------------------- wiring contract
{
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const modSrc = await readFile(new URL('../src/engine/kiln.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /KILN\.update\(dt, player, getTile, setTile\)/, 'the kiln is ticked each frame');
  assert.match(mainSrc, /KILN\.noteKiln\(tx,ty\)/, 'kilns register on the shared tile-change hook');
  assert.match(mainSrc, /KILN\.clearKiln\(tx,ty\)/, '...and unregister the same way');
  assert.match(mainSrc, /id:'kiln'/, 'the kiln is craftable');
  assert.match(mainSrc, /kiln: timedSavePart/, 'kilns are saved');
  // it must never invent chemistry: all transmutation goes through reactions.js
  assert.match(modSrc, /R\.apply\('heat'/, 'transmutation routes through the shared reaction table');
  assert.ok(!/resultTile|register\(/.test(modSrc), 'the kiln defines no recipes of its own');
}

// Developer testing: every feature in this wave must be reachable from the
// debug menu — several of this wave's bugs were only cheap to find once you
// could TRIGGER the state (a glider that never opened, a forest that never sowed).
{
  const uiSrc = await (await import('node:fs/promises')).readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
  const mainDbg = await (await import('node:fs/promises')).readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  if(!uiSrc.includes('function injectKilnDebugPanel(actions, menuPanel)')) throw new Error('injectKilnDebugPanel must exist');
  if(!/box\.id=spec\.id/.test(uiSrc)) throw new Error('feature debug panels keep a stable DOM id');
  if(!uiSrc.includes("id:'kilnDebugBox'")) throw new Error('kilnDebugBox must have its stable DOM id');
  if(!mainDbg.includes('MM.ui.injectKilnDebugPanel(')) throw new Error('injectKilnDebugPanel must be wired from main.js');
}

// ------------------------------------------------- the coal burns while you mine
// THE far-world expectation, verbatim: light a kiln, walk away, come back later —
// the fire kept burning and the batches are baked. Under worldSim the frozen kiln
// paid NOTHING per frame while away; the wake frame settles the whole absence
// through the same progress math (lava is persistent heat, so the full gap
// credits — a flame that died while frozen would credit nothing, by design).
{
  K.reset(); buildChamber();
  K.noteKiln(6, 10);
  const { worldSim } = await import('../src/engine/world_sim.js');
  worldSim.reset();
  set(5, 8, T.CLAY); set(6, 8, T.CLAY); set(7, 8, T.CLAY);   // the batch
  set(6, 11, T.LAVA);                                        // persistent heat
  const hero = { x: 6, y: 9 };
  const frame = (dt) => { worldSim.beginFrame(dt, hero, null); K.update(dt, null, get, set); worldSim.endFrame(); };
  frame(0.1);                                  // lit and stamped at the owner's feet
  const firedBefore = K.metrics().fired;
  hero.x = 600;                                // off to the mines
  let reads = 0;
  const countingGet = (x, y) => { reads++; return get(x, y); };
  for(let i = 0; i < 60; i++){ worldSim.beginFrame(0.1, hero, null); K.update(0.1, null, countingGet, set); worldSim.endFrame(); }
  assert.equal(reads, 0, 'a frozen kiln reads NOTHING — 6 s of absence cost zero tile probes');
  assert.equal(K.metrics().fired, firedBefore, 'and nothing bakes while frozen (the wake settles it instead)');
  hero.x = 6;                                  // home again
  frame(0.1);
  assert.ok(K.metrics().fired >= firedBefore + 3, 'the wake frame bakes everything the absent seconds paid for (fired ' + K.metrics().fired + ')');
  assert.equal(get(6, 8) === T.CLAY, false, 'the clay in the chamber really became brick');
  worldSim.reset();
}

console.log('kiln-sim: all assertions passed');
