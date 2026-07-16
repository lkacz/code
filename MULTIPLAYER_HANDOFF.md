# Handoff prompt — drive "Duchy Warstwy" co-op from v1 to 100% multiplayer

You are a coding agent continuing a feature in an existing browser game. A first
working slice of **embodied multiplayer** ("play mode") already ships on top of the
spectator system. Your mission is to take it the rest of the way to a full co-op
experience **without ever weakening the security model that makes it safe.**

Read this whole document before touching code. Then read the two memory files it
points to. Then verify the baseline is green. Only then start.

---

## 0. The project (cold-start facts)

- A 2D sandbox/mining game. **Pure ES modules, no build step.** `src/main.js` is a
  ~16k-line orchestrator; `src/engine/*.js` are ~100 self-registering modules that
  hang APIs off the global `MM` object (`window.MM`).
- Platform: **Windows**. Shells available: **PowerShell** (primary) and a **Bash**
  tool (Git Bash / POSIX). Use forward slashes and Unix syntax in the Bash tool.
- No framework, no bundler. Files are served statically; a headless-Edge CDP driver
  is the integration-test harness.
- The multiplayer feature is called **"Duchy Warstwy"** (Layers/Ghosts). Host = the
  player who owns the world. Guest/watcher = someone who joined via a `?watch=ROOM`
  link. Transport is peer-to-peer (WebRTC DataChannel; MQTT-over-WSS only for the
  handshake) — GitHub Pages stays a static host, there is no server of ours.

**Two memory files hold the authoritative design history — read both first:**
- `~/.claude/projects/f---DEV-code/memory/ghost-spectator-mode.md` — the spectator
  system (10 waves): transport, world replication, spectator powers, progression,
  guardian-fight mirror, the 2026-07-16 hardening audit.
- `~/.claude/projects/f---DEV-code/memory/multiplayer-embodied-play.md` — the play
  wave you are extending. **This is your primary spec.**

---

## 1. The four files you will live in

| File | Role |
|---|---|
| `src/engine/ghost_net.js` | **Pure protocol core** — importable/testable under Node with no DOM. Room codes, chunking, the permission ladder, and all the `PLAY_*` rules + pure helpers live here. Add pure logic HERE and unit-test it. |
| `src/engine/ghost_host.js` | **Host authority.** The body registry (`entry.body`), intent validation (`handlePlayAct`), vitals/pouch/damage/respawn, the `pb` body plane, `MM.coopBodies` publish, body rendering. |
| `src/engine/ghost_client.js` | **Guest.** The local `player` flips from "replica of host hero" to "the guest's own body." Local hero physics (`stepOwnHero`/`collideAxis`), input mapping, intents (`sendPlayAct`), pouch UI. |
| `src/main.js` | **The bridge** (`MM.ghostBridge`) — the ONLY sanctioned window into game internals. Every world-touching seam (`ghostPlayMineAt`/`ghostPlayPlaceAt`/`ghostPlayStrike`, `solidAt`, `screenToWorld`, `drawHeroAt`) lives here and re-validates world truth. |

Plus `src/engine/mobs.js` (`coopContactPass`), `tools/ghost-sim.test.mjs` (pins), and
`tools/ghost-qa.mjs` (live CDP QA, scene 10i).

> **Gotcha that has bitten before:** `ghost_net.js` exports named functions AND an
> aggregate `export const ghostNet = api`. The engine imports `{ ghostNet as NET }`,
> **not** the namespace. A new `export function` you forget to add to `api` is
> `undefined` at runtime while every Node test still passes. `ghost-sim` pins the two
> lists against each other — keep them in lockstep.

---

## 2. The trust model — THIS IS THE PART YOU MUST NOT BREAK

The entire reason co-op is safe is a strict **authority split**. Every change you
make must preserve it. If a change would let a modified guest client cause an effect
the host did not validate, the change is wrong.

- **Guest-authoritative:** *only* the guest's own hero movement (so it feels instant).
  The host follows the streamed pose inside a per-axis speed envelope
  (`clampBodyStep`, `PLAY_RULES.MAX_SPEED`) — a teleport hack rubber-bands.
- **Host-authoritative:** vitals, the resource pouch, and **every world edit.**
- The guest never edits the world. It sends **intents** (`mine`/`place`/`strike`);
  the host re-checks reach, rate, pouch, and world truth (`ghostPlay*` bridge seams)
  before a single tile changes.
- **`strike` touches creatures only — never a tile.** There is a pinned test:
  `!/ghostPlayStrike[\s\S]{0,400}setTile\(/`. Keep it true.
- **Mining/placing use the foreground-tile whitelist only** (`companionHarvestAssignableTile`):
  no machines, chests, story tiles, overlays, or backgrounds.
- **`play` is never a default door policy.** `DEFAULT_MODES` excludes it; embodiment
  is granted per-viewer by hand. Do not add an auto-promote path.
- **The permission ladder is inclusive** (`modeAllows(mode, need)`, `play ⊇ full ⊇
  chat ⊇ watch`). Never re-introduce `mode === 'full'` string comparisons.
- **`MM.coopBodies` is a zero-cost hook:** it must be an empty array (not undefined)
  in solo play and the Node sims, and every consumer must early-return on empty. This
  is how creature/targeting code stays free when nobody is embodied.
- **Progression is a reward, never an authority** (inherited from the spectator
  system): no host-side gate may read a guest's level/achievements.

When in doubt, add a host-side validation and a test pin. Over-validate.

---

## 3. What already works (v1 — shipping, QA-green)

- The ladder gained a `play` rung. `setViewerMode(gid,'play')` spawns a host-owned
  body; any downgrade removes it. Spectating is unchanged and remains the default.
- Guest moves with its own local physics (shared `applyHorizontalMovement` +
  `bridge.solidAt` swept resolver); host tracks the pose in an envelope.
- Guest **mines** foreground tiles → yield goes to the **guest's host-owned pouch**,
  never the host inventory. Guest **builds** from that pouch. Guest **strikes**
  creatures (mobs + invaders), never tiles.
- Vitals/pouch are host state, streamed to the guest as display truth (`pvit`).
  Damage (`pdmg`), death, and respawn (`prespawn`) are host-decided.
- Hostile creatures that **touch** a guest body hurt it (`mobs.coopContactPass` →
  `MM.coopBodies` → `body.hurt()`).
- Everyone (players and spectators) sees every embodied player as a real hero body
  (`drawHeroAt` field-swaps into the real `drawPlayer`).
- Verified by `tools/ghost-qa.mjs` scene 10i (promote → move → mine → build → fight →
  demote) and pinned in `tools/ghost-sim.test.mjs`. Full `npm run check` passes.

---

## 4. What "100%" means — the gap list, ordered into waves

Ship one wave at a time. Each wave = source change + `ghost-sim` pins + one new
`ghost-qa.mjs` scene + `npm run check` green. Do not batch waves.

### Wave A — Creatures fight the whole party (deepest, highest value; do first)
Today creatures still **hunt the host only**; a guest body merely takes contact
damage. Make mobs/invaders/guardians/companions/turrets target **the nearest of all
heroes** (host + every live `MM.coopBodies` entry).
- The obstacle is the singleton `player` threaded through `mobs.update(dt, player,
  ...)`, guardian leash checks, invasion targeting, turret targeting. Precedent that
  it's tractable: companions, mechs, and boat deck-standing are already actor-like
  entities that collide/aggro without being "The Player."
- Approach: introduce a `heroTargets()` helper (host = `player` + coop bodies; solo =
  just `player`) and route aggro/pathing/attack selection through it. Keep the
  zero-cost solo path (no bodies → the old single-target code path).
- Damage a mob deals to a guest body must still go through `body.hurt()` (host owns
  the i-frames and the vitals stream). Ranged mob attacks/projectiles that currently
  aim at `player` must be able to aim at a body.
- Contract: a guest must be a first-class threat/target, but the guest still never
  runs the sim — the host resolves all of it and streams results.

### Wave B — Guest combat & tool parity
The `strike` stub (`PLAY_RULES.STRIKE_DMG`) is a placeholder. Give the guest the real
combat surface:
- Guest wields actual tools/weapons (`weapons.js`): pickaxe mining speed, melee
  blades, bow/arrows, the elemental matrix. Resolve on the host; stream the cosmetic
  FX to everyone (the host already has `weapons.ghostFxState/ghostApplyFx/
  ghostStepFx` — generalize it to be per-body, not just the host hero).
- Guest tool/weapon selection (a minimal hotbar for the guest).

### Wave C — Guest crafting, inventory & gear
- Let the guest craft from its **own** pouch and equip its **own** gear. Reuse the
  assistant workbench pattern (`ghostAssistState` streams the recipe catalogue) but
  bound to the guest's pouch/inventory, not the host's.
- Decide and implement **persistence**: does a guest's pouch/gear survive a session,
  a reload, a re-invite? (Likely a per-`gid` sub-save in the host's world, or
  explicitly ephemeral. Whatever you choose, document it and pin it.)

### Wave D — Guest survival systems (host-owned, per guest)
Energy, hunger/survival (`survival.js`), temperature (`temperature-axis`), drowning,
fall damage, status effects (`hero_status.js`) — all currently assume the single host
hero. Make them run per guest body on the host, streamed via `pvit`. Death →
gravestone + respawn (`respawn_travel.js`) per guest.

### Wave E — Fidelity & polish
- **Water sub-tile partials** are not replicated (pinned not-a-bug for spectators),
  so a swimming guest visibly diverges. Add windowed partial replication around each
  guest body, or make the host arbitrate swim state.
- **Position reconciliation:** replace the gross-drift rubber-band (>6–8 tiles) with
  smooth server-reconciled correction, or offer a host-authoritative-movement mode
  for high-latency links.
- **Per-body cosmetics:** today `drawHeroAt` bleeds the host's tool/cape/customization
  onto every remote body. Stream per-guest customization so heroes aren't clones.
- **Fellow-player interactions:** decide PvP (can guests hurt each other?), trading,
  and whether guests see each other's pouches. Design choices — get a ruling, then
  implement + pin.
- **Fog:** per-guest fog vs shared fog is a co-op design choice.

### Wave F — Infra reliability
- **NAT/TURN:** STUN-only means some NAT pairs never connect. Spectators fail soft;
  players expect more. Add a clear "couldn't connect" UX and evaluate a free/cheap
  TURN option or a documented limitation.
- **Host tab is the server:** backgrounding it freezes the guest's world. Surface
  this in the UI (it's currently silent). Host-migration is likely out of scope, but
  a keep-alive/"host went idle" notice is not.

---

## 5. How to work in this repo (do this, in this order)

1. **Read the two memory files.** They encode gotchas that cost hours. Do not
   rediscover them.
2. **Establish the baseline before editing:**
   ```bash
   npm run lint
   npm run test:ghost
   npm run check:modules
   ```
   All three must be clean. If not, stop and fix the baseline first.
3. **Design pure logic into `ghost_net.js`** (rules, envelopes, validators) and
   unit-test it in `ghost-sim.test.mjs` — it runs in milliseconds with no browser.
4. **Wire the host authority, then the client**, then the bridge seam. The host
   validates; the client only points; the bridge re-checks world truth.
5. **Pin every contract you rely on** in `ghost-sim.test.mjs` (both pure-core asserts
   and source-regex pins on the wiring). When you change a gate's shape, update the
   pin in the same commit — several pins match exact source substrings.
6. **Add one live QA scene** to `ghost-qa.mjs` proving the wave end-to-end, then run
   the whole driver.
7. **Run `npm run check`** (the full ~140-suite chain) before declaring done. Your
   changes to `mobs.js`/`main.js` can ripple into unrelated suites.

---

## 6. Verification commands

```bash
npm run lint            # eslint, zero warnings
npm run check:modules   # import/export mismatch guard (catches the NET aggregate trap)
npm run test:ghost      # pure core + source pins (fast)
node tools/ghost-qa.mjs # live headless-Edge CDP, 2–3 tabs, all scenes incl. 10i (play)
npm run check           # the whole suite chain — must exit 0
```

---

## 7. Repo-specific pitfalls (these are real, they have all happened)

- **CDP QA, backgrounded tabs:** in a 2-tab CDP run, the background tab's `rAF` is
  frozen — its whole sim/interpolation stops; only the companion pump keeps the
  network alive at ~1 Hz. Any scene that needs the host world *running* must
  `Page.bringToFront` the host first (`Tab.front()` in the driver). Sample from the
  **driver** side (real time), not with in-page `sleep` (throttled to ~1 Hz).
- **Two reads <1.5 s apart on a backgrounded tab hit the same pump tick** and look
  "frozen" even when the mirror works. Space samples past one pump cycle.
- **The deed-queue persistence race (also a real product bug, now fixed):** a
  backgrounded guest drains its deed queue at ~1 Hz, so deeds can sit *unbanked in the
  queue* (not merely unflushed) when the tab closes/reloads. The fix pattern:
  foreground → drain → flush. Reuse `MM.ghostClient._flushForTest()` in QA.
- **Mining QA needs air above the target cell** — a random spawn has sand/gravel
  overhead that falls into the hole and masks the break.
- **Negative-coordinate interpolation in evals:** `p.x-${-39.5}` → `p.x--39.5` is a
  SyntaxError. Always wrap: `(${v})`.
- **Dread/aim scenes must `setFollow(false)` first** — a following camera drags the
  spirit back and shrinks the measured distance.
- **World start is nondeterministic** across QA runs (the hero spawns at different
  `x` each run). Do not hardcode coordinates; read them fresh from the running world.
- **`getComputedStyle(el).display` of a child inside a `display:none` container still
  returns the child's own display.** Use `el.getClientRects().length` for "is it
  actually visible."

---

## 8. Definition of done for the whole feature

Full multiplayer is 100% when: two people on different machines can join one world;
each has a hero with real movement, tools, combat, crafting, inventory, and survival;
creatures treat every hero as a target; the world stays coherent across reconnects;
and **no validated-by-nobody effect is ever possible from a modified guest client** —
with the spectator ("ghost") experience still available as the lower rung of the same
ladder. Every wave above is pinned in `ghost-sim` and exercised live in `ghost-qa`,
and `npm run check` is green.

Start with **Wave A**. It retires the biggest architectural risk (the singleton
`player`) first, and it's what makes an embodied guest feel like a real participant
rather than a tourist the monsters ignore.
