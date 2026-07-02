// Physics talisman necklace: side anchors, front chain and a swinging pendant.
// It appears only while the optional inventory charm slot is equipped.
const root = typeof window !== 'undefined' ? window : globalThis;
root.MM = root.MM || {};

(function(){
  const necklaceAPI = {};
  const points = [];
  const rest = [];
  const BEADS = 13;
  const PENDANT_REST = 0.135;
  let charmId = null;
  let pendant = null;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function finite(n,fallback){ return (typeof n === 'number' && isFinite(n)) ? n : fallback; }
  function inventory(){ return root.MM && root.MM.inventory; }
  function currentCharm(){
    const inv = inventory();
    if(inv && typeof inv.equippedItem === 'function'){
      const item = inv.equippedItem('charm');
      if(item) return item;
    }
    if(inv && typeof inv.equippedId === 'function'){
      const id = inv.equippedId('charm');
      if(id){
        const item = inv.getItem ? inv.getItem(id) : null;
        return item || {id, kind:'charm', name:id};
      }
    }
    return null;
  }
  function bodyMetrics(player){
    const w=clamp(finite(player && player.w,0.7),0.35,1.4);
    const h=clamp(finite(player && player.h,0.95),0.45,1.8);
    const top=finite(player && player.y,0)-h*0.5;
    return {
      w,h,top,
      eyeY:top+h*0.35,
      guardY:top+h*0.445,
      chestY:top+h*0.58,
      lowY:top+h*0.74
    };
  }
  function anchors(player){
    const m=bodyMetrics(player);
    const side=m.w*0.41;
    const y=m.guardY+m.h*0.025;
    return {
      lx:player.x-side,
      ly:y,
      rx:player.x+side,
      ry:y,
      midX:player.x,
      guardY:m.guardY,
      eyeY:m.eyeY,
      chestY:m.chestY,
      lowY:m.lowY,
      w:m.w,
      h:m.h
    };
  }
  function restPoint(i,a){
    const t=i/(BEADS-1);
    const arc=Math.sin(t*Math.PI);
    const sideDip=Math.sin(t*Math.PI*2)*0.018;
    return {
      x:a.lx+(a.rx-a.lx)*t,
      y:a.ly + arc*(a.h*0.185) + sideDip
    };
  }
  function charmKey(item){
    return item ? (item.id || item.name || 'charm') : null;
  }
  function rebuildRest(){
    rest.length=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1], b=points[i];
      rest.push(Math.max(0.035,Math.hypot(b.x-a.x,b.y-a.y)));
    }
  }
  function clear(){
    points.length=0;
    rest.length=0;
    charmId=null;
    pendant=null;
  }
  function init(player){
    const item=currentCharm();
    clear();
    if(!item || !player) return false;
    const a=anchors(player);
    for(let i=0;i<BEADS;i++){
      const p=restPoint(i,a);
      points.push({x:p.x,y:p.y,px:p.x,py:p.y});
    }
    const center=points[Math.floor(BEADS/2)];
    pendant={x:center.x,y:center.y+PENDANT_REST,px:center.x,py:center.y+PENDANT_REST,spin:0,vspin:0};
    charmId=charmKey(item);
    rebuildRest();
    return true;
  }
  function pin(a){
    if(points.length!==BEADS) return;
    const left=points[0], right=points[BEADS-1];
    left.x=a.lx; left.y=a.ly; left.px=a.lx; left.py=a.ly;
    right.x=a.rx; right.y=a.ry; right.px=a.rx; right.py=a.ry;
  }
  function sampleWind(player,getTile){
    try{
      const W=root.MM && root.MM.wind;
      if(!W || !player) return 0;
      const y=player.y-finite(player.h,0.95)*0.15;
      if(typeof W.speedAt === 'function') return W.speedAt(player.x,y,getTile);
      if(typeof W.speed === 'function') return W.speed();
    }catch(e){}
    return 0;
  }
  function clampAwayFromEyes(a){
    for(let i=1;i<points.length-1;i++){
      if(points[i].y<a.guardY) points[i].y=a.guardY;
    }
    if(pendant && pendant.y<a.chestY) pendant.y=a.chestY;
  }
  function solveChain(a,passes){
    for(let pass=0;pass<passes;pass++){
      pin(a);
      for(let i=0;i<BEADS-1;i++){
        const pa=points[i], pb=points[i+1];
        let dx=pb.x-pa.x, dy=pb.y-pa.y;
        const d=Math.hypot(dx,dy)||0.0001;
        const diff=(d-rest[i])/d;
        const ax=i===0, bx=i+1===BEADS-1;
        if(ax){
          pb.x-=dx*diff;
          pb.y-=dy*diff;
        }else if(bx){
          pa.x+=dx*diff;
          pa.y+=dy*diff;
        }else{
          pa.x+=dx*diff*0.5;
          pa.y+=dy*diff*0.5;
          pb.x-=dx*diff*0.5;
          pb.y-=dy*diff*0.5;
        }
      }
      for(let i=1;i<BEADS-1;i++){
        const ideal=restPoint(i,a);
        const p=points[i];
        const t=i/(BEADS-1);
        const relax=0.010+Math.sin(t*Math.PI)*0.012;
        p.x+=(ideal.x-p.x)*relax;
        p.y+=(ideal.y-p.y)*relax;
      }
      clampAwayFromEyes(a);
    }
    pin(a);
  }
  function solvePendant(a,dt){
    if(!pendant || points.length!==BEADS) return;
    const center=points[Math.floor(BEADS/2)];
    for(let pass=0;pass<5;pass++){
      let dx=pendant.x-center.x, dy=pendant.y-center.y;
      const d=Math.hypot(dx,dy)||0.0001;
      const diff=(d-PENDANT_REST)/d;
      pendant.x-=dx*diff;
      pendant.y-=dy*diff;
      if(pendant.y<a.chestY) pendant.y=a.chestY;
    }
    const spinTarget=clamp((pendant.x-center.x)*8,-0.85,0.85);
    pendant.vspin=(pendant.vspin||0)*Math.pow(0.58,dt*60)+(spinTarget-(pendant.spin||0))*dt*9;
    pendant.spin=clamp((pendant.spin||0)+pendant.vspin,-0.9,0.9);
  }
  function update(player,dt,getTile){
    const item=currentCharm();
    if(!item || !player){ clear(); return false; }
    const id=charmKey(item);
    if(points.length!==BEADS || !pendant || charmId!==id) init(player);
    if(points.length!==BEADS || !pendant || !(dt>0) || !isFinite(dt)) return false;
    dt=clamp(dt,0.001,0.05);
    const a=anchors(player);
    const vx=finite(player.vx,0), vy=finite(player.vy,0);
    const airborne=player.onGround===false;
    const wind=sampleWind(player,getTile);
    const windMag=clamp(Math.abs(wind)/7.2,0,1);
    const damp=Math.pow(0.54+windMag*0.08,dt*60);
    pin(a);
    for(let i=1;i<BEADS-1;i++){
      const p=points[i];
      const t=i/(BEADS-1);
      const arc=Math.sin(t*Math.PI);
      const oldX=p.x, oldY=p.y;
      const trailX=-vx*0.024*dt*arc + wind*0.020*dt*(0.25+arc*0.95);
      const trailY=-vy*0.012*dt*arc*(airborne?1.85:0.82);
      const bounce=Math.sin((finite(root.performance && root.performance.now && root.performance.now(),0))*0.012+i*0.9)*0.0009*windMag;
      p.x += (p.x-p.px)*damp + trailX + bounce;
      p.y += (p.y-p.py)*damp + 13.0*dt*dt + trailY;
      p.px=oldX; p.py=oldY;
    }
    const oldPX=pendant.x, oldPY=pendant.y;
    pendant.x += (pendant.x-pendant.px)*Math.pow(0.48,dt*60) - vx*0.040*dt + wind*0.034*dt;
    pendant.y += (pendant.y-pendant.py)*Math.pow(0.50,dt*60) + 18.0*dt*dt - vy*0.020*dt*(airborne?1.55:0.75);
    pendant.px=oldPX; pendant.py=oldPY;
    solveChain(a,8);
    solvePendant(a,dt);
    return true;
  }
  function shade(hex,delta){
    const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));
    if(!m) return hex || '#ffd86a';
    const n=parseInt(m[1],16);
    const clampByte=v=>v<0?0:(v>255?255:v);
    const r=clampByte(((n>>16)&255)+delta);
    const g=clampByte(((n>>8)&255)+delta);
    const b=clampByte((n&255)+delta);
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  }
  function palette(item){
    let gem='#8ee9ff';
    if(item && item.attackDamage) gem='#ffb24d';
    else if(item && item.energyCapacityBonus) gem='#ffd45f';
    else if(item && item.mineSpeedMult) gem='#72e88f';
    else if(item && item.visionRadius) gem='#75dcff';
    const tier=String((item && item.tier) || '').toLowerCase();
    if(tier==='epic') gem='#ffc857';
    if(tier==='legendary' || tier==='mythic') gem='#ff75ec';
    return {
      chain:tier==='epic' ? '#ffe08a' : '#d6c28a',
      chainDark:'#5a4220',
      rim:'#fff0ad',
      gem,
      gemDark:shade(gem,-56),
      gemLight:shade(gem,54)
    };
  }
  function drawChainPath(ctx,TILE,from,to,pal,alpha){
    if(points.length!==BEADS) return;
    ctx.beginPath();
    ctx.moveTo(points[from].x*TILE,points[from].y*TILE);
    for(let i=from+1;i<=to;i++) ctx.lineTo(points[i].x*TILE,points[i].y*TILE);
    ctx.strokeStyle='rgba(32,22,8,'+(0.58*alpha).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.076);
    ctx.stroke();
    ctx.strokeStyle=pal.chain;
    ctx.lineWidth=Math.max(1,TILE*0.037);
    ctx.stroke();
  }
  function drawBeads(ctx,TILE,from,to,pal){
    for(let i=from;i<=to;i++){
      const p=points[i];
      const r=Math.max(1,TILE*(i%2?0.031:0.024));
      ctx.fillStyle=i%2?pal.chain:pal.chainDark;
      ctx.beginPath();
      ctx.arc(p.x*TILE,p.y*TILE,r,0,Math.PI*2);
      ctx.fill();
      if(i%3===0){
        ctx.fillStyle='rgba(255,255,255,0.35)';
        ctx.fillRect(Math.round(p.x*TILE-r*0.35),Math.round(p.y*TILE-r*0.55),1,1);
      }
    }
  }
  function drawGem(ctx,x,y,r,pal,glow,spin){
    if(glow>0.05){
      const rg=ctx.createRadialGradient(x,y,1,x,y,r*3.4);
      rg.addColorStop(0,'rgba(255,246,170,'+(0.25*glow).toFixed(3)+')');
      rg.addColorStop(1,'rgba(255,246,170,0)');
      ctx.fillStyle=rg;
      ctx.beginPath();
      ctx.arc(x,y,r*3.4,0,Math.PI*2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(spin||0);
    ctx.fillStyle=pal.gemDark;
    ctx.beginPath();
    ctx.moveTo(0,-r*1.20);
    ctx.lineTo(r*0.95,-r*0.10);
    ctx.lineTo(0,r*1.32);
    ctx.lineTo(-r*0.95,-r*0.10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle=pal.gem;
    ctx.beginPath();
    ctx.moveTo(0,-r*0.94);
    ctx.lineTo(r*0.70,-r*0.08);
    ctx.lineTo(0,r*0.94);
    ctx.lineTo(-r*0.70,-r*0.08);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle=pal.gemLight;
    ctx.fillRect(Math.round(-r*0.20),Math.round(-r*0.64),Math.max(1,Math.round(r*0.38)),Math.max(1,Math.round(r*0.30)));
    ctx.strokeStyle='rgba(48,32,12,0.68)';
    ctx.lineWidth=Math.max(1,r*0.18);
    ctx.stroke();
    ctx.restore();
  }
  function ensureReady(player){
    const item=currentCharm();
    if(!item) return null;
    if(points.length!==BEADS && player) init(player);
    if(points.length!==BEADS || !pendant) return null;
    return item;
  }
  function drawBack(ctx,tile,player){
    const item=ensureReady(player);
    if(!item || !ctx) return false;
    const TILE=finite(tile,20);
    const a=anchors(player||{x:0,y:0,w:0.7,h:0.95});
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now()*0.001 : 0;
    const sway=Math.sin(now*4.5+(pendant?pendant.spin:0))*TILE*0.015;
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.strokeStyle='rgba(38,24,8,0.45)';
    ctx.lineWidth=Math.max(1,TILE*0.055);
    ctx.beginPath();
    ctx.moveTo(a.lx*TILE,a.ly*TILE);
    ctx.quadraticCurveTo(a.midX*TILE,(a.eyeY+0.02)*TILE+sway,a.rx*TILE,a.ry*TILE);
    ctx.stroke();
    ctx.strokeStyle='rgba(255,224,138,0.42)';
    ctx.lineWidth=Math.max(1,TILE*0.026);
    ctx.stroke();
    ctx.restore();
    return true;
  }
  function drawFront(ctx,tile,player){
    const item=ensureReady(player);
    if(!item || !ctx) return false;
    const TILE=finite(tile,20);
    const pal=palette(item);
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now()*0.001 : 0;
    const glow=0.55+0.45*Math.sin(now*4.3+(pendant?pendant.spin*2:0));
    const centerIndex=Math.floor(BEADS/2);
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    drawChainPath(ctx,TILE,0,BEADS-1,pal,1);
    drawBeads(ctx,TILE,1,BEADS-2,pal);
    if(pendant){
      const cx=points[centerIndex].x*TILE, cy=points[centerIndex].y*TILE;
      const px=pendant.x*TILE, py=pendant.y*TILE;
      ctx.strokeStyle='rgba(35,23,8,0.58)';
      ctx.lineWidth=Math.max(1,TILE*0.050);
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.lineTo(px,py);
      ctx.stroke();
      ctx.strokeStyle=pal.rim;
      ctx.lineWidth=Math.max(1,TILE*0.022);
      ctx.stroke();
      drawGem(ctx,px,py+TILE*0.018,Math.max(2,TILE*0.112),pal,glow,pendant.spin||0);
    }
    ctx.restore();
    return true;
  }
  function draw(ctx,tile,player){
    const back=drawBack(ctx,tile,player);
    const front=drawFront(ctx,tile,player);
    return !!(back || front);
  }
  function active(){ return !!currentCharm(); }

  necklaceAPI.init=init;
  necklaceAPI.update=update;
  necklaceAPI.drawBack=drawBack;
  necklaceAPI.drawFront=drawFront;
  necklaceAPI.draw=draw;
  necklaceAPI.active=active;
  necklaceAPI._points=points;
  necklaceAPI._pendant=()=>pendant;
  necklaceAPI._debug={currentCharm,palette,anchors,bodyMetrics,sampleWind};
  root.MM.necklace=necklaceAPI;
})();

export const necklace = (typeof window !== 'undefined' && window.MM) ? window.MM.necklace : globalThis.MM && globalThis.MM.necklace;
export default necklace;
