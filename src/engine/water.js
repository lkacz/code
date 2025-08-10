// Simple cellular water simulation (spread & settle)
// Goal: performant, visually plausible, supports flow around obstacles and pooling.
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H, CHUNK_W} = MM;
  // Active water fronts tracked to limit scanning.
  const active=new Set(); // keys 'x,y'
  let passiveScanOffset = 0; // incremental column scan to catch dormant floating water
  // Wave effect now purely visual; no state caching needed to avoid altering simulation tiles.
  // Lateral spread pacing (seconds between lateral propagation attempts)
  const LATERAL_INTERVAL = 0.18; // increase to slow more (e.g., 0.3)
  let lateralAcc = 0; // accumulator
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
  lateralAcc += dt;
  const lateralStep = lateralAcc >= LATERAL_INTERVAL; // only allow lateral / spill once interval passes
  if(lateralStep) lateralAcc = 0;
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
      let moved=false;
      if(lateralStep){
        // 2. Edge spill diagonals (waterfall off ledges) - time gated
        const leftBelowAir = sy+1<WORLD_H && canFill(getTile(sx-1,sy+1));
        const rightBelowAir = sy+1<WORLD_H && canFill(getTile(sx+1,sy+1));
        function dropDepth(x){ let d=0; let yy=sy+1; while(yy<WORLD_H && canFill(getTile(x,yy)) && d<8){ d++; yy++; } return d; }
        if(leftBelowAir || rightBelowAir){
          let order=[];
          if(leftBelowAir && rightBelowAir){ const dl=dropDepth(sx-1); const dr=dropDepth(sx+1); order = dl>dr? [-1,1] : dr>dl? [1,-1] : ( ( (sx+sy)&1) ? [-1,1]:[1,-1] ); }
          else order = leftBelowAir? [-1]:[1];
          for(const dx of order){ if(canFill(getTile(sx+dx,sy+1))){ setTile(sx,sy,T.AIR); setTile(sx+dx,sy+1,T.WATER); next.add(k(sx+dx,sy+1)); markNeighbors(next,sx+dx,sy+1); moved=true; break; } }
          if(moved) continue;
        }
        // 3. Lateral leveling / downhill seeking - time gated
        if(lateralStep){
          const RANGE=6; // how far to scan horizontally for better spot
          const candidates=[];
          for(const dx of [-1,1]){
            const nx = sx+dx;
            if(!isAir(getTile(nx,sy))) continue; // must be empty target cell
            // If immediate drop exists, prefer strongly
            if(sy+1 < WORLD_H && canFill(getTile(nx,sy+1))){
              // measure drop depth
              let drop=0; let yy=sy+1; while(yy < WORLD_H && canFill(getTile(nx,yy)) && drop<8){ drop++; yy++; }
              candidates.push({dx,score: 100 - drop}); // lower drop depth slightly better (settle sooner)
              continue;
            }
            // Otherwise, scan outward contiguous air cells with solid floor beneath to approximate lateral pressure.
            let width=0; let blockedAhead=false; let foundLower=false; let floorConsistency=0;
            for(let step=1; step<=RANGE; step++){
              const tx = sx + dx*step;
              if(!isAir(getTile(tx,sy))) { blockedAhead=true; break; }
              const floor = getTile(tx,sy+1);
              if(floor!==T.AIR) floorConsistency++;
              // check if two steps ahead there's a drop
              if(!foundLower && sy+1 < WORLD_H && canFill(getTile(tx,sy+1))){ foundLower=true; }
              width++;
            }
            let score = width + floorConsistency*0.3 + (foundLower? 6:0) - (blockedAhead?0.2:0);
            candidates.push({dx,score});
          }
          if(candidates.length){
            candidates.sort((a,b)=> b.score - a.score || ((sx+sy)&1? b.dx - a.dx : a.dx - b.dx));
            const best = candidates[0];
            if(best.score>0){
              setTile(sx,sy,T.AIR); setTile(sx+best.dx,sy,T.WATER); next.add(k(sx+best.dx,sy)); markNeighbors(next,sx+best.dx,sy); moved=true;
            }
          }
        }
      }
      if(!moved){
        // stable this frame; keep it active if any neighbor open so it can move in a future lateral step
        if(isAir(getTile(sx-1,sy)) || isAir(getTile(sx+1,sy)) || isAir(getTile(sx,sy+1))){ next.add(key); }
      }
    }
    active.clear(); for(const kk of next) active.add(kk);
    // Periodic pressure leveling across wider basins (volume smoothing)
    pressureAcc += dt;
    if(pressureAcc >= PRESSURE_INTERVAL && active.size < 1200){
      pressureAcc = 0;
      runPressureLeveling(getTile,setTile);
    }
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
    if(active.size < 500){
      // Visual-only sloshing highlight: compute oscillation and draw translucent overlay shifting across surface gaps.
      const freq = 0.00045;
      ctx.save();
      for(let y=sy; y<sy+vy+2; y++){
        if(y<0||y>=WORLD_H) continue;
        let x = sx-2; const xEnd = sx+vx+2;
        while(x<=xEnd){
          const t=getTile(x,y); const below=getTile(x,y+1);
          const surfaceCandidate = below!==T.AIR && (t===T.WATER || t===T.AIR);
          if(!surfaceCandidate){ x++; continue; }
          const segStart = x; let seg=[]; let waterCount=0; let total=0; let hasAir=false; let hasWater=false;
          while(x<=xEnd){ const tt=getTile(x,y); const bb=getTile(x,y+1); const ok = (bb!==T.AIR) && (tt===T.WATER || tt===T.AIR); if(!ok) break; const surfaceWater = (tt===T.WATER && getTile(x,y-1)===T.AIR); seg.push({x,surfaceWater}); if(surfaceWater){ waterCount++; hasWater=true; } else { hasAir=true; } total++; x++; }
          const segEnd=x-1;
          if(hasWater && hasAir && total>1){
            const leftWall = (getTile(segStart-1,y)!==T.AIR && getTile(segStart-1,y)!==T.WATER) || getTile(segStart-1,y+1)===T.AIR;
            const rightWall = (getTile(segEnd+1,y)!==T.AIR && getTile(segEnd+1,y)!==T.WATER) || getTile(segEnd+1,y+1)===T.AIR;
            if(leftWall && rightWall){
              const phase=y*57.17; const oscill=(Math.sin(now*freq + phase)+1)/2; const offset=Math.floor(oscill * (total - waterCount));
              // Draw moving overlay representing where water would visually occupy
              ctx.fillStyle='rgba(36,119,255,0.22)';
              for(let i=0;i<waterCount;i++){ const cell=seg[offset+i]; if(cell){ ctx.fillRect(cell.x*TILE, y*TILE, TILE, TILE); } }
            }
          }
        }
      }
      ctx.restore();
    }
    // Base water surface shimmer
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
  // --- Pressure leveling support ---
  const PRESSURE_INTERVAL = 0.65; // seconds between smoothing passes
  let pressureAcc = 0;
  const MAX_SEG_WIDTH = 64; // cap scanning width
  const MAX_VERTICAL_SCAN = 48;
  function runPressureLeveling(getTile,setTile){
    // Sample up to N seeds from active set to attempt smoothing.
    const seeds = [...active];
    if(!seeds.length) return;
    // Shuffle lightly by sorting with hash parity to vary over time
    seeds.sort();
    let attempts = 0; const MAX_ATTEMPTS = 24;
    const visitedSegments = new Set();
    for(const key of seeds){
      if(attempts>=MAX_ATTEMPTS) break;
      const [sx,sy] = key.split(',').map(Number);
      if(getTile(sx,sy)!==T.WATER) continue;
      // Find surface for this column (top-most water with air above) within vertical window
      let topY = findSurfaceY(sx,sy,getTile);
      if(topY==null) continue;
      // Build horizontal segment of contiguous water-bearing columns (allow varying surface) up to width cap
      let L=sx, R=sx;
      while(R - L + 1 < MAX_SEG_WIDTH){
        // try extend left
        const nx = L-1; if(!columnHasWater(nx, topY, getTile)) break; L = nx;
      }
      while(R - L + 1 < MAX_SEG_WIDTH){
        const nx = R+1; if(!columnHasWater(nx, topY, getTile)) break; R = nx;
      }
      if(R-L+1 < 4) continue; // need a reasonable width
      const segKey = L+":"+R+":"+topY;
      if(visitedSegments.has(segKey)) continue;
      visitedSegments.add(segKey);
      // Collect column depths
      const cols=[]; let totalVolume=0; let minD=Infinity, maxD=0;
      for(let x=L; x<=R; x++){
        const col = measureColumn(x, topY, getTile);
        if(!col) { minD=0; continue; } // missing counts as zero depth
        cols.push(col);
        totalVolume += col.depth;
        if(col.depth < minD) minD = col.depth;
        if(col.depth > maxD) maxD = col.depth;
      }
      if(cols.length < (R-L+1)*0.5) continue; // too sparse
      if(maxD - minD < 2) continue; // already near level
      const width = (R-L+1);
      const targetBase = Math.floor(totalVolume / width);
      let remainder = totalVolume - targetBase*width;
      // Determine desired depth per x
      const desired = new Map();
      for(let x=L; x<=R; x++){
        let want = targetBase + (remainder>0?1:0);
        if(remainder>0) remainder--;
        desired.set(x, want);
      }
      // Perform a bounded number of transfers to move toward desired distribution
      let transfers=0, MAX_TRANSFERS=8;
      // Build depth map for quick updates
      const depthMap = new Map();
      for(let x=L; x<=R; x++) depthMap.set(x, measureDepthOnly(x, topY, getTile));
      while(transfers < MAX_TRANSFERS){
        // Find donor (depth > desired+1) and recipient (depth < desired)
        let donor=null, recipient=null, donorSurY=null, recipientSurY=null;
        for(let x=L; x<=R; x++){
          const d = depthMap.get(x)||0; const want = desired.get(x);
          if(d > want){ donor = x; donorSurY = findSurfaceY(x, topY, getTile); break; }
        }
        if(donor==null) break;
        for(let x=R; x>=L; x--){
          const d = depthMap.get(x)||0; const want = desired.get(x);
          if(d < want){ recipient = x; recipientSurY = findSurfaceY(x, topY, getTile); break; }
        }
        if(recipient==null) break;
        // Remove top water from donor
        if(donorSurY==null) break;
        setTile(donor, donorSurY, T.AIR);
        // Add water to recipient (above its surface or on floor)
        let addY;
        if(recipientSurY==null){
          // find floor within vertical scan
            let ySearch = topY; let lastSolid = null; let limit=MAX_VERTICAL_SCAN; while(limit-- >0 && ySearch < WORLD_H){
              const t = getTile(recipient, ySearch);
              if(t!==T.AIR && t!==T.WATER){ lastSolid = ySearch; break; }
              ySearch++;
            }
            if(lastSolid==null) { transfers++; continue; }
            addY = lastSolid -1; // just above floor
        } else {
          addY = recipientSurY -1; // one above current surface top
        }
        if(addY >=0 && addY < WORLD_H && getTile(recipient, addY)===T.AIR){
          setTile(recipient, addY, T.WATER);
          depthMap.set(donor, (depthMap.get(donor)||1)-1);
          depthMap.set(recipient, (depthMap.get(recipient)||0)+1);
          markNeighbors(active, donor, donorSurY); markNeighbors(active, recipient, addY);
          transfers++;
        } else {
          // failed placement; revert donor removal to avoid volume loss
          setTile(donor, donorSurY, T.WATER);
          break;
        }
      }
      attempts++;
    }
  }
  function measureColumn(x, topHintY, getTile){
    const surf = findSurfaceY(x, topHintY, getTile);
    if(surf==null) return null;
    let y=surf; let depth=0; while(y < WORLD_H && getTile(x,y)===T.WATER && depth < MAX_VERTICAL_SCAN){ depth++; y++; }
    return {x, surface: surf, depth};
  }
  function measureDepthOnly(x, topHintY, getTile){
    const surf = findSurfaceY(x, topHintY, getTile); if(surf==null) return 0; let y=surf; let d=0; while(y < WORLD_H && getTile(x,y)===T.WATER && d < MAX_VERTICAL_SCAN){ d++; y++; } return d; }
  function findSurfaceY(x, yStart, getTile){
    // ascend to find top-most water with air above within bounds
    let y=yStart; let steps=0; // first ensure we are inside water column or near it
    if(getTile(x,y)!==T.WATER){
      // search downward to find water
      while(steps<MAX_VERTICAL_SCAN && y < WORLD_H && getTile(x,y)!==T.WATER){ y++; steps++; }
      if(getTile(x,y)!==T.WATER) return null;
    }
    // ascend to top
    while(y>0 && getTile(x,y-1)===T.WATER && steps<MAX_VERTICAL_SCAN){ y--; steps++; }
    // confirm air above
    if(getTile(x,y-1)!==T.AIR && y>0) return null;
    return y;
  }
  function columnHasWater(x, topY, getTile){
    // quick check: search small vertical window for water
    for(let dy=-4; dy<=4; dy++){ const yy=topY+dy; if(yy>=0 && yy<WORLD_H && getTile(x,yy)===T.WATER) return true; }
    return false;
  }
  MM.water={update,addSource,drawOverlay,onTileChanged,reset};
})();
