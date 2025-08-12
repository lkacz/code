// World storage & chunk generation
import { CHUNK_W, WORLD_H, T, SNOW_LINE, SURFACE_GRASS_DEPTH, SAND_DEPTH } from '../constants.js';
import { worldGen as WORLDGEN } from './worldgen.js';
window.MM = window.MM || {};
(function(){
  // constants are imported from ESM; keep names identical
  const WG = WORLDGEN;
  const worldAPI = {};
  const world = new Map();
  const versions = new Map(); // chunk key -> version number for render cache invalidation
  // Cache of surface heights per world column to avoid recomputing noise repeatedly
  const heightCache = new Map();
  function colHeight(x){ let v=heightCache.get(x); if(v===undefined){ v=WG.surfaceHeight(x); heightCache.set(x,v); } return v; }
  function ck(x){ return 'c'+x; }
  function tileIndex(x,y){ return y*CHUNK_W+x; }
  function getTileRaw(arr,lx,y){ return arr[tileIndex(lx,y)]; }

  function ensureChunk(cx){ const k=ck(cx); if(world.has(k)) return world.get(k); const arr=new Uint8Array(CHUNK_W*WORLD_H);
    for(let lx=0; lx<CHUNK_W; lx++){
  const wx=cx*CHUNK_W+lx; const s=colHeight(wx); const biome=WG.biomeType(wx);
  // Biome fractions around this column for visual blending
  const bf = (WG.biomeFrac? WG.biomeFrac(wx,2): null);
      // Precompute some noise for variation per column
      const colRand = WG.randSeed(wx*7.13);
      // Transitional thresholds: jitter sand/stone boundary to avoid straight lines
      const baseSurf = SURFACE_GRASS_DEPTH;
      let sandTh = SURFACE_GRASS_DEPTH + SAND_DEPTH;
      const sandJ = Math.floor((((WG.valueNoise? WG.valueNoise(wx,45,1717):0) - 0.5) * 5)); // [-2..+2]
      sandTh += sandJ;
      if(bf){ // deeper sand near deserts/coasts
        sandTh += Math.round(bf[5]*2 + bf[6]*1.5 + bf[3]*2);
      }
      // Left-to-right sand influence around biome borders
      let pSandHoriz = 0;
      if(WG.biomeFrac){
        const bfL = WG.biomeFrac(wx-8, 6);
        const bfM = WG.biomeFrac(wx, 4);
        const bfR = WG.biomeFrac(wx+8, 6);
        const dL = (bfL? (bfL[3] + bfL[5]*0.6 + bfL[6]*0.4) : (0));
        const dM = (bfM? (bfM[3] + bfM[5]*0.6 + bfM[6]*0.4) : ((biome===3||biome===5||biome===6)?1:0));
        const dR = (bfR? (bfR[3] + bfR[5]*0.6 + bfR[6]*0.4) : (0));
        const sandLR = Math.max(0, Math.min(1, 0.25*dL + 0.5*dM + 0.25*dR));
        // Probability to choose sand in mid-layer, fades left->right across border
        pSandHoriz = Math.max(0, Math.min(1, 0.08 + 0.9*sandLR));
      } else {
        pSandHoriz = (biome===3||biome===5||biome===6)? 0.85 : 0.15;
      }
  // Neighbor surface heights for depression analysis
  const sL1 = colHeight(wx-1), sR1 = colHeight(wx+1);
  const sL2 = colHeight(wx-2), sR2 = colHeight(wx+2);
  const sL3 = colHeight(wx-3), sR3 = colHeight(wx+3);
  const neighHeights = [sL1,sR1,sL2,sR2,sL3,sR3];
  const neighMin = Math.min.apply(null, neighHeights);
  const neighAvg = (neighHeights.reduce((a,b)=>a+b,0))/neighHeights.length;
  const depressionDepth = Math.max(0, Math.floor(neighAvg - s));
  const SEA_LEVEL = (WG.settings && WG.settings.seaLevel!==undefined)? WG.settings.seaLevel : 18;

  for(let y=0;y<WORLD_H;y++){
        let t=T.AIR; if(y>=s){
          const depth=y-s;
          const snowy = (biome===2 || biome===7) && s < SNOW_LINE+4; // extend snow in high biomes
          const desert = biome===3;
          const swamp = biome===4;
          const sea   = biome===5;
          const lake  = biome===6;
          const mountain = biome===7;
          // Determine surface material rules per biome
          if(depth < baseSurf){
            // Top soil blend near borders: bias to sand if desert/sea/lake presence, snow if cold
            if(sea || lake){ t=T.SAND; }
            else if(desert){
              let sandBias = bf? (bf[3] + bf[5]*0.6 + bf[6]*0.4) : 1; // desert + nearby sea/lake
              sandBias += WG.randSeed(wx*0.77)*0.25; // small noise
              t = sandBias>0.45? T.SAND : T.GRASS;
            }
            else if(swamp){ t = (colRand<0.4)?T.SAND:T.GRASS; }
            else if(snowy){
              let snowBias = bf? (bf[2] + bf[7]*0.5) : 1; // snow + mountain
              snowBias += WG.randSeed(wx*1.13)*0.2;
              t = snowBias>0.5? T.SNOW : T.GRASS;
            }
            else {
              // Plains/forest edge to desert: slight sand mix
              if(bf && bf[3]>0.25){ t = (WG.randSeed(wx*2.31) < Math.min(0.5, bf[3]*0.8))? T.SAND : T.GRASS; }
              else t=T.GRASS;
            }
          } else if(depth < sandTh){
            if(snowy) {
              t = T.SNOW;
            } else if(swamp){
              const n = WG.randSeed(wx*3.77 + y*0.11);
              t = (n < Math.min(0.7, 0.25 + 0.6*pSandHoriz)) ? T.SAND : T.STONE;
            } else if(desert || sea || lake){
              t = T.SAND;
            } else {
              // Lateral blend from sand to stone across biome border
              const n = WG.randSeed(wx*9.71 + y*0.23);
              t = (n < pSandHoriz) ? T.SAND : T.STONE;
            }
          } else {
            // Deep layers: chance of diamond
            t = (WG.randSeed(wx*13.37 + y*0.7) < WG.diamondChance(y)?T.DIAMOND:T.STONE);
          }
          // Transitional mixing band around sandTh to avoid sharp sand↔stone lines
          if(t!==T.AIR){
            const band = 2; // apply within ±2 tiles of sandTh
            if(depth >= sandTh - band && depth < sandTh + band){
              const n = WG.randSeed(wx*9.71 + y*0.23);
              const desertFrac = bf? bf[3] : (desert?1:0);
              const coastFrac = bf? (bf[5]*0.7 + bf[6]*0.5) : ((sea||lake)?1:0);
              const sandFavor = Math.min(0.7, 0.15 + 0.6*(desertFrac + coastFrac));
              const stoneFavor = Math.min(0.6, 0.10 + 0.4*(1 - (desertFrac + coastFrac)));
              if(t===T.STONE && (n < sandFavor)) t=T.SAND; // sprinkle sand into stone just below boundary
              else if(t===T.SAND && (n < stoneFavor*0.4)) t=T.STONE; // some stone specks inside sand band
            }
          }
        }
  // Carve sea / lake water down to target level
        if(t===T.AIR){
          if(WG){
      if(biome===5){ // sea: fill only if this column is at/below sea level (avoid water perched on high ground)
              if(s <= SEA_LEVEL + 1){ if(y>=SEA_LEVEL) t=T.WATER; }
            } else if(biome===6){ // lake: fill only in depressions; set a local water level based on neighbor rim
              const rim = Math.min(neighMin, s + 12); // upper bound to avoid massive lakes
              const hasBasin = (s + 1 < rim); // current column is below rim
              if(hasBasin){
  const maxDepth = (WG.settings && WG.settings.lakeMaxDepth!==undefined)? WG.settings.lakeMaxDepth : 5; // cap lake depth
                const waterLevel = Math.min(rim - 1, s + maxDepth);
                if(y>=waterLevel) t=T.WATER;
              }
            } else if(biome===4){ // swamp: pockets of shallow water just below surface
              const swampDepth = 2; if(y>=s-1 && WG.randSeed(wx*11.7 + y*0.3) < 0.35) t=T.WATER;
            }
            // Mountain snowcaps icing: replace exposed shallow water with ice (rare lakes up high)
            if(biome===7 && t===T.WATER){ if(WG.randSeed(wx*17.7 + y*0.91) < 0.85) t=T.ICE; }
            if(biome===2 && t===T.WATER){ // cold biome freeze
              if(WG.randSeed(wx*5.5 + y*0.4) < 0.9) t=T.ICE;
            }
          }
        }
        arr[tileIndex(lx,y)]=t;
      }
    }
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
// ESM export (progressive migration)
export const world = (typeof window!== 'undefined' && window.MM) ? window.MM.world : undefined;
export default world;
