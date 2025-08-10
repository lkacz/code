// Simple cellular water simulation (spread & settle)
// Goal: performant, visually plausible, supports flow around obstacles and pooling.
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H, CHUNK_W} = MM;
  // Active water fronts tracked to limit scanning.
  const active=new Set(); // keys 'x,y'
  function k(x,y){return x+','+y;}
  function mark(x,y){ active.add(k(x,y)); }
  function isEmpty(t){ return t===T.AIR; }
  function isDisplaceable(t){ return t===T.AIR || t===T.SAND || t===T.LEAF; } // leaves allow seep
  function update(getTile,setTile,dt){
    if(active.size===0) return;
    // Process a bounded number per frame to avoid spikes
    const MAX=800; let c=0; const next=new Set();
    for(const key of active){ if(c++>MAX) { next.add(key); continue; }
      const [sx,sy]=key.split(',').map(Number);
      const t=getTile(sx,sy); if(t!==T.WATER) continue;
      // Try flow downward first (gravity). Allow replacing air / leaf.
      const below=getTile(sx,sy+1);
      if(sy+1<WORLD_H && isEmpty(below)){
        setTile(sx,sy,T.AIR); setTile(sx,sy+1,T.WATER); next.add(k(sx,sy+1)); markNeighbors(next,sx,sy+1); continue; }
      // Lateral spread if blocked below
      let flowed=false;
      // Randomize order for natural look
      const dirs = Math.random()<0.5? [-1,1] : [1,-1];
      for(const dx of dirs){ const nx=sx+dx; const nt=getTile(nx,sy); if(isEmpty(nt) && getTile(nx,sy+1)!==T.AIR){ setTile(nx,sy,T.WATER); next.add(k(nx,sy)); markNeighbors(next,nx,sy); flowed=true; }
        else if(isEmpty(nt) && getTile(nx,sy+1)===T.AIR){ // diagonal preference downward if opening
          setTile(sx,sy,T.AIR); setTile(nx,sy+1,T.WATER); next.add(k(nx,sy+1)); markNeighbors(next,nx,sy+1); flowed=true; break; }
      }
      if(!flowed){ // small evaporation chance to remove stray single tiles
        // nothing
      } else { markNeighbors(next,sx,sy); }
    }
    active.clear(); for(const k2 of next) active.add(k2);
    // Limit size (older entries trimmed) for perf
    if(active.size>4000){ let i=0; for(const kk of active){ if(i++>4000){ active.delete(kk); } }
    }
  }
  function markNeighbors(set,x,y){ set.add(k(x-1,y)); set.add(k(x+1,y)); set.add(k(x,y-1)); set.add(k(x,y+1)); }
  function addSource(x,y,getTile,setTile){ if(getTile(x,y)!==T.AIR) return false; setTile(x,y,T.WATER); mark(x,y); return true; }
  function onTileChanged(x,y,getTile){ // if water lost support, mark
    for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){ if(getTile(x+dx,y+dy)===T.WATER) mark(x+dx,y+dy); }
  }
  function drawOverlay(ctx,TILE,getTile,sx,sy,vx,vy){
    // subtle animated surface shimmer (single pass over visible water)
    const now=performance.now();
    for(let y=sy; y<sy+vy+2; y++){
      if(y<0||y>=WORLD_H) continue;
      for(let x=sx; x<sx+vx+2; x++){
        if(getTile(x,y)===T.WATER){
          const h=(Math.sin((x*13.1 + now*0.003)) + Math.sin((y*7.7 + now*0.002)))*0.5;
          const alpha = 0.35 + 0.15*h;
          ctx.fillStyle='rgba(36,119,255,'+alpha.toFixed(3)+')';
          ctx.fillRect(x*TILE,y*TILE,TILE,TILE);
          // surface highlight if air above
          if(getTile(x,y-1)===T.AIR){ ctx.fillStyle='rgba(255,255,255,0.07)'; ctx.fillRect(x*TILE,y*TILE,TILE,2); }
        }
      }
    }
  }
  function reset(){ active.clear(); }
  MM.water={update,addSource,drawOverlay,onTileChanged,reset};
})();
