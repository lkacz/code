// Solar panels: terrain-backed power sources produced by elemental reactions.
// Regular panels generate a small daylight buffer. Storage panels (made with a
// transistor in the recipe) keep a much larger battery and can feed devices via
// copper cable networks.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSunTransparentTile } from './material_physics.js';
import { drawEnergyGenerationLamp, isEnergyGenerating } from './power_indicator.js';

(function(){
  window.MM = window.MM || {};

  const cells = new Map(); // "x,y" -> {x,y,energy,power,pulse,storage}
  const PANEL_CAPACITY = 18;
  const STORAGE_CAPACITY = 120;
  const PANEL_RATE = 0.18;
  const STORAGE_RATE = 0.28;
  // Panels work throughout the day, but the deliberately steep curve keeps
  // dawn/dusk output tiny and makes solar a complement to wind/hydro. At the
  // equinox one storage panel makes about 40 E per clear 10-minute cycle: just
  // under one radio's continuous demand after copper losses.
  const SUN_CURVE_EXPONENT = 2.2;
  // A regular panel only smooths very short shadows. Persistent/overnight power
  // still requires a storage panel or another generator in the network.
  const PANEL_BUFFER_DECAY = 1.2;
  const PULSE_DECAY = 2.4;
  // Placement hooks and the visible scan register panels immediately. This is
  // only a recovery sweep for old saves/out-of-band edits, so it can be modest.
  const SCAN_INTERVAL = 2.0;
  const SCAN_RX = 52;
  const SCAN_RY = 32;
  const ACTIVE_RX = 68;
  const ACTIVE_RY = 42;
  const REMOTE_UPDATE_INTERVAL = 1.0;
  const CLUSTER_LIMIT = 80;
  const CELL_CAP = 1600;
  const FAR_IDLE_PRUNE_DIST = 260;
  const CATCHUP_MAX_SECONDS = 1800;
  const CATCHUP_SLICE_SECONDS = 15;
  const DAY_CYCLE_SECONDS = 600;
  const EXPOSURE_COLUMN_CAP = 4096;
  // Surface panels care about roofs, trees and towers in their local sky, not
  // unrelated floating islands in another vertical world section. Underground
  // panels still have to see the natural surface through a genuinely open shaft.
  const LOCAL_SKY_CLEARANCE = 48;
  let scanT = 0;
  let remoteUpdateT = 0;
  let pruneT = 0; // pruning does one getTile per registered cell — interval work, not per-frame
  let visibleScanAt = 0;
  let visibleScanKey = '';
  let lastGetTile = null;
  const exposureCache = new Map(); // cell key -> {revision,getTile,exposed}
  const exposureColumnRevision = new Map(); // x -> topology revision above panels
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
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
  function naturalSurfaceAt(x){
    try{
      const wg=MM.worldGen;
      const surface=wg && typeof wg.surfaceHeight==='function' ? Number(wg.surfaceHeight(x)) : NaN;
      return Number.isFinite(surface) ? Math.max(WORLD_TOP,Math.min(WORLD_BOTTOM-1,Math.floor(surface))) : null;
    }catch(e){ return null; }
  }
  function skyExposed(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y)) return false;
    const surface=naturalSurfaceAt(x);
    // Above-ground panels scan a generous local atmosphere. A panel below the
    // generated terrain surface instead scans the entire shaft up to open air.
    const scanTop=surface!=null && y>surface
      ? Math.max(WORLD_TOP,surface-1)
      : Math.max(WORLD_TOP,y-LOCAL_SKY_CLEARANCE);
    for(let yy=y-1; yy>=scanTop; yy--){
      const t=getSafe(getTile,x,yy,T.STONE);
      if(!transparentForSun(t)) return false;
    }
    return true;
  }
  function cycleSunAt(cycleT,dayFrac=0.5){
    const t=((Number(cycleT)||0)%1+1)%1;
    const split=Math.max(0.2,Math.min(0.8,Number(dayFrac)||0.5));
    if(t>=split) return 0;
    return Math.max(0,Math.min(1,Math.sin((t/split)*Math.PI)));
  }
  function solarCurve(raw){
    const sun=Math.max(0,Math.min(1,Number(raw)||0));
    return Math.pow(sun,SUN_CURVE_EXPONENT);
  }
  function cloudTransmissionAt(x){
    try{
      const weather=MM.clouds;
      if(weather && typeof weather.solarTransmissionAt==='function'){
        return Math.max(0.05,Math.min(1,Number(weather.solarTransmissionAt(x))||0));
      }
      // Compatibility fallback for tests/older weather providers. It is
      // intentionally partial rather than the former global all-or-nothing cut.
      const cm=weather && weather.metrics && weather.metrics();
      if(cm){
        const mass=Math.max(0,Number(cm.cloudMass)||0);
        const count=Math.max(0,Number(cm.clouds)||0);
        const storm=cm.storm && cm.storm.active ? Math.max(0.35,Number(cm.storm.intensity)||0.35) : 0;
        const cover=Math.max(0,Math.min(0.88,mass/90+count/40+storm*0.28));
        return 1-cover;
      }
    }catch(e){}
    return 1;
  }
  function clearSkyForSolar(x){
    return cloudTransmissionAt(x)>=0.995;
  }
  function invalidateExposureColumn(x){
    x=Math.floor(x);
    if(!Number.isFinite(x)) return;
    if(!exposureColumnRevision.has(x) && exposureColumnRevision.size>=EXPOSURE_COLUMN_CAP){
      exposureColumnRevision.clear();
      exposureCache.clear();
    }
    exposureColumnRevision.set(x,(exposureColumnRevision.get(x)||0)+1);
  }
  function cachedSkyExposed(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    const id=key(x,y);
    const revision=exposureColumnRevision.get(x)||0;
    const cached=exposureCache.get(id);
    if(cached && cached.revision===revision && cached.getTile===getTile) return cached.exposed;
    const exposed=skyExposed(x,y,getTile);
    exposureCache.set(id,{revision,getTile,exposed});
    return exposed;
  }
  function fullLightSunAt(cycleT,dayFrac=0.5){
    return solarCurve(cycleSunAt(cycleT,dayFrac));
  }
  function currentCycleInfo(){
    try{
      const bg=MM.background;
      const c=bg && bg.timeInfo && bg.timeInfo();
      if(c && (Number.isFinite(Number(c.cycleT)) || typeof c.isDay==='boolean')) return c;
    }catch(e){}
    try{
      const bg=MM.background;
      const c=bg && bg.getCycleInfo && bg.getCycleInfo();
      if(c && (Number.isFinite(Number(c.cycleT)) || typeof c.isDay==='boolean')) return c;
    }catch(e){}
    return {cycleT:0.25,isDay:true,tDay:0.5,dayFrac:0.5};
  }
  function normalizedCycleInfo(info,cycleT){
    const c=info && typeof info==='object' ? info : {};
    const dayFrac=Math.max(0.2,Math.min(0.8,Number(c.dayFrac)||0.5));
    let t=Number.isFinite(Number(cycleT)) ? Number(cycleT) : Number(c.cycleT);
    if(!Number.isFinite(t) && typeof c.isDay==='boolean' && Number.isFinite(Number(c.tDay))){
      const phase=Math.max(0,Math.min(1,Number(c.tDay)));
      t=c.isDay ? phase*dayFrac : dayFrac+phase*(1-dayFrac);
    }
    if(!Number.isFinite(t)) t=0.25;
    t=((t%1)+1)%1;
    const isDay=t<dayFrac;
    const tDay=isDay ? t/dayFrac : (t-dayFrac)/(1-dayFrac);
    return {cycleT:t,isDay,tDay,dayFrac};
  }
  function fullLightForInfo(info,cycleT){
    const c=normalizedCycleInfo(info,cycleT);
    if(!c.isDay) return 0;
    const raw=Math.max(0,Math.min(1,Math.sin(c.tDay*Math.PI)));
    return solarCurve(raw);
  }
  function daylight(){
    const sun=fullLightForInfo(currentCycleInfo());
    return Math.max(0,Math.min(1,sun));
  }
  function averageDaylight(seconds,endCycleT,cycleInfo){
    const span=Math.max(0,Number(seconds)||0);
    const current=cycleInfo || currentCycleInfo();
    if(span<=0.001 && !Number.isFinite(Number(endCycleT))) return fullLightForInfo(current);
    const end=Number.isFinite(Number(endCycleT))
      ? normalizedCycleInfo(current,Number(endCycleT)).cycleT
      : normalizedCycleInfo(current).cycleT;
    const delta=span/DAY_CYCLE_SECONDS;
    const samples=Math.max(4,Math.min(72,Math.ceil(span/30)));
    let total=0;
    for(let i=0; i<samples; i++){
      const f=(i+0.5)/samples;
      total+=fullLightForInfo(current,end-delta+delta*f);
    }
    return Math.max(0,Math.min(1,total/samples));
  }
  function normalizeState(m,t){
    const cap=capacityForTile(t);
    m.energy=Math.max(0,Math.min(cap,Number(m.energy)||0));
    m.power=Math.max(0,Math.min(rateForTile(t),Number(m.power)||0));
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
  function receiveElectricChargeAt(x,y,amount,getTile){ return debugChargeAt(x,y,amount,getTile); }
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
    if(!isSourceTile(t)){ cells.delete(key(m.x,m.y)); exposureCache.delete(key(m.x,m.y)); return; }
    normalizeState(m,t);
    const exposed=cachedSkyExposed(m.x,m.y,getTile);
    const charge=exposed ? sun*rateForTile(t) : 0;
    const cap=capacityForTile(t);
    if(charge>0.001){
      const before=m.energy||0;
      m.energy=Math.min(cap,before+charge*dt);
      m.power=charge;
      if(m.energy>before+0.001) m.pulse=Math.max(m.pulse||0,Math.min(1,0.25+sun*0.75));
    } else {
      m.power=0;
      if(!isStorageTile(t)) m.energy=Math.max(0,(m.energy||0)-PANEL_BUFFER_DECAY*dt);
    }
    m.pulse=Math.max(0,(m.pulse||0)-PULSE_DECAY*dt);
  }
  function pruneCells(player,getTile){
    if(typeof getTile!=='function') return;
    const px=player && Number.isFinite(player.x) ? player.x : 0;
    const py=player && Number.isFinite(player.y) ? player.y : 0;
    const candidates=[];
    for(const [k,m] of cells){
      if(!m || !finiteTile(m.x,m.y)){ cells.delete(k); exposureCache.delete(k); continue; }
      const t=getSafe(getTile,m.x,m.y,T.AIR);
      if(!isSourceTile(t)){ cells.delete(k); exposureCache.delete(k); continue; }
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
    for(let i=0; i<candidates.length && cells.size>target; i++){
      cells.delete(candidates[i].k);
      exposureCache.delete(candidates[i].k);
    }
  }
  function scanAround(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const x0=cx-SCAN_RX, x1=cx+SCAN_RX;
    const y0=Math.max(WORLD_TOP,cy-SCAN_RY), y1=Math.min(WORLD_BOTTOM-1,cy+SCAN_RY);
    const world=MM.world;
    const peek=world && typeof world.peekTile==='function'
      ? (x,y)=>world.peekTile(x,y,T.AIR)
      : getTile;
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(isSourceTile(getSafe(peek,x,y,T.AIR))) ensureCell(x,y,getTile);
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
    pruneT-=dt;
    if(pruneT<=0 || cells.size>CELL_CAP){ pruneT=0.35; pruneCells(player,getTile); }
    remoteUpdateT+=dt;
    const remoteDt=remoteUpdateT>=REMOTE_UPDATE_INTERVAL ? remoteUpdateT : 0;
    if(remoteDt>0) remoteUpdateT=0;
    const hasPlayer=!!(player && Number.isFinite(player.x) && Number.isFinite(player.y));
    const px=hasPlayer ? player.x : 0;
    const py=hasPlayer ? player.y : 0;
    const baseSun=daylight();
    const weatherByColumn=new Map();
    for(const m of cells.values()){ // Map iteration is delete-safe; the spread was per-frame garbage
      const nearby=!hasPlayer || (Math.abs(m.x-px)<=ACTIVE_RX && Math.abs(m.y-py)<=ACTIVE_RY);
      const step=nearby ? dt : remoteDt;
      if(!(step>0)) continue;
      const column=Math.floor(m.x/2);
      let transmission=weatherByColumn.get(column);
      if(transmission===undefined){
        transmission=baseSun>0 ? cloudTransmissionAt(column*2+1) : 1;
        weatherByColumn.set(column,transmission);
      }
      updateCell(m,step,getTile,baseSun*transmission);
    }
  }
  function catchUp(dt,player,getTile){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return false;
    const simDt=Math.max(0,Math.min(CATCHUP_MAX_SECONDS,Number(dt)||0));
    if(simDt<=0) return false;
    lastGetTile=getTile;
    scanAround(player,getTile);
    pruneCells(player,getTile);
    let changed=false;
    const current=currentCycleInfo();
    const end=normalizedCycleInfo(current).cycleT;
    const slices=Math.max(1,Math.ceil(simDt/CATCHUP_SLICE_SECONDS));
    const step=simDt/slices;
    const weatherByColumn=new Map();
    const beforeEnergy=new Map([...cells.values()].filter(Boolean).map(m=>[key(m.x,m.y),m.energy||0]));
    for(let slice=0; slice<slices; slice++){
      // Process oldest -> newest so regular panels correctly lose their small
      // buffer during a night at the end of a long background-tab gap.
      const sliceEnd=end-(simDt-step*(slice+1))/DAY_CYCLE_SECONDS;
      const baseSun=averageDaylight(step,sliceEnd,current);
      for(const m of [...cells.values()]){
        const column=Math.floor(m.x/2);
        let transmission=weatherByColumn.get(column);
        if(transmission===undefined){
          transmission=cloudTransmissionAt(column*2+1);
          weatherByColumn.set(column,transmission);
        }
        updateCell(m,step,getTile,baseSun*transmission);
      }
    }
    for(const [id,before] of beforeEnergy){
      const m=cells.get(id);
      if(!m || Math.abs((m.energy||0)-before)>0.0001){ changed=true; break; }
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
    const y0=Math.max(WORLD_TOP,Math.floor(sy)-2), y1=Math.min(WORLD_BOTTOM-1,Math.ceil(sy+viewY)+2);
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
  function isGeneratingState(machine){
    return isEnergyGenerating(machine && machine.power);
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile){
    if(!ctx) return;
    ensureVisible(sx,sy,viewX,viewY,getTile);
    if(!cells.size) return;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    const lampClock=now*0.005;
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
      drawEnergyGenerationLamp(ctx,TILE,px,py,isGeneratingState(m),0.5+0.5*Math.sin(lampClock+m.x*0.73+m.y*0.41));
    }
    ctx.restore();
  }
  function onTileChanged(x,y,oldTile,newTile){
    if(oldTile===newTile) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    invalidateExposureColumn(tx);
    if(isSourceTile(oldTile) && !isSourceTile(newTile)){
      cells.delete(key(tx,ty));
      exposureCache.delete(key(tx,ty));
    }
    if(isSourceTile(newTile)) ensureCell(tx,ty,MM.world && MM.world.getTile);
  }
  function snapshot(){
    const list=[...cells.values()]
      // Persist empty panels too: otherwise a drained remote farm disappears
      // from the simulation after load until the player physically revisits it.
      .filter(m=>m && finiteTile(m.x,m.y) && (!lastGetTile || isSourceTile(getSafe(lastGetTile,m.x,m.y,T.AIR))))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,CELL_CAP)
      .map(m=>({x:m.x,y:m.y,energy:+(m.energy||0).toFixed(3),power:+(m.power||0).toFixed(2)}));
    return {v:1,list};
  }
  function restore(data,getTile){
    reset();
    if(typeof getTile==='function') lastGetTile=getTile;
    if(!data || !Array.isArray(data.list)) return;
    const limit=Math.min(data.list.length,CELL_CAP);
    for(let i=0;i<limit;i++){
      const raw=data.list[i];
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      const t=getSafe(getTile,x,y,T.AIR);
      if(!isSourceTile(t)) continue;
      const m=ensureCell(x,y,getTile);
      if(m){
        m.energy=Math.max(0,Math.min(capacityForTile(t),Number(raw.energy)||0));
        m.power=Math.max(0,Math.min(rateForTile(t),Number(raw.power)||0));
      }
    }
  }
  function reset(){
    cells.clear();
    scanT=0;
    remoteUpdateT=0;
    visibleScanAt=0;
    visibleScanKey='';
    lastGetTile=null;
    exposureCache.clear();
    exposureColumnRevision.clear();
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
    receiveElectricChargeAt,
    skyExposed,
    update,
    draw,
    onTileChanged,
    snapshot,
    restore,
    reset,
    metrics,
    catchUp,
    _debug:{cells,PANEL_CAPACITY,STORAGE_CAPACITY,PANEL_RATE,STORAGE_RATE,SUN_CURVE_EXPONENT,PANEL_BUFFER_DECAY,LOCAL_SKY_CLEARANCE,SCAN_INTERVAL,SCAN_RX,SCAN_RY,ACTIVE_RX,ACTIVE_RY,REMOTE_UPDATE_INTERVAL,CELL_CAP,CATCHUP_MAX_SECONDS,CATCHUP_SLICE_SECONDS,clusterCells,daylight,averageDaylight,clearSkyForSolar,cloudTransmissionAt,solarCurve,fullLightSunAt,ensureVisible,debugChargeAt,debugSetEnergyAt,isGeneratingState}
  };
  MM.solar=api;
})();

export const solar = (typeof window!=='undefined' && window.MM) ? window.MM.solar : undefined;
export default solar;
