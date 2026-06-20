// Teleporters and copper power cables. Copper wires form a lightweight machine
// network: adjacent dynamos can charge devices directly or through contiguous
// copper cable runs, while each teleporter keeps its own small battery.
import { T, INFO, WORLD_H, CHUNK_W } from '../constants.js';

(function(){
  window.MM = window.MM || {};

  const machines = new Map(); // "x,y" -> {x,y,energy,pulse,cooldown,lastUse}
  const networkCache = new Map(); // teleporter key -> {rev,dynamos:[{x,y}]}
  const wireActivity = new Map(); // "x,y" -> {x,y,ttl,level}
  const wireMarkThrottle = new Map(); // device key -> ms of last cable pulse paint
  const TELEPORTER_CAPACITY = 160;
  const MACHINE_CAP = 1200;
  const TRAVEL_COST = 35;
  const CHARGE_RATE = 28;
  const NETWORK_CAP = 900;
  const NETWORK_CACHE_CAP = 420;
  const FLOW_DRAW_CAP = 260;
  const FLOW_MARK_INTERVAL_MS = 90;
  const WIRE_TTL = 0.62;
  const TELEPORT_COOLDOWN = 0.72;
  const PLAYER_SCAN_INTERVAL = 0.45;
  const VISIBLE_SCAN_INTERVAL_MS = 250;

  let networkRev = 1;
  let scanT = 0;
  let teleporterListStamp = '';
  let teleporterListCache = [];
  let visibleScanKey = '';
  let visibleScanAt = 0;

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=0 && y<WORLD_H; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function clampEnergy(n){ return Math.max(0,Math.min(TELEPORTER_CAPACITY,Number(n)||0)); }
  function isTeleporter(t){ return t===T.TELEPORTER; }
  function isCable(t){ return t===T.COPPER_WIRE; }
  function isDynamoTile(t){ return t===T.DYNAMO || t===T.DYNAMO_SLOT; }
  function isSolarTile(t){ return !!(MM.solar && MM.solar.isSourceTile && MM.solar.isSourceTile(t)); }
  function isPowerDeviceTile(t){ return !!(INFO[t] && INFO[t].powerDevice); }
  function isPowerSourceTile(t){ return isDynamoTile(t) || !!(INFO[t] && INFO[t].powerSource); }
  function isMachineNetworkTile(t){ return isCable(t) || isPowerDeviceTile(t) || isPowerSourceTile(t); }
  function invalidateTeleporterSearch(){
    teleporterListStamp='';
    teleporterListCache=[];
  }
  function ensureMachine(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) return null;
    const k=key(x,y);
    let m=machines.get(k);
    if(!m){
      m={x,y,energy:0,pulse:0,cooldown:0,lastUse:0};
      machines.set(k,m);
    }
    m.x=x; m.y=y;
    m.energy=clampEnergy(m.energy);
    m.pulse=Math.max(0,Math.min(1,Number(m.pulse)||0));
    return m;
  }
  function cableConnections(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    return {
      left:isMachineNetworkTile(getSafe(getTile,x-1,y,T.AIR)),
      right:isMachineNetworkTile(getSafe(getTile,x+1,y,T.AIR)),
      up:isMachineNetworkTile(getSafe(getTile,x,y-1,T.AIR)),
      down:isMachineNetworkTile(getSafe(getTile,x,y+1,T.AIR))
    };
  }
  function drawCableTile(ctx,TILE,px,py,conn,h){
    if(!ctx) return;
    const cx=px+TILE*0.5, cy=py+TILE*0.5;
    const any=conn && (conn.left||conn.right||conn.up||conn.down);
    const c=conn || {left:true,right:true,up:false,down:false};
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.strokeStyle='rgba(67,34,13,0.78)';
    ctx.lineWidth=Math.max(2,TILE*0.26);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+1,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-1,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+1); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-1); }
    ctx.stroke();
    ctx.strokeStyle='#d68535';
    ctx.lineWidth=Math.max(1,TILE*0.15);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+2); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-2); }
    ctx.stroke();
    ctx.strokeStyle='rgba(255,222,128,0.82)';
    ctx.lineWidth=Math.max(1,TILE*0.045);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy-1); ctx.lineTo(px+4,cy-1); }
    if(c.right || !any){ ctx.moveTo(cx,cy-1); ctx.lineTo(px+TILE-4,cy-1); }
    if(c.up){ ctx.moveTo(cx+1,cy); ctx.lineTo(cx+1,py+4); }
    if(c.down){ ctx.moveTo(cx+1,cy); ctx.lineTo(cx+1,py+TILE-4); }
    ctx.stroke();
    const branches=(c.left?1:0)+(c.right?1:0)+(c.up?1:0)+(c.down?1:0);
    ctx.fillStyle=branches>=3?'#ffe38f':'#f0a34c';
    ctx.beginPath();
    ctx.arc(cx,cy,Math.max(2,TILE*(branches>=3?0.17:0.13)),0,Math.PI*2);
    ctx.fill();
    if(((h||0)&7)===0){
      ctx.fillStyle='rgba(255,244,172,0.92)';
      ctx.fillRect(cx+TILE*0.12,cy-TILE*0.17,Math.max(1,TILE*0.08),Math.max(1,TILE*0.08));
    }
    ctx.restore();
  }
  function nowMs(){
    return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
  }
  function markWire(x,y,level){
    const k=key(x,y);
    const cur=wireActivity.get(k) || {x:Math.floor(x),y:Math.floor(y),ttl:0,level:0};
    cur.ttl=Math.max(cur.ttl,WIRE_TTL);
    cur.level=Math.min(1,Math.max(cur.level*0.72,level));
    wireActivity.set(k,cur);
  }
  function markNetworkActivity(net,amount,deviceKey){
    if(!net || !Array.isArray(net.cables) || !net.cables.length) return;
    const dk=String(deviceKey||'network');
    const now=nowMs();
    if(now-(wireMarkThrottle.get(dk)||0)<FLOW_MARK_INTERVAL_MS){
      let stillLit=false;
      for(let i=0; i<net.cables.length && i<16; i++){
        const c=net.cables[i];
        const a=wireActivity.get(key(c.x,c.y));
        if(a && (a.ttl||0)>0.08){ stillLit=true; break; }
      }
      if(stillLit) return;
    }
    wireMarkThrottle.set(dk,now);
    const level=Math.max(0.22,Math.min(1,0.18+(Number(amount)||0)/18));
    const cap=Math.min(FLOW_DRAW_CAP,net.cables.length);
    if(net.cables.length<=cap){
      for(const c of net.cables) markWire(c.x,c.y,level);
      return;
    }
    const stride=Math.max(1,Math.floor(net.cables.length/cap));
    for(let i=0,count=0; i<net.cables.length && count<cap; i+=stride,count++){
      const c=net.cables[i];
      markWire(c.x,c.y,level);
    }
  }
  function decayWireActivity(dt,getTile){
    if(!wireActivity.size) return;
    for(const [k,a] of wireActivity){
      if(!a){ wireActivity.delete(k); continue; }
      a.ttl-=dt;
      a.level=Math.max(0,(a.level||0)-dt*0.75);
      if(a.ttl<=0 || a.level<=0.015 || getSafe(getTile,a.x,a.y,T.AIR)!==T.COPPER_WIRE) wireActivity.delete(k);
    }
    if(wireMarkThrottle.size>120){
      const cutoff=nowMs()-2000;
      for(const [k,t] of wireMarkThrottle) if(t<cutoff) wireMarkThrottle.delete(k);
    }
  }
  function drawCableEnergy(ctx,TILE,px,py,conn,level,ttl,h,phase){
    const fade=Math.max(0,Math.min(1,ttl/WIRE_TTL));
    const a=Math.max(0,Math.min(1,level))*fade;
    if(a<=0.01) return;
    const c=conn || {left:true,right:true,up:false,down:false};
    const any=c.left||c.right||c.up||c.down;
    const cx=px+TILE*0.5, cy=py+TILE*0.5;
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.globalCompositeOperation='lighter';
    ctx.strokeStyle='rgba(96,238,255,'+(0.18+0.40*a).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*(0.10+0.10*a));
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+2); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-2); }
    ctx.stroke();
    ctx.strokeStyle='rgba(255,244,145,'+(0.16+0.58*a).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.045);
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
    const sparks=Math.min(2,Math.max(1,Math.round(a*2)));
    for(let i=0;i<sparks;i++){
      const idx=((h>>>((i*7)&15)) % Math.max(1,dirs.length));
      const d=dirs[idx] || [1,0];
      const seed=((h>>>((i*5+3)&15))&255)/255;
      const travel=(phase*0.9+seed+i*0.37)%1;
      const dist=(0.13+0.72*travel)*TILE*(d[0]||d[1]);
      const sx=cx + (d[0]?dist:((seed-0.5)*TILE*0.08));
      const sy=cy + (d[1]?dist:((seed-0.5)*TILE*0.08));
      const r=Math.max(1,TILE*(0.045+0.045*a));
      ctx.fillStyle='rgba(255,250,183,'+(0.45+0.50*a).toFixed(3)+')';
      ctx.beginPath();
      ctx.arc(sx,sy,r,0,Math.PI*2);
      ctx.fill();
      if(a>0.45){
        ctx.strokeStyle='rgba(118,241,255,'+(0.25+0.45*a).toFixed(3)+')';
        ctx.lineWidth=Math.max(1,TILE*0.035);
        ctx.beginPath();
        ctx.moveTo(sx-d[0]*TILE*0.12-(d[1]*TILE*0.05),sy-d[1]*TILE*0.12-(d[0]*TILE*0.05));
        ctx.lineTo(sx+d[0]*TILE*0.12+(d[1]*TILE*0.05),sy+d[1]*TILE*0.12+(d[0]*TILE*0.05));
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function dynamoSlotAt(x,y,getTile){
    const D=MM.dynamo;
    if(!D) return null;
    if(D.structureCellsAt){
      let cells=null;
      try{ cells=D.structureCellsAt(x,y,getTile); }catch(e){ cells=null; }
      if(Array.isArray(cells)){
        for(const cell of cells){
          if(!cell) continue;
          if((cell.role==='slot' || getSafe(getTile,cell.x,cell.y,T.AIR)===T.DYNAMO_SLOT) && (!D.isValidSlot || D.isValidSlot(cell.x,cell.y,getTile))){
            return {x:Math.floor(cell.x),y:Math.floor(cell.y)};
          }
        }
      }
    }
    if(getSafe(getTile,x,y,T.AIR)===T.DYNAMO_SLOT && (!D.isValidSlot || D.isValidSlot(x,y,getTile))){
      return {x:Math.floor(x),y:Math.floor(y)};
    }
    return null;
  }
  function addDynamoSlot(slots,slot){
    if(!slot) return;
    const k=key(slot.x,slot.y);
    if(slots.seen.has(k)) return;
    slots.seen.add(k);
    slots.list.push(slot);
  }
  function addSource(sources,source){
    if(!source) return;
    const k=(source.kind||'source')+':'+key(source.x,source.y);
    if(sources.seen.has(k)) return;
    sources.seen.add(k);
    sources.list.push(source);
  }
  function sourceNodeAt(x,y,getTile){
    const t=getSafe(getTile,x,y,T.AIR);
    if(isDynamoTile(t)){
      const d=dynamoSlotAt(x,y,getTile);
      return d ? {kind:'dynamo',x:d.x,y:d.y} : null;
    }
    if(isSolarTile(t)){
      try{
        const s=MM.solar.sourceAt(x,y,getTile);
        return s ? {kind:'solar',x:s.x,y:s.y,cells:s.cells||1} : null;
      }catch(e){ return null; }
    }
    return null;
  }
  function sourceCacheKey(source){
    if(!source) return '';
    return (source.kind||'source')+':'+key(source.x,source.y);
  }
  function cachedSourceList(cached){
    if(cached && Array.isArray(cached.sources) && cached.sources.length) return cached.sources;
    if(cached && Array.isArray(cached.dynamos)) return cached.dynamos.map(d=>({kind:'dynamo',x:d.x,y:d.y}));
    return [];
  }
  function networkCacheEntryValid(tx,ty,cached,getTile){
    if(!cached || cached.rev!==networkRev || typeof getTile!=='function') return false;
    const cableKeys=new Set();
    const cables=Array.isArray(cached.cables) ? cached.cables : [];
    if(cables.length !== (Number(cached.cableCount)||0)) return false;
    for(const c of cables){
      if(!c || !finiteTile(c.x,c.y) || getSafe(getTile,c.x,c.y,T.AIR)!==T.COPPER_WIRE) return false;
      cableKeys.add(key(c.x,c.y));
    }
    const sourceKeys=new Set(cachedSourceList(cached).map(sourceCacheKey).filter(Boolean));
    const seenSources=new Set();
    const inspectNeighbor=(nx,ny)=>{
      const t=getSafe(getTile,nx,ny,T.AIR);
      if(isCable(t)) return cableKeys.has(key(nx,ny));
      const src=sourceNodeAt(nx,ny,getTile);
      if(src){
        const sk=sourceCacheKey(src);
        if(!sourceKeys.has(sk)) return false;
        seenSources.add(sk);
      }
      return true;
    };
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      if(!inspectNeighbor(tx+dx,ty+dy)) return false;
    }
    for(const c of cables){
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        if(!inspectNeighbor(c.x+dx,c.y+dy)) return false;
      }
    }
    for(const sk of sourceKeys) if(!seenSources.has(sk)) return false;
    return true;
  }
  function pruneNetworkCache(getTile){
    if(networkCache.size<=NETWORK_CACHE_CAP) return;
    for(const [k,net] of networkCache){
      const comma=k.indexOf(',');
      const tx=+k.slice(0,comma), ty=+k.slice(comma+1);
      if(!networkCacheEntryValid(tx,ty,net,getTile)) networkCache.delete(k);
      if(networkCache.size<=NETWORK_CACHE_CAP) return;
    }
    while(networkCache.size>Math.floor(NETWORK_CACHE_CAP*0.82)){
      const first=networkCache.keys().next();
      if(first.done) break;
      networkCache.delete(first.value);
    }
  }
  function networkFor(tx,ty,getTile){
    tx=Math.floor(tx); ty=Math.floor(ty);
    const tk=key(tx,ty);
    const cached=networkCache.get(tk);
    if(cached){
      if(networkCacheEntryValid(tx,ty,cached,getTile)) return cached;
      networkCache.delete(tk);
    }
    const dynamos={seen:new Set(),list:[]};
    const sources={seen:new Set(),list:[]};
    const seen=new Set();
    const q=[];
    const pushCable=(x,y)=>{
      if(!finiteTile(x,y)) return;
      if(getSafe(getTile,x,y,T.AIR)!==T.COPPER_WIRE) return;
      const k=key(x,y);
      if(seen.has(k) || seen.size>=NETWORK_CAP) return;
      seen.add(k);
      q.push({x,y});
    };
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
      const nx=tx+dx, ny=ty+dy;
      const t=getSafe(getTile,nx,ny,T.AIR);
      if(isCable(t)) pushCable(nx,ny);
      else {
        const src=sourceNodeAt(nx,ny,getTile);
        addSource(sources,src);
        if(src && src.kind==='dynamo') addDynamoSlot(dynamos,{x:src.x,y:src.y});
      }
    });
    for(let qi=0; qi<q.length && qi<NETWORK_CAP; qi++){
      const c=q[qi];
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{
        const nx=c.x+dx, ny=c.y+dy;
        const t=getSafe(getTile,nx,ny,T.AIR);
        if(isCable(t)) pushCable(nx,ny);
        else {
          const src=sourceNodeAt(nx,ny,getTile);
          addSource(sources,src);
          if(src && src.kind==='dynamo') addDynamoSlot(dynamos,{x:src.x,y:src.y});
        }
      });
    }
    const cables=[...seen].map(id=>{
      const comma=id.indexOf(',');
      return {x:+id.slice(0,comma),y:+id.slice(comma+1)};
    });
    const net={rev:networkRev,dynamos:dynamos.list,sources:sources.list,cableCount:seen.size,cables};
    networkCache.set(tk,net);
    pruneNetworkCache(getTile);
    return net;
  }
  function sourceEnergy(source,getTile,dynamo){
    if(!source) return 0;
    if(source.kind==='dynamo'){
      const D=dynamo || MM.dynamo;
      return (D && D.energyAt) ? Math.max(0,D.energyAt(source.x,source.y,getTile)||0) : 0;
    }
    if(source.kind==='solar'){
      const S=MM.solar;
      return (S && S.energyAt) ? Math.max(0,S.energyAt(source.x,source.y,getTile)||0) : 0;
    }
    return 0;
  }
  function drainSource(source,amount,getTile,dynamo){
    if(!source) return 0;
    const want=Math.max(0,Number(amount)||0);
    if(want<=0) return 0;
    if(source.kind==='dynamo'){
      const D=dynamo || MM.dynamo;
      const got=(D && D.drainAt) ? D.drainAt(source.x,source.y,want,getTile) : null;
      return got && got.amount>0 ? got.amount : 0;
    }
    if(source.kind==='solar'){
      const S=MM.solar;
      const got=(S && S.drainAt) ? S.drainAt(source.x,source.y,want,getTile) : null;
      return got && got.amount>0 ? got.amount : 0;
    }
    return 0;
  }
  function connectedDynamoEnergy(m,getTile,dynamo){
    const net=networkFor(m.x,m.y,getTile);
    let total=0;
    const sources=Array.isArray(net.sources) && net.sources.length ? net.sources : net.dynamos.map(d=>({kind:'dynamo',x:d.x,y:d.y}));
    for(const s of sources) total+=sourceEnergy(s,getTile,dynamo);
    return total;
  }
  function connectedDynamosAt(x,y,getTile){
    return networkFor(x,y,getTile).dynamos.slice();
  }
  function availableNetworkEnergyAt(x,y,getTile,dynamo){
    let total=0;
    const net=networkFor(x,y,getTile);
    const sources=Array.isArray(net.sources) && net.sources.length ? net.sources : net.dynamos.map(d=>({kind:'dynamo',x:d.x,y:d.y}));
    for(const s of sources) total+=sourceEnergy(s,getTile,dynamo);
    return total;
  }
  function drainNetworkEnergyAt(x,y,amount,getTile,dynamo){
    const maxTake=Math.max(0,Number(amount)||0);
    if(maxTake<=0) return 0;
    let drained=0;
    const net=networkFor(x,y,getTile);
    const sources=Array.isArray(net.sources) && net.sources.length ? net.sources : net.dynamos.map(d=>({kind:'dynamo',x:d.x,y:d.y}));
    for(const source of sources){
      if(drained>=maxTake) break;
      drained+=drainSource(source,maxTake-drained,getTile,dynamo);
    }
    if(drained>0) markNetworkActivity(net,drained,key(x,y));
    return drained;
  }
  function chargeBatteryAt(x,y,battery,dt,getTile,dynamo,opts){
    opts=opts||{};
    if(!battery || !(dt>0)) return 0;
    const capacity=Math.max(0,Number(opts.capacity)||TELEPORTER_CAPACITY);
    const rate=Math.max(0,Number(opts.rate)||CHARGE_RATE);
    const current=Math.max(0,Math.min(capacity,Number(battery.energy)||0));
    const want=Math.min(capacity-current,rate*dt);
    if(want<=0) return 0;
    const gained=drainNetworkEnergyAt(x,y,want,getTile,dynamo);
    if(gained>0) battery.energy=Math.min(capacity,current+gained);
    return gained;
  }
  function heroAvailable(heroEnergy,player){
    if(heroEnergy && heroEnergy.info){
      const info=heroEnergy.info();
      return Math.max(0,Number(info && info.energy)||0);
    }
    return Math.max(0,Number(player && player.energy)||0);
  }
  function spendHero(heroEnergy,player,amount){
    const n=Math.max(0,Number(amount)||0);
    if(n<=0) return true;
    if(heroEnergy && heroEnergy.spend) return !!heroEnergy.spend(n);
    if(player && (player.energy||0)+1e-6>=n){
      player.energy=Math.max(0,(player.energy||0)-n);
      return true;
    }
    return false;
  }
  function spendTravelEnergy(m,getTile,opts,player){
    opts=opts||{};
    const D=opts.dynamo || MM.dynamo;
    const heroEnergy=opts.heroEnergy || (MM && MM.heroEnergy);
    const storage=Math.max(0,m.energy||0);
    const dyn=connectedDynamoEnergy(m,getTile,D);
    const hero=heroAvailable(heroEnergy,player);
    if(storage+dyn+hero+1e-6<TRAVEL_COST) return null;
    let remaining=TRAVEL_COST;
    const spent={storage:0,dynamo:0,hero:0};
    const fromStorage=Math.min(storage,remaining);
    if(fromStorage>0){
      m.energy=Math.max(0,storage-fromStorage);
      remaining-=fromStorage;
      spent.storage=fromStorage;
    }
    if(remaining>0 && D && D.drainAt){
      const drained=drainNetworkEnergyAt(m.x,m.y,remaining,getTile,D);
      if(drained>0){
        remaining-=drained;
        spent.dynamo+=drained;
      }
    }
    if(remaining>1e-6){
      if(!spendHero(heroEnergy,player,remaining)) return null;
      spent.hero=remaining;
      remaining=0;
    }
    m.pulse=1;
    return spent;
  }
  function chargeFromNetwork(m,dt,getTile,dynamo){
    if(!m || !(dt>0)) return 0;
    const gained=chargeBatteryAt(m.x,m.y,m,dt,getTile,dynamo,{capacity:TELEPORTER_CAPACITY,rate:CHARGE_RATE});
    if(gained>0){
      m.energy=clampEnergy(m.energy||0);
      m.pulse=1;
    }
    return gained;
  }
  function listLoadedTeleporters(getTile,originX){
    const out=[];
    const seen=new Set();
    const world=MM.world && MM.world._world;
    const cx=Math.floor(Number(originX)||0);
    const stamp = world && typeof world.forEach==='function'
      ? 'world:'+networkRev+':'+(Number(world.size)||0)
      : 'scan:'+networkRev+':'+cx;
    if(stamp===teleporterListStamp) return teleporterListCache.map(p=>({x:p.x,y:p.y}));
    if(world && typeof world.forEach==='function'){
      world.forEach((arr,id)=>{
        if(!arr || typeof arr.length!=='number') return;
        const cx=Number(String(id).replace(/^c/,''));
        if(!Number.isFinite(cx)) return;
        for(let i=0; i<arr.length; i++){
          if(arr[i]!==T.TELEPORTER) continue;
          const y=Math.floor(i/CHUNK_W);
          const lx=i-y*CHUNK_W;
          const x=cx*CHUNK_W+lx;
          const k=key(x,y);
          if(seen.has(k)) continue;
          seen.add(k);
          ensureMachine(x,y,getTile);
          out.push({x,y});
        }
      });
      teleporterListStamp=stamp;
      teleporterListCache=out.slice(0,4096).map(p=>({x:p.x,y:p.y}));
      return out;
    }
    for(let x=cx-1800; x<=cx+1800; x++){
      for(let y=0; y<WORLD_H; y++){
        if(getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) continue;
        const k=key(x,y);
        if(seen.has(k)) continue;
        seen.add(k);
        ensureMachine(x,y,getTile);
        out.push({x,y});
      }
    }
    teleporterListStamp=stamp;
    teleporterListCache=out.slice(0,4096).map(p=>({x:p.x,y:p.y}));
    return out;
  }
  function nearestTeleporter(tx,ty,dir,getTile){
    const list=listLoadedTeleporters(getTile,tx);
    let best=null, bestScore=Infinity;
    for(const p of list){
      if(p.x===tx && p.y===ty) continue;
      const dx=p.x-tx;
      if(dir>0 ? dx<=0 : dx>=0) continue;
      if(getSafe(getTile,p.x,p.y,T.AIR)!==T.TELEPORTER) continue;
      const score=Math.abs(dx)*1000+Math.abs(p.y-ty);
      if(score<bestScore){ bestScore=score; best=p; }
    }
    return best;
  }
  function passableForPlayer(t){
    if(t===T.AIR || t===T.WATER || t===T.LAVA) return true;
    return !!(INFO[t] && INFO[t].passable);
  }
  function canStandAt(player,x,y,getTile){
    const w=Math.max(0.5,Number(player && player.w)||0.7);
    const h=Math.max(0.7,Number(player && player.h)||0.95);
    const minX=Math.floor(x-w*0.5+0.04);
    const maxX=Math.floor(x+w*0.5-0.04);
    const minY=Math.floor(y-h*0.5+0.04);
    const maxY=Math.floor(y+h*0.5-0.04);
    for(let yy=minY; yy<=maxY; yy++){
      for(let xx=minX; xx<=maxX; xx++){
        if(!passableForPlayer(getSafe(getTile,xx,yy,T.STONE))) return false;
      }
    }
    return true;
  }
  function exitPosition(target,dir,player,getTile){
    const cx=target.x+0.5, cy=target.y+0.5;
    const tries=[
      {x:cx+dir*0.92,y:cy},
      {x:cx,y:cy},
      {x:cx+dir*0.92,y:cy-1},
      {x:cx,y:cy-1},
      {x:cx+dir*0.92,y:cy+1}
    ];
    for(const p of tries) if(canStandAt(player,p.x,p.y,getTile)) return p;
    return {x:cx,y:cy};
  }
  function teleporterUnderPlayer(player,getTile){
    if(!player) return null;
    const minX=Math.floor(player.x-(player.w||0.7)*0.5+0.08);
    const maxX=Math.floor(player.x+(player.w||0.7)*0.5-0.08);
    const minY=Math.floor(player.y-(player.h||0.95)*0.5+0.08);
    const maxY=Math.floor(player.y+(player.h||0.95)*0.5-0.08);
    let best=null, bestD=Infinity;
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        if(getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) continue;
        const d=Math.abs(x+0.5-player.x)+Math.abs(y+0.5-player.y);
        if(d<bestD){ bestD=d; best={x,y}; }
      }
    }
    return best;
  }
  function movementDir(player){
    const vx=Number(player && player.vx)||0;
    if(Math.abs(vx)<0.18) return 0;
    return vx<0 ? -1 : 1;
  }
  function scanNearbyTeleporters(player,getTile){
    if(!player) return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const x0=cx-72, x1=cx+72;
    const y0=Math.max(0,cy-36), y1=Math.min(WORLD_H-1,cy+36);
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(getSafe(getTile,x,y,T.AIR)===T.TELEPORTER) ensureMachine(x,y,getTile);
      }
    }
  }
  function tryTeleport(player,getTile,opts){
    const hit=teleporterUnderPlayer(player,getTile);
    if(!hit) return false;
    const dir=movementDir(player);
    if(!dir) return false;
    if((player._teleporterCooldown||0)>0) return false;
    const m=ensureMachine(hit.x,hit.y,getTile);
    if(!m || (m.cooldown||0)>0) return false;
    const target=nearestTeleporter(hit.x,hit.y,dir,getTile);
    if(!target) return false;
    const spent=spendTravelEnergy(m,getTile,opts,player);
    if(!spent) return false;
    const dest=ensureMachine(target.x,target.y,getTile);
    const pos=exitPosition(target,dir,player,getTile);
    player.x=pos.x;
    player.y=pos.y;
    player.vx=dir*Math.max(1.6,Math.abs(player.vx||0));
    player.vy=Math.min(0,Number(player.vy)||0);
    player._teleporterCooldown=TELEPORT_COOLDOWN;
    m.cooldown=TELEPORT_COOLDOWN;
    m.lastUse=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    if(dest){
      dest.cooldown=TELEPORT_COOLDOWN;
      dest.pulse=1;
      dest.lastUse=m.lastUse;
    }
    try{
      if(MM.particles && MM.particles.spawnEnergyAbsorb){
        const TILE=MM.TILE||20;
        MM.particles.spawnEnergyAbsorb((hit.x+0.5)*TILE,(hit.y+0.5)*TILE,(target.x+0.5)*TILE,(target.y+0.5)*TILE,1.4);
      }
      if(MM.audio && MM.audio.play) MM.audio.play('charge');
      if(MM.ui && MM.ui.msg) MM.ui.msg('Teleport '+(dir<0?'w lewo':'w prawo'));
    }catch(e){}
    return true;
  }
  function update(dt,player,getTile,_setTile,opts){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return;
    decayWireActivity(dt,getTile);
    scanT-=dt;
    if(scanT<=0){
      scanT=PLAYER_SCAN_INTERVAL;
      scanNearbyTeleporters(player,getTile);
    }
    if(player && player._teleporterCooldown>0) player._teleporterCooldown=Math.max(0,player._teleporterCooldown-dt);
    for(const [k,m] of machines){
      if(!m || getSafe(getTile,m.x,m.y,T.AIR)!==T.TELEPORTER){
        machines.delete(k);
        networkCache.delete(k);
        continue;
      }
      m.cooldown=Math.max(0,(m.cooldown||0)-dt);
      m.pulse=Math.max(0,(m.pulse||0)-dt*2.6);
      chargeFromNetwork(m,dt,getTile,opts && opts.dynamo);
    }
    if(machines.size>MACHINE_CAP){
      const px=player && Number.isFinite(player.x) ? player.x : 0;
      const py=player && Number.isFinite(player.y) ? player.y : 0;
      const idle=[...machines.entries()]
        .filter(([,m])=>m && (m.energy||0)<=0.001 && (m.pulse||0)<=0.001 && (m.cooldown||0)<=0.001)
        .map(([k,m])=>({k,d:Math.abs((m.x||0)-px)+Math.abs((m.y||0)-py)}))
        .sort((a,b)=>b.d-a.d);
      for(let i=0; i<idle.length && machines.size>Math.floor(MACHINE_CAP*0.85); i++){
        machines.delete(idle[i].k);
        networkCache.delete(idle[i].k);
      }
    }
    tryTeleport(player,getTile,opts||{});
  }
  function drawBatteryLines(ctx,TILE,px,py,charge,pulse){
    const lineW=TILE*0.46;
    const x=px+TILE*0.27;
    const baseY=py+TILE*0.70;
    const gap=TILE*0.12;
    const h=Math.max(1,TILE*0.035);
    for(let i=0; i<4; i++){
      const y=baseY-i*gap;
      ctx.fillStyle='rgba(3,8,16,0.75)';
      ctx.fillRect(x,y,lineW,h);
      const f=Math.max(0,Math.min(1,charge*4-i));
      if(f>0){
        ctx.fillStyle=pulse>0?'#fff18c':'#7cf7ff';
        ctx.globalAlpha=0.55+0.35*f+0.1*Math.max(0,Math.min(1,pulse||0));
        ctx.fillRect(x,y,Math.max(1,lineW*f),h);
        ctx.globalAlpha=1;
      }
    }
  }
  function drawTeleporterFrame(ctx,TILE,px,py,charge,pulse,phase){
    const glow=0.22+0.32*charge+0.26*Math.max(0,Math.min(1,pulse||0));
    ctx.save();
    ctx.fillStyle='rgba(8,16,30,0.84)';
    ctx.fillRect(px+2,py+2,TILE-4,TILE-4);
    ctx.strokeStyle='rgba(124,247,255,'+Math.min(0.95,glow+0.15).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.08);
    ctx.strokeRect(px+TILE*0.16,py+TILE*0.12,TILE*0.68,TILE*0.76);
    ctx.strokeStyle='rgba(255,225,115,'+(0.34+0.40*charge).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.045);
    ctx.beginPath();
    ctx.arc(px+TILE*0.5,py+TILE*0.5,TILE*(0.19+0.03*Math.sin(phase)),0,Math.PI*2);
    ctx.stroke();
    const rg=ctx.createRadialGradient(px+TILE*0.5,py+TILE*0.5,1,px+TILE*0.5,py+TILE*0.5,TILE*0.58);
    rg.addColorStop(0,'rgba(124,247,255,'+(0.34*glow).toFixed(3)+')');
    rg.addColorStop(0.52,'rgba(116,88,255,'+(0.20*glow).toFixed(3)+')');
    rg.addColorStop(1,'rgba(116,88,255,0)');
    ctx.fillStyle=rg;
    ctx.beginPath();
    ctx.arc(px+TILE*0.5,py+TILE*0.5,TILE*0.58,0,Math.PI*2);
    ctx.fill();
    drawBatteryLines(ctx,TILE,px,py,charge,pulse);
    ctx.restore();
  }
  function ensureVisibleMachines(sx,sy,viewX,viewY,getTile){
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(0,Math.floor(sy)-2), y1=Math.min(WORLD_H-1,Math.ceil(sy+viewY)+2);
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    const scanKey=x0+','+x1+','+y0+','+y1;
    if(scanKey===visibleScanKey && now-visibleScanAt<VISIBLE_SCAN_INTERVAL_MS) return;
    visibleScanKey=scanKey;
    visibleScanAt=now;
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(getSafe(getTile,x,y,T.AIR)===T.TELEPORTER) ensureMachine(x,y,getTile);
      }
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile){
    if(!ctx) return;
    ensureVisibleMachines(sx,sy,viewX,viewY,getTile);
    if(!machines.size && !wireActivity.size) return;
    const now=((typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now())*0.006;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    if(wireActivity.size){
      ctx.save();
      for(const a of wireActivity.values()){
        if(!a || a.x<sx-2 || a.x>sx+viewX+2 || a.y<sy-2 || a.y>sy+viewY+2) continue;
        if(visible && !visible(a.x,a.y)) continue;
        if(getSafe(getTile,a.x,a.y,T.AIR)!==T.COPPER_WIRE) continue;
        const conn=cableConnections(a.x,a.y,getTile);
        drawCableEnergy(ctx,TILE,a.x*TILE,a.y*TILE,conn,a.level||0,a.ttl||0,((a.x*73856093)^(a.y*19349663))>>>0,now+a.x*0.19+a.y*0.11);
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const m of machines.values()){
      if(!m || m.x<sx-2 || m.x>sx+viewX+2 || m.y<sy-2 || m.y>sy+viewY+2) continue;
      if(visible && !visible(m.x,m.y)) continue;
      if(getSafe(getTile,m.x,m.y,T.AIR)!==T.TELEPORTER) continue;
      const px=m.x*TILE, py=m.y*TILE;
      const charge=Math.max(0,Math.min(1,(m.energy||0)/TELEPORTER_CAPACITY));
      drawTeleporterFrame(ctx,TILE,px,py,charge,m.pulse||0,now+m.x*0.2);
    }
    ctx.restore();
  }
  function onTileChanged(x,y,oldTile,newTile){
    if(oldTile===newTile) return;
    if(!isMachineNetworkTile(oldTile) && !isMachineNetworkTile(newTile)) return;
    networkRev++;
    networkCache.clear();
    invalidateTeleporterSearch();
    const tx=Math.floor(x), ty=Math.floor(y);
    if(oldTile===T.TELEPORTER && newTile!==T.TELEPORTER) machines.delete(key(tx,ty));
    if(newTile===T.TELEPORTER) ensureMachine(tx,ty,MM.world && MM.world.getTile);
  }
  function snapshot(){
    const list=[...machines.values()]
      .filter(m=>m && finiteTile(m.x,m.y) && (m.energy||0)>0.001)
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MACHINE_CAP)
      .map(m=>({x:m.x,y:m.y,energy:+(m.energy||0).toFixed(3)}));
    return {v:1,list};
  }
  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
      if(machines.size>=MACHINE_CAP) break;
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(getTile && getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) continue;
      const m=ensureMachine(x,y,getTile);
      if(m) m.energy=clampEnergy(raw.energy);
    }
  }
  function reset(){
    machines.clear();
    networkCache.clear();
    wireActivity.clear();
    wireMarkThrottle.clear();
    networkRev++;
    invalidateTeleporterSearch();
    scanT=0;
    visibleScanKey='';
    visibleScanAt=0;
  }
  function metrics(){
    let storedEnergy=0, charged=0;
    for(const m of machines.values()){
      storedEnergy+=Math.max(0,m.energy||0);
      if((m.energy||0)>0.001) charged++;
    }
    return {machines:machines.size, charged, storedEnergy:+storedEnergy.toFixed(2), poweredWires:wireActivity.size, networkRev};
  }
  function debugCharge(x,y,amount,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m) return 0;
    const before=m.energy||0;
    m.energy=clampEnergy(before+Math.max(0,Number(amount)||0));
    m.pulse=1;
    return m.energy-before;
  }
  function debugSetEnergy(x,y,amount,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m) return false;
    m.energy=clampEnergy(amount);
    m.pulse=1;
    return true;
  }

  const api={
    isTeleporter,
    isCable,
    isPowerDeviceTile,
    isPowerSourceTile,
    cableConnections,
    drawCableTile,
    nearestTeleporter,
    networkFor,
    connectedDynamosAt,
    availableNetworkEnergyAt,
    drainNetworkEnergyAt,
    chargeBatteryAt,
    update,
    draw,
    onTileChanged,
    snapshot,
    restore,
    reset,
    metrics,
    _debug:{machines,networkCache,wireActivity,TELEPORTER_CAPACITY,MACHINE_CAP,TRAVEL_COST,CHARGE_RATE,debugCharge,debugSetEnergy,ensureMachine,networkFor}
  };
  MM.teleporters=api;
})();

export const teleporters = (typeof window!=='undefined' && window.MM) ? window.MM.teleporters : undefined;
export default teleporters;
