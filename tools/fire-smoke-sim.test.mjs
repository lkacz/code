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

const { T, INFO } = await import('../src/constants.js');
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
  const tiles=new Map();
  const key=(x,y)=>x+','+y;
  const getTile=(x,y)=>tiles.get(key(x,y)) ?? T.AIR;
  const setTile=(x,y,t)=>tiles.set(key(x,y),t);
  setTile(1,3,T.WOOD);
  setTile(2,3,T.COAL);
  setTile(4,3,T.LAVA);
  assert.equal(INFO[T.COAL].flammable, true, 'coal is a burnable fuel block');
  assert.equal(INFO[T.WOOD].burnTime, 60, 'wood burns for one minute');
  assert.equal(INFO[T.COAL].burnTime, 180, 'coal burns for three minutes');
  assert.ok(fire.ignite(1,3,getTile), 'wood ignites');
  assert.ok(fire.ignite(2,3,getTile), 'coal ignites');
  fire.noteLava(4,3);
  fire.draw(makeCtx(),20,0,0,8,8,getTile,{visible:()=>true, seen:()=>true});
  assert.ok(smokeCalls.some(c=>c.opts && c.opts.tileX===1 && c.opts.tileY===3), 'burning wood emits smoke');
  assert.ok(smokeCalls.some(c=>c.opts && c.opts.tileX===2 && c.opts.tileY===3 && c.intensity>2), 'burning coal emits a heavier plume');
  assert.ok(smokeCalls.some(c=>c.opts && c.opts.tileX===4 && c.opts.tileY===3 && c.intensity>2), 'volcano lava emits a heavier plume');
  fire.update(getTile,setTile,59);
  assert.equal(getTile(1,3), T.WOOD, 'wood block is still present after almost one minute of burning');
  assert.equal(getTile(2,3), T.COAL, 'coal block is still present after one minute of burning');
  fire.update(getTile,setTile,1.2);
  assert.equal(getTile(1,3), T.AIR, 'wood block burns away after about one minute');
  assert.equal(getTile(2,3), T.COAL, 'coal block keeps burning after wood is gone');
  fire.update(getTile,setTile,118);
  assert.equal(getTile(2,3), T.COAL, 'coal block is still present after almost three minutes of burning');
  fire.update(getTile,setTile,2);
  assert.equal(getTile(2,3), T.AIR, 'coal block burns away after about three minutes');

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
