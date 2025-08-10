// Cape physics extracted
window.MM = window.MM || {};
(function(){
  const capeAPI = {};
  const cape = [];
  let leftPts = [];
  let rightPts = [];
  let shapePath = null; // optional cached Path2D for outline (rebuilt each frame since points move)
  function init(player){ const segs=MM.CAPE.SEGMENTS; cape.length=0; for(let i=0;i<segs;i++) cape.push({x:player.x,y:player.y}); }
  function update(player,dt,getTile,isSolid){ if(!cape.length) return; const segs=MM.CAPE.SEGMENTS; const anchorX=player.x; const anchorY=player.y - player.h/2 + player.h*MM.CAPE.ANCHOR_FRAC; const speed=Math.min(1,Math.abs(player.vx)/MM.MOVE.MAX); const time=performance.now(); const targetFlare=0.2+0.55*speed; const segLen=0.16; cape[0].x=anchorX; cape[0].y=anchorY; for(let i=1;i<segs;i++){ const prev=cape[i-1]; const seg=cape[i]; const backDirX=-player.facing; const flareFactor = (i/(segs-1))*targetFlare; const wind=Math.sin(time/400 + i*0.7)*0.02 + Math.sin(time/1300 + i)*0.01; const idleSway=(1-speed)*Math.sin(time/700 + i)*0.015; const desiredX=prev.x + backDirX*flareFactor + wind; const desiredY=prev.y + 0.05 + (i/(segs-1))*0.15 + idleSway; seg.x += (desiredX - seg.x)*Math.min(1,dt*6); seg.y += (desiredY - seg.y)*Math.min(1,dt*6); }
    for(let it=0; it<2; it++){ for(let i=1;i<segs;i++){ const a=cape[i-1], b=cape[i]; let dx=b.x-a.x, dy=b.y-a.y; let d=Math.hypot(dx,dy)||0.0001; const excess=d-segLen; if(Math.abs(excess)>0.0005){ const k=excess/d; b.x -= dx*k; b.y -= dy*k; } } }
    for(let i=1;i<segs;i++){ const seg=cape[i]; const tx=Math.floor(seg.x); const ty=Math.floor(seg.y); if(isSolid(getTile(tx,ty))){ seg.y=ty-0.02; const bc=tx+0.5; if(seg.x>bc) seg.x=Math.min(seg.x, tx+1.02); else seg.x=Math.max(seg.x, tx-0.02); } }
    for(let i=1;i<segs;i++){ const a=cape[i-1], b=cape[i]; let dx=b.x-a.x, dy=b.y-a.y; let d=Math.hypot(dx,dy)||0.0001; const excess=d-segLen; if(excess>0){ const k=excess/d; b.x -= dx*k; b.y -= dy*k; } }
    for(let i=1;i<segs;i++){ const a=cape[i-1], b=cape[i]; if(player.facing>0 && b.x>a.x) b.x=a.x; if(player.facing<0 && b.x<a.x) b.x=a.x; }
    if(speed<0.1){ for(let i=1;i<segs;i++) cape[i].y += dt*0.4*(i/(segs-1)); }
  }
  // Draw uses reused point arrays to reduce per-frame allocations
  function draw(ctx,TILE){ if(!cape.length) return; const segs=MM.CAPE.SEGMENTS; const wTop=0.10,wBot=0.24; if(leftPts.length!==segs) { leftPts = new Array(segs); rightPts = new Array(segs); }
    for(let i=0;i<segs;i++){ const cur=cape[i]; const next=cape[Math.min(segs-1,i+1)]; let dx=next.x-cur.x, dy=next.y-cur.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d; const t=i/(segs-1); const w=wTop+(wBot-wTop)*t; const px=-dy*w, py=dx*w; leftPts[i] = leftPts[i]||{}; rightPts[i] = rightPts[i]||{}; leftPts[i].x=cur.x+px; leftPts[i].y=cur.y+py; rightPts[i].x=cur.x-px; rightPts[i].y=cur.y-py; }
    ctx.fillStyle='#b91818';
    ctx.beginPath();
    ctx.moveTo(leftPts[0].x*TILE,leftPts[0].y*TILE);
    for(let i=1;i<segs;i++) ctx.lineTo(leftPts[i].x*TILE,leftPts[i].y*TILE);
    for(let i=segs-1;i>=0;i--) ctx.lineTo(rightPts[i].x*TILE,rightPts[i].y*TILE);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.beginPath();
    for(let i=0;i<segs;i++) ctx.lineTo(leftPts[i].x*TILE,leftPts[i].y*TILE);
    ctx.stroke(); }
  capeAPI.init = init;
  capeAPI.update = update;
  capeAPI.draw = draw;
  capeAPI._segments = cape;
  MM.cape = capeAPI;
})();
