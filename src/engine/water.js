// Simple cellular water simulation (spread & settle)
// Goal: performant, visually plausible, supports flow around obstacles and pooling.
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H, CHUNK_W} = MM;
  // Active water fronts tracked to limit scanning.
  const active=new Set(); // keys 'x,y'
  let passiveScanOffset = 0; // incremental column scan to catch dormant floating water
  function k(x,y){return x+','+y;}
  function mark(x,y){ active.add(k(x,y)); }
  function isAir(t){ return t===T.AIR; }
  function canFill(t){ return t===T.AIR || t===T.LEAF; } // allow passing through leaves (foliage)
  function update(getTile,setTile,dt){
    // Passive activation: each frame scan a small slice of columns near player or global offset (simplified global).
    if(active.size===0){
      // scan 40 columns per frame (wrap around). Use world height constraints.
      const SCAN_COLS=40; for(let i=0;i<SCAN_COLS;i++){ const wx=passiveScanOffset + i; passiveScanOffset = (passiveScanOffset + 1) % 2048; // arbitrary wrap
        for(let y=0; y<WORLD_H-1; y++){ if(getTile(wx,y)===T.WATER && canFill(getTile(wx,y+1))){ mark(wx,y); break; } }
      }
      if(active.size===0) return; // nothing activated
    }
    // Adaptive cap: more active cells processed when set small; clamp upper bound.
    const size=active.size; const MAX = Math.min(2000, 300 + Math.floor(size*0.35));
    let processed=0; const next=new Set();
    // Deterministic iteration order (avoid directional bias flicker): sort keys by hash.
    const keys=[...active]; keys.sort();
    for(const key of keys){ if(processed++>MAX) { next.add(key); continue; }
      const [sx,sy]=key.split(',').map(Number);
      if(getTile(sx,sy)!==T.WATER) continue;
      // 1. Gravity straight down (accelerated): drop multiple cells in one step through open air
      if(sy+1 < WORLD_H && canFill(getTile(sx,sy+1))){
        let ny = sy+1; const MAX_FALL=12; // limit to avoid tunneling entire world in one frame
        while(ny+1 < WORLD_H && canFill(getTile(sx,ny+1)) && (ny - sy) < MAX_FALL){ ny++; }
        setTile(sx,sy,T.AIR); setTile(sx,ny,T.WATER);
        next.add(k(sx,ny)); markNeighbors(next,sx,ny);
        continue;
      }
      // 2. Edge spill diagonals (waterfall off ledges)
      let moved=false;
  const leftBelowAir = sy+1<WORLD_H && canFill(getTile(sx-1,sy+1));
  const rightBelowAir = sy+1<WORLD_H && canFill(getTile(sx+1,sy+1));
      // Prioritize the side with deeper vertical drop (scan up to 4)
  function dropDepth(x){ let d=0; let yy=sy+1; while(yy<WORLD_H && canFill(getTile(x,yy)) && d<8){ d++; yy++; } return d; }
      if(leftBelowAir || rightBelowAir){
        let order=[];
        if(leftBelowAir && rightBelowAir){ const dl=dropDepth(sx-1); const dr=dropDepth(sx+1); order = dl>dr? [-1,1] : dr>dl? [1,-1] : ( ( (sx+sy)&1) ? [-1,1]:[1,-1] ); }
        else order = leftBelowAir? [-1]:[1];
  for(const dx of order){ if(canFill(getTile(sx+dx,sy+1))){ setTile(sx,sy,T.AIR); setTile(sx+dx,sy+1,T.WATER); next.add(k(sx+dx,sy+1)); markNeighbors(next,sx+dx,sy+1); moved=true; break; } }
        if(moved) continue;
      }
      // 3. Lateral leveling: flow sideways into supported or water-backed air.
      // Evaluate both sides for potential (support present under target or diagonal fall option)
  const candidates=[]; for(const dx of [-1,1]){ const nx=sx+dx; if(isAir(getTile(nx,sy))){ const under=getTile(nx,sy+1); if(under!==T.AIR || isAir(getTile(sx,sy+1))===false){ // support or current has support
            // measure basin depth outward to limit runaway spread
            let depth=0; for(let dd=1; dd<=6; dd++){ const tx=nx+dx*dd; if(!isAir(getTile(tx,sy))) break; depth++; }
            candidates.push({dx,score:depth}); }
          else if(isAir(getTile(nx,sy+1)) && sy+1<WORLD_H){ // diagonal slide already handled earlier; treat as lower priority
            candidates.push({dx,score:0}); }
        } }
      if(candidates.length){
        // Prefer higher score (wider empty stretch) to encourage pool filling
        candidates.sort((a,b)=> b.score - a.score || ((sx+sy)&1? b.dx - a.dx : a.dx - b.dx));
        const pick=candidates[0];
        // Move sideways (do not duplicate)
        setTile(sx,sy,T.AIR); setTile(sx+pick.dx,sy,T.WATER); next.add(k(sx+pick.dx,sy)); markNeighbors(next,sx+pick.dx,sy); moved=true;
      }
      if(!moved){ // stable this frame; keep it active if any neighbor air (potential future flow)
  if(isAir(getTile(sx-1,sy)) || isAir(getTile(sx+1,sy)) || isAir(getTile(sx,sy+1))){ next.add(key); }
      }
    }
    active.clear(); for(const kk of next) active.add(kk);
    if(active.size>6000){ // trim overflow
      let i=0; for(const kk of active){ if(i++>6000){ active.delete(kk); } }
    }
  }
  function markNeighbors(set,x,y){ set.add(k(x-1,y)); set.add(k(x+1,y)); set.add(k(x,y-1)); set.add(k(x,y+1)); }
  function addSource(x,y,getTile,setTile){
    const cur=getTile(x,y);
    if(cur===T.AIR){ setTile(x,y,T.WATER); mark(x,y); return true; }
    if(cur===T.WATER){ mark(x,y); return true; } // already water, just ensure activation
    return false;
  }
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
