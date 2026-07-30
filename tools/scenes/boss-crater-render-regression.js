const fail=message=>'FAIL :: '+message;
if(!window.MM || !window.player || !MM.world || !MM.worldGen || !MM.T
  || !MM.bosses || !window.__mmDebugHero || !window.__mmWorldToScreen)
  return fail('boss/world/render QA APIs did not finish booting');

const W=MM.world, T=MM.T;
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.25});
if(MM.mobs && MM.mobs.clearAll) MM.mobs.clearAll();
MM.bosses.clearAll();

const spawnX=Math.round(player.x+14);
const monster=MM.bosses.forceSpawn(W.getTile,{x:spawnX,seed:0x51a7c0de,freeze:true});
if(!monster) return fail('could not force-spawn the crater boss');
const heroX=monster.x-12;
window.__mmDebugHero(heroX,MM.worldGen.surfaceHeight(Math.floor(heroX))-2);
await sleep(700);

const canvas=document.getElementById('game');
const ctx=canvas&&canvas.getContext('2d');
if(!ctx) return fail('game canvas is unavailable');
const beforePixels=ctx.getImageData(0,0,canvas.width,canvas.height);
const worldHeight=Number.isFinite(MM.WORLD_H)?MM.WORLD_H:140;
const scanX0=Math.floor(monster.x)-24, scanX1=Math.floor(monster.x)+24;
const beforeTiles=new Map();
for(let x=scanX0;x<=scanX1;x++){
  for(let y=1;y<worldHeight-3;y++) beforeTiles.set(`${x},${y}`,W.getTile(x,y));
}

const killed=MM.bosses.killNearest(W.getTile,W.setTile);
if(!killed || !monster.dying || !monster.heartItem)
  return fail('real boss death path did not release its heart');
let blastPoint={x:monster.heartItem.x,y:monster.heartItem.y};
for(let i=0;i<900 && !monster.dead;i++){
  if(monster.heartItem) blastPoint={x:monster.heartItem.x,y:monster.heartItem.y};
  MM.bosses.update(W.getTile,W.setTile,0.05);
}
if(!monster.dead) return fail('boss heart never detonated');
await sleep(1000);
for(let i=0;i<4;i++) await new Promise(resolve=>requestAnimationFrame(resolve));

const changed=[];
for(const [key,tile] of beforeTiles){
  if(tile===T.AIR) continue;
  const comma=key.indexOf(',');
  const x=Number(key.slice(0,comma)), y=Number(key.slice(comma+1));
  if(W.getTile(x,y)===T.AIR) changed.push({x,y});
}
if(!changed.length) return fail('boss explosion did not carve any terrain');

const rect=canvas.getBoundingClientRect();
const sample=(image,tile)=>{
  const p=window.__mmWorldToScreen(tile.x+0.5,tile.y+0.5);
  const bx=(p.x-rect.left)*canvas.width/Math.max(1,rect.width);
  const by=(p.y-rect.top)*canvas.height/Math.max(1,rect.height);
  const radius=Math.max(2,Math.floor(p.scale*0.16));
  const x0=Math.max(0,Math.floor(bx-radius)), x1=Math.min(image.width-1,Math.ceil(bx+radius));
  const y0=Math.max(0,Math.floor(by-radius)), y1=Math.min(image.height-1,Math.ceil(by+radius));
  if(x0>=x1 || y0>=y1) return null;
  const rgb=[0,0,0]; let count=0;
  for(let y=y0;y<=y1;y++){
    for(let x=x0;x<=x1;x++){
      const i=(y*image.width+x)*4;
      rgb[0]+=image.data[i]; rgb[1]+=image.data[i+1]; rgb[2]+=image.data[i+2]; count++;
    }
  }
  return rgb.map(value=>value/Math.max(1,count));
};
const afterPixels=ctx.getImageData(0,0,canvas.width,canvas.height);
let bestDelta=0, sampled=0;
for(const tile of changed){
  const p=window.__mmWorldToScreen(tile.x+0.5,tile.y+0.5);
  const d=Math.hypot(tile.x+0.5-blastPoint.x,tile.y+0.5-blastPoint.y);
  if(d<2.5 || p.x<20 || p.x>rect.width-20 || p.y<90 || p.y>rect.height-40) continue;
  const before=sample(beforePixels,tile), after=sample(afterPixels,tile);
  if(!before || !after) continue;
  sampled++;
  const delta=before.reduce((sum,value,index)=>sum+Math.abs(value-after[index]),0);
  bestDelta=Math.max(bestDelta,delta);
}
if(!sampled) return fail('carved boss tiles were outside the pixel probe');
if(bestDelta<24)
  return fail('boss crater stayed visually solid; best pixel distance='+bestDelta.toFixed(1));

const chunks=(window.__mmPerf&&window.__mmPerf.chunks)||{};
return 'ok :: craterCells='+changed.length
  +'; sampled='+sampled
  +'; bestPixelDelta='+bestDelta.toFixed(1)
  +'; chunkPressure='+(chunks.rebuilt||0)+'/'+(chunks.partial||0)+'/'+(chunks.deferred||0);
