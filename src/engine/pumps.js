// Water pumps and pipes. A pump is a powered one-tile machine with a directional
// intake/output; pipes form cached water networks and only recompute after local
// topology changes are observed.
import { T, INFO, WORLD_H } from '../constants.js';
import { isWaterFillTile } from './material_physics.js';

const pumps = (function(){
  const MM = window.MM = window.MM || {};

  const PUMP_CAPACITY = 80;
  const CHARGE_RATE = 24;
  const PUMP_RATE = 8;
  const ENERGY_PER_WATER = 0.7;
  const MACHINE_CAP = 320;
  const NETWORK_CAP = 900;
  const NETWORK_CACHE_CAP = 260;
  const FLOW_DRAW_CAP = 260;
  const CONSUMER_CHECK_CAP = 48;
  const SOURCE_CHECK_CAP = 64;
  const PIPE_TTL = 0.72;
  const PLAYER_SCAN_INTERVAL = 0.50;
  const VISIBLE_SCAN_INTERVAL_MS = 260;
  const OUTLET_CANDIDATE_CAP = 48;
  const OUTLET_TILES_PER_UPDATE = 2;
  const PASSIVE_COMPONENT_CAP = 720;
  const PASSIVE_QUEUE_CAP = 180;
  const PASSIVE_SCAN_SEEDS = 70;
  const PASSIVE_NETWORKS_PER_UPDATE = 3;
  const PASSIVE_FLOW_RATE = 3.2;
  const PASSIVE_STATE_CAP = 160;
  const SOURCE_REACH_CAP = 34;
  const SOURCE_REACH_DIST = 3;

  const DIR_ORDER = ['east','south','west','north'];
  const DIR_VEC = {
    east:{x:1,y:0,label:'prawo'},
    south:{x:0,y:1,label:'dol'},
    west:{x:-1,y:0,label:'lewo'},
    north:{x:0,y:-1,label:'gora'}
  };

  const machines = new Map();
  const networkCache = new Map();
  const pipeActivity = new Map();
  const flowMarkThrottle = new Map();
  const passiveQueue = [];
  const passiveQueued = new Set();
  const passiveState = new Map();
  let networkRev = 1;
  let scanT = 0;
  let visibleScanKey = '';
  let visibleScanAt = 0;
  let totalMoved = 0;
  let cacheHits = 0;
  let cacheBuilds = 0;
  let cacheInvalidations = 0;
  let capHits = 0;
  let consumerChecks = 0;
  let sourceChecks = 0;
  let passiveTransfers = 0;
  let pumpOutletTransfers = 0;

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function sideKey(m,side){ return key(m.x,m.y)+':'+side+':'+normalizeDir(m.dir); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=0 && y<WORLD_H; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(Math.floor(x),Math.floor(y)) : fallback; }catch(e){ return fallback; }
  }
  function getBaseTile(x,y,getTile){
    try{
      if(MM.world && typeof MM.world.getTile==='function') return MM.world.getTile(Math.floor(x),Math.floor(y));
    }catch(e){}
    return getSafe(getTile,x,y,T.AIR);
  }
  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function isPipeTile(t){ return t===T.WATER_PIPE; }
  function isPumpTile(t){ return t===T.WATER_PUMP; }
  function isWaterDeviceTile(t){ return !!(INFO[t] && INFO[t].waterDevice); }
  function isWaterSourceTile(t){ return t===T.WATER; }
  function isHydraulicTopologyTile(t){ return isPipeTile(t) || isPumpTile(t) || isWaterDeviceTile(t); }
  function isPipeLinkTile(t){ return isPipeTile(t) || isPumpTile(t) || isWaterDeviceTile(t); }
  function normalizeDir(dir){ return DIR_VEC[dir] ? dir : 'east'; }
  function rotateDir(dir){
    const i=DIR_ORDER.indexOf(normalizeDir(dir));
    return DIR_ORDER[(i+1+DIR_ORDER.length)%DIR_ORDER.length];
  }
  function dirVec(dir){ return DIR_VEC[normalizeDir(dir)] || DIR_VEC.east; }
  function sideCell(m,side){
    const d=dirVec(m && m.dir);
    const s=side==='input' ? -1 : 1;
    return {x:Math.floor(m.x)+d.x*s,y:Math.floor(m.y)+d.y*s};
  }
  function clampEnergy(n){ return clamp(Number(n)||0,0,PUMP_CAPACITY); }
  function ensureMachine(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.WATER_PUMP) return null;
    const k=key(x,y);
    let m=machines.get(k);
    if(!m){
      m={x,y,dir:'east',energy:0,pulse:0,flowT:0,lastMoved:0,consumerCursor:0};
      machines.set(k,m);
    }
    m.x=x; m.y=y;
    m.dir=normalizeDir(m.dir);
    m.energy=clampEnergy(m.energy);
    m.pulse=clamp(Number(m.pulse)||0,0,1);
    m.flowT=Math.max(0,Number(m.flowT)||0);
    return m;
  }

  function orientationAt(x,y,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    return m ? normalizeDir(m.dir) : 'east';
  }
  function setOrientationAt(x,y,dir,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m) return false;
    const next=normalizeDir(dir);
    if(m.dir!==next){
      m.dir=next;
      invalidateNetworks();
    }
    m.pulse=1;
    return true;
  }

  function pipeConnections(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    const connect=(nx,ny)=>{
      const t=getSafe(getTile,nx,ny,T.AIR);
      return isPipeTile(t) || isPumpTile(t) || isWaterDeviceTile(t) || isWaterSourceTile(t);
    };
    return {
      left:connect(x-1,y),
      right:connect(x+1,y),
      up:connect(x,y-1),
      down:connect(x,y+1)
    };
  }

  function addUnique(list,seen,item,prefix){
    if(!item) return;
    const id=(prefix||'')+key(item.x,item.y);
    if(seen.has(id)) return;
    seen.add(id);
    list.push(item);
  }
  function isSamePump(m,x,y){ return m && Math.floor(m.x)===Math.floor(x) && Math.floor(m.y)===Math.floor(y); }
  function sourceAt(x,y,getTile){
    return (isWaterSourceTile(getSafe(getTile,x,y,T.AIR)) || isWaterSourceTile(getBaseTile(x,y,getTile))) ? {x:Math.floor(x),y:Math.floor(y)} : null;
  }
  function addSourceCandidate(list,seen,x,y){
    if(!finiteTile(x,y)) return;
    const id=key(x,y);
    if(seen.has(id)) return;
    seen.add(id);
    list.push({x:Math.floor(x),y:Math.floor(y)});
  }
  function consumerAt(x,y,getTile,m){
    if(isSamePump(m,x,y)) return null;
    const t=getSafe(getTile,x,y,T.AIR);
    return isWaterDeviceTile(t) ? {x:Math.floor(x),y:Math.floor(y),tile:t} : null;
  }

  const ADJ = [
    {dx:1,dy:0,name:'right'},
    {dx:-1,dy:0,name:'left'},
    {dx:0,dy:1,name:'down'},
    {dx:0,dy:-1,name:'up'}
  ];
  function oppositeDir(d){ return {dx:-d.dx,dy:-d.dy,name:'opposite'}; }
  function baseGetter(getTile){ return (x,y)=>getBaseTile(x,y,getTile); }
  function canReceiveWaterTile(x,y,getTile){
    if(!finiteTile(x,y)) return false;
    const t=getBaseTile(x,y,getTile);
    return isWaterFillTile(t);
  }
  function wakeWaterAround(x,y,getTile){
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(Math.floor(x),Math.floor(y),baseGetter(getTile)); }catch(e){}
  }
  function addWaterAt(x,y,getTile,setTile){
    if(typeof setTile!=='function' || !canReceiveWaterTile(x,y,getTile)) return false;
    const bx=Math.floor(x), by=Math.floor(y);
    try{
      if(MM.water && typeof MM.water.addSource==='function'){
        if(MM.water.addSource(bx,by,baseGetter(getTile),setTile)) return true;
      }
    }catch(e){}
    if(!canReceiveWaterTile(bx,by,getTile)) return false;
    setTile(bx,by,T.WATER);
    wakeWaterAround(bx,by,getTile);
    return getBaseTile(bx,by,getTile)===T.WATER;
  }
  function removeWaterAt(x,y,getTile,setTile){
    if(typeof setTile!=='function') return false;
    const bx=Math.floor(x), by=Math.floor(y);
    if(getBaseTile(bx,by,getTile)!==T.WATER) return false;
    setTile(bx,by,T.AIR);
    wakeWaterAround(bx,by,getTile);
    return getBaseTile(bx,by,getTile)!==T.WATER;
  }
  function waterSurfaceAt(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || getBaseTile(x,y,getTile)!==T.WATER) return null;
    const start=key(x,y);
    const seen=new Set([start]);
    const q=[{x,y,d:0}];
    let best=null;
    for(let qi=0; qi<q.length && qi<SOURCE_REACH_CAP; qi++){
      const p=q[qi];
      if(getBaseTile(p.x,p.y,getTile)!==T.WATER) continue;
      if(p.y<=0 || getBaseTile(p.x,p.y-1,getTile)!==T.WATER){
        const cand={x:p.x,y:p.y,d:p.d};
        if(!best || cand.y<best.y || (cand.y===best.y && cand.d<best.d) || (cand.y===best.y && cand.d===best.d && cand.x<best.x)) best=cand;
      }
      for(const dir of ADJ){
        const nx=p.x+dir.dx, ny=p.y+dir.dy;
        if(!finiteTile(nx,ny) || getBaseTile(nx,ny,getTile)!==T.WATER) continue;
        const id=key(nx,ny);
        if(seen.has(id)) continue;
        seen.add(id);
        q.push({x:nx,y:ny,d:p.d+1});
      }
    }
    return best ? {x:best.x,y:best.y} : {x,y};
  }
  function reachableWaterSurfaceFromPort(port,getTile){
    if(!port) return null;
    const sx=Math.floor(port.x), sy=Math.floor(port.y);
    if(!finiteTile(sx,sy)) return null;
    const direct=waterSurfaceAt(sx,sy,getTile);
    if(direct) return direct;
    const seen=new Set([key(sx,sy)]);
    const q=[{x:sx,y:sy,d:0}];
    let best=null;
    for(let qi=0; qi<q.length && qi<SOURCE_REACH_CAP; qi++){
      const p=q[qi];
      const t=getBaseTile(p.x,p.y,getTile);
      if(t===T.WATER){
        const surf=waterSurfaceAt(p.x,p.y,getTile);
        if(surf){
          const cand={...surf,d:p.d};
          if(!best || cand.y<best.y || (cand.y===best.y && cand.d<best.d) || (cand.y===best.y && cand.d===best.d && cand.x<best.x)) best=cand;
        }
        continue;
      }
      if(p.d>=SOURCE_REACH_DIST || !canReceiveWaterTile(p.x,p.y,getTile)) continue;
      for(const dir of ADJ){
        const nx=p.x+dir.dx, ny=p.y+dir.dy;
        if(!finiteTile(nx,ny)) continue;
        const nt=getBaseTile(nx,ny,getTile);
        if(nt!==T.WATER && !canReceiveWaterTile(nx,ny,getTile)) continue;
        const id=key(nx,ny);
        if(seen.has(id)) continue;
        seen.add(id);
        q.push({x:nx,y:ny,d:p.d+1});
      }
    }
    return best ? {x:best.x,y:best.y} : null;
  }
  function sourceForPort(port,getTile){
    const surf=reachableWaterSurfaceFromPort(port,getTile);
    return surf ? {level:surf.y,surface:surf} : null;
  }
  function addEndpointPort(ports,seen,kind,x,y,pipeX,pipeY){
    if(!finiteTile(x,y) || ports.length>=OUTLET_CANDIDATE_CAP) return;
    const id=kind+':'+key(x,y);
    if(seen.has(id)) return;
    seen.add(id);
    ports.push({kind,x:Math.floor(x),y:Math.floor(y),pipeX:Math.floor(pipeX),pipeY:Math.floor(pipeY)});
  }
  function endpointPortsFromPipes(pipes,getTile,opts){
    const list=Array.isArray(pipes) ? pipes : [];
    const includeOpen=!opts || opts.includeOpen!==false;
    const includeWater=!opts || opts.includeWater!==false;
    const pipeSet=new Set(list.map(p=>key(p.x,p.y)));
    const ports=[];
    const seen=new Set();
    for(const p of list){
      if(!p || ports.length>=OUTLET_CANDIDATE_CAP) break;
      const px=Math.floor(p.x), py=Math.floor(p.y);
      const links=[];
      for(const d of ADJ){
        const nx=px+d.dx, ny=py+d.dy;
        const nt=getSafe(getTile,nx,ny,T.AIR);
        if(pipeSet.has(key(nx,ny)) || isPumpTile(nt) || isWaterDeviceTile(nt)) links.push(d);
      }
      if(links.length>1) continue;
      if(includeWater && getBaseTile(px,py,getTile)===T.WATER) addEndpointPort(ports,seen,'water',px,py,px,py);
      const dirs=links.length===1 ? [oppositeDir(links[0])] : ADJ;
      for(const d of dirs){
        if(ports.length>=OUTLET_CANDIDATE_CAP) break;
        const nx=px+d.dx, ny=py+d.dy;
        const nt=getSafe(getTile,nx,ny,T.AIR);
        if(isPipeLinkTile(nt)) continue;
        if(includeWater && (nt===T.WATER || getBaseTile(nx,ny,getTile)===T.WATER)) addEndpointPort(ports,seen,'water',nx,ny,px,py);
        else if(includeOpen && canReceiveWaterTile(nx,ny,getTile)) addEndpointPort(ports,seen,'open',nx,ny,px,py);
      }
    }
    return ports;
  }
  function fillTargetForPort(port,getTile){
    if(!port) return null;
    if(port.kind==='open'){
      return canReceiveWaterTile(port.x,port.y,getTile) ? {x:port.x,y:port.y,level:port.y} : null;
    }
    if(port.kind==='water'){
      const surf=waterSurfaceAt(port.x,port.y,getTile);
      if(!surf || surf.y<=0) return null;
      const ty=surf.y-1;
      return canReceiveWaterTile(port.x,ty,getTile) ? {x:port.x,y:ty,level:surf.y} : null;
    }
    return null;
  }
  function drainWaterPort(port,getTile,setTile){
    if(!port) return null;
    const src=sourceForPort(port,getTile);
    const surf=src && src.surface;
    if(!surf) return null;
    return removeWaterAt(surf.x,surf.y,getTile,setTile) ? surf : null;
  }
  function restoreWaterAt(pos,getTile,setTile){
    if(pos && typeof setTile==='function' && canReceiveWaterTile(pos.x,pos.y,getTile)){
      setTile(pos.x,pos.y,T.WATER);
      wakeWaterAround(pos.x,pos.y,getTile);
    }
  }

  function networkCacheEntryValid(m,side,cached){
    if(!cached || cached.rev!==networkRev) return false;
    if(!m || cached.dir!==normalizeDir(m.dir) || cached.side!==side) return false;
    return true;
  }

  function invalidateNetworks(){
    networkRev++;
    networkCache.clear();
    cacheInvalidations++;
  }
  function pruneNetworkCache(){
    if(networkCache.size<=NETWORK_CACHE_CAP) return;
    while(networkCache.size>Math.floor(NETWORK_CACHE_CAP*0.82)){
      const first=networkCache.keys().next();
      if(first.done) break;
      networkCache.delete(first.value);
    }
  }

  function networkForSide(m,side,getTile){
    if(!m || typeof getTile!=='function') return null;
    side = side==='input' ? 'input' : 'output';
    const ck=sideKey(m,side);
    const cached=networkCache.get(ck);
    if(cached){
      if(networkCacheEntryValid(m,side,cached)){
        cacheHits++;
        return cached;
      }
      networkCache.delete(ck);
    }
    cacheBuilds++;
    const pipes=[];
    const pipeSeen=new Set();
    const sources=[];
    const sourceSeen=new Set();
    const sourceCandidates=[];
    const sourceCandidateSeen=new Set();
    const consumers=[];
    const consumerSeen=new Set();
    const q=[];
    const port=sideCell(m,side);
    const pushPipe=(x,y)=>{
      if(!finiteTile(x,y)) return;
      if(getSafe(getTile,x,y,T.AIR)!==T.WATER_PIPE) return;
      const k=key(x,y);
      if(pipeSeen.has(k) || pipeSeen.size>=NETWORK_CAP) return;
      pipeSeen.add(k);
      addUnique(sources,sourceSeen,sourceAt(x,y,getTile),'s:');
      q.push({x,y});
    };
    const inspectNeighbor=(x,y)=>{
      const t=getSafe(getTile,x,y,T.AIR);
      if(isPipeTile(t)) pushPipe(x,y);
      else{
        if(!isHydraulicTopologyTile(t)) addSourceCandidate(sourceCandidates,sourceCandidateSeen,x,y);
        addUnique(sources,sourceSeen,sourceAt(x,y,getTile),'s:');
        addUnique(consumers,consumerSeen,consumerAt(x,y,getTile,m),'c:');
      }
    };
    inspectNeighbor(port.x,port.y);
    for(let qi=0; qi<q.length && qi<NETWORK_CAP; qi++){
      const p=q[qi];
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) inspectNeighbor(p.x+dx,p.y+dy);
    }
    for(const id of pipeSeen){
      const comma=id.indexOf(',');
      pipes.push({x:+id.slice(0,comma),y:+id.slice(comma+1)});
    }
    const hitCap=pipeSeen.size>=NETWORK_CAP;
    if(hitCap) capHits++;
    const outlets=endpointPortsFromPipes(pipes,getTile,{includeOpen:true,includeWater:true});
    const net={rev:networkRev,side,dir:normalizeDir(m.dir),pipeCount:pipes.length,pipes,sources,sourceCandidates,sourceCursor:0,consumers,outlets,outletCursor:0,capHit:hitCap};
    networkCache.set(ck,net);
    pruneNetworkCache();
    return net;
  }

  function waterNeedAt(c,getTile){
    const t=getSafe(getTile,c.x,c.y,T.AIR);
    if(t===T.WATER_TURRET && MM.turrets && typeof MM.turrets.waterNeedAt==='function'){
      return Math.max(0,MM.turrets.waterNeedAt(c.x,c.y,getTile)||0);
    }
    return 0;
  }
  function receiveWaterAt(c,amount,getTile){
    const t=getSafe(getTile,c.x,c.y,T.AIR);
    if(t===T.WATER_TURRET && MM.turrets && typeof MM.turrets.receiveWaterAt==='function'){
      return Math.max(0,MM.turrets.receiveWaterAt(c.x,c.y,amount,getTile)||0);
    }
    return 0;
  }
  function hasLiveSource(net,getTile){
    const sources=net && Array.isArray(net.sources) ? net.sources : [];
    for(const s of sources){
      if(s && (getSafe(getTile,s.x,s.y,T.AIR)===T.WATER || getBaseTile(s.x,s.y,getTile)===T.WATER)) return true;
    }
    const candidates=net && Array.isArray(net.sourceCandidates) ? net.sourceCandidates : [];
    const n=candidates.length;
    if(!n) return false;
    const limit=Math.min(n,SOURCE_CHECK_CAP);
    let cursor=Math.max(0,Math.floor(Number(net.sourceCursor)||0))%n;
    for(let i=0; i<limit; i++){
      const s=candidates[(cursor+i)%n];
      sourceChecks++;
      if(!s || (getSafe(getTile,s.x,s.y,T.AIR)!==T.WATER && getBaseTile(s.x,s.y,getTile)!==T.WATER)) continue;
      if(!sources.some(old=>old && old.x===s.x && old.y===s.y)) sources.push({x:s.x,y:s.y});
      net.sourceCursor=(cursor+i+1)%n;
      return true;
    }
    net.sourceCursor=(cursor+limit)%n;
    return false;
  }

  function markPipe(x,y,level){
    const k=key(x,y);
    const cur=pipeActivity.get(k) || {x:Math.floor(x),y:Math.floor(y),ttl:0,level:0};
    cur.ttl=Math.max(cur.ttl,PIPE_TTL);
    cur.level=Math.min(1,Math.max(cur.level*0.72,level));
    pipeActivity.set(k,cur);
  }
  function markNetworkActivity(net,amount,deviceKey){
    if(!net || !Array.isArray(net.pipes) || !net.pipes.length) return;
    const dk=String(deviceKey||'pipe');
    const now=nowMs();
    if(now-(flowMarkThrottle.get(dk)||0)<80){
      let stillLit=false;
      for(let i=0; i<net.pipes.length && i<14; i++){
        const p=net.pipes[i];
        const a=pipeActivity.get(key(p.x,p.y));
        if(a && (a.ttl||0)>0.08){ stillLit=true; break; }
      }
      if(stillLit) return;
    }
    flowMarkThrottle.set(dk,now);
    const level=Math.max(0.25,Math.min(1,0.2+(Number(amount)||0)/8));
    const cap=Math.min(FLOW_DRAW_CAP,net.pipes.length);
    if(net.pipes.length<=cap){
      for(const p of net.pipes) markPipe(p.x,p.y,level);
      return;
    }
    const stride=Math.max(1,Math.floor(net.pipes.length/cap));
    for(let i=0,count=0; i<net.pipes.length && count<cap; i+=stride,count++) markPipe(net.pipes[i].x,net.pipes[i].y,level);
  }
  function decayPipeActivity(dt,getTile){
    if(!pipeActivity.size) return;
    for(const [k,a] of pipeActivity){
      if(!a){ pipeActivity.delete(k); continue; }
      a.ttl-=dt;
      a.level=Math.max(0,(a.level||0)-dt*0.72);
      if(a.ttl<=0 || a.level<=0.015 || getSafe(getTile,a.x,a.y,T.AIR)!==T.WATER_PIPE) pipeActivity.delete(k);
    }
    if(flowMarkThrottle.size>140){
      const cutoff=nowMs()-2200;
      for(const [k,t] of flowMarkThrottle) if(t<cutoff) flowMarkThrottle.delete(k);
    }
  }

  function dischargeToOutlet(net,amount,getTile,setTile,state,deviceKey){
    if(!net || !Array.isArray(net.outlets) || !net.outlets.length || !(amount>0) || typeof setTile!=='function') return 0;
    const holder=state || net;
    holder.outletCarry=Math.min(OUTLET_TILES_PER_UPDATE+0.98,(Number(holder.outletCarry)||0)+amount);
    let moved=0;
    const n=net.outlets.length;
    let cursor=Math.max(0,Math.floor(Number(holder.outletCursor)||0))%Math.max(1,n);
    const checks=Math.min(n,OUTLET_CANDIDATE_CAP);
    const tileCap=Math.min(OUTLET_TILES_PER_UPDATE,Math.floor(holder.outletCarry));
    for(let unit=0; unit<tileCap; unit++){
      let placed=false;
      for(let i=0; i<checks; i++){
        const idx=(cursor+i)%n;
        const target=fillTargetForPort(net.outlets[idx],getTile);
        if(!target) continue;
        if(addWaterAt(target.x,target.y,getTile,setTile)){
          cursor=(idx+1)%n;
          holder.outletCarry-=1;
          moved+=1;
          placed=true;
          break;
        }
      }
      if(!placed) break;
    }
    holder.outletCursor=cursor;
    if(moved<=0 && holder.outletCarry>=1) holder.outletCarry=0.98;
    if(moved>0){
      pumpOutletTransfers+=moved;
      markNetworkActivity(net,moved,deviceKey||'outlet');
    }
    return moved;
  }

  function pumpTransfer(m,dt,getTile,setTile){
    if(!m || !(dt>0) || (m.energy||0)<=0.001) return 0;
    const output=networkForSide(m,'output',getTile);
    if(!output || (!output.consumers.length && (!output.outlets || !output.outlets.length))) return 0;
    const maxWater=Math.min(PUMP_RATE*dt,(m.energy||0)/ENERGY_PER_WATER);
    if(maxWater<=0.001) return 0;
    const input=networkForSide(m,'input',getTile);
    if(!input || !hasLiveSource(input,getTile)) return 0;
    let remaining=maxWater, moved=0;
    const consumers=output.consumers;
    const n=consumers.length;
    const limit=Math.min(n,CONSUMER_CHECK_CAP);
    let cursor=Math.max(0,Math.floor(Number(m.consumerCursor)||0))%Math.max(1,n);
    for(let i=0; i<limit && remaining>0.001; i++){
      const c=consumers[(cursor+i)%n];
      consumerChecks++;
      if(remaining<=0.001) break;
      const need=waterNeedAt(c,getTile);
      if(need<=0.001) continue;
      const accepted=receiveWaterAt(c,Math.min(remaining,need),getTile);
      if(accepted>0){
        moved+=accepted;
        remaining-=accepted;
      }
    }
    m.consumerCursor=(cursor+limit)%Math.max(1,n);
    if(remaining>0.001){
      const discharged=dischargeToOutlet(output,remaining,getTile,setTile,m,key(m.x,m.y)+':spill');
      if(discharged>0){
        moved+=discharged;
        remaining=Math.max(0,remaining-discharged);
      }
    }
    if(moved>0){
      m.energy=clampEnergy((m.energy||0)-moved*ENERGY_PER_WATER);
      m.pulse=1;
      m.flowT=0.55;
      m.lastMoved=moved;
      totalMoved+=moved;
      markNetworkActivity(input,moved,key(m.x,m.y)+':in');
      markNetworkActivity(output,moved,key(m.x,m.y)+':out');
    }
    return moved;
  }

  function chargeFromNetwork(m,dt,getTile,dynamo){
    const charger=MM.teleporters;
    if(!charger || !charger.chargeBatteryAt) return 0;
    const netTile=(MM.world && MM.world.getNetworkTile) ? MM.world.getNetworkTile : getTile;
    const gained=charger.chargeBatteryAt(m.x,m.y,m,dt,netTile,dynamo,{capacity:PUMP_CAPACITY,rate:CHARGE_RATE});
    if(gained>0) m.pulse=Math.max(m.pulse||0,0.55);
    return gained;
  }

  function enqueuePassivePipe(x,y,getTile){
    if(passiveQueue.length>=PASSIVE_QUEUE_CAP) return;
    if(getSafe(getTile,x,y,T.AIR)!==T.WATER_PIPE) return;
    const id=key(x,y);
    if(passiveQueued.has(id)) return;
    passiveQueued.add(id);
    passiveQueue.push({x:Math.floor(x),y:Math.floor(y)});
  }

  function collectPipeComponent(seed,getTile){
    if(!seed || getSafe(getTile,seed.x,seed.y,T.AIR)!==T.WATER_PIPE) return null;
    const q=[{x:Math.floor(seed.x),y:Math.floor(seed.y)}];
    const seen=new Set([key(seed.x,seed.y)]);
    const pipes=[];
    let attachedPump=false, attachedDevice=false, capHit=false;
    for(let qi=0; qi<q.length; qi++){
      if(pipes.length>=PASSIVE_COMPONENT_CAP){ capHit=true; break; }
      const p=q[qi];
      pipes.push(p);
      for(const d of ADJ){
        const nx=p.x+d.dx, ny=p.y+d.dy;
        const nt=getSafe(getTile,nx,ny,T.AIR);
        if(isPipeTile(nt)){
          const id=key(nx,ny);
          if(!seen.has(id)){
            seen.add(id);
            q.push({x:nx,y:ny});
          }
        } else if(isPumpTile(nt)) attachedPump=true;
        else if(isWaterDeviceTile(nt)) attachedDevice=true;
      }
    }
    if(capHit) capHits++;
    let id=null;
    for(const raw of seen){ if(id==null || raw<id) id=raw; }
    return {id:id||key(seed.x,seed.y),pipes,attachedPump,attachedDevice,capHit};
  }

  function prunePassiveState(){
    if(passiveState.size<=PASSIVE_STATE_CAP) return;
    while(passiveState.size>Math.floor(PASSIVE_STATE_CAP*0.82)){
      const first=passiveState.keys().next();
      if(first.done) break;
      passiveState.delete(first.value);
    }
  }

  function passiveTransfer(comp,state,dt,getTile,setTile){
    if(!comp || !Array.isArray(comp.pipes) || !comp.pipes.length || !(dt>0) || typeof setTile!=='function') return 0;
    const ports=endpointPortsFromPipes(comp.pipes,getTile,{includeOpen:true,includeWater:true});
    if(ports.length<2) return 0;
    const waterPorts=[];
    const dests=[];
    for(const port of ports){
      const src=sourceForPort(port,getTile);
      if(src) waterPorts.push({...port,level:src.level,source:src});
      const target=fillTargetForPort(port,getTile);
      if(target) dests.push({...port,level:target.level,target});
    }
    if(!waterPorts.length || !dests.length) return 0;
    waterPorts.sort((a,b)=>a.level-b.level || a.x-b.x || a.y-b.y);
    const source=waterPorts[0];
    const candidates=dests
      .filter(d=>!(d.kind==='water' && d.x===source.x && d.y===source.y) && source.level<d.level)
      .sort((a,b)=>b.level-a.level || a.x-b.x || a.y-b.y);
    if(!candidates.length) return 0;
    const dest=candidates[0];
    state.carry=Math.min(OUTLET_TILES_PER_UPDATE+0.98,(Number(state.carry)||0)+PASSIVE_FLOW_RATE*dt);
    let moved=0;
    const limit=Math.min(OUTLET_TILES_PER_UPDATE,Math.floor(state.carry));
    for(let i=0; i<limit; i++){
      const liveSource=sourceForPort(source,getTile);
      const liveSourceLevel=liveSource ? liveSource.level : null;
      const target=fillTargetForPort(dest,getTile);
      if(liveSourceLevel==null || !target || liveSourceLevel>=target.level) break;
      const drained=drainWaterPort(source,getTile,setTile);
      if(!drained) break;
      if(addWaterAt(target.x,target.y,getTile,setTile)){
        state.carry-=1;
        moved+=1;
      } else {
        restoreWaterAt(drained,getTile,setTile);
        break;
      }
    }
    if(moved<=0 && state.carry>=1) state.carry=0.98;
    if(moved>0){
      passiveTransfers+=moved;
      markNetworkActivity({pipes:comp.pipes},moved,'passive:'+comp.id);
    }
    return moved;
  }

  function processPassiveNetworks(dt,getTile,setTile){
    if(!passiveQueue.length || typeof setTile!=='function') return 0;
    let processed=0, moved=0;
    while(passiveQueue.length && processed<PASSIVE_NETWORKS_PER_UPDATE){
      const seed=passiveQueue.shift();
      passiveQueued.delete(key(seed.x,seed.y));
      const comp=collectPipeComponent(seed,getTile);
      if(!comp || !comp.pipes.length || comp.attachedPump || comp.attachedDevice || comp.capHit){
        processed++;
        continue;
      }
      const st=passiveState.get(comp.id) || {carry:0};
      const got=passiveTransfer(comp,st,dt,getTile,setTile);
      if(got>0 || (st.carry||0)>0) passiveState.set(comp.id,st);
      moved+=got;
      processed++;
    }
    prunePassiveState();
    return moved;
  }

  function scanNearby(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(Number(player.x)||0);
    const cy=Math.floor(Number(player.y)||0);
    const rx=58, ry=36;
    const y0=Math.max(0,cy-ry), y1=Math.min(WORLD_H-1,cy+ry);
    let pipeSeeds=0;
    for(let y=y0; y<=y1; y++){
      for(let x=cx-rx; x<=cx+rx; x++){
        const t=getSafe(getTile,x,y,T.AIR);
        if(t===T.WATER_PUMP) ensureMachine(x,y,getTile);
        else if(t===T.WATER_PIPE && pipeSeeds<PASSIVE_SCAN_SEEDS){
          enqueuePassivePipe(x,y,getTile);
          pipeSeeds++;
        }
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
        if(getSafe(getTile,x,y,T.AIR)===T.WATER_PUMP) ensureMachine(x,y,getTile);
      }
    }
  }

  function update(dt,player,getTile,setTile,opts){
    if(!(dt>0) || !Number.isFinite(dt)) return;
    if(typeof getTile!=='function') return;
    decayPipeActivity(Math.min(0.08,dt),getTile);
    scanT-=dt;
    if(scanT<=0){
      scanT=PLAYER_SCAN_INTERVAL;
      scanNearby(player,getTile);
    }
    const dynamo=opts && opts.dynamo;
    const px=player && Number.isFinite(player.x) ? player.x : 0;
    const py=player && Number.isFinite(player.y) ? player.y : 0;
    for(const [k,m] of machines){
      if(!m || getSafe(getTile,m.x,m.y,T.AIR)!==T.WATER_PUMP){
        machines.delete(k);
        continue;
      }
      m.dir=normalizeDir(m.dir);
      m.energy=clampEnergy(m.energy);
      m.pulse=Math.max(0,(m.pulse||0)-dt*2.6);
      m.flowT=Math.max(0,(m.flowT||0)-dt);
      chargeFromNetwork(m,dt,getTile,dynamo);
      pumpTransfer(m,dt,getTile,setTile);
    }
    processPassiveNetworks(dt,getTile,setTile);
    if(machines.size>MACHINE_CAP){
      const idle=[...machines.entries()]
        .filter(([,m])=>m && (m.energy||0)<=0.001 && (m.pulse||0)<=0.001 && (m.flowT||0)<=0.001)
        .map(([k,m])=>({k,d:Math.abs((m.x||0)-px)+Math.abs((m.y||0)-py)}))
        .sort((a,b)=>b.d-a.d);
      for(let i=0; i<idle.length && machines.size>Math.floor(MACHINE_CAP*0.84); i++) machines.delete(idle[i].k);
    }
  }

  function drawPipeTile(ctx,TILE,px,py,conn,h){
    if(!ctx) return;
    const cx=px+TILE*0.5, cy=py+TILE*0.5;
    const c=conn || {left:true,right:true,up:false,down:false};
    const any=c.left||c.right||c.up||c.down;
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.strokeStyle='rgba(4,28,42,0.82)';
    ctx.lineWidth=Math.max(2,TILE*0.34);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+1,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-1,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+1); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-1); }
    ctx.stroke();
    ctx.strokeStyle='#2d8ec9';
    ctx.lineWidth=Math.max(1,TILE*0.22);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+2); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-2); }
    ctx.stroke();
    ctx.strokeStyle='rgba(178,244,255,0.72)';
    ctx.lineWidth=Math.max(1,TILE*0.055);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy-TILE*0.06); ctx.lineTo(px+4,cy-TILE*0.06); }
    if(c.right || !any){ ctx.moveTo(cx,cy-TILE*0.06); ctx.lineTo(px+TILE-4,cy-TILE*0.06); }
    if(c.up){ ctx.moveTo(cx+TILE*0.06,cy); ctx.lineTo(cx+TILE*0.06,py+4); }
    if(c.down){ ctx.moveTo(cx+TILE*0.06,cy); ctx.lineTo(cx+TILE*0.06,py+TILE-4); }
    ctx.stroke();
    const branches=(c.left?1:0)+(c.right?1:0)+(c.up?1:0)+(c.down?1:0);
    ctx.fillStyle=branches>=3?'#79dfff':'#4cb5df';
    ctx.beginPath();
    ctx.arc(cx,cy,Math.max(2,TILE*(branches>=3?0.19:0.14)),0,Math.PI*2);
    ctx.fill();
    if(((h||0)&9)===0){
      ctx.fillStyle='rgba(210,255,255,0.88)';
      ctx.fillRect(cx+TILE*0.10,cy-TILE*0.20,Math.max(1,TILE*0.08),Math.max(1,TILE*0.08));
    }
    ctx.restore();
  }

  function drawFlow(ctx,TILE,px,py,conn,level,ttl,h,phase){
    const fade=clamp(ttl/PIPE_TTL,0,1);
    const a=clamp(level,0,1)*fade;
    if(a<=0.01) return;
    const c=conn || {left:true,right:true,up:false,down:false};
    const any=c.left||c.right||c.up||c.down;
    const cx=px+TILE*0.5, cy=py+TILE*0.5;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.strokeStyle='rgba(73,215,255,'+(0.26+0.46*a).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*(0.12+0.10*a));
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+3,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-3,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+3); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-3); }
    ctx.stroke();
    const dirs=[];
    if(c.left || !any) dirs.push([-1,0]);
    if(c.right || !any) dirs.push([1,0]);
    if(c.up) dirs.push([0,-1]);
    if(c.down) dirs.push([0,1]);
    for(let i=0; i<2; i++){
      const idx=((h>>>((i*7)&15)) % Math.max(1,dirs.length));
      const d=dirs[idx] || [1,0];
      const seed=((h>>>((i*5+4)&15))&255)/255;
      const travel=(phase*0.8+seed+i*0.33)%1;
      const dist=(0.14+0.70*travel)*TILE*(d[0]||d[1]);
      const sx=cx + (d[0]?dist:((seed-0.5)*TILE*0.08));
      const sy=cy + (d[1]?dist:((seed-0.5)*TILE*0.08));
      ctx.fillStyle='rgba(214,255,255,'+(0.42+0.48*a).toFixed(3)+')';
      ctx.beginPath();
      ctx.arc(sx,sy,Math.max(1,TILE*(0.05+0.035*a)),0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPumpTile(ctx,TILE,px,py,dir,charge,pulse,flow){
    if(!ctx) return;
    const d=dirVec(dir);
    const input={x:-d.x,y:-d.y};
    const output=d;
    const cx=px+TILE*0.5, cy=py+TILE*0.5;
    const glow=clamp((charge||0)*0.5+(pulse||0)*0.35+(flow||0)*0.45,0,1);
    ctx.save();
    ctx.fillStyle='rgba(4,16,22,0.86)';
    ctx.fillRect(px+2,py+2,TILE-4,TILE-4);
    ctx.strokeStyle='rgba(128,232,255,'+(0.34+0.36*glow).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.08);
    ctx.strokeRect(px+TILE*0.14,py+TILE*0.14,TILE*0.72,TILE*0.72);
    ctx.fillStyle='rgba(25,96,120,0.82)';
    ctx.beginPath();
    ctx.arc(cx,cy,TILE*0.24,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle='rgba(214,255,255,'+(0.52+0.36*glow).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.05);
    ctx.beginPath();
    ctx.arc(cx,cy,TILE*(0.15+0.02*glow),0,Math.PI*2);
    ctx.stroke();
    function arrow(vec,color,scale){
      const bx=cx+vec.x*TILE*0.31;
      const by=cy+vec.y*TILE*0.31;
      const nx=-vec.y, ny=vec.x;
      ctx.fillStyle=color;
      ctx.beginPath();
      ctx.moveTo(bx+vec.x*TILE*0.16*scale,by+vec.y*TILE*0.16*scale);
      ctx.lineTo(bx-vec.x*TILE*0.10*scale+nx*TILE*0.11*scale,by-vec.y*TILE*0.10*scale+ny*TILE*0.11*scale);
      ctx.lineTo(bx-vec.x*TILE*0.10*scale-nx*TILE*0.11*scale,by-vec.y*TILE*0.10*scale-ny*TILE*0.11*scale);
      ctx.closePath();
      ctx.fill();
    }
    arrow(input,'rgba(72,154,255,0.86)',0.95);
    arrow(output,'rgba(102,255,223,'+(0.72+0.25*glow).toFixed(3)+')',1.08);
    const barX=px+TILE*0.18, barY=py+TILE*0.79, barW=TILE*0.64, barH=Math.max(1,TILE*0.045);
    ctx.fillStyle='rgba(0,6,10,0.72)';
    ctx.fillRect(barX,barY,barW,barH);
    ctx.fillStyle=charge>0.5 ? '#8cffd8' : (charge>0.18 ? '#ffe38f' : '#ff7a5a');
    ctx.fillRect(barX,barY,Math.max(1,barW*clamp(charge||0,0,1)),barH);
    if(flow>0.01){
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle='rgba(82,224,255,'+(0.22+0.52*flow).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,TILE*0.08);
      ctx.beginPath();
      ctx.moveTo(cx-input.x*TILE*0.42,cy-input.y*TILE*0.42);
      ctx.lineTo(cx+output.x*TILE*0.42,cy+output.y*TILE*0.42);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile){
    if(!ctx) return;
    ensureVisibleMachines(sx,sy,viewX,viewY,getTile);
    if(!machines.size && !pipeActivity.size) return;
    const phase=((typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now())*0.006;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    if(pipeActivity.size){
      ctx.save();
      for(const a of pipeActivity.values()){
        if(!a || a.x<sx-2 || a.x>sx+viewX+2 || a.y<sy-2 || a.y>sy+viewY+2) continue;
        if(visible && !visible(a.x,a.y)) continue;
        if(getSafe(getTile,a.x,a.y,T.AIR)!==T.WATER_PIPE) continue;
        const conn=pipeConnections(a.x,a.y,getTile);
        drawFlow(ctx,TILE,a.x*TILE,a.y*TILE,conn,a.level||0,a.ttl||0,((a.x*73856093)^(a.y*19349663))>>>0,phase+a.x*0.17+a.y*0.13);
      }
      ctx.restore();
    }
    for(const m of machines.values()){
      if(!m || m.x<sx-2 || m.x>sx+viewX+2 || m.y<sy-2 || m.y>sy+viewY+2) continue;
      if(visible && !visible(m.x,m.y)) continue;
      if(getSafe(getTile,m.x,m.y,T.AIR)!==T.WATER_PUMP) continue;
      drawPumpTile(ctx,TILE,m.x*TILE,m.y*TILE,m.dir,clamp((m.energy||0)/PUMP_CAPACITY,0,1),m.pulse||0,clamp((m.flowT||0)/0.55,0,1));
    }
  }

  function onTileChanged(x,y,oldTile,newTile){
    if(oldTile===newTile) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    const oldHyd=isHydraulicTopologyTile(oldTile);
    const newHyd=isHydraulicTopologyTile(newTile);
    if(oldHyd || newHyd){
      if(isPumpTile(oldTile) && !isPumpTile(newTile)) machines.delete(key(tx,ty));
      if(isPumpTile(newTile)) ensureMachine(tx,ty,MM.world && MM.world.getTile);
      if(isPipeTile(oldTile) && !isPipeTile(newTile)) pipeActivity.delete(key(tx,ty));
      invalidateNetworks();
      return;
    }
  }

  function snapshot(){
    const list=[...machines.values()]
      .filter(m=>m && finiteTile(m.x,m.y) && ((m.energy||0)>0.001 || normalizeDir(m.dir)!=='east'))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MACHINE_CAP)
      .map(m=>({x:m.x,y:m.y,dir:normalizeDir(m.dir),energy:+(m.energy||0).toFixed(3)}));
    return {v:1,list};
  }
  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
      if(machines.size>=MACHINE_CAP) break;
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(getTile && getSafe(getTile,x,y,T.AIR)!==T.WATER_PUMP) continue;
      const m=ensureMachine(x,y,getTile);
      if(!m) continue;
      m.dir=normalizeDir(raw.dir);
      m.energy=clampEnergy(raw.energy);
    }
  }
  function reset(){
    machines.clear();
    networkCache.clear();
    pipeActivity.clear();
    flowMarkThrottle.clear();
    passiveQueue.length=0;
    passiveQueued.clear();
    passiveState.clear();
    networkRev++;
    cacheHits=0;
    cacheBuilds=0;
    cacheInvalidations=0;
    capHits=0;
    consumerChecks=0;
    sourceChecks=0;
    passiveTransfers=0;
    pumpOutletTransfers=0;
    scanT=0;
    visibleScanKey='';
    visibleScanAt=0;
    totalMoved=0;
  }
  function metrics(){
    let storedEnergy=0, charged=0, active=0;
    for(const m of machines.values()){
      storedEnergy+=Math.max(0,m.energy||0);
      if((m.energy||0)>0.001) charged++;
      if((m.flowT||0)>0 || (m.pulse||0)>0.05) active++;
    }
    return {machines:machines.size, active, charged, storedEnergy:+storedEnergy.toFixed(2), moved:+totalMoved.toFixed(2), passiveMoved:+passiveTransfers.toFixed(2), outletMoved:+pumpOutletTransfers.toFixed(2), activePipes:pipeActivity.size, passiveQueue:passiveQueue.length, networkRev, cacheSize:networkCache.size, cacheHits, cacheBuilds, cacheInvalidations, capHits, consumerChecks, sourceChecks};
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
    isPipeTile,
    isPumpTile,
    isWaterDeviceTile,
    pipeConnections,
    drawPipeTile,
    drawPumpTile,
    orientationAt,
    setOrientationAt,
    rotateDir,
    update,
    draw,
    onTileChanged,
    snapshot,
    restore,
    reset,
    metrics,
    _debug:{machines,networkCache,pipeActivity,PUMP_CAPACITY,CHARGE_RATE,PUMP_RATE,ENERGY_PER_WATER,CONSUMER_CHECK_CAP,SOURCE_CHECK_CAP,ensureMachine,networkForSide,debugChargeAt,debugSetEnergyAt}
  };
  MM.pumps=api;
  return api;
})();

export { pumps };
export default pumps;
