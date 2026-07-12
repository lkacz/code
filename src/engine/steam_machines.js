// Steam circuit machines: the physical water → heat → steam → motion chain.
//
// KOCIOŁ PAROWY (T.STEAM_BOILER): tanks whole adjacent water tiles, then
// boils them into pressurized steam. Heat comes from the electric network
// (dynamo flow / solar / batteries nearby) OR for free
// from adjacent lava/embers — park a boiler over the ember arches and it runs
// on the landscape. A full tank vents excess as REAL T.STEAM gas tiles: the
// plume rises, condenses back into water high up (gases.js condensate) and
// spins any dynamo it passes — nothing here is a special effect, it is all
// the same simulated matter.
//
// DYSZA PAROWA (T.STEAM_JET): drinks pressure from the nearest boiler within
// feed range and blasts a rising steam column. On the ground that column is an
// updraft elevator (hero and loose drops ride it — the honest way to reach the
// sky biomes). As the bottom row of a built mech it becomes a flight drive —
// engine/mechs.js implements the seated thrust; this module owns the world
// physics and the shared tuning table below so both sides agree on rates.
//
// Registry discipline (app-perf contract): no per-frame world scans — machines
// are found by a throttled sweep around the player plus onTileChanged pokes,
// and every entry re-validates its tile before ticking.
import { T, TILE, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSolidCollisionTile } from './material_physics.js';

(function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  // Shared physics table — mechs.js reads these so a flying hull burns the
  // same steam the ground jet does. Water is measured in the water sim's
  // sub-tile units (one world tile = 10), steam in "pressure" units.
  const STEAM_CFG = Object.freeze({
    WATER_PER_TILE: 10,        // one absorbed water tile fills 10 tank units
    BOILER_WATER_CAP: 30,      // three tiles of water aboard
    BOILER_STEAM_CAP: 60,
    BOIL_RATE: 6,              // steam units/s at full heat
    STEAM_PER_WATER: 2,        // 1 water unit boils into 2 steam units
    BOIL_ENERGY_PER_SEC: 1.6,  // electric heat cost (lava heat is free)
    LAVA_HEAT_RADIUS: 1,       // chebyshev ring that counts as a firebox
    VENT_THRESHOLD: 0.85,      // tank fraction above which the safety valve blows
    VENT_COST: 3,              // steam units per vented gas cell
    JET_FEED_RADIUS: 5,        // manhattan reach from jet to its boiler
    JET_LIFT_HEIGHT: 12,       // updraft column height (stops at solids)
    JET_LIFT_ACCEL: 30,        // tiles/s^2 at the nozzle, fades with height
    JET_MAX_RISE: 9,           // updraft terminal velocity
    JET_BURN_ACTIVE: 3,        // steam/s while something rides the column
    JET_BURN_IDLE: 0.6,        // steam/s hiss while pressurized but unused
    MECH_THRUST_ACCEL: 26,     // seated flight: upward acceleration
    MECH_MAX_ASCENT: 7.5,      // seated flight: climb speed cap
    MECH_THRUST_BURN: 6.5,     // steam/s while W is held
    SWEEP_INTERVAL: 2.5,       // seconds between registry sweeps
    SWEEP_RX: 90, SWEEP_RY: 60
  });

  const boilers = new Map(); // "x,y" -> {x,y,water,steam,heat,ventT,puffT,drinkT}
  const jets = new Map();    // "x,y" -> {x,y,fedT,liftT,puffT}
  // Tank state of boilers knocked loose (a boiler is a rigid-object machine,
  // so mining its support makes the tile fall): the registry is position-keyed
  // and would otherwise re-register the landed boiler with an empty tank. The
  // stash keeps the charge for a few seconds so the same-column landing (or a
  // quick re-place) inherits it instead of silently venting everything.
  const orphanTanks = [];
  const ORPHAN_TTL = 6, ORPHAN_MAX = 24;
  let sweepAcc = STEAM_CFG.SWEEP_INTERVAL; // first update sweeps immediately
  let simT = 0;
  const metricsState = {boilers:0, jets:0, boiled:0, vented:0, lifted:0, waterDrunk:0, lavaHeat:0, energyHeat:0};

  const key=(x,y)=>x+','+y;
  const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
  const finite=(v)=>typeof v==='number' && isFinite(v);
  function getSafe(getTile,x,y){ try{ return getTile ? getTile(x,y) : T.AIR; }catch(e){ return T.AIR; } }
  function isSolid(t){ return isSolidCollisionTile(t); }

  function boilerAt(x,y){ return boilers.get(key(x|0,y|0)) || null; }
  function jetAt(x,y){ return jets.get(key(x|0,y|0)) || null; }
  function ensureBoiler(x,y){
    const k=key(x,y);
    let b=boilers.get(k);
    if(!b){ b={x,y,water:0,steam:0,heat:0,ventT:0,puffT:0,drinkT:0}; boilers.set(k,b); }
    return b;
  }
  function ensureJet(x,y){
    const k=key(x,y);
    let j=jets.get(k);
    if(!j){ j={x,y,fedT:0,liftT:0,puffT:0}; jets.set(k,j); }
    return j;
  }

  function stashOrphanTank(b){
    if(!b || (b.water<=0.01 && b.steam<=0.01)) return;
    orphanTanks.push({x:b.x,y:b.y,water:b.water,steam:b.steam,t:simT});
    if(orphanTanks.length>ORPHAN_MAX) orphanTanks.shift();
  }
  // Falling machines land straight down: adopt only a same-column stash at or
  // below the origin, and only into an empty tank (a primed boiler keeps its
  // own charge — park continuity writes exact values after this).
  function adoptOrphanTank(b){
    if(!b || b.water>0.01 || b.steam>0.01) return false;
    for(let i=orphanTanks.length-1;i>=0;i--){
      const o=orphanTanks[i];
      if(simT-o.t>ORPHAN_TTL){ orphanTanks.splice(i,1); continue; }
      if(o.x===b.x && b.y>=o.y){
        b.water=clamp(o.water,0,STEAM_CFG.BOILER_WATER_CAP);
        b.steam=clamp(o.steam,0,STEAM_CFG.BOILER_STEAM_CAP);
        orphanTanks.splice(i,1);
        return true;
      }
    }
    return false;
  }
  function dropBoilerEntry(x,y){
    const k=key(x,y);
    const b=boilers.get(k);
    if(b){ stashOrphanTank(b); boilers.delete(k); }
  }

  // Tile edits poke the registry so freshly placed machines wake without
  // waiting for the sweep, and removed ones stop ticking immediately.
  function onTileChanged(x,y,oldT,newT){
    if(newT===T.STEAM_BOILER) adoptOrphanTank(ensureBoiler(x|0,y|0));
    else if(oldT===T.STEAM_BOILER) dropBoilerEntry(x|0,y|0);
    if(newT===T.STEAM_JET) ensureJet(x|0,y|0);
    else if(oldT===T.STEAM_JET) jets.delete(key(x|0,y|0));
  }

  function sweep(player,getTile){
    if(!player || !finite(player.x) || !finite(player.y)) return;
    const x0=Math.floor(player.x-STEAM_CFG.SWEEP_RX), x1=Math.floor(player.x+STEAM_CFG.SWEEP_RX);
    const y0=Math.max(WORLD_MIN_Y,Math.floor(player.y-STEAM_CFG.SWEEP_RY));
    const y1=Math.min(WORLD_MAX_Y-1,Math.floor(player.y+STEAM_CFG.SWEEP_RY));
    const peek=(MM.world && MM.world.peekTile) ? (x,y)=>MM.world.peekTile(x,y,T.AIR) : getTile;
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const t=peek(x,y);
        if(t===T.STEAM_BOILER) ensureBoiler(x,y);
        else if(t===T.STEAM_JET) ensureJet(x,y);
      }
    }
  }

  // Registry validation reads: prefer the world's non-generating peek with a
  // sentinel fallback so a machine in a not-yet-generated chunk (fresh load,
  // player far away) is skipped instead of force-generating chunks every frame
  // or being wrongly deleted. UNKNOWN_TILE never collides with a real tile id.
  const UNKNOWN_TILE=-1;
  function tileForValidation(getTile,x,y){
    const w=MM.world;
    if(w && typeof w.peekTile==='function'){
      try{ return w.peekTile(x,y,UNKNOWN_TILE); }catch(e){ return UNKNOWN_TILE; }
    }
    return getSafe(getTile,x,y);
  }
  function lavaHeatNear(x,y,getTile){
    const r=STEAM_CFG.LAVA_HEAT_RADIUS;
    for(let dy=-r;dy<=r;dy++){
      for(let dx=-r;dx<=r;dx++){
        if(!dx && !dy) continue;
        const t=getSafe(getTile,x+dx,y+dy);
        if(t===T.LAVA || t===T.HOT_AIR) return true;
      }
    }
    return false;
  }
  function scanSolarCells(x,y,getTile){
    const cells=[];
    for(let dy=-3;dy<=3;dy++){
      for(let dx=-3;dx<=3;dx++){
        const t=getSafe(getTile,x+dx,y+dy);
        if(t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY) cells.push([x+dx,y+dy]);
      }
    }
    return cells;
  }
  function drainElectricHeat(b,amount,getTile){
    let got=0;
    try{
      const dyn=MM.dynamo;
      if(dyn && typeof dyn.absorbNear==='function'){
        const res=dyn.absorbNear(b.x+0.5,b.y+0.5,amount,getTile,4);
        if(res && res.amount>0) got+=Math.min(amount,Number(res.amount)||0);
      }
    }catch(e){}
    if(got<amount){
      try{
        const sol=MM.solar;
        if(sol && typeof sol.drainAt==='function'){
          // app-perf contract: no 7x7 tile scan per frame — the panel/battery
          // positions live in a cross-frame cache with a TTL, refreshed early
          // when the cached cells run dry (panel mined, battery drained).
          if(!Array.isArray(b.solarCells) || simT>=(b.solarRescanAt||0)){
            b.solarCells=scanSolarCells(b.x,b.y,getTile);
            b.solarRescanAt=simT+2.4;
          }
          for(const [sx,sy] of b.solarCells){
            if(got>=amount) break;
            const res=sol.drainAt(sx,sy,amount-got,getTile);
            if(res && res.amount>0) got+=res.amount;
          }
          if(got<amount && b.solarCells.length) b.solarRescanAt=Math.min(b.solarRescanAt,simT+0.5);
        }
      }catch(e){}
    }
    return got;
  }
  // Drink from adjacent surface water: whole tiles, volume-true against the
  // tank (one absorbed tile = WATER_PER_TILE units).
  function drinkWater(b,getTile,setTile,dt){
    if(b.water>STEAM_CFG.BOILER_WATER_CAP-STEAM_CFG.WATER_PER_TILE) return;
    b.drinkT-=dt;
    if(b.drinkT>0) return;
    b.drinkT=0.9;
    const spots=[[0,-1],[-1,0],[1,0],[0,1]];
    for(const [dx,dy] of spots){
      const x=b.x+dx, y=b.y+dy;
      if(getSafe(getTile,x,y)!==T.WATER) continue;
      try{ setTile(x,y,T.AIR); }catch(e){ return; }
      b.water=Math.min(STEAM_CFG.BOILER_WATER_CAP,b.water+STEAM_CFG.WATER_PER_TILE);
      metricsState.waterDrunk++;
      return;
    }
  }
  function ventSteam(b,getTile,setTile){
    if(b.steam<STEAM_CFG.BOILER_STEAM_CAP*STEAM_CFG.VENT_THRESHOLD) return;
    if(b.ventT>0) return;
    b.ventT=0.8;
    const above=getSafe(getTile,b.x,b.y-1);
    if(above!==T.AIR && above!==T.STEAM) return;
    try{
      const g=MM.gases;
      if(g && typeof g.add==='function'){
        g.add('steam',b.x,b.y-1,{getTile,setTile,power:0.5});
        b.steam=Math.max(0,b.steam-STEAM_CFG.VENT_COST);
        metricsState.vented++;
      }
    }catch(e){}
  }
  function tickBoiler(b,dt,getTile,setTile){
    const here=tileForValidation(getTile,b.x,b.y);
    if(here===UNKNOWN_TILE) return; // chunk not generated yet — keep, don't tick
    if(here!==T.STEAM_BOILER){ dropBoilerEntry(b.x,b.y); return; }
    b.ventT=Math.max(0,b.ventT-dt);
    b.puffT=Math.max(0,b.puffT-dt);
    drinkWater(b,getTile,setTile,dt);
    // heat: free from adjacent lava/embers, otherwise bought from the network
    let heat=0;
    if(b.water>0.01 && b.steam<STEAM_CFG.BOILER_STEAM_CAP-0.01){
      if(lavaHeatNear(b.x,b.y,getTile)){
        heat=1;
        metricsState.lavaHeat+=dt;
      }else{
        const wantEnergy=STEAM_CFG.BOIL_ENERGY_PER_SEC*dt;
        const got=drainElectricHeat(b,wantEnergy,getTile);
        heat=wantEnergy>0 ? clamp(got/wantEnergy,0,1) : 0;
        if(got>0) metricsState.energyHeat+=got;
      }
    }
    if(heat>0){
      const boiledSteam=Math.min(
        STEAM_CFG.BOIL_RATE*heat*dt,
        b.water*STEAM_CFG.STEAM_PER_WATER,
        STEAM_CFG.BOILER_STEAM_CAP-b.steam
      );
      if(boiledSteam>0){
        b.water=Math.max(0,b.water-boiledSteam/STEAM_CFG.STEAM_PER_WATER);
        b.steam+=boiledSteam;
        metricsState.boiled+=boiledSteam;
      }
    }
    b.heat=heat;
    ventSteam(b,getTile,setTile);
  }

  function feedingBoiler(j){
    let best=null, bd=Infinity;
    for(const b of boilers.values()){
      const d=Math.abs(b.x-j.x)+Math.abs(b.y-j.y);
      if(d<=STEAM_CFG.JET_FEED_RADIUS && b.steam>0.05 && d<bd){ bd=d; best=b; }
    }
    return best;
  }
  function columnHeight(j,getTile){
    let h=0;
    for(let i=1;i<=STEAM_CFG.JET_LIFT_HEIGHT;i++){
      if(isSolid(getSafe(getTile,j.x,j.y-i))) break;
      h=i;
    }
    return h;
  }
  function liftEntity(e,j,h,dt){
    if(!e || !finite(e.x) || !finite(e.y)) return false;
    // entity width counts: a hero half-overlapping the column edge still rides
    const halfW=Math.max(0,(Number(e.w)||0)*0.5);
    const inX=e.x+halfW>=j.x-0.05 && e.x-halfW<=j.x+1.05;
    const rise=j.y-e.y; // how far above the nozzle
    if(!inX || rise<-0.2 || rise>h) return false;
    const fall=1-clamp(rise/Math.max(1,h),0,1)*0.6; // fades with height
    e.vy=Math.max(-STEAM_CFG.JET_MAX_RISE,(e.vy||0)-STEAM_CFG.JET_LIFT_ACCEL*fall*dt);
    return true;
  }
  function puff(j,h){
    try{
      const p=MM.particles;
      if(p && p.spawnSmoke){
        p.spawnSmoke((j.x+0.5)*TILE,(j.y-Math.random()*Math.max(1,h*0.7))*TILE,0.5,{});
      }else if(p && p.spawnBurst && Math.random()<0.3){
        p.spawnBurst((j.x+0.5)*TILE,(j.y-0.5)*TILE,'common');
      }
    }catch(e){}
  }
  function tickJet(j,dt,player,getTile,setTile){
    const here=tileForValidation(getTile,j.x,j.y);
    if(here===UNKNOWN_TILE) return; // chunk not generated yet — keep, don't tick
    if(here!==T.STEAM_JET){ jets.delete(key(j.x,j.y)); return; }
    j.puffT=Math.max(0,j.puffT-dt);
    const b=feedingBoiler(j);
    if(!b){ j.fedT=0; j.liftT=0; return; }
    const h=columnHeight(j,getTile);
    if(h<=0){ j.fedT=0; return; }
    let lifting=false;
    if(player && liftEntity(player,j,h,dt)) lifting=true;
    try{
      const drops=MM.drops && MM.drops._debug && MM.drops._debug.list;
      if(Array.isArray(drops)){
        for(const d of drops){
          if(d && liftEntity(d,j,h,dt)){ d.settled=false; lifting=true; }
        }
      }
    }catch(e){}
    const burn=(lifting?STEAM_CFG.JET_BURN_ACTIVE:STEAM_CFG.JET_BURN_IDLE)*dt;
    b.steam=Math.max(0,b.steam-burn);
    j.fedT=Math.min(1,(j.fedT||0)+dt*3);
    if(lifting){
      j.liftT=Math.min(1,(j.liftT||0)+dt*4);
      metricsState.lifted+=dt;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('steam_lift','Kolumna pary unosi wszystko nad dyszą!'); }catch(e){}
    }else{
      j.liftT=Math.max(0,(j.liftT||0)-dt*2);
    }
    if(j.puffT<=0){
      j.puffT=lifting?0.09:0.3;
      puff(j,h);
      // occasional true gas so the column reads on the simulation too
      if(Math.random()<(lifting?0.35:0.12)){
        try{
          const g=MM.gases;
          const gy=j.y-1-Math.floor(Math.random()*Math.max(1,h-1));
          if(g && g.add && getSafe(getTile,j.x,gy)===T.AIR) g.add('steam',j.x,gy,{getTile,setTile});
        }catch(e){}
      }
    }
  }

  function update(dt,player,getTile,setTile){
    if(!(dt>0) || typeof getTile!=='function') return;
    simT+=dt;
    sweepAcc+=dt;
    if(sweepAcc>=STEAM_CFG.SWEEP_INTERVAL){
      sweepAcc=0;
      sweep(player,getTile);
    }
    // Map iteration is delete-safe in JS (ticks only ever delete entries),
    // so no per-frame defensive array copies.
    for(const b of boilers.values()) tickBoiler(b,dt,getTile,setTile);
    for(const j of jets.values()) tickJet(j,dt,player,getTile,setTile);
    metricsState.boilers=boilers.size;
    metricsState.jets=jets.size;
  }

  // Gauge overlays: water (blue) and pressure (white) bars on the boiler face,
  // a shimmering column above a fed jet. Called from the world FX pass.
  function draw(ctx,tilePx,camX,camY,viewX,viewY,visibleTile){
    const TS=tilePx||TILE;
    for(const b of boilers.values()){
      if(visibleTile && !visibleTile(b.x,b.y)) continue;
      const px=b.x*TS, py=b.y*TS;
      const waterFrac=clamp(b.water/STEAM_CFG.BOILER_WATER_CAP,0,1);
      const steamFrac=clamp(b.steam/STEAM_CFG.BOILER_STEAM_CAP,0,1);
      ctx.fillStyle='rgba(10,14,20,0.55)';
      ctx.fillRect(px+3,py+TS-6,TS-6,3);
      ctx.fillStyle='rgba(72,180,255,0.9)';
      ctx.fillRect(px+3,py+TS-6,(TS-6)*waterFrac,3);
      ctx.fillStyle='rgba(10,14,20,0.55)';
      ctx.fillRect(px+3,py+3,TS-6,3);
      ctx.fillStyle=steamFrac>STEAM_CFG.VENT_THRESHOLD?'rgba(255,220,150,0.95)':'rgba(235,242,248,0.9)';
      ctx.fillRect(px+3,py+3,(TS-6)*steamFrac,3);
      if(b.heat>0.05){
        ctx.fillStyle='rgba(255,140,60,'+(0.25+0.25*Math.sin(simT*6))+')';
        ctx.fillRect(px+TS*0.5-2,py+TS-3,4,2);
      }
    }
    for(const j of jets.values()){
      if(!(j.fedT>0.05)) continue;
      if(visibleTile && !visibleTile(j.x,j.y)) continue;
      const px=j.x*TS, py=j.y*TS;
      const a=0.10+j.fedT*0.14+(j.liftT||0)*0.10;
      for(let i=1;i<=4;i++){
        const w=TS*(0.72-i*0.09);
        ctx.fillStyle='rgba(223,232,238,'+(a*(1-i*0.18)).toFixed(3)+')';
        ctx.fillRect(px+(TS-w)/2, py-i*TS+TS*0.2+Math.sin(simT*7+i)*2, w, TS*0.7);
      }
    }
  }

  function snapshot(){
    // empty tanks carry no state worth saving: the sweep re-registers those
    // boilers for free, so only charged ones ride the save file
    const charged=[];
    for(const b of boilers.values()){
      if(b.water<=0.005 && b.steam<=0.005) continue;
      charged.push({x:b.x,y:b.y,w:+b.water.toFixed(2),s:+b.steam.toFixed(2)});
      if(charged.length>=600) break;
    }
    return {v:1, boilers:charged};
  }
  function restore(data,getTile){
    reset();
    if(!data || !Array.isArray(data.boilers)) return false;
    for(const r of data.boilers.slice(0,600)){
      if(!r || !finite(r.x) || !finite(r.y)) continue;
      // validate against generated chunks only: an UNKNOWN_TILE entry is kept
      // and re-checked by its first tick instead of force-generating the
      // chunk at load time (and instead of being silently dropped)
      const here=tileForValidation(getTile,r.x|0,r.y|0);
      if(here!==UNKNOWN_TILE && here!==T.STEAM_BOILER) continue;
      const b=ensureBoiler(r.x|0,r.y|0);
      b.water=clamp(Number(r.w)||0,0,STEAM_CFG.BOILER_WATER_CAP);
      b.steam=clamp(Number(r.s)||0,0,STEAM_CFG.BOILER_STEAM_CAP);
    }
    return true;
  }
  function reset(){
    boilers.clear();
    jets.clear();
    orphanTanks.length=0;
    sweepAcc=STEAM_CFG.SWEEP_INTERVAL;
    metricsState.boiled=0; metricsState.vented=0; metricsState.lifted=0;
    metricsState.waterDrunk=0; metricsState.lavaHeat=0; metricsState.energyHeat=0;
  }
  function metrics(){
    // live tank totals ride along for QA drivers and debug overlays
    let tankedWater=0, pressure=0;
    for(const b of boilers.values()){ tankedWater+=b.water; pressure+=b.steam; }
    return Object.assign({tankedWater:+tankedWater.toFixed(2), pressure:+pressure.toFixed(2)}, metricsState);
  }
  // Mech continuity: assembling a hull lifts the world boiler's tank into the
  // mech (mechs.js reads boilerAt before the carve); parking pours it back.
  function primeBoilerAt(x,y,water,steam){
    const b=ensureBoiler(x|0,y|0);
    b.water=clamp(Number(water)||0,0,STEAM_CFG.BOILER_WATER_CAP);
    b.steam=clamp(Number(steam)||0,0,STEAM_CFG.BOILER_STEAM_CAP);
    return b;
  }

  const api={
    CFG:STEAM_CFG,
    update, draw, onTileChanged,
    boilerAt, jetAt, primeBoilerAt,
    snapshot, restore, reset, metrics,
    _debug:{boilers, jets, orphanTanks, ensureBoiler, ensureJet, tickBoiler, tickJet, feedingBoiler, columnHeight}
  };
  MM.steamMachines=api;
})();

// Resolve through the same root the IIFE wrote to, so headless tests that set
// up globalThis without a window alias still get the module object.
const _root = typeof window !== 'undefined' ? window : globalThis;
export const steamMachines = _root.MM ? _root.MM.steamMachines : undefined;
export default steamMachines;
