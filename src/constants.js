export const CHUNK_W = 64;
export const WORLD_H = 140;
export const TILE = 20;
export const SURFACE_GRASS_DEPTH = 1;
export const SAND_DEPTH = 8;
export const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8,CHEST_COMMON:9,CHEST_RARE:10,CHEST_EPIC:11,ICE:12,LAVA:13,MUD:14,OBSIDIAN:15,TORCH:16,GRAVE:17,VOLCANO_MASTER_STONE:18,STEEL:19,MEAT:20,ROTTEN_MEAT:21,GLASS:22,WIRE:23,ELECTRONICS:24,COAL:25,HOT_AIR:26,STEAM:27,POISON_GAS:28,FUEL_GAS:29,DYNAMO:30,DYNAMO_SLOT:31,BAKED_MEAT:32,COPPER_WIRE:33,TELEPORTER:34,TRANSISTOR:35,SOLAR_PANEL:36,SOLAR_BATTERY:37,SERVANT_STONE:38,AUTUMN_LEAF_ORANGE:39,AUTUMN_LEAF_RED:40,IRIDIUM:41,METEORIC_IRON:42,ANTIGRAVITY_BEACON:43,TURRET:44,FIRE_TURRET:45,WATER_TURRET:46,WATER_PIPE:47,WATER_PUMP:48,METEOR_SIREN:49,RADIOACTIVE_ORE:50,ALIEN_BIOMASS:51,METEOR_DUST:52,ANTIMATTER_CRYSTAL:53,DIRT:54,GRANITE:55,BASALT:56,BEDROCK:57};
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
 36:{hp:3,color:'#17607a',drop:null,passable:false, machine:'solarPanel', powerSource:true, conductor:true, drops:[{item:'glass',min:1,max:1,chance:0.7},{item:'wire',min:1,max:1,chance:0.8}]},
 37:{hp:4,color:'#0f6f78',drop:null,passable:false, machine:'solarBattery', powerSource:true, conductor:true, energyCapacity:120, drops:[{item:'glass',min:1,max:1,chance:0.7},{item:'wire',min:1,max:1,chance:0.8},{item:'transistor',min:1,max:1,chance:0.65}]},
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
 57:{hp:0,color:'#1c2028',drop:null,passable:false, geology:true, hardRock:true, bedrock:true, unmineable:true}
};
// Rows above (i.e. numerically below) this line get snow cover; tuned for the v2
// terrain where sea level sits at row ~62 and peaks reach row ~10
export const SNOW_LINE = 30;
export const MOVE = {ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20};
export const CAPE = {SEGMENTS:12,ANCHOR_FRAC:0.5};
export const BLINK_DUR = 160;

export const isSolid = t => t !== T.AIR && !INFO[t].passable;
export const isAutumnLeaf = t => t === T.AUTUMN_LEAF_ORANGE || t === T.AUTUMN_LEAF_RED;
export const isLeaf = t => t === T.LEAF || isAutumnLeaf(t);

// Backward-compatibility shim: populate window.MM so legacy engine files keep working
if (typeof window !== 'undefined') {
  window.MM = window.MM || {};
  Object.assign(window.MM, {
    CHUNK_W,
    WORLD_H,
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
  });
}
