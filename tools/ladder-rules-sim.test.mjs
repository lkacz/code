import assert from 'node:assert/strict';

import { canPlaceLadderFixture, ladderConnections, ladderRun } from '../src/engine/ladders.js';

function ladderSet(cells){
  const s=new Set(cells.map(([x,y])=>x+','+y));
  return (x,y)=>s.has(x+','+y);
}

assert.deepEqual(ladderConnections(0,1,ladderSet([[0,0],[0,2]])), {up:true, down:true}, 'ladder renderer sees vertical joins');
assert.deepEqual(ladderRun(0,2,ladderSet([[0,0],[0,1],[0,3]])).length, 4, 'hypothetical placement joins the contiguous run');

assert.equal(canPlaceLadderFixture({
  tx:0, ty:30, underground:true, naturalSolidBlocked:false
}).ok, true, 'underground open/dug space accepts unsupported ladders');

assert.equal(canPlaceLadderFixture({
  tx:0, ty:30, underground:true, naturalSolidBlocked:true
}).ok, false, 'underground natural solid blocks ladder placement to prevent fake digging');

assert.equal(canPlaceLadderFixture({
  tx:0, ty:10, underground:false, naturalSolidBlocked:false,
  hasBacking:(x,y)=>x===0 && y===10
}).ok, true, 'above-ground player-built backing accepts a ladder');

assert.equal(canPlaceLadderFixture({
  tx:0, ty:10, underground:false, naturalSolidBlocked:false,
  hasAnchor:()=>false
}).ok, false, 'above-ground floating ladders need an attachment');

assert.equal(canPlaceLadderFixture({
  tx:0, ty:10, underground:false, naturalSolidBlocked:false,
  hasAnchor:(x,y)=>x===0 && y===11
}).ok, true, 'one above-ground ladder is allowed from one anchor');

assert.equal(canPlaceLadderFixture({
  tx:0, ty:9, underground:false, naturalSolidBlocked:false,
  hasLadder:ladderSet([[0,10]]),
  hasAnchor:(x,y)=>x===0 && y===11
}).ok, false, 'a longer above-ground open-air run cannot extend from only one end');

assert.equal(canPlaceLadderFixture({
  tx:0, ty:9, underground:false, naturalSolidBlocked:false,
  hasLadder:ladderSet([[0,10]]),
  hasAnchor:(x,y)=>x===0 && (y===8 || y===11)
}).ok, true, 'above-ground open-air ladder runs are allowed when linked top and bottom');

const bottomAnchored = canPlaceLadderFixture({
  tx:0, ty:0, underground:false, naturalSolidBlocked:false,
  oneEndSupport:true,
  hasLadder:ladderSet([[0,1],[0,2]]),
  hasAnchor:(x,y)=>x===0 && y===3
});
assert.equal(bottomAnchored.ok, true, 'one bottom support anchors a bedrock ladder run');
assert.equal(bottomAnchored.oneEndSupport, true, 'one-end support is explicit in the rule result');
assert.equal(bottomAnchored.run.length, 3, 'single-anchored ladders still join the shared visual climbing run');
assert.equal(canPlaceLadderFixture({
  tx:0, ty:0, underground:false, naturalSolidBlocked:false,
  oneEndSupport:true,
  hasAnchor:(x,y)=>x===0 && y===-1
}).ok, true, 'one top support also anchors a bedrock ladder');
assert.equal(canPlaceLadderFixture({
  tx:0, ty:0, underground:false, naturalSolidBlocked:false,
  oneEndSupport:true,
  hasAnchor:()=>false
}).ok, false, 'a bedrock ladder cannot start with neither endpoint supported');
assert.equal(canPlaceLadderFixture({
  tx:0, ty:0, underground:false, naturalSolidBlocked:false,
  oneEndSupport:true,
  hasAnchor:(x,y)=>x===1 && y===0
}).ok, false, 'side contact does not replace the required top or bottom support');

const longCells=Array.from({length:300},(_,i)=>[0,i+1]);
const longBottomAnchored=canPlaceLadderFixture({
  tx:0, ty:0, underground:false, naturalSolidBlocked:false,
  oneEndSupport:true, maxRun:512,
  hasLadder:ladderSet(longCells),
  hasAnchor:(x,y)=>x===0 && y===301
});
assert.equal(longBottomAnchored.ok, true, 'one anchored endpoint supports a run beyond the normal 128-cell scan');
assert.equal(longBottomAnchored.run.length, 301, 'bedrock ladder run can span the full requested world height');
assert.equal(canPlaceLadderFixture({
  tx:0, ty:30, underground:true, naturalSolidBlocked:true, oneEndSupport:true
}).ok, false, 'single-anchored ladders still require an open or excavated target cell');

assert.equal(canPlaceLadderFixture({
  tx:Infinity,ty:10,underground:true,naturalSolidBlocked:false
}).ok,false,'non-finite ladder coordinates are rejected instead of aliasing the world origin');
assert.deepEqual(ladderConnections(NaN,0,()=>true),{up:false,down:false},'malformed renderer coordinates never call the ladder provider');
let unboundedReads=0;
const capped=ladderRun(0,0,()=>{ unboundedReads++; return true; },Infinity);
assert.equal(capped.length,4097,'an infinite requested run is clamped to the hard scan bound in both directions');
assert.equal(unboundedReads,4096,'malformed ladder data cannot cause an unbounded vertical scan');
let throwingReads=0;
assert.doesNotThrow(()=>ladderRun(0,0,()=>{ throwingReads++; throw new Error('bad provider'); },100),
  'a bad ladder provider cannot break placement or rendering');
assert.equal(throwingReads,2,'provider errors terminate each direction immediately');

console.log('ladder-rules-sim: all assertions passed');
