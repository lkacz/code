export const CHUNK_W = 64;
export const WORLD_H = 140;
export const WORLD_SECTION_H = 70;
export const WORLD_MIN_SECTION = -2;
export const WORLD_MAX_SECTION = 3;
export const WORLD_MIN_Y = WORLD_MIN_SECTION * WORLD_SECTION_H;
export const WORLD_MAX_Y = (WORLD_MAX_SECTION + 1) * WORLD_SECTION_H;
export const TILE = 20;
export const SURFACE_GRASS_DEPTH = 1;
export const SAND_DEPTH = 8;
export const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8,CHEST_COMMON:9,CHEST_RARE:10,CHEST_EPIC:11,ICE:12,LAVA:13,MUD:14,OBSIDIAN:15,TORCH:16,GRAVE:17,VOLCANO_MASTER_STONE:18,STEEL:19,MEAT:20,ROTTEN_MEAT:21,GLASS:22,WIRE:23,ELECTRONICS:24,COAL:25,HOT_AIR:26,STEAM:27,POISON_GAS:28,FUEL_GAS:29,DYNAMO:30,DYNAMO_SLOT:31,BAKED_MEAT:32,COPPER_WIRE:33,TELEPORTER:34,TRANSISTOR:35,SOLAR_PANEL:36,SOLAR_BATTERY:37,SERVANT_STONE:38,AUTUMN_LEAF_ORANGE:39,AUTUMN_LEAF_RED:40,IRIDIUM:41,METEORIC_IRON:42,ANTIGRAVITY_BEACON:43,TURRET:44,FIRE_TURRET:45,WATER_TURRET:46,WATER_PIPE:47,WATER_PUMP:48,METEOR_SIREN:49,RADIOACTIVE_ORE:50,ALIEN_BIOMASS:51,METEOR_DUST:52,ANTIMATTER_CRYSTAL:53,DIRT:54,GRANITE:55,BASALT:56,BEDROCK:57,WOOD_DOOR:58,STONE_DOOR:59,STEEL_DOOR:60,VENDING_MACHINE:61,WOOD_TRAPDOOR:62,STONE_TRAPDOOR:63,STEEL_TRAPDOOR:64,CLAY:65,WET_CLAY:66,BRICK:67,LADDER:68,SPRING_PLATFORM:69,INVASION_CACHE:70,UFO_CONCRETE:71,MOTHER_ICE:72,MOTHER_LAVA:73,ALTAR:74,GLOWSHROOM:75,CHIMNEY:76,RESPAWN_TOTEM:77,UNSTABLE_SAND:78,UNSTABLE_GRASS:79,QUICKSAND:80,GOLD_ORE:81,TRACK:82,CHAIR_WOOD:83,CHAIR_STONE:84,CHAIR_STEEL:85,GRASS_SNOW:86,FROZEN_DIRT:87,FROZEN_SAND:88,FROZEN_CLAY:89,TOXIC_SNOW:90,CHEST_UNCOMMON:91,CHEST_LEGENDARY:92,STEAM_BOILER:93,STEAM_JET:94,BEDROCK_LADDER:95,
  // Home furnishing IDs are append-only: persisted worlds store these bytes directly.
  RUSTIC_STOOL:96,PINE_TABLE:97,WALL_SHELF:98,OAK_CABINET:99,COZY_BED:100,BOOKCASE:101,PATCHWORK_SOFA:102,HAMMOCK:103,
  WOVEN_RUG:104,POTTED_FERN:105,WALL_CLOCK:106,AQUARIUM:107,TERRARIUM:108,CHANDELIER:109,INDOOR_FOUNTAIN:110,HOLOGRAM_ART:111,
  DESK_LAMP:112,RADIO:113,TELEVISION:114,GAME_CONSOLE:115,REFRIGERATOR:116,COFFEE_MACHINE:117,AIR_PURIFIER:118,MEDICAL_STATION:119,
  HEALING_POD:120,ZERO_G_LOUNGER:121,MEMORY_PROJECTOR:122,CHRONO_CLOCK:123,BIOLUM_GARDEN:124,MINIATURE_SUN:125,DREAM_SYNTH:126,COSMIC_ORRERY:127
};
export const INFO = {
  0:{hp:0,color:null,drop:null,passable:true},
  // flammable/burnTime drive the fire system (engine/fire.js): seconds a tile burns
  // before turning to AIR; spreadInMult scales how readily neighbours ignite this tile
  1:{hp:2,color:'#2e8b2e',drop:'grass',passable:false, flammable:true, burnTime:2.2},
  2:{hp:2,color:'#c2b280',drop:'sand',passable:false},
  // Stone color lightened for contrast (#777 was too close to sky fill)
  3:{hp:6,color:'#888a90',drop:'stone',passable:false},
  4:{hp:10,color:'#3ef',drop:'diamond',passable:false},
  // Wood previously passable (true) which allowed walking through trunks; now solid for proper collision
  5:{hp:4,color:'#8b5a2b',drop:'wood',passable:false, flammable:true, burnTime:60},
  6:{hp:1,color:'#2faa2f',drop:'leaf',passable:true, flammable:true, burnTime:1.1},
  // Snow: slightly bluish to contrast against bright backgrounds
  7:{hp:2,color:'#e6f1ff',drop:'snow',passable:false},
  8:{hp:0,color:'#2477ff',drop:'water',passable:true}, // water (non-solid, fluid simulated separately; mining collects it)
  9:{hp:4,color:'#b07f2c',drop:null,passable:false, chestTier:'common'},
 10:{hp:5,color:'#a74cc9',drop:null,passable:false, chestTier:'rare'},
 11:{hp:6,color:'#e0b341',drop:null,passable:false, chestTier:'epic'},
  // Ice: cooler, more saturated blue for better separation from snow
 12:{hp:3,color:'#8fd6ff',drop:'snow',passable:false},
  // Elemental tiles (engine/weapons.js interactions):
  // Lava — molten rock (flamethrower melts stone). Passable pool that sears entities
  // and ignites adjacent flammables (engine/fire.js); quenched by the hose → obsidian
 13:{hp:1,color:'#e25822',drop:null,passable:true, lava:true},
  // Mud — hosed-down sand: walkable but bogs all moving entities to half speed
 14:{hp:3,color:'#5d4a2f',drop:'sand',passable:false, mud:true},
  // Obsidian — quenched lava: very hard, mineable, placeable
 15:{hp:14,color:'#352a4a',drop:'obsidian',passable:false},
  // Torch — crafted light source (engine/fire.js renders its flame + night glow)
 16:{hp:1,color:'#caa45a',drop:'torch',passable:true},
  // Gravestone — death marker holding the hero's dropped resources (click to recover)
 17:{hp:2,color:'#9aa0ab',drop:null,passable:true},
 18:{hp:12,color:'#ff6a21',drop:'masterStone',passable:false, story:true},
 19:{hp:9,color:'#8f9aa6',drop:'steel',passable:false},
 20:{hp:1,color:'#bd5145',drop:'meat',passable:false, looseItem:true, flammable:true, burnTime:1.4},
 21:{hp:1,color:'#647136',drop:'rottenMeat',passable:false, looseItem:true, flammable:true, burnTime:1.0, rotten:true},
 22:{hp:1,color:'#9deeff',drop:'glass',passable:false, fragileFall:true},
 23:{hp:1,color:'#c56f32',drop:null,passable:true, drops:[{item:'plastic',min:1,max:1},{item:'copper',min:1,max:2}]},
 24:{hp:3,color:'#243946',drop:null,passable:false, drops:[{item:'wire',min:1,max:2},{item:'transistor',min:1,max:1,chance:0.82},{item:'copper',min:1,max:1,chance:0.35}]},
 25:{hp:5,color:'#25272b',drop:'coal',passable:false, flammable:true, burnTime:720, spreadInMult:0.04},
 // World-backed gases (engine/gases.js). They are passable and rendered dynamically
 // so they can rise, react, power future machines and remain hidden by fog-of-war.
 26:{hp:0,color:'#f4b65e',drop:null,passable:true, gas:true, gasKind:'hot'},
 27:{hp:0,color:'#dce8ef',drop:null,passable:true, gas:true, gasKind:'steam'},
 28:{hp:0,color:'#82d45b',drop:null,passable:true, gas:true, gasKind:'poison'},
 29:{hp:0,color:'#a79a64',drop:null,passable:true, gas:true, gasKind:'fuel'},
 30:{hp:7,color:'#697685',drop:null,passable:false, machine:'dynamo', powerSource:true},
 31:{hp:4,color:'#1f2937',drop:null,passable:true, machine:'dynamoSlot', powerSource:true},
 32:{hp:1,color:'#9b5a2e',drop:'bakedMeat',passable:false, looseItem:true, cooked:true},
 33:{hp:1,color:'#d68535',drop:'copperWire',passable:true, machine:'copperWire', conductor:true},
 34:{hp:8,color:'#24435a',drop:'teleporter',passable:true, machine:'teleporter', powerDevice:true, energyCapacity:160},
 35:{hp:1,color:'#47d18c',drop:'transistor',passable:false, machine:'transistor', drops:[{item:'transistor',min:1,max:1},{item:'copper',min:1,max:1,chance:0.25}]},
 36:{hp:3,color:'#17607a',drop:'solarPanel',passable:false, machine:'solarPanel', powerSource:true, conductor:true},
 37:{hp:4,color:'#0f6f78',drop:'solarBattery',passable:false, machine:'solarBattery', powerSource:true, conductor:true, energyCapacity:120},
 38:{hp:8,color:'#8b2d17',drop:'servantStone',passable:false, volatile:true},
 39:{hp:1,color:'#d7832f',drop:'leaf',passable:true, flammable:true, burnTime:1.1, seasonalLeaf:true},
 40:{hp:1,color:'#8f5a2a',drop:'leaf',passable:true, flammable:true, burnTime:1.1, seasonalLeaf:true},
 41:{hp:18,color:'#b8d7ff',drop:'iridium',passable:false, meteorite:true},
 42:{hp:12,color:'#7f878d',drop:'meteoricIron',passable:false, meteorite:true},
 43:{hp:10,color:'#3f214f',drop:'antigravityBeacon',passable:false, machine:'antigravityBeacon', meteorShield:true},
 44:{hp:8,color:'#4d5e72',drop:'turret',passable:false, machine:'turret', powerDevice:true, energyCapacity:90},
 45:{hp:8,color:'#7a3324',drop:'fireTurret',passable:false, machine:'fireTurret', powerDevice:true, energyCapacity:90},
 46:{hp:8,color:'#24628a',drop:'waterTurret',passable:false, machine:'waterTurret', powerDevice:true, waterDevice:true, energyCapacity:90, waterCapacity:24},
 47:{hp:1,color:'#2d8ec9',drop:'waterPipe',passable:true, machine:'waterPipe', fluidPipe:true},
 48:{hp:7,color:'#246f86',drop:'waterPump',passable:false, machine:'waterPump', powerDevice:true, fluidPump:true, energyCapacity:80},
 49:{hp:6,color:'#ff9f45',drop:'meteorSiren',passable:false, machine:'meteorSiren', meteorSiren:true, powerDevice:true, energyCapacity:60},
 50:{hp:9,color:'#8aff4f',drop:'radioactiveOre',passable:false, meteorite:true, radioactive:true},
 51:{hp:2,color:'#79c95d',drop:'alienBiomass',passable:false, meteorite:true, biological:true, flammable:true, burnTime:5.5},
 52:{hp:1,color:'#c8a6ff',drop:'meteorDust',passable:true, meteorite:true, dust:true},
 53:{hp:14,color:'#d36bff',drop:'antimatter',passable:false, meteorite:true, antimatter:true},
 54:{hp:3,color:'#73543a',drop:'dirt',passable:false, geology:true},
 55:{hp:10,color:'#7d7f87',drop:'granite',passable:false, geology:true, hardRock:true},
 56:{hp:16,color:'#30333a',drop:'basalt',passable:false, geology:true, hardRock:true},
 57:{hp:0,color:'#1c2028',drop:'bedrock',passable:false, geology:true, hardRock:true, bedrock:true, unmineable:true},
 58:{hp:4,color:'#9b6730',drop:'woodDoor',passable:false, door:true, doorMaterial:'wood', flammable:true, burnTime:48, spreadInMult:0.75},
 59:{hp:7,color:'#8d9098',drop:'stoneDoor',passable:false, door:true, doorMaterial:'stone'},
 60:{hp:9,color:'#9aa8b5',drop:'steelDoor',passable:false, door:true, doorMaterial:'steel'},
 61:{hp:8,color:'#38506c',drop:'vendingMachine',passable:false, machine:'vendingMachine', powerDevice:true, drops:[{item:'copperWire',min:1,max:3},{item:'waterPipe',min:1,max:2,chance:0.65},{item:'plastic',min:1,max:2,chance:0.45}]},
 62:{hp:4,color:'#a57136',drop:'woodTrapdoor',passable:false, trapdoor:true, doorMaterial:'wood', flammable:true, burnTime:44, spreadInMult:0.75},
 63:{hp:7,color:'#858992',drop:'stoneTrapdoor',passable:false, trapdoor:true, doorMaterial:'stone'},
 64:{hp:9,color:'#91a0ad',drop:'steelTrapdoor',passable:false, trapdoor:true, doorMaterial:'steel'},
 65:{hp:3,color:'#8f7a62',drop:'clay',passable:false},
 // Wet clay is a waterlogged clay state; mining it recovers clay.
 66:{hp:2,color:'#6f5c46',drop:'clay',passable:false, wetClay:true},
 67:{hp:8,color:'#a65a3a',drop:'brick',passable:false, ceramic:true},
 68:{hp:2,color:'#b98243',drop:'ladder',passable:true, ladder:true, flammable:true, burnTime:32},
 69:{hp:7,color:'#7cc7d8',drop:'springPlatform',passable:false, machine:'springPlatform', powerDevice:true, energyCapacity:70},
 70:{hp:9,color:'#193d45',drop:null,passable:false, cache:true, protected:true},
 71:{hp:18,color:'#536977',drop:'ufoConcrete',passable:false, ufoConcrete:true, unmineable:true},
 72:{hp:16,color:'#d8fbff',drop:'motherIce',passable:false, geology:true, hardRock:true, guardianRelic:true},
 73:{hp:16,color:'#ff7a33',drop:'motherLava',passable:false, geology:true, hardRock:true, guardianRelic:true},
 // Summoning altar (engine/altar.js): rare surface shrine — click with the
 // offering (diamonds + obsidian) to call an empowered gargantuan boss whose
 // fall pays a hoard of epic chests. Indestructible so the ritual stays rare.
 74:{hp:30,color:'#b06ae0',drop:null,passable:false, story:true, unmineable:true, altar:true},
 // Glowshroom — bioluminescent cave fungus dressed into forest/swamp caverns
 // (world.js underground biome pass); a lighting emitter, so mushroom chambers
 // glow teal in the dark. Harvest = quick mine; soup recipe in main.js.
 75:{hp:1,color:'#7de3a8',drop:'glowshroom',passable:true, flammable:true, burnTime:1.0},
 // Chimney: a solid fired-brick duct. Gases cannot occupy the block itself;
 // engine/gases.js vents them vertically through stacks to the open outlet.
 76:{hp:8,color:'#6b5548',drop:'chimney',passable:false, ceramic:true, chimney:true},
 // Respawn totem: a player-placeable fixture. Multiple living totem tiles are
 // ranked at death; the nearest valid one becomes the return point.
 77:{hp:8,color:'#e23b4e',drop:'respawnTotem',passable:true, respawnTotem:true},
 // Natural pressure tiles: subtle surface hazards generated in deserts, beaches
 // and grasslands. Unstable covers collapse under weight; quicksand is passable
 // but drags the hero down until repeated jump taps break free.
 78:{hp:1,color:'#b9a56d',drop:'sand',passable:false, unstable:true, unstableBase:'sand'},
 79:{hp:1,color:'#2f7e2f',drop:'grass',passable:false, flammable:true, burnTime:1.5, unstable:true, unstableBase:'grass'},
 80:{hp:1,color:'#b49a62',drop:'sand',passable:true, quicksand:true},
 // Gold ore: embedded underground veins that mine into the gold resource.
 81:{hp:9,color:'#f2b93b',drop:'gold',passable:false, ore:true, goldOre:true},
 82:{hp:8,color:'#48515b',drop:'track',passable:false, conductor:true},
 // Mech pilot chairs (engine/mechs.js): passable seat fixtures. Standing in a
 // chair that crowns a valid block-built machine (track platform + hull)
 // assembles it into a drivable mech; the material sets seat durability and
 // how efficiently the seated hero's own energy can drive the tracks.
 83:{hp:4,color:'#a9743c',drop:'chairWood',passable:true, chair:true, furniture:true, furnitureCategory:'furniture', chairMaterial:'wood', flammable:true, burnTime:30},
 84:{hp:7,color:'#8d939c',drop:'chairStone',passable:true, chair:true, furniture:true, furnitureCategory:'furniture', chairMaterial:'stone'},
 85:{hp:9,color:'#9fb0bd',drop:'chairSteel',passable:true, chair:true, furniture:true, furnitureCategory:'furniture', chairMaterial:'steel'},
 // Winter grass: living turf dusted by snowfall (clouds deposit / seasonal dusting).
 // First stage of accumulation — melts back to GRASS, mines like grass. Too damp to burn.
 86:{hp:2,color:'#7fa06b',drop:'grass',passable:false, snowyGrass:true},
 // Permafrost: frozen soil band of the deep-cold west. Mines several times slower
 // than its thawed base; heat (flamethrower, fire, torch) thaws it back first.
 87:{hp:12,color:'#6d6472',drop:'dirt',passable:false, geology:true, frozenEarth:true},
 88:{hp:10,color:'#a8a794',drop:'sand',passable:false, frozenEarth:true},
 89:{hp:11,color:'#7e7a86',drop:'clay',passable:false, frozenEarth:true},
 // Toxic snow: snowfall from a gas-contaminated cloud (volcano plumes, poison gas).
 // Mines into the toxicSnow resource (crafts into bow snowballs); melts into
 // polluted water instead of clean runoff.
 90:{hp:2,color:'#c9e8ba',drop:'toxicSnow',passable:false, toxicSnow:true},
 // Chest rarity ladder extensions (see 9-11): uncommon sits between the plain
 // wooden chest and the rare one; legendary crowns the ladder above epic.
 91:{hp:4,color:'#3fa650',drop:null,passable:false, chestTier:'uncommon'},
 92:{hp:7,color:'#58e0d8',drop:null,passable:false, chestTier:'legendary'},
 // Steam circuit (engine/steam_machines.js + mech flight in engine/mechs.js):
 // the boiler turns tanked water + supplied heat (circuit energy, or free heat
 // from adjacent lava/embers) into pressurized steam; excess vents as REAL
 // T.STEAM gas the world simulates (condenses back to water, spins dynamos).
 // powerDevice/conductor wire it into electric networks as a heat consumer;
 // its tank capacities live in steam_machines.js STEAM_CFG — the boiler
 // stores steam pressure, never electric energy, so no energyCapacity here.
 93:{hp:9,color:'#8a6f4d',drop:'steamBoiler',passable:false, machine:'steamBoiler', powerDevice:true, conductor:true},
 // Steam jet: fed by a nearby boiler it blasts a rising steam column — a
 // ground-mounted jet is an updraft elevator; a hull-bottom row of jets is the
 // lift drive of a flying built mech (W = thrust while seated).
 94:{hp:8,color:'#9fb6c4',drop:'steamJet',passable:false, machine:'steamJet', conductor:true},
 // Bedrock ladder: an endgame climbing fixture. One endpoint must be anchored,
 // but the opposite end may extend through open air for the full world height.
 95:{hp:12,color:'#6f7890',drop:'bedrockLadder',passable:true, ladder:true, bedrockLadder:true}
};

// Compact physics/save metadata for the data-driven home catalogue. Names,
// recipes and artwork live in engine/furnishings.js; constants only owns the
// stable tile/resource contract used by worlds, mining and inventory restores.
export const HOME_FURNISHING_TILE_SPECS = Object.freeze([
  ['RUSTIC_STOOL','rusticStool','#ad7a45',3,.04,'furniture'],
  ['PINE_TABLE','pineTable','#a66d38',4,.06,'furniture'],
  ['WALL_SHELF','wallShelf','#916035',3,.05,'furniture'],
  ['OAK_CABINET','oakCabinet','#7d4b2b',6,.09,'furniture'],
  ['COZY_BED','cozyBed','#c67b69',5,.14,'furniture'],
  ['BOOKCASE','bookcase','#8f5934',6,.10,'furniture'],
  ['PATCHWORK_SOFA','patchworkSofa','#a85f73',5,.14,'furniture'],
  ['HAMMOCK','hammock','#d2a25f',3,.08,'furniture'],
  ['WOVEN_RUG','wovenRug','#b95f4f',2,.06,'decor'],
  ['POTTED_FERN','pottedFern','#67a95b',2,.06,'decor'],
  ['WALL_CLOCK','wallClock','#d1a84d',3,.07,'decor'],
  ['AQUARIUM','aquarium','#52b9d5',3,.16,'decor',4],
  ['TERRARIUM','terrarium','#67c58d',3,.12,'decor',6],
  ['CHANDELIER','chandelier','#ffd978',4,.13,'decor',12],
  ['INDOOR_FOUNTAIN','indoorFountain','#71b8d0',5,.14,'decor'],
  ['HOLOGRAM_ART','hologramArt','#8fe9ff',4,.17,'decor',7],
  ['DESK_LAMP','deskLamp','#ffc766',3,.08,'electronics',10],
  ['RADIO','radio','#d28b4e',4,.11,'electronics'],
  ['TELEVISION','television','#56b7d8',5,.14,'electronics',4],
  ['GAME_CONSOLE','gameConsole','#9c7df2',4,.16,'electronics',4],
  ['REFRIGERATOR','refrigerator','#b7d2dc',7,.13,'electronics'],
  ['COFFEE_MACHINE','coffeeMachine','#b87852',5,.14,'electronics'],
  ['AIR_PURIFIER','airPurifier','#77dfd2',6,.20,'electronics',5],
  ['MEDICAL_STATION','medicalStation','#72e5ad',7,.26,'electronics',8],
  ['HEALING_POD','healingPod','#62f1c5',10,.32,'wonders',11],
  ['ZERO_G_LOUNGER','zeroGLounger','#b08cff',9,.28,'wonders',7],
  ['MEMORY_PROJECTOR','memoryProjector','#7de8ff',8,.26,'wonders',8],
  ['CHRONO_CLOCK','chronoClock','#f3ca63',9,.30,'wonders',7],
  ['BIOLUM_GARDEN','biolumGarden','#7cf3a8',7,.27,'wonders',10],
  ['MINIATURE_SUN','miniatureSun','#ffb43f',12,.36,'wonders',15],
  ['DREAM_SYNTH','dreamSynth','#d07cff',10,.35,'wonders',9],
  ['COSMIC_ORRERY','cosmicOrrery','#92a8ff',11,.34,'wonders',9]
].map(Object.freeze));

for(const [tileName,drop,color,hp,homeRegenBonus,furnitureCategory,lightLevel] of HOME_FURNISHING_TILE_SPECS){
  INFO[T[tileName]]={
    hp,color,drop,passable:true,furniture:true,furnitureCategory,homeRegenBonus,
    ...(lightLevel ? {lightLevel} : null)
  };
}
// Rows above (i.e. numerically below) this line get snow cover; tuned for the v2
// terrain where sea level sits at row ~62 and peaks reach row ~10
export const SNOW_LINE = 30;
export const MOVE = {ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20};
export const CAPE = {SEGMENTS:12,ANCHOR_FRAC:0.5};
export const BLINK_DUR = 160;

export const isSolid = t => t !== T.AIR && !INFO[t].passable;
export const isAutumnLeaf = t => t === T.AUTUMN_LEAF_ORANGE || t === T.AUTUMN_LEAF_RED;
export const isLeaf = t => t === T.LEAF || isAutumnLeaf(t);
// Temperature-system tile families. Frozen earth is the permafrost variant of a
// diggable soil; both directions of the mapping stay here so worldgen, seasons,
// fire and reactions never invent their own pairs.
export const FROZEN_EARTH_BY_BASE = Object.freeze({[T.DIRT]:T.FROZEN_DIRT, [T.SAND]:T.FROZEN_SAND, [T.CLAY]:T.FROZEN_CLAY});
export const THAWED_EARTH_BY_FROZEN = Object.freeze({[T.FROZEN_DIRT]:T.DIRT, [T.FROZEN_SAND]:T.SAND, [T.FROZEN_CLAY]:T.CLAY});
export const isFrozenEarth = t => t === T.FROZEN_DIRT || t === T.FROZEN_SAND || t === T.FROZEN_CLAY;
export const frozenEarthVariant = t => FROZEN_EARTH_BY_BASE[t] !== undefined ? FROZEN_EARTH_BY_BASE[t] : null;
export const thawedEarthVariant = t => THAWED_EARTH_BY_FROZEN[t] !== undefined ? THAWED_EARTH_BY_FROZEN[t] : null;
export const isSnowyGrass = t => t === T.GRASS_SNOW;

// Backward-compatibility shim: populate window.MM so legacy engine files keep working
if (typeof window !== 'undefined') {
  window.MM = window.MM || {};
  Object.assign(window.MM, {
    CHUNK_W,
    WORLD_H,
    WORLD_SECTION_H,
    WORLD_MIN_SECTION,
    WORLD_MAX_SECTION,
    WORLD_MIN_Y,
    WORLD_MAX_Y,
    TILE,
    SURFACE_GRASS_DEPTH,
    SAND_DEPTH,
    T,
    INFO,
    SNOW_LINE,
    MOVE,
    CAPE,
    BLINK_DUR,
    isSolid,
    isAutumnLeaf,
    isLeaf,
    isFrozenEarth,
    frozenEarthVariant,
    thawedEarthVariant,
    isSnowyGrass,
  });
}
