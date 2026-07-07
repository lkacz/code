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
import { T } from '../constants.js';
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
    ROW_IMPULSE: 2.4,       // tiles/s per energetic oar stroke
    ROW_WEAK_MULT: 0.3,     // stroke strength when the hero is out of energy
    ROW_ENERGY: 1.2,        // hero energy per stroke
    ROW_MAX_SPEED: 8,
    MAX_SPEED: 9.5,
    MAX_CELLS: 96,
    GRAV: 16,
    STICKY_DECK: 0.2,       // feet stay glued through this much wave-bob gap
    BOAT_BOUNCE: 0.36,      // restitution when two floating wooden hulls meet
    OBJECT_DRAG: 0.05       // per entity hit: fish/debris sap a little hull speed
  };

  let boats = [];
  let nextId = 1;
  let heroBoatId = null;
  let lastCtx = null;
  let simT = 0;

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
    while(remaining>0){
      const step=Math.min(0.4,remaining);
      let blocked=false;
      for(const c of topCells(b)){
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

  function makeBoat(tx,ty){
    return {id:nextId++, x:tx, y:ty, vx:0, vy:0, cells:[{dx:0,dy:0}],
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
    if(!p || typeof p.thrust!=='function' || !p.id) return false;
    const at=propulsion.findIndex(q=>q.id===p.id);
    if(at>=0) propulsion[at]=p; else propulsion.push(p);
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
      // Wider rafts present more freeboard to the wind
      const sail=0.75+0.25*Math.min(1,bb.w/6);
      return (w-b.vx)*CFG.WIND_COUPLING*sail;
    }
  });

  function resolveBoatBoatCollisions(b,getTile){
    let a=boatRect(b);
    for(const other of boats){
      if(other===b) continue;
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
    }
  }

  function collideExternalObjects(b,dt,getTile,ctx){
    let dragLoad=0;
    if(ctx && ctx.mobs && typeof ctx.mobs.collideBoat==='function'){
      const res=ctx.mobs.collideBoat({
        id:b.id,
        x:b.x, y:b.y, vx:b.vx, vy:b.vy,
        cells:b.cells.map(c=>({dx:c.dx,dy:c.dy}))
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
    for(let dx=bb.minDx; dx<=bb.maxDx; dx++){
      const s=surfaceYAt(getTile,water,Math.floor(b.x+dx+0.5),yFrom,yTo,{minDepth});
      if(s!=null){ surfSum+=s; surfN++; }
    }
    if(surfN>0){
      b.inWater=true;
      b.grounded=false;
      b.vy=0;
      const surface=surfSum/surfN;
      const targetY=surface + bb.h*CFG.DRAFT - (bb.maxDy+1);
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
        while(remaining>0){
          const step=Math.min(0.4,remaining);
          remaining-=step;
          let blocked=false, launched=false;
          for(const c of bottomCells(b)){
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
      const a=p.thrust(b,pctx);
      if(Number.isFinite(a)) accel+=a;
    }
    b.vx+=accel*dt;
    b.vx-=b.vx*Math.min(1,(b.grounded?CFG.GROUND_DRAG:(b.inWater?CFG.WATER_DRAG:0.05))*dt);
    b.vx=clamp(b.vx,-CFG.MAX_SPEED,CFG.MAX_SPEED);
    if(Math.abs(b.vx)<0.004) b.vx=0;
    // Horizontal move against terrain (leading-edge tile check per cell)
    if(b.vx!==0){
      let nx=b.x+b.vx*dt;
      const dir=b.vx>0?1:-1;
      if(b.inWater && !b.grounded){
        for(const c of bottomCells(b)){
          const edgeX=dir>0 ? nx+c.dx+1-1e-4 : nx+c.dx+1e-4;
          const tx=Math.floor(edgeX);
          const lane=surfaceYAt(getTile,water,tx,yFrom,yTo,{minDepth});
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
    resolveBoatBoatCollisions(b,getTile);
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
    for(const b of boats) updateBoat(b,dt,getTile,(ctx||{}));
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
    b.vx=clamp(b.vx + dir*CFG.ROW_IMPULSE*(strong?1:CFG.ROW_WEAK_MULT), -CFG.ROW_MAX_SPEED, CFG.ROW_MAX_SPEED);
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
      if(b.cells.length>=CFG.MAX_CELLS) return {ok:false, reason:'Łódź jest już ogromna'};
      const dx=Math.round(tx-b.x), dy=Math.round(ty-b.y);
      if(hasCell(b,dx,dy)) return {ok:false};
      b.cells.push({dx,dy});
      markDirty(b);
      return {ok:true, boat:b, extended:true};
    }
    const waterHere=buildWaterAt(tx,ty,getTile,opts);
    if(!waterHere) return {ok:false, reason:'Za plytko na lodke'};
    const b=makeBoat(tx,waterHere.surface + CFG.DRAFT - 1);
    b.inWater=true;
    boats.push(b);
    return {ok:true, boat:b, created:true};
  }
  // Remove the plank at a world point; a split hull becomes separate rafts.
  function removeCellAt(px,py){
    const hit=cellAt(px,py);
    if(!hit) return null;
    const b=hit.boat;
    b.cells=b.cells.filter(c=>c!==hit.cell);
    markDirty(b);
    if(!b.cells.length){
      boats=boats.filter(x=>x!==b);
      if(heroBoatId===b.id) heroBoatId=null;
      return {drop:'wood'};
    }
    // connectivity: flood fill from the first cell, spin off any severed parts
    const seen=new Set();
    const stack=[b.cells[0]];
    seen.add(key(b.cells[0].dx,b.cells[0].dy));
    while(stack.length){
      const c=stack.pop();
      for(const [ox,oy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const k=key(c.dx+ox,c.dy+oy);
        if(seen.has(k) || !hasCell(b,c.dx+ox,c.dy+oy)) continue;
        seen.add(k);
        stack.push(b.cells.find(q=>key(q.dx,q.dy)===k));
      }
    }
    if(seen.size<b.cells.length){
      const severed=b.cells.filter(c=>!seen.has(key(c.dx,c.dy)));
      b.cells=b.cells.filter(c=>seen.has(key(c.dx,c.dy)));
      markDirty(b);
      const nb=makeBoat(b.x,b.y);
      nb.cells=severed.map(c=>({dx:c.dx,dy:c.dy}));
      nb.vx=b.vx;
      markDirty(nb);
      boats.push(nb);
    }
    return {drop:'wood'};
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
        ctx2.fillStyle='#8b5a2b';
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
  function reset(){ boats=[]; heroBoatId=null; nextId=1; simT=0; }
  function snapshot(){
    if(!boats.length) return null;
    return {v:1, boats:boats.map(b=>({
      x:+b.x.toFixed(3), y:+b.y.toFixed(3), vx:+b.vx.toFixed(3),
      cells:b.cells.map(c=>[c.dx,c.dy])
    }))};
  }
  function restore(data){
    reset();
    if(!data || typeof data!=='object' || !Array.isArray(data.boats)) return false;
    for(const s of data.boats){
      if(!s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Array.isArray(s.cells) || !s.cells.length) continue;
      const b=makeBoat(s.x,s.y);
      b.vx=Number.isFinite(s.vx)?clamp(s.vx,-CFG.MAX_SPEED,CFG.MAX_SPEED):0;
      const seen=new Set();
      b.cells=[];
      for(const c of s.cells.slice(0,CFG.MAX_CELLS)){
        if(!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
        const k=key(c[0]|0,c[1]|0);
        if(seen.has(k)) continue;
        seen.add(k);
        b.cells.push({dx:c[0]|0,dy:c[1]|0});
      }
      if(b.cells.length){ markDirty(b); boats.push(b); }
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

  const api={
    update, draw, collideHero, heroBoat, heroOnBoat, heroTouchingBoat, boardHeroFromWater, row,
    placementMode, placeWood, removeCellAt, cellAt, boatAdjacentTo,
    registerPropulsion,
    snapshot, restore, reset, metrics,
    config:CFG,
    _debug:{boats:()=>boats, bounds, surfaceYAt, topCells, bottomCells}
  };
  root.MM.boats=api;
})();

export const boats = (typeof window !== 'undefined' && window.MM) ? window.MM.boats : globalThis.MM && globalThis.MM.boats;
export default boats;
