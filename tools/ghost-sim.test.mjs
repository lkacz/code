// Ghost spectator regressions (engine/ghost_net.js + the ghost wiring):
// the pure protocol core — room codes, watch links, snapshot chunking, buff
// cooldown ledger, minimal MQTT codec — plus source pins that keep the
// main.js/world.js/mobs.js/index.html integration honest: the save codec IS
// the wire codec, ghost sessions must never persist, and the sim/loop split
// (host streams inside the sim branch, watcher frame replaces it) must hold.
// Run: node tools/ghost-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const NET = await import('../src/engine/ghost_net.js');

// --- room codes & watch links -------------------------------------------------
for(let i = 0; i < 50; i++){
	const c = NET.roomCode();
	assert.equal(c.length, 6, 'room code is 6 chars');
	assert.ok(/^[A-HJ-KM-NP-TV-Z2-9]+$/.test(c), 'room code avoids lookalike glyphs: ' + c);
}
assert.equal(NET.roomCode(() => 0), 'AAAAAA', 'rng is honored');
assert.equal(NET.normalizeRoom('ab-12'), 'AB12', 'normalize strips separators and uppercases');
assert.equal(NET.normalizeRoom('ab'), null, 'too-short rooms rejected');
assert.equal(NET.normalizeRoom('x'.repeat(20)), null, 'too-long rooms rejected');
assert.equal(
	NET.watchLink('https://lkacz.github.io/code/index.html?foo=1#frag', 'ROOM42'),
	'https://lkacz.github.io/code/index.html?watch=ROOM42',
	'watch link strips old query/hash'
);
assert.equal(NET.watchLink('http://x/y', 'R2D2X9', 'bc'), 'http://x/y?watch=R2D2X9&via=bc', 'via rides the link');

// --- parseWatch -----------------------------------------------------------------
assert.equal(NET.parseWatch(''), null, 'no watch param -> null');
assert.equal(NET.parseWatch('?watch=ab'), null, 'invalid room -> null');
assert.deepEqual(NET.parseWatch('?watch=qa42x7'), { room: 'QA42X7', via: null, name: null }, 'room normalized');
assert.deepEqual(NET.parseWatch('?title=1&watch=ROOM42&via=bc&name=Zed'), { room: 'ROOM42', via: 'bc', name: 'Zed' }, 'via+name parsed');
assert.equal(NET.parseWatch('?watch=ROOM42&via=evil').via, null, 'unknown via rejected');

// --- snapshot chunking -----------------------------------------------------------
const small = NET.chunkPayload('snap', 'hello');
assert.equal(small.length, 1, 'small payload -> one chunk');
assert.deepEqual({ t: small[0].t, k: small[0].k, i: small[0].i, of: small[0].of, d: small[0].d },
	{ t: 'chunk', k: 'snap', i: 0, of: 1, d: 'hello' }, 'chunk envelope shape');
const big = 'x'.repeat(2048) + 'y'.repeat(2048) + 'z'.repeat(100);
const chunks = NET.chunkPayload('snap', big, 2048);
assert.equal(chunks.length, 3, 'payload splits on the limit');
const asm = NET.createAssembler();
assert.equal(asm.push(chunks[0]), null, 'partial transfer stays pending');
assert.equal(asm.push(chunks[1]), null, 'still pending');
assert.equal(asm.pending().got, 2, 'pending tracks progress');
const done = asm.push(chunks[2]);
assert.equal(done.kind, 'snap', 'assembled kind');
assert.equal(done.data, big, 'assembled payload matches');
assert.equal(asm.pending(), null, 'assembler resets after completion');
// a fresh transfer id preempts a stale half-received one
const stale = NET.chunkPayload('snap', 'o'.repeat(40), 16, 'stale');
assert.equal(stale.length, 3, 'stale transfer spans chunks');
const fresh = NET.chunkPayload('snap', 'new!', 16, 'fresh');
const asm2 = NET.createAssembler();
asm2.push(stale[0]);
assert.equal(asm2.push(fresh[0]).data, 'new!', 'new transfer id replaces the stale one');
// duplicate delivery of the same chunk must not double-count
const dup = NET.chunkPayload('snap', 'AB'.repeat(20), 16, 'dup');
assert.equal(dup.length, 3, 'dup transfer spans chunks');
const asm3 = NET.createAssembler();
asm3.push(dup[0]); asm3.push(dup[0]);
assert.equal(asm3.pending().got, 1, 'duplicate chunk counted once');
asm3.push(dup[1]);
assert.equal(asm3.push(dup[2]).data, 'AB'.repeat(20), 'roundtrip after duplicate');

// --- assembler bounds: hostile chunk headers must be inert ---------------------------
const hostileAsm = NET.createAssembler();
assert.equal(hostileAsm.push({ t: 'chunk', k: 'snap', id: 'h1', i: 0, of: 1e9, d: 'x' }), null, 'absurd chunk count rejected');
assert.equal(hostileAsm.pending(), null, 'rejected header leaves no transfer state');
assert.equal(hostileAsm.push({ t: 'chunk', k: 'snap', id: 'h2', i: 0, of: 0, d: 'x' }), null, 'zero chunk count rejected');
assert.equal(hostileAsm.push({ t: 'chunk', k: 'snap', id: 'h3', i: 0, of: 1, d: 'y'.repeat(70000) }), null, 'oversized chunk body rejected');
const legit = NET.chunkPayload('snap', 'AB'.repeat(20), 16, 'ok1');
const mixAsm = NET.createAssembler();
mixAsm.push(legit[0]);
assert.equal(mixAsm.push({ t: 'chunk', k: 'snap', id: 'ok1', i: 1, of: 99, d: 'z' }), null, 'header disagreeing with its own transfer is dropped');
mixAsm.push(legit[1]);
assert.equal(mixAsm.push(legit[2]).data, 'AB'.repeat(20), 'transfer survives a forged mid-stream header');
assert.ok(NET.ASSEMBLER_MAX_CHUNKS * NET.ASSEMBLER_MAX_CHUNK_LEN >= 32 * 1024 * 1024, 'bounds still admit a large legitimate world snapshot');

// --- buff rules & cooldown ledger ---------------------------------------------------
assert.ok(NET.validBuffKind('cheer') && NET.validBuffKind('bless') && NET.validBuffKind('energy'), 'the three lanes exist');
assert.ok(!NET.validBuffKind('nuke') && !NET.validBuffKind('__proto__'), 'unknown/prototype kinds rejected');
assert.ok(NET.BUFF_RULES.bless.heal > 0, 'bless heals');
assert.ok(NET.BUFF_RULES.energy.energy > 0, 'energy grants energy');
assert.ok(NET.BUFF_RULES.cheer.cd < NET.BUFF_RULES.bless.cd, 'cosmetic lane is cheaper than mechanical');
const ledger = NET.createCooldownLedger();
assert.equal(ledger.tryUse('g1', 'bless', 1000).ok, true, 'first bless allowed');
const denied = ledger.tryUse('g1', 'bless', 2000);
assert.equal(denied.ok, false, 'second bless inside cd denied');
assert.ok(denied.waitMs > 0 && denied.waitMs <= NET.BUFF_RULES.bless.cd, 'waitMs reported');
assert.equal(ledger.tryUse('g2', 'bless', 2000).ok, true, 'cooldowns are per-ghost');
assert.equal(ledger.tryUse('g1', 'cheer', 2000).ok, true, 'lanes are independent');
assert.equal(ledger.tryUse('g1', 'bless', 1000 + NET.BUFF_RULES.bless.cd).ok, true, 'bless allowed after cd');
assert.equal(ledger.tryUse('g1', 'flood', 0).ok, false, 'unknown kind denied');

// --- minimal MQTT codec ---------------------------------------------------------------
const connect = NET.mqttEncodeConnect('client-1', 50);
assert.equal(connect[0], 0x10, 'CONNECT fixed header');
assert.ok(new TextDecoder().decode(connect).includes('MQTT'), 'protocol name embedded');
const sub = NET.mqttEncodeSubscribe(7, 'mmg1/ROOM/h');
assert.equal(sub[0], 0x82, 'SUBSCRIBE fixed header');
const dec = NET.createMqttDecoder();
assert.deepEqual(dec.push(Uint8Array.from([0x20, 2, 0, 0])), [{ type: 'connack', ok: true }], 'CONNACK ok parsed');
assert.deepEqual(dec.push(Uint8Array.from([0x20, 2, 0, 5])), [{ type: 'connack', ok: false }], 'CONNACK refusal parsed');
const pub = NET.mqttEncodePublish('mmg1/R/g1', '{"k":"hi","from":"h"}');
let got = dec.push(pub);
assert.equal(got.length, 1, 'publish roundtrips');
assert.equal(got[0].type, 'publish');
assert.equal(got[0].topic, 'mmg1/R/g1', 'topic preserved');
assert.equal(got[0].payload, '{"k":"hi","from":"h"}', 'payload preserved');
// split delivery across arbitrary byte boundaries must reassemble
const dec2 = NET.createMqttDecoder();
const parts = [pub.subarray(0, 3), pub.subarray(3, 7), pub.subarray(7)];
assert.equal(dec2.push(parts[0]).length, 0, 'no packet from a sliver');
assert.equal(dec2.push(parts[1]).length, 0, 'still buffering');
got = dec2.push(parts[2]);
assert.equal(got.length, 1, 'split packet reassembled');
assert.equal(got[0].payload, '{"k":"hi","from":"h"}', 'split payload intact');
// multi-byte remaining length (>127 body bytes)
const bigPub = NET.mqttEncodePublish('t', 'p'.repeat(300));
const dec3 = NET.createMqttDecoder();
const out3 = dec3.push(bigPub);
assert.equal(out3.length, 1, 'multi-byte remaining-length decoded');
assert.equal(out3[0].payload.length, 300, 'large payload intact');
// two packets in one frame
const dec4 = NET.createMqttDecoder();
const two = new Uint8Array([...NET.mqttEncodePublish('a', '1'), ...NET.mqttEncodePublish('b', '2')]);
const out4 = dec4.push(two);
assert.deepEqual(out4.map(p => p.topic), ['a', 'b'], 'coalesced frames split into packets');

// --- social facilitation rules ------------------------------------------------------
assert.equal(NET.SOCIAL_RULES.IDLE_MS, 30000, 'watcher counts as active for 30 s after real input');
let b = NET.socialBoosts(0);
assert.deepEqual([b.xp, b.move, b.jump, b.dmg], [1, 1, 1, 1], 'no active audience = fully neutral');
b = NET.socialBoosts(3);
assert.equal(b.xp, 1.10, 'any active audience grants the flat +10% XP');
assert.ok(Math.abs(b.move - 1.03) < 1e-9 && Math.abs(b.jump - 1.03) < 1e-9 && Math.abs(b.dmg - 1.03) < 1e-9, '+1% per active viewer on move/jump/dmg');
assert.equal(NET.socialBoosts(-5).move, 1, 'negative counts clamp to neutral');

// --- ghost dread: creatures flee an ACTIVE spirit ---------------------------------------
assert.equal(NET.dreadAt([], 0, 0), null, 'no spirits = no dread (solo play is untouched)');
assert.equal(NET.dreadAt([{ x: 100, y: 0 }], 0, 0), null, 'a distant spirit does not haunt');
let d = NET.dreadAt([{ x: 5, y: 0 }], 8, 0);
assert.ok(d && d.awayX === 1, 'a creature right of the spirit flees right');
assert.ok(Math.abs(d.dist - 3) < 1e-9, 'distance measured');
assert.ok(d.power > 0 && d.power < 1, 'dread power falls off with distance');
d = NET.dreadAt([{ x: 5, y: 0 }], 2, 0);
assert.equal(d.awayX, -1, 'a creature left of the spirit flees left');
d = NET.dreadAt([{ x: 0, y: 0 }, { x: 7, y: 0 }], 6, 0);
assert.ok(Math.abs(d.x - 7) < 1e-9, 'the NEAREST spirit wins');
assert.ok(NET.dreadAt([{ x: 0, y: 0 }], 0.2, 0).power > 0.9, 'a spirit on top of a creature is maximally terrifying');
assert.equal(NET.dreadAt([{ x: NaN, y: 0 }], 0, 0), null, 'garbage spirit coords are ignored');

// --- watcher powers: charge is EARNED by activity ------------------------------------------
assert.equal(NET.chargeAfter(0, 10, false), 0, 'an idle watcher earns nothing');
assert.equal(NET.chargeAfter(0, 10, true), 10, 'an active watcher earns 1/s');
assert.equal(NET.chargeAfter(NET.POWER_CHARGE.MAX, 100, true), NET.POWER_CHARGE.MAX, 'charge is capped');
assert.equal(NET.chargeAfter(50, 5, false), 50, 'idling keeps (but does not grow) charge');
assert.ok(NET.validPowerKind('frost') && NET.validPowerKind('smite') && NET.validPowerKind('banish'), 'the three powers exist');
assert.ok(!NET.validPowerKind('nuke') && !NET.validPowerKind('__proto__'), 'unknown/prototype powers rejected');
for(const k of Object.keys(NET.POWER_RULES)){
	const r = NET.POWER_RULES[k];
	assert.ok(r.cost > 0 && r.cd > 0 && r.r > 0, k + ' has a cost, a cooldown and a radius');
	assert.ok(r.cost <= NET.POWER_CHARGE.MAX, k + ' is affordable within a full charge bar');
}
assert.ok(NET.POWER_RULES.smite.cost > NET.POWER_RULES.banish.cost, 'damage costs more than a scare');

// --- assistant actions -----------------------------------------------------------------------
assert.deepEqual(NET.ASSIST_ACTIONS, ['craft', 'equip', 'unequip'], 'the assistant may craft and manage gear — nothing else');
assert.ok(!NET.validAssistAction('setTile') && !NET.validAssistAction('teleport'), 'world-editing actions are not assistant actions');

// --- permission ladder & avatars ------------------------------------------------------
assert.deepEqual(NET.PERMISSION_MODES, ['watch', 'chat', 'full', 'play'], 'the four-mode ladder (play = embodied)');
assert.ok(NET.validPermissionMode('watch') && NET.validPermissionMode('play') && !NET.validPermissionMode('admin'), 'mode validation');
assert.ok(NET.AVATARS.length >= 6 && NET.validAvatar('duszek') && !NET.validAvatar('<img>'), 'avatar registry validates');
// the ladder is strictly inclusive: a higher rung keeps every lower ability
assert.ok(NET.modeAllows('play', 'watch') && NET.modeAllows('play', 'chat') && NET.modeAllows('play', 'full') && NET.modeAllows('play', 'play'), 'play ⊇ every lower rung');
assert.ok(NET.modeAllows('full', 'chat') && !NET.modeAllows('full', 'play'), 'full is below play');
assert.ok(NET.modeAllows('chat', 'chat') && !NET.modeAllows('chat', 'full'), 'chat cannot influence');
assert.ok(!NET.modeAllows('watch', 'chat') && !NET.modeAllows('bogus', 'watch'), 'watch is the floor, garbage denies');

// --- play mode: the embodied guest (full multiplayer) ---------------------------------
assert.deepEqual(NET.PLAY_ACTIONS, ['mine', 'place', 'strike', 'attack', 'craft', 'duel', 'pickup', 'eat'],
	'a player mines, builds, fights, crafts, duels, scavenges and eats — nothing that bypasses the host');
assert.ok(NET.validPlayAction('mine') && !NET.validPlayAction('setTile') && !NET.validPlayAction('teleport'), 'play actions validate');
assert.ok(NET.PLAY_RULES.REACH > 0 && NET.PLAY_RULES.MAX_HP > 0 && NET.PLAY_RULES.MINE_TICKS >= 1, 'play rules are sane');
// --- the guest arsenal: host-owned whitelist, host-side resolution --------------------
assert.deepEqual(NET.PLAY_STARTER_WEAPONS, ['fists', 'sword', 'bow'], 'the starter kit: fists, a sword, a bow');
for(const k of NET.PLAY_STARTER_WEAPONS){
	const w = NET.PLAY_WEAPONS[k];
	assert.ok(w && w.cdMs >= NET.PLAY_RULES.ATTACK_MS, k + ' exists and cools down no faster than the global floor');
	if(w.melee) assert.ok(w.reach >= 1 && w.reach <= 4 && w.dmg >= 0 && w.dmg <= 40, k + ' melee stats are bounded');
	else assert.ok(w.ammo && typeof w.ammo === 'string' && w.dmg >= 1 && w.dmg <= 30, k + ' ranged needs ammo and bounded damage');
}
assert.ok(NET.validPlayWeapon('sword') && NET.validPlayWeapon('bow'), 'owned kinds validate');
assert.ok(!NET.validPlayWeapon('nuke') && !NET.validPlayWeapon('__proto__') && !NET.validPlayWeapon(7), 'unknown/prototype/garbage weapons rejected');
assert.ok(NET.PLAY_STARTER_AMMO.arrowWood > 0 && NET.PLAY_WEAPONS.bow.ammo === 'arrowWood', 'the bow shoots the starter wood arrows from the pouch');
// the host derives every projectile from a normalized direction — never client velocity
{
	const v = NET.playAimDir(10, 10, 14, 7);
	assert.ok(v && Math.abs(Math.hypot(v.dx, v.dy) - 1) < 1e-9, 'aim normalizes to a unit vector');
	assert.equal(NET.playAimDir(10, 10, 10, 10), null, 'aiming at your own feet is degenerate');
	assert.equal(NET.playAimDir(10, 10, NaN, 5), null, 'garbage aim is rejected');
	assert.equal(NET.playAimDir(NaN, 10, 14, 7), null, 'garbage body coords are rejected');
}
// --- guest crafting: pouch → pouch/arsenal, checked and spent host-side ----------------
assert.ok(NET.validPlayRecipe('arrows') && NET.validPlayRecipe('spear'), 'the two starter recipes exist');
assert.ok(!NET.validPlayRecipe('nuke') && !NET.validPlayRecipe('__proto__') && !NET.validPlayRecipe(7), 'unknown/prototype/garbage recipes rejected');
assert.ok(NET.PLAY_WEAPONS.spear && !NET.PLAY_STARTER_WEAPONS.includes('spear') && NET.PLAY_RECIPES.spear.weapon === 'spear',
	'the spear exists in the arsenal but is EARNED by crafting, never granted');
assert.ok(NET.PLAY_RECIPES.arrows.gives.arrowWood > 0, 'the arrow recipe refills the bow ammo');
{
	const pouch = { wood: 8, stone: 5 };
	assert.ok(NET.pouchAfford(pouch, NET.PLAY_RECIPES.arrows.cost), 'costs are affordable when the pouch holds them');
	assert.ok(!NET.pouchAfford({ wood: 99 }, NET.PLAY_RECIPES.arrows.cost), 'a missing ingredient denies');
	assert.ok(NET.pouchSpend(pouch, NET.PLAY_RECIPES.spear.cost), 'an affordable spend succeeds');
	assert.deepEqual(pouch, { wood: 2, stone: 1 }, 'exactly the cost left the pouch');
	assert.ok(!NET.pouchSpend(pouch, NET.PLAY_RECIPES.spear.cost), 'a second spear is not affordable');
	assert.deepEqual(pouch, { wood: 2, stone: 1 }, 'a refused spend takes NOTHING (all-or-nothing)');
	const zc = { wood: 3 };
	assert.ok(NET.pouchSpend(zc, { wood: 2, stone: 0 }), 'a zero-cost ingredient is legal');
	assert.deepEqual(zc, { wood: 1 }, 'and charges nothing (pouchTake floors to 1 — the guard matters)');
}
assert.equal(NET.GID_KEY, 'mm_ghost_gid_v1', 'the stable-gid storage key is pinned');
// --- the guest larder --------------------------------------------------------------------
assert.ok(NET.validPlayFood('meatScrap') && NET.validPlayFood('bakedMeat'), 'the larder holds real food keys');
assert.ok(!NET.validPlayFood('rottenMeat') && !NET.validPlayFood('__proto__') && !NET.validPlayFood(7),
	'the pouch never poisons its owner (rotten meat and garbage rejected)');
assert.ok(NET.PLAY_FOODS.meat.hp === 12 && NET.PLAY_FOODS.bakedMeat.hp === 35,
	'shared food values mirror the host food.js exactly');
for(const k of Object.keys(NET.PLAY_FOODS)) assert.ok(NET.PLAY_FOODS[k].hp > 0, k + ' heals (never harms)');
// reach is Chebyshev around the BODY, and it is the host that measures it
assert.ok(NET.playReachOk(10, 10, 12, 8, 5) && !NET.playReachOk(10, 10, 17, 10, 5), 'reach gate: inside vs beyond');
assert.ok(!NET.playReachOk(NaN, 10, 12, 8, 5), 'garbage body coords deny the reach');
// the movement envelope clamps a claimed pose to at most maxStep of travel
assert.equal(NET.clampBodyStep(10, 10.3, 0.5), 10.3, 'a small honest step is accepted verbatim');
assert.equal(NET.clampBodyStep(10, 40, 0.5), 10.5, 'a teleport claim is clamped to the envelope (rubber-band)');
assert.equal(NET.clampBodyStep(10, -40, 0.5), 9.5, 'the clamp is symmetric');
assert.equal(NET.clampBodyStep(10, NaN, 0.5), 10, 'a NaN claim holds position');
// the host-owned pouch clamps both ways and refuses prototype smuggling
{
	const pouch = {};
	assert.equal(NET.pouchAdd(pouch, 'stone', 3), 3, 'mining credits the pouch');
	assert.equal(NET.pouchAdd(pouch, 'stone', NET.PLAY_RULES.POUCH_CAP + 999), NET.PLAY_RULES.POUCH_CAP, 'the pouch has a ceiling');
	assert.equal(NET.pouchAdd(pouch, '__proto__', 5), 0, 'no prototype key in the pouch');
	assert.ok(NET.pouchTake(pouch, 'stone', 1), 'placing spends from the pouch');
	assert.ok(!NET.pouchTake(pouch, 'stone', NET.PLAY_RULES.POUCH_CAP + 1), 'cannot spend what is not there (no negative pouch)');
	assert.ok(!NET.pouchTake(pouch, 'gold', 1), 'cannot spend a resource never mined');
}

// --- chat profanity filter ----------------------------------------------------------------
assert.deepEqual(NET.filterChat('   '), { text: '', filtered: false, empty: true }, 'blank chat is empty');
assert.equal(NET.filterChat('dobra robota!').text, 'dobra robota!', 'clean text passes untouched');
assert.equal(NET.filterChat('dobra robota!').filtered, false, 'clean text is not flagged');
let f = NET.filterChat('ale kurwa mać');
assert.ok(f.filtered && !/kurwa/i.test(f.text) && /\*/.test(f.text), 'PL vulgarity masked');
f = NET.filterChat('what the FUCK');
assert.ok(f.filtered && !/fuck/i.test(f.text), 'EN vulgarity masked case-insensitively');
assert.ok(NET.filterChat('kurwiszcze').filtered, 'stem inside a longer token caught');
assert.ok(NET.filterChat('sh1t happens').filtered, 'leetspeak folded before matching');
assert.ok(NET.filterChat('skurwysyństwo').filtered, 'diacritic-folded compound caught');
assert.ok(NET.filterChat('bez kurew!').filtered, 'inflected PL form caught');
assert.equal(NET.filterChat('x'.repeat(500)).text.length <= 90, true, 'chat length is capped');

// --- the aggregate must carry EVERY named export -----------------------------------------
// The engine imports `{ ghostNet as NET }`, not the module namespace: a function that is
// exported but missing from that object is silently `undefined` in the browser while every
// Node test (which imports the namespace) still passes. That trap cost a wedged page once.
{
	const agg = NET.ghostNet;
	// module-internal plumbing the engine only reaches through hostListen/joinRoom
	const internal = new Set(['ASSEMBLER_MAX_CHUNKS', 'ASSEMBLER_MAX_CHUNK_LEN', 'createMqttDecoder',
		'mqttEncodeConnect', 'mqttEncodePing', 'mqttEncodePublish', 'mqttEncodeSubscribe']);
	for(const name of Object.keys(NET)){
		if(name === 'default' || name === 'ghostNet' || internal.has(name)) continue;
		assert.ok(Object.prototype.hasOwnProperty.call(agg, name),
			'ghostNet aggregate is missing the named export "' + name + '" — the engine would see undefined');
	}
	// and everything the two engine modules actually dereference off NET must be there
	const usedByEngine = new Set();
	for(const file of ['../src/engine/ghost_host.js', '../src/engine/ghost_client.js']){
		const src = readFileSync(new URL(file, import.meta.url), 'utf8');
		for(const m of src.matchAll(/\bNET\.([A-Za-z_$][\w$]*)/g)) usedByEngine.add(m[1]);
	}
	for(const name of usedByEngine){
		assert.ok(Object.prototype.hasOwnProperty.call(agg, name),
			'the engine dereferences NET.' + name + ' but the ghostNet aggregate does not export it');
	}
	assert.ok(usedByEngine.has('levelFor') && usedByEngine.has('PROG'), 'sanity: the scan actually found the progression calls');
}

// --- watcher progression: pure core ------------------------------------------------------
// XP curve: strictly increasing cost, and levelFor is the exact inverse of the ladder
{
	assert.equal(NET.levelFor(0).level, 1, 'a fresh ghost starts at level 1');
	let acc = 0;
	for(let l = 1; l < 12; l++){
		const need = NET.xpForLevel(l);
		assert.ok(need > 0 && need >= NET.xpForLevel(l - 1 || 1), 'level cost never shrinks (level ' + l + ')');
		assert.equal(NET.levelFor(acc + need - 1).level, l, 'one XP short of the threshold stays at level ' + l);
		acc += need;
		assert.equal(NET.levelFor(acc).level, l + 1, 'hitting the threshold exactly promotes to ' + (l + 1));
	}
	assert.equal(NET.levelFor(1e9).level, NET.PROG.MAX_LEVEL, 'the ladder is capped');
	assert.equal(NET.xpForLevel(NET.PROG.MAX_LEVEL), 0, 'no cost past the cap (no infinite bar)');
	assert.equal(NET.rankFor(1).name, 'Gapiowicz', 'the first rank is the newcomer');
	assert.ok(NET.rankFor(NET.PROG.MAX_LEVEL).at >= 30, 'the top rank needs a real career');
	// deed scoring is table-driven and clamps hostile counts
	assert.equal(NET.deedXp('bless', 1), NET.DEED_XP.bless, 'a blessing scores its table value');
	assert.equal(NET.deedXp('hit', 999), NET.DEED_XP.hit * NET.PROG.HIT_CAP, 'a single blast credits at most HIT_CAP creatures');
	assert.equal(NET.deedXp('nonsense', 5), 0, 'unknown deeds are worth nothing');
	assert.equal(NET.deedXp('__proto__', 5), 0, 'prototype keys are not deeds');
}
// deeds accumulate, achievements settle, and achievement XP can itself promote
{
	let p = NET.createProgress();
	const cheers = Array.from({ length: 10 }, () => ({ k: 'cheer', n: 1 }));
	const r = NET.progressAfter(p, cheers, { day: '2026-07-12' });
	p = r.state;
	assert.equal(p.counts.cheer, 10, 'ten cheers counted');
	assert.ok(r.unlocked.some(a => a.id === 'cheerleader'), 'the cheerleader achievement fired at its threshold');
	assert.equal(p.xp, 10 * NET.DEED_XP.cheer + NET.achievementById('cheerleader').xp, 'XP = deeds + achievement bonus');
	assert.deepEqual(p.days, ['2026-07-12'], 'the day was stamped');
	// a big haul promotes AND settles the level-gated achievement in the same pass
	const big = NET.progressAfter(p, Array.from({ length: 1200 }, () => ({ k: 'watch', n: 1 })), { day: '2026-07-12' });
	assert.ok(big.leveled && big.level >= 10, 'a long attentive session levels the watcher up');
	assert.ok(big.unlocked.some(a => a.id === 'veteran'), 'the level-10 achievement settles from the same fold');
	assert.deepEqual(big.state.days, ['2026-07-12'], 'the same day is not counted twice');
}
// the profile comes off disk: treat it as hostile input
{
	const dirty = JSON.parse('{"xp":"1e999","counts":{"bless":-5,"evil":99,"hit":"NaN"},"done":["cheerleader","made_up"],"days":["2026-07-12","junk","2026-07-12"]}');
	dirty.counts.__proto__ = 7; // eslint-disable-line no-proto
	const clean = NET.normalizeProgress(dirty);
	assert.equal(clean.xp, 0, 'a non-finite XP claim is discarded');
	assert.ok(!('evil' in clean.counts) && !('bless' in clean.counts), 'unknown and negative counters are dropped');
	assert.ok(!Object.prototype.hasOwnProperty.call(clean.counts, '__proto__'), 'no prototype smuggling through counts');
	assert.deepEqual(clean.done, ['cheerleader'], 'only real achievement ids survive');
	assert.deepEqual(clean.days, ['2026-07-12'], 'day stamps are validated and de-duped');
	assert.equal(NET.normalizeProgress(null).xp, 0, 'a missing profile is a fresh one');
	assert.equal(NET.normalizeProgress('nope').xp, 0, 'a garbage profile is a fresh one');
}
// every achievement watches a stat the system can actually produce
{
	const derived = new Set(['level', 'days', 'wardrobe']);
	for(const a of NET.ACHIEVEMENTS){
		assert.ok(NET.validDeed(a.stat) || derived.has(a.stat), 'achievement ' + a.id + ' watches a real stat (' + a.stat + ')');
		assert.ok(a.need > 0 && a.xp > 0 && a.icon && a.name && a.desc, 'achievement ' + a.id + ' is fully described');
	}
	const view = NET.statView({ xp: 0, counts: { equip: 4, unequip: 3 } });
	assert.equal(view.wardrobe, 7, 'wardrobe work sums equips and unequips');
	const prog = NET.achievementProgress(NET.createProgress());
	assert.equal(prog.length, NET.ACHIEVEMENTS.length, 'the trophy case lists every achievement');
	assert.ok(prog.every(a => !a.done), 'a fresh ghost has an empty trophy case');
	assert.equal(prog.find(a => a.def.id === 'cheerleader').have, 0, 'and no progress on the deed-driven ones');
}
// dread names the spirit that caused the fright (so the right watcher gets credit)
{
	const d = NET.dreadAt([{ x: 100, y: 0 }, { x: 1.5, y: 0 }], 2, 0, 6);
	assert.equal(d.i, 1, 'the NEAREST spirit is the one credited');
}

// --- broker allowlist stays in lockstep with the CSP ------------------------------------
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
assert.ok(csp, 'CSP meta present');
assert.ok(/connect-src [^;]*'self'/.test(csp[1]), 'connect-src keeps self');
for(const broker of NET.MQTT_BROKERS){
	const origin = broker.replace(/^wss:\/\//, '').split('/')[0];
	assert.ok(csp[1].includes('wss://' + origin), 'CSP allowlists signaling broker ' + origin);
}
assert.ok(!/connect-src[^;]*\*/.test(csp[1]), 'connect-src has no wildcard');

// --- source pins: mobs.js ghost sync API --------------------------------------------------
const mobsSrc = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
assert.ok(/function ghostRoster\(\)/.test(mobsSrc), 'mobs.ghostRoster exists');
assert.ok(/function ghostApplyRoster\(roster\)/.test(mobsSrc), 'mobs.ghostApplyRoster exists');
assert.ok(/function ghostLerp\(dt\)/.test(mobsSrc), 'mobs.ghostLerp exists');
assert.ok(/ghostRoster, ghostApplyRoster, ghostLerp,/.test(mobsSrc), 'ghost sync is exposed on the mobs api');
assert.ok(/live\.map\(m=>m\.id\)\.join\('\|'\)!==roster\.sig\) return false;/.test(mobsSrc),
	'roster signature mismatch refuses the pose apply (client must ask for a full list)');
assert.ok(/m\.id==='ZLOTY'/.test(mobsSrc.slice(mobsSrc.indexOf('function ghostLiveMobs'))),
	'ghost roster filter mirrors the serialize filter (golden sprinter excluded)');


// --- source pins: main.js wiring ------------------------------------------------------------
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(/function applyGameData\(data,opts\)/.test(mainSrc), 'applyGameData extracted from loadGame');
assert.ok(/return applyGameData\(data,opts\);/.test(mainSrc), 'loadGame routes through applyGameData');
assert.ok(/function saveGameCore\(manual\)\{\s*if\(MM\.ghostMode\) return false;/.test(mainSrc), 'ghost guard on saveGameCore');
assert.ok(/function saveState\(\)\{\s*if\(_startingNewGame\) return;\s*if\(MM\.ghostMode\) return;/.test(mainSrc), 'ghost guard on saveState');
assert.ok(/function saveCriticalState\(reason,force\)\{\s*if\(_startingNewGame\) return false;\s*if\(MM\.ghostMode\) return false;/.test(mainSrc), 'ghost guard on saveCriticalState');
assert.ok(/const ghostHold=!!MM\.ghostMode;/.test(mainSrc), 'loop derives the ghost hold');
assert.ok(/if\(!paused && !overlayHold && !ghostHold\)\{/.test(mainSrc), 'sim branch respects the ghost hold');
assert.ok(/else if\(ghostHold && GHOST_CLIENT && GHOST_CLIENT\.frame\)\{/.test(mainSrc), 'watcher frame replaces the sim');
assert.ok(/if\(GHOST_HOST && GHOST_HOST\.active\(\)\) GHOST_HOST\.frame\(frameDt,ts\);/.test(mainSrc), 'host streams from inside the sim branch');
assert.ok(/const loaded=MM\.ghostMode \? false : loadGame\(\);/.test(mainSrc), 'watchers skip the local save at boot');
assert.ok(/if\(!MM\.ghostMode\) TITLE_SCREEN\.boot\(/.test(mainSrc), 'watchers skip the title screen');
assert.ok(/MM\.ghostBridge=\{/.test(mainSrc), 'ghost bridge published');
for(const key of ['applyGameData:', 'buildSave:', 'snapshotDrops:', 'restoreDrops:', 'snapshotSeasons:', 'restoreSeasons:', 'snapshotInfra:', 'restoreInfra:', 'snapshotConstructionBackground:', 'restoreConstructionBackground:', 'healHero:', 'addHeroEnergy:', 'nudgeZoom:', 'setCamCenter:', 'snapCameraToPlayer:', 'revealAround:', 'stepCosmetics:']){
	assert.ok(mainSrc.includes(key), 'bridge carries ' + key.slice(0, -1));
}
assert.ok(/GHOST_CLIENT\.boot\(MM\.ghostBridge\)/.test(mainSrc), 'ghost client boots with the bridge');
assert.ok(/GHOST_HOST\.wire\(MM\.ghostBridge\)/.test(mainSrc), 'ghost host wires the bridge');
// two-pass spirit painting: bodies BEHIND the player, text over the creature layer
for(const who of ['GHOST_CLIENT', 'GHOST_HOST']){
	for(const pass of ['body', 'text']){
		assert.ok(mainSrc.includes(who + `.drawSpirits(ctx,TILE,'${pass}')`), who + ' runs the ' + pass + ' pass');
	}
}
{
	const bodyAt = mainSrc.indexOf(".drawSpirits(ctx,TILE,'body')");
	const playerAt = mainSrc.indexOf('drawPlayer({rearView:mirrorFacing});', bodyAt);
	const textAt = mainSrc.indexOf(".drawSpirits(ctx,TILE,'text')");
	const mobsAt = mainSrc.indexOf('MOBS.draw(ctx,TILE');
	assert.ok(bodyAt > 0 && playerAt > 0 && bodyAt < playerAt, 'spirit BODIES are painted before the player (behind, never obscuring)');
	assert.ok(mobsAt > 0 && textAt > mobsAt, 'spirit TEXT (names, bubbles, action fx) is painted over the creature layer');
}
assert.ok(/buildSaveObject\(\{perf:\{parts:\[\]\}\}\)/.test(mainSrc), 'bridge snapshot inlines chunks (no external autosave refs on the wire)');

// --- source pins: world.js diff capture --------------------------------------------------------
const worldSrc = readFileSync(new URL('../src/engine/world.js', import.meta.url), 'utf8');
assert.ok(/function notifyTileChanged\(x,y,old,v\)\{\s*try\{ if\(MM\.ghostHostTile\) MM\.ghostHostTile\(x,y,old,v\); \}catch\(e\)\{\}/.test(worldSrc),
	'ghost diff capture is the FIRST notifyTileChanged fan-out (sees every real tile change)');

// --- source pins: ghost_client boot contract ------------------------------------------------------
const clientSrc = readFileSync(new URL('../src/engine/ghost_client.js', import.meta.url), 'utf8');
assert.ok(/MMR\.ghostMode = true;/.test(clientSrc), 'client stamps MM.ghostMode at import time');
assert.ok(/NET\.parseWatch\(location\.search\)/.test(clientSrc), 'watch param comes from the URL');
assert.ok(!/localStorage\.setItem\((?!'mm_ghost_(name|avatar)_v1'|NET\.PROG_KEY|NET\.GID_KEY|NET\.GID_LEASE_KEY|NET\.LOOK_KEY)/.test(clientSrc),
	'client persists nothing but its display name, avatar, own career, stable gid (+lease) and chosen look');
assert.ok(/Storage\.prototype\.setItem = function/.test(clientSrc) && /allow = new Set\(\['mm_ghost_name_v1', 'mm_ghost_avatar_v1', NET\.PROG_KEY, NET\.GID_KEY, NET\.GID_LEASE_KEY, NET\.LOOK_KEY\]\)/.test(clientSrc),
	'ghost mode locks down ALL localStorage writes (side stores like dynamic loot must not leak into the watcher’s own world)');
// hardening pins (post-review): hostile hosts, transport races, throttling floods
assert.ok(/function esc\(s\)/.test(clientSrc) && /esc\(hostName\)/.test(clientSrc),
	'remote host name is HTML-escaped before touching the veil innerHTML (XSS)');
assert.ok(/if\(lockedConn && c !== lockedConn\) return;/.test(clientSrc),
	'after transport lock, straggler frames from the losing transport are dropped (assembler wedge race)');
assert.ok(/queue\.length > 1200/.test(clientSrc) && /queue\.length = 0;/.test(clientSrc) && /t: 'needSnap'/.test(clientSrc),
	'queue overflow dumps the backlog and requests a resync — cumulative tile diffs are never silently dropped');
assert.ok(/const rafAlive = fromPump && \(t - lastRafAt\) < 1500;/.test(clientSrc),
	'the background pump skips interpolation/cosmetics while rAF is alive (no double integration)');
assert.ok(/pl\.t === 'full'/.test(clientSrc), 'client understands the room-full rejection');
// both-sides validity pins: everything a hostile host controls is checked or clamped
assert.ok(/pl\.d\.length > 12000/.test(clientSrc), 'oversized tile batches trigger resync instead of freezing the tab');
assert.ok(/if\(!Number\.isFinite\(pl\.x\) \|\| !Number\.isFinite\(pl\.y\)\) continue;/.test(clientSrc), 'NaN hero poses are dropped before poisoning the replica');
assert.ok(/pl\.data\.list\.length > 600\) pl\.data\.list\.length = 600;/.test(clientSrc), 'mob list length is capped client-side');
assert.ok(/pl\.list\.slice\(0, 16\)/.test(clientSrc) && /String\(g\.name \|\| 'Duch'\)\.slice\(0, 24\)/.test(clientSrc), 'presence entries are bounded and name-clamped');
assert.ok(/pl\.t === 'fx' && NET\.validBuffKind\(pl\.kind\)/.test(clientSrc), 'fx kind is validated (guards the BUFF_RULES prototype lookup)');
assert.ok(/Math\.min\(120000, Math\.max\(0, Number\(pl\.waitMs\)/.test(clientSrc), 'buffAck waitMs is clamped — no eternal button lockout');
// reliability pins: transport loss reconnects, final goodbyes stay final
assert.ok(/pl\.t === 'connLost'/.test(clientSrc) && /function scheduleReconnect\(\)/.test(clientSrc), 'client auto-reconnects on transport loss');
assert.ok(/reconnects > 8/.test(clientSrc), 'reconnect attempts are budgeted');
assert.ok(/reconnects = 0; \/\/ a completed join/.test(clientSrc), 'a successful re-join refreshes the budget');
assert.ok(/applyGameData\(data, \{ ignoreCritical: true \}\)/.test(clientSrc), 'snapshot apply ignores local critical-state remnants');

// --- source pins: ghost_host stream planes ------------------------------------------------------------
const hostSrc = readFileSync(new URL('../src/engine/ghost_host.js', import.meta.url), 'utf8');
assert.ok(/MMR\.ghostHostTile = \(x, y, old, v\) =>/.test(hostSrc), 'host claims the tile capture hook');
assert.ok(/TILE_RESYNC_LIMIT = 3000/.test(hostSrc), 'mass edits collapse into a fresh snapshot');
assert.ok(/s\.ledger\.tryUse\(entry\.gid, pl\.kind, Date\.now\(\)\)/.test(hostSrc), 'buffs pass the host-owned ledger');
assert.ok(/window\.__mmGhostHostStart/.test(hostSrc), 'QA start hook exposed');
assert.ok(/MAX_GHOSTS = 12/.test(hostSrc) && /entries\(\)\.length >= MAX_GHOSTS/.test(hostSrc),
	'join flood is capped — every hello costs a full snapshot serialization');
assert.ok(/pl\.t === 'needSnap'/.test(hostSrc) && /SNAP_REQ_MIN_MS/.test(hostSrc),
	'snapshot re-requests are honored but rate-limited per peer');
assert.ok(/x \* 1000 \+ \(y \+ 512\)/.test(hostSrc) && /!s\.watchers\) return;/.test(hostSrc),
	'tile capture uses numeric keys and short-circuits with zero watchers (allocation-tax guard)');
assert.ok(/PEER_MSG_MAX/.test(hostSrc) && /entry\.rateN > PEER_MSG_MAX\)\{ dropPeer/.test(hostSrc),
	'abusive per-peer message rates get the peer dropped');
assert.ok(/MOBS_REQ_MIN_MS/.test(hostSrc) && /entry\.lastMobsReq > MOBS_REQ_MIN_MS/.test(hostSrc),
	'needMobs is rate-limited host-side (each one is a full mob serialize)');
assert.ok(/SNAP_CACHE_MS/.test(hostSrc) && /s\.sinceCache/.test(hostSrc) && /peer\.send\(\{ t: 'tiles', d: s\.sinceCache\.slice\(\) \}\)/.test(hostSrc),
	'snapshot cache exists AND replays post-cache tile diffs to late joiners (coherence)');
assert.ok(/s\.sinceCache\.length \+ d\.length > 9000\)\{ s\.snapCache = null;/.test(hostSrc),
	'replay-buffer overflow invalidates the cache instead of dropping diffs');
// signaling failover must wrap around with a delay instead of dying silently
const netSrc = readFileSync(new URL('../src/engine/ghost_net.js', import.meta.url), 'utf8');
assert.ok(/MQTT_BROKERS\.length \* 3/.test(netSrc) && /setTimeout\(connect, 1500\)/.test(netSrc),
	'broker failover wraps with a retry budget and backoff');
assert.ok(/pong-timeout/.test(netSrc) && /Date\.now\(\) - lastPong > 80000/.test(netSrc),
	'a silently dead MQTT socket is detected by the pong watchdog');
assert.ok(/conn\.onMessage\(\{ t: 'connLost' \}\)/.test(netSrc),
	'a dropped DataChannel surfaces as connLost (reconnectable), not hostGone (final)');

// --- social facilitation integration pins ---------------------------------------------------
assert.ok(/const socialMult=\(MM\.socialBoost && Number\.isFinite\(MM\.socialBoost\.xp\)\) \? MM\.socialBoost\.xp : 1;/.test(mobsSrc)
	&& /combatXp\*fatigue\.mult\*specialMult\*socialMult/.test(mobsSrc),
	'mob XP multiplies the social boost (neutral 1 in solo/Node)');
assert.ok(/function socialBoostMult\(part\)/.test(mainSrc), 'main.js social boost reader exists');
assert.ok(/heroSandMoveMult\(\) \* socialBoostMult\('move'\)/.test(mainSrc), 'movement speed multiplies the social boost');
assert.ok(/turboJumpMult \* Math\.sqrt\(socialBoostMult\('jump'\)\)/.test(mainSrc), 'jump velocity takes the square root of the HEIGHT boost');
const weaponsSrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
// --- source pins: the invasion plane -------------------------------------------------------
// A watcher never runs invasions.update() (no spawning, digging or stealing from
// the cheap seats), so without a live pose plane the landing party stood frozen
// between full snapshots — the bug this plane exists to kill.
const invasionsSrc = readFileSync(new URL('../src/engine/invasions.js', import.meta.url), 'utf8');
assert.ok(/function ghostRoster\(\)/.test(invasionsSrc) && /function ghostApplyRoster\(roster\)/.test(invasionsSrc)
	&& /function ghostLerp\(dt\)/.test(invasionsSrc), 'invasions ships the same ghost sync trio as the mobs');
assert.ok(/ghostRoster,\s*\n?\s*ghostApplyRoster,\s*\n?\s*ghostLerp,/.test(invasionsSrc),
	'the ghost sync trio is exposed on the invasions api');
assert.ok(/if\(live\.map\(a=>a\.id\)\.join\('\|'\) !== roster\.sig\) return false;/.test(invasionsSrc),
	'a roster signature mismatch refuses the pose apply (wait for the full sync)');
assert.ok(/props:/.test(invasionsSrc),
	'slow props (a saucer settling, a burrow grinding open) ride the roster so they animate too');
assert.ok(/function invTick\(s, t\)/.test(hostSrc) && /function sendInvFull\(s, peer\)/.test(hostSrc),
	'the host drives an invasion tick and a full invasion sync');
assert.ok(/if\(t - s\.last\.inv >= CAD\.inv\) invTick\(s, t\);/.test(hostSrc),
	'the invasion tick is wired into the host frame');
assert.ok(/sendInvFull\(s, entry\.peer\);/.test(hostSrc),
	'a joining watcher gets the current squads immediately, not on the next sig change');
assert.ok(/pl\.t === 'inv'/.test(clientSrc) && /pl\.t === 'invFull'/.test(clientSrc),
	'the watcher handles both invasion planes');
assert.ok(/MMR\.invasions\.ghostLerp\(dt\)/.test(clientSrc),
	'invaders glide between streamed poses instead of stepping once per packet');

// --- source pins: the hero's weapons, mirrored to the watcher --------------------------------
// The watcher runs the renderer but no simulation, so its weapons module was empty
// and the hero appeared to fight thin air.
assert.ok(/function ghostFxState\(\)/.test(weaponsSrc) && /function ghostApplyFx\(st\)/.test(weaponsSrc)
	&& /function ghostStepFx\(dt\)/.test(weaponsSrc), 'weapons ships a cosmetic FX mirror');
assert.ok(/ghostFxState,ghostApplyFx,ghostStepFx,/.test(weaponsSrc), 'the FX mirror is exposed on the weapons api');
// THE contract: a watcher must never change the world it is watching. The mirror
// integrates positions and ages timers — it may not damage, ignite or write tiles.
const stepFx = weaponsSrc.slice(weaponsSrc.indexOf('function ghostStepFx'), weaponsSrc.indexOf('MM.weapons={'));
assert.ok(!/setTile|damageAt|explodeAt|addResource|ignite|applyStatus/.test(stepFx),
	'the watcher-side FX step is cosmetic only — no damage, no ignition, no tile writes');
assert.ok(/function weaponTick\(s, t\)/.test(hostSrc) && /if\(t - s\.last\.wfx >= CAD\.wfx\) weaponTick\(s, t\);/.test(hostSrc),
	'the host streams weapon FX at hero cadence');
assert.ok(/if\(!busy && !s\.wfxBusy\) return;/.test(hostSrc),
	'an idle hero streams no FX packets (but one trailing packet clears the watcher screen)');
assert.ok(/pl\.t === 'wfx'/.test(clientSrc) && /MMR\.weapons\.ghostStepFx\(dt\)/.test(clientSrc),
	'the watcher applies the FX snapshot and integrates it between packets');
assert.ok(/mult:\(lucky\?4:2\)\*social,lucky/.test(weaponsSrc), 'hero attack rolls multiply the social boost');
assert.ok(/if\(MMR && !MMR\.socialBoost\) MMR\.socialBoost = \{ viewers: 0, active: 0, xp: 1, move: 1, jump: 1, dmg: 1 \};/.test(hostSrc),
	'MM.socialBoost is neutral from the first frame');
assert.ok(/if\(pl\.act\) markActive\(entry\);/.test(hostSrc) && /ACT_POSE_TTL_MS/.test(hostSrc),
	'watcher activity is vouched by poses and times out fast (anti fake-watcher)');
assert.ok(/NET\.socialBoosts\(active\)/.test(hostSrc), 'the host derives boosts from ACTIVE watchers only');
assert.ok(/lastInputAt = nowMs\(\)/.test(clientSrc) && /nowMs\(\) - lastInputAt < NET\.SOCIAL_RULES\.IDLE_MS/.test(clientSrc),
	'the client derives its active flag from real input recency');
// A never-touched watcher must start INACTIVE. This only holds because nowMs() is the
// epoch clock: with a monotonic page clock, `nowMs() - 0 < 30000` would read TRUE for
// the first 30 s of the page's life and a freshly joined idle tab would silently pay
// boosts. Pin the clock choice, not just the comparison.
assert.ok(/function nowMs\(\)\{ return Date\.now\(\); \}/.test(clientSrc),
	'the activity clock is epoch-based, so lastInputAt=0 reads as ancient (a fresh watcher is idle, never active)');

// --- social-facilitation meter: the payout is VISIBLE, and idleness is visible too ------------
assert.ok(/function ensureMeter\(btn\)/.test(hostSrc) && /m\.id = 'ghostMeter'/.test(hostSrc)
	&& /btn\.parentNode\.insertBefore\(m, btn\)/.test(hostSrc),
	'the host builds a social-facilitation meter beside the 👁 button');
assert.ok(/function renderMeter\(boost, viewers, active\)/.test(hostSrc)
	&& /if\(!session \|\| viewers <= 0\)\{ ui\.meter\.hidden = true; return; \}/.test(hostSrc),
	'the meter hides itself with no session and no audience');
assert.ok(/const idle = active <= 0;/.test(hostSrc) && /ui\.meter\.classList\.toggle\('idle', idle\)/.test(hostSrc)
	&& /idle\s*\?\s*'brak premii'/.test(hostSrc),
	'an all-idle audience reads as "brak premii" (passive watchers pay nothing, and the meter says so)');
assert.ok(/renderMeter\(boost, list\.length, active\)/.test(hostSrc),
	'the meter refreshes on every updateUi pass, before the panel-only early returns');
assert.ok(/function pct\(mult\)\{ return Math\.round\(\(mult - 1\) \* 100\); \}/.test(hostSrc),
	'meter percentages come from one derivation helper');
// the numbers must be DERIVED from the live boost — a hardcoded "+10% XP" in the panel
// would quietly lie the moment SOCIAL_RULES changes
assert.ok(!/\+10% XP/.test(hostSrc), 'no hardcoded boost percentages survive in the host UI');
assert.ok(/'\+' \+ pct\(boost\.xp\) \+ '% XP/.test(hostSrc), 'the panel head derives its percentages from the live boost');
assert.ok(/#ghostMeter\{/.test(html) && /#ghostMeter\.idle\{/.test(html),
	'index.html styles the meter, including the dimmed idle state');

// --- moderation pins ---------------------------------------------------------------------------
assert.ok(/s\.banned\.has\(entry\.gid\)/.test(hostSrc) && /function banViewer\(gid\)/.test(hostSrc),
	'banned ghosts are rejected at hello and evictable live');
assert.ok(/!NET\.modeAllows\(entry\.mode, 'full'\)\)\{ entry\.peer\.send\(\{ t: 'buffAck', kind: pl\.kind, ok: false, waitMs: 0, reason: 'perm' \}\)/.test(hostSrc),
	'buffs require at least the full permission mode (inclusive: play qualifies too)');
assert.ok(/!NET\.modeAllows\(entry\.mode, 'chat'\)\) return;/.test(hostSrc), 'chat requires at least the chat mode');
assert.ok(/CHAT_MIN_MS/.test(hostSrc) && /NET\.filterChat\(pl\.text\)/.test(hostSrc), 'host chat is rate-limited and profanity-filtered');
assert.ok(/function setViewerMode\(gid, mode\)/.test(hostSrc), 'per-viewer permission modes are host-settable');
assert.ok(/pl\.t === 'banned'/.test(clientSrc) && /pl\.t === 'perm'/.test(clientSrc), 'client honors ban and permission downgrades');
assert.ok(/mode === 'watch'\) return false;/.test(clientSrc), 'watch-only clients refuse to send chat locally too');
assert.ok(/NET\.filterChat\(pl\.text\)\.text; \/\/ defense in depth/.test(clientSrc), 'incoming chat is re-filtered client-side');

// --- spirit look contract: small and translucent, never dominating the stage ---------------------
assert.ok(/SPIRIT_R = 0\.16/.test(hostSrc), 'spirit body radius stays ≤1/3 of the hero frame');
assert.ok(/SPIRIT_ALPHA = 0\.5/.test(hostSrc), 'spirits render at ~50% opacity');
assert.ok(/AVATAR_PAINTERS = \{/.test(hostSrc), 'procedural avatar painters exist');
for(const a of NET.AVATARS) assert.ok(new RegExp('\\b' + a + '\\(ctx, r\\)').test(hostSrc), 'painter covers avatar ' + a);
assert.ok(/entry\.camPos\.x \+= \(entry\.cam\.x - entry\.camPos\.x\) \* ease;/.test(hostSrc), 'host spirits glide (interpolated), not teleport');
assert.ok(/g\.x \+= \(g\.tx - g\.x\) \* ease;/.test(clientSrc), 'client spirits glide too');
assert.ok(/POSE_MS = 150/.test(clientSrc) && /presence: 200/.test(hostSrc), 'pose/presence cadences are tight enough for smooth spirits');
assert.ok(/painter\(ctx, TILE, c\.x, c\.y - selfLift, ghostName\(\), t, true, avatar, isActive\(\), selfChat, 'text'\);/.test(clientSrc),
	'the watcher sees their own flying avatar at the camera (lifted off the hero, text pass)');

// --- ghost dread integration: four creature systems flee the spirits -------------------------------
assert.ok(/if\(MMR && !MMR\.ghostAura\)/.test(hostSrc) && /MMR\.ghostDreadAt = function/.test(hostSrc),
	'the host publishes the aura + the single dread lookup every creature system calls');
assert.ok(/if\(!e\.hello \|\| e\.actUntil <= t\) continue;[\s\S]*if\(e\.cam && !e\.body\)\{ spirits\.push\(\{ x: e\.cam\.x, y: e\.cam\.y \}\); owners\.push\(e\); \}/.test(hostSrc),
	'ONLY active, DISEMBODIED watchers haunt the world (an idle tab is furniture, an embodied guest is a body — neither is a phantom), and each spirit remembers its owner');
assert.ok(/function applyGhostDread\(m,dt\)/.test(mobsSrc) && /applyGhostDread\(m,dt\);/.test(mobsSrc), 'mobs flee spirits');
assert.ok(/!hasStatus\(m,'blind'\) && !isGhostSpooked\(m\)/.test(mobsSrc), 'a spooked mob stops being aggressive');
const invSrc = readFileSync(new URL('../src/engine/invasions.js', import.meta.url), 'utf8');
assert.ok(/const dread = MM\.ghostDreadAt \? MM\.ghostDreadAt\(a\.x, a\.y\) : null;/.test(invSrc), 'invasion aliens consult the dread');
assert.ok(/const desired = dread \? dread\.awayX \* speed \* 1\.2 :/.test(invSrc), 'a spooked alien squad routs away from the spirit');
assert.ok(/if\(dread\) a\.attackCd = Math\.max\(a\.attackCd, 0\.6\);/.test(invSrc), 'routed aliens hold their fire');
const lairSrc = readFileSync(new URL('../src/engine/guardian_lairs.js', import.meta.url), 'utf8');
assert.ok(/const dread = MM\.ghostDreadAt \? MM\.ghostDreadAt\(e\.x, e\.y\) : null;/.test(lairSrc), 'guardian sidekicks consult the dread');
assert.ok(/function updateSidekick\(e,p,getTile,setTile,dt,L\)[\s\S]{0,600}if\(dread\)\{[\s\S]{0,300}return;/.test(lairSrc),
	'a spooked sidekick retreats instead of attacking (and the BOSS is deliberately immune)');
const compSrc = readFileSync(new URL('../src/engine/companions.js', import.meta.url), 'utf8');
assert.ok(/function updateMolekinAction[\s\S]{0,400}MM\.ghostDreadAt\(c\.x,c\.y\)/.test(compSrc), 'kretoludzie (molekin) consult the dread');
assert.ok(/c\.laserCd=Math\.max\(c\.laserCd\|\|0,0\.6\);[\s\S]{0,80}return true;/.test(compSrc), 'a spooked molekin holds its fire and scatters');

// --- watcher powers: host-authoritative, creatures-only ---------------------------------------------
assert.ok(/function handlePower\(s, entry, pl\)/.test(hostSrc), 'the host owns power resolution');
assert.ok(/if\(!NET\.modeAllows\(entry\.mode, 'full'\)\)\{ entry\.peer\.send\(\{ t: 'powerAck', kind, ok: false, reason: 'perm'/.test(hostSrc), 'powers need at least the full permission mode');
assert.ok(/if\(entry\.charge < rule\.cost\)/.test(hostSrc) && /entry\.charge -= rule\.cost;/.test(hostSrc), 'powers cost earned charge');
assert.ok(/const hits = bridge\.ghostPower\(kind, entry\.cam\.x, entry\.cam\.y, rule\);/.test(hostSrc),
	'a power strikes at the SPIRIT position the host tracked — never at client-chosen coordinates');
assert.ok(/function chargeTick\(s, t, live\)/.test(hostSrc) && /NET\.chargeAfter\(entry\.charge, dt, wasActive\)/.test(hostSrc),
	'charge accrues only while the watcher is active (and reuses the per-frame entries snapshot)');
assert.ok(/ghostPower:\(kind,x,y,rule\)=>\{/.test(mainSrc), 'the bridge exposes ghostPower');
assert.ok(!/ghostPower[\s\S]{0,900}setTile\(/.test(mainSrc), 'NO ghost power may edit a tile — creatures only, so a watcher can never grief the world');
assert.ok(/MOBS\.chillRadius/.test(mainSrc) && /MOBS\.blastRadius/.test(mainSrc) && /MOBS\.statusRadius\(x,y,r,'panic'/.test(mainSrc),
	'frost/smite/banish route through the existing mob AoE APIs');

// --- assistants: delegates, not second players ----------------------------------------------------------
assert.ok(/function setAssistant\(gid, on\)/.test(hostSrc), 'the host appoints assistants');
assert.ok(/if\(on && !NET\.modeAllows\(entry\.mode, 'full'\)\) return false;/.test(hostSrc), 'an assistant must hold at least full permissions');
assert.ok(!/else if\(on && entry\.assistant\)/.test(hostSrc), 'the single-seat handover is GONE — several assistants may serve at once');
assert.ok(/if\(!entry\.assistant \|\| !NET\.modeAllows\(entry\.mode, 'full'\)\)\{ entry\.peer\.send\(\{ t: 'assistAck', ok: false, reason: 'perm' \}\); return; \}/.test(hostSrc),
	'non-assistants cannot run assistant actions');
assert.ok(/ghostAssistState:\(\)=>\{/.test(mainSrc) && /ghostAssist:\(action,id,n\)=>\{/.test(mainSrc), 'the bridge exposes the assistant surface');
assert.ok(/if\(!made\) return \{ok:false, reason:'cost'\};/.test(mainSrc), 'the assistant cannot craft what the hero cannot afford');
assert.ok(/if\(!craftRecipeVisible\(r\)\) return \{ok:false, reason:'locked'\};/.test(mainSrc), 'the assistant cannot craft undiscovered recipes');
assert.ok(/while\(made<want && canCraft\(r\)\)\{ doCraft\(r,1\); made\+\+; \}/.test(mainSrc),
	'batch crafting re-checks affordability per unit — partial success is honest when a rival drained the pouch');
assert.ok(/sendAssist\('craft', r\.id, count\)/.test(clientSrc) && /sendAssist\(i\.equipped \? 'unequip' : 'equip', i\.id, 1\)/.test(clientSrc),
	'the assistant workbench drives craft/equip/unequip only');
// the assistant sees what the player sees: groups, favorites, gear scores, resources
assert.ok(/g:CRAFT_GROUP_LABELS\[recipeGroup\(r\)\]/.test(mainSrc) && /fav:!!\(CRAFT_MODEL && CRAFT_MODEL\.isFavorite/.test(mainSrc),
	'assist state carries the player’s own group labels and favorites');
assert.ok(/resources=RESOURCE_DEFS\.map\(d=>\(\{k:d\.key, name:d\.label, n:Math\.floor\(Number\(inv\[d\.key\]\)\|\|0\)\}\)\)\.filter\(r=>r\.n>0\)/.test(mainSrc),
	'assist state carries the live resource pouch');
assert.ok(/search\.addEventListener\('input'/.test(clientSrc) && /el\.append\(head, vitals, search, body\)/.test(clientSrc),
	'the workbench search box lives in the persistent skeleton — a state tick must not steal focus mid-typing');
assert.ok(/if\(sig !== assistSig\)\{ assistSig = sig; renderAssist\(\); \}/.test(clientSrc),
	'identical state ticks skip the DOM rebuild');
// first-wins arbitration: requests execute serially on the host; the loser hears the truth
assert.ok(/t - \(entry\.lastAssistActAt \|\| 0\) < NET\.ASSIST_LIMITS\.RATE_MS/.test(hostSrc), 'per-assistant rate floor (double-click guard)');
assert.ok(/zabrakło surowców \(ktoś był szybszy\?\)/.test(clientSrc), 'the losing assistant is told why the craft failed');
assert.ok(/const n = pl\.a === 'craft' \? NET\.clampCraftCount\(pl\.n\) : 1;/.test(hostSrc), 'craft batch size is clamped host-side');
assert.ok(/function assistStateShared\(s, t\)/.test(hostSrc) && /t - \(s\.assistStateAt \|\| 0\) > 1000/.test(hostSrc),
	'one serialization serves every assistant on the tick (N assistants ≠ N ghostAssistState calls)');
// the approval desk: with approvals ON nothing executes until the host clicks Zatwierdź
assert.ok(/if\(approvalMode\)\{/.test(hostSrc) && /s\.assistQueue\.push\(/.test(hostSrc), 'approval mode queues instead of executing');
assert.ok(/label = bridge\.ghostAssistLabel\(pl\.a, id, n\)/.test(hostSrc) && /if\(!label\)\{ entry\.peer\.send\(\{ t: 'assistAck', ok: false, reason: 'unknown'/.test(hostSrc),
	'approval rows carry HOST-derived labels only — client text never reaches the host UI');
assert.ok(/function approveAssist\(qid\)/.test(hostSrc) && /res = bridge\.ghostAssist\(q\.a, q\.id, q\.n\)/.test(hostSrc),
	'approval re-validates and executes through the same guarded bridge path');
assert.ok(/function rejectAssist\(qid\)/.test(hostSrc) && /reason: 'rejected'/.test(hostSrc), 'rejection notifies the proposing assistant');
assert.ok(/s\.assistQueue\.expire\(t\)/.test(hostSrc) && /reason: 'expired'/.test(hostSrc), 'stale proposals expire and the assistant hears about it');
assert.ok(/localStorage\.setItem\(APPROVE_KEY, approvalMode \? '1' : '0'\)/.test(hostSrc), 'the approval switch is remembered across sessions');
assert.ok(/id="ghostPanelApprove"/.test(hostSrc) && /approveAssist\(q\.qid\)/.test(hostSrc) && /rejectAssist\(q\.qid\)/.test(hostSrc),
	'the host panel carries the toggle and per-request verdict buttons');
// approval-queue pure core: bounded on both axes, FIFO of what the host sees
{
	const q = NET.createAssistQueue();
	const t0 = 1000;
	for(let i = 0; i < NET.ASSIST_LIMITS.QUEUE_PER_GHOST; i++){
		assert.ok(q.push({ gid: 'gA', name: 'A', a: 'craft', id: 'r' + i, n: 1, label: 'L' + i }, t0).ok, 'assistant A fills its slots');
	}
	assert.equal(q.push({ gid: 'gA', name: 'A', a: 'craft', id: 'rX', n: 1, label: 'LX' }, t0).reason, 'yours',
		'one assistant cannot hog the queue past its per-ghost cap');
	let n = q.size();
	for(let i = 0; n < NET.ASSIST_LIMITS.QUEUE_MAX; i++, n++){
		assert.ok(q.push({ gid: 'g' + i, name: 'G', a: 'craft', id: 'q' + i, n: 1, label: 'Q' + i }, t0).ok, 'other assistants still fit');
	}
	assert.equal(q.push({ gid: 'gZ', name: 'Z', a: 'craft', id: 'z', n: 1, label: 'Z' }, t0).reason, 'full', 'the queue has a hard ceiling');
	const first = q.list()[0];
	assert.equal(q.take(first.qid).qid, first.qid, 'take removes exactly the addressed request');
	assert.equal(q.take(first.qid), null, 'a taken request cannot be approved twice');
	const dead = q.expire(t0 + NET.ASSIST_LIMITS.QUEUE_TTL_MS + 1);
	assert.equal(dead.length + q.size(), NET.ASSIST_LIMITS.QUEUE_MAX - 1, 'expiry sweeps every stale request, loses none');
	assert.equal(q.size(), 0, 'nothing outlives the TTL');
	assert.equal(NET.clampCraftCount(999), NET.ASSIST_LIMITS.CRAFT_MAX, 'craft batches are capped');
	assert.equal(NET.clampCraftCount(-3), 1, 'craft batches have a floor');
	assert.equal(NET.clampCraftCount('nonsense'), 1, 'garbage counts fold to one');
}

// --- watcher progression: host mints, client banks, nobody is trusted with authority ------------
assert.ok(/function sendDeed\(entry, k, n\)/.test(hostSrc), 'the host owns deed minting');
for(const [event, deed] of [['handleBuff', "sendDeed\\(entry, pl\\.kind, 1\\)"], ['handlePower', "sendDeed\\(entry, kind, 1\\)"], ['handleAssist', "sendDeed\\(entry, pl\\.a, res\\.made \\|\\| 1\\)"], ['handleChat', "sendDeed\\(entry, 'chat', 1\\)"]]){
	assert.ok(new RegExp(deed).test(hostSrc), event + ' mints its deed only after the event was validated');
}
assert.ok(/if\(hits > 0\) sendDeed\(entry, 'hit', hits\);/.test(hostSrc), 'power hits pay extra');
assert.ok(/if\(entry\.actUntil > t && t - \(entry\.watchT \|\| 0\) >= NET\.PROG\.WATCH_TICK_MS\)/.test(hostSrc),
	'watch XP ticks ONLY while the viewer is active — an idle tab earns nothing (same anti-fake-watcher rule as the boosts)');
assert.ok(/t - \(entry\.chatXpAt \|\| 0\) >= NET\.PROG\.CHAT_XP_MS/.test(hostSrc), 'chat XP has its own slower clock (the 4 s send floor is not an XP faucet)');
assert.ok(/MMR\.ghostSpook = \(i\) =>/.test(hostSrc) && /function noteSpook\(i\)/.test(hostSrc) && /s\.auraOwners\[i \| 0\]/.test(hostSrc),
	'a fright is credited to the spirit that caused it');
assert.ok(/if\(!\(finiteNum\(m\._ghostSpookUntil\) && m\._ghostSpookUntil>now\) && MM\.ghostSpook\)/.test(mobsSrc),
	'a creature credits ONE spook per fright episode, not one per frame');
// THE contract: the profile lives in the watcher's browser, so it is forgeable — and
// therefore may never open a door on the host side.
const authorityGates = [
	hostSrc.slice(hostSrc.indexOf('function handlePower'), hostSrc.indexOf('function chargeTick')),
	hostSrc.slice(hostSrc.indexOf('function handleBuff'), hostSrc.indexOf('function handleChat')),
	hostSrc.slice(hostSrc.indexOf('function handleAssist'), hostSrc.indexOf('function sendAssistState')),
	hostSrc.slice(hostSrc.indexOf('function setAssistant'), hostSrc.indexOf('function setAssistant') + 700)
];
for(const gate of authorityGates){
	assert.ok(gate.length > 40, 'gate slice found');
	assert.ok(!/\.level|achiev|prog\b/i.test(gate), 'NO host-side gate reads the watcher’s level/achievements — progression is a reward, never an authority');
}
assert.ok(/entry\.level = Math\.max\(1, Math\.min\(NET\.PROG\.MAX_LEVEL, Math\.floor\(pl\.lvl\)\)\)/.test(hostSrc),
	'the claimed level is clamped and used for display only');
// client: persists in the WATCHER's own browser — that is what survives a reload
assert.ok(/allow = new Set\(\['mm_ghost_name_v1', 'mm_ghost_avatar_v1', NET\.PROG_KEY, NET\.GID_KEY, NET\.GID_LEASE_KEY, NET\.LOOK_KEY\]\)/.test(clientSrc),
	'the ghost profile is on the storage allowlist (the lockdown would otherwise silently drop it)');
assert.ok(/localStorage\.setItem\(NET\.PROG_KEY, JSON\.stringify\(prog\)\)/.test(clientSrc) && /function loadProgress\(\)/.test(clientSrc),
	'the career is written to and read from the watcher’s own localStorage');
assert.ok(/if\(!NET\.validDeed\(pl\.k\)\) return;[\s\S]{0,400}bankDeeds\(\[\{ k: pl\.k, n: pl\.n \}\]/.test(clientSrc), 'the client banks host-minted deeds only');
assert.ok(/conn\.send\(\{ t: 'prog', lvl: res\.level \}\)/.test(clientSrc), 'a promotion is reported to the host for the rank badge');
assert.ok(/lvl: NET\.levelFor\(prog\.xp\)\.level/.test(clientSrc), 'hello carries the level so a returning ghost shows its rank immediately');
// hardening pass (2nd review): farming, floods and refresh-vs-interaction races
assert.ok(/if\(pl\.k === 'join' && prog\.days\.includes\(today\(\)\)\) return;/.test(clientSrc),
	'join XP pays once per day — reload-farming must not out-earn honest watching');
assert.ok(/function flushProgress\(force\)/.test(clientSrc) && /t - lastProgSaveAt < 2000/.test(clientSrc),
	'profile writes are throttled (a deed-spamming host cannot buy a localStorage write per message)');
assert.ok(/window\.addEventListener\('pagehide', \(\) => flushProgress\(true\)\)/.test(clientSrc) && /flushProgress\(true\); \/\/ nothing earned/.test(clientSrc),
	'dirty progress is force-flushed on leave and unload — the throttle may never lose an earned deed');
assert.ok(/JSON\.stringify\(res\.state\.counts\) !== JSON\.stringify\(before\.counts\)/.test(clientSrc)
	&& /res\.state\.days\.length !== before\.days\.length/.test(clientSrc),
	'count-only and day-only changes persist too (the 0-XP crowd deed and day stamps must reach disk)');
assert.ok(/if\(lvl !== entry\.level\)\{ entry\.level = lvl; updateUi\(\); \}/.test(hostSrc),
	'prog spam cannot drive host DOM rebuilds — updateUi only fires on an actual level change');
assert.ok(/if\(!el \|\| el\.style\.display !== 'flex'\) return;/.test(hostSrc)
	&& /focusedTag === 'SELECT' \|\| focusedTag === 'INPUT'/.test(hostSrc),
	'the periodic panel refresh skips a hidden panel and never yanks an open dropdown/selection from the host');

// --- entry point: a first-class HUD icon, not a row in the ≡ menu ------------------------------------
assert.ok(/id="ghostBtn"/.test(html) && /id="ghostBtnCount"/.test(html), 'index.html carries the 👁 viewers button with its live count');
assert.ok(/<div id="menuWrap">[\s\S]{0,400}id="ghostBtn"/.test(html), 'the viewers button sits in the top bar next to the menu');
assert.ok(/function mountEntryPoint\(\)/.test(hostSrc) && /document\.getElementById\('ghostBtn'\)/.test(hostSrc),
	'the host binds the HUD button (the panel is no longer buried in the debug menu)');
assert.ok(!/getElementById\('menuPanel'\)/.test(hostSrc), 'no menu-panel injection survives');
assert.ok(/body\.mmGhostMode #menuWrap/.test(clientSrc), 'a watcher never sees the host-only viewers button (menuWrap is hidden in ghost mode)');
// per-session default permission for newcomers — the host decides the door policy once
assert.ok(/let defaultMode = 'full';/.test(hostSrc) && /mode: defaultMode,/.test(hostSrc), 'joining ghosts inherit the host-chosen default mode');
assert.ok(/function setDefaultMode\(mode\)/.test(hostSrc) && /localStorage\.setItem\(PERM_KEY, mode\)/.test(hostSrc), 'the default mode is settable and remembered');

// --- spirit lift: a ghost never covers the hero (pure) ---------------------------------------------
{
	const A = NET.SPIRIT_AVOID;
	assert.ok(A.RX > 0 && A.RY > 0 && A.CLEAR >= 1, 'avoidance box is sane (CLEAR reaches above a ~1-tile hero)');
	const centered = NET.spiritLift(10, 20, 10, 20);
	assert.ok(Math.abs(centered - A.CLEAR) < 1e-9, 'a spirit parked ON the hero is displayed a full CLEAR above its head');
	assert.ok(NET.spiritLift(10 + A.RX, 20, 10, 20) < 1e-9, 'horizontally clear of the hero = no lift');
	assert.ok(NET.spiritLift(10, 20 - A.CLEAR - 0.01, 10, 20) < 1e-9, 'already above the hover line = no lift');
	assert.ok(NET.spiritLift(10, 20 + A.RY, 10, 20) < 1e-9, 'far below the feet = no lift (no 2-tile teleports)');
	// continuity: the lift fades smoothly at every edge of the avoidance box
	assert.ok(NET.spiritLift(10 + A.RX - 0.01, 20, 10, 20) < 0.05, 'lift fades to ~0 at the horizontal edge');
	assert.ok(NET.spiritLift(10, 20 + A.RY - 0.01, 10, 20) < 0.05, 'lift fades to ~0 at the lower edge');
	const near = NET.spiritLift(10.2, 20, 10, 20), far = NET.spiritLift(10.7, 20, 10, 20);
	assert.ok(near > far && far > 0, 'lift is monotonic in horizontal distance');
	assert.equal(NET.spiritLift(NaN, 20, 10, 20), 0, 'garbage coordinates are inert');
	// the lift is display-only: both engine painters subtract it from the DRAWN y…
	assert.ok(/NET\.spiritLift\(entry\.camPos\.x, entry\.camPos\.y, p\.x, p\.y\)/.test(hostSrc), 'host lifts each spirit against the hero');
	assert.ok(/NET\.spiritLift\(g\.x, g\.y, hx, hy\)/.test(clientSrc) && /NET\.spiritLift\(c\.x, c\.y, hx, hy\)/.test(clientSrc),
		'client lifts fellow spirits and its own avatar against the hero replica');
	// …and never the pose that feeds dread/powers/presence
	assert.ok(/spirits\.push\(\{ x: e\.cam\.x, y: e\.cam\.y \}\)/.test(hostSrc), 'the dread aura reads the TRUE pose, not the lifted display');
	assert.ok(/ctx\.arc\(c\.x \* TILE, c\.y \* TILE, NET\.DREAD\.R \* TILE/.test(clientSrc), 'the dread ring is anchored at the TRUE pose too');
}

// --- voices: the host speaks, everyone reads --------------------------------------------------------
assert.ok(/function say\(raw\)/.test(hostSrc) && /const res = NET\.filterChat\(raw\);/.test(hostSrc.slice(hostSrc.indexOf('function say('))),
	'the host’s own words pass the same profanity filter it enforces on watchers');
assert.ok(/t - lastSayAt < 800\) return false;/.test(hostSrc), 'host chat has a send floor (Enter-spam must not flood the peers)');
assert.ok(/broadcast\(\{ t: 'hostChat', text: res\.text \}\)/.test(hostSrc), 'host words ride the wire to every watcher');
assert.ok(/paintChatBubble\(ctx, TILE, p\.x, p\.y - \(p\.h \|\| 1\) \/ 2 - 0\.5, hostChat\.text\)/.test(hostSrc),
	'the host sees its own bubble over the hero');
assert.ok(/pl\.t === 'hostChat'/.test(clientSrc) && /const text = NET\.filterChat\(pl\.text\)\.text; \/\/ defense in depth — the host filters its own words too/.test(clientSrc),
	'the client re-filters host words before showing them');
assert.ok(/bubble\(ctx, TILE, p\.x, p\.y - \(p\.h \|\| 1\) \/ 2 - 0\.5, hostChat\.text\)/.test(clientSrc),
	'the watcher sees the host bubble over the hero replica');
assert.ok(/function mountSayKey\(\)/.test(hostSrc) && /e\.key !== 'Enter' \|\| e\.repeat/.test(hostSrc), 'Enter opens the host chat line');
assert.ok(/bridge\.overlayHold && bridge\.overlayHold\(\)/.test(hostSrc), 'the say key defers to title/finale overlays');
assert.ok(/bridge\.releaseInput\(\)/.test(hostSrc) && /releaseInput:\(\)=>\{ try\{ releaseGameplayInput\(\); \}catch\(e\)\{\} \}/.test(mainSrc),
	'opening the chat line releases held movement keys (the swallowed keyup would keep the hero walking)');
assert.ok(/id="ghostPanelSay"/.test(hostSrc), 'the panel carries a say row for touch hosts');

// --- pings: a watcher points, nobody aims -----------------------------------------------------------
assert.ok(NET.PING.MIN_MS >= 2000 && NET.PING.TTL_MS > 0, 'pings are rate-limited and transient');
{
	const pingSlice = hostSrc.slice(hostSrc.indexOf('function handlePing'), hostSrc.indexOf("--- the host's own voice"));
	assert.ok(pingSlice.length > 40, 'handlePing found');
	assert.ok(/!NET\.modeAllows\(entry\.mode, 'chat'\) \|\| !entry\.cam\) return;/.test(pingSlice), 'pings need at least chat permission and a tracked pose');
	assert.ok(/t - \(entry\.lastPingAt \|\| 0\) < NET\.PING\.MIN_MS\) return;/.test(pingSlice), 'pings are rate-limited per watcher');
	assert.ok(/x: \+entry\.cam\.x\.toFixed\(2\), y: \+entry\.cam\.y\.toFixed\(2\)/.test(pingSlice) && !/pl\.x|pl\.y/.test(pingSlice),
		'the marker lands at the HOST-tracked pose — client coordinates are never read');
	assert.ok(!/sendDeed/.test(pingSlice), 'pings earn no XP (a pointer, not a faucet)');
}
assert.ok(/function sendPing\(\)/.test(clientSrc) && /t - lastPingSentAt < NET\.PING\.MIN_MS\) return false;/.test(clientSrc),
	'the client rate-limits its own pings too');
assert.ok(/k === 'p'\)\{ sendPing\(\); e\.preventDefault\(\); \}/.test(clientSrc) && /id="gbPing"/.test(clientSrc),
	'pings ride the P key and a bar button');
assert.ok(/conn\.send\(\{ t: 'ping' \}\);/.test(clientSrc), 'the ping payload carries NO coordinates');

// --- audience visibility: the host decides what it SEES, never what happens -------------------------
assert.ok(/const viewPrefs = \{ spirits: true, bubbles: true, fx: true \};/.test(hostSrc), 'the three display toggles default to visible');
assert.ok(/localStorage\.setItem\(VIEW_KEY, JSON\.stringify\(viewPrefs\)\)/.test(hostSrc), 'display toggles are remembered across sessions');
assert.ok(/if\(!viewPrefs\.spirits \|\| session\.hiddenGids\.has\(entry\.gid\)\) continue;/.test(hostSrc),
	'hidden spirits (global or per-watcher) skip the painter AFTER the glide update — mechanics untouched');
assert.ok(/viewPrefs\.bubbles \? entry\.lastChat : null/.test(hostSrc), 'the bubble toggle silences watcher bubbles');
assert.ok(/function setViewerHidden\(gid, on\)/.test(hostSrc) && /session\.hiddenGids\.add\(gid\)/.test(hostSrc), 'per-watcher hide is host-settable');
assert.ok(/if\(!s\.hiddenGids\.has\(entry\.gid\)\)\{ try\{ bridge\.msg\('💬 '/.test(hostSrc),
	'a muted watcher’s chat stays out of the host log (but still reaches fellow watchers — the broadcast is unconditional)');
{
	const chatSlice = hostSrc.slice(hostSrc.indexOf('function handleChat'), hostSrc.indexOf('function handlePing'));
	assert.ok(/broadcast\(\{ t: 'chat'/.test(chatSlice) && chatSlice.indexOf('hiddenGids') < chatSlice.indexOf("broadcast({ t: 'chat'"),
		'the mute guards only the local msg — the relay to other watchers is unconditional');
}
// per-watcher hide is a DISPLAY preference: no gate in the buff/power/assist paths reads it
for(const fn of ['function handleBuff', 'function handlePower', 'function handleAssist']){
	const at = hostSrc.indexOf(fn);
	const slice = hostSrc.slice(at, hostSrc.indexOf('function', at + 20));
	assert.ok(!/hiddenGids/.test(slice), fn + ' ignores the mute — hiding a watcher never blocks its (validated) influence');
}

// --- action feedback: watcher deeds leave a visible trace, under one switch --------------------------
assert.ok(/function noteActionFx\(s, fx\)/.test(hostSrc) && /s\.actionFx\.length > 10\) s\.actionFx\.shift\(\)/.test(hostSrc),
	'the action feed exists and is bounded');
for(const [ev, pat] of [['buff', /noteActionFx\(s, \{ kind: 'buff', hero: 1/], ['power', /noteActionFx\(s, \{ kind: 'power', power: kind, x: entry\.cam\.x/], ['assist', /noteActionFx\(s, \{ kind: 'assist', hero: 1/], ['ping', /noteActionFx\(s, \{ kind: 'ping', x: entry\.cam\.x/]]){
	assert.ok(pat.test(hostSrc), ev + ' actions feed the visible trace');
}
assert.ok(/if\(viewPrefs\.fx\) drawActionFx\(ctx, TILE, t, p\);/.test(hostSrc), 'the whole trace obeys the „działania” toggle at paint time');
assert.ok(/if\(viewPrefs\.fx\)\{\s*\n?\s*if\(MMR && MMR\.particles/.test(hostSrc), 'buff bursts and sounds obey the toggle too');
assert.ok(!/ghostPower[\s\S]{0,900}spawnBurst/.test(mainSrc),
	'bridge.ghostPower is mechanics-only — its fx moved host-side under the toggle');
assert.ok(/paintSpirit\(ctx, TILE, x, y, name, t, self, avatar, active, chat, pass\)/.test(hostSrc)
	&& /function paintChatBubble\(ctx, TILE, x, y, text\)/.test(hostSrc),
	'the painter splits body/text passes and shares one bubble painter with the client');

// --- source pins: the guardian arena mirror ------------------------------------------------------
// guardian_lairs.restore() deliberately clears live entities, so the join snapshot
// carries NO fight — without this plane a watcher stared at an EMPTY lair while the
// hero visibly battled a boss (the last of the frozen-actor gaps after mobs,
// invasions and weapon FX got their planes).
assert.ok(/function ghostMirrorState\(\)/.test(lairSrc) && /function ghostApplyMirror\(data\)/.test(lairSrc)
	&& /function ghostLerp\(dt\)/.test(lairSrc), 'guardian_lairs ships the spectator mirror trio');
assert.ok(/ghostMirrorState, ghostApplyMirror, ghostLerp,/.test(lairSrc), 'the mirror trio is exposed on the guardians api');
{
	// THE contract: puppets are cosmetic — the watcher-side apply/lerp may not write
	// tiles, deal damage, or spawn/awaken anything through the real AI paths.
	const applySlice = lairSrc.slice(lairSrc.indexOf('function ghostApplyMirror'), lairSrc.indexOf('function resetUnderground'));
	assert.ok(applySlice.length > 100 && applySlice.includes('function ghostLerp'), 'mirror apply+lerp slice found');
	assert.ok(!/setTile|damageAt|attackAt|addHazard\(|spawnGuardian|awaken\(|addEffect\(/.test(applySlice),
		'the watcher-side guardian mirror is cosmetic only — no tile writes, no damage, no AI spawns');
	assert.ok(/dmg:0, source:0/.test(applySlice), 'puppet hazards carry zero damage');
	assert.ok(/slice\(0,10\)/.test(applySlice) && /slice\(0,48\)/.test(applySlice) && /slice\(0,16\)/.test(applySlice),
		'hostile mirror payloads are bounded on every axis (entities, hazards, effects)');
	assert.ok(/GHOST_HAZ_TYPES\.includes\(w\.t\)/.test(applySlice), 'unknown hazard types are refused, not drawn');
}
assert.ok(/function guardTick\(s, t\)/.test(hostSrc) && /if\(t - s\.last\.guard >= CAD\.guard\) guardTick\(s, t\);/.test(hostSrc),
	'the host streams the guardian mirror on its own cadence');
assert.ok(/if\(!st && !s\.guardBusy\) return;/.test(hostSrc),
	'an empty arena streams nothing (but one trailing packet clears the watcher copy)');
assert.ok(/pl\.t === 'guard'/.test(clientSrc) && /MMR\.guardianLairs\.ghostLerp\(dt\)/.test(clientSrc),
	'the watcher applies the guardian mirror and animates it between packets');

// --- audit pins (2026-07-16): cache coherence, camera respect, seat identity, chat floor -----------
assert.ok(/s\.snapCache = null; s\.sinceCache\.length = 0;\s*\n\s*reap\(s, t\);/.test(hostSrc),
	'an emptied audience invalidates the snapshot cache — tile capture is off with zero watchers, so a re-join inside the cache window must reserialize');
assert.ok(/if\(other !== entry && other\.hello && other\.gid === entry\.gid\) dropPeer\(s, other, true\);/.test(hostSrc),
	'one gid = one seat: the newest connection wins, so a dirty-drop reconnect is never blocked or twinned by its own corpse');
assert.ok(/const wasLive = state === 'live';/.test(clientSrc) && /if\(!wasLive\)\{/.test(clientSrc),
	'a mid-session resync re-bases the world WITHOUT yanking a free-flying camera back to follow mode');
assert.equal(NET.CHAT.MIN_MS, 4000, 'the chat floor is a shared constant');
assert.ok(/const CHAT_MIN_MS = NET\.CHAT\.MIN_MS;/.test(hostSrc), 'the host chat floor derives from the shared constant');
assert.ok(/lastChatSentAt \+ NET\.CHAT\.MIN_MS - nowMs\(\)/.test(clientSrc),
	'the client mirrors the chat floor locally — a too-fast message is refused with a reason instead of vanishing server-side');

// --- full multiplayer: the embodied guest (2026-07-16) --------------------------------------------
// The ghost ladder gains a `play` rung: a promoted viewer gets an OWN hero in the
// host's world. Authority split is the whole safety story — the guest simulates its
// own MOVEMENT locally (feels instant), the HOST owns vitals, pouch and every world
// edit and validates each intent. The spectator tiers below are untouched: the ghost
// system stays the default and the safe floor.
// permission gates read the INCLUSIVE ladder now (play ⊇ full), not `=== 'full'`
assert.ok(/NET\.modeAllows\(entry\.mode, 'full'\)/.test(hostSrc) && !/entry\.mode !== 'full'/.test(hostSrc),
	'host influence gates use the inclusive ladder (a player keeps every spectator ability)');
assert.ok(/NET\.modeAllows\(entry\.mode, 'chat'\)/.test(hostSrc), 'chat/ping gates use the inclusive ladder too');
// the play rung is NEVER a default door policy — embodiment is granted by hand
assert.ok(/DEFAULT_MODES = NET\.PERMISSION_MODES\.filter\(m => m !== 'play'\)/.test(hostSrc),
	'play is excluded from the newcomer default (an embodied stranger by default is a griefing invite)');
assert.ok(/if\(!DEFAULT_MODES\.includes\(mode\)\) return false;/.test(hostSrc), 'setDefaultMode refuses the play rung');
// granting play spawns a HOST-owned body; revoking removes it — spectating persists
assert.ok(/if\(mode === 'play' && !entry\.body\) spawnBody\(session, entry\);/.test(hostSrc)
	&& /else if\(mode !== 'play' && entry\.body\) despawnBody\(session, entry\);/.test(hostSrc),
	'promotion to play embodies the guest; any downgrade removes the body');
// vitals & pouch are HOST state, streamed to the guest as display truth
assert.ok(/function sendVitals\(s, entry\)/.test(hostSrc) && /t: 'pvit'/.test(hostSrc), 'the host owns and streams the guest vitals + pouch');
assert.ok(/function hurtBody\(s, entry/.test(hostSrc) && /b\.invulUntil = t \+ NET\.PLAY_RULES\.HURT_INVUL_MS/.test(hostSrc),
	'guest damage is host-decided with i-frames; death and respawn are host-owned');
// the movement envelope: a claimed pose is followed at most MAX_SPEED fast
assert.ok(/pl\.t === 'ppose'/.test(hostSrc) && /NET\.clampBodyStep\(b\.x, \+pl\.x, maxStep\)/.test(hostSrc),
	'the guest pose is followed inside a per-axis speed envelope (a teleport hack rubber-bands)');
// EVERY world-touching intent funnels through one validated handler
assert.ok(/function handlePlayAct\(s, entry, pl\)/.test(hostSrc) && /pl\.t === 'pact'/.test(hostSrc),
	'every guest world intent lands in one host-side handler');
assert.ok(/if\(b\.dead\)\{ entry\.peer\.send\(\{ t: 'pactAck', a: pl\.a, ok: false, reason: 'dead'/.test(hostSrc), 'a dead guest cannot act');
assert.ok(/if\(!NET\.playReachOk\(b\.x, b\.y, tx, ty\)\)/.test(hostSrc), 'reach is enforced against the HOST-tracked body pose');
assert.ok(/if\(!\(Number\(b\.pouch\[key\]\) > 0\)/.test(hostSrc), 'building spends only what the host-owned pouch holds');
assert.ok(/bridge\.ghostPlayMineAt\(tx, ty\)/.test(hostSrc) && /bridge\.ghostPlayPlaceAt\(tx, ty, key/.test(hostSrc)
	&& /bridge\.ghostPlayStrike\(/.test(hostSrc), 'intents resolve through the guarded bridge seams');
// the body plane feeds MM.coopBodies — the one hook creatures read
assert.ok(/function bodyTick\(s, t\)/.test(hostSrc) && /MMR\.coopBodies = pub;/.test(hostSrc) && /t: 'pb'/.test(hostSrc),
	'the body plane streams the guests AND publishes MM.coopBodies for creature contact');
assert.ok(/MMR\.coopBodies = \[\];/.test(hostSrc), 'ending the session clears MM.coopBodies (creatures stop checking)');
// an embodied guest is a physical presence, NOT a dread phantom
assert.ok(/if\(e\.cam && !e\.body\)\{ spirits\.push/.test(hostSrc), 'an embodied guest raises no dread aura (it is a body, not a spirit)');
// the bridge seams — creatures only for strike, foreground-tile-only for edits, pouch yield
assert.ok(/ghostPlayMineAt:\(tx,ty\)=>\{/.test(mainSrc) && /companionHarvestAssignableTile\(tId\)/.test(mainSrc),
	'guest mining reuses the companion-digger whitelist (no machines, chests, story tiles)');
assert.ok(/ghostPlayPlaceAt:\(tx,ty,key,body\)=>\{/.test(mainSrc) && /cellOverlapsPlayer\(tx,ty\)/.test(mainSrc),
	'guest building respects the same open-cell / hero-overlap rules as the local placer');
assert.ok(/ghostPlayStrike:\(x,y,r,dmg\)=>\{/.test(mainSrc) && !/ghostPlayStrike[\s\S]{0,400}setTile\(/.test(mainSrc),
	'guest melee is creatures-only — no tile is ever touched by fighting');
assert.ok(/drawHeroAt:\(st\)=>\{/.test(mainSrc) && /drawPlayer\(\{remoteBody:true\}\)/.test(mainSrc),
	'remote heroes render through the REAL hero painter via a field swap (a player looks like a player)');
// mobs.js contact pass — cost-free in solo play, hurts a touched guest body
const mobsSrc2 = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
assert.ok(/function coopContactPass\(now, nowEpoch\)/.test(mobsSrc2) && /coopContactPass\(now, nowEpoch\);/.test(mobsSrc2),
	'the mob update runs a co-op contact pass');
assert.ok(/const bodies = \(typeof MM!=='undefined' && MM\.coopBodies\) \|\| null;\s*\n\s*if\(!bodies \|\| !bodies\.length\) return;/.test(mobsSrc2),
	'the contact pass early-returns with no bodies (zero cost in solo play and the Node sims)');
assert.ok(/b\.hurt\(spec\.dmg\*\(m\.dmgMult\|\|0\+1\)?/.test(mobsSrc2) || /b\.hurt\(spec\.dmg\*\(m\.dmgMult\|\|1\)/.test(mobsSrc2),
	'a hostile creature that touches a guest body hurts it through the body hurt() callback');
// client: the local player object FLIPS from replica to the guest's own body
assert.ok(/function enterPlay\(\)/.test(clientSrc) && /function exitPlay\(\)/.test(clientSrc), 'the client enters/leaves embodiment on the perm change');
assert.ok(/import \{ applyHorizontalMovement \} from '\.\/movement\.js';/.test(clientSrc) && /function stepOwnHero\(dt\)/.test(clientSrc),
	'the guest simulates its own hero with the shared movement helper (local, instant)');
assert.ok(/function collideAxis\(p, axis, prev\)/.test(clientSrc) && /bridge\.solidAt\(x, y, 'x'\)/.test(clientSrc),
	'guest physics runs a swept per-axis resolver against the replicated world');
assert.ok(/function sendPlayAct\(a, wx, wy, key\)/.test(clientSrc) && /t: 'pact', a, x: Math\.floor\(wx\), y: Math\.floor\(wy\)/.test(clientSrc),
	'the guest POINTS (mine/place/strike intents) — it decides nothing about the world itself');
assert.ok(/pl\.t === 'pvit'/.test(clientSrc) && /pl\.t === 'pdmg'/.test(clientSrc) && /pl\.t === 'prespawn'/.test(clientSrc),
	'the client honors host-owned vitals, damage and respawn');
assert.ok(/const keep = \(play\.on && play\.spawned\)/.test(clientSrc) && /if\(keep\) Object\.assign\(bridge\.player, keep\);/.test(clientSrc),
	'an embodied guest keeps ITS hero across a mid-session resync (applyGameData would otherwise rewrite it with the host hero)');
assert.ok(/if\(play\.on\)\{[\s\S]{0,200}remoteHost\.has = true;/.test(clientSrc),
	'in embodiment the host hero becomes a remote body — its vitals never clobber the guest');
assert.ok(/bridge\.drawHeroAt\(\{ x: b\.x, y: b\.y/.test(clientSrc), 'fellow embodied players render as hero bodies for everyone');

// --- Wave A: creatures target the WHOLE party (host + guest bodies) --------------------------------
// A guest used to be furniture the monsters ignored — only contact damage reached it.
// Now mobs aggro/pursue the nearest hero and route their damage to whoever they are
// actually attacking. Solo play stays a zero-cost path (no bodies → the old code).
{
	const m = mobsSrc2;
	assert.ok(/function nearestCoopBody\(wx,wy,range\)/.test(m)
		&& /const bodies=\(typeof MM!=='undefined' && MM\.coopBodies\) \|\| null;\s*\n\s*if\(!bodies \|\| !bodies\.length\) return null;/.test(m),
		'nearestCoopBody reads MM.coopBodies and early-returns with none (zero cost in solo play)');
	// the existing hero-vs-companion decision must be preserved verbatim, then the body competes
	const ct = m.slice(m.indexOf('function combatTargetForMob'), m.indexOf('function combatTargetForMob') + 1600);
	assert.ok(/if\(c2<h2\*1\.18 \|\| h2>R\*R\) target=cmp;/.test(ct), 'the companion-vs-hero bias is unchanged');
	assert.ok(/const body=nearestCoopBody\(m\.x,m\.y,R\);/.test(ct) && /if\(b2<t2\) target=\{x:body\.x, y:body\.y, kind:'coop', body\};/.test(ct),
		'a co-op body competes as another hero and the NEAREST candidate wins');
	// the damage chokepoint: a mob hunting a body damages the BODY, never the distant host
	assert.ok(/let _mobTargetBody=null;/.test(m), 'the per-mob target-body chokepoint exists');
	assert.ok(/_mobTargetBody=\(m\._combatTarget && m\._combatTarget\.kind==='coop'\) \? m\._combatTarget\.body : null;/.test(m)
		&& /updateMob\(m, spec, \{dt, now, aggressive: aggroNow[\s\S]{0,220}\}\);\s*\n\s*_mobTargetBody=null;/.test(m),
		'the chokepoint is set around updateMob and cleared after (host path untouched otherwise)');
	const dp = m.slice(m.indexOf('function damagePlayer'), m.indexOf('function damagePlayer') + 700);
	assert.ok(/if\(_mobTargetBody && typeof _mobTargetBody\.hurt==='function' && !_mobTargetBody\.dead\)\{\s*\n\s*_mobTargetBody\.hurt\(/.test(dp),
		'damagePlayer routes a hunting mob’s blow to the guest body (its own i-frames + vitals)');
	// projectiles catch on a guest body too, damaging the body not the host
	assert.ok(/const body=nearestCoopBody\(pr\.x,pr\.y,hitRadius\+0\.2\);[\s\S]{0,220}body\.hurt\(pr\.dmg/.test(m),
		'mob projectiles that strike a guest body damage the body, not the host');
}

// --- Wave A2: EVERY hostile system hunts the party; every friendly one protects it ------------------
// Guardians, invasions and turrets used to read only window.player. Now boss/sidekick
// attacks aim at (and their hazards hit-test) guest bodies, invader melee + hitscan
// chase the nearest party member, and player-built turrets stay awake for a guest with
// the host far away. Solo play stays a zero-cost path everywhere (no bodies → old code).
{
	// bodies advertise advisory velocity so party-aware attackers can lead their aim
	assert.ok(/entry\.bodyLike\.vx = b\.vx \|\| 0; entry\.bodyLike\.vy = b\.vy \|\| 0;/.test(hostSrc),
		'bodyLike carries advisory vx/vy (aim-lead only — never authority)');

	const g = readFileSync(new URL('../src/engine/guardian_lairs.js', import.meta.url), 'utf8');
	assert.ok(/function coopBodies\(\)\{\s*\n\s*const list=\(typeof MM!=='undefined' && MM\.coopBodies\)\|\|null;\s*\n\s*return \(list && list\.length\) \? list : null;/.test(g),
		'guardian_lairs reads MM.coopBodies with a null return when empty (zero cost in solo play)');
	assert.ok(/function nearestPartyTarget\(wx,wy,p\)/.test(g) && /if\(!bodies\) return p;/.test(g),
		'guardian aim selection falls back to the host with no bodies');
	// boss + sidekick attacks aim at the nearest party member; lifecycle stays host-anchored
	const gue = g.slice(g.indexOf('function updateEntity(e,p,getTile,setTile,dt)'), g.indexOf('function updateEntity(e,p,getTile,setTile,dt)') + 900);
	assert.ok(/const aim=nearestPartyTarget\(e\.x,e\.y,p\);/.test(gue)
		&& /updateFireBoss\(e,aim,getTile,dt,L\);/.test(gue) && /updateSidekick\(e,aim,getTile,setTile,dt,L\);/.test(gue),
		'guardian attacks aim at the NEAREST party member (host or guest body)');
	assert.ok(/updateContact\(e,p,dt\);\s*\n\s*updateContactBodies\(e\);/.test(gue)
		&& /if\(e\.ambient && p && Math\.abs\(e\.x-p\.x\)>120\) e\.dead=true;/.test(gue),
		'host contact/shove and the ambient-despawn lifecycle stay host-anchored; bodies get their own contact pass');
	assert.ok(/function updateContactBodies\(e\)\{/.test(g) && !/function updateContactBodies\(e\)\{[\s\S]{0,600}separateHeroFromEntity/.test(g),
		'guest bodies take contact damage but are never shoved (their movement is guest-authoritative)');
	// every hazard type hit-tests the guest bodies and routes through body.hurt()
	const guh = g.slice(g.indexOf('function updateHazards(dt,p,getTile,setTile)'), g.indexOf('function updateEffects'));
	assert.ok(/const coop=coopBodies\(\);/.test(guh), 'the hazard pass hoists the body list once per frame');
	for(const cause of ['guardian_lightning','guardian_storm_meteor','guardian_projectile','guardian_impact','guardian_beam','guardian_ring','guardian_blizzard']){
		assert.ok(new RegExp("(hurtBodiesInCircle\\(coop,[^\\n]*'" + cause + "'|b\\.hurt\\(h\\.dmg,[^\\n]*'" + cause + "'\\))").test(guh),
			'guardian hazard "' + cause + '" hit-tests guest bodies through body.hurt()');
	}
	assert.ok(!/hurtBodiesInCircle[\s\S]{0,400}setTile\(/.test(g.slice(g.indexOf('function hurtBodiesInCircle'), g.indexOf('function hurtBodiesInCircle') + 500)),
		'the body-damage helper touches creatures’ victims only — never a tile');

	const inv = readFileSync(new URL('../src/engine/invasions.js', import.meta.url), 'utf8');
	assert.ok(/function nearestPartyMember\(wx,wy,player\)\{\s*\n\s*const bodies=\(typeof MM!=='undefined' && MM\.coopBodies\) \|\| null;\s*\n\s*if\(!bodies \|\| !bodies\.length\) return player;/.test(inv),
		'invasions read MM.coopBodies and return the host untouched with no bodies (zero cost in solo play)');
	assert.ok(/function hurtPartyTarget\(tgt,dmg,opts\)\{\s*\n\s*if\(tgt && typeof tgt\.hurt==='function'\)\{ tgt\.hurt\(dmg,opts\.srcX,opts\.srcY,opts\.cause\); return; \}/.test(inv),
		'invader damage routes through body.hurt() for a guest target, damageHero for the host');
	assert.ok(/const tgt = nearestPartyMember\(a\.x,a\.y,player\);[\s\S]{0,200}const px = tgt && Number\.isFinite\(tgt\.x\) \? tgt\.x : a\.x;/.test(inv),
		'updateAlien tracks (melee + facing) the nearest party member');
	assert.ok(/hurtPartyTarget\(tgt, Math\.max\(1,Math\.round\(baseDmg \* \(Number\(a\.damageMult\) \|\| 1\)\)\)/.test(inv),
		'invader melee lands on whoever the alien is actually next to');
	// both hitscan weapons aim at and damage the retargeted party member
	assert.ok((inv.match(/const tgt = nearestPartyMember\(a\.x,a\.y,player\); \/\/ shots chase the nearest hero, host or guest/g) || []).length === 2,
		'both fireAlienLaser and fireMolekinAttack retarget to the nearest party member');
	assert.ok(/Number\.isFinite\(tgt\.vx\) \? tgt\.x \+ tgt\.vx \* 0\.08 : tgt\.x/.test(inv) && /Number\.isFinite\(tgt\.vx\) \? tgt\.x \+ tgt\.vx \* 0\.06 : tgt\.x/.test(inv),
		'hitscan aim-lead reads the target (host or body), not always the host');
	assert.ok(/hurtPartyTarget\(tgt, Math\.max\(1, Math\.round\(\(5 \+ Math\.min\(6, Math\.floor\(threat \/ 5\)\)\) \* dmgMult\)\)/.test(inv)
		&& /hurtPartyTarget\(tgt, Math\.max\(1, Math\.round\(\(4 \+ Math\.min\(7, Math\.floor\(threat \/ 4\)\)\) \* dmgMult\)\)/.test(inv),
		'a clear hitscan hit damages the aimed-at party member through the routing helper');
	// the squad brain marches on the party member nearest the squad, not blindly on the host
	assert.ok(/function squadPartyTarget\(steerable,player\)\{\s*\n\s*const bodies=\(typeof MM!=='undefined' && MM\.coopBodies\) \|\| null;\s*\n\s*if\(!bodies \|\| !bodies\.length \|\| !steerable\.length\) return player;/.test(inv),
		'the squad-brain retarget is zero-cost in solo play (host returned before any centroid math)');
	assert.ok(/brain\.update\(team, steerable, dt, squadPartyTarget\(steerable,player\), teamHooks\(team,player,getTile,setTile,ctx\), \{now\}\);/.test(inv),
		'the squad brain hunts the party member nearest the squad center');

	const tur = readFileSync(new URL('../src/engine/turrets.js', import.meta.url), 'utf8');
	assert.ok(/function coopBodyNear\(bodies,x,y\)\{\s*\n\s*if\(!bodies\) return false;/.test(tur),
		'turrets’ body proximity check early-returns with no bodies (zero cost in solo play)');
	assert.ok(/if\(hasPlayer && \(Math\.abs\(m\.x-px\)>ACTIVE_RX \|\| Math\.abs\(m\.y-py\)>ACTIVE_RY\) && !coopBodyNear\(coop,m\.x,m\.y\)\)\{/.test(tur),
		'a turret near an embodied guest stays awake even with the host far away');
	assert.ok(/if\(coop\) for\(const b of coop\)\{ if\(!b\.dead\) scanNearby\(b,getTile\); \}/.test(tur),
		'turret discovery also scans around guest bodies');
}

// --- Wave B: real guest weapons — host-resolved, body-attributed, creature-only ---------------------
// The strike stub grows into an arsenal: the guest NAMES an owned weapon and a world
// aim; the host checks ownership, cooldown and pouch ammo against ITS body state and
// resolves the blow through the real combat chains in weapons.js, attributed 'coop'.
// Nothing a guest fires may touch a tile, open a chest, or feed the host's ult.
{
	const w = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
	// melee resolves through the hero's own attackAt fan-out, credited 'coop'
	const cm = w.slice(w.indexOf('function coopMeleeAt'), w.indexOf('function spawnCoopArrow'));
	assert.ok(/meleeTargetTile\(body,aimX,aimY,reach,false\)/.test(cm), 'coop melee clamps its target into the weapon reach box');
	assert.ok(/MM\.mobs\.attackAt\(tx,ty,bonus,\{source:'coop'\}\)/.test(cm) && /MM\.invasions\.attackAt/.test(cm) && /MM\.guardianLairs\.attackAt/.test(cm),
		'coop melee runs the real creature chains with coop attribution');
	assert.ok(!/setTile\(|openChestFromWeaponHit\(|collectLooseTarget\(|addUltCharge\(|MM\.npcSystem\.|MM\.centerGuardian\./.test(cm),
		'coop melee: no tiles, no chests, no pickups, no host ult, no villagers, no center mimic');
	assert.ok(/noteCoopSwing\(tx,ty,tx>=px\?1:-1\)/.test(cm), 'a guest swing is visible (coop swing FX)');
	// arrows join the ONE shared projectile array, tagged for attribution
	const ca = w.slice(w.indexOf('function spawnCoopArrow'), w.indexOf('function ghostFxState'));
	assert.ok(/recoverable:false, coopOwner:true/.test(ca), 'a coop arrow is owner-tagged and never drops a host pickup');
	assert.ok(!/setTile/.test(ca), 'spawning a coop arrow touches no tile');
	// in-flight gates: attribution + no host ult + no chest opening + no glass breaking
	assert.ok(/source:a\.coopOwner\?'coop':'hero'/.test(w), 'arrow damage carries the owner as its source');
	assert.ok(/if\(!a\.coopOwner\) addUltCharge\(0\.08\);/.test(w), 'only the hero’s own shots feed the hero’s ult');
	assert.ok(/!a\.spent && !a\.coopOwner && openChestFromWeaponHit/.test(w), 'a coop arrow cannot open the host’s chests');
	assert.ok(/!a\.coopOwner && t===T\.GLASS && shatterGlassAt/.test(w), 'a coop arrow cannot break glass (combat edits no tile)');
	// the FX mirror carries per-body swings; the watcher-side step stays damage-free
	assert.ok(/st\.cw=coopSwings\.map/.test(w) && /coopSwings\.length=0;\s*\n\s*for\(const s of \(Array\.isArray\(st\.cw\)/.test(w),
		'coop swings stream through the weapon-FX mirror and are rebuilt sanitized');
	assert.ok(/coopMeleeAt,spawnCoopArrow,/.test(w), 'the two coop entry points are published on MM.weapons');
	// a coop blow provokes like the hero's, but pays no hero-power bookkeeping
	const nds = mobsSrc2.slice(mobsSrc2.indexOf('function noteDamageSource'), mobsSrc2.indexOf('function nearestCompanionTarget'));
	assert.ok(/String\(opts\.source\|\|''\)==='coop'\)\{[\s\S]{0,300}markHeroAttack\(m\);/.test(nds)
		&& !/String\(opts\.source\|\|''\)==='coop'\)\{[\s\S]{0,300}_heroPowerSeen/.test(nds),
		'a coop hit provokes retaliation without feeding hero-threat profiling');
	// host authority: ownership, cooldown and ammo are HOST state
	assert.ok(/weapons: NET\.PLAY_STARTER_WEAPONS\.slice\(\),\s*\n\s*pouch: Object\.assign\(\{\}, NET\.PLAY_STARTER_AMMO\)/.test(hostSrc),
		'the body spawns with the starter arsenal and starter ammo (host state)');
	assert.ok(/NET\.validPlayWeapon\(key\) && Array\.isArray\(b\.weapons\) && b\.weapons\.includes\(key\)/.test(hostSrc),
		'an attack intent must name a weapon the body actually OWNS');
	assert.ok(/Math\.max\(NET\.PLAY_RULES\.ATTACK_MS, spec\.cdMs\)/.test(hostSrc), 'per-weapon cooldown stacks on the global floor');
	assert.ok(/if\(!\(Number\(b\.pouch\[spec\.ammo\]\) > 0\)\)/.test(hostSrc) && /NET\.pouchTake\(b\.pouch, spec\.ammo, 1\);/.test(hostSrc),
		'ranged fire spends ammo from the host-owned pouch before anything flies');
	assert.ok(/bridge\.ghostPlayAttack\(\{ x: b\.x, y: b\.y, facing: b\.f < 0 \? -1 : 1, gid: entry\.gid, duelWith: b\.duelWith \|\| null \}, spec, ax, ay\)/.test(hostSrc),
		'the blow originates at the HOST-tracked body pose (with host-stamped duel identity), never a client claim');
	assert.ok(/sendDeed\(entry, 'hit', 1\); \/\/ guest marksmanship pays guest XP/.test(hostSrc),
		'landed guest hits pay guest progression XP, not host progression');
	// tool parity: the mine tick need derives from the real tile hardness
	assert.ok(/bridge\.ghostPlayMineTicks \? \(bridge\.ghostPlayMineTicks\(tx, ty\) \| 0\) : 0;/.test(hostSrc)
		&& /Math\.min\(NET\.PLAY_RULES\.MINE_TICKS_MAX, derived\)/.test(hostSrc),
		'mine ticks come from the hardness seam, clamped, with the flat rule as fallback');
	assert.ok(/ghostPlayMineTicks:\(tx,ty\)=>\{/.test(mainSrc) && /const seconds=hp\/6\/tools\.basic;/.test(mainSrc),
		'the hardness seam obeys the same INFO.hp/6 law as the local miner');
	const gpa = mainSrc.slice(mainSrc.indexOf('ghostPlayAttack:'), mainSrc.indexOf('ghostPlayMineTicks:'));
	assert.ok(/coopMeleeAt/.test(gpa) && /spawnCoopArrow/.test(gpa) && !/setTile\(/.test(gpa),
		'the bridge attack seam resolves through weapons.js and touches no tile');
	// client: the chips only NAME an owned weapon; the wire carries float aim for arrows
	assert.ok(/\(a === 'attack' \|\| a === 'pickup'\)\s*\n?\s*\? \{ t: 'pact', a, x: \+Number\(wx\)\.toFixed\(1\), y: \+Number\(wy\)\.toFixed\(1\) \}/.test(clientSrc),
		'attack and pickup intents aim at world floats (tile intents stay integer cells)');
	assert.ok(/sendPlayAct\('attack', w\.x, w\.y, play\.arm \|\| 'fists'\);/.test(clientSrc),
		'LMB in open air swings/shoots the ARMED weapon');
	assert.ok(/play\.weapons = Array\.isArray\(pl\.weapons\)/.test(clientSrc) && /function renderArms\(\)/.test(clientSrc),
		'the arsenal chips render from host-streamed pvit truth');
	assert.ok(/_playArm: \(key\) => \{ play\.arm = key; renderArms\(\); \}/.test(clientSrc), 'the QA arm seam exists');
}

// --- Wave C: guest crafting + host-kept persistence -------------------------------------------------
// A guest crafts from ITS OWN pouch into its own pouch/arsenal — the host inventory
// is never touched, costs are spent atomically host-side. PERSISTENCE DECISION
// (pinned): authoritative body state (pouch + earned arsenal) lives in HOST-side
// storage keyed by the guest's stable, self-claimed gid; the client holds only the
// key. No storage → sessions are explicitly ephemeral. Disk is read as hostile
// input even on the host's own machine (the normalizeProgress rule).
{
	// stable identity: tab-first (sessionStorage survives a reload, never leaks into
	// a sibling tab), then the browser base gid gated by a live-tab lease — two tabs
	// sharing one gid would boot each other through the host's newest-wins rule
	assert.ok(/const tab = sessionStorage\.getItem\(NET\.GID_KEY\);/.test(clientSrc) && /\^g\[a-z0-9\]\{8,14\}\$/.test(clientSrc),
		'the client gid is tab-stable across reloads and validated against its own shape');
	assert.ok(/const held = !!\(lease && lease\.gid === base && \(Date\.now\(\) - \(Number\(lease\.ts\) \|\| 0\)\) < NET\.GID_LEASE_MS\);/.test(clientSrc)
		&& /const mine = held \? gidMint\(\) : base;/.test(clientSrc),
		'a sibling tab holding the base identity forces a fresh gid (no self-boot collision)');
	assert.ok(/if\(!WATCH\) return gidMint\(\);/.test(clientSrc), 'host pages never write the ghost identity keys');
	assert.ok(/localStorage\.getItem\(NET\.GID_KEY\) === gid\) localStorage\.setItem\(NET\.GID_LEASE_KEY/.test(clientSrc),
		'only the base-identity owner heartbeats the lease');
	assert.ok(/catch\(e\)\{ return gidMint\(\); \}/.test(clientSrc),
		'no storage → a session-scoped gid (ephemeral is a feature, not a crash)');
	// the craft intent: recipe whitelist, owned-weapon dedup, atomic pouch spend
	assert.ok(/pl\.a === 'craft'/.test(hostSrc) && /NET\.validPlayRecipe\(key\) \? NET\.PLAY_RECIPES\[key\] : null;/.test(hostSrc),
		'craft intents resolve only against the curated recipe whitelist');
	assert.ok(/if\(r\.weapon && Array\.isArray\(b\.weapons\) && b\.weapons\.includes\(r\.weapon\)\)/.test(hostSrc),
		'an already-earned weapon cannot be crafted twice');
	assert.ok(/if\(!NET\.pouchSpend\(b\.pouch, r\.cost\)\)/.test(hostSrc) && /reason: 'cost', key \}\); return; \}/.test(hostSrc),
		'costs are checked and spent atomically against the HOST-owned pouch');
	assert.ok(/sendDeed\(entry, 'craft', 1\);/.test(hostSrc), 'a craft pays the guest its own career XP');
	// persistence: host-side store, hostile-input restore, banked at every exit
	assert.ok(/const BODY_KEEP_KEY = 'mm_ghost_bodies_v1';/.test(hostSrc), 'the host-side body store key is pinned');
	assert.ok(/restoreBodyFor\(entry\.gid, entry\.body\);/.test(hostSrc), 'a returning gid gets its kept body back on spawn');
	assert.ok(/body\.pouch = \{\};[\s\S]{0,300}NET\.pouchAdd\(body\.pouch, k, n\);/.test(hostSrc),
		'the kept pouch REPLACES the starter pouch (no rejoin ammo farming) and re-clamps every count');
	assert.ok(/if\(NET\.validPlayWeapon\(k\) && !body\.weapons\.includes\(k\)\) body\.weapons\.push\(k\);/.test(hostSrc),
		'kept weapons pass the arsenal whitelist again on restore (disk is hostile input)');
	assert.ok(/function despawnBody\(s, entry\)\{\s*\n\s*if\(!entry\.body\) return;\s*\n\s*endDuel\(s, entry, true\);[^\n]*\n\s*keepBody\(entry\);/.test(hostSrc),
		'demote/leave forfeits any duel and banks the body');
	assert.ok(/if\(entry\.body\) keepBody\(entry\); \/\/ a vanished player/.test(hostSrc), 'a dropped connection banks the body');
	assert.ok(/keepAllBodies\(s\); \/\/ slow-cadence flush/.test(hostSrc) && /keepAllBodies\(session\); \/\/ ending the stream/.test(hostSrc),
		'the reap tick and session stop both flush every live body');
	assert.ok(/keepBody\(entry\); \/\/ earned gear is banked the moment it exists/.test(hostSrc), 'a successful craft banks immediately');
	// client: chips only SEND the intent; affordability is a display-only mirror
	assert.ok(/function renderCraft\(\)/.test(clientSrc) && /sendPlayAct\('craft', 0, 0, key\);/.test(clientSrc),
		'craft chips exist and only point at a recipe');
	assert.ok(/const afford = NET\.pouchAfford\(play\.pouch, r\.cost\); \/\/ display-only mirror/.test(clientSrc),
		'client-side affordability is cosmetic — the host re-checks');
	assert.ok(/_playCraft: \(key\) => sendPlayAct\('craft', 0, 0, key\),/.test(clientSrc), 'the QA craft seam exists');
}

// --- Wave D (part 1): the world is a hazard for guest bodies too ------------------------------------
// Drowning and lava run HOST-side against world truth (bridge.getTile) through the
// hero's own laws — SURVIVAL.updateDrowning with the same grace/ramp/cap, lava's
// same 8 — and land through hurtBody, the ONE damage inlet. No client field is
// consulted: a rigged guest can hold its breath only in its own UI. The hero takes
// NO fall damage in this game, so neither does a guest (parity, not an omission).
{
	const sp = hostSrc.slice(hostSrc.indexOf('function bodySurvivalPass'), hostSrc.indexOf('function bodyTick'));
	assert.ok(/SURV\.updateDrowning\(b\.drownSt, dt, headTile === TT\.WATER\)/.test(sp),
		'drowning runs the REAL survival law against a host-read head tile');
	assert.ok(/const dmg = Math\.min\(12, res\.damage\);/.test(sp) && /hurtBody\(s, entry, dmg, NaN, NaN, 'drowning'\);/.test(sp)
		&& /SURV\.consumeDrowningDamage\(b\.drownSt, dmg\)/.test(sp),
		'drown damage is capped like the hero’s, lands through hurtBody, and is consumed from the bank');
	assert.ok(/hurtBody\(s, entry, 8, b\.x, b\.y \+ 1, 'lava'\);/.test(sp), 'lava sears a body with the hero’s own 8');
	assert.ok(!/pl\.|entry\.cam|\.claim/.test(sp.replace(/entry\.peer\.send|entry, b, dt, t|entry, dmg|entry, 8/g, '')),
		'the survival pass reads no client-claimed field — world truth only');
	assert.ok(/if\(!b\.dead && dt > 0\) bodySurvivalPass\(s, entry, b, dt, t\);/.test(hostSrc),
		'the pass runs on the body cadence for LIVE bodies only');
	assert.ok(/MMR\.survival\.resetDrowning\) MMR\.survival\.resetDrowning\(b\.drownSt\);/.test(hostSrc),
		'a respawned body starts with fresh lungs');
	assert.ok(/pl\.t === 'pdrown'/.test(clientSrc) && /Brakuje powietrza/.test(clientSrc),
		'the guest hears the breath warning (display only — damage arrives via pvit/pdmg)');
}

// --- Wave D (part 2): the guest metabolism — scavenge, eat, chill, freeze, scorch -------------------
// Pickups close the loot/food loop (a guest's own kills drop meat it can now
// scoop), eating heals from the host-owned pouch, and the remaining survival
// laws (swim chill, thermal exposure) run per body through the hero's own state
// machines — world truth only, host caps, hurtBody routing.
{
	// pickups: resources only, fog-gated with the shared map, removed atomically
	const pk = mainSrc.slice(mainSrc.indexOf('ghostPlayPickupAt:'), mainSrc.indexOf('ghostPlayThermalMode:'));
	assert.ok(/if\(info\.kind!=='resource'\) return \{ok:false, reason:'kind'\};/.test(pk),
		'gear, chests and jewels stay the host’s economy — a guest scoops resources only');
	assert.ok(/visible:\(x,y\)=>worldTileDiscovered\(x,y\)/.test(pk), 'pickups are fog-gated with the SAME shared-map visibility');
	assert.ok(/if\(!info\.inReach\) return \{ok:false, reason:'far'\};/.test(pk) && /if\(!D\.remove\(info\.id\)\) return \{ok:false, reason:'gone'\};/.test(pk),
		'reach is measured against the host-tracked body and the drop is removed before crediting');
	assert.ok(/bridge\.ghostPlayPickupAt \? bridge\.ghostPlayPickupAt\(ax, ay, \{ x: b\.x, y: b\.y \}\) : null;/.test(hostSrc),
		'the pickup intent hands the bridge the HOST-tracked body, never a client claim');
	// eating: whitelist, pouch spend, host-capped heal
	assert.ok(/const food = NET\.validPlayFood\(key\) \? NET\.PLAY_FOODS\[key\] : null;/.test(hostSrc)
		&& /if\(!NET\.pouchTake\(b\.pouch, key, 1\)\)/.test(hostSrc)
		&& /b\.hp = Math\.min\(b\.maxHp, b\.hp \+ Math\.max\(1, Number\(food\.hp\) \|\| 1\)\);/.test(hostSrc),
		'eating spends the pouch and heals host-side, capped at max hp');
	// swim chill + thermal: the hero's own laws, caps and causes
	const sp2 = hostSrc.slice(hostSrc.indexOf('function bodySurvivalPass'), hostSrc.indexOf('function bodyTick'));
	assert.ok(/SURV\.updateSwimChill\(b\.chillSt, dt, swimming\)/.test(sp2) && /Math\.min\(8, ch\.damage\); \/\/ the hero's own per-tick cap/.test(sp2)
		&& /hurtBody\(s, entry, dmg, NaN, NaN, 'water_chill'\);/.test(sp2),
		'swim chill runs the hero law per body (cap 8, water_chill, through hurtBody)');
	assert.ok(/const swimming = midTile === TT\.WATER && bridge\.getTile\(Math\.floor\(b\.x\), Math\.floor\(b\.y \+ 1\)\) === TT\.WATER;/.test(sp2),
		'a body standing on the bottom is not swimming (deep-water rule, world truth)');
	assert.ok(/bridge\.ghostPlayThermalMode\(b\.x, b\.y, midTile === TT\.WATER\)/.test(sp2)
		&& /Math\.min\(6, th\.damage\); \/\/ the hero's own per-tick cap/.test(sp2)
		&& /th\.mode === 'cold' \? 'deep_frost' : 'heat_stroke'/.test(sp2),
		'thermal exposure samples the env at the BODY and pays the hero causes/caps');
	assert.ok(/SURVIVAL\.thermalExposureMode\(\{climate, temp, sheltered, inWater:!!inWater, nearWarmth: heroNearWarmth\(cx, cy\)\}\);/.test(mainSrc),
		'the thermal seam builds the SAME env the host samples for itself');
	assert.ok(/resetSwimChill\(b\.chillSt\);/.test(hostSrc) && /resetThermal\(b\.thermSt\);/.test(hostSrc)
		&& /resetWaterPressure\(b\.pressSt\);/.test(hostSrc),
		'a respawned body starts warm, dry and decompressed');
	// deep-water pressure: the hero's own stack law, caps and implosion rule
	assert.ok(/SURV\.updateWaterPressure\(b\.pressSt, dt, stack, 0, headCovered\)/.test(hostSrc),
		'water pressure runs the hero law with the BASE crush capacity (guests carry no Twardość)');
	assert.ok(/pr\.implode \? Math\.max\(b\.maxHp \+ 20, pr\.damage\) : Math\.min\(24, pr\.damage\); \/\/ the hero's own caps/.test(hostSrc)
		&& /if\(pr\.implode\) b\.invulUntil = 0;/.test(hostSrc) && /hurtBody\(s, entry, dmg, NaN, NaN, 'water_pressure'\);/.test(hostSrc),
		'pressure damage pays the hero caps, implosion ignores i-frames, all through hurtBody');
	assert.ok(/ghostPlayWaterStack:\(x,headY\)=>\{/.test(mainSrc) && /return waterStackAboveY\(Math\.floor\(x\), headY\);/.test(mainSrc),
		'the stack seam reuses the hero’s own partial-aware column computation');
	assert.ok(/pl\.k === 'pressure'/.test(clientSrc), 'the guest hears the pressure warning');
	// lag-compensated reconciliation: the echo answers a SPECIFIC claim
	assert.ok(/conn\.send\(\{ t: 'ppose', q: poseSeq,/.test(clientSrc) && /poseLog\.push\(\{ seq: poseSeq, x: p\.x, y: p\.y \}\);/.test(clientSrc),
		'every pose uplink carries a sequence and logs the claim it made');
	assert.ok(/b\.poseSeq = \(Number\(pl\.q\) >>> 0\) \|\| 0;/.test(hostSrc) && /b\.dead \? 1 : 0, b\.poseSeq \|\| 0\]\);/.test(hostSrc),
		'the host sanitizes the seq and echoes it in the own pb row');
	assert.ok(/const pastIdx = seq \? poseLog\.findIndex\(e => e\.seq === seq\) : -1;/.test(clientSrc)
		&& /if\(err > 8\)\{ p\.x = \+bx; p\.y = \+by; stats\.poseSnaps/.test(clientSrc)
		&& /if\(bridge\.solidAt\(Math\.floor\(nx\), Math\.floor\(ny\), 'y'\)\)\{ p\.x = \+bx; p\.y = \+by;/.test(clientSrc)
		&& /else \{ p\.x = nx; p\.y = ny; stats\.poseFixes/.test(clientSrc),
		'divergence is measured against the MATCHING claim: exact correction (embed-guarded), gross snap, dead zone');
	assert.ok(/no matching claim \(old host, rotated log\): gross fallback/.test(clientSrc),
		'a host that echoes nothing still gets the old gross-divergence fallback');
	assert.ok(/poseLog\.length = 0; \/\/ pre-respawn claims answer nothing anymore/.test(clientSrc),
		'a respawn clears the claim log (stale echoes must not correct a teleported hero)');
	// sub-tile water windows: host reads the ledger, watcher applies display-only
	const wsrc2 = readFileSync(new URL('../src/engine/water.js', import.meta.url), 'utf8');
	assert.ok(/function ghostPartialsIn\(x0,y0,x1,y1,out\)/.test(wsrc2) && /out\.length<400/.test(wsrc2),
		'the host-side window read is bounded');
	assert.ok(/function ghostApplyPartialsWindow\(x0,y0,x1,y1,list\)/.test(wsrc2)
		&& /for\(let x=ax; x<=bx; x\+\+\) for\(let y=ay; y<=by; y\+\+\) partial\.delete\(LPK\(x,y\)\);/.test(wsrc2)
		&& /if\(!\(u>=1 && u<UNITS\)\) continue;/.test(wsrc2),
		'the watcher-side apply clears the window first and clamps every entry (display-only)');
	assert.ok(/ghostPartialsIn, ghostApplyPartialsWindow,/.test(wsrc2), 'both window functions are published on MM.water');
	assert.ok(/function pwatTick\(s, t\)/.test(hostSrc) && /if\(!any && !s\.pwatWas\) return;/.test(hostSrc)
		&& /if\(any && sig === s\.lastPwatSig\) return;/.test(hostSrc),
		'the pwat plane latches (a clearing packet follows the last wet one) and sig-skips duplicates');
	assert.ok(/pl\.t === 'pwat'/.test(clientSrc) && /W\.ghostApplyPartialsWindow\(\+w\[0\], \+w\[1\], \+w\[2\], \+w\[3\], w\[4\]\);/.test(clientSrc),
		'the watcher applies streamed windows through the bounded water seam');
	// per-body statuses: the hero's OWN state machine, one instance per body
	const hs = readFileSync(new URL('../src/engine/hero_status.js', import.meta.url), 'utf8');
	assert.ok(/function createState\(\)/.test(hs) && /function applyTo\(s,kind,opts\)/.test(hs) && /function updateState\(s,dt,env\)/.test(hs)
		&& /createState, applyTo, updateState, isFrozenState, moveMultOf, damageInMultOf/.test(hs),
		'hero_status exposes its pure core (the singleton wraps it with hero-only fx/notes)');
	assert.ok(/const r=applyTo\(st,kind,opts\);/.test(hs) && /const r=updateState\(st,dt,env\);/.test(hs),
		'the hero singleton delegates to the SAME core the bodies run (no law drift)');
	assert.ok(/if\(inWater\) HS\.applyTo\(b\.statusSt, 'wet', \{ dur: 8 \}\);/.test(hostSrc)
		&& /HS\.applyTo\(b\.statusSt, 'burn', \{\}\);/.test(hostSrc)
		&& /if\(b\.thermMode === 'cold'\) HS\.applyTo\(b\.statusSt, 'chill', \{ dur: 2 \}\);/.test(hostSrc),
		'water soaks, flame ignites (fizzling on a soaked body), deep-frost air chills');
	assert.ok(/HS\.updateState\(b\.statusSt, dt, \{ deepFrost: b\.thermMode === 'cold', nearWarmth: false, inWater \}\)/.test(hostSrc),
		'the freeze combo runs the hero law per body');
	assert.ok(/hurtBody\(s, entry, st\.burnDamage, NaN, NaN, 'burn_dot'\);/.test(hostSrc), 'the burn dot lands through hurtBody');
	assert.ok(/MMR\.heroStatus\.isFrozenState\(b\.statusSt\)\)\{\s*\n\s*entry\.peer\.send\(\{ t: 'pactAck', a: pl\.a, ok: false, reason: 'frozen' \}\);/.test(hostSrc),
		'a flash-frozen body cannot act — EVERY intent bounces until the thaw');
	assert.ok(/amt = amt \* MMR\.heroStatus\.damageInMultOf\(b\.statusSt, 'electric'\);/.test(hostSrc),
		'a soaked body conducts electricity by the hero multiplier');
	assert.ok(/b\.statusSt = MMR\.heroStatus\.createState\(\); b\.lastStatusSig = -1;/.test(hostSrc), 'a respawned body thaws and dries');
	assert.ok(/pl\.t === 'pstat'/.test(clientSrc) && /HSc\._state\.frozen = Math\.max\(0, Math\.min\(10, Number\(pl\.f\) \|\| 0\)\);/.test(clientSrc),
		'the guest mirrors the chips into its local singleton, clamped (display truth only)');
	assert.ok(/if\(statusMult <= 0\) dir = 0;/.test(clientSrc) && /const wantJump = statusMult > 0 &&/.test(clientSrc),
		'the guest feel honors frozen/chill locally (the host enforces the intents regardless)');
	// client: food chips EAT, drops route to pickup, warnings are display-only
	assert.ok(/if\(food\)\{ sendPlayAct\('eat', 0, 0, k\); return; \}/.test(clientSrc), 'a food chip eats on click');
	assert.ok(/if\(hov && hov\.kind === 'resource'\)\{ sendPlayAct\('pickup', w\.x, w\.y\); return; \}/.test(clientSrc),
		'a click on a replicated drop routes to a pickup intent (the host re-validates)');
	assert.ok(/pl\.t === 'pwarn'/.test(clientSrc) && /Woda wychładza/.test(clientSrc), 'survival warnings reach the guest as toasts');
	// sibling tabs share the career key: writes MERGE monotonically so a throttled
	// background tab's late flush can never erase this tab's fresher earnings
	assert.ok(/m\.counts\[k\] = Math\.max\(m\.counts\[k\] \|\| 0, d\.counts\[k\]\);/.test(clientSrc)
		&& /m\.xp = Math\.max\(m\.xp, d\.xp\);/.test(clientSrc) && /prog = m;/.test(clientSrc),
		'the profile flush merges with the on-disk sibling state (monotone, loss-free)');
}

// --- Wave F: reliability is a feature ----------------------------------------------------------------
// A frozen world and an eternal spinner are the two silent failure modes of P2P
// co-op. Both now get honest words: the host self-reports a backgrounded tab on
// the presence plane, and a join that never lands earns a verdict + retry.
{
	assert.ok(/if\(!fromPump\) s\.lastSimAt = t;/.test(hostSrc), 'the host tracks sim liveness (only the rAF loop stamps it)');
	assert.ok(/frame\(0\.25, now\(\), true\)/.test(hostSrc), 'the host pump declares itself when driving the frame');
	assert.ok(/broadcast\(\{ t: 'ghosts', list, idle: \(t - \(s\.lastSimAt \|\| t\)\) > 1500 \? 1 : 0 \}\);/.test(hostSrc),
		'a backgrounded host self-reports idle on the presence plane');
	assert.ok(/STUN/.test(hostSrc), 'the invite panel documents the STUN-only NAT limitation');
	assert.ok(/hostIdle = !!pl\.idle;/.test(clientSrc) && /function updateStaleBanner\(\)/.test(clientSrc)
		&& /const stale = state === 'live' && \(hostIdle \|\| \(lastHostMsgAt > 0 && nowMs\(\) - lastHostMsgAt > 8000\)\);/.test(clientSrc),
		'the watcher banner rises on host-idle or an 8 s stream gap, and only while live');
	assert.ok(/pointer-events:none/.test(clientSrc), 'the banner never eats input');
	assert.ok(/lastHostMsgAt = nowMs\(\); \/\/ any traffic proves the stream is alive/.test(clientSrc),
		'every host message refreshes the liveness stamp');
	assert.ok(/t - bootAt > 25000/.test(clientSrc) && /gvRetry/.test(clientSrc) && /location\.reload\(\)/.test(clientSrc),
		'a join that never lands gets an honest verdict + retry after 25 s');
	assert.ok(/_debugAgeJoin: \(\) => \{ bootAt = 1; \}/.test(clientSrc), 'the QA join-aging seam exists');
}

// --- Wave E: the owner's design rulings, implemented and pinned --------------------------------------
// PvP: duels by CONSENT only. Trading: host gifts only. Fog: shared (the guest
// replica reveals into the host-mirrored fog — nothing to build, pinned as the
// standing contract below).
{
	// duels: mutual handshake, host-arbitrated, melee only, bodies only
	assert.ok(/const back = s\.duelAsks\.get\(te\.gid \+ '>' \+ entry\.gid\);/.test(hostSrc)
		&& /s\.duelAsks\.set\(entry\.gid \+ '>' \+ te\.gid, tD\);/.test(hostSrc),
		'a duel starts ONLY when both sides asked for each other (mutual consent)');
	assert.ok(/if\(b\.duelWith \|\| te\.body\.duelWith\)/.test(hostSrc), 'a busy duelist cannot be challenged');
	const duelPass = hostSrc.slice(hostSrc.indexOf('let duelHit = 0;'), hostSrc.indexOf('let duelHit = 0;') + 900);
	assert.ok(/if\(spec\.melee && b\.duelWith\)\{/.test(duelPass) && /e\.body\.duelWith !== entry\.gid\) break; \/\/ symmetry or nothing/.test(duelPass),
		'duel damage requires a melee weapon AND symmetric consent on both bodies');
	assert.ok(/hurtBody\(s, e, Math\.max\(1, 2 \+ spec\.dmg\), b\.x, b\.y, 'duel'\);/.test(duelPass),
		'a duel blow lands through hurtBody with the weapon’s own damage');
	assert.ok(!/bridge\.player|damageHero/.test(duelPass), 'the HOST hero is never a duel target');
	assert.ok(/if\(b\.duelWith && session\) endDuel\(session, entry\); \/\/ death settles a duel/.test(hostSrc)
		&& /endDuel\(s, entry, true\); \/\/ a demoted\/leaving duelist forfeits quietly/.test(hostSrc),
		'death, demotion and leaving all end the duel');
	assert.ok(/tD - ts > NET\.PLAY_RULES\.DUEL_TTL_MS\) s\.duelAsks\.delete\(k\);/.test(hostSrc), 'stale challenges expire');
	assert.ok(/function sendDuel\(targetGid\)/.test(clientSrc) && /_playDuel: \(targetGid\) => sendDuel\(targetGid\),/.test(clientSrc),
		'the client only REGISTERS consent — the host decides everything');
	// gifting: host-authoritative end to end, resources leave the host inventory first
	assert.ok(/function giftResource\(gid, key, n\)/.test(hostSrc) && /bridge\.ghostGiftTake \? bridge\.ghostGiftTake\(key, count\) : null;/.test(hostSrc),
		'a gift must really leave the HOST inventory before the pouch is credited');
	assert.ok(/Math\.min\(NET\.PLAY_RULES\.GIFT_MAX, Math\.floor\(Number\(n\) \|\| 0\)\)/.test(hostSrc), 'gift size is bounded');
	assert.ok(/ghostGiftTake:\(key,n\)=>\{/.test(mainSrc) && /const def=RESOURCE_DEFS\.find\(r=>r\.key===key\);/.test(mainSrc)
		&& /if\(!\(\(inv\[key\]\|0\) >= count\)\) return \{ok:false, reason:'cost'\};/.test(mainSrc),
		'the bridge seam whitelists the key and refuses what the host does not own');
	assert.ok(!/pouchTake/.test(hostSrc.slice(hostSrc.indexOf('function giftResource'), hostSrc.indexOf('function giftResource') + 1200)),
		'gifting never debits the GUEST pouch — only the host gives');
	// shared fog: the standing contract — the guest replica reveals into the
	// host-mirrored fog through the normal reveal path; no per-guest fog exists
	assert.ok(/bridge\.revealAround\(\);/.test(clientSrc), 'shared fog: the guest reveals through the one normal reveal path');
	assert.ok(!/fogPerGuest|guestFog|fogByGid/.test(clientSrc + hostSrc), 'no per-guest fog layer exists (owner ruling: shared)');
	// cosmetics: remote co-op bodies render through the REAL hero painter but
	// without the host's personal gear and effects
	assert.ok(/const remoteBody=!!\(opts&&opts\.remoteBody\);/.test(mainSrc)
		&& /if\(!remoteBody && NECKLACE && NECKLACE\.drawBack\)/.test(mainSrc)
		&& /if\(!remoteBody && NECKLACE && NECKLACE\.drawFront\)/.test(mainSrc)
		&& /if\(!remoteBody && HERO_LAMP && HERO_LAMP\.isOn\(\)\)/.test(mainSrc)
		&& /if\(!remoteBody && energyChargeFx\.t>0\.01\)/.test(mainSrc),
		'the host’s necklace, lamp beam and charge aura never bleed onto remote bodies');
	// per-body look: every gid-tagged remote body wears its own deterministic tint,
	// derived locally on each renderer (no wire data, no forgeable claim)
	assert.ok(/const savedCust=MM\.customization;/.test(mainSrc)
		&& /'hsl\('\+\(h%360\)\+',68%,55%\)'/.test(mainSrc)
		&& /finally\{ MM\.customization=savedCust;/.test(mainSrc),
		'remote bodies wear a gid-derived outfit tint, restored in finally');
	assert.ok(/gid: entry\.gid, look: entry\.look \|\| null \}\);/.test(hostSrc) && /gid: b\.id, look: looks\[b\.id\] \|\| null \}\);/.test(clientSrc),
		'both body painters tag the gid AND the chosen look so every renderer paints the same player the same way');
	// the chosen look: guest-picked, HOST-validated strict hex, relayed + late-joiner
	// synced, persisted client-side like the avatar — display-only end to end
	assert.ok(/pl\.t === 'plook'/.test(hostSrc) && /entry\.body && NET\.validLookColor\(pl\.c\) && tL - \(entry\.lastLookAt \|\| 0\) >= NET\.PLAY_RULES\.LOOK_MS/.test(hostSrc),
		'a look change is embodied-only, strict-hex validated and rate-floored on the host');
	assert.ok(/if\(other !== entry && other\.look\)\{ try\{ entry\.peer\.send\(\{ t: 'plook', gid: other\.gid, c: other\.look \}\)/.test(hostSrc),
		'a late joiner receives every known look right after the snapshot');
	assert.ok(/if\(typeof pl\.gid === 'string' && pl\.gid && NET\.validLookColor\(pl\.c\)\)/.test(clientSrc),
		'the client re-validates relayed looks (defense in depth) before painting with them');
	assert.ok(/typeof st\.look==='string' && \/\^#\[0-9a-f\]\{6\}\$\/i\.test\(st\.look\)/.test(mainSrc),
		'the painter accepts only strict hex for a chosen look (it reaches fillStyle)');
	assert.ok(/_playLook: \(c\) => setLook\(c\),/.test(clientSrc), 'the QA look seam exists');
	// weapon grants: whitelist-bound, deduped, free (templates are not host stock)
	const gw = hostSrc.slice(hostSrc.indexOf('function giftWeapon'), hostSrc.indexOf('function giftResource'));
	assert.ok(/if\(!NET\.validPlayWeapon\(key\)\)/.test(gw) && /if\(te\.body\.weapons\.includes\(key\)\)/.test(gw),
		'a weapon grant validates the arsenal whitelist and never duplicates');
	assert.ok(!/pouch/.test(gw), 'granting a weapon touches no pouch on either side');
	// gravestones: death spills the pouch as PHYSICAL drops at the death spot;
	// the earned arsenal survives; the banked pouch reflects the loss
	const gv = hostSrc.slice(hostSrc.indexOf('function dropPouchAt'), hostSrc.indexOf('function dropPouchAt') + 1200);
	assert.ok(/D\.spawnResource\(b\.x, b\.y - 0\.2, k, n\); spilled = true;/.test(gv) && /delete b\.pouch\[k\];/.test(gv),
		'the pouch spills where the hero fell and is emptied');
	assert.ok(/keepBody\(entry\); \/\/ the banked pouch must reflect the loss/.test(gv), 'a rejoin cannot resurrect the spilled pouch');
	assert.ok(!/weapons/.test(gv), 'the earned arsenal survives death (weapons are identity, resources are cargo)');
	assert.ok(/dropPouchAt\(s, entry, b\); \/\/ the gravestone rule/.test(hostSrc), 'death triggers the gravestone rule');
	// duel arrows: host-stamped identity at fire time, consent re-verified at impact
	const wsrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
	assert.ok(/ownerGid:\(typeof opts\.ownerGid==='string'\)\?opts\.ownerGid\.slice\(0,20\):null,/.test(wsrc)
		&& /duelGid:\(typeof opts\.duelGid==='string'\)\?opts\.duelGid\.slice\(0,20\):null/.test(wsrc),
		'a coop arrow carries HOST-stamped owner/duel identity');
	const da = wsrc.slice(wsrc.indexOf('// consensual duel arrows'), wsrc.indexOf('const creatureGate'));
	assert.ok(/if\(bb\.gid !== a\.duelGid \|\| bb\.dead \|\| typeof bb\.hurt!=='function'\) continue;/.test(da)
		&& /if\(bb\.duelWith !== a\.ownerGid\) break; \/\/ symmetry or nothing/.test(da)
		&& /bb\.hurt\(a\.dmg, a\.x, a\.y, 'duel'\);/.test(da),
		'a duel arrow wounds only the consenting partner body, symmetry checked at impact');
	assert.ok(!/damageHero|bridge\.player/.test(da), 'a duel arrow can never touch the host hero');
	assert.ok(/entry\.bodyLike\.duelWith = b\.duelWith \|\| null;/.test(hostSrc) && /entry\.bodyLike = \{ gid: entry\.gid,/.test(hostSrc),
		'bodyLike carries gid + live duel consent for impact-time checks');
}

console.log('ghost-sim: all assertions passed');
