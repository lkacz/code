# Audit Report — Sandbox World Simulation

Date: 2026-06-10 · Commit: d99a087 (main, clean tree)
Scope: full repo — `src/` (7,069 LOC), `index.html`, `tools/`, CI workflows, packaging.

> **Remediation status (2026-06-10):** H1, M1, M2, L1, L3, L4, L5, L7 fixed in the working tree
> (save-browser XSS removed, import validation added, CI runs the full check suite, Pages deploys
> from main only and is gated on checks, missing-hash saves flagged, dead code removed with
> `--max-warnings 0` enforced, LICENSE added, CSP + unhandledrejection handler added).
> Verified: `npm run check` green; game boots and renders under the new CSP (headless Edge).
> Open items: L2 (silent-catch hygiene), L6 (vendor external regression tests), L8 (mobs.js test suite).

## Baseline (all green)

| Check | Result |
|---|---|
| `npm run lint` | 0 errors, 21 warnings (all `no-unused-vars`) |
| `npm run check:modules` | OK — 17 modules, no import/export mismatches |
| `npm run test:water` | OK |
| `npm run test:clouds` | OK (60 s storm simulated in 137 ms) |
| `npm run test:bosses` | OK (60 s × 6 bosses in 82 ms) |

---

## HIGH

### H1. Stored XSS via save-slot metadata rendered with `innerHTML`
[main.js:317](src/main.js#L317) builds the save-browser row with string-concatenated `innerHTML`:

```js
info.innerHTML='<b>'+ nameDisp + … +' • seed '+ (s.seed??'-') +'</span>';
```

Both interpolated values are attacker-controllable through the save **import** feature ([main.js:353-359](src/main.js#L353-L359)):

- `s.seed` is copied verbatim from the imported JSON (`obj.seed`) into slot metadata — it can be any string, e.g. `"<img src=x onerror=…>"`.
- `s.name` comes from the imported file name and from the rename `prompt()`.

A shared/downloaded save file therefore executes script in the game's origin the moment the save browser renders. On GitHub Pages the origin is `lkacz.github.io`, shared by **all** your project pages, so the blast radius exceeds this game (localStorage of every project on that origin).

**Fix:** build the row with `textContent` / `createElement` like every other UI path in the codebase already does, or escape `nameDisp` and `String(s.seed)`. Additionally validate `typeof obj.seed === 'number'` on import (see L3).

---

## MEDIUM

### M1. CI does not run the test suites (README claims it does)
[ci.yml:17-18](.github/workflows/ci.yml#L17-L18) runs only `npm run lint` and `npm run check:modules`. The README states "`npm run check` runs in CI on every push/PR", but `check` also includes `test:water`, `test:clouds`, `test:bosses` — none of which run in CI. The deterministic sim tests are the project's strongest regression guard and currently only run when someone remembers to run them locally.

**Fix:** replace the two run steps with `- run: npm run check` (and prefer `npm ci` over `npm install`).

### M2. Production Pages deploy triggers from `dev2`
[pages.yml:5](.github/workflows/pages.yml#L5) deploys on push to `main` **and** `dev2`. Commit bf77c28 ("ci(pages): deploy from main") intended main-only; any push to a `dev2` branch would silently overwrite the production site. Also, the deploy job runs no checks — a broken push to main ships immediately (mitigated if M1 is fixed, but deploy isn't gated on CI).

**Fix:** drop `dev2`; optionally gate deploy on the check job (`needs:` in the same workflow or `workflow_run`).

---

## LOW

### L1. Integrity hash is advisory-only and skippable
`verifyHash` ([main.js:217](src/main.js#L217)) returns `ok:true` when the `h` field is absent, so deleting `h` from a tampered save bypasses the corruption warning entirely. Load also proceeds on mismatch (deliberate, but combined with the above the hash provides little). FNV-1a is fine for corruption detection; just treat "no hash" as a warning state too.

### L2. 84 silent `catch(e){}` blocks across 12 files
Many are legitimate localStorage/DOM guards, but the pattern also wraps game logic (e.g. the reset cascade in `loadGame`, [main.js:252-262](src/main.js#L252-L262)). The README itself documents how a silent failure once blanked the whole game. Consider `console.warn` in catches around non-storage logic, or a tiny `swallow(label, fn)` helper so failures are at least visible in the console.

### L3. Imported save fields under-validated
[main.js:356](src/main.js#L356) only checks `obj.v` exists. `seed` is later assigned to `WORLDGEN.worldSeed` unchecked ([main.js:265-268](src/main.js#L265-L268)) — a non-numeric seed feeds NaN into terrain math. Validate `v`, `seed`, `player`, and `world.modified` shapes on import.

### L4. Dead code / no-op timers
- 21 unused-var lint warnings = removable dead code (`serializeCurrent`, `pickTier`, `choose` in mobs, `CAPE_SEGMENTS`, `LEGACY_INV_KEY`, …).
- Two empty 60 s `setInterval(()=>{…reserved…},60000)` no-ops at [main.js:1189](src/main.js#L1189) and [background.js:150](src/engine/background.js#L150).

### L5. No LICENSE file
`package.json` declares MIT but the repo has no `LICENSE` file, so the grant is ambiguous for a public Pages site.

### L6. README references tests outside the repo
The interaction/physics regression tests are documented as living at `f:\_DEV\tools\webdebug\…` — not in this repo, not runnable in CI or by anyone else. Consider vendoring them under `tools/`.

### L7. No CSP / no `unhandledrejection` handler
`index.html` loads zero third-party code (excellent), but a CSP `<meta>` (`default-src 'self'; style-src 'self' 'unsafe-inline'`) would render the H1 class of bugs mostly inert on Pages. The `error` listener feeds `#errorBox`, but promise rejections aren't captured.

### L8. Large modules, uneven test coverage
`main.js` (1,252 LOC), `bosses.js` (1,140), `mobs.js` (922). Water/clouds/bosses have deterministic suites; **mobs.js has none** despite being the second-largest engine module. The save/load + RLE codec in `main.js` is also untested and is exactly the kind of pure logic that's cheap to cover.

---

## What's in good shape (worth keeping as-is)

- **Zero runtime dependencies, no CDN scripts, no inline JS** — minimal supply-chain and injection surface; devDeps are just ESLint.
- **Deterministic sim test suites** for water/clouds/bosses with perf budgets — genuinely strong regression protection (once they run in CI, see M1).
- **`modcheck.mjs` module-graph guard** — directly targets the project's known failure mode.
- **Memory discipline**: chunk store capped at 1,536 with far-chunk eviction, height/lake/column caches capped, chunk-canvas cache capped at 28 with distance eviction, cloud vapor and water springs pruned, mob grid cleaned on removal.
- **Save hygiene**: versioned format with v<6 migration guard, RLE decode in `main.js` is bounds-checked, localStorage access consistently guarded, autosave debounced + flushed on `pagehide`.
- **Accessibility**: ARIA roles/labels/live-regions throughout the hand-written UI — unusual and welcome for a canvas game.

## Suggested fix order

1. **H1** — escape/`textContent` the save-browser row + validate imported `seed` (one small diff, closes the only real vulnerability).
2. **M1** — `npm ci && npm run check` in CI (one-line change, activates the whole test suite).
3. **M2** — remove `dev2` from the Pages trigger.
4. L1–L8 opportunistically; L4's lint warnings could be enforced to zero afterward (`--max-warnings 0` in CI).

---

# Physics & Materials Audit — 2026-07-02

Base: f38f761 (main, plus in-progress worldgen changes in the working tree).
Scope: the full physics/materials stack — `material_physics.js` (registry + 70 predicates),
`falling.js` (rigid bodies, sand, structural stress solver), `water.js` (cellular fluid +
hydrostatic equalization), `gases.js`, `fire.js` (burn + viscous lava CA), `reactions.js`,
`wind.js`, `movement.js` (traction kinematics), and the rain/evaporation water cycle in
`clouds.js`. Baseline before changes: all physics suites green.

## Fixed

### P1. Falling entities never settled in the sky sections (negative world rows) — FIXED
[falling.js](src/engine/falling.js) `update()` used `settledAt=-1` / `blockedAt=-1` as the
"still falling" sentinel and tested `settledAt>=0` / `blockedAt<0`. The world extends to
`WORLD_MIN_Y = -140` (sky sections with floating islands), where a resting row is itself
negative — so any rigid block or sand grain landing on a sky-island floor was treated as
"still falling" and hovered mid-air forever (confirmed by simulation: entities stuck in the
`active`/`sandActive` registries indefinitely, burning per-frame budget and never becoming
tiles; they silently teleported into place only on save via `settleAll`).
**Fix:** `null` sentinel + explicit `!==null` checks in both integration loops. Regression
test added to `tools/falling-sand-sim.test.mjs` (rigid + sand settling at y=-11).

### P2. Dead out-of-world guard in rain deposition — HARDENED
[clouds.js](src/engine/clouds.js) `depositUnit()` used `ty=-1` as a "no ground found"
sentinel but guarded with `ty<=WORLD_TOP` (=-140), so the sentinel could never trip and a
miss would have deposited water at y=-2 in mid-air. Unreachable today only because bedrock
always terminates the scan; converted to a `null` sentinel with an explicit miss check.

## Verified sound (no action needed)

- **Volume conservation (water):** `displaceAt` conserves displaced units (up, then
  sideways; documented loss only for fully sealed pockets); pressure leveling moves volume
  source→dest 1:1 with gravity-consistent intermediate states; sand/clay hydration consumes
  exactly one water cell per state change. Steam→water condensation is mass-bucketed 5:1.
- **Falling-solid conservation:** in-flight entities are frozen into tiles on save
  (`settleAll`), rubble crushes only designated crushable supports, `occupy()` displaces
  rather than deletes water.
- **Boundary discipline:** `getTile` clamps NaN/∞ and returns BEDROCK below / AIR above the
  world; every module derives WORLD_TOP/BOTTOM from `WORLD_MIN_Y`/`WORLD_MAX_Y` rather than
  assuming 0..WORLD_H (the P1 sentinel was the one surviving 0-based assumption found).
- **Material registry consistency:** `BUILD_MATERIAL_PROFILES` covers every player-built
  material routed by `materialPhysicsRoute()`; structural/foundation/anchor predicates are
  mutually consistent (spot-checked: no material is both passable-for-falling and
  load-transferring; brittle materials are excluded from load paths).
- **Lava/water seam:** lava always quenches to obsidian before it can move into a
  water-adjacent cell (4-neighbour water check precedes movement each tick).
- **Kinematics:** swept cell-by-cell integration in `falling.js` prevents tunnelling at
  large dt; traction model (`movement.js`) is pure and clamped; wind forces are capped and
  exposure-gated.

## Notes / accepted quirks

- `drawLava` ignites flammable neighbours without a `setTile` (draw path is read-only by
  design): adjacent raw meat ignites and cooks on burn-out instead of instantly — same
  outcome, slightly delayed. Not a defect.
- Gas volume is not conserved when water/solids overwrite a gas cell (gases are
  low-volume atmosphere, TTL-bounded by design).

## Optimization pass (2026-07-02, follow-up)

Profiled the physics hot paths with V8 CPU profiles over three worst-case scenes
(200-wide lake draining into a mined shaft, 440-column wet-sand coast, 1200-grain sand
cascade). The hydrostatic pressure solver (`runPressureLeveling` + `collectBody`) was
~40% of self time, with single-pass spikes of ~4.5 ms — a visible frame hitch. Falling
solids were already cheap (≤0.02 ms/frame under a full cascade).

Behavior-identical optimizations applied to `water.js`:
- Flood fills carry numeric coords beside the membership sets — no string parsing per
  popped cell, no `"x,y"` allocation per neighbor probe (packed numeric cell keys).
- Per-body memoized tile reads (cache cleared before each body's seed check; no tile
  mutates until a body's final transfer loop, so the cached view is always exact).
- Partial-row sort keys precomputed instead of re-reading tiles inside comparators
  (was O(n log n) redundant reads per wide surface row).
- Source/dest transfer lists sort on pre-parsed rows while keeping the original
  lexicographic tie-break, so transfer order is bit-identical.

Measured (medians of 3): drain scene −28% (368→264 ms per 20 s sim), coast scene −14%,
worst-case pressure pass −40% (4.5→2.7 ms), tile reads −36%. Deterministic `getTile`
call counts are byte-identical across the refactor, and the full check suite (incl.
golden sim) passes unchanged.
