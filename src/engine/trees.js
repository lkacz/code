// Tree generation + falling system
import { CHUNK_W, WORLD_H, T, SNOW_LINE, HERO_BODY_W, HERO_BODY_H, isAutumnLeaf, isLeaf } from '../constants.js';
import { fallingWindResponseForMaterial, isPassableForFalling } from './material_physics.js';
import { heroLoadWeight } from './hero_crush.js';
import { authoritativeBodyBlocksCell, COOP_BODY_ONLY } from './body_footprint.js';
import { worldGen as WORLDGEN } from './worldgen.js';
window.MM = window.MM || {};
(function(){
  const WG = WORLDGEN;
  const trees = {};
  // Felled trees rotate as one body first; impact can shed detached block pieces.
  const fallingTrees = []; // {pivotX,pivotY,dir,angle,omega,tiles:[{rx,ry,ox,oy,t}]}
  const fallingBlocks = []; // detached pieces {x,y,t,dir,hBudget}
  let fallStepAccum = 0;
  const MAX_FALLING_TREES = 24;
  const ROT_STEP = 1/120;
  const tileTreeIds = new Map();      // "x,y" -> tree id for generated tree tiles
  const treeTiles = new Map();        // tree id -> Set("x,y")
  const chunkTreeKeys = new Map();    // chunk x -> Set("x,y")
  const fallenTreeTiles = new Set();  // settled pieces from falling trees
  const seasonalLeafLitter = new Map(); // "x,y" -> tree elapsed seconds when autumn leaf debris vanishes
  const unstableFallenTreeTiles = new Set();
  const unstableTreeTiles = new Set(); // still-standing tree material that may have lost support
  const TREE_DEBRIS_QUEUE_BUDGET = 700;
  const TREE_STABILITY_QUEUE_BUDGET = 240;
  const TREE_AREA_AUDIT_BUDGET = 180;
  const SEASONAL_LEAF_DECAY_SECONDS = 60;
  const SEASONAL_LEAF_CLEANUP_BUDGET = 18;
  const TREE_DEBRIS_PERSIST_CAP = 24000;
  const TREE_LOOSE_PERSIST_CAP = 24000;
  const TREE_IDENTITY_PERSIST_CAP = 48000;
  const TREE_LEAF_LITTER_PERSIST_CAP = 16000;
  const TREE_CHUNK_AUDIT_CAP = 2048;
  const TREE_PERSIST_KEY_MAX = 48;
  const TREE_ID_MAX = 160;
  const TREE_MAX_ABS_X = 30000000;
  let areaAuditCursor = 0;
  let treeElapsedSeconds = 0;
  let suppressFallenQueue = 0;
  const key = (x,y)=>x+','+y;
  const keyX = k=>+k.slice(0,k.indexOf(','));
  const keyY = k=>+k.slice(k.indexOf(',')+1);
  function parsePersistedTreeKey(raw){
    if(typeof raw!=='string' || !raw.length || raw.length>TREE_PERSIST_KEY_MAX || !/^-?\d+,\d+$/.test(raw)) return null;
    const comma=raw.indexOf(',');
    const x=Number(raw.slice(0,comma)), y=Number(raw.slice(comma+1));
    if(!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || Math.abs(x)>TREE_MAX_ABS_X || y<0 || y>=WORLD_H) return null;
    return {x,y,k:key(x,y)};
  }
  function hash01(x,y,salt){
    let h=Math.imul(x|0, 374761393) ^ Math.imul(y|0, 668265263) ^ Math.imul(salt|0, 1442695041);
    h=Math.imul(h ^ (h >>> 13), 1274126177);
    h=(h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }
  function treeChunkX(x){ return Math.floor(x/CHUNK_W); }
  function generatedTreeId(wx,s,variant){ return 'g:'+WG.worldSeed+':'+wx+':'+s+':'+variant; }
  function markTreeTile(id,x,y){
    const k=key(x,y);
    const prev=tileTreeIds.get(k);
    if(prev===id) return;
    if(prev){
      const oldSet=treeTiles.get(prev);
      if(oldSet){ oldSet.delete(k); if(!oldSet.size) treeTiles.delete(prev); }
    }
    tileTreeIds.set(k,id);
    let set=treeTiles.get(id); if(!set){ set=new Set(); treeTiles.set(id,set); }
    set.add(k);
    const cx=treeChunkX(x);
    let cset=chunkTreeKeys.get(cx); if(!cset){ cset=new Set(); chunkTreeKeys.set(cx,cset); }
    cset.add(k);
  }
  function unmarkTreeTile(x,y){
    const k=key(x,y);
    const id=tileTreeIds.get(k);
    if(!id) return;
    tileTreeIds.delete(k);
    const set=treeTiles.get(id);
    if(set){ set.delete(k); if(!set.size) treeTiles.delete(id); }
    const cx=treeChunkX(x);
    const cset=chunkTreeKeys.get(cx);
    if(cset){ cset.delete(k); if(!cset.size) chunkTreeKeys.delete(cx); }
  }
  function clearChunk(cx){
    if(!Number.isFinite(cx) || Math.abs(cx*CHUNK_W)>TREE_MAX_ABS_X) return;
    cx=Math.floor(cx);
    const cset=chunkTreeKeys.get(cx);
    if(cset){
      for(const k of [...cset]){
        const id=tileTreeIds.get(k);
        tileTreeIds.delete(k);
        const set=treeTiles.get(id);
        if(set){ set.delete(k); if(!set.size) treeTiles.delete(id); }
      }
      chunkTreeKeys.delete(cx);
    }
    for(const k of [...fallenTreeTiles]) if(treeChunkX(keyX(k))===cx) fallenTreeTiles.delete(k);
    for(const k of [...seasonalLeafLitter.keys()]) if(treeChunkX(keyX(k))===cx) seasonalLeafLitter.delete(k);
    for(const k of [...unstableFallenTreeTiles]) if(treeChunkX(keyX(k))===cx) unstableFallenTreeTiles.delete(k);
    for(const k of [...unstableTreeTiles]) if(treeChunkX(keyX(k))===cx) unstableTreeTiles.delete(k);
  }
  function clearTreeIdentityMaps(){ tileTreeIds.clear(); treeTiles.clear(); chunkTreeKeys.clear(); }
  function resetVolatileState(){ fallingTrees.length=0; fallingBlocks.length=0; fallenTreeTiles.clear(); seasonalLeafLitter.clear(); unstableFallenTreeTiles.clear(); unstableTreeTiles.clear(); fallStepAccum=0; areaAuditCursor=0; treeElapsedSeconds=0; }
  function resetIdentities(){ clearTreeIdentityMaps(); resetVolatileState(); }
  function markFallenTreeTile(x,y,t){ if(isFallenTreeMaterial(t)) fallenTreeTiles.add(key(x,y)); }
  function markSeasonalLeafLitter(x,y,t,seconds){
    if(!isAutumnLeaf(t)) return;
    const requested=Number(seconds);
    const base=Number.isFinite(requested) && requested>0
      ? Math.max(1,Math.min(SEASONAL_LEAF_DECAY_SECONDS,requested))
      : SEASONAL_LEAF_DECAY_SECONDS;
    const stagger=base >= 30 ? hash01(x,y,901) * 10 : 0;
    seasonalLeafLitter.set(key(x,y), treeElapsedSeconds + base + stagger);
  }
  function unmarkFallenTreeTile(x,y){ const k=key(x,y); fallenTreeTiles.delete(k); seasonalLeafLitter.delete(k); }
  function queueFallenTreeCheck(x,y){ if(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x)<=TREE_MAX_ABS_X && y>=0 && y<WORLD_H) unstableFallenTreeTiles.add(key(Math.floor(x),Math.floor(y))); }
  function queueStandingTreeCheck(x,y){ if(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x)<=TREE_MAX_ABS_X && y>=0 && y<WORLD_H) unstableTreeTiles.add(key(Math.floor(x),Math.floor(y))); }
  function queueFallenTreeAroundPlacement(x,y){
    queueFallenTreeCheck(x,y);
    queueFallenTreeCheck(x,y-1);
    queueFallenTreeCheck(x-1,y);
    queueFallenTreeCheck(x+1,y);
  }
  function queueFallenTreeAroundRemoval(x,y){
    queueFallenTreeCheck(x,y-1); queueFallenTreeCheck(x,y+1);
    queueFallenTreeCheck(x-1,y); queueFallenTreeCheck(x+1,y);
    queueFallenTreeCheck(x-1,y-1); queueFallenTreeCheck(x+1,y-1);
  }
  function queueStandingTreeAroundChange(x,y){
    queueStandingTreeCheck(x,y-1); queueStandingTreeCheck(x,y+1);
    queueStandingTreeCheck(x-1,y); queueStandingTreeCheck(x+1,y);
    queueStandingTreeCheck(x-1,y-1); queueStandingTreeCheck(x+1,y-1);
    queueStandingTreeCheck(x-1,y+1); queueStandingTreeCheck(x+1,y+1);
  }
  function queueStandingTreeCanopyAroundRemoval(x,y){
    for(let dy=-3; dy<=2; dy++) for(let dx=-3; dx<=3; dx++) queueStandingTreeCheck(x+dx,y+dy);
  }
  function onTileChanged(x,y,oldTile,newTile){
    if(!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x)>TREE_MAX_ABS_X) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    const k=key(tx,ty);
    const leafColorChange=isLeaf(oldTile) && isLeaf(newTile);
    if(!leafColorChange){
      unmarkTreeTile(tx,ty);
      unmarkFallenTreeTile(tx,ty);
    } else if(fallenTreeTiles.has(k) && isAutumnLeaf(newTile)){
      markSeasonalLeafLitter(tx,ty,newTile);
    }
    if(oldTile!==newTile && oldTile!==undefined && newTile!==undefined){
      if(!suppressFallenQueue) queueStandingTreeAroundChange(tx,ty);
      if(!isTreeMaterial(newTile,tx,ty)){
        if(!suppressFallenQueue && isTreeMaterial(oldTile,tx,ty)) queueStandingTreeCanopyAroundRemoval(tx,ty);
        if(!suppressFallenQueue) queueFallenTreeAroundRemoval(tx,ty);
      }
      else if(!suppressFallenQueue){ queueFallenTreeCheck(tx,ty); queueFallenTreeCheck(tx,ty-1); queueStandingTreeCheck(tx,ty); }
    }
  }
  function pruneChunk(arr,cx){
    if(!Number.isFinite(cx) || Math.abs(cx*CHUNK_W)>TREE_MAX_ABS_X) return;
    cx=Math.floor(cx);
    const cset=chunkTreeKeys.get(cx);
    if(!cset || !arr) return;
    for(const k of [...cset]){
      const x=keyX(k), y=keyY(k);
      const lx=x-cx*CHUNK_W;
      const t=(lx>=0 && lx<CHUNK_W && y>=0 && y<WORLD_H)? arr[y*CHUNK_W+lx] : T.AIR;
      if(!isTreeMaterial(t,x,y)) unmarkTreeTile(x,y);
    }
  }

  function treeSpacingFor(variant){
    if(variant==='megaOak') return 5;
    if(variant==='mangrove') return 1;
    if(variant==='palm') return 3;
    return 3;
  }
  function treeMinTrunkFor(variant){
    if(variant==='tallOak') return 7;
    if(variant==='megaOak' || variant==='palm') return 6;
    if(variant==='conifer') return 5;
    if(variant==='mangrove') return 3;
    return 4;
  }
  function rawTile(arr,x,y){ return (x>=0 && x<CHUNK_W && y>=0 && y<WORLD_H) ? arr[y*CHUNK_W+x] : T.AIR; }
  function rawTreeBase(arr,x,y){ return rawTile(arr,x,y)===T.WOOD && rawTile(arr,x,y+1)!==T.WOOD; }
  function canGrowTreeAt(arr,lx,s,variant){
    if(!arr) return false;
    const minTrunk=treeMinTrunkFor(variant);
    for(let i=1;i<=minTrunk;i++){
      const y=s-i;
      if(y<0) return false;
      if(arr[y*CHUNK_W+lx]!==T.AIR) return false;
    }
    const spacing=treeSpacingFor(variant);
    const x0=Math.max(0,lx-spacing);
    const x1=Math.min(CHUNK_W-1,lx+spacing);
    const y0=Math.max(0,s-4);
    const y1=Math.min(WORLD_H-2,s+2);
    for(let x=x0;x<=x1;x++){
      for(let y=y0;y<=y1;y++){
        if(rawTreeBase(arr,x,y)) return false;
      }
    }
    return true;
  }

  function canPlantSurfaceTile(t){
    return t===T.GRASS || t===T.GRASS_SNOW || t===T.SNOW || t===T.SAND || t===T.STONE || t===T.MUD ||
      t===T.FROZEN_DIRT || t===T.FROZEN_SAND || t===T.FROZEN_CLAY;
  }
  function bushChanceFor(biome,island,s,patch){
    if(island) return 0.10;
    if(biome===0) return 0.14 + (patch>0.62 ? 0.10 : (patch>0.52 ? 0.05 : 0));
    if(biome===1) return 0.13;
    if(biome===2) return 0.07;
    if(biome===4) return 0.18;
    if(biome===7) return s<SNOW_LINE ? 0.035 : 0.06;
    return 0.05;
  }
  function bushVariantFor(biome,island,wx,s){
    if(island) return 'island';
    if(biome===4) return 'bog';
    if(biome===2 || s<SNOW_LINE) return WG.randSeed(wx+934)>0.66 ? 'tall' : 'round';
    if(biome===7) return WG.randSeed(wx+935)>0.58 ? 'wide' : 'round';
    if(biome===1) return WG.randSeed(wx+930)>0.62 ? 'wide' : 'round';
    if(biome===0) return WG.randSeed(wx+931)>0.72 ? 'tall' : 'round';
    return 'round';
  }
  function bushRadiusFor(variant){
    if(variant==='wide' || variant==='bog' || variant==='island') return 2;
    return 1;
  }
  function bushMaxHeightFor(variant){
    if(variant==='tall') return 3;
    if(variant==='round') return 2;
    return 2;
  }
  function canGrowBushAt(arr,lx,s,variant){
    if(!arr || s<2 || !canPlantSurfaceTile(rawTile(arr,lx,s))) return false;
    const radius=bushRadiusFor(variant);
    const height=bushMaxHeightFor(variant);
    for(let dx=-radius; dx<=radius; dx++){
      const x=lx+dx;
      if(x<0 || x>=CHUNK_W) continue;
      const foot=rawTile(arr,x,s);
      if(foot!==T.AIR && !canPlantSurfaceTile(foot)) return false;
      for(let dy=1; dy<=height; dy++){
        const y=s-dy;
        if(y<0 || rawTile(arr,x,y)!==T.AIR) return false;
      }
    }
    const spacing=Math.max(2,radius+1);
    for(let x=Math.max(0,lx-spacing); x<=Math.min(CHUNK_W-1,lx+spacing); x++){
      for(let y=Math.max(0,s-height-3); y<=Math.min(WORLD_H-2,s+1); y++){
        const t=rawTile(arr,x,y);
        if(t===T.WOOD || rawTreeBase(arr,x,y) || isLeaf(t)) return false;
      }
    }
    return true;
  }
  function buildBush(arr,lx,s,variant,wx){
    function tileIndex(x,y){ return y*CHUNK_W+x; }
    const id=generatedTreeId(wx,s,'bush:'+variant);
    const randSeed=WG.randSeed;
    function put(localX,y){
      if(y>=0 && y<WORLD_H && localX>=0 && localX<CHUNK_W){
        const idx=tileIndex(localX,y);
        if(arr[idx]===T.AIR){
          arr[idx]=T.LEAF;
          markTreeTile(id, wx + (localX-lx), y);
        }
      }
    }
    put(lx,s-1);
    if(variant==='tall'){
      put(lx,s-2);
      if(randSeed(wx*6.17+3)>0.36) put(lx,s-3);
      if(randSeed(wx*6.17+5)>0.24) put(lx-1,s-1);
      if(randSeed(wx*6.17+7)>0.24) put(lx+1,s-1);
      if(randSeed(wx*6.17+9)>0.62) put(lx-1,s-2);
      if(randSeed(wx*6.17+11)>0.62) put(lx+1,s-2);
      return;
    }
    if(variant==='wide' || variant==='bog' || variant==='island'){
      for(let dx=-2; dx<=2; dx++){
        const edge=Math.abs(dx)===2;
        if(!edge || randSeed(wx*5.11+dx*19+17)>0.30) put(lx+dx,s-1);
      }
      for(let dx=-1; dx<=1; dx++){
        if(randSeed(wx*5.11+dx*23+41)>0.18) put(lx+dx,s-2);
      }
      if(variant==='bog' && randSeed(wx*5.11+83)>0.55) put(lx,s-3);
      return;
    }
    if(randSeed(wx*4.71+13)>0.18) put(lx-1,s-1);
    if(randSeed(wx*4.71+29)>0.18) put(lx+1,s-1);
    if(randSeed(wx*4.71+43)>0.35) put(lx,s-2);
    if(randSeed(wx*4.71+59)>0.72) put(lx-1,s-2);
    if(randSeed(wx*4.71+61)>0.72) put(lx+1,s-2);
  }

  function buildTree(arr,lx,s,variant,wx){
    function tileIndex(x,y){ return y*CHUNK_W+x; }
    const id=generatedTreeId(wx,s,variant);
    function put(localX,y,t){
      if(y>=0 && y<WORLD_H && localX>=0 && localX<CHUNK_W){
        const idx=tileIndex(localX,y);
        if(arr[idx]===T.AIR){
          arr[idx]=t;
          markTreeTile(id, wx + (localX-lx), y);
        }
      }
    }
    const snowy = s < SNOW_LINE;
    const randSeed = WG.randSeed;
    if(variant==='conifer'){
      const trunkH=5+Math.floor(randSeed(wx+10)*4);
      for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      // Solid interior with a jittered rim only, and just a one-row snow dusting:
      // random interior holes + a two-row white cap used to read as a beheaded
      // crown with floating leaf chunks against a bright winter sky.
      const crownH=trunkH+1; for(let dy=0; dy<crownH; dy++){ const radius=Math.max(0, Math.floor((crownH-dy)/3)); const cy=s-1-trunkH+1 - dy; if(cy<0) break; for(let dx=-radius; dx<=radius; dx++){ if(Math.abs(dx)<radius || randSeed(wx*3.1 + dy*7 + dx*11) < 0.85){ put(lx+dx,cy, (snowy && dy<1)?T.SNOW:T.LEAF); } } }
      if(snowy) put(lx, s-1-trunkH, T.SNOW);
    } else if(variant==='megaOak'){
      const trunkH=6+Math.floor(randSeed(wx+20)*5); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      // dist<=spread-1 keeps the canopy core solid; jitter shapes only the rim
      const spread=3+Math.floor(randSeed(wx+40)*2); const top=s-1-trunkH; for(let dy=-spread; dy<=spread; dy++){ for(let dx=-spread; dx<=spread; dx++){ const dist=Math.abs(dx)+Math.abs(dy)*0.7; if(dist<=spread-1 || dist<=spread+ (randSeed(wx+dx*13+dy*17)-0.35)){ put(lx+dx, top+dy, T.LEAF); } } }
    } else if(variant==='tallOak'){
      const trunkH=7+Math.floor(randSeed(wx+60)*4); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      const top=s-1-trunkH; const spread=2; for(let dy=-2; dy<=2; dy++){ for(let dx=-spread; dx<=spread; dx++){ if(Math.abs(dx)+Math.abs(dy)*0.9<=spread+0.3){ put(lx+dx, top+dy, T.LEAF); } } }
    } else if(variant==='mangrove'){
      const trunkH=3+Math.floor(randSeed(wx+73)*3);
      for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      put(lx-1,s-1,T.WOOD); put(lx+1,s-1,T.WOOD);
      put(lx-2,s-1,T.WOOD); put(lx+2,s-1,T.WOOD);
      if(randSeed(wx+75)>0.38) put(lx-3,s-1,T.WOOD);
      if(randSeed(wx+76)>0.38) put(lx+3,s-1,T.WOOD);
      const top=s-1-trunkH;
      for(let dy=-3; dy<=2; dy++){
        for(let dx=-4; dx<=4; dx++){
          const dist=Math.abs(dx)*0.68+Math.abs(dy)*0.88;
          if(dist<=1.8 || dist<=3.05+(randSeed(wx+dx*23+dy*29)-0.42)) put(lx+dx,top+dy,T.LEAF);
        }
      }
    } else if(variant==='palm'){
      // Desert-island palm: tall bare trunk, a fan of fronds arcing from the crown
      // with drooping tips (kept 4-connected so felling collects the whole canopy)
      const trunkH=6+Math.floor(randSeed(wx+91)*3);
      for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      const top=s-1-trunkH;
      put(lx,top,T.LEAF); put(lx,top-1,T.LEAF);
      for(const d of [-1,1]){
        put(lx+d,top,T.LEAF);
        put(lx+2*d,top,T.LEAF);
        put(lx+2*d,top+1,T.LEAF); // drooping frond tip
        put(lx+d,top-1,T.LEAF);   // upward arc near the crown
      }
    } else { // oak
      const trunkH=4+Math.floor(randSeed(wx+80)*3); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      const top=s-1-trunkH; const spread=2; for(let dy=-2; dy<=2; dy++){ for(let dx=-spread; dx<=spread; dx++){ const dist=Math.abs(dx)+Math.abs(dy)*0.8; if(dist<=spread-1 || dist<=spread+ (randSeed(wx+dx*31+dy*19)-0.25)){ put(lx+dx, top+dy, T.LEAF); } } }
    }
  }

  function isTreeBase(getTile,x,y){ if(getTile(x,y)!==T.WOOD) return false; if(getTile(x,y-1)!==T.WOOD) return false; const below=getTile(x,y+1); return below!==T.WOOD; }

  function isCrownSnow(x,y){
    const surface = (WG && typeof WG.surfaceHeight==='function') ? WG.surfaceHeight(x) : WORLD_H;
    return y < surface;
  }
  function isFoliage(t,x,y){ return isLeaf(t) || (t===T.SNOW && isCrownSnow(x,y)); }

  function notifyRemoved(getTile,x,y){
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
  }

  function findStem(getTile,x,y){
    if(getTile(x,y)!==T.WOOD) return null;
    let top=y, bottom=y;
    while(top>0 && getTile(x,top-1)===T.WOOD) top--;
    while(bottom<WORLD_H-1 && getTile(x,bottom+1)===T.WOOD) bottom++;
    const tiles=[];
    for(let ty=top; ty<=bottom; ty++) tiles.push({x,y:ty,t:T.WOOD});
    return {x,top,bottom,height:bottom-top+1,tiles};
  }

  function hasWoodRun(getTile,x,yMin,yMax){
    for(let y=Math.max(0,yMin); y<Math.min(WORLD_H-1,yMax); y++){
      if(getTile(x,y)===T.WOOD && getTile(x,y+1)===T.WOOD) return true;
    }
    return false;
  }

  function nearbyTrunks(getTile,stem){
    const out=[];
    const reach=8;
    const yMin=stem.top - Math.max(4, stem.height+3);
    const yMax=stem.bottom + 3;
    for(let tx=stem.x-reach; tx<=stem.x+reach; tx++){
      if(tx===stem.x) continue;
      if(hasWoodRun(getTile,tx,yMin,yMax)) out.push(tx);
    }
    return out;
  }

  function belongsToStem(cx,stem,trunks){
    const rootDist=Math.abs(cx-stem.x);
    for(const tx of trunks){
      if(Math.abs(cx-tx)<=rootDist) return false;
    }
    return true;
  }

  function isTreeMaterial(t,x,y){ return t===T.WOOD || isFoliage(t,x,y); }
  function isFallenTreeMaterial(t){ return t===T.WOOD || isLeaf(t) || t===T.SNOW; }
  function fallsAsTreeDebris(t){ return isFallenTreeMaterial(t); }

  function collectRegisteredTreeTiles(getTile,setTile,id,stem){
    const set=treeTiles.get(id);
    if(!set) return [];
    const out=[];
    const vis=new Set();
    const stack=stem.tiles.map(tile=>[tile.x,tile.y]);
    const yMin=stem.top - Math.max(4, stem.height+3);
    const yMax=stem.bottom + 3;
    let guard=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      const k=key(cx,cy);
      if(vis.has(k) || !set.has(k)) continue;
      if(cy<yMin || cy>yMax) continue;
      const t=getTile(cx,cy);
      if(!isTreeMaterial(t,cx,cy)){ unmarkTreeTile(cx,cy); continue; }
      if(t===T.WOOD && cy>stem.bottom) continue;
      vis.add(k);
      out.push({x:cx,y:cy,t});
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1],[cx,cy-2]);
      if(++guard>700) break;
    }
    out.forEach(tile=>{ unmarkTreeTile(tile.x,tile.y); setTile(tile.x,tile.y,T.AIR); });
    return out;
  }

  function collectRegisteredCrownTiles(getTile,setTile,id,x,y){
    const set=treeTiles.get(id);
    if(!set || !isFoliage(getTile(x,y),x,y)) return [];
    const out=[];
    const vis=new Set();
    const stack=[[x,y]];
    let guard=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      const k=key(cx,cy);
      if(vis.has(k) || !set.has(k)) continue;
      const t=getTile(cx,cy);
      if(!isFoliage(t,cx,cy)){
        if(!isTreeMaterial(t,cx,cy)) unmarkTreeTile(cx,cy);
        continue;
      }
      vis.add(k);
      out.push({x:cx,y:cy,t});
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      if(++guard>450) break;
    }
    out.forEach(tile=>{ unmarkTreeTile(tile.x,tile.y); setTile(tile.x,tile.y,T.AIR); });
    return out;
  }

  function collectInferredTreeTiles(getTile,setTile,stem){
    const trunks=nearbyTrunks(getTile,stem);
    const out=[...stem.tiles];
    const vis=new Set(out.map(t=>t.x+','+t.y));
    const stack=stem.tiles.map(t=>[t.x,t.y]);
    const xReach=5;
    const yMin=stem.top - Math.max(4, stem.height+3);
    const yMax=stem.bottom + 3;
    let guard=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1],[cx,cy-2]]){
        const k=nx+','+ny;
        if(vis.has(k)) continue;
        if(Math.abs(nx-stem.x)>xReach || ny<yMin || ny>yMax) continue;
        const tt=getTile(nx,ny);
        if(!isFoliage(tt,nx,ny) || !belongsToStem(nx,stem,trunks)) continue;
        vis.add(k);
        out.push({x:nx,y:ny,t:tt});
        stack.push([nx,ny]);
        if(++guard>600) break;
      }
      if(guard>600) break;
    }
    out.forEach(tile=>{ unmarkTreeTile(tile.x,tile.y); setTile(tile.x,tile.y,T.AIR); });
    return out;
  }

  function collectLooseCrownTiles(getTile,setTile,x,y){
    if(!isFoliage(getTile(x,y),x,y)) return [];
    const out=[];
    const vis=new Set();
    const stack=[[x,y]];
    const xReach=5;
    const yMin=y-5, yMax=y+2;
    let guard=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      const k=key(cx,cy);
      if(vis.has(k)) continue;
      if(Math.abs(cx-x)>xReach || cy<yMin || cy>yMax) continue;
      const t=getTile(cx,cy);
      if(!isFoliage(t,cx,cy)) continue;
      vis.add(k);
      out.push({x:cx,y:cy,t});
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      if(++guard>450) break;
    }
    out.forEach(tile=>{ unmarkTreeTile(tile.x,tile.y); setTile(tile.x,tile.y,T.AIR); });
    return out;
  }

  function collectTreeTiles(getTile,setTile,x,y){
    const stem=findStem(getTile,x,y);
    if(!stem){
      const t=getTile(x,y);
      const id=tileTreeIds.get(key(x,y));
      if(id && isTreeMaterial(t,x,y)){
        const tiles=collectRegisteredCrownTiles(getTile,setTile,id,x,y);
        if(tiles.length) return {tiles, stem:null, mode:'registeredCrown'};
      }
      return {tiles:collectLooseCrownTiles(getTile,setTile,x,y), stem:null, mode:'crown'};
    }
    const id=tileTreeIds.get(key(x,y));
    if(id){
      const tiles=collectRegisteredTreeTiles(getTile,setTile,id,stem);
      if(tiles.length) return {tiles, stem, mode:'registered'};
    }
    return {tiles:collectInferredTreeTiles(getTile,setTile,stem), stem, mode:'inferred'};
  }

  function makeRotatingTree(tiles,stem,dir){
    const pivotX=stem.x+0.5, pivotY=stem.bottom+0.5;
    return {
      pivotX,pivotY,
      dir:dir<0?-1:1,
      angle:0,
      omega:0,
      tiles:tiles.filter(tile=>fallsAsTreeDebris(tile.t)).map(tile=>({rx:tile.x+0.5-pivotX, ry:tile.y+0.5-pivotY, ox:tile.x, oy:tile.y, t:tile.t}))
    };
  }

  function startTreeFall(getTile,setTile,playerFacing,x,y){
    if(typeof getTile!=='function' || typeof setTile!=='function' || !Number.isFinite(x) || !Number.isFinite(y)
      || Math.abs(x)>TREE_MAX_ABS_X || y<0 || y>=WORLD_H) return false;
    x=Math.floor(x); y=Math.floor(y);
    const collected=collectTreeTiles(getTile,setTile,x,y);
    const tiles=collected.tiles;
    if(!tiles.length) return false;
    tiles.forEach(tile=>notifyRemoved(getTile,tile.x,tile.y));
    if(!collected.stem || collected.stem.height<2){
      const dir=normalizeDir(playerFacing||1);
      tiles.forEach(tile=>{ if(fallsAsTreeDebris(tile.t)) fallingBlocks.push(makeFallingPiece(tile.x,tile.y,tile.t,dir)); });
      return true;
    }
    const tree=makeRotatingTree(tiles,collected.stem,playerFacing||1);
    if(tree.tiles.length) fallingTrees.push(tree);
    while(fallingTrees.length>MAX_FALLING_TREES){ const old=fallingTrees.shift(); landTree(getTile,setTile,old,landedAngle(old)); }
    return true;
  }

  // Felled blocks share pass-through rules with rigid falling solids, but still
  // collide with standing foliage so wood can crush or slide off tree crowns.
  function passThrough(t){ return !isLeaf(t) && isPassableForFalling(t); }
  // Keep host-only load accounting separate from the shared settlement probe:
  // debris resting on a guest must not count as crush weight on the host.
  function hostPlayerBlocks(x,y){
    const p=(typeof window!=='undefined' && window.player) ? window.player : null;
    if(!p) return false;
    const w=Number.isFinite(p.w)&&p.w>0?p.w:HERO_BODY_W, h=Number.isFinite(p.h)&&p.h>0?p.h:HERO_BODY_H;
    return x+1 > p.x-w/2 && x < p.x+w/2 && y+1 > p.y-h/2 && y < p.y+h/2;
  }
  function bodyBlocks(x,y){ return authoritativeBodyBlocksCell(x,y); }
  function guestBodyBlocks(x,y){ return authoritativeBodyBlocksCell(x,y,COOP_BODY_ONLY); }
  function forcedBodyFreeRest(getTile,startX,startY){
    for(let radius=0;radius<=8;radius++){
      const offsets=radius===0?[0]:[-radius,radius];
      for(const dx of offsets){
        const x=startX+dx;
        let y=Math.max(0,Math.min(WORLD_H-1,Math.floor(startY)));
        while(y>0 && !passThrough(getTile(x,y))) y--;
        if(!passThrough(getTile(x,y))) continue;
        while(y<WORLD_H-1 && passThrough(getTile(x,y+1))) y++;
        if(y+1<WORLD_H && standingTreeSupportAt(getTile,x,y+1)) continue;
        if(!bodyBlocks(x,y)) return {x,y};
      }
    }
    return null;
  }
  function normalizeDir(dir){ return dir<0?-1:(dir>0?1:0); }
  function windSpeedAt(getTile,x,y){
    try{
      const w=window.MM && MM.wind;
      if(!w) return 0;
      const v=typeof w.speedAt === 'function'
        ? w.speedAt(x,y,getTile)
        : (typeof w.speed === 'function' ? w.speed() : 0);
      return Number.isFinite(v) ? Math.max(-6, Math.min(6, v)) : 0;
    }catch(e){ return 0; }
  }
  function treeWindResponse(t){
    if(isLeaf(t) || t===T.SNOW) return 0.55;
    const base=fallingWindResponseForMaterial(t,false);
    if(t===T.WOOD) return Math.max(0.10,base*2.0);
    return Math.max(0.08,Math.min(0.55,base*2.5));
  }
  function pileRollBudget(t){ return t===T.WOOD ? 4 : 6; }
  function makeFallingPiece(x,y,t,dir,hBudget){
    return {
      x:Math.floor(x),
      y:Math.max(0, Math.min(WORLD_H-1, Math.floor(y))),
      t,
      dir:normalizeDir(dir),
      hBudget:Math.max(0, hBudget==null ? pileRollBudget(t) : hBudget|0),
      windCarry:0
    };
  }
  function restoredFallingPiece(raw){
    try{
      if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isInteger(raw.t)) return null;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(!Number.isSafeInteger(x) || Math.abs(x)>TREE_MAX_ABS_X || y<0 || y>=WORLD_H || !fallsAsTreeDebris(raw.t)) return null;
      const hBudget=Number.isFinite(raw.hBudget) ? Math.max(0,Math.min(8,Math.floor(raw.hBudget))) : pileRollBudget(raw.t);
      const piece=makeFallingPiece(x,y,raw.t,raw.dir,hBudget);
      piece.windCarry=Number.isFinite(raw.windCarry) ? Math.max(-4,Math.min(4,raw.windCarry)) : 0;
      return piece;
    }catch(e){ return null; }
  }
  function canOccupy(getTile,occ,x,y){ return y>=0 && y<WORLD_H && passThrough(getTile(x,y)) && !(occ && occ.has(key(x,y))); }
  function applyWindToPiece(getTile,b,occ,dt){
    if(!b || !(dt>0)) return false;
    const sp=windSpeedAt(getTile,b.x+0.5,b.y+0.5);
    if(Math.abs(sp)<0.08) return false;
    b.windCarry=Math.max(-2.2, Math.min(2.2, (b.windCarry||0) + sp*treeWindResponse(b.t)*dt));
    let moved=false, guard=0;
    while(Math.abs(b.windCarry)>=1 && guard++<2){
      const dir=b.windCarry<0 ? -1 : 1;
      const oldKey=key(b.x,b.y);
      if(!canOccupy(getTile,occ,b.x+dir,b.y)){ b.windCarry*=0.35; break; }
      if(occ) occ.delete(oldKey);
      b.x+=dir;
      b.windCarry-=dir;
      if(occ) occ.add(key(b.x,b.y));
      moved=true;
    }
    return moved;
  }
  function pileSupportAt(occ,x,y){ const k=key(x,y); return (occ && occ.has(k)) || fallenTreeTiles.has(k); }
  function nearbyWoodRun(getTile,x,y,rx,up,down){
    for(let tx=x-rx; tx<=x+rx; tx++){
      for(let ty=Math.max(0,y-up); ty<=Math.min(WORLD_H-1,y+down); ty++){
        if(getTile(tx,ty)===T.WOOD && (getTile(tx,ty-1)===T.WOOD || getTile(tx,ty+1)===T.WOOD)) return true;
      }
    }
    return false;
  }
  function nearbyFoliage(getTile,x,y,rx,up,down){
    for(let tx=x-rx; tx<=x+rx; tx++){
      for(let ty=Math.max(0,y-up); ty<=Math.min(WORLD_H-1,y+down); ty++){
        if(isFoliage(getTile(tx,ty),tx,ty)) return true;
      }
    }
    return false;
  }
  function standingTreeSupportAt(getTile,x,y){
    if(y<0 || y>=WORLD_H) return false;
    const k=key(x,y);
    if(fallenTreeTiles.has(k)) return false;
    const t=getTile(x,y);
    if(!isTreeMaterial(t,x,y)) return false;
    if(tileTreeIds.has(k)) return true;
    if(isFoliage(t,x,y)) return true;
    return t===T.WOOD && nearbyWoodRun(getTile,x,y,1,2,2) && nearbyFoliage(getTile,x,y,4,6,2);
  }
  function rollDepth(getTile,occ,x,y){
    let depth=0, cy=y;
    while(depth<8 && canOccupy(getTile,occ,x,cy+1)){ cy++; depth++; }
    return depth;
  }
  function choosePileRollDir(getTile,b,occ){
    if((b.hBudget||0)<=0) return 0;
    const dirs=[];
    for(const dir of [-1,1]){
      const nx=b.x+dir, ny=b.y+1;
      if(canOccupy(getTile,occ,nx,b.y) && canOccupy(getTile,occ,nx,ny)) dirs.push(dir);
    }
    if(!dirs.length) return 0;
    if(dirs.length===1) return dirs[0];
    const lDepth=rollDepth(getTile,occ,b.x-1,b.y+1);
    const rDepth=rollDepth(getTile,occ,b.x+1,b.y+1);
    if(lDepth!==rDepth) return lDepth>rDepth ? -1 : 1;
    if(b.dir && dirs.includes(b.dir)) return b.dir;
    return ((b.x*31 + b.y*17 + b.t*13)&1) ? 1 : -1;
  }
  function tryRollOnPile(getTile,b,occ){
    if(!pileSupportAt(occ,b.x,b.y+1)) return false;
    const dir=choosePileRollDir(getTile,b,occ);
    if(!dir) return false;
    b.x+=dir;
    b.y=Math.min(WORLD_H-1,b.y+1);
    b.hBudget=Math.max(0,(b.hBudget||0)-1);
    return true;
  }
  function chooseTreeSlideDir(getTile,b,occ){
    if((b.hBudget||0)<=0) return 0;
    const dirs=b.dir ? [b.dir,-b.dir] : [-1,1];
    let best=0, bestScore=-1;
    for(const dir of dirs){
      const nx=b.x+dir;
      if(!canOccupy(getTile,occ,nx,b.y)) continue;
      let score=1;
      if(canOccupy(getTile,occ,nx,b.y+1)) score=30+rollDepth(getTile,occ,nx,b.y+1);
      else if(standingTreeSupportAt(getTile,nx,b.y+1)) score=10;
      else if(pileSupportAt(occ,nx,b.y+1)) score=5;
      if(score>bestScore){ bestScore=score; best=dir; }
    }
    return best;
  }
  function trySlideOffStandingTree(getTile,b,occ){
    if(!standingTreeSupportAt(getTile,b.x,b.y+1)) return false;
    const dir=chooseTreeSlideDir(getTile,b,occ);
    if(!dir) return false;
    b.x+=dir;
    if(canOccupy(getTile,occ,b.x,b.y+1)) b.y=Math.min(WORLD_H-1,b.y+1);
    b.hBudget=Math.max(0,(b.hBudget||0)-1);
    return true;
  }
  function crushStandingFoliage(getTile,setTile,x,y){
    const t=getTile(x,y);
    if(!isFoliage(t,x,y) || !standingTreeSupportAt(getTile,x,y)) return false;
    unmarkTreeTile(x,y);
    unmarkFallenTreeTile(x,y);
    setTile(x,y,T.AIR);
    queueStandingTreeAroundChange(x,y);
    queueFallenTreeAroundRemoval(x,y);
    notifyRemoved(getTile,x,y);
    return true;
  }
  // Settle a felled block into the world without destroying terrain or water:
  // bump up out of any cell claimed meanwhile, displace water instead of deleting it.
  // Returns 'body' when a live settle overlaps any host-owned player footprint.
  // Forced save settlement preserves the host burial-resolver contract but diverts
  // around guests, which have no local resolver to repair a serialized overlap.
  function settleTreeBlock(getTile,setTile,b,force){
    let x=Math.floor(b.x);
    let y=Math.max(0, Math.min(WORLD_H-1, Math.floor(b.y)));
    while(y>0 && !passThrough(getTile(x,y))) y--;
    if(!passThrough(getTile(x,y))) return false;
    if(y+1<WORLD_H && standingTreeSupportAt(getTile,x,y+1)) return false;
    if(bodyBlocks(x,y)){
      if(!force) return 'body';
      // Keep the legacy host-save contract (hero_crush re-loosens that tile), but
      // a remote body has no local burial resolver and must always be avoided.
      if(guestBodyBlocks(x,y)){
        const rest=forcedBodyFreeRest(getTile,x,y);
        if(!rest) return 'body';
        x=rest.x; y=rest.y;
      }
    }
    const was=getTile(x,y);
    if(was===T.WATER){ try{ if(MM.water && MM.water.displaceAt) MM.water.displaceAt(x,y,getTile,setTile); }catch(e){} }
    setTile(x,y,b.t);
    markFallenTreeTile(x,y,b.t);
    markSeasonalLeafLitter(x,y,b.t);
    queueFallenTreeAroundPlacement(x,y);
    try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement) MM.fallingSolids.afterPlacement(x,y); }catch(e){}
    if(was===T.WATER){ try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){} }
    return y;
  }
  function dropSeasonalLeaf(){
    return false;
  }
  function dropToRest(getTile,setTile,b,force){
    const piece=makeFallingPiece(b.x,b.y,b.t,b.dir,b.hBudget);
    const settle=()=>{
      const res=settleTreeBlock(getTile,setTile,piece,force);
      if(res==='body'){ piece.onHero=hostPlayerBlocks(piece.x,piece.y); fallingBlocks.push(piece); return false; }
      return res;
    };
    let guard=0;
    while(guard++<80){
      while(piece.y>0 && !passThrough(getTile(piece.x,piece.y))) piece.y--;
      while(piece.y<WORLD_H-1 && passThrough(getTile(piece.x,piece.y+1))) piece.y++;
      if(standingTreeSupportAt(getTile,piece.x,piece.y+1)){
        if(piece.t===T.WOOD && crushStandingFoliage(getTile,setTile,piece.x,piece.y+1)) continue;
        if(trySlideOffStandingTree(getTile,piece,null)) continue;
        return false;
      }
      if(tryRollOnPile(getTile,piece,null)) continue;
      return settle();
    }
    return settle();
  }
  function transformedTile(tree,tile,angle){
    const c=Math.cos(angle), s=Math.sin(angle);
    const cx=tree.pivotX + tile.rx*c - tile.ry*s;
    const cy=tree.pivotY + tile.rx*s + tile.ry*c;
    return {x:Math.floor(cx), y:Math.floor(cy), cx, cy};
  }
  function landedAngle(tree){ return tree.dir*Math.PI/2; }
  function reachedLandedAngle(tree){ const target=landedAngle(tree); return tree.dir>0? tree.angle>=target-0.001 : tree.angle<=target+0.001; }
  function clampToLanded(tree,next){ const target=landedAngle(tree); if(tree.dir>0 && next>target) return target; if(tree.dir<0 && next<target) return target; return next; }
  function tileBlocked(getTile,x,y){ return y>=WORLD_H || (y>=0 && !passThrough(getTile(x,y))); }
  function detachAt(tree,tile,pos){
    if(!fallsAsTreeDebris(tile.t)) return;
    const y=Math.max(0, Math.min(WORLD_H-1, pos.y));
    fallingBlocks.push(makeFallingPiece(pos.x,Math.max(0,y-1),tile.t,tree.dir));
  }
  function landTree(getTile,setTile,tree,angle,force){
    const placed=new Set();
    const tiles=tree.tiles.map(tile=>({tile,pos:transformedTile(tree,tile,angle)})).sort((a,b)=>b.pos.y-a.pos.y);
    tiles.forEach(({tile,pos})=>{
      while(pos.y>0 && placed.has(pos.x+','+pos.y)) pos.y--;
      if(placed.has(pos.x+','+pos.y)) return;
      placed.add(pos.x+','+pos.y);
      dropToRest(getTile,setTile,makeFallingPiece(pos.x,pos.y,tile.t,tree.dir),force);
    });
  }
  function updateFallingTreesStep(getTile,setTile,dt){
    if(!fallingTrees.length) return;
    const ROT_ACCEL=5.2, ROT_MAX=2.9;
    for(let i=fallingTrees.length-1;i>=0;i--){
      const tree=fallingTrees[i];
      tree.omega += tree.dir*ROT_ACCEL*dt;
      if(Math.abs(tree.omega)>ROT_MAX) tree.omega=tree.dir*ROT_MAX;
      const nextAngle=clampToLanded(tree, tree.angle + tree.omega*dt);
      const hits=[];
      for(let j=0;j<tree.tiles.length;j++){
        const tile=tree.tiles[j];
        const pos=transformedTile(tree,tile,nextAngle);
        if(tileBlocked(getTile,pos.x,pos.y)) hits.push({index:j,tile,pos});
      }
      tree.angle=nextAngle;
      if(hits.length){
        const remove=new Set(hits.map(h=>h.index));
        hits.forEach(h=>detachAt(tree,h.tile,h.pos));
        tree.tiles=tree.tiles.filter((_,idx)=>!remove.has(idx));
        tree.omega*=0.45;
      }
      if(!tree.tiles.length){ fallingTrees.splice(i,1); continue; }
      if(reachedLandedAngle(tree)){
        landTree(getTile,setTile,tree,tree.angle);
        fallingTrees.splice(i,1);
      }
    }
  }
  function updateFallingTrees(getTile,setTile,dt){
    if(!fallingTrees.length) return;
    let remaining=Math.max(0, Math.min(0.25, dt||0));
    while(remaining>0 && fallingTrees.length){
      const step=Math.min(ROT_STEP, remaining);
      updateFallingTreesStep(getTile,setTile,step);
      remaining-=step;
    }
  }
  function releaseFallenTreeTile(getTile,setTile,x,y,t,dir){
    unmarkFallenTreeTile(x,y);
    setTile(x,y,T.AIR);
    if(fallsAsTreeDebris(t)) fallingBlocks.push(makeFallingPiece(x,y,t,dir||0));
    queueFallenTreeAroundRemoval(x,y);
    notifyRemoved(getTile,x,y);
  }
  function processFallenTreeQueue(getTile,setTile,budget=TREE_DEBRIS_QUEUE_BUDGET){
    if(!unstableFallenTreeTiles.size) return;
    for(const k of unstableFallenTreeTiles){
      if(budget--<=0) break;
      unstableFallenTreeTiles.delete(k);
      if(!fallenTreeTiles.has(k)) continue;
      const x=keyX(k), y=keyY(k);
      const t=getTile(x,y);
      if(!isFallenTreeMaterial(t)){ unmarkFallenTreeTile(x,y); continue; }
      if(y+1>=WORLD_H) continue;
      if(passThrough(getTile(x,y+1))) releaseFallenTreeTile(getTile,setTile,x,y,t);
      else if(standingTreeSupportAt(getTile,x,y+1)) releaseFallenTreeTile(getTile,setTile,x,y,t);
      else if(t===T.WOOD && pileSupportAt(null,x,y+1)){
        const probe=makeFallingPiece(x,y,t,0);
        const dir=choosePileRollDir(getTile,probe,null);
        if(dir) releaseFallenTreeTile(getTile,setTile,x,y,t,dir);
      }
    }
  }
  function suspiciousStandingSupport(getTile,x,y){
    if(y+1>=WORLD_H) return false;
    const below=getTile(x,y+1);
    const belowKey=key(x,y+1);
    return passThrough(below) || isTreeMaterial(below,x,y+1) || fallenTreeTiles.has(belowKey);
  }
  function suspiciousFallenTreeSupport(getTile,x,y){
    if(y+1>=WORLD_H) return false;
    return passThrough(getTile(x,y+1)) || standingTreeSupportAt(getTile,x,y+1);
  }
  function sameRegisteredStandingComponentTile(getTile,id,x,y){
    const k=key(x,y);
    if(fallenTreeTiles.has(k)) return false;
    const t=getTile(x,y);
    if(!isTreeMaterial(t,x,y)){ unmarkTreeTile(x,y); return false; }
    return tileTreeIds.get(k)===id;
  }
  function unregisteredStandingTreeMaterial(getTile,x,y){
    const k=key(x,y);
    if(fallenTreeTiles.has(k) || tileTreeIds.has(k)) return false;
    const t=getTile(x,y);
    return isTreeMaterial(t,x,y);
  }
  function collectRegisteredStandingComponent(getTile,x,y,id){
    const out=[];
    const vis=new Set();
    const stack=[[x,y]];
    let guard=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      const k=key(cx,cy);
      if(vis.has(k) || !sameRegisteredStandingComponentTile(getTile,id,cx,cy)) continue;
      vis.add(k);
      out.push({x:cx,y:cy,t:getTile(cx,cy),id});
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      if(++guard>900) break;
    }
    return out;
  }
  function collectRawUnregisteredComponent(getTile,x,y){
    const out=[];
    const vis=new Set();
    const stack=[[x,y]];
    let guard=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      const k=key(cx,cy);
      if(vis.has(k) || !unregisteredStandingTreeMaterial(getTile,cx,cy)) continue;
      vis.add(k);
      out.push({x:cx,y:cy,t:getTile(cx,cy),id:null});
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
      if(++guard>900) break;
    }
    return out;
  }
  function nearestStemInComponent(getTile,component,x,y){
    const componentKeys=new Set(component.map(tile=>key(tile.x,tile.y)));
    const seen=new Set();
    let best=null;
    for(const tile of component){
      if(tile.t!==T.WOOD) continue;
      const stem=findStem(getTile,tile.x,tile.y);
      if(!stem || stem.height<2) continue;
      const stemKey=stem.x+':'+stem.top+':'+stem.bottom;
      if(seen.has(stemKey)) continue;
      seen.add(stemKey);
      if(!stem.tiles.every(st=>componentKeys.has(key(st.x,st.y)) && unregisteredStandingTreeMaterial(getTile,st.x,st.y))) continue;
      const yDist=y<stem.top ? stem.top-y : (y>stem.bottom ? y-stem.bottom : 0);
      const score=Math.abs(stem.x-x)+yDist;
      if(!best || score<best.score) best={stem,score};
    }
    return best && best.stem;
  }
  function collectInferredStandingTiles(getTile,stem){
    const trunks=nearbyTrunks(getTile,stem);
    const out=[...stem.tiles.map(tile=>({x:tile.x,y:tile.y,t:tile.t,id:null}))];
    const vis=new Set(out.map(t=>key(t.x,t.y)));
    const stack=stem.tiles.map(t=>[t.x,t.y]);
    const xReach=5;
    const yMin=stem.top - Math.max(4, stem.height+3);
    const yMax=stem.bottom + 3;
    let guard=0;
    while(stack.length){
      const [cx,cy]=stack.pop();
      for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1],[cx,cy-2]]){
        const k=key(nx,ny);
        if(vis.has(k)) continue;
        if(Math.abs(nx-stem.x)>xReach || ny<yMin || ny>yMax) continue;
        if(ny>stem.bottom) continue;
        const tt=getTile(nx,ny);
        if(!unregisteredStandingTreeMaterial(getTile,nx,ny) || !isFoliage(tt,nx,ny) || !belongsToStem(nx,stem,trunks)) continue;
        vis.add(k);
        out.push({x:nx,y:ny,t:tt,id:null});
        stack.push([nx,ny]);
        if(++guard>600) break;
      }
      if(guard>600) break;
    }
    return out;
  }
  function collectStandingComponent(getTile,x,y){
    const startKey=key(x,y);
    if(fallenTreeTiles.has(startKey)) return [];
    const startTile=getTile(x,y);
    if(!isTreeMaterial(startTile,x,y)){ unmarkTreeTile(x,y); return []; }
    const id=tileTreeIds.get(startKey);
    if(id) return collectRegisteredStandingComponent(getTile,x,y,id);
    const raw=collectRawUnregisteredComponent(getTile,x,y);
    const stem=nearestStemInComponent(getTile,raw,x,y);
    return stem ? collectInferredStandingTiles(getTile,stem) : raw;
  }
  function terrainSupportsTreeComponent(getTile,component,componentKeys){
    const hasWood=component.some(tile=>tile.t===T.WOOD);
    for(const tile of component){
      if(hasWood && tile.t!==T.WOOD) continue;
      if(tile.y+1>=WORLD_H) return true;
      const bx=tile.x, by=tile.y+1, bk=key(bx,by);
      if(componentKeys.has(bk)) continue;
      const below=getTile(bx,by);
      if(passThrough(below)) continue;
      if(isTreeMaterial(below,bx,by) || fallenTreeTiles.has(bk)) continue;
      return true;
    }
    return false;
  }
  function releaseStandingComponent(getTile,setTile,component){
    if(!component.length) return false;
    const avgX=component.reduce((sum,tile)=>sum+tile.x,0)/component.length;
    component.forEach(tile=>unstableTreeTiles.delete(key(tile.x,tile.y)));
    component.forEach(tile=>{
      unmarkTreeTile(tile.x,tile.y);
      setTile(tile.x,tile.y,T.AIR);
      notifyRemoved(getTile,tile.x,tile.y);
    });
    component.forEach(tile=>{
      if(!fallsAsTreeDebris(tile.t)) return;
      const dir=normalizeDir(tile.x-avgX);
      fallingBlocks.push(makeFallingPiece(tile.x,tile.y,tile.t,dir));
    });
    return true;
  }
  function processStandingTreeQueue(getTile,setTile,budget=TREE_STABILITY_QUEUE_BUDGET){
    if(!unstableTreeTiles.size) return;
    const processed=new Set();
    for(const k of unstableTreeTiles){
      if(budget--<=0) break;
      unstableTreeTiles.delete(k);
      if(processed.has(k) || fallenTreeTiles.has(k)) continue;
      const x=keyX(k), y=keyY(k);
      const t=getTile(x,y);
      if(!isTreeMaterial(t,x,y)){ unmarkTreeTile(x,y); continue; }
      const component=collectStandingComponent(getTile,x,y);
      if(!component.length) continue;
      const componentKeys=new Set(component.map(tile=>key(tile.x,tile.y)));
      componentKeys.forEach(ck=>processed.add(ck));
      if(!terrainSupportsTreeComponent(getTile,component,componentKeys)) releaseStandingComponent(getTile,setTile,component);
    }
  }
  function drainTreeQueues(getTile,setTile){
    let guard=0;
    while((unstableTreeTiles.size || unstableFallenTreeTiles.size) && guard++<64){
      processStandingTreeQueue(getTile,setTile,10000);
      processFallenTreeQueue(getTile,setTile,10000);
    }
  }
  function auditStandingTreesInArea(getTile,area,budgetOverride){
    if(!area || typeof getTile!=='function') return;
    const sx=Number.isFinite(area.sx) ? Math.max(-TREE_MAX_ABS_X,Math.min(TREE_MAX_ABS_X,Math.floor(area.sx))) : 0;
    const sy=Number.isFinite(area.sy) ? Math.max(0,Math.min(WORLD_H-1,Math.floor(area.sy))) : 0;
    const viewX=Number.isFinite(area.viewX) ? Math.max(0,Math.min(512,Math.ceil(area.viewX))) : 0;
    const viewY=Number.isFinite(area.viewY) ? Math.max(0,Math.min(WORLD_H,Math.ceil(area.viewY))) : 0;
    const w=viewX+3;
    const h=Math.max(0, Math.min(WORLD_H-sy, viewY+3));
    if(w<=0 || h<=0) return;
    const total=w*h;
    const requested=Number.isFinite(budgetOverride) ? Math.max(0,Math.min(10000,Math.floor(budgetOverride))) : TREE_AREA_AUDIT_BUDGET;
    let budget=Math.min(requested,total);
    areaAuditCursor%=total;
    while(budget-- > 0){
      const n=areaAuditCursor++ % total;
      const x=sx + (n % w);
      const y=sy + Math.floor(n / w);
      const k=key(x,y);
      if(fallenTreeTiles.has(k)){
        if(suspiciousFallenTreeSupport(getTile,x,y)) queueFallenTreeCheck(x,y);
        continue;
      }
      const t=getTile(x,y);
      if(!isTreeMaterial(t,x,y)) continue;
      if(suspiciousStandingSupport(getTile,x,y)) queueStandingTreeCheck(x,y);
    }
  }
  function auditChunk(cx,getTile){
    if(typeof getTile!=='function' || !Number.isFinite(cx) || Math.abs(cx*CHUNK_W)>TREE_MAX_ABS_X) return;
    const x0=Math.floor(cx)*CHUNK_W;
    for(let lx=0; lx<CHUNK_W; lx++){
      const x=x0+lx;
      for(let y=0; y<WORLD_H; y++){
        const k=key(x,y);
        if(fallenTreeTiles.has(k)){
          if(suspiciousFallenTreeSupport(getTile,x,y)) queueFallenTreeCheck(x,y);
          continue;
        }
        const t=getTile(x,y);
        if(isTreeMaterial(t,x,y) && suspiciousStandingSupport(getTile,x,y)) queueStandingTreeCheck(x,y);
      }
    }
  }
  function auditChunks(chunks,getTile){
    if(!Array.isArray(chunks)) return;
    const n=Math.min(chunks.length,TREE_CHUNK_AUDIT_CAP);
    for(let i=0;i<n;i++) auditChunk(chunks[i],getTile);
  }
  function settleAll(getTile,setTile){
    if(typeof getTile!=='function'||typeof setTile!=='function'){ reset(); return; }
    drainTreeQueues(getTile,setTile);
    const trees=[...fallingTrees];
    fallingTrees.length=0;
    // force=true settles what it safely can. Pieces with no legal resting cell
    // remain in fallingBlocks and are serialized by snapshot() as loose escrow.
    trees.forEach(tree=>landTree(getTile,setTile,tree,landedAngle(tree),true));
    let guard=0;
    while((fallingBlocks.length || unstableTreeTiles.size || unstableFallenTreeTiles.size) && guard++<64){
      const blocks=[...fallingBlocks].sort((a,b)=>b.y-a.y);
      fallingBlocks.length=0;
      fallStepAccum=0;
      blocks.forEach(b=>dropToRest(getTile,setTile,b,true));
      drainTreeQueues(getTile,setTile);
    }
  }
  function reset(){ resetVolatileState(); }
  function snapshot(){
    const debris=[];
    let processed=0;
    for(const raw of fallenTreeTiles){
      if(processed++>=TREE_DEBRIS_PERSIST_CAP || debris.length>=TREE_DEBRIS_PERSIST_CAP) break;
      const pos=parsePersistedTreeKey(raw);
      if(pos) debris.push(pos.k);
    }
    const identities=[];
    processed=0;
    for(const [raw,id] of tileTreeIds){
      if(processed++>=TREE_IDENTITY_PERSIST_CAP || identities.length>=TREE_IDENTITY_PERSIST_CAP) break;
      const pos=parsePersistedTreeKey(raw);
      if(!pos || typeof id!=='string' || !id.length || id.length>TREE_ID_MAX) continue;
      identities.push([pos.k,id]);
    }
    const leafLitter=[];
    processed=0;
    for(const [raw,expiresAt] of seasonalLeafLitter){
      if(processed++>=TREE_LEAF_LITTER_PERSIST_CAP || leafLitter.length>=TREE_LEAF_LITTER_PERSIST_CAP) break;
      const pos=parsePersistedTreeKey(raw);
      if(!pos) continue;
      const remaining=Number.isFinite(expiresAt)
        ? Math.max(0,Math.min(SEASONAL_LEAF_DECAY_SECONDS,expiresAt-treeElapsedSeconds))
        : SEASONAL_LEAF_DECAY_SECONDS;
      leafLitter.push([pos.k,+remaining.toFixed(3)]);
    }
    const loose=[];
    for(let i=0, n=Math.min(fallingBlocks.length,TREE_LOOSE_PERSIST_CAP); i<n; i++){
      const piece=restoredFallingPiece(fallingBlocks[i]);
      if(!piece) continue;
      loose.push({x:piece.x,y:piece.y,t:piece.t,dir:piece.dir,hBudget:piece.hBudget,windCarry:piece.windCarry||0});
    }
    return {v:4,debris,identities,leafLitter,loose};
  }
  function restore(state,getTile){
    clearTreeIdentityMaps();
    resetVolatileState();
    const loose=state && Array.isArray(state.loose) ? state.loose : [];
    for(let i=0, n=Math.min(loose.length,TREE_LOOSE_PERSIST_CAP); i<n; i++){
      const piece=restoredFallingPiece(loose[i]);
      if(piece) fallingBlocks.push(piece);
    }
    const debris=state && Array.isArray(state.debris) ? state.debris : [];
    for(let i=0, n=Math.min(debris.length,TREE_DEBRIS_PERSIST_CAP); i<n; i++){
      const pos=parsePersistedTreeKey(debris[i]);
      if(!pos) continue;
      const {x,y,k}=pos;
      if(typeof getTile==='function' && !isFallenTreeMaterial(getTile(x,y))) continue;
      fallenTreeTiles.add(k);
      queueFallenTreeCheck(x,y);
    }
    const leafLitter=state && Array.isArray(state.leafLitter) ? state.leafLitter : [];
    for(let i=0, n=Math.min(leafLitter.length,TREE_LEAF_LITTER_PERSIST_CAP); i<n; i++){
      const entry=leafLitter[i];
      if(!Array.isArray(entry) || entry.length<2) continue;
      const pos=parsePersistedTreeKey(entry[0]);
      if(!pos) continue;
      const {x,y,k}=pos;
      if(typeof getTile==='function' && !isAutumnLeaf(getTile(x,y))) continue;
      const remaining=Number.isFinite(entry[1]) ? Math.max(0.5, Math.min(SEASONAL_LEAF_DECAY_SECONDS, entry[1])) : SEASONAL_LEAF_DECAY_SECONDS;
      seasonalLeafLitter.set(k, treeElapsedSeconds + remaining);
      fallenTreeTiles.add(k);
      queueFallenTreeCheck(x,y);
    }
    const identities=state && Array.isArray(state.identities) ? state.identities : [];
    for(let i=0, n=Math.min(identities.length,TREE_IDENTITY_PERSIST_CAP); i<n; i++){
      const entry=identities[i];
      if(!Array.isArray(entry) || entry.length<2 || typeof entry[1]!=='string' || !entry[1].length || entry[1].length>TREE_ID_MAX) continue;
      const pos=parsePersistedTreeKey(entry[0]);
      if(!pos) continue;
      const {x,y}=pos;
      if(typeof getTile==='function' && !isTreeMaterial(getTile(x,y),x,y)) continue;
      markTreeTile(entry[1],x,y);
      queueStandingTreeCheck(x,y);
    }
  }
  function updateFallingPieces(getTile,setTile,dt){
    if(!fallingBlocks.length) return;
    fallStepAccum += dt;
    const STEP=0.05;
    if(fallStepAccum < STEP) return;
    while(fallStepAccum >= STEP){
      fallStepAccum -= STEP;
      if(!fallingBlocks.length) break;
      const occ=new Set();
      fallingBlocks.forEach(b=>occ.add(key(b.x,b.y)));
      const order=[...fallingBlocks.keys()].sort((a,b)=>fallingBlocks[b].y - fallingBlocks[a].y);
      const toRemove=[];
      for(const idx of order){
        const b=fallingBlocks[idx];
        b.onHero=false; // re-set only when the host (not a guest) carries the piece
        applyWindToPiece(getTile,b,occ,STEP);
        const belowY=b.y+1;
        if(belowY>=WORLD_H){
          if(settleTreeBlock(getTile,setTile,b)!=='body') toRemove.push(idx);
          else b.onHero=hostPlayerBlocks(b.x,b.y);
          continue;
        }
        const belowKey=key(b.x,belowY);
        const belowTile=getTile(b.x,belowY);
        if(passThrough(belowTile) && !occ.has(belowKey)){
          occ.delete(key(b.x,b.y));
          b.y++;
          occ.add(key(b.x,b.y));
          continue;
        }
        const oldKey=key(b.x,b.y);
        if(standingTreeSupportAt(getTile,b.x,belowY)){
          if(b.t===T.WOOD && crushStandingFoliage(getTile,setTile,b.x,belowY)){
            occ.delete(oldKey);
            b.y++;
            occ.add(key(b.x,b.y));
            continue;
          }
          if(trySlideOffStandingTree(getTile,b,occ)){
            occ.delete(oldKey);
            occ.add(key(b.x,b.y));
          } else {
            toRemove.push(idx);
          }
          continue;
        }
        if(tryRollOnPile(getTile,b,occ)){
          occ.delete(oldKey);
          occ.add(key(b.x,b.y));
          continue;
        }
        if(settleTreeBlock(getTile,setTile,b)!=='body') toRemove.push(idx);
        else b.onHero=hostPlayerBlocks(b.x,b.y);
      }
      if(toRemove.length){
        toRemove.sort((a,b)=>b-a).forEach(i=>fallingBlocks.splice(i,1));
      }
    }
  }
  function pruneSeasonalLeafLitter(getTile,setTile,budget=SEASONAL_LEAF_CLEANUP_BUDGET){
    if(!seasonalLeafLitter.size || typeof getTile!=='function' || typeof setTile!=='function') return;
    for(const [k,expiresAt] of seasonalLeafLitter){
      if(budget--<=0) break;
      if(expiresAt>treeElapsedSeconds) continue;
      seasonalLeafLitter.delete(k);
      const x=keyX(k), y=keyY(k);
      if(!Number.isFinite(x) || !Number.isFinite(y) || y<0 || y>=WORLD_H) continue;
      if(!isAutumnLeaf(getTile(x,y))) continue;
      unmarkTreeTile(x,y);
      unmarkFallenTreeTile(x,y);
      // Expired leaf litter is cosmetic cleanup; keep it bounded instead of
      // cascading into neighboring fallen debris in the same frame.
      suppressFallenQueue++;
      try{ setTile(x,y,T.AIR); }
      finally { suppressFallenQueue = Math.max(0, suppressFallenQueue - 1); }
      notifyRemoved(getTile,x,y);
    }
  }
  function perfTier(area){
    const ms=area && Number.isFinite(area.frameMs) ? area.frameMs : 0;
    return ms>44 ? 2 : (ms>26 ? 1 : 0);
  }
  function scaledBudget(base,tier){
    if(tier>=2) return Math.max(8, Math.floor(base*0.22));
    if(tier>=1) return Math.max(16, Math.floor(base*0.48));
    return base;
  }
  function metrics(){
    return {
      fallingTrees:fallingTrees.length,
      fallingBlocks:fallingBlocks.length,
      fallen:fallenTreeTiles.size,
      unstableFallen:unstableFallenTreeTiles.size,
      unstableStanding:unstableTreeTiles.size,
      leafLitter:seasonalLeafLitter.size
    };
  }
  function updateFallingBlocks(getTile,setTile,dt,area){
    const safeDt=dt>0 && Number.isFinite(dt) ? Math.min(0.25,dt) : 0;
    treeElapsedSeconds += safeDt;
    const tier=perfTier(area);
    pruneSeasonalLeafLitter(getTile,setTile,scaledBudget(SEASONAL_LEAF_CLEANUP_BUDGET,tier));
    auditStandingTreesInArea(getTile,area,scaledBudget(TREE_AREA_AUDIT_BUDGET,tier));
    processStandingTreeQueue(getTile,setTile,scaledBudget(TREE_STABILITY_QUEUE_BUDGET,tier));
    processFallenTreeQueue(getTile,setTile,scaledBudget(TREE_DEBRIS_QUEUE_BUDGET,tier));
    updateFallingTrees(getTile,setTile,safeDt);
    processStandingTreeQueue(getTile,setTile,scaledBudget(TREE_STABILITY_QUEUE_BUDGET,tier));
    processFallenTreeQueue(getTile,setTile,scaledBudget(TREE_DEBRIS_QUEUE_BUDGET,tier));
    updateFallingPieces(getTile,setTile,safeDt);
  }

  function drawFallingBlocks(ctx,TILE,INFO,canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const tileVisible = (x,y)=> !visibleTile || visibleTile(Math.floor(x),Math.floor(y));
    if(fallingTrees.length){
      fallingTrees.forEach(tree=>{
        const ca=Math.cos(tree.angle), sa=Math.sin(tree.angle);
        ctx.save();
        ctx.translate(tree.pivotX*TILE, tree.pivotY*TILE);
        ctx.rotate(tree.angle);
        tree.tiles.forEach(tile=>{
          const wx=tree.pivotX + ca*tile.rx - sa*tile.ry;
          const wy=tree.pivotY + sa*tile.rx + ca*tile.ry;
          if(!tileVisible(wx,wy)) return;
          const col=INFO[tile.t].color; if(!col) return;
          ctx.fillStyle=col;
          ctx.fillRect((tile.rx-0.5)*TILE,(tile.ry-0.5)*TILE,TILE,TILE);
        });
        ctx.restore();
      });
    }
    if(fallingBlocks.length) fallingBlocks.forEach(b=>{ if(!tileVisible(b.x,b.y)) return; const col=INFO[b.t].color; if(!col) return; ctx.fillStyle=col; ctx.fillRect(b.x*TILE,b.y*TILE,TILE,TILE); });
  }

  trees.buildTree = buildTree;
  trees.buildBush = buildBush;
  // Populate trees and leaf-canopy bushes for a freshly generated terrain chunk array
  trees.populateChunk = function(arr,cx){
    clearChunk(cx);
    const {CHUNK_W} = MM; const WG = WORLDGEN; if(!WG) return;
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx; const s=WG.surfaceHeight(wx); if(s<2) continue; const biome=WG.biomeType(wx);
      const col=(WG.column && WG.column(wx)) || null;
      if(col && col.volcano) continue;
      const island=!!(col && col.island);
      // Skip non-tree biomes: sea(5), lake(6), desert(3) — except desert islands, which grow palms
      if((biome===5 || biome===6 || biome===8 || biome===3) && !island) continue;
      let chance = 0.08;
      if(island) chance=0.16; // palms cluster on the islet
      else if(biome===0) chance=0.18; // forest, with patch mask below
      else if(biome===1) chance=0.025; // plains: occasional shade trees, never forest-density canopy
      else if(biome===2) chance=0.05; // snow
      else if(biome===4) chance=0.34; // swamp: visible mangrove pockets on mud banks
      else if(biome===7) chance= (s<MM.SNOW_LINE?0.04:0.015); // fewer at high elevation
      // Cluster patches in forests: use a low-frequency patch mask to boost chance locally
      let patch = 0;
      if(biome===0){
        patch = WG.valueNoise(wx, 180, 7771);
        if(patch>0.62) chance += 0.20; else if(patch>0.52) chance += 0.10;
      }
      const densityMul = (WG.settings && WG.settings.forestDensityMul) || 1;
      const sL=WG.surfaceHeight(wx-1), sR=WG.surfaceHeight(wx+1);
      const slopeL=Math.abs(s-sL), slopeR=Math.abs(s-sR);
      if(slopeL>7 || slopeR>7) continue; // steeper cliffs skip
      // Require solid footing: the surface tile may be water (swamp pool), a carved
      // cave mouth or a ravine — never float a tree over those
      const baseT=arr[s*CHUNK_W+lx];
      if(!canPlantSurfaceTile(baseT)) continue;
      let plantedTree=false;
      if(WG.randSeed(wx*1.777) <= Math.min(0.95, chance * densityMul)){
        const variant = island? 'palm' : (biome===2?'conifer': biome===4?'mangrove': biome===1? (WG.randSeed(wx+300)>0.5?'oak':'tallOak') : (WG.randSeed(wx+500)<0.80?'megaOak':'oak'));
        if(canGrowTreeAt(arr,lx,s,variant)){
          buildTree(arr,lx,s,variant,wx);
          plantedTree=true;
        }
      }
      if(plantedTree) continue;
      const bushVariant=bushVariantFor(biome,island,wx,s);
      const bushRadius=bushRadiusFor(bushVariant);
      let bushSlopeOk=true;
      for(let dx=-bushRadius; dx<=bushRadius; dx++){
        if(Math.abs(WG.surfaceHeight(wx+dx)-s)>1){ bushSlopeOk=false; break; }
      }
      if(!bushSlopeOk) continue;
      const bushDensityMul=Math.max(0.35, Math.min(1.8, 0.75 + densityMul*0.25));
      const bushChance=Math.min(0.72, bushChanceFor(biome,island,s,patch) * bushDensityMul);
      if(WG.randSeed(wx*2.917+19) > bushChance) continue;
      if(!canGrowBushAt(arr,lx,s,bushVariant)) continue;
      buildBush(arr,lx,s,bushVariant,wx);
    }
  };
  trees.isTreeBase = isTreeBase;
  trees.startTreeFall = startTreeFall;
  trees.dropSeasonalLeaf = dropSeasonalLeaf;
  trees.updateFallingBlocks = updateFallingBlocks;
  trees.auditStandingTreesInArea = auditStandingTreesInArea;
  trees.auditChunk = auditChunk;
  trees.auditChunks = auditChunks;
  trees.drawFallingBlocks = drawFallingBlocks;
  trees.settleAll = settleAll;
  trees.reset = reset;
  trees.snapshot = snapshot;
  trees.metrics = metrics;
  trees.restore = restore;
  trees.clearChunk = clearChunk;
  trees.pruneChunk = pruneChunk;
  trees.resetIdentities = resetIdentities;
  trees.onTileChanged = onTileChanged;
  // Fallen-debris probe for the hero crush resolver: tree wreckage over a buried
  // hero counts as loose load, an intact standing structure does not.
  trees.isFallenDebrisAt = (x,y)=>fallenTreeTiles.has(key(Math.floor(x),Math.floor(y)));
  // Pieces hovering on the hero — main.js blocks jumping under them and applies
  // crush pressure when the pile outweighs his Twardość capacity.
  trees.heroRestingLoad = ()=>{
    let count=0, weight=0;
    for(const b of fallingBlocks){
      if(!b.onHero || !hostPlayerBlocks(b.x,b.y)) continue;
      count++; weight+=heroLoadWeight(b.t);
    }
    return {count,weight};
  };
  trees._fallingTrees = fallingTrees;
  trees._fallingBlocks = fallingBlocks;
  trees._tileTreeIds = tileTreeIds;
  trees._treeTiles = treeTiles;
  trees._fallenTreeTiles = fallenTreeTiles;
  trees._seasonalLeafLitter = seasonalLeafLitter;
  trees._unstableFallenTreeTiles = unstableFallenTreeTiles;
  trees._unstableTreeTiles = unstableTreeTiles;
  trees._limits = Object.freeze({
    debris:TREE_DEBRIS_PERSIST_CAP,
    loose:TREE_LOOSE_PERSIST_CAP,
    identities:TREE_IDENTITY_PERSIST_CAP,
    leafLitter:TREE_LEAF_LITTER_PERSIST_CAP,
    chunkAudit:TREE_CHUNK_AUDIT_CAP
  });

  MM.trees = trees;
})();
// ESM export (progressive migration)
export const trees = (typeof window!=='undefined' && window.MM) ? window.MM.trees : undefined;
export default trees;
