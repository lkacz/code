// Wind-driven sandstorms: the hot-east mirror of the western blizzard.
//
// Blizzards are cloud-driven (precipitation mints SNOW from cloud mass); a
// sandstorm mints nothing — it only MOVES sand that already exists. When the
// shared wind runs hot enough over a desert band, exposed sand crests erode
// (tile -> airborne mass) and the mass settles downwind as dunes: UNSTABLE_SAND
// laid on the surface under the same stack caps and hero-AABB protection the
// snow system uses. The ledger is volume-true: lifted == deposited + airborne.
//
// A FIRE_SHAMAN ritual forces a full-intensity storm through startStorm()
// (owner-scoped exactly like MM.clouds.startStorm) — the mirror image of the
// ICE_SHAMAN blizzard. Natural storms need |wind| >= WIND_MIN inside a desert.
//
// Storm state is deliberately NOT persisted: storms last under two minutes and
// the wind module's ritual gale already round-trips through its own snapshot.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSkyOpenTile } from './material_physics.js';
import { authoritativeBodyBlocksCell, BODY_DEPOSITION_CLEARANCE } from './body_footprint.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const CFG = {
    HOT_CLIMATE: 0.72,      // WG.temperature(x) at/above this counts as the desert band
    WIND_MIN: 4.2,          // |wind| (tiles/s) where a natural sandstorm begins
    BAND: 150,              // half-width (columns) of the active storm band around the player
    DUNE_STACK_MAX: 3,      // deposited UNSTABLE_SAND a column holds in an ordinary blow
    DUNE_STACK_STORM: 6,    // forced/ritual storm cap (drifts pile deep, mirrors SNOW_STACK_STORM)
    LIFT_RATE: 2.6,         // tiles/sec eroded from crests at full intensity
    AIRBORNE_CAP: 48,       // suspended mass ceiling — lifting pauses until sand settles out
    SETTLE_RATE: 1.6,       // tiles/sec that settle out after the wind dies
    TICK: 0.25,             // erosion/deposition cadence (seconds)
    DOWNWIND_MIN: 3,        // deposit offset from the lift band, along the wind…
    DOWNWIND_MAX: 26,       // …so dunes visibly march downwind
    FOG_MAX_ALPHA: 0.34,    // yellow haze ceiling at full intensity
  };

  const storm = {active:false, tLeft:0, max:0, intensity:0, source:null, ownerId:null};
  let airborne = 0;          // suspended sand mass (1.0 == one tile)
  let liftedTiles = 0, depositedTiles = 0; // lifetime ledger counters
  let tickAcc = 0, liftAcc = 0, dropAcc = 0;
  let simT = 0;
  let lastNatural = 0;       // smoothed natural intensity (metrics/fog stability)

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function playerRef(){ return (typeof window!=='undefined' && window.player) || null; }
  function windSpeed(){
    try{
      const w=MM.wind;
      if(w && typeof w.speed==='function'){ const v=Number(w.speed()); if(Number.isFinite(v)) return v; }
    }catch(e){}
    return 0;
  }
  function climateAt(x){
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.temperature==='function'){ const v=Number(wg.temperature(Math.round(x))); if(Number.isFinite(v)) return v; }
    }catch(e){}
    return 0.5;
  }
  function isSandTile(t){ return t===T.SAND || t===T.UNSTABLE_SAND; }
  function bodyBlocksSandAt(cx,py){ return authoritativeBodyBlocksCell(cx,py,BODY_DEPOSITION_CLEARANCE); }
  // First blocking tile scanning down the open sky; returns the landing air cell
  // above it (mirrors clouds.snowLandingCell without the canopy special case —
  // deserts have no leaf canopies worth climbing).
  function surfaceCell(cx,getTile){
    let anchor=30;
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(cx)); if(Number.isFinite(s)) anchor=s; }
    }catch(e){}
    const from=Math.max(WORLD_TOP+1, Math.floor(anchor)-40);
    for(let y=from;y<WORLD_BOTTOM;y++){
      const t=getTile(cx,y);
      if(isSkyOpenTile(t)) continue;
      if(y<=WORLD_TOP+1) return null;
      return {py:y-1, support:t, supportY:y};
    }
    return null;
  }
  function duneDepthAt(cx,py,getTile){
    let d=0;
    for(let y=py+1; d<=CFG.DUNE_STACK_STORM+1 && getTile(cx,y)===T.UNSTABLE_SAND; y++) d++;
    return d;
  }
  function duneStackCap(){
    return storm.active ? CFG.DUNE_STACK_STORM : CFG.DUNE_STACK_MAX;
  }
  function notifyTileChanged(x,y,getTile){
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.recheckNeighborhood) MM.fallingSolids.recheckNeighborhood(x,y); }catch(e){}
  }

  // ---- erosion: lift the top sand tile of any column that is not a pit.
  // Crests and flat sand both feed the wind (a flat desert must be able to
  // ripple into dunes); local hollows are protected, and the worldgen surface
  // anchors the floor — the storm may shave at most one tile below the
  // original terrain, so it reshapes the desert without excavating it.
  function tryLiftAt(cx,getTile,setTile){
    if(climateAt(cx)<CFG.HOT_CLIMATE) return false;
    const cell=surfaceCell(cx,getTile);
    if(!cell || !isSandTile(cell.support)) return false;
    const y=cell.supportY;
    if(bodyBlocksSandAt(cx,y)) return false;
    let anchor=y;
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(cx)); if(Number.isFinite(s)) anchor=s; }
    }catch(e){}
    if(y>anchor) return false; // already below the original surface: leave the floor alone
    let pit=true;
    for(const nx of [cx-1,cx+1]){
      const n=surfaceCell(nx,getTile);
      if(n && n.supportY>=y){ pit=false; break; }
    }
    if(pit) return false;
    setTile(cx,y,T.AIR);
    if(getTile(cx,y)!==T.AIR) return false;
    notifyTileChanged(cx,y,getTile);
    airborne+=1; liftedTiles+=1;
    return true;
  }

  // ---- deposition: mirror of clouds.depositSnowUnit for wind-blown sand.
  // Lands in the lowest nearby column (hollows fill first), respects the stack
  // cap, never places into the hero AABB. Water columns refuse the unit (the
  // mass stays airborne and drifts on).
  function placeDuneTileAt(cx,py,getTile,setTile){
    if(bodyBlocksSandAt(cx,py)) return false;
    setTile(cx,py,T.UNSTABLE_SAND);
    if(getTile(cx,py)!==T.UNSTABLE_SAND) return false;
    notifyTileChanged(cx,py,getTile);
    return true;
  }
  function depositSandUnit(cx,getTile,setTile){
    if(climateAt(cx)<CFG.HOT_CLIMATE) return false; // dunes stay inside the desert band
    const land=surfaceCell(cx,getTile);
    if(!land || land.support===T.WATER || land.support===T.LAVA) return false;
    const cap=duneStackCap();
    let bestX=cx, bestY=land.py;
    for(const nx of [cx-1,cx+1]){
      const alt=surfaceCell(nx,getTile);
      if(!alt || alt.support===T.WATER || alt.support===T.LAVA) continue;
      if(alt.py>bestY && duneDepthAt(nx,alt.py,getTile)<cap){ bestX=nx; bestY=alt.py; }
    }
    if(bestX===cx && duneDepthAt(cx,land.py,getTile)>=cap){
      for(const nx of [cx-1,cx+1]){
        const alt=surfaceCell(nx,getTile);
        if(!alt || alt.support===T.WATER || alt.support===T.LAVA) continue;
        if(duneDepthAt(nx,alt.py,getTile)<cap && placeDuneTileAt(nx,alt.py,getTile,setTile)) return true;
      }
      return false;
    }
    return placeDuneTileAt(bestX,bestY,getTile,setTile);
  }

  function naturalIntensity(px){
    const mag=Math.abs(windSpeed());
    if(mag<CFG.WIND_MIN) return 0;
    if(climateAt(px)<CFG.HOT_CLIMATE) return 0;
    return clamp((mag-CFG.WIND_MIN)/(7.2-CFG.WIND_MIN),0,1);
  }
  function intensity(){
    return clamp(Math.max(lastNatural, storm.active?storm.intensity:0),0,1);
  }
  // Storm strength felt at column x: full inside the desert band around the
  // player, fading to zero within ~30 columns of leaving hot climate.
  function intensityAt(x){
    const base=intensity();
    if(base<=0 || typeof x!=='number' || !Number.isFinite(x)) return 0;
    if(climateAt(x)>=CFG.HOT_CLIMATE) return base;
    for(const probe of [12,24,36]){
      if(climateAt(x-probe)>=CFG.HOT_CLIMATE || climateAt(x+probe)>=CFG.HOT_CLIMATE) return base*(1-probe/48);
    }
    return 0;
  }
  function isActive(){ return intensity()>0.05; }

  function startStorm(duration,intens,opts){
    opts=opts||{};
    storm.active=true;
    storm.tLeft=(typeof duration==='number' && duration>0)? duration : 45+Math.random()*45;
    storm.max=storm.tLeft;
    storm.intensity=clamp((typeof intens==='number' && isFinite(intens))? intens : 0.9, 0.2, 1);
    storm.source=typeof opts.source==='string' ? opts.source.slice(0,32) : null;
    storm.ownerId=opts.ownerId==null ? null : String(opts.ownerId).slice(0,64);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('sandstorm'); }catch(e){}
    return {duration:storm.tLeft, intensity:storm.intensity, source:storm.source, ownerId:storm.ownerId};
  }
  function stormMatches(opts){
    if(!storm.active) return false;
    if(!opts || typeof opts!=='object') return true;
    if(opts.source!=null && String(storm.source||'')!==String(opts.source)) return false;
    if(opts.ownerId!=null && String(storm.ownerId||'')!==String(opts.ownerId)) return false;
    return true;
  }
  function stopStorm(opts){
    if(!stormMatches(opts)) return false;
    storm.active=false; storm.tLeft=0; storm.max=0; storm.intensity=0;
    storm.source=null; storm.ownerId=null;
    return true;
  }

  function update(getTile,setTile,dt){
    if(typeof getTile!=='function' || typeof setTile!=='function') return;
    if(typeof dt!=='number' || !(dt>0)) return;
    if(dt>0.1) dt=0.1;
    simT+=dt;
    if(storm.active){
      storm.tLeft-=dt;
      if(storm.tLeft<=0) stopStorm();
    }
    const p=playerRef();
    const px=(p && isFinite(p.x))? Math.floor(p.x) : 0;
    lastNatural += (naturalIntensity(px)-lastNatural)*Math.min(1,dt*1.5);
    if(lastNatural<0.01) lastNatural=0;
    tickAcc+=dt;
    if(tickAcc<CFG.TICK) return;
    const step=tickAcc; tickAcc=0;
    const power=intensity();
    if(power<=0 && airborne<=0){ liftAcc=0; dropAcc=0; return; }
    const dir=windSpeed()>=0 ? 1 : -1;
    // erosion budget: crests shed while the wind holds and the sky can carry more
    if(power>0){
      liftAcc=Math.min(liftAcc + CFG.LIFT_RATE*power*step, 6);
      while(liftAcc>=1 && airborne<CFG.AIRBORNE_CAP){
        liftAcc-=1;
        const cx=px + (Math.random()<0.5?-1:1)*Math.floor(Math.random()*CFG.BAND);
        tryLiftAt(cx,getTile,setTile);
      }
    } else liftAcc=0;
    // deposition budget: suspended mass settles downwind; after the storm the
    // remaining airborne sand rains out at SETTLE_RATE so the ledger closes itself
    const dropRate=power>0 ? CFG.LIFT_RATE*power : CFG.SETTLE_RATE;
    dropAcc=Math.min(dropAcc + dropRate*step, 6);
    while(dropAcc>=1 && airborne>=1){
      dropAcc-=1;
      const reach=CFG.DOWNWIND_MIN + Math.random()*(CFG.DOWNWIND_MAX-CFG.DOWNWIND_MIN);
      const cx=px + Math.floor((Math.random()*2-1)*CFG.BAND*0.8 + dir*reach);
      if(depositSandUnit(cx,getTile,setTile)){ airborne-=1; depositedTiles+=1; }
    }
  }

  // Yellow haze: visibility drops with local storm strength. Drawn in screen
  // space over the world layer (before the HUD) by main.js.
  function draw(ctx,TILE,sx,sy,viewX,viewY){
    if(!ctx) return;
    const p=playerRef();
    const power=intensityAt(p && isFinite(p.x) ? p.x : null);
    if(power<=0.03) return;
    const x0=sx*TILE, y0=sy*TILE, w=(viewX+2)*TILE, h=(viewY+2)*TILE;
    const a=CFG.FOG_MAX_ALPHA*power;
    ctx.save();
    ctx.fillStyle='rgba(214,178,96,'+(a*0.62).toFixed(3)+')';
    ctx.fillRect(x0,y0,w,h);
    // rolling density bands sell the "wall of sand" without particle cost
    const t=simT*0.7;
    for(let i=0;i<3;i++){
      const bandY=y0 + ((Math.sin(t*0.9+i*2.1)*0.5+0.5)*0.8+0.1)*h;
      const g=ctx.createLinearGradient(0,bandY-h*0.16,0,bandY+h*0.16);
      g.addColorStop(0,'rgba(201,164,82,0)');
      g.addColorStop(0.5,'rgba(201,164,82,'+(a*0.30).toFixed(3)+')');
      g.addColorStop(1,'rgba(201,164,82,0)');
      ctx.fillStyle=g;
      ctx.fillRect(x0,bandY-h*0.16,w,h*0.32);
    }
    ctx.restore();
  }

  function reset(){
    storm.active=false; storm.tLeft=0; storm.max=0; storm.intensity=0; storm.source=null; storm.ownerId=null;
    airborne=0; liftedTiles=0; depositedTiles=0; tickAcc=0; liftAcc=0; dropAcc=0; simT=0; lastNatural=0;
  }
  function metrics(){
    return {
      intensity:+intensity().toFixed(3),
      natural:+lastNatural.toFixed(3),
      airborne:+airborne.toFixed(2),
      lifted:liftedTiles,
      deposited:depositedTiles,
      wind:+windSpeed().toFixed(3),
      storm:{active:storm.active, tLeft:+storm.tLeft.toFixed(2), intensity:+storm.intensity.toFixed(3), source:storm.source||null, ownerId:storm.ownerId||null}
    };
  }

  MM.sandstorm={update, draw, reset, metrics, startStorm, stopStorm, isActive, intensityAt, config:CFG,
    _debug:{storm, tryLiftAt, depositSandUnit, surfaceCell, duneDepthAt, naturalIntensity, bodyBlocksSandAt, heroBlocksSandAt:bodyBlocksSandAt}};
})();

export const sandstorm = (typeof window!=='undefined' && window.MM) ? window.MM.sandstorm : globalThis.MM && globalThis.MM.sandstorm;
export default sandstorm;
