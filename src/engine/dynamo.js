// Dynamo machines: a 3-tile structure [casing | slot | casing], either
// horizontal or rotated vertically. Water falling down through a horizontal
// slot, sideways water pressure through a vertical slot, or steam/hot air
// rising up through a horizontal slot produce transient power plus accumulated
// energy for future machine systems. Other gases may vent through slots, but
// do not charge the machine.
import { T, WORLD_H } from '../constants.js';

(function(){
  window.MM = window.MM || {};

  const machines = new Map(); // "x,y" slot center -> {x,y,power,energy,pulse,lastKind}
  const MAX_POWER = 120;
  const ENERGY_CAPACITY = 100;
  const POWER_DECAY = 42;
  const PULSE_DECAY = 2.8;

  function key(x,y){ return (Math.floor(x))+','+(Math.floor(y)); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=0 && y<WORLD_H; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function isCasing(t){ return t===T.DYNAMO; }
  function isSlot(t){ return t===T.DYNAMO_SLOT; }
  function normalizeOrientation(orientation){
    return orientation==='vertical' || orientation==='v' ? 'vertical' : 'horizontal';
  }
  function plannedCells(cx,cy,orientation){
    cx=Math.floor(cx); cy=Math.floor(cy);
    if(normalizeOrientation(orientation)==='vertical'){
      return [
        {x:cx,y:cy-1,t:T.DYNAMO,role:'top'},
        {x:cx,y:cy,t:T.DYNAMO_SLOT,role:'slot'},
        {x:cx,y:cy+1,t:T.DYNAMO,role:'bottom'}
      ];
    }
    return [
      {x:cx-1,y:cy,t:T.DYNAMO,role:'left'},
      {x:cx,y:cy,t:T.DYNAMO_SLOT,role:'slot'},
      {x:cx+1,y:cy,t:T.DYNAMO,role:'right'}
    ];
  }
  function horizontalSlotValid(x,y,getTile){
    return getSafe(getTile,x-1,y,T.AIR)===T.DYNAMO && getSafe(getTile,x+1,y,T.AIR)===T.DYNAMO;
  }
  function verticalSlotValid(x,y,getTile){
    return getSafe(getTile,x,y-1,T.AIR)===T.DYNAMO && getSafe(getTile,x,y+1,T.AIR)===T.DYNAMO;
  }
  function slotOrientation(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.DYNAMO_SLOT) return null;
    const h=horizontalSlotValid(x,y,getTile);
    const v=verticalSlotValid(x,y,getTile);
    if(h && v) return 'both';
    if(h) return 'horizontal';
    if(v) return 'vertical';
    return null;
  }
  function isValidSlot(x,y,getTile,orientation){
    x=Math.floor(x); y=Math.floor(y);
    if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.DYNAMO_SLOT) return false;
    if(orientation==='horizontal' || orientation==='h') return horizontalSlotValid(x,y,getTile);
    if(orientation==='vertical' || orientation==='v') return verticalSlotValid(x,y,getTile);
    return horizontalSlotValid(x,y,getTile) || verticalSlotValid(x,y,getTile);
  }
  function slotCenterFor(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    const candidates=[
      {x,y},
      {x:x-1,y},
      {x:x+1,y},
      {x,y:y-1},
      {x,y:y+1}
    ];
    for(const c of candidates){
      if(slotOrientation(c.x,c.y,getTile)) return c;
    }
    return null;
  }
  function structureCellsAt(x,y,getTile){
    const c=slotCenterFor(x,y,getTile);
    if(c){
      const orientation=slotOrientation(c.x,c.y,getTile);
      const orientations=orientation==='both' ? ['horizontal','vertical'] : [orientation];
      const seen=new Set();
      const cells=[];
      for(const o of orientations){
        plannedCells(c.x,c.y,o).forEach(cell=>{
          const t=getSafe(getTile,cell.x,cell.y,T.AIR);
          if(t!==T.DYNAMO && t!==T.DYNAMO_SLOT) return;
          const k=key(cell.x,cell.y);
          if(seen.has(k)) return;
          seen.add(k);
          cells.push(cell);
        });
      }
      if(cells.length) return cells;
    }
    const t=getSafe(getTile,x,y,T.AIR);
    if(t===T.DYNAMO || t===T.DYNAMO_SLOT) return [{x:Math.floor(x),y:Math.floor(y),t,role:'orphan'}];
    return [];
  }
  function sourcePower(medium){
    if(medium===T.WATER || medium==='water') return {kind:'water', gain:1.0};
    if(medium===T.STEAM || medium==='steam') return {kind:'steam', gain:0.72};
    if(medium===T.HOT_AIR || medium==='hot' || medium==='hot_air') return {kind:'hot', gain:0.42};
    return null;
  }
  function normalizeMachine(m){
    if(!m) return null;
    m.power=Math.max(0,Math.min(MAX_POWER,Number(m.power)||0));
    m.energy=Math.max(0,Math.min(ENERGY_CAPACITY,Number(m.energy)||0));
    m.pulse=Math.max(0,Math.min(1,Number(m.pulse)||0));
    if(typeof m.lastKind!=='string') m.lastKind='';
    return m;
  }
  function ensureMachine(x,y,getTile,kind){
    x=Math.floor(x); y=Math.floor(y);
    if(!isValidSlot(x,y,getTile || (MM.world && MM.world.getTile))) return null;
    const k=key(x,y);
    let m=machines.get(k);
    if(!m){
      m={x,y,power:0,energy:0,pulse:0,lastKind:kind||''};
      machines.set(k,m);
    } else {
      m.x=x; m.y=y;
      if(kind) m.lastKind=kind;
    }
    return normalizeMachine(m);
  }
  function recordFlow(x,y,medium,amount,getTile){
    x=Math.floor(x); y=Math.floor(y);
    if(!isValidSlot(x,y,getTile || (MM.world && MM.world.getTile))) return false;
    const src=sourcePower(medium);
    if(!src) return false;
    const m=ensureMachine(x,y,getTile,src.kind);
    if(!m) return false;
    const gain=src.gain*Math.max(0.25, Math.min(4, Number.isFinite(amount)?amount:1));
    m.power=Math.min(MAX_POWER, (m.power||0)+gain*18);
    m.energy=Math.min(ENERGY_CAPACITY, Math.max(0, (m.energy||0)+gain));
    m.pulse=1;
    m.lastKind=src.kind;
    return true;
  }
  function absorbNear(px,py,amount,getTile,radius){
    if(!machines.size) return null;
    if(!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const maxTake=Math.max(0, Math.min(80, Number(amount)||0));
    if(maxTake<=0) return null;
    const r=Math.max(0.8, Math.min(8, Number(radius)||2.5));
    const r2=r*r;
    let best=null, bestScore=-Infinity;
    for(const [k,m] of machines){
      if(!m || (m.energy||0)<=0.0001){
        if(m && !isValidSlot(m.x,m.y,getTile || (MM.world && MM.world.getTile))) machines.delete(k);
        continue;
      }
      if(!isValidSlot(m.x,m.y,getTile || (MM.world && MM.world.getTile))){
        machines.delete(k);
        continue;
      }
      const cx=m.x+0.5, cy=m.y+0.5;
      const dx=cx-px, dy=cy-py;
      const d2=dx*dx+dy*dy;
      if(d2>r2) continue;
      const score=(m.power||0)*0.02 + Math.min(25,m.energy||0) - d2*1.8;
      if(score>bestScore){ best=m; bestScore=score; }
    }
    if(!best) return null;
    const take=Math.min(maxTake, Math.max(0,best.energy||0));
    if(take<=0) return null;
    best.energy=Math.max(0,(best.energy||0)-take);
    best.power=Math.min(MAX_POWER, Math.max(best.power||0, 24 + take*20));
    best.pulse=1;
    return {
      amount:take,
      x:best.x,
      y:best.y,
      power:best.power||0,
      energy:best.energy||0,
      lastKind:best.lastKind||''
    };
  }
  function machineAt(x,y,getTile){
    const gt=getTile || (MM.world && MM.world.getTile);
    const c=slotCenterFor(x,y,gt);
    if(!c || !isValidSlot(c.x,c.y,gt)) return null;
    return ensureMachine(c.x,c.y,gt);
  }
  function energyAt(x,y,getTile){
    const m=machineAt(x,y,getTile);
    return m ? Math.max(0,m.energy||0) : 0;
  }
  function drainAt(x,y,amount,getTile){
    const maxTake=Math.max(0,Math.min(ENERGY_CAPACITY,Number(amount)||0));
    if(maxTake<=0) return null;
    const m=machineAt(x,y,getTile);
    if(!m || (m.energy||0)<=0) return null;
    const take=Math.min(maxTake,Math.max(0,m.energy||0));
    if(take<=0) return null;
    m.energy=Math.max(0,(m.energy||0)-take);
    m.power=Math.min(MAX_POWER,Math.max(m.power||0,18+take*8));
    m.pulse=1;
    return {
      amount:take,
      x:m.x,
      y:m.y,
      power:m.power||0,
      energy:m.energy||0,
      lastKind:m.lastKind||''
    };
  }
  function onTileChanged(x,y,oldTile,newTile){
    if(oldTile===newTile) return;
    if(oldTile!==T.DYNAMO && oldTile!==T.DYNAMO_SLOT && newTile!==T.DYNAMO && newTile!==T.DYNAMO_SLOT) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    const candidates=[[0,0],[-1,0],[1,0],[0,-1],[0,1]];
    for(const [dx,dy] of candidates){
      const k=key(tx+dx,ty+dy);
      const m=machines.get(k);
      if(isValidSlot(tx+dx,ty+dy,MM.world && MM.world.getTile)) ensureMachine(tx+dx,ty+dy,MM.world && MM.world.getTile);
      else if(m && !isValidSlot(m.x,m.y,MM.world && MM.world.getTile)) machines.delete(k);
    }
  }
  function update(dt,getTile){
    if(!(dt>0) || !isFinite(dt)) return;
    for(const [k,m] of machines){
      if(!m || !finiteTile(m.x,m.y) || !isValidSlot(m.x,m.y,getTile)){
        machines.delete(k);
        continue;
      }
      normalizeMachine(m);
      m.power=Math.max(0, (m.power||0)-POWER_DECAY*dt);
      m.pulse=Math.max(0, (m.pulse||0)-PULSE_DECAY*dt);
    }
  }
  function ensureVisibleMachines(sx,sy,viewX,viewY,getTile){
    if(typeof getTile!=='function') return;
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(0,Math.floor(sy)-2), y1=Math.min(WORLD_H-1,Math.ceil(sy+viewY)+2);
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(getSafe(getTile,x,y,T.AIR)===T.DYNAMO_SLOT) ensureMachine(x,y,getTile);
      }
    }
  }
  function drawBatteryLines(ctx,TILE,px,py,charge,pulse){
    const lineW=TILE*0.46;
    const x=px+TILE*0.27;
    const baseY=py+TILE*0.72;
    const gap=TILE*0.13;
    const h=Math.max(1,TILE*0.035);
    const fillBase=pulse>0 ? '#fff07c' : '#67d7ff';
    for(let i=0; i<4; i++){
      const y=baseY-i*gap;
      ctx.fillStyle='rgba(4,8,14,0.72)';
      ctx.fillRect(x,y,lineW,h);
      const f=Math.max(0,Math.min(1,charge*4-i));
      if(f>0){
        const alpha=0.55+0.35*f+0.10*Math.max(0,Math.min(1,pulse||0));
        ctx.fillStyle=fillBase;
        ctx.globalAlpha=Math.min(1,alpha);
        ctx.fillRect(x,y,Math.max(1,lineW*f),h);
        ctx.globalAlpha=1;
      }
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile){
    if(!ctx) return;
    ensureVisibleMachines(sx,sy,viewX,viewY,getTile);
    if(!machines.size) return;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    ctx.save();
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    for(const m of machines.values()){
      if(!m) continue;
      if(m.x<sx-2 || m.x>sx+viewX+2 || m.y<sy-2 || m.y>sy+viewY+2) continue;
      if(visible && !visible(m.x,m.y)) continue;
      if(getTile && !isValidSlot(m.x,m.y,getTile)) continue;
      const p=Math.max(0, Math.min(1, (m.power||0)/MAX_POWER));
      const charge=Math.max(0, Math.min(1, (m.energy||0)/ENERGY_CAPACITY));
      const px=m.x*TILE, py=m.y*TILE;
      const glow=0.18+0.35*p+0.20*(m.pulse||0);
      ctx.fillStyle='rgba(84, 204, 255, '+glow.toFixed(3)+')';
      ctx.fillRect(px+TILE*0.18,py+TILE*0.20,TILE*0.64,TILE*0.60);
      ctx.strokeStyle='rgba(255,230,92,'+(0.45+0.45*p).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,TILE*0.08);
      ctx.strokeRect(px+TILE*0.16,py+TILE*0.16,TILE*0.68,TILE*0.68);
      drawBatteryLines(ctx,TILE,px,py,charge,m.pulse||0);
      const bw=TILE*2.2, bh=Math.max(4,TILE*0.18);
      const bx=px+TILE*0.5-bw*0.5, by=py-TILE*0.42;
      if((m.power||0)>0.05){
        ctx.fillStyle='rgba(6,10,16,0.72)';
        ctx.fillRect(bx,by,bw,bh);
        ctx.fillStyle=m.lastKind==='water'?'#49a8ff':(m.lastKind==='steam'?'#dfe8ee':'#f4b65e');
        ctx.fillRect(bx,by,Math.max(1,bw*p),bh);
        ctx.font='bold '+Math.max(8,Math.round(TILE*0.42))+'px system-ui';
        ctx.fillStyle='rgba(255,255,255,0.92)';
        ctx.fillText(Math.round(m.power||0)+' E/s', px+TILE*0.5, by-TILE*0.34);
      }
    }
    ctx.restore();
  }
  function snapshot(){
    const list=[...machines.values()]
      .filter(m=>m && finiteTile(m.x,m.y) && ((m.energy||0)>0 || (m.power||0)>0))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .map(m=>({x:m.x,y:m.y,power:+(m.power||0).toFixed(2),energy:+(m.energy||0).toFixed(3),lastKind:m.lastKind||''}));
    return {v:1,list};
  }
  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(getTile && !isValidSlot(x,y,getTile)) continue;
      machines.set(key(x,y),{
        x,y,
        power:Math.max(0,Math.min(MAX_POWER,Number(raw.power)||0)),
        energy:Math.max(0,Math.min(ENERGY_CAPACITY,Number(raw.energy)||0)),
        pulse:0,
        lastKind:typeof raw.lastKind==='string'?raw.lastKind:''
      });
    }
  }
  function reset(){ machines.clear(); }
  function metrics(){
    let currentPower=0, storedEnergy=0, active=0;
    for(const m of machines.values()){
      currentPower+=Math.max(0,m.power||0);
      storedEnergy+=Math.max(0,m.energy||0);
      if((m.power||0)>0.05) active++;
    }
    return {machines:machines.size, active, currentPower:+currentPower.toFixed(2), storedEnergy:+storedEnergy.toFixed(2)};
  }

  const api={isCasing,isSlot,isValidSlot,slotOrientation,plannedCells,structureCellsAt,recordFlow,absorbNear,energyAt,drainAt,onTileChanged,update,draw,snapshot,restore,reset,metrics,_debug:{machines,MAX_POWER,ENERGY_CAPACITY}};
  MM.dynamo=api;
})();

export const dynamo = (typeof window!=='undefined' && window.MM) ? window.MM.dynamo : undefined;
export default dynamo;
