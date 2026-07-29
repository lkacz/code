import { T } from '../constants.js';

// Hero/tree collision tuning lives in one pure module so the collision resolver,
// multiplayer validator and headless tests all agree on what counts as a real hit.
export const TREE_IMPACT = Object.freeze({
  RUBBER_SIDE_MIN_SPEED: 1.25,
  RUBBER_SIDE_RESTITUTION: 0.72,
  RUBBER_SIDE_MIN_RETURN: 2.4,
  RUBBER_SIDE_MAX_RETURN: 15,
  RUBBER_TOP_MIN_IMPACT: 0.45,
  RUBBER_TOP_RESTITUTION: 0.72,
  RUBBER_TOP_HALF_JUMP: Math.SQRT1_2,
  RUBBER_TOP_MAX_JUMP_MULT: 1.15,
  LIGHT_WOOD_RAM_MIN_SPEED: 4,
});

function finiteMagnitude(value){
  const n=Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function rubberSideBounceVelocity(vx){
  const speed=finiteMagnitude(vx);
  if(speed<TREE_IMPACT.RUBBER_SIDE_MIN_SPEED) return 0;
  const returned=Math.min(
    TREE_IMPACT.RUBBER_SIDE_MAX_RETURN,
    Math.max(TREE_IMPACT.RUBBER_SIDE_MIN_RETURN,speed*TREE_IMPACT.RUBBER_SIDE_RESTITUTION)
  );
  return (Number(vx)<0?1:-1)*returned;
}

// `fullJumpVy` is the normal upward jump velocity (negative in world space).
// The minimum launch reaches half the normal jump HEIGHT: velocity therefore
// scales by sqrt(1/2), while a hard fall can return more of its real momentum.
export function rubberTopBounceVelocity(downwardImpact,fullJumpVy){
  const impact=finiteMagnitude(downwardImpact);
  if(impact<TREE_IMPACT.RUBBER_TOP_MIN_IMPACT) return 0;
  const fullJump=finiteMagnitude(fullJumpVy);
  const halfJump=fullJump*TREE_IMPACT.RUBBER_TOP_HALF_JUMP;
  const cap=Math.max(halfJump,fullJump*TREE_IMPACT.RUBBER_TOP_MAX_JUMP_MULT);
  return -Math.min(cap,Math.max(halfJump,impact*TREE_IMPACT.RUBBER_TOP_RESTITUTION));
}

export function canRamLightWood(tile,turboActive,impactVelocity){
  return tile===T.LIGHT_WOOD
    && turboActive===true
    && finiteMagnitude(impactVelocity)>=TREE_IMPACT.LIGHT_WOOD_RAM_MIN_SPEED;
}

export function rubberBounceKey(x,y){
  return Math.floor(Number(x))+','+Math.floor(Number(y));
}

export default {
  TREE_IMPACT,
  rubberSideBounceVelocity,
  rubberTopBounceVelocity,
  canRamLightWood,
  rubberBounceKey,
};
