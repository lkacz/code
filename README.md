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

The runtime complement is `src/boot_watchdog.js` — a classic script outside
the module graph. If any module fetch stalls or fails (flaky connection, bad
deploy), the browser abandons the whole import tree and the player would be
stuck on the static HUD skeleton forever; the watchdog waits for the main
loop's frame heartbeat (`window.__mmFrameMs`) and otherwise raises a "Świat
się nie załadował" panel with a retry button.

End-to-end playability is exercised by `node tools/free-play-qa.mjs` (headless
Edge over CDP): boots a fresh world, measures fps, walks/jumps with real key
events, mines and places with real pointer events on a scanned flat-ground
camp, swaps weapons, hikes into fresh chunks, then forces a save and asserts
the reload restores position, health and terrain exactly.

## Inventory, Equipment & Gameplay Modifiers
The Ekwipunek panel (menu button or `E`) is a scalable inventory: equipment slots (cape /
eyes / outfit / weapon / charm), a bag of loot collected from chests, and a resources tab
managing mined blocks (drop amounts, assign a block type to the active hotbar slot).
Core model lives in `src/inventory.js` (registry, slots, bag, persistence under
`mm_inventory_v1` with migration from the legacy `mm_custom_inv_v1`), DOM layer in
`src/inventory_ui.js`. Equipped items influence mechanics via the modifier system:
* Capes define additional mid‑air jumps (classic: 1 jump, triangle/tattered: 2 total, shadow: 3 total, royal/winged: 4 total)
* Eyes control fog reveal radius and occlusion: sleepy/bright eyes discover only current line-of-sight, so solid blocks hide what is behind them until you reach a view angle, but once a tile has been seen it stays on the remembered map; gold/glow and alien-sight eyes pierce blocks and keep the older full-radius remembered reveal.
* Outfits grant effects: Miner (+50% mining speed), Mystic (+15% move speed), Ninja (+20% move, +15% jump), Iron (+25% mining, +5% mobility). Default has no bonus.
* Weapons come in five classes (`weaponType`): **melee** strikes the aimed tile with a visible blade swing + slash arc, **bow** shoots arrow projectiles (gravity arc, stick into terrain, absolute damage via `mobs.damageAt`/`bosses.damageAt`), and three stream weapons — **flame** ignites organic creatures (burning DoT, water extinguishes) and flammable tiles, **hose** sprays water that extinguishes tile fire and burning creatures and occasionally condenses into a real WATER tile, **gas** emits a lingering toxic cloud that poisons living (organic) creatures (slow DoT, not washed off by water). With a weapon selected, LMB fires/attacks and RMB uses the charged ult; `F` is not a weapon input. Number-key shortcuts switch the held item by category: `1` = pickaxe/build mode (holsters the weapon; pressed again cycles owned pickaxe tiers), `2` = melee, `3` = bows, `4` = stream throwers (flame/hose/gas) — repeated presses cycle through the category's weapons, and each weapon's "Skrót" toggle in the inventory decides whether it joins the cycle (`WEAPON_CATEGORIES` in `src/inventory.js`, persisted opt-outs). A weapon bar above the block hotbar (which now sits on keys `5`–`9`, `0`) mirrors the active mode. Charms add passive stats; chests drop procedurally named weapons of all classes alongside gear.
* Tile fire (`engine/fire.js`): grass / wood / leaves carry `flammable` + `burnTime` in `INFO`; burning tiles spread to flammable neighbours (preferring upward, so trees torch dramatically), ignite creatures standing in them, are extinguished by adjacent water and finally burn away to AIR with falling/water notifications — capped at 240 simultaneous flames so a forest fire stays bounded.
* Elemental interactions (`engine/weapons.js` + tiles LAVA/MUD/OBSIDIAN in `constants.js`): flame **boils water** away into steam whose mass joins the cloud/vapor cycle (`clouds.injectVapor`, volume-true), **melts stone into lava** and **thaws snow/ice into water** (tile fire melts adjacent snow too); the hose **quenches lava into obsidian** (hard, mineable, placeable — a real resource with HUD/hotbar/inventory plumbing) and **soaks sand into mud**, which halves the movement speed of the hero, animals and grounded bosses; **arrows ignite** when they fly through fire or over lava, setting targets and terrain alight — and a burning arrow shot into a gas cloud detonates it.
* Lava is a **viscous fluid** (`fire.js` lava registry, re-hydrated by the viewport scan after reloads): far slower than water, it falls, pours over edges, and levels out only under the pressure of lava above (so puddles rest instead of smearing thin). It sears the hero and mobs, ignites adjacent flammables, **hardens instantly against water**, and — left settled and **exposed to open air** — slowly crusts into obsidian (40–80 s).
* Toxic gas **explodes on contact with open flame or lava** (TNT effect): the surrounding cloud is consumed into the blast (bigger cloud → bigger boom, with a short cooldown so streams produce rhythmic booms), soft terrain craters while chests/obsidian/diamond survive, creatures take distance-scaled blast damage with knockback (`mobs.blastRadius`), bosses and plants are hit, a careless hero is hurled, and the rim catches fire.
* Living plants (`engine/plants.js`, tested by `npm run test:plants`): five species (sunflower, berry bush, reed, fern, cactus) sprout naturally on watered soil near the hero — one per column, capped, persisted in `mm_plants_v1`. Each plant has hydration, health, age and a lifespan: it drinks from adjacent water (absorbing the whole tile every third sip), from rain (`clouds.isRainingAt`) and from the player's hose (`plants.waterAt` — a watering can); wet mud keeps roots damp; cacti barely need water. Hydrated plants grow through stages; thirsty ones yellow, wilt and crumble; even watered plants degrade and die of old age. Fire, lava, the flamethrower and mined-out soil destroy them. Clicking a ripe berry bush harvests it (+6 HP, the bush regrows); clearing other plants returns a leaf.
* Item readability: the player never sees a raw multiplier — every stat displays as a clean signed percent snapped to a 5%-step ladder (5/10/15…50, then 10-steps to 100, then 25-steps, cap 200%; vision converts against its 10-tile baseline). Chest loot **rolls discrete clean steps natively** (`pctSteps` in `chests.js`), legacy items are normalized once on ingest (`sanitizeLootItem`). Each item gets one comparable **"Moc" power score** (`itemScore`, shared weights in `inventory.js`) shown with a bar relative to the strongest owned item of its group plus a ▲/▼ delta vs the equipped item; grids sort strongest-first, the weapons tab groups by shortcut category (a bow is never judged against a sword), the loot popup uses the identical chip/score presentation, and a 🧹 action discards looted items strictly weaker than what's equipped (built-ins and upgrades always stay).
* The panel offers a live animated preview, per-style cape thumbnails matching engine physics shapes, stat breakdowns with per-item contributions, and randomize/reset buttons. Outfit bodies render through a shared `MM.drawOutfit` used by both the game and the preview.
* Panel UX (2026 refresh): tabs carry kind icons, owned counts and a cyan dot when unseen
  loot of that kind waits; the NEW-loot review is a single dismissible strip (the grid
  cards themselves badge NOWE/TOP/UP verdicts in a reserved row so thumbnails align);
  cards get a rarity-tinted frame via a `--tier` CSS variable, a primary **Załóż** vs
  ghost/toggle/icon-danger button hierarchy, and 2-line-clamped names/descriptions with
  tooltips. Resources render as a searchable card grid (owned first, empty stacks dimmed,
  drop buttons disabled below their amount). Keyboard: `E` close, `Ctrl+←/→` tabs,
  `/` focuses search, `Esc` clears the search before closing. Visual QA driver:
  `node tools/inv-ui-qa.mjs` (headless Edge, seeds tiered loot, screenshots all tabs).

Stats combine by declared rules (`sum` / `mul` / `max` in `STAT_RULES`), so future items
can contribute new fields (e.g., swimSpeed, mana) aggregated into `MM.activeModifiers`.

## Story Arc — "Warstwy Symulacji" (layers of the simulation)
The world is one layer of a simulation that only moves while someone watches, and
every great boss is both a program node and a metaphor for an inner struggle. The
arc is fully playable start→finish and always signposted **diegetically** — the
mentor, NPC whispers, world events and the task tracker carry the goals; the game
never prints a bare "go to X":
1. **Przebudzenie** — Stary Kwadrat's paranoid tutorial (observe the world, water,
   meat, the duel, the volcano). Each quest step mirrors into the task HUD with a
   pointer at the mentor (`story_progression.js`).
2. **Dwa Horyzonty** — when the tutorial ends, the world "reacts" (one-time beats
   from `STORY_LORE.progressionBeats`) and both horizons open as goals: the West
   Ice Guardian (rejection/emotional cold) and the East Fire Guardian (unanswered
   passion), ±10 000 columns out (`guardian_lairs.js`).
3. **Trzeci Kret** — both elemental hearts open the alien passage down to
   Nyxolith, the buried-memory mole (`underground_boss.js`). The gate self-heals
   into place on old saves.
4. **Niebo niespelnienia** — the earth heart raises the **Tower of Ambition**, a
   climbable ladder spire from the surface to the Sky Gate arena (ladder cells are
   infrastructure overlays; the hatch through the arena floor is a steel trapdoor
   that opens for upward motion). Astrael is the deliberate *false final*.
5. **Centrum (mother_self)** — the air heart wakes the center (`center_guardian.js`):
   a mirror dais materializes where the story began, the false-final omen plays,
   and Stary Kwadrat confesses (10-line click-through reveal) before dissolving
   into **Guardian Macierzysty — the hero's mimic**, drawn with the player's own
   outfit renderer and replaying the player's movement mirrored across the obelisk.
   The fight has one rule, stated in the confession: **every blow belongs to the
   one who deals it.** The hero's damage (melee/arrows/streams/electric/turrets/
   explosions) is consumed and reflected back after a mirror-flash; the mimic's
   strikes hurt the hero *and drain the mimic's own heart by the same amount*. The
   only way through is acceptance: endure, and the mirror spends itself; the
   killing blow is mutual. `heroDied` routes all `inner_*` causes to
   `centerGuardian.onHeroKilled` — the mirror fight never drops a gravestone.
6. **Epilog** — the obelisk quiets into a lantern, the freed mentor speaks closure
   lines, the mother heart + "Serce Ciszy" charm + an epic chest pay out, and the
   `story_complete` milestone (+1500 XP) lands. NPC whispers and invasion lore
   advance through `storyRevealStage` one act ahead of the fallen guardian, so
   foreshadowing always arrives *before* a fight and closure after it
   (`story_lore.js`; epilogue stage after the finale).
Deterministic regression tests: `npm run test:center-guardian` (call → confession →
reversed damage → mutual fall → epilogue, snapshot/restore) and
`npm run test:story-progression` (task chain + one-time beats per act).

## Progression, Audio & Survival Loop
* **Levels** (`engine/progress.js`): XP (persisted in the world save) maps to levels via
  super-linear thresholds; each level grants a skill point spent in the Ekwipunek
  "Rozwój" panel on Witalność (+10 max HP), Siła (+1 damage) or Zwinność (+2% move/jump) —
  bonuses merge into the same `STAT_RULES` engine as gear. Six persistent **milestones**
  (depth, travel, boss kills, berries, obsidian) reward XP and epic chests.
* **Vitals HUD** (`engine/vitals_hud.js`): the bottom-left glass panel bundles HP, energy,
  level badge + XP and buff chips with game-feel feedback — tweened fills, a Souls-style
  damage-chip ghost that lingers then drains (only discrete hits freeze it, ambient
  drains don't), heal/charge shimmer, floating +/- combat numbers, low-HP heartbeat with
  screen vignette, level-up ring burst, a pulsing "+pkt (E)" pill and per-buff duration
  rings. Animation state machine is headless-tested (`npm run test:vitals-hud`); visuals
  are exercised by the CDP driver `node tools/vitals-hud-qa.mjs`.
* **Crafting** is a data-driven `RECIPES` table: pickaxes, torches ×4 (2 wood), an
  obsidian sword (+6 dmg, flows through the loot pipeline so it persists and equips),
  a diamond charm, and a **Totem odrodzenia** that sets the respawn point (flag marker).
  The recipe-book panel (toggle with **T**) layers a quality-of-life model from
  `engine/crafting.js` on top: ★ favorites pinned first, one 📌-tracked recipe with a
  live HUD ingredient widget (announces when everything is gathered), NEW badges for
  recipes that just became affordable, a craftable-only filter, per-ingredient
  progress bars with "where to find it" source hints, ×5/Max batch crafting and
  lifetime craft counters — all persisted in the save's `crafting` part and covered
  headless by `npm run test:crafting`.
* **Audio** (`engine/audio.js`): every effect is synthesized with WebAudio — zero asset
  files, CSP-safe; context unlocks on first gesture. Digging, breaking, placing, bows,
  swings, streams, explosions, chests, level-ups, boss roars, plus a looping rain bed
  whose gain follows the weather. 🔊 menu button mutes; volume persists.
* **Torches** (tile 16): crafted light sources; the fire.js viewport pass draws their
  flame and a radial glow that strengthens after dark.
* **Cave lighting** (`engine/lighting.js`): a windowed integer light field (0..15) —
  per-column skylight scan (roofs stop it, water/leaves attenuate) plus a bucket-queue
  BFS from emitters (torch 13, lava/fire 12, chests glow faintly); solid cells receive
  light for face rendering but never propagate it, so walls are light-tight. Unlit
  underground darkens under a smooth 1px-per-tile overlay (drawn before the ghost
  preview and fog, which stays the final occlusion); a faint hero glow keeps total
  darkness navigable. The field recomputes only on tile edits in/above the window,
  window moves, day-night bucket flips or a 500 ms heartbeat while fires burn.
  Gameplay seam: `MM.lighting.lightAt(x,y)` — PELZACZE only spawn in the dark
  (>0.25 blocks), so torch-lit galleries are genuinely safe. Deterministic tests:
  `npm run test:lighting`; visual QA: `node tools/lighting-trader-qa.mjs`.
* **Fishing** (`engine/fishing.js`): the calm counter-loop. Craft a rod (wood +
  grass), stand near water, press F — the line arcs to the nearest surface. After
  a seeded wait the bobber dips (❗ + splash): F inside the reaction window sets
  the hook; bigger fish fight with 2–3 telegraphed pulls where an early press
  spooks them and a late one loses them. Catches pay fish (soup recipe, +30 HP),
  a rare golden fish (Eliksir głębin ingredient, trader money) and XP scaled by
  the fight. Walking off or losing the water under the bobber reels in cleanly.
  Deterministic tests: `npm run test:fishing`; visual QA: `node tools/fishing-qa.mjs`.
* **Wandering trader** (`engine/trader.js`): the economy's closing loop. Every 2–3
  game days a hooded merchant pitches a striped-canopy stall on the surface near the
  player for about half a day (announced with a direction hint; a 💎 floats over the
  stall). Clicking the stall (npc_system click dispatch) opens a trade panel: he
  sells torches/arrows/materials/potions and one epic chest (5💎, plopped down as a
  real tile beside the stall), and buys surplus resources for diamonds. Stock is
  seeded per visit; prices obey a test-pinned anti-arbitrage contract (sell price
  per unit > buy-back rate). State persists through the npcs save part; a buried
  stall departs gracefully, a mined floor drops it one tile. Tests:
  `npm run test:trader`.
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
* **Devastated cities** (`worldgen.js` districts + `world.js applyDevastatedCity`):
  each rare urban biome draws one of five **architecture schools** (stone spires,
  glass downtown, foundry sprawl, terraced ziggurats, brutalist megablocks) with its
  own material palette, building-style mix and **skyline envelope** (downtown core,
  twin peaks, terraces…), plus one themed **landmark** per district — ruined
  cathedral, supertower, blast-furnace dome, grand ziggurat with a diamond apex, or
  an atrium-cut arcology slab — placed clear of the district's old power plant.
  Everything is a pure function of (worldSeed, cell/column), so no two cities look
  alike yet every chunk regenerates its slice identically
  (`tools/city-architecture-sim.test.mjs`).
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
