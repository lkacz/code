import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';

const springPlatforms = (function(){
  const MM = window.MM = window.MM || {};

  const CAPACITY = 70;
  const CHARGE_RATE = 34;
  const LAUNCH_COST = 28;
  const POWERED_LAUNCH = -31;
  const UNPOWERED_LAUNCH = POWERED_LAUNCH / Math.sqrt(3);
  const POWERED_FORWARD_KICK = 2.8;
  const UNPOWERED_FORWARD_KICK = 0.9;
  const COOLDOWN = 0.18;
  const MACHINE_CAP = 520;
  const VISIBLE_SCAN_INTERVAL_MS = 220;

  const machines = new Map();
  let visibleScanKey = '';
  let visibleScanAt = 0;
  let launches = 0;
  let poweredLaunches = 0;
  let unpoweredLaunches = 0;
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(Math.floor(x),Math.floor(y)) : fallback; }catch(e){ return fallback; }
  }
  function clamp(n,a,b){ return Math.max(a,Math.min(b,Number(n)||0)); }
  function capacity(){ return Math.max(1,Number(INFO[T.SPRING_PLATFORM] && INFO[T.SPRING_PLATFORM].energyCapacity)||CAPACITY); }
  function isSpringPlatformTile(t){ return t===T.SPRING_PLATFORM; }
  function clampEnergy(n){ return clamp(n,0,capacity()); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }

  function ensureMachine(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.SPRING_PLATFORM) return null;
    const k=key(x,y);
    let m=machines.get(k);
    if(!m){
      m={x,y,energy:0,pulse:0,cooldown:0,lastLaunch:0,lastPowered:false};
      machines.set(k,m);
      if(machines.size>MACHINE_CAP){
        const first=machines.keys().next();
        if(!first.done) machines.delete(first.value);
      }
    }
    m.x=x; m.y=y;
    m.energy=clampEnergy(m.energy);
    m.pulse=clamp(m.pulse,0,1);
    m.cooldown=Math.max(0,Number(m.cooldown)||0);
    return m;
  }

  function scanNearby(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(Number(player.x)||0);
    const cy=Math.floor(Number(player.y)||0);
    const rx=42, ry=26;
    const y0=Math.max(WORLD_TOP,cy-ry), y1=Math.min(WORLD_BOTTOM-1,cy+ry);
    for(let y=y0; y<=y1; y++){
      for(let x=cx-rx; x<=cx+rx; x++){
        if(getSafe(getTile,x,y,T.AIR)===T.SPRING_PLATFORM) ensureMachine(x,y,getTile);
      }
    }
  }

  function teleporterApi(opts){
    return (opts && opts.teleporters) || MM.teleporters || null;
  }
  function availableNetworkEnergyAt(x,y,getTile,opts){
    const tp=teleporterApi(opts);
    if(!tp || typeof tp.availableNetworkEnergyAt!=='function') return 0;
    try{ return Math.max(0,tp.availableNetworkEnergyAt(x,y,getTile,(opts && opts.dynamo) || MM.dynamo)||0); }catch(e){ return 0; }
  }
  function drainNetworkEnergyAt(x,y,amount,getTile,opts){
    const tp=teleporterApi(opts);
    if(!tp || typeof tp.drainNetworkEnergyAt!=='function') return 0;
    try{ return Math.max(0,tp.drainNetworkEnergyAt(x,y,amount,getTile,(opts && opts.dynamo) || MM.dynamo)||0); }catch(e){ return 0; }
  }
  function chargeFromNetwork(m,dt,getTile,opts){
    if(!m || !(dt>0)) return 0;
    const tp=teleporterApi(opts);
    if(!tp || typeof tp.chargeBatteryAt!=='function') return 0;
    let gained=0;
    try{
      gained=tp.chargeBatteryAt(m.x,m.y,m,dt,getTile,(opts && opts.dynamo) || MM.dynamo,{capacity:capacity(),rate:CHARGE_RATE}) || 0;
    }catch(e){ gained=0; }
    if(gained>0){
      m.energy=clampEnergy(m.energy);
      m.pulse=Math.max(m.pulse,0.35);
    }
    return gained;
  }

  function spendLaunchEnergy(m,getTile,opts){
    if(!m) return {powered:false,spent:0,source:'spring'};
    const storage=Math.max(0,m.energy||0);
    const network=availableNetworkEnergyAt(m.x,m.y,getTile,opts);
    if(storage+network+1e-6<LAUNCH_COST) return {powered:false,spent:0,source:'spring'};
    let remaining=LAUNCH_COST;
    let spent=0;
    let source='battery';
    const fromBattery=Math.min(storage,remaining);
    if(fromBattery>0){
      m.energy=clampEnergy(storage-fromBattery);
      remaining-=fromBattery;
      spent+=fromBattery;
    }
    if(remaining>1e-6){
      const drained=drainNetworkEnergyAt(m.x,m.y,remaining,getTile,opts);
      remaining-=drained;
      spent+=drained;
      if(drained>0) source=fromBattery>0 ? 'battery+network' : 'network';
    }
    if(spent+1e-6<LAUNCH_COST) return {powered:false,spent,source:'spring'};
    return {powered:true,spent,source};
  }

  function launchHero(player,x,y,getTile,opts){
    const m=ensureMachine(x,y,getTile);
    if(!m || m.cooldown>0) return null;
    const spent=spendLaunchEnergy(m,getTile,opts||{});
    const powered=!!spent.powered;
    const launch=powered ? POWERED_LAUNCH : UNPOWERED_LAUNCH;
    const forward=powered ? POWERED_FORWARD_KICK : UNPOWERED_FORWARD_KICK;
    player.vy=Math.min(Number(player.vy)||0,launch);
    const dir=(Math.abs(Number(player.vx)||0)>0.2 ? Math.sign(player.vx) : (Number(player.facing)||1)) || 1;
    player.vx=clamp((Number(player.vx)||0)+dir*forward,-14,14);
    player.onGround=false;
    player.jumpCount=Math.max(1,Number(player.jumpCount)||0);
    m.cooldown=COOLDOWN;
    m.pulse=1;
    m.lastLaunch=nowMs();
    m.lastPowered=powered;
    launches++;
    if(powered) poweredLaunches++;
    else unpoweredLaunches++;
    return {powered,launch,spent:spent.spent||0,source:spent.source||'spring'};
  }

  function update(dt,player,getTile,opts){
    if(!(dt>0) || typeof getTile!=='function') return;
    scanNearby(player,getTile);
    for(const [raw,m] of machines){
      if(!m || getSafe(getTile,m.x,m.y,T.AIR)!==T.SPRING_PLATFORM){
        machines.delete(raw);
        continue;
      }
      m.cooldown=Math.max(0,(m.cooldown||0)-dt);
      m.pulse=Math.max(0,(m.pulse||0)-dt*1.8);
      chargeFromNetwork(m,dt,getTile,opts||{});
    }
  }

  function catchUp(simDt,player,getTile,opts){
    const dt=Math.max(0,Math.min(900,Number(simDt)||0));
    if(dt<=0 || typeof getTile!=='function') return false;
    const before=metrics().storedEnergy;
    scanNearby(player,getTile);
    for(const m of machines.values()) chargeFromNetwork(m,dt,getTile,opts||{});
    return Math.abs(metrics().storedEnergy-before)>0.001;
  }

  function drawFrame(ctx,TILE,px,py,charge,pulse,powered,h){
    const k=Math.max(0,Math.min(1,charge));
    const p=Math.max(0,Math.min(1,pulse||0));
    ctx.save();
    const glow=0.16+0.26*k+0.34*p;
    ctx.strokeStyle='rgba(152,235,255,'+Math.min(0.9,glow+0.14).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.075);
    ctx.strokeRect(px+TILE*0.12,py+TILE*0.16,TILE*0.76,TILE*0.62);
    ctx.strokeStyle=powered ? 'rgba(255,238,132,0.82)' : 'rgba(142,172,184,0.58)';
    ctx.lineWidth=Math.max(1,TILE*0.05);
    ctx.beginPath();
    const turns=3;
    for(let i=0; i<=turns*10; i++){
      const t=i/(turns*10);
      const x=px+TILE*(0.22+t*0.56);
      const y=py+TILE*(0.50+Math.sin(t*Math.PI*turns*2+h*0.11)*0.12);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    const barW=TILE*0.50;
    ctx.fillStyle='rgba(3,7,12,0.72)';
    ctx.fillRect(px+TILE*0.25,py+TILE*0.82,barW,TILE*0.055);
    if(k>0){
      ctx.fillStyle=powered ? '#fff08a' : '#83e6ff';
      ctx.globalAlpha=0.45+0.45*k+0.1*p;
      ctx.fillRect(px+TILE*0.25,py+TILE*0.82,Math.max(1,barW*k),TILE*0.055);
      ctx.globalAlpha=1;
    }
    if(p>0.02){
      const rg=ctx.createRadialGradient(px+TILE*0.5,py+TILE*0.42,1,px+TILE*0.5,py+TILE*0.42,TILE*0.76);
      rg.addColorStop(0,'rgba(255,246,160,'+(0.18*p).toFixed(3)+')');
      rg.addColorStop(0.48,'rgba(113,220,255,'+(0.16*p).toFixed(3)+')');
      rg.addColorStop(1,'rgba(113,220,255,0)');
      ctx.fillStyle=rg;
      ctx.beginPath();
      ctx.arc(px+TILE*0.5,py+TILE*0.42,TILE*0.76,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
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
        if(getSafe(getTile,x,y,T.AIR)===T.SPRING_PLATFORM) ensureMachine(x,y,getTile);
      }
    }
  }

  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile){
    if(!ctx) return;
    ensureVisibleMachines(sx,sy,viewX,viewY,getTile);
    if(!machines.size) return;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    for(const m of machines.values()){
      if(!m || m.x<sx-2 || m.x>sx+viewX+2 || m.y<sy-2 || m.y>sy+viewY+2) continue;
      if(visible && !visible(m.x,m.y)) continue;
      if(getSafe(getTile,m.x,m.y,T.AIR)!==T.SPRING_PLATFORM) continue;
      drawFrame(ctx,TILE,m.x*TILE,m.y*TILE,(m.energy||0)/capacity(),m.pulse||0,!!m.lastPowered,((m.x*73856093)^(m.y*19349663))>>>0);
    }
  }

  function onTileChanged(x,y,oldTile,newTile,getTile){
    const k=key(x,y);
    if(oldTile===T.SPRING_PLATFORM && newTile!==T.SPRING_PLATFORM) machines.delete(k);
    if(newTile===T.SPRING_PLATFORM) ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
  }
  function snapshot(){
    return {v:1,machines:[...machines.values()].map(m=>({x:m.x,y:m.y,energy:+clampEnergy(m.energy).toFixed(2)}))};
  }
  function restore(state,getTile){
    machines.clear();
    if(!state || !Array.isArray(state.machines)) return;
    for(const raw of state.machines){
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(typeof getTile==='function' && getSafe(getTile,x,y,T.AIR)!==T.SPRING_PLATFORM) continue;
      const m=ensureMachine(x,y,getTile);
      if(m) m.energy=clampEnergy(raw.energy);
    }
  }
  function reset(){
    machines.clear();
    visibleScanKey='';
    visibleScanAt=0;
    launches=0;
    poweredLaunches=0;
    unpoweredLaunches=0;
  }
  function metrics(){
    let storedEnergy=0, charged=0;
    for(const m of machines.values()){
      storedEnergy+=Math.max(0,m.energy||0);
      if((m.energy||0)>0.001) charged++;
    }
    return {machines:machines.size,charged,storedEnergy:+storedEnergy.toFixed(2),launches,poweredLaunches,unpoweredLaunches};
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

  const api={isSpringPlatformTile,ensureMachine,launchHero,update,catchUp,draw,onTileChanged,snapshot,restore,reset,metrics,_debug:{machines,CAPACITY,CHARGE_RATE,LAUNCH_COST,POWERED_LAUNCH,UNPOWERED_LAUNCH,debugChargeAt,debugSetEnergyAt}};
  MM.springPlatforms=api;
  return api;
})();

export { springPlatforms };
export default springPlatforms;
