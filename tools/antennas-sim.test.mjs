// Antenna gear wave regression tests (Node, no DOM — window stubbed).
// Covers: the ACTIVES power table (host-owned numbers, tier ladder), the
// activation state machine (cooldown, energy, host ack sync), the cloak gate
// every hunter asks (local hero + co-op bodyLike forms), rod physics sanity,
// chest-loot purity for the new kind, and SOURCE pins on every integration
// seam (main.js, mobs.js, ghost_* wiring). Run: npm run test:antennas
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

// --- module under test with a minimal inventory stub -------------------------
let equippedAntenna = null;
globalThis.MM.inventory = {
  equippedId(slot){ return slot === 'antenna' && equippedAntenna ? equippedAntenna.id : null; },
  equippedItem(slot){ return slot === 'antenna' ? equippedAntenna : null; },
  getItem(id){ return equippedAntenna && equippedAntenna.id === id ? equippedAntenna : null; }
};
let energy = 100;
globalThis.MM.heroEnergy = {
  canSpend: (n) => energy >= n,
  spend: (n) => { if(energy < n) return false; energy -= n; return true; }
};
const { antennas } = await import('../src/engine/antennas.js');
assert.ok(antennas, 'antennas module exports');

// --- ACTIVES: the module's own power levels (multiplayer trust anchor) -------
assert.deepEqual(Object.keys(antennas.ACTIVES), ['cloak', 'surge', 'echo'], 'active roster is pinned — a new active means new host validation');
assert.deepEqual(antennas.TIER_KEYS, ['common', 'uncommon', 'rare', 'epic', 'legendary'], 'tier ladder pinned');
for (const [id, spec] of Object.entries(antennas.ACTIVES)) {
  assert.ok(spec.cd > 0 && spec.energy > 0, id + ' carries a cooldown and an energy cost');
  let prev = 0;
  for (const tier of antennas.TIER_KEYS) {
    const dur = antennas.durationFor(id, tier);
    assert.ok(dur > 0, id + '/' + tier + ' has a duration');
    assert.ok(dur >= prev, id + ' duration never shrinks up the tiers');
    assert.ok(dur < spec.cd, id + '/' + tier + ' duration stays under its cooldown (no permanent uptime)');
    prev = dur;
  }
}
assert.equal(antennas.tierKey('mythic'), 'legendary', 'mythic claims map to legendary power');
assert.equal(antennas.tierKey('__evil__'), 'common', 'unknown tier claims fall to common (host-side clamp)');
assert.ok(antennas.cooldownFor('cloak', true) < antennas.cooldownFor('cloak', false), 'a unique find cools down faster — its only boost');
assert.ok(antennas.echoRangeFor('legendary') > antennas.echoRangeFor('common'), 'echo range grows with tier');

// --- rod physics: stands upright, whips against motion, never explodes -------
function makePlayer(opts = {}){
  return { x: opts.x ?? 0, y: opts.y ?? 50, w: 0.7, h: 0.95,
    vx: opts.vx ?? 0, vy: opts.vy ?? 0, facing: opts.facing ?? 1, onGround: opts.onGround !== false };
}
function runRod(player, seconds = 1){
  antennas.init(player);
  const steps = Math.ceil(seconds * 60);
  for (let i = 0; i < steps; i++){
    player.x += (player.vx || 0) / 60;
    antennas.update(player, 1 / 60, () => 0);
  }
  return antennas._points.map(p => ({ x: p.x, y: p.y }));
}
equippedAntenna = null;
assert.equal(antennas.init(makePlayer()), false, 'no rod without an equipped antenna');
equippedAntenna = { id: 'ant_test', kind: 'antenna', name: 'Antenka radarowa', tier: 'rare', visionRadius: 12 };
let p = makePlayer();
assert.equal(antennas.init(p), true, 'rod initializes with an equipped antenna');
assert.equal(antennas._points.length, 8, 'rod is an articulated verlet chain');
const idle = runRod(p, 1);
const anchor = idle[0], tip = idle[idle.length - 1];
assert.ok(idle.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y)), 'rod stays finite');
assert.ok(anchor.y < p.y - p.h * 0.45, 'rod anchors on top of the head');
assert.ok(tip.y < anchor.y - 0.3, 'rod stands up from the head instead of hanging');
p = makePlayer({ vx: 6 });
const moving = runRod(p, 1);
const mAnchor = moving[0], mTip = moving[moving.length - 1];
assert.ok(mTip.x < mAnchor.x - 0.04, 'running bends the tip backwards (' + (mTip.x - mAnchor.x).toFixed(3) + ')');

// --- activation state machine ------------------------------------------------
equippedAntenna = { id: 'ant_passive', kind: 'antenna', name: 'Antenka radarowa', tier: 'rare', visionRadius: 12 };
assert.equal(antennas.tryActivate().reason, 'passive', 'a passive antenna has no Q-power');
assert.equal(antennas.cloaked(null), false, 'no cloak without an activation');
equippedAntenna = { id: 'ant_cloak', kind: 'antenna', name: 'Antenka kameleona', tier: 'rare', antennaActive: 'cloak' };
energy = 5;
assert.equal(antennas.tryActivate().reason, 'energy', 'activation refuses without energy');
energy = 100;
const fired = antennas.tryActivate();
assert.equal(fired.ok, true, 'cloak fires');
assert.equal(energy, 100 - antennas.ACTIVES.cloak.energy, 'activation spends the active energy cost');
assert.ok(Math.abs(fired.dur - antennas.durationFor('cloak', 'rare')) < 0.05, 'duration follows the module table for the item tier');
assert.equal(antennas.cloaked(null), true, 'the local hero is cloaked while the window runs');
assert.ok(antennas.heroAlpha() < 0.5, 'a cloaked hero renders as a shimmer');
assert.equal(antennas.tryActivate().reason, 'cd', 'the cooldown refuses an immediate re-fire');
// host ack (hero guest): the HOST duration is what its mob AI honors
antennas.hostAck(true, 'cloak', 5000);
assert.equal(antennas.cloaked(null), true, 'host ack keeps the cloak running');
antennas.hostAck(false, 'cloak');
assert.equal(antennas.cloaked(null), false, 'a host refusal clears the optimistic cloak');
// the cloak gate understands co-op bodyLike forms (host fields)
assert.equal(antennas.cloaked({ cloaked: true }), true, 'bodyLike per-tick flag counts as cloaked');
assert.equal(antennas.cloaked({ cloakUntil: (performance.now ? performance.now() : Date.now()) + 1000 }), true, 'raw host cloakUntil counts as cloaked');
assert.equal(antennas.cloaked({ x: 0, y: 0 }), false, 'a plain body is visible');
// surge drives the movement multiplier (guest-local truth in hero mode)
equippedAntenna = { id: 'ant_surge', kind: 'antenna', name: 'Antenka burzowa', tier: 'epic', antennaActive: 'surge' };
antennas._state.cdUntil = 0;
assert.equal(antennas.moveMult(), 1, 'no surge without activation');
assert.equal(antennas.tryActivate().ok, true, 'surge fires');
assert.equal(antennas.moveMult(), antennas.ACTIVES.surge.moveMult, 'surge boosts movement while it runs');
assert.equal(antennas.cloaked(null), false, 'surge is not a cloak');

// --- chest loot: purity of the new kind (shares the inventory contract) ------
await import('../src/inventory.js');
const INV = globalThis.MM.inventory;
const { chests } = await import('../src/engine/chests.js');
assert.ok(INV.SLOTS.some(s => s.id === 'antenna' && s.accepts === 'antenna' && !s.required), 'antenna equip slot exists and is optional');
assert.deepEqual(INV.KIND_STAT_PRIORITY.antenna, ['visionRadius', 'attackDamage', 'damageReductionBonus'], 'antenna job stats pinned');
assert.deepEqual(Object.keys(INV.ANTENNA_ACTIVE_LABELS), ['cloak', 'surge', 'echo'], 'inventory active whitelist mirrors the module roster');
const RNG = seed => { let st = seed >>> 0; return () => { st = (st * 1664525 + 1013904223) >>> 0; return (st >>> 8) / 0xFFFFFF; }; };
const NUM_FIELDS = ['airJumps','visionRadius','specialVisionLevel','treasureSenseLevel','moveSpeedMult','jumpPowerMult','mineSpeedMult','waterMoveSpeedMult','attackDamage','fireDps','fireRange','fireCooldown','energyCost','energyCapacityBonus','lootMagnetLevel','crushResistBonus','damageReductionBonus'];
let actives = 0, passives = 0;
for (let i = 0; i < 900; i++) {
  const tier = ['common', 'uncommon', 'rare', 'epic', 'legendary'][i % 5];
  const item = chests.genItem(RNG(i * 104729 + 7), tier, { kind: 'antenna' });
  assert.equal(item.kind, 'antenna');
  const present = NUM_FIELDS.filter(f => typeof item[f] === 'number');
  if (item.antennaActive) {
    actives++;
    assert.ok(INV.ANTENNA_ACTIVE_LABELS[item.antennaActive], 'rolled active is on the whitelist');
    assert.equal(present.length, 0, 'an active antenna carries ONLY its power identity, got ' + present.join(','));
    assert.notEqual(tier, 'common', 'actives never roll at common tier');
  } else {
    passives++;
    assert.equal(present.length, 1, 'a passive antenna carries exactly one stat, got ' + present.join(','));
    assert.ok(INV.KIND_STAT_PRIORITY.antenna.includes(present[0]), 'passive stat is a legal antenna job stat');
  }
  if (typeof item.damageReductionBonus === 'number') assert.ok(item.damageReductionBonus > 0 && item.damageReductionBonus <= 0.25, 'guard fraction bounded');
  if (typeof item.visionRadius === 'number') assert.equal(item.visionRadius, Math.round(item.visionRadius), 'vision in whole tiles');
  assert.match(item.name, /^Antenka /, 'antenna loot advertises itself');
}
assert.ok(actives > 40 && passives > 200, 'both antenna families actually roll (' + actives + ' active / ' + passives + ' passive)');
// sanitize: antennaActive survives only on antennas with a whitelisted power
const granted = INV.grantItem({ id: 'ant_evil', kind: 'antenna', name: 'X', antennaActive: 'godmode', damageReductionBonus: 9 });
assert.ok(granted, 'sanitized antenna lands in the bag');
const evil = INV.getItem('ant_evil');
assert.equal(evil.antennaActive, undefined, 'an unknown active name is dropped on ingest');
assert.ok((evil.damageReductionBonus || 0) <= 0.25, 'smuggled guard fractions clamp to the cap');
const smuggled = INV.grantItem({ id: 'w_ant', kind: 'weapon', weaponType: 'melee', name: 'X', attackDamage: 3, antennaActive: 'cloak' });
assert.ok(smuggled, 'weapon ingest still works');
assert.equal(INV.getItem('w_ant').antennaActive, undefined, 'antennaActive never rides a non-antenna kind');

// --- SOURCE pins: every integration seam of the wave -------------------------
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const mainSrc = read('../src/main.js');
const mobsSrc = read('../src/engine/mobs.js');
const hostSrc = read('../src/engine/ghost_host.js');
const clientSrc = read('../src/engine/ghost_client.js');
const netSrc = read('../src/engine/ghost_net.js');
const keySrc = read('../src/engine/keybinds.js');
const discSrc = read('../src/engine/discovery.js');
// main.js: lifecycle + input + render seams
assert.match(mainSrc, /ANTENNAS\.update\) ANTENNAS\.update\(player,dt,getTile\)/, 'antenna physics ticks with the cape/necklace frame');
assert.match(mainSrc, /k==='q'&&!keysOnce\.has\('q'\)\)\{ activateAntennaPower\(\)/, 'Q fires the antenna active');
assert.match(mainSrc, /k==='y'&&!keysOnce\.has\('y'\)\)\{ toggleSpecialVision\(\)/, 'vision moved to Y when Q became the antenna key');
assert.match(mainSrc, /ANTENNAS\.draw\) ANTENNAS\.draw\(ctx,TILE,player\)/, 'the rod renders on the hero');
assert.match(mainSrc, /const heroA=\(opts&&opts\.cloaked\)\?0\.32/, 'drawPlayer fades the whole hero while cloaked (remote bodies included)');
assert.match(mainSrc, /heroCloakA>=0\.98 && WEAPONS && WEAPONS\.drawHeld/, 'the held weapon vanishes while cloaked instead of half-ghosting');
assert.match(mainSrc, /ANTENNAS\.moveMult\)\?ANTENNAS\.moveMult\(\):1\)/, 'surge joins the movement multiplier chain');
assert.match(mainSrc, /drawAntennaEchoOverlay\(camRenderX,camRenderY,screenShake\)/, 'echo sonar draws with the overlay pass');
assert.match(mainSrc, /drawPlayer\(\{remoteBody:true, cloaked:!!st\.cloaked\}\)/, 'remote heroes pass their cloak flag into the painter');
// mobs.js: the cloak gate at the one target-selection chokepoint
assert.match(mobsSrc, /const heroCloaked = !spec\.senseCloak && typeof MM!=='undefined' && MM\.antennas && MM\.antennas\.cloaked && MM\.antennas\.cloaked\(null\)/, 'mob AI asks the cloak gate (senseCloak species see through)');
assert.match(mobsSrc, /const heroForMob = heroCloaked \? \{x:m\.x-10000, y:m\.y\} : player/, 'a cloaked hero becomes the blind-style decoy');
assert.match(mobsSrc, /if\(b\.cloaked\) continue; \/\/ antenna cloak/, 'cloaked co-op bodies drop out of mob target selection');
// ghost wiring: intent + host authority + stream flags
assert.ok(netSrc.includes("'antenna'"), 'antenna is a HERO_ACTION');
assert.match(netSrc, /ANTENNA_MS: 1500/, 'the intent has a host rate floor');
assert.match(hostSrc, /pl\.a === 'antenna'/, 'handleHeroAct owns an antenna branch');
assert.match(hostSrc, /A\.tierKey\(pl\.tr\)/, 'the host clamps the claimed tier through its own whitelist');
assert.match(hostSrc, /b\.cloakUntil = t \+ durMs/, 'the HOST owns the cloak duration');
assert.match(hostSrc, /entry\.bodyLike\.cloaked = \(b\.cloakUntil \|\| 0\) > t/, 'the bodyLike flag feeds the mob gate every body tick');
assert.match(hostSrc, /\(\(b\.cloakUntil \|\| 0\) > t\) \? 1 : 0\]/, 'the pb plane carries the cloak flag to every peer');
assert.match(hostSrc, /const ck = \(MMR && MMR\.antennas && MMR\.antennas\.cloaked && MMR\.antennas\.cloaked\(null\)\) \? 1 : 0/, 'the hero plane carries the HOST hero cloak');
assert.match(clientSrc, /antenna\(k, tier, unique\)/, 'heroIntents exposes the antenna sender');
assert.match(clientSrc, /_heroAntenna: \(k, tier, unique\) => heroIntents\.antenna\(k, tier, unique\)/, 'QA seam fires the production intent');
assert.match(clientSrc, /MMR\.antennas\.hostAck\) MMR\.antennas\.hostAck\(!!pl\.ok, pl\.k, Number\(pl\.ms\)\)/, 'the host ack syncs the local shimmer window');
assert.match(clientSrc, /o\.cloaked = !!\+row\[11\]/, 'fellow players adopt the pb cloak flag');
assert.match(clientSrc, /remoteHost\.cloaked = !!pl\.ck/, 'the host hero adopts the hero-plane cloak flag');
// keybinds + discovery
assert.match(keySrc, /\{id:'antenna',\s+group:'akcja', def:'q', label:'Moc antenki'\}/, 'antenna owns the Q default');
assert.match(keySrc, /\{id:'vision',\s+group:'widok', def:'y'/, 'vision default moved to Y');
assert.match(discSrc, /antenna_cloak: 'Kamuflaż antenki/, 'cloak discovery is in the catalog');

console.log('antennas-sim: all assertions passed');
