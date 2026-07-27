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
// main.js physics() adds a FULL gravity step BEFORE the glider runs
// (MOVE.GRAV 20 x playerSpeedMultiplier 2 = 40 tiles/s^2, capped at 40). A
// harness without it measures terminal velocities in a world the game does not
// have — which is exactly how the thermal branch shipped unable to beat gravity.
const GRAV_STEP = 40 / 60;
function gravity(b){ b.vy += GRAV_STEP; if(b.vy > 40) b.vy = 40; }

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
  for(let i = 0; i < 240; i++){ gravity(b); r = G.step(b, 1 / 60, air, HOLD); }
  assert.ok(r.open, 'the canopy stays open through a sustained fall');
  assert.notEqual(r.reason, 'stall', 'gravity must never out-run the canopy into a stall');
  assert.ok(b.vy < 4.2, 'under REAL gravity the canopy still holds a gentle descent (' + b.vy.toFixed(2) + ')');
  // Terminal is the equilibrium between the gravity step and the canopy easing —
  // measurably ~3.6 tiles/s, NOT the bare GLIDE_VY target. A gravity-free harness
  // measured ~2.6 and hid the fact that the thermal branch could not beat gravity.
  assert.ok(Math.abs(b.vy - 3.6) < 0.25, 'terminal glide under real gravity (' + b.vy.toFixed(2) + ')');
  assert.ok(b.vy < 40 * 0.15, 'a 40 tiles/s free fall is cut to a fraction of its speed');
  assert.ok(b.vy > 0, 'a glide still descends — it is not flight');
  assert.ok(G.CFG.GLIDE_VY < 6, 'terminal glide is far gentler than free fall');
  assert.ok(G.CFG.DRAG_RATE >= 24, 'canopy drag must out-pace the 40 tiles/s^2 gravity step main.js applies first');
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
  for(let i = 0; i < 240; i++){ gravity(soaring); r = G.step(soaring, 1 / 60, lavaBelow, HOLD); }
  assert.ok(r.lift > 0, 'the glider reports the lift it found');
  assert.notEqual(r.reason, 'stall', 'a thermal must not stall the canopy');
  assert.ok(soaring.vy < 0, 'a strong thermal beats GRAVITY and reverses the fall into a climb (' + soaring.vy.toFixed(2) + ')');
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
  // the shape main.js ACTUALLY writes (recipe id:'glider' -> inv.tools.glider)
  G.reset();
  globalThis.inv = { tools: { glider: true } };
  const viaTools = { x: 0, y: 0, vx: 0, vy: 6, onGround: false };
  assert.equal(G.step(viaTools, 0.1, air, HOLD).open, true, 'the hero reads inv.tools.glider — the flag main.js persists');
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
  // Surviving a save means being on the ONE list the writer, the reader and the
  // save VALIDATOR all read. Shipping the flag without listing it is what made
  // every save this build wrote unloadable (see save-schema-sim for the guard).
  assert.match(mainSrc, /const SAVE_TOOL_FLAGS=Object\.freeze\(\[[^\]]*'glider'[^\]]*\]\)/, 'the crafted glider survives a save');
  // movement only: no world write, no window.player
  const code = modSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/setTile/.test(code), 'the glider never writes the world (no chokepoint or plane needed)');
  assert.ok(!/window\.player/.test(code), 'the glider never reads window.player (CLAUDE.md rule 3)');
  assert.ok(/function step\(body, dt, getTile, opts\)/.test(modSrc), 'step takes a BODY, so coop bodies glide too');
}

// Developer testing: every feature in this wave must be reachable from the
// debug menu — several of this wave's bugs were only cheap to find once you
// could TRIGGER the state (a glider that never opened, a forest that never sowed).
{
  const uiSrc = await (await import('node:fs/promises')).readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
  const mainDbg = await (await import('node:fs/promises')).readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  if(!uiSrc.includes('function injectGliderDebugPanel(actions, menuPanel)')) throw new Error('injectGliderDebugPanel must exist');
  if(!/box\.id=spec\.id/.test(uiSrc)) throw new Error('feature debug panels keep a stable DOM id');
  if(!uiSrc.includes("id:'gliderDebugBox'")) throw new Error('gliderDebugBox must have its stable DOM id');
  if(!mainDbg.includes('MM.ui.injectGliderDebugPanel(')) throw new Error('injectGliderDebugPanel must be wired from main.js');
}

console.log('glider-sim: all assertions passed');
