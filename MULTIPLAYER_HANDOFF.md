# Handoff prompt — drive "Duchy Warstwy" co-op from ~60% to 100% multiplayer

You are a coding agent continuing a multiplayer feature in an existing browser game.
A working embodied co-op experience already ships: two people on different machines
share one world, both drive real heroes, and monsters fight the whole party. Your
mission is to close the remaining gaps to a full co-op experience **without ever
weakening the security model that makes it safe.**

Read this whole document before touching code. Then read the two memory files it
points to. Then verify the baseline is green. Only then start.

---

## 0. The project (cold-start facts)

- A 2D sandbox/mining game. **Pure ES modules, no build step.** `src/main.js` is a
  ~16k-line orchestrator; `src/engine/*.js` are ~100 self-registering modules that
  hang APIs off the global `MM` object (`window.MM`).
- Platform: **Windows**. Shells: **PowerShell** (primary) and a **Bash** tool
  (Git Bash / POSIX). Use forward slashes and Unix syntax in the Bash tool.
- No framework, no bundler. Files are served statically; a headless-Edge CDP driver
  (`tools/ghost-qa.mjs`) is the integration-test harness.
- The multiplayer feature is called **"Duchy Warstwy"**. Host = the player who owns
  the world. Guest = someone who joined via a `?watch=ROOM` link. Transport is
  peer-to-peer (WebRTC DataChannel; public MQTT-over-WSS brokers for the handshake
  only) — GitHub Pages stays a static host, there is no server of ours.

**Two memory files hold the authoritative design history — read both first:**
- `~/.claude/projects/f---DEV-code/memory/ghost-spectator-mode.md` — the spectator
  system (10 waves): transport, world replication, spectator powers, progression,
  guardian-fight mirror, hardening audits.
- `~/.claude/projects/f---DEV-code/memory/multiplayer-embodied-play.md` — the
  embodiment wave + Wave A. **This is your primary spec.**

**Shipped commits (all check-chain green, all QA green):**
- `1051329` — guardian-fight mirror + ghost audit hardening
- `a55cf79` — embodied multiplayer v1 (the `play` rung: move/mine/build/fight)
- `7d0941e` — Wave A: creatures hunt the whole party

---

## 1. The files you will live in

| File | Role |
|---|---|
| `src/engine/ghost_net.js` | **Pure protocol core** — importable/testable under Node with no DOM. The permission ladder, `PLAY_RULES`, and all pure helpers (`modeAllows`, `playReachOk`, `clampBodyStep`, `pouchAdd/pouchTake`). Add pure logic HERE and unit-test it. |
| `src/engine/ghost_host.js` | **Host authority.** Body registry (`entry.body`), intent validation (`handlePlayAct`), vitals/pouch/damage/respawn (`hurtBody`/`sendVitals`), the `pb` body plane (`bodyTick`), `MM.coopBodies` publish, body rendering. |
| `src/engine/ghost_client.js` | **Guest.** The local `player` flips from "replica of host hero" to "the guest's own body" (`enterPlay`/`exitPlay`). Local physics (`stepOwnHero`/`collideAxis`), input mapping, intents (`sendPlayAct`), pouch UI. QA seams: `_playAct`, `_playSelect`, `_playStop`, `_flushForTest`, `_idleForTest`, `_debugConnLost`. |
| `src/main.js` | **The bridge** (`MM.ghostBridge`) — the ONLY sanctioned window into game internals. World-touching seams (`ghostPlayMineAt`/`ghostPlayPlaceAt`/`ghostPlayStrike`), plus `solidAt`, `screenToWorld`, `drawHeroAt`. Every seam re-validates world truth. |
| `src/engine/mobs.js` | `coopContactPass`, `nearestCoopBody`, the extended `combatTargetForMob`, and the `_mobTargetBody` damage chokepoint (Wave A). |
| `tools/ghost-sim.test.mjs` | Pure-core asserts + source-regex pins on every contract. |
| `tools/ghost-qa.mjs` | Live CDP QA, 2–3 Edge tabs. Scene 10i covers the whole play loop incl. the Wave A hunt. |

> **Trap that has wedged the page before:** `ghost_net.js` exports named functions
> AND an aggregate `export const ghostNet = api`. The engine imports
> `{ ghostNet as NET }`, **not** the namespace. A new `export function` you forget to
> add to `api` is `undefined` at runtime while every Node test still passes.
> `ghost-sim` pins the two lists against each other — keep them in lockstep.

---

## 2. The trust model — THIS IS THE PART YOU MUST NOT BREAK

Co-op is safe because of a strict **authority split**. If a change would let a
modified guest client cause an effect the host did not validate, the change is wrong.

- **Guest-authoritative:** *only* the guest's own hero movement (instant feel). The
  host follows the streamed pose inside a per-axis speed envelope (`clampBodyStep`,
  `PLAY_RULES.MAX_SPEED`) — teleport hacks rubber-band.
- **Host-authoritative:** vitals, the pouch, and **every world edit.**
- The guest never edits the world. It sends **intents**; the host re-checks reach,
  rate, pouch, and world truth (`ghostPlay*` bridge seams) before a tile changes.
- **`strike` touches creatures only — never a tile.** Pinned:
  `!/ghostPlayStrike[\s\S]{0,400}setTile\(/`. Keep it true for every future weapon.
- **Mining/placing use the foreground-tile whitelist** (`companionHarvestAssignableTile`):
  no machines, chests, story tiles, overlays, backgrounds.
- **`play` is never a default door policy.** `DEFAULT_MODES` excludes it; embodiment
  is granted per-viewer by hand. Do not add an auto-promote path.
- **The ladder is inclusive** (`modeAllows(mode, need)`, `play ⊇ full ⊇ chat ⊇
  watch`). Never re-introduce `mode === 'full'` string comparisons.
- **`MM.coopBodies` is a zero-cost hook:** empty array in solo play and the Node
  sims; every consumer early-returns on empty. This is how all party-aware code
  stays free when nobody is embodied. Guest damage ALWAYS lands through
  `body.hurt()` — the host owns i-frames and the vitals stream.
- **Progression is a reward, never an authority:** no host-side gate may read a
  guest's level/achievements.

When in doubt, add a host-side validation and a test pin. Over-validate.

---

## 3. What already works (verified live)

- **Spectator system** (the ghost ladder below `play`): untouched, the default door.
  Full renderer, buffs, powers, chat/pings, assistants, viewer progression, live
  mirrors for mobs/invasions/weapons/guardian fights.
- **Embodiment:** `setViewerMode(gid,'play')` spawns a host-owned body; any
  downgrade removes it. Guest walks/jumps/swims with local physics; host tracks the
  pose in an envelope (QA: tracked to within 0.00 tiles).
- **Economy:** guest mines foreground tiles → yield goes to the guest's host-owned
  pouch (host inventory untouched — QA-pinned); builds from that pouch; melee
  `strike` hits mobs + invaders.
- **Party combat (Wave A):** mobs aggro/pursue/attack the NEAREST hero (host, guest
  bodies, companions — the old companion bias is preserved byte-for-byte). Damage
  routes through the single `damagePlayer` chokepoint to whoever the mob is hunting
  (`_mobTargetBody`), so a mob chasing a guest can never hurt the distant host.
  Projectiles catch on guest bodies too. QA: a GIANT_SCORPION drained the guest
  80→49 hp while the host 60 tiles away stayed at 100.
- **Party targeting everywhere (Wave A2):** guardians aim boss/sidekick attacks at
  the nearest party member and every hazard type (lightning, meteors, projectiles,
  impacts, beams, rings, blizzards) plus boss contact hit-tests guest bodies through
  `body.hurt()`; invader melee + hitscan chase the nearest party member (squad brains
  march on the party member nearest the squad's center); player-built turrets stay
  awake, scan and fire for a guest with the host beyond `ACTIVE_RX`. Each system has
  a local zero-cost `MM.coopBodies` reader (the mobs.js pattern — a shared
  `MM.partyAt` was considered and skipped: the three scans have different semantics
  and the local guarded read is the established, pinned idiom). `bodyLike` now
  carries advisory vx/vy for aim-lead. QA scene 10j: an invasion commander, a
  guardian flare and a turret all engaged/defended the guest with the host ~90
  tiles away and untouched.
- **Death/respawn:** host-decided, 6 s timer, respawn at the host.
- **Resync safety:** an embodied guest keeps ITS hero across a mid-session
  world resnap (`keep` guard in `applySnapshot`).

---

## 4. The remaining gap list — ordered, with implementation guidance

Ship one wave at a time. Each wave = source change + `ghost-sim` pins + one new
`ghost-qa.mjs` scene + `npm run check` green + a commit. Do not batch waves.

### Wave A2 — Finish party-targeting — ✅ DONE (2026-07-16)
Shipped: guardians (aim + all 7 hazard causes + contact via `body.hurt()`, fight
lifecycle deliberately host-anchored), invasions (per-alien melee/hitscan retarget
+ squad-brain hunts the party member nearest the squad center), turrets (active-gate
+ discovery scan honor guest bodies). Pins in ghost-sim Wave A2 block; live QA
scene 10j. **Consciously deferred (still open):** mob/invasion **spawning** centers
on the host (`trySpawnNearPlayer`, `teamInActiveView`) and despawn is host-distance
(>220 / offscreen-days) — a guest far from the host sees thinner spawns;
`heroThreatProfile` / `applyProgressionFlee` weigh only the host (a strong guest
scares nothing, a weak one attracts no mercy); companions defend only the host;
invader barricade/vent placement guards and speech/awareness triggers read only the
host; `applySeparation` shoulders only the host aside (bodies are guest-authoritative
— by design, not a gap); guardian storm targeting aims at the host (hazard hit-tests
still cover bodies).

### Wave B — Guest combat & tool parity — ✅ DONE (2026-07-16)
Shipped: the strike stub became a host-owned arsenal. `NET.PLAY_WEAPONS` (fists /
sword / bow starter templates; acquisition arrives with Wave C) + `validPlayWeapon`
+ `playAimDir`; the body spawns with `weapons` + starter `arrowWood` ammo in the
pouch, both streamed via `pvit`. The `attack` intent (`{a:'attack', key, x, y}` —
float aim) bypasses the tile-reach gate but is validated host-side for ownership,
`max(ATTACK_MS, cdMs)` cooldown and pouch ammo, then resolves through
`bridge.ghostPlayAttack` → `MM.weapons.coopMeleeAt` (the hero's real attackAt
fan-out, minus chests/pickups/npcSystem/centerGuardian) or `spawnCoopArrow` (the
ONE shared projectile array, `coopOwner`-tagged: `source:'coop'`, no host ult, no
chest opening, no glass shattering, `recoverable:false`). A coop hit provokes
retaliation (`noteDamageSource` marks heroFocus for `source:'coop'`) without
feeding hero-threat profiling; landed hits pay the guest the `hit` deed. Mining
ticks now derive from real hardness (`ghostPlayMineTicks` = INFO.hp/6 law, dirt=1
tick, stone≈4). FX: `coopSwings` (cap 8) stream as `st.cw` in the weapon-FX
mirror; guest arrows mirror for free via the shared array. Client: `#gbArms`
weapon chips (armed kind = what the next intent names), LMB-in-air attacks with
the armed weapon, `_playArm` QA seam. QA scene 10k. **Consciously deferred:**
guest ult (per-body charge + UI), spears/streams/electric/thrown for guests,
arrow-kill deed credit (only melee hits pay today, ranged kills pay nothing),
knockback from guest blows uses the chain defaults, weapon durability.

### Wave C — Guest crafting, inventory & gear — ✅ DONE (2026-07-16)
Shipped: `NET.PLAY_RECIPES` (arrows ×10 from wood+stone; the spear — the first
EARNED weapon, reach 3) with pure `pouchAfford`/`pouchSpend` (all-or-nothing,
zero-cost-safe). The `craft` intent mutates only host-owned body state (pouch →
pouch/arsenal): recipe whitelist, owned-weapon dedup, atomic spend, `craft` deed,
`#gbCraft` chips client-side (affordability display-only). **Persistence decision
(pinned):** authoritative body state (pouch + earned arsenal) lives in HOST-side
storage (`mm_ghost_bodies_v1`, 24 entries / 7-day TTL) keyed by the guest's stable
self-claimed gid; the client holds only the key (`mm_ghost_gid_v1`, allowlisted).
Restore treats disk as hostile input (re-clamped counts, whitelist-filtered
weapons, kept pouch REPLACES the starter quiver so rejoining farms nothing).
Banked on: craft, demote, connection drop, reap tick, session stop. The gid is
tab-first (sessionStorage) with a heartbeat **lease** on the browser-stable base —
a second tab mints its own gid instead of booting the first via newest-wins (a
real collision QA caught live). No storage → explicitly ephemeral. QA scene 10l.
**Consciously deferred:** the full assistant-workbench-style catalogue panel
(curated chips shipped instead — the recipe surface is 2 entries; revisit when the
arsenal grows), gid impersonation surface accepted (a self-claimed key guards
convenience state only; embodiment itself stays hand-granted by the host).

### Wave D — Guest survival systems (host-owned, per body) — 🟡 PART 1 DONE (2026-07-16)
Shipped (part 1): `bodySurvivalPass` on the body cadence — **drowning** runs the
REAL hero law per body (`SURVIVAL.updateDrowning`: same 20 s grace, ramp, 12 cap,
`consumeDrowningDamage`; per-body `drownSt`, lungs reset on respawn; breath
warnings stream as `pdrown` toasts) and **lava** sears with the hero's own 8 —
both against world truth read host-side (`bridge.getTile`), landing through
`hurtBody`, zero client fields consulted. Correction to this wave's premise: the
HERO takes **no fall damage** in this game (only bosses do) — parity means guests
take none either; that ruling is pinned. QA scene 10m (pre-ages lungs through the
new `MM.ghostHost._debugBody` live-body seam instead of stalling 20 s).
**Still open (part 2):** hunger/energy (`survival.js` — needs a guest eat action
+ HUD chips), temperature exposure, status effects (`hero_status.js`), swim-chill
and water-pressure laws, per-guest gravestone on death (`respawn_travel.js`
precedent — today: respawn at host, pouch intact).

### Wave E — Design rulings & polish — 🟡 RULINGS SHIPPED (2026-07-16)
**Owner rulings received, implemented and pinned:**
- **PvP = duels by consent.** A `duel` intent registers a challenge (`s.duelAsks`,
  30 s TTL); the duel starts ONLY on the mutual handshake, is host-arbitrated end
  to end, resolves MELEE blows only (arrows stay creatures-only for now), never
  touches the host hero, and ends on death, demotion or leaving. Client: ⚔ button
  (nearest player), toasts, `_playDuel` seam. QA scene 10o: no consent = no
  scratch; handshake = the sword's exact damage; host untouched; demote forfeits.
- **Trading = host gifts only.** `MM.ghostHost.giftResource(gid, key, n)` (🎁 in
  the viewer row) — the resource must really leave the HOST inventory
  (`ghostGiftTake` bridge seam: whitelisted key, bounded count) before the guest
  pouch is credited. Guests cannot move items between themselves.
- **Fog = shared.** The standing contract (guest replica reveals through the one
  normal reveal path into the host-mirrored fog) is now pinned; no per-guest fog.
**Still open (polish):** water sub-tile partials around bodies, smooth position
reconciliation (today: >6–8-tile hard snap), per-body cosmetics (`drawHeroAt`
bleeds the host's tool/cape onto remote bodies), duel arrows, gift-a-weapon.

### Wave F — Infra reliability — ✅ DONE (2026-07-16)
Shipped: the host tracks sim liveness (`s.lastSimAt` — only the rAF loop stamps
it; the pump declares itself with `fromPump`) and self-reports `idle` on the
presence plane when backgrounded; the watcher raises a fixed banner
("gospodarz jest nieaktywny — świat wstrzymany", pointer-events:none) on
host-idle or an 8 s all-traffic gap, cleared the moment the sim resumes. A join
that never lands gets an honest verdict + a 🔄 retry button after 25 s (reload —
the real join path) instead of an eternal spinner, and the invite panel documents
the STUN-only NAT limitation. QA scene 10n (host backgrounded live → banner
up/down; dead-room join → verdict via the `_debugAgeJoin` seam). **Out of scope,
confirmed:** host migration; a TURN server (would need infrastructure — the
limitation is now at least explained to the people who hit it).

---

## 5. How to work in this repo (do this, in this order)

1. **Read the two memory files.** They encode gotchas that cost hours.
2. **Baseline before editing:** `npm run lint && npm run test:ghost && npm run
   check:modules` — all clean, or stop and fix first.
3. **Pure logic goes into `ghost_net.js`** and gets unit tests in `ghost-sim`.
4. **Wire host authority → client → bridge seam.** Host validates; client points;
   bridge re-checks world truth.
5. **Pin every contract** in `ghost-sim.test.mjs`. Several pins match exact source
   substrings — when you change a gate's shape, update the pin in the same commit.
6. **Add one live QA scene** per wave to `ghost-qa.mjs`; run the whole driver.
7. **`npm run check`** (the full ~140-suite chain) before declaring done — your
   `mobs.js`/`main.js` changes ripple into unrelated suites.
8. Commit per wave with a story-telling message; the repo convention is direct
   commits to `main`.

---

## 6. Verification commands

```bash
npm run lint            # eslint, zero warnings
npm run check:modules   # import/export guard (catches the NET aggregate trap)
npm run test:ghost      # pure core + source pins (fast — run constantly)
node tools/ghost-qa.mjs # live headless-Edge CDP, all scenes incl. 10i (play + hunt)
npm run check           # the whole suite chain — must exit 0
```

---

## 7. Repo-specific pitfalls (all real, all have happened)

**CDP / QA driver:**
- A backgrounded tab's `rAF` is frozen — its sim stops; only the companion pump
  (~1 Hz) keeps the network alive. Scenes needing the host world RUNNING must
  `host.front()` first. Sample from the driver side, in real time.
- Two reads <1.5 s apart on a backgrounded tab hit the same pump tick and look
  "frozen" even when the stream works.
- **Kill orphaned `msedge.exe` between runs** — a dozen leftovers from failed runs
  throttle the sim to ~10 fps (`frameMs:100`) and make healthy scenes flaky:
  `taskkill //F //IM msedge.exe`.
- Synthetic `keyup` events do NOT reliably clear held keys under headless CDP — use
  the `MM.ghostClient._playStop()` seam to halt the guest hero deterministically.
- Read paired values (e.g. mem-vs-disk XP) **atomically in one eval** — deeds keep
  banking between two evals and the comparison lies.
- The deed-queue persistence pattern: a backgrounded guest banks deeds at ~1 Hz, so
  before a reload you must foreground → drain (≈700 ms) → `_flushForTest()`.

**World-state scenes:**
- Terrain carves must keep the tile UNDER an actor's feet: `floorRow =
  Math.ceil(b.y + 0.46)` — `Math.round(b.y)` clears the footing and drops the body.
- A cell you intend to mine needs a TALL air column above it — loose sand/gravel
  cascades into the hole during the ~2 s mine window and masks the break.
- Spawning a hunter for combat scenes: pick `alwaysAggro` (a leveled host scares
  normal mobs into fleeing before contact), `!sunriseBurn` (skeletons burn in
  daylight), `hp >= 60` (fragile mobs die/despawn), ground/!aquatic/!flying.
  `MM.mobs.setAggro(id)` latches species aggression for 5 min.
- World start is nondeterministic per run — never hardcode coordinates; read them
  from the running world.
- Negative-coordinate interpolation in evals: `p.x-${-39.5}` is a SyntaxError —
  always wrap `(${v})`.
- `getComputedStyle(el).display` of a child inside a `display:none` container
  returns the child's own display — use `el.getClientRects().length` for
  "actually visible."

---

## 8. Definition of done

Full multiplayer is 100% when: two people on different machines join one world;
each has a hero with real movement, tools, weapons, crafting, inventory, and
survival; every hostile system treats every hero as a target and every friendly
system protects them; the world stays coherent across reconnects; the remaining
design rulings (PvP/trading/fog/persistence) are decided, implemented, and pinned;
and **no unvalidated effect is ever possible from a modified guest client** — with
the spectator experience still available as the lower rungs of the same ladder.
Every wave is pinned in `ghost-sim`, exercised live in `ghost-qa`, and
`npm run check` is green.

**Start with Wave A2** (finish party-targeting — small, mechanical, cements the
pattern), then give **Wave B** (real guest weapons) a full focused session.
