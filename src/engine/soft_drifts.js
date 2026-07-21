// Soft drifts: decorative ground accumulation you can run straight through.
//
// A registry of "soft cover" materials builds sub-tile levels (1..UNITS of a
// block) on top of the surface: snow fluff under winter snowfall, autumn leaf
// litter shaken off canopies by the wind, soot settling out of thick smoke.
// A full level mints a REAL tile (SNOW joins the ordinary snowpack; leaf
// litter becomes the passable LEAF_PILE block) and a fresh drift starts on the
// new surface — so drifts visibly bury the ground layer by layer. Any body
// moving fast enough through a drift (or through a LEAF_PILE tile) PLOUGHS it
// aside in a burst of flakes: the volume scatters onto neighbouring columns
// instead of vanishing, and everything soft fades on its own over ~FADE_DAYS
// of game time. The whole system is cosmetic by design — it mints only what
// the seasons already mint (snowpack) or a 1-hp passable decoration, and it
// never blocks movement.
//
// Multiplayer contract (Duchy Warstwy):
//   * host-only sim — main.js steps it next to sandstorm/clouds; runHeroStep
//     must NEVER call it (full tiles replicate over the tiles plane, sub-tile
//     levels ride the dedicated 'drift' plane like water's pwat windows).
//   * ghostLevelsIn / ghostApplyLevelsWindow mirror water.js: the watcher side
//     is display-only and bounded, and infers burst poofs from cleared cells
//     so guests see flakes without a separate event channel.
//   * the burst sweep takes the acting player as a PARAMETER and consults
//     MM.coopBodies (empty array in solo — zero cost), like boats/guardians.
// Levels are deliberately NOT persisted (same ruling as water partials): a
// reload starts the dusting fresh; minted tiles persist as ordinary bytes.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, isLeaf } from '../constants.js';
import { isSkyOpenTile, isGasTile } from './material_physics.js';
import { authoritativeBodyBlocksCell, bodyFootprintOverlapsCell, BODY_DEPOSITION_CLEARANCE } from './body_footprint.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const UNITS = 10;               // sub-tile levels per cell (mirrors water UNITS)
  // Wire ids for the ghost 'drift' plane are indices into this order (pinned;
  // new materials append at the END — the ids ride the wire).
  const MAT_ORDER = ['snow', 'leaves', 'soot', 'sand'];
  const MATS = {
    snow: {
      wire: 0,
      fullTile: T.SNOW,           // a full drift joins the ordinary snowpack
      stackMax: 3,                // same ordinary-weather cap as clouds' snowfall
      heightScale: 1,
      base: '#e9f2fc', top: '#ffffff', speck: '#c9ddf2', ink: '#8fa6bf',
      // zamieć śnieżna: a winter gale blows loose snow in from upwind snowfields
      storm: { windMin: 4.0, windFull: 7.0, seasonKey: 'snowStrength', seasonMin: 0.25,
        needCold: true, haze: [214,230,248], hazeMax: 0.26, flakeRate: 9, discovery: 'snow_gale' },
    },
    leaves: {
      wire: 1,
      fullTile: T.LEAF_PILE,
      stackMax: 2,                // litter piles stay shallower than snowpack
      heightScale: 1,
      base: '#b3812f', top: '#d09a3c', speck: '#8f5a2a', ink: '#5f3f1c',
      // jesienna zamieć: an autumn gale strips canopies and carries the leaves
      storm: { windMin: 3.6, windFull: 6.5, seasonKey: 'leafDropStrength', seasonMin: 0.35,
        haze: [164,120,58], hazeMax: 0.20, flakeRate: 7, discovery: 'leaf_gale' },
    },
    soot: {
      wire: 2,
      fullTile: null,             // soot never solidifies into a SOFT tile…
      // …but a MAXED film under continued black-smoke fall can compress into
      // a graphite seam (the carbon chain's first mineral step)
      compressTile: T.GRAPHITE,
      compressP: 0.12,
      maxUnits: 8,
      heightScale: 0.5,           // a "full" film is still only half a tile tall
      base: '#22242a', top: '#3a3d44', speck: '#131418', ink: '#565b66',
      // zamieć sadzy: conjured only — the soot shaman's ritual (or debug menu);
      // no weather ever raises a smog storm on its own
      storm: { forcedOnly: true, haze: [30,32,38], hazeMax: 0.30, flakeRate: 8, discovery: 'soot_gale' },
    },
    sand: {
      wire: 3,
      fullTile: T.UNSTABLE_SAND,  // a full drift joins the dunes the sandstorm lays
      stackMax: 3,                // mirror of the sandstorm's ordinary dune cap
      heightScale: 1,
      base: '#d9c078', top: '#ecd99b', speck: '#a8905c', ink: '#8a744a',
      // zamieć piaskowa: the desert gale — the fine fraction of the sandstorm
      // system, so it also adopts a live (natural or FIRE_SHAMAN) storm's power
      storm: { windMin: 4.2, windFull: 7.2, climate: 0.72, haze: [214,178,96], hazeMax: 0.22, flakeRate: 10, discovery: 'sand_gale' },
    },
  };

  const CFG = {
    TICK: 0.35,            // source/decay cadence (seconds)
    BAND: 110,             // half-width (columns) of the active band around the player
    SAMPLES: 14,           // random columns probed per tick
    SNOW_P: 0.6,           // per-sample accrual chance at full snowfall strength
    LEAF_P: 0.75,          // per-sample accrual chance at full autumn drop + gale
    SNOW_TEMP_MAX: 0.45,   // seasons temperature at/below which fluff survives
    WARM_MELT: 0.52,       // above this the fluff decays back to nothing
    SOOT_DENSITY_MIN: 0.7, // plume density that starts staining the ground — the
                           // near-ground reading oscillates as smoke moves, so a
                           // stricter floor made even a chimney's film a no-show
    SOOT_SCAN_DOWN: 4,     // open rows between a plume cell and the ground it
                           // stains (fallout projects the smoke DOWN — the plume
                           // is the driver, so films build under roofs too)
    SOOT_FALL_P: 0.05,     // per-tick stain chance per grounded column at the
                           // density curve's peak — calibrated to the old
                           // sampled-column cadence (probe every ~15 ticks at
                           // p=0.8), now applied every tick, indoors included
    SOOT_FALL_BUDGET: 64,  // dense plume cells examined per tick (smoke rotates
                           // its cursor, so bigger clouds stay fairly serviced)
    SOOT_CONSUME: 0.28,    // smoke density a deposited unit removes from the
                           // plume cell — the smog visibly becomes the film
    SOOT_AGE_BOOST: 1.5,   // extra fallout-probability multiplier at fully
                           // settled mixture age — dead trapped smog converts
                           // into the ground film markedly faster than a live
                           // young plume (which is still busy climbing)
    CANOPY_SCAN: 24,       // rows of open sky searched for a leaf canopy
    BURST_SPEED: 1.1,      // horizontal body speed (tiles/s) that ploughs a drift
    LAND_VY: 3.0,          // fall speed whose IMPACT counts as landing in a drift
    SETTLE_SEC: 0.5,       // ploughed volume hangs airborne this long, then settles
    SETTLE_CAP: 240,       // pending-settle ceiling (overflow deposits immediately)
    SWEEP_MS: 70,          // body-sweep throttle
    MAP_CAP: 4000,         // sparse-cell ceiling (oldest entries evicted)
    FADE_DAYS: 1,          // game days a left-alone drift takes to fade to nothing
    AMBIENT_LEAF_RATE: 2.2,// falling-leaf flakes per second at full autumn gale
    STORM_SAMPLES: 10,     // extra blow-in columns probed per tick at full storm
    STORM_DOWNWIND_MIN: 3, // deposit offset along the wind…
    STORM_DOWNWIND_MAX: 18,// …so drifts visibly march downwind
    STORM_UPWIND_SCAN: 40, // columns searched upwind for a source (canopy/snowfield)
    STORM_FLAKE_CAP: 26,   // storm flakes spawned per second at full intensity
    STORM_MAX_SECONDS: 300,// forced-gale duration ceiling (no eternal ritual storms)
    SURFACE_SCAN_ROWS: 80, // surface-scan depth budget — an open shaft is not a surface
    POOF_BUDGET: 12,       // watcher-side burst inferences per applied window
    PRINT_MIN_SPEED: 0.35, // slower than this leaves no track (standing still)
    PRINT_MIN_UNITS: 2,    // a 1-unit dusting is too thin to hold a footprint
    PRINT_LIFE: 120,       // seconds a track stays readable (fresh = crisp)
    PRINT_CAP: 600,        // sparse-print ceiling (oldest evicted)
    PRINT_MOB_MS: 260,     // creature-track sweep throttle
    PRINT_MOB_BAND: 44,    // creature tracks only near the player (columns)
  };

  const cells = new Map(); // "x,y" -> {x,y,m:'snow'|'leaves'|'soot'|'sand',u:1..UNITS,d?:0..1 dirt}
  const K = (x,y)=>x+','+y;
  const settling = [];     // ploughed volume in flight: {x,y,sx,m,u,t} (t = seconds left)
  // Footprints: purely visual tracks pressed into a drift by anything that walks
  // through it — the hero, co-op bodies AND ground creatures (so you can TRACK
  // game by its trail). One print per cell (re-stepping refreshes it); they age
  // out on the same clock family as the drifts themselves. No volume changes.
  const prints = new Map(); // "x,y" -> {x,y,m,dir,age}
  let printMobAcc = 0;
  let tickAcc = 0, sweepAtMs = 0, ambientAcc = 0;
  let minted = {snow:0, leaves:0, soot:0, sand:0, graphite:0};
  let bursts = 0, noted = false, graphiteNoted = false;
  // Drift gales (zamiecie): one wind-driven storm at a time. Natural triggers
  // ride the shared wind inside the right season (the seasons module's forced
  // autumn-gale / winter-blizzard squalls exceed the thresholds by design);
  // forced storms are owner-scoped exactly like sandstorm/clouds rituals.
  // Deliberately NOT persisted — a gale outlives no reload.
  const storm = {active:false, mat:null, tLeft:0, max:0, intensity:0, source:null, ownerId:null};
  let stormNatK = 0, stormNatMat = null;   // smoothed natural gale strength
  let stormView = null;                    // {mat,k,dir} the renderer consumes (host sim)
  let ghostStorm = null;                   // watcher-side mirror {mat,k,dir,untilMs}
  const stormNoted = {snow:false, leaves:false, soot:false, sand:false};
  let stormFlakeAcc = 0, lastStormDrawMs = 0, stormBlownIn = 0;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function seasonsRef(){ return (MM && MM.seasons) || null; }
  function profileNow(){
    try{ const s=seasonsRef(); if(s && typeof s.profile==='function'){ const p=s.profile(); if(p && typeof p==='object') return p; } }catch(e){}
    return null;
  }
  function tempAt(x,row){
    try{ const s=seasonsRef(); if(s && typeof s.temperatureAt==='function'){ const v=Number(s.temperatureAt(x,row)); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0.5;
  }
  function windSpeed(){
    try{ const w=MM.wind; if(w && typeof w.speed==='function'){ const v=Number(w.speed()); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0;
  }
  function smokeDenseCells(minD,limit){
    try{
      const s=MM.smoke;
      if(s && typeof s.denseCells==='function'){ const list=s.denseCells(minD,limit); if(Array.isArray(list)) return list; }
    }catch(e){}
    return [];
  }
  function smokeConsumeAt(x,y,amount){
    try{ const s=MM.smoke; if(s && typeof s.consumeAt==='function') s.consumeAt(x,y,amount); }catch(e){}
  }
  function smokeSettledSeconds(){
    try{
      const s=MM.smoke;
      const v=s && s.config && Number(s.config.SETTLED_SECONDS);
      if(Number.isFinite(v) && v>0) return v;
    }catch(e){}
    return 100;
  }
  function climateAt(x){
    try{ const wg=MM.worldGen; if(wg && typeof wg.temperature==='function'){ const v=Number(wg.temperature(Math.round(x))); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0.5;
  }
  function sandstormPowerAt(x){
    try{ const s=MM.sandstorm; if(s && typeof s.intensityAt==='function'){ const v=Number(s.intensityAt(x)); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0;
  }
  function cloudsSnowingAt(x){
    try{ const c=MM.clouds; if(c && typeof c.isSnowingAt==='function') return !!c.isSnowingAt(x); }catch(e){}
    return false;
  }
  function flakes(x,y,mat,count,opts){
    try{
      const P=MM.particles;
      if(P && typeof P.spawnFlakes==='function') P.spawnFlakes(x,y,Object.assign({mat,count},opts||null));
    }catch(e){}
  }
  function notifyTileChanged(x,y,getTile){
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.recheckNeighborhood) MM.fallingSolids.recheckNeighborhood(x,y); }catch(e){}
  }

  // Landing spot of a column: first blocking tile under the open sky; the drift
  // lives in the AIR cell above it (mirrors sandstorm.surfaceCell — foliage and
  // gases are transparent, so litter lands on the ground UNDER a tree canopy).
  function surfaceCell(cx,getTile){
    let anchor=30;
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(cx)); if(Number.isFinite(s)) anchor=s; }
    }catch(e){}
    const from=Math.max(WORLD_TOP+1, Math.floor(anchor)-40);
    // bounded scan: a column mined open far below the worldgen surface is a
    // shaft, not a surface — probing it to world bottom would tax every tick
    const until=Math.min(WORLD_BOTTOM, from+CFG.SURFACE_SCAN_ROWS);
    for(let y=from;y<until;y++){
      const t=getTile(cx,y);
      if(isSkyOpenTile(t)) continue;
      if(y<=WORLD_TOP+1) return null;
      return {py:y-1, support:t, supportY:y};
    }
    return null;
  }
  function supportHolds(t){
    return t!==undefined && t!==null && t!==T.WATER && t!==T.LAVA && !isSkyOpenTile(t);
  }
  // A leaf canopy somewhere in the open sky above the cell (litter falls out of it).
  function canopyAbove(cx,py,getTile){
    for(let y=py-1,n=0; y>WORLD_TOP && n<CFG.CANOPY_SCAN; y--,n++){
      const t=getTile(cx,y);
      if(isLeaf(t)) return y;
      if(!isSkyOpenTile(t)) return -1;
    }
    return -1;
  }
  function stackDepthBelow(cx,py,tile,getTile){
    let d=0;
    for(let y=py+1; d<=6 && getTile(cx,y)===tile; y++) d++;
    return d;
  }

  function matMaxUnits(mat){
    const m=MATS[mat];
    return m && Number.isFinite(m.maxUnits) ? m.maxUnits : UNITS;
  }
  // One unit of material lands in an EXACT cell (grind rule, cap, conversion).
  // addUnits resolves the column's landing cell first; the plough/settle path
  // targets cells directly — same row only, so kicked volume never teleports
  // up or down a slope.
  function cellReceptive(x,y,getTile){
    return getTile(x,y)===T.AIR && supportHolds(getTile(x,y+1));
  }
  function addUnits(cx,mat,getTile,setTile){
    if(!MATS[mat] || typeof getTile!=='function') return false;
    const land=surfaceCell(cx,getTile);
    if(!land || !supportHolds(land.support)) return false;
    return addUnitAtCell(cx,land.py,mat,getTile,setTile);
  }
  function addUnitAtCell(cx,py,mat,getTile,setTile){
    if(!MATS[mat] || typeof getTile!=='function') return false;
    if(getTile(cx,py)!==T.AIR) return false;
    const k=K(cx,py);
    let c=cells.get(k);
    if(c && c.m!==mat){
      // Materials do not mix inside one cell (owner ruling): a new fall GRINDS
      // the old cover down first, unit for unit, and only claims the cell once
      // it is gone. Deep coexistence still happens at tile scale — a minted
      // LEAF_PILE keeps standing while fresh snow drifts pile on TOP of it.
      // ONE storytelling exception (brudny śnieg): soot falling ON snow does
      // not erode it — it STAINS it. The unit becomes a render-only dirt
      // fraction and winter around industry turns visibly grey.
      if(c.m==='snow' && mat==='soot'){
        c.d=Math.min(1,(c.d||0)+1/UNITS);
        return true; // the unit became the stain
      }
      if(--c.u<=0) cells.delete(k);
      return true; // the incoming unit was spent eroding the old cover
    }
    if(!c){
      if(cells.size>=CFG.MAP_CAP){
        // prefer evicting a far-away stale cell — the oldest entry is often an
        // ACTIVE drift right under the player (insertion order is not staleness)
        let victim=null, probes=0;
        for(const [vk,vc] of cells){
          if(Math.abs(vc.x-cx)>CFG.BAND){ victim=vk; break; }
          if(++probes>=64) break;
        }
        if(victim==null) victim=cells.keys().next().value;
        if(victim!==undefined) cells.delete(victim);
      }
      c={x:cx,y:py,m:mat,u:0};
      cells.set(k,c);
    }
    const capU=matMaxUnits(mat);
    if(c.u>=capU){
      // a maxed film swallowing yet another unit may compress into a mineral
      // (soot -> GRAPHITE): the incoming unit is the press, the film the coal
      const m=MATS[mat];
      if(m && m.compressTile && typeof setTile==='function' && Math.random()<(m.compressP||0)
        && !authoritativeBodyBlocksCell(cx,py,BODY_DEPOSITION_CLEARANCE)){
        setTile(cx,py,m.compressTile);
        if(getTile(cx,py)===m.compressTile){
          notifyTileChanged(cx,py,getTile);
          cells.delete(k);
          minted.graphite=(minted.graphite|0)+1;
          if(!graphiteNoted){
            graphiteNoted=true;
            try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('graphite','Gęsta sadza sprasowała się w grafitową żyłę!'); }catch(e){}
          }
        }
      }
      return true; // the unit is spent either way (pressed in or sublimed)
    }
    c.u=Math.min(capU, c.u+1);
    if(c.u>=UNITS) convertFull(c,getTile,setTile);
    return true;
  }
  function convertFull(c,getTile,setTile){
    const m=MATS[c.m];
    if(!m || !m.fullTile || typeof setTile!=='function'){ c.u=Math.min(c.u, matMaxUnits(c.m)); return false; }
    if(stackDepthBelow(c.x,c.y,m.fullTile,getTile)>=m.stackMax){ c.u=UNITS-1; return false; }
    if(authoritativeBodyBlocksCell(c.x,c.y,BODY_DEPOSITION_CLEARANCE)){ c.u=UNITS-1; return false; }
    setTile(c.x,c.y,m.fullTile);
    if(getTile(c.x,c.y)!==m.fullTile){ c.u=UNITS-1; return false; }
    notifyTileChanged(c.x,c.y,getTile);
    minted[c.m]=(minted[c.m]|0)+1;
    cells.delete(K(c.x,c.y));
    return true;
  }

  // ---- sources: sampled columns inside the band around the player ------------
  function trySnowAt(cx,prof,getTile,setTile){
    const strength=clamp(Number(prof.snowStrength)||0,0,1);
    if(strength<=0.05) return false;
    if(Math.random()>=strength*CFG.SNOW_P) return false;
    const land=surfaceCell(cx,getTile);
    if(!land || !supportHolds(land.support)) return false;
    if(tempAt(cx,land.py)>CFG.SNOW_TEMP_MAX) return false;
    return addUnits(cx,'snow',getTile,setTile);
  }
  function tryLeavesAt(cx,prof,wind,getTile,setTile){
    const strength=clamp(Number(prof.leafDropStrength)||0,0,1);
    if(strength<=0.05) return false;
    const gale=clamp(Math.abs(wind)/6,0,1);
    if(Math.random()>=strength*(0.25+gale*0.75)*CFG.LEAF_P) return false;
    const land=surfaceCell(cx,getTile);
    if(!land || !supportHolds(land.support)) return false;
    const drift=wind>=0?-1:1; // leaves blow in FROM the upwind canopy
    if(canopyAbove(cx,land.py,getTile)<0 && canopyAbove(cx+drift*2,land.py,getTile)<0) return false;
    return addUnits(cx,'leaves',getTile,setTile);
  }
  // Soot fallout: the PLUME is the driver, not the open-sky surface scan. Each
  // dense smoke cell projects straight down onto the first support beneath it,
  // so films build under roofs, in caves and on the open turf alike — exactly
  // where the aged, settled smog layer ends up resting. Deposition consumes
  // smoke mass, closing the smoke -> soot -> graphite carbon loop.
  function sootLandingBelow(sx,sy,getTile){
    for(let dy=0;dy<=CFG.SOOT_SCAN_DOWN;dy++){
      const y=sy+dy;
      const t=getTile(sx,y);
      if(!isSkyOpenTile(t)) return -1;             // the corridor closed mid-fall
      const below=getTile(sx,y+1);
      if(supportHolds(below)) return t===T.AIR?y:-1; // ground right under the plume
      if(!isSkyOpenTile(below)) return -1;         // liquids never carry a film
    }
    return -1;                                     // ground too far below the plume
  }
  function sootFalloutPass(px,getTile,setTile){
    const list=smokeDenseCells(CFG.SOOT_DENSITY_MIN,CFG.SOOT_FALL_BUDGET);
    if(!list.length) return;
    // A stacked plume gets ONE roll per ground column, driven by its densest
    // cell over that column (mirrors the retired scan's max-over-rows reading —
    // first-seen order would let a thin high wisp shadow the dense core).
    const landings=new Map(); // landing "x,y" -> {x,y,sy,d}
    for(const cell of list){
      if(!cell) continue;
      const sx=Math.floor(Number(cell.x)), sy=Math.floor(Number(cell.y));
      if(!Number.isFinite(sx)||!Number.isFinite(sy)||Math.abs(sx-px)>CFG.BAND) continue;
      const d=Number(cell.d)||0;
      if(d<CFG.SOOT_DENSITY_MIN) continue;
      const py=sootLandingBelow(sx,sy,getTile);
      if(py<0) continue;
      const lk=K(sx,py);
      const prev=landings.get(lk);
      if(!prev||d>prev.d) landings.set(lk,{x:sx,y:py,sy,d,age:Math.max(0,Number(cell.age)||0)});
    }
    const settledSec=smokeSettledSeconds();
    for(const L of landings.values()){
      // the densest plume stains fastest — the curve rewards the smoke core —
      // and a settled mixture rains out harder than a live climbing one
      const ageBoost=1+clamp(L.age/settledSec,0,1)*CFG.SOOT_AGE_BOOST;
      if(Math.random()>=CFG.SOOT_FALL_P*clamp(L.d/2.2,0,1)*ageBoost) continue;
      if(addUnitAtCell(L.x,L.y,'soot',getTile,setTile)) smokeConsumeAt(L.x,L.sy,CFG.SOOT_CONSUME);
    }
  }
  // ---- drift gales (zamiecie) -----------------------------------------------
  function surfaceAnchor(x){
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(x)); if(Number.isFinite(s)) return s; }
    }catch(e){}
    return 30;
  }
  // Snow takes precedence: deep winter keeps leafDropStrength high (the last
  // leaves falling), but a freezing gale over snowfall is a BLIZZARD — frozen,
  // buried leaves do not fly. Sand cannot clash (a desert is never cold and has
  // no canopies); soot is forcedOnly (only the soot shaman's ritual raises it).
  function naturalStormTarget(prof,px){
    const w=Math.abs(windSpeed());
    for(const mat of ['snow','sand','leaves']){
      const st=MATS[mat].storm;
      if(!st || st.forcedOnly) continue;
      let season=1;
      if(st.seasonKey){
        season=clamp(Number(prof[st.seasonKey])||0,0,1);
        // a SUMMONED blizzard snows regardless of the calendar (ICE_SHAMAN
        // ritual through clouds.startStorm) — the drift gale follows the snow
        if(mat==='snow' && season<st.seasonMin && cloudsSnowingAt(px)) season=1;
        if(season<st.seasonMin) continue;
      }
      if(st.needCold && tempAt(px,surfaceAnchor(px))>CFG.SNOW_TEMP_MAX) continue;
      let k=clamp((w-st.windMin)/(st.windFull-st.windMin),0,1)*season;
      if(st.climate!=null && climateAt(px)<st.climate) k=0;
      // the sand gale IS the sandstorm's fine fraction: adopt a live storm's
      // power (natural desert blow or the FIRE_SHAMAN ritual) directly
      if(mat==='sand') k=Math.max(k, sandstormPowerAt(px));
      if(k>0.05) return {mat, k};
    }
    return {mat:null, k:0};
  }
  function stormUpd(dt,prof,px){
    if(storm.active){
      storm.tLeft-=dt;
      if(storm.tLeft<=0) stopStorm();
    }
    const nat=naturalStormTarget(prof,px);
    stormNatK += (nat.k-stormNatK)*Math.min(1,dt*1.5);
    if(stormNatK<0.01) stormNatK=0;
    if(nat.mat) stormNatMat=nat.mat;
    const forcedK=storm.active?storm.intensity:0;
    const k=Math.max(stormNatK,forcedK);
    const mat=forcedK>=stormNatK ? (storm.active?storm.mat:stormNatMat) : stormNatMat;
    stormView=(k>0.05 && mat) ? {mat, k:clamp(k,0,1), dir:windSpeed()>=0?1:-1} : null;
  }
  function startStorm(mat,duration,intens,opts){
    opts=opts||{};
    if(!MATS[mat] || !MATS[mat].storm) return null;   // soot has no gale
    storm.active=true;
    storm.mat=mat;
    storm.tLeft=clamp((typeof duration==='number' && duration>0)? duration : 40+Math.random()*40, 5, CFG.STORM_MAX_SECONDS);
    storm.max=storm.tLeft;
    storm.intensity=clamp((typeof intens==='number' && isFinite(intens))? intens : 0.9, 0.2, 1);
    storm.source=typeof opts.source==='string' ? opts.source.slice(0,32) : null;
    storm.ownerId=opts.ownerId==null ? null : String(opts.ownerId).slice(0,64);
    return {mat, duration:storm.tLeft, intensity:storm.intensity, source:storm.source, ownerId:storm.ownerId};
  }
  function stormMatches(opts){
    if(!storm.active) return false;
    if(!opts || typeof opts!=='object') return true;
    if(opts.mat!=null && String(storm.mat)!==String(opts.mat)) return false;
    if(opts.source!=null && String(storm.source||'')!==String(opts.source)) return false;
    if(opts.ownerId!=null && String(storm.ownerId||'')!==String(opts.ownerId)) return false;
    return true;
  }
  function stopStorm(opts){
    if(!stormMatches(opts)) return false;
    storm.active=false; storm.mat=null; storm.tLeft=0; storm.max=0; storm.intensity=0;
    storm.source=null; storm.ownerId=null;
    return true;
  }
  function isStormActive(){ return !!(stormView && stormView.k>0.05); }
  // An upwind source the gale can strip: a leaf canopy, standing snow (pack,
  // snowy turf or a snow drift) or exposed sand (dune, desert floor or drift).
  function stormSourceUpwind(cx,mat,dir,getTile){
    for(let i=0;i<=CFG.STORM_UPWIND_SCAN;i+=5){
      const x=cx-dir*i;
      const land=surfaceCell(x,getTile);
      if(!land) continue;
      if(mat==='leaves'){
        if(canopyAbove(x,land.py,getTile)>=0) return true;
      } else if(mat==='snow'){
        if(land.support===T.SNOW || land.support===T.GRASS_SNOW) return true;
        const c=cells.get(K(x,land.py));
        if(c && c.m==='snow') return true;
      } else if(mat==='sand'){
        if(land.support===T.SAND || land.support===T.UNSTABLE_SAND) return true;
        const c=cells.get(K(x,land.py));
        if(c && c.m==='sand') return true;
      }
    }
    return false;
  }
  // Fresh material carried in on the wind: lands where it lands — the whole
  // point of a gale is litter far from any tree, snow far from the fall and
  // sand marching past the desert's edge. Conjured soot needs no source at
  // all — but ONLY while a forced (ritual/debug) smog storm is running.
  function stormBlowIn(cx,st,prof,getTile,setTile){
    const land=surfaceCell(cx,getTile);
    if(!land || !supportHolds(land.support)) return false;
    if(st.mat==='snow'){
      if(tempAt(cx,land.py)>CFG.SNOW_TEMP_MAX) return false;
      const snowing=clamp(Number(prof.snowStrength)||0,0,1)>0.05 || cloudsSnowingAt(cx);
      if(!snowing && !stormSourceUpwind(cx,'snow',st.dir,getTile)) return false;
    } else if(st.mat==='sand'){
      if(climateAt(cx)<(MATS.sand.storm.climate||0.72) && !stormSourceUpwind(cx,'sand',st.dir,getTile)) return false;
    } else if(st.mat==='soot'){
      if(!storm.active || storm.mat!=='soot') return false;
    } else if(!stormSourceUpwind(cx,'leaves',st.dir,getTile)) return false;
    if(!addUnits(cx,st.mat,getTile,setTile)) return false;
    stormBlownIn++;
    return true;
  }
  // NOTE (owner ruling): a landed drift LIES STILL. An earlier build marched
  // existing cells downwind during a gale, but sub-tile mounds shifting on
  // their own read as render artifacts, not weather — so a gale only BLOWS IN
  // fresh material; the sole thing that moves a landed drift is a body
  // ploughing through it.
  const STORM_NOTES={
    snow:'Śnieżna zamieć! Wiatr przywiewa śnieg i usypuje zaspy.',
    leaves:'Jesienna zamieć! Wichura niesie liście daleko od drzew.',
    sand:'Pustynna zamieć! Wiatr niesie tumany drobnego piasku.',
    soot:'Zamieć sadzy! Czarne płatki grzebią okolicę pod brudnym całunem.',
  };
  function stormNote(st){
    const d=MATS[st.mat] && MATS[st.mat].storm;
    if(!d || st.k<0.3 || stormNoted[st.mat]) return;
    stormNoted[st.mat]=true;
    try{
      if(MM.discovery && MM.discovery.note) MM.discovery.note(d.discovery, STORM_NOTES[st.mat]||STORM_NOTES.snow);
    }catch(e){}
  }

  // Spring rots the minted leaf piles away so autumn can bury the world again.
  function tryRotPileAt(cx,prof,getTile,setTile){
    if(clamp(Number(prof.leafGrowStrength)||0,0,1)<=0.3) return false;
    const land=surfaceCell(cx,getTile);
    if(!land || land.support!==T.LEAF_PILE || Math.random()>=0.3) return false;
    setTile(cx,land.supportY,T.AIR);
    if(getTile(cx,land.supportY)===T.LEAF_PILE) return false;
    notifyTileChanged(cx,land.supportY,getTile);
    return true;
  }

  // ---- decay + validation: the whole sparse map, once per tick ---------------
  // Everything soft fades on its own over ~FADE_DAYS of game time (owner
  // ruling: a ploughed-aside bank must not sit there forever). Season context
  // only ACCELERATES it — warm air melts fluff, spring rots litter, rain
  // washes the soot film — and an ACTIVE fall pauses it (fresh snow does not
  // evaporate mid-blizzard; litter keeps lying all autumn and under the snow).
  function daySeconds(){
    try{
      const s=seasonsRef();
      const v=s && s.constants && Number(s.constants.DAY_SECONDS);
      if(Number.isFinite(v) && v>30) return v;
    }catch(e){}
    return 600;
  }
  // Rain can only wash what it can reach: an open column all the way to the
  // sky. gases.js already owns that exact predicate live; the bounded local
  // scan is the standalone fallback (a roof, cave ceiling or overhang within
  // its budget reads as shelter).
  function rainReachesAt(cx,cy,getTile){
    try{
      const g=MM.gases;
      if(g && typeof g.skyExposed==='function') return !!g.skyExposed(cx,cy,getTile);
    }catch(e){}
    for(let dy=1;dy<=30;dy++){
      const yy=cy-dy;
      if(yy<WORLD_TOP) return true;
      if(!isSkyOpenTile(getTile(cx,yy))) return false;
    }
    return true;
  }
  function decayPass(prof,rainy,getTile){
    const grow=clamp(Number(prof.leafGrowStrength)||0,0,1);
    const drop=clamp(Number(prof.leafDropStrength)||0,0,1);
    const snowing=clamp(Number(prof.snowStrength)||0,0,1);
    const pBase=clamp(CFG.TICK*UNITS/(Math.max(0.05,CFG.FADE_DAYS)*daySeconds()),0,0.5);
    const galeMat=(stormView && stormView.k>0.05) ? stormView.mat : null;
    for(const [k,c] of cells){
      let p=pBase;
      if(c.m==='snow'){ if(tempAt(c.x,c.y)>CFG.WARM_MELT) p=0.22; else if(snowing>0.05) p=0; }
      else if(c.m==='leaves'){ if(grow>0.05) p=0.10; else if(drop>0.05) p=0; }
      // the wash needs actual rainfall ON the film — an indoor or cave film
      // under a storm keeps only the baseline fade
      else if(c.m==='soot' && rainy && rainReachesAt(c.x,c.y,getTile)) p=0.08;
      // an active gale of the same material is an active fall — pause the
      // baseline fade (accelerators like warm melt or rain wash still apply)
      if(p===pBase && c.m===galeMat) p=0;
      if(p>0 && Math.random()<p && --c.u<=0) cells.delete(k);
    }
  }
  function validatePass(getTile){
    for(const [k,c] of cells){
      const t=getTile(c.x,c.y);
      // Transient gases (a fire's hot-air puffs, steam) wander through the
      // room as REAL tiles — a passing puff must not delete the film it
      // crosses. Only genuine occupation (solids, liquids, grown foliage)
      // invalidates the cell.
      if(!(t===T.AIR || isGasTile(t)) || !supportHolds(getTile(c.x,c.y+1))) cells.delete(k);
    }
  }

  // ---- burst: bodies kick drifts (and leaf-pile tiles) apart -----------------
  // Owner rulings: the kick is a PLOUGH, not a delete, and the material is
  // airborne fluff — it may only travel to the DIRECTLY adjacent columns in
  // the SAME row (±1), never up or down a slope. The volume hangs in the air
  // for SETTLE_SEC and then visibly settles (a few drifting flakes mark the
  // landing), so it is obvious where the fluff came from.
  //   * a RUN through a drift:   50% settles back in place, 40% into the wake,
  //     10% ahead of the runner
  //   * a LANDING thump:         50% back in place, 25% to each side
  // A share whose side cell is blocked (wall, drop-off) settles back onto the
  // source cell instead — the volume does not vanish just because the terrain
  // said no.
  function queueSettle(x,y,sx,mat,u,getTile,setTile){
    if(u<=0) return;
    if(settling.length>=CFG.SETTLE_CAP){ depositSettled({x,y,sx,m:mat,u},getTile,setTile); return; }
    settling.push({x,y,sx,m:mat,u,t:CFG.SETTLE_SEC*(0.75+Math.random()*0.5)});
  }
  function depositSettled(s,getTile,setTile){
    let left=s.u;
    // exact target cell first, then back onto the source cell, then (world
    // changed under the flight) wherever the column's surface now is
    for(const [tx,ty] of [[s.x,s.y],[s.sx,s.y]]){
      while(left>0 && cellReceptive(tx,ty,getTile) && addUnitAtCell(tx,ty,s.m,getTile,setTile)) left--;
      if(left<=0) break;
    }
    while(left>0 && addUnits(s.sx,s.m,getTile,setTile)) left--;
    if(left<s.u){
      const tile=(MM&&MM.TILE)||20;
      flakes((s.x+0.5)*tile,(s.y+0.5)*tile,s.m,1+Math.min(2,s.u>>2),{loose:true});
    }
  }
  function processSettling(dt,getTile,setTile){
    for(let i=settling.length-1;i>=0;i--){
      const s=settling[i];
      s.t-=dt;
      if(s.t>0) continue;
      settling.splice(i,1);
      depositSettled(s,getTile,setTile);
    }
  }
  function ploughSplit(u,kind){
    const same=Math.round(u*0.5);
    const a=kind==='run' ? Math.round(u*0.4) : Math.round(u*0.25);
    return {same, a, b:Math.max(0,u-same-a)};
  }
  // kind 'run': a = the wake (behind the run), b = ahead; kind 'land': a/b = sides
  function scatterUnits(cx,cy,mat,units,dir,kind,getTile,setTile){
    const split=ploughSplit(units,kind);
    const aX = kind==='run' ? cx-(dir>=0?1:-1) : cx-1;
    const bX = kind==='run' ? cx+(dir>=0?1:-1) : cx+1;
    queueSettle(cx,cy,cx,mat,split.same,getTile,setTile);
    queueSettle(aX,cy,cx,mat,split.a,getTile,setTile);
    queueSettle(bX,cy,cx,mat,split.b,getTile,setTile);
    return units;
  }
  function burstCell(c,tile,dir,kind,getTile,setTile){
    // the flakes spray into the wake — against the run (or straight up on a thump)
    flakes((c.x+0.5)*tile,(c.y+1)*tile-2,c.m,3+c.u,{dir:kind==='run'?(dir>=0?-1:1):0});
    const u=c.u, mat=c.m, cx=c.x, cy=c.y;
    cells.delete(K(cx,cy));
    scatterUnits(cx,cy,mat,u,dir,kind,getTile,setTile);
    bursts++;
  }
  function noteDiscovery(){
    if(noted) return;
    noted=true;
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('soft_drifts','Miękka zaspa rozsypuje się pod nogami w chmurę płatków!'); }catch(e){}
  }
  // ---- footprints: visual tracks, no volume ---------------------------------
  // Bare terrain also takes prints: fresh snowpack and loose sand hold a boot
  // mark even where no sub-tile drift fluff has accumulated. A print on such a
  // tile is flagged `surf` so draw/validate anchor it to the tile's top face
  // and keep it only while that tile is still that material.
  const SURF_PRINT_MAT = {
    [T.SNOW]:'snow', [T.GRASS_SNOW]:'snow', [T.TOXIC_SNOW]:'snow', [T.ICE]:'snow',
    [T.SAND]:'sand', [T.UNSTABLE_SAND]:'sand'
  };
  function surfacePrintMat(t){ return SURF_PRINT_MAT[t]||null; }
  function stampPrint(cx,cy,m,dir,surf){
    if(prints.size>=CFG.PRINT_CAP && !prints.has(K(cx,cy))){
      let oldest=null, worst=-1, probes=0;
      for(const [pk,p] of prints){
        if(p.bornMs<worst || oldest==null){ worst=p.bornMs; oldest=pk; }
        if(++probes>=48) break;
      }
      if(oldest!=null) prints.delete(oldest);
    }
    prints.set(K(cx,cy),{x:cx,y:cy,m,dir:dir>=0?1:-1,bornMs:nowMs(),surf:!!surf});
  }
  function printAgeSec(p){ return Math.max(0,(nowMs()-p.bornMs)/1000); }
  // The lowest drift cell each body column touches is where the feet press; on
  // a column with no drift, the top of a solid snow/sand tile takes the print.
  function stampBodyPrints(body,getTile){
    const dir=(Number(body.vx)||0)>=0?1:-1;
    const w=Number.isFinite(body.w)&&body.w>0?body.w:0.7;
    const h=Number.isFinite(body.h)&&body.h>0?body.h:0.95;
    const x0=Math.floor(body.x-w/2), x1=Math.floor(body.x+w/2);
    const yLo=Math.floor(body.y-h), yHi=Math.floor(body.y+h/2)+1;
    for(let cx=x0;cx<=x1;cx++){
      let done=false;
      for(let cy=yHi;cy>=yLo;cy--){
        const c=cells.get(K(cx,cy));
        if(c && c.u>=CFG.PRINT_MIN_UNITS){ stampPrint(cx,cy,c.m,dir,false); done=true; break; }
      }
      if(done || typeof getTile!=='function') continue;
      // no drift here: press into the bare surface tile under the feet
      const fy=Math.floor(body.y+h/2)+1;
      for(const cy of [fy,fy-1,fy+1]){
        const m=surfacePrintMat(getTile(cx,cy));
        if(m && isSkyOpenTile(getTile(cx,cy-1))){ stampPrint(cx,cy,m,dir,true); break; }
      }
    }
  }
  // Creature tracks: ground animals pressing through drifts near the player —
  // a trail you can HUNT along. mobs.js exposes a zero-alloc iterator; when it
  // is absent (Node sims, old builds) there are simply no animal trails.
  function mobPrintsPass(px,getTile){
    const M=MM.mobs;
    if(!M || typeof M.forEachLive!=='function') return;
    try{
      M.forEachLive((m,spec)=>{
        if(!m || !spec || spec.flying || spec.aquatic) return;
        const vx=Number(m.vx)||0;
        if(Math.abs(vx)<CFG.PRINT_MIN_SPEED || Math.abs(m.x-px)>CFG.PRINT_MOB_BAND) return;
        const halfH=((spec.body&&spec.body.h)||0.8)/2;
        const mx=Math.floor(m.x), fy=Math.floor(m.y+halfH);
        const dir=vx>=0?1:-1;
        for(const cy of [fy,fy-1]){
          const c=cells.get(K(mx,cy));
          if(c && c.u>=CFG.PRINT_MIN_UNITS){ stampPrint(mx,cy,c.m,dir,false); return; }
        }
        if(typeof getTile!=='function') return;
        for(const cy of [fy+1,fy,fy-1]){
          const mat=surfacePrintMat(getTile(mx,cy));
          if(mat && isSkyOpenTile(getTile(mx,cy-1))){ stampPrint(mx,cy,mat,dir,true); return; }
        }
      });
    }catch(e){}
  }
  function sweepBody(body,isPlayer,getTile,setTile,tile){
    if(!body || !Number.isFinite(body.x) || !Number.isFinite(body.y)) return;
    // landing detection: physics zeroes vy on the impact frame, so the thump
    // is the TRANSITION — the previous sweep saw a fast fall, this one rest
    const vyNow=Number(body.vy)||0;
    const vyPrev=Number(body._driftVyPrev)||0;
    body._driftVyPrev=vyNow;
    const running=Math.abs(Number(body.vx)||0)>=CFG.BURST_SPEED;
    const landed=vyPrev>CFG.LAND_VY && vyNow<0.6;
    // even a slow walk presses tracks into the fluff (the plough needs a run)
    if(Math.abs(Number(body.vx)||0)>=CFG.PRINT_MIN_SPEED) stampBodyPrints(body,getTile);
    if(!running && !landed) return;
    const kind=running?'run':'land';
    const w=Number.isFinite(body.w)&&body.w>0?body.w:0.7;
    const h=Number.isFinite(body.h)&&body.h>0?body.h:0.95;
    const x0=Math.floor(body.x-w/2), x1=Math.floor(body.x+w/2);
    const y0=Math.floor(body.y-h), y1=Math.floor(body.y);
    const dir=(Number(body.vx)||0)>=0?1:-1;
    for(let cx=x0;cx<=x1;cx++) for(let cy=y0;cy<=y1;cy++){
      const c=cells.get(K(cx,cy));
      if(c && bodyFootprintOverlapsCell(body,cx,cy,null)){
        const thickSoot=(c.m==='soot' && c.u>=4);
        burstCell(c,tile,dir,kind,getTile,setTile);
        if(isPlayer){
          noteDiscovery();
          // ploughing a THICK soot film shakes loose a lump of pigment
          if(thickSoot && Math.random()<0.6){ try{ if(MM.collectSoot) MM.collectSoot(1); }catch(e){} }
        }
      }
      // the minted litter block is run-through too: it shreds back into loose
      // litter (a full block = UNITS of volume) under the same plough split
      if(getTile(cx,cy)===T.LEAF_PILE && bodyFootprintOverlapsCell(body,cx,cy,null)){
        setTile(cx,cy,T.AIR);
        if(getTile(cx,cy)!==T.LEAF_PILE){
          notifyTileChanged(cx,cy,getTile);
          flakes((cx+0.5)*tile,(cy+0.7)*tile,'leaves',12,{dir:kind==='run'?-dir:0});
          scatterUnits(cx,cy,'leaves',UNITS,dir,kind,getTile,setTile);
          bursts++;
          if(isPlayer) noteDiscovery();
        }
      }
    }
  }
  function sweepBodies(player,getTile,setTile){
    const t=nowMs();
    if(t-sweepAtMs<CFG.SWEEP_MS) return;
    sweepAtMs=t;
    const tile=(MM&&MM.TILE)||20;
    sweepBody(player,true,getTile,setTile,tile);
    const bodies=(typeof MM!=='undefined' && MM.coopBodies) || null;
    if(!bodies || !bodies.length) return;
    for(const b of bodies){ if(b && !b.dead) sweepBody(b,false,getTile,setTile,tile); }
  }

  // Cosmetic falling leaves near the player while an autumn wind shakes canopies.
  function ambientLeaves(dt,prof,wind,px,getTile){
    const strength=clamp(Number(prof.leafDropStrength)||0,0,1);
    const gale=clamp(Math.abs(wind)/6,0,1);
    if(strength<=0.3 || gale<=0.15) return;
    ambientAcc+=dt*CFG.AMBIENT_LEAF_RATE*strength*gale;
    const tile=(MM&&MM.TILE)||20;
    while(ambientAcc>=1){
      ambientAcc-=1;
      const cx=px+Math.floor((Math.random()*2-1)*26);
      const land=surfaceCell(cx,getTile);
      if(!land) continue;
      const cy=canopyAbove(cx,land.py,getTile);
      if(cy<0) continue;
      flakes((cx+Math.random())*tile,(cy+0.8)*tile,'leaves',1,{dir:wind>=0?1:-1,loose:true});
    }
  }

  function update(dt,player,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return;
    if(typeof dt!=='number' || !(dt>0)) return;
    if(dt>0.1) dt=0.1;
    sweepBodies(player,getTile,setTile);
    processSettling(dt,getTile,setTile);
    const prof=profileNow();
    if(!prof) return;
    const px=(player && Number.isFinite(player.x))?Math.floor(player.x):0;
    const wind=windSpeed();
    stormUpd(dt,prof,px);
    ambientLeaves(dt,prof,wind,px,getTile);
    printMobAcc+=dt;
    if(printMobAcc>=CFG.PRINT_MOB_MS/1000){ printMobAcc=0; mobPrintsPass(px,getTile); }
    tickAcc+=dt;
    if(tickAcc<CFG.TICK) return;
    tickAcc=0;
    for(let i=0;i<CFG.SAMPLES;i++){
      const cx=px+(Math.random()<0.5?-1:1)*Math.floor(Math.random()*CFG.BAND);
      // each material rolls independently — heavy leaf fall on a column must
      // not starve another material's cover on the same ground
      trySnowAt(cx,prof,getTile,setTile);
      tryLeavesAt(cx,prof,wind,getTile,setTile);
      tryRotPileAt(cx,prof,getTile,setTile);
    }
    // soot is plume-driven, not column-sampled: every dense smoke cell in the
    // band is a candidate, wherever it hangs — under roofs and in caves too
    sootFalloutPass(px,getTile,setTile);
    const st=stormView;
    if(st){
      stormNote(st);
      const extra=Math.round(CFG.STORM_SAMPLES*st.k);
      for(let i=0;i<extra;i++){
        const reach=CFG.STORM_DOWNWIND_MIN+Math.random()*(CFG.STORM_DOWNWIND_MAX-CFG.STORM_DOWNWIND_MIN);
        const cx=px+Math.floor((Math.random()*2-1)*CFG.BAND*0.8+st.dir*reach);
        stormBlowIn(cx,st,prof,getTile,setTile);
      }
    }
    let rainy=false;
    try{ const cm=MM.clouds && MM.clouds.metrics && MM.clouds.metrics(); rainy=!!(cm && cm.storm && cm.storm.active); }catch(e){}
    decayPass(prof,rainy,getTile);
    validatePass(getTile);
  }

  function hash2(x,y){
    let h=(x*73856093)^(y*19349663);
    h=(h^(h>>13))*1274126177;
    return ((h^(h>>16))>>>0)/4294967296;
  }
  // Dirty-snow tint buckets (brudny śnieg): d 0..1 picks a grey — winter near
  // industry goes visibly ashen without per-frame colour math.
  const SNOW_DIRT_BASE=['#e9f2fc','#d6dde4','#c2c7cd','#a9adb3','#8e9196'];
  const SNOW_DIRT_TOP =['#ffffff','#eceef1','#d5d8db','#bcbfc3','#a1a4a8'];
  function draw(ctx,TILE,sx,sy,viewX,viewY,visible){
    if(!ctx || (!cells.size && !prints.size)) return;
    const x0=sx-1, x1=sx+viewX+2, y0=sy-1, y1=sy+viewY+2;
    for(const c of cells.values()){
      if(c.x<x0 || c.x>x1 || c.y<y0 || c.y>y1) continue;
      if(typeof visible==='function' && !visible(c.x,c.y)) continue;
      const m=MATS[c.m]||MATS.snow;
      const hgt=Math.max(2,(c.u/UNITS)*TILE*m.heightScale);
      const bx=c.x*TILE, by=(c.y+1)*TILE-hgt;
      const r=hash2(c.x,c.y);
      let baseCol=m.base, topCol=m.top;
      if(c.m==='snow' && c.d>0){
        const bucket=Math.min(4,Math.round(c.d*4));
        baseCol=SNOW_DIRT_BASE[bucket]; topCol=SNOW_DIRT_TOP[bucket];
      }
      ctx.fillStyle=baseCol;
      ctx.fillRect(bx,by,TILE,hgt);
      // a soft uneven crest: two bumps offset by the cell hash sell "settled"
      const b1=2+r*5, b2=2+((r*7)%1)*5;
      ctx.fillRect(bx+2+r*4,by-2,b1,2);
      ctx.fillRect(bx+TILE-6-((r*13)%1)*6,by-1,b2,1);
      ctx.fillStyle=topCol;
      ctx.fillRect(bx,by,TILE,1.5);
      ctx.fillStyle=m.speck;
      for(let i=0;i<3;i++){
        const rr=hash2(c.x*3+i,c.y*5+i);
        ctx.fillRect(bx+rr*(TILE-3),by+1+((rr*11)%1)*(hgt-2),2,1.5);
      }
    }
    // footprint tracks: heel+toe pits along the walk direction, fading with
    // age. Drift prints sit on the fluff mound; surface prints (`surf`) sit on
    // the top face of a bare snow/sand tile and outlive the drift entirely —
    // they persist as long as that tile stays snow/sand.
    if(prints.size){
      const gt=(MM.world&&MM.world.getTile)||null;
      for(const [pk,p] of prints){
        const ageS=printAgeSec(p);
        if(ageS>CFG.PRINT_LIFE){ prints.delete(pk); continue; }
        let by, m;
        if(p.surf){
          if(gt && !surfacePrintMat(gt(p.x,p.y))){ prints.delete(pk); continue; }
          m=MATS[p.m]||MATS.snow;
          by=p.y*TILE;              // top face of the solid tile
        } else {
          const c=cells.get(pk);
          if(!c || c.u<1){ prints.delete(pk); continue; }
          m=MATS[c.m]||MATS.snow;
          const hgt=Math.max(2,(c.u/UNITS)*TILE*m.heightScale);
          by=(c.y+1)*TILE-hgt;
        }
        if(p.x<x0 || p.x>x1 || p.y<y0 || p.y>y1) continue;
        if(typeof visible==='function' && !visible(p.x,p.y)) continue;
        const bx=p.x*TILE;
        ctx.globalAlpha=Math.max(0.18,0.72*(1-ageS/CFG.PRINT_LIFE));
        ctx.fillStyle=m.ink||'#6b7280';
        ctx.fillRect(bx+TILE*0.5-p.dir*TILE*0.22-2.5, by+1.5, 5, 2.5);
        ctx.fillRect(bx+TILE*0.5+p.dir*TILE*0.08-2.5, by+2.4, 5, 2.5);
        ctx.globalAlpha=1;
      }
    }
  }

  // A watcher renders the gale from the streamed mirror; the host from its sim.
  function activeStormView(){
    if(stormView) return stormView;
    if(ghostStorm && ghostStorm.untilMs>nowMs()) return ghostStorm;
    return null;
  }
  // Screen-space gale pass (after the sandstorm haze in main.js): a directional
  // colour haze plus flakes streamed into the upper view — the shared wind in
  // the particle sim does the actual carrying, so they fly with the real gale.
  function drawStorm(ctx,TILE,sx,sy,viewX,viewY,spawnFx){
    const st=activeStormView();
    if(!ctx || !st) return;
    const def=MATS[st.mat] && MATS[st.mat].storm;
    if(!def) return;
    const t=nowMs();
    const dt=lastStormDrawMs? clamp((t-lastStormDrawMs)/1000,0,0.1) : 0.016;
    lastStormDrawMs=t;
    // the gale lives on the surface: fade the whole pass out within a few
    // tiles of cover, so a deep mine never shows a white-out
    let k=st.k;
    const p=(typeof window!=='undefined' && window.player)||null;
    if(p && Number.isFinite(p.x) && Number.isFinite(p.y)){
      const depth=p.y-surfaceAnchor(Math.floor(p.x));
      if(depth>2) k*=clamp(1-(depth-2)/5,0,1);
    }
    if(k<=0.03) return;
    // spawnFx=false while the sim is held (pause/ceremony): particles are not
    // aging then, so streaming more would pile a frozen wall up to the cap
    if(spawnFx!==false){
      stormFlakeAcc+=dt*Math.min(CFG.STORM_FLAKE_CAP, def.flakeRate*2.4*k);
      while(stormFlakeAcc>=1){
        stormFlakeAcc-=1;
        const fx=(sx+Math.random()*(viewX+1))*TILE;
        const fy=(sy+Math.random()*Math.max(1,viewY*0.55))*TILE;
        flakes(fx,fy,st.mat,1,{loose:true,dir:st.dir});
      }
    } else stormFlakeAcc=0;
    const a=def.hazeMax*k;
    if(a<=0.02) return;
    const x0=sx*TILE, y0=sy*TILE, w=(viewX+2)*TILE, h=(viewY+2)*TILE;
    const rgb=def.haze;
    ctx.save();
    ctx.fillStyle='rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(a*0.5).toFixed(3)+')';
    ctx.fillRect(x0,y0,w,h);
    const tt=t*0.0007;
    for(let i=0;i<3;i++){
      const bandY=y0+((Math.sin(tt*0.9+i*2.1)*0.5+0.5)*0.8+0.1)*h;
      const g=ctx.createLinearGradient(0,bandY-h*0.16,0,bandY+h*0.16);
      g.addColorStop(0,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0)');
      g.addColorStop(0.5,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+(a*0.34).toFixed(3)+')');
      g.addColorStop(1,'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0)');
      ctx.fillStyle=g;
      ctx.fillRect(x0,bandY-h*0.16,w,h*0.32);
    }
    ctx.restore();
  }

  // ---- ghost mirror: the 'drift' plane (host reads windows, watcher applies) --
  function ghostLevelsIn(x0,y0,x1,y1,out){
    out=out||[];
    const ax=Math.floor(Math.min(x0,x1)), bx=Math.floor(Math.max(x0,x1));
    const ay=Math.max(WORLD_TOP,Math.floor(Math.min(y0,y1))), by=Math.min(WORLD_BOTTOM-1,Math.floor(Math.max(y0,y1)));
    for(const c of cells.values()){
      if(out.length>=400) break;
      if(c.x>=ax && c.x<=bx && c.y>=ay && c.y<=by){
        const row=[c.x,c.y,c.u,MATS[c.m]?MATS[c.m].wire:0];
        if(c.d>0) row.push(Math.round(c.d*100)); // dirty-snow stain rides as an optional 5th
        out.push(row);
      }
    }
    return out;
  }
  // Footprint windows ride the same 'drift' packet (packet.p): [x,y,wire,dir,age10].
  // Age is quantized to 10 s buckets so an idle scene keeps a stable sig.
  function ghostPrintsIn(x0,y0,x1,y1,out){
    out=out||[];
    const ax=Math.floor(Math.min(x0,x1)), bx=Math.floor(Math.max(x0,x1));
    const ay=Math.max(WORLD_TOP,Math.floor(Math.min(y0,y1))), by=Math.min(WORLD_BOTTOM-1,Math.floor(Math.max(y0,y1)));
    for(const p of prints.values()){
      if(out.length>=200) break;
      if(p.x<ax || p.x>bx || p.y<ay || p.y>by) continue;
      const age=printAgeSec(p);
      if(age>CFG.PRINT_LIFE) continue;
      const row=[p.x,p.y,MATS[p.m]?MATS[p.m].wire:0,p.dir,Math.floor(age/10)];
      if(p.surf) row.push(1); // surface prints carry an optional 6th flag
      out.push(row);
    }
    return out;
  }
  function ghostApplyPrintsWindow(x0,y0,x1,y1,list){
    if(!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return 0;
    const ax=Math.floor(Math.min(x0,x1)), bx=Math.min(Math.floor(Math.max(x0,x1)), ax+48);
    const ay=Math.max(WORLD_TOP,Math.floor(Math.min(y0,y1))), by=Math.min(WORLD_BOTTOM-1,Math.floor(Math.max(y0,y1)), ay+32);
    for(const [pk,p] of prints){
      if(p.x>=ax && p.x<=bx && p.y>=ay && p.y<=by) prints.delete(pk);
    }
    const rows=Array.isArray(list)?list.slice(0,200):[];
    let n=0;
    for(const row of rows){
      if(!Array.isArray(row) || row.length<4) continue;
      const x=Math.floor(Number(row[0])), y=Math.floor(Number(row[1]));
      const m=MAT_ORDER[Math.floor(Number(row[2]))]||'snow';
      if(!Number.isFinite(x) || !Number.isFinite(y) || x<ax || x>bx || y<ay || y>by) continue;
      const age10=clamp(Math.floor(Number(row[4]))||0,0,Math.ceil(CFG.PRINT_LIFE/10));
      prints.set(K(x,y),{x,y,m,dir:Number(row[3])>=0?1:-1,bornMs:nowMs()-age10*10000,surf:row.length>=6&&Number(row[5])===1});
      n++;
    }
    return n;
  }
  function ghostApplyLevelsWindow(x0,y0,x1,y1,list){
    if(!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return 0;
    const ax=Math.floor(Math.min(x0,x1)), bx=Math.min(Math.floor(Math.max(x0,x1)), ax+48);
    const ay=Math.max(WORLD_TOP,Math.floor(Math.min(y0,y1))), by=Math.min(WORLD_BOTTOM-1,Math.floor(Math.max(y0,y1)), ay+32);
    const rows=Array.isArray(list)?list.slice(0,400):[];
    const incoming=new Set();
    for(const row of rows){ if(Array.isArray(row) && row.length>=3) incoming.add(K(Math.floor(Number(row[0])),Math.floor(Number(row[1])))); }
    // the window is authoritative — and a cell the host just cleared at level
    // >=4 was almost certainly kicked apart, so the watcher gets the poof too
    // (budgeted: a hostile host flapping windows buys a handful of poofs, not
    // a particle storm — the flake cap would hold anyway, this keeps it cheap)
    const tile=(MM&&MM.TILE)||20;
    let poofs=0;
    for(const [k,c] of cells){
      if(c.x<ax || c.x>bx || c.y<ay || c.y>by) continue;
      if(!incoming.has(k) && c.u>=4 && poofs<CFG.POOF_BUDGET){
        poofs++;
        flakes((c.x+0.5)*tile,(c.y+1)*tile-2,c.m,3+c.u,{dir:Math.random()<0.5?-1:1});
      }
      cells.delete(k);
    }
    let n=0;
    for(const row of rows){
      if(!Array.isArray(row) || row.length<3) continue;
      const x=Math.floor(Number(row[0])), y=Math.floor(Number(row[1])), u=Math.floor(Number(row[2]));
      const m=MAT_ORDER[Math.floor(Number(row[3]))]||'snow';
      if(!Number.isFinite(x) || !Number.isFinite(y) || x<ax || x>bx || y<ay || y>by) continue;
      if(!(u>=1 && u<=UNITS)) continue;
      const cell={x,y,m,u};
      const d100=Math.floor(Number(row[4]))||0;   // optional dirty-snow stain
      if(d100>0) cell.d=clamp(d100,0,100)/100;
      cells.set(K(x,y),cell);
      n++;
    }
    return n;
  }
  // Gale state rides the same 'drift' packet: [wireMat, intensity 0..100, dir].
  function ghostStormOut(){
    const st=stormView;
    if(!st || !(st.k>0.05)) return null;
    return [MATS[st.mat]?MATS[st.mat].wire:0, Math.round(st.k*100), st.dir>=0?1:-1];
  }
  // Watcher-side mirror, display-only and sanitized: only materials that CAN
  // storm are accepted, intensity is clamped, and the mirror fades on its own
  // TTL if the host goes quiet (no storm ever outlives its stream).
  function ghostApplyStorm(arr){
    if(!Array.isArray(arr) || arr.length<3){ ghostStorm=null; return false; }
    const mat=MAT_ORDER[Math.floor(Number(arr[0]))];
    if(!mat || !MATS[mat] || !MATS[mat].storm){ ghostStorm=null; return false; }
    const k=clamp(Math.floor(Number(arr[1]))||0,0,100)/100;
    if(k<=0.05){ ghostStorm=null; return false; }
    ghostStorm={mat, k, dir:Number(arr[2])>=0?1:-1, untilMs:nowMs()+3000};
    return true;
  }

  // Debug seams (menu panel / QA): seeding rides the SAME addUnits rules as
  // the weather sources — placement, stacking, conversion and the body guard
  // all apply, so a debug-poured drift behaves exactly like a natural one.
  function seedAround(cx,radius,mat,units,getTile,setTile){
    if(!MATS[mat] || typeof getTile!=='function') return 0;
    const r=clamp(Math.floor(radius)||0,0,24);
    const per=clamp(Math.floor(units)||0,1,UNITS);
    let landed=0;
    for(let x=Math.floor(cx)-r;x<=Math.floor(cx)+r;x++){
      for(let i=0;i<per;i++){ if(addUnits(x,mat,getTile,setTile)) landed++; else break; }
    }
    return landed;
  }
  function clearAll(){
    const n=cells.size;
    cells.clear();
    return n;
  }

  function reset(){
    cells.clear();
    settling.length=0;
    prints.clear();
    printMobAcc=0;
    tickAcc=0; sweepAtMs=0; ambientAcc=0;
    minted={snow:0,leaves:0,soot:0,sand:0,graphite:0};
    bursts=0; noted=false; graphiteNoted=false;
    stopStorm();
    stormNatK=0; stormNatMat=null; stormView=null; ghostStorm=null;
    for(const mat of Object.keys(stormNoted)) stormNoted[mat]=false;
    stormFlakeAcc=0; lastStormDrawMs=0; stormBlownIn=0;
  }
  function metrics(){
    const byMat={snow:0,leaves:0,soot:0,sand:0};
    for(const c of cells.values()) byMat[c.m]=(byMat[c.m]|0)+1;
    const st=stormView;
    let dirty=0;
    for(const c of cells.values()) if(c.d>0) dirty++;
    return {cells:cells.size, settling:settling.length, byMat, minted:{...minted}, bursts,
      prints:prints.size, dirty,
      storm:{active:isStormActive(), mat:st?st.mat:null, k:st?+st.k.toFixed(3):0,
        forced:storm.active, natural:+stormNatK.toFixed(3), blownIn:stormBlownIn}};
  }

  MM.softDrifts={update, draw, drawStorm, reset, metrics, count:()=>cells.size,
    startStorm, stopStorm, isStormActive, seedAround, clearAll,
    ghostLevelsIn, ghostApplyLevelsWindow, ghostStormOut, ghostApplyStorm,
    ghostPrintsIn, ghostApplyPrintsWindow,
    UNITS, materials:MAT_ORDER.slice(), config:CFG,
    _debug:{cells, settling, prints, MATS, addUnits, addUnitAtCell, cellReceptive, queueSettle, depositSettled, processSettling, ploughSplit, convertFull, surfaceCell, canopyAbove, sweepBody, sweepBodies, scatterUnits,
      trySnowAt, tryLeavesAt, sootFalloutPass, sootLandingBelow, tryRotPileAt, decayPass, validatePass, setSweepAt:(v)=>{sweepAtMs=v;},
      stampPrint, stampBodyPrints, mobPrintsPass, printAgeSec,
      storm, stormUpd, stormBlowIn, stormSourceUpwind, naturalStormTarget,
      stormViewNow:()=>stormView, ghostStormNow:()=>ghostStorm}};
})();

export const softDrifts = (typeof window!=='undefined' && window.MM) ? window.MM.softDrifts : globalThis.MM && globalThis.MM.softDrifts;
export default softDrifts;
