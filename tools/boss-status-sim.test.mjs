// Weakened boss matrix regressions (engine/boss_status.js) — ONE shared helper
// for every boss/guardian family:
//   * hard-CC immunity: 'frozen'/'freeze' applications downgrade to chill
//   * chill = 20% slow (speedMult 0.8), never immobility
//   * wet = electric conduction x1.25 (and douses an active burn)
//   * burn = DoT at HALF the applied dps
//   * MM.bossStatus registry fans applyRadius out to registered systems
// Run: node tools/boss-status-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const {
  BOSS_STATUS_TUNING, createBossStatus, bossStatusFor,
  applyBossStatus, tickBossStatus, bossElectricDamageMult, bossStatus,
} = await import('../src/engine/boss_status.js');

assert.ok(bossStatus, 'boss_status module exports');
assert.equal(MM.bossStatus, bossStatus, 'helper registers on MM.bossStatus');
assert.equal(BOSS_STATUS_TUNING.CHILL_SLOW, 0.8, 'chill contract: 20% slow');
assert.equal(BOSS_STATUS_TUNING.WET_ELECTRIC_MULT, 1.25, 'wet contract: conduction x1.25');
assert.equal(BOSS_STATUS_TUNING.BURN_DOT_MULT, 0.5, 'burn contract: half DoT');

function tickFor(st, seconds){
  let damage = 0, lastMult = 1;
  const steps = Math.ceil(seconds / 0.05);
  for(let i = 0; i < steps; i++){
    const r = tickBossStatus(st, 0.05);
    damage += r.damage;
    lastMult = r.speedMult;
  }
  return { damage, lastMult };
}

// --- hard-CC immunity: freeze lands as chill ---------------------------------
{
  const st = createBossStatus();
  assert.equal(applyBossStatus(st, 'frozen', { dur: 2.5 }), 'chill', "a 'frozen' application downgrades to chill");
  assert.equal(applyBossStatus(st, 'freeze'), 'chill', "the 'freeze' alias downgrades too");
  assert.ok(st.chill > 0, 'the downgrade left a chill timer');
  const r = tickBossStatus(st, 0.05);
  assert.equal(r.speedMult, BOSS_STATUS_TUNING.CHILL_SLOW, 'chilled boss keeps 80% speed — never a hard stop');
}

// --- chill expires cleanly ----------------------------------------------------
{
  const st = createBossStatus();
  applyBossStatus(st, 'chill', { dur: 1 });
  const r = tickFor(st, 1.3);
  assert.equal(r.lastMult, 1, 'speed returns to 100% after the chill');
}

// --- wet: conduction + dousing ------------------------------------------------
{
  const st = createBossStatus();
  assert.equal(bossElectricDamageMult(st), 1, 'dry boss takes normal electric damage');
  applyBossStatus(st, 'wet', { dur: 6 });
  assert.equal(bossElectricDamageMult(st), BOSS_STATUS_TUNING.WET_ELECTRIC_MULT, 'soaked boss conducts x1.25');
  assert.equal(bossElectricDamageMult(null), 1, 'no state (never hit) is safe');
}
{
  const st = createBossStatus();
  applyBossStatus(st, 'burn', { dur: 3, dps: 4 });
  assert.ok(st.burnT > 0, 'burn ticking');
  applyBossStatus(st, 'wet', { dur: 6 });
  assert.equal(st.burnT, 0, 'a soak douses the boss burn');
}

// --- burn: half DoT, fizzle on a soaked hide ----------------------------------
{
  const st = createBossStatus();
  applyBossStatus(st, 'burn', { dur: 3, dps: 4 });
  assert.equal(st.burnDps, 4 * BOSS_STATUS_TUNING.BURN_DOT_MULT, 'stored dps is halved at application');
  const r = tickFor(st, 3.2);
  assert.ok(r.damage >= 5 && r.damage <= 7, `3 s of 4-dps burn ticks ~6 total on a boss (${r.damage})`);
  assert.equal(st.burnT, 0, 'burn expires');
}
{
  const st = createBossStatus();
  applyBossStatus(st, 'wet', { dur: 6 });
  assert.equal(applyBossStatus(st, 'burn', { dur: 3, dps: 4 }), 'fizzle', 'fire fizzles on a soaked boss');
  assert.equal(st.burnT, 0, 'no burn after the fizzle');
  assert.ok(st.wet < 6, 'the fizzle dries part of the soak');
}

// --- unsupported kinds are ignored --------------------------------------------
{
  const st = createBossStatus();
  assert.equal(applyBossStatus(st, 'poison', { dur: 5 }), null, 'bosses shrug poison off (mob-only status)');
}

// --- lazy per-entity state -----------------------------------------------------
{
  const entity = { x: 0, y: 0 };
  const st = bossStatusFor(entity);
  assert.equal(bossStatusFor(entity), st, 'bossStatusFor attaches one shared state per entity');
  applyBossStatus(st, 'wet');
  assert.equal(bossElectricDamageMult(entity._elemStatus), BOSS_STATUS_TUNING.WET_ELECTRIC_MULT, 'the attached state drives conduction');
}

// --- registry: weapons splash statuses into every registered family -----------
{
  const hits = [];
  MM.bossStatus.registerSystem('fakeBosses', {
    applyRadius(wx, wy, r, kind, opts){ hits.push({ wx, wy, r, kind, src: opts && opts.source }); return 2; },
  });
  const n = MM.bossStatus.applyRadius(10, 20, 1.5, 'wet', { source: 'hero' });
  assert.ok(n >= 2, 'applyRadius sums the adapters');
  assert.equal(hits.length, 1, 'the fake system was reached');
  assert.equal(hits[0].kind, 'wet');
  assert.equal(hits[0].src, 'hero');
  MM.bossStatus._systems.delete('fakeBosses');
}

// --- live wiring pins: every boss family registers + consults the helper ------
import { readFileSync } from 'node:fs';
const srcOf = (p) => readFileSync(new URL('../src/engine/' + p, import.meta.url), 'utf8');
for(const file of ['bosses.js', 'guardian_lairs.js', 'sky_guardian.js', 'underground_boss.js']){
  const src = srcOf(file);
  assert.ok(/registerSystem\(/.test(src), file + ' registers with the boss-status registry');
  assert.ok(/tickBossStatus\(/.test(src), file + ' ticks the weakened matrix each frame');
  assert.ok(/bossElectricDamageMult\(/.test(src), file + ' applies wet conduction to incoming electric damage');
}
{
  const weapons = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
  assert.ok(/bossStatus\.applyRadius\([^)]*'chill'/.test(weapons), 'snowball splats chill bosses');
  assert.ok(/bossStatus\.applyRadius\([^)]*'wet'/.test(weapons), 'balloon/hose soaks bosses');
  assert.ok(/bossStatus\.applyRadius\([^)]*'burn'/.test(weapons), 'flame stream burns bosses (half DoT)');
}

console.log('boss-status-sim: all assertions passed');
