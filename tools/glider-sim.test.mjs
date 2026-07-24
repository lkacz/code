// Lotnia — the glider (src/engine/glider.js).
// wind.js:applyToHero already sampled per-body exposure every frame but only
// ever wrote vx: the weather could nudge you sideways, never carry you.
// Run: node tools/glider-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { glider: G } = await import('../src/engine/glider.js');

const air = () => T.AIR;
const body = (over) => Object.assign({ x: 0, y: 10, vx: 0, vy: 6, onGround: false, glider: true }, over || {});
const HOLD = { holdingJump: true };

// ------------------------------------------------------------------- gating
{
  G.reset();
  const noKit = body({ glider: false });
  assert.equal(G.step(noKit, 0.1, air, HOLD).open, false, 'no canopy, no glide');
  assert.equal(noKit.vy, 6, '...and the fall is untouched');

  G.reset();
  const grounded = body({ onGround: true });
  assert.equal(G.step(grounded, 0.1, air, HOLD).reason, 'grounded', 'standing on the ground never opens it');

  G.reset();
  const wet = body();
  assert.equal(G.step(wet, 0.1, air, { holdingJump: true, inWater: true }).reason, 'water', 'a canopy is useless underwater');

  G.reset();
  const released = body();
  assert.equal(G.step(released, 0.1, air, { holdingJump: false }).open, false, 'letting go of jump closes it');

  G.reset();
  const rising = body({ vy: -8 });
  assert.equal(G.step(rising, 0.1, air, HOLD).reason, 'notfalling', 'it catches only once you are actually falling');

  G.reset();
  const diving = body({ vy: G.CFG.STALL_SPEED + 5 });
  assert.equal(G.step(diving, 0.1, air, HOLD).reason, 'stall', 'too fast a dive tears the canopy back shut');
  assert.equal(G.isOpen(), false, '...and the state reflects it');
}

// ------------------------------------------------------------- the slow fall
{
  G.reset();
  const b = body({ vy: 14 });
  // dive-speed guard first: start under the stall limit
  b.vy = 12;
  let r;
  for(let i = 0; i < 60; i++) r = G.step(b, 1 / 60, air, HOLD);
  assert.ok(r.open, 'the canopy stays open through a sustained fall');
  // easing is asymptotic, so it approaches terminal glide rather than snapping to it
  assert.ok(b.vy <= G.CFG.GLIDE_VY + 0.15, 'the fall eases down to terminal glide (' + b.vy.toFixed(2) + ')');
  assert.ok(b.vy < 12 * 0.35, 'a 12 tiles/s plummet is cut to a fraction of its speed');
  assert.ok(b.vy > 0, 'a glide still descends — it is not flight');
  assert.ok(G.CFG.GLIDE_VY < 6, 'terminal glide is far gentler than free fall');
}

// -------------------------------------------------------------- wind carries
{
  G.reset();
  const saved = MM.wind;
  try {
    MM.wind = undefined;
    const still = body();
    G.step(still, 0.1, air, HOLD);
    assert.equal(still.vx, 0, 'no wind module, no carry');

    G.reset();
    MM.wind = { speed: () => 7 };
    const carried = body();
    for(let i = 0; i < 60; i++) G.step(carried, 1 / 60, air, HOLD);
    assert.ok(carried.vx > 0.2, 'a tailwind carries the glider downwind (' + carried.vx.toFixed(2) + ')');

    G.reset();
    MM.wind = { speed: () => -7 };
    const back = body();
    for(let i = 0; i < 60; i++) G.step(back, 1 / 60, air, HOLD);
    assert.ok(back.vx < -0.2, 'a headwind carries it the other way');

    G.reset();
    MM.wind = { speed: () => 900 };
    const gale = body();
    for(let i = 0; i < 200; i++) G.step(gale, 1 / 60, air, HOLD);
    assert.ok(Math.abs(gale.vx) <= G.CFG.MAX_GLIDE_VX + 0.001,
      'horizontal speed is capped so a gale cannot break the pose envelope (' + gale.vx.toFixed(2) + ')');
  } finally { MM.wind = saved; }
}

// ----------------------------------------------------------------- thermals
{
  G.reset();
  assert.equal(G._debug.isHeatSource(T.LAVA), true, 'lava makes rising air');
  assert.equal(G._debug.isHeatSource(T.HOT_AIR), true, 'hot air does too');
  assert.equal(G._debug.isHeatSource(T.STONE), false, 'cold rock does not');

  const lavaBelow = (x, y) => (y >= 14 ? T.LAVA : T.AIR);
  assert.ok(G._debug.thermalAt(0, 10, lavaBelow) > 0, 'a lava field below makes a thermal');
  const cappedByRock = (x, y) => (y >= 12 ? T.STONE : T.AIR);
  assert.equal(G._debug.thermalAt(0, 10, cappedByRock), 0, 'solid rock caps the column — no thermal through a floor');

  // the payoff: rising air lifts you ABOVE where you started
  G.reset();
  const soaring = body({ vy: 5 });
  let r;
  for(let i = 0; i < 60; i++) r = G.step(soaring, 1 / 60, lavaBelow, HOLD);
  assert.ok(r.lift > 0, 'the glider reports the lift it found');
  assert.ok(soaring.vy < 0, 'a strong thermal reverses the fall into a climb (' + soaring.vy.toFixed(2) + ')');
  assert.ok(soaring.vy >= G.CFG.THERMAL_MAX_VY - 0.001, 'climb speed is capped (' + soaring.vy.toFixed(2) + ')');
}

// --------------------------------------------------------------- body-agnostic
// A coop body glides exactly like the host (CLAUDE.md rule 3).
{
  G.reset();
  const guest = { x: 5, y: 20, vx: 0, vy: 8, onGround: false, glider: true };
  const r = G.step(guest, 0.2, air, HOLD);
  assert.ok(r.open, 'a non-hero body opens its own canopy');
  assert.ok(guest.vy < 8, '...and its own fall slows');

  // an explicit false beats the global inventory fallback
  G.reset();
  globalThis.inv = { glider: true };
  const denied = { x: 0, y: 0, vx: 0, vy: 6, onGround: false, glider: false };
  assert.equal(G.step(denied, 0.1, air, HOLD).open, false, 'a body without a canopy cannot borrow the hero inventory');
  const viaInv = { x: 0, y: 0, vx: 0, vy: 6, onGround: false };
  assert.equal(G.step(viaInv, 0.1, air, HOLD).open, true, 'the hero falls back to its crafted tool flag');
  globalThis.inv = undefined;
}

// --------------------------------------------------------------- robustness
{
  G.reset();
  assert.equal(G.step(null, 0.1, air, HOLD).open, false, 'a missing body is not a crash');
  assert.equal(G.step(body(), 0, air, HOLD).open, false, 'a zero dt does nothing');
  assert.equal(G.step(body(), 0.1, null, HOLD).open, false, 'a missing world is not a crash');
  const nan = body({ vy: NaN });
  G.step(nan, 0.1, air, HOLD);
  assert.ok(!Number.isNaN(Number(nan.vx)), 'a NaN velocity never propagates into vx');
}

// ------------------------------------------------------------ wiring contract
{
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const modSrc = await readFile(new URL('../src/engine/glider.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /GLIDER\.step\(player, dt, getTile/, 'the hero frame steps the glider');
  assert.match(mainSrc, /id:'glider'/, 'the glider is craftable');
  assert.match(mainSrc, /inv\.tools\.glider/, 'it is a crafted tool flag, not a new gear KIND (gear purity)');
  assert.match(mainSrc, /glider:!!inv\.tools\.glider/, 'the crafted glider survives a save');
  // movement only: no world write, no window.player
  const code = modSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/setTile/.test(code), 'the glider never writes the world (no chokepoint or plane needed)');
  assert.ok(!/window\.player/.test(code), 'the glider never reads window.player (CLAUDE.md rule 3)');
  assert.ok(/function step\(body, dt, getTile, opts\)/.test(modSrc), 'step takes a BODY, so coop bodies glide too');
}

console.log('glider-sim: all assertions passed');
