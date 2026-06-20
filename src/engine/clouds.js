// Dynamic weather system: a closed water cycle layered on top of the fluid sim.
//
//   evaporation  — sun-exposed water surfaces lose volume to a regional vapor field
//                  (rate scales with sunlight, climate temperature and air humidity)
//   condensation — when a region's vapor passes its dew threshold (cold air condenses
//                  sooner) the vapor nucleates into a drifting cloud
//   clouds       — parcels with position, altitude and mass; they ride a slowly
//                  changing wind, absorb vapor they pass over, merge when they touch
//                  ("cumulate"), and new ones blow in from beyond the simulated band
//   precipitation— a cloud rains when its mass exceeds the saturation capacity of the
//                  air around it. Capacity falls with temperature, so nightfall, cold
//                  climates and high altitude all trigger rain; very large clouds
//                  exceed any capacity and storm on their own. Cold ground turns the
//                  fall into snow (cosmetic flakes; mass sublimates back to vapor).
//   deposition   — rained mass accumulates per column and materializes as real WATER
//                  tiles fed to MM.water (puddles flow, lakes refill, oceans rise).
//
// Bookkeeping is volume-true: 1.0 cloud/vapor mass == one water tile. Tile removal is
// deferred per column (fractional accumulator), so lakes drain slowly while vapor and
// clouds respond quickly. Everything below the rendering section runs headless (Node
// tests stub MM.worldGen / MM.water — see tools/clouds-sim.test.mjs).
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H} = MM;

  // ---------------- Tunables (exposed as MM.clouds.config) ----------------
  const CFG = {
    ACTIVE_HALF: 320,     // half-width (columns) of the simulated weather band
    EVAP_RADIUS: 200,     // evaporation scan half-width around the player
    EVAP_SCAN_COLS: 48,   // columns scanned per tick (sliced sweep)
    EVAP_BASE: 1/800,     // tiles/sec lost per exposed surface at full sun + heat
    EVAP_SCAN_ABOVE: 36,  // only water within this many rows above terrain evaporates
    HUM_CAP: 12,          // regional vapor at which air is saturated (evap stops)
    REGION_W: 48,         // humidity region width (columns)
    CONDENSE_MASS: 5,     // base vapor needed to nucleate a cloud (scaled by temp)
    CLOUD_CAP: 26,        // max simultaneous clouds
    CAP_MIN: 7,           // saturation capacity of coldest air (mass units)
    CAP_MAX: 24,          // saturation capacity of warmest air
    ABS_MAX: 32,          // above this mass a cloud storms regardless of temperature
    RAIN_RATE_BASE: 0.08, // mass/sec shed at the rain threshold
    RAIN_RATE_GAIN: 0.018,// extra mass/sec per unit of excess over capacity
    DEPOSIT_RADIUS: 240,  // rain materializes as tiles only this close to the player
    ABSORB_RATE: 0.06,    // mass/sec a cloud drinks from the vapor under it
    DISSIPATE: 0.10,      // mass/sec a starved cloud re-evaporates
    BORDER_SPAWN: true,   // clouds drifting in from unsimulated regions
    SPAWN_CHANCE: 0.025,  // per-second chance of an incoming cloud (wind-scaled)
    WIND_MAX: 2.5,        // wind amplitude (tiles/sec)
    DROP_CAP: 420,        // visual raindrop budget
    WISP_CAP: 70,         // evaporation mist budget
    CLOUD_VISUAL_X: 4,    // horizontal cloud footprint multiplier (visual/weather spread)
    CLOUD_SHADOWS: false, // terrain shadows read like fake water films in tile view
    LIGHTNING_MIN: 20,    // cloud mass required for lightning (relaxed during storms)
    LIGHTNING_BASE: 0.05, // per-second strike chance per eligible cloud
    LIGHTNING_TELEPORT_CHANCE: 0.10, // rare lightning curse: fling the hero far away
    LIGHTNING_TELEPORT_MIN: 500,
    LIGHTNING_TELEPORT_MAX: 1500,
    LIGHTNING_ENERGY_CHARGE: 50,
    LIGHTNING_DYNAMO_ATTRACT_RADIUS: 7,
    LIGHTNING_DYNAMO_ATTRACT_CHANCE: 0.42,
    STORMS: true,         // random storm fronts (the startStorm API works regardless)
    STORM_CHANCE: 0.028,  // per-10s chance a front rolls in (~1 storm / 6 min average)
    STORM_FEED: 0.6,      // mass/sec a storm pumps into clouds overhead
    STRIKE_RADIUS: 160,   // lightning only strikes ground this close to the player
  };

  // ---------------- State ----------------
  let clouds = [];
  const vapor = new Map();      // regionIdx -> mass
  const evapAcc = new Map();    // column -> fractional tile-removal debt
  const drops = [];             // cosmetic precipitation {x,y,vx,vy,snow,phase}
  const wisps = [];             // cosmetic evaporation mist {x,y,life,max,r}
  let farBudget = 24;           // off-band moisture reserve feeding incoming clouds
  let simT = 0;                 // internal clock (deterministic under fixed-dt tests)
  let evapOffset = 0;
  let regionAcc = 0, mergeAcc = 0, spawnAcc = 0, stormCheckAcc = 0;
  let evapMass = 0, rainMass = 0; // lifetime counters (metrics/conservation tests)
  let strikes = 0, chestsMade = 0;
  let cloudSeq = 1;
  let windOverride = null, cycleOverride = null;
  const bolts = [];             // live lightning visuals {pts,branches,t,max,ix,iy}
  let viewFlash = 0;            // whole-screen lightning flash intensity
  const storm = {active:false, tLeft:0, intensity:0, cooldown:0};
  let audioCtx = null;
  const SAVE_MAP_LIMIT = 192;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function finiteNum(v,fallback){ return (typeof v==='number' && isFinite(v)) ? v : fallback; }
  function roundSave(v,digits){
    if(typeof v!=='number' || !isFinite(v)) return 0;
    const m=Math.pow(10,digits||3);
    return Math.round(v*m)/m;
  }
  function safeSeed(v,fallback){
    return (typeof v==='number' && isFinite(v)) ? (v>>>0) : (fallback>>>0);
  }
  function mulberry(seed){ let a=seed>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

  // ---------------- Environment sampling ----------------
  function cycleInfo(){
    if(cycleOverride) return cycleOverride;
    const bg=MM.background;
    if(bg && bg.getCycleInfo) return bg.getCycleInfo();
    return {cycleT:0.25, isDay:true, tDay:0.5};
  }
  function sunIntensity(){ const c=cycleInfo(); return c.isDay? Math.sin(clamp(c.tDay,0,1)*Math.PI) : 0; }
  function seasonProfile(){
    const s=MM.seasons;
    if(s && typeof s.profile==='function'){
      try{ return s.profile() || {}; }catch(e){}
    }
    return {};
  }
  function seasonNumber(key,fallback){
    const v=seasonProfile()[key];
    return (typeof v==='number' && isFinite(v)) ? v : fallback;
  }
  function seaLevel(){ const wg=MM.worldGen; return (wg && wg.settings && wg.settings.seaLevel!=null)? wg.settings.seaLevel : 62; }
  // Terrain surface for weather purposes: oceans count from the waterline, not the seabed
  function effSurf(x){
    const wg=MM.worldGen;
    const s=(wg && wg.surfaceHeight)? wg.surfaceHeight(Math.round(x)) : 70;
    return Math.min(s, seaLevel());
  }
  // Air temperature 0..1: climate band + day/night swing − altitude lapse.
  // Drives evaporation speed, dew thresholds and the rain/snow decision.
  function airTemp(x,row){
    const wg=MM.worldGen;
    const clim=(wg && wg.temperature)? wg.temperature(Math.round(x)) : 0.5;
    const c=cycleInfo();
    const diurnal = c.isDay? (-0.04 + 0.22*Math.sin(clamp(c.tDay,0,1)*Math.PI))
                           : (-0.10 - 0.08*Math.sin(clamp(c.tDay,0,1)*Math.PI));
    const lapse = Math.max(0, seaLevel()-row)*0.005;
    return clim + diurnal - lapse + seasonNumber('temperatureDelta',0);
  }
  // How much water vapor the air around a cloud can hold before it must rain
  function capacity(t){ return CFG.CAP_MIN + (CFG.CAP_MAX-CFG.CAP_MIN)*clamp((t-0.05)/0.75,0,1); }
  function windAt(){
    if(windOverride!=null) return windOverride;
    const shared=MM.wind;
    if(shared && typeof shared.speed === 'function') return shared.speed();
    const sd=((MM.worldGen && MM.worldGen.worldSeed)||1)%97;
    let w=Math.sin(simT*0.013+sd)*1.5 + Math.sin(simT*0.0031+sd*0.7)*1.0;
    if(storm.active) w=w*(1+0.8*storm.intensity)+Math.sin(simT*1.7)*0.6*storm.intensity; // gusts
    return w;
  }
  function regionOf(x){ return Math.floor(x/CFG.REGION_W); }
  function addVapor(r,m){ vapor.set(r,(vapor.get(r)||0)+m); }
  // Public vapor injection at a world column (steam from boiled-off water tiles —
  // keeps the cycle volume-true: 1.0 mass == one water tile)
  function injectVapor(x,m){ if(typeof x!=='number'||!isFinite(x)||!(m>0)) return; addVapor(regionOf(x), Math.min(m,5)); }
  // Is liquid rain falling over column x right now? (plants drink from it)
  function isRainingAt(x){
    if(typeof x!=='number'||!isFinite(x)) return false;
    for(const c of clouds){ if(c.raining && !c.snowing && Math.abs(c.x-x)<=c.r*1.15*cloudVisualScaleX()) return true; }
    return false;
  }

  // ---------------- Clouds ----------------
  function makePuffs(seed){
    const rng=mulberry(seed);
    const n=Math.round((8+Math.floor(rng()*5))*Math.sqrt(cloudVisualScaleX()));
    const puffs=[];
    for(let i=0;i<n;i++){
      const ox=(rng()*2-1)*0.95;
      const edge=1-Math.abs(ox)*0.55;
      puffs.push({ox, oy:(rng()*0.5-0.32)*edge, s:(0.30+rng()*0.34)*edge+0.18});
    }
    puffs.push({ox:0, oy:-0.08, s:0.62}); // fat core so thin layouts can't look stringy
    return puffs;
  }
  function altTargetFor(x,jit){
    // over extreme peaks the cruising band would leave the world: hug the ceiling
    return Math.max(3, effSurf(x)-(13+jit*9));
  }
  // radius saturates for huge masses so merged storm cells can't demand giant sprites
  function radiusFor(mass){ return 2.6 + Math.sqrt(clamp(mass,0.3,80))*1.05; }
  function makeCloud(x, alt, mass){
    const seed=(cloudSeq++*2654435761)>>>0;
    const rng=mulberry(seed^0x9e37);
    const jit=rng();
    const c={
      x, mass, seed, jit,
      r: radiusFor(mass),
      alt: (alt!=null)? alt : altTargetFor(x,jit),
      vx: windAt(),
      jitterV: (rng()-0.5)*0.3,
      raining:false, snowing:false, depAcc:0,
      flash:0,
      puffs: makePuffs(seed),
      sprite:null, spriteKey:'',
    };
    clouds.push(c);
    return c;
  }
  function addCloud(x, alt, mass){
    if(typeof x!=='number' || !isFinite(x)) return null;
    if(typeof mass!=='number' || !(mass>0)) mass=8;
    if(clouds.length>=CFG.CLOUD_CAP) return null;
    return makeCloud(x, (typeof alt==='number' && isFinite(alt))? alt : null, mass);
  }

  // ---------------- Evaporation (sliced sweep) ----------------
  // A column's exposed surface is the first non-air tile scanning DOWN from the sky:
  // if that tile is water, the sun reaches it (roofs, ice crusts and canopies are hit
  // first and block evaporation; ravine lakes stay open to the sky and do evaporate).
  function evaporateSlice(getTile,setTile,px,dt){
    const sun=sunIntensity();
    if(sun<=0.01) return;
    const span=CFG.EVAP_RADIUS*2+1;
    const sweepDt=dt*span/CFG.EVAP_SCAN_COLS; // each column is visited once per sweep
    for(let i=0;i<CFG.EVAP_SCAN_COLS;i++){
      const wx=px-CFG.EVAP_RADIUS+((evapOffset+i)%span);
      const reg=regionOf(wx);
      const humid=clamp(1-(vapor.get(reg)||0)/CFG.HUM_CAP, 0, 1);
      if(humid<=0.001) continue;                 // saturated air: skip the column walk
      const surf=effSurf(wx);
      const y0=Math.max(2, surf-CFG.EVAP_SCAN_ABOVE);
      let yTop=-1;
      for(let y=y0;y<Math.min(WORLD_H-1,surf+CFG.EVAP_SCAN_ABOVE);y++){
        const t=getTile(wx,y);
        if(skyOpenTile(t)) continue;            // light filters through leaves and thin gases
        if(t===T.WATER) yTop=y;
        break;                                   // anything else shades the column
      }
      if(yTop<0) continue;
      const heat=0.25+0.75*clamp(airTemp(wx,yTop),0,1);
      const rate=CFG.EVAP_BASE*sun*heat*humid;
      if(rate<=0) continue;
      const amt=rate*sweepDt;
      addVapor(reg, amt); evapMass+=amt;          // vapor responds immediately…
      const acc=(evapAcc.get(wx)||0)+amt;         // …tile removal is deferred debt
      if(acc>=1){
        setTile(wx,yTop,T.AIR);
        evapAcc.set(wx,acc-1);
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(wx,yTop,getTile); }catch(e){}
      } else evapAcc.set(wx,acc);
      // morning-mist wisps over actively evaporating water near the player
      if(wisps.length<CFG.WISP_CAP && Math.abs(wx-px)<70 && Math.random()<0.012){
        const TILE=MM.TILE||20;
        wisps.push({x:(wx+Math.random())*TILE, y:(yTop-0.2)*TILE, life:0, max:2.2+Math.random()*1.6, r:3+Math.random()*4});
      }
    }
    evapOffset=(evapOffset+CFG.EVAP_SCAN_COLS)%span;
  }

  // ---------------- Condensation + humidity diffusion ----------------
  function condenseTick(px){
    // Far-field pruning keeps both maps bounded for travelling players: humidity
    // that drifted (or was left behind) beyond twice the simulated band rejoins the
    // off-band reserve, and stale evaporation debt is paid back out of that same
    // reserve — the books stay balanced and neither map grows without bound.
    for(const [r,m] of vapor){
      if(Math.abs((r+0.5)*CFG.REGION_W-px)>CFG.ACTIVE_HALF*2){ vapor.delete(r); farBudget+=m; }
    }
    for(const [x,a] of evapAcc){
      if(Math.abs(x-px)>CFG.EVAP_RADIUS*2){ evapAcc.delete(x); farBudget=Math.max(0,farBudget-a); }
    }
    // gentle diffusion keeps humidity from piling up over one lake forever;
    // residues fold back into the player's home region (never silently dropped,
    // so the vapor field stays volume-true and the map stays small)
    if(vapor.size){
      const moves=[];
      const home=regionOf(px);
      for(const [r,m] of vapor){
        if(m<=0.002){ if(r!==home){ vapor.delete(r); if(m>0) moves.push([home,m]); } continue; }
        const leak=m*0.01;
        moves.push([r-1,leak*0.5],[r+1,leak*0.5],[r,-leak]);
      }
      for(const [r,m] of moves) addVapor(r,m);
    }
    for(const [r,m] of vapor){
      const cx=(r+0.5)*CFG.REGION_W;
      if(Math.abs(cx-px)>CFG.ACTIVE_HALF) continue;
      const t=airTemp(cx, effSurf(cx)-14);
      const need=CFG.CONDENSE_MASS*(0.55+0.9*clamp(t,0,1)); // cold air condenses sooner
      if(m>=need && clouds.length<CFG.CLOUD_CAP){
        const mass=m*0.8;                                    // some humidity stays behind
        vapor.set(r,m-mass);
        makeCloud(cx+(Math.random()-0.5)*CFG.REGION_W, null, mass);
      }
    }
  }

  // ---------------- Lightning ----------------
  // Distant low rumble: one shared noise tail (generated lazily, pitch-varied per
  // strike), delayed and attenuated by distance. Throttled so storm volleys can't
  // stack dozens of sources or re-allocate buffers every strike.
  let thunderBuf=null, thunderBuild=null, lastThunderMs=-1e9;
  function queueThunderBuildStep(fn){
    if(typeof window!=='undefined' && typeof window.requestIdleCallback==='function') window.requestIdleCallback(fn,{timeout:500});
    else if(typeof window!=='undefined') window.setTimeout(()=>fn(null),0);
  }
  function ensureThunderBuffer(){
    if(thunderBuf || thunderBuild || !audioCtx) return;
    const sampleRate=audioCtx.sampleRate||44100;
    const len=Math.floor(sampleRate*2.0);
    const buf=audioCtx.createBuffer(1, len, sampleRate);
    thunderBuild={buf, data:buf.getChannelData(0), i:0, len};
    const step=(deadline)=>{
      const b=thunderBuild;
      if(!b || b.buf!==buf) return;
      const start=(typeof performance!=='undefined') ? performance.now() : Date.now();
      while(b.i<b.len){
        const f=b.i/b.len;
        b.data[b.i]=(Math.random()*2-1)*Math.pow(1-f,1.6);
        b.i++;
        if((b.i&511)===0){
          const elapsed=((typeof performance!=='undefined') ? performance.now() : Date.now())-start;
          const idleLeft=deadline && typeof deadline.timeRemaining==='function' ? deadline.timeRemaining() : 0;
          if(elapsed>2 || (idleLeft>0 && idleLeft<1)) break;
        }
      }
      if(b.i>=b.len){ thunderBuf=b.buf; thunderBuild=null; }
      else queueThunderBuildStep(step);
    };
    queueThunderBuildStep(step);
  }
  function playThunder(distTiles){
    try{
      if(typeof window==='undefined' || !(window.AudioContext||window.webkitAudioContext)) return;
      const nowMs=(typeof performance!=='undefined')? performance.now() : 0;
      if(nowMs-lastThunderMs<350) return;
      lastThunderMs=nowMs;
      if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended'){ try{ audioCtx.resume(); }catch(e){} }
      if(!thunderBuf){ ensureThunderBuffer(); return; }
      const t0=audioCtx.currentTime + Math.min(2.5, distTiles*0.012); // sound lags the flash
      const dur=thunderBuf.duration;
      const src=audioCtx.createBufferSource(); src.buffer=thunderBuf;
      src.playbackRate.value=0.8+Math.random()*0.4;
      const lp=audioCtx.createBiquadFilter(); lp.type='lowpass';
      lp.frequency.setValueAtTime(420,t0); lp.frequency.exponentialRampToValueAtTime(90,t0+dur);
      const g=audioCtx.createGain();
      const vol=Math.max(0.04, 0.5*Math.exp(-distTiles/120));
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.exponentialRampToValueAtTime(vol,t0+0.03);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
      src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
      src.start(t0); src.stop(t0+dur+0.05);
    }catch(e){}
  }
  // Mirror of mobs.damagePlayer: respect i-frames, knock the hero away, respawn at 0.
  function damageHero(amount, srcX){
    const p=(typeof window!=='undefined' && window.player);
    if(!p || typeof p.hp!=='number') return 0;
    if(typeof window.damageHero==='function'){
      return window.damageHero(amount,{srcX, kb:3.5, kbY:-4, cause:'lightning', invulMs:600}) ? amount : 0;
    }
    const now=(typeof performance!=='undefined')? performance.now() : 0;
    if(p.hpInvul && now<p.hpInvul) return 0;
    p.hp-=amount; p.hpInvul=now+600;
    if(typeof p.vx==='number'){ p.vx+=(p.x<srcX? -1:1)*3.5; p.vy=Math.min(p.vy||0,-4); }
    if(p.hp<=0){
      p.hp=0;
      try{
        (window.msg||function(){})('Piorun! Zginąłeś – respawn');
        p.hp=p.maxHp||100;
        if(window.placePlayer) window.placePlayer(true);
      }catch(e){}
    }
    return amount;
  }
  function tileIs(t,id){
    return typeof id==='number' && t===id;
  }
  function tileInfo(t){
    return MM.INFO && MM.INFO[t];
  }
  function isGasTile(t){
    const info=tileInfo(t);
    return !!(info && info.gas);
  }
  function isLeafTile(t){
    return t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED;
  }
  function skyOpenTile(t){
    return t===T.AIR || isLeafTile(t) || isGasTile(t);
  }
  function dryTeleportAir(t){
    return skyOpenTile(t) || tileIs(t,T.TORCH) || tileIs(t,T.GRAVE);
  }
  function dryTeleportSupport(t){
    return typeof t==='number' && !skyOpenTile(t) && t!==T.WATER && !tileIs(t,T.LAVA) && !tileIs(t,T.TORCH) && !tileIs(t,T.GRAVE);
  }
  function dryLandingAt(x,getTile){
    for(let y=2;y<WORLD_H-2;y++){
      const t=getTile(x,y);
      if(skyOpenTile(t)) continue;
      if(dryTeleportSupport(t) && dryTeleportAir(getTile(x,y-1)) && dryTeleportAir(getTile(x,y-2))){
        return {x:x+0.5, y:y-1};
      }
      return null;
    }
    return null;
  }
  function findLightningTeleportSpot(originX,getTile){
    const min=Math.max(1, CFG.LIGHTNING_TELEPORT_MIN||500);
    const max=Math.max(min, CFG.LIGHTNING_TELEPORT_MAX||1500);
    const dir=Math.random()<0.5 ? -1 : 1;
    const target=Math.round(originX + dir*(min + Math.random()*(max-min)));
    for(let r=0;r<=96;r++){
      const candidates = r===0 ? [target] : [target+r, target-r];
      for(const x of candidates){
        const d=Math.abs((x+0.5)-originX);
        if(d<min || d>max) continue;
        const spot=dryLandingAt(x,getTile);
        if(spot) return {x:spot.x, y:spot.y, distance:d};
      }
    }
    return null;
  }
  function maybeTeleportLightningHero(getTile,amount){
    const p=(typeof window!=='undefined' && window.player);
    if(!p || typeof p.x!=='number' || typeof p.y!=='number' || !(amount>0)) return null;
    const chance=CFG.LIGHTNING_TELEPORT_CHANCE;
    if(!(chance>0) || Math.random()>=chance) return null;
    const spot=findLightningTeleportSpot(p.x,getTile);
    if(!spot) return null;
    const fromX=p.x, fromY=p.y;
    if(typeof window.teleportHeroTo==='function'){
      window.teleportHeroTo(spot.x,spot.y,{message:'Piorun wyrzucił cię '+Math.round(spot.distance)+' bloków dalej!', center:true});
    } else {
      p.x=spot.x; p.y=spot.y; p.vx=0; p.vy=0;
      try{ (window.msg||function(){})('Piorun wyrzucił cię '+Math.round(spot.distance)+' bloków dalej!'); }catch(e){}
    }
    return {fromX, fromY, x:p.x, y:p.y, distance:Math.abs(p.x-fromX)};
  }
  function chargeLightningHero(x,y){
    const p=(typeof window!=='undefined' && window.player);
    const amount=Math.max(0, Number(CFG.LIGHTNING_ENERGY_CHARGE)||0);
    if(!p || !(amount>0)) return 0;
    try{
      const energy=MM.heroEnergy;
      if(energy && typeof energy.chargeExternal==='function'){
        return Math.max(0, Number(energy.chargeExternal(amount,{cause:'lightning',source:{x,y},intensity:1.65}))||0);
      }
      if(energy && typeof energy.add==='function'){
        return Math.max(0, Number(energy.add(amount))||0);
      }
    }catch(e){}
    if(typeof p.energy==='number' || typeof p.maxEnergy==='number'){
      const before=Math.max(0, Number(p.energy)||0);
      const max=(typeof p.maxEnergy==='number' && isFinite(p.maxEnergy) && p.maxEnergy>0) ? p.maxEnergy : before+amount;
      p.energy=Math.min(max,before+amount);
      return Math.max(0,p.energy-before);
    }
    return 0;
  }
  function applyElectricReaction(x,y,getTile,setTile){
    try{
      const api=MM.reactions;
      return !!(api && api.apply && api.apply('electric',x,y,getTile,setTile,{source:'lightning'}));
    }catch(e){ return false; }
  }
  function verticalDynamoSlotForCell(x,y,getTile){
    if(T.DYNAMO==null || T.DYNAMO_SLOT==null || typeof getTile!=='function') return null;
    const t=getTile(x,y);
    if(t===T.DYNAMO_SLOT && getTile(x,y-1)===T.DYNAMO && getTile(x,y+1)===T.DYNAMO) return {x,y,hitRole:'slot'};
    if(t===T.DYNAMO && getTile(x,y+1)===T.DYNAMO_SLOT && getTile(x,y+2)===T.DYNAMO) return {x,y:y+1,hitRole:'top'};
    if(t===T.DYNAMO && getTile(x,y-1)===T.DYNAMO_SLOT && getTile(x,y-2)===T.DYNAMO) return {x,y:y-1,hitRole:'bottom'};
    return null;
  }
  function firstBlockingTile(x,fromRow,getTile){
    for(let y=Math.max(1,Math.floor(fromRow));y<WORLD_H;y++){
      const t=getTile(x,y);
      if(skyOpenTile(t)) continue;
      return {x,y,t};
    }
    return null;
  }
  function findDynamoLightningTarget(x,fromRow,getTile){
    const radius=Math.max(0,Math.min(16,Math.floor(CFG.LIGHTNING_DYNAMO_ATTRACT_RADIUS||0)));
    if(radius<=0) return null;
    const baseChance=Math.max(0,Math.min(1,Number(CFG.LIGHTNING_DYNAMO_ATTRACT_CHANCE)||0));
    const chance=Math.max(0,Math.min(1,baseChance*(storm.active?1.55:1)));
    if(chance<=0 || Math.random()>=chance) return null;
    const xi=Math.round(x);
    for(let d=0; d<=radius; d++){
      const cols=d===0 ? [xi] : [xi-d,xi+d];
      for(const tx of cols){
        const hit=firstBlockingTile(tx,fromRow,getTile);
        if(!hit) continue;
        const slot=verticalDynamoSlotForCell(hit.x,hit.y,getTile);
        if(slot && slot.hitRole==='top') return Object.assign(hit,{slot});
      }
    }
    return null;
  }
  function strikeVerticalDynamo(x,y,getTile,setTile){
    const slot=verticalDynamoSlotForCell(x,y,getTile);
    if(!slot || !slot.hitRole) return null;
    let drained=0;
    try{
      const dyn=MM.dynamo;
      if(dyn && typeof dyn.drainAt==='function'){
        const d=dyn.drainAt(slot.x,slot.y,999,getTile);
        drained=d && d.amount ? d.amount : 0;
      }
    }catch(e){}
    const old=getTile(x,y);
    if(old===T.DYNAMO || old===T.DYNAMO_SLOT){
      setTile(x,y,T.AIR);
      try{ if(MM.dynamo && MM.dynamo.onTileChanged) MM.dynamo.onTileChanged(x,y,old,T.AIR); }catch(e){}
      try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
      try{ if(MM.fallingSolids && MM.fallingSolids.recheckNeighborhood) MM.fallingSolids.recheckNeighborhood(x,y); }catch(e){}
    }
    try{
      const TILE=MM.TILE||20;
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks((x+0.5)*TILE,(y+0.5)*TILE,'epic',34);
      else if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((x+0.5)*TILE,(y+0.5)*TILE,'epic');
      if(MM.audio && MM.audio.play) MM.audio.play('charge');
    }catch(e){}
    return {slotX:slot.x, slotY:slot.y, hitRole:slot.hitRole, drained};
  }
  // Jagged main channel from (x0,y0) to the impact, plus a few side forks (tile coords).
  function makeBolt(x0,y0,ix,iy){
    const segs=9+Math.floor(Math.random()*4);
    const pts=[];
    for(let s=0;s<=segs;s++){
      const f=s/segs;
      const wob=(s===0||s===segs)? 0 : (Math.random()-0.5)*5*(1-f*0.4);
      pts.push([x0+(ix+0.5-x0)*f+wob, y0+(iy-y0)*f]);
    }
    const branches=[];
    const nb=1+Math.floor(Math.random()*3);
    for(let b=0;b<nb;b++){
      const si=1+Math.floor(Math.random()*Math.max(1,segs-4));
      let bx=pts[si][0], by=pts[si][1];
      const dir=Math.random()<0.5?-1:1;
      const bp=[[bx,by]];
      const bl=2+Math.floor(Math.random()*3);
      for(let s=1;s<=bl;s++){ bx+=dir*(1.2+Math.random()*1.6); by+=1.2+Math.random()*1.6; bp.push([bx,by]); }
      branches.push(bp);
    }
    if(bolts.length>=6) bolts.shift();
    bolts.push({pts,branches,t:0.34,max:0.34,ix,iy});
  }
  // A strike hits the first blocking tile under x: solids transmute into a loot chest
  // (the bolt's gift), water just erupts — and a hero standing too close is
  // electrocuted (water conducts much further than ground).
  function strikeAt(x,fromRow,getTile,setTile){
    let xi=Math.round(x);
    let hit=findDynamoLightningTarget(xi,fromRow,getTile) || firstBlockingTile(xi,fromRow,getTile);
    if(!hit) return null;
    let ty=hit.y, tile=hit.t;
    strikes++;
    const res={x:xi, y:ty, chest:false, tier:null, dmg:0, energy:0, teleport:null, dynamo:null};
    if(hit.slot){
      xi=hit.x; ty=hit.y; tile=hit.t;
      res.x=xi; res.y=ty;
    }
    const TILE=MM.TILE||20;
    const isChest=(tile===T.CHEST_COMMON||tile===T.CHEST_RARE||tile===T.CHEST_EPIC);
    const dynamoHit=strikeVerticalDynamo(xi,ty,getTile,setTile);
    if(dynamoHit){
      res.dynamo=dynamoHit;
    } else if(tile===T.WATER){
      try{
        if(MM.water && MM.water.disturb){ MM.water.disturb(xi,280); MM.water.disturb(xi-1,180); MM.water.disturb(xi+1,180); }
        if(MM.particles && MM.particles.spawnSplash) MM.particles.spawnSplash((xi+0.5)*TILE, ty*TILE, 1);
      }catch(e){}
    } else if(!isChest && ty<WORLD_H-3 && applyElectricReaction(xi,ty,getTile,setTile)){
      res.reaction=true;
    } else if(!isChest && ty<WORLD_H-3){ // never transmute the bedrock shelf
      const r=Math.random();
      const id=r<0.70? T.CHEST_COMMON : (r<0.92? T.CHEST_RARE : T.CHEST_EPIC);
      setTile(xi,ty,id);
      res.chest=true; res.tier=(id===T.CHEST_EPIC)?'epic':(id===T.CHEST_RARE)?'rare':'common';
      chestsMade++;
      try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((xi+0.5)*TILE,(ty+0.5)*TILE,res.tier); }catch(e){}
    }
    const p=(typeof window!=='undefined' && window.player);
    if(p && isFinite(p.x) && isFinite(p.y)){
      const pxBefore=p.x, hpBefore=typeof p.hp==='number' ? p.hp : 0;
      const inWater=(tile===T.WATER);
      const radius=inWater? 7 : 4;
      const d=Math.max(Math.abs(p.x-(xi+0.5)), Math.abs(p.y-ty));
      if(d<=radius){
        const amount=Math.round((inWater?24:32)*(1-d/(radius+1))+4);
        res.dmg=damageHero(amount, xi+0.5);
        if(res.dmg>0){
          res.energy=chargeLightningHero(xi+0.5,ty);
          if(hpBefore>amount) res.teleport=maybeTeleportLightningHero(getTile,res.dmg);
        }
      }
      playThunder(Math.abs(pxBefore-xi));
    } else playThunder(0);
    return res;
  }
  // Debug/console strike from the open sky (also used by the smoke harness and tests).
  // Accessors default to the live world so `MM.clouds.strike(x)` works from the console.
  function strike(x,getTile,setTile){
    if(typeof x!=='number' || !isFinite(x)) return null;
    const w=MM.world;
    if(typeof getTile!=='function') getTile=w && w.getTile;
    if(typeof setTile!=='function') setTile=w && w.setTile;
    if(typeof getTile!=='function' || typeof setTile!=='function') return null;
    const res=strikeAt(x,2,getTile,setTile);
    if(res){ makeBolt(res.x, Math.max(2,res.y-18), res.x, res.y); viewFlash=Math.max(viewFlash,0.30); }
    return res;
  }

  // ---------------- Storms ----------------
  // A storm front: minutes of gusting wind, swollen black clouds, pouring rain and
  // frequent lightning. The front carries its own moisture in from off-band regions
  // (booked through farBudget) and pumps it into the clouds overhead until they pour.
  function startStorm(duration,intensity){
    storm.active=true;
    storm.tLeft=(typeof duration==='number' && duration>0)? duration : 60+Math.random()*90;
    storm.intensity=clamp((typeof intensity==='number' && isFinite(intensity))? intensity : 0.8, 0.2, 1);
    storm.cooldown=0;
    // moisture the front drags in from other regions (capped so console spam
    // can't inflate the reserve into a permanent deluge)
    farBudget=Math.min(120, farBudget+20+30*storm.intensity);
    return {duration:storm.tLeft, intensity:storm.intensity};
  }
  function updateStorm(px,dt){
    if(storm.active){
      storm.tLeft-=dt;
      if(storm.tLeft<=0){ storm.active=false; storm.intensity=0; storm.cooldown=120; return; }
      // keep a few cells overhead, then pump them past saturation so they pour
      if(clouds.length<3 && farBudget>10 && Math.random()<dt*0.4){
        const m=Math.min(farBudget, 12+Math.random()*12); farBudget-=m;
        makeCloud(px+(Math.random()-0.5)*160, null, m);
      }
      if(clouds.length){
        const c=clouds[(Math.random()*clouds.length)|0];
        const grow=Math.min(farBudget, CFG.STORM_FEED*seasonNumber('stormFeedMult',1)*storm.intensity*dt);
        if(grow>0 && Math.abs(c.x-px)<CFG.ACTIVE_HALF){ c.mass+=grow; farBudget-=grow; }
      }
    } else if(storm.cooldown>0){ storm.cooldown-=dt; }
    else if(CFG.STORMS){
      stormCheckAcc+=dt;
      if(stormCheckAcc>=10){
        stormCheckAcc=0;
        if(Math.random()<CFG.STORM_CHANCE*seasonNumber('stormChanceMult',1)) startStorm();
      }
    }
  }

  // ---------------- Rain deposition ----------------
  // Turn one whole unit of rain into a real WATER tile: fall from the cloud base to
  // the first blocking tile; land on water (level rises) or just above solid ground
  // (puddles form and flow). Leaves are fallen through, matching the fluid sim.
  // Each cloud carries its own fractional deposit so wind drift can't smear the
  // debt across columns too thinly for tiles to ever materialize.
  function depositUnit(cx,fromRow,getTile,setTile){
    let ty=-1;
    for(let y=Math.max(1,Math.floor(fromRow));y<WORLD_H;y++){
      const t=getTile(cx,y);
      if(skyOpenTile(t)) continue;
      ty=y; break;
    }
    if(ty<1) return false;                         // fell out of the world
    let py=ty-1;
    while(py>1 && isLeafTile(getTile(cx,py))) py--;   // surface under a canopy: climb to air
    try{
      const pt=getTile(cx,py);
      if(MM.water && MM.water.addSource && (pt===T.AIR || isGasTile(pt))){
        return !!MM.water.addSource(cx,py,getTile,setTile);
      }
    }catch(e){}
    return false;                                  // blocked (e.g. column brim-full)
  }

  // ---------------- Per-cloud update ----------------
  function updateCloud(c,getTile,setTile,px,wind,dt){
    // drift with the wind (slight per-cloud shear), settle toward cruising altitude
    c.vx += (wind+c.jitterV-c.vx)*Math.min(1,dt*0.5);
    c.x += c.vx*dt;
    c.alt += (altTargetFor(c.x,c.jit)-c.alt)*Math.min(1,dt*0.3);
    c.r = radiusFor(c.mass);
    // drink vapor from the region passing underneath ("clouds cumulate moisture")
    const reg=regionOf(c.x);
    const v=vapor.get(reg)||0;
    if(v>0.02){
      const take=Math.min(v*0.5, CFG.ABSORB_RATE*dt);
      vapor.set(reg,v-take); c.mass+=take;
    }
    // rain state with hysteresis around the local saturation capacity
    const tC=airTemp(c.x,c.alt);
    const capC=capacity(tC);
    if(!c.raining){ if(c.mass>capC+0.5 || c.mass>CFG.ABS_MAX) c.raining=true; }
    else if(c.mass<capC*0.72 || c.mass<2.2) c.raining=false;
    c.snowing = c.raining && airTemp(c.x, effSurf(c.x))<0.30;
    if(c.raining){
      const excess=Math.max(0,c.mass-capC*0.6);
      const rateBase=(CFG.RAIN_RATE_BASE+excess*CFG.RAIN_RATE_GAIN)*seasonNumber('rainRateMult',1);
      const rate=Math.min(storm.active? 0.9*seasonNumber('stormFeedMult',1) : 0.55*seasonNumber('rainRateMult',1), rateBase);
      const amt=Math.min(c.mass, rate*dt);
      c.mass-=amt; rainMass+=amt;
      if(c.snowing){
        addVapor(reg, amt);                        // snow sublimates back (no ice tiles)
      } else {
        c.depAcc+=amt;
        while(c.depAcc>=1){
          c.depAcc-=1;
          const cx=Math.round(c.x+(Math.random()+Math.random()-1)*c.r*0.8*cloudVisualScaleX());
          if(Math.abs(cx-px)>CFG.DEPOSIT_RADIUS || !depositUnit(cx,c.alt,getTile,setTile)){
            farBudget=Math.min(200, farBudget+1);  // off-band / blocked rain rejoins the reserve
          }
        }
      }
      // cosmetic precipitation near the viewport (denser budget while a storm rages)
      if(Math.abs(c.x-px)<110){
        const TILE=MM.TILE||20;
        const dropCap=CFG.DROP_CAP*(storm.active?1.6:1);
        let n=amt*350; if(c.snowing) n*=0.6;
        for(; n>0 && drops.length<dropCap; n--){
          if(n<1 && Math.random()>n) break;
          const dx=(Math.random()+Math.random()-1)*c.r*0.85*cloudVisualScaleX();
          drops.push({
            x:(c.x+dx)*TILE, y:(c.alt+c.r*0.22)*TILE,
            vx:wind*TILE*0.6+(Math.random()-0.5)*8,
            vy:c.snowing? 30+Math.random()*25 : 240+Math.random()*120,
            snow:c.snowing, phase:Math.random()*Math.PI*2, life:0,
          });
        }
      }
      // lightning from heavy warm cells: the bolt transmutes whatever it hits into a
      // loot chest and electrocutes a hero standing too close. Storms strike far more
      // often and from smaller cells.
      const lMin=storm.active? CFG.LIGHTNING_MIN*0.6 : CFG.LIGHTNING_MIN;
      const lightP=CFG.LIGHTNING_BASE*(storm.active? (2+3*storm.intensity) : 1);
      if(!c.snowing && c.mass>lMin && Math.random()<dt*lightP){
        c.flash=0.6; viewFlash=Math.max(viewFlash,0.30);
        const sx2=c.x+(Math.random()-0.5)*c.r*1.2*cloudVisualScaleX();
        if(Math.abs(sx2-px)<=CFG.STRIKE_RADIUS){
          const res=strikeAt(sx2,c.alt,getTile,setTile);
          if(res) makeBolt(c.x+(Math.random()-0.5)*c.r*0.4*cloudVisualScaleX(), c.alt+c.r*0.18, res.x, res.y);
        }
      }
    }
    if(c.flash>0) c.flash-=dt*2.4;
    // starved clouds thin out and re-evaporate
    if(c.mass<2){ const back=Math.min(c.mass,CFG.DISSIPATE*dt); c.mass-=back; addVapor(reg,back); }
    return c.mass>0.4;
  }

  function mergePass(){
    if(clouds.length<2) return;
    clouds.sort((a,b)=>a.x-b.x);
    for(let i=clouds.length-1;i>0;i--){
      const a=clouds[i-1], b=clouds[i];
      if(Math.abs(b.x-a.x)<(a.r+b.r)*0.55 && Math.abs(b.alt-a.alt)<5){
        const m=a.mass+b.mass;
        a.x=(a.x*a.mass+b.x*b.mass)/m;
        a.alt=(a.alt*a.mass+b.alt*b.mass)/m;
        a.vx=(a.vx*a.mass+b.vx*b.mass)/m;
        a.mass=m; a.r=radiusFor(m);
        a.depAcc+=b.depAcc;
        a.raining=a.raining||b.raining;
        a.spriteKey='';                            // force sprite rebuild at the new size
        clouds.splice(i,1);
      }
    }
  }

  // Weather arriving from beyond the simulated band: spawn at the upwind edge so it
  // drifts across the player's sky, funded by the off-band moisture reserve.
  function borderSpawn(px,dt){
    if(!CFG.BORDER_SPAWN) return;
    const moistureMult=seasonNumber('borderMoistureMult',1);
    farBudget=Math.min(80, farBudget+0.05*moistureMult*dt);
    spawnAcc+=dt;
    if(spawnAcc<1) return;
    spawnAcc=0;
    if(clouds.length>=CFG.CLOUD_CAP*0.8 || farBudget<6) return;
    const wind=windAt();
    const p=CFG.SPAWN_CHANCE*moistureMult*(1+Math.abs(wind)*0.4);
    if(Math.random()>=p) return;
    const side=Math.abs(wind)>0.2? -Math.sign(wind) : (Math.random()<0.5?-1:1);
    const mass=Math.min(farBudget, 5+Math.random()*12);
    farBudget-=mass;
    makeCloud(px+side*(CFG.ACTIVE_HALF-10), null, mass);
  }

  // ---------------- Main update ----------------
  function update(getTile,setTile,dt){
    if(typeof getTile!=='function' || typeof setTile!=='function') return;
    if(typeof dt!=='number' || !(dt>0)) return;
    if(dt>0.1) dt=0.1;
    simT+=dt;
    const p=(typeof window!=='undefined' && window.player);
    const px=(p && isFinite(p.x))? Math.floor(p.x) : 0;
    const wind=windAt(); // hoisted: shared by clouds, drops and wisps this tick

    evaporateSlice(getTile,setTile,px,dt);

    updateStorm(px,dt);

    regionAcc+=dt;
    if(regionAcc>=0.5){ condenseTick(px); regionAcc=0; }

    for(let i=clouds.length-1;i>=0;i--){
      const c=clouds[i];
      if(!updateCloud(c,getTile,setTile,px,wind,dt)){
        // dissipated: remaining mass and any in-flight rain return to local vapor
        rainMass-=c.depAcc; addVapor(regionOf(c.x), c.mass+c.depAcc);
        clouds.splice(i,1); continue;
      }
      if(Math.abs(c.x-px)>CFG.ACTIVE_HALF+60){ farBudget=Math.min(200, farBudget+c.mass+c.depAcc); clouds.splice(i,1); }
    }

    mergeAcc+=dt;
    if(mergeAcc>=0.7){ mergePass(); mergeAcc=0; }

    borderSpawn(px,dt);

    // lightning afterglow decay
    if(viewFlash>0) viewFlash-=dt*1.6;
    for(let i=bolts.length-1;i>=0;i--){ bolts[i].t-=dt; if(bolts[i].t<=0) bolts.splice(i,1); }

    // cosmetic precipitation: integrate, collide with the world, splash on water
    const TILE=MM.TILE||20;
    for(let i=drops.length-1;i>=0;i--){
      const d=drops[i];
      d.life+=dt;
      if(d.snow) d.x+=Math.sin(d.life*2+d.phase)*12*dt;
      d.x+=d.vx*dt; d.y+=d.vy*dt;
      const tx=Math.floor(d.x/TILE), ty=Math.floor(d.y/TILE);
      if(ty>=WORLD_H || d.life>9){ drops.splice(i,1); continue; }
      const t=getTile(tx,ty);
      if(!skyOpenTile(t)){
        if(t===T.WATER){
          try{
            if(MM.water && MM.water.disturb && Math.random()<0.25) MM.water.disturb(tx, 10+Math.random()*14);
            if(MM.particles && MM.particles.spawnSplash && Math.random()<0.05) MM.particles.spawnSplash(d.x,d.y-2,0.18);
          }catch(e){}
        }
        drops.splice(i,1);
      }
    }
    const wispDx=wind*TILE*0.25*dt;
    for(let i=wisps.length-1;i>=0;i--){
      const w=wisps[i];
      w.life+=dt; w.y-=8*dt; w.x+=wispDx;
      if(w.life>w.max) wisps.splice(i,1);
    }
  }

  // ---------------- Rendering ----------------
  let spriteBudget=0;
  function cloudVisualScaleX(){ return Math.max(0.5, CFG.CLOUD_VISUAL_X || 1); }
  function cloudSpriteWidth(c,TILE){ return c.r*2.8*TILE*cloudVisualScaleX(); }
  function cloudShadowRadius(c){ return c.r*cloudVisualScaleX(); }
  function drawSoftCloudShadow(ctx,TILE,c,dark,x0px,x1px,y0px,y1px){
    const shR=cloudShadowRadius(c);
    if(!(shR>0)) return;
    const cx=c.x*TILE;
    const cy=effSurf(c.x)*TILE + TILE*0.34;
    const rx=Math.max(TILE*5, Math.min(TILE*54, shR*TILE*0.95));
    const ry=Math.max(TILE*0.24, Math.min(TILE*0.95, TILE*(0.34+dark*0.26)));
    if(cx+rx<x0px || cx-rx>x1px || cy+ry<y0px || cy-ry>y1px) return;
    const alpha=(0.010+0.022*dark)*(c.raining?1.25:1);
    if(alpha<=0.004) return;
    ctx.save();
    const g=ctx.createRadialGradient(cx,cy,Math.max(1,rx*0.08),cx,cy,rx);
    g.addColorStop(0,'rgba(10,16,30,'+alpha.toFixed(3)+')');
    g.addColorStop(0.64,'rgba(10,16,30,'+(alpha*0.42).toFixed(3)+')');
    g.addColorStop(1,'rgba(10,16,30,0)');
    ctx.fillStyle=g;
    ctx.beginPath();
    ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  function skyTint(){
    const c=cycleInfo();
    if(c.isDay){
      const e=Math.min(c.tDay/0.14,(1-c.tDay)/0.14,1);
      if(e>=1) return {col:[255,255,255], a:0};
      return {col:[255,150,80], a:(1-e)*0.38};
    }
    return {col:[24,32,58], a:0.62};
  }
  function buildSprite(c,TILE,dark,tint){
    const r=c.r;
    const xScale=cloudVisualScaleX();
    const w=Math.max(8,Math.ceil(r*2.8*TILE*xScale)), h=Math.max(8,Math.ceil(r*1.7*TILE));
    if(!c.sprite) c.sprite=document.createElement('canvas');
    const cv=c.sprite; cv.width=w; cv.height=h;
    const g=cv.getContext('2d');
    const cx=w/2, cy=h*0.60;
    const base=[Math.round(255-(255-92)*dark), Math.round(255-(255-100)*dark), Math.round(255-(255-116)*dark)];
    for(const pf of c.puffs){
      const pxp=cx+pf.ox*r*TILE*xScale, pyp=cy+pf.oy*r*TILE, pr=Math.max(2,pf.s*r*TILE);
      const gr=g.createRadialGradient(pxp,pyp,pr*0.12,pxp,pyp,pr);
      gr.addColorStop(0,'rgba('+base[0]+','+base[1]+','+base[2]+',0.95)');
      gr.addColorStop(0.62,'rgba('+base[0]+','+base[1]+','+base[2]+',0.55)');
      gr.addColorStop(1,'rgba('+base[0]+','+base[1]+','+base[2]+',0)');
      g.fillStyle=gr; g.beginPath(); g.arc(pxp,pyp,pr,0,Math.PI*2); g.fill();
    }
    g.save();
    g.translate(cx,cy-r*TILE*0.02);
    g.scale(Math.max(1,xScale*1.1),0.36);
    const bridge=g.createRadialGradient(0,0,r*TILE*0.16,0,0,r*TILE*1.2);
    bridge.addColorStop(0,'rgba('+base[0]+','+base[1]+','+base[2]+',0.58)');
    bridge.addColorStop(0.72,'rgba('+base[0]+','+base[1]+','+base[2]+',0.34)');
    bridge.addColorStop(1,'rgba('+base[0]+','+base[1]+','+base[2]+',0)');
    g.fillStyle=bridge;
    g.beginPath(); g.arc(0,0,r*TILE*1.2,0,Math.PI*2); g.fill();
    g.restore();
    g.globalCompositeOperation='source-atop';
    const sh=g.createLinearGradient(0,cy,0,h);                 // heavy flat base
    sh.addColorStop(0,'rgba(70,82,104,0)');
    sh.addColorStop(1,'rgba(58,68,92,'+(0.30+0.35*dark).toFixed(3)+')');
    g.fillStyle=sh; g.fillRect(0,0,w,h);
    const hl=g.createLinearGradient(0,0,0,cy);                 // sunlit crown
    hl.addColorStop(0,'rgba(255,255,255,0.30)'); hl.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=hl; g.fillRect(0,0,w,h);
    if(tint.a>0.005){ g.fillStyle='rgba('+tint.col[0]+','+tint.col[1]+','+tint.col[2]+','+tint.a.toFixed(3)+')'; g.fillRect(0,0,w,h); }
    g.globalCompositeOperation='source-over';
  }
  function draw(ctx,TILE,getTile,sx,sy,vx,vy){
    if(!clouds.length && !drops.length && !wisps.length && !bolts.length && !storm.active && viewFlash<=0) return;
    const now=(typeof performance!=='undefined')? performance.now() : 0;
    const tint=skyTint();
    const tintB=Math.round(tint.a*12);
    spriteBudget=3; // stagger sprite rebuilds (dawn/dusk re-tints all clouds at once)
    const x0px=sx*TILE, x1px=(sx+vx+2)*TILE, y0px=sy*TILE, y1px=(sy+vy+2)*TILE;
    // storm ambience: the whole world broods under the front
    if(storm.active){
      ctx.fillStyle='rgba(15,20,38,'+(0.10*storm.intensity).toFixed(3)+')';
      ctx.fillRect(x0px,y0px,x1px-x0px,y1px-y0px);
    }
    for(const c of clouds){
      const w=cloudSpriteWidth(c,TILE), h=c.r*1.7*TILE;
      const cxp=c.x*TILE, cyp=c.alt*TILE+Math.sin(now*0.00045+c.seed*0.0001)*3;
      if(cxp+w/2<x0px || cxp-w/2>x1px || cyp+h<y0px || cyp-h>y1px) continue;
      const satur=c.mass/Math.max(1,capacity(airTemp(c.x,c.alt)));
      const dark=clamp(0.12+0.5*clamp(satur-0.4,0,1.2)+(c.raining?0.18:0),0,1);
      if(CFG.CLOUD_SHADOWS) drawSoftCloudShadow(ctx,TILE,c,dark,x0px,x1px,y0px,y1px);
      const key=Math.round(c.r*2)+'|'+Math.round(dark*6)+'|'+tintB+'|'+Math.round(cloudVisualScaleX()*10);
      if(c.spriteKey!==key && (spriteBudget>0 || !c.sprite)){
        buildSprite(c,TILE,Math.round(dark*6)/6,tint);
        c.spriteKey=key; spriteBudget--;
      }
      if(c.sprite){
        ctx.save();
        ctx.globalAlpha=0.92;
        ctx.drawImage(c.sprite, cxp-c.sprite.width/2, cyp-c.sprite.height*0.60);
        if(c.flash>0){ ctx.globalAlpha=Math.min(0.7,c.flash); ctx.globalCompositeOperation='lighter'; ctx.drawImage(c.sprite, cxp-c.sprite.width/2, cyp-c.sprite.height*0.60); }
        ctx.restore();
      }
    }
    // lightning: branched flickering channels with a hot impact glow
    for(const b of bolts){
      const a=Math.min(1,b.t/b.max);
      const flick=0.55+0.45*Math.sin(b.t*70);
      const A=a*flick;
      ctx.save();
      ctx.lineJoin='round'; ctx.lineCap='round';
      const passes=[[7,'rgba(160,190,255,'+(A*0.25).toFixed(3)+')'],
                    [3.2,'rgba(210,230,255,'+(A*0.7).toFixed(3)+')'],
                    [1.5,'rgba(255,255,255,'+A.toFixed(3)+')']];
      for(const [lw,col] of passes){
        ctx.strokeStyle=col; ctx.lineWidth=lw;
        ctx.beginPath();
        b.pts.forEach(([bx,by],i)=>{ if(i===0) ctx.moveTo(bx*TILE,by*TILE); else ctx.lineTo(bx*TILE,by*TILE); });
        ctx.stroke();
        ctx.lineWidth=lw*0.6; // forks: thinner, dimmer
        for(const bp of b.branches){
          ctx.beginPath();
          bp.forEach(([bx,by],i)=>{ if(i===0) ctx.moveTo(bx*TILE,by*TILE); else ctx.lineTo(bx*TILE,by*TILE); });
          ctx.stroke();
        }
      }
      // impact burst at the strike point
      const ixp=(b.ix+0.5)*TILE, iyp=b.iy*TILE;
      const rad=TILE*(1.6+2.2*(1-a));
      const gI=ctx.createRadialGradient(ixp,iyp,rad*0.1,ixp,iyp,rad);
      gI.addColorStop(0,'rgba(255,250,215,'+(A*0.55).toFixed(3)+')');
      gI.addColorStop(1,'rgba(255,250,215,0)');
      ctx.fillStyle=gI;
      ctx.beginPath(); ctx.arc(ixp,iyp,rad,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }
    // whole-screen flash riding each strike
    if(viewFlash>0){
      ctx.fillStyle='rgba(255,255,255,'+(Math.min(0.30,viewFlash)*0.55).toFixed(3)+')';
      ctx.fillRect(x0px,y0px,x1px-x0px,y1px-y0px);
    }
    // precipitation
    if(drops.length){
      ctx.save();
      ctx.strokeStyle='rgba(150,195,255,0.50)'; ctx.lineWidth=1.3;
      ctx.beginPath();
      let anyRain=false;
      for(const d of drops){
        if(d.snow) continue;
        if(d.x<x0px-40||d.x>x1px+40) continue;
        ctx.moveTo(d.x,d.y); ctx.lineTo(d.x-d.vx*0.03, d.y-d.vy*0.035);
        anyRain=true;
      }
      if(anyRain) ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.80)';
      for(const d of drops){
        if(!d.snow) continue;
        if(d.x<x0px-40||d.x>x1px+40) continue;
        ctx.fillRect(d.x-1.1,d.y-1.1,2.2,2.2);
      }
      ctx.restore();
    }
    if(wisps.length){
      ctx.save();
      for(const w of wisps){
        const a=Math.sin(Math.min(1,w.life/w.max)*Math.PI)*0.12;
        ctx.fillStyle='rgba(235,245,255,'+a.toFixed(3)+')';
        ctx.beginPath(); ctx.arc(w.x,w.y,w.r,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------------- Lifecycle / introspection ----------------
  function reset(){
    clouds=[]; vapor.clear(); evapAcc.clear();
    drops.length=0; wisps.length=0; bolts.length=0;
    farBudget=24; simT=0; evapOffset=0; regionAcc=mergeAcc=spawnAcc=stormCheckAcc=0;
    evapMass=0; rainMass=0; strikes=0; chestsMade=0; viewFlash=0;
    storm.active=false; storm.tLeft=0; storm.intensity=0; storm.cooldown=0;
  }
  function metrics(){
    let vap=0; for(const m of vapor.values()) vap+=m;
    let cm=0; for(const c of clouds) cm+=c.mass;
    return {clouds:clouds.length, cloudMass:cm, vapor:vap, drops:drops.length,
            evapMass, rainMass, farBudget, wind:windAt(),
            strikes, chests:chestsMade,
            storm:{active:storm.active, intensity:storm.intensity, tLeft:storm.tLeft}};
  }
  function setWindOverride(v){ windOverride=(typeof v==='number' && isFinite(v))? v : null; }
  // Strict shape check: a malformed override would feed NaN through airTemp/capacity
  // and silently freeze all weather, so junk is ignored rather than stored.
  function setCycleOverride(o){
    if(o===null || o===undefined){ cycleOverride=null; return; }
    if(typeof o==='object' && typeof o.isDay==='boolean' && typeof o.tDay==='number' && isFinite(o.tDay)) cycleOverride=o;
  }
  function mapSnapshot(map,limit){
    const rows=[];
    for(const [k,v] of map.entries()){
      if(typeof k!=='number' || !isFinite(k) || typeof v!=='number' || !isFinite(v) || Math.abs(v)<1e-6) continue;
      rows.push([k|0, roundSave(v,4)]);
    }
    rows.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    return rows.slice(0, limit||SAVE_MAP_LIMIT);
  }
  function restoreMap(map,rows,limit,maxValue){
    map.clear();
    if(!Array.isArray(rows)) return;
    const n=Math.min(rows.length, limit||SAVE_MAP_LIMIT);
    for(let i=0;i<n;i++){
      const r=rows[i];
      if(!Array.isArray(r) || r.length<2) continue;
      const k=finiteNum(r[0],NaN);
      const v=finiteNum(r[1],NaN);
      if(!isFinite(k) || !isFinite(v) || v<=0) continue;
      map.set(k|0, clamp(v,0,maxValue||1000));
    }
  }
  function cycleSnapshot(){
    if(!cycleOverride || typeof cycleOverride!=='object') return null;
    if(typeof cycleOverride.isDay!=='boolean' || typeof cycleOverride.tDay!=='number' || !isFinite(cycleOverride.tDay)) return null;
    return {
      cycleT: roundSave(finiteNum(cycleOverride.cycleT,0),4),
      isDay: !!cycleOverride.isDay,
      tDay: roundSave(clamp(cycleOverride.tDay,0,1),4),
    };
  }
  function snapshotCloud(c){
    return [
      roundSave(c.x,2),
      roundSave(c.alt,2),
      roundSave(c.mass,3),
      safeSeed(c.seed,1),
      roundSave(c.vx,3),
      roundSave(c.jitterV,3),
      roundSave(c.depAcc,3),
      c.raining?1:0,
      c.snowing?1:0,
      roundSave(c.jit,4),
    ];
  }
  function restoreCloud(row){
    const arr=Array.isArray(row);
    const x=finiteNum(arr?row[0]:row && row.x,NaN);
    const alt=finiteNum(arr?row[1]:row && row.alt,NaN);
    const mass=clamp(finiteNum(arr?row[2]:row && row.mass,0),0.4,160);
    if(!isFinite(x) || !isFinite(alt) || !(mass>0.39)) return null;
    const seed=safeSeed(arr?row[3]:row && row.seed, (cloudSeq++*2654435761)>>>0);
    const jit=clamp(finiteNum(arr?row[9]:row && row.jit,0.5),0,1);
    return {
      x, mass, seed, jit,
      r: radiusFor(mass),
      alt,
      vx: finiteNum(arr?row[4]:row && row.vx,0),
      jitterV: clamp(finiteNum(arr?row[5]:row && row.jitterV,0),-2,2),
      raining: !!(arr?row[7]:row && row.raining),
      snowing: !!(arr?row[8]:row && row.snowing),
      depAcc: clamp(finiteNum(arr?row[6]:row && row.depAcc,0),0,8),
      flash:0,
      puffs: makePuffs(seed),
      sprite:null,
      spriteKey:'',
    };
  }
  function snapshot(){
    return {
      v:1,
      simT: roundSave(simT,3),
      farBudget: roundSave(farBudget,3),
      evapOffset: evapOffset|0,
      regionAcc: roundSave(regionAcc,3),
      mergeAcc: roundSave(mergeAcc,3),
      spawnAcc: roundSave(spawnAcc,3),
      stormCheckAcc: roundSave(stormCheckAcc,3),
      evapMass: roundSave(evapMass,3),
      rainMass: roundSave(rainMass,3),
      strikes: strikes|0,
      chestsMade: chestsMade|0,
      cloudSeq: cloudSeq|0,
      windOverride: (typeof windOverride==='number' && isFinite(windOverride)) ? roundSave(windOverride,3) : null,
      cycleOverride: cycleSnapshot(),
      storm: {
        active: !!storm.active,
        tLeft: roundSave(storm.tLeft,2),
        intensity: roundSave(storm.intensity,3),
        cooldown: roundSave(storm.cooldown,2),
      },
      vapor: mapSnapshot(vapor,SAVE_MAP_LIMIT),
      evapAcc: mapSnapshot(evapAcc,SAVE_MAP_LIMIT),
      clouds: clouds.slice(-CFG.CLOUD_CAP).map(snapshotCloud),
    };
  }
  function restore(src){
    reset();
    if(!src || typeof src!=='object') return false;
    simT = Math.max(0, finiteNum(src.simT,0));
    farBudget = clamp(finiteNum(src.farBudget,24),0,200);
    evapOffset = finiteNum(src.evapOffset,0)|0;
    regionAcc = clamp(finiteNum(src.regionAcc,0),0,5);
    mergeAcc = clamp(finiteNum(src.mergeAcc,0),0,5);
    spawnAcc = clamp(finiteNum(src.spawnAcc,0),0,5);
    stormCheckAcc = clamp(finiteNum(src.stormCheckAcc,0),0,20);
    evapMass = Math.max(0, finiteNum(src.evapMass,0));
    rainMass = Math.max(0, finiteNum(src.rainMass,0));
    strikes = Math.max(0, finiteNum(src.strikes,0)|0);
    chestsMade = Math.max(0, finiteNum(src.chestsMade,0)|0);
    cloudSeq = Math.max(1, finiteNum(src.cloudSeq,1)|0);
    windOverride = (typeof src.windOverride==='number' && isFinite(src.windOverride)) ? clamp(src.windOverride,-20,20) : null;
    if(src.cycleOverride) setCycleOverride(src.cycleOverride);
    if(src.storm && typeof src.storm==='object'){
      storm.active=!!src.storm.active;
      storm.tLeft=clamp(finiteNum(src.storm.tLeft,0),0,600);
      storm.intensity=clamp(finiteNum(src.storm.intensity,0),0,3);
      storm.cooldown=clamp(finiteNum(src.storm.cooldown,0),0,600);
      if(storm.tLeft<=0) storm.active=false;
    }
    restoreMap(vapor,src.vapor,SAVE_MAP_LIMIT,500);
    restoreMap(evapAcc,src.evapAcc,SAVE_MAP_LIMIT,8);
    if(Array.isArray(src.clouds)){
      const list=[];
      for(let i=0;i<src.clouds.length && list.length<CFG.CLOUD_CAP;i++){
        const c=restoreCloud(src.clouds[i]);
        if(c) list.push(c);
      }
      clouds=list;
    }
    return true;
  }
  function _debug(){
    let depFrac=0; for(const c of clouds) depFrac+=c.depAcc;
    return {clouds, vapor, evapAcc, depFrac, farBudget, simT, bolts, storm};
  }

  MM.clouds={update, draw, reset, addCloud, injectVapor, isRainingAt, metrics, setWindOverride, setCycleOverride,
             startStorm, strike, snapshot, restore, config:CFG, _debug};
})();
// ESM export (progressive migration)
export const clouds = (typeof window!=='undefined' && window.MM) ? window.MM.clouds : undefined;
export default clouds;
