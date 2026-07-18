# Multiplayer security handoff (P0 wave + authenticated remote RTC)

Audience: an independent agent picking this up for further hardening / audit.
Scope of this document: everything changed in the three commits below, why, where,
how it is enforced, how it is tested, and — importantly — the **weak spots and open
questions an auditor should scrutinise**. Nothing here should be taken as "proven
safe for the untrusted internet"; it is a defensible hardening pass with executable
tests, not a formal proof.

Base: `7dd19cd`. Changes land in three commits on `main`:

| commit | summary |
|---|---|
| `9c80949` | `.gitattributes` pins LF (a CRLF checkout was breaking source-shape test pins — pre-existing red `npm run check`) |
| `53d136c` | 7 P0 fixes (gid takeover, forged shots, hello auth, movement, teardown, transport/DoS, RTC-off-by-default) |
| `f2c65fc` | authenticated remote RTC: signed signaling handshake bound to an invite secret |

Touched source: `src/engine/ghost_net.js`, `src/engine/ghost_host.js`,
`src/engine/ghost_client.js`, `src/engine/weapons.js`.
New/updated tests: `tools/ghost-hostile-sim.test.mjs` (new),
`tools/coop-projectile-sim.test.mjs` (new), `tools/ghost-sim.test.mjs` (pins updated).
`package.json` wires the two new suites into `npm run check`.

Read `CLAUDE.md` → "Multiplayer architecture contract (Duchy Warstwy)" first; the
terms (listen server, permission ladder `watch<chat<full<play<hero`, stream planes,
`MM.coopBodies`, `ghost_net`/`ghost_host`/`ghost_client` split) are used throughout.

---

## How to run / verify

```
npm run lint            # eslint src, 0 warnings
npm run check:modules   # import/export graph
npm run test:ghost           # ghost_net pure + source pins
npm run test:ghost-hostile   # host driven over loopback + signed-channel end-to-end
npm run test:coop-projectile # forged coop projectile inertness (weapons)
npm run check           # everything (lint + ~130 suites + the above). Must be exit 0.
```

Node has **no `RTCPeerConnection`**, so the WebRTC object wiring cannot be exercised
headless. The **security decision layer** (signing/verification/replay/fingerprint) is
factored into pure functions (`createSignedChannel`, `signSignal`, `verifySignal`) and
tested directly end-to-end; the RTC plumbing around it is covered by source pins. This
is the same standard the rest of the RTC code is held to and is the main thing an
auditor should be aware of: **the socket wiring in `createRtcHost`/`createRtcJoin` is
not executed by any test — read it by hand.**

---

## New pure primitives (all in `ghost_net.js`, all in the `ghostNet` aggregate)

> Contract reminder (CLAUDE.md): every named export MUST also appear in the `ghostNet`
> aggregate object at the bottom of the file, or it is `undefined` at runtime while
> Node tests still pass. `tools/ghost-sim.test.mjs` cross-checks the two lists.

- `utf8Len(str)` / `withinWireLimit(str, n)` / `WIRE_LIMITS` — byte-measured size caps
  (JSON 256K, SDP 16K, ICE 2K, SIG 20K, MQTT 32K, ASSEMBLED 48M).
- `mintResumeToken()` / `validResumeTokenShape()` / `resumeTokenMatch()` /
  `RESUME_TOKEN_KEY='mm_ghost_rtok_v1'` — 128-bit gid-ownership token.
- `mintInviteSecret()` / `validInviteSecret()` — 128-bit remote-join capability.
- `signSignal()` / `verifySignal()` / `createReplayGuard()` / `createSignedChannel()` —
  HMAC-SHA256 signaling auth (Web Crypto `crypto.subtle`).
- `sdpFingerprint(x)` — DTLS fingerprint from an SDP string/`{type,sdp}`.
- `parseInviteSecret(str)` / `watchLink(base,room,via,secret)` / `parseWatch(search,hash)`
  — secret rides the URL **#fragment**.
- `sweepBodyMove(b, cx, cy, maxStep, solidAt, bounds)` / `clampStep()` — swept-AABB
  movement resolver.
- `createSendQueue()` / `DC_QUEUE` — bounded fail-closed DataChannel queue.
- `RTC_LIMITS` — `{PENDING_MAX:8, NEGOTIATE_MS:15000, HELLO_MS:20000}`.

`crypto` fallback: `randBytesHex` falls back to `Math.random` only when
`crypto.getRandomValues` is absent (never in a browser or Node ≥ 15). **Audit note:**
confirm no deployment path can hit the `Math.random` branch for token/secret minting.

---

## P0-1 — gid takeover via a public `gid`

**Was:** `hello.gid` was trusted. The gid is public (it rides the `ghosts` presence
relay, `pb` body rows, `duel`/`plook` packets). A second connection claiming a victim's
gid triggered the newest-wins eviction loop, and the `modeMemory` auto-regrant then
handed the attacker the victim's embodied rung + kept body (pouch, weapons).

**Now** (`ghost_host.js` `onPeerMessage`, hello branch ~L246–275):
- Session holds `s.tokens: Map<gid, token>`. On the **first** successful claim of a gid
  the host mints a 128-bit resume token and returns it privately in `welcome.rt`.
- A later hello claiming an already-known gid must present the matching token
  (`NET.resumeTokenMatch(pl.rt, known)`), checked **before** the eviction loop / any
  owner state is touched. Mismatch → `{t:'taken'}` + `dropPeer(silent)`.
- Client (`ghost_client.js`): stores the token in **tab-scoped `sessionStorage`**
  (`storeResumeToken`, key `RESUME_TOKEN_KEY`), echoes it on every hello/reconnect. Not
  on the localStorage lockdown allowlist on purpose (must not be shared across tabs).

**Test:** `ghost-hostile-sim.test.mjs` Part B — victim embodied, impostor with wrong
token refused (`taken`), owner keeps body, `metrics().players===1`; then the real owner
reconnects with the correct token and resumes (see P0-7).

**Audit here:**
- Tokens are **per host session** (`s.tokens` is reset on `start`). Cross-session, a gid
  re-appears with no token → mint fresh. That is fine for the seat, BUT the **kept body**
  (`BODY_KEEP_KEY='mm_ghost_bodies_v1'`, host localStorage, keyed by gid) persists across
  sessions and is restored in `spawnBody`→`restoreBodyFor`. It is only restored when the
  **host grants embodiment** — so a gid-guesser cannot pull someone's pouch without the
  host promoting them. Verify that reasoning holds and that there is no other read path.
- `modeMemory` stores the live body object across a disconnect and is never GC'd on
  expiry (bounded by gid churn; minor). Confirm no unbounded growth under churn.
- Token compare is length-checked + constant-ish (`resumeTokenMatch`); confirm it is not
  a meaningful timing oracle (token is random 128-bit, so low value even if it were).

---

## P0-2 — forged `hero` projectiles edit the world / hurt the host

**Was:** a hero guest's `shoot` intent passed flags to `spawnHeroProjectile`; a
`{fire:true, splat:'gascloud'}` shot dropped free poison gas and detonated it —
`explodeAt` removes terrain, spreads fire and calls `window.damageHero`.

**Now** — two layers, `weapons.js`:
1. Spawn resolver `spawnHeroProjectile` (~L3785): coop shafts drop `fire` entirely and
   whitelist `splat` to `'wet'` only (a soak: douses fire, wets mobs, no terrain / no
   host damage). Both coop arrow spawns set `coopOwner:true` (`spawnHeroProjectile`,
   `spawnCoopArrow`).
2. Behaviour gates on `!a.coopOwner` in the arrow sim:
   - fire-into-gas detonation + `igniteWorldGas` (L2527)
   - catching fire over lava/flame (L2547) — so a coop arrow can never *become* `a.fire`
   - `gascloud`/`bomb` splats in `splatProjectile` (world-hazard bursts)
   - (pre-existing gates, still relied on: chest open L2666, glass shatter L2675 —
     both `!a.coopOwner`; terrain `FIRE.ignite` L2686/L2715 gated by `a.fire`, which coop
     never has)

**Test:** `coop-projectile-sim.test.mjs` — reproduces the gas+fire shot with a
**positive control** (a hero, non-coop, fire arrow DOES detonate: terrain/host/FX react)
so the coop assertions genuinely discriminate a real explosion; plus lava-catch control.

**Audit here:**
- The whole fix rests on the invariant **"a `coopOwner` arrow never carries `a.fire` and
  only writes the world through gated paths."** Sweep `weapons.js` for any *other* place
  that (a) sets `a.fire=true` on an arrow, or (b) mutates tiles / ignites / spawns gas /
  calls `damageHero` from the arrow/puff update without a `!a.coopOwner` guard. The puff
  loop (`splatProjectile` and the steam/gas puff updates) and `pushThrownProjectile`
  deserve a second look.
- Longer-term (design intent, not done): the client should send a **canonical weapon id**
  and the host should look up damage/ammo/cooldown/allowed-props from a table, rather than
  clamping client-supplied numbers. Today the host clamps velocity/damage in
  `spawnHeroProjectile` but still trusts the *kind* flags (snowball/rock/thrown/harpoon).
  Verify those kinds have no world-write side effect for a coop arrow.

---

## P0-3 — no authenticated `hello` phase

**Was:** new connections started at `full`; `buff`/`power`/`pose` etc. were dispatched
before any `hello`; `GHOST_PROTO` was sent but not enforced.

**Now** (`ghost_host.js` `onPeerMessage`):
- Pre-hello gate (~L224): before a valid hello, only `hello`/`bye` are processed; anything
  else `return`s untouched.
- Protocol check (~L237): `pl.proto !== NET.GHOST_PROTO` → `{t:'incompatible'}` +
  `dropPeer`, before any viewer/snapshot/permission exists.
- Default mode is now **`watch`** (`defaultMode='watch'`), and the persisted `PERM_KEY`
  load is restricted to `DEFAULT_MODES` (`watch/chat/full`) so a corrupted `play`/`hero`
  value cannot become the default and auto-embody every joiner.
- Client handles the new `incompatible`/`taken` refusals.

**Test:** `ghost-hostile-sim.test.mjs` Part B — pre-hello buff yields no `buffAck` and no
heal; wrong-proto hello yields `incompatible`, no `welcome`, no snapshot chunks; a good
hello defaults to `watch` and carries a valid `rt`.

**Audit here:** confirm the pre-hello gate covers **every** inbound message type (it is a
single early-return keyed on `pl.t`), and that no handler runs side effects before the
`!entry.hello` check. The per-peer message-rate cap (`PEER_MSG_MAX`) runs *before* the
gate — good, but verify a pre-hello flood is bounded.

---

## P0-6 — host does not enforce movement / powers from raw camera

**Was:** the host only clamped a per-axis step to `MAX_SPEED`; no collision. A guest could
walk its tracked body through walls/bedrock, and `entry.cam` (the origin for powers/pings)
was set from the **raw** claim.

**Now** (`ghost_host.js` `ppose` handler ~L372–406):
- `NET.sweepBodyMove(...)` resolves the claim against host tiles via
  `bridge.solidAt(tx,ty,'y')` (out-of-world reads as solid → also caps at world bounds),
  `BODY_W/H = 0.62/0.92`, `bounds=null`.
- An embodied guest's `entry.cam` is set to the **accepted** body position, never the raw
  claim (`if(b) entry.cam = {x:b.x, y:b.y}`); a bodiless spectator keeps its free camera.

**Test:** `ghost-hostile-sim.test.mjs` — a wall-tunnel ppose is stopped before the wall;
a `ping` fires from the accepted position (not the raw `x:30` claim). Pure `sweepBodyMove`
adversarial cases in Part A.

**Audit here (highest-value review target):**
- `sweepBodyMove` uses **axis-separated sub-stepping** and **breaks on the first solid
  overlap**. If the body's *current* accepted position is already inside a solid (e.g. the
  host placed a block on it, or a very fresh dig the client hasn't seen), the resolver can
  get **stuck** (over-restrictive). This fails *safe* (blocks too much, only affects the
  host-side shadow / creature targeting, not the guest's own movement) but confirm there
  is no case where it becomes *under*-restrictive (lets a body into a solid).
- Body size is **assumed** `0.62×0.92`; the real hero AABB in `movement.js`/`constants`
  may differ. A mismatch could cause honest rubber-band near walls. For **play** mode this
  matters because the client reconciles against the `pb` echo (`ghost_client.js`
  `drainQueue`, `pb` branch, `poseLog` seq matching) — a host clamp the client disagrees
  with can snap the guest. Assess the honest-player UX and whether the AABB should come
  from the same source of truth.
- Confirm `bridge.solidAt` semantics: it currently returns `true` (solid) on exception /
  out-of-bounds. Verify that is the intended fail-closed for the sweep (it is what caps
  the world edge without a `bounds` object).

---

## P0-7 — disconnect/reconnect corrupts authoritative state

**Was:** `dropPeer` skipped duel settlement and mech unboard; a reconnect re-`spawnBody`'d
fresh (full HP, i-frames, cleared status, reset cooldowns); the last guest could leave a
phantom in `MM.coopBodies`; a `hero→play` demotion kept a >play HP pool.

**Now** (`ghost_host.js`):
- `dropPeer` (~L440): one centralized teardown — `endDuel(silent)`, `MECHS.guestUnboard`
  (no phantom rider stealing host keys — CLAUDE.md gotcha), `keepBody`, then stash the
  **same body object** in `modeMemory` (`{mode, ts, body}`). Immediately prunes
  `MM.coopBodies` to the remaining live bodies.
- Reconnect regrant (hello branch, ~L286): reattaches `kept.body` (HP/status/position/
  cooldowns preserved — timestamps are `performance.now()`, same page context), clears
  `duelWith`/`disp`/`mine`, rebuilds `bodyLike` next `bodyTick`. **Resumes, never heals.**
- `frame()` empty-session branch clears `MM.coopBodies=[]`.
- `setViewerMode` (~L1769): `hero→play` demotion clamps `maxHp`/`hp` to
  `PLAY_RULES.MAX_HP` (80).

**Test:** `ghost-hostile-sim.test.mjs` — wounded body (hp=7) survives a token-proven
reconnect at hp=7 (not full); mutual duel + one disconnect settles the survivor's
`duelWith`; hero body (maxHp 1000) demoted to play clamps to 80; last guest leaving →
`MM.coopBodies.length===0`.

**Audit here:**
- Cooldown preservation relies on `performance.now()` being **monotonic within the page**
  and the reconnect happening in the same page context (transport blip). A **full page
  reload** reconnect: sessionStorage keeps gid+token so the seat/body is reclaimed, but the
  body object lives only in the (gone) page's memory — actually the *host's* `modeMemory`
  holds it, and host `performance.now()` is continuous, so this is fine. Confirm.
- `hero` mode vitals are **guest-local truth** (owner ruling): the host body hp is
  display/targeting only, and a hero guest can claim any hp up to `HERO_RULES.HP_MAX`
  (1000) via `ppose`. This is by design; confirm it is acceptable for your threat model
  (a hero guest can make itself unkillable in ITS OWN client — it cannot touch the world
  or the host beyond the validated intents).

---

## P0-4 / P0-5 — transport DoS + authenticated remote RTC

### DoS caps (all `ghost_net.js`)
- Size caps in bytes (`utf8Len`): `openSignal` rejects oversized MQTT payloads pre-parse
  and oversized SDP/ICE post-parse (`validSignalSize`); `mqttOpen.publish` byte-caps;
  `rtcPeerWrap.send` refuses oversized frames and rides `createSendQueue` (bounded,
  fail-closes the channel on overflow via high/low-water `bufferedAmount`).
- `createAssembler` enforces a **UTF-8 byte ceiling** on the assembled snapshot
  (`cur.bytes += utf8Len(env.d)` vs `WIRE_LIMITS.ASSEMBLED_MAX`) in addition to the
  per-chunk cap.
- `createRtcHost`: pending-PC cap (`RTC_LIMITS.PENDING_MAX`), negotiation deadline
  (`negT`), mandatory hello deadline (`helloT`), fail-closed `drop(gid)` clears both
  timers.

### Authenticated remote RTC (the `f2c65fc` commit)
Model: **the invite secret is a bearer capability.** The host mints one per session
(`s.secret = NET.mintInviteSecret()`), it rides the shared link's **#fragment**
(`watchLink(...secret)` → `?watch=ROOM#k=<hex>`; fragments are not sent in HTTP requests
or `Referer`). A plain link (no secret) only connects same-machine (loopback).

- `createSignedChannel(secret, room, selfRole)` — `seal(obj, fpOverride)` stamps
  `{role, nonce(96-bit), ts, fp, sig}` where `sig = HMAC(secret, room|role|nonce|ts|fp|
  content)` and `content` = the SDP **text** (embeds the DTLS fingerprint) or the ICE JSON;
  `open(env, expectRole, fpPin)` verifies via `verifySignal`.
- `verifySignal` order (important, see below): shape → size → staleness (±60s) → role → fp
  → **HMAC compare → THEN replay guard**. Authentication precedes anti-replay so a forged
  message cannot consume a nonce slot.
- `createRtcHost` (secret required, else no-op): only a validly signed `hi` from a `g…`
  inbox opens a PeerConnection (this **is** the RTC DoS gate now — un-invited peers can't
  make us allocate). Seals every offer/ICE; pins the guest fingerprint from the answer;
  ICE must match the pinned fp.
- `createRtcJoin` (secret required, else no-op): signs `hi`/`answer`/`ICE`; verifies the
  host signed the offer, pins the host DTLS fingerprint, requires subsequent host ICE to
  match it.
- `hostListen` stands up RTC only with `rtc:true && validInviteSecret(secret)`;
  `joinRoom` attempts RTC only with `validInviteSecret(opts.secret)`. Host serves it by
  default (`rtc: opts.rtc !== false`); `rtc:false` forces loopback-only (used by tests).
- Client reads the secret from `location.hash` (`parseWatch(location.search,
  location.hash)`), passes it to `joinRoom`.
- CSP in `index.html` already allowlists the three MQTT brokers (`connect-src`); STUN/TURN
  are not CSP-gated. No `index.html` change was needed.

**Test:** `ghost-hostile-sim.test.mjs` Part A drives `createSignedChannel` end-to-end:
valid hi accepted; wrong secret / replay / wrong role / tampered SDP / mismatched
fingerprint refused; and a **forged signature does not burn a nonce** (proves auth
precedes the replay guard). Plus `hostListen` refuses RTC without a secret. Source pins
cover the RTC wiring.

**Audit here (remote is the least-tested surface — focus):**
- **Bearer-secret exposure.** The secret is in the URL fragment: it survives in browser
  history, clipboard managers, screen shares, and anyone the link is forwarded to becomes
  an invited guest (at the `watch` floor). Anyone with the link can join. Assess whether a
  per-guest secret / rotation / expiry is warranted, and whether the fragment is the right
  carrier for your users.
- **CPU cost of verification.** `verifySignal` runs one HMAC for any envelope that passes
  the cheap shape/size/stale/role/fp checks. A room-code-knowing attacker can send
  signed-*shaped* garbage (valid field types, wrong sig) and force an HMAC each. Bounded by
  the broker's own rate limits + the size cap, but it is a non-zero amplification. Consider
  a cheap pre-filter or a per-sender rate limit on the signaling inbox.
- **Replay-guard saturation by an INVITED peer.** The guard is bounded (`MAX=4096`) and
  fail-closed. A *malicious invited* peer (has the secret) can flood distinct valid nonces
  and saturate the guard, starving other guests on that channel. A non-invited peer cannot
  (auth precedes the guard). Decide whether invited-peer abuse needs per-sender guards.
- **The RTC object wiring is untested (no `RTCPeerConnection` in Node).** Read
  `createRtcHost`/`createRtcJoin` by hand: async `onMsg` ordering (an ICE verified before
  the offer's `setRemoteDescription` completes is caught by `.catch`), the `fp` pin flow
  for ICE, timer cleanup on every drop path, and that no unsigned message reaches
  `setRemoteDescription`/`addIceCandidate`/`createDataChannel`.
- **TURN relay.** `RTC_CONFIG` still uses the public `openrelay.metered.ca` TURN with
  hardcoded creds. Relayed media transits a third party (DTLS still end-to-end, but assess).
- **Fingerprint binding is defence-in-depth, not the root of trust.** The invite secret is
  the root; a secret-holder can produce any valid signature. Confirm this matches intent.

---

## Explicitly OUT of scope (untouched, per the task constraints)

Fog, full world replication, save-file privacy, and cosmetics were **not** changed. In
particular the host UI panel copy still advertises generic P2P/TURN and does not surface
the loopback-only-vs-remote-invite distinction — a UX follow-up, not a security bug. Trade
arbitration, gifting, and the duel handshake are unchanged from their prior design.

## Suggested next steps for the auditor

1. Manual read of `createRtcHost`/`createRtcJoin` (untested plumbing) + a browser
   end-to-end RTC smoke (two machines / two profiles) with a signed invite link.
2. `weapons.js` sweep for any coop-arrow world-write not gated on `!a.coopOwner`.
3. Decide on secret lifecycle (rotation/expiry/per-guest) and signaling-inbox rate limits.
4. Reconcile the movement AABB size with the real hero hitbox; add a play-mode
   reconciliation UX check near walls.
5. Consider promoting the hero-mode intent surface to canonical weapon/action ids (host
   table lookup) instead of clamped client-supplied numbers.
