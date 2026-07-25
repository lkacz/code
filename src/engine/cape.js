// Cape physics extracted
import { MOVE, CAPE, T } from '../constants.js';
window.MM = window.MM || {};
(function(){
  const capeAPI = {};
  const cape = [];
  let leftPts = [];
  let rightPts = [];
  // Style definitions (id -> parameters)
  const CAPE_STYLES = {
    // Added physical params: mass (droop/inertia), stiffness (responsiveness), wind (multiplier), scallopDepth (px)
    classic: { wTop:0.10,wBot:0.24, edge:'straight', flare:1, shiny:false, mass:1, stiffness:6, wind:1 },
    triangle:{ wTop:0.12,wBot:0.15, edge:'point', flare:0.9, shiny:false, mass:0.9, stiffness:6.5, wind:1.1 },
    royal:   { wTop:0.14,wBot:0.36, edge:'scallop', flare:1.20, shiny:true, mass:1.6, stiffness:4.5, wind:0.7, scallopDepth:6 },
    tattered:{ wTop:0.10,wBot:0.26, edge:'ragged', flare:1, shiny:false, mass:1, stiffness:5.5, wind:1.2 },
    winged:  { wTop:0.08,wBot:0.30, edge:'wave', flare:1.25, shiny:true, mass:0.8, stiffness:7, wind:1.3 },
    shadow:  { wTop:0.09,wBot:0.28, edge:'ragged', flare:1.15, shiny:false, mass:0.7, stiffness:7.5, wind:1.5 }
  };
  function getCurrentCustomization(){ return (window.MM && MM.customization) || {capeStyle:'classic',capeColor:'#b91818'}; }
  function currentStyle(){ const c=getCurrentCustomization(); return CAPE_STYLES[c.capeStyle]||CAPE_STYLES.classic; }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function sign(v){ return v<0?-1:(v>0?1:0); }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function isFluidAt(x,y,getTile){
    const t=getSafe(getTile,Math.floor(x),Math.floor(y),T.AIR);
    return t===T.WATER || t===T.LAVA;
  }
  function sampleWind(player,getTile){
    try{
      const W=window.MM && MM.wind;
      if(!W || !player) return 0;
      const y=player.y - player.h*0.35;
      if(typeof W.speedAt==='function') return W.speedAt(player.x,y,getTile);
      if(typeof W.speed==='function') return W.speed();
    }catch(e){}
    return 0;
  }
  function init(player){
    const segs=CAPE.SEGMENTS;
    cape.length=0;
    for(let i=0;i<segs;i++) cape.push({x:player.x,y:player.y,vx:0,vy:0});
  }
  function constrainLength(segLen,passes){
    const segs=CAPE.SEGMENTS;
    for(let it=0; it<passes; it++){
      for(let i=1;i<segs;i++){
        const a=cape[i-1], b=cape[i];
        let dx=b.x-a.x, dy=b.y-a.y;
        const d=Math.hypot(dx,dy)||0.0001;
        const excess=d-segLen;
        if(Math.abs(excess)>0.0005){
          const k=excess/d;
          b.x -= dx*k;
          b.y -= dy*k;
        }
      }
    }
  }
  function collideSegments(getTile,isSolid){
    if(typeof getTile!=='function' || typeof isSolid!=='function') return;
    for(let i=1;i<cape.length;i++){
      const seg=cape[i];
      const tx=Math.floor(seg.x), ty=Math.floor(seg.y);
      const tile=getSafe(getTile,tx,ty,T.AIR);
      if(tile===T.WATER || tile===T.LAVA || !isSolid(tile)) continue;
      seg.y=ty-0.02;
      seg.vy=Math.min(0,seg.vy||0);
      const bc=tx+0.5;
      if(seg.x>bc) seg.x=Math.min(seg.x, tx+1.02);
      else seg.x=Math.max(seg.x, tx-0.02);
      seg.vx*=0.35;
    }
  }
  function update(player,dt,getTile,isSolid){
    if(!cape.length || !player || !(dt>0) || !isFinite(dt)) return;
    dt=clamp(dt,0.001,0.05);
    const segs=CAPE.SEGMENTS;
    const st=currentStyle();
    const mass=st.mass||1;
    const stiffness=st.stiffness||6;
    const windMul=st.wind||1;
    const anchorX=player.x;
    const anchorY=player.y - player.h/2 + player.h*CAPE.ANCHOR_FRAC;
    const speed=clamp(Math.abs(player.vx||0)/MOVE.MAX,0,1);
    const verticalSpeed=clamp((player.vy||0)/12,-1.4,1.4);
    const airborne=player.onGround===false;
    const fluid=isFluidAt(anchorX,anchorY,getTile);
    const time=performance.now();
    const rawWind=sampleWind(player,getTile);
    const windSpeed=rawWind*(fluid?0.18:1);
    const windMag=clamp(Math.abs(windSpeed)/5.2,0,1);
    const windDir=sign(windSpeed);
    const motionTrailDir=Math.abs(player.vx||0)>0.18 ? -sign(player.vx) : -sign(player.facing||1);
    const targetFlare=(0.18+0.56*speed+0.22*windMag+(airborne?0.08:0))*st.flare;
    const segLen=0.16;
    const damp=Math.pow(fluid?0.08:0.26,dt);
    cape[0].x=anchorX;
    cape[0].y=anchorY;
    cape[0].vx=player.vx||0;
    cape[0].vy=player.vy||0;
    for(let i=1;i<segs;i++){
      const prev=cape[i-1];
      const seg=cape[i];
      if(!Number.isFinite(seg.vx)) seg.vx=0;
      if(!Number.isFinite(seg.vy)) seg.vy=0;
      const t=i/(segs-1);
      const flareFactor=t*targetFlare;
      const naturalWave=(Math.sin(time/400 + i*0.7)*0.02 + Math.sin(time/1300 + i)*0.01) * windMul * (1+windMag*1.75) * (fluid?0.25:1);
      const gustWave=windDir*Math.sin(time/170 + i*1.35)*0.035*windMag*windMul;
      const windPush=windSpeed*0.105*windMul*(0.35+t*0.9);
      const movementDrag=motionTrailDir*flareFactor;
      let idleSway=(1-speed)*Math.sin(time/700 + i)*0.015;
      idleSway/=mass;
      const verticalTrail=-verticalSpeed*0.075*t*(airborne?1.25:0.55);
      const baseDrop=0.05 + t*0.15 + t*0.06*(mass-1) + (fluid?0.04*t:0);
      const lift=windMag*0.035*t*windMul*(fluid?0.2:1);
      const desiredX=prev.x + movementDrag + naturalWave + gustWave + windPush;
      const desiredY=prev.y + baseDrop + idleSway + verticalTrail - lift + Math.sin(time/230+i*0.9)*0.012*windMag*windMul*(fluid?0.25:1);
      const k=clamp(dt*stiffness*(fluid?0.55:1),0,1);
      const nx=seg.x + (desiredX - seg.x)*k;
      const ny=seg.y + (desiredY - seg.y)*k;
      seg.vx=(seg.vx*damp) + (nx-seg.x)/dt*0.12;
      seg.vy=(seg.vy*damp) + (ny-seg.y)/dt*0.12;
      seg.x=nx + seg.vx*dt*0.18;
      seg.y=ny + seg.vy*dt*0.18;
    }
    constrainLength(segLen,3);
    collideSegments(getTile,isSolid);
    constrainLength(segLen,1);
    const facing=sign(player.facing||1);
    const forwardWind=(windDir===facing) ? windMag : 0;
    const forwardSlack=0.015 + forwardWind*0.18 + speed*0.025;
    for(let i=1;i<segs;i++){
      const a=cape[i-1], b=cape[i];
      if(facing>0 && b.x>a.x+forwardSlack) b.x=a.x+forwardSlack;
      if(facing<0 && b.x<a.x-forwardSlack) b.x=a.x-forwardSlack;
    }
    if(speed<0.1 && !fluid){
      for(let i=1;i<segs;i++) cape[i].y += dt*0.32*mass*(i/(segs-1));
    }
  }
  function draw(ctx,TILE){ if(!cape.length) return; const segs=CAPE.SEGMENTS; const style=currentStyle(); if(leftPts.length!==segs) { leftPts = new Array(segs); rightPts = new Array(segs); }
    // compute width profile possibly style-specific waveform
    for(let i=0;i<segs;i++){ const cur=cape[i]; const next=cape[Math.min(segs-1,i+1)]; let dx=next.x-cur.x, dy=next.y-cur.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d; const t=i/(segs-1); let w=style.wTop+(style.wBot-style.wTop)*t; if(style.edge==='wave'){ w *= (1 + 0.15*Math.sin(t*6+performance.now()*0.002)); } const px=-dy*w, py=dx*w; leftPts[i] = leftPts[i]||{}; rightPts[i] = rightPts[i]||{}; leftPts[i].x=cur.x+px; leftPts[i].y=cur.y+py; rightPts[i].x=cur.x-px; rightPts[i].y=cur.y-py; }
    const cust=getCurrentCustomization(); let baseColor=cust.capeColor||'#b91818';
    // Build path
    ctx.beginPath();
    ctx.moveTo(leftPts[0].x*TILE,leftPts[0].y*TILE);
    for(let i=1;i<segs;i++) ctx.lineTo(leftPts[i].x*TILE,leftPts[i].y*TILE);
    if(style.edge==='point'){
      // Custom clean centered tip: connect last left/right via a single extended middle point
      const lp=leftPts[segs-1], rp=rightPts[segs-1];
      const tipX=(lp.x+rp.x)/2; // centered between ends
      const tipY=(lp.y+rp.y)/2 + 8/ TILE; // extend downward 8px
      ctx.lineTo(tipX*TILE, tipY*TILE);
      ctx.lineTo(rp.x*TILE, rp.y*TILE);
      for(let i=segs-2;i>=0;i--) ctx.lineTo(rightPts[i].x*TILE,rightPts[i].y*TILE);
    } else if(style.edge==='scallop' || style.edge==='ragged'){
      // Decorative edges built while traversing right side reversed
      for(let i=segs-1;i>=0;i--){ const p=rightPts[i]; if(i===segs-1) ctx.lineTo(p.x*TILE,p.y*TILE); else {
          if(style.edge==='scallop'){
            const prev=rightPts[Math.min(segs-1,i+1)]; const cx=(p.x+prev.x)/2*TILE; const depth=(style.scallopDepth||4); const cy=(p.y+prev.y)/2*TILE + depth; ctx.quadraticCurveTo(cx, cy, p.x*TILE, p.y*TILE);
          } else { // ragged
            const jitter=( (i*928371)%7 -3 ) * 0.8; ctx.lineTo(p.x*TILE + jitter, p.y*TILE + (i%2?4:-2));
          }
        } }
    } else {
      // straight / wave
      for(let i=segs-1;i>=0;i--) ctx.lineTo(rightPts[i].x*TILE,rightPts[i].y*TILE);
    }
    ctx.closePath();
    // Fill (gradient + shine if shiny)
    if(style.shiny){
      const g=ctx.createLinearGradient(0,leftPts[0].y*TILE,0,leftPts[segs-1].y*TILE);
      g.addColorStop(0, baseColor);
      g.addColorStop(0.55, shade(baseColor,40));
      g.addColorStop(1, shade(baseColor,-20));
      ctx.fillStyle=g;
    } else ctx.fillStyle=baseColor;
    ctx.fill();
    // Gloss overlay for shiny styles
    if(style.shiny){
      ctx.save(); ctx.clip();
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=2; ctx.beginPath();
      const mid=Math.floor(segs/2); const p0=leftPts[Math.floor(mid*0.3)], p1=leftPts[Math.floor(mid*0.9)]; if(p0&&p1){ ctx.moveTo(p0.x*TILE,p0.y*TILE+2); ctx.lineTo(p1.x*TILE,p1.y*TILE+2); }
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.beginPath(); for(let i=0;i<segs;i++) ctx.lineTo(leftPts[i].x*TILE,leftPts[i].y*TILE); ctx.stroke();
  }
  function shade(col,delta){ // col #rrggbb
    const r=parseInt(col.slice(1,3),16), g=parseInt(col.slice(3,5),16), b=parseInt(col.slice(5,7),16); function cl(v){ return Math.min(255,Math.max(0,v)); }
    return '#'+cl(r+delta).toString(16).padStart(2,'0')+cl(g+delta).toString(16).padStart(2,'0')+cl(b+delta).toString(16).padStart(2,'0');
  }
  capeAPI.init = init;
  capeAPI.update = update;
  capeAPI.draw = draw;
  capeAPI._segments = cape;
  capeAPI.styles = Object.keys(CAPE_STYLES);
  capeAPI.getStyle = function(id){ return Object.assign({}, CAPE_STYLES[id]||CAPE_STYLES.classic); };
  capeAPI._debug = { sampleWind };
  MM.cape = capeAPI;
})();
// ESM export (progressive migration)
export const cape = (typeof window!=='undefined' && window.MM) ? window.MM.cape : undefined;
export default cape;
