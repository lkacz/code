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
  const quadratics=[];
  return {
    calls,
    quadratics,
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
    quadraticCurveTo(...args){ calls.push('quadraticCurveTo'); quadratics.push(args); },
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

const originalPerformanceNow = globalThis.performance && globalThis.performance.now
  ? globalThis.performance.now.bind(globalThis.performance)
  : null;
if(!globalThis.performance) globalThis.performance = {};
function setPerfNow(ms){
  try{ Object.defineProperty(globalThis.performance, 'now', {value:()=>ms, configurable:true}); }
  catch(e){ globalThis.performance.now = ()=>ms; }
}
function grassGeometryForWind(speed, nowMs, extraMetrics){
  setPerfNow(nowMs);
  grass.reset();
  const baseMetrics = {
    speed,
    intensity:Math.min(1, Math.abs(speed)/5.2),
    storm:0,
    thermal:0,
    night:0,
    squall:{active:false, speed:0}
  };
  globalThis.MM.wind = { metrics(){ return Object.assign({}, baseMetrics, extraMetrics||{}); } };
  const ctx = makeCtx();
  grass.drawOverlays(ctx,'back',0,4,4,3,20,WORLD_H,getTile,T,1,1,1,()=>true);
  assert.ok(ctx.quadratics.length > 0, 'grass blades draw for wind responsiveness check');
  return {
    topX:ctx.quadratics.reduce((sum,args)=>sum+args[2],0) / ctx.quadratics.length,
    midX:ctx.quadratics.reduce((sum,args)=>sum+args[0],0) / ctx.quadratics.length
  };
}
const calmGrassEarly = grassGeometryForWind(0, 1234);
const calmGrassLate = grassGeometryForWind(0, 98765);
assert.deepEqual(calmGrassLate, calmGrassEarly, 'calm wind leaves grass geometry still across frames');
const rightWindGrass = grassGeometryForWind(5, 1234);
const leftWindGrass = grassGeometryForWind(-5, 1234);
assert.ok(rightWindGrass.topX > calmGrassEarly.topX + 2, `right wind pushes grass tips right (${calmGrassEarly.topX.toFixed(2)} -> ${rightWindGrass.topX.toFixed(2)})`);
assert.ok(leftWindGrass.topX < calmGrassEarly.topX - 2, `left wind pushes grass tips left (${calmGrassEarly.topX.toFixed(2)} -> ${leftWindGrass.topX.toFixed(2)})`);
assert.ok(rightWindGrass.topX > leftWindGrass.topX + 4, `grass bends with wind direction (${leftWindGrass.topX.toFixed(2)} -> ${rightWindGrass.topX.toFixed(2)})`);
globalThis.MM.wind = null;
if(originalPerformanceNow){
  try{ Object.defineProperty(globalThis.performance, 'now', {value:originalPerformanceNow, configurable:true}); }
  catch(e){ globalThis.performance.now = originalPerformanceNow; }
}

grass.reset();
tiles.set(key(3,-6), T.GRASS);
tiles.set(key(3,-7), T.AIR);
const skyGrassCtx = makeCtx();
grass.drawOverlays(skyGrassCtx,'back',2,-8,3,4,20,WORLD_H,getTile,T,1,1,1,()=>true,-16);
assert.ok(skyGrassCtx.quadratics.length > 0, 'grass overlays can render in negative-y sky sections when given extended bounds');

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
particles.reset();
globalThis.__mmFrameMs = 48;
for(let i=0;i<80;i++) particles.spawnBurst(5*20, 5*20, 'epic');
particles.update(1/60,20);
assert.ok(particles.count() <= particles.metrics().particleCap, 'particle system trims bursts to the stressed-frame cap');
globalThis.__mmFrameMs = 16;

globalThis.MM = { T, WORLD_H, TILE:20, particles:{ spawnSplash(){}, spawnBubble(){} } };
let waterLayerCtx = null;
let waterLayerCanvas = null;
globalThis.document = {
  createElement(){
    waterLayerCanvas = {width:0, height:0, getContext(){ waterLayerCtx = makeCtx(); return waterLayerCtx; }};
    return waterLayerCanvas;
  },
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
assert.ok(waterLayerCtx && waterLayerCtx.calls.includes('quadraticCurveTo'), 'open water endings render as rounded caps instead of square columns');
assert.ok(waterLayerCtx.quadratics.some(args=>args[2]>2 && args[2]<4), 'open water side wall is softened inward at exposed edges');
water.reset();
tiles = new Map([[key(0,5), T.WATER],[key(1,5), T.WATER]]);
waterLayerCtx.calls.length = 0;
waterLayerCtx.quadratics.length = 0;
const joinedWaterCtx = {
  drew:false,
  save(){},
  restore(){},
  drawImage(){ this.drew = true; }
};
water.drawOverlay(joinedWaterCtx,20,getTile,0,4,3,3,(x,y)=>y===5 && (x===0 || x===1));
assert.equal(joinedWaterCtx.drew, true, 'adjacent remembered water columns paint as one body');
assert.ok(waterLayerCtx.quadratics.some(args=>args[2]>36 && args[2]<38), 'right exposed water edge is also rounded inward');
assert.equal(waterLayerCtx.quadratics.some(args=>Math.abs(args[2]-20)<0.01), false, 'joined water columns do not add curved seams inside the water body');
water.reset();
tiles = new Map([[key(2,5), T.WATER]]);
const scaledWaterCtx = {
  drew:false,
  drawArgs:null,
  save(){},
  restore(){},
  getTransform(){ return {a:2,b:0,c:0,d:2}; },
  drawImage(...args){ this.drew = true; this.drawArgs = args; }
};
water.drawOverlay(scaledWaterCtx,20,getTile,1,4,3,3,(x,y)=>x===2 && y===5);
assert.equal(scaledWaterCtx.drew, true, 'scaled water overlay paints');
assert.equal(waterLayerCanvas.width, 320, 'water layer supersamples the visible width under a 2x transform');
assert.equal(waterLayerCanvas.height, 560, 'water layer supersamples the visible height under a 2x transform');
assert.equal(scaledWaterCtx.drawArgs[3], 320, 'water drawImage uses the high-resolution source width');
assert.equal(scaledWaterCtx.drawArgs[7], 160, 'water drawImage still maps back to world-pixel width');

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
globalThis.inv = { arrowWood:1 };
weapons.reset();
const bowPlayer = {x:5,y:5,facing:1};
weapons.fireHeld(bowPlayer, 10, 5, 0.016);
weapons.releaseHeld(bowPlayer, 10, 5);
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
const grassSource = readFileSync(new URL('../src/engine/grass.js', import.meta.url), 'utf8');
assert.match(mainSource, /const MINIMAP_ALPHA=0\.62, MINIMAP_POINTER_ALPHA=0\.18, MINIMAP_BACKDROP_ALPHA=0\.12;/, 'minimap uses a deliberately translucent overlay opacity');
assert.match(mainSource, /g\.clearRect\(0,0,MW,MH\);/, 'minimap offscreen canvas clears to transparent air instead of an opaque panel');
assert.match(mainSource, /const pxColor=priority\?color:\(cave\?'rgba\(2,5,10,0\.72\)':\(color\|\|null\)\);/, 'minimap cave fill stays translucent so actors behind it remain visible');
assert.match(mainSource, /const pointerOver=lastPointer\.has && lastPointer\.x>=mx && lastPointer\.x<=mx\+MW && lastPointer\.y>=my && lastPointer\.y<=my\+MH;[\s\S]*const alpha=pointerOver \? MINIMAP_POINTER_ALPHA : MINIMAP_ALPHA;/, 'minimap fades down when the pointer is over it');
assert.doesNotMatch(mainSource, /g\.fillStyle='rgba\(6,10,18,0\.95\)'; g\.fillRect\(0,0,MW,MH\);/, 'minimap no longer bakes in an opaque dark rectangle');
assert.doesNotMatch(mainSource, /ctx\.globalAlpha=0\.92;/, 'minimap is no longer painted almost opaque over UFOs and bosses');
assert.match(grassSource, /W\.metrics\(\)/, 'grass samples shared wind metrics once per overlay pass');
assert.match(grassSource, /wind\.storm/, 'grass motion reacts to storm wind flavor');
assert.match(grassSource, /wind\.squall/, 'grass motion reacts to squall wind flavor');
assert.doesNotMatch(grassSource, /speedAt\(/, 'grass avoids per-tile wind exposure scans while drawing blades');
assert.match(mainSource, /function drawSandGrains\(g,px,py,h\)/, 'sand has a dedicated grain renderer');
assert.match(mainSource, /const TERRAIN_PATTERN_VARIANTS = 6;/, 'terrain renderer has multiple deterministic texture variants');
assert.match(mainSource, /function terrainTextureVariant\(t,wx,y,h\)/, 'terrain texture variants are chosen from world coordinates');
assert.match(mainSource, /\(patch \^ \(h>>>7\) \^ \(t\*97\)\)>>>0/, 'terrain texture variant hashes stay unsigned');
assert.match(mainSource, /function drawTerrainPattern\(g,t,px,py,wx,y,h\)/, 'chunk renderer has a cached terrain pattern pass');
assert.match(mainSource, /t===T\.STONE \|\| t===T\.GRANITE \|\| t===T\.BASALT \|\| t===T\.BEDROCK/, 'hard-rock texture pass is budgeted for large underground masses');
assert.match(mainSource, /return t===T\.SAND \|\| t===T\.UNSTABLE_SAND \|\| t===T\.QUICKSAND \|\| t===T\.CLAY \|\| t===T\.WET_CLAY \|\| t===T\.BRICK \|\| t===T\.CHIMNEY \|\| t===T\.DIRT \|\| t===T\.STONE \|\| t===T\.GRANITE \|\| t===T\.BASALT \|\| t===T\.BEDROCK \|\| t===T\.COAL \|\| t===T\.UFO_CONCRETE;/, 'sand, sand hazards, clay, brick, chimney, dirt, rock, coal and UFO concrete opt into characteristic pattern textures');
assert.match(mainSource, /drawTerrainPattern\(cctx,t,lx\*TILE,y\*TILE,wx,y,h\);/, 'visible chunk cache draws terrain patterns for real world tiles');
assert.match(mainSource, /g\.drawImage\(terrainPatternCanvas\(t,variant\),px,py\);/, 'terrain patterns are blitted from a small cached atlas');
assert.match(mainSource, /function drawTurretTilePixels\(g,t,px,py,h\)[\s\S]*Stepped barrel pixels keep the turret crisp/, 'turrets have a dedicated detailed pixel renderer');
assert.match(mainSource, /drawTurretTilePixels\(g,t,px,py,h\);/, 'material and debug previews use the detailed turret renderer');
assert.match(mainSource, /drawTurretTilePixels\(cctx,t,px,py,h\);/, 'placed world turrets use the same detailed pixel renderer in the chunk cache');
assert.match(mainSource, /function drawMeteorSirenTilePixels\(g,px,py,h\)/, 'meteor sirens have a dedicated detailed pixel renderer');
assert.match(mainSource, /drawMeteorSirenTilePixels\(g,px,py,h\);/, 'material and debug previews use the detailed meteor siren renderer');
assert.match(mainSource, /drawMeteorSirenTilePixels\(cctx,lx\*TILE,y\*TILE,h\);/, 'placed world meteor sirens use a detailed chunk-cache renderer');
const waterSource = readFileSync(new URL('../src/engine/water.js', import.meta.url), 'utf8');
assert.match(waterSource, /function overlayReuseWindowMs\(\)/, 'water overlay cache has an adaptive reuse window for slow frames');
assert.match(waterSource, /now-lastOverlayRefresh<reuseWindow/, 'water overlay reuse is governed by frame pressure rather than FPS-unlock mode only');
assert.match(waterSource, /function invalidateOverlayCache\(\)[\s\S]*overlayCache\.valid=false[\s\S]*function onTileChanged\(x,y,getTile\)[\s\S]*invalidateOverlayCache\(\)/, 'water overlay cache invalidates immediately on tile edits');
const turretRendererStart = mainSource.indexOf('function drawTurretTilePixels(g,t,px,py,h){');
const turretRendererEnd = mainSource.indexOf('function drawSandGrains', turretRendererStart);
assert.ok(turretRendererStart > 0 && turretRendererEnd > turretRendererStart, 'turret pixel renderer is present');
const turretRenderer = mainSource.slice(turretRendererStart, turretRendererEnd);
assert.ok(!turretRenderer.includes('.arc('), 'turret renderer avoids soft circular shapes that read as low-detail scaling');
assert.match(mainSource, /function beginPrecisionSafeWorldLayer\(opts\)/, 'main renderer has a camera-local layer path for large world coordinates');
assert.match(mainSource, /const screenShake=combineScreenShakes\(meteorShake,combatShake\)/, 'combat impact shake is combined with meteor shake instead of replacing it');
assert.match(mainSource, /drawWorldVisible\(sx,sy,viewX,viewY,\{camX:camRenderX,camY:camRenderY,shake:screenShake\}\)/, 'cached terrain receives the render camera and combined shake for precision-safe drawing');
assert.match(mainSource, /const minSection=Math\.max\(worldMinSection\(\),worldSectionY\(Math\.floor\(sy\)-2\)\); const maxSection=Math\.min\(worldMaxSection\(\),worldSectionY\(Math\.ceil\(sy\+viewY\)\+2\)\)/, 'world renderer derives the visible vertical section range from the camera');
assert.match(mainSource, /fallingAuditChunks=\[\], fallingAuditChunkSeen=new Set\(\)/, 'falling audits collect visible horizontal chunks even outside the legacy base section');
assert.match(mainSource, /FALLING && FALLING\.auditChunks\) FALLING\.auditChunks\(fallingAuditChunks\)/, 'falling audits run for sky and deep section views, not only base-section views');
assert.match(mainSource, /function clearDebugGases\(\)[\s\S]*const ref=normalizeWorldChunkRef\(k\)[\s\S]*originY=ref\.base \? 0 : worldSectionOriginY\(ref\.sy\)/, 'gas debug cleanup scans section-qualified sky and deep chunk arrays');
assert.match(mainSource, /function debugRigCellsClear\(cells\)[\s\S]*worldYInBounds\(cell\.y\)/, 'debug rig placement accepts valid sky and deep world coordinates');
assert.match(mainSource, /function nearestDebugDynamoSlot\(\)[\s\S]*Math\.max\(worldMinY\(\),cy-28\)[\s\S]*Math\.min\(worldMaxY\(\)-1,cy\+28\)/, 'debug power scans search around the hero across extended vertical bounds');
assert.match(mainSource, /function drawSeamSafeChunkCanvas\(canvas, dx, dy, clipX0, clipY0, clipX1, clipY1\)/, 'chunk renderer has a seam-safe blit helper that clips to the view window');
assert.match(mainSource, /ctx\.drawImage\(canvas,sx0,sy0,sx1-sx0,sy1-sy0,dx\+sx0,dy\+sy0,sx1-sx0,sy1-sy0\);/, 'chunk blits submit only the visible sub-rect of each section canvas');
assert.match(mainSource, /if\(sx0===0\) ctx\.drawImage\(canvas,0,sy0,1,sy1-sy0,dx-overlap,dy\+sy0,overlap,sy1-sy0\);/, 'chunk renderer overlaps the left edge strip to hide subpixel gaps');
assert.match(mainSource, /if\(sx1===sw\) ctx\.drawImage\(canvas,sw-1,sy0,1,sy1-sy0,dx\+sw,dy\+sy0,overlap,sy1-sy0\);/, 'chunk renderer overlaps the right edge strip to hide subpixel gaps');
assert.match(mainSource, /drawSeamSafeChunkCanvas\(entry\.canvas, localLayer\?\(cx\*CHUNK_W-camDrawX\)\*TILE:chunkXpx/, 'chunk blits use camera-local x coordinates when precision-safe rendering is active');
assert.match(mainSource, /const chunkRenderDirty = new Map/, 'chunk cache tracks dirty row bands for small tile edits');
assert.match(mainSource, /function markChunkRenderDirty\(cx,y,pad,baseVersion,nextVersion\)/, 'tile edits record a partial chunk-cache dirty band');
assert.match(mainSource, /const partial=!!\(entry\.version>=0 && dirty && !dirty\.full && dirty\.baseVersion===entry\.version && dirty\.version===currentVersion/, 'chunk cache only uses partial redraws when every version since the cache was tracked');
assert.match(mainSource, /cctx\.clearRect\(0,redrawY0\*TILE,cctx\.canvas\.width,\(redrawY1-redrawY0\+1\)\*TILE\)/, 'partial chunk redraw clears only the dirty vertical strip');
assert.match(mainSource, /function beginChunkCacheFrame\(\)[\s\S]*chunkCacheRebuildBudget = ms>28 \? 1 : \(ms>20 \? 2 : 3\)/, 'dirty chunk-cache rebuilds are budgeted aggressively enough to avoid post-impact and post-tree-cut frame drops');
assert.match(mainSource, /entry=\{canvas:c,ctx:cctx,version:-1,sy,chests:\[\],doorways:\[\]\}/, 'section chunk cache tracks door and trapdoor cells for metadata reuse');
assert.match(mainSource, /function visibleDoorwayCellsFor\(sx,sy,viewX,viewY\)[\s\S]*collectDoorwayCellsInRange\(x0,x1,y0,y1,cells\)/, 'door overlay animation scans only the bounded visible section range');
assert.match(mainSource, /window\.__mmPerf=\{[\s\S]*simMs[\s\S]*drawMs[\s\S]*chunks:\{rebuilt:chunkCacheRebuiltThisFrame,partial:chunkCachePartialRebuiltThisFrame,deferred:chunkCacheDeferredThisFrame/, 'frame profiler exposes sim/draw timing and full/partial chunk rebuild pressure');
assert.match(mainSource, /drawFogOverlay\(sx,sy,viewX,viewY,\{camX:camRenderX,camY:camRenderY,shake:screenShake\}\)/, 'fog overlay receives the render camera and combined shake for precision-safe drawing');
assert.match(mainSource, /originX: localLayer \? opts\.camX : 0/, 'fog overlay can draw in camera-local coordinates');
assert.match(mainSource, /const MIN_ZOOM=0\.72, MAX_ZOOM=3;/, 'zoom-out is clamped at the former LOD threshold');
assert.match(mainSource, /function clampZoom\(z\)\{ return Math\.min\(MAX_ZOOM, Math\.max\(MIN_ZOOM, z\)\); \}/, 'all zoom inputs obey the full-detail zoom bounds');
assert.match(mainSource, /function renderDetailFor\(z,viewX,viewY\)[\s\S]*tier:0[\s\S]*fogStep:1[\s\S]*grass:true[\s\S]*label:'full'/, 'renderer reports full detail at every allowed zoom level');
assert.doesNotMatch(mainSource, /lodStep:currentRenderDetail\.fogStep/, 'fog overlay no longer receives zoom-out LOD steps');
assert.doesNotMatch(mainSource, /currentRenderDetail\.grass && VISUAL\.animations/, 'grass overlays are no longer disabled by zoom detail mode');
assert.doesNotMatch(mainSource, /currentRenderDetail\.tier<2 && WIND/, 'wind overlay is no longer disabled by zoom detail mode');
assert.match(mainSource, /function revealDebugTravelArea\(\)/, 'debug travel has a wider survey reveal for inspecting distant generated regions');
assert.match(mainSource, /FOG\.revealRect\(x0,y0,x1,y1,opts\)/, 'debug travel reveal covers the visible viewport instead of only a tiny landing circle');
const sandBranchStart = mainSource.indexOf('} else if(t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND){');
const sandBranchEnd = mainSource.indexOf('} else if(t===T.CLAY || t===T.WET_CLAY){', sandBranchStart);
assert.ok(sandBranchStart > 0 && sandBranchEnd > sandBranchStart, 'sand material branch is present');
const sandBranch = mainSource.slice(sandBranchStart, sandBranchEnd);
assert.ok(!sandBranch.includes('drawBlockBevel'), 'sand does not draw explicit tile-grid bevels');
assert.match(sandBranch, /drawSandGrains\(g,px,py,h\)/, 'sand branch uses dense grain detail');
assert.match(mainSource, /function smoothTerrainNoise\(wx,y,scale\)/, 'continuous terrain uses smooth low-frequency shade noise');
assert.match(mainSource, /function isContinuousTerrainTile\(t\)/, 'renderer can classify terrain that should not show per-tile borders');
assert.match(mainSource, /t===T\.COAL \|\| t===T\.GOLD_ORE/, 'gold ore joins continuous underground terrain instead of drawing a hard grid');
assert.match(mainSource, /if\(isContinuousTerrainTile\(t\)\)/, 'terrain shade avoids per-cell random jitter for natural masses');
assert.match(mainSource, /function drawGoldOreArt\(g,px,py,h\)/, 'gold ore has a dedicated shiny vein renderer');
assert.match(mainSource, /if\(t===T\.GOLD_ORE\)\{[\s\S]*drawGoldOreArt\(cctx,lx\*TILE,y\*TILE,h\)/, 'chunk bake embeds gold as veins inside host rock');
assert.match(grassSource, /leafTile\(t\) \|\| t===T\.DIAMOND \|\| t===T\.GOLD_ORE/, 'animated overlay pass can add gold glints');
assert.match(grassSource, /pass==='back' && t===T\.GOLD_ORE[\s\S]*rgba\(255,202,58/, 'gold ore shimmer uses a warm metallic palette');
assert.match(mainSource, /if\(t===T\.SAND \|\| t===T\.UNSTABLE_SAND \|\| t===T\.QUICKSAND\) return 4;/, 'sand shade variance stays low enough to avoid block grid patches');
assert.match(mainSource, /if\(t===T\.DIRT\) return 5;/, 'dirt has a restrained continuous shade variance');
assert.match(mainSource, /if\(t===T\.GRANITE\) return 6;/, 'granite has its own shade variance');
assert.match(mainSource, /if\(t===T\.BASALT\) return 5;/, 'basalt has its own shade variance');
assert.match(mainSource, /if\(t===T\.BEDROCK\) return 4;/, 'bedrock has a dark low-variance texture');
// Edge lighting v2: caps/rims/shadows live in one neighbor-aware pass instead of
// per-material above/below checks scattered through the bake loop.
const edgeFxStart = mainSource.indexOf('function drawTerrainEdgeFX(');
const edgeFxEnd = mainSource.indexOf('// ---- Tile art v2: richer inner material art', edgeFxStart);
assert.ok(edgeFxStart > 0 && edgeFxEnd > edgeFxStart, 'neighbor-aware edge lighting pass is present');
const edgeFx = mainSource.slice(edgeFxStart, edgeFxEnd);
assert.match(edgeFx, /const oU=tileOpenForEdge\(fam,nU\), oD=tileOpenForEdge\(fam,nD\);/, 'edge pass derives exposure from material-family neighbor openness');
assert.match(edgeFx, /if\(oU\)\{[\s\S]*?t===T\.SNOW[\s\S]*?rgba\(255,255,255/, 'snow top highlight only draws on exposed snow edges');
assert.match(edgeFx, /if\(oD\)\{[\s\S]*?t===T\.SNOW/, 'snow bottom shade only draws on exposed snow edges');
assert.match(mainSource, /drawTerrainEdgeFX\(cctx,t,arr,cx,lx,y,originY,sectionH,wx,lx\*TILE,y\*TILE,h,surf\);/, 'chunk bake runs the edge lighting pass for every terrain tile');
const snowSparkleStart = mainSource.indexOf('// Snow sparkle');
assert.ok(snowSparkleStart > 0, 'snow sparkle styling branch is present');
const snowBranch = mainSource.slice(snowSparkleStart, mainSource.indexOf('// Ice reads glossy', snowSparkleStart));
assert.ok(!snowBranch.includes('fillRect(lx*TILE, y*TILE, 1, TILE)'), 'snow no longer draws a left tile border');
assert.ok(!snowBranch.includes('fillRect(lx*TILE + TILE-1, y*TILE, 1, TILE)'), 'snow no longer draws a right tile border');
assert.doesNotMatch(mainSource, /t===T\.STONE \|\| t===T\.WOOD\)\{ cctx\.fillStyle='rgba\(0,0,0,0\.05\)'; cctx\.fillRect\(lx\*TILE \+ \(\(h>>8\)&3\), y\*TILE, 2, TILE\); \}/, 'stone no longer uses full-height per-tile streaks');

console.log('visibility-render-sim: all assertions passed');
