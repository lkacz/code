// Background rendering module: sky gradient, stars, sun/moon, mountains, tint overlay
// Exposes MM.background.draw(ctx,W,H,playerX,TILE,WORLDGEN,cameraZoom) and MM.background.applyTint(ctx,W,H)
(function(){
  window.MM = window.MM || {};
  const background = {};

  // Day/night cycle
  const DAY_DURATION=300000; // 5 min
  const NIGHT_DURATION=300000; // 5 min
  const CYCLE_DURATION=DAY_DURATION+NIGHT_DURATION;
  const DAY_FRAC = DAY_DURATION / CYCLE_DURATION; // 0.5
  const TWILIGHT_BAND = 0.12;
  const BACKDROP_BLUR_MIN=1.25;
  const BACKDROP_BLUR_MAX=2.80;
  const RED_DWARF_PERIOD_CYCLES=4.75;
  let cycleStart=performance.now();

  // Palettes keyed by worldgen biome id. The background now follows the actual
  // biome mix around the hero instead of an unrelated noise field.
  const SKY_PALETTES={
    0:{ dayTop:'#5da9ff', dayBot:'#cfe9ff', duskTop:'#ff8c3a', duskBot:'#ffd5a1', nightTop:'#091a2e', nightBot:'#0d2238', mount:['#5d7ba0','#4e6889','#3a516d'] }, // forest
    1:{ dayTop:'#66b2ff', dayBot:'#d5ecff', duskTop:'#ff8f42', duskBot:'#ffd39a', nightTop:'#0a1b2d', nightBot:'#10253a', mount:['#6680a0','#526b87','#3e5368'] }, // plains
    2:{ dayTop:'#8bc2ff', dayBot:'#eef8ff', duskTop:'#ff7a52', duskBot:'#ffd6c2', nightTop:'#081522', nightBot:'#102235', mount:['#7b8ea0','#60717f','#485661'] }, // snow
    3:{ dayTop:'#7fc1ff', dayBot:'#f2d6a2', duskTop:'#e86e37', duskBot:'#f4ba75', nightTop:'#0b1728', nightBot:'#1b2332', mount:['#806f62','#695a50','#4f453e'] }, // desert
    4:{ dayTop:'#65a8df', dayBot:'#bfdccf', duskTop:'#d76f45', duskBot:'#c8aa7d', nightTop:'#071924', nightBot:'#102b2d', mount:['#536f69','#435b56','#314540'] }, // swamp
    5:{ dayTop:'#4fa8f4', dayBot:'#c9eaff', duskTop:'#ff8645', duskBot:'#ffc99a', nightTop:'#071629', nightBot:'#0b2642', mount:['#50789f','#416580','#304d65'] }, // sea
    6:{ dayTop:'#5eb4f2', dayBot:'#d0edf5', duskTop:'#f27d49', duskBot:'#ffc09c', nightTop:'#071827', nightBot:'#103044', mount:['#5c8192','#476b78','#35515c'] }, // lake
    7:{ dayTop:'#4b8fdc', dayBot:'#c2ddf5', duskTop:'#ff7a3a', duskBot:'#ffc68a', nightTop:'#081627', nightBot:'#0b1d30', mount:['#557094','#465d78','#334556'] }, // mountain
    8:{ dayTop:'#5e88b8', dayBot:'#c7d3dd', duskTop:'#c65f3f', duskBot:'#c29578', nightTop:'#070d16', nightBot:'#111925', mount:['#59616b','#454c55','#2f353e'] }  // ruined city
  };

  // Stars
  const STAR_COUNT=360;
  const STAR_COLORS=['#ffffff','#ffdcb8','#cfe8ff','#ffeedd','#d5f2ff'];
  const stars=[];
  function pickStarColor(){ const r=Math.random(); if(r<0.55) return STAR_COLORS[0]; if(r<0.70) return STAR_COLORS[1]; if(r<0.85) return STAR_COLORS[2]; if(r<0.93) return STAR_COLORS[3]; return STAR_COLORS[4]; }
  function initStars(){
    if(stars.length) return; // once
    for(let i=0;i<STAR_COUNT;i++){
      stars.push({
        orbit:0.12 + Math.sqrt(Math.random())*0.88,
        angle:Math.random()*Math.PI*2,
        r:Math.random()*1.05+0.25,
        a:Math.random()*0.5+0.35,
        tw:Math.random()*Math.PI*2,
        c:pickStarColor()
      });
    }
  }
  function starRotation(cycleT){
    const t=((cycleT%1)+1)%1;
    return t*Math.PI*2;
  }
  function starScreenPosition(s,W,H,rot){
    const poleX=W*0.52;
    const poleY=-H*0.18;
    const maxR=Math.hypot(Math.max(poleX,W-poleX),H*0.68-poleY);
    const rr=(s.orbit||0.5)*maxR;
    const a=(s.angle||0)+rot;
    return {x:poleX+Math.cos(a)*rr, y:poleY+Math.sin(a)*rr};
  }
  function starPositions(W,H,cycleT){
    initStars();
    const rot=starRotation(cycleT);
    return stars.map(s=>{
      const p=starScreenPosition(s,W,H,rot);
      return {x:+p.x.toFixed(3), y:+p.y.toFixed(3), r:+s.r.toFixed(3)};
    });
  }
  function drawStars(ctx,W,H,cycleT,starAlpha,now){
    if(starAlpha<=0.01) return;
    const rot=starRotation(cycleT);
    const twBase=now*0.0009;
    let lastC=null;
    ctx.save();
    for(const s of stars){
      const p=starScreenPosition(s,W,H,rot);
      if(p.x<-4 || p.x>W+4 || p.y<-4 || p.y>H*0.66) continue;
      const tw=0.5+0.5*Math.sin(twBase+s.tw);
      const a=starAlpha*0.92*Math.min(1,(0.28+0.72*tw)*s.a);
      if(a<=0.01) continue;
      if(s.c!==lastC){ ctx.fillStyle=s.c; lastC=s.c; }
      ctx.globalAlpha=a;
      ctx.fillRect(p.x,p.y,s.r,s.r);
    }
    ctx.restore();
  }

  // Mountains
  const mountainCache=new Map();
  const citySkylineCache=new Map();
  const biomeBlendCache=new Map();
  const scratchCanvases=new Map();
  const BIOME_BLEND_CACHE_CAP=2048;
  const BACKDROP_CACHE_FAST_FPS=60;
  const BACKDROP_CACHE_BALANCED_FPS=30;
  const BACKDROP_CACHE_SLOW_FPS=15;
  const backdropCache={w:0,h:0,playerX:0,tile:0,blur:0,lastMs:-1e9,refreshes:0};
  const MOUNTAIN_W=2200, MOUNTAIN_H=380;
  const MOUNTAIN_LAYER=[
    {par:0.070, y:0.315, alpha:0.62, base:188, amp:104, broad:520, mid:210, fine:68, step:18},
    {par:0.140, y:0.392, alpha:0.76, base:170, amp:128, broad:420, mid:160, fine:54, step:16},
    {par:0.240, y:0.485, alpha:0.88, base:154, amp:154, broad:330, mid:118, fine:42, step:14}
  ];
  function mountainHash(i,seed){
    let h=Math.imul(i|0,374761393) ^ Math.imul(seed|0,668265263);
    h=Math.imul(h^(h>>>15),2246822519);
    h=Math.imul(h^(h>>>13),3266489917);
    h^=h>>>16;
    return (h>>>0)/4294967296;
  }
  function mountainNoise(x,wavelength,seed,width){
    const segments=Math.max(3,Math.round(width/Math.max(16,wavelength)));
    const p=(x/width)*segments;
    const i=Math.floor(p);
    const f=p-i;
    const u=f*f*(3-2*f);
    const a=((i%segments)+segments)%segments;
    const b=(a+1)%segments;
    return lerp(mountainHash(a,seed),mountainHash(b,seed),u);
  }
  function mountainRidge(x,wavelength,seed,width){
    const n=mountainNoise(x,wavelength,seed,width);
    return 1-Math.abs(2*n-1);
  }
  function mountainY(x,biome,layer,pass,width){
    const spec=MOUNTAIN_LAYER[layer];
    const seed=biome*101 + layer*37 + pass*503;
    const broad=mountainRidge(x,spec.broad,seed+11,width);
    const mid=mountainRidge(x,spec.mid,seed+23,width);
    const fine=mountainNoise(x,spec.fine,seed+41,width)-0.5;
    const shoulder=Math.sin((x/width)*Math.PI*2*(1.5+layer*0.35)+biome*0.8+pass)*0.12;
    const energy=0.48*broad + 0.40*mid + shoulder + fine*0.22;
    return spec.base - spec.amp*energy + pass*(22+layer*10);
  }
  function traceMountainPath(g,points,height){
    g.beginPath();
    g.moveTo(0,height);
    for(const p of points) g.lineTo(p.x,p.y);
    g.lineTo(points[points.length-1].x,height);
    g.closePath();
  }
  function buildMountainPoints(biome,layer,pass,width){
    const step=MOUNTAIN_LAYER[layer].step;
    const pts=[];
    for(let x=0; x<=width; x+=step) pts.push({x,y:mountainY(x,biome,layer,pass,width)});
    if(pts[pts.length-1].x!==width) pts.push({x:width,y:mountainY(width,biome,layer,pass,width)});
    pts[0].y=pts[pts.length-1].y; // keep the tiled seam invisible
    return pts;
  }
  function getMountainLayer(biome,layer){
    const key=biome+'_'+layer;
    if(mountainCache.has(key)) return mountainCache.get(key);
    const pal=SKY_PALETTES[biome]||SKY_PALETTES[0];
    const col=pal.mount[Math.min(layer,pal.mount.length-1)];
    const c=document.createElement('canvas');
    c.width=MOUNTAIN_W; c.height=MOUNTAIN_H;
    const g=c.getContext('2d');
    const back=buildMountainPoints(biome,layer,1,c.width);
    const front=buildMountainPoints(biome,layer,0,c.width);
    const backGrad=g.createLinearGradient(0,0,0,c.height);
    backGrad.addColorStop(0,hexToRgba(blendColor(col,'#ffffff',0.24),0.46));
    backGrad.addColorStop(1,hexToRgba(blendColor(col,'#000000',0.18),0.42));
    g.fillStyle=backGrad;
    traceMountainPath(g,back,c.height);
    g.fill();
    const bodyGrad=g.createLinearGradient(0,0,0,c.height);
    bodyGrad.addColorStop(0,blendColor(col,'#ffffff',0.13));
    bodyGrad.addColorStop(0.42,col);
    bodyGrad.addColorStop(1,blendColor(col,'#000000',0.34));
    g.fillStyle=bodyGrad;
    traceMountainPath(g,front,c.height);
    g.fill();
    g.strokeStyle=hexToRgba(blendColor(col,'#ffffff',0.28), layer===0?0.26:0.20);
    g.lineWidth=1.25;
    g.beginPath();
    front.forEach((p,i)=>{ if(i===0) g.moveTo(p.x,p.y+0.5); else g.lineTo(p.x,p.y+0.5); });
    g.stroke();
    g.strokeStyle=hexToRgba(blendColor(col,'#000000',0.42),0.12+layer*0.035);
    g.lineWidth=1;
    for(let i=0;i<26+layer*7;i++){
      const x=mountainHash(i,biome*193+layer*71)*c.width;
      const y=mountainY(x,biome,layer,0,c.width)+8;
      const len=38 + mountainHash(i+17,biome*211+layer*83)*72 + layer*18;
      const dx=(mountainHash(i+29,biome*257+layer*97)-0.5)*(18+layer*7);
      g.beginPath();
      g.moveTo(x,y);
      g.lineTo(x+dx,y+len);
      g.stroke();
    }
    if(biome===2){
      g.fillStyle=hexToRgba('#f3fbff',0.48-layer*0.07);
      for(let i=1;i<front.length-1;i+=Math.max(2,4-layer)){
        const p=front[i];
        const prominence=(MOUNTAIN_LAYER[layer].base-p.y)/MOUNTAIN_LAYER[layer].amp;
        if(prominence<0.56) continue;
        const capW=(18+layer*9)*Math.min(1.25,prominence);
        const capH=(14+layer*7)*Math.min(1.2,prominence);
        g.beginPath();
        g.moveTo(p.x,p.y+2);
        g.lineTo(p.x-capW,p.y+capH);
        g.lineTo(p.x+capW,p.y+capH*0.88);
        g.closePath();
        g.fill();
      }
    }
    mountainCache.set(key,c);
    return c;
  }
  function mountainBottomFillStyle(biome,layer,mask){
    if(mask) return '#000';
    const pal=SKY_PALETTES[biome]||SKY_PALETTES[0];
    const col=pal.mount[Math.min(layer,pal.mount.length-1)];
    return blendColor(col,'#000000',0.34);
  }
  function drawMountainRepeats(ctx,img,scroll,y,alpha,W,extendToY,bottomFill){
    if(alpha<=0) return;
    ctx.globalAlpha=alpha;
    let x=scroll%img.width;
    if(x>0) x-=img.width;
    const drawY=Math.round(y);
    const dpr=(typeof window!=='undefined' && Number.isFinite(window.devicePixelRatio)) ? Math.max(1,Math.min(3,window.devicePixelRatio||1)) : 1;
    const snap=(v)=>Math.round(v*dpr)/dpr;
    for(; x<W; x+=img.width) ctx.drawImage(img,snap(x),drawY);
    const bottom=drawY+img.height;
    if(Number.isFinite(extendToY) && extendToY>bottom && bottomFill){
      ctx.fillStyle=bottomFill;
      ctx.fillRect(0,bottom,W,extendToY-bottom);
    }
  }
  function scratchCanvas(name,W,H){
    if(typeof document==='undefined' || !document.createElement) return null;
    const w=Math.max(1,Math.ceil(W));
    const h=Math.max(1,Math.ceil(H));
    let c=scratchCanvases.get(name);
    if(!c){
      c=document.createElement('canvas');
      scratchCanvases.set(name,c);
    }
    if(c.width!==w) c.width=w;
    if(c.height!==h) c.height=h;
    return c;
  }
  function clearScratch(ctx,W,H){
    if(!ctx) return false;
    ctx.globalCompositeOperation='source-over';
    ctx.globalAlpha=1;
    if('filter' in ctx) ctx.filter='none';
    if(ctx.clearRect) ctx.clearRect(0,0,W,H);
    return true;
  }

  // Distant devastated-city silhouettes. Generated once per layer and repeated
  // as a parallax band; the actual foreground city is still tile-based.
  const CITY_SKYLINE_W=2400, CITY_SKYLINE_H=340;
  const CITY_SKYLINE_LAYER=[
    {par:0.115, y:0.445, alpha:0.24, base:252, seed:1701, step:32, minH:36, maxH:116},
    {par:0.190, y:0.505, alpha:0.34, base:242, seed:2711, step:26, minH:50, maxH:154},
    {par:0.305, y:0.575, alpha:0.42, base:232, seed:3701, step:22, minH:54, maxH:188}
  ];
  function getCitySkylineLayer(layer){
    const key='city_'+layer;
    if(citySkylineCache.has(key)) return citySkylineCache.get(key);
    const spec=CITY_SKYLINE_LAYER[layer];
    const c=document.createElement('canvas');
    c.width=CITY_SKYLINE_W; c.height=CITY_SKYLINE_H;
    const g=c.getContext('2d');
    const baseY=spec.base;
    const col=['#343b44','#252b34','#171d25'][layer] || '#252b34';
    const edge=['#6c7480','#59616c','#434c58'][layer] || '#59616c';
    const windowCol=['#d9e4ec','#9fb9ca','#5f7486'][layer] || '#9fb9ca';
    g.fillStyle='rgba(0,0,0,0)';
    g.clearRect(0,0,c.width,c.height);
    for(let x=-40; x<c.width+40; ){
      const n=mountainHash(Math.floor(x/spec.step), spec.seed);
      const w=10+Math.floor(n*26)+(layer*2);
      const h=spec.minH + Math.floor(mountainHash(Math.floor(x/spec.step)+91, spec.seed)*spec.maxH);
      const lean=(mountainHash(Math.floor(x/spec.step)+41, spec.seed)-0.5)*10;
      const top=baseY-h;
      const broken=mountainHash(Math.floor(x/spec.step)+211, spec.seed);
      g.fillStyle=col;
      g.beginPath();
      g.moveTo(x,baseY);
      g.lineTo(x+lean,top+(broken<0.38?8+broken*16:0));
      g.lineTo(x+w+lean,top+(broken>0.62?8+(1-broken)*18:0));
      g.lineTo(x+w,baseY);
      g.closePath();
      g.fill();
      g.strokeStyle=hexToRgba(edge,0.24);
      g.lineWidth=1;
      g.stroke();
      if(w>14 && h>58){
        g.fillStyle=hexToRgba(windowCol,0.08+0.05*layer);
        const rows=Math.min(10,Math.floor(h/16));
        for(let r=1; r<rows; r++){
          const yy=baseY-r*15;
          if(yy<top+8) continue;
          for(let xx=x+4; xx<x+w-3; xx+=7){
            if(mountainHash((xx|0)+r*31, spec.seed+777)<0.28) g.fillRect(xx,yy,3,4);
          }
        }
      }
      if(layer>0 && mountainHash(Math.floor(x/spec.step)+333, spec.seed)>0.82){
        g.strokeStyle=hexToRgba('#111820',0.55);
        g.lineWidth=2;
        g.beginPath();
        g.moveTo(x+w*0.5+lean,top);
        g.lineTo(x+w*0.5+lean+8,top-28-mountainHash(x|0,spec.seed)*26);
        g.stroke();
      }
      x += w + 4 + Math.floor(mountainHash(Math.floor(x/spec.step)+19, spec.seed)*10);
    }
    g.fillStyle=hexToRgba('#0a0d12',0.18+layer*0.07);
    g.fillRect(0,baseY,c.width,c.height-baseY);
    citySkylineCache.set(key,c);
    return c;
  }
  function drawCitySkyline(ctx,W,H,playerX,TILE,influence,isDay,mask){
    if(influence<=0.01) return;
    for(let layer=0; layer<CITY_SKYLINE_LAYER.length; layer++){
      const spec=CITY_SKYLINE_LAYER[layer];
      const img=getCitySkylineLayer(layer);
      const y=Math.round(H*spec.y);
      const alpha=mask ? clamp(influence*1.35,0,1) : cityBackdropOpacity(influence,isDay,layer);
      drawMountainRepeats(ctx,img,-((playerX*TILE)*spec.par),y,alpha,W);
    }
  }
  function drawVolcanoCue(ctx,W,H,playerX,TILE,volcano,isDay){
    if(!volcano || volcano.amount<=0.025 || typeof volcano.center!=='number') return;
    const cx=W*0.5 + (volcano.center-playerX)*TILE*0.20;
    if(cx<-180 || cx>W+180) return;
    const a=clamp(volcano.amount,0,1);
    const baseY=H*(0.50+0.05*(1-a));
    ctx.save();
    const glow=ctx.createRadialGradient(cx,baseY,4,cx,baseY,80+60*a);
    glow.addColorStop(0,hexToRgba('#ff7b24',(isDay?0.12:0.26)*a));
    glow.addColorStop(0.55,hexToRgba('#7a2c12',(isDay?0.05:0.12)*a));
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;
    ctx.fillRect(cx-150,baseY-130,300,160);
    // Do not draw decorative parallax smoke here: the real volcano/fire systems
    // emit world-space smoke that stays attached to the actual source.
    ctx.globalAlpha=(isDay?0.09:0.18)*a;
    ctx.fillStyle='#0c0d10';
    ctx.beginPath();
    ctx.ellipse(cx,baseY+2,Math.max(24,volcano.radius*TILE*0.10),7,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // Helpers
  function lerp(a,b,t){ return a + (b-a)*t; }
  function lerpColor(c1,c2,t){ const p1=parseInt(c1.slice(1),16); const p2=parseInt(c2.slice(1),16); const r=lerp((p1>>16)&255,(p2>>16)&255,t)|0; const g=lerp((p1>>8)&255,(p2>>8)&255,t)|0; const b=lerp(p1&255,p2&255,t)|0; return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); }
  function hexToRgba(hex,a){ const p=parseInt(hex.slice(1),16); const r=(p>>16)&255,g=(p>>8)&255,b=p&255; return `rgba(${r},${g},${b},${a})`; }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function backdropBlurPx(W,H){
    const span=Math.max(1,Math.min(Number(W)||1,Number(H)||1));
    return clamp(span*0.0038,BACKDROP_BLUR_MIN,BACKDROP_BLUR_MAX);
  }
  function backdropBlurScale(){
    const root = (typeof window!=='undefined') ? window : (typeof globalThis!=='undefined' ? globalThis : null);
    const raw = root ? Number(root.__backdropBlurScale) : 1;
    return Number.isFinite(raw) ? clamp(raw,0.5,2.2) : 1;
  }
  function cameraZoomBlurScale(cameraZoom){
    const z=Number.isFinite(+cameraZoom) ? clamp(+cameraZoom,0.5,3) : 1;
    if(z<=1) return lerp(0.5,1,(z-0.5)/0.5);
    return lerp(1,2,(z-1)/2);
  }
  function effectiveBackdropBlurPx(W,H,cameraZoom){
    return backdropBlurPx(W,H)*backdropBlurScale()*cameraZoomBlurScale(cameraZoom);
  }
  function measuredFrameMs(){
    const root = (typeof window!=='undefined') ? window : (typeof globalThis!=='undefined' ? globalThis : null);
    const raw = root ? Number(root.__mmFrameMs) : 0;
    return Number.isFinite(raw) && raw>0 ? raw : 0;
  }
  function backdropRefreshIntervalMs(){
    const frameMs=measuredFrameMs();
    if(frameMs>10.5) return 1000/BACKDROP_CACHE_SLOW_FPS;
    if(frameMs>8.8) return 1000/BACKDROP_CACHE_BALANCED_FPS;
    return 1000/BACKDROP_CACHE_FAST_FPS;
  }
  function shouldRefreshBackdropCache(W,H,playerX,TILE,blur,now){
    if(backdropCache.w!==Math.ceil(W) || backdropCache.h!==Math.ceil(H)) return true;
    if(Math.abs((backdropCache.blur||0)-blur)>0.035) return true;
    if(Math.abs((backdropCache.tile||0)-TILE)>0.001) return true;
    return now-backdropCache.lastMs>=backdropRefreshIntervalMs();
  }
  function markBackdropCache(W,H,playerX,TILE,blur,now){
    backdropCache.w=Math.ceil(W);
    backdropCache.h=Math.ceil(H);
    backdropCache.playerX=playerX;
    backdropCache.tile=TILE;
    backdropCache.blur=blur;
    backdropCache.lastMs=now;
    backdropCache.refreshes++;
  }
  function solidBackdropOpacity(raw,floor=0.92){
    return clamp(floor+(1-floor)*clamp(finite(raw,1),0,1),floor,1);
  }
  function cityBackdropOpacity(influence,isDay,layer){
    const presence=smoothstep(0.04,0.30,clamp(finite(influence,0),0,1));
    const base=[0.84,0.90,0.96][layer] || 0.90;
    return clamp(presence*base*(isDay?0.96:1),0,1);
  }
  function smoothstep(a,b,x){ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); }
  function celestialPosition(frac,W,H,opts){
    const ang=lerp(opts.start,opts.end,frac);
    return {
      x:W*0.5 + Math.cos(ang)*W*opts.xAmp,
      y:H*opts.yBase - Math.sin(ang)*H*opts.yAmp,
      angle:ang
    };
  }
  function sunPosition(frac,W,H){ return celestialPosition(frac,W,H,{start:Math.PI*1.05,end:Math.PI*-0.05,xAmp:0.45,yBase:0.82,yAmp:0.65}); }
  function moonPosition(frac,W,H){ return celestialPosition(frac,W,H,{start:Math.PI*1.13,end:Math.PI*-0.13,xAmp:0.50,yBase:0.84,yAmp:0.67}); }
  function redDwarfPosition(frac,W,H){ return celestialPosition(frac,W,H,{start:Math.PI*1.18,end:Math.PI*-0.18,xAmp:0.58,yBase:0.76,yAmp:0.54}); }
  function moonFracForCycle(cycleT){
    const t=((cycleT%1)+1)%1;
    return (((t-DAY_FRAC)/(1-DAY_FRAC))%1+1)%1;
  }
  function blendColor(c1,c2,t){ return lerpColor(c1,c2,t); }
  function blendPalette(p1,p2,t){ if(!p2||t<=0) return p1; if(t>=1) return p2; return {
    dayTop:blendColor(p1.dayTop,p2.dayTop,t), dayBot:blendColor(p1.dayBot,p2.dayBot,t),
    duskTop:blendColor(p1.duskTop,p2.duskTop,t), duskBot:blendColor(p1.duskBot,p2.duskBot,t),
    nightTop:blendColor(p1.nightTop,p2.nightTop,t), nightBot:blendColor(p1.nightBot,p2.nightBot,t),
    mount:[0,1,2].map(i=>blendColor(p1.mount[i],p2.mount[i],t)) };
  }
  const SEASON_TINTS={
    spring:{color:'#7ecf8a',alpha:0.020},
    summer:{color:'#ffd06a',alpha:0.018},
    autumn:{color:'#d98942',alpha:0.034},
    winter:{color:'#d9efff',alpha:0.046}
  };
  const MOON_SEASON_STYLES={
    spring:{core:'#f3f0d5',edge:'#fff7d7',halo:'#8bd99b',accent:'#86df8f',shade:'#334356',mark:'#8abf93',mote:'#b5ffd0'},
    summer:{core:'#fff1c4',edge:'#fff9dd',halo:'#ffd570',accent:'#ffca61',shade:'#463b39',mark:'#e2a950',mote:'#ffe089'},
    autumn:{core:'#f4dec2',edge:'#fff0d8',halo:'#d98a45',accent:'#d88342',shade:'#4a3541',mark:'#b76d3a',mote:'#f6a65a'},
    winter:{core:'#e7f5ff',edge:'#fbfdff',halo:'#bceaff',accent:'#c8f3ff',shade:'#233049',mark:'#8fcde7',mote:'#dffaff'},
    off:{core:'#edf0e6',edge:'#fff8e5',halo:'#b8c7d5',accent:'#cbd5de',shade:'#2d3544',mark:'#aeb8c2',mote:'#f2f6ff'}
  };
  const MOON_BIOME_STYLES={
    0:{id:'forest', accent:'#94d58b', mark:'#6caa72', mote:'#b8ffc0'},
    1:{id:'plains', accent:'#cbdc83', mark:'#9aae69', mote:'#f2f6aa'},
    2:{id:'snow', accent:'#d8f7ff', mark:'#9ad7ec', mote:'#ffffff'},
    3:{id:'desert', accent:'#e7bf72', mark:'#bb8c54', mote:'#ffd98b'},
    4:{id:'swamp', accent:'#82c6a3', mark:'#5d9a82', mote:'#a3ffd8'},
    5:{id:'sea', accent:'#75c9ff', mark:'#5597c8', mote:'#a9e8ff'},
    6:{id:'lake', accent:'#82dbf2', mark:'#57a8bd', mote:'#bdf6ff'},
    7:{id:'mountain', accent:'#ccd6e1', mark:'#8d9aa9', mote:'#e9eef5'},
    8:{id:'city', accent:'#9ca8ba', mark:'#697484', mote:'#c9d6e8'},
    volcano:{id:'volcano', accent:'#ff8c45', mark:'#b74f2d', mote:'#ffc26c'}
  };
  const MOON_CRATERS=[
    {x:-0.34,y:-0.32,rx:0.14,ry:0.10,a:0.18},
    {x:0.18,y:-0.34,rx:0.10,ry:0.08,a:0.16},
    {x:0.38,y:-0.05,rx:0.15,ry:0.11,a:0.18},
    {x:-0.18,y:0.10,rx:0.12,ry:0.09,a:0.14},
    {x:0.08,y:0.34,rx:0.18,ry:0.11,a:0.13},
    {x:-0.46,y:0.24,rx:0.08,ry:0.06,a:0.12},
    {x:0.02,y:-0.04,rx:0.07,ry:0.05,a:0.10}
  ];
  const MOON_PHASES=8;
  const SUN_SEASON_STYLES={
    spring:{core:'#ffeaa2',edge:'#fff8cc',halo:'#ffe59a',accent:'#8bdc86',ray:'#ffe18a',shade:'#9d7133',mark:'#d8a94b',mote:'#eaffb8',heat:0.74,size:1.00},
    summer:{core:'#ffd66a',edge:'#fff0a6',halo:'#ffc154',accent:'#ff9f42',ray:'#ffd25f',shade:'#9a4d1f',mark:'#d97727',mote:'#ffe18d',heat:1,size:1.18},
    autumn:{core:'#ffc47a',edge:'#ffe5ad',halo:'#d98942',accent:'#d7733e',ray:'#f29a4e',shade:'#7d4230',mark:'#b65f32',mote:'#ffbd75',heat:0.66,size:1.04},
    winter:{core:'#fff0c9',edge:'#fffceb',halo:'#dff4ff',accent:'#bfeeff',ray:'#fff2bc',shade:'#746b5f',mark:'#b8c3c8',mote:'#f6fbff',heat:0.42,size:0.82},
    off:{core:'#ffe59a',edge:'#fff4c2',halo:'#ffd170',accent:'#ffc268',ray:'#ffd878',shade:'#865a29',mark:'#c08334',mote:'#fff0aa',heat:0.72,size:1.00}
  };
  const SUN_BIOME_STYLES={
    0:{id:'forest', accent:'#9be37d', mark:'#78b85d', mote:'#d4ff9a'},
    1:{id:'plains', accent:'#d9dc78', mark:'#b4ad4d', mote:'#fbf6a2'},
    2:{id:'snow', accent:'#d4f7ff', mark:'#aacfe1', mote:'#ffffff'},
    3:{id:'desert', accent:'#f2bd64', mark:'#cb7f35', mote:'#ffe09a'},
    4:{id:'swamp', accent:'#94c98e', mark:'#639a73', mote:'#c3ffad'},
    5:{id:'sea', accent:'#70d5ff', mark:'#4aa4d2', mote:'#baf0ff'},
    6:{id:'lake', accent:'#80e2ed', mark:'#58afbf', mote:'#c7fbff'},
    7:{id:'mountain', accent:'#d4d4c9', mark:'#9b9c91', mote:'#f4f0db'},
    8:{id:'city', accent:'#b8c0ca', mark:'#7d8795', mote:'#e0e5ef'},
    volcano:{id:'volcano', accent:'#ff6938', mark:'#bd3f28', mote:'#ffba62'}
  };
  const SUN_SPOTS=[
    {x:-0.44,y:-0.30,rx:0.070,ry:0.035,a:0.09,rot:-0.45},
    {x:0.30,y:-0.08,rx:0.115,ry:0.050,a:0.12,rot:0.30},
    {x:-0.18,y:0.18,rx:0.055,ry:0.030,a:0.08,rot:0.72},
    {x:0.08,y:0.40,rx:0.135,ry:0.052,a:0.10,rot:-0.18},
    {x:0.48,y:0.24,rx:0.052,ry:0.030,a:0.07,rot:0.62}
  ];
  function finite(v,fallback){ return Number.isFinite(+v) ? +v : fallback; }
  function currentSeasonMetrics(){
    const seasons=window.MM && window.MM.seasons;
    if(!seasons || typeof seasons.metrics!=='function') return null;
    try{ return seasons.metrics() || null; }catch(e){ return null; }
  }
  function seasonTintSpec(id){ return SEASON_TINTS[id] || null; }
  function blendSeasonTint(a,b,t){
    if(!a) return b || null;
    if(!b) return a || null;
    const u=clamp(finite(t,0),0,1);
    return {color:lerpColor(a.color,b.color,u),alpha:lerp(a.alpha,b.alpha,u)};
  }
  function seasonVisualTint(metrics){
    const m=metrics || currentSeasonMetrics();
    if(!m || !m.season) return null;
    const current=seasonTintSpec(m.season) || seasonTintSpec(m.to) || seasonTintSpec(m.from);
    if(!current) return null;
    const transition = !!(m.transition && m.from && m.to && m.from!==m.to);
    let spec=current;
    if(transition){
      spec=blendSeasonTint(seasonTintSpec(m.from),seasonTintSpec(m.to),m.blend) || current;
    }
    let alpha=finite(spec.alpha,0.02);
    alpha += finite(m.snowStrength,0) * 0.014;
    alpha += finite(m.leafDropStrength,0) * 0.005;
    alpha += finite(m.leafGrowStrength,0) * 0.003;
    alpha *= transition ? 0.92 : 1;
    alpha *= (lastCycleInfo && lastCycleInfo.isDay) ? 1 : 0.68;
    alpha=clamp(alpha,0,0.075);
    if(alpha<=0.001) return null;
    return {
      color:spec.color,
      alpha:+alpha.toFixed(4),
      season:m.season,
      from:m.from || m.season,
      to:m.to || m.season,
      blend:+clamp(finite(m.blend,1),0,1).toFixed(4),
      transition
    };
  }
  function blendMoonStyle(a,b,t){
    if(!a) return b || MOON_SEASON_STYLES.off;
    if(!b || t<=0) return a;
    if(t>=1) return b;
    const u=clamp(finite(t,0),0,1);
    return {
      core:lerpColor(a.core,b.core,u),
      edge:lerpColor(a.edge,b.edge,u),
      halo:lerpColor(a.halo,b.halo,u),
      accent:lerpColor(a.accent,b.accent,u),
      shade:lerpColor(a.shade,b.shade,u),
      mark:lerpColor(a.mark,b.mark,u),
      mote:lerpColor(a.mote,b.mote,u)
    };
  }
  function moonSeasonStyle(metrics){
    const m=metrics || currentSeasonMetrics();
    const id=(m && m.season && MOON_SEASON_STYLES[m.season]) ? m.season : 'off';
    let spec=MOON_SEASON_STYLES[id] || MOON_SEASON_STYLES.off;
    if(m && m.transition && m.from && m.to && m.from!==m.to){
      spec=blendMoonStyle(MOON_SEASON_STYLES[m.from],MOON_SEASON_STYLES[m.to],m.blend) || spec;
    }
    return {id,spec,metrics:m || null};
  }
  function moonWorldStyle(blend){
    const volcano=blend && blend.volcano ? blend.volcano : null;
    if(volcano && volcano.amount>0.16) return Object.assign({amount:clamp(volcano.amount,0,1)},MOON_BIOME_STYLES.volcano);
    if(blend && blend.city>0.45) return Object.assign({amount:clamp(blend.city,0,1)},MOON_BIOME_STYLES[8]);
    const id=blend && Number.isFinite(blend.a) ? (blend.a|0) : 0;
    return Object.assign({amount:1},MOON_BIOME_STYLES[id] || MOON_BIOME_STYLES[0]);
  }
  function moonDayNumber(metrics){
    if(metrics && Number.isFinite(+metrics.dayFloat)) return +metrics.dayFloat;
    if(metrics && Number.isFinite(+metrics.day)) return +metrics.day;
    if(metrics && Number.isFinite(+metrics.seasonDay) && Number.isFinite(+metrics.seasonIndex)) return +metrics.seasonIndex*10 + +metrics.seasonDay;
    return NaN;
  }
  function moonPhaseFromCalendar(metrics,WORLDGEN,cycleIndex){
    const day=moonDayNumber(metrics);
    if(Number.isFinite(day)){
      const seed=WORLDGEN && Number.isFinite(WORLDGEN.worldSeed) ? Math.abs(WORLDGEN.worldSeed|0) : 0;
      const seasonOffset={spring:0,summer:2,autumn:4,winter:6,off:0}[(metrics && metrics.season) || 'off'] || 0;
      return (((Math.floor(day-1)+seasonOffset+(seed%MOON_PHASES))%MOON_PHASES)+MOON_PHASES)%MOON_PHASES;
    }
    if(cycleIndex !== lastPhaseCycle){
      lastPhaseCycle=cycleIndex;
      moonPhaseIndex=(moonPhaseIndex+1)%MOON_PHASES;
    }
    return moonPhaseIndex;
  }
  function moonStateForDraw(cycleT,metrics,blend,WORLDGEN,now,playerX){
    const season=moonSeasonStyle(metrics);
    const world=moonWorldStyle(blend);
    const cycleIndex=Math.floor((now-cycleStart)/CYCLE_DURATION);
    const phaseIndex=moonPhaseFromCalendar(season.metrics,WORLDGEN,cycleIndex);
    moonPhaseIndex=phaseIndex;
    const phaseT=phaseIndex/MOON_PHASES;
    const illumination=clamp(0.5-0.5*Math.cos(phaseT*Math.PI*2),0,1);
    const seasonal=season.spec || MOON_SEASON_STYLES.off;
    const style=Object.assign({},seasonal,{
      accent:blendColor(seasonal.accent,world.accent,0.34),
      mark:blendColor(seasonal.mark,world.mark,0.28),
      mote:blendColor(seasonal.mote,world.mote,0.34),
      halo:blendColor(seasonal.halo,world.accent,0.18)
    });
    return {
      season:season.id,
      transition:!!(season.metrics && season.metrics.transition),
      world:world.id,
      worldAmount:+finite(world.amount,1).toFixed(3),
      phaseIndex,
      phaseT:+phaseT.toFixed(4),
      illumination:+illumination.toFixed(4),
      cycleT:+(((cycleT%1)+1)%1).toFixed(4),
      day:Number.isFinite(moonDayNumber(season.metrics)) ? +moonDayNumber(season.metrics).toFixed(3) : null,
      playerX:finite(playerX,0),
      core:style.core,
      edge:style.edge,
      halo:style.halo,
      accent:style.accent,
      shade:style.shade,
      mark:style.mark,
      mote:style.mote
    };
  }
  function blendSunStyle(a,b,t){
    if(!a) return b || SUN_SEASON_STYLES.off;
    if(!b || t<=0) return a;
    if(t>=1) return b;
    const u=clamp(finite(t,0),0,1);
    return {
      core:lerpColor(a.core,b.core,u),
      edge:lerpColor(a.edge,b.edge,u),
      halo:lerpColor(a.halo,b.halo,u),
      accent:lerpColor(a.accent,b.accent,u),
      ray:lerpColor(a.ray,b.ray,u),
      shade:lerpColor(a.shade,b.shade,u),
      mark:lerpColor(a.mark,b.mark,u),
      mote:lerpColor(a.mote,b.mote,u),
      heat:lerp(finite(a.heat,0.7),finite(b.heat,0.7),u),
      size:lerp(finite(a.size,1),finite(b.size,1),u)
    };
  }
  function sunSeasonStyle(metrics){
    const m=metrics || currentSeasonMetrics();
    const id=(m && m.season && SUN_SEASON_STYLES[m.season]) ? m.season : 'off';
    let spec=SUN_SEASON_STYLES[id] || SUN_SEASON_STYLES.off;
    if(m && m.transition && m.from && m.to && m.from!==m.to){
      spec=blendSunStyle(SUN_SEASON_STYLES[m.from],SUN_SEASON_STYLES[m.to],m.blend) || spec;
    }
    return {id,spec,metrics:m || null};
  }
  function sunWorldStyle(blend){
    const volcano=blend && blend.volcano ? blend.volcano : null;
    if(volcano && volcano.amount>0.16) return Object.assign({amount:clamp(volcano.amount,0,1)},SUN_BIOME_STYLES.volcano);
    if(blend && blend.city>0.45) return Object.assign({amount:clamp(blend.city,0,1)},SUN_BIOME_STYLES[8]);
    const id=blend && Number.isFinite(blend.a) ? (blend.a|0) : 0;
    return Object.assign({amount:1},SUN_BIOME_STYLES[id] || SUN_BIOME_STYLES[0]);
  }
  function sunStateForDraw(cycleT,metrics,blend,WORLDGEN,now,playerX,tDay){
    const season=sunSeasonStyle(metrics);
    const world=sunWorldStyle(blend);
    const seasonal=season.spec || SUN_SEASON_STYLES.off;
    const daylight=clamp(Math.sin(clamp(finite(tDay,0.5),0,1)*Math.PI),0,1);
    const edgeWarmth=1-smoothstep(0.08,0.45,Math.min(clamp(finite(tDay,0.5),0,1),1-clamp(finite(tDay,0.5),0,1)));
    const heat=clamp(finite(seasonal.heat,0.72)*(0.62+0.38*daylight),0.16,1.12);
    const style=Object.assign({},seasonal,{
      accent:blendColor(seasonal.accent,world.accent,0.38),
      mark:blendColor(seasonal.mark,world.mark,0.30),
      mote:blendColor(seasonal.mote,world.mote,0.30),
      halo:blendColor(seasonal.halo,world.accent,0.18),
      core:blendColor(seasonal.core,edgeWarmth>0.01?'#ffd18a':seasonal.core,edgeWarmth*0.25),
      ray:blendColor(seasonal.ray,edgeWarmth>0.01?'#ff9f56':seasonal.ray,edgeWarmth*0.22)
    });
    return {
      season:season.id,
      transition:!!(season.metrics && season.metrics.transition),
      world:world.id,
      worldAmount:+finite(world.amount,1).toFixed(3),
      daylight:+daylight.toFixed(4),
      edgeWarmth:+edgeWarmth.toFixed(4),
      heat:+heat.toFixed(4),
      cycleT:+(((cycleT%1)+1)%1).toFixed(4),
      day:Number.isFinite(moonDayNumber(season.metrics)) ? +moonDayNumber(season.metrics).toFixed(3) : null,
      playerX:finite(playerX,0),
      core:style.core,
      edge:style.edge,
      halo:style.halo,
      accent:style.accent,
      ray:style.ray,
      shade:style.shade,
      mark:style.mark,
      mote:style.mote,
      sizeScale:+clamp(finite(style.size,1),0.72,1.28).toFixed(4)
    };
  }
  function sunRadiusForState(W,state){
    const base=clamp(W*0.050,34,58);
    return clamp(base*finite(state && state.sizeScale,1),28,72);
  }
  function redDwarfSeedOffset(WORLDGEN){
    const seed=WORLDGEN && Number.isFinite(+WORLDGEN.worldSeed) ? (+WORLDGEN.worldSeed|0) : 0;
    return mountainHash(seed,7919)*0.72+0.11;
  }
  function redDwarfPhaseFromElapsed(elapsedCycles,WORLDGEN){
    const cycles=Number.isFinite(+elapsedCycles) ? +elapsedCycles : 0;
    return (((cycles/RED_DWARF_PERIOD_CYCLES)+redDwarfSeedOffset(WORLDGEN))%1+1)%1;
  }
  function redDwarfSkyAlpha(cycleT){
    const t=((Number.isFinite(+cycleT) ? +cycleT : 0.75)%1+1)%1;
    const isDay=t<DAY_FRAC;
    const tDay=isDay ? t/DAY_FRAC : ((t-DAY_FRAC)/(1-DAY_FRAC));
    const edge=smoothstep(0,TWILIGHT_BAND*1.5,tDay)*smoothstep(0,TWILIGHT_BAND*1.5,1-tDay);
    return isDay ? lerp(0.38,0.20,edge) : 0.88;
  }
  function redDwarfStateForElapsed(elapsedCycles,cycleT,W,H,WORLDGEN,blend){
    const phase=redDwarfPhaseFromElapsed(elapsedCycles,WORLDGEN);
    const p=redDwarfPosition(phase,W,H);
    const volcano=blend && blend.volcano && blend.volcano.amount>0.12;
    const city=blend && blend.city>0.42;
    const tint=volcano ? '#ff5f3d' : (city ? '#ff7a63' : '#d64235');
    const core=volcano ? '#ffd0a1' : '#ffb18b';
    return {
      kind:'redDwarf',
      periodCycles:RED_DWARF_PERIOD_CYCLES,
      phase:+phase.toFixed(5),
      x:+p.x.toFixed(3),
      y:+p.y.toFixed(3),
      angle:+p.angle.toFixed(6),
      radius:+clamp(W*0.019,13,25).toFixed(3),
      alpha:+redDwarfSkyAlpha(cycleT).toFixed(4),
      core,
      color:tint,
      halo:volcano ? '#ff421d' : '#b91f2d',
      mark:city ? '#6e1d2a' : '#5b1219'
    };
  }
  function redDwarfStateForDraw(cycleT,now,W,H,WORLDGEN,blend){
    const elapsedCycles=(now-cycleStart)/CYCLE_DURATION;
    return redDwarfStateForElapsed(elapsedCycles,cycleT,W,H,WORLDGEN,blend);
  }
  function strokeCircle(ctx,x,y,r,color,alpha,lineWidth){
    ctx.save();
    ctx.globalAlpha*=alpha;
    ctx.strokeStyle=color;
    ctx.lineWidth=lineWidth;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
  function drawRedDwarfObject(ctx,W,H,state,now){
    if(!state || state.alpha<=0.01) return;
    const cx=state.x, cy=state.y, r=state.radius;
    const horizonFade=clamp((H*1.08-cy)/(H*0.30),0,1);
    if(horizonFade<=0.01 || cy<-r*5 || cy>H+r*5) return;
    const pulse=0.5+0.5*Math.sin(now*0.0011+state.phase*Math.PI*2);
    const drawAlpha=state.alpha*horizonFade;
    ctx.save();
    ctx.globalAlpha*=drawAlpha;
    const haloR=r*(3.05+0.34*pulse);
    const halo=ctx.createRadialGradient(cx,cy,r*0.18,cx,cy,haloR);
    halo.addColorStop(0,hexToRgba(state.core,0.42));
    halo.addColorStop(0.30,hexToRgba(state.color,0.22));
    halo.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=halo;
    ctx.beginPath();
    ctx.arc(cx,cy,haloR,0,Math.PI*2);
    ctx.fill();

    ctx.strokeStyle=hexToRgba(state.halo,0.20+0.08*pulse);
    ctx.lineWidth=Math.max(1,r*0.045);
    ctx.beginPath();
    ctx.arc(cx,cy,r*(1.52+0.05*pulse),Math.PI*0.08,Math.PI*1.68);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx,cy,r*(1.18+0.04*pulse),Math.PI*1.18,Math.PI*2.42);
    ctx.stroke();

    const body=ctx.createRadialGradient(cx-r*0.34,cy-r*0.36,r*0.06,cx+r*0.18,cy+r*0.20,r*1.05);
    body.addColorStop(0,state.core);
    body.addColorStop(0.44,state.color);
    body.addColorStop(1,'#5a1018');
    ctx.fillStyle=body;
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fill();
    strokeCircle(ctx,cx,cy,r,state.core,0.42,Math.max(1,r*0.035));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r*0.94,0,Math.PI*2);
    ctx.clip();
    ctx.strokeStyle=hexToRgba(state.mark,0.26);
    ctx.lineWidth=Math.max(1,r*0.030);
    for(let i=0;i<3;i++){
      const wobble=Math.sin(now*0.0007+i*2.1)*0.035;
      ctx.beginPath();
      ctx.moveTo(cx-r*(0.58-0.09*i),cy+r*(-0.32+i*0.25+wobble));
      ctx.quadraticCurveTo(cx-r*0.10,cy+r*(-0.40+i*0.19-wobble),cx+r*(0.42+0.05*i),cy+r*(-0.25+i*0.23+wobble*0.5));
      ctx.stroke();
    }
    ctx.fillStyle=hexToRgba(state.mark,0.24);
    const spots=[
      [-0.36,-0.12,0.090],
      [0.14,-0.34,0.060],
      [0.38,0.18,0.075],
      [-0.08,0.36,0.050]
    ];
    for(const s of spots){
      ctx.beginPath();
      ctx.arc(cx+s[0]*r,cy+s[1]*r,s[2]*r,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }
  function drawSunMotes(ctx,cx,cy,r,state,now){
    const n=state.world==='volcano' ? 11 : (state.season==='summer' ? 10 : 8);
    ctx.save();
    const baseAlpha=ctx.globalAlpha;
    for(let i=0;i<n;i++){
      const orbit=r*(1.25+0.32*((i%4)/3));
      const a=now*0.00032*(i%2?-1:1)+i*Math.PI*2/n+state.heat*0.7;
      const x=cx+Math.cos(a)*orbit;
      const y=cy+Math.sin(a)*orbit*(0.78+0.08*Math.sin(i));
      const tw=0.55+0.45*Math.sin(now*0.0017+i*1.37);
      ctx.globalAlpha=baseAlpha*(0.10+0.20*tw)*(0.75+0.25*state.daylight);
      ctx.fillStyle=i%3===0 ? state.accent : state.mote;
      ctx.beginPath();
      ctx.arc(x,y,r*(0.014+0.010*(i%2)),0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawSunCorona(ctx,cx,cy,r,state,now){
    const rays=state.season==='winter' ? 14 : 18;
    ctx.save();
    ctx.strokeStyle=hexToRgba(state.ray,0.18+0.10*state.heat);
    ctx.lineWidth=Math.max(1,r*0.022);
    for(let i=0;i<rays;i++){
      const a=i*Math.PI*2/rays+now*0.00010*(i%2?-1:1);
      const wobble=0.5+0.5*Math.sin(now*0.0015+i*0.91);
      const inner=r*(0.94+0.03*wobble);
      const outer=r*(1.28+0.26*wobble*state.heat);
      ctx.globalAlpha=0.26+0.28*wobble;
      ctx.beginPath();
      ctx.moveTo(cx+Math.cos(a)*inner,cy+Math.sin(a)*inner);
      ctx.lineTo(cx+Math.cos(a)*outer,cy+Math.sin(a)*outer);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawSunSeasonAura(ctx,cx,cy,r,state,now){
    ctx.save();
    ctx.strokeStyle=hexToRgba(state.accent,0.28);
    ctx.fillStyle=hexToRgba(state.accent,0.22);
    ctx.lineWidth=Math.max(1,r*0.018);
    if(state.season==='spring'){
      for(let i=0;i<6;i++){
        const a=-Math.PI*0.92+i*Math.PI*0.16+Math.sin(now*0.0007+i)*0.025;
        const x=cx+Math.cos(a)*r*0.98;
        const y=cy+Math.sin(a)*r*0.98;
        ctx.beginPath();
        ctx.ellipse(x,y,r*0.05,r*0.105,a+Math.PI*0.5,0,Math.PI*2);
        ctx.fill();
      }
    } else if(state.season==='summer'){
      ctx.strokeStyle=hexToRgba(state.accent,0.34);
      for(let i=0;i<8;i++){
        const a=i*Math.PI*2/8+now*0.00016;
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(a)*r*1.09,cy+Math.sin(a)*r*1.09);
        ctx.quadraticCurveTo(
          cx+Math.cos(a+0.08)*r*1.22,
          cy+Math.sin(a+0.08)*r*1.22,
          cx+Math.cos(a+0.14)*r*1.34,
          cy+Math.sin(a+0.14)*r*1.34
        );
        ctx.stroke();
      }
    } else if(state.season==='autumn'){
      for(let i=0;i<5;i++){
        const a=Math.PI*0.54+i*0.21+Math.sin(now*0.0008+i)*0.05;
        const x=cx+Math.cos(a)*r*1.04;
        const y=cy+Math.sin(a)*r*1.04;
        ctx.beginPath();
        ctx.ellipse(x,y,r*0.055,r*0.115,a,0,Math.PI*2);
        ctx.fill();
      }
    } else if(state.season==='winter'){
      for(let i=0;i<8;i++){
        const a=i*Math.PI*2/8+now*0.00006;
        const x=cx+Math.cos(a)*r*1.06;
        const y=cy+Math.sin(a)*r*1.06;
        ctx.beginPath();
        ctx.moveTo(x-r*0.055,y);
        ctx.lineTo(x+r*0.055,y);
        ctx.moveTo(x,y-r*0.055);
        ctx.lineTo(x,y+r*0.055);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawSunSurfaceMarks(ctx,cx,cy,r,state,now){
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r*0.96,0,Math.PI*2);
    ctx.clip();
    for(const s of SUN_SPOTS){
      const x=cx+s.x*r+Math.sin(now*0.00035+s.x*7)*r*0.018;
      const y=cy+s.y*r+Math.cos(now*0.00032+s.y*9)*r*0.012;
      ctx.fillStyle=hexToRgba(state.shade,s.a*(0.78+0.35*state.heat));
      ctx.beginPath();
      ctx.ellipse(x,y,s.rx*r,s.ry*r,s.rot || 0,0,Math.PI*2);
      ctx.fill();
    }
    ctx.strokeStyle=hexToRgba(state.mark,0.12+0.07*state.heat);
    ctx.lineWidth=Math.max(1,r*0.014);
    const filaments=[
      [-0.58,-0.38,-0.26,-0.48,0.08,-0.34],
      [0.02,-0.22,0.34,-0.30,0.60,-0.14],
      [-0.52,0.02,-0.18,-0.07,0.18,0.05],
      [-0.20,0.31,0.10,0.24,0.48,0.34],
      [-0.64,0.42,-0.42,0.34,-0.12,0.43]
    ];
    for(let i=0;i<filaments.length;i++){
      const f=filaments[i];
      const wobble=Math.sin(now*0.00042+i*1.7)*0.018;
      ctx.beginPath();
      ctx.moveTo(cx+r*f[0],cy+r*(f[1]+wobble));
      ctx.quadraticCurveTo(cx+r*f[2],cy+r*(f[3]-wobble),cx+r*f[4],cy+r*(f[5]+wobble*0.7));
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawSunWorldMarks(ctx,cx,cy,r,state,now){
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r*0.94,0,Math.PI*2);
    ctx.clip();
    ctx.strokeStyle=hexToRgba(state.mark,0.22);
    ctx.fillStyle=hexToRgba(state.mark,0.20);
    ctx.lineWidth=Math.max(1,r*0.017);
    if(state.world==='sea' || state.world==='lake'){
      for(let i=0;i<3;i++){
        const y=cy+r*(0.08+i*0.16);
        ctx.beginPath();
        ctx.moveTo(cx-r*0.52,y);
        ctx.quadraticCurveTo(cx-r*0.23,y-r*0.05,cx+r*0.03,y);
        ctx.quadraticCurveTo(cx+r*0.25,y+r*0.05,cx+r*0.52,y-r*0.01);
        ctx.stroke();
      }
    } else if(state.world==='desert'){
      for(let i=0;i<18;i++){
        const a=i*2.12+state.heat;
        const rr=r*(0.18+0.62*((i*41)%89)/89);
        ctx.fillRect(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,r*0.018,r*0.018);
      }
    } else if(state.world==='city'){
      const baseAlpha=ctx.globalAlpha;
      for(let i=0;i<5;i++){
        const x=cx-r*0.46+i*r*0.23;
        ctx.globalAlpha=baseAlpha*0.45;
        ctx.beginPath();
        ctx.moveTo(x,cy-r*0.48);
        ctx.lineTo(x+r*0.03*Math.sin(now*0.001+i),cy+r*0.46);
        ctx.stroke();
      }
    } else if(state.world==='volcano'){
      const g=ctx.createRadialGradient(cx,cy+r*0.46,r*0.02,cx,cy+r*0.42,r*0.52);
      g.addColorStop(0,hexToRgba('#ff5931',0.26));
      g.addColorStop(0.55,hexToRgba('#ff9a45',0.12));
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;
      ctx.fillRect(cx-r,cy-r*0.05,r*2,r);
    } else if(state.world==='mountain' || state.world==='snow'){
      for(let i=0;i<3;i++){
        const x=cx-r*0.35+i*r*0.28;
        ctx.beginPath();
        ctx.moveTo(x,cy+r*0.46);
        ctx.lineTo(x+r*0.14,cy+r*0.12);
        ctx.lineTo(x+r*0.30,cy+r*0.46);
        ctx.stroke();
      }
    } else if(state.world==='forest'){
      for(let i=0;i<4;i++){
        const a=-0.7+i*0.34;
        const x=cx+Math.cos(a)*r*0.50;
        const y=cy+Math.sin(a)*r*0.40;
        ctx.beginPath();
        ctx.ellipse(x,y,r*0.035,r*0.075,a,0,Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawSunObject(ctx,W,H,sun,r,alpha,state,now){
    if(alpha<=0.01) return;
    const cx=sun.x, cy=Math.max(sun.y,Math.min(H*0.28,r+46));
    const horizonFade=clamp((H*1.06-cy)/(H*0.30),0,1);
    const drawAlpha=alpha*horizonFade;
    if(drawAlpha<=0.01) return;
    const pulse=0.5+0.5*Math.sin(now*0.0018+state.heat*2.1);
    ctx.save();
    ctx.globalAlpha*=drawAlpha;
    const haloR=r*(2.12+0.42*state.heat+0.12*pulse);
    const halo=ctx.createRadialGradient(cx,cy,r*0.24,cx,cy,haloR);
    halo.addColorStop(0,hexToRgba(state.halo,0.34));
    halo.addColorStop(0.36,hexToRgba(state.ray,0.15));
    halo.addColorStop(1,hexToRgba(state.ray,0));
    ctx.fillStyle=halo;
    ctx.beginPath();
    ctx.arc(cx,cy,haloR,0,Math.PI*2);
    ctx.fill();
    drawSunMotes(ctx,cx,cy,r,state,now);
    drawSunCorona(ctx,cx,cy,r,state,now);
    drawSunSeasonAura(ctx,cx,cy,r,state,now);
    const body=ctx.createRadialGradient(cx-r*0.34,cy-r*0.38,r*0.08,cx+r*0.18,cy+r*0.22,r*1.02);
    body.addColorStop(0,state.edge);
    body.addColorStop(0.48,state.core);
    body.addColorStop(1,blendColor(state.core,state.accent,0.18));
    ctx.fillStyle=body;
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fill();
    strokeCircle(ctx,cx,cy,r,state.edge,0.56,Math.max(1,r*0.028));
    strokeCircle(ctx,cx,cy,r*0.82,state.ray,0.16,Math.max(1,r*0.012));
    drawSunSurfaceMarks(ctx,cx,cy,r,state,now);
    drawSunWorldMarks(ctx,cx,cy,r,state,now);
    ctx.restore();
  }
  function drawMoonMotes(ctx,cx,cy,r,state,now){
    const n=state.season==='winter' ? 9 : (state.world==='volcano' ? 8 : 7);
    ctx.save();
    for(let i=0;i<n;i++){
      const orbit=r*(1.38+0.18*((i%3)/2));
      const a=now*0.00018*(i%2?-1:1)+i*Math.PI*2/n+state.phaseIndex*0.21;
      const x=cx+Math.cos(a)*orbit;
      const y=cy+Math.sin(a)*orbit*0.62;
      const tw=0.55+0.45*Math.sin(now*0.0011+i*1.7);
      ctx.globalAlpha=0.16+0.22*tw;
      ctx.fillStyle=i%3===0 ? state.accent : state.mote;
      ctx.beginPath();
      ctx.arc(x,y,r*(0.015+0.008*(i%2)),0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawMoonSeasonAura(ctx,cx,cy,r,state,now){
    ctx.save();
    ctx.strokeStyle=hexToRgba(state.accent,0.35);
    ctx.fillStyle=hexToRgba(state.accent,0.28);
    ctx.lineWidth=Math.max(1,r*0.025);
    if(state.season==='winter'){
      for(let i=0;i<6;i++){
        const a=-Math.PI*0.9+i*Math.PI/5+Math.sin(now*0.0006+i)*0.025;
        const x=cx+Math.cos(a)*r*1.02;
        const y=cy+Math.sin(a)*r*1.02;
        ctx.beginPath();
        ctx.moveTo(x,y-r*0.10);
        ctx.lineTo(x,y+r*0.10);
        ctx.moveTo(x-r*0.08,y);
        ctx.lineTo(x+r*0.08,y);
        ctx.stroke();
      }
    } else if(state.season==='spring'){
      for(let i=0;i<5;i++){
        const a=-Math.PI*0.84+i*0.23;
        const x=cx+Math.cos(a)*r*0.98;
        const y=cy+Math.sin(a)*r*0.98;
        ctx.beginPath();
        ctx.ellipse(x,y,r*0.055,r*0.11,a+Math.PI*0.5,0,Math.PI*2);
        ctx.fill();
      }
    } else if(state.season==='summer'){
      for(let i=0;i<12;i++){
        const a=i*Math.PI*2/12+now*0.00008;
        const inner=r*1.05, outer=r*(1.16+0.04*Math.sin(now*0.001+i));
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(a)*inner,cy+Math.sin(a)*inner);
        ctx.lineTo(cx+Math.cos(a)*outer,cy+Math.sin(a)*outer);
        ctx.stroke();
      }
    } else if(state.season==='autumn'){
      for(let i=0;i<4;i++){
        const a=Math.PI*0.58+i*0.24+Math.sin(now*0.0007+i)*0.04;
        const x=cx+Math.cos(a)*r*1.03;
        const y=cy+Math.sin(a)*r*1.03;
        ctx.beginPath();
        ctx.ellipse(x,y,r*0.06,r*0.13,a,0,Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x-r*0.03,y-r*0.01);
        ctx.lineTo(x+r*0.05,y+r*0.06);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawMoonCraters(ctx,cx,cy,r,state){
    ctx.save();
    for(const c of MOON_CRATERS){
      const x=cx+c.x*r, y=cy+c.y*r;
      ctx.fillStyle=hexToRgba(state.shade,c.a);
      ctx.beginPath();
      ctx.ellipse(x,y,c.rx*r,c.ry*r,0.22,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle=hexToRgba(state.edge,0.09);
      ctx.lineWidth=Math.max(0.75,r*0.012);
      ctx.beginPath();
      ctx.ellipse(x-c.rx*r*0.14,y-c.ry*r*0.18,c.rx*r*0.84,c.ry*r*0.74,0.22,0,Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawMoonWorldMarks(ctx,cx,cy,r,state,now){
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r*0.95,0,Math.PI*2);
    ctx.clip();
    ctx.strokeStyle=hexToRgba(state.mark,0.22);
    ctx.lineWidth=Math.max(1,r*0.018);
    if(state.world==='sea' || state.world==='lake'){
      for(let i=0;i<4;i++){
        const y=cy-r*0.12+i*r*0.15;
        ctx.beginPath();
        ctx.moveTo(cx-r*0.52,y);
        ctx.quadraticCurveTo(cx-r*0.20,y-r*0.06,cx+r*0.08,y);
        ctx.quadraticCurveTo(cx+r*0.30,y+r*0.05,cx+r*0.54,y-r*0.01);
        ctx.stroke();
      }
    } else if(state.world==='city'){
      for(let i=0;i<5;i++){
        const y=cy-r*0.42+i*r*0.20;
        ctx.globalAlpha=0.42;
        ctx.beginPath();
        ctx.moveTo(cx-r*0.66,y);
        ctx.lineTo(cx+r*0.66,y+Math.sin(now*0.001+i)*r*0.018);
        ctx.stroke();
      }
    } else if(state.world==='volcano'){
      const g=ctx.createRadialGradient(cx,cy+r*0.62,r*0.02,cx,cy+r*0.62,r*0.56);
      g.addColorStop(0,hexToRgba('#ff9b45',0.28));
      g.addColorStop(0.46,hexToRgba('#ff6a2c',0.12));
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;
      ctx.fillRect(cx-r,cy,r*2,r);
      ctx.fillStyle=hexToRgba(state.mote,0.45);
      for(let i=0;i<5;i++){
        const x=cx-r*0.42+i*r*0.21;
        const y=cy+r*(0.34+0.08*Math.sin(now*0.002+i));
        ctx.fillRect(x,y,r*0.035,r*0.05);
      }
    } else if(state.world==='desert'){
      ctx.fillStyle=hexToRgba(state.mark,0.20);
      for(let i=0;i<16;i++){
        const a=i*2.399;
        const rr=r*(0.16+0.67*((i*37)%97)/97);
        ctx.fillRect(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,r*0.018,r*0.018);
      }
    } else if(state.world==='mountain' || state.world==='snow'){
      for(let i=0;i<4;i++){
        const x=cx-r*0.42+i*r*0.25;
        ctx.beginPath();
        ctx.moveTo(x,cy+r*0.45);
        ctx.lineTo(x+r*0.13,cy+r*0.05);
        ctx.lineTo(x+r*0.28,cy+r*0.43);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawMoonObject(ctx,W,H,moon,r,alpha,state,now){
    if(alpha<=0.01) return;
    const cx=moon.x, cy=Math.max(moon.y,Math.min(H*0.30,r+48));
    const horizonFade=clamp((H*1.05-cy)/(H*0.34),0,1);
    const drawAlpha=alpha*horizonFade;
    if(drawAlpha<=0.01) return;
    const pulse=0.5+0.5*Math.sin(now*0.0014+state.phaseIndex*0.73);
    ctx.save();
    ctx.globalAlpha*=drawAlpha;
    const haloR=r*(2.02+0.18*pulse+(state.season==='winter'?0.18:0));
    const halo=ctx.createRadialGradient(cx,cy,r*0.32,cx,cy,haloR);
    halo.addColorStop(0,hexToRgba(state.halo,0.34));
    halo.addColorStop(0.42,hexToRgba(state.accent,0.13));
    halo.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=halo;
    ctx.beginPath();
    ctx.arc(cx,cy,haloR,0,Math.PI*2);
    ctx.fill();
    drawMoonMotes(ctx,cx,cy,r,state,now);
    drawMoonSeasonAura(ctx,cx,cy,r,state,now);
    const body=ctx.createRadialGradient(cx-r*0.34,cy-r*0.42,r*0.10,cx+r*0.16,cy+r*0.20,r*1.04);
    body.addColorStop(0,state.edge);
    body.addColorStop(0.48,state.core);
    body.addColorStop(1,blendColor(state.core,state.shade,0.34));
    ctx.fillStyle=body;
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fill();
    strokeCircle(ctx,cx,cy,r,state.edge,0.48,Math.max(1,r*0.030));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r*0.98,0,Math.PI*2);
    ctx.clip();
    const side=state.phaseT<0.5 ? -1 : 1;
    const shadeAlpha=0.10+0.34*(1-state.illumination);
    const phaseW=r*(0.74+0.52*state.illumination);
    const phaseX=cx+side*r*(state.illumination*0.98-0.12);
    ctx.fillStyle=hexToRgba(state.shade,shadeAlpha);
    ctx.beginPath();
    ctx.ellipse(phaseX,cy,phaseW,r*1.14,0,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle=hexToRgba(state.mark,0.16+0.12*(1-state.illumination));
    ctx.lineWidth=Math.max(1,r*0.018);
    ctx.beginPath();
    ctx.ellipse(phaseX,cy,phaseW,r*1.10,0,Math.PI*0.5,Math.PI*1.5);
    ctx.stroke();
    ctx.restore();
    drawMoonCraters(ctx,cx,cy,r,state);
    drawMoonWorldMarks(ctx,cx,cy,r,state,now);
    ctx.restore();
  }
  function computeCityInfluence(x,WORLDGEN){
    if(!WORLDGEN || !WORLDGEN.cityAt) return 0;
    let best=0;
    for(const off of [0,-80,80,-160,160,-260,260]){
      let city=null;
      try{ city=WORLDGEN.cityAt(Math.round(x+off)); }catch(e){ city=null; }
      if(!city) continue;
      const radius=(city.radius||180)+220;
      const d=Math.abs(x-city.center);
      best=Math.max(best, smoothstep(1,0,d/radius));
    }
    return best;
  }
  function computeVolcanoInfluence(x,WORLDGEN){
    const none={amount:0,center:null,distance:Infinity,radius:0};
    if(!WORLDGEN) return none;
    let best=none;
    const consider=(v)=>{
      if(!v || typeof v.center!=='number') return;
      const radius=Math.max(18,v.radius||0);
      const distance=Math.abs(x-v.center);
      const amount=smoothstep(1,0,distance/(radius+620));
      if(amount>best.amount) best={amount,center:v.center,distance,radius};
    };
    if(WORLDGEN.volcanoAt){
      for(const off of [0,-80,80,-180,180,-320,320,-520,520]){
        try{ consider(WORLDGEN.volcanoAt(Math.round(x+off))); }catch(e){}
      }
    }
    if(best.amount<0.04 && WORLDGEN.nearestVolcano){
      try{ consider(WORLDGEN.nearestVolcano(Math.round(x),-1,4)); }catch(e){}
      try{ consider(WORLDGEN.nearestVolcano(Math.round(x),1,4)); }catch(e){}
    }
    return best.amount>0.015 ? best : none;
  }
  const BIOME_RELIEF={0:0.44,1:0.34,2:0.56,3:0.25,4:0.28,5:0.14,6:0.18,7:0.86,8:0.20};
  function weightedBiomeRelief(weights,total){
    if(!weights || !total) return 0.46;
    let sum=0;
    for(const k of Object.keys(weights)) sum += (BIOME_RELIEF[k]!==undefined?BIOME_RELIEF[k]:0.42)*weights[k];
    return clamp(sum/total,0.12,1);
  }
  function computeDistantRelief(x,WORLDGEN,weights,total,volcano){
    let amount=weightedBiomeRelief(weights,total);
    if(WORLDGEN && WORLDGEN.column){
      let minRow=Infinity, maxRow=-Infinity, mountain=0, n=0;
      for(const off of [-520,-340,-180,0,180,340,520]){
        let c=null;
        try{ c=WORLDGEN.column(Math.round(x+off)); }catch(e){ c=null; }
        if(!c || typeof c.row!=='number') continue;
        minRow=Math.min(minRow,c.row);
        maxRow=Math.max(maxRow,c.row);
        n++;
        if(c.volcano) mountain=Math.max(mountain,0.98);
        else if(c.biome===7) mountain=Math.max(mountain,0.76);
        if(typeof c.mountainMask==='number') mountain=Math.max(mountain,clamp(c.mountainMask,0,1)*0.62);
      }
      if(n>=2){
        const relief=smoothstep(4,26,maxRow-minRow);
        amount=Math.max(amount*0.42+relief*0.48,mountain);
      }
    }
    if(volcano && volcano.amount>0.01) amount=Math.max(amount,0.82+0.18*volcano.amount);
    const cityShare=(weights && total) ? (weights[8]||0)/total : 0;
    if(cityShare>0.45 && (!volcano || volcano.amount<0.04)) amount=Math.min(amount,0.34);
    return clamp(amount,0.12,1);
  }
  function fallbackBiomeBlend(x, WORLDGEN){
    if(!WORLDGEN || !WORLDGEN.valueNoise) return {pal:SKY_PALETTES[0], a:0,b:0,t:0, city:0, volcano:{amount:0,center:null,distance:Infinity,radius:0}, relief:0.46};
    const v=WORLDGEN.valueNoise(x,220,900); const t1=0.35, t2=0.7, w=0.05;
    const volcano=computeVolcanoInfluence(x,WORLDGEN);
    if(v < t1-w) return {pal:SKY_PALETTES[0], a:0,b:0,t:0, city:0, volcano, relief:0.44};
    if(v>t2+w) return {pal:SKY_PALETTES[7], a:7,b:7,t:0, city:0, volcano, relief:volcano.amount>0.01?0.9:0.82};
    if(v>=t1-w && v<=t1+w){ const tt=smoothstep(t1-w,t1+w,v); return {pal:blendPalette(SKY_PALETTES[0],SKY_PALETTES[1],tt), a:0,b:1,t:tt, city:0, volcano, relief:0.40}; }
    if(v>=t2-w && v<=t2+w){ const tt=smoothstep(t2-w,t2+w,v); return {pal:blendPalette(SKY_PALETTES[1],SKY_PALETTES[7],tt), a:1,b:7,t:tt, city:0, volcano, relief:volcano.amount>0.01?0.88:0.58}; }
    if(v<t2) return {pal:SKY_PALETTES[1], a:1,b:1,t:0, city:0, volcano, relief:0.34};
    return {pal:SKY_PALETTES[7], a:7,b:7,t:0, city:0, volcano, relief:volcano.amount>0.01?0.9:0.82};
  }
  function computeBiomeBlend(x, WORLDGEN){
    if(!WORLDGEN || !WORLDGEN.biomeType) return fallbackBiomeBlend(x,WORLDGEN);
    const samples=[[-260,0.35],[-180,0.55],[-110,0.75],[-55,0.92],[0,1.18],[55,0.92],[110,0.75],[180,0.55],[260,0.35]];
    const weights={};
    let total=0;
    for(const s of samples){
      let id=0;
      try{ id=WORLDGEN.biomeType(Math.round(x+s[0]))|0; }catch(e){ id=0; }
      if(!SKY_PALETTES[id]) id=0;
      weights[id]=(weights[id]||0)+s[1];
      total+=s[1];
    }
    const ranked=Object.keys(weights).map(k=>({id:+k,w:weights[k]})).sort((a,b)=>b.w-a.w);
    const a=ranked[0] ? ranked[0].id : 0;
    const b=ranked[1] ? ranked[1].id : a;
    const mix=(ranked[1] && ranked[1].w/total>=0.08) ? Math.min(0.48, ranked[1].w/(ranked[0].w+ranked[1].w)) : 0;
    let pal=mix>0 ? blendPalette(SKY_PALETTES[a],SKY_PALETTES[b],mix) : SKY_PALETTES[a];
    const city=computeCityInfluence(x,WORLDGEN);
    if(city>0 && a!==8) pal=blendPalette(pal,SKY_PALETTES[8],city*0.82);
    const volcano=computeVolcanoInfluence(x,WORLDGEN);
    const relief=computeDistantRelief(x,WORLDGEN,weights,total,volcano);
    return {pal,a,b,t:mix,city,weights,volcano,relief};
  }
  function worldSignature(WORLDGEN){
    if(!WORLDGEN) return 'none';
    const s=WORLDGEN.settings || {};
    return [
      WORLDGEN.worldSeed||0,
      s.seaLevel||0,
      s.oceanFrac||0,
      s.mountainAmp||0,
      s.mountainThreshold||0,
      s.valleyGain||0,
      s.detailAmp||0
    ].join('|');
  }
  function cachedBiomeBlendAt(qx,WORLDGEN){
    const key=worldSignature(WORLDGEN)+'|'+qx;
    const hit=biomeBlendCache.get(key);
    if(hit) return hit;
    if(biomeBlendCache.size>BIOME_BLEND_CACHE_CAP) biomeBlendCache.clear();
    const blend=computeBiomeBlend(qx,WORLDGEN);
    biomeBlendCache.set(key,blend);
    return blend;
  }
  function interpolateVolcanoCue(a,b,t){
    a=a || {amount:0,center:null,distance:Infinity,radius:0};
    b=b || {amount:0,center:null,distance:Infinity,radius:0};
    const amount=lerp(a.amount||0,b.amount||0,t);
    const ac=typeof a.center==='number', bc=typeof b.center==='number';
    let center=null;
    if(ac && bc) center=lerp(a.center,b.center,t);
    else if(ac) center=a.center;
    else if(bc) center=b.center;
    const ad=Number.isFinite(a.distance)?a.distance:1e9;
    const bd=Number.isFinite(b.distance)?b.distance:1e9;
    return {
      amount,
      center,
      distance:lerp(ad,bd,t),
      radius:lerp(a.radius||0,b.radius||0,t)
    };
  }
  function interpolateBiomeBlend(a,b,t){
    if(!b || t<=0) return a;
    if(t>=1) return b;
    const u=smoothstep(0,1,t);
    const base=u<0.5 ? a : b;
    return Object.assign({}, base, {
      pal:blendPalette(a.pal,b.pal,u),
      city:lerp(a.city||0,b.city||0,u),
      relief:lerp(a.relief||0.46,b.relief||0.46,u),
      volcano:interpolateVolcanoCue(a.volcano,b.volcano,u)
    });
  }
  function cachedBiomeBlend(x,WORLDGEN){
    if(!WORLDGEN || !WORLDGEN.biomeType) return computeBiomeBlend(x,WORLDGEN);
    const step=4;
    const left=Math.floor(x/step)*step;
    const t=(x-left)/step;
    const a=cachedBiomeBlendAt(left,WORLDGEN);
    if(t<=0.0001) return a;
    const b=cachedBiomeBlendAt(left+step,WORLDGEN);
    return interpolateBiomeBlend(a,b,t);
  }
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
  let moonPhaseIndex=0, lastPhaseCycle=-1;
  function setCachedCycleInfo(cycleT){
    const t=((cycleT%1)+1)%1;
    const isDay=t<DAY_FRAC;
    const tDay=isDay? (t/DAY_FRAC) : ((t-DAY_FRAC)/(1-DAY_FRAC));
    lastCycleInfo={cycleT:t,isDay,tDay,twilightBand:TWILIGHT_BAND};
    return lastCycleInfo;
  }
  function moonAlphaForInfo(info){
    const c=info || lastCycleInfo || {isDay:false,tDay:0.5};
    if(!c.isDay) return 0.94;
    const t=clamp(finite(c.tDay,0.5),0,1);
    const band=TWILIGHT_BAND*1.4;
    const edgeIn=smoothstep(0,band,t);
    const edgeOut=smoothstep(0,band,1-t);
    return 0.08*(1-Math.min(edgeIn,edgeOut));
  }
  function drawBackgroundLandscape(ctx,W,H,playerX,TILE,blend,isDay,mode){
    const mask=mode==='mask';
    ctx.save();
    const relief=clamp(typeof blend.relief==='number'?blend.relief:0.46,0.12,1);
    const volcanoCue=blend.volcano || {amount:0};
    const cityMountainDamp=(blend.city>0.25 && (!volcanoCue || volcanoCue.amount<0.04)) ? (1-Math.min(0.62,blend.city*0.62)) : 1;
    for(let layer=0; layer<3; layer++){
      const spec=MOUNTAIN_LAYER[layer];
      const layerStrength=([0.42,0.25,0.12][layer] || 0.2) + relief*([0.58,0.75,0.88][layer] || 0.7);
      const y=Math.round(H*spec.y + (1-relief)*(20+layer*27));
      const imgA=getMountainLayer(blend.a,layer);
      const scrollA=-((playerX*TILE)*spec.par);
      const alphaBase=solidBackdropOpacity(spec.alpha*layerStrength*cityMountainDamp,0.92);
      const endlessBottom=layer===MOUNTAIN_LAYER.length-1;
      const extendTo=endlessBottom ? H : null;
      drawMountainRepeats(ctx,imgA,scrollA,y,mask ? 1 : alphaBase,W,extendTo,endlessBottom ? mountainBottomFillStyle(blend.a,layer,mask) : null);
      if(blend.t>0){
        const imgB=getMountainLayer(blend.b,layer);
        drawMountainRepeats(ctx,imgB,scrollA,y,mask ? clamp(blend.t+0.55,0,1) : alphaBase*blend.t,W,extendTo,endlessBottom ? mountainBottomFillStyle(blend.b,layer,mask) : null);
      }
    }
    if(mask){
      drawCitySkyline(ctx,W,H,playerX,TILE,blend.city,isDay,true);
    } else {
      drawVolcanoCue(ctx,W,H,playerX,TILE,volcanoCue,isDay);
      drawCitySkyline(ctx,W,H,playerX,TILE,blend.city,isDay,false);
    }
    ctx.restore();
  }
  function drawCelestialLayer(ctx,W,H,drawFn,maskFn){
    const layer=scratchCanvas('celestial',W,H);
    if(!layer || !layer.getContext){
      drawFn(ctx);
      return;
    }
    const g=layer.getContext('2d');
    if(!clearScratch(g,W,H)){
      drawFn(ctx);
      return;
    }
    drawFn(g);
    g.globalCompositeOperation='destination-out';
    g.globalAlpha=1;
    maskFn(g);
    g.globalCompositeOperation='source-over';
    g.globalAlpha=1;
    ctx.drawImage(layer,0,0);
  }

  function drawBackgroundScene(ctx,W,H,playerX,TILE,WORLDGEN){
    initStars();
    const now=performance.now();
    const debugEnabled = window.__timeOverrideActive===true;
    const manualT = debugEnabled? (window.__timeOverrideValue||0): null;
    const rawCycleT = (((now-cycleStart)%CYCLE_DURATION)+CYCLE_DURATION)%CYCLE_DURATION/CYCLE_DURATION;
    const cycleT = debugEnabled? manualT : rawCycleT;
    if(!debugEnabled && window.__timeSliderEl && !window.__timeSliderLocked){ window.__timeSliderEl.value = cycleT.toFixed(4); }
    const blend=cachedBiomeBlend(playerX, WORLDGEN); const cols=skyGradientFromPalette(blend.pal,cycleT);
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
    const infoNow=setCachedCycleInfo(cycleT); const isDay=infoNow.isDay; const tDay=infoNow.tDay;
    // Stars
    function smoothEdge(x,band){ if(x<=0) return 0; if(x>=band) return 1; const n=x/band; return n*n*(3-2*n); }
    const smoothBand = TWILIGHT_BAND*1.4; const edgeIn = smoothEdge(tDay, smoothBand); const edgeOut = smoothEdge(1 - tDay, smoothBand); let starAlpha = 1 - edgeIn*edgeOut; if(isDay) starAlpha *= 0.9; else starAlpha=1;
    if(starAlpha>0.01){
      drawStars(ctx,W,H,cycleT,starAlpha,now);
    }
    // Sun/Moon helpers
    const seasonMetrics=currentSeasonMetrics();
    drawCelestialLayer(ctx,W,H,(skyCtx)=>{
      const redDwarf=redDwarfStateForDraw(cycleT,now,W,H,WORLDGEN,blend);
      drawRedDwarfObject(skyCtx,W,H,redDwarf,now);
      if(isDay){
        const sun=sunPosition(tDay,W,H);
        const sunState=sunStateForDraw(cycleT,seasonMetrics,blend,WORLDGEN,now,playerX,tDay);
        const sunAlpha=clamp(0.34+0.66*Math.sin(clamp(tDay,0,1)*Math.PI),0.24,1);
        const sr=sunRadiusForState(W,sunState);
        drawSunObject(skyCtx,W,H,sun,sr,sunAlpha,sunState,now);
      }
      const moonFrac=moonFracForCycle(cycleT);
      const moonAlpha=moonAlphaForInfo(infoNow);
      const moon=moonPosition(moonFrac,W,H);
      const moonState=moonStateForDraw(cycleT,seasonMetrics,blend,WORLDGEN,now,playerX);
      const mr=clamp(W*0.065,42,74);
      drawMoonObject(skyCtx,W,H,moon,mr,moonAlpha,moonState,now);
    },(maskCtx)=>{
      drawBackgroundLandscape(maskCtx,W,H,playerX,TILE,blend,isDay,'mask');
    });
    // Mountains (parallax)
    drawBackgroundLandscape(ctx,W,H,playerX,TILE,blend,isDay,'normal');
    ctx.restore(); // end background layer
  }

  background.draw = function(ctx,W,H,playerX,TILE,WORLDGEN,cameraZoom){
    const scene=scratchCanvas('backgroundSharpScene',W,H);
    const layer=scratchCanvas('backgroundSoftFocus',W,H);
    if(!scene || !scene.getContext || !layer || !layer.getContext || !ctx || !ctx.drawImage){
      drawBackgroundScene(ctx,W,H,playerX,TILE,WORLDGEN);
      return;
    }
    const bg=scene.getContext('2d');
    const soft=layer.getContext('2d');
    if(!bg || !soft){
      drawBackgroundScene(ctx,W,H,playerX,TILE,WORLDGEN);
      return;
    }
    const blur=effectiveBackdropBlurPx(W,H,cameraZoom);
    const now=performance.now();
    if(shouldRefreshBackdropCache(W,H,playerX,TILE,blur,now)){
      if(!clearScratch(bg,W,H) || !clearScratch(soft,W,H)){
        drawBackgroundScene(ctx,W,H,playerX,TILE,WORLDGEN);
        return;
      }
      drawBackgroundScene(bg,W,H,playerX,TILE,WORLDGEN);
      soft.save();
      if('filter' in soft) soft.filter=`blur(${blur.toFixed(2)}px)`;
      soft.drawImage(scene,0,0);
      soft.restore();
      markBackdropCache(W,H,playerX,TILE,blur,now);
    }
    ctx.save();
    if('filter' in ctx) ctx.filter='none';
    ctx.drawImage(layer,0,0);
    ctx.restore();
  };

  background.applyTint = function(ctx,W,H){
    const info=lastCycleInfo;
    const dayFrac=DAY_FRAC;
    const twilight=info.twilightBand;
    let a=0, col='#000';
    if(info.isDay){
      // Twilight grading strong enough to actually read on the world layer —
      // at 0.10 the terrain and tree canopies kept full noon saturation against
      // a sepia sky, which made dusk look like a skybox swap instead of evening.
      if(info.tDay<twilight){
        a = (1 - (info.tDay/twilight)) * 0.20;
        col='#ff9a4a';
      } else if(info.tDay>1-twilight){
        a = ((info.tDay-(1-twilight))/twilight) * 0.20;
        col='#ff8240';
      }
    } else {
      // Night dims the whole scene noticeably (max ~0.42) so torches, windows
      // and glow actually carry the mood; the old 0.12–0.25 read as daytime
      // with a dark skybox.
      const nightT = (info.cycleT - dayFrac)/(1-dayFrac);
      a = 0.22 + 0.20 * Math.sin(nightT*Math.PI);
      col = '#061425';
    }
    if(a>0.001){
      ctx.save();
      ctx.globalAlpha=a;
      ctx.fillStyle=col;
      ctx.fillRect(0,0,W,H);
      ctx.restore();
    }
    const seasonTint=seasonVisualTint();
    if(seasonTint){
      ctx.save();
      ctx.globalAlpha=seasonTint.alpha;
      ctx.fillStyle=seasonTint.color;
      ctx.fillRect(0,0,W,H);
      ctx.restore();
    }
  };

  // Live day/night info for other systems (weather/clouds). Reflects the debug time
  // override because it is captured from the same cycleT used to render the sky.
  background.getCycleInfo = function(){ return lastCycleInfo; };
  background._debugDrawScene = drawBackgroundScene;
  background._debugBackdropBlurPx = function(W,H,cameraZoom){ return +effectiveBackdropBlurPx(W,H,cameraZoom).toFixed(3); };
  background._debugBaseBackdropBlurPx = function(W,H){ return +backdropBlurPx(W,H).toFixed(3); };
  background._debugCameraZoomBlurScale = function(cameraZoom){ return +cameraZoomBlurScale(cameraZoom).toFixed(3); };
  background._debugBackdropCacheState = function(){ return Object.assign({}, backdropCache); };
  background._debugBackdropRefreshIntervalMs = function(){ return +backdropRefreshIntervalMs().toFixed(3); };
  background._debugClearBackdropCache = function(){ backdropCache.w=0; backdropCache.h=0; backdropCache.playerX=0; backdropCache.tile=0; backdropCache.blur=0; backdropCache.lastMs=-1e9; backdropCache.refreshes=0; };
  background._debugBiomeBlend = computeBiomeBlend;
  background._debugBiomeBlendCached = cachedBiomeBlend;
  background._debugClearBiomeBlendCache = function(){ biomeBlendCache.clear(); };
  background._debugBiomeBlendCacheSize = function(){ return biomeBlendCache.size; };
  background._debugSkyPalettes = SKY_PALETTES;
  background._debugStarPositions = starPositions;
  background._debugStarLayerCount = function(){ initStars(); return {dome:stars.length, near:0}; };
  background._debugCelestialPosition = function(kind,frac,W,H){
    const p=(kind==='moon' ? moonPosition : sunPosition)(frac,W,H);
    return {x:+p.x.toFixed(3), y:+p.y.toFixed(3), angle:+p.angle.toFixed(6)};
  };
  background._debugCelestialCyclePosition = function(kind,cycleT,W,H){
    const t=((cycleT%1)+1)%1;
    const frac=kind==='moon' ? moonFracForCycle(t) : (t<DAY_FRAC ? t/DAY_FRAC : ((t-DAY_FRAC)/(1-DAY_FRAC)));
    const p=(kind==='moon' ? moonPosition : sunPosition)(frac,W,H);
    return {x:+p.x.toFixed(3), y:+p.y.toFixed(3), frac:+frac.toFixed(6), angle:+p.angle.toFixed(6)};
  };
  background._debugRedDwarfState = function(elapsedCycles,W,H,WORLDGEN,cycleT){
    const cycles=Number.isFinite(+elapsedCycles) ? +elapsedCycles : 0;
    const ww=Number.isFinite(+W)?+W:900;
    const hh=Number.isFinite(+H)?+H:500;
    const t=Number.isFinite(+cycleT) ? +cycleT : 0.75;
    const blend=computeBiomeBlend(0,WORLDGEN);
    return redDwarfStateForElapsed(cycles,t,ww,hh,WORLDGEN,blend);
  };
  background._debugMoonState = function(metrics,WORLDGEN,cycleT,W,H,now,playerX){
    const t=Number.isFinite(+cycleT) ? +cycleT : 0.75;
    const tm=Number.isFinite(+now) ? +now : performance.now();
    const x=Number.isFinite(+playerX) ? +playerX : 0;
    const blend=computeBiomeBlend(x,WORLDGEN);
    const state=moonStateForDraw(t,metrics || null,blend,WORLDGEN,tm,x);
    const p=moonPosition(moonFracForCycle(t),Number.isFinite(+W)?+W:900,Number.isFinite(+H)?+H:500);
    return Object.assign({
      x:+p.x.toFixed(3),
      y:+p.y.toFixed(3)
    },state);
  };
  background._debugSunState = function(metrics,WORLDGEN,cycleT,W,H,now,playerX){
    const t=((Number.isFinite(+cycleT) ? +cycleT : 0.25)%1+1)%1;
    const tm=Number.isFinite(+now) ? +now : performance.now();
    const x=Number.isFinite(+playerX) ? +playerX : 0;
    const dayT=t<DAY_FRAC ? t/DAY_FRAC : ((t-DAY_FRAC)/(1-DAY_FRAC));
    const blend=computeBiomeBlend(x,WORLDGEN);
    const state=sunStateForDraw(t,metrics || null,blend,WORLDGEN,tm,x,dayT);
    const ww=Number.isFinite(+W)?+W:900;
    const hh=Number.isFinite(+H)?+H:500;
    const p=sunPosition(dayT,ww,hh);
    return Object.assign({
      x:+p.x.toFixed(3),
      y:+p.y.toFixed(3),
      radius:+sunRadiusForState(ww,state).toFixed(3)
    },state);
  };
  background._debugMoonAlpha = function(cycleT){
    const t=((Number.isFinite(+cycleT) ? +cycleT : 0.75)%1+1)%1;
    return +moonAlphaForInfo({
      cycleT:t,
      isDay:t<DAY_FRAC,
      tDay:t<DAY_FRAC ? t/DAY_FRAC : ((t-DAY_FRAC)/(1-DAY_FRAC)),
      twilightBand:TWILIGHT_BAND
    }).toFixed(4);
  };
  background._debugSeasonTint = seasonVisualTint;

  // Save/load support for time-of-day and moon phase
  background.exportState = function(){
    const now=performance.now();
    const cycleT=(((now-cycleStart)%CYCLE_DURATION)+CYCLE_DURATION)%CYCLE_DURATION/CYCLE_DURATION;
    return { cycleT, moonPhaseIndex, lastPhaseCycle };
  };
  background.importState = function(s){
    if(!s) return;
    if(typeof s.cycleT==='number'){
      const now=performance.now();
      const cycleT=((s.cycleT%1)+1)%1;
      cycleStart = now - cycleT*CYCLE_DURATION;
      setCachedCycleInfo(cycleT);
    }
    if(typeof s.moonPhaseIndex==='number') moonPhaseIndex = (((s.moonPhaseIndex|0)%MOON_PHASES)+MOON_PHASES)%MOON_PHASES;
    if(typeof s.lastPhaseCycle==='number') lastPhaseCycle = s.lastPhaseCycle;
  };
  background.snapshot = background.exportState;
  background.restore = background.importState;

  // Day/night state for HUD readouts. Honors the debug time override so the
  // displayed clock always matches the sky on screen. The cycle maps to a 24h
  // clock with dawn at 06:00 (cycleT 0), noon at 12:00 (0.25), dusk at 18:00
  // (0.5) and midnight at 00:00 (0.75).
  background.timeInfo = function(){
    const now=performance.now();
    const raw=(((now-cycleStart)%CYCLE_DURATION)+CYCLE_DURATION)%CYCLE_DURATION/CYCLE_DURATION;
    const cycleT = window.__timeOverrideActive===true
      ? ((((window.__timeOverrideValue||0)%1)+1)%1)
      : raw;
    const isDay = cycleT<DAY_FRAC;
    const tDay = isDay ? (cycleT/DAY_FRAC) : ((cycleT-DAY_FRAC)/(1-DAY_FRAC));
    const dayMinutes = (((cycleT*24)+6)%24)*60;
    const hour = Math.floor(dayMinutes/60)%24;
    const minute = Math.floor(dayMinutes%60);
    // dawn/day/dusk/night windows for a friendly icon
    let phase;
    if(hour>=5 && hour<7) phase='dawn';
    else if(hour>=7 && hour<17) phase='day';
    else if(hour>=17 && hour<19) phase='dusk';
    else phase='night';
    return { cycleT, isDay, tDay, hour, minute, phase };
  };

  MM.background = background;
})();
// ESM export (progressive migration)
export const background = (typeof window!=='undefined' && window.MM) ? window.MM.background : undefined;
export default background;
