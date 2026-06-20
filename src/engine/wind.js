// Shared wind system.
// Wind is sampled weather state, not a per-tile simulation: it pushes exposed
// airborne actors, biases sparse gas motion, bends smoke/particles and draws a
// tiny bounded dust/snow layer so even light wind is readable.
import { T, INFO, WORLD_H, MOVE } from '../constants.js';

(function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.MM = root.MM || {};

  const CFG = {
    MAX_SPEED: 5.2,              // tiles/sec, rare squalls can approach this
    HERO_AIR_ACCEL: 1.55,        // horizontal acceleration multiplier while airborne
    HERO_JUMPING_BOOST: 1.45,    // upward jumps catch the wind more than falling arcs
    HERO_GROUND_THRESHOLD: 3.15, // only severe gusts shove a standing hero
    HERO_GROUND_ACCEL: 0.42,
    GAS_DRIFT_SCALE: 1.05,
    PARTICLE_CAP: 120,
    PARTICLE_LOW_CAP: 42,
    PARTICLE_MID_CAP: 78,
    VISUAL_RADIUS_X: 48,
    VISUAL_RADIUS_Y: 24,
    ALTITUDE_MIN_MULT: 0.82,
    ALTITUDE_MAX_MULT: 1.62,
    ALTITUDE_CURVE: 1.50,
  };

  let simT = 0;
  let wind = 0;
  let target = 0;
  let override = null;
  let cycleOverride = null;
  let cloudOverride = null;
  let weatherProfile = null;
  let visualAcc = 0;
  let particles = [];
  const squall = {t:0, max:0, amp:0, dir:1};
  let lastEnv = {night:0, sun:0, cloudiness:0, thermal:0, storm:0};

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function rgba(hex,a){
    const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));
    if(!m) return 'rgba(236,226,198,'+a.toFixed(3)+')';
    const n=parseInt(m[1],16);
    return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a.toFixed(3)+')';
  }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile === 'function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function frameMs(){
    return (typeof root.__mmFrameMs === 'number' && isFinite(root.__mmFrameMs)) ? root.__mmFrameMs : 16;
  }
  function particleCap(){
    const ms=frameMs();
    if(ms>36) return CFG.PARTICLE_LOW_CAP;
    if(ms>24) return CFG.PARTICLE_MID_CAP;
    return CFG.PARTICLE_CAP;
  }
  function cycleInfo(){
    if(cycleOverride) return cycleOverride;
    const bg=root.MM && root.MM.background;
    if(bg && typeof bg.getCycleInfo === 'function'){
      const c=bg.getCycleInfo();
      if(c && typeof c.isDay === 'boolean' && typeof c.tDay === 'number' && isFinite(c.tDay)) return c;
    }
    return {cycleT:0.25, isDay:true, tDay:0.5};
  }
  function sunIntensity(c){
    return c && c.isDay ? Math.sin(clamp(c.tDay,0,1)*Math.PI) : 0;
  }
  function cloudMetrics(opts){
    if(cloudOverride) return cloudOverride;
    const c = opts && opts.clouds ? opts.clouds : (root.MM && root.MM.clouds);
    if(c && typeof c.metrics === 'function'){
      try{ return c.metrics(); }catch(e){}
    }
    return null;
  }
  function seasonProfile(){
    const s=root.MM && root.MM.seasons;
    if(s && typeof s.profile === 'function'){
      try{ return s.profile() || {}; }catch(e){}
    }
    return {};
  }
  function seasonNumber(key,fallback){
    const v=seasonProfile()[key];
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  function isAirLike(t){
    if(t === T.AIR) return true;
    const info=INFO[t];
    return !!(info && (info.passable || info.gas));
  }
  function isLeafTile(t){ return t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED; }
  function isWindBlocker(t){
    if(t === T.AIR) return false;
    const info=INFO[t];
    if(info && info.gas) return false;
    if(isLeafTile(t) || t === T.TORCH || t === T.GRAVE) return false;
    return !(info && info.passable);
  }
  function exposureAt(x,y,getTile){
    if(typeof getTile !== 'function') return 1;
    x=Math.floor(x); y=Math.floor(y);
    if(y<0) return 1;
    if(y>=WORLD_H) return 0;
    let open=0;
    for(let dy=0; dy<12; dy++){
      const yy=y-dy;
      if(yy<0){ open=12; break; }
      if(isWindBlocker(getSafe(getTile,x,yy,T.STONE))) break;
      open++;
    }
    let sky=0;
    for(let yy=y-1; yy>=0; yy--){
      if(isWindBlocker(getSafe(getTile,x,yy,T.STONE))){
        const gap=y-yy;
        sky=gap>18 ? 0.48 : (gap>7 ? 0.22 : 0.06);
        break;
      }
      if(yy===0) sky=1;
    }
    const local=open/12;
    if(sky>=0.98) return clamp(local,0,1);
    if(sky>0) return clamp(Math.max(sky, local*0.32),0,1);
    return clamp(local*0.18,0,1);
  }
  function computeEnvironment(c,cm){
    const sun=sunIntensity(c);
    const night=c && !c.isDay ? (1.0 + 0.38*Math.sin(clamp(c.tDay,0,1)*Math.PI)) : 0;
    const cloudMass=cm && isFinite(cm.cloudMass) ? Math.max(0,cm.cloudMass) : 0;
    const cloudCount=cm && isFinite(cm.clouds) ? Math.max(0,cm.clouds) : 0;
    const cloudiness=clamp(cloudMass/72 + cloudCount/28,0,1);
    const storm=(cm && cm.storm && cm.storm.active) ? clamp(cm.storm.intensity||0,0,1) : 0;
    const thermal=sun*cloudiness;
    return {night, sun, cloudiness, thermal, storm};
  }
  function maybeStartSquall(dt,env){
    if(squall.t>0){
      squall.t=Math.max(0,squall.t-dt);
      if(squall.t<=0){ squall.amp=0; squall.max=0; }
      return;
    }
    const chance = env.storm>0
      ? 0.018*env.storm
      : (env.thermal>0.42 ? 0.0028*env.thermal : (env.night>0.6 ? 0.0007*env.night : 0));
    const seasonChance=chance*seasonNumber('squallChanceMult',1);
    if(seasonChance<=0 || Math.random()>=seasonChance*dt) return;
    squall.t=14+Math.random()*24;
    squall.max=squall.t;
    squall.amp=(1.0+Math.random()*1.8) * (env.storm>0 ? 1.25 : 1);
    squall.dir=(Math.random()<0.5?-1:1);
  }
  function forceSquall(dir,amp,seconds){
    const d = dir<0 ? -1 : 1;
    const duration = clamp((typeof seconds === 'number' && isFinite(seconds)) ? seconds : 24, 1, 120);
    squall.t=duration;
    squall.max=duration;
    squall.amp=clamp((typeof amp === 'number' && isFinite(amp)) ? amp : 2.6, 0.2, CFG.MAX_SPEED);
    squall.dir=d;
    return true;
  }
  function computeTarget(env){
    const seed=((root.MM && root.MM.worldGen && root.MM.worldGen.worldSeed) || 1) % 100000;
    const s=seed*0.00073;
    const base=Math.sin(simT*0.010+s)*1.05 + Math.sin(simT*0.0028+s*7.1)*0.82;
    const flicker=Math.sin(simT*0.53+s*11.3)*0.34 + Math.sin(simT*0.91+s*2.7)*0.18;
    const boost=0.82 + env.night*0.36 + env.thermal*0.72 + env.storm*0.85;
    let out=base*boost + flicker*(0.30+env.night*0.22+env.thermal*0.55+env.storm*0.72);
    if(squall.t>0 && squall.max>0){
      const k=Math.sin((1-squall.t/squall.max)*Math.PI);
      out += squall.dir*squall.amp*k;
    }
    out *= seasonNumber('windMult',1);
    return clamp(out,-CFG.MAX_SPEED,CFG.MAX_SPEED);
  }
  function currentSpeed(){ return override!=null ? override : wind; }
  function altitudeMultiplier(y){
    if(typeof y !== 'number' || !isFinite(y)) return 1;
    const high=1-clamp(y/Math.max(1,WORLD_H-1),0,1);
    return CFG.ALTITUDE_MIN_MULT + (CFG.ALTITUDE_MAX_MULT-CFG.ALTITUDE_MIN_MULT)*Math.pow(high,CFG.ALTITUDE_CURVE);
  }
  function localSpeedAt(_x,y){ return currentSpeed()*altitudeMultiplier(y); }
  function speedAt(x,y,getTile){ return localSpeedAt(x,y)*exposureAt(x,y,getTile); }
  function gasDrift(x,y,t,getTile){
    const tileBoost = (t===T.STEAM || t===T.HOT_AIR) ? 1.15 : (t===T.POISON_GAS ? 0.92 : 1.0);
    return speedAt(x,y,getTile) * CFG.GAS_DRIFT_SCALE * tileBoost;
  }
  function applyToHero(player,dt,getTile,opts){
    if(!player || !(dt>0) || !isFinite(dt)) return {applied:false, delta:0, exposure:0, speed:currentSpeed()};
    opts=opts||{};
    if(opts.godMode) return {applied:false, delta:0, exposure:0, speed:currentSpeed()};
    const sp=localSpeedAt(player.x,player.y-0.2);
    const mag=Math.abs(sp);
    if(mag<0.045) return {applied:false, delta:0, exposure:0, speed:sp};
    const exposure=exposureAt(player.x,player.y-0.2,getTile);
    if(exposure<=0.02) return {applied:false, delta:0, exposure, speed:sp};
    const inWater=!!opts.inWater;
    const airborne=!player.onGround;
    let factor=0;
    if(airborne){
      const jumping=(player.vy||0)<-0.35;
      factor=jumping ? CFG.HERO_JUMPING_BOOST : 0.92;
    }
    else if(mag>CFG.HERO_GROUND_THRESHOLD) factor=CFG.HERO_GROUND_ACCEL*clamp((mag-CFG.HERO_GROUND_THRESHOLD)/(CFG.MAX_SPEED-CFG.HERO_GROUND_THRESHOLD),0,1);
    if(inWater) factor*=0.16;
    if(factor<=0.001) return {applied:false, delta:0, exposure, speed:sp};
    const accel=sp*CFG.HERO_AIR_ACCEL*factor*exposure;
    const before=player.vx||0;
    player.vx=before+accel*dt;
    const max = airborne ? MOVE.MAX*3.25 : MOVE.MAX*1.35;
    if(Math.sign(player.vx)===Math.sign(sp) && Math.abs(player.vx)>max) player.vx=Math.sign(sp)*max;
    return {applied:true, delta:player.vx-before, exposure, speed:sp};
  }
  function openVisualSpot(x,y,getTile){
    const t=getSafe(getTile,x,y,T.AIR);
    if(!isAirLike(t) || t===T.WATER || t===T.LAVA) return false;
    return exposureAt(x,y,getTile)>0.18;
  }
  function materialDescriptor(t,mag){
    if(t===T.SNOW || t===T.ICE) return {kind:'snow', color:'#f4fbff', size:0.045+Math.min(0.05,mag*0.008), lift:0.11, line:0.18};
    if(t===T.SAND) return {kind:'sand', color:'#d9c38e', size:0.055+Math.min(0.05,mag*0.009), lift:0.08, line:0.32};
    if(t===T.MUD) return {kind:'sand', color:'#8a744c', size:0.055, lift:0.045, line:0.24};
    if(t===T.GRASS || isLeafTile(t)) return {kind:'dust', color:t===T.GRASS?'#7fa65a':'#9a7a52', size:0.055+Math.min(0.04,mag*0.007), lift:0.035, line:0.22};
    if(t===T.WOOD) return {kind:'grit', color:Math.random()<0.5?'#a8783d':'#7f552e', size:0.075, lift:0.045, line:0.28};
    if(t===T.COAL || t===T.OBSIDIAN) return {kind:'grit', color:'#2b2b31', size:0.062, lift:0.035, line:0.22};
    if(t===T.STONE || t===T.STEEL || t===T.GLASS || t===T.WIRE || t===T.COPPER_WIRE || t===T.ELECTRONICS || t===T.TRANSISTOR || t===T.DYNAMO || t===T.DYNAMO_SLOT) return {kind:'grit', color:t===T.GLASS?'#bff7ff':'#a4aab2', size:0.055, lift:0.035, line:0.24};
    return {kind:'dust', color:'#d8c7a2', size:0.06+Math.min(0.04,mag*0.008), lift:0.04, line:0.26};
  }
  function nearestMaterialBelow(tx,ty,getTile){
    for(let dy=1; dy<=9; dy++){
      const t=getSafe(getTile,tx,ty+dy,T.AIR);
      if(t===T.AIR || (INFO[t] && INFO[t].gas) || t===T.WATER || t===T.LAVA) continue;
      return t;
    }
    return T.AIR;
  }
  function findSurfaceVisualSpot(player,getTile){
    const x=Math.floor(player.x + (Math.random()*2-1)*CFG.VISUAL_RADIUS_X);
    const start=Math.max(-2, Math.floor(player.y - 8 - Math.random()*4));
    const end=Math.min(WORLD_H-1, Math.floor(player.y + CFG.VISUAL_RADIUS_Y*0.72 + 5));
    for(let y=start; y<=end; y++){
      const t=getSafe(getTile,x,y,T.STONE);
      if(t===T.AIR || (INFO[t] && INFO[t].gas) || t===T.WATER || t===T.LAVA) continue;
      const openY=y-1;
      if(openVisualSpot(x,openY,getTile)){
        return {x, y:openY, material:t};
      }
      break;
    }
    return null;
  }
  function spawnVisualParticle(player,getTile){
    if(!player || typeof getTile !== 'function') return false;
    const cap=particleCap();
    if(particles.length>=cap) return false;
    const playerSp=localSpeedAt(player.x,player.y);
    const playerMag=Math.abs(playerSp);
    let materialTile=T.AIR;
    let surface = playerMag>1.0 && Math.random()<clamp(0.30+playerMag*0.095,0.30,0.82)
      ? findSurfaceVisualSpot(player,getTile)
      : null;
    let tx, ty;
    if(surface){
      tx=surface.x; ty=surface.y; materialTile=surface.material;
    } else {
      const bx=player.x + (Math.random()*2-1)*CFG.VISUAL_RADIUS_X;
      const by=player.y + (Math.random()*2-1)*CFG.VISUAL_RADIUS_Y - 5;
      tx=Math.floor(bx); ty=Math.floor(by);
    }
    if(!surface && !openVisualSpot(tx,ty,getTile)){
      let found=false;
      for(let i=0;i<9;i++){
        tx=Math.floor(player.x + (Math.random()*2-1)*CFG.VISUAL_RADIUS_X);
        ty=Math.floor(player.y - 1 - Math.random()*Math.max(8,CFG.VISUAL_RADIUS_Y));
        if(openVisualSpot(tx,ty,getTile)){ found=true; break; }
      }
      if(!found) return false;
    }
    if(materialTile===T.AIR) materialTile=nearestMaterialBelow(tx,ty,getTile);
    const sp=localSpeedAt(tx,ty);
    const dir=sp<0 ? -1 : 1;
    const mag=Math.abs(sp);
    const mat=materialDescriptor(materialTile,mag);
    const gust=mag>3.0 && Math.random()<clamp((mag-3.0)*0.16,0,0.36);
    const leafy=false;
    particles.push({
      kind:gust?'gust':(leafy?'leaf':mat.kind),
      x:tx+Math.random(),
      y:ty+Math.random(),
      vx:sp*(0.58+Math.random()*0.48) + dir*(0.24+Math.random()*0.42),
      vy:(Math.random()-0.5)*(leafy?0.45:0.22) - mag*(mat.lift||0.04),
      life:0,
      max:(gust?0.55:(leafy?1.25:0.78))+Math.random()*(gust?0.45:0.88),
      phase:Math.random()*Math.PI*2,
      spin:(Math.random()-0.5)*(leafy?8:3),
      size:leafy?(mat.size+Math.random()*0.12):((mat.size||0.06)+Math.random()*0.08),
      line:gust?0.72:(mat.line||0.28),
      material:materialTile,
      color:mat.color
    });
    return true;
  }
  function updateVisuals(dt,player,getTile){
    const mag=player ? Math.abs(localSpeedAt(player.x,player.y)) : Math.abs(currentSpeed());
    if(mag>0.04){
      const cap=particleCap();
      const rate=clamp(1.8 + mag*7.0 + Math.max(0,mag-2.2)*5.5,1.8,42);
      visualAcc += rate*dt;
      while(visualAcc>=1 && particles.length<cap){
        visualAcc-=1;
        if(!spawnVisualParticle(player,getTile)) break;
      }
    } else {
      visualAcc=0;
    }
    const cap=particleCap();
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.life+=dt;
      const k=Math.max(0,1-p.life/p.max);
      p.x += p.vx*dt;
      p.y += (p.vy + Math.sin(p.life*5+p.phase)*0.10*k)*dt;
      p.vx += localSpeedAt(p.x,p.y)*0.045*dt;
      p.vy += (p.kind==='dust'?0.02:0.05)*dt;
      p.phase += (p.spin||0)*dt;
      if(p.life>=p.max) particles.splice(i,1);
    }
    if(particles.length>cap) particles.splice(0,particles.length-cap);
  }
  function update(dt,player,getTile,opts){
    if(!(dt>0) || !isFinite(dt)) return;
    dt=Math.min(0.1,dt);
    simT+=dt;
    const env=computeEnvironment(cycleInfo(),cloudMetrics(opts));
    lastEnv=env;
    maybeStartSquall(dt,env);
    target=override!=null ? override : computeTarget(env);
    const smooth=override!=null ? 1 : Math.min(1,dt*(0.42+env.storm*0.55+env.thermal*0.30));
    wind += (target-wind)*smooth;
    if(Math.abs(wind)<0.006) wind=0;
    updateVisuals(dt,player,getTile);
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile){
    if(!ctx || !particles.length) return;
    const visible=typeof canDrawTile === 'function' ? canDrawTile : null;
    const mag=Math.abs(currentSpeed());
    const baseAlpha=clamp(0.28+mag*0.10,0.22,0.78);
    ctx.save();
    ctx.lineCap='round';
    for(const p of particles){
      if(p.x<sx-2 || p.x>sx+viewX+3 || p.y<sy-2 || p.y>sy+viewY+3) continue;
      const tx=Math.floor(p.x), ty=Math.floor(p.y);
      if(visible && !visible(tx,ty)) continue;
      const age=clamp(p.life/p.max,0,1);
      const a=(1-age)*baseAlpha;
      if(a<=0.015) continue;
      const px=p.x*TILE, py=p.y*TILE;
      if(p.kind==='leaf'){
        ctx.save();
        ctx.translate(px,py);
        ctx.rotate(p.phase||0);
        ctx.fillStyle=p.color;
        ctx.globalAlpha=a;
        const s=Math.max(1,TILE*(p.size||0.14));
        ctx.fillRect(-s*0.5,-s*0.28,s,s*0.56);
        ctx.fillStyle='rgba(255,255,255,0.30)';
        ctx.fillRect(-s*0.2,-s*0.2,s*0.38,1);
        ctx.restore();
      } else if(p.kind==='snow'){
        ctx.strokeStyle=rgba(p.color||'#f4fbff',Math.min(0.92,a*1.18));
        ctx.lineWidth=Math.max(1,TILE*(0.025+Math.min(0.035,mag*0.006)));
        const len=TILE*(0.18+Math.min(0.42,mag*0.055));
        ctx.beginPath();
        ctx.moveTo(px-len*Math.sign(currentSpeed()||1),py);
        ctx.lineTo(px,py+Math.sin(p.phase||0)*TILE*0.02);
        ctx.stroke();
        if(mag>2.6){
          ctx.fillStyle=rgba('#ffffff',Math.min(0.85,a*0.85));
          const s=Math.max(1,TILE*(p.size||0.055));
          ctx.fillRect(px-s*0.5,py-s*0.5,s,s);
        }
      } else {
        ctx.strokeStyle=rgba(p.color||'#d8c7a2',p.kind==='gust'?a*0.62:a);
        ctx.lineWidth=Math.max(1,TILE*(p.kind==='gust'?0.045:0.033));
        const len=TILE*((p.line||0.26)+Math.min(0.62,mag*(p.kind==='gust'?0.10:0.065)));
        ctx.beginPath();
        ctx.moveTo(px-len*Math.sign(currentSpeed()||1),py);
        ctx.lineTo(px,py+Math.sin(p.phase||0)*TILE*0.025);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function setOverride(v){
    override=(typeof v === 'number' && isFinite(v)) ? clamp(v,-CFG.MAX_SPEED,CFG.MAX_SPEED) : null;
    if(override!=null){ target=override; wind=override; }
  }
  function normalizedCloudMetrics(o){
    if(!o || typeof o !== 'object') return null;
    const intensity = o.storm && o.storm.active ? cleanNumber(o.storm.intensity,0,1,1) : 0;
    return {
      clouds:cleanNumber(o.clouds,0,80,0),
      cloudMass:cleanNumber(o.cloudMass,0,240,0),
      storm:{active:intensity>0, intensity}
    };
  }
  function setCycleOverride(o){
    if(o==null){ cycleOverride=null; return; }
    if(typeof o === 'object' && typeof o.isDay === 'boolean' && typeof o.tDay === 'number' && isFinite(o.tDay)) cycleOverride=o;
  }
  function setCloudMetricsOverride(o){
    cloudOverride=normalizedCloudMetrics(o);
    if(!cloudOverride && weatherProfile && weatherProfile.startsWith('custom')) weatherProfile=null;
    return cloudOverride!=null;
  }
  function setWeatherProfile(profile){
    if(profile==null || profile==='natural'){
      cycleOverride=null;
      cloudOverride=null;
      weatherProfile=null;
      return true;
    }
    const id=String(profile);
    const profiles={
      dayClear:{
        cycle:{cycleT:0.25,isDay:true,tDay:0.50},
        clouds:{clouds:0,cloudMass:0,storm:{active:false,intensity:0}}
      },
      thermal:{
        cycle:{cycleT:0.34,isDay:true,tDay:0.56},
        clouds:{clouds:18,cloudMass:88,storm:{active:false,intensity:0}}
      },
      night:{
        cycle:{cycleT:0.76,isDay:false,tDay:0.50},
        clouds:{clouds:4,cloudMass:10,storm:{active:false,intensity:0}}
      },
      storm:{
        cycle:{cycleT:0.47,isDay:true,tDay:0.48},
        clouds:{clouds:32,cloudMass:140,storm:{active:true,intensity:1}}
      }
    };
    const p=profiles[id];
    if(!p) return false;
    cycleOverride=p.cycle;
    cloudOverride=normalizedCloudMetrics(p.clouds);
    weatherProfile=id;
    setOverride(null);
    return true;
  }
  function reset(){
    simT=0; wind=0; target=0; override=null; cycleOverride=null; cloudOverride=null; weatherProfile=null; visualAcc=0; particles.length=0;
    squall.t=0; squall.max=0; squall.amp=0; squall.dir=1;
    lastEnv = {night:0, sun:0, cloudiness:0, thermal:0, storm:0};
  }
  function cleanNumber(v,min,max,fallback){
    return (typeof v === 'number' && isFinite(v)) ? clamp(v,min,max) : fallback;
  }
  function snapshot(){
    return {
      v:1,
      simT:+simT.toFixed(3),
      wind:+wind.toFixed(3),
      target:+target.toFixed(3),
      squall:{
        t:+squall.t.toFixed(3),
        max:+squall.max.toFixed(3),
        amp:+squall.amp.toFixed(3),
        dir:squall.dir<0 ? -1 : 1
      },
      env:{
        night:+lastEnv.night.toFixed(3),
        sun:+lastEnv.sun.toFixed(3),
        cloudiness:+lastEnv.cloudiness.toFixed(3),
        thermal:+lastEnv.thermal.toFixed(3),
        storm:+lastEnv.storm.toFixed(3)
      }
    };
  }
  function restore(data){
    reset();
    if(!data || typeof data !== 'object') return false;
    simT=cleanNumber(data.simT,0,1e9,0);
    wind=cleanNumber(data.wind,-CFG.MAX_SPEED,CFG.MAX_SPEED,0);
    target=cleanNumber(data.target,-CFG.MAX_SPEED,CFG.MAX_SPEED,wind);
    const s=data.squall;
    if(s && typeof s === 'object'){
      squall.t=cleanNumber(s.t,0,120,0);
      squall.max=cleanNumber(s.max,0,120,squall.t);
      squall.amp=cleanNumber(s.amp,0,CFG.MAX_SPEED,0);
      squall.dir=s.dir<0 ? -1 : 1;
      if(squall.t<=0 || squall.max<=0){ squall.t=0; squall.max=0; squall.amp=0; }
    }
    const e=data.env;
    if(e && typeof e === 'object'){
      lastEnv={
        night:cleanNumber(e.night,0,2,0),
        sun:cleanNumber(e.sun,0,1,0),
        cloudiness:cleanNumber(e.cloudiness,0,1,0),
        thermal:cleanNumber(e.thermal,0,1,0),
        storm:cleanNumber(e.storm,0,1,0)
      };
    }
    return true;
  }
  function metrics(){
    return {
      speed:+currentSpeed().toFixed(3),
      target:+target.toFixed(3),
      override:override==null ? null : +override.toFixed(3),
      weatherProfile,
      intensity:+clamp(Math.abs(currentSpeed())/CFG.MAX_SPEED,0,1).toFixed(3),
      particles:particles.length,
      particleCap:particleCap(),
      night:+lastEnv.night.toFixed(3),
      sun:+lastEnv.sun.toFixed(3),
      cloudiness:+lastEnv.cloudiness.toFixed(3),
      thermal:+lastEnv.thermal.toFixed(3),
      storm:+lastEnv.storm.toFixed(3),
      seasonWindMult:+seasonNumber('windMult',1).toFixed(3),
      squall:{active:squall.t>0, tLeft:+squall.t.toFixed(2), amp:+squall.amp.toFixed(3), dir:squall.dir<0?-1:1}
    };
  }

  const api={
    update, draw, reset, snapshot, restore, metrics, speed:currentSpeed, speedAt, gasDrift,
    exposureAt, applyToHero, setOverride, setCycleOverride, setCloudMetricsOverride,
    setWeatherProfile, forceSquall,
    config:CFG,
    _debug:{particles, squall, computeEnvironment, computeTarget, exposureAt, altitudeMultiplier}
  };
  root.MM.wind=api;
})();

export const wind = (typeof window !== 'undefined' && window.MM) ? window.MM.wind : globalThis.MM && globalThis.MM.wind;
export default wind;
