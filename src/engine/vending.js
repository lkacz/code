// Vending machines: city salvage caches and player-placed powered appliances.
// Generated machines can cough up one ancient prize without power. Player-placed
// machines need direct power or a copper network, vend once per in-game day, and
// break into scrap after 10 total vends.
import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';

(function(){
  window.MM = window.MM || {};

  const MAX_USES = 10;
  const ENERGY_COST = 1.2;
  const ELECTRIC_BUFFER_CAP = ENERGY_COST*3;
  const MACHINE_CAP = 5000;
  const DISPLAY_POWER_CACHE_MS = 450;
  const machines = new Map(); // "x,y" -> {x,y,usesLeft,placed,pulse,lastItem,lastVendDay}
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const JUNK = [
    {key:'sand',min:1,max:6,label:'piasek'},
    {key:'dirt',min:1,max:5,label:'ziemia'},
    {key:'leaf',min:1,max:4,label:'lisc'},
    {key:'snow',min:1,max:4,label:'snieg'},
    {key:'rottenMeat',min:1,max:2,label:'podejrzane mieso'},
    {key:'meteorDust',min:1,max:2,label:'pyl z kieszeni automatu'},
    {key:'plastic',min:1,max:3,label:'plastikowy smiec'}
  ];
  const USEFUL = [
    {key:'water',min:2,max:7,label:'woda'},
    {key:'wood',min:1,max:4,label:'drewno'},
    {key:'stone',min:1,max:4,label:'skala'},
    {key:'coal',min:1,max:3,label:'wegiel'},
    {key:'copperWire',min:1,max:2,label:'przewod miedziany'},
    {key:'waterPipe',min:1,max:1,label:'rura wodna'}
  ];
  const VALUE = [
    {key:'diamond',min:1,max:2,label:'diament'},
    {key:'steel',min:1,max:2,label:'stal'},
    {key:'obsidian',min:1,max:2,label:'obsydian'},
    {key:'glass',min:1,max:3,label:'szklo'},
    {key:'transistor',min:1,max:1,label:'tranzystor'}
  ];
  const RARE = [
    {key:'iridium',min:1,max:1,label:'iryd'},
    {key:'meteoricIron',min:1,max:2,label:'zelazo meteorytowe'},
    {key:'antimatter',min:1,max:1,label:'antymateria'},
    {key:'bakedMeat',min:1,max:2,label:'cieple mieso z bardzo watpliwego zrodla'}
  ];

  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function finiteAmount(value){
    const n=Number(value);
    return Number.isFinite(n) ? Math.max(0,n) : 0;
  }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function electricNetworkTile(x,y,getTile,opts){
    x=Math.floor(x); y=Math.floor(y);
    try{
      if(opts && typeof opts.getElectricNetworkTile==='function') return opts.getElectricNetworkTile(x,y);
    }catch(e){}
    try{
      if(MM.world && typeof MM.world.hasInfrastructure==='function' && MM.world.hasInfrastructure(x,y,T.SILVER_WIRE)) return T.SILVER_WIRE;
    }catch(e){}
    try{
      if(MM.world && typeof MM.world.hasInfrastructure==='function' && MM.world.hasInfrastructure(x,y,T.COPPER_WIRE)) return T.COPPER_WIRE;
    }catch(e){}
    try{
      if(opts && typeof opts.getNetworkTile==='function'){
        const t=opts.getNetworkTile(x,y);
        if(t===T.SILVER_WIRE || t===T.COPPER_WIRE) return t;
      }
    }catch(e){}
    try{
      if(MM.world && typeof MM.world.getNetworkTile==='function'){
        const t=MM.world.getNetworkTile(x,y);
        if(t===T.SILVER_WIRE || t===T.COPPER_WIRE) return t;
      }
    }catch(e){}
    return getSafe(getTile,x,y,T.AIR);
  }
  function gameDayFloat(opts){
    try{
      if(opts && typeof opts.gameDayFloat==='function'){
        const n=Number(opts.gameDayFloat());
        if(Number.isFinite(n)) return n;
      }
    }catch(e){}
    try{
      const S=MM.seasons;
      const m=(S && S.metrics) ? S.metrics() : null;
      const n=Number(m && m.dayFloat);
      if(Number.isFinite(n)) return n;
    }catch(e){}
    return 1;
  }
  function gameDayKey(opts){
    const n=Math.floor(gameDayFloat(opts));
    return Number.isFinite(n) ? Math.max(1,n) : 1;
  }
  function dayFromSave(v){
    const n=Math.floor(Number(v));
    return Number.isFinite(n) ? n : -1;
  }
  function rngFloat(rng){
    const v = typeof rng==='function' ? rng() : Math.random();
    return Number.isFinite(v) ? Math.max(0,Math.min(0.999999,v)) : Math.random();
  }
  function pick(list,rng){
    return list[Math.floor(rngFloat(rng)*list.length)] || list[0];
  }
  function amountFor(row,rng){
    const min=Math.max(0,row.min==null?1:row.min|0);
    const max=Math.max(min,row.max==null?min:row.max|0);
    return min + (max>min ? Math.floor(rngFloat(rng)*(max-min+1)) : 0);
  }
  function rollVendingLoot(rng){
    const r=rngFloat(rng);
    let tier='junk', row=null;
    if(r<0.58){ row=pick(JUNK,rng); tier='junk'; }
    else if(r<0.80){ row=pick(USEFUL,rng); tier='useful'; }
    else if(r<0.965){ row=pick(VALUE,rng); tier='value'; }
    else { row=pick(RARE,rng); tier='rare'; }
    return {key:row.key, n:amountFor(row,rng), tier, label:row.label || row.key};
  }
  function addResource(ctx,keyName,n){
    const amount=Math.max(0,n|0);
    if(!keyName || amount<=0) return false;
    if(ctx && typeof ctx.addResource==='function') return !!ctx.addResource(keyName,amount);
    const inv=ctx && ctx.inv;
    if(inv && typeof inv[keyName]==='number'){
      inv[keyName]+=amount;
      return true;
    }
    return false;
  }
  function addDrops(ctx,drops){
    const out=[];
    for(const d of drops || []){
      if(!d || !addResource(ctx,d.key,d.n)) continue;
      out.push({key:d.key,n:d.n});
    }
    return out;
  }
  function scrapDrops(rng){
    const copper=1+Math.floor(rngFloat(rng)*3);
    const pipes=rngFloat(rng)<0.72 ? 1+Math.floor(rngFloat(rng)*2) : 0;
    const out=[{key:'copperWire',n:copper}];
    if(pipes>0) out.push({key:'waterPipe',n:pipes});
    return out;
  }
  function normalizeMachine(m,x,y){
    if(!m) m={};
    m.x=Math.floor(Number.isFinite(m.x)?m.x:x);
    m.y=Math.floor(Number.isFinite(m.y)?m.y:y);
    m.usesLeft=Math.max(0,Math.min(MAX_USES,Number.isFinite(m.usesLeft)?Math.floor(m.usesLeft):MAX_USES));
    m.placed=!!m.placed;
    m.pulse=Math.max(0,Math.min(1,Number(m.pulse)||0));
    m.energy=Math.max(0,Math.min(ELECTRIC_BUFFER_CAP,Number(m.energy)||0));
    m.lastVendDay=dayFromSave(m.lastVendDay);
    if(typeof m.lastItem!=='string') m.lastItem='';
    return m;
  }
  function powerSourceAt(x,y,getTile,opts){
    const D=(opts && opts.dynamo) || MM.dynamo;
    const S=(opts && opts.solar) || MM.solar;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx, ny=y+dy;
      if(!finiteTile(nx,ny)) continue;
      const t=getSafe(getTile,nx,ny,T.AIR);
      if(t===T.DYNAMO || t===T.DYNAMO_SLOT){
        let slot=null;
        try{
          if(D && D.structureCellsAt){
            const cells=D.structureCellsAt(nx,ny,getTile) || [];
            slot=cells.find(c=>c && (c.role==='slot' || getSafe(getTile,c.x,c.y,T.AIR)===T.DYNAMO_SLOT));
          }
        }catch(e){ slot=null; }
        if(slot && (!D || !D.isValidSlot || D.isValidSlot(slot.x,slot.y,getTile))) return {kind:'dynamo',x:Math.floor(slot.x),y:Math.floor(slot.y)};
        if(t===T.DYNAMO_SLOT && (!D || !D.isValidSlot || D.isValidSlot(nx,ny,getTile))) return {kind:'dynamo',x:nx,y:ny};
        if(INFO[t] && INFO[t].powerSource) return {kind:'source',x:nx,y:ny};
      }
      if(t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY){
        try{
          if(S && S.sourceAt){
            const s=S.sourceAt(nx,ny,getTile);
            if(s) return {kind:'solar',x:s.x,y:s.y};
          }
        }catch(e){}
        return {kind:'solar',x:nx,y:ny};
      }
      // The SMR cell has a real battery API — it must PAY for the vend, never
      // fall through to the free generic power-source pass.
      if(t===T.SMR_CELL){
        try{
          const R=MM.smr;
          if(R && R.sourceAt){
            const s=R.sourceAt(nx,ny,getTile);
            if(s) return {kind:'smr',x:s.x,y:s.y};
          }
        }catch(e){}
        return {kind:'smr',x:nx,y:ny};
      }
      // Same ruling for the lightning rod: banked bolts pay, never a free vend.
      if(t===T.LIGHTNING_ROD){
        try{
          const W=MM.weatherInstruments;
          if(W && W.sourceAt){
            const s=W.sourceAt(nx,ny,getTile);
            if(s) return {kind:'rod',x:s.x,y:s.y};
          }
        }catch(e){}
        return {kind:'rod',x:nx,y:ny};
      }
      if(INFO[t] && INFO[t].powerSource) return {kind:'source',x:nx,y:ny};
    }
    return null;
  }
  function networkSourceAt(x,y,getTile,opts){
    const charger=(opts && opts.teleporters) || MM.teleporters;
    if(!charger) return null;
    const D=(opts && opts.dynamo) || MM.dynamo;
    const netGet=(nx,ny)=>electricNetworkTile(nx,ny,getTile,opts);
    try{
      if(typeof charger.availableNetworkEnergyAt==='function'){
        const available=finiteAmount(charger.availableNetworkEnergyAt(x,y,netGet,D));
        if(available+1e-6<ENERGY_COST) return null;
      }
      if(typeof charger.availableNetworkEnergyAt!=='function' && typeof charger.drainNetworkEnergyAt!=='function' && typeof charger.chargeBatteryAt!=='function') return null;
      return {kind:'network',x:Math.floor(x),y:Math.floor(y)};
    }catch(e){}
    return null;
  }
  function drainNetworkPowerAt(x,y,getTile,opts){
    const charger=(opts && opts.teleporters) || MM.teleporters;
    if(!charger) return 0;
    const D=(opts && opts.dynamo) || MM.dynamo;
    const netGet=(nx,ny)=>electricNetworkTile(nx,ny,getTile,opts);
    try{
      if(typeof charger.drainNetworkEnergyAt==='function'){
        return Math.min(ENERGY_COST,finiteAmount(charger.drainNetworkEnergyAt(x,y,ENERGY_COST,netGet,D,{fair:true})));
      }
      if(typeof charger.chargeBatteryAt!=='function') return 0;
      const battery={energy:0};
      charger.chargeBatteryAt(x,y,battery,1,netGet,D,{capacity:ENERGY_COST,rate:ENERGY_COST});
      return Math.min(ENERGY_COST,finiteAmount(battery.energy));
    }catch(e){}
    return 0;
  }
  function drawPower(source,getTile,opts){
    if(!source) return false;
    if(source.kind==='network') return drainNetworkPowerAt(source.x,source.y,getTile,opts)+1e-6>=ENERGY_COST;
    const D=(opts && opts.dynamo) || MM.dynamo;
    const S=(opts && opts.solar) || MM.solar;
    if(source.kind==='dynamo' && D && D.drainAt){
      try{
        if(typeof D.energyAt==='function' && finiteAmount(D.energyAt(source.x,source.y,getTile))+1e-6<ENERGY_COST) return false;
        const got=D.drainAt(source.x,source.y,ENERGY_COST,getTile);
        return !!(got && finiteAmount(got.amount)+1e-6>=ENERGY_COST);
      }catch(e){ return false; }
    }
    if(source.kind==='solar' && S && S.drainAt){
      try{
        if(typeof S.energyAt==='function' && finiteAmount(S.energyAt(source.x,source.y,getTile))+1e-6<ENERGY_COST) return false;
        const got=S.drainAt(source.x,source.y,ENERGY_COST,getTile);
        return !!(got && finiteAmount(got.amount)+1e-6>=ENERGY_COST);
      }catch(e){ return false; }
    }
    const R=(opts && opts.smr) || MM.smr;
    if(source.kind==='smr' && R && R.drainAt){
      try{
        if(typeof R.energyAt==='function' && finiteAmount(R.energyAt(source.x,source.y))+1e-6<ENERGY_COST) return false;
        const got=R.drainAt(source.x,source.y,ENERGY_COST);
        return !!(got && finiteAmount(got.amount)+1e-6>=ENERGY_COST);
      }catch(e){ return false; }
    }
    const W=(opts && opts.weatherInstruments) || MM.weatherInstruments;
    if(source.kind==='rod' && W && W.drainAt){
      try{
        if(typeof W.energyAt==='function' && finiteAmount(W.energyAt(source.x,source.y))+1e-6<ENERGY_COST) return false;
        const got=W.drainAt(source.x,source.y,ENERGY_COST);
        return !!(got && finiteAmount(got.amount)+1e-6>=ENERGY_COST);
      }catch(e){ return false; }
    }
    // Generic power-source blocks have no battery API. Modelled dynamo/solar
    // sources must pay the complete cost; a partial drain is never a free vend.
    return source.kind==='source';
  }
  function stateForUse(x,y,getTile,powered){
    const k=key(x,y);
    let m=machines.get(k);
    if(!m){
      if(machines.size>=MACHINE_CAP) return null;
      m={x:Math.floor(x),y:Math.floor(y),usesLeft:powered?MAX_USES:1,placed:!!powered,pulse:0,energy:0,lastItem:'',lastVendDay:-1};
      machines.set(k,m);
    }
    return normalizeMachine(m,x,y);
  }
  function onPlaced(x,y){
    if(!finiteTile(x,y)) return false;
    const k=key(x,y);
    if(!machines.has(k) && machines.size>=MACHINE_CAP) return false;
    machines.set(k,{x:Math.floor(x),y:Math.floor(y),usesLeft:MAX_USES,placed:true,pulse:0,energy:0,lastItem:'',lastVendDay:-1});
    return true;
  }
  function onTileRemoved(x,y){
    machines.delete(key(x,y));
  }
  function breakMachine(x,y,ctx,rng){
    const gt=ctx && ctx.getTile;
    const st=ctx && ctx.setTile;
    if(typeof gt==='function' && gt(x,y)!==T.VENDING_MACHINE) return [];
    if(typeof st==='function') st(x,y,T.AIR);
    machines.delete(key(x,y));
    const drops=addDrops(ctx,scrapDrops(rng));
    if(ctx && typeof ctx.onBreak==='function') ctx.onBreak(x,y,drops);
    return drops;
  }
  function vendAt(x,y,ctx){
    x=Math.floor(x); y=Math.floor(y);
    const getTile=ctx && ctx.getTile;
    if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.VENDING_MACHINE) return {ok:false, reason:'not-vending'};
    let source=powerSourceAt(x,y,getTile,ctx) || networkSourceAt(x,y,getTile,ctx);
    const existing=machines.get(key(x,y));
    if(!source && existing && finiteAmount(existing.energy)+1e-6>=ENERGY_COST) source={kind:'rifle',x,y};
    const powered=!!source;
    const m=stateForUse(x,y,getTile,powered);
    if(!m) return {ok:false, reason:'state-cap', message:'Za duzo aktywnych automatow'};
    if(m.placed && !powered) return {ok:false, reason:'power', message:'Automat wymaga zasilania obok albo przewodem'};
    if(m.usesLeft<=0){
      const scrap=breakMachine(x,y,ctx,ctx&&ctx.rng);
      return {ok:false, reason:'empty', message:'Automat rozsypal sie na czesci', broke:true, scrap};
    }
    const day=gameDayKey(ctx);
    const dailyLimited=!!(m.placed && powered);
    if(dailyLimited && m.lastVendDay===day){
      m.pulse=Math.max(m.pulse||0,0.34);
      return {ok:false, reason:'cooldown', message:'Automat wyczerpany na dzis. Wroc jutro.', powered, source, usesLeft:m.usesLeft, day, ready:false};
    }
    if(source && source.kind==='rifle') m.energy=Math.max(0,finiteAmount(m.energy)-ENERGY_COST);
    else if(powered && !drawPower(source,getTile,ctx)){
      return {ok:false, reason:'power', message:'Automat stracil zasilanie'};
    }
    const loot=rollVendingLoot(ctx && ctx.rng);
    const granted=addResource(ctx,loot.key,loot.n);
    if(!granted) return {ok:false, reason:'inventory', message:'Automat zakaszlal, ale zasob nie istnieje'};
    m.usesLeft=Math.max(0,m.usesLeft-1);
    m.pulse=1;
    m.lastItem=loot.key;
    if(dailyLimited) m.lastVendDay=day;
    const result={ok:true, loot, usesLeft:m.usesLeft, powered, source, broke:false, scrap:[], day, ready:false};
    if(m.usesLeft<=0){
      result.scrap=breakMachine(x,y,ctx,ctx&&ctx.rng);
      result.broke=true;
    }
    return result;
  }
  function update(dt,getTile){
    const d=Math.max(0,Math.min(0.1,Number(dt)||0));
    for(const [raw,m] of machines){
      if(!m || !finiteTile(m.x,m.y) || (typeof getTile==='function' && getSafe(getTile,m.x,m.y,T.AIR)!==T.VENDING_MACHINE)){
        machines.delete(raw);
        continue;
      }
      m.pulse=Math.max(0,(m.pulse||0)-d*2.6);
    }
  }
  function receiveElectricChargeAt(x,y,amount,getTile){
    x=Math.floor(Number(x)); y=Math.floor(Number(y));
    const gt=getTile || (MM.world && MM.world.getTile);
    if(!finiteTile(x,y) || getSafe(gt,x,y,T.AIR)!==T.VENDING_MACHINE) return 0;
    let m=machines.get(key(x,y));
    if(!m){
      if(machines.size>=MACHINE_CAP) return 0;
      m={x,y,usesLeft:1,placed:false,pulse:0,energy:0,lastItem:'',lastVendDay:-1};
      machines.set(key(x,y),m);
    }
    normalizeMachine(m,x,y);
    const before=m.energy;
    m.energy=Math.min(ELECTRIC_BUFFER_CAP,before+finiteAmount(amount));
    if(m.energy>before) m.pulse=1;
    return m.energy-before;
  }
  function snapshot(){
    const list=[];
    for(const m of machines.values()){
      const mm=normalizeMachine(m,m&&m.x,m&&m.y);
      if(!finiteTile(mm.x,mm.y)) continue;
      list.push({x:mm.x,y:mm.y,usesLeft:mm.usesLeft,placed:!!mm.placed,energy:+mm.energy.toFixed(2),lastItem:mm.lastItem||'',lastVendDay:mm.lastVendDay});
      if(list.length>=MACHINE_CAP) break;
    }
    return {v:1,list};
  }
  function restore(s,getTile){
    machines.clear();
    const list=s && Array.isArray(s.list) ? s.list : [];
    for(const raw of list.slice(0,MACHINE_CAP)){
      if(!raw || machines.size>=MACHINE_CAP) break;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(!finiteTile(x,y)) continue;
      if(typeof getTile==='function' && getSafe(getTile,x,y,T.AIR)!==T.VENDING_MACHINE) continue;
      machines.set(key(x,y),normalizeMachine(raw,x,y));
    }
  }
  function reset(){ machines.clear(); }
  function metrics(){
    let placed=0, stock=0, exhaustedToday=0, storedEnergy=0;
    const day=gameDayKey();
    for(const m of machines.values()){
      const mm=normalizeMachine(m,m&&m.x,m&&m.y);
      if(mm.placed){
        placed++;
        if(mm.lastVendDay===day) exhaustedToday++;
      }
      stock+=Math.max(0,Number(mm.usesLeft)||0);
      storedEnergy+=mm.energy;
    }
    return {machines:machines.size, placed, stock, exhaustedToday, storedEnergy:+storedEnergy.toFixed(2)};
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile,getTile,opts){
    if(!ctx || !machines.size) return;
    const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
    const y0=Math.max(WORLD_TOP,Math.floor(sy)-2), y1=Math.min(WORLD_BOTTOM-1,Math.ceil(sy+viewY)+2);
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    ctx.save();
    for(const [raw,m] of machines){
      if(!m || m.x<x0 || m.x>x1 || m.y<y0 || m.y>y1) continue;
      if(typeof getTile==='function' && getSafe(getTile,m.x,m.y,T.AIR)!==T.VENDING_MACHINE){ machines.delete(raw); continue; }
      if(canDrawTile && !canDrawTile(m.x,m.y)) continue;
      const pulse=Math.max(0,Math.min(1,m.pulse||0));
      if(pulse<=0.01 && !m.placed) continue;
      const x=m.x*TILE, y=m.y*TILE;
      const mm=normalizeMachine(m,m.x,m.y);
      let source=powerSourceAt(m.x,m.y,getTile,opts);
      if(!source){
        const stale=!m._displayPowerChecked || !Number.isFinite(m._displayPowerAt) || now<m._displayPowerAt || now-m._displayPowerAt>=DISPLAY_POWER_CACHE_MS;
        if(stale){
          m._displayPowerSource=networkSourceAt(m.x,m.y,getTile,opts);
          m._displayPowerAt=now;
          m._displayPowerChecked=true;
        }
        source=m._displayPowerSource || (finiteAmount(m.energy)+1e-6>=ENERGY_COST ? {kind:'rifle',x:m.x,y:m.y} : null);
      }
      const day=gameDayKey(opts);
      const hasStock=mm.usesLeft>0;
      const cooldown=!!(mm.placed && source && mm.lastVendDay===day);
      const ready=hasStock && (!mm.placed || (!!source && !cooldown));
      const glow=0.18+0.24*pulse+0.08*Math.sin(now*0.010+m.x);
      if(ready) ctx.fillStyle='rgba(84,255,156,'+Math.max(0.35,0.62+glow*0.35).toFixed(3)+')';
      else if(cooldown) ctx.fillStyle='rgba(255,171,67,'+Math.max(0.28,0.42+glow*0.20).toFixed(3)+')';
      else ctx.fillStyle='rgba(255,83,93,'+Math.max(0.24,0.35+glow*0.18).toFixed(3)+')';
      ctx.fillRect(x+5,y+3,TILE-10,3);
      if(cooldown){
        ctx.fillStyle='rgba(255,171,67,0.22)';
        ctx.fillRect(x+4,y+7,TILE-8,2);
        ctx.fillStyle='rgba(255,236,169,0.70)';
        const w=Math.max(2,Math.round((TILE-8)*(0.42+0.18*Math.sin(now*0.006+m.y))));
        ctx.fillRect(x+4,y+7,w,1);
      }else if(ready){
        ctx.fillStyle='rgba(118,255,187,0.20)';
        ctx.fillRect(x+4,y+7,TILE-8,2);
        ctx.fillStyle='rgba(220,255,240,0.82)';
        ctx.fillRect(x+TILE-7,y+6,2,2);
      }
      if(m.placed){
        const bars=Math.max(0,Math.min(MAX_USES,m.usesLeft|0));
        ctx.fillStyle='rgba(6,10,15,0.58)';
        ctx.fillRect(x+3,y+TILE-4,TILE-6,2);
        ctx.fillStyle='rgba(255,218,83,0.82)';
        ctx.fillRect(x+3,y+TILE-4,Math.round((TILE-6)*(bars/MAX_USES)),2);
      }
    }
    ctx.restore();
  }

  const api={MAX_USES,ENERGY_COST,rollVendingLoot,powerSourceAt,vendAt,onPlaced,onTileRemoved,receiveElectricChargeAt,update,draw,snapshot,restore,reset,metrics,_debug:{machines,scrapDrops,networkSourceAt,drainNetworkPowerAt,MACHINE_CAP,DISPLAY_POWER_CACHE_MS,ELECTRIC_BUFFER_CAP}};
  MM.vending=api;
})();

export const vending = (typeof window!=='undefined' && window.MM) ? window.MM.vending : undefined;
export default vending;
