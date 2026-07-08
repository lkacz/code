// Persistent atomic winter world event: city bomb fallout, toxic rain, wind, NPC warning.
(function(){
  const root = (typeof window!=='undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  const DAY_SECONDS = 600;
  const DAYS_PER_SEASON = 10;
  const SEASONS_PER_YEAR = 4;
  const YEAR_SECONDS = DAY_SECONDS * DAYS_PER_SEASON * SEASONS_PER_YEAR;
  const WIND_BOOST_SECONDS = DAY_SECONDS;
  const ENERGY_INTERVAL = 10;
  const TOXIC_RAIN_DAMAGE = 3;
  const MOB_RAIN_HEAL = 2;
  const MESSENGER_ID = 'atomic_winter_messenger';

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
    forcedWinter:false,
    messenger:{active:false,x:0,y:0,talkUntil:0}
  };
  const atomicClouds = [];

  function finite(v,fallback){ return (typeof v==='number' && isFinite(v)) ? v : fallback; }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function now(){ try{ return performance.now(); }catch(e){ return Date.now(); } }
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
    const wx=finite(x,state.x);
    try{ if(MM.clouds && typeof MM.clouds.isRainingAt==='function' && MM.clouds.isRainingAt(Math.floor(wx))) return true; }catch(e){}
    return state.active && Math.abs(wx-state.x)<190;
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
  function findMessengerSpot(player,getTile){
    const px=Math.floor(finite(player && player.x,state.x));
    const py=Math.floor(finite(player && player.y,state.y));
    for(const dx of [-4,4,-7,7,-10,10,0]){
      const x=px+dx;
      for(let y=py-5;y<=py+8;y++){
        try{
          if(getTile && getTile(x,y)===0 && getTile(x,y-1)===0 && getTile(x,y+1)!==0 && getTile(x,y+1)!==8 && getTile(x,y+1)!==13){
            return {x:x+0.5,y:y+0.1};
          }
        }catch(e){}
      }
    }
    return {x:finite(player && player.x,state.x)+3,y:finite(player && player.y,state.y)};
  }
  function messengerLine(){
    return 'Atomic winter: one year of poisonous rain.';
  }
  function registerMessenger(){
    const reg=MM.npcSystem || MM.npcs;
    if(!reg || typeof reg.register!=='function') return false;
    if(typeof reg.get==='function' && reg.get(MESSENGER_ID)) return true;
    const api={
      id:()=>MESSENGER_ID,
      summary:()=>state.messenger.active ? {id:MESSENGER_ID,name:'Nuclear scout',kind:'warning',x:state.messenger.x,y:state.messenger.y} : null,
      body:()=>state.messenger.active ? {x:state.messenger.x,y:state.messenger.y,w:0.75,h:1.65} : null,
      nudge(dx){ if(state.messenger.active) state.messenger.x+=clamp(finite(dx,0),-0.2,0.2); },
      update(dt,player,getTile){
        if(!state.messenger.active) return;
        const pl=player || root.player;
        if(pl && Math.abs(state.messenger.x-pl.x)>18){
          const spot=findMessengerSpot(pl,getTile);
          state.messenger.x=spot.x; state.messenger.y=spot.y;
        }
      },
      draw(ctx,tile,canDrawTile){
        if(!state.messenger.active || !ctx) return;
        const x=state.messenger.x, y=state.messenger.y;
        if(canDrawTile && !canDrawTile(Math.floor(x),Math.floor(y))) return;
        const px=x*tile, py=y*tile;
        ctx.save();
        ctx.fillStyle='rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.ellipse(px,py+tile*0.42,tile*0.33,tile*0.10,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#43515a'; ctx.fillRect(px-tile*0.23,py-tile*0.88,tile*0.46,tile*0.70);
        ctx.fillStyle='#d8c2a4'; ctx.fillRect(px-tile*0.18,py-tile*1.14,tile*0.36,tile*0.28);
        ctx.fillStyle='#d8e6ef'; ctx.fillRect(px-tile*0.20,py-tile*1.20,tile*0.40,tile*0.09);
        ctx.fillStyle='#88ff4f'; ctx.fillRect(px+tile*0.03,py-tile*1.05,tile*0.06,tile*0.06);
        ctx.fillStyle='#2f3940'; ctx.fillRect(px-tile*0.17,py-tile*0.18,tile*0.13,tile*0.58);
        ctx.fillRect(px+tile*0.04,py-tile*0.18,tile*0.13,tile*0.58);
        if(now()<state.messenger.talkUntil){
          const text=messengerLine();
          ctx.font=Math.max(10,Math.floor(tile*0.52))+'px sans-serif';
          const w=Math.min(tile*15,Math.max(tile*7,ctx.measureText(text).width+tile));
          const bx=px-w*0.5, by=py-tile*2.25;
          ctx.fillStyle='rgba(18,24,28,0.82)';
          ctx.fillRect(bx,by,w,tile*0.82);
          ctx.fillStyle='#f4fbff';
          ctx.fillText(text,bx+tile*0.35,by+tile*0.53);
        }
        ctx.restore();
      },
      interactAt(tx,ty){
        if(!state.messenger.active) return false;
        if(Math.abs((tx+0.5)-state.messenger.x)>1.2 || Math.abs((ty+0.5)-state.messenger.y)>1.8) return false;
        state.messenger.talkUntil=now()+5500;
        try{ if(root.msg) root.msg('Nuclear scout: '+messengerLine()); }catch(e){}
        return true;
      },
      snapshot:()=>Object.assign({},state.messenger),
      restore(src){
        if(!src || typeof src!=='object') return false;
        state.messenger.active=!!src.active;
        state.messenger.x=finite(src.x,state.x);
        state.messenger.y=finite(src.y,state.y);
        state.messenger.talkUntil=finite(src.talkUntil,0);
        return true;
      },
      reset(){ state.messenger.active=false; state.messenger.talkUntil=0; }
    };
    try{ reg.register(MESSENGER_ID,api); return true; }catch(e){ return false; }
  }
  function activateMessenger(player,getTile){
    registerMessenger();
    const spot=findMessengerSpot(player,getTile);
    state.messenger.active=true;
    state.messenger.x=spot.x;
    state.messenger.y=spot.y;
    state.messenger.talkUntil=now()+9000;
    try{ if(root.msg) root.msg('Nuclear scout: A nuclear bomb was detonated. Atomic winter has started and will last one year.'); }catch(e){}
  }
  function trigger(opts){
    opts=opts||{};
    const player=opts.player || root.player || null;
    const getTile=opts.getTile || (MM.world && MM.world.getTile ? ((x,y)=>MM.world.getTile(x,y)) : null);
    state.active=true;
    state.tLeft=yearLength();
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
    activateMessenger(player,getTile);
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
    if(raining){
      state.rainAcc+=dt;
      state.healAcc+=dt;
      while(state.rainAcc>=1){
        state.rainAcc-=1;
        try{ if(typeof root.damageHero==='function') root.damageHero(TOXIC_RAIN_DAMAGE,{cause:'radiation_rain',srcX:pl.x,srcY:pl.y-6,kb:0.6,kbY:-0.2,invulMs:260}); }catch(e){}
      }
      while(state.healAcc>=1){
        state.healAcc-=1;
        try{ if(MM.mobs && typeof MM.mobs.healRadiationRain==='function') MM.mobs.healRadiationRain(pl.x,90,MOB_RAIN_HEAL,{particles:true}); }catch(e){}
      }
    } else {
      state.rainAcc=Math.min(state.rainAcc,0.95);
      state.healAcc=Math.min(state.healAcc,0.95);
    }
    if(state.messenger.active && pl && Math.hypot(state.messenger.x-pl.x,state.messenger.y-pl.y)>30){
      const spot=findMessengerSpot(pl,getTile);
      state.messenger.x=spot.x;
      state.messenger.y=spot.y;
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
    state.messenger.active=false;
    atomicClouds.length=0;
    releaseWinter();
    try{ if(root.msg) root.msg('Atomic winter ended as the next winter cycle began.'); }catch(e){}
  }
  function reset(){
    const wasForced=state.forcedWinter;
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
    state.messenger.active=false;
    state.messenger.x=0;
    state.messenger.y=0;
    state.messenger.talkUntil=0;
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
      rainAcc:+clamp(finite(state.rainAcc,0),0,1).toFixed(3),
      healAcc:+clamp(finite(state.healAcc,0),0,1).toFixed(3),
      stormRefresh:+clamp(finite(state.stormRefresh,0),0,60).toFixed(3),
      windRefresh:+clamp(finite(state.windRefresh,0),0,120).toFixed(3),
      forcedWinter:!!state.forcedWinter,
      messenger:Object.assign({},state.messenger)
    };
  }
  function restore(src){
    reset();
    registerMessenger();
    if(!src || typeof src!=='object') return false;
    state.active=!!src.active && finite(src.tLeft,0)>0;
    state.tLeft=state.active ? clamp(finite(src.tLeft,yearLength()),0,yearLength()) : 0;
    state.windLeft=clamp(finite(src.windLeft,0),0,dayLength());
    state.x=finite(src.x,0);
    state.y=finite(src.y,0);
    state.energyAcc=clamp(finite(src.energyAcc,0),0,ENERGY_INTERVAL);
    state.rainAcc=clamp(finite(src.rainAcc,0),0,1);
    state.healAcc=clamp(finite(src.healAcc,0),0,1);
    state.stormRefresh=clamp(finite(src.stormRefresh,0),0,60);
    state.windRefresh=clamp(finite(src.windRefresh,0),0,120);
    if(src.messenger && typeof src.messenger==='object'){
      state.messenger.active=!!src.messenger.active;
      state.messenger.x=finite(src.messenger.x,state.x);
      state.messenger.y=finite(src.messenger.y,state.y);
      state.messenger.talkUntil=finite(src.messenger.talkUntil,0);
    }
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
      toxicRain:state.active,
      messengerActive:!!state.messenger.active
    };
  }

  registerMessenger();
  const api={trigger,update,reset,snapshot,restore,metrics,isActive:()=>!!state.active,toxicRainAt,_debug:{state,YEAR_SECONDS,WIND_BOOST_SECONDS}};
  MM.atomicWinter=api;
})();

export const atomicWinter = (typeof window!=='undefined' && window.MM) ? window.MM.atomicWinter : undefined;
export default atomicWinter;
