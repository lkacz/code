// Falling solids (stone, diamond) simple gravity simulation
window.MM = window.MM || {};
(function(){
  const {T, INFO, WORLD_H} = MM;
  const FALL_TYPES = new Set([T.STONE, T.DIAMOND]); // extend for sand etc.
  const g = 60; // tiles/sec^2
  const active = []; // {x,yFloat,type,vy}
  function spawn(x,y,t){ active.push({x,yFloat:y,type:t,vy:0}); }
  function update(getTile,setTile,dt){
    for(let i=active.length-1;i>=0;i--){
      const b=active[i];
      b.vy += g*dt; if(b.vy>50) b.vy=50;
      b.yFloat += b.vy*dt; let yi=Math.floor(b.yFloat);
      if(yi>=WORLD_H-1){ yi=WORLD_H-1; setTile(b.x,yi,b.type); active.splice(i,1); continue; }
      const below = getTile(b.x, yi+1);
      if(below!==T.AIR){ // land
        setTile(b.x, yi, b.type); active.splice(i,1); continue; }
    }
  }
  function draw(ctx,TILE){ for(const b of active){ ctx.fillStyle=INFO[b.type].color; ctx.fillRect(b.x*TILE, b.yFloat*TILE, TILE, TILE); } }
  function maybeStart(x,y){
    const t=getTile(x,y); if(!FALL_TYPES.has(t)) return;
    // Diamonds: simple gravity
    if(t===T.DIAMOND){ const below=getTile(x,y+1); if(below===T.AIR){ setTile(x,y,T.AIR); spawn(x,y,t); } return; }
    // Stone: cluster stability rule handled elsewhere; noop here
  }
  // ----- Stone cluster stability -----
  function gatherStoneCluster(sx,sy,visited){
    const stack=[[sx,sy]]; const cluster=[]; const key=(x,y)=>x+','+y;
    while(stack.length){
      const [x,y]=stack.pop(); const k=key(x,y); if(visited.has(k)) continue; const t=getTile(x,y); if(t!==T.STONE) continue; visited.add(k); cluster.push({x,y});
      // 4-neighbor connectivity (including vertical) so vertical pillars remain one cluster
      stack.push([x+1,y]); stack.push([x-1,y]); stack.push([x,y+1]); stack.push([x,y-1]);
    }
    return cluster;
  }
  function clusterHasSupport(cluster){
    // Build quick lookup
    const inCluster=new Set(cluster.map(n=>n.x+','+n.y));
    for(const n of cluster){
      if(n.y+1>=WORLD_H) return true; // touches bottom
      const below=getTile(n.x,n.y+1);
      if(below!==T.AIR){
        // if below is stone but NOT part of this cluster (happens if vertical adjacency not captured), treat as support
        if(!(below===T.STONE && inCluster.has(n.x+','+(n.y+1)))) return true;
      }
    }
    return false; // no external support
  }
  function processStoneAt(x,y,processed){ const t=getTile(x,y); if(t!==T.STONE) return; const below=getTile(x,y+1); if(below!==T.AIR) return; // directly supported
    const key=(x,y)=>x+','+y; if(processed.has(key(x,y))) return; const visited=new Set(); const cluster=gatherStoneCluster(x,y,visited); cluster.forEach(n=>processed.add(key(n.x,n.y)));
    // Safety cap to avoid giant BFS cost
    if(cluster.length>4000){ return; }
    if(clusterHasSupport(cluster)) return; // stable cluster
    // Entire cluster falls
    for(const n of cluster){ if(getTile(n.x,n.y)===T.STONE){ setTile(n.x,n.y,T.AIR); spawn(n.x,n.y,T.STONE); } }
  }
  function onTileRemoved(x,y){
    // Examine neighborhood columns for newly unsupported stone clusters and simple diamonds above gaps.
    const processed=new Set();
    for(let dx=-1; dx<=1; dx++){
      // Walk upward skipping air to find potential unsupported stones/diamonds
      for(let yy=y; yy>=0; yy--){
        const t=getTile(x+dx,yy);
        if(t===T.AIR) continue;
        if(t===T.DIAMOND){ const below=getTile(x+dx,yy+1); if(below===T.AIR){ setTile(x+dx,yy,T.AIR); spawn(x+dx,yy,T.DIAMOND); continue; } }
        if(t===T.STONE){ processStoneAt(x+dx,yy,processed); }
        // Stop climbing past first non-air (cluster logic handles upward recursion)
        break;
      }
    }
  }
  function reset(){ active.length=0; }
  function recheckNeighborhood(x,y){
    // Similar to onTileRemoved but without the initial changed cell semantics
    const processed=new Set();
    for(let dx=-1; dx<=1; dx++){
      for(let yy=y; yy>=0; yy--){
        const t=getTile(x+dx,yy);
        if(t===T.AIR) continue;
        if(t===T.DIAMOND){ const below=getTile(x+dx,yy+1); if(below===T.AIR){ setTile(x+dx,yy,T.AIR); spawn(x+dx,yy,T.DIAMOND); continue; } }
        if(t===T.STONE){ processStoneAt(x+dx,yy,processed); }
        break;
      }
    }
  }
  MM.fallingSolids={update,draw,onTileRemoved,maybeStart,reset,recheckNeighborhood};
})();
