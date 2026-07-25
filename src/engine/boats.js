// Wooden boats (rafts). "A boat is anything made of wood built on water": wood
// placed into open water does not sink — it becomes (or extends) a floating raft
// entity that rides the water surface, catches the weather wind (engine/wind.js)
// and can be rowed with oar strokes that burn hero energy (the same pool the
// Shift turbo drains). Propulsion is a provider registry so future upgrades
// (engines, sails) plug in without touching the float model.
//
// Rafts are entities, not tiles: the world grid keeps its water, the raft keeps
// sub-tile position and velocity, and the hero stands on it boss-style
// (collideHero). Planks are mined back into wood through the normal mining flow.
import { T, WORLD_H } from '../constants.js';
import { isReplaceableNaturalOpenTile, isSolidCollisionTile } from './material_physics.js';

(function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.MM = root.MM || {};

  const CFG = {
    DRAFT: 0.55,            // fraction of hull height below the waterline (wood floats)
    KEEL_CLEARANCE: 0.03,   // extra water under the submerged hull; rejects shoreline films
    FLOAT_SPRING: 3.4,      // 1/s pull toward the buoyancy rest height
    MAX_FLOAT_STEP: 0.5,    // vertical settle clamp per frame (no teleport pops)
    BOB_AMP: 0.05,          // cosmetic wave bob (render only)
    WATER_DRAG: 0.5,        // 1/s hull drag in water
    GROUND_DRAG: 9,         // 1/s when beached
    WIND_COUPLING: 0.30,    // accel toward wind speed — a raft catches the weather
    SAIL_MULT: 3.0,         // a raised sail multiplies wind thrust into a fuel-free drive
    ROW_IMPULSE: 2.4,       // tiles/s per energetic oar stroke
    ROW_WEAK_MULT: 0.3,     // stroke strength when the hero is out of energy
    ROW_ENERGY: 1.2,        // hero energy per stroke
    ROW_MAX_SPEED: 8,
    MAX_SPEED: 9.5,
    MAX_CELLS: 96,
    GRAV: 16,
    STICKY_DECK: 0.2,       // feet stay glued through this much wave-bob gap
    BOAT_BOUNCE: 0.36,      // restitution when two floating wooden hulls meet
    OBJECT_DRAG: 0.05,      // per entity hit: fish/debris sap a little hull speed
    MAX_BOATS: 512,         // hard persistence/runtime guard against entity floods
    MAX_PROPULSION_PROVIDERS: 32,
    MAX_ABS_X: 30000000
  };

  // Per-hull wood quality. A raft remembers the ONE wood it is built from; light
  // wood is excellent for boats — it floats higher (lower draft), catches the wind
  // harder, rows faster and has a higher top speed. Plain wood is the 1.0 baseline.
  // Any material not in this table falls back to WOOD (see boatQ + restore clamp),
  // which keeps the boat gate/quiver orthogonal to the arrow woods (hard/golden).
  const BOAT_QUALITY = {
    [T.WOOD]:       { speed:1.00, wind:1.00, row:1.00, draft:1.00 },
    [T.LIGHT_WOOD]: { speed:1.25, wind:1.25, row:1.20, draft:0.85 }
  };
  function boatQ(b){ return (b && BOAT_QUALITY[b.material]) || BOAT_QUALITY[T.WOOD]; }
  function boatWoodMaterial(m){ return BOAT_QUALITY[m] ? m : T.WOOD; }

  let boats = [];
  let nextId = 1;
  let heroBoatId = null;
  let lastCtx = null;
  let simT = 0;

  // Broad-phase buckets are deliberately much larger than a plank. Sparse
  // fleets then cost roughly O(boats), while crowded buckets still fall back
  // to testing every physically plausible pair.
  const BOAT_BROAD_PHASE_CELL = 16;
  const BOAT_BROAD_PHASE_PAD = 0.01;
  const BOAT_BROAD_PHASE_MIN = 32;
  const BOAT_BROAD_PHASE_MAX_DENSITY = 0.20;
  const BOAT_BROAD_PHASE_MAX_REFS_PER_BOAT = 4;
  let lastBroadPhaseMode = 'small';

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function key(dx,dy){ return dx+','+dy; }
  function isSolidTile(t){ return isSolidCollisionTile(t); }
  function getSafe(getTile,x,y){ try{ return typeof getTile==='function' ? getTile(x,y) : T.AIR; }catch(e){ return T.AIR; } }
  function boatMass(b){ return Math.max(1, b && b.cells ? b.cells.length : 1); }
  function minFloatDepthForHeight(h){ return Math.max(0.1, Math.max(1,h||1)*CFG.DRAFT + CFG.KEEL_CLEARANCE); }
  function boatRect(b){
    const bb=bounds(b);
    return {left:b.x+bb.minDx, right:b.x+bb.maxDx+1, top:b.y+bb.minDy, bottom:b.y+bb.maxDy+1};
  }
  function rectOverlap(a,b){
    const x=Math.min(a.right,b.right)-Math.max(a.left,b.left);
    const y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    return {x,y,hit:x>0 && y>0};
  }
  function boatBroadPhaseRange(rect){
    const pad=BOAT_BROAD_PHASE_PAD, cell=BOAT_BROAD_PHASE_CELL;
    return {
      minX:Math.floor((rect.left-pad)/cell),
      maxX:Math.floor((rect.right+pad)/cell),
      minY:Math.floor((rect.top-pad)/cell),
      maxY:Math.floor((rect.bottom+pad)/cell)
    };
  }
  function createBoatBroadPhase(){
    const ranges=new Array(boats.length);
    function visitRange(range,fn){
      for(let gx=range.minX; gx<=range.maxX; gx++){
        for(let gy=range.minY; gy<=range.maxY; gy++) fn(key(gx,gy));
      }
    }
    let fleetMinX=Infinity, fleetMaxX=-Infinity, fleetMinY=Infinity, fleetMaxY=-Infinity;
    let totalBucketRefs=0;
    for(let i=0;i<boats.length;i++){
      const range=boatBroadPhaseRange(boatRect(boats[i]));
      ranges[i]=range;
      totalBucketRefs+=(range.maxX-range.minX+1)*(range.maxY-range.minY+1);
      fleetMinX=Math.min(fleetMinX,range.minX);
      fleetMaxX=Math.max(fleetMaxX,range.maxX);
      fleetMinY=Math.min(fleetMinY,range.minY);
      fleetMaxY=Math.max(fleetMaxY,range.maxY);
    }
    // A few very wide hulls can own thousands of unique buckets while having
    // no possible contacts. Building one full fleet bitset per bucket then costs
    // more than the direct AABB pass, so reject that shape before any Maps or
    // typed arrays are allocated.
    if(totalBucketRefs>boats.length*BOAT_BROAD_PHASE_MAX_REFS_PER_BOAT){
      lastBroadPhaseMode='wide-fallback';
      return null;
    }
    // Avoid even constructing an index when the whole fleet is tightly packed.
    const fleetCells=(fleetMaxX-fleetMinX+1)*(fleetMaxY-fleetMinY+1);
    if(fleetCells<=boats.length/8){ lastBroadPhaseMode='dense-fallback'; return null; }

    // Estimate bucket density before allocating the bitset index. A packed
    // fleet has real quadratic contact work and is faster on the direct loop.
    const bucketCounts=new Map();
    for(const range of ranges){
      visitRange(range,k=>bucketCounts.set(k,(bucketCounts.get(k)||0)+1));
    }
    let pairRefs=0;
    for(const count of bucketCounts.values()) pairRefs+=count*(count-1)/2;
    const allPairs=boats.length*(boats.length-1)/2;
    // Over-counting hulls that span several buckets intentionally makes this
    // fallback conservative.
    if(pairRefs>=allPairs*BOAT_BROAD_PHASE_MAX_DENSITY){ lastBroadPhaseMode='dense-fallback'; return null; }

    const buckets=new Map();
    const nearby=[];
    const bitWords=Math.ceil(boats.length/32);
    function add(index,range){
      visitRange(range,k=>{
        let bucket=buckets.get(k);
        if(!bucket){ bucket={bits:new Uint32Array(bitWords),count:0}; buckets.set(k,bucket); }
        const word=index>>>5, mask=1<<(index&31);
        if((bucket.bits[word]&mask)!==0) return;
        bucket.bits[word]|=mask;
        bucket.count++;
      });
    }
    function remove(index,range){
      visitRange(range,k=>{
        const bucket=buckets.get(k);
        if(!bucket) return;
        const word=index>>>5, mask=1<<(index&31);
        if((bucket.bits[word]&mask)===0) return;
        bucket.bits[word]&=~mask;
        bucket.count--;
        if(!bucket.count) buckets.delete(k);
      });
    }
    function sameRange(a,b){
      return !!a && a.minX===b.minX && a.maxX===b.maxX && a.minY===b.minY && a.maxY===b.maxY;
    }
    function update(index,rect){
      const next=boatBroadPhaseRange(rect);
      const prev=ranges[index];
      if(sameRange(prev,next)) return;
      if(prev) remove(index,prev);
      ranges[index]=next;
      add(index,next);
    }
    function firstCandidate(rect,afterIndex){
      const range=boatBroadPhaseRange(rect);
      nearby.length=0;
      visitRange(range,k=>{
        const bucket=buckets.get(k);
        if(bucket) nearby.push(bucket);
      });
      const first=afterIndex+1;
      for(let word=first>>>5; word<bitWords; word++){
        let bits=0;
        for(const bucket of nearby) bits|=bucket.bits[word];
        if(word===(first>>>5)) bits&=(-1<<(first&31));
        if(bits!==0){
          const lowBit=bits&-bits;
          return (word<<5)+(31-Math.clz32(lowBit));
        }
      }
      return -1;
    }
    for(let i=0;i<boats.length;i++) add(i,ranges[i]);
    lastBroadPhaseMode='indexed';
    return {update,firstCandidate};
  }
  function canBoatFitAt(b,x,y,getTile){
    for(const c of b.cells){
      const minX=Math.floor(x+c.dx+0.001), maxX=Math.floor(x+c.dx+1-0.001);
      const minY=Math.floor(y+c.dy+0.001), maxY=Math.floor(y+c.dy+1-0.001);
      for(let ty=minY; ty<=maxY; ty++){
        for(let tx=minX; tx<=maxX; tx++){
          if(isSolidTile(getSafe(getTile,tx,ty))) return false;
        }
      }
    }
    return true;
  }

  function launchBoatFromSpring(b,springX,springY,getTile){
    const spring=root.MM && root.MM.springPlatforms;
    if(!spring || typeof spring.launchEntity!=='function') return false;
    return !!spring.launchEntity(b,springX,springY,getTile,{kind:'boat',forward:false});
  }
  function moveBoatUp(b,dt,getTile){
    if(!b || !(b.vy<0) || !(dt>0)) return false;
    let remaining=Math.min(3.5,-b.vy*dt);
    let moved=false;
    const tops=topCells(b);
    while(remaining>0){
      const step=Math.min(0.4,remaining);
      let blocked=false;
      for(const c of tops){
        const ty=Math.floor(b.y+c.dy-step);
        if(isSolidTile(getSafe(getTile,Math.floor(b.x+c.dx+0.5),ty))){
          blocked=true;
          break;
        }
      }
      if(blocked){ b.vy=0; break; }
      b.y-=step;
      b.grounded=false;
      remaining-=step;
      moved=true;
    }
    return moved;
  }

  function bounds(b){
    if(b._bounds) return b._bounds;
    let minDx=Infinity,maxDx=-Infinity,minDy=Infinity,maxDy=-Infinity;
    for(const c of b.cells){
      if(c.dx<minDx) minDx=c.dx;
      if(c.dx>maxDx) maxDx=c.dx;
      if(c.dy<minDy) minDy=c.dy;
      if(c.dy>maxDy) maxDy=c.dy;
    }
    b._bounds={minDx,maxDx,minDy,maxDy,w:maxDx-minDx+1,h:maxDy-minDy+1};
    return b._bounds;
  }
  function cellSet(b){
    if(!b._set){ b._set=new Set(b.cells.map(c=>key(c.dx,c.dy))); }
    return b._set;
  }
  function markDirty(b){ b._bounds=null; b._set=null; }
  function hasCell(b,dx,dy){ return cellSet(b).has(key(dx,dy)); }
  function topCells(b){ return b.cells.filter(c=>!hasCell(b,c.dx,c.dy-1)); }
  function bottomCells(b){ return b.cells.filter(c=>!hasCell(b,c.dx,c.dy+1)); }

  function makeBoat(tx,ty,material){
    return {id:nextId++, x:tx, y:ty, vx:0, vy:0, cells:[{dx:0,dy:0}],
      material:boatWoodMaterial(material), sail:false,
      grounded:false, inWater:false, bob:Math.random()*Math.PI*2,
      wakeT:0, rowFxT:0, rowFxDir:1, _bounds:null, _set:null};
  }

  function cellAt(px,py){
    for(const b of boats){
      const bb=bounds(b);
      if(px<b.x+bb.minDx || px>=b.x+bb.maxDx+1 || py<b.y+bb.minDy || py>=b.y+bb.maxDy+1) continue;
      for(const c of b.cells){
        if(px>=b.x+c.dx && px<b.x+c.dx+1 && py>=b.y+c.dy && py<b.y+c.dy+1) return {boat:b, cell:c};
      }
    }
    return null;
  }
  function boatAdjacentTo(tx,ty){
    for(const [ox,oy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const hit=cellAt(tx+ox+0.5,ty+oy+0.5);
      if(hit) return hit.boat;
    }
    return null;
  }

  function waterUnitsAt(getTile,water,tx,ty){
    if(getSafe(getTile,tx,ty)!==T.WATER) return 0;
    const U=(water && water.UNITS)||10;
    let lvl=U;
    if(water && typeof water.levelAt==='function'){
      const raw=Number(water.levelAt(tx,ty,getTile));
      if(!(raw>0)) return 0;
      lvl=raw;
    }
    return clamp(lvl,1,U);
  }
  function waterDepthFromTop(getTile,water,tx,topY,maxTiles){
    const U=(water && water.UNITS)||10;
    let depth=0;
    const lim=Math.max(1,maxTiles||8);
    for(let i=0;i<lim;i++){
      const y=topY+i;
      const units=waterUnitsAt(getTile,water,tx,y);
      if(units<=0) break;
      depth+=units/U;
    }
    return depth;
  }
  function waterTopForCell(getTile,tx,ty){
    if(getSafe(getTile,tx,ty)!==T.WATER) return null;
    let top=ty;
    for(let i=0;i<24 && getSafe(getTile,tx,top-1)===T.WATER;i++) top--;
    return top;
  }
  // Water surface (world tile row + sub-tile fill) at a column, scanning a small
  // vertical window around the hull. null = no open water in the window.
  // opts.minDepth rejects thin shoreline films that can visually look like water
  // but cannot carry the raft draft without embedding the hull in the ground.
  function surfaceYAt(getTile,water,tx,yFrom,yTo,opts){
    const minDepth=(opts && Number.isFinite(opts.minDepth)) ? Math.max(0,opts.minDepth) : 0;
    for(let y=yFrom; y<=yTo; y++){
      const t=getSafe(getTile,tx,y);
      if(t===T.WATER){
        const U=(water && water.UNITS)||10;
        const lvl=waterUnitsAt(getTile,water,tx,y);
        if(lvl<=0) continue;
        if(minDepth>0 && waterDepthFromTop(getTile,water,tx,y,8)+1e-6<minDepth) return null;
        return y + 1 - clamp(lvl,1,U)/U;
      }
      if(isSolidTile(t)) return null;
    }
    return null;
  }
  function buildWaterAt(tx,ty,getTile,opts){
    opts=opts||{};
    const water=opts.water;
    const t=getSafe(getTile,tx,ty);
    let sampleY=null;
    if(t===T.WATER) sampleY=ty;
    else if(t===T.AIR && getSafe(getTile,tx,ty+1)===T.WATER && !opts.hasSupport) sampleY=ty+1;
    if(sampleY==null) return null;
    const top=waterTopForCell(getTile,tx,sampleY);
    if(top==null) return null;
    const minDepth=minFloatDepthForHeight(1);
    const surface=surfaceYAt(getTile,water,tx,top,top,{minDepth});
    if(surface==null) return null;
    return {surface, top, depth:waterDepthFromTop(getTile,water,tx,top,8)};
  }

  // ---------------- Propulsion registry ----------------
  // Providers return a horizontal acceleration (tiles/s²) for a boat this frame.
  // Future engines/sails register here; oar strokes are impulses via row().
  const propulsion=[];
  function registerPropulsion(p){
    if(!p || typeof p.thrust!=='function' || typeof p.id!=='string' || !p.id.length || p.id.length>64) return false;
    const at=propulsion.findIndex(q=>q.id===p.id);
    if(at>=0) propulsion[at]=p;
    else {
      if(propulsion.length>=CFG.MAX_PROPULSION_PROVIDERS) return false;
      propulsion.push(p);
    }
    return true;
  }
  registerPropulsion({
    id:'wind',
    thrust(b,c){
      if(!b.inWater || b.grounded || !c.wind || typeof c.wind.speedAt!=='function') return 0;
      const bb=bounds(b);
      const cx=Math.floor(b.x+(bb.minDx+bb.maxDx)/2+0.5);
      const deckY=Math.floor(b.y+bb.minDy);
      const w=c.wind.speedAt(cx,deckY,c.getTile);
      // Wider rafts present more freeboard to the wind; light-wood hulls catch it
      // harder (boatQ.wind).
      const sail=0.75+0.25*Math.min(1,bb.w/6);
      return (w-b.vx)*CFG.WIND_COUPLING*sail*boatQ(b).wind*(b.sail?CFG.SAIL_MULT:1);
    }
  });

  function resolveBoatBoatCollisions(b,getTile,boatIndex,broadPhase){
    let a=boatRect(b);
    let afterIndex=Math.max(-1,boatIndex|0);
    // Every plausible pair is resolved once and in the same index order as the
    // former all-pairs loop. Re-query after each collision because separation
    // can move this hull into a candidate bucket that it did not occupy before.
    while(afterIndex<boats.length-1){
      const i=broadPhase ? broadPhase.firstCandidate(a,afterIndex) : afterIndex+1;
      if(i<0) break;
      afterIndex=i;
      const other=boats[i];
      const o=boatRect(other);
      const ov=rectOverlap(a,o);
      if(!ov.hit) continue;
      if(ov.x<=ov.y+0.05){
        const normal=((a.left+a.right)*0.5 < (o.left+o.right)*0.5) ? -1 : 1;
        const sep=ov.x+0.002;
        const mb=boatMass(b), mo=boatMass(other), total=mb+mo;
        const bx=b.x+normal*sep*(mo/total);
        const ox=other.x-normal*sep*(mb/total);
        let moved=false;
        if(canBoatFitAt(b,bx,b.y,getTile)){ b.x=bx; moved=true; }
        if(canBoatFitAt(other,ox,other.y,getTile)){ other.x=ox; moved=true; }
        const relNorm=(b.vx-other.vx)*normal;
        if(relNorm<0){
          const impulse=-(1+CFG.BOAT_BOUNCE)*relNorm/(1/mb+1/mo);
          b.vx+=normal*impulse/mb;
          other.vx-=normal*impulse/mo;
        } else {
          b.vx*=0.94;
          other.vx*=0.96;
        }
        if(!moved){ b.vx=0; other.vx=0; }
        a=boatRect(b);
      } else {
        const normal=((a.top+a.bottom)*0.5 < (o.top+o.bottom)*0.5) ? -1 : 1;
        const sep=ov.y+0.002;
        const mb=boatMass(b), mo=boatMass(other), total=mb+mo;
        const by=b.y+normal*sep*(mo/total);
        const oy=other.y-normal*sep*(mb/total);
        if(canBoatFitAt(b,b.x,by,getTile)) b.y=by;
        if(canBoatFitAt(other,other.x,oy,getTile)) other.y=oy;
        b.vy=0;
        other.vy=0;
        a=boatRect(b);
      }
      if(broadPhase){
        broadPhase.update(boatIndex,a);
        broadPhase.update(i,boatRect(other));
      }
    }
  }

  function collideExternalObjects(b,dt,getTile,ctx){
    let dragLoad=0;
    if(ctx && ctx.mobs && typeof ctx.mobs.collideBoat==='function'){
      const res=ctx.mobs.collideBoat({
        id:b.id,
        x:b.x, y:b.y, vx:b.vx, vy:b.vy,
        // collideBoat treats hull cells as read-only; sharing the stable array
        // avoids cloning every plank of every raft on every simulation frame.
        cells:b.cells
      }, bounds(b), dt, {getTile});
      if(res){
        if(Number.isFinite(res.drag)) dragLoad+=res.drag;
        else if(Number.isFinite(res.blockers)) dragLoad+=res.blockers;
        else if(Number.isFinite(res.hits)) dragLoad+=res.hits;
      }
    }
    if(dragLoad>0 && Math.abs(b.vx)>0.01){
      b.vx*=Math.max(0.62, 1-Math.min(8,dragLoad)*CFG.OBJECT_DRAG);
    }
  }

  // ---------------- Simulation ----------------
  function updateBoat(b,dt,getTile,ctx){
    const bb=bounds(b);
    const water=ctx && ctx.water;
    // Buoyancy: average open-water surface across hull columns
    let surfSum=0, surfN=0;
    const yFrom=Math.floor(b.y+bb.minDy)-2;
    const yTo=Math.floor(b.y+bb.maxDy)+3;
    const minDepth=minFloatDepthForHeight(bb.h);
    const surfOpts={minDepth};
    for(let dx=bb.minDx; dx<=bb.maxDx; dx++){
      const s=surfaceYAt(getTile,water,Math.floor(b.x+dx+0.5),yFrom,yTo,surfOpts);
      if(s!=null){ surfSum+=s; surfN++; }
    }
    if(surfN>0){
      b.inWater=true;
      b.grounded=false;
      b.vy=0;
      const surface=surfSum/surfN;
      const targetY=surface + bb.h*CFG.DRAFT*boatQ(b).draft - (bb.maxDy+1);
      let dy=(targetY-b.y)*Math.min(1,dt*CFG.FLOAT_SPRING);
      dy=clamp(dy,-CFG.MAX_FLOAT_STEP,CFG.MAX_FLOAT_STEP);
      if(dy<0){
        // rising: stop against a ceiling instead of embedding the deck in rock
        for(const c of topCells(b)){
          const ty=Math.floor(b.y+c.dy+dy);
          if(isSolidTile(getSafe(getTile,Math.floor(b.x+c.dx+0.5),ty))){ dy=0; break; }
        }
      }
      b.y+=dy;
    } else {
      // No water under the hull: the raft is cargo — fall until it rests
      b.inWater=false;
      b.vy=clamp(b.vy+CFG.GRAV*dt,-38,18);
      if(b.vy<0){
        moveBoatUp(b,dt,getTile);
      }else{
        let remaining=b.vy*dt;
        const bottoms=bottomCells(b);
        while(remaining>0){
          const step=Math.min(0.4,remaining);
          remaining-=step;
          let blocked=false, launched=false;
          for(const c of bottoms){
            const tx=Math.floor(b.x+c.dx+0.5);
            const ty=Math.floor(b.y+c.dy+1+step);
            const t=getSafe(getTile,tx,ty);
            if(isSolidTile(t)){
              b.y=ty-(c.dy+1)-0.001;
              if(t===T.SPRING_PLATFORM && launchBoatFromSpring(b,tx,ty,getTile)) launched=true;
              else blocked=true;
              break;
            }
          }
          if(launched){ b.grounded=false; break; }
          if(blocked){ b.vy=0; b.grounded=true; break; }
          b.y+=step;
          b.grounded=false;
        }
      }
    }
    // Horizontal: propulsion providers, drag, clamp
    let accel=0;
    const pctx={dt, getTile, wind:ctx && ctx.wind, water, inWater:b.inWater, grounded:b.grounded};
    for(const p of propulsion){
      let a=0;
      try{ a=p.thrust(b,pctx); }catch(e){ a=0; }
      if(Number.isFinite(a)) accel+=a;
    }
    b.vx+=accel*dt;
    b.vx-=b.vx*Math.min(1,(b.grounded?CFG.GROUND_DRAG:(b.inWater?CFG.WATER_DRAG:0.05))*dt);
    const maxV=CFG.MAX_SPEED*boatQ(b).speed;
    b.vx=clamp(b.vx,-maxV,maxV);
    if(Math.abs(b.vx)<0.004) b.vx=0;
    // Horizontal move against terrain (leading-edge tile check per cell)
    if(b.vx!==0){
      let nx=b.x+b.vx*dt;
      const dir=b.vx>0?1:-1;
      if(b.inWater && !b.grounded){
        for(const c of bottomCells(b)){
          const edgeX=dir>0 ? nx+c.dx+1-1e-4 : nx+c.dx+1e-4;
          const tx=Math.floor(edgeX);
          const lane=surfaceYAt(getTile,water,tx,yFrom,yTo,surfOpts);
          if(lane!=null) continue;
          nx = dir>0 ? Math.min(nx, tx-(c.dx+1)-0.001) : Math.max(nx, tx+1-c.dx+0.001);
          b.vx=0;
          break;
        }
      }
      for(const c of b.cells){
        const edgeX=dir>0 ? nx+c.dx+1-1e-4 : nx+c.dx+1e-4;
        const tx=Math.floor(edgeX);
        const y0=Math.floor(b.y+c.dy+0.06), y1=Math.floor(b.y+c.dy+0.94);
        for(let ty=y0; ty<=y1; ty++){
          if(!isSolidTile(getSafe(getTile,tx,ty))) continue;
          nx = dir>0 ? Math.min(nx, tx-(c.dx+1)-0.001) : Math.max(nx, tx+1-c.dx+0.001);
          b.vx=0;
        }
      }
      b.x=nx;
    }
    collideExternalObjects(b,dt,getTile,ctx||{});
    // Bow wake couples into the surface springs so motion reads in the water
    if(b.inWater && Math.abs(b.vx)>0.8 && water && water.disturb){
      b.wakeT-=dt;
      if(b.wakeT<=0){
        b.wakeT=0.11;
        const bowDx=b.vx>0?bb.maxDx:bb.minDx;
        water.disturb(Math.floor(b.x+bowDx+0.5+(b.vx>0?1:-1)), Math.abs(b.vx)*9);
      }
    }
    if(b.rowFxT>0) b.rowFxT=Math.max(0,b.rowFxT-dt);
  }

  function update(dt,player,getTile,ctx){
    if(!(dt>0) || !isFinite(dt)) return;
    dt=Math.min(0.1,dt);
    simT+=dt;
    lastCtx=ctx||lastCtx;
    for(let i=0;i<boats.length;i++) updateBoat(boats[i],dt,getTile,(ctx||{}));
    // Resolve on the final positions for this frame. Doing this inside each
    // boat's movement let a later boat move back into an already-resolved hull.
    if(boats.length>1){
      if(boats.length<BOAT_BROAD_PHASE_MIN) lastBroadPhaseMode='small';
      const broadPhase=boats.length>=BOAT_BROAD_PHASE_MIN ? createBoatBroadPhase() : null;
      for(let i=0;i<boats.length;i++) resolveBoatBoatCollisions(boats[i],getTile,i,broadPhase);
    } else lastBroadPhaseMode='small';
  }

  // ---------------- Hero coupling (boss-style rigid platform) ----------------
  function heroStandingBoat(p){
    if(!p || !isFinite(p.x) || !isFinite(p.y)) return null;
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    for(const b of boats){
      const bb=bounds(b);
      if(p.x+hw<=b.x+bb.minDx || p.x-hw>=b.x+bb.maxDx+1) continue;
      if(!(p.y+hh<=b.y+bb.minDy || p.y-hh>=b.y+bb.maxDy+1)){
        let best=null,bx=0,by=0,bestOv=0;
        for(const c of b.cells){
          const cx=b.x+c.dx, cy=b.y+c.dy;
          const ox=Math.min(cx+1,p.x+hw)-Math.max(cx,p.x-hw);
          const oy=Math.min(cy+1,p.y+hh)-Math.max(cy,p.y-hh);
          if(ox<=0||oy<=0) continue;
          const ov=ox*oy;
          if(ov>bestOv){ bestOv=ov; best=c; bx=ox; by=oy; }
        }
        if(best){
          const cy=b.y+best.dy;
          if(by<=bx && p.y<cy+0.5) return b;
        }
      }
      if((p.vy||0)>=-0.01){
        for(const c of topCells(b)){
          const cx=b.x+c.dx, cy=b.y+c.dy;
          if(p.x+hw<=cx+0.04 || p.x-hw>=cx+0.96) continue;
          const gap=cy-(p.y+hh);
          if(gap>=-0.02 && gap<=CFG.STICKY_DECK) return b;
        }
      }
    }
    return null;
  }
  function heroOnBoat(p){ return heroStandingBoat(p); }
  function heroTouchingBoat(p,opts){
    if(!p || !isFinite(p.x) || !isFinite(p.y)) return null;
    opts=opts||{};
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    const pad=Number.isFinite(opts.pad) ? Math.max(0,opts.pad) : 0.16;
    const topPad=Number.isFinite(opts.topPad) ? Math.max(0,opts.topPad) : 0.08;
    const bottomPad=Number.isFinite(opts.bottomPad) ? Math.max(0,opts.bottomPad) : 0.22;
    const pr={left:p.x-hw-pad,right:p.x+hw+pad,top:p.y-hh-topPad,bottom:p.y+hh+bottomPad};
    let best=null, bestD=Infinity;
    for(const b of boats){
      if(opts.floating && (!b.inWater || b.grounded)) continue;
      const br=boatRect(b);
      if(pr.right<=br.left || pr.left>=br.right || pr.bottom<=br.top || pr.top>=br.bottom) continue;
      const bx=clamp(p.x,br.left,br.right);
      const by=clamp(p.y,br.top,br.bottom);
      const d=(p.x-bx)*(p.x-bx)+(p.y-by)*(p.y-by);
      if(d<bestD){ bestD=d; best=b; }
    }
    return best;
  }
  function heroFitsAt(p,x,y,getTile){
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    const xs=[x-hw+0.06,x,x+hw-0.06];
    const y0=Math.floor(y-hh+0.06);
    const y1=Math.floor(y+hh-0.06);
    for(const sx of xs){
      const tx=Math.floor(sx);
      for(let ty=y0; ty<=y1; ty++){
        if(isSolidTile(getSafe(getTile,tx,ty))) return false;
      }
    }
    return true;
  }
  function boardHeroFromWater(p,opts){
    if(!p || !isFinite(p.x) || !isFinite(p.y)) return {ok:false, reason:'bad-hero'};
    opts=opts||{};
    const b=heroTouchingBoat(p,{floating:true,pad:opts.pad,topPad:opts.topPad,bottomPad:opts.bottomPad});
    if(!b) return {ok:false, reason:'no-boat'};
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    let best=null, bestScore=Infinity;
    for(const c of topCells(b)){
      const left=b.x+c.dx;
      const right=left+1;
      const tx=clamp(p.x,left+hw+0.025,right-hw-0.025);
      const deckY=b.y+c.dy;
      const footY=p.y+hh;
      const score=Math.abs(tx-p.x)+Math.max(0,deckY-footY)*0.3+Math.abs(deckY-footY)*0.08;
      if(score<bestScore){ bestScore=score; best={x:tx,y:deckY-hh-0.001,boat:b}; }
    }
    if(!best) return {ok:false, reason:'no-deck'};
    if(!heroFitsAt(p,best.x,best.y,opts.getTile)) return {ok:false, reason:'blocked'};
    p.x=best.x;
    p.y=best.y;
    p.vx=(p.vx||0)*0.35 + (b.vx||0)*0.65;
    p.vy=0;
    p.onGround=true;
    if(typeof p.jumpCount==='number') p.jumpCount=0;
    heroBoatId=b.id;
    return {ok:true, boat:b};
  }

  function collideHero(p,dt){
    if(!p || !isFinite(p.x) || !isFinite(p.y)) return false;
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    let standing=null;
    for(const b of boats){
      const bb=bounds(b);
      if(p.x+hw<=b.x+bb.minDx || p.x-hw>=b.x+bb.maxDx+1) continue;
      if(p.y+hh<=b.y+bb.minDy || p.y-hh>=b.y+bb.maxDy+1) continue;
      let best=null,bx=0,by=0,bestOv=0;
      for(const c of b.cells){
        const cx=b.x+c.dx, cy=b.y+c.dy;
        const ox=Math.min(cx+1,p.x+hw)-Math.max(cx,p.x-hw);
        const oy=Math.min(cy+1,p.y+hh)-Math.max(cy,p.y-hh);
        if(ox<=0||oy<=0) continue;
        const ov=ox*oy;
        if(ov>bestOv){ bestOv=ov; best=c; bx=ox; by=oy; }
      }
      if(!best) continue;
      const cx=b.x+best.dx, cy=b.y+best.dy;
      if(by<=bx && p.y<cy+0.5){
        // feet on deck: stand, ride the raft's drift
        p.y=cy-hh-0.001;
        if((p.vy||0)>0) p.vy=0;
        p.onGround=true; if(typeof p.jumpCount==='number') p.jumpCount=0;
        if(dt) p.x+=b.vx*dt;
        standing=b;
      } else if(by<=bx){
        p.y=cy+1+hh+0.001; if((p.vy||0)<0) p.vy=0;   // bumped the hull from below
      } else if(p.x<cx+0.5){
        p.x=cx-hw-0.001; if((p.vx||0)>0) p.vx=0;
        if(b.vx<0) p.vx=Math.min(p.vx||0,b.vx);
      } else {
        p.x=cx+1+hw+0.001; if((p.vx||0)<0) p.vx=0;
        if(b.vx>0) p.vx=Math.max(p.vx||0,b.vx);
      }
    }
    if(!standing && (p.vy||0)>=-0.01){
      // sticky deck: wave bob must not flicker onGround while riding
      outer: for(const b of boats){
        for(const c of topCells(b)){
          const cx=b.x+c.dx, cy=b.y+c.dy;
          if(p.x+hw<=cx+0.04 || p.x-hw>=cx+0.96) continue;
          const gap=cy-(p.y+hh);
          if(gap>=-0.02 && gap<=CFG.STICKY_DECK){
            p.y=cy-hh-0.001;
            p.vy=0;
            p.onGround=true; if(typeof p.jumpCount==='number') p.jumpCount=0;
            if(dt) p.x+=b.vx*dt;
            standing=b;
            break outer;
          }
        }
      }
    }
    heroBoatId=standing?standing.id:null;
    return !!standing;
  }
  function heroBoat(){
    if(heroBoatId==null) return null;
    return boats.find(b=>b.id===heroBoatId)||null;
  }

  // ---------------- Rowing ----------------
  // One oar stroke per key tap: an energetic stroke burns hero energy; with an
  // empty pool the stroke still lands, just far weaker — you limp to shore.
  function row(dir,opts){
    dir=dir<0?-1:1;
    opts=opts||{};
    const b=(opts.player ? heroOnBoat(opts.player) : null) || heroBoat();
    if(!b) return {ok:false, reason:'no-boat'};
    if(!b.inWater || b.grounded) return {ok:false, reason:'aground'};
    const energy=opts.heroEnergy || (root.MM && root.MM.heroEnergy);
    const strong=opts.godMode ? true : !!(energy && energy.spend && energy.spend(CFG.ROW_ENERGY));
    const q=boatQ(b);
    b.vx=clamp(b.vx + dir*CFG.ROW_IMPULSE*q.row*(strong?1:CFG.ROW_WEAK_MULT), -CFG.ROW_MAX_SPEED*q.speed, CFG.ROW_MAX_SPEED*q.speed);
    b.rowFxT=0.18;
    b.rowFxDir=dir;
    const water=lastCtx && lastCtx.water;
    if(water && water.disturb){
      const bb=bounds(b);
      water.disturb(Math.floor(b.x+(dir>0?bb.minDx:bb.maxDx)+0.5), 30*dir*(strong?1:0.4));
    }
    return {ok:true, strong};
  }

  // ---------------- Building & breaking ----------------
  // 'extend' = plank glued to an existing raft; 'boat' = fresh raft on/in open
  // water. Air cells with water below only float when nothing solid would carry
  // a normal build — wood against a dock keeps behaving like a tile.
  function placementMode(tx,ty,getTile,opts){
    if(!Number.isFinite(tx)||!Number.isFinite(ty)) return null;
    if(cellAt(tx+0.5,ty+0.5)) return null;
    const t=getSafe(getTile,tx,ty);
    if(!isReplaceableNaturalOpenTile(t)) return null;
    const waterHere=buildWaterAt(tx,ty,getTile,opts);
    if(!waterHere) return null;
    if(boatAdjacentTo(tx,ty)) return 'extend';
    if(t===T.WATER) return 'boat';
    if(t===T.AIR && getSafe(getTile,tx,ty+1)===T.WATER && !(opts && opts.hasSupport)) return 'boat';
    return null;
  }
  function placeWood(tx,ty,getTile,opts){
    const mode=placementMode(tx,ty,getTile,opts);
    if(!mode) return {ok:false};
    if(mode==='extend'){
      const b=boatAdjacentTo(tx,ty);
      if(!b) return {ok:false};
      // A hull stays ONE wood so it drops cleanly and carries one quality: you can
      // only extend a raft with the same wood it is already built from.
      if(b.material!==boatWoodMaterial(opts && opts.material)) return {ok:false, reason:'Inny rodzaj drewna — nie łączy się z tą tratwą'};
      if(b.cells.length>=CFG.MAX_CELLS) return {ok:false, reason:'Łódź jest już ogromna'};
      const dx=Math.round(tx-b.x), dy=Math.round(ty-b.y);
      if(hasCell(b,dx,dy)) return {ok:false};
      b.cells.push({dx,dy});
      markDirty(b);
      return {ok:true, boat:b, extended:true};
    }
    if(boats.length>=CFG.MAX_BOATS) return {ok:false, reason:'Za duzo lodzi w swiecie'};
    const waterHere=buildWaterAt(tx,ty,getTile,opts);
    if(!waterHere) return {ok:false, reason:'Za plytko na lodke'};
    const b=makeBoat(tx,waterHere.surface + CFG.DRAFT - 1, opts && opts.material);
    b.inWater=true;
    boats.push(b);
    return {ok:true, boat:b, created:true};
  }
  // Remove the plank at a world point; a split hull becomes separate rafts.
  function connectedCellGroups(cells){
    if(!cells.length) return [];
    const byKey=new Map(cells.map(c=>[key(c.dx,c.dy),c]));
    const unseen=new Set(byKey.keys());
    const groups=[];
    while(unseen.size){
      const first=unseen.values().next().value;
      unseen.delete(first);
      const stack=[byKey.get(first)], group=[];
      while(stack.length){
        const c=stack.pop();
        group.push(c);
        for(const [ox,oy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const k=key(c.dx+ox,c.dy+oy);
          if(!unseen.delete(k)) continue;
          stack.push(byKey.get(k));
        }
      }
      groups.push(group);
    }
    return groups;
  }
  function removeCellAt(px,py){
    const hit=cellAt(px,py);
    if(!hit) return null;
    const b=hit.boat;
    b.cells=b.cells.filter(c=>c!==hit.cell);
    markDirty(b);
    if(!b.cells.length){
      boats=boats.filter(x=>x!==b);
      if(heroBoatId===b.id) heroBoatId=null;
      return {drop: b.material===T.LIGHT_WOOD?'lightWood':'wood'};
    }
    // An articulation plank can split a hull into more than two components.
    // Preserve every component while keeping the entity-count guard intact.
    const groups=connectedCellGroups(b.cells);
    if(groups.length>1){
      b.cells=groups[0];
      markDirty(b);
      for(let i=1;i<groups.length;i++){
        if(boats.length>=CFG.MAX_BOATS){
          // This is only a representation fallback: no plank is duplicated or
          // lost, and a later removal can split it once capacity is available.
          b.cells.push(...groups[i]);
          markDirty(b);
          continue;
        }
        const nb=makeBoat(b.x,b.y,b.material);
        nb.cells=groups[i].map(c=>({dx:c.dx,dy:c.dy}));
        nb.vx=b.vx;
        nb.vy=b.vy;
        nb.inWater=b.inWater;
        nb.grounded=b.grounded;
        nb.sail=b.sail;   // a split fragment of a rigged raft keeps its sail up
        markDirty(nb);
        boats.push(nb);
      }
    }
    return {drop: b.material===T.LIGHT_WOOD?'lightWood':'wood'};
  }

  // ---------------- Rendering ----------------
  function bobOffset(b){
    return b.inWater ? Math.sin(simT*2.1+b.bob)*CFG.BOB_AMP : 0;
  }
  function draw(ctx2,TILE,visible){
    if(!ctx2 || !boats.length) return;
    for(const b of boats){
      const yOff=bobOffset(b);
      for(const c of b.cells){
        const tx=Math.floor(b.x+c.dx), ty=Math.floor(b.y+c.dy);
        if(visible && !visible(tx,ty)) continue;
        const px=(b.x+c.dx)*TILE, py=(b.y+c.dy+yOff)*TILE;
        ctx2.fillStyle=(b.material===T.LIGHT_WOOD)?'#d9c9a3':'#8b5a2b';
        ctx2.fillRect(px,py,TILE,TILE);
        ctx2.fillStyle='rgba(0,0,0,0.22)';
        ctx2.fillRect(px,py+TILE*0.62,TILE,TILE*0.38);   // wet lower hull
        ctx2.strokeStyle='#5f3d1c';
        ctx2.lineWidth=Math.max(1,TILE*0.06);
        ctx2.strokeRect(px+0.5,py+0.5,TILE-1,TILE-1);
        ctx2.strokeStyle='rgba(63,40,17,0.55)';
        ctx2.lineWidth=1;
        ctx2.beginPath();
        ctx2.moveTo(px,py+TILE*0.34); ctx2.lineTo(px+TILE,py+TILE*0.34);
        ctx2.moveTo(px,py+TILE*0.66); ctx2.lineTo(px+TILE,py+TILE*0.66);
        ctx2.stroke();
        if(!hasCell(b,c.dx,c.dy-1)){
          ctx2.fillStyle='rgba(255,225,170,0.30)';       // sun-bleached deck line
          ctx2.fillRect(px,py,TILE,Math.max(1,TILE*0.12));
        }
      }
      if(b.sail){
        // A raised sail: a mast on the top-centre cell and a canvas that billows
        // toward the raft's heading (fuller the faster it runs).
        const sb=bounds(b);
        const cx=(b.x+(sb.minDx+sb.maxDx)/2+0.5)*TILE;
        const baseY=(b.y+sb.minDy+yOff)*TILE;
        const mastH=TILE*1.7, topY=baseY-mastH;
        ctx2.strokeStyle='#6b4a24'; ctx2.lineWidth=Math.max(1.5,TILE*0.09);
        ctx2.beginPath(); ctx2.moveTo(cx,baseY); ctx2.lineTo(cx,topY); ctx2.stroke();
        const dir=b.vx<-0.02?-1:1;
        const bell=TILE*(0.45+Math.min(0.55, Math.abs(b.vx)/(CFG.MAX_SPEED||9.5)*0.7));
        ctx2.fillStyle='rgba(245,238,220,0.92)';
        ctx2.beginPath();
        ctx2.moveTo(cx,topY+TILE*0.12);
        ctx2.quadraticCurveTo(cx+dir*bell, baseY-mastH*0.5, cx+dir*TILE*0.12, baseY-TILE*0.18);
        ctx2.lineTo(cx,baseY-TILE*0.18);
        ctx2.closePath(); ctx2.fill();
        ctx2.strokeStyle='rgba(120,100,70,0.5)'; ctx2.lineWidth=1; ctx2.stroke();
      }
      if(b.rowFxT>0){
        // oar splash streak on the stroke side
        const bb=bounds(b);
        const sideDx=b.rowFxDir>0?bb.minDx:bb.maxDx+1;
        const sx=(b.x+sideDx)*TILE, sy=(b.y+bb.maxDy+0.75+yOff)*TILE;
        ctx2.strokeStyle='rgba(210,236,255,'+(b.rowFxT*3.2).toFixed(2)+')';
        ctx2.lineWidth=Math.max(1,TILE*0.09);
        ctx2.beginPath();
        ctx2.moveTo(sx,sy);
        ctx2.lineTo(sx-b.rowFxDir*TILE*0.7,sy+TILE*0.22);
        ctx2.stroke();
      }
    }
  }

  // ---------------- Persistence ----------------
  function reset(){ boats=[]; heroBoatId=null; nextId=1; simT=0; lastBroadPhaseMode='small'; }
  function snapshot(){
    if(!boats.length) return null;
    const saved=[];
    let processed=0;
    for(const b of boats){
      if(processed++>=CFG.MAX_BOATS || saved.length>=CFG.MAX_BOATS) break;
      if(!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || Math.abs(b.x)>CFG.MAX_ABS_X
        || b.y < -WORLD_H || b.y > WORLD_H*2) continue;
      const cells=[];
      let cellRecords=0;
      for(const c of Array.isArray(b.cells)?b.cells:[]){
        if(cellRecords++>=CFG.MAX_CELLS || cells.length>=CFG.MAX_CELLS) break;
        if(!c || !Number.isSafeInteger(c.dx) || !Number.isSafeInteger(c.dy)) continue;
        if(Math.abs(c.dx)>=CFG.MAX_CELLS || Math.abs(c.dy)>=CFG.MAX_CELLS) continue;
        cells.push([c.dx,c.dy]);
      }
      if(!cells.length) continue;
      // Clamp to the hull's OWN top speed (light wood cruises above base MAX_SPEED)
      // so a save/stream round-trip never shaves a fast light-wood raft's velocity.
      const vcap=CFG.MAX_SPEED*boatQ(b).speed;
      const record={
        x:+b.x.toFixed(3), y:+b.y.toFixed(3),
        vx:Number.isFinite(b.vx)?+clamp(b.vx,-vcap,vcap).toFixed(3):0,
        cells
      };
      // Only non-default hulls carry a material, so plain-wood save records stay
      // byte-identical to the pre-material format (pin-safe).
      if(b.material && b.material!==T.WOOD) record.material=b.material;
      if(b.sail) record.sail=1;
      if(connectedCellGroups(cells.map(c=>({dx:c[0],dy:c[1]}))).length>1) record.disconnected=1;
      saved.push(record);
    }
    return saved.length ? {v:1,boats:saved} : null;
  }
  function restore(data){
    reset();
    if(!data || typeof data!=='object' || !Array.isArray(data.boats)) return false;
    for(const s of data.boats.slice(0,CFG.MAX_BOATS)){
      if(!s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || Math.abs(s.x)>CFG.MAX_ABS_X
        || s.y < -WORLD_H || s.y > WORLD_H*2 || !Array.isArray(s.cells) || !s.cells.length) continue;
      const seen=new Set();
      const cells=[];
      for(const c of s.cells.slice(0,CFG.MAX_CELLS)){
        if(!Array.isArray(c) || !Number.isSafeInteger(c[0]) || !Number.isSafeInteger(c[1])) continue;
        if(Math.abs(c[0])>=CFG.MAX_CELLS || Math.abs(c[1])>=CFG.MAX_CELLS) continue;
        const k=key(c[0],c[1]);
        if(seen.has(k)) continue;
        seen.add(k);
        cells.push({dx:c[0],dy:c[1]});
      }
      const groups=s.disconnected===1 && cells.length ? [cells] : connectedCellGroups(cells);
      for(const group of groups){
        if(boats.length>=CFG.MAX_BOATS) break;
        // makeBoat -> boatWoodMaterial whitelist-clamps s.material: hostile saves
        // feeding Infinity/NaN/garbage fall back to plain WOOD, never an unknown key.
        const b=makeBoat(s.x,s.y,s.material);
        // boatQ read AFTER makeBoat resolves the (clamped) material, so a garbage
        // material falls back to WOOD's 1.0 cap; matches the live physics cap.
        const vcap=CFG.MAX_SPEED*boatQ(b).speed;
        b.vx=Number.isFinite(s.vx)?clamp(s.vx,-vcap,vcap):0;
        b.sail=!!s.sail;
        b.cells=group;
        markDirty(b);
        boats.push(b);
      }
    }
    return true;
  }
  function metrics(){
    let cells=0;
    for(const b of boats) cells+=b.cells.length;
    const hb=heroBoat();
    return {
      boats:boats.length,
      cells,
      heroAboard:!!hb,
      hero:hb?{id:hb.id,x:+hb.x.toFixed(2),y:+hb.y.toFixed(2),vx:+hb.vx.toFixed(3),inWater:hb.inWater,grounded:hb.grounded,cells:hb.cells.length}:null,
      propulsion:propulsion.map(p=>p.id)
    };
  }

  // Raise/lower the sail on the hero's current raft. A raised sail turns the
  // ambient weather wind into a strong fuel-free drive (CFG.SAIL_MULT) — no oar
  // energy needed while the wind blows your way; drop it for precise oar control.
  function raiseSail(on, opts){
    const b=(opts && opts.player ? heroOnBoat(opts.player) : null) || heroBoat();
    if(!b) return {ok:false, reason:'no-boat'};
    const next=!!on;
    if(b.sail===next) return {ok:false, reason:'no-change', sail:b.sail};
    b.sail=next;
    return {ok:true, sail:b.sail};
  }

  const api={
    update, draw, collideHero, heroBoat, heroOnBoat, heroTouchingBoat, boardHeroFromWater, row, raiseSail,
    placementMode, placeWood, removeCellAt, cellAt, boatAdjacentTo,
    registerPropulsion,
    snapshot, restore, reset, metrics,
    config:CFG,
    _debug:{boats:()=>boats, bounds, surfaceYAt, topCells, bottomCells, broadPhaseMode:()=>lastBroadPhaseMode}
  };
  root.MM.boats=api;
})();

export const boats = (typeof window !== 'undefined' && window.MM) ? window.MM.boats : globalThis.MM && globalThis.MM.boats;
export default boats;
