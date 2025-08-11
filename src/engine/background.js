// Background rendering module: sky gradient, stars, sun/moon, mountains, tint overlay
// Exposes MM.background.draw(ctx,W,H,playerX,TILE,WORLDGEN) and MM.background.applyTint(ctx,W,H)
(function(){
  window.MM = window.MM || {};
  const background = {};

  // Day/night cycle
  const DAY_DURATION=300000; // 5 min
  const NIGHT_DURATION=300000; // 5 min
  const CYCLE_DURATION=DAY_DURATION+NIGHT_DURATION;
  const DAY_FRAC = DAY_DURATION / CYCLE_DURATION; // 0.5
  const TWILIGHT_BAND = 0.12;
  let cycleStart=performance.now();

  // Palettes for 3 macro biomes used by the sky (0 plains, 1 hills, 2 mountains)
  const SKY_PALETTES={
    0:{ dayTop:'#5da9ff', dayBot:'#cfe9ff', duskTop:'#ff8c3a', duskBot:'#ffd5a1', nightTop:'#091a2e', nightBot:'#0d2238', mount:['#5d7ba0','#4e6889','#3a516d'] },
    1:{ dayTop:'#4b8fdc', dayBot:'#c2ddf5', duskTop:'#ff7a3a', duskBot:'#ffc68a', nightTop:'#081627', nightBot:'#0b1d30', mount:['#557094','#465d78','#334556'] },
    2:{ dayTop:'#3b6fae', dayBot:'#b4d3ec', duskTop:'#ff6c36', duskBot:'#ffb778', nightTop:'#071320', nightBot:'#0a1928', mount:['#4a5f73','#3c4d5d','#2c3843'] }
  };

  // Stars
  const STAR_COUNT=140;
  const STAR_COLORS=['#ffffff','#ffdcb8','#cfe8ff','#ffeedd','#d5f2ff'];
  const starsFar=[], starsNear=[];
  function pickStarColor(){ const r=Math.random(); if(r<0.55) return STAR_COLORS[0]; if(r<0.70) return STAR_COLORS[1]; if(r<0.85) return STAR_COLORS[2]; if(r<0.93) return STAR_COLORS[3]; return STAR_COLORS[4]; }
  function initStars(){
    if(starsFar.length || starsNear.length) return; // once
    for(let i=0;i<STAR_COUNT;i++) starsFar.push({x:Math.random(), y:Math.random(), r:Math.random()*1.05+0.25, a:Math.random()*0.5+0.35, c:pickStarColor()});
    for(let i=0;i<STAR_COUNT*0.55;i++) starsNear.push({x:Math.random(), y:Math.random(), r:Math.random()*1.8+0.45, a:Math.random()*0.6+0.4, c:pickStarColor()});
  }

  // Mountains
  const mountainCache=new Map();
  function getMountainLayer(biome,layer){ const key=biome+'_'+layer; if(mountainCache.has(key)) return mountainCache.get(key); const pal=SKY_PALETTES[biome]||SKY_PALETTES[0]; const col=pal.mount[Math.min(layer,pal.mount.length-1)]; const c=document.createElement('canvas'); c.width=1600; c.height=300; const g=c.getContext('2d'); g.fillStyle=col; const peaks=12; const hBase= c.height*(0.25+0.18*layer); const amp= 80 + layer*40; g.beginPath(); g.moveTo(0,c.height); for(let i=0;i<=peaks;i++){ const x=i/peaks*c.width; const y=hBase - Math.sin(i*1.3 + biome*0.8)*(amp*0.35) - Math.random()*amp*0.2; g.lineTo(x,y); } g.lineTo(c.width,c.height); g.closePath(); g.fill(); mountainCache.set(key,c); return c; }

  // Helpers
  function lerp(a,b,t){ return a + (b-a)*t; }
  function lerpColor(c1,c2,t){ const p1=parseInt(c1.slice(1),16); const p2=parseInt(c2.slice(1),16); const r=lerp((p1>>16)&255,(p2>>16)&255,t)|0; const g=lerp((p1>>8)&255,(p2>>8)&255,t)|0; const b=lerp(p1&255,p2&255,t)|0; return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); }
  function hexToRgba(hex,a){ const p=parseInt(hex.slice(1),16); const r=(p>>16)&255,g=(p>>8)&255,b=p&255; return `rgba(${r},${g},${b},${a})`; }
  function smoothstep(a,b,x){ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); }
  function blendColor(c1,c2,t){ return lerpColor(c1,c2,t); }
  function blendPalette(p1,p2,t){ if(!p2||t<=0) return p1; if(t>=1) return p2; return {
    dayTop:blendColor(p1.dayTop,p2.dayTop,t), dayBot:blendColor(p1.dayBot,p2.dayBot,t),
    duskTop:blendColor(p1.duskTop,p2.duskTop,t), duskBot:blendColor(p1.duskBot,p2.duskBot,t),
    nightTop:blendColor(p1.nightTop,p2.nightTop,t), nightBot:blendColor(p1.nightBot,p2.nightBot,t),
    mount:[0,1,2].map(i=>blendColor(p1.mount[i],p2.mount[i],t)) };
  }
  function computeBiomeBlend(x, WORLDGEN){ if(!WORLDGEN || !WORLDGEN.valueNoise) return {pal:SKY_PALETTES[0], a:0,b:0,t:0}; const v=WORLDGEN.valueNoise(x,220,900); const t1=0.35, t2=0.7, w=0.05; if(v < t1-w){ return {pal:SKY_PALETTES[0], a:0,b:0,t:0}; } if(v>t2+w){ return {pal:SKY_PALETTES[2], a:2,b:2,t:0}; } if(v>=t1-w && v<=t1+w){ const t=smoothstep(t1-w,t1+w,v); return {pal:blendPalette(SKY_PALETTES[0],SKY_PALETTES[1],t), a:0,b:1,t}; } if(v>=t2-w && v<=t2+w){ const t=smoothstep(t2-w,t2+w,v); return {pal:blendPalette(SKY_PALETTES[1],SKY_PALETTES[2],t), a:1,b:2,t}; } if(v<t2){ return {pal:SKY_PALETTES[1], a:1,b:1,t:0}; } return {pal:SKY_PALETTES[2], a:2,b:2,t:0}; }
  function skyGradientFromPalette(pal,cycleT){
    const dayFrac=DAY_FRAC; const twilightBand=TWILIGHT_BAND; const extend = twilightBand*2; let top, bottom;
    if(cycleT < dayFrac){
      const t=cycleT/dayFrac;
      const k0={t:0, top:pal.nightTop, bot:pal.nightBot};
      const k1={t:twilightBand, top:pal.duskTop, bot:pal.duskBot};
      const k2={t:Math.min(extend,0.45), top:pal.dayTop, bot:pal.dayBot};
      const k3={t:Math.max(1-extend,0.55), top:pal.dayTop, bot:pal.dayBot};
      const k4={t:1-twilightBand, top:pal.duskTop, bot:pal.duskBot};
      const k5={t:1, top:pal.nightTop, bot:pal.nightBot};
      const keys=[k0,k1,k2,k3,k4,k5];
      for(let i=0;i<keys.length-1;i++){ const a=keys[i], b=keys[i+1]; if(t>=a.t && t<=b.t){ const span=b.t-a.t || 1; let u=(t-a.t)/span; u=u*u*(3-2*u); top=lerpColor(a.top,b.top,u); bottom=lerpColor(a.bot,b.bot,u); break; } }
      if(!top){ top=pal.dayTop; bottom=pal.dayBot; }
      const mid = Math.sin((t-0.5)*Math.PI*2)*0.015; // subtle
      if(mid!==0){
        function mod(col,amt){ const p=parseInt(col.slice(1),16); let r=(p>>16)&255,g=(p>>8)&255,b=p&255; r=Math.round(Math.min(255,Math.max(0,r+amt*12))); g=Math.round(Math.min(255,Math.max(0,g+amt*10))); b=Math.round(Math.min(255,Math.max(0,b+amt*16))); return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); }
        top=mod(top,mid); bottom=mod(bottom,mid*0.6);
      }
      return {top,bottom};
    } else {
      const nt=(cycleT - dayFrac)/(1-dayFrac);
      const k0={t:0, top:pal.nightTop, bot:pal.nightBot};
      const k1={t:0.25, top:pal.nightTop, bot:pal.nightBot};
      const k2={t:0.5, top:pal.nightTop, bot:pal.nightBot};
      const k3={t:0.75, top:pal.nightTop, bot:pal.nightBot};
      const k4={t:1, top:pal.nightTop, bot:pal.nightBot};
      const keys=[k0,k1,k2,k3,k4];
      for(let i=0;i<keys.length-1;i++){ const a=keys[i], b=keys[i+1]; if(nt>=a.t && nt<=b.t){ const span=b.t-a.t||1; let u=(nt-a.t)/span; u=u*u*(3-2*u); top=lerpColor(a.top,b.top,u); bottom=lerpColor(a.bot,b.bot,u); break; } }
      if(!top){ top=pal.nightTop; bottom=pal.nightBot; }
      const breathe = Math.sin(nt*Math.PI*2)*0.04; function mod(col,amt){ const p=parseInt(col.slice(1),16); let r=(p>>16)&255,g=(p>>8)&255,b=p&255; r=Math.round(Math.min(255,Math.max(0,r+amt*10))); g=Math.round(Math.min(255,Math.max(0,g+amt*14))); b=Math.round(Math.min(255,Math.max(0,b+amt*20))); return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); } top=mod(top,breathe); bottom=mod(bottom,breathe*0.5); return {top,bottom};
    }
  }

  let lastCycleInfo={cycleT:0,isDay:true,tDay:0,twilightBand:TWILIGHT_BAND};
  let moonPhaseIndex=0, lastPhaseCycle=-1; const MOON_PHASES=8;

  background.draw = function(ctx,W,H,playerX,TILE,WORLDGEN){
    initStars();
    const now=performance.now();
    const debugEnabled = window.__timeOverrideActive===true;
    const manualT = debugEnabled? (window.__timeOverrideValue||0): null;
    const rawCycleT = ((now-cycleStart)%CYCLE_DURATION)/CYCLE_DURATION;
    const cycleT = debugEnabled? manualT : rawCycleT;
    if(!debugEnabled && window.__timeSliderEl && !window.__timeSliderLocked){ window.__timeSliderEl.value = cycleT.toFixed(4); }
    const blend=computeBiomeBlend(playerX, WORLDGEN); const cols=skyGradientFromPalette(blend.pal,cycleT);
    // Sky gradient
    ctx.save(); ctx.globalAlpha=1; const grd=ctx.createLinearGradient(0,0,0,H); grd.addColorStop(0,cols.top); grd.addColorStop(1,cols.bottom); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
    // Horizon haze band
    (function(){
      const isDay=cycleT<DAY_FRAC; const tDay=isDay? (cycleT/DAY_FRAC) : ((cycleT-DAY_FRAC)/(1-DAY_FRAC));
      let hueCol; if(isDay){ const twilight=TWILIGHT_BAND; const edge=Math.min(1, Math.min(tDay/twilight, (1-tDay)/twilight)); hueCol = lerpColor('#ffb070', blend.pal.dayBot, edge); } else { const nt=(cycleT - DAY_FRAC)/(1-DAY_FRAC); const pulse = 0.4 + 0.6*Math.sin(nt*Math.PI*2); hueCol = lerpColor('#0b1d30', '#142b44', pulse*0.5); }
      const hazeTopY = H*0.52; const hazeBotY = H*0.80; const g2 = ctx.createLinearGradient(0,hazeTopY,0,hazeBotY);
      g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.65, hexToRgba(hueCol, isDay?0.06:0.08)); g2.addColorStop(1, hexToRgba(hueCol, isDay?0.12:0.16));
      ctx.fillStyle=g2; ctx.fillRect(0,hazeTopY,W,hazeBotY-hazeTopY);
    })();
    const isDay=cycleT<DAY_FRAC; const tDay=isDay? (cycleT/DAY_FRAC) : ((cycleT-DAY_FRAC)/(1-DAY_FRAC)); lastCycleInfo={cycleT,isDay,tDay,twilightBand:TWILIGHT_BAND};
    // Stars
    function smoothEdge(x,band){ if(x<=0) return 0; if(x>=band) return 1; const n=x/band; return n*n*(3-2*n); }
    const smoothBand = TWILIGHT_BAND*1.4; const edgeIn = smoothEdge(tDay, smoothBand); const edgeOut = smoothEdge(1 - tDay, smoothBand); let starAlpha = 1 - edgeIn*edgeOut; if(isDay) starAlpha *= 0.9; else starAlpha=1;
    if(starAlpha>0.01){
      // Far layer
      ctx.save(); const driftX = now*0.000005; const timeFar = now*0.0009; let lastC=null; const sinBaseFar = timeFar; starsFar.forEach(s=>{ const x = ((s.x + driftX) % 1)*W; const y=(s.y*0.55)*H; const tw=0.5+0.5*Math.sin(sinBaseFar + s.x*40); const a = starAlpha*0.85 * Math.min(1,(0.25+0.75*tw)*s.a); if(a>0.01){ if(s.c!==lastC){ ctx.fillStyle=s.c; lastC=s.c; } ctx.globalAlpha=a; ctx.fillRect(x,y,s.r,s.r); } }); ctx.restore();
      // Near layer
      ctx.save(); const pxFactor=(playerX*TILE*0.00008); const timeNear1=now*0.0013; const timeNear2=now*0.0006; let lastC2=null; const sinBaseNear1=timeNear1, sinBaseNear2=timeNear2; starsNear.forEach(s=>{ const x = ((s.x + pxFactor + now*0.00001) % 1)*W; const y=(s.y*0.5 + 0.02*Math.sin(sinBaseNear2 + s.x*60))*H; const tw=0.5+0.5*Math.sin(sinBaseNear1 + s.x*55); const a = starAlpha * Math.min(1,(0.35+0.65*tw)*s.a); if(a>0.01){ if(s.c!==lastC2){ ctx.fillStyle=s.c; lastC2=s.c; } ctx.globalAlpha=a; ctx.fillRect(x,y,s.r,s.r); } }); ctx.restore();
    }
    // Sun/Moon helpers
    function drawBody(frac,radius,color,glowCol){ const ang=lerp(Math.PI*1.05, Math.PI*-0.05, frac); const cx=W*0.5 + Math.cos(ang)*W*0.45; const cy=H*0.82 + Math.sin(ang)*H*0.65; const grd2=ctx.createRadialGradient(cx,cy,radius*0.15,cx,cy,radius); grd2.addColorStop(0,glowCol); grd2.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=grd2; ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.fill(); ctx.fillStyle=color; ctx.beginPath(); ctx.arc(cx,cy,radius*0.55,0,Math.PI*2); ctx.fill(); }
    const dayCore = isDay && tDay>=TWILIGHT_BAND && tDay<=1-TWILIGHT_BAND; if(isDay){ const sunGlow=dayCore? 'rgba(255,255,255,0.55)':'rgba(255,180,120,0.55)'; drawBody(tDay, 140, '#fff8d2', sunGlow); }
    const currentCycleIndex = Math.floor((performance.now()-cycleStart)/CYCLE_DURATION); if(currentCycleIndex !== lastPhaseCycle){ lastPhaseCycle=currentCycleIndex; moonPhaseIndex = (moonPhaseIndex + 1) % MOON_PHASES; }
    const moonFrac=(cycleT+0.5)%1; const moonAlpha=isDay? 0.05:0.9; const mAng=lerp(Math.PI*1.15, Math.PI*-0.15, moonFrac); const mcx=W*0.5 + Math.cos(mAng)*W*0.48; const mcy=H*0.88 + Math.sin(mAng)*H*0.68; const mr=70; ctx.save(); ctx.globalAlpha=moonAlpha; ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.arc(mcx,mcy,mr,0,Math.PI*2); ctx.fill(); ctx.globalCompositeOperation='destination-out'; if(moonPhaseIndex!==MOON_PHASES-1){ const phaseT = moonPhaseIndex / (MOON_PHASES-1); const cut = (0.5 - phaseT/2); ctx.beginPath(); const off = cut*mr*1.9; ctx.ellipse(mcx+off,mcy,mr*0.95,mr*1.05,0,0,Math.PI*2); ctx.fill(); if(moonPhaseIndex>0){ ctx.beginPath(); const off2 = (cut+0.15)*mr*1.2; ctx.ellipse(mcx-off2,mcy,mr*0.75,mr*0.95,0,0,Math.PI*2); ctx.fill(); } } ctx.restore();
    // Mountains (parallax)
    const baseY=H*0.60; const heightAdjust=-H*0.12; ctx.save(); for(let layer=0; layer<3; layer++){ const par=0.12 + layer*0.10; const y=baseY + layer*90 + heightAdjust; const alphaBase=0.85 - layer*0.22; ctx.save(); const scrollA = -((playerX*TILE)*par) % 1600; const imgA=getMountainLayer(blend.a,layer); ctx.globalAlpha=alphaBase * (blend.t>0? (1-blend.t):1); for(let k=-1;k<=1;k++){ ctx.drawImage(imgA, scrollA + k*imgA.width, y); } if(blend.t>0){ const imgB=getMountainLayer(blend.b,layer); const scrollB = scrollA; ctx.globalAlpha=alphaBase * blend.t; for(let k=-1;k<=1;k++){ ctx.drawImage(imgB, scrollB + k*imgB.width, y); } } ctx.restore(); } ctx.restore();
    ctx.restore(); // end background layer
  };

  background.applyTint = function(ctx,W,H){
    const info=lastCycleInfo; const dayFrac=DAY_FRAC; const twilight=info.twilightBand; let a=0, col='#000'; if(info.isDay){ if(info.tDay<twilight){ a = (1 - (info.tDay/twilight)) * 0.10; col='#ff9a4a'; } else if(info.tDay>1-twilight){ a = ((info.tDay-(1-twilight))/twilight) * 0.10; col='#ff8240'; } } else { const nightT = (info.cycleT - dayFrac)/(1-dayFrac); a = 0.12 + 0.13 * Math.sin(nightT*Math.PI); col = '#061425'; } if(a>0.001){ ctx.save(); ctx.globalAlpha=a; ctx.fillStyle=col; ctx.fillRect(0,0,W,H); ctx.restore(); }
  };

  // Save/load support for time-of-day and moon phase
  background.exportState = function(){
    const now=performance.now();
    const cycleT=((now-cycleStart)%CYCLE_DURATION)/CYCLE_DURATION;
    return { cycleT, moonPhaseIndex, lastPhaseCycle };
  };
  background.importState = function(s){
    if(!s) return;
    if(typeof s.cycleT==='number'){
      const now=performance.now();
      cycleStart = now - s.cycleT*CYCLE_DURATION;
    }
    if(typeof s.moonPhaseIndex==='number') moonPhaseIndex = s.moonPhaseIndex % MOON_PHASES;
    if(typeof s.lastPhaseCycle==='number') lastPhaseCycle = s.lastPhaseCycle;
  };

  // Optional: keep cycleStart roughly anchored for very long sessions (no-op placeholder)
  setInterval(()=>{ /* reserved for future pause logic */ },60000);

  MM.background = background;
})();
