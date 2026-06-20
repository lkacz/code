// Powered defensive turrets. They reuse the copper/dynamo/solar network exposed
// by teleporters, but keep local batteries and light bounded targeting state.
import { T, INFO, WORLD_H, isSolid } from '../constants.js';

const turrets = (function(){
  const MM = window.MM = window.MM || {};

  const TURRET_CAPACITY = 90;
  const CHARGE_RATE = 36;
  const MACHINE_CAP = 260;
  const SHOT_FX_CAP = 90;
  const PUFF_CAP = 120;
  const PLAYER_SCAN_INTERVAL = 0.45;
  const VISIBLE_SCAN_INTERVAL_MS = 220;

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

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=0 && y<WORLD_H; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(Math.floor(x),Math.floor(y)) : fallback; }catch(e){ return fallback; }
  }
  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function isTurretTile(t){ return !!KIND_BY_TILE[t]; }
  function kindForTile(t){ return KIND_BY_TILE[t] || null; }
  function clampEnergy(n){ return clamp(Number(n)||0,0,TURRET_CAPACITY); }
  function cfgFor(kind){ return CFG[kind] || CFG.standard; }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }

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
    const y0=Math.max(0,cy-ry), y1=Math.min(WORLD_H-1,cy+ry);
    for(let y=y0; y<=y1; y++){
      for(let x=cx-rx; x<=cx+rx; x++){
        if(isTurretTile(getSafe(getTile,x,y,T.AIR))) ensureMachine(x,y,getTile);
      }
    }
  }

  function ensureVisibleMachines(sx,sy,viewX,viewY,getTile){
    if(typeof getTile!=='function') return;
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(0,Math.floor(sy)-2), y1=Math.min(WORLD_H-1,Math.ceil(sy+viewY)+2);
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

  function lineClear(x0,y0,x1,y1,getTile,ownX,ownY){
    if(typeof getTile!=='function') return true;
    const dx=x1-x0, dy=y1-y0;
    const dist=Math.hypot(dx,dy)||1;
    const steps=Math.max(2,Math.ceil(dist*4));
    for(let i=1; i<steps; i++){
      const f=i/steps;
      const tx=Math.floor(x0+dx*f);
      const ty=Math.floor(y0+dy*f);
      if(tx===ownX && ty===ownY) continue;
      const t=getSafe(getTile,tx,ty,T.AIR);
      if(t===T.AIR || t===T.WATER || t===T.LAVA) continue;
      const info=INFO[t] || INFO[T.AIR];
      if(info.gas || info.passable) continue;
      if(isSolid(t)) return false;
    }
    return true;
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
    if(!lineClear(sx,sy,tx,ty,getTile,m.x,m.y)) return null;
    return target;
  }

  function damageAt(tx,ty,dmg){
    let hit=false;
    try{ if(MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    try{ if(MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,dmg)) hit=true; }catch(e){}
    return hit;
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

  function applySpecial(kind,target,tx,ty,sx,sy,dx,dy){
    if(kind==='fire'){
      try{ if(MM.mobs && MM.mobs.igniteAt) MM.mobs.igniteAt(tx,ty,{dur:3.8,dps:2.5}); }catch(e){}
      try{ if(MM.fire && MM.fire.heatAround) MM.fire.heatAround(tx,ty,0.8); }catch(e){}
    }else if(kind==='water'){
      try{ if(MM.mobs && MM.mobs.douseRadius) MM.mobs.douseRadius(tx+0.5,ty+0.5,1.6); }catch(e){}
      if(target){
        try{
          target.vx=(Number(target.vx)||0)+dx*1.8;
          target.vy=(Number(target.vy)||0)+dy*0.45-0.15;
        }catch(e){}
      }
      try{
        if(MM.particles && MM.particles.spawnSplash){
          const TILE=MM.TILE||20;
          MM.particles.spawnSplash((tx+0.5)*TILE,(ty+0.5)*TILE,10);
        }
      }catch(e){}
    }
  }

  function fireAt(m,target,getTile){
    const cfg=cfgFor(m.kind);
    if(!target) return false;
    const sx=m.x+0.5, sy=m.y+0.5;
    const txw=Number(target.x), tyw=Number(target.y);
    if(!Number.isFinite(txw) || !Number.isFinite(tyw)) return false;
    const dx0=txw-sx, dy0=tyw-sy;
    const dist=Math.hypot(dx0,dy0)||1;
    const dx=dx0/dist, dy=dy0/dist;
    const ex=sx+dx*Math.min(dist,cfg.range);
    const ey=sy+dy*Math.min(dist,cfg.range);
    const tx=Math.floor(txw), ty=Math.floor(tyw);
    const hit=damageAt(tx,ty,cfg.damage);
    applySpecial(m.kind,target,tx,ty,sx,sy,dx,dy);
    if(hit) totalHits++;
    totalShots++;
    m.energy=clampEnergy((m.energy||0)-cfg.cost);
    m.cooldown=cfg.cooldown;
    m.pulse=1;
    m.aim=Math.atan2(dy,dx);
    m.activeT=0.55;
    pushShot({kind:m.kind,x1:sx,y1:sy,x2:ex,y2:ey,t:0,life:m.kind==='fire'?0.25:(m.kind==='water'?0.18:0.14),hit,phase:Math.random()*Math.PI*2,power:clamp((m.energy||0)/TURRET_CAPACITY,0,1)});
    if(m.kind==='fire') spawnFirePuffs(sx,sy,dx,dy,dist);
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
    const gained=charger.chargeBatteryAt(m.x,m.y,m,dt,getTile,dynamo,{capacity:TURRET_CAPACITY,rate:CHARGE_RATE});
    if(gained>0) m.pulse=Math.max(m.pulse||0,0.55);
    return gained;
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
        m.target=nearestMobTarget(m,getTile);
        if(m.target){
          const dx=m.target.x-(m.x+0.5), dy=m.target.y-(m.y+0.5);
          m.aim=Math.atan2(dy,dx);
          m.lastSeen=nowMs();
        }
      }
      if(m.target && m.cooldown<=0 && (m.energy||0)+1e-6>=cfg.cost){
        const target=m.target;
        const dx=target.x-(m.x+0.5), dy=target.y-(m.y+0.5);
        const d=Math.hypot(dx,dy);
        if(d<=cfg.range+0.35 && target.hp>0 && lineClear(m.x+0.5,m.y+0.5,target.x,target.y,getTile,m.x,m.y)){
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
      .filter(m=>m && finiteTile(m.x,m.y) && (m.energy||0)>0.001)
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MACHINE_CAP)
      .map(m=>({x:m.x,y:m.y,kind:m.kind,energy:+(m.energy||0).toFixed(3),aim:+(Number(m.aim)||0).toFixed(3)}));
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
    let storedEnergy=0, charged=0, active=0;
    const byKind={standard:0,fire:0,water:0};
    for(const m of machines.values()){
      storedEnergy+=Math.max(0,m.energy||0);
      if((m.energy||0)>0.001) charged++;
      if((m.activeT||0)>0 || m.target) active++;
      if(byKind[m.kind]!=null) byKind[m.kind]++;
    }
    return {machines:machines.size, active, charged, storedEnergy:+storedEnergy.toFixed(2), shots:totalShots, hits:totalHits, effects:shots.length+puffs.length, byKind};
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

  const api={
    isTurretTile,
    kindForTile,
    ensureMachine,
    update,
    draw,
    onTileChanged,
    snapshot,
    restore,
    reset,
    metrics,
    _debug:{machines,shots,puffs,TURRET_CAPACITY,CHARGE_RATE,CFG,debugChargeAt,debugSetEnergyAt,ensureMachine,nearestMobTarget}
  };
  MM.turrets=api;
  return api;
})();

export { turrets };
export default turrets;
