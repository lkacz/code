// Tree generation + falling system
import { CHUNK_W, WORLD_H, T, SNOW_LINE, INFO, SURFACE_GRASS_DEPTH, SAND_DEPTH } from '../constants.js';
import { worldGen as WORLDGEN } from './worldgen.js';
window.MM = window.MM || {};
(function(){
  const WG = WORLDGEN;
  const trees = {};
  // Falling blocks from tree collapse
  const fallingBlocks = []; // {x,y,t,dir,hBudget}
  let fallStepAccum = 0;

  function buildTree(arr,lx,s,variant,wx){
    function tileIndex(x,y){ return y*CHUNK_W+x; }
    function put(localX,y,t){ if(y>=0 && y<WORLD_H && localX>=0 && localX<CHUNK_W){ if(arr[tileIndex(localX,y)]===T.AIR) arr[tileIndex(localX,y)]=t; }}
    const snowy = s < SNOW_LINE;
    const randSeed = WG.randSeed;
    if(variant==='conifer'){
      const trunkH=5+Math.floor(randSeed(wx+10)*4);
      for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      const crownH=trunkH+1; for(let dy=0; dy<crownH; dy++){ const radius=Math.max(0, Math.floor((crownH-dy)/3)); const cy=s-1-trunkH+1 - dy; if(cy<0) break; for(let dx=-radius; dx<=radius; dx++){ if(randSeed(wx*3.1 + dy*7 + dx*11) < 0.85){ put(lx+dx,cy, (snowy && dy<2)?T.SNOW:T.LEAF); } } }
      if(snowy) put(lx, s-1-trunkH, T.SNOW);
    } else if(variant==='megaOak'){
      const trunkH=6+Math.floor(randSeed(wx+20)*5); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      const spread=3+Math.floor(randSeed(wx+40)*2); const top=s-1-trunkH; for(let dy=-spread; dy<=spread; dy++){ for(let dx=-spread; dx<=spread; dx++){ const dist=Math.abs(dx)+Math.abs(dy)*0.7; if(dist<=spread+ (randSeed(wx+dx*13+dy*17)-0.5)){ put(lx+dx, top+dy, T.LEAF); } } }
    } else if(variant==='tallOak'){
      const trunkH=7+Math.floor(randSeed(wx+60)*4); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      const top=s-1-trunkH; const spread=2; for(let dy=-2; dy<=2; dy++){ for(let dx=-spread; dx<=spread; dx++){ if(Math.abs(dx)+Math.abs(dy)*0.9<=spread+0.3){ put(lx+dx, top+dy, T.LEAF); } } }
    } else { // oak
      const trunkH=4+Math.floor(randSeed(wx+80)*3); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
      const top=s-1-trunkH; const spread=2; for(let dy=-2; dy<=2; dy++){ for(let dx=-spread; dx<=spread; dx++){ if(Math.abs(dx)+Math.abs(dy)*0.8<=spread+ (randSeed(wx+dx*31+dy*19)-0.4)){ put(lx+dx, top+dy, T.LEAF); } } }
    }
  }

  function isTreeBase(getTile,x,y){ if(getTile(x,y)!==T.WOOD) return false; if(getTile(x,y-1)!==T.WOOD) return false; const below=getTile(x,y+1); return below!==T.WOOD; }

  function collectTreeTiles(getTile,setTile,x,y){ const stack=[[x,y]]; const vis=new Set(); const out=[]; let guard=0; while(stack.length){ const [cx,cy]=stack.pop(); const k=cx+','+cy; if(vis.has(k)) continue; const tt=getTile(cx,cy); if(!(tt===T.WOOD||tt===T.LEAF||tt===T.SNOW)) continue; vis.add(k); out.push({x:cx,y:cy,t:tt}); setTile(cx,cy,T.AIR); if(++guard>600) break; stack.push([cx+1,cy]); stack.push([cx-1,cy]); stack.push([cx,cy+1]); stack.push([cx,cy-1]); stack.push([cx,cy-2]); } return out; }

  function startTreeFall(getTile,setTile,playerFacing,x,y){ const tiles=collectTreeTiles(getTile,setTile,x,y); if(!tiles.length) return false; const randSeed=WG.randSeed; const dir=playerFacing||1; let maxY=-Infinity; tiles.forEach(t=>{ if(t.y>maxY) maxY=t.y; }); tiles.forEach(tile=>{ const heightFactor=maxY - tile.y; const hBudget=Math.max(0, Math.min(8, Math.round(heightFactor*0.6 + randSeed(tile.x*31+tile.y*17)*2))); fallingBlocks.push({x:tile.x,y:tile.y,t:tile.t,dir,hBudget}); }); return true; }

  function updateFallingBlocks(getTile,setTile,dt){ if(!fallingBlocks.length) return; fallStepAccum += dt; const STEP=0.05; if(fallStepAccum < STEP) return; while(fallStepAccum >= STEP){ fallStepAccum -= STEP; if(!fallingBlocks.length) break; const occ=new Set(); fallingBlocks.forEach(b=>occ.add(b.x+','+b.y)); const order=[...fallingBlocks.keys()].sort((a,b)=>fallingBlocks[b].y - fallingBlocks[a].y); const toRemove=[]; for(const idx of order){ const b=fallingBlocks[idx]; const belowY=b.y+1; if(belowY>=WORLD_H){ setTile(b.x,b.y,b.t); toRemove.push(idx); continue; } const belowKey=b.x+','+belowY; const belowTile=getTile(b.x,belowY); if(belowTile===T.AIR && !occ.has(belowKey)){ occ.delete(b.x+','+b.y); b.y++; occ.add(b.x+','+b.y); continue; } if(b.hBudget>0){ const nx=b.x+b.dir; const ny=b.y+1; const nBelow=getTile(nx,ny); const horizFree=!occ.has(nx+','+b.y) && getTile(nx,b.y)===T.AIR; const diagFree=nBelow===T.AIR && !occ.has(nx+','+ny); if(horizFree && diagFree){ occ.delete(b.x+','+b.y); b.x=nx; b.y=ny; occ.add(b.x+','+b.y); b.hBudget--; continue; } } setTile(b.x,b.y,b.t); toRemove.push(idx); } if(toRemove.length){ toRemove.sort((a,b)=>b-a).forEach(i=>fallingBlocks.splice(i,1)); } } }

  function drawFallingBlocks(ctx,TILE,INFO){ if(!fallingBlocks.length) return; fallingBlocks.forEach(b=>{ const col=INFO[b.t].color; if(!col) return; ctx.fillStyle=col; ctx.fillRect(b.x*TILE,b.y*TILE,TILE,TILE); }); }

  trees.buildTree = buildTree;
  // Populate trees for a freshly generated terrain chunk array
  trees.populateChunk = function(arr,cx){
    const {CHUNK_W} = MM; const WG = WORLDGEN; if(!WG) return;
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx; const s=WG.surfaceHeight(wx); if(s<2) continue; const biome=WG.biomeType(wx);
      // Skip non-tree biomes: sea(5), lake(6), desert(3) (rare cactus could be future), swamp(4) sparse, mountain(7) sparse near peaks
      if(biome===5 || biome===6 || biome===3) continue;
      let chance = 0.08;
      if(biome===0) chance=0.18; // forest denser base
      else if(biome===1) chance=0.07; // plains
      else if(biome===2) chance=0.05; // snow
      else if(biome===4) chance=0.04; // swamp (few trees, maybe future mangroves)
      else if(biome===7) chance= (s<MM.SNOW_LINE?0.04:0.015); // fewer at high elevation
      // Cluster patches in forests: use a low-frequency patch mask to boost chance locally
      if(biome===0){
        const patch = WG.valueNoise(wx, 180, 7771);
        if(patch>0.62) chance += 0.20; else if(patch>0.52) chance += 0.10;
      }
      // Adjacency boost: more likely to grow next to existing trees in this chunk
      const leftHas = (lx>0 && arr[(s-1)*CHUNK_W + (lx-1)]===T.WOOD);
      const left2Has = (lx>1 && arr[(s-1)*CHUNK_W + (lx-2)]===T.WOOD);
      if(leftHas) chance += 0.12; else if(left2Has) chance += 0.06;
  const densityMul = (WG.settings && WG.settings.forestDensityMul) || 1;
  if(WG.randSeed(wx*1.777) > Math.min(0.95, chance * densityMul)) continue;
      const sL=WG.surfaceHeight(wx-1), sR=WG.surfaceHeight(wx+1);
      const slopeL=Math.abs(s-sL), slopeR=Math.abs(s-sR);
      if(slopeL>7 || slopeR>7) continue; // steeper cliffs skip
      // Slightly relax valley steepness
      const variant = (biome===2?'conifer': biome===1? (WG.randSeed(wx+300)>0.5?'oak':'tallOak') : (WG.randSeed(wx+500)<0.15?'megaOak':'oak'));
      buildTree(arr,lx,s,variant,wx);
    }
  };
  trees.isTreeBase = isTreeBase;
  trees.startTreeFall = startTreeFall;
  trees.updateFallingBlocks = updateFallingBlocks;
  trees.drawFallingBlocks = drawFallingBlocks;
  trees._fallingBlocks = fallingBlocks;

  MM.trees = trees;
})();
// ESM export (progressive migration)
export const trees = (typeof window!=='undefined' && window.MM) ? window.MM.trees : undefined;
export default trees;
