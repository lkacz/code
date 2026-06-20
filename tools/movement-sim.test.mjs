import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSource, /function renderCameraCoord\(v\)/, 'render camera has a device-pixel snap helper');
assert.match(mainSource, /return Math\.round\(v\*scale\)\/scale;/, 'render camera snaps only to device pixels, not whole tiles');
assert.match(mainSource, /const renderCam=currentRenderCamera\(\);/, 'draw loop computes one stable render camera per frame');
assert.match(mainSource, /const camRenderX = renderCam\.x;\s+const camRenderY = renderCam\.y;/, 'world render uses the pixel-stable render camera');
assert.match(mainSource, /function backgroundCameraX\(cameraLeft\)/, 'background parallax has a smoothed camera-space source');
assert.match(mainSource, /BACKGROUND\.draw\(ctx, W, H, backgroundCameraX\(cameraLeft\), TILE, WORLDGEN\)/, 'background draws from the same render camera position');
assert.ok(!mainSource.includes('BACKGROUND.draw(ctx, W, H, player.x, TILE, WORLDGEN)'), 'background parallax is not driven by raw player.x');
assert.match(mainSource, /const CAMERA_MAX_DT=1\/60;/, 'camera follow delta is capped per rendered frame');
assert.match(mainSource, /function runGameStep\(dt,ts\)/, 'game simulation is extracted into bounded substeps');
assert.match(mainSource, /const MAX_SIM_STEP=1\/60;/, 'simulation step size is bounded to avoid oversized catch-up ticks');
assert.match(mainSource, /updateCameraFollow\(frameDt\)/, 'camera follow is applied once per rendered frame, not once per physics substep');
assert.match(mainSource, /function resetFrameTiming\(reason\)/, 'load/teleport recentering can reset animation timing');
assert.match(mainSource, /if\(frameClock\.resetFrames>0\)/, 'frame loop skips catch-up dt after a synchronous world load or recenter');
assert.match(mainSource, /function centerOnPlayer\(\)\{ revealAround\(\); snapCameraToPlayer\(\); initScarf\(\); resetFrameTiming\('center'\); \}/, 'centering resets frame timing after load/teleport');
assert.match(mainSource, /resetFrameCanvasState\(\);\s+const renderCam=currentRenderCamera\(\);\s+drawBackground\(renderCam\.x\)/, 'each rendered frame resets canvas transform before parallax/background draw');
assert.match(mainSource, /try \{\s+\/\/ render tiles[\s\S]*finally \{\s+ctx\.restore\(\);/, 'world transform is restored even if a draw subsystem fails');
assert.ok(!mainSource.includes('player.y += bob'), 'surface-water bob must stay visual/velocity based and not mutate hero position directly');
assert.match(mainSource, /const TURBO_SPEED_MULT=1\.5;/, 'turbo speed multiplier is 1.5x');
assert.match(mainSource, /const TURBO_JUMP_MULT=1\.5;/, 'turbo jump multiplier is 1.5x');
assert.match(mainSource, /keys\['shiftleft'\]/, 'turbo listens to physical Left Shift');
assert.match(mainSource, /moveMult = [^;]*\* turboSpeedMult;/, 'turbo speed feeds horizontal movement');
assert.match(mainSource, /jumpMult = [^;]*\* turboJumpMult;/, 'turbo jump feeds jump impulse');
assert.match(mainSource, /spendTurboEnergy\(dt\)/, 'turbo consumes hero energy while active');
assert.match(mainSource, /spawnTurboSparks/, 'turbo emits electric spark feedback');

console.log('movement-sim: all assertions passed');
