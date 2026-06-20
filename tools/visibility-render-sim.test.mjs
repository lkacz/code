// Rendering visibility regressions for cosmetic overlay passes.
// Undiscovered map details may still exist in simulation state, but they must not
// draw. Once a tile has been discovered, remembered world contents may draw there;
// the main fog overlay is responsible for dimming non-current memory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { grass } = await import('../src/engine/grass.js');
const { particles } = await import('../src/engine/particles.js');
const { fallingSolids } = await import('../src/engine/falling.js');
const { weapons } = await import('../src/engine/weapons.js');
const { plants } = await import('../src/engine/plants.js');

const T = { AIR:0, GRASS:1, SAND:2, STONE:3, DIAMOND:4, WOOD:5, LEAF:6, SNOW:7, WATER:8 };
const WORLD_H = 32;

let tiles = new Map();
const key = (x,y)=>x+','+y;
const getTile = (x,y)=>tiles.get(key(x,y)) ?? T.AIR;

function makeCtx(){
  const calls=[];
  return {
    calls,
    fillStyle:'',
    strokeStyle:'',
    lineWidth:1,
    globalAlpha:1,
    save(){ calls.push('save'); },
    restore(){ calls.push('restore'); },
    setTransform(){ calls.push('setTransform'); },
    clearRect(){ calls.push('clearRect'); },
    translate(){ calls.push('translate'); },
    rotate(){ calls.push('rotate'); },
    scale(){ calls.push('scale'); },
    beginPath(){ calls.push('beginPath'); },
    closePath(){ calls.push('closePath'); },
    moveTo(){ calls.push('moveTo'); },
    lineTo(){ calls.push('lineTo'); },
    arc(){ calls.push('arc'); },
    ellipse(){ calls.push('ellipse'); },
    quadraticCurveTo(){ calls.push('quadraticCurveTo'); },
    stroke(){ calls.push('stroke'); },
    fill(){ calls.push('fill'); },
    fillRect(){ calls.push('fillRect'); },
    strokeRect(){ calls.push('strokeRect'); },
    drawImage(){ calls.push('drawImage'); },
    createLinearGradient(){ return {addColorStop(){}}; },
    createRadialGradient(){ return {addColorStop(){}}; },
    canvas:{width:800,height:600}
  };
}

tiles.set(key(0,5), T.DIAMOND);
tiles.set(key(1,5), T.LEAF);
tiles.set(key(2,5), T.GRASS);
tiles.set(key(2,4), T.AIR);

const undiscoveredCtx = makeCtx();
grass.drawOverlays(undiscoveredCtx,'back',0,4,4,3,20,WORLD_H,getTile,T,1,1,1,()=>false);
assert.equal(undiscoveredCtx.calls.length, 0, 'undiscovered vegetation and diamond overlays draw nothing');

const rememberedDiamondCtx = makeCtx();
grass.drawOverlays(rememberedDiamondCtx,'back',0,4,1,3,20,WORLD_H,getTile,T,1,1,1,(x,y)=>x===0 && y===5);
assert.ok(rememberedDiamondCtx.calls.includes('fillRect'), 'remembered diamond still gets its shimmer pass');

particles.reset();
particles.spawnBurst(5*20, 5*20, 'common');
const undiscoveredParticleCtx = makeCtx();
particles.draw(undiscoveredParticleCtx,()=>false,20);
assert.equal(undiscoveredParticleCtx.calls.length, 0, 'undiscovered particles draw nothing');
const rememberedParticleCtx = makeCtx();
particles.draw(rememberedParticleCtx,(x,y)=>x===5 && y===5,20);
assert.ok(rememberedParticleCtx.calls.includes('fillRect'), 'remembered particles still draw');
particles.reset();
particles.spawnSmoke(6*20, 6*20, 3, {tileSize:20, tileX:5, tileY:5});
const hiddenSmokeCtx = makeCtx();
particles.draw(hiddenSmokeCtx,()=>false,20);
assert.equal(hiddenSmokeCtx.calls.length, 0, 'undiscovered smoke draws nothing');
const driftSmokeCtx = makeCtx();
particles.update(1.0,20);
particles.draw(driftSmokeCtx,(x,y)=>x===5 && y===5,20);
assert.ok(driftSmokeCtx.calls.includes('arc') && driftSmokeCtx.calls.includes('fill'), 'smoke stays visible while drifting from a remembered source');

globalThis.MM = { T, WORLD_H, TILE:20, particles:{ spawnSplash(){}, spawnBubble(){} } };
globalThis.document = {
  createElement(){ return {width:0, height:0, getContext(){ return makeCtx(); }}; },
  getElementById(){ return null; }
};
const { water } = await import('../src/engine/water.js');
assert.ok(water, 'water module exports');
const { gases } = await import('../src/engine/gases.js');
assert.ok(gases, 'gases module exports');

tiles = new Map([[key(0,5), T.WATER]]);
const waterCtx = {
  drew:false,
  save(){},
  restore(){},
  drawImage(){ this.drew = true; }
};
water.drawOverlay(waterCtx,20,getTile,0,4,2,3,()=>false);
assert.equal(waterCtx.drew, false, 'undiscovered water overlay exits without painting');
water.drawOverlay(waterCtx,20,getTile,0,4,2,3,(x,y)=>x===0 && y===5);
assert.equal(waterCtx.drew, true, 'remembered water overlay paints');

gases.reset();
tiles = new Map([[key(7,5), 28]]);
gases.onTileChanged(7,5,0,28);
const hiddenGasCtx = makeCtx();
gases.draw(hiddenGasCtx,20,6,4,3,3,()=>false);
assert.equal(hiddenGasCtx.calls.filter(c=>c==='drawImage').length,0,'undiscovered gas draws nothing');
const rememberedGasCtx = makeCtx();
gases.draw(rememberedGasCtx,20,6,4,3,3,(x,y)=>x===7 && y===5);
assert.ok(rememberedGasCtx.calls.includes('drawImage'),'remembered gas draws');

fallingSolids.restore({v:2, active:[{x:4,y:4,type:T.STONE,vy:0}], sand:[], queue:[]});
const undiscoveredFallingCtx = makeCtx();
fallingSolids.draw(undiscoveredFallingCtx,20,()=>false);
assert.equal(undiscoveredFallingCtx.calls.length, 0, 'undiscovered falling solids draw nothing');
const rememberedFallingCtx = makeCtx();
fallingSolids.draw(rememberedFallingCtx,20,(x,y)=>x===4 && y===4);
assert.ok(rememberedFallingCtx.calls.includes('fillRect'), 'remembered falling solids still draw');

globalThis.MM.inventory = { equippedItem(){ return {kind:'weapon', weaponType:'bow', tier:'common', attackDamage:2}; } };
weapons.reset();
weapons.fireHeld({x:5,y:5,facing:1}, 10, 5, 0.016);
const undiscoveredWeaponCtx = makeCtx();
weapons.draw(undiscoveredWeaponCtx,20,()=>false);
assert.equal(undiscoveredWeaponCtx.calls.filter(c=>c==='stroke' || c==='fillRect').length, 0, 'undiscovered weapon projectiles draw nothing');
const rememberedWeaponCtx = makeCtx();
weapons.draw(rememberedWeaponCtx,20,(x,y)=>x===5 && y===4);
assert.ok(rememberedWeaponCtx.calls.includes('stroke'), 'remembered weapon projectiles still draw');

plants.reset();
plants._debug().set(9,{type:'sunflower',x:9,y:5,stage:3,hyd:1,health:1,age:0,lifespan:100,growT:10,envT:1,sips:0,withered:false,witherT:0,sway:0});
const undiscoveredPlantCtx = makeCtx();
plants.draw(undiscoveredPlantCtx,20,8,4,3,3,()=>false);
assert.equal(undiscoveredPlantCtx.calls.length, 0, 'undiscovered plants draw nothing');
const rememberedPlantCtx = makeCtx();
plants.draw(rememberedPlantCtx,20,8,4,3,3,(x,y)=>x===9 && y===5);
assert.ok(rememberedPlantCtx.calls.includes('stroke'), 'remembered plants still draw');

const { mobs } = await import('../src/engine/mobs.js');
assert.ok(mobs, 'mobs module exports');
mobs.deserialize({v:3, list:[{id:'BIRD', x:5, y:5, hp:3, state:'idle', facing:1, spawnT:1}], aggro:{mode:'rel', m:{}}});
const undiscoveredMobCtx = makeCtx();
mobs.draw(undiscoveredMobCtx,20,0,0,1,()=>false);
assert.equal(undiscoveredMobCtx.calls.filter(c=>c==='fillRect').length, 0, 'undiscovered animals draw nothing');
const rememberedMobCtx = makeCtx();
mobs.draw(rememberedMobCtx,20,0,0,1,(x,y)=>x===5 && y===5);
assert.ok(rememberedMobCtx.calls.includes('fillRect'), 'remembered animals still draw');

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSource, /function drawSandGrains\(g,px,py,h\)/, 'sand has a dedicated grain renderer');
assert.match(mainSource, /const TERRAIN_PATTERN_VARIANTS = 6;/, 'terrain renderer has multiple deterministic texture variants');
assert.match(mainSource, /function terrainTextureVariant\(t,wx,y,h\)/, 'terrain texture variants are chosen from world coordinates');
assert.match(mainSource, /\(patch \^ \(h>>>7\) \^ \(t\*97\)\)>>>0/, 'terrain texture variant hashes stay unsigned');
assert.match(mainSource, /function drawTerrainPattern\(g,t,px,py,wx,y,h\)/, 'chunk renderer has a cached terrain pattern pass');
assert.match(mainSource, /if\(t===T\.STONE && \(h&1\)\) return;/, 'stone texture pass is budgeted for large underground masses');
assert.match(mainSource, /return t===T\.SAND \|\| t===T\.STONE \|\| t===T\.COAL;/, 'sand, stone and coal opt into characteristic pattern textures');
assert.match(mainSource, /drawTerrainPattern\(cctx,t,lx\*TILE,y\*TILE,wx,y,h\);/, 'visible chunk cache draws terrain patterns for real world tiles');
assert.match(mainSource, /g\.drawImage\(terrainPatternCanvas\(t,variant\),px,py\);/, 'terrain patterns are blitted from a small cached atlas');
const sandBranchStart = mainSource.indexOf('} else if(t===T.SAND){');
const sandBranchEnd = mainSource.indexOf('} else if(t===T.STONE){', sandBranchStart);
assert.ok(sandBranchStart > 0 && sandBranchEnd > sandBranchStart, 'sand material branch is present');
const sandBranch = mainSource.slice(sandBranchStart, sandBranchEnd);
assert.ok(!sandBranch.includes('drawBlockBevel'), 'sand does not draw explicit tile-grid bevels');
assert.match(sandBranch, /drawSandGrains\(g,px,py,h\)/, 'sand branch uses dense grain detail');
assert.match(mainSource, /function smoothTerrainNoise\(wx,y,scale\)/, 'continuous terrain uses smooth low-frequency shade noise');
assert.match(mainSource, /function isContinuousTerrainTile\(t\)/, 'renderer can classify terrain that should not show per-tile borders');
assert.match(mainSource, /if\(isContinuousTerrainTile\(t\)\)/, 'terrain shade avoids per-cell random jitter for natural masses');
assert.match(mainSource, /if\(t===T\.SAND\) return 4;/, 'sand shade variance stays low enough to avoid block grid patches');
const snowBranchStart = mainSource.indexOf('if(t===T.SNOW){');
const snowBranchEnd = mainSource.indexOf('// Ice reads glossy', snowBranchStart);
assert.ok(snowBranchStart > 0 && snowBranchEnd > snowBranchStart, 'snow chunk styling branch is present');
const snowBranch = mainSource.slice(snowBranchStart, snowBranchEnd);
assert.match(snowBranch, /above!==T\.SNOW/, 'snow top highlight only draws on exposed snow edges');
assert.match(snowBranch, /below!==T\.SNOW/, 'snow bottom shade only draws on exposed snow edges');
assert.ok(!snowBranch.includes('fillRect(lx*TILE, y*TILE, 1, TILE)'), 'snow no longer draws a left tile border');
assert.ok(!snowBranch.includes('fillRect(lx*TILE + TILE-1, y*TILE, 1, TILE)'), 'snow no longer draws a right tile border');
assert.doesNotMatch(mainSource, /t===T\.STONE \|\| t===T\.WOOD\)\{ cctx\.fillStyle='rgba\(0,0,0,0\.05\)'; cctx\.fillRect\(lx\*TILE \+ \(\(h>>8\)&3\), y\*TILE, 2, TILE\); \}/, 'stone no longer uses full-height per-tile streaks');

console.log('visibility-render-sim: all assertions passed');
