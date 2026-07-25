import { WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSolidCollisionTile } from './material_physics.js';

// Chest burst particles + simple sfx
// API: MM.particles.spawnBurst(x,y,tier,{sound}), spawnSmoke(x,y,intensity,opts),
// update(dt, TILE), draw(ctx, canDrawTile, TILE)
(function(){
  window.MM = window.MM || {};
  const mod = {};

  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  const PARTICLE_CAP = 860;
  const SMOKE_CAP = 320;
  const particles = [];
  const smokeSprites = new Map();
  let smokeCount = 0;
  let fxPressure = 0;
  function frameMs(){
    return (typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
  }
  function currentSmokeCap(){
    const ms=frameMs();
    return ms>42 ? 140 : (ms>26 ? 220 : SMOKE_CAP);
  }
  function currentParticleCap(){
    const ms=frameMs();
    return ms>42 ? 520 : (ms>26 ? 680 : PARTICLE_CAP);
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
  function trimParticlesToCap(cap){
    cap=Math.max(120, Math.min(PARTICLE_CAP, cap|0));
    if(particles.length<=cap) return;
    const removed=particles.splice(0, particles.length-cap);
    removed.forEach(p=>{ if(p && p.kind==='smoke') smokeCount=Math.max(0,smokeCount-1); });
  }
  function updateFxPressure(){
    const ms=frameMs();
    if(ms>42) fxPressure=Math.min(8,fxPressure+2);
    else if(ms>26) fxPressure=Math.min(8,fxPressure+1);
    else fxPressure=Math.max(0,fxPressure-1);
    return fxPressure;
  }
  function trimSmokeCapForPressure(pressure){
    return pressure>=3 ? currentSmokeCap() : SMOKE_CAP;
  }
  function trimParticleCapForPressure(pressure){
    return pressure>=2 ? currentParticleCap() : PARTICLE_CAP;
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
    if(kind==='flake') return 0.55;
    if(kind==='bubble' || kind==='energy') return 0;
    return 0.22;
  }
  function physicalParticleRadius(p){
    if(!p) return 2;
    if(p.kind==='splash') return 1.5;
    if(p.kind==='spark') return Math.max(1.2, Math.min(3.5, (p.size||3)*0.48));
    if(p.kind==='glass') return Math.max(1.4, Math.min(4.2, (p.size||3)*0.58));
    if(p.kind==='impactChip') return Math.max(1.5, Math.min(5.5, (p.size||3)*0.56));
    return 2;
  }
  function physicalParticleBounce(p){
    if(p.kind==='splash') return 0.10;
    if(p.kind==='spark') return 0.22;
    if(p.kind==='glass') return 0.36;
    if(p.kind==='impactChip') return 0.32;
    return 0.28;
  }
  function physicalParticleFriction(p){
    if(p.kind==='glass') return 0.74;
    if(p.kind==='spark') return 0.68;
    if(p.kind==='splash') return 0.42;
    if(p.kind==='impactChip') return 0.62;
    return 0.70;
  }
  function impactPalette(element,tier){
    const e=String(element||tier||'').toLowerCase();
    if(e.indexOf('fire')>=0 || e.indexOf('heat')>=0 || e.indexOf('lava')>=0 || e.indexOf('flame')>=0) return [[255,205,86],[255,112,48],[255,238,156]];
    if(e.indexOf('electric')>=0 || e.indexOf('shock')>=0 || e.indexOf('lightning')>=0) return [[112,246,255],[228,255,255],[88,148,255]];
    if(e.indexOf('water')>=0 || e.indexOf('hose')>=0 || e.indexOf('pressure')>=0) return [[122,214,255],[210,246,255],[74,137,255]];
    if(e.indexOf('ice')>=0 || e.indexOf('chill')>=0 || e.indexOf('frost')>=0 || e.indexOf('cold')>=0) return [[198,244,255],[244,255,255],[126,190,255]];
    if(e.indexOf('gas')>=0 || e.indexOf('poison')>=0 || e.indexOf('toxic')>=0) return [[151,246,116],[222,255,130],[82,188,94]];
    if(e.indexOf('sand')>=0) return [[199,170,104],[239,215,151],[151,119,67]];
    if(e.indexOf('wood')>=0) return [[188,133,72],[231,190,120],[111,70,38]];
    if(e.indexOf('stone')>=0) return [[154,164,174],[220,226,232],[91,101,111]];
    if(e.indexOf('steel')>=0) return [[185,213,235],[244,251,255],[111,148,177]];
    if(e.indexOf('obsidian')>=0) return [[156,105,222],[219,190,255],[74,45,122]];
    if(e.indexOf('diamond')>=0) return [[118,232,242],[232,255,255],[65,169,207]];
    if(e.indexOf('iridium')>=0) return [[189,135,251],[246,228,255],[105,75,194]];
    if(e.indexOf('aquatic')>=0) return [[104,221,235],[220,251,255],[49,132,166]];
    if(e.indexOf('arc')>=0) return [[99,239,255],[235,255,255],[65,132,220]];
    if(e.indexOf('exotic')>=0) return [[255,215,105],[255,247,199],[182,111,219]];
    if(e.indexOf('lucky')>=0 || e.indexOf('special')>=0 || e.indexOf('crit')>=0) return [[255,216,74],[255,248,185],[255,160,64]];
    return [[221,185,116],[255,233,178],[154,122,76]];
  }
  function particleSolidTile(getTile,tx,ty){
    if(!getTile) return false;
    if(ty<WORLD_TOP) return false;
    if(ty>=WORLD_BOTTOM) return true;
    try{ return isSolidCollisionTile(getTile(tx,ty)); }
    catch(e){ return true; }
  }
  function particleOverlapsSolid(getTile,x,y,r,tileSize){
    if(!getTile || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if(y+r>=WORLD_BOTTOM*tileSize) return true;
    if(y+r<WORLD_TOP*tileSize) return false;
    const minX=Math.floor((x-r)/tileSize), maxX=Math.floor((x+r)/tileSize);
    const minY=Math.floor((y-r)/tileSize), maxY=Math.floor((y+r)/tileSize);
    for(let ty=minY; ty<=maxY; ty++){
      for(let tx=minX; tx<=maxX; tx++){
        if(!particleSolidTile(getTile,tx,ty)) continue;
        const left=tx*tileSize, top=ty*tileSize;
        const cx=Math.max(left, Math.min(x, left+tileSize));
        const cy=Math.max(top, Math.min(y, top+tileSize));
        const dx=x-cx, dy=y-cy;
        if(dx*dx+dy*dy <= r*r) return true;
      }
    }
    return false;
  }
  function movePhysicalParticleAxis(p,getTile,tileSize,dx,dy){
    if(!dx && !dy) return false;
    const r=physicalParticleRadius(p);
    const oldX=p.x, oldY=p.y;
    p.x+=dx; p.y+=dy;
    if(!particleOverlapsSolid(getTile,p.x,p.y,r,tileSize)) return false;
    let lo=0, hi=1;
    for(let i=0;i<5;i++){
      const mid=(lo+hi)*0.5;
      const nx=oldX+dx*mid, ny=oldY+dy*mid;
      if(particleOverlapsSolid(getTile,nx,ny,r,tileSize)) hi=mid;
      else lo=mid;
    }
    const safe=Math.max(0,lo-0.025);
    p.x=oldX+dx*safe;
    p.y=oldY+dy*safe;
    const bounce=physicalParticleBounce(p);
    const friction=physicalParticleFriction(p);
    if(dx){
      p.vx=Math.abs(p.vx||0)>0.05 ? -(p.vx||0)*bounce : 0;
      p.vy=(p.vy||0)*friction;
    } else {
      if(dy>0){
        p.onGround=true;
        p.vy=Math.abs(p.vy||0)>0.55 ? -(p.vy||0)*bounce : 0;
        p.vx=(p.vx||0)*friction;
      } else {
        p.vy=Math.abs(p.vy||0)>0.05 ? -(p.vy||0)*Math.max(0.08,bounce*0.65) : 0;
        p.vx=(p.vx||0)*friction;
      }
    }
    return true;
  }
  function integratePhysicalParticle(p,dt,tileSize,getTile){
    if(!getTile){
      p.x += p.vx*dt*tileSize;
      p.y += p.vy*dt*tileSize;
      p.vy += 8*dt;
      return;
    }
    const moveDt=Math.min(0.45, Math.max(0,dt||0));
    p.vy += 8*moveDt;
    const dx=(p.vx||0)*moveDt*tileSize;
    const dy=(p.vy||0)*moveDt*tileSize;
    const steps=Math.max(1, Math.min(8, Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/(tileSize*0.35))));
    p.onGround=false;
    for(let s=0;s<steps;s++){
      movePhysicalParticleAxis(p,getTile,tileSize,dx/steps,0);
      movePhysicalParticleAxis(p,getTile,tileSize,0,dy/steps);
      if(!Number.isFinite(p.x) || !Number.isFinite(p.y)){
        p.life=p.max+1;
        return;
      }
    }
    if(p.onGround){
      p.vx*=Math.pow(0.34,moveDt*8);
      if(Math.abs(p.vx)<0.03) p.vx=0;
      if(Math.abs(p.vy)<0.08) p.vy=0;
    }
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

  function playChestSound(tier,x,y){
    try{
      if(!MM.audio || !MM.audio.play) return;
      const tile=MM.TILE||20;
      const opts=Number.isFinite(x)&&Number.isFinite(y)?{x:x/tile,y:y/tile}:undefined;
      MM.audio.play((tier==='epic'||tier==='legendary')?'golden':'chest',opts);
    }catch(e){ /* ignore */ }
  }

  mod.spawnBurst = function(x,y,tier,opts){
    opts=opts||{};
    const count = 24 + (tier==='legendary'?32 : tier==='epic'?24 : tier==='rare'?12 : tier==='uncommon'?6 : 0);
    for(let i=0;i<count;i++){
      if(particles.length>=currentParticleCap()) break;
      const ang = Math.random()*Math.PI*2;
      const sp = (Math.random()*2 + 1.5) * (tier==='legendary'?1.75 : tier==='epic'?1.6 : tier==='rare'?1.3 : tier==='uncommon'?1.15 : 1);
      particles.push({ x, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp*0.6-1, life:0, max:0.9+Math.random()*0.5, tier });
    }
    if(opts.sound) playChestSound(tier,x,y);
  };

  // Lightweight visual-only sparks for frequent combat impacts. Unlike chest
  // bursts this has no audio and a much smaller particle count.
  mod.spawnSparks = function(x,y,tier,count){
    const n=Math.max(1, Math.min(14, count==null?8:(count|0)));
    for(let i=0;i<n;i++){
      if(particles.length>=currentParticleCap()) break;
      const ang=Math.random()*Math.PI*2;
      const sp=1.0+Math.random()*2.0;
      particles.push({ kind:'spark', x, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp*0.55-0.55, life:0, max:0.22+Math.random()*0.22, tier });
    }
  };

  mod.spawnImpactChips = function(x,y,opts){
    opts=opts||{};
    const power=Math.max(0.35, Math.min(2.4, Number(opts.power)||1));
    const major=!!(opts.major || opts.lucky || opts.critical);
    const fine=!!opts.fine;
    const n=fine
      ? Math.max(10,Math.min(26,Math.round(10+power*13)))
      : Math.max(3,Math.min(22,Math.round((major?8:5)+power*5)));
    const dir=Number.isFinite(opts.dir) && opts.dir!==0 ? (opts.dir>0?1:-1) : 0;
    const palette=impactPalette(opts.element, opts.tier || opts.kind);
    for(let i=0;i<n;i++){
      if(particles.length>=currentParticleCap()) break;
      const base=dir ? (dir>0 ? 0 : Math.PI) : Math.random()*Math.PI*2;
      const spread=(Math.random()-0.5)*(dir ? 1.35 : Math.PI*2);
      const ang=base+spread;
      const sp=(fine?(1.5+Math.random()*3.5):(1.2+Math.random()*2.8))*power*(major?1.18:1);
      const rgb=palette[i%palette.length];
      particles.push({
        kind:'impactChip',
        x:x+(Math.random()-0.5)*8,
        y:y+(Math.random()-0.5)*6,
        vx:Math.cos(ang)*sp + (Math.random()-0.5)*0.45,
        vy:Math.sin(ang)*sp*0.52 - (0.85+Math.random()*1.15)*power,
        life:0,
        max:fine?(0.28+Math.random()*0.28):((major?0.62:0.44)+Math.random()*0.30),
        rot:Math.random()*Math.PI,
        spin:(Math.random()-0.5)*(10+power*7),
        size:fine?(0.7+Math.random()*1.15):((2.0+Math.random()*3.8)*(major?1.12:1)),
        rgb,
        fine,
        glow:!fine && !!(opts.lucky || opts.critical || opts.element)
      });
    }
  };

  mod.spawnTurboSparks = function(x,y,facing,intensity){
    const k=Math.max(0.25, Math.min(1.5, Number(intensity)||0.7));
    const n=Math.max(2, Math.min(9, Math.round(2+k*4)));
    const dir=(Number(facing)||1)>=0 ? 1 : -1;
    for(let i=0;i<n;i++){
      if(particles.length>=currentParticleCap()) break;
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

  mod.spawnEnergyAbsorb = function(fromX,fromY,toX,toY,intensity,opts){
    opts=opts||{};
    const k=Math.max(0.15, Math.min(1.6, Number(intensity)||0.5));
    const quick=!!opts.quick;
    const ms=frameMs();
    let n=Math.round(3 + 8*k);
    if(quick) n=Math.max(2, Math.round(n*0.7));
    if(ms>34) n=Math.max(2, Math.round(n*0.45));
    else if(ms>24) n=Math.max(3, Math.round(n*0.65));
    for(let i=0;i<n;i++){
      if(particles.length>=currentParticleCap()) break;
      const ox=(Math.random()-0.5)*14;
      const oy=(Math.random()-0.5)*14;
      const hue = opts.hue==='gold' || opts.hue==='cyan'
        ? opts.hue
        : (Math.random()<0.65?'cyan':'gold');
      particles.push({
        kind:'energy',
        x:fromX+ox,
        y:fromY+oy,
        px:fromX+ox,
        py:fromY+oy,
        tx:toX+(Math.random()-0.5)*10,
        ty:toY+(Math.random()-0.5)*14,
        life:0,
        max:quick ? (0.12+Math.random()*0.12) : (0.26+Math.random()*0.28),
        phase:Math.random()*Math.PI*2,
        wobble:quick ? (0.18+Math.random()*0.42) : (0.35+Math.random()*0.65),
        hue
      });
    }
  };

  mod.spawnGlassShards = function(x,y,count){
    const n=Math.max(3, Math.min(24, count==null?14:(count|0)));
    for(let i=0;i<n;i++){
      if(particles.length>=currentParticleCap()) break;
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

  // Soft-drift flakes (engine/soft_drifts.js): featherweight debris kicked out
  // of a drift or shaken from a canopy. Snowflakes and leaves flutter down on
  // the wind; soot motes rise off the film and thin out. Purely cosmetic.
  const FLAKE_PRESETS = {
    snow:  { fall: 1.6, sway: 0.9, shape:'dot',  life:[0.9,1.0], size:[1.6,1.6], palette:[[244,250,255],[220,236,252],[255,255,255]] },
    leaves:{ fall: 2.2, sway: 1.5, shape:'leaf', life:[1.0,1.1], size:[2.4,2.2], palette:[[214,131,47],[143,90,42],[196,84,38],[176,142,58]] },
    soot:  { fall:-0.55, sway: 0.8, shape:'dot',  life:[0.8,0.9], size:[1.4,1.4], palette:[[38,40,46],[56,58,64],[26,27,31]] },
    sand:  { fall: 2.6, sway: 0.5, shape:'dot',  life:[0.7,0.8], size:[1.2,1.2], palette:[[217,192,120],[236,217,155],[168,144,92]] },
  };
  mod.spawnFlakes = function(x,y,opts){
    opts=opts||{};
    const preset=FLAKE_PRESETS[opts.mat]||FLAKE_PRESETS.snow;
    const n=Math.max(1, Math.min(26, opts.count==null?8:(opts.count|0)));
    const dir=Number.isFinite(opts.dir)?(opts.dir>=0?1:-1):0;
    // loose flakes (ambient canopy fall) drift long and slow instead of bursting
    const loose=!!opts.loose;
    for(let i=0;i<n;i++){
      if(particles.length>=currentParticleCap()) break;
      const rgb=preset.palette[i%preset.palette.length];
      particles.push({
        kind:'flake', mat:opts.mat||'snow',
        x:x+(Math.random()-0.5)*10,
        y:y+(Math.random()-0.5)*6,
        vx:(Math.random()-0.5)*(loose?0.5:1.7) + dir*(loose?0.25:0.6),
        vy:loose ? 0.2+Math.random()*0.4 : -(0.4+Math.random()*1.2),
        life:0,
        max:(preset.life[0]+Math.random()*preset.life[1])*(loose?1.9:1),
        rot:Math.random()*Math.PI,
        spin:(Math.random()-0.5)*6,
        phase:Math.random()*Math.PI*2,
        sway:preset.sway*(0.7+Math.random()*0.6),
        fall:preset.fall,
        shape:preset.shape,
        size:preset.size[0]+Math.random()*preset.size[1],
        rgb
      });
    }
  };

  // Water splash: droplets fan upward from the surface, fall back under gravity.
  // x,y in world pixels; intensity 0..1 scales count and speed.
  mod.spawnSplash = function(x,y,intensity){
    const k = Math.max(0.15, Math.min(1, intensity||0.5));
    const count = Math.round(6 + 18*k);
    for(let i=0;i<count;i++){
      if(particles.length>=currentParticleCap()) break;
      const ang = -Math.PI/2 + (Math.random()-0.5)*1.4; // mostly upward fan
      const sp = (1.2 + Math.random()*2.4) * (0.5 + k);
      particles.push({ kind:'splash', x:x+(Math.random()-0.5)*10, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp, life:0, max:0.35+Math.random()*0.45 });
    }
  };

  // Air bubble: rises with a sine wobble, pops at the end of its life.
  mod.spawnBubble = function(x,y){
    if(particles.length>=currentParticleCap()) return;
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
      if(particles.length>=currentParticleCap() || smokeCount>=cap) break;
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
    const tileFn=typeof getTile === 'function' ? getTile : fallbackGetTile();
    // One bad frame should fade effects, not pop them. Hard trimming starts only
    // after pressure persists for multiple frames.
    const pressure=updateFxPressure();
    trimSmokeToCap(trimSmokeCapForPressure(pressure));
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
        const worldWind=windAtParticle(p,tileSize,tileFn)*windResponse('smoke');
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
      } else if(p.kind==='flake'){
        // featherweight flutter: wind + sinusoidal sway, terminal fall (soot rises)
        const worldWind=windAtParticle(p,tileSize,tileFn);
        p.vx += worldWind*windResponse('flake')*dt;
        p.vx *= Math.pow(0.5,dt*1.6);
        p.vy += (p.fall||1.6)*dt;
        if(p.fall>=0){ if(p.vy>2.2) p.vy=2.2; } else if(p.vy<-1.2) p.vy=-1.2;
        p.x += (p.vx + Math.sin(p.life*4.2+(p.phase||0))*(p.sway||1))*dt*tileSize;
        p.y += p.vy*dt*tileSize;
        p.rot=(p.rot||0)+(p.spin||0)*dt;
      } else {
        const worldWind=windAtParticle(p,tileSize,tileFn);
        p.vx += worldWind*windResponse(p.kind)*dt;
        if(p.kind==='impactChip' || p.kind==='glass') p.rot=(p.rot||0)+(p.spin||0)*dt;
        integratePhysicalParticle(p,dt,tileSize,tileFn);
      }
      if(p.life>p.max){
        if(p.kind==='smoke') smokeCount=Math.max(0,smokeCount-1);
        particles.splice(i,1);
      }
    }
    trimParticlesToCap(trimParticleCapForPressure(pressure));
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
        let sp=p._sp;
        if(sp===undefined) sp=p._sp=smokeSprite(shade,p.variant||0);
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
      } else if(p.kind==='impactChip'){
        const rgb=Array.isArray(p.rgb) ? p.rgb : [221,185,116];
        const s=p.size||3;
        ctx.save();
        ctx.translate(p.x,p.y);
        ctx.rotate(p.rot||0);
        if(p.glow) ctx.globalCompositeOperation='lighter';
        ctx.fillStyle='rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(alpha*0.88).toFixed(3)+')';
        if(p.fine){
          ctx.fillRect(-s*0.5,-s*0.5,Math.max(0.75,s),Math.max(0.75,s));
        }else{
          ctx.fillRect(-s*0.55,-Math.max(1,s*0.32),s*1.1,Math.max(1.5,s*0.64));
          ctx.fillStyle='rgba(255,255,255,'+(alpha*0.34).toFixed(3)+')';
          ctx.fillRect(-s*0.18,-s*0.48,Math.max(1,s*0.36),s*0.92);
        }
        ctx.restore();
      } else if(p.kind==='flake'){
        const rgb=Array.isArray(p.rgb) ? p.rgb : [244,250,255];
        const s=p.size||2;
        ctx.save();
        ctx.translate(p.x,p.y);
        ctx.rotate(p.rot||0);
        ctx.fillStyle='rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(alpha*0.9).toFixed(3)+')';
        if(p.shape==='leaf'){
          ctx.fillRect(-s*0.6,-s*0.32,s*1.2,s*0.64);
          ctx.fillStyle='rgba('+Math.max(0,rgb[0]-52)+','+Math.max(0,rgb[1]-40)+','+Math.max(0,rgb[2]-24)+','+(alpha*0.7).toFixed(3)+')';
          ctx.fillRect(-s*0.6,-0.5,s*1.2,1);
        } else {
          ctx.fillRect(-s*0.5,-s*0.5,s,s);
        }
        ctx.restore();
      } else if(p.kind==='spark'){
        const electric = p.tier==='turbo' || p.tier==='electric';
        const s=p.size||3;
        ctx.save();
        if(electric) ctx.globalCompositeOperation='lighter';
        ctx.fillStyle = electric
          ? 'rgba(155,248,255,'+(alpha*0.95)+')'
          : (p.tier==='legendary'? 'rgba(88,224,216,'+alpha+')' : p.tier==='epic'? 'rgba(224,179,65,'+alpha+')' : p.tier==='rare'? 'rgba(167,76,201,'+alpha+')' : p.tier==='uncommon'? 'rgba(63,166,80,'+alpha+')' : 'rgba(176,127,44,'+alpha+')');
        ctx.fillRect(p.x - s*0.5, p.y - s*0.5, s, s);
        if(electric){
          ctx.fillStyle='rgba(255,255,255,'+(alpha*0.78)+')';
          ctx.fillRect(p.x-0.5,p.y-s*0.75,1,s*1.5);
          ctx.fillStyle='rgba(82,150,255,'+(alpha*0.45)+')';
          ctx.fillRect(p.x-s*0.9,p.y-0.5,s*1.8,1);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = p.tier==='legendary'? 'rgba(88,224,216,'+alpha+')' : p.tier==='epic'? 'rgba(224,179,65,'+alpha+')' : p.tier==='rare'? 'rgba(167,76,201,'+alpha+')' : p.tier==='uncommon'? 'rgba(63,166,80,'+alpha+')' : 'rgba(176,127,44,'+alpha+')';
        ctx.fillRect(p.x -2, p.y -2, 4, 4);
      }
    }
  };

  // Clear particles (world regen / fresh start)
  mod.reset = function(){ particles.length = 0; smokeCount = 0; fxPressure = 0; };
  // Live particle count (debug / tests)
  mod.count = function(){ return particles.length; };
  mod.smokeCount = function(){ return smokeCount; };
  mod.metrics = function(){
    const ms=frameMs();
    return {
      particles:particles.length,
      particleCap:currentParticleCap(),
      fxPressure,
      smoke:smokeCount,
      smokeSprites:smokeSprites.size,
      smokeCap:currentSmokeCap(),
      smokeMaxCap:SMOKE_CAP,
      smokeAlphaScale:smokeDrawAlphaScale(ms,smokeCount)
    };
  };
  mod._debugSnapshot = function(){ return particles.map(p=>({kind:p.kind,x:p.x,y:p.y,vx:p.vx,vy:p.vy,life:p.life,max:p.max,r:p.r,alpha:p.alpha,tileX:p.tileX,tileY:p.tileY,hue:p.hue,onGround:!!p.onGround,size:p.size,rgb:p.rgb,glow:!!p.glow})); };
  mod._debugAdd = function(p){
    if(!p || typeof p!=='object') return;
    particles.push(Object.assign({x:0,y:0,vx:0,vy:0,life:0,max:1,tier:'common'},p));
  };

  MM.particles = mod;
})();
// ESM export (progressive migration)
export const particles = (typeof window!=='undefined' && window.MM) ? window.MM.particles : undefined;
export default particles;
