// Cape physics extracted
window.MM = window.MM || {};
(function(){
  const capeAPI = {};
  const cape = [];
  let leftPts = [];
  let rightPts = [];
  // Style definitions (id -> parameters)
  const CAPE_STYLES = {
    classic: { wTop:0.10,wBot:0.24, edge:'straight', flare:1, shiny:false },
    triangle:{ wTop:0.12,wBot:0.15, edge:'point', flare:0.9, shiny:false },
    royal:   { wTop:0.14,wBot:0.34, edge:'scallop', flare:1.15, shiny:true },
    tattered:{ wTop:0.10,wBot:0.26, edge:'ragged', flare:1, shiny:false },
    winged:  { wTop:0.08,wBot:0.30, edge:'wave', flare:1.25, shiny:true }
  };
  function getCurrentCustomization(){ return (window.MM && MM.customization) || {capeStyle:'classic',capeColor:'#b91818'}; }
  function currentStyle(){ const c=getCurrentCustomization(); return CAPE_STYLES[c.capeStyle]||CAPE_STYLES.classic; }
  function init(player){ const segs=MM.CAPE.SEGMENTS; cape.length=0; for(let i=0;i<segs;i++) cape.push({x:player.x,y:player.y}); }
  function update(player,dt,getTile,isSolid){ if(!cape.length) return; const segs=MM.CAPE.SEGMENTS; const st=currentStyle(); const anchorX=player.x; const anchorY=player.y - player.h/2 + player.h*MM.CAPE.ANCHOR_FRAC; const speed=Math.min(1,Math.abs(player.vx)/MM.MOVE.MAX); const time=performance.now(); const targetFlare=(0.18+0.55*speed)*st.flare; const segLen=0.16; cape[0].x=anchorX; cape[0].y=anchorY; for(let i=1;i<segs;i++){ const prev=cape[i-1]; const seg=cape[i]; const backDirX=-player.facing; const flareFactor = (i/(segs-1))*targetFlare; const wind=Math.sin(time/400 + i*0.7)*0.02 + Math.sin(time/1300 + i)*0.01; const idleSway=(1-speed)*Math.sin(time/700 + i)*0.015; const desiredX=prev.x + backDirX*flareFactor + wind; const desiredY=prev.y + 0.05 + (i/(segs-1))*0.15 + idleSway; seg.x += (desiredX - seg.x)*Math.min(1,dt*6); seg.y += (desiredY - seg.y)*Math.min(1,dt*6); }
    for(let it=0; it<2; it++){ for(let i=1;i<segs;i++){ const a=cape[i-1], b=cape[i]; let dx=b.x-a.x, dy=b.y-a.y; let d=Math.hypot(dx,dy)||0.0001; const excess=d-segLen; if(Math.abs(excess)>0.0005){ const k=excess/d; b.x -= dx*k; b.y -= dy*k; } } }
    for(let i=1;i<segs;i++){ const seg=cape[i]; const tx=Math.floor(seg.x); const ty=Math.floor(seg.y); if(isSolid(getTile(tx,ty))){ seg.y=ty-0.02; const bc=tx+0.5; if(seg.x>bc) seg.x=Math.min(seg.x, tx+1.02); else seg.x=Math.max(seg.x, tx-0.02); } }
    for(let i=1;i<segs;i++){ const a=cape[i-1], b=cape[i]; let dx=b.x-a.x, dy=b.y-a.y; let d=Math.hypot(dx,dy)||0.0001; const excess=d-segLen; if(excess>0){ const k=excess/d; b.x -= dx*k; b.y -= dy*k; } }
    for(let i=1;i<segs;i++){ const a=cape[i-1], b=cape[i]; if(player.facing>0 && b.x>a.x) b.x=a.x; if(player.facing<0 && b.x<a.x) b.x=a.x; }
    if(speed<0.1){ for(let i=1;i<segs;i++) cape[i].y += dt*0.4*(i/(segs-1)); }
  }
  function draw(ctx,TILE){ if(!cape.length) return; const segs=MM.CAPE.SEGMENTS; const style=currentStyle(); if(leftPts.length!==segs) { leftPts = new Array(segs); rightPts = new Array(segs); }
    // compute width profile possibly style-specific waveform
    for(let i=0;i<segs;i++){ const cur=cape[i]; const next=cape[Math.min(segs-1,i+1)]; let dx=next.x-cur.x, dy=next.y-cur.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d; const t=i/(segs-1); let w=style.wTop+(style.wBot-style.wTop)*t; if(style.edge==='wave'){ w *= (1 + 0.15*Math.sin(t*6+performance.now()*0.002)); } const px=-dy*w, py=dx*w; leftPts[i] = leftPts[i]||{}; rightPts[i] = rightPts[i]||{}; leftPts[i].x=cur.x+px; leftPts[i].y=cur.y+py; rightPts[i].x=cur.x-px; rightPts[i].y=cur.y-py; }
    const cust=getCurrentCustomization(); let baseColor=cust.capeColor||'#b91818';
    // Build path
    ctx.beginPath(); ctx.moveTo(leftPts[0].x*TILE,leftPts[0].y*TILE); for(let i=1;i<segs;i++) ctx.lineTo(leftPts[i].x*TILE,leftPts[i].y*TILE);
    // bottom decoration
    if(style.edge==='scallop' || style.edge==='ragged' || style.edge==='point'){
      // close left -> right bottom with decoration using rightPts reversed
      for(let i=segs-1;i>=0;i--){ const p=rightPts[i]; if(i===segs-1) ctx.lineTo(p.x*TILE,p.y*TILE); else {
          if(style.edge==='scallop'){
            const prev=rightPts[Math.min(segs-1,i+1)]; const cx=(p.x+prev.x)/2*TILE; const cy=(p.y+prev.y)/2*TILE + 4; ctx.quadraticCurveTo(cx, cy, p.x*TILE, p.y*TILE);
          } else if(style.edge==='ragged'){
            const jitter=( (i*928371)%7 -3 ) * 0.8; ctx.lineTo(p.x*TILE + jitter, p.y*TILE + (i%2?4:-2));
          } else if(style.edge==='point'){
            if(i===Math.floor(segs/2)) ctx.lineTo(p.x*TILE, p.y*TILE+8);
            ctx.lineTo(p.x*TILE,p.y*TILE);
          }
        } }
    } else {
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
  MM.cape = capeAPI;
})();
