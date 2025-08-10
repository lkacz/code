// World storage & chunk generation
window.MM = window.MM || {};
(function(){
  const {CHUNK_W,WORLD_H,T,SNOW_LINE,SURFACE_GRASS_DEPTH,SAND_DEPTH} = MM;
  const WG = MM.worldGen;
  const worldAPI = {};
  const world = new Map();
  function ck(x){ return 'c'+x; }
  function tileIndex(x,y){ return y*CHUNK_W+x; }
  function getTileRaw(arr,lx,y){ return arr[tileIndex(lx,y)]; }

  function ensureChunk(cx){ const k=ck(cx); if(world.has(k)) return world.get(k); const arr=new Uint8Array(CHUNK_W*WORLD_H); for(let lx=0; lx<CHUNK_W; lx++){ const wx=cx*CHUNK_W+lx; const s=WG.surfaceHeight(wx); for(let y=0;y<WORLD_H;y++){ let t=T.AIR; if(y>=s){ const depth=y-s; const snowy=s<SNOW_LINE; if(depth<SURFACE_GRASS_DEPTH) t=snowy?T.SNOW:T.GRASS; else if(!snowy && depth<SURFACE_GRASS_DEPTH+SAND_DEPTH && s>20) t=T.SAND; else t=(WG.randSeed(wx*13.37 + y*0.7) < WG.diamondChance(y)?T.DIAMOND:T.STONE); } arr[tileIndex(lx,y)]=t; } }
    // After base terrain, populate trees
    if(MM.trees && MM.trees.populateChunk){ MM.trees.populateChunk(arr,cx); }
    world.set(k,arr); return arr; }

  function getTile(x,y){ if(y<0||y>=WORLD_H) return T.AIR; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const arr=ensureChunk(cx); return getTileRaw(arr,lx,y); }
  function setTile(x,y,v){ if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const arr=ensureChunk(cx); arr[tileIndex(lx,y)]=v; }
  function clearWorld(){ world.clear(); }

  worldAPI.ensureChunk = ensureChunk;
  worldAPI.getTile = getTile;
  worldAPI.setTile = setTile;
  worldAPI.clear = clearWorld;
  worldAPI._world = world;

  MM.world = worldAPI;
})();
