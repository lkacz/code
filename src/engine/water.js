// Simple cellular water simulation (spread & settle)
// Goal: performant, visually plausible, supports flow around obstacles and pooling.
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H, CHUNK_W} = MM;
  // Active water fronts tracked to limit scanning.
  const active=new Set(); // keys 'x,y'
  let passiveScanOffset = 0; // incremental column scan to catch dormant floating water
  const waveState = new Map(); // key: segStart+":"+segEnd+":"+y -> {offset}
  function k(x,y){return x+','+y;}
  function mark(x,y){ active.add(k(x,y)); }
  function isAir(t){ return t===T.AIR; }
  function canFill(t){ return t===T.AIR || t===T.LEAF; } // allow passing through leaves (foliage)
  function update(getTile,setTile,dt){
    // Passive activation: each frame scan a small slice of columns near player or global offset (simplified global).
    if(active.size===0){
      // scan 40 columns per frame (monotonic). If columns not generated yet, getTile will trigger gen lazily.
      const SCAN_COLS=40; for(let i=0;i<SCAN_COLS;i++){ const wx=passiveScanOffset + i; passiveScanOffset += 1;
        // simple guard: skip extremely large indices to avoid unbounded exploration far from play area
        if(passiveScanOffset>5_000_000){ passiveScanOffset=0; }
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
    // Wave redistribution for partially filled surface basins (visual + logical oscillation)
    const now=performance.now();
  if(active.size < 500){ // only attempt waves when system mostly idle
      const freq = 0.00045; // oscillation base frequency
      for(let y=sy; y<sy+vy+2; y++){
        if(y<0||y>=WORLD_H) continue;
        // Build segments across view (slightly extended)
        let x = sx-2;
        const xEnd = sx+vx+2;
        while(x <= xEnd){
          // Segment starts where cell qualifies (supported floor) and cell is water surface or dry floor
          const t=getTile(x,y); const below=getTile(x,y+1);
          const supported = below!==T.AIR; // floor
            const surfaceCandidate = supported && (t===T.WATER || (t===T.AIR));
          if(!surfaceCandidate){ x++; continue; }
          // Collect segment
          let segStart=x; let seg=[]; let hasWater=false; let hasAir=false;
          while(x<=xEnd){ const tt=getTile(x,y); const bb=getTile(x,y+1); const ok = (bb!==T.AIR) && (tt===T.WATER || tt===T.AIR); if(!ok) break; const waterHere = (tt===T.WATER && getTile(x,y-1)===T.AIR); // only count surface water
            const airHere = (tt===T.AIR);
            seg.push({x,water:waterHere}); if(waterHere) hasWater=true; if(airHere) hasAir=true; x++; }
          const segEnd = x-1;
          if(hasWater && hasAir && seg.length>1){
            // Determine walls: simple check of neighbors outside segment
            const leftWall = (getTile(segStart-1,y)!==T.AIR && getTile(segStart-1,y)!==T.WATER) || getTile(segStart-1,y+1)===T.AIR;
            const rightWall = (getTile(segEnd+1,y)!==T.AIR && getTile(segEnd+1,y)!==T.WATER) || getTile(segEnd+1,y+1)===T.AIR;
            if(leftWall && rightWall){
              const W = seg.length; const waterCount = seg.filter(c=>c.water).length;
              if(waterCount>0 && waterCount<W){
                // Phase based on y (row) to diversify
                const phase = y*57.17;
                const oscill = (Math.sin(now*freq + phase)+1)/2; // 0..1
                const offset = Math.floor(oscill * (W - waterCount));
                const key = segStart+":"+segEnd+":"+y+":"+waterCount;
                const prev = waveState.get(key);
                if(!prev || prev.offset!==offset){
                  // Reassign distribution only when offset changed
                  for(let i=0;i<W;i++){ const targetWater = i>=offset && i<offset+waterCount; const cell=seg[i]; const curT=getTile(cell.x,y); const isSurfaceWater = (curT===T.WATER && getTile(cell.x,y-1)===T.AIR);
                    if(targetWater){ if(curT===T.AIR){ setTile(cell.x,y,T.WATER); } }
                    else { if(isSurfaceWater){ setTile(cell.x,y,T.AIR); } }
                  }
                  waveState.set(key,{offset});
                }
              }
            }
          }
        }
      }
    }
    // Subtle animated surface shimmer (single pass over visible water)
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
