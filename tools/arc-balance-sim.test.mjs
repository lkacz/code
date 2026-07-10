// Arc balance guardrails: the story's difficulty ladder and XP economy are
// tuning surfaces that drift silently when individual numbers get edited in
// isolation. This test pins the INVARIANTS, not the magic values:
//   - guardian boss HP escalates monotonically along the arc
//     (horizons < Third Mole < sky crown), and the final mirror deliberately
//     sits outside the ladder (its HP mirrors the hero's own maxHp)
//   - story milestone XP escalates act by act and the structured XP economy
//     (all milestones + full discovery journal) lands the hero in a sane
//     level band — enough skill points to matter, not enough to trivialize
// Run: node tools/arc-balance-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: k => { store.delete(String(k)); },
    key: i => [...store.keys()][i] ?? null,
    get length(){ return store.size; }
  }
});

const src = name => readFileSync(new URL('../src/engine/' + name, import.meta.url), 'utf8');

// --- the difficulty ladder, read from the tuning sources ---------------------
const lairs = src('guardian_lairs.js');
const horizonHp = lairs.match(/kind==='fire'\?(\d+):(\d+)/);
assert.ok(horizonHp, 'horizon boss HP formula found in guardian_lairs.js');
const fireHp = Number(horizonHp[1]), iceHp = Number(horizonHp[2]);
const earthHp = Number((src('underground_boss.js').match(/BOSS_HP:\s*(\d+)/) || [])[1]);
const airHp = Number((src('sky_guardian.js').match(/BOSS_HP:\s*(\d+)/) || [])[1]);
assert.ok(fireHp > 0 && iceHp > 0 && earthHp > 0 && airHp > 0, 'all four ladder HP values resolved');
assert.ok(Math.abs(fireHp - iceHp) <= Math.max(fireHp, iceHp) * 0.15,
  `the two horizons are peers (fire ${fireHp} vs ice ${iceHp})`);
assert.ok(earthHp > Math.max(fireHp, iceHp) * 1.2,
  `the Third Mole outclasses the horizons (${earthHp} vs ${Math.max(fireHp, iceHp)})`);
assert.ok(airHp > earthHp,
  `the sky crown tops the mole (${airHp} vs ${earthHp})`);
assert.ok(airHp < Math.max(fireHp, iceHp) * 3,
  `the ladder stays a ramp, not a wall (air ${airHp} <= 3x horizons)`);
// The final boss is deliberately OFF the ladder: it mirrors the hero.
assert.ok(/mimic\.maxHp=Math\.max\(CFG\.MIN_BOSS_HP,\s*Math\.round\(finite\(p && p\.maxHp/.test(src('center_guardian.js')),
  'the last mirror sizes itself to the hero, not to the ladder');

// --- story milestone XP escalates along the arc -------------------------------
const progressSrc = src('progress.js');
const mile = id => {
  const m = progressSrc.match(new RegExp("\\{id:'" + id + "'[^}]*xp:(\\d+)"));
  assert.ok(m, `milestone ${id} exists with an xp reward`);
  return Number(m[1]);
};
const arcXp = ['guardian_ice', 'guardian_fire', 'guardian_earth', 'guardian_air', 'story_complete'].map(mile);
for(let i = 1; i < arcXp.length; i++){
  assert.ok(arcXp[i] >= arcXp[i - 1], `act ${i + 1} pays at least act ${i} (${arcXp[i]} >= ${arcXp[i - 1]})`);
}
assert.ok(arcXp[4] >= 2 * arcXp[3], 'the finale pays out like a finale');

// --- structured XP economy lands in a sane level band -------------------------
const { discovery } = await import('../src/engine/discovery.js');
await import('../src/engine/progress.js');
const milestoneXp = [...progressSrc.matchAll(/xp:(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
const discoveryXp = discovery.total() * discovery.DISCOVERY_XP;
const structured = milestoneXp + discoveryXp;
globalThis.player = {xp: structured};
const level = MM.progress.level().level;
// Completionist structured content alone (no mob grinding) should fund a real
// build without maxing the curve: ~10 skill points across 5 trainable stats.
assert.ok(level >= 9 && level <= 15,
  `milestones (${milestoneXp}) + discoveries (${discoveryXp}) => level ${level}, expected 9..15`);
// And each of the five hearts is a visible milestone, so the arc always pays.
for(const id of ['guardian_ice', 'guardian_fire', 'guardian_earth', 'guardian_air', 'story_complete']){
  assert.ok(MM.progress.milestones().some(m => m.id === id), `milestone ${id} registered at runtime`);
}

console.log('arc-balance-sim: ladder ' + [Math.min(fireHp, iceHp) + '-' + Math.max(fireHp, iceHp), earthHp, airHp].join(' -> ')
  + ' + mirror; structured XP ' + structured + ' => level ' + level + '; all assertions passed');
