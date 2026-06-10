// Dynamic water system: cellular fluid simulation + spring-based surface waves + layered FX.
//
// Simulation (tile level, deterministic, volume conserving):
//   gravity drops, edge spills, lateral downhill seeking, hydrostatic pressure leveling.
// Presentation (strictly cosmetic — never mutates tiles):
//   * one damped oscillator ("surface spring") per water column; neighbor coupling makes
//     disturbances travel outward as waves (player dives, falling blocks, waterfalls, flow)
//   * smooth continuous surface mesh (per-column quads sharing edge heights)
//   * depth-graded translucent body, animated caustic web, drifting light shafts,
//     surface sheen + sparkle glints, shoreline foam
//   * waterfall streams with bright cores, falling streaks and impact mist
//   * ambient bubbles in deep water (rendered by the shared particle module)
// Everything draws to an offscreen layer; effects are clipped to the water shape with
// 'source-atop' compositing, then the layer blends onto the scene in one drawImage.
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H} = MM;

  // ---------------- Simulation state ----------------
  const active = new Set(); // 'x,y'
  // Cells that settled laterally but may still need pressure leveling (consumed per pass)
  const pressureSeeds = new Set();
  let passiveScanOffset = 0;
  // Boundaries of freshly generated chunks awaiting a water wake (drained in update)
  const chunkWakes = [];
  // Lateral energy cooldown after pressure smoothing
  const lateralCooldown = new Map(); // x -> seconds remaining
  const LATERAL_INTERVAL = 0.16;
  let lateralAcc = 0;
  // Adaptive pressure leveling cadence
  const PRESSURE_INTERVAL_MIN = 0.30;
  const PRESSURE_INTERVAL_BASE = 0.65;
  const PRESSURE_INTERVAL_MAX = 1.20;
  let pressureIntervalCurrent = PRESSURE_INTERVAL_BASE;
  let pressureAcc = 0;
  // Vertical scan bound (displacement search)
  const MAX_VERTICAL_SCAN = 48;

  // ---------------- FX state ----------------
  const springs = new Map();        // x -> {o:px offset, v:px/s, y:surface tile row, seen:frame}
  const pendingImpulse = new Map(); // x -> accumulated velocity kick, applied when column renders
  const streams = [];               // waterfalls {x, y0, y1, ttl}
  const STREAM_TTL = 0.5;
  const SPR_K = 50;                 // spring stiffness toward rest level (1/s^2)
  const SPR_D = 3.6;                // damping (1/s)
  const SPR_SPREAD = 30;            // neighbor coupling (1/s^2 per px of height difference)
  let frameNo = 0;
  let lastOverlayTime = performance.now();
  let offCanvas = null, offCtx = null;

  function k(x,y){ return x+","+y; }
  function mark(x,y){ active.add(k(x,y)); }
  function isAir(t){ return t===T.AIR; }
  function canFill(t){ return t===T.AIR || t===T.LEAF; }
  function hash32(x,y){ let h=(x|0)*374761393+(y|0)*668265263; h=(h^(h>>>13))*1274126177; return (h^(h>>>16))>>>0; }

  // Public wave kick: positive impulse pushes the surface down (entry), negative lifts it.
  function disturb(x, impulse){
    if(typeof x!=='number' || typeof impulse!=='number' || !isFinite(impulse)) return;
    const xi = Math.floor(x);
    let nv = (pendingImpulse.get(xi)||0) + impulse;
    if(nv>420) nv=420; else if(nv<-420) nv=-420;
    pendingImpulse.set(xi, nv);
  }

  // World generation finished a chunk spanning tile columns [x0..x1]: queue a boundary
  // wake (processed in update, where tile accessors are available).
  function noteChunkGenerated(x0,x1){
    if(typeof x0!=='number' || typeof x1!=='number') return;
    if(chunkWakes.length<64) chunkWakes.push({x0,x1});
  }

  // A multi-cell gravity drop = waterfall: keep a short-lived stream visual alive while
  // flow continues, splash + kick the surface springs at the impact point.
  function noteFall(x,y0,y1){
    let st=null;
    for(const s of streams){ if(s.x===x && Math.abs(s.y1-y1)<=2 && s.y0<=y1 && y0<=s.y1+2){ st=s; break; } }
    if(st){ st.ttl=STREAM_TTL; if(y0<st.y0) st.y0=y0; st.y1=y1; }
    else if(streams.length<48){
      streams.push({x,y0,y1,ttl:STREAM_TTL});
      try{ const p=MM.particles; if(p && p.spawnSplash) p.spawnSplash((x+0.5)*(MM.TILE||20), (y1+0.6)*(MM.TILE||20), 0.35); }catch(e){}
    }
    disturb(x, 120);
  }

  function update(getTile,setTile,dt){
    // Newly generated chunks: wake water along their boundary columns. World generation
    // can place caves right beside dormant water (or water beside old caves) and nothing
    // else notifies the sim about that seam.
    if(chunkWakes.length){
      for(let n=0;n<2 && chunkWakes.length;n++){
        const {x0,x1}=chunkWakes.shift();
        let woke=false;
        for(const wx of [x0-1,x0,x1,x1+1]){
          for(let y=1;y<WORLD_H-1;y++){
            if(getTile(wx,y)!==T.WATER) continue;
            if(canFill(getTile(wx,y+1)) || isAir(getTile(wx-1,y)) || isAir(getTile(wx+1,y))){ mark(wx,y); woke=true; }
          }
        }
        if(woke) pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.5);
      }
    }
    // Passive activation slice: sweep a window around the player (worlds extend into
    // negative x — an absolute 0..N sweep would never reach half the map). Runs whenever
    // the sim is mostly idle, and also wakes pressurized cells facing a side opening —
    // not just fall candidates — so dormant anomalies (suspended layers, chunk seams)
    // self-heal instead of hanging forever.
    if(active.size<32){
      const SCAN_COLS=40, SCAN_RADIUS=240;
      const span=SCAN_RADIUS*2+1;
      const p=(typeof window!=='undefined' && window.player);
      const cx=(p && isFinite(p.x))? Math.floor(p.x) : 0;
      for(let i=0;i<SCAN_COLS;i++){
        const wx = cx - SCAN_RADIUS + ((passiveScanOffset+i)%span);
        for(let y=1;y<WORLD_H-1;y++){
          if(getTile(wx,y)!==T.WATER) continue;
          if(canFill(getTile(wx,y+1))){ mark(wx,y); break; }                 // can fall
          const lA=isAir(getTile(wx-1,y)), rA=isAir(getTile(wx+1,y));
          if(!lA && !rA) continue;
          if(getTile(wx,y-1)===T.WATER){ mark(wx,y); break; }                // can push (head)
          // can spill or seek: a drop somewhere along an open same-row path
          let drop=false;
          for(const dx of [-1,1]){
            if((dx<0 && !lA) || (dx>0 && !rA)) continue;
            for(let s2=1;s2<=6 && !drop;s2++){
              const tx=wx+dx*s2;
              if(!isAir(getTile(tx,y))) break;
              if(canFill(getTile(tx,y+1))) drop=true;
            }
            if(drop) break;
          }
          if(drop){ mark(wx,y); break; }
        }
      }
      passiveScanOffset=(passiveScanOffset+SCAN_COLS)%span;
      if(active.size===0 && pressureSeeds.size===0) return;
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
        setTile(sx,sy,T.AIR); setTile(sx,ny,T.WATER); next.add(k(sx,ny)); markNeighbors(next,sx,ny);
        if(ny-sy>=2) noteFall(sx,sy,ny);
        continue;
      }
      let moved=false;
      const lateralEvaluated = lateralStep && !(lateralCooldown.get(sx)>0);
      if(lateralEvaluated){
        // Edge spills — the same-row side cell must be passable too: a diagonal-only
        // check lets water clip through solid wall corners into sealed pockets
        const leftBelowAir = sy+1<WORLD_H && canFill(getTile(sx-1,sy)) && canFill(getTile(sx-1,sy+1));
        const rightBelowAir= sy+1<WORLD_H && canFill(getTile(sx+1,sy)) && canFill(getTile(sx+1,sy+1));
        function dropDepth(x){ let d=0, yy=sy+1; while(yy<WORLD_H && canFill(getTile(x,yy)) && d<8){ d++; yy++; } return d; }
        if(leftBelowAir || rightBelowAir){
          let order=[];
            if(leftBelowAir && rightBelowAir){ const dl=dropDepth(sx-1); const dr=dropDepth(sx+1); order = dl>dr?[-1,1]:dr>dl?[1,-1]:(((sx+sy)&1)?[-1,1]:[1,-1]); }
            else order = leftBelowAir?[-1]:[1];
          for(const dx of order){ if(canFill(getTile(sx+dx,sy)) && canFill(getTile(sx+dx,sy+1))){ setTile(sx,sy,T.AIR); setTile(sx+dx,sy+1,T.WATER); next.add(k(sx+dx,sy+1)); markNeighbors(next,sx+dx,sy+1); disturb(sx+dx,46); moved=true; break; } }
          if(moved) continue;
        }
        // Lateral downhill seeking: only move sideways when a drop exists within range —
        // otherwise a lone puddle random-walks across flat ground forever.
        const RANGE=6; const candidates=[];
        for(const dx of [-1,1]){
          const nx=sx+dx; if(!isAir(getTile(nx,sy))) continue;
          if(sy+1<WORLD_H && canFill(getTile(nx,sy+1))){ // immediate drop
            let drop=0, yy=sy+1; while(yy<WORLD_H && canFill(getTile(nx,yy)) && drop<8){ drop++; yy++; }
            candidates.push({dx,score:100-drop}); continue;
          }
          let width=0, foundLower=false, floorConsistency=0;
          for(let step=1; step<=RANGE; step++){
            const tx=sx+dx*step; if(!isAir(getTile(tx,sy))) break;
            if(sy+1<WORLD_H && canFill(getTile(tx,sy+1))){ foundLower=true; break; }
            floorConsistency++; width++;
          }
          if(!foundLower) continue;
          candidates.push({dx,score:width + floorConsistency*0.3 + 6});
        }
        if(candidates.length){
          candidates.sort((a,b)=> b.score - a.score || (((sx+sy)&1)? b.dx - a.dx : a.dx - b.dx));
          const best=candidates[0]; if(best.score>0){ setTile(sx,sy,T.AIR); setTile(sx+best.dx,sy,T.WATER); next.add(k(sx+best.dx,sy)); markNeighbors(next,sx+best.dx,sy); moved=true; }
        }
        // Pressurized sideways push: a cell with hydraulic head (water directly above)
        // seeps into a same-level opening even with no drop in range — quick local
        // response when a wall is mined out. The receiver has air above (no head), so it
        // can never push the unit back: no oscillation. Roof-capped runs (1-tall tunnels)
        // are filled by pressure leveling instead, which joins dry columns below the
        // waterline. Open surface cells have no head, so lone puddles can't random-walk.
        if(!moved && getTile(sx,sy-1)===T.WATER){
          for(const dx of (((sx+sy)&1)?[-1,1]:[1,-1])){
            const nx=sx+dx;
            if(!isAir(getTile(nx,sy))) continue;
            if(!(sy+1<WORLD_H) || canFill(getTile(nx,sy+1))) continue; // a drop: spill logic owns it
            setTile(sx,sy,T.AIR); setTile(nx,sy,T.WATER);
            next.add(k(nx,sy)); markNeighbors(next,sx,sy); markNeighbors(next,nx,sy);
            if(pressureSeeds.size<2000) pressureSeeds.add(k(nx,sy));
            // bring the next leveling pass forward so the new column rises promptly
            pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.6);
            disturb(nx, 30);
            moved=true; break;
          }
        }
      }
      if(!moved){
        if(lateralEvaluated){
          // Fully evaluated and stable: leave the hot set, but stay visible to pressure leveling
          if(sy+1<WORLD_H && canFill(getTile(sx,sy+1))) next.add(key);
          else {
            // A cell with head facing a same-level opening is a flood front whose feed
            // refills asynchronously — keep it hot or the advance stalls between ticks
            const pushable = getTile(sx,sy-1)===T.WATER && (
              (isAir(getTile(sx-1,sy)) && sy+1<WORLD_H && !canFill(getTile(sx-1,sy+1))) ||
              (isAir(getTile(sx+1,sy)) && sy+1<WORLD_H && !canFill(getTile(sx+1,sy+1))));
            if(pushable) next.add(key);
            else if(pressureSeeds.size<2000) pressureSeeds.add(key);
          }
        } else if(isAir(getTile(sx-1,sy)) || isAir(getTile(sx+1,sy)) || isAir(getTile(sx,sy+1))) next.add(key);
        else if(pressureSeeds.size<2000) pressureSeeds.add(key); // skipped under cooldown: stay visible to leveling
      }
    }
    active.clear(); for(const kk of next) active.add(kk);
    // Pressure leveling scheduling
    pressureAcc += dt;
    if(pressureAcc >= pressureIntervalCurrent && active.size < 1200){
      pressureAcc=0; const result=runPressureLeveling(getTile,setTile);
      if(result){
        const {touchedXs, variance, hadTransfers} = result;
        if(hadTransfers){
          // Short cooldown: long blanket cooldowns choke drains (e.g. a lake emptying
          // into a dug shaft re-levels every pass, freezing its own outflow columns)
          const COOLDOWN=0.25;
          for(const x of touchedXs) lateralCooldown.set(x, Math.max(lateralCooldown.get(x)||0, COOLDOWN));
          // Re-mark touched columns but KEEP the rest of the active set: clearing it here
          // killed in-progress flood fronts elsewhere (cells the leveling didn't touch)
          // and left bodies permanently unsettled.
          for(const x of touchedXs){
            // find first water tile in column (cheap linear; columns small on average)
            for(let y=0;y<WORLD_H;y++){ if(getTile(x,y)===T.WATER){ active.add(k(x,y)); break; } }
            // gentle alternating wave kick so leveling reads as sloshing, not teleporting
            disturb(x, (x&1)? 56 : -56);
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
  function addSource(x,y,getTile,setTile){ const cur=getTile(x,y); if(cur===T.AIR){ setTile(x,y,T.WATER); mark(x,y); disturb(x,140); return true; } if(cur===T.WATER){ mark(x,y); return true; } return false; }
  function onTileChanged(x,y,getTile){
    let woke=false;
    for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){ if(getTile(x+dx,y+dy)===T.WATER){ mark(x+dx,y+dy); woke=true; } }
    // A world edit beside water: bring the next leveling pass forward so the body
    // reacts promptly (fills the opening / flattens) instead of waiting out the timer
    if(woke) pressureAcc=Math.max(pressureAcc, pressureIntervalCurrent*0.5);
  }
  // A solid is about to overwrite the water at (x,y): conserve volume by moving that
  // unit to the nearest opening — above the column it belongs to, else beside it.
  function displaceAt(x,y,getTile,setTile){
    let ty=y-1, steps=0;
    while(ty>=0 && getTile(x,ty)===T.WATER && steps<MAX_VERTICAL_SCAN){ ty--; steps++; }
    if(ty>=0 && getTile(x,ty)===T.AIR){ setTile(x,ty,T.WATER); mark(x,ty); markNeighbors(active,x,ty); disturb(x,90); return true; }
    for(const dx of [-1,1]){ if(getTile(x+dx,y)===T.AIR){ setTile(x+dx,y,T.WATER); mark(x+dx,y); markNeighbors(active,x+dx,y); disturb(x+dx,70); return true; } }
    return false; // fully sealed pocket — the unit is lost
  }

  // ---------------- Rendering ----------------
  function drawOverlay(ctx,TILE,getTile,sx,sy,vx,vy){
    const now=performance.now();
    const dtMs=Math.min(50, Math.max(4, now-lastOverlayTime)); lastOverlayTime=now;
    const dt=dtMs/1000, tSec=now/1000;
    frameNo++;
    const x0=sx-2, x1=sx+vx+2, n=x1-x0+1;
    const yTop=Math.max(0, sy-6), yBot=Math.min(WORLD_H-1, sy+vy+6);
    if(n<=0 || yBot<yTop) return;
    const SIMPLE = n>220; // zoomed far out: keep waves + body, drop the expensive garnish

    // 1. Scan visible columns into contiguous water segments
    const cols=new Array(n); let anyWater=false;
    for(let xi=0; xi<n; xi++){
      const wx=x0+xi; let segs=null; let y=yTop;
      while(y<=yBot){
        if(getTile(wx,y)===T.WATER){
          const top=y; while(y<=yBot && getTile(wx,y)===T.WATER) y++;
          (segs||(segs=[])).push({top, bot:y-1, open: top>0 && getTile(wx,top-1)===T.AIR, surf:0, yl:0, yr:0});
        } else y++;
      }
      if(segs){ anyWater=true; cols[xi]=segs; }
    }

    // 2. Surface springs: create/realign for visible surfaces, apply kicks, integrate, couple
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs || !segs[0].open) continue;
      const s0=segs[0], wx=x0+xi;
      let spr=springs.get(wx);
      if(!spr){ springs.set(wx,{o:0,v:0,y:s0.top,seen:frameNo}); }
      else {
        if(spr.y!==s0.top){
          // Water level moved a whole tile (flow/leveling): keep the visual height and let
          // the spring relax to the new rest level — reads as a smooth rise/settle.
          // Clamp tightly: a generous carry makes spill fronts bulge unnaturally.
          let carry=spr.o + (spr.y - s0.top)*TILE;
          const lim=TILE*0.6;
          if(carry>lim) carry=lim; else if(carry<-lim) carry=-lim;
          spr.o=carry; spr.y=s0.top;
        }
        spr.seen=frameNo;
      }
    }
    if(pendingImpulse.size){
      for(const [px,imp] of pendingImpulse){
        const spr=springs.get(px);
        if(spr){ spr.v+=imp; pendingImpulse.delete(px); }
      }
      if(pendingImpulse.size>256) pendingImpulse.clear(); // kicks far offscreen eventually expire
    }
    for(const [px,spr] of springs){
      spr.v += (-SPR_K*spr.o - SPR_D*spr.v)*dt;
      spr.o += spr.v*dt;
      if(spr.o>TILE*1.4) spr.o=TILE*1.4; else if(spr.o<-TILE*1.4) spr.o=-TILE*1.4;
      if(spr.seen!==frameNo && frameNo-spr.seen>240 && Math.abs(spr.o)<0.2 && Math.abs(spr.v)<0.4) springs.delete(px);
    }
    for(let pass=0; pass<2; pass++){
      for(let xi=1; xi<n; xi++){
        const a=springs.get(x0+xi-1), b=springs.get(x0+xi);
        if(!a || !b || Math.abs(a.y-b.y)>2) continue;
        const d=(a.o-b.o)*SPR_SPREAD*dt*0.5;
        a.v-=d; b.v+=d;
      }
    }

    // 3. Visual surface height per segment (spring + layered ambient swell)
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs) continue;
      const wx=x0+xi;
      const s0=segs[0];
      let px=s0.top*TILE;
      if(s0.open){
        const spr=springs.get(wx);
        const amb=Math.sin(wx*0.5+tSec*1.6)*1.1 + Math.sin(wx*0.17-tSec*0.8)*0.8 + Math.sin(wx*1.7+tSec*2.8)*0.5 + Math.sin(wx*0.06+tSec*0.45)*1.1;
        px += amb + (spr? spr.o : 0);
        const lo=s0.top*TILE - TILE*0.9; if(px<lo) px=lo;          // never above the air tile
        const hi=s0.bot*TILE + TILE*0.5; if(px>hi) px=hi;          // never below own body
      }
      s0.surf=px;
      for(let si=1; si<segs.length; si++){
        const sg=segs[si];
        sg.surf=sg.top*TILE + (sg.open? Math.sin(wx*0.9+tSec*2.1)*1.2 : 0);
      }
    }

    if(!anyWater && !streams.length) return;

    // 4. Offscreen layer (world-pixel space) — base shape, then clipped effects
    const ox=x0*TILE, oy=yTop*TILE;
    const wpx=n*TILE, hpx=(yBot-yTop+1)*TILE;
    if(!offCanvas){ offCanvas=document.createElement('canvas'); offCtx=offCanvas.getContext('2d'); }
    if(offCanvas.width<wpx) offCanvas.width=wpx;
    if(offCanvas.height<hpx) offCanvas.height=hpx;
    const g=offCtx;
    g.setTransform(1,0,0,1,0,0);
    g.globalCompositeOperation='source-over';
    g.clearRect(0,0,offCanvas.width,offCanvas.height);
    g.setTransform(1,0,0,1,-ox,-oy);

    // 4a. Base body: per-column quads with shared edge heights = continuous smooth surface
    for(let xi=0; xi<n; xi++){
      const segs=cols[xi]; if(!segs) continue;
      const xpx=(x0+xi)*TILE;
      for(let si=0; si<segs.length; si++){
        const sg=segs[si];
        let yL=sg.surf, yR=sg.surf;
        if(si===0){
          // Join only near-equal surfaces (≤1 row): averaging across taller steps turns
          // spill fronts and shore lips into unnatural bulges
          const lf=xi>0? cols[xi-1] : null, rt=xi<n-1? cols[xi+1] : null;
          if(lf && Math.abs(lf[0].top-sg.top)<=1) yL=(lf[0].surf+sg.surf)/2;
          if(rt && Math.abs(rt[0].top-sg.top)<=1) yR=(rt[0].surf+sg.surf)/2;
        }
        sg.yl=yL; sg.yr=yR;
        const botPx=(sg.bot+1)*TILE;
        const topMin=Math.min(yL,yR,sg.surf);
        const grad=g.createLinearGradient(0,topMin,0,topMin+TILE*9);
        if(sg.open){
          grad.addColorStop(0,'rgba(120,198,252,0.58)');
          grad.addColorStop(0.16,'rgba(56,140,238,0.72)');
          grad.addColorStop(1,'rgba(8,28,86,0.93)');
        } else { // sealed under rock: murkier, darker
          grad.addColorStop(0,'rgba(46,108,206,0.72)');
          grad.addColorStop(1,'rgba(6,22,70,0.93)');
        }
        g.fillStyle=grad;
        g.beginPath();
        g.moveTo(xpx,yL); g.lineTo(xpx+TILE,yR);
        g.lineTo(xpx+TILE,botPx); g.lineTo(xpx,botPx);
        g.closePath(); g.fill();
      }
    }

    // 4b. Waterfall streams (part of the base shape so the clipped effects also catch them)
    if(streams.length){
      for(let i=streams.length-1;i>=0;i--){
        const st=streams[i]; st.ttl-=dt;
        if(st.ttl<=0){ streams.splice(i,1); continue; }
        if(st.x<x0-1 || st.x>x1+1) continue;
        const fade=Math.min(1, st.ttl/0.18);
        const xc=st.x*TILE+TILE/2;
        const yA=Math.max(oy, st.y0*TILE), yB=Math.min(oy+hpx, (st.y1+1)*TILE);
        if(yB<=yA) continue;
        const w=TILE*0.55*fade;
        const wob=Math.sin(tSec*9+st.x*1.7)*1.5;
        const sgGrad=g.createLinearGradient(0,yA,0,yB);
        sgGrad.addColorStop(0,'rgba(160,210,255,0.45)');
        sgGrad.addColorStop(1,'rgba(110,180,250,0.75)');
        g.fillStyle=sgGrad;
        g.fillRect(xc-w/2+wob, yA, w, yB-yA);
        g.fillStyle='rgba(225,242,255,0.40)';
        g.fillRect(xc-w*0.18+wob, yA, w*0.36, yB-yA);
        // falling streak highlights
        g.fillStyle='rgba(255,255,255,0.55)';
        const span=yB-yA;
        for(let k2=0;k2<4;k2++){
          const dy2=((tSec*240)+(k2*53)+(st.x*31))%span;
          g.fillRect(xc-2+Math.sin(k2*2.4+st.x)*2.2+wob, yA+dy2, 2.6, 9);
        }
        // impact mist + crown
        const ir=TILE*(0.55+0.3*Math.sin(tSec*11+st.x))*fade;
        g.fillStyle='rgba(255,255,255,'+(0.16*fade).toFixed(3)+')';
        g.beginPath(); g.ellipse(xc, yB, ir*1.5, ir*0.55, 0, 0, Math.PI*2); g.fill();
        g.strokeStyle='rgba(255,255,255,'+(0.22*fade).toFixed(3)+')'; g.lineWidth=1.5;
        g.beginPath(); g.ellipse(xc, yB, ir*1.1, ir*0.4, 0, Math.PI, Math.PI*2); g.stroke();
        try{ const p=MM.particles; if(p && p.spawnBubble && Math.random()<0.12) p.spawnBubble(xc+(Math.random()-0.5)*TILE, yB+TILE*0.6); }catch(e){}
      }
    }

    // 4c. Effects clipped to the water shape
    if(anyWater){
      g.globalCompositeOperation='source-atop';
      let causticBudget = SIMPLE? 0 : 1000;
      for(let xi=0; xi<n; xi++){
        const segs=cols[xi]; if(!segs) continue;
        const wx=x0+xi, xpx=wx*TILE;
        // caustic web: interference of two traveling sine fields, fading with depth.
        // Short dim dashes — wide bright rectangles read as floating UI chips at zoom.
        if(causticBudget>0){
          for(let si=0; si<segs.length && causticBudget>0; si++){
            const sg=segs[si]; if(!sg.open || sg.bot-sg.top<2) continue;
            const kMax=Math.min(6, sg.bot-sg.top+1);
            for(let k2=2;k2<=kMax;k2++){
              const v1=Math.sin(wx*0.81+tSec*2.05+k2*1.31)*Math.sin(wx*0.353-tSec*1.37+k2*0.91);
              if(v1>0.55){
                const a=(v1-0.55)*0.22/(1+k2*0.35);
                const h2=hash32(wx,k2);
                g.fillStyle='rgba(190,232,255,'+a.toFixed(3)+')';
                g.fillRect(xpx+2+(h2%11), sg.surf+k2*TILE+((h2>>3)%11), 5+(h2&7), 1.6);
                causticBudget--;
              }
            }
          }
        }
        const s0=segs[0]; if(!s0.open) continue;
        // drifting light shafts in deeper open water
        if(!SIMPLE && (s0.bot-s0.top)>=3){
          const sh=Math.sin(wx*0.13+tSec*0.35)*Math.sin(wx*0.041-tSec*0.11+1.7);
          if(sh>0.55){
            g.fillStyle='rgba(235,248,255,'+((sh-0.55)*0.16).toFixed(3)+')';
            g.beginPath();
            g.moveTo(xpx,s0.surf); g.lineTo(xpx+TILE,s0.surf);
            g.lineTo(xpx+TILE+TILE*1.6, s0.surf+TILE*6.5); g.lineTo(xpx+TILE*1.6, s0.surf+TILE*6.5);
            g.closePath(); g.fill();
          }
        }
        // surface sheen: bright crest + soft underglow band
        g.strokeStyle='rgba(255,255,255,0.38)'; g.lineWidth=1.6;
        g.beginPath(); g.moveTo(xpx,s0.yl); g.lineTo(xpx+TILE,s0.yr); g.stroke();
        g.strokeStyle='rgba(170,215,255,0.10)'; g.lineWidth=4;
        g.beginPath(); g.moveTo(xpx,s0.yl+3); g.lineTo(xpx+TILE,s0.yr+3); g.stroke();
        // whitecap: agitated water (steep slope) breaks into foam along the crest
        const slope=Math.abs(s0.yr-s0.yl);
        if(slope>2.2){
          const fa=Math.min(0.55, (slope-2.2)*0.16);
          g.strokeStyle='rgba(255,255,255,'+fa.toFixed(3)+')'; g.lineWidth=3;
          g.beginPath(); g.moveTo(xpx,s0.yl-0.5); g.lineTo(xpx+TILE,s0.yr-0.5); g.stroke();
        }
        if(!SIMPLE){
          // sparkle glints twinkling along the surface (soft dots, not literal crosses)
          const step2=Math.floor(tSec*2.2), h3=hash32(wx,step2);
          if(h3%23===0){
            const a=Math.sin((tSec*2.2-step2)*Math.PI);
            const gx=xpx+((h3>>4)%TILE), gy=s0.surf+1+((h3>>8)%4);
            g.fillStyle='rgba(255,255,255,'+(a*0.5).toFixed(3)+')';
            g.fillRect(gx-1.5,gy-0.5,4,1.6);
            g.fillStyle='rgba(255,255,255,'+(a*0.85).toFixed(3)+')';
            g.fillRect(gx-0.5,gy-0.5,1.6,1.6);
          }
          // shoreline foam wisps
          const lT=getTile(wx-1,s0.top), rT=getTile(wx+1,s0.top);
          const lShore=lT!==T.AIR && lT!==T.WATER, rShore=rT!==T.AIR && rT!==T.WATER;
          if(lShore||rShore){
            const bob=Math.sin(tSec*3.1+wx*1.3)*1.4;
            g.fillStyle='rgba(255,255,255,'+(0.16+0.08*Math.sin(tSec*4+wx)).toFixed(3)+')';
            if(lShore) g.fillRect(xpx, s0.yl-1+bob*0.5, TILE*0.35, 3);
            if(rShore) g.fillRect(xpx+TILE*0.65, s0.yr-1-bob*0.5, TILE*0.35, 3);
          }
          // sparse ambient bubbles drifting up through deep water
          if((s0.bot-s0.top)>=4 && Math.random()<0.0022*(dtMs/16)){
            try{ const p=MM.particles; if(p && p.spawnBubble) p.spawnBubble((wx+0.2+Math.random()*0.6)*TILE, (s0.top+1+Math.random()*(s0.bot-s0.top-1))*TILE); }catch(e){}
          }
        }
      }
      g.globalCompositeOperation='source-over';
    }

    // 5. Composite the layer in one blend (smoothing on: soft edges under zoom)
    ctx.save();
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(offCanvas, 0,0, wpx,hpx, ox,oy, wpx,hpx);
    ctx.restore();
  }

  function reset(){ active.clear(); pressureSeeds.clear(); lateralCooldown.clear(); springs.clear(); pendingImpulse.clear(); streams.length=0; chunkWakes.length=0; }
  function snapshot(){
    try{ return {v:2, active:[...active].map(k=>k.split(',').map(Number)), lateral:[...lateralCooldown.entries()], passiveScanOffset, pressureIntervalCurrent, pressureAcc, lateralAcc}; }catch(e){ return null; }
  }
  function restore(s){ if(!s||typeof s!=='object') return; reset(); try{
    if(Array.isArray(s.active)) for(const a of s.active){ if(Array.isArray(a)&&a.length===2){ active.add(a[0]+","+a[1]); } }
    // v1 saves carried ripple visuals; replay them as gentle wave kicks
    if(Array.isArray(s.ripples)) for(const r of s.ripples){ if(r && typeof r.L==='number' && typeof r.R==='number') disturb(Math.floor((r.L+r.R)/2), 60); }
    if(Array.isArray(s.lateral)) for(const [x,val] of s.lateral){ if(typeof x==='number'&&typeof val==='number') lateralCooldown.set(x,val); }
    if(typeof s.passiveScanOffset==='number') passiveScanOffset=s.passiveScanOffset;
    if(typeof s.pressureIntervalCurrent==='number') pressureIntervalCurrent=s.pressureIntervalCurrent;
    if(typeof s.pressureAcc==='number') pressureAcc=s.pressureAcc;
    if(typeof s.lateralAcc==='number') lateralAcc=s.lateralAcc;
  }catch(e){} }

  // ---- Hydrostatic equalization (true communicating vessels) ----
  // For each seeded body: flood-fill the connected water (window-bounded around the
  // seed), flood-fill the void container it can reach WITHOUT crossing above its own
  // highest surface, then move volume toward the bottom-up equilibrium fill of that
  // container. Pressure emerges naturally: water joined through any passage — U-bends,
  // risers, galleries, mined bores — rises and drains until the joined regions sit
  // within one tile of a common level, and reachable drops below keep pulling the body
  // down. Strictly-below-the-surface traversal means a body can never creep along its
  // own surface row (lips hold; films are left to the local spill/seek dynamics).
  // Volume is conserved exactly; moves are rate-limited so large equalizations read as
  // flow over a second or two rather than teleports.
  const EQ_WINDOW=40;       // half-width (columns) of the equalization window
  const EQ_BODY_CAP=4200;   // safety caps for the two flood fills
  const EQ_VOID_CAP=6500;
  const EQ_RATE=48;         // max units moved per body per pass
  const EQ_BODIES=3;        // bodies equalized per pass

  function runPressureLeveling(getTile,setTile){
    const seedSet=new Set(active); for(const kk of pressureSeeds) seedSet.add(kk); pressureSeeds.clear();
    const seeds=[...seedSet]; if(!seeds.length) return null; seeds.sort();
    const processed=new Set(); // cells of bodies already handled this pass
    const touchedXs=new Set(); let variance=null; let hadTransfers=false; let bodies=0;
    for(const key of seeds){
      if(bodies>=EQ_BODIES) break;
      if(processed.has(key)) continue;
      const ci0=key.indexOf(','); const sx=+key.slice(0,ci0), sy=+key.slice(ci0+1);
      if(getTile(sx,sy)!==T.WATER) continue;
      // 1. connected water body (4-neighbor flood fill)
      const bodySet=new Set([key]); const stack=[key];
      let minSurf=WORLD_H; let overflow=false;
      while(stack.length){
        const ck=stack.pop(); const ci=ck.indexOf(','); const cx=+ck.slice(0,ci), cy=+ck.slice(ci+1);
        if(cy<minSurf) minSurf=cy;
        for(let d=0;d<4;d++){
          const nx=cx+(d===0?-1:d===1?1:0), ny=cy+(d===2?-1:d===3?1:0);
          if(Math.abs(nx-sx)>EQ_WINDOW || ny<0 || ny>=WORLD_H) continue;
          const nk=nx+','+ny;
          if(bodySet.has(nk) || getTile(nx,ny)!==T.WATER) continue;
          bodySet.add(nk); stack.push(nk);
          if(bodySet.size>EQ_BODY_CAP){ overflow=true; stack.length=0; break; }
        }
      }
      for(const bk of bodySet) processed.add(bk);
      bodies++;
      if(overflow || bodySet.size<2) continue;
      // 2. container: void reachable strictly below the body's highest surface (water
      // cannot flow at or above its own level; window-edge water acts as a fixed wall)
      const floorRow=minSurf+1;
      const contSet=new Set(bodySet); const q=[...bodySet]; let voidOver=false;
      while(q.length){
        const ck=q.pop(); const ci=ck.indexOf(','); const cx=+ck.slice(0,ci), cy=+ck.slice(ci+1);
        for(let d=0;d<4;d++){
          const nx=cx+(d===0?-1:d===1?1:0), ny=cy+(d===2?-1:d===3?1:0);
          if(Math.abs(nx-sx)>EQ_WINDOW || ny<floorRow || ny>=WORLD_H) continue;
          const nk=nx+','+ny;
          if(contSet.has(nk) || !canFill(getTile(nx,ny))) continue;
          contSet.add(nk); q.push(nk);
          if(contSet.size>EQ_VOID_CAP){ voidOver=true; q.length=0; break; }
        }
      }
      if(voidOver) continue;
      // 3. bottom-up equilibrium fill of the container with the body's volume
      const byRow=new Map();
      for(const ck of contSet){ const ci=ck.indexOf(','); const x=+ck.slice(0,ci), y=+ck.slice(ci+1); let a=byRow.get(y); if(!a){ a=[]; byRow.set(y,a); } a.push(x); }
      const rowsDesc=[...byRow.keys()].sort((a,b)=>b-a);
      let vol=bodySet.size;
      const target=new Set();
      for(const y of rowsDesc){
        if(vol<=0) break;
        const xs=byRow.get(y);
        if(xs.length<=vol){ for(const x of xs) target.add(x+','+y); vol-=xs.length; }
        else {
          // partial surface row: keep cells that already hold water (stability), then x order
          xs.sort((a,b)=>{ const aw=bodySet.has(a+','+y)?0:1, bw=bodySet.has(b+','+y)?0:1; return aw-bw || a-b; });
          for(let i=0;i<vol;i++) target.add(xs[i]+','+y);
          vol=0;
        }
      }
      // 4. rate-limited move: drain the highest surplus cells into the deepest deficits.
      // Sources clear top-down and destinations fill bottom-up, so every intermediate
      // state is gravity-consistent and each unit moved conserves volume exactly.
      const sources=[]; const dests=[];
      for(const bk of bodySet){ if(!target.has(bk)) sources.push(bk); }
      for(const tk of target){ if(!bodySet.has(tk)) dests.push(tk); }
      if(!sources.length || !dests.length) continue; // already at equilibrium
      const rowOf=(s)=>+s.slice(s.indexOf(',')+1);
      sources.sort((a,b)=> rowOf(a)-rowOf(b) || a.localeCompare(b)); // highest first
      dests.sort((a,b)=> rowOf(b)-rowOf(a) || a.localeCompare(b));   // deepest first
      const K=Math.min(EQ_RATE, sources.length, dests.length);
      for(let i=0;i<K;i++){
        const sk=sources[i], dk=dests[i];
        const sci=sk.indexOf(','); const sxx=+sk.slice(0,sci), syy=+sk.slice(sci+1);
        const dci=dk.indexOf(','); const dxx=+dk.slice(0,dci), dyy=+dk.slice(dci+1);
        setTile(sxx,syy,T.AIR); setTile(dxx,dyy,T.WATER);
        mark(dxx,dyy); markNeighbors(active,dxx,dyy); markNeighbors(active,sxx,syy);
        touchedXs.add(sxx); touchedXs.add(dxx);
      }
      if(K>0){
        hadTransfers=true;
        const spread=Math.min(12,K); if(variance==null || spread>variance) variance=spread;
      }
    }
    return {touchedXs, variance, hadTransfers};
  }

  function metrics(){ return {active:active.size, springs:springs.size, streams:streams.length}; }
  // Test/debug introspection (not used by the game loop)
  function _debug(){ return {active:[...active], seeds:[...pressureSeeds], cooldown:[...lateralCooldown.entries()], pressureAcc, pressureIntervalCurrent}; }

  MM.water = {update, addSource, drawOverlay, onTileChanged, displaceAt, disturb, noteChunkGenerated, reset, snapshot, restore, metrics, _debug};
})();
// ESM export (progressive migration)
export const water = (typeof window!=='undefined' && window.MM) ? window.MM.water : undefined;
export default water;
