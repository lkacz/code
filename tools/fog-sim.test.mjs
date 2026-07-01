// Fog-of-war regression tests: ordinary vision is current line-of-sight plus
// remembered discoveries, while special eyes can still reveal the old full radius.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, CHUNK_W, isSolid } = await import('../src/constants.js');
const { gases } = await import('../src/engine/gases.js');
const { fog } = await import('../src/engine/fog.js');
assert.ok(gases, 'gases module exports');

const tiles = new Map();
const getTile = (x,y)=>tiles.get(x+','+y) ?? T.AIR;
const setTile = (x,y,t)=>tiles.set(x+','+y,t);

for(let y=0;y<WORLD_H;y++) setTile(2,y,T.STONE);
setTile(3,5,T.STONE);
setTile(4,5,T.STONE);

fog.importSeen([]);
fog.setRevealAll(false);
fog.revealAround(0,5,6,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
assert.equal(fog._hasVisible(1,5), true, 'open tile before the wall is visible');
assert.equal(fog._hasVisible(2,5), true, 'the blocking wall face is visible');
assert.equal(fog._hasVisible(3,5), false, 'ordinary eyes do not reveal behind the wall');
assert.equal(fog._hasSeen(1,5), true, 'ordinary eyes remember discovered open tiles');
assert.equal(fog._hasSeen(2,5), true, 'ordinary eyes remember discovered wall faces');
assert.equal(fog._hasSeen(3,5), false, 'blocked tiles are not added to seen history');
assert.equal(fog.hasVisible(1,5), true, 'public visible helper mirrors current line-of-sight');
assert.equal(fog.hasSeen(3,5), false, 'public seen helper keeps undiscovered details hidden from render effects');
assert.equal(fog.hasLineOfSight(0,5,2,5,getTile,(t)=>isSolid(t)), true, 'public LOS exposes the first blocking face');
assert.equal(fog.hasLineOfSight(0,5,3,5,getTile,(t)=>isSolid(t)), false, 'public LOS rejects blocks hidden behind another block');

{
  setTile(10,-12,T.GLASS);
  setTile(11,WORLD_H+8,T.BASALT);
  fog.importSeen([]);
  fog.setRevealAll(false);
  fog.revealAround(10,-13,3,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
  assert.equal(fog.hasSeen(10,-12), true, 'fog tracks discovered sky-section tiles above legacy y=0');
  assert.equal(fog.hasVisible(10,-12), true, 'current visibility also works in sky sections');

  fog.revealAround(11,WORLD_H+7,3,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
  assert.equal(fog.hasSeen(11,WORLD_H+8), true, 'fog tracks discovered deep-section tiles below legacy WORLD_H');

  fog.importSeen([]);
  const skyFills=[];
  const skyCtx={fillStyle:'', fillRect(x,y,w,h){ skyFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(skyCtx,10,-12,0,0,1,getTile,T,{showMemory:true});
  assert.ok(skyFills.some(f=>f.style==='#000' && f.y===-12), 'unseen solid sky islands are hidden by fog');

  const legacy = new Uint8Array(Math.ceil((CHUNK_W*WORLD_H)/8));
  const legacyIdx = 5*CHUNK_W;
  legacy[legacyIdx>>3] |= (1 << (legacyIdx & 7));
  fog.importSeen([{cx:0,data:Buffer.from(legacy).toString('base64'),rle:false}]);
  assert.equal(fog.hasSeen(0,5), true, 'legacy fog bitsets migrate into the base vertical band');
  assert.equal(fog.hasSeen(0,WORLD_MIN_Y), false, 'legacy fog migration does not smear seen bits into the new sky band');
  assert.equal(fog.hasSeen(0,WORLD_MAX_Y-1), false, 'legacy fog migration does not smear seen bits into the new deep band');

  setTile(10,-12,T.AIR);
  setTile(11,WORLD_H+8,T.AIR);
  fog.importSeen([]);
}

{
  setTile(31,5,T.STONE);
  setTile(30,6,T.STONE);
  setTile(31,6,T.DIAMOND);
  fog.importSeen([]);
  fog.setRevealAll(false);
  fog.revealAround(30,5,3,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
  assert.equal(fog.hasLineOfSight(30,5,31,6,getTile,(t)=>isSolid(t)), false, 'ordinary LOS cannot pass through a sealed diagonal corner');
  assert.equal(fog._hasVisible(31,6), false, 'ordinary reveal does not expose a block behind a sealed diagonal corner');
  assert.equal(fog._hasSeen(31,6), false, 'sealed diagonal corner target is not remembered as discovered');

  setTile(40,6,T.STONE);
  setTile(41,5,T.AIR);
  setTile(41,6,T.DIAMOND);
  fog.importSeen([]);
  fog.revealAround(40,5,3,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
  assert.equal(fog.hasLineOfSight(40,5,41,6,getTile,(t)=>isSolid(t)), true, 'ordinary LOS can still see a diagonal blocking face when one side is open');
  assert.equal(fog._hasVisible(41,6), true, 'one open side still exposes the first diagonal blocking face');

  fog.importSeen([]);
  fog.setRevealAll(false);
  fog.revealAround(0,5,6,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
}

{
  const fills=[];
  const ctx={fillStyle:'', fillRect(x,y,w,h){ fills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(ctx,3,5,0,0,1,getTile,T,{showMemory:true});
  assert.equal(fills.some(f=>f.x===3 && f.y===5 && f.w===2 && f.style==='#000'), true, 'never-seen hidden terrain is fully black and batched');
}

{
  const farX=-4999999;
  setTile(farX,5,T.STONE);
  fog.importSeen([]);
  fog.setRevealAll(false);
  fog.revealRect(farX+3,6,farX-3,4,{lineOfSight:false,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
  assert.equal(fog.hasSeen(farX,5), true, 'rect reveal handles very large negative world columns');
  assert.ok(fog.exportSeen().some(row=>row.cx===Math.floor(farX/CHUNK_W)), 'large negative seen chunks export with their real chunk key');

  fog.importSeen([]);
  fog.revealAround(0,1,0,{lineOfSight:false,rememberSeen:false,getTile,blocksSight:(t)=>isSolid(t)});
  const localFills=[];
  const localCtx={fillStyle:'', fillRect(x,y,w,h){ localFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(localCtx,farX,5,0,0,1,getTile,T,{showMemory:true,originX:farX-1,originY:4});
  assert.equal(localFills.some(f=>f.x===1 && f.y===1 && f.style==='#000'), true, 'fog overlay can draw at camera-local coordinates for huge world columns');
  setTile(farX,5,T.AIR);
}

{
  for(let x=60;x<=62;x++){
    for(let y=20;y<=22;y++) setTile(x,y,T.STONE);
  }
  fog.importSeen([]);
  fog.setRevealAll(false);
  fog.revealAround(200,1,1,{lineOfSight:false,rememberSeen:false,getTile,blocksSight:(t)=>isSolid(t)});
  const mergedFills=[];
  const mergedCtx={fillStyle:'', fillRect(x,y,w,h){ mergedFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(mergedCtx,60,20,1,1,1,getTile,T,{showMemory:true});
  assert.equal(mergedFills.some(f=>f.x===60 && f.y===20 && f.w===3 && f.h===3 && f.style==='#000'), true, 'touching unseen black fog tiles merge into a single continuous rectangle');

  const seamFills=[];
  const seamCtx={fillStyle:'', fillRect(x,y,w,h){ seamFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(seamCtx,60,20,1,1,20,getTile,T,{showMemory:true});
  assert.equal(seamFills.some(f=>f.style==='#000' && f.x<60*20 && f.y<20*20 && f.w>3*20 && f.h>3*20), true, 'black fog overpaints subpixel seams at normal tile sizes');
  for(let x=60;x<=62;x++){
    for(let y=20;y<=22;y++) setTile(x,y,T.AIR);
  }
  fog.importSeen([]);
  fog.revealAround(0,5,6,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
}

fog.revealAround(20,5,1,{lineOfSight:true,rememberSeen:true,getTile,blocksSight:(t)=>isSolid(t)});
{
  const fills=[];
  const ctx={fillStyle:'', fillRect(x,y,w,h){ fills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(ctx,2,5,0,0,1,getTile,T,{showMemory:true});
  assert.equal(fills.some(f=>f.x===2 && f.y===5 && f.style==='rgba(0,0,0,.48)'), true, 'seen terrain remains visible as dim map memory');
  assert.equal(fills.some(f=>f.x===3 && f.y===5 && f.style==='#000'), true, 'terrain blocked by the wall is still unknown');

  const exactFills=[];
  const exactCtx={fillStyle:'', fillRect(x,y,w,h){ exactFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(exactCtx,2,5,0,0,20,getTile,T,{showMemory:true});
  assert.equal(exactFills.some(f=>f.x===40 && f.y===100 && f.w===20 && f.h===40 && f.style==='rgba(0,0,0,.48)'), true, 'remembered dim fog keeps exact merged bounds at normal tile sizes');
}

fog.revealAround(0,5,6,{lineOfSight:false,getTile,blocksSight:(t)=>isSolid(t)});
assert.equal(fog._hasVisible(3,5), true, 'x-ray eyes reveal behind the wall');
assert.equal(fog._hasSeen(3,5), true, 'x-ray reveal still persists in seen history');

{
  let surfaceCalls=0;
  MM.worldGen={ surfaceHeight(){ surfaceCalls++; return 4; } };
  const fills=[];
  const ctx={fillStyle:'', fillRect(x,y,w,h){ fills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.revealAround(200,1,1,{lineOfSight:false,rememberSeen:false,getTile,blocksSight:(t)=>isSolid(t)});
  fog.applyOverlay(ctx,40,8,5,6,1,getTile,T,{showMemory:true});
  assert.ok(fills.length>0, 'underground unseen air is still covered by fog');
  assert.ok(surfaceCalls<=7, 'fog overlay caches surfaceHeight per visible column instead of per tile ('+surfaceCalls+')');
  MM.worldGen={};
}

{
  fog.importSeen([]);
  fog.setRevealAll(false);
  MM.worldGen={ surfaceHeight(){ return 10; } };
  setTile(50,5,T.HOT_AIR);
  const skyFills=[];
  const skyCtx={fillStyle:'', fillRect(x,y,w,h){ skyFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.revealAround(200,1,1,{lineOfSight:false,rememberSeen:false,getTile,blocksSight:(t)=>isSolid(t)});
  fog.applyOverlay(skyCtx,50,5,0,0,1,getTile,T,{showMemory:true});
  assert.equal(skyFills.length,0,'unseen hot air in open sky does not become a black fog block');

  setTile(52,12,T.STEAM);
  const openSteamFills=[];
  const openSteamCtx={fillStyle:'', fillRect(x,y,w,h){ openSteamFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(openSteamCtx,52,12,0,0,1,getTile,T,{showMemory:true});
  assert.equal(openSteamFills.some(f=>f.y===12 && f.x<=52 && f.x+f.w>52 && f.style==='#000'),false,'sky-exposed steam below the nominal surface fades instead of becoming a black fog block');

  setTile(51,12,T.HOT_AIR);
  setTile(51,11,T.STONE);
  const caveFills=[];
  const caveCtx={fillStyle:'', fillRect(x,y,w,h){ caveFills.push({style:this.fillStyle,x,y,w,h}); }};
  fog.applyOverlay(caveCtx,51,12,0,0,1,getTile,T,{showMemory:true});
  assert.ok(caveFills.some(f=>f.style==='#000'),'unseen underground gas is still hidden by cave fog');
  setTile(50,5,T.AIR);
  setTile(51,12,T.AIR);
  setTile(51,11,T.AIR);
  setTile(52,12,T.AIR);
  MM.worldGen={};
}

console.log('fog-sim: all assertions passed');
