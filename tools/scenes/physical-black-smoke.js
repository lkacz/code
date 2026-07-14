const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.world || !MM.worldGen || !MM.T || !MM.smoke || !MM.fire || !MM.gases || !window.player)
  return fail('smoke/fire/world APIs did not finish booting');

const T=MM.T;
const getTile=MM.world.getTile;
const setTile=MM.world.setTile;
const cx=Math.floor(player.x);
const floor=MM.worldGen.surfaceHeight(cx)-1;
const roof=floor-9;
const left=cx-10;
const right=cx+10;
const ventX=right-3;

MM.smoke.reset();
MM.fire.reset();
MM.gases.reset();
if(MM.wind && MM.wind.setOverride) MM.wind.setOverride(1.2);
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.38});

// Build a broad brick test room with a distant roof vent. Smoke must spread
// under the ceiling before it can find this opening; it cannot cross masonry.
const qaStructure=[];
for(let y=roof-4;y<=floor+1;y++){
  for(let x=left-1;x<=right+1;x++){
    const boundary=x===left || x===right || y===roof || y===floor;
    setTile(x,y,boundary?T.BRICK:T.AIR);
    if(boundary) qaStructure.push({x,y});
  }
}
// Keep the cap closed during the long accumulation phase, then open it below.
setTile(ventX,roof,T.BRICK);
for(let y=roof-4;y<roof;y++){
  setTile(ventX-1,y,T.BRICK);
  setTile(ventX,y,T.AIR);
  setTile(ventX+1,y,T.BRICK);
}

// Real burning coal is the source. Step the real fire and smoke engines
// directly so software-rasterized headless time does not starve the scene.
const coalY=floor-1;
const coalSources=[left+4,left+7,left+10];
for(const coalX of coalSources){
  setTile(coalX,coalY,T.COAL);
  if(!MM.fire.ignite(coalX,coalY,getTile,setTile)) return fail('coal source did not ignite at '+coalX);
}
for(let i=0;i<450;i++){
  MM.fire.update(getTile,setTile,0.1);
  MM.smoke.update(0.1,getTile);
}
setTile(ventX,roof,T.AIR);
for(let i=0;i<40;i++){
  MM.fire.update(getTile,setTile,0.1);
  MM.smoke.update(0.1,getTile);
}

// Add a poison pocket after smoke has filled the ceiling band. Both layers
// should occupy the same world position without replacing one another.
const poisonX=cx+1;
const poisonY=roof+2;
const poisonPlaced=MM.gases.add('poison',poisonX+0.5,poisonY+0.5,{power:1,cells:3,getTile,setTile});
for(let i=0;i<8;i++) MM.smoke.update(0.1,getTile);
let overlap=null;
for(const c of MM.smoke.snapshot().list){
  if(MM.gases.gasAt(c.x,c.y,getTile)==='poison' && c.d>0.04){ overlap=c; break; }
}
if(!overlap){
  // Put a small part of the existing ceiling layer over the gas pocket; this is
  // still the public overlay API and deliberately leaves the gas tile intact.
  MM.smoke.emit(poisonX+0.5,poisonY+0.5,0.28,{getTile});
  if(MM.gases.gasAt(poisonX,poisonY,getTile)==='poison' && MM.smoke.densityAt(poisonX,poisonY)>0)
    overlap={x:poisonX,y:poisonY,d:MM.smoke.densityAt(poisonX,poisonY)};
}

const metrics=MM.smoke.metrics();
const state=MM.smoke.snapshot();
const ceilingMass=state.list.filter(c=>c.y<=roof+3).reduce((n,c)=>n+c.d,0);
const floorMass=state.list.filter(c=>c.y>=floor-3).reduce((n,c)=>n+c.d,0);
const throughWall=state.list.some(c=>(c.x<left || c.x>right) && c.y>=roof && c.y<floor);
const escaped=state.list.some(c=>c.y<roof && c.x>=ventX-1 && c.x<=ventX+1);
if(metrics.active<12 || metrics.mass<5 || ceilingMass<=floorMass)
  return fail('room did not develop a buoyant accumulated smoke layer: '+JSON.stringify({metrics,ceilingMass,floorMass}));
if(throughWall) return fail('smoke crossed a solid room wall');
if(!escaped) return fail('smoke did not find the open roof vent');
if(poisonPlaced<1 || !overlap || MM.gases.gasAt(overlap.x,overlap.y,getTile)!=='poison')
  return fail('black-smoke/poison-gas overlap was not preserved: '+JSON.stringify({poisonPlaced,overlap}));

// Exercise the real world -> smoke notification seam, not only the isolated
// engine test. Construction must synchronously clear a smoky coordinate.
const displaced=state.list.find(c=>c.d>0.05 && c.x>left+1 && c.x<right-1 && c.y>roof && c.y<floor-1);
if(!displaced) return fail('no suitable smoke cell for construction displacement check');
setTile(displaced.x,displaced.y,T.BRICK);
if(MM.smoke.densityAt(displaced.x,displaced.y)>0)
  return fail('world construction did not immediately displace smoke');
setTile(displaced.x,displaced.y,T.AIR);

// This is a smoke-render scene, not a construction-collapse scene. Tile writes
// correctly woke the structural solver. Stop further fuel changes, clear its
// QA-only pending work and mark the test shell as managed so render-time chunk
// audits cannot change the room framing between screenshot samples.
MM.fire.reset();
for(const coalX of coalSources) setTile(coalX,coalY,T.TORCH);
if(MM.fallingSolids && MM.fallingSolids.reset) MM.fallingSolids.reset();
if(MM.fallingSolids && MM.fallingSolids.protectStructure) MM.fallingSolids.protectStructure(qaStructure);

window.__mmDebugHero(cx+4.5,floor-2.1);
player.onGround=true;
const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
const controls=document.getElementById('controls'); if(controls) controls.style.display='none';

return 'ok :: active='+metrics.active+' mass='+metrics.mass+' dense='+metrics.dense
  +'; ceiling/floor='+ceilingMass.toFixed(1)+'/'+floorMass.toFixed(1)
  +'; vented=yes; poisonOverlap='+overlap.x+','+overlap.y;
