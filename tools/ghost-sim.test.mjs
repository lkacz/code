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
assert.deepEqual(NET.PERMISSION_MODES, ['watch', 'chat', 'full'], 'the three-mode ladder');
assert.ok(NET.validPermissionMode('watch') && !NET.validPermissionMode('admin'), 'mode validation');
assert.ok(NET.AVATARS.length >= 6 && NET.validAvatar('duszek') && !NET.validAvatar('<img>'), 'avatar registry validates');

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
	const playerAt = mainSrc.indexOf('drawPlayer();', bodyAt);
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
assert.ok(!/localStorage\.setItem\((?!'mm_ghost_(name|avatar)_v1'|NET\.PROG_KEY)/.test(clientSrc),
	'client persists nothing but its display name, avatar and own career');
assert.ok(/Storage\.prototype\.setItem = function/.test(clientSrc) && /allow = new Set\(\['mm_ghost_name_v1', 'mm_ghost_avatar_v1', NET\.PROG_KEY\]\)/.test(clientSrc),
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
assert.ok(/entry\.mode !== 'full'\)\{ entry\.peer\.send\(\{ t: 'buffAck', kind: pl\.kind, ok: false, waitMs: 0, reason: 'perm' \}\)/.test(hostSrc),
	'buffs require the full permission mode');
assert.ok(/entry\.mode !== 'chat' && entry\.mode !== 'full'\)\) return;/.test(hostSrc), 'chat requires at least the chat mode');
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
assert.ok(/if\(!e\.hello \|\| e\.actUntil <= t\) continue;[\s\S]*if\(e\.cam\)\{ spirits\.push\(\{ x: e\.cam\.x, y: e\.cam\.y \}\); owners\.push\(e\); \}/.test(hostSrc),
	'ONLY active watchers haunt the world (an idle tab is furniture, not a phantom), and each spirit remembers its owner');
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
assert.ok(/if\(entry\.mode !== 'full'\)\{ entry\.peer\.send\(\{ t: 'powerAck', kind, ok: false, reason: 'perm'/.test(hostSrc), 'powers need the full permission mode');
assert.ok(/if\(entry\.charge < rule\.cost\)/.test(hostSrc) && /entry\.charge -= rule\.cost;/.test(hostSrc), 'powers cost earned charge');
assert.ok(/const hits = bridge\.ghostPower\(kind, entry\.cam\.x, entry\.cam\.y, rule\);/.test(hostSrc),
	'a power strikes at the SPIRIT position the host tracked — never at client-chosen coordinates');
assert.ok(/function chargeTick\(s, t\)/.test(hostSrc) && /NET\.chargeAfter\(entry\.charge, dt, wasActive\)/.test(hostSrc),
	'charge accrues only while the watcher is active');
assert.ok(/ghostPower:\(kind,x,y,rule\)=>\{/.test(mainSrc), 'the bridge exposes ghostPower');
assert.ok(!/ghostPower[\s\S]{0,900}setTile\(/.test(mainSrc), 'NO ghost power may edit a tile — creatures only, so a watcher can never grief the world');
assert.ok(/MOBS\.chillRadius/.test(mainSrc) && /MOBS\.blastRadius/.test(mainSrc) && /MOBS\.statusRadius\(x,y,r,'panic'/.test(mainSrc),
	'frost/smite/banish route through the existing mob AoE APIs');

// --- assistants: delegates, not second players ----------------------------------------------------------
assert.ok(/function setAssistant\(gid, on\)/.test(hostSrc), 'the host appoints assistants');
assert.ok(/if\(on && entry\.mode !== 'full'\) return false;/.test(hostSrc), 'an assistant must hold full permissions');
assert.ok(!/else if\(on && entry\.assistant\)/.test(hostSrc), 'the single-seat handover is GONE — several assistants may serve at once');
assert.ok(/if\(!entry\.assistant \|\| entry\.mode !== 'full'\)\{ entry\.peer\.send\(\{ t: 'assistAck', ok: false, reason: 'perm' \}\); return; \}/.test(hostSrc),
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
assert.ok(/allow = new Set\(\['mm_ghost_name_v1', 'mm_ghost_avatar_v1', NET\.PROG_KEY\]\)/.test(clientSrc),
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
	assert.ok(/entry\.mode === 'watch' \|\| !entry\.cam\) return;/.test(pingSlice), 'pings need at least chat permission and a tracked pose');
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

console.log('ghost-sim: all assertions passed');
