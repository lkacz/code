// Deterministic smoke-emission test for fire/lava rendering hooks.
// Verifies active fires and exposed volcanic lava feed the shared black-smoke
// particle emitter without relying on browser rendering.
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
MM.particles = { spawnSmoke(x,y,intensity,opts){ smokeCalls.push({x,y,intensity,opts}); } };
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
    const rolls=[0,0,0, 0, 0.375, finalSpreadRoll];
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
  fire.draw(makeCtx(),20,0,0,8,8,getTile,{visible:()=>true, seen:()=>true});
  assert.ok(smokeCalls.some(c=>c.opts && c.opts.tileX===1 && c.opts.tileY===3), 'burning wood emits smoke');
  assert.ok(smokeCalls.some(c=>c.opts && c.opts.tileX===2 && c.opts.tileY===3 && c.intensity>2), 'burning coal emits a heavier plume');
  assert.ok(smokeCalls.some(c=>c.opts && c.opts.tileX===4 && c.opts.tileY===3 && c.intensity>2), 'volcano lava emits a heavier plume');
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
  fire.noteLava(4,3,{hotT:0});
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
  fire.noteLava(6,-25,{hotT:0});
  fire.update(getSkyLavaTile,setSkyLavaTile,0.1);
  assert.ok(gasAdds.some(g=>g.kind==='hot' && g.y<0), 'sky-layer exposed lava emits hot air above y=0');
  fire.draw(makeCtx(),20,0,-30,12,12,getSkyLavaTile,{visible:()=>true, seen:()=>true});
  assert.ok(skyDrawReads>0, 'sky-layer lava participates in draw scans');
  const fireSrc = await readFile(new URL('../src/engine/fire.js', import.meta.url), 'utf8');
  assert.match(fireSrc, /const LAVA_HOT_AIR_INTERVAL=8\.5/, 'lava hot-air cadence is 10% of coal/wood hot-air cadence');

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
