// Core constants (global script friendly)
window.MM = window.MM || {};
Object.assign(MM, {
  CHUNK_W:64,
  WORLD_H:140,
  TILE:20,
  SURFACE_GRASS_DEPTH:1,
  SAND_DEPTH:8,
  T:{AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7},
  INFO:null, // filled below
  SNOW_LINE:14,
  MOVE:{ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20},
  CAPE:{SEGMENTS:12,ANCHOR_FRAC:0.5},
  BLINK_DUR:160
});
MM.INFO={
  0:{hp:0,color:null,drop:null,passable:true},
  1:{hp:2,color:'#2e8b2e',drop:'grass',passable:false},
  2:{hp:2,color:'#c2b280',drop:'sand',passable:false},
  // Stone color lightened for contrast (#777 was too close to sky fill)
  3:{hp:6,color:'#888a90',drop:'stone',passable:false},
  4:{hp:10,color:'#3ef',drop:'diamond',passable:false},
  5:{hp:4,color:'#8b5a2b',drop:'wood',passable:true},
  6:{hp:1,color:'#2faa2f',drop:'leaf',passable:true},
  7:{hp:2,color:'#eee',drop:'snow',passable:false}
};
MM.isSolid = t => t!==MM.T.AIR && !MM.INFO[t].passable;
