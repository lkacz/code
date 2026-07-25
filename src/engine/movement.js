import { MOVE, T } from '../constants.js';

const NORMAL_TRACTION = Object.freeze({ speed: 1, accel: 1, friction: 1, kind: 'normal' });
const TRACTION = Object.freeze({
  mud: Object.freeze({ speed: 0.5, accel: 1, friction: 1, kind: 'mud' }),
  snow: Object.freeze({ speed: 1, accel: 0.78, friction: 0.28, kind: 'snow' }),
  ice: Object.freeze({ speed: 1.04, accel: 0.34, friction: 0.055, kind: 'ice' }),
  loose: Object.freeze({ speed: 0.92, accel: 0.78, friction: 0.72, kind: 'loose' }),
});
export const JUMP_ARC = Object.freeze({
  DOWN_CANCEL_FALL_TILES: 0.08,
});

function safePositive(n, fallback){
  return (typeof n === 'number' && isFinite(n) && n > 0) ? n : fallback;
}

export function surfaceTraction(tile){
  if(tile === T.MUD) return TRACTION.mud;
  if(tile === T.UNSTABLE_SAND || tile === T.UNSTABLE_GRASS) return TRACTION.loose;
  if(tile === T.SNOW || tile === T.TOXIC_SNOW || tile === T.GRASS_SNOW) return TRACTION.snow;
  if(tile === T.ICE) return TRACTION.ice;
  return NORMAL_TRACTION;
}

export function applyHorizontalMovement(vx, input, dt, moveMultiplier, move, groundTile){
  move = move || MOVE;
  const traction = surfaceTraction(groundTile);
  const baseMult = safePositive(moveMultiplier, 1);
  const speedMult = baseMult * traction.speed;
  const target = input * move.MAX * speedMult;
  const diff = target - vx;
  if(target !== 0){
    const accel = move.ACC * dt * Math.sign(diff) * speedMult * traction.accel;
    return Math.abs(accel) > Math.abs(diff) ? target : vx + accel;
  }
  const fr = move.FRICTION * dt * speedMult * traction.friction;
  if(Math.abs(vx) <= fr) return 0;
  return vx - fr * Math.sign(vx);
}

export function applyJumpArcControl(vy, gravity, options = {}){
  const g = safePositive(gravity, MOVE.GRAV);
  let next = (typeof vy === 'number' && isFinite(vy)) ? vy : 0;
  if(options.cancel){
    const fallVy = Math.sqrt(2 * g * JUMP_ARC.DOWN_CANCEL_FALL_TILES);
    if(next < fallVy) next = fallVy;
  }
  return next;
}

export const movement = { surfaceTraction, applyHorizontalMovement, applyJumpArcControl, JUMP_ARC };
export default movement;
