import { T, WORLD_H, CHUNK_W } from '../constants.js';
import { isGasTile, isMeatDecayMaterial, isObjectFootingTile, isReplaceableNaturalOpenTile } from './material_physics.js';

window.MM = window.MM || {};

const meat = (function(){
  const DECAY_SEC = 60;
  const ROTTEN_VANISH_SEC = 60;
  const ROTTEN_GAS_INTERVAL = 10;
  const SCAN_INTERVAL = 1.0;
  const SCAN_RX = 72;
  const SCAN_RY = 46;
  const MAX_RECORDS = 900;
  const HOT_AIR_COOK_CELLS = 5;
  const HEAT_NEIGHBORS = Object.freeze([[0,-1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[1,1],[-1,1]]);
  const HOT_AIR_ABSORB_OFFSETS = Object.freeze((()=>{
    const out=[];
    for(let dy=-2; dy<=2; dy++){
      for(let dx=-2; dx<=2; dx++){
        if(dx===0 && dy===0) continue;
        out.push([dx,dy,dx*dx+dy*dy]);
      }
    }
    out.sort((a,b)=>a[2]-b[2]);
    return out.map(([dx,dy])=>[dx,dy]);
  })());
  const records = new Map();
  let scanAcc = 0;

  const key = (x,y)=>x+','+y;
  const finiteTile = (x,y)=>Number.isFinite(x) && Number.isFinite(y) && y>=0 && y<WORLD_H;
  const isMeatTile = t=>isMeatDecayMaterial(t);
  const canOccupy = t=>isReplaceableNaturalOpenTile(t,false);
  function getSafe(getTile,x,y){ try{ return getTile ? getTile(x,y) : T.AIR; }catch(e){ return T.AIR; } }
  function supportedBy(t){
    return isObjectFootingTile(t);
  }
  function nextGasDelay(){ return ROTTEN_GAS_INTERVAL; }

  function noteMeat(x,y,opts){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y)) return false;
    const k=key(x,y);
    const cur=records.get(k) || {x,y,age:0,rotAge:0,gasT:nextGasDelay()};
    if(opts && typeof opts.age==='number' && isFinite(opts.age)) cur.age=Math.max(0,Math.min(DECAY_SEC,opts.age));
    if(opts && typeof opts.rotAge==='number' && isFinite(opts.rotAge)) cur.rotAge=Math.max(0,Math.min(ROTTEN_VANISH_SEC,opts.rotAge));
    if(opts && typeof opts.gasT==='number' && isFinite(opts.gasT)) cur.gasT=Math.max(0,opts.gasT);
    records.set(k,cur);
    return true;
  }

  function removeMeat(x,y){ records.delete(key(Math.floor(x),Math.floor(y))); }
  function onTileChanged(x,y,oldTile,newTile){
    if(isMeatTile(newTile)){
      noteMeat(x,y,{
        age:newTile===T.ROTTEN_MEAT ? DECAY_SEC : 0,
        rotAge:0,
        gasT:nextGasDelay()
      });
    } else if(isMeatTile(oldTile)){
      removeMeat(x,y);
    }
  }

  function findDropSpot(m,getTile){
    if(!m || typeof getTile!=='function') return null;
    const baseX=Math.floor(m.x);
    const baseY=Math.max(0,Math.min(WORLD_H-2,Math.floor(m.y)));
    if(canOccupy(getSafe(getTile,baseX,baseY))) return {x:baseX,y:baseY};
    const offsets=[0,-1,1,-2,2,-3,3,-4,4];
    const starts=[baseY,baseY-1,baseY+1];
    for(const dx of offsets){
      const x=baseX+dx;
      for(const syRaw of starts){
        const sy=Math.max(0,Math.min(WORLD_H-2,syRaw));
        const here=getSafe(getTile,x,sy);
        if(canOccupy(here) && supportedBy(getSafe(getTile,x,sy+1))) return {x,y:sy};
      }
    }
    for(const dx of offsets){
      const x=baseX+dx;
      const maxY=WORLD_H-2;
      for(let y=baseY; y<=maxY; y++){
        const here=getSafe(getTile,x,y);
        if(canOccupy(here) && supportedBy(getSafe(getTile,x,y+1))) return {x,y};
      }
    }
    for(const dx of offsets){
      const x=baseX+dx;
      for(let dy=-2; dy<=2; dy++){
        const y=Math.max(0,Math.min(WORLD_H-2,baseY+dy));
        if(canOccupy(getSafe(getTile,x,y))) return {x,y};
      }
    }
    return null;
  }

  function displaceWater(x,y,getTile,setTile){
    try{ if(MM.water && MM.water.displaceAt) MM.water.displaceAt(x,y,getTile,setTile); }catch(e){}
  }
  function notifyTileRemoved(x,y,getTile){
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
  }
  function notifyTileChanged(x,y,getTile){
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement) MM.fallingSolids.afterPlacement(x,y); }catch(e){}
  }
  function clearHotAirCell(x,y,setTile){
    if(typeof setTile!=='function') return false;
    try{
      if(typeof setTile.transient==='function') setTile.transient(x,y,T.AIR);
      else setTile(x,y,T.AIR);
      return true;
    }catch(e){ return false; }
  }
  function directHeatAt(x,y,getTile){
    try{ if(MM.fire && MM.fire.isBurning && MM.fire.isBurning(x,y)) return true; }catch(e){}
    for(const [dx,dy] of HEAT_NEIGHBORS){
      const hx=x+dx, hy=y+dy;
      const t=getSafe(getTile,hx,hy,T.AIR);
      if(t===T.LAVA || t===T.TORCH) return true;
      try{ if(MM.fire && MM.fire.isBurning && MM.fire.isBurning(hx,hy)) return true; }catch(e){}
    }
    return false;
  }
  function absorbHotAirForCooking(x,y,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    const cells=[];
    for(const [dx,dy] of HOT_AIR_ABSORB_OFFSETS){
      const hx=x+dx, hy=y+dy;
      if(getSafe(getTile,hx,hy,T.AIR)===T.HOT_AIR) cells.push({x:hx,y:hy});
      if(cells.length>=HOT_AIR_COOK_CELLS) break;
    }
    if(cells.length<HOT_AIR_COOK_CELLS) return false;
    for(const c of cells) clearHotAirCell(c.x,c.y,setTile);
    return true;
  }
  function cookMeatRecord(k,r,getTile,setTile,reason){
    if(!r || typeof setTile!=='function') return false;
    if(getSafe(getTile,r.x,r.y,T.AIR)!==T.MEAT) return false;
    try{ if(MM.fire && MM.fire.extinguish) MM.fire.extinguish(r.x,r.y); }catch(e){}
    setTile(r.x,r.y,T.BAKED_MEAT);
    settleLooseFoodTile(r.x,r.y,T.BAKED_MEAT,getTile,setTile);
    records.delete(k);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((r.x+0.5)*(MM.TILE||20),(r.y+0.5)*(MM.TILE||20),reason==='hot-air'?'rare':'common'); }catch(e){}
    return true;
  }
  function cookFromEnvironment(k,r,getTile,setTile){
    if(!r || getSafe(getTile,r.x,r.y,T.AIR)!==T.MEAT) return false;
    if(directHeatAt(r.x,r.y,getTile)) return cookMeatRecord(k,r,getTile,setTile,'direct');
    if(absorbHotAirForCooking(r.x,r.y,getTile,setTile)) return cookMeatRecord(k,r,getTile,setTile,'hot-air');
    return false;
  }

  function dropFromMob(m,getTile,setTile){
    getTile = getTile || (MM.world && MM.world.getTile);
    setTile = setTile || (MM.world && MM.world.setTile);
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    const spot=findDropSpot(m,getTile);
    if(!spot) return false;
    const was=getSafe(getTile,spot.x,spot.y);
    if(was===T.WATER) displaceWater(spot.x,spot.y,getTile,setTile);
    setTile(spot.x,spot.y,T.MEAT);
    noteMeat(spot.x,spot.y,{age:0,gasT:nextGasDelay()});
    notifyTileChanged(spot.x,spot.y,getTile);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((spot.x+0.5)*(MM.TILE||20),(spot.y+0.5)*(MM.TILE||20),'hit'); }catch(e){}
    return true;
  }

  function dropY(x,y,getTile){
    let yy=Math.max(0,Math.min(WORLD_H-2,Math.floor(y)));
    while(yy<WORLD_H-2 && canOccupy(getSafe(getTile,x,yy+1))) yy++;
    return yy;
  }
  function rollDepth(x,y,getTile){
    const end=dropY(x,y,getTile);
    return Math.max(0,end-y);
  }
  function chooseRollDir(x,y,getTile,originX,step){
    if(y+1>=WORLD_H) return 0;
    const dirs=[];
    for(const dir of [-1,1]){
      if(canOccupy(getSafe(getTile,x+dir,y)) && canOccupy(getSafe(getTile,x+dir,y+1))){
        dirs.push({dir,depth:rollDepth(x+dir,y+1,getTile)});
      }
    }
    if(!dirs.length) return 0;
    if(dirs.length===1) return dirs[0].dir;
    if(dirs[0].depth!==dirs[1].depth) return dirs[0].depth>dirs[1].depth ? dirs[0].dir : dirs[1].dir;
    return ((originX + y + step) & 1) ? 1 : -1;
  }
  function settleSpot(x,y,t,getTile){
    let sx=Math.floor(x);
    let sy=dropY(sx,y,getTile);
    const originX=sx;
    const limit=t===T.ROTTEN_MEAT ? 3 : 5;
    let guard=0;
    while(guard++<limit){
      const dir=chooseRollDir(sx,sy,getTile,originX,guard);
      if(!dir) break;
      sx+=dir;
      sy=dropY(sx,sy+1,getTile);
    }
    return {x:sx,y:sy};
  }
  function settleUnsupportedRecord(k,r,t,getTile,setTile){
    if(typeof setTile!=='function') return false;
    if(!canOccupy(getSafe(getTile,r.x,r.y+1))) return false;
    const dest=settleSpot(r.x,r.y,t,getTile);
    if(dest.x===r.x && dest.y===r.y) return false;
    if(!canOccupy(getSafe(getTile,dest.x,dest.y))) return false;
    setTile(r.x,r.y,T.AIR);
    notifyTileRemoved(r.x,r.y,getTile);
    const was=getSafe(getTile,dest.x,dest.y);
    if(was===T.WATER) displaceWater(dest.x,dest.y,getTile,setTile);
    setTile(dest.x,dest.y,t);
    records.delete(k);
    r.x=dest.x; r.y=dest.y;
    records.set(key(r.x,r.y),r);
    notifyTileChanged(r.x,r.y,getTile);
    return true;
  }

  function settleLooseFoodTile(x,y,t,getTile,setTile){
    if(typeof setTile!=='function') return false;
    if(!canOccupy(getSafe(getTile,x,y+1))) return false;
    const dest=settleSpot(x,y,t,getTile);
    if(dest.x===x && dest.y===y) return false;
    if(!canOccupy(getSafe(getTile,dest.x,dest.y))) return false;
    setTile(x,y,T.AIR);
    notifyTileRemoved(x,y,getTile);
    const was=getSafe(getTile,dest.x,dest.y);
    if(was===T.WATER) displaceWater(dest.x,dest.y,getTile,setTile);
    setTile(dest.x,dest.y,t);
    notifyTileChanged(dest.x,dest.y,getTile);
    return true;
  }

  function scanNearby(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const left=cx-SCAN_RX, right=cx+SCAN_RX;
    const top=Math.max(0,cy-SCAN_RY), bottom=Math.min(WORLD_H-1,cy+SCAN_RY);
    for(let x=left; x<=right; x++){
      for(let y=top; y<=bottom; y++){
        const t=getSafe(getTile,x,y);
        if(isMeatTile(t) && !records.has(key(x,y))) noteMeat(x,y,{age:t===T.ROTTEN_MEAT?DECAY_SEC:0,rotAge:0});
      }
    }
  }

  function pruneOverflow(player,getTile){
    if(records.size<=MAX_RECORDS) return;
    const px=player && Number.isFinite(player.x) ? player.x : 0;
    const py=player && Number.isFinite(player.y) ? player.y : 0;
    const ordered=[];
    for(const [k,r] of records){
      const t=getSafe(getTile,r.x,r.y);
      if(!isMeatTile(t)){ records.delete(k); continue; }
      const d=Math.abs(r.x-px)+Math.abs(r.y-py);
      ordered.push({k,d});
    }
    ordered.sort((a,b)=>b.d-a.d);
    for(let i=0; i<ordered.length && records.size>MAX_RECORDS*0.8; i++) records.delete(ordered[i].k);
  }

  function auditChunks(chunks,getTile){
    if(typeof getTile!=='function') return 0;
    let found=0;
    if(Array.isArray(chunks)){
      for(const cx of chunks){
        if(typeof cx!=='number' || !isFinite(cx)) continue;
        const left=Math.floor(cx)*CHUNK_W;
        for(let x=left; x<left+CHUNK_W; x++){
          for(let y=0; y<WORLD_H; y++){
            const t=getSafe(getTile,x,y);
            if(isMeatTile(t)){
              const k=key(x,y);
              if(!records.has(k)) noteMeat(x,y,{age:t===T.ROTTEN_MEAT?DECAY_SEC:0,rotAge:0});
              found++;
            }
          }
        }
      }
    }
    for(const [k,r] of records){
      const t=getSafe(getTile,r.x,r.y);
      if(!isMeatTile(t)) records.delete(k);
    }
    return found;
  }

  function emitGas(r,getTile,setTile){
    let placed=0;
    try{
      if(MM.gases && MM.gases.add){
        placed=MM.gases.add('poison',r.x+0.5,r.y+0.35,{power:0.25,cells:1,getTile,setTile})||0;
      }
    }catch(e){ placed=0; }
    if(!placed && typeof getTile==='function' && typeof setTile==='function'){
      const spots=[[0,-1],[-1,0],[1,0],[0,-2],[-1,-1],[1,-1]];
      for(const [dx,dy] of spots){
        const x=r.x+dx, y=r.y+dy;
        const old=getSafe(getTile,x,y);
        if(old!==T.AIR && !isGasTile(old)) continue;
        setTile(x,y,T.POISON_GAS);
        try{ if(MM.gases && MM.gases.onTileChanged) MM.gases.onTileChanged(x,y,old,T.POISON_GAS); }catch(e){}
        placed=1;
        break;
      }
    }
    try{ if(MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(r.x+0.5,r.y+0.5,1.8,{dur:3,dps:1.5}); }catch(e){}
    return placed;
  }

  function update(dt,player,getTile,setTile){
    if(!(dt>0) || !isFinite(dt)) return;
    dt=Math.min(5,dt);
    scanAcc+=dt;
    if(scanAcc>=SCAN_INTERVAL){
      scanAcc=0;
      scanNearby(player,getTile);
      pruneOverflow(player,getTile);
    }
    for(const [k,r] of [...records]){
      const t=getSafe(getTile,r.x,r.y);
      if(!isMeatTile(t)){ records.delete(k); continue; }
      if(t===T.MEAT && cookFromEnvironment(k,r,getTile,setTile)) continue;
      if(settleUnsupportedRecord(k,r,t,getTile,setTile)) continue;
      if(t===T.MEAT){
        if(getSafe(getTile,r.x,r.y+1)===T.SNOW) continue;
        r.age=(r.age||0)+dt;
        if(r.age>=DECAY_SEC && typeof setTile==='function'){
          setTile(r.x,r.y,T.ROTTEN_MEAT);
          r.age=DECAY_SEC;
          r.rotAge=0;
          r.gasT=nextGasDelay();
        }
      } else {
        r.age=DECAY_SEC;
        r.rotAge=(r.rotAge||0)+dt;
        if(r.rotAge>=ROTTEN_VANISH_SEC && typeof setTile==='function'){
          setTile(r.x,r.y,T.AIR);
          records.delete(k);
          notifyTileRemoved(r.x,r.y,getTile);
          continue;
        }
        r.gasT=(typeof r.gasT==='number' ? r.gasT : nextGasDelay())-dt;
        if(r.gasT<=0){
          emitGas(r,getTile,setTile);
          r.gasT=nextGasDelay();
        }
      }
    }
  }

  function snapshot(){
    const list=[...records.values()]
      .filter(r=>r && finiteTile(r.x,r.y))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MAX_RECORDS)
      .map(r=>({
        x:Math.floor(r.x),
        y:Math.floor(r.y),
        age:+Math.max(0,Math.min(DECAY_SEC,Number.isFinite(r.age)?r.age:0)).toFixed(3),
        rotAge:+Math.max(0,Math.min(ROTTEN_VANISH_SEC,Number.isFinite(r.rotAge)?r.rotAge:0)).toFixed(3),
        gasT:+Math.max(0,Number.isFinite(r.gasT)?r.gasT:nextGasDelay()).toFixed(3)
      }));
    return {
      v:1,
      list
    };
  }

  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    for(const r of data.list){
      if(records.size>=MAX_RECORDS) break;
      if(!r || !finiteTile(r.x,r.y)) continue;
      const t=getSafe(getTile,Math.floor(r.x),Math.floor(r.y));
      if(!isMeatTile(t)) continue;
      noteMeat(r.x,r.y,{age:r.age,rotAge:r.rotAge,gasT:r.gasT});
    }
  }

  function reset(){ records.clear(); scanAcc=0; }

  const api={update,dropFromMob,noteMeat,removeMeat,onTileChanged,auditChunks,snapshot,restore,reset,metrics:()=>({tracked:records.size,rottenGasInterval:ROTTEN_GAS_INTERVAL,rottenVanishSec:ROTTEN_VANISH_SEC}),_debug:{records,ROTTEN_GAS_INTERVAL,ROTTEN_VANISH_SEC}};
  MM.meat=api;
  return api;
})();

export { meat };
export default meat;
