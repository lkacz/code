// Volcano lava-hand regression test.
// Verifies the rare airborne volcano hazard catches and throws the hero opposite
// their movement, while exposing a visible/savable hand effect.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.performance = { now:()=>1000 };

const { T } = await import('../src/constants.js');
const { volcano } = await import('../src/engine/volcano.js');

let damage = null;
globalThis.damageHero = (amount,opts)=>{
  damage = {amount,opts};
  return true;
};
globalThis.player = {x:0.5,y:8.2,vx:5.5,vy:-2.1,onGround:false,facing:1,hp:100,maxHp:100};
MM.worldGen = {
  volcanoAt(){ return {center:0,crater:3,radius:22,cell:1}; },
  nearestVolcano(){ return null; },
  surfaceHeight(){ return 10; }
};
MM.particles = { spawnBurst(){} };
MM.audio = { play(){} };

function getTile(_x,y){ return y>=10 ? T.BASALT : T.AIR; }
function setTile(){}

const oldRandom = Math.random;
try{
  Math.random = () => 0;
  volcano.reset();
  volcano.update(0.8,globalThis.player,getTile,setTile);
} finally {
  Math.random = oldRandom;
}

assert.ok(damage, 'lava hand damages the hero when it catches them');
assert.equal(damage.opts.cause, 'lava_hand', 'lava hand damage is identifiable');
assert.ok(globalThis.player.vx < 0, 'lava hand throws the hero opposite rightward movement');
assert.ok(globalThis.player.vy < -7, 'lava hand launches the hero upward while throwing');
assert.ok(volcano.metrics().lavaHands >= 1, 'lava hand effect is tracked for rendering');

const snap = volcano.snapshot();
assert.ok(Array.isArray(snap.lavaHands) && snap.lavaHands.length>=1, 'lava hand effect is saved');
volcano.reset();
assert.equal(volcano.metrics().lavaHands, 0, 'reset clears lava hand effects');
volcano.restore(snap,getTile);
assert.equal(volcano.metrics().lavaHands, snap.lavaHands.length, 'restore revives lava hand effects');

console.log('volcano-lava-hand-sim: all assertions passed');
