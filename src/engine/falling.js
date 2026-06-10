// Falling-solid physics: rigid bodies (stone clusters, diamonds) + granular sand.
// Event-driven design: tile edits queue "instability checks" (a Set of cells); the
// per-frame processor releases unstable tiles into moving entities. Sand obeys an
// angle-of-repose rule (a grain topples when a side and the cell below it are open),
// so piles relax into natural 45° slopes and avalanches propagate frame by frame.
import { T, INFO, WORLD_H } from '../constants.js';
window.MM = window.MM || {};
(function(){
  const G_AIR = 60,  G_WATER = 25;            // gravity (tiles/s^2); buoyancy reduces it in water
  const VMAX_AIR = 55, VMAX_WATER = 9;        // terminal velocity for rigid blocks
  const SAND_VMAX_AIR = 70, SAND_VMAX_WATER = 7; // sand drifts down slowly through water
  const QUEUE_BUDGET = 600;                   // instability checks per frame (cascades span frames)
  const CLUSTER_CAP = 4000;                   // larger stone clusters are treated as bedrock-stable

  const active = [];          // rigid blocks {x,yFloat,type,vy,wet}
  const sandActive = [];      // flowing sand grains {x,yFloat,vy,wet}
  const unstable = new Set(); // 'x,y' cells awaiting a stability check
  // Tile accessors supplied by main.js; update() refreshes them so event-driven
  // helpers (onTileRemoved etc.) always see the live world.
  let getTile = null, setTile = null;
  function init(gt, st){ getTile = gt; setTile = st; }
  const key = (x,y)=>x+','+y;

  // Falling solids sink through water instead of resting on its surface
  function passable(t){ return t===T.AIR || t===T.WATER; }
  function spawn(x,y,t){ active.push({x,yFloat:y,type:t,vy:0,wet:false}); }
  function spawnSand(x,y){ sandActive.push({x,yFloat:y,vy:0,wet:false}); }

  function notifyWater(x,y){ try{ const w=window.MM && MM.water; if(w && w.onTileChanged && getTile) w.onTileChanged(x,y,getTile); }catch(e){} }
  // A solid settling into a water cell pushes the water out (up or sideways) instead of deleting it
  function displaceWater(x,y){ try{ const w=window.MM && MM.water; if(w && w.displaceAt) w.displaceAt(x,y,getTile,setTile); }catch(e){} }
  function splash(x,yFloat,vy){ try{ const p=window.MM && MM.particles; if(p && p.spawnSplash){ const TILE=MM.TILE||20; p.spawnSplash((x+0.5)*TILE, Math.floor(yFloat)*TILE, Math.min(1, Math.abs(vy)/20)); } const w=window.MM && MM.water; if(w && w.disturb) w.disturb(x, Math.min(300, Math.abs(vy)*14)); }catch(e){} }

  // Never solidify a tile inside the player — the entity rests on them until they move
  function playerBlocks(x,y){ const p=window.player; if(!p) return false; return x+1 > p.x-p.w/2 && x < p.x+p.w/2 && y+1 > p.y-p.h/2 && y < p.y+p.h/2; }

  // Write a settled solid into the world, displacing (not destroying) any water there
  function occupy(x,y,type){
    let yy=y; while(yy>0 && !passable(getTile(x,yy))) yy--; // cell may have been claimed this frame — stack upward
    const was=getTile(x,yy);
    if(was===T.WATER) displaceWater(x,yy);
    setTile(x,yy,type);
    if(was===T.WATER) notifyWater(x,yy);
    return yy;
  }

  // --- Instability queue ---
  function queueCheck(x,y){ if(y>=0 && y<WORLD_H) unstable.add(key(x,y)); }
  // Removing (x,y) can destabilize: the cell above (straight fall), the sides and
  // upper diagonals (sand toppling into the new gap), and the cell below — it is the
  // freshly exposed pile top and may already violate the repose angle.
  function queueAroundRemoval(x,y){
    queueCheck(x,y-1); queueCheck(x,y+1);
    queueCheck(x-1,y); queueCheck(x+1,y);
    queueCheck(x-1,y-1); queueCheck(x+1,y-1);
  }

  function release(x,y){ setTile(x,y,T.AIR); spawnSand(x,y); queueAroundRemoval(x,y); }

  function checkCell(x,y,processed){
    const t=getTile(x,y);
    if(t===T.SAND){
      if(y+1>=WORLD_H) return; // bottom row is bedrock-stable
      if(passable(getTile(x,y+1))){ release(x,y); return; }
      // Static repose: undisturbed sand holds slopes up to 2 tiles per column, so
      // worldgen dunes (commonly slope 2) stay put and dig-triggered cascades die out
      // at natural terrain instead of sweeping the whole biome flat. Only genuinely
      // oversteep faces (drop >= 3 beside the grain) slide. In-flight grains in
      // update() still roll to gentler 45° piles, keeping poured sand granular.
      const L = passable(getTile(x-1,y)) && passable(getTile(x-1,y+1)) && passable(getTile(x-1,y+2));
      const R = passable(getTile(x+1,y)) && passable(getTile(x+1,y+1)) && passable(getTile(x+1,y+2));
      if(L||R) release(x,y);
    } else if(t===T.DIAMOND){
      if(y+1<WORLD_H && passable(getTile(x,y+1))){ setTile(x,y,T.AIR); spawn(x,y,T.DIAMOND); queueAroundRemoval(x,y); }
    } else if(t===T.STONE){
      processStoneAt(x,y,processed);
    }
  }

  function processQueue(){
    if(!unstable.size) return;
    let budget=QUEUE_BUDGET;
    const processed=new Set(); // per-frame stone-cluster dedupe
    for(const k of unstable){
      if(budget--<=0) break; // leftovers (big avalanches) continue next frame
      unstable.delete(k);
      const ix=k.indexOf(','); checkCell(+k.slice(0,ix), +k.slice(ix+1), processed);
    }
  }

  // --- Stone cluster stability ---
  // Flood-fills connected stone, aborting as soon as any member rests on a supporting
  // tile (non-passable, non-stone) — the common "still supported" case stays cheap.
  function processStoneAt(sx,sy,processed){
    if(getTile(sx,sy)!==T.STONE || processed.has(key(sx,sy))) return;
    if(sy+1>=WORLD_H || !passable(getTile(sx,sy+1))){ processed.add(key(sx,sy)); return; } // directly supported
    const stack=[[sx,sy]]; const seen=new Set(); const cluster=[];
    let supported=false;
    while(stack.length){
      const [x,y]=stack.pop(); const k=key(x,y);
      if(seen.has(k)) continue;
      if(getTile(x,y)!==T.STONE) continue;
      seen.add(k); cluster.push([x,y]);
      if(cluster.length>CLUSTER_CAP){ supported=true; break; }
      if(y+1>=WORLD_H){ supported=true; break; }
      const below=getTile(x,y+1);
      if(below!==T.STONE && !passable(below)){ supported=true; break; }
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    for(const [x,y] of cluster) processed.add(key(x,y));
    if(supported) return;
    for(const [x,y] of cluster){ if(getTile(x,y)===T.STONE){ setTile(x,y,T.AIR); spawn(x,y,T.STONE); } }
    // Anything that sat on the cluster (sand, diamonds) is now unsupported
    for(const [x,y] of cluster) queueAroundRemoval(x,y);
  }

  // Drop a grain/block straight to its landing cell and write it immediately (no roll).
  // Used to freeze in-flight material into tiles so it can never be lost.
  function dropToRest(x, fromY, type){
    let y=Math.max(0, Math.min(WORLD_H-1, Math.floor(fromY)));
    while(y<WORLD_H-1 && passable(getTile(x,y+1))) y++;
    const restY=occupy(x,y,type);
    queueCheck(x,restY);
    return restY;
  }
  // The v5 save persists tiles only — airborne entities would vanish on reload.
  // buildSaveObject() calls this right before serializing chunks.
  function settleAll(){
    if(!getTile) return;
    for(const b of active) dropToRest(b.x, b.yFloat, b.type);
    active.length=0;
    for(const s of sandActive) dropToRest(s.x, s.yFloat, T.SAND);
    sandActive.length=0;
  }

  // --- Entity integration (swept, cell-by-cell — large dt cannot tunnel through floors) ---
  function update(gt,st,dt){
    init(gt,st);
    processQueue();
    // Overload guard: a pathological cascade can't accumulate unbounded entities
    if(sandActive.length>3000){ const excess=sandActive.splice(0, sandActive.length-3000); for(const s of excess) dropToRest(s.x, s.yFloat, T.SAND); }

    for(let i=active.length-1;i>=0;i--){
      const b=active[i];
      const inWater = getTile(b.x, Math.floor(b.yFloat))===T.WATER;
      if(inWater && !b.wet){ b.wet=true; splash(b.x,b.yFloat,b.vy); notifyWater(b.x,Math.floor(b.yFloat)); if(b.vy>VMAX_WATER*1.6) b.vy=VMAX_WATER*1.6; }
      else if(!inWater) b.wet=false;
      b.vy += (inWater?G_WATER:G_AIR)*dt;
      const cap=inWater?VMAX_WATER:VMAX_AIR; if(b.vy>cap) b.vy=cap;
      let remaining=b.vy*dt, settledAt=-1;
      while(remaining>0){
        const yi=Math.floor(b.yFloat);
        if(yi>=WORLD_H-1){ b.yFloat=WORLD_H-1; settledAt=WORLD_H-1; break; }
        if(!passable(getTile(b.x,yi+1))){ settledAt=yi; break; }
        const dist=(yi+1)-b.yFloat;
        if(remaining<dist){ b.yFloat+=remaining; remaining=0; }
        else { b.yFloat=yi+1; remaining-=dist; }
      }
      if(settledAt>=0){
        if(playerBlocks(b.x,settledAt)){ b.vy=0; b.yFloat=settledAt; continue; } // rest on the player until they move
        occupy(b.x,settledAt,b.type);
        active.splice(i,1);
      }
    }

    for(let i=sandActive.length-1;i>=0;i--){
      const s=sandActive[i];
      const inWater = getTile(s.x, Math.floor(s.yFloat))===T.WATER;
      if(inWater && !s.wet){ s.wet=true; splash(s.x,s.yFloat,s.vy); if(s.vy>SAND_VMAX_WATER*1.6) s.vy=SAND_VMAX_WATER*1.6; }
      else if(!inWater) s.wet=false;
      s.vy += (inWater?G_WATER:G_AIR)*dt;
      const cap=inWater?SAND_VMAX_WATER:SAND_VMAX_AIR; if(s.vy>cap) s.vy=cap;
      let remaining=s.vy*dt, blockedAt=-1;
      while(remaining>0){
        const yi=Math.floor(s.yFloat);
        if(yi>=WORLD_H-1){ s.yFloat=WORLD_H-1; blockedAt=WORLD_H-1; break; }
        if(!passable(getTile(s.x,yi+1))){ blockedAt=yi; break; }
        const dist=(yi+1)-s.yFloat;
        if(remaining<dist){ s.yFloat+=remaining; remaining=0; }
        else { s.yFloat=yi+1; remaining-=dist; }
      }
      if(blockedAt<0) continue;
      const yi=blockedAt;
      if(yi<WORLD_H-1){ // grain rolls down slopes (also under water)
        const canL = passable(getTile(s.x-1,yi)) && passable(getTile(s.x-1,yi+1));
        const canR = passable(getTile(s.x+1,yi)) && passable(getTile(s.x+1,yi+1));
        if(canL||canR){ const dir=(canL&&canR)?(Math.random()<0.5?-1:1):(canL?-1:1); s.x+=dir; s.yFloat=yi+0.05; if(s.vy>8) s.vy=8; continue; }
      }
      if(playerBlocks(s.x,yi)){ s.vy=0; s.yFloat=yi; continue; }
      const restY=occupy(s.x,yi,T.SAND);
      sandActive.splice(i,1);
      queueCheck(s.x,restY); // the settled grain may itself sit on a peak
    }
  }

  function draw(ctx,TILE){
    for(const b of active){ ctx.fillStyle=INFO[b.type].color; ctx.fillRect(b.x*TILE,b.yFloat*TILE,TILE,TILE); }
    if(sandActive.length){ ctx.fillStyle=INFO[T.SAND].color; for(const s of sandActive){ ctx.fillRect(s.x*TILE,s.yFloat*TILE,TILE,TILE); } }
  }

  // --- Public event API (names kept stable for main.js / undo) ---
  function onTileRemoved(x,y){ queueAroundRemoval(x,y); }
  function recheckNeighborhood(x,y){ queueCheck(x,y); queueAroundRemoval(x,y); } // undo can both add and remove tiles
  function afterPlacement(x,y){ queueCheck(x,y); queueCheck(x,y-1); }
  function maybeStart(x,y){ queueCheck(x,y); }

  function reset(){ active.length=0; sandActive.length=0; unstable.clear(); }
  function snapshot(){ try{ return {v:2, active:active.map(b=>({x:b.x,y:b.yFloat,type:b.type,vy:b.vy})), sand:sandActive.map(s=>({x:s.x,y:s.yFloat,vy:s.vy})), queue:[...unstable]}; }catch(e){ return null; } }
  function restore(s){ reset(); if(!s||typeof s!=='object') return; try{
    if(Array.isArray(s.active)) for(const b of s.active){ if(b&&typeof b.x==='number') active.push({x:b.x,yFloat:b.y||0,type:b.type,vy:b.vy||0,wet:false}); }
    if(Array.isArray(s.sand)) for(const g of s.sand){ if(g&&typeof g.x==='number') sandActive.push({x:g.x,yFloat:g.y||0,vy:g.vy||0,wet:false}); }
    if(Array.isArray(s.queue)) for(const k of s.queue){ if(typeof k==='string') unstable.add(k); }
  }catch(e){} }

  MM.fallingSolids={init,update,draw,onTileRemoved,maybeStart,reset,recheckNeighborhood,afterPlacement,settleAll,snapshot,restore};
})();
// ESM export (progressive migration)
export const fallingSolids = (typeof window!=='undefined' && window.MM) ? window.MM.fallingSolids : undefined;
export default fallingSolids;
