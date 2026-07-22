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
const { createSnapshotPlaneSyncGate } = await import('../src/engine/ghost_client.js');
const { HERO_BODY_W, HERO_BODY_H } = await import('../src/constants.js');
const { authoritativeBodyBlocksCell } = await import('../src/engine/body_footprint.js');
assert.equal(NET.PLAY_RULES.BODY_W, HERO_BODY_W, 'host shadow width equals the real hero width');
assert.equal(NET.PLAY_RULES.BODY_H, HERO_BODY_H, 'host shadow height equals the real hero height');
assert.equal(NET.validGid('gid-victim'), true, 'normal persisted gids are accepted');
assert.equal(NET.validGid('ga>gb'), false, 'delimiter-bearing gids are refused');
assert.equal(NET.validGid('g' + 'a'.repeat(40)), false, 'gids have a hard wire/storage length ceiling');
assert.notEqual(NET.duelAskKey('ga', 'gb>gc'), NET.duelAskKey('ga>gb', 'gc'), 'duel consent keys are collision-free tuples');

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

// A snapshot correction is a one-shot locked-channel allowance, never a hostile
// host's reusable way around the client's 200 ms plane cadence floor.
{
	const gate = createSnapshotPlaneSyncGate();
	gate.arm(1000);
	assert.equal(gate.take('pwat', 1, false, 1001), false, 'sync correction is refused off the locked host channel');
	assert.equal(gate.take('pwat', 1, true, 1001), true, 'one locked pwat correction consumes its snapshot allowance');
	assert.equal(gate.take('pwat', 1, true, 1002), false, 'sync spam cannot spend the same pwat allowance twice');
	assert.equal(gate.take('drift', 1, true, 1002), true, 'drift has its own single snapshot allowance');
	assert.equal(gate.take('drift', 1, true, 1003), false, 'sync spam cannot spend the same drift allowance twice');
	gate.arm(2000);
	assert.equal(gate.take('pwat', 1, true, 3001), false, 'an unconsumed correction allowance expires after one second');
}

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
	const q3 = NET.createSendQueue({ hi: 100, lo: 40, max: 99, maxBytes: 5 });
	assert.equal(q3.push('12345'), true, 'byte-bounded queue admits an exactly-full backlog');
	assert.equal(q3.sizeBytes(), 5, 'queue reports its UTF-8 backlog bytes');
	assert.equal(q3.push('x'), false, 'queue fails closed before exceeding its byte ceiling');
	assert.equal(q3.closed(), true, 'a byte-overflowing queue fail-closes');
	assert.ok(NET.DC_QUEUE.GLOBAL_MAX_BYTES >= NET.DC_QUEUE.MAX_BYTES
		&& NET.DC_QUEUE.GLOBAL_MAX_BYTES < NET.DC_QUEUE.MAX_BYTES * 2,
		'the RTC-wide byte ceiling admits one maximum queue but cannot multiply it per peer');
	const shared = NET.createByteBudget(10);
	const qa = NET.createSendQueue({ hi: 1, lo: 0, maxBytes: 10, acquireBytes: shared.acquire });
	const qb = NET.createSendQueue({ hi: 1, lo: 0, maxBytes: 10, acquireBytes: shared.acquire });
	assert.equal(qa.push('123456'), true, 'first peer reserves six shared queue bytes');
	assert.equal(qb.push('1234'), true, 'second peer consumes the remaining shared queue bytes');
	assert.equal(shared.usedBytes(), 10, 'separate queues report one aggregate byte total');
	assert.equal(qb.push('x'), false, 'an item beyond the RTC-wide byte ceiling is refused');
	assert.equal(qb.closed(), true, 'global byte-budget denial fail-closes the refused peer queue');
	assert.equal(shared.usedBytes(), 6, 'fail-close releases that peer’s previously queued reservations');
	const qc = NET.createSendQueue({ hi: 1, lo: 0, maxBytes: 10, acquireBytes: shared.acquire });
	assert.equal(qc.push('1234'), true, 'released aggregate capacity is immediately reusable by another peer');
	qa.dispose();
	assert.equal(shared.usedBytes(), 4, 'disposing a peer releases every byte it retained');
	qa.dispose();
	assert.equal(shared.usedBytes(), 4, 'queue disposal is idempotent and cannot release another peer’s lease');
	const sharedSent = [];
	assert.equal(qc.flush({ bufferedAmount: 0, send(x){ sharedSent.push(x); } }), true, 'the replacement peer drains normally');
	assert.deepEqual(sharedSent, ['1234'], 'the globally budgeted item is delivered intact');
	assert.equal(shared.usedBytes(), 0, 'successful dequeue returns its aggregate byte lease');
	const qFail = NET.createSendQueue({ maxBytes: 10, acquireBytes: shared.acquire });
	assert.equal(qFail.push('12345'), true, 'send-failure setup reserves shared bytes');
	assert.equal(qFail.flush({ bufferedAmount: 0, send(){ throw new Error('closed-channel'); } }), false,
		'a channel send failure fail-closes the queue');
	assert.equal(shared.usedBytes(), 0, 'send failure releases the current item and all retained shared bytes');
	const verifyRate = NET.createRateBudget(2, 100);
	assert.equal(verifyRate.tryTake(1000), true, 'the shared verification window admits its first HMAC start');
	assert.equal(verifyRate.tryTake(1001), true, 'the shared verification window admits work through its exact ceiling');
	assert.equal(verifyRate.tryTake(1099), false, 'the shared verification rate refuses excess work inside the window');
	assert.equal(verifyRate.tryTake(1100), true, 'verification capacity refreshes deterministically at the next window');
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
	const axisWall = NET.sweepBodyMove({ x: 3, y: 3, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H }, 7, 3, 100,
		(tx, ty, axis) => axis === 'x' && tx >= 5, null);
	assert.ok(axisWall.x < 5, 'the swept solidity callback receives the real movement axis');
	const bounded = NET.sweepBodyMove({ x: 3, y: 3, w: 0.7, h: 0.95 }, -100, 100, 1000, () => false,
		{ minX: -10, maxX: 10, minY: -5, maxY: 8 });
	assert.ok(bounded.x >= -10 + 0.35 && bounded.y <= 8 - 0.475, 'explicit world bounds include the body half-extents');
}

// --- signed signaling + replay guard (P0-4) -------------------------------------------
{
	const secret = NET.mintInviteSecret();
	assert.ok(NET.validInviteSecret(secret), 'the invite secret is >=128-bit hex');
	assert.equal(NET.validInviteSecret('ab'.repeat(16)), true, 'a 128-bit invite secret is accepted');
	assert.equal(NET.validInviteSecret('ab'.repeat(32)), true, 'a 256-bit invite secret is accepted');
	assert.equal(NET.validInviteSecret('a'.repeat(33)), false, 'odd/intermediate secret widths are rejected');

	const room = 'ROOM';
	const sid = 'a'.repeat(24);
	const host = NET.createSignedChannel(secret, room, 'h');
	const guest = NET.createSignedChannel(secret, room, 'gABC');
	const guard = NET.createReplayGuard(60000);
	const env = await guest.seal({ k: 'hi', to: 'h', sid });
	assert.match(env.nonce, /^[0-9a-f]{24}$/, 'every signal gets an exact 96-bit lowercase-hex nonce');
	assert.equal(env.to, 'h', 'the destination is carried in the authenticated envelope');
	assert.equal(env.sid, sid, 'the negotiation session id is carried in the authenticated envelope');
	assert.equal((await NET.verifySignal(secret, env, { room, role: 'gABC', to: 'h', sid, now: env.ts, guard })).ok, true, 'a well-formed signed envelope verifies');
	assert.equal((await NET.verifySignal(secret, env, { room, role: 'gABC', to: 'h', sid, now: env.ts, guard })).reason, 'replay', 'the same nonce is refused as a replay');
	assert.equal((await NET.verifySignal(secret, env, { room, role: 'h', to: 'h', sid, now: env.ts })).reason, 'role', 'a role mismatch is refused');
	assert.equal((await NET.verifySignal(secret, env, { room, role: 'gABC', to: 'gABC', sid, now: env.ts })).reason, 'destination', 'a signal cannot be redirected to a different recipient');
	assert.equal((await NET.verifySignal(secret, env, { room, role: 'gABC', to: 'h', sid: 'b'.repeat(24), now: env.ts })).reason, 'session', 'a signal cannot cross negotiation sessions');
	assert.equal((await NET.verifySignal(secret, env, { room, role: 'gABC', to: 'h', sid, now: env.ts + 10 * 60000 })).reason, 'stale', 'a stale timestamp is refused');
	assert.equal((await NET.verifySignal(NET.mintInviteSecret(), env, { room, role: 'gABC', to: 'h', sid, now: env.ts })).ok, false, 'a wrong invite secret cannot forge a signature');

	const offerSdp = { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF\r\na=x-test:original\r\n' };
	const offer = await host.seal({ k: 'offer', to: 'gABC', sid, sdp: offerSdp });
	const expectOffer = { room, role: 'h', to: 'gABC', sid, now: offer.ts };
	assert.equal(offer.v, NET.SIGNAL_ENVELOPE_VERSION, 'every remote signal is explicitly v2');
	assert.ok(typeof offer.ct === 'string' && offer.ct.length > 20, 'an SDP signal carries bounded base64url ciphertext');
	assert.ok(!Object.hasOwn(offer, 'sdp') && !Object.hasOwn(offer, 'c') && !Object.hasOwn(offer, 'fp'),
		'the public-broker envelope exposes no SDP, candidate or fingerprint fields');
	assert.equal(JSON.stringify(offer).includes('x-test:original'), false, 'the SDP text is absent from serialized broker traffic');
	const cipherTampered = { ...offer, ct: (offer.ct[0] === 'A' ? 'B' : 'A') + offer.ct.slice(1) };
	assert.equal((await NET.verifySignal(secret, cipherTampered, expectOffer)).reason, 'sig', 'tampering with encrypted SDP content breaks the outer HMAC');
	const kindTampered = { ...offer, k: 'answer' };
	assert.equal((await NET.verifySignal(secret, kindTampered, expectOffer)).reason, 'sig', 'changing a signal kind breaks the selector HMAC');
	const destinationTampered = { ...offer, to: 'gDEF' };
	assert.equal((await NET.verifySignal(secret, destinationTampered, { ...expectOffer, to: 'gDEF' })).reason, 'sig', 'even when routed to the altered recipient, destination tampering breaks the signature');
	const sessionTampered = { ...offer, sid: 'b'.repeat(24) };
	assert.equal((await NET.verifySignal(secret, sessionTampered, { ...expectOffer, sid: 'b'.repeat(24) })).reason, 'sig', 'even in the altered negotiation, session-id tampering breaks the signature');
	const wrappedTs = { ...offer, ts: offer.ts + 2 ** 32 };
	assert.equal((await NET.verifySignal(secret, wrappedTs, { ...expectOffer, now: wrappedTs.ts })).reason, 'sig', 'timestamps differing by 2^32 do not share a MAC');
	const plaintextV1 = { ...offer, v: 1, ct: '', fp: 'AA:BB:CC:DD:EE:FF', sdp: offerSdp };
	assert.equal((await NET.verifySignal(secret, plaintextV1, expectOffer)).reason, 'shape', 'a plaintext/v1 envelope is rejected instead of downgrading confidentiality');
	const malformedCt = { ...offer, ct: '***' };
	assert.equal((await NET.verifySignal(secret, malformedCt, expectOffer)).reason, 'shape', 'malformed base64url is rejected before HMAC/decrypt');
	const oversizedCt = { ...offer, ct: 'A'.repeat(NET.WIRE_LIMITS.SIG_CIPHERTEXT_MAX + 1) };
	assert.equal((await NET.verifySignal(secret, oversizedCt, expectOffer)).reason, 'shape', 'oversized ciphertext is rejected before Web Crypto');
}

// --- P0-4: the signed signaling CHANNEL end to end (the API the real RTC uses) --------
// This is the whole remote-auth decision layer: only invite-secret holders can produce
// a valid envelope, replays are refused, roles are bound, tampering breaks the MAC, and
// the DTLS fingerprint is pinned. Node has no RTCPeerConnection, so this — not the socket
// plumbing around it — is where the security is proven executably.
{
	const secret = NET.mintInviteSecret();
	const room = 'ROOMKX';
	const sid = 'c'.repeat(24);
	const host = NET.createSignedChannel(secret, room, 'h');
	const guest = NET.createSignedChannel(secret, room, 'gABC');
	const macContent = m => JSON.stringify({ ct: m.ct, k: m.k, sid: m.sid, to: m.to, v: m.v });
	async function resign(m){
		return { ...m, sig: await NET.signSignal(secret, room, m.role, m.nonce, m.ts, macContent(m)) };
	}
	assert.equal(host.ready && guest.ready, true, 'a channel with a valid secret is ready');
	assert.equal(NET.createSignedChannel('nothex', room, 'h').ready, false, 'no valid secret ⇒ the channel is not ready (remote stays closed)');

	// a guest hi signed with the shared secret is accepted; the same envelope replayed
	// is refused; a wrong-role or wrong-secret hi is refused
	const hi = await guest.seal({ k: 'hi', to: 'h', sid });
	assert.equal((await host.open(hi, 'gABC', null, sid)).ok, true, 'the host accepts a correctly signed guest hi');
	assert.equal((await host.open(hi, 'gABC', null, sid)).reason, 'replay', 'a replayed hi is refused');
	assert.equal((await host.open(await guest.seal({ k: 'hi', to: 'h', sid }), 'h', null, sid)).reason, 'role', 'a hi that signed as the wrong role is refused');
	const outsider = NET.createSignedChannel(NET.mintInviteSecret(), room, 'gABC'); // no shared secret
	assert.equal((await host.open(await outsider.seal({ k: 'hi', to: 'h', sid }), 'gABC', null, sid)).ok, false, 'an un-invited peer (wrong secret) cannot make the host open a connection');

	// the host offer carries + binds its DTLS fingerprint; the guest verifies and pins it
	const offerSdp = { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF\r\n' };
	const offer = await host.seal({ k: 'offer', to: 'gABC', sid, sdp: offerSdp });
	assert.equal(JSON.stringify(offer).includes('AA:BB:CC:DD:EE:FF'), false, 'the host fingerprint is encrypted on the broker');
	const openedOffer = await guest.open(offer, 'h', null, sid);
	assert.equal(openedOffer.ok, true, 'the guest accepts a correctly signed+encrypted host offer');
	assert.deepEqual(openedOffer.message.sdp, offerSdp, 'AES-GCM round-trips the exact RTC description');
	assert.equal(openedOffer.message.fp, 'AA:BB:CC:DD:EE:FF', 'the decrypted SDP fingerprint is pinned');
	const wrongRoomGuest = NET.createSignedChannel(secret, 'ROOMKY', 'gABC');
	assert.equal((await wrongRoomGuest.open(offer, 'h', null, sid)).reason, 'sig', 'HKDF/MAC context prevents a signal crossing rooms');
	// An outer-HMAC tamper dies before decrypt. Even a secret-holder re-MAC cannot
	// alter ciphertext: AES-GCM's tag then fails closed.
	const guest2 = NET.createSignedChannel(secret, room, 'gABC');
	const tampered = { ...offer, ct: (offer.ct[0] === 'A' ? 'B' : 'A') + offer.ct.slice(1) };
	assert.equal((await guest2.open(tampered, 'h', null, sid)).reason, 'sig', 'a ciphertext edit breaks the pre-decrypt HMAC');
	const guest3 = NET.createSignedChannel(secret, room, 'gABC');
	const reMacTampered = await resign(tampered);
	assert.equal((await guest3.open(reMacTampered, 'h', null, sid)).reason, 'decrypt', 'a re-MACed ciphertext edit still fails the AES-GCM tag');
	const otherGuestForAad = NET.createSignedChannel(secret, room, 'gDEF');
	const aadRedirect = await resign({ ...offer, to: 'gDEF' });
	assert.equal((await otherGuestForAad.open(aadRedirect, 'h', null, sid)).reason, 'decrypt', 'AES-GCM AAD independently binds the destination selector');
	// ICE is bound to the pinned fingerprint: a candidate carrying a different fp is refused
	const ice = await host.seal({ k: 'ice', to: 'gABC', sid, c: { candidate: 'candidate:private-address' } }, openedOffer.message.fp);
	assert.equal(JSON.stringify(ice).includes('candidate:private-address'), false, 'ICE address material is absent from broker JSON');
	const openedIce = await guest.open(ice, 'h', openedOffer.message.fp, sid);
	assert.equal(openedIce.ok, true, 'host ICE matching the pinned fingerprint is accepted');
	assert.equal(openedIce.message.c.candidate, 'candidate:private-address', 'the recipient recovers the exact ICE candidate');
	const iceEvil = await host.seal({ k: 'ice', to: 'gABC', sid, c: { candidate: 'x' } }, 'AA:AA');
	assert.equal((await guest.open(iceEvil, 'h', openedOffer.message.fp, sid)).reason, 'fingerprint', 'host ICE with a mismatched encrypted fingerprint is refused');

	// Captured valid traffic cannot be delivered to another guest or another negotiation.
	const otherGuest = NET.createSignedChannel(secret, room, 'gDEF');
	assert.equal((await otherGuest.open(offer, 'h', null, sid)).reason, 'destination', 'a captured offer cannot cross guest destinations');
	const nextSessionGuest = NET.createSignedChannel(secret, room, 'gABC');
	assert.equal((await nextSessionGuest.open(offer, 'h', null, 'd'.repeat(24))).reason, 'session', 'a captured offer cannot cross negotiation sessions');

	// a FORGED message must not consume a replay-guard slot (auth precedes anti-replay):
	// otherwise a room-code-knowing attacker could flood garbage nonces and starve guests
	const host2 = NET.createSignedChannel(secret, room, 'h');
	const legit = await guest.seal({ k: 'hi', to: 'h', sid });
	const forged = { ...legit, sig: 'deadbeef'.repeat(8) }; // same nonce, broken signature
	assert.equal((await host2.open(forged, 'gABC', null, sid)).reason, 'sig', 'a forged signature is refused');
	assert.equal((await host2.open(legit, 'gABC', null, sid)).ok, true, 'the forgery did NOT burn the nonce — the legit message still verifies');

	// Near-maximum SDP still fits after AES tag + base64url expansion, while preserving
	// both the decrypted 16 KiB limit and the independent 32 KiB MQTT ceiling.
	const sdpPrefix = 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF\r\na=x:';
	let lo = 0, hiMax = NET.WIRE_LIMITS.SDP_MAX;
	while(lo < hiMax){
		const mid = Math.ceil((lo + hiMax) / 2);
		const probe = { type: 'offer', sdp: sdpPrefix + 'x'.repeat(mid) };
		if(NET.validSignalSize({ sdp: probe })) lo = mid;
		else hiMax = mid - 1;
	}
	const maxSdp = { type: 'offer', sdp: sdpPrefix + 'x'.repeat(lo) };
	assert.equal(NET.validSignalSize({ sdp: maxSdp }), true, 'the generated SDP reaches the decrypted size boundary');
	assert.equal(NET.validSignalSize({ sdp: { ...maxSdp, sdp: maxSdp.sdp + 'x' } }), false, 'one more SDP byte crosses that boundary');
	const maxOffer = await host.seal({ k: 'offer', to: 'gABC', sid, sdp: maxSdp });
	assert.ok(NET.withinWireLimit(JSON.stringify({ ...maxOffer, from: 'h' }), NET.WIRE_LIMITS.SIG_MAX),
		'the largest valid encrypted SDP fits the sealed-envelope cap including sender routing');
	assert.ok(NET.withinWireLimit(JSON.stringify(maxOffer), NET.WIRE_LIMITS.MQTT_PAYLOAD_MAX),
		'the encrypted maximum remains below the independent MQTT publish ceiling');
	const maxOpened = await guest.open(maxOffer, 'h', null, sid);
	assert.equal(maxOpened.ok, true, 'a near-maximum SDP survives the v2 seal/open round trip');
	assert.deepEqual(maxOpened.message.sdp, maxSdp, 'the maximum-size SDP decrypts byte-for-byte');
}

// --- RTC posture: remote requires an invite secret, and is off without RTCPeerConnection
assert.ok(NET.RTC_LIMITS.PENDING_MAX > 0 && NET.RTC_LIMITS.NEGOTIATE_MS > 0 && NET.RTC_LIMITS.HELLO_MS > 0, 'RTC negotiation limits are defined');
{
	// no secret ⇒ RTC never stands up, even asked for; and headless Node has no RTC anyway
	const noSecret = NET.hostListen('ROOMAA', { rtc: true, onPeer(){} });
	assert.equal(noSecret.transports.rtc, false, 'RTC does not start without a valid invite secret');
	noSecret.stop();
	const off = NET.hostListen('ROOMAB', { rtc: false, secret: NET.mintInviteSecret(), onPeer(){} });
	assert.equal(off.transports.rtc, false, 'rtc:false forces loopback-only regardless of secret');
	off.stop();
}

// --- authenticated RTC plumbing over deterministic in-memory fakes ------------------
// This runs the real createRtcHost/createRtcJoin state machines. The signal bus holds
// each SDP until that side's first ICE message arrives, then delivers ICE first. That
// forces both peers through their pre-SDP ICE queues instead of merely testing helpers.
{
	function makeSignalBus(reorderIce){
		const endpoints = new Map();
		const sent = [], delivered = [];
		let heldOffer = null, heldAnswer = null;
		function enqueue(to, messages){
			const ep = endpoints.get(to);
			if(!ep) return Promise.resolve();
			ep.chain = ep.chain.then(async () => {
				for(const m of messages){
					if(endpoints.get(to) !== ep) return;
					delivered.push(m);
					await ep.handlers.onMsg(m);
				}
			});
			return ep.chain;
		}
		function route(from, to, env){
			if(!env || env.to !== to) return;
			const m = { ...env, from };
			sent.push(m);
			if(reorderIce && from === 'h' && m.k === 'offer'){ heldOffer = m; return; }
			if(reorderIce && from === 'h' && m.k === 'ice' && heldOffer){
				const offer = heldOffer; heldOffer = null;
				enqueue(to, [m, offer]);
				return;
			}
			if(reorderIce && from !== 'h' && m.k === 'answer'){ heldAnswer = m; return; }
			if(reorderIce && from !== 'h' && m.k === 'ice' && heldAnswer){
				const answer = heldAnswer; heldAnswer = null;
				enqueue(to, [m, answer]);
				return;
			}
			enqueue(to, [m]);
		}
		return {
			sent, delivered,
			openSignal(_room, who, handlers){
				const ep = { handlers, chain: Promise.resolve() };
				endpoints.set(who, ep);
				queueMicrotask(() => { if(endpoints.get(who) === ep && handlers.onReady) handlers.onReady('memory'); });
				return {
					sendTo(to, env){ route(who, to, env); },
					close(){ if(endpoints.get(who) === ep) endpoints.delete(who); }
				};
			},
			inject(to, from, env){ return enqueue(to, [{ ...env, from }]); },
			async idle(){
				for(let i = 0; i < 6; i++){
					await Promise.all(Array.from(endpoints.values(), ep => ep.chain));
					await Promise.resolve();
				}
			}
		};
	}

	function makeFakeRtcPair(){
		const state = {
			hostPc: null, guestPc: null, hostDc: null, guestDc: null,
			hostPcs: [], guestPcs: [], hostMakeCount: 0, guestMakeCount: 0, opened: false
		};
		class FakeDataChannel {
			constructor(label){
				this.label = label;
				this.readyState = 'connecting';
				this.bufferedAmount = 0;
				this.onopen = null; this.onmessage = null; this.onclose = null;
			}
			send(data){
				if(this.readyState !== 'open') throw new Error('fake-datachannel-not-open');
				const peer = this.peer;
				queueMicrotask(() => { if(peer && peer.readyState === 'open' && peer.onmessage) peer.onmessage({ data }); });
			}
			_open(){
				if(this.readyState === 'open' || this.readyState === 'closed') return;
				this.readyState = 'open';
				if(this.onopen) this.onopen();
			}
			close(){
				if(this.readyState === 'closed') return;
				this.readyState = 'closed';
				const peer = this.peer;
				queueMicrotask(() => { if(this.onclose) this.onclose(); });
				if(peer && peer.readyState !== 'closed'){
					peer.readyState = 'closed';
					queueMicrotask(() => { if(peer.onclose) peer.onclose(); });
				}
			}
		}
		function maybeOpen(){
			if(state.opened || !state.hostPc || !state.guestPc) return;
			if(!state.hostPc.remoteDescription || !state.guestPc.remoteDescription) return;
			state.opened = true;
			state.hostDc._open();
			state.guestDc._open();
		}
		class FakePeerConnection {
			constructor(side){
				this.side = side;
				this.localDescription = null; this.remoteDescription = null;
				this.remoteDescriptions = []; this.addedIce = [];
				this.connectionState = 'new'; this.onicecandidate = null;
				this.onconnectionstatechange = null; this.ondatachannel = null;
			}
			createDataChannel(label){
				assert.equal(this.side, 'host', 'only the host creates the negotiated data channel');
				state.hostDc = new FakeDataChannel(label);
				state.guestDc = new FakeDataChannel(label);
				state.hostDc.peer = state.guestDc;
				state.guestDc.peer = state.hostDc;
				return state.hostDc;
			}
			async createOffer(){
				return { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:01\r\n' };
			}
			async createAnswer(){
				return { type: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 11:22:33:44:55:66\r\n' };
			}
			async setLocalDescription(desc){
				this.localDescription = { ...desc };
				if(this.onicecandidate){
					this.onicecandidate({ candidate: { candidate: 'candidate:' + this.side, sdpMid: '0', sdpMLineIndex: 0 } });
				}
			}
			async setRemoteDescription(desc){
				this.remoteDescription = { ...desc };
				this.remoteDescriptions.push(this.remoteDescription);
				if(this.side === 'guest' && this.ondatachannel) this.ondatachannel({ channel: state.guestDc });
				if(this.side === 'host') setTimeout(maybeOpen, 0);
			}
			async addIceCandidate(candidate){ this.addedIce.push(candidate); }
			close(){ this.connectionState = 'closed'; }
		}
		return {
			state,
			makeHost(){ state.hostMakeCount++; state.hostPc = new FakePeerConnection('host'); state.hostPcs.push(state.hostPc); return state.hostPc; },
			makeGuest(){ state.guestMakeCount++; state.guestPc = new FakePeerConnection('guest'); state.guestPcs.push(state.guestPc); return state.guestPc; }
		};
	}

	async function waitUntil(fn, label){
		for(let i = 0; i < 100; i++){
			if(fn()) return;
			await new Promise(r => setTimeout(r, 2));
		}
		assert.fail(label);
	}
	async function makeSignedHi(secret, room, role, sid, ts, nonceHex){
		const nonce = String(nonceHex).repeat(24);
		const content = JSON.stringify({ ct: '', k: 'hi', sid, to: 'h', v: NET.SIGNAL_ENVELOPE_VERSION });
		const sig = await NET.signSignal(secret, room, role, nonce, ts, content);
		return { v: NET.SIGNAL_ENVELOPE_VERSION, k: 'hi', to: 'h', sid, ct: '', role, nonce, ts, sig };
	}
	function makeSignalCapture(){
		let endpoint = null;
		return {
			openSignal(_room, _who, handlers){
				endpoint = handlers;
				return { sendTo(){ /* offers are intentionally unanswered */ }, close(){ endpoint = null; } };
			},
			deliver(from, env){
				assert.ok(endpoint, 'captured signal endpoint is open');
				return endpoint.onMsg({ ...env, from });
			}
		};
	}
	function makeStalledPc(){
		return {
			connectionState: 'new', localDescription: null,
			createDataChannel(){ return { close(){ /* test teardown */ } }; },
			async createOffer(){ return { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:01\r\n' }; },
			async setLocalDescription(desc){ this.localDescription = { ...desc }; },
			close(){ this.connectionState = 'closed'; }
		};
	}

	// The half-open ceiling is shared across listeners/rooms, not multiplied by each
	// createRtcHost instance. Releasing one listener's pending PC immediately admits
	// useful work elsewhere, proving the lease is returned on teardown.
	{
		const count = NET.RTC_LIMITS.GLOBAL_PENDING_MAX + 1;
		const sharedSecret = NET.mintInviteSecret();
		const hosts = [], captures = [], rooms = [];
		let pcMakes = 0;
		for(let i = 0; i < count; i++){
			const capture = makeSignalCapture();
			const budgetRoom = 'RTCG' + i;
			captures.push(capture); rooms.push(budgetRoom);
			hosts.push(NET.createRtcHost(budgetRoom, { onPeer(){ assert.fail('stalled global-budget PC opened'); } }, sharedSecret, {
				openSignal: capture.openSignal,
				makePeerConnection(){ pcMakes++; return makeStalledPc(); }
			}));
		}
		for(let i = 0; i < count; i++){
			const hex = (i + 1).toString(16);
			const hi = await makeSignedHi(sharedSecret, rooms[i], 'gGLOBAL', hex.repeat(24), Date.now(), hex);
			await captures[i].deliver('gGLOBAL', hi);
		}
		assert.equal(pcMakes, NET.RTC_LIMITS.GLOBAL_PENDING_MAX,
			'multiple rooms share one hard ceiling for half-open RTCPeerConnections');
		hosts[0].stop();
		const retry = await makeSignedHi(sharedSecret, rooms.at(-1), 'gGLOBAL', 'f'.repeat(24), Date.now(), 'f');
		await captures.at(-1).deliver('gGLOBAL', retry);
		assert.equal(pcMakes, NET.RTC_LIMITS.GLOBAL_PENDING_MAX + 1,
			'stopping a pending listener returns its global admission lease');
		for(let i = 1; i < hosts.length; i++) hosts[i].stop();
	}

	// Broker garbage is shape-rejected before local counters/HMAC, while shape-valid
	// bursts across separate rooms share one concurrent verification ceiling.
	{
		const sharedSecret = NET.mintInviteSecret();
		const captures = [makeSignalCapture(), makeSignalCapture()];
		const rooms = ['RTCV0', 'RTCV1'];
		let pcMakes = 0;
		const hosts = captures.map((capture, i) => NET.createRtcHost(rooms[i], {
			onPeer(){ assert.fail('verification-budget PC opened'); }
		}, sharedSecret, {
			openSignal: capture.openSignal,
			makePeerConnection(){ pcMakes++; throw new Error('count-only'); }
		}));
		const malformed = { k: 'hi', from: 'gVERIFY', role: 'h', to: 'h' };
		for(let i = 0; i < NET.RTC_LIMITS.SIGNAL_MAX + 5; i++) await captures[0].deliver('gVERIFY', malformed);
		const perRoom = NET.RTC_LIMITS.SIGNAL_PEER_MAX;
		const sealed = [];
		for(let roomIdx = 0; roomIdx < rooms.length; roomIdx++){
			const signer = NET.createSignedChannel(sharedSecret, rooms[roomIdx], 'gVERIFY');
			for(let i = 0; i < perRoom; i++){
				const sid = (roomIdx * perRoom + i + 1).toString(16).padStart(24, '0');
				sealed.push({ roomIdx, env: await signer.seal({ k: 'hi', to: 'h', sid }) });
			}
		}
		await Promise.all(sealed.map(({ roomIdx, env }) => captures[roomIdx].deliver('gVERIFY', env)));
		assert.equal(pcMakes, NET.RTC_LIMITS.SIGNAL_VERIFY_MAX,
			'concurrent pre-auth HMAC work is globally capped across signaling listeners');
		for(const host of hosts) host.stop();
	}

	// Concurrency alone does not stop a sustained stream. With a fixed clock, valid
	// envelopes spread across listeners still share one module-wide HMAC-start window.
	{
		const realNow = Date.now;
		const fixedNow = realNow() + 10000;
		Date.now = () => fixedNow;
		const sharedSecret = NET.mintInviteSecret();
		const captures = [makeSignalCapture(), makeSignalCapture()];
		const rooms = ['RTCR0', 'RTCR1'];
		let pcMakes = 0;
		const hosts = captures.map((capture, i) => NET.createRtcHost(rooms[i], {
			onPeer(){ assert.fail('verification-rate PC opened'); }
		}, sharedSecret, {
			openSignal: capture.openSignal,
			makePeerConnection(){ pcMakes++; throw new Error('count-only'); }
		}));
		try{
			for(let i = 0; i <= NET.RTC_LIMITS.SIGNAL_VERIFY_RATE_MAX; i++){
				const roomIdx = i & 1;
				const role = 'gRATE' + i;
				const signer = NET.createSignedChannel(sharedSecret, rooms[roomIdx], role);
				const env = await signer.seal({ k: 'hi', to: 'h', sid: i.toString(16).padStart(24, '0') });
				await captures[roomIdx].deliver(role, env);
			}
			assert.equal(pcMakes, NET.RTC_LIMITS.SIGNAL_VERIFY_RATE_MAX,
				'sustained verification work across listeners stops at one shared rate ceiling');
		}finally{
			for(const host of hosts) host.stop();
			Date.now = realNow;
		}
	}

	// Application lifecycle hooks are outside the transport trust boundary. A thrown
	// callback must tear down its generation instead of leaking an alive RTC entry.
	{
		const callbackRoom = 'RTCCBH';
		const callbackSecret = NET.mintInviteSecret();
		const callbackBus = makeSignalBus(false);
		const callbackRtc = makeFakeRtcPair();
		const callbackHost = NET.createRtcHost(callbackRoom, {
			onPeer(){ throw new Error('host-app-hook'); }
		}, callbackSecret, { openSignal: callbackBus.openSignal, makePeerConnection: callbackRtc.makeHost });
		const signer = NET.createSignedChannel(callbackSecret, callbackRoom, 'gCBHOST');
		await callbackBus.inject('h', 'gCBHOST', await signer.seal({ k: 'hi', to: 'h', sid: 'a'.repeat(24) }));
		await callbackBus.idle();
		assert.ok(callbackRtc.state.hostDc, 'callback-failure setup created the host DataChannel');
		callbackRtc.state.hostDc._open();
		await Promise.resolve(); await Promise.resolve();
		assert.equal(callbackRtc.state.hostPc.connectionState, 'closed', 'a throwing host onPeer hook fail-closes its PeerConnection');
		assert.equal(callbackRtc.state.hostDc.readyState, 'closed', 'a throwing host onPeer hook closes its DataChannel');
		callbackHost.stop();
	}
	{
		const callbackRoom = 'RTCCBJ';
		const callbackSecret = NET.mintInviteSecret();
		const callbackBus = makeSignalBus(false);
		const callbackRtc = makeFakeRtcPair();
		let failedOpenDc = null;
		const callbackHost = NET.createRtcHost(callbackRoom, { onPeer(){ /* transport may open */ } }, callbackSecret, {
			openSignal: callbackBus.openSignal, makePeerConnection: callbackRtc.makeHost
		});
		const callbackGuest = NET.createRtcJoin(callbackRoom, 'CBJOIN', {
			onOpen(){ failedOpenDc = callbackRtc.state.guestDc; throw new Error('guest-app-hook'); },
			onFail(){ assert.fail('callback test signaling failed'); }
		}, callbackSecret, { openSignal: callbackBus.openSignal, makePeerConnection: callbackRtc.makeGuest });
		await waitUntil(() => callbackRtc.state.guestPcs[0] && callbackRtc.state.guestPcs[0].connectionState === 'closed',
			'a throwing join onOpen hook did not fail-close its generation');
		assert.equal(failedOpenDc && failedOpenDc.readyState, 'closed', 'a throwing join onOpen hook closes its DataChannel');
		callbackGuest.close(); callbackHost.stop();
	}

	const room = 'RTCFAK';
	const secret = NET.mintInviteSecret();
	const bus = makeSignalBus(true);
	const rtc = makeFakeRtcPair();
	let hostPeer = null, guestConn = null, hostPeerOpenCount = 0;
	const hostMessages = [], guestMessages = [];
	const hostRtc = NET.createRtcHost(room, {
		onPeer(peer){ hostPeerOpenCount++; hostPeer = peer; peer.onMessage = pl => hostMessages.push(pl); }
	}, secret, { openSignal: bus.openSignal, makePeerConnection: rtc.makeHost });
	const guestRtc = NET.createRtcJoin(room, 'RTCFAKE', {
		onOpen(conn){ guestConn = conn; conn.onMessage = pl => guestMessages.push(pl); },
		onFail(){ assert.fail('the deterministic signal bus must not fail'); }
	}, secret, { openSignal: bus.openSignal, makePeerConnection: rtc.makeGuest });

	await waitUntil(() => hostPeer && guestConn, 'the real RTC host/join state machines did not open');
	await bus.idle();
	assert.equal(rtc.state.hostMakeCount, 1, 'one authenticated hi creates exactly one host PeerConnection');
	assert.equal(rtc.state.guestMakeCount, 1, 'one verified offer creates exactly one guest PeerConnection');
	const extraGuestChannel = new (rtc.state.hostDc.constructor)('evil-extra');
	rtc.state.hostPc.ondatachannel({ channel: extraGuestChannel });
	assert.equal(extraGuestChannel.readyState, 'closed', 'the RTC host immediately rejects every guest-created extra data channel');
	assert.deepEqual(bus.sent.map(m => m.k), ['hi', 'offer', 'ice', 'answer', 'ice'], 'the authenticated handshake emits hi, SDP, and trickled ICE');
	assert.ok(bus.sent.every(m => /^[0-9a-f]{64}$/.test(m.sig) && /^[0-9a-f]{24}$/.test(m.sid)), 'every plumbing signal is signed and session-bound');
	assert.ok(bus.sent.every(m => m.v === NET.SIGNAL_ENVELOPE_VERSION), 'the real RTC plumbing emits only fail-closed v2 envelopes');
	assert.ok(bus.sent.filter(m => m.k !== 'hi').every(m => typeof m.ct === 'string' && m.ct.length > 20
		&& !Object.hasOwn(m, 'sdp') && !Object.hasOwn(m, 'c') && !Object.hasOwn(m, 'fp')),
		'every broker-visible SDP/ICE signal carries ciphertext and no sensitive clear fields');
	const brokerTranscript = JSON.stringify(bus.sent);
	assert.ok(!brokerTranscript.includes('candidate:host') && !brokerTranscript.includes('candidate:guest')
		&& !brokerTranscript.includes('fingerprint:sha-256'),
		'the deterministic broker transcript contains no candidate addresses or DTLS fingerprints');
	const hostIceAt = bus.delivered.findIndex(m => m.from === 'h' && m.k === 'ice');
	const offerAt = bus.delivered.findIndex(m => m.from === 'h' && m.k === 'offer');
	const guestIceAt = bus.delivered.findIndex(m => m.from === 'gRTCFAKE' && m.k === 'ice');
	const answerAt = bus.delivered.findIndex(m => m.from === 'gRTCFAKE' && m.k === 'answer');
	assert.ok(hostIceAt >= 0 && hostIceAt < offerAt, 'host ICE is delivered before the offer SDP');
	assert.ok(guestIceAt >= 0 && guestIceAt < answerAt, 'guest ICE is delivered before the answer SDP');
	assert.equal(rtc.state.guestPc.addedIce[0].candidate, 'candidate:host', 'pre-offer host ICE was buffered then applied');
	assert.equal(rtc.state.hostPc.addedIce[0].candidate, 'candidate:guest', 'pre-answer guest ICE was buffered then applied');

	guestConn.send({ t: 'hello', proof: 'guest-to-host' });
	await Promise.resolve(); await Promise.resolve();
	assert.equal(hostMessages.some(m => m && m.proof === 'guest-to-host'), true, 'guest JSON crosses the opened data channel');
	hostPeer.send({ t: 'welcome', proof: 'host-to-guest' });
	await Promise.resolve(); await Promise.resolve();
	assert.equal(guestMessages.some(m => m && m.proof === 'host-to-guest'), true, 'host JSON crosses the opened data channel');
	// A valid invite holder still cannot move a follow-up into another negotiation id.
	const sid = bus.sent.find(m => m.k === 'hi').sid;
	const remoteSetCount = rtc.state.hostPc.remoteDescriptions.length;
	const crossSessionSigner = NET.createSignedChannel(secret, room, 'gRTCFAKE');
	const crossSessionAnswer = await crossSessionSigner.seal({
		k: 'answer', to: 'h', sid: sid === 'e'.repeat(24) ? 'f'.repeat(24) : 'e'.repeat(24),
		sdp: { type: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 11:22:33:44:55:66\r\n' }
	});
	await bus.inject('h', 'gRTCFAKE', crossSessionAnswer);
	await bus.idle();
	assert.equal(rtc.state.hostPc.remoteDescriptions.length, remoteSetCount, 'a correctly signed cross-session answer is ignored');
	assert.equal(rtc.state.hostMakeCount, 1, 'cross-session traffic cannot create another peer');
	const aliveHi = await makeSignedHi(secret, room, 'gRTCFAKE', 'd'.repeat(24), Date.now(), 'e');
	await bus.inject('h', 'gRTCFAKE', aliveHi);
	await bus.idle();
	assert.equal(rtc.state.hostMakeCount, 1, 'even a newer authenticated hi cannot displace an alive peer');

	const staleGuestStateChange = rtc.state.guestPc.onconnectionstatechange;
	const staleHostDataOpen = rtc.state.hostDc.onopen;
	const beforeGuestOversize = hostMessages.length;
	rtc.state.guestDc.send(JSON.stringify({ t: 'oversize', blob: 'x'.repeat(NET.RTC_LIMITS.GUEST_JSON_MAX + 1) }));
	await Promise.resolve(); await Promise.resolve();
	assert.equal(hostMessages.slice(beforeGuestOversize).some(m => m && m.t === 'oversize'), false, 'oversized guest control frames are rejected before JSON parsing');
	assert.equal(rtc.state.hostDc.readyState, 'closed', 'a malformed/oversized invited sender loses the RTC channel');
	const afterDrop = hostMessages.length;
	guestConn.send({ t: 'afterGuestOversize' });
	await Promise.resolve(); await Promise.resolve();
	assert.equal(hostMessages.length, afterDrop, 'closed abusive channel cannot resume with a valid frame');
	guestRtc.close();
	hostRtc.stop();
	await Promise.resolve(); await Promise.resolve();
	const signalCountAfterClose = bus.sent.length;
	staleGuestStateChange();
	staleHostDataOpen();
	await Promise.resolve(); await Promise.resolve();
	assert.equal(bus.sent.length, signalCountAfterClose, 'callbacks from a closed guest generation cannot emit a replacement hi');
	assert.equal(hostPeerOpenCount, 1, 'a stale host data-channel open cannot resurrect a stopped negotiation');

	// A shape-valid hi whose sid was changed after signing never reaches makePeerConnection.
	const rejectBus = makeSignalBus(false);
	let rejectedPcMakes = 0;
	const rejectHost = NET.createRtcHost('RTCREJ', { onPeer(){ assert.fail('tampered hi opened a peer'); } }, secret, {
		openSignal: rejectBus.openSignal,
		makePeerConnection(){ rejectedPcMakes++; throw new Error('must-not-run'); }
	});
	const badSigner = NET.createSignedChannel(secret, 'RTCREJ', 'gBAD');
	const signedHi = await badSigner.seal({ k: 'hi', to: 'h', sid: '1'.repeat(24) });
	await rejectBus.inject('h', 'gBAD', { ...signedHi, sid: '2'.repeat(24) });
	await rejectBus.idle();
	assert.equal(rejectedPcMakes, 0, 'a tampered negotiation id cannot cross the auth gate or allocate RTC state');
	rejectHost.stop();

	// Delayed authenticated hi packets are ordered by their signed timestamp. If an
	// old generation arrived first, a strictly newer sid replaces only that pending
	// PC; the opposite delivery order leaves the newer generation pinned.
	{
		const orderRoom = 'RTCHIO';
		const orderBus = makeSignalBus(false);
		const orderRtc = makeFakeRtcPair();
		const orderHost = NET.createRtcHost(orderRoom, { onPeer(){ assert.fail('pending ordering test must not open a peer'); } }, secret, {
			openSignal: orderBus.openSignal, makePeerConnection: orderRtc.makeHost
		});
		const baseTs = Date.now();
		const oldHi = await makeSignedHi(secret, orderRoom, 'gORDER', '1'.repeat(24), baseTs - 10, '1');
		const newHi = await makeSignedHi(secret, orderRoom, 'gORDER', '2'.repeat(24), baseTs, '2');
		await orderBus.inject('h', 'gORDER', oldHi);
		await orderBus.idle();
		const oldPc = orderRtc.state.hostPcs[0];
		assert.equal(orderRtc.state.hostMakeCount, 1, 'old hi initially owns one pending negotiation');
		await orderBus.inject('h', 'gORDER', newHi);
		await orderBus.idle();
		assert.equal(orderRtc.state.hostMakeCount, 2, 'a strictly newer sid replaces the old pending negotiation');
		assert.equal(oldPc.connectionState, 'closed', 'replacing a stale pending generation closes its PeerConnection');
		assert.equal(orderBus.sent.filter(m => m.k === 'offer').at(-1).sid, newHi.sid, 'the replacement offer is bound to the newer sid');
		orderHost.stop();
	}
	{
		const orderRoom = 'RTCHIN';
		const orderBus = makeSignalBus(false);
		const orderRtc = makeFakeRtcPair();
		const orderHost = NET.createRtcHost(orderRoom, { onPeer(){ assert.fail('pending ordering test must not open a peer'); } }, secret, {
			openSignal: orderBus.openSignal, makePeerConnection: orderRtc.makeHost
		});
		const baseTs = Date.now();
		const newHi = await makeSignedHi(secret, orderRoom, 'gORDER', '4'.repeat(24), baseTs, '4');
		const oldHi = await makeSignedHi(secret, orderRoom, 'gORDER', '3'.repeat(24), baseTs - 10, '3');
		const equalHi = await makeSignedHi(secret, orderRoom, 'gORDER', '5'.repeat(24), baseTs, '5');
		await orderBus.inject('h', 'gORDER', newHi);
		await orderBus.idle();
		const pinnedPc = orderRtc.state.hostPcs[0];
		await orderBus.inject('h', 'gORDER', oldHi);
		await orderBus.inject('h', 'gORDER', equalHi);
		await orderBus.idle();
		assert.equal(orderRtc.state.hostMakeCount, 1, 'older and equal-timestamp hi packets cannot displace the newer pending generation');
		assert.notEqual(pinnedPc.connectionState, 'closed', 'the newer pending PeerConnection remains pinned');
		assert.equal(orderBus.sent.filter(m => m.k === 'offer').length, 1, 'ignored stale hi packets emit no replacement offer');
		orderHost.stop();
	}
}

// ============================ PART B — host driven over loopback ============================

const localStore = new Map();
globalThis.localStorage = {
	getItem: key => localStore.has(key) ? localStore.get(key) : null,
	setItem: (key, value) => { localStore.set(key, String(value)); },
	removeItem: key => { localStore.delete(key); }
};
const sessionStore = new Map();
globalThis.sessionStorage = {
	getItem: key => sessionStore.has(key) ? sessionStore.get(key) : null,
	setItem: (key, value) => { sessionStore.set(key, String(value)); },
	removeItem: key => { sessionStore.delete(key); }
};
const { ghostHost } = await import('../src/engine/ghost_host.js');

// A configurable solidity predicate for the host bridge (default: open world).
let SOLID = () => false;
let TARGET_CLEAR = () => true;
let healHeroCalls = 0;
let playPlaceCalls = 0;
let playMineCalls = 0;
let heroPlaceCalls = 0;
let heroDamageCalls = 0;
let heroMineCalls = 0;
let assistExecCalls = 0;
let heroPlaceOk = true;
let playAttackOk = true;
let playMineResult = { ok: false, reason: 'tile' };
let heroMineResult = { ok: false, reason: 'tile' };
let heroPickupResult = { ok: false, reason: 'none' };
let heroUseResult = { ok: false, reason: 'use' };
const bridge = {
	msg(){},
	player: { x: 5, y: 5, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H, vx: 0, vy: 0, facing: 1, hp: 100, maxHp: 100, energy: 50 },
	buildSave: () => ({ v: 1, world: 'stub' }),
	solidAt: (x, y) => !!SOLID(x, y),
	ghostBodySolidAt: (x, y, axis) => !!SOLID(x, y, axis),
	ghostBodyBounds: () => ({ minX: -30000000, maxX: 30000000, minY: -140, maxY: 280 }),
	ghostTargetClear: (originX, originY, tx, ty) => !!TARGET_CLEAR(originX, originY, tx, ty),
	getTile: () => 0,
	drawHeroAt(){}, snapCameraToPlayer(){},
	snapshotDrops: () => null, snapshotSeasons: () => null, snapshotInfra: () => null,
	snapshotConstructionBackground: () => null, snapshotNpcs: () => null, snapshotStory: () => null,
	healHero(){ healHeroCalls++; }, addHeroEnergy(){},
	ghostPower: () => 0,
	ghostAssistLabel: (a, id, n) => a === 'craft' && id === 'test-recipe' ? 'Test recipe ×' + n : null,
	ghostAssistState: () => ({ recipes:[], items:[], resources:[] }),
	ghostAssist: () => { assistExecCalls++; return { ok:true, label:'executed', made:1 }; },
	ghostPlayAttack: () => playAttackOk ? { ok: true, hits: 0 } : { ok: false, reason: 'spawn' },
	ghostPlayMineTicks: () => 1,
	ghostPlayMineAt: () => { playMineCalls++; return playMineResult; },
	ghostPlayPlaceAt: () => { playPlaceCalls++; return { ok: true }; },
	ghostHeroDamage: () => { heroDamageCalls++; return 1; },
	ghostHeroMineAt: () => { heroMineCalls++; return heroMineResult; },
	ghostHeroPickupAt: () => heroPickupResult,
	ghostHeroUseAt: () => heroUseResult,
	ghostHeroPlacementKey: tid => ({ 1: 'wood', 77: 'diamond' })[Number(tid) | 0] || null,
	ghostHeroPlaceAt: () => { heroPlaceCalls++; return heroPlaceOk ? { ok: true } : { ok: false, reason: 'write' }; },
	ghostGiftTake: (key, n) => ({ ok: true, key, n, label: key })
};
// Install the render-change seam before host start so live infra tests can mark
// the production dirty flag through the same sentinel callback as the game.
MM.onTileRenderChanged = () => {};
ghostHost.wire(bridge);
const ROOM = 'HOSTLE';
ghostHost.start({ room: ROOM, rtc: false });

function persistedBody(gid, room = ROOM){
	try{
		const store = JSON.parse(localStorage.getItem('mm_ghost_bodies_v1') || 'null');
		return store && Array.isArray(store.entries) ? store.entries.find(row => row.room === room && row.gid === gid) || null : null;
	}catch(e){ return null; }
}

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
function makeGuest(conn, room){
	const ch = new BroadcastChannel('mm_ghost_' + (room || ROOM));
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

	// A second viewer arriving inside SNAP_CACHE_MS reuses viewer A's serialized
	// save, but must still receive every CURRENT independently streamed plane.
	// The correction is targeted: viewer A must not be flooded again just because
	// viewer B joined.
	{
		const old = {
			buildSave: bridge.buildSave, infra: bridge.snapshotInfra, bg: bridge.snapshotConstructionBackground,
			water: MM.water, drifts: MM.softDrifts, icicles: MM.icicles,
			graffiti: MM.graffiti, boats: MM.boats, mechs: MM.mechs
		};
		let rev = 1, saveBuilds = 0;
		const builds = { infra: 0, bg: 0, water: 0, drift: 0, prints: 0, ice: 0, gfx: 0, boats: 0, mechs: 0 };
		const restore = (key, value) => { if(value === undefined) delete MM[key]; else MM[key] = value; };
		try{
			bridge.buildSave = () => { saveBuilds++; return { v: 1, world: 'cached-' + rev }; };
			bridge.snapshotInfra = () => { builds.infra++; return { rev }; };
			bridge.snapshotConstructionBackground = () => { builds.bg++; return { rev }; };
			MM.water = { ghostPartialsIn: () => { builds.water++; return [[1, 2, rev]]; } };
			MM.softDrifts = {
				ghostLevelsIn: () => { builds.drift++; return [[1, 2, rev]]; },
				ghostPrintsIn: () => { builds.prints++; return [[3, 4, rev]]; },
				ghostStormOut: () => [rev]
			};
			MM.icicles = { ghostIciclesIn: () => { builds.ice++; return [[5, 6, rev]]; } };
			MM.graffiti = { ghostVersion: () => rev, ghostOut: () => { builds.gfx++; return [[rev]]; } };
			MM.boats = { snapshot: () => { builds.boats++; return { rev }; } };
			MM.mechs = { snapshot: () => { builds.mechs++; return { rev }; }, anyGuestDriven: () => false };

			const first = makeGuest('c-late-one'); first.hello('gid-late-one'); await flush();
			check(first.last('infra')?.data?.rev === 1 && first.last('infra')?.bg?.rev === 1,
				'first viewer receives current infrastructure planes after its snapshot');
			rev = 2;
			tickHost(); await flush(); // establish rev 2 as every sig-skipped plane's broadcast cursor
			const planeTypes = ['infra', 'pwat', 'drift', 'gfx', 'mach'];
			const firstCounts = Object.fromEntries(planeTypes.map(type => [type, first.all(type).length]));

			const second = makeGuest('c-late-two'); second.hello('gid-late-two'); await flush();
			const infra = second.last('infra'), pwat = second.last('pwat'), drift = second.last('drift');
			const gfx = second.last('gfx'), mach = second.last('mach');
			check(saveBuilds === 1, 'second viewer reuses the cached base snapshot');
			check(infra?.data?.rev === 2 && infra?.bg?.rev === 2,
				'second viewer receives current infrastructure despite the cached snapshot');
			check(pwat?.w?.[0]?.[4]?.[0]?.[2] === 2,
				'second viewer receives current partial-water windows despite the cached snapshot');
			check(drift?.w?.[0]?.[4]?.[0]?.[2] === 2 && drift?.p?.[0]?.[4]?.[0]?.[2] === 2
				&& drift?.i?.[0]?.[4]?.[0]?.[2] === 2 && drift?.s?.[0] === 2,
				'second viewer receives current drift, footprint, icicle and gale planes');
			check(gfx?.m?.[0]?.[0] === 2, 'second viewer receives current graffiti despite the cached snapshot');
			check(mach?.data?.b?.rev === 2 && mach?.data?.m?.rev === 2,
				'second viewer receives current boats and mechs despite the cached snapshot');
			check(planeTypes.every(type => first.all(type).length === firstCounts[type]),
				'second-viewer plane corrections are targeted and do not rebroadcast to the first viewer');

			// A third spectator in the same short burst gets the same targeted frames,
			// without rebuilding/sorting every full plane again.
			const afterSecondBuilds = Object.assign({}, builds);
			const third = makeGuest('c-late-three'); third.hello('gid-late-three'); await flush();
			check(Object.keys(builds).every(k => builds[k] === afterSecondBuilds[k]),
				'a burst third viewer reuses the bounded join-plane build cache');
			check(third.last('infra')?.data?.rev === 2 && third.last('pwat')?.sync === 1
				&& third.last('drift')?.sync === 1,
				'coalesced join planes remain targeted snapshot corrections for the third viewer');
			await bye(third); third.close();
			const afterSpectatorDropBuilds = Object.assign({}, builds);
			const fourth = makeGuest('c-late-four'); fourth.hello('gid-late-four'); await flush();
			check(Object.keys(builds).every(k => builds[k] === afterSpectatorDropBuilds[k]),
				'a watch-only disconnect does not defeat burst join-plane coalescing');
			const beforeTtlExpiryBuilds = Object.assign({}, builds);
			await new Promise(r => setTimeout(r, 1050));
			const fifth = makeGuest('c-late-five'); fifth.hello('gid-late-five'); await flush();
			check(builds.infra > beforeTtlExpiryBuilds.infra && builds.gfx > beforeTtlExpiryBuilds.gfx
				&& builds.boats > beforeTtlExpiryBuilds.boats,
				'the one-second join-plane cache expires and rebuilds current truth even without an invalidation event');

			// Exact resync race: first accept ordinary live water/drift, then request a
			// snapshot immediately. Its current corrections must follow the snapshot and
			// carry the client's one-shot cadence-floor marker.
			await new Promise(r => setTimeout(r, 4100)); // total wait now passes the host needSnap floor
			rev = 3;
			second.clear(); tickHost(); await flush();
			check(second.last('pwat')?.sync !== 1 && second.last('drift')?.sync !== 1,
				'the viewer accepts ordinary live water/drift immediately before resync');
			second.clear(); second.send({ t: 'needSnap' }); await flush();
			const lastSnapChunk = second.inbox.reduce((at, pl, i) => pl.t === 'chunk' && pl.k === 'snap' ? i : at, -1);
			const syncWaterAt = second.inbox.findIndex(pl => pl.t === 'pwat' && pl.sync === 1);
			const syncDriftAt = second.inbox.findIndex(pl => pl.t === 'drift' && pl.sync === 1);
			check(lastSnapChunk >= 0 && syncWaterAt > lastSnapChunk && syncDriftAt > lastSnapChunk,
				'needSnap sends one-shot water/drift corrections after the snapshot that overwrites those planes');
			check(second.inbox[syncWaterAt]?.w?.[0]?.[4]?.[0]?.[2] === 3
				&& second.inbox[syncDriftAt]?.w?.[0]?.[4]?.[0]?.[2] === 3,
				'needSnap corrections carry current plane truth, not the just-replaced revision');

			// Infra/background can exceed the RTC non-chunk ceiling. A cached base save
			// must still be followed by a bounded chunked current plane rather than a
			// silently dropped oversized JSON frame.
			await new Promise(r => setTimeout(r, 1050)); // expire the bounded join-plane cache
			const bigBlob = 'x'.repeat(NET.WIRE_LIMITS.JSON_MAX + 4096);
			rev = 4;
			bridge.snapshotInfra = () => ({ rev, blob: bigBlob });
			bridge.snapshotConstructionBackground = () => null;
			const bigGuest = makeGuest('c-late-big'); bigGuest.hello('gid-late-big'); await flush();
			const bigChunks = bigGuest.inbox.filter(pl => pl.t === 'chunk' && pl.k === 'plane');
			const planeAssembler = NET.createAssembler();
			let assembledPlane = null;
			for(const env of bigChunks) assembledPlane = planeAssembler.push(env) || assembledPlane;
			let bigInfra = null;
			try{ bigInfra = assembledPlane ? JSON.parse(assembledPlane.data) : null; }catch(e){ bigInfra = null; }
			check(bigGuest.last('infra') === null && bigChunks.length > 1,
				'an infra correction above JSON_MAX is emitted as bounded plane chunks, never one oversized frame');
			check(bigInfra?.t === 'infra' && bigInfra?.data?.rev === 4 && bigInfra?.data?.blob?.length === bigBlob.length,
				'the oversized current infra plane reassembles losslessly after a cached snapshot');

			// The same oversized state must remain deliverable after a LIVE dirty event;
			// live broadcasts previously bypassed the size-aware join path and RTC
			// silently discarded their single >JSON_MAX frame.
			rev = 5;
			bigGuest.clear();
			MM.onTileRenderChanged(9, 9, 7, 7); // production infra sentinel: old === next
			tickHost(); await flush();
			const liveChunks = bigGuest.inbox.filter(pl => pl.t === 'chunk' && pl.k === 'plane');
			const liveAssembler = NET.createAssembler();
			let liveInfra = null, completedPlanes = 0, restoreDispatches = 0;
			for(const env of liveChunks){
				const done = liveAssembler.push(env);
				if(!done) continue;
				completedPlanes++;
				let packet = null; try{ packet = JSON.parse(done.data); }catch(e){ packet = null; }
				if(packet?.t === 'infra'){ liveInfra = packet; restoreDispatches++; }
			}
			check(bigGuest.last('infra') === null && liveChunks.length > 1 && liveInfra?.data?.rev === 5,
				'a >JSON_MAX live infrastructure broadcast uses the shared chunked plane path');
			check(completedPlanes === 1 && restoreDispatches === 1,
				'the client-side bounded assembler completes one live plane and dispatches one infra restore');

			// Snapshot codecs expose an explicit `complete:false` when their safety cap
			// truncated the world. Such a prefix is not authoritative: live streaming
			// must send nothing and keep the dirty latch armed for a later full retry.
			rev = 6;
			bridge.snapshotInfra = () => ({ rev, complete: false, list: [[1, 2, 3]] });
			bridge.snapshotConstructionBackground = () => ({ rev, complete: true, list: [] });
			MM.onTileRenderChanged(10, 10, 8, 8);
			await new Promise(r => setTimeout(r, 1550)); // pass the infrastructure cadence floor
			bigGuest.clear(); tickHost(); await flush();
			check(bigGuest.last('infra') === null
				&& bigGuest.inbox.every(pl => !(pl.t === 'chunk' && pl.k === 'plane')),
				'an incomplete live infrastructure plane emits neither a direct frame nor chunks');
			check(ghostHost.metrics().infraDirty === true,
				'an incomplete live infrastructure snapshot leaves the dirty retry latch armed');

			// Exercise the independently capped construction-background half on join.
			// The joining viewer may receive the other current planes, but never a
			// truncated infrastructure authority frame in either wire form.
			bridge.snapshotInfra = () => ({ rev, complete: true, list: [] });
			bridge.snapshotConstructionBackground = () => ({ rev, complete: false, list: [[4, 5, 6]] });
			const incompleteGuest = makeGuest('c-late-incomplete');
			incompleteGuest.hello('gid-late-incomplete'); await flush();
			check(incompleteGuest.last('infra') === null
				&& incompleteGuest.inbox.every(pl => !(pl.t === 'chunk' && pl.k === 'plane')),
				'a join sends no infrastructure plane when its construction background is incomplete');
			check(ghostHost.metrics().infraDirty === true,
				'a failed incomplete join build does not accidentally disarm the live retry latch');

			await bye(first); await bye(second); await bye(fourth); await bye(fifth); await bye(bigGuest); await bye(incompleteGuest);
			first.close(); second.close(); fourth.close(); fifth.close(); bigGuest.close(); incompleteGuest.close();
		}finally{
			bridge.buildSave = old.buildSave;
			bridge.snapshotInfra = old.infra;
			bridge.snapshotConstructionBackground = old.bg;
			restore('water', old.water); restore('softDrifts', old.drifts); restore('icicles', old.icicles);
			restore('graffiti', old.graffiti); restore('boats', old.boats); restore('mechs', old.mechs);
		}
	}

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
		const bad = makeGuest('c-bad-gid');
		bad.hello('ga>gb');
		await flush();
		check(bad.last('invalid') && bad.last('invalid').reason === 'gid', 'a delimiter-bearing gid is refused before it owns a seat');
		check(bad.last('welcome') === null, 'an invalid gid receives no welcome or snapshot authority');
	}

	// Finite-but-astronomical spectator coordinates overflow once render code
	// multiplies them by TILE. Both camera packet types are clamped to host bounds.
	{
		const poseCam = makeGuest('c-cam-pose'); poseCam.hello('gid-cam-pose'); await flush();
		ghostHost.setViewerMode('gid-cam-pose', 'chat'); await flush();
		poseCam.send({ t:'pose', x:Number.MAX_VALUE, y:-Number.MAX_VALUE, act:1 }); await flush();
		poseCam.clear(); poseCam.send({ t:'ping' }); await flush();
		const p1=poseCam.last('ping');
		check(p1 && Number.isFinite(p1.x) && Number.isFinite(p1.y) && p1.x===30000000 && p1.y===-140,
			'spectator pose clamps finite overflow coordinates into the render-safe world envelope');
		await bye(poseCam);

		const playCam = makeGuest('c-cam-ppose'); playCam.hello('gid-cam-ppose'); await flush();
		ghostHost.setViewerMode('gid-cam-ppose', 'chat'); await flush();
		playCam.send({ t:'ppose', x:-Number.MAX_VALUE, y:Number.MAX_VALUE, act:1 }); await flush();
		playCam.clear(); playCam.send({ t:'ping' }); await flush();
		const p2=playCam.last('ping');
		check(p2 && Number.isFinite(p2.x) && Number.isFinite(p2.y) && p2.x===-30000000 && p2.y===280,
			'bodyless ppose clamps finite overflow coordinates into the render-safe world envelope');
		await bye(playCam);
	}

	// A queued approval is not a durable capability: revoking the assistant before
	// the host clicks approve must make the stale row non-executable.
	{
		const a = makeGuest('c-assist-revoke'); a.hello('gid-assist-revoke'); await flush();
		ghostHost.setViewerMode('gid-assist-revoke', 'full');
		ghostHost.setAssistant('gid-assist-revoke', true);
		ghostHost.setApprovalMode(true); await flush();
		a.send({ t:'assist', a:'craft', id:'test-recipe', n:1 }); await flush();
		const queued=ghostHost.metrics().queue[0];
		check(queued && queued.gid==='gid-assist-revoke', 'assistant request enters the bounded approval queue');
		ghostHost.setAssistant('gid-assist-revoke', false);
		const beforeAssistExec=assistExecCalls;
		check(queued && ghostHost.approveAssist(queued.qid)===false, 'revoked assistant queue row fails approval-time authority revalidation');
		check(assistExecCalls===beforeAssistExec, 'revoked queued assistant work never reaches the execution bridge');
		ghostHost.setApprovalMode(false);
		await bye(a);
	}

	// Persisted body cargo is authority only inside its retention window AND only
	// for the holder of the resume-token proof saved with it.
	{
		const rightfulProof = NET.mintResumeToken();
		const legacyProof = NET.mintResumeToken();
		const wrongProof = NET.mintResumeToken();

		// Pre-v2 rows have no room authority. Proof-bearing and gid-only variants are
		// both discarded, and the first v2 write replaces the legacy object entirely.
		localStorage.setItem('mm_ghost_bodies_v1', JSON.stringify({
			'gid-legacy': { pouch: { diamond: 8 }, weapons: ['spear'], ts: Date.now() }
		}));
		const legacy = makeGuest('c-legacy'); legacy.hello('gid-legacy'); await flush();
		check(legacy.last('welcome') !== null && legacy.last('taken') === null, 'a gid-only legacy row cannot permanently lock admission');
		ghostHost.setViewerMode('gid-legacy', 'play'); await flush();
		const legacyBody = ghostHost._debugBody('gid-legacy');
		check(legacyBody && !legacyBody.pouch.diamond && !legacyBody.weapons.includes('spear'), 'a gid-only legacy row is ignored rather than leaked to the new claimant');
		await bye(legacy);

		localStorage.setItem('mm_ghost_bodies_v1', JSON.stringify({
			'gid-legacy-proof': { pouch: { diamond: 6 }, weapons: ['spear'], rt: legacyProof, ts: Date.now() }
		}));
		const legacyOwner = makeGuest('c-legacy-proof'); legacyOwner.hello('gid-legacy-proof', { rt: legacyProof }); await flush();
		const legacyWelcome = legacyOwner.last('welcome');
		check(legacyWelcome && legacyWelcome.rt !== legacyProof && legacyOwner.last('taken') === null,
			'a proof-bearing legacy row is discarded and receives a fresh room-bound identity proof');
		ghostHost.setViewerMode('gid-legacy-proof', 'play'); await flush();
		const legacyProofBody = ghostHost._debugBody('gid-legacy-proof');
		check(legacyProofBody && !legacyProofBody.pouch.diamond && !legacyProofBody.weapons.includes('spear'),
			'a room-unbound proof never migrates cargo into the current room');
		await bye(legacyOwner);

		// Expired and oversized v2 stores fail closed before they can reserve a gid or
		// restore cargo. The next authoritative bank rewrites a small canonical store.
		const staleProof = NET.mintResumeToken();
		localStorage.setItem('mm_ghost_bodies_v1', JSON.stringify({ v: 2, entries: [
			{ room: ROOM, gid: 'gid-stale', pouch: { diamond: 9 }, weapons: ['spear'], rt: staleProof, ts: Date.now() - 8 * 24 * 3600 * 1000 }
		] }));
		const stale = makeGuest('c-stale'); stale.hello('gid-stale', { rt: staleProof }); await flush();
		check(stale.last('welcome') && stale.last('welcome').rt !== staleProof && stale.last('taken') === null,
			'an expired v2 row neither reserves the gid nor reuses its stale proof');
		ghostHost.setViewerMode('gid-stale', 'play'); await flush();
		const staleBody = ghostHost._debugBody('gid-stale');
		check(staleBody && !staleBody.pouch.diamond && !staleBody.weapons.includes('spear'), 'an expired body snapshot cannot restore pouch or arsenal');
		await bye(stale);

		const oversizedProof = NET.mintResumeToken();
		localStorage.setItem('mm_ghost_bodies_v1', JSON.stringify({ v: 2, entries: [
			{ room: ROOM, gid: 'gid-oversized', pouch: { diamond: 11 }, weapons: ['spear'], rt: oversizedProof, ts: Date.now() }
		], pad: 'x'.repeat(262145) }));
		const oversized = makeGuest('c-oversized'); oversized.hello('gid-oversized', { rt: oversizedProof }); await flush();
		check(oversized.last('welcome') && oversized.last('welcome').rt !== oversizedProof && oversized.last('taken') === null,
			'an oversized raw body store is rejected before its valid-looking row can reserve a gid');
		ghostHost.setViewerMode('gid-oversized', 'play'); await flush();
		const oversizedBody = ghostHost._debugBody('gid-oversized');
		check(oversizedBody && !oversizedBody.pouch.diamond && !oversizedBody.weapons.includes('spear'),
			'an oversized raw store restores no attacker-controlled cargo');
		await bye(oversized);
		let persistedRaw = localStorage.getItem('mm_ghost_bodies_v1') || '';
		let persisted = JSON.parse(persistedRaw || 'null');
		check(persistedRaw.length < 262144 && persisted && persisted.v === 2 && !Object.hasOwn(persisted, 'pad'),
			'banking after an oversized store rewrites a bounded v2 envelope');

		const otherProof = NET.mintResumeToken(), otherRoomProof = NET.mintResumeToken();
		const hostilePouch = { diamond: 7, constructor: 99, prototype: 99, huge: '1e999' };
		Object.defineProperty(hostilePouch, '__proto__', { value: 99, enumerable: true });
		hostilePouch['x'.repeat(65)] = 99;
		for(let i = 0; i < 45; i++) hostilePouch['loot' + i] = i + 1;
		const currentTs = Date.now();
		localStorage.setItem('mm_ghost_bodies_v1', JSON.stringify({ v: 2, entries: [
			{ room: ROOM, gid: 'gid-protected', pouch: hostilePouch, weapons: ['spear', 'spear', 'bogus', 'bow'], rt: rightfulProof, ts: currentTs, extra: 'drop-me', legacy: 1 },
			{ room: ROOM, gid: 'gid-protected', pouch: { diamond: 99 }, weapons: ['spear'], rt: wrongProof, ts: currentTs - 1000, duplicate: true },
			{ room: 'OTHER7', gid: 'gid-protected', pouch: { diamond: 4 }, weapons: ['spear'], rt: otherProof, ts: currentTs, extra: true },
			{ room: 'OTHER7', gid: 'gid-other-room', pouch: { diamond: 5 }, weapons: ['spear'], rt: otherRoomProof, ts: currentTs },
			{ room: 'bad', gid: 'gid-invalid-room', pouch: { diamond: 88 }, weapons: ['spear'], rt: otherProof, ts: currentTs }
		] }));
		const wrong = makeGuest('c-protected-wrong'); wrong.hello('gid-protected', { rt: wrongProof }); await flush();
		check(wrong.last('taken') !== null && wrong.last('welcome') === null, 'the wrong proof cannot claim a current-room persisted body identity');
		const rightful = makeGuest('c-protected-right'); rightful.hello('gid-protected', { rt: rightfulProof }); await flush();
		const rightfulWelcome = rightful.last('welcome');
		check(rightfulWelcome && rightfulWelcome.rt === rightfulProof, 'the rightful persisted proof reclaims the same private token');
		ghostHost.setViewerMode('gid-protected', 'play'); await flush();
		const protectedBody = ghostHost._debugBody('gid-protected');
		check(protectedBody && protectedBody.pouch.diamond === 7 && protectedBody.weapons.includes('spear'), 'the rightful proof restores validated pouch and arsenal');
		await bye(rightful);
		persisted = JSON.parse(localStorage.getItem('mm_ghost_bodies_v1') || 'null');
		const rewritten = persisted && Array.isArray(persisted.entries) ? persisted.entries.find(row => row.room === ROOM && row.gid === 'gid-protected') : null;
		check(persisted && persisted.v === 2 && rewritten && rewritten.rt === rightfulProof, 'body persistence keeps version, room and proof binding on every authoritative write');
		check(persisted.entries.length <= 24 && persisted.entries.every(row => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['gid', 'pouch', 'room', 'rt', 'ts', 'weapons'])),
			'every retained v2 row is rewritten to the exact bounded field set');
		check(rewritten && Object.keys(rewritten.pouch).length <= 40
			&& !Object.hasOwn(rewritten.pouch, '__proto__') && !Object.hasOwn(rewritten.pouch, 'prototype') && !Object.hasOwn(rewritten.pouch, 'constructor')
			&& !Object.hasOwn(rewritten.pouch, 'x'.repeat(65)) && rewritten.pouch.huge === NET.PLAY_RULES.POUCH_CAP,
			'canonical body writes bound pouch keys/counts and discard prototype-sensitive names');
		check(rewritten && rewritten.weapons.length <= 8 && new Set(rewritten.weapons).size === rewritten.weapons.length
			&& rewritten.weapons.every(key => NET.validPlayWeapon(key)) && !Object.hasOwn(rewritten, 'extra') && !Object.hasOwn(rewritten, 'legacy'),
			'canonical body writes deduplicate/whitelist weapons and drop every unknown row field');
		check(persisted.entries.some(row => row.room === 'OTHER7' && row.gid === 'gid-protected' && row.rt === otherProof), 'banking one room preserves the same gid/body namespace in other rooms');
		const other = makeGuest('c-other-room'); other.hello('gid-other-room'); await flush();
		check(other.last('welcome') !== null && other.last('taken') === null, 'a body from another room does not reserve this room gid');
		ghostHost.setViewerMode('gid-other-room', 'play'); await flush();
		const otherBody = ghostHost._debugBody('gid-other-room');
		check(otherBody && !otherBody.pouch.diamond && !otherBody.weapons.includes('spear'), 'another room body restores no cargo');
		await bye(other);
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
		check(g.inbox.findLastIndex(m => m.t === 'pvit') > g.inbox.findLastIndex(m => m.t === 'perm'),
			'fresh promotion sends authoritative vitals after the permission enters play mode');
	}

	// --- embodied actions always originate from the live body, including the gap
	//     between promotion and the first ppose and after a forged raw spectator pose
	{
		const g = makeGuest('c-origin');
		g.hello('gid-origin'); await flush();
		g.send({ t: 'pose', x: 900, y: -900, act: 1 }); await flush();
		ghostHost.setViewerMode('gid-origin', 'play'); await flush();
		const body = ghostHost._debugBody('gid-origin');
		g.send({ t: 'pose', x: 800, y: -800, act: 1 }); await flush();
		g.clear(); g.send({ t: 'ping' }); await flush();
		const ping = g.last('ping');
		check(body && ping && Math.abs(ping.x - body.x) < 0.01 && Math.abs(ping.y - body.y) < 0.01,
			'an embodied ping ignores stale and forged spectator camera coordinates');
		await bye(g);
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
		check(re.inbox.findLastIndex(m => m.t === 'pvit') > re.inbox.findLastIndex(m => m.t === 'perm'),
			'fresh-page reconnect sends preserved vitals after the embodied permission');
		const b2 = ghostHost._debugBody('gid-victim');
		check(b2 && Math.abs(b2.hp - 7) < 0.001, 'P0-7: the reconnect RESTORES the wounded HP (7), it does not heal to full');
		check(re.last('prespawn') === null, 'an already-clear reconnect keeps its exact pose without an unnecessary rebase');
	}

	// A disconnected body's old tunnel can become solid before its token-proven
	// reconnect. The host must preserve combat state but rebase the transform into
	// neutral-collision-clear space, otherwise every later sweep starts embedded.
	{
		const first = makeGuest('c-reembed-1');
		first.hello('gid-reembed'); await flush();
		const token = first.last('welcome') && first.last('welcome').rt;
		ghostHost.setViewerMode('gid-reembed', 'play'); await flush(); tickHost();
		const old = ghostHost._debugBody('gid-reembed');
		old.x = 20.5; old.y = 5; old.vx = 6; old.vy = -3; old.hp = 13;
		await bye(first);
		SOLID = (x, y) => x === 20 && y === 5; // terrain closes through the stored AABB
		const re = makeGuest('c-reembed-2');
		re.hello('gid-reembed', { rt: token }); await flush(); tickHost();
		const body = ghostHost._debugBody('gid-reembed');
		const rebase = re.last('prespawn');
		check(body && Math.abs(body.hp - 13) < 0.001, 'embedded reconnect preserves wounded HP and the existing body state');
		check(body && (Math.abs(body.x - 20.5) > 0.01 || Math.abs(body.y - 5) > 0.01), 'embedded reconnect relocates away from the newly solid old cell');
		check(body && body.vx === 0 && body.vy === 0, 'embedded reconnect clears only the invalid transform velocity');
		check(rebase && Math.abs(rebase.x - body.x) < 0.01 && Math.abs(rebase.y - body.y) < 0.01, 'embedded reconnect explicitly reconciles the guest to the clear host pose');
		const startX = body && body.x;
		if(body) await posePush(re, body.x + 1.5, body.y);
		check(body && body.x > startX + 0.1, 'relocated reconnect can move normally instead of remaining sweep-locked in rock');
		await bye(re);
		SOLID = () => false;
	}

	// Collision truth can also report no legal nearby AABB at all. That must fail
	// closed to the safe permission floor without consuming the stored combat state.
	{
		const first = makeGuest('c-reembed-fail-1');
		first.hello('gid-reembed-fail'); await flush();
		const token = first.last('welcome') && first.last('welcome').rt;
		ghostHost.setViewerMode('gid-reembed-fail', 'play'); await flush(); tickHost();
		const old = ghostHost._debugBody('gid-reembed-fail');
		old.x = 26.5; old.y = 6; old.hp = 19;
		await bye(first);
		SOLID = () => true;
		const blocked = makeGuest('c-reembed-fail-2');
		blocked.hello('gid-reembed-fail', { rt: token }); await flush(); tickHost();
		check(ghostHost._debugBody('gid-reembed-fail') === null, 'failed relocation never exposes an actionable embedded body');
		check(blocked.last('perm') && blocked.last('perm').mode === 'watch', 'failed relocation demotes a live reconnect to the safe watch floor');
		check(blocked.last('prespawn') === null, 'failed relocation emits no false clear-position reconciliation');
		await bye(blocked);
		SOLID = () => false;
		const retry = makeGuest('c-reembed-fail-3');
		retry.hello('gid-reembed-fail', { rt: token }); await flush(); tickHost();
		const restored = ghostHost._debugBody('gid-reembed-fail');
		check(restored && Math.abs(restored.hp - 19) < 0.001 && retry.last('perm') && retry.last('perm').mode === 'play', 'a later clear retry restores the unconsumed mode memory and combat state');
		await bye(retry);
	}

	// Environmental occupancy reads the current private host body map, not the
	// cadence-delayed creature plane. It sees an immediate move and a corpse, while
	// combat damage remains inert and disconnect removes the footprint immediately.
	{
		const g=makeGuest('c-footprint'); g.hello('gid-footprint'); await flush();
		ghostHost.setViewerMode('gid-footprint','play'); await flush(); await settle(); tickHost();
		const b=ghostHost._debugBody('gid-footprint');
		if(b){ b.x=30.5; b.y=6.5; b.dead=true; b.hp=4; b.respawnAt=Infinity; }
		check(authoritativeBodyBlocksCell(30,6), 'the current-session occupancy probe sees an immediate authoritative body move');
		await settle(); tickHost();
		const published=(MM.coopBodies||[]).find(x=>x && x.gid==='gid-footprint');
		check(published && published.dead && published.w===HERO_BODY_W && published.h===HERO_BODY_H, 'dead guest footprint remains published with authoritative dimensions');
		if(published) published.hurt(9,30,6,'mob');
		check(b && b.hp===4, 'a published dead footprint remains non-hurtable');
		await bye(g);
		check(!authoritativeBodyBlocksCell(30,6), 'disconnect removes the private occupancy footprint immediately');
	}

	// Respawn validates the host's exact pose before reviving. If every candidate is
	// embedded, the old corpse and vitals remain untouched and the next tick retries.
	{
		const oldHost={x:bridge.player.x,y:bridge.player.y};
		const g=makeGuest('c-respawn-safe'); g.hello('gid-respawn-safe'); await flush();
		ghostHost.setViewerMode('gid-respawn-safe','play'); await flush(); await settle(); tickHost();
		const b=ghostHost._debugBody('gid-respawn-safe');
		bridge.player.x=40.5; bridge.player.y=6.5;
		if(b){ b.x=24.5; b.y=7.5; b.vx=3; b.vy=-2; b.hp=0; b.dead=true; b.respawnAt=0; }
		g.clear(); SOLID=()=>true;
		await settle(); tickHost();
		check(b && b.dead && b.x===24.5 && b.y===7.5 && b.vx===3 && b.vy===-2, 'failed respawn keeps the old dead pose and retries later');
		check(g.last('prespawn')===null && g.last('pvit')===null, 'failed respawn emits no false reconciliation or revived vitals');
		check(authoritativeBodyBlocksCell(24,7), 'failed respawn keeps the corpse visible to occupancy consumers');
		g.clear(); SOLID=()=>false;
		await settle(); tickHost(); await flush();
		const prespawn=g.last('prespawn');
		check(b && !b.dead && b.hp===b.maxHp && b.x===bridge.player.x && b.y===bridge.player.y, 'clear retry revives at the host exact pose after validation');
		check(prespawn && prespawn.x===bridge.player.x && prespawn.y===bridge.player.y, 'successful respawn reconciles the exact validated host pose');
		await bye(g);
		bridge.player.x=oldHost.x; bridge.player.y=oldHost.y; SOLID=()=>false;
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

	// Hero intents fail closed before side effects, and durable placement is backed
	// by a host-owned conservation ledger rather than the guest's inventory claim.
	{
		const h = makeGuest('c-hero-intents'); h.hello('gid-hero-intents'); await flush();
		ghostHost.setViewerMode('gid-hero-intents', 'hero'); await flush(); tickHost();
		const body = ghostHost._debugBody('gid-hero-intents');
		body.x = 100.5; body.y = 5;

		heroDamageCalls = 0;
		body.dead = true; h.clear();
		h.send({ t: 'hact', a: 'dmg', x: body.x, y: body.y, n: 10 }); await flush();
		check(h.last('hact') && h.last('hact').reason === 'dead', 'a dead hero intent is explicitly rejected');
		check(heroDamageCalls === 0, 'a dead hero intent reaches no world-effect bridge');

		const oldHeroStatus = MM.heroStatus;
		body.dead = false; body.statusSt = { frozen: 1 };
		MM.heroStatus = { isFrozenState: () => true };
		h.clear(); h.send({ t: 'hact', a: 'dmg', x: body.x, y: body.y, n: 10 }); await flush();
		check(h.last('hact') && h.last('hact').reason === 'frozen', 'a frozen hero intent is explicitly rejected');
		check(heroDamageCalls === 0, 'a frozen hero intent reaches no world-effect bridge');
		body.statusSt = null; MM.heroStatus = oldHeroStatus;

		const oldAntennas = MM.antennas;
		MM.antennas = {
			ACTIVES: { cloak: {} },
			tierKey: () => 'common', durationFor: () => 2, cooldownFor: () => 20
		};
		h.clear(); h.send({ t: 'hact', a: 'antenna', k: '__proto__', tr: 'common' }); await flush();
		check(h.last('hact') && !h.last('hact').ok && h.last('hact').reason === 'kind', 'an inherited prototype name is not an antenna active');
		h.clear(); h.send({ t: 'hact', a: 'antenna', k: 'cloak', tr: 'common' }); await flush();
		check(h.last('hact') && h.last('hact').ok && h.last('hact').k === 'cloak', 'the peer survives a prototype-key antenna claim and can use a real active');
		MM.antennas = oldAntennas;

		body.pouch.diamond = 0; heroPlaceCalls = 0; heroMineCalls = 0; heroPlaceOk = true;
		h.clear(); h.send({ t: 'hact', a: 'place', x: 101, y: 5, tid: 77, l: 'fg' }); await flush();
		check(h.last('hact') && h.last('hact').reason === 'cost', 'a forged rare-tile placement is denied without host escrow');
		check(heroPlaceCalls === 0, 'an unfunded rare placement is rejected before the world-write bridge');

		heroMineResult = { ok: true, tid: 77, layer: 'fg' };
		h.clear(); h.send({ t: 'hact', a: 'mine', x: 101, y: 5 }); await flush();
		check(heroMineCalls === 1 && h.last('hact') && h.last('hact').ok, 'a successful hero mine reaches the host bridge');
		check(body.pouch.diamond === 1, 'the mined tile credits one host-derived rare resource to placement escrow');
		check(persistedBody('gid-hero-intents')?.pouch.diamond === 1, 'hero mining banks its escrow credit before the world-action acknowledgement');
		heroMineResult = { ok: false, reason: 'tile' };

		await new Promise(r => setTimeout(r, NET.HERO_RULES.PLACE_MS + 25));
		const refundBankTs = persistedBody('gid-hero-intents')?.ts || 0;
		heroPlaceOk = false; h.clear();
		h.send({ t: 'hact', a: 'place', x: 101, y: 5, tid: 77, l: 'fg' }); await flush();
		check(h.last('hact') && !h.last('hact').ok && body.pouch.diamond === 1, 'a failed placement bridge refunds its escrow debit');
		check(persistedBody('gid-hero-intents')?.pouch.diamond === 1 && persistedBody('gid-hero-intents')?.ts > refundBankTs,
			'a failed hero placement synchronously banks the final refunded escrow state');

		await new Promise(r => setTimeout(r, NET.HERO_RULES.PLACE_MS + 25));
		heroPlaceOk = true; h.clear();
		h.send({ t: 'hact', a: 'place', x: 101, y: 5, tid: 77, l: 'fg' }); await flush();
		check(h.last('hact') && h.last('hact').ok && body.pouch.diamond === 0, 'the mined rare resource funds exactly one durable placement');
		check((persistedBody('gid-hero-intents')?.pouch.diamond || 0) === 0, 'successful hero placement banks its escrow debit immediately');

		await new Promise(r => setTimeout(r, NET.HERO_RULES.PLACE_MS + 25));
		h.clear(); h.send({ t: 'hact', a: 'place', x: 102, y: 5, tid: 77, l: 'fg' }); await flush();
		check(h.last('hact') && h.last('hact').reason === 'cost' && heroPlaceCalls === 2, 'a second placement is denied without another earned unit');

		const copperBefore = body.pouch.copper || 0;
		heroPickupResult = { ok: true, kind: 'res', key: 'copper', qty: 2 };
		h.clear(); h.send({ t: 'hact', a: 'pickup', x: body.x, y: body.y }); await flush();
		check(body.pouch.copper === copperBefore + 2, 'a successful hero resource pickup credits placement escrow');
		check(persistedBody('gid-hero-intents')?.pouch.copper === copperBefore + 2, 'hero pickup escrow is durable before its acknowledgement');
		heroPickupResult = { ok: false, reason: 'none' };

		const ironBefore = body.pouch.iron || 0;
		heroUseResult = { ok: true, vend: 1, loot: [['iron', 3]] };
		h.clear(); h.send({ t: 'hact', a: 'use', x: 101, y: 5 }); await flush();
		check(body.pouch.iron === ironBefore + 3, 'successful vending loot credits placement escrow');
		check(persistedBody('gid-hero-intents')?.pouch.iron === ironBefore + 3, 'hero-use loot is synchronously banked into placement escrow');
		heroUseResult = { ok: false, reason: 'use' };

		const woodBefore = body.pouch.wood || 0;
		h.clear(); check(ghostHost.giftResource('gid-hero-intents', 'wood', 2), 'a host resource gift to a hero succeeds'); await flush();
		check(body.pouch.wood === woodBefore + 2 && h.last('gift') && h.last('gift').hero === 1, 'a hero gift credits both its normal acknowledgement and host placement escrow');

		TARGET_CLEAR = () => false;
		await new Promise(r => setTimeout(r, NET.HERO_RULES.MINE_MS + 25));
		const mineBeforeBlocked = heroMineCalls;
		h.clear(); h.send({ t:'hact', a:'mine', x:101, y:5 }); await flush();
		check(h.last('hact') && h.last('hact').reason === 'blocked' && heroMineCalls === mineBeforeBlocked,
			'a hero cannot mine a reachable coordinate through an occluding wall');
		await new Promise(r => setTimeout(r, NET.HERO_RULES.DMG_MS + 25));
		const damageBeforeBlocked = heroDamageCalls;
		h.send({ t:'hact', a:'dmg', x:101, y:5, n:10 }); await flush();
		check(heroDamageCalls === damageBeforeBlocked, 'coarse hero damage cannot strike a creature through an occluding wall');
		TARGET_CLEAR = () => true;
		await bye(h);
	}

	// A foreground placement may not materialize a solid inside a fellow guest. The
	// main bridge already protects the host hero and the acting body; only the host
	// session has authoritative positions for every other co-op body.
	{
		const builder = makeGuest('c-builder'); builder.hello('gid-builder'); await flush();
		const target = makeGuest('c-build-target'); target.hello('gid-build-target'); await flush();
		ghostHost.setViewerMode('gid-builder', 'play'); ghostHost.setViewerMode('gid-build-target', 'play');
		await flush(); tickHost();
		const builderBody = ghostHost._debugBody('gid-builder');
		const targetBody = ghostHost._debugBody('gid-build-target');
		builderBody.x = 50.5; builderBody.y = 5; builderBody.pouch.wood = 2;
		targetBody.x = 49; targetBody.y = 5;
		playPlaceCalls = 0; builder.clear();
		builder.send({ t: 'pact', a: 'place', x: 49, y: 5, key: 'wood' }); await flush();
		check(builder.last('pactAck') && builder.last('pactAck').reason === 'body', 'a guest cannot place a foreground solid inside another live co-op body');
		check(playPlaceCalls === 0, 'body-overlap placement is rejected before the world-mutation bridge');
		targetBody.x = 60;
		await new Promise(r => setTimeout(r, NET.PLAY_RULES.PLACE_MS + 20));
		builder.send({ t: 'pact', a: 'place', x: 49, y: 5, key: 'wood' }); await flush();
		check(playPlaceCalls === 1 && builder.last('pactAck') && builder.last('pactAck').ok, 'the same legal placement reaches the bridge once the other body is clear');
		check(persistedBody('gid-builder')?.pouch.wood === 1, 'play placement banks its pouch debit in the same synchronous action turn');

		playAttackOk = true; builder.clear();
		builder.send({ t: 'pact', a: 'attack', key: 'bow', x: 55, y: 5 }); await flush();
		check(builder.last('pactAck') && builder.last('pactAck').ok && builderBody.pouch.arrowWood === 39, 'a successful ranged attack spends one host-owned arrow');
		check(persistedBody('gid-builder')?.pouch.arrowWood === 39, 'successful ranged ammo spend is banked before its acknowledgement');
		await new Promise(r => setTimeout(r, NET.PLAY_WEAPONS.bow.cdMs + 25));
		const refundArrowTs = persistedBody('gid-builder')?.ts || 0;
		playAttackOk = false; builder.clear();
		builder.send({ t: 'pact', a: 'attack', key: 'bow', x: 55, y: 5 }); await flush();
		check(builder.last('pactAck') && !builder.last('pactAck').ok && builderBody.pouch.arrowWood === 39, 'a ranged attack that never spawns refunds its arrow');
		check(persistedBody('gid-builder')?.pouch.arrowWood === 39 && persistedBody('gid-builder')?.ts > refundArrowTs,
			'the refunded ranged-ammo state is synchronously rewritten, not left to the slow flush');
		playAttackOk = true;

		await new Promise(r => setTimeout(r, NET.PLAY_RULES.MINE_MS + 20));
		playMineCalls = 0; playMineResult = { ok: true, key: 'stone' }; builder.clear();
		builder.send({ t: 'pact', a: 'mine', x: 49, y: 5 }); await flush();
		check(playMineCalls === 1 && builder.last('pactAck') && builder.last('pactAck').ok && builderBody.pouch.stone === 1,
			'a completed play mine credits only the host-derived resource');
		check(persistedBody('gid-builder')?.pouch.stone === 1, 'play mining banks its credited resource before acknowledgement');
		playMineResult = { ok: false, reason: 'tile' };

		TARGET_CLEAR = () => false;
		await new Promise(r => setTimeout(r, NET.PLAY_RULES.PLACE_MS + 20));
		builder.clear(); builder.send({ t:'pact', a:'place', x:49, y:5, key:'wood' }); await flush();
		check(builder.last('pactAck') && builder.last('pactAck').reason === 'blocked' && playPlaceCalls === 1,
			'zero-trust play placement cannot write a reachable tile through an occluding wall');
		TARGET_CLEAR = () => true;
		targetBody.x = 49;
		ghostHost.setViewerMode('gid-builder', 'hero'); await flush();
		heroPlaceCalls = 0; builder.clear();
		builder.send({ t: 'hact', a: 'place', x: 49, y: 5, tid: 1, l: 'fg' }); await flush();
		check(builder.last('hact') && builder.last('hact').reason === 'body', 'hero-mode foreground placement also protects another live co-op body');
		check(heroPlaceCalls === 0, 'hero body-overlap placement is rejected before the world-mutation bridge');
		await bye(builder); await bye(target);
	}

	// --- P0-7: a mid-fight disconnect settles the partner's duel (centralized teardown)
	{
		const d1 = makeGuest('c-duel-1'); d1.hello('gid-d1'); await flush();
		const d2 = makeGuest('c-duel-2'); d2.hello('gid-d2'); await flush();
		ghostHost.setViewerMode('gid-d1', 'play');
		ghostHost.setViewerMode('gid-d2', 'play');
		await flush(); await settle(); tickHost();
		const publishedD1 = (MM.coopBodies || []).find(x => x && x.gid === 'gid-d1');
		const publishedD2 = (MM.coopBodies || []).find(x => x && x.gid === 'gid-d2');
		const ownNow = Object.getOwnPropertyDescriptor(performance, 'now');
		const frozenNow = performance.now();
		try{
			// Freeze the body publisher so these assertions can only pass through the
			// intent/teardown synchronization path, never a lucky 80 ms body tick.
			Object.defineProperty(performance, 'now', { configurable: true, value: () => frozenNow });
			d1.send({ t: 'pact', a: 'duel', gid: 'gid-d2' });
			await flush();
			d2.send({ t: 'pact', a: 'duel', gid: 'gid-d1' }); // mutual consent → the duel is on
			await flush();
			check(ghostHost._debugBody('gid-d1') && ghostHost._debugBody('gid-d1').duelWith === 'gid-d2', 'a mutual-consent duel starts');
			check(ghostHost._debugBody('gid-d2') && ghostHost._debugBody('gid-d2').duelWith === 'gid-d1', 'both sides are in the duel');
			check(publishedD1?.duelWith === 'gid-d2' && publishedD2?.duelWith === 'gid-d1', 'duel consent reaches the published combat bodies immediately');
			d1.send({ t: 'bye' }); await flush(); // one combatant disconnects mid-fight
			check(ghostHost._debugBody('gid-d1') === null, 'P0-7: the leaving duelist body is gone');
			const surv = ghostHost._debugBody('gid-d2');
			check(surv && surv.duelWith === null, "P0-7: the survivor's duel is settled — no dangling duelWith");
			check(publishedD1?.duelWith === null && publishedD2?.duelWith === null,
				'disconnect clears published duel consent immediately, without waiting for a body tick');
		}finally{
			if(ownNow) Object.defineProperty(performance, 'now', ownNow);
			else delete performance.now;
		}
		await bye(d2);
	}

	// --- P0-7: a hero→play demotion clamps the body into the play HP pool ---------------
	{
		const h = makeGuest('c-hero'); h.hello('gid-hero'); await flush();
		const guestRiders = new Set(['gid-hero']);
		MM.mechs = Object.assign({}, MM.mechs, { guestUnboard: gid => { guestRiders.delete(gid); return { id: 1 }; } });
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
		check(!guestRiders.has('gid-hero'), 'P0-7: hero-to-play demotion ejects the mech rider before disabling hero controls');
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

	// More than IDENTITY_MAX one-shot spectators must not consume permanent token
	// slots: disconnected watch-only gids carry no body or reconnect state.
	{
		const ownNow = Object.getOwnPropertyDescriptor(performance, 'now');
		let fakeNow = performance.now();
		try{
			Object.defineProperty(performance, 'now', { configurable: true, value: () => fakeNow });
			for(let i = 0; i < 260; i++){
				if(i % 40 === 0) fakeNow += 2001; // stay below the 48-peer accept-window cap
				const g = makeGuest('c-churn-' + i);
				g.hello('gid-churn-' + i);
				await flush();
				check(g.last('welcome') !== null && g.last('full') === null, 'stateless spectator churn remains admissible at gid ' + i);
				await bye(g);
				g.close();
			}
			fakeNow += 2001;
			const after = makeGuest('c-churn-after');
			after.hello('gid-churn-after'); await flush();
			check(after.last('welcome') !== null && after.last('full') === null, 'more than 256 disconnected stateless gids cannot exhaust the identity table');
			await bye(after);
			after.close();
		}finally{
			if(ownNow) Object.defineProperty(performance, 'now', ownNow);
			else delete performance.now;
		}
	}

	// Embodied disconnects legitimately retain a short reconnect window, but an
	// invite holder must not be able to accumulate unbounded windows/tokens by
	// cycling fresh identities through play mode.
	{
		const ownNow = Object.getOwnPropertyDescriptor(performance, 'now');
		let fakeNow = performance.now() + 2001;
		try{
			Object.defineProperty(performance, 'now', { configurable: true, value: () => fakeNow });
			for(let i = 0; i < 30; i++){
				fakeNow += 1;
				const g = makeGuest('c-window-' + i);
				g.hello('gid-window-' + i); await flush();
				check(g.last('welcome') !== null, 'embodied reconnect-window churn remains admissible at gid ' + i);
				ghostHost.setViewerMode('gid-window-' + i, 'play'); await flush();
				await bye(g); g.close();
			}
			const bounded = ghostHost.metrics();
			check(bounded.resumeWindows <= 24, 'embodied reconnect windows remain bounded to twice the live-seat cap');
			check(bounded.identityCache <= 24, 'evicted reconnect windows release their in-memory identity tokens');
			fakeNow += 2001;
			const after = makeGuest('c-window-after');
			after.hello('gid-window-after'); await flush();
			check(after.last('welcome') !== null && after.last('full') === null,
				'bounded embodied identity churn cannot exhaust admission for a later viewer');
			await bye(after); after.close();
		}finally{
			if(ownNow) Object.defineProperty(performance, 'now', ownNow);
			else delete performance.now;
		}
	}

	// Ending the host session takes the same teardown path as a dirty disconnect.
	{
		const unboarded = [];
		MM.mechs = Object.assign({}, MM.mechs, { guestUnboard: gid => { unboarded.push(gid); } });
		const a = makeGuest('c-stop-a'); a.hello('gid-stop-a'); await flush();
		const b = makeGuest('c-stop-b'); b.hello('gid-stop-b'); await flush();
		const stopToken = a.last('welcome') && a.last('welcome').rt;
		ghostHost.setViewerMode('gid-stop-a', 'play'); ghostHost.setViewerMode('gid-stop-b', 'play');
		await flush(); tickHost();
		a.send({ t: 'pact', a: 'duel', gid: 'gid-stop-b' }); await flush();
		b.send({ t: 'pact', a: 'duel', gid: 'gid-stop-a' }); await flush();
		const ba = ghostHost._debugBody('gid-stop-a'), bb = ghostHost._debugBody('gid-stop-b');
		if(ba) ba.pouch.diamond = 3;
		ghostHost.stop();
		check(ba && bb && ba.duelWith === null && bb.duelWith === null, 'host stop settles every live duel through dropPeer');
		check(unboarded.includes('gid-stop-a') && unboarded.includes('gid-stop-b'), 'host stop ejects every embodied mech rider');
		check(!ghostHost.active() && Array.isArray(MM.coopBodies) && MM.coopBodies.length === 0, 'host stop leaves no active session or phantom bodies');
		check(typeof MM.coopBodyBlocksCell !== 'function', 'host stop clears the private occupancy callback');

		ghostHost.start({ rtc: false }); await flush();
		check(ghostHost.metrics().room === ROOM, 'normal stop/start reuses the tab-scoped room needed for durable recovery');
		const restartWrong = makeGuest('c-restart-wrong'); restartWrong.hello('gid-stop-a', { rt: NET.mintResumeToken() }); await flush();
		check(restartWrong.last('taken') !== null && restartWrong.last('welcome') === null, 'a host restart still refuses the wrong durable body proof');
		const restartOwner = makeGuest('c-restart-owner'); restartOwner.hello('gid-stop-a', { rt: stopToken }); await flush();
		check(restartOwner.last('welcome') && restartOwner.last('welcome').rt === stopToken, 'the same-room owner is admitted after a host session restart');
		ghostHost.setViewerMode('gid-stop-a', 'play'); await flush();
		const restartedBody = ghostHost._debugBody('gid-stop-a');
		check(restartedBody && restartedBody.pouch.diamond === 3, 'the proof-bound body cargo survives a same-room host restart');
		ghostHost.stop();

		const OTHER_ROOM = 'OTHER7';
		ghostHost.start({ room: OTHER_ROOM, rtc: false }); await flush();
		const movedRoom = makeGuest('c-moved-room', OTHER_ROOM); movedRoom.hello('gid-stop-a', { rt: stopToken }); await flush();
		check(movedRoom.last('welcome') !== null && movedRoom.last('taken') === null, 'a different room admits the gid as a fresh room identity');
		ghostHost.setViewerMode('gid-stop-a', 'play'); await flush();
		const movedBody = ghostHost._debugBody('gid-stop-a');
		check(movedBody && !movedBody.pouch.diamond, 'a different room never inherits the prior room body');
		ghostHost.stop();
		const roomStore = JSON.parse(localStorage.getItem('mm_ghost_bodies_v1') || 'null');
		const stopRows = roomStore && Array.isArray(roomStore.entries) ? roomStore.entries.filter(row => row.gid === 'gid-stop-a') : [];
		check(stopRows.some(row => row.room === ROOM && row.pouch.diamond === 3) && stopRows.some(row => row.room === OTHER_ROOM && !row.pouch.diamond), 'the bounded host store retains independent rows for both rooms');
	}
}finally{
	for(const g of openGuests) g.close();
	try{ ghostHost.stop(); }catch(e){ /* fine */ }
}

if(failed){ console.error('ghost-hostile-sim: FAILURES ABOVE'); process.exit(1); }
console.log('ghost-hostile-sim: all assertions passed');
process.exit(0);
