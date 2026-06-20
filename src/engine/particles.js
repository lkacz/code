// Chest burst particles + simple sfx
// API: MM.particles.spawnBurst(x,y,tier,{sound}), spawnSmoke(x,y,intensity,opts),
// update(dt, TILE), draw(ctx, canDrawTile, TILE)
(function(){
  window.MM = window.MM || {};
  const mod = {};

  const PARTICLE_CAP = 860;
  const SMOKE_CAP = 320;
  const particles = [];
  const smokeSprites = new Map();
  let smokeCount = 0;
  let audioCtx = null;
  function frameMs(){
    return (typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
  }
  function currentSmokeCap(){
    const ms=frameMs();
    return ms>42 ? 140 : (ms>26 ? 220 : SMOKE_CAP);
  }
  function smokeDrawAlphaScale(ms,count){
    if(ms>42) return 0.58;
    if(ms>26) return 0.74;
    if(count>260) return 0.88;
    return 1;
  }
  function trimSmokeToCap(cap){
    if(smokeCount<=cap) return;
    for(let i=0;i<particles.length && smokeCount>cap; ){
      if(particles[i] && particles[i].kind==='smoke'){
        particles.splice(i,1);
        smokeCount=Math.max(0,smokeCount-1);
      } else i++;
    }
  }
  function fallbackGetTile(){
    try{
      const w=MM && MM.world;
      return w && typeof w.getTile === 'function' ? w.getTile.bind(w) : null;
    }catch(e){ return null; }
  }
  function windAtParticle(p,tileSize,getTile){
    try{
      const w=MM && MM.wind;
      if(!w) return 0;
      const x=(p.x||0)/tileSize, y=(p.y||0)/tileSize;
      const tileFn=typeof getTile === 'function' ? getTile : fallbackGetTile();
      const v=typeof w.speedAt === 'function'
        ? w.speedAt(x,y,tileFn)
        : (typeof w.speed === 'function' ? w.speed() : 0);
      return Number.isFinite(v) ? Math.max(-6,Math.min(6,v)) : 0;
    }catch(e){ return 0; }
  }
  function windResponse(kind){
    if(kind==='splash') return 0.26;
    if(kind==='spark') return 0.24;
    if(kind==='glass') return 0.18;
    if(kind==='smoke') return 0.16;
    if(kind==='bubble' || kind==='energy') return 0;
    return 0.22;
  }

  function smokeSprite(shade,variant){
    if(typeof document==='undefined' || !document.createElement) return null;
    const q=Math.max(10, Math.min(46, Math.round(shade/4)*4));
    const v=(variant|0)%4;
    const k=q+':'+v;
    let sprite=smokeSprites.get(k);
    if(sprite) return sprite;
    const size=72;
    const c=document.createElement('canvas');
    c.width=size; c.height=size;
    const g=c.getContext && c.getContext('2d');
    if(!g || !g.createRadialGradient || !g.drawImage){ return null; }
    const cx=size/2, cy=size/2;
    const blobs=[
      [0,0,0.95,0.90],
      [-0.18,-0.10,0.58,0.45],
      [0.20,-0.08,0.50,0.38],
      [-0.08,0.18,0.44,0.30],
      [0.14,0.17,0.38,0.24]
    ];
    for(let i=0;i<blobs.length;i++){
      const b=blobs[i];
      const ox=(b[0]+(((v*37+i*13)%17)-8)/120)*size;
      const oy=(b[1]+(((v*19+i*23)%13)-6)/130)*size;
      const r=size*0.5*b[2];
      const grad=g.createRadialGradient(cx+ox,cy+oy,r*0.08,cx+ox,cy+oy,r);
      const core=Math.max(0.05, b[3]);
      grad.addColorStop(0,'rgba('+q+','+q+','+q+','+core+')');
      grad.addColorStop(0.42,'rgba('+q+','+q+','+q+','+(core*0.46)+')');
      grad.addColorStop(1,'rgba('+q+','+q+','+q+',0)');
      g.fillStyle=grad;
      g.beginPath();
      g.arc(cx+ox,cy+oy,r,0,Math.PI*2);
      g.fill();
    }
    if(smokeSprites.size>40) smokeSprites.clear();
    smokeSprites.set(k,c);
    return c;
  }

  function playChestSound(tier){
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      let base = tier==='epic'?660 : tier==='rare'?520 : 420;
      o.frequency.setValueAtTime(base,audioCtx.currentTime);
      o.frequency.linearRampToValueAtTime(base + (tier==='epic'?240 : tier==='rare'?160 : 80), audioCtx.currentTime+0.25);
      g.gain.setValueAtTime(0.001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime+0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.5);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime+0.52);
    }catch(e){ /* ignore */ }
  }

  mod.spawnBurst = function(x,y,tier,opts){
    opts=opts||{};
    const count = 24 + (tier==='epic'?24 : tier==='rare'?12 : 0);
    for(let i=0;i<count;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const ang = Math.random()*Math.PI*2;
      const sp = (Math.random()*2 + 1.5) * (tier==='epic'?1.6 : tier==='rare'?1.3 : 1);
      particles.push({ x, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp*0.6-1, life:0, max:0.9+Math.random()*0.5, tier });
    }
    if(opts.sound) playChestSound(tier);
  };

  // Lightweight visual-only sparks for frequent combat impacts. Unlike chest
  // bursts this has no audio and a much smaller particle count.
  mod.spawnSparks = function(x,y,tier,count){
    const n=Math.max(1, Math.min(14, count==null?8:(count|0)));
    for(let i=0;i<n;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const ang=Math.random()*Math.PI*2;
      const sp=1.0+Math.random()*2.0;
      particles.push({ kind:'spark', x, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp*0.55-0.55, life:0, max:0.22+Math.random()*0.22, tier });
    }
  };

  mod.spawnTurboSparks = function(x,y,facing,intensity){
    const k=Math.max(0.25, Math.min(1.5, Number(intensity)||0.7));
    const n=Math.max(2, Math.min(9, Math.round(2+k*4)));
    const dir=(Number(facing)||1)>=0 ? 1 : -1;
    for(let i=0;i<n;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const back=-dir;
      const side=(Math.random()-0.5)*1.1;
      const sp=(0.9+Math.random()*2.2)*k;
      particles.push({
        kind:'spark',
        x:x + back*(4+Math.random()*8),
        y:y + (Math.random()-0.5)*16,
        vx:back*sp + side*0.45,
        vy:(Math.random()-0.5)*1.2 - 0.25,
        life:0,
        max:0.16+Math.random()*0.18,
        tier:'turbo',
        size:1.8+Math.random()*2.2
      });
    }
  };

  mod.spawnEnergyAbsorb = function(fromX,fromY,toX,toY,intensity){
    const k=Math.max(0.15, Math.min(1.6, Number(intensity)||0.5));
    const ms=frameMs();
    let n=Math.round(3 + 8*k);
    if(ms>34) n=Math.max(2, Math.round(n*0.45));
    else if(ms>24) n=Math.max(3, Math.round(n*0.65));
    for(let i=0;i<n;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const ox=(Math.random()-0.5)*14;
      const oy=(Math.random()-0.5)*14;
      particles.push({
        kind:'energy',
        x:fromX+ox,
        y:fromY+oy,
        px:fromX+ox,
        py:fromY+oy,
        tx:toX+(Math.random()-0.5)*10,
        ty:toY+(Math.random()-0.5)*14,
        life:0,
        max:0.26+Math.random()*0.28,
        phase:Math.random()*Math.PI*2,
        wobble:0.35+Math.random()*0.65,
        hue:Math.random()<0.65?'cyan':'gold'
      });
    }
  };

  mod.spawnGlassShards = function(x,y,count){
    const n=Math.max(3, Math.min(24, count==null?14:(count|0)));
    for(let i=0;i<n;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const ang=Math.random()*Math.PI*2;
      const sp=1.2+Math.random()*3.2;
      particles.push({
        kind:'glass',
        x:x+(Math.random()-0.5)*6,
        y:y+(Math.random()-0.5)*6,
        vx:Math.cos(ang)*sp,
        vy:Math.sin(ang)*sp*0.55-1.0,
        life:0,
        max:0.35+Math.random()*0.28,
        rot:Math.random()*Math.PI,
        spin:(Math.random()-0.5)*10,
        size:2+Math.random()*2.8
      });
    }
  };

  // Water splash: droplets fan upward from the surface, fall back under gravity.
  // x,y in world pixels; intensity 0..1 scales count and speed.
  mod.spawnSplash = function(x,y,intensity){
    const k = Math.max(0.15, Math.min(1, intensity||0.5));
    const count = Math.round(6 + 18*k);
    for(let i=0;i<count;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const ang = -Math.PI/2 + (Math.random()-0.5)*1.4; // mostly upward fan
      const sp = (1.2 + Math.random()*2.4) * (0.5 + k);
      particles.push({ kind:'splash', x:x+(Math.random()-0.5)*10, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp, life:0, max:0.35+Math.random()*0.45 });
    }
  };

  // Air bubble: rises with a sine wobble, pops at the end of its life.
  mod.spawnBubble = function(x,y){
    if(particles.length>=PARTICLE_CAP) return;
    particles.push({ kind:'bubble', x, y, vx:0, vy:-(0.6+Math.random()*0.9), life:0, max:0.8+Math.random()*1.2, phase:Math.random()*Math.PI*2, r:1.5+Math.random()*2 });
  };

  mod.spawnSmoke = function(x,y,intensity,opts){
    opts=opts||{};
    const tileSize = opts.tileSize || (MM && MM.TILE) || 20;
    const power = Math.max(0.1, Math.min(4, intensity||1));
    const cap=currentSmokeCap();
    let count = Math.max(1, Math.round(1 + power*0.9));
    if(smokeCount>cap*0.65) count=Math.max(1, Math.min(count, Math.round(count*0.55)));
    for(let i=0;i<count;i++){
      if(particles.length>=PARTICLE_CAP || smokeCount>=cap) break;
      const r = (5.5+Math.random()*8.0) * (0.85+power*0.18);
      const max = (3.2+Math.random()*3.8) * (0.95+power*0.16);
      const vx = (Math.random()-0.5)*(0.28+power*0.08);
      const vy = -(0.72+Math.random()*0.72+power*0.20);
      particles.push({
        kind:'smoke',
        x:x+(Math.random()-0.5)*tileSize*0.35,
        y:y+(Math.random()-0.5)*tileSize*0.25,
        vx, vy,
        life:0, max,
        r,
        grow:8+Math.random()*12+power*3.6,
        shade:14+Math.random()*22,
        alpha:0.30+Math.random()*0.16,
        phase:Math.random()*Math.PI*2,
        lift:0.16+Math.random()*0.12+power*0.035,
        wind:(Math.random()-0.5)*(0.06+power*0.025),
        shear:(Math.random()-0.5)*(0.035+power*0.018),
        rot:(Math.random()-0.5)*Math.PI,
        spin:(Math.random()-0.5)*(0.16+power*0.03),
        stretch:0.88+Math.random()*0.42,
        variant:(Math.random()*4)|0,
        tileX:Number.isFinite(opts.tileX)? opts.tileX : Math.floor(x/tileSize),
        tileY:Number.isFinite(opts.tileY)? opts.tileY : Math.floor(y/tileSize)
      });
      smokeCount++;
    }
  };

  mod.update = function(dt, TILE, getTile){
    const tileSize = TILE || 20;
    // Frame spikes should pause new smoke, not chop an existing plume in half.
    trimSmokeToCap(SMOKE_CAP);
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.life += dt;
      if(p.kind==='bubble'){
        p.x += Math.sin(p.life*7 + p.phase)*dt*tileSize*0.18; // wobble
        p.y += p.vy*dt*tileSize;
        p.vy -= 0.8*dt; if(p.vy<-2.4) p.vy=-2.4; // gentle buoyant acceleration
      } else if(p.kind==='smoke'){
        const age=Math.min(1,p.life/p.max);
        p.vx += (p.shear||0)*dt;
        const worldWind=windAtParticle(p,tileSize,getTile)*windResponse('smoke');
        p.x += (p.vx + worldWind + (p.wind||0)*p.life + Math.sin(p.life*2.6 + p.phase)*0.16*(1+age))*dt*tileSize;
        p.y += p.vy*dt*tileSize;
        p.vy -= (p.lift||0.18)*dt;
        if(p.vy<-3.2) p.vy=-3.2;
        p.r += p.grow*dt*(0.85+age*0.85);
        p.rot += (p.spin||0)*dt;
      } else if(p.kind==='energy'){
        const age=Math.min(1,p.life/p.max);
        p.px=p.x; p.py=p.y;
        const pull=Math.min(1, dt*(7.5+age*14));
        const dx=(p.tx||p.x)-p.x, dy=(p.ty||p.y)-p.y;
        const side=Math.sin(p.life*26 + (p.phase||0))*(p.wobble||0.5)*(1-age);
        p.x += dx*pull + side*dt*tileSize;
        p.y += dy*pull + Math.cos(p.life*22 + (p.phase||0))*side*0.35*dt*tileSize;
      } else {
        const worldWind=windAtParticle(p,tileSize,getTile);
        p.vx += worldWind*windResponse(p.kind)*dt;
        p.x += p.vx*dt*tileSize;
        p.y += p.vy*dt*tileSize;
        p.vy += 8*dt;
      }
      if(p.life>p.max){
        if(p.kind==='smoke') smokeCount=Math.max(0,smokeCount-1);
        particles.splice(i,1);
      }
    }
    if(particles.length>PARTICLE_CAP){
      const removed=particles.splice(0, particles.length-PARTICLE_CAP);
      removed.forEach(p=>{ if(p.kind==='smoke') smokeCount=Math.max(0,smokeCount-1); });
    }
  };

  mod.draw = function(ctx, canDrawTile, TILE){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const tileSize = TILE || 20;
    const ms=frameMs();
    const smokeAlphaScale = smokeDrawAlphaScale(ms,smokeCount);
    for(let i=0;i<particles.length;i++){
      const p=particles[i];
      const vx = p.kind==='smoke' && Number.isFinite(p.tileX) ? p.tileX : Math.floor(p.x/tileSize);
      const vy = p.kind==='smoke' && Number.isFinite(p.tileY) ? p.tileY : Math.floor(p.y/tileSize);
      if(visibleTile && !visibleTile(vx, vy)) continue;
      const age = Math.max(0, Math.min(1, p.life/p.max));
      const alpha = 1 - age;
      if(p.kind==='splash'){
        ctx.fillStyle = 'rgba(120,190,255,'+(alpha*0.9)+')';
        ctx.fillRect(p.x-1.5, p.y-1.5, 3, 3);
      } else if(p.kind==='bubble'){
        ctx.strokeStyle = 'rgba(210,235,255,'+(alpha*0.8)+')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.stroke();
      } else if(p.kind==='smoke'){
        const shade=Math.round(p.shade||24);
        const fadeIn=Math.min(1, age/0.12);
        const plumeAlpha=fadeIn*Math.pow(alpha,1.35)*(p.alpha||0.38)*smokeAlphaScale;
        if(plumeAlpha<0.012) continue;
        const sp=smokeSprite(shade,p.variant||0);
        if(sp && ctx.drawImage){
          ctx.save();
          ctx.globalAlpha=plumeAlpha;
          ctx.globalCompositeOperation='source-over';
          ctx.translate(p.x,p.y);
          ctx.rotate(p.rot||0);
          const w=Math.max(2,p.r*2.15*(p.stretch||1));
          const h=Math.max(2,p.r*1.85);
          ctx.drawImage(sp,-w/2,-h/2,w,h);
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba('+shade+','+shade+','+shade+','+plumeAlpha.toFixed(3)+')';
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1,p.r), 0, Math.PI*2); ctx.fill();
        }
      } else if(p.kind==='glass'){
        ctx.save();
        ctx.translate(p.x,p.y);
        ctx.rotate(p.rot||0);
        ctx.fillStyle = 'rgba(185,245,255,'+(alpha*0.82)+')';
        const s=p.size||3;
        ctx.fillRect(-s*0.5,-1,s,2);
        ctx.fillStyle = 'rgba(255,255,255,'+(alpha*0.55)+')';
        ctx.fillRect(-1,-s*0.5,2,s*0.75);
        ctx.restore();
      } else if(p.kind==='energy'){
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        const cyan=p.hue!=='gold';
        ctx.strokeStyle=cyan ? 'rgba(94,245,255,'+(alpha*0.78)+')' : 'rgba(255,218,88,'+(alpha*0.72)+')';
        ctx.lineWidth=1.2+2.0*(1-age);
        ctx.beginPath();
        ctx.moveTo(Number.isFinite(p.px)?p.px:p.x, Number.isFinite(p.py)?p.py:p.y);
        ctx.lineTo(p.x,p.y);
        ctx.stroke();
        ctx.fillStyle=cyan ? 'rgba(190,255,255,'+(alpha*0.92)+')' : 'rgba(255,244,180,'+(alpha*0.85)+')';
        const s=2.2+3.2*(1-age);
        ctx.fillRect(p.x-s*0.5,p.y-s*0.5,s,s);
        ctx.restore();
      } else if(p.kind==='spark'){
        const electric = p.tier==='turbo' || p.tier==='electric';
        const s=p.size||3;
        ctx.save();
        if(electric) ctx.globalCompositeOperation='lighter';
        ctx.fillStyle = electric
          ? 'rgba(155,248,255,'+(alpha*0.95)+')'
          : (p.tier==='epic'? 'rgba(224,179,65,'+alpha+')' : (p.tier==='rare'? 'rgba(167,76,201,'+alpha+')' : 'rgba(176,127,44,'+alpha+')'));
        ctx.fillRect(p.x - s*0.5, p.y - s*0.5, s, s);
        if(electric){
          ctx.fillStyle='rgba(255,255,255,'+(alpha*0.78)+')';
          ctx.fillRect(p.x-0.5,p.y-s*0.75,1,s*1.5);
          ctx.fillStyle='rgba(82,150,255,'+(alpha*0.45)+')';
          ctx.fillRect(p.x-s*0.9,p.y-0.5,s*1.8,1);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = p.tier==='epic'? 'rgba(224,179,65,'+alpha+')' : (p.tier==='rare'? 'rgba(167,76,201,'+alpha+')' : 'rgba(176,127,44,'+alpha+')');
        ctx.fillRect(p.x -2, p.y -2, 4, 4);
      }
    }
  };

  // Clear particles (world regen / fresh start)
  mod.reset = function(){ particles.length = 0; smokeCount = 0; };
  // Live particle count (debug / tests)
  mod.count = function(){ return particles.length; };
  mod.smokeCount = function(){ return smokeCount; };
  mod.metrics = function(){
    const ms=frameMs();
    return {
      particles:particles.length,
      smoke:smokeCount,
      smokeSprites:smokeSprites.size,
      smokeCap:currentSmokeCap(),
      smokeMaxCap:SMOKE_CAP,
      smokeAlphaScale:smokeDrawAlphaScale(ms,smokeCount)
    };
  };
  mod._debugSnapshot = function(){ return particles.map(p=>({kind:p.kind,x:p.x,y:p.y,vx:p.vx,vy:p.vy,life:p.life,max:p.max,r:p.r,alpha:p.alpha,tileX:p.tileX,tileY:p.tileY})); };

  MM.particles = mod;
})();
// ESM export (progressive migration)
export const particles = (typeof window!=='undefined' && window.MM) ? window.MM.particles : undefined;
export default particles;
