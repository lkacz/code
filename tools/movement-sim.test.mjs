import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { MOVE, T } = await import('../src/constants.js');
const { applyHorizontalMovement, surfaceTraction } = await import('../src/engine/movement.js');

function coast(tile, seconds){
  let vx = MOVE.MAX * 2;
  const dt = 1 / 60;
  for(let t=0; t<seconds; t+=dt) vx = applyHorizontalMovement(vx, 0, dt, 2, MOVE, tile);
  return vx;
}

function accelerate(tile, seconds){
  let vx = 0;
  const dt = 1 / 60;
  for(let t=0; t<seconds; t+=dt) vx = applyHorizontalMovement(vx, 1, dt, 2, MOVE, tile);
  return vx;
}

const normal = surfaceTraction(T.GRASS);
const snow = surfaceTraction(T.SNOW);
const ice = surfaceTraction(T.ICE);

assert.equal(normal.kind, 'normal', 'ordinary ground uses normal traction');
assert.equal(snow.kind, 'snow', 'snow has its own traction profile');
assert.equal(ice.kind, 'ice', 'ice has its own traction profile');
assert.ok(snow.friction < normal.friction, 'snow reduces braking friction');
assert.ok(ice.friction < snow.friction, 'ice reduces braking friction more than snow');
assert.ok(ice.accel < snow.accel && snow.accel < normal.accel, 'snow and ice reduce steering acceleration');

const normalAfter = coast(T.GRASS, 0.5);
const snowAfter = coast(T.SNOW, 0.5);
const iceAfter = coast(T.ICE, 0.5);
assert.ok(normalAfter < 0.1, 'ordinary ground stops quickly');
assert.ok(snowAfter > normalAfter + 3, 'snow keeps the hero sliding after releasing input');
assert.ok(iceAfter > snowAfter + 5, 'ice keeps substantially more glide than snow');

assert.ok(accelerate(T.ICE, 0.25) < accelerate(T.SNOW, 0.25), 'ice starts/turns more slowly than snow');

console.log('movement-sim: all assertions passed');
