# CLAUDE.md — project rules (read before touching code)

2D sandbox/mining game. **Pure ES modules, no build step, no framework.**
`src/main.js` (~17k lines) is the orchestrator; `src/engine/*.js` are ~100
self-registering modules hanging APIs off the global `MM` (`window.MM`).
Served statically (GitHub Pages: https://lkacz.github.io/code/, deployed from
the orphan `gh-pages` branch: `index.html` + `src/**` + `.nojekyll`).

## Verification (non-negotiable)

- `npm run check` = lint + ~130 Node suites. Must be exit 0 before a commit
  lands. Check exit codes directly (`cmd > log 2>&1; echo $?`) — never through
  a pipe. Known random flake: clouds-sim snowfall (rerun before investigating).
- **Tests regex-pin SOURCE shapes** (exact function names, message strings,
  CSS values). Changing a pinned shape REQUIRES updating the pin in the same
  commit — that is the contract mechanism of this repo, not an annoyance.
- Live QA drivers (`tools/*-qa.mjs`) run headless Edge over raw CDP with a
  throwaway profile and a **marker-scoped kill** — NEVER `taskkill msedge.exe`
  (kills the user's browser). Multiplayer QA: `node tools/ghost-qa.mjs`
  (pinned seed 777; `await host.front()` after every `Target.createTarget`,
  or the host tab's rAF sim freezes and scenes fail mysteriously).

## Multiplayer architecture contract ("Duchy Warstwy")

Topology: **listen server**. The HOST simulates the world and streams it;
guests join via `?watch=ROOM` links over BroadcastChannel (same machine) or
WebRTC (MQTT-WSS brokers for handshake only). Permission ladder per viewer,
host-granted, strictly inclusive: `watch < chat < full < play < hero`.
Up to `MAX_GHOSTS` (12) peers; every host structure is per-entry — the system
is N-player by construction.

Trust model (owner ruling): in `hero` mode the guest's PLAYER state
(inventory, gear, XP, vitals) is **guest-local truth**; the host protects only
the **WORLD** with solo-grade rules. `play` mode remains the zero-trust
option. Never trust client-sent parameters: clamp amounts, whitelist kinds,
and let the HOST own durations/strengths (the client may only *name* an
element or pick between the module's own power levels).

### The three questions for EVERY new feature

1. **Does it WRITE the world** (tiles, entities, drops)? It must flow through
   an existing chokepoint — `tryPlace`, `breakMinedTile`, `pushArrow`, the
   creature damage entries — or get a new `hact` intent + host seam. A direct
   `setTile` from a new module works for the host and silently breaks for
   guests.
2. **Is it a live world-simulated system** whose state changes between joins?
   It needs a stream plane: host tick in `ghost_host.js` `frame()` (cadence in
   `CAD`, sig-skip so silence costs nothing) + client apply in
   `ghost_client.js` `drainQueue()` + a guarded bridge seam. Existing planes:
   tiles, hero, mobs, invasions, guardians, weapon fx, drops, seasons, infra,
   water partials (`pwat`), vehicles (`mach`), bodies (`pb`).
3. **Does world-sim code read `window.player`** to affect the ACTING player?
   It must take a body-like parameter instead (`{x,y,w,h,vx,vy,hurt()}`) and
   consult `MM.coopBodies` (empty array in solo — zero cost). Boats got this
   right from day one; mechs needed a parallel guest layer — copy the boats
   pattern for new systems.

### Where things live

- `src/engine/ghost_net.js` — pure protocol: tables (`PLAY_RULES`,
  `HERO_RULES`, `HERO_ACTIONS`…), validators, chunking, MQTT codec.
  **Every named export MUST also be in the `ghostNet` aggregate object** —
  the engine imports the aggregate; a missing entry is `undefined` at runtime
  while Node tests still pass (pinned).
- `src/engine/ghost_host.js` — host side: `handleHeroAct` / `handlePlayAct`
  are the ONLY world-touching inlets (reach + per-action rate floors +
  envelope clamps), stream plane ticks, body lifecycle, `hurtBody` (single
  damage inlet; FORWARDS for hero bodies).
- `src/engine/ghost_client.js` — guest lifecycle: enter/exit for play & hero
  modes, `heroIntents` senders, ack handlers, storage lockdown (allowlist is
  pinned — a new persisted guest key must be added there AND to the pin).
- `src/main.js` — `MM.ghostBridge` seams (`ghostHero*`) re-validate world
  truth with the SAME predicates solo uses; `runHeroStep` is the hero-only
  frame (world systems must NEVER be added to it — the stream is the world).
- Mech driving inverts movement authority: while `m.guestGid` is set the cab
  is the authority and pose claims are ignored. `guestGid` is transient —
  **never serialize it** (a phantom rider after reload would steal the host's
  keys).
- `src/engine/challenge.js` — challenge seeds (`?seed=<n>&mods=<csv>`): pure
  parser + whitelisted mod table. World mods patch `WG.settings` IN MEMORY
  only (never persisted); the curse sticks to the run (`mm_challenge_v1`) with
  a one-shot sessionStorage handoff across new-game reloads. Guests adopt the
  host's mods from the welcome packet, re-whitelisted on receipt. Worldgen
  boot seed priority: queued new-game choice > challenge link > `#seedInput`.
- `src/engine/party_hud.js` — co-op roster + edge arrows; consumes role-aware
  read-only `partyMembers()` feeds (ghost_host / ghost_client). The `story`
  plane is broadcast-only display truth (save shapes on the wire); the finale
  relay is OPEN-only — `unlock()` (layer credit) is never a guest's to mint.
- World fork: the storage lockdown has EXACTLY ONE escape hatch —
  `MM.ghostForkWrite` (the ORIGINAL `setItem`; keys `mm_save_v7`,
  `mm_challenge_v1`, the slot index + the fork-scoped `mm_slot_fork_` prefix
  for the pre-fork backup), armed solely by the `forkGrant` dispatcher branch
  and consumed by main.js's audited `commitForkSave`. Extending the fork
  means extending the hatch's key whitelist + pins — NEVER the lockdown
  allowlist. An existing solo save is auto-backed-up as a named slot before
  the overwrite; a fork can never touch the player's own named saves.
- Guest trader: NO trade arbitration exists by design — buy/sell exchange
  within ONE inventory and a hero guest's inventory is its own truth; the
  `npcs` plane (registry save shapes, sig-skipped) keeps stall state fresh
  and the epic-chest offer (the one world-touching trade) refuses guests.
  Party pressure: mob eco-pass/despawn + invasion landings rotate across
  host + `MM.coopBodies` (set-piece events stay host-anchored by design).

### Adding a new hact intent (checklist)

1. `ghost_net.js`: add to `HERO_ACTIONS` + a rate constant in `HERO_RULES`.
2. `ghost_host.js`: branch in `handleHeroAct` with `lastHero*At` rate floor,
   reach check where meaningful, clamps on every number, whitelist on every
   string.
3. `src/main.js`: a `ghostHero*` bridge seam using solo predicates.
4. `ghost_client.js`: sender in `heroIntents` + ack handling + `_hero*` QA
   seam.
5. `tools/ghost-sim.test.mjs`: update the `HERO_ACTIONS` deepEqual pin + pin
   the new shapes (the architecture-invariants block cross-checks every
   action has a host branch).
6. `tools/ghost-qa.mjs`: a live scene (or extend 10q/10r).

### Multiplayer gotchas (paid for in debugging hours)

- The wfx plane REPLACES the guest's arrows array wholesale — never run real
  weapon impact chains on a guest (`runHeroStep` uses `ghostStepFx`).
- `applyGameData` on a guest loads the HOST's inventory — hero mode must
  capture/restore the guest state around every resync, and `ghostHeroFresh`
  must wipe host riches on first embodiment (duplication guard).
- Death: the grave is a WORLD mechanic; hero guests skip it entirely (a
  replica-local grave would be stream-wiped and the halved resources lost).
- Pose movement budget accrues from REAL elapsed time only (no per-message dt
  floor) and body velocity derives from accepted movement (a claimed velocity
  spoofs predictive aim).
- Panel/UI handlers that programmatically focus an input must blur it —
  `updateUi`'s mid-edit guard otherwise freezes the panel body forever.
- Guest-visible strings render via `textContent`/canvas only; the single
  `innerHTML` sink is the veil with `esc()`.

## Design history

The full wave-by-wave log with rationale lives in the user's memory files
(`multiplayer-embodied-play`, `ghost-spectator-mode`) and in
`MULTIPLAYER_HANDOFF.md`. Git history commit messages narrate each wave.
