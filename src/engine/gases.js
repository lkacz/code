// Sparse world gas simulation.
// Gases are passable tiles with their own active registry: they rise like an
// inverted, low-volume fluid, remain hidden by fog until discovered, and expose
// a small API for later machine systems (consume/inspect/add). Steam and hot air
// lose a little mass when turbines extract power, so stacked dynamos attenuate a
// plume instead of multiplying one source forever.
import { T, WORLD_H, CHUNK_W } from '../constants.js';

(function(){
  window.MM = window.MM || {};

  const GAS_TILES = new Set([T.HOT_AIR,T.STEAM,T.POISON_GAS,T.FUEL_GAS]);
  const KIND_TILE = {
    hot:T.HOT_AIR,
    hot_air:T.HOT_AIR,
    steam:T.STEAM,
    poison:T.POISON_GAS,
    poison_gas:T.POISON_GAS,
    gas:T.POISON_GAS,
    fuel:T.FUEL_GAS,
    fuel_gas:T.FUEL_GAS
  };
  const GAS_DEF = {
    [T.HOT_AIR]:{kind:'hot', ttl:60, move:0.16, color:'#f4b65e', alpha:0.22},
    [T.STEAM]:{kind:'steam', ttl:60, move:0.21, color:'#dfe8ee', alpha:0.42, condense:T.WATER},
    [T.POISON_GAS]:{kind:'poison', ttl:150, move:0.34, color:'#82d45b', alpha:0.38, poison:true},
    [T.FUEL_GAS]:{kind:'fuel', ttl:240, move:0.38, color:'#b1a36c', alpha:0.34, explosive:true}
  };
  const MAX_ACTIVE = 1800;
  const STEAM_TO_WATER = 5;
  const CONDENSATE_BUCKET = 3;
  const CONDENSATE_MERGE_RADIUS = 6;
  const CONDENSATE_TTL = 75;
  const CONDENSATE_CAP = 420;
  const SCAN_INTERVAL = 1.1;
  const SCAN_RX = 84;
  const SCAN_RY = 56;
  const DYNAMO_POWERED_GAS_LOSS_CHANCE = 0.10;
  const SPAWN_OFFSETS = [
    [0,-1],[-1,-1],[1,-1],[0,0],[-2,-1],[2,-1],
    [0,-2],[-1,-2],[1,-2],[-1,0],[1,0],[-2,0],[2,0],
    [0,-3],[-1,-3],[1,-3],[-3,-1],[3,-1],[-2,-2],[2,-2]
  ];
  const NEIGHBORS = [[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]];
  const active = new Map(); // "x,y" -> {x,y,t,age,moveT,reactT,poisonT}
  const condensate = new Map(); // local steam mass buckets; five steam cells make one water cell
  let scanAcc = 0;
  let frameSeq = 0;
  let turbineFlowSeq = 0;
  let heroPoisonCd = 0;
  let spriteTile = 0;
  let sprites = null;

  function key(x,y){ return (x|0)+','+(y|0); }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=0 && y<WORLD_H; }
  function isGasTile(t){ return GAS_TILES.has(t); }
  function gasDef(t){ return GAS_DEF[t] || null; }
  function gasKind(t){ const d=gasDef(t); return d ? d.kind : null; }
  function skyExposed(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || typeof getTile!=='function') return false;
    for(let yy=y-1; yy>=0; yy--){
      const t=getSafe(getTile,x,yy,T.AIR);
      if(t===T.AIR || isGasTile(t)) continue;
      return false;
    }
    return true;
  }
  function tileFor(kind){
    if(isGasTile(kind)) return kind;
    if(typeof kind!=='string') return T.POISON_GAS;
    return KIND_TILE[kind.toLowerCase()] || T.POISON_GAS;
  }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function setGasTile(x,y,t,setTile){
    if(typeof setTile!=='function') return false;
    try{
      if((t===T.AIR || isGasTile(t)) && typeof setTile.transient==='function'){
        setTile.transient(x,y,t);
        return true;
      }
      const W=(typeof window!=='undefined' && window.MM) ? MM.world : null;
      if((t===T.AIR || isGasTile(t)) && W && typeof W.setTransientTile==='function' && (!setTile || setTile===W.setTile)){
        W.setTransientTile(x,y,t);
        return true;
      }
      setTile(x,y,t);
      return true;
    }catch(e){
      return false;
    }
  }
  function hash32(x,y,salt){
    let h = Math.imul(x|0, 374761393) ^ Math.imul(y|0, 668265263) ^ Math.imul(salt|0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rand01(x,y,salt){ return hash32(x,y,salt) / 4294967295; }
  function moveDelay(t,x,y){
    const d=gasDef(t);
    const base=d ? d.move : 0.3;
    return base * (0.78 + rand01(x,y,17)*0.44);
  }
  function windDriftFor(g,getTile){
    try{
      const W=(typeof window!=='undefined' && window.MM) ? MM.wind : null;
      if(W && typeof W.gasDrift==='function') return W.gasDrift(g.x,g.y,g.t,getTile);
    }catch(e){}
    return 0;
  }
  function clearEvictedGasTile(g,setTile){
    if(!g) return;
    try{
      const W=(typeof window!=='undefined' && window.MM) ? MM.world : null;
      const getTile=W && typeof W.getTile==='function' ? W.getTile : null;
      if(getTile && getSafe(getTile,g.x,g.y,T.AIR)!==g.t) return;
      const writer=typeof setTile==='function' ? setTile : (W && W.setTile);
      if(typeof writer==='function') setGasTile(g.x,g.y,T.AIR,writer);
    }catch(e){}
  }
  function evictActiveFor(x,y,setTile){
    let bestKey=null, bestScore=-Infinity;
    for(const [k,g] of active){
      const ageScore=(g.age||0)*0.45;
      const distScore=Math.abs((g.x||0)-x)+Math.abs((g.y||0)-y);
      const valuePenalty=g.t===T.FUEL_GAS ? 80 : (g.t===T.STEAM ? 16 : 0);
      const score=ageScore+distScore-valuePenalty;
      if(score>bestScore){ bestScore=score; bestKey=k; }
    }
    if(bestKey==null) return false;
    const old=active.get(bestKey);
    active.delete(bestKey);
    clearEvictedGasTile(old,setTile);
    return true;
  }
  function gasMoveBudget(){
    const ms=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    return ms>32 ? 22 : (ms>18 ? 54 : 124);
  }
  function canReplaceWithGas(tile,dst){
    if(dst===T.AIR) return true;
    return false;
  }
  function canSwapThroughGas(tile,dst){
    return tile===T.HOT_AIR && isGasTile(dst) && dst!==T.HOT_AIR;
  }
  function freshGasRecord(x,y,t){
    return {
      x,y,t,
      age:0,
      moveT:moveDelay(t,x,y),
      reactT:0.05+rand01(x,y,31)*0.22,
      poisonT:0.15+rand01(x,y,47)*0.35
    };
  }
  function swapGasCells(g,nx,ny,dst,getTile,setTile){
    if(!canSwapThroughGas(g.t,dst) || typeof setTile!=='function') return false;
    const ox=g.x, oy=g.y;
    const oldKey=key(ox,oy);
    const newKey=key(nx,ny);
    const other=active.get(newKey) || freshGasRecord(nx,ny,dst);
    active.delete(oldKey);
    active.delete(newKey);
    setGasTile(ox,oy,dst,setTile);
    setGasTile(nx,ny,g.t,setTile);
    // Tile-change hooks may have re-registered the two cells; replace those
    // records with the intentional swap so gas identity, age and timers survive.
    active.delete(oldKey);
    active.delete(newKey);
    other.x=ox; other.y=oy; other.t=dst; other.moveT=moveDelay(dst,ox,oy); other._frame=frameSeq;
    g.x=nx; g.y=ny; g.moveT=moveDelay(g.t,nx,ny); g._frame=frameSeq;
    active.set(oldKey,other);
    active.set(newKey,g);
    try{ if(MM.water && MM.water.onTileChanged){ MM.water.onTileChanged(ox,oy,getTile); MM.water.onTileChanged(nx,ny,getTile); } }catch(e){}
    return true;
  }
  function tryMoveGasThroughDynamo(g,nx,ny,dx,dy,getTile,setTile){
    if(dx!==0 || dy!==-1) return false;
    const D=(typeof window!=='undefined' && window.MM) ? MM.dynamo : null;
    if(!D || typeof D.isValidSlot!=='function' || !D.isValidSlot(nx,ny,getTile,'horizontal')) return false;
    const ty=ny-1;
    if(ty<0){ clearGasCell(g.x,g.y,getTile,setTile); return true; }
    const dst=getSafe(getTile,nx,ty,T.AIR);
    if(swapGasCells(g,nx,ty,dst,getTile,setTile)){
      try{ if(D.recordFlow && D.recordFlow(nx,ny,g.t,1,getTile)) maybeConsumePoweredGas(g,nx,ny,nx,ty,getTile,setTile); }catch(e){}
      return true;
    }
    if(!canReplaceWithGas(g.t,dst)) return false;
    const oldKey=key(g.x,g.y);
    const newKey=key(nx,ty);
    if(typeof setTile==='function'){
      setGasTile(g.x,g.y,T.AIR,setTile);
      setGasTile(nx,ty,g.t,setTile);
    }
    active.delete(oldKey);
    g.x=nx; g.y=ty; g.moveT=moveDelay(g.t,nx,ty); g._frame=frameSeq;
    active.set(newKey,g);
    try{ if(D.recordFlow && D.recordFlow(nx,ny,g.t,1,getTile)) maybeConsumePoweredGas(g,nx,ny,nx,ty,getTile,setTile); }catch(e){}
    return true;
  }
  function maybeConsumePoweredGas(g,slotX,slotY,outX,outY,getTile,setTile){
    if(!g || (g.t!==T.STEAM && g.t!==T.HOT_AIR)) return false;
    const roll=rand01((slotX|0)+Math.imul(outX|0,17), (slotY|0)+Math.imul(outY|0,31), 911+(turbineFlowSeq++));
    if(roll>=DYNAMO_POWERED_GAS_LOSS_CHANCE) return false;
    clearGasCell(outX,outY,getTile,setTile);
    return true;
  }
  function noteGas(x,y,t,opts){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || !isGasTile(t)) return false;
    const k=key(x,y);
    let g=active.get(k);
    if(!g){
      if(active.size>=MAX_ACTIVE && !evictActiveFor(x,y,opts && opts.setTile)) return false;
      g={x,y,t,age:0,moveT:moveDelay(t,x,y),reactT:0.05+rand01(x,y,31)*0.22,poisonT:0.15+rand01(x,y,47)*0.35};
    }
    g.x=x; g.y=y; g.t=t;
    if(opts && Number.isFinite(opts.age)) g.age=Math.max(0,opts.age);
    if(opts && Number.isFinite(opts.moveT)) g.moveT=Math.max(0,opts.moveT);
    active.set(k,g);
    return true;
  }
  function removeGas(x,y){ active.delete(key(Math.floor(x),Math.floor(y))); }
  function onTileChanged(x,y,oldTile,newTile){
    x=Math.floor(x); y=Math.floor(y);
    if(isGasTile(newTile)) noteGas(x,y,newTile);
    else if(isGasTile(oldTile)) removeGas(x,y);
  }
  function wakeWaterAt(x,y,getTile){
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{ if(MM.water && MM.water.disturb) MM.water.disturb(x,70); }catch(e){}
  }
  function condensateBucketFor(x,y){
    const half=Math.floor(CONDENSATE_BUCKET/2);
    const bx=Math.floor((Math.floor(x)+half)/CONDENSATE_BUCKET);
    const by=Math.floor((Math.floor(y)+half)/CONDENSATE_BUCKET);
    return {
      k:bx+','+by,
      x:bx*CONDENSATE_BUCKET,
      y:by*CONDENSATE_BUCKET
    };
  }
  function nearbyCondensate(x,y){
    const out=[];
    for(const [k,c] of condensate){
      if(!c || c.n<=0) continue;
      const dx=(c.x||0)-x, dy=(c.y||0)-y;
      if(Math.abs(dx)>CONDENSATE_MERGE_RADIUS || Math.abs(dy)>CONDENSATE_MERGE_RADIUS) continue;
      out.push({k,c,d:dx*dx+dy*dy});
    }
    out.sort((a,b)=>a.d-b.d);
    return out;
  }
  function consumeCondensate(entries,amount){
    let need=amount;
    for(const e of entries){
      if(need<=0) break;
      const take=Math.min(need, Math.max(0,Math.floor(e.c.n||0)));
      e.c.n-=take;
      need-=take;
      if(e.c.n<=0) condensate.delete(e.k);
    }
    return need<=0;
  }
  function pruneCondensate(dt){
    if(!condensate.size) return;
    const step=Math.max(0,Number(dt)||0);
    for(const [k,c] of condensate){
      if(!c || !finiteTile(c.x,c.y) || !(c.n>0)){ condensate.delete(k); continue; }
      c.age=Math.max(0,(Number(c.age)||0)+step);
      if(c.age>CONDENSATE_TTL) condensate.delete(k);
    }
    if(condensate.size<=CONDENSATE_CAP) return;
    const ordered=[...condensate.entries()].sort((a,b)=>{
      const an=Number(a[1] && a[1].n)||0, bn=Number(b[1] && b[1].n)||0;
      const aa=Number(a[1] && a[1].age)||0, ba=Number(b[1] && b[1].age)||0;
      return an-bn || ba-aa;
    });
    for(let i=0; i<ordered.length && condensate.size>Math.floor(CONDENSATE_CAP*0.82); i++) condensate.delete(ordered[i][0]);
  }
  function placeCondensedWaterAt(x,y,getTile,setTile){
    if(typeof setTile!=='function' || !finiteTile(x,y)) return false;
    const cur=getSafe(getTile,x,y,T.STONE);
    if(cur!==T.AIR && cur!==T.WATER && !isGasTile(cur)) return false;
    let placed=false;
    try{ if(MM.water && MM.water.addSource) placed=!!MM.water.addSource(x,y,getTile,setTile); }catch(e){ placed=false; }
    if(!placed){
      try{
        if(cur!==T.WATER) setTile(x,y,T.WATER);
        if(isGasTile(cur)) active.delete(key(x,y));
        wakeWaterAt(x,y,getTile);
        placed=true;
      }catch(e){ placed=false; }
    }
    return placed;
  }
  function tryPlaceCondensedWater(x,y,getTile,setTile){
    const offsets=[[0,0],[0,1],[-1,0],[1,0],[-1,1],[1,1],[0,-1],[-1,-1],[1,-1],[-2,0],[2,0]];
    for(const [dx,dy] of offsets){
      if(placeCondensedWaterAt(Math.floor(x)+dx,Math.floor(y)+dy,getTile,setTile)) return true;
    }
    return false;
  }
  function addSteamCondensate(x,y,getTile,setTile){
    const b=condensateBucketFor(x,y);
    const existing=nearbyCondensate(x,y)[0];
    const k=existing ? existing.k : b.k;
    let c=existing ? existing.c : condensate.get(k);
    if(!c){ c={x:b.x,y:b.y,n:0,age:0}; condensate.set(k,c); }
    const oldN=Math.max(0,Math.floor(c.n||0));
    c.x=Math.round(((c.x||b.x)*oldN+Math.floor(x))/(oldN+1));
    c.y=Math.round(((c.y||b.y)*oldN+Math.floor(y))/(oldN+1));
    c.n=Math.min(50, oldN+1);
    c.age=0;
    const nearby=nearbyCondensate(x,y);
    const total=nearby.reduce((sum,e)=>sum+Math.max(0,Math.floor(e.c.n||0)),0);
    if(total>=STEAM_TO_WATER && tryPlaceCondensedWater(x,y,getTile,setTile)){
      consumeCondensate(nearby,STEAM_TO_WATER);
      return true;
    }
    return false;
  }
  function clearGasCell(x,y,getTile,setTile){
    const t=getSafe(getTile,x,y,T.AIR);
    if(isGasTile(t)) setGasTile(x,y,T.AIR,setTile);
    active.delete(key(x,y));
  }
  function condenseSteam(g,getTile,setTile){
    active.delete(key(g.x,g.y));
    if(typeof setTile!=='function') return;
    if(getSafe(getTile,g.x,g.y,T.AIR)!==T.STEAM) return;
    setGasTile(g.x,g.y,T.AIR,setTile);
    addSteamCondensate(g.x,g.y,getTile,setTile);
  }
  function expireGas(g,getTile,setTile){
    if(g.t===T.STEAM){ condenseSteam(g,getTile,setTile); return; }
    clearGasCell(g.x,g.y,getTile,setTile);
  }
  function ignitionAt(x,y,getTile){
    const t=getSafe(getTile,x,y,T.AIR);
    if(t===T.LAVA || t===T.TORCH) return true;
    try{ if(MM.fire && MM.fire.isBurning && MM.fire.isBurning(x,y)) return true; }catch(e){}
    return false;
  }
  function fuelTouchesIgnition(g,getTile){
    if(ignitionAt(g.x,g.y,getTile)) return true;
    for(const [dx,dy] of NEIGHBORS) if(ignitionAt(g.x+dx,g.y+dy,getTile)) return true;
    return false;
  }
  function consumeRadius(kind,wx,wy,r,getTile,setTile){
    const tile=tileFor(kind);
    const R=Math.max(0.5, r||1);
    const ri=Math.ceil(R);
    const cx=Math.floor(wx), cy=Math.floor(wy);
    let n=0;
    for(let y=cy-ri; y<=cy+ri; y++){
      if(y<0 || y>=WORLD_H) continue;
      for(let x=cx-ri; x<=cx+ri; x++){
        const dx=(x+0.5)-wx, dy=(y+0.5)-wy;
        if(dx*dx+dy*dy>R*R) continue;
        if(getSafe(getTile,x,y,T.AIR)!==tile) continue;
        if(typeof setTile==='function') setGasTile(x,y,T.AIR,setTile);
        active.delete(key(x,y));
        n++;
      }
    }
    return n;
  }
  function explodeFuelAt(x,y,getTile,setTile){
    const wx=x+0.5, wy=y+0.5;
    const consumed=consumeRadius(T.FUEL_GAS,wx,wy,3.2,getTile,setTile);
    try{
      if(MM.weapons && MM.weapons.explodeAt) return !!MM.weapons.explodeAt(wx,wy,getTile,setTile,{extraConsumed:consumed,force:consumed>0});
    }catch(e){}
    try{
      if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(wx*(MM.TILE||20),wy*(MM.TILE||20),'epic');
      if(MM.audio && MM.audio.play) MM.audio.play('explosion');
    }catch(e){}
    return true;
  }
  function igniteAt(x,y,getTile,setTile,radius){
    const R=Math.max(1, radius||1.5);
    const ri=Math.ceil(R);
    const cx=Math.floor(x), cy=Math.floor(y);
    let best=null, bestD=Infinity;
    for(let yy=cy-ri; yy<=cy+ri; yy++){
      if(yy<0 || yy>=WORLD_H) continue;
      for(let xx=cx-ri; xx<=cx+ri; xx++){
        if(getSafe(getTile,xx,yy,T.AIR)!==T.FUEL_GAS) continue;
        const dx=(xx+0.5)-x, dy=(yy+0.5)-y, d=dx*dx+dy*dy;
        if(d<=R*R && d<bestD){ bestD=d; best={x:xx,y:yy}; }
      }
    }
    if(!best) return false;
    return explodeFuelAt(best.x,best.y,getTile,setTile);
  }
  function updatePoison(g,dt,player){
    g.poisonT=(g.poisonT||0)-dt;
    if(g.poisonT>0) return;
    g.poisonT=0.45+rand01(g.x,g.y,73)*0.35;
    try{ if(MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(g.x+0.5,g.y+0.5,1.15,{dur:3.5,dps:1.2}); }catch(e){}
    if(heroPoisonCd>0 || !player || typeof window.damageHero!=='function') return;
    const dx=player.x-(g.x+0.5), dy=(player.y-0.2)-(g.y+0.5);
    if(dx*dx+dy*dy<=1.55){
      if(window.damageHero(2,{srcX:g.x+0.5,srcY:g.y+0.5,kb:0.6,kbY:-0.2,invulMs:260,cause:'poison_gas'})){
        heroPoisonCd=1.1;
      }
    }
  }
  function moveGas(g,getTile,setTile){
    if(g.y<=0){ clearGasCell(g.x,g.y,getTile,setTile); return true; }
    const drift=windDriftFor(g,getTile);
    const windDir=drift>0.06 ? 1 : (drift<-0.06 ? -1 : 0);
    const sideFirst=windDir || ((hash32(g.x,g.y,Math.floor(g.age*3)+101)&1) ? -1 : 1);
    const crossChance=clamp((Math.abs(drift)-0.55)/2.6,0,0.68);
    const crossFirst=windDir && rand01(g.x,g.y,frameSeq+173)<crossChance;
    const dirs=crossFirst
      ? [[sideFirst,0],[0,-1],[sideFirst,-1],[-sideFirst,-1],[-sideFirst,0]]
      : [[0,-1],[sideFirst,-1],[-sideFirst,-1],[sideFirst,0],[-sideFirst,0]];
    for(const [dx,dy] of dirs){
      const nx=g.x+dx, ny=g.y+dy;
      if(ny<0){ clearGasCell(g.x,g.y,getTile,setTile); return true; }
      if(ny>=WORLD_H) continue;
      const dst=getSafe(getTile,nx,ny,T.AIR);
      if(tryMoveGasThroughDynamo(g,nx,ny,dx,dy,getTile,setTile)) return true;
      if(swapGasCells(g,nx,ny,dst,getTile,setTile)) return true;
      if(!canReplaceWithGas(g.t,dst)) continue;
      const oldKey=key(g.x,g.y);
      const newKey=key(nx,ny);
      if(typeof setTile==='function'){
        setGasTile(g.x,g.y,T.AIR,setTile);
        setGasTile(nx,ny,g.t,setTile);
      }
      active.delete(oldKey);
      g.x=nx; g.y=ny; g.moveT=moveDelay(g.t,nx,ny); g._frame=frameSeq;
      active.set(newKey,g);
      return true;
    }
    return false;
  }
  function scanNearby(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const left=cx-SCAN_RX, right=cx+SCAN_RX;
    const top=Math.max(0,cy-SCAN_RY), bottom=Math.min(WORLD_H-1,cy+SCAN_RY);
    for(let x=left; x<=right; x++){
      for(let y=top; y<=bottom; y++){
        const t=getSafe(getTile,x,y,T.AIR);
        if(isGasTile(t)) noteGas(x,y,t);
      }
    }
  }
  function pruneInvalid(getTile){
    for(const [k,g] of active){
      const t=getSafe(getTile,g.x,g.y,T.AIR);
      if(t!==g.t){
        active.delete(k);
        if(isGasTile(t)) noteGas(g.x,g.y,t);
      }
    }
  }
  function auditChunks(chunks,getTile){
    if(typeof getTile!=='function') return 0;
    let found=0;
    if(Array.isArray(chunks)){
      for(const cxRaw of chunks){
        if(!Number.isFinite(cxRaw)) continue;
        const cx=Math.floor(cxRaw);
        const left=cx*CHUNK_W;
        for(let x=left; x<left+CHUNK_W; x++){
          for(let y=0; y<WORLD_H; y++){
            const t=getSafe(getTile,x,y,T.AIR);
            if(isGasTile(t)){ if(noteGas(x,y,t)) found++; }
          }
        }
      }
    }
    pruneInvalid(getTile);
    return found;
  }
  function add(kind,x,y,opts){
    opts=opts||{};
    const tile=tileFor(kind);
    const getTile=opts.getTile || (MM.world && MM.world.getTile);
    const setTile=opts.setTile || (MM.world && MM.world.setTile);
    if(typeof getTile!=='function' || typeof setTile!=='function') return 0;
    const power=Math.max(0.15, Math.min(5, Number.isFinite(opts.power)?opts.power:(opts.intensity||1)));
    const target=Math.max(1, Math.min(opts.cells||12, Math.round(1+power*2.2)));
    const bx=Math.floor(x), by=Math.floor(y);
    let placed=0;
    for(const [dx,dy] of SPAWN_OFFSETS){
      if(placed>=target) break;
      const tx=bx+dx, ty=by+dy;
      if(!finiteTile(tx,ty)) continue;
      const cur=getSafe(getTile,tx,ty,T.AIR);
      if(cur===tile){ noteGas(tx,ty,tile,{age:0,setTile}); placed++; continue; }
      if(!canReplaceWithGas(tile,cur)) continue;
      if(cur===T.HOT_AIR) active.delete(key(tx,ty));
      setGasTile(tx,ty,tile,setTile);
      noteGas(tx,ty,tile,{age:0,moveT:moveDelay(tile,tx,ty)*0.35,setTile});
      placed++;
    }
    return placed;
  }
  function gasAt(x,y,getTile){
    const t=getSafe(getTile || (MM.world && MM.world.getTile),Math.floor(x),Math.floor(y),T.AIR);
    return isGasTile(t) ? gasKind(t) : null;
  }
  function update(dt,getTile,setTile,player){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function' || typeof setTile!=='function') return;
    dt=Math.min(2,dt);
    frameSeq++;
    pruneCondensate(dt);
    if(heroPoisonCd>0) heroPoisonCd=Math.max(0,heroPoisonCd-dt);
    scanAcc+=dt;
    if(scanAcc>=SCAN_INTERVAL){
      scanAcc=0;
      scanNearby(player || (typeof window!=='undefined'?window.player:null),getTile);
      pruneInvalid(getTile);
    }
    let budget=gasMoveBudget();
    for(const [k,g] of active){
      if(!g || g._frame===frameSeq) continue;
      g._frame=frameSeq;
      const cur=getSafe(getTile,g.x,g.y,T.AIR);
      if(cur!==g.t){
        active.delete(k);
        if(isGasTile(cur)) noteGas(g.x,g.y,cur);
        continue;
      }
      g.age=(g.age||0)+dt;
      const def=gasDef(g.t);
      if(def && def.ttl && g.age>=def.ttl){ expireGas(g,getTile,setTile); continue; }
      if(g.t===T.POISON_GAS) updatePoison(g,dt,player);
      if(g.t===T.FUEL_GAS){
        g.reactT=(g.reactT||0)-dt;
        if(g.reactT<=0){
          g.reactT=0.18+rand01(g.x,g.y,89)*0.18;
          if(fuelTouchesIgnition(g,getTile)){ explodeFuelAt(g.x,g.y,getTile,setTile); continue; }
        }
      }
      g.moveT=(g.moveT||0)-dt;
      if(g.moveT<=0){
        if(budget--<=0){ g.moveT=0.035; continue; }
        if(!moveGas(g,getTile,setTile)) g.moveT=moveDelay(g.t,g.x,g.y)*1.15;
      }
    }
  }
  function buildSprites(TILE){
    spriteTile=TILE;
    sprites={};
    const rgba=(hex,a)=>{
      if(typeof hex!=='string' || hex[0]!=='#' || hex.length!==7) return 'rgba(220,230,230,'+a+')';
      const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
      return 'rgba('+r+','+g+','+b+','+a+')';
    };
    for(const [tile,def] of Object.entries(GAS_DEF)){
      const S=40;
      const c=document.createElement('canvas');
      c.width=c.height=S*2;
      const g=c.getContext('2d');
      const gr=g.createRadialGradient(S,S,1,S,S,S);
      const alpha=def.alpha || 0.35;
      gr.addColorStop(0, rgba(def.color,alpha));
      gr.addColorStop(0.45, rgba(def.color,alpha*0.58));
      gr.addColorStop(1, rgba(def.color,0));
      g.fillStyle=gr;
      g.beginPath(); g.arc(S,S,S,0,Math.PI*2); g.fill();
      sprites[tile]=c;
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile){
    if(!active.size) return;
    if(spriteTile!==TILE || !sprites) buildSprites(TILE);
    const visibleTile=typeof canDrawTile==='function' ? canDrawTile : null;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    ctx.save();
    ctx.globalCompositeOperation='source-over';
    for(const g of active.values()){
      if(g.x<sx-2 || g.x>sx+viewX+3 || g.y<sy-3 || g.y>sy+viewY+3) continue;
      if(visibleTile && !visibleTile(g.x,g.y)) continue;
      const def=gasDef(g.t);
      const sp=sprites[g.t];
      if(!def || !sp) continue;
      const rawLife=def.ttl ? Math.max(0, Math.min(1, 1-(g.age||0)/def.ttl)) : 1;
      const life=(g.t===T.STEAM || g.t===T.HOT_AIR) ? rawLife : Math.max(0.18, rawLife);
      if(life<=0.015) continue;
      const pulse=0.92+0.08*Math.sin(now*0.004+g.x*1.7+g.y*0.9);
      const r=TILE*(0.64+0.22*pulse)*(g.t===T.STEAM?1.10:1);
      ctx.globalAlpha=life*(0.82+0.18*pulse);
      ctx.drawImage(sp,(g.x+0.5)*TILE-r,(g.y+0.5)*TILE-r,r*2,r*2);
      if(g.t===T.FUEL_GAS && ((hash32(g.x,g.y,Math.floor(now/240))&7)===0)){
        ctx.globalAlpha=0.18*life;
        ctx.fillStyle='#fff0a8';
        ctx.fillRect(g.x*TILE+TILE*0.35,g.y*TILE+TILE*0.35,Math.max(1,TILE*0.14),Math.max(1,TILE*0.14));
      }
    }
    ctx.globalAlpha=1;
    ctx.restore();
  }
  function snapshot(){
    const list=[...active.values()]
      .filter(g=>g && finiteTile(g.x,g.y) && isGasTile(g.t))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .map(g=>({
        x:Math.floor(g.x),
        y:Math.floor(g.y),
        t:g.t,
        age:+Math.max(0,Number.isFinite(g.age)?g.age:0).toFixed(3),
        moveT:+Math.max(0,Number.isFinite(g.moveT)?g.moveT:0).toFixed(3)
      }));
    const condensateList=[...condensate.values()]
      .filter(c=>c && c.n>0 && finiteTile(c.x,c.y))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .map(c=>({x:c.x,y:c.y,n:Math.max(1,Math.min(50,Math.floor(c.n||0))),age:+Math.max(0,Number.isFinite(c.age)?c.age:0).toFixed(3)}));
    return {v:2,list,condensate:condensateList};
  }
  function restore(data,getTile,setTile){
    reset();
    if(data && Array.isArray(data.condensate)){
      for(const c of data.condensate){
        if(condensate.size>=CONDENSATE_CAP) break;
        if(!c || !finiteTile(c.x,c.y) || !Number.isFinite(c.n)) continue;
        const b=condensateBucketFor(c.x,c.y);
        const n=Math.max(0,Math.min(50,Math.floor(c.n)));
        const age=Number.isFinite(c.age) ? Math.max(0,Math.min(CONDENSATE_TTL,c.age)) : 0;
        if(n>0) condensate.set(b.k,{x:b.x,y:b.y,n,age});
      }
    }
    if(!data || !Array.isArray(data.list)) return;
    for(const g of data.list){
      if(!g || !finiteTile(g.x,g.y) || !isGasTile(g.t)) continue;
      const x=Math.floor(g.x), y=Math.floor(g.y);
      const cur=getSafe(getTile,x,y,T.AIR);
      if(cur!==g.t){
        if(!canReplaceWithGas(g.t,cur) || typeof setTile!=='function') continue;
        if(!setGasTile(x,y,g.t,setTile)) continue;
      }
      noteGas(x,y,g.t,{
        age:Number.isFinite(g.age)?Math.max(0,g.age):0,
        moveT:Number.isFinite(g.moveT)?Math.max(0,g.moveT):0,
        setTile
      });
    }
  }
  function reset(){
    active.clear();
    condensate.clear();
    scanAcc=0;
    turbineFlowSeq=0;
    heroPoisonCd=0;
  }
  function metrics(){
    let hot=0, steam=0, poison=0, fuel=0;
    for(const g of active.values()){
      if(g.t===T.HOT_AIR) hot++;
      else if(g.t===T.STEAM) steam++;
      else if(g.t===T.POISON_GAS) poison++;
      else if(g.t===T.FUEL_GAS) fuel++;
    }
    let steamCondensate=0;
    for(const c of condensate.values()) steamCondensate+=Math.max(0,Math.floor(c.n||0));
    return {active:active.size, hot, steam, poison, fuel, steamCondensate};
  }

  const api={update,draw,add,igniteAt,consumeRadius,gasAt,isGasTile,skyExposed,onTileChanged,auditChunks,snapshot,restore,reset,metrics,_debug:{active,condensate,GAS_DEF,KIND_TILE,STEAM_TO_WATER,DYNAMO_POWERED_GAS_LOSS_CHANCE,skyExposed}};
  MM.gases=api;
})();

export const gases = (typeof window!=='undefined' && window.MM) ? window.MM.gases : undefined;
export default gases;
