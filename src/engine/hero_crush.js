// Hero burial & crush resolution. When a collapse solidifies tiles inside the
// hero's hitbox the hero acts like a block: light loads are shrugged off (the
// material is re-loosened and rests on him until he steps away), heavy loads pin
// and crush him in place. This replaces the old collide() behaviour that snapped
// him on top of the tallest overlapping tile — the "teleports diagonally out of
// the pile" bug. Only cells that became solid *while overlapping the hero*
// (tracked by main.js via the world tile-change hook) count as burial; cells he
// was merely pushed against (boss shove, restore edges) get a gentle bounded
// depenetration instead, so walls stay walls.
// main.js owns all side effects (world writes, damage, movement damping); this
// module owns the decisions so node sims can exercise them headlessly.
import { T, INFO } from '../constants.js';
import { buildMaterialProfile, isDoorTile, isTrapdoorTile } from './material_physics.js';

export const CRUSH_TUNING = Object.freeze({
  BASE_CAPACITY: 4,        // load units the untrained hero shoulders (≈4 dirt tiles)
  CAPACITY_PER_POINT: 1.5, // each Twardość skill point raises the ceiling by this
  OVERBURDEN_ROWS: 16,     // how far up a loose column keeps pressing on a buried hero
  DMG_BASE: 4,             // crush tick damage at the threshold…
  DMG_PER_EXCESS: 3,       // …plus this per load unit over capacity…
  DMG_MAX: 30,             // …capped so deep burials stay survivable for a few ticks
  TICK_MS: 650,            // damageHero invulnerability window between crush ticks
  DEPEN_RATE: 10,          // tiles/s a shoved (non-buried) hero eases out of overlap
});

// Per-tile press weight. BUILD_MATERIAL_PROFILES weights already rank materials
// (wood 0.72 … meteoric iron 1.45); sand has no profile because it is granular.
export function heroLoadWeight(t){
  if(t===T.BEDROCK) return Infinity; // never survivable — no amount of Twardość shoulders bedrock
  // Snow buries, it does not crush: a hero swallowed by a blizzard drift has to
  // dig out, but even a storm-deep snow column stays under the base capacity.
  if(t===T.SNOW || t===T.TOXIC_SNOW) return 0.15;
  const p=buildMaterialProfile(t);
  if(p && Number.isFinite(p.weight)) return p.weight;
  if(t===T.SAND) return 0.9;
  return 1;
}

export function heroCrushCapacity(bonus){
  const b=(typeof bonus==='number' && isFinite(bonus) && bonus>0) ? bonus : 0;
  return CRUSH_TUNING.BASE_CAPACITY + b;
}

// One crush tick for a load this far over capacity — shared by tile burials and
// hovering-entity piles resting on the hero.
export function crushTickDamage(excess){
  if(!(excess>0)) return 0;
  return Math.min(CRUSH_TUNING.DMG_MAX, Math.round(CRUSH_TUNING.DMG_BASE + excess*CRUSH_TUNING.DMG_PER_EXCESS));
}

// Materials the falling system can carry as loose entities again. Machines,
// chests, story blocks and bedrock stay tiles — the hero slides out of those.
export function canEjectOntoHero(t){
  if(t===T.BEDROCK) return false;
  const info=INFO[t];
  if(!info) return false;
  return !(info.machine || info.chestTier || info.cache || info.story || info.unmineable || info.door || info.trapdoor);
}

// Solid cells overlapping the hero AABB. Doors/trapdoors are hero utilities the
// movement code already special-cases, never collapse material.
export function heroEmbeddedTiles(player, solidAt, getTile){
  const w=player.w/2, h=player.h/2, EPS=1e-4;
  const minX=Math.floor(player.x-w+EPS), maxX=Math.floor(player.x+w-EPS);
  const minY=Math.floor(player.y-h+EPS), maxY=Math.floor(player.y+h-EPS);
  const out=[];
  for(let y=minY;y<=maxY;y++){
    for(let x=minX;x<=maxX;x++){
      if(!solidAt(x,y)) continue;
      const t=getTile(x,y);
      if(isDoorTile(t) || isTrapdoorTile(t)) continue;
      out.push({x,y,t});
    }
  }
  return out;
}

// Load pressing on a buried hero: the buried cells themselves plus, per column,
// the contiguous run of *loose* material above them (sand, settled rubble, tree
// debris — via the isLooseLoad callback). A self-supporting roof over a
// crawlspace is architecture, not load, so the walk stops at the first
// non-loose cell.
export function heroBurialLoad({buried, solidAt, getTile, isLooseLoad, minY}){
  let load=0;
  const topByCol=new Map();
  for(const c of buried){
    load+=heroLoadWeight(c.t);
    const cur=topByCol.get(c.x);
    if(cur==null || c.y<cur) topByCol.set(c.x,c.y);
  }
  const yFloor=Number.isFinite(minY)? minY : -Infinity;
  for(const [cx,topY] of topByCol){
    for(let y=topY-1,n=0; n<CRUSH_TUNING.OVERBURDEN_ROWS && y>=yFloor; n++,y--){
      if(!solidAt(cx,y)) break;
      const t=getTile(cx,y);
      if(typeof isLooseLoad==='function' && !isLooseLoad(cx,y,t)) break;
      load+=heroLoadWeight(t);
    }
  }
  return load;
}

// Bounded ease-out for a hero pressed into standing tiles: push along the least
// penetrated axis of the deepest overlap, capped at DEPEN_RATE — a correction,
// never a teleport.
export function depenetrationPush(player, embedded, dt){
  const w=player.w/2, h=player.h/2;
  let best=null, bestArea=0, bx=0, by=0;
  for(const c of embedded){
    const ox=Math.min(c.x+1,player.x+w)-Math.max(c.x,player.x-w);
    const oy=Math.min(c.y+1,player.y+h)-Math.max(c.y,player.y-h);
    if(ox<=0 || oy<=0) continue;
    if(ox*oy>bestArea){ bestArea=ox*oy; best=c; bx=ox; by=oy; }
  }
  if(!best) return null;
  const step=Math.min(CRUSH_TUNING.DEPEN_RATE*(dt>0?dt:0), Math.min(bx,by)+0.001);
  if(step<=0) return null;
  if(bx<=by) return {dx:(player.x>=best.x+0.5?1:-1)*step, dy:0};
  return {dx:0, dy:(player.y>=best.y+0.5?1:-1)*step};
}

// One decision pass per frame. buriedCells is the caller-owned set of "became
// solid over the hero" cells; stale entries (mined, ejected, walked away from)
// are pruned here so the set cannot leak across worlds or respawns.
//   status 'clear'  — nothing overlaps.
//   status 'rest'   — load within capacity: eject[] lists the buried cells to
//                     re-loosen so they rest on the hero (he is the block).
//   status 'pinned' — load exceeds capacity: damage is the crush tick to apply;
//                     the hero stays where he is (dig out or die).
//   status 'shoved' — overlap without burial: push is the bounded correction.
export function resolveHeroBurial(env){
  const {player, solidAt, getTile, buriedCells, capacityBonus, isLooseLoad, minY, dt}=env;
  const embedded=heroEmbeddedTiles(player, solidAt, getTile);
  if(buriedCells && buriedCells.size){
    const live=new Set();
    for(const c of embedded) live.add(c.x+','+c.y);
    for(const k of buriedCells) if(!live.has(k)) buriedCells.delete(k);
  }
  const capacity=heroCrushCapacity(capacityBonus);
  if(!embedded.length) return {status:'clear', load:0, capacity};
  const buried=buriedCells ? embedded.filter(c=>buriedCells.has(c.x+','+c.y)) : embedded;
  if(buried.length){
    const load=heroBurialLoad({buried, solidAt, getTile, isLooseLoad, minY});
    if(load>capacity){
      const excess=load-capacity;
      return {status:'pinned', load, capacity, excess, damage:crushTickDamage(excess), buried};
    }
    return {status:'rest', load, capacity, eject:buried.filter(c=>canEjectOntoHero(c.t))};
  }
  return {status:'shoved', capacity, push:depenetrationPush(player, embedded, dt)};
}

export const heroCrush={CRUSH_TUNING, heroLoadWeight, heroCrushCapacity, crushTickDamage, canEjectOntoHero, heroEmbeddedTiles, heroBurialLoad, depenetrationPush, resolveHeroBurial};
export default heroCrush;
