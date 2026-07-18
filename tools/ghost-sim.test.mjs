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
assert.deepEqual(NET.parseWatch('?watch=qa42x7'), { room: 'QA42X7', via: null, name: null, secret: null }, 'room normalized');
assert.deepEqual(NET.parseWatch('?title=1&watch=ROOM42&via=bc&name=Zed'), { room: 'ROOM42', via: 'bc', name: 'Zed', secret: null }, 'via+name parsed');
assert.equal(NET.parseWatch('?watch=ROOM42&via=evil').via, null, 'unknown via rejected');
// decodeURIComponent throws on malformed escapes — a truncated invite link runs at
// module import time and must degrade to the raw text, never crash the boot
assert.deepEqual(NET.parseWatch('?watch=ROOM42%'), { room: 'ROOM42', via: null, name: null, secret: null }, 'malformed percent-escape degrades, never throws');
// the invite secret rides the #fragment (kept off the wire); a garbage fragment is not a key
{
	const sec = NET.mintInviteSecret();
	assert.equal(NET.parseWatch('?watch=ROOM42', '#k=' + sec).secret, sec, 'the invite secret is parsed from the URL fragment');
	assert.equal(NET.parseWatch('?watch=ROOM42', '#k=nothex').secret, null, 'a non-secret fragment is rejected');
	assert.equal(NET.parseWatch('?watch=ROOM42').secret, null, 'no fragment ⇒ no secret (loopback-only link)');
	assert.ok(NET.watchLink('http://x/y', 'ROOM42', null, sec).endsWith('#k=' + sec), 'watchLink appends the secret to the fragment');
	assert.equal(NET.watchLink('http://x/y', 'ROOM42', null, 'bad').indexOf('#'), -1, 'watchLink omits an invalid secret');
}
assert.equal(NET.parseWatch('?watch=ROOM42&name=%E0%A4%A').name, '%E0%A4%A', 'malformed name escape falls back to raw text');

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
// a malformed remaining-length (4 continuation bits — illegal in MQTT) must not
// wedge the decoder forever: the garbage is dropped and the next packet re-frames
const dec5 = NET.createMqttDecoder();
assert.equal(dec5.push(new Uint8Array([0x30, 0x80, 0x80, 0x80, 0x80, 0x01])).length, 0, 'malformed length yields nothing');
const out5 = dec5.push(NET.mqttEncodePublish('c', '3'));
assert.equal(out5.length, 1, 'decoder recovered after malformed length (no permanent wedge)');
assert.equal(out5[0].topic, 'c', 'post-recovery packet framed cleanly');

// Reject oversized broker frames before decoder concatenation, then recover on
// the next ordinary packet rather than leaving signaling permanently wedged.
const dec6 = NET.createMqttDecoder({maxPacketBytes:64});
assert.deepEqual(dec6.push(Uint8Array.from([0x30, 0x41])), [], 'oversized declared MQTT packet is rejected from its header');
assert.equal(dec6.push(NET.mqttEncodePublish('d', '4')).length, 1, 'decoder recovers after oversized declared packet');
const dec7 = NET.createMqttDecoder({maxPacketBytes:64});
assert.deepEqual(dec7.push(new Uint8Array(65)), [], 'oversized incoming MQTT chunk is rejected before buffering');
assert.equal(dec7.push(NET.mqttEncodePublish('e', '5')).length, 1, 'decoder recovers after oversized incoming chunk');
const dec8 = NET.createMqttDecoder({maxPacketBytes:64});
assert.deepEqual(dec8.push(Uint8Array.from([0x30, 1, 0])), [], 'truncated PUBLISH topic header is ignored safely');
assert.deepEqual(dec8.push(Uint8Array.from([0x30, 4, 0, 8, 0x61, 0x62])), [], 'PUBLISH topic length cannot exceed its body');
assert.equal(dec8.push(NET.mqttEncodePublish('f', '6')).length, 1, 'decoder recovers after malformed PUBLISH bodies');

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
assert.deepEqual(NET.PERMISSION_MODES, ['watch', 'chat', 'full', 'play', 'hero'], 'the five-mode ladder (play = pouch embodiment, hero = full game)');
assert.ok(NET.modeAllows('hero', 'play') && NET.modeAllows('hero', 'full') && NET.modeAllows('hero', 'watch'), 'hero ⊇ every lower rung');
assert.ok(!NET.modeAllows('play', 'hero'), 'play is below hero');
// hero-mode contract: the guest player state is guest-local truth; the world is
// protected here — actions, rates and envelopes
assert.deepEqual(NET.HERO_ACTIONS, ['mine', 'place', 'dmg', 'pickup', 'use', 'shoot', 'row', 'board', 'unboard', 'tp', 'antenna'],
	'the eleven hero world-intents');
assert.equal(NET.HERO_RULES.ANTENNA_MS, 1500, 'antenna intent rate floor pinned (per-active cooldown lives host-side)');
assert.ok(NET.HERO_RULES.PICKUP_MS === 150 && NET.HERO_RULES.USE_MS === 400 && NET.HERO_RULES.SHOOT_MS === 220
	&& NET.HERO_RULES.ROW_MS === 250 && NET.HERO_RULES.BOARD_MS === 400, 'pickup/use/shoot/row/board rate floors pinned');
assert.ok(NET.validHeroAction('mine') && !NET.validHeroAction('craft') && !NET.validHeroAction('__proto__'), 'hero action whitelist holds');
assert.ok(NET.HERO_RULES.REACH === 6 && NET.HERO_RULES.DMG_MAX === 45 && NET.HERO_RULES.HP_MAX === 1000, 'hero envelopes pinned');
assert.equal(NET.HERO_KEY, 'mm_ghost_hero_v1', 'the hero persistence key');
assert.ok(NET.validPermissionMode('watch') && NET.validPermissionMode('play') && !NET.validPermissionMode('admin'), 'mode validation');
assert.ok(NET.AVATARS.length >= 6 && NET.validAvatar('duszek') && !NET.validAvatar('<img>'), 'avatar registry validates');
// the ladder is strictly inclusive: a higher rung keeps every lower ability
assert.ok(NET.modeAllows('play', 'watch') && NET.modeAllows('play', 'chat') && NET.modeAllows('play', 'full') && NET.modeAllows('play', 'play'), 'play ⊇ every lower rung');
assert.ok(NET.modeAllows('full', 'chat') && !NET.modeAllows('full', 'play'), 'full is below play');
assert.ok(NET.modeAllows('chat', 'chat') && !NET.modeAllows('chat', 'full'), 'chat cannot influence');
assert.ok(!NET.modeAllows('watch', 'chat') && !NET.modeAllows('bogus', 'watch'), 'watch is the floor, garbage denies');

// --- play mode: the embodied guest (full multiplayer) ---------------------------------
assert.deepEqual(NET.PLAY_ACTIONS, ['mine', 'place', 'attack', 'craft', 'duel', 'pickup', 'eat'],
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
assert.ok(/NET\.parseWatch\(location\.search, location\.hash\)/.test(clientSrc), 'watch param + invite secret come from the URL (search + #fragment)');
assert.ok(!/localStorage\.setItem\((?!'mm_ghost_(name|avatar)_v1'|NET\.PROG_KEY|NET\.GID_KEY|NET\.GID_LEASE_KEY|NET\.LOOK_KEY|NET\.HERO_KEY|RESUME_CACHE_KEY)/.test(clientSrc),
	'client persists nothing but its own profile, stable identity/lease, hero state and bounded room recovery proof');
assert.ok(/Storage\.prototype\.setItem = function/.test(clientSrc) && /allow = new Set\(\['mm_ghost_name_v1', 'mm_ghost_avatar_v1', NET\.PROG_KEY, NET\.GID_KEY, NET\.GID_LEASE_KEY, NET\.LOOK_KEY, NET\.HERO_KEY, RESUME_CACHE_KEY\]\)/.test(clientSrc),
	'ghost mode locks down ALL localStorage writes (side stores like dynamic loot must not leak into the watcher’s own world)');
// hardening pins (post-review): hostile hosts, transport races, throttling floods
assert.ok(/function esc\(s\)/.test(clientSrc) && /esc\(hostName\)/.test(clientSrc),
	'remote host name is HTML-escaped before touching the veil innerHTML (XSS)');
assert.ok(/if\(api !== conn\) return;/.test(clientSrc) && /if\(lockedConn && c !== lockedConn\) return;/.test(clientSrc),
	'straggler frames from a replaced transport are dropped before and after the welcome lock');
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
{
	const { canRefreshResumeCredential, createClientTerminalTeardown, createGidLeaseController, normalizeResumeCredentialCache, readResumeCredential, writeResumeCredential, removeResumeCredential } = await import('../src/engine/ghost_client.js');
	const calls = { persist: 0, cancelReconnect: 0, stopTimers: 0, closeConnection: 0, clearInvite: 0, rotateIdentity: 0 };
	let reconnectPending = true;
	const finish = createClientTerminalTeardown({
		persist(){ calls.persist++; },
		cancelReconnect(){ calls.cancelReconnect++; reconnectPending = false; },
		stopTimers(){ calls.stopTimers++; },
		closeConnection(){ calls.closeConnection++; },
		clearInvite(){ calls.clearInvite++; },
		rotateIdentity(){ calls.rotateIdentity++; }
	});
	assert.equal(finish({ rotateIdentity: true }), true, 'the first terminal verdict owns teardown');
	assert.equal(reconnectPending, false, 'terminal teardown cancels pending reconnect work');
	assert.equal(finish({ rotateIdentity: true }), false, 'a duplicate terminal verdict cannot close twice');
	assert.equal(finish({ clearInvite: true }), false, 'later credential cleanup does not repeat transport teardown');
	assert.deepEqual(calls, { persist: 1, cancelReconnect: 1, stopTimers: 1, closeConnection: 1, clearInvite: 1, rotateIdentity: 1 },
		'terminal lifecycle and credential cleanup are independently idempotent');

	const at = 1700000000000;
	const tokenA = 'a'.repeat(32), tokenB = 'b'.repeat(32), tokenC = 'c'.repeat(32);
	assert.equal(canRefreshResumeCredential(false, 'gcache-owner', 'gcache-owner', tokenA), false,
		'a cached proof cannot refresh its TTL before this document is authenticated');
	assert.equal(canRefreshResumeCredential(true, 'gcache-owner', 'gcache-owner', tokenA), true,
		'an accepted welcome authorizes refresh for the stable base identity');
	assert.equal(canRefreshResumeCredential(true, 'gephem-owner', 'gcache-owner', tokenA), false,
		'an authenticated ephemeral sibling never writes the shared base credential cache');
	const mem = new Map();
	const storage = {
		getItem: k => mem.has(k) ? mem.get(k) : null,
		setItem: (k, v) => mem.set(k, String(v))
	};
	assert.equal(writeResumeCredential(storage, 'ROOM42', 'gcache-owner', tokenA, at), true, 'a valid room/gid proof enters the durable recovery cache');
	assert.equal(writeResumeCredential(storage, 'ROOM42', 'gcache-owner', tokenB, at + 1), true, 'a newer proof replaces the exact room/gid row');
	assert.equal(writeResumeCredential(storage, 'OTHER7', 'gcache-owner', tokenC, at + 2), true, 'the same gid may hold an independent proof for another room');
	assert.equal(readResumeCredential(storage, 'ROOM42', 'gcache-owner', at + 3), tokenB, 'recovery reads the newest proof for the exact room only');
	assert.equal(readResumeCredential(storage, 'OTHER7', 'gcache-owner', at + 3), tokenC, 'a room change never aliases the previous proof');
	assert.equal(removeResumeCredential(storage, 'ROOM42', 'gcache-owner', at + 3), true, 'a rejected proof can be removed without disturbing other rooms');
	assert.equal(readResumeCredential(storage, 'ROOM42', 'gcache-owner', at + 3), null, 'removed room proof is gone');
	assert.equal(readResumeCredential(storage, 'OTHER7', 'gcache-owner', at + 3), tokenC, 'removing one room preserves another room credential');
	const dirty = normalizeResumeCredentialCache({ v: 1, entries: [
		{ room: 'OTHER7', gid: 'gok', rt: tokenA, ts: at - 1 },
		{ room: 'OTHER7', gid: 'gexpired', rt: tokenA, ts: at - 8 * 24 * 3600 * 1000 },
		{ room: 'OTHER7', gid: 'gfuture', rt: tokenA, ts: at + 1 },
		{ room: 'bad', gid: 'gwrong-room', rt: tokenA, ts: at - 1 },
		{ room: 'OTHER7', gid: 'gwrong-token', rt: 'bad', ts: at - 1 }
	] }, at);
	assert.deepEqual(dirty.entries.map(e => e.gid), ['gok'], 'cache normalization fails closed on expired, future and malformed rows');
	assert.deepEqual(normalizeResumeCredentialCache({ v: 99, entries: dirty.entries }, at), { v: 1, entries: [] }, 'an unknown cache version is ignored, never reinterpreted');
	const boundedMem = new Map();
	const boundedStorage = { getItem: k => boundedMem.get(k) || null, setItem: (k, v) => boundedMem.set(k, String(v)) };
	for(let i = 0; i < 30; i++) writeResumeCredential(boundedStorage, 'ROOM42', 'gbound-' + i, tokenA, at + i);
	const bounded = normalizeResumeCredentialCache(boundedMem.values().next().value, at + 30);
	assert.equal(bounded.entries.length, 24, 'durable recovery cache has a hard row ceiling');

	const longSessionAt = at + 8 * 24 * 3600 * 1000;
	assert.equal(writeResumeCredential(storage, 'ROOM42', 'glong-session', tokenA, longSessionAt), true,
		'a still-connected session can refresh its durable proof after the original seven-day window');
	assert.equal(readResumeCredential(storage, 'ROOM42', 'glong-session', longSessionAt + 1), tokenA,
		'the refreshed proof remains recoverable after a long-lived tab finally closes');

	let leaseNow = at;
	const leaseMem = new Map();
	const leaseStorage = {
		getItem: k => leaseMem.has(k) ? leaseMem.get(k) : null,
		setItem: (k, v) => leaseMem.set(k, String(v)),
		removeItem: k => leaseMem.delete(k)
	};
	const ownerA = 'daaaaaaaaaaaa', ownerB = 'dbbbbbbbbbbbb';
	const leaseA = createGidLeaseController(leaseStorage, 'gshared-owner', ownerA, () => leaseNow);
	const leaseB = createGidLeaseController(leaseStorage, 'gshared-owner', ownerB, () => leaseNow);
	assert.equal(leaseA.claim(), true, 'the first document owner claims the stable gid lease');
	assert.equal(leaseB.claim(), false, 'a sibling heartbeat never overwrites a fresh other-owner lease');
	assert.equal(leaseB.release(), false, 'a sibling cannot release another document owner\'s lease');
	assert.equal(JSON.parse(leaseMem.get(NET.GID_LEASE_KEY)).owner, ownerA, 'failed sibling claim/release leaves the winner intact');
	leaseNow += 100;
	assert.equal(leaseA.claim(), true, 'the exact document owner may heartbeat its own lease');
	leaseNow += NET.GID_LEASE_MS + 1;
	assert.equal(leaseB.claim(), true, 'an expired owner lease may be reclaimed by a sibling document');
	assert.equal(leaseA.release(), false, 'the stale prior owner cannot remove the fresh winner lease');
	assert.equal(JSON.parse(leaseMem.get(NET.GID_LEASE_KEY)).owner, ownerB, 'the fresh winner survives a stale-owner release');
	assert.equal(leaseB.release(), true, 'the exact current document owner may release for immediate reload recovery');

	leaseMem.set(NET.GID_LEASE_KEY, JSON.stringify({ gid: 'gshared-owner', ts: leaseNow }));
	assert.equal(leaseA.claim(), false, 'a fresh ownerless legacy lease is treated as occupied, never silently overwritten');
	leaseNow += NET.GID_LEASE_MS + 1;
	assert.equal(leaseA.claim(), true, 'an ownerless legacy lease can be replaced only after expiry');

	const racedMem = new Map();
	const racedStorage = {
		getItem: k => racedMem.get(k) || null,
		setItem(k, v){
			racedMem.set(k, String(v));
			// Model another document winning between this claimant's write and reread.
			racedMem.set(k, JSON.stringify({ v: 1, gid: 'gshared-owner', owner: ownerB, ts: leaseNow }));
		},
		removeItem: k => racedMem.delete(k)
	};
	const racedA = createGidLeaseController(racedStorage, 'gshared-owner', ownerA, () => leaseNow);
	assert.equal(racedA.claim(), false, 'a post-write reread detects a simultaneous sibling winner');
	assert.equal(JSON.parse(racedMem.get(NET.GID_LEASE_KEY)).owner, ownerB, 'the simultaneous winner remains the current lease owner');
}
assert.ok(/if\(reconnectT\)\{ clearTimeout\(reconnectT\); reconnectT = null; \}/.test(clientSrc)
	&& /const stale = conn;\s*\n\s*conn = null;/.test(clientSrc),
	'terminal teardown cancels the delayed reconnect and reconnect closes never leave a stale conn reference');
assert.ok(/const ending = conn;\s*\n\s*conn = null;[\s\S]{0,100}if\(ending\) ending\.close\(\)/.test(clientSrc)
	&& /if\(state === 'ended'\) return; \/\/ queued frames/.test(clientSrc),
	'a terminal connection is closed exactly once and queued frames cannot revive it');
assert.ok(/function rotateTakenIdentity\(\)[\s\S]{0,900}sessionStorage\.setItem\(NET\.GID_KEY, gid\);/.test(clientSrc)
	&& !/function rotateTakenIdentity\(\)[\s\S]{0,900}localStorage\.setItem\(NET\.GID_KEY, gid\);/.test(clientSrc)
	&& /if\(rejectedGid !== baseGid\) removeResumeCredential\(localStorage, WATCH\.room, rejectedGid\)/.test(clientSrc)
	&& /pl\.t === 'taken'[\s\S]{0,180}finishTerminal\(\{ rotateIdentity: true \}\)/.test(clientSrc),
	'`taken` rotates only the losing tab gid and never destroys the shared base recovery proof');
for(const packet of ['full', 'banned', 'incompatible', 'unavailable', 'taken', 'hostGone']){
	assert.ok(new RegExp("pl\\.t === '" + packet + "'[\\s\\S]{0,420}finishTerminal\\(").test(clientSrc),
		packet + ' is a terminal packet that tears down its transport');
}
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
assert.ok(/const SIG_NS = 'mmg2\/';/.test(netSrc)
	&& /env\.v !== SIGNAL_ENVELOPE_VERSION/.test(netSrc)
	&& /SIGNAL_ENVELOPE_FIELDS = new Set\(\['v', 'k', 'to', 'sid', 'ct', 'role', 'nonce', 'ts', 'sig', 'from'\]\)/.test(netSrc),
	'signaling v2 uses an isolated MQTT namespace and rejects plaintext/extra-field downgrade envelopes');
assert.ok(/deriveSignalKey\(secretHex, room, role, purpose\)/.test(netSrc)
	&& /purpose === 'mac'/.test(netSrc) && /purpose === 'aead'/.test(netSrc)
	&& /name: 'HKDF', hash: 'SHA-256'/.test(netSrc)
	&& /name: 'AES-GCM'/.test(netSrc)
	&& /if\(keyCache\.size >= 64\) keyCache\.delete/.test(netSrc)
	&& /keyFor\(expectRole, 'mac', false\)/.test(netSrc)
	&& /if\(!v\.ok\) return v;\s*\n\s*rememberKey\('mac'/.test(netSrc),
	'v2 derives distinct room/role/domain-separated HMAC and AES-GCM keys with HKDF-SHA-256');
assert.ok(/const body = payload\.sdp != null \? \{ fp, sdp: payload\.sdp \} : \{ fp, c: payload\.c \};/.test(netSrc)
	&& /env\.ct = await encryptSignalBody/.test(netSrc),
	'SDP, ICE and fingerprints enter only the encrypted signal body');
{
	const verifySlice = netSrc.slice(netSrc.indexOf('export async function verifySignal'), netSrc.indexOf('export function createReplayGuard'));
	const openSlice = netSrc.slice(netSrc.indexOf('async open(env, expectRole'), netSrc.indexOf('// --- host-side movement enforcement'));
	assert.ok(verifySlice.indexOf('signalMacWithKey') < verifySlice.indexOf('guard.accept'),
		'the outer HMAC authenticates before a nonce can consume replay capacity');
	assert.ok(openSlice.indexOf('await verifySignal') < openSlice.indexOf('decryptSignalBody'),
		'the bounded HMAC/replay gate runs before any AES-GCM decrypt');
}

// --- P0-4/P0-5: transport hardening wiring (the RTC path can't run headless, so pin it) ------
// remote RTC requires the invite SECRET on BOTH ends — the signaling is signed with it,
// so a peer without the secret can neither be answered nor make us open a PeerConnection
assert.ok(/if\(opts\.rtc === true && validInviteSecret\(opts\.secret\) && typeof RTCPeerConnection/.test(netSrc),
	'P0-4: hostListen only stands up RTC with rtc:true AND a valid invite secret');
assert.ok(/if\(validInviteSecret\(opts\.secret\) && typeof RTCPeerConnection/.test(netSrc),
	'P0-4: joinRoom only attempts remote RTC when the link carried a valid invite secret');
assert.ok(/s\.listen = NET\.hostListen\(room, \{ rtc: opts\.rtc !== false, secret: s\.secret,/.test(hostSrc),
	'P0-4: the host serves AUTHENTICATED remote RTC by default, bound to its session invite secret');
assert.ok(/secret: NET\.mintInviteSecret\(\),/.test(hostSrc), 'P0-4: the host mints a per-session 128-bit invite secret');
assert.ok(/sessionStorage\.setItem\(INVITE_TAB_KEY/.test(clientSrc)
	&& /history\.replaceState\(history\.state, '', location\.pathname \+ location\.search\)/.test(clientSrc)
	&& /clearInvite: clearWatchInvite/.test(clientSrc)
	&& /finishTerminal\(\{ clearInvite: true \}\)/.test(clientSrc),
	'P0-4: the consumed bearer secret moves to tab scope, leaves browser history, and clears on final leave');
// the RTC handshake routes through the signed channel and gates on the secret
assert.ok(/export function createRtcHost\(room, handlers, secret\)\{[\s\S]{0,260}createSignedChannel\(secret, room, 'h'\);\s*\n\s*if\(!sc\.ready\) return/.test(netSrc),
	'P0-4: createRtcHost refuses to signal without a valid secret (signed channel)');
assert.ok(/export function createRtcJoin\(room, gid, handlers, secret\)\{[\s\S]{0,320}const self = 'g' \+ gid;[\s\S]{0,80}createSignedChannel\(secret, room, self\);\s*\n\s*if\(!sc\.ready\)/.test(netSrc),
	'P0-4: createRtcJoin refuses to join without a valid secret (signed channel)');
assert.ok(/const verifyLease = acquireSignalVerify\(\);[\s\S]{0,180}v = await sc\.open\(m, gid, fpPin, sidPin\);[\s\S]{0,120}verifyLease\.release\(\);[\s\S]{0,80}if\(stopped \|\| !v \|\| !v\.ok\) return;/.test(netSrc),
	'P0-4: an unsigned/forged/replayed guest envelope never opens a PeerConnection (DoS + auth gate)');
assert.ok(/const verifyLease = acquireSignalVerify\(\);[\s\S]{0,180}v = await sc\.open\(m, 'h', \(m\.k === 'ice' && pinnedHostFp\) \? pinnedHostFp : null, messageSid\);[\s\S]{0,120}verifyLease\.release\(\);[\s\S]{0,100}if\(closed \|\| sid !== messageSid \|\| !v \|\| !v\.ok\) return;/.test(netSrc),
	'P0-4: the guest only acts on host envelopes it verified (and pins the host fingerprint)');
assert.ok(/hostFp = sdpFingerprint\(m\.sdp\);/.test(netSrc) && /entry\.peerFp = fp;/.test(netSrc),
	'P0-4: both ends pin the peer DTLS fingerprint from the signed offer/answer');
assert.ok((netSrc.match(/m = v\.message; \/\//g) || []).length === 2,
	'P0-4: host and join RTC state machines consume only the decrypted validated message');
// signaling size caps before parse + SDP/ICE bounds
assert.ok(/if\(!withinWireLimit\(payload, WIRE_LIMITS\.SIG_MAX\)\) return;/.test(netSrc)
	&& /function signalPreflight\(m, from, to\)\{[\s\S]{0,180}validSignalEnvelope\(m\) && validSignalSize\(m\)/.test(netSrc)
	&& /if\(!signalPreflight\(m, m\.from, who\)\) return;/.test(netSrc)
	&& /function validOpenedSignal\(env\)\{[\s\S]{0,180}if\(!validSignalSize\(env\)\) return false;/.test(netSrc),
	'P0-5: sealed envelopes/ciphertext are capped before crypto and decrypted SDP/ICE are bounded before RTC APIs');
assert.ok(/if\(!withinWireLimit\(str, WIRE_LIMITS\.MQTT_PAYLOAD_MAX\)\) return;/.test(netSrc),
	'P0-5: MQTT publishes are byte-capped');
// RTC DoS: pending flood guard, negotiation + hello deadlines, fail-closed teardown
assert.ok(/pending >= RTC_LIMITS\.PENDING_MAX \|\| pcs\.size >= RTC_LIMITS\.PEERS_MAX/.test(netSrc),
	'P0-5: a `hi` flood cannot open unbounded RTCPeerConnections (pending cap)');
assert.ok(/const rtcGlobalAdmission = \{ pending: 0, verifying: 0 \};/.test(netSrc)
	&& /const pendingLease = acquireRtcPending\(\);\s*\n\s*if\(!pendingLease\) return;/.test(netSrc)
	&& /if\(e\.pendingLease\)\{ e\.pendingLease\.release\(\); e\.pendingLease = null; \}/.test(netSrc),
	'P0-5: half-open RTC admission is globally leased across room/listener instances and returned on teardown');
assert.ok(/const rtcSignalVerifyRate = createRateBudget\(RTC_LIMITS\.SIGNAL_VERIFY_RATE_MAX, RTC_LIMITS\.SIGNAL_VERIFY_RATE_WINDOW_MS\);/.test(netSrc)
	&& /function acquireSignalVerify\(\)\{[\s\S]{0,260}rtcSignalVerifyRate\.tryTake\(Date\.now\(\)\)/.test(netSrc)
	&& /if\(!signalPreflight\(m, gid, 'h'\)\) return;\s*\n\s*if\(!signalAllowed\(gid\)\) return;/.test(netSrc),
	'P0-5: cheap preflight precedes globally concurrency- and rate-bounded HMAC verification');
assert.ok(/entry\.negT = setTimeout\(\(\) => \{ if\(!entry\.alive\) drop\(gid, entry\); \}, RTC_LIMITS\.NEGOTIATE_MS\);/.test(netSrc),
	'P0-5: a negotiation that never connects is dropped on a deadline');
assert.ok(/entry\.helloT = setTimeout\(\(\) => \{ if\(!entry\.helloSeen\) drop\(gid, entry\); \}, RTC_LIMITS\.HELLO_MS\);/.test(netSrc),
	'P0-5: a channel that opens but never says hello is reaped (mandatory hello timeout)');
assert.ok(/function drop\(gid, expected\)\{[\s\S]{0,360}clearTimeout\(e\.negT\);[\s\S]{0,80}clearTimeout\(e\.helloT\);/.test(netSrc),
	'P0-5: teardown is fail-closed — both deadline timers are cleared with the peer');
assert.ok(/if\(!e \|\| \(expected && e !== expected\) \|\| e\.dropped\) return;/.test(netSrc)
	&& /if\(m\.k !== 'hi' && \(!current \|\| current\.dropped \|\| pcs\.get\(gid\) !== current\)\) return;/.test(netSrc),
	'P0-5: stale host RTC callbacks and verified signals cannot act on a replacement negotiation');
assert.ok(/if\(pendingEntry\.alive \|\| m\.sid === pendingEntry\.sid \|\| m\.ts <= pendingEntry\.hiTs\) return;/.test(netSrc)
	&& /drop\(gid, pendingEntry\);/.test(netSrc) && /sid: m\.sid, hiTs: m\.ts/.test(netSrc),
	'P0-5: only a strictly newer authenticated sid may replace a pending host negotiation; alive peers stay pinned');
assert.ok(/const isCurrent = \(\) => !closed && sid === messageSid && pc === activePc && !resetting;/.test(netSrc),
	'P0-5: every guest RTC continuation is bound to the PC and sid generation that created it');
assert.ok(/try\{ handlers\.onPeer\(entry\.peer\); \}\s*\n\s*catch\(e\)\{ drop\(gid, entry\); \}/.test(netSrc)
	&& /try\{ handlers\.onOpen\(opened\); \}\s*\n\s*catch\(e\)\{ if\(isCurrent\(\)\)\{ resetPeer\(true, activePc\); sendHi\(\); \} \}/.test(netSrc),
	'P0-5: application open hooks fail-close the exact RTC generation when they throw');
assert.ok(/dc\.onclose = \(\) => \{\s*\n\s*try\{ if\(entry\.peer && entry\.peer\.onMessage\)/.test(netSrc)
	&& /finally \{ drop\(gid, entry\); \}/.test(netSrc)
	&& (netSrc.match(/finally \{ resetPeer\(true, activePc\); sendHi\(\); \}/g) || []).length >= 2,
	'P0-5: host/join close-loss notifications cannot throw past mandatory teardown');
assert.ok(/export function createRtcJoin[\s\S]*function signalAllowed\(\)\{[\s\S]*SIGNAL_PEER_MAX[\s\S]*async onMsg\(m\)\{[\s\S]*if\(!signalAllowed\(\)\) return;[\s\S]*export function hostListen/.test(netSrc),
	'P0-5: the guest bounds public-broker HMAC work before authenticating host-shaped signaling');
// DataChannel send goes through the bounded queue, and oversized frames are refused
assert.ok(/const rtcQueueByteBudget = createByteBudget\(DC_QUEUE\.GLOBAL_MAX_BYTES\);/.test(netSrc)
	&& /const q = createSendQueue\(\{ acquireBytes: bytes => rtcQueueByteBudget\.acquire\(bytes\) \}\);/.test(netSrc)
	&& /if\(!q\.push\(str\) \|\| !q\.flush\(dc\)\) closePeer\(\);/.test(netSrc),
	'P0-5: every rtc peer shares one aggregate queued-byte budget and fail-closes on denial');
assert.ok(/function failClosed\(extraLease\)\{[\s\S]{0,180}for\(const entry of q\) releaseEntry\(entry\);/.test(netSrc)
	&& /function dispose\(\)\{[\s\S]{0,100}q\.dispose\(\);/.test(netSrc)
	&& /dc\.addEventListener\('close', dispose, \{ once: true \}\)/.test(netSrc)
	&& /const old = pc, oldConn = conn;[\s\S]{0,300}if\(oldConn\) oldConn\.close\(\)/.test(netSrc),
	'P0-5: queued-byte leases release on queue failure plus host/join close paths');
assert.ok(/if\(!withinWireLimit\(str, WIRE_LIMITS\.JSON_MAX\)\) return;/.test(netSrc),
	'P0-5: an oversized outbound frame is dropped, never emitted');
// assembler byte ceiling (UTF-8, not code units)
assert.ok(/cur\.bytes \+= utf8Len\(env\.d\);/.test(netSrc) && /if\(cur\.bytes > WIRE_LIMITS\.ASSEMBLED_MAX\)\{ cur = null; return null; \}/.test(netSrc),
	'P0-5: the snapshot assembler enforces a UTF-8 BYTE ceiling on the assembled payload');

// --- P0-3 wiring: the authenticated hello phase --------------------------------------------
assert.ok(/if\(!entry\.hello && pl\.t !== 'hello' && pl\.t !== 'bye'\) return;/.test(hostSrc),
	'P0-3: before a valid hello, only hello and bye are accepted');
assert.ok(/if\(pl\.proto !== NET\.GHOST_PROTO\)\{[\s\S]{0,160}t: 'incompatible'[\s\S]{0,120}dropPeer\(s, entry, true\);/.test(hostSrc),
	'P0-3: a protocol mismatch is refused before a viewer/snapshot/permission exists');

// --- P0-1 wiring: resume tokens on both ends ------------------------------------------------
assert.ok(/let known = s\.tokens\.get\(entry\.gid\);[\s\S]{0,650}if\(known && !NET\.resumeTokenMatch\(pl\.rt, known\)\)\{/.test(hostSrc),
	'P0-1: a claimed gid already held this session requires the matching resume token');
assert.ok(/if\(!s\.tokens\.has\(entry\.gid\)\)\{[\s\S]{0,180}proof = proof \|\| NET\.mintResumeToken\(\);[\s\S]{0,260}s\.tokens\.set\(entry\.gid, proof\);/.test(hostSrc),
	'P0-1: the host mints a resume token on the first claim of a gid');
assert.ok(/try\{ proof = proof \|\| NET\.mintResumeToken\(\); \}[\s\S]{0,500}entry\.resumeToken = s\.tokens\.get\(entry\.gid\);\s*\n\s*entry\.hello = true;/.test(hostSrc),
	'P0-1: secure-random failure cannot leave a peer in authenticated hello state without a resume proof');
assert.ok(/const savedClaim = bodyKeepClaim\(s\.room, entry\.gid, pl\.rt\);[\s\S]{0,180}if\(savedClaim\.taken\)/.test(hostSrc)
	&& /if\(!NET\.resumeTokenMatch\(resumeToken, snap\.rt\)\) return \{ snap: null, proof: null, taken: true \};/.test(hostSrc),
	'P0-1: a current-room persisted body requires its saved resume-token proof before admission');
assert.ok(/rt: entry\.resumeToken,/.test(hostSrc), 'P0-1: the resume token rides the private welcome');
assert.ok(/rt: resumeToken \|\| undefined/.test(clientSrc) && /storeResumeToken\(pl\.rt\)/.test(clientSrc),
	'P0-1: the guest echoes its resume token on hello and banks the one the welcome gave it');
assert.ok(/sessionStorage\.setItem\(NET\.RESUME_TOKEN_KEY/.test(clientSrc),
	'P0-1: the live resume token remains in tab-scoped sessionStorage');
assert.ok(/const RESUME_CACHE_KEY = 'mm_ghost_resume_cache_v1';/.test(clientSrc)
	&& /readResumeCredential\(localStorage, WATCH\.room, gid\)/.test(clientSrc)
	&& /writeResumeCredential\(localStorage, WATCH\.room, gid, resumeToken, t\)/.test(clientSrc)
	&& /const RESUME_CACHE_REFRESH_MS = 6 \* 3600 \* 1000;/.test(clientSrc)
	&& /canRefreshResumeCredential\(resumeAuthenticatedThisDocument, gid, baseGid, resumeToken\)/.test(clientSrc)
	&& /resumeAuthenticatedThisDocument = true;/.test(clientSrc),
	'P0-1: only a host-accepted stable base proof is periodically kept recoverable across tab restarts');

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
assert.ok(/const pos = trackedPos\(entry\);[\s\S]{0,900}const hits = bridge\.ghostPower\(kind, pos\.x, pos\.y, rule\);/.test(hostSrc),
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
assert.ok(/allow = new Set\(\['mm_ghost_name_v1', 'mm_ghost_avatar_v1', NET\.PROG_KEY, NET\.GID_KEY, NET\.GID_LEASE_KEY, NET\.LOOK_KEY, NET\.HERO_KEY, RESUME_CACHE_KEY\]\)/.test(clientSrc),
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
assert.ok(/window\.addEventListener\('pagehide', \(ev\) => \{ flushProgress\(true\); saveHeroState\(true\); refreshResumeCredential\(true\); if\(!ev\.persisted\) releaseGidLease\(gid\); \}\)/.test(clientSrc)
	&& /persist\(\)\{ flushProgress\(true\); saveHeroState\(true\); refreshResumeCredential\(true\); \}/.test(clientSrc)
	&& /try\{ refreshResumeCredential\(false\); \}catch\(e\)/.test(clientSrc),
	'dirty progress AND the hero state are force-flushed on leave and unload — the throttle may never lose an earned deed');
assert.ok(/JSON\.stringify\(res\.state\.counts\) !== JSON\.stringify\(before\.counts\)/.test(clientSrc)
	&& /res\.state\.days\.length !== before\.days\.length/.test(clientSrc),
	'count-only and day-only changes persist too (the 0-XP crowd deed and day stamps must reach disk)');
assert.ok(/if\(lvl !== entry\.level\)\{ entry\.level = lvl; updateUi\(\); \}/.test(hostSrc),
	'prog spam cannot drive host DOM rebuilds — updateUi only fires on an actual level change');
assert.ok(/if\(!el \|\| el\.style\.display !== 'flex'\) return;/.test(hostSrc)
	&& /focusedTag === 'SELECT' \|\| focusedTag === 'INPUT'/.test(hostSrc),
	'the periodic panel refresh skips a hidden panel and never yanks an open dropdown/selection from the host');
// --- hero mode: the full-game guest (Phase 1) -------------------------------------------
// Contract: guest player state = guest-local truth; the WORLD is host-protected.
{
	// the ONE inlet for hero world intents, with reach/rate/envelope checks
	assert.ok(/function handleHeroAct\(s, entry, pl\)/.test(hostSrc) && /pl\.t === 'hact'/.test(hostSrc),
		'every hero world intent lands in one host-side handler');
	assert.ok(/if\(!b \|\| entry\.mode !== 'hero'\)/.test(hostSrc), 'hact demands the hero rung exactly');
	assert.ok(/NET\.playReachOk\(b\.x, b\.y, tx, ty, NET\.HERO_RULES\.REACH\)/.test(hostSrc), 'hero reach is enforced against the HOST-tracked body');
	assert.ok(/function guestTargetClear\(body, tx, ty\)/.test(hostSrc)
		&& /bridge\.ghostTargetClear\(body\.x, body\.y, Math\.floor\(tx\), Math\.floor\(ty\)\)/.test(hostSrc),
		'guest world intents require body-origin line of sight in addition to numeric reach');
	assert.ok(/function canPhysicallyTargetTileFrom\(originX,originY,tx,ty\)/.test(mainSrc)
		&& /ghostTargetClear:\(originX,originY,tx,ty\)=>/.test(mainSrc),
		'the bridge reuses solo line-of-sight and exposed-face rules from the guest body origin');
	assert.ok(/Math\.min\(NET\.HERO_RULES\.DMG_MAX, Number\(pl\.n\) \|\| 1\)/.test(hostSrc)
		&& /Math\.abs\(x - b\.x\) > NET\.HERO_RULES\.DMG_RADIUS/.test(hostSrc),
		'forwarded damage is clamped by amount AND anchored near the body');
	assert.ok(/\(pl\.k === 'ignite' \|\| pl\.k === 'chill'\) \? pl\.k : 'hit'/.test(hostSrc),
		'the element whitelist: a guest names the element, the host owns the parameters');
	assert.ok(/kind==='ignite'.*MOBS\.igniteAt.*dur:2\.5/.test(mainSrc) && /kind==='chill'.*MOBS\.chillAt.*dur:3/.test(mainSrc),
		'elemental forwards use host-fixed durations, never client-claimed ones');
	// the bridge seams re-validate world truth with solo-grade rules
	assert.ok(/ghostHeroMineAt:\(tx,ty\)=>\{/.test(mainSrc) && /info\.chestTier \|\| info\.cache\) return \{ok:false, reason:'chest'\}/.test(mainSrc),
		'hero mining spans the three solo layers but chests stay host economy');
	assert.ok(/ghostHeroPlaceAt:\(tx,ty,tid,layer,body\)=>\{/.test(mainSrc) && /canPlaceInfrastructureAt\(tx,ty,id,\{body\}\)/.test(mainSrc)
		&& /canPlaceConstructionBackgroundAt\(tx,ty,id,\{body\}\)/.test(mainSrc)
		&& /const actorBlocked=remotePlacementActorBlockedReason\(body,tx,ty\)/.test(mainSrc),
		'hero placement re-validates every layer against the authenticated guest body');
	assert.ok(/function remotePlacementActorBlockedReason\(body,tx,ty,infrastructureId\)/.test(mainSrc)
		&& /infrastructureTargetBlockedReasonFrom\(body\.x,body\.y,tx,ty,infrastructureId\)/.test(mainSrc)
		&& /const remoteBody=remoteActor && remoteContext \? remoteContext\.body : null/.test(mainSrc)
		&& /if\(!remoteActor && !godMode && !haveBlocksFor\(id\)\)/.test(mainSrc),
		'remote overlay/background legality uses guest-origin reach/LOS and skips host inventory and god-mode authority');
	assert.ok((mainSrc.match(/if\(cur===T\.WATER && id===T\.WOOD\) return \{ok:false, reason:'boat'\};/g) || []).length >= 2,
		'play and hero placement fail closed when wood-on-water would require the unsupported raft transaction');
	// the write chokepoints: the guest's real mining/building routes through intents
	assert.ok(/if\(MM\.ghostHeroIntents\) return MM\.ghostHeroIntents\.mineBreak\(mineTx,mineTy\);/.test(mainSrc),
		'breakMinedTile defers to the intent chokepoint for hero guests');
	assert.ok(/if\(!MM\.ghostHeroIntents\.place\(tx,ty,v\.id,layer\)\) return false;/.test(mainSrc),
		'tryPlace defers to the intent chokepoint for hero guests');
	// the hero frame: world systems stay OFF on the guest (streamed), hero systems run
	assert.ok(/function runHeroStep\(dt,ts\)/.test(mainSrc) && !/runHeroStep[\s\S]{0,900}MOBS\.update/.test(mainSrc)
		&& !/function runHeroStep[\s\S]{0,900}WATER\.update/.test(mainSrc),
		'runHeroStep steps hero systems only — the world is the host’s stream');
	assert.ok(/if\(WEAPONS && WEAPONS\.ghostStepFx\) WEAPONS\.ghostStepFx\(dt\);/.test(mainSrc)
		&& !/function runHeroStep[\s\S]{0,1400}WEAPONS\.update\(/.test(mainSrc),
		'the hero frame steps arrows cosmetically only — the real impact chains never run on replica arrows');
	assert.ok(/function runHeroStep[\s\S]{0,2800}FISHING\.update\(dt, player, getTile\);/.test(mainSrc),
		'fishing runs for hero guests — reads replica water, writes nothing, catch is guest-local');
	// uranium charge: the contract's "hero-side system" template — one function,
	// BOTH frames, registry flag instead of a hard-coded tile id
	assert.ok(/function updateUraniumCharge\(dt\)/.test(mainSrc) && /info && info\.radioactive/.test(mainSrc),
		'uranium charging keys on the INFO radioactive flag (registry-driven)');
	assert.ok(/updateHeroEnergy\(dt\); updateUraniumCharge\(dt\); updateHeroLamp\(dt\);[\s\S]{0,120}updateTreasureCompass/.test(mainSrc)
		&& /VENDING\.update\(dt,getTile\); updateHeroEnergy\(dt\); updateUraniumCharge\(dt\);/.test(mainSrc),
		'uranium charge runs in BOTH frames — solo host and hero guest charge alike');
	// the vehicles plane: boats and mechs stream live between joins (same save
	// codec a reload uses; sig-skip = silence while nothing moves)
	assert.ok(/function machTick\(s, t\)/.test(hostSrc) && /if\(sig === s\.lastMachSig\) return;/.test(hostSrc)
		&& /broadcast\(\{ t: 'mach', data \}\);/.test(hostSrc),
		'the mach plane broadcasts vehicle snapshots on change only');
	assert.ok(/pl\.t === 'mach'/.test(clientSrc) && /bridge\.restoreBoats\(pl\.data\.b\);/.test(clientSrc)
		&& /bridge\.restoreMechs\(pl\.data\.m\);/.test(clientSrc),
		'the watcher applies vehicle snapshots through the reload codec');
	assert.ok(/restoreMechs:\(d\)=>\{ try\{ if\(MECHS&&MECHS\.restore\) MECHS\.restore\(d,getTile\); \}catch\(e\)\{\} \}/.test(mainSrc),
		'mech restore rides the same guarded bridge seam pattern as the other planes');
	// rowing: energy is the guest's local truth (spent client-side), the impulse
	// and speed cap are the boats module's own — the claim picks only strong/weak
	assert.ok(/if\(MM\.ghostHeroIntents\)\{[\s\S]{0,400}MM\.ghostHeroIntents\.row\(dir, strong\);/.test(mainSrc),
		'heroRowStroke defers to the row intent after spending the guest-local energy');
	assert.ok(/ghostHeroRow:\(body,dir,strong\)=>\{/.test(mainSrc) && /heroEnergy:\{spend:\(\)=>!!strong\}/.test(mainSrc),
		'the host resolves the stroke against the boat under the tracked body');
	assert.ok(/if\(t - \(b\.lastHeroRowAt \|\| 0\) < NET\.HERO_RULES\.ROW_MS\) return;/.test(hostSrc),
		'oar strokes ride a per-guest rate floor');
	// mech driving: the movement-authority inversion — while a guest drives, its
	// position claims are IGNORED (the cab is the authority) and the pose packet
	// carries only steering bits; guestGid is transient and never serialized
	const mechSrc = readFileSync(new URL('../src/engine/mechs.js', import.meta.url), 'utf8');
	assert.ok(/function guestBoardNearest\(gid, body\)/.test(mechSrc) && /function guestUnboard\(gid\)/.test(mechSrc)
		&& /if\(m\.guestGid\)\{ updateGuestDrivenMech\(m,dt,getTile,setTile\); \}/.test(mechSrc),
		'guest-driven mechs run their own rider-grade step, never the host-controls path');
	assert.ok(!/guestGid/.test(mechSrc.slice(mechSrc.indexOf('function snapshot()'), mechSrc.indexOf('function snapshot()') + 2600)),
		'guestGid never serializes — no phantom rider can survive a save or a vanished guest');
	assert.ok(/m\.pilotAlive \|\| m\.hp<=0 \|\| m\.rider \|\| m\.guestGid\) continue;/.test(mechSrc),
		'one human per cab — boarding skips hulls a guest already drives');
	assert.ok(/const di = MMR\.mechs\.guestDriveInfo\(entry\.gid\);/.test(hostSrc) && /b\.x = di\.x \+ 0\.5; b\.y = di\.y - 0\.2;/.test(hostSrc),
		'while driving, the body is glued to the cab and pose claims are ignored');
	assert.ok(/if\(MM\.ghostHeroDriving && MECHS && MECHS\.mechById\)\{/.test(mainSrc),
		'the guest hero rides its replica cab instead of running its own physics');
	assert.ok(/guestUnboard\(entry\.gid\); \}catch\(e\)\{ \/\* fine \*\/ \}/.test(hostSrc),
		'demotion/leave always vacates the cab');
	// projectiles: ONE chokepoint in pushArrow forwards the shot; the host flies
	// the real arrow with clamped velocity/damage and a whitelisted flag set
	const wsrcH = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
	assert.ok(/MM\.ghostHeroIntents && MM\.ghostHeroIntents\.shoot\)\{ MM\.ghostHeroIntents\.shoot\(a\); return; \}/.test(wsrcH),
		'pushArrow defers to the shoot intent for hero guests');
	assert.ok(/function spawnHeroProjectile\(body, spec\)/.test(wsrcH) && /const cap=Math\.min\(26,sp\);/.test(wsrcH)
		&& /Math\.min\(45,Math\.round\(Number\(spec\.dmg\)\|\|1\)\)/.test(wsrcH),
		'the host resolver caps speed and damage before the real arrow flies');
	assert.ok(/if\(t - \(b\.lastHeroShootAt \|\| 0\) < NET\.HERO_RULES\.SHOOT_MS\) return;/.test(hostSrc),
		'projectile intents ride a per-guest rate floor');
	// gear pickups: the item travels as an object and is SANITIZED again on receipt
	assert.ok(/ghostHeroPickupAt:\(wx,wy,body\)=>\{/.test(mainSrc) && /kind:'gear', item:info\.item/.test(mainSrc),
		'gear drops travel as item objects through the hero pickup seam');
	assert.ok(/MMR\.inventory\.grantItem && MMR\.inventory\.grantItem\(pl\.item\)/.test(clientSrc),
		'the guest banks gear through grantItem (sanitizes hostile host input)');
	// vitals: guest-local truth — host forwards wounds, skips survival, accepts claims
	assert.ok(/if\(entry\.heroMode\)\{[\s\S]{0,600}return; \/\/ vitals are guest-local truth in hero mode/.test(hostSrc)
		|| /hero mode: the wound is FORWARDED, not applied/.test(hostSrc),
		'hurtBody forwards for hero bodies instead of applying');
	assert.ok(/if\(Number\.isFinite\(pl\.hp\)\) b\.hp = Math\.max\(0, Math\.min\(NET\.HERO_RULES\.HP_MAX, \+pl\.hp\)\);/.test(hostSrc),
		'claimed hero vitals are clamped display/targeting state');
	assert.ok(/if\(!entry\.heroMode && b\.dead && t >= b\.respawnAt\)/.test(hostSrc), 'the host never respawns a hero body — the guest does');
	// client: the fresh-kit rule (the HOST’s riches must not become guest-local truth)
	assert.ok(/if\(!returning && bridge\.ghostHeroFresh\) bridge\.ghostHeroFresh\(\);/.test(clientSrc),
		'a first-time hero starts FRESH — applyGameData’s host inventory never leaks into guest truth');
	assert.ok(/const hadPose = !!\(play\.on && play\.spawned\);/.test(clientSrc) && /hero\.spawned = hadPose;/.test(clientSrc),
		'a play→hero promotion claims its pose IMMEDIATELY — waiting for the pb echo raced and silenced the ppose uplink');
	assert.ok(/window\.damageHero\(amt, \{ cause:/.test(clientSrc), 'forwarded wounds run the real hero damage pipeline (armor parity)');
	assert.ok(/if\(hero\.on\)\{ held\.add\(\(e\.key \|\| ''\)\.toLowerCase\(\)\); return; \}/.test(clientSrc),
		'hero mode hands the input back to the real game (mirroring only the steering bits)');
	// the loot loop: pickups ride the fog/reach-validated play seam and credit the
	// guest's OWN inventory; chest TILES open through the host's real pipeline
	assert.ok(/bridge\.ghostPlayPickupAt\(px, py, \{ x: b\.x, y: b\.y \}\)/.test(hostSrc),
		'hero pickups reuse the fog-gated resource-only seam');
	assert.ok(/ghostHeroGain:\(key,qty\)=>\{/.test(mainSrc) && /RESOURCE_DEFS\.find\(r=>r\.key===key\)/.test(mainSrc),
		'the pickup yield credits guest inventory through a whitelisted key');
	assert.ok(/if\(MM\.ghostHeroIntents\) return MM\.ghostHeroIntents\.use\(tx,ty\);/.test(mainSrc)
		&& /if\(info && info\.chestTier\) return \{ok:!!tryOpenChestAt\(tx,ty\)\};/.test(mainSrc),
		'chest tiles open via the use intent — the HOST runs its real chest pipeline');
	// vending: the machine is WORLD economy — the vend runs host-side with a
	// CAPTURING loot sink and the ack banks the roll into the guest inventory
	assert.ok(/tId===T\.VENDING_MACHINE && VENDING && VENDING\.vendAt/.test(mainSrc)
		&& /gained\.push\(\[key,a\]\); return true;/.test(mainSrc),
		'guest vending captures the loot for the ack instead of the host inventory');
	assert.ok(/pl\.a === 'use' && pl\.ok && Array\.isArray\(pl\.loot\)/.test(clientSrc),
		'the guest banks the vend roll through the whitelisted-key gain seam');
	// gifts for hero guests land in the REAL inventory, not the play-mode pouch
	assert.ok(/if\(te\.heroMode\)\{/.test(hostSrc) && /t: 'gift', key, n: count, label: took\.label \|\| key, hero: 1/.test(hostSrc),
		'a gift to a hero guest rides the ack (the pouch is play-mode state it never reads)');
	assert.ok(/if\(pl\.hero && hero\.on && pl\.key\)/.test(clientSrc), 'the hero guest banks host gifts via ghostHeroGain');
	// hero duels: the handshake is a BODY-level contract open to both embodied rungs
	assert.ok(/entry\.mode !== 'play' && !\(entry\.mode === 'hero' && pl\.a === 'duel'\)/.test(hostSrc),
		'the pact gate admits ONLY the duel handshake for hero guests');
	assert.ok(/if\(b\.duelWith && kind === 'hit'\)\{/.test(hostSrc) && /if\(e\.body\.duelWith !== entry\.gid\) break; \/\/ symmetry or nothing/.test(hostSrc),
		'a hero blow near the consenting partner wounds it — symmetry re-checked host-side');
	assert.ok(/if\(b\.dead && b\.duelWith\) endDuel\(s, entry\); \/\/ a hero death settles the duel too/.test(hostSrc),
		'a hero death settles the duel');
	assert.ok(/ownerGid: entry\.gid, duelGid: b\.duelWith \|\| null/.test(hostSrc)
		&& /splat:\(spec\.splat==='wet'\)\?'wet':undefined/.test(wsrcH),
		'hero projectiles carry host-stamped duel identity and a WORLD-INERT burst whitelist (wet only — no gascloud/fire)');
	// P0-2: a coop (guest) projectile is inert to the world — the arrow sim gates every
	// world-touching branch on !a.coopOwner (no world ignition, no gas detonation, no
	// gascloud/bomb splat), and the resolver never lets a coop shaft carry `fire`.
	assert.ok(/if\(a\.fire && !a\.coopOwner\)\{/.test(wsrcH), 'a coop arrow never detonates gas or ignites the world');
	assert.ok(/if\(!a\.fire && !a\.coopOwner && \(\(FIRE/.test(wsrcH), 'a coop arrow never catches fire in flight (no terrain ignition on impact)');
	assert.ok(/if\(a\.coopOwner\) return; \/\/ a guest projectile never detonates terrain/.test(wsrcH), 'a coop bomb splat is refused');
	// death: the grave is a WORLD mechanic — a hero guest keeps its inventory
	// (a replica-local grave would be stream-wiped and the halved resources lost)
	assert.ok(/if\(MM\.ghostHeroIntents\)\{\s*updateInventory\(\);\s*startDeathTravelFx\(cause\);\s*return;/.test(mainSrc),
		'a hero guest dies without the grave — no resource halving into a replica tile');
}

// --- ARCHITECTURE INVARIANTS (table-driven guardrails) ------------------------------------
// These fail when someone adds a hero intent without wiring every layer — the
// enforcement half of the checklist in CLAUDE.md. Adding an action to
// HERO_ACTIONS without a host branch, a rate floor and a client sender is a
// silent guest-only breakage in production; here it is a loud test failure.
{
	const FLOOR_OF = { mine: 'MINE_MS', place: 'PLACE_MS', dmg: 'DMG_MS', pickup: 'PICKUP_MS',
		use: 'USE_MS', shoot: 'SHOOT_MS', row: 'ROW_MS', board: 'BOARD_MS', unboard: 'BOARD_MS', tp: 'TP_MS',
		antenna: 'ANTENNA_MS' };
	for(const a of NET.HERO_ACTIONS){
		assert.ok(new RegExp("pl\\.a === '" + a + "'").test(hostSrc),
			"hero action '" + a + "' has a handleHeroAct branch on the host");
		const floor = FLOOR_OF[a];
		assert.ok(floor && Number.isFinite(NET.HERO_RULES[floor]) && NET.HERO_RULES[floor] > 0,
			"hero action '" + a + "' has a positive rate floor in HERO_RULES (" + floor + ")");
		assert.ok(new RegExp("NET\\.HERO_RULES\\." + floor).test(hostSrc),
			"the host branch for '" + a + "' actually reads its rate floor");
	}
	// every intent the client can SEND is a valid action (no orphan senders)
	const sent = [...clientSrc.matchAll(/t: 'hact', a: '([a-z]+)'/g)].map(m => m[1]);
	assert.ok(sent.length >= 7, 'the client sender surface is discoverable (' + sent.length + ' senders)');
	for(const a of sent) assert.ok(NET.validHeroAction(a), "client sends only whitelisted hero actions ('" + a + "')");
	// the hero frame must never grow a world system: the stream is the world
	const heroStep = mainSrc.slice(mainSrc.indexOf('function runHeroStep'), mainSrc.indexOf('function runHeroStep') + 3200);
	for(const banned of ['MOBS.update', 'WATER.update', 'FIRE.update', 'INVASIONS.update', 'SEASONS.update',
		'FALLING.update', 'BOSSES.update', 'GUARDIANS.update', 'MECHS.update(', 'BOATS.update', 'CLOUDS.update',
		'STORY_PROGRESSION.update']){
		assert.ok(!heroStep.includes(banned), 'runHeroStep must not simulate the world (' + banned + ' found)');
	}
	// the repo-level contract document travels with the code
	const claudeMd = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
	assert.ok(/three questions/i.test(claudeMd) && /hact intent \(checklist\)/i.test(claudeMd),
		'CLAUDE.md carries the multiplayer contract (three questions + intent checklist)');
}

// --- party HUD: one roster serves both ends, display truth only ---------------------------
// The feed is role-aware (host lists its embodied guests; an embodied guest lists
// the host + peers) and read-only: nothing in the party pipeline writes the world
// or sends a packet — it is a painter over state the streams already own.
{
	assert.ok(/import '\.\/engine\/party_hud\.js';/.test(mainSrc), 'main.js imports the party HUD module');
	assert.ok(/MM\.partyHud\.draw\(ctx,\{members:partyList,camX:camRenderX,camY:camRenderY,tile:TILE,zoom,W,H,heroX:player\.x,heroY:player\.y\}\)/.test(mainSrc),
		'the draw loop hands the party feed to the HUD with the standard view mapping');
	assert.ok(/GHOST_HOST\.active\(\) && GHOST_HOST\.partyMembers\)\?GHOST_HOST\.partyMembers\(\)/.test(mainSrc)
		&& /GHOST_CLIENT\.active\(\) && GHOST_CLIENT\.partyMembers\)\?GHOST_CLIENT\.partyMembers\(\):\[\]/.test(mainSrc),
		'the feed is role-aware: host accessor first, guest accessor as the fallback');
	assert.ok(/const partyList=ceremonyHold\?\[\]/.test(mainSrc), 'the party HUD steps aside for the title/finale ceremonies');
	assert.ok(/else MM\.partyHud\.hide\(\);/.test(mainSrc), 'a party of fewer than two hides the roster');
	// host feed: empty unless someone is embodied; self row is the session hero
	const hostFeed = hostSrc.slice(hostSrc.indexOf('function partyMembers'), hostSrc.indexOf('function partyMembers') + 900);
	assert.ok(/if\(!e\.body\) continue;/.test(hostFeed) && /if\(!list\.length\) return \[\];/.test(hostFeed),
		'the host party is its embodied guests — pure spectators are not a party');
	assert.ok(!/peer\.send|broadcast|setTile|hurtBody/.test(hostFeed), 'the host feed is read-only display truth');
	// guest feed: embodiment-gated; the host row rides the hero plane's display vitals
	const clientFeed = clientSrc.slice(clientSrc.indexOf('function partyMembers'), clientSrc.indexOf('function partyMembers') + 1100);
	assert.ok(/if\(!\(play\.on \|\| hero\.on\)\) return \[\];/.test(clientFeed), 'a pure spectator has no party roster');
	assert.ok(!/conn\.send|localStorage/.test(clientFeed), 'the guest feed is read-only display truth');
	assert.ok(/if\(Number\.isFinite\(pl\.hp\)\) remoteHost\.hp = pl\.hp;/.test(clientSrc),
		'the embodied guest keeps the host hp as DISPLAY truth on remoteHost (never applied to its own player)');
}

// --- shared story plane: broadcast-only display truth + the finale relay ------------------
// Guests see the host's quest list and arc stage (the join snapshot already
// carries them — this plane keeps them LIVE), and the closing ceremony plays on
// guest screens. No client packet may ever advance host story, and a spectator
// never mints its own layer completion from a watched world.
{
	assert.ok(/if\(t - s\.last\.story >= CAD\.story\) storyTick\(s, t\);/.test(hostSrc) && CADHasStory(hostSrc),
		'the story plane ticks on its own cadence');
	assert.ok(/if\(json === s\.lastStoryJson\) return; \/\/ sig-skip/.test(hostSrc), 'story silence costs nothing (sig-skip)');
	assert.ok(!/pl\.t === 'story'/.test(hostSrc), 'no client packet reaches host story — the plane is broadcast-only');
	assert.ok(/snapshotStory:\(\)=>\(\{/.test(mainSrc) && /fin:\(FINALE&&FINALE\.isOpen&&FINALE\.isOpen\(\)\)\?1:0/.test(mainSrc),
		'the story snapshot reuses the SAVE shapes (save codec = wire codec) + the finale flag');
	assert.ok(/if\(d\.tasks&&TASKS&&TASKS\.restore\) TASKS\.restore\(d\.tasks\);/.test(mainSrc)
		&& /if\(d\.story&&STORY_PROGRESSION&&STORY_PROGRESSION\.restore\) STORY_PROGRESSION\.restore\(d\.story\);/.test(mainSrc),
		'guest story state applies through the validating save restores');
	assert.ok(/finaleOpen:\(\)=>\{ try\{ if\(FINALE&&FINALE\.open&&!FINALE\.isOpen\(\)\) FINALE\.open\(\); \}catch\(e\)\{\} \}/.test(mainSrc),
		'the ceremony relay is OPEN-only');
	assert.ok(!/FINALE\.unlock|finale\.unlock/.test(clientSrc), 'a guest never unlocks its own layer from the stream');
	assert.ok(/if\(pl\.data\.fin && !finRelayed\)\{ finRelayed = true;/.test(clientSrc) && /if\(!pl\.data\.fin\) finRelayed = false;/.test(clientSrc),
		'the finale relay fires once per host ceremony opening and re-arms after it closes');
}
function CADHasStory(src){ return /story: \d+/.test(src.slice(src.indexOf('const CAD = {'), src.indexOf('const CAD = {') + 400)); }

// --- party-aware world pressure: the world happens around EVERYONE embodied ----------------
// Spawn/despawn used to anchor on the HOST hero alone — a guest exploring far
// away lived in an emptier, safer world. The anchors are host + coopBodies
// behind the same zero-cost solo guard every party reader uses.
{
	assert.ok(/function partyAnchors\(player\)/.test(mobsSrc)
		&& /MM\.coopBodies && MM\.coopBodies\.length\) \? MM\.coopBodies : null;/.test(mobsSrc),
		'the mobs anchor helper reads coopBodies behind the zero-cost solo guard');
	assert.ok(/if\(party\) player=party\[\(ecoAnchorTick\+\+\) % party\.length\];/.test(mobsSrc),
		'the eco spawn pass rotates between party members');
	assert.ok(/if\(despawnParty\) for\(const a of despawnParty\)\{ const d=Math\.abs\(m\.x-a\.x\); if\(d<dist\) dist=d; \}/.test(mobsSrc),
		'far-despawn keeps a mob while ANY party member is near it');
	assert.ok(/const anchor = partyPool \? partyPool\[i % partyPool\.length\] : player;/.test(invasionsSrc)
		&& /makeTeam\(anchor, getTile, \{/.test(invasionsSrc),
		'invasion landings rotate across the party (threat scaling stays host-derived via opts)');
}

// --- npc plane: the trader reaches the guests, trades stay guest-local ---------------------
// The registry's save shapes ride a low-Hz sig-skipped plane (save codec =
// wire codec). No trade arbitration exists to abuse: buy/sell exchange within
// ONE inventory, and a hero guest's inventory is already its own truth. The
// single world-touching offer — the epic chest spawn — refuses hero guests.
{
	assert.ok(/if\(t - s\.last\.npc >= CAD\.npc\) npcTick\(s, t\);/.test(hostSrc), 'the npc plane ticks on its own cadence');
	assert.ok(/if\(json === s\.lastNpcJson\) return; \/\/ sig-skip/.test(hostSrc), 'npc silence costs nothing');
	assert.ok(!/pl\.t === 'npcs'/.test(hostSrc), 'no client packet reaches host NPCs — broadcast-only');
	assert.ok(/snapshotNpcs:\(\)=>\(\(NPCS&&NPCS\.snapshot\)\?NPCS\.snapshot\(\):null\)/.test(mainSrc)
		&& /restoreNpcs:\(d\)=>\{ try\{ if\(NPCS&&NPCS\.restore\) NPCS\.restore\(d\); \}catch\(e\)\{\} \}/.test(mainSrc),
		'the npc plane rides the validating save codec');
	const traderSrc = readFileSync(new URL('../src/engine/trader.js', import.meta.url), 'utf8');
	assert.ok(/if\(root\.MM && root\.MM\.ghostHeroIntents\) return \{ok:false, reason:'Skrzynię przy kramie stawia tylko gospodarz'\};/.test(traderSrc),
		'the epic chest (the one world-touching trade) refuses hero guests');
}

// --- world fork: consent-only grant, ONE narrow storage exit, nothing syncs back ----------
// The guest already holds the entire world (the join snapshot IS the host's
// save object) — a fork is host consent + a local commit + a solo reboot. The
// storage lockdown's allowlist stays closed: the commit rides a dedicated
// armed hatch, and only the host-granted dispatcher branch can arm it.
{
	const grantSlice = hostSrc.slice(hostSrc.indexOf('function forkGrant'), hostSrc.indexOf('// Host gifting'));
	assert.ok(/te\.peer\.send\(\{ t: 'forkGrant' \}\)/.test(grantSlice), 'the host grant sends consent and nothing else');
	assert.ok(/lastForkGrantAt/.test(grantSlice), 'the grant is deduped per viewer');
	assert.ok(!/setTile|buildSave|\binv\b|pouch/.test(grantSlice), 'the grant moves no state — consent only');
	// exactly one site arms the hatch, and it is the host-granted branch
	assert.equal([...clientSrc.matchAll(/MMR\.ghostForkArmed = true/g)].length, 1, 'exactly one site arms the fork hatch');
	assert.ok(/pl\.t === 'forkGrant'/.test(clientSrc), 'and it is the forkGrant dispatcher branch (locked host connection only)');
	assert.ok(/if\(!MMR\.ghostForkArmed\) return false;/.test(clientSrc)
		&& /key !== 'mm_save_v7' && key !== 'mm_challenge_v1'/.test(clientSrc)
		&& /key !== 'mm_save_slots_meta_v1' && !key\.startsWith\('mm_slot_fork_'\)\) return false;/.test(clientSrc),
		'the hatch admits exactly: main save, challenge marker, slot index, fork-scoped backup slots — only while armed');
	// the backup can never clobber a player's existing named saves: the slot key
	// is minted under the fork-scoped prefix and the index is append-only
	assert.ok(/const slotId='fork_'\+Date\.now\(\)\.toString\(36\);/.test(mainSrc)
		&& /MM\.ghostForkWrite\('mm_slot_'\+slotId, prev\)/.test(mainSrc)
		&& /meta\.push\(\{id:slotId, name:'Świat sprzed rozwidlenia', time:Date\.now\(\), seed:prevSeed\}\);/.test(mainSrc),
		'an existing solo save is backed up into a fork-scoped named slot before the overwrite');
	assert.ok(/origSet\.call\(window\.localStorage, key, String\(v\)\)/.test(clientSrc),
		'the hatch uses the ORIGINAL setItem — the lockdown allowlist stays closed');
	assert.ok(/MMR\.ghostForkArmed = false; \/\/ one-shot: used or failed, the hatch closes/.test(clientSrc)
		&& /MMR\.ghostForkArmed = false; \/\/ a declined offer leaves the hatch closed/.test(clientSrc),
		'accepting or declining disarms the hatch');
	// main.js: the audited commit is the only ghost-mode main-save writer
	assert.ok(/commitForkSave:\(\)=>\{/.test(mainSrc) && /MM\.ghostForkWrite\(SAVE_KEY, JSON\.stringify\(withHash\)\)/.test(mainSrc),
		'the commit seam writes the hash-stamped LIVE save through the hatch');
	assert.ok(/if\(MM\.ghostMode\) return false; \/\/ ghost sessions never write saves/.test(mainSrc),
		'the regular save path still refuses ghost mode (the hatch is the only exit)');
	assert.ok(/mods\.length\) MM\.ghostForkWrite\('mm_challenge_v1'/.test(mainSrc),
		'a cursed world forks WITH its curse (the run marker rides along)');
	assert.ok(/location\.href = location\.pathname;/.test(clientSrc),
		'the accepted fork reboots into the bare path — solo play on the committed save');
	assert.ok(/if\(state !== 'live'\)\{ dismissForkOffer\(\); return; \}/.test(clientSrc),
		'accepting requires a LIVE stream — a ban or dead session after the grant cannot cash it in');
	assert.ok(/if\(!MM\.ghostForkArmed\) return false; \/\/ no grant, no work/.test(mainSrc),
		'the commit seam checks the armed hatch BEFORE building the save');
}

// …which is exactly why Kopiuj must RELEASE the focus it took: select() leaves the
// caret in the link INPUT, the guard above then freezes the panel body forever and
// the host never sees the joining viewer's row (the field-report screenshot bug)
assert.ok(/inp\.select\(\);[\s\S]{0,450}inp\.blur\(\);/.test(hostSrc),
	'copying the invite link blurs the input — the panel keeps refreshing afterwards');

// --- entry point: a first-class HUD icon, not a row in the ≡ menu ------------------------------------
assert.ok(/id="ghostBtn"/.test(html) && /id="ghostBtnCount"/.test(html), 'index.html carries the 👁 viewers button with its live count');
assert.ok(/<div id="menuWrap">[\s\S]{0,400}id="ghostBtn"/.test(html), 'the viewers button sits in the top bar next to the menu');
assert.ok(/function mountEntryPoint\(\)/.test(hostSrc) && /document\.getElementById\('ghostBtn'\)/.test(hostSrc),
	'the host binds the HUD button (the panel is no longer buried in the debug menu)');
assert.ok(!/getElementById\('menuPanel'\)/.test(hostSrc), 'no menu-panel injection survives');
assert.ok(/body\.mmGhostMode #menuWrap/.test(clientSrc), 'a watcher never sees the host-only viewers button (menuWrap is hidden in ghost mode)');
// per-session default permission for newcomers — the SAFE FLOOR is watch-only, and
// the host raises the door policy by hand (P0-3: no viewer starts with influence)
assert.ok(/let defaultMode = 'watch';/.test(hostSrc) && /mode: defaultMode,/.test(hostSrc), 'joining ghosts default to the watch-only floor');
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
assert.ok(/id="ghostPanelBenefits"/.test(hostSrc) && /✓ Korzyści/.test(hostSrc) && /świat pozostaje pod kontrolą gospodarza/.test(hostSrc),
	'the host panel explains the encrypted, host-authoritative multiplayer benefits');
assert.ok(/id="ghostPanelSafety"/.test(hostSrc) && /Tryb tylko dla znajomych/.test(hostSrc)
	&& /Link jest wspólnym kluczem dostępu/.test(hostSrc) && /mogą próbować podszyć się podczas łączenia/.test(hostSrc) && /pełny bohater/.test(hostSrc),
	'the host panel clearly warns against public links and reserves full-hero authority for trusted friends');
assert.ok(/function showSafetyNotice\(\)/.test(clientSrc) && /id = 'ghostSafetyNotice'/.test(clientSrc)
	&& /Multiplayer tylko dla znajomych/.test(clientSrc) && /showSafetyNotice\(\);/.test(clientSrc),
	'a joining friend sees the trust-and-benefits notice after the first successful world sync');
assert.ok(/P2P może ujawnić drugiemu uczestnikowi/.test(clientSrc) && /użycie TURN także operatorowi przekaźnika/.test(clientSrc)
	&& /treść połączenia pozostaje szyfrowana/.test(clientSrc),
	'the friend-facing notice describes network-metadata exposure without implying plaintext relay traffic');

// --- pings: a watcher points, nobody aims -----------------------------------------------------------
assert.ok(NET.PING.MIN_MS >= 2000 && NET.PING.TTL_MS > 0, 'pings are rate-limited and transient');
{
	const pingSlice = hostSrc.slice(hostSrc.indexOf('function handlePing'), hostSrc.indexOf("--- the host's own voice"));
	assert.ok(pingSlice.length > 40, 'handlePing found');
	assert.ok(/const pos = trackedPos\(entry\);/.test(pingSlice) && /!NET\.modeAllows\(entry\.mode, 'chat'\) \|\| !pos\) return;/.test(pingSlice), 'pings need at least chat permission and a tracked pose');
	assert.ok(/t - \(entry\.lastPingAt \|\| 0\) < NET\.PING\.MIN_MS\) return;/.test(pingSlice), 'pings are rate-limited per watcher');
	assert.ok(/x: \+pos\.x\.toFixed\(2\), y: \+pos\.y\.toFixed\(2\)/.test(pingSlice) && !/pl\.x|pl\.y/.test(pingSlice),
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
for(const [ev, pat] of [['buff', /noteActionFx\(s, \{ kind: 'buff', hero: 1/], ['power', /noteActionFx\(s, \{ kind: 'power', power: kind, x: pos\.x/], ['assist', /noteActionFx\(s, \{ kind: 'assist', hero: 1/], ['ping', /noteActionFx\(s, \{ kind: 'ping', x: pos\.x/]]){
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
assert.ok(/s\.snapCache = null; s\.sinceCache\.length = 0;\s*\n\s*if\(MMR\) MMR\.coopBodies = \[\];[^\n]*\n\s*reap\(s, t\);/.test(hostSrc),
	'an emptied audience invalidates the snapshot cache AND clears MM.coopBodies (no phantom body left for creatures once the last peer leaves)');
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
assert.ok(/DEFAULT_MODES = NET\.PERMISSION_MODES\.filter\(m => m !== 'play' && m !== 'hero'\)/.test(hostSrc),
	'both embodied rungs are excluded from the newcomer default (an embodied stranger by default is a griefing invite)');
assert.ok(/if\(!DEFAULT_MODES\.includes\(mode\)\) return false;/.test(hostSrc), 'setDefaultMode refuses the embodied rungs');
// granting play spawns a HOST-owned body; revoking removes it — spectating persists
assert.ok(/const embodied = \(mode === 'play' \|\| mode === 'hero'\);/.test(hostSrc)
	&& /if\(embodied && !entry\.body && !spawnBody\(session, entry\)\)\{[\s\S]{0,140}entry\.mode = 'full'; entry\.heroMode = false;/.test(hostSrc)
	&& /else if\(!embodied && entry\.body\) despawnBody\(session, entry\);/.test(hostSrc)
	&& /entry\.heroMode = mode === 'hero';/.test(hostSrc),
	'both embodied rungs require a safe host-tracked body; failed spawn/downgrade returns to the influence-only floor');
// vitals & pouch are HOST state, streamed to the guest as display truth
assert.ok(/function sendVitals\(s, entry\)/.test(hostSrc) && /t: 'pvit'/.test(hostSrc), 'the host owns and streams the guest vitals + pouch');
assert.ok(/function hurtBody\(s, entry/.test(hostSrc) && /b\.invulUntil = t \+ NET\.PLAY_RULES\.HURT_INVUL_MS/.test(hostSrc),
	'guest damage is host-decided with i-frames; death and respawn are host-owned');
assert.ok(/requestedKb[^\n]*Math\.min\(12/.test(hostSrc) && /requestedKbY[^\n]*Math\.max\(-10/.test(hostSrc)
	&& /hurt: \(a, sx, sy, c, o\) => hurtBody\(s, entry, a, sx, sy, c, o\)/.test(hostSrc),
	'host-authored attacks can request bounded knockback for guest bodies, including molekin charges');
// the movement envelope: a claimed pose is clamped to MAX_SPEED AND resolved out of
// solids by a swept AABB against the host tiles (P0-6: no wall/bedrock tunnelling)
assert.ok(/pl\.t === 'ppose'/.test(hostSrc) && /bridge\.ghostBodySolidAt\(tx, ty, axis, probe, openTrapdoor\)/.test(hostSrc)
	&& /NET\.sweepBodyMove\(\{ x: b\.x, y: b\.y, w: NET\.PLAY_RULES\.BODY_W, h: NET\.PLAY_RULES\.BODY_H \}, \+pl\.x, \+pl\.y, maxStep, solidAt, bounds\)/.test(hostSrc),
	'the guest pose is followed inside a speed envelope AND swept against host tiles (a wall-tunnel hack is stopped at the wall)');
// P0-6: an embodied guest's camera (which powers/pings/actions originate from) is the
// ACCEPTED collision-resolved body position, never the raw client claim
assert.ok(/if\(b\)\{ entry\.cam = \{ x: b\.x, y: b\.y \}; \}/.test(hostSrc),
	'an embodied guest aims from its accepted body position, not a spoofable camera claim');
// the movement budget is real elapsed time, never per-message: a synthetic dt floor
// would let a claim-spamming client outrun MAX_SPEED (120 msg/s × 16 ms credited each)
assert.ok(/const dtS = Math\.min\(0\.5, Math\.max\(0, \(t - \(b\.lastPoseAt \|\| t\)\) \/ 1000\)\);/.test(hostSrc),
	'pose-claim movement budget accrues from real elapsed time only (no per-message floor)');
assert.ok(!/Math\.max\(0\.016,[^)]*b\.lastPoseAt/.test(hostSrc), 'the exploitable 16 ms per-claim floor stays dead');
// velocity is DERIVED from accepted movement — a spoofed vx/vy would mislead the
// party-aware attackers' predictive aim (they lead targets by vx/vy)
assert.ok(/b\.vx = Math\.max\(-40, Math\.min\(40, \(b\.x - px\) \/ dtS\)\);/.test(hostSrc)
	&& /b\.vy = Math\.max\(-40, Math\.min\(40, \(b\.y - py\) \/ dtS\)\);/.test(hostSrc),
	'body velocity derives from host-accepted movement, never from the client claim');
assert.ok(!/b\.vx = Number\.isFinite\(pl\.vx\)/.test(hostSrc), 'the claimed velocity is never trusted');
// EVERY world-touching intent funnels through one validated handler
assert.ok(/function handlePlayAct\(s, entry, pl\)/.test(hostSrc) && /pl\.t === 'pact'/.test(hostSrc),
	'every guest world intent lands in one host-side handler');
assert.ok(/if\(b\.dead\)\{ entry\.peer\.send\(\{ t: 'pactAck', a: pl\.a, ok: false, reason: 'dead'/.test(hostSrc), 'a dead guest cannot act');
assert.ok(/if\(!NET\.playReachOk\(b\.x, b\.y, tx, ty\)\)/.test(hostSrc), 'reach is enforced against the HOST-tracked body pose');
assert.ok(/\(pl\.a === 'mine' \|\| pl\.a === 'place'\) && !guestTargetClear\(b, tx, ty\)/.test(hostSrc),
	'zero-trust play edits also require a clear body-origin target path');
assert.ok(/if\(!\(Number\(b\.pouch\[key\]\) > 0\)/.test(hostSrc), 'building spends only what the host-owned pouch holds');
assert.ok(/bridge\.ghostPlayMineAt\(tx, ty\)/.test(hostSrc) && /bridge\.ghostPlayPlaceAt\(tx, ty, key/.test(hostSrc)
	&& /bridge\.ghostPlayAttack\(/.test(hostSrc), 'intents resolve through the guarded bridge seams');
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
assert.ok(/ghostPlayAttack:\(body,spec,aimX,aimY\)=>\{/.test(mainSrc) && /W\.coopMeleeAt/.test(mainSrc),
	'guest melee routes through the attributed co-op weapon inlet');
assert.ok(!NET.validPlayAction('strike') && !/ghostPlayStrike:\(/.test(mainSrc),
	'the obsolete free area strike is not a network action or bridge capability');
assert.ok(/drawHeroAt:\(st\)=>\{/.test(mainSrc) && /drawPlayer\(\{remoteBody:true, cloaked:!!st\.cloaked\}\)/.test(mainSrc),
	'remote heroes render through the REAL hero painter via a field swap (a player looks like a player; antenna cloak rides along)');
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
assert.ok(/if\(play\.on \|\| hero\.on\)\{[\s\S]{0,200}remoteHost\.has = true;/.test(clientSrc),
	'in both embodiments the host hero becomes a remote body — its vitals never clobber the guest');
// hero mode: the guest owns its WHOLE player state across a resync too
assert.ok(/const keepHero = \(hero\.on && bridge\.ghostHeroCapture\) \? bridge\.ghostHeroCapture\(\) : null;/.test(clientSrc)
	&& /if\(keepHero && bridge\.ghostHeroRestore\) bridge\.ghostHeroRestore\(keepHero\);/.test(clientSrc),
	'a hero guest keeps ITS inventory/gear/XP across a mid-session resync');
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
	assert.ok(/function hurtPartyTarget\(tgt,dmg,opts\)\{\s*\n\s*if\(tgt && typeof tgt\.hurt==='function'\)\{ tgt\.hurt\(dmg,opts\.srcX,opts\.srcY,opts\.cause,opts\); return; \}/.test(inv),
		'invader damage routes through body.hurt() for a guest target, damageHero for the host');
	assert.ok(/const tgt = nearestPartyMember\(a\.x,a\.y,player\);[\s\S]{0,200}const px = tgt && Number\.isFinite\(tgt\.x\) \? tgt\.x : a\.x;/.test(inv),
		'updateAlien tracks (melee + facing) the nearest party member');
	assert.ok(/!isMolekinTeam\(team\) && dist < profile\.meleeRange/.test(inv)
		&& /hurtPartyTarget\(tgt, Math\.max\(1,Math\.round\(3 \* \(Number\(a\.damageMult\) \|\| 1\)\)\)/.test(inv),
		'UFO aliens retain close melee while molekin use their separate charge/throw system');
	assert.ok((inv.match(/const tgt = nearestPartyMember\(a\.x,a\.y,player\);/g) || []).length >= 2,
		'both UFO lasers and molekin attacks retarget to the nearest party member');
	assert.ok(/Number\.isFinite\(tgt\.vx\) \? tgt\.x \+ tgt\.vx \* 0\.08 : tgt\.x/.test(inv) && /Number\.isFinite\(tgt\.vx\) \? tgt\.x \+ tgt\.vx \* 0\.10 : tgt\.x/.test(inv),
		'charged UFO aim and physical molekin throws can lead the selected host or guest target before locking');
	assert.ok(/const partyHit=!c\.tileAim \? partyTargetOnLaser\(ox,oy,hit\.x,hit\.y,player\) : null;/.test(inv)
		&& /hurtPartyTarget\(partyHit,Math\.max\(1,Math\.round\(\(5\+Math\.min\(6,Math\.floor\(threat\/5\)\)\)\*dmgMult\)\)/.test(inv)
		&& /if\(target\)\{\s*\n\s*hurtPartyTarget\(target,s\.damage/.test(inv)
		&& /hurtPartyTarget\(tgt,c\.damage,[^\n]*kb:8\.4/.test(inv),
		'charged UFO release, physical clod impacts and charge collisions all route host-authoritative party damage');
	assert.ok(/shots:moleShots\.slice\(-MOLE_SHOT_GHOST_CAP\)/.test(inv) && /chargeCode=Number\(p\[7\]\)\|0/.test(inv),
		'molekin projectiles and charge telegraphs are mirrored to multiplayer watchers');
	assert.ok(/a\.alienCharge \? 1 : 0/.test(inv) && /beams:lasers\.slice\(-16\)/.test(inv) && /Number\(p\[9\]\)/.test(inv),
		'Alien Team charge points and released beams are mirrored to multiplayer watchers');
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
// The guest NAMES an owned weapon and a world
// aim; the host checks ownership, cooldown and pouch ammo against ITS body state and
// resolves the blow through the real combat chains in weapons.js, attributed 'coop'.
// Nothing a guest fires may touch a tile, open a chest, or feed the host's ult.
{
	const w = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
	// melee resolves only against ordinary mobs, credited 'coop'
	const cm = w.slice(w.indexOf('function coopMeleeAt'), w.indexOf('function spawnCoopArrow'));
	assert.ok(/meleeTargetTile\(body,aimX,aimY,reach,false\)/.test(cm), 'coop melee clamps its target into the weapon reach box');
	assert.ok(/MM\.mobs\.attackAt\(tx,ty,bonus,\{source:'coop'\}\)/.test(cm),
		'coop melee runs the ordinary-mob chain with coop attribution');
	assert.ok(!/MM\.(?:invasions|guardianLairs|undergroundBoss|skyGuardian|bosses|ufo)\./.test(cm),
		'coop melee cannot enter special defeat/story systems');
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
	assert.ok(/const leaseOwner = WATCH \? \('d' \+/.test(clientSrc)
		&& /gidLease = createGidLeaseController\(localStorage, base, leaseOwner\);/.test(clientSrc)
		&& /if\(mine === base && !gidLease\.claim\(\)\) mine = gidMint\(\);/.test(clientSrc),
		'each document must win an owner-nonce lease before sending the stable base gid');
	assert.ok(/if\(!WATCH\) return gidMint\(\);/.test(clientSrc), 'host pages never write the ghost identity keys');
	assert.ok(/if\(held && \(held\.gid !== gid \|\| held\.owner !== owner\)\) return false;/.test(clientSrc)
		&& /return !!won && won\.gid === gid && won\.owner === owner;/.test(clientSrc),
		'a heartbeat refuses a fresh other owner and confirms its write before claiming victory');
	assert.ok(/function releaseGidLease\(ownerGid\)/.test(clientSrc)
		&& /if\(!row \|\| row\.gid !== gid \|\| row\.owner !== owner\) return false;/.test(clientSrc)
		&& /if\(!ev\.persisted\) releaseGidLease\(gid\)/.test(clientSrc),
		'only the exact document owner releases the base gid while bfcache pages retain their live lease');
	assert.ok(/window\.addEventListener\('pageshow', \(\) => \{ reconcileGidLease\(\); refreshResumeCredential\(true\); \}\)/.test(clientSrc)
		&& /ev\.key === NET\.GID_LEASE_KEY \|\| ev\.key === NET\.GID_KEY/.test(clientSrc)
		&& /function rotateLeaseConflictIdentity\(\)/.test(clientSrc)
		&& /function restartForLeaseConflict\(\)/.test(clientSrc),
		'pageshow and storage conflicts re-arbitrate, rotate the losing document and reconnect it ephemerally');
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
	assert.ok(/const BODY_KEEP_VERSION = 2;/.test(hostSrc)
		&& /JSON\.stringify\(\{ v: BODY_KEEP_VERSION, entries: rows\.slice\(0, BODY_KEEP_MAX\) \}\)/.test(hostSrc)
		&& /room: entry\.room,[\s\S]{0,80}gid: entry\.gid,[\s\S]{0,180}rt: entry\.resumeToken,/.test(hostSrc)
		&& /restoreBodyFor\(s\.room, entry\.gid, entry\.body, entry\.resumeToken\);/.test(hostSrc),
		'a returning gid gets only its versioned, room-and-proof-bound kept body back on spawn');
	assert.ok(/raw\.length > BODY_KEEP_RAW_MAX/.test(hostSrc)
		&& /o\.v === BODY_KEEP_VERSION && Array\.isArray\(o\.entries\)/.test(hostSrc)
		&& !/row\.legacy|snap\.legacy|const legacy = rows/.test(hostSrc),
		'oversized, unknown-version and all room-unbound legacy body stores fail closed');
	assert.ok(/function canonicalBodyKeepRow\(snap, at\)/.test(hostSrc)
		&& /return \{ room: snap\.room, gid: snap\.gid, pouch, weapons, rt: snap\.rt, ts: savedAt \};/.test(hostSrc)
		&& /key === 'prototype' \|\| key === 'constructor'/.test(hostSrc)
		&& /if\(weapons\.length >= 8\) break;/.test(hostSrc),
		'every retained body row is rebuilt into an exact bounded pouch/weapon schema');
	assert.ok(/const rows = freshBodyKeepRows\(\)\.filter\(row => !\(row\.gid === entry\.gid && row\.room === entry\.room\)\);/.test(hostSrc)
		&& /entries: rows\.slice\(0, BODY_KEEP_MAX\)/.test(hostSrc),
		'banking replaces only the same room/gid row, preserving other rooms under one global bound');
	assert.ok(/body\.pouch = \{\};[\s\S]{0,300}NET\.pouchAdd\(body\.pouch, k, n\);/.test(hostSrc),
		'the kept pouch REPLACES the starter pouch (no rejoin ammo farming) and re-clamps every count');
	assert.ok(/if\(NET\.validPlayWeapon\(k\) && !body\.weapons\.includes\(k\)\) body\.weapons\.push\(k\);/.test(hostSrc),
		'kept weapons pass the arsenal whitelist again on restore (disk is hostile input)');
	assert.ok(/function despawnBody\(s, entry\)\{\s*\n\s*if\(!entry\.body\) return;[\s\S]{0,100}endDuel\(s, entry, true\);[^\n]*\n[\s\S]{0,140}keepBody\(entry\);/.test(hostSrc),
		'demote/leave forfeits any duel, vacates any cab and banks the body');
	// P0-7: a dropped connection tears the body down through ONE centralized path —
	// settle the duel, eject from the mech cab (no phantom rider), bank the pouch, then
	// stash the SAME body object so a token-proven reconnect resumes hp/status/pos/cds
	assert.ok(/if\(entry\.body\)\{\s*\n\s*endDuel\(s, entry, true\);\s*\n[\s\S]{0,160}guestUnboard\(entry\.gid\);[\s\S]{0,120}keepBody\(entry\);/.test(hostSrc),
		'a dropped connection ends the duel, vacates the mech cab and banks the body — one teardown path');
	assert.ok(/s\.modeMemory\.set\(entry\.gid, \{ mode: entry\.mode, ts: now\(\), body: entry\.body \}\);/.test(hostSrc),
		'the reconnect memory carries the authoritative body (hp/status/pos/cooldowns) — reconnect resumes, never heals');
	assert.ok(/entry\.body = kept\.body;/.test(hostSrc) && /entry\.body\.duelWith = null;/.test(hostSrc),
		'a token-proven reconnect reattaches the preserved body (not a fresh full-HP spawn)');
	assert.ok(/mode === 'play' && wasHero && entry\.body/.test(hostSrc) && /entry\.body\.maxHp = Math\.min\(entry\.body\.maxHp \|\| NET\.PLAY_RULES\.MAX_HP, NET\.PLAY_RULES\.MAX_HP\);/.test(hostSrc),
		'a hero→play demotion clamps the body into the play HP pool');
	assert.ok(/if\(wasHero && mode === 'play'\)\{[\s\S]{0,180}guestUnboard\(entry\.gid\);/.test(hostSrc),
		'a hero→play demotion vacates the mech even though it keeps the body');
	assert.ok(/keepAllBodies\(s\); \/\/ slow-cadence flush/.test(hostSrc)
		&& /for\(const entry of Array\.from\(ending\.peers\.values\(\)\)\) dropPeer\(ending, entry, true\);/.test(hostSrc),
		'the reap tick banks bodies and session stop routes every peer through centralized teardown');
	assert.ok(/ending\.closed = true;/.test(hostSrc)
		&& /if\(!s \|\| s\.closed \|\| s !== session \|\| !entry \|\| !s\.peers\.has\(entry\.peer\)\) return;/.test(hostSrc)
		&& /entry\.peer\.onMessage = null;/.test(hostSrc),
		'a stopped/dropped session rejects queued messages and detaches the peer callback before close');
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
	assert.ok(/if\(!entry\.heroMode && !b\.dead && dt > 0\) bodySurvivalPass\(s, entry, b, dt, t\);/.test(hostSrc),
		'the pass runs on the body cadence for LIVE play-mode bodies only — hero vitals are guest-local (double-damage guard)');
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
	assert.ok(/b\.poseSeq = \(Number\(pl\.q\) >>> 0\) \|\| 0;/.test(hostSrc) && /b\.dead \? 1 : 0, b\.poseSeq \|\| 0, \(\(b\.cloakUntil \|\| 0\) > t\) \? 1 : 0\]\);/.test(hostSrc),
		'the host sanitizes the seq and echoes it in the own pb row (cloak flag rides at the tail)');
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
	assert.ok(/przekaźnik TURN/.test(hostSrc), 'the invite panel documents the P2P + TURN-relay connectivity story');
	assert.ok(/turn:openrelay/.test(netSrc) && /turns:openrelay/.test(netSrc),
		'the RTC config carries a TURN relay for restrictive NATs (STUN-only left some guests unable to join)');
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
	assert.ok(/const reverseKey = NET\.duelAskKey\(te\.gid, entry\.gid\);/.test(hostSrc)
		&& /s\.duelAsks\.set\(NET\.duelAskKey\(entry\.gid, te\.gid\), tD\);/.test(hostSrc),
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
	assert.ok(/Math\.min\(NET\.PLAY_RULES\.GIFT_MAX, room, Math\.floor\(Number\(n\) \|\| 0\)\)/.test(hostSrc),
		'gift size is bounded by GIFT_MAX and by the pouch headroom');
	// pouchAdd clamps at POUCH_CAP — a gift must be clamped to the headroom BEFORE
	// the host inventory is charged, or the overflow is silently destroyed
	assert.ok(/const room = NET\.PLAY_RULES\.POUCH_CAP - \(Number\(te\.body\.pouch\[key\]\) \|\| 0\);/.test(hostSrc)
		&& /if\(room < 1\)/.test(hostSrc),
		'a full pouch refuses the gift instead of vaporizing the host stock');
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
	assert.ok(/gid: entry\.gid, look: entry\.look \|\| null, cloaked: \(b\.cloakUntil \|\| 0\) > now\(\) \}\);/.test(hostSrc) && /gid: b\.id, look: looks\[b\.id\] \|\| null, cloaked: !!b\.cloaked \}\);/.test(clientSrc),
		'both body painters tag the gid AND the chosen look (plus the antenna cloak flag) so every renderer paints the same player the same way');
	// the chosen look: guest-picked, HOST-validated strict hex, relayed + late-joiner
	// synced, persisted client-side like the avatar — display-only end to end
	assert.ok(/pl\.t === 'plook'/.test(hostSrc) && /entry\.body && NET\.validLookColor\(pl\.c\) && tL - \(entry\.lastLookAt \|\| 0\) >= NET\.PLAY_RULES\.LOOK_MS/.test(hostSrc),
		'a look change is embodied-only, strict-hex validated and rate-floored on the host');
	assert.ok(/if\(other !== entry && other\.look\)\{ try\{ entry\.peer\.send\(\{ t: 'plook', gid: other\.gid, c: other\.look \}\)/.test(hostSrc),
		'a late joiner receives every known look right after the snapshot');
	assert.ok(/if\(NET\.validGid\(pl\.gid\) && NET\.validLookColor\(pl\.c\)\)/.test(clientSrc),
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
	assert.ok(/ownerGid:coopGid\(opts\.ownerGid\),/.test(wsrc)
		&& /duelGid:coopGid\(opts\.duelGid\)/.test(wsrc),
		'a coop arrow carries HOST-stamped owner/duel identity');
	const da = wsrc.slice(wsrc.indexOf('// consensual duel arrows'), wsrc.indexOf('const creatureGate'));
	assert.ok(/const owner=duelBodies\.find\(bb=>bb && bb\.gid===a\.ownerGid && !bb\.dead\);/.test(da)
		&& /const target=duelBodies\.find\(bb=>bb && bb\.gid===a\.duelGid && !bb\.dead/.test(da)
		&& /owner\.duelWith===a\.duelGid && target\.duelWith===a\.ownerGid/.test(da)
		&& /target\.hurt\(a\.dmg, a\.x, a\.y, 'duel'\);/.test(da),
		'a duel arrow requires both live bodies and mutual consent at impact');
	assert.ok(!/damageHero|bridge\.player/.test(da), 'a duel arrow can never touch the host hero');
	assert.ok(/entry\.bodyLike\.duelWith = b\.duelWith \|\| null;/.test(hostSrc) && /entry\.bodyLike = \{ gid: entry\.gid,/.test(hostSrc),
		'bodyLike carries gid + live duel consent for impact-time checks');
}

// Dynamic passable->solid writers must use the same current-session footprint
// predicate as weather/falling. These source pins cover the bounded legacy paths
// whose engine sims do not expose a convenient deterministic write hook.
{
	const fireSrc = readFileSync(new URL('../src/engine/fire.js', import.meta.url), 'utf8');
	const volcanoSrc = readFileSync(new URL('../src/engine/volcano.js', import.meta.url), 'utf8');
	const undergroundSrc = readFileSync(new URL('../src/engine/underground_boss.js', import.meta.url), 'utf8');
	const dynamicWeaponsSrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
	assert.ok((invasionsSrc.match(/authoritativeBodyBlocksCell\(tx,ty\)/g) || []).length >= 4,
		'invasion barricade/ramp validation and write boundaries both protect guest footprints');
	assert.ok((fireSrc.match(/!authoritativeBodyBlocksCell\(L\.x,L\.y\)/g) || []).length >= 3,
		'lava water-contact and air-cooling crust conversions defer under guest bodies');
	assert.ok(/!authoritativeBodyBlocksCell\(rest\.x,rest\.y\)/.test(volcanoSrc)
		&& /if\(authoritativeBodyBlocksCell\(rest\.x,rest\.y\)\) return false;/.test(volcanoSrc),
		'ordinary and master volcanic rocks cannot settle through a guest footprint');
	assert.ok(/!authoritativeBodyBlocksCell\(tx,ty\) && Math\.random\(\)<QUENCH_CHANCE/.test(dynamicWeaponsSrc),
		'a hose cannot quench passable lava into solid obsidian through a guest body');
	assert.ok(/if\(next!==T\.AIR && authoritativeBodyBlocksCell\(tx,ty\)\) continue;/.test(undergroundSrc),
		'the underground boss crater may excavate under a body but cannot deposit solid fallback rock through it');
}

console.log('ghost-sim: all assertions passed');
