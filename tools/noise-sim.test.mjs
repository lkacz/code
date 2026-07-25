// Hałas — the sound field (src/engine/noise.js).
// A pure decision layer: emitters record sounds, creatures hear them, quiet
// bodies are harder to see. Nothing here touches the world, so all of it is
// testable headless (the hero_crush.js pattern).
// Run: node tools/noise-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { noise: N } = await import('../src/engine/noise.js');
const src = await (await import('node:fs/promises')).readFile(new URL('../src/engine/noise.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------- emit + hear
{
  N.reset();
  assert.equal(N.heardBy(0, 0), null, 'silence is heard by nobody');

  N.emit(0, 0, 'mine', 1);
  const near = N.heardBy(3, 0);
  assert.ok(near, 'a mining strike is heard nearby');
  assert.equal(near.cause, 'mine', 'the listener learns WHAT it heard');
  assert.equal(near.x, 0, 'and WHERE — that is what makes a decoy possible');

  assert.equal(N.heardBy(400, 0), null, 'a tap does not carry across the world');
  assert.equal(N.emit(0, 0, 'nonsense', 1), 0, 'unknown causes emit nothing');
  assert.equal(N.emit(NaN, 0, 'mine', 1), 0, 'a non-finite point emits nothing');
}

// ------------------------------------------------------------- hardness scale
// The whole point: 150 tile hardness values start to matter because loudness
// scales with what you are digging through.
{
  N.reset();
  const soft = N.radiusFor('mine', 0.25);
  const hard = N.radiusFor('mine', 1.8);
  assert.ok(hard > soft * 3, 'obsidian rings out far louder than snow');
  assert.ok(N.radiusFor('blast', 1.6) <= N.CFG.MAX_RADIUS, 'even a huge blast is capped');
  assert.ok(N.radiusFor('blast', 999) <= N.CFG.MAX_RADIUS, 'no caller can mint a world-waking bang');
  assert.ok(N.CFG.CAUSE.blast > N.CFG.CAUSE.mine, 'a detonation is louder than a pick');
  assert.ok(N.CFG.CAUSE.sprint > N.CFG.CAUSE.step, 'running is louder than walking');
}

// -------------------------------------------------------------------- decay
{
  N.reset();
  N.emit(0, 0, 'mine', 1);
  assert.ok(N.heardBy(2, 0), 'a fresh sound is audible');
  N.tick(N.CFG.TTL + 0.2);
  assert.equal(N.heardBy(2, 0), null, 'sounds fade — a creature does not remember forever');
}

// ------------------------------------------------------------------ loudest wins
{
  N.reset();
  N.emit(2, 0, 'step', 1);      // close but faint
  N.emit(-14, 0, 'blast', 1);   // distant but enormous
  const heard = N.heardBy(0, 0);
  assert.equal(heard.cause, 'blast', 'a distant detonation drowns out a nearby footfall');
}

// ----------------------------------------------------------------- sneaking
{
  N.reset();
  assert.equal(N.sightMult(null), 1, 'no body = no stealth bonus');
  assert.equal(N.sightMult({vx: 8, vy: 0}), 1, 'a sprinting body is fully visible');
  assert.equal(N.sightMult({vx: 0.5, vy: 0}), N.CFG.QUIET_SIGHT, 'a crawling body is spotted at half range');
  assert.equal(N.sightMult({quiet: true, vx: 9}), N.CFG.QUIET_SIGHT, 'an explicit quiet flag wins over speed');
  assert.equal(N.sightMult({quiet: false, vx: 0}), 1, 'an explicit loud flag wins too');
  assert.ok(N.CFG.QUIET_SIGHT < 1, 'sneaking is always an improvement');

  assert.equal(N.bodyQuiet({vx: 0.4, vy: 0}), true, 'a slow body is sneaking');
  assert.equal(N.bodyQuiet({vx: 9, vy: 0}), false, 'a fast body is not');

  // the emitter half: sneaking makes NO sound, walking does
  N.reset();
  assert.equal(N.emitMovement({x: 0, y: 0, vx: 0.4, vy: 0}), 0, 'a sneaking body emits nothing at all');
  assert.equal(N.heardBy(1, 0), null, '...and so is genuinely inaudible');
  assert.ok(N.emitMovement({x: 0, y: 0, vx: 3, vy: 0}) > 0, 'a walking body emits a footfall');
  assert.ok(N.heardBy(1, 0), '...which a nearby creature hears');
  assert.equal(N.emitMovement({x: 0, y: 0, vx: 0, vy: 0}), 0, 'a standing body emits nothing');
  // A STRIDE, not a frame: emitting per frame filled the 48-slot ring with one
  // walker's own footsteps in under a second, so a blast was evicted before any
  // creature could hear it and the TTL silently became "48 frames".
  {
    N.reset();
    const walker = {x: 0, y: 0, vx: 3, vy: 0};
    N.emit(-20, 0, 'blast', 1);
    let steps = 0;
    for(let f = 0; f < 120; f++){ if(N.emitMovement(walker) > 0) steps++; N.tick(1 / 60); }
    assert.ok(steps > 0, 'a walking body does emit footfalls');
    assert.ok(steps < 20, 'but at a stride cadence, not once per frame (' + steps + ' in 2s)');
    assert.ok(N.metrics().live < N.CFG.RING, 'one walker can never fill the whole ring');
  }
  assert.equal(N.emitMovement(null), 0, 'a missing body is not a crash');
}

// ------------------------------------------------------------- keen / deaf ears
{
  N.reset();
  N.emit(0, 0, 'step', 1);
  const r = N.CFG.CAUSE.step;
  assert.equal(N.heardBy(r + 2, 0), null, 'ordinary ears miss a faint distant step');
  assert.ok(N.heardBy(r + 2, 0, {keen: 2.5}), 'a keen-eared species hears further');
  assert.equal(N.heardBy(1, 0, {keen: 0}), null, 'a deaf species opts out entirely');
}

// -------------------------------------------------------------- weather masking
// The release valve: without it, mining in a storm would be unplayable.
{
  N.reset();
  const savedWind = MM.wind;
  try {
    MM.wind = undefined;
    assert.equal(N.floorLevel(), 0, 'a calm world has no noise floor');
    N.emit(0, 0, 'mine', 1);
    const calmHeard = !!N.heardBy(N.CFG.CAUSE.mine - 1, 0);
    assert.ok(calmHeard, 'in calm air a mining strike carries its full radius');

    MM.wind = { speed: () => 7.2 };
    assert.ok(N.floorLevel() > 0.5, 'a gale raises the ambient noise floor');
    N.reset();
    MM.wind = { speed: () => 7.2 };
    N.emit(0, 0, 'mine', 1);
    assert.equal(N.heardBy(N.CFG.CAUSE.mine - 1, 0), null, 'a gale masks the same strike at the same range');
    assert.ok(N.heardBy(1, 0), 'but a creature standing on top of you still hears it');
    assert.ok(N.floorLevel() <= 1, 'the floor is a bounded 0..1');
  } finally { MM.wind = savedWind; }
}

// ------------------------------------------------------------------- backstab
{
  assert.equal(N.isUnaware({}), true, 'a calm creature is unaware');
  assert.equal(N.isUnaware({_aggro: true}), false, 'a creature that SEES you is aware');
  assert.equal(N.isUnaware({_investigate: {x: 0, y: 0}}), false, 'a creature that HEARD you is aware');
  // PERCEPTION, not hostility: mobs.js sets _noticed for ANY creature within
  // sight/pursue range, hostile or not. Keying off _aggro alone made every
  // passive animal permanently ambushable. (There is no status.aggroed in the
  // STATUS registry — the original predicate tested a field that never existed.)
  assert.equal(N.isUnaware({_noticed: true}), false, 'a creature that has NOTICED you is aware, even if peaceful');
  assert.equal(N.isUnaware({_hurtOnce: true}), false, 'a creature already struck knows you are there — one ambush only');
  assert.equal(N.isUnaware(null), false, 'no creature is not a backstab');
  assert.ok(N.CFG.BACKSTAB_MULT > 1.5, 'the backstab payoff is worth the speed cost');
  assert.ok(N.CFG.BACKSTAB_STUN > 0, 'a backstab buys you a moment');
}

// ---------------------------------------------------------------- bounded ring
// A busy frame must never grow this module's memory.
{
  N.reset();
  for(let i = 0; i < N.CFG.RING * 8; i++) N.emit(i, 0, 'step', 1);
  assert.ok(N.metrics().live <= N.CFG.RING, 'the ring buffer is hard-bounded (' + N.metrics().live + ')');
}

// ------------------------------------------------------------ architecture pins
// This module's whole safety argument is that it writes NOTHING to the world.
{
  // strip comments first: this module DOCUMENTS the rules it obeys, and the
  // prose would otherwise match the very patterns the pin forbids
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/setTile|spawnResource|breakMinedTile|MM\.world/.test(code),
    'noise.js never writes the world — no chokepoint, no stream plane, no hact needed');
  assert.ok(!/window\.player|root\.player/.test(code),
    'noise.js never reads window.player (CLAUDE.md rule 3: body params only)');
  assert.ok(/export function sightMult\(body\)/.test(src), 'sightMult takes a BODY, so coop bodies sneak too');
  assert.equal(typeof N.reset, 'function', 'the field is resettable between worlds');

  // the consumers really are wired to the one perception line + the melee entry
  const fs = await import('node:fs/promises');
  const mobsSrc = await fs.readFile(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
  const mainSrc = await fs.readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mobsSrc, /MM\.noise\.sightMult\(heroForMob\)/, 'sneaking feeds the mob sight test');
  assert.match(mobsSrc, /MM\.noise\.heardBy\(m\.x, m\.y/, 'creatures consult the sound field');
  assert.match(mobsSrc, /MM\.noise\.isUnaware\(m\)/, 'the melee entry checks for a backstab');
  // Sight ACQUIRES, pursue only RETAINS: every species declares pursueRange >
  // sightRange, so (canSee || shouldPursue) was a pure distance test — the only
  // carrier of quietSight (canSee) could never decide anything and the ambush
  // window could not open on any creature within melee reach.
  assert.match(mobsSrc, /const spotted = canSee && \(!quietTarget \|\| facingTarget \|\| distToPlayer<=1\.0\)/,
    'a sneaking body must also be in FRONT of the creature to be spotted');
  assert.match(mobsSrc, /m\._noticed = spotted \|\| \(shouldPursue && !!m\._noticed\)/,
    'sight acquires, pursue only retains');
  assert.match(mainSrc, /NOISE\.emitMovement\(player\)/, 'the hero announces its own movement');
  assert.match(mainSrc, /for\(const b of bodies\) NOISE\.emitMovement\(b\)/, 'and so does every coop body');
  assert.match(mainSrc, /NOISE\.emit\(tx\+0\.5, ty\+0\.5, 'mine'/, 'mining emits through the shared break hook');
  const wSrc = await fs.readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
  assert.match(wSrc, /MM\.noise\.emit\(a\.x,a\.y,'decoy',1\)/, 'a thrown stone is a decoy');
  const xSrc = await fs.readFile(new URL('../src/engine/explosion_damage.js', import.meta.url), 'utf8');
  assert.match(xSrc, /root\.noise\.emit\(wx, wy, 'blast'/, 'every blast routes through the shared noise emitter');
}

// Developer testing: every feature in this wave must be reachable from the
// debug menu — several of this wave's bugs were only cheap to find once you
// could TRIGGER the state (a glider that never opened, a forest that never sowed).
{
  const uiSrc = await (await import('node:fs/promises')).readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
  const mainDbg = await (await import('node:fs/promises')).readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  if(!uiSrc.includes('function injectNoiseDebugPanel(actions, menuPanel)')) throw new Error('injectNoiseDebugPanel must exist');
  if(!/box\.id=spec\.id/.test(uiSrc)) throw new Error('feature debug panels keep a stable DOM id');
  if(!uiSrc.includes("id:'noiseDebugBox'")) throw new Error('noiseDebugBox must have its stable DOM id');
  if(!mainDbg.includes('MM.ui.injectNoiseDebugPanel(')) throw new Error('injectNoiseDebugPanel must be wired from main.js');
}

console.log('noise-sim: all assertions passed');
