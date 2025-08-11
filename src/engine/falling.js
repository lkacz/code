// Enhanced falling system with granular sand piles
window.MM = window.MM || {};
(function(){
  const {T, INFO, WORLD_H} = MM;
  const FALL_TYPES = new Set([T.STONE, T.DIAMOND, T.SAND]);
  const g = 60; // gravity
  const active = []; // rigid blocks (stone pieces, diamonds)
  const sandActive = []; // flowing sand grains

  function spawn(x,y,t){ active.push({x,yFloat:y,type:t,vy:0}); }
  function spawnSand(x,y){ sandActive.push({x,yFloat:y,vy:0}); }

  // --- Rigid update (stone/diamond) + sand grains ---
  function update(getTile,setTile,dt){
    for(let i=active.length-1;i>=0;i--){
      const b=active[i]; b.vy += g*dt; if(b.vy>55) b.vy=55; b.yFloat += b.vy*dt; let yi=Math.floor(b.yFloat);
      if(yi>=WORLD_H-1){ yi=WORLD_H-1; setTile(b.x,yi,b.type); active.splice(i,1); continue; }
      const below=getTile(b.x,yi+1); if(below!==T.AIR){ setTile(b.x,yi,b.type); active.splice(i,1); }
    }
    for(let i=sandActive.length-1;i>=0;i--){
      const s=sandActive[i]; s.vy += g*dt; if(s.vy>70) s.vy=70; s.yFloat += s.vy*dt; let yi=Math.floor(s.yFloat);
  if(yi>=WORLD_H-1){ yi=WORLD_H-1; settleSand(i,s.x,yi,getTile,setTile); continue; }
      const below=getTile(s.x,yi+1);
      if(below!==T.AIR){
        const canL = getTile(s.x-1,yi)===T.AIR && getTile(s.x-1,yi+1)===T.AIR;
        const canR = getTile(s.x+1,yi)===T.AIR && getTile(s.x+1,yi+1)===T.AIR;
        if(canL||canR){ let dir=0; if(canL&&canR) dir=(Math.random()<0.5?-1:1); else dir=canL?-1:1; s.x+=dir; s.yFloat=yi+0.05; continue; }
  settleSand(i,s.x,yi,getTile,setTile); continue;
      }
    }
  }

  function settleSand(idx,x,y,getTile,setTile){ setTile(x,y,T.SAND); sandActive.splice(idx,1); relaxSand(x,y,getTile,setTile); }
  function relaxSand(x,y,getTile,setTile){
    // Optimized avalanche: fewer iterations, cached tops, narrower range.
    const RANGE=4; // reduced from 5 (optimization 5)
    let noMoveStreak=0;
    // up to 20 iterations (optimization 1)
    for(let iter=0; iter<20; iter++){
      // cache column tops once
      const tops=[]; let moved=false;
      for(let dx=-RANGE; dx<=RANGE; dx++){
        const wx=x+dx; let top=-1;
        for(let yy=Math.max(0,y-12); yy<=y+2 && yy<WORLD_H; yy++){ if(getTile(wx,yy)===T.SAND) top=yy; }
        tops.push({wx,top});
      }
      for(const {wx,top} of tops){
        if(top<0) continue;
        const leftDrop=diagFallDepth(wx,top,-1); const rightDrop=diagFallDepth(wx,top,1);
        if(leftDrop>=2 || rightDrop>=2){
          const dir= leftDrop>rightDrop? -1 : rightDrop>leftDrop? 1 : (Math.random()<0.5?-1:1);
          if(getTile(wx+dir,top)===T.AIR && getTile(wx+dir,top+1)===T.AIR){ setTile(wx,top,T.AIR); spawnSand(wx+dir,top); moved=true; }
        }
      }
      if(!moved){ if(++noMoveStreak>=2) break; } else noMoveStreak=0;
    }
  }
  function diagFallDepth(x,y,dir){ let steps=0; let cx=x, cy=y; while(steps<6){ if(getTile(cx+dir,cy)!==T.AIR || getTile(cx+dir,cy+1)!==T.AIR) break; cx+=dir; cy++; steps++; if(steps>=2) break; } return steps; }

  function draw(ctx,TILE){
    for(const b of active){ ctx.fillStyle=INFO[b.type].color; ctx.fillRect(b.x*TILE,b.yFloat*TILE,TILE,TILE); }
    if(sandActive.length){ ctx.fillStyle=INFO[T.SAND].color; for(const s of sandActive){ ctx.fillRect(s.x*TILE,s.yFloat*TILE,TILE,TILE); } }
  }

  function maybeStart(x,y){
    const t=getTile(x,y); if(!FALL_TYPES.has(t)) return;
    if(t===T.DIAMOND){ if(getTile(x,y+1)===T.AIR){ setTile(x,y,T.AIR); spawn(x,y,t); } return; }
    if(t===T.SAND){ if(getTile(x,y+1)===T.AIR){ setTile(x,y,T.AIR); spawnSand(x,y); } return; }
    // stone handled via cluster
  }

  // Stone cluster stability (same as earlier implementation)
  function gatherStoneCluster(sx,sy,visited){ const stack=[[sx,sy]]; const cluster=[]; const key=(x,y)=>x+','+y; while(stack.length){ const [x,y]=stack.pop(); const k=key(x,y); if(visited.has(k)) continue; const t=getTile(x,y); if(t!==T.STONE) continue; visited.add(k); cluster.push({x,y}); stack.push([x+1,y]); stack.push([x-1,y]); stack.push([x,y+1]); stack.push([x,y-1]); } return cluster; }
  function clusterHasSupport(cluster){ const inC=new Set(cluster.map(n=>n.x+','+n.y)); for(const n of cluster){ if(n.y+1>=WORLD_H) return true; const below=getTile(n.x,n.y+1); if(below!==T.AIR){ if(!(below===T.STONE && inC.has(n.x+','+(n.y+1)))) return true; } } return false; }
  function processStoneAt(x,y,processed){ const t=getTile(x,y); if(t!==T.STONE) return; if(getTile(x,y+1)!==T.AIR) return; const key=(x,y)=>x+','+y; if(processed.has(key(x,y))) return; const visited=new Set(); const cluster=gatherStoneCluster(x,y,visited); cluster.forEach(n=>processed.add(key(n.x,n.y))); if(cluster.length>4000) return; if(clusterHasSupport(cluster)) return; for(const n of cluster){ if(getTile(n.x,n.y)===T.STONE){ setTile(n.x,n.y,T.AIR); spawn(n.x,n.y,T.STONE); } } }

  function onTileRemoved(x,y){ const processed=new Set(); for(let dx=-1; dx<=1; dx++){ for(let yy=y; yy>=0; yy--){ const t=getTile(x+dx,yy); if(t===T.AIR) continue; if(t===T.DIAMOND){ if(getTile(x+dx,yy+1)===T.AIR){ setTile(x+dx,yy,T.AIR); spawn(x+dx,yy,T.DIAMOND); continue; } }
      if(t===T.SAND){ if(getTile(x+dx,yy+1)===T.AIR){ setTile(x+dx,yy,T.AIR); spawnSand(x+dx,yy); continue; } }
      if(t===T.STONE){ processStoneAt(x+dx,yy,processed); }
      break; } } }
  function reset(){ active.length=0; sandActive.length=0; }
  function recheckNeighborhood(x,y){ const processed=new Set(); for(let dx=-1; dx<=1; dx++){ for(let yy=y; yy>=0; yy--){ const t=getTile(x+dx,yy); if(t===T.AIR) continue; if(t===T.DIAMOND){ if(getTile(x+dx,yy+1)===T.AIR){ setTile(x+dx,yy,T.AIR); spawn(x+dx,yy,T.DIAMOND); continue; } } if(t===T.SAND){ if(getTile(x+dx,yy+1)===T.AIR){ setTile(x+dx,yy,T.AIR); spawnSand(x+dx,yy); continue; } } if(t===T.STONE){ processStoneAt(x+dx,yy,processed); } break; } } }
  // --- Sand relaxation after placement (handles tall vertical lines becoming piles) ---
  function afterPlacement(x,y){ // x,y tile placed (any type)
    const MAX_ITER=8; const RANGE=4; let changed=false; // fewer iterations & narrower window
    function topSandAt(cx){ for(let yy=0; yy<WORLD_H; yy++){ /* scan upward later? we need highest */ } return findTopSand(cx); }
    function findTopSand(cx){ let top=-1; // scan downward from a reasonable max (y or y+20) for performance
      const start=Math.min(WORLD_H-1, Math.max(0,y+25));
      for(let yy=start; yy>=0; yy--){ const t=getTile(cx,yy); if(t===T.SAND){ top=yy; break; } }
      return top; }
  for(let iter=0; iter<MAX_ITER; iter++){
      let moved=false;
      // compute heights
      const heights=[]; let minH=Infinity, maxH=-Infinity;
      for(let dx=-RANGE; dx<=RANGE; dx++){ const cx=x+dx; const top=findTopSand(cx); heights.push({cx,top}); if(top>=0){ if(top<minH) minH=top; if(top>maxH) maxH=top; } }
      if(maxH - minH <= 1) break; // tighten: diff 2 triggers smoothing
      // pick the highest columns that meet or exceed minH+2 (forbid 3-high stacks)
      for(const h of heights){ if(h.top>=0 && h.top >= minH+2){ // release top grain
          if(getTile(h.cx,h.top)===T.SAND){ setTile(h.cx,h.top,T.AIR); spawnSand(h.cx,h.top-0.01); moved=true; }
        }
      }
      if(!moved) break; else changed=true;
    }
    if(changed){ // let spawned grains process in update; optionally small extra relaxation
      // no-op placeholder
    }
    // Phase 2: enforce side-support rule. Any isolated vertical sand column (no neighbors left/right at any level) taller than 1 collapses (all but base released)
  for(let dx=-RANGE; dx<=RANGE; dx++){
      const cx=x+dx;
      // find top and base of contiguous sand column intersecting y region
  let top=-1; for(let yy=Math.min(WORLD_H-1,y+30); yy>=0; yy--){ if(getTile(cx,yy)===T.SAND){ top=yy; break; } }
      if(top<0) continue;
      // find base by descending
      let base=top; while(base>0 && getTile(cx,base-1)===T.SAND) base--;
      const height=top-base+1; if(height<=1) continue;
      // check isolation: for every level no side tiles
      let isolated=true; for(let yy=base; yy<=top && isolated; yy++){
        if(getTile(cx-1,yy)!==T.AIR || getTile(cx+1,yy)!==T.AIR){ isolated=false; }
      }
      if(isolated){
        // release all but bottom into falling grains
        for(let yy=base+1; yy<=top; yy++){
          if(getTile(cx,yy)===T.SAND){ setTile(cx,yy,T.AIR); spawnSand(cx,yy-0.05); }
        }
      }
    }
  }
  MM.fallingSolids={update,draw,onTileRemoved,maybeStart,reset,recheckNeighborhood,afterPlacement};
})();
