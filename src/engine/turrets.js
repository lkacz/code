// Powered defensive turrets. They reuse the copper/dynamo/solar network exposed
// by teleporters, but keep local batteries and light bounded targeting state.
import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isPlayerPassableTile, isSolidCollisionTile as isSolid } from './material_physics.js';

const turrets = (function(){
  const MM = window.MM = window.MM || {};

  const TURRET_CAPACITY = 90;
  const CHARGE_RATE = 36;
  const CATCHUP_MAX_SECONDS = 900;
  const MACHINE_CAP = 260;
  const SHOT_FX_CAP = 90;
  const PUFF_CAP = 120;
  const PLAYER_SCAN_INTERVAL = 0.45;
  const VISIBLE_SCAN_INTERVAL_MS = 220;
  const WATER_TURRET_TANK = 24;
  const WATER_TURRET_START_WATER = 18;
  const WATER_TURRET_WATER_PER_SHOT = 1;

  const KIND_BY_TILE = {
    [T.TURRET]:'standard',
    [T.FIRE_TURRET]:'fire',
    [T.WATER_TURRET]:'water'
  };
  const CFG = {
    standard:{range:13.5,cost:8,cooldown:0.52,damage:5.5,scan:0.22,color:'#b8e8ff',core:'#f6fbff',sound:'beam',width:0.07},
    fire:{range:10.5,cost:11,cooldown:0.72,damage:3.2,scan:0.24,color:'#ff7a24',core:'#ffe58f',sound:'flame',width:0.14,burn:true},
    water:{range:9.5,cost:6,cooldown:0.30,damage:1.15,scan:0.18,color:'#54d8ff',core:'#d7fbff',sound:'hose',width:0.11,water:true}
  };

  const machines = new Map();
  const shots = [];
  const puffs = [];
  let scanT = 0;
  let visibleScanKey = '';
  let visibleScanAt = 0;
  let totalShots = 0;
  let totalHits = 0;
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(Math.floor(x),Math.floor(y)) : fallback; }catch(e){ return fallback; }
  }
  function worldHasInfrastructure(x,y,t){
    try{
      return !!(MM.world && typeof MM.world.hasInfrastructure==='function' && MM.world.hasInfrastructure(Math.floor(x),Math.floor(y),t));
    }catch(e){ return false; }
  }
  function getElectricNetworkTile(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(worldHasInfrastructure(x,y,T.COPPER_WIRE)) return T.COPPER_WIRE;
    try{
      if(MM.world && typeof MM.world.getNetworkTile==='function'){
        const t=MM.world.getNetworkTile(x,y);
        if(t===T.COPPER_WIRE) return T.COPPER_WIRE;
      }
    }catch(e){}
    return getSafe(getTile,x,y,T.AIR);
  }
  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function isTurretTile(t){ return !!KIND_BY_TILE[t]; }
  function kindForTile(t){ return KIND_BY_TILE[t] || null; }
  function clampEnergy(n){ return clamp(Number(n)||0,0,TURRET_CAPACITY); }
  function cfgFor(kind){ return CFG[kind] || CFG.standard; }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function waterCapacityFor(m){
    if(!m || m.kind!=='water') return 0;
    const info=INFO[T.WATER_TURRET] || {};
    return Math.max(1,Number(info.waterCapacity)||WATER_TURRET_TANK);
  }
  function clampWater(n,m){ return clamp(Number(n)||0,0,waterCapacityFor(m)); }

  function ensureMachine(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y)) return null;
    const t=getSafe(getTile,x,y,T.AIR);
    const kind=kindForTile(t);
    if(!kind) return null;
    const k=key(x,y);
    let m=machines.get(k);
    if(!m){
      m={x,y,kind,energy:0,cooldown:Math.random()*0.25,scanT:Math.random()*0.18,pulse:0,aim:0,target:null,lastSeen:0,activeT:0};
      machines.set(k,m);
    }
    m.x=x; m.y=y; m.kind=kind;
    m.energy=clampEnergy(m.energy);
    if(kind==='water'){
      if(typeof m.water!=='number') m.water=Math.min(WATER_TURRET_START_WATER,waterCapacityFor(m));
      m.water=clampWater(m.water,m);
    }else{
      delete m.water;
    }
    m.cooldown=Math.max(0,Number(m.cooldown)||0);
    m.scanT=Math.max(0,Number(m.scanT)||0);
    m.pulse=clamp(Number(m.pulse)||0,0,1);
    return m;
  }

  function scanNearby(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(Number(player.x)||0);
    const cy=Math.floor(Number(player.y)||0);
    const rx=58, ry=36;
    const y0=Math.max(WORLD_TOP,cy-ry), y1=Math.min(WORLD_BOTTOM-1,cy+ry);
    for(let y=y0; y<=y1; y++){
      for(let x=cx-rx; x<=cx+rx; x++){
        if(isTurretTile(getSafe(getTile,x,y,T.AIR))) ensureMachine(x,y,getTile);
      }
    }
  }

  function ensureVisibleMachines(sx,sy,viewX,viewY,getTile){
    if(typeof getTile!=='function') return;
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(WORLD_TOP,Math.floor(sy)-2), y1=Math.min(WORLD_BOTTOM-1,Math.ceil(sy+viewY)+2);
    const now=nowMs();
    const scanKey=x0+','+x1+','+y0+','+y1;
    if(scanKey===visibleScanKey && now-visibleScanAt<VISIBLE_SCAN_INTERVAL_MS) return;
    visibleScanKey=scanKey;
    visibleScanAt=now;
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(isTurretTile(getSafe(getTile,x,y,T.AIR))) ensureMachine(x,y,getTile);
      }
    }
  }

  function lineClear(x0,y0,x1,y1,getTile,ownX,ownY,targetX,targetY){
    if(typeof getTile!=='function') return true;
    const dx=x1-x0, dy=y1-y0;
    const dist=Math.hypot(dx,dy)||1;
    const steps=Math.max(2,Math.ceil(dist*4));
    for(let i=1; i<steps; i++){
      const f=i/steps;
      const tx=Math.floor(x0+dx*f);
      const ty=Math.floor(y0+dy*f);
      if(tx===ownX && ty===ownY) continue;
      if(tx===targetX && ty===targetY) continue;
      const t=getSafe(getTile,tx,ty,T.AIR);
      if(isPlayerPassableTile(t)) continue;
      if(isSolid(t)) return false;
    }
    return true;
  }

  function wrapTarget(kind,raw,x,y,hp,extra){
    const tx=Number.isFinite(extra && extra.tx) ? Math.floor(extra.tx) : Math.floor(x);
    const ty=Number.isFinite(extra && extra.ty) ? Math.floor(extra.ty) : Math.floor(y);
    return Object.assign({kind,raw,x,y,tx,ty,hp},extra||{});
  }
  function targetEntity(target){
    return target && (target.raw || target.mob || target.boss || null);
  }
  function normalizeExternalTarget(target){
    if(!target) return null;
    if(target.kind==='hero' || target.hero){
      const hero=target.hero || target.raw || target;
      const x=Number.isFinite(Number(target.x)) ? Number(target.x) : Number(hero && hero.x);
      const y=Number.isFinite(Number(target.y)) ? Number(target.y) : Number(hero && hero.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const hp=Number.isFinite(Number(target.hp)) ? Number(target.hp) : (Number.isFinite(Number(hero && hero.hp)) ? Number(hero.hp) : 1);
      if(!(hp>0)) return null;
      return wrapTarget('hero',hero,x,y,hp,{hero,tx:Math.floor(x),ty:Math.floor(y),source:target.source||'mounted_turret'});
    }
    return target;
  }
  function targetDistance2(m,target){
    const c=targetCoords(target);
    if(!c) return Infinity;
    const dx=c.x-(m.x+0.5), dy=c.y-(m.y+0.5);
    return dx*dx+dy*dy;
  }
  function nearestMobTarget(m,getTile){
    const cfg=cfgFor(m.kind);
    const sx=m.x+0.5, sy=m.y+0.5;
    let target=null;
    try{
      if(MM.mobs && MM.mobs.nearestLiving){
        target=MM.mobs.nearestLiving(sx,sy,cfg.range,{exclude:['ZLOTY']});
      }
    }catch(e){ target=null; }
    if(!target || !(target.hp>0)) return null;
    const tx=Number(target.x), ty=Number(target.y);
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    const out=wrapTarget('mob',target,tx,ty,target.hp,{mob:target});
    if(!lineClear(sx,sy,tx,ty,getTile,m.x,m.y,out.tx,out.ty)) return null;
    return out;
  }
  function nearestBossTarget(m,getTile,onlyBoss){
    const cfg=cfgFor(m.kind);
    const sx=m.x+0.5, sy=m.y+0.5;
    let targets=[];
    try{
      if(MM.bosses && MM.bosses.targetsForTurret){
        targets=MM.bosses.targetsForTurret(sx,sy,cfg.range,onlyBoss) || [];
      }else if(MM.bosses && MM.bosses.nearestForTurret){
        const target=MM.bosses.nearestForTurret(sx,sy,cfg.range,onlyBoss);
        targets=target ? [target] : [];
      }
    }catch(e){ targets=[]; }
    try{
      if(MM.guardianLairs && MM.guardianLairs.targetsForTurret){
        targets=targets.concat(MM.guardianLairs.targetsForTurret(sx,sy,cfg.range,onlyBoss) || []);
      }else if(MM.guardianLairs && MM.guardianLairs.nearestForTurret){
        const target=MM.guardianLairs.nearestForTurret(sx,sy,cfg.range,onlyBoss);
        if(target) targets.push(target);
      }
    }catch(e){}
    try{
      if(MM.undergroundBoss && MM.undergroundBoss.targetsForTurret){
        targets=targets.concat(MM.undergroundBoss.targetsForTurret(sx,sy,cfg.range,onlyBoss) || []);
      }else if(MM.undergroundBoss && MM.undergroundBoss.nearestForTurret){
        const target=MM.undergroundBoss.nearestForTurret(sx,sy,cfg.range,onlyBoss);
        if(target) targets.push(target);
      }
    }catch(e){}
    try{
      if(MM.skyGuardian && MM.skyGuardian.targetsForTurret){
        targets=targets.concat(MM.skyGuardian.targetsForTurret(sx,sy,cfg.range,onlyBoss) || []);
      }else if(MM.skyGuardian && MM.skyGuardian.nearestForTurret){
        const target=MM.skyGuardian.nearestForTurret(sx,sy,cfg.range,onlyBoss);
        if(target) targets.push(target);
      }
    }catch(e){}
    targets.sort((a,b)=>(a.d2||0)-(b.d2||0));
    for(const target of targets){
      const tx=Number(target && target.x), ty=Number(target && target.y);
      if(!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      if(target.kind==='guardian' || target.guardian){
        const out=wrapTarget('guardian',target.guardian || target.raw || target,tx,ty,target.hp || 1,Object.assign({},target,{guardian:target.guardian || target.raw || target}));
        if(!lineClear(sx,sy,tx,ty,getTile,m.x,m.y,out.tx,out.ty)) continue;
        return out;
      }
      if(target.kind==='underground' || target.underground){
        const out=wrapTarget('underground',target.underground || target.raw || target,tx,ty,target.hp || 1,Object.assign({},target,{underground:target.underground || target.raw || target}));
        if(!lineClear(sx,sy,tx,ty,getTile,m.x,m.y,out.tx,out.ty)) continue;
        return out;
      }
      if(target.kind==='skyGuardian' || target.skyGuardian){
        const out=wrapTarget('skyGuardian',target.skyGuardian || target.raw || target,tx,ty,target.hp || 1,Object.assign({},target,{skyGuardian:target.skyGuardian || target.raw || target}));
        if(!lineClear(sx,sy,tx,ty,getTile,m.x,m.y,out.tx,out.ty)) continue;
        return out;
      }
      const out=wrapTarget('boss',target.boss || target.raw || target,tx,ty,target.hp || 1,Object.assign({},target,{boss:target.boss || target.raw || target}));
      if(!lineClear(sx,sy,tx,ty,getTile,m.x,m.y,out.tx,out.ty)) continue;
      return out;
    }
    return null;
  }
  function nearestUfoTarget(m,getTile){
    const cfg=cfgFor(m.kind);
    const sx=m.x+0.5, sy=m.y+0.5;
    let craft=null;
    try{
      if(MM.ufo && MM.ufo.current) craft=MM.ufo.current();
    }catch(e){ craft=null; }
    if(!craft || !(craft.hp>0)) return null;
    const tx=Number(craft.x), ty=Number(craft.y);
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    const dx=tx-sx, dy=ty-sy;
    if(dx*dx+dy*dy>cfg.range*cfg.range) return null;
    const out=wrapTarget('ufo',craft,tx,ty,craft.hp,{ufo:craft});
    if(!lineClear(sx,sy,tx,ty,getTile,m.x,m.y,out.tx,out.ty)) return null;
    return out;
  }
  function nearestHostileTarget(m,getTile){
    const targets=[nearestMobTarget(m,getTile), nearestBossTarget(m,getTile), nearestUfoTarget(m,getTile)].filter(Boolean);
    let best=null, bd=Infinity;
    for(const t of targets){
      const d=targetDistance2(m,t);
      if(d<bd){ bd=d; best=t; }
    }
    return best;
  }
  function nearestFireTarget(m,getTile){
    if(m.kind!=='water' || !MM.fire || typeof MM.fire.isBurning!=='function') return null;
    const cfg=cfgFor(m.kind);
    const sx=m.x+0.5, sy=m.y+0.5;
    const r=Math.ceil(cfg.range), r2=cfg.range*cfg.range;
    let best=null, bd=Infinity;
    const y0=Math.max(WORLD_TOP,m.y-r), y1=Math.min(WORLD_BOTTOM-1,m.y+r);
    for(let y=y0; y<=y1; y++){
      for(let x=m.x-r; x<=m.x+r; x++){
        const cx=x+0.5, cy=y+0.5;
        const dx=cx-sx, dy=cy-sy, d2=dx*dx+dy*dy;
        if(d2>r2 || d2>=bd) continue;
        let burning=false;
        try{ burning=!!MM.fire.isBurning(x,y); }catch(e){ burning=false; }
        if(!burning) continue;
        if(!lineClear(sx,sy,cx,cy,getTile,m.x,m.y,x,y)) continue;
        best={kind:'fire',x:cx,y:cy,tx:x,ty:y,hp:1};
        bd=d2;
      }
    }
    return best;
  }
  function targetCoords(target){
    if(!target) return null;
    const x=Number(target.x), y=Number(target.y);
    if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const tx=Number.isFinite(target.tx) ? Math.floor(target.tx) : Math.floor(x);
    const ty=Number.isFinite(target.ty) ? Math.floor(target.ty) : Math.floor(y);
    return {x,y,tx,ty,fire:target.kind==='fire'};
  }
  function refreshTarget(m,target,getTile){
    if(!target) return null;
    if(target.kind==='mob'){
      const mob=targetEntity(target);
      if(!mob || !(mob.hp>0)) return null;
      const x=Number(mob.x), y=Number(mob.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      target.x=x; target.y=y; target.tx=Math.floor(x); target.ty=Math.floor(y); target.hp=mob.hp;
      return target;
    }
    if(target.kind==='boss'){
      const boss=target.boss || targetEntity(target);
      if(!boss || boss.dead) return null;
      const part=target.part;
      if(part && part.hp>0 && (!Array.isArray(boss.parts) || boss.parts.includes(part))){
        const x=Number(boss.x)+Number(part.dx)+0.5;
        const y=Number(boss.y)+Number(part.dy)+0.5;
        if(Number.isFinite(x) && Number.isFinite(y)){
          target.x=x; target.y=y; target.tx=Math.floor(x); target.ty=Math.floor(y); target.hp=part.hp; target.raw=boss; target.boss=boss;
          return target;
        }
      }
      const fresh=nearestBossTarget(m,getTile,boss);
      if(!fresh) return null;
      const x=Number(fresh.x), y=Number(fresh.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      target.x=x; target.y=y; target.tx=Number.isFinite(fresh.tx)?Math.floor(fresh.tx):Math.floor(x); target.ty=Number.isFinite(fresh.ty)?Math.floor(fresh.ty):Math.floor(y);
      target.hp=fresh.hp || 1; target.boss=fresh.boss || boss; target.raw=target.boss; target.part=fresh.part;
      return target;
    }
    if(target.kind==='guardian'){
      const guardian=target.guardian || targetEntity(target);
      if(!guardian || guardian.dead || !(guardian.hp>0)) return null;
      const x=Number(guardian.x), y=Number(guardian.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      target.x=x; target.y=y; target.tx=Math.floor(x); target.ty=Math.floor(y); target.hp=guardian.hp; target.guardian=guardian; target.raw=guardian;
      return target;
    }
    if(target.kind==='underground'){
      const underground=target.underground || targetEntity(target);
      if(!underground || underground.dead || !(underground.hp>0)) return null;
      const x=Number(underground.x), y=Number(underground.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      target.x=x; target.y=y; target.tx=Math.floor(x); target.ty=Math.floor(y); target.hp=underground.hp; target.underground=underground; target.raw=underground;
      return target;
    }
    if(target.kind==='skyGuardian'){
      const sky=target.skyGuardian || targetEntity(target);
      if(!sky || sky.dead || !(sky.hp>0)) return null;
      const x=Number(sky.x), y=Number(sky.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      target.x=x; target.y=y; target.tx=Math.floor(x); target.ty=Math.floor(y); target.hp=sky.hp; target.skyGuardian=sky; target.raw=sky;
      return target;
    }
    if(target.kind==='ufo'){
      let craft=null;
      try{ if(MM.ufo && MM.ufo.current) craft=MM.ufo.current(); }catch(e){ craft=null; }
      if(!craft || !(craft.hp>0)) return null;
      const x=Number(craft.x), y=Number(craft.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      target.x=x; target.y=y; target.tx=Math.floor(x); target.ty=Math.floor(y); target.hp=craft.hp; target.ufo=craft; target.raw=craft;
      return target;
    }
    if(target.kind==='hero'){
      const hero=target.hero || target.raw || (typeof window!=='undefined' ? window.player : null);
      if(!hero) return null;
      const hp=Number.isFinite(Number(hero.hp)) ? Number(hero.hp) : target.hp;
      if(!(hp>0)) return null;
      const x=Number(hero.x), y=Number.isFinite(Number(target.y)) ? Number(target.y) : Number(hero.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
      target.x=x; target.y=y; target.tx=Math.floor(x); target.ty=Math.floor(y); target.hp=hp; target.hero=hero; target.raw=hero;
      return target;
    }
    return target;
  }
  function targetStillValid(m,target,getTile){
    target=refreshTarget(m,target,getTile);
    if(!target) return false;
    const c=targetCoords(target);
    if(!c) return false;
    if(c.fire){
      try{ if(!MM.fire || typeof MM.fire.isBurning!=='function' || !MM.fire.isBurning(target.tx,target.ty)) return false; }catch(e){ return false; }
    }else if(!(target.hp>0)) return false;
    return lineClear(m.x+0.5,m.y+0.5,c.x,c.y,getTile,m.x,m.y,c.tx,c.ty);
  }

  function damageAt(tx,ty,dmg){
    let hit=false;
    // The center mirror reflects turret fire too: automated blows are still the hero's.
    try{ if(MM.centerGuardian && MM.centerGuardian.damageAt && MM.centerGuardian.damageAt(tx,ty,dmg,{source:'turret',kind:'turret'})){ return true; } }catch(e){}
    try{ if(MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    try{ if(MM.guardianLairs && MM.guardianLairs.damageAt && MM.guardianLairs.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    try{ if(MM.undergroundBoss && MM.undergroundBoss.damageAt && MM.undergroundBoss.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    try{ if(MM.skyGuardian && MM.skyGuardian.damageAt && MM.skyGuardian.damageAt(tx,ty,dmg,{source:'turret',kind:'turret'})) hit=true; }catch(e){}
    try{ if(MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    return hit;
  }
  function damageTargetAt(target,tx,ty,dmg,sx,sy,kind){
    if(target && target.kind==='hero'){
      const element=kind==='fire' ? 'fire' : (kind==='water' ? 'water' : 'electric');
      const cause=kind==='fire' ? 'alien_mech_fire_turret' : (kind==='water' ? 'alien_mech_water_turret' : 'alien_mech_turret');
      let hit=false;
      try{
        if(typeof window.damageHero === 'function'){
          hit = window.damageHero(dmg,{cause,srcX:sx,srcY:sy,kb:kind==='water'?1.4:3.4,kbY:kind==='fire'?-1.6:-2.1,element,source:'turret'}) !== false;
        }
      }catch(e){}
      if(!hit){
        const hero=target.hero || target.raw;
        if(hero && typeof hero.hp === 'number'){
          hero.hp=Math.max(0,hero.hp-Math.max(1,Math.round(Number(dmg)||1)));
          hit=true;
        }
      }
      return hit;
    }
    return damageAt(tx,ty,dmg);
  }

  function pushShot(fx){
    if(shots.length>=SHOT_FX_CAP) shots.shift();
    shots.push(fx);
  }
  function pushPuff(p){
    if(puffs.length>=PUFF_CAP) puffs.shift();
    puffs.push(p);
  }
  function spawnFirePuffs(sx,sy,dx,dy,range){
    try{
      if(MM.weapons && typeof MM.weapons.spawnExternalStream==='function'){
        return MM.weapons.spawnExternalStream('flame',sx,sy,dx,dy,{range,dps:CFG.fire.damage*2.1,emitScale:1.8,spread:0.24,muzzle:0.38,speedMult:1.02,vyKick:-0.35,scale:1.08});
      }
    }catch(e){}
    const n=10;
    for(let i=0;i<n;i++){
      const spread=(Math.random()-0.5)*0.34;
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const vx=dx*ca-dy*sa, vy=dx*sa+dy*ca;
      pushPuff({kind:'fire',x:sx+dx*0.3,y:sy+dy*0.3,vx:vx*(8+Math.random()*3),vy:vy*(8+Math.random()*3)-0.7,life:0.30+range*0.018,total:0.30+range*0.018});
    }
  }
  function spawnWaterPuffs(sx,sy,dx,dy,range){
    const n=8;
    for(let i=0;i<n;i++){
      const spread=(Math.random()-0.5)*0.25;
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const vx=dx*ca-dy*sa, vy=dx*sa+dy*ca;
      pushPuff({kind:'water',x:sx+dx*0.25,y:sy+dy*0.25,vx:vx*(9+Math.random()*4),vy:vy*(9+Math.random()*4)-0.2,life:0.25+range*0.014,total:0.25+range*0.014});
    }
  }

  function extinguishFireTarget(tx,ty){
    if(!MM.fire || typeof MM.fire.extinguish!=='function') return false;
    let n=0;
    const cells=[[0,0],[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of cells){
      const x=tx+dx, y=ty+dy;
      try{ if(MM.fire.isBurning && !MM.fire.isBurning(x,y)) continue; }catch(e){}
      try{ if(MM.fire.extinguish(x,y)) n++; }catch(e){}
    }
    return n>0;
  }
  function applySpecial(kind,target,tx,ty,sx,sy,dx,dy){
    if(kind==='fire'){
      try{ if(MM.mobs && MM.mobs.igniteAt) MM.mobs.igniteAt(tx,ty,{dur:3.8,dps:2.5}); }catch(e){}
      try{ if(MM.fire && MM.fire.heatAround) MM.fire.heatAround(tx,ty,0.8); }catch(e){}
    }else if(kind==='water'){
      if(target && target.kind==='fire') return extinguishFireTarget(tx,ty);
      try{ if(MM.mobs && MM.mobs.douseRadius) MM.mobs.douseRadius(tx+0.5,ty+0.5,1.6); }catch(e){}
      const entity=targetEntity(target) || target;
      if(entity){
        try{
          entity.vx=(Number(entity.vx)||0)+dx*1.8;
          entity.vy=(Number(entity.vy)||0)+dy*0.45-0.15;
        }catch(e){}
      }
      try{
        if(MM.particles && MM.particles.spawnSplash){
          const TILE=MM.TILE||20;
          MM.particles.spawnSplash((tx+0.5)*TILE,(ty+0.5)*TILE,10);
        }
      }catch(e){}
    }
    return false;
  }

  function fireAt(m,target,getTile){
    const cfg=cfgFor(m.kind);
    if(!target) return false;
    if(m.kind==='water'){
      if(!hasWaterForShot(m)) return false;
      m.water=clampWater((m.water||0)-WATER_TURRET_WATER_PER_SHOT,m);
    }
    const sx=m.x+0.5, sy=m.y+0.5;
    const coords=targetCoords(target);
    if(!coords) return false;
    const txw=coords.x, tyw=coords.y;
    const dx0=txw-sx, dy0=tyw-sy;
    const dist=Math.hypot(dx0,dy0)||1;
    const dx=dx0/dist, dy=dy0/dist;
    const ex=sx+dx*Math.min(dist,cfg.range);
    const ey=sy+dy*Math.min(dist,cfg.range);
    const tx=coords.fire ? target.tx : coords.tx;
    const ty=coords.fire ? target.ty : coords.ty;
    const specialHit=applySpecial(m.kind,target,tx,ty,sx,sy,dx,dy);
    const hit=coords.fire ? specialHit : damageTargetAt(target,tx,ty,cfg.damage,sx,sy,m.kind);
    if(hit) totalHits++;
    totalShots++;
    m.energy=clampEnergy((m.energy||0)-cfg.cost);
    m.cooldown=cfg.cooldown;
    m.pulse=1;
    m.aim=Math.atan2(dy,dx);
    m.activeT=0.55;
    if(m.kind==='fire') spawnFirePuffs(sx,sy,dx,dy,dist);
    else pushShot({kind:m.kind,x1:sx,y1:sy,x2:ex,y2:ey,t:0,life:m.kind==='water'?0.18:0.14,hit,phase:Math.random()*Math.PI*2,power:clamp((m.energy||0)/TURRET_CAPACITY,0,1)});
    if(m.kind==='water') spawnWaterPuffs(sx,sy,dx,dy,dist);
    try{ if(MM.audio && MM.audio.play) MM.audio.play(cfg.sound); }catch(e){}
    try{
      if(hit && MM.particles && MM.particles.spawnSparks){
        const TILE=MM.TILE||20;
        MM.particles.spawnSparks(ex*TILE,ey*TILE,m.kind==='fire'?'rare':'common',m.kind==='standard'?6:4);
      }
    }catch(e){}
    return true;
  }
  function fireMountedAt(tile,state,dt,mount,target,getTile){
    const kind=kindForTile(tile);
    if(!kind || !state || !(dt>0) || !Number.isFinite(dt)) return {fired:false, energy:mount && Number(mount.energy)||0};
    const cfg=cfgFor(kind);
    state.kind=kind;
    state.x=Number.isFinite(Number(mount && mount.x)) ? Number(mount.x) : 0;
    state.y=Number.isFinite(Number(mount && mount.y)) ? Number(mount.y) : 0;
    state.energy=clampEnergy(mount && mount.energy);
    state.cooldown=Math.max(0,(Number(state.cooldown)||0)-dt);
    state.scanT=Math.max(0,(Number(state.scanT)||0)-dt);
    state.pulse=Math.max(0,(Number(state.pulse)||0)-dt*2.8);
    state.activeT=Math.max(0,(Number(state.activeT)||0)-dt);
    if(kind==='water'){
      const water=Number.isFinite(Number(mount && mount.water)) ? Number(mount.water) : state.water;
      state.water=clampWater(Number.isFinite(Number(water)) ? water : WATER_TURRET_START_WATER,state);
    }else{
      delete state.water;
    }
    const out={fired:false, energy:state.energy, water:state.water, cooldown:state.cooldown, kind};
    const t=normalizeExternalTarget(target);
    if(!t || state.cooldown>0 || state.energy+1e-6<cfg.cost || !hasWaterForShot(state)) return out;
    const c=targetCoords(t);
    if(!c) return out;
    const dx=c.x-(state.x+0.5), dy=c.y-(state.y+0.5);
    const d=Math.hypot(dx,dy);
    if(d>cfg.range+0.35 || !targetStillValid(state,t,getTile)) return out;
    out.fired=fireAt(state,t,getTile);
    out.energy=state.energy;
    out.water=state.water;
    out.cooldown=state.cooldown;
    return out;
  }

  function updateFx(dt){
    for(let i=shots.length-1;i>=0;i--){
      const s=shots[i];
      s.t=(s.t||0)+dt;
      if(s.t>=(s.life||0.16)) shots.splice(i,1);
    }
    for(let i=puffs.length-1;i>=0;i--){
      const p=puffs[i];
      p.life-=dt;
      if(p.life<=0){ puffs.splice(i,1); continue; }
      p.x+=(p.vx||0)*dt;
      p.y+=(p.vy||0)*dt;
      p.vx*=Math.max(0,1-dt*2.4);
      p.vy=(p.vy||0)+(p.kind==='water'?5.0:-1.2)*dt;
    }
  }

  function chargeFromNetwork(m,dt,getTile,dynamo){
    const charger=MM.teleporters;
    if(!charger || !charger.chargeBatteryAt) return 0;
    const netTile=(x,y)=>getElectricNetworkTile(x,y,getTile);
    const gained=charger.chargeBatteryAt(m.x,m.y,m,dt,netTile,dynamo,{capacity:TURRET_CAPACITY,rate:CHARGE_RATE});
    if(gained>0) m.pulse=Math.max(m.pulse||0,0.55);
    return gained;
  }
  function receiveWaterAt(x,y,amount,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m || m.kind!=='water') return 0;
    const before=clampWater(m.water,m);
    const add=Math.max(0,Number(amount)||0);
    m.water=clampWater(before+add,m);
    if(m.water>before) m.pulse=Math.max(m.pulse||0,0.35);
    return m.water-before;
  }
  function waterNeedAt(x,y,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m || m.kind!=='water') return 0;
    return Math.max(0,waterCapacityFor(m)-clampWater(m.water,m));
  }
  function hasWaterForShot(m){
    return m.kind!=='water' || (m.water||0)+1e-6>=WATER_TURRET_WATER_PER_SHOT;
  }

  function update(dt,player,getTile,_setTile,opts){
    if(!(dt>0) || !Number.isFinite(dt)) return;
    updateFx(Math.min(0.08,dt));
    if(typeof getTile!=='function') return;
    scanT-=dt;
    if(scanT<=0){
      scanT=PLAYER_SCAN_INTERVAL;
      scanNearby(player,getTile);
    }
    const dynamo=opts && opts.dynamo;
    const px=player && Number.isFinite(player.x) ? player.x : 0;
    const py=player && Number.isFinite(player.y) ? player.y : 0;
    for(const [k,m] of machines){
      if(!m || !isTurretTile(getSafe(getTile,m.x,m.y,T.AIR))){
        machines.delete(k);
        continue;
      }
      const cfg=cfgFor(m.kind);
      m.cooldown=Math.max(0,(m.cooldown||0)-dt);
      m.scanT=Math.max(0,(m.scanT||0)-dt);
      m.pulse=Math.max(0,(m.pulse||0)-dt*2.8);
      m.activeT=Math.max(0,(m.activeT||0)-dt);
      chargeFromNetwork(m,dt,getTile,dynamo);
      if(m.scanT<=0){
        m.scanT=cfg.scan+Math.random()*0.08;
        m.target=nearestHostileTarget(m,getTile);
        if(!m.target && m.kind==='water') m.target=nearestFireTarget(m,getTile);
        if(m.target){
          const c=targetCoords(m.target);
          if(c){
            const dx=c.x-(m.x+0.5), dy=c.y-(m.y+0.5);
            m.aim=Math.atan2(dy,dx);
            m.lastSeen=nowMs();
          }
        }
      }
      if(m.target && m.cooldown<=0 && (m.energy||0)+1e-6>=cfg.cost && hasWaterForShot(m)){
        const target=refreshTarget(m,m.target,getTile);
        if(!target){
          m.target=null;
          continue;
        }
        const c=targetCoords(target);
        const dx=c ? c.x-(m.x+0.5) : 0, dy=c ? c.y-(m.y+0.5) : 0;
        const d=Math.hypot(dx,dy);
        if(c && d<=cfg.range+0.35 && targetStillValid(m,target,getTile)){
          fireAt(m,target,getTile);
        }else{
          m.target=null;
        }
      }
    }
    if(machines.size>MACHINE_CAP){
      const idle=[...machines.entries()]
        .filter(([,m])=>m && (m.energy||0)<=0.001 && (m.pulse||0)<=0.001 && (m.activeT||0)<=0.001)
        .map(([k,m])=>({k,d:Math.abs((m.x||0)-px)+Math.abs((m.y||0)-py)}))
        .sort((a,b)=>b.d-a.d);
      for(let i=0; i<idle.length && machines.size>Math.floor(MACHINE_CAP*0.84); i++) machines.delete(idle[i].k);
    }
  }
  function catchUp(dt,_player,getTile,_setTile,opts){
    if(!(dt>0) || !Number.isFinite(dt) || typeof getTile!=='function') return false;
    const simDt=Math.max(0,Math.min(CATCHUP_MAX_SECONDS,Number(dt)||0));
    if(simDt<=0) return false;
    let changed=false;
    const dynamo=opts && opts.dynamo;
    for(const [raw,m] of machines){
      if(!m || !isTurretTile(getSafe(getTile,m.x,m.y,T.AIR))){
        machines.delete(raw);
        changed=true;
        continue;
      }
      const before=m.energy||0;
      m.cooldown=0;
      m.scanT=0;
      m.pulse=0;
      m.activeT=0;
      chargeFromNetwork(m,simDt,getTile,dynamo);
      if(Math.abs((m.energy||0)-before)>0.0001) changed=true;
    }
    return changed;
  }

  function drawShot(ctx,TILE,s){
    const f=1-clamp((s.t||0)/(s.life||0.16),0,1);
    if(f<=0) return;
    const c=cfgFor(s.kind);
    const x1=s.x1*TILE, y1=s.y1*TILE, x2=s.x2*TILE, y2=s.y2*TILE;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.lineCap='round';
    ctx.strokeStyle=s.kind==='fire'
      ? 'rgba(255,102,30,'+(0.45+0.45*f).toFixed(3)+')'
      : (s.kind==='water' ? 'rgba(84,216,255,'+(0.42+0.42*f).toFixed(3)+')' : 'rgba(184,232,255,'+(0.45+0.45*f).toFixed(3)+')');
    ctx.lineWidth=Math.max(1,TILE*c.width*(0.8+f));
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();
    ctx.strokeStyle=s.kind==='fire'?'rgba(255,238,136,'+(0.34+0.34*f).toFixed(3)+')':'rgba(255,255,255,'+(0.25+0.38*f).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.035);
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();
    const r=TILE*(s.kind==='fire'?0.22:(s.kind==='water'?0.17:0.14))*f;
    ctx.fillStyle=s.kind==='fire'?'rgba(255,188,68,0.65)':(s.kind==='water'?'rgba(170,246,255,0.58)':'rgba(255,255,210,0.55)');
    ctx.beginPath();
    ctx.arc(x2,y2,Math.max(1,r),0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function drawPuff(ctx,TILE,p){
    const total=Math.max(0.001,p.total||0.3);
    const a=clamp(p.life/total,0,1);
    if(a<=0.01) return;
    const x=p.x*TILE, y=p.y*TILE;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    if(p.kind==='fire'){
      const r=TILE*(0.10+0.16*(1-a));
      ctx.fillStyle='rgba(255,112,30,'+(0.18+0.44*a).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(x,y,Math.max(1,r),0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,226,102,'+(0.18+0.30*a).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(x-r*0.2,y-r*0.15,Math.max(1,r*0.48),0,Math.PI*2); ctx.fill();
    }else{
      const r=TILE*(0.055+0.06*(1-a));
      ctx.fillStyle='rgba(85,216,255,'+(0.20+0.42*a).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(x,y,Math.max(1,r),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawTurretOverlay(ctx,TILE,m,phase){
    const px=m.x*TILE, py=m.y*TILE;
    const cfg=cfgFor(m.kind);
    const charge=clamp((m.energy||0)/TURRET_CAPACITY,0,1);
    const pulse=clamp((m.pulse||0)+(m.activeT||0)*0.8,0,1);
    const cx=px+TILE*0.5, cy=py+TILE*0.52;
    const barrelLen=TILE*(0.34+0.08*pulse);
    const a=Number.isFinite(m.aim) ? m.aim : -Math.PI/2;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.strokeStyle=m.kind==='fire'
      ? 'rgba(255,120,44,'+(0.22+0.48*charge+0.25*pulse).toFixed(3)+')'
      : (m.kind==='water' ? 'rgba(84,216,255,'+(0.20+0.44*charge+0.22*pulse).toFixed(3)+')' : 'rgba(184,232,255,'+(0.18+0.38*charge+0.20*pulse).toFixed(3)+')');
    ctx.lineCap='round';
    ctx.lineWidth=Math.max(1,TILE*(m.kind==='fire'?0.16:0.12));
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(cx+Math.cos(a)*barrelLen,cy+Math.sin(a)*barrelLen);
    ctx.stroke();
    ctx.fillStyle=cfg.core;
    ctx.globalAlpha=0.35+0.45*charge+0.18*pulse;
    ctx.beginPath();
    ctx.arc(cx,cy,TILE*(0.12+0.03*Math.sin(phase+m.x)),0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=1;
    ctx.fillStyle='rgba(5,12,18,0.82)';
    ctx.fillRect(px+TILE*0.18,py+TILE*0.78,TILE*0.64,TILE*0.055);
    ctx.fillStyle=charge>0.5 ? '#8cffd8' : (charge>0.18 ? '#ffe38f' : '#ff7a5a');
    ctx.fillRect(px+TILE*0.18,py+TILE*0.78,Math.max(1,TILE*0.64*charge),TILE*0.055);
    if(m.kind==='water'){
      const water=clampWater(m.water,m)/waterCapacityFor(m);
      ctx.fillStyle='rgba(2,10,18,0.82)';
      ctx.fillRect(px+TILE*0.12,py+TILE*0.18,TILE*0.055,TILE*0.58);
      ctx.fillStyle=water>0.25 ? '#54d8ff' : '#ff8a66';
      const h=TILE*0.58*water;
      ctx.fillRect(px+TILE*0.12,py+TILE*0.18+TILE*0.58-h,TILE*0.055,Math.max(1,h));
    }
    ctx.restore();
  }

  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile){
    if(!ctx) return;
    ensureVisibleMachines(sx,sy,viewX,viewY,getTile);
    if(!machines.size && !shots.length && !puffs.length) return;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    for(const s of shots){
      if(s.x2<sx-2 || s.x2>sx+viewX+2 || s.y2<sy-2 || s.y2>sy+viewY+2) continue;
      drawShot(ctx,TILE,s);
    }
    for(const p of puffs){
      if(p.x<sx-2 || p.x>sx+viewX+2 || p.y<sy-2 || p.y>sy+viewY+2) continue;
      drawPuff(ctx,TILE,p);
    }
    const phase=((typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now())*0.006;
    for(const m of machines.values()){
      if(!m || m.x<sx-2 || m.x>sx+viewX+2 || m.y<sy-2 || m.y>sy+viewY+2) continue;
      if(visible && !visible(m.x,m.y)) continue;
      if(!isTurretTile(getSafe(getTile,m.x,m.y,T.AIR))) continue;
      drawTurretOverlay(ctx,TILE,m,phase);
    }
  }

  function onTileChanged(x,y,oldTile,newTile){
    if(oldTile===newTile) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    if(isTurretTile(oldTile) && !isTurretTile(newTile)) machines.delete(key(tx,ty));
    if(isTurretTile(newTile)) ensureMachine(tx,ty,MM.world && MM.world.getTile);
  }

  function snapshot(){
    const list=[...machines.values()]
      .filter(m=>m && finiteTile(m.x,m.y) && ((m.energy||0)>0.001 || (m.kind==='water' && Math.abs(clampWater(m.water,m)-WATER_TURRET_START_WATER)>0.001)))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MACHINE_CAP)
      .map(m=>{
        const out={x:m.x,y:m.y,kind:m.kind,energy:+(m.energy||0).toFixed(3),aim:+(Number(m.aim)||0).toFixed(3)};
        if(m.kind==='water') out.water=+clampWater(m.water,m).toFixed(3);
        return out;
      });
    return {v:1,list};
  }
  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
      if(machines.size>=MACHINE_CAP) break;
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(getTile && !isTurretTile(getSafe(getTile,x,y,T.AIR))) continue;
      const m=ensureMachine(x,y,getTile);
      if(!m) continue;
      m.energy=clampEnergy(raw.energy);
      m.aim=Number.isFinite(raw.aim) ? raw.aim : 0;
      if(m.kind==='water' && typeof raw.water==='number') m.water=clampWater(raw.water,m);
    }
  }
  function reset(){
    machines.clear();
    shots.length=0;
    puffs.length=0;
    scanT=0;
    visibleScanKey='';
    visibleScanAt=0;
    totalShots=0;
    totalHits=0;
  }
  function metrics(){
    let storedEnergy=0, storedWater=0, charged=0, active=0;
    const byKind={standard:0,fire:0,water:0};
    for(const m of machines.values()){
      storedEnergy+=Math.max(0,m.energy||0);
      if((m.energy||0)>0.001) charged++;
      if((m.activeT||0)>0 || m.target) active++;
      if(byKind[m.kind]!=null) byKind[m.kind]++;
      if(m.kind==='water') storedWater+=clampWater(m.water,m);
    }
    return {machines:machines.size, active, charged, storedEnergy:+storedEnergy.toFixed(2), storedWater:+storedWater.toFixed(2), shots:totalShots, hits:totalHits, effects:shots.length+puffs.length, byKind};
  }
  function debugChargeAt(x,y,amount,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m) return 0;
    const before=m.energy||0;
    m.energy=clampEnergy(before+Math.max(0,Number(amount)||0));
    m.pulse=1;
    return m.energy-before;
  }
  function debugSetEnergyAt(x,y,amount,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m) return false;
    m.energy=clampEnergy(amount);
    m.pulse=1;
    return true;
  }
  function debugSetWaterAt(x,y,amount,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m || m.kind!=='water') return false;
    m.water=clampWater(amount,m);
    m.pulse=1;
    return true;
  }

  const api={
    isTurretTile,
    kindForTile,
    ensureMachine,
    update,
    catchUp,
    draw,
    onTileChanged,
    snapshot,
    restore,
    reset,
    metrics,
    receiveWaterAt,
    waterNeedAt,
    fireMountedAt,
    _debug:{machines,shots,puffs,TURRET_CAPACITY,CHARGE_RATE,CATCHUP_MAX_SECONDS,CFG,WATER_TURRET_TANK,WATER_TURRET_START_WATER,WATER_TURRET_WATER_PER_SHOT,debugChargeAt,debugSetEnergyAt,debugSetWaterAt,ensureMachine,nearestMobTarget,nearestBossTarget,nearestUfoTarget,nearestHostileTarget}
  };
  MM.turrets=api;
  return api;
})();

export { turrets };
export default turrets;
