// Visual/performance scene for polished material rendering.
const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.world || !MM.worldGen || !MM.T || !window.player || !window.__mmDebugHero)
  return fail('world/debug APIs did not finish booting');

const T=MM.T;
const setTile=MM.world.setTile;
const cx=Math.floor(player.x);
const floor=Math.max(24,Math.min(118,MM.worldGen.surfaceHeight(cx)-1));

if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.25});
if(MM.mobs && MM.mobs.clearAll) MM.mobs.clearAll();
if(MM.fallingSolids && MM.fallingSolids.reset) MM.fallingSolids.reset();

// A clean daylight gallery: silver ingot, steel, iridium, silver ore and gold ore.
const protectedCells=[];
for(let x=cx-25;x<=cx+25;x++){
  for(let y=floor-12;y<floor;y++){
    if(MM.world.clearInfrastructure) MM.world.clearInfrastructure(x,y);
    setTile(x,y,T.AIR);
  }
  for(let y=floor;y<=floor+2;y++){
    setTile(x,y,T.BEDROCK);
    protectedCells.push({x,y});
  }
}
const samples=[T.SILVER_INGOT,T.STEEL,T.IRIDIUM,T.SILVER_ORE,T.GOLD_ORE];
for(let i=0;i<samples.length;i++){
  const left=cx-22+i*9;
  for(let x=left;x<left+6;x++){
    for(let y=floor-7;y<floor;y++){
      setTile(x,y,samples[i]);
      protectedCells.push({x,y});
    }
  }
}
if(MM.fallingSolids && MM.fallingSolids.protectStructure)
  MM.fallingSolids.protectStructure(protectedCells);

window.__mmDebugHero(cx,floor-1.2);
player.onGround=true;
const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
const controls=document.getElementById('controls'); if(controls) controls.style.display='none';
// Freeze simulation after staging. Rendering keeps running, while the new
// view-dependent reflection correctly stays still with the hero.
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true}));
document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'b',bubbles:true}));
const pausePanel=document.getElementById('pausePanel'); if(pausePanel) pausePanel.style.display='none';

await sleep(900);
const draws=[];
let rebuilt=0,partial=0,deferred=0;
for(let i=0;i<40;i++){
  await new Promise(resolve=>requestAnimationFrame(resolve));
  const perf=window.__mmPerf || {};
  if(Number.isFinite(perf.drawMs)) draws.push(perf.drawMs);
  const chunks=perf.chunks || {};
  rebuilt+=chunks.rebuilt||0;
  partial+=chunks.partial||0;
  deferred+=chunks.deferred||0;
}
draws.sort((a,b)=>a-b);
const avg=draws.reduce((sum,n)=>sum+n,0)/Math.max(1,draws.length);
const median=draws.length?draws[Math.floor(draws.length/2)]:NaN;
const max=draws.length?draws[draws.length-1]:NaN;
return 'ok :: gallery=silver,steel,iridium,silverOre,goldOre; drawMs avg/median/max='+
  [avg,median,max].map(n=>Number.isFinite(n)?n.toFixed(2):'?').join('/')+
  '; chunks='+[rebuilt,partial,deferred].join('/');
