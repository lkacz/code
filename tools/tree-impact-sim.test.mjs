import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window=globalThis;
globalThis.MM={};

const { T }=await import('../src/constants.js');
const {
  TREE_IMPACT,
  canRamLightWood,
  rubberBounceKey,
  rubberSideBounceVelocity,
  rubberTopBounceVelocity,
}=await import('../src/engine/tree_impacts.js');

assert.equal(rubberSideBounceVelocity(1),0,'a slow brush against rubber bark is an ordinary solid collision');
assert.ok(rubberSideBounceVelocity(10)<0,'a rightward run rebounds left from rubber wood');
assert.ok(rubberSideBounceVelocity(-10)>0,'a leftward run rebounds right from rubber wood');
assert.ok(Math.abs(Math.abs(rubberSideBounceVelocity(10))-7.2)<1e-9,'side rebound preserves the tuned fraction of approach speed');
assert.equal(Math.abs(rubberSideBounceVelocity(1.25)),TREE_IMPACT.RUBBER_SIDE_MIN_RETURN,'a valid slow rebound gets a useful minimum return instead of jittering at the wall');
assert.ok(Math.abs(rubberSideBounceVelocity(100))<=TREE_IMPACT.RUBBER_SIDE_MAX_RETURN,'extreme speed cannot mint an unbounded rubber launch');

assert.equal(rubberTopBounceVelocity(0.2,-18),0,'resting contact does not turn a rubber trunk into a permanent oscillator');
const halfHeightBounce=rubberTopBounceVelocity(3,-18);
assert.ok(Math.abs(halfHeightBounce-(-18*Math.SQRT1_2))<1e-9,'a normal landing receives a free half-height jump');
assert.equal(rubberTopBounceVelocity(100,-18),-18*TREE_IMPACT.RUBBER_TOP_MAX_JUMP_MULT,'a huge fall keeps a strong but capped elastic return');

assert.equal(canRamLightWood(T.LIGHT_WOOD,true,8),true,'an energy sprint can ram light wood');
assert.equal(canRamLightWood(T.LIGHT_WOOD,false,8),false,'speed without active Shift energy cannot fell light wood');
assert.equal(canRamLightWood(T.LIGHT_WOOD,true,3.9),false,'a near-stationary powered nudge is not a ram');
assert.equal(canRamLightWood(T.WOOD,true,20),false,'energy ramming never fells ordinary wood');
assert.equal(rubberBounceKey(4.9,8.2),'4,8','bounce locks use stable tile coordinates');

const mainSource=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
assert.match(mainSource,/collide\('x',px,\{turboActive\}\)/,'the collision resolver receives the paid turbo state, not raw Shift input');
assert.match(mainSource,/tryRamLightWoodCollision\(hitTile\.x,hitTile\.y,dir,impactVx,opts\.turboActive===true\)/,'light wood ramming uses pre-impact speed and active energy');
assert.match(mainSource,/TREES\.startTreeFall\(getTile,setTile,dir,x,y\)/,'a successful ram enters the existing whole-tree fall system');
assert.match(mainSource,/rubberImpactIsLocked\('x',hitTile\.x,hitTile\.y\)/,'side rubber rebounds share the anti-loop lock');
assert.match(mainSource,/rubberImpactIsLocked\('y',landingTile\.x,landingTile\.y\)/,'top rubber rebounds share the anti-loop lock');
assert.match(mainSource,/jumpPressedNow && player\.onGround && rubberBounceLock && rubberBounceLock\.axis==='y'/,'a settled top bounce rearms only on a deliberate new jump');
assert.match(mainSource,/landingId!==T\.RUBBER_WOOD && rubberBounceLock && rubberBounceLock\.axis==='y'/,'landing elsewhere rearms the rubber trampoline');
assert.match(mainSource,/ghostHeroRamLightWood:/,'the host exposes a validated co-op ram seam');

console.log('tree-impact-sim: all assertions passed');
