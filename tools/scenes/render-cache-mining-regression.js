const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.world || !MM.worldGen || !MM.T || !window.player
  || !window.__mmDebugHero || !window.__mmWorldToScreen)
  return fail('world/render QA APIs did not finish booting');

const W=MM.world, T=MM.T;
const anchorX=Math.floor(player.x);
const surface=Math.floor(MM.worldGen.surfaceHeight(anchorX));
const maxY=Number.isFinite(W.maxY)?W.maxY:279;
const chamberY=Math.min(maxY-10,Math.max(surface+14,72));
const wallX=anchorX+6;
const target={x:wallX,y:chamberY};

if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.25});
if(MM.mobs && MM.mobs.clearAll) MM.mobs.clearAll();
if(MM.bosses && MM.bosses.clearAll) MM.bosses.clearAll();
if(MM.fallingSolids && MM.fallingSolids.reset) MM.fallingSolids.reset();

// Build a quiet underground room with a supported stone wall. The target is
// far enough from the hero that neither the sprite nor its lamp covers the
// sampled pixels.
const protectedCells=[];
for(let x=anchorX-10;x<=anchorX+10;x++){
  for(let y=chamberY-6;y<=chamberY+6;y++){
    const border=x===anchorX-10 || x===anchorX+10 || y===chamberY-6 || y===chamberY+6;
    W.setTile(x,y,border?T.STONE:T.AIR);
    if(border) protectedCells.push({x,y});
  }
}
for(let y=chamberY-4;y<=chamberY+4;y++){
  W.setTile(wallX,y,T.STONE);
  protectedCells.push({x:wallX,y});
}
if(MM.fallingSolids && MM.fallingSolids.protectStructure)
  MM.fallingSolids.protectStructure(protectedCells);

window.__mmDebugHero(anchorX,chamberY);
await sleep(900);

const canvas=document.getElementById('game');
if(!canvas) return fail('game canvas is unavailable');
const nextFrames=async count=>{
  for(let i=0;i<count;i++) await new Promise(resolve=>requestAnimationFrame(resolve));
};
const sampleTile=tile=>{
  const p=window.__mmWorldToScreen(tile.x+0.5,tile.y+0.5);
  const rect=canvas.getBoundingClientRect();
  const bx=(p.x-rect.left)*canvas.width/Math.max(1,rect.width);
  const by=(p.y-rect.top)*canvas.height/Math.max(1,rect.height);
  const radius=Math.max(2,Math.floor(p.scale*0.18));
  const x=Math.max(0,Math.min(canvas.width-1,Math.floor(bx-radius)));
  const y=Math.max(0,Math.min(canvas.height-1,Math.floor(by-radius)));
  const width=Math.max(1,Math.min(canvas.width-x,radius*2+1));
  const height=Math.max(1,Math.min(canvas.height-y,radius*2+1));
  const data=canvas.getContext('2d').getImageData(x,y,width,height).data;
  const rgb=[0,0,0];
  for(let i=0;i<data.length;i+=4){
    rgb[0]+=data[i]; rgb[1]+=data[i+1]; rgb[2]+=data[i+2];
  }
  const pixels=Math.max(1,data.length/4);
  return rgb.map(value=>value/pixels);
};
const colorDistance=(a,b)=>a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]),0);

await nextFrames(4);
const solidBefore=sampleTile(target);
W.setTile(target.x,target.y,T.AIR);
await nextFrames(6);
const minedAir=sampleTile(target);
const minedDistance=colorDistance(solidBefore,minedAir);
if(W.getTile(target.x,target.y)!==T.AIR)
  return fail('logical mining path did not remove the target tile');
if(minedDistance<24)
  return fail('mined tile stayed visually solid; pixel distance='+minedDistance.toFixed(1));

// Exercise the version-reuse case introduced by Temporal Echo: render a branch
// edit, then restore its checkpoint (and therefore its old chunk version).
W.setTile(target.x,target.y,T.STONE);
await nextFrames(6);
const checkpointSolid=sampleTile(target);
if(!W.beginTemporalCheckpoint()) return fail('could not begin temporal checkpoint');
W.setTile(target.x,target.y,T.AIR);
await nextFrames(6);
const branchAir=sampleTile(target);
if(!W.restoreTemporalCheckpoint()) return fail('could not restore temporal checkpoint');
await nextFrames(6);
const restoredSolid=sampleTile(target);
const branchDistance=colorDistance(branchAir,restoredSolid);
const restoreError=colorDistance(checkpointSolid,restoredSolid);
if(W.getTile(target.x,target.y)!==T.STONE)
  return fail('temporal restore did not restore the logical stone tile');
if(branchDistance<24)
  return fail('temporal restore reused stale cave pixels; distance='+branchDistance.toFixed(1));
if(restoreError>=branchDistance)
  return fail('restored pixels resemble the discarded cave more than the checkpoint wall');

const chunks=(window.__mmPerf&&window.__mmPerf.chunks)||{};
return 'ok :: minedPixelDelta='+minedDistance.toFixed(1)
  +'; rewindPixelDelta='+branchDistance.toFixed(1)
  +'; restoreError='+restoreError.toFixed(1)
  +'; chunkPressure='+(chunks.rebuilt||0)+'/'+(chunks.partial||0)+'/'+(chunks.deferred||0);
