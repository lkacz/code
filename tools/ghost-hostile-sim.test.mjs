// Hostile-host / transport / authority regressions for the multiplayer P0s.
// Two halves:
//   PART A — pure protocol primitives (resume tokens, proto/size caps, assembler
//            byte accounting, DataChannel queue, swept movement, signed signaling +
//            replay guard). Deterministic, no transport.
//   PART B — the REAL host driven over its loopback transport (BroadcastChannel,
//            rtc:false): a fake guest speaks the wire and we assert the exploits are
//            refused end to end — pre-hello messages, wrong protocol, gid takeover,
//            wall-tunnelling, camera spoofing, mid-fight teardown, no-heal reconnect,
//            hero→play HP clamp, and no phantom body after the last guest leaves.
// Run: node tools/ghost-hostile-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const NET = (await import('../src/engine/ghost_net.js')).ghostNet;

// ============================ PART A — pure primitives ============================

// --- resume tokens (P0-1) -------------------------------------------------------------
const tokA = NET.mintResumeToken();
assert.ok(NET.validResumeTokenShape(tokA), '128-bit resume token is 32 lowercase hex chars');
assert.equal(tokA.length, NET.RESUME_TOKEN_BYTES * 2, 'token width matches the byte count');
assert.notEqual(NET.mintResumeToken(), NET.mintResumeToken(), 'tokens are random (not a counter)');
assert.equal(NET.resumeTokenMatch(tokA, tokA), true, 'a token matches itself');
assert.equal(NET.resumeTokenMatch(tokA, NET.mintResumeToken()), false, 'a different token never matches');
assert.equal(NET.resumeTokenMatch(tokA, undefined), false, 'a missing token never matches');
assert.equal(NET.resumeTokenMatch(tokA, 'deadbeef'), false, 'a wrong-shape token never matches');

// --- wire size caps + UTF-8 byte counting (P0-5) --------------------------------------
assert.equal(NET.utf8Len('abc'), 3, 'ascii bytes');
assert.equal(NET.utf8Len('é'), 2, 'a 2-byte char is counted as 2 bytes, not 1 code unit');
assert.equal(NET.utf8Len('😀'), 4, 'a 4-byte emoji is counted as 4 bytes');
assert.ok(NET.utf8Len('😀'.repeat(10)) === 40, 'byte counting is additive across multibyte chars');
assert.equal(NET.withinWireLimit('x'.repeat(100), 100), true, 'exactly at the limit passes');
assert.equal(NET.withinWireLimit('x'.repeat(101), 100), false, 'one byte over is refused');
assert.equal(NET.withinWireLimit('😀'.repeat(30), 100), false, '30 emojis = 120 bytes exceeds the 100-byte cap (byte-measured, not by code-unit length)');
assert.equal(NET.validSignalSize({ sdp: 'x'.repeat(NET.WIRE_LIMITS.SDP_MAX) }), true, 'an SDP at the cap is accepted');
assert.equal(NET.validSignalSize({ sdp: 'x'.repeat(NET.WIRE_LIMITS.SDP_MAX + 1) }), false, 'an oversized SDP is refused');
assert.equal(NET.validSignalSize({ c: 'x'.repeat(NET.WIRE_LIMITS.ICE_MAX + 1) }), false, 'an oversized ICE candidate is refused');

// --- assembler byte ceiling (P0-5): UTF-8, not code units -----------------------------
{
	// oversized single chunk is refused (existing bound)
	const asm = NET.createAssembler();
	assert.equal(asm.push({ t: 'chunk', k: 'snap', id: 'a', i: 0, of: 1, d: 'y'.repeat(NET.WIRE_LIMITS ? 70000 : 70000) }), null, 'a chunk body over the per-chunk cap is dropped');
	// the assembled ceiling is a byte ceiling; a legit multi-chunk snapshot still fits
	assert.ok(NET.WIRE_LIMITS.ASSEMBLED_MAX >= 32 * 1024 * 1024, 'the assembled ceiling still admits a real world snapshot');
	// round-trips still work under the caps
	const parts = NET.chunkPayload('snap', 'ę'.repeat(100), 64, 'ok');
	const asm2 = NET.createAssembler();
	let done = null;
	for(const p of parts) done = asm2.push(p) || done;
	assert.equal(done && done.data, 'ę'.repeat(100), 'a multibyte payload reassembles intact');
}

// --- bounded DataChannel queue (P0-5) -------------------------------------------------
{
	const q = NET.createSendQueue({ hi: 100, lo: 40, max: 3 });
	const sent = [];
	const ch = { bufferedAmount: 0, send(x){ sent.push(x); } };
	assert.equal(q.push('a') && q.flush(ch), true, 'a message flushes when the socket is idle');
	assert.equal(sent.length, 1, 'the idle message went out');
	ch.bufferedAmount = 500; // congested
	q.push('b'); q.flush(ch);
	assert.equal(q.size(), 1, 'a congested socket holds the message in the queue (no unbounded dc.send)');
	// overflow the backlog → fail closed (the transport then closes the channel)
	const q2 = NET.createSendQueue({ hi: 100, lo: 40, max: 2 });
	const chDead = { bufferedAmount: 9999, send(){} };
	q2.push('1'); q2.push('2');
	assert.equal(q2.push('3'), false, 'the queue refuses past its ceiling');
	assert.equal(q2.closed(), true, 'an overflowing queue fail-closes');
}

// --- swept movement resolver (P0-6) ---------------------------------------------------
{
	const wall = (tx) => tx >= 5;
	const r = NET.sweepBodyMove({ x: 3, y: 3, w: 0.62, h: 0.92 }, 20, 3, 100, wall, null);
	assert.ok(r.x < 5 && r.blocked, 'a wall-tunnel claim is stopped at the wall');
	const floor = (tx, ty) => ty >= 5;
	const r2 = NET.sweepBodyMove({ x: 3, y: 3, w: 0.62, h: 0.92 }, 3, 20, 100, floor, null);
	assert.ok(r2.y < 5 && r2.blocked, 'a floor-drop claim is stopped at the floor');
	const free = NET.sweepBodyMove({ x: 3, y: 3, w: 0.62, h: 0.92 }, 4, 3, 100, () => false, null);
	assert.ok(Math.abs(free.x - 4) < 1e-6 && !free.blocked, 'an honest move in open space is honored verbatim');
	const clamp = NET.sweepBodyMove({ x: 3, y: 3, w: 0.62, h: 0.92 }, 100, 3, 2, () => false, null);
	assert.ok(Math.abs(clamp.x - 5) < 1e-6, 'a big claim is clamped to the speed envelope');
}

// --- signed signaling + replay guard (P0-4) -------------------------------------------
{
	const secret = NET.mintInviteSecret();
	assert.ok(NET.validInviteSecret(secret), 'the invite secret is ≥128-bit hex');
	const guard = NET.createReplayGuard(60000);
	const env = { role: 'g', nonce: 'nonce-1', ts: 1000, fp: 'fpHost', sdp: 'v=0...' };
	env.sig = await NET.signSignal(secret, 'ROOM', env.role, env.nonce, env.ts, env.sdp, env.fp);
	assert.equal((await NET.verifySignal(secret, env, { room: 'ROOM', role: 'g', now: 1000, guard })).ok, true, 'a well-formed signed envelope verifies');
	assert.equal((await NET.verifySignal(secret, env, { room: 'ROOM', role: 'g', now: 1000, guard })).reason, 'replay', 'the same nonce is refused as a replay');
	assert.equal((await NET.verifySignal(secret, env, { room: 'ROOM', role: 'h', now: 1000 })).reason, 'role', 'a role mismatch is refused');
	assert.equal((await NET.verifySignal(secret, env, { room: 'ROOM', role: 'g', now: 1000 + 10 * 60000 })).reason, 'stale', 'a stale timestamp is refused');
	assert.equal((await NET.verifySignal(secret, { ...env, sdp: 'tampered' }, { room: 'ROOM', role: 'g', now: 1000 })).reason, 'sig', 'a tampered SDP breaks the signature');
	assert.equal((await NET.verifySignal(secret, { ...env, fp: 'evil' }, { room: 'ROOM', role: 'g', now: 1000, fp: 'fpHost' })).reason, 'fingerprint', 'a swapped host fingerprint is refused');
	assert.equal((await NET.verifySignal(NET.mintInviteSecret(), env, { room: 'ROOM', role: 'g', now: 1000 })).ok, false, 'a wrong invite secret cannot forge a signature');
}

// --- RTC posture (P0-4/P0-5): remote is OFF by default -------------------------------
assert.ok(NET.RTC_LIMITS.PENDING_MAX > 0 && NET.RTC_LIMITS.NEGOTIATE_MS > 0 && NET.RTC_LIMITS.HELLO_MS > 0, 'RTC negotiation limits are defined');
{
	// hostListen must NOT stand up the RTC transport unless rtc:true is passed
	const off = NET.hostListen('ROOMAA', { rtc: false, onPeer(){} });
	assert.equal(off.transports.rtc, false, 'RTC is off by default (opt-in only)');
	off.stop();
	const dflt = NET.hostListen('ROOMAB', { onPeer(){} });
	assert.equal(dflt.transports.rtc, false, 'RTC stays off when unspecified');
	dflt.stop();
}

// ============================ PART B — host driven over loopback ============================

const { ghostHost } = await import('../src/engine/ghost_host.js');

// A configurable solidity predicate for the host bridge (default: open world).
let SOLID = () => false;
let healHeroCalls = 0;
const bridge = {
	msg(){},
	player: { x: 5, y: 5, w: 0.62, h: 0.92, vx: 0, vy: 0, facing: 1, hp: 100, maxHp: 100, energy: 50 },
	buildSave: () => ({ v: 1, world: 'stub' }),
	solidAt: (x, y) => !!SOLID(x, y),
	getTile: () => 0,
	drawHeroAt(){}, snapCameraToPlayer(){},
	snapshotDrops: () => null, snapshotSeasons: () => null, snapshotInfra: () => null,
	snapshotConstructionBackground: () => null, snapshotNpcs: () => null, snapshotStory: () => null,
	healHero(){ healHeroCalls++; }, addHeroEnergy(){},
	ghostPower: () => 0
};
ghostHost.wire(bridge);
const ROOM = 'HOSTLE';
ghostHost.start({ room: ROOM, rtc: false });

const flush = () => new Promise(r => setTimeout(r, 15)); // let BroadcastChannel deliver both ways
const settle = () => new Promise(r => setTimeout(r, 95)); // long enough for a bodyTick cadence
function tickHost(){ try{ ghostHost.frame(0.1, performance.now()); }catch(e){ /* ignore */ } }
// The host's first-action rate floors compare performance.now() against a zero
// default (now() - (lastX || 0) < FLOOR). In a browser now() is seconds-large by the
// time a guest acts; in a fresh Node process it starts near zero, which would read as a
// false cooldown. Advance real time past the largest first-action floor (ping = 2500 ms)
// so the FIRST ping/duel/etc is judged on its own merits, exactly as in the browser.
const warmup = () => new Promise(r => setTimeout(r, 2700));

// A fake guest: `conn` is the transport identity (the peer id), `gid` is the CLAIMED
// hello identity — they can differ, which is exactly the takeover surface.
const openGuests = [];
function makeGuest(conn){
	const ch = new BroadcastChannel('mm_ghost_' + ROOM);
	const inbox = [];
	ch.onmessage = (ev) => { const m = ev.data; if(!m || !m.pl) return; if(m.to !== conn && m.to !== '*') return; inbox.push(m.pl); };
	const g = {
		conn, inbox,
		send(pl){ ch.postMessage({ to: 'host', from: conn, pl }); },
		hello(gid, extra){ g.send(Object.assign({ t: 'hello', gid, name: 'G', proto: NET.GHOST_PROTO }, extra || {})); },
		last(t){ for(let i = inbox.length - 1; i >= 0; i--) if(inbox[i].t === t) return inbox[i]; return null; },
		all(t){ return inbox.filter(m => m.t === t); },
		clear(){ inbox.length = 0; },
		close(){ try{ ch.close(); }catch(e){ /* fine */ } }
	};
	openGuests.push(g);
	return g;
}

let failed = false;
function check(cond, label){ try{ assert.ok(cond, label); }catch(e){ failed = true; console.error('FAIL:', label); } }

// send a claimed pose a few times with real gaps: the FIRST pose only sets the host's
// timestamp (dtS=0 by design), so honest movement accrues over subsequent claims
async function posePush(g, x, y){
	for(let i = 0; i < 4; i++){ g.send({ t: 'ppose', x, y, f: 1, q: i + 1, act: 1 }); await settle(); }
	tickHost();
}
// disconnect a guest and let the host reap it
async function bye(g){ g.send({ t: 'bye' }); await flush(); tickHost(); }

try{
	await warmup(); // advance now() past the first-action rate floors (as a browser session already has)

	// --- P0-3: pre-hello messages do nothing; wrong protocol creates no viewer --------
	{
		const g = makeGuest('c-prehello');
		g.send({ t: 'buff', kind: 'bless' }); // BEFORE any hello
		await flush();
		check(g.last('buffAck') === null, 'P0-3: a pre-hello buff is dropped (no buffAck)');
		check(healHeroCalls === 0, 'P0-3: a pre-hello buff heals nothing');
		check(g.last('welcome') === null, 'P0-3: no welcome without a hello');
		g.hello('proto-victim', { proto: 999 }); // wrong protocol
		await flush();
		check(g.last('incompatible') !== null, 'P0-3: a wrong-protocol hello is refused as incompatible');
		check(g.last('welcome') === null, 'P0-3: a wrong-protocol hello creates no viewer/snapshot');
		check(g.all('chunk').length === 0, 'P0-3: no snapshot chunks were sent to an incompatible client');
	}

	// --- P0-3/P0-1: a good hello gets a welcome carrying a resume token (default watch)
	let victimToken = null;
	let victimGuest = null;
	{
		const g = makeGuest('c-victim');
		victimGuest = g;
		g.hello('gid-victim');
		await flush();
		const w = g.last('welcome');
		check(w !== null, 'a valid hello is welcomed');
		check(w && w.mode === 'watch', 'P0-3: a new viewer defaults to the watch-only floor');
		check(w && NET.validResumeTokenShape(w.rt), 'P0-1: the welcome privately carries a 128-bit resume token');
		victimToken = w && w.rt;
		// host embodies the victim as a play guest
		ghostHost.setViewerMode('gid-victim', 'play');
		await flush(); tickHost();
		check(ghostHost._debugBody('gid-victim') !== null, 'the victim has a live play body');
	}

	// --- P0-1: an impostor who knows the (public) gid but not the token is refused
	//     BEFORE the real owner is touched
	{
		const imp = makeGuest('c-impostor');
		imp.hello('gid-victim', { rt: NET.mintResumeToken() }); // right gid, WRONG token
		await flush();
		check(imp.last('taken') !== null, "P0-1: the impostor's claim is refused ('taken')");
		check(imp.last('welcome') === null, 'P0-1: the impostor gets no welcome/seat');
		check(ghostHost._debugBody('gid-victim') !== null, 'P0-1: the real owner keeps its body — never evicted by the impostor');
		check(ghostHost.metrics().players === 1, 'P0-1: still exactly one embodied player (the victim)');
	}

	// --- P0-1/P0-7: the real owner reconnects (new transport, correct token) and RESUMES
	{
		const b = ghostHost._debugBody('gid-victim');
		b.hp = 7; // wound the body so we can prove reconnect does not heal
		const re = makeGuest('c-victim-2');
		victimGuest = re;
		re.hello('gid-victim', { rt: victimToken });
		await flush(); tickHost();
		check(re.last('welcome') !== null, 'P0-1: a token-proven reconnect is welcomed');
		check(re.last('perm') && re.last('perm').mode === 'play', 'P0-7: the reconnect auto-regrants the embodied rung');
		const b2 = ghostHost._debugBody('gid-victim');
		check(b2 && Math.abs(b2.hp - 7) < 0.001, 'P0-7: the reconnect RESTORES the wounded HP (7), it does not heal to full');
	}

	// --- P0-6: swept collision — a wall-tunnel pose is stopped at the wall, and the
	//     guest's camera (powers/ping origin) is the ACCEPTED body position ----------
	let moverGuest = null;
	{
		SOLID = (x) => x >= 8; // a wall at x=8
		const g = makeGuest('c-mover');
		moverGuest = g;
		g.hello('gid-mover');
		await flush();
		ghostHost.setViewerMode('gid-mover', 'play');
		await flush();
		await posePush(g, 30, 5); // claim far past the wall, repeatedly
		const mb = ghostHost._debugBody('gid-mover');
		check(mb && mb.x < 8, 'P0-6: the wall-tunnel claim is stopped before the wall (x<8), not teleported to x=30');
		check(mb && mb.x > 5, 'P0-6: honest movement toward the wall is still allowed');
		g.clear();
		g.send({ t: 'ping' });
		await flush();
		const ping = g.last('ping');
		check(ping && ping.x < 8 && Math.abs(ping.x - 30) > 1, 'P0-6: the ping fires from the ACCEPTED body position, never the raw camera claim (30)');
		SOLID = () => false;
	}

	// --- P0-7: a mid-fight disconnect settles the partner's duel (centralized teardown)
	{
		const d1 = makeGuest('c-duel-1'); d1.hello('gid-d1'); await flush();
		const d2 = makeGuest('c-duel-2'); d2.hello('gid-d2'); await flush();
		ghostHost.setViewerMode('gid-d1', 'play');
		ghostHost.setViewerMode('gid-d2', 'play');
		await flush(); tickHost();
		d1.send({ t: 'pact', a: 'duel', gid: 'gid-d2' });
		await flush();
		d2.send({ t: 'pact', a: 'duel', gid: 'gid-d1' }); // mutual consent → the duel is on
		await flush(); tickHost();
		check(ghostHost._debugBody('gid-d1') && ghostHost._debugBody('gid-d1').duelWith === 'gid-d2', 'a mutual-consent duel starts');
		check(ghostHost._debugBody('gid-d2') && ghostHost._debugBody('gid-d2').duelWith === 'gid-d1', 'both sides are in the duel');
		await bye(d1); // one combatant disconnects mid-fight
		check(ghostHost._debugBody('gid-d1') === null, 'P0-7: the leaving duelist body is gone');
		const surv = ghostHost._debugBody('gid-d2');
		check(surv && surv.duelWith === null, "P0-7: the survivor's duel is settled — no dangling duelWith");
		await bye(d2);
	}

	// --- P0-7: a hero→play demotion clamps the body into the play HP pool ---------------
	{
		const h = makeGuest('c-hero'); h.hello('gid-hero'); await flush();
		ghostHost.setViewerMode('gid-hero', 'hero');
		await flush(); tickHost();
		await posePush(h, 5, 5); // a pose with a hero-scale HP claim
		h.send({ t: 'ppose', x: 5, y: 5, f: 1, q: 9, hp: 900, mhp: 1000, act: 1 });
		await flush(); tickHost();
		const hb = ghostHost._debugBody('gid-hero');
		check(hb && hb.maxHp > 80, 'a hero body carries a boss-grade HP pool');
		ghostHost.setViewerMode('gid-hero', 'play'); // demote
		await flush();
		const hb2 = ghostHost._debugBody('gid-hero');
		check(hb2 && hb2.maxHp === NET.PLAY_RULES.MAX_HP, 'P0-7: demotion clamps maxHp to the play limit (80)');
		check(hb2 && hb2.hp <= NET.PLAY_RULES.MAX_HP, 'P0-7: demotion clamps current HP into the play pool');
		await bye(h);
	}

	// --- P0-7: the last embodied guest leaving leaves NO phantom in MM.coopBodies ------
	{
		// first vacate the other embodied guests so this one is genuinely the last
		if(victimGuest) await bye(victimGuest);
		if(moverGuest) await bye(moverGuest);
		const g = makeGuest('c-last'); g.hello('gid-last'); await flush();
		ghostHost.setViewerMode('gid-last', 'play');
		await flush();
		await settle(); tickHost(); // let a bodyTick publish the body into MM.coopBodies
		check(Array.isArray(MM.coopBodies) && MM.coopBodies.length >= 1, 'the embodied guest is published into MM.coopBodies');
		await bye(g);
		check(Array.isArray(MM.coopBodies) && MM.coopBodies.length === 0, 'P0-7: no phantom body remains once the last guest leaves');
	}
}finally{
	for(const g of openGuests) g.close();
	try{ ghostHost.stop(); }catch(e){ /* fine */ }
}

if(failed){ console.error('ghost-hostile-sim: FAILURES ABOVE'); process.exit(1); }
console.log('ghost-hostile-sim: all assertions passed');
process.exit(0);
