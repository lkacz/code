import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUILD_STROKE_CELL_LIMIT, rasterizeTileLine } from '../src/engine/build_stroke.js';

assert.deepEqual(
	rasterizeTileLine(2,5,6,5),
	[{tx:2,ty:5},{tx:3,ty:5},{tx:4,ty:5},{tx:5,ty:5},{tx:6,ty:5}],
	'a fast horizontal pointer move fills every tile without gaps'
);

assert.deepEqual(
	rasterizeTileLine(2,2,5,5),
	[{tx:2,ty:2},{tx:3,ty:3},{tx:4,ty:4},{tx:5,ty:5}],
	'diagonal dragging produces the simplest one-tile-wide line'
);

const steep=rasterizeTileLine(8,9,10,15);
assert.deepEqual(steep[0],{tx:8,ty:9},'a stroke includes its starting tile');
assert.deepEqual(steep.at(-1),{tx:10,ty:15},'a stroke includes its destination tile');
assert.ok(steep.every((cell,i)=>i===0 || (
	Math.abs(cell.tx-steep[i-1].tx)<=1 && Math.abs(cell.ty-steep[i-1].ty)<=1
)),'every consecutive stroke cell touches the previous one');
assert.equal(new Set(steep.map(cell=>cell.tx+','+cell.ty)).size,steep.length,'a rasterized stroke never duplicates a tile');

const bounded=rasterizeTileLine(0,0,1e8,0,BUILD_STROKE_CELL_LIMIT);
assert.equal(bounded.length,BUILD_STROKE_CELL_LIMIT,'hostile pointer coordinates cannot create unbounded placement work in one event');
assert.deepEqual(rasterizeTileLine(NaN,0,4,0),[],'non-finite pointer coordinates are rejected');

const mainSource=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
// Owner contract: LMB mines/attacks, RMB places — the stroke lives on the
// RIGHT button only (an earlier build wired it to LMB and stole mining clicks).
assert.match(mainSource,/function beginBuildStroke[\s\S]{0,200}e\.button!==2/,'the placement stroke arms ONLY on the right mouse button');
assert.match(mainSource,/&2\)===0\) \|\| HOTBAR_ORDER\[hotbarIndex\]!==stroke\.selection/,'the stroke continues only while the RIGHT button stays held');
assert.match(mainSource,/if\(beginBuildStroke\(e,tx,ty\)\) return;\s*\n\s*useToolSecondaryAt\(tx,ty\);/,'the RMB branch tries the stroke first, then the classic secondary action');
{
	const lmb=mainSource.slice(mainSource.indexOf('if(e.button===0){'),mainSource.indexOf('} else if(e.button===2){'));
	assert.ok(lmb.length>200 && !lmb.includes('beginBuildStroke'),'the LEFT-button branch never places blocks');
}
assert.match(mainSource,/pointermove[\s\S]{0,220}continueBuildStroke\(e\)/,'held-pointer movement continues the placement stroke');
assert.match(mainSource,/pointerup[\s\S]{0,180}clearBuildStroke\(e\.pointerId\)/,'releasing the owning pointer ends placement immediately');
assert.match(mainSource,/function beginBuildStroke[\s\S]{0,400}placement=canPlaceAt\(tx,ty\)/,'drag placement uses the same validation rules as single-block placement');

console.log('build-stroke-sim: all assertions passed');
