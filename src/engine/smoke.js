// Sparse black-smoke density layer. Unlike world-backed gases, smoke does not
// own a terrain cell: it can occupy the same position as steam, poison or fuel
// gas. YOUNG density moves upward, pools below ceilings, diffuses sideways
// through rooms and vents quickly outdoors. AGED density has shed the thermal
// lift that carried it: past BUOYANT_SECONDS it stops climbing and slowly
// sinks, pooling into a dense layer along the floor — the layer soft_drifts'
// soot fallout consumes (deposition removes mass via consumeAt, closing the
// smoke -> soot -> graphite carbon loop). A capped rotating work queue keeps
// large fires bounded without making the simulation depend on the viewport.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSmokePorousTile } from './material_physics.js';

(function(){
  const root=typeof window!=='undefined' ? window : globalThis;
  root.MM=root.MM||{};

  const WORLD_TOP=Number.isFinite(WORLD_MIN_Y)?WORLD_MIN_Y:0;
  const WORLD_BOTTOM=Number.isFinite(WORLD_MAX_Y)?WORLD_MAX_Y:WORLD_H;
  const STEP=0.10;
  const MAX_CELLS=1200;
  const MAX_DENSITY=1.25;
  const MIN_DENSITY=0.012;
  const SOOT_FADE_SECONDS=75;
  // Mixture age (mass-weighted through every transfer/emit) drives buoyancy:
  // below BUOYANT_SECONDS a packet climbs, past it the lift wanes linearly and
  // at SETTLED_SECONDS the packet only sinks. A fed fire keeps its plume young
  // (fresh emission dilutes age), so settling starts when the source ebbs.
  const BUOYANT_SECONDS=45;
  const SETTLED_SECONDS=100;
  // Trapped smoke decides faster: with no vent the mixture ages up to twice as
  // fast (a sealed hall reaches the settling decision sooner) and settled smog
  // wears away quicker, so a dead cloud either sinks into the soot-fallout
  // layer or thins out — it cannot hover under a ceiling indefinitely.
  const TRAPPED_AGE_BOOST=1.0;
  const TRAPPED_WEAR=0.014;
  // Keep the sparse overlay inside the same horizontal storage envelope as
  // world.js. Bitwise key normalization would otherwise wrap corrupt, huge x
  // coordinates back into an unrelated valid cell (most visibly x=0).
  const MAX_WORLD_X=30e6;
  const cells=new Map();
  let queue=[];
  let cursor=0;
  let accumulator=0;
  let stepSeq=0;
  let lastProcessed=0;
  let lastBudget=0;
  let drawCursor=0;
  let drawSeq=0;
  let emitEvictCursor=0;
  let denseCursor=0;
  let spriteTile=0;
  let sprites=null;

  const key=(x,y)=>(x|0)+','+(y|0);
  const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
  function finiteCell(x,y){ return Number.isFinite(x)&&Math.abs(x)<=MAX_WORLD_X&&Number.isFinite(y)&&y>=WORLD_TOP&&y<WORLD_BOTTOM; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function'?getTile(x,y):fallback; }catch(e){ return fallback; }
  }
  function smokeOpenTile(t){
    return isSmokePorousTile(t);
  }
  function smokeOpenAt(x,y,getTile,dynamicOpen){
    if(!finiteCell(x,y)) return false;
    const t=getSafe(getTile,x,y,T.STONE);
    if(smokeOpenTile(t)) return true;
    try{ return typeof dynamicOpen==='function' && dynamicOpen(x,y,t)===true; }catch(e){ return false; }
  }
  function hash32(x,y,salt){
    let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(salt|0,2246822519);
    h=Math.imul(h^(h>>>13),1274126177);
    return (h^(h>>>16))>>>0;
  }
  function cellAt(x,y){ return cells.get(key(x,y))||null; }
  function removeCell(k){ cells.delete(k); }
  function compactQueue(force){
    if(!force && queue.length<=cells.size*2+128) return;
    queue=[...cells.keys()];
    cursor=queue.length ? cursor%queue.length : 0;
    drawCursor=queue.length ? drawCursor%queue.length : 0;
    emitEvictCursor=queue.length ? emitEvictCursor%queue.length : 0;
    denseCursor=queue.length ? denseCursor%queue.length : 0;
  }
  function evictForEmission(){
    if(!cells.size) return true;
    if(queue.length>cells.size+128) compactQueue(true);
    let bestKey=null,bestScore=Infinity,visited=0,sampled=0;
    const sampleTarget=Math.min(48,cells.size);
    while(queue.length && visited<queue.length && sampled<sampleTarget){
      if(emitEvictCursor>=queue.length) emitEvictCursor=0;
      const k=queue[emitEvictCursor++];
      visited++;
      const c=cells.get(k);
      if(!c) continue;
      sampled++;
      // Protect fresh/dense source cells. Old diffuse smoke is the least visible
      // mass to sacrifice when the hard safety cap is already full.
      const score=c.d+(c.age<3?0.5:0)-Math.min(0.20,(c.age||0)*0.002);
      if(score<bestScore){ bestScore=score; bestKey=k; }
    }
    if(bestKey==null) return false;
    const victim=cells.get(bestKey);
    removeCell(bestKey);
    // Fold the sacrificed mass into a neighbouring cell instead of popping a
    // visible hole into the cloud: the cap stays honoured and the eviction
    // reads as local thickening rather than blinking.
    if(victim && victim.d>MIN_DENSITY){
      let best=null,room=0;
      for(const [dx,dy] of [[0,-1],[-1,0],[1,0],[0,1]]){
        const n=cellAt(victim.x+dx,victim.y+dy);
        if(!n) continue;
        const cap=MAX_DENSITY-n.d;
        if(cap>room){ room=cap; best=n; }
      }
      if(best){
        const moved=Math.min(victim.d,room);
        const before=best.d;
        best.d+=moved;
        best.age=(Math.max(0,best.age||0)*before+Math.max(0,victim.age||0)*moved)/(before+moved);
      }
    }
    return true;
  }
  function ensureCell(x,y,getTile,dynamicOpen,allowEvict){
    if(!finiteCell(x,y)) return null;
    x=Math.floor(x); y=Math.floor(y);
    if(!smokeOpenAt(x,y,getTile,dynamicOpen)) return null;
    const k=key(x,y);
    let c=cells.get(k);
    if(c) return c;
    if(cells.size>=MAX_CELLS && !(allowEvict && evictForEmission())) return null;
    c={x,y,d:0,age:0,_step:-1,_tick:stepSeq};
    cells.set(k,c);
    queue.push(k);
    return c;
  }
  function mixedTick(dst,before,added,addedTick){
    if(!(added>0)) return;
    const incoming=Number.isFinite(addedTick)?Math.min(stepSeq,addedTick):stepSeq;
    if(!(before>0) || !Number.isFinite(dst._tick)){ dst._tick=incoming; return; }
    dst._tick=Math.round((dst._tick*before+incoming*added)/(before+added));
  }
  function transfer(from,nx,ny,amount,getTile,dynamicOpen){
    if(!(amount>0) || !from) return 0;
    const dst=ensureCell(nx,ny,getTile,dynamicOpen);
    if(!dst || dst===from) return 0;
    const moved=Math.min(amount,from.d,Math.max(0,MAX_DENSITY-dst.d));
    if(!(moved>0)) return 0;
    const before=dst.d;
    from.d-=moved;
    dst.d+=moved;
    // Density cells are mixtures. Preserve their mass-weighted age instead of
    // making an entire old pocket young whenever a fresh packet enters it.
    dst.age=(Math.max(0,dst.age||0)*before+Math.max(0,from.age||0)*moved)/(before+moved);
    mixedTick(dst,before,moved,from._tick);
    // One physical hop per fixed step prevents a newly transferred packet from
    // crossing an entire room in a single update iteration.
    dst._step=stepSeq;
    return moved;
  }
  function ventilationAt(x,y,getTile,dynamicOpen){
    let scan=12;
    let surface=null;
    let reachedSurfaceAt=0;
    try{
      const wg=root.MM&&root.MM.worldGen;
      if(wg&&typeof wg.surfaceHeight==='function') surface=wg.surfaceHeight(x);
    }catch(e){}
    // Above the natural surface, scan farther for player-built roofs. Deep
    // underground cells never claim ventilation merely because their chamber
    // happens to be taller than the normal local probe.
    if(Number.isFinite(surface)&&y<=surface) scan=24;
    for(let dy=1;dy<=scan;dy++){
      const yy=y-dy;
      if(yy<WORLD_TOP) return 1;
      if(!smokeOpenAt(x,yy,getTile,dynamicOpen)) return 0;
      // Once a clear column reaches the terrain surface it is genuinely vented.
      // Counting an air pocket below a roof as ventilation made sealed rooms
      // lose smoke merely because their ceiling happened to be high.
      if(!reachedSurfaceAt&&Number.isFinite(surface)&&yy<=surface-1) reachedSurfaceAt=dy;
    }
    // With no worldgen metadata, a long unobstructed shaft is treated as a vent.
    if(Number.isFinite(surface)) return reachedSurfaceAt ? clamp((scan-reachedSurfaceAt+5)/scan,0.25,1) : 0;
    return 0.35;
  }
  function windSpeed(){
    try{
      const w=root.MM&&root.MM.wind;
      const v=w&&typeof w.speed==='function'?w.speed():0;
      return Number.isFinite(v)?clamp(v,-8,8):0;
    }catch(e){ return 0; }
  }
  function relocateBlocked(c,getTile,dynamicOpen){
    const dirs=[[0,-1],[-1,0],[1,0],[0,1]];
    for(const [dx,dy] of dirs){
      if(c.d<MIN_DENSITY) break;
      if(!smokeOpenAt(c.x+dx,c.y+dy,getTile,dynamicOpen)) continue;
      // A nearly full first neighbour may accept only a fraction. Continue over
      // the remaining faces so placing a block does not silently destroy smoke.
      transfer(c,c.x+dx,c.y+dy,c.d,getTile,dynamicOpen);
    }
    removeCell(key(c.x,c.y));
  }
  function processCell(c,getTile,wind,dynamicOpen){
    if(!c || c._step===stepSeq) return false;
    c._step=stepSeq;
    const k=key(c.x,c.y);
    if(!smokeOpenAt(c.x,c.y,getTile,dynamicOpen)){ relocateBlocked(c,getTile,dynamicOpen); return true; }
    if(!Number.isFinite(c.d) || c.d<MIN_DENSITY){ removeCell(k); return true; }

    const vent=ventilationAt(c.x,c.y,getTile,dynamicOpen);
    // The adaptive queue deliberately services only part of a large cloud per
    // fixed step. Account for the elapsed simulation ticks so a 1200-cell fire
    // does not age and fade several times slower than a small one.
    const previousTick=Number.isFinite(c._tick)?c._tick:stepSeq-1;
    const elapsedSteps=Math.max(1,stepSeq-previousTick);
    const elapsed=STEP*elapsedSteps;
    c._tick=stepSeq;
    c.age+=elapsed*(1+(1-vent)*TRAPPED_AGE_BOOST);
    const settle=clamp((c.age-BUOYANT_SECONDS)/(SETTLED_SECONDS-BUOYANT_SECONDS),0,1);
    // One packet never tugs both ways: the young half of the settling window
    // climbs, the old half sinks. Overlapping ramps let mid-aged neighbours
    // trade the same mass up and down forever — a standing density flicker.
    const lift=clamp(1-settle*2,0,1);
    const sink=clamp(settle*2-1,0,1);
    // Enclosed smoke lingers; a clear vertical route disperses it much faster.
    // Decay is proportional to density. A constant subtraction made a broad,
    // thin cloud vanish almost instantly merely because it occupied more cells.
    // Settled smoke additionally sticks to surfaces and wears away on its own
    // (faster when trapped), so a dead fire's smog is finite even where no
    // soot fallout samples it.
    c.d*=Math.exp(-elapsed*(0.006+vent*0.22+settle*(0.010+(1-vent)*TRAPPED_WEAR)));
    if(c.d<MIN_DENSITY){ removeCell(k); return true; }

    const aboveOpen=smokeOpenAt(c.x,c.y-1,getTile,dynamicOpen);
    const above=aboveOpen?cellAt(c.x,c.y-1):null;
    const aboveD=above?above.d:0;

    // Buoyancy dominates until the layer above approaches saturation — and it
    // wanes with age: an old packet has spent the heat that carried it.
    if(aboveOpen && aboveD<c.d+0.08 && lift>0){
      const gradient=Math.max(0.08,c.d-aboveD);
      transfer(c,c.x,c.y-1,Math.min(c.d*0.38,0.055+gradient*0.34)*lift,getTile,dynamicOpen);
    }

    // Aged smoke sinks instead: slower than the climb (ash sifting, not a
    // plume), pooling until the floor layer is slightly DENSER than the cell
    // above it — the inverse of the ceiling inversion young smoke builds.
    const downOpen=smokeOpenAt(c.x,c.y+1,getTile,dynamicOpen);
    const downCell=downOpen?cellAt(c.x,c.y+1):null;
    const downD=downCell?downCell.d:0;
    if(sink>0 && downOpen && downD<c.d+0.10){
      const gradient=Math.max(0.06,c.d-downD);
      transfer(c,c.x,c.y+1,Math.min(c.d*0.30,0.020+gradient*0.24)*sink,getTile,dynamicOpen);
    }

    // Outdoors the shared wind biases mass sideways. Indoors vent is small, so
    // room geometry and buoyancy remain in control instead of weather leaking in.
    const windPower=Math.abs(wind)*vent;
    if(windPower>0.18 && c.d>MIN_DENSITY*2){
      const dir=wind<0?-1:1;
      transfer(c,c.x+dir,c.y,Math.min(c.d*0.28,windPower*0.018+c.d*windPower*0.012),getTile,dynamicOpen);
    }

    // A blocked layer spreads along its surface: young smoke along the ceiling
    // it pools under, settled smoke along the floor it rests on (the smog
    // blanket widening through the room instead of standing in one column).
    const ceiling=!aboveOpen || aboveD>0.78;
    const floorRest=settle>0.5 && (!downOpen || downD>0.78);
    const first=((hash32(c.x,c.y,stepSeq)&1)===0)?-1:1;
    for(const dir of [first,-first]){
      if(c.d<MIN_DENSITY*2 || !smokeOpenAt(c.x+dir,c.y,getTile,dynamicOpen)) continue;
      const side=cellAt(c.x+dir,c.y);
      const sideD=side?side.d:0;
      const gradient=c.d-sideD;
      if(gradient<=0.045) continue;
      const rate=(ceiling||floorRest)?0.24:0.105;
      transfer(c,c.x+dir,c.y,Math.min(c.d*rate,gradient*0.31),getTile,dynamicOpen);
    }

    // Once a ceiling layer and its neighbours are dense, new mass backs down
    // into the room instead of being discarded, producing realistic smoke fill.
    if(ceiling && c.d>0.82 && smokeOpenAt(c.x,c.y+1,getTile,dynamicOpen)){
      const below=cellAt(c.x,c.y+1);
      const belowD=below?below.d:0;
      if(belowD+0.12<c.d) transfer(c,c.x,c.y+1,(c.d-0.78)*0.11,getTile,dynamicOpen);
    }
    if(c.d<MIN_DENSITY) removeCell(k);
    return true;
  }
  // A big cloud is exactly what pushes the frame time across a budget tier.
  // Hard tier cliffs then oscillate (cheap frame -> more work -> expensive
  // frame -> less work...), which reads as cloud-wide flicker. A smoothed,
  // continuous ramp cannot flap between frames.
  let emaFrameMs=16;
  function loadFactor(){
    const ms=typeof root.__mmFrameMs==='number'&&Number.isFinite(root.__mmFrameMs)?clamp(root.__mmFrameMs,4,80):16;
    emaFrameMs+=(ms-emaFrameMs)*0.15;
    return clamp((emaFrameMs-16)/(44-16),0,1);
  }
  function moveBudget(){
    return Math.round(180-(180-38)*loadFactor());
  }
  function physicsStep(getTile,dynamicOpen){
    if(!cells.size || !queue.length){ lastProcessed=0; return; }
    stepSeq++;
    const budget=moveBudget();
    const wind=windSpeed();
    let processed=0,visits=0;
    const maxVisits=queue.length;
    while(visits<maxVisits && processed<budget && queue.length){
      if(cursor>=queue.length) cursor=0;
      const k=queue[cursor++];
      visits++;
      const c=cells.get(k);
      if(!c || c._step===stepSeq) continue;
      if(processCell(c,getTile,wind,dynamicOpen)) processed++;
    }
    lastProcessed=processed;
    lastBudget=budget;
    compactQueue();
  }
  function update(dt,getTile,dynamicOpen){
    if(!(dt>0)||!Number.isFinite(dt)||typeof getTile!=='function') return;
    accumulator=Math.min(0.5,accumulator+Math.min(0.25,dt));
    let steps=0;
    while(accumulator>=STEP&&steps++<4){ accumulator-=STEP; physicsStep(getTile,dynamicOpen); }
  }
  function emit(x,y,amount,opts){
    opts=opts||{};
    const getTile=opts.getTile||(root.MM.world&&root.MM.world.getTile);
    if(typeof getTile!=='function'||!Number.isFinite(x)||!Number.isFinite(y)) return 0;
    let requested;
    try{ requested=Number(amount); }catch(e){ return 0; }
    if(!Number.isFinite(requested)) return 0;
    let left=clamp(requested,0,8);
    if(!(left>0)) return 0;
    const bx=Math.floor(x),by=Math.floor(y);
    const offsets=[[0,0],[0,-1],[-1,0],[1,0],[-1,-1],[1,-1],[0,1],[-2,0],[2,0]];
    let accepted=0;
    for(const [dx,dy] of offsets){
      if(left<=0) break;
      const c=ensureCell(bx+dx,by+dy,getTile,opts.openAt,true);
      if(!c) continue;
      const add=Math.min(left,MAX_DENSITY-c.d);
      if(add<=0) continue;
      const before=c.d;
      c.d+=add;
      c.age=(Math.max(0,c.age||0)*before)/(before+add);
      mixedTick(c,before,add,stepSeq);
      accepted+=add;
      left-=add;
    }
    return accepted;
  }
  function densityAt(x,y){
    if(!finiteCell(x,y)) return 0;
    const c=cellAt(Math.floor(x),Math.floor(y));
    return c?clamp(c.d,0,MAX_DENSITY):0;
  }

  // Bounded sample of the densest smoke for consumers that let the plume drive
  // them (soot fallout). A rotating cursor keeps every part of a cloud larger
  // than the per-call budget serviced across successive calls.
  function denseCells(minD,limit){
    const out=[];
    if(!cells.size||!queue.length) return out;
    const min=Number.isFinite(minD)?minD:0.7;
    const max=Math.max(1,Math.min(Number.isFinite(limit)?Math.floor(limit):64,MAX_CELLS));
    let visits=0;
    const maxVisits=queue.length;
    while(visits<maxVisits && out.length<max && queue.length){
      if(denseCursor>=queue.length) denseCursor=0;
      const c=cells.get(queue[denseCursor++]);
      visits++;
      if(!c||!(c.d>=min)) continue;
      out.push({x:c.x,y:c.y,d:c.d,age:Math.max(0,c.age||0)});
    }
    return out;
  }

  // Deposition removes real mass from the layer (smoke that became a soot film
  // is no longer airborne). Returns how much density was actually taken.
  function consumeAt(x,y,amount){
    if(!finiteCell(x,y)||!Number.isFinite(amount)||!(amount>0)) return 0;
    const c=cellAt(Math.floor(x),Math.floor(y));
    if(!c) return 0;
    const taken=Math.min(c.d,amount);
    c.d-=taken;
    if(c.d<MIN_DENSITY) removeCell(key(c.x,c.y));
    return taken;
  }

  // Creatures do not need their own particle simulation. Sampling at most three
  // sparse smoke cells per active body is enough to build a persistent soot film;
  // once outside the cloud it wears off slowly on simulation time.
  function updateSoot(target,dt,opts){
    if(!target||typeof target!=='object'||!(dt>0)||!Number.isFinite(dt)) return 0;
    const x=Number(target.x),y=Number(target.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)) return 0;
    opts=opts||{};
    // Some procedural genomes already use `soot` as an art parameter. They can
    // opt into a private film field without conflating appearance metadata with
    // environmental exposure.
    const filmField=opts.field==='_sootFilm'?'_sootFilm':'soot';
    const tintField=filmField==='_sootFilm'?'_sootFilmTint':'_smokeTint';
    const soot=clamp(Number.isFinite(Number(target[filmField]))?Number(target[filmField]):0,0,1);
    const tint=clamp(Number.isFinite(Number(target[tintField]))?Number(target[tintField]):0,0,1);
    let exposure=0;
    if(cells.size){
      const height=clamp(Number.isFinite(Number(opts.height))?Number(opts.height):(Number(target.h)||0.9),0.2,4);
      exposure=Math.max(
        densityAt(x,y),
        densityAt(x,y-height*0.34),
        densityAt(x,y+height*0.28)
      );
      exposure=clamp((exposure-0.025)/0.90,0,1);
    }
    const step=Math.min(dt,0.25);
    const tintRate=exposure>tint?9:3.2;
    const nextTint=tint+(exposure-tint)*Math.min(1,step*tintRate);
    const speed=Math.hypot(Number(target.vx)||0,Number(target.vy)||0);
    const motion=clamp(speed/2.4,0,1);
    const nextSoot=exposure>0
      ? soot+step*exposure*(0.10+motion*0.12)
      : soot-step/SOOT_FADE_SECONDS;
    target[filmField]=clamp(nextSoot,0,1);
    target[tintField]=clamp(nextTint,0,1);
    return target[filmField];
  }

  function visualSoot(target,opts){
    if(!target||typeof target!=='object') return 0;
    const filmField=opts&&opts.field==='_sootFilm'?'_sootFilm':'soot';
    const tintField=filmField==='_sootFilm'?'_sootFilmTint':'_smokeTint';
    const soot=Number(target[filmField])||0;
    const tint=Number(target[tintField])||0;
    return clamp(Math.max(soot,tint*0.82),0,1);
  }

  // A few deterministic marks are cheaper and clearer than per-creature soot
  // particles. Callers provide a tight body box, keeping scenery unaffected.
  function drawSootMarks(ctx,cx,cy,width,height,amount,seed){
    if(!ctx||typeof ctx.save!=='function'||typeof ctx.ellipse!=='function') return false;
    amount=clamp(Number(amount)||0,0,1);
    width=Math.max(1,Number(width)||0); height=Math.max(1,Number(height)||0);
    if(amount<0.015||!Number.isFinite(cx)||!Number.isFinite(cy)) return false;
    const base=(Number(seed)||0)|0;
    ctx.save();
    ctx.globalCompositeOperation='source-over';
    // A restrained central glaze makes the whole silhouette read darker; the
    // smaller marks below sell uneven soot instead of a flat colour filter.
    ctx.globalAlpha=amount*0.12;
    ctx.fillStyle='#090a09';
    ctx.beginPath();
    ctx.ellipse(cx,cy,width*0.44,height*0.44,0,0,Math.PI*2);
    ctx.fill();
    for(let i=0;i<5;i++){
      const h=hash32(base+i*17,base>>>7,i+113);
      const px=cx+(((h&255)/255)-0.5)*width*0.62;
      const py=cy+((((h>>>8)&255)/255)-0.5)*height*0.62;
      const rx=width*(0.055+((h>>>16)&31)/31*0.065);
      const ry=height*(0.035+((h>>>21)&31)/31*0.060);
      ctx.globalAlpha=amount*(0.13+((h>>>26)&15)/15*0.15);
      ctx.fillStyle=(i&1)?'#080909':'#171713';
      ctx.beginPath();
      ctx.ellipse(px,py,rx,ry,((h>>>12)&31)/31*Math.PI,0,Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha=1;
    ctx.restore();
    return true;
  }

  function onTileChanged(x,y,_old,next,getTile){
    if(!cells.size) return false;
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteCell(x,y)) return false;
    const c=cellAt(x,y);
    if(!c) return false;
    // Transient gas swaps remain porous and need no work. For construction,
    // liquids and cave-ins, use the post-change world read and displace now so
    // an immediate save cannot serialize smoke inside the new solid tile.
    if(smokeOpenTile(next) && smokeOpenAt(x,y,getTile)) return false;
    if(smokeOpenAt(x,y,getTile)) return false;
    relocateBlocked(c,getTile);
    compactQueue();
    return true;
  }

  function buildSprites(TILE){
    spriteTile=TILE;
    sprites=[];
    if(typeof document==='undefined'||!document.createElement) return;
    for(let variant=0;variant<4;variant++){
      const S=72;
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=S;
      const g=canvas.getContext&&canvas.getContext('2d');
      if(!g||!g.createRadialGradient){ sprites.push(null); continue; }
      const cx=S*(0.48+((variant&1)?0.035:-0.025));
      const cy=S*(0.50+((variant&2)?0.025:-0.035));
      const gr=g.createRadialGradient(cx,cy,2,cx,cy,S*0.48);
      gr.addColorStop(0,'rgba(3,4,4,0.88)');
      gr.addColorStop(0.36,'rgba(8,9,9,0.66)');
      gr.addColorStop(0.72,'rgba(14,15,15,0.25)');
      gr.addColorStop(1,'rgba(18,19,19,0)');
      g.fillStyle=gr;
      g.fillRect(0,0,S,S);
      // Fixed mottling reads as smoke texture without allocating gradients or
      // random particles during rendering.
      for(let i=0;i<7;i++){
        const h=hash32(i,variant,91);
        const px=14+(h%44), py=14+((h>>>8)%44), r=5+((h>>>16)%10);
        g.fillStyle='rgba(0,0,0,'+(0.035+((h>>>24)%7)*0.009).toFixed(3)+')';
        g.beginPath(); g.arc(px,py,r,0,Math.PI*2); g.fill();
      }
      sprites.push(canvas);
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile){
    if(!ctx||!cells.size) return;
    if(spriteTile!==TILE||!sprites) buildSprites(TILE);
    if(!sprites||!sprites.length) return;
    const visible=typeof canDrawTile==='function'?canDrawTile:null;
    const load=loadFactor();
    const drawBudget=Math.round(480-(480-130)*load);
    const minDraw=MIN_DENSITY+(0.075-MIN_DENSITY)*load;
    let drawn=0,visits=0;
    const maxVisits=queue.length;
    drawSeq++;
    ctx.save();
    ctx.globalCompositeOperation='source-over';
    // Rotate through the sparse queue. Under a low-FPS draw budget this makes
    // every visible part of a huge fire receive frames instead of permanently
    // drawing only the oldest cells.
    while(visits<maxVisits && drawn<drawBudget && queue.length){
      if(drawCursor>=queue.length) drawCursor=0;
      const c=cells.get(queue[drawCursor++]);
      visits++;
      if(!c || c._draw===drawSeq) continue;
      c._draw=drawSeq;
      if(c.d<minDraw||c.x<sx-2||c.x>sx+viewX+3||c.y<sy-2||c.y>sy+viewY+3) continue;
      if(visible&&!visible(c.x,c.y)) continue;
      const d=clamp(c.d,0,1);
      const h=hash32(c.x,c.y,7);
      const sp=sprites[h&3];
      if(!sp) continue;
      const jitterX=(((h>>>4)&15)/15-0.5)*TILE*0.24;
      const jitterY=(((h>>>8)&15)/15-0.5)*TILE*0.18;
      const r=TILE*(0.92+d*0.28);
      // Fade the cut-off in: a fringe cell hovering around the adaptive
      // threshold dims smoothly instead of blinking on and off.
      const fringe=clamp((c.d-minDraw)/0.035,0,1);
      ctx.globalAlpha=clamp(0.12+Math.pow(d,0.82)*0.78,0,0.90)*(0.25+0.75*fringe);
      ctx.drawImage(sp,(c.x+0.5)*TILE-r+jitterX,(c.y+0.5)*TILE-r+jitterY,r*2,r*2);
      if(d>0.72){
        ctx.globalAlpha=(d-0.72)*0.30;
        ctx.fillStyle='#030404';
        ctx.fillRect(c.x*TILE,c.y*TILE,TILE,TILE);
      }
      drawn++;
    }
    ctx.globalAlpha=1;
    ctx.restore();
  }
  function snapshot(){
    const list=[...cells.values()]
      .filter(c=>c&&finiteCell(c.x,c.y)&&Number.isFinite(c.d)&&c.d>=MIN_DENSITY)
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MAX_CELLS)
      .map(c=>({x:c.x|0,y:c.y|0,d:+clamp(c.d,MIN_DENSITY,MAX_DENSITY).toFixed(3),age:+Math.max(0,c.age||0).toFixed(2)}));
    return {v:1,list};
  }
  function reset(){
    cells.clear(); queue.length=0; cursor=0; drawCursor=0; drawSeq=0; emitEvictCursor=0; denseCursor=0; accumulator=0; stepSeq=0; lastProcessed=0; lastBudget=0; emaFrameMs=16;
  }
  function restore(data,getTile){
    reset();
    if(!data||!Array.isArray(data.list)||typeof getTile!=='function') return false;
    let inspected=0;
    for(const raw of data.list){
      if(++inspected>MAX_CELLS*4) break;
      if(cells.size>=MAX_CELLS) break;
      if(!raw||!finiteCell(raw.x,raw.y)||!Number.isFinite(raw.d)||raw.d<MIN_DENSITY) continue;
      const c=ensureCell(Math.floor(raw.x),Math.floor(raw.y),getTile);
      if(!c) continue;
      c.d=clamp(raw.d,MIN_DENSITY,MAX_DENSITY);
      c.age=Number.isFinite(raw.age)?Math.max(0,raw.age):0;
    }
    return true;
  }
  function metrics(){
    let mass=0,dense=0;
    for(const c of cells.values()){ mass+=Number(c.d)||0; if(c.d>=0.72)dense++; }
    return {active:cells.size,mass:+mass.toFixed(2),dense,cap:MAX_CELLS,queue:queue.length,processed:lastProcessed,budget:lastBudget};
  }

  const api={update,draw,emit,densityAt,denseCells,consumeAt,updateSoot,visualSoot,drawSootMarks,onTileChanged,snapshot,restore,reset,metrics,count:()=>cells.size,config:{STEP,MAX_CELLS,MAX_DENSITY,SOOT_FADE_SECONDS,BUOYANT_SECONDS,SETTLED_SECONDS,TRAPPED_AGE_BOOST,TRAPPED_WEAR},_debug:{cells,smokeOpenTile,ventilationAt,physicsStep}};
  root.MM.smoke=api;
})();

export const smoke=(typeof window!=='undefined'&&window.MM)?window.MM.smoke:globalThis.MM&&globalThis.MM.smoke;
export default smoke;
