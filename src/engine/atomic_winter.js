// Persistent atomic winter world event: city bomb fallout, toxic rain, wind, shared dialogue context.
import { isPlayerPassableTile } from './material_physics.js';

(function(){
  const root = (typeof window!=='undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  const DAY_SECONDS = 600;
  const DAYS_PER_SEASON = 10;
  const SEASONS_PER_YEAR = 4;
  const YEAR_SECONDS = DAY_SECONDS * DAYS_PER_SEASON * SEASONS_PER_YEAR;
  const WINTER_SECONDS = DAY_SECONDS * DAYS_PER_SEASON;
  const WIND_BOOST_SECONDS = DAY_SECONDS;
  const ENERGY_INTERVAL = 10;
  const TOXIC_RAIN_DAMAGE = 1;
  const TOXIC_RAIN_INTERVAL = 4;
  const MOB_RAIN_HEAL = 2;
  const LEGACY_MESSENGER_ID = 'atomic_winter_messenger';
  const NPC_CONTEXT_LINES = [
    'Atomic winter trwa do konca zimy: zielony deszcz rani kazdego bez dachu.',
    'W schronie pod solidnym dachem nie lapiesz opadu ani piorunow, ale piorun moze uszkodzic dach.',
    'Radioaktywny deszcz leczy potwory, wiec walka na zewnatrz robi sie coraz gorsza.',
    'Po detonacji wiatr jest trzykrotnie silniejszy przez jeden dzien i noc.',
    'Hero dostaje 1 energie co 10 sekund, dopoki trwa atomic winter.',
    'Kiedy zima minie, zielone chmury, toksyczny deszcz i dodatkowa energia wygasna.'
  ];
  const ALIEN_CONTEXT_LINES = [
    'Fallout protokol: zielony deszcz rani Hero do konca zimy.',
    'Schron blokuje opad i piorun, ale piorun moze wygryzc dach.',
    'Deszcz radioaktywny karmi potwory. Zostawcie ich na powierzchni.',
    'Wiatr po bombie ma potrojna sile przez jeden dzien i noc.',
    'Hero laduje energie z opadu: 1 impuls co 10 sekund.',
    'Gdy zima minie, chmury i toksyczny opad straca zasilanie.'
  ];
  const MOLEKIN_CONTEXT_LINES = [
    'Zielony deszcz bije powierzchnie do konca zimy. Dach albo tunel.',
    'Piorun nie trafi pod dachem, ale moze wyrwac kamien nad glowa.',
    'Opad leczy stwory. Ziemia lubi, kiedy Hero zostaje na gorze.',
    'Wiatr po bombie ryczy trzy razy mocniej przez dzien i noc.',
    'Hero ssie energie z popiolu: jeden punkt co 10 sekund.',
    'Kiedy zima pusci, radioaktywny deszcz ucichnie.'
  ];

  const state = {
    active:false,
    tLeft:0,
    windLeft:0,
    x:0,
    y:0,
    energyAcc:0,
    rainAcc:0,
    healAcc:0,
    stormRefresh:0,
    windRefresh:0,
    winterRefresh:0,
    forcedWinter:false
  };
  const atomicClouds = [];

  function finite(v,fallback){ return (typeof v==='number' && isFinite(v)) ? v : fallback; }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function dayLength(){
    try{
      const c=MM.seasons && MM.seasons.constants;
      if(c && Number.isFinite(c.DAY_SECONDS)) return c.DAY_SECONDS;
    }catch(e){}
    return DAY_SECONDS;
  }
  function yearLength(){
    try{
      const c=MM.seasons && MM.seasons.constants;
      const d=Number.isFinite(c && c.DAY_SECONDS) ? c.DAY_SECONDS : DAY_SECONDS;
      const s=Number.isFinite(c && c.DAYS_PER_SEASON) ? c.DAYS_PER_SEASON : DAYS_PER_SEASON;
      return d * s * SEASONS_PER_YEAR;
    }catch(e){ return YEAR_SECONDS; }
  }
  function winterLength(){
    try{
      const c=MM.seasons && MM.seasons.constants;
      const d=Number.isFinite(c && c.DAY_SECONDS) ? c.DAY_SECONDS : DAY_SECONDS;
      const s=Number.isFinite(c && c.DAYS_PER_SEASON) ? c.DAYS_PER_SEASON : DAYS_PER_SEASON;
      return d * s;
    }catch(e){ return WINTER_SECONDS; }
  }
  function winterStartDay(day){
    const c=MM.seasons && MM.seasons.constants;
    const span=Number.isFinite(c && c.DAYS_PER_SEASON) ? c.DAYS_PER_SEASON : DAYS_PER_SEASON;
    const yearDays=span*SEASONS_PER_YEAR;
    const d=Math.max(1,finite(day,1));
    const base=Math.floor((d-1)/yearDays)*yearDays;
    return base + span*3 + 1;
  }
  function forceBeginningOfWinter(){
    const seasons=MM.seasons;
    if(!seasons) return false;
    try{
      const m=typeof seasons.metrics==='function' ? seasons.metrics() : null;
      const d=m && Number.isFinite(m.dayFloat) ? m.dayFloat : (m && Number.isFinite(m.day) ? m.day : 1);
      if(typeof seasons.setDay==='function') seasons.setDay(winterStartDay(d));
      if(typeof seasons.forceSeason==='function') seasons.forceSeason('winter');
      state.forcedWinter=true;
      return true;
    }catch(e){ return false; }
  }
  function holdWinter(){
    if(!state.active) return;
    const seasons=MM.seasons;
    if(seasons && typeof seasons.forceSeason==='function'){
      try{ seasons.forceSeason('winter'); state.forcedWinter=true; }catch(e){}
    }
  }
  function releaseWinter(){
    if(!state.forcedWinter) return;
    state.forcedWinter=false;
    try{ if(MM.seasons && typeof MM.seasons.forceSeason==='function') MM.seasons.forceSeason('natural'); }catch(e){}
  }
  function addStormCloud(x){
    const clouds=MM.clouds;
    if(!clouds || typeof clouds.addCloud!=='function') return null;
    const c=clouds.addCloud(x,null,58+Math.random()*34);
    if(c){
      c.raining=true;
      c.snowing=false;
      c.atomic=true;
      c.toxic=true;
      c.spriteKey='';
      c.mass=Math.max(c.mass||0,62);
      atomicClouds.push(c);
      while(atomicClouds.length>32) atomicClouds.shift();
    }
    return c;
  }
  function forceAtomicRainClouds(){
    for(let i=atomicClouds.length-1;i>=0;i--){
      const c=atomicClouds[i];
      if(!c || !(c.mass>0)){ atomicClouds.splice(i,1); continue; }
      c.raining=true;
      c.snowing=false;
      c.atomic=true;
      c.toxic=true;
      c.mass=Math.max(c.mass||0,18);
    }
  }
  function seedAtomicStorm(x){
    const clouds=MM.clouds;
    if(!clouds) return false;
    try{ if(typeof clouds.startStorm==='function') clouds.startStorm(300,1); }catch(e){}
    for(let i=0;i<7;i++) addStormCloud(x+(i-3)*18+(Math.random()*12-6));
    state.stormRefresh=24;
    return true;
  }
  function refreshStorm(player){
    const x=finite(player && player.x,state.x);
    try{ if(MM.clouds && typeof MM.clouds.startStorm==='function') MM.clouds.startStorm(240,1); }catch(e){}
    for(let i=0;i<3;i++) addStormCloud(x+(Math.random()*120-60));
  }
  function toxicRainAt(x){
    if(!state.active) return false;
    const wx=finite(x,state.x);
    try{ if(MM.clouds && typeof MM.clouds.isRainingAt==='function' && MM.clouds.isRainingAt(Math.floor(wx))) return true; }catch(e){}
    return state.active && Math.abs(wx-state.x)<190;
  }
  function contextLines(kind){
    if(!state.active) return [];
    const k=String(kind || 'npc').toLowerCase();
    if(k === 'alien' || k === 'aliens') return ALIEN_CONTEXT_LINES.slice();
    if(k === 'molekin' || k === 'mole' || k === 'underground') return MOLEKIN_CONTEXT_LINES.slice();
    return NPC_CONTEXT_LINES.slice();
  }
  function contextLine(kind,seed){
    const lines=contextLines(kind);
    if(!lines.length) return '';
    const n=Math.abs(Math.floor(finite(seed,state.tLeft) * 997 + state.tLeft + state.x * 13));
    return lines[n % lines.length];
  }
  function announceStart(){
    try{
      if(root.msg) root.msg('Atomic winter: nuclear bomb detonated. Green poisonous rain lasts until winter ends; shelter under a roof blocks rain and lightning.');
    }catch(e){}
  }
  function removeLegacyMessenger(){
    try{
      const reg=MM.npcSystem || MM.npcs;
      if(reg && typeof reg.unregister==='function') reg.unregister(LEGACY_MESSENGER_ID);
      else if(reg && typeof reg==='object') delete reg[LEGACY_MESSENGER_ID];
      if(MM.npcs && typeof MM.npcs==='object') delete MM.npcs[LEGACY_MESSENGER_ID];
    }catch(e){}
  }
  function falloutOpenTile(t){
    return isPlayerPassableTile(t);
  }
  function roofOverColumn(x,y,getTile,depth){
    if(typeof getTile!=='function') return false;
    const top=y-Math.max(4,Math.floor(depth||22));
    for(let yy=y; yy>=top; yy--){
      let t;
      try{ t=getTile(x,yy); }catch(e){ break; }
      if(falloutOpenTile(t)) continue;
      return true;
    }
    return false;
  }
  function shelteredFromFallout(player,getTile){
    if(!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
    const x=Math.floor(player.x);
    const y=Math.floor(player.y)-1;
    if(roofOverColumn(x,y,getTile,24)) return true;
    let sideRoofs=0;
    if(roofOverColumn(x-1,y,getTile,24)) sideRoofs++;
    if(roofOverColumn(x+1,y,getTile,24)) sideRoofs++;
    return sideRoofs>=2;
  }
  function chargeHeroEnergy(player){
    const energy=MM.heroEnergy;
    if(energy && typeof energy.chargeExternal==='function'){
      try{ energy.chargeExternal(1,{cause:'atomic_winter',source:{x:finite(player && player.x,state.x),y:finite(player && player.y,state.y)},intensity:0.42}); return; }catch(e){}
    }
    if(player && typeof player.energy==='number'){
      const max=Number.isFinite(player.maxEnergy) ? player.maxEnergy : player.energy+1;
      player.energy=Math.min(max,player.energy+1);
    }
  }
  function trigger(opts){
    opts=opts||{};
    removeLegacyMessenger();
    const player=opts.player || root.player || null;
    state.active=true;
    state.tLeft=winterLength();
    state.windLeft=dayLength();
    state.x=finite(opts.x,finite(player && player.x,0));
    state.y=finite(opts.y,finite(player && player.y,0));
    state.energyAcc=0;
    state.rainAcc=0;
    state.healAcc=0;
    state.windRefresh=0;
    state.winterRefresh=0;
    forceBeginningOfWinter();
    seedAtomicStorm(state.x);
    announceStart();
    return true;
  }
  function updateWindBoost(dt,player){
    if(!(state.windLeft>0)) return;
    state.windLeft=Math.max(0,state.windLeft-dt);
    state.windRefresh-=dt;
    if(state.windRefresh>0) return;
    state.windRefresh=48;
    const dir=((finite(player && player.vx,0)>=0)?1:-1) * (Math.random()<0.25?-1:1);
    try{ if(MM.wind && typeof MM.wind.forceSquall==='function') MM.wind.forceSquall(dir,7.2,120); }catch(e){}
  }
  function update(dt,player,getTile){
    if(!(dt>0) || !isFinite(dt) || !state.active) return;
    state.tLeft=Math.max(0,state.tLeft-dt);
    if(state.tLeft<=0){ expire(); return; }
    state.winterRefresh-=dt;
    if(state.winterRefresh<=0){ state.winterRefresh=5; holdWinter(); }
    state.stormRefresh-=dt;
    if(state.stormRefresh<=0){ state.stormRefresh=28; refreshStorm(player); }
    forceAtomicRainClouds();
    updateWindBoost(dt,player);
    state.energyAcc+=dt;
    while(state.energyAcc>=ENERGY_INTERVAL){
      state.energyAcc-=ENERGY_INTERVAL;
      chargeHeroEnergy(player || root.player);
    }
    const pl=player || root.player;
    const raining=pl && toxicRainAt(pl.x);
    const sheltered=raining && shelteredFromFallout(pl,getTile);
    if(raining){
      state.rainAcc+=dt;
      state.healAcc+=dt;
      while(state.rainAcc>=TOXIC_RAIN_INTERVAL){
        state.rainAcc-=TOXIC_RAIN_INTERVAL;
        if(!sheltered){
          try{ if(typeof root.damageHero==='function') root.damageHero(TOXIC_RAIN_DAMAGE,{cause:'radiation_rain',srcX:pl.x,srcY:pl.y-6,kb:0.6,kbY:-0.2,invulMs:260}); }catch(e){}
        }
      }
      while(state.healAcc>=1){
        state.healAcc-=1;
        try{ if(MM.mobs && typeof MM.mobs.healRadiationRain==='function') MM.mobs.healRadiationRain(pl.x,90,MOB_RAIN_HEAL,{particles:true}); }catch(e){}
      }
    } else {
      state.rainAcc=Math.min(state.rainAcc,TOXIC_RAIN_INTERVAL-0.05);
      state.healAcc=Math.min(state.healAcc,0.95);
    }
  }
  function expire(){
    state.active=false;
    state.tLeft=0;
    state.windLeft=0;
    state.energyAcc=0;
    state.rainAcc=0;
    state.healAcc=0;
    state.stormRefresh=0;
    state.windRefresh=0;
    state.winterRefresh=0;
    atomicClouds.length=0;
    releaseWinter();
    try{ if(root.msg) root.msg('Atomic winter ended as winter passed.'); }catch(e){}
  }
  function reset(){
    const wasForced=state.forcedWinter;
    removeLegacyMessenger();
    state.active=false;
    state.tLeft=0;
    state.windLeft=0;
    state.x=0;
    state.y=0;
    state.energyAcc=0;
    state.rainAcc=0;
    state.healAcc=0;
    state.stormRefresh=0;
    state.windRefresh=0;
    state.winterRefresh=0;
    atomicClouds.length=0;
    if(wasForced) releaseWinter();
  }
  function snapshot(){
    return {
      v:1,
      active:!!state.active,
      tLeft:+Math.max(0,state.tLeft).toFixed(3),
      windLeft:+Math.max(0,state.windLeft).toFixed(3),
      x:+finite(state.x,0).toFixed(3),
      y:+finite(state.y,0).toFixed(3),
      energyAcc:+clamp(finite(state.energyAcc,0),0,ENERGY_INTERVAL).toFixed(3),
      rainAcc:+clamp(finite(state.rainAcc,0),0,TOXIC_RAIN_INTERVAL).toFixed(3),
      healAcc:+clamp(finite(state.healAcc,0),0,1).toFixed(3),
      stormRefresh:+clamp(finite(state.stormRefresh,0),0,60).toFixed(3),
      windRefresh:+clamp(finite(state.windRefresh,0),0,120).toFixed(3),
      forcedWinter:!!state.forcedWinter
    };
  }
  function restore(src){
    reset();
    removeLegacyMessenger();
    if(!src || typeof src!=='object') return false;
    state.active=!!src.active && finite(src.tLeft,0)>0;
    state.tLeft=state.active ? clamp(finite(src.tLeft,winterLength()),0,winterLength()) : 0;
    state.windLeft=clamp(finite(src.windLeft,0),0,dayLength());
    state.x=finite(src.x,0);
    state.y=finite(src.y,0);
    state.energyAcc=clamp(finite(src.energyAcc,0),0,ENERGY_INTERVAL);
    state.rainAcc=clamp(finite(src.rainAcc,0),0,TOXIC_RAIN_INTERVAL);
    state.healAcc=clamp(finite(src.healAcc,0),0,1);
    state.stormRefresh=clamp(finite(src.stormRefresh,0),0,60);
    state.windRefresh=clamp(finite(src.windRefresh,0),0,120);
    if(state.active){
      state.forcedWinter=!!src.forcedWinter;
      holdWinter();
      if(state.stormRefresh<=0 || atomicClouds.length===0) seedAtomicStorm(state.x);
    }
    return true;
  }
  function metrics(){
    return {
      active:!!state.active,
      tLeft:state.tLeft,
      windLeft:state.windLeft,
      x:state.x,
      y:state.y,
      toxicRain:state.active
    };
  }

  removeLegacyMessenger();
  const api={trigger,update,reset,snapshot,restore,metrics,isActive:()=>!!state.active,toxicRainAt,contextLines,contextLine,_debug:{state,YEAR_SECONDS,WINTER_SECONDS,WIND_BOOST_SECONDS,TOXIC_RAIN_DAMAGE,TOXIC_RAIN_INTERVAL,winterLength,yearLength,shelteredFromFallout,contextLines,contextLine}};
  MM.atomicWinter=api;
})();

export const atomicWinter = (typeof window!=='undefined' && window.MM) ? window.MM.atomicWinter : undefined;
export default atomicWinter;
