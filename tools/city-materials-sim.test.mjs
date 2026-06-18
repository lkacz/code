// City material regressions: fragile glass panes and dismantle drop metadata.
// Run: node tools/city-materials-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_H, INFO } = await import('../src/constants.js');
const { fallingSolids } = await import('../src/engine/falling.js');

const key = (x,y)=>x+','+y;
const tiles = new Map();
function getTile(x,y){
  if(y<0 || y>=WORLD_H) return T.STONE;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function setTile(x,y,t){
  if(y<0 || y>=WORLD_H) return;
  const k=key(x,y);
  if(t===T.AIR) tiles.delete(k);
  else tiles.set(k,t);
}
function reset(){
  tiles.clear();
  fallingSolids.reset();
  fallingSolids.init(getTile,setTile);
}
function count(t){
  let n=0;
  for(const v of tiles.values()) if(v===t) n++;
  return n;
}
function fillFloor(y,x0=-8,x1=8){
  for(let x=x0; x<=x1; x++) setTile(x,y,T.STONE);
}

assert.equal(INFO[T.GLASS].fragileFall, true, 'glass is marked as fragile falling material');
assert.ok(INFO[T.WIRE].drops.some(d=>d.item==='plastic'), 'wire has plastic dismantle output');
assert.ok(INFO[T.WIRE].drops.some(d=>d.item==='copper'), 'wire has copper dismantle output');
assert.ok(INFO[T.ELECTRONICS].drops.some(d=>d.item==='wire'), 'electronics can yield wire');
assert.ok(INFO[T.ELECTRONICS].drops.some(d=>d.item==='transistor'), 'electronics can yield transistor');

reset();
fillFloor(40);
setTile(-1,20,T.STEEL);
setTile(0,20,T.GLASS);
fallingSolids.maybeStart(0,20);
fallingSolids.settleAll();
assert.equal(getTile(0,20), T.GLASS, 'side-framed glass pane remains supported');

setTile(-1,20,T.AIR);
fallingSolids.onTileRemoved(-1,20);
fallingSolids.settleAll();
assert.equal(getTile(0,20), T.AIR, 'detached glass pane falls and breaks instead of hovering');
assert.equal(count(T.GLASS), 0, 'broken glass does not settle as another block');

reset();
fillFloor(35);
setTile(0,10,T.GLASS);
fallingSolids.maybeStart(0,10);
fallingSolids.settleAll();
assert.equal(count(T.GLASS), 0, 'unsupported glass above a floor breaks on impact');
assert.equal(fallingSolids.snapshot().active.length, 0, 'glass shatter leaves no active rigid body');

reset();
fillFloor(35);
setTile(0,10,T.GLASS);
setTile(0,9,T.GLASS);
fallingSolids.auditChunks([0],{immediate:true});
fallingSolids.settleAll();
assert.equal(count(T.GLASS), 0, 'floating glass stack is discovered by chunk audit and breaks');

reset();
setTile(-3,20,T.STEEL);
for(let x=-2; x<=1; x++) setTile(x,20,T.WIRE);
fallingSolids.maybeStart(0,20);
fallingSolids.settleAll();
assert.equal(count(T.WIRE), 4, 'wire span remains while connected to a real anchor');

setTile(-3,20,T.AIR);
fallingSolids.onTileRemoved(-3,20);
fallingSolids.settleAll();
assert.equal(count(T.WIRE), 0, 'orphaned wire run clears when its anchor is removed');

reset();
fillFloor(35);
setTile(0,10,T.ELECTRONICS);
fallingSolids.maybeStart(0,10);
fallingSolids.settleAll();
assert.equal(getTile(0,34), T.ELECTRONICS, 'unsupported electronics block falls onto the floor');
assert.equal(count(T.ELECTRONICS), 1, 'falling electronics settle as one block');

reset();
fillFloor(35);
setTile(0,10,T.ELECTRONICS);
fallingSolids.auditChunks([0],{immediate:true});
fallingSolids.settleAll();
assert.equal(getTile(0,34), T.ELECTRONICS, 'floating electronics are discovered by chunk audit');

console.log('city-materials-sim: all assertions passed');
