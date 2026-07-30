import assert from 'node:assert/strict';
import { prioritizeVisibleRenderSections } from '../src/engine/render_cache_scheduler.js';

const grid=[];
for(let cx=-3;cx<=3;cx++){
	for(let section=-1;section<=1;section++) grid.push({cx,section});
}
const sameRef=prioritizeVisibleRenderSections(grid,0,0);
assert.equal(sameRef,grid,'scheduler reuses the per-frame visible-section list');
assert.deepEqual(grid[0],{cx:0,section:0},'the camera section receives first rebuild priority');
assert.equal(new Set(grid.map(ref=>`${ref.cx}:${ref.section}`)).size,21,'priority sorting neither duplicates nor drops sections');

const tie=[
	{cx:1,section:0},
	{cx:0,section:1},
	{cx:-1,section:0},
	{cx:0,section:-1}
];
prioritizeVisibleRenderSections(tie,0,0);
assert.deepEqual(tie,[
	{cx:-1,section:0},
	{cx:1,section:0},
	{cx:0,section:-1},
	{cx:0,section:1}
],'equal-distance ordering is deterministic');

// Regression model: a left-edge section is dirtied again every frame (fluids,
// falling terrain, explosions). With budget=1, the old left-to-right scan spent
// every slot there and the one-time edit at the hero remained stale forever.
const dirty=new Set(['-3:0','0:0']);
for(let frame=0;frame<4;frame++){
	dirty.add('-3:0');
	const visible=[];
	for(let cx=-3;cx<=3;cx++) visible.push({cx,section:0});
	prioritizeVisibleRenderSections(visible,0,0);
	const next=visible.find(ref=>dirty.has(`${ref.cx}:${ref.section}`));
	if(next) dirty.delete(`${next.cx}:${next.section}`);
}
assert.equal(dirty.has('0:0'),false,'a hero-centred terrain edit cannot be starved by a continuously dirty edge chunk');

assert.deepEqual(prioritizeVisibleRenderSections(null,0,0),[],'invalid caller input safely yields no work');

console.log('render-cache-order-sim: all assertions passed');
