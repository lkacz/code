// Cape cloth: Verlet chain with single-pass root→tip constraints, aerodynamic
// drag (quadratic normal component — the flutter engine — plus a tangential
// term so vertical airflow streams the cloth), min-axis tile pushout with
// solid-neighbour masking, body/mob collision and per-node fluid submersion.
// Fabric identity (physics + paint) comes from cape_fabrics.js; the paint path
// shades folds from the chain's own curvature and places the sheen band by arc
// length against the solar direction. Deterministic: no performance.now() or
// Math.random() anywhere in the sim/draw path — phases ride the sim clock.
import { CAPE, T } from '../constants.js';
import { capeFabrics as FAB } from './cape_fabrics.js';
window.MM = window.MM || {};
(function(){
  const capeAPI = {};
  const cape = [];            // nodes {x,y,px,py} — _segments contract: live {x,y}
  let leftPts = [];
  let rightPts = [];
  // Legacy silhouette table: ids double as builtin item ids and the panel
  // preview reads wTop/wBot/edge/flare/shiny through getStyle(). Half-widths
  // stay ≤0.30 tiles — the POST_FX hero-backdrop erase pad is 0.5 tiles around
  // the SPINE, and the widest profile plus hem decoration must fit inside it.
  const CAPE_STYLES = {
    classic: { wTop:0.20,wBot:0.28, edge:'straight', flare:1,    shiny:false, mass:1,   stiffness:6,   wind:1 },
    triangle:{ wTop:0.20,wBot:0.20, edge:'point',    flare:0.9,  shiny:false, mass:0.9, stiffness:6.5, wind:1.1 },
    royal:   { wTop:0.24,wBot:0.30, edge:'scallop',  flare:1.20, shiny:true,  mass:1.6, stiffness:4.5, wind:0.7, scallopDepth:6 },
    tattered:{ wTop:0.20,wBot:0.28, edge:'ragged',   flare:1,    shiny:false, mass:1,   stiffness:5.5, wind:1.2 },
    winged:  { wTop:0.22,wBot:0.30, edge:'wave',     flare:1.25, shiny:true,  mass:0.8, stiffness:7,   wind:1.3 },
    shadow:  { wTop:0.20,wBot:0.28, edge:'ragged',   flare:1.15, shiny:false, mass:0.7, stiffness:7.5, wind:1.5 }
  };
  const SEGS = CAPE.SEGMENTS;
  const GRAV = 20;
  const MAX_STEP = 0.4;       // per-frame node displacement clamp (tunneling guard)
  const TELEPORT_DIST = 2.0;  // anchor jump beyond this hard-resets the chain
  const FACING_BIAS = 5.2;    // t/s² idle hang-behind-facing (≈15° sway — reads past the body in profile)
  const AIR_CLAMP = 14;       // apparent-wind clamp (explosion/updraft guard)
  const LIN_DRAG = 2.2;       // linear viscous term — the flutter governor
  const FALLBACK_FAB = {lengthTiles:0.82, massMul:1, drag:0.85, damp:0.985, bendLimit:0.62, straighten:0.03, flutter:1, windMul:1};

  // --- developer tuning seam -------------------------------------------------
  // Identity by default: an untouched build integrates exactly the numbers
  // cape_fabrics.js publishes, so the pinned behaviour suite still describes the
  // shipping cape. The multipliers (drag/flutter/wind/stiff/len) scale each
  // fabric's OWN value — the ten archetypes keep their relative identities while
  // a whole-cloth feel is dialled in; grav/gov/bias are absolute because they are
  // global constants with no per-fabric counterpart; damp is an OFFSET because
  // damping lives at 0.97-0.99, where a multiplier is unusable. Written only by
  // the developer toolbox (ui.js injectCapeDebugPanel) — the shipped game never
  // touches it, and reading a nine-key object nine times a frame is free.
  const TUNE_DEFAULTS=Object.freeze({
    grav:GRAV, gov:LIN_DRAG, flutter:1, drag:1, wind:1, stiff:1, damp:0, len:1, bias:FACING_BIAS
  });
  // Ranges are the sanitiser, not just slider bounds: a NaN or an absurd
  // multiplier reaching the integrator would poison the chain (and `damp` above
  // 1 makes the Verlet step diverge outright).
  const TUNE_RANGE=Object.freeze({
    grav:[0,60], gov:[0,8], flutter:[0,3], drag:[0,3], wind:[0,3],
    stiff:[0.2,6], damp:[-0.06,0.008], len:[0.4,1.8], bias:[-20,20]
  });
  const tune=Object.assign({}, TUNE_DEFAULTS);
  function setTuning(patch){
    if(patch && typeof patch==='object'){
      for(const k in TUNE_RANGE){
        if(!Object.prototype.hasOwnProperty.call(patch,k)) continue;
        const n=Number(patch[k]);
        if(!Number.isFinite(n)) continue;
        tune[k]=clamp(n,TUNE_RANGE[k][0],TUNE_RANGE[k][1]);
      }
    }
    return Object.assign({}, tune);
  }
  function resetTuning(){ Object.assign(tune,TUNE_DEFAULTS); return Object.assign({}, tune); }
  // Debug look override: the toolbox wears any fabric/silhouette without owning
  // the item. Null = the equipped cape decides, which is the only shipping path
  // (inventory.syncCustomization would otherwise stomp a customization write on
  // the next equip).
  let lookOverride=null;
  function setLookOverride(o){
    if(!o){ lookOverride=null; return null; }
    const next={};
    if(o.fabric && FAB && FAB.FABRICS && FAB.FABRICS[o.fabric]) next.fabric=o.fabric;
    if(o.style && CAPE_STYLES[o.style]) next.style=o.style;
    if(o.irid!=null) next.irid=!!o.irid;
    if(typeof o.color==='string' && /^#[0-9a-f]{6}$/i.test(o.color)) next.color=o.color;
    lookOverride=Object.keys(next).length?next:null;
    return lookOverride?Object.assign({},lookOverride):null;
  }

  // --- sim state -------------------------------------------------------------
  let simT = 0;               // module clock: all wave phases key off this
  let prevDt = 1/60;
  let prevAx = null, prevAy = null;
  let prevPx = null, prevPy = null;   // player position for the sub-step slide
  let curSegLen = 0.0955;             // rest link length, refreshed per frame
  let glowArmed = false;              // one glow per SIM frame (draw also runs for the mirror)
  let windCache = 0, windCacheT = 1e9, windCacheTx = 1e9, windCacheTy = 1e9;
  const bounds = {minX:0, maxX:0, minY:0, maxY:0};
  // 4-slot proximity scratch for the mob collider budget (module scope keeps
  // the sim path zero-alloc).
  const pickM=[null,null,null,null], pickS=[null,null,null,null], pickD=[0,0,0,0];
  let pickN=0;

  function getCurrentCustomization(){ return (window.MM && MM.customization) || {capeStyle:'classic',capeColor:'#b91818'}; }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function sign(v){ return v<0?-1:(v>0?1:0); }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  // Style + fabric + color snapshot for this frame. capeFabric/capeIrid are
  // written by inventory.syncCustomization from the equipped ITEM; bare style
  // ids (tests, legacy writers) resolve through the fabric table's builtin map.
  function currentLook(){
    const c=getCurrentCustomization();
    const ov=lookOverride;
    const styleId=(ov&&ov.style)||c.capeStyle||'classic';
    const style=CAPE_STYLES[styleId]||CAPE_STYLES.classic;
    let fabId=c.capeFabric, irid=!!c.capeIrid;
    if(!fabId || !(FAB && FAB.FABRICS && FAB.FABRICS[fabId])){
      const r=FAB ? FAB.resolve({id:styleId}) : {fabric:'cloth', irid:false};
      fabId=r.fabric; irid=r.irid;
    }
    if(ov){
      if(ov.fabric) fabId=ov.fabric;
      if(ov.irid!=null) irid=ov.irid;
    }
    const fab=(FAB ? FAB.get(fabId) : null)||FALLBACK_FAB;
    return {style, styleId, fab, fabId, irid, color:(ov&&ov.color)||c.capeColor||'#b91818', facing:1};
  }
  // Collar pins at the BACK EDGE of the body, not its centre: in a side view a
  // centre-hung cape drapes inside the sprite and the body occludes it whole.
  // The offset EASES across a turn (the collar swings around the body in a few
  // frames — a hard flip would teleport every node by the body width).
  let backOffCur=0;
  function backOffTarget(player){ return sign(player.facing||1)*Math.min(0.28, player.w*0.40); }
  function anchorFor(player){
    return {
      x: player.x - backOffCur,
      y: player.y - player.h/2 + player.h*CAPE.ANCHOR_FRAC
    };
  }
  function init(player){
    cape.length=0;
    if(!player) return;
    backOffCur=backOffTarget(player);
    const a=anchorFor(player);
    const back=sign(player.facing||1);
    for(let i=0;i<SEGS;i++){
      const x=a.x - back*i*0.02;
      const y=a.y + i*0.07;
      cape.push({x, y, px:x, py:y});
    }
    prevAx=a.x; prevAy=a.y;
    prevPx=player.x; prevPy=player.y;
    windCacheT=-1e9;
    simT=0;
    prevDt=1/60;
  }
  // Fluid submersion 0..1 at a node. Water reads the sub-tile ledger when the
  // water module is present (a 1/10-full puddle no longer counts as diving).
  function submersionAt(x,y,getTile){
    const t=getSafe(getTile,Math.floor(x),Math.floor(y),T.AIR);
    if(t===T.LAVA) return 2; // encoded: 2 = lava (denser than the cloth)
    if(t!==T.WATER) return 0;
    try{
      const W=window.MM && MM.water;
      if(W && typeof W.levelAt==='function' && W.UNITS){
        const u=W.levelAt(x,y,getTile)/W.UNITS;
        return Number.isFinite(u) ? clamp(u,0,1) : 1;
      }
    }catch(e){}
    return 1;
  }
  function sampleWind(ax,ay,getTile){
    // wind.exposureAt walks up to ~76 tiles per sample; cache by anchor tile
    // and a short clock so the cape costs a handful of getTile calls per frame.
    const tx=Math.floor(ax), ty=Math.floor(ay);
    if(simT-windCacheT<0.12 && tx===windCacheTx && ty===windCacheTy) return windCache;
    let w=0;
    try{
      const W=window.MM && MM.wind;
      if(W){
        if(typeof W.speedAt==='function') w=W.speedAt(ax,ay,getTile)||0;
        else if(typeof W.speed==='function') w=W.speed()||0;
      }
    }catch(e){}
    windCache=w; windCacheT=simT; windCacheTx=tx; windCacheTy=ty;
    return w;
  }
  // Move a node without injecting Verlet velocity: position and previous
  // position shift together (a small remainder keeps a readable impact).
  function shiftNode(seg,dx,dy){
    seg.x+=dx; seg.y+=dy;
    seg.px+=dx*0.85; seg.py+=dy*0.85;
  }
  // Min-axis AABB pushout with solid-neighbour masking: a node buried against
  // an interior face is never ejected into more wall. Friction damps the
  // tangential Verlet velocity so cloth drapes over ledges instead of skating.
  function pushOutOfTile(seg,tx,ty,getTile,isSolid){
    const eps=0.02;
    const dl=seg.x-tx, dr=tx+1-seg.x, du=seg.y-ty, dd=ty+1-seg.y;
    const openL=!isSolid(getSafe(getTile,tx-1,ty,T.STONE));
    const openR=!isSolid(getSafe(getTile,tx+1,ty,T.STONE));
    const openU=!isSolid(getSafe(getTile,tx,ty-1,T.STONE));
    const openD=!isSolid(getSafe(getTile,tx,ty+1,T.STONE));
    let best=Infinity, axis=0;
    if(openL && dl<best){ best=dl; axis=1; }
    if(openR && dr<best){ best=dr; axis=2; }
    if(openU && du<best){ best=du; axis=3; }
    if(openD && dd<best){ best=dd; axis=4; }
    if(!axis) return; // fully enclosed: leave it — the chain drags it free
    const fric=0.5;
    if(axis===1){ shiftNode(seg,(tx-eps)-seg.x,0);   seg.py=seg.y-(seg.y-seg.py)*(1-fric); }
    else if(axis===2){ shiftNode(seg,(tx+1+eps)-seg.x,0); seg.py=seg.y-(seg.y-seg.py)*(1-fric); }
    else if(axis===3){ shiftNode(seg,0,(ty-eps)-seg.y);   seg.px=seg.x-(seg.x-seg.px)*(1-fric); }
    else { shiftNode(seg,0,(ty+1+eps)-seg.y); seg.px=seg.x-(seg.x-seg.px)*(1-fric); }
  }
  // Pushout from a body rect (co-op peers, nearby mobs). One-directional by
  // contract: the world shoves the cloth, never the reverse. Min-axis ejection,
  // relaxed to one rest length per frame — snapping a node to the exact face is
  // a teleport that runs AFTER the constraint, so nothing restores
  // inextensibility: every penetrating node lands on the same coordinate (a
  // 7-node pile inside 0.09 t) while the link feeding them stretches to 8x
  // rest. Sliding out over a few frames keeps the chain a chain, and a node
  // near a body's crown drapes over its back instead of grinding sideways
  // through the full body width.
  function pushOutOfBody(seg,bx,by,bw,bh,bvx,bvy,dt){
    const hw=bw*0.5, hh=bh*0.5;
    if(seg.x<=bx-hw || seg.x>=bx+hw || seg.y<=by-hh || seg.y>=by+hh) return;
    const dl=seg.x-(bx-hw), dr=(bx+hw)-seg.x, du=seg.y-(by-hh), dd=(by+hh)-seg.y;
    const m=Math.min(dl,dr,du,dd), cap=curSegLen*0.9;
    const cl=v=>v<-cap?-cap:(v>cap?cap:v);
    if(m===dl) shiftNode(seg,cl(-(dl+0.01)),0);
    else if(m===dr) shiftNode(seg,cl(dr+0.01),0);
    else if(m===du) shiftNode(seg,0,cl(-(du+0.01)));
    else shiftNode(seg,0,cl(dd+0.01));
    // carry the body's motion into the cloth so a charging mob drags it along
    seg.px-=(bvx||0)*dt*0.6;
    seg.py-=(bvy||0)*dt*0.6;
  }
  // The anchor is driven from OUTSIDE at real time while dt is clamped for
  // integrator stability: a 0.05 s frame (main.js MAX_FRAME_DT) pushed through
  // a 1/30 clamp makes the hero effectively sprint 1.5x faster in the cape's
  // frame and the cloth trails flat below 30 fps. Sub-step and slide the
  // anchor across the sub-steps so sim time equals real time; a real teleport
  // routes down the plain path so the re-seed guard still sees the full jump.
  function update(player,dt,getTile,isSolid){
    glowArmed=true;
    if(!cape.length || !player || !(dt>0) || !isFinite(dt)) return;
    if(dt>1/30 && dt<0.5 && prevPx!==null &&
       Math.abs(player.x-prevPx)+Math.abs(player.y-prevPy)<=TELEPORT_DIST){
      const n=Math.min(4,Math.ceil(dt*30));
      const sx=prevPx, sy=prevPy, ex=player.x, ey=player.y;
      for(let s=1;s<=n;s++){
        const sub=Object.create(player);
        sub.x=sx+(ex-sx)*(s/n); sub.y=sy+(ey-sy)*(s/n);
        step(sub,dt/n,getTile,isSolid);
      }
      prevPx=ex; prevPy=ey;
      return;
    }
    prevPx=player.x; prevPy=player.y;
    step(player,dt,getTile,isSolid);
  }
  function step(player,dt,getTile,isSolid){
    dt=clamp(dt,1/240,1/30);
    const look=currentLook();
    const fab=look.fab;
    const segLen=fab.lengthTiles*tune.len/(SEGS-1);
    curSegLen=segLen;
    backOffCur+=(backOffTarget(player)-backOffCur)*Math.min(1,dt*10);
    const a=anchorFor(player);
    // NaN heal: one poisoned node re-seeds the whole chain (necklace idiom).
    let acc=0;
    for(let i=0;i<SEGS;i++){ acc+=cape[i].x+cape[i].y+cape[i].px+cape[i].py; }
    if(!isFinite(acc)){ init(player); return; }
    // Teleport guard: respawn/teleporter/worldSim-wake must not whip the chain
    // across the map through every intervening wall.
    if(prevAx===null || Math.abs(a.x-prevAx)+Math.abs(a.y-prevAy)>TELEPORT_DIST){
      init(player);
      return;
    }
    const aVx=(a.x-prevAx)/dt, aVy=(a.y-prevAy)/dt;
    prevAx=a.x; prevAy=a.y;
    simT+=dt;
    const pvx=Number.isFinite(player.vx)?player.vx:0;
    const pvy=Number.isFinite(player.vy)?player.vy:0;
    const facing=sign(player.facing||1);
    const wind=sampleWind(a.x,a.y,getTile)*fab.windMul*tune.wind*(look.style.wind||1);
    const windMag=clamp(Math.abs(wind)/7.2,0,1);
    const speedMag=clamp((Math.abs(pvx)+Math.abs(pvy))/8,0,1);
    // Damping schedule: a calm standing hero settles fast; motion and wind keep
    // the cloth lively. Applied frame-rate independently via pow(base, dt*60).
    const activity=clamp(windMag*1.3+speedMag*1.2,0,1);
    const fabDamp=clamp(fab.damp+tune.damp,0.90,0.9985);
    const dampBase=0.90+(fabDamp-0.90)*(0.30+0.70*activity);
    const tcv=dt/prevDt; prevDt=dt;
    // Flutter seed: near-zero in calm air (its residual would resonate with
    // the chain's pendulum mode and never let it settle) and pitched above
    // the natural frequency — frequency rises with flow speed (Strouhal).
    const flutterAmp=fab.flutter*tune.flutter*(0.03+windMag*2.2+speedMag*0.8);
    const phase=simT*(4.6+Math.abs(wind)*1.5);
    cape[0].px=cape[0].x; cape[0].py=cape[0].y;
    cape[0].x=a.x; cape[0].y=a.y;
    // --- forces + Verlet integration ---------------------------------------
    for(let i=1;i<SEGS;i++){
      const seg=cape[i];
      const par=cape[i-1];
      const subRaw=submersionAt(seg.x,seg.y,getTile);
      const lava=subRaw===2;
      const sub=lava?1:subRaw;
      // segment frame: tangent from parent, normal perpendicular
      let tx=seg.x-par.x, ty=seg.y-par.y;
      const td=Math.sqrt(tx*tx+ty*ty)||0.0001;
      tx/=td; ty/=td;
      const nx=-ty, ny=tx;
      // node velocity (Verlet-implicit), averaged with the parent for the link
      const svx=((seg.x-seg.px)+(par.x-par.px))*0.5/dt;
      const svy=((seg.y-seg.py)+(par.y-par.py))*0.5/dt;
      // Apparent wind = true air motion − node motion in the WORLD frame. The
      // anchor may be pinned while the body claims velocity (headless
      // harnesses, replica bodies), so the carrier motion is reconstructed as
      // (player velocity − measured anchor velocity) and added back.
      let awx=wind*(1-sub*0.96) - (svx-aVx) - pvx;
      let awy=-(svy-aVy) - pvy;
      awx=clamp(awx,-AIR_CLAMP,AIR_CLAMP);
      awy=clamp(awy,-AIR_CLAMP,AIR_CLAMP);
      // Drag = quadratic form drag (normal component is self-amplifying —
      // broadside catches more air; that feedback loop IS the flutter, and the
      // quarter-strength tangential term streams the cloth in a dive) plus a
      // linear viscous term. The linear term is the flutter governor: apparent
      // wind already contains −nodeVelocity, so it damps transverse swings and
      // bounds the limit cycle to a readable ripple instead of a wild flap.
      const an=awx*nx+awy*ny;
      const at=awx*tx+awy*ty;
      const dragBase=fab.drag*tune.drag;
      const dragC=dragBase*(1-sub*0.65) + dragBase*1.8*sub;
      // The quadratic gain saturates at |6| — unclamped, its damping side
      // swamps the flutter limit cycle in fast flow and the cloth goes rigid;
      // the linear term keeps the direction response growing with flow speed.
      const anQ=clamp(an,-6,6), atQ=clamp(at,-6,6);
      let fx=dragC*(an*Math.abs(anQ)*nx + 0.25*at*Math.abs(atQ)*tx + tune.gov*awx);
      let fy=dragC*(an*Math.abs(anQ)*ny + 0.25*at*Math.abs(atQ)*ty + tune.gov*awy);
      // gravity with buoyancy: soaked cloth sinks gently in water and rides
      // on top of denser lava
      const buoy=1-sub*(lava?1.35:0.78);
      fy+=tune.grav*fab.massMul*buoy;
      // idle hang bias behind the facing direction (small; wind overrides it).
      // Scaled by the SAME buoyancy factor as gravity so the idle hang angle
      // is depth-invariant instead of ballooning where gravity is weak.
      fx+=-facing*tune.bias*Math.max(0,buoy);
      // traveling-wave flutter seed perpendicular to the link — the asymmetry
      // the aero feedback loop amplifies; submersion kills it
      const fl=flutterAmp*Math.sin(phase+i*0.8)*(0.3+0.7*i/(SEGS-1))*(1-sub);
      fx+=nx*fl; fy+=ny*fl;
      // Verlet step: implicit damping + time-corrected velocity term
      const k=Math.pow(dampBase,dt*60)*(sub>0?Math.pow(0.62,sub):1);
      let vx=(seg.x-seg.px)*k*tcv;
      let vy=(seg.y-seg.py)*k*tcv;
      const vmag=Math.sqrt(vx*vx+vy*vy);
      if(vmag>MAX_STEP){ vx*=MAX_STEP/vmag; vy*=MAX_STEP/vmag; }
      seg.px=seg.x; seg.py=seg.y;
      seg.x+=vx+fx*dt*dt;
      seg.y+=vy+fy*dt*dt;
    }
    // --- single-pass root→tip constraint with fused bend limit --------------
    // Projecting only the child onto its (already final) parent solves the
    // whole inextensible chain exactly in one pass — no iteration count, no
    // rubber-banding on teleport-adjacent moves. Stiff fabrics also blend each
    // link toward its parent direction (leather planks, silk flows).
    const bendLimit=clamp(fab.bendLimit/tune.stiff,0.02,1.5);
    const cosMax=Math.cos(bendLimit), sinMax=Math.sin(bendLimit);
    const straighten=clamp(fab.straighten*tune.stiff*dt*60,0,0.6);
    let pdx=0, pdy=1; // reference for the first link: straight down
    for(let i=1;i<SEGS;i++){
      const par=cape[i-1], seg=cape[i];
      let dx=seg.x-par.x, dy=seg.y-par.y;
      const d=Math.sqrt(dx*dx+dy*dy)||0.0001;
      dx/=d; dy/=d;
      if(i>1){
        // bend limit: rotate the link back inside ±bendLimit of the parent link
        const cosA=dx*pdx+dy*pdy;
        if(cosA<cosMax){
          const s=(pdx*dy-pdy*dx)<0?-1:1;
          dx=pdx*cosMax - s*pdy*sinMax;
          dy=s*pdx*sinMax + pdy*cosMax;
        }
        if(straighten>0){
          dx+=(pdx-dx)*straighten;
          dy+=(pdy-dy)*straighten;
          const dl=Math.sqrt(dx*dx+dy*dy)||1;
          dx/=dl; dy/=dl;
        }
      }
      seg.x=par.x+dx*segLen;
      seg.y=par.y+dy*segLen;
      pdx=dx; pdy=dy;
    }
    // --- mob + co-op body collision (position writes only; Verlet turns them
    // into velocity next frame). Reads are display-local: never writes any
    // body. The hero's OWN torso is deliberately not a collider — the cape is
    // drawn behind the body and legitimately overlaps it in a side view; a
    // hard body wall would trap the cloth behind the hero forever. -----------
    try{
      const bodies=window.MM && MM.coopBodies;
      if(bodies && bodies.length){
        for(const b of bodies){
          if(!b || !Number.isFinite(b.x) || Math.abs(b.x-a.x)>2.5 || Math.abs(b.y-a.y)>2.5) continue;
          for(let i=1;i<SEGS;i++) pushOutOfBody(cape[i],b.x,b.y,(b.w||0.7)*0.8,(b.h||0.95)*0.9,b.vx,b.vy,dt);
        }
      }
      const MOBS=window.MM && MM.mobs;
      if(MOBS && typeof MOBS.forEachLive==='function'){
        // NEAREST four, not the first four: MM.mobs is spawn-ordered, so the
        // mob that just charged into contact is LAST and would be starved by
        // loiterers idling at the edge of the window — and freeing a slot then
        // pops every starved node out in a single frame.
        pickN=0;
        MOBS.forEachLive((m,spec)=>{
          const dx=Math.abs(m.x-a.x), dy=Math.abs(m.y-a.y);
          if(dx>2.5 || dy>2.5) return;
          const d=dx+dy;
          if(pickN===4 && d>=pickD[3]) return;
          let i=pickN<4?pickN:3;
          while(i>0 && pickD[i-1]>d){ pickD[i]=pickD[i-1]; pickM[i]=pickM[i-1]; pickS[i]=pickS[i-1]; i--; }
          pickD[i]=d; pickM[i]=m; pickS[i]=spec;
          if(pickN<4) pickN++;
        });
        for(let k=0;k<pickN;k++){
          const m=pickM[k], spec=pickS[k];
          // mob geometry lives on spec.body (mobs.js spawns carry no w/h) —
          // same read as soft_drifts, the other forEachLive consumer
          const mb=spec&&spec.body;
          const mw=((mb&&mb.w)||0.8)*0.9, mh=((mb&&mb.h)||0.8)*0.9;
          for(let i=1;i<SEGS;i++) pushOutOfBody(cape[i],m.x,m.y,mw,mh,m.vx,m.vy,dt);
          pickM[k]=null; pickS[k]=null; // never pin a despawned mob across frames
        }
      }
    }catch(e){}
    // --- tile collision last: a node visibly inside rock is worse than one
    // link being a frame short --------------------------------------------
    bounds.minX=a.x; bounds.maxX=a.x; bounds.minY=a.y; bounds.maxY=a.y;
    const collide=(typeof getTile==='function' && typeof isSolid==='function');
    for(let i=1;i<SEGS;i++){
      const seg=cape[i];
      if(collide){
        const txi=Math.floor(seg.x), tyi=Math.floor(seg.y);
        const t=getSafe(getTile,txi,tyi,T.AIR);
        if(t!==T.WATER && t!==T.LAVA && isSolid(t)) pushOutOfTile(seg,txi,tyi,getTile,isSolid);
      }
      if(seg.x<bounds.minX) bounds.minX=seg.x;
      if(seg.x>bounds.maxX) bounds.maxX=seg.x;
      if(seg.y<bounds.minY) bounds.minY=seg.y;
      if(seg.y>bounds.maxY) bounds.maxY=seg.y;
    }
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================
  const frame={tx:[],ty:[],s:[],turn:[],w:[]};
  function hexRgb(col,fallback){
    const m=/^#([0-9a-f]{6})$/i.exec(String(col||''));
    const n=parseInt(m?m[1]:(fallback||'b91818'),16);
    return [(n>>16)&255,(n>>8)&255,n&255];
  }
  function rgbHex(c){
    const cl=v=>Math.min(255,Math.max(0,Math.round(v)));
    return '#'+cl(c[0]).toString(16).padStart(2,'0')+cl(c[1]).toString(16).padStart(2,'0')+cl(c[2]).toString(16).padStart(2,'0');
  }
  function mixRgb(a,b,t){
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  }
  function rgba(c,a){
    return 'rgba('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+','+(+a.toFixed(3))+')';
  }
  // Hardened shade: a malformed swatch degrades to the default red instead of
  // minting 'NaN' hex and killing the frame in addColorStop.
  function shade(col,delta){
    return rgbHex(mixRgb(hexRgb(col),delta>0?[255,255,255]:[0,0,0],Math.min(1,Math.abs(delta)/255)));
  }
  // Scene inputs shared by the sheen band and rim alpha: solar direction from
  // the background cycle (the same model the coat and ground shadows use — the
  // sun rises on screen LEFT) plus the coat's chased environment tint when the
  // ultra pipeline is live. All guarded: headless draws fall back to noon.
  function sceneLight(){
    let tDay=0.5, day=1;
    try{
      const bg=window.MM && MM.background;
      if(bg && typeof bg.getCycleInfo==='function'){
        const c=bg.getCycleInfo();
        if(c && typeof c.tDay==='number' && isFinite(c.tDay)){
          tDay=clamp(c.tDay,0,1);
          day=c.isDay?Math.sin(tDay*Math.PI):0.12;
        }
      }
    }catch(e){}
    let env=null;
    try{
      const P=window.MM && MM.postFx;
      if(P && typeof P._sheenState==='function'){ const s=P._sheenState(); if(s && s.mid) env=s.mid; }
    }catch(e){}
    // light half-direction: the sun azimuth sweeps left→right, tilted down
    let hx=Math.cos(tDay*Math.PI), hy=-0.6;
    const hl=Math.sqrt(hx*hx+hy*hy); hx/=hl; hy/=hl;
    return {hx, hy, day, env};
  }
  // --- pattern bakes: one 16px tile per (motif|color), applied through
  // createPattern with a transform so the texture rides the cloth instead of
  // swimming in canvas space -------------------------------------------------
  const patternCache=new Map();
  let patternMatrix=null;
  function patternFor(motif,colorHex){
    const key=motif+'|'+colorHex;
    let p=patternCache.get(key);
    if(p!==undefined) return p;
    if(patternCache.size>24) patternCache.clear();
    p=null;
    try{
      const c=document.createElement('canvas');
      c.width=16; c.height=16;
      const g=c.getContext('2d');
      const base=hexRgb(colorHex);
      if(motif==='scale'){
        // overlapping plates: light upper arc, dark lower arc, offset rows
        for(let row=0;row<4;row++){
          for(let col=0;col<4;col++){
            const cx=col*4+(row%2?2:0), cy=row*4;
            g.strokeStyle=rgba(mixRgb(base,[255,255,255],0.45),0.85);
            g.beginPath(); g.arc(cx+2,cy+1,2.1,Math.PI*0.15,Math.PI*0.85,false); g.stroke();
            g.strokeStyle=rgba(mixRgb(base,[0,0,0],0.5),0.7);
            g.beginPath(); g.arc(cx+2,cy+2.4,2.1,Math.PI*0.2,Math.PI*0.8,false); g.stroke();
          }
        }
      } else if(motif==='weave'){
        g.strokeStyle=rgba(mixRgb(base,[255,255,255],0.22),0.5);
        for(let i=0;i<4;i++){ g.beginPath(); g.moveTo(i*4+0.5,0); g.lineTo(i*4+0.5,16); g.stroke(); }
        g.strokeStyle=rgba(mixRgb(base,[0,0,0],0.3),0.4);
        for(let i=0;i<4;i++){ g.beginPath(); g.moveTo(0,i*4+0.5); g.lineTo(16,i*4+0.5); g.stroke(); }
      } else if(motif==='fur'){
        // pile streaks: short strands in two values, deterministic scatter
        for(let i=0;i<22;i++){
          const x=(i*7.3)%16, y=(i*4.7)%14;
          g.strokeStyle=rgba(mixRgb(base,i%2?[255,255,255]:[0,0,0],0.35),0.55);
          g.beginPath(); g.moveTo(x,y); g.lineTo(x+(i%3-1)*0.8,y+2.6); g.stroke();
        }
      }
      p=g.createPattern(c,'repeat');
    }catch(e){ p=null; }
    patternCache.set(key,p);
    return p;
  }
  // Build the ribbon outline as the CURRENT ctx path (fill/stroke/clip all
  // reuse it — exactly one geometry build per draw).
  function buildOutline(ctx,pts,n,edge,style,TILE){
    ctx.beginPath();
    ctx.moveTo(leftPts[0].x,leftPts[0].y);
    for(let i=1;i<n;i++) ctx.lineTo(leftPts[i].x,leftPts[i].y);
    const lp=leftPts[n-1], rp=rightPts[n-1];
    const hx=frame.tx[n-1], hy=frame.ty[n-1]; // hem bulge = chain tangent
    if(edge==='point'){
      ctx.lineTo((lp.x+rp.x)/2+hx*8,(lp.y+rp.y)/2+hy*8);
      ctx.lineTo(rp.x,rp.y);
    } else if(edge==='shard'){
      for(let k=0;k<3;k++){
        const t0=(k+0.5)/3, t1=(k+1)/3;
        ctx.lineTo(lp.x+(rp.x-lp.x)*t0+hx*3.2,lp.y+(rp.y-lp.y)*t0+hy*3.2);
        ctx.lineTo(lp.x+(rp.x-lp.x)*t1,lp.y+(rp.y-lp.y)*t1);
      }
    } else if(edge==='scallop' || edge==='feather'){
      const depth=(style.scallopDepth||4);
      for(let k=1;k<=3;k++){
        const t0=(k-0.5)/3, t1=k/3;
        ctx.quadraticCurveTo(
          lp.x+(rp.x-lp.x)*t0+hx*depth, lp.y+(rp.y-lp.y)*t0+hy*depth,
          lp.x+(rp.x-lp.x)*t1, lp.y+(rp.y-lp.y)*t1);
      }
    } else if(edge==='ragged'){
      ctx.lineTo(rp.x+hx*3,rp.y+hy*3);
      ctx.lineTo(rp.x,rp.y);
    } else {
      ctx.lineTo(rp.x,rp.y);
    }
    // right side back up; tufts fan OUTWARD along the local normal so a
    // flapping cape's fringe points away from the cloth instead of shearing
    for(let i=n-2;i>=0;i--){
      const p=rightPts[i];
      if(edge==='ragged' && i>0){
        const amp=2+((i*928371)%5)*0.55;
        const ox=frame.ty[i]*amp, oy=-frame.tx[i]*amp;
        ctx.lineTo(p.x+(i%2?ox:ox*0.25),p.y+(i%2?oy:oy*0.25));
        ctx.lineTo(p.x,p.y);
      } else if(edge==='scallop' || edge==='feather'){
        const prev=rightPts[i+1];
        const ox=frame.ty[i]*2.6, oy=-frame.tx[i]*2.6;
        ctx.quadraticCurveTo((p.x+prev.x)/2+ox,(p.y+prev.y)/2+oy,p.x,p.y);
      } else {
        ctx.lineTo(p.x,p.y);
      }
    }
    ctx.closePath();
  }
  // One gradient carries base ramp + fold darkening + sheen band + iridescent
  // hue + lining hint; one clip + one 'lighter' block carries every additive
  // feature. Wrapped in save/restore — no canvas state leaks, and globalAlpha
  // is only ever multiplied (the antenna cloak owns the absolute value).
  function paintRibbon(ctx,TILE,pts,n,look,opts){
    const fab=look.fab||FALLBACK_FAB;
    const style=look.style;
    const light=opts.light;
    // One edge resolution for silhouette AND width wave (they used to disagree:
    // a cloth-fabric cape on the winged style got 'wave' geometry with no wave).
    const edge=fab.edge==='straight'&&style.edge!=='straight' ? style.edge : (fab.edge||style.edge||'straight');
    // --- frame: tangents, arc length, signed turn, half-widths --------------
    // Normalize, never clip: scale the WHOLE profile so its peak lands on the
    // 0.30-tile cap (the hero-backdrop erase pad budget). Clipping post-flare
    // pinned royal/winged at constant width and rectified silk's wave hem —
    // the wave modulation is the only place 'wave' is implemented.
    const flare=style.flare||1;
    const waveAmp=edge==='wave'?0.14:0;
    const wPeak=Math.max(style.wTop,style.wBot)*flare*(1+waveAmp);
    const wk=wPeak>0.30 ? 0.30/wPeak : 1;
    let sTotal=0;
    for(let i=0;i<n;i++){
      const cur=pts[i];
      const nxt=pts[Math.min(n-1,i+1)];
      const prv=pts[Math.max(0,i-1)];
      const dx=(i===n-1)?(cur.x-prv.x):(nxt.x-cur.x);
      const dy=(i===n-1)?(cur.y-prv.y):(nxt.y-cur.y);
      const d=Math.sqrt(dx*dx+dy*dy)||0.0001;
      frame.tx[i]=dx/d; frame.ty[i]=dy/d;
      if(i>0) sTotal+=d;
      frame.s[i]=sTotal;
      const t=i/(n-1);
      let w=style.wTop+(style.wBot-style.wTop)*t;
      if(waveAmp) w*=1+waveAmp*Math.sin(t*6+(opts.wavePhase||0));
      frame.w[i]=w*flare*wk;
    }
    sTotal=sTotal||0.0001;
    for(let i=0;i<n;i++){
      frame.turn[i]=(i>0&&i<n-1) ? (frame.tx[i-1]*frame.ty[i]-frame.ty[i-1]*frame.tx[i]) : 0;
    }
    if(leftPts.length!==n){ leftPts=new Array(n); rightPts=new Array(n); }
    for(let i=0;i<n;i++){
      const w=frame.w[i], ox=-frame.ty[i]*w, oy=frame.tx[i]*w;
      leftPts[i]=leftPts[i]||{}; rightPts[i]=rightPts[i]||{};
      leftPts[i].x=(pts[i].x+ox)*TILE; leftPts[i].y=(pts[i].y+oy)*TILE;
      rightPts[i].x=(pts[i].x-ox)*TILE; rightPts[i].y=(pts[i].y-oy)*TILE;
    }
    buildOutline(ctx,pts,n,edge,style,TILE);
    // --- base color under the tint rule -------------------------------------
    let base;
    if(fab.tint==='ignore') base=mixRgb(hexRgb(fab.identity||look.color),hexRgb(look.color),0.12);
    else if(fab.tint==='bias') base=mixRgb(hexRgb(look.color),hexRgb(fab.identity||look.color),0.55);
    else base=hexRgb(look.color);
    const basePat=base;   // pattern-bake key: pre-env swatch, stable across the sheen chase
    if(light.env) base=mixRgb(base,light.env,0.15);
    const liningCol=fab.lining?hexRgb(fab.lining):mixRgb(base,[255,255,255],0.35);
    const alphaBase=(fab.alpha!=null?fab.alpha:1);
    // --- single gradient fill -----------------------------------------------
    // createLinearGradient's axis is the anchor→hem CHORD, so each stop must
    // sit at the node's PROJECTION onto that chord. Arc offsets only agree
    // while the cape is straight: a whipped cape (jump, fast fall, sprint
    // stop) folds the hem back over the collar until the chord is sub-pixel,
    // and 12 stops crammed into 1px paint two flat half-planes whose split
    // line spins on sub-pixel noise. Under a usable chord no straight axis can
    // carry the ramp at all, so the fill goes flat at the mid tone.
    const axx=(pts[n-1].x-pts[0].x)*TILE, axy=(pts[n-1].y-pts[0].y)*TILE;
    const axLen2=axx*axx+axy*axy;
    const axMin=0.35*sTotal*TILE;
    const flat=axLen2 < axMin*axMin;
    const grad=flat?null:ctx.createLinearGradient(pts[0].x*TILE,pts[0].y*TILE,pts[n-1].x*TILE,pts[n-1].y*TILE);
    const midI=Math.round((n-1)*0.5);
    let midCol=null, lastOff=-1;
    const sheenAmp=(fab.sheenAmp||0)*(0.35+0.65*light.day);
    let sheenPeak=0, sheenAt=0.5;
    for(let i=0;i<n;i++){
      const t=clamp(frame.s[i]/sTotal,0,1);   // arc position still drives the SHADING
      const aDot=frame.tx[i]*light.hx+frame.ty[i]*light.hy;
      const sheen=sheenAmp*Math.pow(Math.max(0,1-aDot*aDot),(fab.sheenPow||3)*0.5);
      if(sheen>sheenPeak){ sheenPeak=sheen; sheenAt=t; }
      const turnK=clamp(Math.abs(frame.turn[i])*3.2,0,1);
      const alpha=alphaBase*(alphaBase<1?(1-t*0.55):1);
      let col;
      if(look.irid){
        const hue=((Math.atan2(frame.ty[i],frame.tx[i])*91.7)+540)%360;
        col='hsla('+(hue|0)+',62%,'+((46+34*sheen)|0)+'%,'+alpha.toFixed(3)+')';
      } else {
        let c=mixRgb(base,[0,0,0],0.34*turnK);              // concave fold darkening
        if(sheen>0.02) c=mixRgb(c,[255,255,255],sheen);     // anisotropic band
        // lining hint: a hard fold-back toward the hero flashes the lining
        if(turnK>0.55 && frame.tx[i]*look.facing>0.2) c=mixRgb(c,liningCol,0.4*(turnK-0.55)/0.45);
        col=rgba(c,alpha);
      }
      if(i===midI) midCol=col;
      if(flat) continue;
      // offset = where this node lands on the axis; folded-back nodes clamp
      // forward so the ramp stays monotonic (addColorStop sorts its stops —
      // an out-of-order offset would reverse the shading).
      let off=clamp(((pts[i].x-pts[0].x)*TILE*axx+(pts[i].y-pts[0].y)*TILE*axy)/axLen2,0,1);
      if(off<=lastOff) off=Math.min(1,lastOff+1e-4);
      lastOff=off;
      grad.addColorStop(off,col);
    }
    ctx.fillStyle=flat?midCol:grad;
    ctx.fill();
    // --- pattern overlay (scale plates, weave, fur pile) --------------------
    if(fab.pattern && !opts.noPattern){
      const pat=patternFor(fab.pattern,rgbHex(basePat));
      if(pat){
        try{
          if(!patternMatrix && typeof DOMMatrix==='function') patternMatrix=new DOMMatrix();
          if(patternMatrix && pat.setTransform){
            const ang=Math.atan2(frame.ty[1]||1,frame.tx[1]||0)-Math.PI/2;
            const cs=Math.cos(ang), sn=Math.sin(ang);
            patternMatrix.a=cs; patternMatrix.b=sn; patternMatrix.c=-sn; patternMatrix.d=cs;
            patternMatrix.e=pts[0].x*TILE; patternMatrix.f=pts[0].y*TILE;
            pat.setTransform(patternMatrix);
          }
          const ga=ctx.globalAlpha;
          ctx.globalAlpha=ga*(fab.pattern==='weave'?0.14:(fab.pattern==='fur'?0.22:0.30));
          ctx.fillStyle=pat;
          ctx.fill();
          ctx.globalAlpha=ga;
        }catch(e){}
      }
    }
    // --- trim / edge stroke (same path, before the clip consumes it) --------
    ctx.lineJoin='round';
    if(fab.trim){
      ctx.strokeStyle=fab.trim;
      ctx.lineWidth=1;
    } else {
      ctx.strokeStyle='rgba(255,255,255,'+(0.10+0.10*light.day).toFixed(3)+')';
      ctx.lineWidth=1;
    }
    ctx.stroke();
    // --- ONE additive block: rim light + sheen streak -----------------------
    const rimBright=fab.rim==='bright';
    if(rimBright || sheenPeak>0.05){
      ctx.save();
      ctx.clip();
      ctx.globalCompositeOperation='lighter';
      if(rimBright){
        // ONE edge for the whole polyline: the side whose outward normal faces
        // the light. Choosing per node from the curvature SIGN cut the stroke
        // straight across the cloth — the flutter wave flips that sign 2-3x
        // along a 12-node chain, so most of the stroke ran transverse.
        const mi=n>>1;
        const lit=((-frame.ty[mi]*light.hx+frame.tx[mi]*light.hy)>=0)?leftPts:rightPts;
        ctx.beginPath();
        ctx.moveTo(lit[1].x,lit[1].y);
        for(let i=2;i<n-1;i++) ctx.lineTo(lit[i].x,lit[i].y);
        const rc=fab.identity?mixRgb(hexRgb(fab.identity),[255,255,255],0.5):[255,255,255];
        ctx.strokeStyle=rgba(rc,0.10+0.22*light.day);
        ctx.lineWidth=1.3;
        ctx.stroke();
      }
      if(sheenPeak>0.05){
        // arc-length positioned specular streak across the band centre —
        // stuck to the light while the cloth flows underneath it
        const i0=Math.max(1,Math.round(sheenAt*(n-1))-1), i1=Math.min(n-1,i0+2);
        ctx.beginPath();
        ctx.moveTo(pts[i0].x*TILE,pts[i0].y*TILE);
        for(let i=i0+1;i<=i1;i++) ctx.lineTo(pts[i].x*TILE,pts[i].y*TILE);
        ctx.strokeStyle=rgba([255,255,255],clamp(sheenPeak*0.85,0,0.5));
        ctx.lineWidth=Math.max(1.5,frame.w[i0]*TILE*0.9);
        ctx.lineCap='round';
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function draw(ctx,TILE){
    if(!cape.length) return;
    const look=currentLook();
    look.facing=sign((window.player&&window.player.facing)||1);
    ctx.save();
    paintRibbon(ctx,TILE,cape,SEGS,look,{light:sceneLight(), wavePhase:simT*2});
    ctx.restore();
    // Emissive fabrics survive the darkness overlay through the glow seam —
    // one registration per SIM frame (draw() also runs for the home-mirror
    // reflection, which must not stack a second additive halo).
    if(glowArmed && look.fab && look.fab.glow>0){
      glowArmed=false;
      try{
        const P=window.MM && MM.postFx;
        if(P && typeof P.glow==='function'){
          const m=cape[Math.floor(SEGS*0.4)];
          P.glow(m.x*TILE,m.y*TILE,{color:look.fab.lining||look.fab.identity||'#ff7a26', rTiles:0.8, a:0.30*look.fab.glow, trail:false},'heroCape',TILE);
        }
      }catch(e){}
    }
  }
  // Panel preview: the same paint core over a canned spine so the inventory
  // panel and the world can never drift apart again. `t` animates a sway.
  const previewSpine=[];
  function drawPreviewCape(ctx,opts){
    opts=opts||{};
    const n=SEGS;
    const item=opts.item;
    const styleId=opts.styleId||(item&&item.id)||'classic';
    const style=CAPE_STYLES[styleId]||CAPE_STYLES.classic;
    const r=FAB?FAB.resolve(item||{id:styleId}):{fabric:'cloth',irid:false};
    const fabId=(opts.fabricId&&FAB&&FAB.FABRICS[opts.fabricId])?opts.fabricId:r.fabric;
    const look={
      style, styleId,
      fab:(FAB?FAB.get(fabId):null)||FALLBACK_FAB, fabId,
      irid:opts.irid!=null?!!opts.irid:r.irid,
      color:opts.color||'#b91818',
      facing:opts.facing||1
    };
    const t=opts.t||0;
    const len=(look.fab.lengthTiles||0.82)*(opts.scale||1);
    const ax=opts.x||0, ay=opts.y||0;
    if(previewSpine.length!==n){ previewSpine.length=0; for(let i=0;i<n;i++) previewSpine.push({x:0,y:0}); }
    const back=-look.facing;
    for(let i=0;i<n;i++){
      const k=i/(n-1);
      const sway=Math.sin(t*1.7+k*2.2)*0.10*k+Math.sin(t*0.8)*0.05*k;
      previewSpine[i].x=ax+back*(k*0.34*len+sway*len);
      previewSpine[i].y=ay+k*len*(0.94-0.10*Math.abs(sway));
    }
    ctx.save();
    paintRibbon(ctx,opts.TILE||20,previewSpine,n,look,{light:{hx:-0.55,hy:-0.83,day:1,env:null}, wavePhase:t*2, noPattern:opts.noPattern});
    ctx.restore();
  }
  capeAPI.init = init;
  capeAPI.update = update;
  capeAPI.draw = draw;
  capeAPI._segments = cape;
  capeAPI.styles = Object.keys(CAPE_STYLES);
  capeAPI.getStyle = function(id){ return Object.assign({}, CAPE_STYLES[id]||CAPE_STYLES.classic); };
  capeAPI.fabricForItem = function(item){ return FAB ? FAB.resolve(item) : {fabric:'cloth', irid:false}; };
  capeAPI.drawPreviewCape = drawPreviewCape;
  capeAPI.bounds = function(){ return bounds; };
  // Developer toolbox seams. Copies out, sanitised in — no caller can hand the
  // integrator a live reference or an unclamped number.
  capeAPI.tuning = function(){ return Object.assign({}, tune); };
  capeAPI.tuningDefaults = function(){ return Object.assign({}, TUNE_DEFAULTS); };
  capeAPI.tuningRange = function(){ const r={}; for(const k in TUNE_RANGE) r[k]=TUNE_RANGE[k].slice(); return r; };
  capeAPI.setTuning = setTuning;
  capeAPI.resetTuning = resetTuning;
  capeAPI.setLookOverride = setLookOverride;
  capeAPI.lookOverride = function(){ return lookOverride?Object.assign({},lookOverride):null; };
  // [{id,label}] for pickers — the fabric roster with its Polish labels.
  capeAPI.fabricList = function(){
    const F=FAB && FAB.FABRICS;
    if(!F) return [];
    return (FAB.FABRIC_IDS||Object.keys(F)).map(id=>({id, label:(F[id]&&F[id].label)||id}));
  };
  // The look the renderer would use RIGHT NOW (fabric id + effective physics),
  // so the toolbox can report what it is actually tuning.
  capeAPI.activeLook = function(){
    const l=currentLook();
    return {fabId:l.fabId, styleId:l.styleId, irid:!!l.irid, color:l.color, fab:Object.assign({}, l.fab)};
  };
  capeAPI._debug = { submersionAt, currentLook, shade, sampleWind:(p,g)=>sampleWind(p?p.x:0,p?p.y:0,g) };
  MM.cape = capeAPI;
})();
// ESM export (progressive migration)
export const cape = (typeof window!=='undefined' && window.MM) ? window.MM.cape : undefined;
export default cape;
