// Dynamo machines: a 3-tile structure [casing | slot | casing], either
// horizontal or rotated vertically. Water falling down through a horizontal
// slot, sideways water pressure through a vertical slot, or steam/hot air
// rising up through a horizontal slot produce transient power plus accumulated
// energy for future machine systems. Other gases may vent through slots, but
// do not charge the machine.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isWindExposureBlockerTile } from './material_physics.js';

(function(){
  window.MM = window.MM || {};

  const machines = new Map(); // "x,y" slot center -> {x,y,power,energy,pulse,rotorAngle,rotorSpeed,lastKind}
  const MAX_POWER = 120;
  const ENERGY_CAPACITY = 100;
  const POWER_DECAY = 42;
  const PULSE_DECAY = 2.8;
  const MACHINE_CAP = 1600;
  const WIND_MIN_SPEED = 2.75;
  const WIND_RATED_SPEED = 6.2;
  const WIND_MAX_ENERGY_PER_SEC = 0.062;
  const CATCHUP_MAX_SECONDS = 900;
  const VISIBLE_SCAN_INTERVAL_MS = 250;
  let visibleScanKey = '';
  let visibleScanAt = 0;
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  function key(x,y){ return (Math.floor(x))+','+(Math.floor(y)); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function isCasing(t){ return t===T.DYNAMO; }
  function isSlot(t){ return t===T.DYNAMO_SLOT; }
  function canWindPass(t){
    if(t===T.WATER || t===T.LAVA) return false;
    if(t===T.DYNAMO || t===T.DYNAMO_SLOT) return false;
    return !isWindExposureBlockerTile(t);
  }
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
    m.rotorAngle=Number.isFinite(m.rotorAngle) ? m.rotorAngle : 0;
    m.rotorSpeed=Math.max(0,Math.min(42,Number(m.rotorSpeed)||0));
    if(typeof m.lastKind!=='string') m.lastKind='';
    return m;
  }
  function kickRotor(m,amount){
    if(!m) return;
    const a=Math.max(0.04,Math.min(1.8,Number(amount)||0.2));
    m.rotorSpeed=Math.min(42,Math.max(Number(m.rotorSpeed)||0,4+a*10));
  }
  function ensureMachine(x,y,getTile,kind){
    x=Math.floor(x); y=Math.floor(y);
    if(!isValidSlot(x,y,getTile || (MM.world && MM.world.getTile))) return null;
    const k=key(x,y);
    let m=machines.get(k);
    if(!m){
      m={x,y,power:0,energy:0,pulse:0,rotorAngle:0,rotorSpeed:0,lastKind:kind||''};
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
    kickRotor(m,gain);
    return true;
  }
  function windSpeedForSlot(m,getTile){
    const W=(typeof window!=='undefined' && window.MM) ? MM.wind : null;
    if(!W || typeof W.speedAt!=='function') return 0;
    if(slotOrientation(m.x,m.y,getTile)!=='vertical') return 0;
    if(!canWindPass(getSafe(getTile,m.x-1,m.y,T.STONE))) return 0;
    if(!canWindPass(getSafe(getTile,m.x+1,m.y,T.STONE))) return 0;
    let left=0, right=0;
    try{ left=W.speedAt(m.x-1,m.y,getTile); }catch(e){ left=0; }
    try{ right=W.speedAt(m.x+1,m.y,getTile); }catch(e){ right=0; }
    return (Math.abs(left)+Math.abs(right))*0.5;
  }
  function recordWindPower(m,dt,getTile){
    const sp=windSpeedForSlot(m,getTile);
    if(sp<WIND_MIN_SPEED) return false;
    const k=Math.max(0,Math.min(1,(sp-WIND_MIN_SPEED)/(WIND_RATED_SPEED-WIND_MIN_SPEED)));
    const energyPerSec=WIND_MAX_ENERGY_PER_SEC*k*k;
    if(energyPerSec<=0.0001) return false;
    m.power=Math.min(MAX_POWER, Math.max(m.power||0, energyPerSec*62));
    m.energy=Math.min(ENERGY_CAPACITY, Math.max(0, (m.energy||0)+energyPerSec*dt));
    m.pulse=Math.max(m.pulse||0, Math.min(0.72, 0.22+k*0.38));
    m.lastKind='wind';
    kickRotor(m,0.12+k*0.75);
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
    best.pulse=1;
    kickRotor(best,0.2+take*0.8);
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
    m.pulse=1;
    kickRotor(m,0.18+take*0.42);
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
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return;
    for(const [k,m] of machines){
      if(!m || !finiteTile(m.x,m.y) || !isValidSlot(m.x,m.y,getTile)){
        machines.delete(k);
        continue;
      }
      normalizeMachine(m);
      recordWindPower(m,dt,getTile);
      const work=Math.max(0,Math.min(1,(m.power||0)/MAX_POWER));
      const targetSpeed=work>0.001 ? 5+work*26 : 0;
      m.rotorSpeed+=(targetSpeed-(m.rotorSpeed||0))*Math.min(1,dt*(targetSpeed>0 ? 6.5 : 2.3));
      m.rotorAngle=((m.rotorAngle||0)+(m.rotorSpeed||0)*dt)%(Math.PI*2);
      m.power=Math.max(0, (m.power||0)-POWER_DECAY*dt);
      m.pulse=Math.max(0, (m.pulse||0)-PULSE_DECAY*dt);
    }
    if(machines.size>MACHINE_CAP){
      const idle=[...machines.entries()]
        .filter(([,m])=>m && (m.energy||0)<=0.001 && (m.power||0)<=0.001)
        .map(([k,m])=>({k,y:m.y||0,x:m.x||0}));
      idle.sort((a,b)=>(b.y-a.y)||(a.x-b.x));
      for(let i=0; i<idle.length && machines.size>Math.floor(MACHINE_CAP*0.85); i++) machines.delete(idle[i].k);
    }
  }
  function catchUp(dt,getTile){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return false;
    const simDt=Math.max(0,Math.min(CATCHUP_MAX_SECONDS,Number(dt)||0));
    if(simDt<=0) return false;
    let changed=false;
    for(const [k,m] of machines){
      if(!m || !finiteTile(m.x,m.y) || !isValidSlot(m.x,m.y,getTile)){
        machines.delete(k);
        changed=true;
        continue;
      }
      normalizeMachine(m);
      const before=m.energy||0;
      const winded=recordWindPower(m,simDt,getTile);
      if(!winded){
        if((m.power||0)>0 || (m.pulse||0)>0) changed=true;
        m.power=0;
        m.pulse=0;
        m.rotorSpeed=0;
      }else{
        const work=Math.max(0,Math.min(1,(m.power||0)/MAX_POWER));
        m.rotorSpeed=Math.max(m.rotorSpeed||0,5+work*20);
        m.rotorAngle=((m.rotorAngle||0)+(m.rotorSpeed||0)*Math.min(2,simDt))%(Math.PI*2);
      }
      if(Math.abs((m.energy||0)-before)>0.0001) changed=true;
    }
    return changed;
  }
  function ensureVisibleMachines(sx,sy,viewX,viewY,getTile){
    if(typeof getTile!=='function') return;
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(WORLD_TOP,Math.floor(sy)-2), y1=Math.min(WORLD_BOTTOM-1,Math.ceil(sy+viewY)+2);
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    const scanKey=x0+','+x1+','+y0+','+y1;
    if(scanKey===visibleScanKey && now-visibleScanAt<VISIBLE_SCAN_INTERVAL_MS) return;
    visibleScanKey=scanKey;
    visibleScanAt=now;
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(getSafe(getTile,x,y,T.AIR)===T.DYNAMO_SLOT) ensureMachine(x,y,getTile);
      }
    }
  }
  function drawBatteryLines(ctx,TILE,px,py,charge,pulse){
    const railW=Math.max(1.4,TILE*0.085);
    const railH=Math.max(2,TILE*0.105);
    const gap=TILE*0.038;
    const leftX=px+TILE*0.08;
    const rightX=px+TILE*0.835;
    const baseY=py+TILE*0.70;
    const fillBase=pulse>0 ? '#fff07c' : '#67d7ff';
    for(let i=0; i<4; i++){
      const y=baseY-i*(railH+gap);
      ctx.fillStyle='rgba(4,8,14,0.72)';
      ctx.fillRect(leftX,y,railW,railH);
      ctx.fillRect(rightX,y,railW,railH);
      const f=Math.max(0,Math.min(1,charge*4-i));
      if(f>0){
        const alpha=0.55+0.35*f+0.10*Math.max(0,Math.min(1,pulse||0));
        ctx.fillStyle=fillBase;
        ctx.globalAlpha=Math.min(1,alpha);
        const fillH=Math.max(1,railH*f);
        ctx.fillRect(leftX,y+railH-fillH,railW,fillH);
        ctx.fillRect(rightX,y+railH-fillH,railW,fillH);
        ctx.globalAlpha=1;
      }
    }
  }
  function drawRotorFan(ctx,TILE,px,py,angle,work,pulse){
    const cx=px+TILE*0.5;
    const cy=py+TILE*0.5;
    const r=TILE*(0.22+0.05*Math.max(0,Math.min(1,work)));
    const bladeL=TILE*(0.31+0.07*Math.max(0,Math.min(1,work)));
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(angle||0);
    ctx.globalCompositeOperation='lighter';
    ctx.strokeStyle='rgba(122,235,255,'+(0.38+0.42*work+0.12*Math.max(0,Math.min(1,pulse||0))).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.06);
    ctx.beginPath();
    for(let i=0; i<4; i++){
      const a=i*Math.PI*0.5;
      const x1=Math.cos(a)*r*0.32, y1=Math.sin(a)*r*0.32;
      const x2=Math.cos(a)*bladeL, y2=Math.sin(a)*bladeL;
      ctx.moveTo(x1,y1);
      ctx.lineTo(x2,y2);
    }
    ctx.stroke();
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(3,8,15,0.78)';
    ctx.beginPath();
    ctx.arc(0,0,Math.max(2,TILE*0.10),0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle='rgba(255,229,92,0.78)';
    ctx.lineWidth=Math.max(1,TILE*0.035);
    ctx.stroke();
    ctx.restore();
  }
  function drawOutputReadout(ctx,TILE,px,py,power,sourceKind,orientation,pulse){
    const p=Math.max(0,Math.min(1,(power||0)/MAX_POWER));
    const horizontal=orientation!=='vertical';
    const bw=horizontal ? TILE*1.92 : TILE*0.66;
    const bh=Math.max(5,TILE*0.24);
    const bx=px+TILE*0.5-bw*0.5;
    const by=horizontal ? py+TILE*0.66 : py+TILE*0.70;
    const color=sourceKind==='water'?'#49a8ff':(sourceKind==='steam'?'#dfe8ee':(sourceKind==='wind'?'#b8f4ff':'#f4b65e'));
    ctx.save();
    ctx.fillStyle='rgba(3,7,12,0.82)';
    ctx.fillRect(bx,by,bw,bh);
    if(p>0.001){
      ctx.fillStyle=color;
      ctx.globalAlpha=Math.min(1,0.52+0.32*p+0.12*Math.max(0,Math.min(1,pulse||0)));
      ctx.fillRect(bx,by,Math.max(1,bw*p),bh);
      ctx.globalAlpha=1;
    }
    ctx.strokeStyle='rgba(178,239,255,'+(0.38+0.44*p).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.035);
    ctx.strokeRect(bx,by,bw,bh);
    ctx.font='bold '+Math.max(7,Math.round(TILE*0.28))+'px system-ui';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillStyle='rgba(0,0,0,0.62)';
    const text=Math.round(power||0)+' E/s';
    ctx.fillText(text,bx+bw*0.5+1,by+bh*0.5+1);
    ctx.fillStyle=p>0.001 ? 'rgba(255,255,255,0.94)' : 'rgba(210,233,242,0.66)';
    ctx.fillText(text,bx+bw*0.5,by+bh*0.5);
    ctx.restore();
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
      const spin=Math.max(p,Math.min(1,(m.rotorSpeed||0)/34));
      const orientation=getTile ? slotOrientation(m.x,m.y,getTile) : 'horizontal';
      const px=m.x*TILE, py=m.y*TILE;
      const glow=0.18+0.35*spin+0.20*(m.pulse||0);
      ctx.fillStyle='rgba(84, 204, 255, '+glow.toFixed(3)+')';
      ctx.fillRect(px+TILE*0.18,py+TILE*0.20,TILE*0.64,TILE*0.60);
      ctx.strokeStyle='rgba(255,230,92,'+(0.45+0.45*spin).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,TILE*0.08);
      ctx.strokeRect(px+TILE*0.16,py+TILE*0.16,TILE*0.68,TILE*0.68);
      drawRotorFan(ctx,TILE,px,py,m.rotorAngle||0,spin,m.pulse||0);
      drawBatteryLines(ctx,TILE,px,py,charge,m.pulse||0);
      drawOutputReadout(ctx,TILE,px,py,m.power||0,m.lastKind||'',orientation,m.pulse||0);
    }
    ctx.restore();
  }
  function snapshot(){
    const list=[...machines.values()]
      .filter(m=>m && finiteTile(m.x,m.y) && ((m.energy||0)>0 || (m.power||0)>0))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MACHINE_CAP)
      .map(m=>({x:m.x,y:m.y,power:+(m.power||0).toFixed(2),energy:+(m.energy||0).toFixed(3),lastKind:m.lastKind||''}));
    return {v:1,list};
  }
  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
      if(machines.size>=MACHINE_CAP) break;
      if(!raw || !finiteTile(raw.x,raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(getTile && !isValidSlot(x,y,getTile)) continue;
      machines.set(key(x,y),{
        x,y,
        power:Math.max(0,Math.min(MAX_POWER,Number(raw.power)||0)),
        energy:Math.max(0,Math.min(ENERGY_CAPACITY,Number(raw.energy)||0)),
        pulse:0,
        rotorAngle:0,
        rotorSpeed:0,
        lastKind:typeof raw.lastKind==='string'?raw.lastKind:''
      });
    }
  }
  function reset(){ machines.clear(); visibleScanKey=''; visibleScanAt=0; }
  function metrics(){
    let currentPower=0, storedEnergy=0, active=0, rotorSpeed=0;
    for(const m of machines.values()){
      currentPower+=Math.max(0,m.power||0);
      storedEnergy+=Math.max(0,m.energy||0);
      rotorSpeed+=Math.max(0,m.rotorSpeed||0);
      if((m.power||0)>0.05) active++;
    }
    return {machines:machines.size, active, currentPower:+currentPower.toFixed(2), storedEnergy:+storedEnergy.toFixed(2), rotorSpeed:+rotorSpeed.toFixed(2)};
  }

  const api={isCasing,isSlot,isValidSlot,slotOrientation,plannedCells,structureCellsAt,recordFlow,absorbNear,energyAt,drainAt,onTileChanged,update,catchUp,draw,snapshot,restore,reset,metrics,_debug:{machines,MAX_POWER,ENERGY_CAPACITY,MACHINE_CAP,windSpeedForSlot,WIND_MIN_SPEED,WIND_RATED_SPEED,WIND_MAX_ENERGY_PER_SEC,CATCHUP_MAX_SECONDS}};
  MM.dynamo=api;
})();

export const dynamo = (typeof window!=='undefined' && window.MM) ? window.MM.dynamo : undefined;
export default dynamo;
