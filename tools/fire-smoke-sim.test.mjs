// Deterministic smoke-emission test for the fire/lava simulation hooks.
// Smoke production must happen during simulation (even off screen), feed the
// physical density layer, and route through chimneys.
// Run: node tools/fire-smoke-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

function makeCtx(){
  return {
    fillStyle:'',
    strokeStyle:'',
    lineWidth:1,
    globalAlpha:1,
    save(){},
    restore(){},
    fillRect(){},
    drawImage(){},
    beginPath(){},
    moveTo(){},
    quadraticCurveTo(){},
    closePath(){},
    fill(){},
    arc(){},
    stroke(){},
    createLinearGradient(){ return {addColorStop(){}}; },
    createRadialGradient(){ return {addColorStop(){}}; },
    canvas:{width:800,height:600}
  };
}

globalThis.document = {
  createElement(){ return {width:0, height:0, getContext(){ return makeCtx(); }}; }
};

const { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { fire } = await import('../src/engine/fire.js');
assert.ok(fire, 'fire module exports');

let smokeCalls=[];
let gasAdds=[];
MM.smoke = { emit(x,y,amount,opts){ smokeCalls.push({x,y,amount,opts}); return amount; } };
MM.gases = { add(kind,x,y,opts){ gasAdds.push({kind,x,y,opts}); return 1; } };
MM.worldGen = {
  volcanoAt(x){ return x===4 ? {center:4, crater:2} : null; },
  surfaceHeight(){ return 3; }
};

const realRandom = Math.random;
Math.random = ()=>0;
try{
  function burnsAfterSingleSpreadStep(targetTile, finalSpreadRoll){
    fire.reset();
    const spreadTiles=new Map();
    const spreadKey=(x,y)=>x+','+y;
    const getSpreadTile=(x,y)=>spreadTiles.get(spreadKey(x,y)) ?? T.AIR;
    const setSpreadTile=(x,y,t)=>spreadTiles.set(spreadKey(x,y),t);
    setSpreadTile(0,0,T.WOOD);
    setSpreadTile(1,0,targetTile);
    const rolls=[0,0,0,0, 0,0.375,finalSpreadRoll];
    let idx=0;
    Math.random=()=>idx<rolls.length ? rolls[idx++] : 0;
    assert.ok(fire.ignite(0,0,getSpreadTile,setSpreadTile), 'source fire ignites for spread check');
    fire.update(getSpreadTile,setSpreadTile,0.46);
    return fire.isBurning(1,0);
  }

  const tiles=new Map();
  const key=(x,y)=>x+','+y;
  const getTile=(x,y)=>tiles.get(key(x,y)) ?? T.AIR;
  const setTile=(x,y,t)=>tiles.set(key(x,y),t);
  setTile(1,3,T.WOOD);
  setTile(2,3,T.COAL);
  setTile(4,3,T.LAVA);
  assert.equal(INFO[T.COAL].flammable, true, 'coal is a burnable fuel block');
  assert.equal(INFO[T.WOOD].burnTime, 60, 'wood burns for one minute');
  assert.equal(INFO[T.COAL].burnTime, 720, 'coal burns for twelve minutes');
  assert.equal(INFO[T.COAL].spreadInMult, 0.04, 'coal catches spreading fire at 0.04x the normal rate');
  assert.ok(fire.ignite(1,3,getTile), 'wood ignites');
  assert.ok(fire.ignite(2,3,getTile), 'coal ignites');
  fire.noteLava(4,3);
  fire.update(getTile,setTile,0.8);
  fire.draw(makeCtx(),20,0,0,8,8,getTile,{visible:()=>true, seen:()=>true});
  const woodSmoke=smokeCalls.find(c=>Math.floor(c.x)===1 && Math.floor(c.y)===2);
  const coalSmoke=smokeCalls.find(c=>Math.floor(c.x)===2 && Math.floor(c.y)===2);
  const lavaSmoke=smokeCalls.find(c=>Math.floor(c.x)===4 && Math.floor(c.y)===2);
  assert.ok(woodSmoke && woodSmoke.opts && woodSmoke.opts.getTile===getTile, 'burning wood emits physical smoke during update');
  assert.ok(coalSmoke && coalSmoke.amount>woodSmoke.amount, 'burning coal emits a heavier physical smoke packet than wood');
  assert.ok(lavaSmoke && lavaSmoke.amount>=0.24, 'volcanic lava emits a heavy physical smoke packet');

  const fireSnap=fire.snapshot();
  assert.equal(fireSnap.list.length,2,'fire snapshot captures active burning tiles');
  fire.reset();
  assert.equal(fire.count(),0,'fire reset clears active burning tiles');
  fire.restore(fireSnap,getTile);
  assert.equal(fire.count(),2,'fire restore revives active burning tiles after reload');
  assert.equal(fire.isBurning(1,3),true,'restored wood tile is still burning');
  assert.equal(fire.isBurning(2,3),true,'restored coal tile is still burning');
  fire.update(getTile,setTile,59);
  assert.equal(getTile(1,3), T.WOOD, 'wood block is still present after almost one minute of burning');
  assert.equal(getTile(2,3), T.COAL, 'coal block is still present after one minute of burning');
  fire.update(getTile,setTile,1.2);
  assert.equal(getTile(1,3), T.AIR, 'wood block burns away after about one minute');
  assert.equal(getTile(2,3), T.COAL, 'coal block keeps burning after wood is gone');
  fire.update(getTile,setTile,658);
  assert.equal(getTile(2,3), T.COAL, 'coal block is still present after almost twelve minutes of burning');
  fire.update(getTile,setTile,3);
  assert.equal(getTile(2,3), T.AIR, 'coal block burns away after about twelve minutes');

  fire.reset();
  smokeCalls=[];
  const chimneyTiles=new Map();
  const chimneyKey=(x,y)=>x+','+y;
  const getChimneyTile=(x,y)=>chimneyTiles.get(chimneyKey(x,y)) ?? T.AIR;
  const setChimneyTile=(x,y,t)=>chimneyTiles.set(chimneyKey(x,y),t);
  setChimneyTile(2,5,T.COAL);
  setChimneyTile(2,4,T.CHIMNEY);
  setChimneyTile(2,3,T.CHIMNEY);
  assert.ok(fire.ignite(2,5,getChimneyTile), 'coal under a chimney ignites');
  fire.update(getChimneyTile,setChimneyTile,0.8);
  fire.draw(makeCtx(),20,0,0,6,8,getChimneyTile,{visible:()=>true, seen:()=>true});
  assert.ok(smokeCalls.some(c=>Math.floor(c.x)===2 && Math.floor(c.y)===2 && c.amount>0), 'coal smoke is emitted at the open chimney outlet');
  assert.equal(smokeCalls.some(c=>Math.floor(c.x)===2 && Math.floor(c.y)===5), false, 'chimney-routed coal smoke does not originate at the fuel cell');

  fire.reset();
  smokeCalls=[];
  const torchTiles=new Map();
  const torchKey=(x,y)=>x+','+y;
  const getTorchTile=(x,y)=>torchTiles.get(torchKey(x,y)) ?? T.AIR;
  const setTorchTile=(x,y,t)=>torchTiles.set(torchKey(x,y),t);
  setTorchTile(3,5,T.TORCH);
  setTorchTile(3,4,T.CHIMNEY);
  setTorchTile(3,3,T.CHIMNEY);
  fire.noteTorch(3,5);
  for(let i=0;i<80;i++) fire.update(getTorchTile,setTorchTile,0.1);
  const torchSmoke=smokeCalls.filter(c=>Math.floor(c.x)===3 && Math.floor(c.y)===2);
  assert.ok(torchSmoke.length>0,'a torch produces physical black smoke at the open chimney outlet');
  assert.ok(torchSmoke.every(c=>c.amount>0&&c.amount<0.05),'torch smoke packets stay subtle and much smaller than burning fuel packets');
  assert.equal(smokeCalls.some(c=>Math.floor(c.x)===3 && Math.floor(c.y)===5),false,'torch smoke does not leak from the solid base of a working chimney');

  fire.reset();
  const verticalTiles=new Map();
  const verticalKey=(x,y)=>x+','+y;
  const getVerticalTile=(x,y)=>verticalTiles.get(verticalKey(x,y)) ?? T.AIR;
  const setVerticalTile=(x,y,t)=>{ if(t===T.AIR) verticalTiles.delete(verticalKey(x,y)); else verticalTiles.set(verticalKey(x,y),t); };
  assert.ok(WORLD_MIN_Y<0 && WORLD_MAX_Y>WORLD_H, 'fire tests cover extended vertical sections');
  setVerticalTile(0,-24,T.WOOD);
  setVerticalTile(1,WORLD_H+8,T.WOOD);
  assert.ok(fire.ignite(0,-24,getVerticalTile,setVerticalTile), 'sky-layer wood can ignite');
  assert.ok(fire.ignite(1,WORLD_H+8,getVerticalTile,setVerticalTile), 'deep-layer wood can ignite');
  const verticalSnap=fire.snapshot();
  assert.ok(verticalSnap.list.some(b=>b.y<0), 'fire snapshot preserves sky-layer flames');
  assert.ok(verticalSnap.list.some(b=>b.y>WORLD_H), 'fire snapshot preserves deep-layer flames');
  fire.reset();
  fire.restore(verticalSnap,getVerticalTile);
  assert.equal(fire.isBurning(0,-24), true, 'fire restore revives sky-layer flames');
  assert.equal(fire.isBurning(1,WORLD_H+8), true, 'fire restore revives deep-layer flames');
  fire.update(getVerticalTile,setVerticalTile,61);
  assert.equal(getVerticalTile(0,-24), T.AIR, 'sky-layer wood burns away normally');
  assert.equal(getVerticalTile(1,WORLD_H+8), T.AIR, 'deep-layer wood burns away normally');

  assert.equal(burnsAfterSingleSpreadStep(T.WOOD,0.07), true, 'normal solid fuel catches this lateral spread roll');
  assert.equal(burnsAfterSingleSpreadStep(T.COAL,0.02), true, 'coal can catch a low lateral spread roll after the 0.04 multiplier');
  assert.equal(burnsAfterSingleSpreadStep(T.COAL,0.03), false, 'coal rejects a near-threshold lateral spread roll after the 0.04 multiplier');

  fire.reset();
  const seamTiles=new Map();
  const seamKey=(x,y)=>x+','+y;
  const getSeamTile=(x,y)=>seamTiles.get(seamKey(x,y)) ?? T.AIR;
  const setSeamTile=(x,y,t)=>{ if(t===T.AIR) seamTiles.delete(seamKey(x,y)); else seamTiles.set(seamKey(x,y),t); };
  setSeamTile(0,0,T.COAL);
  setSeamTile(1,0,T.COAL);
  setSeamTile(2,0,T.STONE);
  setSeamTile(1,-1,T.COAL);
  setSeamTile(1,1,T.STONE);
  assert.equal(fire._debug.coalHasAirAccess(getSeamTile,1,0),false,'coal surrounded on all four faces has no combustion air');
  assert.equal(fire.ignite(1,0,getSeamTile,setSeamTile),false,'a sealed inner coal block cannot be ignited directly or by propagation');
  let seamRoll=0;
  Math.random=()=>{
    if(seamRoll++<4) return 0; // source ignition state
    return [0,0.375,0][(seamRoll-5)%3]; // spread attempt, right neighbour, successful heat roll
  };
  assert.ok(fire.ignite(0,0,getSeamTile,setSeamTile),'the exposed outer coal block can still burn');
  for(let i=0;i<40;i++) fire.update(getSeamTile,setSeamTile,0.46);
  assert.equal(fire.isBurning(1,0),false,'burning outer coal does not propagate into a sealed coal seam');
  setSeamTile(1,-1,T.AIR);
  assert.equal(fire._debug.coalHasAirAccess(getSeamTile,1,0),true,'opening one orthogonal face ventilates the next coal block');
  assert.equal(fire.ignite(1,0,getSeamTile,setSeamTile),true,'ventilated coal can ignite normally');
  Math.random = ()=>0;

  fire.reset();
  gasAdds=[];
  const lavaTiles=new Map();
  const lavaKey=(x,y)=>x+','+y;
  const getLavaTile=(x,y)=>lavaTiles.get(lavaKey(x,y)) ?? T.STONE;
  const setLavaTile=(x,y,t)=>lavaTiles.set(lavaKey(x,y),t);
  setLavaTile(4,2,T.AIR);
  setLavaTile(4,3,T.LAVA);
  setLavaTile(4,4,T.STONE);
  fire.noteLava(4,3,{hotT:0,smokeT:99});
  fire.update(getLavaTile,setLavaTile,0.1);
  assert.ok(gasAdds.some(g=>g.kind==='hot' && g.opts && g.opts.cells===1), 'exposed lava emits a small hot-air packet');

  fire.reset();
  smokeCalls=[];
  gasAdds=[];
  const skyLavaTiles=new Map();
  const skyLavaKey=(x,y)=>x+','+y;
  let skyDrawReads=0;
  const getSkyLavaTile=(x,y)=>{
    if(y<0) skyDrawReads++;
    return skyLavaTiles.get(skyLavaKey(x,y)) ?? T.STONE;
  };
  const setSkyLavaTile=(x,y,t)=>skyLavaTiles.set(skyLavaKey(x,y),t);
  setSkyLavaTile(6,-26,T.AIR);
  setSkyLavaTile(6,-25,T.LAVA);
  setSkyLavaTile(6,-24,T.STONE);
  fire.noteLava(6,-25,{hotT:0,smokeT:99});
  fire.update(getSkyLavaTile,setSkyLavaTile,0.1);
  assert.ok(gasAdds.some(g=>g.kind==='hot' && g.y<0), 'sky-layer exposed lava emits hot air above y=0');
  fire.draw(makeCtx(),20,0,-30,12,12,getSkyLavaTile,{visible:()=>true, seen:()=>true});
  assert.ok(skyDrawReads>0, 'sky-layer lava participates in draw scans');
  const fireSrc = await readFile(new URL('../src/engine/fire.js', import.meta.url), 'utf8');
  const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
  const mobsSrc = await readFile(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
  assert.match(fireSrc, /const LAVA_HOT_AIR_INTERVAL=8\.5/, 'lava hot-air cadence is 10% of coal/wood hot-air cadence');
  assert.match(fireSrc, /const FRAMES=16/, 'block fire uses a fluid sixteen-phase animation');
  assert.match(fireSrc, /const FLAME_VARIANTS=4/, 'nearby burning blocks select independent flame silhouettes');
  assert.match(fireSrc, /const FLAME_SUPERSAMPLE=2/, 'flames are baked above display resolution for smooth curves');
  assert.match(fireSrc, /imageSmoothingQuality='high'/, 'fire stamps opt into high-quality downsampling');
  assert.match(fireSrc, /from '\.\/flame_fx\.js'/, 'world fire imports the shared flamethrower sprite vocabulary');
  assert.match(fireSrc, /const BLOCK_FLAME_PUFFS=6/, 'world fire precomposes a bounded plume from shared puffs');
  assert.match(fireSrc, /flamePuffFrame\(shared,freshness\)/, 'world fire selects the same hot, mid and tail frames as the fire hose');
  assert.match(weaponsSrc, /flame:getFlamePuffSprites\(\)/, 'the hero fire hose reads its sprites from the shared flame renderer');
  assert.match(mobsSrc, /flamePuffFrame\(burnSprites,freshness\)/, 'burning mobs use the shared flame phases too');
  assert.doesNotMatch(fireSrc, /function drawFlameShape/, 'the separate legacy flame silhouette renderer is removed');
  assert.doesNotMatch(fireSrc, /px\+TILE\*0\.3\+flick\*6/, 'legacy square per-tile spark animation is removed');

  fire.reset();
  smokeCalls=[];
  Math.random = ()=>0.99;
  const oldFrameMs=globalThis.__mmFrameMs;
  globalThis.__mmFrameMs=50;
  let tileReads=0;
  const getDenseLava=(x,y)=>{
    tileReads++;
    return (x>=0 && x<40 && y>=0 && y<40) ? T.LAVA : T.STONE;
  };
  fire.draw(makeCtx(),20,0,0,42,42,getDenseLava,{visible:()=>true, seen:()=>true});
  globalThis.__mmFrameMs=oldFrameMs;
  assert.ok(tileReads<3000, 'low-FPS lava overlay limits neighbour probes on dense lava faces ('+tileReads+' tile reads)');
} finally {
  Math.random = realRandom;
  globalThis.__mmFrameMs=undefined;
  fire.reset();
}

console.log('fire-smoke-sim: all assertions passed');
