// World storage & chunk generation
window.MM = window.MM || {};
(function(){
  const {CHUNK_W,WORLD_H,T,SNOW_LINE,SURFACE_GRASS_DEPTH,SAND_DEPTH} = MM;
  const WG = MM.worldGen;
  const worldAPI = {};
  const world = new Map();
  const versions = new Map(); // chunk key -> version number for render cache invalidation
  // Cache of surface heights per world column to avoid recomputing noise repeatedly
  const heightCache = new Map();
  function colHeight(x){ let v=heightCache.get(x); if(v===undefined){ v=WG.surfaceHeight(x); heightCache.set(x,v); } return v; }
  function ck(x){ return 'c'+x; }
  function tileIndex(x,y){ return y*CHUNK_W+x; }
  function getTileRaw(arr,lx,y){ return arr[tileIndex(lx,y)]; }

  function ensureChunk(cx){ const k=ck(cx); if(world.has(k)) return world.get(k); const arr=new Uint8Array(CHUNK_W*WORLD_H); for(let lx=0; lx<CHUNK_W; lx++){ const wx=cx*CHUNK_W+lx; const s=colHeight(wx); for(let y=0;y<WORLD_H;y++){ let t=T.AIR; if(y>=s){ const depth=y-s; const snowy=s<SNOW_LINE; if(depth<SURFACE_GRASS_DEPTH) t=snowy?T.SNOW:T.GRASS; else if(!snowy && depth<SURFACE_GRASS_DEPTH+SAND_DEPTH && s>20) t=T.SAND; else t=(WG.randSeed(wx*13.37 + y*0.7) < WG.diamondChance(y)?T.DIAMOND:T.STONE); } arr[tileIndex(lx,y)]=t; } }
    // Chest placement on surface blocks (above ground) using chestPlace probability
    if(MM.chests){ for(let lx=0; lx<CHUNK_W; lx++){ const wx=cx*CHUNK_W+lx; if(WG.chestPlace && WG.chestPlace(wx)){ const surface=colHeight(wx); const placeY=surface-1; if(placeY>=0){ // decide tier by secondary noise
          const r=WG.chestNoise(wx); let chestT=T.CHEST_COMMON; if(r>0.985) chestT=T.CHEST_EPIC; else if(r>0.955) chestT=T.CHEST_RARE; // stacked thresholds
          const idx=tileIndex(lx,placeY); if(arr[idx]===T.AIR){ arr[idx]=chestT; }
        } } } }
    // Trees are populated after base terrain; tree code uses deterministic RNG so caching heights is safe
    // After base terrain, populate trees
    if(MM.trees && MM.trees.populateChunk){ MM.trees.populateChunk(arr,cx); }
    world.set(k,arr); versions.set(k,0); return arr; }

  function getTile(x,y){ if(y<0||y>=WORLD_H) return T.AIR; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const arr=ensureChunk(cx); return getTileRaw(arr,lx,y); }
  function setTile(x,y,v){ if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const arr=ensureChunk(cx); const idx=tileIndex(lx,y); if(arr[idx]===v) return; arr[idx]=v; const k=ck(cx); versions.set(k,(versions.get(k)||0)+1); }
  function clearWorld(){ world.clear(); versions.clear(); heightCache.clear(); }

  worldAPI.ensureChunk = ensureChunk;
  worldAPI.getTile = getTile;
  worldAPI.setTile = setTile;
  worldAPI.clear = clearWorld;
  worldAPI.clearHeights = ()=>heightCache.clear();
  worldAPI._world = world;
  worldAPI._versions = versions;
  worldAPI.chunkVersion = function(cx){ return versions.get(ck(cx))||0; };

  MM.world = worldAPI;
})();
