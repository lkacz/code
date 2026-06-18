// Fire/torch thaw regressions: heat should turn snow and ice into real water
// even when the water module is present and refuses to overwrite solid tiles.
import { strict as assert } from 'assert';

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

const { T } = await import('../src/constants.js');
const { fire } = await import('../src/engine/fire.js');
const { weapons } = await import('../src/engine/weapons.js');
assert.ok(fire && weapons, 'fire and weapons modules export');

let tiles;
const key=(x,y)=>x+','+y;
const getTile=(x,y)=>tiles.get(key(x,y)) ?? T.AIR;
const setTile=(x,y,t)=>{ if(t===T.AIR) tiles.delete(key(x,y)); else tiles.set(key(x,y),t); };
const count=(t)=>[...tiles.values()].filter(v=>v===t).length;
let waterWakes=0;

function reset(){
  tiles=new Map();
  waterWakes=0;
  fire.reset();
  weapons.reset();
  MM.water={
    addSource(){ throw new Error('thaw must replace solid snow/ice directly, not via addSource'); },
    onTileChanged(){ waterWakes++; },
    disturb(){}
  };
  MM.fallingSolids={ onTileRemoved(){} };
}

reset();
setTile(0,0,T.TORCH);
setTile(1,0,T.SNOW);
setTile(0,1,T.ICE);
fire.draw(makeCtx(),20,-1,-1,4,4,getTile,{visible:()=>true, seen:()=>true});
fire.update(getTile,setTile,0.4);
assert.equal(getTile(1,0), T.WATER, 'visible torch thaws adjacent snow into water');
assert.equal(getTile(0,1), T.WATER, 'visible torch thaws adjacent ice into water');
assert.ok(waterWakes>=2, 'water simulation is woken for thawed tiles');

reset();
MM.inventory={
  equippedItem(){ return {weaponType:'flame', fireDps:6, fireRange:7}; },
  TIER_COLORS:{}
};
const realRandom=Math.random;
Math.random=()=>0.1;
try{
  for(let x=3; x<=8; x++) for(let y=-5; y<=5; y++) setTile(x,y,T.SNOW);
  const player={x:0.5,y:0.5,facing:1,atkCd:0};
  const dt=1/60;
  for(let i=0;i<240;i++){
    weapons.fireHeld(player,6,0.5,dt);
    weapons.update(dt,getTile,setTile);
    fire.update(getTile,setTile,dt);
  }
  assert.ok(count(T.WATER)>=1, 'flame stream thaws a snow wall into water');
} finally {
  Math.random=realRandom;
  fire.reset();
  weapons.reset();
}

console.log('fire-thaw-sim: all assertions passed');
