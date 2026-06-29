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

console.log('ladder-rules-sim: all assertions passed');
