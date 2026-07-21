import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, isLeaf } from '../constants.js';
import { buildMaterialProfile, isDoorTile, isGasTile, isHeroPassableTile } from './material_physics.js';
import { damageBlastCreatures } from './explosion_damage.js';

const companions = (function(){
  const root = (typeof window!=='undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const list = [];
  const lasers = [];
  const deathFx = [];
  const command = {mode:'attack', awaiting:false, harvestTile:null, harvestLabel:'', fightBadgeT:0, harvestBadgeT:0, transportBadgeT:0};
  const COMMAND_BADGE_ICONS = Object.freeze({swords:'⚔️', pickaxe:'⛏️', transport:'↔'});

  const MAX_COMPANIONS = 3;
  const KIND_BIO = 'bio';
  const KIND_CLAY_GOLEM = 'clay_golem';
  const KIND_LEAF_MONSTER = 'leaf_monster';
  const KIND_WATER_GOLEM = 'water_golem';
  const KIND_MEAT_GOLEM = 'meat_golem';
  const KIND_ROTTEN_MEAT_GOLEM = 'rotten_meat_golem';
  const KIND_FRIED_MEAT_GOLEM = 'fried_meat_golem';
  const KIND_FRIED_CHICKEN = 'fried_chicken';
  const KIND_UFO_ALIEN = 'ufo_alien';
  const KIND_MOLEKIN = 'molekin';
  const UFO_ALIEN_MIN_CONCRETE = 1;
  const UFO_ALIEN_MAX_CONCRETE = 18;
  const UFO_ALIEN_BASE_HP = 620;
  const UFO_ALIEN_HP_PER_CONCRETE = 140;
  const UFO_ALIEN_ROLES = Object.freeze(['rusher','tank','healer','flanker','orbiter','sniper','sapper','engineer','commander']);
  const MOLEKIN_MIN_LAVA = 1;
  const MOLEKIN_MAX_LAVA = 20;
  const MOLEKIN_BASE_HP = 560;
  const MOLEKIN_HP_PER_LAVA = 120;
  const MOLEKIN_BREAK_STUCK_SECONDS = 0.32;
  const MOLEKIN_ROLES = Object.freeze(['rusher','tank','healer','flanker','orbiter','sniper','sapper','engineer']);
  const CLAY_GOLEM_MIN_CLAY = 6;
  const CLAY_GOLEM_MAX_CLAY = 18;
  const CLAY_GOLEM_BASE_HP = 160;
  const CLAY_GOLEM_HP_PER_CLAY = 20;
  const CLAY_GOLEM_GUARD_RADIUS = 5.5;
  const CLAY_GOLEM_BREAK_STUCK_SECONDS = 0.62;
  const GOLEM_WALK_JUMP_STUCK_SECONDS = 0.44;
  const GOLEM_WALK_JUMP_COOLDOWN = 0.90;
  const LEAF_MONSTER_MIN_LEAVES = 5;
  const LEAF_MONSTER_MAX_LEAVES = 16;
  const LEAF_MONSTER_BASE_HP = 14;
  const LEAF_MONSTER_HP_PER_LEAF = 2;
  const LEAF_MONSTER_WIND_DRIFT = 9.2;
  const LEAF_MONSTER_FEED_LOW_RATIO = 0.55;
  const LEAF_MONSTER_FEED_STOP_RATIO = 0.86;
  const LEAF_MONSTER_FEED_HEAL_RATIO = 0.05;
  const LEAF_MONSTER_FEED_SECONDS = 0.42;
  const LEAF_MONSTER_FEED_SCAN_RADIUS = 7;
  const LEAF_MONSTER_TRANSPORT_DRAIN_RATIO = 0.10;
  const WATER_GOLEM_MIN_WATER = 6;
  const WATER_GOLEM_MAX_WATER = 20;
  const WATER_GOLEM_BASE_HP = 84;
  const WATER_GOLEM_HP_PER_WATER = 13;
  const WATER_GOLEM_DRY_BASE_DPS = 8.5;
  const WATER_GOLEM_DRINK_SECONDS = 0.55;
  const WATER_GOLEM_CONTACT_OFFSETS = Object.freeze([
    [1,0],[-1,0],[0,1],[0,-1],
    [1,-1],[-1,-1],[1,1],[-1,1]
  ]);
  const MEAT_GOLEM_MIN_MEAT = 6;
  const MEAT_GOLEM_MAX_MEAT = 18;
  const MEAT_GOLEM_BASE_HP = 82;
  const MEAT_GOLEM_HP_PER_MEAT = 15;
  const MEAT_GOLEM_ROT_SECONDS = 300;
  const MEAT_GOLEM_ZOMBIE_DAMAGE = 11;
  const MEAT_GOLEM_ZOMBIE_ATTACK_SECONDS = 0.72;
  const FRIED_MEAT_GOLEM_HEAL_RATIO = 0.20;
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  const BASE_HP = 34;
  const HP_PER_BIOMASS = 18;
  const MAX_BIOMASS = 30;
  const BODY_W = 0.72;
  const BODY_H = 1.05;
  const GRAVITY = 24;
  const MAX_FALL = 18;
  const FOLLOW_SPEED = 5.8;
  const FOLLOW_ACCEL = 18;
  const LASER_RANGE = 11.5;
  const LASER_COOLDOWN = 0.68;
  const POISON_INTERVAL = 3.1;
  const TELEPORT_DIST = 31;
  const HARVEST_SCAN_RADIUS = 18;
  const HARVEST_REACH = 1.45;
  const HARVEST_SPEED_SCALE = 0.10;
  const COMPANION_PATH_REPLAN_SECONDS = 0.34;
  const COMPANION_PATH_RADIUS_X = 11;
  const COMPANION_PATH_RADIUS_Y = 7;
  const COMPANION_PATH_GOAL_SCAN = 4;
  const COMPANION_PATH_MAX_NODES = 96;
  let ritualBusy = false;
  let ritualScanCd = 0;
  let ritualLastCapacitySay = 0;
  const ARCHETYPE_TRAITS = Object.freeze({
    guardian:{label:'wartownik', follow:1.15, spacing:0.48, speed:0.88, accel:0.95, jump:0.95, range:0.88, cooldown:1.12, damage:1.10, poisonInterval:1.22, poisonPower:0.82, death:1.20, orbit:0.02},
    sniper:{label:'strzelec', follow:2.15, spacing:0.70, speed:0.76, accel:0.78, jump:0.92, range:1.38, cooldown:1.34, damage:1.34, poisonInterval:1.45, poisonPower:0.58, death:0.88, orbit:0.00},
    skirmisher:{label:'harcownik', follow:1.62, spacing:0.58, speed:1.28, accel:1.24, jump:1.16, range:0.94, cooldown:0.72, damage:0.84, poisonInterval:1.05, poisonPower:0.78, death:0.92, orbit:0.08},
    toxic:{label:'dymnik', follow:1.42, spacing:0.54, speed:0.92, accel:0.95, jump:1.02, range:0.82, cooldown:1.08, damage:0.72, poisonInterval:0.58, poisonPower:1.58, death:1.42, orbit:0.05},
    volatile:{label:'iskrownik', follow:1.82, spacing:0.66, speed:1.02, accel:1.05, jump:1.04, range:1.05, cooldown:0.96, damage:1.18, poisonInterval:0.95, poisonPower:1.08, death:1.72, orbit:0.10},
    sentinel:{label:'satelita', follow:2.55, spacing:0.78, speed:0.70, accel:0.72, jump:0.88, range:1.18, cooldown:0.86, damage:0.98, poisonInterval:1.10, poisonPower:0.92, death:1.05, orbit:0.22}
  });
  const ARCHETYPE_IDS = Object.keys(ARCHETYPE_TRAITS);
  const UFO_ALIEN_ROLE_TRAITS = Object.freeze({
    rusher:{label:'macierzysty rusher', hp:1.06, speed:1.24, accel:1.16, jump:1.12, range:0.98, cooldown:0.70, damage:1.08, orbit:0.06, poison:0.86},
    tank:{label:'lodowy tank', hp:1.38, speed:0.76, accel:0.80, jump:0.90, range:0.92, cooldown:0.96, damage:1.25, orbit:0.00, poison:0.48, guard:0.72},
    healer:{label:'macierzysty medyk', hp:1.02, speed:1.04, accel:1.04, jump:1.06, range:1.10, cooldown:0.88, damage:0.86, orbit:0.08, poison:0.32},
    flanker:{label:'lodowy flanker', hp:1.04, speed:1.34, accel:1.28, jump:1.16, range:0.96, cooldown:0.64, damage:1.02, orbit:0.12, poison:0.78},
    orbiter:{label:'macierzysty orbiter', hp:1.02, speed:1.16, accel:1.20, jump:1.24, range:1.14, cooldown:0.74, damage:1.00, orbit:0.34, poison:0.62},
    sniper:{label:'lodowy snajper', hp:0.98, speed:0.84, accel:0.88, jump:1.00, range:1.66, cooldown:1.08, damage:1.56, orbit:0.00, poison:0.30},
    sapper:{label:'macierzysty saper', hp:1.10, speed:0.98, accel:1.00, jump:0.98, range:0.94, cooldown:0.78, damage:1.18, orbit:0.05, poison:1.02},
    engineer:{label:'macierzysty inzynier', hp:1.08, speed:0.96, accel:0.98, jump:0.98, range:1.20, cooldown:0.82, damage:1.10, orbit:0.07, poison:0.54},
    commander:{label:'zloty macierzysty commander', hp:1.70, speed:0.90, accel:0.92, jump:1.00, range:1.34, cooldown:0.76, damage:1.52, orbit:0.12, poison:0.74, guard:0.82}
  });
  const MOLEKIN_ROLE_TRAITS = Object.freeze({
    rusher:{label:'macierzysto-lawowy rusher', hp:1.08, speed:1.22, accel:1.18, jump:1.00, range:0.96, cooldown:0.68, damage:1.12, orbit:0.03, harvest:1.55},
    tank:{label:'macierzysto-bazaltowy tank', hp:1.42, speed:0.78, accel:0.86, jump:0.84, range:0.90, cooldown:0.92, damage:1.22, orbit:0, guard:0.78, harvest:1.50},
    healer:{label:'macierzysty zarowy medyk', hp:1.02, speed:1.02, accel:1.04, jump:0.90, range:1.14, cooldown:0.84, damage:0.82, orbit:0.06, heal:1.62, harvest:1.42},
    flanker:{label:'macierzysty tunelowy flanker', hp:1.04, speed:1.32, accel:1.28, jump:1.04, range:0.94, cooldown:0.62, damage:1.02, orbit:0.10, harvest:1.70},
    orbiter:{label:'macierzysty dymny orbiter', hp:1.04, speed:1.14, accel:1.14, jump:0.98, range:1.18, cooldown:0.76, damage:0.98, orbit:0.28, harvest:1.52},
    sniper:{label:'macierzysty plomienny snajper', hp:0.98, speed:0.88, accel:0.90, jump:0.84, range:1.62, cooldown:1.02, damage:1.58, orbit:0, harvest:1.38},
    sapper:{label:'macierzysto-lawowy saper', hp:1.16, speed:1.00, accel:1.00, jump:0.88, range:0.98, cooldown:0.72, damage:1.18, orbit:0.03, harvest:2.65},
    engineer:{label:'macierzysty podziemny inzynier', hp:1.10, speed:0.96, accel:0.98, jump:0.88, range:1.22, cooldown:0.80, damage:1.04, orbit:0.06, harvest:2.38}
  });

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function inCompanionWorldY(y,topPad=0,bottomPad=0){
    return Number.isFinite(Number(y)) && Number(y)>=WORLD_TOP+topPad && Number(y)<WORLD_BOTTOM-bottomPad;
  }
  function clampCompanionWorldY(y,topPad=0,bottomPad=0){
    const lo=WORLD_TOP+topPad;
    const hi=Math.max(lo,WORLD_BOTTOM-bottomPad);
    const n=Number(y);
    return clamp(Number.isFinite(n) ? n : lo,lo,hi);
  }
  function finiteNumber(v,fallback){
    const n=Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function say(text){ try{ if(root.msg) root.msg(text); }catch(e){} }
  const sayMemory = {};
  function sayVariant(key,lines,vars){
    const pool = Array.isArray(lines) ? lines.map(t=>String(t || '').trim()).filter(Boolean) : [];
    if(!pool.length) return;
    const last = sayMemory[key] || '';
    const choices = pool.length > 1 ? pool.filter(t=>t !== last) : pool;
    let text = choices[Math.floor(Math.random() * choices.length)] || choices[0] || pool[0];
    vars = vars || {};
    text = text.replace(/\{([a-zA-Z0-9_]+)\}/g,(_,name)=>String(vars[name] == null ? '' : vars[name]));
    sayMemory[key] = text;
    say(text);
  }
  function sfx(name,source){
    try{
      if(MM.audio && MM.audio.play){
        const opts=source && Number.isFinite(Number(source.x)) && Number.isFinite(Number(source.y))
          ? {x:Number(source.x),y:Number(source.y)}
          : source;
        MM.audio.play(name,opts);
      }
    }catch(e){}
  }
  function burst(x,y,tier){
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(x*(MM.TILE||20), y*(MM.TILE||20), tier||'rare'); }catch(e){}
  }
  function sparks(x,y,tier,count){
    try{
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(x*(MM.TILE||20), y*(MM.TILE||20), tier||'rare', count||10);
      else burst(x,y,tier||'rare');
    }catch(e){}
  }
  function invAdd(cost){
    const inv=root.inv;
    if(!inv || !cost) return;
    for(const k in cost){ if(typeof inv[k]==='number') inv[k]+=cost[k]||0; }
  }
  function prng(seed){
    let s=(seed>>>0) || 0x9e3779b9;
    return function(){
      s = (s + 0x6D2B79F5) >>> 0;
      let t=s;
      t=Math.imul(t ^ (t>>>15), t | 1);
      t ^= t + Math.imul(t ^ (t>>>7), t | 61);
      return ((t ^ (t>>>14)) >>> 0) / 4294967296;
    };
  }
  function randInt(r,n){ return Math.floor(r()*n); }
  function pick(r,list){ return list[randInt(r,list.length)]; }
  function validChoice(v,list,fallback){
    return list.includes(v) ? v : fallback;
  }
  function mixColor(a,b,t){
    const ca=parseInt(String(a).slice(1),16), cb=parseInt(String(b).slice(1),16);
    const ar=(ca>>16)&255, ag=(ca>>8)&255, ab=ca&255;
    const br=(cb>>16)&255, bg=(cb>>8)&255, bb=cb&255;
    const rr=(ar+(br-ar)*t)|0, rg=(ag+(bg-ag)*t)|0, rb=(ab+(bb-ab)*t)|0;
    return '#'+rr.toString(16).padStart(2,'0')+rg.toString(16).padStart(2,'0')+rb.toString(16).padStart(2,'0');
  }
  function hashSeed(x,y,biomass){
    const n=(Math.floor((x||0)*73856093) ^ Math.floor((y||0)*19349663) ^ Math.floor(nowMs()*1000) ^ ((biomass||1)*83492791) ^ ((Math.random()*0xffffffff)>>>0)) >>> 0;
    return n || 1;
  }
  function maxHpForBiomass(biomass){
    return BASE_HP + Math.max(0, Math.floor(biomass||0))*HP_PER_BIOMASS;
  }
  function isClayGolem(c){ return !!c && c.kind===KIND_CLAY_GOLEM; }
  function isLeafMonster(c){ return !!c && c.kind===KIND_LEAF_MONSTER; }
  function isWaterGolem(c){ return !!c && c.kind===KIND_WATER_GOLEM; }
  function isRawMeatGolem(c){ return !!c && c.kind===KIND_MEAT_GOLEM; }
  function isRottenMeatGolem(c){ return !!c && c.kind===KIND_ROTTEN_MEAT_GOLEM; }
  function isFriedMeatGolem(c){ return !!c && (c.kind===KIND_FRIED_MEAT_GOLEM || c.kind===KIND_FRIED_CHICKEN); }
  function isMeatGolem(c){ return isRawMeatGolem(c) || isRottenMeatGolem(c); }
  function isFriendlyMeatGolem(c){ return isRawMeatGolem(c) || isFriedMeatGolem(c); }
  function isAnyMeatGolem(c){ return isMeatGolem(c) || isFriedMeatGolem(c); }
  function isUfoAlien(c){ return !!c && c.kind===KIND_UFO_ALIEN; }
  function isMolekin(c){ return !!c && c.kind===KIND_MOLEKIN; }
  function isWalkingGolem(c){ return isClayGolem(c) || isWaterGolem(c) || isMeatGolem(c) || isFriedMeatGolem(c) || isMolekin(c); }
  function isFriedChicken(c){ return isFriedMeatGolem(c); }
  function clayMass(c){ return clamp(Math.floor((c && (c.clay || c.clayMass || c.biomass)) || CLAY_GOLEM_MIN_CLAY),CLAY_GOLEM_MIN_CLAY,CLAY_GOLEM_MAX_CLAY); }
  function leafMass(c){ return clamp(Math.floor((c && (c.leaves || c.leafMass || c.biomass)) || LEAF_MONSTER_MIN_LEAVES),LEAF_MONSTER_MIN_LEAVES,LEAF_MONSTER_MAX_LEAVES); }
  function waterMass(c){ return clamp(Math.floor((c && (c.water || c.waterMass || c.biomass)) || WATER_GOLEM_MIN_WATER),WATER_GOLEM_MIN_WATER,WATER_GOLEM_MAX_WATER); }
  function meatMass(c){ return clamp(Math.floor((c && (c.meat || c.meatMass || c.biomass)) || MEAT_GOLEM_MIN_MEAT),MEAT_GOLEM_MIN_MEAT,MEAT_GOLEM_MAX_MEAT); }
  function ufoConcreteMass(c){ return clamp(Math.floor((c && (c.motherIce || c.motherIceMass || c.iceCore || c.ufoConcrete || c.concrete || c.concreteMass || c.biomass)) || UFO_ALIEN_MIN_CONCRETE),UFO_ALIEN_MIN_CONCRETE,UFO_ALIEN_MAX_CONCRETE); }
  function lavaMass(c){ return clamp(Math.floor((c && (c.lava || c.lavaMass || c.biomass)) || MOLEKIN_MIN_LAVA),MOLEKIN_MIN_LAVA,MOLEKIN_MAX_LAVA); }
  function ufoAlienRole(c){
    const g = c && c.genome;
    const role = (c && c.ufoRole) || (g && g.alienRole) || 'rusher';
    return validChoice(String(role),UFO_ALIEN_ROLES,'rusher');
  }
  function molekinRole(c){
    const g = c && c.genome;
    const role = (c && c.moleRole) || (g && g.moleRole) || 'rusher';
    return validChoice(String(role),MOLEKIN_ROLES,'rusher');
  }
  function maxHpForClay(clay){
    return CLAY_GOLEM_BASE_HP + clayMass({clay})*CLAY_GOLEM_HP_PER_CLAY;
  }
  function maxHpForLeaves(leaves){
    return LEAF_MONSTER_BASE_HP + leafMass({leaves})*LEAF_MONSTER_HP_PER_LEAF;
  }
  function maxHpForWater(water){
    return WATER_GOLEM_BASE_HP + waterMass({water})*WATER_GOLEM_HP_PER_WATER;
  }
  function maxHpForMeat(meat){
    return MEAT_GOLEM_BASE_HP + meatMass({meat})*MEAT_GOLEM_HP_PER_MEAT;
  }
  function maxHpForUfoAlien(concrete,role){
    const mass = ufoConcreteMass({ufoConcrete:concrete});
    const stats = UFO_ALIEN_ROLE_TRAITS[validChoice(String(role||'rusher'),UFO_ALIEN_ROLES,'rusher')] || UFO_ALIEN_ROLE_TRAITS.rusher;
    return Math.round((UFO_ALIEN_BASE_HP + mass*UFO_ALIEN_HP_PER_CONCRETE) * (stats.hp || 1));
  }
  function maxHpForMolekin(lava,role){
    const mass = lavaMass({lava});
    const stats = MOLEKIN_ROLE_TRAITS[validChoice(String(role||'rusher'),MOLEKIN_ROLES,'rusher')] || MOLEKIN_ROLE_TRAITS.rusher;
    return Math.round((MOLEKIN_BASE_HP + mass*MOLEKIN_HP_PER_LAVA) * (stats.hp || 1));
  }
  function expectedMaxHp(c){
    if(isMolekin(c)) return maxHpForMolekin(lavaMass(c),molekinRole(c));
    if(isUfoAlien(c)) return maxHpForUfoAlien(ufoConcreteMass(c),ufoAlienRole(c));
    if(isFriedMeatGolem(c)) return maxHpForMeat(meatMass(c));
    if(isMeatGolem(c)) return maxHpForMeat(meatMass(c));
    if(isWaterGolem(c)) return maxHpForWater(waterMass(c));
    if(isLeafMonster(c)) return maxHpForLeaves(leafMass(c));
    if(isClayGolem(c)) return maxHpForClay(clayMass(c));
    return maxHpForBiomass(c && c.biomass);
  }
  function normalizeCompanionGenome(c){
    if(!c || (c.genome && typeof c.genome==='object')) return;
    const seed=(c.seed>>>0) || hashSeed(c.x,c.y,c.biomass||1);
    if(isClayGolem(c)) c.genome=makeClayGenome(seed,clayMass(c));
    else if(isLeafMonster(c)) c.genome=makeLeafGenome(seed,leafMass(c));
    else if(isWaterGolem(c)) c.genome=makeWaterGenome(seed,waterMass(c));
    else if(isAnyMeatGolem(c)) c.genome=makeMeatGenome(seed,meatMass(c));
    else if(isUfoAlien(c)) c.genome=makeUfoAlienGenome(seed,ufoConcreteMass(c),ufoAlienRole(c));
    else if(isMolekin(c)) c.genome=makeMolekinGenome(seed,lavaMass(c),molekinRole(c));
    else c.genome=makeGenome(seed);
  }
  function sanitizeCompanion(c){
    if(!c || typeof c!=='object') return false;
    c.x=finiteNumber(c.x,0);
    c.y=clampCompanionWorldY(finiteNumber(c.y,WORLD_BOTTOM-1),1,0.15);
    c.vx=clamp(finiteNumber(c.vx,0),-40,40);
    c.vy=clamp(finiteNumber(c.vy,0),-40,40);
    c.seed=(finiteNumber(c.seed,hashSeed(c.x,c.y,c.biomass||1))>>>0) || 1;
    if(isClayGolem(c)){ c.clay=clayMass(c); c.biomass=c.clay; }
    else if(isLeafMonster(c)){ c.leaves=leafMass(c); c.biomass=c.leaves; }
    else if(isWaterGolem(c)){ c.water=waterMass(c); c.biomass=c.water; }
    else if(isAnyMeatGolem(c)){ c.meat=meatMass(c); c.biomass=c.meat; }
    else if(isUfoAlien(c)){ c.motherIce=ufoConcreteMass(c); c.ufoConcrete=c.motherIce; c.ufoRole=ufoAlienRole(c); c.biomass=c.motherIce; }
    else if(isMolekin(c)){ c.lava=lavaMass(c); c.moleRole=molekinRole(c); c.biomass=c.lava; }
    else c.biomass=clamp(Math.floor(finiteNumber(c.biomass,3)),1,MAX_BIOMASS);
    c.maxHp=Math.max(1, finiteNumber(c.maxHp, expectedMaxHp(c)));
    c.hp=clamp(finiteNumber(c.hp,c.maxHp),0,c.maxHp);
    c.facing=c.facing<0 ? -1 : 1;
    c.age=Math.max(0,finiteNumber(c.age,0));
    c.laserCd=clamp(finiteNumber(c.laserCd,0),0,999);
    c.gasCd=clamp(finiteNumber(c.gasCd,0),0,999);
    c.guardCd=clamp(finiteNumber(c.guardCd,0),0,999);
    c.attackCd=clamp(finiteNumber(c.attackCd,0),0,999);
    c.waterDrinkCd=clamp(finiteNumber(c.waterDrinkCd,0),0,999);
    c.wateredT=clamp(finiteNumber(c.wateredT,0),0,999);
    c.leafFeedCd=clamp(finiteNumber(c.leafFeedCd,0),0,999);
    c.leafFeedTarget=isLeafMonster(c) ? normalizeCellRef(c.leafFeedTarget) : null;
    c.leafFeeding=isLeafMonster(c) && !!c.leafFeeding;
    c.transportRideT=isLeafMonster(c) ? clamp(finiteNumber(c.transportRideT,0),0,3) : 0;
    c.transportPulse=isLeafMonster(c) ? clamp(finiteNumber(c.transportPulse,0),0,3) : 0;
    c.transportMounted=false;
    c.pathBreakCd=clamp(finiteNumber(c.pathBreakCd,0),0,999);
    c.pathJumpCd=clamp(finiteNumber(c.pathJumpCd,0),0,999);
    c.stuckT=clamp(finiteNumber(c.stuckT,0),0,30);
    c.feedPulse=clamp(finiteNumber(c.feedPulse,0),0,3);
    c.hitPulse=clamp(finiteNumber(c.hitPulse,0),0,3);
    c.shieldPulse=clamp(finiteNumber(c.shieldPulse,0),0,3);
    normalizeCompanionGenome(c);
    if(c.hp<=0){
      kill(c);
      return false;
    }
    return true;
  }
  function companionBodyW(c){
    if(isClayGolem(c)) return 1.05 + Math.min(0.42, clayMass(c)*0.022);
    if(isLeafMonster(c)) return 0.66 + Math.min(0.20, leafMass(c)*0.010);
    if(isWaterGolem(c)) return 0.92 + Math.min(0.46, waterMass(c)*0.026);
    if(isMeatGolem(c) || isFriedMeatGolem(c)) return 0.88 + Math.min(0.32, meatMass(c)*0.018);
    if(isUfoAlien(c)) return 0.90 + Math.min(0.42, ufoConcreteMass(c)*0.024);
    if(isMolekin(c)) return 0.92 + Math.min(0.38, lavaMass(c)*0.018);
    return BODY_W*(0.92+Math.min(0.18,(c && c.biomass || 1)*0.008));
  }
  function companionBodyH(c){
    if(isClayGolem(c)) return 1.34 + Math.min(0.34, clayMass(c)*0.015);
    if(isLeafMonster(c)) return 0.78 + Math.min(0.18, leafMass(c)*0.008);
    if(isWaterGolem(c)) return 1.18 + Math.min(0.42, waterMass(c)*0.018);
    if(isMeatGolem(c) || isFriedMeatGolem(c)) return 1.08 + Math.min(0.30, meatMass(c)*0.014);
    if(isUfoAlien(c)) return 1.22 + Math.min(0.36, ufoConcreteMass(c)*0.016);
    if(isMolekin(c)) return 1.06 + Math.min(0.30, lavaMass(c)*0.012);
    return BODY_H;
  }
  function makeGenome(seed){
    const r=prng(seed);
    const palettes=[
      ['#5bcf72','#2f7f58','#c5ff71','#74f7ff'],
      ['#a75ad9','#4b2f73','#f7a8ff','#69f0c8'],
      ['#d66c4d','#6b3a43','#ffd36a','#a7ff6f'],
      ['#60a7d8','#2d4e73','#a7e8ff','#e6ff73'],
      ['#9dc451','#364f36','#d9ff73','#72ffd1'],
      ['#f2c65b','#3b3a51','#ffe89b','#ff77b7'],
      ['#45d1aa','#1c4b5a','#d7fff0','#90a7ff'],
      ['#b9f075','#47513a','#fff27a','#8fffca'],
      ['#f17b9b','#5a3148','#ffe0ef','#b1fff0'],
      ['#88a9ff','#283457','#e7ecff','#ffd36b']
    ];
    const bodies=['mantle','orb','runner','spine','crown','beetle','lantern','blade','tripod'];
    const eyeLayouts=['row','stack','triad','halo','split','visor'];
    const legStyles=['joint','spider','stub','talon','hover','crawler'];
    const tails=['none','whip','fork','club','fan','spark'];
    const crests=['none','horns','spines','frill','antenna','halo'];
    const markings=['none','stripe','spots','runes','split','veins'];
    const p=pick(r,palettes);
    const archetype=pick(r,ARCHETYPE_IDS);
    return {
      seed,
      archetype,
      body:pick(r,bodies),
      primary:p[0],
      secondary:p[1],
      glow:p[2],
      laser:p[3],
      eyes:1+randInt(r,5),
      legs:2+randInt(r,5),
      tendrils:2+randInt(r,6),
      horns:randInt(r,4),
      plates:1+randInt(r,5),
      size:0.82+r()*0.46,
      width:0.86+r()*0.34,
      eyeLayout:pick(r,eyeLayouts),
      legStyle:pick(r,legStyles),
      tail:pick(r,tails),
      crest:pick(r,crests),
      marking:pick(r,markings),
      glowPattern:randInt(r,4),
      gait:r()*2-1,
      shoulder:r()*0.36-0.18,
      asym:r()*0.7-0.35,
      pulse:r()*Math.PI*2,
      stripe:r()<0.55,
      coreX:(r()*0.28-0.14),
      antenna:r()<0.55
    };
  }
  function makeClayGenome(seed,clay){
    const r=prng(seed ^ 0x6c617900);
    const palettes=[
      ['#6f5c46','#3f3328','#9b8364','#ff7b2f','#f7c06a'],
      ['#7a6248','#4a3828','#a88a67','#ff8c3a','#ffd184'],
      ['#67533d','#382c22','#8f765a','#ff6a21','#f3b164'],
      ['#785f51','#43322d','#aa8979','#ff9146','#ffd79a'],
      ['#5f5043','#342c27','#897467','#ff742e','#f2bd7d']
    ];
    const heads=['low','wide','lump','brow','split'];
    const torsos=['bulwark','jar','hunched','column','lopsided'];
    const arms=['club','shield','long','block','sag'];
    const p=pick(r,palettes);
    return {
      seed,
      clay:clayMass({clay}),
      primary:p[0],
      secondary:p[1],
      highlight:p[2],
      core:p[3],
      coreGlow:p[4],
      head:pick(r,heads),
      torso:pick(r,torsos),
      arms:pick(r,arms),
      eyeCount:1+randInt(r,3),
      cracks:3+randInt(r,6),
      drips:2+randInt(r,6),
      pebbles:2+randInt(r,7),
      shoulder:0.86+r()*0.34,
      belly:0.90+r()*0.36,
      armScale:0.88+r()*0.40,
      legGap:0.26+r()*0.18,
      asym:r()*0.46-0.23,
      lean:r()*0.16-0.08,
      gait:r()*2-1,
      pulse:r()*Math.PI*2,
      coreX:r()*0.20-0.10,
      coreY:0.42+r()*0.14,
      wetSheen:0.36+r()*0.24,
      brow:r()<0.70,
      backSlab:r()<0.42,
      rune:r()<0.38
    };
  }
  function normalizeClayGenome(g,seed,clay){
    const base=makeClayGenome(seed,clay);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.clay=clayMass({clay:out.clay || clay});
    out.head=validChoice(out.head,['low','wide','lump','brow','split'],base.head);
    out.torso=validChoice(out.torso,['bulwark','jar','hunched','column','lopsided'],base.torso);
    out.arms=validChoice(out.arms,['club','shield','long','block','sag'],base.arms);
    out.eyeCount=clamp(out.eyeCount|0,1,4);
    out.cracks=clamp(out.cracks|0,2,10);
    out.drips=clamp(out.drips|0,0,9);
    out.pebbles=clamp(out.pebbles|0,0,10);
    out.shoulder=clamp(Number(out.shoulder)||base.shoulder,0.72,1.36);
    out.belly=clamp(Number(out.belly)||base.belly,0.72,1.42);
    out.armScale=clamp(Number(out.armScale)||base.armScale,0.74,1.46);
    out.legGap=clamp(Number(out.legGap)||base.legGap,0.18,0.54);
    out.asym=clamp(Number(out.asym)||0,-0.32,0.32);
    out.lean=clamp(Number(out.lean)||0,-0.14,0.14);
    out.gait=clamp(Number(out.gait)||0,-1,1);
    out.coreX=clamp(Number(out.coreX)||0,-0.16,0.16);
    out.coreY=clamp(Number(out.coreY)||base.coreY,0.34,0.62);
    out.wetSheen=clamp(Number(out.wetSheen)||base.wetSheen,0.18,0.72);
    return out;
  }
  function makeLeafGenome(seed,leaves){
    const r=prng(seed ^ 0x1eaf900d);
    const palettes=[
      ['#2faa2f','#1f6f33','#74d94f','#d9ff86','#7cf3a4'],
      ['#3fb95b','#245f3b','#8ee466','#f0ffb0','#9fffd1'],
      ['#d7832f','#8f5a2a','#efb24b','#ffe287','#b8f08a'],
      ['#8f5a2a','#513c24','#c08238','#ffd27a','#78db70'],
      ['#5cae43','#2d6232','#a2d86d','#f3ffc4','#86eac2']
    ];
    const silhouettes=['spiral','moth','crown','ragged','seed'];
    const wings=['fan','willow','maple','split','frond'];
    const p=pick(r,palettes);
    return {
      seed,
      leaves:leafMass({leaves}),
      primary:p[0],
      secondary:p[1],
      edge:p[2],
      glow:p[3],
      stem:p[4],
      laser:p[4],
      silhouette:pick(r,silhouettes),
      wings:pick(r,wings),
      eyeCount:1+randInt(r,3),
      leaflets:5+randInt(r,7),
      tatters:2+randInt(r,6),
      veins:3+randInt(r,6),
      antenna:r()<0.56,
      seedCore:r()<0.45,
      width:0.86+r()*0.34,
      height:0.84+r()*0.28,
      fan:0.82+r()*0.38,
      curl:r()*0.62-0.31,
      asym:r()*0.48-0.24,
      flutter:r()*2-1,
      pulse:r()*Math.PI*2,
      eyeY:0.42+r()*0.16
    };
  }
  function normalizeLeafGenome(g,seed,leaves){
    const base=makeLeafGenome(seed,leaves);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.leaves=leafMass({leaves:out.leaves || leaves});
    out.silhouette=validChoice(out.silhouette,['spiral','moth','crown','ragged','seed'],base.silhouette);
    out.wings=validChoice(out.wings,['fan','willow','maple','split','frond'],base.wings);
    out.eyeCount=clamp(out.eyeCount|0,1,4);
    out.leaflets=clamp(out.leaflets|0,4,14);
    out.tatters=clamp(out.tatters|0,0,9);
    out.veins=clamp(out.veins|0,2,10);
    out.width=clamp(Number(out.width)||base.width,0.70,1.36);
    out.height=clamp(Number(out.height)||base.height,0.68,1.24);
    out.fan=clamp(Number(out.fan)||base.fan,0.62,1.44);
    out.curl=clamp(Number(out.curl)||0,-0.42,0.42);
    out.asym=clamp(Number(out.asym)||0,-0.32,0.32);
    out.flutter=clamp(Number(out.flutter)||0,-1,1);
    out.eyeY=clamp(Number(out.eyeY)||base.eyeY,0.30,0.66);
    return out;
  }
  function makeWaterGenome(seed,water){
    const r=prng(seed ^ 0x77a7e900);
    const palettes=[
      ['#2f9fff','#0d5e9a','#b8f3ff','#e9ffff','#ff9a39'],
      ['#45c8ff','#176c9f','#d3fbff','#f4ffff','#ffb45f'],
      ['#2588e8','#123f7a','#99e4ff','#e4f8ff','#ff7f2e'],
      ['#5bd8ff','#1c7890','#c9ffff','#ffffff','#ffc067']
    ];
    const heads=['crest','bubble','crown','split','round'];
    const torsos=['surge','vase','wave','column','wide'];
    const arms=['splash','stream','anchor','flow','crest'];
    const p=pick(r,palettes);
    return {
      seed,
      water:waterMass({water}),
      primary:p[0],
      secondary:p[1],
      highlight:p[2],
      foam:p[3],
      core:p[4],
      head:pick(r,heads),
      torso:pick(r,torsos),
      arms:pick(r,arms),
      eyeCount:1+randInt(r,3),
      bubbles:4+randInt(r,8),
      droplets:3+randInt(r,7),
      shoulder:0.82+r()*0.42,
      belly:0.88+r()*0.36,
      armScale:0.82+r()*0.38,
      wave:r()*2-1,
      swirl:r()*2-1,
      coreX:r()*0.18-0.09,
      coreY:0.43+r()*0.16,
      transparency:0.54+r()*0.18,
      crest:r()<0.62,
      foamBand:r()<0.72
    };
  }
  function normalizeWaterGenome(g,seed,water){
    const base=makeWaterGenome(seed,water);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.water=waterMass({water:out.water || water});
    out.head=validChoice(out.head,['crest','bubble','crown','split','round'],base.head);
    out.torso=validChoice(out.torso,['surge','vase','wave','column','wide'],base.torso);
    out.arms=validChoice(out.arms,['splash','stream','anchor','flow','crest'],base.arms);
    out.eyeCount=clamp(out.eyeCount|0,1,4);
    out.bubbles=clamp(out.bubbles|0,2,14);
    out.droplets=clamp(out.droplets|0,0,12);
    out.shoulder=clamp(Number(out.shoulder)||base.shoulder,0.70,1.42);
    out.belly=clamp(Number(out.belly)||base.belly,0.68,1.42);
    out.armScale=clamp(Number(out.armScale)||base.armScale,0.65,1.42);
    out.wave=clamp(Number(out.wave)||0,-1,1);
    out.swirl=clamp(Number(out.swirl)||0,-1,1);
    out.coreX=clamp(Number(out.coreX)||0,-0.16,0.16);
    out.coreY=clamp(Number(out.coreY)||base.coreY,0.34,0.64);
    out.transparency=clamp(Number(out.transparency)||base.transparency,0.32,0.84);
    return out;
  }
  function makeMeatGenome(seed,meat){
    const r=prng(seed ^ 0x6d337a1);
    const palettes=[
      ['#b6423d','#7b262a','#f18a78','#f4d2bf','#733820','#6c7b34'],
      ['#c85648','#842e30','#ff9a84','#ffd8c4','#8a4328','#73833a'],
      ['#a93a42','#662232','#e47974','#eec5b8','#6c341f','#5f7135'],
      ['#d06052','#923a34','#ffa491','#ffe0ca','#914a2f','#809245']
    ];
    const heads=['jaw','round','snout','split','brow'];
    const torsos=['brute','runner','barrel','ribbed','hunched'];
    const arms=['hook','club','long','knuckle','sinew'];
    const legs=['spring','stomp','runner','wide'];
    const p=pick(r,palettes);
    return {
      seed,
      meat:meatMass({meat}),
      primary:p[0],
      secondary:p[1],
      highlight:p[2],
      fat:p[3],
      sear:p[4],
      rot:p[5],
      head:pick(r,heads),
      torso:pick(r,torsos),
      arms:pick(r,arms),
      legs:pick(r,legs),
      eyes:1+randInt(r,3),
      chunks:5+randInt(r,7),
      bones:1+randInt(r,4),
      sinews:3+randInt(r,6),
      shoulder:0.86+r()*0.34,
      belly:0.84+r()*0.38,
      armScale:0.86+r()*0.40,
      legScale:0.84+r()*0.36,
      asym:r()*0.42-0.21,
      gait:r()*2-1,
      pulse:r()*Math.PI*2,
      coreX:r()*0.22-0.11
    };
  }
  function normalizeMeatGenome(g,seed,meat){
    const base=makeMeatGenome(seed,meat);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.meat=meatMass({meat:out.meat || meat});
    out.head=validChoice(out.head,['jaw','round','snout','split','brow'],base.head);
    out.torso=validChoice(out.torso,['brute','runner','barrel','ribbed','hunched'],base.torso);
    out.arms=validChoice(out.arms,['hook','club','long','knuckle','sinew'],base.arms);
    out.legs=validChoice(out.legs,['spring','stomp','runner','wide'],base.legs);
    out.eyes=clamp(out.eyes|0,1,4);
    out.chunks=clamp(out.chunks|0,3,14);
    out.bones=clamp(out.bones|0,0,6);
    out.sinews=clamp(out.sinews|0,1,10);
    out.shoulder=clamp(Number(out.shoulder)||base.shoulder,0.68,1.42);
    out.belly=clamp(Number(out.belly)||base.belly,0.66,1.42);
    out.armScale=clamp(Number(out.armScale)||base.armScale,0.64,1.48);
    out.legScale=clamp(Number(out.legScale)||base.legScale,0.64,1.42);
    out.asym=clamp(Number(out.asym)||0,-0.36,0.36);
    out.gait=clamp(Number(out.gait)||0,-1,1);
    out.coreX=clamp(Number(out.coreX)||0,-0.18,0.18);
    return out;
  }
  function companionName(genome){
    const a=['Zielony','Syczacy','Iskrzacy','Miekki','Lustrzany','Gleboki'];
    const b=['Pomruk','Wartownik','Kiel','Oblok','Oko','Pancerzyk'];
    const r=prng((genome && genome.seed) || 1);
    return a[randInt(r,a.length)]+' '+b[randInt(r,b.length)];
  }
  function leafMonsterName(genome){
    const a=['Lisciany','Szeleszczacy','Lotny','Jesienny','Zielony','Wichrowy'];
    const b=['Potworek','Stwor','Wir','Duch','Chwast','Kleks'];
    const r=prng((genome && genome.seed) || 1);
    return a[randInt(r,a.length)]+' '+b[randInt(r,b.length)];
  }
  function clayGolemName(genome){
    const a=['Gliniany','Mokry','Ciezki','Mulisty','Rzezany','Lepki'];
    const b=['Golem','Straznik','Bastion','Tank','Kolumna','Wal'];
    const r=prng((genome && genome.seed) || 1);
    return a[randInt(r,a.length)]+' '+b[randInt(r,b.length)];
  }
  function waterGolemName(genome){
    const a=['Wodny','Pienisty','Gleboki','Strumienny','Blekitny','Falujacy'];
    const b=['Golem','Straznik','Wir','Przyplyw','Korpus','Hydrant'];
    const r=prng((genome && genome.seed) || 1);
    return a[randInt(r,a.length)]+' '+b[randInt(r,b.length)];
  }
  function meatGolemName(genome,rotten){
    const a=rotten ? ['Zepsuty','Gnily','Zombi','Cuchnacy','Zielonkawy','Stary'] : ['Miesny','Zylasty','Krwisty','Ruchliwy','Silny','Surowy'];
    const b=rotten ? ['Golem','Zarlok','Zombiak','Truposz','Lowca','Korpus'] : ['Golem','Sprinter','Mocarz','Zryw','Korpus','Atleta'];
    const r=prng((genome && genome.seed) || 1);
    return a[randInt(r,a.length)]+' '+b[randInt(r,b.length)];
  }
  function makeUfoAlienGenome(seed,concrete,role){
    const r=prng(seed ^ 0x0f0a11e9);
    const safeRole=validChoice(String(role||'rusher'),UFO_ALIEN_ROLES,'rusher');
    const rolePalettes={
      rusher:['#b8f7ff','#254a68','#7cf7ff','#effdff'],
      tank:['#d8fbff','#365a72','#a7f4ff','#ffffff'],
      healer:['#b9ffe4','#2f6158','#7dffcf','#effff6'],
      flanker:['#a6ecff','#244966','#9df0ff','#fff0b8'],
      orbiter:['#b7e8ff','#2b5275','#91d7ff','#f4fbff'],
      sniper:['#e6f7ff','#39465c','#ffe18a','#fff7d6'],
      sapper:['#ccefff','#4a445c','#ffb388','#fff0d6'],
      engineer:['#c7f8ff','#315a70','#69f0d8','#e9fff8'],
      commander:['#fff1a6','#5b4218','#ffffff','#fffbe0']
    };
    const p=rolePalettes[safeRole] || rolePalettes.rusher;
    const bodies={rusher:'runner',tank:'beetle',healer:'lantern',flanker:'blade',orbiter:'orb',sniper:'spine',sapper:'tripod',engineer:'mantle',commander:'crown'};
    const archetypes={rusher:'skirmisher',tank:'guardian',healer:'sentinel',flanker:'skirmisher',orbiter:'sentinel',sniper:'sniper',sapper:'volatile',engineer:'guardian',commander:'sentinel'};
    return {
      seed,
      motherIce:ufoConcreteMass({motherIce:concrete}),
      concrete:ufoConcreteMass({motherIce:concrete}),
      alienRole:safeRole,
      archetype:archetypes[safeRole] || 'guardian',
      body:bodies[safeRole] || pick(r,['runner','beetle','orb','spine','tripod']),
      primary:mixColor(p[0],'#d8fbff',0.18+r()*0.16),
      secondary:mixColor(p[1],'#102236',0.14+r()*0.20),
      glow:p[2],
      laser:p[3],
      eyeLayout:safeRole==='commander' ? 'halo' : pick(r,['row','triad','visor','split','halo']),
      legStyle:safeRole==='orbiter' ? 'hover' : pick(r,['joint','talon','crawler','spider','stub']),
      tail:safeRole==='sapper' ? 'spark' : pick(r,['none','fork','club','fan','whip']),
      crest:safeRole==='commander' ? 'halo' : pick(r,['antenna','spines','frill','horns','none']),
      marking:pick(r,['runes','split','veins','stripe','spots']),
      eyes:clamp(2+randInt(r,5)+(safeRole==='commander'?1:0),2,7),
      legs:clamp(3+randInt(r,5)+(safeRole==='tank'?1:0),3,8),
      tendrils:clamp(1+randInt(r,5)+(safeRole==='engineer'?1:0),1,7),
      horns:clamp(randInt(r,4)+(safeRole==='commander'?2:0),0,6),
      plates:clamp(3+randInt(r,5)+(safeRole==='tank'?2:0),3,8),
      size:clamp((safeRole==='tank'?1.22:(safeRole==='commander'?1.28:1.02)) + r()*0.12 - 0.04,0.88,1.44),
      width:clamp((safeRole==='tank'?1.20:(safeRole==='sniper'?0.92:1.02)) + r()*0.16 - 0.06,0.82,1.44),
      glowPattern:randInt(r,5),
      gait:r()*2-1,
      shoulder:r()*0.28-0.14,
      asym:r()*0.34-0.17,
      antenna:r()<0.78,
      concreteCracks:3+randInt(r,7),
      iceFractures:5+randInt(r,8),
      crownShard:randInt(r,5),
      circuitBands:2+randInt(r,5),
      roleMark:randInt(r,6)
    };
  }
  function normalizeUfoAlienGenome(g,seed,concrete,role){
    const base=makeUfoAlienGenome(seed,concrete,role);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.motherIce=ufoConcreteMass({motherIce:out.motherIce || out.concrete || concrete});
    out.concrete=out.motherIce;
    out.alienRole=validChoice(String(out.alienRole || role || base.alienRole),UFO_ALIEN_ROLES,base.alienRole);
    out.archetype=validChoice(out.archetype,ARCHETYPE_IDS,base.archetype);
    out.body=validChoice(out.body,['mantle','orb','runner','spine','crown','beetle','lantern','blade','tripod'],base.body);
    out.eyeLayout=validChoice(out.eyeLayout,['row','stack','triad','halo','split','visor'],base.eyeLayout);
    out.legStyle=validChoice(out.legStyle,['joint','spider','stub','talon','hover','crawler'],base.legStyle);
    out.tail=validChoice(out.tail,['none','whip','fork','club','fan','spark'],base.tail);
    out.crest=validChoice(out.crest,['none','horns','spines','frill','antenna','halo'],base.crest);
    out.marking=validChoice(out.marking,['none','stripe','spots','runes','split','veins'],base.marking);
    out.eyes=clamp(out.eyes|0,1,7);
    out.legs=clamp(out.legs|0,2,8);
    out.tendrils=clamp(out.tendrils|0,1,8);
    out.horns=clamp(out.horns|0,0,6);
    out.plates=clamp(out.plates|0,1,9);
    out.size=clamp(Number(out.size)||base.size,0.82,1.48);
    out.width=clamp(Number(out.width)||base.width,0.78,1.48);
    out.glowPattern=clamp(out.glowPattern|0,0,4);
    out.gait=clamp(Number(out.gait)||0,-1,1);
    out.shoulder=clamp(Number(out.shoulder)||0,-0.24,0.24);
    out.asym=clamp(Number(out.asym)||0,-0.42,0.42);
    out.concreteCracks=clamp(out.concreteCracks|0,1,12);
    out.iceFractures=clamp(out.iceFractures|0,1,14);
    out.crownShard=clamp(out.crownShard|0,0,8);
    out.circuitBands=clamp(out.circuitBands|0,1,8);
    out.roleMark=clamp(out.roleMark|0,0,8);
    return out;
  }
  function ufoAlienName(genome){
    const role=validChoice(String((genome && genome.alienRole) || 'rusher'),UFO_ALIEN_ROLES,'rusher');
    const a={rusher:'Macierzysty',tank:'Lodowy',healer:'Rezonansowy',flanker:'Srebrny',orbiter:'Orbitujacy',sniper:'Krysztalowy',sapper:'Saperski',engineer:'Inzynieryjny',commander:'Zloty'}[role] || 'Macierzysty';
    const b={rusher:'Rusher',tank:'Tank',healer:'Medyk',flanker:'Flanker',orbiter:'Orbiter',sniper:'Snajper',sapper:'Saper',engineer:'Inzynier',commander:'Commander'}[role] || 'Alien';
    const r=prng((genome && genome.seed) || 1);
    const c=['UFO','Czworokat','Relikt','Akolita','Korpus','Signal'];
    return a+' '+b+' '+c[randInt(r,c.length)];
  }
  function makeMolekinGenome(seed,lava,role){
    const r=prng(seed ^ 0xea57111);
    const safeRole=validChoice(String(role||'rusher'),MOLEKIN_ROLES,'rusher');
    const rolePalettes={
      rusher:['#7a5a3d','#3f2c20','#ffd38a','#ff8b35'],
      tank:['#6c6258','#332f2e','#ffd9a3','#ffb45c'],
      healer:['#8a6148','#493023','#ffe5a9','#ffc96f'],
      flanker:['#6f5037','#35251b','#ffd08a','#ff7138'],
      orbiter:['#77634f','#3c3027','#ffe0a0','#ffaa45'],
      sniper:['#89523c','#45251e','#ffe6b8','#ff552e'],
      sapper:['#76583f','#3a291e','#ffd28f','#ff9b38'],
      engineer:['#816247','#3f2e22','#ffe0a6','#ffc04f']
    };
    const p=rolePalettes[safeRole] || rolePalettes.rusher;
    const archetypes={rusher:'skirmisher',tank:'guardian',healer:'sentinel',flanker:'skirmisher',orbiter:'sentinel',sniper:'sniper',sapper:'volatile',engineer:'guardian'};
    const baseSize=(MOLEKIN_ROLE_TRAITS[safeRole] && MOLEKIN_ROLE_TRAITS[safeRole].hp>1.15) ? 1.12 : (safeRole==='flanker'?0.92:1.0);
    return {
      seed,
      lava:lavaMass({lava}),
      moleRole:safeRole,
      archetype:archetypes[safeRole] || 'guardian',
      fur:mixColor(p[0],'#8d6746',0.20+r()*0.20),
      dark:mixColor(p[1],'#1a100b',0.16+r()*0.22),
      deep:mixColor(p[1],'#070403',0.32+r()*0.18),
      eye:p[2],
      accent:p[3],
      ember:mixColor(p[3],'#fff0a8',0.12+r()*0.16),
      body:clamp(baseSize*(0.92+r()*0.20),0.72,1.42),
      height:clamp((safeRole==='tank'?0.92:(safeRole==='flanker'?0.76:0.84))*(0.90+r()*0.22),0.62,1.18),
      head:clamp(0.86+r()*0.34,0.72,1.35),
      eyeScale:clamp(0.78+r()*0.40,0.64,1.35),
      arm:clamp(0.92+r()*0.40,0.70,1.55),
      leg:clamp(0.72+r()*0.36,0.55,1.30),
      stance:clamp(r()*0.20-0.10,-0.16,0.16),
      gait:clamp(0.88+r()*0.46,0.62,1.55),
      glow:clamp(0.70+r()*0.72,0.45,1.70),
      helmet:clamp(0.78+r()*0.52,0.60,1.50),
      snout:clamp(0.76+r()*0.52,0.55,1.50),
      beard:clamp(0.40+r()*0.85,0.20,1.50),
      claw:clamp(0.86+r()*0.50,0.60,1.55),
      ears:1+randInt(r,3),
      braids:randInt(r,4),
      rankBands:1+randInt(r,4)+(safeRole==='tank'?1:0),
      soot:2+randInt(r,7),
      shoulder:r()*0.22-0.11,
      pulse:r()*Math.PI*2
    };
  }
  function normalizeMolekinGenome(g,seed,lava,role){
    const base=makeMolekinGenome(seed,lava,role);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.lava=lavaMass({lava:out.lava || lava});
    out.moleRole=validChoice(String(out.moleRole || role || base.moleRole),MOLEKIN_ROLES,base.moleRole);
    out.archetype=validChoice(out.archetype,ARCHETYPE_IDS,base.archetype);
    out.body=clamp(Number(out.body)||base.body,0.72,1.48);
    out.height=clamp(Number(out.height)||base.height,0.62,1.22);
    out.head=clamp(Number(out.head)||base.head,0.72,1.35);
    out.eyeScale=clamp(Number(out.eyeScale)||base.eyeScale,0.64,1.35);
    out.arm=clamp(Number(out.arm)||base.arm,0.70,1.55);
    out.leg=clamp(Number(out.leg)||base.leg,0.55,1.30);
    out.stance=clamp(Number(out.stance)||0,-0.16,0.16);
    out.gait=clamp(Number(out.gait)||base.gait,0.62,1.55);
    out.glow=clamp(Number(out.glow)||base.glow,0.45,1.70);
    out.helmet=clamp(Number(out.helmet)||base.helmet,0.60,1.50);
    out.snout=clamp(Number(out.snout)||base.snout,0.55,1.50);
    out.beard=clamp(Number(out.beard)||base.beard,0.20,1.50);
    out.claw=clamp(Number(out.claw)||base.claw,0.60,1.55);
    out.ears=clamp(out.ears|0,0,4);
    out.braids=clamp(out.braids|0,0,5);
    out.rankBands=clamp(out.rankBands|0,1,6);
    out.soot=clamp(out.soot|0,1,10);
    out.shoulder=clamp(Number(out.shoulder)||0,-0.24,0.24);
    return out;
  }
  function molekinName(genome){
    const role=validChoice(String((genome && genome.moleRole) || 'rusher'),MOLEKIN_ROLES,'rusher');
    const a={rusher:'Lawowy',tank:'Bazaltowy',healer:'Zarowy',flanker:'Tunelowy',orbiter:'Dymny',sniper:'Plomienny',sapper:'Saperski',engineer:'Podziemny'}[role] || 'Lawowy';
    const b={rusher:'Rusher',tank:'Tank',healer:'Medyk',flanker:'Flanker',orbiter:'Orbiter',sniper:'Snajper',sapper:'Saper',engineer:'Inzynier'}[role] || 'Kret';
    const r=prng((genome && genome.seed) || 1);
    const c=['Kretolud','Ryjownik','Akolita','Brat Tunelu','Zarokop','Pazur'];
    return a+' '+b+' '+c[randInt(r,c.length)];
  }
  function normalizeGenome(g,seed){
    const base=makeGenome(seed);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.archetype=validChoice(out.archetype,ARCHETYPE_IDS,base.archetype);
    out.body=validChoice(out.body,['mantle','orb','runner','spine','crown','beetle','lantern','blade','tripod'],base.body);
    out.eyeLayout=validChoice(out.eyeLayout,['row','stack','triad','halo','split','visor'],base.eyeLayout);
    out.legStyle=validChoice(out.legStyle,['joint','spider','stub','talon','hover','crawler'],base.legStyle);
    out.tail=validChoice(out.tail,['none','whip','fork','club','fan','spark'],base.tail);
    out.crest=validChoice(out.crest,['none','horns','spines','frill','antenna','halo'],base.crest);
    out.marking=validChoice(out.marking,['none','stripe','spots','runes','split','veins'],base.marking);
    out.eyes=clamp(out.eyes|0,1,6);
    out.legs=clamp(out.legs|0,2,8);
    out.tendrils=clamp(out.tendrils|0,1,8);
    out.horns=clamp(out.horns|0,0,5);
    out.plates=clamp(out.plates|0,1,7);
    out.size=clamp(Number(out.size)||1,0.72,1.48);
    out.width=clamp(Number(out.width)||1,0.72,1.46);
    out.glowPattern=clamp(out.glowPattern|0,0,4);
    out.gait=clamp(Number(out.gait)||0,-1,1);
    out.shoulder=clamp(Number(out.shoulder)||0,-0.24,0.24);
    out.asym=clamp(Number(out.asym)||0,-0.42,0.42);
    return out;
  }
  function traitsFor(c){
    if(isFriedMeatGolem(c)){
      const meat=meatMass(c);
      const g=(c && c.genome) || {};
      return {
        archetype:KIND_FRIED_MEAT_GOLEM,
        label:'pieczony sprzymierzeniec',
        follow:1.28,
        spacing:0.62,
        speed:4.25*(1+(Number(g.gait)||0)*0.035),
        accel:18.0,
        jump:-8.5,
        laserRange:2.35 + Math.min(0.50,meat*0.018),
        laserCooldown:0.54,
        laserDamage:7.2 + meat*0.38,
        poisonInterval:999,
        poisonPower:0,
        death:0.36,
        orbit:0.02
      };
    }
    if(isMeatGolem(c)){
      const meat=meatMass(c);
      const g=(c && c.genome) || {};
      const rotten=isRottenMeatGolem(c);
      return {
        archetype:c.kind,
        label:rotten ? 'miesny zombi' : 'miesny atlet',
        follow:rotten ? 0 : 1.18,
        spacing:rotten ? 0 : 0.58,
        speed:(rotten ? 3.85 : 4.85)*(1+(Number(g.gait)||0)*0.04),
        accel:rotten ? 14.8 : 20.5,
        jump:rotten ? -7.8 : -9.1,
        laserRange:rotten ? 1.25 : (2.55 + Math.min(0.52,meat*0.020)),
        laserCooldown:rotten ? MEAT_GOLEM_ZOMBIE_ATTACK_SECONDS : 0.46,
        laserDamage:(rotten ? MEAT_GOLEM_ZOMBIE_DAMAGE : 8.2) + meat*0.42,
        poisonInterval:999,
        poisonPower:0,
        death:0.42,
        orbit:0.03
      };
    }
    if(isWaterGolem(c)){
      const water=waterMass(c);
      const g=(c && c.genome) || {};
      return {
        archetype:KIND_WATER_GOLEM,
        label:'wodny straznik',
        follow:1.22 + Math.min(0.66,water*0.026),
        spacing:0.76,
        speed:2.15*(1+(Number(g.wave)||0)*0.035),
        accel:9.4,
        jump:-7.1,
        laserRange:4.6 + Math.min(2.2,water*0.10),
        laserCooldown:0.58,
        laserDamage:2.4 + water*0.25,
        poisonInterval:999,
        poisonPower:0,
        death:0.40,
        orbit:0.02,
        waterDrink:14 + water*1.6
      };
    }
    if(isLeafMonster(c)){
      const leaves=leafMass(c);
      const g=(c && c.genome) || {};
      return {
        archetype:KIND_LEAF_MONSTER,
        label:'lisciany lotnik',
        follow:1.45 + Math.min(0.42,leaves*0.018),
        spacing:0.50,
        speed:7.6*(1+(Number(g.flutter)||0)*0.045),
        accel:33,
        jump:0,
        laserRange:2.8 + Math.min(0.55,leaves*0.025),
        laserCooldown:0.56,
        laserDamage:3.2 + leaves*0.22,
        poisonInterval:999,
        poisonPower:0,
        death:0.32,
        orbit:0.34,
        flight:true,
        windResponse:LEAF_MONSTER_WIND_DRIFT + leaves*0.055
      };
    }
    if(isClayGolem(c)){
      const clay=clayMass(c);
      const g=(c && c.genome) || {};
      return {
        archetype:KIND_CLAY_GOLEM,
        label:'gliniany tank',
        follow:1.05 + Math.min(0.8,clay*0.035),
        spacing:0.86,
        speed:1.35*(1+(Number(g.gait)||0)*0.035),
        accel:5.4,
        jump:-6.8,
        laserRange:2.05 + Math.min(0.55,clay*0.018),
        laserCooldown:0.92,
        laserDamage:8.5 + clay*0.48,
        poisonInterval:999,
        poisonPower:0,
        death:0.52,
        orbit:0,
        guardRadius:CLAY_GOLEM_GUARD_RADIUS + Math.min(1.1,clay*0.05),
        guardAbsorb:0.74 + Math.min(0.16,clay*0.006)
      };
    }
    if(isUfoAlien(c)){
      const concrete=ufoConcreteMass(c);
      const role=ufoAlienRole(c);
      const roleTraits=UFO_ALIEN_ROLE_TRAITS[role] || UFO_ALIEN_ROLE_TRAITS.rusher;
      const g=(c && c.genome) || {};
      const gait=clamp(Number(g.gait)||0,-1,1);
      return {
        archetype:KIND_UFO_ALIEN,
        role,
        label:roleTraits.label || 'macierzysty alien',
        follow:1.55 + Math.min(1.12,concrete*0.045),
        spacing:role==='tank' || role==='commander' ? 0.88 : 0.66,
        speed:5.45*(roleTraits.speed||1)*(1+gait*0.045),
        accel:21.5*(roleTraits.accel||1),
        jump:-9.10*(roleTraits.jump||1),
        laserRange:(11.8 + Math.min(4.0,concrete*0.22))*(roleTraits.range||1),
        laserCooldown:0.42*(roleTraits.cooldown||1),
        laserDamage:(20.0 + concrete*1.35)*(roleTraits.damage||1),
        poisonInterval:role==='sapper' ? 2.2 : 5.4,
        poisonPower:roleTraits.poison || 0.35,
        death:0.20,
        orbit:roleTraits.orbit || 0,
        guardRadius:(roleTraits.guard ? 4.9 + concrete*0.08 : 0),
        guardAbsorb:roleTraits.guard || 0
      };
    }
    if(isMolekin(c)){
      const lava=lavaMass(c);
      const role=molekinRole(c);
      const roleTraits=MOLEKIN_ROLE_TRAITS[role] || MOLEKIN_ROLE_TRAITS.rusher;
      const g=(c && c.genome) || {};
      const gait=clamp(Number(g.gait)||1,0.62,1.55);
      return {
        archetype:KIND_MOLEKIN,
        role,
        label:roleTraits.label || 'lawowy kretolud',
        follow:1.42 + Math.min(1.00,lava*0.038),
        spacing:role==='tank' ? 0.86 : 0.60,
        speed:5.15*(roleTraits.speed||1)*(0.96+gait*0.04),
        accel:21.0*(roleTraits.accel||1),
        jump:-8.55*(roleTraits.jump||1),
        laserRange:(9.3 + Math.min(3.2,lava*0.16))*(roleTraits.range||1),
        laserCooldown:0.40*(roleTraits.cooldown||1),
        laserDamage:(17.0 + lava*1.05)*(roleTraits.damage||1),
        poisonInterval:999,
        poisonPower:0,
        death:0.18,
        orbit:roleTraits.orbit || 0,
        guardRadius:(roleTraits.guard ? 5.2 + lava*0.07 : 0),
        guardAbsorb:roleTraits.guard || 0,
        healMult:roleTraits.heal || 1,
        harvest:roleTraits.harvest || 1.25,
        fireCompanion:true
      };
    }
    const g=(c && c.genome) || {};
    const base=ARCHETYPE_TRAITS[g.archetype] || ARCHETYPE_TRAITS.guardian;
    const biomass=Math.max(1,Math.floor((c && c.biomass) || 1));
    const size=clamp(Number(g.size)||1,0.72,1.48);
    const gait=clamp(Number(g.gait)||0,-1,1);
    return {
      archetype:g.archetype || 'guardian',
      label:base.label,
      follow:base.follow + (size-1)*0.35,
      spacing:base.spacing,
      speed:FOLLOW_SPEED*base.speed*(1+gait*0.08),
      accel:FOLLOW_ACCEL*base.accel*(1+Math.abs(gait)*0.06),
      jump:-8.7*base.jump,
      laserRange:LASER_RANGE*base.range + Math.min(1.8,biomass*0.045),
      laserCooldown:LASER_COOLDOWN*base.cooldown,
      laserDamage:(5.5 + Math.min(16, biomass*0.7))*base.damage,
      poisonInterval:POISON_INTERVAL*base.poisonInterval,
      poisonPower:base.poisonPower,
      death:base.death,
      orbit:base.orbit
    };
  }
  function makeCompanion(opts){
    opts=opts||{};
    const kind=opts.kind===KIND_CLAY_GOLEM ? KIND_CLAY_GOLEM
      : (opts.kind===KIND_LEAF_MONSTER ? KIND_LEAF_MONSTER
      : (opts.kind===KIND_WATER_GOLEM ? KIND_WATER_GOLEM
      : (opts.kind===KIND_MEAT_GOLEM ? KIND_MEAT_GOLEM
      : (opts.kind===KIND_ROTTEN_MEAT_GOLEM ? KIND_ROTTEN_MEAT_GOLEM
      : (opts.kind===KIND_FRIED_MEAT_GOLEM || opts.kind===KIND_FRIED_CHICKEN ? KIND_FRIED_MEAT_GOLEM
      : (opts.kind===KIND_UFO_ALIEN ? KIND_UFO_ALIEN
      : (opts.kind===KIND_MOLEKIN ? KIND_MOLEKIN : KIND_BIO)))))));
    if(kind===KIND_MOLEKIN){
      const lava=lavaMass({lava:opts.lava || opts.lavaMass || opts.biomass});
      const role=validChoice(String(opts.moleRole || opts.role || (opts.genome && opts.genome.moleRole) || 'rusher'),MOLEKIN_ROLES,'rusher');
      const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,lava ^ 0xea57111);
      const genome=normalizeMolekinGenome(opts.genome,seed,lava,role);
      const maxHp=Number.isFinite(opts.maxHp) ? Math.max(1,opts.maxHp) : maxHpForMolekin(lava,genome.moleRole);
      return {
        kind,
        id:opts.id || ('molekin_'+seed.toString(36)+'_'+Date.now().toString(36)),
        seed,
        genome,
        name:opts.name || molekinName(genome),
        x:Number.isFinite(opts.x) ? opts.x : 0,
        y:Number.isFinite(opts.y) ? opts.y : 0,
        vx:Number.isFinite(opts.vx) ? opts.vx : 0,
        vy:Number.isFinite(opts.vy) ? opts.vy : 0,
        hp:Number.isFinite(opts.hp) ? Math.max(1, Math.min(maxHp,opts.hp)) : maxHp,
        maxHp,
        lava,
        moleRole:genome.moleRole,
        biomass:lava,
        facing:opts.facing || 1,
        grounded:false,
        laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.10+Math.random()*0.22),
        gasCd:999,
        guardCd:Number.isFinite(opts.guardCd) ? opts.guardCd : 0,
        hurtCd:0,
        stuckT:0,
        attackCd:Number.isFinite(opts.attackCd) ? opts.attackCd : 0,
        pathBreakCd:Number.isFinite(opts.pathBreakCd) ? opts.pathBreakCd : 0,
        age:opts.age || 0,
        feedPulse:opts.feedPulse || 0,
        hitPulse:0,
        shieldPulse:opts.shieldPulse || 0,
        lastTarget:null,
        harvestX:null,
        harvestY:null,
        harvestProgress:0,
        harvestScanCd:0
      };
    }
    if(kind===KIND_UFO_ALIEN){
      const concrete=ufoConcreteMass({motherIce:opts.motherIce || opts.motherIceMass || opts.iceCore || opts.ufoConcrete || opts.concrete || opts.concreteMass || opts.biomass});
      const role=validChoice(String(opts.ufoRole || opts.role || (opts.genome && opts.genome.alienRole) || 'rusher'),UFO_ALIEN_ROLES,'rusher');
      const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,concrete ^ 0x0f0a11e9);
      const genome=normalizeUfoAlienGenome(opts.genome,seed,concrete,role);
      const maxHp=Number.isFinite(opts.maxHp) ? Math.max(1,opts.maxHp) : maxHpForUfoAlien(concrete,genome.alienRole);
      return {
        kind,
        id:opts.id || ('ufoalien_'+seed.toString(36)+'_'+Date.now().toString(36)),
        seed,
        genome,
        name:opts.name || ufoAlienName(genome),
        x:Number.isFinite(opts.x) ? opts.x : 0,
        y:Number.isFinite(opts.y) ? opts.y : 0,
        vx:Number.isFinite(opts.vx) ? opts.vx : 0,
        vy:Number.isFinite(opts.vy) ? opts.vy : 0,
        hp:Number.isFinite(opts.hp) ? Math.max(1, Math.min(maxHp,opts.hp)) : maxHp,
        maxHp,
        motherIce:concrete,
        ufoConcrete:concrete,
        ufoRole:genome.alienRole,
        biomass:concrete,
        facing:opts.facing || 1,
        grounded:false,
        laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.10+Math.random()*0.24),
        gasCd:Number.isFinite(opts.gasCd) ? opts.gasCd : 1.4+Math.random()*2.0,
        guardCd:Number.isFinite(opts.guardCd) ? opts.guardCd : 0,
        hurtCd:0,
        stuckT:0,
        attackCd:Number.isFinite(opts.attackCd) ? opts.attackCd : 0,
        age:opts.age || 0,
        feedPulse:opts.feedPulse || 0,
        hitPulse:0,
        shieldPulse:opts.shieldPulse || 0,
        lastTarget:null,
        harvestX:null,
        harvestY:null,
        harvestProgress:0,
        harvestScanCd:0
      };
    }
    if(kind===KIND_FRIED_MEAT_GOLEM){
      const meat=meatMass({meat:opts.meat || opts.meatMass || opts.biomass});
      const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,meat ^ 0xf17ed);
      const genome=normalizeMeatGenome(opts.genome,seed,meat);
      const maxHp=Number.isFinite(opts.maxHp) ? Math.max(1,opts.maxHp) : maxHpForMeat(meat);
      return {
        kind,
        id:opts.id || ('friedgolem_'+seed.toString(36)+'_'+Date.now().toString(36)),
        seed,
        genome,
        name:opts.name || meatGolemName(genome,false).replace('Miesny','Pieczony').replace('Surowy','Pieczony'),
        x:Number.isFinite(opts.x) ? opts.x : 0,
        y:Number.isFinite(opts.y) ? opts.y : 0,
        vx:Number.isFinite(opts.vx) ? opts.vx : 0,
        vy:Number.isFinite(opts.vy) ? opts.vy : 0,
        hp:Number.isFinite(opts.hp) ? Math.max(1, Math.min(maxHp,opts.hp)) : maxHp,
        maxHp,
        meat,
        biomass:meat,
        facing:opts.facing || 1,
        grounded:false,
        laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.16+Math.random()*0.22),
        gasCd:999,
        hurtCd:0,
        stuckT:0,
        guardCd:Number.isFinite(opts.guardCd) ? opts.guardCd : 0,
        attackCd:Number.isFinite(opts.attackCd) ? opts.attackCd : 0,
        age:opts.age || 0,
        feedPulse:opts.feedPulse || 0,
        hitPulse:0,
        shieldPulse:opts.shieldPulse || 0,
        lastTarget:null,
        harvestX:null,
        harvestY:null,
        harvestProgress:0,
        harvestScanCd:0
      };
    }
    if(kind===KIND_MEAT_GOLEM || kind===KIND_ROTTEN_MEAT_GOLEM){
      const meat=meatMass({meat:opts.meat || opts.meatMass || opts.biomass});
      const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,meat ^ 0x6d337);
      const genome=normalizeMeatGenome(opts.genome,seed,meat);
      const maxHp=Number.isFinite(opts.maxHp) ? Math.max(1,opts.maxHp) : maxHpForMeat(meat);
      const rotten=kind===KIND_ROTTEN_MEAT_GOLEM;
      return {
        kind,
        id:opts.id || ((rotten?'rotmeat_':'meat_')+seed.toString(36)+'_'+Date.now().toString(36)),
        seed,
        genome,
        name:opts.name || meatGolemName(genome,rotten),
        x:Number.isFinite(opts.x) ? opts.x : 0,
        y:Number.isFinite(opts.y) ? opts.y : 0,
        vx:Number.isFinite(opts.vx) ? opts.vx : 0,
        vy:Number.isFinite(opts.vy) ? opts.vy : 0,
        hp:Number.isFinite(opts.hp) ? Math.max(1, opts.hp) : maxHp,
        maxHp,
        meat,
        biomass:meat,
        facing:opts.facing || 1,
        grounded:false,
        laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.10+Math.random()*0.20),
        gasCd:999,
        guardCd:Number.isFinite(opts.guardCd) ? opts.guardCd : 0,
        hurtCd:0,
        stuckT:0,
        attackCd:Number.isFinite(opts.attackCd) ? opts.attackCd : 0,
        age:opts.age || 0,
        feedPulse:opts.feedPulse || 0,
        hitPulse:0,
        shieldPulse:opts.shieldPulse || 0,
        lastTarget:null,
        harvestX:null,
        harvestY:null,
        harvestProgress:0,
        harvestScanCd:0
      };
    }
    if(kind===KIND_WATER_GOLEM){
      const water=waterMass({water:opts.water || opts.waterMass || opts.biomass});
      const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,water ^ 0x77a7);
      const genome=normalizeWaterGenome(opts.genome,seed,water);
      const maxHp=Number.isFinite(opts.maxHp) ? Math.max(1,opts.maxHp) : maxHpForWater(water);
      return {
        kind,
        id:opts.id || ('water_'+seed.toString(36)+'_'+Date.now().toString(36)),
        seed,
        genome,
        name:opts.name || waterGolemName(genome),
        x:Number.isFinite(opts.x) ? opts.x : 0,
        y:Number.isFinite(opts.y) ? opts.y : 0,
        vx:Number.isFinite(opts.vx) ? opts.vx : 0,
        vy:Number.isFinite(opts.vy) ? opts.vy : 0,
        hp:Number.isFinite(opts.hp) ? Math.max(1, opts.hp) : maxHp,
        maxHp,
        water,
        biomass:water,
        facing:opts.facing || 1,
        grounded:false,
        laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.18+Math.random()*0.32),
        gasCd:999,
        guardCd:Number.isFinite(opts.guardCd) ? opts.guardCd : 0,
        hurtCd:0,
        stuckT:0,
        waterDrinkCd:Number.isFinite(opts.waterDrinkCd) ? opts.waterDrinkCd : 0,
        wateredT:Number.isFinite(opts.wateredT) ? opts.wateredT : 0,
        age:opts.age || 0,
        feedPulse:opts.feedPulse || 0,
        hitPulse:0,
        shieldPulse:opts.shieldPulse || 0,
        lastTarget:null,
        harvestX:null,
        harvestY:null,
        harvestProgress:0,
        harvestScanCd:0
      };
    }
    if(kind===KIND_LEAF_MONSTER){
      const leaves=leafMass({leaves:opts.leaves || opts.leafMass || opts.biomass});
      const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,leaves ^ 0x1eaf);
      const genome=normalizeLeafGenome(opts.genome,seed,leaves);
      const maxHp=Number.isFinite(opts.maxHp) ? Math.max(1,opts.maxHp) : maxHpForLeaves(leaves);
      return {
        kind,
        id:opts.id || ('leaf_'+seed.toString(36)+'_'+Date.now().toString(36)),
        seed,
        genome,
        name:opts.name || leafMonsterName(genome),
        x:Number.isFinite(opts.x) ? opts.x : 0,
        y:Number.isFinite(opts.y) ? opts.y : 0,
        vx:Number.isFinite(opts.vx) ? opts.vx : 0,
        vy:Number.isFinite(opts.vy) ? opts.vy : 0,
        hp:Number.isFinite(opts.hp) ? Math.max(1, opts.hp) : maxHp,
        maxHp,
        leaves,
        biomass:leaves,
        facing:opts.facing || 1,
        grounded:false,
        flying:true,
        laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.12+Math.random()*0.30),
        gasCd:999,
        guardCd:Number.isFinite(opts.guardCd) ? opts.guardCd : 0,
        hurtCd:0,
        stuckT:0,
        leafFeedCd:Number.isFinite(opts.leafFeedCd) ? opts.leafFeedCd : 0,
        leafFeedTarget:normalizeCellRef(opts.leafFeedTarget),
        leafFeeding:!!opts.leafFeeding,
        transportRideT:Number.isFinite(opts.transportRideT) ? opts.transportRideT : 0,
        transportPulse:Number.isFinite(opts.transportPulse) ? opts.transportPulse : 0,
        transportMounted:false,
        age:opts.age || 0,
        feedPulse:opts.feedPulse || 0,
        hitPulse:0,
        shieldPulse:opts.shieldPulse || 0,
        lastTarget:null,
        harvestX:null,
        harvestY:null,
        harvestProgress:0,
        harvestScanCd:0
      };
    }
    if(kind===KIND_CLAY_GOLEM){
      const clay=clayMass({clay:opts.clay || opts.clayMass || opts.biomass});
      const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,clay);
      const genome=normalizeClayGenome(opts.genome,seed,clay);
      const maxHp=Number.isFinite(opts.maxHp) ? Math.max(1,opts.maxHp) : maxHpForClay(clay);
      return {
        kind,
        id:opts.id || ('clay_'+seed.toString(36)+'_'+Date.now().toString(36)),
        seed,
        genome,
        name:opts.name || clayGolemName(genome),
        x:Number.isFinite(opts.x) ? opts.x : 0,
        y:Number.isFinite(opts.y) ? opts.y : 0,
        vx:Number.isFinite(opts.vx) ? opts.vx : 0,
        vy:Number.isFinite(opts.vy) ? opts.vy : 0,
        hp:Number.isFinite(opts.hp) ? Math.max(1, opts.hp) : maxHp,
        maxHp,
        clay,
        biomass:clay,
        facing:opts.facing || 1,
        grounded:false,
        laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.25+Math.random()*0.45),
        gasCd:999,
        guardCd:Number.isFinite(opts.guardCd) ? opts.guardCd : 0,
        hurtCd:0,
        stuckT:0,
        age:opts.age || 0,
        feedPulse:opts.feedPulse || 0,
        hitPulse:0,
        shieldPulse:opts.shieldPulse || 0,
        lastTarget:null,
        harvestX:null,
        harvestY:null,
        harvestProgress:0,
        harvestScanCd:0
      };
    }
    const biomass=clamp(Math.floor(opts.biomass||3),1,MAX_BIOMASS);
    const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,biomass);
    const genome=normalizeGenome(opts.genome,seed);
    return {
      kind,
      id:opts.id || ('bio_'+seed.toString(36)+'_'+Date.now().toString(36)),
      seed,
      genome,
      name:opts.name || companionName(genome),
      x:Number.isFinite(opts.x) ? opts.x : 0,
      y:Number.isFinite(opts.y) ? opts.y : 0,
      vx:Number.isFinite(opts.vx) ? opts.vx : 0,
      vy:Number.isFinite(opts.vy) ? opts.vy : 0,
      hp:Number.isFinite(opts.hp) ? Math.max(1, opts.hp) : maxHpForBiomass(biomass),
      maxHp:Number.isFinite(opts.maxHp) ? Math.max(1, opts.maxHp) : maxHpForBiomass(biomass),
      biomass,
      facing:opts.facing || 1,
      grounded:false,
      laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.2+Math.random()*0.4),
      gasCd:Number.isFinite(opts.gasCd) ? opts.gasCd : (POISON_INTERVAL*0.7+Math.random()*POISON_INTERVAL*0.8),
      hurtCd:0,
      stuckT:0,
      age:opts.age || 0,
      feedPulse:opts.feedPulse || 0,
      hitPulse:0,
      lastTarget:null,
      harvestX:Number.isFinite(opts.harvestX) ? opts.harvestX : null,
      harvestY:Number.isFinite(opts.harvestY) ? opts.harvestY : null,
      harvestProgress:Number.isFinite(opts.harvestProgress) ? opts.harvestProgress : 0,
      harvestScanCd:Number.isFinite(opts.harvestScanCd) ? opts.harvestScanCd : 0
    };
  }
  function normalizeCommand(raw){
    if(!raw || typeof raw!=='object') return {mode:'attack', awaiting:false, harvestTile:null, harvestLabel:'', fightBadgeT:0, harvestBadgeT:0, transportBadgeT:0};
    const tile=Number.isFinite(raw.harvestTile) ? raw.harvestTile : null;
    const mode=raw.mode==='harvest' ? 'harvest' : (raw.mode==='transport' ? 'transport' : 'attack');
    return {
      mode,
      awaiting:mode==='harvest' && !!raw.awaiting && tile==null,
      harvestTile:mode==='harvest' ? tile : null,
      harvestLabel:String(raw.harvestLabel || ''),
      fightBadgeT:mode==='attack' ? clamp(finiteNumber(raw.fightBadgeT,0),0,5) : 0,
      harvestBadgeT:mode==='harvest' && tile!=null ? clamp(finiteNumber(raw.harvestBadgeT,0),0,5) : 0,
      transportBadgeT:mode==='transport' ? clamp(finiteNumber(raw.transportBadgeT,0),0,5) : 0
    };
  }
  function normalizeCellRef(raw){
    if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
    return {x:Math.floor(raw.x), y:Math.floor(raw.y)};
  }
  function setCommand(next){
    const n=normalizeCommand(next);
    command.mode=n.mode;
    command.awaiting=n.awaiting;
    command.harvestTile=n.harvestTile;
    command.harvestLabel=n.harvestLabel;
    command.fightBadgeT=n.fightBadgeT;
    command.harvestBadgeT=n.harvestBadgeT;
    command.transportBadgeT=n.transportBadgeT;
    if(command.mode!=='harvest' || command.harvestTile==null){
      for(const c of list){
        c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
      }
    }
    return snapshotCommand();
  }
  function snapshotCommand(){
    return {mode:command.mode, awaiting:!!command.awaiting, harvestTile:command.harvestTile, harvestLabel:command.harvestLabel||'', fightBadgeT:command.fightBadgeT||0, harvestBadgeT:command.harvestBadgeT||0, transportBadgeT:command.transportBadgeT||0};
  }
  function isAttackMode(){ return command.mode==='attack'; }
  function isHarvestMode(){ return command.mode==='harvest'; }
  function isTransportMode(){ return command.mode==='transport'; }
  function awaitingHarvestTarget(){ return isHarvestMode() && command.awaiting; }
  function assignHarvestTarget(tileId,label){
    if(!Number.isFinite(tileId) || tileId===T.AIR) return false;
    command.mode='harvest';
    command.awaiting=false;
    command.harvestTile=tileId;
    command.harvestLabel=String(label || ((INFO[tileId] && INFO[tileId].name) || 'material'));
    command.fightBadgeT=0;
    command.harvestBadgeT=5;
    command.transportBadgeT=0;
    for(const c of list){
      c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
    }
    say('Pomocnicy beda zbierac: '+command.harvestLabel+'.');
    return true;
  }
  function companionAtTile(tx,ty,range){
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    const x=tx+0.5, y=ty+0.5;
    let best=null, bd=(range||1.45)*(range||1.45);
    for(const c of list){
      if(!enemyTargetable(c)) continue;
      const dx=c.x-x, dy=(c.y-0.55)-y, d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best=c; }
    }
    return best;
  }
  function commandAt(tx,ty){
    if(!list.length) return false;
    const clicked=companionAtTile(tx,ty,1.55);
    if(!clicked) return false;
    if(command.mode==='harvest'){
      if(isLeafMonster(clicked)){
        setCommand({mode:'transport', transportBadgeT:5});
        say('Lisciaki przechodza w transport. Wskocz na lisciaka, zeby nim sterowac.');
      }else{
        setCommand({mode:'attack', fightBadgeT:5});
        say('Pomocnicy wracaja do obrony.');
      }
    }else if(command.mode==='transport'){
      setCommand({mode:'attack', fightBadgeT:5});
      say('Pomocnicy wracaja do obrony.');
    }else{
      setCommand({mode:'harvest', awaiting:true});
      say('Pomocnicy czekaja na wskazanie materialu do zbierania.');
    }
    return true;
  }
  function spawnProbeTiles(x,y){
    return [
      [x,y],
      [x-1,y],
      [x+1,y],
      [x-2,y],
      [x+2,y],
      [x,y-1],
      [x-1,y-1],
      [x+1,y-1]
    ];
  }
  function tileAt(getTile,x,y){
    const tx=Math.floor(Number(x)), ty=Math.floor(Number(y));
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return T.AIR;
    try{ return getTile ? getTile(tx, ty) : T.AIR; }catch(e){ return T.AIR; }
  }
  function cachedTileGetter(getTile){
    if(typeof getTile!=='function') return getTile;
    const cache=new Map();
    return function(x,y){
      const tx=Math.floor(Number(x)), ty=Math.floor(Number(y));
      if(!Number.isFinite(tx) || !Number.isFinite(ty)) return T.AIR;
      const key=tx+','+ty;
      if(cache.has(key)) return cache.get(key);
      const t=tileAt(getTile,tx,ty);
      cache.set(key,t);
      return t;
    };
  }
  function passableForCompanion(t){
    return isHeroPassableTile(t) || isDoorTile(t);
  }
  function clearAt(x,y,m,getTile){
    if(!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const hw=companionBodyW(m)*0.5;
    const top=y-companionBodyH(m), bottom=y-0.04;
    const xs=[x-hw,x,x+hw];
    const ys=[top,top+0.38,bottom];
    for(const px of xs){
      for(const py of ys){
        const t=tileAt(getTile,px,py);
        if(!passableForCompanion(t)) return false;
      }
    }
    return true;
  }
  function solidBodyContacts(c,getTile){
    const hits=[];
    const seen=new Set();
    const hw=companionBodyW(c)*0.5;
    const top=c.y-companionBodyH(c), bottom=c.y-0.04;
    const xs=[c.x-hw,c.x,c.x+hw];
    const ys=[top,top+0.38,bottom];
    for(const px of xs){
      for(const py of ys){
        const tx=Math.floor(px), ty=Math.floor(py);
        const t=tileAt(getTile,px,py);
        if(passableForCompanion(t)) continue;
        const k=tx+','+ty;
        if(seen.has(k)) continue;
        seen.add(k);
        hits.push({x:tx,y:ty,t});
      }
    }
    return hits;
  }
  function findCrushEscape(c,getTile){
    const candidates=[];
    const xSteps=[0,-0.75,0.75,-1.25,1.25,-2,2,-3,3];
    const ySteps=[-0.15,-0.65,-1.1,0.35,-1.65,0.85];
    for(const dy of ySteps){
      for(const dx of xSteps){
        if(dx===0 && Math.abs(dy)<0.2) continue;
        candidates.push({x:c.x+dx,y:c.y+dy,d2:dx*dx+dy*dy});
      }
    }
    candidates.sort((a,b)=>a.d2-b.d2);
    for(const p of candidates){
      if(!inCompanionWorldY(p.y,1,0.2)) continue;
      if(clearAt(p.x,p.y,c,getTile)) return p;
    }
    return null;
  }
  function crushDamageForContacts(contacts,dt){
    let load=0;
    for(const hit of contacts){
      const p=buildMaterialProfile(hit.t);
      if(p) load += 8 + (Number(p.weight)||1)*8 + (Number(p.strength)||6)*0.45;
      else load += hit.t===T.BEDROCK ? 42 : 18;
    }
    return (14 + Math.min(72,load))*dt;
  }
  function resolveCrush(c,dt,getTile){
    const contacts=solidBodyContacts(c,getTile);
    if(!contacts.length){ c.crushT=0; return false; }
    const escape=findCrushEscape(c,getTile);
    if(escape){
      c.x=escape.x; c.y=escape.y; c.vx=0; c.vy=Math.min(0,c.vy);
      c.crushT=0;
      c.hitPulse=Math.max(c.hitPulse||0,0.18);
      sparks(c.x,c.y-0.55,'common',5);
      return false;
    }
    c.crushT=(c.crushT||0)+dt;
    c.vx*=0.1;
    c.vy=Math.min(0,c.vy);
    const pressure=1+Math.min(1.15,c.crushT*0.85);
    return damage(c,crushDamageForContacts(contacts,dt)*pressure,'crush');
  }
  function companionBumpMass(c){
    if(isClayGolem(c)) return 2.5 + clayMass(c)*0.08;
    if(isWaterGolem(c)) return 1.9 + waterMass(c)*0.055;
    if(isLeafMonster(c)) return 0.38 + leafMass(c)*0.018;
    if(isMeatGolem(c) || isFriedMeatGolem(c)) return 1.45 + meatMass(c)*0.045;
    if(isMolekin(c)) return 1.70 + lavaMass(c)*0.050;
    return 1 + Math.max(0,Math.floor((c && c.biomass) || 1))*0.035;
  }
  function companionVerticalOverlap(a,b){
    const top=Math.max(a.y-companionBodyH(a), b.y-companionBodyH(b));
    const bottom=Math.min(a.y-0.04, b.y-0.04);
    return bottom-top;
  }
  function tryPushCompanion(c,dx,getTile){
    if(!c || Math.abs(dx)<0.0005) return false;
    const nx=c.x+dx;
    if(!clearAt(nx,c.y,c,getTile)) return false;
    c.x=nx;
    return true;
  }
  function heroClearAt(player,x,y,getTile){
    if(!player) return false;
    const w=Math.max(0.24,(Number(player.w)||0.7)*0.5);
    const h=Math.max(0.32,(Number(player.h)||0.95)*0.5);
    const xs=[x-w+0.03,x,x+w-0.03];
    const ys=[y-h+0.03,y,y+h-0.03];
    for(const px of xs){
      for(const py of ys){
        if(!isHeroPassableTile(tileAt(getTile,px,py))) return false;
      }
    }
    return true;
  }
  function tryMoveHero(player,dx,dy,getTile){
    if(!player || (Math.abs(dx)<0.0005 && Math.abs(dy)<0.0005)) return false;
    if(!Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return false;
    const nx=Number(player.x)+dx;
    const ny=Number(player.y)+dy;
    if(!heroClearAt(player,nx,ny,getTile)) return false;
    player.x=nx;
    player.y=ny;
    return true;
  }
  function resolveHeroCompanionBump(c,player,dt,getTile){
    if(!enemyTargetable(c) || !player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return false;
    if(isLeafMonster(c) && c.transportMounted) return false;
    const hw=(Number(player.w)||0.7)*0.5;
    const hh=(Number(player.h)||0.95)*0.5;
    const pLeft=player.x-hw, pRight=player.x+hw, pTop=player.y-hh, pBottom=player.y+hh;
    const cHw=companionBodyW(c)*0.5;
    const cTop=c.y-companionBodyH(c), cBottom=c.y-0.04;
    const cLeft=c.x-cHw, cRight=c.x+cHw;
    const overlapX=Math.min(pRight,cRight)-Math.max(pLeft,cLeft);
    const overlapY=Math.min(pBottom,cBottom)-Math.max(pTop,cTop);
    if(overlapX<=0 || overlapY<=0) return false;

    const playerAbove=player.y<cTop+hh+0.22 && (Number(player.vy)||0)>=-0.25;
    if(playerAbove && overlapY<Math.max(0.34,overlapX*0.80)){
      const dy=-(overlapY+0.012);
      if(tryMoveHero(player,0,dy,getTile)){
        player.vy=0;
        player.onGround=true;
        player.jumpCount=0;
        c.vy=Math.max(c.vy||0,0);
        c.stuckT=0;
        return true;
      }
    }

    const dir=Math.sign((player.x-c.x) || player.vx || -(c.vx||0) || (player.facing||1)) || 1;
    const overlap=overlapX+0.018;
    const heroMass=1.35;
    const compMass=companionBumpMass(c);
    const heroDx=dir*overlap*(compMass/(heroMass+compMass));
    const compDx=-dir*overlap*(heroMass/(heroMass+compMass));
    const movedHero=tryMoveHero(player,heroDx,0,getTile);
    const movedComp=tryPushCompanion(c,compDx,getTile);
    if(!movedHero && movedComp) tryPushCompanion(c,-dir*Math.min(overlap,0.42),getTile);
    if(!movedComp && movedHero) tryMoveHero(player,dir*Math.min(overlap,0.32),0,getTile);
    if(movedHero && (Number(player.vx)||0)*dir<0) player.vx=0;
    if(movedComp) c.vx=clamp((c.vx||0)+compDx/Math.max(dt||1/30,1/120)*0.08,-5,5);
    if(movedHero || movedComp){
      c.stuckT=0;
      return true;
    }
    return false;
  }
  function collideHero(player,dt,getTile){
    if(!player || !list.length) return false;
    let moved=false;
    for(let pass=0;pass<3;pass++){
      let passMoved=false;
      for(const c of list) passMoved=resolveHeroCompanionBump(c,player,dt,getTile) || passMoved;
      moved=moved || passMoved;
      if(!passMoved) break;
    }
    return moved;
  }
  function resolveCompanionBump(a,b,dt,getTile){
    if(!a || !b) return false;
    if(companionVerticalOverlap(a,b)<=0.08) return false;
    const need=(companionBodyW(a)+companionBodyW(b))*0.5+0.08;
    const dx=b.x-a.x;
    const overlap=need-Math.abs(dx);
    if(overlap<=0) return false;
    const dir=Math.abs(dx)>0.001 ? Math.sign(dx) : (((a.seed||0) <= (b.seed||0)) ? 1 : -1);
    const ma=companionBumpMass(a), mb=companionBumpMass(b);
    const pushA=-dir*overlap*(mb/(ma+mb));
    const pushB=dir*overlap*(ma/(ma+mb));
    const movedA=tryPushCompanion(a,pushA,getTile);
    const movedB=tryPushCompanion(b,pushB,getTile);
    if(!movedA && movedB) tryPushCompanion(b,dir*Math.min(overlap,0.35),getTile);
    if(!movedB && movedA) tryPushCompanion(a,-dir*Math.min(overlap,0.35),getTile);
    const impulse=clamp(overlap/Math.max(dt||1/30,1/120)*0.10,0.08,1.55);
    if(movedA) a.vx=clamp((a.vx||0)-dir*impulse*(mb/(ma+mb)),-8,8);
    if(movedB) b.vx=clamp((b.vx||0)+dir*impulse*(ma/(ma+mb)),-8,8);
    a.stuckT=0;
    b.stuckT=0;
    return movedA || movedB;
  }
  function resolveCompanionBumps(dt,getTile){
    if(list.length<2) return false;
    let moved=false;
    for(let pass=0;pass<3;pass++){
      let passMoved=false;
      for(let i=0;i<list.length;i++){
        for(let j=i+1;j<list.length;j++){
          passMoved=resolveCompanionBump(list[i],list[j],dt,getTile) || passMoved;
        }
      }
      moved=moved || passMoved;
      if(!passMoved) break;
    }
    return moved;
  }
  function hasFloor(x,y,getTile){
    const hw=BODY_W*0.38;
    const below=y+0.05;
    return !passableForCompanion(tileAt(getTile,x-hw,below)) || !passableForCompanion(tileAt(getTile,x+hw,below));
  }
  function hasFloorFor(c,x,y,getTile){
    const hw=companionBodyW(c)*0.38;
    const below=y+0.05;
    return !passableForCompanion(tileAt(getTile,x-hw,below)) || !passableForCompanion(tileAt(getTile,x+hw,below));
  }
  function launchCompanionFromSpring(c,getTile){
    const spring=MM.springPlatforms;
    if(!spring || typeof spring.launchEntity!=='function') return false;
    const hw=companionBodyW(c)*0.38;
    const footY=Math.floor(c.y+0.05);
    const xs=[c.x-hw,c.x,c.x+hw];
    for(const px of xs){
      const tx=Math.floor(px);
      if(tileAt(getTile,tx,footY)!==T.SPRING_PLATFORM) continue;
      const launched=spring.launchEntity(c,tx,footY,getTile,{kind:'companion',facing:c.facing});
      if(launched){
        c.grounded=false;
        c.stuckT=0;
        c.pathJumpCd=Math.max(c.pathJumpCd||0,0.12);
        return true;
      }
      return false;
    }
    return false;
  }
  function navKey(x,y){ return x+','+y; }
  function navNodeFor(x,y){ return {x:Math.floor(x), y:Math.floor(y)}; }
  function navPos(node){ return {x:node.x+0.5, y:node.y+0.96}; }
  function navInBounds(node,bounds){
    return node.x>=bounds.minX && node.x<=bounds.maxX && node.y>=bounds.minY && node.y<=bounds.maxY;
  }
  function canStandAtNavNode(c,x,y,getTile,bounds){
    const node={x,y};
    if(bounds && !navInBounds(node,bounds)) return false;
    const p=navPos(node);
    if(!inCompanionWorldY(p.y,1.2,0.2)) return false;
    return clearAt(p.x,p.y,c,getTile) && hasFloorFor(c,p.x,p.y,getTile);
  }
  function findStandNodeNear(c,x,y,getTile,radius,bounds){
    const cx=Math.floor(x), cy=Math.floor(y);
    let best=null, bestScore=Infinity;
    for(let dx=-radius; dx<=radius; dx++){
      for(let dy=-radius; dy<=radius; dy++){
        if(Math.max(Math.abs(dx),Math.abs(dy))>radius) continue;
        const nx=cx+dx, ny=cy+dy;
        if(!canStandAtNavNode(c,nx,ny,getTile,bounds)) continue;
        const p=navPos({x:nx,y:ny});
        const score=(p.x-x)*(p.x-x)+(p.y-y)*(p.y-y)+Math.abs(dy)*0.05;
        if(score<bestScore){ bestScore=score; best={x:nx,y:ny}; }
      }
    }
    return best;
  }
  function companionPathNeighbors(c,node,getTile,bounds){
    const out=[];
    function add(x,y,cost){
      if(canStandAtNavNode(c,x,y,getTile,bounds)) out.push({x,y,cost});
    }
    for(const dir of [-1,1]){
      add(node.x+dir,node.y,10);
      add(node.x+dir,node.y-1,13);
      for(let drop=1; drop<=3; drop++) add(node.x+dir,node.y+drop,10+drop);
      const mid=navPos({x:node.x+dir,y:node.y});
      if(clearAt(mid.x,mid.y,c,getTile) && !hasFloorFor(c,mid.x,mid.y,getTile)) add(node.x+dir*2,node.y,15);
    }
    return out;
  }
  function companionPathHeuristic(a,b){
    return Math.abs(a.x-b.x)*10 + Math.abs(a.y-b.y)*8;
  }
  function reconstructCompanionPath(node){
    const path=[];
    let cur=node;
    while(cur){ path.push({x:cur.x,y:cur.y}); cur=cur.parent; }
    path.reverse();
    return path;
  }
  function findCompanionPath(c,targetX,targetY,getTile){
    if(!c || isLeafMonster(c)) return null;
    const pathGetTile=cachedTileGetter(getTile);
    if(!hasFloorFor(c,c.x,c.y,pathGetTile)) return null;
    const start=navNodeFor(c.x,c.y);
    const bounds={
      minX:start.x-COMPANION_PATH_RADIUS_X,
      maxX:start.x+COMPANION_PATH_RADIUS_X,
      minY:start.y-COMPANION_PATH_RADIUS_Y,
      maxY:start.y+COMPANION_PATH_RADIUS_Y
    };
    if(!canStandAtNavNode(c,start.x,start.y,pathGetTile,bounds)) return null;
    let gx=Math.floor(targetX), gy=Math.floor(targetY);
    if(Math.abs(gx-start.x)>COMPANION_PATH_RADIUS_X) gx=start.x+Math.sign(gx-start.x)*COMPANION_PATH_RADIUS_X;
    if(Math.abs(gy-start.y)>COMPANION_PATH_RADIUS_Y) gy=start.y+Math.sign(gy-start.y)*COMPANION_PATH_RADIUS_Y;
    const goal=findStandNodeNear(c,gx+0.5,gy+0.96,pathGetTile,COMPANION_PATH_GOAL_SCAN,bounds);
    if(!goal || (goal.x===start.x && goal.y===start.y)) return null;
    const startRec={x:start.x,y:start.y,g:0,f:companionPathHeuristic(start,goal),parent:null};
    const open=[startRec];
    const records=new Map([[navKey(start.x,start.y),startRec]]);
    const closed=new Set();
    let visited=0;
    while(open.length && visited<COMPANION_PATH_MAX_NODES){
      let bestI=0;
      for(let i=1;i<open.length;i++){
        if(open[i].f<open[bestI].f || (open[i].f===open[bestI].f && open[i].g>open[bestI].g)) bestI=i;
      }
      const cur=open.splice(bestI,1)[0];
      const key=navKey(cur.x,cur.y);
      if(closed.has(key)) continue;
      closed.add(key);
      visited++;
      if(cur.x===goal.x && cur.y===goal.y) return reconstructCompanionPath(cur);
      for(const n of companionPathNeighbors(c,cur,pathGetTile,bounds)){
        const nk=navKey(n.x,n.y);
        if(closed.has(nk)) continue;
        const g=cur.g+n.cost;
        const old=records.get(nk);
        if(old && g>=old.g) continue;
        const rec={x:n.x,y:n.y,g,f:g+companionPathHeuristic(n,goal),parent:cur};
        records.set(nk,rec);
        open.push(rec);
      }
    }
    return null;
  }
  function companionPathTarget(c,targetX,targetY,dt,getTile){
    if(!c || isLeafMonster(c)) return {x:targetX,y:targetY,routed:false};
    const d2=(targetX-c.x)*(targetX-c.x)+(targetY-c.y)*(targetY-c.y);
    if(d2<1.25){
      c.navPath=null;
      c.navGoalKey='';
      return {x:targetX,y:targetY,routed:false};
    }
    c.navReplanCd=Math.max(0,(c.navReplanCd||0)-dt);
    const goalKey=navKey(Math.floor(targetX),Math.floor(targetY));
    if(c.navGoalKey!==goalKey) c.navReplanCd=0;
    if(Array.isArray(c.navPath)){
      while(c.navPath.length){
        const p=navPos(c.navPath[0]);
        if(Math.abs(c.x-p.x)<=0.72 && Math.abs(c.y-p.y)<=0.88) c.navPath.shift();
        else break;
      }
    }
    if(c.navReplanCd<=0 || !Array.isArray(c.navPath) || !c.navPath.length){
      const path=findCompanionPath(c,targetX,targetY,getTile);
      c.navPath=path && path.length>1 ? path.slice(1,6) : null;
      c.navGoalKey=goalKey;
      c.navReplanCd=COMPANION_PATH_REPLAN_SECONDS + (((c.seed||0)&3)*0.025);
    }
    if(Array.isArray(c.navPath) && c.navPath.length){
      const p=navPos(c.navPath[0]);
      return {x:p.x,y:p.y,routed:true};
    }
    return {x:targetX,y:targetY,routed:false};
  }
  function findSpawnNear(player,getTile,offset){
    const px=Number(player && player.x) || 0;
    const py=Number(player && player.y) || 0;
    const dir=(player && player.facing) || -1;
    const baseX=px-dir*(offset||1.35);
    const baseY=py;
    for(const p of spawnProbeTiles(baseX,baseY)){
      for(let yy=Math.floor(p[1])-3; yy<=Math.floor(p[1])+3; yy++){
        const x=p[0], y=yy+0.96;
        if(!inCompanionWorldY(y,2,1)) continue;
        if(clearAt(x,y,{biomass:3},getTile) && hasFloor(x,y,getTile)) return {x,y};
      }
    }
    return {x:px-dir*1.2, y:py};
  }
  function findSpawnNearFor(probe,player,getTile,offset){
    const px=Number(player && player.x) || 0;
    const py=Number(player && player.y) || 0;
    const dir=(player && player.facing) || -1;
    const baseX=px-dir*(offset||1.65);
    const baseY=py;
    for(const p of spawnProbeTiles(baseX,baseY)){
      for(let yy=Math.floor(p[1])-3; yy<=Math.floor(p[1])+4; yy++){
        const x=p[0], y=yy+0.96;
        if(!inCompanionWorldY(y,2,1)) continue;
        if(clearAt(x,y,probe,getTile) && hasFloorFor(probe,x,y,getTile)) return {x,y};
      }
    }
    return {x:px-dir*(offset||1.65), y:py};
  }
  function ritualHash(x,y,n){
    let h=Math.imul(Math.floor(x)|0,73856093) ^ Math.imul(Math.floor(y)|0,19349663) ^ Math.imul(n|0,83492791) ^ 0x9e3779b9;
    h=Math.imul(h ^ (h>>>13),1274126177);
    return (h ^ (h>>>16)) >>> 0;
  }
  function guardianDefeated(kind){
    const key=String(kind || '');
    try{
      const g=MM.guardianLairs || null;
      if(g && typeof g.status==='function'){
        const st=g.status() || {};
        if(st.defeated && st.defeated[key]) return true;
      }
      if(g && typeof g.metrics==='function'){
        const m=g.metrics() || {};
        if(m.defeated && m.defeated[key]) return true;
      }
    }catch(e){}
    try{
      const hearts=MM.progress && MM.progress.guardianHearts ? MM.progress.guardianHearts() : null;
      if(hearts && hearts[key]) return true;
    }catch(e){}
    return false;
  }
  function fireGuardianDefeated(){ return guardianDefeated('fire'); }
  function iceGuardianDefeated(){ return guardianDefeated('ice'); }
  function clayRitualCandidates(x,y,getTile){
    return ritualStonesNear(x,y,CLAY_GOLEM_MAX_CLAY,getTile,T.VOLCANO_MASTER_STONE);
  }
  function wetClayNearMaster(mx,my,getTile){
    const cells=[];
    const seen=new Set();
    const queue=[];
    for(let dy=-2;dy<=2;dy++){
      for(let dx=-2;dx<=2;dx++){
        if(dx===0 && dy===0) continue;
        const x=mx+dx, y=my+dy;
        if(tileAt(getTile,x,y)!==T.WET_CLAY) continue;
        const d=Math.max(Math.abs(dx),Math.abs(dy));
        const k=x+','+y;
        if(seen.has(k)) continue;
        seen.add(k);
        queue.push({x,y,d});
      }
    }
    queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,17)-ritualHash(b.x,b.y,17));
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    while(queue.length && cells.length<CLAY_GOLEM_MAX_CLAY){
      const cur=queue.shift();
      cells.push(cur);
      const next=dirs.map(([dx,dy])=>({x:cur.x+dx,y:cur.y+dy,d:Math.max(Math.abs(cur.x+dx-mx),Math.abs(cur.y+dy-my))}))
        .sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,23)-ritualHash(b.x,b.y,23));
      for(const n of next){
        const k=n.x+','+n.y;
        if(seen.has(k)) continue;
        seen.add(k);
        if(tileAt(getTile,n.x,n.y)!==T.WET_CLAY) continue;
        queue.push(n);
      }
      queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,17)-ritualHash(b.x,b.y,17));
    }
    return cells;
  }
  function virtualGetTileAfterClearing(getTile,clearCells){
    const cleared=new Set(clearCells.map(c=>c.x+','+c.y));
    return function(x,y){
      const k=Math.floor(x)+','+Math.floor(y);
      if(cleared.has(k)) return T.AIR;
      return tileAt(getTile,x,y);
    };
  }
  function findClayGolemSpawn(mx,my,clay,getTile,clearCells,seed){
    const probe=makeCompanion({kind:KIND_CLAY_GOLEM,x:mx+0.5,y:my+0.96,clay,seed});
    const gt=virtualGetTileAfterClearing(getTile,clearCells);
    const spots=[
      {x:mx+0.5,y:my+0.96},{x:mx+0.5,y:my+1.96},{x:mx+0.5,y:my-0.04},
      {x:mx-0.5,y:my+0.96},{x:mx+1.5,y:my+0.96},{x:mx-1.5,y:my+0.96},{x:mx+2.5,y:my+0.96}
    ];
    for(const base of spots){
      for(let drop=0;drop<=4;drop++){
        const p={x:base.x,y:base.y+drop};
        if(!inCompanionWorldY(p.y,2,1)) continue;
        if(clearAt(p.x,p.y,probe,gt) && hasFloorFor(probe,p.x,p.y,gt)) return p;
      }
    }
    for(const base of spots){
      if(inCompanionWorldY(base.y,2,1) && clearAt(base.x,base.y,probe,gt)) return base;
    }
    return {x:mx+0.5,y:my+0.96};
  }
  // Ritual anchor lookup. The naive version scanned (2r+1)^2 tiles around every
  // relevant tile change — at r=20 that is 1,681 getTile calls per water-sim move,
  // which dominated frame time near any active water body. The volcano engine
  // already keeps a registry of every master/servant stone (placement, eruption,
  // save restore and near-player adoption all feed it), so query that instead and
  // verify each hit against the live tile. The area scan remains as a fallback for
  // environments without the volcano module (headless sims, tests).
  function ritualStonesNear(x,y,r,getTile,stoneTile){
    const cx=Math.floor(x), cy=Math.floor(y);
    let reg=null;
    try{
      const v=MM.volcano;
      if(v && typeof v.masterStonesNear==='function') reg=v.masterStonesNear(cx,cy,r);
    }catch(e){ reg=null; }
    if(reg){
      const stones=[];
      for(const m of reg){
        if(tileAt(getTile,m.x,m.y)!==stoneTile) continue;
        stones.push({x:m.x,y:m.y});
      }
      // match the row-major order of the area scan so multi-anchor tie-breaks stay stable
      stones.sort((a,b)=>(a.y-b.y)||(a.x-b.x));
      return stones;
    }
    const stones=[];
    const seen=new Set();
    for(let dy=-r;dy<=r;dy++){
      for(let dx=-r;dx<=r;dx++){
        const sx=cx+dx, sy=cy+dy;
        if(tileAt(getTile,sx,sy)!==stoneTile) continue;
        const key=sx+','+sy;
        if(seen.has(key)) continue;
        seen.add(key);
        stones.push({x:sx,y:sy});
      }
    }
    return stones;
  }
  function leafRitualCandidates(x,y,getTile){
    const stones=[];
    const seen=new Set();
    for(const stoneTile of [T.SERVANT_STONE,T.VOLCANO_MASTER_STONE]){
      if(!Number.isFinite(stoneTile)) continue;
      for(const stone of ritualStonesNear(x,y,LEAF_MONSTER_MAX_LEAVES,getTile,stoneTile)){
        const key=stone.x+','+stone.y;
        if(seen.has(key)) continue;
        seen.add(key);
        stones.push(stone);
      }
    }
    stones.sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    return stones;
  }
  function leavesNearRitualStone(sx,sy,getTile){
    const cells=[];
    const seen=new Set();
    const queue=[];
    for(let dy=-2;dy<=2;dy++){
      for(let dx=-2;dx<=2;dx++){
        if(dx===0 && dy===0) continue;
        const x=sx+dx, y=sy+dy;
        if(!isLeaf(tileAt(getTile,x,y))) continue;
        const d=Math.max(Math.abs(dx),Math.abs(dy));
        const k=x+','+y;
        if(seen.has(k)) continue;
        seen.add(k);
        queue.push({x,y,d});
      }
    }
    queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,31)-ritualHash(b.x,b.y,31));
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    while(queue.length && cells.length<LEAF_MONSTER_MAX_LEAVES){
      const cur=queue.shift();
      cells.push(cur);
      const next=dirs.map(([dx,dy])=>({x:cur.x+dx,y:cur.y+dy,d:Math.max(Math.abs(cur.x+dx-sx),Math.abs(cur.y+dy-sy))}))
        .sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,37)-ritualHash(b.x,b.y,37));
      for(const n of next){
        const k=n.x+','+n.y;
        if(seen.has(k)) continue;
        seen.add(k);
        if(!isLeaf(tileAt(getTile,n.x,n.y))) continue;
        queue.push(n);
      }
      queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,31)-ritualHash(b.x,b.y,31));
    }
    return cells;
  }
  function findLeafMonsterSpawn(sx,sy,leaves,getTile,clearCells,seed){
    const probe=makeCompanion({kind:KIND_LEAF_MONSTER,x:sx+0.5,y:sy+0.5,leaves,seed});
    const gt=virtualGetTileAfterClearing(getTile,clearCells);
    const spots=[
      {x:sx+0.5,y:sy+0.5},{x:sx+0.5,y:sy-0.5},{x:sx+0.5,y:sy+1.1},
      {x:sx-0.5,y:sy+0.5},{x:sx+1.5,y:sy+0.5},{x:sx-1.5,y:sy+0.35},{x:sx+2.5,y:sy+0.35}
    ];
    for(const p of spots){
      if(!inCompanionWorldY(p.y,1,0.5)) continue;
      if(clearAt(p.x,p.y,probe,gt)) return p;
    }
    return {x:sx+0.5,y:sy+0.5};
  }
  function waterRitualCandidates(x,y,getTile){
    return ritualStonesNear(x,y,WATER_GOLEM_MAX_WATER,getTile,T.VOLCANO_MASTER_STONE);
  }
  function waterNearMaster(mx,my,getTile){
    const cells=[];
    const seen=new Set();
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    const queue=[];
    for(const [dx,dy] of WATER_GOLEM_CONTACT_OFFSETS){
      const x=mx+dx, y=my+dy;
      if(tileAt(getTile,x,y)!==T.WATER) continue;
      const k=x+','+y;
      if(seen.has(k)) continue;
      seen.add(k);
      queue.push({x,y,d:Math.max(Math.abs(dx),Math.abs(dy))});
    }
    queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,41)-ritualHash(b.x,b.y,41));
    while(queue.length && cells.length<WATER_GOLEM_MAX_WATER){
      const cur=queue.shift();
      cells.push(cur);
      const next=dirs.map(([dx,dy])=>({x:cur.x+dx,y:cur.y+dy,d:Math.abs(cur.x+dx-mx)+Math.abs(cur.y+dy-my)}))
        .sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,43)-ritualHash(b.x,b.y,43));
      for(const n of next){
        const k=n.x+','+n.y;
        if(seen.has(k)) continue;
        seen.add(k);
        if(tileAt(getTile,n.x,n.y)!==T.WATER) continue;
        queue.push(n);
      }
      queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,41)-ritualHash(b.x,b.y,41));
    }
    return cells;
  }
  function masterReplacedWater(m,opts){
    const p=opts && opts.replacedWaterAt;
    if(!p) return 0;
    return Math.floor(p.x)===m.x && Math.floor(p.y)===m.y ? 1 : 0;
  }
  function meatRitualCandidates(x,y,getTile){
    return ritualStonesNear(x,y,MEAT_GOLEM_MAX_MEAT,getTile,T.VOLCANO_MASTER_STONE);
  }
  function meatNearMaster(mx,my,getTile){
    const cells=[];
    const seen=new Set();
    const queue=[];
    for(let dy=-2;dy<=2;dy++){
      for(let dx=-2;dx<=2;dx++){
        if(dx===0 && dy===0) continue;
        const x=mx+dx, y=my+dy;
        if(tileAt(getTile,x,y)!==T.MEAT) continue;
        const d=Math.max(Math.abs(dx),Math.abs(dy));
        const k=x+','+y;
        if(seen.has(k)) continue;
        seen.add(k);
        queue.push({x,y,d});
      }
    }
    queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,47)-ritualHash(b.x,b.y,47));
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    while(queue.length && cells.length<MEAT_GOLEM_MAX_MEAT){
      const cur=queue.shift();
      cells.push(cur);
      const next=dirs.map(([dx,dy])=>({x:cur.x+dx,y:cur.y+dy,d:Math.max(Math.abs(cur.x+dx-mx),Math.abs(cur.y+dy-my))}))
        .sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,53)-ritualHash(b.x,b.y,53));
      for(const n of next){
        const k=n.x+','+n.y;
        if(seen.has(k)) continue;
        seen.add(k);
        if(tileAt(getTile,n.x,n.y)!==T.MEAT) continue;
        queue.push(n);
      }
      queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,47)-ritualHash(b.x,b.y,47));
    }
    return cells;
  }
  function findMeatGolemSpawn(mx,my,meat,getTile,clearCells,seed){
    const probe=makeCompanion({kind:KIND_MEAT_GOLEM,x:mx+0.5,y:my+0.96,meat,seed});
    const gt=virtualGetTileAfterClearing(getTile,clearCells);
    const spots=[
      {x:mx+0.5,y:my+0.96},{x:mx+0.5,y:my-0.04},{x:mx+0.5,y:my+1.96},
      {x:mx-0.5,y:my+0.96},{x:mx+1.5,y:my+0.96},{x:mx-1.5,y:my+0.96},{x:mx+2.5,y:my+0.96}
    ];
    for(const base of spots){
      for(let drop=0;drop<=4;drop++){
        const p={x:base.x,y:base.y+drop};
        if(!inCompanionWorldY(p.y,1,0.5)) continue;
        if(clearAt(p.x,p.y,probe,gt) && hasFloorFor(probe,p.x,p.y,gt)) return p;
      }
    }
    for(const base of spots){
      if(inCompanionWorldY(base.y,1,0.5) && clearAt(base.x,base.y,probe,gt)) return base;
    }
    return {x:mx+0.5,y:my+0.96};
  }
  function findWaterGolemSpawn(mx,my,water,getTile,clearCells,seed){
    const probe=makeCompanion({kind:KIND_WATER_GOLEM,x:mx+0.5,y:my+0.9,water,seed});
    const gt=virtualGetTileAfterClearing(getTile,clearCells);
    const spots=[
      {x:mx+0.5,y:my+0.96},{x:mx+0.5,y:my+1.96},{x:mx+0.5,y:my-0.04},
      {x:mx-0.5,y:my+0.96},{x:mx+1.5,y:my+0.96},{x:mx-1.5,y:my+0.96},{x:mx+2.5,y:my+0.96}
    ];
    for(const base of spots){
      for(let drop=0;drop<=5;drop++){
        const p={x:base.x,y:base.y+drop};
        if(!inCompanionWorldY(p.y,1,0.5)) continue;
        if(clearAt(p.x,p.y,probe,gt) && hasFloorFor(probe,p.x,p.y,gt)) return p;
      }
    }
    for(const base of spots){
      if(inCompanionWorldY(base.y,1,0.5) && clearAt(base.x,base.y,probe,gt)) return base;
    }
    return {x:mx+0.5,y:my+0.96};
  }
  function molekinRitualCandidates(x,y,getTile){
    return ritualStonesNear(x,y,MOLEKIN_MAX_LAVA,getTile,T.VOLCANO_MASTER_STONE);
  }
  function lavaNearMaster(mx,my,getTile){
    const cells=[];
    const seen=new Set();
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    const queue=[];
    for(const [dx,dy] of WATER_GOLEM_CONTACT_OFFSETS){
      const x=mx+dx, y=my+dy;
      if(tileAt(getTile,x,y)!==T.MOTHER_LAVA) continue;
      const k=x+','+y;
      if(seen.has(k)) continue;
      seen.add(k);
      queue.push({x,y,d:Math.max(Math.abs(dx),Math.abs(dy))});
    }
    queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,61)-ritualHash(b.x,b.y,61));
    while(queue.length && cells.length<MOLEKIN_MAX_LAVA){
      const cur=queue.shift();
      cells.push(cur);
      const next=dirs.map(([dx,dy])=>({x:cur.x+dx,y:cur.y+dy,d:Math.abs(cur.x+dx-mx)+Math.abs(cur.y+dy-my)}))
        .sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,67)-ritualHash(b.x,b.y,67));
      for(const n of next){
        const k=n.x+','+n.y;
        if(seen.has(k)) continue;
        seen.add(k);
        if(tileAt(getTile,n.x,n.y)!==T.MOTHER_LAVA) continue;
        queue.push(n);
      }
      queue.sort((a,b)=>a.d-b.d || ritualHash(a.x,a.y,61)-ritualHash(b.x,b.y,61));
    }
    return cells;
  }
  function masterReplacedLava(m,opts){
    const p=opts && opts.replacedMotherLavaAt;
    if(!p) return 0;
    return Math.floor(p.x)===m.x && Math.floor(p.y)===m.y ? 1 : 0;
  }
  function molekinRoleForRitual(seed,lava){
    const preferred = lava>=16 ? ['tank','healer','sniper','sapper','engineer','flanker','rusher','orbiter'] : MOLEKIN_ROLES;
    return preferred[(seed>>>3)%preferred.length] || 'rusher';
  }
  function findMolekinSpawn(mx,my,lava,getTile,clearCells,seed,role){
    const probe=makeCompanion({kind:KIND_MOLEKIN,x:mx+0.5,y:my+0.96,lava,role,seed});
    const gt=virtualGetTileAfterClearing(getTile,clearCells);
    const spots=[
      {x:mx+0.5,y:my+0.96},{x:mx+0.5,y:my-0.04},{x:mx+0.5,y:my+1.96},
      {x:mx-0.5,y:my+0.96},{x:mx+1.5,y:my+0.96},{x:mx-1.5,y:my+0.96},{x:mx+2.5,y:my+0.96}
    ];
    for(const base of spots){
      for(let drop=0;drop<=5;drop++){
        const p={x:base.x,y:base.y+drop};
        if(!inCompanionWorldY(p.y,1,0.5)) continue;
        if(clearAt(p.x,p.y,probe,gt) && (hasFloorFor(probe,p.x,p.y,gt) || drop>=1)) return p;
      }
    }
    for(const base of spots){
      if(inCompanionWorldY(base.y,1,0.5) && clearAt(base.x,base.y,probe,gt)) return base;
    }
    return {x:mx+0.5,y:my+0.96};
  }
  function makeDebugCompanionRoom(){
    if(list.length<MAX_COMPANIONS) return true;
    const removed=list.shift();
    if(removed) say('Debug: usunieto najstarszego pomocnika, zeby zrobic miejsce.');
    return list.length<MAX_COMPANIONS;
  }
  function sayRitualCapacity(opts){
    const t=nowMs();
    if(!(opts && opts.announce) && t-ritualLastCapacitySay<3500) return;
    ritualLastCapacitySay=t;
    say('Nie ma miejsca na kolejnego pomocnika. Zwolnij slot albo uzyj debug clear.');
  }
  function tryClayGolemRitualAt(x,y,getTile,setTile,opts){
    opts=opts||{};
    if(ritualBusy || typeof getTile!=='function' || typeof setTile!=='function') return null;
    if(!Number.isFinite(T.WET_CLAY) || !Number.isFinite(T.VOLCANO_MASTER_STONE)) return null;
    const masters=clayRitualCandidates(x,y,getTile);
    for(const m of masters){
      const clayCells=wetClayNearMaster(m.x,m.y,getTile);
      if(clayCells.length<CLAY_GOLEM_MIN_CLAY) continue;
      if(list.length>=MAX_COMPANIONS){
        if(opts.debugReplace){
          if(!makeDebugCompanionRoom()) return null;
        }else{
          sayRitualCapacity(opts);
          return null;
        }
      }
      const clay=clayCells.length;
      const seed=ritualHash(m.x,m.y,clay ^ Math.floor(nowMs()));
      const clearCells=[{x:m.x,y:m.y},...clayCells];
      const spot=findClayGolemSpawn(m.x,m.y,clay,getTile,clearCells,seed);
      ritualBusy=true;
      try{
        setTile(m.x,m.y,T.AIR);
        for(const c of clayCells) setTile(c.x,c.y,T.AIR);
      }finally{
        ritualBusy=false;
      }
      const golem=makeCompanion({kind:KIND_CLAY_GOLEM,x:spot.x,y:spot.y,clay,seed,facing:1});
      list.push(golem);
      burst(golem.x,golem.y-0.7,'epic');
      sparks(golem.x,golem.y-0.72,'rare',22);
      sfx('charge',golem);
      sayVariant('clay_ritual',[
        '{name} wstal z mokrej gliny i kamienia mistrza.',
        '{name} ulepil sie przy tobie i od razu wyglada, jakby znal regulamin tarczy.',
        '{name} podniosl gliniana glowe. Kamien mistrza jeszcze mu brzeczy w srodku.'
      ],{name:golem.name});
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_CLAY_GOLEM}})); }catch(e){}
      return golem;
    }
    return null;
  }
  function tryLeafMonsterRitualAt(x,y,getTile,setTile,opts){
    opts=opts||{};
    if(ritualBusy || typeof getTile!=='function' || typeof setTile!=='function') return null;
    if(!Number.isFinite(T.SERVANT_STONE) && !Number.isFinite(T.VOLCANO_MASTER_STONE)) return null;
    const stones=leafRitualCandidates(x,y,getTile);
    for(const s of stones){
      const stoneTile=tileAt(getTile,s.x,s.y);
      const stoneName=stoneTile===T.VOLCANO_MASTER_STONE ? 'kamienia mistrza' : 'kamienia slugi';
      const leafCells=leavesNearRitualStone(s.x,s.y,getTile);
      if(leafCells.length<LEAF_MONSTER_MIN_LEAVES) continue;
      if(list.length>=MAX_COMPANIONS){
        if(opts.debugReplace){
          if(!makeDebugCompanionRoom()) return null;
        }else{
          sayRitualCapacity(opts);
          return null;
        }
      }
      const leaves=leafCells.length;
      const seed=ritualHash(s.x,s.y,leaves ^ Math.floor(nowMs()) ^ 0x1eaf);
      const clearCells=[{x:s.x,y:s.y},...leafCells];
      const spot=findLeafMonsterSpawn(s.x,s.y,leaves,getTile,clearCells,seed);
      ritualBusy=true;
      try{
        setTile(s.x,s.y,T.AIR);
        for(const c of leafCells) setTile(c.x,c.y,T.AIR);
      }finally{
        ritualBusy=false;
      }
      const leaf=makeCompanion({kind:KIND_LEAF_MONSTER,x:spot.x,y:spot.y,leaves,seed,facing:1});
      list.push(leaf);
      burst(leaf.x,leaf.y-0.38,'rare');
      sparks(leaf.x,leaf.y-0.42,'common',20);
      sfx('wind',leaf);
      sayVariant('leaf_ritual',[
        '{name} zawirowal z lisci i {stone}.',
        '{name} wyskoczyl z lisci, jakby wiatr przez chwile mial plan.',
        '{name} zaszelescil przysiega: szybko, krucho, po twojej stronie.'
      ],{name:leaf.name,stone:stoneName});
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_LEAF_MONSTER}})); }catch(e){}
      return leaf;
    }
    return null;
  }
  function tryWaterGolemRitualAt(x,y,getTile,setTile,opts){
    opts=opts||{};
    if(ritualBusy || typeof getTile!=='function' || typeof setTile!=='function') return null;
    if(!Number.isFinite(T.VOLCANO_MASTER_STONE) || !Number.isFinite(T.WATER)) return null;
    const masters=waterRitualCandidates(x,y,getTile);
    for(const m of masters){
      const waterCells=waterNearMaster(m.x,m.y,getTile);
      const replacedWater=masterReplacedWater(m,opts);
      const waterMass=waterCells.length+replacedWater;
      if(waterMass<WATER_GOLEM_MIN_WATER) continue;
      if(list.length>=MAX_COMPANIONS){
        if(opts.debugReplace){
          if(!makeDebugCompanionRoom()) return null;
        }else{
          sayRitualCapacity(opts);
          return null;
        }
      }
      const water=Math.min(WATER_GOLEM_MAX_WATER,waterMass);
      const seed=ritualHash(m.x,m.y,water ^ Math.floor(nowMs()) ^ 0x77a7);
      const consumedWaterCells=waterCells.slice(0,Math.max(0,water-replacedWater));
      const clearCells=[{x:m.x,y:m.y},...consumedWaterCells];
      const spot=findWaterGolemSpawn(m.x,m.y,water,getTile,clearCells,seed);
      ritualBusy=true;
      try{
        setTile(m.x,m.y,T.AIR);
        for(const c of consumedWaterCells) setTile(c.x,c.y,T.AIR);
      }finally{
        ritualBusy=false;
      }
      const golem=makeCompanion({kind:KIND_WATER_GOLEM,x:spot.x,y:spot.y,water,seed,facing:1});
      list.push(golem);
      deathFx.push({x:golem.x,y:golem.y-0.55,t:0,max:0.55,color:(golem.genome && golem.genome.highlight) || '#b8f3ff', fill:'rgba(64,184,255,0.22)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(golem.x,golem.y-0.56,'rare',24);
      sfx('hose',golem);
      sayVariant('water_ritual',[
        '{name} wynurzyl sie z wody i kamienia mistrza.',
        '{name} zebral sie w jedna postac, choc przez moment wygladal jak ambitna kaluza.',
        '{name} plusnal na nogi i uznal, ze od teraz twoje problemy beda mokre.'
      ],{name:golem.name});
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_WATER_GOLEM}})); }catch(e){}
      return golem;
    }
    return null;
  }
  function tryMolekinRitualAt(x,y,getTile,setTile,opts){
    opts=opts||{};
    if(ritualBusy || typeof getTile!=='function' || typeof setTile!=='function') return null;
    if(!Number.isFinite(T.VOLCANO_MASTER_STONE) || !Number.isFinite(T.MOTHER_LAVA)) return null;
    if(!fireGuardianDefeated() && !opts.ignoreGuardian && !opts.debugReplace){
      if(opts.announce) say('Rytual kretoludzi milczy. Najpierw pokonaj Wschodniego Fire Guardiana.');
      return null;
    }
    const masters=molekinRitualCandidates(x,y,getTile);
    for(const m of masters){
      const lavaCells=lavaNearMaster(m.x,m.y,getTile);
      const replacedLava=masterReplacedLava(m,opts);
      const lavaTotal=lavaCells.length+replacedLava;
      if(lavaTotal<MOLEKIN_MIN_LAVA) continue;
      if(list.length>=MAX_COMPANIONS){
        if(opts.debugReplace){
          if(!makeDebugCompanionRoom()) return null;
        }else{
          sayRitualCapacity(opts);
          return null;
        }
      }
      const lava=Math.min(MOLEKIN_MAX_LAVA,lavaTotal);
      const seed=ritualHash(m.x,m.y,lava ^ Math.floor(nowMs()) ^ 0xea57111);
      const role=validChoice(String(opts.role || opts.moleRole || molekinRoleForRitual(seed,lava)),MOLEKIN_ROLES,'rusher');
      const consumedLavaCells=lavaCells.slice(0,Math.max(0,lava-replacedLava));
      const clearCells=[{x:m.x,y:m.y},...consumedLavaCells];
      const spot=findMolekinSpawn(m.x,m.y,lava,getTile,clearCells,seed,role);
      ritualBusy=true;
      try{
        setTile(m.x,m.y,T.AIR);
        for(const c of consumedLavaCells) setTile(c.x,c.y,Number.isFinite(T.BASALT)?T.BASALT:(Number.isFinite(T.OBSIDIAN)?T.OBSIDIAN:T.AIR));
      }finally{
        ritualBusy=false;
      }
      const mole=makeCompanion({kind:KIND_MOLEKIN,x:spot.x,y:spot.y,lava,role,seed,facing:1});
      list.push(mole);
      deathFx.push({x:mole.x,y:mole.y-0.48,t:0,max:0.58,color:(mole.genome && mole.genome.accent) || '#ff8b35', fill:'rgba(255,94,34,0.22)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(mole.x,mole.y-0.45,role==='tank'?'epic':'rare',24);
      sfx('fire',mole);
      sayVariant('molekin_ritual',[
        '{name} wylazl z lawy macierzystej po upadku Wschodniego Guardiana. Teraz klania sie Hero-Prostokatowi.',
        '{name} wyszedl z lawy macierzystej, otrzepal popiol i uznal Hero-Prostokat za cieplejszy rozkaz.',
        '{name} przyniosl z glebi dawny zar. Od tej chwili jego tunel prowadzi za bohaterem.'
      ],{name:mole.name});
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_MOLEKIN,role:mole.moleRole}})); }catch(e){}
      return mole;
    }
    return null;
  }
  function tryMeatGolemRitualAt(x,y,getTile,setTile,opts){
    opts=opts||{};
    if(ritualBusy || typeof getTile!=='function' || typeof setTile!=='function') return null;
    if(!Number.isFinite(T.VOLCANO_MASTER_STONE) || !Number.isFinite(T.MEAT)) return null;
    const masters=meatRitualCandidates(x,y,getTile);
    for(const m of masters){
      const meatCells=meatNearMaster(m.x,m.y,getTile);
      if(meatCells.length<MEAT_GOLEM_MIN_MEAT) continue;
      if(list.length>=MAX_COMPANIONS){
        if(opts.debugReplace){
          if(!makeDebugCompanionRoom()) return null;
        }else{
          sayRitualCapacity(opts);
          return null;
        }
      }
      const meat=meatCells.length;
      const seed=ritualHash(m.x,m.y,meat ^ Math.floor(nowMs()) ^ 0x6d337);
      const clearCells=[{x:m.x,y:m.y},...meatCells];
      const spot=findMeatGolemSpawn(m.x,m.y,meat,getTile,clearCells,seed);
      ritualBusy=true;
      try{
        setTile(m.x,m.y,T.AIR);
        for(const c of meatCells){
          setTile(c.x,c.y,T.AIR);
          try{ if(MM.meat && MM.meat.removeMeat) MM.meat.removeMeat(c.x,c.y); }catch(e){}
        }
      }finally{
        ritualBusy=false;
      }
      const golem=makeCompanion({kind:KIND_MEAT_GOLEM,x:spot.x,y:spot.y,meat,seed,facing:1});
      list.push(golem);
      deathFx.push({x:golem.x,y:golem.y-0.55,t:0,max:0.48,color:(golem.genome && golem.genome.highlight) || '#f18a78', fill:'rgba(190,62,55,0.20)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(golem.x,golem.y-0.58,'rare',22);
      sfx('charge',golem);
      sayVariant('meat_ritual',[
        '{name} zerwal sie z miesa i kamienia mistrza. Za piec minut zgnije.',
        '{name} poskladal sie z miesa z niepokojaca determinacja. Zegar gnicia juz tyka.',
        '{name} drgnal, wstal i wyglada, jakby byl swietnym pomyslem tylko przez chwile.'
      ],{name:golem.name});
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_MEAT_GOLEM}})); }catch(e){}
      return golem;
    }
    return null;
  }
  function onTileChanged(x,y,oldTile,newTile,getTile,setTile){
    if(ritualBusy) return false;
    // Register freshly placed anchor stones before the ritual lookup below —
    // this hook can fire before volcano's own onTileChanged sees the placement,
    // and ritualStonesNear trusts that registry.
    if(newTile===T.VOLCANO_MASTER_STONE || newTile===T.SERVANT_STONE){
      try{
        const v=MM.volcano;
        if(v && typeof v.trackMasterStone==='function') v.trackMasterStone(x,y,0,newTile===T.SERVANT_STONE?'servant':'master');
      }catch(e){ /* registry optional */ }
    }
    const clayRelevant=newTile===T.WET_CLAY || newTile===T.VOLCANO_MASTER_STONE || oldTile===T.WET_CLAY || oldTile===T.VOLCANO_MASTER_STONE;
    const leafRelevant=newTile===T.SERVANT_STONE || oldTile===T.SERVANT_STONE || newTile===T.VOLCANO_MASTER_STONE || oldTile===T.VOLCANO_MASTER_STONE || isLeaf(newTile) || isLeaf(oldTile);
    const waterRelevant=newTile===T.WATER || oldTile===T.WATER || newTile===T.VOLCANO_MASTER_STONE || oldTile===T.VOLCANO_MASTER_STONE;
    const lavaRelevant=newTile===T.MOTHER_LAVA || oldTile===T.MOTHER_LAVA || newTile===T.VOLCANO_MASTER_STONE || oldTile===T.VOLCANO_MASTER_STONE;
    const meatRelevant=newTile===T.MEAT || oldTile===T.MEAT || newTile===T.VOLCANO_MASTER_STONE || oldTile===T.VOLCANO_MASTER_STONE;
    if(!clayRelevant && !leafRelevant && !waterRelevant && !lavaRelevant && !meatRelevant) return false;
    const waterOpts=(oldTile===T.WATER && newTile===T.VOLCANO_MASTER_STONE) ? {replacedWaterAt:{x,y}} : null;
    const lavaOpts=(oldTile===T.MOTHER_LAVA && newTile===T.VOLCANO_MASTER_STONE) ? {replacedMotherLavaAt:{x,y}} : null;
    if(lavaOpts) return !!tryMolekinRitualAt(x,y,getTile,setTile,lavaOpts);
    return !!((clayRelevant && tryClayGolemRitualAt(x,y,getTile,setTile)) || (waterRelevant && tryWaterGolemRitualAt(x,y,getTile,setTile,waterOpts)) || (lavaRelevant && tryMolekinRitualAt(x,y,getTile,setTile,lavaOpts)) || (meatRelevant && tryMeatGolemRitualAt(x,y,getTile,setTile)) || (leafRelevant && tryLeafMonsterRitualAt(x,y,getTile,setTile)));
  }
  function spawnFromCraft(player,opts){
    opts=opts||{};
    if(list.length>=MAX_COMPANIONS){
      invAdd(opts.refund || {alienBiomass:opts.biomass||3, meat:opts.meat||2});
      say('Pomocnikow jest juz za duzo. Oddalem skladniki.');
      return null;
    }
    const biomass=clamp(Math.floor(opts.biomass||3),1,MAX_BIOMASS);
    const spot=findSpawnNear(player,opts.getTile,1.35+list.length*0.55);
    const c=makeCompanion({x:spot.x,y:spot.y,biomass,facing:(player && player.facing)||1});
    list.push(c);
    burst(c.x,c.y-0.4,'rare');
    sfx('charge',c);
    sayVariant('bio_craft',[
      '{name} dolaczyl do ciebie. Karm biomasa, jesli ma rosnac.',
      '{name} spojrzal na bohatera jak na chodzaca instrukcje przetrwania.',
      '{name} przylgnal do druzyny. Biomasa brzmi dla niego jak obietnica.'
    ],{name:c.name});
    return c;
  }
  function spawnUfoAlienFromCraft(player,opts){
    opts=opts||{};
    if(!iceGuardianDefeated() && !opts.ignoreGuardian && !opts.debugReplace){
      invAdd(opts.refund || {motherIce:opts.motherIce||UFO_ALIEN_MIN_CONCRETE});
      say('Lod macierzysty milczy. Najpierw pokonaj Zachodniego Ice Guardiana.');
      return null;
    }
    if(list.length>=MAX_COMPANIONS){
      invAdd(opts.refund || {motherIce:opts.motherIce||UFO_ALIEN_MIN_CONCRETE});
      say('Pomocnikow jest juz za duzo. Oddalem lod macierzysty.');
      return null;
    }
    const concrete=ufoConcreteMass({motherIce:opts.motherIce || opts.ufoConcrete || UFO_ALIEN_MIN_CONCRETE});
    const role=validChoice(String(opts.role || opts.ufoRole || UFO_ALIEN_ROLES[Math.floor(Math.random()*UFO_ALIEN_ROLES.length)]),UFO_ALIEN_ROLES,'rusher');
    const probe=makeCompanion({kind:KIND_UFO_ALIEN,x:0,y:0,motherIce:concrete,role});
    const spot=findSpawnNear(player,opts.getTile,1.55+list.length*0.58);
    const c=makeCompanion({kind:KIND_UFO_ALIEN,x:spot.x,y:spot.y,motherIce:concrete,role,facing:(player && player.facing)||1});
    if(!clearAt(c.x,c.y,probe,opts.getTile)){
      c.y=clampCompanionWorldY(c.y-1.1,2,0.15);
    }
    list.push(c);
    deathFx.push({x:c.x,y:c.y-0.52,t:0,max:0.58,color:(c.genome && c.genome.glow) || '#7cf7ff', fill:'rgba(83,105,119,0.24)'});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(c.x,c.y-0.52,c.ufoRole==='commander'?'epic':'rare',24);
    sfx('charge',c);
    sayVariant('ufo_alien_craft',[
      '{name} uznal Hero-Prostokat za nowy oltarz. To najsilniejszy typ kompana.',
      '{name} przelaczyl kult na Hero-Prostokat i udaje, ze nigdy nie lubil starych rozkazow.',
      '{name} niesie lod macierzysty jak przysiege. Wrogowie beda widziec role alien teamu po twojej stronie.'
    ],{name:c.name});
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_UFO_ALIEN,role:c.ufoRole}})); }catch(e){}
    return c;
  }
  function spawnLeafMonsterFromCraft(player,opts){
    opts=opts||{};
    if(list.length>=MAX_COMPANIONS){
      invAdd(opts.refund || {leaf:opts.leaves||8, servantStone:opts.servantStone||1});
      say('Pomocnikow jest juz za duzo. Oddalem liscie i kamien slugi.');
      return null;
    }
    const leaves=leafMass({leaves:opts.leaves || LEAF_MONSTER_MIN_LEAVES});
    const probe=makeCompanion({kind:KIND_LEAF_MONSTER,x:0,y:0,leaves});
    const spot=findLeafMonsterSpawnNear(player,opts.getTile,probe,1.45+list.length*0.45);
    const c=makeCompanion({kind:KIND_LEAF_MONSTER,x:spot.x,y:spot.y,leaves,facing:(player && player.facing)||1});
    list.push(c);
    burst(c.x,c.y-0.35,'rare');
    sparks(c.x,c.y-0.35,'common',18);
    sfx('wind',c);
    say(c.name+' zaszelescil przy tobie. Jest szybki, ale kruchy.');
    return c;
  }
  function findLeafMonsterSpawnNear(player,getTile,probe,offset){
    const px=Number(player && player.x) || 0;
    const py=Number(player && player.y) || 0;
    const dir=(player && player.facing) || -1;
    const baseX=px-dir*(offset||1.45);
    const baseY=py-1.2;
    for(const p of spawnProbeTiles(baseX,baseY)){
      for(let yy=Math.floor(p[1])-2; yy<=Math.floor(p[1])+3; yy++){
        const x=p[0], y=yy+0.5;
        if(!inCompanionWorldY(y,1,0.5)) continue;
        if(clearAt(x,y,probe,getTile)) return {x,y};
      }
    }
    return {x:baseX,y:baseY};
  }
  function scanCompanionRitualsNearPlayer(dt,player,getTile,setTile){
    ritualScanCd-=dt;
    if(ritualScanCd>0 || !player || typeof getTile!=='function' || typeof setTile!=='function') return false;
    ritualScanCd=0.65;
    const px=Math.floor(Number(player.x)||0);
    const py=Math.floor(Number(player.y)||0);
    return !!(tryClayGolemRitualAt(px,py,getTile,setTile) || tryWaterGolemRitualAt(px,py,getTile,setTile) || tryMolekinRitualAt(px,py,getTile,setTile) || tryMeatGolemRitualAt(px,py,getTile,setTile) || tryLeafMonsterRitualAt(px,py,getTile,setTile));
  }
  function nearestCompanion(player,range,predicate){
    if(!list.length || !player) return null;
    let best=null, bd=(range||6)*(range||6);
    for(const c of list){
      if(predicate && !predicate(c)) continue;
      const dx=c.x-player.x, dy=c.y-player.y;
      const d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best=c; }
    }
    return best;
  }
  function growCompanion(c,amount){
    if(!c) return false;
    const add=clamp(Math.floor(amount||1),1,MAX_BIOMASS);
    const before=c.maxHp;
    c.biomass=clamp(c.biomass+add,1,MAX_BIOMASS);
    c.maxHp=maxHpForBiomass(c.biomass);
    c.hp=clamp(c.hp+(c.maxHp-before),1,c.maxHp);
    c.feedPulse=1.0;
    c.genome.plates=clamp(c.genome.plates+((c.biomass%3)===0?1:0),1,7);
    c.genome.horns=clamp(c.genome.horns+((c.biomass%5)===0?1:0),0,5);
    return true;
  }
  function feedNearest(player,amount,opts){
    opts=opts||{};
    const c=nearestCompanion(player,6,c=>!isClayGolem(c) && !isLeafMonster(c) && !isWaterGolem(c) && !isMeatGolem(c) && !isFriedChicken(c) && !isUfoAlien(c) && !isMolekin(c));
    if(!c){
      invAdd(opts.refund || {alienBiomass:amount||1, meat:opts.meat||1});
      say('Nie ma pomocnika w poblizu. Oddalem skladniki.');
      return false;
    }
    growCompanion(c,amount);
    sparks(c.x,c.y-0.55,'rare',14);
    sfx('heal',c);
    say(c.name+' wchlonal biomase. HP '+Math.round(c.hp)+'/'+Math.round(c.maxHp)+'.');
    return true;
  }
  function lineClear(x1,y1,x2,y2,getTile){
    const dx=x2-x1, dy=y2-y1;
    const dist=Math.max(Math.abs(dx),Math.abs(dy));
    const steps=Math.max(2, Math.ceil(dist*3));
    for(let i=1;i<steps;i++){
      const t=i/steps;
      const x=x1+dx*t, y=y1+dy*t;
      const tx=Math.floor(x), ty=Math.floor(y);
      if(tx===Math.floor(x1) && ty===Math.floor(y1)) continue;
      if(tx===Math.floor(x2) && ty===Math.floor(y2)) continue;
      const tile=tileAt(getTile,x,y);
      if(!isHeroPassableTile(tile)) return false;
    }
    return true;
  }
  function exposedHarvestTile(x,y,getTile){
    for(const p of [[1,0],[-1,0],[0,1],[0,-1]]){
      if(passableForCompanion(tileAt(getTile,x+p[0],y+p[1]))) return true;
    }
    return false;
  }
  function canHarvestTileAt(x,y,getTile){
    const t=tileAt(getTile,x,y);
    if(t!==command.harvestTile || t===T.AIR) return false;
    const info=INFO[t] || {};
    if(info.unmineable || isGasTile(t) || info.chestTier || info.machine || info.story) return false;
    return exposedHarvestTile(x,y,getTile);
  }
  function harvestReach(c,x,y,getTile){
    const cx=c.x, cy=c.y-0.55;
    const tx=x+0.5, ty=y+0.5;
    return Math.abs(tx-cx)<=HARVEST_REACH && Math.abs(ty-cy)<=HARVEST_REACH && lineClear(cx,cy,tx,ty,getTile);
  }
  function harvestStandPoint(c,x,y,getTile){
    const spots=[
      {x:x-0.54,y:y+0.96},{x:x+1.54,y:y+0.96},
      {x:x+0.50,y:y-0.08},{x:x+0.50,y:y+1.96},
      {x:x-0.90,y:y+0.30},{x:x+1.90,y:y+0.30}
    ];
    spots.sort((a,b)=>{
      const ad=(a.x-c.x)*(a.x-c.x)+(a.y-c.y)*(a.y-c.y);
      const bd=(b.x-c.x)*(b.x-c.x)+(b.y-c.y)*(b.y-c.y);
      return ad-bd;
    });
    for(const s of spots){
      if(inCompanionWorldY(s.y,1,0.2) && clearAt(s.x,s.y,c,getTile)) return s;
    }
    return {x:x+0.5,y:y+0.96};
  }
  function findHarvestTile(c,player,getTile){
    if(!isHarvestMode() || command.awaiting || command.harvestTile==null) return null;
    const centers=[
      {x:Math.floor(c.x),y:Math.floor(c.y-0.55),bias:0},
      {x:Math.floor((player&&player.x)||c.x),y:Math.floor((player&&player.y)||c.y),bias:4}
    ];
    let best=null, bd=Infinity;
    for(const center of centers){
      for(let r=0;r<=HARVEST_SCAN_RADIUS;r++){
        let foundInRing=false;
        for(let dx=-r;dx<=r;dx++){
          for(let dy=-r;dy<=r;dy++){
            if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
            const x=center.x+dx, y=center.y+dy;
            if(!inCompanionWorldY(y)) continue;
            if(!canHarvestTileAt(x,y,getTile)) continue;
            const d=(x+0.5-c.x)*(x+0.5-c.x)+(y+0.5-(c.y-0.55))*(y+0.5-(c.y-0.55))+center.bias;
            if(d<bd){ bd=d; best={x,y}; foundInRing=true; }
          }
        }
        if(foundInRing && best) break;
      }
    }
    return best;
  }
  function wrapTarget(kind,raw,x,y,hp){
    return {kind,raw,x,y,tx:Math.floor(x),ty:Math.floor(y),hp:hp||1};
  }
  function nearestHostileMobFor(x,y,range){
    const mobsApi=MM.mobs;
    if(!mobsApi) return null;
    const opts={exclude:['ZLOTY'],hostileOnly:true,preferHeroFocus:true};
    if(mobsApi.nearestHostileLiving){
      const mob=mobsApi.nearestHostileLiving(x,y,range,opts);
      return mob && (!mobsApi.isHostile || mobsApi.isHostile(mob)) ? mob : null;
    }
    if(!mobsApi.nearestLiving || !mobsApi.isHostile) return null;
    const mob=mobsApi.nearestLiving(x,y,range,opts);
    return mob && mobsApi.isHostile(mob) ? mob : null;
  }
  function nearestHostile(c,player,getTile){
    const traits=traitsFor(c);
    const sx=c.x, sy=c.y-0.55;
    const options=[];
    try{
      const mob=nearestHostileMobFor(sx,sy,traits.laserRange);
      if(mob && mob.hp>0){
        const mx=Number(mob.x), my=Number(mob.y);
        const heroRadius=traits.archetype==='guardian' ? 9 : (traits.archetype==='sniper' ? 15 : 12);
        const nearHero=player && ((mx-player.x)*(mx-player.x)+(my-player.y)*(my-player.y) < heroRadius*heroRadius);
        const nearSelf=(mx-sx)*(mx-sx)+(my-sy)*(my-sy) < traits.laserRange*traits.laserRange;
        if(Number.isFinite(mx) && Number.isFinite(my) && (nearHero || nearSelf) && lineClear(sx,sy,mx,my,getTile)) options.push(wrapTarget('mob',mob,mx,my,mob.hp));
      }
    }catch(e){}
    try{
      if(MM.bosses && MM.bosses.nearestForTurret){
        const b=MM.bosses.nearestForTurret(sx,sy,traits.laserRange,false);
        if(b && Number.isFinite(b.x) && Number.isFinite(b.y) && lineClear(sx,sy,b.x,b.y,getTile)) options.push(wrapTarget('boss',b,b.x,b.y,b.hp||1));
      }
    }catch(e){}
    try{
      if(MM.guardianLairs && MM.guardianLairs.nearestForTurret){
        const g=MM.guardianLairs.nearestForTurret(sx,sy,traits.laserRange,false);
        if(g && Number.isFinite(g.x) && Number.isFinite(g.y) && lineClear(sx,sy,g.x,g.y,getTile)) options.push(wrapTarget('guardian',g.guardian||g.raw||g,g.x,g.y,g.hp||1));
      }
    }catch(e){}
    try{
      if(MM.undergroundBoss && MM.undergroundBoss.nearestForTurret){
        const u=MM.undergroundBoss.nearestForTurret(sx,sy,traits.laserRange,false);
        if(u && Number.isFinite(u.x) && Number.isFinite(u.y) && lineClear(sx,sy,u.x,u.y,getTile)) options.push(wrapTarget('underground',u.underground||u.raw||u,u.x,u.y,u.hp||1));
      }
    }catch(e){}
    try{
      if(MM.ufo && MM.ufo.current){
        const u=MM.ufo.current();
        if(u && u.hp>0 && Number.isFinite(u.x) && Number.isFinite(u.y)){
          const dx=u.x-sx, dy=u.y-sy;
          if(dx*dx+dy*dy<=traits.laserRange*traits.laserRange && lineClear(sx,sy,u.x,u.y,getTile)) options.push(wrapTarget('ufo',u,u.x,u.y,u.hp));
        }
      }
    }catch(e){}
    let best=null, bd=Infinity;
    for(const t of options){
      const dx=t.x-sx, dy=t.y-sy, d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best=t; }
    }
    return best;
  }
  function nearestFireTarget(c,getTile,range){
    if(!c || !MM.fire || typeof MM.fire.isBurning!=='function') return null;
    const sx=c.x, sy=c.y-0.62;
    const r=Math.ceil(range||5), r2=(range||5)*(range||5);
    let best=null, bd=Infinity;
    for(let y=Math.max(WORLD_TOP,Math.floor(sy)-r); y<=Math.min(WORLD_BOTTOM-1,Math.floor(sy)+r); y++){
      for(let x=Math.floor(sx)-r; x<=Math.floor(sx)+r; x++){
        const cx=x+0.5, cy=y+0.5;
        const dx=cx-sx, dy=cy-sy, d2=dx*dx+dy*dy;
        if(d2>r2 || d2>=bd) continue;
        let burning=false;
        try{ burning=!!MM.fire.isBurning(x,y); }catch(e){ burning=false; }
        if(!burning || !lineClear(sx,sy,cx,cy,getTile)) continue;
        best={kind:'fire',raw:null,x:cx,y:cy,tx:x,ty:y,hp:1};
        bd=d2;
      }
    }
    return best;
  }
  function damageTarget(t,dmg){
    dmg=Number(dmg);
    if(!t || !Number.isFinite(dmg) || dmg<=0) return false;
    let hit=false;
    try{
      if(t.kind==='mob' && MM.mobs && MM.mobs.damageAt) hit=!!MM.mobs.damageAt(t.tx,t.ty,dmg,{source:'companion'});
      else if(t.kind==='guardian' && MM.guardianLairs && MM.guardianLairs.damageAt) hit=!!MM.guardianLairs.damageAt(t.tx,t.ty,dmg);
      else if(t.kind==='underground' && MM.undergroundBoss && MM.undergroundBoss.damageAt) hit=!!MM.undergroundBoss.damageAt(t.tx,t.ty,dmg,{source:'companion'});
      else if(t.kind==='boss' && MM.bosses && MM.bosses.damageAt) hit=!!MM.bosses.damageAt(t.tx,t.ty,dmg);
      else if(t.kind==='ufo' && MM.ufo && MM.ufo.damageAt) hit=!!MM.ufo.damageAt(t.tx,t.ty,dmg);
    }catch(e){}
    return hit;
  }
  function fireLaser(c,target){
    const sx=c.x, sy=c.y-0.62;
    const traits=traitsFor(c);
    const dmg=traits.laserDamage;
    const hit=damageTarget(target,dmg);
    c.facing=target.x>=c.x ? 1 : -1;
    c.lastTarget={x:target.x,y:target.y,t:0.9};
    lasers.push({
      x1:sx,y1:sy,x2:target.x,y2:target.y,
      life:0,max:0.24,hit,
      color:c.genome.laser || '#83f8ff',
      seed:(c.seed ^ Math.floor(nowMs()))>>>0
    });
    if(lasers.length>40) lasers.splice(0,lasers.length-40);
    sparks(target.x,target.y,hit?'rare':'common',hit?10:4);
    sfx('beam',c);
  }
  function ufoAlienSupport(c,dt,player){
    if(!isUfoAlien(c) || ufoAlienRole(c)!=='healer') return false;
    c.attackCd=Math.max(0,(c.attackCd||0)-dt);
    if(c.attackCd>0) return false;
    const traits=traitsFor(c);
    let target=null;
    let bestMissing=0;
    for(const other of list){
      if(other===c || other.hp<=0 || !(other.maxHp>0)) continue;
      const missing=other.maxHp-other.hp;
      if(missing<=1) continue;
      const d=Math.hypot(other.x-c.x,(other.y-0.55)-(c.y-0.55));
      if(d<=traits.laserRange && missing>bestMissing){ target=other; bestMissing=missing; }
    }
    const heroMissing=player && player.maxHp>0 ? (player.maxHp-player.hp) : 0;
    if(heroMissing>bestMissing && Math.hypot(player.x-c.x,(player.y-0.55)-(c.y-0.55))<=traits.laserRange){
      target=player;
      bestMissing=heroMissing;
    }
    if(!target) return false;
    const heal=5.5 + ufoConcreteMass(c)*0.38;
    if(target===player){
      player.hp=Math.min(player.maxHp,player.hp+heal);
    }else{
      healCompanion(target,heal);
      target.feedPulse=Math.max(target.feedPulse||0,0.16);
    }
    const tx=target.x, ty=(target===player ? target.y-0.55 : target.y-0.55);
    c.lastTarget={x:tx,y:ty,t:0.65};
    lasers.push({kind:'heal',x1:c.x,y1:c.y-0.62,x2:tx,y2:ty,life:0,max:0.30,hit:true,color:(c.genome && c.genome.laser) || '#d8ffe8',seed:(c.seed ^ Math.floor(nowMs()) ^ 0x0f0a11e9)>>>0});
    if(lasers.length>48) lasers.splice(0,lasers.length-48);
    sparks(tx,ty,'rare',6);
    sfx('heal',c);
    c.attackCd=1.20;
    c.laserCd=Math.max(c.laserCd||0,0.16);
    return true;
  }
  function molekinSupport(c,dt,player){
    if(!isMolekin(c) || molekinRole(c)!=='healer') return false;
    c.attackCd=Math.max(0,(c.attackCd||0)-dt);
    if(c.attackCd>0) return false;
    const traits=traitsFor(c);
    let target=null;
    let bestMissing=0;
    const heroMissing=player && player.maxHp>0 ? (player.maxHp-player.hp) : 0;
    const heroInRange=heroMissing>1 && Math.hypot(player.x-c.x,(player.y-0.55)-(c.y-0.55))<=traits.laserRange;
    const heroUrgent=heroMissing>=Math.max(8,player && player.maxHp>0 ? player.maxHp*0.08 : 8);
    if(heroInRange && heroUrgent){
      target=player;
      bestMissing=Number.POSITIVE_INFINITY;
    }else if(c.maxHp>0 && c.hp<c.maxHp-1){
      target=c;
      bestMissing=c.maxHp-c.hp;
    }
    for(const other of list){
      if(other===c || other.hp<=0 || !(other.maxHp>0)) continue;
      const missing=other.maxHp-other.hp;
      if(missing<=1 || missing<=bestMissing) continue;
      const d=Math.hypot(other.x-c.x,(other.y-0.55)-(c.y-0.55));
      if(d<=traits.laserRange){ target=other; bestMissing=missing; }
    }
    if(heroInRange && heroMissing>bestMissing){
      target=player;
      bestMissing=heroMissing;
    }
    if(!target) return false;
    const heal=(7.0 + lavaMass(c)*0.42)*(traits.healMult||1);
    if(target===player){
      player.hp=Math.min(player.maxHp,player.hp+heal);
    }else{
      healCompanion(target,heal);
      target.feedPulse=Math.max(target.feedPulse||0,0.18);
    }
    const tx=target.x, ty=target.y-0.55;
    c.lastTarget={x:tx,y:ty,t:0.65};
    lasers.push({kind:'mole_heal',x1:c.x,y1:c.y-0.58,x2:tx,y2:ty,life:0,max:0.30,hit:true,color:(c.genome && c.genome.ember) || '#ffc96f',seed:(c.seed ^ Math.floor(nowMs()) ^ 0xea57111)>>>0});
    if(lasers.length>48) lasers.splice(0,lasers.length-48);
    sparks(tx,ty,'rare',7);
    sfx('heal',c);
    c.attackCd=1.05;
    c.laserCd=Math.max(c.laserCd||0,0.14);
    return true;
  }
  function extinguishFireTarget(tx,ty){
    if(!MM.fire || typeof MM.fire.extinguish!=='function') return false;
    let n=0;
    const cells=[[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    for(const [dx,dy] of cells){
      const x=tx+dx, y=ty+dy;
      try{ if(MM.fire.isBurning && !MM.fire.isBurning(x,y)) continue; }catch(e){}
      try{ if(MM.fire.extinguish(x,y)) n++; }catch(e){}
    }
    return n>0;
  }
  function waterSprayTarget(c,target,getTile){
    const sx=c.x, sy=c.y-0.62;
    const traits=traitsFor(c);
    const dx=target.x-sx, dy=target.y-sy;
    const dist=Math.hypot(dx,dy)||1;
    const nx=dx/dist, ny=dy/dist;
    let hit=false;
    if(target.kind==='fire'){
      hit=extinguishFireTarget(target.tx,target.ty);
    }else{
      hit=damageTarget(target,traits.laserDamage);
      try{ if(MM.mobs && MM.mobs.douseRadius) MM.mobs.douseRadius(target.x,target.y,1.5); }catch(e){}
      const entity=target.raw || target;
      if(entity){
        try{
          entity.vx=(Number(entity.vx)||0)+nx*1.35;
          entity.vy=(Number(entity.vy)||0)+ny*0.30-0.10;
        }catch(e){}
      }
    }
    c.facing=target.x>=c.x ? 1 : -1;
    c.lastTarget={x:target.x,y:target.y,t:0.65};
    c.feedPulse=Math.max(c.feedPulse||0,0.08);
    try{
      if(MM.weapons && typeof MM.weapons.spawnExternalStream==='function'){
        MM.weapons.spawnExternalStream('hose',sx,sy,nx,ny,{range:Math.min(traits.laserRange,dist+0.6),dps:traits.laserDamage,emitScale:1.05,spread:0.20,muzzle:0.30,speedMult:0.92,scale:0.82});
      }
    }catch(e){}
    lasers.push({
      kind:'water',x1:sx,y1:sy,x2:target.x,y2:target.y,
      life:0,max:0.28,hit,color:(c.genome && c.genome.highlight) || '#b8f3ff',
      seed:(c.seed ^ Math.floor(nowMs()) ^ 0x77a7)>>>0
    });
    if(lasers.length>48) lasers.splice(0,lasers.length-48);
    sparks(target.x,target.y,hit?'common':'common',hit?8:3);
    sfx('hose',c);
    return hit;
  }
  function molekinFireStrike(c,target,getTile,setTile){
    const sx=c.x, sy=c.y-0.58;
    const traits=traitsFor(c);
    const role=molekinRole(c);
    const heavy=role==='sapper' || role==='tank' || role==='sniper';
    const dmg=traits.laserDamage*(heavy ? 1.08 : 1);
    const hit=damageTarget(target,dmg);
    c.facing=target.x>=c.x ? 1 : -1;
    c.lastTarget={x:target.x,y:target.y,t:0.70};
    c.feedPulse=Math.max(c.feedPulse||0,0.12);
    if(traits.guardAbsorb>0) c.shieldPulse=Math.max(c.shieldPulse||0,0.14);
    try{ if(MM.mobs && MM.mobs.igniteRadius) MM.mobs.igniteRadius(target.x,target.y,heavy?1.8:1.2,{dur:2.8,dps:1.0+lavaMass(c)*0.04,hostileOnly:true,source:'companion'}); }catch(e){}
    try{
      if(heavy && MM.fire && MM.fire.heatAround && typeof setTile==='function'){
        MM.fire.heatAround(Math.floor(target.x),Math.floor(target.y),getTile,setTile,{includeCenter:true,source:'companion'});
      }
    }catch(e){}
    lasers.push({
      kind:heavy?'mole_lava':'mole_fire',
      x1:sx,y1:sy,x2:target.x,y2:target.y,
      life:0,max:0.28,hit,
      color:(c.genome && (heavy?c.genome.accent:c.genome.ember)) || (heavy?'#ff552e':'#ffc96f'),
      seed:(c.seed ^ Math.floor(nowMs()) ^ 0xea57111)>>>0
    });
    if(lasers.length>48) lasers.splice(0,lasers.length-48);
    sparks(target.x,target.y,hit?'rare':'common',hit?(heavy?12:9):4);
    sfx('fire',c);
    return hit;
  }
  function updateMolekinAction(c,dt,player,getTile,setTile){
    if(!isMolekin(c)) return false;
    // Ghost dread (MM.ghostAura, ACTIVE watchers only): the kretoludzie are brave
    // underground, but a hovering phantom breaks their nerve — they scatter away
    // from the spirit and hold their fire while spooked.
    const dread = MM.ghostDreadAt ? MM.ghostDreadAt(c.x,c.y) : null;
    if(dread){
      c._ghostSpookUntil=(typeof performance!=='undefined'?performance.now():Date.now())+900;
      c.vx=dread.awayX*3.0;
      c.facing=dread.awayX>=0?1:-1;
      c.laserCd=Math.max(c.laserCd||0,0.6);
      c.lastTarget=null;
      return true;
    }
    if(molekinSupport(c,dt,player)) return true;
    c.laserCd=Math.max(0,(c.laserCd||0)-dt);
    const target=nearestHostile(c,player,getTile);
    if(!target){
      c.laserCd=Math.max(c.laserCd,0.14);
      return false;
    }
    if(c.laserCd>0){
      c.lastTarget={x:target.x,y:target.y,t:0.18};
      return true;
    }
    molekinFireStrike(c,target,getTile,setTile);
    c.laserCd=traitsFor(c).laserCooldown*(0.70+Math.random()*0.34);
    return true;
  }
  function heatTouchesMeatGolem(c,getTile){
    if(!isMeatGolem(c) || typeof getTile!=='function') return false;
    const probes=[
      [c.x,c.y-0.08],[c.x,c.y-0.55],[c.x,c.y-companionBodyH(c)*0.82],
      [c.x-0.35,c.y-0.45],[c.x+0.35,c.y-0.45]
    ];
    for(const [px,py] of probes){
      const tx=Math.floor(px), ty=Math.floor(py);
      const t=tileAt(getTile,tx,ty);
      if(t===T.LAVA || t===T.TORCH || t===T.HOT_AIR || t===T.FUEL_GAS) return true;
      try{ if(MM.fire && MM.fire.isBurning && MM.fire.isBurning(tx,ty)) return true; }catch(e){}
    }
    return false;
  }
  function cookMeatGolem(c,reason){
    if(!isMeatGolem(c)) return false;
    const wasRotten=isRottenMeatGolem(c);
    const hpRatio=clamp((Number(c.hp)||1)/Math.max(1,Number(c.maxHp)||maxHpForMeat(meatMass(c))),0.12,1);
    c.kind=KIND_FRIED_MEAT_GOLEM;
    c.name='Pieczony '+(wasRotten?'oczyszczony ':'')+'golem miesny';
    c.maxHp=maxHpForMeat(meatMass(c));
    c.hp=clamp(c.maxHp*hpRatio,1,c.maxHp);
    c.vx*=0.38;
    c.vy=Math.min(c.vy||0,-1.8);
    c.laserCd=0.18;
    c.gasCd=999;
    c.attackCd=0;
    c.feedPulse=1.0;
    c.hitPulse=0;
    c.shieldPulse=0;
    c.lastTarget=null;
    c.harvestX=null;
    c.harvestY=null;
    c.harvestProgress=0;
    deathFx.push({x:c.x,y:c.y-0.42,t:0,max:0.46,color:'#ffd08a',fill:'rgba(255,156,58,0.20)'});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(c.x,c.y-0.42,'common',wasRotten?16:12);
    sfx('fire',c);
    say((wasRotten?'Zombi golem':'Miesny golem')+' upiekl sie i staje po stronie bohatera.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_FRIED_MEAT_GOLEM,reason:reason||'heat'}})); }catch(e){}
    return true;
  }
  function heatAt(tx,ty,getTile,setTile,opts){
    void setTile; void opts;
    for(const c of list){
      if(!isMeatGolem(c)) continue;
      if(Math.abs((tx+0.5)-c.x)<=Math.max(0.9,companionBodyW(c)*0.65) && Math.abs((ty+0.5)-(c.y-0.55))<=Math.max(1.0,companionBodyH(c)*0.68)){
        return cookMeatGolem(c,'heat');
      }
    }
    return false;
  }
  function rotMeatGolem(c){
    if(!isRawMeatGolem(c) || c.age<MEAT_GOLEM_ROT_SECONDS) return false;
    c.kind=KIND_ROTTEN_MEAT_GOLEM;
    c.name=meatGolemName(c.genome,true);
    c.laserCd=0;
    c.attackCd=0;
    c.feedPulse=1.0;
    c.hitPulse=0.25;
    c.lastTarget=null;
    c.harvestX=null;
    c.harvestY=null;
    c.harvestProgress=0;
    deathFx.push({x:c.x,y:c.y-0.52,t:0,max:0.52,color:(c.genome && c.genome.rot) || '#6f7f35',fill:'rgba(82,112,45,0.22)',leaf:true});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(c.x,c.y-0.52,'common',18);
    sfx('hurt',c);
    say(c.name+' zgnil i rzucil sie na bohatera.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_ROTTEN_MEAT_GOLEM}})); }catch(e){}
    return true;
  }
  function meatGolemStrike(c,target){
    if(!isFriendlyMeatGolem(c) || !target) return false;
    const sx=c.x, sy=c.y-0.50;
    const dx=target.x-sx, dy=target.y-sy;
    const d=Math.hypot(dx,dy)||1;
    c.facing=dx>=0 ? 1 : -1;
    c.lastTarget={x:target.x,y:target.y,t:0.55};
    if(d>1.45){
      c.vx+=clamp(dx*2.8,-3.2,3.2);
      if(c.grounded && dy<-0.25) c.vy=Math.min(c.vy,traitsFor(c).jump*0.75);
      return false;
    }
    const hit=damageTarget(target,traitsFor(c).laserDamage);
    c.vx+=clamp(dx,-1,1)*1.35;
    c.vy=Math.min(c.vy||0,-1.2);
    c.feedPulse=Math.max(c.feedPulse||0,0.16);
    sparks(target.x,target.y,hit?'rare':'common',hit?10:4);
    sfx('hit',target);
    return hit;
  }
  function updateMeatGolemAction(c,dt,player,getTile){
    if(!isFriendlyMeatGolem(c)) return false;
    c.laserCd=Math.max(0,(c.laserCd||0)-dt);
    const target=nearestHostile(c,player,getTile);
    if(!target){
      c.laserCd=Math.max(c.laserCd,0.08);
      return false;
    }
    if(c.laserCd>0){
      c.lastTarget={x:target.x,y:target.y,t:0.18};
      return true;
    }
    meatGolemStrike(c,target);
    c.laserCd=traitsFor(c).laserCooldown*(0.75+Math.random()*0.35);
    return true;
  }
  function hurtHeroFromRottenGolem(c,player){
    if(!isRottenMeatGolem(c) || !player) return false;
    const traits=traitsFor(c);
    const srcX=c.x, srcY=c.y-0.45;
    let ok=false;
    try{
      if(typeof root.damageHero==='function') ok=!!root.damageHero(traits.laserDamage,{srcX,srcY,cause:'rotten_meat_golem',kb:4.2,kbY:-3.2,invulMs:520});
    }catch(e){ ok=false; }
    if(!ok && typeof player.hp==='number'){
      player.hp=Math.max(0,player.hp-traits.laserDamage);
      ok=true;
    }
    if(ok){
      player.vx=(Number(player.vx)||0)+(player.x>=c.x?1:-1)*3.0;
      player.vy=Math.min(Number(player.vy)||0,-2.8);
      c.feedPulse=Math.max(c.feedPulse||0,0.20);
      c.lastTarget={x:player.x,y:player.y-0.45,t:0.45};
      sparks(player.x,player.y-0.55,'common',8);
      sfx('hurt',c);
    }
    return ok;
  }
  function updateRottenMeatGolemAction(c,dt,player){
    if(!isRottenMeatGolem(c) || !player) return false;
    c.attackCd=Math.max(0,(c.attackCd||0)-dt);
    const dx=player.x-c.x, dy=(player.y-0.45)-(c.y-0.52);
    const d2=dx*dx+dy*dy;
    c.facing=dx>=0 ? 1 : -1;
    c.lastTarget={x:player.x,y:player.y-0.45,t:0.20};
    if(d2<=1.22*1.22 && c.attackCd<=0){
      hurtHeroFromRottenGolem(c,player);
      c.attackCd=MEAT_GOLEM_ZOMBIE_ATTACK_SECONDS;
    }
    return true;
  }
  function tryConsumeFriedMeatGolem(c,player){
    if(!isFriedMeatGolem(c) || !player) return false;
    const maxHp=Math.max(1,Number(player.maxHp)||100);
    const before=Math.max(0,Number(player.hp)||0);
    if(before>=maxHp-0.5) return false;
    const dx=c.x-player.x, dy=(c.y-0.55)-(player.y-0.48);
    const reachX=(Number(player.w)||0.7)*0.5+0.42;
    const reachY=(Number(player.h)||0.95)*0.5+0.42;
    if(Math.abs(dx)>reachX || Math.abs(dy)>reachY) return false;
    const golemRatio=clamp((Number(c.hp)||0)/Math.max(1,Number(c.maxHp)||1),0,1);
    const heal=maxHp*FRIED_MEAT_GOLEM_HEAL_RATIO*golemRatio;
    if(!(heal>0)) return false;
    player.hp=Math.min(maxHp,before+heal);
    const i=list.indexOf(c);
    if(i>=0) list.splice(i,1);
    deathFx.push({x:c.x,y:c.y-0.48,t:0,max:0.42,color:'#ffd98c',fill:'rgba(255,210,122,0.18)'});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(c.x,c.y-0.48,'rare',12);
    sfx('heal',c);
    say('Pieczony golem: +' + Math.round(player.hp-before) + ' HP.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_FRIED_MEAT_GOLEM,consumed:true,heal:Math.round(player.hp-before)}})); }catch(e){}
    return true;
  }
  function emitPoison(c,getTile,setTile){
    const traits=traitsFor(c);
    const power=(0.18+Math.min(0.22,c.biomass*0.012))*traits.poisonPower;
    try{ if(MM.gases && MM.gases.add) MM.gases.add('poison',c.x,c.y-0.35,{power,cells:1,getTile,setTile}); }catch(e){}
    try{ if(MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(c.x,c.y-0.35,1.55,{dur:3.0,dps:1.0+Math.min(2.2,c.biomass*0.08),hostileOnly:true,source:'companion'}); }catch(e){}
  }
  function healCompanion(c,amount){
    if(!c || !(amount>0)) return false;
    const before=c.hp;
    c.hp=clamp(c.hp+amount,1,c.maxHp);
    if(c.hp>before){
      c.feedPulse=Math.max(c.feedPulse||0,0.18);
      return true;
    }
    return false;
  }
  function leafMonsterNeedsFeeding(c){
    if(!isLeafMonster(c) || !(c.maxHp>0)) return false;
    const ratio=c.hp/c.maxHp;
    return ratio < (c.leafFeeding ? LEAF_MONSTER_FEED_STOP_RATIO : LEAF_MONSTER_FEED_LOW_RATIO);
  }
  function findLeafForFeeding(c,getTile,radius){
    if(!isLeafMonster(c) || typeof getTile!=='function') return null;
    const bx=Math.floor(c.x), by=Math.floor(c.y-0.45);
    const maxR=Math.max(1,Math.floor(radius || LEAF_MONSTER_FEED_SCAN_RADIUS));
    let best=null, bd=Infinity;
    for(let r=0;r<=maxR;r++){
      for(let dy=-r;dy<=r;dy++){
        for(let dx=-r;dx<=r;dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const x=bx+dx, y=by+dy;
          if(!isLeaf(tileAt(getTile,x,y))) continue;
          const cx=x+0.5, cy=y+0.5;
          const d=(cx-c.x)*(cx-c.x)+(cy-(c.y-0.45))*(cy-(c.y-0.45));
          if(d<bd){ bd=d; best={x,y,d}; }
        }
      }
      if(best && r>=2) break;
    }
    return best;
  }
  function leafFeedingTarget(c,getTile){
    if(!leafMonsterNeedsFeeding(c)){
      c.leafFeeding=false;
      c.leafFeedTarget=null;
      return null;
    }
    const old=c.leafFeedTarget;
    if(old && isLeaf(tileAt(getTile,old.x,old.y))){
      c.leafFeeding=true;
      return old;
    }
    const target=findLeafForFeeding(c,getTile,LEAF_MONSTER_FEED_SCAN_RADIUS);
    c.leafFeedTarget=target ? {x:target.x,y:target.y} : null;
    c.leafFeeding=!!target;
    return c.leafFeedTarget;
  }
  function consumeLeafForFeeding(c,getTile,setTile){
    if(!leafMonsterNeedsFeeding(c) || typeof getTile!=='function' || typeof setTile!=='function') return false;
    let target=c.leafFeedTarget && isLeaf(tileAt(getTile,c.leafFeedTarget.x,c.leafFeedTarget.y)) ? c.leafFeedTarget : null;
    if(!target) target=findLeafForFeeding(c,getTile,2);
    if(!target) return false;
    const cx=target.x+0.5, cy=target.y+0.5;
    const bodyY=c.y-0.45;
    if((cx-c.x)*(cx-c.x)+(cy-bodyY)*(cy-bodyY)>1.65*1.65) return false;
    setTile(target.x,target.y,T.AIR);
    healCompanion(c,c.maxHp*LEAF_MONSTER_FEED_HEAL_RATIO);
    c.leafFeedCd=LEAF_MONSTER_FEED_SECONDS;
    c.leafFeedTarget=null;
    c.leafFeeding=leafMonsterNeedsFeeding(c);
    c.feedPulse=Math.max(c.feedPulse||0,0.34);
    c.lastTarget={x:cx,y:cy,t:0.35};
    deathFx.push({x:cx,y:cy,t:0,max:0.30,color:(c.genome && c.genome.edge) || '#80e85f',fill:'rgba(104,190,70,0.16)',leaf:true});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(cx,cy,'common',5);
    return true;
  }
  function updateLeafMonsterFeeding(c,dt,getTile,setTile){
    if(!isLeafMonster(c)) return false;
    c.leafFeedCd=Math.max(0,(c.leafFeedCd||0)-dt);
    const target=leafFeedingTarget(c,getTile);
    if(!target) return false;
    c.lastTarget={x:target.x+0.5,y:target.y+0.5,t:0.20};
    if(c.leafFeedCd>0) return true;
    consumeLeafForFeeding(c,getTile,setTile);
    return true;
  }
  function consumeWaterNear(c,getTile,setTile){
    if(!isWaterGolem(c) || typeof getTile!=='function' || typeof setTile!=='function') return false;
    const bx=Math.floor(c.x), by=Math.floor(c.y-0.35);
    let best=null, bd=Infinity;
    for(let r=0;r<=3;r++){
      for(let dy=-r;dy<=r;dy++){
        for(let dx=-r;dx<=r;dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const x=bx+dx, y=by+dy;
          if(tileAt(getTile,x,y)!==T.WATER) continue;
          const d=dx*dx+dy*dy;
          if(d<bd){ bd=d; best={x,y}; }
        }
      }
      if(best) break;
    }
    if(!best) return false;
    setTile(best.x,best.y,T.AIR);
    healCompanion(c,traitsFor(c).waterDrink);
    c.wateredT=1.8;
    c.feedPulse=Math.max(c.feedPulse||0,0.24);
    deathFx.push({x:best.x+0.5,y:best.y+0.5,t:0,max:0.30,color:'#b8f3ff',fill:'rgba(64,184,255,0.18)'});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(best.x,best.y,getTile); }catch(e){}
    return true;
  }
  function applyEnvironmentDamage(c,dt,getTile,setTile){
    const feet=tileAt(getTile,c.x,c.y-0.05);
    const body=tileAt(getTile,c.x,c.y-0.55);
    let dps=0;
    if(isWaterGolem(c)){
      const inWater=feet===T.WATER || body===T.WATER;
      c.wateredT=Math.max(0,(c.wateredT||0)-dt);
      c.waterDrinkCd=Math.max(0,(c.waterDrinkCd||0)-dt);
      if(inWater){
        c.wateredT=1.8;
        healCompanion(c,dt*(3.4+waterMass(c)*0.12));
      }else{
        dps+=WATER_GOLEM_DRY_BASE_DPS + waterMass(c)*0.34;
      }
      if(feet===T.LAVA || body===T.LAVA) dps+=40;
      if(body===T.HOT_AIR || body===T.FUEL_GAS) dps+=8.5;
      if(c.waterDrinkCd<=0 && (c.hp<c.maxHp*0.92 || !inWater)){
        if(consumeWaterNear(c,getTile,setTile)){
          c.waterDrinkCd=WATER_GOLEM_DRINK_SECONDS;
        }else{
          c.waterDrinkCd=0.18;
        }
      }
    }else if(isLeafMonster(c)){
      if(feet===T.WATER || body===T.WATER) dps+=4.2;
      if(feet===T.LAVA || body===T.LAVA) dps+=42;
      if(body===T.FUEL_GAS || body===T.HOT_AIR || body===T.STEAM) dps+=6.5;
    }else if(isClayGolem(c)){
      if(feet===T.WATER || body===T.WATER || feet===T.WET_CLAY || body===T.WET_CLAY) healCompanion(c,dt*(1.0+clayMass(c)*0.035));
      if(feet===T.LAVA || body===T.LAVA) dps+=28;
      if(body===T.FUEL_GAS || body===T.HOT_AIR) dps+=4.8;
    }else if(isUfoAlien(c)){
      if(feet===T.LAVA || body===T.LAVA) dps+=9.5;
      if(body===T.FUEL_GAS || body===T.HOT_AIR) dps+=1.2;
      if(feet===T.MOTHER_ICE || body===T.MOTHER_ICE || feet===T.ICE || body===T.ICE) healCompanion(c,dt*(2.4+ufoConcreteMass(c)*0.08));
    }else if(isMolekin(c)){
      if(feet===T.MOTHER_LAVA || body===T.MOTHER_LAVA) healCompanion(c,dt*(5.2+lavaMass(c)*0.16));
      else if(feet===T.LAVA || body===T.LAVA) healCompanion(c,dt*(2.2+lavaMass(c)*0.06));
      if(body===T.HOT_AIR || body===T.FUEL_GAS || body===T.STEAM) healCompanion(c,dt*(0.9+lavaMass(c)*0.035));
      if(feet===T.WATER || body===T.WATER) dps+=6.5;
    }else{
      if(feet===T.LAVA || body===T.LAVA) dps+=20;
      if(body===T.FUEL_GAS || body===T.HOT_AIR) dps+=1.8;
    }
    if(dps>0) damage(c,dps*dt,'env');
    c.hurtCd=Math.max(0,c.hurtCd-dt);
    if(c.hurtCd<=0){
      let mob=null;
      try{ mob=nearestHostileMobFor(c.x,c.y-0.45,0.9); }catch(e){ mob=null; }
      if(mob && mob.hp>0){
        c.hurtCd=0.75;
        c.vx += (c.x<(mob.x||c.x) ? -1 : 1)*3.0;
        damage(c,3.5,'bite');
      }
    }
  }
  function damage(c,amount,reason){
    amount=Number(amount);
    if(!Number.isFinite(amount)) return false;
    if(!c || amount<=0) return false;
    if(isClayGolem(c)){
      const hot=reason==='env' || reason==='fire' || reason==='lava';
      amount*=hot ? 0.92 : (reason==='guard' ? 0.58 : 0.64);
    }
    if(isUfoAlien(c)){
      const hot=reason==='env' || reason==='fire' || reason==='lava';
      amount*=hot ? 0.62 : (reason==='guard' ? 0.45 : 0.50);
    }
    if(isMolekin(c)){
      const hot=reason==='env' || reason==='fire' || reason==='lava';
      amount*=hot ? 0.30 : (reason==='guard' ? 0.46 : 0.54);
    }
    c.hp-=amount;
    c.hitPulse=0.25;
    if(isClayGolem(c)) c.shieldPulse=Math.max(c.shieldPulse||0,0.18);
    if(isMolekin(c) && traitsFor(c).guardAbsorb>0) c.shieldPulse=Math.max(c.shieldPulse||0,0.16);
    if(c.hp<=0){
      kill(c,reason||'damage');
      return true;
    }
    return false;
  }
  function kill(c){
    const i=list.indexOf(c);
    if(i>=0) list.splice(i,1);
    if(isFriedMeatGolem(c)){
      deathFx.push({x:c.x,y:c.y-0.48,t:0,max:0.42,color:'#ffd98c', fill:'rgba(255,210,122,0.16)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(c.x,c.y-0.48,'common',10);
      return true;
    }
    if(isMeatGolem(c)){
      const rotten=isRottenMeatGolem(c);
      deathFx.push({x:c.x,y:c.y-0.48,t:0,max:0.50,color:rotten ? ((c.genome && c.genome.rot) || '#6f7f35') : ((c.genome && c.genome.highlight) || '#f18a78'), fill:rotten ? 'rgba(82,112,45,0.22)' : 'rgba(190,62,55,0.18)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(c.x,c.y-0.44,'common',rotten?14:12);
      sfx('hurt',c);
      return true;
    }
    if(isWaterGolem(c)){
      deathFx.push({x:c.x,y:c.y-0.48,t:0,max:0.52,color:(c.genome && c.genome.highlight) || '#b8f3ff', fill:'rgba(64,184,255,0.20)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(c.x,c.y-0.42,'common',18);
      sfx('splash',c);
      say(c.name+' rozlal sie w plytka kaluze.');
      return;
    }
    if(isLeafMonster(c)){
      deathFx.push({x:c.x,y:c.y-0.36,t:0,max:0.48,color:(c.genome && c.genome.edge) || '#74d94f', fill:'rgba(86,150,58,0.18)', leaf:true});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      burst(c.x,c.y-0.30,'common');
      sparks(c.x,c.y-0.34,'common',14);
      sfx('break',c);
      say(c.name+' rozsypal sie w suche liscie.');
      return;
    }
    if(isClayGolem(c)){
      deathFx.push({x:c.x,y:c.y-0.58,t:0,max:0.65,color:(c.genome && c.genome.core) || '#ff7b2f', fill:'rgba(120,82,48,0.24)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      burst(c.x,c.y-0.45,'rare');
      sfx('break',c);
      say(c.name+' opadl w ciezkie bryly mokrej gliny.');
      return;
    }
    if(isUfoAlien(c)){
      deathFx.push({x:c.x,y:c.y-0.52,t:0,max:0.62,color:(c.genome && c.genome.glow) || '#7cf7ff', fill:'rgba(83,105,119,0.24)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(c.x,c.y-0.45,c.ufoRole==='commander'?'epic':'rare',20);
      sfx('break',c);
      say(c.name+' pekl w odlamki lodu macierzystego.');
      return;
    }
    if(isMolekin(c)){
      deathFx.push({x:c.x,y:c.y-0.46,t:0,max:0.58,color:(c.genome && c.genome.accent) || '#ff8b35', fill:'rgba(255,90,28,0.22)'});
      if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
      sparks(c.x,c.y-0.42,'rare',18);
      sfx('fire',c);
      say(c.name+' zapadl sie w goracy popiol.');
      return;
    }
    const traits=traitsFor(c);
    const r=(2.2+Math.min(1.4,c.biomass*0.04))*traits.death;
    damageBlastCreatures(MM,c.x,c.y-0.35,r,(8+Math.min(18,c.biomass*0.8))*traits.death,{hostileOnly:true,source:'companion',cause:'companion_blast'});
    try{ if(MM.gases && MM.gases.add) MM.gases.add('poison',c.x,c.y-0.3,{power:0.9*traits.poisonPower,cells:4}); }catch(e){}
    deathFx.push({x:c.x,y:c.y-0.45,t:0,max:0.55,color:c.genome.glow});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    burst(c.x,c.y-0.35,'epic');
    sfx('explosion',c);
    say(c.name+' rozpadl sie w zielonym blysku.');
  }
  function clayGolemStrike(c,target){
    const traits=traitsFor(c);
    const dmg=traits.laserDamage;
    const hit=damageTarget(target,dmg);
    c.facing=target.x>=c.x ? 1 : -1;
    c.lastTarget={x:target.x,y:target.y,t:0.55};
    c.guardCd=traits.laserCooldown*(0.82+Math.random()*0.28);
    c.feedPulse=Math.max(c.feedPulse||0,0.16);
    sparks(target.x,target.y,hit?'rare':'common',hit?9:4);
    sfx('break',target);
    return hit;
  }
  function updateClayGolemGuard(c,dt,player,getTile){
    c.guardCd=Math.max(0,(c.guardCd||0)-dt);
    if(c.guardCd>0) return false;
    const target=nearestHostile(c,player,getTile);
    if(!target) return false;
    const dx=target.x-c.x, dy=target.y-(c.y-0.58);
    const range=traitsFor(c).laserRange;
    if(dx*dx+dy*dy>range*range) return false;
    return clayGolemStrike(c,target);
  }
  function updateLeafMonsterAttack(c,dt,player,getTile){
    c.laserCd-=dt;
    if(c.laserCd>0) return false;
    const target=nearestHostile(c,player,getTile);
    if(target){
      fireLaser(c,target);
      c.feedPulse=Math.max(c.feedPulse||0,0.12);
      c.laserCd=traitsFor(c).laserCooldown*(0.72+Math.random()*0.35);
      return true;
    }
    c.laserCd=0.20;
    return false;
  }
  function updateWaterGolemAction(c,dt,player,getTile){
    c.laserCd-=dt;
    if(c.laserCd>0) return false;
    const traits=traitsFor(c);
    const fire=nearestFireTarget(c,getTile,traits.laserRange+1.6);
    const target=fire || nearestHostile(c,player,getTile);
    if(target){
      waterSprayTarget(c,target,getTile);
      c.laserCd=traits.laserCooldown*(0.72+Math.random()*0.34);
      return true;
    }
    c.laserCd=0.18;
    return false;
  }
  function nearestGuardCompanionToHero(player,range){
    if(!player) return null;
    let best=null, bd=(range||CLAY_GOLEM_GUARD_RADIUS)*(range||CLAY_GOLEM_GUARD_RADIUS);
    for(const c of list){
      if(c.hp<=0 || (!isClayGolem(c) && !isUfoAlien(c) && !isMolekin(c))) continue;
      const traits=traitsFor(c);
      if(!(traits.guardAbsorb>0)) continue;
      const dx=c.x-player.x, dy=(c.y-0.6)-player.y;
      const d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best=c; }
    }
    return best;
  }
  function absorbHeroDamage(amount,opts,player){
    opts=opts||{};
    if(!(amount>0) || opts.ignoreCompanionGuard) return {amount,absorbed:0};
    const cause=String(opts.cause||'');
    if(cause==='drowning' || cause==='rotten_meat' || cause==='hunger') return {amount,absorbed:0};
    const golem=nearestGuardCompanionToHero(player,CLAY_GOLEM_GUARD_RADIUS+2.6);
    if(!golem) return {amount,absorbed:0};
    const traits=traitsFor(golem);
    const absorbed=Math.min(amount, amount*traits.guardAbsorb);
    if(absorbed<=0) return {amount,absorbed:0};
    damage(golem,absorbed,'guard');
    golem.feedPulse=Math.max(golem.feedPulse||0,0.25);
    golem.shieldPulse=Math.max(golem.shieldPulse||0,0.45);
    sparks(golem.x,golem.y-0.8,'rare',8);
    return {amount:Math.max(0,amount-absorbed),absorbed,golem};
  }
  function teleportToHero(c,player,getTile,offset,announce){
    if(!c || !player) return false;
    const spot=(isClayGolem(c) || isUfoAlien(c) || isMolekin(c))
      ? findSpawnNearFor(c,player,getTile,offset||1.8)
      : (isLeafMonster(c) ? findLeafMonsterSpawnNear(player,getTile,c,offset||1.45) : findSpawnNear(player,getTile,offset||1.15));
    c.x=spot.x; c.y=spot.y; c.vx=0; c.vy=0;
    c.feedPulse=0.55;
    if(isClayGolem(c)){
      c.shieldPulse=Math.max(c.shieldPulse||0,0.42);
      c.stuckT=0;
      burst(c.x,c.y-0.55,'rare');
      if(announce) say(c.name+' uformowal sie z powrotem przy bohaterze.');
      return true;
    }
    burst(c.x,c.y-0.45,'rare');
    const cost=Math.max(1,c.maxHp*((isUfoAlien(c) || isMolekin(c)) ? 0.035 : 0.10));
    const survived=!damage(c,cost,'catchup');
    if(survived && announce) say(c.name+' nadwyrezyl sie, doganiajac bohatera '+((isUfoAlien(c) || isMolekin(c))?'(-3.5% HP).':'(-10% HP).'));
    return survived || list.indexOf(c)<0;
  }
  function windAtForLeaf(c,getTile){
    const windApi=root.MM && root.MM.wind;
    if(!windApi) return {speed:0, exposure:1};
    let speed=0, exposure=1;
    try{
      if(typeof windApi.speedAt==='function') speed=Number(windApi.speedAt(c.x,c.y-0.35,getTile)) || 0;
      else if(typeof windApi.speed==='function') speed=Number(windApi.speed()) || 0;
    }catch(e){ speed=0; }
    try{
      if(typeof windApi.exposureAt==='function') exposure=Number(windApi.exposureAt(c.x,c.y-0.35,getTile));
    }catch(e){ exposure=1; }
    if(!Number.isFinite(exposure)) exposure=1;
    return {speed, exposure:clamp(exposure,0,1)};
  }
  function transportControls(opts){
    const c=opts && opts.controls;
    return {
      left:!!(c && c.left),
      right:!!(c && c.right),
      up:!!(c && c.up),
      down:!!(c && c.down),
      jump:!!(c && c.jump),
      turbo:!!(c && c.turbo)
    };
  }
  function leafTransportSeatY(c,player){
    const ph=Math.max(0.55,Number(player && player.h)||0.95);
    return c.y - companionBodyH(c) - ph*0.5 - 0.01;
  }
  function leafTransportCanMount(c,player){
    if(!isTransportMode() || !isLeafMonster(c) || !player || c.hp<=0) return false;
    if(!Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return false;
    const pw=Math.max(0.35,Number(player.w)||0.7);
    const ph=Math.max(0.55,Number(player.h)||0.95);
    const top=c.y-companionBodyH(c);
    const bottom=Number(player.y)+ph*0.5;
    const dx=Math.abs(Number(player.x)-c.x);
    const maxDx=pw*0.5+companionBodyW(c)*0.48+0.24;
    if(dx>maxDx) return false;
    if((c.transportRideT||0)>0 && Math.abs(bottom-top)<0.92) return true;
    return bottom>=top-0.52 && bottom<=top+0.34;
  }
  function drainLeafTransportHealth(c,dt){
    if(!isLeafMonster(c) || !(c.maxHp>0)) return false;
    c.hp-=c.maxHp*LEAF_MONSTER_TRANSPORT_DRAIN_RATIO*Math.max(0,dt||0);
    c.transportPulse=Math.max(c.transportPulse||0,0.18);
    if(c.hp<=0){
      kill(c,'transport');
      return true;
    }
    return false;
  }
  function snapHeroToLeafTransport(c,player){
    if(!player) return;
    player.x=c.x;
    player.y=leafTransportSeatY(c,player);
    player.vx=c.vx;
    player.vy=c.vy;
    player.onGround=true;
    player.jumpCount=0;
    player._leafTransportId=c.id || c.seed || true;
  }
  function updateLeafMonsterTransport(c,dt,player,getTile,setTile,opts,traits){
    if(!leafTransportCanMount(c,player)){
      c.transportMounted=false;
      return false;
    }
    const controls=transportControls(opts);
    if(controls.down && controls.jump){
      c.transportMounted=false;
      c.transportRideT=0;
      if(player){
        player._leafTransportId=null;
        player.vy=Math.min(Number(player.vy)||0,-4.2);
        player.onGround=false;
      }
      return false;
    }
    c.transportMounted=true;
    command.transportBadgeT=0;
    c.transportRideT=0.24;
    c.leafFeeding=false;
    c.leafFeedTarget=null;
    c.harvestX=null;
    c.harvestY=null;
    c.harvestProgress=0;
    if(drainLeafTransportHealth(c,dt)) return true;
    const wind=windAtForLeaf(c,getTile);
    const ix=(controls.right?1:0)-(controls.left?1:0);
    const iy=(controls.down?1:0)-((controls.up||controls.jump)?1:0);
    const speedMul=controls.turbo ? 1.14 : 1;
    const desiredX=ix*traits.speed*0.86*speedMul;
    const desiredY=iy*traits.speed*0.66*speedMul;
    c.vx+=clamp(desiredX-c.vx,-traits.accel*dt*1.05,traits.accel*dt*1.05);
    c.vy+=clamp(desiredY-c.vy,-traits.accel*dt*0.92,traits.accel*dt*0.92);
    const windForce=wind.speed*wind.exposure*traits.windResponse;
    c.vx+=windForce*dt*0.92;
    c.vy+=Math.sin(c.age*10.5+(c.seed||0))*Math.abs(windForce)*0.055*dt;
    c.vx*=Math.pow(ix ? 0.88 : 0.72,dt*8);
    c.vy*=Math.pow(iy ? 0.88 : 0.76,dt*8);
    if(ix) c.facing=ix>0 ? 1 : -1;
    c.grounded=false;
    c.flying=true;
    moveAxis(c,c.vx*dt,'x',getTile,setTile,dt,opts);
    moveAxis(c,c.vy*dt,'y',getTile,setTile,dt,opts);
    c.x=clamp(c.x,-999999999,999999999);
    c.y=clampCompanionWorldY(c.y,1,0.35);
    c.lastWind=wind.speed*wind.exposure;
    snapHeroToLeafTransport(c,player);
    return true;
  }
  function updateLeafMonsterFlight(c,dt,dx,dy,traits,getTile,setTile,opts){
    const wind=windAtForLeaf(c,getTile);
    const g=c.genome || {};
    const flutter=Math.sin(c.age*(8.5+Math.abs(wind.speed)*0.9)+(g.pulse||0));
    const desiredX=clamp(dx*2.35 + flutter*0.34, -traits.speed, traits.speed);
    const desiredY=clamp(dy*2.75 + Math.cos(c.age*5.1+(g.pulse||0))*0.42, -traits.speed*0.72, traits.speed*0.72);
    c.vx+=clamp(desiredX-c.vx,-traits.accel*dt,traits.accel*dt);
    c.vy+=clamp(desiredY-c.vy,-traits.accel*dt,traits.accel*dt);
    const windForce=wind.speed*wind.exposure*traits.windResponse;
    c.vx+=windForce*dt;
    c.vy+=Math.sin(c.age*11.0+(g.seed||0))*Math.abs(windForce)*0.075*dt;
    c.vx*=Math.pow(0.78,dt*8);
    c.vy*=Math.pow(0.80,dt*8);
    c.facing=c.vx>0.04 ? 1 : (c.vx<-0.04 ? -1 : c.facing);
    c.grounded=false;
    c.flying=true;
    moveAxis(c,c.vx*dt,'x',getTile,setTile,dt,opts);
    moveAxis(c,c.vy*dt,'y',getTile,setTile,dt,opts);
    c.x=clamp(c.x,-999999999,999999999);
    c.y=clampCompanionWorldY(c.y,1,0.35);
    c.lastWind=wind.speed*wind.exposure;
  }
  function companionWaterSubmersion(c,getTile){
    if(!c || typeof getTile!=='function') return 0;
    const h=companionBodyH(c);
    const probes=[c.y-0.06,c.y-h*0.30,c.y-h*0.58,c.y-h*0.86];
    let wet=0;
    for(const y of probes){
      if(tileAt(getTile,c.x,y)===T.WATER) wet++;
    }
    return wet/probes.length;
  }
  function waterSurfaceFeetY(c,getTile){
    const h=companionBodyH(c);
    const probes=[c.y-0.06,c.y-h*0.30,c.y-h*0.58,c.y-h*0.86];
    let waterRow=null;
    for(const y of probes){
      if(tileAt(getTile,c.x,y)===T.WATER){ waterRow=Math.floor(y); break; }
    }
    if(waterRow==null) return null;
    let row=waterRow;
    for(let i=0;i<10;i++){
      if(tileAt(getTile,c.x,row-1+0.5)!==T.WATER) return row+h*0.88;
      row--;
    }
    return null;
  }
  function swimTargetInWater(x,y,getTile){
    return tileAt(getTile,x,y-0.08)===T.WATER || tileAt(getTile,x,y-0.62)===T.WATER;
  }
  function updateWaterGolemSwimming(c,dt,targetX,targetY,traits,getTile,setTile,opts,submersion){
    let verticalTarget=targetY;
    if(!swimTargetInWater(targetX,targetY,getTile)){
      const surfaceY=waterSurfaceFeetY(c,getTile);
      if(surfaceY!=null) verticalTarget=surfaceY;
      else verticalTarget=Math.min(targetY,c.y-0.35);
    }
    const dx=targetX-c.x;
    const dy=verticalTarget-c.y;
    const bob=Math.sin(c.age*4.4+(c.seed||0)*0.002)*0.07*submersion;
    const maxHorizontal=Math.max(1.35,traits.speed*1.04);
    const maxVertical=Math.max(1.25,traits.speed*0.82);
    const desiredX=clamp(dx*1.70,-maxHorizontal,maxHorizontal);
    const desiredY=clamp(dy*1.75+bob,-maxVertical,maxVertical);
    const accel=Math.max(5.5,traits.accel*0.90);
    c.vx+=clamp(desiredX-c.vx,-accel*dt,accel*dt);
    c.vy+=clamp(desiredY-c.vy,-accel*0.82*dt,accel*0.82*dt);
    c.vx*=Math.pow(Math.abs(dx)>0.12 ? 0.90 : 0.72,dt*8);
    c.vy*=Math.pow(Math.abs(dy)>0.10 ? 0.88 : 0.68,dt*8);
    c.facing=c.vx>0.04 ? 1 : (c.vx<-0.04 ? -1 : c.facing);
    c.grounded=false;
    c.flying=false;
    c.swimming=true;
    c.navPath=null;
    c.navGoalKey='';
    c.stuckT=0;
    moveAxis(c,c.vx*dt,'x',getTile,setTile,dt,opts);
    moveAxis(c,c.vy*dt,'y',getTile,setTile,dt,opts);
    c.grounded=false;
    c.x=clamp(c.x,-999999999,999999999);
    c.y=clampCompanionWorldY(c.y,1,0.35);
  }
  function strainDistantClayGolem(c,d2,dt){
    if(!isClayGolem(c)) return false;
    const dist=Math.sqrt(Math.max(0,d2));
    const excess=Math.max(0,dist-TELEPORT_DIST);
    const dps=c.maxHp*(0.095+Math.min(0.08,excess*0.004));
    c.feedPulse=Math.max(c.feedPulse||0,0.12);
    c.shieldPulse=Math.max(c.shieldPulse||0,0.20);
    c.vx*=0.72;
    c.vy*=0.82;
    damage(c,dps*dt,'distance');
    if(list.indexOf(c)>=0 && (!c.distanceSayCd || c.distanceSayCd<=0)){
      say(c.name+' peka z dala od bohatera.');
      c.distanceSayCd=3.5;
    }
    c.distanceSayCd=Math.max(0,(c.distanceSayCd||0)-dt);
    return true;
  }
  function strainDistantLeafMonster(c,d2,dt){
    if(!isLeafMonster(c)) return false;
    const dist=Math.sqrt(Math.max(0,d2));
    const excess=Math.max(0,dist-TELEPORT_DIST);
    const dps=c.maxHp*(0.055+Math.min(0.10,excess*0.003));
    c.feedPulse=Math.max(c.feedPulse||0,0.10);
    damage(c,dps*dt,'distance');
    if(list.indexOf(c)>=0 && (!c.distanceSayCd || c.distanceSayCd<=0)){
      say(c.name+' traci liscie z dala od bohatera.');
      c.distanceSayCd=3.0;
    }
    c.distanceSayCd=Math.max(0,(c.distanceSayCd||0)-dt);
    return list.indexOf(c)>=0;
  }
  function clayGolemCanBreakTile(t){
    const info=INFO[t];
    return !!info && t!==T.AIR && !passableForCompanion(t) && !info.unmineable && !info.chestTier && !info.machine && !info.story && !isGasTile(t);
  }
  function molekinCanBreakTile(t){
    const info=INFO[t];
    if(!info || t===T.AIR || passableForCompanion(t) || info.unmineable || info.chestTier || info.machine || info.story || info.cache || isGasTile(t)) return false;
    if(isDoorTile(t) || info.door || info.trapdoor) return false;
    return !!(info.geology || info.hardRock || t===T.STONE || t===T.GRASS || t===T.GRASS_SNOW || t===T.SAND || t===T.SNOW || t===T.ICE || t===T.MUD || t===T.CLAY || t===T.WET_CLAY || t===T.FROZEN_SAND || t===T.FROZEN_CLAY || t===T.OBSIDIAN || t===T.BRICK);
  }
  function clayGolemFrontBlockers(c,nx,ny,dir,getTile){
    const out=[];
    const seen=new Set();
    const front=nx+dir*(companionBodyW(c)*0.5+0.05);
    const h=companionBodyH(c);
    const probes=[ny-0.20,ny-0.76,ny-Math.min(h-0.12,1.36)];
    for(const py of probes){
      const tx=Math.floor(front), ty=Math.floor(py);
      const t=tileAt(getTile,tx,ty);
      if(passableForCompanion(t) || !clayGolemCanBreakTile(t)) continue;
      const kk=tx+','+ty;
      if(seen.has(kk)) continue;
      seen.add(kk);
      out.push({x:tx,y:ty,t});
    }
    return out;
  }
  function molekinFrontBlockers(c,nx,ny,dir,getTile){
    const out=[];
    const seen=new Set();
    const front=nx+dir*(companionBodyW(c)*0.5+0.05);
    const h=companionBodyH(c);
    const probes=[ny-0.16,ny-0.52,ny-Math.min(h-0.08,1.08)];
    for(const py of probes){
      const tx=Math.floor(front), ty=Math.floor(py);
      const t=tileAt(getTile,tx,ty);
      if(passableForCompanion(t) || !molekinCanBreakTile(t)) continue;
      const kk=tx+','+ty;
      if(seen.has(kk)) continue;
      seen.add(kk);
      out.push({x:tx,y:ty,t});
    }
    return out;
  }
  function clayGolemBreakPath(c,nx,ny,dir,getTile,setTile,opts){
    if(!isClayGolem(c) || (c.pathBreakCd||0)>0) return false;
    const blockers=clayGolemFrontBlockers(c,nx,ny,dir,getTile);
    if(!blockers.length) return false;
    const breaker=opts && opts.breakTile;
    for(const b of blockers){
      let ok=false;
      if(typeof breaker==='function') ok=!!breaker(b.x,b.y,b.t,c);
      else if(typeof setTile==='function'){ setTile(b.x,b.y,T.AIR); ok=true; }
      if(ok){
        c.pathBreakCd=0.20;
        c.pathJumpAttempted=false;
        c.feedPulse=Math.max(c.feedPulse||0,0.14);
        c.lastTarget={x:b.x+0.5,y:b.y+0.5,t:0.22};
        sparks(b.x+0.5,b.y+0.5,'common',6);
        sfx('break',{x:b.x+0.5,y:b.y+0.5});
        return true;
      }
    }
    return false;
  }
  function molekinBreakPath(c,nx,ny,dir,getTile,setTile,opts){
    if(!isMolekin(c) || (c.pathBreakCd||0)>0) return false;
    const blockers=molekinFrontBlockers(c,nx,ny,dir,getTile);
    if(!blockers.length) return false;
    const breaker=opts && opts.breakTile;
    const traits=traitsFor(c);
    for(const b of blockers){
      let ok=false;
      if(typeof breaker==='function') ok=!!breaker(b.x,b.y,b.t,c);
      else if(typeof setTile==='function'){ setTile(b.x,b.y,T.AIR); ok=true; }
      if(ok){
        c.pathBreakCd=0.12;
        c.feedPulse=Math.max(c.feedPulse||0,0.12);
        c.lastTarget={x:b.x+0.5,y:b.y+0.5,t:0.20};
        c.vx+=dir*0.25;
        sparks(b.x+0.5,b.y+0.5,'common',5);
        if(molekinRole(c)==='sapper' || molekinRole(c)==='engineer') c.pathBreakCd=0.08;
        if(traits.guardAbsorb>0) c.shieldPulse=Math.max(c.shieldPulse||0,0.10);
        sfx('break',{x:b.x+0.5,y:b.y+0.5});
        return true;
      }
    }
    return false;
  }
  function walkingGolemStepUp(c,nx,dir,getTile){
    if(!isWalkingGolem(c) || !c.grounded) return false;
    const ny=c.y-1.0;
    const frontFoot=nx+dir*(companionBodyW(c)*0.5+0.12);
    const frontSupport=!passableForCompanion(tileAt(getTile,frontFoot,ny+0.08));
    if(!inCompanionWorldY(ny,1,0.35) || !clearAt(nx,ny,c,getTile) || (!hasFloorFor(c,nx,ny,getTile) && !frontSupport)) return false;
    c.x=nx;
    c.y=ny;
    c.vy=Math.min(c.vy,-1.0);
    c.grounded=false;
    c.stuckT=0;
    c.pathJumpAttempted=false;
    return true;
  }
  function walkingGolemRecoveryJump(c,dir,getTile){
    if(!isWalkingGolem(c) || !c.grounded) return false;
    if((c.stuckT||0)<GOLEM_WALK_JUMP_STUCK_SECONDS) return false;
    if((c.pathJumpCd||0)>0) return true;
    if(!clearAt(c.x,c.y-0.30,c,getTile)) return false;
    c.vy=Math.min(c.vy,traitsFor(c).jump*0.68);
    c.vx+=dir*0.12;
    c.grounded=false;
    c.pathJumpCd=GOLEM_WALK_JUMP_COOLDOWN;
    c.stuckT=0;
    c.feedPulse=Math.max(c.feedPulse||0,0.10);
    return true;
  }
  function clayGolemTryJumpBeforeBreak(c,dir,getTile){
    if(!isClayGolem(c) || !c.grounded) return false;
    if(c.pathJumpAttempted) return false;
    if((c.stuckT||0)<GOLEM_WALK_JUMP_STUCK_SECONDS) return false;
    if((c.pathJumpCd||0)>0) return true;
    if(!clearAt(c.x,c.y-0.30,c,getTile)) return false;
    c.vy=Math.min(c.vy,traitsFor(c).jump*0.68);
    c.vx+=dir*0.16;
    c.grounded=false;
    c.pathJumpCd=GOLEM_WALK_JUMP_COOLDOWN;
    c.pathJumpAttempted=true;
    c.stuckT=0;
    c.feedPulse=Math.max(c.feedPulse||0,0.10);
    return true;
  }
  function moveAxis(c,amount,axis,getTile,setTile,dt,opts){
    const stepMax=0.10;
    const steps=Math.max(1,Math.ceil(Math.abs(amount)/stepMax));
    const inc=amount/steps;
    for(let i=0;i<steps;i++){
      const nx=c.x+(axis==='x'?inc:0);
      const ny=c.y+(axis==='y'?inc:0);
      if(clearAt(nx,ny,c,getTile)){
        c.x=nx; c.y=ny;
        if(axis==='x' && isWalkingGolem(c)){
          c.stuckT=Math.max(0,(c.stuckT||0)-(dt||0)*1.8);
          if(c.stuckT<=0.03) c.pathJumpAttempted=false;
        }
      }else{
        if(axis==='x'){
          const dir=Math.sign(inc || c.vx || c.facing || 1) || 1;
          if(walkingGolemStepUp(c,nx,dir,getTile)) continue;
          c.stuckT+=dt||0;
          if(isClayGolem(c)){
            if(clayGolemTryJumpBeforeBreak(c,dir,getTile)){
              c.vx*=0.28;
              return false;
            }
            if(!c.grounded || c.stuckT<CLAY_GOLEM_BREAK_STUCK_SECONDS){
              c.vx*=0.35;
              return false;
            }
            if(clayGolemBreakPath(c,nx,ny,dir,getTile,setTile,opts)){
              c.vx*=0.22;
              return false;
            }
          }else if(isMolekin(c)){
            if(walkingGolemRecoveryJump(c,dir,getTile)){
              c.vx*=0.30;
              return false;
            }
            if(!c.grounded || c.stuckT<MOLEKIN_BREAK_STUCK_SECONDS){
              c.vx*=0.40;
              return false;
            }
            if(molekinBreakPath(c,nx,ny,dir,getTile,setTile,opts)){
              c.vx*=0.30;
              return false;
            }
          }else if(isWalkingGolem(c)){
            if(walkingGolemRecoveryJump(c,dir,getTile)){
              c.vx*=0.28;
              return false;
            }
            if(!c.grounded || c.stuckT<GOLEM_WALK_JUMP_STUCK_SECONDS){
              c.vx*=0.35;
              return false;
            }
          }else if(!c.grounded){
            c.vx*=0.35;
            return false;
          }
          c.vx=0;
        }
        else {
          if(inc>0 && launchCompanionFromSpring(c,getTile)) return false;
          if(inc>0) c.grounded=true;
          c.vy=0;
        }
        return false;
      }
    }
    return true;
  }
  function updateMotion(c,dt,player,getTile,setTile,index,opts){
    const traits=traitsFor(c);
    c.age+=dt;
    c.feedPulse=Math.max(0,c.feedPulse-dt*1.7);
    c.hitPulse=Math.max(0,c.hitPulse-dt*2.8);
    c.transportPulse=Math.max(0,(c.transportPulse||0)-dt*2.4);
    c.transportRideT=Math.max(0,(c.transportRideT||0)-dt);
    c.transportMounted=false;
    c.pathBreakCd=Math.max(0,(c.pathBreakCd||0)-dt);
    c.pathJumpCd=Math.max(0,(c.pathJumpCd||0)-dt);
    if(c.lastTarget) c.lastTarget.t-=dt;
    if(c.lastTarget && c.lastTarget.t<=0) c.lastTarget=null;
    const px=finiteNumber(player && player.x,c.x);
    const py=finiteNumber(player && player.y,c.y);
    const side=(player && player.facing) || c.facing || 1;
    const feedTarget=isLeafMonster(c) ? leafFeedingTarget(c,getTile) : null;
    const harvesting=!feedTarget && !isRottenMeatGolem(c) && isHarvestMode() && command.harvestTile!=null && c.harvestX!=null && c.harvestY!=null;
    const transporting=isLeafMonster(c) && isTransportMode();
    if(transporting && updateLeafMonsterTransport(c,dt,player,getTile,setTile,opts,traits)) return;
    let targetX=px - side*(traits.follow+index*traits.spacing);
    let targetY=py + Math.sin(c.age*2.5+c.seed*0.001)*traits.orbit;
    if(isRottenMeatGolem(c)){
      targetX=px;
      targetY=py;
    }else if(feedTarget){
      targetX=feedTarget.x+0.5;
      targetY=feedTarget.y+0.94;
    }else if(harvesting){
      const stand=harvestStandPoint(c,c.harvestX,c.harvestY,getTile);
      targetX=stand.x;
      targetY=stand.y;
    }else if(transporting){
      targetX=px;
      targetY=py + Math.max(0.92,companionBodyH(c)+((Number(player && player.h)||0.95)*0.48));
    }else if(isLeafMonster(c)){
      targetX += Math.sin(c.age*4.8+c.seed*0.004+index)*0.42;
      targetY = py - 1.45 + Math.cos(c.age*3.7+c.seed*0.002)*0.46;
    }else if(traits.archetype==='sentinel'){
      targetX += Math.sin(c.age*1.55+c.seed*0.002+index)*0.72;
      targetY += Math.cos(c.age*1.25+c.seed*0.001)*0.42;
    }else if(traits.archetype==='skirmisher' || traits.archetype==='volatile'){
      targetX += Math.sin(c.age*(traits.archetype==='skirmisher'?4.1:3.0)+c.seed*0.004)*0.38;
      targetY += Math.sin(c.age*3.3+index)*0.10;
    }else if(traits.archetype==='sniper'){
      targetX -= side*0.36;
      targetY -= 0.04;
    }else if(traits.archetype==='toxic'){
      targetX += Math.sin(c.age*2.1+c.seed*0.003)*0.16;
      targetY += 0.06;
    }
    let dx=targetX-c.x;
    let dy=targetY-c.y;
    const d2=dx*dx+dy*dy;
    if(d2>TELEPORT_DIST*TELEPORT_DIST && !isRottenMeatGolem(c)){
      if(strainDistantClayGolem(c,d2,dt)) return;
      if(isLeafMonster(c)){
        if(!strainDistantLeafMonster(c,d2,dt)) return;
      }else{
        teleportToHero(c,player,getTile,1.2+index*0.5,true);
        return;
      }
    }
    if(isLeafMonster(c)){
      updateLeafMonsterFlight(c,dt,dx,dy,traits,getTile,setTile,opts);
      return;
    }
    const waterSubmersion=isWaterGolem(c) ? companionWaterSubmersion(c,getTile) : 0;
    if(waterSubmersion>0){
      updateWaterGolemSwimming(c,dt,targetX,targetY,traits,getTile,setTile,opts,waterSubmersion);
      return;
    }
    c.swimming=false;
    c.flying=false;
    const routed=companionPathTarget(c,targetX,targetY,dt,getTile);
    targetX=routed.x;
    targetY=routed.y;
    dx=targetX-c.x;
    dy=targetY-c.y;
    const desired=clamp(dx*1.85,-traits.speed,traits.speed);
    const dv=clamp(desired-c.vx,-traits.accel*dt,traits.accel*dt);
    c.vx+=dv;
    c.vx*=Math.pow(0.80,dt*8);
    c.facing=c.vx>0.04 ? 1 : (c.vx<-0.04 ? -1 : c.facing);
    c.grounded=hasFloorFor(c,c.x,c.y,getTile);
    const walkingGolem=isWalkingGolem(c);
    const wantsTravelJump=!walkingGolem && Math.abs(dx)>1.1;
    const wantsVerticalJump=dy < (walkingGolem ? -1.45 : -0.75);
    if(c.grounded && (wantsTravelJump || wantsVerticalJump)){
      const frontX=c.x+Math.sign(dx || c.facing)*0.48;
      const blockLow=!passableForCompanion(tileAt(getTile,frontX,c.y-0.25));
      const blockMid=!passableForCompanion(tileAt(getTile,frontX,c.y-0.78));
      if(walkingGolem){
        if(wantsVerticalJump && !blockLow && !blockMid && (c.pathJumpCd||0)<=0){
          c.vy=Math.min(c.vy,traits.jump*0.62);
          c.grounded=false;
          c.pathJumpCd=GOLEM_WALK_JUMP_COOLDOWN;
          c.stuckT=0;
        }
      }else if(blockLow || blockMid || wantsVerticalJump){
        c.vy=traits.jump;
        c.grounded=false;
        c.stuckT=0;
      }
    }
    c.vy=clamp(c.vy+GRAVITY*dt,-12,MAX_FALL);
    moveAxis(c,c.vx*dt,'x',getTile,setTile,dt,opts);
    c.grounded=false;
    moveAxis(c,c.vy*dt,'y',getTile,setTile,dt,opts);
    c.x=clamp(c.x,-999999999,999999999);
    c.y=clampCompanionWorldY(c.y,1,0.15);
  }
  function planHarvest(c,dt,player,getTile){
    if(!isHarvestMode() || command.awaiting || command.harvestTile==null) return;
    c.harvestScanCd=Math.max(0,(c.harvestScanCd||0)-dt);
    if(c.harvestX!=null && !canHarvestTileAt(c.harvestX,c.harvestY,getTile)){
      c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
    }
    if(c.harvestX==null && c.harvestScanCd<=0){
      const target=findHarvestTile(c,player,getTile);
      if(target){ c.harvestX=target.x; c.harvestY=target.y; c.harvestProgress=0; }
      c.harvestScanCd=target ? 0.35 : 1.0;
    }
  }
  function updateHarvest(c,dt,getTile,opts){
    if(!isHarvestMode() || command.awaiting || command.harvestTile==null || c.harvestX==null) return false;
    if(!canHarvestTileAt(c.harvestX,c.harvestY,getTile)){
      c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
      return false;
    }
    if(!harvestReach(c,c.harvestX,c.harvestY,getTile)) return false;
    const info=INFO[command.harvestTile] || {hp:1};
    const heroSpeed=Math.max(0.1,Number(opts && opts.harvestSpeed)||1);
    const need=Math.max(0.12,(Number(info.hp)||1)/6);
    const harvestMult=Math.max(0.25,Number(traitsFor(c).harvest)||1);
    c.harvestProgress=(c.harvestProgress||0)+dt*heroSpeed*HARVEST_SPEED_SCALE*harvestMult;
    c.lastTarget={x:c.harvestX+0.5,y:c.harvestY+0.5,t:0.22};
    c.facing=(c.harvestX+0.5)>=c.x ? 1 : -1;
    if(c.harvestProgress<need) return true;
    c.harvestProgress=0;
    const breaker=opts && opts.breakTile;
    const ok=typeof breaker==='function' ? !!breaker(c.harvestX,c.harvestY,command.harvestTile,c) : false;
    if(ok){
      sparks(c.harvestX+0.5,c.harvestY+0.5,'common',5);
      c.harvestX=null; c.harvestY=null; c.harvestScanCd=0;
      return true;
    }
    c.harvestX=null; c.harvestY=null; c.harvestScanCd=0.25;
    return false;
  }
  function update(dt,player,getTile,setTile,opts){
    opts=(opts && typeof opts==='object') ? opts : null;
    dt=clamp(Number(dt)||0,0,0.12);
    command.fightBadgeT=Math.max(0,(command.fightBadgeT||0)-dt);
    command.harvestBadgeT=Math.max(0,(command.harvestBadgeT||0)-dt);
    command.transportBadgeT=Math.max(0,(command.transportBadgeT||0)-dt);
    scanCompanionRitualsNearPlayer(dt,player,getTile,setTile);
    for(let i=list.length-1;i>=0;i--){
      const c=list[i];
      if(!sanitizeCompanion(c)) continue;
      const smoke=MM.smoke;
      if(smoke&&typeof smoke.updateSoot==='function') smoke.updateSoot(c,dt,{height:1.15,field:'_sootFilm'});
      if(!isRottenMeatGolem(c)) planHarvest(c,dt,player,getTile);
      updateMotion(c,dt,player,getTile,setTile,i,opts);
      if(list.indexOf(c)<0) continue;
      if(isMeatGolem(c) && heatTouchesMeatGolem(c,getTile)){
        cookMeatGolem(c,'environment');
        continue;
      }
      if(rotMeatGolem(c)){
        updateRottenMeatGolemAction(c,dt,player);
        continue;
      }
      resolveCrush(c,dt,getTile);
      if(list.indexOf(c)<0) continue;
      applyEnvironmentDamage(c,dt,getTile,setTile);
      if(list.indexOf(c)<0) continue;
      if(isFriedMeatGolem(c) && tryConsumeFriedMeatGolem(c,player)) continue;
      c.shieldPulse=Math.max(0,(c.shieldPulse||0)-dt*1.8);
      if(isLeafMonster(c) && c.transportMounted) continue;
      if(isLeafMonster(c) && updateLeafMonsterFeeding(c,dt,getTile,setTile)) continue;
      const harvesting=updateHarvest(c,dt,getTile,opts);
      if(harvesting) continue;
      if(isMolekin(c)){
        if(isAttackMode()) updateMolekinAction(c,dt,player,getTile,setTile);
        continue;
      }
      if(isLeafMonster(c)){
        if(isAttackMode()) updateLeafMonsterAttack(c,dt,player,getTile);
        continue;
      }
      if(isWaterGolem(c)){
        if(isAttackMode()) updateWaterGolemAction(c,dt,player,getTile);
        continue;
      }
      if(isMeatGolem(c)){
        if(isRottenMeatGolem(c)) updateRottenMeatGolemAction(c,dt,player);
        else if(isAttackMode()) updateMeatGolemAction(c,dt,player,getTile);
        continue;
      }
      if(isFriedMeatGolem(c)){
        if(isAttackMode()) updateMeatGolemAction(c,dt,player,getTile);
        continue;
      }
      if(isClayGolem(c)){
        updateClayGolemGuard(c,dt,player,getTile);
        continue;
      }
      if(!isAttackMode()) continue;
      if(isUfoAlien(c)) ufoAlienSupport(c,dt,player);
      c.gasCd-=dt;
      if(c.gasCd<=0){
        c.gasCd=traitsFor(c).poisonInterval*(0.75+Math.random()*0.65);
        emitPoison(c,getTile,setTile);
      }
      c.laserCd-=dt;
      if(c.laserCd<=0){
        const t=nearestHostile(c,player,getTile);
        if(t){
          fireLaser(c,t);
          c.laserCd=traitsFor(c).laserCooldown*(0.78+Math.random()*0.42);
        }else{
          c.laserCd=0.25;
        }
      }
    }
    resolveCompanionBumps(dt,getTile);
    collideHero(player,dt,getTile);
    for(let i=lasers.length-1;i>=0;i--){
      lasers[i].life+=dt;
      if(lasers[i].life>=lasers[i].max) lasers.splice(i,1);
    }
    for(let i=deathFx.length-1;i>=0;i--){
      deathFx[i].t+=dt;
      if(deathFx[i].t>=deathFx[i].max) deathFx.splice(i,1);
    }
  }
  function damageAt(tx,ty,dmg,opts){
    tx=Number(tx); ty=Number(ty);
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
    const amount=Number.isFinite(Number(dmg)) ? Math.max(0.5,Number(dmg)) : 1;
    for(const c of list){
      if(Math.abs((tx+0.5)-c.x)<=Math.max(0.8,companionBodyW(c)*0.62) && Math.abs((ty+0.5)-(c.y-0.55))<=Math.max(0.9,companionBodyH(c)*0.62)){
        if(isMeatGolem(c) && opts && (opts.element==='fire' || opts.kind==='fire' || opts.heat)) return cookMeatGolem(c,'direct-heat');
        damage(c,amount,'direct');
        return true;
      }
    }
    return false;
  }
  function enemyTargetable(c){
    return !!(c && c.hp>0);
  }
  function companionAimY(c){
    return c.y-Math.min(0.72, companionBodyH(c)*0.46);
  }
  function companionInWater(c,getTile){
    return companionWaterSubmersion(c,getTile)>0;
  }
  function damageAtWorld(wx,wy,dmg,opts){
    wx=Number(wx); wy=Number(wy);
    if(!Number.isFinite(wx) || !Number.isFinite(wy)) return false;
    const amount=Number.isFinite(Number(dmg)) ? Math.max(0.5,Number(dmg)) : 1;
    for(const c of list){
      if(!enemyTargetable(c)) continue;
      if(Math.abs(wx-c.x)>Math.max(0.8,companionBodyW(c)*0.62) || Math.abs(wy-companionAimY(c))>Math.max(0.9,companionBodyH(c)*0.62)) continue;
      if(isMeatGolem(c) && opts && (opts.element==='fire' || opts.kind==='fire' || opts.heat)) return cookMeatGolem(c,'direct-heat');
      if(opts && Number.isFinite(opts.srcX)){
        const dir=c.x>=opts.srcX ? 1 : -1;
        c.vx+=dir*Math.min(3.4,Math.max(0.7,(Number(opts.knockback)||2.4)));
        if(Number.isFinite(opts.srcY) && opts.srcY>companionAimY(c)) c.vy=Math.min(c.vy||0,-1.4);
      }
      damage(c,amount,opts && opts.cause ? String(opts.cause) : 'enemy');
      return true;
    }
    return false;
  }
  function nearestForEnemy(wx,wy,range,opts){
    wx=Number(wx); wy=Number(wy);
    if(!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    const r=Number(range);
    if(!Number.isFinite(r) || r<=0) return null;
    let best=null, bd=r*r;
    for(const c of list){
      if(!enemyTargetable(c)) continue;
      if(opts && opts.excludeGolems && (isClayGolem(c) || isWaterGolem(c) || isMeatGolem(c) || isFriedMeatGolem(c))) continue;
      if(opts && opts.inWater && !companionInWater(c,opts.getTile)) continue;
      const ax=c.x, ay=companionAimY(c);
      const dx=ax-wx, dy=ay-wy, d2=dx*dx+dy*dy;
      if(d2>bd) continue;
      bd=d2;
      best={kind:'companion', id:c.id, raw:c, x:ax, y:c.y, aimY:ay, tx:Math.floor(ax), ty:Math.floor(ay), hp:c.hp, maxHp:c.maxHp, vx:c.vx||0, vy:c.vy||0};
    }
    return best;
  }
  function debugNearest(player,range,predicate){
    return nearestCompanion(player,range||999999,predicate) || list.find(c=>!predicate || predicate(c)) || null;
  }
  function debugSpawn(player,biomass,getTile){
    if(!makeDebugCompanionRoom()) return null;
    const mass=clamp(Math.floor(biomass||3),1,MAX_BIOMASS);
    const spot=findSpawnNear(player,getTile,1.35+list.length*0.55);
    const c=makeCompanion({x:spot.x,y:spot.y,biomass:mass,facing:(player && player.facing)||1});
    list.push(c);
    burst(c.x,c.y-0.4,'rare');
    sfx('charge',c);
    say(c.name+' dolaczyl do debugowej druzyny.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_BIO,debug:true}})); }catch(e){}
    return c;
  }
  function debugSpawnGolem(player,clay,getTile){
    if(!makeDebugCompanionRoom()) return null;
    const mass=clayMass({clay});
    const seed=hashSeed(Number(player && player.x)||0,Number(player && player.y)||0,mass ^ 0x6c6179);
    const probe=makeCompanion({kind:KIND_CLAY_GOLEM,x:0,y:0,clay:mass,seed,facing:(player && player.facing)||1});
    const spot=findSpawnNearFor(probe,player,getTile,1.85+list.length*0.75);
    const c=makeCompanion({kind:KIND_CLAY_GOLEM,x:spot.x,y:spot.y,clay:mass,seed,facing:(player && player.facing)||1});
    list.push(c);
    burst(c.x,c.y-0.55,'epic');
    sparks(c.x,c.y-0.72,'rare',18);
    sfx('charge',c);
    say(c.name+' dolaczyl do debugowej druzyny.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_CLAY_GOLEM,debug:true}})); }catch(e){}
    return c;
  }
  function debugSpawnLeafMonster(player,leaves,getTile){
    if(!makeDebugCompanionRoom()) return null;
    const mass=leafMass({leaves});
    const seed=hashSeed(Number(player && player.x)||0,Number(player && player.y)||0,mass ^ 0x1eaf);
    const probe=makeCompanion({kind:KIND_LEAF_MONSTER,x:0,y:0,leaves:mass,seed,facing:(player && player.facing)||1});
    const spot=findLeafMonsterSpawnNear(player,getTile,probe,1.45+list.length*0.45);
    const c=makeCompanion({kind:KIND_LEAF_MONSTER,x:spot.x,y:spot.y,leaves:mass,seed,facing:(player && player.facing)||1});
    list.push(c);
    burst(c.x,c.y-0.35,'rare');
    sparks(c.x,c.y-0.35,'common',18);
    sfx('wind',c);
    say(c.name+' dolaczyl do debugowej druzyny.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_LEAF_MONSTER,debug:true}})); }catch(e){}
    return c;
  }
  function debugSpawnWaterGolem(player,water,getTile){
    if(!makeDebugCompanionRoom()) return null;
    const mass=waterMass({water});
    const seed=hashSeed(Number(player && player.x)||0,Number(player && player.y)||0,mass ^ 0x77a7);
    const probe=makeCompanion({kind:KIND_WATER_GOLEM,x:0,y:0,water:mass,seed,facing:(player && player.facing)||1});
    const spot=findSpawnNearFor(probe,player,getTile,1.65+list.length*0.62);
    const c=makeCompanion({kind:KIND_WATER_GOLEM,x:spot.x,y:spot.y,water:mass,seed,facing:(player && player.facing)||1});
    list.push(c);
    deathFx.push({x:c.x,y:c.y-0.45,t:0,max:0.42,color:(c.genome && c.genome.highlight) || '#b8f3ff',fill:'rgba(64,184,255,0.18)'});
    sparks(c.x,c.y-0.45,'common',18);
    sfx('hose',c);
    say(c.name+' dolaczyl do debugowej druzyny.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_WATER_GOLEM,debug:true}})); }catch(e){}
    return c;
  }
  function debugSpawnMeatGolem(player,meat,getTile){
    if(!makeDebugCompanionRoom()) return null;
    const mass=meatMass({meat});
    const seed=hashSeed(Number(player && player.x)||0,Number(player && player.y)||0,mass ^ 0x6d337);
    const probe=makeCompanion({kind:KIND_MEAT_GOLEM,x:0,y:0,meat:mass,seed,facing:(player && player.facing)||1});
    const spot=findSpawnNearFor(probe,player,getTile,1.55+list.length*0.62);
    const c=makeCompanion({kind:KIND_MEAT_GOLEM,x:spot.x,y:spot.y,meat:mass,seed,facing:(player && player.facing)||1});
    list.push(c);
    deathFx.push({x:c.x,y:c.y-0.48,t:0,max:0.42,color:(c.genome && c.genome.highlight) || '#f18a78',fill:'rgba(190,62,55,0.18)'});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(c.x,c.y-0.48,'rare',18);
    sfx('charge',c);
    say(c.name+' dolaczyl do debugowej druzyny.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_MEAT_GOLEM,debug:true}})); }catch(e){}
    return c;
  }
  function debugSpawnUfoAlien(player,concrete,getTile,role){
    if(!makeDebugCompanionRoom()) return null;
    const mass=ufoConcreteMass({motherIce:concrete});
    const safeRole=validChoice(String(role || 'commander'),UFO_ALIEN_ROLES,'commander');
    const seed=hashSeed(Number(player && player.x)||0,Number(player && player.y)||0,mass ^ 0x0f0a11e9);
    const probe=makeCompanion({kind:KIND_UFO_ALIEN,x:0,y:0,motherIce:mass,role:safeRole,seed,facing:(player && player.facing)||1});
    const spot=findSpawnNearFor(probe,player,getTile,1.75+list.length*0.66);
    const c=makeCompanion({kind:KIND_UFO_ALIEN,x:spot.x,y:spot.y,motherIce:mass,role:safeRole,seed,facing:(player && player.facing)||1});
    list.push(c);
    deathFx.push({x:c.x,y:c.y-0.52,t:0,max:0.48,color:(c.genome && c.genome.glow) || '#7cf7ff',fill:'rgba(83,105,119,0.22)'});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(c.x,c.y-0.52,c.ufoRole==='commander'?'epic':'rare',22);
    sfx('charge',c);
    say(c.name+' dolaczyl do debugowej druzyny.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_UFO_ALIEN,role:c.ufoRole,debug:true}})); }catch(e){}
    return c;
  }
  function debugSpawnMolekin(player,lava,getTile,role){
    if(!makeDebugCompanionRoom()) return null;
    const mass=lavaMass({lava});
    const safeRole=validChoice(String(role || MOLEKIN_ROLES[(Math.floor(Math.random()*MOLEKIN_ROLES.length))]),MOLEKIN_ROLES,'rusher');
    const seed=hashSeed(Number(player && player.x)||0,Number(player && player.y)||0,mass ^ 0xea57111);
    const probe=makeCompanion({kind:KIND_MOLEKIN,x:0,y:0,lava:mass,role:safeRole,seed,facing:(player && player.facing)||1});
    const spot=findSpawnNearFor(probe,player,getTile,1.65+list.length*0.62);
    const c=makeCompanion({kind:KIND_MOLEKIN,x:spot.x,y:spot.y,lava:mass,role:safeRole,seed,facing:(player && player.facing)||1});
    list.push(c);
    deathFx.push({x:c.x,y:c.y-0.44,t:0,max:0.46,color:(c.genome && c.genome.accent) || '#ff8b35',fill:'rgba(255,90,28,0.18)'});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    sparks(c.x,c.y-0.44,'rare',20);
    sfx('fire',c);
    say(c.name+' dolaczyl do debugowej druzyny.');
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-companion-change',{detail:{kind:KIND_MOLEKIN,role:c.moleRole,debug:true}})); }catch(e){}
    return c;
  }
  function debugFeed(player,amount){
    const c=debugNearest(player,999999,c=>!isClayGolem(c) && !isLeafMonster(c) && !isWaterGolem(c) && !isMeatGolem(c) && !isFriedChicken(c) && !isUfoAlien(c) && !isMolekin(c));
    if(!c) return false;
    growCompanion(c,amount);
    sparks(c.x,c.y-0.55,'rare',14);
    return true;
  }
  function debugSetBiomass(player,biomass){
    const c=debugNearest(player,999999,c=>!isClayGolem(c) && !isLeafMonster(c) && !isWaterGolem(c) && !isMeatGolem(c) && !isFriedChicken(c) && !isUfoAlien(c) && !isMolekin(c));
    if(!c) return false;
    c.biomass=clamp(Math.floor(biomass||1),1,MAX_BIOMASS);
    c.maxHp=maxHpForBiomass(c.biomass);
    c.hp=clamp(c.hp,1,c.maxHp);
    c.feedPulse=1.0;
    return true;
  }
  function debugSetLeaves(player,leaves){
    const c=debugNearest(player,999999,isLeafMonster);
    if(!c) return false;
    const mass=leafMass({leaves});
    c.leaves=mass;
    c.biomass=mass;
    c.maxHp=maxHpForLeaves(mass);
    c.hp=clamp(c.hp,1,c.maxHp);
    c.genome=normalizeLeafGenome(c.genome,c.seed,mass);
    c.feedPulse=1.0;
    return true;
  }
  function debugSetClay(player,clay){
    const c=debugNearest(player,999999,isClayGolem);
    if(!c) return false;
    const mass=clayMass({clay});
    const before=c.maxHp;
    c.clay=mass;
    c.biomass=mass;
    c.maxHp=maxHpForClay(mass);
    c.hp=clamp(c.hp+(c.maxHp-before),1,c.maxHp);
    c.genome=normalizeClayGenome(Object.assign({},c.genome,{clay:mass}),c.seed,mass);
    c.feedPulse=1.0;
    c.shieldPulse=Math.max(c.shieldPulse||0,0.35);
    sparks(c.x,c.y-0.55,'rare',12);
    return true;
  }
  function debugSetWater(player,water){
    const c=debugNearest(player,999999,isWaterGolem);
    if(!c) return false;
    const mass=waterMass({water});
    const before=c.maxHp;
    c.water=mass;
    c.biomass=mass;
    c.maxHp=maxHpForWater(mass);
    c.hp=clamp(c.hp+(c.maxHp-before),1,c.maxHp);
    c.genome=normalizeWaterGenome(Object.assign({},c.genome,{water:mass}),c.seed,mass);
    c.feedPulse=1.0;
    c.wateredT=1.8;
    sparks(c.x,c.y-0.45,'common',12);
    return true;
  }
  function debugSetMeat(player,meat){
    const c=debugNearest(player,999999,isMeatGolem);
    if(!c) return false;
    const mass=meatMass({meat});
    const before=c.maxHp;
    c.meat=mass;
    c.biomass=mass;
    c.maxHp=maxHpForMeat(mass);
    c.hp=clamp(c.hp+(c.maxHp-before),1,c.maxHp);
    c.genome=normalizeMeatGenome(Object.assign({},c.genome,{meat:mass}),c.seed,mass);
    c.feedPulse=1.0;
    sparks(c.x,c.y-0.45,'common',12);
    return true;
  }
  function debugSetLava(player,lava){
    const c=debugNearest(player,999999,isMolekin);
    if(!c) return false;
    const mass=lavaMass({lava});
    const before=c.maxHp;
    c.lava=mass;
    c.biomass=mass;
    c.maxHp=maxHpForMolekin(mass,molekinRole(c));
    c.hp=clamp(c.hp+(c.maxHp-before),1,c.maxHp);
    c.genome=normalizeMolekinGenome(Object.assign({},c.genome,{lava:mass}),c.seed,mass,molekinRole(c));
    c.feedPulse=1.0;
    sparks(c.x,c.y-0.42,'rare',12);
    return true;
  }
  function debugRotMeatGolem(player){
    const c=debugNearest(player,999999,isRawMeatGolem);
    if(!c) return false;
    c.age=MEAT_GOLEM_ROT_SECONDS;
    return rotMeatGolem(c);
  }
  function debugCookMeatGolem(player){
    const c=debugNearest(player,999999,isMeatGolem);
    if(!c) return false;
    return cookMeatGolem(c,'debug');
  }
  function debugHeal(player){
    const c=debugNearest(player,999999);
    if(!c) return false;
    c.hp=c.maxHp;
    c.feedPulse=0.8;
    sparks(c.x,c.y-0.55,'rare',10);
    return true;
  }
  function debugDamage(player,amount){
    const c=debugNearest(player,999999);
    if(!c) return false;
    damage(c,Math.max(1,Number(amount)||20),'debug');
    return true;
  }
  function debugKill(player){
    const c=debugNearest(player,999999);
    if(!c) return false;
    damage(c,c.hp+c.maxHp*4+999,'debug');
    return true;
  }
  function debugTeleportToHero(player,getTile){
    const c=debugNearest(player,999999);
    return teleportToHero(c,player,getTile,1.15,true);
  }
  function debugForceGas(player,getTile,setTile){
    const c=debugNearest(player,999999,c=>!isClayGolem(c) && !isLeafMonster(c) && !isWaterGolem(c) && !isMeatGolem(c) && !isFriedChicken(c) && !isMolekin(c));
    if(!c) return false;
    emitPoison(c,getTile,setTile);
    return true;
  }
  function debugForceLaser(player,getTile){
    const c=debugNearest(player,999999,c=>!isClayGolem(c) && !isWaterGolem(c) && !isMeatGolem(c) && !isFriedChicken(c) && !isMolekin(c));
    if(!c) return false;
    const t=nearestHostile(c,player,getTile);
    if(!t) return false;
    fireLaser(c,t);
    c.laserCd=LASER_COOLDOWN;
    return true;
  }
  function debugForceMolekinFire(player,getTile,setTile){
    const c=debugNearest(player,999999,isMolekin);
    if(!c) return false;
    const t=nearestHostile(c,player,getTile);
    if(!t) return false;
    return molekinFireStrike(c,t,getTile,setTile);
  }
  function debugGuardHero(player,amount){
    const result=absorbHeroDamage(Math.max(1,Number(amount)||30),{cause:'debug'},player);
    return result && result.absorbed>0 ? result : null;
  }
  function debugShieldGolem(player){
    const c=debugNearest(player,999999,isClayGolem);
    if(!c) return false;
    c.shieldPulse=Math.max(c.shieldPulse||0,0.85);
    c.feedPulse=Math.max(c.feedPulse||0,0.25);
    c.guardCd=0;
    sparks(c.x,c.y-0.75,'rare',10);
    sfx('charge',c);
    return true;
  }
  function debugForceGolemStrike(player,getTile){
    const c=debugNearest(player,999999,isClayGolem);
    if(!c) return false;
    const t=nearestHostile(c,player,getTile);
    if(!t) return false;
    return clayGolemStrike(c,t);
  }
  function debugForceWaterSpray(player,getTile){
    const c=debugNearest(player,999999,isWaterGolem);
    if(!c) return false;
    const traits=traitsFor(c);
    const t=nearestFireTarget(c,getTile,traits.laserRange+1.6) || nearestHostile(c,player,getTile);
    if(!t) return false;
    return waterSprayTarget(c,t,getTile);
  }
  function debugClear(){
    reset();
    return true;
  }
  function drawLaser(ctx,tile,l){
    const a=1-clamp(l.life/l.max,0,1);
    const r=prng(l.seed);
    ctx.save();
    if(l.kind==='water'){
      ctx.globalAlpha=0.62*a;
      ctx.strokeStyle=l.color || '#b8f3ff';
      ctx.lineWidth=4.2;
      ctx.lineCap='round';
      const mx=(l.x1+l.x2)*0.5+(r()*0.34-0.17);
      const my=(l.y1+l.y2)*0.5+(r()*0.34-0.17);
      ctx.beginPath();
      ctx.moveTo(l.x1*tile,l.y1*tile);
      ctx.quadraticCurveTo(mx*tile,my*tile,l.x2*tile,l.y2*tile);
      ctx.stroke();
      ctx.globalAlpha=0.82*a;
      ctx.fillStyle='rgba(232,255,255,0.85)';
      for(let i=0;i<7;i++){
        const t=(i+1)/8;
        const px=(l.x1+(l.x2-l.x1)*t+(r()*0.22-0.11))*tile;
        const py=(l.y1+(l.y2-l.y1)*t+(r()*0.22-0.11))*tile;
        ctx.beginPath();
        ctx.arc(px,py,Math.max(1.2,tile*(0.030+r()*0.030))*a,0,Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    if(l.kind==='mole_fire' || l.kind==='mole_lava' || l.kind==='mole_heal'){
      const lava=l.kind==='mole_lava';
      const heal=l.kind==='mole_heal';
      ctx.globalAlpha=(heal?0.68:0.78)*a;
      ctx.strokeStyle=l.color || (heal?'#ffc96f':(lava?'#ff552e':'#ffb45c'));
      ctx.lineWidth=lava?4.4:(heal?3.6:3.2);
      ctx.lineCap='round';
      const mx=(l.x1+l.x2)*0.5+(r()*0.40-0.20);
      const my=(l.y1+l.y2)*0.5+(r()*0.32-0.16)-(lava?0.05:0);
      ctx.beginPath();
      ctx.moveTo(l.x1*tile,l.y1*tile);
      ctx.quadraticCurveTo(mx*tile,my*tile,l.x2*tile,l.y2*tile);
      ctx.stroke();
      ctx.globalAlpha=(heal?0.55:0.88)*a;
      ctx.fillStyle=heal?'rgba(255,226,156,0.82)':(lava?'rgba(255,86,38,0.84)':'rgba(255,184,84,0.82)');
      for(let i=0;i<(lava?9:6);i++){
        const t=(i+1)/(lava?10:7);
        const px=(l.x1+(l.x2-l.x1)*t+(r()*0.26-0.13))*tile;
        const py=(l.y1+(l.y2-l.y1)*t+(r()*0.22-0.11))*tile;
        ctx.beginPath();
        ctx.arc(px,py,Math.max(1.1,tile*(0.025+r()*0.035))*a,0,Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    ctx.globalAlpha=0.85*a;
    ctx.strokeStyle=l.color;
    ctx.lineWidth=3.2;
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(l.x1*tile,l.y1*tile);
    const mx=(l.x1+l.x2)*0.5+(r()*0.22-0.11);
    const my=(l.y1+l.y2)*0.5+(r()*0.22-0.11);
    ctx.quadraticCurveTo(mx*tile,my*tile,l.x2*tile,l.y2*tile);
    ctx.stroke();
    ctx.globalAlpha=0.95*a;
    ctx.strokeStyle='#f4ffff';
    ctx.lineWidth=1.1;
    ctx.beginPath();
    ctx.moveTo(l.x1*tile,l.y1*tile);
    ctx.quadraticCurveTo(mx*tile,my*tile,l.x2*tile,l.y2*tile);
    ctx.stroke();
    ctx.restore();
  }
  function drawDeathFx(ctx,tile,fx){
    const p=clamp(fx.t/fx.max,0,1);
    ctx.save();
    ctx.globalAlpha=(1-p)*0.55;
    ctx.strokeStyle=fx.color || '#baff72';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(fx.x*tile,fx.y*tile,(0.25+p*2.4)*tile,0,Math.PI*2);
    ctx.stroke();
    ctx.fillStyle=fx.fill || 'rgba(140,255,110,0.22)';
    ctx.beginPath();
    ctx.arc(fx.x*tile,fx.y*tile,(0.18+p*1.1)*tile,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  function drawTail(ctx,tile,g,w,h,c){
    if(!g.tail || g.tail==='none') return;
    const sway=Math.sin(c.age*4.4+g.pulse)*tile*0.08;
    ctx.save();
    ctx.strokeStyle=mixColor(g.secondary,g.primary,0.25);
    ctx.fillStyle=mixColor(g.secondary,g.glow,0.20);
    ctx.lineWidth=Math.max(2,tile*0.08);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(-w*0.38,-h*0.38);
    ctx.quadraticCurveTo(-w*0.78,-h*0.42+sway,-w*(g.tail==='whip'?1.05:0.82),-h*(g.tail==='fork'?0.68:0.26)+sway);
    ctx.stroke();
    const ex=-w*(g.tail==='whip'?1.05:0.82), ey=-h*(g.tail==='fork'?0.68:0.26)+sway;
    if(g.tail==='club'){
      ctx.beginPath(); ctx.ellipse(ex,ey,tile*0.13,tile*0.09,0,0,Math.PI*2); ctx.fill();
    }else if(g.tail==='fork'){
      ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*0.16,ey-tile*0.12); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*0.17,ey+tile*0.11); ctx.stroke();
    }else if(g.tail==='fan'){
      ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*0.22,ey-tile*0.16); ctx.lineTo(ex-tile*0.25,ey+tile*0.16); ctx.closePath(); ctx.fill();
    }else if(g.tail==='spark'){
      ctx.strokeStyle=g.glow; ctx.lineWidth=Math.max(1,tile*0.04);
      for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*(0.12+0.04*i),ey+tile*((i-1)*0.09)); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawBackFeatures(ctx,tile,g,w,h,c){
    if(g.crest==='halo' || g.body==='lantern'){
      ctx.save();
      ctx.globalAlpha=0.22+0.08*Math.sin(c.age*4+g.pulse);
      ctx.strokeStyle=g.glow;
      ctx.lineWidth=Math.max(1,tile*0.06);
      ctx.beginPath();
      ctx.ellipse(0,-h*0.70,w*0.70,h*0.34,0,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
    if(g.body==='blade' || g.crest==='frill'){
      ctx.save();
      ctx.fillStyle=mixColor(g.secondary,g.primary,0.22);
      ctx.globalAlpha=0.72;
      ctx.beginPath();
      ctx.moveTo(-w*0.62,-h*0.42);
      ctx.lineTo(-w*0.92,-h*0.74);
      ctx.lineTo(-w*0.54,-h*0.70);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w*0.62,-h*0.42);
      ctx.lineTo(w*0.92,-h*0.74);
      ctx.lineTo(w*0.54,-h*0.70);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  function drawLegs(ctx,tile,g,w,h,c){
    if(g.legStyle==='hover'){
      ctx.save();
      ctx.globalAlpha=0.42+0.08*Math.sin(c.age*7+g.pulse);
      ctx.fillStyle=g.glow;
      for(let i=0;i<3;i++){
        const x=(-0.32+i*0.32)*w;
        ctx.beginPath(); ctx.ellipse(x,-tile*0.02,tile*0.12,tile*0.035,0,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
      return;
    }
    for(let i=0;i<g.legs;i++){
      const t=(i/(Math.max(1,g.legs-1)))-0.5;
      const side=i%2===0 ? -1 : 1;
      const step=Math.sin(c.age*(g.legStyle==='crawler'?12:8)+i)*tile*(g.legStyle==='stub'?0.03:0.08);
      ctx.strokeStyle=g.legStyle==='talon' ? mixColor(g.secondary,'#111111',0.65) : '#233424';
      ctx.lineWidth=Math.max(2,tile*(g.legStyle==='stub'?0.10:0.075));
      ctx.beginPath();
      ctx.moveTo(t*w*0.52,-h*0.18);
      if(g.legStyle==='spider'){
        ctx.lineTo((t*w*0.88)+side*tile*0.10,-h*0.34+step);
        ctx.lineTo((t*w*0.96)+side*tile*0.18,-tile*0.02+step);
      }else if(g.legStyle==='talon'){
        ctx.lineTo((t*w*0.68)+side*tile*0.07,-tile*0.02+step);
        ctx.lineTo((t*w*0.82)+side*tile*0.15,tile*0.04+step);
      }else{
        ctx.lineTo((t*w*0.70)+side*tile*0.07,-tile*0.02+step);
      }
      ctx.stroke();
    }
  }
  function eyePositions(g,w,h){
    const count=g.eyes;
    const pts=[];
    if(g.eyeLayout==='stack'){
      for(let i=0;i<count;i++) pts.push({x:g.asym*w*0.18,y:-h*(0.44+i*0.08),s:1});
    }else if(g.eyeLayout==='triad'){
      const base=[{x:-0.18*w,y:-0.58*h},{x:0.18*w,y:-0.58*h},{x:0,y:-0.70*h},{x:-0.34*w,y:-0.50*h},{x:0.34*w,y:-0.50*h},{x:0,y:-0.42*h}];
      for(let i=0;i<count;i++) pts.push(Object.assign({s:1},base[i%base.length]));
    }else if(g.eyeLayout==='halo'){
      for(let i=0;i<count;i++){ const a=(i/count)*Math.PI*2; pts.push({x:Math.cos(a)*w*0.28,y:-h*0.58+Math.sin(a)*h*0.16,s:0.82}); }
    }else if(g.eyeLayout==='split'){
      for(let i=0;i<count;i++){ const side=i%2===0?-1:1; pts.push({x:side*w*(0.16+0.08*Math.floor(i/2)),y:-h*(0.53+0.08*(i%3)),s:1}); }
    }else if(g.eyeLayout==='visor'){
      pts.push({x:0,y:-h*0.57,s:2.5,visor:true});
      for(let i=1;i<count;i++) pts.push({x:(i%2?1:-1)*w*(0.26+0.04*i),y:-h*0.48,s:0.7});
    }else{
      for(let i=0;i<count;i++){
        const t=(i/(Math.max(1,count-1)))-0.5;
        pts.push({x:t*w*0.52 + g.asym*w*0.12,y:-h*(0.56+0.08*Math.sin(i+g.pulse)),s:1});
      }
    }
    return pts;
  }
  function drawMarkings(ctx,tile,g,w,h,c){
    if(g.marking==='none' && !g.stripe) return;
    ctx.save();
    ctx.globalAlpha=0.22;
    ctx.fillStyle='#ffffff';
    ctx.strokeStyle=g.glow;
    ctx.lineWidth=Math.max(1,tile*0.035);
    if(g.marking==='spots'){
      for(let i=0;i<g.plates+2;i++){
        const x=(-0.35+((i*37)%100)/100*0.70)*w;
        const y=-h*(0.30+((i*53)%100)/100*0.48);
        ctx.beginPath(); ctx.arc(x,y,tile*(0.025+0.008*(i%3)),0,Math.PI*2); ctx.fill();
      }
    }else if(g.marking==='runes'){
      for(let i=0;i<g.plates;i++){
        const x=(-0.30+i*(0.60/Math.max(1,g.plates-1)))*w;
        ctx.beginPath(); ctx.moveTo(x,-h*0.72); ctx.lineTo(x+tile*0.08,-h*0.63); ctx.lineTo(x-tile*0.02,-h*0.55); ctx.stroke();
      }
    }else if(g.marking==='split'){
      ctx.fillRect(-tile*0.03,-h*0.86,tile*0.06,h*0.66);
    }else if(g.marking==='veins'){
      for(let i=0;i<4;i++){
        const x=(-0.35+i*0.23)*w;
        ctx.beginPath(); ctx.moveTo(x,-h*0.74); ctx.quadraticCurveTo(x+Math.sin(c.age+i)*tile*0.05,-h*0.56,x+tile*0.05,-h*0.34); ctx.stroke();
      }
    }else{
      for(let i=0;i<g.plates;i++){
        const x=(-0.34+i*(0.68/Math.max(1,g.plates-1)))*w;
        ctx.fillRect(x-tile*0.025,-h*0.78,tile*0.05,h*0.46);
      }
    }
    ctx.restore();
  }
  function drawGlowPattern(ctx,tile,g,w,h,c){
    const mode=(g.glowPattern|0)%5;
    const pulse=(Math.sin(c.age*5.5+g.pulse)+1)*0.5;
    ctx.save();
    ctx.globalAlpha=0.18+0.20*pulse;
    ctx.strokeStyle=mixColor(g.glow,'#ffffff',0.22);
    ctx.fillStyle=g.glow;
    ctx.lineWidth=Math.max(1,tile*0.04);
    if(mode===0){
      ctx.beginPath();
      ctx.arc(g.coreX*tile,-h*0.52,tile*(0.16+0.04*pulse),0,Math.PI*2);
      ctx.stroke();
    }else if(mode===1){
      for(let i=0;i<4;i++){
        const x=(-0.30+i*0.20)*w + g.asym*w*0.08;
        const y=-h*(0.38+0.07*(i%2));
        ctx.beginPath();
        ctx.arc(x,y,tile*(0.035+0.012*pulse),0,Math.PI*2);
        ctx.fill();
      }
    }else if(mode===2){
      ctx.beginPath();
      ctx.moveTo(g.coreX*tile,-h*0.72);
      ctx.lineTo(g.coreX*tile,-h*0.30);
      ctx.moveTo(g.coreX*tile,-h*0.55);
      ctx.lineTo(g.coreX*tile+w*0.22,-h*0.46);
      ctx.moveTo(g.coreX*tile,-h*0.48);
      ctx.lineTo(g.coreX*tile-w*0.20,-h*0.38);
      ctx.stroke();
    }else if(mode===3){
      for(let i=0;i<3;i++){
        const a=c.age*1.8+g.pulse+i*Math.PI*2/3;
        ctx.beginPath();
        ctx.arc(Math.cos(a)*w*0.36,-h*0.53+Math.sin(a)*h*0.22,tile*0.035,0,Math.PI*2);
        ctx.fill();
      }
    }else{
      for(let i=0;i<3;i++){
        const y=-h*(0.36+i*0.13);
        ctx.beginPath();
        ctx.moveTo(-w*0.22,y);
        ctx.lineTo(0,y-tile*0.07);
        ctx.lineTo(w*0.22,y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawLeafBlade(ctx,x,y,rx,ry,rot,fill,stroke){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(rot);
    ctx.fillStyle=fill;
    ctx.strokeStyle=stroke;
    ctx.lineWidth=Math.max(1,Math.min(rx,ry)*0.10);
    ctx.beginPath();
    ctx.moveTo(0,-ry);
    ctx.bezierCurveTo(rx*0.92,-ry*0.55,rx*0.86,ry*0.42,0,ry);
    ctx.bezierCurveTo(-rx*0.86,ry*0.42,-rx*0.92,-ry*0.55,0,-ry);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle=mixColor(stroke,'#ffffff',0.16);
    ctx.lineWidth=Math.max(1,Math.min(rx,ry)*0.055);
    ctx.beginPath();
    ctx.moveTo(0,-ry*0.74);
    ctx.lineTo(0,ry*0.72);
    ctx.stroke();
    ctx.restore();
  }
  function commandBadgeKind(c){
    if(command.mode==='harvest') return command.awaiting ? 'ask' : ((command.harvestBadgeT||0)>0 ? 'pickaxe' : '');
    if(command.mode==='transport' && isLeafMonster(c) && !c.transportMounted && (command.transportBadgeT||0)>0) return 'transport';
    if(command.mode==='attack' && (command.fightBadgeT||0)>0) return 'swords';
    return '';
  }
  function drawCommandInterfaceIcon(ctx,tile,kind){
    const icon=COMMAND_BADGE_ICONS[kind] || '?';
    ctx.font=Math.max(12,tile*0.54)+'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillStyle=kind==='pickaxe' ? '#d7ffc7' : (kind==='transport' ? '#dffcff' : '#f2f7ff');
    ctx.fillText(icon,0,tile*0.01);
  }
  function drawCommandBadge(ctx,tile,c,px,py,h){
    const kind=commandBadgeKind(c);
    if(!kind) return;
    const by=py-h-tile*(c.hp<c.maxHp?0.54:0.34);
    const timer=kind==='swords' ? command.fightBadgeT : (kind==='pickaxe' ? command.harvestBadgeT : (kind==='transport' ? command.transportBadgeT : 1));
    const alpha=kind==='ask' ? 1 : clamp((timer||0)/0.45,0,1);
    const bw=kind==='ask' ? tile*0.62 : tile*0.78;
    const bh=tile*0.56;
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.fillStyle=kind==='ask' ? 'rgba(20,24,31,0.82)' : (kind==='pickaxe' ? 'rgba(25,56,37,0.78)' : (kind==='transport' ? 'rgba(24,55,62,0.80)' : 'rgba(42,33,35,0.82)'));
    if(ctx.roundRect){
      ctx.beginPath();
      ctx.roundRect(px-bw*0.5,by-bh*0.5,bw,bh,tile*0.14);
      ctx.fill();
    }else{
      ctx.fillRect(px-bw*0.5,by-bh*0.5,bw,bh);
    }
    if(kind==='ask'){
      ctx.font=Math.max(10,tile*0.48)+'px system-ui, sans-serif';
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.fillStyle='#f4fbff';
      ctx.fillText('?',px,by);
    }else{
      ctx.translate(px,by);
      drawCommandInterfaceIcon(ctx,tile,kind);
    }
    ctx.restore();
  }
  function drawLeafMonster(ctx,tile,c){
    const g=c.genome || makeLeafGenome(c.seed||1,c.leaves||LEAF_MONSTER_MIN_LEAVES);
    const px=c.x*tile, py=c.y*tile;
    const pulse=Math.sin(c.age*8.2+g.pulse);
    const windLean=clamp((c.lastWind||0)*0.035,-0.32,0.32);
    const hit=c.hitPulse>0 ? Math.sin(c.hitPulse*36)*0.12 : 0;
    const scale=(0.82+Math.min(0.24,leafMass(c)*0.018)+c.feedPulse*0.06);
    const w=tile*0.76*scale*g.width;
    const h=tile*0.82*scale*g.height;
    const facing=c.facing || 1;
    ctx.save();
    ctx.translate(px,py);
    ctx.rotate(windLean + pulse*0.025);
    ctx.scale(facing,1);
    ctx.globalAlpha=0.96;

    ctx.save();
    ctx.globalAlpha=0.16+Math.abs(pulse)*0.07;
    ctx.fillStyle=g.glow;
    ctx.beginPath();
    ctx.ellipse(0,-h*0.48,w*0.92,h*0.58,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    const leaflets=g.leaflets || 7;
    for(let i=0;i<leaflets;i++){
      const t=(i/(Math.max(1,leaflets-1)))-0.5;
      const side=t<0?-1:1;
      const spread=Math.abs(t);
      const lx=t*w*(0.72+g.fan*0.30);
      const ly=-h*(0.45+0.34*(1-spread)) + Math.sin(c.age*6.0+i+g.pulse)*tile*0.035;
      const rot=t*1.35 + windLean*0.8 + g.curl*0.35;
      const rx=w*(0.22+0.10*(1-spread));
      const ry=h*(0.30+0.12*(1-spread));
      const fill=i%2 ? mixColor(g.primary,g.edge,0.20) : mixColor(g.primary,g.secondary,0.16);
      drawLeafBlade(ctx,lx,ly,rx,ry,rot,fill,mixColor(g.secondary,'#102514',0.20));
      if(g.wings==='split' && i===Math.floor(leaflets*0.5)){
        drawLeafBlade(ctx,side*w*0.12,ly-h*0.12,rx*0.65,ry*0.74,rot+side*0.55,g.edge,g.secondary);
      }
    }

    ctx.strokeStyle=mixColor(g.stem,g.secondary,0.18);
    ctx.lineWidth=Math.max(1,tile*0.055);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(0,-h*0.92);
    ctx.quadraticCurveTo(g.asym*w*0.20,-h*0.50,0,-h*0.08);
    ctx.stroke();

    ctx.fillStyle=mixColor(g.secondary,g.primary,0.32);
    ctx.strokeStyle=hit>0 ? '#f8fff2' : mixColor(g.secondary,'#0f220d',0.25);
    ctx.lineWidth=Math.max(1,tile*0.06);
    ctx.beginPath();
    if(g.silhouette==='seed'){
      ctx.ellipse(0,-h*0.48,w*0.32,h*0.36,0,0,Math.PI*2);
    }else if(g.silhouette==='crown'){
      ctx.moveTo(-w*0.34,-h*0.20);
      ctx.lineTo(-w*0.22,-h*0.76);
      ctx.lineTo(0,-h*0.96);
      ctx.lineTo(w*0.24,-h*0.72);
      ctx.lineTo(w*0.34,-h*0.20);
      ctx.closePath();
    }else{
      ctx.ellipse(0,-h*0.46,w*0.36,h*0.40,g.asym*0.18,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();

    for(let i=0;i<g.veins;i++){
      const t=(i/(Math.max(1,g.veins-1)))-0.5;
      ctx.strokeStyle='rgba(238,255,190,0.32)';
      ctx.lineWidth=Math.max(1,tile*0.025);
      ctx.beginPath();
      ctx.moveTo(0,-h*(0.30+Math.abs(t)*0.34));
      ctx.lineTo(t*w*0.50,-h*(0.44+Math.abs(t)*0.34));
      ctx.stroke();
    }

    if(g.antenna){
      ctx.strokeStyle=g.stem;
      ctx.lineWidth=Math.max(1,tile*0.035);
      for(let s=-1;s<=1;s+=2){
        ctx.beginPath();
        ctx.moveTo(s*w*0.10,-h*0.78);
        ctx.quadraticCurveTo(s*w*0.34,-h*1.04+Math.sin(c.age*8+s)*tile*0.05,s*w*0.45,-h*0.86);
        ctx.stroke();
      }
    }

    const eyeCount=g.eyeCount || 2;
    for(let i=0;i<eyeCount;i++){
      const t=(i/(Math.max(1,eyeCount-1)))-0.5;
      const ex=t*w*0.30;
      const ey=-h*g.eyeY;
      ctx.fillStyle=mixColor(g.glow,'#ffffff',0.22);
      ctx.fillRect(ex-tile*0.040,ey-tile*0.030,tile*0.080,tile*0.060);
      ctx.fillStyle='#173012';
      ctx.fillRect(ex+(facing>0?tile*0.010:-tile*0.026),ey-tile*0.020,tile*0.026,tile*0.040);
    }

    for(let i=0;i<g.tatters;i++){
      const t=(i/(Math.max(1,g.tatters-1)))-0.5;
      ctx.fillStyle=i%2 ? g.edge : g.primary;
      ctx.globalAlpha=0.72;
      ctx.beginPath();
      ctx.moveTo(t*w*0.80,-h*0.08);
      ctx.lineTo(t*w*0.90+Math.sin(c.age*7+i)*tile*0.035,h*0.10);
      ctx.lineTo(t*w*0.70,h*0.03);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha=0.96;

    if(isTransportMode()){
      const rideGlow=Math.max(c.transportMounted?1:0,(c.transportPulse||0));
      ctx.save();
      ctx.globalAlpha=0.34+0.30*clamp(rideGlow,0,1);
      ctx.strokeStyle=mixColor(g.glow,'#ffffff',0.32);
      ctx.fillStyle='rgba(210,255,238,0.10)';
      ctx.lineWidth=Math.max(1,tile*0.040);
      ctx.beginPath();
      ctx.ellipse(0,-h*0.98,w*0.46,tile*0.13,0,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w*0.28,-h*0.92);
      ctx.quadraticCurveTo(0,-h*1.05,w*0.28,-h*0.92);
      ctx.stroke();
      ctx.restore();
    }

    if(c.hp<c.maxHp){
      const bw=tile*0.95, bh=Math.max(3,tile*0.10);
      ctx.fillStyle='rgba(0,0,0,0.50)';
      ctx.fillRect(-bw*0.5,-h-tile*0.28,bw,bh);
      ctx.fillStyle=c.hp/c.maxHp>0.35 ? '#8fd06a' : '#ff775f';
      ctx.fillRect(-bw*0.5,-h-tile*0.28,bw*clamp(c.hp/c.maxHp,0,1),bh);
    }

    ctx.restore();
    drawCommandBadge(ctx,tile,c,px,py,h);
  }
  function drawCompanion(ctx,tile,c){
    const g=c.genome || makeGenome(c.seed||1);
    const growth=(1+Math.min(0.46,c.biomass*0.018)+c.feedPulse*0.08)*g.size;
    const pulse=Math.sin(c.age*5.2+g.pulse)*0.04;
    const hit=c.hitPulse>0 ? Math.sin(c.hitPulse*32)*0.12 : 0;
    const px=c.x*tile, py=c.y*tile;
    const w=tile*((0.70*growth+Math.abs(g.asym)*0.12)*g.width);
    const h=tile*(0.86*growth+pulse);
    const facing=c.facing || 1;
    ctx.save();
    ctx.translate(px,py);
    ctx.scale(facing,1);
    ctx.globalAlpha=0.98;
    drawTail(ctx,tile,g,w,h,c);
    drawBackFeatures(ctx,tile,g,w,h,c);

    for(let i=0;i<g.tendrils;i++){
      const t=(i/(Math.max(1,g.tendrils-1)))-0.5;
      const sway=Math.sin(c.age*3+i)*tile*0.06;
      ctx.strokeStyle=mixColor(g.secondary,g.primary,0.35);
      ctx.lineWidth=Math.max(1,tile*0.055);
      ctx.beginPath();
      ctx.moveTo(t*w*0.55,-h*0.18);
      ctx.quadraticCurveTo((t*w*0.72)+sway,-h*0.55, t*w*0.48+sway*0.4,-h*(0.88+0.1*(i%2)));
      ctx.stroke();
    }

    drawLegs(ctx,tile,g,w,h,c);

    const grad=ctx.createRadialGradient(g.coreX*tile, -h*0.54, tile*0.08, g.coreX*tile, -h*0.48, Math.max(w,h)*0.72);
    grad.addColorStop(0,mixColor(g.glow,'#ffffff',0.28));
    grad.addColorStop(0.45,g.primary);
    grad.addColorStop(1,g.secondary);
    ctx.fillStyle=grad;
    ctx.strokeStyle=hit>0 ? '#f8fff2' : '#1b2b21';
    ctx.lineWidth=Math.max(1,tile*0.08);
    ctx.beginPath();
    if(g.body==='orb'){
      ctx.ellipse(0,-h*0.48,w*0.50,h*0.46,0,0,Math.PI*2);
    }else if(g.body==='runner'){
      if(ctx.roundRect) ctx.roundRect(-w*0.50,-h*0.87,w,h*0.70,tile*0.16);
      else ctx.rect(-w*0.50,-h*0.87,w,h*0.70);
    }else if(g.body==='spine'){
      ctx.moveTo(-w*0.48,-h*0.18);
      ctx.lineTo(-w*0.38,-h*0.76);
      ctx.lineTo(g.asym*w*0.35,-h*1.02);
      ctx.lineTo(w*0.48,-h*0.72);
      ctx.lineTo(w*0.42,-h*0.16);
      ctx.closePath();
    }else if(g.body==='crown'){
      ctx.moveTo(-w*0.50,-h*0.20);
      ctx.lineTo(-w*0.40,-h*0.72);
      ctx.lineTo(-w*0.10,-h*0.92);
      ctx.lineTo(w*0.12,-h*0.72);
      ctx.lineTo(w*0.42,-h*0.86);
      ctx.lineTo(w*0.50,-h*0.20);
      ctx.closePath();
    }else if(g.body==='beetle'){
      ctx.ellipse(0,-h*0.50,w*0.56,h*0.42,0,0,Math.PI*2);
      ctx.moveTo(0,-h*0.91); ctx.lineTo(0,-h*0.14);
    }else if(g.body==='lantern'){
      ctx.roundRect ? ctx.roundRect(-w*0.40,-h*0.92,w*0.80,h*0.72,tile*0.20) : ctx.rect(-w*0.40,-h*0.92,w*0.80,h*0.72);
    }else if(g.body==='blade'){
      ctx.moveTo(-w*0.50,-h*0.18);
      ctx.lineTo(-w*0.18,-h*0.90);
      ctx.lineTo(w*(0.08+g.shoulder),-h*1.06);
      ctx.lineTo(w*0.50,-h*0.22);
      ctx.closePath();
    }else if(g.body==='tripod'){
      ctx.moveTo(-w*0.46,-h*0.16);
      ctx.lineTo(0,-h*0.98);
      ctx.lineTo(w*0.46,-h*0.16);
      ctx.quadraticCurveTo(0,-h*0.36,-w*0.46,-h*0.16);
    }else{
      ctx.ellipse(0,-h*0.50,w*0.54,h*0.38,-0.05,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();

    drawMarkings(ctx,tile,g,w,h,c);

    ctx.fillStyle=g.glow;
    ctx.globalAlpha=0.86;
    ctx.beginPath();
    ctx.arc(g.coreX*tile,-h*0.52,tile*(0.09+Math.min(0.07,c.biomass*0.004)),0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=0.98;

    drawGlowPattern(ctx,tile,g,w,h,c);

    const eyes=eyePositions(g,w,h);
    for(const e of eyes){
      const ex=e.x, ey=e.y, scale=e.s||1;
      ctx.fillStyle='#ecfff5';
      if(e.visor){
        ctx.fillRect(ex-tile*0.16*scale,ey-tile*0.035,tile*0.32*scale,tile*0.07);
        ctx.fillStyle=g.laser; ctx.fillRect(ex-tile*0.08*scale,ey-tile*0.018,tile*0.16*scale,tile*0.035);
        continue;
      }
      ctx.fillRect(ex-tile*0.055*scale,ey-tile*0.045*scale,tile*0.11*scale,tile*0.09*scale);
      ctx.fillStyle='#10242a';
      ctx.fillRect(ex+(c.facing>0?tile*0.018:-tile*0.028)*scale,ey-tile*0.025*scale,tile*0.035*scale,tile*0.05*scale);
    }

    ctx.strokeStyle=mixColor(g.glow,'#ffffff',0.15);
    ctx.lineWidth=Math.max(1,tile*0.055);
    const hornCount=g.crest==='horns' ? Math.max(g.horns,2) : g.horns;
    for(let i=0;i<hornCount;i++){
      const t=(i/(Math.max(1,g.horns-1)))-0.5;
      ctx.beginPath();
      ctx.moveTo(t*w*0.42,-h*0.82);
      ctx.lineTo(t*w*0.48+tile*0.08*Math.sign(t||0.4),-h*(1.02+0.04*i));
      ctx.stroke();
    }
    if(g.crest==='spines'){
      for(let i=0;i<g.plates;i++){
        const x=(-0.36+i*(0.72/Math.max(1,g.plates-1)))*w;
        ctx.beginPath(); ctx.moveTo(x,-h*0.78); ctx.lineTo(x+tile*0.03,-h*(0.96+0.02*(i%2))); ctx.stroke();
      }
    }
    if(g.antenna || g.crest==='antenna'){
      ctx.strokeStyle=g.glow;
      ctx.beginPath();
      ctx.moveTo(w*0.18,-h*0.78);
      ctx.quadraticCurveTo(w*0.38,-h*1.05,w*0.25,-h*1.18);
      ctx.stroke();
      ctx.fillStyle=g.glow;
      ctx.beginPath();
      ctx.arc(w*0.25,-h*1.18,tile*0.045,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    if(c.hp<c.maxHp){
      const bw=tile*1.05, bh=Math.max(3,tile*0.11);
      ctx.fillStyle='rgba(0,0,0,0.48)';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw,bh);
      ctx.fillStyle=c.hp/c.maxHp>0.35 ? '#7dff85' : '#ff6a5f';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw*clamp(c.hp/c.maxHp,0,1),bh);
    }
    drawCommandBadge(ctx,tile,c,px,py,h);
  }
  function drawClayPebbles(ctx,tile,g,w,h){
    ctx.save();
    for(let i=0;i<g.pebbles;i++){
      const r=prng(g.seed+i*101);
      const x=(-0.38+r()*0.76)*w;
      const y=-h*(0.18+r()*0.58);
      ctx.fillStyle=r()<0.5 ? mixColor(g.secondary,g.primary,0.35) : mixColor(g.highlight,g.primary,0.30);
      ctx.globalAlpha=0.34+r()*0.24;
      ctx.beginPath();
      ctx.ellipse(x,y,tile*(0.025+r()*0.035),tile*(0.018+r()*0.026),r()*0.8,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawWaterGolem(ctx,tile,c){
    const g=normalizeWaterGenome(c.genome,c.seed||1,waterMass(c));
    const mass=waterMass(c);
    const px=c.x*tile, py=c.y*tile;
    const pulse=Math.sin(c.age*4.9+g.swirl*2.2);
    const wobble=Math.sin(c.age*6.2+g.wave*2.5);
    const hit=c.hitPulse>0 ? Math.sin(c.hitPulse*34)*0.10 : 0;
    const thirsty=clamp(1-(c.wateredT||0)/1.8,0,1);
    const scale=0.92+Math.min(0.28,mass*0.018)+c.feedPulse*0.06-thirsty*0.08;
    const w=tile*(0.82+mass*0.017)*scale*g.shoulder;
    const h=tile*(1.12+mass*0.014)*scale;
    const facing=c.facing || 1;
    ctx.save();
    ctx.translate(px,py);
    ctx.scale(facing,1);
    ctx.rotate(wobble*0.018);

    ctx.save();
    ctx.globalAlpha=0.22;
    ctx.fillStyle='rgba(10,35,62,0.50)';
    ctx.beginPath();
    ctx.ellipse(0,tile*0.05,w*0.68,tile*0.13,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      ctx.fillStyle=mixColor(g.secondary,g.primary,0.35);
      ctx.globalAlpha=g.transparency*0.78;
      ctx.beginPath();
      ctx.ellipse(side*w*0.27,-h*0.14+wobble*tile*0.025*side,w*0.20,h*0.28,side*0.08,0,Math.PI*2);
      ctx.fill();
    }

    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      const swing=pulse*side*tile*0.055;
      ctx.fillStyle=mixColor(g.primary,g.secondary,0.20);
      ctx.strokeStyle='rgba(214,250,255,0.42)';
      ctx.lineWidth=Math.max(1,tile*0.045);
      ctx.globalAlpha=g.transparency*0.84;
      ctx.beginPath();
      ctx.ellipse(side*w*0.62, -h*0.48+swing, w*0.16*g.armScale, h*(g.arms==='stream'?0.38:0.30), side*0.20, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
      if(g.arms==='splash' || g.arms==='stream'){
        ctx.fillStyle=g.foam;
        ctx.globalAlpha=0.55;
        ctx.beginPath();
        ctx.arc(side*w*0.70,-h*0.18+swing,tile*0.10,0,Math.PI*2);
        ctx.fill();
      }
    }

    const grad=ctx.createRadialGradient(g.coreX*tile,-h*g.coreY,tile*0.05,0,-h*0.50,Math.max(w,h)*0.72);
    grad.addColorStop(0,mixColor(g.highlight,g.foam,0.20));
    grad.addColorStop(0.48,g.primary);
    grad.addColorStop(1,g.secondary);
    ctx.fillStyle=grad;
    ctx.strokeStyle=hit>0 ? '#ffffff' : 'rgba(218,252,255,0.52)';
    ctx.lineWidth=Math.max(1,tile*0.060);
    ctx.globalAlpha=g.transparency*(thirsty>0.6?0.72:1);
    ctx.beginPath();
    if(g.torso==='vase'){
      ctx.moveTo(-w*0.38,-h*0.86);
      ctx.quadraticCurveTo(-w*0.68,-h*0.48,-w*0.35,-h*0.10);
      ctx.quadraticCurveTo(0,h*0.02,w*0.35,-h*0.10);
      ctx.quadraticCurveTo(w*0.68,-h*0.48,w*0.38,-h*0.86);
      ctx.quadraticCurveTo(0,-h*(1.00+0.03*pulse),-w*0.38,-h*0.86);
    }else if(g.torso==='column'){
      ctx.ellipse(0,-h*0.47,w*0.44*g.belly,h*0.54,0,0,Math.PI*2);
    }else if(g.torso==='wide'){
      ctx.ellipse(0,-h*0.45,w*0.62*g.belly,h*0.42,0,0,Math.PI*2);
    }else{
      ctx.ellipse(g.wave*w*0.06,-h*0.48,w*0.52*g.belly,h*0.48,pulse*0.05,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha=0.72;
    if(g.foamBand){
      ctx.strokeStyle=g.foam;
      ctx.lineWidth=Math.max(1,tile*0.045);
      ctx.beginPath();
      ctx.ellipse(0,-h*0.74,w*0.38,h*0.055,pulse*0.06,0,Math.PI*2);
      ctx.stroke();
    }
    for(let i=0;i<g.bubbles;i++){
      const r=prng(g.seed+i*383);
      const x=(-0.36+r()*0.72)*w;
      const y=-h*(0.18+r()*0.62)-((c.age*0.22+r()*0.4)%0.32)*h;
      ctx.strokeStyle='rgba(235,255,255,0.45)';
      ctx.lineWidth=Math.max(1,tile*0.020);
      ctx.beginPath();
      ctx.arc(x,y,tile*(0.025+r()*0.045),0,Math.PI*2);
      ctx.stroke();
    }

    const headW=w*(g.head==='crown'?0.39:0.31);
    const headH=h*(g.head==='bubble'?0.24:0.20);
    const headY=-h*(0.91+0.025*pulse);
    ctx.fillStyle=mixColor(g.primary,g.highlight,0.18);
    ctx.strokeStyle='rgba(228,255,255,0.56)';
    ctx.globalAlpha=g.transparency;
    ctx.beginPath();
    if(g.head==='crown'){
      ctx.moveTo(-headW*0.78,headY+headH*0.18);
      ctx.lineTo(-headW*0.42,headY-headH*0.55);
      ctx.lineTo(0,headY-headH*0.84);
      ctx.lineTo(headW*0.42,headY-headH*0.55);
      ctx.lineTo(headW*0.78,headY+headH*0.18);
      ctx.closePath();
    }else{
      ctx.ellipse(0,headY,headW,headH,0,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();

    for(let i=0;i<g.eyeCount;i++){
      const t=(i/(Math.max(1,g.eyeCount-1)))-0.5;
      const ex=t*headW*0.78;
      const ey=headY;
      ctx.globalAlpha=0.95;
      ctx.fillStyle=g.foam;
      ctx.fillRect(ex-tile*0.040,ey-tile*0.032,tile*0.080,tile*0.064);
      ctx.fillStyle='#083456';
      ctx.fillRect(ex+(facing>0?tile*0.010:-tile*0.026),ey-tile*0.020,tile*0.026,tile*0.040);
    }

    const coreX=g.coreX*tile, coreY=-h*g.coreY;
    ctx.globalAlpha=0.36+0.16*Math.max(0,pulse);
    ctx.fillStyle=g.core;
    ctx.beginPath();
    ctx.arc(coreX,coreY,tile*0.25,0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=0.95;
    ctx.strokeStyle=mixColor(g.core,g.foam,0.28);
    ctx.lineWidth=Math.max(1,tile*0.04);
    ctx.beginPath();
    ctx.moveTo(coreX,coreY-tile*0.15);
    ctx.lineTo(coreX+tile*0.15,coreY);
    ctx.lineTo(coreX,coreY+tile*0.15);
    ctx.lineTo(coreX-tile*0.15,coreY);
    ctx.closePath();
    ctx.stroke();

    for(let i=0;i<g.droplets;i++){
      const r=prng(g.seed+i*911);
      ctx.fillStyle=i%2 ? g.highlight : g.foam;
      ctx.globalAlpha=0.46;
      ctx.beginPath();
      ctx.arc((-0.48+r()*0.96)*w,-h*(0.05+r()*0.82),tile*(0.018+r()*0.028),0,Math.PI*2);
      ctx.fill();
    }

    ctx.restore();

    if(c.hp<c.maxHp){
      const bw=tile*1.20, bh=Math.max(3,tile*0.11);
      ctx.fillStyle='rgba(0,0,0,0.50)';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.26,bw,bh);
      ctx.fillStyle=c.hp/c.maxHp>0.35 ? '#58d4ff' : '#ff775f';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.26,bw*clamp(c.hp/c.maxHp,0,1),bh);
    }
    drawCommandBadge(ctx,tile,c,px,py,h);
  }
  function drawMeatGolem(ctx,tile,c){
    const g=normalizeMeatGenome(c.genome,c.seed||1,meatMass(c));
    const rotten=isRottenMeatGolem(c);
    const fried=isFriedMeatGolem(c);
    const mass=meatMass(c);
    const px=c.x*tile, py=c.y*tile;
    const walk=Math.sin(c.age*(rotten?5.6:(fried?6.8:8.2))+(g.pulse||0));
    const hit=c.hitPulse>0 ? Math.sin(c.hitPulse*34)*0.10 : 0;
    const w=tile*(0.78+mass*0.014)*g.shoulder;
    const h=tile*(1.02+mass*0.012);
    const facing=c.facing || 1;
    const primary=rotten ? mixColor(g.primary,g.rot,0.58) : (fried ? mixColor(g.primary,'#d98532',0.62) : g.primary);
    const secondary=rotten ? mixColor(g.secondary,g.rot,0.48) : (fried ? mixColor(g.secondary,'#8a4328',0.58) : g.secondary);
    const highlight=rotten ? mixColor(g.highlight,g.rot,0.34) : (fried ? mixColor(g.highlight,'#ffe3a8',0.55) : g.highlight);
    ctx.save();
    ctx.translate(px,py);
    ctx.scale(facing,1);
    ctx.rotate((g.gait||0)*0.025 + walk*(rotten?0.028:(fried?0.034:0.045)));

    ctx.globalAlpha=0.28;
    ctx.fillStyle='rgba(38,12,10,0.55)';
    ctx.beginPath();
    ctx.ellipse(0,tile*0.05,w*0.62,tile*0.13,0,0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=1;

    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      const step=walk*side*tile*(rotten?0.035:(fried?0.055:0.075));
      ctx.fillStyle=secondary;
      ctx.strokeStyle=rotten ? '#3e4d20' : (fried ? '#704322' : '#5b1e20');
      ctx.lineWidth=Math.max(1,tile*0.055);
      ctx.beginPath();
      ctx.ellipse(side*w*0.24,-h*0.10+step,w*0.18*g.legScale,h*0.28,side*0.12,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle=primary;
      ctx.beginPath();
      ctx.ellipse(side*w*0.29,tile*0.02+step,w*0.21,tile*0.09,0,0,Math.PI*2);
      ctx.fill();
    }

    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      const swing=walk*side*tile*(rotten?0.045:(fried?0.065:0.085));
      ctx.fillStyle=i===0 && g.arms==='hook' ? highlight : primary;
      ctx.strokeStyle=rotten ? '#455421' : (fried ? '#704322' : '#5b1e20');
      ctx.lineWidth=Math.max(1,tile*0.060);
      ctx.beginPath();
      ctx.ellipse(side*w*0.58,-h*0.48+swing,w*0.17*g.armScale,h*(g.arms==='long'?0.36:0.28),side*0.22,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(side*w*0.74,-h*0.25+swing,w*(g.arms==='club'?0.26:0.18),h*0.13,side*0.18,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
    }

    const grad=ctx.createRadialGradient(g.coreX*tile,-h*0.54,tile*0.06,0,-h*0.48,Math.max(w,h)*0.70);
    grad.addColorStop(0,highlight);
    grad.addColorStop(0.55,primary);
    grad.addColorStop(1,secondary);
    ctx.fillStyle=grad;
    ctx.strokeStyle=hit>0 ? '#ffe3d8' : (rotten ? '#405020' : (fried ? '#7f4b25' : '#5d1d1e'));
    ctx.lineWidth=Math.max(2,tile*0.070);
    ctx.beginPath();
    if(g.torso==='runner'){
      ctx.ellipse(g.asym*w*0.18,-h*0.50,w*0.48*g.belly,h*0.48,-0.18,0,Math.PI*2);
    }else if(g.torso==='ribbed'){
      ctx.ellipse(0,-h*0.50,w*0.52*g.belly,h*0.50,0.08,0,Math.PI*2);
    }else if(g.torso==='hunched'){
      ctx.ellipse(-w*0.08,-h*0.50,w*0.58*g.belly,h*0.43,-0.25,0,Math.PI*2);
    }else{
      ctx.ellipse(0,-h*0.50,w*0.58*g.belly,h*0.50,0,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle=rotten ? 'rgba(190,220,96,0.35)' : (fried ? 'rgba(255,224,150,0.42)' : 'rgba(255,215,190,0.34)');
    ctx.lineWidth=Math.max(1,tile*0.030);
    for(let i=0;i<g.sinews;i++){
      const r=prng(g.seed+i*617);
      const x=(-0.38+r()*0.76)*w;
      const y=-h*(0.22+r()*0.54);
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.quadraticCurveTo(x+tile*(r()*0.18-0.09),y+tile*0.10,x+tile*(r()*0.26-0.13),y+tile*(0.20+r()*0.10));
      ctx.stroke();
    }

    ctx.fillStyle=fried ? '#d98532' : g.fat;
    ctx.strokeStyle=fried ? '#8a4b24' : '#8a735f';
    ctx.lineWidth=Math.max(1,tile*0.032);
    for(let i=0;i<g.bones;i++){
      const r=prng(g.seed ^ (i*733));
      const x=(-0.34+r()*0.68)*w;
      const y=-h*(0.25+r()*0.50);
      ctx.beginPath();
      ctx.ellipse(x,y,tile*(0.055+r()*0.030),tile*(0.025+r()*0.020),r()*0.8,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
    }

    const headW=w*(g.head==='jaw'?0.38:0.31);
    const headH=h*(g.head==='snout'?0.20:0.24);
    const headX=g.asym*w*0.24;
    const headY=-h*(0.88+0.025*Math.abs(walk));
    ctx.fillStyle=mixColor(primary,highlight,fried?0.30:0.18);
    ctx.strokeStyle=rotten ? '#35461c' : (fried ? '#7f4b25' : '#5d1d1e');
    ctx.lineWidth=Math.max(1,tile*0.055);
    ctx.beginPath();
    if(g.head==='split'){
      ctx.ellipse(headX-headW*0.18,headY,headW*0.56,headH,0.12,0,Math.PI*2);
      ctx.ellipse(headX+headW*0.20,headY+headH*0.03,headW*0.52,headH*0.90,-0.12,0,Math.PI*2);
    }else{
      ctx.ellipse(headX,headY,headW,headH,g.asym*0.25,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();
    if(g.head==='jaw' || rotten || fried){
      ctx.strokeStyle=rotten ? '#d4e590' : (fried ? '#ffe3a8' : '#f4d2bf');
      ctx.lineWidth=Math.max(1,tile*0.030);
      ctx.beginPath();
      ctx.moveTo(headX-headW*0.38,headY+headH*0.25);
      ctx.lineTo(headX+headW*0.42,headY+headH*(rotten?0.34:0.20));
      ctx.stroke();
    }

    for(let i=0;i<g.eyes;i++){
      const t=(i/(Math.max(1,g.eyes-1)))-0.5;
      const ex=headX+t*headW*0.70;
      const ey=headY-headH*0.05;
      ctx.fillStyle=rotten ? '#d8ff66' : (fried ? '#ffe3a8' : '#f7fbff');
      ctx.fillRect(ex-tile*0.040,ey-tile*0.032,tile*0.080,tile*0.064);
      ctx.fillStyle=rotten ? '#25330c' : (fried ? '#5b2a16' : '#351218');
      ctx.fillRect(ex+(facing>0?tile*0.010:-tile*0.026),ey-tile*0.020,tile*0.026,tile*0.040);
    }

    ctx.restore();

    if(c.hp<c.maxHp){
      const bw=tile*1.10, bh=Math.max(3,tile*0.10);
      ctx.fillStyle='rgba(0,0,0,0.50)';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw,bh);
      ctx.fillStyle=c.hp/c.maxHp>0.35 ? (rotten?'#b7db60':(fried?'#ffd08a':'#ff8a78')) : '#ff635c';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw*clamp(c.hp/c.maxHp,0,1),bh);
    }
    drawCommandBadge(ctx,tile,c,px,py,h);
  }
  function drawClayCracks(ctx,tile,g,w,h,c){
    ctx.save();
    ctx.strokeStyle='rgba(38,27,20,0.36)';
    ctx.lineWidth=Math.max(1,tile*0.035);
    ctx.lineCap='round';
    for(let i=0;i<g.cracks;i++){
      const r=prng(g.seed ^ (i*2654435761));
      const x=(-0.36+r()*0.72)*w;
      const y=-h*(0.24+r()*0.52);
      const len=tile*(0.12+r()*0.18);
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+len*(r()<0.5?-1:1),y+tile*(r()*0.16-0.03));
      if(r()<0.45) ctx.lineTo(x+len*0.42,y+tile*(0.10+r()*0.10));
      ctx.stroke();
    }
    if(g.rune){
      const pulse=(Math.sin(c.age*3.2+g.pulse)+1)*0.5;
      ctx.strokeStyle=mixColor(g.core,g.coreGlow,0.35);
      ctx.globalAlpha=0.25+0.20*pulse;
      ctx.beginPath();
      ctx.moveTo(-w*0.12,-h*0.62);
      ctx.lineTo(w*0.02,-h*0.50);
      ctx.lineTo(-w*0.04,-h*0.36);
      ctx.moveTo(w*0.14,-h*0.58);
      ctx.lineTo(w*0.02,-h*0.50);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawClayGolem(ctx,tile,c){
    const g=normalizeClayGenome(c.genome,c.seed||1,clayMass(c));
    const mass=clayMass(c);
    const px=c.x*tile, py=c.y*tile;
    const walk=Math.sin(c.age*(4.2+g.gait*0.4)+g.pulse);
    const pulse=(Math.sin(c.age*3.8+g.pulse)+1)*0.5;
    const hit=c.hitPulse>0 ? Math.sin(c.hitPulse*30)*0.10 : 0;
    const shield=clamp(c.shieldPulse||0,0,1);
    const w=tile*(0.88+mass*0.015)*g.shoulder;
    const h=tile*(1.18+mass*0.010);
    const facing=c.facing || 1;
    ctx.save();
    ctx.translate(px,py);
    ctx.scale(facing,1);
    ctx.rotate(g.lean + walk*0.018);

    ctx.save();
    ctx.globalAlpha=0.28;
    ctx.fillStyle='rgba(18,13,10,0.55)';
    ctx.beginPath();
    ctx.ellipse(0,tile*0.05,w*0.68,tile*0.15,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    if(g.backSlab){
      ctx.fillStyle=mixColor(g.secondary,g.primary,0.18);
      ctx.strokeStyle='rgba(34,23,16,0.30)';
      ctx.lineWidth=Math.max(1,tile*0.06);
      ctx.beginPath();
      ctx.ellipse(-w*0.08,-h*0.56,w*0.58,h*0.43,-0.18,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
    }

    const legW=w*0.22, legH=h*0.30;
    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      const step=walk*side*tile*0.045;
      ctx.fillStyle=mixColor(g.secondary,g.primary,0.28);
      ctx.strokeStyle='rgba(35,25,18,0.34)';
      ctx.lineWidth=Math.max(1,tile*0.06);
      ctx.beginPath();
      ctx.ellipse(side*w*g.legGap,-legH*0.36+step,legW,legH,side*0.10,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle=mixColor(g.primary,g.highlight,0.16);
      ctx.beginPath();
      ctx.ellipse(side*w*(g.legGap+0.02),tile*0.02+step,legW*1.15,tile*0.11,0,0,Math.PI*2);
      ctx.fill();
    }

    const armY=-h*0.48;
    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      const swing=walk*side*tile*0.06;
      const armLong=g.arms==='long' ? 1.18 : (g.arms==='block' || g.arms==='shield' ? 0.92 : 1.02);
      const fore=g.arms==='club' ? 1.26 : (g.arms==='shield' ? 1.42 : 1.0);
      ctx.fillStyle=i===0 && g.arms==='shield' ? mixColor(g.secondary,g.highlight,0.16) : mixColor(g.primary,g.secondary,0.22);
      ctx.strokeStyle='rgba(34,23,16,0.36)';
      ctx.lineWidth=Math.max(1,tile*0.065);
      ctx.beginPath();
      ctx.ellipse(side*w*0.62,armY+swing,w*0.18*g.armScale,h*0.30*armLong,side*0.18,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(side*w*0.76,armY+h*0.22+swing,w*0.22*fore,h*0.16*g.armScale,side*0.08,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
    }

    const grad=ctx.createRadialGradient(g.coreX*tile,-h*g.coreY,tile*0.08,g.asym*w*0.18,-h*0.48,Math.max(w,h)*0.75);
    grad.addColorStop(0,mixColor(g.highlight,g.primary,0.20));
    grad.addColorStop(0.52,g.primary);
    grad.addColorStop(1,g.secondary);
    ctx.fillStyle=grad;
    ctx.strokeStyle=hit>0 ? '#f8efe2' : 'rgba(32,23,17,0.58)';
    ctx.lineWidth=Math.max(2,tile*0.085);
    ctx.beginPath();
    if(g.torso==='column'){
      ctx.ellipse(g.asym*w*0.18,-h*0.48,w*0.44*g.belly,h*0.55,0,0,Math.PI*2);
    }else if(g.torso==='jar'){
      ctx.moveTo(-w*0.44,-h*0.92);
      ctx.quadraticCurveTo(-w*0.68,-h*0.50,-w*0.40,-h*0.12);
      ctx.quadraticCurveTo(0,-h*0.02,w*0.40,-h*0.12);
      ctx.quadraticCurveTo(w*0.70,-h*0.50,w*0.44,-h*0.90);
      ctx.quadraticCurveTo(0,-h*1.02,-w*0.44,-h*0.92);
    }else if(g.torso==='hunched'){
      ctx.ellipse(-w*0.05,-h*0.48,w*0.58*g.belly,h*0.44,-0.18,0,Math.PI*2);
    }else if(g.torso==='lopsided'){
      ctx.ellipse(g.asym*w*0.36,-h*0.48,w*0.56*g.belly,h*0.47,g.asym*0.35,0,Math.PI*2);
    }else{
      ctx.ellipse(0,-h*0.50,w*0.58*g.belly,h*0.48,0,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();

    drawClayPebbles(ctx,tile,g,w,h);
    drawClayCracks(ctx,tile,g,w,h,c);

    ctx.save();
    ctx.globalAlpha=g.wetSheen;
    ctx.fillStyle='rgba(238,207,156,0.28)';
    ctx.beginPath();
    ctx.ellipse(-w*0.16,-h*0.72,w*0.20,h*0.055,-0.20,0,Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w*0.20,-h*0.38,w*0.15,h*0.042,0.18,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    for(let i=0;i<g.drips;i++){
      const r=prng(g.seed+i*4099);
      const x=(-0.40+r()*0.80)*w;
      const y=-h*(0.20+r()*0.52);
      const len=tile*(0.08+r()*0.15)*(0.7+0.3*pulse);
      ctx.strokeStyle='rgba(42,31,23,0.30)';
      ctx.lineWidth=Math.max(1,tile*0.028);
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+tile*(r()*0.04-0.02),y+len);
      ctx.stroke();
    }

    const headW=w*(g.head==='wide'?0.42:0.32);
    const headH=h*(g.head==='low'?0.18:0.23);
    const headX=g.asym*w*0.24;
    const headY=-h*(g.head==='low'?0.88:0.96);
    ctx.fillStyle=mixColor(g.primary,g.highlight,0.12);
    ctx.strokeStyle='rgba(35,25,18,0.45)';
    ctx.lineWidth=Math.max(1,tile*0.06);
    ctx.beginPath();
    if(g.head==='split'){
      ctx.ellipse(headX-headW*0.20,headY,headW*0.55,headH,0.08,0,Math.PI*2);
      ctx.ellipse(headX+headW*0.22,headY+headH*0.05,headW*0.50,headH*0.92,-0.06,0,Math.PI*2);
    }else{
      ctx.ellipse(headX,headY,headW,headH,g.asym*0.22,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();
    if(g.brow || g.head==='brow'){
      ctx.strokeStyle='rgba(35,24,17,0.55)';
      ctx.lineWidth=Math.max(1,tile*0.05);
      ctx.beginPath();
      ctx.moveTo(headX-headW*0.62,headY-headH*0.12);
      ctx.lineTo(headX+headW*0.62,headY-headH*0.04);
      ctx.stroke();
    }

    const eyeCount=g.eyeCount;
    for(let i=0;i<eyeCount;i++){
      const t=(i/(Math.max(1,eyeCount-1)))-0.5;
      const ex=headX+t*headW*0.78;
      const ey=headY+(i%2)*headH*0.10;
      ctx.fillStyle=mixColor(g.coreGlow,'#ffffff',0.16);
      ctx.fillRect(ex-tile*0.045,ey-tile*0.035,tile*0.09,tile*0.07);
      ctx.fillStyle='#2b160b';
      ctx.fillRect(ex+(facing>0?tile*0.012:-tile*0.028),ey-tile*0.022,tile*0.030,tile*0.044);
    }

    const coreX=g.coreX*tile, coreY=-h*g.coreY;
    ctx.save();
    ctx.globalAlpha=0.28+0.18*pulse+shield*0.24;
    ctx.fillStyle=g.core;
    ctx.beginPath();
    ctx.arc(coreX,coreY,tile*(0.36+shield*0.10),0,Math.PI*2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle=g.core;
    ctx.strokeStyle=mixColor(g.coreGlow,'#ffffff',0.28);
    ctx.lineWidth=Math.max(1,tile*0.045);
    ctx.beginPath();
    ctx.moveTo(coreX,coreY-tile*0.18);
    ctx.lineTo(coreX+tile*0.18,coreY);
    ctx.lineTo(coreX,coreY+tile*0.18);
    ctx.lineTo(coreX-tile*0.18,coreY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if(shield>0){
      ctx.save();
      ctx.globalAlpha=shield*0.34;
      ctx.strokeStyle=mixColor(g.core,g.coreGlow,0.22);
      ctx.lineWidth=Math.max(1,tile*0.055);
      ctx.beginPath();
      ctx.ellipse(0,-h*0.55,w*(0.75+shield*0.15),h*(0.62+shield*0.08),0,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    if(c.hp<c.maxHp){
      const bw=tile*1.35, bh=Math.max(3,tile*0.12);
      ctx.fillStyle='rgba(0,0,0,0.50)';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.30,bw,bh);
      ctx.fillStyle=c.hp/c.maxHp>0.35 ? '#c08d5e' : '#ff775f';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.30,bw*clamp(c.hp/c.maxHp,0,1),bh);
    }
    drawCommandBadge(ctx,tile,c,px,py,h);
  }
  function drawMolekin(ctx,tile,c){
    const g=normalizeMolekinGenome(c.genome,c.seed||1,lavaMass(c),molekinRole(c));
    const role=molekinRole(c);
    const mass=lavaMass(c);
    const px=c.x*tile, py=c.y*tile;
    const walk=Math.sin(c.age*(6.1+g.gait*0.8)+g.pulse);
    const pulse=(Math.sin(c.age*5.2+g.pulse)+1)*0.5;
    const hit=c.hitPulse>0 ? Math.sin(c.hitPulse*34)*0.10 : 0;
    const shield=clamp(c.shieldPulse||0,0,1);
    const w=tile*(0.76+mass*0.010)*g.body;
    const h=tile*(0.90+mass*0.008)*g.height;
    const facing=c.facing || 1;
    ctx.save();
    ctx.translate(px,py);
    ctx.scale(facing,1);
    ctx.rotate(g.stance*0.12 + walk*0.020);

    ctx.save();
    ctx.globalAlpha=0.30;
    ctx.fillStyle='rgba(20,9,4,0.58)';
    ctx.beginPath();
    ctx.ellipse(0,tile*0.05,w*0.58,tile*0.12,0,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    const legSwing=walk*tile*0.055*g.leg;
    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      ctx.strokeStyle=g.deep;
      ctx.lineWidth=Math.max(2,tile*0.080);
      ctx.beginPath();
      ctx.moveTo(side*w*0.18,-h*0.22);
      ctx.lineTo(side*w*0.25+side*legSwing,tile*0.01);
      ctx.stroke();
      ctx.fillStyle=g.deep;
      ctx.fillRect(side*w*0.25+side*legSwing-side*tile*0.03-tile*0.08,-tile*0.02,tile*0.18,tile*0.055);
    }

    for(let i=0;i<2;i++){
      const side=i===0?-1:1;
      const swing=walk*side*tile*0.070;
      ctx.strokeStyle=g.deep;
      ctx.lineWidth=Math.max(2,tile*0.070);
      ctx.beginPath();
      ctx.moveTo(side*w*0.34,-h*0.48);
      ctx.lineTo(side*w*0.58*g.arm,-h*0.34+swing);
      ctx.stroke();
      ctx.fillStyle=role==='sapper' && i===1 ? g.accent : g.fur;
      ctx.beginPath();
      ctx.ellipse(side*w*0.64*g.arm,-h*0.30+swing,w*0.12*g.claw,h*0.065,side*0.18,0,Math.PI*2);
      ctx.fill();
    }

    const grad=ctx.createRadialGradient(g.shoulder*w,-h*0.55,tile*0.05,0,-h*0.46,Math.max(w,h)*0.70);
    grad.addColorStop(0,mixColor(g.ember,'#ffffff',0.15));
    grad.addColorStop(0.45,hit>0 ? '#fff1de' : g.fur);
    grad.addColorStop(1,g.dark);
    ctx.fillStyle=grad;
    ctx.strokeStyle=hit>0 ? '#fff6e8' : g.deep;
    ctx.lineWidth=Math.max(2,tile*0.070);
    ctx.beginPath();
    ctx.ellipse(0,-h*0.44,w*0.46,h*0.38,0,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();

    if(role==='tank'){
      ctx.fillStyle='rgba(38,39,42,0.90)';
      ctx.fillRect(-w*0.34,-h*0.62,w*0.24,h*0.13);
      ctx.fillRect(w*0.10,-h*0.62,w*0.24,h*0.13);
    }else if(role==='healer'){
      ctx.strokeStyle='rgba(255,201,111,0.72)';
      ctx.lineWidth=Math.max(1,tile*0.045);
      ctx.beginPath();
      ctx.arc(0,-h*0.50,w*0.58,0,Math.PI*2);
      ctx.stroke();
    }else if(role==='engineer'){
      ctx.fillStyle=g.accent;
      ctx.fillRect(-w*0.05,-h*0.62,w*0.12,h*0.24);
    }

    ctx.strokeStyle='rgba(255,168,74,0.30)';
    ctx.lineWidth=Math.max(1,tile*0.030);
    for(let i=0;i<g.soot;i++){
      const r=prng(g.seed ^ (i*1109));
      const x=(-0.34+r()*0.68)*w;
      const y=-h*(0.24+r()*0.42);
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+tile*(r()*0.16-0.08),y+tile*(0.08+r()*0.10));
      ctx.stroke();
    }

    const headY=-h*0.78;
    const headW=w*0.34*g.head;
    const headH=h*0.19*g.head;
    ctx.fillStyle=hit>0 ? '#fff6e8' : g.fur;
    ctx.strokeStyle=g.deep;
    ctx.lineWidth=Math.max(1,tile*0.060);
    ctx.beginPath();
    ctx.ellipse(g.shoulder*w*0.16,headY,headW,headH,0.02,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle=g.dark;
    ctx.beginPath();
    ctx.ellipse(headW*0.62*g.snout,headY+headH*0.16,headW*0.38*g.snout,headH*0.44,0,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle='#120b08';
    ctx.fillRect(headW*0.83*g.snout,headY+headH*0.08,tile*0.040,tile*0.030);

    for(let i=0;i<g.ears;i++){
      const side=i%2===0?-1:1;
      ctx.fillStyle=g.dark;
      ctx.beginPath();
      ctx.ellipse(side*headW*0.45,headY-headH*0.68,headW*0.18,headH*0.36,side*0.25,0,Math.PI*2);
      ctx.fill();
    }

    ctx.fillStyle='#17100c';
    ctx.beginPath();
    ctx.ellipse(headW*0.16,headY-headH*0.02,tile*0.095*g.eyeScale,tile*0.045*g.eyeScale,0,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle=g.eye;
    ctx.beginPath();
    ctx.arc(headW*0.20,headY-headH*0.02,tile*0.030*g.eyeScale,0,Math.PI*2);
    ctx.fill();

    ctx.fillStyle='#2a2522';
    ctx.beginPath();
    ctx.ellipse(0,headY-headH*0.75,headW*0.88*g.helmet,headH*0.40,0,Math.PI,Math.PI*2);
    ctx.fill();
    ctx.fillStyle=g.accent;
    for(let i=0;i<g.rankBands;i++){
      ctx.fillRect(-headW*0.34,headY-headH*(0.82+i*0.10),headW*0.68,tile*0.020);
    }

    const weaponGlow=0.32+0.22*pulse;
    ctx.globalAlpha=weaponGlow;
    ctx.fillStyle=g.accent;
    if(role==='sniper'){
      ctx.beginPath();
      ctx.arc(w*0.66,-h*0.67,tile*0.13,0,Math.PI*2);
      ctx.fill();
    }else if(role==='sapper'){
      ctx.fillRect(w*0.48,-h*0.44,tile*0.16,tile*0.10);
    }else{
      ctx.beginPath();
      ctx.arc(w*0.56,-h*0.36,tile*0.09,0,Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha=1;

    if(shield>0){
      ctx.save();
      ctx.globalAlpha=shield*0.32;
      ctx.strokeStyle=mixColor(g.accent,'#fff3ba',0.20);
      ctx.lineWidth=Math.max(1,tile*0.050);
      ctx.beginPath();
      ctx.ellipse(0,-h*0.48,w*(0.76+shield*0.14),h*(0.58+shield*0.08),0,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    if(c.hp<c.maxHp){
      const bw=tile*1.15, bh=Math.max(3,tile*0.10);
      ctx.fillStyle='rgba(0,0,0,0.50)';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw,bh);
      ctx.fillStyle=c.hp/c.maxHp>0.35 ? '#ffb45c' : '#ff635c';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw*clamp(c.hp/c.maxHp,0,1),bh);
    }
    drawCommandBadge(ctx,tile,c,px,py,h);
  }
  function draw(ctx,tile){
    if(!ctx || !tile) return;
    for(const l of lasers) drawLaser(ctx,tile,l);
    for(const c of list){
      if(isClayGolem(c)) drawClayGolem(ctx,tile,c);
      else if(isLeafMonster(c)) drawLeafMonster(ctx,tile,c);
      else if(isWaterGolem(c)) drawWaterGolem(ctx,tile,c);
      else if(isMeatGolem(c) || isFriedMeatGolem(c)) drawMeatGolem(ctx,tile,c);
      else if(isMolekin(c)) drawMolekin(ctx,tile,c);
      else drawCompanion(ctx,tile,c);
      const smoke=MM.smoke;
      if(smoke&&typeof smoke.drawSootMarks==='function'){
        const g=c.genome||{};
        const mass=Math.max(1,Number(c.biomass)||1);
        const bodyW=tile*clamp(0.76*(Number(g.body||g.width)||1)+mass*0.010,0.55,1.55);
        const bodyH=tile*clamp(0.92*(Number(g.height)||1)+mass*0.012,0.62,1.72);
        const amount=typeof smoke.visualSoot==='function'?smoke.visualSoot(c,{field:'_sootFilm'}):(Number(c._sootFilm)||0);
        smoke.drawSootMarks(ctx,c.x*tile,c.y*tile-bodyH*0.5,bodyW,bodyH*0.84,amount,c.seed);
      }
    }
    for(const fx of deathFx) drawDeathFx(ctx,tile,fx);
  }
  function snapshot(){
    return {
      v:1,
      command:snapshotCommand(),
      list:list.map(c=>({
        kind:c.kind||KIND_BIO, id:c.id, seed:c.seed, name:c.name, x:c.x, y:c.y, vx:c.vx, vy:c.vy,
        hp:c.hp, maxHp:c.maxHp, biomass:c.biomass, clay:c.clay, leaves:c.leaves, water:c.water, meat:c.meat, motherIce:c.motherIce, ufoConcrete:c.ufoConcrete, ufoRole:c.ufoRole, lava:c.lava, moleRole:c.moleRole, facing:c.facing, age:c.age,
        laserCd:c.laserCd, gasCd:c.gasCd, guardCd:c.guardCd, attackCd:c.attackCd, shieldPulse:c.shieldPulse,
        waterDrinkCd:c.waterDrinkCd, wateredT:c.wateredT, leafFeedCd:c.leafFeedCd, leafFeedTarget:c.leafFeedTarget,
        leafFeeding:c.leafFeeding, transportRideT:c.transportRideT, transportPulse:c.transportPulse, genome:c.genome,
        harvestX:c.harvestX, harvestY:c.harvestY, harvestProgress:c.harvestProgress,
        sootFilm:clamp(Number(c._sootFilm)||0,0,1)
      }))
    };
  }
  function restore(data,getTile){
    list.length=0;
    lasers.length=0;
    deathFx.length=0;
    setCommand(data && data.command ? data.command : {mode:'attack'});
    const arr=data && Array.isArray(data.list) ? data.list : [];
    for(const raw of arr.slice(0,MAX_COMPANIONS)){
      if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
      const c=makeCompanion(raw);
      c._sootFilm=clamp(Number(raw.sootFilm)||0,0,1);
      c._sootFilmTint=0;
      c.maxHp=expectedMaxHp(c);
      c.hp=clamp(Number(raw.hp)||c.maxHp,1,c.maxHp);
      sanitizeCompanion(c);
      if(getTile && !clearAt(c.x,c.y,c,getTile)){
        c.y=clampCompanionWorldY(c.y-1,2,0.15);
      }
      list.push(c);
    }
    return true;
  }
  function reset(){
    list.length=0;
    lasers.length=0;
    deathFx.length=0;
    setCommand({mode:'attack'});
  }
  function metrics(){
    let hp=0,maxHp=0,biomass=0,golems=0,clay=0,leafMonsters=0,leaves=0,transportMounted=0,waterGolems=0,water=0,meatGolems=0,rottenMeatGolems=0,friedMeatGolems=0,meat=0,ufoAliens=0,motherIce=0,molekin=0,lava=0;
    for(const c of list){
      hp+=c.hp; maxHp+=c.maxHp;
      if(isFriedMeatGolem(c)){ friedMeatGolems++; meat+=meatMass(c); }
      else if(isMeatGolem(c)){ if(isRottenMeatGolem(c)) rottenMeatGolems++; else meatGolems++; meat+=meatMass(c); }
      else if(isWaterGolem(c)){ waterGolems++; water+=waterMass(c); }
      else if(isLeafMonster(c)){ leafMonsters++; leaves+=leafMass(c); if(c.transportMounted) transportMounted++; }
      else if(isClayGolem(c)){ golems++; clay+=clayMass(c); }
      else if(isUfoAlien(c)){ ufoAliens++; motherIce+=ufoConcreteMass(c); }
      else if(isMolekin(c)){ molekin++; lava+=lavaMass(c); }
      else biomass+=c.biomass;
    }
    return {count:list.length, hp:Math.round(hp), maxHp:Math.round(maxHp), biomass, golems, clay, leafMonsters, leaves, transportMounted, waterGolems, water, meatGolems, rottenMeatGolems, friedMeatGolems, friedChickens:friedMeatGolems, meat, ufoAliens, motherIce, ufoConcrete:motherIce, molekin, lava, lasers:lasers.length, mode:command.mode, awaitingHarvest:command.awaiting, harvestTile:command.harvestTile};
  }
  function debugList(){
    return list.map(c=>({kind:c.kind||KIND_BIO,id:c.id,name:c.name,x:c.x,y:c.y,vx:c.vx,vy:c.vy,hp:c.hp,maxHp:c.maxHp,biomass:c.biomass,clay:c.clay,leaves:c.leaves,water:c.water,meat:c.meat,motherIce:c.motherIce,ufoConcrete:c.ufoConcrete,ufoRole:c.ufoRole,lava:c.lava,moleRole:c.moleRole,age:c.age,rotIn:isRawMeatGolem(c)?Math.max(0,MEAT_GOLEM_ROT_SECONDS-(c.age||0)):0,wateredT:c.wateredT,waterDrinkCd:c.waterDrinkCd,swimming:!!c.swimming,leafFeedCd:c.leafFeedCd,leafFeeding:c.leafFeeding,leafFeedTarget:c.leafFeedTarget,transportMounted:!!c.transportMounted,transportRideT:c.transportRideT,transportPulse:c.transportPulse,lastWind:c.lastWind,laserCd:c.laserCd,gasCd:c.gasCd,guardCd:c.guardCd,attackCd:c.attackCd,genome:c.genome,harvestX:c.harvestX,harvestY:c.harvestY,harvestProgress:c.harvestProgress}));
  }
  const api={spawnFromCraft, spawnUfoAlienFromCraft, spawnLeafMonsterFromCraft, feedNearest, tryClayGolemRitualAt, tryLeafMonsterRitualAt, tryWaterGolemRitualAt, tryMolekinRitualAt, tryMeatGolemRitualAt, fireGuardianDefeated, iceGuardianDefeated, onTileChanged, absorbHeroDamage, hasActive:()=>list.length>0, count:()=>list.length, update, draw, damageAt, damageAtWorld, nearestForEnemy, collideHero, heatAt, snapshot, restore, reset, metrics, commandAt, awaitingHarvestTarget, assignHarvestTarget,
    _debug:{list:debugList, command:()=>snapshotCommand(), setCommand, makeGenome, makeClayGenome, makeLeafGenome, makeWaterGenome, makeMeatGenome, makeUfoAlienGenome, makeMolekinGenome, makeCompanion, traits:traitsFor, maxHpForBiomass, maxHpForClay, maxHpForLeaves, maxHpForWater, maxHpForMeat, maxHpForUfoAlien, maxHpForMolekin, ufoAlienRoles:UFO_ALIEN_ROLES.slice(), molekinRoles:MOLEKIN_ROLES.slice(), maxCompanions:MAX_COMPANIONS, clayGolemMin:CLAY_GOLEM_MIN_CLAY, clayGolemMax:CLAY_GOLEM_MAX_CLAY, leafMonsterMin:LEAF_MONSTER_MIN_LEAVES, leafMonsterMax:LEAF_MONSTER_MAX_LEAVES, waterGolemMin:WATER_GOLEM_MIN_WATER, waterGolemMax:WATER_GOLEM_MAX_WATER, meatGolemMin:MEAT_GOLEM_MIN_MEAT, meatGolemMax:MEAT_GOLEM_MAX_MEAT, ufoAlienMin:UFO_ALIEN_MIN_CONCRETE, ufoAlienMax:UFO_ALIEN_MAX_CONCRETE, molekinMin:MOLEKIN_MIN_LAVA, molekinMax:MOLEKIN_MAX_LAVA, meatGolemRotSeconds:MEAT_GOLEM_ROT_SECONDS, fireGuardianDefeated, iceGuardianDefeated, damage, nearest:debugNearest, spawn:debugSpawn, spawnGolem:debugSpawnGolem, spawnLeafMonster:debugSpawnLeafMonster, spawnWaterGolem:debugSpawnWaterGolem, spawnMeatGolem:debugSpawnMeatGolem, spawnUfoAlien:debugSpawnUfoAlien, spawnMolekin:debugSpawnMolekin, feed:debugFeed, setBiomass:debugSetBiomass, setClay:debugSetClay, setLeaves:debugSetLeaves, setWater:debugSetWater, setMeat:debugSetMeat, setLava:debugSetLava, rotMeatGolem:debugRotMeatGolem, cookMeatGolem:debugCookMeatGolem, heal:debugHeal, damageNearest:debugDamage, kill:debugKill, teleportToHero:debugTeleportToHero, forceGas:debugForceGas, forceLaser:debugForceLaser, forceMolekinFire:debugForceMolekinFire, guardHero:debugGuardHero, shieldGolem:debugShieldGolem, forceGolemStrike:debugForceGolemStrike, forceWaterSpray:debugForceWaterSpray, clear:debugClear}
  };
  MM.companions=api;
  return api;
})();

export { companions };
export default companions;
