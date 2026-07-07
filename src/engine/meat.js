import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, WORLD_SECTION_H, CHUNK_W } from '../constants.js';
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
  const PIRANHA_BAIT_SCAN_RADIUS = 18;
  const PIRANHA_BAIT_PROFILES = Object.freeze({
    [T.MEAT]: Object.freeze({kind:'raw', duration:12, priority:3}),
    [T.BAKED_MEAT]: Object.freeze({kind:'baked', duration:8, priority:2}),
    [T.ROTTEN_MEAT]: Object.freeze({kind:'rotten', duration:4, priority:1})
  });
  const WATER_TOUCH_OFFSETS = Object.freeze([[0,0],[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]);
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
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  const finiteTile = (x,y)=>Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM;
  const isMeatTile = t=>isMeatDecayMaterial(t);
  const canOccupy = t=>isReplaceableNaturalOpenTile(t,false);
  function clampY(y,topPad=0,bottomPad=0){
    const lo=WORLD_TOP+topPad;
    const hi=Math.max(lo,WORLD_BOTTOM-bottomPad);
    const n=Number(y);
    return Math.max(lo,Math.min(hi,Math.floor(Number.isFinite(n) ? n : lo)));
  }
  function getSafe(getTile,x,y){ try{ return getTile ? getTile(x,y) : T.AIR; }catch(e){ return T.AIR; } }
  function supportedBy(t){
    return isObjectFootingTile(t);
  }
  function nextGasDelay(){ return ROTTEN_GAS_INTERVAL; }
  function baitProfileForTile(t){ return PIRANHA_BAIT_PROFILES[t] || null; }
  function isPiranhaBaitTile(t){ return !!baitProfileForTile(t); }
  function nearestTouchingWater(x,y,getTile){
    if(typeof getTile!=='function') return null;
    for(const [dx,dy] of WATER_TOUCH_OFFSETS){
      const wx=x+dx, wy=y+dy;
      if(getSafe(getTile,wx,wy,T.AIR)===T.WATER) return {x:wx+0.5,y:wy+0.5,tileX:wx,tileY:wy};
    }
    return null;
  }
  function nearestWaterBait(wx,wy,radius,getTile){
    if(typeof getTile!=='function' || !Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    const r=Math.floor(Math.max(1,Math.min(48,Number.isFinite(radius)?radius:PIRANHA_BAIT_SCAN_RADIUS)));
    const r2=r*r;
    const checked=new Set();
    let best=null;
    function consider(x,y){
      x=Math.floor(x); y=Math.floor(y);
      if(!finiteTile(x,y)) return;
      const k=key(x,y);
      if(checked.has(k)) return;
      checked.add(k);
      const t=getSafe(getTile,x,y,T.AIR);
      const profile=baitProfileForTile(t);
      if(!profile) return;
      const water=nearestTouchingWater(x,y,getTile);
      if(!water) return;
      const cx=x+0.5, cy=y+0.5;
      const dx=cx-wx, dy=cy-wy;
      const d2=dx*dx+dy*dy;
      if(d2>r2) return;
      if(!best || d2<best.d2-0.001 || (Math.abs(d2-best.d2)<=0.001 && profile.priority>best.priority)){
        best={
          kind:profile.kind,
          tile:t,
          tx:x,
          ty:y,
          x:cx,
          y:cy,
          waterX:water.x,
          waterY:water.y,
          waterTileX:water.tileX,
          waterTileY:water.tileY,
          duration:profile.duration,
          priority:profile.priority,
          d2
        };
      }
    }
    for(const rcd of records.values()){
      if(!rcd) continue;
      consider(rcd.x,rcd.y);
    }
    const cx=Math.floor(wx), cy=Math.floor(wy);
    for(let y=cy-r; y<=cy+r; y++){
      for(let x=cx-r; x<=cx+r; x++) consider(x,y);
    }
    return best;
  }
  function consumeBaitAt(x,y,getTile,setTile){
    x=Math.floor(x); y=Math.floor(y);
    if(typeof getTile!=='function' || typeof setTile!=='function' || !finiteTile(x,y)) return false;
    const t=getSafe(getTile,x,y,T.AIR);
    if(!isPiranhaBaitTile(t)) return false;
    setTile(x,y,T.AIR);
    removeMeat(x,y);
    notifyTileRemoved(x,y,getTile);
    return true;
  }

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
    const baseY=clampY(m.y,0,2);
    if(canOccupy(getSafe(getTile,baseX,baseY))) return {x:baseX,y:baseY};
    const offsets=[0,-1,1,-2,2,-3,3,-4,4];
    const starts=[baseY,baseY-1,baseY+1];
    for(const dx of offsets){
      const x=baseX+dx;
      for(const syRaw of starts){
        const sy=clampY(syRaw,0,2);
        const here=getSafe(getTile,x,sy);
        if(canOccupy(here) && supportedBy(getSafe(getTile,x,sy+1))) return {x,y:sy};
      }
    }
    for(const dx of offsets){
      const x=baseX+dx;
      const maxY=WORLD_BOTTOM-2;
      for(let y=baseY; y<=maxY; y++){
        const here=getSafe(getTile,x,y);
        if(canOccupy(here) && supportedBy(getSafe(getTile,x,y+1))) return {x,y};
      }
    }
    for(const dx of offsets){
      const x=baseX+dx;
      for(let dy=-2; dy<=2; dy++){
        const y=clampY(baseY+dy,0,2);
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
    let yy=clampY(y,0,2);
    while(yy<WORLD_BOTTOM-2 && canOccupy(getSafe(getTile,x,yy+1))) yy++;
    return yy;
  }
  function rollDepth(x,y,getTile){
    const end=dropY(x,y,getTile);
    return Math.max(0,end-y);
  }
  function chooseRollDir(x,y,getTile,originX,step){
    if(y+1>=WORLD_BOTTOM) return 0;
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
    const top=Math.max(WORLD_TOP,cy-SCAN_RY), bottom=Math.min(WORLD_BOTTOM-1,cy+SCAN_RY);
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
    function chunkScanRange(ref){
      if(typeof ref==='number' && isFinite(ref)) return {cx:Math.floor(ref),top:0,bottom:WORLD_H};
      if(!ref || !Number.isFinite(ref.cx)) return null;
      if(!Number.isFinite(ref.sy)) return {cx:Math.floor(ref.cx),top:0,bottom:WORLD_H};
      const sy=Math.floor(ref.sy);
      const top=Math.max(WORLD_TOP,sy*WORLD_SECTION_H);
      const bottom=Math.min(WORLD_BOTTOM,top+WORLD_SECTION_H);
      return bottom>top ? {cx:Math.floor(ref.cx),top,bottom} : null;
    }
    if(Array.isArray(chunks)){
      for(const ref of chunks){
        const range=chunkScanRange(ref);
        if(!range) continue;
        const left=range.cx*CHUNK_W;
        for(let x=left; x<left+CHUNK_W; x++){
          for(let y=range.top; y<range.bottom; y++){
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

  const api={update,dropFromMob,noteMeat,removeMeat,onTileChanged,auditChunks,snapshot,restore,reset,baitProfileForTile,nearestWaterBait,consumeBaitAt,metrics:()=>({tracked:records.size,rottenGasInterval:ROTTEN_GAS_INTERVAL,rottenVanishSec:ROTTEN_VANISH_SEC}),_debug:{records,ROTTEN_GAS_INTERVAL,ROTTEN_VANISH_SEC,PIRANHA_BAIT_PROFILES,nearestTouchingWater}};
  MM.meat=api;
  return api;
})();

export { meat };
export default meat;
