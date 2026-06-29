// Solar panels: terrain-backed power sources produced by elemental reactions.
// Regular panels generate a small daylight buffer. Storage panels (made with a
// transistor in the recipe) keep a much larger battery and can feed devices via
// copper cable networks.
import { T, WORLD_H } from '../constants.js';
import { isSunTransparentTile } from './material_physics.js';

(function(){
  window.MM = window.MM || {};

  const cells = new Map(); // "x,y" -> {x,y,energy,power,pulse,storage}
  const PANEL_CAPACITY = 18;
  const STORAGE_CAPACITY = 120;
  const PANEL_RATE = 3.0;
  const STORAGE_RATE = 3.8;
  const POWER_DECAY = 10;
  const PULSE_DECAY = 2.4;
  const SCAN_INTERVAL = 0.45;
  const SCAN_RX = 82;
  const SCAN_RY = 46;
  const CLUSTER_LIMIT = 80;
  const CELL_CAP = 1600;
  const FAR_IDLE_PRUNE_DIST = 260;
  const CATCHUP_MAX_SECONDS = 1800;
  const DAY_CYCLE_SECONDS = 600;
  let scanT = 0;
  let visibleScanAt = 0;
  let visibleScanKey = '';
  let lastGetTile = null;

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=0 && y<WORLD_H; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function isSourceTile(t){ return t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY; }
  function isStorageTile(t){ return t===T.SOLAR_BATTERY; }
  function capacityForTile(t){ return isStorageTile(t) ? STORAGE_CAPACITY : PANEL_CAPACITY; }
  function rateForTile(t){ return isStorageTile(t) ? STORAGE_RATE : PANEL_RATE; }
  function transparentForSun(t){
    return isSunTransparentTile(t);
  }
  function skyExposed(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y)) return false;
    for(let yy=y-1; yy>=0; yy--){
      const t=getSafe(getTile,x,yy,T.STONE);
      if(!transparentForSun(t)) return false;
    }
    return true;
  }
  function cycleSunAt(cycleT){
    const t=((Number(cycleT)||0)%1+1)%1;
    if(t>=0.5) return 0;
    return Math.max(0,Math.min(1,Math.sin((t/0.5)*Math.PI)));
  }
  function cloudSunFactor(){
    let f=1;
    try{
      const cm=MM.clouds && MM.clouds.metrics && MM.clouds.metrics();
      if(cm){
        const mass=Math.max(0,Number(cm.cloudMass)||0);
        const count=Math.max(0,Number(cm.clouds)||0);
        const cloudiness=Math.max(0,Math.min(1,mass/90+count/36));
        const storm=cm.storm && cm.storm.active ? Math.max(0,Math.min(1,Number(cm.storm.intensity)||0)) : 0;
        f*=Math.max(0.18,1-cloudiness*0.42-storm*0.48);
      }
    }catch(e){}
    return Math.max(0,Math.min(1,f));
  }
  function currentCycleT(){
    try{
      const bg=MM.background;
      const c=bg && bg.timeInfo && bg.timeInfo();
      if(c && Number.isFinite(Number(c.cycleT))) return Number(c.cycleT);
    }catch(e){}
    try{
      const bg=MM.background;
      const c=bg && bg.getCycleInfo && bg.getCycleInfo();
      if(c && Number.isFinite(Number(c.cycleT))) return Number(c.cycleT);
      if(c && typeof c.isDay==='boolean' && Number.isFinite(Number(c.tDay))){
        return c.isDay ? Math.max(0,Math.min(0.5,Number(c.tDay)*0.5)) : 0.5+Math.max(0,Math.min(0.5,Number(c.tDay)*0.5));
      }
    }catch(e){}
    return 0.25;
  }
  function daylight(){
    const sun=cycleSunAt(currentCycleT())*cloudSunFactor();
    return Math.max(0,Math.min(1,sun));
  }
  function averageDaylight(seconds){
    const span=Math.max(0,Number(seconds)||0);
    if(span<=0.001) return daylight();
    const end=currentCycleT();
    const delta=span/DAY_CYCLE_SECONDS;
    const samples=Math.max(4,Math.min(72,Math.ceil(span/30)));
    let total=0;
    for(let i=0; i<samples; i++){
      const f=(i+0.5)/samples;
      total+=cycleSunAt(end-delta+delta*f);
    }
    return Math.max(0,Math.min(1,(total/samples)*cloudSunFactor()));
  }
  function normalizeState(m,t){
    const cap=capacityForTile(t);
    m.energy=Math.max(0,Math.min(cap,Number(m.energy)||0));
    m.power=Math.max(0,Number(m.power)||0);
    m.pulse=Math.max(0,Math.min(1,Number(m.pulse)||0));
    m.storage=isStorageTile(t);
    return m;
  }
  function ensureCell(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    const t=getSafe(getTile,x,y,T.AIR);
    if(!isSourceTile(t)) return null;
    const k=key(x,y);
    let m=cells.get(k);
    if(!m){
      m={x,y,energy:0,power:0,pulse:0,storage:isStorageTile(t)};
      cells.set(k,m);
    }
    m.x=x; m.y=y;
    return normalizeState(m,t);
  }
  function clusterCells(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!isSourceTile(getSafe(getTile,x,y,T.AIR))) return [];
    const out=[];
    const seen=new Set();
    const q=[{x,y}];
    seen.add(key(x,y));
    for(let i=0; i<q.length && i<CLUSTER_LIMIT; i++){
      const c=q[i];
      if(!isSourceTile(getSafe(getTile,c.x,c.y,T.AIR))) continue;
      out.push(c);
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
        const nx=c.x+dx, ny=c.y+dy;
        const k=key(nx,ny);
        if(seen.has(k) || !finiteTile(nx,ny)) return;
        if(!isSourceTile(getSafe(getTile,nx,ny,T.AIR))) return;
        seen.add(k);
        q.push({x:nx,y:ny});
      });
    }
    return out;
  }
  function clusterRoot(cluster){
    if(!cluster || !cluster.length) return null;
    let best=cluster[0];
    for(const c of cluster){
      if(c.x<best.x || (c.x===best.x && c.y<best.y)) best=c;
    }
    return {x:best.x,y:best.y};
  }
  function sourceAt(x,y,getTile){
    const cluster=clusterCells(x,y,getTile);
    const root=clusterRoot(cluster);
    return root ? {x:root.x,y:root.y,cells:cluster.length,kind:'solar'} : null;
  }
  function clusterStates(x,y,getTile){
    return clusterCells(x,y,getTile).map(c=>ensureCell(c.x,c.y,getTile)).filter(Boolean);
  }
  function energyAt(x,y,getTile){
    let total=0;
    for(const m of clusterStates(x,y,getTile)) total+=Math.max(0,m.energy||0);
    return total;
  }
  function drainAt(x,y,amount,getTile){
    const maxTake=Math.max(0,Number(amount)||0);
    if(maxTake<=0) return null;
    const list=clusterStates(x,y,getTile).sort((a,b)=>(b.energy||0)-(a.energy||0));
    let remaining=maxTake, drained=0, sx=x, sy=y;
    for(const m of list){
      if(remaining<=0) break;
      const take=Math.min(remaining,Math.max(0,m.energy||0));
      if(take<=0) continue;
      m.energy=Math.max(0,(m.energy||0)-take);
      m.pulse=1;
      remaining-=take;
      drained+=take;
      sx=m.x; sy=m.y;
    }
    if(drained<=0) return null;
    return {amount:drained,x:sx,y:sy,energy:energyAt(x,y,getTile),lastKind:'solar'};
  }
  function debugChargeAt(x,y,amount,getTile){
    const maxGain=Math.max(0,Number(amount)||0);
    if(maxGain<=0) return 0;
    const list=clusterStates(x,y,getTile);
    let remaining=maxGain, gained=0;
    for(const m of list){
      if(remaining<=0) break;
      const t=getSafe(getTile,m.x,m.y,T.AIR);
      const cap=capacityForTile(t);
      const add=Math.min(remaining,Math.max(0,cap-(m.energy||0)));
      if(add<=0) continue;
      m.energy=Math.min(cap,(m.energy||0)+add);
      m.pulse=1;
      remaining-=add;
      gained+=add;
    }
    return gained;
  }
  function debugSetEnergyAt(x,y,amount,getTile){
    const list=clusterStates(x,y,getTile);
    if(!list.length) return false;
    const per=Math.max(0,Number(amount)||0)/list.length;
    for(const m of list){
      const t=getSafe(getTile,m.x,m.y,T.AIR);
      m.energy=Math.min(capacityForTile(t),per);
      m.pulse=1;
    }
    return true;
  }
  function updateCell(m,dt,getTile,sun){
    const t=getSafe(getTile,m.x,m.y,T.AIR);
    if(!isSourceTile(t)){ cells.delete(key(m.x,m.y)); return; }
    normalizeState(m,t);
    const exposed=skyExposed(m.x,m.y,getTile);
    const charge=exposed ? sun*rateForTile(t) : 0;
    const cap=capacityForTile(t);
    if(charge>0.001){
      const before=m.energy||0;
      m.energy=Math.min(cap,before+charge*dt);
      m.power=charge;
      if(m.energy>before+0.001) m.pulse=Math.max(m.pulse||0,Math.min(1,0.25+sun*0.75));
    } else {
      m.power=0;
      if(!isStorageTile(t)) m.energy=Math.max(0,(m.energy||0)-POWER_DECAY*dt);
    }
    m.pulse=Math.max(0,(m.pulse||0)-PULSE_DECAY*dt);
  }
  function pruneCells(player,getTile){
    if(typeof getTile!=='function') return;
    const px=player && Number.isFinite(player.x) ? player.x : 0;
    const py=player && Number.isFinite(player.y) ? player.y : 0;
    const candidates=[];
    for(const [k,m] of cells){
      if(!m || !finiteTile(m.x,m.y)){ cells.delete(k); continue; }
      const t=getSafe(getTile,m.x,m.y,T.AIR);
      if(!isSourceTile(t)){ cells.delete(k); continue; }
      const energy=Math.max(0,Number(m.energy)||0);
      const power=Math.max(0,Number(m.power)||0);
      const dist=Math.abs(m.x-px)+Math.abs(m.y-py);
      const idle=energy<=0.001 && power<=0.001;
      if(cells.size>CELL_CAP || (idle && dist>FAR_IDLE_PRUNE_DIST)){
        candidates.push({k,score:(idle?100000:0)+dist-energy*12-(isStorageTile(t)?160:0)});
      }
    }
    if(cells.size<=CELL_CAP) return;
    candidates.sort((a,b)=>b.score-a.score);
    const target=Math.floor(CELL_CAP*0.86);
    for(let i=0; i<candidates.length && cells.size>target; i++) cells.delete(candidates[i].k);
  }
  function scanAround(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const x0=cx-SCAN_RX, x1=cx+SCAN_RX;
    const y0=Math.max(0,cy-SCAN_RY), y1=Math.min(WORLD_H-1,cy+SCAN_RY);
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(isSourceTile(getSafe(getTile,x,y,T.AIR))) ensureCell(x,y,getTile);
      }
    }
  }
  function update(dt,player,getTile){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return;
    lastGetTile=getTile;
    scanT-=dt;
    if(scanT<=0){
      scanT=SCAN_INTERVAL;
      scanAround(player,getTile);
    }
    pruneCells(player,getTile);
    const sun=daylight();
    for(const m of [...cells.values()]) updateCell(m,dt,getTile,sun);
  }
  function catchUp(dt,player,getTile){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return false;
    const simDt=Math.max(0,Math.min(CATCHUP_MAX_SECONDS,Number(dt)||0));
    if(simDt<=0) return false;
    lastGetTile=getTile;
    scanAround(player,getTile);
    pruneCells(player,getTile);
    const sun=averageDaylight(simDt);
    let changed=false;
    for(const m of [...cells.values()]){
      const before=m ? m.energy : 0;
      updateCell(m,simDt,getTile,sun);
      if(!m || !cells.has(key(m.x,m.y)) || Math.abs((m.energy||0)-before)>0.0001) changed=true;
    }
    return changed;
  }
  function ensureVisible(sx,sy,viewX,viewY,getTile){
    if(typeof getTile!=='function') return;
    lastGetTile=getTile;
    const bx=Math.floor(Number(sx)||0);
    const by=Math.floor(Number(sy)||0);
    const keyStr=Math.floor(bx/8)+','+Math.floor(by/8)+','+Math.ceil(Number(viewX)||0)+','+Math.ceil(Number(viewY)||0);
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    if(keyStr===visibleScanKey && now<visibleScanAt) return;
    visibleScanKey=keyStr;
    visibleScanAt=now+350;
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(0,Math.floor(sy)-2), y1=Math.min(WORLD_H-1,Math.ceil(sy+viewY)+2);
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(isSourceTile(getSafe(getTile,x,y,T.AIR))) ensureCell(x,y,getTile);
      }
    }
  }
  function drawBatteryLines(ctx,TILE,px,py,charge,pulse){
    const x=px+TILE*0.23, baseY=py+TILE*0.75, w=TILE*0.54, h=Math.max(1,TILE*0.035), gap=TILE*0.12;
    for(let i=0; i<4; i++){
      const y=baseY-i*gap;
      ctx.fillStyle='rgba(0,7,11,0.70)';
      ctx.fillRect(x,y,w,h);
      const f=Math.max(0,Math.min(1,charge*4-i));
      if(f>0){
        ctx.globalAlpha=0.55+0.35*f+0.12*Math.max(0,Math.min(1,pulse||0));
        ctx.fillStyle=pulse>0?'#fff38a':'#54f7d4';
        ctx.fillRect(x,y,Math.max(1,w*f),h);
        ctx.globalAlpha=1;
      }
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile){
    if(!ctx) return;
    ensureVisible(sx,sy,viewX,viewY,getTile);
    if(!cells.size) return;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const m of cells.values()){
      if(!m) continue;
      if(m.x<sx-2 || m.x>sx+viewX+2 || m.y<sy-2 || m.y>sy+viewY+2) continue;
      if(visible && !visible(m.x,m.y)) continue;
      const t=getSafe(getTile,m.x,m.y,T.AIR);
      if(!isSourceTile(t)) continue;
      const cap=capacityForTile(t);
      const charge=Math.max(0,Math.min(1,(m.energy||0)/cap));
      const power=Math.max(0,Math.min(1,(m.power||0)/STORAGE_RATE));
      const px=m.x*TILE, py=m.y*TILE;
      ctx.fillStyle='rgba(95,247,220,'+(0.08+0.22*power+0.18*(m.pulse||0)).toFixed(3)+')';
      ctx.fillRect(px+2,py+2,TILE-4,TILE-4);
      ctx.strokeStyle='rgba(255,240,130,'+(0.16+0.42*power).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,TILE*0.045);
      ctx.strokeRect(px+TILE*0.12,py+TILE*0.12,TILE*0.76,TILE*0.76);
      if(isStorageTile(t)) drawBatteryLines(ctx,TILE,px,py,charge,m.pulse||0);
    }
    ctx.restore();
  }
  function onTileChanged(x,y,oldTile,newTile){
    if(oldTile===newTile) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    if(isSourceTile(oldTile) && !isSourceTile(newTile)) cells.delete(key(tx,ty));
    if(isSourceTile(newTile)) ensureCell(tx,ty,MM.world && MM.world.getTile);
  }
  function snapshot(){
    const list=[...cells.values()]
      .filter(m=>m && finiteTile(m.x,m.y) && (m.energy||0)>0.001 && (!lastGetTile || isSourceTile(getSafe(lastGetTile,m.x,m.y,T.AIR))))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,CELL_CAP)
      .map(m=>({x:m.x,y:m.y,energy:+(m.energy||0).toFixed(3),power:+(m.power||0).toFixed(2)}));
    return {v:1,list};
  }
  function restore(data,getTile){
    reset();
    if(typeof getTile==='function') lastGetTile=getTile;
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
      if(cells.size>=CELL_CAP) break;
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      const t=getSafe(getTile,x,y,T.AIR);
      if(!isSourceTile(t)) continue;
      const m=ensureCell(x,y,getTile);
      if(m){
        m.energy=Math.max(0,Math.min(capacityForTile(t),Number(raw.energy)||0));
        m.power=Math.max(0,Number(raw.power)||0);
      }
    }
  }
  function reset(){
    cells.clear();
    scanT=0;
    visibleScanAt=0;
    visibleScanKey='';
    lastGetTile=null;
  }
  function metrics(){
    let storedEnergy=0, active=0, storageCells=0, currentPower=0;
    for(const m of cells.values()){
      storedEnergy+=Math.max(0,m.energy||0);
      currentPower+=Math.max(0,m.power||0);
      if((m.power||0)>0.001) active++;
      if(m.storage) storageCells++;
    }
    return {cells:cells.size, active, storageCells, currentPower:+currentPower.toFixed(2), storedEnergy:+storedEnergy.toFixed(2), sun:+daylight().toFixed(3)};
  }

  const api={
    isSourceTile,
    isStorageTile,
    sourceAt,
    energyAt,
    drainAt,
    skyExposed,
    update,
    draw,
    onTileChanged,
    snapshot,
    restore,
    reset,
    metrics,
    catchUp,
    _debug:{cells,PANEL_CAPACITY,STORAGE_CAPACITY,PANEL_RATE,STORAGE_RATE,CELL_CAP,CATCHUP_MAX_SECONDS,clusterCells,daylight,averageDaylight,ensureVisible,debugChargeAt,debugSetEnergyAt}
  };
  MM.solar=api;
})();

export const solar = (typeof window!=='undefined' && window.MM) ? window.MM.solar : undefined;
export default solar;
