# Sandbox World Simulation

Procedural 2D tile world with advanced water simulation and emerging gameplay features.

## Development

No build step — vanilla ES modules served statically.

```bash
npm install          # dev tooling only (ESLint)
npm start            # serve the game at http://localhost:8123
npm run lint         # correctness-focused ESLint pass over src/
npm run check:modules # static ES-module graph check (catches missing exports)
npm run check        # lint + module graph
```

`npm run check` runs in CI on every push/PR (see `.github/workflows/ci.yml`).
The module-graph check exists because a single missing ESM export silently
blanks the whole game — exactly what happened during the 2025 ESM migration
(`water.js` published to `MM.water` but exported nothing, killing `main.js`).

## Customization & Gameplay Modifiers
Cosmetic selections now influence mechanics via a scalable modifier system:
* Capes define additional mid‑air jumps (classic: 1 jump, triangle/tattered: 2 total, shadow: 3 total, royal/winged: 4 total)
* Eyes control fog reveal radius (sleepy: small, bright: large, gold: large+, glow: very large)
* Outfits grant effects: Miner (+50% mining speed), Mystic (+15% move speed), Ninja (+20% move, +15% jump), Iron (+25% mining, +5% mobility). Default has no bonus.
* Cape & default-outfit colors are user-selectable (swatches + free color picker) and persist across sessions.
* The Stylizacja panel offers a live animated preview, per-style cape thumbnails matching engine physics shapes, stat breakdowns, and randomize/reset buttons. Outfit bodies render through a shared `MM.drawOutfit` used by both the game and the preview.

System design allows future items to contribute fields (e.g., mineSpeed, swimSpeed, mana) aggregated into `MM.activeModifiers`.

## Interaction Model (mining / building / pointing)
* Screen→world conversion goes through a single `screenToWorldTile()` (zoom + camera only —
  the canvas context is already DPR-scaled, so pointer math must NOT divide by DPR).
* Left click mines the clicked tile (reach 3, Chebyshev). Holding drags the dig target with
  the cursor; the ⛏️ touch button digs continuously in its selected direction while held.
  Only the pointer that started mining can stop it (multi-touch safe). Chest tiles are always
  opened, never destroyed, by both paths.
* Right click places (reach 5). Placement validity lives in one `canPlaceAt()` used by both
  `tryPlace` and the ghost preview (green = allowed, red = blocked). Support = anything below,
  or a non-fluid side/ceiling neighbour; sand and water may always float. Solid blocks can
  replace water (underwater building). Right-button placement happens on pointerdown;
  `contextmenu` only serves touch long-press (400 ms dedupe prevents double placement).
* Mining water collects it (+1 woda) — the only non-god way to obtain placeable water.
* Physics integration is substepped (≤0.4 tile per step) so speed multipliers / low FPS can't
  tunnel the player through tiles; tiles below `WORLD_H` act as bedrock.
* Game hotkeys ignore keystrokes targeted at inputs/sliders/selects; all keys release on
  window blur. Saves triggered by tile edits are debounced (2.5 s) and flushed on pagehide.
* Regression tests: `f:\_DEV\tools\webdebug\interactions.mjs` (runs at deviceScaleFactor 2 to
  guard the DPR pointing bug) and `physics-stress.mjs` (tunneling + bedrock).

## Water Simulation Features
* Multi-cell vertical falling (fast settling)
* Slowed, gated lateral spreading with downhill seeking
* Pressurized sideways seepage: cells with hydraulic head flow into same-level openings
  (freshly mined walls flood; surface puddles still can't random-walk)
* Hydrostatic equalization (true communicating vessels): each connected body flood-fills
  the void container it can reach without crossing above its own surface, then moves
  volume toward the bottom-up equilibrium fill — water rises through U-bends, risers and
  galleries and drains into reachable drops until joined regions sit within one tile of
  a common level. Exact conservation; rate-limited so changes read as flow
* Lips hold: container traversal runs strictly below the body's surface, so pools never
  creep along their own surface row (films are handled by local spill/seek dynamics)
* Spills require a passable same-row side cell (no diagonal clipping through wall
  corners into sealed pockets)
* Chunk generation queues a boundary wake: water dormant at a chunk seam reacts when a
  new chunk carves caves (or brings water) next to it
* Passive activation scan sweeps a window around the player (covers negative x, runs
  even alongside light sim activity, wakes side-pressurized cells, and no longer
  force-generates far-away chunks)
* Adaptive pressure interval & lateral cooldown for performance stability
* Active set compression & variance-based scheduling
* Deterministic sim regression tests: `npm run test:water` (gravity, waterfall events,
  basin fill, leveling, tunnel flooding, cave roofs, volume conservation, displacement,
  negative-x wake-up, save compat)

## Dynamic Water Rendering (FX layer)
* Spring-based surface waves: every surface column is a damped oscillator with neighbor
  coupling, so disturbances travel outward as real waves (`MM.water.disturb(x, impulse)`)
* Wave sources: player dives/exits, swim wakes, falling stone & sand, aquatic mobs,
  waterfalls, edge spills and pressure-leveling slosh
* Smooth continuous surface mesh (per-column quads sharing edge heights) with ambient
  multi-frequency swell, crest sheen and whitecap foam on steep wave slopes
* Depth-graded translucent body (sky and parallax hills glass through near the surface,
  fading to deep navy); sealed underground pockets render murkier and darker
* Animated caustic web, drifting light shafts, twinkling sparkles, shoreline foam
* Waterfall streams with bright cores, falling streak highlights and impact mist
* Ambient bubbles rise through deep water; underwater screen tint + vignette while diving
* All effects composite on an offscreen layer clipped to the water shape
  (`source-atop`), blended in a single drawImage; strictly cosmetic — tiles never mutate

## Player Water Interaction
* Buoyancy & swimming: horizontal drag while submerged
* Upward float when >55% submerged, gentle surface bob
* Dive by holding Down (reduced buoyant lift, assisted descent)
* Jump in water gives a soft swim kick upward (no full ground jump)

## Weather & Water Cycle (engine/clouds.js)
A closed, volume-true water cycle on top of the fluid sim (1 cloud mass unit = 1 tile):
* Evaporation: sun-exposed water surfaces (first thing hit scanning down from the sky —
  roofs, ice crusts and shade block it; leaves filter light through) feed a regional
  vapor field. Rate scales with sunlight (time of day), climate temperature and humidity
  (saturated air evaporates nothing). Tile removal is deferred per column, so lakes
  drain slowly while the atmosphere responds quickly; morning mist wisps rise off water
* Condensation: when a region's vapor passes its dew threshold (cold air condenses
  sooner) it nucleates a cloud; passing clouds also drink vapor from below
* Clouds: drifting parcels riding a slowly turning wind, cruising above the local
  terrain (higher over ranges). Overlapping clouds merge ("cumulate"); new weather blows
  in from beyond the simulated band; starved wisps re-evaporate
* Precipitation: a cloud rains when its mass exceeds the saturation capacity of the
  surrounding air. Capacity falls with temperature, so nightfall, cold biomes and high
  altitude trigger rain — and very large clouds storm regardless. Cold ground turns the
  fall to snow (cosmetic flakes, mass sublimates back to vapor)
* Storms: fronts roll in periodically (`MM.clouds.startStorm(duration, intensity)` on
  demand) — gusting winds, brooding ambience, swollen black cells pumped past
  saturation pour heavy rain. Storm moisture arrives from off-band regions, so the
  books stay volume-true
* Lightning: heavy warm cells throw branched, flickering bolts with impact bursts,
  screen flash and distance-delayed thunder (synthesized rumble). A strike TRANSMUTES
  the tile it hits into a loot chest (70% common / 22% rare / 8% epic — bedrock and
  existing chests are spared) but ELECTROCUTES a hero standing near ground zero
  (heavy at the impact, falling off with distance, conducted twice as far through
  water; standard i-frames/knockback/respawn rules apply). Striking water just makes
  the surface erupt
* Deposition: rained mass lands as real WATER tiles fed to the fluid sim — puddles form
  and flow downhill, lakes refill, raindrops splash and kick the surface springs
* Rendering: per-cloud cached puff sprites (shaded base, sunlit crown, dusk/night
  tinting), soft ground shadows, slanted rain streaks / drifting snowflakes
* The debug time-of-day slider drives the weather too (shared `background.getCycleInfo()`)
* Debug: F3 HUD shows cloud count/mass, vapor, wind and drop counts; `MM.clouds.config`
  exposes live tunables, `MM.clouds.addCloud(x, alt, mass)` spawns one on demand
* Deterministic regression tests: `npm run test:clouds` (evaporation + conservation,
  condensation, oversize rain & tile-deposit accounting, night-cooling rain trigger,
  merging, snow, incoming border clouds, lightning strike transmutation/damage, storm
  lifecycle, API safety); visual harness: `tools/clouds-smoke.html` (`?t=0.75` night,
  `?storm=1` storm front with forced strikes)

## Boss Monsters (engine/bosses.js)
Large procedural creatures that appear at every dawn and every dusk, 35–95 columns
from the hero — never on top of you, always on reachable land, announced with a
direction hint and tracked by a pulsing off-screen HUD arrow until you find them:
* Generation is fully seeded: a mirrored body blob on a part lattice (one part = one
  tile, ~20–60 parts), legs, a front eye, armor plating around a glowing HEART, plus
  rolled archetype (walker / hopper / floater), speed, senses, contact damage and a
  generated name — no two monsters are alike. New species = new silhouette/stat rolls;
  physics, combat and rendering are shared
* Physics: gravity, terrain collision, 2-tile step climbing, hops, hovering with bob;
  knockback on the hero; severed chunks and blast debris tumble under gravity
* Destructible structure: attack any part (left click, tool-scaled damage) — parts
  crack as they weaken, break off, and anything disconnected from the heart falls
  away as debris while the leaner beast keeps roaming/hunting (enraged below half
  heart HP: faster and meaner)
* Behavior: roam with random direction flips → hunt when the hero enters its sense
  range (hysteresis prevents flickering); trampling contact damage with i-frames
* Feeding & growth: between fights a beast grows hungry and grazes the world — it
  drinks water and eats sand/plants/snow/wood, accreting a matching body block every
  few bites (water→ice, sand→sand, …; never below the feet line). A feeding beast is
  peaceable until full, struck, or cornered; growth is capped and hardens the heart
* Balance & articulation: legs prop the body up — lose one side's legs and it lurches
  and lists toward the gap; limbs (legs, arms, tentacles) swing with the walk cycle
* The heart: armored deep inside — expose it by destroying the plating, strike it,
  and the monster detonates: a crater is blasted into the terrain (bedrock and chests
  survive; the fluid sim is woken so water pours in), a hero standing close is hurt,
  and the kill pays out XP
* Debug: menu panel buttons "👹 Boss" (summons one beside the hero, trying both sides
  so water can't block it) and "💀 Kill boss" (detonates the nearest heart through the
  real death path); console: `MM.bosses.forceSpawn(null,{x,seed,archetype,freeze})`,
  `MM.bosses.killNearest()`; F3 HUD line, metrics
* Physics is substepped (≤0.45 tiles per resolve) so lag-spike frames can't tunnel
  a falling monster through thin floors; floaters bounce off cliffs taller than they
  can hover over instead of embedding in rock; spawns into sealed columns are
  rejected rather than buried; even forced spawns respect a hard ceiling
* Deterministic regression tests: `npm run test:bosses` (generation/determinism,
  spawn scheduling & distance, gravity + thin-platform landing at worst-case dt,
  roam/hunt, hopper/floater archetypes, part destruction + connectivity pruning,
  detonation crater/loot/XP, contact damage, spawn caps, perf budget, API safety,
  feeding/growth/balance, floater cliff-bounce, sealed-spawn rejection, hunger
  accrual under a camping hero); visual harness: `tools/boss-smoke.html`

## TODO (Ideas)
* Water-material interactions (erosion, sand absorption)
* Source vs finite water tiles
* ~~Evaporation / rainfall cycle~~ ✅ done — full cloud/weather system (see above)
* Debug overlay for active water tiles & pressure fields
* ~~Bubble & splash particles~~ ✅ done — entry/exit splashes scale with impact speed; bubbles rise while diving

## Dev Notes
All water surface smoothing preserves volume. Visual wave effects are strictly cosmetic and do not alter tile data, ensuring determinism and preventing column artifacts.

## Linear workflow (solo dev)
To keep history simple and add one feature at a time:
- Work on branch `main` or make short-lived branches like `feat/<name>` and fast-forward merge only.
- Pull is set to rebase; merges are fast-forward only; fetch prunes stale branches.
- If you paused work with local changes, rebasing will auto-stash to avoid conflicts.

Configured locally:
- merge.ff = only
- pull.rebase = true
- rebase.autostash = true
- rebase.updateRefs = true
- fetch.prune = true
- rerere.enabled = true
