// Hero elemental status regressions (engine/hero_status.js): the player-side
// mirror of the mob matrix.
//   * wet is combo fuel: electric damage x1.5 (damageInMult), fire fizzles
//   * wet + chill in deep frost flash-freezes for 1.5 s (+ refreeze lock)
//   * burn ticks damage, water/soak douses it, warmth dries wet/chill 4x
//   * list() feeds the vitals HUD debuff chips (name/icon/t/debuff)
// Run: node tools/hero-status-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const noted = [];
MM.discovery = { note: (id) => { noted.push(id); return true; } };

const { heroStatus } = await import('../src/engine/hero_status.js');
assert.ok(heroStatus, 'hero_status module exports');
const HS = heroStatus;
const TUNING = HS.TUNING;

function step(seconds, env){
  let out = { burnDamage: 0, frozeNow: false };
  const steps = Math.ceil(seconds / 0.05);
  for(let i = 0; i < steps; i++){
    const r = HS.update(0.05, env || {});
    out.burnDamage += r.burnDamage;
    out.frozeNow = out.frozeNow || r.frozeNow;
  }
  return out;
}

// --- wet: combo fuel, HUD chip, conduction ----------------------------------
HS.clearAll();
assert.equal(HS.apply('wet', { dur: 8 }), 'wet', 'wet applies');
assert.equal(HS.has('wet'), true);
assert.equal(HS.damageInMult('electric'), TUNING.WET_ELECTRIC_MULT, 'a soaked hero conducts electricity x1.5');
assert.equal(HS.damageInMult('fire'), 1, 'conduction only amplifies electric');
{
  const chips = HS.list();
  assert.ok(chips.some(c => c.icon === '💧' && c.debuff === true && c.t > 0), 'wet renders as a debuff chip');
}
HS.clearAll();
assert.equal(HS.damageInMult('electric'), 1, 'a dry hero takes normal electric damage');

// --- fire fizzles on a soaked hero ------------------------------------------
HS.clearAll(); noted.length = 0;
HS.apply('wet', { dur: 8 });
assert.equal(HS.apply('burn', { dur: 3, dps: 2 }), 'fizzled', 'burn refuses to stick to a soaked hero');
assert.equal(HS.has('burn'), false, 'no burn after the fizzle');
assert.ok(HS._state.wet < 8, 'the fizzle boils some of the soak away');
assert.ok(noted.includes('hero_fizzle'), 'the fizzle unlocks its discovery');

// --- wet douses an active burn ----------------------------------------------
HS.clearAll();
assert.equal(HS.apply('burn', { dur: 3, dps: 2 }), 'burn', 'burn applies to a dry hero');
assert.equal(HS.has('burn'), true);
HS.apply('wet', { dur: 6 });
assert.equal(HS.has('burn'), false, 'a soak douses the burn');

// --- burn ticks damage on the 0.5 s cadence ---------------------------------
HS.clearAll();
HS.apply('burn', { dur: 3, dps: 2 });
{
  const r = step(3.2, {});
  assert.ok(r.burnDamage >= 5 && r.burnDamage <= 7, `a full 3 s burn at 2 dps ticks ~6 damage (${r.burnDamage})`);
  assert.equal(HS.has('burn'), false, 'burn expires');
}
// swimming extinguishes mid-burn
HS.clearAll();
HS.apply('burn', { dur: 3, dps: 2 });
step(0.3, { inWater: true });
assert.equal(HS.has('burn'), false, 'diving under water puts the hero out');

// --- deep-frost flash freeze (wet + chill) + refreeze lock -------------------
HS.clearAll(); noted.length = 0;
HS.apply('wet', { dur: 8 });
HS.apply('chill', { dur: 4 });
{
  const r = step(0.1, { deepFrost: true });
  assert.equal(r.frozeNow, true, 'wet+chill in deep frost freezes the hero solid');
  assert.equal(HS.isFrozen(), true);
  assert.equal(HS.moveMult(), 0, 'a frozen hero cannot move');
  assert.equal(HS.has('wet'), false, 'the freeze consumes the soak');
  assert.equal(HS.has('chill'), false, 'the freeze consumes the chill');
  assert.ok(noted.includes('hero_frozen'), 'freezing unlocks its discovery');
  assert.ok(HS.list().some(c => c.icon === '🧊'), 'frozen renders as a debuff chip');
}
step(TUNING.FROZEN_DUR + 0.2, { deepFrost: true });
assert.equal(HS.isFrozen(), false, 'the ice shell melts after ~1.5 s');
// the lock prevents an instant re-freeze from lingering statuses
HS.apply('wet', { dur: 8 });
HS.apply('chill', { dur: 4 });
{
  const r = step(0.2, { deepFrost: true });
  assert.equal(r.frozeNow, false, 'the refreeze lock blocks an immediate second freeze');
  assert.equal(HS.isFrozen(), false);
}

// --- chill slows (the old heroChillUntil contract, now unified) ---------------
HS.clearAll();
HS.apply('chill', { dur: 2 });
assert.equal(HS.moveMult(), TUNING.CHILL_MOVE_MULT, 'chill slows movement to x0.55');
step(2.4, {});
assert.equal(HS.moveMult(), 1, 'the chill wears off');

// --- warmth dries: wet and chill drain 4x near a campfire/torch --------------
HS.clearAll();
HS.apply('wet', { dur: 8 });
step(1, {});
const wetNoWarmth = HS._state.wet;
HS.clearAll();
HS.apply('wet', { dur: 8 });
step(1, { nearWarmth: true });
const wetWarmth = HS._state.wet;
assert.ok(wetWarmth < wetNoWarmth - 2, `warmth dries much faster (${wetWarmth} vs ${wetNoWarmth})`);
// standing in water never dries the soak
HS.clearAll();
HS.apply('wet', { dur: 8 });
step(2, { inWater: true });
assert.ok(HS._state.wet >= 7.9, 'submersion keeps the soak topped');

// --- god mode sheds everything ----------------------------------------------
HS.apply('chill', { dur: 4 });
HS.apply('burn', { dur: 3 });
step(0.1, { godMode: true });
assert.equal(HS.list().length, 0, 'god mode clears all statuses');

console.log('hero-status-sim: all assertions passed');
