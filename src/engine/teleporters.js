// Teleporters and precious-metal power cables. Copper is accessible but loses
// half of transmitted source energy as heat; an all-silver route delivers the
// full amount, exactly doubling useful delivery for the same source reserve.
import { T, INFO, WORLD_H, WORLD_SECTION_H, WORLD_MIN_Y, WORLD_MAX_Y, CHUNK_W } from '../constants.js';
import { isHeroPassableTile } from './material_physics.js';

(function(){
  window.MM = window.MM || {};

  // The glow attribute for a charged gate (engine/post_fx.js draws every light in
  // the game from one of these).
  const PORTAL_GLOW=Object.freeze({color:'#7cf7ff', rTiles:0.62, a:0.34, pulse:0.30});
  const machines = new Map(); // "x,y" -> {x,y,energy,pulse,cooldown,lastUse}
  const networkCache = new Map(); // teleporter key -> {rev,dynamos:[{x,y}]}
  const wireActivity = new Map(); // "x,y" -> {x,y,ttl,level}
  const wireMarkThrottle = new Map(); // device key -> ms of last cable pulse paint
  const fairDemandRegistry = new Map(); // network id -> device demand remembered across frames
  const fairFrameAllocations = new Map(); // network id -> max-min allocation for this frame
  const TELEPORTER_CAPACITY = 160;
  const MACHINE_CAP = 1200;
  const TRAVEL_COST = 35;
  const CHARGE_RATE = 28;
  const NETWORK_CAP = 900;
  const NETWORK_ENDPOINT_CAP = 1200;
  const NETWORK_CACHE_CAP = 420;
  const FLOW_DRAW_CAP = 260;
  const FLOW_MARK_INTERVAL_MS = 90;
  const WIRE_TTL = 0.62;
  const FAIR_DEMAND_GRACE_FRAMES = 1;
  // All scalar state stays frame-accurate. Stable distant machines use a
  // bounded validation cadence so full or source-less endpoints do not turn
  // tile checks and cable discovery into a per-frame lifetime-construction cost.
  // Far machines are FROZEN behind the worldSim gate; the wake step below pays
  // the region's whole absence through the normal charge/validation path.
  const WAKE_MAX_SECONDS = 3600; // battery-capacity-clamped, so a big lag is safe
  const COPPER_DELIVERY_EFFICIENCY = 0.5;
  const SILVER_DELIVERY_EFFICIENCY = 1;
  const COPPER_HEAT_THRESHOLD = 12;
  // Copper deliberately occupies the upper-left utility track. Fluid pipes use
  // the mirrored lower-right track, so stacked networks never paint as one line.
  const CABLE_RENDER_OFFSET = -0.12;
  const TELEPORT_COOLDOWN = 0.72;
  const PROJECTILE_TELEPORT_COOLDOWN = 0.12;
  const PROJECTILE_TRAVEL_COST = 6;
  const STREAM_TRAVEL_COST = 0.6;
  const TELEPORTER_MAX_HP = 200;
  const BUNKER_FAILSAFE_CONCRETE_MIN = 10;
  const ENTRY_SPEED_MIN = 0.18;
  const DIR_ORDER = ['east','south','west','north'];
  const DIR_VEC = Object.freeze({
    east:Object.freeze({x:1,y:0,label:'prawo'}),
    south:Object.freeze({x:0,y:1,label:'dol'}),
    west:Object.freeze({x:-1,y:0,label:'lewo'}),
    north:Object.freeze({x:0,y:-1,label:'gora'})
  });
  // Discovery-only cadence: placements register instantly via onTileChanged and
  // stepping on a teleporter registers via tryTeleport, so this sweep only picks
  // up worldgen/chunk-load machines. At 0.45s it burned ~70k tile lookups per
  // second at idle (145x73 cells through the electric-network accessor).
  const PLAYER_SCAN_INTERVAL = 2.5;
  const VISIBLE_SCAN_INTERVAL_MS = 250;
  const CATCHUP_MAX_SECONDS = 900;
  const NETWORK_ADJ = [
    [1,0],[-1,0],[0,1],[0,-1],
    [1,1],[1,-1],[-1,1],[-1,-1]
  ];

  let networkRev = 1;
  let scanT = 0;
  let teleporterListStamp = '';
  let teleporterListCache = [];
  let visibleScanKey = '';
  let visibleScanAt = 0;
  let powerFrameId = 0;
  let externalPowerFramePending = false;
  // Loss heat belongs to a physical cable component. A single global counter
  // made a small loss in one house trigger hot air in a completely different
  // circuit, so each connected network now keeps its own bounded accumulator.
  const copperHeatBuffers = new Map();
  let copperHeatCursor = 0;
  let copperHeatEvents = 0;
  let projectileTeleports = 0;
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function clampEnergy(n){ return Math.max(0,Math.min(TELEPORTER_CAPACITY,Number(n)||0)); }
  function finiteNonNegative(n,fallback=0){
    const value=Number(n);
    return Number.isFinite(value) && value>=0 ? value : fallback;
  }
  function isTeleporter(t){ return t===T.TELEPORTER; }
  function normalizeDir(dir){ return DIR_VEC[dir] ? dir : 'east'; }
  function rotateDir(dir){
    const i=DIR_ORDER.indexOf(normalizeDir(dir));
    return DIR_ORDER[(i+1+DIR_ORDER.length)%DIR_ORDER.length];
  }
  function dirVec(dir){ return DIR_VEC[normalizeDir(dir)] || DIR_VEC.east; }
  function isCable(t){ return !!(INFO[t] && INFO[t].powerCable); }
  function isDynamoTile(t){ return t===T.DYNAMO || t===T.DYNAMO_SLOT; }
  function isSolarTile(t){ return !!(MM.solar && MM.solar.isSourceTile && MM.solar.isSourceTile(t)); }
  function isPowerDeviceTile(t){ return !!(INFO[t] && INFO[t].powerDevice); }
  function isPowerSourceTile(t){ return isDynamoTile(t) || !!(INFO[t] && INFO[t].powerSource); }
  function isMachineNetworkTile(t){ return isCable(t) || isPowerDeviceTile(t) || isPowerSourceTile(t); }
  function hasMachineNetworkNeighbor(x,y,getTile){
    for(const [dx,dy] of NETWORK_ADJ){
      if(isMachineNetworkTile(getSafe(getTile,x+dx,y+dy,T.AIR))) return true;
    }
    return false;
  }
  function basePowerTileAt(x,y,getTile){
    let t=getSafe(getTile,x,y,T.AIR);
    if(isCable(t) && MM.world && typeof MM.world.getTile==='function'){
      try{ t=MM.world.getTile(x,y); }catch(e){}
    }
    return t;
  }
  function rechargeableDeviceAt(x,y,getTile){
    const t=basePowerTileAt(x,y,getTile), info=INFO[t];
    return info && (info.powerDevice || info.requiresHomePower)
      ? {x:Math.floor(x),y:Math.floor(y),tile:t}
      : null;
  }
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
      m={x,y,dir:'east',energy:0,pulse:0,cooldown:0,lastUse:0,hp:TELEPORTER_MAX_HP};
      m.locallyIsolated=!hasMachineNetworkNeighbor(x,y,getTile);
      if(m.locallyIsolated) m.sourceLessRev=networkRev;
      machines.set(k,m);
    }
    m.x=x; m.y=y;
    m.dir=normalizeDir(m.dir);
    if(!Number.isFinite(m.hp)) m.hp=TELEPORTER_MAX_HP;
    m.hp=Math.max(0,Math.min(TELEPORTER_MAX_HP,m.hp));
    m.energy=clampEnergy(m.energy);
    m.pulse=Math.max(0,Math.min(1,Number(m.pulse)||0));
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
      // Orientation is sparse machine metadata, not a tile mutation. Reuse the
      // render-change seam so the host's infrastructure plane knows that remote
      // replicas need a fresh teleporter snapshot.
      try{
        if(typeof MM.onTileRenderChanged==='function') MM.onTileRenderChanged(m.x,m.y,T.TELEPORTER,T.TELEPORTER);
      }catch(e){}
    }
    m.pulse=1;
    return true;
  }
  function cableConnections(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    const left=isMachineNetworkTile(getSafe(getTile,x-1,y,T.AIR));
    const right=isMachineNetworkTile(getSafe(getTile,x+1,y,T.AIR));
    const up=isMachineNetworkTile(getSafe(getTile,x,y-1,T.AIR));
    const down=isMachineNetworkTile(getSafe(getTile,x,y+1,T.AIR));
    // A diagonal is visually useful only when it is the sole bridge between
    // the two cells. If either corner is occupied, the same endpoints are
    // already joined by two orthogonal segments; painting the diagonal as
    // well creates duplicate triangles in dense machine installations.
    // This rule is symmetric at both ends, so half-segments still meet cleanly.
    const upLeft=isMachineNetworkTile(getSafe(getTile,x-1,y-1,T.AIR)) && !left && !up;
    const upRight=isMachineNetworkTile(getSafe(getTile,x+1,y-1,T.AIR)) && !right && !up;
    const downLeft=isMachineNetworkTile(getSafe(getTile,x-1,y+1,T.AIR)) && !left && !down;
    const downRight=isMachineNetworkTile(getSafe(getTile,x+1,y+1,T.AIR)) && !right && !down;
    return {
      left,right,up,down,upLeft,upRight,downLeft,downRight
    };
  }
  function cableRenderCenter(TILE,px,py){
    const offset=TILE*CABLE_RENDER_OFFSET;
    return {x:px+TILE*0.5+offset,y:py+TILE*0.5+offset};
  }

  function drawCableTile(ctx,TILE,px,py,conn,h,cableType){
    if(!ctx) return;
    const silver=cableType===T.SILVER_WIRE;
    const center=cableRenderCenter(TILE,px,py);
    const cx=center.x, cy=center.y;
    const any=conn && (conn.left||conn.right||conn.up||conn.down||conn.upLeft||conn.upRight||conn.downLeft||conn.downRight);
    const c=conn || {left:true,right:true,up:false,down:false};
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.strokeStyle=silver?'rgba(45,57,72,0.82)':'rgba(67,34,13,0.78)';
    ctx.lineWidth=Math.max(1,TILE*0.13);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+1,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-1,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+1); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-1); }
    if(c.upLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+1,py+1); }
    if(c.upRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-1,py+1); }
    if(c.downLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+1,py+TILE-1); }
    if(c.downRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-1,py+TILE-1); }
    ctx.stroke();
    ctx.strokeStyle=silver?'#c9ddec':'#d68535';
    ctx.lineWidth=Math.max(0.75,TILE*0.075);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+2); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-2); }
    if(c.upLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,py+2); }
    if(c.upRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,py+2); }
    if(c.downLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,py+TILE-2); }
    if(c.downRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,py+TILE-2); }
    ctx.stroke();
    ctx.strokeStyle=silver?'rgba(255,255,255,0.88)':'rgba(255,222,128,0.82)';
    ctx.lineWidth=Math.max(1,TILE*0.045);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy-1); ctx.lineTo(px+4,cy-1); }
    if(c.right || !any){ ctx.moveTo(cx,cy-1); ctx.lineTo(px+TILE-4,cy-1); }
    if(c.up){ ctx.moveTo(cx+1,cy); ctx.lineTo(cx+1,py+4); }
    if(c.down){ ctx.moveTo(cx+1,cy); ctx.lineTo(cx+1,py+TILE-4); }
    if(c.upLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+4,py+4); }
    if(c.upRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-4,py+4); }
    if(c.downLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+4,py+TILE-4); }
    if(c.downRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-4,py+TILE-4); }
    ctx.stroke();
    const branches=(c.left?1:0)+(c.right?1:0)+(c.up?1:0)+(c.down?1:0)
      +(c.upLeft?1:0)+(c.upRight?1:0)+(c.downLeft?1:0)+(c.downRight?1:0);
    ctx.fillStyle=silver?(branches>=3?'#f7fdff':'#cbe5f4'):(branches>=3?'#ffe38f':'#f0a34c');
    ctx.beginPath();
    ctx.arc(cx,cy,Math.max(0.9,TILE*(branches>=3?0.085:0.065)),0,Math.PI*2);
    ctx.fill();
    if(((h||0)&7)===0){
      ctx.fillStyle=silver?'rgba(255,255,255,0.96)':'rgba(255,244,172,0.92)';
      ctx.fillRect(cx+TILE*0.12,cy-TILE*0.17,Math.max(1,TILE*0.08),Math.max(1,TILE*0.08));
    }
    ctx.restore();
  }
  function nowMs(){
    return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
  }
  function markWire(x,y,level,flowX,flowY,cableType){
    const k=key(x,y);
    const cur=wireActivity.get(k) || {x:Math.floor(x),y:Math.floor(y),ttl:0,level:0};
    const now=nowMs();
    if(now-(cur.flowAt||0)>28){ cur.flowX=0; cur.flowY=0; }
    if(Number.isFinite(flowX) && Number.isFinite(flowY) && (flowX||flowY)){
      cur.flowX=(cur.flowX||0)+flowX*Math.max(0.1,level);
      cur.flowY=(cur.flowY||0)+flowY*Math.max(0.1,level);
      cur.flowAt=now;
    }
    cur.ttl=Math.max(cur.ttl,WIRE_TTL);
    cur.level=Math.min(1,Math.max(cur.level*0.72,level));
    cur.tile=isCable(cableType)?cableType:(cur.tile||T.COPPER_WIRE);
    wireActivity.set(k,cur);
  }
  function sourceRouteInfo(net,source,getTile){
    if(!net || !source) return {efficiency:SILVER_DELIVERY_EFFICIENCY,path:[]};
    const sourceId=sourceCacheKey(source);
    if(!(net.sourceRoutes instanceof Map)) net.sourceRoutes=new Map();
    if(net.sourceRoutes.has(sourceId)) return net.sourceRoutes.get(sourceId);
    const target=net.target;
    if(!target){
      const empty={efficiency:SILVER_DELIVERY_EFFICIENCY,path:[]};
      net.sourceRoutes.set(sourceId,empty);
      return empty;
    }
    for(const [dx,dy] of NETWORK_ADJ){
      const adjacent=sourceNodeAt(target.x+dx,target.y+dy,getTile);
      if(adjacent && sourceCacheKey(adjacent)===sourceId){
        const direct={efficiency:SILVER_DELIVERY_EFFICIENCY,path:[]};
        net.sourceRoutes.set(sourceId,direct);
        return direct;
      }
    }
    const cableByKey=new Map((net.cables||[]).map(c=>[key(c.x,c.y),c]));
    const touchesSource=(x,y)=>{
      for(const [dx,dy] of NETWORK_ADJ){
        const adjacent=sourceNodeAt(x+dx,y+dy,getTile);
        if(adjacent && sourceCacheKey(adjacent)===sourceId) return true;
      }
      return false;
    };
    const findPath=(silverOnly)=>{
      const dist=new Map(), toward=new Map(), q=[];
      const seed=(x,y,dx,dy)=>{
        const id=key(x,y), cable=cableByKey.get(id);
        if(!cable || (silverOnly && cable.tile!==T.SILVER_WIRE) || dist.has(id)) return;
        dist.set(id,dx||dy?1:0);
        if(dx||dy) toward.set(id,{dx,dy});
        q.push({x:cable.x,y:cable.y});
      };
      if(cableByKey.has(key(target.x,target.y))) seed(target.x,target.y,0,0);
      for(const [dx,dy] of NETWORK_ADJ) seed(target.x+dx,target.y+dy,-dx,-dy);
      let end=null;
      for(let qi=0;qi<q.length;qi++){
        const c=q[qi];
        if(touchesSource(c.x,c.y)){ end=c; break; }
        const cd=dist.get(key(c.x,c.y))||0;
        for(const [dx,dy] of NETWORK_ADJ){
          const nx=c.x+dx, ny=c.y+dy, id=key(nx,ny), cable=cableByKey.get(id);
          if(!cable || (silverOnly && cable.tile!==T.SILVER_WIRE) || dist.has(id)) continue;
          dist.set(id,cd+1);
          toward.set(id,{dx:-dx,dy:-dy});
          q.push({x:nx,y:ny});
        }
      }
      if(!end) return null;
      const path=[];
      let x=end.x,y=end.y;
      for(let guard=0;guard<NETWORK_CAP;guard++){
        const id=key(x,y), cable=cableByKey.get(id);
        if(!cable) break;
        const dir=toward.get(id) || {dx:0,dy:0};
        path.push({x,y,dx:dir.dx,dy:dir.dy,tile:cable.tile,sourceId});
        if(!dir.dx && !dir.dy) break;
        const nx=x+dir.dx, ny=y+dir.dy;
        if(!cableByKey.has(key(nx,ny))) break;
        x=nx; y=ny;
      }
      return path;
    };
    const silverPath=findPath(true);
    const path=silverPath || findPath(false) || [];
    const info={
      efficiency:silverPath ? SILVER_DELIVERY_EFFICIENCY : COPPER_DELIVERY_EFFICIENCY,
      path
    };
    net.sourceRoutes.set(sourceId,info);
    return info;
  }
  function wireFlowRoute(net,getTile,activeSourceKeys){
    if(!net || !Array.isArray(net.cables) || !net.cables.length) return new Map();
    const route=new Map();
    const filter=activeSourceKeys instanceof Set ? activeSourceKeys : null;
    for(const source of cachedSourceList(net)){
      const sourceId=sourceCacheKey(source);
      if(filter && !filter.has(sourceId)) continue;
      const info=sourceRouteInfo(net,source,getTile);
      for(const c of info.path||[]) route.set(key(c.x,c.y),c);
    }
    return route;
  }
  function markNetworkActivity(net,amount,deviceKey,getTile,activeSourceKeys){
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
    const route=wireFlowRoute(net,getTile,activeSourceKeys);
    const active=route.size ? [...route.values()] : net.cables;
    const cap=Math.min(FLOW_DRAW_CAP,active.length);
    if(active.length<=cap){
      for(const c of active) markWire(c.x,c.y,level,c.dx||0,c.dy||0,c.tile);
      return;
    }
    const stride=Math.max(1,Math.floor(active.length/cap));
    for(let i=0,count=0; i<active.length && count<cap; i+=stride,count++){
      const c=active[i];
      markWire(c.x,c.y,level,c.dx||0,c.dy||0,c.tile);
    }
  }
  function decayWireActivity(dt,getTile){
    if(!wireActivity.size) return;
    for(const [k,a] of wireActivity){
      if(!a){ wireActivity.delete(k); continue; }
      a.ttl-=dt;
      a.level=Math.max(0,(a.level||0)-dt*0.75);
      if(a.ttl<=0 || a.level<=0.015 || !isCable(getSafe(getTile,a.x,a.y,T.AIR))) wireActivity.delete(k);
    }
    if(wireMarkThrottle.size>120){
      const cutoff=nowMs()-2000;
      for(const [k,t] of wireMarkThrottle) if(t<cutoff) wireMarkThrottle.delete(k);
    }
  }
  function drawCableEnergy(ctx,TILE,px,py,conn,level,ttl,h,phase,flowX,flowY,cableType){
    const fade=Math.max(0,Math.min(1,ttl/WIRE_TTL));
    const a=Math.max(0,Math.min(1,level))*fade;
    if(a<=0.01) return;
    const c=conn || {left:true,right:true,up:false,down:false};
    const any=c.left||c.right||c.up||c.down||c.upLeft||c.upRight||c.downLeft||c.downRight;
    const center=cableRenderCenter(TILE,px,py);
    const cx=center.x, cy=center.y;
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.globalCompositeOperation='lighter';
    const silver=cableType===T.SILVER_WIRE;
    ctx.strokeStyle=(silver?'rgba(196,238,255,':'rgba(96,238,255,')+(0.18+0.40*a).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*(0.055+0.07*a));
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+2); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-2); }
    if(c.upLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,py+2); }
    if(c.upRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,py+2); }
    if(c.downLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+2,py+TILE-2); }
    if(c.downRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-2,py+TILE-2); }
    ctx.stroke();
    ctx.strokeStyle=(silver?'rgba(255,255,255,':'rgba(255,244,145,')+(0.16+0.58*a).toFixed(3)+')';
    ctx.lineWidth=Math.max(0.75,TILE*0.032);
    ctx.beginPath();
    if(c.left || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+3,cy); }
    if(c.right || !any){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-3,cy); }
    if(c.up){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+3); }
    if(c.down){ ctx.moveTo(cx,cy); ctx.lineTo(cx,py+TILE-3); }
    if(c.upLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+3,py+3); }
    if(c.upRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-3,py+3); }
    if(c.downLeft){ ctx.moveTo(cx,cy); ctx.lineTo(px+3,py+TILE-3); }
    if(c.downRight){ ctx.moveTo(cx,cy); ctx.lineTo(px+TILE-3,py+TILE-3); }
    ctx.stroke();
    const flowMag=Math.hypot(Number(flowX)||0,Number(flowY)||0);
    const directed=flowMag>0.12;
    const fx=directed ? (Number(flowX)||0)/flowMag : 0;
    const fy=directed ? (Number(flowY)||0)/flowMag : 0;
    if(directed){
      const travel=(phase*0.28)%1;
      const ax=cx+fx*TILE*(-0.16+travel*0.32);
      const ay=cy+fy*TILE*(-0.16+travel*0.32);
      const nx=-fy, ny=fx;
      ctx.fillStyle='rgba(255,252,190,'+(0.52+0.42*a).toFixed(3)+')';
      ctx.beginPath();
      ctx.moveTo(ax+fx*TILE*0.11,ay+fy*TILE*0.11);
      ctx.lineTo(ax-fx*TILE*0.07+nx*TILE*0.075,ay-fy*TILE*0.07+ny*TILE*0.075);
      ctx.lineTo(ax-fx*TILE*0.07-nx*TILE*0.075,ay-fy*TILE*0.07-ny*TILE*0.075);
      ctx.closePath();
      ctx.fill();
    }
    const dirs=directed ? [[fx,fy]] : [];
    if(!directed){
      if(c.left || !any) dirs.push([-1,0]);
      if(c.right || !any) dirs.push([1,0]);
      if(c.up) dirs.push([0,-1]);
      if(c.down) dirs.push([0,1]);
      if(c.upLeft) dirs.push([-1,-1]);
      if(c.upRight) dirs.push([1,-1]);
      if(c.downLeft) dirs.push([-1,1]);
      if(c.downRight) dirs.push([1,1]);
    }
    const sparks=Math.min(2,Math.max(1,Math.round(a*2)));
    for(let i=0;i<sparks;i++){
      const idx=((h>>>((i*7)&15)) % Math.max(1,dirs.length));
      const d=dirs[idx] || [1,0];
      const seed=((h>>>((i*5+3)&15))&255)/255;
      const travel=(phase*0.9+seed+i*0.37)%1;
      const dist=(0.13+0.72*travel)*TILE*(directed?1:(d[0]&&d[1]?Math.SQRT1_2:1));
      const sx=cx + (d[0]?dist:((seed-0.5)*TILE*0.08));
      const sy=cy + (d[1]?dist:((seed-0.5)*TILE*0.08));
      const r=Math.max(0.75,TILE*(0.03+0.025*a));
      ctx.fillStyle='rgba(255,250,183,'+(0.45+0.50*a).toFixed(3)+')';
      ctx.beginPath();
      ctx.arc(sx,sy,r,0,Math.PI*2);
      ctx.fill();
      if(a>0.45){
        ctx.strokeStyle='rgba(118,241,255,'+(0.25+0.45*a).toFixed(3)+')';
        ctx.lineWidth=Math.max(0.75,TILE*0.025);
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
    if(!source || sources.list.length>=NETWORK_ENDPOINT_CAP) return;
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
    if(t===T.SMR_CELL){
      try{
        const s=MM.smr && MM.smr.sourceAt ? MM.smr.sourceAt(x,y,getTile) : null;
        return s ? {kind:'smr',x:s.x,y:s.y,cells:1} : null;
      }catch(e){ return null; }
    }
    if(t===T.LIGHTNING_ROD){
      try{
        const s=MM.weatherInstruments && MM.weatherInstruments.sourceAt ? MM.weatherInstruments.sourceAt(x,y,getTile) : null;
        return s ? {kind:'rod',x:s.x,y:s.y,cells:1} : null;
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
  function networkIdentity(net){
    if(!net) return 'network:none';
    if(net.networkId) return net.networkId;
    const cableIds=(Array.isArray(net.cables)?net.cables:[]).map(c=>key(c.x,c.y)).sort();
    const sourceIds=cachedSourceList(net).map(sourceCacheKey).filter(Boolean).sort();
    // A connected component cannot share its lexicographically smallest cable
    // with another component. Cable-less direct connections are grouped by the
    // physical source instead, so two devices touching one dynamo still share.
    net.networkId=cableIds.length ? 'cable:'+cableIds[0]
      : (sourceIds.length ? 'source:'+sourceIds.join('|')
        : 'isolated:'+key(net.target && net.target.x,net.target && net.target.y));
    return net.networkId;
  }
  function maxMinAlloc(demands,supply){
    const out=new Map();
    const rows=[...demands]
      .map(([id,demand])=>({id,demand:Math.max(0,Number(demand)||0)}))
      .filter(row=>row.demand>1e-9)
      .sort((a,b)=>a.demand-b.demand || String(a.id).localeCompare(String(b.id)));
    let left=Math.max(0,Number(supply)||0);
    for(let i=0;i<rows.length;i++){
      const count=rows.length-i;
      const share=count>0 ? left/count : 0;
      if(rows[i].demand<=share+1e-9){
        out.set(rows[i].id,rows[i].demand);
        left=Math.max(0,left-rows[i].demand);
        continue;
      }
      for(let j=i;j<rows.length;j++) out.set(rows[j].id,Math.min(rows[j].demand,share));
      left=0;
      break;
    }
    return out;
  }
  function maxMinAllocWeighted(demands,rawSupply){
    const out=new Map();
    const rows=[...demands].map(([id,row])=>({
      id,
      demand:Math.max(0,Number(row && row.demand)||0),
      efficiency:Math.max(0.01,Math.min(1,Number(row && row.efficiency)||1))
    })).filter(row=>row.demand>1e-9);
    if(!rows.length || !(rawSupply>0)) return out;
    let lo=0, hi=Math.max(...rows.map(row=>row.demand));
    for(let i=0;i<48;i++){
      const level=(lo+hi)*0.5;
      let rawCost=0;
      for(const row of rows) rawCost+=Math.min(row.demand,level)/row.efficiency;
      if(rawCost<=rawSupply) lo=level;
      else hi=level;
    }
    for(const row of rows) out.set(row.id,Math.min(row.demand,lo));
    return out;
  }
  function advancePowerFrame(){
    powerFrameId++;
    fairFrameAllocations.clear();
    if((powerFrameId&63)!==0) return powerFrameId;
    const cutoff=powerFrameId-FAIR_DEMAND_GRACE_FRAMES-2;
    for(const [networkId,registry] of fairDemandRegistry){
      for(const [consumerId,row] of registry) if(!row || row.frame<cutoff) registry.delete(consumerId);
      if(!registry.size) fairDemandRegistry.delete(networkId);
    }
    return powerFrameId;
  }
  function beginPowerFrame(){
    advancePowerFrame();
    externalPowerFramePending=true;
    return powerFrameId;
  }
  function hasReliableTopologyNotifications(cached){
    const world=MM.world;
    // The production world routes both terrain and stacked-infrastructure edits
    // through onTileChanged and exposes versioned chunks. In that environment
    // networkRev is authoritative, so re-reading every cable (8 neighbours each)
    // for every consumer every frame would turn a cached network back into O(n).
    return !!(world && cached && cached.worldRef===world && typeof world.chunkVersion==='function' && typeof world.hasInfrastructure==='function');
  }
  function networkCacheEntryValid(tx,ty,cached,getTile){
    if(!cached || cached.rev!==networkRev || typeof getTile!=='function') return false;
    if(hasReliableTopologyNotifications(cached)) return true;
    const cableKeys=new Set();
    const cables=Array.isArray(cached.cables) ? cached.cables : [];
    if(cables.length !== (Number(cached.cableCount)||0)) return false;
    for(const c of cables){
      const live=c && finiteTile(c.x,c.y) ? getSafe(getTile,c.x,c.y,T.AIR) : T.AIR;
      if(!c || !isCable(live) || (c.tile!=null && live!==c.tile)) return false;
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
    for(const [dx,dy] of NETWORK_ADJ){
      if(!inspectNeighbor(tx+dx,ty+dy)) return false;
    }
    for(const c of cables){
      for(const [dx,dy] of NETWORK_ADJ){
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
    const devices={seen:new Set(),list:[]};
    const sourceMemo=new Map();
    const seen=new Set();
    const cableTypes=new Map();
    const q=[];
    const pushCable=(x,y)=>{
      if(!finiteTile(x,y)) return;
      const tile=getSafe(getTile,x,y,T.AIR);
      if(!isCable(tile)) return;
      const k=key(x,y);
      if(seen.has(k) || seen.size>=NETWORK_CAP) return;
      seen.add(k);
      cableTypes.set(k,tile);
      q.push({x,y});
    };
    const addDevice=(x,y)=>{
      if(devices.list.length>=NETWORK_ENDPOINT_CAP) return;
      const d=rechargeableDeviceAt(x,y,getTile);
      if(!d) return;
      const id=key(d.x,d.y);
      if(devices.seen.has(id)) return;
      devices.seen.add(id);
      devices.list.push(d);
    };
    const readSource=(x,y)=>{
      if(sources.list.length>=NETWORK_ENDPOINT_CAP) return null;
      const id=key(x,y);
      if(sourceMemo.has(id)) return sourceMemo.get(id);
      const src=sourceNodeAt(x,y,getTile);
      sourceMemo.set(id,src);
      return src;
    };
    addDevice(tx,ty);
    if(isCable(getSafe(getTile,tx,ty,T.AIR))) pushCable(tx,ty);
    NETWORK_ADJ.forEach(([dx,dy])=>{
      const nx=tx+dx, ny=ty+dy;
      const t=getSafe(getTile,nx,ny,T.AIR);
      if(isCable(t)) pushCable(nx,ny);
      else {
        addDevice(nx,ny);
        const src=readSource(nx,ny);
        addSource(sources,src);
        if(src && src.kind==='dynamo') addDynamoSlot(dynamos,{x:src.x,y:src.y});
      }
    });
    for(let qi=0; qi<q.length && qi<NETWORK_CAP; qi++){
      const c=q[qi];
      NETWORK_ADJ.forEach(([dx,dy])=>{
        const nx=c.x+dx, ny=c.y+dy;
        const t=getSafe(getTile,nx,ny,T.AIR);
        if(isCable(t)) pushCable(nx,ny);
        else {
          addDevice(nx,ny);
          const src=readSource(nx,ny);
          addSource(sources,src);
          if(src && src.kind==='dynamo') addDynamoSlot(dynamos,{x:src.x,y:src.y});
        }
      });
    }
    const cables=[...seen].map(id=>{
      const comma=id.indexOf(',');
      return {x:+id.slice(0,comma),y:+id.slice(comma+1),tile:cableTypes.get(id)};
    });
    const net={rev:networkRev,worldRef:MM.world,target:{x:tx,y:ty},dynamos:dynamos.list,sources:sources.list,devices:devices.list,cableCount:seen.size,cables};
    networkCache.set(tk,net);
    pruneNetworkCache(getTile);
    return net;
  }
  function networkDeliveryEfficiency(net,getTile,dynamo){
    if(!net) return SILVER_DELIVERY_EFFICIENCY;
    const sources=networkSources(net);
    if(!sources.length) return SILVER_DELIVERY_EFFICIENCY;
    let raw=0,useful=0,fallback=0;
    for(const source of sources){
      const efficiency=sourceRouteInfo(net,source,getTile).efficiency;
      const energy=sourceEnergy(source,getTile,dynamo);
      fallback+=efficiency;
      raw+=energy;
      useful+=energy*efficiency;
    }
    if(raw>1e-9) return Math.max(COPPER_DELIVERY_EFFICIENCY,Math.min(SILVER_DELIVERY_EFFICIENCY,useful/raw));
    return Math.max(COPPER_DELIVERY_EFFICIENCY,Math.min(SILVER_DELIVERY_EFFICIENCY,fallback/sources.length));
  }
  function emitCopperLossHeat(net,lost,getTile,activeSourceKeys){
    const amount=Math.max(0,Number(lost)||0);
    if(amount<=0 || !net || !Array.isArray(net.cables)) return false;
    const routed=[...wireFlowRoute(net,getTile,activeSourceKeys).values()];
    const copper=(routed.length?routed:net.cables).filter(c=>c && c.tile===T.COPPER_WIRE);
    if(!copper.length) return false;
    const networkId=networkIdentity(net);
    const buffered=Math.min(COPPER_HEAT_THRESHOLD*4,(copperHeatBuffers.get(networkId)||0)+amount);
    copperHeatBuffers.set(networkId,buffered);
    if(buffered<COPPER_HEAT_THRESHOLD) return false;
    const c=copper[copperHeatCursor++%copper.length];
    try{
      const world=MM.world;
      if(!MM.gases || typeof MM.gases.add!=='function' || !world || typeof world.setTile!=='function') return false;
      const placed=MM.gases.add('hot',c.x+.5,c.y+.5,{power:.18,cells:1,getTile,setTile:world.setTile});
      if(placed>0){
        copperHeatBuffers.set(networkId,Math.max(0,buffered-COPPER_HEAT_THRESHOLD));
        copperHeatEvents++;
        return true;
      }
    }catch(e){}
    return false;
  }
  function sourceEnergy(source,getTile,dynamo){
    if(!source) return 0;
    if(source.kind==='dynamo'){
      const D=dynamo || MM.dynamo;
      try{ return (D && D.energyAt) ? finiteNonNegative(D.energyAt(source.x,source.y,getTile),0) : 0; }catch(e){ return 0; }
    }
    if(source.kind==='solar'){
      const S=MM.solar;
      try{ return (S && S.energyAt) ? finiteNonNegative(S.energyAt(source.x,source.y,getTile),0) : 0; }catch(e){ return 0; }
    }
    if(source.kind==='smr'){
      const R=MM.smr;
      try{ return (R && R.energyAt) ? finiteNonNegative(R.energyAt(source.x,source.y),0) : 0; }catch(e){ return 0; }
    }
    if(source.kind==='rod'){
      const W=MM.weatherInstruments;
      try{ return (W && W.energyAt) ? finiteNonNegative(W.energyAt(source.x,source.y),0) : 0; }catch(e){ return 0; }
    }
    return 0;
  }
  function drainSource(source,amount,getTile,dynamo){
    if(!source) return 0;
    const want=Math.max(0,Number(amount)||0);
    if(want<=0) return 0;
    if(source.kind==='dynamo'){
      const D=dynamo || MM.dynamo;
      try{
        const got=(D && D.drainAt) ? D.drainAt(source.x,source.y,want,getTile) : null;
        return got ? Math.min(want,finiteNonNegative(got.amount,0)) : 0;
      }catch(e){ return 0; }
    }
    if(source.kind==='solar'){
      const S=MM.solar;
      try{
        const got=(S && S.drainAt) ? S.drainAt(source.x,source.y,want,getTile) : null;
        return got ? Math.min(want,finiteNonNegative(got.amount,0)) : 0;
      }catch(e){ return 0; }
    }
    if(source.kind==='smr'){
      const R=MM.smr;
      try{
        const got=(R && R.drainAt) ? R.drainAt(source.x,source.y,want) : null;
        return got ? Math.min(want,finiteNonNegative(got.amount,0)) : 0;
      }catch(e){ return 0; }
    }
    if(source.kind==='rod'){
      const W=MM.weatherInstruments;
      try{
        const got=(W && W.drainAt) ? W.drainAt(source.x,source.y,want) : null;
        return got ? Math.min(want,finiteNonNegative(got.amount,0)) : 0;
      }catch(e){ return 0; }
    }
    return 0;
  }
  function connectedDynamoEnergy(m,getTile,dynamo){
    const net=networkFor(m.x,m.y,getTile);
    let total=0;
    const sources=Array.isArray(net.sources) && net.sources.length ? net.sources : net.dynamos.map(d=>({kind:'dynamo',x:d.x,y:d.y}));
    for(const s of sources) total+=sourceEnergy(s,getTile,dynamo)*sourceRouteInfo(net,s,getTile).efficiency;
    return total;
  }
  function connectedDynamosAt(x,y,getTile){
    return networkFor(x,y,getTile).dynamos.slice();
  }
  function availableNetworkEnergyAt(x,y,getTile,dynamo){
    let total=0;
    const net=networkFor(x,y,getTile);
    const sources=Array.isArray(net.sources) && net.sources.length ? net.sources : net.dynamos.map(d=>({kind:'dynamo',x:d.x,y:d.y}));
    for(const s of sources) total+=sourceEnergy(s,getTile,dynamo)*sourceRouteInfo(net,s,getTile).efficiency;
    return total;
  }
  function networkSources(net){
    return Array.isArray(net.sources) && net.sources.length
      ? net.sources
      : net.dynamos.map(d=>({kind:'dynamo',x:d.x,y:d.y}));
  }
  function drainUsefulFromNetwork(net,amount,getTile,dynamo){
    const maxTake=Math.max(0,Number(amount)||0);
    const result={delivered:0,raw:0,lost:0,sourceKeys:new Set()};
    if(maxTake<=0) return result;
    const rows=[];
    for(const source of networkSources(net)){
      const rawAvailable=sourceEnergy(source,getTile,dynamo);
      if(rawAvailable<=1e-9) continue;
      const efficiency=sourceRouteInfo(net,source,getTile).efficiency;
      rows.push({source,sourceId:sourceCacheKey(source),efficiency,rawAvailable,usefulAvailable:rawAvailable*efficiency,rawUsed:0});
    }
    if(!rows.length) return result;
    const capacities=new Map(rows.map(row=>[row.sourceId,row.usefulAvailable]));
    const planned=maxMinAlloc(capacities,maxTake);
    let remaining=maxTake;
    for(const row of rows){
      const usefulWant=Math.min(remaining,Math.max(0,Number(planned.get(row.sourceId))||0));
      if(usefulWant<=1e-9) continue;
      const rawWant=Math.min(row.rawAvailable,usefulWant/row.efficiency);
      const rawGot=drainSource(row.source,rawWant,getTile,dynamo);
      const usefulGot=Math.min(usefulWant,rawGot*row.efficiency);
      row.rawUsed+=rawGot;
      result.raw+=rawGot;
      result.delivered+=usefulGot;
      remaining=Math.max(0,remaining-usefulGot);
      if(rawGot>0) result.sourceKeys.add(row.sourceId);
    }
    // A source API may return less than advertised. Redistribute the shortfall
    // over the remaining reserves instead of silently privileging the first one.
    for(let round=0;remaining>1e-8 && round<rows.length+1;round++){
      const active=rows.filter(row=>row.rawAvailable-row.rawUsed>1e-8);
      if(!active.length) break;
      const share=remaining/active.length;
      let progress=0;
      for(const row of active){
        const rawWant=Math.min(row.rawAvailable-row.rawUsed,share/row.efficiency);
        const rawGot=drainSource(row.source,rawWant,getTile,dynamo);
        const usefulGot=Math.min(remaining,rawGot*row.efficiency);
        row.rawUsed+=rawGot;
        result.raw+=rawGot;
        result.delivered+=usefulGot;
        remaining=Math.max(0,remaining-usefulGot);
        progress+=usefulGot;
        if(rawGot>0) result.sourceKeys.add(row.sourceId);
      }
      if(progress<=1e-9) break;
    }
    result.delivered=Math.min(maxTake,result.delivered);
    result.lost=Math.max(0,result.raw-result.delivered);
    return result;
  }
  function registerPowerDemandForNetwork(net,x,y,want,getTile,dynamo){
    const consumerId=key(x,y);
    const networkId=networkIdentity(net);
    let registry=fairDemandRegistry.get(networkId);
    if(!registry){ registry=new Map(); fairDemandRegistry.set(networkId,registry); }
    registry.set(consumerId,{
      demand:Math.max(0,Number(want)||0),
      efficiency:networkDeliveryEfficiency(net,getTile,dynamo),
      frame:powerFrameId
    });
    return {net,consumerId,networkId,registry};
  }
  function registerPowerDemandAt(x,y,want,getTile,dynamo){
    return registerPowerDemandForNetwork(networkFor(x,y,getTile),x,y,want,getTile,dynamo);
  }
  function clearMachinePowerDemand(m){
    if(!m || !m.lastNetworkId) return;
    const registry=fairDemandRegistry.get(m.lastNetworkId);
    if(!registry) return;
    registry.delete(key(m.x,m.y));
    if(!registry.size) fairDemandRegistry.delete(m.lastNetworkId);
  }
  function fairAllocationFor(net,consumerId,want,getTile,dynamo,demandRegistered){
    const networkId=networkIdentity(net);
    let registry=demandRegistered ? fairDemandRegistry.get(networkId) : null;
    if(!registry || !registry.has(consumerId)){
      registry=registerPowerDemandForNetwork(net,net.target.x,net.target.y,want,getTile,dynamo).registry;
    }
    let frame=fairFrameAllocations.get(networkId);
    if(frame) return frame;
    const demands=new Map();
    for(const [id,row] of registry){
      if(row && row.frame>=powerFrameId-FAIR_DEMAND_GRACE_FRAMES && row.demand>1e-9){
        demands.set(id,{demand:row.demand,efficiency:row.efficiency});
      }
    }
    let rawSupply=0;
    for(const source of networkSources(net)) rawSupply+=sourceEnergy(source,getTile,dynamo);
    frame={allocations:maxMinAllocWeighted(demands,rawSupply),used:new Map(),rawSupply,demands};
    fairFrameAllocations.set(networkId,frame);
    return frame;
  }
  function drainNetworkEnergyFrom(net,x,y,amount,getTile,dynamo,opts){
    opts=opts||{};
    const maxTake=Math.max(0,Number(amount)||0);
    const consumerId=key(x,y);
    let permitted=maxTake;
    if(opts.fair){
      const frame=fairAllocationFor(net,consumerId,maxTake,getTile,dynamo,opts.demandRegistered);
      const allocation=Math.max(0,Number(frame.allocations.get(consumerId))||0);
      const used=Math.max(0,Number(frame.used.get(consumerId))||0);
      permitted=Math.min(maxTake,Math.max(0,allocation-used));
      if(permitted<=0) return 0;
    }else if(maxTake<=0) return 0;
    const transfer=drainUsefulFromNetwork(net,permitted,getTile,dynamo);
    const drained=Math.min(permitted,transfer.delivered);
    if(transfer.lost>1e-9) emitCopperLossHeat(net,transfer.lost,getTile,transfer.sourceKeys);
    if(opts.fair && drained>0){
      const frame=fairFrameAllocations.get(networkIdentity(net));
      if(frame) frame.used.set(consumerId,(Number(frame.used.get(consumerId))||0)+drained);
    }
    if(drained>0) markNetworkActivity(net,drained,consumerId,getTile,transfer.sourceKeys);
    return drained;
  }
  function drainNetworkEnergyAt(x,y,amount,getTile,dynamo,opts){
    return drainNetworkEnergyFrom(networkFor(x,y,getTile),x,y,amount,getTile,dynamo,opts);
  }
  function batteryChargeDemand(battery,dt,capacity,rate){
    if(!battery || !(dt>0) || !Number.isFinite(dt)) return 0;
    const current=Math.max(0,Math.min(capacity,finiteNonNegative(battery.energy,0)));
    // Normalize corrupted callers even when the battery is already full or the
    // requested rate is zero; otherwise Infinity/NaN can persist indefinitely.
    battery.energy=current;
    return Math.min(capacity-current,rate*dt);
  }
  function chargeBatteryFrom(net,x,y,battery,dt,getTile,dynamo,opts){
    opts=opts||{};
    const capacity=opts.capacity===undefined ? TELEPORTER_CAPACITY : finiteNonNegative(opts.capacity,0);
    const rate=opts.rate===undefined ? CHARGE_RATE : finiteNonNegative(opts.rate,0);
    const want=batteryChargeDemand(battery,dt,capacity,rate);
    const current=battery ? battery.energy : 0;
    const fair=opts.fair!==false;
    let demandRegistered=!!opts.demandRegistered;
    if(fair && !demandRegistered){
      registerPowerDemandForNetwork(net,x,y,want,getTile,dynamo);
      demandRegistered=true;
    }
    if(!(want>0) || !Number.isFinite(want)) return 0;
    const gained=drainNetworkEnergyFrom(net,x,y,want,getTile,dynamo,{fair,demandRegistered});
    if(gained>0) battery.energy=Math.min(capacity,current+gained);
    return gained;
  }
  function chargeBatteryAt(x,y,battery,dt,getTile,dynamo,opts){
    if(!battery || !(dt>0) || !Number.isFinite(dt)) return 0;
    return chargeBatteryFrom(networkFor(x,y,getTile),x,y,battery,dt,getTile,dynamo,opts);
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
  function spendTeleportEnergy(m,getTile,opts,player,cost){
    opts=opts||{};
    const D=opts.dynamo || MM.dynamo;
    const heroEnergy=Object.prototype.hasOwnProperty.call(opts,'heroEnergy') ? opts.heroEnergy : (MM && MM.heroEnergy);
    const required=Math.max(0,Number(cost)||0);
    if(!(required>0)) return {storage:0,dynamo:0,hero:0};
    const storage=Math.max(0,m.energy||0);
    const dyn=connectedDynamoEnergy(m,getTile,D);
    const hero=heroAvailable(heroEnergy,player);
    if(storage+dyn+hero+1e-6<required) return null;
    let remaining=required;
    const spent={storage:0,dynamo:0,hero:0};
    const fromStorage=Math.min(storage,remaining);
    if(fromStorage>0){
      m.energy=Math.max(0,storage-fromStorage);
      remaining-=fromStorage;
      spent.storage=fromStorage;
    }
    if(remaining>0 && D && D.drainAt){
      const drained=drainNetworkEnergyAt(m.x,m.y,remaining,getTile,D,{fair:true});
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
  function spendTravelEnergy(m,getTile,opts,player){
    return spendTeleportEnergy(m,getTile,opts,player,TRAVEL_COST);
  }
  function chargeFromNetwork(m,dt,getTile,dynamo,net,demandRegistered){
    if(!m || !(dt>0)) return 0;
    const network=net || networkFor(m.x,m.y,getTile);
    const gained=chargeBatteryFrom(network,m.x,m.y,m,dt,getTile,dynamo,{capacity:TELEPORTER_CAPACITY,rate:CHARGE_RATE,demandRegistered});
    if(gained>0){
      m.energy=clampEnergy(m.energy||0);
      m.pulse=1;
    }
    return gained;
  }
  function listLoadedTeleporters(getTile,originX){
    const out=[];
    const seen=new Set();
    const worldAPI=MM.world || {};
    const world=worldAPI._world;
    const cx=Math.floor(Number(originX)||0);
    const stamp = world && typeof world.forEach==='function'
      ? 'world:'+networkRev+':'+(Number(world.size)||0)
      : 'scan:'+networkRev+':'+cx;
    if(stamp===teleporterListStamp) return teleporterListCache.map(p=>({x:p.x,y:p.y}));
    if(world && typeof world.forEach==='function'){
      world.forEach((arr,id)=>{
        if(!arr || typeof arr.length!=='number') return;
        const ref=typeof worldAPI.normalizeChunkRef==='function' ? worldAPI.normalizeChunkRef(id) : null;
        let chunkX=NaN, originY=0, height=WORLD_H;
        if(ref){
          chunkX=ref.cx;
          originY=Number.isFinite(ref.sy) && !ref.base ? ref.sy*WORLD_SECTION_H : 0;
          height=ref.base ? WORLD_H : WORLD_SECTION_H;
        } else {
          chunkX=Number(String(id).replace(/^c/,''));
          originY=0;
          height=WORLD_H;
        }
        if(!Number.isFinite(chunkX)) return;
        for(let i=0; i<arr.length; i++){
          if(arr[i]!==T.TELEPORTER) continue;
          const localY=Math.floor(i/CHUNK_W);
          if(localY<0 || localY>=height) continue;
          const y=originY+localY;
          if(!finiteTile(0,y) || y>=originY+height) continue;
          const localX=i-localY*CHUNK_W;
          const x=chunkX*CHUNK_W+localX;
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
      for(let y=WORLD_TOP; y<WORLD_BOTTOM; y++){
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
  function pairedTeleporter(tx,ty,getTile){
    const list=listLoadedTeleporters(getTile,tx);
    let best=null, bestScore=Infinity;
    for(const p of list){
      if(p.x===tx && p.y===ty) continue;
      if(getSafe(getTile,p.x,p.y,T.AIR)!==T.TELEPORTER) continue;
      const dx=p.x-tx, dy=p.y-ty;
      const score=dx*dx+dy*dy;
      if(score<bestScore || (score===bestScore && best && ((p.x<best.x) || (p.x===best.x && p.y<best.y)))){
        bestScore=score;
        best=p;
      }
    }
    return best;
  }
  function passableForPlayer(t){
    return isHeroPassableTile(t);
  }
  function isAlienBunkerTeleporter(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) return false;
    let concrete=0, roof=false, floor=false, side=false;
    for(let dy=-4; dy<=4; dy++){
      for(let dx=-4; dx<=4; dx++){
        const t=getSafe(getTile,x+dx,y+dy,T.AIR);
        if(t!==T.UFO_CONCRETE) continue;
        concrete++;
        if(dy<0) roof=true;
        if(dy>0) floor=true;
        if(dx!==0) side=true;
      }
    }
    return concrete>=BUNKER_FAILSAFE_CONCRETE_MIN && roof && floor && side;
  }
  function bunkerFailsafeSpent(origin,target,getTile){
    if(!origin || !target) return null;
    if(!isAlienBunkerTeleporter(origin.x,origin.y,getTile)) return null;
    if(isAlienBunkerTeleporter(target.x,target.y,getTile)) return null;
    return {storage:0,dynamo:0,hero:0,emergency:true};
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
    const d=dirVec(dir);
    const tangent={x:-d.y,y:d.x};
    const cx=target.x+0.5, cy=target.y+0.5;
    const w=Math.max(0.5,Number(player && player.w)||0.7);
    const h=Math.max(0.7,Number(player && player.h)||0.95);
    const halfExtent=Math.abs(d.x)*w*0.5+Math.abs(d.y)*h*0.5;
    const offset=0.5+halfExtent+0.08;
    const tries=[
      {x:cx+d.x*offset,y:cy+d.y*offset},
      {x:cx+d.x*offset+tangent.x,y:cy+d.y*offset+tangent.y},
      {x:cx+d.x*offset-tangent.x,y:cy+d.y*offset-tangent.y},
      {x:cx+d.x*(offset+1),y:cy+d.y*(offset+1)},
      {x:cx,y:cy}
    ];
    for(const p of tries) if(canStandAt(player,p.x,p.y,getTile)) return p;
    return tries[0];
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
  function entryVelocity(player,dir){
    const d=dirVec(dir);
    const vx=Number(player && player.vx)||0;
    const vy=Number(player && player.vy)||0;
    return -(vx*d.x+vy*d.y);
  }
  function canEnterTeleporter(player,getTile){
    const hit=teleporterUnderPlayer(player,getTile);
    if(!hit) return null;
    const m=ensureMachine(hit.x,hit.y,getTile);
    if(!m || entryVelocity(player,m.dir)<ENTRY_SPEED_MIN) return null;
    return {x:hit.x,y:hit.y,dir:normalizeDir(m.dir),speed:entryVelocity(player,m.dir)};
  }
  function transformVelocity(vx,vy,inputDir,outputDir){
    const opening=dirVec(inputDir);
    const incoming={x:-opening.x,y:-opening.y};
    const incomingRight={x:-incoming.y,y:incoming.x};
    const outgoing=dirVec(outputDir);
    const outgoingRight={x:-outgoing.y,y:outgoing.x};
    const forward=(Number(vx)||0)*incoming.x+(Number(vy)||0)*incoming.y;
    const right=(Number(vx)||0)*incomingRight.x+(Number(vy)||0)*incomingRight.y;
    return {
      vx:forward*outgoing.x+right*outgoingRight.x,
      vy:forward*outgoing.y+right*outgoingRight.y
    };
  }
  function projectileTeleporterAt(projectile,getTile){
    if(!projectile || !Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) return null;
    const x=Math.floor(projectile.x), y=Math.floor(projectile.y);
    if(getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) return null;
    const m=ensureMachine(x,y,getTile);
    if(!m || entryVelocity(projectile,m.dir)<ENTRY_SPEED_MIN) return null;
    return {x,y,dir:normalizeDir(m.dir)};
  }
  function projectileExitPosition(target,dir,projectile){
    const d=dirVec(dir);
    const radius=Math.max(0.04,Math.min(0.35,Number(projectile && projectile.portalRadius)||0.08));
    const offset=0.5+radius+0.06;
    return {x:target.x+0.5+d.x*offset,y:target.y+0.5+d.y*offset};
  }
  function tryTeleportProjectile(projectile,getTile,opts){
    opts=opts||{};
    if(!projectile || projectile.stuck || projectile.expiring || projectile.embeddedMob || projectile.ghost) return false;
    if((Number(projectile._teleporterCooldown)||0)>0) return false;
    const hit=projectileTeleporterAt(projectile,getTile);
    if(!hit) return false;
    const m=ensureMachine(hit.x,hit.y,getTile);
    if(!m) return false;
    const target=pairedTeleporter(hit.x,hit.y,getTile);
    if(!target) return false;
    const dest=ensureMachine(target.x,target.y,getTile);
    if(!dest) return false;
    const outputDir=normalizeDir(dest.dir);
    const pos=projectileExitPosition(target,outputDir,projectile);
    const velocity=transformVelocity(projectile.vx,projectile.vy,m.dir,outputDir);
    const defaultCost=opts.stream ? STREAM_TRAVEL_COST : PROJECTILE_TRAVEL_COST;
    const cost=Math.max(0.05,Number.isFinite(opts.cost)?Number(opts.cost):defaultCost);
    const player=projectile.coopOwner ? null : (opts.player || ((typeof window!=='undefined') ? window.player : null));
    const energyOpts=Object.assign({},opts);
    if(projectile.coopOwner) energyOpts.heroEnergy=null;
    const spent=spendTeleportEnergy(m,getTile,energyOpts,player,cost);
    if(!spent) return false;
    projectile.x=pos.x;
    projectile.y=pos.y;
    projectile.vx=velocity.vx;
    projectile.vy=velocity.vy;
    projectile._teleporterCooldown=PROJECTILE_TELEPORT_COOLDOWN;
    // Damage attribution follows the most recent EXIT. A creature struck after
    // this jump should retaliate against the apparent source beside it, not the
    // remote hero or the portal that accepted the shot.
    projectile._teleporterExitX=target.x;
    projectile._teleporterExitY=target.y;
    m.pulse=1;
    dest.pulse=1;
    projectileTeleports++;
    return true;
  }
  function damageAt(x,y,amount,getTile,setTile,opts){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) return {hit:false,destroyed:false,remaining:0};
    const m=ensureMachine(x,y,getTile);
    if(!m) return {hit:false,destroyed:false,remaining:0};
    const damage=Math.max(0,Math.min(TELEPORTER_MAX_HP,Number(amount)||0));
    if(!(damage>0)) return {hit:false,destroyed:false,remaining:m.hp,max:TELEPORTER_MAX_HP,damage:0};
    const before=Number.isFinite(m.hp)?m.hp:TELEPORTER_MAX_HP;
    m.hp=Math.max(0,before-damage);
    m.pulse=1;
    m.hitPulse=1;
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnSparks) p.spawnSparks((x+0.5)*tile,(y+0.5)*tile,'common',m.hp<=0?12:5);
    }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play(m.hp<=0?'break':'dig',{x:x+0.5,y:y+0.5}); }catch(e){}
    if(m.hp>0){
      return {hit:true,destroyed:false,remaining:m.hp,max:TELEPORTER_MAX_HP,damage:Math.min(before,damage)};
    }
    if(typeof setTile!=='function'){
      m.hp=0.5;
      return {hit:true,destroyed:false,remaining:m.hp,max:TELEPORTER_MAX_HP,damage:Math.min(before,damage)};
    }
    // Host/world truth owns the tile write. The normal world hook invalidates
    // network caches; the explicit delete also keeps isolated simulations safe.
    try{ setTile(x,y,T.AIR); }catch(e){
      m.hp=0.5;
      return {hit:true,destroyed:false,remaining:m.hp,max:TELEPORTER_MAX_HP,damage:Math.min(before,damage)};
    }
    if(getSafe(getTile,x,y,T.AIR)===T.TELEPORTER){
      m.hp=0.5;
      return {hit:true,destroyed:false,remaining:m.hp,max:TELEPORTER_MAX_HP,damage:Math.min(before,damage)};
    }
    machines.delete(key(x,y));
    networkCache.delete(key(x,y));
    invalidateTeleporterSearch();
    if(opts && typeof opts.onDestroyed==='function'){
      try{ opts.onDestroyed(x,y); }catch(e){}
    }
    return {hit:true,destroyed:true,remaining:0,max:TELEPORTER_MAX_HP,damage:Math.min(before,damage)};
  }
  function scanNearbyTeleporters(player,getTile){
    if(!player) return;
    // Raw world reads: the caller hands us the electric-network accessor (three
    // lookups per probe) but discovery only needs base tiles; peekTile also avoids
    // forcing chunk generation at the sweep edges.
    const w=(typeof window!=='undefined' && window.MM) ? MM.world : null;
    const read=(w && typeof w.peekTile==='function') ? (x,y)=>w.peekTile(x,y,T.AIR) : (x,y)=>getSafe(getTile,x,y,T.AIR);
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const x0=cx-72, x1=cx+72;
    const y0=Math.max(WORLD_TOP,cy-36), y1=Math.min(WORLD_BOTTOM-1,cy+36);
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(read(x,y)===T.TELEPORTER) ensureMachine(x,y,getTile);
      }
    }
  }
  function tryTeleport(player,getTile,opts){
    const hit=canEnterTeleporter(player,getTile);
    if(!hit) return false;
    if((player._teleporterCooldown||0)>0) return false;
    const m=ensureMachine(hit.x,hit.y,getTile);
    if(!m || (m.cooldown||0)>0) return false;
    const target=pairedTeleporter(hit.x,hit.y,getTile);
    if(!target) return false;
    const dest=ensureMachine(target.x,target.y,getTile);
    if(!dest) return false;
    const outputDir=normalizeDir(dest.dir);
    const pos=exitPosition(target,outputDir,player,getTile);
    const velocity=transformVelocity(player.vx,player.vy,m.dir,outputDir);
    let spent=spendTravelEnergy(m,getTile,opts,player);
    if(!spent) spent=bunkerFailsafeSpent(hit,target,getTile);
    if(!spent) return false;
    player.x=pos.x;
    player.y=pos.y;
    player.vx=velocity.vx;
    player.vy=velocity.vy;
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
      if(MM.ui && MM.ui.msg) MM.ui.msg(spent.emergency ? 'Awaryjny powrot z bunkra UFO' : 'Teleport: wyjscie w '+DIR_VEC[outputDir].label);
    }catch(e){}
    return true;
  }
  function update(dt,player,getTile,_setTile,opts){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return;
    if(externalPowerFramePending) externalPowerFramePending=false;
    else advancePowerFrame();
    decayWireActivity(dt,getTile);
    scanT-=dt;
    if(scanT<=0){
      scanT=PLAYER_SCAN_INTERVAL;
      scanNearbyTeleporters(player,getTile);
    }
    if(player && player._teleporterCooldown>0) player._teleporterCooldown=Math.max(0,player._teleporterCooldown-dt);
    const px=(player && Number.isFinite(player.x)) ? player.x : 0;
    const py=(player && Number.isFinite(player.y)) ? player.y : 0;
    const dynamo=opts && opts.dynamo;
    const SIM=MM.worldSim;
    const chargeRows=[];
    const validateAndQueue=(k,m,step)=>{
      if(getSafe(getTile,m.x,m.y,T.AIR)!==T.TELEPORTER){
        machines.delete(k);
        networkCache.delete(k);
        return false;
      }
      const want=batteryChargeDemand(m,step,TELEPORTER_CAPACITY,CHARGE_RATE);
      if(want>0 && Number.isFinite(want)){
        const net=networkFor(m.x,m.y,getTile);
        const hasSources=networkSources(net).length>0;
        if(hasSources) m.locallyIsolated=false;
        m.sourceLessRev=hasSources ? 0 : networkRev;
        const registered=registerPowerDemandForNetwork(net,m.x,m.y,want,getTile,dynamo);
        m.lastNetworkId=registered.networkId;
        chargeRows.push({m,step,net});
      }
      return true;
    };
    // Far teleporters are FROZEN (worldSim gate) — no validation reads, no
    // network scans, no charging. The old remote path still validated and
    // CHARGED every far non-full battery every frame; now the whole absence
    // arrives as one wake step through the same demand/allocation math, so a
    // battery fills by exactly what the network could have given it (the wake
    // step is one allocator pass: a scarce shared source pays a single step's
    // worth, which under-credits contested networks rather than minting energy).
    for(const [k,m] of machines){
      if(!m){
        machines.delete(k);
        networkCache.delete(k);
        continue;
      }
      const step=SIM ? SIM.wakeDt(dt,m.x,m.y,WAKE_MAX_SECONDS) : dt;
      if(step===null) continue;
      // Scalar decays pay the wake gap back too: a cooldown that would have
      // expired while nobody watched has expired by the time anyone returns.
      m.cooldown=Math.max(0,(m.cooldown||0)-step);
      m.pulse=Math.max(0,(m.pulse||0)-dt*2.6);
      m.hitPulse=Math.max(0,(m.hitPulse||0)-dt*3.8);
      const full=!!(finiteNonNegative(m.energy,0)>=TELEPORTER_CAPACITY-1e-9);
      const knownSourceLess=!!(m.locallyIsolated || m.sourceLessRev===networkRev);
      if(full || knownSourceLess) clearMachinePowerDemand(m);
      validateAndQueue(k,m,step);
    }
    // Register every active or woken machine before any source is drained.
    // Otherwise the first endpoint could consume a scarce shared network before
    // its peers became visible to max-min allocation.
    for(const row of chargeRows) chargeFromNetwork(row.m,row.step,getTile,dynamo,row.net,true);
    if(machines.size>MACHINE_CAP){
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
  function catchUp(dt,_player,getTile,_setTile,opts){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return false;
    const simDt=Math.max(0,Math.min(CATCHUP_MAX_SECONDS,Number(dt)||0));
    if(simDt<=0) return false;
    advancePowerFrame();
    let changed=false;
    const dynamo=opts && opts.dynamo;
    const chargeRows=[];
    for(const [raw,m] of machines){
      if(!m || getSafe(getTile,m.x,m.y,T.AIR)!==T.TELEPORTER){
        machines.delete(raw);
        networkCache.delete(raw);
        changed=true;
        continue;
      }
      const before=m.energy||0;
      m.cooldown=0;
      m.pulse=0;
      const want=batteryChargeDemand(m,simDt,TELEPORTER_CAPACITY,CHARGE_RATE);
      if(want>0 && Number.isFinite(want)){
        const net=networkFor(m.x,m.y,getTile);
        const hasSources=networkSources(net).length>0;
        if(hasSources) m.locallyIsolated=false;
        m.sourceLessRev=hasSources ? 0 : networkRev;
        const registered=registerPowerDemandForNetwork(net,m.x,m.y,want,getTile,dynamo);
        m.lastNetworkId=registered.networkId;
        chargeRows.push({m,step:simDt,net,before});
      }else clearMachinePowerDemand(m);
    }
    for(const row of chargeRows){
      chargeFromNetwork(row.m,row.step,getTile,dynamo,row.net,true);
      if(Math.abs((row.m.energy||0)-row.before)>0.0001) changed=true;
    }
    return changed;
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
  function drawTeleporterFrame(ctx,TILE,px,py,dir,charge,pulse,phase,hpRatio){
    const d=dirVec(dir);
    const tangent={x:-d.y,y:d.x};
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
    // The bright mouth and arrow expose the configured portal normal even while
    // the gate is empty. The same side accepts an incoming body and emits it at
    // the paired endpoint, matching a Portal-style two-sided velocity transform.
    const cx=px+TILE*0.5, cy=py+TILE*0.5;
    const mouthX=cx+d.x*TILE*0.34, mouthY=cy+d.y*TILE*0.34;
    ctx.strokeStyle='rgba(210,255,255,'+(0.72+0.20*glow).toFixed(3)+')';
    ctx.lineWidth=Math.max(1.2,TILE*0.08);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(mouthX+tangent.x*TILE*0.18,mouthY+tangent.y*TILE*0.18);
    ctx.lineTo(mouthX-tangent.x*TILE*0.18,mouthY-tangent.y*TILE*0.18);
    ctx.stroke();
    const shaft={x:cx+d.x*TILE*0.20,y:cy+d.y*TILE*0.20};
    ctx.fillStyle='rgba(255,236,148,0.92)';
    ctx.beginPath();
    ctx.moveTo(cx+d.x*TILE*0.32,cy+d.y*TILE*0.32);
    ctx.lineTo(shaft.x+tangent.x*TILE*0.11,shaft.y+tangent.y*TILE*0.11);
    ctx.lineTo(shaft.x-tangent.x*TILE*0.11,shaft.y-tangent.y*TILE*0.11);
    ctx.closePath();
    ctx.fill();
    // A charged gate emits: the glow attribute replaces the per-frame radial
    // gradient this drew for itself, so the halo lands above the darkness overlay
    // and scales with the charge that actually powers the gate.
    if(glow>0.02){
      const P=(typeof window!=='undefined' && window.MM) ? window.MM.postFx : null;
      if(P && P.glow) P.glow(px+TILE*0.5, py+TILE*0.5, PORTAL_GLOW, null, TILE);
    }
    drawBatteryLines(ctx,TILE,px,py,charge,pulse);
    hpRatio=Math.max(0,Math.min(1,Number.isFinite(hpRatio)?hpRatio:1));
    if(hpRatio<0.999){
      const barX=px+TILE*0.18, barY=py+TILE*0.87, barW=TILE*0.64, barH=Math.max(2,TILE*0.055);
      ctx.fillStyle='rgba(18,4,7,0.88)';
      ctx.fillRect(barX,barY,barW,barH);
      ctx.fillStyle=hpRatio>0.45?'#ffba5e':'#ff5368';
      ctx.fillRect(barX,barY,barW*hpRatio,barH);
    }
    ctx.restore();
  }
  function ensureVisibleMachines(sx,sy,viewX,viewY,getTile){
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(WORLD_TOP,Math.floor(sy)-2), y1=Math.min(WORLD_BOTTOM-1,Math.ceil(sy+viewY)+2);
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
        const cableType=getSafe(getTile,a.x,a.y,T.AIR);
        if(!isCable(cableType)) continue;
        const conn=cableConnections(a.x,a.y,getTile);
        drawCableEnergy(ctx,TILE,a.x*TILE,a.y*TILE,conn,a.level||0,a.ttl||0,((a.x*73856093)^(a.y*19349663))>>>0,now+a.x*0.19+a.y*0.11,a.flowX||0,a.flowY||0,cableType);
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
      drawTeleporterFrame(ctx,TILE,px,py,m.dir,charge,m.pulse||0,now+m.x*0.2,(Number(m.hp)||0)/TELEPORTER_MAX_HP);
    }
    ctx.restore();
  }
  function onTileChanged(x,y,oldTile,newTile){
    if(oldTile===newTile) return;
    if(!isMachineNetworkTile(oldTile) && !isMachineNetworkTile(newTile)) return;
    networkRev++;
    networkCache.clear();
    fairDemandRegistry.clear();
    fairFrameAllocations.clear();
    copperHeatBuffers.clear();
    invalidateTeleporterSearch();
    const tx=Math.floor(x), ty=Math.floor(y);
    if(oldTile===T.TELEPORTER && newTile!==T.TELEPORTER) machines.delete(key(tx,ty));
    const worldGet=MM.world && MM.world.getTile;
    if(newTile===T.TELEPORTER) ensureMachine(tx,ty,worldGet);
    for(const [dx,dy] of [[0,0],...NETWORK_ADJ]){
      const m=machines.get(key(tx+dx,ty+dy));
      if(!m) continue;
      m.locallyIsolated=!hasMachineNetworkNeighbor(m.x,m.y,worldGet);
      m.sourceLessRev=m.locallyIsolated ? networkRev : 0;
    }
  }
  function snapshot(){
    const list=[...machines.values()]
      .filter(m=>m && finiteTile(m.x,m.y))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MACHINE_CAP)
      .map(m=>({x:m.x,y:m.y,dir:normalizeDir(m.dir),energy:+(m.energy||0).toFixed(3),hp:+(Number.isFinite(m.hp)?m.hp:TELEPORTER_MAX_HP).toFixed(3)}));
    return {v:4,list};
  }
  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    const limit=Math.min(data.list.length,MACHINE_CAP);
    for(let i=0;i<limit;i++){
      const raw=data.list[i];
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(getTile && getSafe(getTile,x,y,T.AIR)!==T.TELEPORTER) continue;
      const m=ensureMachine(x,y,getTile);
      if(m){
        m.dir=normalizeDir(raw.dir);
        m.energy=clampEnergy(raw.energy);
        // v3 used a four-hit integrity counter. Preserve the same damage ratio
        // when loading it into the 200 HP model.
        const legacyHp=raw.integrity!=null && Number.isFinite(Number(raw.integrity))
          ? (Math.max(0,Math.min(4,Number(raw.integrity)))/4)*TELEPORTER_MAX_HP
          : TELEPORTER_MAX_HP;
        const savedHp=raw.hp!=null && Number.isFinite(Number(raw.hp)) ? Number(raw.hp) : legacyHp;
        m.hp=Math.max(0.5,Math.min(TELEPORTER_MAX_HP,savedHp));
      }
    }
  }
  function reset(){
    machines.clear();
    networkCache.clear();
    wireActivity.clear();
    wireMarkThrottle.clear();
    fairDemandRegistry.clear();
    fairFrameAllocations.clear();
    powerFrameId=0;
    externalPowerFramePending=false;
    copperHeatBuffers.clear();
    copperHeatCursor=0;
    copperHeatEvents=0;
    projectileTeleports=0;
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
    let copperHeatBuffer=0;
    for(const value of copperHeatBuffers.values()) copperHeatBuffer+=Math.max(0,Number(value)||0);
    return {machines:machines.size, charged, storedEnergy:+storedEnergy.toFixed(2), poweredWires:wireActivity.size,projectileTeleports,
      fairNetworks:fairDemandRegistry.size,powerFrameId,networkRev,copperHeatEvents,copperHeatBuffer:+copperHeatBuffer.toFixed(2),copperHeatNetworks:copperHeatBuffers.size};
  }
  function receiveElectricChargeAt(x,y,amount,getTile){
    const m=ensureMachine(x,y,getTile || (MM.world && MM.world.getTile));
    if(!m) return 0;
    const before=m.energy||0;
    m.energy=clampEnergy(before+Math.max(0,Number(amount)||0));
    m.pulse=1;
    return m.energy-before;
  }
  function debugCharge(x,y,amount,getTile){ return receiveElectricChargeAt(x,y,amount,getTile); }
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
    pairedTeleporter,
    teleporterUnderPlayer,
    canEnterTeleporter,
    orientationAt,
    setOrientationAt,
    rotateDir,
    networkFor,
    connectedDynamosAt,
    availableNetworkEnergyAt,
    drainNetworkEnergyAt,
    chargeBatteryAt,
    registerPowerDemandAt,
    receiveElectricChargeAt,
    beginPowerFrame,
    tryTeleport,
    tryTeleportProjectile,
    damageAt,
    update,
    catchUp,
    draw,
    onTileChanged,
    snapshot,
    restore,
    reset,
    metrics,
    _debug:{machines,networkCache,wireActivity,fairDemandRegistry,fairFrameAllocations,copperHeatBuffers,TELEPORTER_CAPACITY,TELEPORTER_MAX_HP,MACHINE_CAP,NETWORK_CAP,NETWORK_ENDPOINT_CAP,TRAVEL_COST,PROJECTILE_TRAVEL_COST,STREAM_TRAVEL_COST,PROJECTILE_TELEPORT_COOLDOWN,CHARGE_RATE,CATCHUP_MAX_SECONDS,WAKE_MAX_SECONDS,COPPER_DELIVERY_EFFICIENCY,SILVER_DELIVERY_EFFICIENCY,COPPER_HEAT_THRESHOLD,ENTRY_SPEED_MIN,debugCharge,debugSetEnergy,ensureMachine,listLoadedTeleporters,nearestTeleporter,pairedTeleporter,teleporterUnderPlayer,canEnterTeleporter,projectileTeleporterAt,projectileExitPosition,transformVelocity,tryTeleport,tryTeleportProjectile,damageAt,networkFor,networkDeliveryEfficiency,sourceRouteInfo,isAlienBunkerTeleporter,maxMinAlloc,maxMinAllocWeighted,networkIdentity}
  };
  MM.teleporters=api;
})();

export const teleporters = (typeof window!=='undefined' && window.MM) ? window.MM.teleporters : undefined;
export default teleporters;
