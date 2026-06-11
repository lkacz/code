export const CHUNK_W = 64;
export const WORLD_H = 140;
export const TILE = 20;
export const SURFACE_GRASS_DEPTH = 1;
export const SAND_DEPTH = 8;
export const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8,CHEST_COMMON:9,CHEST_RARE:10,CHEST_EPIC:11,ICE:12,LAVA:13,MUD:14,OBSIDIAN:15,TORCH:16,GRAVE:17};
export const INFO = {
  0:{hp:0,color:null,drop:null,passable:true},
  // flammable/burnTime drive the fire system (engine/fire.js): seconds a tile burns
  // before turning to AIR; spread chance also scales with burnTime
  1:{hp:2,color:'#2e8b2e',drop:'grass',passable:false, flammable:true, burnTime:2.2},
  2:{hp:2,color:'#c2b280',drop:'sand',passable:false},
  // Stone color lightened for contrast (#777 was too close to sky fill)
  3:{hp:6,color:'#888a90',drop:'stone',passable:false},
  4:{hp:10,color:'#3ef',drop:'diamond',passable:false},
  // Wood previously passable (true) which allowed walking through trunks; now solid for proper collision
  5:{hp:4,color:'#8b5a2b',drop:'wood',passable:false, flammable:true, burnTime:3.5},
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
 17:{hp:2,color:'#9aa0ab',drop:null,passable:true}
};
// Rows above (i.e. numerically below) this line get snow cover; tuned for the v2
// terrain where sea level sits at row ~62 and peaks reach row ~10
export const SNOW_LINE = 30;
export const MOVE = {ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20};
export const CAPE = {SEGMENTS:12,ANCHOR_FRAC:0.5};
export const BLINK_DUR = 160;

export const isSolid = t => t !== T.AIR && !INFO[t].passable;

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
  });
}
