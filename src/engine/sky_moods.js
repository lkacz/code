// Sky moods: two deterministic atmosphere plays driven by the day cycle,
// season temperature and wind — no stored state, so every machine that can
// see the same clock renders the same sky.
//
// MORNING FOG (mgła poranna): around dawn, in calm air, low ground fills with
// a milk-white haze that burns off as the sun climbs. It is thickest in
// valleys (the local surface sits below its surroundings). While you stand in
// it, creatures see you later — mobs.js multiplies its sight ranges by
// mobSightMult() — and so do you: pretty and dangerous.
//
// AURORA (zorza polarna): on cold, clear nights the sky far in the frozen
// biomes lights up with slow green-violet curtains. While the aurora burns,
// the charged air trickles a little energy back into the hero — electric
// weapons and antenna gear love the north.
//
// Multiplayer: display + hero-side effects only (no world writes). The host
// steps it in the world loop; a hero-mode guest steps it in runHeroStep — the
// clock and season stream keep both ends looking at the same sky.
window.MM = window.MM || {};
(function(){
  const CFG = {
    FOG_DAWN_END: 0.16,     // fraction of the day the fog survives after sunrise
    FOG_PREDAWN: 0.92,      // fog starts forming in the last stretch of night
    FOG_WIND_CALM: 1.2,     // full fog needs air calmer than this
    FOG_WIND_MAX: 3.2,      // above this the fog is torn away entirely
    FOG_VALLEY_DROP: 3,     // local surface this much below neighbours = valley
    FOG_VALLEY_SPAN: 12,    // columns compared for valleyness
    FOG_MAX_ALPHA: 0.52,
    FOG_SIGHT_MULT: 0.55,   // mob sight range multiplier inside full fog
    AURORA_CLIMATE: 0.30,   // worldgen climate below this = frozen biomes
    AURORA_CLOUD_MAX: 0.5,  // needs a mostly clear sky
    AURORA_NIGHT_LO: 0.12, AURORA_NIGHT_HI: 0.88,
    AURORA_MAX_ALPHA: 0.30,
    AURORA_ENERGY: 0.4,     // hero E/s at full aurora
    LERP: 0.5,              // mood ramp speed (1/s) — no popping
    DEMO_HOLD: 42,          // debug "start": seconds a rolled-in mood holds then
                            // burns off on its own (full for the first half)
  };

  let fogK=0, auroraK=0;
  let fogNoted=false, auroraNoted=false;
  let lastPx=0;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function cycleInfo(){
    try{ const b=MM.background; const c=b && b.getCycleInfo && b.getCycleInfo(); if(c && typeof c==='object') return c; }catch(e){}
    return null;
  }
  function windSpeed(){
    try{ const w=MM.wind; if(w && typeof w.speed==='function'){ const v=Number(w.speed()); if(Number.isFinite(v)) return Math.abs(v); } }catch(e){}
    return 0;
  }
  function cloudiness(){
    try{ const w=MM.wind; const m=w && w.metrics && w.metrics(); const v=m && Number(m.cloudiness); if(Number.isFinite(v)) return v; }catch(e){}
    return 0.4;
  }
  function climateAt(x){
    try{ const wg=MM.worldGen; if(wg && typeof wg.temperature==='function'){ const v=Number(wg.temperature(Math.round(x))); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0.5;
  }
  function surfaceAnchor(x){
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(x)); if(Number.isFinite(s)) return s; }
    }catch(e){}
    return 30;
  }
  // Valleys hold fog: how far the local floor sits under its surroundings.
  function valleyness(px){
    const here=surfaceAnchor(px);
    let rim=here;
    for(const dx of [-CFG.FOG_VALLEY_SPAN,-6,6,CFG.FOG_VALLEY_SPAN]){
      rim=Math.min(rim,surfaceAnchor(px+dx)); // min row = HIGHEST ground
    }
    const drop=here-rim; // positive when we sit below the rim
    return clamp(drop/(CFG.FOG_VALLEY_DROP*2),0.25,1); // open plains keep a thin veil
  }
  function naturalFogTarget(px){
    const c=cycleInfo();
    if(!c) return 0;
    let dawn=0;
    if(c.isDay && c.tDay<CFG.FOG_DAWN_END) dawn=1-(c.tDay/CFG.FOG_DAWN_END);
    else if(!c.isDay && c.tNight>CFG.FOG_PREDAWN) dawn=(c.tNight-CFG.FOG_PREDAWN)/(1-CFG.FOG_PREDAWN);
    if(dawn<=0) return 0;
    const w=windSpeed();
    const calm=clamp(1-(w-CFG.FOG_WIND_CALM)/(CFG.FOG_WIND_MAX-CFG.FOG_WIND_CALM),0,1);
    return clamp(dawn*calm*valleyness(px),0,1);
  }
  function naturalAuroraTarget(px){
    const c=cycleInfo();
    if(!c || c.isDay) return 0;
    if(c.tNight<CFG.AURORA_NIGHT_LO || c.tNight>CFG.AURORA_NIGHT_HI) return 0;
    if(climateAt(px)>CFG.AURORA_CLIMATE) return 0;
    if(cloudiness()>CFG.AURORA_CLOUD_MAX) return 0;
    const mid=1-Math.abs(c.tNight-0.5)*1.4;
    return clamp(mid,0.2,1);
  }
  // debug pins override the natural targets (0 = natural again). A "started"
  // demo also arms a hold countdown so the mood rolls in and burns off by itself.
  let forceFog=0, forceAurora=0;
  let forceFogHold=0, forceAuroraHold=0;
  function fogTarget(px){ return forceFog>0?forceFog:naturalFogTarget(px); }
  function auroraTarget(px){ return forceAurora>0?forceAurora:naturalAuroraTarget(px); }
  function tickDemo(dt){
    if(forceFogHold>0){ forceFogHold=Math.max(0,forceFogHold-dt); forceFog=forceFogHold>0?clamp(forceFogHold/(CFG.DEMO_HOLD*0.5),0,1):0; }
    if(forceAuroraHold>0){ forceAuroraHold=Math.max(0,forceAuroraHold-dt); forceAurora=forceAuroraHold>0?clamp(forceAuroraHold/(CFG.DEMO_HOLD*0.5),0,1):0; }
  }
  function heroEnergyTrickle(dt){
    if(auroraK<=0.3) return;
    try{
      const he=MM.heroEnergy;
      if(he && typeof he.add==='function') he.add(CFG.AURORA_ENERGY*auroraK*dt);
      else {
        const p=(typeof window!=='undefined' && window.player)||null;
        if(p && Number.isFinite(p.energy) && Number.isFinite(p.maxEnergy)) p.energy=Math.min(p.maxEnergy,p.energy+CFG.AURORA_ENERGY*auroraK*dt);
      }
    }catch(e){}
  }
  function update(dt,player){
    if(!(dt>0)) return;
    tickDemo(dt);
    const px=(player && Number.isFinite(player.x))?Math.floor(player.x):lastPx;
    lastPx=px;
    const k=clamp(dt*CFG.LERP,0,1);
    fogK+=(fogTarget(px)-fogK)*k;
    auroraK+=(auroraTarget(px)-auroraK)*k;
    if(fogK<0.01) fogK=0;
    if(auroraK<0.01) auroraK=0;
    heroEnergyTrickle(dt);
    if(fogK>0.5 && !fogNoted){
      fogNoted=true;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('morning_fog','Poranna mgła zalega w dolinie — piękna i zdradliwa.'); }catch(e){}
    }
    if(auroraK>0.5 && !auroraNoted){
      auroraNoted=true;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('aurora','Zorza polarna! Naładowane niebo oddaje odrobinę energii.'); }catch(e){}
    }
  }
  // Depth gate shared by both passes: the moods live at the surface.
  function surfaceFactor(){
    const p=(typeof window!=='undefined' && window.player)||null;
    if(!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return 1;
    const depth=p.y-surfaceAnchor(Math.floor(p.x));
    return depth>2 ? clamp(1-(depth-2)/5,0,1) : 1;
  }
  // Fog: milk-white ground bands, heaviest at the bottom of the view.
  // The origin comes from the CONTINUOUS camera (camX/camY) rather than the
  // floored sx/sy — flooring made a per-tile sawtooth that jerked the whole
  // screen-space veil sideways every time the hero crossed a tile boundary.
  function drawFog(ctx,TILE,sx,sy,viewX,viewY,camX,camY){
    const a=fogK*CFG.FOG_MAX_ALPHA*surfaceFactor();
    if(!ctx || a<=0.015) return;
    const ox=Number.isFinite(camX)?camX:sx, oy=Number.isFinite(camY)?camY:sy;
    const x0=(ox-1)*TILE, y0=(oy-1)*TILE, w=(viewX+2)*TILE, h=(viewY+2)*TILE;
    const t=((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())*0.00016;
    ctx.save();
    const g=ctx.createLinearGradient(0,y0+h*0.08,0,y0+h);
    g.addColorStop(0,'rgba(226,232,236,0)');
    g.addColorStop(0.5,'rgba(228,234,238,'+(a*0.55).toFixed(3)+')');
    g.addColorStop(1,'rgba(230,236,240,'+Math.min(0.95,a*1.1).toFixed(3)+')');
    ctx.fillStyle=g;
    ctx.fillRect(x0,y0,w,h);
    for(let i=0;i<3;i++){
      const bandY=y0+h*(0.55+0.14*i)+Math.sin(t*3+i*1.9)*h*0.03;
      const bg=ctx.createLinearGradient(0,bandY-h*0.10,0,bandY+h*0.10);
      bg.addColorStop(0,'rgba(232,238,242,0)');
      bg.addColorStop(0.5,'rgba(232,238,242,'+(a*0.5).toFixed(3)+')');
      bg.addColorStop(1,'rgba(232,238,242,0)');
      ctx.fillStyle=bg;
      ctx.fillRect(x0,bandY-h*0.10,w,h*0.20);
    }
    ctx.restore();
  }
  // Aurora: slow green-violet curtains in the upper sky of the view. Anchored
  // to the continuous camera (see drawFog) so the curtains hold still as the
  // hero walks instead of hopping a tile at a time.
  function drawAurora(ctx,TILE,sx,sy,viewX,viewY,camX,camY){
    const a=auroraK*CFG.AURORA_MAX_ALPHA*surfaceFactor();
    if(!ctx || a<=0.015) return;
    const ox=Number.isFinite(camX)?camX:sx, oy=Number.isFinite(camY)?camY:sy;
    const x0=(ox-1)*TILE, y0=(oy-1)*TILE, w=(viewX+2)*TILE, h=(viewY+2)*TILE;
    const t=((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())*0.00012;
    ctx.save();
    const COLS=[[110,235,160],[150,110,220],[90,200,210]];
    for(let i=0;i<3;i++){
      const rgb=COLS[i];
      const phase=t*(0.8+i*0.35)+i*2.4;
      const cx=x0+w*(0.2+0.3*i)+Math.sin(phase)*w*0.14;
      const top=y0+h*0.02, bottom=y0+h*(0.30+0.06*Math.sin(phase*1.7));
      const cw=w*(0.16+0.05*Math.sin(phase*1.3));
      const g=ctx.createLinearGradient(0,top,0,bottom);
      g.addColorStop(0,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(a*0.75).toFixed(3)+')');
      g.addColorStop(1,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0)');
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.moveTo(cx-cw/2,top);
      ctx.quadraticCurveTo(cx-cw*0.2+Math.sin(phase*2.2)*cw*0.3,(top+bottom)/2,cx-cw*0.3,bottom);
      ctx.lineTo(cx+cw*0.3,bottom);
      ctx.quadraticCurveTo(cx+cw*0.2+Math.sin(phase*1.8)*cw*0.3,(top+bottom)/2,cx+cw/2,top);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // Creatures see worse in fog — mobs.js multiplies its sight ranges with this.
  function mobSightMult(){
    return 1-(1-CFG.FOG_SIGHT_MULT)*fogK;
  }
  function fogLevel(){ return fogK; }
  function auroraLevel(){ return auroraK; }
  // Debug: pin a mood on for a look (0 = back to the natural targets).
  function forceMood(kind,k){
    k=clamp(Number(k)||0,0,1);
    if(kind==='fog'){ forceFog=k; forceFogHold=0; }
    else if(kind==='aurora'){ forceAurora=k; forceAuroraHold=0; }
    else return false;
    return true;
  }
  // Debug "start": roll the mood in at full and let it burn off on its own.
  function startMood(kind){
    if(kind==='fog'){ forceFog=1; forceFogHold=CFG.DEMO_HOLD; }
    else if(kind==='aurora'){ forceAurora=1; forceAuroraHold=CFG.DEMO_HOLD; }
    else return false;
    return true;
  }

  function reset(){
    fogK=0; auroraK=0; forceFog=0; forceAurora=0; forceFogHold=0; forceAuroraHold=0;
    fogNoted=false; auroraNoted=false;
  }
  function metrics(){
    return {fog:+fogK.toFixed(3), aurora:+auroraK.toFixed(3),
      forced:{fog:forceFog, aurora:forceAurora}, sightMult:+mobSightMult().toFixed(3)};
  }

  MM.skyMoods={update, drawFog, drawAurora, reset, metrics,
    fogLevel, auroraLevel, mobSightMult, forceMood, startMood, config:CFG,
    _debug:{valleyness, surfaceFactor, fogTargetNow:(px)=>fogTarget(px), auroraTargetNow:(px)=>auroraTarget(px)}};
})();

export const skyMoods = (typeof window!=='undefined' && window.MM) ? window.MM.skyMoods : globalThis.MM && globalThis.MM.skyMoods;
export default skyMoods;
