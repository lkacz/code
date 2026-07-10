import { T, MOVE, isLeaf, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isBlastProtectedTile, isCreatureRockFloorTile, isSolidCollisionTile as isSolid } from './material_physics.js';
import WORLD from './world.js';
import { worldGen as WORLDGEN } from './worldgen.js';
import { worldHostility as HOSTILITY } from './world_hostility.js';

// Basic mob / animal system (birds, fish) with aggression propagation.
// Exposes MM.mobs API (legacy) and ESM exports.
const mobs = (function(){
  const MM = window.MM = window.MM || {};
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  function inWorldY(y,topPad=0,bottomPad=0){
    return Number.isFinite(y) && y>=WORLD_TOP+topPad && y<WORLD_BOTTOM-bottomPad;
  }
  // Using ESM imports for T/MOVE/isSolid/WORLD/WORLDGEN
  // Helper predicates
  function isSolidGround(t){ return isSolid(t) && !isLeaf(t); }
  function isRockFloor(t){ return isCreatureRockFloorTile(t); }

  // Precomputed color variant helper (once per mob instead of per-frame string math)
  function variantColor(spawnT, shiftBits, a, b){
    const t = ((spawnT>>>shiftBits)&7)/7; // 0..1 discrete steps
    const ca=parseInt(a.slice(1),16), cb=parseInt(b.slice(1),16);
    const r=((ca>>16)&255)+(((cb>>16)&255)-((ca>>16)&255))*t;
    const g=((ca>>8)&255)+(((cb>>8)&255)-((ca>>8)&255))*t;
    const b2=(ca&255)+((cb&255)-(ca&255))*t;
    return '#'+((r|0).toString(16).padStart(2,'0'))+((g|0).toString(16).padStart(2,'0'))+((b2|0).toString(16).padStart(2,'0'));
  }

  // Color jitter helpers to produce richer per-mob palette variation
  function hexToRgb(hex){ const n=parseInt(hex.slice(1),16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
  function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,'0')).join(''); }
  function rgbToHsl(r,g,b){ r/=255; g/=255; b/=255; const max=Math.max(r,g,b), min=Math.min(r,g,b); let h,s,l=(max+min)/2; if(max===min){ h=s=0; } else { const d=max-min; s=l>0.5? d/(2-max-min): d/(max+min); switch(max){ case r: h=(g-b)/d+(g<b?6:0); break; case g: h=(b-r)/d+2; break; default: h=(r-g)/d+4; } h/=6; } return {h,s,l}; }
  function hslToRgb(h,s,l){ let r,g,b; if(s===0){ r=g=b=l; } else { const hue2rgb=(p,q,t)=>{ if(t<0) t+=1; if(t>1) t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; }; const q=l<0.5? l*(1+s): l+s-l*s; const p=2*l-q; r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); } return {r:(r*255)|0,g:(g*255)|0,b:(b*255)|0}; }
  function jitterColor(baseHex, opts){ const {h=12, s=0.12, l=0.10} = opts||{}; try{ const {r,g,b}=hexToRgb(baseHex); let {h:hh,s:ss,l:ll}=rgbToHsl(r,g,b); const dh=((Math.random()*2-1)*h)/360; const ds=1+ (Math.random()*2-1)*s; const dl=1+ (Math.random()*2-1)*l; hh=(hh+dh+1)%1; ss=Math.max(0,Math.min(1, ss*ds)); ll=Math.max(0,Math.min(1, ll*dl)); const {r:rr,g:gg,b:bb}=hslToRgb(hh,ss,ll); return rgbToHex(rr,gg,bb); }catch(e){ return baseHex; } }

  const mobs = []; // entities
  const speciesAggro = {}; // speciesId -> expiry timestamp (ms)
  const HERO_FOCUS_MS = 12000;
  const speciesCounts = {}; // live counts for quick spawn capping
  const ECO_LOCAL_RADIUS = 92;
  const ECO_INNER_RADIUS = 18;
  const ECO_TOTAL_LOCAL_CAP = 34;
  const ECO_MAX_BIRTHS_PER_PASS = 2;
  const ECO_SPAWN_MIN_MS = 4200;
  const ECO_SPAWN_JITTER_MS = 2600;
  const DEFAULT_SUNRISE_BURN = { dur: 8, dps: 6 };
  // Spawn throttle/freeze (used after world regeneration)
  let spawnFreezeUntil = 0; // timestamp (ms). While now < this, no new spawns are attempted.
  let lastDayState = null;
  // Spatial partitioning (uniform grid) to speed up point queries (attackAt)
  const CELL=16; // tiles per cell both axes
  const grid = new Map(); // key "cx,cy" -> Set of mob refs
  function cellKey(x,y){ return ((x/CELL)|0)+','+((y/CELL)|0); }
  function addToGrid(m){ const k=cellKey(m.x,m.y); let set=grid.get(k); if(!set){ set=new Set(); grid.set(k,set); } set.add(m); m._cellKey=k; }
  function updateGridCell(m){ const k=cellKey(m.x,m.y); if(k!==m._cellKey){ // move
    if(m._cellKey){ const prev=grid.get(m._cellKey); if(prev){ prev.delete(m); if(!prev.size) grid.delete(m._cellKey); } }
    let set=grid.get(k); if(!set){ set=new Set(); grid.set(k,set); } set.add(m); m._cellKey=k; }
  }
  function removeFromGrid(m){ if(m._cellKey){ const set=grid.get(m._cellKey); if(set){ set.delete(m); if(!set.size) grid.delete(m._cellKey); } m._cellKey=null; } if(m && m.id){ speciesCounts[m.id] = (speciesCounts[m.id]||1)-1; if(speciesCounts[m.id]<0) speciesCounts[m.id]=0; } }

  // --- Species registry (extensible) ---
  const SPECIES = {
    BIRD: {
  id: 'BIRD', max: 18, hp: 6, dmg: 4, speed: 3.2, wanderInterval: [2,6], xp:4, flying:true,
      sightRange: 18, pursueRange: 26,
      variant:{shift:1, from:'#f5d16a', to:'#ffe07a'},
      spawnTest(x,y,getTile){ // spawn perched above leaves (air above leaf)
        const below = getTile(x,y+1); const here = getTile(x,y);
        return here===T.AIR && isLeaf(below); },
      biome: 'any',
      habitatUpdate(m, spec, getTile){ // keep slightly above ground
        const groundTile = getTile(Math.floor(m.x), Math.floor(m.y)+1); if(groundTile!==T.AIR){ m.vy -= 0.8; }
      }
    },
    FISH: {
  id: 'FISH', max: 24, hp: 4, dmg: 3, speed: 2.2, wanderInterval:[1,4], xp:3,
      sightRange: 14, pursueRange: 20,
      body:{w:0.9,h:0.45},
      variant:{shift:2, from:'#4eb2f1', to:'#63c6ff'},
      spawnTest(x,y,getTile){ return canHostFishSpawn(x,y,getTile); },
      biome: 'any', aquatic:true,
      onCreate(m, spec, getTile){ initWaterAnchor(m,getTile); },
      habitatUpdate(m, spec, getTile, dt){ enforceAquatic(m, spec, getTile, dt); }
    }
  };
  let nextPiranhaAmbush = 0;
  const PIRANHA_BAIT_SCAN_MS = 260;
  const PIRANHA_BAIT_RADIUS = 18;
  const PIRANHA_BAIT_ZONE_RADIUS = 22;
  const PIRANHA_BAIT_BROADCAST_RADIUS = 15;
  const PIRANHA_BAIT_ZONE_CAP = 12;
  const PIRANHA_PREY_RANGE = 20;
  const PIRANHA_MEAT_DROP_CHANCE = 0.03;
  const PIRANHA_IGNORE_PREY = Object.freeze({PIRANHA:true,FISH:true,SHARK:true,EEL:true});
  const piranhaBaitZones = [];
  const MOB_ATTACK_TELEGRAPH_MS = 420;
  const MOB_ATTACK_STRIKE_MS = 360;
  const MOB_ATTACK_RECOVER_MS = 620;
  const MOB_FACING_FLIP_MIN_MS = 150;
  const MOB_FACING_CONFIRM_MS = 90;
  const MOB_FACING_FAST_CONFIRM_MS = 45;
  const MOB_FACING_ATTACK_CONFIRM_MS = 30;
  const SAND_WORM_CALM_MS = 9000;
  const SAND_WORM_BAIT_SCAN_MS = 220;
  const SAND_WORM_BAIT_RADIUS = 11;
  const SAND_WORM_WAKE_MIN_RADIUS = 2.0;
  const SAND_WORM_WAKE_MAX_RADIUS = 4.0;
  const SAND_WORM_ALERT_RADIUS = 14;
  const SAND_WORM_CIRCLE_DIST = 13.5;
  const SAND_WORM_CIRCLE_DELAY_MS = 520;
  const SAND_WORM_CIRCLE_COOLDOWN_MS = 3600;
  const SAND_WORM_SPIT_RANGE = 17.5;
  const SAND_WORM_SPIT_MIN_RANGE = 4.2;
  const SAND_WORM_SPIT_COOLDOWN_MS = 1550;
  const SAND_WORM_SPIT_SPEED = 13.6;
  const JACKPOT_ALIEN_REVEAL_CHANCE = 0.10;
  const GIANT_SCORPION_COMMANDER_CHANCE = JACKPOT_ALIEN_REVEAL_CHANCE;
  const GIANT_SCORPION_STING_RANGE = 2.15;
  const GIANT_SCORPION_STING_COOLDOWN_MS = 2450;
  const GIANT_SCORPION_LUNGE_COOLDOWN_MS = 1650;
  const JACKPOT_YETI_SLAM_RANGE = 2.65;
  const JACKPOT_YETI_SLAM_COOLDOWN_MS = 2400;
  const JACKPOT_YETI_LEAP_COOLDOWN_MS = 1750;
  const JACKPOT_WHALE_RAM_RANGE = 3.65;
  const JACKPOT_WHALE_RAM_COOLDOWN_MS = 2600;
  const ATOMIC_BOMB_COCKROACH_INTERVAL_MS = 3800;
  const ATOMIC_BOMB_COCKROACH_LOCAL_CAP = 6;
  const ATOMIC_BOMB_CRATER_RX = 45;
  const ATOMIC_BOMB_CRATER_RY = 30;
  const ATOMIC_BOMB_BLAST_RADIUS = Math.round(ATOMIC_BOMB_CRATER_RX*0.93);
  const ATOMIC_BOMB_HERO_BLAST_RADIUS = ATOMIC_BOMB_CRATER_RX;
  const SAND_WORM_BAIT_PROFILES = Object.freeze({
    [T.MEAT]: Object.freeze({kind:'raw', duration:14, priority:3}),
    [T.BAKED_MEAT]: Object.freeze({kind:'baked', duration:10, priority:2}),
    [T.ROTTEN_MEAT]: Object.freeze({kind:'rotten', duration:5, priority:1})
  });
  const TEMPLE_GUARD_TILES = Object.freeze({
    [T.STONE]:true, [T.OBSIDIAN]:true, [T.TORCH]:true, [T.DIAMOND]:true,
    [T.CHEST_COMMON]:true, [T.CHEST_RARE]:true, [T.CHEST_EPIC]:true
  });
  const TEMPLE_GUARD_VIOLATION_AGGRO_MS = 90000;
  const TEMPLE_GUARD_ALARM_RADIUS = 46;
  const TEMPLE_GUARD_REINFORCE_RADIUS = 18;
  const BRAMBLE_STALKER_TORCH_RADIUS = 5;
  const BRAMBLE_STALKER_CALM_MS = 5200;
  const BRAMBLE_STALKER_WAKE_RADIUS = 5.7;
  const BRAMBLE_STALKER_LUNGE_COOLDOWN_MS = 1450;
  const THUNDER_BISON_WARN_RADIUS = 8.4;
  const THUNDER_BISON_CHARGE_RANGE = 11.5;
  const THUNDER_BISON_CHARGE_MS = 1050;
  const THUNDER_BISON_CHARGE_COOLDOWN_MS = 2600;
  const THUNDER_BISON_STUN_MS = 780;
  const BOG_LURKER_TORCH_RADIUS = 5;
  const BOG_LURKER_CALM_MS = 4200;
  const ICE_WRAITH_TORCH_RADIUS = 6;
  const ICE_WRAITH_CALM_MS = 5200;
  const ICE_WRAITH_WAKE_RADIUS = 8.5;
  const ICE_WRAITH_BLINK_DIST = 10.5;
  const ICE_WRAITH_BLINK_COOLDOWN_MS = 2600;
  const WEATHER_SHAMAN_MIN_ABS_X = 1200;
  const WEATHER_SHAMAN_RITUAL_MIN_MS = 5200;
  const WEATHER_SHAMAN_RITUAL_MAX_MS = 8200;
  const WEATHER_SHAMAN_EFFECT_MIN_SEC = 40;
  const WEATHER_SHAMAN_EFFECT_MAX_SEC = 60;
  const WEATHER_SHAMAN_FLEE_MIN_MS = 8500;
  const WEATHER_SHAMAN_FLEE_MAX_MS = 13000;
  const WEATHER_SHAMAN_RECOVERY_MIN_MS = 12000;
  const WEATHER_SHAMAN_RECOVERY_MAX_MS = 19000;
  const LAKE_SERPENT_SHOCK_RANGE = 3.35;
  const LAKE_SERPENT_SHOCK_COOLDOWN_MS = 1650;
  const LAKE_SERPENT_CHARGE_RATE = 1.75;
  const STONE_GOLEM_CALM_MS = 5200;
  const STONE_GOLEM_ROCK_RANGE = 18;
  const STONE_GOLEM_ROCK_MIN_RANGE = 4.2;
  const STONE_GOLEM_ROCK_COOLDOWN_MS = 1850;
  const STONE_GOLEM_ROCK_SPEED = 11.2;
  const GOLD_GUARD_SCAN_MS = 850;
  const GOLD_GUARD_SCAN_RX = 42;
  const GOLD_GUARD_SCAN_RY = 28;
  const GOLD_GUARD_CLUSTER_RX = 7;
  const GOLD_GUARD_CLUSTER_RY = 5;
  const GOLD_GUARD_KEY_W = 12;
  const GOLD_GUARD_KEY_H = 10;
  const GOLD_GUARD_LOCAL_CAP = 4;
  const GOLD_DRAGON_BREATH_RANGE = 15.5;
  const GOLD_DRAGON_BREATH_MIN_RANGE = 3.1;
  const GOLD_DRAGON_BREATH_COOLDOWN_MS = 1850;
  const GOLD_DRAGON_GAS_COOLDOWN_MS = 2600;
  const GOLD_DWARF_HAMMER_RANGE = 2.25;
  const GOLD_DWARF_HAMMER_COOLDOWN_MS = 1550;
  const GOLD_DWARF_PICK_RANGE = 9.5;
  const GOLD_DWARF_PICK_COOLDOWN_MS = 2300;
  const VULTURE_NEST_RADIUS = 26;
  const VULTURE_ATTACK_DECISION_MS = 3400;
  const VULTURE_CAPTURE_HATCHLINGS = 3;
  const VULTURE_CAPTURE_COOLDOWN_MS = 16000;
  const VULTURE_NEST_REPAIR_MS = 8500;
  const XP_FATIGUE_STEP = 0.01;
  const XP_FATIGUE_RESET_DAYS = 1;
  const XP_FATIGUE_MIN_MULT = 0.1;
  const ATOMIC_BOMB_XP_DECAY = 0.5;
  const XP_SPECIAL_BONUS_MULT = 1.2;
  const THERMAL_DAMAGE_BONUS_MULT = 1.2;
  const XP_FALLBACK_DAY_SECONDS = 600;
  const xpFatigue = {}; // speciesId -> {kills,lastDay}

  // Additional biome-aware species
  // Helper biome query (0,1,2) fallback to 1 if missing
  // biomeAt returns extended biome ids now: 0 forest,1 plains,2 snow,3 desert,4 swamp,5 sea,6 lake,7 mountain
  function biomeAt(x){ try{ return WORLDGEN && WORLDGEN.biomeType ? WORLDGEN.biomeType(x) : 1; }catch(e){ return 1; } }
  function currentSeasonId(){
    try{
      const seasons=MM.seasons;
      if(seasons && typeof seasons.metrics==='function'){
        const m=seasons.metrics();
        if(m && typeof m.season==='string') return m.season;
      }
      if(seasons && typeof seasons.profile==='function'){
        const p=seasons.profile();
        if(p && typeof p.id==='string') return p.id;
      }
    }catch(e){}
    return null;
  }
  function seasonActive(id){
    if(!id) return true;
    return currentSeasonId()===id;
  }
  function speciesSeasonActive(spec){
    return !spec || !spec.season || seasonActive(spec.season);
  }
  const SEASON_HALLMARK_SPECIES = {
    spring: 'WIOSENNY_JELEN',
    summer: 'LETNI_ZUBR',
    autumn: 'JESIENNY_LOS',
    winter: 'ZIMOWY_NIEDZWIEDZ'
  };
  const SEASON_ECOLOGY = {
    spring: {
      BIRD:1.28, SQUIRREL:1.35, DEER:1.45, RABBIT:1.55, ZABA:1.25, FISH:1.12,
      PIRANHA:1.05, BEAR:0.82, WOLF:0.72, GHOUL:0.82
    },
    summer: {
      FIREFLY:1.55, FISH:1.24, PIRANHA:1.45, CRAB:1.30, JASZCZUR:1.42, ZABA:1.18, BIRD:1.10,
      WOLF:0.70, OWL:0.82
    },
    autumn: {
      BEAR:1.25, WOLF:1.20, OWL:1.18, GOAT:1.10, DEER:0.78, RABBIT:0.62,
      SQUIRREL:0.72, FIREFLY:0.45
    },
    winter: {
      WOLF:1.65, GOAT:1.35, OWL:1.20, BEAR:0.72, FISH:0.58, CRAB:0.28,
      PIRANHA:0.62, RABBIT:0.34, DEER:0.24, BIRD:0.42, SQUIRREL:0.30, FIREFLY:0.06, ZABA:0.05, JASZCZUR:0.12
    }
  };
  function seasonHallmarkSpeciesId(id){
    const key = id || currentSeasonId() || 'spring';
    return SEASON_HALLMARK_SPECIES[key] || null;
  }
  function seasonalSpeciesFactor(spec){
    if(!spec || spec.organic===false || spec.id==='ZLOTY') return 1;
    const season = currentSeasonId();
    if(!season) return 1;
    if(spec.season) return spec.season===season ? 1.35 : 0;
    const table = SEASON_ECOLOGY[season];
    if(!table) return 1;
    const v = table[spec.id];
    return (typeof v==='number' && isFinite(v)) ? Math.max(0.02, Math.min(2.2, v)) : 1;
  }
  function bigAnimalSpawnCell(x,y,getTile,opts){
    opts=opts||{};
    const floor=opts.floor || function(t){ return t===T.GRASS || t===T.SNOW || t===T.MUD || t===T.SAND || isRockFloor(t); };
    const half=opts.halfWidth==null ? 1 : Math.max(0, opts.halfWidth|0);
    const height=opts.height==null ? 2 : Math.max(1, opts.height|0);
    for(let dx=-half; dx<=half; dx++){
      for(let dy=0; dy>-height; dy--){
        if(getTile(x+dx,y+dy)!==T.AIR) return false;
      }
    }
    let supports=0;
    for(let dx=-half; dx<=half; dx++){
      if(floor(getTile(x+dx,y+1))) supports++;
    }
    return supports>=Math.max(1, Math.min(2, half+1));
  }
  function safeSetMobTile(x,y,t,getTile){
    if(!WORLD || typeof WORLD.setTile!=='function' || typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    if(!inWorldY(y,1,1) || getTile(x,y)!==T.AIR) return false;
    WORLD.setTile(x,y,t);
    return getTile(x,y)===t;
  }
  function sparkleAtMob(m,tier){
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),m.y*(MM.TILE||20),tier||'common'); }catch(e){}
  }
  function springBlessNearbyGrowth(m,getTile){
    const now=performance.now();
    if(m._nextSeasonBless && now<m._nextSeasonBless) return false;
    m._nextSeasonBless=now+3600+Math.random()*2800;
    const bx=Math.floor(m.x), by=Math.floor(m.y);
    for(let r=1; r<=4; r++){
      for(let tries=0; tries<10; tries++){
        const x=bx+((Math.random()*r*2-r)|0);
        const y=by-1-((Math.random()*4)|0);
        const nearWood = getTile(x-1,y)===T.WOOD || getTile(x+1,y)===T.WOOD || getTile(x,y+1)===T.WOOD || isLeaf(getTile(x,y+1));
        if(nearWood && safeSetMobTile(x,y,T.LEAF,getTile)){ sparkleAtMob(m,'common'); return true; }
      }
    }
    return false;
  }
  function nearestSameSpecies(m,radius){
    const r2=radius*radius;
    let best=null, bestD=r2;
    for(const o of mobs){
      if(o===m || o.id!==m.id || !validMobState(o)) continue;
      const dx=o.x-m.x, dy=o.y-m.y, d2=dx*dx+dy*dy;
      if(d2<bestD){ best=o; bestD=d2; }
    }
    return best;
  }
  function nearCaveMouth(m,getTile){
    const x=Math.floor(m.x), y=Math.floor(m.y);
    let rock=0, air=0;
    for(let dx=-3; dx<=3; dx++){
      for(let dy=-1; dy<=3; dy++){
        const t=getTile(x+dx,y+dy);
        if(isRockFloor(t) || t===T.SNOW || t===T.ICE) rock++;
        else if(t===T.AIR || t===T.WATER) air++;
      }
    }
    return rock>=10 && air>=6;
  }
  function isMuckTile(t){ return t===T.MUD || t===T.WATER || t===T.WET_CLAY || t===T.CLAY; }
  function heroInMuck(player,getTile){
    if(!player || typeof getTile!=='function') return false;
    const x=Math.floor(player.x);
    const y=Math.floor(player.y+(player.h||0.95)*0.5+0.08);
    return isMuckTile(readMobTile(getTile,x,y)) || isMuckTile(readMobTile(getTile,x,y+1));
  }
  function nearTorch(x,y,getTile,radius){
    if(typeof getTile!=='function') return false;
    const r=Math.max(1,Math.min(12,radius||BOG_LURKER_TORCH_RADIUS));
    x=Math.floor(x); y=Math.floor(y);
    for(let dy=-r; dy<=r; dy++){
      for(let dx=-r; dx<=r; dx++){
        if(dx*dx+dy*dy>r*r) continue;
        if(readMobTile(getTile,x+dx,y+dy)===T.TORCH) return true;
      }
    }
    return false;
  }
  function nearForestTreeMass(x,y,getTile,radius){
    if(typeof getTile!=='function') return false;
    const r=Math.max(2,Math.min(12,radius||7));
    x=Math.floor(x); y=Math.floor(y);
    let wood=0, leaf=0;
    for(let dy=-r; dy<=r; dy++){
      for(let dx=-r; dx<=r; dx++){
        if(dx*dx+dy*dy>r*r) continue;
        const t=readMobTile(getTile,x+dx,y+dy);
        if(t===T.WOOD) wood++;
        else if(isLeaf(t)) leaf++;
      }
    }
    return wood>=2 || (wood>=1 && leaf>=4) || leaf>=9;
  }
  function brambleStalkerSpawnCell(x,y,getTile){
    if(biomeAt(x)!==0 || typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    if(readMobTile(getTile,x,y)!==T.AIR || readMobTile(getTile,x,y-1)!==T.AIR) return false;
    const below=readMobTile(getTile,x,y+1);
    if(!(below===T.GRASS || below===T.WOOD || isLeaf(below))) return false;
    return nearForestTreeMass(x,y,getTile,7);
  }
  function thunderBisonSpawnCell(x,y,getTile){
    if(biomeAt(x)!==1 || typeof getTile!=='function') return false;
    return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:3,floor:t=>t===T.GRASS});
  }
  function warnThunderBisonCharge(m,now){
    if(!m || now<(m._nextBisonWarnAt||0)) return;
    m._nextBisonWarnAt=now+360;
    m.shake=Math.max(m.shake||0,0.42);
    noteEntityNumber({kind:'danger', text:'!', x:m.x, y:m.y-1.35, target:'thunder_bison:'+Math.round(m.spawnT||0)});
  }
  function isSnowSurfaceTile(t){ return t===T.SNOW || t===T.ICE || t===T.GRASS || isRockFloor(t); }
  function iceWraithSpawnCell(x,y,getTile){
    if(biomeAt(x)!==2 || typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    return readMobTile(getTile,x,y)===T.AIR &&
      readMobTile(getTile,x,y-1)===T.AIR &&
      isSnowSurfaceTile(readMobTile(getTile,x,y+1));
  }
  function findIceWraithBlinkSpot(player,m,getTile){
    if(!player || typeof getTile!=='function') return null;
    const dir=(Math.abs(player.vx||0)>0.35 ? Math.sign(player.vx) : (player.facing>=0?1:-1)) || 1;
    const baseX=Math.floor(player.x);
    const baseY=Math.floor(player.y);
    const offsets=[];
    for(let d=3; d<=9; d++) offsets.push(dir*d);
    for(let d=2; d<=6; d++) offsets.push(-dir*d);
    for(const ox of offsets){
      const tx=baseX+ox;
      if(biomeAt(tx)!==2) continue;
      for(let dy=-4; dy<=5; dy++){
        const ty=baseY+dy;
        if(!iceWraithSpawnCell(tx,ty,getTile)) continue;
        if(m && Math.hypot((tx+0.5)-m.x,(ty+0.35)-m.y)<2.2) continue;
        return {x:tx+0.5,y:ty+0.35};
      }
    }
    return null;
  }
  function isWeatherShamanId(id){
    return id==='ICE_SHAMAN' || id==='FIRE_SHAMAN';
  }
  function weatherShamanSideFromId(id){
    return id==='FIRE_SHAMAN' ? 1 : -1;
  }
  function weatherShamanTowardCenterDir(m){
    if(m && finiteCoord(m.x) && Math.abs(m.x)>1) return m.x<0 ? 1 : -1;
    return weatherShamanSideFromId(m && m.id) < 0 ? 1 : -1;
  }
  function weatherShamanOwnerId(m){
    if(!m) return 'weather-shaman';
    if(typeof m._shamanWeatherOwner==='string' && m._shamanWeatherOwner) return m._shamanWeatherOwner;
    const base='shaman:'+String(m.id||'WEATHER')+':'+Math.round(finiteNum(m.spawnT)?m.spawnT:performance.now())+':'+Math.floor(finiteCoord(m.x)?m.x:0);
    m._shamanWeatherOwner=base.slice(0,64);
    return m._shamanWeatherOwner;
  }
  function weatherShamanSpawnCell(x,y,getTile,side){
    if(typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    if(side<0 && x>-WEATHER_SHAMAN_MIN_ABS_X) return false;
    if(side>0 && x<WEATHER_SHAMAN_MIN_ABS_X) return false;
    const biome=biomeAt(x);
    const floorOk = side<0
      ? (t)=> t===T.SNOW || t===T.ICE || t===T.GRASS || t===T.STONE || t===T.GRANITE
      : (t)=> t===T.SAND || t===T.BASALT || t===T.OBSIDIAN || t===T.STONE || t===T.GRANITE || t===T.DIRT || t===T.GRASS;
    if(!bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:3,floor:floorOk})) return false;
    const below=readMobTile(getTile,x,y+1);
    if(side<0) return biome===2 || below===T.SNOW || below===T.ICE;
    return biome===3 || isVolcanoColumn(x) || below===T.BASALT || below===T.OBSIDIAN || below===T.SAND;
  }
  function scheduleWeatherShamanRitual(m,now,extraMs){
    if(!m) return;
    const base=WEATHER_SHAMAN_RITUAL_MIN_MS + Math.random()*(WEATHER_SHAMAN_RITUAL_MAX_MS-WEATHER_SHAMAN_RITUAL_MIN_MS);
    m._shamanRitualEndAt=(now||performance.now()) + base + Math.max(0,Number(extraMs)||0);
  }
  function stopWeatherShamanEffect(m){
    if(!m) return false;
    const owner=weatherShamanOwnerId(m);
    let stopped=false;
    try{
      if(MM.wind && typeof MM.wind.stopRitualGale==='function') stopped=!!MM.wind.stopRitualGale(owner) || stopped;
    }catch(e){}
    try{
      if(MM.clouds && typeof MM.clouds.stopStorm==='function') stopped=!!MM.clouds.stopStorm({source:'weather_shaman', ownerId:owner}) || stopped;
    }catch(e){}
    m._shamanWeatherActive=false;
    m._shamanWeatherUntil=0;
    return stopped;
  }
  function beginWeatherShamanEffect(m,spec,now){
    if(!m || m._shamanWeatherActive) return false;
    const duration=WEATHER_SHAMAN_EFFECT_MIN_SEC + Math.random()*(WEATHER_SHAMAN_EFFECT_MAX_SEC-WEATHER_SHAMAN_EFFECT_MIN_SEC);
    const owner=weatherShamanOwnerId(m);
    const dir=weatherShamanTowardCenterDir(m);
    m._shamanWeatherActive=true;
    m._shamanWeatherUntil=now + duration*1000;
    m.state='channeling';
    m.facing=dir;
    m.shake=Math.max(m.shake||0,0.8);
    try{
      if(MM.wind && typeof MM.wind.forceRitualGale==='function') MM.wind.forceRitualGale(dir,duration,owner,3);
      else if(MM.wind && typeof MM.wind.forceSquall==='function') MM.wind.forceSquall(dir,7.2,duration);
    }catch(e){}
    try{
      if(MM.clouds && typeof MM.clouds.startStorm==='function') MM.clouds.startStorm(duration,1,{source:'weather_shaman', ownerId:owner});
      if(MM.clouds && typeof MM.clouds.addCloud==='function'){
        MM.clouds.addCloud(m.x,70,44);
        MM.clouds.addCloud(m.x+dir*48,68,32);
      }
    }catch(e){}
    try{
      if(window.msg && (!beginWeatherShamanEffect._lastMsg || now-beginWeatherShamanEffect._lastMsg>5000)){
        beginWeatherShamanEffect._lastMsg=now;
        window.msg((spec && spec.id==='FIRE_SHAMAN' ? 'Fire' : 'Ice')+' shaman calls a storm toward the center!');
      }
    }catch(e){}
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),(m.y-1.2)*(MM.TILE||20),spec && spec.id==='FIRE_SHAMAN'?'epic':'rare'); }catch(e){}
    return true;
  }
  function updateWeatherShaman(m,spec,{player,dt,now,speed}){
    if(!m || !player) return;
    if(!finiteNum(m._shamanRitualEndAt)) scheduleWeatherShamanRitual(m,now,300);
    const fleeing=finiteNum(m._shamanFleeUntil) && m._shamanFleeUntil>now;
    if(m._shamanWeatherActive && now>=m._shamanWeatherUntil){
      m._shamanWeatherActive=false;
      m._shamanWeatherUntil=0;
      m.state='spent';
      scheduleWeatherShamanRitual(m,now,WEATHER_SHAMAN_RECOVERY_MIN_MS+Math.random()*(WEATHER_SHAMAN_RECOVERY_MAX_MS-WEATHER_SHAMAN_RECOVERY_MIN_MS));
    }
    if(fleeing){
      const dx=player.x-m.x;
      const dir=dx>=0 ? -1 : 1;
      m.state='flee';
      m.facing=dir;
      m.vx += dir*(speed||spec.speed||2.4)*0.54*dt*30;
      if(m.onGround && now>(m._nextShamanHopAt||0) && Math.abs(dx)<9){
        m.vy=(spec.move && spec.move.jumpVel ? spec.move.jumpVel : -4.2)*(m.jumpMul||1)*0.72;
        m._nextShamanHopAt=now+720+Math.random()*520;
      }
      if(!m._shamanWeatherActive) m._shamanRitualEndAt=Math.max(m._shamanRitualEndAt||0,now+1800);
      return;
    }
    if(finiteNum(m._shamanFleeUntil) && m._shamanFleeUntil>0 && m._shamanFleeUntil<=now){
      m._shamanFleeUntil=0;
      if(!m._shamanWeatherActive) scheduleWeatherShamanRitual(m,now,1600);
    }
    if(!m._shamanWeatherActive && now>=m._shamanRitualEndAt) beginWeatherShamanEffect(m,spec,now);
    if(m._shamanWeatherActive){
      m.state='channeling';
      m.facing=weatherShamanTowardCenterDir(m);
      m.vx*=0.68;
      if(m.onGround) m.vy=0;
      return;
    }
    const waiting = (m._shamanRitualEndAt||0)-now;
    if(waiting>WEATHER_SHAMAN_RITUAL_MAX_MS+WEATHER_SHAMAN_RECOVERY_MIN_MS*0.5){
      m.state='spent';
      if(now>m.tNext){
        m.tNext=now+1200+Math.random()*2200;
        m.vx=(Math.random()<0.5?-1:1)*(speed||spec.speed||2.4)*0.16;
      }
    } else {
      m.state='praying';
      m.facing=weatherShamanTowardCenterDir(m);
      m.vx*=0.52;
      if(m.onGround) m.vy=0;
    }
  }
  function damageWeatherShaman(m,spec,{now,opts}){
    if(!m) return;
    if(opts && !sourceIsHero(opts)) return;
    m._shamanFleeUntil=now + WEATHER_SHAMAN_FLEE_MIN_MS + Math.random()*(WEATHER_SHAMAN_FLEE_MAX_MS-WEATHER_SHAMAN_FLEE_MIN_MS);
    m.state='flee';
    m.shake=Math.max(m.shake||0,0.7);
    if(!m._shamanWeatherActive) scheduleWeatherShamanRitual(m,now,WEATHER_SHAMAN_FLEE_MIN_MS);
    try{ noteEntityNumber({kind:'danger', text:'!', x:m.x, y:m.y-1.35, target:'weather_shaman:'+Math.round(m.spawnT||0)}); }catch(e){}
  }
  function isVolcanoColumn(x){
    try{ return !!(WORLDGEN && typeof WORLDGEN.volcanoAt==='function' && WORLDGEN.volcanoAt(Math.round(x))); }catch(e){ return false; }
  }
  function isVultureColumn(x){
    return biomeAt(x)===7 || isVolcanoColumn(x);
  }
  function isVultureFloorTile(t){
    return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.OBSIDIAN ||
      t===T.SNOW || t===T.GRASS || t===T.DIRT;
  }
  function isVultureNestOpenTile(t){
    return t===T.AIR || t===T.TORCH || t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED;
  }
  function isVultureTreeTile(t){ return t===T.WOOD || isLeaf(t); }
  function vultureNestHasSupport(x,y,getTile,allowTreeSupport=true){
    if(typeof getTile!=='function') return false;
    const below=readMobTile(getTile,x,y+1);
    if(isVultureFloorTile(below)) return true;
    if(!allowTreeSupport) return false;
    if(isVultureTreeTile(below)) return true;
    for(let dx=-1; dx<=1; dx++){
      if(isVultureTreeTile(readMobTile(getTile,x+dx,y+1))) return true;
    }
    return false;
  }
  function vultureNestOpenAbove(x,y,getTile){
    return isVultureNestOpenTile(readMobTile(getTile,x,y-1)) &&
      isVultureNestOpenTile(readMobTile(getTile,x,y-2));
  }
  function vultureNestOpenAboveAfterCleanup(x,y,oldY,getTile){
    for(let yy=y-1; yy>=y-2; yy--){
      const t=readMobTile(getTile,x,yy);
      if(isVultureNestOpenTile(t)) continue;
      if(Number.isFinite(oldY) && yy===oldY && t===T.WOOD && !vultureNestHasSupport(x,oldY,getTile,false)) continue;
      return false;
    }
    return true;
  }
  function vultureNestFootprintReady(x,y,getTile,allowTreeSupport=true){
    if(typeof getTile!=='function') return false;
    return readMobTile(getTile,x,y)===T.WOOD && vultureNestHasSupport(x,y,getTile,allowTreeSupport) && vultureNestOpenAbove(x,y,getTile);
  }
  function findVultureFloorBelow(x,y,getTile,maxDrop){
    if(typeof getTile!=='function') return null;
    x=Math.floor(x); y=Math.floor(y);
    const drop=Math.max(4,Math.min(28,maxDrop||18));
    for(let yy=y; yy<=y+drop; yy++){
      const here=readMobTile(getTile,x,yy);
      const below=readMobTile(getTile,x,yy+1);
      if(isVultureNestOpenTile(here) && isVultureFloorTile(below)) return {x,y:yy+1};
    }
    return null;
  }
  function findExistingVultureTree(x,y,getTile){
    if(typeof getTile!=='function') return null;
    x=Math.floor(x); y=Math.floor(y);
    for(let r=0; r<=12; r++){
      for(let dx=-r; dx<=r; dx++){
        if(Math.abs(dx)!==r && r!==0) continue;
        const tx=x+dx;
        if(!isVultureColumn(tx)) continue;
        for(let yy=y-12; yy<=y+10; yy++){
          const t=readMobTile(getTile,tx,yy);
          if(t!==T.WOOD && !isLeaf(t)) continue;
          if(!isVultureNestOpenTile(readMobTile(getTile,tx,yy-1))) continue;
          if(!isVultureNestOpenTile(readMobTile(getTile,tx,yy-2))) continue;
          return {x:tx+0.5,y:yy-1.2,nestX:tx,nestY:yy,tree:true};
        }
      }
    }
    return null;
  }
  function findVultureNestSpot(x,y,getTile){
    const tree=findExistingVultureTree(x,y,getTile);
    if(tree) return tree;
    x=Math.floor(x); y=Math.floor(y);
    for(let r=0; r<=14; r++){
      for(let dx=-r; dx<=r; dx++){
        if(Math.abs(dx)!==r && r!==0) continue;
        const tx=x+dx;
        if(!isVultureColumn(tx)) continue;
        const floor=findVultureFloorBelow(tx,y,getTile,24);
        if(!floor) continue;
        const nestY=floor.y-1;
        if(nestY<3) continue;
        if(!isVultureNestOpenTile(readMobTile(getTile,tx,nestY-1))) continue;
        if(!isVultureNestOpenTile(readMobTile(getTile,tx,nestY-2))) continue;
        return {x:tx+0.5,y:nestY-1.2,nestX:tx,nestY,tree:false,groundY:floor.y};
      }
    }
    return null;
  }
  function placeVultureNestTile(x,y,t,getTile,setTile,forceWood){
    if(typeof setTile!=='function' || typeof getTile!=='function') return false;
    const cur=readMobTile(getTile,x,y);
    if(forceWood){
      if(cur===T.AIR || isLeaf(cur)) { setTile(x,y,t); return true; }
      return cur===t;
    }
    if(cur===T.AIR || cur===T.TORCH || isLeaf(cur)){ setTile(x,y,t); return true; }
    return cur===t;
  }
  function assignVultureNestSpot(m,spot){
    if(!m || !spot) return null;
    m.nestX=spot.nestX;
    m.nestY=spot.nestY;
    m.homeX=spot.x;
    m.homeY=spot.y;
    m.nestTree=!!spot.tree;
    if(finiteCoord(spot.groundY)) m.nestGroundY=spot.groundY;
    else if(!spot.tree) m.nestGroundY=spot.nestY+1;
    m._nestReady=false;
    return spot;
  }
  function clearUnsupportedVultureNestFootprint(x,y,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function' || !Number.isFinite(y)) return 0;
    x=Math.round(x); y=Math.round(y);
    if(vultureNestHasSupport(x,y,getTile,false)) return 0;
    let cleared=0;
    for(let dx=-1; dx<=1; dx++){
      if(readMobTile(getTile,x+dx,y)===T.WOOD){ setTile(x+dx,y,T.AIR); cleared++; }
    }
    for(let dx=-2; dx<=2; dx++){
      if(dx!==0 && isLeaf(readMobTile(getTile,x+dx,y-1))){ setTile(x+dx,y-1,T.AIR); cleared++; }
    }
    for(const dx of [-1,1]){
      if(isLeaf(readMobTile(getTile,x+dx,y-2))){ setTile(x+dx,y-2,T.AIR); cleared++; }
    }
    return cleared;
  }
  function normalizeVultureNestSpot(m,getTile){
    if(!m || typeof getTile!=='function') return null;
    if(!finiteCoord(m.nestX) || !finiteCoord(m.nestY)){
      return assignVultureNestSpot(m,findVultureNestSpot(m.x,m.y,getTile));
    }
    let nx=Math.round(m.nestX), ny=Math.round(m.nestY);
    if(!isVultureColumn(nx)){
      return assignVultureNestSpot(m,findVultureNestSpot(m.x,m.y,getTile));
    }
    const allowTreeSupport=!!m.nestTree;
    if(vultureNestHasSupport(nx,ny,getTile,allowTreeSupport) && vultureNestOpenAbove(nx,ny,getTile)){
      return {x:nx+0.5,y:ny-1.05,nestX:nx,nestY:ny,groundY:finiteCoord(m.nestGroundY)?m.nestGroundY:ny+1,tree:!!m.nestTree};
    }
    if(!allowTreeSupport && readMobTile(getTile,nx,ny+1)===T.WOOD && isVultureFloorTile(readMobTile(getTile,nx,ny+2)) && vultureNestOpenAboveAfterCleanup(nx,ny+1,ny,getTile)){
      const oldY=ny;
      ny=ny+1;
      m.nestX=nx;
      m.nestY=ny;
      m.nestTree=false;
      m.nestGroundY=ny+1;
      m.homeX=nx+0.5;
      m.homeY=ny-1.2;
      m._nestReady=false;
      m._vultureCleanupY=oldY;
      return {x:nx+0.5,y:ny-1.05,nestX:nx,nestY:ny,groundY:ny+1,tree:false};
    }
    // Legacy saves could carry a platform one or more cells above the ledge. That
    // made the tree-fall audit drop the wood, then the vulture rebuilt it again,
    // eventually producing a tall wooden artifact. Snap ground nests onto support.
    let floor=findVultureFloorBelow(nx,Math.max(WORLD_TOP,ny),getTile,24);
    if(!floor) floor=findVultureFloorBelow(nx,Math.max(WORLD_TOP,ny-8),getTile,32);
    if(floor && vultureNestOpenAboveAfterCleanup(nx,floor.y-1,ny,getTile)){
      const oldY=ny;
      ny=floor.y-1;
      m.nestX=nx;
      m.nestY=ny;
      m.nestTree=false;
      m.nestGroundY=floor.y;
      m.homeX=nx+0.5;
      m.homeY=ny-1.2;
      m._nestReady=false;
      if(oldY<ny) m._vultureCleanupY=oldY;
      return {x:nx+0.5,y:ny-1.05,nestX:nx,nestY:ny,groundY:floor.y,tree:false};
    }
    return assignVultureNestSpot(m,findVultureNestSpot(m.x,m.y,getTile));
  }
  function materializeVultureNest(m,getTile,setTile){
    if(!m) return null;
    const normalized=normalizeVultureNestSpot(m,getTile);
    if(!normalized) return null;
    const nx=Math.round(m.nestX), ny=Math.round(m.nestY);
    const groundY=finiteCoord(m.nestGroundY) ? m.nestGroundY : (normalized.groundY||ny+1);
    const ready=vultureNestFootprintReady(nx,ny,getTile,!!m.nestTree);
    const now=performance.now();
    if(ready){ m._nestReady=true; return {x:nx+0.5,y:ny-1.05,nestX:nx,nestY:ny,groundY}; }
    if(m._nestReady && m._nextNestRepairAt && now<m._nextNestRepairAt) return {x:nx+0.5,y:ny-1.05,nestX:nx,nestY:ny,groundY};
    if(typeof setTile==='function' && typeof getTile==='function'){
      if(Number.isFinite(m._vultureCleanupY)){
        clearUnsupportedVultureNestFootprint(nx,m._vultureCleanupY,getTile,setTile);
        m._vultureCleanupY=null;
      }
      if(!vultureNestHasSupport(nx,ny,getTile,!!m.nestTree)) return {x:nx+0.5,y:ny-1.05,nestX:nx,nestY:ny,groundY};
      for(let dx=-1; dx<=1; dx++) placeVultureNestTile(nx+dx,ny,T.WOOD,getTile,setTile,true);
      for(let dx=-2; dx<=2; dx++) if(dx!==0) placeVultureNestTile(nx+dx,ny-1,T.LEAF,getTile,setTile,false);
      placeVultureNestTile(nx-1,ny-2,T.LEAF,getTile,setTile,false);
      placeVultureNestTile(nx+1,ny-2,T.LEAF,getTile,setTile,false);
    }
    m._nestReady=true;
    m._nextNestRepairAt=now+VULTURE_NEST_REPAIR_MS;
    return {x:nx+0.5,y:ny-1.05,nestX:nx,nestY:ny,groundY};
  }
  function spawnVultureHatchlings(m,getTile){
    const spec=SPECIES.VULTURE_HATCHLING;
    if(!m || !spec || !finiteCoord(m.nestX) || !finiteCoord(m.nestY)) return 0;
    let born=0;
    for(let i=0; i<VULTURE_CAPTURE_HATCHLINGS && countSpecies('VULTURE_HATCHLING')<spec.max; i++){
      const ox=(i-1)*0.72;
      const baby=create(spec, m.nestX+0.5+ox, m.nestY-1.55-(i%2)*0.15, getTile);
      baby.homeX=m.nestX+0.5;
      baby.homeY=m.nestY-1.3;
      baby.nestX=m.nestX;
      baby.nestY=m.nestY;
      baby.state='defend';
      baby.lifeEndAt=Math.max(baby.lifeEndAt||0, performance.now()+90000);
      mobs.push(baby);
      born++;
    }
    if(born>0) setAggro('VULTURE_HATCHLING');
    return born;
  }
  function vultureCaptureHero(m,spec,player,getTile,setTile,now){
    const spot=materializeVultureNest(m,getTile,setTile);
    if(!spot || !player) return false;
    damagePlayer(Math.max(3,(spec.dmg||8)*0.45*(m.dmgMult||1)), m.x, m.y, 'vulture_capture', spec);
    m.state='carry';
    m._carryTargetX=spot.x;
    m._carryTargetY=spot.y-1.35;
    m._carryReleaseAt=now+4200;
    m._vultureCapture=null;
    m.vx*=0.55; m.vy=-Math.abs(m.vy||0)-1.2;
    markMobAttack(m,'vulture_capture',{target:player,power:1.35,strikeMs:460});
    setAggro(m.id);
    return true;
  }
  function finishVultureCarry(m,spec,player,getTile,setTile,now){
    const spot=materializeVultureNest(m,getTile,setTile);
    if(spot && player){
      player.x=spot.x;
      player.y=spot.y;
      player.vx=0;
      player.vy=0;
    }
    spawnVultureHatchlings(m,getTile);
    m.state='return';
    m._nextVultureDecisionAt=now+VULTURE_CAPTURE_COOLDOWN_MS;
    m._carryTargetX=null;
    m._carryTargetY=null;
    m._carryReleaseAt=0;
    m.vx*=0.35;
    m.vy=-Math.abs(m.vy||0)-1.8;
    try{ if(window.msg) window.msg('Vulture nest! Hatchlings swarm the ledge.'); }catch(e){}
    return true;
  }
  function updateVultureCarry(m,spec,player,getTile,setTile,now,dt,speed){
    const spot=materializeVultureNest(m,getTile,setTile);
    if(!spot || !player){ m.state='return'; return false; }
    const tx=finiteCoord(m._carryTargetX) ? m._carryTargetX : spot.x;
    const ty=finiteCoord(m._carryTargetY) ? m._carryTargetY : spot.y-1.35;
    const dx=tx-m.x, dy=ty-m.y;
    const dist=Math.hypot(dx,dy)||1;
    const sp=(speed||spec.speed||5)*1.18;
    m.vx += (dx/dist)*sp*dt*8.4;
    m.vy += (dy/dist)*sp*dt*8.0;
    m.facing=dx>=0?1:-1;
    player.x=m.x;
    player.y=m.y+0.95;
    player.vx=m.vx;
    player.vy=m.vy;
    player.onGround=false;
    if(dist<0.9 || now>(m._carryReleaseAt||0)) finishVultureCarry(m,spec,player,getTile,setTile,now);
    return true;
  }
  function vultureStrikeHero(m,spec,player,now){
    damagePlayer((spec.dmg||8)*(m.dmgMult||1), m.x, m.y, 'vulture_talon', spec);
    m.state='return';
    m._nextVultureDecisionAt=now+3500+Math.random()*4200;
    m._vultureCapture=null;
    m.vx*=0.35; m.vy=-Math.abs(m.vy||0)-2.4;
    markMobAttack(m,'vulture_talon',{target:player,power:1.25,strikeMs:360});
    setAggro(m.id);
    return true;
  }
  function vultureStartDive(m,aggressive,now,player){
    m.state='dive';
    m._vultureCapture = Math.random() < (aggressive ? 0.42 : 0.22);
    m._nextVultureDecisionAt=now+2500;
    if(player){
      const side=Math.random()<0.5?-1:1;
      m.x=player.x+side*(5.5+Math.random()*4.5);
      m.y=player.y-(8.5+Math.random()*4.5);
      const dx=player.x-m.x, dy=(player.y-0.35)-m.y;
      const d=Math.hypot(dx,dy)||1;
      m.vx=(dx/d)*(aggressive?8.6:7.2);
      m.vy=(dy/d)*(aggressive?9.2:7.8)+1.4;
      m.facing=dx>=0?1:-1;
      markMobTelegraph(m,'talon',{target:player,power:1.15,ms:900});
    }
    markHeroAttack(m);
  }
  function nearSwampWater(x,y,getTile){
    if(typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    for(let dy=-2; dy<=2; dy++){
      for(let dx=-4; dx<=4; dx++){
        const t=readMobTile(getTile,x+dx,y+dy);
        if(t===T.WATER || t===T.MUD || t===T.WET_CLAY) return true;
      }
    }
    return false;
  }
  function mountainSignalScore(x,y,getTile){
    if(typeof getTile!=='function') return 0;
    let score=0;
    x=Math.floor(x); y=Math.floor(y);
    for(let dy=-4; dy<=4; dy++){
      for(let dx=-6; dx<=6; dx++){
        const t=readMobTile(getTile,x+dx,y+dy);
        if(t===T.DIAMOND) score+=5;
        else if(t===T.OBSIDIAN) score+=3;
        else if(t===T.BASALT || t===T.GRANITE) score+=2;
        else if(t===T.SNOW || t===T.ICE) score+=0.35;
      }
    }
    return score;
  }
  function nearMountainMineral(x,y,getTile){
    return mountainSignalScore(x,y,getTile)>=3;
  }
  function isGoldOreTile(t){ return t===T.GOLD_ORE; }
  function isGoldGuardianId(id){ return id==='GOLD_DRAGON' || id==='GOLD_DWARF_GUARD'; }
  function isGoldGuardianFloor(t){
    return t===T.GOLD_ORE || t===T.COAL || t===T.OBSIDIAN || t===T.GRANITE || t===T.BASALT || isRockFloor(t);
  }
  function isGoldGuardianAir(t){
    return t===T.AIR || t===T.HOT_AIR || t===T.STEAM || t===T.POISON_GAS || t===T.FUEL_GAS;
  }
  function goldGuardKeyFor(x,y){
    return Math.floor(Math.floor(x)/GOLD_GUARD_KEY_W)+','+Math.floor(Math.floor(y)/GOLD_GUARD_KEY_H);
  }
  function goldOreTouchesOpenCave(x,y,getTile){
    if(typeof getTile!=='function') return false;
    return isGoldGuardianAir(readMobTile(getTile,x+1,y)) ||
      isGoldGuardianAir(readMobTile(getTile,x-1,y)) ||
      isGoldGuardianAir(readMobTile(getTile,x,y+1)) ||
      isGoldGuardianAir(readMobTile(getTile,x,y-1));
  }
  function goldClusterSignal(x,y,getTile){
    if(typeof getTile!=='function') return {gold:0,exposed:0,open:0,floor:0,score:0,qualifies:false};
    x=Math.floor(x); y=Math.floor(y);
    let gold=0, exposed=0, open=0, floor=0;
    for(let dy=-GOLD_GUARD_CLUSTER_RY; dy<=GOLD_GUARD_CLUSTER_RY; dy++){
      if(!inWorldY(y+dy,1,1)) continue;
      for(let dx=-GOLD_GUARD_CLUSTER_RX; dx<=GOLD_GUARD_CLUSTER_RX; dx++){
        const t=readMobTile(getTile,x+dx,y+dy);
        if(isGoldOreTile(t)){
          gold++;
          if(goldOreTouchesOpenCave(x+dx,y+dy,getTile)) exposed++;
        } else if(isGoldGuardianAir(t)){
          open++;
        } else if(isGoldGuardianFloor(t)){
          floor++;
        }
      }
    }
    const score=gold*2 + exposed*5 + Math.min(open,18)*0.4 + Math.min(floor,20)*0.12;
    return {gold,exposed,open,floor,score,qualifies:gold>=2 && exposed>=1 && open>=5};
  }
  function nearGoldVein(x,y,getTile){
    return goldClusterSignal(x,y,getTile).qualifies;
  }
  function goldDwarfSpawnCell(x,y,getTile){
    if(typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    if(!nearGoldVein(x,y,getTile)) return false;
    return readMobTile(getTile,x,y)===T.AIR &&
      readMobTile(getTile,x,y-1)===T.AIR &&
      isGoldGuardianFloor(readMobTile(getTile,x,y+1));
  }
  function goldDragonSpawnCell(x,y,getTile){
    if(typeof getTile!=='function') return false;
    return nearGoldVein(x,y,getTile) &&
      bigAnimalSpawnCell(x,y,getTile,{halfWidth:2,height:3,floor:isGoldGuardianFloor});
  }
  function goldGuardianAlreadyForKey(key){
    if(!key) return false;
    for(const m of mobs){
      if(!validMobState(m) || m.hp<=0 || !isGoldGuardianId(m.id)) continue;
      if(m.goldGuardKey===key) return true;
    }
    return false;
  }
  function countGoldGuardiansNear(x,y,radius){
    const r2=radius*radius;
    let n=0;
    for(const m of mobs){
      if(!validMobState(m) || m.hp<=0 || !isGoldGuardianId(m.id)) continue;
      const dx=m.x-x, dy=m.y-y;
      if(dx*dx+dy*dy<=r2) n++;
    }
    return n;
  }
  function findGoldGuardianSpawnNear(gx,gy,getTile,kind){
    const dragon=kind==='dragon';
    const maxR=dragon ? 10 : 7;
    const ok=dragon ? goldDragonSpawnCell : goldDwarfSpawnCell;
    for(let r=1; r<=maxR; r++){
      for(let dy=-r; dy<=r; dy++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const tx=Math.floor(gx+dx), ty=Math.floor(gy+dy);
          if(ok(tx,ty,getTile)) return {x:tx+0.5,y:ty+0.5,tileX:tx,tileY:ty};
        }
      }
    }
    return null;
  }
  function scanGoldVeinNearPlayer(player,getTile){
    if(!player || typeof getTile!=='function') return null;
    const px=Math.floor(player.x), py=Math.floor(player.y);
    let best=null;
    for(let y=py-GOLD_GUARD_SCAN_RY; y<=py+GOLD_GUARD_SCAN_RY; y++){
      if(!inWorldY(y,1,1)) continue;
      for(let x=px-GOLD_GUARD_SCAN_RX; x<=px+GOLD_GUARD_SCAN_RX; x++){
        if(!isGoldOreTile(readMobTile(getTile,x,y))) continue;
        if(!goldOreTouchesOpenCave(x,y,getTile)) continue;
        const signal=goldClusterSignal(x,y,getTile);
        if(!signal.qualifies) continue;
        const key=goldGuardKeyFor(x,y);
        if(goldGuardianAlreadyForKey(key)) continue;
        const dx=x+0.5-player.x, dy=y+0.5-player.y;
        const d2=dx*dx+dy*dy;
        const rank=signal.score - Math.sqrt(d2)*0.18;
        if(!best || rank>best.rank) best={x,y,key,signal,rank,d2};
      }
    }
    return best;
  }
  function goldGuardianKindForVein(vein){
    if(!vein || !vein.signal) return 'dwarf';
    const deep=vein.y>WORLD_H+20 || vein.y>WORLD_H*0.72;
    if(vein.signal.gold>=7 && vein.signal.open>=12) return Math.random()<0.70 ? 'dragon' : 'dwarf';
    if(deep && vein.signal.gold>=4) return Math.random()<0.48 ? 'dragon' : 'dwarf';
    return Math.random()<0.18 ? 'dragon' : 'dwarf';
  }
  function attachGoldGuardState(m,vein,spot){
    if(!m || !vein) return m;
    m.goldGuardKey=vein.key || goldGuardKeyFor(vein.x,vein.y);
    m.guardGoldX=vein.x+0.5;
    m.guardGoldY=vein.y+0.5;
    if(spot){
      m.homeX=spot.x;
      m.homeY=spot.y;
    }
    return m;
  }
  function sandWormBaitProfile(t){ return SAND_WORM_BAIT_PROFILES[t] || null; }
  function nearestSandWormBait(m,getTile,now){
    if(!m || typeof getTile!=='function') return null;
    const t=(typeof now==='number' && isFinite(now)) ? now : performance.now();
    if(m._nextSandWormBaitScanAt && t<m._nextSandWormBaitScanAt) return m._sandWormBait || null;
    m._nextSandWormBaitScanAt=t+SAND_WORM_BAIT_SCAN_MS+Math.random()*SAND_WORM_BAIT_SCAN_MS;
    const r=SAND_WORM_BAIT_RADIUS;
    const r2=r*r;
    const cx=Math.floor(m.x), cy=Math.floor(m.y);
    let best=null;
    for(let y=cy-r; y<=cy+r; y++){
      if(!inWorldY(y)) continue;
      for(let x=cx-r; x<=cx+r; x++){
        const profile=sandWormBaitProfile(readMobTile(getTile,x,y));
        if(!profile) continue;
        const wx=x+0.5, wy=y+0.5;
        const dx=wx-m.x, dy=wy-m.y;
        const d2=dx*dx+dy*dy;
        if(d2>r2) continue;
        if(!best || d2<best.d2-0.001 || (Math.abs(d2-best.d2)<=0.001 && profile.priority>best.priority)){
          best={x:wx,y:wy,tx:x,ty:y,d2,kind:profile.kind,duration:profile.duration,priority:profile.priority};
        }
      }
    }
    m._sandWormBait=best;
    return best;
  }
  function consumeSandWormBait(bait,getTile,setTile){
    if(!bait || typeof getTile!=='function' || typeof setTile!=='function') return false;
    if(!sandWormBaitProfile(readMobTile(getTile,bait.tx,bait.ty))) return false;
    try{
      const meatApi=MM && MM.meat;
      if(meatApi && typeof meatApi.consumeBaitAt==='function') return !!meatApi.consumeBaitAt(bait.tx,bait.ty,getTile,setTile);
    }catch(e){}
    setTile(bait.tx,bait.ty,T.AIR);
    try{ if(MM.meat && MM.meat.removeMeat) MM.meat.removeMeat(bait.tx,bait.ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(bait.tx,bait.ty,getTile); }catch(e){}
    return true;
  }
  function pacifyMob(m,ms,reason,now){
    if(!m) return false;
    const t=(typeof now==='number' && isFinite(now)) ? now : performance.now();
    m._pacifiedUntil=Math.max(m._pacifiedUntil||0,t+Math.max(1000,ms||SAND_WORM_CALM_MS));
    m._pacifiedReason=reason||'calmed';
    m.attackCd=Math.max(m.attackCd||0,0.55);
    m.vx*=0.35;
    m.vy=Math.min(m.vy||0,0);
    return true;
  }
  function isMobPacified(m,now){
    const t=(typeof now==='number' && isFinite(now) && now<1000000000) ? now : performance.now();
    return !!(m && finiteNum(m._pacifiedUntil) && m._pacifiedUntil>t);
  }
  function pacifySandWorm(m,reason,now,source){
    if(!m || m.id!=='SAND_WORM') return false;
    m.state=reason==='water' ? 'doused' : 'fed';
    if(reason==='water' && source){
      if(finiteCoord(source.x)) m._pacifySourceX=source.x;
      if(finiteCoord(source.y)) m._pacifySourceY=source.y;
      m._waterDousedUntil=(typeof now==='number' && isFinite(now) ? now : performance.now())+SAND_WORM_CALM_MS;
    }
    m._sandWormBait=null;
    return pacifyMob(m,SAND_WORM_CALM_MS,reason,now);
  }
  function sandWormDeepSandAt(x,y,getTile){
    if(typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    return readMobTile(getTile,x,y)===T.AIR &&
      readMobTile(getTile,x,y-1)===T.AIR &&
      readMobTile(getTile,x,y+1)===T.SAND &&
      readMobTile(getTile,x,y+2)===T.SAND;
  }
  function sandWormCanBurrowAt(m,getTile){
    if(!m || typeof getTile!=='function') return false;
    const x=Math.floor(m.x), y=Math.floor(m.y);
    return readMobTile(getTile,x,y)===T.AIR &&
      (readMobTile(getTile,x,y+1)===T.SAND || readMobTile(getTile,x,y)===T.SAND || readMobTile(getTile,x,y+2)===T.SAND);
  }
  function sandWormWakeRadius(m){
    if(!m) return 3;
    if(!finiteNum(m._sandWormWakeRadius)){
      m._sandWormWakeRadius=SAND_WORM_WAKE_MIN_RADIUS + Math.random()*(SAND_WORM_WAKE_MAX_RADIUS-SAND_WORM_WAKE_MIN_RADIUS);
    }
    return clampFinite(m._sandWormWakeRadius,3,SAND_WORM_WAKE_MIN_RADIUS,SAND_WORM_WAKE_MAX_RADIUS);
  }
  function sandWormWakeClose(m,player){
    if(!m || !player) return false;
    const dx=player.x-m.x, dy=player.y-m.y;
    const radius=sandWormWakeRadius(m);
    return Math.hypot(dx,dy)<=radius;
  }
  function giantScorpionSpawnCell(x,y,getTile){
    if(biomeAt(x)!==3 || typeof getTile!=='function') return false;
    return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:2,floor:t=>t===T.SAND || isRockFloor(t)});
  }
  function jackpotYetiSpawnCell(x,y,getTile){
    if(biomeAt(x)!==2 || typeof getTile!=='function') return false;
    return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:3,floor:t=>t===T.SNOW || t===T.ICE || isRockFloor(t)});
  }
  function cityThreatFloor(t){
    return t===T.STEEL || t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.OBSIDIAN || t===T.BRICK || t===T.UFO_CONCRETE || isRockFloor(t);
  }
  function atomicBombSpawnCell(x,y,getTile){
    if(biomeAt(x)!==8 || typeof getTile!=='function') return false;
    return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:2,floor:cityThreatFloor});
  }
  function radiationCockroachSpawnCell(x,y,getTile){
    if(biomeAt(x)!==8 || typeof getTile!=='function') return false;
    return readMobTile(getTile,x,y)===T.AIR && cityThreatFloor(readMobTile(getTile,x,y+1));
  }
  function releaseJackpotCommander(m,kind,threatBonus,chance){
    const revealChance=Number.isFinite(Number(chance)) ? Math.max(0,Math.min(1,Number(chance))) : JACKPOT_ALIEN_REVEAL_CHANCE;
    if(!m || Math.random()>=revealChance) return false;
    try{
      const inv=MM && MM.invasions;
      if(!inv || typeof inv.spawnRuinCommander!=='function') return false;
      const gt=typeof lastDeathFxGetTile==='function' ? lastDeathFxGetTile : (WORLD && WORLD.getTile);
      const st=WORLD && WORLD.setTile;
      const prefix=String(kind||m.id||'jackpot').toLowerCase();
      const key=prefix+':'+Math.round(Number(m.spawnT)||0)+':'+Math.floor(m.x)+','+Math.floor(m.y);
      const team=inv.spawnRuinCommander(m.x,m.y-0.15,{
        key,
        forceAfterWestGuardian:true,
        player:(typeof window!=='undefined' && window.player) ? window.player : null,
        threatBonus:Math.max(0,Math.floor(Number(threatBonus)||10)),
        getTile:gt,
        setTile:st,
        ctx:{}
      });
      if(!team) return false;
      const tile=MM.TILE||20;
      try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*tile,(m.y-0.35)*tile,'epic'); }catch(e){}
      try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(m.x*tile,(m.y-0.35)*tile,'epic',14); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('warning'); }catch(e){}
      return true;
    }catch(e){ return false; }
  }
  function releaseGiantScorpionCommander(m){
    return releaseJackpotCommander(m,'scorpion',10,GIANT_SCORPION_COMMANDER_CHANCE);
  }
  function releaseJackpotYetiCommander(m){ return releaseJackpotCommander(m,'yeti',12); }
  function releaseJackpotWhaleCommander(m){ return releaseJackpotCommander(m,'whale',14); }
  function spawnRadiationCockroachAt(x,y,getTile){
    const spec=SPECIES.RADIATION_COCKROACH;
    if(!spec) return false;
    const gt=typeof getTile==='function' ? getTile : (WORLD && WORLD.getTile ? ((tx,ty)=>WORLD.getTile(tx,ty)) : null);
    if(!gt) return false;
    const bx=Math.floor(x), by=Math.floor(y);
    for(let r=0; r<=7; r++){
      for(let tries=0; tries<16; tries++){
        const tx=bx+Math.floor((Math.random()*2-1)*r);
        const ty=by+Math.floor((Math.random()*2-1)*Math.max(1,Math.min(3,r)));
        if(!radiationCockroachSpawnCell(tx,ty,gt)) continue;
        if((speciesCounts.RADIATION_COCKROACH||0)>=spec.max) return false;
        mobs.push(create(spec,tx+0.5,ty+0.5,gt));
        return true;
      }
    }
    return false;
  }
  function spawnRadiationCockroachNearBomb(m,getTile){
    if(!m) return false;
    const near=countSpeciesNear('RADIATION_COCKROACH',m.x,m.y,14);
    if(near>=ATOMIC_BOMB_COCKROACH_LOCAL_CAP) return false;
    return spawnRadiationCockroachAt(m.x+(Math.random()*8-4),m.y+(Math.random()*4-1.5),getTile);
  }
  function notifyBombTileChanged(x,y,oldTile,newTile,getTile){
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved && oldTile!==T.AIR && newTile===T.AIR) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement && newTile!==T.AIR) MM.fallingSolids.afterPlacement(x,y); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
  }
  function detonateAtomicBomb(m){
    if(!m || m._atomicDetonated) return false;
    m._atomicDetonated=true;
    const gt=(WORLD && WORLD.getTile) ? ((x,y)=>WORLD.getTile(x,y)) : null;
    const st=(WORLD && WORLD.setTile) ? ((x,y,t)=>WORLD.setTile(x,y,t)) : null;
    const cx=Math.floor(m.x);
    const cy=Math.floor(m.y+1);
    if(gt && st){
      for(let dy=-ATOMIC_BOMB_CRATER_RY; dy<=ATOMIC_BOMB_CRATER_RY; dy++){
        for(let dx=-ATOMIC_BOMB_CRATER_RX; dx<=ATOMIC_BOMB_CRATER_RX; dx++){
          const nx=dx/ATOMIC_BOMB_CRATER_RX;
          const ny=dy/ATOMIC_BOMB_CRATER_RY;
          if(nx*nx+ny*ny>1) continue;
          const tx=cx+dx;
          const ty=cy+dy;
          if(!inWorldY(ty,1,2)) continue;
          const old=gt(tx,ty);
          if(old===T.AIR || isBlastProtectedTile(old)) continue;
          st(tx,ty,T.AIR);
          notifyBombTileChanged(tx,ty,old,T.AIR,gt);
        }
      }
    }
    try{ blastRadius(m.x,m.y,ATOMIC_BOMB_BLAST_RADIUS,96,{cause:'atomic_blast',source:'atomic_bomb',naturalDeath:false}); }catch(e){}
    if(gt){
      for(let i=0;i<12;i++) spawnRadiationCockroachAt(cx+(Math.random()*ATOMIC_BOMB_CRATER_RX*1.5-ATOMIC_BOMB_CRATER_RX*0.75),cy-2+Math.random()*5,gt);
    }
    try{
      const pl=window.player;
      if(pl && typeof window.damageHero==='function'){
        const d=Math.hypot(pl.x-m.x,pl.y-m.y);
        if(d<ATOMIC_BOMB_HERO_BLAST_RADIUS) window.damageHero(Math.max(18,132*(1-d/(ATOMIC_BOMB_HERO_BLAST_RADIUS+1))),{srcX:m.x,srcY:m.y,kb:12,kbY:-7,launch:-8,cause:'atomic_blast',invulMs:1400});
      }
    }catch(e){}
    const tile=MM.TILE||20;
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*tile,m.y*tile,'epic'); }catch(e){}
    try{ if(MM.particles && MM.particles.spawnSmoke) MM.particles.spawnSmoke(m.x*tile,m.y*tile,16,{tileX:cx,tileY:cy,tileSize:tile}); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('explosion'); }catch(e){}
    try{ if(MM.atomicWinter && typeof MM.atomicWinter.trigger==='function') MM.atomicWinter.trigger({x:m.x,y:m.y}); }catch(e){}
    return true;
  }
  function sandWormHeroAirborne(player,getTile){
    if(!player) return false;
    if(player.onGround===false) return true;
    if(Math.abs(player.vy||0)>0.7) return true;
    if(typeof getTile==='function'){
      const x=Math.floor(player.x);
      const footY=Math.floor(player.y+(player.h||0.95)*0.5+0.08);
      const below=readMobTile(getTile,x,footY+1);
      return below===T.AIR && Math.abs(player.vy||0)>0.15;
    }
    return false;
  }
  function sandWormApproachDir(m,player){
    const vx=finiteNum(player && player.vx) ? player.vx : 0;
    if(Math.abs(vx)>0.25) return vx>0?1:-1;
    const dx=(player?player.x:0)-(m?m.x:0);
    if(Math.abs(dx)>0.25) return dx>0?1:-1;
    return player && player.facing<0 ? -1 : 1;
  }
  function findSandWormCircleSpot(m,player,getTile){
    if(!player || typeof getTile!=='function') return null;
    const dir=sandWormApproachDir(m,player);
    const baseX=Math.floor(player.x);
    const baseY=Math.floor(player.y);
    const dirs=[dir,-dir];
    const offsets=[5,6,7,4,8,9,3];
    for(const d of dirs){
      for(const off of offsets){
        const tx=baseX+d*off;
        for(let dy=-2; dy<=4; dy++){
          const ty=baseY+dy;
          if(sandWormDeepSandAt(tx,ty,getTile)) return {x:tx+0.5,y:ty+0.5,dir:d};
        }
      }
    }
    return null;
  }
  function sandWormStartCircle(m,player,now,getTile){
    if(!m || !player || !sandWormCanBurrowAt(m,getTile)) return false;
    m.state='circling';
    m._wormCircleAt=now+SAND_WORM_CIRCLE_DELAY_MS+Math.random()*260;
    m._wormCircleCooldownUntil=now+SAND_WORM_CIRCLE_COOLDOWN_MS+Math.random()*1200;
    m._wormCircleDir=sandWormApproachDir(m,player);
    m.vx*=0.08;
    m.vy=0;
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),(m.y+0.35)*(MM.TILE||20),'common'); }catch(e){}
    return true;
  }
  function sandWormFinishCircle(m,player,getTile,now,sp){
    const spot=findSandWormCircleSpot(m,player,getTile);
    if(!spot) return false;
    m.x=spot.x;
    m.y=spot.y;
    const dx=player.x-m.x, dy=player.y-m.y;
    const d=Math.hypot(dx,dy)||1;
    m.state='ambush';
    m.facing=dx>=0?1:-1;
    m.vx=(dx/d)*(sp||SAND_WORM_SPIT_SPEED)*1.7;
    m.vy=-2.5;
    m._wormCircleCooldownUntil=Math.max(m._wormCircleCooldownUntil||0,now+SAND_WORM_CIRCLE_COOLDOWN_MS);
    markMobTelegraph(m,'bite',{target:player,power:1.25,ms:520});
    markHeroAttack(m);
    setAggro(m.id);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),(m.y+0.35)*(MM.TILE||20),'rare'); }catch(e){}
    return true;
  }
  function shootSandWormSpit(m,target,speed,dmg){
    if(!m || !target || mobProjectiles.length>=MOB_PROJ_CAP) return false;
    const shotSpeed=(speed||SAND_WORM_SPIT_SPEED) * ((m && m.projectileSpeedMult) || 1);
    const sx=m.x+(m.facing>=0?0.72:-0.72);
    const sy=m.y-0.62;
    const base=targetAimBase(target,-0.18);
    const dist=Math.hypot(base.x-sx,base.y-sy)||1;
    const travel=Math.max(0.35,Math.min(1.35,dist/Math.max(1,shotSpeed)));
    const lead=Math.max(0.85,Math.min(1.16,Number(m.aimLead)||0.95));
    const aimX=base.x+(finiteNum(target.vx)?target.vx:0)*travel*lead;
    const aimY=base.y+(finiteNum(target.vy)?target.vy:0)*travel*lead*0.85;
    const gravity=8.8;
    let vx=(aimX-sx)/travel;
    let vy=(aimY-sy-0.5*gravity*travel*travel)/travel;
    const maxSpeed=shotSpeed*1.35;
    const mag=Math.hypot(vx,vy)||1;
    if(mag>maxSpeed){ const s=maxSpeed/mag; vx*=s; vy*=s; }
    mobProjectiles.push({
      x:sx, y:sy, vx, vy,
      dmg:(dmg||10)*(m.dmgMult||1),
      t:0,
      spin:Math.random()*6.28,
      lead,
      type:'spit',
      cause:'sand_worm_spit',
      ownerId:'SAND_WORM',
      gravity,
      radius:0.68,
      aimX,
      aimY
    });
    markMobAttack(m,'spit',{target,power:1.15});
    try{ if(MM.audio && MM.audio.play) MM.audio.play('splash'); }catch(e){}
    return true;
  }
  function shootStoneGolemRock(m,target,speed,dmg){
    if(!m || !target || mobProjectiles.length>=MOB_PROJ_CAP) return false;
    const shotSpeed=(speed||STONE_GOLEM_ROCK_SPEED) * ((m && m.projectileSpeedMult) || 1);
    const sx=m.x+(m.facing>=0?0.58:-0.58);
    const sy=m.y-1.18;
    const base=targetAimBase(target,-0.28);
    const dist=Math.hypot(base.x-sx,base.y-sy)||1;
    const travel=Math.max(0.42,Math.min(1.55,dist/Math.max(1,shotSpeed)));
    const lead=Math.max(0.24,Math.min(0.95,Number(m.aimLead)||0.45));
    const aimX=base.x+(finiteNum(target.vx)?target.vx:0)*travel*lead;
    const aimY=base.y+(finiteNum(target.vy)?target.vy:0)*travel*lead*0.45;
    const gravity=12.8;
    let vx=(aimX-sx)/travel;
    let vy=(aimY-sy-0.5*gravity*travel*travel)/travel;
    const maxSpeed=shotSpeed*1.25;
    const mag=Math.hypot(vx,vy)||1;
    if(mag>maxSpeed){ const s=maxSpeed/mag; vx*=s; vy*=s; }
    mobProjectiles.push({
      x:sx, y:sy, vx, vy,
      dmg:(dmg||12)*(m.dmgMult||1),
      t:0,
      spin:Math.random()*6.28,
      lead,
      type:'rock',
      cause:'stone_golem_rock',
      ownerId:'STONE_GOLEM',
      gravity,
      radius:0.78,
      aimX,
      aimY
    });
    m.shake=Math.max(m.shake||0,0.35);
    markMobAttack(m,'throw',{target,power:1.25});
    try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(sx*(MM.TILE||20),sy*(MM.TILE||20),'common',5); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('thud'); }catch(e){}
    return true;
  }
  function addGoldDragonGas(x,y,getTile,setTile,power,cells){
    try{
      if(!MM.gases || typeof MM.gases.add!=='function') return 0;
      return MM.gases.add(Math.random()<0.72?'poison':'fuel',x,y,{power:power||0.65,cells:cells||2,getTile,setTile});
    }catch(e){ return 0; }
  }
  function igniteGoldDragonBreath(x,y,getTile,setTile){
    let lit=0;
    try{
      if(!MM.fire || typeof MM.fire.ignite!=='function' || typeof getTile!=='function') return 0;
      const tx=Math.floor(x), ty=Math.floor(y);
      for(let dy=-1; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
          if(Math.abs(dx)+Math.abs(dy)>1) continue;
          if(MM.fire.ignite(tx+dx,ty+dy,getTile,setTile)) lit++;
        }
      }
    }catch(e){}
    return lit;
  }
  function dragonBreathImpact(pr,getTile,setTile){
    if(!pr || pr.type!=='dragon_fire') return false;
    addGoldDragonGas(pr.x,pr.y,getTile,setTile,0.88,3);
    igniteGoldDragonBreath(pr.x,pr.y,getTile,setTile);
    try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(pr.x*(MM.TILE||20),pr.y*(MM.TILE||20),'rare',8); }catch(e){}
    return true;
  }
  function shootGoldDragonBreath(m,target,speed,dmg,getTile,setTile){
    if(!m || !target) return false;
    const shotSpeed=(speed||12.5) * ((m && m.projectileSpeedMult) || 1);
    const sx=m.x+(m.facing>=0?1.38:-1.38);
    const sy=m.y-1.16;
    const base=targetAimBase(target,-0.22);
    const dist=Math.hypot(base.x-sx,base.y-sy)||1;
    const travel=Math.max(0.28,Math.min(1.18,dist/Math.max(1,shotSpeed)));
    const lead=Math.max(0.34,Math.min(1.02,Number(m.aimLead)||0.58));
    const aimX=base.x+(finiteNum(target.vx)?target.vx:0)*travel*lead;
    const aimY=base.y+(finiteNum(target.vy)?target.vy:0)*travel*lead*0.45;
    let vx=(aimX-sx)/travel;
    let vy=(aimY-sy)/travel - 0.7;
    const maxSpeed=shotSpeed*1.18;
    const mag=Math.hypot(vx,vy)||1;
    if(mag>maxSpeed){ const s=maxSpeed/mag; vx*=s; vy*=s; }
    const breathDmg=(dmg||24)*(m.dmgMult||1);
    try{
      const streamApi=MM && MM.weapons;
      if(streamApi && typeof streamApi.spawnExternalStream==='function'){
        const made=streamApi.spawnExternalStream('flame',sx,sy,aimX-sx,aimY-sy,{
          range:Math.max(4,Math.min(GOLD_DRAGON_BREATH_RANGE+1,dist+1.35)),
          dps:Math.max(10,breathDmg*0.82),
          emitScale:3.2,
          spread:0.31,
          muzzle:0.46,
          speedMult:1.10,
          vyKick:-0.24,
          scale:1.36,
          source:'mob',
          cause:'gold_dragon_fire',
          ownerId:'GOLD_DRAGON'
        });
        if(made>0){
          addGoldDragonGas(sx,sy,getTile,setTile,0.42,2);
          markMobAttack(m,'gold_dragon_fire',{target,power:1.55,strikeMs:460});
          try{ if(MM.audio && MM.audio.play) MM.audio.play('fire'); }catch(e){}
          return true;
        }
      }
    }catch(e){}
    if(mobProjectiles.length>=MOB_PROJ_CAP) return false;
    mobProjectiles.push({
      x:sx, y:sy, vx, vy,
      dmg:breathDmg,
      t:0,
      spin:Math.random()*6.28,
      lead,
      type:'dragon_fire',
      cause:'gold_dragon_fire',
      ownerId:'GOLD_DRAGON',
      gravity:1.4,
      radius:0.86,
      aimX,
      aimY
    });
    addGoldDragonGas(sx,sy,getTile,setTile,0.42,2);
    markMobAttack(m,'gold_dragon_fire',{target,power:1.55,strikeMs:460});
    try{ if(MM.audio && MM.audio.play) MM.audio.play('fire'); }catch(e){}
    return true;
  }
  function shootGoldDwarfPick(m,target,speed,dmg){
    if(!m || !target || mobProjectiles.length>=MOB_PROJ_CAP) return false;
    const shotSpeed=(speed||9.8) * ((m && m.projectileSpeedMult) || 1);
    const sx=m.x+(m.facing>=0?0.42:-0.42);
    const sy=m.y-0.82;
    const base=targetAimBase(target,-0.26);
    const dist=Math.hypot(base.x-sx,base.y-sy)||1;
    const travel=Math.max(0.32,Math.min(1.18,dist/Math.max(1,shotSpeed)));
    const lead=Math.max(0.22,Math.min(0.78,Number(m.aimLead)||0.38));
    const aimX=base.x+(finiteNum(target.vx)?target.vx:0)*travel*lead;
    const aimY=base.y+(finiteNum(target.vy)?target.vy:0)*travel*lead*0.38;
    const gravity=10.8;
    let vx=(aimX-sx)/travel;
    let vy=(aimY-sy-0.5*gravity*travel*travel)/travel;
    const maxSpeed=shotSpeed*1.2;
    const mag=Math.hypot(vx,vy)||1;
    if(mag>maxSpeed){ const s=maxSpeed/mag; vx*=s; vy*=s; }
    mobProjectiles.push({
      x:sx, y:sy, vx, vy,
      dmg:(dmg||10)*(m.dmgMult||1),
      t:0,
      spin:Math.random()*6.28,
      lead,
      type:'gold_pick',
      cause:'gold_dwarf_pick',
      ownerId:'GOLD_DWARF_GUARD',
      gravity,
      radius:0.56,
      aimX,
      aimY
    });
    markMobAttack(m,'gold_dwarf_pick',{target,power:1.05,strikeMs:340});
    try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(sx*(MM.TILE||20),sy*(MM.TILE||20),'common',4); }catch(e){}
    return true;
  }
  function pacifyStoneGolem(m,reason,now){
    if(!m || m.id!=='STONE_GOLEM') return false;
    m.state='cracked';
    if(reason==='water' && m.hp>1) m.hp=Math.max(1,m.hp-6);
    return pacifyMob(m,STONE_GOLEM_CALM_MS,reason||'cracked',now);
  }
  function isTempleGuardTile(t){ return !!TEMPLE_GUARD_TILES[t]; }
  function templeSignalScore(x,y,getTile){
    if(typeof getTile!=='function') return {score:0, treasure:0};
    let score=0, treasure=0;
    for(let dy=-5; dy<=5; dy++){
      for(let dx=-8; dx<=8; dx++){
        const t=readMobTile(getTile,x+dx,y+dy);
        if(!isTempleGuardTile(t)) continue;
        score += (t===T.CHEST_EPIC ? 5 : t===T.CHEST_RARE ? 4 : t===T.CHEST_COMMON ? 3 : t===T.DIAMOND ? 3 : t===T.OBSIDIAN ? 2 : t===T.TORCH ? 2 : 1);
        if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC || t===T.DIAMOND) treasure++;
      }
    }
    return {score,treasure};
  }
  function nearTempleStructure(x,y,getTile){
    const s=templeSignalScore(x,y,getTile);
    return s.score>=5 && s.treasure>=1;
  }
  function isTempleGuardAggro(m,now){
    const t=(typeof now==='number' && isFinite(now) && now>1000000000) ? now : Date.now();
    return !!(m && m.id==='TEMPLE_GUARD' && finiteNum(m.templeAggroUntil) && m.templeAggroUntil>t);
  }
  function markTempleGuardAlarm(m,wx,wy,kind,now){
    if(!m || m.id!=='TEMPLE_GUARD') return false;
    const t=(typeof now==='number' && isFinite(now) && now>1000000000) ? now : Date.now();
    const dur = kind==='treasure' ? TEMPLE_GUARD_VIOLATION_AGGRO_MS : Math.round(TEMPLE_GUARD_VIOLATION_AGGRO_MS*0.72);
    m.templeAggroUntil=Math.max(m.templeAggroUntil||0,t+dur);
    m.templeAlarmX=finiteCoord(wx)?wx:m.x;
    m.templeAlarmY=finiteCoord(wy)?wy:m.y;
    m.templeAlarmKind=kind==='treasure'?'treasure':'structure';
    m.state=kind==='treasure'?'relic_alarm':'structure_alarm';
    m.attackCd=Math.min(m.attackCd||0,0.25);
    markMobTelegraph(m,kind==='treasure'?'charge':'strike',{x:wx,y:wy,power:1.0,ms:650});
    markHeroAttack(m);
    return true;
  }
  function templeEventTouchesGuard(m,wx,wy,temple,range){
    if(!m || m.id!=='TEMPLE_GUARD' || m.hp<=0) return false;
    if(temple && Number.isFinite(temple.minX)){
      const padX=14, padY=10;
      if(m.x>=temple.minX-padX && m.x<=temple.maxX+padX && m.y>=temple.minY-padY && m.y<=temple.maxY+padY) return true;
    }
    const dx=m.x-wx, dy=m.y-wy;
    return dx*dx+dy*dy <= range*range;
  }
  function findTempleGuardSpawnNear(wx,wy,getTile,range){
    const spec=SPECIES.TEMPLE_GUARD;
    if(!spec || typeof getTile!=='function') return null;
    const cx=Math.floor(wx), cy=Math.floor(wy);
    const maxR=Math.max(3,Math.min(28,range||TEMPLE_GUARD_REINFORCE_RADIUS));
    for(let r=1; r<=maxR; r++){
      for(let dy=-Math.min(r,10); dy<=Math.min(r,10); dy++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const x=cx+dx, y=cy+dy;
          if(!inWorldY(y,1,1)) continue;
          if(spec.spawnTest(x,y,getTile)) return {x:x+0.5,y:y+0.5};
        }
      }
    }
    return null;
  }
  function currentGameDayFloat(){
    try{
      const seasons=MM.seasons;
      if(seasons && typeof seasons.metrics==='function'){
        const m=seasons.metrics();
        const day=Number(m && m.dayFloat);
        if(isFinite(day) && day>0) return day;
      }
    }catch(e){}
    try{
      const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
      if(isFinite(now)) return 1 + Math.max(0,now) / (XP_FALLBACK_DAY_SECONDS*1000);
    }catch(e){}
    return 1;
  }
  function notifyTempleDisturbed(tx,ty,opts){
    opts=opts||{};
    const kind=opts.kind==='treasure' ? 'treasure' : 'structure';
    const wx=(Number(tx)||0)+0.5, wy=(Number(ty)||0)+0.5;
    const temple=opts.temple || null;
    const getTile=typeof opts.getTile==='function' ? opts.getTile : (WORLD && WORLD.getTile);
    const now=Date.now();
    let alerted=0;
    for(const m of mobs){
      if(!validMobState(m) || !templeEventTouchesGuard(m,wx,wy,temple,TEMPLE_GUARD_ALARM_RADIUS)) continue;
      if(markTempleGuardAlarm(m,wx,wy,kind,now)) alerted++;
    }
    const spec=SPECIES.TEMPLE_GUARD;
    const wantsReinforcement = kind==='treasure' ? 2 : 1;
    let spawned=0;
    while(spec && spawned<wantsReinforcement && countSpecies('TEMPLE_GUARD')<spec.max && alerted+spawned<Math.max(1,wantsReinforcement)){
      const spot=findTempleGuardSpawnNear(wx,wy,getTile,TEMPLE_GUARD_REINFORCE_RADIUS + spawned*4);
      if(!spot) break;
      const g=create(spec,spot.x,spot.y,getTile);
      g.homeX=spot.x; g.homeY=spot.y;
      markTempleGuardAlarm(g,wx,wy,kind,now);
      mobs.push(g);
      spawned++;
    }
    if(alerted || spawned){
      try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(wx*(MM.TILE||20),wy*(MM.TILE||20),kind==='treasure'?'epic':'rare'); }catch(e){}
    }
    return {alerted,spawned};
  }
  function placeRewardChestNearMob(m,tier,chance){
    if(!m || Math.random()>Math.max(0,Math.min(1,chance||0))) return false;
    const W=MM.world || WORLD;
    if(!W || typeof W.getTile!=='function' || typeof W.setTile!=='function') return false;
    const chest=tier==='epic'?T.CHEST_EPIC:(tier==='rare'?T.CHEST_RARE:T.CHEST_COMMON);
    const bx=Math.floor(m.x), by=Math.floor(m.y);
    for(let r=0; r<=5; r++){
      for(let dy=-2; dy<=4; dy++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r && r!==0) continue;
          const x=bx+dx, y=by+dy;
          const here=readMobTile(W.getTile,x,y);
          const below=readMobTile(W.getTile,x,y+1);
          if(here===T.AIR && below!==T.AIR && below!==T.WATER && below!==T.CHEST_COMMON && below!==T.CHEST_RARE && below!==T.CHEST_EPIC){
            W.setTile(x,y,chest);
            try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((x+0.5)*(MM.TILE||20),(y+0.5)*(MM.TILE||20),tier||'common'); }catch(e){}
            return true;
          }
        }
      }
    }
    return false;
  }

  registerSpecies({ // Large forest predator near trees
  id:'BEAR', max:6, hp:30, dmg:10, speed:2.0, wanderInterval:[3,7], xp:25, ground:true,
  sightRange: 16, pursueRange: 22,
  move:{jumpVel:-2.6, maxClimb:1, avoidWater:true},
  variant:{shift:3, from:'#6b4a30', to:'#7d573b'},
  body:{w:1.6,h:1.2},
    loot:[{item:'wood', min:1, max:2, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); if(!(below===T.GRASS||below===T.WOOD||isLeaf(below))) return false; // require trunk or leaf adjacency
      const trunk = getTile(x-1,y+1)===T.WOOD || getTile(x+1,y+1)===T.WOOD; return trunk && biomeAt(x)===0; },
    biome:'forest',
    onUpdate(m,spec,{dt,player,aggressive,speed}){ // slow patrol, lunge when close (horizontal only, grounded)
      const sp = (speed||spec.speed||2);
      const dx=player.x-m.x; const dist=Math.abs(dx)||1;
      if(dist<6){ m.vx += (dx/dist)*sp*0.4*dt*30; m.facing = dx>=0?1:-1; if(dist<1.7){ m.vx += (dx/dist)*sp*0.9; } }
      else if(Math.random()<0.005){ m.vx += (Math.random()*2-1)*0.6; }
    }
  });

  registerSpecies({
    id:'BRAMBLE_STALKER', displayName:'Bramble stalker',
    max:8, localMax:3, spawnChance:0.56,
    hp:24, dmg:9, speed:3.15, wanderInterval:[1.6,3.8], xp:36, ground:true,
    sightRange:16, pursueRange:23,
    move:{jumpVel:-5.0, maxClimb:2, avoidWater:true},
    body:{w:1.15,h:1.22},
    contactInvulMs:460, contactKnockback:1.15, contactKnockbackY:-0.9, contactCause:'bramble_thorns',
    variant:{shift:3, from:'#315c2d', to:'#6b7f35'},
    loot:[{item:'leaf', min:2, max:5, chance:0.9}, {item:'wood', min:1, max:3, chance:0.58}, {item:'glowshroom', min:1, max:1, chance:0.16}],
    meat:false,
    spawnTest(x,y,getTile){ return brambleStalkerSpawnCell(x,y,getTile); },
    biome:'forest',
    onCreate(m){
      m.state='camouflaged';
      m.scale=0.92+Math.random()*0.16;
      m.speedMul=0.84+Math.random()*0.22;
      m._nextBrambleLungeAt=performance.now()+800+Math.random()*1500;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile}){
      const torch=nearTorch(m.x,m.y,getTile,BRAMBLE_STALKER_TORCH_RADIUS);
      if(torch || hasStatus(m,'burn')){
        m.state='singed';
        pacifyMob(m,BRAMBLE_STALKER_CALM_MS,torch?'torch':'fire',now);
      }
      if(isMobPacified(m,now)){
        m.vx*=0.58;
        if(m.onGround) m.vy=0;
        return;
      }
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const forestRisk=biomeAt(player.x)===0 || nearForestTreeMass(m.x,m.y,getTile,8);
      if(!aggressive && forestRisk && dist<BRAMBLE_STALKER_WAKE_RADIUS){
        if(m.state==='camouflaged') noteEntityNumber({kind:'danger', text:'!', x:m.x, y:m.y-1.25, target:'bramble_stalker:'+Math.round(m.spawnT||0)});
        markMobTelegraph(m,'bite',{target:player,power:0.9,ms:520});
        markHeroAttack(m);
        m.state='unfurl';
        m.shake=Math.max(m.shake||0,0.45);
      }
      if(aggressive || isHeroFocused(m) || m.state==='unfurl' || m.state==='snare'){
        const dir=dx>=0?1:-1;
        const sp=(speed||spec.speed)*(m.state==='snare'?1.18:0.92);
        m.facing=dir;
        m.vx += dir*sp*(dist<3.2?0.78:0.46)*dt*30;
        if(m.onGround && now>(m._nextBrambleLungeAt||0) && Math.abs(dx)>1.0 && Math.abs(dy)<5.5){
          m.state='snare';
          markMobTelegraph(m,'bite',{target:player,power:1.05,ms:360});
          m.vx += dir*sp*1.35;
          m.vy=(spec.move.jumpVel||-5)*(m.jumpMul||1)*(dist<4?0.82:0.64);
          m._nextBrambleLungeAt=now+BRAMBLE_STALKER_LUNGE_COOLDOWN_MS+Math.random()*850;
        }
      } else {
        m.state='camouflaged';
        if(m.onGround && Math.random()<0.006) m.vx += (Math.random()<0.5?-1:1)*(speed||spec.speed)*0.18;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.20?'rare':'common', 0.22);
    }
  });

  registerSpecies({ // Tree-dwelling small mammal on leaves
  id:'SQUIRREL', max:20, hp:4, dmg:1, speed:3.0, wanderInterval:[1.2,3.5], xp:5, ground:true,
  sightRange: 10, pursueRange: 14,
  move:{jumpVel:-3.2, maxClimb:2, avoidWater:true, preferLeaf:true},
  body:{w:0.8,h:0.7},
    loot:[{item:'leaf', min:1, max:2, chance:0.5}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && isLeaf(below); },
    biome:'forest',
    onUpdate(m,spec,{now,dt,player,speed}){ // quick horizontal dashes along canopy
      if(Math.random()<0.02){ m.vx = (Math.random()<0.5?-1:1)*(speed||spec.speed)*(0.6+Math.random()*0.4); m.vy *=0.3; }
      // constrain to leaf layer: if below leaves, nudge up
  const underLeaf = WORLD && WORLD.getTile ? isLeaf(WORLD.getTile(Math.floor(m.x), Math.floor(m.y)+1)) : false;
      if(!underLeaf){ // treat like ground animal: ensure downward grav not cancelled so it stands
        if(m.onGround){ // occasional hop with varied height
          if(Math.random()<0.04){ m.vy = (spec.move.jumpVel||-3.2) * (m.jumpMul||1) * (0.85 + Math.random()*0.3); }
          else m.vy=0;
        }
      }
    }
  });

  registerSpecies({ // Fast herbivore on open grass
  id:'DEER', max:14, hp:12, dmg:3, speed:3.8, wanderInterval:[2,5], xp:12, ground:true,
  sightRange: 18, pursueRange: 24,
  move:{jumpVel:-3.6, maxClimb:1, avoidWater:true},
  body:{w:1.4,h:1.1},
    loot:[{item:'leaf', min:1, max:1, chance:0.3}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); if(here!==T.AIR || below!==T.GRASS) return false; const above=getTile(x,y-1); return above===T.AIR && biomeAt(x)!==2; },
    biome:'plains',
  onUpdate(m,spec,{player,dt,now,aggressive,speed}){ const dx=player.x-m.x; const adx=Math.abs(dx); if(!aggressive && adx<8){ // flee
    const sp = (speed||spec.speed||2);
    const dir = dx>0?-1:1; m.vx += dir*sp*0.6; m.facing = m.vx>=0?1:-1; } }
  });

  registerSpecies({
    id:'THUNDER_BISON', displayName:'Thunder bison',
    max:7, localMax:3, spawnBatch:2, spawnChance:0.66,
    hp:48, dmg:15, speed:3.15, wanderInterval:[2.0,4.8], xp:48, ground:true,
    sightRange:18, pursueRange:27,
    move:{jumpVel:-3.1, maxClimb:1, avoidWater:true},
    body:{w:2.28,h:1.44},
    contactInvulMs:520, contactKnockback:2.6, contactKnockbackY:-1.25, contactCause:'thunder_bison_charge',
    variant:{shift:4, from:'#765033', to:'#a8753d'},
    loot:[{item:'grass', min:2, max:5, chance:1}, {item:'wood', min:1, max:2, chance:0.34}, {item:'summerHorn', min:1, max:1, chance:0.10}],
    meatDropChance:1,
    spawnTest(x,y,getTile){ return thunderBisonSpawnCell(x,y,getTile); },
    biome:'plains',
    onCreate(m){
      m.state='grazing';
      m.scale=1.05+Math.random()*0.18;
      m.speedMul=0.80+Math.random()*0.18;
      m.jumpMul=0.72+Math.random()*0.14;
      m._nextBisonChargeAt=performance.now()+1000+Math.random()*2400;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile}){
      const dx=player.x-m.x, dy=player.y-m.y;
      const adx=Math.abs(dx), dist=Math.hypot(dx,dy)||1;
      if(m.state==='stunned'){
        m.vx*=0.62;
        if(m.onGround) m.vy=0;
        if(now>(m._bisonStunnedUntil||0)) m.state='grazing';
        return;
      }
      if(m.state==='charge'){
        const dir=m.facing>=0?1:-1;
        const sp=(speed||spec.speed)*2.85;
        m.vx += (dir*sp-m.vx)*Math.min(1,dt*7);
        if(dist<1.95 && now>(m._lastBisonHitAt||0)){
          markMobAttack(m,'thunder_bison_charge',{target:player,power:1.55,strikeMs:420});
          damagePlayer((spec.dmg||12)*1.22*(m.dmgMult||1),m.x,m.y,'thunder_bison_charge',spec);
          m._lastBisonHitAt=now+520;
          m.attackCd=Math.max(m.attackCd||0,0.68);
        }
        const front=readMobTile(getTile,Math.floor(m.x+dir*1.45),Math.floor(m.y));
        if(now>(m._bisonChargeUntil||0) || (front!==T.AIR && front!==T.TORCH && !isLeaf(front))){
          m.state='stunned';
          m._bisonStunnedUntil=now+THUNDER_BISON_STUN_MS;
          m._nextBisonChargeAt=now+THUNDER_BISON_CHARGE_COOLDOWN_MS+Math.random()*1400;
          m.vx*=0.22;
          m.shake=Math.max(m.shake||0,0.65);
        }
        return;
      }
      if(m.state==='windup'){
        m.vx*=0.58;
        m.facing=dx>=0?1:-1;
        warnThunderBisonCharge(m,now);
        if(now>(m._bisonWindupUntil||0)){
          m.state='charge';
          m._bisonChargeUntil=now+THUNDER_BISON_CHARGE_MS;
          m.vx=m.facing*(speed||spec.speed)*2.35;
          m.shake=Math.max(m.shake||0,0.55);
        }
        return;
      }
      const heroProvokes = Math.abs(player.vx||0)>3.2 || aggressive || isHeroFocused(m);
      if(adx<THUNDER_BISON_CHARGE_RANGE && Math.abs(dy)<3.2 && now>(m._nextBisonChargeAt||0) && (heroProvokes || adx<THUNDER_BISON_WARN_RADIUS)){
        markMobTelegraph(m,'charge',{target:player,power:1.25,ms:650});
        markHeroAttack(m);
        m.state='windup';
        m.facing=dx>=0?1:-1;
        m._bisonWindupUntil=now+360+Math.random()*220;
        warnThunderBisonCharge(m,now);
        m.vx*=0.42;
        return;
      }
      const herd=nearestSameSpecies(m,12);
      if(herd && adx>=10){
        const gap=herd.x-m.x;
        m.vx += Math.sign(gap||m.facing)*(speed||spec.speed)*0.06*dt*30;
      } else if(Math.random()<0.006){
        m.vx += (Math.random()<0.5?-1:1)*(speed||spec.speed)*0.18;
      }
      if(adx<5 && !aggressive){
        const dir=dx>0?-1:1;
        m.vx += dir*(speed||spec.speed)*0.16*dt*30;
        m.facing=dir;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.18?'rare':'common', 0.20);
    }
  });

  registerSpecies({ // Snow biome predator (pack)
  id:'WOLF', max:10, hp:16, dmg:6, speed:3.4, wanderInterval:[2,5], xp:15, ground:true,
  sightRange: 20, pursueRange: 28,
  move:{jumpVel:-4.0, maxClimb:1, avoidWater:true},
  variant:{shift:4, from:'#bcbcbc', to:'#d6d6d6'},
  body:{w:1.4,h:1.0},
    loot:[{item:'snow', min:1, max:2, chance:0.5}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); return below===T.SNOW || (below===T.GRASS && biomeAt(x)===2); },
    biome:'snow',
    onUpdate(m,spec,{player,aggressive,dt,speed}){ const spd=(speed||spec.speed||2); const dx=player.x-m.x; const adx=Math.abs(dx)||1; const biteGap=0.9; // stop at ~1 tile distance
      if(aggressive || adx<8){
        // Desired stand-off: approach until at bite gap, then hover
        if(adx > biteGap){
          const dir = dx>0?1:-1; m.vx = dir * spd * 0.9; m.facing = dir; }
        else {
          // within bite distance: slow / minor circling damp
          m.vx *= 0.6; if(Math.abs(m.vx)<0.05) m.vx = 0; m.facing = dx>=0?1:-1; }
  if(adx<3) setAggro('WOLF');
      } else if(Math.random()<0.01){ m.vx += (Math.random()*2-1)*0.4 * (spd/ (spec.speed||1)); }
    }
  });

  registerSpecies({
    id:'ICE_WRAITH', displayName:'Ice wraith',
    max:8, localMax:3, spawnChance:0.58,
    hp:26, dmg:12, speed:4.6, wanderInterval:[1.4,3.0], xp:44,
    flying:true, sightRange:18, pursueRange:30,
    body:{w:0.9,h:1.35},
    contactInvulMs:480, contactKnockback:2.3, contactKnockbackY:-1.15, contactCause:'ice_wraith_frost',
    variant:{shift:2, from:'#bdefff', to:'#eefbff'},
    meat:false,
    loot:[{item:'snow', min:2, max:5, chance:0.85}, {item:'ice', min:1, max:3, chance:0.72}, {item:'diamond', min:1, max:1, chance:0.08}],
    spawnTest(x,y,getTile){ return iceWraithSpawnCell(x,y,getTile); },
    biome:'snow',
    onCreate(m){
      m.state='veiled';
      m.scale=0.90+Math.random()*0.18;
      m.speedMul=0.88+Math.random()*0.22;
      m._nextBlinkAt=performance.now()+900+Math.random()*1600;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile,distToPlayer}){
      const torch = nearTorch(m.x,m.y,getTile,ICE_WRAITH_TORCH_RADIUS);
      if(torch || hasStatus(m,'burn')){
        m.state='melt';
        pacifyMob(m,ICE_WRAITH_CALM_MS,torch?'torch':'fire',now);
      }
      if(isMobPacified(m,now)){
        m.vx*=0.70;
        m.vy += (Math.sin(now*0.003+m.spawnT*0.002)*0.12-m.vy)*Math.min(1,dt*3);
        return;
      }
      const dx=player.x-m.x, dy=(player.y-0.35)-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const inSnowRisk=biomeAt(player.x)===2 || biomeAt(m.x)===2;
      if(!aggressive && inSnowRisk && dist<(distToPlayer<ICE_WRAITH_WAKE_RADIUS?ICE_WRAITH_WAKE_RADIUS:6.4)){
        markMobTelegraph(m,'shock',{target:player,power:0.95,ms:540});
        markHeroAttack(m);
        m.state='manifest';
        m.shake=Math.max(m.shake||0,0.34);
      }
      const hostile=aggressive || isHeroFocused(m) || m.state==='manifest' || m.state==='whiteout';
      if(hostile && inSnowRisk){
        if(dist>ICE_WRAITH_BLINK_DIST && now>(m._nextBlinkAt||0)){
          const spot=findIceWraithBlinkSpot(player,m,getTile);
          if(spot){
            m.x=spot.x; m.y=spot.y;
            m.vx*=0.18; m.vy*=0.18;
            m.state='whiteout';
            markMobTelegraph(m,'shock',{target:player,power:1.2,ms:460});
            m._nextBlinkAt=now+ICE_WRAITH_BLINK_COOLDOWN_MS+Math.random()*1200;
            m.shake=Math.max(m.shake||0,0.72);
            try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),m.y*(MM.TILE||20),'rare'); }catch(e){}
          }
        }
        const tx=player.x, ty=player.y-0.25;
        const vx=tx-m.x, vy=ty-m.y;
        const d=Math.hypot(vx,vy)||1;
        const sp=(speed||spec.speed)*(m.state==='whiteout'?1.12:0.95);
        m.vx += (vx/d)*sp*dt*5.6;
        m.vy += (vy/d)*sp*dt*4.2;
        m.facing=vx>=0?1:-1;
      } else {
        m.state='veiled';
        const bob=Math.sin(now*0.0026+m.spawnT*0.0017)*0.24;
        m.vy += (bob-m.vy)*Math.min(1,dt*1.6);
        if(Math.random()<0.015){
          m.vx += (Math.random()*2-1)*(speed||spec.speed)*0.18;
        }
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.30?'rare':'common', 0.24);
    }
  });

  registerSpecies({
    id:'ICE_SHAMAN', displayName:'Ice shaman',
    max:2, localMax:1, spawnChance:0.024,
    hp:42, dmg:0, speed:2.35, wanderInterval:[3.2,6.8], xp:72, ground:true, neverAggro:true,
    sightRange:0, pursueRange:0,
    move:{jumpVel:-4.4, maxClimb:1.5, avoidWater:true},
    body:{w:1.05,h:1.48},
    variant:{shift:3, from:'#9fe8ff', to:'#f0fbff'},
    meat:false,
    loot:[{item:'snow', min:3, max:7, chance:1}, {item:'ice', min:2, max:5, chance:0.82}, {item:'diamond', min:1, max:1, chance:0.10}],
    spawnTest(x,y,getTile){ return weatherShamanSpawnCell(x,y,getTile,-1); },
    biome:'any',
    onCreate(m){
      m.state='praying';
      m.scale=0.94+Math.random()*0.12;
      m.speedMul=0.66+Math.random()*0.12;
      m.jumpMul=0.82+Math.random()*0.10;
      m.homeX=m.x; m.homeY=m.y;
      scheduleWeatherShamanRitual(m,performance.now(),Math.random()*2400);
    },
    onUpdate:updateWeatherShaman,
    onDamaged:damageWeatherShaman,
    onDeath(m){
      stopWeatherShamanEffect(m);
      placeRewardChestNearMob(m, Math.random()<0.20?'rare':'common', 0.18);
    }
  });

  registerSpecies({
    id:'FIRE_SHAMAN', displayName:'Fire shaman',
    max:2, localMax:1, spawnChance:0.024,
    hp:46, dmg:0, speed:2.45, wanderInterval:[3.0,6.4], xp:78, ground:true, neverAggro:true,
    sightRange:0, pursueRange:0,
    move:{jumpVel:-4.2, maxClimb:1.5, avoidWater:true},
    body:{w:1.08,h:1.50},
    variant:{shift:3, from:'#ff8f4a', to:'#ffd36a'},
    meat:false,
    loot:[{item:'coal', min:2, max:5, chance:0.92}, {item:'basalt', min:2, max:5, chance:0.76}, {item:'obsidian', min:1, max:2, chance:0.34}],
    spawnTest(x,y,getTile){ return weatherShamanSpawnCell(x,y,getTile,1); },
    biome:'any',
    onCreate(m){
      m.state='praying';
      m.scale=0.96+Math.random()*0.13;
      m.speedMul=0.68+Math.random()*0.12;
      m.jumpMul=0.80+Math.random()*0.10;
      m.homeX=m.x; m.homeY=m.y;
      scheduleWeatherShamanRitual(m,performance.now(),Math.random()*2400);
    },
    onUpdate:updateWeatherShaman,
    onDamaged:damageWeatherShaman,
    onDeath(m){
      stopWeatherShamanEffect(m);
      placeRewardChestNearMob(m, Math.random()<0.24?'rare':'common', 0.16);
    }
  });

  registerSpecies({ // Small fast jumper on grass (skittish)
  id:'RABBIT', max:22, hp:5, dmg:2, speed:4.0, wanderInterval:[0.8,2.2], xp:6, ground:true,
  sightRange: 12, pursueRange: 16,
  move:{jumpVel:-5.0, maxClimb:1, avoidWater:true},
  body:{w:0.8,h:0.7},
    loot:[{item:'grass', min:1, max:1, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && below===T.GRASS && biomeAt(x)!==2; },
    biome:'plains',
    onUpdate(m,spec,{player,aggressive,dt}){ const dx=player.x-m.x; const adx=Math.abs(dx); const jumpVel = (spec.move && spec.move.jumpVel) || -4; const now=performance.now();
      if(!m._nextJumpAt) m._nextJumpAt = 0;
      if(!aggressive && adx<6 && m.onGround && now>m._nextJumpAt){ // flee hop with randomness
        const dir = dx>0?-1:1; m.vx = dir * (spec.speed*(m.speedMul||1)) * (0.8+Math.random()*0.4); m.vy = jumpVel * (m.jumpMul||1) * (0.85 + Math.random()*0.3); m.facing = dir; m._nextJumpAt = now + 400 + Math.random()*300; return; }
      // Occasional idle hop (rarer)
      if(m.onGround && now>m._nextJumpAt && Math.random()<0.01){ m.vy = jumpVel * (m.jumpMul||1) * (0.45 + Math.random()*0.25); m._nextJumpAt = now + 500 + Math.random()*600; }
    }
  });

  registerSpecies({ // Night bird perched in trees
  id:'OWL', max:8, hp:8, dmg:5, speed:3.0, wanderInterval:[3,8], xp:9, flying:true,
  sightRange: 18, pursueRange: 26,
    loot:[{item:'leaf', min:1, max:1, chance:0.25}],
    spawnTest(x,y,getTile){ const below=getTile(x,y+1); const here=getTile(x,y); return here===T.AIR && below===T.WOOD; },
    biome:'forest',
    onUpdate(m,spec,{player,dt,now,aggressive}){ // Slight horizontal glide, stronger pursuit at night (time simulated via MM.time?)
      if(aggressive){ const dx=player.x-m.x; const dy=player.y-m.y; const dist=Math.hypot(dx,dy)||1; m.vx += (dx/dist)*spec.speed*0.5; m.vy += (dy/dist)*spec.speed*0.15; m.facing=dx>=0?1:-1; }
      else if(Math.random()<0.01){ m.vx += (Math.random()*2-1)*0.4; }
    }
  });

  registerSpecies({
    id:'VULTURE', displayName:'Vulture',
    max:3, localMax:1, spawnChance:0.18, hp:24, dmg:11, speed:6.8, wanderInterval:[2.4,5.5], xp:34, flying:true,
    sightRange:24, pursueRange:34,
    body:{w:1.45,h:0.78},
    variant:{shift:5, from:'#46372e', to:'#6b5842'},
    loot:[{item:'leaf', min:1, max:3, chance:0.55}, {item:'diamond', min:1, max:1, chance:0.12}],
    meatDropChance:0.55,
    spawnTest(x,y,getTile){
      if(!isVultureColumn(x)) return false;
      if(readMobTile(getTile,x,y)!==T.AIR || readMobTile(getTile,x,y-1)!==T.AIR) return false;
      return !!findVultureNestSpot(x,y,getTile);
    },
    biome:'mountain',
    onCreate(m,spec,getTile){
      const spot=findVultureNestSpot(m.x,m.y,getTile);
      if(spot){
        m.nestX=spot.nestX;
        m.nestY=spot.nestY;
        m.nestTree=!!spot.tree;
        if(finiteCoord(spot.groundY)) m.nestGroundY=spot.groundY;
        m.x=spot.x;
        m.y=spot.y;
      }
      m.homeX=finiteCoord(m.nestX) ? m.nestX+0.5 : m.x;
      m.homeY=finiteCoord(m.nestY) ? m.nestY-1.2 : m.y;
      m.state='perched';
      m._nextVultureDecisionAt=performance.now()+2800+Math.random()*7000;
      m.scale=1.02+Math.random()*0.18;
      m.speedMul=1.02+Math.random()*0.24;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile,setTile,distToPlayer}){
      const nest=materializeVultureNest(m,getTile,setTile);
      const homeX=nest ? nest.x : (finiteCoord(m.homeX)?m.homeX:m.x);
      const homeY=nest ? nest.y-3.5 : (finiteCoord(m.homeY)?m.homeY:m.y-2);
      const dx=player.x-m.x, dy=(player.y-0.35)-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const heroInRisk = isVultureColumn(player.x) || (nest && Math.abs(player.x-nest.nestX)<VULTURE_NEST_RADIUS);
      if(m.state==='carry'){
        updateVultureCarry(m,spec,player,getTile,setTile,now,dt,speed);
        return;
      }
      if(m.state==='dive' && dist<1.05){
        if(m._vultureCapture===true) vultureCaptureHero(m,spec,player,getTile,setTile,now);
        else vultureStrikeHero(m,spec,player,now);
        return;
      }
      if(heroInRisk && distToPlayer<30 && now>(m._nextVultureDecisionAt||0)){
        const nearNest=nest && Math.abs(player.x-nest.nestX)<9 && Math.abs(player.y-nest.nestY)<10;
        const volcano=isVolcanoColumn(player.x);
        const chance=(aggressive?0.48:(volcano?0.16:0.08)) + (nearNest?0.10:0);
        m._nextVultureDecisionAt=now+VULTURE_ATTACK_DECISION_MS+Math.random()*4200;
        if(Math.random()<Math.min(0.72,chance)) vultureStartDive(m,aggressive,now,player);
      }
      if(m.state==='dive'){
        const sp=(speed||spec.speed)*1.38;
        m.vx += (dx/dist)*sp*dt*8.6;
        m.vy += (dy/dist)*sp*dt*8.2;
        m.facing=dx>=0?1:-1;
        return;
      }
      const returning=m.state==='return' || dist>34;
      const orbit=now*0.0012+m.spawnT*0.003;
      const tx=(returning?homeX:homeX+Math.sin(orbit)*5.5);
      const ty=(returning?homeY:homeY-1.6+Math.cos(orbit*1.4)*2.1);
      const hx=tx-m.x, hy=ty-m.y, hd=Math.hypot(hx,hy)||1;
      m.vx += (hx/hd)*(speed||spec.speed)*(returning?0.32:0.16)*dt*5.5;
      m.vy += (hy/hd)*(speed||spec.speed)*(returning?0.28:0.13)*dt*5.0;
      m.facing=(Math.abs(hx)>0.4?hx:dx)>=0?1:-1;
      if(returning && hd<2.2) m.state='perched';
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.18?'rare':'common', 0.20);
    }
  });

  registerSpecies({
    id:'VULTURE_HATCHLING', displayName:'Vulture hatchling',
    max:18, localMax:6, spawnChance:0.04, hp:7, dmg:4, speed:4.1, wanderInterval:[0.9,2.0], xp:8,
    flying:true, alwaysAggro:true, sightRange:16, pursueRange:22,
    body:{w:0.72,h:0.48},
    variant:{shift:2, from:'#6d5a42', to:'#9a7c54'},
    meat:false,
    spawnTest(x,y,getTile){
      if(!isVultureColumn(x)) return false;
      if(readMobTile(getTile,x,y)!==T.AIR) return false;
      for(let dy=0; dy<=3; dy++){
        for(let dx=-3; dx<=3; dx++){
          const t=readMobTile(getTile,x+dx,y+dy);
          if(t===T.WOOD || isLeaf(t)) return true;
        }
      }
      return false;
    },
    biome:'mountain',
    onCreate(m){
      m.scale=0.86+Math.random()*0.18;
      m.speedMul=0.90+Math.random()*0.28;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive}){
      const dx=player.x-m.x, dy=(player.y-0.25)-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const homeX=finiteCoord(m.homeX)?m.homeX:m.x;
      const homeY=finiteCoord(m.homeY)?m.homeY:m.y;
      if(aggressive && dist<spec.pursueRange){
        m.vx += (dx/dist)*(speed||spec.speed)*dt*6.0;
        m.vy += (dy/dist)*(speed||spec.speed)*dt*4.4;
        m.facing=dx>=0?1:-1;
      } else {
        const ox=homeX+Math.sin(now*0.004+m.spawnT)*1.8-m.x;
        const oy=homeY+Math.cos(now*0.005+m.spawnT)*0.9-m.y;
        const od=Math.hypot(ox,oy)||1;
        m.vx += (ox/od)*(speed||spec.speed)*dt*2.2;
        m.vy += (oy/od)*(speed||spec.speed)*dt*2.0;
      }
    }
  });

  registerSpecies({
    id:'JACKPOT_YETI', displayName:'Jackpot yeti',
    max:2, localMax:1, spawnChance:0.055, hp:152, dmg:34, speed:3.25, wanderInterval:[2.0,4.6], xp:185, ground:true,
    sightRange:22, pursueRange:34, alwaysAggro:true,
    move:{jumpVel:-5.2, maxClimb:2, avoidWater:true},
    body:{w:2.25,h:2.15},
    variant:{shift:2, from:'#dceaf0', to:'#f8fbff'},
    contactInvulMs:560, contactKnockback:2.35, contactKnockbackY:-1.18, contactCause:'jackpot_yeti_claw',
    loot:[
      {item:'snow', min:10, max:18, chance:1},
      {item:'ice', min:4, max:9, chance:0.82},
      {item:'diamond', min:1, max:2, chance:0.30},
      {item:'alienBiomass', min:1, max:2, chance:0.16}
    ],
    meatDropChance:0.2,
    spawnTest(x,y,getTile){ return jackpotYetiSpawnCell(x,y,getTile); },
    biome:'snow',
    onCreate(m){
      m.state='prowling';
      m.scale=1.06+Math.random()*0.17;
      m.speedMul=Math.max(m.speedMul||1,0.92+Math.random()*0.18);
      m.jumpMul=Math.max(m.jumpMul||1,0.94+Math.random()*0.16);
      m._nextYetiSlamAt=performance.now()+800+Math.random()*1300;
      m._nextYetiLeapAt=performance.now()+700+Math.random()*1200;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile}){
      const sp=speed||spec.speed||3;
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const dir=dx>=0?1:-1;
      m.facing=dir;
      if(dist<JACKPOT_YETI_SLAM_RANGE && now>(m._nextYetiSlamAt||0)){
        m.state='slam';
        m.shake=Math.max(m.shake||0,0.92);
        markMobAttack(m,'jackpot_yeti_slam',{target:player,power:1.75,strikeMs:520});
        damagePlayer(spec.dmg*(1.05+Math.min(0.35,Math.abs(m.vx||0)*0.045))*(m.dmgMult||1),m.x,m.y-0.55,'jackpot_yeti_slam',spec);
        m._nextYetiSlamAt=now+JACKPOT_YETI_SLAM_COOLDOWN_MS+Math.random()*900;
        m._nextYetiLeapAt=Math.max(m._nextYetiLeapAt||0,now+520);
        try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),(m.y+0.2)*(MM.TILE||20),'rare'); }catch(e){}
        return;
      }
      if((aggressive || dist<spec.sightRange) && dist<10.5 && dist>2.4 && m.onGround && now>(m._nextYetiLeapAt||0)){
        m.state='leap';
        markMobTelegraph(m,'slam',{target:player,power:1.2,ms:560});
        m.vx += dir*sp*1.58;
        m.vy=(spec.move.jumpVel||-5.2)*(m.jumpMul||1);
        m._nextYetiLeapAt=now+JACKPOT_YETI_LEAP_COOLDOWN_MS+Math.random()*950;
        return;
      }
      if(aggressive || dist<spec.sightRange){
        m.state=dist<4?'threat':'prowling';
        m.vx += dir*sp*(dist<5?0.52:0.34)*dt*30;
        if(getTile && m.onGround && readMobTile(getTile,Math.floor(m.x+dir*0.8),Math.floor(m.y+0.55))===T.ICE){
          m.vx += dir*sp*0.10*dt*30;
        }
      } else if(m.onGround && Math.random()<0.006){
        m.state='watching';
        m.vx += (Math.random()<0.5?-1:1)*sp*0.18;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.26?'epic':'rare', 0.38);
      releaseJackpotYetiCommander(m);
    }
  });

  registerSpecies({ // Sand-edge crustacean
    id:'CRAB', max:18, hp:6, dmg:3, speed:2.2, wanderInterval:[1.5,4.5], xp:5, ground:true,
  sightRange: 8, pursueRange: 10,
  move:{jumpVel:-2.0, maxClimb:0.5, avoidWater:false},
  body:{w:1.0,h:0.6},
    loot:[{item:'sand', min:1, max:2, chance:0.6}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); if(here!==T.AIR || below!==T.SAND) return false; return getTile(x-1,y+1)===T.WATER || getTile(x+1,y+1)===T.WATER; },
    biome:'shore'
      // end update
  });

  registerSpecies({ // Deep water predator
  id:'SHARK', max:4, hp:40, dmg:14, speed:3.5, wanderInterval:[2,5], aquatic:true, xp:40,
  sightRange: 26, pursueRange: 34,
  body:{w:2.4,h:0.7},
  variant:{shift:5, from:'#4d7690', to:'#5c87a2'},
    loot:[{item:'diamond', min:1, max:1, chance:0.15}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.WATER) return false; for(let d=1; d<=3; d++){ if(getTile(x,y+d)!==T.WATER) return false; } return getTile(x-2,y)===T.WATER && getTile(x+2,y)===T.WATER; },
    onCreate(m, spec, getTile){ initWaterAnchor(m,getTile); m.desiredDepth = 2 + (Math.random()*2)|0; },
    habitatUpdate(m, spec, getTile, dt){ enforceAquatic(m, spec, getTile, dt); },
    onUpdate(m,spec,{player,dt}){ // strong pursuit if player in water column horizontally
      const py=Math.floor(player.y); const my=Math.floor(m.y); if(Math.abs(player.x-m.x)<10 && Math.abs(py-my)<3){ const dx=player.x-m.x; const dist=Math.abs(dx)||1; m.vx += (dx/dist)*spec.speed*0.5; m.facing=dx>=0?1:-1; }
    }
  });

  registerSpecies({
    id:'JACKPOT_WHALE', displayName:'Jackpot whale',
    max:2, localMax:1, spawnChance:0.035,
    hp:220, dmg:42, speed:3.95, wanderInterval:[2.4,5.4], aquatic:true, strictWater:true, alwaysAggro:true, xp:235,
    sightRange:30, pursueRange:42,
    body:{w:4.8,h:1.38},
    contactInvulMs:650, contactKnockback:3.2, contactKnockbackY:-0.42, contactCause:'jackpot_whale_ram',
    boatDrag:3.4,
    biome:'sea',
    variant:{shift:3, from:'#466d88', to:'#6f9fba'},
    meat:false,
    loot:[
      {item:'fish', min:5, max:12, chance:1},
      {item:'iridium', min:1, max:2, chance:0.26},
      {item:'diamond', min:1, max:2, chance:0.34},
      {item:'alienBiomass', min:1, max:3, chance:0.18}
    ],
    spawnTest(x,y,getTile){ return canHostJackpotWhaleSpawn(x,y,getTile); },
    onCreate(m,spec,getTile){
      initWaterAnchor(m,getTile);
      const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
      if(col) m.desiredDepth=Math.max(2,Math.min(col.depth-2,Math.floor(col.depth*0.62)));
      m.scale=1.02+Math.random()*0.14;
      m.speedMul=Math.max(m.speedMul||1,0.88+Math.random()*0.18);
      m._nextWhaleRamAt=performance.now()+900+Math.random()*1600;
      m._whaleCharge=0;
    },
    habitatUpdate(m,spec,getTile,dt){ enforceAquatic(m,spec,getTile,dt); },
    onUpdate(m,spec,{player,dt,getTile,speed,now}){
      const wetHero=heroInSeaWater(player,getTile);
      const dx=player.x-m.x, dy=(player.y+0.12)-m.y;
      const dist=Math.hypot(dx,dy)||1;
      if(wetHero){
        markHeroAttack(m);
        m.state='ram';
        m._whaleCharge=Math.min(1.45,(m._whaleCharge||0)+dt*(dist<12?1.08:0.72));
        const sp=(speed||spec.speed)*(1+Math.min(0.52,(m._whaleCharge||0)*0.24));
        m.vx += (dx/dist)*sp*dt*(dist<5?4.0:6.0);
        m.vy += (dy/dist)*sp*dt*(dist<5?2.6:4.0);
        m.facing=dx>=0?1:-1;
        if(getTile){
          const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
          if(col) m.desiredDepth=Math.max(1,Math.min(col.depth-2,Math.round((player.y-col.top)+0.6)));
        }
        if(dist<JACKPOT_WHALE_RAM_RANGE && now>(m._nextWhaleRamAt||0)){
          const charge=Math.max(0.7,Math.min(1.45,m._whaleCharge||0.7));
          markMobAttack(m,'jackpot_whale_ram',{target:player,power:1.8,strikeMs:540});
          damagePlayer((spec.dmg||36)*(1+charge*0.34)*(m.dmgMult||1),m.x,m.y,'jackpot_whale_ram',spec);
          m._nextWhaleRamAt=now+JACKPOT_WHALE_RAM_COOLDOWN_MS+Math.random()*1100;
          m._whaleCharge=0.25;
          m.shake=Math.max(m.shake||0,1.0);
          try{ if(MM.water && MM.water.disturb) MM.water.disturb(Math.floor(m.x),420); }catch(e){}
          try{ if(MM.particles && MM.particles.spawnSplash) MM.particles.spawnSplash(m.x*(MM.TILE||20),m.y*(MM.TILE||20),1.5); }catch(e){}
        }
      } else {
        m.state='cruising';
        m._whaleCharge=Math.max(0,(m._whaleCharge||0)-dt*0.4);
        if(Math.random()<0.026){
          const ang=Math.random()*Math.PI*2;
          m.vx += Math.cos(ang)*(speed||spec.speed)*0.16;
          m.vy += Math.sin(ang)*(speed||spec.speed)*0.10;
        }
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.32?'epic':'rare', 0.42);
      releaseJackpotWhaleCommander(m);
    }
  });

  registerSpecies({ // Sea/ocean horde predator: makes swimming crossings deadly
    id:'PIRANHA', max:60, localMax:14, spawnBatch:6, spawnChance:0.96,
    hp:5, dmg:8, speed:11.5, wanderInterval:[0.25,0.75], aquatic:true, strictWater:true, alwaysAggro:true, xp:5,
    sightRange:24, pursueRange:34, body:{w:0.74,h:0.34},
    contactInvulMs:260, contactKnockback:1.1, contactKnockbackY:-0.45, contactCause:'piranha',
    boatDrag:0,
    biome:'sea',
    variant:{shift:1, from:'#7b2024', to:'#d33a2f'},
    meatDropChance:PIRANHA_MEAT_DROP_CHANCE,
    loot:[{item:'fish', min:1, max:1, chance:0.16}],
    spawnTest(x,y,getTile){ return canHostPiranhaSpawn(x,y,getTile); },
    onCreate(m, spec, getTile){
      initWaterAnchor(m,getTile);
      m.desiredDepth = Math.min(1, m.desiredDepth||0);
      m.speedMul = Math.max(m.speedMul||1, 1.05 + Math.random()*0.18);
      m._frenzy = 0;
    },
    habitatUpdate(m, spec, getTile, dt){ enforceAquatic(m, spec, getTile, dt); },
    onUpdate(m,spec,{player,dt,getTile,setTile,aggressive,speed,now}){
      const bait=piranhaBaitTarget(m,getTile,setTile,now);
      if(bait){
        m._frenzy=0;
        const dx=bait.x-m.x, dy=bait.y-m.y;
        const d=Math.hypot(dx,dy)||1;
        const sp=(speed||spec.speed) * (d>0.95 ? 1.08 : 0.36);
        if(d>0.72){
          m.vx += (dx/d)*sp*dt*6.6;
          m.vy += (dy/d)*sp*dt*4.8;
          m.facing=dx>=0?1:-1;
          if(getTile){
            const col=waterColumnAt(Math.floor(bait.x),Math.floor(bait.y),getTile);
            if(col) m.desiredDepth=Math.max(0,Math.min(col.depth-1,Math.round(bait.y-col.top)));
          }
        } else {
          m.vx *= 0.78;
          m.vy *= 0.78;
          if(Math.random()<0.18){
            const a=Math.random()*Math.PI*2;
            m.vx += Math.cos(a)*0.24;
            m.vy += Math.sin(a)*0.18;
          }
          m.shake=Math.max(m.shake||0,0.22);
        }
        return;
      }
      if(piranhaBoatAvoidance(m,dt,now,speed||spec.speed)) return;
      const prey=piranhaPreyTarget(m,player,getTile,spec.pursueRange||PIRANHA_PREY_RANGE);
      if(prey){
        const point=piranhaTargetPoint(prey);
        const dx=point.x-m.x, dy=point.y-m.y;
        const d=Math.hypot(dx,dy)||1;
        const preyFrenzy=prey.kind!=='hero';
        if(preyFrenzy) m._frenzy=Math.max(m._frenzy||0,0.8);
        const sp=(speed||spec.speed) * (preyFrenzy?1.18:1.25);
        m.vx += (dx/d)*sp*(preyFrenzy?0.92:1.05)*dt*7.5;
        m.vy += (dy/d)*sp*(preyFrenzy?0.66:0.76)*dt*5.8;
        m.facing=dx>=0?1:-1;
        if(getTile){
          const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
          if(col){
            const want=Math.max(0,Math.min(col.depth-1,Math.round((point.y-col.top)-0.1)));
            m.desiredDepth=Math.min(2,want);
          }
        }
        return;
      }
      const protectedHero=heroProtectedByBoat(player);
      const wetHero=heroInSeaWater(player,getTile);
      if(wetHero) m._frenzy = Math.max(m._frenzy||0, 1.15);
      else if(m._frenzy>0) m._frenzy=Math.max(0,m._frenzy-dt);
      const frenzy = wetHero || (m._frenzy>0);
      const dx=player.x-m.x, dy=(player.y+0.12)-m.y;
      const d=Math.hypot(dx,dy)||1;
      if(!protectedHero && wetHero){
        const sp=(speed||spec.speed) * (frenzy?1.25:1.0);
        m.vx += (dx/d)*sp*(frenzy?1.05:0.62)*dt*7.5;
        m.vy += (dy/d)*sp*(frenzy?0.76:0.46)*dt*5.8;
        m.facing=dx>=0?1:-1;
        if(frenzy && getTile){
          const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
          if(col){
            const want=Math.max(0,Math.min(col.depth-1, Math.round((player.y-col.top)-0.1)));
            m.desiredDepth=Math.min(2,want);
          }
        }
      } else {
        const mate=nearestSameSpecies(m,5);
        if(mate){
          m.vx+=(mate.x-m.x)*0.025;
          m.vy+=(mate.y-m.y)*0.018;
        }
        if(Math.random()<0.035){
          const ang=Math.random()*Math.PI*2;
          m.vx += Math.cos(ang)*(speed||spec.speed)*0.22;
          m.vy += Math.sin(ang)*(speed||spec.speed)*0.12;
        }
      }
    }
  });

  registerSpecies({ // Atlantis meduza: fast strict-water guardian around ocean-floor cities
    id:'ATLANTIS_MEDUZA', displayName:'Atlantis meduza',
    max:18, localMax:5, spawnBatch:2, spawnChance:0.78,
    hp:28, dmg:12, speed:5.4, wanderInterval:[0.7,1.8], aquatic:true, strictWater:true, alwaysAggro:true, xp:38,
    sightRange:22, pursueRange:30, body:{w:1.05,h:1.25},
    contactInvulMs:420, contactKnockback:0.9, contactKnockbackY:-0.18, contactCause:'atlantis_meduza',
    biome:'sea', piranhaIgnore:true, meat:false,
    variant:{shift:3, from:'#55d7ff', to:'#c47bff'},
    loot:[{item:'glowshroom', min:1, max:2, chance:0.58}, {item:'glass', min:1, max:3, chance:0.45}, {item:'iridium', min:1, max:1, chance:0.08}],
    spawnTest(x,y,getTile){ return canHostAtlantisMeduzaSpawn(x,y,getTile); },
    onCreate(m, spec, getTile){
      initWaterAnchor(m,getTile);
      const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
      if(col) m.desiredDepth=Math.max(2,Math.min(col.depth-2,3+Math.floor(Math.random()*4)));
      m.speedMul=Math.max(m.speedMul||1,0.92+Math.random()*0.26);
      m._meduzaPulse=0;
    },
    habitatUpdate(m, spec, getTile, dt){ enforceAquatic(m, spec, getTile, dt); },
    onUpdate(m,spec,{player,dt,getTile,speed}){
      const target=player;
      const targetWet=target && target.kind ? piranhaExternalTargetInWater(target,getTile) : heroInSeaWater(target,getTile);
      if(targetWet){
        const point=target.kind ? piranhaTargetPoint(target) : {x:target.x,y:target.y+0.08};
        const dx=point.x-m.x, dy=point.y-m.y;
        const d=Math.hypot(dx,dy)||1;
        const sp=(speed||spec.speed) * (d<2.4 ? 0.85 : 1.12);
        m.vx += (dx/d)*sp*dt*5.8;
        m.vy += (dy/d)*sp*dt*4.8;
        m.facing=dx>=0?1:-1;
        if(getTile){
          const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
          if(col) m.desiredDepth=Math.max(1,Math.min(col.depth-1,Math.round((point.y-col.top)-0.2)));
        }
        return;
      }
      if(getTile && !nearAtlantisStructure(Math.floor(m.x),Math.floor(m.y),getTile)){
        const home=nearestAtlantisWaterCell(Math.floor(m.x),Math.floor(m.y),getTile,13,8);
        if(home){
          m.vx += (home.x-m.x)*dt*2.8;
          m.vy += (home.y-m.y)*dt*2.1;
          m.facing=home.x>=m.x?1:-1;
          return;
        }
      }
      m._meduzaPulse=(m._meduzaPulse||0)+dt;
      if(Math.random()<0.045 || m._meduzaPulse>1.2){
        m._meduzaPulse=0;
        const ang=Math.random()*Math.PI*2;
        m.vx += Math.cos(ang)*(speed||spec.speed)*0.20;
        m.vy += Math.sin(ang)*(speed||spec.speed)*0.16;
      }
    }
  });

  registerSpecies({ // Deep eel: slower but agile vertical
    id:'EEL', displayName:'Electric eel',
    max:10, hp:10, dmg:7, speed:2.8, wanderInterval:[1.5,4], aquatic:true, alwaysAggro:true, xp:14,
    sightRange: 14, pursueRange: 18,
    contactInvulMs:380, contactKnockback:1.15, contactKnockbackY:-0.25, contactCause:'eel_shock',
    body:{w:1.2,h:0.35},
    loot:[{item:'stone', min:1, max:1, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.WATER) return false; let stone=false; for(let d=2; d<=5; d++){ const t=getTile(x,y+d); if(isRockFloor(t)){ stone=true; break; } if(t!==T.WATER) break; } if(!stone) return false; return true; },
    onCreate(m, spec, getTile){ initWaterAnchor(m,getTile); m.desiredDepth = 3; },
    habitatUpdate(m,spec,getTile,dt){ enforceAquatic(m,spec,getTile,dt); },
    onUpdate(m,spec,{dt}){ // gentle sinusoidal slither
      m.vy += Math.sin(performance.now()*0.004 + m.spawnT*0.002)*0.02; }
  });

  registerSpecies({
    id:'LAKE_SERPENT', displayName:'Lake serpent',
    max:6, localMax:2, spawnChance:0.54,
    hp:42, dmg:15, speed:4.4, wanderInterval:[1.1,2.8], aquatic:true, strictWater:true, alwaysAggro:true, xp:56,
    sightRange:24, pursueRange:32,
    body:{w:2.1,h:0.48},
    contactInvulMs:420, contactKnockback:1.6, contactKnockbackY:-0.55, contactCause:'lake_serpent_bite',
    variant:{shift:3, from:'#3b9d8e', to:'#6ae0d2'},
    loot:[{item:'fish', min:1, max:3, chance:0.74}, {item:'iridium', min:1, max:1, chance:0.08}, {item:'diamond', min:1, max:1, chance:0.10}],
    spawnTest(x,y,getTile){ return canHostLakeSerpentSpawn(x,y,getTile); },
    onCreate(m,spec,getTile){
      initWaterAnchor(m,getTile);
      const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
      if(col) m.desiredDepth=Math.max(1,Math.min(col.depth-2,2+Math.floor(Math.random()*3)));
      m.scale=1.00+Math.random()*0.16;
      m.speedMul=Math.max(m.speedMul||1,0.92+Math.random()*0.24);
      m._lakeCharge=0;
      m._nextShockAt=performance.now()+600+Math.random()*1000;
    },
    habitatUpdate(m,spec,getTile,dt){ enforceAquatic(m,spec,getTile,dt); },
    onUpdate(m,spec,{player,dt,getTile,speed,now}){
      const wetHero=heroInLakeWater(player,getTile);
      const dx=player.x-m.x, dy=(player.y+0.08)-m.y;
      const dist=Math.hypot(dx,dy)||1;
      if(wetHero){
        markHeroAttack(m);
        m.state='charged';
        m._lakeCharge=Math.min(1.35,(m._lakeCharge||0)+dt*LAKE_SERPENT_CHARGE_RATE*(dist<9?1.16:0.72));
        const sp=(speed||spec.speed)*(1+Math.min(0.55,m._lakeCharge*0.28));
        m.vx += (dx/dist)*sp*dt*(dist<2.5?3.2:6.2);
        m.vy += (dy/dist)*sp*dt*(dist<2.5?2.4:4.6);
        m.facing=dx>=0?1:-1;
        if(getTile){
          const col=waterColumnAt(Math.floor(m.x),Math.floor(m.y),getTile);
          if(col) m.desiredDepth=Math.max(0,Math.min(col.depth-1,Math.round((player.y-col.top)-0.1)));
        }
        if(dist<LAKE_SERPENT_SHOCK_RANGE && now>(m._nextShockAt||0) && (m._lakeCharge>=0.56 || dist<1.45)){
          const charge=Math.max(0.56,Math.min(1.35,m._lakeCharge||0.56));
          markMobAttack(m,'lake_serpent_shock',{target:player,power:1.45,strikeMs:420});
          damagePlayer((spec.dmg||12)*(1+charge*0.38)*(m.dmgMult||1),m.x,m.y,'lake_serpent_shock',spec);
          m._lakeCharge=0;
          m._nextShockAt=now+LAKE_SERPENT_SHOCK_COOLDOWN_MS+Math.random()*900;
          m.shake=Math.max(m.shake||0,0.8);
          try{ if(MM.water && MM.water.disturb) MM.water.disturb(Math.floor(m.x),260); }catch(e){}
          try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(m.x*(MM.TILE||20),m.y*(MM.TILE||20),'rare',10); }catch(e){}
        }
      } else {
        m.state='patrol';
        m._lakeCharge=Math.max(0,(m._lakeCharge||0)-dt*0.6);
        if(Math.random()<0.035){
          const ang=Math.random()*Math.PI*2;
          m.vx += Math.cos(ang)*(speed||spec.speed)*0.20;
          m.vy += Math.sin(ang)*(speed||spec.speed)*0.14;
        }
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.34?'rare':'common', 0.22);
    }
  });

  registerSpecies({ // Mountain goat: high elevation
    id:'GOAT', max:12, hp:14, dmg:4, speed:3.3, wanderInterval:[1.8,4.2], xp:13, ground:true,
  sightRange: 16, pursueRange: 20,
  move:{jumpVel:-5.2, maxClimb:2.2, avoidWater:true},
  body:{w:1.2,h:1.0},
    loot:[{item:'snow', min:1, max:1, chance:0.3}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); if(!(isRockFloor(below)||below===T.SNOW)) return false; return y < 18; },
    biome:'mountain'
  });

  registerSpecies({
    id:'STONE_GOLEM', displayName:'Stone golem',
    max:6, localMax:2, spawnChance:0.62, hp:54, dmg:14, speed:2.1, wanderInterval:[2.6,5.8], xp:58, ground:true, organic:false,
    sightRange:17, pursueRange:25,
    move:{jumpVel:-4.2, maxClimb:2.2, avoidWater:false},
    body:{w:1.45,h:1.75},
    variant:{shift:3, from:'#6f7379', to:'#3c4148'},
    loot:[{item:'granite', min:2, max:5, chance:0.85}, {item:'basalt', min:1, max:4, chance:0.65}, {item:'obsidian', min:1, max:1, chance:0.26}, {item:'diamond', min:1, max:1, chance:0.16}],
    meat:false,
    spawnTest(x,y,getTile){
      const b=biomeAt(x);
      if(b!==7 && b!==2) return false;
      if(readMobTile(getTile,x,y)!==T.AIR || readMobTile(getTile,x,y-1)!==T.AIR) return false;
      const below=readMobTile(getTile,x,y+1);
      if(!(isRockFloor(below) || below===T.SNOW || below===T.ICE || below===T.GRANITE || below===T.BASALT || below===T.OBSIDIAN)) return false;
      return nearMountainMineral(x,y,getTile) || y<18;
    },
    biome:'mountain',
    onCreate(m,spec,getTile){
      m.scale=1.03+Math.random()*0.16;
      m.speedMul=0.76+Math.random()*0.18;
      m.jumpMul=0.80+Math.random()*0.16;
      m.aimLead=Math.max(m.aimLead||0,0.28+Math.random()*0.18);
      m.state='dormant';
      if(typeof getTile==='function'){
        const floorY=Math.floor(m.y+1);
        if(isSolidGround(readMobTile(getTile,Math.floor(m.x),floorY))){
          const bodyH=((spec.body && spec.body.h) || 1) * (m.scale||1);
          m.y=floorY - bodyH*0.5 - 0.001;
        }
      }
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile}){
      const sp=speed||spec.speed||2;
      if(isMobPacified(m,now)){
        m.vx*=0.45;
        if(m.onGround) m.vy=0;
        return;
      }
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const guarding=nearMountainMineral(Math.floor(m.x),Math.floor(m.y),getTile);
      if(!aggressive && guarding && dist<8.5){
        markMobTelegraph(m,'throw',{target:player,power:0.95,ms:640});
        markHeroAttack(m);
        m.state='waking';
        m.shake=Math.max(m.shake||0,0.6);
      }
      if(aggressive || isHeroFocused(m) || (guarding && dist<7)){
        const dir=dx>=0?1:-1;
        m.state=m.state==='cracked'?'cracked':'charging';
        m.facing=dir;
        if(dist>STONE_GOLEM_ROCK_MIN_RANGE && dist<STONE_GOLEM_ROCK_RANGE && Math.abs(dy)<8 && now>(m._nextGolemRockAt||0)){
          if(shootStoneGolemRock(m,player,STONE_GOLEM_ROCK_SPEED,spec.dmg*0.92)){
            m._nextGolemRockAt=now+STONE_GOLEM_ROCK_COOLDOWN_MS+Math.random()*900;
          }
        }
        m.vx += dir*sp*(dist<4?0.52:0.32)*dt*30;
        if(m.onGround && now>(m._nextGolemLeapAt||0) && Math.abs(dx)>1.7 && Math.abs(dy)<5){
          m.vy=(spec.move.jumpVel||-4)*(m.jumpMul||1);
          m._nextGolemLeapAt=now+1200+Math.random()*900;
        }
      } else if(Math.random()<0.004){
        m.vx += (Math.random()<0.5?-1:1)*0.22;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.22?'rare':'common', 0.28);
    }
  });

  registerSpecies({ // Firefly – ambience (low HP) over grass, pulsating
    id:'FIREFLY', max:26, hp:2, dmg:0, speed:2.0, wanderInterval:[0.6,1.6], xp:2, flying:true,
  sightRange: 10, pursueRange: 12,
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && (below===T.GRASS || isLeaf(below)); },
    biome:'plains',
    onUpdate(m,spec,{dt,now}){ if(Math.random()<0.03){ m.vx += (Math.random()*2-1)*0.4; m.vy += (Math.random()*2-1)*0.2; } }
  });

  registerSpecies({
    id:'JASZCZUR', max:16, hp:6, dmg:2, speed:4.4, wanderInterval:[0.7,2.2], xp:7, ground:true,
    sightRange:10, pursueRange:14,
    move:{jumpVel:-3.2, maxClimb:1, avoidWater:true},
    body:{w:1.0,h:0.45},
    variant:{shift:2, from:'#b98a3a', to:'#d3ad58'},
    loot:[{item:'sand', min:1, max:1, chance:0.5}],
    meatDropChance:0.3,
    spawnTest(x,y,getTile){
      if(biomeAt(x)!==3) return false;
      if(getTile(x,y)!==T.AIR || getTile(x,y-1)!==T.AIR) return false;
      return getTile(x,y+1)===T.SAND;
    },
    biome:'desert',
    onUpdate(m,spec,{player,speed}){
      if(Math.random()<0.018) m.vx += (Math.random()<0.5?-1:1)*(speed||spec.speed)*0.55;
      const dx=player.x-m.x;
      if(Math.abs(dx)<5) m.vx += (dx>0?-1:1)*(speed||spec.speed)*0.35;
    }
  });

  registerSpecies({
    id:'SAND_WORM', displayName:'Sand worm',
    max:7, localMax:2, spawnChance:0.72, hp:46, dmg:24, speed:4.35, wanderInterval:[2.0,4.8], xp:54, ground:true,
    sightRange:18, pursueRange:34,
    move:{jumpVel:-7.2, maxClimb:1, avoidWater:true},
    body:{w:1.85,h:0.92},
    variant:{shift:2, from:'#8d6a34', to:'#c0964b'},
    contactInvulMs:360, contactKnockback:1.65, contactKnockbackY:-0.9, contactCause:'sand_worm_bite',
    loot:[{item:'sand', min:4, max:8, chance:1}, {item:'diamond', min:1, max:1, chance:0.28}, {item:'obsidian', min:1, max:1, chance:0.16}],
    meatDropChance:1,
    spawnTest(x,y,getTile){
      if(biomeAt(x)!==3) return false;
      return sandWormDeepSandAt(x,y,getTile);
    },
    biome:'desert',
    onCreate(m){
      m.state='buried';
      m.scale=1.02+Math.random()*0.18;
      m.speedMul=0.92+Math.random()*0.20;
      m.jumpMul=1.05+Math.random()*0.20;
      m.aimLead=Math.max(m.aimLead||0,0.88+Math.random()*0.16);
      sandWormWakeRadius(m);
    },
    onUpdate(m,spec,{player,dt,now,speed,getTile,setTile,aggressive}){
      const sp=speed||spec.speed||3;
      const bait=nearestSandWormBait(m,getTile,now);
      if(bait){
        const dx=bait.x-m.x, dy=bait.y-m.y;
        const dist=Math.hypot(dx,dy)||1;
        m.state='baited';
        m.facing=dx>=0?1:-1;
        if(dist<1.25){
          if(consumeSandWormBait(bait,getTile,setTile)){
            pacifySandWorm(m,'meat',now);
            try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),m.y*(MM.TILE||20),'common'); }catch(e){}
          }
          return;
        }
        m.vx += (dx/dist)*sp*0.48*dt*30;
        if(m.onGround && now>(m._nextWormJumpAt||0) && Math.abs(dx)>1.4){
          m.vy=(spec.move.jumpVel||-6)*(m.jumpMul||1)*0.72;
          m._nextWormJumpAt=now+900+Math.random()*700;
        }
        return;
      }
      if(isMobPacified(m,now)){
        if(m._pacifiedReason==='water'){
          const sx=finiteCoord(m._pacifySourceX) ? m._pacifySourceX : (player ? player.x : m.x-(m.facing||1));
          const away=(m.x-sx)>=0 ? 1 : -1;
          m.facing=away;
          if(sandWormCanBurrowAt(m,getTile)){
            m.state='buried';
            m.vx*=0.10;
            m.vy=Math.min(m.vy||0,0);
            if(now>(m._waterBurrowFxAt||0)){
              m._waterBurrowFxAt=now+750;
              try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),(m.y+0.35)*(MM.TILE||20),'common'); }catch(e){}
            }
          }else{
            m.state='doused';
            m.vx += away*sp*dt*20;
            if(m.onGround && now>(m._nextWormJumpAt||0)){
              m.vy=(spec.move.jumpVel||-7.2)*(m.jumpMul||1)*0.52;
              m._nextWormJumpAt=now+620+Math.random()*520;
            }
          }
          return;
        }
        m.vx*=0.62;
        if(m.onGround) m.vy=0;
        if(Math.random()<0.012) m.state='buried';
        return;
      }
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const close=sandWormWakeClose(m,player);
      if(m.state==='buried'){
        m.vx*=0.28;
        m.vy=Math.min(m.vy||0,0);
        if(close){
          m.state='ambush';
          m.facing=dx>=0?1:-1;
          markMobTelegraph(m,'bite',{target:player,power:1.25,ms:420});
          m.vx+=(dx/dist)*sp*2.1;
          m.vy=(spec.move.jumpVel||-7.2)*(m.jumpMul||1);
          setAggro(m.id);
          try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20),(m.y+0.35)*(MM.TILE||20),'common'); }catch(e){}
        }
        return;
      }
      if(m.state==='circling'){
        m.vx*=0.12;
        m.vy=Math.min(m.vy||0,0);
        if(now>(m._wormCircleAt||0)){
          if(!sandWormFinishCircle(m,player,getTile,now,sp)) m.state='ambush';
        }
        return;
      }
      if(close || aggressive || dist<SAND_WORM_ALERT_RADIUS) setAggro(m.id);
      const heroMovingAway = Math.sign(player.vx||0)===Math.sign(dx) && Math.abs(player.vx||0)>2.4;
      const canCircle = dist>SAND_WORM_CIRCLE_DIST && dist<SAND_WORM_SPIT_RANGE+8 && now>(m._wormCircleCooldownUntil||0) && sandWormCanBurrowAt(m,getTile);
      if((aggressive || m.state==='ambush') && canCircle && (heroMovingAway || Math.abs(dx)>SAND_WORM_CIRCLE_DIST+2)){
        if(sandWormStartCircle(m,player,now,getTile)) return;
      }
      const airborne=sandWormHeroAirborne(player,getTile);
      if((aggressive || m.state==='ambush') && airborne && dist>SAND_WORM_SPIT_MIN_RANGE && dist<SAND_WORM_SPIT_RANGE && Math.abs(dy)<10 && now>(m._nextWormSpitAt||0)){
        m.facing=dx>=0?1:-1;
        if(shootSandWormSpit(m,player,SAND_WORM_SPIT_SPEED,spec.dmg*0.72)){
          m.state='spit';
          m._nextWormSpitAt=now+SAND_WORM_SPIT_COOLDOWN_MS+Math.random()*900;
        }
      }
      if(aggressive || dist<SAND_WORM_ALERT_RADIUS){
        const dir=dx>=0?1:-1;
        m.facing=dir;
        m.vx += dir*sp*(dist<5?1.05:0.68)*dt*30;
        if(m.onGround && now>(m._nextWormJumpAt||0)){
          m.vy=(spec.move.jumpVel||-7.2)*(m.jumpMul||1)*(dist<5?1.12:0.94);
          m._nextWormJumpAt=now+420+Math.random()*620;
        }
      } else if(m.onGround && Math.random()<0.008){
        m.state='buried';
        m.vx*=0.2;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.16?'rare':'common', 0.32);
    }
  });

  registerSpecies({
    id:'GIANT_SCORPION', displayName:'Giant scorpion',
    max:3, localMax:1, spawnChance:0.075, hp:126, dmg:31, speed:3.95, wanderInterval:[2.2,5.2], xp:155, ground:true,
    sightRange:20, pursueRange:34, alwaysAggro:true,
    move:{jumpVel:-5.7, maxClimb:2, avoidWater:true},
    body:{w:2.35,h:1.10},
    variant:{shift:2, from:'#5c3525', to:'#a35a31'},
    contactInvulMs:520, contactKnockback:2.1, contactKnockbackY:-0.95, contactCause:'giant_scorpion_claw',
    loot:[
      {item:'sand', min:8, max:16, chance:1},
      {item:'obsidian', min:1, max:2, chance:0.42},
      {item:'diamond', min:1, max:1, chance:0.24},
      {item:'alienBiomass', min:1, max:2, chance:0.14}
    ],
    meatDropChance:0.15,
    spawnTest(x,y,getTile){ return giantScorpionSpawnCell(x,y,getTile); },
    biome:'desert',
    onCreate(m){
      m.state='stalking';
      m.scale=1.04+Math.random()*0.16;
      m.speedMul=Math.max(m.speedMul||1,0.96+Math.random()*0.20);
      m.jumpMul=Math.max(m.jumpMul||1,0.98+Math.random()*0.18);
      m._nextScorpionStingAt=performance.now()+900+Math.random()*1400;
      m._nextScorpionLungeAt=performance.now()+700+Math.random()*1100;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile}){
      const sp=speed||spec.speed||3.6;
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const dir=dx>=0?1:-1;
      m.facing=dir;
      if(getTile && readMobTile(getTile,Math.floor(m.x+dir*0.9),Math.floor(m.y+0.55))===T.WATER){
        m.state='retreat';
        m.vx -= dir*sp*dt*20;
        return;
      }
      if(dist<GIANT_SCORPION_STING_RANGE && now>(m._nextScorpionStingAt||0)){
        m.state='sting';
        m.shake=Math.max(m.shake||0,0.55);
        markMobAttack(m,'giant_scorpion_sting',{target:player,power:1.55,strikeMs:460});
        damagePlayer(spec.dmg*0.82*(m.dmgMult||1),m.x+dir*0.55,m.y-0.25,'giant_scorpion_sting',spec);
        m._nextScorpionStingAt=now+GIANT_SCORPION_STING_COOLDOWN_MS+Math.random()*900;
        m._nextScorpionLungeAt=Math.max(m._nextScorpionLungeAt||0,now+650);
        return;
      }
      if((aggressive || dist<spec.sightRange) && dist<9.5 && dist>2.2 && m.onGround && now>(m._nextScorpionLungeAt||0)){
        m.state='lunge';
        markMobTelegraph(m,'sting',{target:player,power:1.20,ms:420});
        m.vx += dir*sp*1.75;
        m.vy=(spec.move.jumpVel||-5.7)*(m.jumpMul||1)*0.66;
        m.shake=Math.max(m.shake||0,0.24);
        m._nextScorpionLungeAt=now+GIANT_SCORPION_LUNGE_COOLDOWN_MS+Math.random()*950;
        return;
      }
      if(aggressive || dist<spec.sightRange){
        m.state=dist<4.2?'menace':'stalking';
        m.vx += dir*sp*(dist<5?0.72:0.44)*dt*30;
        if(m.onGround && now>(m._nextScorpionHopAt||0) && Math.abs(dx)>1.6){
          m.vy=(spec.move.jumpVel||-5.7)*(m.jumpMul||1)*0.38;
          m._nextScorpionHopAt=now+950+Math.random()*1050;
        }
      } else if(m.onGround && Math.random()<0.006){
        m.state='waiting';
        m.vx += (Math.random()<0.5?-1:1)*sp*0.24;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.22?'epic':'rare', 0.34);
      releaseGiantScorpionCommander(m);
    }
  });

  registerSpecies({
    id:'ZABA', max:18, hp:5, dmg:1, speed:3.0, wanderInterval:[0.8,2.0], xp:6, ground:true,
    sightRange:10, pursueRange:14,
    move:{jumpVel:-5.4, maxClimb:1, avoidWater:false},
    body:{w:0.8,h:0.55},
    variant:{shift:3, from:'#3f8f3f', to:'#6bb35a'},
    loot:[{item:'leaf', min:1, max:1, chance:0.35}],
    meatDropChance:0.25,
    spawnTest(x,y,getTile){
      if(biomeAt(x)!==4) return false;
      if(getTile(x,y)!==T.AIR || getTile(x,y-1)!==T.AIR) return false;
      const below=getTile(x,y+1);
      if(below!==T.MUD && below!==T.GRASS && below!==T.SAND) return false;
      for(let dx=-3; dx<=3; dx++){
        if(getTile(x+dx,y+1)===T.WATER || getTile(x+dx,y)===T.WATER) return true;
      }
      return false;
    },
    biome:'swamp',
    onUpdate(m,spec,{now,player,speed}){
      if(!m._nextJumpAt) m._nextJumpAt=0;
      const dx=player.x-m.x;
      if(now>m._nextJumpAt && m.onGround){
        const flee=Math.abs(dx)<5;
        m.vx=(flee ? (dx>0?-1:1) : (Math.random()<0.5?-1:1))*(speed||spec.speed)*(0.45+Math.random()*0.45);
        m.vy=(spec.move.jumpVel||-5)*(0.75+Math.random()*0.35);
        m._nextJumpAt=now+700+Math.random()*900;
      }
    }
  });

  registerSpecies({
    id:'BOG_LURKER', displayName:'Bog lurker',
    max:9, localMax:3, spawnChance:0.68, hp:28, dmg:8, speed:2.85, wanderInterval:[1.6,3.8], xp:38, ground:true,
    sightRange:15, pursueRange:22,
    move:{jumpVel:-4.9, maxClimb:1.4, avoidWater:false},
    body:{w:1.25,h:0.95},
    variant:{shift:3, from:'#384f2f', to:'#607242'},
    contactInvulMs:420, contactKnockback:0.85, contactKnockbackY:-0.65, contactCause:'bog_poison',
    loot:[{item:'clay', min:2, max:5, chance:0.9}, {item:'glowshroom', min:1, max:2, chance:0.42}, {item:'leaf', min:1, max:3, chance:0.52}],
    meat:false,
    spawnTest(x,y,getTile){
      if(biomeAt(x)!==4) return false;
      if(readMobTile(getTile,x,y)!==T.AIR || readMobTile(getTile,x,y-1)!==T.AIR) return false;
      const below=readMobTile(getTile,x,y+1);
      if(!(below===T.MUD || below===T.WET_CLAY || below===T.CLAY || below===T.GRASS)) return false;
      return nearSwampWater(x,y,getTile);
    },
    biome:'swamp',
    onCreate(m){
      m.state='submerged';
      m.scale=0.96+Math.random()*0.16;
      m.speedMul=0.82+Math.random()*0.22;
    },
    onUpdate(m,spec,{player,dt,now,speed,getTile,aggressive}){
      const sp=speed||spec.speed||2.8;
      if(hasStatus(m,'burn') || nearTorch(Math.floor(m.x),Math.floor(m.y),getTile,BOG_LURKER_TORCH_RADIUS)){
        pacifyMob(m,BOG_LURKER_CALM_MS,'fire',now);
        m.state='smoked';
      }
      if(isMobPacified(m,now)){
        m.vx*=0.55;
        if(m.onGround) m.vy=0;
        return;
      }
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const sloppy=heroInMuck(player,getTile);
      if(!aggressive && sloppy && dist<9.5){
        markHeroAttack(m);
        m.state='ambush';
        m.facing=dx>=0?1:-1;
        m.vx+=(dx/dist)*sp*0.95;
        if(m.onGround && now>(m._nextBogLeapAt||0)){
          m.vy=(spec.move.jumpVel||-4.8)*(m.jumpMul||1);
          m._nextBogLeapAt=now+900+Math.random()*650;
        }
      }
      if(aggressive || isHeroFocused(m) || (sloppy && dist<8)){
        const dir=dx>=0?1:-1;
        m.facing=dir;
        m.vx += dir*sp*(dist<4?0.54:0.34)*dt*30;
        if(m.onGround && now>(m._nextBogLeapAt||0) && Math.abs(dx)>1.1){
          m.vy=(spec.move.jumpVel||-4.8)*(m.jumpMul||1)*(dist<4?1:0.75);
          m._nextBogLeapAt=now+750+Math.random()*800;
        }
      } else if(m.onGround && Math.random()<0.007){
        m.state='submerged';
        m.vx*=0.25;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.18?'rare':'common', 0.20);
    }
  });

  registerSpecies({
    id:'TEMPLE_GUARD', displayName:'Temple guard',
    max:12, localMax:4, spawnChance:0.58, spawnBatch:2, hp:30, dmg:9, speed:3.0, wanderInterval:[1.4,3.6], xp:32, ground:true, organic:false,
    sightRange:18, pursueRange:25,
    move:{jumpVel:-4.8, maxClimb:2, avoidWater:false},
    body:{w:0.92,h:1.55},
    variant:{shift:2, from:'#4b7d43', to:'#9a7740'},
    loot:[{item:'wood', min:1, max:3, chance:0.85}, {item:'obsidian', min:1, max:1, chance:0.28}, {item:'diamond', min:1, max:1, chance:0.22}],
    spawnTest(x,y,getTile){
      const b=biomeAt(x);
      if(b!==0 && b!==4) return false;
      if(readMobTile(getTile,x,y)!==T.AIR || readMobTile(getTile,x,y-1)!==T.AIR) return false;
      const below=readMobTile(getTile,x,y+1);
      if(!(below===T.GRASS || below===T.MUD || below===T.STONE || below===T.OBSIDIAN || below===T.WOOD)) return false;
      return nearTempleStructure(x,y,getTile);
    },
    biome:'jungle',
    onCreate(m){
      m.homeX=m.x;
      m.homeY=m.y;
      m.scale=0.96+Math.random()*0.13;
      m.speedMul=0.86+Math.random()*0.20;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile}){
      const sp=speed||spec.speed||3;
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      if(!aggressive){
        const homeX=finiteCoord(m.homeX)?m.homeX:m.x;
        const homeDx=homeX-m.x;
        if(dist<3.1 && nearTempleStructure(Math.floor(m.x),Math.floor(m.y),getTile)){
          m.state='warning';
          m.facing=dx>=0?1:-1;
          m.vx += (dx>=0?-1:1)*sp*0.10*dt*30;
          return;
        }
        m.state='patrol';
        if(Math.abs(homeDx)>4) m.vx += Math.sign(homeDx)*sp*0.20*dt*30;
        else if(now>(m._nextGuardPaceAt||0)){
          m._nextGuardPaceAt=now+900+Math.random()*1600;
          m.vx += (Math.random()<0.5?-1:1)*sp*0.24;
        }
        m.facing=(Math.abs(homeDx)>0.4?homeDx:m.vx)>=0?1:-1;
        return;
      }
      if((m.state==='relic_alarm' || m.state==='structure_alarm') && finiteCoord(m.templeAlarmX) && dist>1.4 && Math.hypot((m.templeAlarmX||m.x)-m.x,(m.templeAlarmY||m.y)-m.y)>1.4){
        const ax=m.templeAlarmX-m.x, ay=(m.templeAlarmY||m.y)-m.y;
        const ad=Math.hypot(ax,ay)||1;
        m.vx += (ax/ad)*sp*0.12*dt*30;
      }
      const dir=dx>=0?1:-1;
      m.facing=dir;
      if(dist>1.2) m.vx += dir*sp*(dist<4?0.62:0.38)*dt*30;
      else m.vx*=0.55;
      if(m.onGround && now>(m._nextGuardLeapAt||0) && Math.abs(dx)>1.4 && Math.abs(dy)<5){
        m.vy=(spec.move.jumpVel||-4.6)*(m.jumpMul||1);
        m._nextGuardLeapAt=now+850+Math.random()*650;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.12?'epic':'rare', 0.22);
    }
  });

  registerSpecies({
    id:'WIOSENNY_JELEN', displayName:'Wiosenny jelen', season:'spring',
    max:3, localMax:1, spawnChance:0.72, hp:34, dmg:7, speed:3.55, wanderInterval:[1.8,4.2], xp:34, ground:true,
    sightRange:18, pursueRange:26,
    move:{jumpVel:-4.5, maxClimb:2, avoidWater:true},
    body:{w:1.9,h:1.65},
    variant:{shift:2, from:'#b88747', to:'#d19b58'},
    loot:[{item:'springAntler', min:1, max:1, chance:1}, {item:'leaf', min:2, max:4, chance:1}, {item:'wood', min:1, max:2, chance:0.45}],
    meatDropChance:0.75,
    spawnTest(x,y,getTile){
      if(!seasonActive('spring')) return false;
      const b=biomeAt(x);
      if(b!==0 && b!==1) return false;
      return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:3,floor:t=>t===T.GRASS || isLeaf(t) || t===T.WOOD});
    },
    biome:'forest',
    onCreate(m){ m.scale=1.03+Math.random()*0.16; m.speedMul=0.86+Math.random()*0.18; m.jumpMul=0.95+Math.random()*0.16; },
    onUpdate(m,spec,{player,dt,speed,getTile}){
      const dx=player.x-m.x, adx=Math.abs(dx);
      if(getTile) springBlessNearbyGrowth(m,getTile);
      if(adx<8){ const dir=dx>0?-1:1; m.vx += dir*(speed||spec.speed)*0.45*dt*30; m.facing=dir; if(m.onGround && Math.random()<0.03) m.vy=(spec.move.jumpVel||-4)*0.9; }
      else if(Math.random()<0.008){ m.vx += (Math.random()<0.5?-1:1)*(speed||spec.speed)*0.28; }
    }
  });

  registerSpecies({
    id:'LETNI_ZUBR', displayName:'Letni zubr', season:'summer',
    max:4, localMax:2, spawnBatch:2, spawnChance:0.78, hp:52, dmg:13, speed:2.85, wanderInterval:[2.2,5.4], xp:46, ground:true,
    sightRange:16, pursueRange:24,
    move:{jumpVel:-3.0, maxClimb:1, avoidWater:true},
    body:{w:2.35,h:1.55},
    variant:{shift:4, from:'#7d5430', to:'#a06a32'},
    loot:[{item:'summerHorn', min:1, max:1, chance:1}, {item:'grass', min:2, max:5, chance:1}, {item:'wood', min:1, max:2, chance:0.25}],
    meatDropChance:1,
    spawnTest(x,y,getTile){
      if(!seasonActive('summer')) return false;
      const b=biomeAt(x);
      if(b!==1 && b!==3) return false;
      return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:3,floor:t=>t===T.GRASS || t===T.SAND});
    },
    biome:'plains',
    onCreate(m){ m.scale=1.10+Math.random()*0.18; m.speedMul=0.78+Math.random()*0.16; m.jumpMul=0.72+Math.random()*0.12; },
    onUpdate(m,spec,{player,dt,speed}){
      const dx=player.x-m.x, adx=Math.abs(dx)||1;
      const herd=nearestSameSpecies(m,10);
      if(herd && adx>=8){
        const gap=herd.x-m.x;
        m.vx += Math.sign(gap||m.facing)*(speed||spec.speed)*0.08*dt*30;
      }
      if(adx<6){
        const dir=dx>0?1:-1;
        m.vx += dir*(speed||spec.speed)*0.55*dt*30;
        m.facing=dir;
        setAggro(m.id);
      } else if(adx<13){
        const dir=dx>0?-1:1;
        m.vx += dir*(speed||spec.speed)*0.16*dt*30;
        m.facing=dir;
      }
      if(Math.random()<0.004) m.vx += (Math.random()<0.5?-1:1)*0.5;
    }
  });

  registerSpecies({
    id:'JESIENNY_LOS', displayName:'Jesienny los', season:'autumn',
    max:3, localMax:1, spawnChance:0.74, hp:44, dmg:11, speed:3.05, wanderInterval:[2.0,4.8], xp:42, ground:true,
    sightRange:19, pursueRange:26,
    move:{jumpVel:-3.7, maxClimb:1.6, avoidWater:false},
    body:{w:2.05,h:1.85},
    variant:{shift:3, from:'#855c35', to:'#b0783f'},
    loot:[{item:'autumnHeartwood', min:1, max:1, chance:1}, {item:'leaf', min:3, max:6, chance:1}, {item:'wood', min:1, max:2, chance:0.35}],
    meatDropChance:0.85,
    spawnTest(x,y,getTile){
      if(!seasonActive('autumn')) return false;
      const b=biomeAt(x);
      if(b!==0 && b!==4 && b!==1) return false;
      return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:3,floor:t=>t===T.GRASS || t===T.MUD || isLeaf(t)});
    },
    biome:'forest',
    onCreate(m){ m.scale=1.08+Math.random()*0.18; m.speedMul=0.82+Math.random()*0.18; m.jumpMul=0.82+Math.random()*0.14; },
    onUpdate(m,spec,{player,dt,speed,getTile}){
      const dx=player.x-m.x, adx=Math.abs(dx)||1;
      const wind=getTile ? windSpeedAt(m.x,m.y-0.5,getTile) : 0;
      const windCharge=Math.abs(wind)>1.1 && adx<13;
      if(adx<5 || windCharge){
        const dir=dx>0?1:-1;
        m.vx += dir*(speed||spec.speed)*(windCharge?0.58:0.46)*dt*30;
        m.facing=dir;
        setAggro(m.id);
      } else if(Math.random()<0.006) m.vx += (Math.random()<0.5?-1:1)*(speed||spec.speed)*0.24;
    }
  });

  registerSpecies({
    id:'ZIMOWY_NIEDZWIEDZ', displayName:'Zimowy niedzwiedz', season:'winter',
    max:2, localMax:1, spawnChance:0.82, hp:58, dmg:15, speed:2.55, wanderInterval:[2.6,6.0], xp:58, ground:true,
    sightRange:20, pursueRange:30,
    move:{jumpVel:-3.2, maxClimb:1.4, avoidWater:true},
    body:{w:2.2,h:1.55},
    variant:{shift:1, from:'#dfeaf1', to:'#f7fbff'},
    loot:[{item:'winterFur', min:1, max:1, chance:1}, {item:'snow', min:3, max:7, chance:1}],
    meatDropChance:1,
    spawnTest(x,y,getTile){
      if(!seasonActive('winter')) return false;
      const b=biomeAt(x);
      if(b!==2 && b!==7) return false;
      return bigAnimalSpawnCell(x,y,getTile,{halfWidth:1,height:3,floor:t=>t===T.SNOW || t===T.ICE || isRockFloor(t)});
    },
    biome:'snow',
    onCreate(m){ m.scale=1.12+Math.random()*0.16; m.speedMul=0.82+Math.random()*0.15; m.jumpMul=0.78+Math.random()*0.12; },
    onUpdate(m,spec,{player,dt,speed,aggressive,getTile}){
      const dx=player.x-m.x, adx=Math.abs(dx)||1;
      const guarding=getTile ? nearCaveMouth(m,getTile) : false;
      if(guarding && adx<14 && player.y>m.y-3) setAggro(m.id);
      if(aggressive || adx<10 || (guarding && adx<14)){
        const dir=dx>0?1:-1;
        m.vx += dir*(speed||spec.speed)*(guarding?0.40:0.34)*dt*30;
        m.facing=dir;
        if(adx<5) setAggro(m.id);
      } else if(Math.random()<0.005) m.vx += (Math.random()<0.5?-1:1)*0.35;
    }
  });

  // --- Nocturnal hostiles: spawn only after dark, inherently aggressive, and the
  // sunrise sets them alight (burning DoT) so the day stays safe ---
  function cycleIsDay(){
    try{
      const c=MM.background && MM.background.getCycleInfo && MM.background.getCycleInfo();
      return c && typeof c.isDay==='boolean' ? c.isDay : null;
    }catch(e){ return null; }
  }
  function isNight(){ return cycleIsDay()===false; }
  registerSpecies({ // Ghoul: shambling night stalker
    id:'GHOUL', max:8, hp:16, dmg:8, speed:2.6, wanderInterval:[1.5,3.5], xp:20, ground:true,
    sightRange:22, pursueRange:30, alwaysAggro:true, sunriseBurn:{dur:8,dps:6},
    move:{jumpVel:-4.6, maxClimb:2, avoidWater:true},
    body:{w:0.9,h:1.6},
    spawnTest(x,y,getTile){ if(!isNight()) return false; const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); return below===T.GRASS||below===T.SAND||below===T.SNOW||isRockFloor(below)||below===T.MUD; },
    biome:'any',
    // habitatUpdate runs AFTER the default chase AI (onUpdate would replace it)
    habitatUpdate(m){ if(!isNight()) applyStatus(m,'burn',{dur:2.5,dps:4}); }
  });
  registerSpecies({ // Night bat: erratic flying biter
    id:'BAT', max:10, hp:6, dmg:5, speed:3.6, wanderInterval:[0.8,2.0], xp:10, flying:true,
    sightRange:20, pursueRange:26, alwaysAggro:true,
    body:{w:0.7,h:0.45}, collideTerrain:true, sunriseBurn:{dur:6,dps:6},
    spawnTest(x,y,getTile){ if(!isNight()) return false; const here=getTile(x,y); const above=getTile(x,y-1); return here===T.AIR && above===T.AIR; },
    biome:'any',
    habitatUpdate(m){ if(Math.random()<0.06){ m.vx+=(Math.random()*2-1)*1.5; m.vy+=(Math.random()*2-1)*1.0; } if(!isNight()) applyStatus(m,'burn',{dur:2,dps:4}); }
  });

  // --- Mob projectiles: lobbed shards that arc, shatter on terrain, hurt the hero ---
  const mobProjectiles=[]; const MOB_PROJ_CAP=40;
  const mobLasers=[]; const MOB_LASER_CAP=18;
  const mobDeathFx=[]; const MOB_DEATH_FX_CAP=44;
  const MOB_DEATH_PHYSICS_FRAME_BUDGET=96;
  const MOB_DEATH_PHYSICS_MAX_STEPS=4;
  const MOB_DEATH_PHYSICS_MAX_DT=0.05;
  let lastDeathFxGetTile=null;
  const SENTINEL_VOLLEY_WINDOW_MS=450;
  const SENTINEL_VOLLEY_SHOT_CAP=3;
  const SENTINEL_RELOAD_SECONDS=3;
  const SENTINEL_BURST_MIN=3;
  const SENTINEL_BURST_MAX=5;
  const SENTINEL_MEAT_SCAN_MS=180;
  const SENTINEL_MEAT_RANGE=12;
  let laserTraceCalls=0, laserTileChecks=0;
  let sentinelVolleyStart=0, sentinelVolleyShots=0;
  let sentinelShotsThisFrame=0, sentinelDeferredThisFrame=0;
  let sentinelMeatShots=0, sentinelMeatCooked=0, sentinelMeatDestroyed=0, sentinelReloads=0;
  function mobThreatTier(hostility){
    const h=Math.max(0, Number(hostility)||0);
    if(h>=2.25) return 4;
    if(h>=1.45) return 3;
    if(h>=0.75) return 2;
    if(h>=0.25) return 1;
    return 0;
  }
  function mobThreatProfile(spec,x,hOpt){
    const h=hOpt || mobHostilityAt(x);
    const hostility=Math.max(0, Number(h.hostility)||0);
    const organic=!(spec && spec.organic===false);
    const tier=mobThreatTier(hostility);
    return {
      h,
      hostility,
      side:h.side || 'center',
      tier,
      scaleMult: spec && spec.id==='ZLOTY' ? 1 : Math.min(organic ? 1.46 : 1.30, 1 + hostility*(organic?0.13:0.08)),
      speedAccent: spec && spec.id==='ZLOTY' ? 1 : Math.min(1.18, 1 + hostility*(organic?0.045:0.035)),
      jumpMult: spec && spec.id==='ZLOTY' ? 1 : Math.min(1.42, 1 + hostility*(organic?0.16:0.08)),
      reactionMult: Math.min(1.85, 1 + hostility*(organic?0.22:0.16)),
      attackCdMult: Math.max(0.58, 1 - hostility*(organic?0.115:0.085)),
      projectileSpeedMult: Math.min(1.32, 1 + hostility*0.08),
      aimLead: Math.min(1.05, Math.max(0, hostility*0.72)),
      aimError: Math.max(0.025, 0.16 - hostility*0.05)
    };
  }
  function targetAimBase(target, yOffset){
    if(!target) return {x:0,y:0};
    if(target.kind==='meat') return {x:target.x,y:target.y};
    if(isInvasionTarget(target)) return {x:target.x, y:target.aimY==null ? target.y+(yOffset==null?-0.42:yOffset) : target.aimY};
    if(target.kind==='companion') return {x:target.x, y:target.aimY==null ? target.y+(yOffset==null?-0.42:yOffset) : target.aimY};
    return {x:target.x, y:target.y+(yOffset==null?-0.3:yOffset)};
  }
  function predictiveAimPoint(m,target,speed,yOffset,opts){
    const base=targetAimBase(target,yOffset);
    if(!m || !target || target.kind==='meat') return base;
    const lead=Math.max(0, Math.min(1.15, Number(m.aimLead)||0));
    if(lead<=0.001) return base;
    const dx=base.x-m.x, dy=base.y-m.y;
    const dist=Math.hypot(dx,dy)||1;
    const travel=Math.min(1.45, dist/Math.max(0.1, speed||8));
    const vx=finiteNum(target.vx) ? target.vx : 0;
    const vy=finiteNum(target.vy) ? target.vy : 0;
    const error=(Number(m.aimError)||0) * (opts && opts.laser ? 0.38 : 1) * Math.max(0,1-lead*0.65);
    return {
      x:base.x + vx*travel*lead + (Math.random()-0.5)*error,
      y:base.y + vy*travel*lead*0.55 + (Math.random()-0.5)*error*0.7
    };
  }
  function hostilityAccentColor(m){
    if(!m || !m.hostilityTier) return null;
    if(m.hostilitySide==='cold') return '#bde8ff';
    if(m.hostilitySide==='hot') return '#ffb05a';
    return '#d8ff9a';
  }
  function tintMobColorForThreat(color,m){
    if(!color || !m || !(m.hostility>0.12)) return color;
    const accent=hostilityAccentColor(m);
    if(!accent) return color;
    return mixHexColor(color,accent,Math.min(0.34,0.08+m.hostility*0.10));
  }
  function shootAt(m, target, speed, dmg){
    if(mobProjectiles.length>=MOB_PROJ_CAP) return false;
    const shotSpeed=speed * ((m && m.projectileSpeedMult) || 1);
    const aim=predictiveAimPoint(m,target,shotSpeed,-0.3);
    const dx=aim.x-m.x, dy=aim.y-m.y;
    const d=Math.hypot(dx,dy)||1;
    mobProjectiles.push({x:m.x, y:m.y-0.4, vx:dx/d*shotSpeed, vy:dy/d*shotSpeed-1.4, dmg:dmg*(m.dmgMult||1), t:0, spin:Math.random()*6.28, lead:m.aimLead||0});
    markMobAttack(m,'throw',{target,power:0.9});
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function laserBlocked(t){ return t!==T.AIR && t!==T.WATER && isSolid(t); }
  function sentinelEyeOrigins(m, dirOverride){
    const dir=(typeof dirOverride==='number' ? dirOverride : m.facing)>=0?1:-1;
    const headX=m.x+dir*0.22;
    const y=m.y-0.62;
    return [
      {x:headX, y:y-0.045},
      {x:headX-dir*0.16, y:y+0.045}
    ];
  }
  function sentinelAimPoint(target,m){
    return predictiveAimPoint(m,target,24,-0.42,{laser:true});
  }
  function traceLaser(sx,sy,tx,ty,getTile,maxDist){
    laserTraceCalls++;
    const dx=tx-sx, dy=ty-sy;
    const len=Math.hypot(dx,dy)||1;
    const dist=Math.min(maxDist||16, len);
    const nx=dx/len, ny=dy/len;
    let endX=sx+nx*dist, endY=sy+ny*dist, blocked=false;
    if(getTile){
      for(let d=0.35; d<=dist; d+=0.22){
        const x=sx+nx*d, y=sy+ny*d;
        laserTileChecks++;
        if(laserBlocked(getTile(Math.floor(x),Math.floor(y)))){
          endX=sx+nx*Math.max(0,d-0.08);
          endY=sy+ny*Math.max(0,d-0.08);
          blocked=true;
          break;
        }
      }
    }
    return {x:endX,y:endY,blocked,clear:!blocked && Math.hypot(tx-endX,ty-endY)<0.8};
  }
  function sentinelShotLines(m,target,getTile,maxDist,dirOverride){
    if(!m || !target) return [];
    const aim=sentinelAimPoint(target,m);
    const tileReader = (target.kind==='meat' && typeof getTile==='function')
      ? ((x,y)=> (x===target.tx && y===target.ty) ? T.AIR : getTile(x,y))
      : getTile;
    return sentinelEyeOrigins(m,dirOverride).map(o=>({
      origin:o,
      end:traceLaser(o.x,o.y,aim.x,aim.y,tileReader,maxDist||16)
    }));
  }
  function sentinelVisionLines(m,target,getTile,maxDist,now,dirOverride){
    if(!m || !target || typeof getTile!=='function') return [];
    const aim=sentinelAimPoint(target,m);
    const dir=(typeof dirOverride==='number' ? dirOverride : m.facing)>=0?1:-1;
    const t=(typeof now==='number' && isFinite(now)) ? now : performance.now();
    const fresh = m._sentinelLosAt && (t-m._sentinelLosAt)<110
      && m._sentinelLosDir===dir
      && Math.abs((m._sentinelLosX||0)-m.x)<0.12
      && Math.abs((m._sentinelLosY||0)-m.y)<0.12
      && Math.abs((m._sentinelLosAimX||0)-aim.x)<0.25
      && Math.abs((m._sentinelLosAimY||0)-aim.y)<0.25
      && Math.abs((m._sentinelLosMax||0)-(maxDist||16))<0.1;
    if(fresh && Array.isArray(m._sentinelLosLines)){
      m._sentinelLosFresh = false;
      return m._sentinelLosLines;
    }
    const lines=sentinelShotLines(m,target,getTile,maxDist,dir);
    m._sentinelLosAt=t;
    m._sentinelLosAimX=aim.x;
    m._sentinelLosAimY=aim.y;
    m._sentinelLosX=m.x;
    m._sentinelLosY=m.y;
    m._sentinelLosDir=dir;
    m._sentinelLosMax=maxDist||16;
    m._sentinelLosLines=lines;
    m._sentinelLosClear=lines.some(l=>l.end && l.end.clear);
    m._sentinelLosFresh=true;
    return lines;
  }
  function sentinelReloadSeconds(m){
    return SENTINEL_RELOAD_SECONDS * Math.max(0.62, Math.min(1, m && m.attackCdMult || 1));
  }
  function sentinelBurstBudget(m){
    const bonus=Math.max(0, Math.min(2, Math.floor((m && m.hostilityTier || 0)/2)));
    return SENTINEL_BURST_MIN + bonus + Math.floor(Math.random()*(SENTINEL_BURST_MAX-SENTINEL_BURST_MIN+1));
  }
  function sentinelShotReady(m,dt){
    if(!m) return false;
    if(m.sentinelReloadT>0){
      m.sentinelReloadT=Math.max(0,m.sentinelReloadT-dt);
      m.vx*=0.55;
      return false;
    }
    if(!finiteNum(m.sentinelShotsUntilReload) || m.sentinelShotsUntilReload<=0) m.sentinelShotsUntilReload=sentinelBurstBudget(m);
    return true;
  }
  function sentinelRecordShot(m){
    if(!m) return;
    if(!finiteNum(m.sentinelShotsUntilReload) || m.sentinelShotsUntilReload<=0) m.sentinelShotsUntilReload=sentinelBurstBudget(m);
    m.sentinelShotsUntilReload--;
    if(m.sentinelShotsUntilReload<=0){
      m.sentinelReloadT=sentinelReloadSeconds(m);
      m.sentinelShotsUntilReload=sentinelBurstBudget(m);
      sentinelReloads++;
    }
  }
  function isSentinelMeatTile(t){ return t===T.MEAT; }
  function sentinelMeatTargetAt(tx,ty){
    return {kind:'meat', tx, ty, x:tx+0.5, y:ty+0.5};
  }
  function cachedSentinelMeatTarget(m,getTile){
    if(!m || !m._sentinelMeatTarget || typeof getTile!=='function') return null;
    const t=m._sentinelMeatTarget;
    if(isSentinelMeatTile(getTile(t.tx,t.ty))) return sentinelMeatTargetAt(t.tx,t.ty);
    m._sentinelMeatTarget=null;
    return null;
  }
  function findSentinelMeatTarget(m,getTile,now){
    if(!m || typeof getTile!=='function') return null;
    const t=(typeof now==='number' && isFinite(now)) ? now : performance.now();
    if(m._nextSentinelMeatScanAt && t<m._nextSentinelMeatScanAt) return cachedSentinelMeatTarget(m,getTile);
    m._nextSentinelMeatScanAt=t+SENTINEL_MEAT_SCAN_MS;
    const minX=Math.floor(m.x-SENTINEL_MEAT_RANGE);
    const maxX=Math.floor(m.x+SENTINEL_MEAT_RANGE);
    const minY=Math.floor(m.y-6);
    const maxY=Math.floor(m.y+3);
    const candidates=[];
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        if(!isSentinelMeatTile(getTile(x,y))) continue;
        const tx=x+0.5, ty=y+0.5;
        const dx=tx-m.x, dy=ty-m.y;
        const d2=dx*dx+dy*dy;
        if(d2>SENTINEL_MEAT_RANGE*SENTINEL_MEAT_RANGE || Math.abs(dy)>7.5) continue;
        candidates.push({tx:x,ty:y,x:tx,y:ty,d2});
      }
    }
    candidates.sort((a,b)=>a.d2-b.d2);
    for(const c of candidates.slice(0,5)){
      const target=sentinelMeatTargetAt(c.tx,c.ty);
      const dir=target.x>=m.x?1:-1;
      const lines=sentinelShotLines(m,target,getTile,SENTINEL_MEAT_RANGE,dir);
      if(lines.some(l=>l.end && l.end.clear)){
        m._sentinelMeatTarget={tx:c.tx,ty:c.ty};
        target.lines=lines;
        target.dir=dir;
        return target;
      }
    }
    m._sentinelMeatTarget=null;
    return null;
  }
  function applySentinelMeatLaser(target,getTile,setTile){
    if(!target || target.kind!=='meat' || typeof getTile!=='function' || typeof setTile!=='function') return false;
    if(!isSentinelMeatTile(getTile(target.tx,target.ty))) return false;
    sentinelMeatShots++;
    if(Math.random()<0.10){
      setTile(target.tx,target.ty,T.AIR);
      sentinelMeatDestroyed++;
    } else {
      setTile(target.tx,target.ty,T.BAKED_MEAT);
      sentinelMeatCooked++;
    }
    return true;
  }
  function sentinelLaserAt(m,target,dmg,getTile,setTile,lines){
    if(!m || !target || mobLasers.length>=MOB_LASER_CAP-1) return false;
    if(target.kind==='meat' && (!isSentinelMeatTile(getTile(target.tx,target.ty)) || typeof setTile!=='function')) return false;
    const shotLines=Array.isArray(lines) ? lines : sentinelShotLines(m,target,getTile,16);
    const clearLines=shotLines.filter(l=>l && l.end && l.end.clear);
    if(!clearLines.length) return false;
    const impacts=[];
    markMobAttack(m,'laser',{target,power:1.1,strikeMs:300});
    for(const line of clearLines){
      const o=line.origin, end=line.end;
      if(!o || !end) continue;
      impacts.push(end);
      mobLasers.push({
        x1:o.x, y1:o.y, x2:end.x, y2:end.y,
        t:0, life:0.18, hit:end.clear, blocked:end.blocked,
        phase:Math.random()*Math.PI*2
      });
    }
    if(target.kind==='meat') applySentinelMeatLaser(target,getTile,setTile);
    else if(isInvasionTarget(target)) damageAlienTarget(target,dmg*(m.dmgMult||1),m.x,m.y-0.6,'sentinel');
    else if(target.kind==='companion') damageCompanionTarget(target,dmg*(m.dmgMult||1),m.x,m.y-0.6,'sentinel');
    else damagePlayer(dmg*(m.dmgMult||1), m.x, m.y-0.6);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('beam'); }catch(e){}
    try{
      const p=MM.particles;
      if(p){
        const TILE=MM.TILE||20;
        for(const end of impacts){
          if(p.spawnSparks) p.spawnSparks(end.x*TILE, end.y*TILE, end.clear?'rare':'common', end.clear?9:5);
          else if(p.spawnBurst) p.spawnBurst(end.x*TILE, end.y*TILE, end.clear?'rare':'common');
        }
      }
    }catch(e){}
    sentinelRecordShot(m);
    return true;
  }
  function reserveSentinelLaserShot(now){
    const t=(typeof now==='number' && isFinite(now)) ? now : performance.now();
    if(!sentinelVolleyStart || t-sentinelVolleyStart>=SENTINEL_VOLLEY_WINDOW_MS){
      sentinelVolleyStart=t;
      sentinelVolleyShots=0;
    }
    if(sentinelShotsThisFrame>=SENTINEL_VOLLEY_SHOT_CAP || sentinelVolleyShots>=SENTINEL_VOLLEY_SHOT_CAP){
      sentinelDeferredThisFrame++;
      return false;
    }
    sentinelShotsThisFrame++;
    sentinelVolleyShots++;
    return true;
  }
  function updateProjectiles(dt, player, getTile, setTile){
    for(let i=mobProjectiles.length-1;i>=0;i--){
      const pr=mobProjectiles[i];
      pr.t+=dt; pr.vy+=(finiteNum(pr.gravity)?pr.gravity:9)*dt; applyWindToMobProjectile(pr,dt,getTile); pr.x+=pr.vx*dt; pr.y+=pr.vy*dt; pr.spin+=dt*8;
      let dead=pr.t>4;
      if(!dead){
        const cmp=nearestCompanionTarget(pr.x,pr.y,0.75);
        if(cmp && damageCompanionTarget(cmp,pr.dmg,pr.x-pr.vx*0.08,pr.y-pr.vy*0.08,pr.cause||'mob_projectile')) dead=true;
      }
      const hitRadius=finiteNum(pr.radius) ? Math.max(0.35,Math.min(1.2,pr.radius)) : 0.6;
      if(!dead && player && Math.abs(player.x-pr.x)<hitRadius && Math.abs(player.y-pr.y)<hitRadius+0.2){
        damagePlayer(pr.dmg, pr.x, pr.y, pr.cause||'mob_projectile', SPECIES[pr.ownerId]); dead=true;
      }
      if(!dead && getTile){ const tt=getTile(Math.floor(pr.x),Math.floor(pr.y)); if(tt!==T.WATER && isSolid(tt)) dead=true; }
      if(dead){ dragonBreathImpact(pr,getTile,setTile); mobProjectiles.splice(i,1); }
    }
  }
  function updateLasers(dt){
    for(let i=mobLasers.length-1;i>=0;i--){
      const l=mobLasers[i];
      l.t+=dt;
      if(l.t>=l.life) mobLasers.splice(i,1);
    }
  }

  registerSpecies({ // Skeleton archer: keeps its distance, lobs bone shards; haunts the night and the deep
    id:'SZKIELET', max:6, hp:12, dmg:7, speed:2.2, wanderInterval:[2,4], xp:18, ground:true, alwaysAggro:true,
    sightRange:16, pursueRange:22,
    move:{jumpVel:-4.4, maxClimb:2, avoidWater:true},
    body:{w:0.8,h:1.6},
    spawnTest(x,y,getTile){
      const here=getTile(x,y); if(here!==T.AIR) return false;
      const below=getTile(x,y+1);
      if(!(below===T.GRASS||below===T.SAND||below===T.SNOW||isRockFloor(below)||below===T.MUD)) return false;
      if(isNight()) return true;
      try{ const wg=MM.worldGen; if(wg && wg.surfaceHeight) return y>wg.surfaceHeight(x)+8; }catch(e){} // daylight: underground only
      return false;
    },
    biome:'any',
    habitatUpdate(m,spec,getTile,dt){
      const p=m._combatTarget || ((typeof window!=='undefined' && window.player)||null); if(!p) return;
      const dx=p.x-m.x, dy=p.y-m.y, d=Math.hypot(dx,dy);
      m.shootCd=(m.shootCd==null?1.2:m.shootCd)-dt;
      if(d<14 && d>2.5 && m.shootCd<=0 && Math.abs(dy)<8){ shootAt(m,p,9,spec.dmg); m.shootCd=(1.6+Math.random()*0.8)*((m && m.attackCdMult)||1); }
      if(d<4) m.vx-=Math.sign(dx)*0.2; // archers back off from melee range
    }
  });
  registerSpecies({ // Cave crawler: fast skittering ambusher of the deep
    id:'PELZACZ', max:8, hp:10, dmg:6, speed:4.2, wanderInterval:[0.8,2.0], xp:14, ground:true, alwaysAggro:true,
    sightRange:12, pursueRange:18,
    move:{jumpVel:-5.0, maxClimb:2.4, avoidWater:true},
    body:{w:1.0,h:0.7},
    spawnTest(x,y,getTile){
      const here=getTile(x,y); if(here!==T.AIR) return false;
      const below=getTile(x,y+1); if(!(isRockFloor(below)||below===T.SAND)) return false;
      // crawlers are creatures of the dark: torch-lit galleries stay safe
      try{ const light=MM.lighting; if(light && light.lightAt && light.lightAt(x,y)>0.25) return false; }catch(e){}
      try{ const wg=MM.worldGen; if(wg && wg.surfaceHeight) return y>wg.surfaceHeight(x)+10; }catch(e){} // caves only
      return false;
    },
    biome:'any'
  });

  registerSpecies({
    id:'GOLD_DRAGON', displayName:'Gold dragon',
    max:2, localMax:1, spawnChance:0, hp:210, dmg:38, speed:2.95, wanderInterval:[2.2,5.0], xp:285, ground:true, alwaysAggro:true,
    sightRange:24, pursueRange:40,
    move:{jumpVel:-4.8, maxClimb:2.2, avoidWater:true},
    body:{w:3.35,h:2.35},
    variant:{shift:2, from:'#8b5a2d', to:'#d0913b'},
    contactInvulMs:640, contactKnockback:2.75, contactKnockbackY:-1.18, contactCause:'gold_dragon_claw',
    loot:[
      {item:'gold', min:10, max:22, chance:1},
      {item:'diamond', min:1, max:3, chance:0.46},
      {item:'obsidian', min:2, max:6, chance:0.64},
      {item:'coal', min:4, max:10, chance:0.72}
    ],
    meat:false,
    spawnTest(x,y,getTile){ return goldDragonSpawnCell(x,y,getTile); },
    biome:'any',
    onCreate(m,spec,getTile){
      m.state='hoard';
      m.scale=1.02+Math.random()*0.12;
      m.speedMul=Math.max(m.speedMul||1,0.76+Math.random()*0.16);
      m.jumpMul=Math.max(m.jumpMul||1,0.82+Math.random()*0.16);
      m.aimLead=Math.max(m.aimLead||0,0.52+Math.random()*0.20);
      m._nextDragonBreathAt=performance.now()+900+Math.random()*1100;
      m._nextDragonGasAt=performance.now()+450+Math.random()*1400;
      m._nextDragonBiteAt=performance.now()+700+Math.random()*1000;
      if(!finiteCoord(m.guardGoldX) && typeof getTile==='function'){
        const cx=Math.floor(m.x), cy=Math.floor(m.y);
        let best=null, bd=Infinity;
        for(let dy=-GOLD_GUARD_CLUSTER_RY; dy<=GOLD_GUARD_CLUSTER_RY; dy++){
          for(let dx=-GOLD_GUARD_CLUSTER_RX; dx<=GOLD_GUARD_CLUSTER_RX; dx++){
            const gx=cx+dx, gy=cy+dy;
            if(readMobTile(getTile,gx,gy)!==T.GOLD_ORE) continue;
            const d2=dx*dx+dy*dy;
            if(d2<bd){ best={x:gx+0.5,y:gy+0.5,key:goldGuardKeyFor(gx,gy)}; bd=d2; }
          }
        }
        if(best){
          m.guardGoldX=best.x;
          m.guardGoldY=best.y;
          m.goldGuardKey=best.key;
        }
      }
      m.homeX=finiteCoord(m.homeX)?m.homeX:m.x;
      m.homeY=finiteCoord(m.homeY)?m.homeY:m.y;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,getTile,setTile,distToPlayer}){
      const sp=speed||spec.speed||3;
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const dir=dx>=0?1:-1;
      const homeX=finiteCoord(m.guardGoldX)?m.guardGoldX:(finiteCoord(m.homeX)?m.homeX:m.x);
      const homeY=finiteCoord(m.guardGoldY)?m.guardGoldY:(finiteCoord(m.homeY)?m.homeY:m.y);
      const farHome=Math.hypot(m.x-homeX,m.y-homeY)>18;
      m.facing=dir;
      if(dist<GOLD_DRAGON_BREATH_RANGE+2 || aggressive || distToPlayer<spec.sightRange) setAggro(m.id);
      if(dist>GOLD_DRAGON_BREATH_MIN_RANGE && dist<GOLD_DRAGON_BREATH_RANGE && Math.abs(dy)<8.5 && now>(m._nextDragonBreathAt||0)){
        m.state='breath';
        if(shootGoldDragonBreath(m,player,12.8,spec.dmg*0.76,getTile,setTile)){
          m._nextDragonBreathAt=now+GOLD_DRAGON_BREATH_COOLDOWN_MS*Math.max(0.58,Math.min(1.2,m.attackCdMult||1))+Math.random()*850;
          m._nextDragonGasAt=Math.min(m._nextDragonGasAt||Infinity,now+180);
        }
      } else if((aggressive || dist<10.5) && now>(m._nextDragonGasAt||0)){
        m.state='gas';
        const mouthX=m.x+dir*1.15;
        const mouthY=m.y-0.85;
        addGoldDragonGas(mouthX,mouthY,getTile,setTile,0.74,3);
        addGoldDragonGas(m.x,m.y-0.35,getTile,setTile,0.44,2);
        m._nextDragonGasAt=now+GOLD_DRAGON_GAS_COOLDOWN_MS*Math.max(0.6,Math.min(1.2,m.attackCdMult||1))+Math.random()*1200;
        markMobTelegraph(m,'gold_dragon_fire',{target:player,power:1.15,ms:380});
      }
      if(dist<2.85 && now>(m._nextDragonBiteAt||0)){
        m.state='claw';
        markMobAttack(m,'gold_dragon_claw',{target:player,power:1.85,strikeMs:540});
        damagePlayer(spec.dmg*1.08*(m.dmgMult||1),m.x+dir*0.95,m.y-0.55,'gold_dragon_claw',spec);
        m._nextDragonBiteAt=now+1750*Math.max(0.58,Math.min(1.2,m.attackCdMult||1))+Math.random()*900;
      }
      if(farHome && dist>5){
        const hx=homeX-m.x, hy=homeY-m.y, hd=Math.hypot(hx,hy)||1;
        m.state='return';
        m.facing=hx>=0?1:-1;
        m.vx+=(hx/hd)*sp*0.38*dt*30;
        if(Math.abs(hy)>2.2 && m.onGround) m.vy=(spec.move.jumpVel||-4.8)*(m.jumpMul||1)*0.72;
        return;
      }
      if(aggressive || dist<spec.sightRange){
        m.state=m.state==='breath' || m.state==='gas' || m.state==='claw' ? m.state : 'guarding';
        m.vx += dir*sp*(dist<5?0.46:0.30)*dt*30;
        if(m.onGround && Math.abs(dx)>2.1 && Math.abs(dy)<5 && now>(m._nextDragonStepAt||0)){
          m.vy=(spec.move.jumpVel||-4.8)*(m.jumpMul||1)*0.62;
          m._nextDragonStepAt=now+1200+Math.random()*900;
        }
      } else {
        const hx=(homeX+Math.sin(now*0.0012+m.spawnT)*2.2)-m.x;
        m.vx += Math.max(-1,Math.min(1,hx))*sp*0.10*dt*30;
        if(Math.random()<0.004) m.state='hoard';
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m,'epic',0.52);
    }
  });

  registerSpecies({
    id:'GOLD_DWARF_GUARD', displayName:'Gold dwarf guard',
    max:12, localMax:4, spawnChance:0, hp:76, dmg:22, speed:3.15, wanderInterval:[1.4,3.6], xp:88, ground:true, alwaysAggro:true,
    sightRange:18, pursueRange:30,
    move:{jumpVel:-4.9, maxClimb:2.2, avoidWater:true},
    body:{w:0.95,h:1.28},
    variant:{shift:2, from:'#6d5140', to:'#b57b3c'},
    contactInvulMs:520, contactKnockback:1.65, contactKnockbackY:-0.88, contactCause:'gold_dwarf_axe',
    loot:[
      {item:'gold', min:3, max:8, chance:0.92},
      {item:'coal', min:1, max:4, chance:0.55},
      {item:'steel', min:1, max:2, chance:0.24},
      {item:'diamond', min:1, max:1, chance:0.12}
    ],
    meat:false,
    spawnTest(x,y,getTile){ return goldDwarfSpawnCell(x,y,getTile); },
    biome:'any',
    onCreate(m,spec,getTile){
      m.state='guard';
      m.scale=0.92+Math.random()*0.16;
      m.speedMul=Math.max(m.speedMul||1,0.92+Math.random()*0.18);
      m.jumpMul=Math.max(m.jumpMul||1,0.92+Math.random()*0.18);
      m.aimLead=Math.max(m.aimLead||0,0.32+Math.random()*0.18);
      m._nextDwarfHammerAt=performance.now()+650+Math.random()*900;
      m._nextDwarfPickAt=performance.now()+900+Math.random()*1300;
      if(!finiteCoord(m.guardGoldX) && typeof getTile==='function'){
        const cx=Math.floor(m.x), cy=Math.floor(m.y);
        let best=null, bd=Infinity;
        for(let dy=-GOLD_GUARD_CLUSTER_RY; dy<=GOLD_GUARD_CLUSTER_RY; dy++){
          for(let dx=-GOLD_GUARD_CLUSTER_RX; dx<=GOLD_GUARD_CLUSTER_RX; dx++){
            const gx=cx+dx, gy=cy+dy;
            if(readMobTile(getTile,gx,gy)!==T.GOLD_ORE) continue;
            const d2=dx*dx+dy*dy;
            if(d2<bd){ best={x:gx+0.5,y:gy+0.5,key:goldGuardKeyFor(gx,gy)}; bd=d2; }
          }
        }
        if(best){
          m.guardGoldX=best.x;
          m.guardGoldY=best.y;
          m.goldGuardKey=best.key;
        }
      }
      m.homeX=finiteCoord(m.homeX)?m.homeX:m.x;
      m.homeY=finiteCoord(m.homeY)?m.homeY:m.y;
    },
    onUpdate(m,spec,{player,dt,now,speed,aggressive,distToPlayer}){
      const sp=speed||spec.speed||3;
      const dx=player.x-m.x, dy=player.y-m.y;
      const dist=Math.hypot(dx,dy)||1;
      const dir=dx>=0?1:-1;
      const homeX=finiteCoord(m.guardGoldX)?m.guardGoldX:(finiteCoord(m.homeX)?m.homeX:m.x);
      const homeY=finiteCoord(m.guardGoldY)?m.guardGoldY:(finiteCoord(m.homeY)?m.homeY:m.y);
      const farHome=Math.hypot(m.x-homeX,m.y-homeY)>14;
      m.facing=dir;
      if(aggressive || distToPlayer<spec.sightRange || dist<11) setAggro(m.id);
      if(dist<GOLD_DWARF_HAMMER_RANGE && now>(m._nextDwarfHammerAt||0)){
        m.state='hammer';
        markMobAttack(m,'gold_dwarf_hammer',{target:player,power:1.55,strikeMs:430});
        damagePlayer(spec.dmg*1.12*(m.dmgMult||1),m.x+dir*0.45,m.y-0.35,'gold_dwarf_hammer',spec);
        m._nextDwarfHammerAt=now+GOLD_DWARF_HAMMER_COOLDOWN_MS*Math.max(0.6,Math.min(1.2,m.attackCdMult||1))+Math.random()*720;
        m._nextDwarfPickAt=Math.max(m._nextDwarfPickAt||0,now+540);
        try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(m.x*(MM.TILE||20),(m.y-0.2)*(MM.TILE||20),'common',6); }catch(e){}
        return;
      }
      if((aggressive || dist<spec.sightRange) && dist>3.0 && dist<GOLD_DWARF_PICK_RANGE && Math.abs(dy)<5.5 && now>(m._nextDwarfPickAt||0)){
        m.state='throw';
        if(shootGoldDwarfPick(m,player,10.3,spec.dmg*0.56)){
          m._nextDwarfPickAt=now+GOLD_DWARF_PICK_COOLDOWN_MS*Math.max(0.62,Math.min(1.2,m.attackCdMult||1))+Math.random()*850;
        }
      }
      if(farHome && dist>4){
        const hx=homeX-m.x, hy=homeY-m.y, hd=Math.hypot(hx,hy)||1;
        m.state='return';
        m.facing=hx>=0?1:-1;
        m.vx+=(hx/hd)*sp*0.58*dt*30;
        if(Math.abs(hy)>1.8 && m.onGround) m.vy=(spec.move.jumpVel||-4.9)*(m.jumpMul||1)*0.66;
        return;
      }
      if(aggressive || dist<spec.sightRange){
        m.state=dist<4.2?'threat':'rush';
        m.vx += dir*sp*(dist<4.5?0.74:0.48)*dt*30;
        if(m.onGround && dist>2.1 && dist<8.5 && now>(m._nextDwarfLeapAt||0)){
          markMobTelegraph(m,'gold_dwarf_hammer',{target:player,power:1.15,ms:420});
          m.vx += dir*sp*0.95;
          m.vy=(spec.move.jumpVel||-4.9)*(m.jumpMul||1)*0.82;
          m._nextDwarfLeapAt=now+1150+Math.random()*900;
        }
      } else {
        const patrol=(homeX+Math.sin(now*0.0018+m.spawnT)*2.4)-m.x;
        m.vx += Math.max(-1,Math.min(1,patrol))*sp*0.18*dt*30;
      }
    },
    onDeath(m){
      placeRewardChestNearMob(m, Math.random()<0.22?'rare':'common', 0.30);
    }
  });

  registerSpecies({ // Rusted city sentinel: steel automaton still guarding the ruins
    id:'STRAZNIK', max:32, localMax:16, spawnChance:1, spawnBatch:4, hp:28, dmg:9, speed:2.4, wanderInterval:[1.4,3.2], xp:28, ground:true, alwaysAggro:true, organic:false,
    sightRange:18, pursueRange:24,
    move:{jumpVel:-4.2, maxClimb:2, avoidWater:true},
    body:{w:0.95,h:1.55},
    loot:[{item:'steel', min:1, max:3, chance:1}, {item:'obsidian', min:1, max:1, chance:0.18}],
    spawnTest(x,y,getTile){
      if(biomeAt(x)!==8) return false;
      if(getTile(x,y)!==T.AIR || getTile(x,y-1)!==T.AIR) return false;
      const below=getTile(x,y+1);
      return below===T.STEEL || below===T.STONE || below===T.GRANITE || below===T.BASALT || below===T.OBSIDIAN;
    },
    biome:'city',
    onUpdate(m,spec,{player,dt,getTile,setTile,now,speed}){
      const weaponReady=sentinelShotReady(m,dt);
      const moveSpeed=speed||spec.speed||2.4;
      const cdMul=(m && m.attackCdMult)||1;
      const meatTarget = typeof setTile==='function' ? findSentinelMeatTarget(m,getTile,now) : null;
      const alienTarget = meatTarget ? null : nearestAlienTarget(m.x,m.y,Math.max(spec.sightRange||18,spec.pursueRange||24),{source:'sentinel'});
      let target = meatTarget || player;
      if(alienTarget){
        const ap = alienTargetPoint(alienTarget);
        const ax = ap.x - m.x, ay = ap.y - m.y;
        const px = player ? player.x - m.x : Infinity;
        const py = player ? player.y - m.y : Infinity;
        const a2 = ax * ax + ay * ay;
        const p2 = px * px + py * py;
        const sight2 = (spec.sightRange||18) * (spec.sightRange||18);
        if(a2 <= p2 * 1.18 || p2 > sight2) target = alienTarget;
      }
      let targetIsMeat = target && target.kind==='meat';
      let targetIsAlien = isInvasionTarget(target);
      let dx=target.x-m.x, dy=target.y-m.y, adx=Math.abs(dx)||1;
      let dir=dx>=0?1:-1;
      let distToTarget = Math.hypot(dx,dy);
      const inView = targetIsMeat
        ? distToTarget < SENTINEL_MEAT_RANGE && Math.abs(dy) < 7.5
        : distToTarget < spec.sightRange && Math.abs(dy) < 7.5;
      const losRange = targetIsMeat ? SENTINEL_MEAT_RANGE : Math.min(16, spec.sightRange||16);
      let lines = inView ? (targetIsMeat && target.lines ? target.lines : sentinelVisionLines(m,target,getTile,losRange,now,dir)) : [];
      let canSeeTarget = lines.some(l=>l.end && l.end.clear);
      if(targetIsAlien && !canSeeTarget && player){
        const fdx=player.x-m.x, fdy=player.y-m.y;
        const fallbackInView = Math.hypot(fdx,fdy) < spec.sightRange && Math.abs(fdy) < 7.5;
        const fallbackDir = fdx>=0?1:-1;
        const fallbackLines = fallbackInView ? sentinelVisionLines(m,player,getTile,Math.min(16,spec.sightRange||16),now,fallbackDir) : [];
        if(fallbackLines.some(l=>l.end && l.end.clear)){
          target = player;
          targetIsMeat = false;
          targetIsAlien = false;
          lines = fallbackLines;
          canSeeTarget = true;
          dx=target.x-m.x;
          dy=target.y-m.y;
          adx=Math.abs(dx)||1;
          dir=dx>=0?1:-1;
          distToTarget = Math.hypot(dx,dy);
        }
      }
      if(canSeeTarget){
        const aimDir = target.x>=m.x?1:-1;
        m.facing=aimDir;
        if(targetIsMeat){
          if(adx>2.4 && distToTarget<spec.pursueRange) m.vx += dir*moveSpeed*0.22*dt*30;
          else m.vx *= 0.68;
        } else if(Math.abs(target.x-m.x)>1.8 && distToTarget<spec.pursueRange) m.vx += aimDir*moveSpeed*0.42*dt*30;
        else m.vx *= 0.78;
        m.shootCd=(m.shootCd==null?((targetIsMeat?0.65:0.9)*cdMul):m.shootCd)-dt;
        const minRange = targetIsMeat ? 0.8 : 3;
        const maxRange = targetIsMeat ? SENTINEL_MEAT_RANGE : 13;
        if(distToTarget<maxRange && distToTarget>minRange && m.shootCd<=0){
          const shotLines = (targetIsMeat && target.lines) ? target.lines : (m._sentinelLosFresh ? lines : null);
          if(!weaponReady){
            m.shootCd=Math.min(m.shootCd,0);
          } else if(!reserveSentinelLaserShot(now)){
            m.shootCd=(0.18+Math.random()*0.22)*Math.max(0.75,cdMul);
          } else if(sentinelLaserAt(m,target,targetIsMeat?0:spec.dmg,getTile,setTile,shotLines)) m.shootCd=(1.55+Math.random()*0.75)*cdMul;
          else m.shootCd=0.25*Math.max(0.75,cdMul);
        }
      } else {
        m.vx *= 0.82;
        m.shootCd=Math.max(m.shootCd==null?0.45:m.shootCd, 0.25);
        if(Math.random()<0.003) m.vx += (Math.random()*2-1)*0.25;
      }
      if(Math.random()<0.006) m.vx += (Math.random()*2-1)*0.35;
    }
  });

  registerSpecies({
    id:'RADIATION_COCKROACH', displayName:'Radiation cockroach',
    max:46, localMax:10, spawnChance:0.22, spawnBatch:2,
    hp:9, dmg:18, speed:5.8, wanderInterval:[0.5,1.4], xp:18, ground:true, alwaysAggro:true,
    sightRange:16, pursueRange:24,
    move:{jumpVel:-4.6, maxClimb:1, avoidWater:false},
    body:{w:0.78,h:0.38},
    meat:false,
    contactInvulMs:360, contactKnockback:1.45, contactKnockbackY:-0.75, contactCause:'radiation_cockroach',
    loot:[{item:'alienBiomass', min:1, max:1, chance:0.10}, {item:'radioactiveOre', min:1, max:1, chance:0.08}],
    variant:{shift:2, from:'#79cf42', to:'#c9f46b'},
    spawnTest(x,y,getTile){ return radiationCockroachSpawnCell(x,y,getTile); },
    biome:'city',
    onCreate(m){
      m.scale=0.82+Math.random()*0.22;
      m.speedMul=Math.max(m.speedMul||1,1.04+Math.random()*0.28);
    },
    onUpdate(m,spec,{player,dt,now,speed}){
      const dx=player.x-m.x, dy=player.y-m.y;
      const d=Math.hypot(dx,dy)||1;
      if(d<spec.pursueRange){
        m.vx += (dx/d)*(speed||spec.speed)*dt*(d<3?6.5:4.8);
        if(Math.abs(dy)>0.8) m.vy += (dy/d)*(speed||spec.speed)*dt*1.6;
        m.facing=dx>=0?1:-1;
        if(m.onGround && d<7 && now>(m._roachHopAt||0)){
          m.vy=(spec.move.jumpVel||-4.6)*(m.jumpMul||1)*(0.75+Math.random()*0.35);
          m._roachHopAt=now+520+Math.random()*760;
        }
      } else if(m.onGround && Math.random()<0.025){
        m.vx += (Math.random()<0.5?-1:1)*(speed||spec.speed)*0.22;
      }
      if(Math.random()<dt*0.8){
        try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(m.x*(MM.TILE||20),(m.y-0.1)*(MM.TILE||20),'common',2); }catch(e){}
      }
    }
  });

  registerSpecies({
    id:'ATOMIC_BOMB', displayName:'Atomic bomb',
    max:2, localMax:1, spawnChance:0.035, spawnBatch:1,
    hp:120, dmg:0, speed:0.02, wanderInterval:[4,8], xp:6000, ground:true, organic:false,
    sightRange:0, pursueRange:0,
    body:{w:1.75,h:1.55},
    move:{jumpVel:0, maxClimb:0, avoidWater:true},
    meat:false,
    loot:[{item:'steel', min:4, max:8, chance:1}, {item:'electronics', min:2, max:4, chance:0.72}, {item:'radioactiveOre', min:2, max:5, chance:0.95}],
    variant:{shift:1, from:'#59636b', to:'#7c8588'},
    spawnTest(x,y,getTile){ return atomicBombSpawnCell(x,y,getTile); },
    biome:'city',
    onCreate(m){
      m.state='armed';
      m.scale=0.98+Math.random()*0.08;
      m.lifeEndAt=performance.now()+1000*60*14;
      m.decayStartAt=m.lifeEndAt+10000;
      m._nextCockroachAt=performance.now()+1200+Math.random()*2400;
    },
    onUpdate(m,spec,{getTile,now}){
      m.vx*=0.02;
      m.vy=Math.min(m.vy||0,0.65);
      if(now>(m._nextCockroachAt||0)){
        spawnRadiationCockroachNearBomb(m,getTile);
        m._nextCockroachAt=now+ATOMIC_BOMB_COCKROACH_INTERVAL_MS+Math.random()*2300;
      }
      if(Math.random()<0.018){
        try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(m.x*(MM.TILE||20),(m.y-0.45)*(MM.TILE||20),'rare',3); }catch(e){}
      }
    },
    onDeath(m){
      detonateAtomicBomb(m);
    }
  });

  // --- Golden sprinter: a legendary visitor that races across the world every
  // ~7 in-game days (1 day = 10 real minutes; the first visit arrives at half
  // that wait). Three forms — bird, runner, mole — all blindingly fast and gone
  // in ~half a minute; slaying one yields an epic chest plus diamonds. Schedule
  // progress persists in mm_golden_v1; the creature itself is transient (never
  // serialized), so a reload simply ends the visit.
  const GOLDEN={ PERIOD_DAYS:7, DAY_SEC:600, LIFETIME:34, acc:0, saveAcc:0, visits:0 };
  (function goldenLoad(){ try{ const raw=localStorage.getItem('mm_golden_v1'); if(!raw) return; const d=JSON.parse(raw); if(d && typeof d.acc==='number' && isFinite(d.acc)) GOLDEN.acc=Math.max(0,d.acc); if(d && typeof d.visits==='number') GOLDEN.visits=Math.max(0,d.visits|0); }catch(e){} })();
  function goldenSave(){ try{ localStorage.setItem('mm_golden_v1', JSON.stringify({acc:Math.round(GOLDEN.acc), visits:GOLDEN.visits})); }catch(e){} }
  function goldenSurfaceY(x, fallback){ try{ const wg=MM.worldGen; if(wg && wg.surfaceHeight) return wg.surfaceHeight(Math.round(x)); }catch(e){} return (typeof fallback==='number'? fallback : 60); }
  function goldenSay(t){ try{ if(typeof window!=='undefined' && window.msg) window.msg(t); }catch(e){} }
  const GOLDEN_FORMS=['bird','runner','mole'];
  function spawnGolden(form, playerOpt){
    const pl = playerOpt || (typeof window!=='undefined' && window.player) || null; if(!pl) return null;
    const spec=SPECIES.ZLOTY; if(!spec || countSpecies('ZLOTY')>=spec.max) return null;
    const f = GOLDEN_FORMS.includes(form)? form : GOLDEN_FORMS[(Math.random()*GOLDEN_FORMS.length)|0];
    const dir = Math.random()<0.5?-1:1; // enters from one side and streaks past the hero
    const sx = pl.x - dir*28;
    const surf = goldenSurfaceY(sx, pl.y);
    const m = create(spec, sx, f==='bird'? surf-7 : f==='mole'? surf+3.5 : surf-1.2);
    m._g = { form:f, dir, t:GOLDEN.LIFETIME, ph:Math.random()*6.28, flipCd:0, trail:[], trailAcc:0 };
    m.facing = dir; m.speedMul=1; m.scale=1;
    mobs.push(m);
    const NAME={bird:'Złoty ptak', runner:'Złoty biegacz', mole:'Złoty kret'};
    goldenSay('✨ '+(NAME[f]||'Złoty sprinter')+' przemierza okolicę! Złap go, zanim umknie!');
    try{ if(MM.audio && MM.audio.play) MM.audio.play('golden'); }catch(e){}
    return m;
  }
  function goldenTick(dt, player){
    GOLDEN.acc+=dt; GOLDEN.saveAcc+=dt;
    if(GOLDEN.saveAcc>=10){ GOLDEN.saveAcc=0; goldenSave(); }
    const period = GOLDEN.PERIOD_DAYS*GOLDEN.DAY_SEC*(GOLDEN.visits===0?0.5:1);
    if(GOLDEN.acc>=period && countSpecies('ZLOTY')===0){
      GOLDEN.acc=0; GOLDEN.visits++; goldenSave();
      spawnGolden(null, player);
    }
  }
  function goldenSnapshot(){
    return {
      acc: Math.max(0, Math.round(Number.isFinite(GOLDEN.acc)?GOLDEN.acc:0)),
      visits: Math.max(0, Number.isFinite(GOLDEN.visits)?(GOLDEN.visits|0):0)
    };
  }
  function goldenRestore(data){
    const period=GOLDEN.PERIOD_DAYS*GOLDEN.DAY_SEC;
    GOLDEN.acc=0; GOLDEN.saveAcc=0; GOLDEN.visits=0;
    if(data && typeof data==='object'){
      if(Number.isFinite(data.visits)) GOLDEN.visits=Math.max(0, Math.min(1000000, data.visits|0));
      if(Number.isFinite(data.acc)) GOLDEN.acc=Math.max(0, Math.min(period, data.acc));
    }
    goldenSave();
  }
  function goldenReset(){ goldenRestore(null); }
  registerSpecies({
    id:'ZLOTY', max:1, hp:90, dmg:0, speed:9.5, wanderInterval:[9,9], xp:150,
    flying:true, organic:false, lifeSpanSec:600,
    sightRange:0, pursueRange:0,
    loot:[{item:'diamond', min:3, max:5, chance:1}],
    spawnTest(){ return false; }, // only the scheduler / debug buttons summon it
    biome:'any',
    onCreate(m){ if(!m._g) m._g={ form:GOLDEN_FORMS[(Math.random()*3)|0], dir:(Math.random()<0.5?-1:1), t:GOLDEN.LIFETIME, ph:Math.random()*6.28, flipCd:0, trail:[], trailAcc:0 }; m.speedMul=1; m.scale=1; },
    onUpdate(m,spec,{dt,player,getTile}){
      const g=m._g; if(!g) return;
      g.t-=dt; g.ph+=dt*7;
      if(g.flipCd>0) g.flipCd-=dt;
      // escaped: time is up or it outran the hero — dissolve in a flash, no loot
      if(g.t<=0 || Math.abs(m.x-player.x)>110){
        m._naturalDeath=true; m.hp=0;
        try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20), m.y*(MM.TILE||20),'epic'); }catch(e){}
        goldenSay('✨ Złoty sprinter umknął i rozpłynął się w blasku...');
        return;
      }
      // wounded panic: sprints half again as fast for a moment
      const hurt = performance.now() < (m.hitFlashUntil||0)+1500;
      const sp = spec.speed*(hurt?1.5:1);
      const gen = goldenSurfaceY(m.x, m.y);
      let targetY, vCap=12;
      if(g.form==='bird'){
        // hug the sky but clear REAL obstacles (player towers, tree canopies)
        // in the flight corridor ahead — not just the generated terrain
        let top=gen;
        if(getTile){
          for(let c=0;c<=9;c++){
            const cx=Math.floor(m.x)+g.dir*c;
            const colSurf=goldenSurfaceY(cx,gen);
            let firstSolid=colSurf;
            for(let y=Math.max(1,colSurf-24); y<=colSurf+1; y++){ if(isSolid(getTile(cx,y))){ firstSolid=y; break; } }
            if(firstSolid<top) top=firstSolid;
          }
        }
        targetY = top - 5 + Math.sin(g.ph*0.45)*1.2; vCap=18;
      } else if(g.form==='mole'){
        // deep tunneling: meanders in a band well below the surface, phasing
        // through rock without breaking a single block; only open galleries
        // (caves, player tunnels) reveal it — see the draw case
        targetY = gen + 9 + Math.sin(g.ph*0.35)*3.5;
      } else {
        // runner: gallop on the real terrain — stand on actual tiles (water
        // counts: it sprints across the surface), pre-lift into climbable
        // steps, wheel around at walls too tall to leap (so it can be trapped!)
        const standAt=(cx)=>{
          if(!getTile) return gen;
          const col=Math.floor(cx);
          const from=Math.max(1, Math.floor(m.y)-6);
          for(let y=from; y<from+24; y++){ const t=getTile(col,y); if(isSolidGround(t) || t===T.WATER) return y; }
          return gen;
        };
        const here=standAt(m.x);
        const ahead=Math.min(standAt(m.x+g.dir*2), standAt(m.x+g.dir*4));
        if(here-ahead>4 && g.flipCd<=0){
          g.flipCd=0.8; g.dir*=-1; m.facing=g.dir; // too tall — wheel around in a spray of sparks
          try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20), m.y*(MM.TILE||20),'common'); }catch(e){}
        }
        let stand=Math.min(here, ahead);
        if(stand>gen+3) stand=gen; // glide over dug pits/caverns instead of diving in
        targetY = stand - 0.9 - Math.abs(Math.sin(g.ph))*1.3; vCap=16;
      }
      m.vx = g.dir*sp; m.facing=g.dir;
      m.vy = Math.max(-vCap, Math.min(vCap,(targetY-m.y)*6));
      // breadcrumb positions feed the light-streak rendering
      g.trailAcc+=dt;
      if(g.trailAcc>=0.03){ g.trailAcc=0; g.trail.push({x:m.x,y:m.y}); if(g.trail.length>26) g.trail.shift(); }
    },
    onDeath(m){
      // the exceptional prize: an epic chest materializes where it fell (a mole
      // dies inside rock, so the scan starts above the surface and walks down)
      try{
        const W=MM.world, TT=MM.T||T;
        if(W && W.getTile && W.setTile){
          const bx=Math.round(m.x);
          let ty=Math.max(1, Math.min(Math.round(m.y), Math.round(goldenSurfaceY(m.x,m.y)))-5);
          for(let i=0;i<18;i++,ty++){
            const t=W.getTile(bx,ty), below=W.getTile(bx,ty+1);
            if(t===TT.AIR && below!==TT.AIR && below!==TT.WATER){ W.setTile(bx,ty,TT.CHEST_EPIC); break; }
          }
        }
      }catch(e){}
      try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(m.x*(MM.TILE||20), m.y*(MM.TILE||20),'epic'); }catch(e){}
      goldenSay('🏆 Złoty sprinter pokonany! Zostawił epicką skrzynię.');
      try{ if(MM.audio && MM.audio.play) MM.audio.play('milestone'); }catch(e){}
    }
  });

  function registerSpecies(def){
    if(!def || !def.id) return false; if(SPECIES[def.id]) return false; // already exists
    // Fill defaults
    def.max = def.max||10; def.hp = def.hp||5; if(def.dmg==null) def.dmg=1; def.speed=def.speed||2.5; def.wanderInterval = def.wanderInterval||[2,5];
    SPECIES[def.id]=def; return true;
  }

  function rand(a,b){ return a + Math.random()*(b-a); }
  function finiteNum(v){ return typeof v==='number' && isFinite(v); }
  function finiteCoord(v){ return finiteNum(v) && Math.abs(v)<10000000; }
  function clampFinite(v,fallback,min,max){
    if(!finiteNum(v)) return fallback;
    if(typeof min==='number' && v<min) return min;
    if(typeof max==='number' && v>max) return max;
    return v;
  }
  function validMobState(m){
    return !!m && finiteCoord(m.x) && finiteCoord(m.y) && finiteNum(m.vx) && finiteNum(m.vy) && finiteNum(m.hp);
  }
  function mobHostilityAt(x){ return HOSTILITY.at(finiteCoord(x) ? x : 0); }
  function mobMaxHp(spec,x){
    const h=mobHostilityAt(x);
    const base=Math.max(1, Math.round(spec && spec.hp ? spec.hp : 5));
    if(spec && spec.id==='ZLOTY') return base;
    const mult=(spec && spec.organic===false) ? (1 + h.hostility * 0.70) : (h.mobHpMult || 1);
    return Math.max(1, Math.round(base * mult));
  }
  function mobDamageMult(spec,x){
    const h=mobHostilityAt(x);
    if(spec && spec.id==='ZLOTY') return 1;
    return (spec && spec.organic===false) ? (1 + h.hostility * 0.62) : (h.mobDamageMult || 1);
  }
  function applyMobProgressionTraits(m,spec,hOpt,opts){
    if(!m || !spec) return null;
    const p=mobThreatProfile(spec,m.x,hOpt);
    m.hostility=+p.hostility.toFixed(3);
    m.hostilitySide=p.side;
    m.hostilityTier=p.tier;
    m.reactionMult=p.reactionMult;
    m.attackCdMult=p.attackCdMult;
    m.projectileSpeedMult=p.projectileSpeedMult;
    m.aimLead=p.aimLead;
    m.aimError=p.aimError;
    m.threatAccent=hostilityAccentColor(m) || '';
    if(!opts || !opts.behaviorOnly){
      const flying=!!(spec.flying || spec.aquatic);
      m.scale=clampFinite((m.scale||1) * p.scaleMult, 1, 0.35, flying ? 1.38 : 1.72);
      m.speedMul=clampFinite((m.speedMul||1) * p.speedAccent, 1, 0.1, 4);
      m.jumpMul=clampFinite((m.jumpMul||1) * p.jumpMult, 1, 0.1, 4);
      if(typeof m.baseColor==='string') m.baseColor=tintMobColorForThreat(m.baseColor,m);
    }
    return p;
  }

  function create(spec, x,y,getTile){
    x=finiteCoord(x)?x:0; y=finiteCoord(y)?y:0;
    const now = performance.now();
  const h=mobHostilityAt(x);
  const maxHp=mobMaxHp(spec,x);
  const m={ id: spec.id, x, y, vx:0, vy:0, hp: maxHp, maxHp, baseHp: spec.hp, hostility:+h.hostility.toFixed(3), hostilitySide:h.side, dmgMult:mobDamageMult(spec,x), state:'idle', tNext: now + rand(spec.wanderInterval[0], spec.wanderInterval[1])*1000, facing:1, _stableFacing:1, _stableFacingChangedAt:now, _pendingFacing:0, _pendingFacingSince:0, spawnT: now, attackCd:0, hitFlashUntil:0, shake:0, tickMod: (Math.random()<0.5?1:0), sleepUntil:0 };
  // Per-entity variability
  m.scale = 0.75 + Math.random()*0.25; // 0.75..1.0 visual & collider scaling
  m.speedMul = (0.75 + Math.random()*0.25) * (h.mobSpeedMult || 1); // regional speed pressure + per-mob variance
  m.jumpMul = 0.75 + Math.random()*0.25; // 0.75..1.0 jump strength
  // Natural lifespan to avoid overpopulation: base span per species or default, scaled 0.5..1.5
  const BASE_LIFE_SEC = (spec.lifeSpanSec && spec.lifeSpanSec>0) ? spec.lifeSpanSec : 120; // default 2 minutes
  const lifeFactor = 0.5 + Math.random()*1.0; // 0.5..1.5
  m.lifeEndAt = now + BASE_LIFE_SEC * lifeFactor * 1000;
  const decayWindow = (4 + Math.random()*8) * 1000; // 4..12s fadeout
  m.decayStartAt = Math.max(now + 2000, m.lifeEndAt - decayWindow);
  if(spec.variant){
    const col = variantColor(m.spawnT, spec.variant.shift, spec.variant.from, spec.variant.to);
    m.baseColor = jitterColor(col, {h:16, s:0.20, l:0.16});
  }
  if(!m.baseColor){
    const BASE = {
      SQUIRREL:'#b07040', DEER:'#9c6a39', THUNDER_BISON:'#8b5f34', RABBIT:'#dddddd', OWL:'#c8a860', CRAB:'#c23a2e',
      EEL:'#2f8a4a', LAKE_SERPENT:'#45b9a8', JACKPOT_WHALE:'#5d86a0', PIRANHA:'#b72d2d', GOAT:'#c9c4b5', BEAR:'#6b4a30', BRAMBLE_STALKER:'#48672f', WOLF:'#bcbcbc', ICE_WRAITH:'#d5f6ff', ICE_SHAMAN:'#bff3ff', FIRE_SHAMAN:'#ff9a4f', JACKPOT_YETI:'#e6f2f6', FISH:'#4eb2f1',
      BIRD:'#f5d16a', VULTURE:'#4e4036', VULTURE_HATCHLING:'#8a6e4b', STRAZNIK:'#8f9aa6', ATOMIC_BOMB:'#646f77', RADIATION_COCKROACH:'#79cf42', ATLANTIS_MEDUZA:'#7bdcff',
      SAND_WORM:'#b38342', GIANT_SCORPION:'#6b3b28', TEMPLE_GUARD:'#6f7d43', BOG_LURKER:'#52643a', STONE_GOLEM:'#626870', GOLD_DRAGON:'#b26d32', GOLD_DWARF_GUARD:'#8f6240',
      WIOSENNY_JELEN:'#bf8a4d', LETNI_ZUBR:'#8d5e32', JESIENNY_LOS:'#9a6737', ZIMOWY_NIEDZWIEDZ:'#e9f3f8'
    };
    const base = BASE[spec.id] || '#a8a8a8';
    m.baseColor = jitterColor(base, {h:12, s:0.14, l:0.10});
  }
    if(typeof spec.onCreate==='function') spec.onCreate(m, spec, getTile);
    applyMobProgressionTraits(m,spec,h);
    initMobFacingStability(m,now);
    addToGrid(m); speciesCounts[spec.id]=(speciesCounts[spec.id]||0)+1; return m; }

  function normalizeMobFacing(m){
    return m && m.facing<0 ? -1 : 1;
  }
  function mobFacingUrgent(m,now){
    if(!m) return false;
    if((m._attackFlashUntil||0)>now || (m._attackTelegraphUntil||0)>now) return true;
    const state=String(m.state||'');
    return state==='charge' || state==='slam' || state==='sting' || state==='lunge' ||
      state==='snare' || state==='ambush' || state==='whiteout' || state==='carry' ||
      state==='spit' || state==='charging' || state==='breath' || state==='hammer';
  }
  function initMobFacingStability(m,now){
    if(!m) return;
    const dir=normalizeMobFacing(m);
    m.facing=dir;
    m._stableFacing=dir;
    m._stableFacingChangedAt=Number.isFinite(now)?now:performance.now();
    m._pendingFacing=0;
    m._pendingFacingSince=0;
  }
  function stabilizeMobFacing(m,spec,now){
    if(!m) return 1;
    const desired=normalizeMobFacing(m);
    if(m.id==='ZLOTY'){
      m._stableFacing=desired;
      m._stableFacingChangedAt=now;
      return desired;
    }
    if(m._stableFacing!==1 && m._stableFacing!==-1) initMobFacingStability(m,now);
    const stable=m._stableFacing<0?-1:1;
    if(desired===stable){
      m._pendingFacing=0;
      m._pendingFacingSince=0;
      m.facing=stable;
      return stable;
    }
    if(m._pendingFacing!==desired){
      m._pendingFacing=desired;
      m._pendingFacingSince=now;
    }
    const speed=Math.abs(Number(m.vx)||0);
    const baseSpeed=Math.max(0.5, Number(spec && spec.speed) || 1);
    const decisive=speed>Math.max(0.28,baseSpeed*0.18);
    const urgent=mobFacingUrgent(m,now);
    const holdMs=urgent ? MOB_FACING_ATTACK_CONFIRM_MS : (decisive ? MOB_FACING_FLIP_MIN_MS*0.72 : MOB_FACING_FLIP_MIN_MS);
    const confirmMs=urgent ? MOB_FACING_ATTACK_CONFIRM_MS : (decisive ? MOB_FACING_FAST_CONFIRM_MS : MOB_FACING_CONFIRM_MS);
    const last=Number.isFinite(m._stableFacingChangedAt) ? m._stableFacingChangedAt : 0;
    const pendingSince=Number.isFinite(m._pendingFacingSince) ? m._pendingFacingSince : now;
    if(now-last>=holdMs && now-pendingSince>=confirmMs){
      m._stableFacing=desired;
      m._stableFacingChangedAt=now;
      m._pendingFacing=0;
      m._pendingFacingSince=0;
    }
    m.facing=m._stableFacing<0?-1:1;
    return m.facing;
  }
  function mobFacingForDraw(m,now){
    if(!m) return 1;
    if(m._stableFacing!==1 && m._stableFacing!==-1) initMobFacingStability(m,now);
    return m._stableFacing<0?-1:1;
  }

  // --- Aquatic helpers (fish) ---
  function readMobTile(getTile,x,y){
    try{ return typeof getTile==='function' ? getTile(x,y) : (WORLD && WORLD.getTile ? WORLD.getTile(x,y) : T.AIR); }catch(e){ return T.AIR; }
  }
  const WATER_BODY_NEIGHBORS=[[1,0],[-1,0],[0,1],[0,-1]];
  function waterPocketShape(tx,ty,getTile){
    if(readMobTile(getTile,tx,ty)!==T.WATER) return {count:0,width:0,depth:0};
    const minLimitX=tx-6, maxLimitX=tx+6;
    const minLimitY=ty-5, maxLimitY=ty+5;
    const seen=new Set([tx+','+ty]);
    const queue=[{x:tx,y:ty}];
    let minX=tx, maxX=tx, minY=ty, maxY=ty, count=0;
    for(let qi=0; qi<queue.length && count<80; qi++){
      const p=queue[qi];
      count++;
      if(p.x<minX) minX=p.x; if(p.x>maxX) maxX=p.x;
      if(p.y<minY) minY=p.y; if(p.y>maxY) maxY=p.y;
      for(const [dx,dy] of WATER_BODY_NEIGHBORS){
        const nx=p.x+dx, ny=p.y+dy;
        if(nx<minLimitX || nx>maxLimitX || ny<minLimitY || ny>maxLimitY) continue;
        const k=nx+','+ny;
        if(seen.has(k) || readMobTile(getTile,nx,ny)!==T.WATER) continue;
        seen.add(k);
        queue.push({x:nx,y:ny});
      }
    }
    return {count,width:maxX-minX+1,depth:maxY-minY+1};
  }
  function canHostFishSpawn(x,y,getTile){
    x|=0; y|=0;
    if(readMobTile(getTile,x,y)!==T.WATER) return false;
    const above=readMobTile(getTile,x,y-1);
    if(above!==T.WATER && above!==T.AIR) return false;
    const pocket=waterPocketShape(x,y,getTile);
    return pocket.count>=8 && pocket.width>=3 && pocket.depth>=2;
  }
  function isSeaOrOceanColumn(x){
    x=Math.floor(Number.isFinite(x)?x:0);
    if(biomeAt(x)===5) return true;
    try{ return !!(WORLDGEN && typeof WORLDGEN.oceanBasinAt==='function' && WORLDGEN.oceanBasinAt(x)); }catch(e){ return false; }
  }
  function isLakeColumn(x){
    return biomeAt(Math.floor(Number.isFinite(x)?x:0))===6;
  }
  const ATLANTIS_GUARD_TILES = Object.freeze({
    [T.GLASS]:true, [T.OBSIDIAN]:true, [T.STEEL]:true, [T.SOLAR_BATTERY]:true,
    [T.ANTIGRAVITY_BEACON]:true, [T.IRIDIUM]:true, [T.METEORIC_IRON]:true,
    [T.ANTIMATTER_CRYSTAL]:true, [T.GLOWSHROOM]:true, [T.CHEST_RARE]:true, [T.CHEST_EPIC]:true
  });
  function isAtlantisGuardTile(t){ return !!ATLANTIS_GUARD_TILES[t]; }
  function canHostPiranhaSpawn(x,y,getTile){
    x|=0; y|=0;
    if(!isSeaOrOceanColumn(x)) return false;
    if(readMobTile(getTile,x,y)!==T.WATER) return false;
    const col=waterColumnAt(x,y,getTile);
    if(!col || col.depth<3) return false;
    const above=readMobTile(getTile,x,y-1);
    if(above!==T.WATER && above!==T.AIR) return false;
    const pocket=waterPocketShape(x,y,getTile);
    return pocket.count>=16 && pocket.width>=4 && pocket.depth>=3;
  }
  function canHostJackpotWhaleSpawn(x,y,getTile){
    x|=0; y|=0;
    if(!isSeaOrOceanColumn(x)) return false;
    if(readMobTile(getTile,x,y)!==T.WATER) return false;
    const col=waterColumnAt(x,y,getTile);
    if(!col || col.depth<7 || y<col.top+2) return false;
    const pocket=waterPocketShape(x,y,getTile);
    if(pocket.count<44 || pocket.width<8 || pocket.depth<6) return false;
    for(let dx=-4; dx<=4; dx++){
      if(readMobTile(getTile,x+dx,y)!==T.WATER) return false;
    }
    return true;
  }
  function canHostLakeSerpentSpawn(x,y,getTile){
    x|=0; y|=0;
    if(!isLakeColumn(x)) return false;
    if(readMobTile(getTile,x,y)!==T.WATER) return false;
    const col=waterColumnAt(x,y,getTile);
    if(!col || col.depth<4 || y<col.top+1) return false;
    const pocket=waterPocketShape(x,y,getTile);
    return pocket.count>=22 && pocket.width>=5 && pocket.depth>=4;
  }
  function nearAtlantisStructure(x,y,getTile){
    x|=0; y|=0;
    if(!isSeaOrOceanColumn(x) || readMobTile(getTile,x,y)!==T.WATER) return false;
    let signals=0, heavy=0;
    for(let dy=-8; dy<=8; dy++){
      for(let dx=-10; dx<=10; dx++){
        const t=readMobTile(getTile,x+dx,y+dy);
        if(!isAtlantisGuardTile(t)) continue;
        signals++;
        if(t===T.CHEST_EPIC || t===T.IRIDIUM || t===T.ANTIGRAVITY_BEACON || t===T.ANTIMATTER_CRYSTAL) heavy++;
        if(signals>=3 || (signals>=2 && heavy>=1)) return true;
      }
    }
    return false;
  }
  function canHostAtlantisMeduzaSpawn(x,y,getTile){
    x|=0; y|=0;
    if(!isSeaOrOceanColumn(x)) return false;
    if(readMobTile(getTile,x,y)!==T.WATER) return false;
    const col=waterColumnAt(x,y,getTile);
    if(!col || col.depth<5 || y<col.top+1) return false;
    const pocket=waterPocketShape(x,y,getTile);
    if(pocket.count<22 || pocket.width<5 || pocket.depth<4) return false;
    return nearAtlantisStructure(x,y,getTile);
  }
  function nearestAtlantisWaterCell(tx,ty,getTile,rx,ry){
    const maxR=Math.max(rx||10,ry||8);
    for(let r=0; r<=maxR; r++){
      for(let dy=-Math.min(ry||8,r); dy<=Math.min(ry||8,r); dy++){
        for(let dx=-Math.min(rx||10,r); dx<=Math.min(rx||10,r); dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const nx=tx+dx, ny=ty+dy;
          if(canHostAtlantisMeduzaSpawn(nx,ny,getTile)) return {x:nx+0.5,y:ny+0.5,tileX:nx,tileY:ny};
        }
      }
    }
    return null;
  }
  function heroProtectedByBoat(player){
    if(!player) return false;
    try{
      const api=MM && MM.boats;
      const liveBoat=api && typeof api.heroOnBoat==='function' ? api.heroOnBoat(player) : null;
      if(liveBoat && liveBoat.inWater && !liveBoat.grounded) return true;
      const cachedBoat=api && typeof api.heroBoat==='function' ? api.heroBoat() : null;
      return !!(cachedBoat && cachedBoat.inWater && !cachedBoat.grounded && heroNearBoatHull(player,cachedBoat));
    }catch(e){ return false; }
  }
  function heroNearBoatHull(player,boat){
    if(!player || !boat || !finiteCoord(boat.x) || !finiteCoord(boat.y) || !Array.isArray(boat.cells)) return false;
    let minDx=Infinity,maxDx=-Infinity,minDy=Infinity,maxDy=-Infinity;
    for(const c of boat.cells){
      if(!c || !finiteNum(c.dx) || !finiteNum(c.dy)) continue;
      minDx=Math.min(minDx,c.dx); maxDx=Math.max(maxDx,c.dx);
      minDy=Math.min(minDy,c.dy); maxDy=Math.max(maxDy,c.dy);
    }
    if(!Number.isFinite(minDx)) return false;
    const hw=(finiteNum(player.w)?player.w:0.7)/2;
    const hh=(finiteNum(player.h)?player.h:0.95)/2;
    const pad=0.45;
    return player.x+hw > boat.x+minDx-pad && player.x-hw < boat.x+maxDx+1+pad &&
      player.y+hh > boat.y+minDy-pad && player.y-hh < boat.y+maxDy+1+pad;
  }
  function heroInSeaWater(player,getTile){
    if(!player || !finiteCoord(player.x) || !finiteCoord(player.y) || typeof getTile!=='function') return false;
    if(heroProtectedByBoat(player)) return false;
    const tx=Math.floor(player.x);
    if(!isSeaOrOceanColumn(tx)) return false;
    const h=finiteNum(player.h) ? player.h : 0.95;
    const probes=[
      Math.floor(player.y),
      Math.floor(player.y+h*0.25),
      Math.floor(player.y+h*0.48)
    ];
    return probes.some(ty=>readMobTile(getTile,tx,ty)===T.WATER);
  }
  function heroInLakeWater(player,getTile){
    if(!player || !finiteCoord(player.x) || !finiteCoord(player.y) || typeof getTile!=='function') return false;
    if(heroProtectedByBoat(player)) return false;
    const tx=Math.floor(player.x);
    if(!isLakeColumn(tx)) return false;
    const h=finiteNum(player.h) ? player.h : 0.95;
    const probes=[
      Math.floor(player.y),
      Math.floor(player.y+h*0.25),
      Math.floor(player.y+h*0.48)
    ];
    return probes.some(ty=>readMobTile(getTile,tx,ty)===T.WATER);
  }
  function prunePiranhaBaitZones(now){
    for(let i=piranhaBaitZones.length-1; i>=0; i--){
      const z=piranhaBaitZones[i];
      if(!z || !finiteCoord(z.x) || !finiteCoord(z.y) || !(z.until>now)) piranhaBaitZones.splice(i,1);
    }
  }
  function currentPiranhaBait(m,now){
    if(!m || m.id!=='PIRANHA' || !finiteCoord(m._baitX) || !finiteCoord(m._baitY) || !(m._baitUntil>now)) return null;
    return {x:m._baitX,y:m._baitY,kind:m._baitKind||'meat',until:m._baitUntil};
  }
  function clearPiranhaBait(m){
    if(!m) return;
    delete m._baitX;
    delete m._baitY;
    delete m._baitUntil;
    delete m._baitKind;
  }
  function piranhaIsDistracted(m,now){
    return !!currentPiranhaBait(m,now);
  }
  function assignPiranhaBait(m,zone,now){
    if(!m || m.id!=='PIRANHA' || !zone || !finiteCoord(zone.x) || !finiteCoord(zone.y) || !(zone.until>now)) return false;
    const cur=currentPiranhaBait(m,now);
    if(cur && cur.until>=zone.until && Math.hypot(cur.x-zone.x,cur.y-zone.y)<2) return false;
    m._baitX=zone.x;
    m._baitY=zone.y;
    m._baitUntil=zone.until;
    m._baitKind=zone.kind||'meat';
    m._nextBaitScan=zone.until;
    m._frenzy=0;
    return true;
  }
  function nearestPiranhaBaitZone(m,now){
    prunePiranhaBaitZones(now);
    let best=null, bestD=PIRANHA_BAIT_ZONE_RADIUS*PIRANHA_BAIT_ZONE_RADIUS;
    for(const z of piranhaBaitZones){
      const dx=z.x-m.x, dy=z.y-m.y;
      const d2=dx*dx+dy*dy;
      if(d2<bestD){ best=z; bestD=d2; }
    }
    return best;
  }
  function broadcastPiranhaBait(zone,now){
    const r2=PIRANHA_BAIT_BROADCAST_RADIUS*PIRANHA_BAIT_BROADCAST_RADIUS;
    for(const other of mobs){
      if(other.id!=='PIRANHA' || !validMobState(other) || other.hp<=0) continue;
      const dx=other.x-zone.x, dy=other.y-zone.y;
      if(dx*dx+dy*dy<=r2) assignPiranhaBait(other,zone,now);
    }
  }
  function addPiranhaBaitZone(bait,now){
    if(!bait) return null;
    const duration=Math.max(1,Math.min(30,Number.isFinite(bait.duration)?bait.duration:5));
    const zone={
      x:Number.isFinite(bait.waterX)?bait.waterX:bait.x,
      y:Number.isFinite(bait.waterY)?bait.waterY:bait.y,
      kind:bait.kind||'meat',
      until:now+duration*1000
    };
    if(!finiteCoord(zone.x) || !finiteCoord(zone.y)) return null;
    piranhaBaitZones.push(zone);
    piranhaBaitZones.sort((a,b)=>a.until-b.until);
    while(piranhaBaitZones.length>PIRANHA_BAIT_ZONE_CAP) piranhaBaitZones.shift();
    broadcastPiranhaBait(zone,now);
    return zone;
  }
  function acquirePiranhaBait(m,getTile,setTile,now){
    if(!m || m.id!=='PIRANHA' || typeof getTile!=='function') return null;
    if(now < (m._nextBaitScan||0)) return null;
    m._nextBaitScan = now + PIRANHA_BAIT_SCAN_MS + Math.random()*PIRANHA_BAIT_SCAN_MS;
    const meatApi=MM && MM.meat;
    if(!meatApi || typeof meatApi.nearestWaterBait!=='function') return null;
    const bait=meatApi.nearestWaterBait(m.x,m.y,PIRANHA_BAIT_RADIUS,getTile);
    if(!bait) return null;
    if(typeof meatApi.consumeBaitAt==='function' && typeof setTile==='function'){
      meatApi.consumeBaitAt(bait.tx,bait.ty,getTile,setTile);
    }
    return addPiranhaBaitZone(bait,now);
  }
  function piranhaBaitTarget(m,getTile,setTile,now){
    now=Number.isFinite(now)?now:performance.now();
    const cur=currentPiranhaBait(m,now);
    if(cur) return cur;
    clearPiranhaBait(m);
    const zone=nearestPiranhaBaitZone(m,now) || acquirePiranhaBait(m,getTile,setTile,now);
    if(zone && assignPiranhaBait(m,zone,now)) return currentPiranhaBait(m,now);
    return zone || null;
  }
  function piranhaBoatAvoidance(m,dt,now,speed){
    if(!m || !(m._boatAvoidUntil>now) || !finiteCoord(m._boatAvoidX) || !finiteCoord(m._boatAvoidY)) return false;
    const dx=m.x-m._boatAvoidX, dy=m.y-m._boatAvoidY;
    const d=Math.hypot(dx,dy)||1;
    const sp=Math.max(4,Number(speed)||8);
    m.vx += (dx/d)*sp*dt*8.5;
    m.vy += (dy/d)*sp*dt*5.4;
    m.facing=dx>=0?1:-1;
    m._frenzy=0;
    return true;
  }
  function piranhaIgnoresPrey(mob,spec){
    if(!mob || !spec) return true;
    if(PIRANHA_IGNORE_PREY[mob.id]) return true;
    return !!spec.piranhaIgnore;
  }
  function piranhaWaterAt(getTile,x,y){
    return typeof getTile==='function' && readMobTile(getTile,Math.floor(x),Math.floor(y))===T.WATER;
  }
  function piranhaMobInWater(m,spec,getTile){
    if(!m || !spec || typeof getTile!=='function') return false;
    const body=bodyHalfExtents(m,spec);
    const ys=[m.y, m.y-body.halfH*0.22, m.y+body.halfH*0.28];
    return ys.some(y=>piranhaWaterAt(getTile,m.x,y));
  }
  function piranhaExternalTargetInWater(t,getTile){
    if(!t || typeof getTile!=='function') return false;
    const aimY=t.aimY==null ? t.y : t.aimY;
    const ys=[aimY,t.y,(aimY+t.y)*0.5,t.y+0.35];
    return ys.some(y=>Number.isFinite(y) && piranhaWaterAt(getTile,t.x,y));
  }
  function piranhaTargetPoint(t){
    if(!t) return {x:0,y:0};
    if(t.kind==='hero') return {x:t.x,y:t.aimY==null ? t.y+0.12 : t.aimY};
    if(t.kind==='mob') return {x:t.x,y:t.aimY==null ? t.y : t.aimY};
    if(t.kind==='companion') return companionTargetPoint(t);
    if(isInvasionTarget(t)) return alienTargetPoint(t);
    return {x:t.x,y:t.aimY==null ? t.y : t.aimY};
  }
  function considerPiranhaPrey(best,m,target,limitD2){
    if(!target) return best;
    const p=piranhaTargetPoint(target);
    const dx=p.x-m.x, dy=p.y-m.y;
    const d2=dx*dx+dy*dy;
    if(d2>limitD2) return best;
    if(!best || d2<best.d2) return {target,d2};
    return best;
  }
  function nearestPiranhaMobPrey(m,getTile,range,bestD2){
    let best=null;
    const limitD2=Math.max(0.1,Number.isFinite(bestD2)?bestD2:range*range);
    for(const o of mobs){
      if(o===m || !validMobState(o) || o.hp<=0) continue;
      const ospec=SPECIES[o.id];
      if(piranhaIgnoresPrey(o,ospec)) continue;
      if(!piranhaMobInWater(o,ospec,getTile)) continue;
      const body=bodyHalfExtents(o,ospec);
      const target={kind:'mob', id:o.id, raw:o, x:o.x, y:o.y, aimY:o.y, tx:Math.floor(o.x), ty:Math.floor(o.y), hp:o.hp, maxHp:o.maxHp, vx:o.vx||0, vy:o.vy||0, touchRadius:Math.max(0.9,Math.min(1.55,0.65+Math.max(body.halfW,body.halfH)*0.55))};
      best=considerPiranhaPrey(best,m,target,limitD2);
    }
    return best;
  }
  function piranhaPreyTarget(m,hero,getTile,range){
    if(!m || m.id!=='PIRANHA' || typeof getTile!=='function') return null;
    const r=Math.max(1,Number.isFinite(range)?range:PIRANHA_PREY_RANGE);
    const limitD2=r*r;
    let best=null;
    if(heroInSeaWater(hero,getTile)){
      best=considerPiranhaPrey(best,m,{kind:'hero', raw:hero, x:hero.x, y:hero.y, aimY:hero.y+0.12, hp:hero.hp, maxHp:hero.maxHp, vx:hero.vx||0, vy:hero.vy||0, touchRadius:0.9},limitD2);
    }
    const mobBest=nearestPiranhaMobPrey(m,getTile,r,best ? best.d2 : limitD2);
    if(mobBest) best=mobBest;
    const opts={source:'piranha',inWater:true,getTile};
    const cmp=nearestCompanionTarget(m.x,m.y,r,opts);
    if(cmp && piranhaExternalTargetInWater(cmp,getTile)) best=considerPiranhaPrey(best,m,Object.assign({touchRadius:1.05},cmp),best ? best.d2 : limitD2);
    const alien=nearestAlienTarget(m.x,m.y,r,opts);
    if(alien && piranhaExternalTargetInWater(alien,getTile)) best=considerPiranhaPrey(best,m,Object.assign({touchRadius:1.05},alien),best ? best.d2 : limitD2);
    return best && best.target ? best.target : null;
  }
  function damagePiranhaPrey(target,dmg,srcX,srcY,cause){
    if(!target) return false;
    if(target.kind==='hero'){
      damagePlayer(dmg,srcX,srcY,cause||'piranha',SPECIES.PIRANHA);
      return true;
    }
    if(target.kind==='mob' && target.raw && target.raw.hp>0){
      damageMob(target.raw,dmg,{source:'piranha',cause:cause||'piranha'});
      return true;
    }
    if(target.kind==='companion') return damageCompanionTarget(target,dmg,srcX,srcY,cause||'piranha');
    if(isInvasionTarget(target)) return damageAlienTarget(target,dmg,srcX,srcY,cause||'piranha','mob');
    return false;
  }
  function waterColumnAt(tx,ty,getTile){
    if(readMobTile(getTile,tx,ty)!==T.WATER) return null;
    let top=ty, bottom=ty;
    for(let scan=0; scan<32 && readMobTile(getTile,tx,top-1)===T.WATER; scan++) top--;
    for(let scan=0; scan<32 && readMobTile(getTile,tx,bottom+1)===T.WATER; scan++) bottom++;
    return {top,bottom,depth:bottom-top+1};
  }
  function nearestWaterCell(tx,ty,getTile,rx,ry){
    let best=null, bestD=Infinity;
    const maxR=Math.max(rx||7,ry||7);
    for(let r=0; r<=maxR; r++){
      for(let dy=-Math.min(ry||7,r); dy<=Math.min(ry||7,r); dy++){
        for(let dx=-Math.min(rx||7,r); dx<=Math.min(rx||7,r); dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const nx=tx+dx, ny=ty+dy;
          if(readMobTile(getTile,nx,ny)!==T.WATER) continue;
          const d=dx*dx+dy*dy;
          if(d<bestD){ bestD=d; best={x:nx+0.5,y:ny+0.5,tileX:nx,tileY:ny,d2:d}; }
        }
      }
      if(best) break;
    }
    return best;
  }
  function initWaterAnchor(m,getTile){
    // Determine the top water tile in this column (scan upward until not water)
    let ty = Math.floor(m.y);
    const tx = Math.floor(m.x);
    let col=waterColumnAt(tx,ty,getTile);
    if(!col){
      const best=nearestWaterCell(tx,ty,getTile,8,8);
      if(best){
        m.x=best.x; m.y=best.y; m.vx*=0.25; m.vy*=0.25;
        col=waterColumnAt(best.tileX,best.tileY,getTile);
      }
    }
    if(!col){
      const stranded=(typeof m.strandedTime==='number' && isFinite(m.strandedTime)) ? m.strandedTime : 0;
      m.waterTopY=ty;
      m.waterBottomY=ty;
      m.desiredDepth=0;
      m.nextWaterScan = performance.now() + 1000;
      m.strandedTime = stranded;
      return false;
    }
    m.waterTopY = col.top; // y of first water tile at surface (there is air or non-water above waterTopY-1)
    m.waterBottomY = col.bottom;
    // pick desired depth (1-3 tiles below surface) but ensure within existing water column
    const maxDepth=Math.max(0,col.depth-1);
    const preferred=Math.min(maxDepth, 1 + ((Math.random()*2)|0));
    m.desiredDepth = Math.max(0, preferred);
    m.nextWaterScan = performance.now() + 4000 + Math.random()*4000;
    m.strandedTime = 0;
    return true;
  }

  function clampStrictAquaticColumn(m,spec,getTile,dt){
    if(!spec || !spec.strictWater || typeof getTile!=='function') return false;
    const tx=Math.floor(m.x), ty=Math.floor(m.y);
    if(readMobTile(getTile,tx,ty)!==T.WATER){
      const best=nearestWaterCell(tx,ty,getTile,10,10);
      if(best){
        m.x=best.x; m.y=best.y;
        m.vx*=0.18; m.vy*=0.18;
        if(m.vy<0) m.vy=0;
        m.strandedTime=0;
        initWaterAnchor(m,getTile);
        return true;
      }
      m.strandedTime = ((typeof m.strandedTime==='number' && isFinite(m.strandedTime)) ? m.strandedTime : 0) + dt;
      m.vx*=0.35;
      if(m.vy<0) m.vy=0;
      m.vy += 0.08;
      if(m.strandedTime>0.5){ m.hp=0; m._naturalDeath=true; }
      return false;
    }
    const col=waterColumnAt(tx,ty,getTile);
    if(!col) return false;
    const topLimit=col.top+0.24;
    const bottomLimit=col.bottom+0.76;
    m.waterTopY=col.top;
    m.waterBottomY=col.bottom;
    m.desiredDepth=Math.max(0, Math.min(m.desiredDepth||0, col.depth-1));
    if(m.y<topLimit){ m.y=topLimit; if(m.vy<0) m.vy=0; }
    if(m.y>bottomLimit){ m.y=bottomLimit; if(m.vy>0) m.vy=0; }
    const stepDt=Math.max(0.016, Math.min(0.12, (dt>0 && isFinite(dt)) ? dt : 0.016));
    if(m.vy<0 && m.y + m.vy*stepDt < topLimit) m.vy=0;
    if(m.vy>0 && m.y + m.vy*stepDt > bottomLimit) m.vy=0;
    return true;
  }

  // Aquatic enforcement (moved earlier so it's definitely defined before any habitatUpdate calls)
  function enforceAquatic(m, spec, getTile, dt){
    const nowP = performance.now();
    const strictWater=!!(spec && spec.strictWater);
    if(typeof m.waterTopY!=='number' || typeof m.nextWaterScan!=='number' || nowP>m.nextWaterScan){ initWaterAnchor(m,getTile); }
    const tx = Math.floor(m.x); const ty=Math.floor(m.y);
    const here = getTile(tx,ty);
    if(here!==T.WATER){
      m.strandedTime = ((typeof m.strandedTime==='number' && isFinite(m.strandedTime)) ? m.strandedTime : 0) + dt;
      const best=nearestWaterCell(tx,ty,getTile,8,8);
      if(best){
        m.vx += (best.x - m.x)*3*dt; m.vy += (best.y - m.y)*3*dt;
        if(strictWater || best.d2>9 || m.strandedTime>0.35){ m.x=best.x; m.y=best.y; m.vx*=0.25; m.vy*=0.25; if(strictWater && m.vy<0) m.vy=0; initWaterAnchor(m,getTile); m.strandedTime = 0; }
      } else {
        m.vx *= 0.6; m.vy += 0.15; if(m.strandedTime>1.6){ m.hp=0; m._naturalDeath=true; }
      }
      return;
    } else { m.strandedTime = 0; }
    if(typeof m.waterTopY==='number'){
      let col=waterColumnAt(Math.floor(m.x), Math.floor(m.y), getTile);
      if(!col || getTile(Math.floor(m.x), m.waterTopY)!==T.WATER){ initWaterAnchor(m,getTile); col=waterColumnAt(Math.floor(m.x), Math.floor(m.y), getTile); }
      if(col){
        m.waterTopY=col.top; m.waterBottomY=col.bottom;
        m.desiredDepth=Math.max(0, Math.min(m.desiredDepth||0, col.depth-1));
        if(m.y<col.top+0.18){ m.y=col.top+0.18; if(m.vy<0) m.vy=0; }
        if(m.y>col.bottom+0.82){ m.y=col.bottom+0.55; if(m.vy>0) m.vy=0; }
      }
  const targetY = m.waterTopY + (m.desiredDepth||0) + 0.45 + Math.sin(nowP*0.001 + m.spawnT*0.0003)*0.18;
      const dy = targetY - m.y; m.vy += dy * Math.min(1, dt*2.2);
      const above = getTile(Math.floor(m.x), Math.floor(m.y-0.6));
      if(above!==T.WATER){ if(m.vy < 0) m.vy *= 0.2; m.vy += 0.04; }
      // Swimmers cruising near the surface stir up small wake ripples
      if(Math.random()<0.02 && Math.abs(m.y-(m.waterTopY+0.8))<1.0){ try{ if(MM.water && MM.water.disturb) MM.water.disturb(Math.floor(m.x), (Math.random()-0.5)*90); }catch(e){} }
    }
    if(Math.abs(m.vx)>0.01){
      const aheadX = Math.floor(m.x + Math.sign(m.vx)*0.7);
      const aheadY = Math.floor(m.y);
      const ahead = getTile(aheadX, aheadY);
      if(ahead!==T.WATER){
        m.vx *= -0.55; m.vy += (Math.random()*0.6 -0.3);
        const inwardX = Math.floor(m.x - Math.sign(m.vx)*1);
        if(getTile(inwardX, aheadY)===T.WATER){ m.vx += (inwardX + 0.5 - m.x)*0.4; }
      }
    }
  const maxS = (spec.speed * (m.speedMul||1)) * 1.2; const sp=Math.hypot(m.vx,m.vy); if(sp>maxS){ const s=maxS/sp; m.vx*=s; m.vy*=s; }
    if(strictWater) clampStrictAquaticColumn(m,spec,getTile,dt);
  }

  function forceSpawn(specId, player, getTile){ const spec=SPECIES[specId]; if(!spec) return false; if((speciesCounts[specId]||0) >= spec.max) return false; // cap
    if(!player || !finiteCoord(player.x) || !finiteCoord(player.y) || typeof getTile!=='function') return false;
    // try valid spawn positions first
    for(let tries=0; tries<20; tries++){ const dx=(Math.random()*10 -5); const dy=(Math.random()*6 -3); const tx=Math.floor(player.x+dx); const ty=Math.floor(player.y+dy); if(spec.spawnTest(tx,ty,getTile)){ mobs.push(create(spec, tx+0.5, ty+0.5, getTile)); return true; } }
    if(spec.aquatic) return false;
    // fallback: drop directly near player even if test fails
    mobs.push(create(spec, player.x + (Math.random()*2-1), player.y - 0.5, getTile)); return true; }
  function spawnSeasonalHallmark(season, player, getTile){
    const id=seasonHallmarkSpeciesId(season);
    if(!id) return false;
    const p=player || window.player;
    const gt=(typeof getTile==='function') ? getTile : (WORLD && WORLD.getTile);
    return forceSpawn(id,p,gt);
  }

  function countSpecies(id){ return speciesCounts[id]||0; }
  function localMobCounts(player,radius){
    const r2=radius*radius;
    const out={total:0, bySpecies:{}};
    for(const m of mobs){
      if(!validMobState(m)) continue;
      const dx=m.x-player.x, dy=m.y-player.y;
      if(dx*dx+dy*dy>r2) continue;
      out.total++;
      out.bySpecies[m.id]=(out.bySpecies[m.id]||0)+1;
    }
    return out;
  }
  function localCapFor(spec){
    if(typeof spec.localMax==='number') return Math.max(0, spec.localMax|0);
    const scale = spec.aquatic ? 0.28 : (spec.flying ? 0.22 : 0.24);
    return Math.max(1, Math.min(spec.max||8, Math.ceil((spec.max||8)*scale)));
  }
  function seasonAnimalMultiplier(spec){
    if(!spec || spec.organic===false || spec.id==='ZLOTY') return 1;
    try{
      const seasons=MM.seasons;
      const p=seasons && typeof seasons.profile==='function' ? seasons.profile() : null;
      const v=p && p.animalSpawnMult;
      const broad=(typeof v==='number' && isFinite(v)) ? Math.max(0.05, Math.min(3, v)) : 1;
      const h=mobHostilityAt((window.player && finiteCoord(window.player.x)) ? window.player.x : 0);
      return Math.max(0.02, Math.min(4.2, broad * seasonalSpeciesFactor(spec) * (h.mobSpawnMult || 1)));
    }catch(e){ return 1; }
  }
  function seasonAdjustedLocalCap(spec){
    const cap=localCapFor(spec);
    const mult=seasonAnimalMultiplier(spec);
    if(mult===1) return cap;
    return Math.max(1, Math.round(cap * (0.35 + 0.65 * mult)));
  }
  function biomeAffinity(spec, biome){
    if(spec.alwaysAggro && spec.biome==null) return 0.35;
    const b=spec.biome;
    if(b==='any') return 0.85;
    if(b==='forest') return biome===0?1:0.08;
    if(b==='plains') return biome===1?1:0.10;
    if(b==='snow') return biome===2?1:0.08;
    if(b==='desert') return biome===3?1:0.08;
    if(b==='swamp') return biome===4?1:0.08;
    if(b==='jungle') return (biome===0 || biome===4)?1:0.06;
    if(b==='shore') return (biome===5 || biome===6 || biome===3)?0.75:0.04;
    if(b==='sea') return biome===5?1:0.03;
    if(b==='mountain') return biome===7?1:0.08;
    if(b==='city') return biome===8?1:0.03;
    if(spec.aquatic) return (biome===5 || biome===6 || biome===4)?0.85:0.18;
    return 0.35;
  }
  function findEcologicalSpawn(spec,player,getTile){
    const tries=spec.aquatic?22:16;
    for(let a=0;a<tries;a++){
      const side=Math.random()<0.5?-1:1;
      const dx=side*(ECO_INNER_RADIUS + Math.random()*(ECO_LOCAL_RADIUS-ECO_INNER_RADIUS));
      const dy=(spec.aquatic?(-12+Math.random()*28):(-10+Math.random()*18));
      const tx=Math.floor(player.x+dx), ty=Math.floor(player.y+dy);
      if(Math.abs(tx-player.x)<ECO_INNER_RADIUS && Math.abs(ty-player.y)<10) continue;
      if(spec.spawnTest(tx,ty,getTile)) return {x:tx+0.5,y:ty+0.5};
    }
    return null;
  }
  function countSpeciesNear(id,x,y,radius){
    const r2=radius*radius;
    let n=0;
    for(const m of mobs){
      if(m.id!==id || !validMobState(m) || m.hp<=0) continue;
      const dx=m.x-x, dy=m.y-y;
      if(dx*dx+dy*dy<=r2) n++;
    }
    return n;
  }
  function findPiranhaAmbushSpawn(player,getTile){
    const spec=SPECIES.PIRANHA;
    if(!spec) return null;
    for(let tries=0; tries<48; tries++){
      const ang=Math.random()*Math.PI*2;
      const r=3.5+Math.random()*11.5;
      const tx=Math.floor(player.x+Math.cos(ang)*r);
      const ty=Math.floor(player.y-1+Math.random()*5);
      if(spec.spawnTest(tx,ty,getTile)) return {x:tx+0.5,y:ty+0.5};
    }
    const px=Math.floor(player.x), py=Math.floor(player.y);
    for(let r=2; r<=13; r++){
      for(let dy=-Math.min(4,r); dy<=Math.min(5,r); dy++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const tx=px+dx, ty=py+dy;
          if(spec.spawnTest(tx,ty,getTile)) return {x:tx+0.5,y:ty+0.5};
        }
      }
    }
    return null;
  }
  function tryPiranhaAmbush(player,getTile,now){
    const spec=SPECIES.PIRANHA;
    if(!spec || typeof getTile!=='function' || !heroInSeaWater(player,getTile)) return;
    if(now<spawnFreezeUntil) return;
    if(now<nextPiranhaAmbush) return;
    nextPiranhaAmbush=now+850+Math.random()*850;
    const local=countSpeciesNear('PIRANHA',player.x,player.y,28);
    const target=Math.max(6,Math.min(spec.localMax||12, 8+Math.floor(Math.random()*4)));
    if(local>=target || countSpecies('PIRANHA')>=spec.max) return;
    const localAll=localMobCounts(player,32);
    const cap=Math.max(ECO_TOTAL_LOCAL_CAP+6, Math.round(ECO_TOTAL_LOCAL_CAP*1.25));
    if(localAll.total>=cap) return;
    const want=Math.min(spec.spawnBatch||6, target-local, spec.max-countSpecies('PIRANHA'), cap-localAll.total);
    let born=0;
    for(let i=0;i<want;i++){
      const spot=findPiranhaAmbushSpawn(player,getTile);
      if(!spot) break;
      mobs.push(create(spec,spot.x,spot.y,getTile));
      born++;
    }
    if(born>0){
      setAggro('PIRANHA');
      try{
        if(window.msg && (!tryPiranhaAmbush._warnAt || now-tryPiranhaAmbush._warnAt>9000)){
          tryPiranhaAmbush._warnAt=now;
          window.msg('Piranie! Ocean zyje - uciekaj na lodz!');
        }
      }catch(e){}
    }
  }

  let nextGoldGuardianScan = 0;
  function spawnGoldGuardianGroup(vein,getTile){
    if(!vein || typeof getTile!=='function') return 0;
    let born=0;
    let kind=goldGuardianKindForVein(vein);
    if(kind==='dragon' && countSpecies('GOLD_DRAGON')>=((SPECIES.GOLD_DRAGON&&SPECIES.GOLD_DRAGON.max)||0)) kind='dwarf';
    if(kind==='dragon'){
      const spec=SPECIES.GOLD_DRAGON;
      const spot=spec && findGoldGuardianSpawnNear(vein.x,vein.y,getTile,'dragon');
      if(spot){
        const m=attachGoldGuardState(create(spec,spot.x,spot.y,getTile),vein,spot);
        mobs.push(m);
        born++;
      } else {
        kind='dwarf';
      }
    }
    if(kind==='dwarf'){
      const spec=SPECIES.GOLD_DWARF_GUARD;
      if(!spec) return born;
      const want=Math.max(1,Math.min(3,2+Math.floor((vein.signal.gold||0)/5)));
      for(let i=0; i<want && countSpecies('GOLD_DWARF_GUARD')<spec.max; i++){
        const spot=findGoldGuardianSpawnNear(vein.x,vein.y,getTile,'dwarf');
        if(!spot) break;
        const m=attachGoldGuardState(create(spec,spot.x+(i-1)*0.18,spot.y,getTile),vein,spot);
        mobs.push(m);
        born++;
      }
    }
    if(born>0){
      setAggro(born===1 && kind==='dragon' ? 'GOLD_DRAGON' : 'GOLD_DWARF_GUARD');
      try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks((vein.x+0.5)*(MM.TILE||20),(vein.y+0.5)*(MM.TILE||20),'epic',10); }catch(e){}
    }
    return born;
  }
  function tryGoldGuardianSpawn(player,getTile,now){
    if(!player || typeof getTile!=='function' || now<spawnFreezeUntil || now<nextGoldGuardianScan) return;
    nextGoldGuardianScan=now+GOLD_GUARD_SCAN_MS+Math.random()*GOLD_GUARD_SCAN_MS;
    if(countGoldGuardiansNear(player.x,player.y,34)>=GOLD_GUARD_LOCAL_CAP) return;
    const vein=scanGoldVeinNearPlayer(player,getTile);
    if(!vein || goldGuardianAlreadyForKey(vein.key)) return;
    spawnGoldGuardianGroup(vein,getTile);
  }

  let nextSpawnCheck = 0;
  function trySpawnNearPlayer(player, getTile, now){
  if(!player || !finiteCoord(player.x) || !finiteCoord(player.y) || typeof getTile!=='function') return;
  if(now < nextSpawnCheck) return; // throttle globally
  if(now < spawnFreezeUntil) { nextSpawnCheck = now + 500; return; }
    nextSpawnCheck = now + ECO_SPAWN_MIN_MS + Math.random()*ECO_SPAWN_JITTER_MS;
    const host=mobHostilityAt(player.x);
    const totalLocalCap=Math.max(ECO_TOTAL_LOCAL_CAP, Math.round(ECO_TOTAL_LOCAL_CAP * (host.mobLocalCapMult || 1)));
    const local=localMobCounts(player,ECO_LOCAL_RADIUS);
    if(local.total>=totalLocalCap) return;
    const biome=biomeAt(Math.floor(player.x));
    const candidates=[];
    for(const key in SPECIES){
      const spec=SPECIES[key];
      if(!speciesSeasonActive(spec)) continue;
      if(countSpecies(spec.id) >= spec.max) continue;
      const localCap=seasonAdjustedLocalCap(spec);
      const localCount=local.bySpecies[spec.id]||0;
      if(localCount>=localCap) continue;
      const affinity=biomeAffinity(spec,biome);
      if(affinity<=0.02) continue;
      const spawnChance=(typeof spec.spawnChance==='number' && isFinite(spec.spawnChance)) ? Math.max(0,Math.min(1,spec.spawnChance)) : 0.38;
      const deficit=Math.max(0,localCap-localCount);
      const weight=affinity*spawnChance*seasonAnimalMultiplier(spec)*(0.6+deficit/localCap);
      if(weight>0) candidates.push({spec,weight});
    }
    candidates.sort((a,b)=>b.weight-a.weight);
    let born=0;
    while(born<ECO_MAX_BIRTHS_PER_PASS && local.total+born<totalLocalCap && candidates.length){
      const totalWeight=candidates.reduce((s,c)=>s+c.weight,0);
      let pick=Math.random()*totalWeight, idx=0;
      for(; idx<candidates.length; idx++){ pick-=candidates[idx].weight; if(pick<=0) break; }
      const cand=candidates[Math.min(idx,candidates.length-1)];
      candidates.splice(Math.min(idx,candidates.length-1),1);
      const batch=(typeof cand.spec.spawnBatch==='number' && isFinite(cand.spec.spawnBatch)) ? Math.max(1,cand.spec.spawnBatch|0) : 1;
      const passCapForCandidate=Math.max(ECO_MAX_BIRTHS_PER_PASS,batch);
      for(let n=0; n<batch && born<passCapForCandidate && local.total+born<totalLocalCap; n++){
        const localCap=seasonAdjustedLocalCap(cand.spec);
        const localCount=local.bySpecies[cand.spec.id]||0;
        if(localCount>=localCap || countSpecies(cand.spec.id)>=cand.spec.max) break;
        const spot=findEcologicalSpawn(cand.spec,player,getTile);
        if(!spot) break;
        mobs.push(create(cand.spec, spot.x, spot.y, getTile));
        local.bySpecies[cand.spec.id]=localCount+1;
        born++;
      }
    }
  }

  // --- Steering Helpers (must be defined before update uses it) ---
  function applySeparation(m){
    // Look in neighboring grid cells only (same-species simple avoidance)
    const baseKey = m._cellKey; if(!baseKey) return; const [cxStr, cyStr] = baseKey.split(','); const cx=+cxStr, cy=+cyStr;
    for(let gx=cx-1; gx<=cx+1; gx++){
      for(let gy=cy-1; gy<=cy+1; gy++){
        const set = grid.get(gx+','+gy); if(!set) continue; for(const o of set){ if(o===m) continue; if(o.id!==m.id) continue; const dx=m.x-o.x; const dy=m.y-o.y; const d2=dx*dx+dy*dy; const minDist=0.6; if(d2>0 && d2 < minDist*minDist){ const d=Math.sqrt(d2); const push=(minDist-d)/d*0.5; // apply only to m to avoid double-count when o processed later
          m.vx += dx*push; m.vy += dy*push*0.2; }
        }
      }
    }
  }

  function isAggro(specId){ const exp=speciesAggro[specId]; return exp && exp> Date.now(); }

  function setAggro(specId){ speciesAggro[specId] = Date.now() + 5*60*1000; }
  function sourceIsHero(opts){
    if(opts===true) return true;
    if(!opts || typeof opts!=='object') return false;
    if(opts.hero===true) return true;
    const src=String(opts.source || opts.actor || opts.by || '').toLowerCase();
    return src==='hero' || src==='player' || src==='hero_mech' || src==='player_mech';
  }
  function combatElementFromOpts(opts){
    if(!opts || typeof opts!=='object') return '';
    const raw=String(opts.element || opts.cause || opts.kind || opts.type || opts.weaponType || '').toLowerCase();
    if(!raw) return '';
    if(raw.indexOf('fire')>=0 || raw.indexOf('flame')>=0 || raw.indexOf('burn')>=0 || raw.indexOf('heat')>=0 || raw.indexOf('lava')>=0) return 'fire';
    if(raw.indexOf('electric')>=0 || raw.indexOf('shock')>=0 || raw.indexOf('lightning')>=0 || raw.indexOf('laser')>=0) return 'electric';
    if(raw.indexOf('water')>=0 || raw.indexOf('hose')>=0 || raw.indexOf('drown')>=0 || raw.indexOf('pressure')>=0) return 'water';
    if(raw.indexOf('ice')>=0 || raw.indexOf('frost')>=0 || raw.indexOf('chill')>=0 || raw.indexOf('cold')>=0) return 'ice';
    if(raw.indexOf('gas')>=0 || raw.indexOf('poison')>=0 || raw.indexOf('toxic')>=0) return 'gas';
    if(raw.indexOf('explosion')>=0 || raw.indexOf('blast')>=0 || raw.indexOf('meteor')>=0) return 'blast';
    return '';
  }
  function markHeroAttack(m){
    if(!m) return false;
    const now=Date.now();
    m.heroFocusUntil=now+HERO_FOCUS_MS;
    m.heroFocusAt=now;
    return true;
  }
  function attackKindFromCause(cause,fallback){
    const raw=String(cause||fallback||'strike').toLowerCase();
    if(raw.indexOf('laser')>=0 || raw.indexOf('sentinel')>=0) return 'laser';
    if(raw.indexOf('dragon')>=0 || raw.indexOf('breath')>=0 || raw.indexOf('fire')>=0) return 'spit';
    if(raw.indexOf('spit')>=0) return 'spit';
    if(raw.indexOf('pick')>=0 || raw.indexOf('rock')>=0 || raw.indexOf('throw')>=0) return 'throw';
    if(raw.indexOf('sting')>=0 || raw.indexOf('poison')>=0) return 'sting';
    if(raw.indexOf('shock')>=0 || raw.indexOf('electric')>=0) return 'shock';
    if(raw.indexOf('ram')>=0 || raw.indexOf('charge')>=0) return 'charge';
    if(raw.indexOf('hammer')>=0 || raw.indexOf('slam')>=0) return 'slam';
    if(raw.indexOf('capture')>=0 || raw.indexOf('talon')>=0) return 'talon';
    if(raw.indexOf('bite')>=0 || raw.indexOf('claw')>=0 || raw.indexOf('thorn')>=0) return 'bite';
    return raw || 'strike';
  }
  function faceAttackTarget(m,target){
    if(!m || !target || !finiteCoord(target.x)) return;
    const dx=target.x-m.x;
    if(Math.abs(dx)>0.05) m.facing=dx>=0?1:-1;
  }
  function markMobTelegraph(m,kind,opts){
    if(!m) return false;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    opts=opts||{};
    const ms=clampFinite(opts.ms,MOB_ATTACK_TELEGRAPH_MS,90,1400);
    m._attackKind=attackKindFromCause(kind,kind);
    m._attackTelegraphUntil=Math.max(m._attackTelegraphUntil||0,now+ms);
    m._attackPower=clampFinite(opts.power,m._attackPower||1,0.25,3);
    if(opts.target) faceAttackTarget(m,opts.target);
    if(finiteCoord(opts.x)) m._attackTargetX=opts.x;
    if(finiteCoord(opts.y)) m._attackTargetY=opts.y;
    return true;
  }
  function markMobAttack(m,kind,opts){
    if(!m) return false;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    opts=opts||{};
    const attackKind=attackKindFromCause(kind,opts.cause);
    m._attackKind=attackKind;
    m._attackAt=now;
    m._attackFlashUntil=now+clampFinite(opts.strikeMs,MOB_ATTACK_STRIKE_MS,120,900);
    m._attackRecoverUntil=now+clampFinite(opts.recoverMs,MOB_ATTACK_RECOVER_MS,220,1600);
    m._attackTelegraphUntil=Math.max(m._attackTelegraphUntil||0,now+120);
    m._attackPower=clampFinite(opts.power,m._attackPower||1,0.25,3);
    if(opts.target) faceAttackTarget(m,opts.target);
    if(finiteCoord(opts.x)) m._attackTargetX=opts.x;
    if(finiteCoord(opts.y)) m._attackTargetY=opts.y;
    m.shake=Math.max(m.shake||0,Math.min(1.1,0.18+(m._attackPower||1)*0.18));
    markHeroAttack(m);
    return true;
  }
  function isHeroFocused(m,now){
    return !!(m && finiteNum(m.heroFocusUntil) && m.heroFocusUntil>(now||Date.now()));
  }
  function isMobHostile(m,now){
    if(!m || m.hp<=0) return false;
    if(isMobPacified(m,now)) return false;
    const spec=SPECIES[m.id];
    if(spec && spec.neverAggro) return false;
    return !!(spec && (spec.alwaysAggro || isAggro(m.id) || isHeroFocused(m,now) || isTempleGuardAggro(m,now)));
  }
  function mobAllowedByOpts(m,opts){
    if(!m) return false;
    const ex=(opts && opts.exclude)||[];
    if(ex.includes(m.id)) return false;
    if(opts && opts.hostileOnly && !isMobHostile(m)) return false;
    return true;
  }
  function noteDamageSource(m,opts){
    if(!m) return;
    const heroHit=sourceIsHero(opts);
    if(opts && typeof opts==='object'){
      const src=opts.source || opts.actor || opts.by;
      const cause=opts.cause || opts.element;
      if(src!=null) m._lastDamageSource=String(src);
      if(cause!=null) m._lastDamageCause=String(cause);
    } else if(opts===true) {
      m._lastDamageSource='hero';
    }
    m._lastHeroHitSpecial=heroHit ? !!(opts && typeof opts==='object' && opts.specialAttack) : false;
    m._lastHeroHitLucky=heroHit ? !!(opts && typeof opts==='object' && opts.luckyStrike) : false;
    m._lastHeroHitElement=heroHit ? combatElementFromOpts(opts) : '';
    if(heroHit) markHeroAttack(m);
  }
  function nearestCompanionTarget(wx,wy,range,opts){
    try{
      const api=MM.companions;
      if(api && typeof api.nearestForEnemy==='function') return api.nearestForEnemy(wx,wy,range,opts);
    }catch(e){}
    return null;
  }
  function nearestAlienTarget(wx,wy,range,opts){
    try{
      const api=MM.invasions;
      if(api && typeof api.nearestForEnemy==='function') return api.nearestForEnemy(wx,wy,range,opts);
    }catch(e){}
    return null;
  }
  function isInvasionTarget(t){
    return !!(t && (t.kind==='alien' || t.kind==='molekin'));
  }
  function companionTargetPoint(t){
    return {x:t.x, y:t.aimY==null ? t.y : t.aimY};
  }
  function alienTargetPoint(t){
    return {x:t.x, y:t.aimY==null ? t.y : t.aimY};
  }
  function damageCompanionTarget(t,dmg,srcX,srcY,cause){
    if(!t) return false;
    try{
      const api=MM.companions;
      if(api && typeof api.damageAtWorld==='function') return !!api.damageAtWorld(t.x,t.aimY==null ? t.y : t.aimY,dmg,{source:'mob',cause:cause||'mob',srcX,srcY,knockback:2.8});
      if(api && typeof api.damageAt==='function') return !!api.damageAt(t.tx==null ? Math.floor(t.x) : t.tx,t.ty==null ? Math.floor(t.y) : t.ty,dmg,{source:'mob',cause:cause||'mob',srcX,srcY});
    }catch(e){}
    return false;
  }
  function damageAlienTarget(t,dmg,srcX,srcY,cause,source){
    if(!t) return false;
    try{
      const api=MM.invasions;
      const wy=t.aimY==null ? t.y : t.aimY;
      const src=source || (cause==='piranha' ? 'mob' : 'sentinel');
      if(api && typeof api.damageAtWorld==='function') return !!api.damageAtWorld(t.x,wy,dmg,{source:src,cause:cause||'sentinel',srcX,srcY});
      if(api && typeof api.damageAt==='function') return !!api.damageAt(t.tx==null ? Math.floor(t.x) : t.tx,t.ty==null ? Math.floor(wy) : t.ty,dmg,{source:src,cause:cause||'sentinel',srcX,srcY});
    }catch(e){}
    return false;
  }
  function combatTargetForMob(m,hero,aggressive,range){
    if(!aggressive || !m || !hero) return hero;
    const cmp=nearestCompanionTarget(m.x,m.y,range||16);
    if(!cmp) return hero;
    const cp=companionTargetPoint(cmp);
    const cdx=cp.x-m.x, cdy=cp.y-m.y;
    const hdx=hero.x-m.x, hdy=hero.y-m.y;
    const c2=cdx*cdx+cdy*cdy;
    const h2=hdx*hdx+hdy*hdy;
    if(c2<h2*1.18 || h2>(range||16)*(range||16)) return cmp;
    return hero;
  }

  let frame=0; let lastMetricsSample=0; let metrics={count:0, active:0, dtAvg:0, sunriseBurns:0, goldGuardians:0};
  function sunriseBurnOptions(spec){
    const cfg=spec && spec.sunriseBurn;
    const dur=(cfg && typeof cfg==='object' && finiteNum(cfg.dur)) ? cfg.dur : DEFAULT_SUNRISE_BURN.dur;
    const dps=(cfg && typeof cfg==='object' && finiteNum(cfg.dps)) ? cfg.dps : DEFAULT_SUNRISE_BURN.dps;
    return {dur,dps,source:'sunrise'};
  }
  function applySunriseBurn(now){
    let lit=0;
    for(const m of mobs){
      if(!validMobState(m) || m.hp<=0) continue;
      const spec=SPECIES[m.id];
      if(!spec || !spec.sunriseBurn) continue;
      if(applyStatus(m,'burn',sunriseBurnOptions(spec))){
        m._sunriseBurnAt=now;
        lit++;
      }
    }
    if(lit) metrics.sunriseBurns=(metrics.sunriseBurns||0)+lit;
    return lit;
  }
  function updateSunriseBurnState(now){
    const isDay=cycleIsDay();
    if(isDay===null) return;
    if(isDay && lastDayState!==true) applySunriseBurn(now);
    lastDayState=isDay;
  }
  function bodyHalfExtents(m,spec){
    const body = spec.body || {w:1,h:1};
    const sc = m.scale || 1;
    return {halfW:(body.w||1)*0.5*sc, halfH:(body.h||1)*0.5*sc};
  }
  function safeHexColor(c,fallback){
    return (typeof c==='string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : fallback;
  }
  function mixHexColor(a,b,t){
    a=safeHexColor(a,'#999999');
    b=safeHexColor(b,'#ffffff');
    t=Math.max(0,Math.min(1,finiteNum(t)?t:0));
    const ca=hexToRgb(a), cb=hexToRgb(b);
    return rgbToHex(
      ca.r+(cb.r-ca.r)*t,
      ca.g+(cb.g-ca.g)*t,
      ca.b+(cb.b-ca.b)*t
    );
  }
  function rgbaHex(c,a){
    const rgb=hexToRgb(safeHexColor(c,'#ffffff'));
    return 'rgba('+rgb.r+','+rgb.g+','+rgb.b+','+Math.max(0,Math.min(1,a)).toFixed(3)+')';
  }
  function mobDeathSeed(m){
    let h=2166136261>>>0;
    const id=String(m && m.id || 'mob');
    for(let i=0;i<id.length;i++){ h^=id.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
    h^=(Math.floor((m.x||0)*997)>>>0); h=Math.imul(h,2246822519)>>>0;
    h^=(Math.floor((m.y||0)*1319)>>>0); h=Math.imul(h,3266489917)>>>0;
    h^=(Math.floor((m.spawnT||0)*17)>>>0);
    h^=((Math.random()*0xffffffff)>>>0);
    return h>>>0;
  }
  function deathRand(seed){
    let s=seed>>>0;
    return function(){
      s=(Math.imul(s,1664525)+1013904223)>>>0;
      return s/4294967296;
    };
  }
  function mobDeathStyle(m,spec,cause){
    if(m && (m.id==='ZLOTY' || m.id==='GOLD_DRAGON' || m.id==='GOLD_DWARF_GUARD')) return 'gold';
    if(cause==='burn' || cause==='fire' || cause==='flamethrower') return spec && spec.organic===false ? 'machine' : 'ash';
    if(spec && spec.aquatic) return 'splash';
    if(spec && spec.organic===false) return 'machine';
    if(m && m.id==='STRAZNIK') return 'machine';
    if(m && m.id==='SZKIELET') return 'bone';
    if(m && (m.id==='GHOUL' || m.id==='PELZACZ' || m.id==='BAT')) return 'shadow';
    if(spec && spec.flying) return 'feather';
    if(m && (m.id==='CRAB' || m.id==='JASZCZUR')) return 'shell';
    return 'creature';
  }
  function mobDeathCause(m,opts){
    const explicit=opts && (opts.cause || opts.element || opts.source);
    if(explicit) return String(explicit).toLowerCase();
    if(m && m._lastDamageCause) return String(m._lastDamageCause).toLowerCase();
    if(hasStatus(m,'burn')) return 'burn';
    if(hasStatus(m,'poison')) return 'poison';
    return 'hit';
  }
  function mobDeathAccent(style,base,cause){
    if(cause==='poison') return '#90e06e';
    if(style==='splash') return '#aee8ff';
    if(style==='machine') return '#64f4ff';
    if(style==='bone') return '#efe8d4';
    if(style==='shadow') return '#b7ff86';
    if(style==='gold') return '#fff1a8';
    if(style==='ash') return '#ffb15f';
    if(style==='feather') return mixHexColor(base,'#ffffff',0.36);
    return mixHexColor(base,'#ffffff',0.22);
  }
  function mobDeathShape(style,r){
    if(style==='splash') return r<0.70 ? 'drop' : 'bubble';
    if(style==='machine') return r<0.45 ? 'panel' : (r<0.78 ? 'spark' : 'wire');
    if(style==='bone') return r<0.54 ? 'bone' : (r<0.78 ? 'chip' : 'wisp');
    if(style==='shadow') return r<0.42 ? 'wisp' : (r<0.62 ? 'rag' : (r<0.82 ? 'bone' : 'spark'));
    if(style==='ash') return r<0.36 ? 'ash' : (r<0.54 ? 'wisp' : (r<0.78 ? 'bone' : 'spark'));
    if(style==='feather') return r<0.68 ? 'feather' : 'chip';
    if(style==='shell') return r<0.55 ? 'shell' : 'chip';
    if(style==='gold') return r<0.52 ? 'spark' : (r<0.76 ? 'feather' : 'chip');
    return r<0.50 ? 'chunk' : (r<0.66 ? 'bone' : (r<0.84 ? 'dust' : 'spark'));
  }
  function mobDeathCoreKind(style,r){
    if(style==='splash') return r<0.58 ? 'splashCrest' : 'dropCore';
    if(style==='machine') return r<0.32 ? 'sensor' : (r<0.64 ? 'gear' : 'panelCore');
    if(style==='bone') return r<0.28 ? 'skull' : (r<0.68 ? 'rib' : 'longBone');
    if(style==='shadow') return r<0.38 ? 'eyeWisp' : (r<0.72 ? 'rag' : 'smokeCore');
    if(style==='ash') return r<0.42 ? 'emberCore' : (r<0.72 ? 'ashCloud' : 'rag');
    if(style==='feather') return r<0.50 ? 'wing' : (r<0.78 ? 'featherCore' : 'eyeWisp');
    if(style==='shell') return r<0.48 ? 'shellPlate' : (r<0.76 ? 'tail' : 'leg');
    if(style==='gold') return r<0.44 ? 'starCore' : (r<0.72 ? 'haloShard' : 'panelCore');
    return r<0.30 ? 'bodyCore' : (r<0.56 ? 'headCore' : (r<0.76 ? 'limbCore' : (r<0.88 ? 'longBone' : 'tuft')));
  }
  function mobDeathResidueKind(style,r){
    if(style==='splash') return r<0.72 ? 'ripple' : 'droplet';
    if(style==='machine') return r<0.52 ? 'scorch' : (r<0.78 ? 'sparkResidue' : 'bolt');
    if(style==='bone') return r<0.48 ? 'bonePile' : (r<0.78 ? 'dustRing' : 'chip');
    if(style==='shadow') return r<0.70 ? 'shadowPool' : 'greenMote';
    if(style==='ash') return r<0.62 ? 'ashSmear' : 'ember';
    if(style==='feather') return r<0.62 ? 'feather' : 'dustRing';
    if(style==='shell') return r<0.62 ? 'shellShard' : 'scratch';
    if(style==='gold') return r<0.68 ? 'star' : 'glitter';
    return r<0.42 ? 'smear' : (r<0.72 ? 'dustRing' : 'tuft');
  }
  function mobDeathSignature(m,spec,style,cause,rnd){
    const body=spec && spec.body || {w:1,h:1};
    const area=(body.w||1)*(body.h||1)*Math.max(0.5,m && m.scale || 1);
    const size=area>3.0 ? 'huge' : (area>1.35 ? 'large' : (area<0.55 ? 'tiny' : 'small'));
    const motion=spec && spec.aquatic ? 'water' : (spec && spec.flying ? 'air' : (spec && spec.alwaysAggro ? 'hostile' : 'ground'));
    return style+':'+cause+':'+size+':'+motion+':'+Math.floor(rnd()*10000).toString(36);
  }
  function pushDeathPuff(fx,p,y){
    if(!fx || !p || !fx.puffs || fx.puffs.length>=18 || (p._puffCooldown||0)>0) return;
    p._puffCooldown=0.13;
    fx.puffs.push({
      x:p.x,
      y:Number.isFinite(y) ? y : p.y,
      life:0,
      max:0.24+((fx.seed>>>3)&7)*0.012,
      size:Math.max(0.10,Math.min(0.42,(p.size||0.08)*2.4)),
      color:p.color || fx.accent || '#cccccc',
      kind:fx.style==='splash'?'spray':(fx.style==='machine'||fx.style==='gold'?'spark':'dust'),
      phase:((fx.seed>>>7)&255)*0.031
    });
  }
  function deathFxTileOpen(getTile,x,y){
    if(!getTile || !Number.isFinite(x) || !Number.isFinite(y)) return true;
    const ty=Math.floor(y);
    if(!inWorldY(ty)) return false;
    const t=getTile(Math.floor(x),ty);
    return t===T.WATER || !isSolid(t);
  }
  function nearestDeathFxOpenPoint(x,y,getTile,limit){
    if(!getTile || deathFxTileOpen(getTile,x,y)) return {x,y,found:true};
    const tx=Math.floor(x), ty=Math.floor(y);
    const maxR=Math.max(1,Math.min(6,limit==null?4:limit|0));
    let best=null, bestScore=Infinity;
    for(let r=1; r<=maxR; r++){
      for(let dy=-r; dy<=r; dy++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const cx=tx+dx+0.5, cy=ty+dy+0.5;
          if(!deathFxTileOpen(getTile,cx,cy)) continue;
          const score=dx*dx+dy*dy + (dy>0?0.35:0) + (dy<0?0.08:0);
          if(score<bestScore){ bestScore=score; best={x:cx,y:cy,found:true}; }
        }
      }
      if(best) return best;
    }
    return {x,y,found:false};
  }
  function nearestDeathFxOpenPiecePoint(x,y,r,getTile,limit){
    if(!getTile || !Number.isFinite(x) || !Number.isFinite(y)) return {x,y,found:!getTile};
    if(!deathPieceOverlapsSolid(getTile,x,y,r)) return {x,y,found:true};
    const tx=Math.floor(x), ty=Math.floor(y);
    const maxR=Math.max(1,Math.min(6,limit==null?4:limit|0));
    let best=null, bestScore=Infinity;
    for(let rr=0; rr<=maxR; rr++){
      for(let dy=-rr; dy<=rr; dy++){
        for(let dx=-rr; dx<=rr; dx++){
          if(rr>0 && Math.max(Math.abs(dx),Math.abs(dy))!==rr) continue;
          const cx=tx+dx+0.5, cy=ty+dy+0.5;
          if(deathPieceOverlapsSolid(getTile,cx,cy,r)) continue;
          const score=dx*dx+dy*dy + (dy>0?0.35:0) + (dy<0?0.08:0);
          if(score<bestScore){ bestScore=score; best={x:cx,y:cy,found:true}; }
        }
      }
      if(best) return best;
    }
    return {x,y,found:false};
  }
  function clampDeathFxPartSpawn(fx,p,getTile){
    if(!p || !getTile) return;
    const radius=deathPieceRadius(p);
    if(!deathPieceOverlapsSolid(getTile,p.x,p.y,radius)) return;
    const safe=nearestDeathFxOpenPiecePoint(p.x,p.y,radius,getTile,3);
    if(!safe.found){
      p.x=fx.x; p.y=fx.y;
    } else {
      p.x=safe.x; p.y=safe.y;
    }
    if(Number.isFinite(p.vx)) p.vx*=0.24;
    if(Number.isFinite(p.vy)) p.vy=Math.min(-0.15, p.vy*0.18);
    if(Number.isFinite(p.spin)) p.spin*=0.4;
  }
  function deathPhysicsFrameBudget(){
    const ms=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    if(ms>36) return Math.round(MOB_DEATH_PHYSICS_FRAME_BUDGET*0.38);
    if(ms>25) return Math.round(MOB_DEATH_PHYSICS_FRAME_BUDGET*0.62);
    return MOB_DEATH_PHYSICS_FRAME_BUDGET;
  }
  function deathFloatyKind(kind){
    return kind==='wisp' || kind==='ash' || kind==='bubble' || kind==='smokeCore' || kind==='ashCloud' || kind==='eyeWisp';
  }
  function deathPieceRadius(p){
    if(!p) return 0.08;
    if(Number.isFinite(p.radius)) return p.radius;
    if(Number.isFinite(p.size)) return Math.max(0.045, Math.min(0.22, p.size*1.25));
    const w=Number.isFinite(p.w) ? p.w : 0.12;
    const h=Number.isFinite(p.h) ? p.h : 0.10;
    return Math.max(0.055, Math.min(0.34, Math.max(w,h)*0.46));
  }
  function primeDeathPhysics(p,fx,rnd,kind){
    if(!p) return p;
    const solid=!deathFloatyKind(kind||p.kind||p.shape);
    p.physics=solid;
    p.radius=deathPieceRadius(p);
    p.restitution=solid ? (fx.style==='machine'||fx.style==='gold'?0.38:(fx.style==='bone'?0.34:(fx.style==='shell'?0.30:0.25))) : 0.12;
    p.groundFriction=solid ? (fx.style==='machine'?0.83:(fx.style==='bone'||p.shape==='bone'||p.kind==='longBone'?0.88:0.76)) : 0.94;
    p.wallFriction=solid ? 0.78 : 0.88;
    p.spinFriction=solid ? 0.78 : 0.92;
    p.slideSpin=solid ? (0.45+(rnd?rnd():0.5)*0.35) : 0.08;
    p.travel=0;
    p.bounces=0;
    p.settleT=0;
    p.settled=false;
    return p;
  }
  function deathSolidTile(getTile,tx,ty){
    if(!getTile) return false;
    if(!inWorldY(ty)) return true;
    const t=getTile(tx,ty);
    return t!==T.WATER && isSolid(t);
  }
  function deathPieceOverlapsSolid(getTile,x,y,r){
    if(!getTile || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if(y-r<WORLD_TOP || y+r>=WORLD_BOTTOM) return true;
    const minX=Math.floor(x-r), maxX=Math.floor(x+r);
    const minY=Math.floor(y-r), maxY=Math.floor(y+r);
    for(let ty=minY; ty<=maxY; ty++){
      for(let tx=minX; tx<=maxX; tx++){
        if(!deathSolidTile(getTile,tx,ty)) continue;
        const cx=Math.max(tx,Math.min(x,tx+1));
        const cy=Math.max(ty,Math.min(y,ty+1));
        const dx=x-cx, dy=y-cy;
        if(dx*dx+dy*dy <= r*r) return true;
      }
    }
    return false;
  }
  function constrainDeathPieceRange(fx,p){
    if(!fx || !p) return;
    const maxR=Math.max(3.2, Math.min(8.5, 2.8 + (fx.bodyW||1)*0.65 + (fx.bodyH||1)*0.50));
    const dx=p.x-fx.x, dy=p.y-fx.y;
    const d=Math.hypot(dx,dy);
    if(!(d>maxR)) return;
    const nx=dx/(d||1), ny=dy/(d||1);
    p.x=fx.x+nx*maxR;
    p.y=fx.y+ny*maxR;
    p.vx*=0.18;
    p.vy*=0.18;
  }
  function moveDeathPieceAxis(fx,p,getTile,dx,dy){
    if(!dx && !dy) return false;
    const oldX=p.x, oldY=p.y;
    p.x+=dx; p.y+=dy;
    const r=deathPieceRadius(p);
    if(!deathPieceOverlapsSolid(getTile,p.x,p.y,r)) return false;
    let lo=0, hi=1;
    for(let i=0;i<5;i++){
      const mid=(lo+hi)*0.5;
      const nx=oldX+dx*mid, ny=oldY+dy*mid;
      if(deathPieceOverlapsSolid(getTile,nx,ny,r)) hi=mid;
      else lo=mid;
    }
    p.x=oldX+dx*Math.max(0,lo-0.02);
    p.y=oldY+dy*Math.max(0,lo-0.02);
    const impact=dx ? Math.abs(p.vx||0) : Math.abs(p.vy||0);
    p.bounces=(p.bounces||0)+1;
    if(dx){
      p.vx=impact>0.35 ? -(p.vx||0)*(p.restitution||0.24) : 0;
      p.vy=(p.vy||0)*(p.wallFriction||0.82);
      if(Number.isFinite(p.spin)) p.spin+=(p.vy||0)*0.08;
    } else {
      if(dy>0){
        p.onGround=true;
        p.vy=impact>1.05 ? -(p.vy||0)*(p.restitution||0.24) : 0;
        p.vx=(p.vx||0)*(p.groundFriction||0.78);
        if(Number.isFinite(p.spin)) p.spin+=(p.vx||0)*((p.slideSpin||0.45)/(r||0.1));
      } else {
        p.vy=impact>0.35 ? -(p.vy||0)*Math.max(0.12,(p.restitution||0.24)*0.72) : 0;
        p.vx=(p.vx||0)*(p.wallFriction||0.82);
      }
    }
    if(impact>1.25) pushDeathPuff(fx,p,p.y+r*0.55);
    return true;
  }
  function settleDeathPieceOnGround(p,dt){
    if(!p || !p.onGround) return;
    p.vx*=Math.pow(p.groundFriction||0.78,dt*8);
    p.spin*=Math.pow(p.spinFriction||0.82,dt*4);
    if(Math.abs(p.vx||0)<0.08 && Math.abs(p.vy||0)<0.08) p.settleT=(p.settleT||0)+dt;
    else p.settleT=0;
    if(p.settleT>0.24){
      p.settled=true;
      p.vx=0; p.vy=0; p.spin*=0.25;
    }
  }
  function integrateDeathPieceCheapPhysics(fx,p,getTile,dt){
    if(!p.physics || !getTile){
      const prevX=p.x, prevY=p.y;
      p.x+=(p.vx||0)*dt;
      p.y+=(p.vy||0)*dt;
      if(Number.isFinite(p.travel)) p.travel+=Math.hypot(p.x-prevX,p.y-prevY);
      resolveDeathPieceTerrain(fx,p,getTile,prevX,prevY);
      return;
    }
    if(p.settled){
      p.vx=0; p.vy=0; p.spin*=Math.pow(p.spinFriction||0.82,dt*10);
      return;
    }
    p.onGround=false;
    const oldX=p.x, oldY=p.y;
    moveDeathPieceAxis(fx,p,getTile,(p.vx||0)*dt,0);
    moveDeathPieceAxis(fx,p,getTile,0,(p.vy||0)*dt);
    if(Number.isFinite(p.travel)) p.travel+=Math.hypot(p.x-oldX,p.y-oldY);
    constrainDeathPieceRange(fx,p);
    if(!Number.isFinite(p.x) || !Number.isFinite(p.y)){ p.life=p.max+1; return; }
    if(p.onGround) settleDeathPieceOnGround(p,dt);
    else p.settleT=0;
  }
  function integrateDeathPiecePhysics(fx,p,getTile,dt){
    if(!p.physics || !getTile){
      const prevX=p.x, prevY=p.y;
      p.x+=(p.vx||0)*dt;
      p.y+=(p.vy||0)*dt;
      if(Number.isFinite(p.travel)) p.travel+=Math.hypot(p.x-prevX,p.y-prevY);
      resolveDeathPieceTerrain(fx,p,getTile,prevX,prevY);
      return;
    }
    if(p.settled){
      p.vx=0; p.vy=0; p.spin*=Math.pow(p.spinFriction||0.82,dt*10);
      return;
    }
    const speed=Math.max(Math.abs(p.vx||0),Math.abs(p.vy||0));
    const steps=Math.max(1,Math.min(MOB_DEATH_PHYSICS_MAX_STEPS,Math.ceil(speed*dt/0.22)));
    const sdt=dt/steps;
    p.onGround=false;
    for(let s=0;s<steps;s++){
      const oldX=p.x, oldY=p.y;
      moveDeathPieceAxis(fx,p,getTile,(p.vx||0)*sdt,0);
      moveDeathPieceAxis(fx,p,getTile,0,(p.vy||0)*sdt);
      if(Number.isFinite(p.travel)) p.travel+=Math.hypot(p.x-oldX,p.y-oldY);
      constrainDeathPieceRange(fx,p);
      if(!Number.isFinite(p.x) || !Number.isFinite(p.y)){ p.life=p.max+1; return; }
    }
    if(p.onGround){
      settleDeathPieceOnGround(p,dt);
    } else {
      p.settleT=0;
    }
  }
  function resolveDeathPieceTerrain(fx,p,getTile,prevX,prevY){
    if(!getTile || !p) return;
    if(!Number.isFinite(p.x) || !Number.isFinite(p.y)){
      p.life=p.max+1;
      return;
    }
    constrainDeathPieceRange(fx,p);
    const overlaps=p.physics
      ? deathPieceOverlapsSolid(getTile,p.x,p.y,deathPieceRadius(p))
      : !deathFxTileOpen(getTile,p.x,p.y);
    if(!overlaps) return;
    const hadPrev=Number.isFinite(prevX) && Number.isFinite(prevY) && (p.physics
      ? !deathPieceOverlapsSolid(getTile,prevX,prevY,deathPieceRadius(p))
      : deathFxTileOpen(getTile,prevX,prevY));
    if(hadPrev){
      const hitX=p.physics
        ? deathPieceOverlapsSolid(getTile,p.x,prevY,deathPieceRadius(p))
        : !deathFxTileOpen(getTile,p.x,prevY);
      const hitY=p.physics
        ? deathPieceOverlapsSolid(getTile,prevX,p.y,deathPieceRadius(p))
        : !deathFxTileOpen(getTile,prevX,p.y);
      p.x=prevX; p.y=prevY;
      if(hitX) p.vx*=-0.22; else p.vx*=0.42;
      if(hitY) p.vy*=-0.24; else p.vy*=0.36;
      if(Number.isFinite(p.spin)) p.spin*=0.55;
      pushDeathPuff(fx,p,p.y);
      return;
    }
    const safe=p.physics
      ? nearestDeathFxOpenPiecePoint(p.x,p.y,deathPieceRadius(p),getTile,3)
      : nearestDeathFxOpenPoint(p.x,p.y,getTile,3);
    if(safe.found){
      p.x=safe.x; p.y=safe.y;
      if(Number.isFinite(p.vx)) p.vx*=0.18;
      if(Number.isFinite(p.vy)) p.vy*=0.18;
      if(Number.isFinite(p.spin)) p.spin*=0.45;
      pushDeathPuff(fx,p,p.y);
      return;
    }
    p.life=p.max+1;
  }
  function deathFxGetTile(opts){
    if(opts && typeof opts.getTile==='function') return opts.getTile;
    if(typeof lastDeathFxGetTile==='function') return lastDeathFxGetTile;
    try{ if(MM && MM.world && typeof MM.world.getTile==='function') return MM.world.getTile; }catch(e){}
    try{ if(WORLD && typeof WORLD.getTile==='function') return WORLD.getTile; }catch(e){}
    return null;
  }
  function spawnMobDeathFx(m,opts){
    const spec=SPECIES[m && m.id];
    if(!m || !spec || m._deathFxSpawned || m._naturalDeath) return false;
    m._deathFxSpawned=true;
    const getTile=deathFxGetTile(opts);
    const cause=mobDeathCause(m,opts);
    const style=mobDeathStyle(m,spec,cause);
    const seed=mobDeathSeed(m);
    const rnd=deathRand(seed);
    const body=spec.body || {w:1,h:1};
    const sc=Math.max(0.5,Math.min(2.4,m.scale||1));
    const bw=Math.max(0.45,(body.w||1)*sc);
    const bh=Math.max(0.40,(body.h||1)*sc);
    const area=Math.max(0.20,bw*bh);
    const maxHp=Math.max(1,m.maxHp||spec.hp||1);
    const base=safeHexColor(m.baseColor, style==='bone'?'#dcd6c4':(style==='machine'?'#8f9aa6':'#a8a8a8'));
    const accent=mobDeathAccent(style,base,cause);
    const count=Math.max(8,Math.min(38,Math.round(8+area*8+Math.sqrt(maxHp)*1.25+(style==='machine'?5:0)+(style==='gold'?9:0))));
    const origin=nearestDeathFxOpenPoint(m.x,m.y-bh*0.18,getTile,5);
    const ox=origin.found ? origin.x : m.x;
    const oy=origin.found ? origin.y : m.y;
    const fx={
      id:m.id,
      x:ox,
      y:oy,
      sourceX:m.x,
      sourceY:m.y,
      tunnelClamped:!!(origin.found && (Math.abs(ox-m.x)>0.001 || Math.abs(oy-m.y)>0.001)),
      style,
      cause,
      life:0,
      max:style==='splash'?1.08:(style==='feather'?1.62:(style==='shadow'||style==='ash'?1.46:1.38)),
      seed,
      signature:mobDeathSignature(m,spec,style,cause,rnd),
      base,
      accent,
      bodyW:bw,
      bodyH:bh,
      core:[],
      fragments:[],
      rings:[],
      residue:[],
      puffs:[]
    };
    const coreCount=Math.max(3,Math.min(10,Math.round(2+area*1.35+(style==='machine'?2:0)+(style==='bone'?2:0)+(style==='gold'?2:0))));
    for(let i=0;i<coreCount;i++){
      const side=(i%2?1:-1);
      const kind=mobDeathCoreKind(style,rnd());
      const partScale=kind==='bodyCore'||kind==='panelCore'||kind==='shellPlate'||kind==='splashCrest' ? 1.0 : 0.62+rnd()*0.42;
      const col=kind==='sensor'||kind==='eyeWisp'||kind==='starCore' ? accent : (rnd()<0.66 ? base : mixHexColor(base,accent,0.38+rnd()*0.28));
      const part={
        kind,
        x:fx.x+(rnd()-0.5)*bw*0.35,
        y:fx.y-bh*(0.04+rnd()*0.34),
        ox:(rnd()-0.5)*bw*0.18,
        oy:-bh*(0.14+rnd()*0.30),
        vx:side*(0.82+rnd()*2.05)+(m.vx||0)*0.14,
        vy:-(1.05+rnd()*2.05)+(m.vy||0)*0.10,
        w:Math.max(0.10,bw*(0.18+rnd()*0.20)*partScale),
        h:Math.max(0.08,bh*(0.13+rnd()*0.22)*partScale),
        rot:(rnd()-0.5)*0.9,
        spin:(rnd()-0.5)*(style==='machine'?7.5:4.8),
        color:col,
        life:0,
        max:fx.max*(0.62+rnd()*0.34),
        alpha:0.78+rnd()*0.18,
        gravity:kind==='smokeCore'||kind==='ashCloud'||kind==='eyeWisp' ? -0.35-rnd()*0.35 : (style==='splash' ? -0.2 : 7.4+rnd()*2.4),
        drag:kind==='smokeCore'||kind==='ashCloud'||kind==='wing'||kind==='featherCore' ? 0.91+rnd()*0.06 : 0.76+rnd()*0.14,
        phase:rnd()*Math.PI*2
      };
      primeDeathPhysics(part,fx,rnd,kind);
      clampDeathFxPartSpawn(fx,part,getTile);
      fx.core.push(part);
    }
    const lift=style==='splash'?1.35:(style==='feather'?1.05:(style==='shadow'||style==='ash'?1.25:0.72));
    for(let i=0;i<count;i++){
      const ang=rnd()*Math.PI*2;
      const radial=0.38+rnd()*0.88;
      const speed=(style==='machine'?3.25:(style==='gold'?3.85:(style==='splash'?2.35:2.55))) * (0.55+rnd()*0.95);
      const shape=mobDeathShape(style,rnd());
      const hot=(cause==='burn' || cause==='fire' || cause==='flamethrower') && rnd()<0.38;
      const col=hot ? (rnd()<0.5?'#ffcf64':'#ff7a35') : (rnd()<0.55 ? base : accent);
      const size=(0.035+rnd()*0.075) * (shape==='panel'?1.45:(shape==='feather'?1.35:(shape==='bone'?1.25:1)));
      const frag={
        x:fx.x+(rnd()-0.5)*bw*0.55,
        y:fx.y-bh*(0.04+rnd()*0.36),
        vx:Math.cos(ang)*speed*radial+(m.vx||0)*0.08,
        vy:Math.sin(ang)*speed*0.58-lift*(0.45+rnd()*0.65)+(m.vy||0)*0.04,
        rot:rnd()*Math.PI*2,
        spin:(rnd()-0.5)*(style==='machine'?13:8),
        size,
        life:0,
        max:fx.max*(0.62+rnd()*0.42),
        color:col,
        shape,
        alpha:0.72+rnd()*0.28,
        gravity:shape==='wisp' ? -0.45-rnd()*0.35 : (shape==='feather' ? 2.0+rnd()*1.6 : (shape==='bubble' ? -0.55 : 8.0+rnd()*3.2)),
        drag:shape==='feather'||shape==='wisp'||shape==='bubble' ? 0.90+rnd()*0.08 : 0.74+rnd()*0.18,
        wobble:rnd()*Math.PI*2
      };
      primeDeathPhysics(frag,fx,rnd,shape);
      clampDeathFxPartSpawn(fx,frag,getTile);
      fx.fragments.push(frag);
    }
    const residueCount=Math.max(3,Math.min(16,Math.round(3+area*2.4+(style==='gold'?4:0)+(style==='splash'?3:0))));
    for(let i=0;i<residueCount;i++){
      const ang=rnd()*Math.PI*2;
      const rr=(0.08+rnd()*0.58)*(0.55+Math.min(2.4,area)*0.20);
      const kind=mobDeathResidueKind(style,rnd());
      const res={
        kind,
        x:fx.x+Math.cos(ang)*rr*bw,
        y:fx.y+bh*(0.10+rnd()*0.10)+Math.sin(ang)*rr*bh*0.22,
        rx:(0.10+rnd()*0.34)*(style==='splash'?1.35:1)*Math.max(0.65,bw),
        ry:(0.035+rnd()*0.12)*Math.max(0.65,bh),
        rot:(rnd()-0.5)*0.75,
        color:rnd()<0.58 ? base : accent,
        life:0,
        max:fx.max*(0.92+rnd()*0.78),
        alpha:0.18+rnd()*0.40,
        phase:rnd()*Math.PI*2
      };
      clampDeathFxPartSpawn(fx,res,getTile);
      fx.residue.push(res);
    }
    const ringCount=style==='splash'?2:(style==='machine'||style==='gold'?2:1);
    for(let i=0;i<ringCount;i++){
      fx.rings.push({
        delay:i*0.055,
        max:0.38+i*0.16+rnd()*0.12,
        radius:(0.42+area*0.18)*(1+i*0.36),
        squash:0.36+rnd()*0.18,
        color:i===0?accent:base
      });
    }
    mobDeathFx.push(fx);
    while(mobDeathFx.length>MOB_DEATH_FX_CAP) mobDeathFx.shift();
    metrics.deathFx=mobDeathFx.length;
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && style==='splash' && p.spawnSplash) p.spawnSplash(fx.x*tile,fx.y*tile,Math.min(1,0.35+area*0.25));
      else if(p && style==='machine' && p.spawnSparks) p.spawnSparks(fx.x*tile,(fx.y-bh*0.20)*tile,'electric',Math.min(14,6+Math.round(area*4)));
      else if(p && (style==='ash' || cause==='burn') && p.spawnSmoke) p.spawnSmoke(fx.x*tile,(fx.y-bh*0.20)*tile,1.0+area*0.45,{tileSize:tile,tileX:Math.floor(fx.x),tileY:Math.floor(fx.y)});
      else if(p && p.spawnSparks) p.spawnSparks(fx.x*tile,(fx.y-bh*0.20)*tile,style==='gold'?'epic':'common',Math.min(12,4+Math.round(area*3)));
    }catch(e){}
    return true;
  }
  function updateMobDeathFx(dt,getTile){
    const moveDt=Math.min(MOB_DEATH_PHYSICS_MAX_DT,Math.max(0,dt||0));
    let physicsBudget=deathPhysicsFrameBudget();
    for(let i=mobDeathFx.length-1;i>=0;i--){
      const fx=mobDeathFx[i];
      fx.life+=dt;
      let alive=fx.life<fx.max+0.45;
      for(const r of fx.residue||[]){
        r.life+=dt;
        if(r.life<=r.max) alive=true;
      }
      for(const p of fx.puffs||[]){
        p.life+=dt;
        const prevX=p.x, prevY=p.y;
        p.y-=dt*(p.kind==='spark'?0.32:0.10);
        p.size+=dt*(p.kind==='spark'?0.42:0.24);
        if(!deathFxTileOpen(getTile,p.x,p.y)){
          if(deathFxTileOpen(getTile,prevX,prevY)){
            p.x=prevX; p.y=prevY;
          } else {
            const safe=nearestDeathFxOpenPoint(p.x,p.y,getTile,2);
            if(safe.found){ p.x=safe.x; p.y=safe.y; }
            else p.life=p.max+1;
          }
        }
        if(p.life<=p.max) alive=true;
      }
      for(const p of fx.core||[]){
        p.life+=dt;
        if(p.life>p.max) continue;
        if(p._puffCooldown>0) p._puffCooldown=Math.max(0,p._puffCooldown-dt);
        if(!p.settled){
          p.vx*=Math.pow(p.drag,moveDt*5);
          p.vy+=p.gravity*moveDt;
          const wind=windSpeedAt(p.x,p.y,getTile);
          if(Math.abs(wind)>0.03) p.vx+=wind*(p.kind==='wing'||p.kind==='smokeCore'||p.kind==='ashCloud'?0.14:0.05)*moveDt;
        }
        const usePhysics=!!p.physics && physicsBudget>0;
        if(usePhysics){ physicsBudget--; integrateDeathPiecePhysics(fx,p,getTile,moveDt); }
        else if(p.physics && getTile) integrateDeathPieceCheapPhysics(fx,p,getTile,moveDt);
        else {
          const prevX=p.x, prevY=p.y;
          p.x+=(p.vx||0)*moveDt;
          p.y+=(p.vy||0)*moveDt;
          if(Number.isFinite(p.travel)) p.travel+=Math.hypot(p.x-prevX,p.y-prevY);
          resolveDeathPieceTerrain(fx,p,getTile,prevX,prevY);
        }
        p.rot+=p.spin*moveDt;
        alive=true;
      }
      for(const f of fx.fragments){
        f.life+=dt;
        if(f.life>f.max) continue;
        if(f._puffCooldown>0) f._puffCooldown=Math.max(0,f._puffCooldown-dt);
        if(!f.settled){
          f.vx*=Math.pow(f.drag,moveDt*5);
          f.vy+=f.gravity*moveDt;
          const wind=windSpeedAt(f.x,f.y,getTile);
          if(Math.abs(wind)>0.03) f.vx+=wind*(f.shape==='feather'||f.shape==='wisp'?0.18:0.06)*moveDt;
        }
        const usePhysics=!!f.physics && physicsBudget>0;
        if(usePhysics){ physicsBudget--; integrateDeathPiecePhysics(fx,f,getTile,moveDt); }
        else if(f.physics && getTile) integrateDeathPieceCheapPhysics(fx,f,getTile,moveDt);
        else {
          const prevX=f.x, prevY=f.y;
          f.x+=(f.vx||0)*moveDt;
          f.y+=(f.vy||0)*moveDt;
          if(Number.isFinite(f.travel)) f.travel+=Math.hypot(f.x-prevX,f.y-prevY);
          resolveDeathPieceTerrain(fx,f,getTile,prevX,prevY);
        }
        f.rot+=f.spin*moveDt;
        alive=true;
      }
      if(!alive) mobDeathFx.splice(i,1);
    }
    metrics.deathFx=mobDeathFx.length;
  }
  function deathShapeNoise(seed,i){
    const v=Math.sin((Number(seed)||0)*12.9898 + i*78.233)*43758.5453;
    return v-Math.floor(v);
  }
  function drawIrregularDeathBlob(ctx,w,h,seed,points){
    const n=Math.max(6,points||9);
    ctx.beginPath();
    for(let i=0;i<n;i++){
      const a=-Math.PI/2 + (i/n)*Math.PI*2;
      const rx=0.76+deathShapeNoise(seed,i)*0.30;
      const ry=0.74+deathShapeNoise(seed+7.31,i)*0.34;
      const notch=(i%3===1) ? 0.92 : 1;
      const x=Math.cos(a)*w*0.52*rx*notch;
      const y=Math.sin(a)*h*0.52*ry;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
    ctx.closePath();
  }
  function drawIrregularDeathShard(ctx,w,h,seed){
    const skew=(deathShapeNoise(seed,1)-0.5)*w*0.18;
    const bite=(deathShapeNoise(seed,2)-0.5)*h*0.22;
    ctx.beginPath();
    ctx.moveTo(-w*0.58,-h*0.18+bite);
    ctx.lineTo(-w*0.14,-h*0.52);
    ctx.lineTo(w*0.56+skew,-h*0.26);
    ctx.lineTo(w*0.44,h*0.34+bite*0.4);
    ctx.lineTo(-w*0.30,h*0.50);
    ctx.lineTo(-w*0.66,h*0.12);
    ctx.closePath();
  }
  function drawRoundedDeathBone(ctx,len,thick,color,alpha){
    ctx.strokeStyle=rgbaHex(color,alpha==null?0.88:alpha);
    ctx.lineWidth=Math.max(1,thick);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(-len*0.5,0);
    ctx.lineTo(len*0.5,0);
    ctx.stroke();
    ctx.fillStyle=rgbaHex(color,alpha==null?0.88:alpha);
    ctx.beginPath();
    ctx.arc(-len*0.52,-thick*0.14,thick*0.52,0,Math.PI*2);
    ctx.arc(-len*0.52,thick*0.18,thick*0.42,0,Math.PI*2);
    ctx.arc(len*0.52,-thick*0.16,thick*0.46,0,Math.PI*2);
    ctx.arc(len*0.52,thick*0.18,thick*0.50,0,Math.PI*2);
    ctx.fill();
  }
  function drawMobDeathFragment(ctx,TILE,f,alpha){
    const s=Math.max(1.2,f.size*TILE);
    ctx.save();
    ctx.translate(f.x*TILE,f.y*TILE);
    ctx.rotate(f.rot||0);
    ctx.globalAlpha*=alpha*(f.alpha||1);
    if(f.shape==='spark'){
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle=rgbaHex(f.color,0.86);
      ctx.lineWidth=Math.max(1,s*0.28);
      ctx.beginPath(); ctx.moveTo(-s*1.4,0); ctx.lineTo(s*1.4,0); ctx.moveTo(0,-s*0.95); ctx.lineTo(0,s*0.95); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.72)';
      ctx.fillRect(-s*0.18,-s*0.18,s*0.36,s*0.36);
    } else if(f.shape==='drop' || f.shape==='bubble'){
      ctx.fillStyle=rgbaHex(f.color,f.shape==='bubble'?0.28:0.74);
      ctx.strokeStyle=rgbaHex('#d8f4ff',0.62);
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.ellipse(0,0,s*0.55,s*(f.shape==='bubble'?0.55:0.82),0,0,Math.PI*2);
      if(f.shape==='bubble') ctx.stroke(); else ctx.fill();
    } else if(f.shape==='feather'){
      ctx.strokeStyle=rgbaHex(f.color,0.86);
      ctx.lineWidth=Math.max(1,s*0.22);
      ctx.beginPath();
      ctx.moveTo(-s*0.15,s*1.2);
      ctx.quadraticCurveTo(s*0.75,0,s*0.10,-s*1.15);
      ctx.stroke();
      ctx.fillStyle=rgbaHex(mixHexColor(f.color,'#ffffff',0.24),0.52);
      ctx.beginPath();
      ctx.moveTo(0,-s*1.05);
      ctx.quadraticCurveTo(s*0.90,-s*0.18,0,s*1.05);
      ctx.quadraticCurveTo(-s*0.54,-s*0.18,0,-s*1.05);
      ctx.fill();
    } else if(f.shape==='panel'){
      ctx.fillStyle=rgbaHex(f.color,0.84);
      drawIrregularDeathShard(ctx,s*1.8,s*1.0,f.wobble||f.life||0);
      ctx.fill();
      ctx.strokeStyle=rgbaHex('#26313a',0.75);
      ctx.lineWidth=1;
      ctx.stroke();
      ctx.strokeStyle=rgbaHex('#ffffff',0.26);
      ctx.beginPath();
      ctx.moveTo(-s*0.55,-s*0.26);
      ctx.lineTo(s*0.38,-s*0.18);
      ctx.stroke();
    } else if(f.shape==='bone'){
      drawRoundedDeathBone(ctx,s*1.72,s*0.34,f.color,0.88);
    } else if(f.shape==='chip'){
      ctx.fillStyle=rgbaHex(f.color,0.80);
      drawIrregularDeathShard(ctx,s*1.28,s*0.86,f.wobble||f.life||0);
      ctx.fill();
      ctx.strokeStyle=rgbaHex('#26313a',0.75);
      ctx.lineWidth=1;
      ctx.stroke();
    } else if(f.shape==='wire'){
      ctx.strokeStyle=rgbaHex(f.color,0.82);
      ctx.lineWidth=Math.max(1,s*0.18);
      ctx.beginPath();
      ctx.moveTo(-s*1.2,Math.sin(f.wobble)*s*0.15);
      ctx.quadraticCurveTo(0,s*0.65,s*1.2,-Math.sin(f.wobble)*s*0.15);
      ctx.stroke();
    } else if(f.shape==='wisp' || f.shape==='ash' || f.shape==='dust'){
      ctx.fillStyle=rgbaHex(f.color,f.shape==='ash'?0.36:0.46);
      ctx.beginPath();
      ctx.ellipse(0,0,s*(0.60+0.18*Math.sin(f.wobble+f.life*8)),s*0.42,0,0,Math.PI*2);
      ctx.fill();
    } else if(f.shape==='shell'){
      ctx.fillStyle=rgbaHex(f.color,0.80);
      ctx.beginPath();
      ctx.moveTo(0,-s*0.75);
      ctx.lineTo(s*0.92,s*0.55);
      ctx.lineTo(-s*0.92,s*0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle=rgbaHex('#2a1a12',0.45);
      ctx.lineWidth=1;
      ctx.stroke();
    } else {
      ctx.fillStyle=rgbaHex(f.color,0.76);
      drawIrregularDeathBlob(ctx,s*1.32,s*1.05,f.wobble||f.life||0,8);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawMobDeathResidue(ctx,TILE,r,alpha){
    if(!r || alpha<=0) return;
    const px=r.x*TILE, py=r.y*TILE;
    const rx=Math.max(1.2,r.rx*TILE), ry=Math.max(0.8,r.ry*TILE);
    ctx.save();
    ctx.translate(px,py);
    ctx.rotate(r.rot||0);
    ctx.globalAlpha*=alpha*(r.alpha||0.35);
    if(r.kind==='ripple'){
      ctx.strokeStyle=rgbaHex(r.color,0.84);
      ctx.lineWidth=Math.max(1,TILE*0.035);
      ctx.beginPath(); ctx.ellipse(0,0,rx*1.8,Math.max(1.2,ry*1.8),0,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0,0,rx*0.92,Math.max(1,ry*0.92),0,0,Math.PI*2); ctx.stroke();
    } else if(r.kind==='scorch' || r.kind==='ashSmear' || r.kind==='shadowPool' || r.kind==='smear'){
      const col=r.kind==='shadowPool' ? '#1a191d' : (r.kind==='scorch' ? '#30231b' : r.color);
      ctx.fillStyle=rgbaHex(col,r.kind==='shadowPool'?0.72:0.55);
      ctx.beginPath(); ctx.ellipse(0,0,rx*(1.0+0.2*Math.sin(r.phase)),Math.max(1,ry*(0.80+0.14*Math.cos(r.phase))),0,0,Math.PI*2); ctx.fill();
      if(r.kind==='shadowPool'){
        ctx.fillStyle=rgbaHex('#b7ff86',0.24);
        ctx.fillRect(-rx*0.18,-Math.max(1,ry*0.6),Math.max(1,rx*0.14),Math.max(1,ry*0.55));
        ctx.fillRect(rx*0.08,-Math.max(1,ry*0.45),Math.max(1,rx*0.14),Math.max(1,ry*0.45));
      }
    } else if(r.kind==='star' || r.kind==='glitter' || r.kind==='sparkResidue' || r.kind==='ember' || r.kind==='greenMote'){
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle=rgbaHex(r.kind==='greenMote'?'#b7ff86':r.color,0.88);
      ctx.lineWidth=Math.max(1,TILE*0.035);
      ctx.beginPath();
      ctx.moveTo(-rx*0.45,0); ctx.lineTo(rx*0.45,0);
      ctx.moveTo(0,-rx*0.45); ctx.lineTo(0,rx*0.45);
      ctx.stroke();
    } else if(r.kind==='bolt'){
      ctx.strokeStyle=rgbaHex(r.color,0.80);
      ctx.lineWidth=Math.max(1,TILE*0.045);
      ctx.beginPath();
      ctx.moveTo(-rx*0.65,-ry*0.35);
      ctx.lineTo(-rx*0.10,ry*0.10);
      ctx.lineTo(rx*0.28,-ry*0.06);
      ctx.lineTo(rx*0.66,ry*0.32);
      ctx.stroke();
    } else if(r.kind==='bonePile'){
      drawRoundedDeathBone(ctx,rx*1.12,Math.max(1,ry*0.54),r.color,0.72);
      ctx.rotate(0.55);
      drawRoundedDeathBone(ctx,rx*0.86,Math.max(1,ry*0.42),r.color,0.58);
    } else if(r.kind==='shellShard' || r.kind==='chip'){
      ctx.fillStyle=rgbaHex(r.color,0.78);
      drawIrregularDeathShard(ctx,rx*1.24,Math.max(1.2,ry*1.05),r.phase||0);
      ctx.fill();
      ctx.strokeStyle=rgbaHex('#ffffff',0.20);
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(-rx*0.36,-ry*0.16);
      ctx.lineTo(rx*0.22,-ry*0.04);
      ctx.stroke();
    } else if(r.kind==='scratch'){
      ctx.strokeStyle=rgbaHex(r.color,0.62);
      ctx.lineWidth=1;
      for(let i=0;i<3;i++){
        ctx.beginPath();
        ctx.moveTo(-rx*0.55+i*rx*0.28,-ry*0.36);
        ctx.lineTo(-rx*0.22+i*rx*0.28,ry*0.36);
        ctx.stroke();
      }
    } else if(r.kind==='feather' || r.kind==='tuft'){
      ctx.strokeStyle=rgbaHex(r.color,0.70);
      ctx.lineWidth=Math.max(1,TILE*0.026);
      ctx.beginPath();
      ctx.moveTo(-rx*0.48,ry*0.25);
      ctx.quadraticCurveTo(0,-ry*0.85,rx*0.50,ry*0.10);
      ctx.stroke();
    } else {
      ctx.fillStyle=rgbaHex(r.color,0.42);
      ctx.beginPath(); ctx.ellipse(0,0,rx,Math.max(1,ry),0,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawMobDeathCorePart(ctx,TILE,p,fx,alpha){
    if(!p || alpha<=0) return;
    const w=Math.max(1.4,p.w*TILE), h=Math.max(1.2,p.h*TILE);
    ctx.save();
    ctx.translate(p.x*TILE,p.y*TILE);
    ctx.rotate(p.rot||0);
    ctx.globalAlpha*=alpha*(p.alpha||0.9);
    const c=p.color || fx.base || '#aaa';
    if(p.kind==='sensor' || p.kind==='eyeWisp' || p.kind==='starCore' || p.kind==='emberCore'){
      ctx.globalCompositeOperation='lighter';
      ctx.fillStyle=rgbaHex(c,0.86);
      ctx.beginPath();
      ctx.moveTo(0,-h*0.50);
      ctx.lineTo(w*0.50,0);
      ctx.lineTo(0,h*0.50);
      ctx.lineTo(-w*0.50,0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.62)';
      ctx.beginPath();
      ctx.moveTo(0,-h*0.20);
      ctx.lineTo(w*0.20,0);
      ctx.lineTo(0,h*0.20);
      ctx.lineTo(-w*0.20,0);
      ctx.closePath();
      ctx.fill();
      if(p.kind==='starCore'){
        ctx.strokeStyle=rgbaHex('#fff1a8',0.82);
        ctx.lineWidth=Math.max(1,w*0.10);
        ctx.beginPath(); ctx.moveTo(-w,0); ctx.lineTo(w,0); ctx.moveTo(0,-w); ctx.lineTo(0,w); ctx.stroke();
      }
    } else if(p.kind==='gear'){
      ctx.strokeStyle=rgbaHex(c,0.86);
      ctx.lineWidth=Math.max(1,w*0.18);
      ctx.beginPath(); ctx.arc(0,0,Math.max(w,h)*0.45,0,Math.PI*2); ctx.stroke();
      for(let i=0;i<6;i++){
        const a=i*Math.PI/3;
        ctx.fillStyle=rgbaHex(c,0.76);
        ctx.fillRect(Math.cos(a)*w*0.42-1,Math.sin(a)*h*0.42-1,2,2);
      }
    } else if(p.kind==='skull'){
      ctx.fillStyle=rgbaHex(c,0.88);
      ctx.beginPath();
      ctx.moveTo(-w*0.36,-h*0.44);
      ctx.quadraticCurveTo(0,-h*0.62,w*0.36,-h*0.44);
      ctx.lineTo(w*0.42,h*0.08);
      ctx.quadraticCurveTo(w*0.18,h*0.36,0,h*0.34);
      ctx.quadraticCurveTo(-w*0.18,h*0.36,-w*0.42,h*0.08);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle='rgba(28,28,34,0.72)';
      ctx.fillRect(-w*0.25,-h*0.22,w*0.16,h*0.18);
      ctx.fillRect(w*0.08,-h*0.22,w*0.16,h*0.18);
      ctx.fillRect(-w*0.08,h*0.06,w*0.16,h*0.16);
    } else if(p.kind==='rib' || p.kind==='longBone'){
      ctx.strokeStyle=rgbaHex(c,0.86);
      ctx.lineWidth=Math.max(1,h*0.22);
      ctx.lineCap='round';
      ctx.beginPath();
      if(p.kind==='rib') ctx.arc(0,0,w*0.48,Math.PI*0.12,Math.PI*0.88);
      else { ctx.moveTo(-w*0.55,0); ctx.lineTo(w*0.55,0); }
      ctx.stroke();
    } else if(p.kind==='wing' || p.kind==='featherCore'){
      ctx.fillStyle=rgbaHex(c,0.74);
      ctx.beginPath();
      ctx.moveTo(-w*0.52,h*0.45);
      ctx.quadraticCurveTo(0,-h*0.85,w*0.62,h*0.10);
      ctx.quadraticCurveTo(0,h*0.35,-w*0.52,h*0.45);
      ctx.fill();
      ctx.strokeStyle=rgbaHex(mixHexColor(c,'#ffffff',0.28),0.74);
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(-w*0.20,h*0.32); ctx.lineTo(w*0.30,-h*0.28); ctx.stroke();
    } else if(p.kind==='splashCrest' || p.kind==='dropCore'){
      ctx.fillStyle=rgbaHex(c,p.kind==='dropCore'?0.54:0.36);
      ctx.strokeStyle=rgbaHex('#d8f4ff',0.68);
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.ellipse(0,0,w*0.58,h*0.70,0,0,Math.PI*2);
      if(p.kind==='dropCore') ctx.fill(); else ctx.stroke();
    } else if(p.kind==='shellPlate' || p.kind==='tail' || p.kind==='leg'){
      ctx.fillStyle=rgbaHex(c,0.82);
      ctx.beginPath();
      ctx.moveTo(0,-h*0.52);
      ctx.lineTo(w*0.62,h*0.42);
      ctx.lineTo(-w*0.62,h*0.42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle='rgba(42,26,18,0.45)';
      ctx.lineWidth=1;
      ctx.stroke();
    } else if(p.kind==='smokeCore' || p.kind==='ashCloud' || p.kind==='rag'){
      ctx.fillStyle=rgbaHex(c,p.kind==='rag'?0.62:0.36);
      ctx.beginPath();
      ctx.ellipse(0,0,w*(0.55+0.08*Math.sin(p.phase+p.life*7)),h*0.50,0,0,Math.PI*2);
      ctx.fill();
    } else if(p.kind==='panelCore' || p.kind==='haloShard'){
      ctx.fillStyle=rgbaHex(c,0.80);
      drawIrregularDeathShard(ctx,w,h,p.phase||0);
      ctx.fill();
      ctx.strokeStyle=rgbaHex(mixHexColor(c,'#ffffff',0.28),0.30);
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(-w*0.28,-h*0.18);
      ctx.lineTo(w*0.24,-h*0.06);
      ctx.stroke();
    } else {
      ctx.fillStyle=rgbaHex(c,0.80);
      drawIrregularDeathBlob(ctx,w,h,p.phase||0,9);
      ctx.fill();
      ctx.fillStyle=rgbaHex(mixHexColor(c,'#ffffff',0.22),0.20);
      ctx.beginPath();
      ctx.ellipse(-w*0.12,-h*0.16,w*0.18,h*0.08,-0.2,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawMobDeathPuff(ctx,TILE,p,alpha){
    if(!p || alpha<=0) return;
    const s=Math.max(1,p.size*TILE);
    ctx.save();
    ctx.translate(p.x*TILE,p.y*TILE);
    ctx.globalAlpha*=alpha;
    if(p.kind==='spark'){
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle=rgbaHex(p.color,0.82);
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(-s,0); ctx.lineTo(s,0); ctx.moveTo(0,-s); ctx.lineTo(0,s); ctx.stroke();
    } else if(p.kind==='spray'){
      ctx.strokeStyle=rgbaHex('#d8f4ff',0.58);
      ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(0,0,s*0.9,0,Math.PI*2); ctx.stroke();
    } else {
      ctx.fillStyle=rgbaHex(p.color,0.32);
      ctx.beginPath(); ctx.ellipse(0,0,s*1.25,s*0.45,0,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawMobDeathFx(ctx,TILE,fx,visibleTile){
    if(visibleTile && !visibleTile(Math.floor(fx.x),Math.floor(fx.y))) return;
    const pieceVisible=(p)=> !visibleTile || (p && visibleTile(Math.floor(p.x),Math.floor(p.y)));
    const age=Math.max(0,Math.min(1,fx.life/fx.max));
    const px=fx.x*TILE, py=fx.y*TILE;
    ctx.save();
    for(const r of fx.residue||[]){
      if(r.life>r.max || !pieceVisible(r)) continue;
      const ra=1-Math.max(0,Math.min(1,r.life/r.max));
      drawMobDeathResidue(ctx,TILE,r,Math.pow(ra,0.52));
    }
    const shadowA=(1-age)*0.24;
    if(shadowA>0.01){
      ctx.fillStyle='rgba(0,0,0,'+shadowA.toFixed(3)+')';
      ctx.beginPath();
      ctx.ellipse(px,py+fx.bodyH*TILE*0.28,TILE*fx.bodyW*(0.36+age*0.18),TILE*Math.max(0.08,fx.bodyH*0.08*(1-age*0.25)),0,0,Math.PI*2);
      ctx.fill();
    }
    if(fx.style==='machine' || fx.style==='gold') ctx.globalCompositeOperation='lighter';
    for(const r of fx.rings){
      const rt=Math.max(0,fx.life-(r.delay||0));
      if(rt<=0 || rt>r.max) continue;
      const k=rt/r.max;
      ctx.strokeStyle=rgbaHex(r.color,(1-k)*(fx.style==='splash'?0.50:0.38));
      ctx.lineWidth=Math.max(1,TILE*(0.045*(1-k)+0.010));
      ctx.beginPath();
      ctx.ellipse(px,py-fx.bodyH*TILE*0.20,TILE*r.radius*(0.55+k*1.7),TILE*r.radius*(r.squash+k*0.35),0,0,Math.PI*2);
      ctx.stroke();
    }
    if(fx.style==='shadow' || fx.style==='ash'){
      const a=(1-age)*0.24;
      const g=ctx.createRadialGradient(px,py-fx.bodyH*TILE*0.5,2,px,py-fx.bodyH*TILE*0.5,TILE*(0.8+fx.bodyH*0.4));
      g.addColorStop(0,rgbaHex(fx.accent,a));
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(px,py-fx.bodyH*TILE*0.5,TILE*(0.8+fx.bodyH*0.4),0,Math.PI*2); ctx.fill();
    }
    for(const p of fx.core||[]){
      if(p.life>p.max || !pieceVisible(p)) continue;
      const pa=1-Math.max(0,Math.min(1,p.life/p.max));
      drawMobDeathCorePart(ctx,TILE,p,fx,Math.pow(pa,0.70));
    }
    for(const f of fx.fragments){
      if(f.life>f.max || !pieceVisible(f)) continue;
      const fa=1-Math.max(0,Math.min(1,f.life/f.max));
      drawMobDeathFragment(ctx,TILE,f,Math.pow(fa,0.78));
    }
    for(const p of fx.puffs||[]){
      if(p.life>p.max || !pieceVisible(p)) continue;
      const pa=1-Math.max(0,Math.min(1,p.life/p.max));
      drawMobDeathPuff(ctx,TILE,p,Math.pow(pa,0.72));
    }
    ctx.restore();
  }
  function integrateFloatingTerrainStep(m,spec,getTile,dt){
    const {halfW,halfH}=bodyHalfExtents(m,spec);
    if(m.vx) m.x += m.vx*dt;
    let minX = Math.floor(m.x - halfW), maxX = Math.floor(m.x + halfW);
    let minY = Math.floor(m.y - halfH), maxY = Math.floor(m.y + halfH);
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        const t=getTile(x,y);
        if(isSolid && isSolid(t)){
          if(m.vx>0) m.x = x - halfW - 0.001;
          else if(m.vx<0) m.x = x + 1 + halfW + 0.001;
          m.vx = 0;
          minX = Math.floor(m.x - halfW);
          maxX = Math.floor(m.x + halfW);
        }
      }
    }
    if(m.vy) m.y += m.vy*dt;
    minX = Math.floor(m.x - halfW); maxX = Math.floor(m.x + halfW);
    minY = Math.floor(m.y - halfH); maxY = Math.floor(m.y + halfH);
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        const t=getTile(x,y);
        if(isSolid && isSolid(t)){
          if(m.vy>0) m.y = y - halfH - 0.001;
          else if(m.vy<0) m.y = y + 1 + halfH + 0.001;
          m.vy = 0;
          minY = Math.floor(m.y - halfH);
          maxY = Math.floor(m.y + halfH);
        }
      }
    }
  }
  function integrateFloatingWithTerrain(m,spec,getTile,dt){
    const maxMove = Math.max(Math.abs(m.vx*dt), Math.abs(m.vy*dt));
    const steps = Math.max(1, Math.ceil(maxMove/0.45));
    const stepDt = dt / steps;
    for(let s=0; s<steps; s++) integrateFloatingTerrainStep(m,spec,getTile,stepDt);
  }
  function healingShelterBarrierAt(x,y,getTile){
    try{
      const api=MM.healingShelters;
      if(api && typeof api.isBarrierAt==='function') return !!api.isBarrierAt(Math.floor(x),Math.floor(y),getTile);
    }catch(e){}
    return false;
  }
  function integrateFloatingShelterBarrierStep(m,spec,getTile,dt){
    const {halfW,halfH}=bodyHalfExtents(m,spec);
    if(m.vx) m.x += m.vx*dt;
    let minX = Math.floor(m.x - halfW), maxX = Math.floor(m.x + halfW);
    let minY = Math.floor(m.y - halfH), maxY = Math.floor(m.y + halfH);
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        if(healingShelterBarrierAt(x,y,getTile)){
          if(m.vx>0) m.x = x - halfW - 0.001;
          else if(m.vx<0) m.x = x + 1 + halfW + 0.001;
          m.vx = 0;
          minX = Math.floor(m.x - halfW);
          maxX = Math.floor(m.x + halfW);
        }
      }
    }
    if(m.vy) m.y += m.vy*dt;
    minX = Math.floor(m.x - halfW); maxX = Math.floor(m.x + halfW);
    minY = Math.floor(m.y - halfH); maxY = Math.floor(m.y + halfH);
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        if(healingShelterBarrierAt(x,y,getTile)){
          if(m.vy>0) m.y = y - halfH - 0.001;
          else if(m.vy<0) m.y = y + 1 + halfH + 0.001;
          m.vy = 0;
          minY = Math.floor(m.y - halfH);
          maxY = Math.floor(m.y + halfH);
        }
      }
    }
  }
  function integrateFloatingWithShelterBarriers(m,spec,getTile,dt){
    const maxMove = Math.max(Math.abs(m.vx*dt), Math.abs(m.vy*dt));
    const steps = Math.max(1, Math.ceil(maxMove/0.35));
    const stepDt = dt / steps;
    for(let s=0; s<steps; s++) integrateFloatingShelterBarrierStep(m,spec,getTile,stepDt);
  }
  function windSpeedAt(x,y,getTile){
    try{
      const W=MM.wind;
      if(W && typeof W.speedAt==='function') return W.speedAt(x,y,getTile);
    }catch(e){}
    return 0;
  }
  function windMobResponse(m,spec){
    if(!m || !spec || spec.aquatic) return 0;
    if(m.id==='ZLOTY') return 0; // the legendary visitor follows its own scripted physics
    if(spec.flying){
      if(m.id==='FIREFLY') return 0.38;
      if(m.id==='BAT') return 0.24;
      if(m.id==='BIRD' || m.id==='OWL') return 0.18;
      return 0.20;
    }
    const airborne = !m.onGround || (m._wantJump && m.vy<-0.35) || m.vy<-0.55;
    if(!airborne) return 0;
    if(spec.organic===false) return 0.015;
    if(m.id==='RABBIT' || m.id==='SQUIRREL' || m.id==='ZABA') return 0.11;
    if(m.id==='DEER' || m.id==='GOAT' || m.id==='JASZCZUR') return 0.055;
    return 0.035;
  }
  function applyWindToMob(m,spec,getTile,dt){
    const response=windMobResponse(m,spec);
    if(response<=0) return false;
    const sp=windSpeedAt(m.x,m.y-0.25,getTile);
    if(Math.abs(sp)<0.05) return false;
    const before=m.vx||0;
    const accelScale=spec.flying ? 2.45 : 1.65;
    m.vx = before + sp*response*accelScale*dt;
    const cap=(spec.speed||MOVE.MAX)*(m.speedMul||1)*(spec.flying?1.35:1.12);
    if(Math.sign(m.vx)===Math.sign(sp) && Math.abs(m.vx)>cap) m.vx=Math.sign(sp)*cap;
    m._windPush = m.vx-before;
    return true;
  }
  function applyWindToMobProjectile(pr,dt,getTile){
    if(!pr || !(dt>0)) return false;
    const sp=windSpeedAt(pr.x,pr.y,getTile);
    if(Math.abs(sp)<0.05) return false;
    const before=pr.vx||0;
    pr.vx = before + sp*0.16*dt;
    if(Math.abs(pr.vx)>13) pr.vx=Math.sign(pr.vx)*13;
    return pr.vx!==before;
  }
  function update(dt, player, getTile, setTile){
    if(!(dt>0) || !isFinite(dt) || !player || !finiteCoord(player.x) || !finiteCoord(player.y) || typeof getTile!=='function') return;
    lastDeathFxGetTile=getTile;
    const now = performance.now(); frame++;
    prunePiranhaBaitZones(now);
    updateSunriseBurnState(now);
    laserTraceCalls=0; laserTileChecks=0;
    sentinelShotsThisFrame=0; sentinelDeferredThisFrame=0;
    // Despawn far / off-screen old passive mobs (not aggro)
    for(let i=mobs.length-1;i>=0;i--){
      const m=mobs[i];
      if(!validMobState(m) || m.hp<=0){ removeFromGrid(m); mobs.splice(i,1); continue; }
      const dist = Math.abs(m.x-player.x);
      const keepWeatherShaman = isWeatherShamanId(m.id) && !!m._shamanWeatherActive;
      if(dist>220 && !keepWeatherShaman && !isAggro(m.id)) { removeFromGrid(m); mobs.splice(i,1); continue; }
    }
    tryPiranhaAmbush(player,getTile,now);
    tryGoldGuardianSpawn(player,getTile,now);
    // Spawn attempt occasionally
    trySpawnNearPlayer(player,getTile, now);
    // Golden sprinter visit clock (counts played time, persists across reloads)
    goldenTick(dt, player);
    // Precompute separation: basic O(n^2) for small counts (opt: grid neighbor query)
    metrics.count = mobs.length;
    try{
      const p=MM.seasons && MM.seasons.profile ? MM.seasons.profile() : null;
      metrics.seasonAnimalMult = p && typeof p.animalSpawnMult==='number' ? +p.animalSpawnMult.toFixed(3) : 1;
    }catch(e){ metrics.seasonAnimalMult = 1; }
    try{
      const h=mobHostilityAt(player.x);
      metrics.hostility = +h.hostility.toFixed(3);
      metrics.hostilitySide = h.side;
      metrics.mobSpawnMult = +(h.mobSpawnMult || 1).toFixed(3);
    }catch(e){}
    let active=0;
    const nowEpoch=Date.now();
    for(let i=0;i<mobs.length;i++){
      const m=mobs[i]; const spec=SPECIES[m.id]; if(!spec) continue; const aggressive=isMobHostile(m,nowEpoch) && !isMobPacified(m,now);
      // Natural lifespan: apply health decay when past decayStartAt; ensure it runs before far-sleep skip
      if(m.decayStartAt && now >= m.decayStartAt){
        const total = Math.max(0.5, ((m.lifeEndAt||now) - m.decayStartAt)/1000); // seconds window
        const rate = ((m.maxHp||spec.hp)||5) / total; // hp per second to reach 0 by lifeEndAt
        m.hp -= rate * dt; if(m.hp <= 0){ m.hp = 0; m._naturalDeath = true; }
      }
      // Prepare player-like physics state for ground mobs
      const isGroundMob = !!spec.ground && !spec.aquatic && !spec.flying;
      let preVX=m.vx, preVY=m.vy, prevOnGround = m.onGround||false;
      m._wantJump=false;
      // Run species AI / behavior first
  // Distance gating for aggression and pursuit
  const dxP0 = player.x - m.x; const dyP0 = player.y - m.y; const distToHero = Math.hypot(dxP0, dyP0);
  const sight = (typeof spec.sightRange==='number'? spec.sightRange : 16);
  const pursue = (typeof spec.pursueRange==='number'? spec.pursueRange : (sight+6));
  const combatTarget = combatTargetForMob(m,player,aggressive,Math.max(sight,pursue));
  const aimTarget = combatTarget && combatTarget.kind==='companion' ? companionTargetPoint(combatTarget) : combatTarget;
  const distToPlayer = aimTarget ? Math.hypot(aimTarget.x-m.x, aimTarget.y-m.y) : distToHero;
  const canSee = distToPlayer <= sight;
  const shouldPursue = distToPlayer <= pursue;
  const aggroNow = aggressive && (canSee || shouldPursue);
  m._combatTarget=aggroNow ? (combatTarget && combatTarget.kind==='companion' ? Object.assign({},combatTarget,{y:combatTarget.aimY==null ? combatTarget.y : combatTarget.aimY}) : combatTarget) : player;
  updateMob(m, spec, {dt, now, aggressive: aggroNow, player:m._combatTarget, getTile, setTile, distToPlayer});
      if(isGroundMob){
        // Interpret AI changes: any upward impulse (vy<-1) becomes a jump intent
        if(m.vy < -1){ m._wantJump=true; }
        // Desired horizontal velocity coming from AI modifications (mutable for heuristics)
        let desired = m.vx;
        m.vx = preVX; // restore actual velocity; desired used for acceleration targeting
  // Mud bogs everything down: standing on (or wading through) mud halves speed
  const mudHere = getTile(Math.floor(m.x), Math.floor(m.y+0.6))===T.MUD || getTile(Math.floor(m.x), Math.floor(m.y)+1)===T.MUD;
  const maxSpeed = (spec.speed || MOVE.MAX) * (m.speedMul||1) * (mudHere?0.5:1);
  const speedRatio = maxSpeed / (MOVE.MAX||6);
        // Environmental heuristics (water avoidance / obstacle climb) prior to acceleration
        if(spec.move){
          // Water avoidance: if about to step into water, turn/slow
            if(spec.move.avoidWater){
              const dir = desired>0?1: (desired<0?-1:0);
              if(dir!==0){
                const aheadX = Math.floor(m.x + dir*0.6);
                const footY = Math.floor(m.y+0.5);
                const belowAhead = getTile(aheadX, footY+1);
                if(belowAhead===T.WATER){
                  // Try opposite side if it's not water; else just stop
                  const oppBelow = getTile(Math.floor(m.x - dir*0.6), footY+1);
                  if(oppBelow!==T.WATER) desired = -desired*0.8; else desired *=0.2;
                }
              }
            }
          // Obstacle climb: detect low barrier and request jump if climbable
            if(prevOnGround && Math.abs(desired)>0.15 && spec.move.maxClimb>0){
              const dir = desired>0?1:-1;
              const baseX = Math.floor(m.x + dir*0.6);
              const footY = Math.floor(m.y+0.5);
              const barrier = getTile(baseX, footY); // tile at body level ahead
              if(isSolidGround(barrier)){
                const maxH = Math.ceil(spec.move.maxClimb);
                for(let h=1; h<=maxH; h++){
                  const space = getTile(baseX, footY - h);
                  if(space===T.AIR || isLeaf(space)){
                    // Found climbable gap within maxClimb
                    m._wantJump = true; // mark jump intent
                    break;
                  }
                  if(isSolidGround(space) && h===maxH){
                    // Fully blocked; stop desired to avoid pushing
                    desired = 0;
                  }
                }
              }
            }
        }
        const diff = desired - m.vx;
        if(Math.abs(desired) > 0.05){
          const accel = MOVE.ACC * speedRatio * dt * Math.sign(diff);
            if(Math.abs(accel) > Math.abs(diff)) m.vx = desired; else m.vx += accel;
        } else { // friction when no desired input
          const fr = MOVE.FRICTION * dt;
          if(Math.abs(m.vx) <= fr) m.vx=0; else m.vx -= fr * Math.sign(m.vx);
        }
        // Cap horizontal speed
        if(Math.abs(m.vx) > maxSpeed) m.vx = maxSpeed * Math.sign(m.vx);
        // Jump execution (uses spec.move.jumpVel or MOVE.JUMP)
        if(m._wantJump && prevOnGround){
          let jv = (spec.move && spec.move.jumpVel) ? spec.move.jumpVel : (MOVE && MOVE.JUMP ? MOVE.JUMP : -9) * (0.7 + 0.3*speedRatio);
          jv *= (m.jumpMul||1);
          if(m.id==='RABBIT' || m.id==='SQUIRREL'){ jv *= (0.85 + Math.random()*0.3); }
          m.vy = jv;
        } else {
          m.vy = preVY; // restore pre-AI vertical velocity (jump not triggered)
        }
      }
      // Separation using spatial grid neighbors (same species only)
      applySeparation(m, i);
      // Damping: only for non-ground flight/aquatic (ground handled via friction earlier)
      if(spec.aquatic || spec.flying){
        const damp = aggressive? 0.9 : 0.92; m.vx*=damp; m.vy*= (spec.aquatic? 0.95 : 0.92);
      }
      applyWindToMob(m,spec,getTile,dt);
      // Clamp speeds
  const maxS = (spec.speed * (m.speedMul||1)) * (aggressive?1.4:1); const sp=Math.hypot(m.vx,m.vy); if(sp>maxS){ const s=maxS/sp; m.vx*=s; m.vy*=s; }
      // Sleep logic for far, non-aggro mobs: update position only sparsely
  if(!aggressive){
        const distP = Math.abs(m.x - player.x) + Math.abs(m.y - player.y);
        if(distP > 140 && (frame & 3)!== (m.tickMod||0)){ continue; } // skip this frame
      }
      active++;
  // Ground / gravity integration + AABB collision for ground mobs
  if(!spec.aquatic && !spec.flying){
  m.vy += MOVE.GRAV * dt; if(m.vy>24) m.vy=24;
        const {halfW,halfH}=bodyHalfExtents(m,spec);
        // Integrate horizontal then resolve X collisions
        m.x += m.vx*dt;
        let minX = Math.floor(m.x - halfW), maxX = Math.floor(m.x + halfW);
        let minY = Math.floor(m.y - halfH), maxY = Math.floor(m.y + halfH);
        for(let y=minY; y<=maxY; y++){
          for(let x=minX; x<=maxX; x++){
            const t = getTile(x,y); if(isSolid && isSolid(t)){
              if(m.vx>0) m.x = x - halfW - 0.001; else if(m.vx<0) m.x = x + 1 + halfW + 0.001; m.vx=0;
              minX = Math.floor(m.x - halfW); maxX = Math.floor(m.x + halfW); // recalc
            }
          }
        }
        // Integrate vertical then resolve Y collisions
        m.y += m.vy*dt; minX = Math.floor(m.x - halfW); maxX = Math.floor(m.x + halfW); minY = Math.floor(m.y - halfH); maxY = Math.floor(m.y + halfH);
        const wasGround = m.onGround; m.onGround=false;
        for(let y=minY; y<=maxY; y++){
          for(let x=minX; x<=maxX; x++){
            const t=getTile(x,y); if(isSolid && isSolid(t)){
              if(m.vy>0){
                m.y = y - halfH - 0.001;
                const spring=MM.springPlatforms;
                if(t===T.SPRING_PLATFORM && spring && typeof spring.launchEntity==='function' && spring.launchEntity(m,x,y,getTile,{kind:'mob',facing:m.facing})){
                  m.onGround=false;
                } else {
                  m.vy=0; m.onGround=true;
                }
              }
              else if(m.vy<0){ m.y = y + 1 + halfH + 0.001; m.vy=0; }
              minY = Math.floor(m.y - halfH); maxY = Math.floor(m.y + halfH);
            }
          }
        }
        if(m.onGround && MM.terrainTraps && MM.terrainTraps.stepEntity){
          MM.terrainTraps.stepEntity(m,getTile,setTile,{kind:'mob',species:m.id,halfW,halfH});
        }
        if(m.onGround){
          // Stand friction
          if(Math.abs(m.vx)<0.02) m.vx=0; else m.vx*=0.86;
          // Obstacle check for small step up using maxClimb
          if(spec.move && spec.move.maxClimb>0 && Math.abs(m.vx)>0.15){
            const dir = m.vx>0?1:-1; const stepX = Math.floor(m.x + dir*halfW + dir*0.2);
            // scan up to maxClimb blocks above feet to see if we can jump
            const maxClimb = Math.ceil(spec.move.maxClimb);
            let blocked=false, spaceFound=false;
            for(let h=0; h<=maxClimb; h++){
              const testY = Math.floor(m.y + halfH - h - 0.01);
              const t = getTile(stepX, testY);
              if(isSolid && isSolid(t)) blocked=true; else if(blocked){ spaceFound=true; break; }
            }
            if(spaceFound && Math.random()<0.12){ m.vy = (spec.move.jumpVel|| -4); m.onGround=false; }
            else if(blocked && !spaceFound){ // wall too high: halt
              m.vx=0;
            }
          }
        } else if(!m.onGround){
          // airborne horizontal damping slight
          m.vx *= 0.995;
        }
        if(m.onGround && !wasGround){ /* landing hook placeholder */ }
      } else if(spec.collideTerrain){
        integrateFloatingWithTerrain(m,spec,getTile,dt);
      } else if(spec.flying){
        integrateFloatingWithShelterBarriers(m,spec,getTile,dt);
      } else {
        // Non-ground ambient movement for pass-through creatures (fish, birds, fireflies).
        m.x += m.vx*dt; m.y += m.vy*dt;
      }
      // Habitat constraints via species hook
      if(typeof spec.habitatUpdate==='function') spec.habitatUpdate(m, spec, getTile, dt);
      updateGridCell(m);
      if(m.shake>0) m.shake=Math.max(0,m.shake-dt*10);
      // Standing in tile fire or lava ignites (sparse check; isBurning is a Map
      // lookup, so this is O(mobs) instead of fire.js scanning all mobs per tile)
      m.fireAcc=(m.fireAcc||0)+dt;
      if(m.fireAcc>=0.3){
        m.fireAcc=0;
        const F=MM.fire;
        const cx=Math.floor(m.x), cy=Math.floor(m.y), fy=Math.floor(m.y+0.5);
        const inLava = getTile && (getTile(cx,cy)===T.LAVA || getTile(cx,fy)===T.LAVA);
        if(inLava){ applyStatus(m,'burn',{dur:3,dps:4}); }
        else if(F && F.isBurning && (F.isBurning(cx,cy) || F.isBurning(cx,fy))){
          applyStatus(m,'burn',{dur:3,dps:2});
        }
      }
      // Status effects: DoT, cures and movement side-effects, table-driven
      tickStatuses(m,getTile,dt);
      stabilizeMobFacing(m,spec,now);
      // Contact damage + bounce (touch) independent of attack cooldown
  const piranhaTouchTarget = m.id==='PIRANHA' ? piranhaPreyTarget(m,player,getTile,1.55) : null;
  const touchCompanion = (m.id!=='PIRANHA' && aggressive) ? nearestCompanionTarget(m.x,m.y,1.15) : null;
  const touchTarget = piranhaTouchTarget || (m.id==='PIRANHA' ? null : (touchCompanion || player));
  if(!touchTarget) continue;
  const touchPoint = piranhaTouchTarget ? piranhaTargetPoint(piranhaTouchTarget) : (touchCompanion ? companionTargetPoint(touchCompanion) : touchTarget);
  const dxP = touchPoint.x - m.x; const dyP = touchPoint.y - m.y; const distTouch = Math.hypot(dxP,dyP);
      const touchRadius=piranhaTouchTarget ? Math.max(0.85,Math.min(1.6,piranhaTouchTarget.touchRadius||1.0)) : 0.9;
      if(distTouch < touchRadius){ // bounce push
        const nx=dxP/(distTouch||1); const ny=dyP/(distTouch||1);
        if(piranhaTouchTarget && piranhaTouchTarget.kind==='mob' && piranhaTouchTarget.raw){
          piranhaTouchTarget.raw.vx += nx*2.5*dt;
          piranhaTouchTarget.raw.vy += ny*1.5*dt;
        } else if(!touchCompanion && (!piranhaTouchTarget || piranhaTouchTarget.kind==='hero')){
          player.vx += nx*3*dt; player.vy += ny*2*dt;
        } // gentle continuous push
        const canBite=isMobHostile(m,nowEpoch) && !piranhaIsDistracted(m,now);
        if(canBite){
          if(m.attackCd>0) m.attackCd-=dt;
          if(m.attackCd<=0){
            const cause=spec.contactCause||'mob';
            markMobAttack(m,cause,{target:touchPoint,power:piranhaTouchTarget?0.8:1});
            if(piranhaTouchTarget) damagePiranhaPrey(piranhaTouchTarget,spec.dmg*(m.dmgMult||1),m.x,m.y,cause);
            else if(touchCompanion) damageCompanionTarget(touchCompanion,spec.dmg*(m.dmgMult||1),m.x,m.y,cause);
            else damagePlayer(spec.dmg*(m.dmgMult||1), m.x, m.y, cause, spec);
            m.attackCd=(0.8 + Math.random()*0.5)*Math.max(0.55,Math.min(1.2,(m.attackCdMult||1)));
          }
        }
      }
    }
    updateProjectiles(dt, player, getTile, setTile);
    updateLasers(dt);
    updateMobDeathFx(dt,getTile);
    metrics.projectiles = mobProjectiles.length;
    metrics.lasers = mobLasers.length;
    metrics.deathFx = mobDeathFx.length;
    metrics.laserTraceCalls = laserTraceCalls;
    metrics.laserTileChecks = laserTileChecks;
    metrics.sentinelShots = sentinelShotsThisFrame;
    metrics.sentinelDeferred = sentinelDeferredThisFrame;
    metrics.sentinelMeatShots = sentinelMeatShots;
    metrics.sentinelMeatCooked = sentinelMeatCooked;
    metrics.sentinelMeatDestroyed = sentinelMeatDestroyed;
    metrics.sentinelReloads = sentinelReloads;
    metrics.goldGuardians = (speciesCounts.GOLD_DRAGON||0) + (speciesCounts.GOLD_DWARF_GUARD||0);
    metrics.active = active;
    if(now - lastMetricsSample > 1000){ metrics.dtAvg = (metrics.dtAvg*0.7 + dt*0.3); lastMetricsSample = now; if(window.__mobDebug){ window.__mobMetrics = {...metrics, frame}; } }
  } // end update()
  function updateMob(m, spec, ctx){
    ctx.speed = (spec.speed||1) * (m.speedMul||1);
    if(typeof spec.onUpdate==='function'){ spec.onUpdate(m, spec, ctx); return; }
    const {dt, now, aggressive, player} = ctx; const toPlayerX=player.x - m.x; const toPlayerY=player.y - m.y; const distP=(typeof ctx.distToPlayer==='number' && ctx.distToPlayer>0)? ctx.distToPlayer : (Math.hypot(toPlayerX,toPlayerY)||1);
    // Only aggressive if within species sight range; otherwise idle/wander
    const sight = (typeof spec.sightRange==='number'? spec.sightRange : 16);
    if(aggressive && distP <= sight){
      const react=Math.max(0.5,Math.min(2.1,m.reactionMult||1));
      const desiredVx = (toPlayerX/distP)*((spec.speed||1)*(m.speedMul||1))*0.9; m.vx += (desiredVx - m.vx)*Math.min(1, dt*4*react);
      const desiredVy = spec.aquatic? ((toPlayerY)*0.8) : (toPlayerY*0.6);
      m.vy += (desiredVy - m.vy)*Math.min(1, dt*2.5*react);
      m.facing = toPlayerX>=0?1:-1;
    } else {
      if(now>m.tNext){
        m.tNext = now + rand(spec.wanderInterval[0], spec.wanderInterval[1])*1000;
        if(Math.random()<0.65){ const ang = Math.random()*Math.PI*2; const speed = (spec.speed*(m.speedMul||1))*(0.3+Math.random()*0.7); m.vx = Math.cos(ang)*speed; m.vy = Math.sin(ang)*speed* (spec.aquatic?0.6:0.35); m.facing = m.vx>=0?1:-1; } else { m.vx*=0.4; m.vy*=0.4; }
      }
      if(spec.aquatic){
        const baseBob = Math.sin(now*0.002 + m.spawnT*0.0007)*0.4;
        m.vy += (baseBob - m.vy)*Math.min(1, dt*0.8);
      } else if(spec.flying){
        const baseBob = Math.sin(now*0.003 + m.spawnT*0.001)*0.25;
        m.vy += (baseBob - m.vy)*Math.min(1, dt*0.8);
      } // grounded: no vertical bob
    }
  }

  function drawMobThreatMarks(ctx,TILE,m,spec,screenX,screenY,faceDir,phase,hpTop){
    const tier=Math.max(0,Math.min(4,(m && m.hostilityTier)||0));
    if(tier<=0 || !m || m.id==='ZLOTY') return;
    const accent=hostilityAccentColor(m);
    if(!accent) return;
    const body=(spec && spec.body) || {w:1,h:1};
    const bw=Math.max(9,(body.w||1)*TILE);
    const bh=Math.max(8,(body.h||1)*TILE);
    const top=screenY - bh*0.58 - (spec && spec.ground ? 2 : 0);
    const midY=top+bh*0.38;
    const alpha=Math.min(0.72,0.20+tier*0.10);
    const hot=m.hostilitySide==='hot';
    const cold=m.hostilitySide==='cold';
    ctx.save();
    ctx.globalAlpha=1;
    function tri(points,color){
      ctx.fillStyle=color;
      ctx.beginPath();
      ctx.moveTo(points[0][0],points[0][1]);
      for(let i=1;i<points.length;i++) ctx.lineTo(points[i][0],points[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    function pixel(x,y,w,h,color){ ctx.fillStyle=color; ctx.fillRect(x,y,w,h); }
    function bodyPlate(x,y,w,h,a){
      pixel(x,y,w,h,rgbaHex(accent,a==null?alpha:a));
      pixel(x,y,w,Math.max(1,h*0.28),rgbaHex(mixHexColor(accent,'#ffffff',0.34),Math.min(0.82,(a==null?alpha:a)+0.12)));
    }
    function eye(x,y,s){
      const glow=rgbaHex(mixHexColor(accent,'#ffffff',0.40),Math.min(0.88,alpha+0.18));
      pixel(x-s*0.5,y-s*0.5,s,s,glow);
      if(tier>=3) pixel(x-s*0.2,y-s*0.2,Math.max(1,s*0.4),Math.max(1,s*0.4),'#fff6d0');
    }
    function backSpines(count,x0,x1,y,up){
      const n=Math.max(1,count|0);
      for(let i=0;i<n;i++){
        const t=n===1?0.5:i/(n-1);
        const x=x0+(x1-x0)*t;
        const h=(3+tier*1.4)*(0.75+0.35*Math.sin(phase+i));
        tri([[x-2,y+1],[x+2,y+1],[x,y-up*h]],rgbaHex(accent,alpha));
      }
    }
    function sideFang(x,y,dir,len){
      tri([[x,y],[x+dir*(3+len),y+2],[x+dir*1.5,y+5]],rgbaHex(mixHexColor(accent,'#ffffff',0.18),alpha+0.04));
    }
    const plateN=Math.min(4,1+tier);
    const plateW=Math.max(3,bw*0.12);
    for(let i=0;i<plateN;i++){
      const t=plateN===1?0.5:i/(plateN-1);
      const x=screenX-bw*0.25+bw*0.50*t-plateW*0.5;
      const y=top+bh*0.22+Math.sin(phase+i)*0.6;
      bodyPlate(x,y,plateW,Math.max(2,bh*0.08),alpha*0.82);
    }

    const id=m.id;
    if(id==='STRAZNIK'){
      const finY=top+bh*0.18;
      bodyPlate(screenX-bw*0.22,top+bh*0.08,bw*0.44,Math.max(2,bh*0.08),alpha+0.06);
      pixel(screenX-faceDir*bw*0.42,midY-3,Math.max(3,bw*0.12),6,rgbaHex(accent,alpha+0.08));
      pixel(screenX+faceDir*bw*0.26,finY-4,Math.max(3,bw*0.12),4,rgbaHex(accent,alpha+0.02));
      eye(screenX+faceDir*bw*0.18,top+bh*0.12,3.2);
      if(tier>=3) pixel(screenX-bw*0.32,screenY-bh*0.05,bw*0.64,2,rgbaHex(accent,0.22));
    } else if(id==='SZKIELET'){
      eye(screenX+faceDir*3,top+bh*0.10,2.6);
      eye(screenX-faceDir*1,top+bh*0.11,2.2);
      for(let i=0;i<tier;i++) pixel(screenX-bw*0.16+i*3,top+bh*0.38+i%2,2,Math.max(5,bh*0.18),rgbaHex(accent,0.28+0.05*tier));
      if(tier>=2) sideFang(screenX+faceDir*bw*0.26,top+bh*0.26,faceDir,2+tier);
    } else if(id==='GHOUL'){
      eye(screenX+faceDir*bw*0.18,top+bh*0.12,3);
      eye(screenX+faceDir*bw*0.30,top+bh*0.14,2.4);
      for(let i=0;i<2+tier;i++){
        const x=screenX-bw*0.32+i*bw/(2+tier);
        pixel(x,top+bh*0.46+(i%2)*2,Math.max(2,bw*0.08),Math.max(4,bh*0.24),rgbaHex(accent,0.18+0.05*tier));
      }
      if(tier>=3) backSpines(3,screenX-bw*0.22,screenX+bw*0.16,top+bh*0.10,1);
    } else if(spec && spec.aquatic){
      backSpines(Math.min(5,2+tier),screenX-bw*0.28,screenX+bw*0.28,top+bh*0.14,1);
      pixel(screenX-faceDir*bw*0.38,midY-2,Math.max(3,bw*0.16),Math.max(3,bh*0.18),rgbaHex(accent,alpha));
      eye(screenX+faceDir*bw*0.34,top+bh*0.34,2.5);
      if(tier>=3){
        tri([[screenX+faceDir*bw*0.12,top+bh*0.02],[screenX+faceDir*bw*0.24,top-bh*0.18],[screenX+faceDir*bw*0.32,top+bh*0.08]],rgbaHex(accent,alpha*0.7));
      }
    } else if(spec && spec.flying){
      const flap=Math.sin(phase*2.1);
      eye(screenX+faceDir*bw*0.12,top+bh*0.28,2.2);
      for(let sgn=-1;sgn<=1;sgn+=2){
        const wx=screenX+sgn*bw*0.34;
        tri([[wx,midY],[wx+sgn*(4+tier*2),midY+flap*2],[wx+sgn*2,midY+bh*0.22]],rgbaHex(accent,0.22+0.06*tier));
        if(tier>=3) tri([[wx+sgn*(3+tier),midY+bh*0.08],[wx+sgn*(8+tier*2),midY+bh*0.14],[wx+sgn*(4+tier),midY+bh*0.22]],rgbaHex(accent,0.26));
      }
      if(hot) pixel(screenX-faceDir*bw*0.22,top+bh*0.58,Math.max(4,bw*0.18),2,rgbaHex(accent,0.30));
    } else {
      const hornCol=rgbaHex(mixHexColor(accent,cold?'#ffffff':'#ffe1a5',0.28),alpha+0.04);
      if(id==='DEER' || id==='WIOSENNY_JELEN' || id==='JESIENNY_LOS' || id==='GOAT'){
        const hx=screenX+faceDir*bw*0.22, hy=top+bh*0.06;
        for(let i=0;i<Math.min(3,tier);i++){
          pixel(hx+faceDir*i*3,hy-i*2,2,Math.max(5,bh*0.18)+i*2,hornCol);
          pixel(hx+faceDir*(i*3+2),hy-i*3,Math.max(3,bw*0.11),2,hornCol);
        }
        if(tier>=3) backSpines(3,screenX-bw*0.16,screenX+bw*0.18,top+bh*0.10,1);
      } else if(id==='WOLF' || id==='BEAR' || id==='ZIMOWY_NIEDZWIEDZ'){
        backSpines(Math.min(5,2+tier),screenX-bw*0.28,screenX+bw*0.20,top+bh*0.12,1);
        sideFang(screenX+faceDir*bw*0.38,top+bh*0.30,faceDir,2+tier);
        bodyPlate(screenX-bw*0.34,top+bh*0.34,bw*0.24,Math.max(3,bh*0.12),alpha+0.02);
        eye(screenX+faceDir*bw*0.34,top+bh*0.23,2.8);
      } else if(id==='CRAB' || id==='PELZACZ'){
        for(let i=0;i<Math.min(5,2+tier);i++){
          const x=screenX-bw*0.34+i*bw*0.17;
          tri([[x,midY],[x-3,midY+4+tier],[x+3,midY+3]],rgbaHex(accent,alpha));
        }
        eye(screenX+faceDir*bw*0.28,top+bh*0.28,2.4);
      } else {
        backSpines(Math.min(4,1+tier),screenX-bw*0.22,screenX+bw*0.18,top+bh*0.14,1);
        eye(screenX+faceDir*bw*0.28,top+bh*0.22,2.4);
      }
    }
    if(tier>=4){
      ctx.fillStyle=rgbaHex(accent,0.14);
      ctx.beginPath();
      ctx.ellipse(screenX,screenY+Math.min(8,bh*0.22),bw*0.34,bw*0.08,0,0,Math.PI*2);
      ctx.fill();
    }
    hpTop(top-Math.max(3,tier*4));
    ctx.restore();
  }

  function mobAttackVisual(m,spec,now){
    if(!m || m.id==='ZLOTY') return null;
    const strikeLeft=Math.max(0,(m._attackFlashUntil||0)-now);
    const recoverLeft=Math.max(0,(m._attackRecoverUntil||0)-now);
    const telegraphLeft=Math.max(0,(m._attackTelegraphUntil||0)-now);
    const state=String(m.state||'');
    const stateTelegraph = state==='windup' || state==='menace' || state==='warning' || state==='manifest' ||
      state==='waking' || state==='unfurl' || state==='charged' || state==='ram' || state==='dive' ||
      state==='spit' || state==='charging' || state==='relic_alarm' || state==='structure_alarm';
    const stateStrike = state==='charge' || state==='slam' || state==='sting' || state==='lunge' ||
      state==='snare' || state==='ambush' || state==='whiteout' || state==='carry';
    if(strikeLeft<=0 && recoverLeft<=0 && telegraphLeft<=0 && !stateTelegraph && !stateStrike) return null;
    const strike = strikeLeft>0 || stateStrike;
    const telegraph = !strike && (telegraphLeft>0 || stateTelegraph);
    const recover = !strike && !telegraph && recoverLeft>0;
    const strikeK = strikeLeft>0 ? Math.max(0,Math.min(1,strikeLeft/MOB_ATTACK_STRIKE_MS)) : (strike ? 0.58 : 0);
    const telegraphK = telegraphLeft>0 ? Math.max(0,Math.min(1,telegraphLeft/MOB_ATTACK_TELEGRAPH_MS)) : (telegraph ? 0.62 : 0);
    const recoverK = recoverLeft>0 ? Math.max(0,Math.min(1,recoverLeft/MOB_ATTACK_RECOVER_MS)) : 0;
    const kind=attackKindFromCause(m._attackKind,state);
    const body=(spec && spec.body) || {w:1,h:1};
    const power=clampFinite(m._attackPower,1,0.25,3);
    return {strike,telegraph,recover,strikeK,telegraphK,recoverK,kind,power,body};
  }
  function attackAccent(kind,spec){
    if(kind==='shock' || kind==='laser') return '#66f0ff';
    if(kind==='spit' || kind==='poison' || kind==='sting') return '#c8ff5a';
    if(kind==='throw' || kind==='slam') return '#ffd06a';
    if(spec && spec.organic===false) return '#ffb65a';
    return '#ff5c42';
  }
  function applyMobAttackPose(ctx,TILE,spec,screenX,screenY,faceDir,attack){
    if(!attack) return;
    const body=attack.body || (spec && spec.body) || {w:1,h:1};
    const tall=Math.max(0.8,body.h||1);
    const phase = attack.strike ? (1-attack.strikeK) : (attack.telegraph ? attack.telegraphK : attack.recoverK);
    const snap = attack.strike ? Math.sin(Math.min(1,phase)*Math.PI) : 0;
    const coil = attack.telegraph ? Math.sin((1-attack.telegraphK)*Math.PI)*0.55 : 0;
    const settle = attack.recover ? attack.recoverK*0.35 : 0;
    const lunge=(snap*0.19 - coil*0.08 + settle*0.035) * TILE * Math.min(2.2,attack.power);
    const squash=attack.strike ? 1+snap*0.055 : 1-coil*0.026;
    const stretch=attack.strike ? 1-snap*0.035 : 1+coil*0.020;
    const anchorY=screenY + tall*TILE*0.28;
    ctx.translate(faceDir*lunge, attack.strike ? -snap*TILE*0.028 : 0);
    ctx.translate(screenX,anchorY);
    ctx.scale(squash,stretch);
    ctx.translate(-screenX,-anchorY);
  }
  function drawMobAttackIntent(ctx,TILE,spec,screenX,screenY,faceDir,phase,attack,hpTop){
    if(!attack) return;
    const body=attack.body || (spec && spec.body) || {w:1,h:1};
    const bw=Math.max(10,(body.w||1)*TILE);
    const bh=Math.max(9,(body.h||1)*TILE);
    const aquatic=!!(spec && spec.aquatic);
    const flying=!!(spec && spec.flying);
    const accent=attackAccent(attack.kind,spec);
    const headX=screenX+faceDir*bw*(aquatic?0.42:(flying?0.24:0.36));
    const headY=screenY-bh*(aquatic?0.05:(flying?0.22:0.42));
    const midY=screenY-bh*(aquatic?0.05:0.22);
    const hot=attack.strike;
    const pulse=hot ? Math.sin((1-attack.strikeK)*Math.PI) : Math.sin((1-attack.telegraphK)*Math.PI);
    const alpha=Math.max(0.22,Math.min(0.92,(hot?0.68:0.46)+pulse*0.22));
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    if(attack.telegraph){
      ctx.strokeStyle=rgbaHex(accent,0.34+0.18*pulse);
      ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.arc(headX+faceDir*2,headY,4+pulse*3,0,Math.PI*2);
      ctx.stroke();
      ctx.fillStyle=rgbaHex(accent,0.22+0.16*pulse);
      ctx.beginPath();
      ctx.moveTo(headX+faceDir*(7+pulse*2),headY);
      ctx.lineTo(headX+faceDir*(13+pulse*4),headY-4);
      ctx.lineTo(headX+faceDir*(13+pulse*4),headY+4);
      ctx.closePath();
      ctx.fill();
    }
    if(hot){
      ctx.strokeStyle=rgbaHex(accent,0.28+0.34*alpha);
      ctx.lineWidth=3.2;
      ctx.beginPath();
      ctx.moveTo(screenX-faceDir*bw*0.46,midY+bh*0.12);
      ctx.lineTo(screenX-faceDir*bw*0.16,midY+bh*0.06);
      ctx.stroke();
      ctx.strokeStyle=rgbaHex(accent,0.60);
      ctx.lineWidth=2.0;
      ctx.beginPath();
      const ax=headX+faceDir*(5+bw*0.05);
      ctx.moveTo(ax,headY-bh*0.18);
      ctx.quadraticCurveTo(ax+faceDir*bw*0.22,headY,ax,headY+bh*0.18);
      ctx.stroke();
    }
    const eyeCol = attack.kind==='shock' || attack.kind==='laser' ? '#eaffff' : '#fff2a8';
    ctx.fillStyle=rgbaHex(accent,0.58);
    ctx.fillRect(headX-faceDir*3-2,headY-3,4,4);
    ctx.fillRect(headX-faceDir*8-2,headY-2,4,3);
    ctx.fillStyle=eyeCol;
    ctx.fillRect(headX-faceDir*3-1,headY-2,2,2);
    ctx.fillRect(headX-faceDir*8-1,headY-1,2,1);
    if(attack.kind==='bite' || attack.kind==='talon' || attack.kind==='sting' || attack.kind==='charge' || attack.kind==='slam'){
      ctx.fillStyle='rgba(255,244,210,0.92)';
      const mx=headX+faceDir*(6+Math.min(10,bw*0.12));
      ctx.beginPath();
      ctx.moveTo(mx,headY);
      ctx.lineTo(mx-faceDir*6,headY-3);
      ctx.lineTo(mx-faceDir*4,headY+4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle=rgbaHex(accent,0.82);
      ctx.fillRect(mx-faceDir*2,headY+4,faceDir*7,2);
    } else if(attack.kind==='throw' || attack.kind==='spit' || attack.kind==='laser'){
      ctx.strokeStyle=rgbaHex(accent,0.72);
      ctx.lineWidth=2;
      ctx.beginPath();
      ctx.moveTo(headX,headY);
      ctx.lineTo(headX+faceDir*(14+Math.min(12,bw*0.18)),headY-1+Math.sin(phase)*1.5);
      ctx.stroke();
    }
    hpTop(headY-bh*0.18-8);
    ctx.restore();
  }

  // Pre-baked radial glow for the golden sprinter (per-frame gradients are costly)
  let _goldGlow=null;
  function goldGlowSprite(){
    if(_goldGlow!==null) return _goldGlow;
    try{
      const c=document.createElement('canvas'); c.width=c.height=96;
      const g=c.getContext('2d');
      const grad=g.createRadialGradient(48,48,2,48,48,46);
      grad.addColorStop(0,'rgba(255,242,180,0.9)');
      grad.addColorStop(0.35,'rgba(255,206,84,0.40)');
      grad.addColorStop(1,'rgba(255,180,40,0)');
      g.fillStyle=grad; g.beginPath(); g.arc(48,48,46,0,Math.PI*2); g.fill();
      _goldGlow=c;
    }catch(e){ _goldGlow=false; }
    return _goldGlow;
  }

  function draw(ctx, TILE, camX,camY, zoom, canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const mobVisible = (m)=> !visibleTile || visibleTile(Math.floor(m.x), Math.floor(m.y));
    ctx.save(); ctx.imageSmoothingEnabled=false; const now=performance.now();
  // View bounds expressed in tile coordinates (camX/camY already in tiles)
  const viewL = camX - 2; const viewR = camX + (ctx.canvas.width/zoom)/TILE + 2; const viewT = camY - 2; const viewB = camY + (ctx.canvas.height/zoom)/TILE + 2;
  const disableCull = !!window.__mobDisableCull;
  for(const m of mobs){ if(!disableCull && (m.x < viewL || m.x > viewR || m.y < viewT || m.y > viewB)) continue; if(!mobVisible(m)) continue; const spec=SPECIES[m.id]; const screenX = (m.x*TILE); let screenY=(m.y*TILE);
      // Anchor adjustment: center position to feet baseline so sprites don't float
      if(spec && spec.ground && spec.body){
        const halfHpx = (spec.body.h||1)*0.5*TILE*(m.scale||1);
        const currentBottom = (spec.body.h>1.05)? 2 : 1; // empirically: tall sprites drawn to +2px, small to +1px
        screenY += halfHpx - currentBottom;
      }
      ctx.save();
      // Apply visual scale per entity
      if((m.scale||1)!==1){ ctx.translate(screenX, screenY); ctx.scale(m.scale, m.scale); ctx.translate(-screenX, -screenY); }
      // Simple shadow ellipse for ground mobs to reinforce contact
      if(spec && spec.ground){
        ctx.fillStyle='rgba(0,0,0,0.18)'; const shW = (spec.body? (spec.body.w||1)*TILE*0.6 : TILE*0.6); const shH=Math.max(2, shW*0.22); ctx.beginPath(); ctx.ellipse(screenX, screenY+ (spec.body? (spec.body.h||1)*0.5*TILE -2 : 6), shW*0.5, shH*0.5, 0, 0, Math.PI*2); ctx.fill();
      }
      if(window.__mobDebug){ // simple origin marker
        ctx.fillStyle='rgba(255,0,0,0.4)'; ctx.fillRect(screenX-1, screenY-1,2,2);
      }
      if(window.__mobShowAABB && spec && spec.body){
        const halfW = (spec.body.w||1)*0.5*TILE*(m.scale||1); const halfH=(spec.body.h||1)*0.5*TILE*(m.scale||1);
        ctx.strokeStyle='rgba(0,255,255,0.5)'; ctx.lineWidth=1; ctx.strokeRect((m.x-halfW/TILE)*TILE, (m.y-halfH/TILE)*TILE, (halfW*2), (halfH*2));
        // ground / feet line (bottom of AABB)
        ctx.strokeStyle='rgba(255,255,0,0.6)'; ctx.beginPath(); ctx.moveTo((m.x-halfW/TILE)*TILE, (m.y+halfH/TILE)*TILE); ctx.lineTo((m.x+halfW/TILE)*TILE, (m.y+halfH/TILE)*TILE); ctx.stroke();
      }
      if(m.shake>0){ const ang=Math.random()*Math.PI*2; const mag=m.shake*1.5; ctx.translate(Math.cos(ang)*mag, Math.sin(ang)*mag); }
      const flashing= now < m.hitFlashUntil;
  let topY=screenY; // track highest pixel for HP bar positioning after scaling
  function hpTop(y){ const yy = screenY + (y - screenY) * (m.scale||1); if(yy<topY) topY=yy; }
      const faceDir = mobFacingForDraw(m,now);
      // Small per-entity phase for anim variety
      const phase = (now*0.005 + m.spawnT*0.37) % (Math.PI*2);
      const phase2 = (now*0.003 + m.spawnT*0.19) % (Math.PI*2);
      const attack=mobAttackVisual(m,spec,now);
      applyMobAttackPose(ctx,TILE,spec,screenX,screenY,faceDir,attack);
      // Helper to draw outline rectangle
      function box(x,y,w,h,fill,stroke){ ctx.fillStyle=fill; ctx.fillRect(x,y,w,h); if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);} hpTop(y); }
      function shade(x,y,w,h,col,alpha){ ctx.fillStyle=col; ctx.globalAlpha=alpha; ctx.fillRect(x,y,w,h); ctx.globalAlpha=1; }
      // Shared quadruped legs with a diagonal-gait swing so walkers stop sliding
      // around like boards (2026-07 art audit: DEER/WOLF/GOAT had no legs at all).
      // hipY is the top of the leg; feet land at hipY+legH, which callers align
      // with the sprite baseline (screenY+1 for small bodies, +2 for tall ones).
      function quadLegs(cx,hipY,span,legW,legH,color){
        const moving=Math.abs(m.vx)>0.08;
        const swing=moving? Math.sin(now*0.014 + m.spawnT*0.37)*Math.min(2.4,1.1+Math.abs(m.vx)*0.35) : 0;
        ctx.fillStyle=color;
        for(let i=0;i<4;i++){
          const lx=cx-(span>>1)+Math.round(i*(span-legW)/3);
          const sw=Math.round((i===0||i===2)?swing:-swing);
          ctx.fillRect(lx+sw,hipY,legW,legH);
        }
      }
      switch(m.id){
        case 'BIRD': { // enlarged with wings + beak + eye
          const flap = Math.sin(phase)*2; // wing flap
          const bodyCol = flashing? '#ffffff' : (m.baseColor||'#f5d16a');
          box(screenX-5, screenY-7,10,8, bodyCol,'#bc8a00'); // body
          // wings (two rectangles that move vertically)
          ctx.fillStyle='#f3c552'; ctx.fillRect(screenX-7, screenY-5+flap,4,6); ctx.fillRect(screenX+3, screenY-5-flap,4,6);
          // tail (fan)
          ctx.fillStyle='#d49600'; ctx.fillRect(screenX+(faceDir>0?3:-5), screenY-4,2,3);
          // head & beak
          ctx.fillStyle=bodyCol; ctx.fillRect(screenX+(faceDir>0?2:-4), screenY-8,4,4); hpTop(screenY-8);
          ctx.fillStyle='#ff9b00'; ctx.fillRect(screenX+(faceDir>0?6:-6), screenY-6,3,2);
          ctx.fillStyle='#222'; ctx.fillRect(screenX+(faceDir>0?4:-4), screenY-7,2,2);
          break; }
        case 'FISH': { // add dorsal/ventral fins + tail pattern
          const wag = Math.sin(phase)*2*faceDir;
          const body = flashing? '#bcecff' : (m.baseColor||'#4eb2f1');
          box(screenX-9, screenY-4,18,8, body,'#1d6b9c');
          ctx.fillStyle='#1d6b9c'; ctx.fillRect(screenX-4, screenY-5,8,1); // dorsal ridge
          ctx.fillRect(screenX-4, screenY+4,8,1); // ventral
          // tail (wag)
          ctx.fillStyle='#1d6b9c'; ctx.save(); ctx.translate(wag,0); ctx.fillRect(screenX+(faceDir>0?9:-11), screenY-3,3,6); ctx.restore();
          // eye & gill
          ctx.fillStyle='#fff'; ctx.fillRect(screenX+(faceDir>0?1:-3), screenY-2,2,2); ctx.fillStyle='#000'; ctx.fillRect(screenX+(faceDir>0?1:-3), screenY-2,1,1);
          ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(screenX+(faceDir>0?-1:1), screenY-1,1,2); // gill slit
          break; }
        case 'PIRANHA': {
          const wag = Math.sin(phase*2.2)*2.6*faceDir;
          const body = flashing? '#ffd6d6' : (m.baseColor||'#b72d2d');
          box(screenX-7, screenY-3,14,6, body,'#4d1113');
          ctx.fillStyle='#4d1113';
          ctx.fillRect(screenX-1, screenY-5,5,2);
          ctx.save();
          ctx.translate(wag,0);
          ctx.fillRect(screenX+(faceDir>0?7:-10), screenY-3,4,6);
          ctx.restore();
          ctx.fillStyle='#f6f0dc';
          const mouthX=screenX+(faceDir>0?4:-8);
          ctx.fillRect(mouthX,screenY+1,4,1);
          ctx.fillRect(mouthX+faceDir*1,screenY+2,2,1);
          ctx.fillStyle='#fff';
          ctx.fillRect(screenX+(faceDir>0?2:-4), screenY-2,2,2);
          ctx.fillStyle='#111';
          ctx.fillRect(screenX+(faceDir>0?3:-3), screenY-2,1,1);
          if(m._frenzy>0){
            ctx.fillStyle='rgba(150,20,24,0.28)';
            ctx.fillRect(screenX-10,screenY+4,20,2);
          }
          break; }
        case 'BEAR': { // large hulking (approx 2x1.2 tiles)
          const body = flashing? '#e8d5c0': (m.baseColor||'#6b4a30');
          const breathe = 1 + Math.sin(phase2)*0.1;
          box(screenX-14, screenY-12,28,14, body,'#3e2918'); // torso
          // back shading gradient bars
          shade(screenX-14, screenY+1,28,3,'#000',0.10); shade(screenX-14, screenY+4,28,2,'#000',0.05);
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?5:-11), screenY-16,12,10*breathe); hpTop(screenY-16);
          // snout
          ctx.fillStyle='#c4ad97'; ctx.fillRect(screenX+(faceDir>0?14:-11), screenY-10,4,4);
          ctx.fillStyle='#000'; ctx.fillRect(screenX+(faceDir>0?16:-11), screenY-9,2,2);
          // ears
          ctx.fillStyle='#3e2918'; ctx.fillRect(screenX+(faceDir>0?6:-9), screenY-16,3,3); ctx.fillRect(screenX+(faceDir>0?12:-3), screenY-16,3,3);
          // legs (front/back) with a lumbering gait
          quadLegs(screenX,screenY+2,25,5,6,'#4d3421');
          break; }
        case 'BRAMBLE_STALKER': {
          const body = flashing? '#e8ffd9':(m.baseColor||'#48672f');
          const camo = m.state==='camouflaged';
          const snare = m.state==='snare' || m.state==='unfurl';
          ctx.save();
          ctx.globalAlpha = camo ? 0.62 : 1;
          box(screenX-10, screenY-11,20,13, body,'#243818');
          shade(screenX-10,screenY-7,20,4,'#000',0.16);
          if(camo) ctx.globalAlpha=0.62;
          ctx.fillStyle='#2d4b24';
          ctx.fillRect(screenX-13,screenY-8,5,7);
          ctx.fillRect(screenX+8,screenY-9,5,8);
          ctx.fillStyle='#6c8a36';
          for(let i=-8;i<=8;i+=4) ctx.fillRect(screenX+i,screenY-14-Math.abs(i%8),4,5);
          ctx.strokeStyle=snare?'rgba(160,220,90,0.85)':'rgba(90,130,58,0.72)';
          ctx.lineWidth=1.4;
          for(let i=-2;i<=2;i++){
            ctx.beginPath();
            ctx.moveTo(screenX+i*4,screenY-3);
            ctx.quadraticCurveTo(screenX+i*6+Math.sin(phase+i)*4,screenY+7,screenX+i*5,screenY+15+Math.abs(i));
            ctx.stroke();
          }
          ctx.fillStyle=snare?'#e8ff90':'#13230f';
          ctx.fillRect(screenX-4,screenY-8,2,2);
          ctx.fillRect(screenX+3,screenY-8,2,2);
          hpTop(screenY-16);
          ctx.restore();
          break; }
        case 'SQUIRREL': {
          const body = flashing? '#ffe3b5':(m.baseColor||'#b07040');
          box(screenX-6, screenY-7,12,8, body,'#6a3d18');
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?2:-6), screenY-10,6,5); hpTop(screenY-10);
          // ear
          ctx.fillStyle='#d19050'; ctx.fillRect(screenX+(faceDir>0?3:-5), screenY-11,2,2);
          // tail (arched sway)
          const sway = Math.sin(phase)*2;
          ctx.save(); ctx.translate(-sway*faceDir,0);
          ctx.fillStyle='#d19050'; ctx.fillRect(screenX-(faceDir>0?10:-2), screenY-14,6,12);
          ctx.fillRect(screenX-(faceDir>0?8:0), screenY-14,4,4);
          ctx.restore();
          break; }
        case 'DEER': {
          const body = flashing? '#fff2e0':(m.baseColor||'#9c6a39');
          quadLegs(screenX,screenY-5,15,2,7,'#6d4726');
          box(screenX-10, screenY-13,20,9, body,'#664422');
          shade(screenX-10, screenY-6,20,2,'#000',0.10);
          // neck + head
          ctx.fillStyle=body;
          ctx.fillRect(screenX+(faceDir>0?7:-10), screenY-16,3,4);
          ctx.fillRect(screenX+(faceDir>0?8:-16), screenY-19,8,6); hpTop(screenY-19);
          // ear, muzzle, eye
          ctx.fillStyle='#7a5530'; ctx.fillRect(screenX+(faceDir>0?8:-9), screenY-21,2,3);
          ctx.fillStyle='#d9c3a5'; ctx.fillRect(screenX+(faceDir>0?15:-18), screenY-17,3,3);
          ctx.fillStyle='#000'; ctx.fillRect(screenX+(faceDir>0?12:-13), screenY-18,1,1);
          // antlers
          ctx.fillStyle='#ccb28a'; const ax=screenX+(faceDir>0?10:-12); const baseY=screenY-19; ctx.fillRect(ax, baseY-5,2,5); ctx.fillRect(ax+3*faceDir, baseY-4,2,4);
          ctx.fillRect(ax+1*faceDir, baseY-8,2,3); ctx.fillRect(ax+5*faceDir, baseY-7,2,3); hpTop(baseY-8);
          // pale tail nub + rump spots
          ctx.fillStyle='#e8d8bd'; ctx.fillRect(screenX-(faceDir>0?11:-9), screenY-13,2,3);
          ctx.fillStyle='rgba(255,255,255,0.6)'; for(let i=-6;i<=2;i+=4){ ctx.fillRect(screenX+i*faceDir, screenY-10,2,2); }
          break; }
        case 'THUNDER_BISON': {
          const body = flashing? '#ffe2ba':(m.baseColor||'#8b5f34');
          const charging=m.state==='charge';
          const windup=m.state==='windup';
          const stunned=m.state==='stunned';
          const bob=charging?Math.sin(phase*3)*1.5:0;
          quadLegs(screenX,screenY+1+bob,34,6,8,'#5a391f');
          box(screenX-23,screenY-15+bob,46,16,body,'#4b301b');
          shade(screenX-23,screenY-4+bob,46,4,'#000',0.13);
          // shaggy storm-charged hump over the shoulders
          ctx.fillStyle='#4b301b';
          ctx.fillRect(screenX-faceDir*4-10,screenY-19+bob,20,5);
          ctx.fillStyle='#3a2513';
          for(let i=-9;i<=8;i+=4) ctx.fillRect(screenX-faceDir*4+i,screenY-15+bob,2,3);
          hpTop(screenY-19+bob);
          // faint static crackle on the hump (it is a THUNDER bison)
          if(Math.sin(phase*3.1)>0.62){
            ctx.strokeStyle='rgba(170,215,255,0.75)'; ctx.lineWidth=1;
            const zx=screenX-faceDir*4+Math.sin(phase2*5)*6;
            ctx.beginPath(); ctx.moveTo(zx,screenY-22+bob); ctx.lineTo(zx+2,screenY-19+bob); ctx.lineTo(zx,screenY-17+bob); ctx.stroke();
          }
          ctx.fillStyle=body;
          ctx.fillRect(screenX+(faceDir>0?12:-26),screenY-20+bob,14,12);
          hpTop(screenY-20+bob);
          // dark forelock over the face
          ctx.fillStyle='#4b301b';
          ctx.fillRect(screenX+(faceDir>0?12:-26),screenY-20+bob,14,3);
          ctx.fillStyle='#e5d2a7';
          if(faceDir>0){
            ctx.fillRect(screenX+24,screenY-18+bob,7,3);
            ctx.fillRect(screenX+22,screenY-14+bob,5,3);
          } else {
            ctx.fillRect(screenX-31,screenY-18+bob,7,3);
            ctx.fillRect(screenX-27,screenY-14+bob,5,3);
          }
          ctx.fillStyle='#16100b';
          ctx.fillRect(screenX+(faceDir>0?22:-16),screenY-16+bob,2,2);
          if(charging || windup){
            ctx.strokeStyle=charging?'rgba(255,220,140,0.82)':'rgba(255,185,90,0.62)';
            ctx.lineWidth=charging?2:1.4;
            ctx.beginPath();
            ctx.moveTo(screenX-faceDir*30,screenY-7+bob);
            ctx.lineTo(screenX-faceDir*16,screenY-7+bob);
            ctx.stroke();
            ctx.fillStyle='rgba(160,110,65,0.34)';
            ctx.fillRect(screenX-faceDir*24,screenY+9,10,3);
          }
          if(stunned){
            ctx.strokeStyle='rgba(255,236,150,0.9)';
            ctx.lineWidth=1.2;
            for(let i=-1;i<=1;i++){
              ctx.beginPath();
              ctx.moveTo(screenX+i*7,screenY-25);
              ctx.lineTo(screenX+i*7+Math.sin(phase+i)*3,screenY-30);
              ctx.stroke();
            }
          }
          break; }
        case 'WOLF': {
          const body = flashing? '#f5f5f5': (m.baseColor||'#bcbcbc');
          quadLegs(screenX,screenY-4,18,2,5,'#8a8a8a');
          box(screenX-12, screenY-11,24,8, body,'#555');
          // darker back stripe + pale belly
          shade(screenX-12, screenY-11,24,2,'#000',0.22);
          shade(screenX-12, screenY-5,24,2,'#fff',0.18);
          // head + ears
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?8:-14), screenY-15,10,8); hpTop(screenY-15);
          ctx.fillStyle='#777'; ctx.fillRect(screenX+(faceDir>0?8:-14), screenY-17,3,4); ctx.fillRect(screenX+(faceDir>0?13:-9), screenY-17,3,4);
          // snout + nose + eye
          ctx.fillStyle='#ddd'; ctx.fillRect(screenX+(faceDir>0?16:-20), screenY-12,4,3);
          ctx.fillStyle='#222'; ctx.fillRect(screenX+(faceDir>0?19:-20), screenY-12,2,2);
          ctx.fillStyle='#3a2c18'; ctx.fillRect(screenX+(faceDir>0?12:-13), screenY-13,2,2);
          // bushy tail wags while trotting
          const wag = Math.sin(phase*1.5)*2;
          ctx.fillStyle='#9c9c9c'; ctx.fillRect(screenX-(faceDir>0?17:-11), screenY-13+wag,6,3);
          break; }
        case 'ICE_WRAITH': {
          const body = flashing? '#ffffff':(m.baseColor||'#d5f6ff');
          const veiled=m.state==='veiled' || m.state==='melt' || isMobPacified(m,now);
          const pulse=Math.sin(phase*1.45)*0.5+0.5;
          ctx.save();
          ctx.globalAlpha=veiled ? 0.34+0.18*pulse : 0.70+0.20*pulse;
          ctx.globalCompositeOperation='lighter';
          ctx.fillStyle='rgba(180,236,255,0.34)';
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-10,15+pulse*4,18+pulse*3,0,0,Math.PI*2);
          ctx.fill();
          ctx.globalCompositeOperation='source-over';
          ctx.fillStyle=body;
          ctx.beginPath();
          ctx.moveTo(screenX,screenY-24);
          ctx.quadraticCurveTo(screenX+12,screenY-13,screenX+6,screenY+2);
          ctx.quadraticCurveTo(screenX+1,screenY-2,screenX-2,screenY+6);
          ctx.quadraticCurveTo(screenX-5,screenY-1,screenX-10,screenY+2);
          ctx.quadraticCurveTo(screenX-13,screenY-13,screenX,screenY-24);
          ctx.fill();
          hpTop(screenY-24);
          // cold rim + inner shade so the wraith is a figure, not a soft blot
          ctx.strokeStyle=veiled?'rgba(180,232,255,0.35)':'rgba(120,208,255,0.65)';
          ctx.lineWidth=1.2;
          ctx.stroke();
          ctx.fillStyle='rgba(96,164,205,0.30)';
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-9,4.5,7,0,0,Math.PI*2);
          ctx.fill();
          // sunken eye hollows behind the glow
          ctx.fillStyle='rgba(30,72,96,0.55)';
          ctx.fillRect(screenX-5,screenY-17,4,4);
          ctx.fillRect(screenX+2,screenY-17,4,4);
          ctx.fillStyle=veiled?'#dff8ff':'#78dfff';
          ctx.fillRect(screenX-4,screenY-16,2,2);
          ctx.fillRect(screenX+3,screenY-16,2,2);
          ctx.strokeStyle='rgba(224,252,255,0.75)';
          ctx.lineWidth=1.2;
          for(let i=-2;i<=2;i+=2){
            ctx.beginPath();
            ctx.moveTo(screenX+i*2,screenY-3);
            ctx.quadraticCurveTo(screenX+i*4+Math.sin(phase+i)*5,screenY+6,screenX+i*2,screenY+13+Math.abs(i));
            ctx.stroke();
          }
          ctx.restore();
          break; }
        case 'JACKPOT_YETI': {
          const body = flashing? '#ffffff':(m.baseColor||'#e6f2f6');
          const dark=mixHexColor(body,'#59727d',0.48);
          const slam=m.state==='slam';
          const leap=m.state==='leap';
          const bob=leap?-3:Math.sin(phase*1.4)*0.8;
          box(screenX-16,screenY-34+bob,32,35,body,dark);
          shade(screenX-14,screenY-34+bob,28,7,'#fff',0.14);
          ctx.fillStyle=mixHexColor(body,'#b7d2dd',0.34);
          ctx.fillRect(screenX-12,screenY-26+bob,24,11);
          // deep-set sockets with icy pupils and a real mouth — the old low
          // contrast face washed out to a blank marshmallow from two tiles away
          ctx.fillStyle='#2d4550';
          ctx.fillRect(screenX-9,screenY-30+bob,6,4);
          ctx.fillRect(screenX+3,screenY-30+bob,6,4);
          ctx.fillStyle='#9fe8ff';
          ctx.fillRect(screenX-7,screenY-29+bob,2,2);
          ctx.fillRect(screenX+5,screenY-29+bob,2,2);
          ctx.fillStyle='#2d4550';
          ctx.fillRect(screenX-5,screenY-24+bob,10,3);
          ctx.fillStyle='#e8f6fa';
          ctx.fillRect(screenX-4,screenY-24+bob,2,2);
          ctx.fillRect(screenX+2,screenY-24+bob,2,2);
          // fur combing streaks
          ctx.fillStyle='rgba(89,114,125,0.30)';
          for(let i=-13;i<=9;i+=6) ctx.fillRect(screenX+i,screenY-14+bob,2,10);
          ctx.fillStyle='#d8edf4';
          ctx.fillRect(screenX-18,screenY-37+bob,8,7);
          ctx.fillRect(screenX+10,screenY-37+bob,8,7);
          hpTop(screenY-39+bob);
          const swing=slam?5:Math.sin(phase*2.2)*3;
          ctx.fillStyle=mixHexColor(body,'#c6dfe8',0.28);
          ctx.fillRect(screenX-25,screenY-27+bob+swing,9,24);
          ctx.fillRect(screenX+16,screenY-27+bob-swing,9,24);
          ctx.fillStyle=dark;
          ctx.fillRect(screenX-26,screenY-4+bob+swing,11,6);
          ctx.fillRect(screenX+15,screenY-4+bob-swing,11,6);
          ctx.fillRect(screenX-12,screenY+1,9,11);
          ctx.fillRect(screenX+3,screenY+1,9,11);
          if(slam){
            ctx.strokeStyle='rgba(190,236,255,0.62)';
            ctx.lineWidth=2;
            ctx.beginPath();
            ctx.ellipse(screenX,screenY+7,29,7,0,0,Math.PI*2);
            ctx.stroke();
          }
          break; }
        case 'RABBIT': {
          const body = flashing? '#ffffff':(m.baseColor||'#dddddd');
          box(screenX-5, screenY-5,10,6, body,'#999');
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?4:-6), screenY-7,6,5); hpTop(screenY-7);
          // ears
          const earBob = Math.sin(phase2)*1.2;
          ctx.fillStyle='#bbb'; ctx.fillRect(screenX+(faceDir>0?5:-5), screenY-11-earBob,2,6+earBob); ctx.fillRect(screenX+(faceDir>0?8:-2), screenY-11+earBob,2,6-earBob);
          break; }
        case 'OWL': {
          const body = flashing? '#ffffff':(m.baseColor||'#c8a860');
          box(screenX-6, screenY-10,12,12, body,'#6a551e');
          // ear tufts give the silhouette its owl-ness
          ctx.fillStyle='#8a6f2e'; ctx.fillRect(screenX-6, screenY-13,3,4); ctx.fillRect(screenX+3, screenY-13,3,4); hpTop(screenY-13);
          // facial disk, darker-rimmed
          ctx.fillStyle='#ead5a0'; ctx.fillRect(screenX-4, screenY-9,8,6);
          ctx.fillStyle='#8a6f2e'; ctx.fillRect(screenX-4, screenY-9,8,1);
          // big amber eyes with pupils
          ctx.fillStyle='#ffb020'; ctx.fillRect(screenX-3, screenY-7,3,3); ctx.fillRect(screenX+1, screenY-7,3,3);
          ctx.fillStyle='#1b1206'; ctx.fillRect(screenX-2, screenY-6,1,1); ctx.fillRect(screenX+2, screenY-6,1,1);
          // beak
          ctx.fillStyle='#ffb94d'; ctx.fillRect(screenX-1, screenY-4,2,2);
          // folded-wing hatch + flutter
          const f = Math.sin(phase)*2;
          ctx.fillStyle='#b99738'; ctx.fillRect(screenX-6, screenY-3+f,12,2);
          ctx.fillStyle='rgba(0,0,0,0.14)'; ctx.fillRect(screenX-6, screenY-1,3,3); ctx.fillRect(screenX+3, screenY-1,3,3);
          // talons
          ctx.fillStyle='#8a6a20'; ctx.fillRect(screenX-3, screenY+2,2,2); ctx.fillRect(screenX+1, screenY+2,2,2);
          break; }
        case 'VULTURE': {
          const body = flashing? '#fff3df':(m.baseColor||'#4e4036');
          const flap=Math.sin(phase*1.6)*4;
          const dive=m.state==='dive' || m.state==='carry';
          ctx.fillStyle='#2a241f';
          ctx.fillRect(screenX-20,screenY-5+flap*0.35,16,5);
          ctx.fillRect(screenX+4,screenY-5-flap*0.35,16,5);
          ctx.fillStyle=body;
          ctx.fillRect(screenX-8,screenY-9,16,11);
          ctx.fillStyle='#7a6650';
          ctx.fillRect(screenX-6,screenY-6,12,5);
          // pale neck ruff under the bald head — the vulture signature
          ctx.fillStyle='#efe6d2';
          ctx.fillRect(screenX+(faceDir>0?4:-9),screenY-7,6,2);
          ctx.fillStyle='#d6c5a7';
          ctx.fillRect(screenX+(faceDir>0?5:-10),screenY-12,7,6); hpTop(screenY-12);
          ctx.fillStyle='#c78a34';
          ctx.fillRect(screenX+(faceDir>0?11:-13),screenY-9,4,2);
          ctx.fillStyle=dive?'#ffcf65':'#1b1110';
          ctx.fillRect(screenX+(faceDir>0?7:-7),screenY-11,2,2);
          ctx.fillStyle='#2a241f';
          ctx.fillRect(screenX-(faceDir>0?13:-5),screenY-3,7,3);
          if(dive){
            ctx.fillStyle='rgba(255,210,90,0.28)';
            ctx.fillRect(screenX-16,screenY+3,32,2);
          }
          break; }
        case 'VULTURE_HATCHLING': {
          const body = flashing? '#fff7e8':(m.baseColor||'#8a6e4b');
          const flap=Math.sin(phase*2.8)*2.2;
          ctx.fillStyle=body;
          ctx.fillRect(screenX-5,screenY-6,10,8);
          ctx.fillStyle='#5a4631';
          ctx.fillRect(screenX-9,screenY-4+flap,5,4);
          ctx.fillRect(screenX+4,screenY-4-flap,5,4);
          ctx.fillStyle='#d1ba8b';
          ctx.fillRect(screenX+(faceDir>0?3:-7),screenY-8,5,4); hpTop(screenY-8);
          ctx.fillStyle='#1c120c';
          ctx.fillRect(screenX+(faceDir>0?5:-5),screenY-7,1,1);
          ctx.fillStyle='#c9832c';
          ctx.fillRect(screenX+(faceDir>0?8:-9),screenY-6,2,1);
          break; }
        case 'CRAB': {
          const body = flashing? '#ffdddd':(m.baseColor||'#c23a2e');
          box(screenX-8, screenY-4,16,6, body,'#8a1f17');
          // legs
          ctx.fillStyle='#8a1f17'; for(let i=-6;i<=6;i+=4){ ctx.fillRect(screenX+i, screenY+2,2,3); }
          // claws
          const pinch = Math.sin(phase)*1.5;
          ctx.fillStyle='#8a1f17'; ctx.fillRect(screenX-12-pinch, screenY-2,4,4); ctx.fillRect(screenX+8+pinch, screenY-2,4,4);
          break; }
        case 'SHARK': {
          const body = flashing? '#d0f4ff': (m.baseColor||'#4d7690');
          const sway = Math.sin(phase*0.8)*3*faceDir;
          const tailWag = Math.sin(phase*2.4)*2;
          ctx.save(); ctx.translate(sway,0);
          // tapered silhouette: slim tail stock and nose caps over the core slab
          box(screenX-20, screenY-6,40,12, body,'#223b48');
          ctx.fillStyle=body;
          ctx.fillRect(screenX+(faceDir>0?20:-26), screenY-4,6,9);   // nose taper
          ctx.fillRect(screenX-(faceDir>0?26:-20), screenY-3,6,6);   // tail stock
          // white countershaded belly following the taper
          ctx.fillStyle='#e9f6fa';
          ctx.fillRect(screenX-18, screenY+2,36,4);
          ctx.fillRect(screenX+(faceDir>0?18:-24), screenY+2,6,3);
          // dorsal fin: two stacked steps make a real fin shape
          ctx.fillStyle='#2a4a5a';
          ctx.fillRect(screenX-5, screenY-10,7,4);
          ctx.fillRect(screenX-3, screenY-14,4,5); hpTop(screenY-14);
          // pectoral fin
          ctx.fillRect(screenX-faceDir*2-3, screenY+5,6,3);
          // crescent tail on a wagging joint
          ctx.save(); ctx.translate(0,tailWag);
          ctx.fillRect(screenX+(faceDir>0?-30:24), screenY-9,4,8);
          ctx.fillRect(screenX+(faceDir>0?-30:24), screenY+3,4,7);
          ctx.fillRect(screenX+(faceDir>0?-27:23), screenY-3,4,6);
          ctx.restore();
          // gill slits
          ctx.fillStyle='rgba(10,28,38,0.55)';
          for(let i=0;i<3;i++) ctx.fillRect(screenX+faceDir*(8-i*3)-1, screenY-3,1,6);
          // eye with a white ring + jagged mouth
          ctx.fillStyle='#e9f6fa'; ctx.fillRect(screenX+(faceDir>0?13:-16), screenY-4,3,3);
          ctx.fillStyle='#0a141b'; ctx.fillRect(screenX+(faceDir>0?14:-15), screenY-3,1,1);
          ctx.fillStyle='#0a141b'; ctx.fillRect(screenX+(faceDir>0?16:-22), screenY+1,7,2);
          ctx.fillStyle='#fff';
          for(let i=0;i<3;i++) ctx.fillRect(screenX+(faceDir>0?17+i*2:-21+i*2), screenY+1,1,1);
          ctx.restore();
          break; }
        case 'JACKPOT_WHALE': {
          const body = flashing? '#dff7ff':(m.baseColor||'#5d86a0');
          const charge=Math.max(0,Math.min(1.45,m._whaleCharge||0));
          const sway=Math.sin(phase*0.7)*2.6*faceDir;
          ctx.save();
          ctx.translate(sway,0);
          ctx.fillStyle=body;
          ctx.beginPath();
          ctx.ellipse(screenX-4*faceDir,screenY-3,48,15,0,0,Math.PI*2);
          ctx.fill();
          ctx.strokeStyle='#203746';
          ctx.lineWidth=1.5;
          ctx.stroke();
          ctx.fillStyle='#d9eef4';
          ctx.beginPath();
          ctx.ellipse(screenX-8*faceDir,screenY+4,34,6,0,0,Math.PI*2);
          ctx.fill();
          ctx.fillStyle=mixHexColor(body,'#1d3342',0.46);
          ctx.beginPath();
          const tailX=screenX-faceDir*50;
          ctx.moveTo(tailX,screenY-2);
          ctx.lineTo(tailX-faceDir*18,screenY-15);
          ctx.lineTo(tailX-faceDir*10,screenY-1);
          ctx.lineTo(tailX-faceDir*18,screenY+13);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle=mixHexColor(body,'#ffffff',0.18);
          ctx.beginPath();
          ctx.moveTo(screenX+faceDir*2,screenY-15);
          ctx.lineTo(screenX-faceDir*8,screenY-28);
          ctx.lineTo(screenX-faceDir*12,screenY-12);
          ctx.closePath();
          ctx.fill();
          hpTop(screenY-30);
          ctx.fillStyle='#0c1d28';
          ctx.fillRect(screenX+faceDir*30-(faceDir>0?0:2),screenY-9,2,2);
          ctx.fillStyle='rgba(230,250,255,0.74)';
          for(let i=0;i<5;i++) ctx.fillRect(screenX+faceDir*(14+i*5),screenY+7+i%2,3,1);
          if(charge>0.2){
            ctx.strokeStyle='rgba(150,230,255,'+(0.24+0.34*Math.min(1,charge)).toFixed(3)+')';
            ctx.lineWidth=2;
            ctx.beginPath();
            ctx.moveTo(screenX-faceDir*54,screenY-21);
            ctx.lineTo(screenX-faceDir*30,screenY-21);
            ctx.stroke();
          }
          ctx.restore();
          break; }
        case 'EEL': {
          const body = flashing? '#e0ffe0':(m.baseColor||'#2f8a4a');
          // segmented body
          for(let i=-10;i<=10;i+=4){ ctx.fillStyle= (i%8===0)? body : '#256d38'; ctx.fillRect(screenX+i, screenY-2,4,4); hpTop(screenY-2); }
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+10, screenY-3,5,6); ctx.fillStyle='#fff'; ctx.fillRect(screenX+13, screenY-2,2,2); ctx.fillStyle='#000'; ctx.fillRect(screenX+13, screenY-2,1,1);
          break; }
        case 'LAKE_SERPENT': {
          const body = flashing? '#dffffa':(m.baseColor||'#45b9a8');
          const charge=Math.max(0,Math.min(1.25,m._lakeCharge||0));
          const sway=Math.sin(phase*0.9)*4*faceDir;
          ctx.save();
          ctx.translate(sway,0);
          for(let i=-22;i<=18;i+=5){
            const wave=Math.sin(phase*1.1+i*0.35)*3;
            ctx.fillStyle=(i%10===0)?body:'#2d827a';
            ctx.fillRect(screenX+i,screenY-3+wave*0.22,7,6);
            if(charge>0.12){
              ctx.fillStyle='rgba(165,255,245,'+(0.22+0.36*Math.min(1,charge)).toFixed(3)+')';
              ctx.fillRect(screenX+i+1,screenY-7+wave*0.22,4,2);
            }
            hpTop(screenY-8+wave*0.22);
          }
          ctx.fillStyle=body;
          ctx.fillRect(screenX+19,screenY-5,11,9);
          ctx.fillStyle='#d9fff8';
          ctx.fillRect(screenX+24,screenY-3,2,2);
          ctx.fillStyle='#07332f';
          ctx.fillRect(screenX+24,screenY-3,1,1);
          ctx.fillStyle='#1d675f';
          ctx.fillRect(screenX-29,screenY-3,8,6);
          if(charge>0.18){
            ctx.strokeStyle='rgba(190,255,250,'+(0.35+0.45*Math.min(1,charge)).toFixed(3)+')';
            ctx.lineWidth=1.4;
            ctx.beginPath();
            for(let i=-24;i<=28;i+=6){
              const yy=screenY-10+Math.sin(phase*2+i)*3;
              if(i===-24) ctx.moveTo(screenX+i,yy); else ctx.lineTo(screenX+i,yy);
            }
            ctx.stroke();
          }
          ctx.restore();
          break; }
        case 'ATLANTIS_MEDUZA': {
          const body = flashing? '#ecfbff':(m.baseColor||'#7bdcff');
          const pulse = Math.sin(phase*1.6)*0.5+0.5;
          const bob = Math.sin(phase2)*2;
          ctx.save();
          ctx.globalCompositeOperation='lighter';
          ctx.globalAlpha=0.22+0.16*pulse;
          ctx.fillStyle='#7be8ff';
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-7+bob,18+pulse*4,15+pulse*3,0,0,Math.PI*2);
          ctx.fill();
          ctx.globalCompositeOperation='source-over';
          ctx.globalAlpha=1;
          const grad=ctx.createLinearGradient(screenX,screenY-20+bob,screenX,screenY+8+bob);
          grad.addColorStop(0,body);
          grad.addColorStop(1,'#7f5bd6');
          ctx.fillStyle=grad;
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-8+bob,11,9,0,Math.PI,Math.PI*2);
          ctx.lineTo(screenX+10,screenY-4+bob);
          ctx.quadraticCurveTo(screenX,screenY+4+bob,screenX-10,screenY-4+bob);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle='rgba(214,248,255,0.82)';
          ctx.lineWidth=1.4;
          for(let i=-4;i<=4;i+=2){
            const sway=Math.sin(phase*2+i)*3;
            ctx.beginPath();
            ctx.moveTo(screenX+i*2,screenY-2+bob);
            ctx.quadraticCurveTo(screenX+i*2+sway,screenY+8+bob,screenX+i*1.6-sway*0.4,screenY+19+bob+Math.abs(i));
            ctx.stroke();
          }
          ctx.fillStyle='#f4ffff';
          ctx.fillRect(screenX+faceDir*3-1,screenY-10+bob,2,2);
          ctx.fillStyle='#1b3554';
          ctx.fillRect(screenX+faceDir*3,screenY-10+bob,1,1);
          ctx.restore();
          hpTop(screenY-22+bob);
          break; }
        case 'GOAT': {
          const body = flashing? '#fafafa':(m.baseColor||'#c9c4b5');
          quadLegs(screenX,screenY-4,14,2,5,'#8d8779');
          box(screenX-9, screenY-11,18,8, body,'#8d8779');
          shade(screenX-9, screenY-5,18,2,'#000',0.10);
          // head raised on a short neck
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?7:-13), screenY-16,7,6); hpTop(screenY-16);
          // curved-back horns (two stacked nubs) + ear
          ctx.fillStyle='#6f6a5d';
          ctx.fillRect(screenX+(faceDir>0?7:-9), screenY-18,3,2);
          ctx.fillRect(screenX+(faceDir>0?5:-7), screenY-20,3,2);
          ctx.fillStyle='#a9a496'; ctx.fillRect(screenX+(faceDir>0?6:-8), screenY-15,2,2);
          // eye, muzzle, beard
          ctx.fillStyle='#2c2c26'; ctx.fillRect(screenX+(faceDir>0?11:-11), screenY-15,1,1);
          ctx.fillStyle='#b3ada0'; ctx.fillRect(screenX+(faceDir>0?12:-14), screenY-13,2,3);
          ctx.fillStyle='#9b968a'; ctx.fillRect(screenX+(faceDir>0?12:-13), screenY-10,2,3);
          // tail nub
          ctx.fillStyle='#b3ada0'; ctx.fillRect(screenX-(faceDir>0?10:-8), screenY-11,2,2);
          break; }
        case 'STONE_GOLEM': {
          const body = flashing? '#eef3f6':(m.baseColor||'#626870');
          const calm=isMobPacified(m,now);
          const wake=m.state==='waking' || m.state==='charging';
          box(screenX-12,screenY-27,24,10,body,'#2f3439');
          box(screenX-16,screenY-17,32,20,body,'#2f3439');
          ctx.fillStyle=mixHexColor(body,'#ffffff',0.22);
          ctx.fillRect(screenX-11,screenY-25,10,3);
          ctx.fillRect(screenX+3,screenY-15,10,3);
          ctx.fillStyle='#2f3439';
          ctx.fillRect(screenX-20,screenY-13,6,15);
          ctx.fillRect(screenX+14,screenY-13,6,15);
          ctx.fillRect(screenX-12,screenY+2,8,8);
          ctx.fillRect(screenX+4,screenY+2,8,8);
          ctx.fillStyle=calm?'#75d8ff':(wake?'#ffce6a':'#9db3bd');
          ctx.fillRect(screenX+faceDir*4-1,screenY-23,3,3);
          ctx.fillRect(screenX-faceDir*3-1,screenY-22,3,2);
          if(calm){
            ctx.fillStyle='rgba(90,190,255,0.35)';
            ctx.fillRect(screenX-15,screenY-30,30,2);
          } else if(wake){
            ctx.fillStyle='rgba(255,190,80,0.24)';
            ctx.fillRect(screenX-18,screenY-31,36,3);
          }
          hpTop(screenY-30);
          break; }
        case 'JASZCZUR': {
          const body = flashing? '#fff1c8':(m.baseColor||'#c79a45');
          const wiggle=Math.sin(phase*1.7)*2;
          box(screenX-9, screenY-4,18,5, body,'#6d4f22');
          ctx.fillStyle=body;
          ctx.fillRect(screenX+(faceDir>0?7:-12), screenY-6,6,5); hpTop(screenY-6);
          ctx.fillStyle='#6d4f22';
          ctx.fillRect(screenX-(faceDir>0?13:-9)-wiggle*faceDir, screenY-2,6,2);
          for(let i=-6;i<=6;i+=4) ctx.fillRect(screenX+i, screenY+1,2,3);
          ctx.fillStyle='#111'; ctx.fillRect(screenX+(faceDir>0?10:-10), screenY-5,1,1);
          break; }
        case 'ZABA': {
          const body = flashing? '#e8ffd8':(m.baseColor||'#4c9a3f');
          const squat=1+Math.sin(phase)*0.8;
          box(screenX-6, screenY-5+squat,12,7, body,'#2f5e2c');
          ctx.fillStyle=body;
          ctx.fillRect(screenX-5, screenY-9+squat,10,5); hpTop(screenY-9);
          ctx.fillStyle='#f4ffe8';
          ctx.fillRect(screenX-4, screenY-8+squat,3,2);
          ctx.fillRect(screenX+1, screenY-8+squat,3,2);
          ctx.fillStyle='#111';
          ctx.fillRect(screenX-3, screenY-8+squat,1,1);
          ctx.fillRect(screenX+2, screenY-8+squat,1,1);
          ctx.fillStyle='#2f5e2c';
          ctx.fillRect(screenX-9, screenY+1,5,2);
          ctx.fillRect(screenX+4, screenY+1,5,2);
          break; }
        case 'BOG_LURKER': {
          const body = flashing? '#e7ffd8':(m.baseColor||'#52643a');
          const smoked=isMobPacified(m,now);
          const hidden=m.state==='submerged';
          const bob=Math.sin(phase*1.4)*1.2;
          if(hidden){
            ctx.fillStyle='#354327';
            ctx.fillRect(screenX-13,screenY-2,26,5);
            ctx.fillStyle='#6f7f49';
            ctx.fillRect(screenX-8,screenY-6+bob,16,3);
            ctx.fillStyle='rgba(38,54,28,0.35)';
            ctx.fillRect(screenX-16,screenY+2,32,2);
            hpTop(screenY-7);
            break;
          }
          box(screenX-12,screenY-11+bob,24,11,body,'#25351f');
          ctx.fillStyle=mixHexColor(body,'#b8d67a',0.28);
          ctx.fillRect(screenX-7,screenY-17+bob,14,8);
          hpTop(screenY-17+bob);
          ctx.fillStyle=smoked?'#ffbe65':'#caff72';
          ctx.fillRect(screenX+faceDir*4-1,screenY-15+bob,2,2);
          ctx.fillRect(screenX-faceDir*2-1,screenY-14+bob,2,2);
          ctx.fillStyle='#25351f';
          for(let i=-10;i<=10;i+=5){
            ctx.fillRect(screenX+i,screenY-1+Math.sin(phase+i)*2,3,6);
          }
          if(smoked){
            ctx.fillStyle='rgba(255,160,70,0.30)';
            ctx.fillRect(screenX-12,screenY-20,24,2);
          }
          break; }
        case 'SAND_WORM': {
          const body = flashing? '#ffe4b3':(m.baseColor||'#b38342');
          const buried=m.state==='buried' || m.state==='circling';
          const calm=isMobPacified(m,now);
          const pulse=Math.sin(phase*1.8);
          if(buried){
            ctx.fillStyle='rgba(118,88,42,0.42)';
            ctx.fillRect(screenX-11,screenY,22,3);
            ctx.fillStyle='rgba(202,168,92,0.50)';
            ctx.fillRect(screenX-5,screenY-2+pulse*0.4,10,2);
            ctx.fillStyle='rgba(60,38,18,0.14)';
            ctx.fillRect(screenX-15,screenY+2,30,1);
            if(flashing) hpTop(screenY-6);
            break;
          }
          const arc=Math.sin(phase*2.2)*2;
          box(screenX-18,screenY-10+arc*0.25,36,11,body,'#5e3e19');
          ctx.fillStyle=mixHexColor(body,'#fff4c8',0.24);
          ctx.fillRect(screenX-14,screenY-13+arc,22,5);
          hpTop(screenY-13+arc);
          ctx.fillStyle='#5e3e19';
          for(let i=-13;i<=12;i+=5) ctx.fillRect(screenX+i,screenY-1+Math.sin(phase+i)*1.5,3,4);
          ctx.fillStyle=calm?'#6ad7ff':'#1d1208';
          ctx.fillRect(screenX+faceDir*10-1,screenY-10+arc,2,2);
          ctx.fillStyle='#f3e0b8';
          const mx=screenX+faceDir*16;
          ctx.fillRect(mx-faceDir*4,screenY-5,4,1);
          ctx.fillRect(mx-faceDir*3,screenY-3,2,1);
          if(calm){
            ctx.fillStyle='rgba(84,185,255,0.32)';
            ctx.fillRect(screenX-13,screenY-15,26,2);
          }
          break; }
        case 'GIANT_SCORPION': {
          const body = flashing? '#ffe4ce':(m.baseColor||'#6b3b28');
          const dark=mixHexColor(body,'#1b0d08',0.58);
          const plate=mixHexColor(body,'#f0b05e',0.24);
          const sting=m.state==='sting';
          const lunge=m.state==='lunge';
          const menace=sting || m.state==='menace';
          const bob=(lunge?-2:Math.sin(phase*2.2)*0.7);
          const gait=Math.sin(phase*3.6);
          ctx.fillStyle='rgba(73,43,20,0.22)';
          ctx.fillRect(screenX-27,screenY+1,54,3);
          ctx.strokeStyle=dark;
          ctx.lineWidth=2;
          for(let i=-2;i<=2;i++){
            const lx=screenX+i*8;
            const s=(i&1)?gait:-gait;
            ctx.beginPath();
            ctx.moveTo(lx,screenY-5+bob);
            ctx.lineTo(lx-6,screenY+1+s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(lx+2,screenY-5+bob);
            ctx.lineTo(lx+7,screenY+1-s);
            ctx.stroke();
          }
          box(screenX-22,screenY-14+bob,42,14,body,dark);
          shade(screenX-20,screenY-14+bob,38,4,'#fff',0.12);
          for(let i=-16;i<=13;i+=7){
            ctx.fillStyle=mixHexColor(body,dark,0.18);
            ctx.fillRect(screenX+i,screenY-13+bob,3,13);
          }
          const headX=screenX+faceDir*18;
          box(headX-(faceDir>0?1:9),screenY-17+bob,10,9,plate,dark);
          hpTop(screenY-34+bob);
          ctx.fillStyle='#ffe18e';
          ctx.fillRect(headX+faceDir*3-(faceDir>0?0:2),screenY-15+bob,2,2);
          ctx.fillStyle=dark;
          const clawX=screenX+faceDir*30;
          const clawY=screenY-10+bob;
          ctx.fillRect(clawX-faceDir*9,clawY+1,faceDir*9,3);
          ctx.fillRect(clawX-faceDir*2,clawY-2,faceDir*7,4);
          ctx.fillRect(clawX-faceDir*2,clawY+5,faceDir*6,4);
          ctx.strokeStyle=dark;
          ctx.lineWidth=4;
          ctx.lineCap='round';
          ctx.beginPath();
          ctx.moveTo(screenX-faceDir*18,screenY-15+bob);
          ctx.bezierCurveTo(
            screenX-faceDir*30,screenY-(menace?28:23)+bob,
            screenX-faceDir*8,screenY-(menace?38:30)+bob,
            screenX+faceDir*(menace?8:1),screenY-(menace?31:24)+bob
          );
          ctx.stroke();
          ctx.lineCap='butt';
          ctx.fillStyle=sting?'#ffd05a':dark;
          const tipX=screenX+faceDir*(menace?9:2), tipY=screenY-(menace?32:25)+bob;
          ctx.beginPath();
          ctx.moveTo(tipX,tipY);
          ctx.lineTo(tipX-faceDir*8,tipY-3);
          ctx.lineTo(tipX-faceDir*5,tipY+5);
          ctx.closePath();
          ctx.fill();
          if(sting){
            ctx.fillStyle='rgba(255,199,74,0.32)';
            ctx.fillRect(tipX-faceDir*10,tipY-6,14,12);
          }
          break; }
        case 'TEMPLE_GUARD': {
          const body = flashing? '#f8ffe8':(m.baseColor||'#6f7d43');
          const angry=isMobHostile(m,Date.now());
          const sway=Math.sin(phase)*1.4;
          box(screenX-7,screenY-22+sway*0.2,14,17,body,'#2e3f25');
          shade(screenX-7,screenY-22,14,4,'#fff',0.10);
          // carved stone plates + a glowing chest rune so the golem reads as
          // temple-work instead of an olive slab
          ctx.strokeStyle='rgba(30,42,24,0.55)'; ctx.lineWidth=1;
          ctx.beginPath();
          ctx.moveTo(screenX-7,screenY-16+sway*0.2); ctx.lineTo(screenX+7,screenY-16+sway*0.2);
          ctx.moveTo(screenX-7,screenY-11+sway*0.2); ctx.lineTo(screenX+7,screenY-11+sway*0.2);
          ctx.moveTo(screenX,screenY-16+sway*0.2); ctx.lineTo(screenX,screenY-5+sway*0.2);
          ctx.stroke();
          ctx.fillStyle=angry?'rgba(255,205,92,0.85)':'rgba(157,224,120,0.75)';
          ctx.fillRect(screenX-1,screenY-20+sway*0.2,3,4);
          // heavier bronze mask with a carved brow ledge
          ctx.fillStyle='#8f6f39';
          ctx.fillRect(screenX-6,screenY-29,12,8); hpTop(screenY-29);
          ctx.fillStyle='#6d5227';
          ctx.fillRect(screenX-6,screenY-29,12,2);
          ctx.fillStyle=angry?'#ffdf7a':'#b9ff93';
          ctx.fillRect(screenX+(faceDir>0?2:-4),screenY-26,3,2);
          ctx.fillRect(screenX+(faceDir>0?-2:2),screenY-25,3,2);
          ctx.fillStyle='#31472c';
          ctx.fillRect(screenX-9,screenY-17+sway,3,10);
          ctx.fillRect(screenX+6,screenY-17-sway,3,10);
          ctx.fillStyle='#4d2f20';
          ctx.fillRect(screenX-5,screenY-5,3,7);
          ctx.fillRect(screenX+2,screenY-5,3,7);
          ctx.fillStyle='#b8934a';
          ctx.fillRect(screenX-faceDir*12,screenY-18+sway,3,16);
          ctx.fillStyle='#6f7d43';
          ctx.fillRect(screenX-faceDir*15,screenY-21+sway,7,5);
          if(angry){
            ctx.fillStyle='rgba(255,205,92,0.28)';
            ctx.fillRect(screenX-10,screenY-30,20,2);
          }
          break; }
        case 'WIOSENNY_JELEN': {
          const body = flashing? '#fff7e8':(m.baseColor||'#bf8a4d');
          const run=Math.sin(phase*1.6);
          box(screenX-18, screenY-16,36,14, body,'#6b4726');
          shade(screenX-18,screenY-5,36,3,'#000',0.10);
          ctx.fillStyle='#f2c57a';
          ctx.fillRect(screenX-16,screenY-15,22,3);
          ctx.fillStyle=body;
          ctx.fillRect(screenX+(faceDir>0?10:-19),screenY-23,10,9); hpTop(screenY-23);
          ctx.fillStyle='#ead9b8';
          ctx.fillRect(screenX+(faceDir>0?18:-22),screenY-18,5,4);
          ctx.fillStyle='#1b1209';
          ctx.fillRect(screenX+(faceDir>0?19:-21),screenY-17,2,2);
          ctx.strokeStyle='#7a5b31'; ctx.lineWidth=2; ctx.lineCap='round';
          const ax=screenX+(faceDir>0?13:-13);
          ctx.beginPath(); ctx.moveTo(ax,screenY-23); ctx.lineTo(ax-faceDir*2,screenY-34); ctx.lineTo(ax-faceDir*7,screenY-38); ctx.moveTo(ax,screenY-29); ctx.lineTo(ax+faceDir*5,screenY-34); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ax+faceDir*5,screenY-22); ctx.lineTo(ax+faceDir*7,screenY-33); ctx.lineTo(ax+faceDir*13,screenY-36); ctx.moveTo(ax+faceDir*7,screenY-29); ctx.lineTo(ax+faceDir*12,screenY-31); ctx.stroke();
          hpTop(screenY-39);
          ctx.fillStyle='#ff9ac8';
          [[-7,-38],[-2,-34],[6,-35],[12,-31]].forEach(([ox,oy])=>{ ctx.fillRect(ax+faceDir*ox-1,screenY+oy-1,3,3); });
          ctx.fillStyle='#5f3d20';
          ctx.fillRect(screenX-14+run*2,screenY-2,4,11);
          ctx.fillRect(screenX-5-run*2,screenY-2,4,11);
          ctx.fillRect(screenX+5+run*2,screenY-2,4,11);
          ctx.fillRect(screenX+14-run*2,screenY-2,4,11);
          ctx.fillStyle='rgba(116,210,84,0.78)';
          for(let i=0;i<5;i++) ctx.fillRect(screenX-14+i*7,screenY-18-(i%2),3,2);
          break; }
        case 'LETNI_ZUBR': {
          const body = flashing? '#fff0d2':(m.baseColor||'#8d5e32');
          const stomp=Math.sin(phase*1.2);
          box(screenX-24, screenY-18,48,18, body,'#4d3118');
          shade(screenX-24,screenY-18,24,8,'#2a170b',0.24);
          ctx.fillStyle='#5d3a1e';
          ctx.fillRect(screenX-21,screenY-25,24,13); hpTop(screenY-25);
          ctx.fillStyle=body;
          ctx.fillRect(screenX+(faceDir>0?14:-28),screenY-19,16,11);
          ctx.fillStyle='#f1d5a0';
          ctx.fillRect(screenX+(faceDir>0?26:-30),screenY-15,5,4);
          ctx.fillStyle='#1b0f08';
          ctx.fillRect(screenX+(faceDir>0?27:-29),screenY-14,2,2);
          ctx.fillStyle='#efe1bd';
          ctx.fillRect(screenX+(faceDir>0?11:-23),screenY-23,8,3);
          ctx.fillRect(screenX+(faceDir>0?24:-32),screenY-23,8,3);
          ctx.fillStyle='#4d3118';
          ctx.fillRect(screenX-19+stomp*1.5,screenY-1,6,12);
          ctx.fillRect(screenX-7-stomp*1.5,screenY-1,6,12);
          ctx.fillRect(screenX+7+stomp*1.5,screenY-1,6,12);
          ctx.fillRect(screenX+17-stomp*1.5,screenY-1,6,12);
          ctx.fillStyle='rgba(255,210,94,0.65)';
          ctx.fillRect(screenX-20,screenY-28,22,2);
          ctx.fillRect(screenX-18,screenY-30,12,2);
          break; }
        case 'JESIENNY_LOS': {
          const body = flashing? '#ffe6bf':(m.baseColor||'#9a6737');
          const gait=Math.sin(phase*1.3);
          box(screenX-20, screenY-17,40,15, body,'#5a3820');
          shade(screenX-20,screenY-6,40,4,'#000',0.12);
          ctx.fillStyle='#6b4326';
          ctx.fillRect(screenX+(faceDir>0?11:-23),screenY-26,12,11); hpTop(screenY-31);
          ctx.fillStyle='#d7b37a';
          ctx.fillRect(screenX+(faceDir>0?21:-27),screenY-20,6,5);
          ctx.fillStyle='#1d1208';
          ctx.fillRect(screenX+(faceDir>0?22:-26),screenY-19,2,2);
          ctx.strokeStyle='#8a6a3c'; ctx.lineWidth=3; ctx.lineCap='round';
          const ax=screenX+(faceDir>0?13:-13);
          ctx.beginPath();
          ctx.moveTo(ax,screenY-27); ctx.lineTo(ax-faceDir*5,screenY-39); ctx.lineTo(ax-faceDir*18,screenY-41);
          ctx.moveTo(ax-faceDir*9,screenY-39); ctx.lineTo(ax-faceDir*12,screenY-47);
          ctx.moveTo(ax-faceDir*14,screenY-40); ctx.lineTo(ax-faceDir*20,screenY-47);
          ctx.moveTo(ax+faceDir*5,screenY-27); ctx.lineTo(ax+faceDir*9,screenY-38); ctx.lineTo(ax+faceDir*23,screenY-39);
          ctx.moveTo(ax+faceDir*13,screenY-38); ctx.lineTo(ax+faceDir*16,screenY-46);
          ctx.moveTo(ax+faceDir*18,screenY-38); ctx.lineTo(ax+faceDir*24,screenY-45);
          ctx.stroke();
          hpTop(screenY-48);
          ctx.fillStyle='#d37a2d';
          [[-19,-42],[-12,-47],[15,-45],[23,-40],[-5,-37]].forEach(([ox,oy])=>ctx.fillRect(ax+faceDir*ox-2,screenY+oy-1,4,3));
          ctx.fillStyle='#4f311d';
          ctx.fillRect(screenX-15+gait*2,screenY-2,5,12);
          ctx.fillRect(screenX-4-gait*2,screenY-2,5,12);
          ctx.fillRect(screenX+7+gait*2,screenY-2,5,12);
          ctx.fillRect(screenX+16-gait*2,screenY-2,5,12);
          break; }
        case 'ZIMOWY_NIEDZWIEDZ': {
          const body = flashing? '#ffffff':(m.baseColor||'#e9f3f8');
          const breathe=0.5+0.5*Math.sin(phase*1.4);
          box(screenX-23, screenY-16,46,17, body,'#94aab8');
          shade(screenX-23,screenY-2,46,4,'#5f7c8d',0.16);
          ctx.fillStyle=body;
          ctx.fillRect(screenX+(faceDir>0?12:-27),screenY-23,15,12); hpTop(screenY-23);
          ctx.fillStyle='#c8d8e0';
          ctx.fillRect(screenX+(faceDir>0?24:-29),screenY-18,6,5);
          ctx.fillStyle='#0c1820';
          ctx.fillRect(screenX+(faceDir>0?26:-29),screenY-16,2,2);
          ctx.fillStyle='#dceaf0';
          ctx.fillRect(screenX+(faceDir>0?14:-24),screenY-24,4,4);
          ctx.fillRect(screenX+(faceDir>0?21:-17),screenY-24,4,4);
          ctx.fillStyle='#8da6b4';
          ctx.fillRect(screenX-18,screenY,6,10);
          ctx.fillRect(screenX-6,screenY,6,10);
          ctx.fillRect(screenX+6,screenY,6,10);
          ctx.fillRect(screenX+16,screenY,6,10);
          ctx.fillStyle='rgba(220,250,255,'+(0.26+0.20*breathe).toFixed(3)+')';
          ctx.fillRect(screenX+(faceDir>0?31:-37),screenY-18,5+4*breathe,2);
          ctx.fillRect(screenX+(faceDir>0?36:-43),screenY-21,3+3*breathe,2);
          break; }
        case 'FIREFLY': {
          const pulse = (Math.sin(now*0.01 + m.spawnT*0.005)*0.5+0.5);
          const glowA = 0.55+0.45*pulse;
          ctx.fillStyle=`rgba(255,224,102,${glowA})`; ctx.fillRect(screenX-2, screenY-2,4,4); hpTop(screenY-2);
          ctx.fillStyle=`rgba(255,213,0,${0.4+0.4*pulse})`; ctx.fillRect(screenX-1, screenY-1,2,2);
          // outer halo
          ctx.globalAlpha=0.25*glowA; ctx.fillStyle='#ffe068'; ctx.beginPath(); ctx.arc(screenX, screenY, 6,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
          break; }
        case 'GHOUL': { // gaunt hunched night stalker with glowing eyes
          const body = flashing? '#e8ffe8' : (m.baseColor||'#4a5d49');
          const lurch=Math.sin(phase)*1.5;
          // hunched spine bump behind the head sells the shamble
          ctx.fillStyle=mixHexColor(body,'#222d22',0.35);
          ctx.fillRect(screenX-(faceDir>0?7:-1), screenY-24+lurch*0.4, 6, 5);
          box(screenX-6, screenY-22+lurch*0.4, 12, 18, body, '#222d22');           // torso (hunched)
          // head thrust low and forward
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?3:-10), screenY-27+lurch*0.6, 7, 7); hpTop(screenY-27);
          // ragged hem: torn strips instead of a flat band
          ctx.fillStyle='#0c100c';
          ctx.fillRect(screenX-6, screenY-16, 12, 2);
          for(let i=-6;i<=8;i+=4) ctx.fillRect(screenX+i-2, screenY-14, 2, 2+((i&4)?1:0));
          // dangling arms swing with the shamble; claw tips
          ctx.fillStyle=body;
          ctx.fillRect(screenX-8, screenY-18+lurch, 3, 12);
          ctx.fillRect(screenX+5, screenY-18-lurch, 3, 12);
          ctx.fillStyle='#d9e6c8';
          ctx.fillRect(screenX-8, screenY-6+lurch, 3, 1);
          ctx.fillRect(screenX+5, screenY-6-lurch, 3, 1);
          // legs
          ctx.fillStyle=body;
          ctx.fillRect(screenX-4, screenY-4, 3, 5); ctx.fillRect(screenX+1, screenY-4, 3, 5);
          // glowing eyes with a faint halo so the stare reads at night
          ctx.fillStyle='rgba(216,255,154,0.25)';
          ctx.fillRect(screenX+(faceDir>0?3:-7), screenY-26+lurch*0.6, 6, 4);
          ctx.fillStyle='#d8ff9a';
          ctx.fillRect(screenX+(faceDir>0?4:-6), screenY-25+lurch*0.6, 2, 2);
          ctx.fillRect(screenX+(faceDir>0?7:-3), screenY-25+lurch*0.6, 2, 2);
          break; }
        case 'BAT': { // small flapping silhouette with red eyes
          const body = flashing? '#fff' : (m.baseColor||'#2b2533');
          const flap=Math.sin(phase*2.2)*4;
          box(screenX-3, screenY-3, 6, 6, body, '#15101c');
          ctx.fillStyle=body;
          ctx.beginPath(); ctx.moveTo(screenX-3,screenY); ctx.lineTo(screenX-11,screenY-2+flap); ctx.lineTo(screenX-4,screenY+3); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(screenX+3,screenY); ctx.lineTo(screenX+11,screenY-2-flap); ctx.lineTo(screenX+4,screenY+3); ctx.closePath(); ctx.fill();
          hpTop(screenY-6);
          ctx.fillStyle='#ff5a5a';
          ctx.fillRect(screenX+(faceDir>0?0:-2), screenY-2, 1.6, 1.6);
          ctx.fillRect(screenX+(faceDir>0?2:-4), screenY-2, 1.6, 1.6);
          break; }
        case 'SZKIELET': { // bony archer: ribcage, skull, a short bow held forward
          const bone = flashing? '#ffffff' : (m.baseColor||'#dcd6c4');
          const sway=Math.sin(phase)*1.2;
          box(screenX-5, screenY-20, 10, 14, bone, '#8c8674');             // ribcage
          ctx.fillStyle='#8c8674'; for(let r=0;r<3;r++) ctx.fillRect(screenX-5, screenY-18+r*4, 10, 1.4); // ribs
          ctx.fillStyle=bone; ctx.fillRect(screenX-4, screenY-27, 8, 7); hpTop(screenY-27); // skull
          ctx.fillStyle='#1c1c22'; ctx.fillRect(screenX+(faceDir>0?-1:-3), screenY-25, 2, 2); ctx.fillRect(screenX+(faceDir>0?2:0), screenY-25, 2, 2);
          ctx.fillStyle=bone; ctx.fillRect(screenX-3, screenY-6, 2.4, 6); ctx.fillRect(screenX+1, screenY-6, 2.4, 6); // legs
          // bow arm
          ctx.strokeStyle='#9a6a32'; ctx.lineWidth=1.6; ctx.lineCap='round';
          const bx2=screenX+faceDir*8;
          ctx.beginPath(); ctx.arc(bx2, screenY-14+sway, 5, faceDir>0?-1.1:Math.PI-1.1, faceDir>0?1.1:Math.PI+1.1); ctx.stroke();
          ctx.strokeStyle='#e8e2d2'; ctx.lineWidth=0.8;
          ctx.beginPath(); ctx.moveTo(bx2+faceDir*2, screenY-18+sway); ctx.lineTo(bx2+faceDir*2, screenY-10+sway); ctx.stroke();
          break; }
        case 'ZLOTY': { // legendary golden sprinter: streak of light, halo, sparkles
          const g=m._g||{form:'runner',dir:m.facing,trail:[]};
          m._hideBar=true; // the generic bar is replaced by the golden one below
          const gtl=(MM.world && MM.world.getTile)? MM.world.getTile : ((WORLD && WORLD.getTile)||null);
          const tileSolid=(wx,wy)=>{ try{ return gtl? isSolidGround(gtl(Math.floor(wx),Math.floor(wy))) : false; }catch(e){ return false; } };
          // a tunneling mole phases through rock without breaking it: it is only
          // visible while its continuous path crosses open galleries (caves,
          // player tunnels) — inside solid rock it vanishes entirely
          const inRock = g.form==='mole' && tileSolid(m.x, m.y);
          const prevComp=ctx.globalCompositeOperation;
          ctx.globalCompositeOperation='lighter';
          // light streak along the recent path (open-space segments only)
          if(g.trail && g.trail.length>1){
            for(let i=0;i<g.trail.length;i++){
              const tp=g.trail[i];
              if(g.form==='mole' && tileSolid(tp.x,tp.y)) continue;
              const s=1.5+i*0.22; const a=i/g.trail.length;
              ctx.globalAlpha=a*0.75; ctx.fillStyle='#ffd24a';
              ctx.fillRect(tp.x*TILE-s/2, tp.y*TILE-s/2, s, s);
              ctx.globalAlpha=a*0.5; ctx.fillStyle='#fff6c8'; // hot core
              ctx.fillRect(tp.x*TILE-s/4, tp.y*TILE-s/4, s/2, s/2);
            }
            ctx.globalAlpha=1;
          }
          if(inRock){ ctx.globalCompositeOperation=prevComp; break; }
          // pulsing halo
          const glowS=goldGlowSprite();
          if(glowS){ const pul=1+Math.sin(now*0.006+m.spawnT)*0.12; const gs=TILE*2.6*pul; ctx.globalAlpha=0.9; ctx.drawImage(glowS, screenX-gs/2, screenY-gs/2, gs, gs); ctx.globalAlpha=1; }
          ctx.globalCompositeOperation=prevComp;
          // twinkling 4-point stars orbiting the body
          for(let i=0;i<5;i++){
            const sph=now*0.004 + i*1.7 + m.spawnT*0.01;
            const tw=Math.sin(sph*3.1)*0.5+0.5; if(tw<0.25) continue;
            const sx2=screenX+Math.cos(sph)*TILE*(0.7+0.22*i);
            const sy2=screenY+Math.sin(sph*1.3)*TILE*0.6 - 2;
            const r=1.5+tw*2.5;
            ctx.globalAlpha=0.5+0.5*tw; ctx.fillStyle='#fff6c8';
            ctx.fillRect(sx2-r, sy2-0.7, r*2, 1.4); ctx.fillRect(sx2-0.7, sy2-r, 1.4, r*2);
          }
          ctx.globalAlpha=1;
          const gold = flashing? '#ffffff' : '#ffd24a';
          const goldDark='#b8860b', goldLight='#fff1b0';
          if(g.form==='bird'){
            const flap=Math.sin(phase*2.6)*4;
            // ribbon tail streaming behind
            ctx.strokeStyle='rgba(255,210,90,0.85)'; ctx.lineWidth=2; ctx.lineCap='round';
            for(let r3=0;r3<3;r3++){
              ctx.beginPath(); ctx.moveTo(screenX-faceDir*4, screenY+(r3-1)*2);
              ctx.quadraticCurveTo(screenX-faceDir*14, screenY+(r3-1)*4+Math.sin(phase+r3)*3, screenX-faceDir*22, screenY+(r3-1)*5+Math.sin(phase*1.3+r3)*4);
              ctx.stroke();
            }
            box(screenX-6, screenY-5,12,9, gold, goldDark); // body
            ctx.fillStyle=goldLight; ctx.fillRect(screenX-7, screenY-3+flap,5,7); ctx.fillRect(screenX+2, screenY-3-flap,5,7); // wings
            ctx.fillStyle=gold; ctx.fillRect(screenX+(faceDir>0?4:-9), screenY-8,5,5); hpTop(screenY-11); // head
            ctx.fillStyle='#fff'; ctx.fillRect(screenX+(faceDir>0?6:-7), screenY-7,2,2); ctx.fillStyle='#7a4a00'; ctx.fillRect(screenX+(faceDir>0?7:-6), screenY-7,1,1);
            ctx.fillStyle='#ffae00'; ctx.fillRect(screenX+(faceDir>0?9:-12), screenY-6,3,2); // beak
            ctx.fillStyle=goldLight; ctx.fillRect(screenX+(faceDir>0?4:-6), screenY-10,2,2); ctx.fillRect(screenX+(faceDir>0?6:-8), screenY-11,2,3); // crest
          } else if(g.form==='mole'){
            // caught crossing a gallery: full golden glory, claws churning
            box(screenX-8, screenY-6,16,10, gold, goldDark); // stocky body
            ctx.fillStyle=goldLight; ctx.fillRect(screenX-8, screenY-6,16,3); // sheen
            ctx.fillStyle=gold; ctx.fillRect(screenX+(faceDir>0?6:-11), screenY-4,5,6); // snout
            ctx.fillStyle='#ffae9b'; ctx.fillRect(screenX+(faceDir>0?10:-12), screenY-2,2,2); // nose
            ctx.fillStyle='#3a2a10'; ctx.fillRect(screenX+(faceDir>0?5:-7), screenY-5,2,2); // eye
            const dig=Math.sin(phase*4)*2;
            ctx.fillStyle='#e8e2d2'; // huge digging claws churning as it swims through earth
            ctx.fillRect(screenX+(faceDir>0?8:-12), screenY+3+dig,4,3); ctx.fillRect(screenX+(faceDir>0?12:-15), screenY+1-dig,3,4);
            hpTop(screenY-6);
          } else { // runner: galloping golden stag
            const gal=Math.sin(phase*3);
            box(screenX-11, screenY-12,22,9, gold, goldDark); // torso
            ctx.fillStyle=goldLight; ctx.fillRect(screenX-11, screenY-12,22,3); // back sheen
            ctx.fillStyle=gold; ctx.fillRect(screenX+(faceDir>0?9:-15), screenY-18,6,8); // neck+head
            hpTop(screenY-26);
            ctx.fillStyle='#fff'; ctx.fillRect(screenX+(faceDir>0?12:-13), screenY-17,2,2); ctx.fillStyle='#7a4a00'; ctx.fillRect(screenX+(faceDir>0?13:-12), screenY-17,1,1);
            // radiant antlers
            ctx.fillStyle=goldLight;
            const ax2=screenX+(faceDir>0?10:-13);
            ctx.fillRect(ax2, screenY-23,2,5); ctx.fillRect(ax2+3*faceDir, screenY-22,2,4);
            ctx.fillRect(ax2+1*faceDir, screenY-25,2,3); ctx.fillRect(ax2+5*faceDir, screenY-24,2,2);
            // flowing mane sparks
            ctx.fillStyle='rgba(255,236,150,0.9)';
            for(let i2=0;i2<3;i2++){ ctx.fillRect(screenX-faceDir*(2+i2*4), screenY-14-((gal+1)*1.5+i2), 3,3); }
            // galloping legs
            ctx.fillStyle=goldDark;
            ctx.fillRect(screenX-9+gal*2, screenY-3,3,7); ctx.fillRect(screenX-3-gal*2, screenY-3,3,7);
            ctx.fillRect(screenX+3+gal*2, screenY-3,3,7); ctx.fillRect(screenX+8-gal*2, screenY-3,3,7);
          }
          // prominent golden HP bar once wounded (the chase needs readable feedback)
          const goldMaxHp = m.maxHp || spec.hp || 1;
          if(m.hp < goldMaxHp){
            const w=46, frac=Math.max(0,Math.min(1,m.hp/goldMaxHp));
            const byy=topY-13;
            ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(screenX-w/2-1, byy-1, w+2, 7);
            ctx.fillStyle='#5a1a1a'; ctx.fillRect(screenX-w/2, byy, w, 5);
            ctx.fillStyle='#ffd24a'; ctx.fillRect(screenX-w/2, byy, w*frac, 5);
            ctx.strokeStyle='#fff1b0'; ctx.lineWidth=1; ctx.strokeRect(screenX-w/2-1.5, byy-1.5, w+3, 8);
          }
          break; }
        case 'PELZACZ': { // low skittering cave crawler: flat body, many legs, pale eyes
          const body = flashing? '#e8e8ff' : (m.baseColor||'#4a4458');
          const skit=Math.sin(phase*3);
          box(screenX-9, screenY-7, 18, 7, body, '#262233');
          ctx.strokeStyle=body; ctx.lineWidth=1.6;
          for(let l=0;l<4;l++){
            const lx=screenX-7+l*4.6, lift=(l%2? skit:-skit)*2;
            ctx.beginPath(); ctx.moveTo(lx, screenY-2); ctx.lineTo(lx-2, screenY+2+lift); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(lx+1, screenY-2); ctx.lineTo(lx+3, screenY+2-lift); ctx.stroke();
          }
          ctx.fillStyle='#cfe8a8';
          ctx.fillRect(screenX+(faceDir>0?5:-7), screenY-6, 2, 2); ctx.fillRect(screenX+(faceDir>0?8:-10), screenY-6, 2, 2);
          hpTop(screenY-7);
          break; }
        case 'GOLD_DRAGON': {
          const body = flashing? '#fff3d6' : (m.baseColor||'#b26d32');
          const dark=mixHexColor(body,'#24120a',0.62);
          const gold='#ffd45a';
          const breath=m.state==='breath' || (attack && attack.kind==='spit');
          const gas=m.state==='gas';
          const claw=m.state==='claw';
          const wingLift=Math.sin(phase*1.3)*2;
          const prevComp=ctx.globalCompositeOperation;
          ctx.globalCompositeOperation='lighter';
          ctx.fillStyle='rgba(255,196,64,'+(breath?0.28:0.13)+')';
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-18,38,22,0,0,Math.PI*2);
          ctx.fill();
          ctx.globalCompositeOperation=prevComp;
          ctx.fillStyle=mixHexColor(body,'#5b2e16',0.28);
          ctx.beginPath();
          ctx.moveTo(screenX-faceDir*8,screenY-27+wingLift);
          ctx.lineTo(screenX-faceDir*34,screenY-42+wingLift);
          ctx.lineTo(screenX-faceDir*24,screenY-16);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle=dark;
          ctx.lineWidth=2;
          ctx.stroke();
          box(screenX-28,screenY-31,52,26,body,dark);
          shade(screenX-25,screenY-30,44,6,'#fff',0.12);
          shade(screenX-27,screenY-13,50,8,'#000',0.13);
          ctx.fillStyle=dark;
          ctx.fillRect(screenX-21,screenY-6,9,13);
          ctx.fillRect(screenX+9,screenY-6,9,13);
          ctx.fillStyle=gold;
          for(let i=-18;i<=14;i+=8) ctx.fillRect(screenX+i,screenY-34+Math.sin(phase+i)*1.2,5,7);
          const neckX=screenX+faceDir*20;
          ctx.fillStyle=body;
          ctx.fillRect(neckX-(faceDir>0?1:13),screenY-38,14,18);
          const headX=screenX+faceDir*31;
          box(headX-(faceDir>0?2:18),screenY-47,20,15,body,dark);
          hpTop(screenY-52);
          ctx.fillStyle=gold;
          ctx.fillRect(headX-(faceDir>0?1:7),screenY-53,7,7);
          ctx.fillRect(headX-(faceDir>0?9:0),screenY-51,5,6);
          ctx.fillStyle=breath?'#fff4a8':'#ffcf5a';
          ctx.fillRect(headX+(faceDir>0?9:-11),screenY-43,3,3);
          ctx.fillStyle=dark;
          ctx.fillRect(headX+(faceDir>0?0:-14),screenY-38,12,3);
          ctx.fillRect(headX+(faceDir>0?7:-19),screenY-35,7,3);
          if(breath){
            const flameX=headX+faceDir*15;
            const flameY=screenY-38;
            ctx.globalCompositeOperation='lighter';
            for(let i=0;i<4;i++){
              const len=18+i*8;
              ctx.fillStyle=i%2?'rgba(255,98,35,0.42)':'rgba(255,224,82,0.55)';
              ctx.beginPath();
              ctx.moveTo(flameX,flameY-4+i);
              ctx.lineTo(flameX+faceDir*len,flameY+Math.sin(phase+i)*4);
              ctx.lineTo(flameX,flameY+5+i);
              ctx.closePath();
              ctx.fill();
            }
            ctx.globalCompositeOperation=prevComp;
          }
          if(gas){
            ctx.fillStyle='rgba(126,210,91,0.34)';
            for(let i=0;i<4;i++){
              const gx=screenX-faceDir*(10+i*7);
              const gy=screenY-24+Math.sin(phase+i)*5;
              ctx.beginPath();
              ctx.ellipse(gx,gy,6+i,4+i*0.5,0,0,Math.PI*2);
              ctx.fill();
            }
          }
          if(claw){
            ctx.strokeStyle='rgba(255,232,132,0.78)';
            ctx.lineWidth=2;
            for(let i=-1;i<=1;i++){
              ctx.beginPath();
              ctx.moveTo(screenX+faceDir*21,screenY-12+i*4);
              ctx.lineTo(screenX+faceDir*38,screenY-15+i*4);
              ctx.stroke();
            }
          }
          break; }
        case 'GOLD_DWARF_GUARD': {
          const body = flashing? '#fff1d2' : (m.baseColor||'#8f6240');
          const dark=mixHexColor(body,'#1f140d',0.56);
          const gold='#f3c64a';
          const hammer=m.state==='hammer' || (attack && attack.kind==='slam');
          const throwing=m.state==='throw';
          const step=Math.sin(phase*2.8);
          box(screenX-7,screenY-20,14,15,body,dark);
          shade(screenX-7,screenY-20,14,4,'#fff',0.12);
          ctx.fillStyle=gold;
          ctx.fillRect(screenX-6,screenY-27,12,8);
          ctx.fillStyle='#fff0a6';
          ctx.fillRect(screenX-5,screenY-27,10,2);
          hpTop(screenY-29);
          ctx.fillStyle='#6a3d22';
          ctx.fillRect(screenX-5,screenY-19,10,8);
          ctx.fillStyle=hammer?'#ffe88a':'#11100d';
          ctx.fillRect(screenX+(faceDir>0?2:-4),screenY-24,2,2);
          ctx.fillRect(screenX+(faceDir>0?-2:2),screenY-24,2,2);
          ctx.fillStyle='#3d281b';
          ctx.fillRect(screenX-6,screenY-5,4,8);
          ctx.fillRect(screenX+2,screenY-5,4,8);
          ctx.fillStyle=dark;
          ctx.fillRect(screenX-6+step*1.5,screenY+3,5,3);
          ctx.fillRect(screenX+1-step*1.5,screenY+3,5,3);
          const armY=screenY-15;
          ctx.strokeStyle=dark;
          ctx.lineWidth=3;
          ctx.lineCap='round';
          ctx.beginPath();
          ctx.moveTo(screenX+faceDir*6,armY);
          ctx.lineTo(screenX+faceDir*(hammer?18:throwing?15:11),armY+(hammer?-10:throwing?-6:2));
          ctx.stroke();
          ctx.lineCap='butt';
          ctx.fillStyle='#4b3422';
          const hx=screenX+faceDir*(hammer?21:throwing?18:13);
          const hy=armY+(hammer?-13:throwing?-8:1);
          ctx.fillRect(hx-(faceDir>0?2:5),hy,7,4);
          ctx.fillStyle=gold;
          ctx.fillRect(hx-(faceDir>0?1:8),hy-3,9,6);
          if(hammer){
            ctx.strokeStyle='rgba(255,216,82,0.62)';
            ctx.lineWidth=2;
            ctx.beginPath();
            ctx.arc(screenX+faceDir*12,screenY-12,16,faceDir>0?-1.4:Math.PI-1.4,faceDir>0?0.4:Math.PI+0.4);
            ctx.stroke();
          }
          if(throwing){
            ctx.fillStyle='rgba(255,223,102,0.34)';
            ctx.fillRect(screenX+faceDir*11,screenY-23,faceDir*16,2);
          }
          break; }
        case 'STRAZNIK': { // steel city automaton: riveted body, cyan sensor, cable limbs
          const body = flashing? '#f5fbff' : (m.baseColor||'#8f9aa6');
          const pulse=(Math.sin(now*0.008+m.spawnT*0.003)*0.5+0.5);
          const laserHot = mobLasers.some(l=>Math.abs(l.x1-m.x)<0.7 && Math.abs(l.y1-(m.y-0.62))<0.35);
          const reloading = m.sentinelReloadT>0;
          const reloadFrac = reloading ? Math.max(0,Math.min(1,m.sentinelReloadT/SENTINEL_RELOAD_SECONDS)) : 0;
          box(screenX-7, screenY-22,14,17,body,'#3f4852');
          shade(screenX-7,screenY-22,14,4,'#fff',0.14);
          shade(screenX-7,screenY-9,14,4,'#000',0.15);
          ctx.fillStyle='#5f6872';
          ctx.fillRect(screenX-4,screenY-28,8,7); hpTop(screenY-28);
          const eyeGlow = reloading ? 0.22+0.12*pulse : (laserHot ? 1 : (0.45+0.35*pulse));
          ctx.fillStyle=laserHot?'#f8ffff':(reloading?'#f0a642':'#42e7ff');
          const eyeA=screenX+(faceDir>0?2:-4);
          const eyeB=screenX+(faceDir>0?-2:2);
          ctx.fillRect(eyeA,screenY-26,3,2);
          ctx.fillRect(eyeB,screenY-25,3,2);
          ctx.globalAlpha=eyeGlow*0.45;
          ctx.fillStyle=reloading?'#f0a642':'#42e7ff';
          ctx.fillRect(screenX-7,screenY-28,14,5);
          ctx.globalAlpha=1;
          if(reloading){
            const spin=now*0.014+m.spawnT*0.001;
            ctx.save();
            ctx.translate(screenX,screenY-14);
            ctx.strokeStyle='rgba(240,166,66,0.82)';
            ctx.lineWidth=1.4;
            ctx.beginPath();
            ctx.arc(0,0,5,spin,spin+Math.PI*1.7*(1-reloadFrac));
            ctx.stroke();
            ctx.restore();
            ctx.fillStyle='rgba(24,29,35,0.9)';
            ctx.fillRect(screenX-6,screenY-4,12,2);
            ctx.fillStyle='#f0a642';
            ctx.fillRect(screenX-6,screenY-4,12*(1-reloadFrac),2);
          }
          ctx.strokeStyle='#3f4852'; ctx.lineWidth=2;
          const armSwing=Math.sin(phase)*2;
          ctx.beginPath(); ctx.moveTo(screenX-7,screenY-17); ctx.lineTo(screenX-12,screenY-11+armSwing); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(screenX+7,screenY-17); ctx.lineTo(screenX+12,screenY-11-armSwing); ctx.stroke();
          ctx.fillStyle='#2d333b';
          ctx.fillRect(screenX-14,screenY-11+armSwing,4,4);
          ctx.fillRect(screenX+10,screenY-11-armSwing,4,4);
          ctx.fillStyle='#4b545e';
          ctx.fillRect(screenX-5,screenY-5,3,7);
          ctx.fillRect(screenX+2,screenY-5,3,7);
          ctx.fillStyle='#252b31';
          ctx.fillRect(screenX-6,screenY+1,5,3);
          ctx.fillRect(screenX+1,screenY+1,5,3);
          ctx.fillStyle='#303842';
          for(let yy=screenY-18; yy<=screenY-10; yy+=4){ ctx.fillRect(screenX-4,yy,2,2); ctx.fillRect(screenX+2,yy,2,2); }
          break; }
        case 'RADIATION_COCKROACH': {
          const body = flashing? '#f4ffd6' : (m.baseColor||'#79cf42');
          const glow=0.35+0.30*Math.sin(phase*2.2);
          const skit=Math.sin(phase*4.2);
          ctx.save();
          ctx.globalCompositeOperation='lighter';
          ctx.fillStyle='rgba(164,255,84,'+Math.max(0.16,glow).toFixed(3)+')';
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-3,12,6,0,0,Math.PI*2);
          ctx.fill();
          ctx.restore();
          box(screenX-8,screenY-6,16,7,body,'#263914');
          ctx.fillStyle=mixHexColor(body,'#17300f',0.42);
          ctx.fillRect(screenX-7,screenY-4,14,2);
          ctx.strokeStyle='#263914';
          ctx.lineWidth=1.4;
          for(let i=-2;i<=2;i++){
            const ox=i*3.2;
            const lift=((i&1)?skit:-skit)*1.8;
            ctx.beginPath(); ctx.moveTo(screenX+ox,screenY-1); ctx.lineTo(screenX+ox-4,screenY+3+lift); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(screenX+ox,screenY-1); ctx.lineTo(screenX+ox+4,screenY+3-lift); ctx.stroke();
          }
          ctx.fillStyle='#eaff8e';
          ctx.fillRect(screenX+faceDir*6-(faceDir>0?0:2),screenY-5,2,2);
          ctx.fillStyle='rgba(220,255,124,0.75)';
          ctx.fillRect(screenX-faceDir*10,screenY-2,4,1);
          hpTop(screenY-8);
          break; }
        case 'ATOMIC_BOMB': {
          const body = flashing? '#eef6ff' : (m.baseColor||'#646f77');
          const pulse=Math.sin(now*0.006+m.spawnT*0.004)*0.5+0.5;
          const hot=0.36+0.42*pulse;
          ctx.save();
          ctx.globalCompositeOperation='lighter';
          ctx.fillStyle='rgba(165,255,78,'+(0.12+hot*0.20).toFixed(3)+')';
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-14,23,26,0,0,Math.PI*2);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle=body;
          ctx.beginPath();
          ctx.ellipse(screenX,screenY-12,15,19,0,0,Math.PI*2);
          ctx.fill();
          ctx.strokeStyle='#222a31';
          ctx.lineWidth=2;
          ctx.stroke();
          shade(screenX-12,screenY-25,24,6,'#fff',0.12);
          ctx.fillStyle='#2a3138';
          ctx.fillRect(screenX-8,screenY+5,16,4);
          ctx.fillRect(screenX-4,screenY+9,8,3);
          ctx.strokeStyle='#2a3138';
          ctx.lineWidth=2;
          ctx.beginPath();
          ctx.moveTo(screenX,screenY-31);
          ctx.lineTo(screenX+Math.sin(phase)*6,screenY-40);
          ctx.stroke();
          ctx.fillStyle='rgba(210,255,95,'+(0.55+0.35*pulse).toFixed(3)+')';
          ctx.fillRect(screenX-5,screenY-17,10,10);
          ctx.fillStyle='#20282f';
          ctx.fillRect(screenX-7,screenY-3,14,2);
          ctx.fillRect(screenX-7,screenY-27,14,2);
          ctx.fillStyle='#111820';
          ctx.fillRect(screenX-12,screenY-10,24,2);
          ctx.fillStyle='#eaff8e';
          ctx.fillRect(screenX-2,screenY-14,4,4);
          hpTop(screenY-42);
          break; }
        case 'ICE_SHAMAN':
        case 'FIRE_SHAMAN': {
          const fire=m.id==='FIRE_SHAMAN';
          const body=flashing ? '#ffffff' : (m.baseColor || (fire?'#ff9a4f':'#bff3ff'));
          const dark=fire ? '#552414' : '#24576a';
          const glow=fire ? '#ffcf69' : '#dffaff';
          const active=m.state==='channeling' || !!m._shamanWeatherActive;
          const praying=m.state==='praying' || active;
          const fleeing=m.state==='flee';
          const pulse=Math.sin(phase*1.8)*0.5+0.5;
          ctx.save();
          if(praying){
            ctx.globalCompositeOperation='lighter';
            ctx.fillStyle=fire ? 'rgba(255,104,28,'+(0.12+0.16*pulse).toFixed(3)+')' : 'rgba(130,230,255,'+(0.12+0.16*pulse).toFixed(3)+')';
            ctx.beginPath();
            ctx.ellipse(screenX,screenY-18,active?24:18,active?30:22,0,0,Math.PI*2);
            ctx.fill();
            ctx.globalCompositeOperation='source-over';
          }
          box(screenX-8,screenY-22,16,23,body,dark);
          shade(screenX-8,screenY-5,16,6,'#000',0.15);
          ctx.fillStyle=dark;
          ctx.fillRect(screenX-6,screenY+1,5,8);
          ctx.fillRect(screenX+1,screenY+1,5,8);
          ctx.fillStyle=body;
          ctx.fillRect(screenX-7,screenY-31,14,11);
          hpTop(screenY-34);
          ctx.fillStyle=glow;
          ctx.fillRect(screenX+(faceDir>0?2:-4),screenY-27,2,2);
          ctx.fillRect(screenX+(faceDir>0?-3:3),screenY-27,2,2);
          ctx.fillStyle=fire ? '#2b1008' : '#12313d';
          ctx.fillRect(screenX-3,screenY-22,6,3);
          const armLift=praying ? -16-Math.sin(phase*2)*2 : (fleeing ? -2+Math.sin(phase*4)*2 : 1);
          const armSpread=praying ? 13 : 10;
          ctx.strokeStyle=fire ? '#7a3216' : '#2f7184';
          ctx.lineWidth=3;
          ctx.lineCap='round';
          ctx.beginPath();
          ctx.moveTo(screenX-7,screenY-17);
          ctx.lineTo(screenX-armSpread,screenY-15+armLift);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screenX+7,screenY-17);
          ctx.lineTo(screenX+armSpread,screenY-15+armLift);
          ctx.stroke();
          ctx.lineCap='butt';
          ctx.fillStyle=glow;
          ctx.fillRect(screenX-armSpread-2,screenY-16+armLift,4,4);
          ctx.fillRect(screenX+armSpread-2,screenY-16+armLift,4,4);
          const staffX=screenX-faceDir*12;
          ctx.strokeStyle=fire ? '#3a1a10' : '#24414b';
          ctx.lineWidth=2;
          ctx.beginPath();
          ctx.moveTo(staffX,screenY-29);
          ctx.lineTo(staffX,screenY+5);
          ctx.stroke();
          ctx.fillStyle=glow;
          ctx.fillRect(staffX-3,screenY-33,6,6);
          if(active){
            ctx.strokeStyle=fire ? 'rgba(255,218,105,0.82)' : 'rgba(224,252,255,0.86)';
            ctx.lineWidth=1.4;
            for(let i=0;i<4;i++){
              const x=screenX-18+i*12+Math.sin(phase+i)*2;
              ctx.beginPath();
              ctx.moveTo(x,screenY-42-i%2*3);
              ctx.lineTo(x+weatherShamanTowardCenterDir(m)*8,screenY-53-i%2*4);
              ctx.stroke();
            }
          }
          if(fleeing){
            ctx.fillStyle='rgba(255,255,255,0.36)';
            ctx.fillRect(screenX-faceDir*13,screenY-8,10,2);
            ctx.fillRect(screenX-faceDir*18,screenY-3,12,2);
          }
          ctx.restore();
          break; }
        default: {
          // fallback: small box
          box(screenX-4, screenY-4,8,8, flashing? '#ffffff':'#888', '#444');
        }
      }
      drawMobAttackIntent(ctx,TILE,spec,screenX,screenY,faceDir,phase,attack,hpTop);
      drawMobThreatMarks(ctx,TILE,m,spec,screenX,screenY,faceDir,phase,hpTop);
      // HP bar (position above highest drawn pixel); species with bespoke bars
      // (golden sprinter) or hidden bodies (mole in rock) set m._hideBar
      if(!m._hideBar && m.hp < (m.maxHp || SPECIES[m.id]?.hp || 1)){
        // Transform anchor point to screen space, then draw with identity transform
        const cur = ctx.getTransform ? ctx.getTransform() : null;
        let px = screenX, py = topY;
        if(cur){
          // DOMMatrix: [ a c e; b d f; 0 0 1 ]
          const tx = cur.a * screenX + cur.c * topY + cur.e;
          const ty = cur.b * screenX + cur.d * topY + cur.f;
          px = tx; py = ty;
        }
        const hpSpec = SPECIES[m.id] || {hp:1};
        const screenSpace = !!ctx.setTransform;
        if(screenSpace){ ctx.save(); ctx.setTransform(1,0,0,1,0,0); }
        try{
          const maxHp = m.maxHp || hpSpec.hp || 1;
          const w = Math.max(12, Math.min(36, maxHp||10));
          const frac = Math.max(0, Math.min(1, m.hp/maxHp));
          const barY = py - 6;
          ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(px - w/2, barY, w, 3);
          ctx.fillStyle='#ff5252'; ctx.fillRect(px - w/2, barY, w * frac, 3);
        } finally {
          if(screenSpace) ctx.restore();
          else if(cur && ctx.setTransform) ctx.setTransform(cur);
        }
      }
      ctx.restore(); }
    // Burning mobs: flame overlay drawn after bodies so fire reads on top
    for(const m of mobs){
      if(!hasStatus(m,'burn')) continue;
      if(!disableCull && (m.x < viewL || m.x > viewR || m.y < viewT || m.y > viewB)) continue;
      if(!mobVisible(m)) continue;
      const px=m.x*TILE, py=m.y*TILE;
      const flick=Math.sin(now*0.025 + m.spawnT*0.01)*0.5+0.5;
      const h=TILE*(0.7+0.5*flick)*(m.scale||1);
      const baseY=py+TILE*0.3;
      const g=ctx.createLinearGradient(px,baseY,px,baseY-h);
      g.addColorStop(0,'rgba(255,120,20,0.8)'); g.addColorStop(0.7,'rgba(255,210,80,0.55)'); g.addColorStop(1,'rgba(255,255,180,0)');
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.moveTo(px-TILE*0.3, baseY);
      ctx.quadraticCurveTo(px + Math.sin(now*0.02+m.spawnT)*3, baseY-h*1.15, px+TILE*0.3, baseY);
      ctx.closePath(); ctx.fill();
      if(Math.random()<0.3){ ctx.fillStyle='rgba(255,230,140,0.9)'; ctx.fillRect(px+(Math.random()*2-1)*6, baseY-h-Math.random()*4, 2,2); }
    }
    for(const fx of mobDeathFx){
      if(!disableCull && (fx.x < viewL || fx.x > viewR || fx.y < viewT || fx.y > viewB)) continue;
      drawMobDeathFx(ctx,TILE,fx,visibleTile);
    }
    // City sentinel eye lasers: short-lived dual beams with a hot core.
    if(mobLasers.length){
      const prevComp=ctx.globalCompositeOperation;
      ctx.globalCompositeOperation='lighter';
      const frameMs=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
      const cheapLasers=frameMs>24 || mobLasers.length>8;
      for(const l of mobLasers){
        if(visibleTile && !visibleTile(Math.floor(l.x1),Math.floor(l.y1)) && !visibleTile(Math.floor(l.x2),Math.floor(l.y2))) continue;
        const age=Math.max(0,Math.min(1,l.t/l.life));
        const a=(1-age);
        const wob=Math.sin(now*0.06+l.phase)*1.2;
        const x1=l.x1*TILE, y1=l.y1*TILE, x2=l.x2*TILE, y2=l.y2*TILE;
        ctx.lineCap='round';
        ctx.strokeStyle='rgba(40,220,255,'+(0.22*a)+')';
        ctx.lineWidth=cheapLasers?7:9+5*a;
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        if(cheapLasers){
          ctx.strokeStyle='rgba(130,245,255,'+(0.82*a)+')';
        } else {
          const grad=ctx.createLinearGradient(x1,y1,x2,y2);
          grad.addColorStop(0,'rgba(120,255,255,'+(0.95*a)+')');
          grad.addColorStop(0.45,'rgba(255,70,255,'+(0.65*a)+')');
          grad.addColorStop(1,(l.hit?'rgba(255,255,255,':'rgba(80,190,255,')+(0.85*a)+')');
          ctx.strokeStyle=grad;
        }
        ctx.lineWidth=cheapLasers?3.2:4+2*a;
        ctx.beginPath(); ctx.moveTo(x1,y1+wob); ctx.lineTo(x2,y2-wob); ctx.stroke();
        ctx.strokeStyle='rgba(255,255,255,'+(0.95*a)+')';
        ctx.lineWidth=1.2+1.2*a;
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        const r=(l.hit?7:5)*(0.7+a);
        ctx.fillStyle=(l.hit?'rgba(255,255,255,':'rgba(80,220,255,')+(0.45*a)+')';
        ctx.beginPath(); ctx.arc(x2,y2,r,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(255,80,255,'+(0.35*a)+')';
        ctx.fillRect(x2-r*0.55,y2-1,r*1.1,2);
        ctx.fillRect(x2-1,y2-r*0.55,2,r*1.1);
      }
      ctx.globalCompositeOperation=prevComp;
    }
    // Mob projectiles: spinning bone shards
    for(const pr of mobProjectiles){
      if(visibleTile && !visibleTile(Math.floor(pr.x), Math.floor(pr.y))) continue;
      ctx.save();
      ctx.translate(pr.x*TILE, pr.y*TILE); ctx.rotate(pr.spin);
      if(pr.type==='spit'){
        ctx.fillStyle='rgba(154,114,47,0.92)';
        ctx.beginPath(); ctx.ellipse(0,0,7,4,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(235,198,104,0.78)';
        ctx.fillRect(-3,-2,5,3);
        ctx.fillStyle='rgba(93,58,21,0.45)';
        ctx.fillRect(-8,1,5,2);
      } else if(pr.type==='rock'){
        ctx.fillStyle='#5c6268';
        ctx.beginPath();
        ctx.moveTo(-7,-4); ctx.lineTo(-2,-7); ctx.lineTo(6,-5);
        ctx.lineTo(8,2); ctx.lineTo(2,7); ctx.lineTo(-6,5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.16)';
        ctx.fillRect(-4,-4,5,2);
        ctx.fillStyle='rgba(0,0,0,0.24)';
        ctx.fillRect(1,3,5,2);
      } else if(pr.type==='dragon_fire'){
        const prevComp=ctx.globalCompositeOperation;
        ctx.globalCompositeOperation='lighter';
        ctx.fillStyle='rgba(255,94,35,0.82)';
        ctx.beginPath();
        ctx.ellipse(0,0,9,5,0,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle='rgba(255,232,92,0.88)';
        ctx.beginPath();
        ctx.ellipse(2,0,5,3,0,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle='rgba(116,216,78,0.28)';
        ctx.fillRect(-10,2,8,3);
        ctx.globalCompositeOperation=prevComp;
      } else if(pr.type==='gold_pick'){
        ctx.fillStyle='#f1c64d';
        ctx.fillRect(-6,-1.5,12,3);
        ctx.fillStyle='#4a3222';
        ctx.fillRect(-1,-6,2,12);
        ctx.fillStyle='rgba(255,255,255,0.22)';
        ctx.fillRect(-5,-2.5,5,1);
      } else {
        ctx.fillStyle='#e8e4d8'; ctx.fillRect(-5,-1.5,10,3);
        ctx.fillStyle='#c9c2b0'; ctx.fillRect(-6,-2.5,3,5); ctx.fillRect(3,-2.5,3,5);
      }
      ctx.restore();
    }
    // Poisoned mobs: rising green wisps
    for(const m of mobs){
      if(!hasStatus(m,'poison')) continue;
      if(!disableCull && (m.x < viewL || m.x > viewR || m.y < viewT || m.y > viewB)) continue;
      if(!mobVisible(m)) continue;
      const px=m.x*TILE, py=m.y*TILE;
      for(let i=0;i<3;i++){
        const ph=(now*0.0035 + m.spawnT*0.01 + i*2.1)%(Math.PI*2);
        const wy=py - 4 - ((now*0.02 + i*37 + m.spawnT)%18);
        const wx=px + Math.sin(ph+i)*5;
        ctx.fillStyle='rgba(120,220,80,'+(0.55-0.025*((wy-py+22)|0)).toFixed(2)+')';
        ctx.fillRect(wx, wy, 3, 3);
      }
    }
    ctx.restore();
  }

  // --- Abduction support (UFO): pick a live victim, then detach it silently ---
  function nearestLiving(wx,wy,r,opts){
    let best=null, bd=Infinity; const r2=r*r;
    for(const m of mobs){
      if(m.hp<=0 || !mobAllowedByOpts(m,opts)) continue;
      const dx=m.x-wx, dy=m.y-wy, d2=dx*dx+dy*dy;
      if(d2<=r2 && d2<bd){ bd=d2; best=m; }
    }
    return best;
  }
  function nearestHostileLiving(wx,wy,r,opts){
    let best=null, bd=Infinity, bp=-1; const r2=r*r, now=Date.now();
    for(const m of mobs){
      if(m.hp<=0 || !mobAllowedByOpts(m,opts) || !isMobHostile(m,now)) continue;
      const dx=m.x-wx, dy=m.y-wy, d2=dx*dx+dy*dy;
      if(d2>r2) continue;
      const priority=(opts && opts.preferHeroFocus===false) ? 0 : (isHeroFocused(m,now) ? 1 : 0);
      if(priority>bp || (priority===bp && d2<bd)){ bp=priority; bd=d2; best=m; }
    }
    return best;
  }
  function abduct(m){ // removal without loot/XP — the creature is gone, not slain
    const i=mobs.indexOf(m); if(i<0) return false;
    removeFromGrid(m); mobs.splice(i,1);
    return true;
  }

  function findAt(x,y){ // tile space coords using spatial grid
    if(!finiteCoord(x) || !finiteCoord(y)) return null;
    // Mobs within hit range can live in a neighbouring cell when the click lands near a
    // cell border, so scan the full 3×3 neighbourhood (cells are CELL tiles wide — cheap).
    const wx = x+0.5, wy = y+0.5;
    let best=null, bestD=Infinity;
    for(let gx=-1; gx<=1; gx++){
      for(let gy=-1; gy<=1; gy++){
        const set=grid.get(cellKey(wx+gx*CELL, wy+gy*CELL)); if(!set) continue;
        for(const m of set){ const dx=Math.abs(m.x-wx), dy=Math.abs(m.y-wy); if(dx<0.9 && dy<0.9){ const d=dx+dy; if(d<bestD){ best=m; bestD=d; } } }
      }
    }
    return best; }

  function sandWormWaterHitOpts(opts){
    if(!opts || typeof opts!=='object') return false;
    const element=String(opts.element||opts.kind||opts.type||opts.cause||'').toLowerCase();
    return element==='water' || element==='hose' || element==='douse';
  }
  function attackAt(tileX,tileY,dmgBonus,opts){ const m=findAt(tileX,tileY); if(!m) return false; const bonus=(typeof dmgBonus==='number' && isFinite(dmgBonus) && dmgBonus>0)? dmgBonus:0; damageMob(m, 3 + bonus, opts); setAggro(m.id); return true; }

  // Absolute-damage strike (projectiles): no base melee added
  function damageAt(tileX,tileY,dmg,opts){
    const m=findAt(tileX,tileY); if(!m) return false;
    if(m.id==='SAND_WORM' && sandWormWaterHitOpts(opts)){
      pacifySandWorm(m,'water',performance.now(),{x:tileX+0.5,y:tileY+0.5});
      return true;
    }
    damageMob(m, Math.max(0.5, (typeof dmg==='number' && isFinite(dmg))? dmg:1), opts); setAggro(m.id); return true;
  }

  function mobRect(m,spec){
    const e=bodyHalfExtents(m,spec);
    return {left:m.x-e.halfW, right:m.x+e.halfW, top:m.y-e.halfH, bottom:m.y+e.halfH};
  }
  function overlapRect(a,b){
    const x=Math.min(a.right,b.right)-Math.max(a.left,b.left);
    const y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    return {x,y,hit:x>0 && y>0};
  }
  function clampMobVelocity(v,max){
    if(!finiteNum(v)) return 0;
    const m=Number.isFinite(max) ? Math.max(0.1,max) : 8;
    return Math.max(-m,Math.min(m,v));
  }
  // Rafts are physical hulls: they nudge fish and any other creature out of
  // their plank cells instead of ghosting through living objects.
  function collideBoat(boat, boatBounds, dt, opts){
    if(!boat || !finiteCoord(boat.x) || !finiteCoord(boat.y) || !Array.isArray(boat.cells)) return {hits:0,aquatic:0,blockers:0,drag:0};
    const frameDt=Math.max(0,Math.min(0.1,Number(dt)||0));
    const getTile=opts && typeof opts.getTile==='function' ? opts.getTile : null;
    const bx=boat.x, by=boat.y;
    const bb=boatBounds || {minDx:0,maxDx:0,minDy:0,maxDy:0};
    const hull={left:bx+bb.minDx, right:bx+bb.maxDx+1, top:by+bb.minDy, bottom:by+bb.maxDy+1};
    const boatVx=finiteNum(boat.vx)?boat.vx:0;
    const boatVy=finiteNum(boat.vy)?boat.vy:0;
    let hits=0, aquatic=0, blockers=0, drag=0;
    for(const m of mobs){
      const spec=SPECIES[m.id];
      if(!spec || !validMobState(m) || m.hp<=0) continue;
      const mr=mobRect(m,spec);
      if(!overlapRect(hull,mr).hit) continue;
      let best=null;
      for(const c of boat.cells){
        if(!Number.isFinite(c.dx) || !Number.isFinite(c.dy)) continue;
        const cr={left:bx+c.dx, right:bx+c.dx+1, top:by+c.dy, bottom:by+c.dy+1};
        const ov=overlapRect(cr,mr);
        if(!ov.hit) continue;
        if(!best || ov.x*ov.y>best.x*best.y) best={x:ov.x,y:ov.y,cell:c};
      }
      if(!best) continue;
      hits++;
      if(spec.aquatic) aquatic++;
      const dragWeight=Number.isFinite(spec.boatDrag) ? Math.max(0,spec.boatDrag) : 1;
      if(dragWeight>0) blockers++;
      drag+=dragWeight;
      const nonBlocking=dragWeight<=0.001;
      if(nonBlocking){
        m._boatAvoidX=(hull.left+hull.right)*0.5;
        m._boatAvoidY=(hull.top+hull.bottom)*0.5;
        m._boatAvoidUntil=performance.now()+850;
      }
      const horizontalHullHit=Math.abs(boatVx)>0.15 && best.x<=best.y*3.5;
      if(horizontalHullHit || best.x<=best.y*1.25){
        const cellCenter=bx+best.cell.dx+0.5;
        let dir=m.x<cellCenter ? -1 : 1;
        if(Math.abs(m.x-cellCenter)<0.01) dir=boatVx<0 ? -1 : 1;
        m.x+=dir*(best.x+(nonBlocking?0.18:0.025));
        const kick=nonBlocking ? Math.max(1.8,Math.abs(boatVx)*1.1) : Math.max(0.45,Math.abs(boatVx)*0.65);
        m.vx=clampMobVelocity((m.vx||0)+dir*kick,nonBlocking?14:10);
      } else {
        const cellCenter=by+best.cell.dy+0.5;
        const dir=m.y<cellCenter ? -1 : 1;
        m.y+=dir*(best.y+(nonBlocking?0.12:0.025));
        const kick=nonBlocking ? Math.max(1.1,Math.abs(boatVy)*0.7+Math.abs(boatVx)*0.18) : Math.max(0.22,Math.abs(boatVy)*0.45+Math.abs(boatVx)*0.10);
        m.vy=clampMobVelocity((m.vy||0)+dir*kick,nonBlocking?12:8);
      }
      if(spec.aquatic && getTile){
        const tx=Math.floor(m.x), ty=Math.floor(m.y);
        if(readMobTile(getTile,tx,ty)!==T.WATER){
          const safe=nearestWaterCell(tx,ty,getTile,3,3);
          if(safe){
            m.x=safe.x; m.y=safe.y;
            m.vx*=0.45; m.vy*=0.45;
          }
        }
      }
      m.shake=Math.max(m.shake||0,0.25+frameDt*1.5);
      m.facing=(m.vx||0)>=0?1:-1;
      updateGridCell(m);
    }
    return {hits,aquatic,blockers,drag};
  }
  function collideMech(mech, mechBounds, dt, opts){
    if(!mech || !finiteCoord(mech.x) || !finiteCoord(mech.y) || !Array.isArray(mech.cells)) return {hits:0,damaged:0,blockers:0};
    const frameDt=Math.max(0,Math.min(0.1,Number(dt)||0));
    const hull=mechBounds || {left:mech.x,right:mech.x+1,top:mech.y,bottom:mech.y+1};
    const vx=finiteNum(mech.vx)?mech.vx:0;
    const vy=finiteNum(mech.vy)?mech.vy:0;
    const speed=Math.hypot(vx,vy);
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    const baseDamage=Math.max(2,Number(opts && opts.damage)||12);
    let hits=0, damaged=0, blockers=0;
    for(const mob of mobs){
      const spec=SPECIES[mob.id];
      if(!spec || !validMobState(mob) || mob.hp<=0) continue;
      const mr=mobRect(mob,spec);
      if(!overlapRect(hull,mr).hit) continue;
      let best=null;
      for(const c of mech.cells){
        if(!Number.isFinite(c.dx) || !Number.isFinite(c.dy)) continue;
        const cr={left:mech.x+c.dx,right:mech.x+c.dx+1,top:mech.y+c.dy,bottom:mech.y+c.dy+1};
        const ov=overlapRect(cr,mr);
        if(!ov.hit) continue;
        if(!best || ov.x*ov.y>best.x*best.y) best={x:ov.x,y:ov.y,cell:c};
      }
      if(!best) continue;
      hits++;
      blockers++;
      const cellCx=mech.x+best.cell.dx+0.5;
      const cellCy=mech.y+best.cell.dy+0.5;
      const horizontal=Math.abs(vx)>0.08 && best.x<=best.y*2.8;
      if(horizontal || best.x<=best.y){
        let dir=mob.x<cellCx ? -1 : 1;
        if(Math.abs(mob.x-cellCx)<0.01) dir=vx<0 ? -1 : 1;
        mob.x+=dir*(best.x+0.055);
        mob.vx=clampMobVelocity((mob.vx||0)+dir*Math.max(1.4,Math.abs(vx)*1.35+1.1),14);
      }else{
        const dir=mob.y<cellCy ? -1 : 1;
        mob.y+=dir*(best.y+0.045);
        mob.vy=clampMobVelocity((mob.vy||0)+dir*Math.max(0.9,Math.abs(vy)*0.9+Math.abs(vx)*0.25),12);
      }
      if(now>(mob._mechHitUntil||0)){
        const crush=baseDamage*(0.45+Math.min(1.4,speed*0.28));
        damageMob(mob,crush,{source:(opts && opts.source)||'mech',cause:'mech_collision',srcX:cellCx,srcY:cellCy});
        setAggro(mob.id);
        mob._mechHitUntil=now+520;
        damaged++;
      }
      mob.shake=Math.max(mob.shake||0,0.35+frameDt*1.8);
      mob.facing=(mob.vx||0)>=0?1:-1;
      updateGridCell(mob);
    }
    return {hits,damaged,blockers};
  }

  // --- Status effects (data-driven). Each entry declares cadence, gating, cures
  // and movement side-effects; a new effect ("freeze", "stun") is one table row
  // plus an optional draw branch — not another set of m.* field pairs copied
  // through update/draw/API. Only organic creatures are affected (species may
  // opt out with organic:false, e.g. future golems).
  const STATUS={
    burn:  { tickEvery:0.5, organicOnly:true, curedByWater:true,  panic:2.5 },
    poison:{ tickEvery:0.6, organicOnly:true, curedByWater:false, slowRate:0.5 },
  };
  function applyStatus(m,id,opts){
    const def=STATUS[id]; if(!def) return false;
    if(!mobAllowedByOpts(m,opts)) return false;
    const spec=SPECIES[m.id];
    if(def.organicOnly && (!spec || spec.organic===false)) return false;
    const st=m.status || (m.status={});
    const s=st[id] || (st[id]={t:0,dps:0,acc:0});
    s.t=Math.max(s.t, (opts && opts.dur)||3);
    s.dps=Math.max(s.dps, (opts && opts.dps)||2);
    if(opts && typeof opts==='object'){
      if(opts.source!=null) s.source=String(opts.source);
      if(opts.cause!=null || opts.element!=null) s.cause=String(opts.cause || opts.element);
    }
    setAggro(m.id);
    noteDamageSource(m,opts);
    return true;
  }
  function hasStatus(m,id){ return !!(m.status && m.status[id] && m.status[id].t>0); }
  function clearStatus(m,id){ if(m.status && m.status[id]) delete m.status[id]; }
  function tickStatuses(m,getTile,dt){
    const st=m.status; if(!st) return;
    for(const id in st){
      const s=st[id], def=STATUS[id];
      if(!def || !(s.t>0)){ delete st[id]; continue; }
      if(def.curedByWater && getTile && getTile(Math.floor(m.x),Math.floor(m.y))===T.WATER){ delete st[id]; continue; }
      s.t-=dt; s.acc+=dt;
      if(s.acc>=def.tickEvery){ s.acc-=def.tickEvery; damageMob(m, s.dps*def.tickEvery,{source:s.source||id,cause:s.cause||id}); }
      if(def.panic && Math.random()<0.08){ m.vx+=(Math.random()*2-1)*def.panic; m.facing=m.vx>=0?1:-1; }
      if(def.slowRate) m.vx*=Math.max(0,1-dt*def.slowRate);
    }
  }
  // Public point/area applicators (weapons & tile fire use these)
  function igniteAt(tileX,tileY,opts){ const m=findAt(tileX,tileY); if(!m) return false; return applyStatus(m,'burn',opts); }
  function igniteRadius(wx,wy,r,opts){ let n=0; const r2=r*r; for(const m of mobs){ const dx=m.x-wx, dy=m.y-wy; if(dx*dx+dy*dy<=r2 && applyStatus(m,'burn',opts)) n++; } return n; }
  function poisonAt(tileX,tileY,opts){ const m=findAt(tileX,tileY); if(!m) return false; return applyStatus(m,'poison',opts); }
  function poisonRadius(wx,wy,r,opts){ let n=0; const r2=r*r; for(const m of mobs){ const dx=m.x-wx, dy=m.y-wy; if(dx*dx+dy*dy<=r2 && applyStatus(m,'poison',opts)) n++; } return n; }
  // Water hose: put out burning creatures in an area
  function douseRadius(wx,wy,r){
    let n=0; const r2=r*r; const now=performance.now();
    for(const m of mobs){
      const dx=m.x-wx, dy=m.y-wy;
      if(dx*dx+dy*dy>r2) continue;
      let changed=false;
      if(hasStatus(m,'burn')){ clearStatus(m,'burn'); changed=true; }
      if(m.id==='SAND_WORM' && pacifySandWorm(m,'water',now,{x:wx,y:wy})) changed=true;
      if(m.id==='STONE_GOLEM' && pacifyStoneGolem(m,'water',now)) changed=true;
      if(changed) n++;
    }
    return n;
  }
  function shockAquaticRadius(wx,wy,r,opts){
    opts=opts||{};
    const radius=Math.max(0,Number(r)||0);
    const r2=radius*radius;
    const damage=Math.max(1,Number(opts.damage)||999);
    const getTile=typeof opts.getTile==='function' ? opts.getTile : null;
    let hit=0, killed=0;
    for(const m of mobs){
      if(!validMobState(m) || m.hp<=0) continue;
      const spec=SPECIES[m.id];
      if(!spec || !spec.aquatic) continue;
      const dx=m.x-wx, dy=m.y-wy;
      const d2=dx*dx+dy*dy;
      if(d2>r2) continue;
      if(getTile && readMobTile(getTile,Math.floor(m.x),Math.floor(m.y))!==T.WATER) continue;
      hit++;
      const wasAlive=m.hp>0;
      const oldNatural=m._naturalDeath;
      const useNaturalDeath=opts.naturalDeath!==false;
      if(useNaturalDeath) m._naturalDeath=true;
      const d=Math.sqrt(d2);
      damageMob(m, Math.max(1,damage*(1-d/(radius+0.5))), {source:opts.source||'lightning',cause:opts.cause||'electric'});
      if(wasAlive && m.hp<=0) killed++;
      if(!useNaturalDeath || m.hp>0) m._naturalDeath=oldNatural;
      if(m.hp>0){
        const push=2.5*(1-d/(radius+1));
        m.vx+=(dx/(d||1))*push;
        m.vy+=(dy/(d||1))*push;
        m.shake=Math.max(m.shake||0,0.75);
        updateGridCell(m);
      }
    }
    return {hit,killed};
  }
  // Explosion: distance-scaled area damage with knockback away from the center
  function blastRadius(wx,wy,r,dmg,opts){
    let n=0; const r2=r*r;
    for(const m of mobs){
      if(!mobAllowedByOpts(m,opts)) continue;
      const dx=m.x-wx, dy=m.y-wy; const d2=dx*dx+dy*dy;
      if(d2>r2) continue;
      const d=Math.sqrt(d2);
      const blastOpts=Object.assign({cause:'blast'},opts||{});
      damageMob(m, Math.max(2, Math.round((dmg||10)*(1-d/(r+0.5)))), blastOpts);
      const k=6*(1-d/(r+1));
      m.vx+=(dx/(d||1))*k; m.vy+=(dy/(d||1))*k-2;
      setAggro(m.id); n++;
    }
    return n;
  }
  function healRadiationRain(centerX,radius,amount,opts){
    const r=Math.max(1,Number(radius)||38);
    const heal=Math.max(0.1,Number(amount)||1);
    const rainAt=MM && MM.clouds && typeof MM.clouds.isRainingAt==='function' ? MM.clouds.isRainingAt : null;
    const minX=Number.isFinite(centerX) ? centerX-r : -Infinity;
    const maxX=Number.isFinite(centerX) ? centerX+r : Infinity;
    let healed=0;
    for(const m of mobs){
      if(!validMobState(m) || m.hp<=0 || !(m.hp<m.maxHp)) continue;
      if(m.x<minX || m.x>maxX) continue;
      if(rainAt && !rainAt(Math.floor(m.x))) continue;
      m.hp=Math.min(m.maxHp,m.hp+heal);
      healed++;
      if(healed<=3 && (!opts || opts.particles!==false)){
        try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(m.x*(MM.TILE||20),(m.y-0.25)*(MM.TILE||20),'common',2); }catch(e){}
      }
    }
    return healed;
  }

  const NO_MEAT_DROP = { FIREFLY:true, GHOUL:true, SZKIELET:true, PELZACZ:true, GOLD_DRAGON:true, GOLD_DWARF_GUARD:true, STRAZNIK:true, ATOMIC_BOMB:true, RADIATION_COCKROACH:true, ZLOTY:true, ATLANTIS_MEDUZA:true, VULTURE_HATCHLING:true };
  const MEAT_DROP_CHANCE = {
    BEAR:1, SHARK:1,
    DEER:0.75, WOLF:0.75, GOAT:0.65,
    EEL:0.45, FISH:0.4, PIRANHA:PIRANHA_MEAT_DROP_CHANCE, CRAB:0.35,
    RABBIT:0.3, JASZCZUR:0.3, ZABA:0.25,
    BIRD:0.25, OWL:0.25, VULTURE:0.55,
    SQUIRREL:0.1, BAT:0.1
  };
  function inferredMeatDropChance(spec){
    const hp=(typeof spec.hp==='number' && isFinite(spec.hp)) ? spec.hp : 5;
    const body=spec.body || {w:1,h:1};
    const w=(typeof body.w==='number' && isFinite(body.w)) ? body.w : 1;
    const h=(typeof body.h==='number' && isFinite(body.h)) ? body.h : 1;
    const area=Math.max(0.05,w*h);
    if(hp>=28 || area>=1.8) return 1;
    if(hp>=14 || area>=1.25) return 0.65;
    if(hp>=8 || area>=0.8) return 0.35;
    return 0.1;
  }
  function meatDropChanceFor(m,spec){
    if(typeof spec.meatDropChance==='number' && isFinite(spec.meatDropChance)) return spec.meatDropChance;
    if(Object.prototype.hasOwnProperty.call(MEAT_DROP_CHANCE,m.id)) return MEAT_DROP_CHANCE[m.id];
    return inferredMeatDropChance(spec);
  }
  function shouldDropMeat(m,spec){
    if(!m || !spec) return false;
    if(spec.organic===false || spec.meat===false || NO_MEAT_DROP[m.id]) return false;
    const chance = Math.max(0,Math.min(1,meatDropChanceFor(m,spec)));
    return chance>=1 || Math.random()<=chance;
  }
  function dropMeatForMob(m,spec){
    if(!shouldDropMeat(m,spec)) return false;
    try{ if(MM.meat && MM.meat.dropFromMob) return !!MM.meat.dropFromMob(m,WORLD.getTile,WORLD.setTile); }catch(e){}
    return false;
  }

  function noteEntityNumber(detail){
    try{
      if(typeof window.dispatchEvent==='function' && typeof CustomEvent==='function'){
        window.dispatchEvent(new CustomEvent('mm-entity-number',{detail}));
      }
    }catch(e){}
  }
  function noteCombatEvent(detail){
    try{
      if(typeof window.dispatchEvent==='function' && typeof CustomEvent==='function'){
        window.dispatchEvent(new CustomEvent('mm-combat-event',{detail}));
      }
    }catch(e){}
  }
  function mobThermalProfile(m,spec){
    spec=spec || (m && SPECIES[m.id]) || {};
    const id=String((m && m.id) || (spec && spec.id) || '').toLowerCase();
    const cause=String((spec && (spec.contactCause || spec.damageCause || spec.element || spec.biome)) || '').toLowerCase();
    const cold=(m && m.hostilitySide==='cold') ||
      id.indexOf('ice')>=0 || id.indexOf('snow')>=0 || id.indexOf('wraith')>=0 || id.indexOf('zimow')>=0 ||
      cause.indexOf('ice')>=0 || cause.indexOf('frost')>=0 || cause.indexOf('chill')>=0 || cause.indexOf('snow')>=0;
    const hot=(m && m.hostilitySide==='hot') || hasStatus(m,'burn') ||
      id.indexOf('fire')>=0 || id.indexOf('flame')>=0 || id.indexOf('lava')>=0 || id.indexOf('volcano')>=0 ||
      cause.indexOf('fire')>=0 || cause.indexOf('flame')>=0 || cause.indexOf('lava')>=0 || cause.indexOf('burn')>=0;
    return {hot,cold};
  }
  function mobThermalDamageBonus(m,spec,opts){
    if(!m || !sourceIsHero(opts)) return null;
    const element=combatElementFromOpts(opts);
    if(!element) return null;
    const profile=mobThermalProfile(m,spec);
    const pct=Math.round((THERMAL_DAMAGE_BONUS_MULT-1)*100);
    if(element==='fire' && profile.cold) return {mult:THERMAL_DAMAGE_BONUS_MULT,pct,kind:'heat',element:'fire'};
    if((element==='water' || element==='ice') && profile.hot) return {mult:THERMAL_DAMAGE_BONUS_MULT,pct,kind:element==='ice'?'cold':'cool',element};
    return null;
  }
  function noteMobCombatHit(m,dealt,opts,willDie,beforeHp,thermalBonus){
    if(!m || !sourceIsHero(opts)) return;
    const special=!!(opts && typeof opts==='object' && opts.specialAttack);
    const lucky=!!(opts && typeof opts==='object' && opts.luckyStrike);
    const element=combatElementFromOpts(opts);
    const spec=SPECIES[m.id] || {};
    const maxHp=Math.max(1,Number(m.maxHp)||Number(spec.hp)||Number(beforeHp)||1);
    const major=dealt>=Math.max(7,maxHp*0.20);
    const elemental=!!element;
    const bonusPct=thermalBonus && thermalBonus.pct>0 ? thermalBonus.pct : 0;
    const important=willDie || special || lucky || major || bonusPct>0 || (elemental && dealt>=Math.max(1.5,maxHp*0.055));
    if(!important) return;
    const now=performance.now();
    if(!willDie && !special && !lucky && !major && now<(m._nextCombatEventAt||0)) return;
    m._nextCombatEventAt=now+(elemental?360:260);
    let kind='heavy';
    if(lucky) kind='lucky';
    else if(special) kind='special';
    else if(elemental) kind='elemental';
    noteCombatEvent({
      kind,
      source:'hero',
      target:'mob',
      x:finiteCoord(m.x)?m.x:undefined,
      y:finiteCoord(m.y)?m.y-0.55:undefined,
      amount:dealt,
      species:m.id,
      cause:opts && typeof opts==='object' ? (opts.cause || opts.kind || opts.type || opts.weaponType) : undefined,
      element,
      special,
      lucky,
      major,
      bonusDamagePct:bonusPct || undefined,
      thermalKind:thermalBonus && thermalBonus.kind,
      finisher:!!willDie,
      power:Math.max(0.65,Math.min(2.4,dealt/Math.max(6,maxHp*0.16))),
      dir:(opts && typeof opts==='object' && finiteNum(opts.x)) ? (m.x>=opts.x?1:-1) : undefined
    });
  }
  function damageMob(m,amount,opts){
    if(m.hp<=0) return;
    const spec=SPECIES[m.id] || {};
    const thermalBonus=mobThermalDamageBonus(m,spec,opts);
    const dealt=Math.max(0.5, (Number(amount)||0.5) * (thermalBonus ? thermalBonus.mult : 1));
    const beforeHp=Number(m.hp)||0;
    const willDie=beforeHp-dealt<=0;
    noteDamageSource(m,opts);
    m.hp-=dealt;
    m.hitFlashUntil = performance.now()+120;
    m.shake = 0.6;
    noteMobCombatHit(m,dealt,opts,willDie,beforeHp,thermalBonus);
    if(typeof spec.onDamaged==='function'){
      try{ spec.onDamaged(m,spec,{amount:dealt,beforeHp,opts,now:performance.now(),willDie}); }catch(e){}
    }
    if(m.hp<=0){ m.hp=0; m.shake=1; spawnMobDeathFx(m,opts); onMobDeath(m); }
  }

  function cleanXpFatigueEntry(entry){
    if(!entry || typeof entry!=='object') return null;
    const kills=Number(entry.kills);
    const lastDay=Number(entry.lastDay);
    if(!isFinite(kills) || kills<0 || !isFinite(lastDay) || lastDay<=0) return null;
    return {kills:Math.max(0,Math.min(10000,Math.floor(kills))), lastDay};
  }
  function xpFatigueMultiplier(specId,day){
    const id=String(specId||'');
    let entry=cleanXpFatigueEntry(xpFatigue[id]) || {kills:0,lastDay:day};
    if(day-entry.lastDay>=XP_FATIGUE_RESET_DAYS) entry={kills:0,lastDay:day};
    const mult=id==='ATOMIC_BOMB'
      ? Math.pow(ATOMIC_BOMB_XP_DECAY,Math.min(30,entry.kills))
      : Math.max(XP_FATIGUE_MIN_MULT, 1-entry.kills*XP_FATIGUE_STEP);
    return {entry,mult};
  }
  function noteXpAwardEvent(detail){
    try{
      if(typeof window.dispatchEvent==='function' && typeof CustomEvent==='function'){
        window.dispatchEvent(new CustomEvent('mm-xp-awarded',{detail}));
        return;
      }
    }catch(e){}
    try{ if(MM.vitalsHud && typeof MM.vitalsHud.noteXpAward==='function') MM.vitalsHud.noteXpAward(detail); }catch(e){}
  }
  function awardMobXp(m,spec,player){
    const base=Math.max(0,Math.round(Number(spec && spec.xp) || 1));
    if(!player || typeof player.xp!=='number' || base<=0) return {amount:0,base,fatigueMult:1,special:false};
    const day=currentGameDayFloat();
    const fatigue=xpFatigueMultiplier(m.id,day);
    const special=!!m._lastHeroHitSpecial && m.id!=='ATOMIC_BOMB';
    const specialMult=special ? XP_SPECIAL_BONUS_MULT : 1;
    const amount=Math.max(1,Math.round(base*fatigue.mult*specialMult));
    player.xp += amount;
    const next={kills:fatigue.entry.kills+1,lastDay:day};
    xpFatigue[m.id]=next;
    const detail={
      amount,
      base,
      species:m.id,
      fatigueKills:fatigue.entry.kills,
      fatigueMult:+fatigue.mult.toFixed(3),
      special,
      specialMult,
      day:+day.toFixed(3),
      x:finiteCoord(m.x)?+m.x.toFixed(4):undefined,
      y:finiteCoord(m.y)?+m.y.toFixed(4):undefined
    };
    noteXpAwardEvent(detail);
    return detail;
  }

  function onMobDeath(m){
    const spec = SPECIES[m.id]; if(!spec) return;
    // Natural death: no loot or XP, just silently despawn
    if(m._naturalDeath){ return; }
    // main.js state is reached via explicit window bridges (player/inv/lootInbox)
    const player = window.player;
    dropMeatForMob(m,spec);
    // XP gain
    awardMobXp(m,spec,player);
    // Loot: resource drops go straight into the block inventory — the loot inbox
    // is for gear items ({id,kind,...}) and renders {item,qty} entries as garbage
    if(spec.loot && Array.isArray(spec.loot)){
      const drops=[]; for(const entry of spec.loot){ if(Math.random() <= (entry.chance||1)){ const count = entry.min + ((entry.max && entry.max>entry.min)? (Math.random()*(entry.max-entry.min+1))|0 : 0); drops.push({item:entry.item, qty: count||entry.min||1}); } }
      if(drops.length && window.inv){
        const inv=window.inv; let gained=[];
        for(const d of drops){ if(typeof inv[d.item]==='number'){ inv[d.item]+=d.qty; gained.push(d.item+' ×'+d.qty); } }
        if(gained.length){
          if(window.updateInventoryHud) window.updateInventoryHud();
          if(window.msg) window.msg('Łup: '+gained.join(', '));
        }
      }
    }
    // Species-specific death ceremony (golden sprinter's chest, future rares)
    if(typeof spec.onDeath==='function'){ try{ spec.onDeath(m); }catch(e){} }
  }

  function chargeHeroFromElectricHit(dealt, srcX, srcY, cause){
    if(cause!=='eel_shock' || !(dealt>0)) return;
    const player=window.player;
    const he=MM && MM.heroEnergy;
    if(!player || !he || typeof he.info!=='function' || typeof he.chargeExternal!=='function') return;
    const maxHp=Math.max(1,Number(player.maxHp)||100);
    const info=he.info() || {};
    const maxEnergy=Math.max(1,Number(info.max)||0);
    const gain=maxEnergy*Math.max(0,Number(dealt)||0)/maxHp;
    if(gain>0) he.chargeExternal(gain,{cause:'eel_shock',source:{x:srcX,y:srcY},intensity:1.15});
  }

  function damagePlayer(amount, srcX, srcY, cause, spec){
    const player = window.player; if(typeof player!=='object' || !player) return;
    // hero damage is centralized in main.js (i-frames, knockback, audio, death);
    // the inline fallback exists only for the DOM-less Node sims
    if(typeof window.damageHero==='function'){
      const opts={srcX,srcY,cause:cause||'mob'};
      if(spec && finiteNum(spec.contactInvulMs)) opts.invulMs=spec.contactInvulMs;
      if(spec && finiteNum(spec.contactKnockback)) opts.kb=spec.contactKnockback;
      if(spec && finiteNum(spec.contactKnockbackY)) opts.kbY=spec.contactKnockbackY;
      const before=Number(player.hp)||0;
      const hit=window.damageHero(amount,opts);
      if(hit){
        const after=Number(player.hp)||0;
        chargeHeroFromElectricHit(Math.max(0,before-after),srcX,srcY,opts.cause);
      }
      return;
    }
    if(player.hpInvul && performance.now()<player.hpInvul) return;
    const before=Number(player.hp)||0;
    player.hp -= amount; player.hpInvul = performance.now()+600;
    chargeHeroFromElectricHit(Math.max(0,before-(Number(player.hp)||0)),srcX,srcY,cause||'mob');
    if(typeof srcX==='number' && typeof srcY==='number'){ const dx = (player.x - srcX); const dy=(player.y - srcY); const d = Math.hypot(dx,dy)||1; player.vx += (dx/d)*4; player.vy -= 2.5; }
    if(player.hp<=0){ player.hp=0; playerDead(); }
  }

  function playerDead(){ // death is centralized in main.js (gravestone drop + respawn)
    const player = window.player; if(!player) return;
    if(typeof window.heroDied==='function'){ window.heroDied('mob'); return; }
    const msg = window.msg || function(){}; msg('Zginąłeś – respawn'); player.hp = player.maxHp;
    if(window.placePlayer) window.placePlayer(true); }

  function serializeMob(m){
    if(!validMobState(m) || m.id==='ZLOTY') return null;
    const spec=SPECIES[m.id];
    if(!spec) return null;
    const out={
      id:m.id,
      x:+m.x.toFixed(4),
      y:+m.y.toFixed(4),
      vx:+clampFinite(m.vx,0,-80,80).toFixed(4),
      vy:+clampFinite(m.vy,0,-80,80).toFixed(4),
      hp:+Math.max(0,Math.min(m.maxHp||spec.hp||m.hp,m.hp)).toFixed(3),
      maxHp:+Math.max(1,m.maxHp||spec.hp||m.hp||1).toFixed(3),
      hostility:finiteNum(m.hostility) ? +m.hostility.toFixed(3) : 0,
      hostilitySide:(m.hostilitySide==='hot'||m.hostilitySide==='cold'||m.hostilitySide==='center') ? m.hostilitySide : 'center',
      hostilityTier:clampFinite(m.hostilityTier,0,0,4),
      state:typeof m.state==='string'?m.state:'idle',
      facing:m.facing<0?-1:1,
      spawnT:clampFinite(m.spawnT,performance.now(),0,Number.MAX_SAFE_INTEGER),
      attackCd:clampFinite(m.attackCd,0,0,60)
    };
    if(finiteNum(m.waterTopY)) out.waterTopY=m.waterTopY;
    if(finiteNum(m.desiredDepth)) out.desiredDepth=m.desiredDepth;
    if(finiteNum(m.scale)) out.scale=clampFinite(m.scale,1,0.35,3);
    if(finiteNum(m.speedMul)) out.speedMul=clampFinite(m.speedMul,1,0.1,4);
    if(finiteNum(m.jumpMul)) out.jumpMul=clampFinite(m.jumpMul,1,0.1,4);
    if(finiteNum(m.reactionMult)) out.reactionMult=clampFinite(m.reactionMult,1,0.2,3);
    if(finiteNum(m.attackCdMult)) out.attackCdMult=clampFinite(m.attackCdMult,1,0.2,2);
    if(finiteNum(m.projectileSpeedMult)) out.projectileSpeedMult=clampFinite(m.projectileSpeedMult,1,0.2,3);
    if(finiteNum(m.aimLead)) out.aimLead=clampFinite(m.aimLead,0,0,1.2);
    if(finiteNum(m.aimError)) out.aimError=clampFinite(m.aimError,0.1,0,1);
    if(typeof m.threatAccent==='string') out.threatAccent=m.threatAccent;
    if(typeof m.baseColor==='string') out.baseColor=m.baseColor;
    if(finiteNum(m.lifeEndAt)) out.lifeEndAt=m.lifeEndAt;
    if(finiteNum(m.decayStartAt)) out.decayStartAt=m.decayStartAt;
    if(isMobPacified(m,performance.now())) out.pacifiedMs=Math.max(0,Math.round(m._pacifiedUntil-performance.now()));
    if(finiteNum(m.homeX)) out.homeX=+m.homeX.toFixed(4);
    if(finiteNum(m.homeY)) out.homeY=+m.homeY.toFixed(4);
    if(isGoldGuardianId(m.id)){
      if(typeof m.goldGuardKey==='string') out.goldGuardKey=m.goldGuardKey.slice(0,32);
      if(finiteNum(m.guardGoldX)) out.guardGoldX=+m.guardGoldX.toFixed(4);
      if(finiteNum(m.guardGoldY)) out.guardGoldY=+m.guardGoldY.toFixed(4);
    }
    if(isHeroFocused(m)) out.heroFocusMs=Math.max(0,Math.round(m.heroFocusUntil-Date.now()));
    if(isTempleGuardAggro(m)) out.templeAggroMs=Math.max(0,Math.round(m.templeAggroUntil-Date.now()));
    if(finiteNum(m.templeAlarmX)) out.templeAlarmX=+m.templeAlarmX.toFixed(4);
    if(finiteNum(m.templeAlarmY)) out.templeAlarmY=+m.templeAlarmY.toFixed(4);
    if(m.templeAlarmKind==='treasure' || m.templeAlarmKind==='structure') out.templeAlarmKind=m.templeAlarmKind;
    if(m.id==='STRAZNIK'){
      if(finiteNum(m.sentinelReloadT)) out.sentinelReloadT=clampFinite(m.sentinelReloadT,0,0,SENTINEL_RELOAD_SECONDS);
      if(finiteNum(m.sentinelShotsUntilReload)) out.sentinelShotsUntilReload=clampFinite(m.sentinelShotsUntilReload,SENTINEL_BURST_MIN,0,SENTINEL_BURST_MAX);
    }
    if(m.id==='VULTURE' || m.id==='VULTURE_HATCHLING'){
      if(finiteNum(m.nestX)) out.nestX=+m.nestX.toFixed(4);
      if(finiteNum(m.nestY)) out.nestY=+m.nestY.toFixed(4);
      if(finiteNum(m.nestGroundY)) out.nestGroundY=+m.nestGroundY.toFixed(4);
      if(m.id==='VULTURE' && m.nestTree) out.nestTree=1;
      if(m.id==='VULTURE' && typeof m._vultureCapture==='boolean') out.vultureCapture=m._vultureCapture?1:0;
    }
    if(m.id==='SAND_WORM' && finiteNum(m._sandWormWakeRadius)){
      out.sandWormWakeRadius=+clampFinite(m._sandWormWakeRadius,3,SAND_WORM_WAKE_MIN_RADIUS,SAND_WORM_WAKE_MAX_RADIUS).toFixed(3);
    }
    if(isWeatherShamanId(m.id)){
      const nowP=performance.now();
      if(finiteNum(m._shamanRitualEndAt)) out.shamanRitualMs=Math.max(0,Math.round(m._shamanRitualEndAt-nowP));
      if(finiteNum(m._shamanFleeUntil) && m._shamanFleeUntil>nowP) out.shamanFleeMs=Math.max(0,Math.round(m._shamanFleeUntil-nowP));
      if(m._shamanWeatherActive && finiteNum(m._shamanWeatherUntil)) out.shamanWeatherMs=Math.max(0,Math.round(m._shamanWeatherUntil-nowP));
      if(typeof m._shamanWeatherOwner==='string') out.shamanWeatherOwner=m._shamanWeatherOwner.slice(0,64);
      if(m._shamanWeatherActive) out.shamanWeatherActive=1;
    }
    return out;
  }

  const AGGRO_SKEW_GRACE_MS = 30000; // accept up to 30s negative skew
  function serializeXpFatigue(){
    const out={};
    const day=currentGameDayFloat();
    for(const id in xpFatigue){
      const entry=cleanXpFatigueEntry(xpFatigue[id]);
      if(!entry) continue;
      if(day-entry.lastDay>=XP_FATIGUE_RESET_DAYS) continue;
      out[id]={kills:entry.kills,lastDay:+entry.lastDay.toFixed(4)};
    }
    return out;
  }
  function restoreXpFatigue(src){
    for(const id in xpFatigue) delete xpFatigue[id];
    if(!src || typeof src!=='object') return;
    const m=src.m && typeof src.m==='object' ? src.m : src;
    const day=currentGameDayFloat();
    for(const id in m){
      if(!SPECIES[id]) continue;
      const entry=cleanXpFatigueEntry(m[id]);
      if(!entry) continue;
      if(day-entry.lastDay>=XP_FATIGUE_RESET_DAYS) continue;
      xpFatigue[id]=entry;
    }
  }
  function serialize(){ const now=Date.now(); const rel={}; for(const k in speciesAggro){ const rem = speciesAggro[k]-now; if(rem>0) rel[k]=rem; }
    // the golden sprinter is a transient event creature: its _g state isn't saved,
    // so restoring it would produce a broken husk — the visit just ends instead
    return { v:5, list: mobs.map(serializeMob).filter(Boolean), aggro:{mode:'rel', m:rel}, golden:goldenSnapshot(), xpFatigue:{mode:'day',m:serializeXpFatigue()} }; }
  function deserialize(data){ // clear
    for(const m of mobs) removeFromGrid(m); mobs.length=0; // reset live counts before rebuild
    mobDeathFx.length=0;
    piranhaBaitZones.length=0;
    metrics.deathFx=0;
    for(const k in speciesCounts) delete speciesCounts[k];
    lastDayState = null;
    restoreXpFatigue(data && data.xpFatigue);
    goldenRestore(data && data.golden);
    if(data && Array.isArray(data.list)){
      for(const r of data.list){
        if(!r || !SPECIES[r.id] || !finiteCoord(r.x) || !finiteCoord(r.y)) continue;
        const spec=SPECIES[r.id];
        const m=create(spec, r.x, r.y);
        const restoredMax=m.maxHp || spec.hp || 999;
        m.vx=clampFinite(r.vx,0,-80,80);
        m.vy=clampFinite(r.vy,0,-80,80);
        if(finiteNum(r.hp)){
          const savedMax=finiteNum(r.maxHp) ? Math.max(1,r.maxHp) : Math.max(1,spec.hp||restoredMax);
          if(!finiteNum(r.maxHp) && r.hp >= (spec.hp||savedMax)-0.001) m.hp=restoredMax;
          else {
            const rawHp=finiteNum(r.maxHp) ? restoredMax * clampFinite(r.hp / savedMax, 1, 0, 1) : r.hp;
            m.hp=clampFinite(rawHp,restoredMax,0.1,restoredMax);
          }
        }
        m.state=typeof r.state==='string'?r.state:'idle';
        m.facing=r.facing<0?-1:1;
        initMobFacingStability(m,performance.now());
        m.spawnT=clampFinite(r.spawnT,performance.now(),0,Number.MAX_SAFE_INTEGER);
        m.attackCd=clampFinite(r.attackCd,0,0,60);
        if(finiteNum(r.scale)) m.scale=clampFinite(r.scale,1,0.35,3);
        if(finiteNum(r.speedMul)) m.speedMul=clampFinite(r.speedMul,1,0.1,4);
        if(finiteNum(r.jumpMul)) m.jumpMul=clampFinite(r.jumpMul,1,0.1,4);
        if(typeof r.baseColor==='string') m.baseColor=r.baseColor;
        if(finiteNum(r.hostility)) m.hostility=clampFinite(r.hostility,m.hostility||0,0,4);
        if(r.hostilitySide==='hot'||r.hostilitySide==='cold'||r.hostilitySide==='center') m.hostilitySide=r.hostilitySide;
        if(finiteNum(r.hostilityTier)){
          m.hostilityTier=clampFinite(r.hostilityTier,m.hostilityTier||0,0,4);
          if(finiteNum(r.reactionMult)) m.reactionMult=clampFinite(r.reactionMult,m.reactionMult||1,0.2,3);
          if(finiteNum(r.attackCdMult)) m.attackCdMult=clampFinite(r.attackCdMult,m.attackCdMult||1,0.2,2);
          if(finiteNum(r.projectileSpeedMult)) m.projectileSpeedMult=clampFinite(r.projectileSpeedMult,m.projectileSpeedMult||1,0.2,3);
          if(finiteNum(r.aimLead)) m.aimLead=clampFinite(r.aimLead,m.aimLead||0,0,1.2);
          if(finiteNum(r.aimError)) m.aimError=clampFinite(r.aimError,m.aimError||0.1,0,1);
          m.threatAccent=typeof r.threatAccent==='string' ? r.threatAccent : (hostilityAccentColor(m)||'');
        } else if(finiteNum(r.scale) || finiteNum(r.speedMul) || finiteNum(r.jumpMul) || typeof r.baseColor==='string'){
          applyMobProgressionTraits(m,spec,mobHostilityAt(m.x));
        }
        if(finiteNum(r.lifeEndAt)) m.lifeEndAt=r.lifeEndAt;
        if(finiteNum(r.decayStartAt)) m.decayStartAt=r.decayStartAt;
        if(finiteNum(r.pacifiedMs) && r.pacifiedMs>0) m._pacifiedUntil=performance.now()+Math.min(r.pacifiedMs,60000);
        if(finiteNum(r.homeX)) m.homeX=clampFinite(r.homeX,m.x,-10000000,10000000);
        if(finiteNum(r.homeY)) m.homeY=clampFinite(r.homeY,m.y,WORLD_TOP,WORLD_BOTTOM);
        if(isGoldGuardianId(r.id)){
          if(typeof r.goldGuardKey==='string' && r.goldGuardKey.length<=64) m.goldGuardKey=r.goldGuardKey;
          if(finiteNum(r.guardGoldX)) m.guardGoldX=clampFinite(r.guardGoldX,m.x,-10000000,10000000);
          if(finiteNum(r.guardGoldY)) m.guardGoldY=clampFinite(r.guardGoldY,m.y,WORLD_TOP,WORLD_BOTTOM);
          if(!m.goldGuardKey && finiteNum(m.guardGoldX) && finiteNum(m.guardGoldY)) m.goldGuardKey=goldGuardKeyFor(m.guardGoldX,m.guardGoldY);
        }
        if(finiteNum(r.heroFocusMs) && r.heroFocusMs>0) m.heroFocusUntil=Date.now()+Math.min(r.heroFocusMs,HERO_FOCUS_MS);
        if(finiteNum(r.templeAggroMs) && r.templeAggroMs>0) m.templeAggroUntil=Date.now()+Math.min(r.templeAggroMs,TEMPLE_GUARD_VIOLATION_AGGRO_MS);
        if(finiteNum(r.templeAlarmX)) m.templeAlarmX=clampFinite(r.templeAlarmX,m.x,-10000000,10000000);
        if(finiteNum(r.templeAlarmY)) m.templeAlarmY=clampFinite(r.templeAlarmY,m.y,WORLD_TOP,WORLD_BOTTOM);
        if(r.templeAlarmKind==='treasure' || r.templeAlarmKind==='structure') m.templeAlarmKind=r.templeAlarmKind;
        if(r.id==='STRAZNIK'){
          if(finiteNum(r.sentinelReloadT)) m.sentinelReloadT=clampFinite(r.sentinelReloadT,0,0,SENTINEL_RELOAD_SECONDS);
          if(finiteNum(r.sentinelShotsUntilReload)) m.sentinelShotsUntilReload=clampFinite(r.sentinelShotsUntilReload,SENTINEL_BURST_MIN,0,SENTINEL_BURST_MAX);
        }
        if(r.id==='VULTURE' || r.id==='VULTURE_HATCHLING'){
          if(finiteNum(r.nestX)) m.nestX=clampFinite(r.nestX,m.x,-10000000,10000000);
          if(finiteNum(r.nestY)) m.nestY=clampFinite(r.nestY,m.y,WORLD_TOP,WORLD_BOTTOM);
          if(finiteNum(r.nestGroundY)) m.nestGroundY=clampFinite(r.nestGroundY,m.y,WORLD_TOP,WORLD_BOTTOM);
          if(r.id==='VULTURE') m.nestTree=!!r.nestTree;
          if(finiteNum(m.nestX) && finiteNum(m.nestY)){
            m.homeX=finiteNum(m.homeX)?m.homeX:m.nestX+0.5;
            m.homeY=finiteNum(m.homeY)?m.homeY:m.nestY-1.2;
          }
          if(r.id==='VULTURE' && (r.vultureCapture===0 || r.vultureCapture===1 || typeof r.vultureCapture==='boolean')) m._vultureCapture=!!r.vultureCapture;
        }
        if(r.id==='SAND_WORM' && finiteNum(r.sandWormWakeRadius)){
          m._sandWormWakeRadius=clampFinite(r.sandWormWakeRadius,3,SAND_WORM_WAKE_MIN_RADIUS,SAND_WORM_WAKE_MAX_RADIUS);
        }
        if(isWeatherShamanId(r.id)){
          const nowP=performance.now();
          if(finiteNum(r.shamanRitualMs)) m._shamanRitualEndAt=nowP+clampFinite(r.shamanRitualMs,0,0,120000);
          if(finiteNum(r.shamanFleeMs) && r.shamanFleeMs>0) m._shamanFleeUntil=nowP+clampFinite(r.shamanFleeMs,0,0,60000);
          if(finiteNum(r.shamanWeatherMs) && r.shamanWeatherMs>0){
            m._shamanWeatherActive=!!r.shamanWeatherActive;
            m._shamanWeatherUntil=nowP+clampFinite(r.shamanWeatherMs,0,0,90000);
          }
          if(typeof r.shamanWeatherOwner==='string') m._shamanWeatherOwner=r.shamanWeatherOwner.slice(0,64);
          if(!finiteNum(m._shamanRitualEndAt)) scheduleWeatherShamanRitual(m,nowP,800);
        }
        if(spec.aquatic){ if(finiteNum(r.waterTopY)) m.waterTopY=r.waterTopY; if(finiteNum(r.desiredDepth)) m.desiredDepth=r.desiredDepth; m.nextWaterScan = performance.now() + 3000; m.strandedTime=0; }
        mobs.push(m);
      }
    }
    for(const k in speciesAggro) delete speciesAggro[k];
    if(data && data.aggro){ const now=Date.now(); if(data.aggro.mode==='rel' && data.aggro.m){ for(const k in data.aggro.m){ const rem=data.aggro.m[k]; if(typeof rem==='number' && rem>0){ speciesAggro[k]= now + Math.min(rem, 5*60*1000); } }
      } else { // legacy absolute timestamps
        for(const k in data.aggro){ const exp=data.aggro[k]; if(typeof exp==='number'){ if(exp>now) speciesAggro[k]=exp; else if(now-exp < AGGRO_SKEW_GRACE_MS){ speciesAggro[k]= now + 5000; } }
        }
      }
    }
  }

  // External helpers to control spawns and clearing
  function freezeSpawns(ms){ const base = performance.now(); const n=finiteNum(ms)?Math.max(0,ms):0; spawnFreezeUntil = Math.max(spawnFreezeUntil, base + n); }
  function clearAll(){
    try{
      // Remove all live mobs and detach from spatial grid
      for(const m of mobs){ if(isWeatherShamanId(m.id)) stopWeatherShamanEffect(m); removeFromGrid(m); }
      mobs.length = 0;
      // Reset species counts
      for(const k in speciesCounts){ delete speciesCounts[k]; }
      // Clear spatial partition completely
      grid.clear();
      mobProjectiles.length = 0;
      mobLasers.length = 0;
      mobDeathFx.length = 0;
      piranhaBaitZones.length = 0;
      sentinelVolleyStart = 0;
      sentinelVolleyShots = 0;
      sentinelShotsThisFrame = 0;
      sentinelDeferredThisFrame = 0;
      sentinelMeatShots = 0;
      sentinelMeatCooked = 0;
      sentinelMeatDestroyed = 0;
      sentinelReloads = 0;
      metrics.count = 0;
      metrics.active = 0;
      metrics.projectiles = 0;
      metrics.lasers = 0;
      metrics.deathFx = 0;
      metrics.sentinelShots = 0;
      metrics.sentinelDeferred = 0;
      metrics.sentinelMeatShots = 0;
      metrics.sentinelMeatCooked = 0;
      metrics.sentinelMeatDestroyed = 0;
      metrics.sentinelReloads = 0;
      metrics.goldGuardians = 0;
      metrics.sunriseBurns = 0;
      lastDayState = null;
      // Reset global aggro
      for(const k in speciesAggro){ delete speciesAggro[k]; }
      for(const k in xpFatigue){ delete xpFatigue[k]; }
      goldenReset();
      // Push out next spawn check and freeze spawns for a short time
      nextSpawnCheck = performance.now() + 2000;
      nextPiranhaAmbush = performance.now() + 2000;
      nextGoldGuardianScan = performance.now() + 2000;
      spawnFreezeUntil = performance.now() + 4000;
    }catch(e){
      // Fallback to deserialize empty if anything goes wrong
      try{ deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); }catch(_e){}
    }
  }

    function diagnose(getTile){
      const report={total:mobs.length, species:{}, groundHoverIssues:[], overlaps:0};
      for(const m of mobs){ report.species[m.id]=(report.species[m.id]||0)+1; const spec=SPECIES[m.id]; if(spec && spec.ground && spec.body){
          const halfH=(spec.body.h||1)*0.5; const tileBelow = getTile? getTile(Math.floor(m.x), Math.floor(m.y+halfH)) : null;
          if(tileBelow===T.AIR){ report.groundHoverIssues.push({id:m.id,x:m.x,y:m.y}); }
        }
      }
      // naive overlap detect (same tile center proximity)
      for(let i=0;i<mobs.length;i++){
        for(let j=i+1;j<mobs.length;j++){
          const a=mobs[i], b=mobs[j]; const dx=a.x-b.x, dy=a.y-b.y; if(dx*dx+dy*dy < 0.16) report.overlaps++; }
      }
      report.metrics={...metrics};
      return report;
    }
    function debugDeathFx(getTile){
      return mobDeathFx.map(f=>{
        const pieces=[...(f.core||[]),...(f.fragments||[]),...(f.residue||[]),...(f.puffs||[])].filter(p=>p && (!Number.isFinite(p.life) || !Number.isFinite(p.max) || p.life<=p.max));
        const physics=[...(f.core||[]),...(f.fragments||[])].filter(p=>p && p.physics);
        let solidPieces=0, maxDist=0, badFinite=0, bounces=0, travel=0, settledPieces=0, movingPieces=0;
        for(const p of pieces){
          if(!Number.isFinite(p.x) || !Number.isFinite(p.y)){ badFinite++; continue; }
          const d=Math.hypot(p.x-f.x,p.y-f.y);
          if(d>maxDist) maxDist=d;
          const softPuff = p.kind==='dust' || p.kind==='spark' || p.kind==='spray';
          if(getTile && (softPuff ? !deathFxTileOpen(getTile,p.x,p.y) : deathPieceOverlapsSolid(getTile,p.x,p.y,deathPieceRadius(p)))) solidPieces++;
          if(Number.isFinite(p.bounces)) bounces+=p.bounces;
          if(Number.isFinite(p.travel)) travel+=p.travel;
          if(p.settled) settledPieces++;
          if(Math.hypot(p.vx||0,p.vy||0)>0.12) movingPieces++;
        }
        return {
          id:f.id,
          style:f.style,
          cause:f.cause,
          signature:f.signature,
          life:+f.life.toFixed(3),
          x:+f.x.toFixed(3),
          y:+f.y.toFixed(3),
          sourceX:+(f.sourceX==null?f.x:f.sourceX).toFixed(3),
          sourceY:+(f.sourceY==null?f.y:f.sourceY).toFixed(3),
          tunnelClamped:!!f.tunnelClamped,
          core:(f.core||[]).length,
          fragments:f.fragments.length,
          rings:f.rings.length,
          residue:(f.residue||[]).length,
          puffs:(f.puffs||[]).length,
          livePieces:pieces.length,
          physicsPieces:physics.length,
          movingPieces,
          settledPieces,
          bounces,
          travel:+travel.toFixed(3),
          solidPieces,
          badFinite,
          maxDist:+maxDist.toFixed(3),
          seed:f.seed
        };
      });
    }
    function debugCombat(){
      return {
        projectiles:mobProjectiles.map(p=>({x:p.x,y:p.y,vx:p.vx,vy:p.vy,dmg:p.dmg,lead:p.lead||0,type:p.type||'bone',cause:p.cause||'mob_projectile',ownerId:p.ownerId||'',aimX:p.aimX,aimY:p.aimY})),
        lasers:mobLasers.map(l=>({x1:l.x1,y1:l.y1,x2:l.x2,y2:l.y2,dmg:l.dmg||0,hit:!!l.hit}))
      };
    }
  const api = { update, draw, attackAt, damageAt, collideBoat, collideMech, igniteAt, igniteRadius, poisonAt, poisonRadius, douseRadius, shockAquaticRadius, blastRadius, healRadiationRain, applyStatus, hasStatus, STATUS, serialize, deserialize, setAggro, speciesAggro, isHostile:isMobHostile, notifyTempleDisturbed, forceSpawn, spawnSeasonalHallmark, spawnGolden, nearestLiving, nearestHostileLiving, abduct, goldenState:()=>({acc:GOLDEN.acc, visits:GOLDEN.visits, period:GOLDEN.PERIOD_DAYS*GOLDEN.DAY_SEC}), species: Object.keys(SPECIES), registerSpecies, metrics:()=>metrics, diagnose, freezeSpawns, clearAll, _debugSpecies:()=>SPECIES, _debugEcology:()=>({hallmarks:Object.assign({},SEASON_HALLMARK_SPECIES), factor:seasonalSpeciesFactor}), _debugDeathFx:debugDeathFx, _debugCombat:debugCombat };
  MM.mobs = api;
  try{ window.dispatchEvent(new CustomEvent('mm-mobs-ready')); }catch(e){}
  return api;
})(); // end IIFE

export { mobs };
export default mobs;
// (File end)

