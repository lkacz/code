# Sandbox World Simulation

Procedural 2D tile world with advanced water simulation and emerging gameplay features.

## Customization & Gameplay Modifiers
Cosmetic selections now influence mechanics via a scalable modifier system:
* Capes define additional mid‑air jumps (classic: 1 jump, triangle/tattered: 2 total, royal/winged: 4 total)
* Eyes control fog reveal radius (sleepy: small, bright: large, glow: very large)
* Outfits currently cosmetic but structured for future bonuses (e.g., mining speed, resource buffs)

System design allows future items to contribute fields (e.g., mineSpeed, swimSpeed, mana) aggregated into `MM.activeModifiers`.

## Water Simulation Features
* Multi-cell vertical falling (fast settling)
* Slowed, gated lateral spreading with downhill seeking
* Passive activation scan to wake dormant water tiles
* Hydrostatic pressure leveling for flat surfaces over uneven basin floors
* Visual-only wave shimmer & ripple overlays (no tile mutation during waves)
* Adaptive pressure interval & lateral cooldown for performance stability
* Active set compression & variance-based scheduling

## Player Water Interaction
* Buoyancy & swimming: horizontal drag while submerged
* Upward float when >55% submerged, gentle surface bob
* Dive by holding Down (reduced buoyant lift, assisted descent)
* Jump in water gives a soft swim kick upward (no full ground jump)

## TODO (Ideas)
* Water-material interactions (erosion, sand absorption)
* Source vs finite water tiles
* Evaporation / rainfall cycle
* Debug overlay for active water tiles & pressure fields
* Bubble & splash particles

## Dev Notes
All water surface smoothing preserves volume. Visual wave effects are strictly cosmetic and do not alter tile data, ensuring determinism and preventing column artifacts.
