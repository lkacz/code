// Falling-tree regressions: snowy crowns should fall, snowy ground should not be
// collected as part of the tree, and pending tree blocks must not vanish on save.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){},
};

const { T, INFO, CHUNK_W, WORLD_H } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { trees } = await import('../src/engine/trees.js');
const { fire } = await import('../src/engine/fire.js');

const key = (x,y)=>x+','+y;
const tiles = new Map();
const getTile = (x,y)=>tiles.get(key(x,y)) ?? T.AIR;
const setTile = (x,y,t)=>{
  if(t===T.AIR) tiles.delete(key(x,y));
  else tiles.set(key(x,y), t);
};
const setTileWithTreeHook = (x,y,t)=>{
  const old=getTile(x,y);
  setTile(x,y,t);
  if(old!==t) trees.onTileChanged(x,y,old,t);
};
const resetTiles = ()=>tiles.clear();
const resetTreeSystem = ()=>{ trees.reset(); if(trees.resetIdentities) trees.resetIdentities(); };
function burnTileNow(x,y){
  assert.equal(fire.ignite(x,y,getTile), true, 'test tile ignites before burn-out');
  const info=INFO[getTile(x,y)];
  fire.update(getTile,setTileWithTreeHook,(info && info.burnTime ? info.burnTime : 2)+0.1);
}
function copyChunkToTiles(arr){
  for(let y=0;y<WORLD_H;y++){
    for(let x=0;x<CHUNK_W;x++){
      const t=arr[y*CHUNK_W+x];
      if(t!==T.AIR) setTile(x,y,t);
    }
  }
}
function fallenColumnCounts(tileType){
  const counts=new Map();
  let total=0;
  for(const k of trees._fallenTreeTiles){
    const [xs,ys]=k.split(',');
    const x=+xs, y=+ys;
    if(tileType!=null && getTile(x,y)!==tileType) continue;
    counts.set(x,(counts.get(x)||0)+1);
    total++;
  }
  return {counts,total,max:[...counts.values()].reduce((m,n)=>Math.max(m,n),0)};
}
function markRegisteredTree(id,cells){
  let set=trees._treeTiles.get(id);
  if(!set){ set=new Set(); trees._treeTiles.set(id,set); }
  for(const [x,y] of cells){
    const k=key(x,y);
    trees._tileTreeIds.set(k,id);
    set.add(k);
  }
}

worldGen.randSeed = ()=>0;

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>10;
  const removed=[];
  MM.fallingSolids={ onTileRemoved(x,y){ removed.push(key(x,y)); } };
  MM.water={ onTileChanged(){} };

  for(let x=-6; x<=6; x++) setTile(x,10,T.SNOW);
  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(0,7,T.SNOW);

  assert.equal(trees.isTreeBase(getTile,0,9), true, 'snowy trunk base is recognized');
  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'snowy tree starts falling');
  assert.equal(getTile(0,7), T.AIR, 'snowy crown tile was collected into the falling tree');
  for(let x=-6; x<=6; x++) assert.equal(getTile(x,10), T.SNOW, 'terrain snow remains in place');
  assert.equal(trees._fallingTrees.length, 1, 'snowy tree becomes one rotating body');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===0 && b.oy===7 && b.t===T.SNOW), true, 'snowy crown is part of the rotating tree');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.oy===10 && b.t===T.SNOW), false, 'terrain snow is not part of the rotating tree');
  assert.equal(removed.includes(key(0,8)), true, 'tree removal wakes dependent falling solids');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(3,6,T.STONE);
  setTile(4,6,T.STONE);
  setTile(3,3,T.WOOD);
  setTile(3,2,T.WOOD);

  assert.equal(trees.startTreeFall(getTile,setTile,1,3,3), true, 'floating trunk starts falling');
  assert.equal(trees._fallingTrees.length, 1, 'tree body is pending before save settle');
  assert.equal(trees._fallingBlocks.length, 0, 'tree does not collapse into loose pieces immediately');
  trees.settleAll(getTile,setTile);
  assert.equal(trees._fallingTrees.length, 0, 'save settle clears rotating tree bodies');
  assert.equal(trees._fallingBlocks.length, 0, 'save settle clears pending tree blocks');
  assert.equal(getTile(3,5), T.WOOD, 'lower trunk block lands above the floor');
  assert.equal(getTile(4,5), T.WOOD, 'upper trunk block lands rotated to the side');
  assert.equal(trees._fallenTreeTiles.has('3,5'), true, 'save-settled rotating tree lower block is tracked as debris');
  assert.equal(trees._fallenTreeTiles.has('4,5'), true, 'save-settled rotating tree upper block is tracked as debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(0,7,T.LEAF);
  setTile(1,7,T.LEAF);
  setTile(2,7,T.LEAF); // shared canopy boundary
  setTile(3,7,T.LEAF);
  setTile(4,7,T.LEAF);
  setTile(4,9,T.WOOD);
  setTile(4,8,T.WOOD);

  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'first tree starts falling with touching canopy');
  assert.equal(getTile(4,9), T.WOOD, 'neighbor trunk base remains standing');
  assert.equal(getTile(4,8), T.WOOD, 'neighbor trunk top remains standing');
  assert.equal(getTile(3,7), T.LEAF, 'neighbor-side canopy remains standing');
  assert.equal(getTile(2,7), T.LEAF, 'shared canopy boundary is not claimed by either trunk');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===0 && b.oy===7 && b.t===T.LEAF), true, 'claimed canopy leaves join the rotating fall');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===4), false, 'neighbor tree blocks are not pulled into the fall');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(0,5,T.STONE);
  setTileWithTreeHook(0,2,T.AUTUMN_LEAF_ORANGE);
  assert.equal(trees.dropSeasonalLeaf(0,2,T.AUTUMN_LEAF_ORANGE,getTile,setTileWithTreeHook), false, 'seasonal autumn leaves no longer detach through the tree falling system');
  assert.equal(getTile(0,2), T.AUTUMN_LEAF_ORANGE, 'autumn leaf stays attached instead of becoming falling debris');
  assert.equal(trees._fallingBlocks.length, 0, 'seasonal leaf drop does not create falling leaf blocks');
  assert.equal(trees._seasonalLeafLitter.size, 0, 'seasonal leaf drop does not create timed leaf litter');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  for(let x=0; x<30; x++){
    setTile(x,4,T.AUTUMN_LEAF_ORANGE);
    trees._seasonalLeafLitter.set(key(x,4), 0);
    trees._fallenTreeTiles.add(key(x,4));
  }
  trees.updateFallingBlocks(getTile,setTileWithTreeHook,0.25);
  const remaining=[...Array(30).keys()].filter(x=>getTile(x,4)===T.AUTUMN_LEAF_ORANGE).length;
  assert.ok(remaining > 0, 'expired autumn leaf litter cleanup is sliced across frames');
  assert.ok(remaining < 30, 'expired autumn leaf litter cleanup still makes progress');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(0,7,T.WOOD);
  setTile(0,6,T.WOOD);

  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'tree starts as a rotating body');
  const initialAngle=trees._fallingTrees[0].angle;
  trees.updateFallingBlocks(getTile,setTile,1/10);
  assert.ok(trees._fallingTrees[0].angle > initialAngle, 'tree rotates toward the chosen side before landing');
  assert.equal(trees._fallingBlocks.length, 0, 'unblocked rotation does not shed loose pieces');
  const drawCalls=[];
  const ctx={fillStyle:'', save(){ drawCalls.push('save'); }, restore(){ drawCalls.push('restore'); }, translate(){ drawCalls.push('translate'); }, rotate(){ drawCalls.push('rotate'); }, fillRect(){ drawCalls.push('fillRect'); }};
  trees.drawFallingBlocks(ctx,1,INFO);
  assert.equal(drawCalls.includes('rotate'), true, 'rotating tree draw path uses canvas rotation');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(0,7,T.WOOD);
  setTile(0,6,T.WOOD);
  setTile(2,9,T.STONE);

  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'tree starts falling toward an obstacle');
  for(let i=0;i<90;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(2,9), T.STONE, 'impact obstacle is not overwritten');
  assert.equal(getTile(2,8), T.WOOD, 'only the segment that hit the obstacle breaks off and settles there');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(0,7,T.WOOD);
  setTile(0,6,T.WOOD);
  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'tree starts for frame-rate comparison');
  trees.updateFallingBlocks(getTile,setTile,0.25);
  const largeStepAngle=trees._fallingTrees[0].angle;

  resetTiles();
  resetTreeSystem();
  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(0,7,T.WOOD);
  setTile(0,6,T.WOOD);
  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'tree restarts for stepped comparison');
  for(let i=0;i<30;i++) trees.updateFallingBlocks(getTile,setTile,1/120);
  assert.ok(Math.abs(trees._fallingTrees[0].angle-largeStepAngle)<1e-9, 'large tree update is internally substepped');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  for(let y=0;y<WORLD_H;y++) setTile(1,y,T.STONE);
  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'tree starts beside a packed column');
  trees.settleAll(getTile,setTile);
  assert.equal(getTile(1,0), T.STONE, 'settling tree never overwrites a packed solid column');
  let woodInPackedColumn=false;
  for(let y=0;y<WORLD_H;y++) if(getTile(1,y)===T.WOOD) woodInPackedColumn=true;
  assert.equal(woodInPackedColumn, false, 'blocked tree segment is discarded instead of overwriting terrain');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  const removed=[];
  MM.fallingSolids={ onTileRemoved(x,y){ removed.push(key(x,y)); }, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.STONE);
  setTile(0,9,T.STONE);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:0,hBudget:0});
  for(let i=0;i<20;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,4), T.WOOD, 'tree debris settles on temporary support');
  assert.equal(trees._fallenTreeTiles.has('0,4'), true, 'settled tree debris is tracked for later instability');

  setTile(0,5,T.AIR);
  trees.onTileChanged(0,5,T.STONE,T.AIR);
  trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,4), T.AIR, 'unsupported tracked tree debris is released when support is removed');
  assert.equal(removed.includes(key(0,4)), true, 'released tree debris wakes other falling systems');
  for(let i=0;i<30;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,8), T.WOOD, 'released tree debris falls to the next support');

  const snap=trees.snapshot();
  resetTreeSystem();
  trees.restore(snap,getTile);
  assert.equal(trees._fallenTreeTiles.has('0,8'), true, 'fallen tree debris markers survive save/restore');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.POISON_GAS);
  setTile(0,7,T.STONE);
  trees._fallingBlocks.push({x:0,y:4,t:T.WOOD,dir:0,hBudget:0});
  for(let i=0;i<20;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,4), T.AIR, 'tree debris does not settle above a gas cell');
  assert.equal(getTile(0,5), T.POISON_GAS, 'tree debris can pass through gas without consuming it');
  assert.equal(getTile(0,6), T.WOOD, 'tree debris settles on the real floor below gas');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.TORCH);
  setTile(0,8,T.STONE);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:0,hBudget:0});
  for(let i=0;i<40;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,4), T.AIR, 'tree debris does not park above a passable mounted fixture');
  assert.equal(getTile(0,5), T.TORCH, 'passable mounted fixture remains in place while debris falls through');
  assert.equal(getTile(0,7), T.WOOD, 'tree debris lands on the real floor below the fixture');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,4,T.WOOD);
  setTile(0,5,T.WOOD);
  setTile(0,6,T.STONE);
  for(let x=-1;x<=1;x++) setTile(x,10,T.STONE);
  trees.restore({v:1, debris:['0,4','0,5']}, getTile);
  setTile(0,6,T.AIR);
  trees.onTileChanged(0,6,T.STONE,T.AIR);
  trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,4), T.AIR, 'top tracked tree debris joins a support-removal cascade');
  assert.equal(getTile(0,5), T.AIR, 'bottom tracked tree debris joins a support-removal cascade');
  for(let i=0;i<40;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,9), T.WOOD, 'cascaded tree debris keeps the first landing block above support');
  assert.equal(getTile(1,9), T.WOOD, 'cascaded tree debris spreads sideways instead of stacking');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>5;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,12,T.STONE);
  setTile(0,16,T.STONE);
  trees._fallingBlocks.push({x:0,y:8,t:T.SNOW,dir:0,hBudget:0});
  for(let i=0;i<30;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,11), T.SNOW, 'fallen snowy crown can settle below natural crown height');
  assert.equal(trees._fallenTreeTiles.has('0,11'), true, 'fallen snowy crown remains tracked as tree debris after settling');

  setTile(0,12,T.AIR);
  trees.onTileChanged(0,12,T.STONE,T.AIR);
  trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,11), T.AIR, 'unsupported fallen snowy crown is released like other tree debris');
  for(let i=0;i<40;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,15), T.SNOW, 'fallen snowy crown lands on the next support');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,8,T.WOOD);
  setTile(0,7,T.WOOD);
  setTile(0,6,T.WOOD);
  setTile(0,9,T.STONE);
  setTile(-1,5,T.LEAF);
  setTile(0,5,T.LEAF);
  setTile(1,5,T.LEAF);

  setTileWithTreeHook(0,6,T.AIR);
  trees.updateFallingBlocks(getTile,setTileWithTreeHook,1/60);

  assert.equal(getTile(-1,5), T.LEAF, 'unregistered canopy remains when only the top trunk block is removed');
  assert.equal(getTile(0,5), T.LEAF, 'leaf directly above a removed top trunk is not treated as loose-crown cleanup');
  assert.equal(getTile(1,5), T.LEAF, 'connected unregistered canopy does not disappear as a group');
  assert.equal(trees._fallingBlocks.length, 0, 'top-trunk removal does not spawn hidden leaf debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  const cells=[[0,8],[0,7],[0,6],[-1,5],[0,5],[1,5]];
  setTile(0,8,T.WOOD);
  setTile(0,7,T.WOOD);
  setTile(0,6,T.WOOD);
  setTile(0,9,T.STONE);
  setTile(-1,5,T.LEAF);
  setTile(0,5,T.LEAF);
  setTile(1,5,T.LEAF);
  markRegisteredTree('test:top-trunk-canopy',cells);

  setTileWithTreeHook(0,6,T.AIR);
  trees.updateFallingBlocks(getTile,setTileWithTreeHook,1/60);

  assert.equal(getTile(-1,5), T.LEAF, 'registered/generated canopy remains after top trunk loss');
  assert.equal(getTile(0,5), T.LEAF, 'registered leaf above a removed top trunk remains visible');
  assert.equal(getTile(1,5), T.LEAF, 'registered canopy sides are not bulk-deleted');
  assert.equal(trees._fallingBlocks.length, 0, 'registered top-trunk loss does not create leaf debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.LEAF);
  setTile(1,5,T.LEAF);
  setTile(0,9,T.STONE);
  setTile(1,9,T.STONE);
  assert.equal(trees.startTreeFall(getTile,setTile,1,0,5), true, 'loose crown can be cleared even without a trunk seed');
  assert.equal(getTile(0,5), T.AIR, 'loose crown seed is cleared from the world');
  assert.equal(getTile(1,5), T.AIR, 'connected loose crown is cleared from the world');
  assert.equal(trees._fallingBlocks.length, 2, 'loose crown leaves become falling debris');
  for(let i=0;i<40;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,8), T.LEAF, 'loose crown debris settles as leaf litter');
  assert.equal(getTile(1,8), T.LEAF, 'connected loose crown debris settles as leaf litter');
  assert.equal(trees._fallenTreeTiles.has('0,8'), true, 'loose crown litter is tracked as fallen tree debris');
  assert.equal(trees._fallenTreeTiles.has('1,8'), true, 'connected loose crown litter is tracked as fallen tree debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.LEAF);
  setTile(1,5,T.LEAF);
  setTile(0,6,T.WOOD);
  setTile(0,7,T.WOOD);
  for(let x=-2;x<=4;x++) setTile(x,10,T.STONE);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:1,hBudget:6});
  for(let i=0;i<60;i++) trees.updateFallingBlocks(getTile,setTile,1/60);

  assert.equal(getTile(0,4), T.AIR, 'falling wood does not settle on top of a standing tree crown');
  assert.equal(getTile(0,5), T.AIR, 'falling wood crushes the standing foliage it hits');
  assert.equal(trees._fallenTreeTiles.has('0,4'), false, 'standing tree crown is not recorded as debris support');
  const landedLow=[...trees._fallenTreeTiles].some(k=>{
    const [xs,ys]=k.split(',');
    return getTile(+xs,+ys)===T.WOOD && +ys>=9;
  });
  assert.equal(landedLow, true, 'wood that can escape a crown skids away and lands lower');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.LEAF);
  setTile(0,6,T.WOOD);
  trees._fallingBlocks.push({x:0,y:4,t:T.LEAF,dir:0,hBudget:0});
  for(let i=0;i<4;i++) trees.updateFallingBlocks(getTile,setTile,1/60);

  assert.equal(getTile(0,4), T.AIR, 'trapped falling leaf shatters instead of resting high on a standing tree');
  assert.equal(trees._fallenTreeTiles.has('0,4'), false, 'shattered leaf is not tracked as a settled tree block');
  assert.equal(trees._fallingBlocks.length, 0, 'trapped leaf impact is drained from active debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.LEAF);
  for(let x=-2;x<=2;x++) setTile(x,10,T.STONE);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:0,hBudget:0});
  for(let i=0;i<60;i++) trees.updateFallingBlocks(getTile,setTile,1/60);

  assert.equal(getTile(0,5), T.AIR, 'heavy falling wood breaks through standing foliage');
  assert.equal(getTile(0,9), T.WOOD, 'wood continues down after breaking foliage instead of disappearing');
  assert.equal(trees._fallenTreeTiles.has('0,9'), true, 'wood that broke foliage lands as normal fallen debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.WOOD);
  setTile(0,6,T.WOOD);
  setTile(2,4,T.LEAF);
  for(let x=-2;x<=3;x++) setTile(x,10,T.STONE);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:1,hBudget:6});
  for(let i=0;i<60;i++) trees.updateFallingBlocks(getTile,setTile,1/60);

  assert.equal(getTile(0,4), T.AIR, 'falling wood does not park on top of a standing trunk');
  assert.equal(getTile(0,5), T.WOOD, 'standing trunk remains intact after deflecting falling wood');
  assert.equal([...trees._fallenTreeTiles].some(k=>getTile(+k.split(',')[0],+k.split(',')[1])===T.WOOD && +k.split(',')[1]>=9), true, 'wood that hit a standing trunk lands lower');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.WOOD);
  setTile(0,6,T.WOOD);
  setTile(2,4,T.LEAF);
  for(let x=-2;x<=3;x++) setTile(x,10,T.STONE);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:1,hBudget:6});
  trees.settleAll(getTile,setTile);

  assert.equal(getTile(0,4), T.AIR, 'save-settle does not park wood on top of a standing trunk');
  assert.equal(getTile(0,5), T.WOOD, 'save-settle leaves the standing trunk intact');
  assert.equal([...trees._fallenTreeTiles].some(k=>getTile(+k.split(',')[0],+k.split(',')[1])===T.WOOD && +k.split(',')[1]>=9), true, 'save-settled trunk impact lands lower');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.WOOD);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:0,hBudget:0});
  for(let i=0;i<10;i++) trees.updateFallingBlocks(getTile,setTile,1/60);

  assert.equal(getTile(0,4), T.WOOD, 'falling wood can still settle on an isolated placed wood support');
  assert.equal(trees._fallenTreeTiles.has('0,4'), true, 'wood settled on placed support is tracked as normal fallen debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,5,T.LEAF);
  setTile(0,6,T.WOOD);
  setTile(0,7,T.WOOD);
  for(let x=-3;x<=3;x++) setTile(x,10,T.STONE);
  trees._fallingBlocks.push({x:0,y:3,t:T.WOOD,dir:1,hBudget:6});
  trees.settleAll(getTile,setTile);

  assert.equal(getTile(0,4), T.AIR, 'save-settle does not park wood on a standing crown');
  assert.equal(getTile(0,5), T.AIR, 'save-settle wood impact crushes standing foliage');
  const settledLow=[...trees._fallenTreeTiles].some(k=>{
    const [xs,ys]=k.split(',');
    return getTile(+xs,+ys)===T.WOOD && +ys>=9;
  });
  assert.equal(settledLow, true, 'save-settle sends crown impact debris down to the ground pile');
  assert.equal(trees._fallingBlocks.length, 0, 'save-settle drains crown impact debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,4,T.WOOD);
  setTile(0,5,T.LEAF);
  setTile(0,6,T.WOOD);
  setTile(0,7,T.WOOD);
  for(let x=-3;x<=3;x++) setTile(x,10,T.STONE);
  trees.restore({v:2, debris:[key(0,4)], identities:[]}, getTile);
  trees.updateFallingBlocks(getTile,setTile,1/60,{sx:-2,sy:0,viewX:8,viewY:14});
  assert.equal(getTile(0,4), T.AIR, 'visible restored debris parked on a standing crown is released');
  for(let i=0;i<60;i++) trees.updateFallingBlocks(getTile,setTile,1/60,{sx:-2,sy:0,viewX:8,viewY:14});
  assert.equal(getTile(0,5), T.AIR, 'released restored wood crushes the standing crown support');
  assert.equal([...trees._fallenTreeTiles].some(k=>getTile(+k.split(',')[0],+k.split(',')[1])===T.WOOD && +k.split(',')[1]>=9), true, 'released restored debris lands lower after crown rejection');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,4,T.WOOD);
  setTile(0,5,T.LEAF);
  setTile(0,6,T.WOOD);
  setTile(0,7,T.WOOD);
  for(let x=-3;x<=3;x++) setTile(x,10,T.STONE);
  trees.restore({v:2, debris:[key(0,4)], identities:[]}, getTile);
  trees.auditChunks([0],getTile);
  trees.settleAll(getTile,setTile);
  assert.equal(getTile(0,4), T.AIR, 'chunk audit plus save-settle clears legacy debris parked on a standing crown');
  assert.equal(getTile(0,5), T.AIR, 'chunk-audited legacy wood crushes its standing crown support');
  assert.equal([...trees._fallenTreeTiles].some(k=>getTile(+k.split(',')[0],+k.split(',')[1])===T.WOOD && +k.split(',')[1]>=9), true, 'chunk-audited legacy debris lands lower');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  for(let x=-8; x<=8; x++) setTile(x,15,T.STONE);
  for(let i=0;i<12;i++) trees._fallingBlocks.push({x:0,y:0,t:T.LEAF,dir:0,hBudget:6});
  trees.settleAll(getTile,setTile);

  const pile=fallenColumnCounts(T.LEAF);
  assert.equal(pile.total, 12, 'all instant-settled leaf debris lands');
  assert.ok(pile.counts.size>=5, 'instant-settled leaf debris spreads across several columns');
  assert.ok(pile.max<=3, 'instant-settled leaf debris does not form a tall chimney');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  for(let x=-3; x<=3; x++) setTile(x,10,T.STONE);
  setTile(0,9,T.LEAF);
  setTile(0,8,T.LEAF);
  trees.restore({v:2, debris:[key(0,9),key(0,8)], identities:[]}, getTile);
  for(let i=0;i<20;i++) trees.updateFallingBlocks(getTile,setTile,1/60,{sx:-2,sy:0,viewX:5,viewY:12});

  assert.equal(getTile(0,8), T.LEAF, 'settled fallen leaves remain static instead of re-entering pile relaxation');
  assert.equal(getTile(0,9), T.LEAF, 'settled leaf support remains in place');
  assert.equal(trees._fallingBlocks.length, 0, 'stable fallen leaf piles do not flicker as active debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  for(let x=-8; x<=8; x++) setTile(x,15,T.STONE);
  const debris=[];
  for(let y=9;y<=14;y++){ setTile(0,y,T.WOOD); debris.push(key(0,y)); }
  trees.restore({v:1, debris}, getTile);
  for(let i=0;i<180;i++) trees.updateFallingBlocks(getTile,setTile,1/60);

  const pile=fallenColumnCounts(T.WOOD);
  assert.equal(pile.total, 6, 'all restored chimney debris remains as wood');
  assert.ok(pile.counts.size>1, 'restored chimney debris relaxes sideways');
  assert.ok(pile.max<=3, 'restored chimney debris relaxes into a bounded pile');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  copyChunkToTiles(arr);
  assert.equal(getTile(10,16), T.WOOD, 'generated top trunk exists before crown-only cut');
  assert.equal(trees._tileTreeIds.has('10,15'), true, 'generated crown seed has tree identity');
  setTile(10,16,T.AIR);
  trees.onTileChanged(10,16,T.WOOD,T.AIR);
  assert.equal(trees.startTreeFall(getTile,setTile,1,10,15), true, 'generated crown above a top cut starts falling');
  assert.equal(getTile(10,17), T.WOOD, 'trunk below top cut remains standing');
  assert.equal(getTile(10,15), T.AIR, 'generated crown seed is released');
  assert.ok(trees._fallingBlocks.length > 0, 'generated crown-only leaves become falling debris');
  assert.equal(trees._fallingTrees.length, 0, 'crown-only fall does not create a trunk rotation body');
}

{
  resetTiles();
  resetTreeSystem();
  fire.reset();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={ onTileChanged(){} };

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  copyChunkToTiles(arr);
  assert.equal(getTile(10,19), T.WOOD, 'generated tree lower trunk exists before middle burn');
  assert.equal(getTile(10,18), T.WOOD, 'generated tree burn tile exists before middle burn');
  assert.equal(getTile(10,17), T.WOOD, 'generated tree upper trunk exists before middle burn');

  burnTileNow(10,18);
  assert.equal(getTile(10,19), T.WOOD, 'trunk below the burned block remains standing');
  assert.equal(getTile(10,18), T.AIR, 'burned trunk tile is removed');
  assert.equal(trees._fallingTrees.length, 1, 'burned middle trunk starts a rotating upper tree');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===10 && b.oy===19), false, 'lower trunk is not captured after burn');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===10 && b.oy===17), true, 'upper trunk is captured after burn');
}

{
  resetTiles();
  resetTreeSystem();
  fire.reset();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={ onTileChanged(){} };

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  copyChunkToTiles(arr);
  assert.equal(getTile(10,16), T.WOOD, 'generated top trunk exists before burn');
  assert.equal(trees._tileTreeIds.has('10,15'), true, 'generated crown seed has tree identity before burn');

  burnTileNow(10,16);
  assert.equal(getTile(10,17), T.WOOD, 'trunk below a burned top remains standing');
  assert.equal(getTile(10,16), T.AIR, 'burned top trunk tile is removed');
  assert.equal(getTile(10,15), T.AIR, 'crown above the burned top is released');
  assert.ok(trees._fallingBlocks.length > 0, 'burned top trunk releases crown leaves as falling debris');
  assert.equal(trees._fallingTrees.length, 0, 'burned top trunk does not create a trunk rotation body');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>30;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,20,30,'megaOak',20);
  copyChunkToTiles(arr);
  assert.equal(getTile(20,24), T.WOOD, 'mega oak top trunk exists before crown-only cut');
  assert.equal(getTile(19,25), T.LEAF, 'mega oak has drooping crown below the cut line');
  setTile(20,24,T.AIR);
  trees.onTileChanged(20,24,T.WOOD,T.AIR);
  assert.equal(trees.startTreeFall(getTile,setTile,1,20,23), true, 'registered drooping crown starts from foliage above a top cut');
  assert.equal(getTile(20,25), T.WOOD, 'lower mega oak trunk remains standing');
  assert.equal(getTile(19,25), T.AIR, 'drooping same-crown leaf below the cut line is released');
  assert.equal(getTile(21,25), T.AIR, 'opposite drooping same-crown leaf below the cut line is released');
  assert.equal(trees._fallingTrees.length, 0, 'registered crown-only fall remains debris-only');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>30;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,20,30,'megaOak',20);
  copyChunkToTiles(arr);
  assert.equal(getTile(20,24), T.WOOD, 'mega oak upper trunk exists before near-top cut');
  assert.equal(getTile(19,25), T.LEAF, 'mega oak side crown exists at the cut height');
  setTile(20,25,T.AIR);
  trees.onTileChanged(20,25,T.WOOD,T.AIR);
  assert.equal(trees.startTreeFall(getTile,setTile,1,20,24), true, 'registered upper trunk starts falling after near-top cut');
  assert.equal(getTile(20,26), T.WOOD, 'lower trunk below near-top cut remains standing');
  assert.equal(getTile(19,25), T.AIR, 'side crown leaf at the cut height is released with the upper component');
  assert.equal(getTile(21,25), T.AIR, 'opposite side crown leaf at the cut height is released with the upper component');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  trees.buildTree(arr,13,20,'oak',13);
  copyChunkToTiles(arr);
  assert.ok(trees._tileTreeIds.size>0, 'generated trees register tile ownership');
  assert.equal(trees.startTreeFall(getTile,setTile,1,10,19), true, 'registered generated tree starts falling');
  assert.equal(getTile(13,19), T.WOOD, 'neighbor generated trunk remains standing by tree id');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===13 && b.t===T.WOOD), false, 'neighbor generated trunk is not in the falling body');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  const identities=[];
  function putTree(id,x,y,t){ setTile(x,y,t); identities.push([key(x,y),id]); }
  setTile(0,10,T.STONE);
  setTile(4,10,T.STONE);
  putTree('left',0,9,T.WOOD);
  putTree('left',0,8,T.WOOD);
  putTree('left',1,8,T.LEAF);
  putTree('left',1,7,T.LEAF);
  putTree('left',2,7,T.LEAF);
  putTree('right',4,9,T.WOOD);
  putTree('right',4,8,T.WOOD);
  putTree('right',4,7,T.WOOD);
  putTree('right',3,8,T.LEAF);
  putTree('right',3,7,T.LEAF);
  trees.restore({v:2, debris:[], identities}, getTile);
  trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(4,8), T.WOOD, 'touching registered neighbor is stable before support is removed');

  setTile(4,9,T.AIR);
  trees.onTileChanged(4,9,T.WOOD,T.AIR);
  trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(getTile(0,9), T.WOOD, 'stable touching tree keeps its grounded trunk');
  assert.equal(getTile(2,7), T.LEAF, 'stable touching tree keeps its canopy edge');
  assert.equal(getTile(4,8), T.AIR, 'unsupported neighbor trunk is released from the sky');
  assert.equal(getTile(3,7), T.AIR, 'unsupported neighbor canopy is released even though it touched another canopy');
  assert.ok(trees._fallingBlocks.some(b=>b.t===T.WOOD && b.x===4), 'released unsupported tree becomes falling debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  const identities=[];
  function putTree(id,x,y,t){ setTile(x,y,t); identities.push([key(x,y),id]); }
  setTile(0,10,T.STONE);
  putTree('left',0,9,T.WOOD);
  putTree('left',0,8,T.WOOD);
  putTree('left',1,8,T.LEAF);
  putTree('right',1,7,T.WOOD);
  putTree('right',1,6,T.WOOD);
  putTree('right',2,6,T.LEAF);
  trees.restore({v:2, debris:[], identities}, getTile);
  trees.updateFallingBlocks(getTile,setTile,1/60,{sx:-1,sy:0,viewX:8,viewY:14});
  assert.equal(getTile(0,9), T.WOOD, 'registered grounded tree remains when another tree rests on it');
  assert.equal(getTile(1,8), T.LEAF, 'registered grounded tree canopy is not treated as terrain support');
  assert.equal(getTile(1,7), T.AIR, 'registered floating tree resting on tree material is released');
  assert.equal(getTile(2,6), T.AIR, 'registered floating tree canopy resting on neighbor releases too');
  assert.ok(trees._fallingBlocks.some(b=>b.t===T.WOOD && b.x===1), 'registered tree-on-tree hover becomes falling debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(8,7,T.WOOD);
  setTile(8,6,T.WOOD);
  setTile(7,6,T.LEAF);
  setTile(9,6,T.LEAF);
  trees.updateFallingBlocks(getTile,setTile,1/60,{sx:0,sy:0,viewX:16,viewY:16});
  assert.equal(getTile(8,7), T.AIR, 'visible unregistered floating trunk is rescued from hovering');
  assert.equal(getTile(7,6), T.AIR, 'visible unregistered floating canopy is released with it');
  assert.ok(trees._fallingBlocks.some(b=>b.t===T.WOOD && b.x===8), 'rescued unregistered floating tree becomes falling debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(8,10,T.STONE);
  setTile(8,9,T.WOOD);
  setTile(8,8,T.WOOD);
  setTile(7,8,T.LEAF);
  setTile(9,8,T.LEAF);
  trees.updateFallingBlocks(getTile,setTile,1/60,{sx:0,sy:0,viewX:16,viewY:16});
  assert.equal(getTile(8,9), T.WOOD, 'visible unregistered grounded trunk remains stable');
  assert.equal(getTile(7,8), T.LEAF, 'visible unregistered grounded canopy remains stable');
  assert.equal(trees._fallingBlocks.length, 0, 'grounded rescue audit does not create debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,10,T.STONE);
  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(1,8,T.LEAF);
  setTile(1,7,T.LEAF);
  setTile(2,7,T.LEAF);
  setTile(4,8,T.WOOD);
  setTile(4,7,T.WOOD);
  setTile(3,8,T.LEAF);
  setTile(3,7,T.LEAF);

  trees.updateFallingBlocks(getTile,setTile,1/60,{sx:-1,sy:0,viewX:8,viewY:14});
  assert.equal(getTile(0,9), T.WOOD, 'old unregistered grounded tree remains in place');
  assert.equal(getTile(2,7), T.LEAF, 'old unregistered grounded tree keeps its touching canopy');
  assert.equal(getTile(4,8), T.AIR, 'old unregistered floating neighbor trunk is released');
  assert.equal(getTile(3,7), T.AIR, 'old unregistered floating neighbor canopy is released');
  assert.ok(trees._fallingBlocks.some(b=>b.t===T.WOOD && b.x===4), 'old unregistered floating neighbor becomes falling debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  setTile(0,10,T.STONE);
  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(1,8,T.LEAF);
  setTile(1,7,T.WOOD);
  setTile(1,6,T.WOOD);
  setTile(2,6,T.LEAF);
  trees.updateFallingBlocks(getTile,setTile,1/60,{sx:-1,sy:0,viewX:8,viewY:14});
  assert.equal(getTile(0,9), T.WOOD, 'old unregistered grounded tree remains under tree-on-tree contact');
  assert.equal(getTile(1,8), T.LEAF, 'old unregistered canopy remains but does not support the neighbor');
  assert.equal(getTile(1,7), T.AIR, 'old unregistered floating tree resting on tree material is released');
  assert.equal(getTile(2,6), T.AIR, 'old unregistered floating canopy resting on neighbor releases too');
  assert.ok(trees._fallingBlocks.some(b=>b.t===T.WOOD && b.x===1), 'old unregistered tree-on-tree hover becomes falling debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  for(let x=0;x<16;x++) setTile(x,20,T.STONE);
  setTile(8,7,T.WOOD);
  setTile(8,6,T.WOOD);
  setTile(7,6,T.LEAF);
  setTile(9,6,T.LEAF);
  trees.auditChunks([0],getTile);
  trees.settleAll(getTile,setTile);
  assert.equal(getTile(8,7), T.AIR, 'chunk audit catches offscreen floating trunk before save');
  assert.equal(getTile(7,6), T.AIR, 'chunk audit catches offscreen floating canopy before save');
  assert.equal(trees._fallingBlocks.length, 0, 'save-style settle drains chunk-audited floating tree debris');
  assert.ok([...trees._fallenTreeTiles].some(k=>getTile(+k.split(',')[0],+k.split(',')[1])===T.WOOD), 'chunk-audited tree lands as tracked fallen debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={};

  for(let x=0;x<320;x++) setTile(x,20,T.STONE);
  for(let i=0;i<260;i++){
    const x=i;
    setTile(x,7,T.WOOD);
    setTile(x,6,T.WOOD);
  }
  trees.auditChunks([0,1,2,3,4],getTile);
  trees.settleAll(getTile,setTile);
  let hovering=0;
  for(let i=0;i<260;i++) if(getTile(i,7)===T.WOOD || getTile(i,6)===T.WOOD) hovering++;
  assert.equal(hovering, 0, 'save-style settle drains more unsupported standing trees than one frame budget');
  assert.equal(trees._fallingBlocks.length, 0, 'large chunk audit leaves no active falling debris after settleAll');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  trees.buildTree(arr,13,20,'oak',13);
  copyChunkToTiles(arr);
  const snap=trees.snapshot();
  trees.resetIdentities();
  assert.equal(trees._tileTreeIds.size, 0, 'identity registry is absent before restore simulation');
  trees.restore(snap,getTile);
  assert.equal(trees._tileTreeIds.has('10,19'), true, 'tree identities survive save/restore');
  assert.equal(trees._tileTreeIds.has('13,19'), true, 'neighbor tree identity also survives save/restore');
  assert.equal(trees.startTreeFall(getTile,setTile,1,10,19), true, 'restored registered tree starts falling');
  assert.equal(getTile(13,19), T.WOOD, 'restored neighbor generated trunk remains standing by tree id');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===13 && b.t===T.WOOD), false, 'restored neighbor generated trunk is not in the falling body');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(5,5,T.STONE);
  trees.restore({v:2, debris:[], identities:[[key(5,5),'stale-tree-id']]}, getTile);
  assert.equal(trees._tileTreeIds.has('5,5'), false, 'tree identity restore ignores non-tree tiles');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(1,5,T.WOOD);
  setTile(2,5,T.WOOD);
  trees.restore({v:2, debris:[], identities:[[key(1,5),'old-a'],[key(2,5),'old-b']]}, getTile);
  assert.equal(trees._tileTreeIds.get('1,5'), 'old-a', 'initial restore records first tree identity');
  assert.equal(trees._tileTreeIds.get('2,5'), 'old-b', 'initial restore records second tree identity');
  trees.restore({v:2, debris:[], identities:[[key(2,5),'new-b']]}, getTile);
  assert.equal(trees._tileTreeIds.has('1,5'), false, 'restore removes identity tiles missing from the new snapshot');
  assert.equal(trees._treeTiles.has('old-a'), false, 'restore removes old tree id sets missing from the new snapshot');
  assert.equal(trees._tileTreeIds.get('2,5'), 'new-b', 'restore replaces existing identity ids with the new snapshot');
  trees.restore({v:2, debris:[], identities:[]}, getTile);
  assert.equal(trees._tileTreeIds.size, 0, 'empty restore snapshot clears all tree identity tiles');
  assert.equal(trees._treeTiles.size, 0, 'empty restore snapshot clears all tree identity sets');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(0,7,T.LEAF);
  assert.equal(trees.startTreeFall(getTile,setTile,1,0,9), true, 'test creates an active falling tree body');
  trees._fallingBlocks.push({x:3,y:2,t:T.LEAF,dir:1,hBudget:4});
  trees.restore({v:2, debris:[], identities:[]}, getTile);
  assert.equal(trees._fallingTrees.length, 0, 'restore clears active rotating tree bodies');
  assert.equal(trees._fallingBlocks.length, 0, 'restore clears active loose tree debris');
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>100;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};
  MM.wind={ speedAt(){ return 5; }, speed(){ return 5; } };
  for(let x=-40; x<=40; x++) setTile(x,90,T.STONE);

  trees._fallingBlocks.push({x:0,y:10,t:T.LEAF,dir:0,hBudget:0});
  for(let i=0;i<90;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(trees._fallingBlocks.length, 1, 'wind test keeps the leaf airborne before it reaches the floor');
  assert.ok(trees._fallingBlocks[0].x>=3, 'strong exposed wind carries loose leaves sideways');
  delete MM.wind;
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>100;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};
  MM.wind={ speedAt(){ return 5; }, speed(){ return 5; } };
  for(let x=-40; x<=40; x++) setTile(x,90,T.STONE);

  trees._fallingBlocks.push({x:0,y:10,t:T.WOOD,dir:0,hBudget:0});
  for(let i=0;i<90;i++) trees.updateFallingBlocks(getTile,setTile,1/60);
  assert.equal(trees._fallingBlocks.length, 1, 'wind test keeps the wood airborne before it reaches the floor');
  assert.ok(trees._fallingBlocks[0].x<=1, 'heavy wood debris catches far less wind than leaves');
  delete MM.wind;
}

{
  resetTiles();
  resetTreeSystem();
  worldGen.surfaceHeight = ()=>20;
  MM.fallingSolids={ onTileRemoved(){} };
  MM.water={};

  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  copyChunkToTiles(arr);
  assert.equal(getTile(10,19), T.WOOD, 'generated tree lower trunk exists before middle cut');
  assert.equal(getTile(10,18), T.WOOD, 'generated tree cut tile exists before middle cut');
  assert.equal(getTile(10,17), T.WOOD, 'generated tree upper trunk exists before middle cut');

  setTile(10,18,T.AIR);
  trees.onTileChanged(10,18,T.WOOD,T.AIR);
  assert.equal(trees.startTreeFall(getTile,setTile,1,10,17), true, 'cut middle trunk starts falling only from above the removed block');
  assert.equal(getTile(10,19), T.WOOD, 'trunk below the cut remains standing');
  assert.equal(getTile(10,18), T.AIR, 'removed cut tile stays removed');
  assert.equal(trees._fallingTrees.length, 1, 'upper tree part becomes one rotating body');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===10 && b.oy===19), false, 'lower trunk is not captured in the falling body');
  assert.equal(trees._fallingTrees[0].tiles.some(b=>b.ox===10 && b.oy===17), true, 'upper trunk is captured in the falling body');
}

{
  resetTiles();
  resetTreeSystem();
  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  assert.ok(trees._tileTreeIds.size>0, 'identity registry has generated tiles before clear');
  trees.clearChunk(0);
  assert.equal(trees._tileTreeIds.size, 0, 'clearing a chunk removes generated tree identities');
}

{
  resetTiles();
  resetTreeSystem();
  setTile(70,10,T.WOOD);
  trees.restore({v:1, debris:['70,10']}, getTile);
  assert.equal(trees._fallenTreeTiles.has('70,10'), true, 'fallen tree debris marker exists before chunk clear');
  trees.clearChunk(1);
  assert.equal(trees._fallenTreeTiles.has('70,10'), false, 'clearing a chunk removes fallen tree debris markers');
}

{
  resetTiles();
  resetTreeSystem();
  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  assert.equal(trees._tileTreeIds.has('10,19'), true, 'generated trunk tile has identity');
  trees.onTileChanged(10,19,T.WOOD,T.AIR);
  assert.equal(trees._tileTreeIds.has('10,19'), false, 'world tile changes remove stale tree identity');
}

{
  resetTiles();
  resetTreeSystem();
  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  trees.buildTree(arr,10,20,'oak',10);
  assert.equal(trees._tileTreeIds.has('10,19'), true, 'generated trunk tile has identity before structure pruning');
  arr[19*CHUNK_W+10]=T.STONE;
  trees.pruneChunk(arr,0);
  assert.equal(trees._tileTreeIds.has('10,19'), false, 'raw chunk overwrites prune stale tree identity');
}

{
  resetTiles();
  resetTreeSystem();
  const original={
    surfaceHeight:worldGen.surfaceHeight,
    biomeType:worldGen.biomeType,
    column:worldGen.column,
    valueNoise:worldGen.valueNoise,
    randSeed:worldGen.randSeed,
    settings:worldGen.settings
  };
  const surf=32;
  const arr=new Uint8Array(CHUNK_W*WORLD_H);
  for(let x=0;x<CHUNK_W;x++){
    arr[surf*CHUNK_W+x]=T.GRASS;
    for(let y=surf+1;y<WORLD_H;y++) arr[y*CHUNK_W+x]=T.STONE;
  }
  worldGen.surfaceHeight=()=>surf;
  worldGen.biomeType=()=>0;
  worldGen.column=()=>({row:surf,biome:0});
  worldGen.valueNoise=()=>0.95;
  worldGen.randSeed=()=>0;
  worldGen.settings=Object.assign({}, original.settings, {forestDensityMul:8});
  trees.populateChunk(arr,0);
  const bases=[];
  for(let x=0;x<CHUNK_W;x++){
    if(arr[(surf-1)*CHUNK_W+x]===T.WOOD) bases.push(x);
    else {
      for(let y=Math.max(0,surf-14); y<surf-1; y++){
        assert.notEqual(arr[y*CHUNK_W+x], T.WOOD, 'max density does not create upper trunks without a grounded base');
      }
    }
  }
  assert.ok(bases.length>=4, 'max density still creates a visible forest');
  for(let i=1;i<bases.length;i++){
    assert.ok(bases[i]-bases[i-1]>=4, 'max density keeps generated tree trunks separated');
  }
  worldGen.surfaceHeight=original.surfaceHeight;
  worldGen.biomeType=original.biomeType;
  worldGen.column=original.column;
  worldGen.valueNoise=original.valueNoise;
  worldGen.randSeed=original.randSeed;
  worldGen.settings=original.settings;
}

{
  resetTiles();
  resetTreeSystem();
  for(let x=-2; x<=14; x++) setTile(x,12,T.STONE);
  for(let x=0; x<10; x++){
    setTile(x,11,T.WOOD);
    setTile(x,10,T.LEAF);
    trees._fallenTreeTiles.add(key(x,11));
    trees._fallenTreeTiles.add(key(x,10));
  }
  trees._unstableFallenTreeTiles.clear();
  trees.auditStandingTreesInArea(getTile,{sx:-1,sy:8,viewX:14,viewY:6});
  assert.equal(trees._unstableFallenTreeTiles.size, 0, 'stable fallen tree piles are not requeued every visible-area audit');
  assert.equal(trees.metrics().fallen, 20, 'tree metrics expose settled debris count for perf debugging');
}

{
  const mainSource=readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
  assert.match(mainSource,/tId===T\.WOOD && getTile\(mineTx,mineTy-1\)===T\.WOOD\) startTreeFall\(mineTx,mineTy-1\)/,'mining only starts a tree fall when another trunk block remains above the removed wood');
}

console.log('tree-fall-sim: all assertions passed');
