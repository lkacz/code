import { HERO_BODY_W, HERO_BODY_H } from '../constants.js';

// Weather deposition has always kept a wider pocket around the host than the
// exact hero AABB. Share that same clearance with co-op bodies so snow and dunes
// do not close one player in while sparing another.
export const BODY_DEPOSITION_CLEARANCE = Object.freeze({ x: 0.75, y: 1.425 });
export const COOP_BODY_ONLY = Object.freeze({ host: false });

export function bodyFootprintOverlapsCell(body,cellX,cellY,clearance){
  if(!body || !Number.isFinite(body.x) || !Number.isFinite(body.y) || !Number.isFinite(cellX) || !Number.isFinite(cellY)) return false;
  const x=Math.floor(cellX), y=Math.floor(cellY);
  const padX=clearance && Number.isFinite(clearance.x) ? Math.max(0,clearance.x) : 0;
  const padY=clearance && Number.isFinite(clearance.y) ? Math.max(0,clearance.y) : 0;
  const w=Number.isFinite(body.w) && body.w>0 ? body.w : HERO_BODY_W;
  const h=Number.isFinite(body.h) && body.h>0 ? body.h : HERO_BODY_H;
  return x+1 > body.x-w/2-padX && x < body.x+w/2+padX &&
    y+1 > body.y-h/2-padY && y < body.y+h/2+padY;
}

// True when a world cell would intersect the host hero or any authoritative
// co-op body footprint. Dead guests intentionally remain blockers: their corpse
// still occupies the host-owned body position even though combat AI ignores it.
// Invalid/stale entries fail inertly, and the solo path is two guarded reads.
export function authoritativeBodyBlocksCell(cellX,cellY,clearance){
  if(!Number.isFinite(cellX) || !Number.isFinite(cellY)) return false;
  const x=Math.floor(cellX), y=Math.floor(cellY);
  const root=typeof window!=='undefined' ? window : globalThis;
  if((!clearance || clearance.host!==false) && bodyFootprintOverlapsCell(root.player,x,y,clearance)) return true;
  const currentProbe=root.MM && root.MM.coopBodyBlocksCell;
  if(typeof currentProbe==='function'){
    try{ return !!currentProbe(x,y,clearance); }catch(e){ /* fall back to the published plane */ }
  }
  const bodies=root.MM && Array.isArray(root.MM.coopBodies) ? root.MM.coopBodies : null;
  if(!bodies) return false;
  for(const body of bodies) if(bodyFootprintOverlapsCell(body,x,y,clearance)) return true;
  return false;
}
