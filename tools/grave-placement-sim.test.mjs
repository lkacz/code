import assert from 'node:assert/strict';
import { findGroundedGraveCell } from '../src/engine/grave_placement.js';

const AIR=0;
const STONE=1;
const WATER=2;
const map=new Map();
const key=(x,y)=>`${x},${y}`;
const getTile=(x,y)=>map.get(key(x,y)) ?? AIR;
const isOpen=t=>t===AIR || t===WATER;
const isSupport=t=>t===STONE;
const find=(x,y,extra={})=>findGroundedGraveCell(x,y,{
  getTile,
  isOpen,
  isSupport,
  minY:-20,
  maxY:240,
  ...extra
});

for(let x=-12;x<=12;x++) map.set(key(x,20),STONE);
assert.deepEqual(find(0,4),{x:0,y:19},'an aerial death drops its grave to the floor');

map.clear();
for(let x=-12;x<=12;x++) map.set(key(x,30),STONE);
for(let y=8;y<30;y++) map.set(key(0,y),STONE);
assert.deepEqual(find(0,12),{x:0,y:7},'a crush death moves to the nearest supported opening above its rubble');

map.clear();
map.set(key(0,210),STONE);
assert.deepEqual(find(0,-10,{fall:40}),{x:0,y:209},'the narrow full-height fallback handles extreme sky falls');

map.clear();
map.set(key(0,10),WATER);
assert.equal(find(0,5),null,'liquid is never mistaken for load-bearing ground');

console.log('grave-placement-sim: all assertions passed');
