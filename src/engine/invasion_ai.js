// Team-agnostic invasion combat AI.
//
// This module knows nothing about aliens, lasers or theft. It provides the
// reusable tactical layer every invading team (aliens today; dwarves, feral
// animal packs, ... tomorrow) plugs into:
//   - createNav(world)        platformer-aware A* over standable tiles with
//                             walk / step / jump / drop edges, budgeted per
//                             frame, partial-path fallback, cover search, LoS.
//   - makeTeamProfile(opts)   normalized team tuning (movement caps, combat
//                             reach, role table) so hosts stay data-driven.
//   - assignRoles(n, profile) deterministic-ish varied role rollout.
//   - createSquadBrain(...)   per-team coordinator: role state machines,
//                             attack tokens, flanking sides, flee morale,
//                             siege mode when the hero cannot be reached.
//   - applySeparation(units)  units bump apart instead of overlapping.
//
// The brain never moves bodies or writes tiles itself. It fills
// unit._ai.intent {moveX, jump, speedMult} and calls host hooks
// (fire / tileAttack / build / canBuildAt) so each host keeps full control
// over physics, damage and world writes.

const PATH_WINDOW_X = 44;   // half-width of the A* search window (tiles)
const PATH_WINDOW_Y = 26;   // half-height
const PATH_GRID_W = PATH_WINDOW_X * 2 + 1;
const PATH_GRID_H = PATH_WINDOW_Y * 2 + 1;
const PATH_CELLS = PATH_GRID_W * PATH_GRID_H;

// Reused scratch buffers: pathfinding runs a few times per frame and per-call
// allocation of ~5 typed arrays showed up as GC pressure in similar systems.
const gScore = new Float64Array(PATH_CELLS);
const fScore = new Float64Array(PATH_CELLS);
const cameFrom = new Int32Array(PATH_CELLS);
const cellState = new Uint8Array(PATH_CELLS); // 0 untouched, 1 open, 2 closed
const standCache = new Int8Array(PATH_CELLS); // -1 unknown, 0 no, 1 yes
// Sized well above PATH_CELLS: lazy decrease-key re-pushes nodes, so the heap
// can briefly hold more entries than there are cells.
const heap = new Int32Array(16384);
let heapSize = 0;

function heapPush(idx){
  if(heapSize >= heap.length - 1) return; // saturated: drop, stale-skip covers it
  heapSize++;
  heap[heapSize] = idx;
  let i = heapSize;
  while(i > 1){
    const p = i >> 1;
    if(fScore[heap[p]] <= fScore[heap[i]]) break;
    const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp;
    i = p;
  }
}
function heapPop(){
  const top = heap[1];
  heap[1] = heap[heapSize--];
  let i = 1;
  for(;;){
    const l = i * 2, r = l + 1;
    let m = i;
    if(l <= heapSize && fScore[heap[l]] < fScore[heap[m]]) m = l;
    if(r <= heapSize && fScore[heap[r]] < fScore[heap[m]]) m = r;
    if(m === i) break;
    const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp;
    i = m;
  }
  return top;
}

export const DEFAULT_MOVE_CAPS = Object.freeze({
  jumpUp: 2,      // tiles a unit can jump straight up onto
  jumpSpan: 3,    // tiles a unit can clear horizontally in one jump
  maxFall: 8,     // tiles a unit will deliberately drop
  maxNodes: 640   // A* expansion budget per query
});

export function createNav(world, caps){
  // world: {readTile(x,y), isOpen(tileId), isSolid(tileId), minY, maxY}
  const cfg = Object.assign({}, DEFAULT_MOVE_CAPS, caps || {});

  function openAt(x,y){ return world.isOpen(world.readTile(x,y)); }
  function solidAt(x,y){ return world.isSolid(world.readTile(x,y)); }
  function inY(y){ return y >= world.minY + 2 && y < world.maxY - 2; }

  function canStand(x,y){
    if(!inY(y)) return false;
    return openAt(x,y) && openAt(x,y-1) && solidAt(x,y+1);
  }

  // Snap a rough goal to the nearest standable cell (column scan first, then ring).
  function findStandableNear(x,y,r){
    const tx = Math.floor(x), ty = Math.floor(y);
    const radius = Math.max(1, r|0);
    if(canStand(tx,ty)) return {x:tx,y:ty};
    for(let dy=1; dy<=radius; dy++){
      if(canStand(tx,ty+dy)) return {x:tx,y:ty+dy};
      if(canStand(tx,ty-dy)) return {x:tx,y:ty-dy};
    }
    for(let dx=1; dx<=radius; dx++){
      for(const sx of [tx-dx, tx+dx]){
        for(let dy=-radius; dy<=radius; dy++){
          if(canStand(sx,ty+dy)) return {x:sx,y:ty+dy};
        }
      }
    }
    return null;
  }

  // Line of sight between two world points, blocked by solid tiles.
  function los(x1,y1,x2,y2,maxDist){
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx,dy) || 1;
    const dist = Math.min(maxDist || 24, len);
    const nx = dx / len, ny = dy / len;
    for(let d=0.35; d<=dist; d+=0.22){
      const tx = Math.floor(x1 + nx * d), ty = Math.floor(y1 + ny * d);
      const t = world.readTile(tx,ty);
      if(world.isSolid(t)) return {clear:false, tx, ty, tile:t, dist:d};
    }
    return {clear: len <= dist + 0.75, tx:Math.floor(x2), ty:Math.floor(y2), tile:0, dist};
  }

  function findPath(sx,sy,gx,gy,opts){
    opts = opts || {};
    const start = findStandableNear(sx,sy,4);
    if(!start) return null;
    const goalSpot = findStandableNear(gx,gy,5) || {x:Math.floor(gx), y:Math.floor(gy)};
    const minX = start.x - PATH_WINDOW_X, minY = start.y - PATH_WINDOW_Y;
    const inWin = (x,y)=> x >= minX && x < minX + PATH_GRID_W && y >= minY && y < minY + PATH_GRID_H;
    const goalX = Math.max(minX, Math.min(minX + PATH_GRID_W - 1, goalSpot.x));
    const goalY = Math.max(minY, Math.min(minY + PATH_GRID_H - 1, goalSpot.y));
    const idxOf = (x,y)=> (x - minX) + (y - minY) * PATH_GRID_W;
    const xOf = idx=> (idx % PATH_GRID_W) + minX;
    const yOf = idx=> Math.floor(idx / PATH_GRID_W) + minY;

    cellState.fill(0);
    standCache.fill(-1);
    heapSize = 0;

    function standable(x,y){
      if(!inWin(x,y)) return false;
      const i = idxOf(x,y);
      let v = standCache[i];
      if(v < 0){ v = canStand(x,y) ? 1 : 0; standCache[i] = v; }
      return v === 1;
    }
    function hCost(x,y){ return Math.abs(x - goalX) + Math.abs(y - goalY) * 0.6; }
    // Jump edges are encoded in the parent link's high bits so the follower
    // knows which waypoints need an actual jump instead of a walk.
    const JUMP_FLAG = 1 << 21;
    function open(idx, from, cost, jumped){
      if(cellState[idx] === 2) return;
      const g = gScore[from] + cost;
      if(cellState[idx] === 1 && g >= gScore[idx]) return;
      gScore[idx] = g;
      fScore[idx] = g + hCost(xOf(idx), yOf(idx)) * 1.12;
      cameFrom[idx] = from | (jumped ? JUMP_FLAG : 0);
      if(cellState[idx] !== 1){ cellState[idx] = 1; heapPush(idx); }
      else heapPush(idx); // lazy decrease-key: stale entries skipped on pop
    }

    const startIdx = idxOf(start.x, start.y);
    gScore[startIdx] = 0;
    fScore[startIdx] = hCost(start.x, start.y);
    cameFrom[startIdx] = -1;
    cellState[startIdx] = 1;
    heapPush(startIdx);

    const budget = Math.max(64, opts.maxNodes || cfg.maxNodes);
    let expanded = 0;
    let bestIdx = startIdx;
    let bestH = hCost(start.x, start.y);
    let reached = false;

    while(heapSize > 0 && expanded < budget){
      const cur = heapPop();
      if(cellState[cur] === 2) continue;
      cellState[cur] = 2;
      expanded++;
      const cx = xOf(cur), cy = yOf(cur);
      const h = hCost(cx,cy);
      if(h < bestH){ bestH = h; bestIdx = cur; }
      if(cx === goalX && cy === goalY){ bestIdx = cur; reached = true; break; }

      for(const dir of [-1,1]){
        const nx = cx + dir;
        // flat walk
        if(standable(nx,cy)) open(idxOf(nx,cy), cur, 1, false);
        // step / jump up onto a ledge next to us
        for(let up=1; up<=cfg.jumpUp; up++){
          let clear = true;
          for(let k=1;k<=up;k++){ if(!openAt(cx,cy-1-k)){ clear = false; break; } }
          if(!clear) break;
          if(standable(nx,cy-up)){ open(idxOf(nx,cy-up), cur, 1.6 + up * 0.9, up > 1); break; }
        }
        // walk off the edge and drop
        if(openAt(nx,cy) && openAt(nx,cy-1) && !solidAt(nx,cy+1)){
          for(let down=1; down<=cfg.maxFall; down++){
            const ny = cy + down;
            if(!inY(ny)) break;
            if(solidAt(nx,ny)) break;
            if(standable(nx,ny)){ open(idxOf(nx,ny), cur, 1 + down * 0.35, false); break; }
          }
        }
        // jump across a gap (with optional lower landing)
        for(let span=2; span<=cfg.jumpSpan; span++){
          let flyClear = true;
          for(let i=1;i<span;i++){
            if(!openAt(cx+i*dir,cy) || !openAt(cx+i*dir,cy-1)){ flyClear = false; break; }
          }
          if(!flyClear) break;
          const lx = cx + span * dir;
          if(standable(lx,cy)){ open(idxOf(lx,cy), cur, span * 1.5, true); break; }
          let landed = false;
          for(let down=1; down<=cfg.maxFall; down++){
            const ny = cy + down;
            if(!inY(ny)) break;
            if(solidAt(lx,ny)) break;
            if(standable(lx,ny)){ open(idxOf(lx,ny), cur, span * 1.5 + down * 0.3, true); landed = true; break; }
          }
          if(landed) break;
        }
      }
    }

    if(bestIdx === startIdx && !reached) return {reached:false, path:[]};
    const rev = [];
    let cur = bestIdx;
    let guard = PATH_CELLS;
    while(cur >= 0 && guard-- > 0){
      const link = cameFrom[cur];
      const parent = link < 0 ? -1 : (link & (JUMP_FLAG - 1));
      rev.push({x:xOf(cur), y:yOf(cur), jump:link >= 0 && (link & JUMP_FLAG) !== 0});
      if(link < 0) break;
      cur = parent;
    }
    rev.reverse();
    // Compress straight flat runs; keep endpoints, elevation changes and jumps.
    const path = [];
    for(let i=0;i<rev.length;i++){
      const wp = rev[i];
      const prev = path[path.length-1];
      const next = rev[i+1];
      if(prev && next && !wp.jump && !next.jump && prev.y === wp.y && next.y === wp.y) continue;
      path.push(wp);
    }
    return {reached, path};
  }

  // Find a nearby standable spot the hero cannot see (solid tiles block LoS).
  function findCoverSpot(fromX,fromY,heroX,heroY,opts){
    opts = opts || {};
    const minHeroDist = opts.minHeroDist || 3;
    const maxR = Math.max(2, opts.radius || 8);
    const awaySide = fromX >= heroX ? 1 : -1;
    let losBudget = 16;
    for(let r=1; r<=maxR; r++){
      for(const side of [awaySide, -awaySide]){
        const cx = Math.floor(fromX) + side * r;
        const spot = findStandableNear(cx + 0.5, fromY, 5);
        if(!spot || Math.abs(spot.x - cx) > 1) continue;
        if(Math.hypot(spot.x + 0.5 - heroX, spot.y - heroY) < minHeroDist) continue;
        if(losBudget-- <= 0) return null;
        const sight = los(heroX, heroY - 0.5, spot.x + 0.5, spot.y - 0.5, 26);
        if(!sight.clear) return {x:spot.x, y:spot.y};
      }
    }
    return null;
  }

  return {caps:cfg, canStand, findStandableNear, findPath, los, findCoverSpot};
}

// ---------------------------------------------------------------------------
// Team profiles & roles
// ---------------------------------------------------------------------------

// Role table defaults. Every value can be overridden per team profile, and
// teams can drop or add roles entirely (an animal pack may only use rusher +
// flanker; a dwarf crew may lean on sapper + engineer).
export const DEFAULT_ROLES = Object.freeze({
  rusher:   {weight:3, minRange:1.4, maxRange:4.5, speedMult:1.06, fireCd:0.85, damageMult:1.0, aim:0.9},
  tank:     {weight:1, minRange:1.0, maxRange:3.8, speedMult:0.82, fireCd:1.25, damageMult:1.1, aim:0.72, stoic:true, guard:true},
  healer:   {weight:1, minRange:3.5, maxRange:8.0, speedMult:0.96, fireCd:1.45, damageMult:0.55, aim:0.78, support:true, healRange:5.8, healCd:1.15, healAmount:5},
  flanker:  {weight:2, minRange:2.0, maxRange:5.5, speedMult:1.12, fireCd:0.95, damageMult:1.0, aim:0.85, flank:true},
  orbiter:  {weight:2, minRange:4.0, maxRange:7.5, speedMult:1.0,  fireCd:1.05, damageMult:0.9, aim:0.8, orbit:5.6},
  sniper:   {weight:2, minRange:8.0, maxRange:13,  speedMult:0.92, fireCd:2.1,  damageMult:1.9, aim:1.0, coverAfterShot:true, skittish:true},
  sapper:   {weight:1, minRange:2.0, maxRange:6.0, speedMult:0.95, fireCd:1.1,  damageMult:0.8, aim:0.8, tileDmgMult:3.0, breacher:true},
  engineer: {weight:1, minRange:5.0, maxRange:9.0, speedMult:0.95, fireCd:1.5,  damageMult:0.8, aim:0.8, builder:true},
  commander:{weight:0.25, minRange:1.2, maxRange:5.2, speedMult:0.78, fireCd:1.3, damageMult:1.25, aim:0.86, stoic:true, guard:true}
});

// Guaranteed opening variety: small squads still feel like a coordinated
// strike team instead of N copies of the same unit.
const ROLE_OPENING = ['rusher','tank','healer','sniper','orbiter','flanker','engineer','sapper'];

export function makeTeamProfile(opts){
  opts = opts || {};
  const roles = {};
  const src = opts.roles || DEFAULT_ROLES;
  for(const name in src){
    roles[name] = Object.assign({}, DEFAULT_ROLES[name] || {}, src[name]);
  }
  if(!roles.rusher) roles.rusher = Object.assign({}, DEFAULT_ROLES.rusher);
  return {
    kind: String(opts.kind || 'invaders'),
    moveCaps: Object.assign({}, DEFAULT_MOVE_CAPS, opts.moveCaps || {}),
    baseSpeed: Number(opts.baseSpeed) || 2.35,
    jumpVel: Number(opts.jumpVel) || 9.6,
    fireRange: Number(opts.fireRange) || 14,
    meleeRange: Number(opts.meleeRange) || 0.72,
    fleeHpFrac: Number.isFinite(opts.fleeHpFrac) ? opts.fleeHpFrac : 0.32,
    fleeDist: Number(opts.fleeDist) || 15,
    repairHpFrac: Number.isFinite(opts.repairHpFrac) ? opts.repairHpFrac : 0.42,
    repairMinHpFrac: Number.isFinite(opts.repairMinHpFrac) ? opts.repairMinHpFrac : 0.10,
    repairDoneFrac: Number.isFinite(opts.repairDoneFrac) ? opts.repairDoneFrac : 0.82,
    repairRange: Number(opts.repairRange) || 2.4,
    repairRate: Number(opts.repairRate) || 0.18,
    strikeTokens: Number(opts.strikeTokens) || 0, // 0 = auto by squad size
    siegeAfter: Number(opts.siegeAfter) || 3.5,   // seconds without LoS/path
    breachRange: Number(opts.breachRange) || 12,
    buildCap: Number.isFinite(opts.buildCap) ? opts.buildCap : 8,
    roles
  };
}

export function assignRoles(count, profile, rand){
  const rng = typeof rand === 'function' ? rand : Math.random;
  const roles = profile && profile.roles ? profile.roles : DEFAULT_ROLES;
  const names = Object.keys(roles);
  if(!names.length) return new Array(Math.max(0,count|0)).fill('rusher');
  const out = [];
  for(const name of ROLE_OPENING){
    if(out.length >= count) break;
    if(roles[name]) out.push(name);
  }
  let totalW = 0;
  for(const name of names) totalW += Math.max(0, Number(roles[name].weight) || 1);
  while(out.length < count){
    let pick = rng() * (totalW || 1);
    let chosen = names[0];
    for(const name of names){
      pick -= Math.max(0, Number(roles[name].weight) || 1);
      if(pick <= 0){ chosen = name; break; }
    }
    out.push(chosen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Separation: units shoulder each other aside instead of stacking.
// ---------------------------------------------------------------------------

export function applySeparation(units, opts){
  opts = opts || {};
  const radius = opts.radius || 0.30;
  const hero = opts.hero || null;
  const canOccupy = typeof opts.canOccupy === 'function' ? opts.canOccupy : null;
  const n = units.length;
  for(let i=0;i<n;i++){
    const a = units[i];
    if(!a || a.dead || a.hp <= 0) continue;
    for(let j=i+1;j<n;j++){
      const b = units[j];
      if(!b || b.dead || b.hp <= 0) continue;
      const minD = radius * 2;
      let dx = b.x - a.x;
      const dy = (b.y - 0.45) - (a.y - 0.45);
      if(Math.abs(dx) > minD || Math.abs(dy) > 1.2) continue;
      const dist = Math.hypot(dx, dy * 0.5);
      if(dist >= minD) continue;
      if(dx === 0) dx = (i % 2 === 0 ? 1 : -1) * 0.01;
      const push = (minD - dist) * 0.5;
      const nx = dx >= 0 ? 1 : -1;
      const ax = a.x - nx * push, bx = b.x + nx * push;
      if(!canOccupy || canOccupy(a, ax, a.y)) a.x = ax;
      if(!canOccupy || canOccupy(b, bx, b.y)) b.x = bx;
      // visible bump: swap a bit of horizontal momentum
      const bump = 0.6;
      const avx = a.vx || 0, bvx = b.vx || 0;
      a.vx = avx * (1 - bump * 0.5) - nx * bump;
      b.vx = bvx * (1 - bump * 0.5) + nx * bump;
    }
    if(hero){
      const dx = a.x - hero.x;
      const dy = (a.y - 0.45) - (hero.y - 0.5);
      if(Math.abs(dx) < 0.5 && Math.abs(dy) < 1.0){
        const nx = dx >= 0 ? 1 : -1;
        const ax = a.x + nx * (0.5 - Math.abs(dx)) * 0.7;
        if(!canOccupy || canOccupy(a, ax, a.y)) a.x = ax;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Squad brain
// ---------------------------------------------------------------------------

let pathBudgetThisFrame = 0;
const PATH_QUERIES_PER_FRAME = 3;

// Host calls this once per engine tick, before updating brains.
export function beginAIFrame(){
  pathBudgetThisFrame = PATH_QUERIES_PER_FRAME;
}

function freshAI(){
  return {
    state:'approach',
    stateT:0,
    path:null,
    pathI:0,
    pathReached:true,
    repathIn:0,
    goalX:0, goalY:0,
    lastX:0, lastY:0, stuckT:0,
    orbitDir:Math.random() < 0.5 ? -1 : 1,
    orbitAng:Math.random() * Math.PI * 2,
    coverX:0, coverY:0, hasCover:false,
    fleeUntil:0,
    repairUntil:0,
    repairCooldownUntil:0,
    buildX:0, buildY:0, buildStage:0, buildT:0,
    breachX:0, breachY:0, hasBreach:false,
    supportId:'',
    token:false,
    hadLos:false,
    intent:{moveX:0, jump:false, speedMult:1}
  };
}

export function createSquadBrain(profile, nav){
  const brain = {
    profile,
    nav,
    mode:'assault',
    modeT:0,
    noLosT:0,
    noPathT:0,
    flankFlip:1
  };

  function roleOf(u){
    return profile.roles[u.role] || profile.roles.rusher || DEFAULT_ROLES.rusher;
  }

  function findLiveById(live, id){
    if(!id) return null;
    for(const u of live){
      if(u && u.id === id && !u.dead && u.hp > 0) return u;
    }
    return null;
  }

  function findSupportTarget(u, live, role){
    if(!role.support) return null;
    let best = null;
    let bestScore = 0;
    const scan = role.supportScan || 18;
    for(const other of live){
      if(!other || other === u || other.dead || other.hp <= 0 || !(other.maxHp > 0)) continue;
      const missing = Math.max(0, other.maxHp - other.hp);
      const frac = other.hp / other.maxHp;
      if(frac > 0.88 || missing < 1.2) continue;
      const dist = Math.hypot(other.x - u.x, other.y - u.y);
      if(dist > scan) continue;
      const score = missing * 1.2 + (other.role === 'tank' ? 2.5 : 0) - dist * 0.16;
      if(!best || score > bestScore){ best = other; bestScore = score; }
    }
    if(!best && u.maxHp > 0 && u.hp / u.maxHp < 0.62) best = u;
    return best;
  }

  function setState(ai, state){
    if(ai.state === state) return;
    ai.state = state;
    ai.stateT = 0;
    ai.path = null;
    ai.pathI = 0;
    ai.repathIn = 0;
  }

  function requestPath(u, ai, gx, gy){
    ai.goalX = gx; ai.goalY = gy;
    if(pathBudgetThisFrame <= 0){ ai.repathIn = 0.12; return; }
    pathBudgetThisFrame--;
    const res = nav.findPath(u.x, u.y, gx, gy);
    ai.path = res && res.path.length ? res.path : null;
    ai.pathI = ai.path ? Math.min(1, ai.path.length - 1) : 0;
    ai.pathReached = !!(res && res.reached);
    ai.repathIn = 0.85 + Math.random() * 0.75;
  }

  function wantRepath(ai, gx, gy){
    if(!ai.path) return true;
    if(ai.repathIn <= 0) return true;
    const end = ai.path[ai.path.length - 1];
    return end ? (Math.abs(end.x + 0.5 - gx) + Math.abs(end.y - gy) > 4.5) : true;
  }

  function steerTo(u, ai, gx, gy, dt){
    const intent = ai.intent;
    if(wantRepath(ai, gx, gy)) requestPath(u, ai, gx, gy);
    const path = ai.path;
    if(path && ai.pathI < path.length){
      let wp = path[ai.pathI];
      while(wp && Math.abs(wp.x + 0.5 - u.x) < 0.35 && u.y - wp.y < 1.1 && wp.y - u.y < 0.6){
        ai.pathI++;
        wp = path[ai.pathI];
      }
      if(wp){
        intent.moveX = wp.x + 0.5 > u.x + 0.08 ? 1 : (wp.x + 0.5 < u.x - 0.08 ? -1 : 0);
        // a unit standing on its waypoint cell has feet at wp.y + 1, so only
        // waypoints clearly above that need an actual jump
        const rise = u.y - wp.y;
        if(u.onGround && (wp.jump || (rise > 1.7 && Math.abs(wp.x + 0.5 - u.x) < 2.0))) intent.jump = true;
        return;
      }
    }
    // no path (or consumed): direct steering fallback
    intent.moveX = gx > u.x + 0.25 ? 1 : (gx < u.x - 0.25 ? -1 : 0);
  }

  function fleeing(u, ai, hero, now){
    const role = roleOf(u);
    const frac = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    const threshold = profile.fleeHpFrac * (role.skittish ? 1.5 : 1) * (role.stoic ? 0.45 : 1);
    const recentlyHit = now - (u.lastHitAt || 0) < 2600;
    return frac <= threshold && recentlyHit;
  }
  function landerRepairReady(team){
    const l = team && team.lander;
    return !!(l && l.landed && !l.destroyed);
  }
  function landerRepairPoint(team){
    const l = team && team.lander ? team.lander : {};
    return {
      x:Number.isFinite(l.x) ? l.x : (Number.isFinite(team && team.x) ? team.x : 0),
      y:Number.isFinite(team && team.y) ? team.y : (Number.isFinite(l.targetY) ? l.targetY + 1.35 : (Number.isFinite(l.y) ? l.y + 1.35 : 0))
    };
  }
  function wantsLanderRepair(team,u,ai,now){
    if(!landerRepairReady(team) || !u || !(u.maxHp > 0)) return false;
    if(now < (ai.repairCooldownUntil || 0)) return false;
    const frac = u.hp / u.maxHp;
    return frac > profile.repairMinHpFrac && frac <= profile.repairHpFrac;
  }

  function stepUnit(team, u, dt, hero, hooks, ctx, live){
    const ai = u._ai || (u._ai = freshAI());
    const role = roleOf(u);
    const intent = ai.intent;
    const previousMoveX = intent.moveX || u.facing || 0;
    const wasMoving = previousMoveX !== 0;
    intent.moveX = 0;
    intent.jump = false;
    intent.speedMult = role.speedMult || 1;
    ai.stateT += dt;
    ai.repathIn -= dt;
    const now = ctx.now;
    const dx = hero.x - u.x;
    const dist = Math.hypot(dx, hero.y - u.y) || 0.001;
    const eyeX = u.x, eyeY = u.y - 0.62;
    const sight = nav.los(eyeX, eyeY, hero.x, hero.y - 0.5, profile.fireRange + 3);
    ai.hadLos = sight.clear;
    // A blocking tile only counts as a breach target when it is part of the
    // hero's shelter (near the hero) — a hillside between a distant unit and
    // the hero is an obstacle to walk around, not a wall to chew through.
    if(!sight.clear && sight.tx !== undefined &&
       Math.hypot(sight.tx + 0.5 - hero.x, sight.ty + 0.5 - hero.y) <= profile.breachRange &&
       hooks.isBreachableTile && hooks.isBreachableTile(sight.tx, sight.ty)){
      ai.breachX = sight.tx; ai.breachY = sight.ty; ai.hasBreach = true;
    } else ai.hasBreach = false;
    u.facing = dx >= 0 ? 1 : -1;

    // stuck watchdog: intending to move but not getting anywhere
    const moved = Math.abs(u.x - ai.lastX) + Math.abs(u.y - ai.lastY);
    if(wasMoving && moved < 0.02){
      ai.stuckT += dt;
      if(ai.stuckT > 0.7){
        ai.path = null; ai.repathIn = 0;
        if(hooks.unstuck) hooks.unstuck(u, {dir:previousMoveX, reason:'stuck', now});
        if(u.onGround) intent.jump = true;
        ai.stuckT = 0;
      }
    } else ai.stuckT = 0;
    ai.lastX = u.x; ai.lastY = u.y;

    // --- global overrides -------------------------------------------------
    if(ai.state !== 'repair' && wantsLanderRepair(team,u,ai,now)){
      setState(ai, 'repair');
      ai.repairUntil = now + 12000 + Math.random() * 3000;
    }
    if(ai.state !== 'repair' && ai.state !== 'flee' && fleeing(u, ai, hero, now)){
      setState(ai, 'flee');
      ai.fleeUntil = now + 4200 + Math.random() * 1800;
    }
    if(role.support && ai.state !== 'flee' && ai.state !== 'repair'){
      const target = findSupportTarget(u, live || [], role);
      if(target){
        ai.supportId = target.id;
        if(ai.state !== 'support') setState(ai, 'support');
      } else if(ai.state === 'support') {
        ai.supportId = '';
        setState(ai, sight.clear ? 'strike' : 'approach');
      }
    }

    switch(ai.state){
      case 'repair': {
        if(!landerRepairReady(team) || !(u.maxHp > 0)){
          ai.repairCooldownUntil = now + 3500;
          setState(ai, sight.clear ? 'strike' : 'approach');
          break;
        }
        const frac = u.hp / u.maxHp;
        if(frac >= profile.repairDoneFrac || now > ai.repairUntil){
          ai.repairCooldownUntil = now + (frac >= profile.repairDoneFrac ? 9000 : 4500);
          setState(ai, sight.clear ? 'strike' : 'approach');
          break;
        }
        const dock = landerRepairPoint(team);
        const dockDist = Math.hypot(dock.x - u.x, dock.y - u.y);
        u.facing = dock.x >= u.x ? 1 : -1;
        intent.speedMult = (role.speedMult || 1) * 1.25;
        if(dockDist > profile.repairRange){
          steerTo(u, ai, dock.x, dock.y, dt);
        } else {
          intent.moveX = 0;
          const amount = Math.max(0.45, u.maxHp * profile.repairRate * dt);
          if(hooks.repairAtLander && hooks.repairAtLander(u, amount)){
            ai.repairUntil = Math.max(ai.repairUntil || 0, now + 900);
          }
        }
        break;
      }
      case 'flee': {
        intent.speedMult = (role.speedMult || 1) * 1.18;
        const away = u.x >= hero.x ? 1 : -1;
        const gx = u.x + away * 6;
        steerTo(u, ai, gx, u.y, dt);
        const farEnough = dist > profile.fleeDist;
        if((farEnough && ai.stateT > 1.2) || now > ai.fleeUntil){
          setState(ai, sight.clear ? 'strike' : 'approach');
        }
        break;
      }
      case 'cover': {
        if(!ai.hasCover){
          const spot = nav.findCoverSpot(u.x, u.y, hero.x, hero.y, {minHeroDist:role.minRange || 3});
          if(spot){ ai.coverX = spot.x + 0.5; ai.coverY = spot.y; ai.hasCover = true; }
          else { setState(ai, 'approach'); break; }
        }
        steerTo(u, ai, ai.coverX, ai.coverY, dt);
        const readyAgain = (u.attackCd || 0) <= 0.15;
        if(readyAgain || ai.stateT > 2.6){ ai.hasCover = false; setState(ai, 'approach'); }
        break;
      }
      case 'support': {
        const target = findLiveById(live || [], ai.supportId);
        if(!role.support || !target || target.dead || target.hp <= 0 || target.hp >= target.maxHp * 0.96){
          ai.supportId = '';
          setState(ai, sight.clear ? 'strike' : 'approach');
          break;
        }
        const healRange = role.healRange || 5;
        const tx = target.x;
        const ty = target.y;
        const tDist = Math.hypot(tx - u.x, ty - u.y);
        u.facing = tx >= u.x ? 1 : -1;
        if(target === u){
          if(sight.clear && dist < (role.minRange || 3) * 0.75) intent.moveX = u.x >= hero.x ? 1 : -1;
        } else if(tDist > healRange * 0.86){
          steerTo(u, ai, tx, ty, dt);
        } else if(tDist < Math.max(1.4, healRange * 0.32)){
          const away = u.x >= tx ? 1 : -1;
          steerTo(u, ai, u.x + away * 3, u.y, dt);
        } else if(sight.clear && dist < (role.minRange || 3) * 0.75){
          intent.moveX = u.x >= hero.x ? 1 : -1;
        }
        if((u.attackCd || 0) <= 0 && tDist <= healRange && hooks.heal && hooks.heal(u, target, role.healAmount || 4)){
          u.attackCd = (role.healCd || role.fireCd || 1.2) * (0.85 + Math.random() * 0.3);
        }
        break;
      }
      case 'build': {
        if(!role.builder || (team.builtTiles && team.builtTiles.length >= profile.buildCap)){
          setState(ai, 'approach');
          break;
        }
        if(ai.buildStage === 0){
          const toHero = hero.x >= u.x ? 1 : -1;
          const bx = Math.floor(u.x + toHero * 1.6);
          const base = nav.findStandableNear(bx + 0.5, u.y, 4);
          if(base && hooks.canBuildAt(base.x, base.y) && Math.hypot(base.x + 0.5 - hero.x, base.y - hero.y) > 2.6){
            ai.buildX = base.x; ai.buildY = base.y; ai.buildStage = 1; ai.buildT = 0;
          } else { setState(ai, 'approach'); break; }
        }
        const near = Math.abs(u.x - (ai.buildX + 0.5));
        if(near > 1.3){ steerTo(u, ai, ai.buildX + 0.5, ai.buildY, dt); ai.buildT = 0; break; }
        ai.buildT += dt;
        if(ai.buildT >= 0.85){
          ai.buildT = 0;
          const ty = ai.buildY - (ai.buildStage - 1);
          if(hooks.canBuildAt(ai.buildX, ty) && hooks.build(u, ai.buildX, ty)){
            ai.buildStage++;
            if(ai.buildStage > 2){ ai.buildStage = 0; setState(ai, 'cover'); }
          } else { ai.buildStage = 0; setState(ai, 'approach'); }
        }
        break;
      }
      case 'breach': {
        if(brain.mode !== 'siege' || sight.clear){ setState(ai, 'approach'); break; }
        if(!ai.hasBreach){ setState(ai, 'approach'); break; }
        const bx = ai.breachX + 0.5, by = ai.breachY + 0.5;
        const bDist = Math.hypot(bx - u.x, by - (u.y - 0.45));
        if(role.breacher && bDist > 1.5){ steerTo(u, ai, bx, by, dt); break; }
        if(!role.breacher && bDist > 7){ steerTo(u, ai, bx, by, dt); break; }
        u.facing = bx >= u.x ? 1 : -1;
        if((u.attackCd || 0) <= 0){
          if(role.breacher && bDist <= 1.5){
            hooks.tileAttack(u, ai.breachX, ai.breachY, role.tileDmgMult || 1);
            u.attackCd = 0.5;
          } else {
            hooks.fire(u, {aimX:bx, aimY:by, breach:true, damageMult:role.damageMult});
            u.attackCd = role.fireCd * (0.9 + Math.random() * 0.3);
          }
          if(hooks.isBreachableTile && !hooks.isBreachableTile(ai.breachX, ai.breachY)) ai.hasBreach = false;
        }
        break;
      }
      case 'strike': {
        const inRange = dist >= (role.minRange || 1) - 0.6 && dist <= (role.maxRange || 8) + 1.2;
        if(!sight.clear || !inRange){ setState(ai, 'approach'); break; }
        // hold formation: light strafe keeps them lively without churn
        if(role.orbit){
          ai.orbitAng += ai.orbitDir * dt * 0.9;
          const ox = hero.x + Math.cos(ai.orbitAng) * role.orbit;
          intent.moveX = ox > u.x + 0.3 ? 1 : (ox < u.x - 0.3 ? -1 : 0);
        } else if(dist < (role.minRange || 1)) intent.moveX = u.x >= hero.x ? 1 : -1;
        else if(dist > (role.maxRange || 8)) intent.moveX = u.x >= hero.x ? -1 : 1;
        if(ai.token && (u.attackCd || 0) <= 0){
          hooks.fire(u, {damageMult:role.damageMult, aim:role.aim});
          u.attackCd = role.fireCd * (0.85 + Math.random() * 0.4);
          if(role.coverAfterShot){ ai.hasCover = false; setState(ai, 'cover'); }
        }
        break;
      }
      case 'approach':
      default: {
        if(brain.mode === 'siege' && ai.hasBreach){ setState(ai, 'breach'); break; }
        // builders fortify before they fight: they hold off the strike
        // transition until the squad's build budget is spent
        const wantsBuild = role.builder && brain.mode === 'assault' && dist > 4 && dist < 12 &&
          (!team.builtTiles || team.builtTiles.length < profile.buildCap);
        if(wantsBuild && ai.stateT > 0.6){
          setState(ai, 'build');
          break;
        }
        let gx, gy = hero.y;
        if(role.orbit){
          ai.orbitAng += ai.orbitDir * dt * 0.9;
          gx = hero.x + Math.cos(ai.orbitAng) * role.orbit;
        } else if(role.flank){
          gx = hero.x + (ai.flankSide || 1) * Math.max(2, role.minRange || 2);
        } else {
          const stand = Math.max(1.2, ((role.minRange || 1) + (role.maxRange || 6)) * 0.5 - 1);
          gx = hero.x + (u.x >= hero.x ? 1 : -1) * stand;
        }
        steerTo(u, ai, gx, gy, dt);
        const inBand = dist >= (role.minRange || 1) - 0.4 && dist <= (role.maxRange || 8) + 0.6;
        if(!wantsBuild && sight.clear && inBand) setState(ai, 'strike');
        // skittish roles back off if hero gets too close
        if(role.skittish && dist < (role.minRange || 6) * 0.7){
          intent.moveX = u.x >= hero.x ? 1 : -1;
          intent.speedMult = (role.speedMult || 1) * 1.1;
        }
        break;
      }
    }
  }

  brain.update = function(team, units, dt, hero, hooks, ctx){
    ctx = ctx || {};
    if(!ctx.now) ctx.now = Date.now();
    brain.modeT += dt;
    const live = [];
    for(const u of units){ if(u && !u.dead && u.hp > 0) live.push(u); }
    if(!live.length) return;

    // flank sides alternate so approaches surround the hero
    let flip = brain.flankFlip;
    for(const u of live){
      const ai = u._ai || (u._ai = freshAI());
      if(!ai.flankSide){ ai.flankSide = flip; flip = -flip; }
    }
    brain.flankFlip = flip;

    // squad LoS / reachability bookkeeping drives assault <-> siege
    let anyLos = false, anyPathReached = false, minDist = Infinity;
    for(const u of live){
      const ai = u._ai;
      if(ai.hadLos) anyLos = true;
      if(ai.pathReached) anyPathReached = true;
      const d = Math.hypot(hero.x - u.x, hero.y - u.y);
      if(d < minDist) minDist = d;
    }
    // Siege is for a hero the squad has reached but cannot see — not for
    // squads still marching in from their landing site.
    const arrived = minDist < profile.fireRange + 2;
    if(anyLos){ brain.noLosT = 0; } else if(arrived){ brain.noLosT += dt; } else { brain.noLosT = 0; }
    if(anyPathReached){ brain.noPathT = 0; } else { brain.noPathT += dt; }
    if(brain.mode === 'assault' && arrived &&
       (brain.noLosT > profile.siegeAfter || brain.noPathT > profile.siegeAfter * 2)){
      brain.mode = 'siege';
      brain.modeT = 0;
      if(hooks.onModeChange) hooks.onModeChange('siege');
    } else if(brain.mode === 'siege' && (anyLos || brain.modeT > 30)){
      brain.mode = 'assault';
      brain.modeT = 0;
      if(hooks.onModeChange) hooks.onModeChange('assault');
    }

    // attack tokens: only a few units shoot at once; the rest maneuver.
    const tokens = profile.strikeTokens > 0 ? profile.strikeTokens : (1 + Math.ceil(live.length / 4));
    const candidates = live.filter(u => u._ai.hadLos && u._ai.state !== 'flee');
    candidates.sort((a,b)=>{
      const sa = (a._ai.token ? -1.5 : 0) + Math.hypot(hero.x - a.x, hero.y - a.y) * 0.1;
      const sb = (b._ai.token ? -1.5 : 0) + Math.hypot(hero.x - b.x, hero.y - b.y) * 0.1;
      return sa - sb;
    });
    for(let i=0;i<live.length;i++) live[i]._ai.token = false;
    for(let i=0;i<Math.min(tokens, candidates.length);i++) candidates[i]._ai.token = true;

    for(const u of live) stepUnit(team, u, dt, hero, hooks, ctx, live);
  };

  return brain;
}
