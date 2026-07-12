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
assert.ok(!/localStorage\.setItem\((?!'mm_ghost_name_v1')/.test(clientSrc), 'client persists nothing but its display name');
assert.ok(/Storage\.prototype\.setItem = function/.test(clientSrc) && /allow = new Set\(\['mm_ghost_name_v1'\]\)/.test(clientSrc),
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

console.log('ghost-sim: all assertions passed');
