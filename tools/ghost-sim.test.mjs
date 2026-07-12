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
assert.ok(/GHOST_CLIENT\.drawSpirits\(ctx,TILE\)/.test(mainSrc) && /GHOST_HOST\.drawSpirits\(ctx,TILE\)/.test(mainSrc), 'spirit painters ride the draw pass');
assert.ok(/buildSaveObject\(\{perf:\{parts:\[\]\}\}\)/.test(mainSrc), 'bridge snapshot inlines chunks (no external autosave refs on the wire)');

// --- source pins: world.js diff capture --------------------------------------------------------
const worldSrc = readFileSync(new URL('../src/engine/world.js', import.meta.url), 'utf8');
assert.ok(/function notifyTileChanged\(x,y,old,v\)\{\s*try\{ if\(MM\.ghostHostTile\) MM\.ghostHostTile\(x,y,old,v\); \}catch\(e\)\{\}/.test(worldSrc),
	'ghost diff capture is the FIRST notifyTileChanged fan-out (sees every real tile change)');

// --- source pins: ghost_client boot contract ------------------------------------------------------
const clientSrc = readFileSync(new URL('../src/engine/ghost_client.js', import.meta.url), 'utf8');
assert.ok(/MMR\.ghostMode = true;/.test(clientSrc), 'client stamps MM.ghostMode at import time');
assert.ok(/NET\.parseWatch\(location\.search\)/.test(clientSrc), 'watch param comes from the URL');
assert.ok(!/localStorage\.setItem\((?!'mm_ghost_(name|avatar)_v1')/.test(clientSrc), 'client persists nothing but its display name and avatar');
assert.ok(/Storage\.prototype\.setItem = function/.test(clientSrc) && /allow = new Set\(\['mm_ghost_name_v1', 'mm_ghost_avatar_v1'\]\)/.test(clientSrc),
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
	&& /base\*fatigue\.mult\*specialMult\*socialMult/.test(mobsSrc),
	'mob XP multiplies the social boost (neutral 1 in solo/Node)');
assert.ok(/function socialBoostMult\(part\)/.test(mainSrc), 'main.js social boost reader exists');
assert.ok(/heroSandMoveMult\(\) \* socialBoostMult\('move'\)/.test(mainSrc), 'movement speed multiplies the social boost');
assert.ok(/turboJumpMult \* Math\.sqrt\(socialBoostMult\('jump'\)\)/.test(mainSrc), 'jump velocity takes the square root of the HEIGHT boost');
const weaponsSrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.ok(/mult:\(lucky\?4:2\)\*social,lucky/.test(weaponsSrc), 'hero attack rolls multiply the social boost');
assert.ok(/if\(MMR && !MMR\.socialBoost\) MMR\.socialBoost = \{ viewers: 0, active: 0, xp: 1, move: 1, jump: 1, dmg: 1 \};/.test(hostSrc),
	'MM.socialBoost is neutral from the first frame');
assert.ok(/if\(pl\.act\) markActive\(entry\);/.test(hostSrc) && /ACT_POSE_TTL_MS/.test(hostSrc),
	'watcher activity is vouched by poses and times out fast (anti fake-watcher)');
assert.ok(/NET\.socialBoosts\(active\)/.test(hostSrc), 'the host derives boosts from ACTIVE watchers only');
assert.ok(/lastInputAt = nowMs\(\)/.test(clientSrc) && /nowMs\(\) - lastInputAt < NET\.SOCIAL_RULES\.IDLE_MS/.test(clientSrc),
	'the client derives its active flag from real input recency');

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
assert.ok(/painter\(ctx, TILE, c\.x, c\.y, ghostName\(\), t, true, avatar, isActive\(\), selfChat\);/.test(clientSrc),
	'the watcher sees their own flying avatar at the camera');

// --- ghost dread integration: four creature systems flee the spirits -------------------------------
assert.ok(/if\(MMR && !MMR\.ghostAura\)/.test(hostSrc) && /MMR\.ghostDreadAt = function/.test(hostSrc),
	'the host publishes the aura + the single dread lookup every creature system calls');
assert.ok(/if\(!e\.hello \|\| e\.actUntil <= t\) continue;[\s\S]*if\(e\.cam\) spirits\.push/.test(hostSrc),
	'ONLY active watchers haunt the world (an idle tab is furniture, not a phantom)');
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

// --- assistant: a delegate, not a second player --------------------------------------------------------
assert.ok(/function setAssistant\(gid, on\)/.test(hostSrc), 'the host appoints the assistant');
assert.ok(/if\(on && entry\.mode !== 'full'\) return false;/.test(hostSrc), 'an assistant must hold full permissions');
assert.ok(/\} else if\(on && entry\.assistant\)\{/.test(hostSrc), 'exactly one assistant at a time — the seat is handed over');
assert.ok(/if\(!entry\.assistant \|\| entry\.mode !== 'full'\)\{ entry\.peer\.send\(\{ t: 'assistAck', ok: false, reason: 'perm' \}\); return; \}/.test(hostSrc),
	'non-assistants cannot run assistant actions');
assert.ok(/ghostAssistState:\(\)=>\{/.test(mainSrc) && /ghostAssist:\(action,id\)=>\{/.test(mainSrc), 'the bridge exposes the assistant surface');
assert.ok(/if\(!canCraft\(r\)\) return \{ok:false, reason:'cost'\};/.test(mainSrc), 'the assistant cannot craft what the hero cannot afford');
assert.ok(/if\(!craftRecipeVisible\(r\)\) return \{ok:false, reason:'locked'\};/.test(mainSrc), 'the assistant cannot craft undiscovered recipes');
assert.ok(/sendAssist\('craft', r\.id\)/.test(clientSrc) && /sendAssist\(i\.equipped \? 'unequip' : 'equip', i\.id\)/.test(clientSrc),
	'the assistant workbench drives craft/equip/unequip only');

console.log('ghost-sim: all assertions passed');
