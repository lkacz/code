// Simple cellular water simulation (spread, settle, pressure leveling)
// Goal: performant, visually plausible, supports flow around obstacles and pooling.
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H} = MM;
  const active = new Set(); // 'x,y'
  let passiveScanOffset = 0;
  // Visual effects
  const ripples = []; // {L,R,y,ttl,originalTTL}
  let lastOverlayTime = performance.now(); // for ripple timing based on real elapsed ms
  // Lateral energy cooldown after pressure smoothing
  const lateralCooldown = new Map(); // x -> seconds remaining
  const LATERAL_INTERVAL = 0.18;
  let lateralAcc = 0;
  // Adaptive pressure leveling cadence
  const PRESSURE_INTERVAL_MIN = 0.30;
  const PRESSURE_INTERVAL_BASE = 0.65;
  const PRESSURE_INTERVAL_MAX = 1.20;
  let pressureIntervalCurrent = PRESSURE_INTERVAL_BASE;
  let pressureAcc = 0;
  // Pressure leveling limits
  const MAX_SEG_WIDTH = 64;
  const MAX_VERTICAL_SCAN = 48;
  function k(x,y){ return x+","+y; }
  function mark(x,y){ active.add(k(x,y)); }
  function isAir(t){ return t===T.AIR; }
  function canFill(t){ return t===T.AIR || t===T.LEAF; }

  function update(getTile,setTile,dt){
    // Passive activation slice
    if(active.size===0){
      const SCAN_COLS=40;
      for(let i=0;i<SCAN_COLS;i++){
        const wx = passiveScanOffset + i; passiveScanOffset++;
        if(passiveScanOffset>5_000_000) passiveScanOffset=0;
        for(let y=0;y<WORLD_H-1;y++){
          if(getTile(wx,y)===T.WATER && canFill(getTile(wx,y+1))){ mark(wx,y); break; }
        }
      }
      if(active.size===0) return;
    }
    const size = active.size;
    const MAX = Math.min(2000, 300 + Math.floor(size*0.35));
    // Cooldown decay
    if(lateralCooldown.size){
      for(const [cx,val] of lateralCooldown){ const nv=val-dt; if(nv<=0) lateralCooldown.delete(cx); else lateralCooldown.set(cx,nv); }
    }
    let processed=0; const next=new Set();
    const keys=[...active]; keys.sort();
    lateralAcc += dt; const lateralStep = lateralAcc >= LATERAL_INTERVAL; if(lateralStep) lateralAcc=0;
    for(const key of keys){
      if(processed++>MAX){ next.add(key); continue; }
      const [sx,sy] = key.split(',').map(Number);
      if(getTile(sx,sy)!==T.WATER) continue;
      // Gravity (multi-cell drop)
      if(sy+1 < WORLD_H && canFill(getTile(sx,sy+1))){
        let ny=sy+1; const MAX_FALL=12; while(ny+1<WORLD_H && canFill(getTile(sx,ny+1)) && (ny-sy)<MAX_FALL){ ny++; }
        setTile(sx,sy,T.AIR); setTile(sx,ny,T.WATER); next.add(k(sx,ny)); markNeighbors(next,sx,ny); continue;
      }
      let moved=false;
      if(lateralStep && !(lateralCooldown.get(sx)>0)){
        // Edge spills
        const leftBelowAir = sy+1<WORLD_H && canFill(getTile(sx-1,sy+1));
        const rightBelowAir= sy+1<WORLD_H && canFill(getTile(sx+1,sy+1));
        function dropDepth(x){ let d=0, yy=sy+1; while(yy<WORLD_H && canFill(getTile(x,yy)) && d<8){ d++; yy++; } return d; }
        if(leftBelowAir || rightBelowAir){
          let order=[];
            if(leftBelowAir && rightBelowAir){ const dl=dropDepth(sx-1); const dr=dropDepth(sx+1); order = dl>dr?[-1,1]:dr>dl?[1,-1]:(((sx+sy)&1)?[-1,1]:[1,-1]); }
            else order = leftBelowAir?[-1]:[1];
          for(const dx of order){ if(canFill(getTile(sx+dx,sy+1))){ setTile(sx,sy,T.AIR); setTile(sx+dx,sy+1,T.WATER); next.add(k(sx+dx,sy+1)); markNeighbors(next,sx+dx,sy+1); moved=true; break; } }
          if(moved) continue;
        }
        // Lateral leveling / downhill seeking
        const RANGE=6; const candidates=[];
        for(const dx of [-1,1]){
          const nx=sx+dx; if(!isAir(getTile(nx,sy))) continue;
          if(sy+1<WORLD_H && canFill(getTile(nx,sy+1))){ // immediate drop
            let drop=0, yy=sy+1; while(yy<WORLD_H && canFill(getTile(nx,yy)) && drop<8){ drop++; yy++; }
            candidates.push({dx,score:100-drop}); continue;
          }
          let width=0, blockedAhead=false, foundLower=false, floorConsistency=0;
          for(let step=1; step<=RANGE; step++){
            const tx=sx+dx*step; if(!isAir(getTile(tx,sy))){ blockedAhead=true; break; }
            const floor=getTile(tx,sy+1); if(floor!==T.AIR) floorConsistency++;
            if(!foundLower && sy+1<WORLD_H && canFill(getTile(tx,sy+1))) foundLower=true;
            width++;
          }
          const score = width + floorConsistency*0.3 + (foundLower?6:0) - (blockedAhead?0.2:0);
          candidates.push({dx,score});
        }
        if(candidates.length){
          candidates.sort((a,b)=> b.score - a.score || (((sx+sy)&1)? b.dx - a.dx : a.dx - b.dx));
          const best=candidates[0]; if(best.score>0){ setTile(sx,sy,T.AIR); setTile(sx+best.dx,sy,T.WATER); next.add(k(sx+best.dx,sy)); markNeighbors(next,sx+best.dx,sy); moved=true; }
        }
      }
      if(!moved){ if(isAir(getTile(sx-1,sy)) || isAir(getTile(sx+1,sy)) || isAir(getTile(sx,sy+1))) next.add(key); }
    }
    active.clear(); for(const kk of next) active.add(kk);
    // Pressure leveling scheduling
    pressureAcc += dt;
    if(pressureAcc >= pressureIntervalCurrent && active.size < 1200){
      pressureAcc=0; const result=runPressureLeveling(getTile,setTile);
      if(result){
        const {touchedXs, variance, hadTransfers} = result;
        if(hadTransfers){
          const COOLDOWN=0.45;
          for(const x of touchedXs) lateralCooldown.set(x, Math.max(lateralCooldown.get(x)||0, COOLDOWN));
          if(touchedXs.size){
            active.clear();
            for(const x of touchedXs){
              // find first water tile in column (cheap linear; columns small on average)
              for(let y=0;y<WORLD_H;y++){ if(getTile(x,y)===T.WATER){ active.add(k(x,y)); break; } }
            }
          }
        }
        if(variance!=null){
          let v=variance; if(v>12) v=12; const t=v/12; // 0..1
          const target = PRESSURE_INTERVAL_MAX - (PRESSURE_INTERVAL_MAX-PRESSURE_INTERVAL_MIN)*t;
          pressureIntervalCurrent = pressureIntervalCurrent*0.7 + target*0.3;
        }
      }
    }
    if(active.size>6000){
      // Hard cap active set deterministically (already sorted earlier); avoids O(n^2) deletes mid-iteration
      const limited = [...active].slice(0,6000);
      active.clear();
      for(const id of limited) active.add(id);
    }
  }

  function markNeighbors(set,x,y){ set.add(k(x-1,y)); set.add(k(x+1,y)); set.add(k(x,y-1)); set.add(k(x,y+1)); }
  function addSource(x,y,getTile,setTile){ const cur=getTile(x,y); if(cur===T.AIR){ setTile(x,y,T.WATER); mark(x,y); return true; } if(cur===T.WATER){ mark(x,y); return true; } return false; }
  function onTileChanged(x,y,getTile){ for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){ if(getTile(x+dx,y+dy)===T.WATER) mark(x+dx,y+dy); } }

  function drawOverlay(ctx,TILE,getTile,sx,sy,vx,vy){
    const now=performance.now();
    const frameDt = Math.min(200, Math.max(5, now - lastOverlayTime)); // clamp dt (ms)
    lastOverlayTime = now;
    if(active.size < 500){
      const freq=0.00045; ctx.save();
      for(let y=sy; y<sy+vy+2; y++){
        if(y<0||y>=WORLD_H) continue; let x=sx-2; const xEnd=sx+vx+2;
        while(x<=xEnd){
          const t=getTile(x,y); const below=getTile(x,y+1); const surfaceCandidate = below!==T.AIR && (t===T.WATER || t===T.AIR);
          if(!surfaceCandidate){ x++; continue; }
          const segStart=x; let seg=[]; let waterCount=0,total=0,hasAir=false,hasWater=false;
          while(x<=xEnd){ const tt=getTile(x,y); const bb=getTile(x,y+1); const ok=(bb!==T.AIR)&&(tt===T.WATER||tt===T.AIR); if(!ok) break; const surfaceWater=(tt===T.WATER && getTile(x,y-1)===T.AIR); seg.push({x,surfaceWater}); if(surfaceWater){ waterCount++; hasWater=true; } else { hasAir=true; } total++; x++; }
          const segEnd=x-1; if(hasWater && hasAir && total>1){
            const leftWall = (getTile(segStart-1,y)!==T.AIR && getTile(segStart-1,y)!==T.WATER) || getTile(segStart-1,y+1)===T.AIR;
            const rightWall= (getTile(segEnd+1,y)!==T.AIR && getTile(segEnd+1,y)!==T.WATER) || getTile(segEnd+1,y+1)===T.AIR;
            if(leftWall && rightWall){ const phase=y*57.17; const oscill=(Math.sin(now*freq + phase)+1)/2; const offset=Math.floor(oscill*(total-waterCount)); ctx.fillStyle='rgba(36,119,255,0.22)'; for(let i=0;i<waterCount;i++){ const cell=seg[offset+i]; if(cell) ctx.fillRect(cell.x*TILE,y*TILE,TILE,TILE); } }
          }
        }
      }
      ctx.restore();
    }
    // Ripples
    if(ripples.length){
      for(let i=ripples.length-1;i>=0;i--){
        const r=ripples[i]; r.ttl -= frameDt; if(r.ttl<=0){ ripples.splice(i,1); continue; }
        if(r.y>=sy-1 && r.y<=sy+vy+2){
          const life=r.ttl/(r.originalTTL||600);
            const alpha=0.05+0.08*life;
            const phase=now*0.004;
            for(let x=r.L;x<=r.R;x++){
              if(x<sx-2||x>sx+vx+2) continue;
              const h=Math.sin(phase + x*0.9 + r.y*0.3)*0.5 + 0.5;
              const a2=alpha*0.6*h;
              ctx.fillStyle='rgba(180,200,255,'+a2.toFixed(3)+')';
              ctx.fillRect(x*TILE,r.y*TILE,TILE,2);
            }
        }
      }
    }
    // Base shimmer
    for(let y=sy; y<sy+vy+2; y++){
      if(y<0||y>=WORLD_H) continue;
      for(let x=sx; x<sx+vx+2; x++){
        if(getTile(x,y)===T.WATER){ const h=(Math.sin((x*13.1 + now*0.003))+Math.sin((y*7.7 + now*0.002)))*0.5; const alpha=0.35+0.15*h; ctx.fillStyle='rgba(36,119,255,'+alpha.toFixed(3)+')'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); if(getTile(x,y-1)===T.AIR){ ctx.fillStyle='rgba(255,255,255,0.07)'; ctx.fillRect(x*TILE,y*TILE,TILE,2);} }
      }
    }
  }

  function reset(){ active.clear(); ripples.length=0; lateralCooldown.clear(); }
  function snapshot(){
    try{ return {v:1, active:[...active].map(k=>k.split(',').map(Number)), ripples:ripples.map(r=>({L:r.L,R:r.R,y:r.y,ttl:r.ttl,orig:r.originalTTL})), lateral:[...lateralCooldown.entries()], passiveScanOffset, pressureIntervalCurrent, pressureAcc, lateralAcc}; }catch(e){ return null; }
  }
  function restore(s){ if(!s||typeof s!=='object') return; reset(); try{ if(Array.isArray(s.active)) for(const a of s.active){ if(Array.isArray(a)&&a.length===2){ active.add(a[0]+","+a[1]); } } if(Array.isArray(s.ripples)) for(const r of s.ripples){ ripples.push({L:r.L|0,R:r.R|0,y:r.y|0,ttl:r.ttl|0,originalTTL:r.orig||r.ttl}); } if(Array.isArray(s.lateral)) for(const [x,val] of s.lateral){ if(typeof x==='number'&&typeof val==='number') lateralCooldown.set(x,val); } if(typeof s.passiveScanOffset==='number') passiveScanOffset=s.passiveScanOffset; if(typeof s.pressureIntervalCurrent==='number') pressureIntervalCurrent=s.pressureIntervalCurrent; if(typeof s.pressureAcc==='number') pressureAcc=s.pressureAcc; if(typeof s.lateralAcc==='number') lateralAcc=s.lateralAcc; }catch(e){} }

  function runPressureLeveling(getTile,setTile){
    const seeds=[...active]; if(!seeds.length) return null; seeds.sort();
    const visitedSegments=new Set(); const touchedXs=new Set(); let variance=null; let hadTransfers=false; let attempts=0; const MAX_ATTEMPTS=24;
    for(const key of seeds){
      if(attempts>=MAX_ATTEMPTS) break;
      const [sx,sy]=key.split(',').map(Number);
      if(getTile(sx,sy)!==T.WATER) continue;
      const seedSurface = findSurfaceY(sx,sy,getTile); if(seedSurface==null) continue;
      // Expand horizontally for contiguous water-bearing columns
      let L=sx,R=sx;
      while(R-L+1<MAX_SEG_WIDTH){ const nx=L-1; if(!columnHasWater(nx,seedSurface,getTile)) break; L=nx; }
      while(R-L+1<MAX_SEG_WIDTH){ const nx=R+1; if(!columnHasWater(nx,seedSurface,getTile)) break; R=nx; }
      if(R-L+1<4) continue;
      const segKey=L+":"+R+":"+seedSurface; if(visitedSegments.has(segKey)) continue; visitedSegments.add(segKey);
      // Collect column info
      const cols=[]; let totalVolume=0; let minSurface=Infinity,maxSurface=-Infinity; let sealed=true; let sumFloors=0; let minFloor=Infinity;
      for(let x=L;x<=R;x++){
        const col=measureColumn(x,seedSurface,getTile); if(!col){ sealed=false; break; }
        const floor = col.surface + col.depth; // y just below water
        const bottomY = floor -1;
        if(bottomY+1 < WORLD_H && canFill(getTile(x,bottomY+1))){ sealed=false; break; }
        cols.push({x, surface: col.surface, depth: col.depth, floor});
        totalVolume += col.depth;
        if(col.surface < minSurface) minSurface=col.surface; if(col.surface > maxSurface) maxSurface=col.surface;
        sumFloors += floor; if(floor < minFloor) minFloor=floor;
      }
      if(!sealed) continue;
      if(cols.length < (R-L+1)*0.5) continue;
      if(maxSurface - minSurface <= 1) continue; // already nearly level
      const n=cols.length;
      const S_float = (sumFloors - totalVolume)/n;
      let S_low = Math.floor(S_float);
      if(S_low >= minFloor) S_low = minFloor - 1;
      // Compute how many columns must be one deeper (surface lowered by 1) to match volume
      let V_low=0; for(const c of cols){ V_low += (c.floor - S_low); }
      const excess = V_low - totalVolume; // columns to raise surface by +1 (shallower)
      const shallowSorted = [...cols].sort((a,b)=> (a.floor - S_low) - (b.floor - S_low));
      let need=excess; const surfaceMap=new Map();
      for(const c of shallowSorted){ let targetSurface=S_low; if(need>0 && (c.floor - S_low) > 1){ targetSurface = S_low+1; need--; } surfaceMap.set(c.x,targetSurface); }
      // Rewrite columns
      for(const c of cols){
        const targetSurface = surfaceMap.get(c.x);
        const targetDepth = c.floor - targetSurface;
        if(targetDepth === c.depth && targetSurface === c.surface) continue;
        // Clear old water column
        for(let y=c.surface; y<c.surface + c.depth; y++){ setTile(c.x,y,T.AIR); }
        // Fill new
        for(let d=0; d<targetDepth; d++){ const y = c.floor -1 - d; if(y>=0 && y<WORLD_H) setTile(c.x,y,T.WATER); }
        touchedXs.add(c.x);
      }
      if(touchedXs.size){ hadTransfers=true; ripples.push({L,R,y:S_low,ttl:600,originalTTL:600}); }
      const diff=maxSurface - minSurface; if(variance==null || diff>variance) variance=diff;
      attempts++;
    }
    return {touchedXs, variance, hadTransfers};
  }

  function measureColumn(x, topHintY, getTile){ const surf=findSurfaceY(x,topHintY,getTile); if(surf==null) return null; let y=surf, depth=0; while(y<WORLD_H && getTile(x,y)===T.WATER && depth<MAX_VERTICAL_SCAN){ depth++; y++; } return {x,surface:surf,depth}; }
  function measureDepthOnly(x, topHintY, getTile){ const surf=findSurfaceY(x,topHintY,getTile); if(surf==null) return 0; let y=surf,d=0; while(y<WORLD_H && getTile(x,y)===T.WATER && d<MAX_VERTICAL_SCAN){ d++; y++; } return d; }
  function findSurfaceY(x,yStart,getTile){ let y=yStart, steps=0; if(getTile(x,y)!==T.WATER){ while(steps<MAX_VERTICAL_SCAN && y<WORLD_H && getTile(x,y)!==T.WATER){ y++; steps++; } if(getTile(x,y)!==T.WATER) return null; }
    while(y>0 && getTile(x,y-1)===T.WATER && steps<MAX_VERTICAL_SCAN){ y--; steps++; }
    if(getTile(x,y-1)!==T.AIR && y>0) return null; return y; }
  function columnHasWater(x, topY, getTile){ for(let dy=-4; dy<=4; dy++){ const yy=topY+dy; if(yy>=0 && yy<WORLD_H && getTile(x,yy)===T.WATER) return true; } return false; }

  // (duplicate reset removed; single reset keeps state consistent)
  MM.water = {update, addSource, drawOverlay, onTileChanged, reset, snapshot, restore};
})();
