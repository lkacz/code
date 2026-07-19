// Physical black-smoke overlay regression.
// Run: node tools/black-smoke-sim.test.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

globalThis.window=globalThis;
globalThis.MM={
  wind:{speed:()=>0},
  worldGen:{surfaceHeight:()=>1}
};

function spriteCtx(){
  return {
    fillStyle:'', globalAlpha:1, globalCompositeOperation:'source-over',
    save(){},restore(){},fillRect(){},drawImage(){},beginPath(){},arc(){},fill(){},
    createRadialGradient(){ return {addColorStop(){}}; }
  };
}
globalThis.document={
  createElement(){ return {width:0,height:0,getContext(){ return spriteCtx(); }}; }
};

const {T}=await import('../src/constants.js');
const {smoke}=await import('../src/engine/smoke.js');
assert.ok(smoke,'smoke module exports');
assert.equal(typeof smoke.updateSoot,'function','smoke exposes lightweight creature soot accumulation');
assert.equal(typeof smoke.drawSootMarks,'function','smoke exposes shared soot rendering');

const tiles=new Map();
const tileKey=(x,y)=>x+','+y;
const getTile=(x,y)=>tiles.get(tileKey(x,y)) ?? T.STONE;
const setTile=(x,y,t)=>tiles.set(tileKey(x,y),t);

// Dense smoke leaves a persistent film on a moving body. The immediate smoke
// tint reacts quickly, while the accumulated soot wears away rather than popping.
smoke.reset();
assert.equal(smoke.restore({v:1,list:[{x:10,y:10,d:1.2,age:0}]},()=>T.AIR),true,'soot fixture smoke restores');
const smokyBody={x:10.5,y:10.5,h:0.95,vx:2.4,vy:0,soot:0,_smokeTint:0};
for(let i=0;i<45;i++) smoke.updateSoot(smokyBody,0.1,{height:smokyBody.h});
assert.ok(smokyBody.soot>0.75,'moving through dense smoke visibly accumulates soot');
assert.ok(smokyBody._smokeTint>0.9,'current smoke produces an immediate body tint');
const dirtyLevel=smokyBody.soot;
smoke.reset();
for(let i=0;i<100;i++) smoke.updateSoot(smokyBody,0.1,{height:smokyBody.h});
assert.ok(smokyBody.soot>0&&smokyBody.soot<dirtyLevel,'soot fades gradually after leaving smoke');
for(let i=0;i<800;i++) smoke.updateSoot(smokyBody,0.1,{height:smokyBody.h});
assert.equal(smokyBody.soot,0,'soot eventually wears off completely');
assert.ok(smokyBody._smokeTint<0.001,'immediate tint clears quickly outside smoke');
let sootMarks=0;
const sootCtx={save(){},restore(){},beginPath(){},ellipse(){sootMarks++;},fill(){},fillStyle:'',globalAlpha:1,globalCompositeOperation:'source-over'};
assert.equal(smoke.drawSootMarks(sootCtx,10,10,12,18,0.8,42),true,'dirty body draws soot marks');
assert.equal(sootMarks,6,'soot uses one glaze and a fixed bounded mark count per creature');
assert.equal(smoke.drawSootMarks(sootCtx,10,10,12,18,0,42),false,'clean body skips soot draw work');
const proceduralCompanion={x:10.5,y:10.5,vx:0,vy:0,genome:{soot:8}};
smoke.restore({v:1,list:[{x:10,y:10,d:1.2,age:0}]},()=>T.AIR);
smoke.updateSoot(proceduralCompanion,0.1,{field:'_sootFilm'});
assert.ok(proceduralCompanion._sootFilm>0,'alternate film field supports procedural companions');
assert.equal(proceduralCompanion.genome.soot,8,'environmental soot does not overwrite genome soot markings');

// A tall underground cavity is not a vent merely because its roof is outside
// the short local probe. Above ground, the extended probe still finds tall
// player-built roofs, while a genuinely clear shaft reaches the surface.
MM.worldGen.surfaceHeight=()=>0;
assert.equal(smoke._debug.ventilationAt(0,30,()=>T.AIR),0,'a tall underground chamber is not falsely ventilated');
MM.worldGen.surfaceHeight=()=>30;
assert.equal(smoke._debug.ventilationAt(0,20,(_x,y)=>y===0?T.STONE:T.AIR),0,'a tall above-ground room detects its distant roof');
MM.worldGen.surfaceHeight=()=>0;
assert.ok(smoke._debug.ventilationAt(0,8,()=>T.AIR)>0,'a genuinely clear shaft is ventilated');
MM.worldGen.surfaceHeight=()=>1;

// A sealed 9x8 room. Poison gas in the ceiling layer proves that black smoke
// is an independent overlay, rather than a mutually-exclusive terrain gas.
for(let y=1;y<=6;y++) for(let x=1;x<=7;x++) setTile(x,y,T.AIR);
setTile(3,2,T.POISON_GAS);
const originalPoison=getTile(3,2);
assert.ok(smoke.emit(4.5,6.5,6,{getTile})>0,'sealed room accepts a smoke release');
for(let i=0;i<180;i++) smoke.update(0.1,getTile);

let snap=smoke.snapshot();
const upperMass=snap.list.filter(c=>c.y<=3).reduce((n,c)=>n+c.d,0);
const lowerMass=snap.list.filter(c=>c.y>=5).reduce((n,c)=>n+c.d,0);
assert.ok(upperMass>lowerMass,'buoyancy moves most smoke toward the ceiling');
assert.ok(snap.list.some(c=>c.y===1),'smoke pools immediately below the solid roof');
assert.equal(snap.list.some(c=>c.y<=0),false,'smoke does not leak through a solid roof');
assert.ok(smoke.densityAt(3,2)>0,'black smoke can overlap the poison-gas cell');
assert.equal(getTile(3,2),originalPoison,'the overlay does not replace an existing gas tile');

// Continued combustion increases opacity instead of replacing old puffs.
const beforeMass=smoke.metrics().mass;
for(let cycle=0;cycle<72;cycle++){
  smoke.emit(4.5,6.5,0.42,{getTile});
  for(let i=0;i<5;i++) smoke.update(0.1,getTile);
}
const accumulated=smoke.metrics();
assert.ok(accumulated.mass>beforeMass,'successive smoke packets accumulate in a closed room');
assert.ok(accumulated.dense>0,'enough smoke produces strongly obscuring dense cells');

// Opening the roof vents mass upward; wind only gains influence through that
// opening and cannot unrealistically blow through the sealed walls.
setTile(4,0,T.AIR);
setTile(4,-1,T.AIR);
setTile(4,-2,T.AIR);
MM.worldGen.surfaceHeight=()=>1;
MM.wind.speed=()=>5;
const sealedMass=smoke.metrics().mass;
for(let i=0;i<240;i++) smoke.update(0.1,getTile);
assert.ok(smoke.metrics().mass<sealedMass,'an opened roof and wind ventilate the room');
assert.ok(smoke.snapshot().list.some(c=>c.y<0),'vented smoke rises out through the opening');
const ventedSmokeSnap=smoke.snapshot();

// Chimneys stay solid construction for actors and wind, but their internal flue
// is open to this density layer. Smoke below a roof can enter the ceramic stack
// and emerge above it instead of treating the chimney like a sealed wall.
smoke.reset();
MM.wind.speed=()=>0;
const chimneyRoomTile=(x,y)=>{
  if(x<0||x>8||y===7) return T.STONE;
  if(y===1&&x!==4) return T.STONE;
  if(x===4&&(y===0||y===1)) return T.CHIMNEY;
  return T.AIR;
};
assert.ok(smoke.emit(4.5,6.5,4.2,{getTile:chimneyRoomTile})>0,'chimney room accepts a smoke release');
for(let i=0;i<60;i++) smoke.update(0.1,chimneyRoomTile);
assert.ok(smoke.snapshot().list.some(c=>c.x===4&&c.y<0),'physical smoke crosses the chimney stack and emerges above the roof');
smoke.reset();
assert.equal(smoke.restore(ventedSmokeSnap,getTile),true,'chimney probe restores the preceding room fixture');

// Snapshot/restore keeps the physical layer across save/load without touching
// terrain, and rejects blocked cells if the room changed meanwhile.
snap=smoke.snapshot();
const savedMass=smoke.metrics().mass;
smoke.reset();
assert.equal(smoke.metrics().active,0,'reset clears all transient smoke cells');
assert.equal(smoke.restore(snap,getTile),true,'smoke snapshot restores');
assert.ok(Math.abs(smoke.metrics().mass-savedMass)<0.08,'restored smoke preserves density');
for(let cycle=0;cycle<4;cycle++){
  const roundTrip=smoke.snapshot();
  const roundTripMass=smoke.metrics().mass;
  smoke.reset();
  assert.equal(smoke.restore(roundTrip,getTile),true,'repeated smoke snapshot restores on cycle '+cycle);
  assert.ok(Math.abs(smoke.metrics().mass-roundTripMass)<0.08,'repeated save/load does not drain smoke mass on cycle '+cycle);
}

// Rendering uses cached translucent sprites and obeys visibility. This checks
// the compositing contract without depending on pixel rasterization in Node.
let drawImages=0, maxAlpha=0;
const drawCtx={
  fillStyle:'',globalCompositeOperation:'source-over',
  _alpha:1,
  get globalAlpha(){ return this._alpha; },
  set globalAlpha(v){ this._alpha=v; maxAlpha=Math.max(maxAlpha,v); },
  save(){},restore(){},fillRect(){},drawImage(){ drawImages++; }
};
smoke.draw(drawCtx,20,-20,-20,60,60,()=>true);
assert.ok(drawImages>0,'visible smoke draws cached texture sprites');
assert.ok(maxAlpha<=1,'smoke rendering keeps valid compositing alpha');

// If construction replaces a smoky cell, its mass should spread across every
// available face instead of disappearing when the first neighbour is nearly full.
smoke.reset();
const changedGeometry=new Map();
const changedKey=(x,y)=>x+','+y;
const changedTile=(x,y)=>changedGeometry.get(changedKey(x,y)) ?? T.AIR;
smoke.emit(0.5,0.5,1.25,{getTile:changedTile});
smoke.emit(0.5,-0.5,1.20,{getTile:changedTile});
const displacedMass=smoke.metrics().mass;
changedGeometry.set(changedKey(0,0),T.STONE);
smoke._debug.physicsStep(changedTile);
assert.ok(Math.abs(smoke.metrics().mass-displacedMass)<0.02,'blocking a smoky cell redistributes all mass with available capacity');
assert.ok(smoke.densityAt(-1,0)>1,'overflow continues into a second open neighbour');

// Closed doors contain smoke, while the dynamic-open resolver lets the same
// physical tile pass smoke for as long as an actor holds it open.
smoke.reset();
MM.wind.speed=()=>0;
const corridor=new Map();
const corridorKey=(x,y)=>x+','+y;
for(let x=0;x<=4;x++) corridor.set(corridorKey(x,0),T.AIR);
corridor.set(corridorKey(2,0),T.WOOD_DOOR);
const corridorTile=(x,y)=>corridor.get(corridorKey(x,y)) ?? T.STONE;
smoke.emit(0.5,0.5,1.2,{getTile:corridorTile});
for(let i=0;i<120;i++) smoke.update(0.1,corridorTile);
assert.equal(smoke.densityAt(3,0),0,'a closed door contains the smoke layer');
const openDoor=(_x,_y,t)=>t===T.WOOD_DOOR;
for(let i=0;i<180;i++) smoke.update(0.1,corridorTile,openDoor);
assert.ok(smoke.densityAt(3,0)>0,'smoke flows through an actor-opened door');
for(let i=0;i<80;i++) smoke.update(0.1,corridorTile);
assert.equal(smoke.densityAt(2,0),0,'smoke is displaced when the door closes again');

// A real world tile notification displaces smoke synchronously. This prevents
// a save made in the same frame as construction from retaining a blocked cell.
smoke.reset();
const immediateWorld=new Map();
const immediateTile=(x,y)=>immediateWorld.get(tileKey(x,y)) ?? T.AIR;
smoke.emit(0.5,0.5,1.1,{getTile:immediateTile});
const immediateMass=smoke.metrics().mass;
immediateWorld.set(tileKey(0,0),T.STONE);
assert.equal(smoke.onTileChanged(0,0,T.AIR,T.STONE,immediateTile),true,'tile notification immediately displaces smoke');
assert.equal(smoke.densityAt(0,0),0,'new solid contains no smoke before the next update');
assert.ok(Math.abs(smoke.metrics().mass-immediateMass)<0.02,'immediate displacement preserves available smoke mass');

// With more visible cells than the low-FPS render budget, successive frames
// must rotate across the cloud instead of starving its newest portion forever.
smoke.reset();
const openTile=()=>T.AIR;
for(let i=0;i<330;i++) smoke.emit(i*2+0.5,20.5,0.9,{getTile:openTile});
const oldFrameMs=globalThis.__mmFrameMs;
globalThis.__mmFrameMs=50;
const renderedPositions=new Set();
const fairCtx={
  fillStyle:'',globalAlpha:1,globalCompositeOperation:'source-over',
  save(){},restore(){},fillRect(){},drawImage(_sprite,x){ renderedPositions.add(Math.round(x)); }
};
for(let frame=0;frame<3;frame++) smoke.draw(fairCtx,20,-2,15,700,20,()=>true);
globalThis.__mmFrameMs=oldFrameMs;
assert.ok(renderedPositions.size>=320,'rotating draw budget reaches the whole visible smoke field ('+renderedPositions.size+'/330)');

// Adaptive servicing may reduce CPU work, but elapsed time must remain physical:
// a saturated cloud should not age much more slowly than a sparse cloud.
function sealedDecay(count){
  smoke.reset();
  const list=Array.from({length:count},(_,i)=>({x:i*3-1800,y:40,d:0.8,age:0}));
  const isolated=(x,y)=>y===40 && (x+1800)%3===0 ? T.AIR : T.STONE;
  smoke.restore({v:1,list},isolated);
  for(let i=0;i<600;i++) smoke.update(0.1,isolated);
  const state=smoke.snapshot();
  return {
    density:smoke.metrics().mass/count,
    age:state.list.reduce((sum,c)=>sum+c.age,0)/state.list.length
  };
}
const sparseDecay=sealedDecay(90);
const saturatedDecay=sealedDecay(smoke.config.MAX_CELLS);
assert.ok(Math.abs(sparseDecay.density-saturatedDecay.density)<0.015,
  'adaptive queue keeps decay independent of cloud size ('+sparseDecay.density.toFixed(3)+' vs '+saturatedDecay.density.toFixed(3)+')');
assert.ok(Math.abs(sparseDecay.age-saturatedDecay.age)<1,
  'adaptive queue keeps smoke age tied to simulation time ('+sparseDecay.age.toFixed(1)+' vs '+saturatedDecay.age.toFixed(1)+')');

// Aged smoke sheds its buoyancy: the same sealed room that pools young smoke
// under the ceiling ends up with an OLD cloud lying along the floor — the
// layer the soot fallout consumes. Ages ride the snapshot, so a saved smog
// resumes settled instead of climbing again after a reload.
assert.ok(smoke.config.BUOYANT_SECONDS>0&&smoke.config.SETTLED_SECONDS>smoke.config.BUOYANT_SECONDS,
  'the settling window is exposed and ordered');
smoke.reset();
const settleRoomTile=(x,y)=>(x>=1&&x<=7&&y>=1&&y<=6)?T.AIR:T.STONE;
const agedList=[];
for(let x=1;x<=7;x++) agedList.push({x,y:1,d:1.0,age:smoke.config.SETTLED_SECONDS+30});
assert.equal(smoke.restore({v:1,list:agedList},settleRoomTile),true,'aged ceiling smog restores');
for(let i=0;i<200;i++) smoke.update(0.1,settleRoomTile);
{
  const settled=smoke.snapshot();
  const ceilingMass=settled.list.filter(c=>c.y<=2).reduce((n,c)=>n+c.d,0);
  const floorMass=settled.list.filter(c=>c.y>=5).reduce((n,c)=>n+c.d,0);
  assert.ok(floorMass>ceilingMass,
    'aged smoke settles into a floor layer instead of hugging the ceiling ('+floorMass.toFixed(2)+' vs '+ceilingMass.toFixed(2)+')');
  assert.ok(settled.list.some(c=>c.y===6&&c.d>0.2),'a dense band rests directly on the floor');
}

// A fed fire keeps its plume young: fresh emission dilutes the mixture age,
// so an active source cannot age into settling while it still burns.
smoke.reset();
smoke.restore({v:1,list:[{x:2,y:9,d:0.5,age:400}]},openTile);
smoke.emit(2.5,9.5,0.75,{getTile:openTile});
{
  const mixed=smoke.snapshot().list.find(c=>c.x===2&&c.y===9);
  assert.ok(mixed&&mixed.age<180,'fresh emission dilutes the age of the cell it feeds ('+(mixed&&mixed.age)+')');
}

// The soot-fallout seams: denseCells samples only cells at/above the requested
// density inside a bounded budget, and consumeAt removes real airborne mass.
smoke.reset();
smoke.restore({v:1,list:[
  {x:0,y:5,d:1.1,age:0},{x:3,y:5,d:0.9,age:0},{x:6,y:5,d:0.3,age:0},{x:9,y:5,d:0.75,age:0}
]},openTile);
{
  const dense=smoke.denseCells(0.7,10);
  assert.equal(dense.length,3,'denseCells returns only cells at/above the requested density');
  assert.ok(dense.every(c=>c.d>=0.7&&Number.isFinite(c.x)&&Number.isFinite(c.y)),'dense samples carry usable coordinates');
  assert.equal(smoke.denseCells(0.7,2).length,2,'the per-call budget bounds the sample');
  const before=smoke.densityAt(0,5);
  const taken=smoke.consumeAt(0,5,0.4);
  assert.ok(Math.abs(taken-0.4)<1e-9,'consumeAt reports the mass it removed');
  assert.ok(Math.abs(smoke.densityAt(0,5)-(before-0.4))<1e-9,'consumption removes real density');
  assert.equal(smoke.consumeAt(500,500,1),0,'consuming where no smoke exists takes nothing');
  smoke.consumeAt(6,5,10);
  assert.equal(smoke.densityAt(6,5),0,'over-consumption clamps to the available mass and clears the cell');
  assert.equal(smoke.consumeAt(6,5,1),0,'a cleared cell yields nothing further');
}

// Randomized sealed-room mutations exercise relocation and sparse-queue cleanup
// against many wall arrangements without allowing cells to remain inside solids.
let randomState=0x51f15e;
const rnd=()=>((randomState=Math.imul(randomState,1664525)+1013904223>>>0)/0x100000000);
for(let scenario=0;scenario<18;scenario++){
  smoke.reset();
  const maze=new Map();
  const mazeKey=(x,y)=>x+','+y;
  for(let y=0;y<16;y++) for(let x=0;x<20;x++){
    const wall=x===0||x===19||y===0||y===15||rnd()<0.13;
    maze.set(mazeKey(x,y),wall?T.STONE:T.AIR);
  }
  const sourceX=2+Math.floor(rnd()*16),sourceY=2+Math.floor(rnd()*11);
  maze.set(mazeKey(sourceX,sourceY),T.AIR);
  maze.set(mazeKey(sourceX,sourceY-1),T.AIR);
  const mazeTile=(x,y)=>maze.get(mazeKey(x,y)) ?? T.STONE;
  smoke.emit(sourceX+0.5,sourceY+0.5,5,{getTile:mazeTile});
  for(let i=0;i<90;i++) smoke.update(0.1,mazeTile);
  const occupied=smoke.snapshot().list;
  for(let i=0;i<Math.min(7,occupied.length);i++){
    const c=occupied[Math.floor(rnd()*occupied.length)];
    if(c) maze.set(mazeKey(c.x,c.y),T.STONE);
  }
  for(let i=0;i<30;i++) smoke.update(0.1,mazeTile);
  const audited=smoke.snapshot();
  assert.ok(audited.list.every(c=>mazeTile(c.x,c.y)===T.AIR),'random geometry '+scenario+' leaves no smoke inside solids');
  assert.ok(audited.list.every(c=>c.x>0&&c.x<19&&c.y>0&&c.y<15),'random geometry '+scenario+' does not leak through sealed boundaries');
  assert.ok(Number.isFinite(smoke.metrics().mass)&&smoke.metrics().active<=smoke.config.MAX_CELLS,'random geometry '+scenario+' keeps finite bounded state');
}

// A pathological number of sources remains bounded. The rotating work queue
// also processes no more than its adaptive per-step budget.
smoke.reset();
for(let i=0;i<1800;i++) smoke.emit(i+0.5,20.5,0.08,{getTile:openTile});
assert.ok(smoke.metrics().active<=smoke.config.MAX_CELLS,'active cell count respects the hard cap');
for(let i=0;i<4000;i++) smoke.emit(-20000-i*3+0.5,20.5,0.06,{getTile:openTile});
assert.ok(smoke.metrics().queue<=smoke.config.MAX_CELLS+129,'source churn cannot grow stale queue storage without bound');
const freshAccepted=smoke.emit(-9999.5,20.5,0.4,{getTile:openTile});
assert.ok(freshAccepted>0&&smoke.densityAt(-10000,20)>0,'a full old plume cannot suppress a new fire source');
assert.equal(smoke.metrics().active,smoke.config.MAX_CELLS,'new-source eviction still respects the hard cap');
const started=performance.now();
for(let i=0;i<20;i++) smoke.update(0.1,openTile);
const elapsed=performance.now()-started;
const stressed=smoke.metrics();
assert.ok(stressed.processed<=stressed.budget,'fixed step respects the adaptive work budget');
assert.ok(elapsed<1500,'bounded smoke updates remain fast under source stress ('+elapsed.toFixed(1)+' ms)');

// Corrupt snapshots cannot create smoke from negative densities or force an
// unbounded scan through arbitrarily large invalid arrays.
smoke.reset();
assert.equal(smoke.restore({list:[{x:1,y:1,d:-5},{x:2,y:2,d:0},{x:3,y:3,d:NaN}]},openTile),true,'malformed finite snapshot is handled');
assert.equal(smoke.metrics().active,0,'invalid densities do not materialize as minimum-density smoke');
assert.equal(smoke.emit(0,20,Infinity,{getTile:openTile}),0,'non-finite emission amounts are rejected');
assert.equal(smoke.emit(0,20,Symbol('bad'),{getTile:openTile}),0,'uncoercible emission amounts are rejected');
assert.equal(smoke.emit(1e300,20,1,{getTile:openTile}),0,'huge emission coordinates cannot wrap into the world');
assert.equal(smoke.densityAt(1e300,20),0,'huge density lookup cannot alias x=0');
smoke.restore({list:[{x:1e300,y:20,d:1}]},openTile);
assert.equal(smoke.metrics().active,0,'huge saved coordinates cannot wrap to an unrelated valid cell');
const oversizedInvalid=Array.from({length:smoke.config.MAX_CELLS*5},()=>({x:0,y:0,d:-1}));
oversizedInvalid.push({x:8,y:8,d:1});
smoke.restore({list:oversizedInvalid},openTile);
assert.equal(smoke.metrics().active,0,'restore bounds inspection of oversized corrupt snapshots');

smoke.reset();
console.log('black-smoke-sim: all assertions passed');
