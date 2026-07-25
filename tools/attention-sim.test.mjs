// Uwaga Warstwy — the deeds axis (src/engine/attention.js).
// Difficulty used to key off |x| alone, so day 200 at spawn felt like day 5.
// Run: node tools/attention-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { worldHostility: WH } = await import('../src/engine/world_hostility.js');
const { attention: A } = await import('../src/engine/attention.js');

// ------------------------------------------------- the floor lifts EVERYWHERE
// This is the whole point: intensity scales the DISTANCE ramp, so at spawn
// (ramp ~= 0) it does nothing. Only a floor can make home dangerous.
{
  A.reset();
  WH.setTuning({ intensity: 1, reach: 1, floor: 0 });
  const homeBefore = WH.at(0).hostility;
  assert.equal(homeBefore, 0, 'spawn starts perfectly safe');

  WH.setTuning({ intensity: 3 });
  assert.equal(WH.at(0).hostility, 0, 'cranking INTENSITY does nothing at spawn — it only scales the ramp');

  WH.setTuning({ intensity: 1, floor: 1.2 });
  assert.ok(WH.at(0).hostility >= 1.2, 'a deeds FLOOR makes spawn itself dangerous');
  assert.ok(WH.at(30000).hostility >= WH.at(0).hostility, 'the far world is still at least as hostile as home');

  // the floor must never REDUCE an already-hostile frontier
  WH.setTuning({ intensity: 1, floor: 0 });
  const farPlain = WH.at(30000).hostility;
  WH.setTuning({ floor: 0.5 });
  assert.ok(WH.at(30000).hostility >= farPlain, 'a floor can only ever raise the curve, never flatten the frontier');
  assert.ok(WH.getTuning().floor === 0.5, 'the floor is readable back');

  // bounds
  WH.setTuning({ floor: 999 });
  assert.ok(WH.getTuning().floor <= WH.TUNING_BOUNDS.floor[1], 'the floor is clamped to its bound');
  WH.setTuning({ floor: -5 });
  assert.ok(WH.getTuning().floor >= 0, 'the floor never goes negative');
  WH.setTuning({ floor: 0 });
}

// ------------------------------------------------------------- deeds accumulate
{
  A.reset();
  assert.equal(A.level(), 0, 'a fresh world holds no attention');
  A.note('ore');
  const afterOre = A.level();
  assert.ok(afterOre > 0, 'stripping ore is noticed');
  A.reset();
  A.note('guardian');
  assert.ok(A.level() > afterOre * 50, 'taking a guardian heart is far louder than one ore tile');

  A.reset();
  A.note('ore', 100);
  assert.ok(A.level() > 0, 'a long greedy run of ordinary mining still adds up');
  const before = A.level();
  A.note('nonsense');
  assert.equal(A.level(), before, 'unknown deed kinds are ignored, not trusted');
  A.note('ore', -50);
  assert.ok(A.level() >= before, 'a negative count can never REDUCE attention');

  A.reset();
  for(let i = 0; i < 5000; i++) A.note('guardian');
  assert.ok(A.level() <= 1, 'attention is normalised into 0..1 however much you take');
  assert.ok(A.floorFor() <= WH.TUNING_BOUNDS.floor[1], 'the derived floor stays inside the hostility bound');
}

// ------------------------------------------------------------- it drives the world
{
  A.reset();
  WH.setTuning({ intensity: 1, reach: 1, floor: 0 });
  assert.equal(WH.at(0).hostility, 0, 'baseline: home is safe');
  for(let i = 0; i < 12; i++) A.note('guardian');
  assert.ok(A.level() > 0.5, 'a rampage holds most of the layer attention');
  assert.ok(WH.at(0).hostility > 0.5, 'and that pushes the hostility floor into the world automatically');
  // the ~15 existing consumers pick it up for free
  const h = WH.at(0);
  assert.ok(h.mobHpMult > 1 && h.mobDamageMult > 1, 'existing consumers read the raised floor with no new wiring');
  assert.ok(h.bossHpMult > 1, 'bosses scale off the same number');
}

// ---------------------------------------------------------------- relief + decay
{
  A.reset();
  for(let i = 0; i < 12; i++) A.note('guardian');
  const peak = A.level();
  A.relieve(0.5);
  assert.ok(A.level() < peak, 'attention can be bought back down (the economy sink)');
  assert.ok(A.level() >= 0, 'relief never goes negative');

  A.reset();
  A.note('guardian', 6);
  const busy = A.level();
  A.update(10);                       // establishes the day baseline
  A.update(40);                       // 30 quiet days
  assert.ok(A.level() < busy, 'a quiet player is slowly forgotten');
  A.update(NaN);
  assert.ok(Number.isFinite(A.level()), 'a non-finite day never corrupts the score');
}

// ------------------------------------------------------------------- omen lines
// Legibility: the system speaks in omens, never a silent ramp.
{
  A.reset();
  const said = [];
  A.setNotifier(t => said.push(t));
  for(let i = 0; i < 20; i++) A.note('guardian');
  assert.ok(said.length > 0, 'crossing a threshold announces itself');
  assert.ok(said.length <= A.OMENS.length, 'omens never spam — at most one per threshold');
  assert.ok(said.every(s => typeof s === 'string' && s.length > 0), 'every omen is a real line');
  const repeat = said.length;
  A.note('guardian');
  assert.equal(said.length, repeat, 'a threshold already crossed does not re-announce');
  A.setNotifier(null);
}

// ------------------------------------------------------------------ persistence
{
  A.reset();
  A.note('guardian', 5);
  const snap = A.snapshot();
  assert.ok(snap.score > 0, 'the world memory rides the save');
  A.reset();
  assert.equal(A.level(), 0, 'reset clears it');
  A.restore(snap);
  assert.ok(A.level() > 0, 'a reload remembers what you took');
  assert.ok(WH.at(0).hostility > 0, 'and re-applies the floor on load');

  A.restore({ score: 'NaN', announced: 999 });
  assert.ok(Number.isFinite(A.metrics().score), 'a hostile score is rejected, not trusted');
  assert.ok(A.metrics().announced <= A.OMENS.length, 'a hostile omen index is clamped');
  A.restore(null);
  assert.equal(A.level(), 0, 'a missing save is a clean slate');
  A.reset();
  WH.setTuning({ floor: 0 });
}

// -------------------------------------------------------------- wiring contract
{
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const progSrc = await readFile(new URL('../src/engine/progress.js', import.meta.url), 'utf8');
  const invSrc = await readFile(new URL('../src/engine/invasions.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /ATTENTION\.note\('ore'\)/, 'mining ore is wired as a deed');
  assert.match(progSrc, /MM\.attention\.note\('guardian'\)/, 'guardian hearts are wired as a deed');
  assert.match(invSrc, /MM\.attention\.note\('invasion'\)/, 'broken invasions are wired as a deed');
  assert.match(mainSrc, /attention: timedSavePart/, 'world memory is saved');
  // every declared weight must actually have an emitter — an unwired weight is a
  // promise the world never keeps
  const wired = { ore: mainSrc, guardian: progSrc, invasion: invSrc };
  for(const kind of Object.keys(A.DEEDS)){
    assert.ok(wired[kind], 'deed kind "' + kind + '" has a live emitter');
  }
}

// Developer testing: every feature in this wave must be reachable from the
// debug menu — several of this wave's bugs were only cheap to find once you
// could TRIGGER the state (a glider that never opened, a forest that never sowed).
{
  const uiSrc = await (await import('node:fs/promises')).readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
  const mainDbg = await (await import('node:fs/promises')).readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  if(!uiSrc.includes('function injectLayerDebugPanel(actions, menuPanel)')) throw new Error('injectLayerDebugPanel must exist');
  if(!/box\.id=spec\.id/.test(uiSrc)) throw new Error('feature debug panels keep a stable DOM id');
  if(!uiSrc.includes("id:'layerDebugBox'")) throw new Error('layerDebugBox must have its stable DOM id');
  if(!mainDbg.includes('MM.ui.injectLayerDebugPanel(')) throw new Error('injectLayerDebugPanel must be wired from main.js');
}

console.log('attention-sim: all assertions passed');
