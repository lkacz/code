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
  const BIOME_BLEND_CACHE_CAP=2048;
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
  function drawMountainRepeats(ctx,img,scroll,y,alpha,W){
    if(alpha<=0) return;
    ctx.globalAlpha=alpha;
    let x=scroll%img.width;
    if(x>0) x-=img.width;
    for(; x<W; x+=img.width) ctx.drawImage(img,Math.round(x),Math.round(y));
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
  function drawCitySkyline(ctx,W,H,playerX,TILE,influence,isDay,tDay){
    if(influence<=0.01) return;
    const nightMul=isDay?0.9:(1.18+0.15*Math.sin(tDay*Math.PI));
    for(let layer=0; layer<CITY_SKYLINE_LAYER.length; layer++){
      const spec=CITY_SKYLINE_LAYER[layer];
      const img=getCitySkylineLayer(layer);
      const y=Math.round(H*spec.y);
      const alpha=spec.alpha*influence*nightMul;
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
  function smoothstep(a,b,x){ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); }
  function blendColor(c1,c2,t){ return lerpColor(c1,c2,t); }
  function blendPalette(p1,p2,t){ if(!p2||t<=0) return p1; if(t>=1) return p2; return {
    dayTop:blendColor(p1.dayTop,p2.dayTop,t), dayBot:blendColor(p1.dayBot,p2.dayBot,t),
    duskTop:blendColor(p1.duskTop,p2.duskTop,t), duskBot:blendColor(p1.duskBot,p2.duskBot,t),
    nightTop:blendColor(p1.nightTop,p2.nightTop,t), nightBot:blendColor(p1.nightBot,p2.nightBot,t),
    mount:[0,1,2].map(i=>blendColor(p1.mount[i],p2.mount[i],t)) };
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
  function cachedBiomeBlend(x,WORLDGEN){
    if(!WORLDGEN || !WORLDGEN.biomeType) return computeBiomeBlend(x,WORLDGEN);
    const qx=Math.round(x/4);
    const key=worldSignature(WORLDGEN)+'|'+qx;
    const hit=biomeBlendCache.get(key);
    if(hit) return hit;
    if(biomeBlendCache.size>BIOME_BLEND_CACHE_CAP) biomeBlendCache.clear();
    const blend=computeBiomeBlend(qx*4,WORLDGEN);
    biomeBlendCache.set(key,blend);
    return blend;
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
  let moonPhaseIndex=0, lastPhaseCycle=-1; const MOON_PHASES=8;

  background.draw = function(ctx,W,H,playerX,TILE,WORLDGEN){
    initStars();
    const now=performance.now();
    const debugEnabled = window.__timeOverrideActive===true;
    const manualT = debugEnabled? (window.__timeOverrideValue||0): null;
    const rawCycleT = ((now-cycleStart)%CYCLE_DURATION)/CYCLE_DURATION;
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
    const isDay=cycleT<DAY_FRAC; const tDay=isDay? (cycleT/DAY_FRAC) : ((cycleT-DAY_FRAC)/(1-DAY_FRAC)); lastCycleInfo={cycleT,isDay,tDay,twilightBand:TWILIGHT_BAND};
    // Stars
    function smoothEdge(x,band){ if(x<=0) return 0; if(x>=band) return 1; const n=x/band; return n*n*(3-2*n); }
    const smoothBand = TWILIGHT_BAND*1.4; const edgeIn = smoothEdge(tDay, smoothBand); const edgeOut = smoothEdge(1 - tDay, smoothBand); let starAlpha = 1 - edgeIn*edgeOut; if(isDay) starAlpha *= 0.9; else starAlpha=1;
    if(starAlpha>0.01){
      drawStars(ctx,W,H,cycleT,starAlpha,now);
    }
    // Sun/Moon helpers
    function drawBody(frac,radius,color,glowCol){ const ang=lerp(Math.PI*1.05, Math.PI*-0.05, frac); const cx=W*0.5 + Math.cos(ang)*W*0.45; const cy=H*0.82 + Math.sin(ang)*H*0.65; const grd2=ctx.createRadialGradient(cx,cy,radius*0.15,cx,cy,radius); grd2.addColorStop(0,glowCol); grd2.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=grd2; ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.fill(); ctx.fillStyle=color; ctx.beginPath(); ctx.arc(cx,cy,radius*0.55,0,Math.PI*2); ctx.fill(); }
    const dayCore = isDay && tDay>=TWILIGHT_BAND && tDay<=1-TWILIGHT_BAND; if(isDay){ const sunGlow=dayCore? 'rgba(255,255,255,0.55)':'rgba(255,180,120,0.55)'; drawBody(tDay, 140, '#fff8d2', sunGlow); }
    const currentCycleIndex = Math.floor((performance.now()-cycleStart)/CYCLE_DURATION); if(currentCycleIndex !== lastPhaseCycle){ lastPhaseCycle=currentCycleIndex; moonPhaseIndex = (moonPhaseIndex + 1) % MOON_PHASES; }
    const moonFrac=(cycleT+0.5)%1; const moonAlpha=isDay? 0.05:0.9; const mAng=lerp(Math.PI*1.15, Math.PI*-0.15, moonFrac); const mcx=W*0.5 + Math.cos(mAng)*W*0.48; const mcy=H*0.88 + Math.sin(mAng)*H*0.68; const mr=70; ctx.save(); ctx.globalAlpha=moonAlpha; ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.arc(mcx,mcy,mr,0,Math.PI*2); ctx.fill(); ctx.globalCompositeOperation='destination-out'; if(moonPhaseIndex!==MOON_PHASES-1){ const phaseT = moonPhaseIndex / (MOON_PHASES-1); const cut = (0.5 - phaseT/2); ctx.beginPath(); const off = cut*mr*1.9; ctx.ellipse(mcx+off,mcy,mr*0.95,mr*1.05,0,0,Math.PI*2); ctx.fill(); if(moonPhaseIndex>0){ ctx.beginPath(); const off2 = (cut+0.15)*mr*1.2; ctx.ellipse(mcx-off2,mcy,mr*0.75,mr*0.95,0,0,Math.PI*2); ctx.fill(); } } ctx.restore();
    // Mountains (parallax)
    ctx.save();
    const nightMul=isDay?1:(0.68+0.10*Math.sin(tDay*Math.PI));
    const relief=clamp(typeof blend.relief==='number'?blend.relief:0.46,0.12,1);
    const volcanoCue=blend.volcano || {amount:0};
    const cityMountainDamp=(blend.city>0.25 && (!volcanoCue || volcanoCue.amount<0.04)) ? (1-Math.min(0.62,blend.city*0.62)) : 1;
    for(let layer=0; layer<3; layer++){
      const spec=MOUNTAIN_LAYER[layer];
      const layerStrength=([0.42,0.25,0.12][layer] || 0.2) + relief*([0.58,0.75,0.88][layer] || 0.7);
      const y=Math.round(H*spec.y + (1-relief)*(20+layer*27));
      const imgA=getMountainLayer(blend.a,layer);
      const scrollA=-((playerX*TILE)*spec.par);
      const alphaBase=spec.alpha*nightMul*layerStrength*cityMountainDamp;
      drawMountainRepeats(ctx,imgA,scrollA,y,alphaBase*(blend.t>0?(1-blend.t):1),W);
      if(blend.t>0){
        const imgB=getMountainLayer(blend.b,layer);
        drawMountainRepeats(ctx,imgB,scrollA,y,alphaBase*blend.t,W);
      }
    }
    drawVolcanoCue(ctx,W,H,playerX,TILE,volcanoCue,isDay);
    drawCitySkyline(ctx,W,H,playerX,TILE,blend.city,isDay,tDay);
    ctx.restore();
    ctx.restore(); // end background layer
  };

  background.applyTint = function(ctx,W,H){
    const info=lastCycleInfo; const dayFrac=DAY_FRAC; const twilight=info.twilightBand; let a=0, col='#000'; if(info.isDay){ if(info.tDay<twilight){ a = (1 - (info.tDay/twilight)) * 0.10; col='#ff9a4a'; } else if(info.tDay>1-twilight){ a = ((info.tDay-(1-twilight))/twilight) * 0.10; col='#ff8240'; } } else { const nightT = (info.cycleT - dayFrac)/(1-dayFrac); a = 0.12 + 0.13 * Math.sin(nightT*Math.PI); col = '#061425'; } if(a>0.001){ ctx.save(); ctx.globalAlpha=a; ctx.fillStyle=col; ctx.fillRect(0,0,W,H); ctx.restore(); }
  };

  // Live day/night info for other systems (weather/clouds). Reflects the debug time
  // override because it is captured from the same cycleT used to render the sky.
  background.getCycleInfo = function(){ return lastCycleInfo; };
  background._debugBiomeBlend = computeBiomeBlend;
  background._debugBiomeBlendCached = cachedBiomeBlend;
  background._debugClearBiomeBlendCache = function(){ biomeBlendCache.clear(); };
  background._debugBiomeBlendCacheSize = function(){ return biomeBlendCache.size; };
  background._debugSkyPalettes = SKY_PALETTES;
  background._debugStarPositions = starPositions;
  background._debugStarLayerCount = function(){ initStars(); return {dome:stars.length, near:0}; };

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

  MM.background = background;
})();
// ESM export (progressive migration)
export const background = (typeof window!=='undefined' && window.MM) ? window.MM.background : undefined;
export default background;
