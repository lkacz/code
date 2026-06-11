# Sandbox World Simulation

Procedural 2D tile world with advanced water simulation and emerging gameplay features.

## Development

No build step — vanilla ES modules served statically.

```bash
npm install          # dev tooling only (ESLint)
npm start            # serve the game at http://localhost:8123
npm run lint         # correctness-focused ESLint pass over src/
npm run check:modules # static ES-module graph check (catches missing exports)
npm run check        # lint + module graph + water/clouds/bosses sim tests
```

`npm run check` runs in CI on every push/PR (see `.github/workflows/ci.yml`).
The module-graph check exists because a single missing ESM export silently
blanks the whole game — exactly what happened during the 2025 ESM migration
(`water.js` published to `MM.water` but exported nothing, killing `main.js`).

## Inventory, Equipment & Gameplay Modifiers
The Ekwipunek panel (menu button or `E`) is a scalable inventory: equipment slots (cape /
eyes / outfit / weapon / charm), a bag of loot collected from chests, and a resources tab
managing mined blocks (drop amounts, assign a block type to the active hotbar slot).
Core model lives in `src/inventory.js` (registry, slots, bag, persistence under
`mm_inventory_v1` with migration from the legacy `mm_custom_inv_v1`), DOM layer in
`src/inventory_ui.js`. Equipped items influence mechanics via the modifier system:
* Capes define additional mid‑air jumps (classic: 1 jump, triangle/tattered: 2 total, shadow: 3 total, royal/winged: 4 total)
* Eyes control fog reveal radius (sleepy: small, bright: large, gold: large+, glow: very large)
* Outfits grant effects: Miner (+50% mining speed), Mystic (+15% move speed), Ninja (+20% move, +15% jump), Iron (+25% mining, +5% mobility). Default has no bonus.
* Weapons come in five classes (`weaponType`): **melee** strikes the aimed tile with a visible blade swing + slash arc, **bow** shoots arrow projectiles (gravity arc, stick into terrain, absolute damage via `mobs.damageAt`/`bosses.damageAt`), and three stream weapons — **flame** ignites organic creatures (burning DoT, water extinguishes) and flammable tiles, **hose** sprays water that extinguishes tile fire and burning creatures and occasionally condenses into a real WATER tile, **gas** emits a lingering toxic cloud that poisons living (organic) creatures (slow DoT, not washed off by water). Fire with `F` or the touch ⚔️/🏹/🔥 button (`engine/weapons.js`); melee also works with plain clicks, and the equipped weapon renders in the hero's hand. Number-key shortcuts switch the held item by category: `1` = pickaxe/build mode (holsters the weapon; pressed again cycles owned pickaxe tiers), `2` = melee, `3` = bows, `4` = stream throwers (flame/hose/gas) — repeated presses cycle through the category's weapons, and each weapon's "Skrót" toggle in the inventory decides whether it joins the cycle (`WEAPON_CATEGORIES` in `src/inventory.js`, persisted opt-outs). A weapon bar above the block hotbar (which now sits on keys `5`–`9`, `0`) mirrors the active mode. Charms add passive stats; chests drop procedurally named weapons of all classes alongside gear.
* Tile fire (`engine/fire.js`): grass / wood / leaves carry `flammable` + `burnTime` in `INFO`; burning tiles spread to flammable neighbours (preferring upward, so trees torch dramatically), ignite creatures standing in them, are extinguished by adjacent water and finally burn away to AIR with falling/water notifications — capped at 240 simultaneous flames so a forest fire stays bounded.
* Elemental interactions (`engine/weapons.js` + tiles LAVA/MUD/OBSIDIAN in `constants.js`): flame **boils water** away into steam whose mass joins the cloud/vapor cycle (`clouds.injectVapor`, volume-true), **melts stone into lava** and **thaws snow/ice into water** (tile fire melts adjacent snow too); the hose **quenches lava into obsidian** (hard, mineable, placeable — a real resource with HUD/hotbar/inventory plumbing) and **soaks sand into mud**, which halves the movement speed of the hero, animals and grounded bosses; **arrows ignite** when they fly through fire or over lava, setting targets and terrain alight — and a burning arrow shot into a gas cloud detonates it.
* Lava is a **viscous fluid** (`fire.js` lava registry, re-hydrated by the viewport scan after reloads): far slower than water, it falls, pours over edges, and levels out only under the pressure of lava above (so puddles rest instead of smearing thin). It sears the hero and mobs, ignites adjacent flammables, **hardens instantly against water**, and — left settled and **exposed to open air** — slowly crusts into obsidian (40–80 s).
* Toxic gas **explodes on contact with open flame or lava** (TNT effect): the surrounding cloud is consumed into the blast (bigger cloud → bigger boom, with a short cooldown so streams produce rhythmic booms), soft terrain craters while chests/obsidian/diamond survive, creatures take distance-scaled blast damage with knockback (`mobs.blastRadius`), bosses and plants are hit, a careless hero is hurled, and the rim catches fire.
* Living plants (`engine/plants.js`, tested by `npm run test:plants`): five species (sunflower, berry bush, reed, fern, cactus) sprout naturally on watered soil near the hero — one per column, capped, persisted in `mm_plants_v1`. Each plant has hydration, health, age and a lifespan: it drinks from adjacent water (absorbing the whole tile every third sip), from rain (`clouds.isRainingAt`) and from the player's hose (`plants.waterAt` — a watering can); wet mud keeps roots damp; cacti barely need water. Hydrated plants grow through stages; thirsty ones yellow, wilt and crumble; even watered plants degrade and die of old age. Fire, lava, the flamethrower and mined-out soil destroy them. Clicking a ripe berry bush harvests it (+6 HP, the bush regrows); clearing other plants returns a leaf.
* Item readability: the player never sees a raw multiplier — every stat displays as a clean signed percent snapped to a 5%-step ladder (5/10/15…50, then 10-steps to 100, then 25-steps, cap 200%; vision converts against its 10-tile baseline). Chest loot **rolls discrete clean steps natively** (`pctSteps` in `chests.js`), legacy items are normalized once on ingest (`sanitizeLootItem`). Each item gets one comparable **"Moc" power score** (`itemScore`, shared weights in `inventory.js`) shown with a bar relative to the strongest owned item of its group plus a ▲/▼ delta vs the equipped item; grids sort strongest-first, the weapons tab groups by shortcut category (a bow is never judged against a sword), the loot popup uses the identical chip/score presentation, and a 🧹 action discards looted items strictly weaker than what's equipped (built-ins and upgrades always stay).
* The panel offers a live animated preview, per-style cape thumbnails matching engine physics shapes, stat breakdowns with per-item contributions, and randomize/reset buttons. Outfit bodies render through a shared `MM.drawOutfit` used by both the game and the preview.

Stats combine by declared rules (`sum` / `mul` / `max` in `STAT_RULES`), so future items
can contribute new fields (e.g., swimSpeed, mana) aggregated into `MM.activeModifiers`.

## Progression, Audio & Survival Loop
* **Levels** (`engine/progress.js`): XP (persisted in the world save) maps to levels via
  super-linear thresholds; each level grants a skill point spent in the Ekwipunek
  "Rozwój" panel on Witalność (+10 max HP), Siła (+1 damage) or Zwinność (+2% move/jump) —
  bonuses merge into the same `STAT_RULES` engine as gear. Six persistent **milestones**
  (depth, travel, boss kills, berries, obsidian) reward XP and epic chests. The HUD shows
  a level/XP bar under the health bar.
* **Crafting** is a data-driven `RECIPES` table: pickaxes, torches ×4 (2 wood), an
  obsidian sword (+6 dmg, flows through the loot pipeline so it persists and equips),
  a diamond charm, and a **Totem odrodzenia** that sets the respawn point (flag marker).
* **Audio** (`engine/audio.js`): every effect is synthesized with WebAudio — zero asset
  files, CSP-safe; context unlocks on first gesture. Digging, breaking, placing, bows,
  swings, streams, explosions, chests, level-ups, boss roars, plus a looping rain bed
  whose gain follows the weather. 🔊 menu button mutes; volume persists.
* **Torches** (tile 16): crafted light sources; the fire.js viewport pass draws their
  flame and a radial glow that strengthens after dark.
* **Night hostiles**: GHOUL (shambling, tough) and BAT (erratic flyer) spawn only after
  dark, are inherently aggressive, and **catch fire at sunrise**.
* **Death stakes**: all death paths route through `window.heroDied` — half of every
  resource is left in a GRAVE tile at the death spot; click it to recover the loss.
* **QoL**: surface **minimap** (N) rebuilt twice a second from worldgen columns,
  **pause** (B, simulation freezes while the scene keeps rendering), respawn totem.
* **Structures** (`world.js placeStructures`): ~10% of chunks deterministically roll a
  ruined stone gateway with a rare/epic chest (flat land) or a wooden **shipwreck** with
  an epic chest resting on the sea floor.
* **Buried ruins** (`engine/ruins.js`): subtle surface traces (pillar stubs, rubble, an
  arch, a well ring) mark dig sites; below waits a crypt, a cellar complex, or a deep
  temple with one of three treasure rooms (obsidian vault / lava altar / flooded
  reliquary). Variety stacks three seeded layers: biome material themes, per-class
  architecture variants, and per-ruin decay. 1% of ruins are a **Buried City** just
  above the bedrock — torch-lit cavern, towers, bridge, lava moat, crystal garden and
  an obsidian ziggurat with twin epic chests — marked only by an obsidian monolith on
  the surface. Anchor-based — layouts are a pure function of (worldSeed, cell), so
  ruins may span chunk borders and every chunk reconstructs its slice identically
  (see the architecture note atop the module).
* **Ruin traps** split pure data from runtime: definitions live in ruin layouts
  (`L.traps`), `engine/traps.js` arms instances near the hero, watches triggers
  (tripwire, pressure plate, proximity, mined keystone — every trap also springs
  when its watched tiles are disturbed) and draws the telltales careful players
  can spot. Five kinds: dart volley, grave gas, rune blast (`weapons.explodeAt`),
  sealed lava/water keystones (the fluid sims do the flooding), collapsing floor
  over a lava-or-treasure pit. Fired traps stay dead for the session.

## Extension Points (architecture)
* **Mob status effects** are table-driven (`mobs.js STATUS`): an effect declares tick
  cadence, organic gating, water-curability and movement side-effects; applied via
  `mobs.applyStatus(m,id,{dur,dps})` / `igniteRadius` / `poisonRadius`. A new effect
  ("freeze", "stun") is one table row plus an optional overlay branch.
* **Stat modifier sources** are pluggable (`inventory.registerModifierSource(name,fn)`):
  equipment and trained skill points both merge through `STAT_RULES`; buffs/potions/world
  boons register one provider function returning canonical stat keys.
* **Hero damage** has a single entry — `window.damageHero(amount,{srcX,srcY,kb,kbY,launch,
  invulMs,cause})` in main.js owns i-frames, knockback, hurt audio and death routing
  (`heroDied` → gravestone). Mobs/bosses/explosions/lava all delegate; the engine modules
  keep tiny inline fallbacks only for the DOM-less Node sims.
* **Species are a registry** (`mobs.registerSpecies(def)`): a species declares stats,
  spawn rules and optional hooks — `onCreate`, `onUpdate` (replaces chase AI),
  `habitatUpdate` (runs after it), and `onDeath` (death ceremony; the golden sprinter
  uses it to materialize its epic chest). Rare timed visitors follow the golden
  sprinter pattern: a persisted clock in `update()` + `spawnGolden()`-style summoner.
  The UFO (`engine/ufo.js`) is the second such visitor and adds the abduction seam:
  `mobs.nearestLiving/abduct` and `bosses.nearestForAbduction/abduct` detach a live
  creature without loot/XP/kill credit; weapons route hits through `MM.ufo.damageAt`
  beside the boss checks.
* **Resources are a registry** (`MM.inventory.RESOURCES` → main.js `RESOURCE_DEFS`):
  adding a collectable/placeable resource is one registry entry + an `INFO` tile —
  inv counts, HUD counters, hotbar remap, god-mode stacks, world-reset zeroing,
  placement/consumption, undo refunds, crafting labels and death drops all derive.
* **Lava stays out of water.js by design** — see the architecture note atop
  `engine/fire.js` (sparse viscous thermal automaton vs high-volume wave sim; the
  only seam is the LAVA+WATER→OBSIDIAN conversion rule).

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
  and the kill pays out XP **and a loot chest** settled on the crater floor (weighted
  common/rare/epic; works on the seabed too)
* Variants: 10% of natural spawns are **gargantuan** — 3× silhouette, double trample
  damage, slower, drops a pile of epic chests. Open-sea columns spawn **aquatic
  'swimmer' beasts** (tentacled, icy palette): buoyant 2-axis swimming under the
  waterline, patrols beneath the surface, dives at prey, beaches helplessly if it
  leaves the water
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
