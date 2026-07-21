// Inventory & loot item-system regression tests (Node, no DOM — window stubbed).
// Covers: the clean percent ladder (snapping at display AND generation), stat
// chips, the "Moc" power score ordering, legacy-loot normalization on ingest,
// weapon shortcut category cycling (strongest-first, opt-out, empty category)
// and shortcutOff hygiene on discard. Run: npm run test:inventory
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
const { T, INFO } = await import('../src/constants.js');
await import('../src/inventory.js');
const INV = globalThis.MM.inventory;
const { chests } = await import('../src/engine/chests.js');

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const weaponsSrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.equal(T.BEDROCK_LADDER,95,'bedrock ladder appends a save-stable tile id');
assert.match(indexHtml, /id="hotSelectMenu"[^>]*max-height:min\(78vh,calc\(100vh - 86px\)\)[^>]*overflow:hidden/, 'hotbar picker is height-bounded instead of growing behind the viewport');
assert.match(indexHtml, /id="hotSelectOptions"[^>]*flex:1 1 auto[^>]*min-height:0[^>]*overflow-y:auto/, 'hotbar picker options list owns vertical scrolling');
assert.match(indexHtml, /#craft\{[^}]*width:min\(560px,calc\(100vw - 16px\)\)[^}]*overflow:hidden/, 'crafting recipe book is viewport-bounded');
assert.match(indexHtml, /#craftSearch\{[^}]*width:100%/, 'crafting recipe book exposes a full-width recipe search');
assert.match(indexHtml, /#craft \.craftTabs\{[^}]*overflow-x:auto/, 'crafting recipe groups scroll horizontally when needed');
assert.match(indexHtml, /#craft \.craftContent\{[^}]*grid-template-columns:minmax\(210px,1fr\) minmax\(190px,\.9fr\)/, 'crafting recipe book has a recipe list plus detail panel');
assert.match(indexHtml, /#craft \.craftList\{[^}]*overflow-y:auto/, 'crafting recipe list owns vertical scrolling');

// --- resource registry: city salvage materials are tracked and placeable where intended ---
const res = key => INV.RESOURCES.find(r => r.key === key);
const resourceKeys = new Set(INV.RESOURCES.map(r => r.key));
assert.equal(resourceKeys.size, INV.RESOURCES.length, 'resource registry keys are unique');
for (const r of INV.RESOURCES) {
  assert.ok(r && typeof r.key === 'string' && r.key, 'every resource has a stable key');
  assert.ok(!r.tile || T[r.tile] != null, 'resource '+r.key+' points at a known tile id');
}
for (const [tileId, info] of Object.entries(INFO)) {
  if (info.drop) assert.ok(resourceKeys.has(info.drop), 'tile '+tileId+' drop '+info.drop+' is a registered resource');
  if (Array.isArray(info.drops)) {
    for (const d of info.drops) {
      if (d && d.item) assert.ok(resourceKeys.has(d.item), 'tile '+tileId+' drop '+d.item+' is a registered resource');
    }
  }
}
for (const jewel of INV.JEWELS) {
  const def = res(jewel.key);
  assert.ok(def && def.jewel, jewel.label + ' is a dedicated jewel resource');
  assert.equal(def.tile, null, jewel.label + ' cannot be placed as a block');
}
assert.deepEqual(INV.JEWELS.map(j => j.chance), [1, 0.7, 0.5], 'jewel success odds match the design');
assert.equal(INFO[T.COAL].drop, 'coal', 'coal blocks drop coal');
assert.equal(INFO[T.GOLD_ORE].drop, 'gold', 'gold ore blocks drop gold');
assert.equal(INFO[T.GOLD_ORE].goldOre, true, 'gold ore advertises its mineral identity');
assert.equal(INFO[T.SILVER_ORE].drop, 'silverOre', 'silver ore blocks drop raw ore for smelting');
assert.equal(INFO[T.SILVER_INGOT].drop, 'silver', 'silver ingot blocks return usable silver material');
assert.equal(INFO[T.DIRT].drop, 'dirt', 'dirt blocks drop dirt');
assert.equal(INFO[T.GRANITE].drop, 'granite', 'granite blocks drop granite');
assert.equal(INFO[T.BASALT].drop, 'basalt', 'basalt blocks drop basalt');
assert.equal(INFO[T.BEDROCK].drop, 'bedrock', 'permitted bedrock mining yields the ladder crafting resource');
assert.equal(INFO[T.CLAY].drop, 'clay', 'clay blocks drop clay');
assert.equal(INFO[T.WET_CLAY].drop, 'clay', 'wet clay recovers as clay');
assert.equal(INFO[T.BRICK].drop, 'brick', 'brick blocks drop brick');
assert.equal(INFO[T.CHIMNEY].drop, 'chimney', 'chimneys drop the chimney resource');
assert.equal(INFO[T.CHIMNEY].chimney, true, 'chimneys advertise vent semantics');
assert.equal(INFO[T.RESPAWN_TOTEM].drop, 'respawnTotem', 'respawn totems drop back into a placeable item');
assert.equal(INFO[T.RESPAWN_TOTEM].passable, true, 'respawn totems are passable fixtures');
assert.equal(INFO[T.RESPAWN_TOTEM].respawnTotem, true, 'respawn totems advertise respawn semantics');
assert.equal(INFO[T.LADDER].drop, 'ladder', 'ladders drop the ladder resource');
assert.equal(INFO[T.BEDROCK_LADDER].drop, 'bedrockLadder', 'bedrock ladders drop their own recoverable resource');
assert.equal(INFO[T.BEDROCK].unmineable, true, 'bedrock is an unmineable world boundary');
assert.equal(INFO[T.MOTHER_ICE].drop, 'motherIce', 'mother ice drops the crafting resource');
assert.equal(INFO[T.MOTHER_LAVA].drop, 'motherLava', 'mother lava drops the crafting resource');
const digOrder=[T.SAND,T.DIRT,T.STONE,T.GRANITE,T.BASALT].map(t=>INFO[t].hp);
for(let i=1;i<digOrder.length;i++){
  assert.ok(digOrder[i]>digOrder[i-1], 'geology dig difficulty increases from sand to basalt');
}
assert.equal(INFO[T.ROTTEN_MEAT].drop, 'rottenMeat', 'rotten meat blocks drop rotten meat');
assert.equal(INFO[T.BAKED_MEAT].drop, 'bakedMeat', 'baked meat blocks drop baked meat');
assert.equal(INFO[T.GLASS].drop, 'glass', 'glass blocks drop recoverable glass');
assert.equal(INFO[T.WOOD_DOOR].drop, 'woodDoor', 'wood doors drop the wood-door resource');
assert.equal(INFO[T.STONE_DOOR].drop, 'stoneDoor', 'stone doors drop the stone-door resource');
assert.equal(INFO[T.STEEL_DOOR].drop, 'steelDoor', 'steel doors drop the steel-door resource');
assert.equal(INFO[T.WOOD_TRAPDOOR].drop, 'woodTrapdoor', 'wood trapdoors drop the wood-trapdoor resource');
assert.equal(INFO[T.STONE_TRAPDOOR].drop, 'stoneTrapdoor', 'stone trapdoors drop the stone-trapdoor resource');
assert.equal(INFO[T.STEEL_TRAPDOOR].drop, 'steelTrapdoor', 'steel trapdoors drop the steel-trapdoor resource');
assert.equal(INFO[T.WOOD_DOOR].door, true, 'wood door advertises door semantics');
assert.equal(INFO[T.STONE_DOOR].door, true, 'stone door advertises door semantics');
assert.equal(INFO[T.STEEL_DOOR].door, true, 'steel door advertises door semantics');
assert.equal(INFO[T.WOOD_TRAPDOOR].trapdoor, true, 'wood trapdoor advertises trapdoor semantics');
assert.equal(INFO[T.STONE_TRAPDOOR].trapdoor, true, 'stone trapdoor advertises trapdoor semantics');
assert.equal(INFO[T.STEEL_TRAPDOOR].trapdoor, true, 'steel trapdoor advertises trapdoor semantics');
assert.equal(res('coal')?.tile, 'COAL', 'coal is a placeable mined resource');
assert.equal(res('gold')?.tile, 'GOLD_ORE', 'gold is a placeable mined ore resource');
assert.equal(res('gold')?.color, '#f2b93b', 'gold resource uses the bright vein palette');
assert.equal(res('dirt')?.tile, 'DIRT', 'dirt is a placeable mined resource');
assert.equal(res('granite')?.tile, 'GRANITE', 'granite is a placeable mined resource');
assert.equal(res('basalt')?.tile, 'BASALT', 'basalt is a placeable mined resource');
assert.equal(res('bedrock')?.tile, null, 'raw bedrock is tracked for crafting but cannot be placed as boundary terrain');
assert.equal(res('motherIce')?.tile, 'MOTHER_ICE', 'mother ice is a registered guardian-afterfall resource');
assert.equal(res('motherLava')?.tile, 'MOTHER_LAVA', 'mother lava is a registered guardian-afterfall resource');
assert.equal(res('heartAir')?.tile, null, 'Heart of Air is tracked as a non-placeable guardian trophy');
assert.equal(res('stone')?.label, 'Skala', 'stone resource is presented as rock in the new geology ladder');
assert.equal(res('arrowWood')?.tile, null, 'wood arrows are tracked as non-placeable ammo');
assert.equal(res('arrowStone')?.tile, null, 'stone arrows are tracked as non-placeable ammo');
assert.equal(res('arrowObsidian')?.tile, null, 'obsidian arrows are tracked as non-placeable ammo');
assert.equal(res('arrowDiamond')?.tile, null, 'diamond arrows are tracked as non-placeable ammo');
assert.equal(res('arrowIridium')?.tile, null, 'iridium arrows are tracked as non-placeable ammo');
assert.equal(res('meat')?.tile, 'MEAT', 'raw meat is tracked as a placeable/eatable block resource');
assert.equal(res('rottenMeat')?.tile, 'ROTTEN_MEAT', 'rotten meat is tracked separately');
assert.equal(res('bakedMeat')?.tile, 'BAKED_MEAT', 'baked meat is tracked separately');
assert.equal(res('glass')?.tile, 'GLASS', 'glass is tracked as a placeable/recoverable resource');
assert.equal(res('clay')?.tile, 'CLAY', 'clay is tracked as a primary placeable resource');
assert.equal(res('brick')?.tile, 'BRICK', 'brick is tracked as a fired ceramic building resource');
assert.equal(res('chimney')?.tile, 'CHIMNEY', 'chimneys are tracked as craftable vent blocks');
assert.equal(res('respawnTotem')?.tile, 'RESPAWN_TOTEM', 'respawn totems are tracked as craftable placeable fixtures');
assert.equal(res('ladder')?.tile, 'LADDER', 'ladder is tracked as a placeable climbing fixture');
assert.equal(res('bedrockLadder')?.tile, 'BEDROCK_LADDER', 'bedrock ladder is a distinct placeable climbing fixture');
assert.equal(res('woodDoor')?.tile, 'WOOD_DOOR', 'wood door is a craftable placeable resource');
assert.equal(res('stoneDoor')?.tile, 'STONE_DOOR', 'stone door is a craftable placeable resource');
assert.equal(res('steelDoor')?.tile, 'STEEL_DOOR', 'steel door is a craftable placeable resource');
assert.equal(res('woodTrapdoor')?.tile, 'WOOD_TRAPDOOR', 'wood trapdoor is a craftable placeable resource');
assert.equal(res('stoneTrapdoor')?.tile, 'STONE_TRAPDOOR', 'stone trapdoor is a craftable placeable resource');
assert.equal(res('steelTrapdoor')?.tile, 'STEEL_TRAPDOOR', 'steel trapdoor is a craftable placeable resource');
assert.equal(res('track')?.tile, 'TRACK', 'track is a craftable placeable crawler resource');
assert.equal(INFO[T.TRACK].drop, 'track', 'track blocks drop back into the placeable track resource');
assert.equal(res('wire')?.tile, 'WIRE', 'wire is a placeable salvaged resource');
assert.equal(res('plastic')?.tile, null, 'plastic is tracked as a non-placeable component');
assert.equal(res('copper')?.tile, null, 'copper is tracked as a non-placeable component');
assert.equal(res('copperWire')?.tile, 'COPPER_WIRE', 'copper wire is a placeable power cable resource');
assert.equal(res('silverOre')?.tile, 'SILVER_ORE', 'silver ore is a placeable smelting resource');
assert.equal(res('silver')?.tile, 'SILVER_INGOT', 'silver ingots are tracked separately from raw ore');
assert.equal(res('silverWire')?.tile, 'SILVER_WIRE', 'silver wire is a placeable high-conductivity cable resource');
assert.equal(res('transistor')?.tile, 'TRANSISTOR', 'transistor is placeable for block-reaction assemblies');
assert.equal(res('dynamo')?.tile, 'DYNAMO', 'dynamo is a craftable placeable machine resource');
assert.equal(res('solarPanel')?.tile, 'SOLAR_PANEL', 'solar panel is a craftable placeable power-source resource');
assert.equal(res('solarBattery')?.tile, 'SOLAR_BATTERY', 'solar battery panel is a craftable placeable storage resource');
assert.equal(res('teleporter')?.tile, 'TELEPORTER', 'teleporter is a placeable machine resource');
assert.equal(res('vendingMachine')?.tile, 'VENDING_MACHINE', 'vending machine is a collectable/placeable powered appliance resource');
assert.equal(res('antigravityBeacon')?.tile, 'ANTIGRAVITY_BEACON', 'antigravity beacon is a placeable machine resource');
assert.equal(res('meteorSiren')?.tile, 'METEOR_SIREN', 'meteor siren is a placeable alert machine resource');
assert.equal(res('craterScanner')?.tile, null, 'crater scanner is tracked as a non-placeable science tool');
assert.equal(res('radioactiveOre')?.tile, 'RADIOACTIVE_ORE', 'radioactive meteor ore is placeable after collection');
assert.equal(res('alienBiomass')?.tile, 'ALIEN_BIOMASS', 'alien biomass is placeable after collection');
assert.equal(res('meteorDust')?.tile, 'METEOR_DUST', 'meteor dust is tracked as strange residue');
assert.equal(res('antimatter')?.tile, 'ANTIMATTER_CRYSTAL', 'antimatter is placeable as rare meteor crystal matter');
assert.equal(res('turret')?.tile, 'TURRET', 'basic turret is a placeable defensive machine resource');
assert.equal(res('fireTurret')?.tile, 'FIRE_TURRET', 'fire turret is a placeable defensive machine resource');
assert.equal(res('waterTurret')?.tile, 'WATER_TURRET', 'water turret is a placeable defensive machine resource');
assert.equal(res('springPlatform')?.tile, 'SPRING_PLATFORM', 'spring platform is a craftable placeable movement machine');
assert.equal(res('springAntler')?.tile, null, 'spring hallmark antlers are tracked as a non-placeable trophy');
assert.equal(res('summerHorn')?.tile, null, 'summer hallmark horn is tracked as a non-placeable trophy');
assert.equal(res('autumnHeartwood')?.tile, null, 'autumn hallmark heartwood is tracked as a non-placeable trophy');
assert.equal(res('winterFur')?.tile, null, 'winter hallmark fur is tracked as a non-placeable trophy');
assert.equal(INFO[T.DYNAMO_SLOT].passable, true, 'dynamo slot is passable for the hero and machine flow');
assert.equal(INFO[T.LADDER].passable, true, 'ladders are passable climbing fixtures');
assert.equal(INFO[T.LADDER].ladder, true, 'ladders advertise ladder movement semantics');
assert.equal(INFO[T.BEDROCK_LADDER].passable, true, 'bedrock ladders remain passable climbing fixtures');
assert.equal(INFO[T.BEDROCK_LADDER].ladder, true, 'bedrock ladders advertise shared ladder movement semantics');
assert.equal(INFO[T.BEDROCK_LADDER].bedrockLadder, true, 'bedrock ladders advertise their one-end-support identity');
assert.equal(INFO[T.COPPER_WIRE].drop, 'copperWire', 'copper wire drops itself when dismantled');
assert.equal(INFO[T.COPPER_WIRE].conductor, true, 'copper wire is marked as an energy conductor');
assert.equal(INFO[T.SILVER_WIRE].drop, 'silverWire', 'silver wire drops itself when dismantled');
assert.equal(INFO[T.SILVER_WIRE].conductivity, 1, 'silver wire advertises lossless conductivity');
assert.equal(INFO[T.COPPER_WIRE].conductivity, 0.5, 'copper wire advertises its transmission loss');
assert.equal(INFO[T.TELEPORTER].machine, 'teleporter', 'teleporter tile is marked as a machine');
assert.equal(INFO[T.TELEPORTER].powerDevice, true, 'teleporter is marked as a powered device');
assert.equal(INFO[T.VENDING_MACHINE].machine, 'vendingMachine', 'vending machine tile is marked as a machine');
assert.equal(INFO[T.VENDING_MACHINE].powerDevice, true, 'vending machine is marked as a powered device');
assert.equal(INFO[T.VENDING_MACHINE].drop, 'vendingMachine', 'vending machine can be salvaged and placed again');
assert.ok(INFO[T.VENDING_MACHINE].drops.some(d=>d.item==='copperWire'), 'vending machine dismantles into copper wiring');
assert.ok(INFO[T.VENDING_MACHINE].drops.some(d=>d.item==='waterPipe'), 'vending machine can yield water pipes');
assert.equal(INFO[T.ANTIGRAVITY_BEACON].meteorShield, true, 'antigravity beacon is marked as a meteor shield');
assert.equal(INFO[T.METEOR_SIREN].meteorSiren, true, 'meteor siren is marked as a meteor alert machine');
assert.equal(INFO[T.RADIOACTIVE_ORE].radioactive, true, 'radioactive ore advertises its hazard type');
assert.equal(INFO[T.ALIEN_BIOMASS].biological, true, 'alien biomass advertises its biological origin');
assert.equal(INFO[T.METEOR_DUST].dust, true, 'meteor dust advertises its strange residue role');
assert.equal(INFO[T.ANTIMATTER_CRYSTAL].antimatter, true, 'antimatter crystal advertises antimatter origin');
assert.equal(INFO[T.TURRET].powerDevice, true, 'basic turret is marked as a powered device');
assert.equal(INFO[T.FIRE_TURRET].powerDevice, true, 'fire turret is marked as a powered device');
assert.equal(INFO[T.WATER_TURRET].powerDevice, true, 'water turret is marked as a powered device');
assert.equal(INFO[T.SPRING_PLATFORM].powerDevice, true, 'spring platform is marked as a powered device');
assert.equal(INFO[T.SPRING_PLATFORM].energyCapacity, 70, 'spring platform advertises its battery capacity');
assert.equal(INFO[T.DYNAMO].powerSource, true, 'dynamo casing is marked as a power source');
assert.equal(INFO[T.SOLAR_PANEL].drop, 'solarPanel', 'solar panels can be recovered as placeable resources');
assert.equal(INFO[T.SOLAR_BATTERY].drop, 'solarBattery', 'solar battery panels can be recovered as placeable resources');
assert.equal(INFO[T.SOLAR_PANEL].powerSource, true, 'solar panel is marked as a power source');
assert.equal(INFO[T.SOLAR_BATTERY].energyCapacity, 120, 'storage solar panel advertises its battery capacity');
assert.match(mainSrc, /id:'solar_panel'/, 'crafting exposes solar panels outside the debug menu');
assert.match(mainSrc, /id:'solar_battery'/, 'crafting exposes solar battery panels outside the debug menu');
assert.match(mainSrc, /id:'spring_platform'/, 'crafting exposes spring platforms outside the debug menu');
assert.match(mainSrc, /id:'silver_wire'[^\n]*cost:\{silver:2, plastic:1\}/, 'crafting converts silver ingots into four silver-wire segments');
assert.match(mainSrc, /id:'ladders'/, 'crafting exposes ladders outside the debug menu');
assert.match(mainSrc, /id:'bedrock_ladders'[^\n]*cost:\{bedrock:1\}/, 'crafting turns one mined bedrock into bedrock ladders');
assert.match(mainSrc, /inv\.bedrockLadder\+=6/, 'bedrock ladder recipe yields six fixtures');
assert.match(mainSrc, /tiles:\['DYNAMO','SOLAR_PANEL','SOLAR_BATTERY','SPRING_PLATFORM'/, 'hotbar machine group includes solar panels and spring platforms');
assert.match(mainSrc, /tiles:\['WIRE','COPPER_WIRE','SILVER_WIRE','WATER_PIPE','LADDER'/, 'hotbar utility group includes both cable materials and ladders');
assert.match(mainSrc, /'LADDER','BEDROCK_LADDER'/, 'hotbar utility group exposes both ladder materials');
assert.match(mainSrc, /tiles:\['WIRE','COPPER_WIRE','SILVER_WIRE','WATER_PIPE','LADDER'[\s\S]*'RESPAWN_TOTEM'\]/, 'hotbar utility group includes respawn totems');
assert.match(mainSrc, /function selectToolMode\(opts\)\{[\s\S]*INV\.unequip\('weapon'\)[\s\S]*updateWeaponBar\(\)/, 'selecting build mode holsters the active weapon and refreshes the weapon bar');
assert.match(mainSrc, /function cycleHotbar\(idx,opts\)\{[\s\S]*selectToolMode\(\{quiet:true\}\)[\s\S]*updateHotbarSel\(\)/, 'choosing a hotbar resource immediately returns to pickaxe/build mode');
assert.match(mainSrc, /const preview=\(c && INV\.selectedWeaponForCategory\)\? INV\.selectedWeaponForCategory\(c\.id\)/, 'inactive weapon HUD slots display their remembered selection');
assert.match(mainSrc, /assign\(slot,key\)\{[\s\S]*HOTBAR_ORDER\[slot\]=key; cycleHotbar\(slot\);/, 'inventory resource assignment goes through the hotbar selector');

// --- crafting-panel drag&drop onto hotbar slots (engine/craft_drag.js) ------
const craftDragSrc = readFileSync(new URL('../src/engine/craft_drag.js', import.meta.url), 'utf8');
assert.match(craftDragSrc, /elementFromPoint\(x,y\)[\s\S]{0,120}closest\('\.hotSlot'\)/, 'drop targeting hit-tests the real hotbar slot under the pointer');
assert.match(craftDragSrc, /#craftDragGhost\{[^}]*pointer-events:none/, 'drag ghost never blocks drop hit-testing');
assert.match(craftDragSrc, /\.craftDragHandle\{[^}]*touch-action:none/, 'drag handles opt out of native panning so touch can drag');
assert.ok(!/\.innerHTML\s*=/.test(craftDragSrc), 'drag layer renders text via textContent only');
assert.match(mainSrc, /assign\(slot,item\)\{ if\(!\(MM\.hotbar && MM\.hotbar\.assign\(slot,item\.k\)\)\) return false;/, 'craft drag drops flow through the validated MM.hotbar.assign bridge');
assert.match(mainSrc, /function craftPlaceableDef\(k\)\{[\s\S]{0,80}RESOURCE_DEFS\.find\(res=>res\.key===k && res\.tile\)/, 'craft panel resolves placeable resources through the resource registry');
assert.match(mainSrc, /const placeable=craftPlaceableDef\(k\);/, 'ingredient rows expose placeable resources as tile drag handles');
assert.match(mainSrc, /className='craftHotDrop'/, 'craft detail shows a drag-to-hotbar card for placeable outputs');
assert.match(indexHtml, /#craft \.craftHotDrop\{[^}]*border:1px dashed/, 'output drag card advertises its drop affordance');

// --- unified drag + quick-craft across picker & inventory -------------------
const hotPickerSrc = readFileSync(new URL('../src/engine/hot_picker.js', import.meta.url), 'utf8');
const invUiSrc = readFileSync(new URL('../src/inventory_ui.js', import.meta.url), 'utf8');
// quick-craft bridge: reuses the discovery map AND re-applies the panel's own
// unlock+ban predicate — a "+" never crafts a recipe the player hasn't earned.
assert.match(mainSrc, /MM\.craftInfoForResource=function/, 'main exposes the quick-craft info bridge');
assert.match(mainSrc, /MM\.quickCraftResource=function/, 'main exposes the quick-craft action bridge');
assert.match(mainSrc, /MM\.craftInfoForTile=function[\s\S]*RESOURCE_DEFS\.find\(r=>r\.tile===tileName\)/, 'tile-name quick-craft resolves through the resource registry');
assert.match(mainSrc, /function bestCraftRecipeForResource\(resKey\)\{[\s\S]*CRAFT_RESULT_KEY_RECIPES\.get\(String\(resKey/, 'quick-craft reuses the resource→recipe discovery map');
assert.match(mainSrc, /function bestCraftRecipeForResource[\s\S]*const known=list\.filter\(craftRecipeVisible\)/, 'quick-craft only offers discovered, non-banned recipes (same gate as the panel)');
// picker wiring: shared drag layer, per-card "+", persisted owned-only toggle
assert.ok(mainSrc.indexOf('const CRAFTDRAG=createCraftDrag') < mainSrc.indexOf('const HOTPICKER=createHotPicker'), 'drag layer is created before the picker so cards can reuse it');
assert.match(mainSrc, /makeDraggable:\(el,itemFn\)=> CRAFTDRAG && CRAFTDRAG\.makeDraggable\(el,itemFn\)/, 'picker cards reuse the shared hotbar drag layer');
assert.match(mainSrc, /quickCraft:item=>\{ const ok=MM\.quickCraftTile\(item\.k\); if\(ok\) updateHotbarCounts\(\); return ok; \}/, 'picker "+" crafts and refreshes the HUD counts');
assert.match(mainSrc, /ownedOnlyKey:'mm_hotbar_owned_only_v1'/, 'picker exposes a persisted owned-only toggle');
assert.match(mainSrc, /assign\(slot,item\)\{ HOTBAR_ORDER\[slot\]=item\.k; cycleHotbar\(slot\);/, 'picker click-assign still routes through HOTBAR_ORDER + cycleHotbar');
// hot_picker module: icon is the drag handle (small target keeps grid scroll)
assert.match(hotPickerSrc, /const makeDraggable=typeof deps\.makeDraggable==='function'/, 'picker accepts an optional drag layer');
assert.match(hotPickerSrc, /makeDraggable\(icon,\(\)=>\(\{k:item\.k,label:item\.label,col:item\.col\}\)\)/, 'the tile ICON (not the whole card) is the drag handle');
assert.match(hotPickerSrc, /className='mmQuickCraft hpQuickCraft'/, 'picker cards carry the shared quick-craft chip');
assert.match(hotPickerSrc, /function ownedVisible\(items\)\{[\s\S]*info\.n>0 \|\| info\.text==='∞'/, 'owned-only filter keeps infinities (god) and held stacks');
// inventory resources tab: drag handle, "+", persisted owned-only toggle
assert.match(invUiSrc, /MM\.craftDrag\.makeDraggable\(dot,\(\)=>\(\{k:r\.tile/, 'inventory resource swatch is a hotbar drag handle');
assert.match(invUiSrc, /MM\.quickCraftResource\(r\.key\)/, 'inventory "+" crafts through the shared quick-craft bridge');
assert.match(invUiSrc, /const INV_OWNED_ONLY_KEY='mm_inv_owned_only_v1'/, 'inventory owned-only toggle persists');
assert.match(invUiSrc, /if\(ownedOnly\) list=list\.filter\(r=>r\.count>0\)/, 'owned-only keeps only stacks above zero');
// CSS: overlay pass-through (inventory modal sits ABOVE #ui and cannot be
// out-z-indexed) + hotbar raised above the picker during any tile drag.
assert.match(indexHtml, /body\.mmTileDrag #invOverlay\{[^}]*pointer-events:none/, 'inventory overlay turns pointer-transparent mid-drag so drops fall through to the hotbar');
assert.match(indexHtml, /body\.mmTileDrag #hotbarWrap\{[^}]*z-index:1100/, 'hotbar rises above the picker popover during a drag');
assert.match(indexHtml, /\.mmQuickCraft\{/, 'shared quick-craft chip has base styling');
assert.match(mainSrc, /function collectLooseItemAt\(tx,ty,opts\)\{[\s\S]*isLooseItemTile\(t\)[\s\S]*const dropCtx=dropContextForTile\(t,tx,ty\);[\s\S]*setForegroundConfirmed\(tx,ty,T\.AIR\)[\s\S]*const drops=awardTileDrops\(info,dropCtx\);[\s\S]*pushUndo\(tx,ty,t,T\.AIR,'break',drops\);[\s\S]*updateInventory\(\);/, 'loose item collection confirms removal before drops, undo, and inventory refresh');
assert.match(mainSrc, /function tryEatWorldFoodAt\(tx,ty\)[\s\S]*Consuming world food is not a reversible tile edit[\s\S]*setForegroundConfirmed\(tx,ty,T\.AIR\)/,
  'consumed world food is not restorable without rolling back its already-applied health and status effects');
assert.match(mainSrc, /MM\.collectLooseItemAt=collectLooseItemAt;/, 'main exposes loose item collection for weapon hits');
assert.match(weaponsSrc, /function collectLooseTarget\(tx,ty\)\{[\s\S]*MM\.collectLooseItemAt\(tx,ty,\{source:'melee_weapon',silent:true\}\)/, 'melee weapons delegate loose item hits to the shared collection helper');
assert.match(weaponsSrc, /function fireMelee\(player, aimX, aimY, opts\)\{[\s\S]*const chestHit=openChestFromWeaponHit\(tx\+0\.5,ty\+0\.5,[\s\S]*const collected=chestHit \? false : collectLooseTarget\(tx,ty\);[\s\S]*const hit=chestHit \|\| collected/, 'normal and hold-charged melee swings open physical chests first and still count loose item collection as a hit');
assert.match(weaponsSrc, /function firePowerMelee\(player, aimX, aimY, w, charge\)\{[\s\S]*const chestHit=openChestFromWeaponHit\(tx\+0\.5,ty\+0\.5,[\s\S]*const collected=chestHit \? false : collectLooseTarget\(tx,ty\);[\s\S]*hit = !!\(chestHit \|\| collected \|\|/, 'charged melee swings open physical chests first and can also collect loose items');

// --- percent ladder snapping ---------------------------------------------
assert.equal(INV.snapPct(1), 0, 'noise under 2.5% disappears');
assert.equal(INV.snapPct(3), 5);
assert.equal(INV.snapPct(7), 5);
assert.equal(INV.snapPct(13), 15);
assert.equal(INV.snapPct(22), 20);
assert.equal(INV.snapPct(-7), -5, 'maluses snap symmetrically');
assert.equal(INV.snapPct(62), 60, '10-steps between 50 and 100');
assert.equal(INV.snapPct(140), 150, '25-steps above 100');
assert.equal(INV.snapPct(500), 200, 'hard cap at 200%');

// --- stat chips: function purity — one job stat per item ------------------
const chipTexts = id => INV.statChips(INV.getItem(id)).map(c => c.text);
assert.deepEqual(chipTexts('ninja'), ['+20%'], 'ninja outfit carries exactly its movement profile');
assert.deepEqual(chipTexts('sleepy'), ['-30%'], 'sleepy eyes carry only vision (as percent of base 10)');
assert.deepEqual(chipTexts('miner'), ['+50%'], 'miner outfit carries only its mining profile');
assert.deepEqual(chipTexts('ironperson'), ['+2'], 'iron outfit carries only crush resist');
assert.deepEqual(INV.statChips(INV.getItem('stone_blade')).map(c=>c.label), ['Obrażenia'], 'melee weapon carries damage and nothing else');
assert.deepEqual(chipTexts('triangle'), ['+1'], 'cape carries only its air jumps');
assert.ok(INV.statChips(INV.getItem('bow_wood')).some(c => c.text.endsWith('/s')), 'bow shows fire rate');
assert.equal((INV.weaponCategory(INV.getItem('electric_gun')) || {}).id, 'stream', 'electric gun maps to stream category');
assert.ok(INV.statChips(INV.getItem('electric_gun')).some(c => c.label === 'Wiązka' && c.text.endsWith('/s')), 'electric gun shows beam damage');
assert.ok(INV.statChips(INV.getItem('electric_gun')).some(c => c.label === 'Zużycie energii' && c.text.endsWith('/s')), 'electric gun shows energy drain');
assert.equal(INV.STAT_LABELS.energyCapacityBonus, 'Pojemność energii', 'energy capacity has a player-facing stat label');
assert.equal(INV.STAT_RULES.energyCapacityBonus, 'sum', 'energy capacity stacks additively');
assert.equal(INV.STAT_LABELS.lootMagnetLevel, 'Auto-zbieranie łupów', 'loot magnet has a player-facing stat label');
assert.equal(INV.STAT_RULES.lootMagnetLevel, 'max', 'multiple loot magnets use only the best range');
assert.equal(INV.STAT_LABELS.treasureSenseLevel, 'Kompas skarbów', 'treasure compass has a player-facing stat label');
assert.equal(INV.STAT_RULES.treasureSenseLevel, 'max', 'treasure sensing uses only the best equipped range');
assert.equal(INV.STAT_RULES.specialVisionLevel, 'max', 'special optics use a capped best level');
assert.equal(INV.registerItem({id:'compass_charm_test', kind:'charm', name:'Kompas testowy', treasureSenseLevel:3}), true, 'charms may carry treasure sensing');
assert.equal(INV.registerItem({id:'thermal_eyes_test', kind:'eyes', name:'Termowizor testowy', specialVisionLevel:3, visionMode:'thermal'}), true, 'eyes may carry validated thermal vision');
assert.ok(INV.statChips(INV.getItem('compass_charm_test')).some(c => c.label === 'Kompas skarbów' && c.text.includes('36 bloków')), 'treasure range is explicit on its item chip');
assert.ok(INV.statChips(INV.getItem('thermal_eyes_test')).some(c => c.label === 'Termowizja' && c.text === 'poziom 3'), 'thermal mode and level are explicit on its item chip');
INV.equip('compass_charm_test');
assert.equal(globalThis.MM.activeModifiers.treasureSenseLevel, 3, 'equipped treasure charm contributes its bounded scan level');
INV.unequip('charm');
INV.equip('thermal_eyes_test');
assert.equal(globalThis.MM.activeModifiers.specialVisionLevel, 3, 'equipped optics contribute special-vision level');
INV.equip('bright');
assert.equal(INV.registerItem({id:'magnet_outfit_test', kind:'outfit', name:'Strój zbieracza testowy', lootMagnetLevel:2}), true, 'outfits may carry auto-loot range');
assert.equal(INV.registerItem({id:'magnet_charm_test', kind:'charm', name:'Wisiorek zbieracza testowy', lootMagnetLevel:4}), true, 'charms may carry auto-loot range');
assert.ok(INV.statChips(INV.getItem('magnet_charm_test')).some(c => c.label === 'Auto-zbieranie' && c.text === 'promień +3 bloki'), 'loot magnet range is explicit on the item chip');
INV.equip('magnet_outfit_test');
INV.equip('magnet_charm_test');
assert.equal(globalThis.MM.activeModifiers.lootMagnetLevel, 4, 'best equipped loot magnet wins instead of ranges stacking');
INV.unequip('charm');
assert.equal(globalThis.MM.activeModifiers.lootMagnetLevel, 2, 'outfit magnet remains active after removing the stronger charm');
INV.equip('default');
assert.equal(globalThis.MM.activeModifiers.lootMagnetLevel, 0, 'auto-loot is off without matching equipment');
assert.equal(INV.STAT_RULES.damageReductionBonus, 'sum', 'passive defense stacks additively before its safety cap');
assert.equal(INV.registerItem({id:'battery_charm_test', kind:'charm', name:'Akumulator testowy', energyCapacityBonus:50}), true, 'energy capacity loot is registerable');
assert.ok(INV.statChips(INV.getItem('battery_charm_test')).some(c => c.text === '+50E'), 'energy capacity appears as a stat chip');
INV.equip('battery_charm_test');
assert.equal(globalThis.MM.activeModifiers.energyCapacityBonus, 50, 'equipped capacity item contributes to modifiers');
INV.unequip('charm');
assert.equal(INV.STAT_LABELS.waterMoveSpeedMult, 'Ruch w wodzie', 'water movement has a player-facing stat label');
assert.equal(INV.STAT_RULES.waterMoveSpeedMult, 'max', 'water movement keeps the best available value');
assert.equal(globalThis.MM.activeModifiers.waterMoveSpeedMult, 0.5, 'default hero moves at half speed in water');
assert.equal(INV.registerItem({id:'swim_charm_test', kind:'charm', name:'Pływak testowy', waterMoveSpeedMult:1}), true, 'water movement loot is registerable');
assert.ok(INV.statChips(INV.getItem('swim_charm_test')).some(c => c.label === 'Ruch w wodzie' && c.text === '100%'), 'water movement appears as a stat chip');
INV.equip('swim_charm_test');
assert.equal(globalThis.MM.activeModifiers.waterMoveSpeedMult, 1, 'equipped swim charm contributes to modifiers');
INV.unequip('charm');
const questRewardSnap = INV.snapshot();
const questBow = {id:'quest_bow_test', kind:'weapon', weaponType:'bow', name:'Quest Bow', attackDamage:4, fireCooldown:0.5, desc:'Test reward bow'};
assert.equal(INV.grantItem(questBow,{equip:true,markNew:true}), true, 'quest rewards can grant and equip new loot');
assert.ok(INV.bagItems().some(i => i.id === 'quest_bow_test'), 'granted quest reward is stored in the loot bag');
assert.equal(INV.equippedId('weapon'), 'quest_bow_test', 'grantItem can equip the reward immediately');
assert.equal(INV.isNew('quest_bow_test'), false, 'equipped quest reward is treated as acknowledged');
assert.equal(INV.grantItem(questBow,{equip:true}), true, 'grantItem is idempotent for already owned rewards');
assert.equal(INV.bagItems().filter(i => i.id === 'quest_bow_test').length, 1, 'grantItem does not duplicate an owned reward');
assert.equal(INV.grantItem({id:'quest_charm_test', kind:'charm', name:'Quest Charm', mineSpeedMult:1.05},{markNew:true}), true, 'quest rewards can be granted without auto-equip');
assert.equal(INV.isNew('quest_charm_test'), true, 'unequipped quest reward is marked new for review');
INV.restore(questRewardSnap, { persist: false, silent: true });

// --- power score: intuitive ordering within a kind ------------------------
const s = id => INV.itemScore(INV.getItem(id));
assert.ok(s('classic') < s('tattered'), 'capes: classic < tattered');
assert.ok(s('tattered') <= s('triangle'), 'capes: tattered <= triangle (same jump count, cosmetic variants)');
assert.ok(s('triangle') < s('shadow'), 'capes: triangle < shadow');
assert.ok(s('shadow') < s('royal'), 'capes: shadow < royal');
assert.ok(s('royal') <= s('winged'), 'capes: royal <= winged');
assert.ok(s('stick') < s('spear'), 'melee: stick < spear');
assert.ok(s('spear') < s('stone_blade'), 'melee: spear < stone blade (pure damage ladder)');
assert.ok(s('sleepy') < s('bright') && s('bright') < s('glow'), 'eyes ordered by quality');
assert.ok(s('ironperson') > 0, 'crush resist counts toward the power score');

// --- legacy dirty loot: off-function stats strip, function stats normalize ---
globalThis.MM.dynamicLoot = { weapons: [
  { id: 'w_dirty', kind: 'weapon', weaponType: 'melee', name: 'Test', attackDamage: 4, moveSpeedMult: 1.0437, jumpPowerMult: 1.137, tier: 'rare' },
  { id: 'w_electric', kind: 'weapon', weaponType: 'electric', name: 'Beam', fireDps:10, fireRange:8, energyCost:11, tier:'rare' }
], outfits: [
  { id: 'o_dirty', kind: 'outfit', name: 'Old Suit', mineSpeedMult: 1.35, moveSpeedMult: 0.9, jumpPowerMult: 1.1, visionRadius: 12, tier: 'rare' }
], charms: [
  { id: 'battery_dynamic', kind: 'charm', name: 'Alien Battery', energyCapacityBonus:75, visionRadius:14, tier:'epic' }
] };
window.updateDynamicCustomization();
const dirty = INV.getItem('w_dirty');
assert.equal(dirty.attackDamage, 4, 'melee loot keeps its damage');
assert.equal(dirty.moveSpeedMult, undefined, 'melee loot sheds off-function move stat (one-shot save migration)');
assert.equal(dirty.jumpPowerMult, undefined, 'melee loot sheds off-function jump stat');
const dirtyOutfit = INV.getItem('o_dirty');
assert.equal(dirtyOutfit.mineSpeedMult, 1.35, 'legacy multi-stat outfit keeps its strongest-priority profile stat');
assert.equal(dirtyOutfit.moveSpeedMult, undefined, 'legacy outfit sheds the second profile stat');
assert.equal(dirtyOutfit.jumpPowerMult, undefined, 'legacy outfit sheds the third profile stat');
assert.equal(dirtyOutfit.visionRadius, undefined, 'outfits never carry vision');
assert.equal(INV.getItem('battery_dynamic').visionRadius, undefined, 'charms never carry vision');
assert.equal(INV.getItem('w_electric').energyCost, 11, 'electric loot keeps energyCost through sanitization');
assert.equal(INV.getItem('battery_dynamic').energyCapacityBonus, 75, 'dynamic loot keeps energy capacity through sanitization');
assert.equal(INV.isNew('battery_dynamic'), true, 'fresh dynamic loot is marked new');
assert.ok(INV.newItems().some(i => i.id === 'battery_dynamic'), 'fresh dynamic loot is listed for review');
const batteryCmp = INV.compareItem('battery_dynamic');
assert.equal(batteryCmp.verdict, 'newBest', 'strong new charm is flagged as the best comparable item');
assert.ok(batteryCmp.bestDelta > 0, 'new charm compares against the best existing charm');
INV.equip('stone_blade');
const dirtyCmp = INV.compareItem('w_dirty');
assert.equal(dirtyCmp.equippedComparable, true, 'same-role weapon compares against equipped weapon');
assert.ok(dirtyCmp.equippedDelta > 0, 'new weapon shows upgrade over equipped weapon');
assert.ok(mainSrc.includes('function notifyFreshLoot(fresh)'), 'fresh loot has a brief comparison notification hook');
assert.ok(mainSrc.includes('INV.compareItem(it.id)'), 'fresh loot notification reuses inventory comparison data');
assert.ok(mainSrc.includes('cmp.equippedComparable && cmp.equippedDelta!=null'), 'fresh loot notification reports the equipped-item delta when comparable');
assert.ok(mainSrc.includes("msg('Nowy przedmiot: '+lootNoticeName(top.item)+lootNoticeSuffix(top.cmp)+extra)"), 'fresh loot notification shows item name plus worn-item difference');
assert.ok(mainSrc.includes('notifyFreshLoot(fresh);'), 'fresh inbox additions trigger the loot comparison notification');
INV.unequip('weapon');
INV.markSeen('battery_dynamic');
assert.equal(INV.isNew('battery_dynamic'), false, 'acknowledged loot loses the new marker');

// --- capacity guard: full bags refuse overflow instead of evicting loot ----
const capacitySnap = INV.snapshot();
const dynamicLootSnap = JSON.parse(JSON.stringify(globalThis.MM.dynamicLoot));
const maxBag = INV.capacity().max;
globalThis.MM.dynamicLoot = {
  capes: [], eyes: [], outfits: [], weapons: [],
  charms: Array.from({ length: maxBag + 2 }, (_, i) => ({
    id: 'bulk_'+i, kind: 'charm', name: 'Bulk '+i, tier: 'common', mineSpeedMult: 1.05
  }))
};
const fullBagSync = window.updateDynamicCustomization();
assert.equal(INV.capacity().used, maxBag, 'bag fills exactly to capacity');
assert.ok(fullBagSync.blocked > 0, 'capacity overflow is reported to callers');
assert.ok(INV.getItem('bulk_0'), 'first overflow-test item is retained');
assert.equal(INV.getItem('bulk_'+(maxBag + 1)), null, 'overflow item is refused, not silently inserted');
assert.equal(INV.capacity().full, true, 'capacity reports full state');
const essentialBow = {id:'essential_bow_test', kind:'weapon', weaponType:'bow', name:'Essential Bow', attackDamage:4, fireCooldown:0.5};
assert.equal(INV.grantItem(essentialBow,{equip:true,essential:true}), true, 'essential quest rewards bypass a full ordinary loot bag');
assert.ok(INV.getItem('essential_bow_test'), 'essential quest reward is retained even when the bag is full');
assert.equal(INV.equippedId('weapon'), 'essential_bow_test', 'essential quest reward can still equip immediately');
assert.equal(INV.capacity().used, maxBag+1, 'essential quest reward may exceed the ordinary bag cap by one item');
INV.restore(capacitySnap, { persist: false, silent: true });
globalThis.MM.dynamicLoot = dynamicLootSnap;

// --- shortcut category cycling: strongest first, opt-out respected --------
// melee by score: w_dirty(36) > stone_blade(15) >= spear(15) > stick(6)
const shortcutStart=INV.snapshot();
shortcutStart.equipped.weapon=null;
shortcutStart.shortcutSelection={};
INV.restore(shortcutStart,{persist:false,silent:true});
assert.equal(INV.cycleWeaponCategory('melee').id, 'w_dirty', 'first press = strongest enabled melee');
assert.equal(INV.cycleWeaponCategory('melee').id, 'stone_blade', 'second press = next strongest');
INV.setShortcut('stone_blade', false);
INV.unequip('weapon');
assert.equal(INV.cycleWeaponCategory('melee').id, 'w_dirty');
assert.equal(INV.cycleWeaponCategory('melee').id, 'spear', 'opted-out weapon is skipped');
INV.setShortcut('stone_blade', true);
assert.equal(INV.cycleWeaponCategory('bow').id, 'bow_wood', 'ranged category reachable (bow first: throws rank below any real bow)');
// The ranged slot rotates bows AND hand-thrown techniques, strongest first
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_stone', 'second press rotates into the heaviest throw');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_toxic', 'third press = toxic snowballs');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_sticky', 'fourth press = sticky bombs');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_snowball', 'fifth press = plain snowballs');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_balloon', 'sixth press = water balloons');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_gas', 'seventh press = gas grenades');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_spit', 'eighth press = damaging saliva');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_sand', 'ninth press = damage-free sand utility');
assert.equal(INV.cycleWeaponCategory('bow').id, 'bow_wood', 'rotation wraps back to the bow');
// Session memory: after leaving for melee, the ranged key returns to the LAST
// USED ranged weapon instead of restarting at the strongest.
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_stone', 'advance to a thrown weapon');
INV.cycleWeaponCategory('melee');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_stone', 're-entering the ranged slot restores the last-used weapon');
assert.equal(INV.selectedWeaponForCategory('bow').id, 'throw_stone', 'inactive ranged HUD content stays on the remembered weapon');
const shortcutMemory=INV.snapshot();
assert.equal(shortcutMemory.shortcutSelection.bow, 'throw_stone', 'shortcut selection is persisted independently of the active slot');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_toxic', 'same active slot still rotates on a repeated press');
INV.restore(shortcutMemory,{persist:false,silent:true});
INV.unequip('weapon');
assert.equal(INV.selectedWeaponForCategory('bow').id, 'throw_stone', 'saved ranged slot content survives reload while tools are active');
assert.equal(INV.cycleWeaponCategory('bow').id, 'throw_stone', 'first press after reload restores without advancing');
const THROW_IDS=['throw_stone','throw_toxic','throw_sticky','throw_snowball','throw_balloon','throw_gas','throw_sand','throw_spit'];
INV.setShortcut('bow_wood', false);
THROW_IDS.forEach(id => INV.setShortcut(id, false));
INV.unequip('weapon');
assert.equal(INV.cycleWeaponCategory('bow'), null, 'empty category yields null');
INV.setShortcut('bow_wood', true);
THROW_IDS.forEach(id => INV.setShortcut(id, true));
assert.equal((INV.weaponCategory(INV.getItem('flamethrower')) || {}).id, 'stream', 'flame maps to stream category');
assert.equal((INV.weaponCategory(INV.getItem('electric_gun')) || {}).id, 'stream', 'electric maps to stream category');
INV.unequip('weapon');
assert.equal(INV.cycleWeaponCategory('stream').id, 'electric_gun', 'stream shortcut reaches the strongest electric gun first');
INV.setShortcut('electric_gun', false);
INV.unequip('weapon');
assert.notEqual(INV.cycleWeaponCategory('stream')?.id, 'electric_gun', 'electric gun can be opted out of stream cycling');
INV.setShortcut('electric_gun', true);

// --- undo discard restores an accidental delete into bag + dynamic loot ----
assert.equal(INV.discard('w_electric'), true, 'dynamic item can be discarded');
assert.equal(INV.getItem('w_electric'), null, 'discard removes dynamic item');
assert.ok(INV.discardUndoCount() > 0, 'discard creates an undo entry');
assert.equal(INV.undoDiscard(), true, 'undo discard succeeds');
assert.ok(INV.getItem('w_electric'), 'undo discard restores the item');
assert.ok(globalThis.MM.dynamicLoot.weapons.some(i => i.id === 'w_electric'), 'undo discard restores dynamic loot source');

// --- discard removes the item AND its shortcut opt-out entry --------------
INV.setShortcut('w_dirty', false);
assert.equal(INV.isShortcut('w_dirty'), false);
INV.discard('w_dirty');
assert.equal(INV.getItem('w_dirty'), null, 'discarded item gone');
assert.equal(INV.isShortcut('w_dirty'), true, 'opt-out entry cleaned up with the item');

// --- chest generation: function-pure stats on the clean ladder, tiers superior ---
const RNG = seed => { let st = seed >>> 0; return () => { st = (st * 1664525 + 1013904223) >>> 0; return (st >>> 8) / 0xFFFFFF; }; };
const onLadder = m => { const p = (m - 1) * 100; return Math.abs(p - Math.round(p)) < 1e-6 && Math.round(p) % 5 === 0; };
const NUM_FIELDS = ['airJumps','visionRadius','specialVisionLevel','treasureSenseLevel','moveSpeedMult','jumpPowerMult','mineSpeedMult','waterMoveSpeedMult','attackDamage','fireDps','fireRange','fireCooldown','energyCost','energyCapacityBonus','lootMagnetLevel','crushResistBonus','damageReductionBonus'];
const KIND_ONE_STAT = new Set(['cape','eyes','outfit','charm']);
const sums = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
for (let i = 0; i < 3500; i++) {
  const tier = ['common', 'uncommon', 'rare', 'epic', 'legendary'][i % 5];
  const item = chests.genItem(RNG(i * 7919 + 1), tier);
  // Function purity: only the kind's job stats, and non-weapons carry exactly ONE
  const allowed = INV.allowedStatsFor(item.kind, item.weaponType);
  const present = NUM_FIELDS.filter(f => typeof item[f] === 'number');
  for (const f of present) assert.ok(allowed.includes(f), tier + ' ' + item.kind + ' rolled off-function stat ' + f);
  if (KIND_ONE_STAT.has(item.kind)) assert.equal(present.length, 1, tier + ' ' + item.kind + ' must carry exactly one stat, got ' + present.join(','));
  // antennas: a passive aerial carries exactly one stat; an ACTIVE one carries
  // only its whitelisted power identity (numbers live in antennas.js ACTIVES)
  if (item.kind === 'antenna') {
    if (item.antennaActive) {
      assert.ok(INV.ANTENNA_ACTIVE_LABELS[item.antennaActive], tier + ' antenna active is whitelisted');
      assert.equal(present.length, 0, tier + ' active antenna carries no numeric stat, got ' + present.join(','));
    } else assert.equal(present.length, 1, tier + ' passive antenna carries exactly one stat, got ' + present.join(','));
    if (typeof item.damageReductionBonus === 'number') assert.ok(item.damageReductionBonus > 0 && item.damageReductionBonus <= 0.25, tier + ' antenna guard fraction bounded');
  }
  if (item.weaponType === 'melee') assert.deepEqual(present, ['attackDamage'], 'melee loot is damage-only');
  if (item.weaponType === 'bow') assert.deepEqual(present, ['attackDamage', 'fireCooldown'], 'bow loot is damage + rate');
  if (item.weaponType === 'electric') assert.deepEqual(present, ['fireDps', 'fireRange', 'energyCost'], 'electric loot is beam + range + cost');
  // Clean numbers
  for (const k of ['moveSpeedMult', 'jumpPowerMult', 'mineSpeedMult'])
    if (typeof item[k] === 'number') assert.ok(onLadder(item[k]), tier + ' ' + k + '=' + item[k] + ' off the 5% ladder');
  if (typeof item.waterMoveSpeedMult === 'number') assert.ok([0.75, 1, 1.25].includes(item.waterMoveSpeedMult), tier + ' waterMoveSpeedMult=' + item.waterMoveSpeedMult + ' outside swim tiers');
  if (typeof item.fireRange === 'number') assert.equal(item.fireRange * 2, Math.round(item.fireRange * 2), 'fireRange in 0.5 steps');
  if (typeof item.energyCost === 'number') assert.equal(item.energyCost, Math.round(item.energyCost), 'energyCost integer');
  if (item.weaponType === 'electric') assert.ok(item.energyCost > 0, 'electric loot always has an energyCost');
  if (typeof item.visionRadius === 'number') assert.equal(item.visionRadius, Math.round(item.visionRadius), 'vision in whole tiles');
  if (typeof item.attackDamage === 'number') assert.equal(item.attackDamage, Math.round(item.attackDamage), 'damage integer');
  // Rarity = clearly superior magnitude of the SAME stat (unique boost included in bounds)
  if (item.kind === 'cape'){ if (tier === 'common') assert.ok(item.airJumps <= 2, 'common cape jumps bounded'); if (tier === 'epic') assert.ok(item.airJumps >= 3, 'epic cape clearly superior'); if (tier === 'legendary') assert.ok(item.airJumps >= 4, 'legendary cape crowns the ladder'); }
  if (item.kind === 'eyes' && typeof item.visionRadius === 'number'){ if (tier === 'common') assert.ok(item.visionRadius <= 14, 'common eyes bounded'); if (tier === 'epic') assert.ok(item.visionRadius >= 15, 'epic eyes clearly superior'); if (tier === 'legendary') assert.ok(item.visionRadius >= 18, 'legendary eyes crown the ladder'); }
  if (item.kind === 'eyes' && typeof item.specialVisionLevel === 'number'){
    assert.ok(item.visionMode === 'night' || item.visionMode === 'thermal', 'special optics always identify a safe visual mode');
    assert.ok(item.specialVisionLevel >= 1 && item.specialVisionLevel <= 4, 'special-vision loot stays inside its hard cap');
  }
  if (item.weaponType === 'melee'){ if (tier === 'common') assert.ok(item.attackDamage <= 6, 'common melee bounded'); if (tier === 'epic') assert.ok(item.attackDamage >= 8, 'epic melee clearly superior'); if (tier === 'legendary') assert.ok(item.attackDamage >= 13, 'legendary melee crowns the ladder'); }
  sums[tier] += INV.itemScore(item); counts[tier]++;
}
const MAGNET_TIER_LEVEL={common:1,uncommon:2,rare:3,epic:4,legendary:4};
for(const [tier,level] of Object.entries(MAGNET_TIER_LEVEL)){
  for(const kind of ['outfit','charm']){
    const item=chests.genItem(()=>0.99,tier,{kind,profile:'magnet'});
    assert.equal(item.lootMagnetLevel,level,tier+' '+kind+' follows the capped auto-loot progression');
    assert.equal(NUM_FIELDS.filter(f=>typeof item[f]==='number').length,1,'magnet '+kind+' remains a one-function item');
    assert.match(item.name,/^(Strój zbieracza|Wisiorek przyciągania) /,'magnet loot advertises its function in the name');
  }
}
for(const [tier,level] of Object.entries(MAGNET_TIER_LEVEL)){
  const compass=chests.genItem(()=>0.99,tier,{kind:'charm',profile:'compass'});
  assert.equal(compass.treasureSenseLevel,level,tier+' treasure compass follows the capped progression');
  assert.equal(NUM_FIELDS.filter(f=>typeof compass[f]==='number').length,1,'compass remains a one-function charm');
  assert.match(compass.name,/^Wisiorek-kompas /,'compass loot advertises its function in the name');
  for(const mode of ['night','thermal']){
    const optics=chests.genItem(()=>0.99,tier,{kind:'eyes',profile:mode});
    assert.equal(optics.specialVisionLevel,level,tier+' '+mode+' optics follow the capped progression');
    assert.equal(optics.visionMode,mode,'forced optics preserve their visual mode');
    assert.equal(NUM_FIELDS.filter(f=>typeof optics[f]==='number').length,1,'special optics remain one-function eyes');
  }
}
assert.ok(sums.legendary / counts.legendary > sums.epic / counts.epic, 'legendary loot averages stronger than epic');
assert.ok(sums.epic / counts.epic > sums.rare / counts.rare, 'epic loot averages stronger than rare');
assert.ok(sums.rare / counts.rare > sums.uncommon / counts.uncommon, 'rare loot averages stronger than uncommon');
assert.ok(sums.uncommon / counts.uncommon > sums.common / counts.common, 'uncommon loot averages stronger than common');

// --- save snapshots carry the exact equipped look and shortcut state -------
INV.equip('ninja');
INV.setColor('outfit', '#123456');
INV.setShortcut('bow_wood', false);
const snap = INV.snapshot();
INV.equip('miner');
INV.setColor('outfit', '#abcdef');
INV.setShortcut('bow_wood', true);
assert.equal(INV.restore(snap, { persist: false, silent: true }), true, 'inventory snapshot restores');
assert.equal(INV.equippedId('outfit'), 'ninja', 'snapshot restores outfit');
assert.equal(INV.getColors().outfit, '#123456', 'snapshot restores outfit color');
assert.equal(INV.isShortcut('bow_wood'), false, 'snapshot restores shortcut exclusions');

// --- restore sanitizes persisted shape and new-item references ------------
const cleanSnap = INV.snapshot();
assert.equal(INV.restore({
  equipped: { cape: { bad: true }, eyes: 'bright', outfit: 'default', weapon: null, charm: null },
  colors: { cape: { bad: true }, outfit: '#456789' },
  bag: [
    { id: 'restore_ok', kind: 'charm', name: 'Restore OK', mineSpeedMult: 1.0437 },
    { id: 'restore_magnet_cap', kind: 'charm', name: 'Magnet Cap', lootMagnetLevel: 99 },
    { id: 'restore_magnet_off', kind: 'charm', name: 'Magnet Off', lootMagnetLevel: -4 },
    { id: 'restore_compass_cap', kind: 'charm', name: 'Compass Cap', treasureSenseLevel: 999 },
    { id: 'restore_thermal_cap', kind: 'eyes', name: 'Thermal Cap', specialVisionLevel: 999, visionMode: 'thermal' },
    { id: 'restore_fake_vision', kind: 'eyes', name: 'Fake Vision', specialVisionLevel: 2, visionMode: 'xray' }
  ],
  discarded: ['discarded_ok'],
  shortcutOff: ['bow_wood'],
  shortcutSelection: { bow:'restore_ok', melee:'missing_item', stream:42 },
  newItems: ['restore_ok', 'missing_item']
}, { persist: false, silent: true }), true, 'malformed persisted state restores safely');
assert.equal(INV.equippedId('cape'), 'classic', 'malformed required equipment falls back to default');
assert.equal(INV.getColors().cape, '#b91818', 'malformed color falls back to default');
assert.equal(INV.getColors().outfit, '#456789', 'valid color is preserved');
assert.equal(INV.getItem('restore_ok').mineSpeedMult, 1.05, 'restored loot is normalized');
assert.equal(INV.getItem('restore_magnet_cap').lootMagnetLevel, 4, 'corrupt auto-loot range is clamped to the gameplay cap');
assert.equal(INV.getItem('restore_magnet_off').lootMagnetLevel, undefined, 'non-positive auto-loot range cannot enable the effect');
assert.equal(INV.getItem('restore_compass_cap').treasureSenseLevel, 4, 'corrupt treasure range is clamped to the fourth tier');
assert.equal(INV.getItem('restore_thermal_cap').specialVisionLevel, 4, 'corrupt special-vision level is clamped to the fourth tier');
assert.equal(INV.getItem('restore_thermal_cap').visionMode, 'thermal', 'valid thermal mode survives restore');
assert.equal(INV.getItem('restore_fake_vision').visionMode, 'night', 'unknown x-ray-like mode fails closed to ordinary night vision');
assert.equal(INV.isNew('restore_ok'), true, 'new marker for existing restored loot is kept');
assert.equal(INV.isNew('missing_item'), false, 'new marker for absent loot is dropped');
assert.deepEqual(INV.snapshot().shortcutSelection, {}, 'invalid or wrong-category shortcut selections are discarded on restore');
INV.restore(cleanSnap, { persist: false, silent: true });

// --- permanent jewel enhancement: all three outcomes + save roundtrip -----
const beforeJewels = INV.snapshot();
globalThis.inv = Object.assign(globalThis.inv || {}, {
  jewelBlessed: 1,
  jewelDevout: 2,
  jewelDivinity: 2
});
const stoneBase = INV.getItem('stone_blade').attackDamage;
assert.equal(INV.enhancementInfo('stone_blade').level, 0, 'built-in gear starts without an enhancement');
INV._debugEnhancement.setRandom(() => 0.999);
let result = INV.applyJewel('stone_blade', 'jewelBlessed');
assert.equal(result.success, true, 'blessed jewel succeeds even on the highest roll');
assert.equal(result.delta, 1, 'blessed jewel grants +1');
assert.equal(INV.getItem('stone_blade').attackDamage, stoneBase + 1, '+1 permanently changes the weapon primary stat');

INV._debugEnhancement.setRandom(() => 0.69);
result = INV.applyJewel('stone_blade', 'jewelDevout');
assert.equal(result.success, true, 'devout jewel succeeds below 70%');
assert.equal(result.level, 2, 'devout success stacks on an existing enhancement');
INV._debugEnhancement.setRandom(() => 0.70);
result = INV.applyJewel('stone_blade', 'jewelDevout');
assert.equal(result.success, false, 'devout jewel fails at the 70% boundary');
assert.equal(result.delta, 0, 'devout failure consumes the jewel without harming the item');
assert.equal(result.level, 2, 'devout failure preserves the previous level');

INV._debugEnhancement.setRandom(() => 0.49);
result = INV.applyJewel('stone_blade', 'jewelDivinity');
assert.equal(result.success, true, 'Divinity succeeds below 50%');
assert.equal(result.delta, 2, 'Divinity success grants +2');
assert.equal(result.level, 4, 'Divinity success stacks two levels');
INV._debugEnhancement.setRandom(() => 0.50);
result = INV.applyJewel('stone_blade', 'jewelDivinity');
assert.equal(result.success, false, 'Divinity fails at the 50% boundary');
assert.equal(result.delta, -1, 'Divinity failure lowers the enhancement by one');
assert.equal(result.level, 3, 'Divinity failure retains the signed permanent remainder');
assert.equal(globalThis.inv.jewelBlessed + globalThis.inv.jewelDevout + globalThis.inv.jewelDivinity, 0, 'every enhancement attempt consumes exactly one jewel');

const enhancedSnap = INV.snapshot();
assert.equal(enhancedSnap.enhancements.stone_blade, 3, 'snapshot stores enhancement separately from immutable item definitions');
INV.restore(beforeJewels, { persist: false, silent: true });
assert.equal(INV.getItem('stone_blade').attackDamage, stoneBase, 'restoring an older save removes later enhancements');
INV.restore(enhancedSnap, { persist: false, silent: true });
assert.equal(INV.enhancementInfo('stone_blade').level, 3, 'enhancement level survives save/restore');
assert.equal(INV.getItem('stone_blade').attackDamage, stoneBase + 3, 'enhanced stat survives save/restore without double application');
INV.restore(beforeJewels, { persist: false, silent: true });
INV._debugEnhancement.setRandom(null);

console.log('inventory-sim: all assertions passed (avg Moc common/uncommon/rare/epic/legendary: '
  + [(sums.common / counts.common).toFixed(1), (sums.uncommon / counts.uncommon).toFixed(1), (sums.rare / counts.rare).toFixed(1), (sums.epic / counts.epic).toFixed(1), (sums.legendary / counts.legendary).toFixed(1)].join('/') + ')');
