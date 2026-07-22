// Infrastructure overlay regressions: pipes/cables/ladders coexist with terrain
// while still powering hydraulic/electric networks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { world } = await import('../src/engine/world.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { pumps } = await import('../src/engine/pumps.js');
const { turrets } = await import('../src/engine/turrets.js');

const getTile = (x,y)=>world.getTile(x,y);
const getNetworkTile = (x,y)=>world.getNetworkTile(x,y);
const getElectricNetworkTile = (x,y)=>world.hasInfrastructure(x,y,T.SILVER_WIRE) ? T.SILVER_WIRE : (world.hasInfrastructure(x,y,T.COPPER_WIRE) ? T.COPPER_WIRE : world.getTile(x,y));
const getFluidNetworkTile = (x,y)=>world.hasInfrastructure(x,y,T.WATER_PIPE) ? T.WATER_PIPE : world.getTile(x,y);
const setTile = (x,y,t)=>world.setTile(x,y,t);
const setOverlay = (x,y,t)=>world.setInfrastructure(x,y,t);

function reset(){
  world.clear();
  dynamo.reset();
  teleporters.reset();
  pumps.reset();
  turrets.reset();
  globalThis.MM.world = world;
  globalThis.MM.audio = {play(){}};
  globalThis.MM.particles = {spawnSparks(){}, spawnSplash(){}, spawnEnergyAbsorb(){}};
  globalThis.MM.fire = {heatAround(){}};
}

function infrastructureCanvasRecorder(){
  const strokes=[];
  const strokeWidths=[];
  let path=[];
  return {
    strokes,strokeWidths,lineWidth:1,
    save(){}, restore(){}, fill(){}, fillRect(){}, closePath(){}, arc(){},
    beginPath(){ path=[]; },
    moveTo(x,y){ path.push({kind:'move',x,y}); },
    lineTo(x,y){ path.push({kind:'line',x,y}); },
    stroke(){ strokes.push(path.slice()); strokeWidths.push(this.lineWidth); }
  };
}

reset();
setTile(0,20,T.STONE);
setOverlay(0,20,T.COPPER_WIRE);
assert.equal(getTile(0,20),T.STONE,'copper cable overlay does not replace stone terrain');
assert.equal(getNetworkTile(0,20),T.COPPER_WIRE,'network getter sees copper cable overlay');
let snap=world.snapshotInfrastructure();
assert.deepEqual(snap.list.map(o=>[o.x,o.y,o.t]),[[0,20,T.COPPER_WIRE]],'infrastructure snapshot captures overlay cells');
world.clearInfrastructure(0,20);
assert.equal(getNetworkTile(0,20),T.STONE,'clearing overlay reveals original terrain');
world.restoreInfrastructure(snap);
assert.equal(getTile(0,20),T.STONE,'restore keeps terrain under overlay');
assert.equal(getNetworkTile(0,20),T.COPPER_WIRE,'restore revives cable overlay');

reset();
setTile(3,20,T.STONE);
setOverlay(3,20,T.SILVER_WIRE);
assert.equal(getTile(3,20),T.STONE,'silver cable overlay preserves terrain');
assert.equal(getElectricNetworkTile(3,20),T.SILVER_WIRE,'electric getter prefers a silver cable overlay');
snap=world.snapshotInfrastructure();
world.clearInfrastructure(3,20,T.SILVER_WIRE);
world.restoreInfrastructure(snap);
assert.ok(world.hasInfrastructure(3,20,T.SILVER_WIRE),'silver cable material survives infrastructure save and restore');

reset();
setTile(1,21,T.BRICK);
setOverlay(1,21,T.LADDER);
assert.equal(getTile(1,21),T.BRICK,'ladder overlay can be placed on a solid block without replacing it');
assert.ok(world.hasInfrastructure(1,21,T.LADDER),'ladder is stored in the infrastructure overlay stack');
assert.deepEqual(world.getInfrastructureStack(1,21),[T.LADDER],'ladder overlay stack exposes the climbing fixture');
snap=world.snapshotInfrastructure();
assert.deepEqual(snap.list.map(o=>[o.x,o.y,o.t]),[[1,21,T.LADDER]],'infrastructure snapshot captures ladder overlays');
world.clearInfrastructure(1,21,T.LADDER);
assert.equal(getTile(1,21),T.BRICK,'clearing a ladder overlay preserves the supporting block');
world.restoreInfrastructure(snap);
assert.ok(world.hasInfrastructure(1,21,T.LADDER),'restore revives ladder overlays on solid blocks');

reset();
setOverlay(2,18,T.BEDROCK_LADDER);
assert.ok(world.hasInfrastructure(2,18,T.BEDROCK_LADDER),'bedrock ladder uses the persistent infrastructure layer');
assert.deepEqual(world.getInfrastructureStack(2,18),[T.BEDROCK_LADDER],'bedrock ladder has its own saved overlay identity');
assert.equal(setOverlay(2,18,T.LADDER),false,'one cell cannot stack wooden and bedrock ladders');
snap=world.snapshotInfrastructure();
world.clearInfrastructure(2,18,T.BEDROCK_LADDER);
world.restoreInfrastructure(snap);
assert.ok(world.hasInfrastructure(2,18,T.BEDROCK_LADDER),'restore revives single-anchored bedrock ladders');

reset();
setTile(0,22,T.STONE);
setOverlay(0,22,T.COPPER_WIRE);
setOverlay(0,22,T.WATER_PIPE);
assert.equal(getTile(0,22),T.STONE,'stacked cable and pipe preserve terrain underneath');
assert.ok(world.hasInfrastructure(0,22,T.COPPER_WIRE),'stacked infrastructure retains the copper cable');
assert.ok(world.hasInfrastructure(0,22,T.WATER_PIPE),'stacked infrastructure retains the fluid pipe');
assert.deepEqual(world.getInfrastructureStack(0,22).sort((a,b)=>a-b),[T.COPPER_WIRE,T.WATER_PIPE].sort((a,b)=>a-b),'infrastructure stack exposes both utilities');
assert.equal(getElectricNetworkTile(0,22),T.COPPER_WIRE,'electric network can see its cable in a stacked utility cell');
assert.equal(getFluidNetworkTile(0,22),T.WATER_PIPE,'fluid network can see its pipe in a stacked utility cell');
snap=world.snapshotInfrastructure();
assert.deepEqual(snap.list.map(o=>[o.x,o.y,o.t]),[[0,22,T.COPPER_WIRE],[0,22,T.WATER_PIPE]],'stacked infrastructure snapshot preserves both utilities at one cell');
world.clearInfrastructure(0,22,T.WATER_PIPE);
assert.ok(world.hasInfrastructure(0,22,T.COPPER_WIRE),'removing a stacked pipe leaves the cable intact');
assert.equal(getFluidNetworkTile(0,22),T.STONE,'fluid getter falls back to terrain after only the pipe is removed');
world.restoreInfrastructure(snap);
assert.equal(getElectricNetworkTile(0,22),T.COPPER_WIRE,'restore revives stacked electric utility');
assert.equal(getFluidNetworkTile(0,22),T.WATER_PIPE,'restore revives stacked fluid utility');

reset();
setTile(0,24,T.STONE);
setOverlay(0,24,T.WATER_PIPE);
setOverlay(0,24,T.COPPER_WIRE);
assert.equal(getElectricNetworkTile(0,24),T.COPPER_WIRE,'electric getter is independent from stacked placement order');
assert.equal(getFluidNetworkTile(0,24),T.WATER_PIPE,'fluid getter is independent from stacked placement order');
{
  const connections={left:true,right:true,up:true,down:true};
  const cableCtx=infrastructureCanvasRecorder();
  const pipeCtx=infrastructureCanvasRecorder();
  teleporters.drawCableTile(cableCtx,20,0,0,connections,0);
  pumps.drawPipeTile(pipeCtx,20,0,0,connections,0);
  const cableCenter=cableCtx.strokes[0][0];
  const pipeCenter=pipeCtx.strokes[0][0];
  assert.ok(cableCenter.x<10 && cableCenter.y<10,'copper cable occupies the upper-left utility track');
  assert.ok(pipeCenter.x>10 && pipeCenter.y>10,'fluid pipe occupies the lower-right utility track');
  assert.ok(pipeCenter.x-cableCenter.x>=4 && pipeCenter.y-cableCenter.y>=4,'stacked cable and pipe cores remain visibly separated');
  assert.ok(Math.abs(cableCtx.strokeWidths[0]-2.6)<0.001,'copper cable outer stroke is exactly half of its former 5.2px width at the standard tile scale');
  assert.ok(cableCtx.strokeWidths[0]<pipeCtx.strokeWidths[0]*0.5,'copper cable remains visually much narrower than the fluid pipe');

  const diagonalCable=infrastructureCanvasRecorder();
  const diagonalPipe=infrastructureCanvasRecorder();
  teleporters.drawCableTile(diagonalCable,20,0,0,{downRight:true},0);
  pumps.drawPipeTile(diagonalPipe,20,0,0,{downRight:true},0);
  const cableDiagonalEnd=diagonalCable.strokes[0].find(point=>point.kind==='line');
  const pipeDiagonalEnd=diagonalPipe.strokes[0].find(point=>point.kind==='line');
  assert.ok(cableDiagonalEnd.x>10 && cableDiagonalEnd.y>10,'copper renderer draws a real lower-right diagonal segment');
  assert.ok(pipeDiagonalEnd.x>10 && pipeDiagonalEnd.y>10,'fluid renderer draws a real lower-right diagonal segment');
}

reset();
setTile(6,26,T.AIR);
assert.equal(world.setConstructionBackground(6,26,T.BRICK),true,'background construction tile can be placed in its own layer');
assert.equal(getTile(6,26),T.AIR,'background construction does not replace passable foreground terrain');
assert.equal(world.getConstructionBackground(6,26),T.BRICK,'background construction getter returns the support/decor tile');
assert.equal(world.getPlayerConstructionBackground(6,26),T.BRICK,'player background getter returns only explicitly built support tiles');
assert.equal(world.isConstructionBackgroundTile(T.BRICK),true,'brick is eligible for construction background');
assert.equal(world.isConstructionBackgroundTile(T.WATER_PIPE),false,'infrastructure is not eligible for construction background');
let bgSnap=world.snapshotConstructionBackground();
assert.deepEqual(bgSnap.list.map(o=>[o.x,o.y,o.t]),[[6,26,T.BRICK]],'background construction snapshot captures support tiles');
assert.equal(world.clearConstructionBackground(6,26),true,'background construction tile can be cleared independently');
assert.equal(getTile(6,26),T.AIR,'clearing background construction still preserves foreground terrain');
assert.equal(world.getPlayerConstructionBackground(6,26),T.AIR,'player background getter ignores cleared/tombstoned background cells');
world.restoreConstructionBackground(bgSnap);
assert.equal(world.getConstructionBackground(6,26),T.BRICK,'background construction restore revives support tiles');
assert.equal(world.getPlayerConstructionBackground(6,26),T.BRICK,'player background getter sees restored explicit support tiles');
assert.equal(world.metrics().constructionBackground,1,'world metrics track construction background cells');

reset();
dynamo.plannedCells(-4,30,'horizontal').forEach(c=>setTile(c.x,c.y,c.t));
setTile(-2,30,T.STONE);
setTile(-1,30,T.SAND);
setTile(0,30,T.TELEPORTER);
setOverlay(-2,30,T.COPPER_WIRE);
setOverlay(-1,30,T.COPPER_WIRE);
for(let i=0;i<50;i++) dynamo.recordFlow(-4,30,T.WATER,4,getTile);
teleporters.update(1,{x:20,y:20,w:0.7,h:0.95,vx:0,vy:0},getElectricNetworkTile,setTile,{dynamo});
assert.equal(getTile(-2,30),T.STONE,'powered cable preserves stone underneath');
assert.equal(getTile(-1,30),T.SAND,'powered cable preserves sand underneath');
assert.ok(teleporters.metrics().storedEnergy>0,'teleporter charges through cable overlays on terrain');

reset();
dynamo.plannedCells(-4,34,'horizontal').forEach(c=>setTile(c.x,c.y,c.t));
setTile(-2,34,T.STONE);
setTile(-1,34,T.STONE);
setTile(0,34,T.WATER_PUMP);
setOverlay(-2,34,T.COPPER_WIRE);
setOverlay(-1,34,T.COPPER_WIRE);
setOverlay(-1,34,T.WATER_PIPE);
for(let i=0;i<50;i++) dynamo.recordFlow(-4,34,T.WATER,4,getTile);
for(let i=0;i<60;i++) pumps.update(1/30,{x:20,y:20,w:0.7,h:0.95,vx:0,vy:0},getFluidNetworkTile,setTile,{dynamo,teleporters});
assert.ok(pumps.metrics().storedEnergy>0,'pump charges electrically through a cable sharing a tile with a pipe');

reset();
dynamo.plannedCells(-4,36,'horizontal').forEach(c=>setTile(c.x,c.y,c.t));
setTile(-2,36,T.STONE);
setTile(-1,36,T.STONE);
setTile(0,36,T.TURRET);
setOverlay(-2,36,T.COPPER_WIRE);
setOverlay(-1,36,T.WATER_PIPE);
setOverlay(-1,36,T.COPPER_WIRE);
for(let i=0;i<50;i++) dynamo.recordFlow(-4,36,T.WATER,4,getTile);
for(let i=0;i<60;i++) turrets.update(1/30,{x:20,y:20,w:0.7,h:0.95,vx:0,vy:0},getTile,setTile,{dynamo,teleporters,pumps});
assert.ok(turrets.metrics().storedEnergy>0,'turret charges electrically through a cable sharing a tile with a pipe');

reset();
setTile(-5,38,T.WATER);
setTile(-5,38,T.WATER_PIPE);
assert.equal(getTile(-5,38),T.WATER,'placing a water pipe through setTile preserves water as the base tile');
assert.equal(getNetworkTile(-5,38),T.WATER_PIPE,'setTile routes water pipe into the infrastructure overlay');

reset();
setTile(-2,40,T.WATER);
setOverlay(-2,40,T.WATER_PIPE);
setTile(-1,40,T.STONE);
setOverlay(-1,40,T.WATER_PIPE);
setTile(0,40,T.WATER_PUMP);
pumps.setOrientationAt(0,40,'east',getTile);
setTile(1,40,T.STONE);
setTile(2,40,T.SAND);
setOverlay(1,40,T.WATER_PIPE);
setOverlay(2,40,T.WATER_PIPE);
setTile(3,40,T.WATER_TURRET);
turrets._debug.debugSetWaterAt(3,40,0,getTile);
pumps._debug.debugSetEnergyAt(0,40,pumps._debug.PUMP_CAPACITY,getTile);
for(let i=0;i<90;i++){
  pumps.update(1/30,{x:0.5,y:40.5,w:0.7,h:0.95},getFluidNetworkTile,setTile,{dynamo});
  turrets.update(1/30,{x:0.5,y:40.5,w:0.7,h:0.95},getTile,setTile,{dynamo,teleporters,pumps});
}
assert.equal(getTile(-2,40),T.AIR,'powered pump removes the water tile actually drawn through an overlaid intake pipe');
assert.equal(getNetworkTile(-2,40),T.WATER_PIPE,'network getter still sees the overlaid pipe after its source water is drained');
assert.ok(turrets.metrics().storedWater>0,'pump draws from a pipe overlay placed inside water');

reset();
setTile(-4,50,T.WATER);
setTile(-4,51,T.WATER);
setTile(-4,52,T.WATER);
setOverlay(-3,52,T.WATER_PIPE);
setOverlay(-2,52,T.WATER_PIPE);
setOverlay(-1,52,T.WATER_PIPE);
setOverlay(0,52,T.WATER_PIPE);
setOverlay(0,53,T.WATER_PIPE);
setOverlay(0,54,T.WATER_PIPE);
setOverlay(0,55,T.WATER_PIPE);
setOverlay(0,56,T.WATER_PIPE);
setOverlay(0,57,T.WATER_PIPE);
setTile(0,58,T.WATER);
for(let i=0;i<150;i++){
  pumps.update(1/30,{x:-1,y:54,w:0.7,h:0.95},getFluidNetworkTile,setTile,{dynamo});
}
assert.equal(getTile(-4,50),T.AIR,'unpowered pipe network drains one unit from the higher reservoir surface');
assert.equal(getTile(0,57),T.WATER,'unpowered pipe network delivers water into the lower reservoir through the pipe endpoint');
assert.equal(getNetworkTile(0,57),T.WATER_PIPE,'delivered water can occupy the terrain under a pipe overlay');
assert.ok(pumps.metrics().passiveMoved>0,'pump metrics record passive no-pump pipe transfer');

reset();
setTile(-4,70,T.WATER);
setTile(-3,70,T.AIR);
setTile(-2,70,T.AIR);
setTile(0,75,T.AIR);
setOverlay(-1,70,T.WATER_PIPE);
setOverlay(0,70,T.WATER_PIPE);
setOverlay(0,71,T.WATER_PIPE);
setOverlay(0,72,T.WATER_PIPE);
setOverlay(0,73,T.WATER_PIPE);
setOverlay(0,74,T.WATER_PIPE);
for(let i=0;i<150;i++){
  pumps.update(1/30,{x:-1,y:72,w:0.7,h:0.95},getFluidNetworkTile,setTile,{dynamo});
}
assert.equal(getTile(-4,70),T.AIR,'pipe intake can pull a stranded water remnant across a one-tile dry gap');
assert.equal(getTile(0,75),T.WATER,'stranded remnant exits through the lower open pipe end');

{
  reset();
  const cap=20000;
  const x0=100000;
  const rows=Array.from({length:cap+1},(_,i)=>({x:x0+i,y:30,t:T.COPPER_WIRE}));
  world.restoreInfrastructure({v:2,list:rows});
  assert.equal(world.metrics().infrastructure,cap,'infrastructure restore enforces the same 20k bound as its snapshot schema');
  assert.equal(world.hasInfrastructure(x0+cap,30,T.COPPER_WIRE),false,'infrastructure restore never scans a valid row beyond its hard cap');
}

{
  reset();
  const cap=40000;
  const x0=200000;
  const rows=Array.from({length:cap+1},(_,i)=>({x:x0+i,y:31,t:T.BRICK}));
  world.restoreConstructionBackground({v:1,list:rows});
  assert.equal(world.metrics().constructionBackground,cap,'construction-background restore enforces the same 40k bound as its snapshot schema');
  assert.equal(world.getPlayerConstructionBackground(x0+cap,31),T.AIR,'construction-background restore ignores rows beyond its hard cap');
}

const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const worldSrc = readFileSync(new URL('../src/engine/world.js', import.meta.url), 'utf8');
const pumpSrc = readFileSync(new URL('../src/engine/pumps.js', import.meta.url), 'utf8');
const teleporterSrc = readFileSync(new URL('../src/engine/teleporters.js', import.meta.url), 'utf8');
const waterDrawIdx = mainSrc.indexOf('if(WATER){ WATER.drawOverlay');
const playerDrawIdx = mainSrc.indexOf('drawPlayer({rearView:mirrorFacing});');
const ladderBackDrawIdx = mainSrc.indexOf('drawInfrastructureOverlays(sx,sy,viewX,viewY,{only:[T.LADDER,T.BEDROCK_LADDER]});');
const infraDrawIdx = mainSrc.indexOf('drawInfrastructureOverlays(sx,sy,viewX,viewY,{exclude:[T.LADDER,T.BEDROCK_LADDER]});', waterDrawIdx);
assert.ok(ladderBackDrawIdx > 0 && playerDrawIdx > ladderBackDrawIdx, 'ladder overlays render before the hero so the hero appears on the ladder');
assert.ok(waterDrawIdx > 0 && infraDrawIdx > waterDrawIdx, 'pipe and cable overlays render after the water overlay for smooth submerged composition');
assert.match(mainSrc, /function migrateLegacyInfrastructureTerrain/, 'load path migrates legacy pipe terrain into infrastructure overlays');
assert.match(mainSrc, /function getRenderInfrastructureTile/, 'render path has a legacy infrastructure fallback');
assert.match(mainSrc, /function getElectricNetworkTile/, 'main has an electric-network getter for stacked infrastructure');
assert.match(mainSrc, /function getFluidNetworkTile/, 'main has a fluid-network getter for stacked infrastructure');
assert.match(mainSrc, /function drawLadderOverlay\(g,px,py,h,conn,kind\)/, 'main renders material-aware ladders as detailed overlay fixtures');
assert.match(mainSrc, /function infrastructureOverlayCellsFor\(sx,sy,viewX,viewY\)/, 'infrastructure overlay pass reuses one visible-cell scan per frame');
assert.match(mainSrc, /else if\(isLadderTileId\(t\)\)\{\s+drawLadderOverlay\(ctx,cell\.px,cell\.py,cell\.h,ladderConnections\(cell\.x,cell\.y,hasLadderAt\),t\);/, 'infrastructure overlay pass draws both connection-aware ladder materials');
assert.match(mainSrc, /isLadderTileId\(t\) \? 3/, 'render sorting keeps both ladders above pipes and cables in stacked overlay cells');
assert.match(mainSrc, /function infrastructureTargetBlockedReasonFrom\(originX,originY,tx,ty,id\)[\s\S]*?isPowerCableTileId\(id\) \|\| id===T\.WATER_PIPE[\s\S]*?Math\.abs\(tx-px\)===1 && Math\.abs\(ty-py\)===1/, 'adjacent diagonal pipe or either cable material can reach around a blocked tile corner');
assert.match(mainSrc, /function canPlaceInfrastructureAt\(tx,ty,id,remoteContext\)[\s\S]*?infrastructureTargetBlockedReason\(tx,ty,id\)/, 'local pipe and cable placement keeps the diagonal-aware physical targeting rule');
assert.match(mainSrc, /remotePlacementActorBlockedReason\(remoteBody,tx,ty,id\)/,
  'remote pipe and cable placement routes actor checks through the remote-body policy');
assert.match(mainSrc, /infrastructureTargetBlockedReasonFrom\(body\.x,body\.y,tx,ty,infrastructureId\)/,
  'remote pipe and cable occlusion is evaluated from the guest body instead of the host hero');
assert.match(pumpSrc, /function drawFlow\([\s\S]*?pipeRenderCenter\(TILE,px,py\)/, 'animated fluid flow follows the lower-right pipe track');
assert.match(teleporterSrc, /function drawCableEnergy\([\s\S]*?cableRenderCenter\(TILE,px,py\)/, 'animated electric energy follows the upper-left cable track');
assert.match(mainSrc, /function canPlaceLadderAt\(tx,ty,cur,id\)/, 'main has material-aware ladder placement rules');
assert.match(mainSrc, /oneEndSupport:id===T\.BEDROCK_LADDER/, 'bedrock ladder placement uses the one-end support rule');
assert.match(mainSrc, /maxRun:id===T\.BEDROCK_LADDER \? Math\.max\(128,worldMaxY\(\)-worldMinY\(\)\+2\) : 128/, 'bedrock support scanning spans the full vertical world instead of stopping at the normal ladder budget');
assert.match(mainSrc, /FALLING && FALLING\.isPlayerBuiltAt && FALLING\.isPlayerBuiltAt\(x,y\)/, 'ladder placement can distinguish player-built foreground from natural terrain');
assert.match(worldSrc, /function getPlayerConstructionBackground\(x,y\)\{[\s\S]*constructionBackground\.get\(key\(x,y\)\)/, 'world exposes a player-only construction background getter');
assert.match(worldSrc, /worldAPI\.getPlayerConstructionBackground = getPlayerConstructionBackground/, 'world API publishes the player-only background getter');
assert.match(mainSrc, /function getPlayerConstructionBackgroundTile\(x,y\)/, 'main reads player-built backwalls separately from generated backdrops');
assert.match(mainSrc, /if\(placeAllowed && tryToggleBlockLayerAt\(tx,ty\)\) return true;/, 'secondary right-click checks layer toggling before normal placement');
assert.match(mainSrc, /function tryToggleBlockLayerAt\(tx,ty\)\{[\s\S]*getTile\(tx,ty\)===selected[\s\S]*getPlayerConstructionBackgroundTile\(tx,ty\)===selected/, 'layer toggle switches the selected foreground block or its explicit background copy');
assert.match(mainSrc, /getConstructionBackgroundTile\(tx,ty\)!==T\.AIR\)\{ msg\('Tlo zajete'\); return true; \}/, 'foreground-to-background toggle refuses to overwrite visible generated/player backdrops');
assert.match(mainSrc, /toggleForegroundToBackground/, 'undo tracks foreground-to-background layer toggles');
assert.match(mainSrc, /toggleBackgroundToForeground/, 'undo tracks background-to-foreground layer toggles');
assert.match(mainSrc, /if\(v\.overlay\)\{[\s\S]*const placed=setInfrastructureConfirmed\(tx,ty,id\)[\s\S]*if\(!placed\)[\s\S]*return false;[\s\S]*consumeFor\(id\)/,
  'overlay placement consumes inventory only after the world mutator confirms success');
assert.match(mainSrc, /if\(v\.background\)\{[\s\S]*const placed=setConstructionBackgroundConfirmed\(tx,ty,id\)[\s\S]*if\(!placed\)[\s\S]*return false;[\s\S]*consumeFor\(id\)/,
  'background placement consumes inventory only after the world mutator confirms success');
assert.match(mainSrc, /const removed=clearInfrastructureConfirmed\([^;]+\);\s*if\(!removed\) return false;\s*const drops=awardTileDrops/,
  'failed infrastructure removal cannot award duplicate drops');
assert.match(mainSrc, /function setInfrastructureConfirmed\(x,y,t\)[\s\S]*catch\(e\)\{\}[\s\S]*return hasInfrastructureTile\(x,y,t\)/,
  'throw-after-write infrastructure hooks are resolved by the observed storage postcondition');
assert.match(mainSrc, /function clearConstructionBackgroundConfirmed\(x,y\)[\s\S]*return getConstructionBackgroundTile\(x,y\)===T\.AIR/,
  'background removal confirms the actual layer state even when a mutator throws');
assert.match(mainSrc, /function keepFailedUndo\(e\)[\s\S]*undoStack\.push\(e\)/,
  'a transient layer-mutator failure preserves the undo entry for a later retry');
assert.match(mainSrc, /function undoDropsAvailable\(drops\)[\s\S]*\(inv\[key\]\|\|0\)<n/,
  'undo refuses to recreate mined infrastructure or backgrounds after their recorded drops were spent');
assert.doesNotMatch(mainSrc, /if\(t===T\.WATER_PIPE\)\{[\s\S]{0,360}PUMPS\.drawPipeTile\(cctx/, 'chunk cache no longer bakes water pipes before water');
assert.match(worldSrc, /snapshotConstructionBackground\(\)[\s\S]{0,900}const complete=clean\.length<=CONSTRUCTION_BACKGROUND_SAVE_CAP;[\s\S]{0,260}truncated:/,
  'background snapshots publish explicit completeness instead of silently slicing');

// Crossing the real production cap must be observable by the save layer. This
// is intentionally behavioral: a source-only assertion would miss a future
// refactor that computes completeness after truncation.
reset();
for(let x=0;x<=20000;x++) setOverlay(x,80,T.COPPER_WIRE);
const cappedInfrastructure=world.snapshotInfrastructure();
assert.equal(cappedInfrastructure.list.length,20000,'infrastructure snapshot remains bounded at its production cap');
assert.equal(cappedInfrastructure.complete,false,'cap+1 infrastructure is marked incomplete');
assert.equal(cappedInfrastructure.truncated.records,1,'snapshot reports the exact number of omitted records');

console.log('infrastructure-overlay-sim: all assertions passed');
