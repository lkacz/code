// The far-world simulation clock (src/engine/world_sim.js).
//
// The invariant under test: frame cost = O(near the players) + fixed budgets,
// never O(world) — far machines are FROZEN (zero work, zero tile reads) and a
// region that comes back into range pays its whole absence through one wake
// step. Run: node tools/world-sim-sim.test.mjs
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { CHUNK_W, WORLD_SECTION_H } = await import('../src/constants.js');
const { worldSim: S } = await import('../src/engine/world_sim.js');

assert.ok(S && S.beginFrame && S.wakeDt, 'world sim module exports its frame/gate API');

// ------------------------------------------------------------------ the clock
{
  S.reset();
  assert.equal(S.now(), 0, 'a fresh clock starts at zero');
  S.beginFrame(0.5, {x:0,y:0}, null); S.endFrame();
  S.beginFrame(0.25, {x:0,y:0}, null); S.endFrame();
  assert.ok(Math.abs(S.now() - 0.75) < 1e-9, 'the clock accumulates sim dt');
  assert.equal(S.skip(10), true, 'a throttle gap can jump the clock');
  assert.ok(Math.abs(S.now() - 10.75) < 1e-9, 'the skip advanced it without a frame');
  assert.equal(S.skip(-5), false, 'negative gaps are refused');
  assert.equal(S.skip(NaN), false, 'non-finite gaps are refused');
  S.beginFrame(NaN, {x:0,y:0}, null); S.endFrame();
  assert.ok(Math.abs(S.now() - 10.75) < 1e-9, 'a malformed dt advances nothing');
}

// ------------------------------------------------------- gating without windows
{
  S.reset();
  assert.equal(S.tracking(), false, 'no frame yet — not tracking');
  assert.equal(S.isHot(99999, 0), true, 'without windows nothing is ever gated (Node suites, ghost boot)');
  assert.equal(S.wakeDt(0.1, 99999, 0, 900), 0.1, 'wakeDt passes dt through untracked');
  S.beginFrame(0.1, null, null); S.endFrame();
  assert.equal(S.tracking(), false, 'a frame without a live hero does not arm the gate');
}

// ------------------------------------------------ region hotness and staleness
{
  S.reset();
  const hero = {x: 10, y: 10};
  const frame = (dt) => { S.beginFrame(dt, hero, null); S.endFrame(); };
  frame(0.1);
  assert.equal(S.tracking(), true, 'a live hero arms the gate');
  assert.equal(S.isHot(10, 10), true, 'the hero region is hot');
  assert.equal(S.isHot(10 + CHUNK_W * 6, 10), false, 'six columns away is frozen');
  // Hotness is REGION-granular: everything in a column the window touches is
  // hot, even coordinates past the raw radius. Hotness and stamps sharing one
  // granularity is what makes staleness exact (a partially-covered region must
  // not get a fresh stamp while machines in its far half are skipped).
  const edgeX = Math.floor((10 + S.CFG.HOT_RX) / CHUNK_W) * CHUNK_W + CHUNK_W - 1;
  assert.equal(S.isHot(edgeX, 10), true, 'the whole touched column is hot to its far edge');

  // stay 8 s, then move away and come back: the wake owes the absence
  for(let i = 0; i < 10; i++) frame(0.1);
  const farX = 10 + CHUNK_W * 8;
  hero.x = farX;
  for(let i = 0; i < 50; i++) frame(0.1);          // 5 s elsewhere
  assert.equal(S.isHot(10, 10), false, 'the old home region froze');
  assert.equal(S.wakeDt(0.1, 10, 10, 900), null, 'wakeDt reports it frozen');
  hero.x = 10;
  S.beginFrame(0.1, hero, null);                    // wake frame: BEFORE endFrame
  const lag = S.staleSeconds(10, 10);
  assert.ok(Math.abs(lag - 5.0) < 0.11, 'staleness equals the absence (' + lag.toFixed(2) + 's)');
  const step = S.wakeDt(0.1, 10, 10, 900);
  assert.ok(Math.abs(step - (0.1 + lag)) < 1e-9, 'the wake step is dt plus the whole lag');
  assert.equal(S.wakeDt(0.1, 10, 10, 2), 0.1 + 2, 'a module wake cap clamps the payback');
  S.endFrame();
  S.beginFrame(0.1, hero, null);
  assert.ok(S.wakeDt(0.1, 10, 10, 900) === 0.1, 'once stamped, the next frame owes only dt');
  S.endFrame();
  // A region NEVER simulated owes nothing — fabricated lag would mint resources.
  assert.equal(S.staleSeconds(farX + CHUNK_W * 20, 10), 0, 'unknown ground carries no debt');
}

// ------------------------------------------------------- the one-mechanism skip
{
  S.reset();
  const hero = {x: 0, y: 0};
  const frame = (dt) => { S.beginFrame(dt, hero, null); S.endFrame(); };
  frame(0.1); frame(0.1);
  S.skip(30);                                       // a throttled tab woke up
  S.beginFrame(0.1, hero, null);
  const step = S.wakeDt(0.1, 0, 0, 900);
  assert.ok(Math.abs(step - 30.1) < 0.11, 'after a skip even HOT machines owe the gap (' + step.toFixed(1) + 's) — one mechanism, no per-module fan-out');
  S.endFrame();
}

// ------------------------------------------------------------- co-op windows
{
  S.reset();
  const hero = {x: 0, y: 0};
  const guest = {x: CHUNK_W * 10, y: 0};
  S.beginFrame(0.1, hero, [guest, {dead: true, x: CHUNK_W * 20, y: 0}, null]); S.endFrame();
  assert.equal(S.isHot(guest.x, 0), true, 'an embodied guest keeps its region hot (CLAUDE.md rule 3)');
  assert.equal(S.isHot(CHUNK_W * 20, 0), false, 'a dead body opens no window');
  assert.equal(S.metrics().windows, 2, 'hero plus one live guest');
}

// ------------------------------------------------------------ vertical sections
{
  S.reset();
  const hero = {x: 0, y: 10};
  S.beginFrame(0.1, hero, null); S.endFrame();
  assert.equal(S.isHot(0, 10 + WORLD_SECTION_H * 3), false, 'three sections below is frozen — depth gates like distance');
}

// -------------------------------------------------------------- state round trip
{
  S.reset();
  const hero = {x: 10, y: 10};
  const frame = (dt) => { S.beginFrame(dt, hero, null); S.endFrame(); };
  for(let i = 0; i < 20; i++) frame(0.5);           // 10 s, home stamped
  hero.x = 10 + CHUNK_W * 9;
  for(let i = 0; i < 10; i++) frame(0.5);           // 5 s away
  const snap = S.snapshot();
  assert.equal(snap.v, 1, 'snapshot carries its version');
  assert.ok(snap.now > 14.9, 'snapshot carries the clock');
  assert.ok(Array.isArray(snap.stamps) && snap.stamps.length >= 2, 'snapshot carries the region stamps');
  const json = JSON.parse(JSON.stringify(snap));    // the trip a save makes
  S.reset();
  assert.equal(S.restore(json), true, 'restore accepts its own snapshot');
  assert.ok(Math.abs(S.now() - snap.now) < 1e-6, 'the clock survives');
  hero.x = 10;
  S.beginFrame(0.1, hero, null);
  const lag = S.staleSeconds(10, 10);
  assert.ok(lag > 4.5 && lag < 6.5, 'staleness survives a save/load — the absence is still owed (' + lag.toFixed(2) + 's)');
  S.endFrame();
  // restoreRequired contract: idle input is valid, garbage is not
  assert.equal(S.restore({v: 1, now: 0, stamps: []}), true, 'an idle snapshot restores as what it is');
  assert.equal(S.restore(null), false, 'a missing snapshot object is refused');
  assert.equal(S.restore({v: 1, now: -5, stamps: 'junk'}), true, 'malformed fields degrade to a fresh clock rather than failing the save');
  assert.equal(S.now(), 0, 'a negative clock resets to zero');
}

// ------------------------------------------------------------------ stamp cap
{
  S.reset();
  const hero = {x: 0, y: 0};
  for(let i = 0; i < S.CFG.STAMP_CAP + 500; i += 4){
    hero.x = i * CHUNK_W;
    S.beginFrame(0.05, hero, null); S.endFrame();
  }
  assert.ok(S.metrics().stamps <= S.CFG.STAMP_CAP, 'the stamp map is bounded (' + S.metrics().stamps + ')');
  assert.ok(S.metrics().evictions > 0, 'overflow evicts the oldest stamps — a forgotten region forfeits catch-up, never fabricates it');
}

// ------------------------------------------------------------- wiring contract
{
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const modSrc = await readFile(new URL('../src/engine/world_sim.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /WORLD_SIM\.beginFrame\(dt, player, MM\.coopBodies\)/, 'the sim step opens the frame with hero + coop bodies');
  assert.match(mainSrc, /WORLD_SIM\.endFrame\(\);\n\}\n\/\/ Hero-mode guest frame/, 'the frame closes after the LAST machine update — mid-frame stamping would steal lag from later modules');
  assert.match(mainSrc, /if\(!\(WORLD_SIM && WORLD_SIM\.skip\(simDt\)\)\) return false;/, 'the throttled-tab gap rides the clock skip — the per-module fan-out is gone (it would double-credit hot machines)');
  assert.match(mainSrc, /worldSim: timedSavePart\('worldSim'/, 'the clock is part of the save');
  assert.match(mainSrc, /restoreRequired\('worldSim',data\.worldSim!=null/, 'and of the load');
  assert.match(mainSrc, /if\(WORLD_SIM && WORLD_SIM\.reset\) WORLD_SIM\.reset\(\);/, 'world regen resets the clock');
  // The gate must never write tiles or read them: it is pure coordinate math.
  assert.ok(!/setTile|getTile/.test(modSrc), 'worldSim touches no tiles — the gate is pure coordinate math');
  // Every converted registry gates through the ONE seam.
  for(const [file, needle] of [
    ['dynamo.js', 'SIM.wakeDt(dt,m.x,m.y,WAKE_MAX_SECONDS)'],
    ['solar.js', 'SIM.wakeDt(dt,m.x,m.y,WAKE_MAX_SECONDS)'],
    ['teleporters.js', 'SIM.wakeDt(dt,m.x,m.y,WAKE_MAX_SECONDS)'],
    ['pumps.js', 'SIM.wakeDt(dt,m.x,m.y,CATCHUP_MAX_SECONDS)'],
    ['turrets.js', 'SIM.wakeDt(dt,m.x,m.y,WAKE_MAX_SECONDS)'],
    ['spring_platforms.js', 'SIM.wakeDt(dt,m.x,m.y,WAKE_MAX_SECONDS)'],
    ['kiln.js', 'SIM.wakeDt(dt, k.x, k.y, CFG.WAKE_MAX_SEC)'],
    ['steam_machines.js', 'SIM.wakeDt(dt,b.x,b.y,WAKE_MAX_SECONDS)'],
    ['furnishings.js', 'SIM.wakeDt(step,x,y,POWER_CATCHUP_MAX_SECONDS)'],
    ['vending.js', 'SIM.isHot(m.x,m.y)']
  ]){
    const src = await readFile(new URL('../src/engine/' + file, import.meta.url), 'utf8');
    assert.ok(src.includes(needle), file + ' gates its machines through worldSim (' + needle + ')');
  }
  // SMR stays attended-by-design: presence gating IS its far-world policy.
  const smrSrc = await readFile(new URL('../src/engine/smr.js', import.meta.url), 'utf8');
  assert.match(smrSrc, /if\(!present\) continue; \/\/ unattended: idle, timers hold/, 'SMR keeps its own attended-only law — no wake catch-up for a reactor nobody is watching');
}

console.log('world-sim-sim: all assertions passed');
