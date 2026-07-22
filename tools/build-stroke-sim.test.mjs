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
// Owner contract: mouse LMB mines/attacks and RMB places. Touch placement is
// allowed only behind the explicit build-mode toggle, never a timed long press.
assert.match(mainSource,/function beginBuildStroke[\s\S]{0,260}touchExplicit[\s\S]{0,160}pointerType==='mouse' && e\.button===2/,'placement accepts RMB or an explicitly flagged touch gesture');
assert.match(mainSource,/buttonMask:explicitTouch\?1:2/,'each placement stroke records the correct held-pointer mask');
assert.match(mainSource,/stroke\.touchExplicit \? activePointers\.has\(e\.pointerId\)/,'touch paint continues only while its owning canvas pointer remains active');
assert.match(mainSource,/if\(beginBuildStroke\(e,tx,ty\)\) return;\s*\n\s*useToolSecondaryAt\(tx,ty\);/,'the RMB branch tries the stroke first, then the classic secondary action');
{
	const lmb=mainSource.slice(mainSource.indexOf('if(e.button===0){'),mainSource.indexOf('} else if(e.button===2){'));
	assert.match(lmb,/e\.pointerType==='touch' && touchPlaceMode[\s\S]{0,180}beginBuildStroke\(e,tx,ty,\{touchExplicit:true\}\)/,'touch LMB places only while explicit build mode is active');
}
assert.ok(!mainSource.includes('armTouchHold'),'a mining hold can never time out into accidental placement');
assert.match(mainSource,/pointermove[\s\S]{0,520}continueBuildStroke\(e\)/,'held-pointer movement continues the placement stroke');
assert.match(mainSource,/pointerup[\s\S]{0,180}clearBuildStroke\(e\.pointerId\)/,'releasing the owning pointer ends placement immediately');
assert.match(mainSource,/function beginBuildStroke[\s\S]{0,400}placement=canPlaceAt\(tx,ty\)/,'drag placement uses the same validation rules as single-block placement');

console.log('build-stroke-sim: all assertions passed');
