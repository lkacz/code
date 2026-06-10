// World storage & chunk generation
import { CHUNK_W, WORLD_H, T, SNOW_LINE, SURFACE_GRASS_DEPTH, SAND_DEPTH } from '../constants.js';
import { worldGen as WORLDGEN } from './worldgen.js';
window.MM = window.MM || {};
(function(){
  const WG = WORLDGEN;
  const worldAPI = {};
  const world = new Map();
  const versions = new Map(); // chunk key -> version number for render cache invalidation
  // Cache of surface heights per world column to avoid recomputing noise repeatedly
  const heightCache = new Map();
  // Cache of perched-lake water rows, computed per contiguous lake segment
  const lakeLevels = new Map();
  // Hardening: every Map here grows with the span of coordinates ever touched, and a
  // single runaway caller (or NaN coordinate) used to inflate them until V8 threw
  // "Map maximum size exceeded". Pure caches reset when oversized; chunk storage
  // evicts far-away UNMODIFIED chunks (they regenerate deterministically — edited
  // chunks are exactly what the save system keeps, so they are never dropped).
  const MAX_COORD = 30e6;        // |x| beyond this is treated as void (no storage)
  const CHUNK_CAP = 1536;        // ~98k columns of live chunks before eviction
  const HEIGHT_CACHE_CAP = 200000;
  function colHeight(x){ let v=heightCache.get(x); if(v===undefined){ if(heightCache.size>HEIGHT_CACHE_CAP) heightCache.clear(); v=WG.surfaceHeight(x); heightCache.set(x,v); } return v; }
  function evictFarChunks(){
    const p=(typeof window!=='undefined' && window.player) || null;
    const pcx=(p && isFinite(p.x))? Math.floor(p.x/CHUNK_W) : 0;
    const cand=[];
    for(const k of world.keys()){
      if(versions.get(k)) continue;               // modified chunk: player edits live here
      cand.push([Math.abs(+k.slice(1)-pcx), k]);
    }
    cand.sort((a,b)=>b[0]-a[0]);                  // farthest first
    const drop=Math.min(cand.length, world.size-((CHUNK_CAP*0.75)|0));
    for(let i=0;i<drop;i++){ world.delete(cand[i][1]); versions.delete(cand[i][1]); }
  }
  function ck(x){ return 'c'+x; }
  function tileIndex(x,y){ return y*CHUNK_W+x; }
  function getTileRaw(arr,lx,y){ return arr[tileIndex(lx,y)]; }

  // Perched lakes sit in carved valley basins above sea level. The whole contiguous
  // biome-6 segment shares one water row: one tile below its lower confining shoulder,
  // capped so the lake never exceeds lakeMaxDepth below its deepest floor.
  function lakeLevelFor(x){
    const hit=lakeLevels.get(x); if(hit!==undefined) return hit;
    if(lakeLevels.size>60000) lakeLevels.clear();   // pure cache: safe to rebuild
    const CAP=110;
    let L=x, R=x;
    while(x-L<CAP && WG.biomeType(L-1)===6) L--;
    while(R-x<CAP && WG.biomeType(R+1)===6) R++;
    const rimL=colHeight(L-1), rimR=colHeight(R+1);
    let deepest=0;
    for(let i=L;i<=R;i++){ const sr=colHeight(i); if(sr>deepest) deepest=sr; }
    const maxDepth=(WG.settings && WG.settings.lakeMaxDepth!==undefined)? WG.settings.lakeMaxDepth : 12;
    let water=Math.max(Math.max(rimL,rimR)+1, deepest-maxDepth);
    // Degenerate basin (a shoulder sits below the floor, or the segment hit the scan
    // cap): fall back to a shallow fill so marked lakes never generate bone-dry
    if(water>=deepest-1) water=deepest-2;
    for(let i=L;i<=R;i++) lakeLevels.set(i,water);
    return water;
  }

  const COL_CARVE = new Uint8Array(WORLD_H); // per-column cave scratch: 0 solid, 1 air, 2 water

  function ensureChunk(cx){ const k=ck(cx); if(world.has(k)) return world.get(k); const arr=new Uint8Array(CHUNK_W*WORLD_H);
    const S=WG.settings||{};
    const SEA=(S.seaLevel===undefined)?62:S.seaLevel;
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx;
      const col=WG.column(wx); const s=col.row; const biome=col.biome;
      const bf=WG.biomeFrac(wx,3);
      const slope=Math.abs(colHeight(wx+1)-colHeight(wx-1))/2;
      // Cold cover: snow biome, snowy neighborhood, or altitude above the snow line (jittered)
      const cold = biome===2 || bf[2]>0.35 || s < SNOW_LINE + Math.floor(WG.randSeed(wx*1.13)*5-2);
      const desertF=bf[3], waterF=bf[5]+bf[6];
      const beach=col.beach && biome!==5 && biome!==6;
      // Subsoil sand thickness: deserts deep, beaches/sea floors medium, inland none/thin
      let sandTh;
      if(biome===3) sandTh = SAND_DEPTH + Math.floor(WG.randSeed(wx*0.37)*4) - 1;
      else if(beach || biome===5 || biome===6) sandTh = 3 + Math.floor(WG.randSeed(wx*0.41)*3);
      else sandTh = (desertF>0.15 || waterF>0.15)? 2 : 0;
      // Perched valley lake (above sea level); flooded valleys below sea use the global fill
      let lakeRow=Infinity;
      if(biome===6 && col.elev>2) lakeRow=lakeLevelFor(wx);
      // Swamp pools: sink the floor two tiles under a pool mask
      let poolDepth=0;
      if(biome===4 && WG.valueNoise(wx,26,3301)>0.58) poolDepth=2;
      const ground=s+poolDepth;
      // Cave carve pass for this column (includes ravines/entrances opening the surface)
      COL_CARVE.fill(0);
      for(let y=ground;y<WORLD_H-3;y++){ COL_CARVE[y]=WG.caveAt(wx,y,col); }

      for(let y=0;y<WORLD_H;y++){
        let t=T.AIR;
        if(y>=WORLD_H-3){ arr[tileIndex(lx,y)]=T.STONE; continue; } // bedrock shelf
        if(y<ground){
          // Open sky / surface water
          if(y>=s){ t=T.WATER; }                              // swamp pool cell
          else if(s>SEA && y>=SEA){ t=T.WATER; }              // ocean & flooded valleys
          else if(y>=lakeRow){ t=T.WATER; }                   // perched valley lake
          if(t===T.WATER && cold){
            const wTop=(s>SEA)?SEA:(lakeRow!==Infinity?lakeRow:s);
            if(y<=wTop+1 && WG.randSeed(wx*5.5+y*0.4)<0.9) t=T.ICE; // frozen surface crust
          }
        } else {
          const depth=y-ground;
          const cv=COL_CARVE[y];
          if(cv===1){ t=T.AIR; }
          else if(cv===2){ t=T.WATER; }
          else if(depth<SURFACE_GRASS_DEPTH){
            // Surface material
            if(s>SEA || biome===5 || biome===6 || lakeRow!==Infinity) t=T.SAND; // sea/lake bed
            else if(biome===3 || beach) t=T.SAND;
            else if(cold) t=T.SNOW;
            else if(slope>=3 || (biome===7 && col.pv>0.62)) t=T.STONE;          // cliffs & crests
            else if(biome===7) t=(WG.randSeed(wx*2.9)<0.5)?T.STONE:T.GRASS;     // rocky slopes
            else if(desertF>0.25) t=(WG.randSeed(wx*2.31)<Math.min(0.5,desertF*0.8))?T.SAND:T.GRASS;
            else t=T.GRASS;
          } else if(depth<SURFACE_GRASS_DEPTH+sandTh){
            t=(cold && depth<3)? T.SNOW : T.SAND;
            if(t===T.SAND && depth>2 && WG.randSeed(wx*9.71+y*0.23)<0.18) t=T.STONE;
          } else {
            // Stone mass; diamonds richer with depth and beside cave walls
            const nearCave=(COL_CARVE[y-1]||COL_CARVE[y+1]);
            const chance=WG.diamondChance(y)*(nearCave?3:1);
            t=(WG.randSeed(wx*13.37+y*0.7)<chance)?T.DIAMOND:T.STONE;
            if(t===T.STONE && depth<SURFACE_GRASS_DEPTH+sandTh+2 && WG.randSeed(wx*9.71+y*0.23)<(0.10+0.5*(desertF+waterF*0.5))) t=T.SAND;
          }
        }
        arr[tileIndex(lx,y)]=t;
      }
      // Cave treasure: rare chests on deep cave floors reward spelunking
      if(WG.randSeed(wx*4.21+9.7)<0.05){
        for(let y=WORLD_H-5;y>ground+10;y--){
          const idx=tileIndex(lx,y);
          if(arr[idx]===T.AIR && arr[tileIndex(lx,y+1)]===T.STONE){
            const rr=WG.randSeed(wx*6.13+1.7);
            let ct=T.CHEST_COMMON;
            if(y>WORLD_H-40){ if(rr>0.6) ct=T.CHEST_EPIC; else if(rr>0.25) ct=T.CHEST_RARE; }
            else if(rr>0.65) ct=T.CHEST_RARE;
            arr[idx]=ct; break;
          }
        }
      }
    }
    // Chest placement on surface blocks (above ground) using chestPlace probability
    if(MM.chests){ for(let lx=0; lx<CHUNK_W; lx++){ const wx=cx*CHUNK_W+lx; if(WG.chestPlace && WG.chestPlace(wx)){ const surface=colHeight(wx); const placeY=surface-1; if(placeY>=0){
          const below=arr[tileIndex(lx,surface)];
          // only on solid land surfaces (skip water, pools, carved cave mouths)
          if(below===T.GRASS||below===T.SAND||below===T.SNOW||below===T.STONE){
            const r=WG.chestNoise(wx); let chestT=T.CHEST_COMMON; if(r>0.985) chestT=T.CHEST_EPIC; else if(r>0.955) chestT=T.CHEST_RARE;
            const idx=tileIndex(lx,placeY); if(arr[idx]===T.AIR){ arr[idx]=chestT; }
          }
        } } } }
    // Trees are populated after base terrain; tree code uses deterministic RNG so caching heights is safe
    if(MM.trees && MM.trees.populateChunk){ MM.trees.populateChunk(arr,cx); }
    world.set(k,arr); versions.set(k,0);
    if(world.size>CHUNK_CAP) evictFarChunks();
    // A new chunk may carve caves right beside existing dormant water (or bring its own
    // water beside existing caves) — queue a boundary wake so the fluid sim reacts.
    try{ if(MM.water && MM.water.noteChunkGenerated) MM.water.noteChunkGenerated(cx*CHUNK_W, cx*CHUNK_W+CHUNK_W-1); }catch(e){}
    return arr; }

  // NaN/Infinity coordinates slip past `y<0||y>=WORLD_H` (NaN compares false) and
  // runaway x used to mint chunks without bound — both are treated as void here.
  function getTile(x,y){ if(!(y>=0) || y>=WORLD_H || !isFinite(x) || Math.abs(x)>MAX_COORD) return T.AIR; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const arr=ensureChunk(cx); return getTileRaw(arr,lx,y); }
  function setTile(x,y,v){ if(!(y>=0) || y>=WORLD_H || !isFinite(x) || Math.abs(x)>MAX_COORD) return; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const arr=ensureChunk(cx); const idx=tileIndex(lx,y); if(arr[idx]===v) return; arr[idx]=v; const k=ck(cx); versions.set(k,(versions.get(k)||0)+1); }
  function clearWorld(){ world.clear(); versions.clear(); heightCache.clear(); lakeLevels.clear(); if(WG.clearCaches) WG.clearCaches(); }

  worldAPI.ensureChunk = ensureChunk;
  worldAPI.getTile = getTile;
  worldAPI.setTile = setTile;
  worldAPI.clear = clearWorld;
  worldAPI.clearHeights = ()=>{ heightCache.clear(); lakeLevels.clear(); if(WG.clearCaches) WG.clearCaches(); };
  worldAPI._world = world;
  worldAPI._versions = versions;
  worldAPI.chunkVersion = function(cx){ return versions.get(ck(cx))||0; };

  MM.world = worldAPI;
})();
// ESM export (progressive migration)
export const world = (typeof window!== 'undefined' && window.MM) ? window.MM.world : undefined;
export default world;
