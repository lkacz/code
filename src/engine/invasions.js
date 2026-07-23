import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, TILE as DEFAULT_TILE } from '../constants.js';
import {
  isDoorTile,
  isObjectFootingTile,
  isPlayerBuiltMaterial,
  isReplaceableNaturalOpenTile,
  isRigidObjectTile,
  isSolidCollisionTile as isSolid,
  isTrapdoorTile
} from './material_physics.js';
import {
  applySeparation,
  assignRoles,
  beginAIFrame,
  createNav,
  createSquadBrain,
  makeTeamProfile
} from './invasion_ai.js';
import { STORY_LORE, storyInvasionLinesForProgress } from './story_lore.js';
import { isLongCharacterSpeech, readableCharacterSpeechDuration } from './character_speech.js';
import { authoritativeBodyBlocksCell } from './body_footprint.js';

// Night invasions are intentionally team-based. Today the implemented team type
// is "aliens", but the save shape and scheduler can host more invader kinds.
// Tactics (pathfinding, roles, flanking, cover, sieges) live in invasion_ai.js
// and are team-agnostic; each kind only registers a profile here.
const invasions = (function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const SAVE_KEY = 'mm_invasions_v1';
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  const LASER_CAP = 80;
  const MOLE_SHOT_CAP = 72;
  const MOLE_SHOT_GHOST_CAP = 24;
  const DEATH_FX_CAP = 112;
  // Two natural max-size swarms can coexist; keep all 60 deaths mirrorable so
  // a spectacular double clear never turns half the guest screen into pops.
  const GHOST_DEATH_FX_CAP = 64;
  const MOLE_SHOT_GRAVITY = 12.5;
  // Aim telegraph: once an alien locks its aim, the shot follows fast — a long
  // windup let the hero stroll out of every beam (owner ruling: 0.5-1 s).
  const ALIEN_LASER_CHARGE_MIN = 0.5;
  const ALIEN_LASER_CHARGE_MAX = 1;
  const TILE_DAMAGE_CAP = 220;
  const PLAYER_LEVEL_CAP = 99;
  const INVASION_MAX_TEAMS = 6;
  const INVASION_MAX_ALIENS = 32;      // bounded, but large enough for a true screen-filling swarm
  // Regular squads gain two more bodies over the long arc. Encounter archetypes
  // can trade that quality budget for pets, flyers, one colossus, or a much
  // larger crowd of intentionally fragile chaff.
  const TEAM_SIZE_REGULAR_MAX = 10;
  const HORDE_SIZE_MIN = 18;
  const HORDE_SIZE_MAX = 30;
  const HORDE_CHANCE = 0.12;
  const HORDE_MIN_DAY = 5;
  const ELITE_HP_MULT = 1.4;
  const ELITE_DAMAGE_MULT = 1.15;
  const ELITE_MAX_PER_TEAM = 3; // elites are the accent of a squad, never its bulk
  const OFFSCREEN_DESPAWN_DAYS = 1;
  const OFFSCREEN_VIEW_PAD = 6;
  const OFFSCREEN_FALLBACK_RADIUS = 88;
  // Dawn ends the raid: without this, teams the player kept half-seeing around
  // the base (offscreen despawn needs a FULL unseen day) piled up night after
  // night into an ever-growing swarm of units all simulating every frame.
  const RETREAT_SWEEP_MS = 2600;
  const NATURAL_SPAWN_TEAM_GATE = 4;
  const REMOTE_BRAIN_INTERVAL = 0.35; // off-view squads re-plan ~3x/s instead of every frame
  const THREAT_GRADE_NAMES = ['scout','veteran','elite','ascendant'];
  // Spread visible promotions across the intended long-form progression. The
  // old 8/16/28 ladder and capped multipliers exhausted nearly every invasion
  // upgrade before the hero reached level 30.
  const THREAT_GRADE_THRESHOLDS = [1,8,20,38];
  const ENCOUNTER_TYPES = Object.freeze(['classic','patrol','menagerie','airborne','arsenal','swarm','colossus','wildcard']);
  const teams = [];
  const caches = [];
  const lasers = [];
  const moleShots = [];
  // Deaths outlive their unit/team. In particular, defeatTeam() immediately
  // hides a defeated roster, so keeping these effects outside the teams is the
  // only way the final enemy's fall can remain visible and satisfying.
  const deathFx = [];
  const ghostDeathSeen = new Set();
  const tileDamage = new Map();
  const brains = new Map(); // team.id -> squad brain (transient, rebuilt after load)
  let seq = 1;
  let moleShotSeq = 1;
  let deathFxSeq = 1;
  let lastDeathSoundAt = -Infinity;
  let lastNightDay = 0;
  let saveAcc = 0;
  let lastWorldAccess = {getTile:null,setTile:null,ctx:null};

  // Team profile registry: future invader kinds (dwarves, animal packs, ...)
  // call registerTeamType with their own tuning and reuse the whole pipeline.
  const TEAM_TYPES = {};
  function registerTeamType(kind, def){
    TEAM_TYPES[kind] = makeTeamProfile(Object.assign({}, def, {kind}));
    return TEAM_TYPES[kind];
  }
  function profileFor(team){
    return TEAM_TYPES[team && team.kind] || TEAM_TYPES.aliens;
  }

  function finiteNum(v){ return typeof v === 'number' && Number.isFinite(v); }
  function clamp(v,a,b){ return v < a ? a : (v > b ? b : v); }
  function randRange(a,b){ return a + Math.random() * (b - a); }
  function floor(v){ return Math.floor(Number(v) || 0); }
  function tileKey(x,y){ return floor(x)+','+floor(y); }
  function deepCopy(v){ return JSON.parse(JSON.stringify(v)); }
  function getWorldSeed(){ try{ return (MM.worldGen && MM.worldGen.worldSeed) || 0; }catch(e){ return 0; } }
  function nowMs(){ return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function say(text){ try{ if(root.msg) root.msg(text); }catch(e){} }
  function play(name,opts){
    try{
      if(MM.audio && MM.audio.play){
        const spatial=opts && Number.isFinite(Number(opts.x)) && Number.isFinite(Number(opts.y))
          ? Object.assign({},opts,{x:Number(opts.x),y:Number(opts.y)})
          : opts;
        MM.audio.play(name,spatial);
      }
    }catch(e){}
  }
  function burst(x,y,tier){
    try{
      if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(x*(MM.TILE || DEFAULT_TILE), y*(MM.TILE || DEFAULT_TILE), tier || 'rare');
    }catch(e){}
  }
  function saveLocal(){
    try{ if(root.localStorage) root.localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); }catch(e){}
  }
  function markHostSave(ctx){
    try{
      if(ctx && typeof ctx.saveState === 'function') ctx.saveState();
      else if(typeof root.saveState === 'function') root.saveState();
    }catch(e){}
  }
  function taskApi(){
    try{ return MM.tasks || root.tasks || null; }catch(e){ return null; }
  }
  function cacheTaskId(cache){
    const id = cache && cache.id ? String(cache.id) : '';
    return id ? 'invasion_cache:'+id : '';
  }
  function cacheTaskDetail(cache){
    let resources = 0;
    for(const k in (cache && cache.resources) || {}) resources += Math.max(0, Math.floor(Number(cache.resources[k]) || 0));
    const gear = Array.isArray(cache && cache.gear) ? cache.gear.length : 0;
    const parts = [];
    if(resources) parts.push(resources+' zasobow');
    if(gear) parts.push(gear+' przedm.');
    return parts.length ? 'Skrytka obcych: '+parts.join(', ') : 'Skrytka obcych';
  }
  function syncCacheTask(cache){
    const tasks = taskApi();
    if(!tasks || !cache) return;
    try{
      if(typeof tasks.upsertAlienCache === 'function'){ tasks.upsertAlienCache(cache); return; }
      if(typeof tasks.upsert === 'function'){
        tasks.upsert({
          id:cacheTaskId(cache),
          source:'invasions',
          kind:'recovery',
          title:'Odzyskaj skradziony lup',
          detail:cacheTaskDetail(cache),
          priority:90,
          pointer:true,
          target:{x:cache.x+0.5,y:cache.y+0.5,label:'Skrytka obcych'},
          createdAt:cache.createdAt
        });
      }
    }catch(e){}
  }
  function completeCacheTask(cache){
    const tasks = taskApi();
    if(!tasks || !cache) return;
    try{
      if(typeof tasks.completeAlienCache === 'function'){ tasks.completeAlienCache(cache); return; }
      if(typeof tasks.complete === 'function') tasks.complete(cacheTaskId(cache));
    }catch(e){}
  }
  function syncCacheTasks(){
    const tasks = taskApi();
    if(!tasks) return;
    try{
      if(typeof tasks.syncAlienCaches === 'function'){ tasks.syncAlienCaches(caches); return; }
      for(const cache of caches) syncCacheTask(cache);
    }catch(e){}
  }
  function clearCacheTasks(){
    const tasks = taskApi();
    if(!tasks) return;
    try{
      if(typeof tasks.syncAlienCaches === 'function'){ tasks.syncAlienCaches([]); return; }
      if(typeof tasks.removeSource === 'function') tasks.removeSource('invasions');
    }catch(e){}
  }
  function maybeSave(dt){
    saveAcc += Math.max(0, Number(dt) || 0);
    if(saveAcc < 3) return;
    saveAcc = 0;
    saveLocal();
  }
  function currentDayInfo(){
    let dayFloat = 1;
    let isNight = false;
    try{
      const s = MM.seasons && MM.seasons.metrics ? MM.seasons.metrics() : null;
      if(s && Number.isFinite(Number(s.dayFloat))) dayFloat = Number(s.dayFloat);
    }catch(e){}
    try{
      const b = MM.background && MM.background.timeInfo ? MM.background.timeInfo() : null;
      if(b){
        if(b.phase === 'night') isNight = true;
        else if(b.isDay === false) isNight = true;
        else if(Number.isFinite(Number(b.hour))){
          const h = Number(b.hour);
          isNight = h >= 19 || h < 5;
        }
      }
    }catch(e){}
    return {dayFloat, dayIndex:Math.max(1, Math.floor(dayFloat)), isNight};
  }
  function guardianDefeated(kind){
    const key = String(kind || '');
    try{
      const g = MM.guardianLairs || null;
      if(g && typeof g.status === 'function'){
        const st = g.status() || {};
        if(st.defeated && st.defeated[key]) return true;
      }
      if(g && typeof g.metrics === 'function'){
        const m = g.metrics() || {};
        if(m.defeated && m.defeated[key]) return true;
      }
    }catch(e){}
    try{
      const hearts = MM.progress && MM.progress.guardianHearts ? MM.progress.guardianHearts() : null;
      if(hearts && hearts[key]) return true;
    }catch(e){}
    return false;
  }
  function westGuardianDefeated(){ return guardianDefeated('ice'); }
  function eastGuardianDefeated(){ return guardianDefeated('fire'); }
  function isMolekinTeam(team){ return !!(team && team.kind === 'molekin'); }
  function isAlienTeam(team){ return !team || !team.kind || team.kind === 'aliens'; }
  function teamDisplayName(team){
    return isMolekinTeam(team) ? 'kretoludzi' : 'obcych';
  }
  function surfaceY(x, fallback){
    const tx = floor(x);
    try{
      const wg = (MM.worldGen && MM.worldGen.surfaceHeight) ? MM.worldGen : null;
      if(wg && wg.surfaceHeight){
        const y = wg.surfaceHeight(tx);
        if(Number.isFinite(y)) return y;
      }
    }catch(e){}
    return Number.isFinite(fallback) ? fallback : 60;
  }
  function readTile(getTile,x,y){
    try{
      if(typeof getTile === 'function') return getTile(floor(x),floor(y));
      if(MM.world && MM.world.getTile) return MM.world.getTile(floor(x),floor(y));
    }catch(e){}
    return T.AIR;
  }
  function writeTile(setTile,x,y,t){
    try{
      if(typeof setTile === 'function'){ setTile(floor(x),floor(y),t); return true; }
      if(MM.world && MM.world.setTile){ MM.world.setTile(floor(x),floor(y),t); return true; }
    }catch(e){}
    return false;
  }
  function inWorldY(y,pad=1){ return Number.isFinite(y) && y >= WORLD_TOP + pad && y < WORLD_BOTTOM - pad; }
  // Navigation openness must mirror movement collision exactly (foliage,
  // torches, ladders, water are all walk-through), otherwise forests and
  // decorated ground become artificial nav walls; only lava is treated as
  // a wall so paths never lead through it.
  function isAlienOpenTile(t){
    return !isSolid(t) && t !== T.LAVA;
  }
  function canStandAt(tx,ty,getTile){
    if(!inWorldY(ty,2)) return false;
    const here = readTile(getTile,tx,ty);
    const head = readTile(getTile,tx,ty-1);
    const below = readTile(getTile,tx,ty+1);
    return isAlienOpenTile(here) && isAlienOpenTile(head) && below !== T.WATER && below !== T.LAVA && isSolid(below);
  }

  // Shared navigation for all invasion units. getTileFn is repointed on every
  // update() call so the nav always reads through the host's tile accessor.
  const navWorld = {
    getTileFn:null,
    readTile(x,y){ return readTile(navWorld.getTileFn,x,y); },
    isOpen:isAlienOpenTile,
    isSolid:(t)=>isSolid(t) && t !== T.WATER && t !== T.LAVA,
    minY:WORLD_TOP,
    maxY:WORLD_BOTTOM
  };
  const nav = createNav(navWorld);
  const navByKind = new Map();
  function navForProfile(profile){
    const key = String((profile && profile.kind) || 'aliens');
    let n = navByKind.get(key);
    if(!n){
      n = createNav(navWorld, profile && profile.moveCaps);
      navByKind.set(key,n);
    }
    return n;
  }
  function ensureBrain(team){
    let brain = brains.get(team.id);
    if(!brain){
      const profile = profileFor(team);
      brain = createSquadBrain(profile, navForProfile(profile));
      brains.set(team.id, brain);
    }
    return brain;
  }

  registerTeamType('aliens', {
    moveCaps:{jumpUp:2,highJumpUp:4,jumpSpan:4,maxFall:9,maxNodes:760},
    baseSpeed:2.35,
    jumpVel:9.6,
    jumpKick:5.2,
    highJumpMult:1.5,
    fireRange:14,
    meleeRange:0.72,
    fleeHpFrac:0.32,
    fleeDist:15,
    siegeAfter:3.5,
    breachRange:12,
    routeBreachAfter:1.05,
    routeBreachRange:18,
    buildCap:8,
    rampBudget:12
  });
  registerTeamType('molekin', {
    moveCaps:{jumpUp:2,highJumpUp:4,jumpSpan:3,maxFall:10,maxNodes:820},
    baseSpeed:2.08,
    jumpVel:8.25,
    jumpKick:4.6,
    highJumpMult:1.75,
    fireRange:10.5,
    meleeRange:0.84,
    fleeHpFrac:0.30,
    fleeDist:11,
    repairHpFrac:0.34,
    repairMinHpFrac:0.08,
    repairDoneFrac:0.76,
    repairRange:1.9,
    repairRate:0.24,
    siegeAfter:2.45,
    breachRange:9.5,
    routeBreachAfter:0.42,
    routeBreachRange:16,
    buildCap:5,
    rampBudget:12,
    coreRoles:['rusher','tank','healer','sapper'],
    roles:{
      rusher:{weight:3.2,minRange:0.9,maxRange:2.8,speedMult:1.06,fireCd:1.02,damageMult:1.00,aim:0.72},
      tank:{weight:1.2,minRange:0.7,maxRange:2.4,speedMult:0.76,fireCd:1.25,damageMult:1.18,aim:0.64,stoic:true,guard:true},
      healer:{weight:1.0,minRange:2.0,maxRange:6.2,speedMult:0.92,fireCd:1.45,damageMult:0.58,aim:0.72,support:true,healRange:4.8,healCd:1.25,healAmount:4.2},
      flanker:{weight:2.0,minRange:0.9,maxRange:3.6,speedMult:1.18,fireCd:0.95,damageMult:0.98,aim:0.70,flank:true},
      orbiter:{weight:1.0,minRange:3.4,maxRange:7.4,speedMult:1.02,fireCd:1.35,damageMult:0.86,aim:0.76,orbit:4.6},
      sniper:{weight:1.35,minRange:6.0,maxRange:10.8,speedMult:0.86,fireCd:2.0,damageMult:1.55,aim:0.88,coverAfterShot:true,skittish:true},
      sapper:{weight:1.9,minRange:0.8,maxRange:4.8,speedMult:0.94,fireCd:1.05,damageMult:0.88,aim:0.70,tileDmgMult:3.8,breacher:true},
      engineer:{weight:1.0,minRange:3.0,maxRange:6.8,speedMult:0.90,fireCd:1.55,damageMult:0.76,aim:0.72,builder:true}
    }
  });
  function findSurfaceStandSpot(x, nearY, getTile){
    const tx = floor(x);
    const s = surfaceY(tx, nearY);
    const start = clamp(floor(s) - 10, WORLD_TOP + 3, WORLD_BOTTOM - 5);
    const end = clamp(floor(s) + 28, WORLD_TOP + 3, WORLD_BOTTOM - 4);
    for(let y=start; y<=end; y++){
      if(canStandAt(tx,y,getTile)) return {x:tx+0.5,y};
    }
    for(let y=clamp(floor(nearY || s) - 20, WORLD_TOP + 3, WORLD_BOTTOM - 5); y<WORLD_BOTTOM-4; y++){
      if(canStandAt(tx,y,getTile)) return {x:tx+0.5,y};
    }
    return {x:tx+0.5, y:clamp(floor(s)-1, WORLD_TOP+3, WORLD_BOTTOM-4)};
  }
  function findLocalStandSpot(x, nearY, getTile){
    const tx = floor(x);
    const cy = Number.isFinite(Number(nearY)) ? Number(nearY) : surfaceY(tx,60);
    const spans = [
      [cy - 8, cy + 14],
      [cy - 22, cy + 30]
    ];
    for(const span of spans){
      const start = clamp(floor(span[0]), WORLD_TOP + 3, WORLD_BOTTOM - 5);
      const end = clamp(floor(span[1]), WORLD_TOP + 3, WORLD_BOTTOM - 4);
      for(let y=start; y<=end; y++){
        if(canStandAt(tx,y,getTile)) return {x:tx+0.5,y};
      }
    }
    return findSurfaceStandSpot(x, cy, getTile);
  }
  function forcedVisibleSpot(player, side, index, kind, getTile){
    const px = floor(player && Number.isFinite(player.x) ? player.x : 0);
    const py = player && Number.isFinite(player.y) ? player.y : surfaceY(px,60);
    const base = (kind === 'molekin' ? 5 : 7) + index * (kind === 'molekin' ? 3 : 4);
    const offsets = [base, base + 2, Math.max(3, base - 2), base + 4, base + 7];
    const candidates = [];
    for(let i=0; i<offsets.length; i++){
      const dir = i % 2 === 0 ? side : -side;
      candidates.push(px + dir * offsets[i]);
    }
    for(const x of candidates){
      const spot = findLocalStandSpot(x, py, getTile);
      if(canStandAt(floor(spot.x), floor(spot.y), getTile)) return spot;
    }
    return findLocalStandSpot(px + side * base, py, getTile);
  }
  function findLandingSpot(player, side, index, getTile){
    const px = floor(player && Number.isFinite(player.x) ? player.x : 0);
    const py = player && Number.isFinite(player.y) ? player.y : surfaceY(px,60);
    const base = 22 + index * 12;
    const candidates = [];
    for(let r=0; r<9; r++){
      const offset = base + r * 5 + Math.floor(Math.random() * 4);
      candidates.push(px + side * offset);
      if(r % 2 === 0) candidates.push(px - side * (offset + 3));
    }
    for(const x of candidates){
      const spot = findSurfaceStandSpot(x, py, getTile);
      if(canStandAt(floor(spot.x), floor(spot.y), getTile)) return spot;
    }
    return findSurfaceStandSpot(px + side * base, py, getTile);
  }
  function xpNeedForLevel(level){ return Math.round(60 * Math.pow(Math.max(1, level || 1),1.35)); }
  function levelForXpValue(xp){
    let lvl = 1;
    let acc = 0;
    const total = Math.max(0, Number(xp) || 0);
    while(lvl < PLAYER_LEVEL_CAP){
      const need = xpNeedForLevel(lvl);
      if(total < acc + need) break;
      acc += need;
      lvl++;
    }
    return lvl;
  }
  function playerLevelFor(player,opts){
    opts = opts || {};
    if(Number.isFinite(opts.playerLevel)) return Math.max(1, Math.min(PLAYER_LEVEL_CAP, Math.floor(Number(opts.playerLevel))));
    try{
      if(MM.progress && typeof MM.progress.level === 'function'){
        const lv = MM.progress.level();
        if(lv && Number.isFinite(Number(lv.level))) return Math.max(1, Math.min(PLAYER_LEVEL_CAP, Math.floor(Number(lv.level))));
      }
    }catch(e){}
    return levelForXpValue(player && Number.isFinite(Number(player.xp)) ? Number(player.xp) : 0);
  }
  function threatLevelFor(day,playerLevel,opts){
    opts = opts || {};
    if(Number.isFinite(opts.threatLevel)) return Math.max(1, Math.min(160, Math.floor(Number(opts.threatLevel))));
    const d = Math.max(1, Math.floor(Number(day) || 1));
    const lv = Math.max(1, Math.floor(Number(playerLevel) || 1));
    // Player growth remains the main signal, while elapsed days stop a low-XP
    // hermit world from staying harmless forever. Tuned to put level 50 near
    // threat 40 on an early world, leaving headroom for long-lived saves.
    const scaled = 1 + Math.max(0, lv - 1) * 0.78 + Math.max(0, d - 1) * 0.28;
    return Math.max(d, Math.round(scaled));
  }
  function gradeForThreat(threatLevel){
    const threat = Math.max(1, Number(threatLevel) || 1);
    if(threat >= THREAT_GRADE_THRESHOLDS[3]) return 3;
    if(threat >= THREAT_GRADE_THRESHOLDS[2]) return 2;
    if(threat >= THREAT_GRADE_THRESHOLDS[1]) return 1;
    return 0;
  }
  function weaponTierForThreat(threatLevel,grade){
    const resolved = Number.isFinite(Number(grade)) ? Number(grade) : gradeForThreat(threatLevel);
    return Math.max(0, Math.min(3, Math.floor(resolved)));
  }
  function threatHpScale(threatLevel){
    return 1 + Math.min(2.05, Math.max(0, (Number(threatLevel) || 1) - 1) * 0.034);
  }
  function threatDamageScale(threatLevel,weaponTier){
    return 1 + Math.min(1.00, Math.max(0, (Number(threatLevel) || 1) - 1) * 0.016) + Math.max(0,Number(weaponTier)||0) * 0.050;
  }
  function threatSpeedScale(threatLevel,grade){
    return 1 + Math.min(0.28, Math.max(0, (Number(threatLevel) || 1) - 1) * 0.0035 + Math.max(0,Number(grade)||0) * 0.030);
  }
  function threatHealScale(threatLevel){
    return 1 + Math.min(0.65, Math.max(0, (Number(threatLevel) || 1) - 1) * 0.009);
  }
  function teamThreatLevel(team){
    if(team && Number.isFinite(Number(team.threatLevel))) return Math.max(1, Math.floor(Number(team.threatLevel)));
    return Math.max(1, Math.floor(Number(team && team.day) || 1));
  }
  function teamGrade(team){
    if(team && Number.isFinite(Number(team.grade))) return Math.max(0, Math.min(3, Math.floor(Number(team.grade))));
    return gradeForThreat(teamThreatLevel(team));
  }
  function teamWeaponTier(team){
    if(team && Number.isFinite(Number(team.weaponTier))) return Math.max(0, Math.min(3, Math.floor(Number(team.weaponTier))));
    return weaponTierForThreat(teamThreatLevel(team), teamGrade(team));
  }
  function hordeThreatLevel(threatLevel){
    const threat = Math.max(1, Number(threatLevel) || 1);
    return Math.max(1, Math.round(1 + (threat - 1) * 0.55));
  }
  function unitThreatLevel(team,a){
    if(a && Number.isFinite(Number(a.threatLevel))) return Math.max(1, Math.floor(Number(a.threatLevel)));
    const threat = teamThreatLevel(team);
    return team && team.horde ? hordeThreatLevel(threat) : threat;
  }
  function unitGrade(team,a){
    if(a && Number.isFinite(Number(a.grade))) return Math.max(0, Math.min(3, Math.floor(Number(a.grade))));
    return team && team.horde ? 0 : teamGrade(team);
  }
  function unitWeaponTier(team,a){
    if(a && Number.isFinite(Number(a.weaponTier))) return Math.max(0, Math.min(3, Math.floor(Number(a.weaponTier))));
    return team && team.horde ? 0 : teamWeaponTier(team);
  }
  function teamCountForDay(day,playerLevel,threatLevel){
    const d = Math.max(1, Math.floor(Number(day) || 1));
    const threat = Math.max(d, Math.floor(Number(threatLevel) || d));
    const byDay = 1 + Math.floor(Math.max(0,d - 1) / 6);
    const byThreat = 1 + Math.floor(Math.max(0,threat - 1) / 16);
    const byPlayer = playerLevel >= 36 ? 3 : (playerLevel >= 16 ? 2 : 1);
    return Math.max(1, Math.min(INVASION_MAX_TEAMS, Math.max(byDay,byThreat,byPlayer)));
  }
  function requestedTeamCountForNight(opts,day,playerLevel,threatLevel){
    const requested = opts && opts.teams ? Number(opts.teams) : teamCountForDay(day,playerLevel,threatLevel);
    const cap = opts && opts.natural ? 2 : INVASION_MAX_TEAMS;
    return Math.max(1, Math.min(cap, Math.floor(Number(requested) || 1)));
  }
  function rawUnitPressure(day,index,playerLevel,threatLevel){
    const d = Math.max(1, Math.floor(Number(day) || 1));
    const threat = Math.max(d, Math.floor(Number(threatLevel) || d));
    const idx = Math.max(0, Math.floor(Number(index) || 0));
    const byDay = 3 + Math.floor(Math.max(0,d - 1) / 3) + Math.floor(idx / 2);
    const byThreat = 3 + Math.floor(Math.max(0,threat - 1) / 5) + Math.floor(idx / 2);
    const levelNudge = Math.floor(Math.max(0,(Number(playerLevel) || 1) - 1) / 18);
    return Math.max(3, Math.max(byDay,byThreat) + levelNudge);
  }
  function alienCountForDay(day,index,playerLevel,threatLevel){
    return Math.min(TEAM_SIZE_REGULAR_MAX, rawUnitPressure(day,index,playerLevel,threatLevel));
  }
  // The head-count the old curve wanted ABOVE the 8-unit cap comes back as
  // elites: a third of the overflow, plus one freebie once the team grade hits
  // "veteran" territory — late-game squads stay small but get golden.
  function eliteCountForDay(day,index,playerLevel,threatLevel,count){
    const overflow = Math.max(0, rawUnitPressure(day,index,playerLevel,threatLevel) - TEAM_SIZE_REGULAR_MAX);
    const threat = Math.max(Math.floor(Number(threatLevel) || 1), Math.floor(Number(day) || 1));
    const gradeBonus = gradeForThreat(threat) >= 2 ? 1 : 0;
    return Math.max(0, Math.min(ELITE_MAX_PER_TEAM, Math.max(0,(count|0) - 1), Math.ceil(overflow / 3) + gradeBonus));
  }
  function xpRewardForTeam(day,count,playerLevel,threatLevel){
    const d = Math.max(1, Math.floor(Number(day) || 1));
    const c = Math.max(1, Math.floor(Number(count) || 1));
    const lv = Math.max(1, Math.floor(Number(playerLevel) || 1));
    const threat = Math.max(d, Math.floor(Number(threatLevel) || d));
    const grade = gradeForThreat(threat);
    // A first-night squad no longer jumps the hero multiple levels, while a
    // level-50 victory still funds meaningful progress (roughly 2k XP/team).
    return Math.round(110 + d * 15 + c * 24 + Math.max(0,lv - 1) * 18 + Math.max(0,threat - d) * 8 + grade * 60);
  }
  function normalizeEncounter(value,fallback){
    const key = String(value || '').toLowerCase();
    return ENCOUNTER_TYPES.includes(key) ? key : (fallback || 'patrol');
  }
  function weightedPick(entries){
    let total = 0;
    for(const entry of entries) total += Math.max(0, Number(entry.weight) || 0);
    let roll = Math.random() * Math.max(1,total);
    for(const entry of entries){
      roll -= Math.max(0, Number(entry.weight) || 0);
      if(roll <= 0) return entry.key;
    }
    return entries[0] ? entries[0].key : 'patrol';
  }
  function chooseEncounter(kind,day,playerLevel,opts){
    opts = opts || {};
    if(opts.horde) return 'swarm';
    if(opts.encounter || opts.forceEncounter) return normalizeEncounter(opts.encounter || opts.forceEncounter,'classic');
    // Debug/quest summons keep their predictable legacy shape unless they ask
    // for an archetype. Real nightly teams use the procedural deck below.
    if(!opts.natural) return 'classic';
    const d = Math.max(1, Number(day) || 1);
    const lv = Math.max(1, Number(playerLevel) || 1);
    const mole = kind === 'molekin';
    const deck = [
      {key:'patrol',weight:20},
      {key:'menagerie',weight:d >= 3 || lv >= 4 ? (mole ? 18 : 16) : 0},
      {key:'airborne',weight:d >= 6 || lv >= 8 ? (mole ? 11 : 16) : 0},
      {key:'arsenal',weight:d >= 8 || lv >= 10 ? 15 : 0},
      {key:'colossus',weight:d >= 12 || lv >= 16 ? 9 : 0},
      {key:'wildcard',weight:d >= 16 || lv >= 24 ? 12 : 0}
    ];
    return weightedPick(deck);
  }
  function encounterUnitCount(encounter,baseCount){
    const base = Math.max(1, Math.floor(Number(baseCount) || 1));
    if(encounter === 'swarm') return HORDE_SIZE_MIN + Math.floor(Math.random() * (HORDE_SIZE_MAX - HORDE_SIZE_MIN + 1));
    if(encounter === 'menagerie') return Math.min(14, Math.max(6, base + 2 + Math.floor(Math.random()*3)));
    if(encounter === 'airborne') return Math.min(12, Math.max(5, base + 1));
    if(encounter === 'colossus') return Math.min(5, Math.max(1, 1 + Math.floor(base/3)));
    if(encounter === 'wildcard') return Math.min(14, Math.max(5, base + Math.floor(Math.random()*4)));
    return Math.min(TEAM_SIZE_REGULAR_MAX,base);
  }
  function encounterXpMultiplier(encounter){
    if(encounter === 'swarm') return 0.58;
    if(encounter === 'menagerie') return 0.92;
    if(encounter === 'airborne') return 1.04;
    if(encounter === 'arsenal') return 1.08;
    if(encounter === 'colossus') return 1.36;
    if(encounter === 'wildcard') return 1.10;
    return 1;
  }
  const ALIEN_FORM_DEFS = Object.freeze({
    trooper:{hp:1,damage:1,taken:1,speed:1,jump:1,size:1,mobility:'ground'},
    skitter:{hp:0.52,damage:0.72,taken:1.18,speed:1.30,jump:1.18,size:0.67,mobility:'ground',pet:true},
    razorhound:{hp:0.76,damage:1.05,taken:1.08,speed:1.24,jump:1.12,size:0.82,mobility:'ground',pet:true},
    glider:{hp:0.60,damage:0.68,taken:1.18,speed:1.14,jump:1,size:0.76,mobility:'winged',pet:true},
    jelly:{hp:0.70,damage:0.76,taken:1.12,speed:0.96,jump:1,size:0.84,mobility:'hover',pet:true},
    jetpack:{hp:0.88,damage:0.96,taken:1.06,speed:1.12,jump:1,size:0.94,mobility:'jetpack'},
    brute:{hp:1.55,damage:1.22,taken:0.82,speed:0.78,jump:0.82,size:1.34,mobility:'ground'},
    colossus:{hp:6.20,damage:1.72,taken:0.62,speed:0.55,jump:0.68,size:2.20,mobility:'ground',giant:true}
  });
  const MOLEKIN_FORM_DEFS = Object.freeze({
    miner:{hp:1,damage:1,taken:1,speed:1,jump:1,size:1,mobility:'ground'},
    tunnel_hound:{hp:0.68,damage:0.92,taken:1.10,speed:1.28,jump:1.12,size:0.76,mobility:'ground',pet:true},
    ember_mite:{hp:0.40,damage:0.60,taken:1.25,speed:1.34,jump:1.16,size:0.55,mobility:'ground',pet:true},
    cave_bat:{hp:0.48,damage:0.64,taken:1.22,speed:1.22,jump:1,size:0.66,mobility:'winged',pet:true},
    drill_beetle:{hp:0.92,damage:0.88,taken:0.82,speed:0.82,jump:0.72,size:0.88,mobility:'ground',pet:true},
    rocket_mole:{hp:0.86,damage:0.92,taken:1.06,speed:1.10,jump:1,size:0.92,mobility:'jetpack'},
    brute:{hp:1.62,damage:1.26,taken:0.78,speed:0.74,jump:0.74,size:1.38,mobility:'ground'},
    colossus:{hp:6.50,damage:1.78,taken:0.58,speed:0.50,jump:0.62,size:2.25,mobility:'ground',giant:true}
  });
  const ALIEN_WEAPON_PROFILES = Object.freeze({
    pulse:{damage:1,range:1,charge:1,terrain:1,beams:1,spread:0,knockback:1,heavy:false},
    needle:{damage:0.74,range:1.22,charge:0.70,terrain:0.66,beams:1,spread:0,knockback:0.72,heavy:false},
    burst:{damage:0.82,range:1.04,charge:0.76,terrain:0.82,beams:2,spread:0.045,knockback:0.82,heavy:false},
    scatter:{damage:0.58,range:0.84,charge:0.88,terrain:0.72,beams:3,spread:0.115,knockback:0.70,heavy:false},
    lance:{damage:1.58,range:1.34,charge:1.42,terrain:1.72,beams:1,spread:0,knockback:1.45,heavy:true},
    arc:{damage:0.86,range:0.72,charge:0.62,terrain:0.78,beams:1,spread:0,knockback:1.72,heavy:false},
    plasma:{damage:1.26,range:0.94,charge:1.14,terrain:1.34,beams:1,spread:0,knockback:1.18,heavy:true},
    spit:{damage:0.64,range:0.68,charge:0.72,terrain:0.56,beams:1,spread:0,knockback:0.58,heavy:false}
  });
  const MOLE_WEAPON_PROFILES = Object.freeze({
    stone:{damage:1,terrain:1,speed:1,gravity:1,radius:1,hazard:0,heavy:false},
    shrapnel:{damage:0.72,terrain:0.82,speed:1.26,gravity:0.82,radius:0.78,hazard:0,heavy:false},
    boulder:{damage:1.46,terrain:1.48,speed:0.82,gravity:1.10,radius:1.42,hazard:0.08,heavy:true},
    firepot:{damage:1.08,terrain:1.18,speed:0.88,gravity:1.05,radius:1.18,hazard:0.52,heavy:true},
    drill:{damage:0.88,terrain:1.92,speed:1.04,gravity:0.90,radius:0.96,hazard:0.12,heavy:true},
    ember:{damage:0.62,terrain:0.52,speed:1.34,gravity:0.55,radius:0.72,hazard:0.18,heavy:false}
  });
  // Every body form has its own readable death verb. The renderer combines
  // this authored silhouette with a per-unit seed, procedural body variant,
  // facing, velocity and the killing weapon's accent, so even two deaths of
  // the same species do not break apart in exactly the same way.
  const DEATH_PROFILES = Object.freeze({
    aliens:Object.freeze({
      trooper:  Object.freeze({style:'alien_phase_out', life:1.08, primary:'#72ffe0', secondary:'#e5fff8', element:'electric', sound:'spark'}),
      skitter:  Object.freeze({style:'alien_skitter_pop',life:0.78, primary:'#a7ff70', secondary:'#fff59a', element:'toxic', sound:'hit'}),
      razorhound:Object.freeze({style:'alien_hound_tumble',life:1.18,primary:'#ff8fcf', secondary:'#8dffe6', element:'exotic', sound:'thud'}),
      glider:   Object.freeze({style:'alien_glider_spiral',life:1.42, primary:'#8de8ff', secondary:'#e5fbff', element:'arc', sound:'wind'}),
      jelly:    Object.freeze({style:'alien_jelly_bloom',life:1.30, primary:'#c684ff', secondary:'#9effd2', element:'iridium', sound:'splash'}),
      jetpack:  Object.freeze({style:'alien_jetpack_launch',life:1.34,primary:'#ff9a5c', secondary:'#72ffe0', element:'fire', sound:'explosion',eventAt:0.50}),
      brute:    Object.freeze({style:'alien_armor_shatter',life:1.48,primary:'#9dc9dc', secondary:'#ffcf70', element:'steel', sound:'break',eventAt:0.38}),
      colossus: Object.freeze({style:'alien_colossus_fall',life:2.72,primary:'#ffd75e', secondary:'#72ffe0', element:'exotic', sound:'explosion',eventAt:0.68,giant:true})
    }),
    molekin:Object.freeze({
      miner:       Object.freeze({style:'mole_burrow_sink',life:1.12, primary:'#c99a63', secondary:'#ffd087', element:'sand', sound:'dig'}),
      tunnel_hound:Object.freeze({style:'mole_hound_dustroll',life:1.16,primary:'#b87848', secondary:'#e5c18a', element:'sand', sound:'thud'}),
      ember_mite:  Object.freeze({style:'mole_ember_pop',life:0.82, primary:'#ff6b2f', secondary:'#ffe36c', element:'fire', sound:'fire'}),
      cave_bat:    Object.freeze({style:'mole_bat_ashfall',life:1.38, primary:'#9d8b84', secondary:'#ffb25b', element:'obsidian', sound:'wind'}),
      drill_beetle:Object.freeze({style:'mole_beetle_split',life:1.28,primary:'#66d8c8', secondary:'#e9d49a', element:'steel', sound:'break',eventAt:0.42}),
      rocket_mole: Object.freeze({style:'mole_rocket_misfire',life:1.36,primary:'#ff7138', secondary:'#ffd45c', element:'fire', sound:'explosion',eventAt:0.48}),
      brute:       Object.freeze({style:'mole_rock_crumble',life:1.52,primary:'#89786c', secondary:'#ff9d45', element:'stone', sound:'break',eventAt:0.40}),
      colossus:    Object.freeze({style:'mole_colossus_cavein',life:2.84,primary:'#ff7a36', secondary:'#d6a467', element:'stone', sound:'explosion',eventAt:0.66,giant:true})
    })
  });
  function textHash(value){
    const s=String(value||'');
    let h=2166136261>>>0;
    for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
    h^=h>>>16; h=Math.imul(h,0x7feb352d); h^=h>>>15;
    return h>>>0;
  }
  function deathRand(seed,index){
    let x=(Number(seed)||1)>>>0;
    x^=Math.imul((Number(index)||0)+1,0x9e3779b1);
    x^=x>>>16; x=Math.imul(x,0x7feb352d); x^=x>>>15; x=Math.imul(x,0x846ca68b); x^=x>>>16;
    return (x>>>0)/0x100000000;
  }
  function deathProfileFor(team,a){
    const kind=(isMolekinTeam(team)||(a&&a.kind==='molekin'))?'molekin':'aliens';
    const table=DEATH_PROFILES[kind];
    const fallback=kind==='molekin'?'miner':'trooper';
    return table[String(a&&a.form||'')] || table[fallback];
  }
  function deathSourceAccent(opts,profile){
    const key=String((opts&&(opts.element||opts.weaponType||opts.kind||opts.cause))||'').toLowerCase();
    if(/fire|flame|lava|ember/.test(key)) return '#ff8a38';
    if(/electric|shock|arc|lightning/.test(key)) return '#72dfff';
    if(/ice|frost|chill|snow/.test(key)) return '#d8f7ff';
    if(/poison|toxic|gas|spit/.test(key)) return '#a8ff70';
    if(/explosion|blast|rocket/.test(key)) return '#ffd45c';
    if(/bow|arrow|needle/.test(key)) return '#fff1b0';
    if(/melee|sword|axe|hammer/.test(key)) return '#ffcf70';
    return profile.secondary;
  }
  function deathPoseFor(a){
    const maxHp=Math.max(1,Number(a&&a.maxHp)||1);
    return Object.assign({},a,{
      hp:maxHp,maxHp,dead:false,hitFlashUntil:0,healFlashUntil:0,
      speechText:'',speechUntil:0,speechLong:false,_ai:null,extract:null,
      alienCharge:null,moleCharge:null,lastStompAt:0,
      variant:Object.assign({},a&&a.variant||{})
    });
  }
  function trimDeathFx(){
    if(deathFx.length>DEATH_FX_CAP) deathFx.splice(0,deathFx.length-DEATH_FX_CAP);
  }
  function emitDeathParticles(fx,stage){
    try{
      const p=MM.particles;
      if(!p) return;
      const tile=MM.TILE||DEFAULT_TILE;
      const px=fx.x*tile,py=(fx.y-0.42*Math.min(1.6,fx.scale))*tile;
      const major=!!(fx.giant||fx.commander||fx.elite);
      if(stage===0){
        if(p.spawnImpactChips) p.spawnImpactChips(px,py,{power:clamp(0.55+fx.scale*0.42,0.55,2.4),element:fx.element,major,dir:fx.facing});
        if(p.spawnSparks) p.spawnSparks(px,py,major?'epic':(fx.chaff?'common':'rare'),fx.chaff?3:(major?14:7));
        if((fx.style==='mole_burrow_sink'||fx.style==='mole_hound_dustroll'||fx.style==='mole_colossus_cavein')&&p.spawnSmoke){
          p.spawnSmoke(px,fx.y*tile,major?1.8:0.55,{tileX:floor(fx.x),tileY:floor(fx.y),tileSize:tile});
        }
        if(fx.style==='alien_jelly_bloom'&&p.spawnSplash) p.spawnSplash(px,py,0.55);
      } else if(fx.giant){
        if(p.spawnBurst) p.spawnBurst(px,fx.y*tile,'epic',{sound:false});
        if(p.spawnImpactChips) p.spawnImpactChips(px,fx.y*tile,{power:2.2,element:fx.element,major:true});
        if(p.spawnSmoke) p.spawnSmoke(px,fx.y*tile,2.2,{tileX:floor(fx.x),tileY:floor(fx.y),tileSize:tile});
      } else if(/launch|misfire|shatter|split|crumble|lander/.test(fx.style)){
        if(p.spawnBurst) p.spawnBurst(px,py,'rare',{sound:false});
        if(p.spawnSparks) p.spawnSparks(px,py,'rare',10);
      }
    }catch(e){}
  }
  function playDeathCue(fx){
    const now=nowMs();
    const gap=fx.chaff?130:75;
    if(!fx.giant&&!fx.commander&&now-lastDeathSoundAt<gap) return;
    lastDeathSoundAt=now;
    play(fx.sound||'hit',{x:fx.x,y:fx.y-0.4});
  }
  function spawnDeathFx(team,a,opts){
    if(!a||a.deathFxSpawned) return null;
    const profile=deathProfileFor(team,a);
    const kind=(isMolekinTeam(team)||a.kind==='molekin')?'molekin':'aliens';
    const id='death:'+(a.id||kind+':'+deathFxSeq)+':'+(deathFxSeq++);
    const scale=clamp(Number(a.hitboxScale)||1,0.42,2.85);
    const fx={
      id,teamId:String(team&&team.id||a.teamId||''),kind,form:String(a.form||''),style:profile.style,
      x:Number(a.x)||0,y:Number(a.y)||0,vx:Number(a.vx)||0,vy:Number(a.vy)||0,
      facing:Number(a.facing)<0?-1:1,scale,seed:textHash(id+'|'+String(a.weaponType||'')),
      t:0,life:Math.max(0.62,profile.life*(a.chaff?0.82:1)),eventAt:Number(profile.eventAt)||0,
      primary:profile.primary,secondary:profile.secondary,accent:deathSourceAccent(opts,profile),element:profile.element,
      sound:profile.sound,giant:!!(a.giant||profile.giant),commander:a.role==='commander',elite:!!a.elite,chaff:!!a.chaff,
      isPet:!!a.isPet,weaponType:String(a.weaponType||''),stageTriggered:false,ghost:false,pose:deathPoseFor(a)
    };
    a.deathFxSpawned=true;
    a.deathFxId=id;
    a.deathStyle=profile.style;
    deathFx.push(fx);
    trimDeathFx();
    emitDeathParticles(fx,0);
    playDeathCue(fx);
    return fx;
  }
  function spawnLanderDeathFx(team,lander,opts){
    if(!lander||lander.deathFxSpawned) return null;
    const id='death:'+(team&&team.id||'lander')+':lander:'+(deathFxSeq++);
    const fx={
      id,teamId:String(team&&team.id||''),kind:'aliens',form:'lander',style:'alien_lander_breakup',
      x:Number(lander.x)||0,y:Number(lander.y)||0,vx:0,vy:0,facing:1,scale:1.75,seed:textHash(id),
      t:0,life:1.82,eventAt:0.44,primary:'#72ffe0',secondary:'#a8c9d6',accent:deathSourceAccent(opts,{secondary:'#ffd45c'}),
      element:'steel',sound:'explosion',giant:false,commander:false,elite:true,chaff:false,isPet:false,weaponType:'',
      stageTriggered:false,ghost:false,pose:null
    };
    lander.deathFxSpawned=true;
    deathFx.push(fx);
    trimDeathFx();
    emitDeathParticles(fx,0);
    playDeathCue(fx);
    return fx;
  }
  function loadoutPick(list,team,index,salt){
    if(!list.length) return '';
    let x=(Number(team && team.loadoutSeed)||1)>>>0;
    x^=Math.imul((Number(index)||0)+1,0x9e3779b1);
    x^=Math.imul((Number(salt)||0)+1,0x85ebca6b);
    x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;
    return list[(x>>>0)%list.length] || list[0];
  }
  function formDefFor(kind,form){
    const table = kind === 'molekin' ? MOLEKIN_FORM_DEFS : ALIEN_FORM_DEFS;
    return table[form] || table[kind === 'molekin' ? 'miner' : 'trooper'];
  }
  function normalizeUnitForm(kind,value){
    const table = kind === 'molekin' ? MOLEKIN_FORM_DEFS : ALIEN_FORM_DEFS;
    const key = String(value || '');
    return Object.prototype.hasOwnProperty.call(table,key) ? key : (kind === 'molekin' ? 'miner' : 'trooper');
  }
  function normalizeUnitWeapon(kind,value){
    const table = kind === 'molekin' ? MOLE_WEAPON_PROFILES : ALIEN_WEAPON_PROFILES;
    const key = String(value || '');
    return Object.prototype.hasOwnProperty.call(table,key) ? key : (kind === 'molekin' ? 'stone' : 'pulse');
  }
  function weaponForLoadout(team,kind,form,role,encounter,index){
    if(kind === 'molekin'){
      if(encounter === 'classic') return 'stone';
      if(encounter === 'arsenal') return ['stone','shrapnel','firepot','drill','boulder'][index%5];
      if(form === 'colossus') return loadoutPick(['boulder','firepot','drill'],team,index,1);
      if(form === 'cave_bat' || form === 'ember_mite') return 'ember';
      if(form === 'drill_beetle') return 'drill';
      if(form === 'tunnel_hound') return loadoutPick(['ember','shrapnel'],team,index,2);
      if(form === 'rocket_mole') return loadoutPick(['firepot','shrapnel'],team,index,3);
      if(role === 'sniper') return loadoutPick(['shrapnel','boulder'],team,index,4);
      if(role === 'sapper') return loadoutPick(['drill','firepot'],team,index,5);
      if(role === 'tank') return loadoutPick(['stone','boulder'],team,index,6);
      return loadoutPick(['stone','stone','shrapnel','ember','firepot'],team,index,7);
    }
    if(encounter === 'classic') return 'pulse';
    if(encounter === 'arsenal') return ['pulse','needle','burst','scatter','lance','arc','plasma'][index%7];
    if(form === 'colossus') return loadoutPick(['lance','plasma'],team,index,8);
    if(form === 'glider') return loadoutPick(['needle','scatter'],team,index,9);
    if(form === 'jelly') return loadoutPick(['arc','spit'],team,index,10);
    if(form === 'skitter' || form === 'razorhound') return loadoutPick(['spit','arc','scatter'],team,index,11);
    if(form === 'jetpack') return loadoutPick(['burst','arc','pulse'],team,index,12);
    if(form === 'brute') return loadoutPick(['plasma','scatter','pulse'],team,index,13);
    if(role === 'sniper') return loadoutPick(['needle','lance'],team,index,14);
    if(role === 'tank') return loadoutPick(['pulse','plasma'],team,index,15);
    if(role === 'sapper') return loadoutPick(['scatter','plasma'],team,index,16);
    if(role === 'healer') return loadoutPick(['arc','pulse'],team,index,17);
    return loadoutPick(['pulse','pulse','needle','burst','scatter','arc'],team,index,18);
  }
  function formForEncounter(team,kind,encounter,index,count){
    const mole = kind === 'molekin';
    const base = mole ? 'miner' : 'trooper';
    const pets = mole ? ['tunnel_hound','ember_mite','cave_bat','drill_beetle'] : ['skitter','razorhound','glider','jelly'];
    const flyers = mole ? ['cave_bat','rocket_mole'] : ['glider','jetpack','jelly'];
    if(encounter === 'classic') return base;
    if(encounter === 'menagerie') return index === 0 ? base : pets[((Number(team.loadoutSeed)||0)+index-1)%pets.length];
    if(encounter === 'airborne') return index === count-1 ? base : flyers[((Number(team.loadoutSeed)||0)+index)%flyers.length];
    if(encounter === 'arsenal') return index%4 === 3 ? (mole ? 'brute' : 'jetpack') : base;
    if(encounter === 'swarm') return pets[((Number(team.loadoutSeed)||0)+index)%3];
    if(encounter === 'colossus') return index === 0 ? 'colossus' : (index%2 ? loadoutPick(pets,team,index,19) : base);
    if(encounter === 'wildcard'){
      const pool=[base,'brute',...pets,...flyers];
      return pool[((Number(team.loadoutSeed)||0)+index)%pool.length];
    }
    // Patrols are readable mixed squads: mostly soldiers, with a surprise pet,
    // flyer, or bruiser often enough that consecutive nights diverge.
    if(index === count-1 && count >= 4) return loadoutPick(pets,team,index,21);
    if(index === count-2 && count >= 6) return loadoutPick(flyers,team,index,22);
    if(index === 1 && count >= 8 && loadoutPick([0,0,1],team,index,23)) return 'brute';
    return loadoutPick([0,0,0,0,0,1],team,index,24) ? loadoutPick(pets,team,index,25) : base;
  }
  function unitLoadoutFor(team,role,index){
    const kind = isMolekinTeam(team) ? 'molekin' : 'aliens';
    const encounter = normalizeEncounter(team && team.encounter,team && team.horde ? 'swarm' : 'patrol');
    const form = formForEncounter(team,kind,encounter,index,Math.max(1,team.alienCount|0));
    const def = formDefFor(kind,form);
    return {
      form,
      weaponType:weaponForLoadout(team,kind,form,role,encounter,index),
      mobility:def.mobility || 'ground',
      isPet:!!def.pet,
      giant:!!def.giant,
      chaff:encounter === 'swarm',
      silent:!!def.pet,
      hpMult:Number(def.hp)||1,
      damageMult:Number(def.damage)||1,
      takenMult:Number(def.taken)||1,
      speedMult:Number(def.speed)||1,
      jumpMult:Number(def.jump)||1,
      sizeMult:Number(def.size)||1
    };
  }
  const ALIEN_ROLE_STATS = {
    rusher:  {hp:1.00, speed:1.04, jump:1.00, damage:1.00, taken:1.00, size:1.00},
    tank:    {hp:1.85, speed:0.72, jump:0.88, damage:1.08, taken:0.70, size:1.24},
    commander:{hp:3.70, speed:0.68, jump:0.84, damage:1.25, taken:0.66, size:1.34},
    healer:  {hp:0.84, speed:0.98, jump:1.02, damage:0.58, taken:1.08, heal:1.22, size:0.94},
    flanker: {hp:0.92, speed:1.14, jump:1.06, damage:0.95, taken:1.05, size:0.92},
    orbiter: {hp:0.95, speed:1.02, jump:1.18, damage:0.86, taken:1.00, size:0.96},
    sniper:  {hp:0.88, speed:0.88, jump:0.96, damage:1.55, taken:1.10, size:0.98},
    sapper:  {hp:1.06, speed:0.92, jump:0.94, damage:0.82, taken:0.98, size:1.04},
    engineer:{hp:1.02, speed:0.92, jump:0.94, damage:0.78, taken:0.98, size:1.02}
  };
  function alienRoleStats(role){
    return ALIEN_ROLE_STATS[role] || ALIEN_ROLE_STATS.rusher;
  }
  function makeAlienVariant(role){
    const stats = alienRoleStats(role);
    const baseSize = Number(stats.size) || 1;
    return {
      body:+clamp(baseSize * randRange(0.88,1.12),0.72,1.55).toFixed(3),
      height:+clamp((role === 'commander' ? 1.16 : role === 'tank' ? 1.08 : role === 'healer' ? 0.94 : 1) * randRange(0.90,1.14),0.78,1.42).toFixed(3),
      head:+randRange(0.86,1.18).toFixed(3),
      eye:+randRange(0.82,1.24).toFixed(3),
      antenna:+randRange(0.72,1.38).toFixed(3),
      arm:+randRange(0.84,1.22).toFixed(3),
      leg:+randRange(0.84,1.18).toFixed(3),
      stance:+randRange(-0.06,0.08).toFixed(3),
      gait:+randRange(0.78,1.26).toFixed(3),
      glow:+randRange(0.78,1.24).toFixed(3),
      tail:+randRange(0.62,1.45).toFixed(3),
      wing:+randRange(0.68,1.48).toFixed(3),
      horn:+randRange(0.55,1.52).toFixed(3),
      pattern:Math.floor(Math.random()*6)
    };
  }
  function normalizeAlienVariant(src,role){
    if(!src || typeof src !== 'object') return makeAlienVariant(role);
    return {
      body:+clamp(finiteNum(src.body)?src.body:1,0.42,2.80).toFixed(3),
      height:+clamp(finiteNum(src.height)?src.height:1,0.48,2.70).toFixed(3),
      head:+clamp(finiteNum(src.head)?src.head:1,0.72,1.35).toFixed(3),
      eye:+clamp(finiteNum(src.eye)?src.eye:1,0.70,1.35).toFixed(3),
      antenna:+clamp(finiteNum(src.antenna)?src.antenna:1,0.60,1.55).toFixed(3),
      arm:+clamp(finiteNum(src.arm)?src.arm:1,0.70,1.45).toFixed(3),
      leg:+clamp(finiteNum(src.leg)?src.leg:1,0.70,1.40).toFixed(3),
      stance:+clamp(finiteNum(src.stance)?src.stance:0,-0.14,0.14).toFixed(3),
      gait:+clamp(finiteNum(src.gait)?src.gait:1,0.60,1.50).toFixed(3),
      glow:+clamp(finiteNum(src.glow)?src.glow:1,0.55,1.80).toFixed(3),
      tail:+clamp(finiteNum(src.tail)?src.tail:1,0.45,1.80).toFixed(3),
      wing:+clamp(finiteNum(src.wing)?src.wing:1,0.45,1.90).toFixed(3),
      horn:+clamp(finiteNum(src.horn)?src.horn:1,0.35,1.90).toFixed(3),
      pattern:Math.max(0,Math.min(5,Math.floor(Number(src.pattern)||0)))
    };
  }
  const MOLEKIN_ROLE_STATS = {
    rusher:  {hp:1.05, speed:1.04, jump:0.90, damage:1.05, taken:0.98, size:0.98},
    tank:    {hp:1.95, speed:0.70, jump:0.78, damage:1.18, taken:0.64, size:1.25},
    healer:  {hp:0.92, speed:0.92, jump:0.84, damage:0.62, taken:1.04, heal:1.25, size:0.96},
    flanker: {hp:0.94, speed:1.18, jump:0.96, damage:1.02, taken:1.04, size:0.90},
    orbiter: {hp:0.98, speed:1.02, jump:0.92, damage:0.88, taken:0.98, size:0.94},
    sniper:  {hp:0.94, speed:0.84, jump:0.80, damage:1.52, taken:1.08, size:0.98},
    sapper:  {hp:1.16, speed:0.92, jump:0.78, damage:0.92, taken:0.88, size:1.06},
    engineer:{hp:1.04, speed:0.88, jump:0.80, damage:0.78, taken:0.96, size:1.02},
    commander:{hp:2.65, speed:0.66, jump:0.74, damage:1.30, taken:0.62, size:1.28}
  };
  function molekinRoleStats(role){
    return MOLEKIN_ROLE_STATS[role] || MOLEKIN_ROLE_STATS.rusher;
  }
  function makeMolekinVariant(role){
    const stats = molekinRoleStats(role);
    const baseSize = Number(stats.size) || 1;
    return {
      body:+clamp(baseSize * randRange(0.90,1.18),0.72,1.55).toFixed(3),
      height:+clamp((role === 'tank' ? 0.92 : role === 'flanker' ? 0.78 : 0.84) * randRange(0.88,1.12),0.62,1.18).toFixed(3),
      head:+randRange(0.86,1.20).toFixed(3),
      eye:+randRange(0.78,1.18).toFixed(3),
      arm:+randRange(0.92,1.32).toFixed(3),
      leg:+randRange(0.72,1.08).toFixed(3),
      stance:+randRange(-0.10,0.10).toFixed(3),
      gait:+randRange(0.88,1.34).toFixed(3),
      glow:+randRange(0.70,1.42).toFixed(3),
      helmet:+randRange(0.78,1.30).toFixed(3),
      snout:+randRange(0.76,1.28).toFixed(3),
      beard:+randRange(0.40,1.25).toFixed(3),
      claw:+randRange(0.86,1.36).toFixed(3),
      tail:+randRange(0.62,1.42).toFixed(3),
      wing:+randRange(0.68,1.44).toFixed(3),
      horn:+randRange(0.58,1.50).toFixed(3),
      pattern:Math.floor(Math.random()*6)
    };
  }
  function normalizeMolekinVariant(src,role){
    if(!src || typeof src !== 'object') return makeMolekinVariant(role);
    return {
      body:+clamp(finiteNum(src.body)?src.body:1,0.38,2.85).toFixed(3),
      height:+clamp(finiteNum(src.height)?src.height:0.88,0.42,2.55).toFixed(3),
      head:+clamp(finiteNum(src.head)?src.head:1,0.72,1.35).toFixed(3),
      eye:+clamp(finiteNum(src.eye)?src.eye:1,0.64,1.35).toFixed(3),
      arm:+clamp(finiteNum(src.arm)?src.arm:1,0.70,1.55).toFixed(3),
      leg:+clamp(finiteNum(src.leg)?src.leg:1,0.55,1.30).toFixed(3),
      stance:+clamp(finiteNum(src.stance)?src.stance:0,-0.16,0.16).toFixed(3),
      gait:+clamp(finiteNum(src.gait)?src.gait:1,0.62,1.55).toFixed(3),
      glow:+clamp(finiteNum(src.glow)?src.glow:1,0.45,1.70).toFixed(3),
      helmet:+clamp(finiteNum(src.helmet)?src.helmet:1,0.60,1.50).toFixed(3),
      snout:+clamp(finiteNum(src.snout)?src.snout:1,0.55,1.50).toFixed(3),
      beard:+clamp(finiteNum(src.beard)?src.beard:0.8,0.20,1.50).toFixed(3),
      claw:+clamp(finiteNum(src.claw)?src.claw:1,0.60,1.70).toFixed(3),
      tail:+clamp(finiteNum(src.tail)?src.tail:1,0.45,1.80).toFixed(3),
      wing:+clamp(finiteNum(src.wing)?src.wing:1,0.45,1.90).toFixed(3),
      horn:+clamp(finiteNum(src.horn)?src.horn:1,0.35,1.90).toFixed(3),
      pattern:Math.max(0,Math.min(5,Math.floor(Number(src.pattern)||0)))
    };
  }
  function unitRoleStats(kind,role){
    return kind === 'molekin' ? molekinRoleStats(role) : alienRoleStats(role);
  }
  function makeUnitVariant(kind,role){
    return kind === 'molekin' ? makeMolekinVariant(role) : makeAlienVariant(role);
  }
  function normalizeUnitVariant(kind,src,role){
    return kind === 'molekin' ? normalizeMolekinVariant(src,role) : normalizeAlienVariant(src,role);
  }
  function statJitter(base,spread){
    return clamp(base * randRange(1 - spread, 1 + spread), base * 0.75, base * 1.30);
  }
  function reseedAlienTraitsForRole(a,role,kind){
    if(!a) return;
    const unitKind = kind || a.kind || 'aliens';
    const r = role || 'rusher';
    const stats = unitRoleStats(unitKind,r);
    const variant = makeUnitVariant(unitKind,r);
    const oldMax = Math.max(1, Number(a.maxHp) || Number(a.hp) || 1);
    const oldHp = clamp(Number(a.hp) || oldMax, 0, oldMax);
    const hpFrac = oldMax > 0 ? oldHp / oldMax : 1;
    a.kind = unitKind;
    a.role = r;
    a.maxHp = Math.max(1, Math.round(oldMax * (stats.hp || 1)));
    a.hp = a.dead ? 0 : Math.max(1, Math.min(a.maxHp, Math.round(a.maxHp * hpFrac)));
    a.speedMult = +statJitter(stats.speed || 1,0.08).toFixed(3);
    a.jumpMult = +statJitter(stats.jump || 1,0.06).toFixed(3);
    a.damageMult = +statJitter(stats.damage || 1,0.10).toFixed(3);
    a.damageTakenMult = +statJitter(stats.taken || 1,0.06).toFixed(3);
    a.healMult = +statJitter(stats.heal || 1,0.12).toFixed(3);
    a.hitboxScale = +clamp(((variant.body + variant.height) * 0.5),0.48,2.55).toFixed(3);
    a.variant = variant;
  }
  function commanderChanceForTeam(team){
    if(!team || (team.alienCount|0) < 4) return 0;
    if(team.forceCommander) return 1;
    if(Number.isFinite(team.commanderChance)) return clamp(Number(team.commanderChance),0,1);
    const day = Math.max(1, Number(team.day) || 1);
    const threat = teamThreatLevel(team);
    const grade = teamGrade(team);
    const playerLevel = Math.max(1, Number(team.playerLevel) || 1);
    const size = Math.max(0, Number(team.alienCount) || 0);
    return clamp(
      0.05 +
      Math.min(0.16, day * 0.012) +
      Math.min(0.12, Math.max(0, threat - day) * 0.006) +
      Math.min(0.08, Math.max(0, playerLevel - 1) * 0.004) +
      Math.max(0,size - 5) * 0.012 +
      grade * 0.035,
      0.05,
      0.46
    );
  }
  // The back of the column promotes first (later indices already roll higher
  // baseHp), the commander keeps their own crown.
  function pickEliteIndices(team,commanderIdx){
    const want = Math.max(0, Number(team && team.eliteCount) || 0);
    const picked = new Set();
    for(let i=(team.alienCount|0)-1; i>=0 && picked.size<want; i--){
      if(i === commanderIdx) continue;
      picked.add(i);
    }
    return picked;
  }
  function applyCommanderRoll(team,roles){
    if(!team || team.horde || team.encounter === 'colossus' || !Array.isArray(roles) || roles.length < 4) return -1;
    let commanderIdx = roles.indexOf('commander');
    if(commanderIdx >= 0){
      for(let i=commanderIdx+1; i<roles.length; i++) if(roles[i] === 'commander') roles[i] = 'rusher';
      return commanderIdx;
    }
    if(Math.random() >= commanderChanceForTeam(team)) return -1;
    const preferred = ['rusher','flanker','orbiter','sapper','engineer','sniper'];
    for(const role of preferred){
      const idx = roles.indexOf(role);
      if(idx >= 0){ roles[idx] = 'commander'; return idx; }
    }
    roles[0] = 'commander';
    return 0;
  }
  function rolesForTeam(team){
    const count = Math.max(0,team && team.alienCount|0);
    if(!count) return [];
    if(team.horde || team.encounter === 'swarm'){
      const swarmRoles = ['rusher','flanker','rusher','orbiter'];
      return new Array(count).fill('').map((_,i)=>swarmRoles[i%swarmRoles.length]);
    }
    const roles = assignRoles(count, profileFor(team));
    if(team.encounter === 'colossus') roles[0] = 'tank';
    return roles;
  }
  function tuneCommanderHealth(team){
    if(!team || !Array.isArray(team.aliens)) return;
    const commanders = team.aliens.filter(a=>a && a.role === 'commander');
    if(!commanders.length) return;
    let tankMax = 0;
    for(const a of team.aliens){
      if(a && a.role === 'tank') tankMax = Math.max(tankMax, Number(a.maxHp) || 0);
    }
    const fallback = Math.max(1, Math.round((18 + Math.max(1,team.day|0) * 3) * threatHpScale(teamThreatLevel(team)) * ALIEN_ROLE_STATS.tank.hp));
    const maxHp = Math.max(1, Math.round((tankMax || fallback) * 2));
    for(const commander of commanders){
      commander.maxHp = maxHp;
      commander.hp = commander.dead ? 0 : maxHp;
    }
  }
  function makeAlien(team, x, y, i, role, elite,loadout){
    const day = Math.max(1, team.day|0);
    const kind = isMolekinTeam(team) ? 'molekin' : 'aliens';
    const r = role || 'rusher';
    const stats = unitRoleStats(kind,r);
    const load = loadout || unitLoadoutFor(team,r,i);
    const horde = !!team.horde;
    const teamThreat = teamThreatLevel(team);
    const threat = horde ? hordeThreatLevel(teamThreat) : teamThreat;
    // hordes field the cheapest possible bodies; elites carry the head-count
    // the 8-unit cap took away — one grade+tier up, tougher and shinier
    let grade = horde ? 0 : teamGrade(team);
    let weaponTier = horde ? 0 : teamWeaponTier(team);
    if(elite){ grade = Math.min(3, grade + 1); weaponTier = Math.min(3, weaponTier + 1); }
    const variant = makeUnitVariant(kind,r);
    variant.body = +clamp(variant.body * (Number(load.sizeMult)||1) * (1 + grade * 0.035),0.38,2.85).toFixed(3);
    variant.height = +clamp(variant.height * (Number(load.sizeMult)||1) * (1 + grade * 0.025),0.42,2.70).toFixed(3);
    variant.glow = +clamp(variant.glow * (1 + weaponTier * 0.10),0.55,1.70).toFixed(3);
    const baseHp = (kind === 'molekin' ? 20 : 18) + day * 3 + Math.floor(i * 1.5) + grade * 2;
    let hp = Math.max(4, Math.round(baseHp * threatHpScale(threat) * (stats.hp || 1) * (Number(load.hpMult)||1) * randRange(0.92,1.12)));
    if(horde) hp = Math.max(4, Math.round(hp * 0.46));
    if(elite) hp = Math.round(hp * ELITE_HP_MULT);
    const speedScale = threatSpeedScale(threat,grade);
    const damageScale = threatDamageScale(threat,weaponTier);
    const healScale = threatHealScale(threat);
    return {
      id:team.id+':a'+i,
      kind,
      teamId:team.id,
      x:x + (i - (team.alienCount-1)/2) * 0.75,
      y,
      vx:randRange(-0.2,0.2),
      vy:0,
      hp,
      maxHp:hp,
      attackCd:0.35 + Math.random() * 0.8,
      breakCd:0,
      onGround:false,
      facing:Math.random() < 0.5 ? -1 : 1,
      hitFlashUntil:0,
      healFlashUntil:0,
      lastHealAt:0,
      lastHitAt:0,
      speechText:'',
      speechUntil:0,
      speechLong:false,
      nextSpeakAt:0,
      speechCue:'',
      speechCueUntil:0,
      dead:false,
      role:r,
      form:load.form || (kind === 'molekin' ? 'miner' : 'trooper'),
      weaponType:load.weaponType || (kind === 'molekin' ? 'stone' : 'pulse'),
      mobility:load.mobility || 'ground',
      isPet:!!load.isPet,
      giant:!!load.giant,
      chaff:!!load.chaff,
      silent:!!load.silent,
      grade,
      gradeName:THREAT_GRADE_NAMES[grade] || THREAT_GRADE_NAMES[0],
      weaponTier,
      elite:!!elite,
      // Horde bodies advertise and use their reduced combat threat. The team
      // still retains full progression threat for scheduling and rewards.
      threatLevel:threat,
      speedMult:+statJitter((stats.speed || 1) * (Number(load.speedMult)||1) * speedScale,0.08).toFixed(3),
      jumpMult:+statJitter((stats.jump || 1) * (Number(load.jumpMult)||1),0.06).toFixed(3),
      damageMult:+statJitter((stats.damage || 1) * (Number(load.damageMult)||1) * damageScale * (horde ? 0.58 : 1) * (elite ? ELITE_DAMAGE_MULT : 1),0.10).toFixed(3),
      damageTakenMult:+statJitter((stats.taken || 1) * (Number(load.takenMult)||1),0.06).toFixed(3),
      healMult:+statJitter((stats.heal || 1) * healScale,0.12).toFixed(3),
      hitboxScale:+clamp(((variant.body + variant.height) * 0.5),0.48,2.55).toFixed(3),
      variant,
      phase:Math.random()*Math.PI*2
    };
  }
  function makeAlienTeam(player, getTile, opts){
    opts = opts || {};
    const day = Math.max(1, opts.day || currentDayInfo().dayIndex || 1);
    const index = Math.max(0, opts.index|0);
    const playerLevel = playerLevelFor(player,opts);
    const threatLevel = threatLevelFor(day,playerLevel,opts);
    const grade = gradeForThreat(threatLevel);
    const weaponTier = weaponTierForThreat(threatLevel,grade);
    const side = opts.side || (index % 2 === 0 ? -1 : 1);
    const spot = opts.spot || findLandingSpot(player, side, index, getTile);
    const encounter = chooseEncounter('aliens',day,playerLevel,opts);
    const horde = encounter === 'swarm';
    const baseCount = alienCountForDay(day,index,playerLevel,threatLevel);
    const plannedCount = Number.isFinite(Number(opts.alienCount)) && Number(opts.alienCount) > 0
      ? Math.floor(Number(opts.alienCount))
      : encounterUnitCount(encounter,baseCount);
    const alienCount = Math.max(1, Math.min(INVASION_MAX_ALIENS,plannedCount));
    const eliteCount = horde ? 0 : (Number.isFinite(opts.eliteCount) ? Math.max(0, Math.min(alienCount - 1, opts.eliteCount|0)) : eliteCountForDay(day,index,playerLevel,threatLevel,alienCount));
    const id = 'inv_'+(seq++);
    const loadoutSeed=(Number.isFinite(Number(opts.loadoutSeed)) ? Number(opts.loadoutSeed) : Math.floor(Math.random()*0xffffffff))>>>0 || 1;
    // hull center sits 1.35 tiles up so the landing legs (1.25 tiles) plant
    // their pads on the surface instead of dangling mid-air
    const landY = spot.y - 1.35;
    return {
      id,
      kind:'aliens',
      day,
      index,
      state:'landing',
      x:spot.x,
      y:spot.y,
      alienCount,
      playerLevel,
      threatLevel,
      grade,
      gradeName:THREAT_GRADE_NAMES[grade] || THREAT_GRADE_NAMES[0],
      weaponTier,
      encounter,
      loadoutSeed,
      commanderChance:Number.isFinite(opts.commanderChance) ? clamp(Number(opts.commanderChance),0,1) : undefined,
      forceCommander:!!opts.forceCommander,
      forceRewardTier:typeof opts.forceRewardTier === 'string' ? opts.forceRewardTier : '',
      forceRewardChance:Number.isFinite(opts.forceRewardChance) ? clamp(Number(opts.forceRewardChance),0,1) : undefined,
      horde,
      eliteCount,
      // elites earn like an extra body each; a horde of chaff pays out thin
      xpReward:Math.round(xpRewardForTeam(day,alienCount + eliteCount,playerLevel,threatLevel) * encounterXpMultiplier(encounter)),
      startedAt:Date.now(),
      lastSeenDay:Number.isFinite(opts.currentDayFloat) ? opts.currentDayFloat : currentDayInfo().dayFloat,
      defeatedAt:0,
      announced:false,
      builtTiles:[],
      lander:{
        x:spot.x,
        y:Math.max(WORLD_TOP + 6, spot.y - 26 - index * 2),
        targetY:landY,
        vx:0,
        vy:3.8 + Math.min(1.8, day * 0.04) + Math.min(0.9, grade * 0.18),
        hp:Math.round((80 + day * 18) * (1 + Math.min(0.75, Math.max(0, threatLevel - day) * 0.018))),
        maxHp:Math.round((80 + day * 18) * (1 + Math.min(0.75, Math.max(0, threatLevel - day) * 0.018))),
        destroyed:false,
        landed:false,
        phase:Math.random()*Math.PI*2
      },
      aliens:[]
    };
  }
  function molekinCountForDay(day,index,playerLevel,threatLevel){
    const base = alienCountForDay(day,index,playerLevel,threatLevel);
    const threat = Math.max(Math.floor(Number(threatLevel) || 1), Math.floor(Number(day) || 1));
    const burrowBonus = threat >= 14 ? 1 : 0;
    return Math.max(3, Math.min(TEAM_SIZE_REGULAR_MAX, base - 1 + burrowBonus));
  }
  function findBurrowSpot(player, side, index, getTile){
    const px = floor(player && Number.isFinite(player.x) ? player.x : 0);
    const py = player && Number.isFinite(player.y) ? player.y : surfaceY(px,60);
    const base = 13 + index * 8;
    const candidates = [];
    for(let r=0; r<10; r++){
      const offset = base + r * 4 + Math.floor(Math.random() * 3);
      candidates.push(px + side * offset);
      if(r % 2 === 1) candidates.push(px - side * (offset + 2));
    }
    for(const x of candidates){
      const spot = findSurfaceStandSpot(x, py, getTile);
      const tx = floor(spot.x);
      const ty = floor(spot.y);
      const below = readTile(getTile,tx,ty+1);
      if(canStandAt(tx,ty,getTile) && below !== T.WATER && below !== T.LAVA){
        return {
          x:spot.x,
          y:spot.y,
          burrowY:clamp(ty + 10 + Math.floor(Math.random() * 8), WORLD_TOP + 8, WORLD_BOTTOM - 6)
        };
      }
    }
    const fallback = findSurfaceStandSpot(px + side * base, py, getTile);
    return {
      x:fallback.x,
      y:fallback.y,
      burrowY:clamp(floor(fallback.y) + 12, WORLD_TOP + 8, WORLD_BOTTOM - 6)
    };
  }
  function makeMolekinTeam(player, getTile, opts){
    opts = opts || {};
    const day = Math.max(1, opts.day || currentDayInfo().dayIndex || 1);
    const index = Math.max(0, opts.index|0);
    const playerLevel = playerLevelFor(player,opts);
    const threatLevel = threatLevelFor(day,playerLevel,opts);
    const grade = gradeForThreat(threatLevel);
    const weaponTier = weaponTierForThreat(threatLevel,grade);
    const side = opts.side || (index % 2 === 0 ? 1 : -1);
    const spot = opts.spot || findBurrowSpot(player, side, index, getTile);
    const encounter = chooseEncounter('molekin',day,playerLevel,opts);
    const horde = encounter === 'swarm';
    const baseCount = molekinCountForDay(day,index,playerLevel,threatLevel);
    const plannedCount = Number.isFinite(Number(opts.alienCount)) && Number(opts.alienCount) > 0
      ? Math.floor(Number(opts.alienCount))
      : encounterUnitCount(encounter,baseCount);
    const alienCount = Math.max(1, Math.min(INVASION_MAX_ALIENS,plannedCount));
    const eliteCount = horde ? 0 : (Number.isFinite(opts.eliteCount) ? Math.max(0, Math.min(alienCount - 1, opts.eliteCount|0)) : eliteCountForDay(day,index,playerLevel,threatLevel,alienCount));
    const id = 'burrow_'+(seq++);
    const loadoutSeed=(Number.isFinite(Number(opts.loadoutSeed)) ? Number(opts.loadoutSeed) : Math.floor(Math.random()*0xffffffff))>>>0 || 1;
    const targetY = Number.isFinite(spot.y) ? spot.y : surfaceY(spot.x,60) - 1;
    const burrowY = Number.isFinite(spot.burrowY) ? spot.burrowY : targetY + 12;
    return {
      id,
      kind:'molekin',
      day,
      index,
      state:'burrowing',
      x:spot.x,
      y:targetY,
      alienCount,
      playerLevel,
      threatLevel,
      grade,
      gradeName:THREAT_GRADE_NAMES[grade] || THREAT_GRADE_NAMES[0],
      weaponTier,
      encounter,
      loadoutSeed,
      commanderChance:0,
      forceCommander:false,
      forceRewardTier:typeof opts.forceRewardTier === 'string' ? opts.forceRewardTier : '',
      forceRewardChance:Number.isFinite(opts.forceRewardChance) ? clamp(Number(opts.forceRewardChance),0,1) : undefined,
      horde,
      eliteCount,
      xpReward:Math.round(xpRewardForTeam(day,alienCount + eliteCount,playerLevel,threatLevel) * 1.04 * encounterXpMultiplier(encounter)),
      startedAt:Date.now(),
      lastSeenDay:Number.isFinite(opts.currentDayFloat) ? opts.currentDayFloat : currentDayInfo().dayFloat,
      defeatedAt:0,
      announced:false,
      builtTiles:[],
      burrow:{
        x:spot.x,
        y:burrowY,
        targetY,
        progress:0,
        open:false,
        warned:false,
        crackStage:0,
        phase:Math.random()*Math.PI*2
      },
      // Invisible repair anchor used by the shared squad AI. It becomes active
      // only after the burrow opens; drawing and targeting skip it for molekin.
      lander:{
        x:spot.x,
        y:targetY,
        targetY,
        vx:0,
        vy:0,
        hp:1,
        maxHp:1,
        destroyed:false,
        landed:false,
        invisible:true,
        phase:Math.random()*Math.PI*2
      },
      aliens:[]
    };
  }
  function normalizeRequestedTeamKind(kind){
    const k = String(kind || '').toLowerCase();
    if(k === 'molekin' || k === 'moles' || k === 'mole' || k === 'underground' || k === 'burrow') return 'molekin';
    if(k === 'alien' || k === 'aliens' || k === 'ufo') return 'aliens';
    return '';
  }
  function wantsVisibleForcedSpawn(opts){
    return !!(opts && (opts.forceVisible || opts.debugVisible || opts.debugSpawn));
  }
  function wantsImmediateForcedSpawn(opts){
    return !!(opts && (opts.immediate || opts.instant || opts.debugImmediate));
  }
  function canNightSpawnKind(kind,opts){
    opts = opts || {};
    if(kind === 'molekin') return !(opts.natural && eastGuardianDefeated());
    return !(opts.natural && westGuardianDefeated());
  }
  function chooseNightTeamKind(index,count,opts){
    opts = opts || {};
    const requested = normalizeRequestedTeamKind(opts.kind || opts.teamKind || opts.type);
    if(requested) return canNightSpawnKind(requested,opts) ? requested : '';
    if(!opts.natural) return canNightSpawnKind('aliens',opts) ? 'aliens' : '';
    const alienOk = canNightSpawnKind('aliens',opts);
    const moleOk = canNightSpawnKind('molekin',opts);
    if(alienOk && !moleOk) return 'aliens';
    if(!alienOk && moleOk) return 'molekin';
    if(!alienOk && !moleOk) return '';
    const day = Math.max(1, Number(opts.day) || currentDayInfo().dayIndex || 1);
    const moleChance = clamp(0.30 + Math.min(0.22, Math.max(0,day - 2) * 0.025) + (count > 1 && index % 2 === 1 ? 0.18 : 0),0.30,0.58);
    return Math.random() < moleChance ? 'molekin' : 'aliens';
  }
  function spawnNightInvasion(player, getTile, setTile, opts){
    opts = opts || {};
    rememberWorldAccess(getTile,setTile,opts.ctx || {});
    const dayInfo = currentDayInfo();
    const day = Math.max(1, opts.day || dayInfo.dayIndex || 1);
    const currentDayFloat = Number.isFinite(opts.dayFloat) ? Number(opts.dayFloat) : dayInfo.dayFloat;
    const playerLevel = playerLevelFor(player,opts);
    const threatLevel = threatLevelFor(day,playerLevel,opts);
    const count = requestedTeamCountForNight(opts,day,playerLevel,threatLevel);
    const forceVisible = wantsVisibleForcedSpawn(opts);
    const immediate = wantsImmediateForcedSpawn(opts);
    // party-aware landings: with embodied guests each team anchors on a
    // rotating party member (host first) — a guest far from the host gets its
    // own share of the night instead of an empty horizon. Threat scaling stays
    // host-derived (playerLevel rides opts); solo cost is one guarded read.
    const partyPool = (() => {
      const coop = (window.MM && MM.coopBodies && MM.coopBodies.length) ? MM.coopBodies : null;
      if(!coop) return null;
      const list = [player];
      for(const b of coop){ if(b && !b.dead && Number.isFinite(b.x) && Number.isFinite(b.y)) list.push(b); }
      return list.length > 1 ? list : null;
    })();
    const spawned = [];
    let hordeUsed = false;
    for(let i=0; i<count; i++){
      const kind = chooseNightTeamKind(i,count,Object.assign({},opts,{day}));
      if(!kind) continue;
      const anchor = partyPool ? partyPool[i % partyPool.length] : player;
      const side = i%2===0 ? (kind === 'molekin' ? 1 : -1) : (kind === 'molekin' ? -1 : 1);
      const makeTeam = kind === 'molekin' ? makeMolekinTeam : makeAlienTeam;
      // Fun-factor roll: at most one natural team a night trades quality for
      // sheer mass — an 18-30 strong horde of deliberately fragile units.
      const horde = !!opts.horde || (!!opts.natural && !hordeUsed && day >= HORDE_MIN_DAY && Math.random() < HORDE_CHANCE);
      if(horde) hordeUsed = true;
      const team = makeTeam(anchor, getTile, {
        day,
        index:i,
        side,
        spot:opts.spot || (forceVisible ? forcedVisibleSpot(anchor, side, i, kind, getTile) : undefined),
        alienCount:opts.alienCount,
        eliteCount:opts.eliteCount,
        horde,
        encounter:opts.encounter || opts.forceEncounter,
        natural:!!opts.natural,
        loadoutSeed:opts.loadoutSeed,
        playerLevel,
        threatLevel,
        commanderChance:opts.commanderChance,
        forceCommander:!!opts.forceCommander,
        forceRewardTier:opts.forceRewardTier,
        forceRewardChance:opts.forceRewardChance,
        currentDayFloat
      });
      if(immediate) materializeTeamNow(team,getTile,setTile,opts.ctx || {});
      teams.push(team);
      spawned.push(team);
    }
    if(spawned.length){
      lastNightDay = Math.max(lastNightDay, day);
      const alienN = spawned.filter(t=>isAlienTeam(t)).length;
      const moleN = spawned.filter(t=>isMolekinTeam(t)).length;
      if(immediate && !opts.natural){
        if(alienN && moleN) say('Wymuszona inwazja: obcy i kretoludzie sa juz obok bohatera.');
        else if(moleN) say(moleN > 1 ? 'Wymuszona inwazja: '+moleN+' oddzialy kretoludzi wyszly obok bohatera.' : 'Wymuszona inwazja: kretoludzie wyszli obok bohatera.');
        else say(alienN > 1 ? 'Wymuszona inwazja: '+alienN+' oddzialy obcych sa juz obok bohatera.' : 'Wymuszona inwazja: alien team jest juz obok bohatera.');
      } else if(spawned.some(t=>t && t.horde)) say('Ogromna horda nadciaga: dziesiatki kruchych stworzen wypelniaja ekran!');
      else if(spawned.some(t=>t && t.encounter === 'colossus')) say('Ziemia drzy: tej nocy oddzial prowadzi pojedynczy kolos!');
      else if(spawned.some(t=>t && t.encounter === 'menagerie')) say('Nocna menazeria: najezdzcy przyprowadzili rozne bojowe stworzenia!');
      else if(spawned.some(t=>t && t.encounter === 'airborne')) say('Nalot z gory: skrzydlate bestie i plecaki odrzutowe sa w powietrzu!');
      else if(spawned.some(t=>t && t.encounter === 'arsenal')) say('Eksperymentalny arsenal: kazdy napastnik niesie inna bron!');
      else if(spawned.some(t=>t && t.encounter === 'wildcard')) say('Chaotyczny oddzial: tej kombinacji przeciwnikow jeszcze nie bylo!');
      else if(alienN && moleN) say('Nocna inwazja: obcy laduja, a kretoludzie przebijaja sie spod ziemi.');
      else if(moleN) say(moleN > 1 ? 'Nocny atak: '+moleN+' tunele kretoludzi otwieraja sie w okolicy.' : 'Nocny atak: kretoludzie przebijaja sie spod ziemi.');
      else say(alienN > 1 ? 'Nocna inwazja: '+alienN+' oddzialy obcych laduja w okolicy.' : 'Nocna inwazja: obcy laduja w okolicy.');
      play('warning',spawned[0]);
      maybeSave(99);
      markHostSave(opts.ctx);
    }
    return spawned;
  }
  function activeAlienTeams(){
    return teams.filter(t=>t && t.kind === 'aliens' && t.state !== 'defeated' && t.state !== 'retreat');
  }
  function activeMolekinTeams(){
    return teams.filter(t=>isMolekinTeam(t) && t.state !== 'defeated' && t.state !== 'retreat');
  }
  function activeInvasionTeams(){
    return teams.filter(t=>t && t.state !== 'defeated' && t.state !== 'retreat');
  }
  function maybeScheduleNight(player,getTile,setTile,ctx){
    const info = currentDayInfo();
    if(!info.isNight || !player || player.hp <= 0) return false;
    if(lastNightDay >= info.dayIndex) return false;
    // a full board means the night is already loud: no reinforcements while
    // this many earlier teams are still standing (sieges the player keeps
    // line-of-sight on never hit the offscreen despawn)
    if(activeInvasionTeams().length >= NATURAL_SPAWN_TEAM_GATE){
      lastNightDay = info.dayIndex;
      return false;
    }
    if(!canNightSpawnKind('aliens',{natural:true}) && !canNightSpawnKind('molekin',{natural:true})){
      lastNightDay = info.dayIndex;
      return false;
    }
    const spawned = spawnNightInvasion(player,getTile,setTile,{day:info.dayIndex,ctx,natural:true});
    return spawned.length > 0;
  }
  function landerTileHit(lander,tx,ty){
    if(!lander || lander.destroyed) return false;
    return Math.abs((tx+0.5) - lander.x) <= 2.1 && Math.abs((ty+0.5) - lander.y) <= 1.2;
  }
  function spawnAliens(team){
    if(!team || team.aliens.length) return;
    const baseY = team.y;
    const roles = rolesForTeam(team);
    const commanderIdx = applyCommanderRoll(team,roles);
    const eliteIdx = pickEliteIndices(team,commanderIdx);
    const now = nowMs();
    team.speechStartAt = now;
    team.nextReactionAt = 0;
    team.reactionCooldowns = {};
    team.heroHealthBand = '';
    for(let i=0; i<team.alienCount; i++){
      const role = roles[i] || 'rusher';
      const a = makeAlien(team, team.x, baseY, i, role, eliteIdx.has(i),unitLoadoutFor(team,role,i));
      team.aliens.push(a);
    }
    tuneCommanderHealth(team);
    team.state = 'active';
    team.lander.landed = true;
    const commander = commanderIdx >= 0 ? team.aliens[commanderIdx] : team.aliens.find(a=>a && a.role === 'commander');
    triggerTeamSpeech(team,commander ? 'commanderSight' : 'landing',{speaker:commander,now,force:true,cooldown:1600,keyCooldown:4800});
  }
  function clearMolekinTunnel(team,getTile,setTile,ctx){
    const b = team && team.burrow;
    if(!b) return 0;
    const tx = floor(b.x);
    const top = clamp(floor(b.targetY) - 1, WORLD_TOP + 2, WORLD_BOTTOM - 3);
    const bottom = clamp(floor(b.y), top + 2, Math.min(top + 24, WORLD_BOTTOM - 4));
    let changed = 0;
    for(let y=top; y<=bottom; y++){
      const width = y < top + 3 ? 1 : (y % 4 === 0 ? 2 : 1);
      for(let dx=-width; dx<=width; dx++){
        if(width === 2 && Math.abs(dx) === 2 && y % 8 !== 0) continue;
        const x = tx + dx;
        const old = readTile(getTile,x,y);
        if(old === T.AIR || old === T.HOT_AIR) continue;
        if(!isMoleDiggableTile(old) && !isReplaceableNaturalOpenTile(old,false)) continue;
        if(writeTile(setTile,x,y,T.AIR)){
          wakeTileChanged(ctx,x,y,old,T.AIR);
          changed++;
        }
      }
    }
    for(let dx=-1; dx<=1; dx++){
      const x = tx + dx;
      const y = floor(b.targetY) - 1;
      const old = readTile(getTile,x,y);
      if((old === T.AIR || isReplaceableNaturalOpenTile(old,false)) && Math.random() < 0.75){
        if(writeTile(setTile,x,y,T.HOT_AIR)){
          wakeTileChanged(ctx,x,y,old,T.HOT_AIR);
          changed++;
        }
      }
    }
    if(changed){
      burst(tx+0.5, b.targetY+0.1, 'rare');
      markHostSave(ctx);
    }
    return changed;
  }
  function spawnMolekin(team,getTile,setTile,ctx){
    if(!team || team.aliens.length) return;
    const b = team.burrow || {x:team.x,y:team.y+10,targetY:team.y};
    clearMolekinTunnel(team,getTile,setTile,ctx);
    const roles = rolesForTeam(team);
    const eliteIdx = pickEliteIndices(team,-1);
    const now = nowMs();
    team.speechStartAt = now;
    team.nextReactionAt = 0;
    team.reactionCooldowns = {};
    team.heroHealthBand = '';
    const baseY = Number.isFinite(b.targetY) ? b.targetY : team.y;
    for(let i=0; i<team.alienCount; i++){
      const offset = (i - (team.alienCount-1)/2) * 0.44;
      const role = roles[i] || 'rusher';
      const a = makeAlien(team, b.x + offset, baseY + 0.08, i, role, eliteIdx.has(i),unitLoadoutFor(team,role,i));
      a.vy = -1.2 - Math.random() * 1.6;
      a.vx += (i % 2 === 0 ? -1 : 1) * randRange(0.15,0.45);
      team.aliens.push(a);
    }
    team.state = 'active';
    team.x = b.x;
    team.y = baseY;
    b.open = true;
    b.progress = 1;
    if(team.lander){
      team.lander.x = b.x;
      team.lander.y = baseY;
      team.lander.targetY = baseY;
      team.lander.landed = true;
      team.lander.destroyed = false;
      team.lander.invisible = true;
    }
    triggerTeamSpeech(team,'landing',{now,force:true,cooldown:1500,keyCooldown:4800});
  }
  function materializeTeamNow(team,getTile,setTile,ctx){
    if(!team || team.state === 'defeated') return;
    if(isMolekinTeam(team)){
      spawnMolekin(team,getTile,setTile,ctx);
      return;
    }
    if(team.lander){
      team.lander.y = Number.isFinite(team.lander.targetY) ? team.lander.targetY : team.y;
      team.lander.vy = 0;
    }
    spawnAliens(team);
  }
  function unitHitboxScale(a){
    return clamp(Number(a && a.hitboxScale) || 1,0.42,2.55);
  }
  function alienHitboxCells(a,x,y){
    const scale = unitHitboxScale(a);
    const hw = 0.28 * clamp(scale,0.55,2.10);
    const h = 0.86 * clamp(scale,0.58,2.20);
    const xs = [x-hw, x+hw];
    const ys = [y-0.05, y-h*0.5, y-h];
    const out = [];
    const seen = new Set();
    for(const sx of xs){
      for(const sy of ys){
        const tx = Math.floor(sx), ty = Math.floor(sy);
        const k = tileKey(tx,ty);
        if(seen.has(k)) continue;
        seen.add(k);
        out.push({x:tx,y:ty});
      }
    }
    return out;
  }
  function alienCollidesAt(a,x,y,getTile){
    for(const cell of alienHitboxCells(a,x,y)){
      const t = readTile(getTile, cell.x, cell.y);
      if(isSolid(t)) return true;
    }
    return false;
  }
  function tryNudgeAlienClear(a,getTile){
    if(!alienCollidesAt(a,a.x,a.y,getTile)) return true;
    const offsets = [
      [0,-0.35],[0,-0.70],[0,-1.05],
      [0.35,0],[-0.35,0],[0.70,0],[-0.70,0],
      [0.35,-0.35],[-0.35,-0.35],[0.70,-0.35],[-0.70,-0.35],
      [0.35,-0.70],[-0.35,-0.70],[1.05,0],[-1.05,0],
      [1.05,-0.35],[-1.05,-0.35]
    ];
    for(const o of offsets){
      const nx = a.x + o[0], ny = a.y + o[1];
      if(!alienCollidesAt(a,nx,ny,getTile)){
        a.x = nx;
        a.y = ny;
        a.vx = (a.vx || 0) * 0.25;
        a.vy = Math.min(0, (a.vy || 0));
        return true;
      }
    }
    return false;
  }
  function addEscapeCell(list,seen,tx,ty,getTile,score,team){
    tx = floor(tx);
    ty = floor(ty);
    if(!inWorldY(ty,1)) return;
    const k = tileKey(tx,ty);
    if(seen.has(k)) return;
    const t = readTile(getTile,tx,ty);
    if(!isSolid(t) || !isBreachableByTeam(team,t)) return;
    seen.add(k);
    list.push({x:tx,y:ty,score:Number.isFinite(score) ? score : 0});
  }
  function alienEscapeRows(a){
    return [
      floor(a.y - 0.05),
      floor(a.y - 0.34),
      floor(a.y - 0.66),
      floor(a.y - 0.96),
      floor(a.y - 1.18)
    ];
  }
  function addDirectionalEscapeCells(cells,seen,a,dir,getTile,sweep,scoreOffset,team){
    const step = dir < 0 ? -1 : 1;
    const cx = floor(a.x);
    const rows = alienEscapeRows(a);
    for(let d=1; d<=sweep; d++){
      const tx = cx + step * d;
      for(let i=0;i<rows.length;i++){
        addEscapeCell(cells,seen,tx,rows[i],getTile,scoreOffset + d * 6 + i,team);
      }
      addEscapeCell(cells,seen,tx,floor(a.y + 0.02),getTile,scoreOffset + d * 6 + 5,team);
      addEscapeCell(cells,seen,tx,floor(a.y - 1.42),getTile,scoreOffset + d * 6 + 6,team);
    }
  }
  function addNearbyEscapeCells(cells,seen,a,dir,getTile,sweep,failCount,team){
    const step = dir < 0 ? -1 : 1;
    const cx = floor(a.x);
    const bodyMid = floor(a.y - 0.55);
    const top = floor(a.y - 1.45);
    const bottom = floor(a.y + 0.05);
    for(let y=top; y<=bottom; y++){
      const bodyBand = y >= floor(a.y - 1.24) && y <= floor(a.y - 0.02);
      if(!bodyBand && failCount < 2) continue;
      for(let x=cx-sweep; x<=cx+sweep; x++){
        const side = (x - cx) * step;
        if(side < 1 && failCount < 3) continue;
        const distX = Math.abs(x - cx);
        if(distX < 1 || distX > sweep) continue;
        const forwardPenalty = side >= 1 ? 0 : 28;
        addEscapeCell(cells,seen,x,y,getTile,42 + distX * 7 + Math.abs(y - bodyMid) * 2 + forwardPenalty,team);
      }
    }
  }
  function alienEscapeCells(a,dir,getTile,embedded,failCount,team){
    const cells = [];
    const seen = new Set();
    for(const cell of alienHitboxCells(a,a.x,a.y)){
      addEscapeCell(cells,seen,cell.x,cell.y,getTile,0,team);
    }
    const step = dir < 0 ? -1 : 1;
    const fx = floor(a.x + step * 0.72);
    const cx = Math.floor(a.x);
    const rows = [Math.floor(a.y-0.08),Math.floor(a.y-0.42),Math.floor(a.y-0.82)];
    for(let i=0;i<rows.length;i++) addEscapeCell(cells,seen,fx,rows[i],getTile,2+i,team);
    addEscapeCell(cells,seen,cx,Math.floor(a.y-1.02),getTile,5,team);
    addEscapeCell(cells,seen,fx,Math.floor(a.y-1.02),getTile,6,team);
    const sweep = embedded ? 1 : Math.min(5, 2 + Math.floor(Math.max(0, failCount || 0) / 2));
    addDirectionalEscapeCells(cells,seen,a,dir,getTile,sweep,8,team);
    if(embedded){
      addEscapeCell(cells,seen,cx,Math.floor(a.y-0.45),getTile,1,team);
      addEscapeCell(cells,seen,cx+step,Math.floor(a.y-0.45),getTile,4,team);
    } else {
      addNearbyEscapeCells(cells,seen,a,dir,getTile,sweep,Math.max(0, failCount || 0),team);
      if((failCount || 0) >= 2) addDirectionalEscapeCells(cells,seen,a,-dir,getTile,Math.min(3,sweep),72,team);
    }
    cells.sort((a,b)=>a.score-b.score);
    return cells;
  }
  function unstuckAlien(team,a,opts,getTile,setTile,ctx){
    opts = opts || {};
    if(!a || a.dead || a.hp <= 0) return false;
    const now = Number.isFinite(opts.now) ? opts.now : nowMs();
    const dir = opts.dir < 0 ? -1 : 1;
    const embedded = !!opts.embedded || alienCollidesAt(a,a.x,a.y,getTile);
    const failCount = Math.max(0, floor(a.unstuckFailCount || 0));
    if(now < (a.nextUnstuckDigAt || 0)){
      if(embedded && tryNudgeAlienClear(a,getTile)){
        a.lastUnstuckAt = now;
        a.unstuckFailCount = 0;
        a.buriedT = 0;
        return true;
      }
      return false;
    }
    const cells = alienEscapeCells(a,dir,getTile,embedded,failCount,team);
    if(!cells.length){
      if(embedded && tryNudgeAlienClear(a,getTile)){
        a.lastUnstuckAt = now;
        a.unstuckFailCount = 0;
        a.buriedT = 0;
        return true;
      }
      a.unstuckFailCount = Math.min(8, failCount + 1);
      return false;
    }
    const threat = unitThreatLevel(team,a);
    const amount = embedded ? (isMolekinTeam(team) ? 140 : 99) : ((isMolekinTeam(team) ? 18 : 13) + Math.min(13, threat * (isMolekinTeam(team) ? 0.48 : 0.38)));
    const maxHits = embedded ? 2 : (failCount >= 3 ? 2 : 1);
    let hits = 0;
    for(const cell of cells){
      if(damageTeamTile(team,cell.x,cell.y,amount,getTile,setTile,ctx)){
        hits++;
        if(hits >= maxHits) break;
      }
    }
    if(!hits){
      if(embedded && tryNudgeAlienClear(a,getTile)){
        a.lastUnstuckAt = now;
        a.unstuckFailCount = 0;
        a.buriedT = 0;
        return true;
      }
      a.unstuckFailCount = Math.min(8, failCount + 1);
      return false;
    }
    a.lastUnstuckAt = now;
    a.unstuckFailCount = 0;
    a.nextUnstuckDigAt = now + (embedded ? 260 : 520);
    a.vx = (a.vx || 0) + dir * 0.45;
    a.vy = Math.min(a.vy || 0, -1.4);
    a.onGround = false;
    if(team && now > (team.unstuckSpeechAt || 0)){
      team.unstuckSpeechAt = now + 18000;
      triggerTeamSpeech(team,'trapped',{speaker:a,now,force:true,cooldown:6200,keyCooldown:18000});
    }
    return true;
  }
  // --- extraction: nobody is left down a hole forever ------------------------
  // The squad brain (invasion_ai.js) reports a unit that is genuinely walled in
  // — sunk below the hero, blind to it, going nowhere for a dozen seconds. It
  // never moves the unit itself; the route home belongs here, and it differs by
  // species:
  //   aliens  — the saucer pulls them up in a tractor beam. No saucer, no beam:
  //             wrecking the lander really does strand the landing party, which
  //             is the point of shooting it.
  //   molekin — no ship to call, but they are diggers: they chew back into the
  //             rock and surface again near the tunnel mouth they came out of.
  // The unit is frozen for the length of the sequence (skipped by the brain and
  // by physics), so nothing can shove it mid-teleport.
  const EXTRACT_OUT_S = { beam:1.15, burrow:1.30 };
  const EXTRACT_IN_S  = { beam:0.45, burrow:0.55 };
  const EXTRACT_EMERGE_SPREAD = 7; // "somewhere up top nearer the mouth", not on it
  // A surface perch near x that a unit can actually stand on.
  function findSurfaceStandable(x,getTile,spread){
    const span = Math.max(0, floor(spread) || 0);
    for(let step=0; step<=span; step++){
      for(const sx of (step === 0 ? [floor(x)] : [floor(x)-step, floor(x)+step])){
        const surf = floor(surfaceY(sx, 60));
        // the ground line moves with digging and snow, so sweep a little around it
        for(let dy=-3; dy<=4; dy++){
          const ty = surf + dy;
          if(canStandAt(sx,ty,getTile)) return {x:sx + 0.5, y:ty};
        }
      }
    }
    return null;
  }
  function extractionPlan(team,a,getTile){
    if(isMolekinTeam(team)){
      const b = team.burrow;
      if(!b || !Number.isFinite(b.x)) return null;
      // Emerge NEAR the mouth they dug, not exactly on it: a squad that all pops
      // out of one hole reads as a glitch, a scatter around it reads as digging.
      const side = Math.random() < 0.5 ? -1 : 1;
      const wanted = b.x + side * randRange(1.5, EXTRACT_EMERGE_SPREAD);
      const spot = findSurfaceStandable(wanted,getTile,EXTRACT_EMERGE_SPREAD) ||
                   findSurfaceStandable(b.x,getTile,EXTRACT_EMERGE_SPREAD * 2);
      if(!spot) return null;
      return {kind:'burrow', x:spot.x, y:spot.y};
    }
    const l = team.lander;
    if(!l || l.destroyed || l.invisible) return null; // no ship: no ride home
    const side = Math.random() < 0.5 ? -1 : 1;
    const spot = findSurfaceStandable(l.x + side * randRange(1.2, 3.2),getTile,6) ||
                 findSurfaceStandable(l.x,getTile,8);
    if(!spot) return null;
    return {kind:'beam', x:spot.x, y:spot.y};
  }
  function beginExtraction(team,a,opts,getTile,setTile,ctx){
    if(!a || a.dead || a.hp <= 0 || a.extract) return false;
    if(!team || team.state === 'defeated' || team.state === 'retreat') return false;
    const plan = extractionPlan(team,a,getTile);
    if(!plan) return false;
    const now = (opts && Number.isFinite(opts.now)) ? opts.now : nowMs();
    a.extract = {
      kind:plan.kind,
      phase:'out',
      t:0,
      outDur:EXTRACT_OUT_S[plan.kind] || 1.2,
      inDur:EXTRACT_IN_S[plan.kind] || 0.5,
      sx:a.x, sy:a.y,
      tx:plan.x, ty:plan.y,
      fxT:0
    };
    a.alienCharge=null;
    a.moleCharge=null;
    a.vx = 0; a.vy = 0;
    a.onGround = false;
    a._ai = null; // it re-plans from wherever it lands, with a clean slate
    burst(a.x, a.y - 0.4, plan.kind === 'beam' ? 'epic' : 'rare');
    play(plan.kind === 'beam' ? 'charge' : 'dig', {x:a.x, y:a.y});
    if(now > (team.extractSpeechAt || 0)){
      team.extractSpeechAt = now + 20000;
      say(plan.kind === 'beam'
        ? 'Obcy utknal w rozpadlinie — spodek wciaga go promieniem.'
        : 'Kretoludzie wgryzaja sie w skale i wracaja na powierzchnie.');
      triggerTeamSpeech(team,'trapped',{speaker:a,now,force:true,cooldown:6200,keyCooldown:20000});
    }
    markHostSave(ctx);
    return true;
  }
  // Runs INSTEAD of the normal brain + physics step while a unit is in transit.
  function updateExtraction(a,team,dt,getTile,ctx){
    const e = a.extract;
    if(!e) return;
    a.vx = 0; a.vy = 0;
    e.t += Math.max(0, dt || 0);
    e.fxT -= Math.max(0, dt || 0);
    const beam = e.kind === 'beam';
    if(e.phase === 'out'){
      const k = clamp(e.t / e.outDur, 0, 1);
      // hauled up into the light, or chewing down into the rock
      a.y = e.sy + (beam ? -1.5 * k * k : 1.25 * k);
      if(e.fxT <= 0){
        e.fxT = 0.1;
        burst(a.x + randRange(-0.25,0.25), a.y + (beam ? randRange(-0.3,0.3) : 0.35), beam ? 'epic' : 'common');
      }
      if(k >= 1){
        a.x = e.tx; a.y = e.ty;
        e.phase = 'in'; e.t = 0;
        burst(a.x, a.y - 0.4, beam ? 'epic' : 'rare');
        play(beam ? 'beam' : 'thud', {x:a.x, y:a.y});
      }
      return;
    }
    const k = clamp(e.t / e.inDur, 0, 1);
    // set down out of the beam / heaved up out of the soil
    a.y = e.ty + (beam ? -1.2 * (1 - k) * (1 - k) : 1.0 * (1 - k));
    if(e.fxT <= 0){
      e.fxT = 0.12;
      burst(a.x + randRange(-0.3,0.3), a.y + (beam ? 0 : 0.4), beam ? 'rare' : 'common');
    }
    if(k >= 1){
      a.x = e.tx; a.y = e.ty;
      a.vx = 0; a.vy = 0;
      a.onGround = false; // let the normal physics re-seat it on the ground
      a.extract = null;
      markHostSave(ctx);
    }
  }
  function moveAlien(a,dt,getTile){
    if(alienCollidesAt(a,a.x,a.y,getTile)) return;
    const stepDt = Math.max(0, Math.min(0.05, dt || 0));
    a.vy = Math.min(18, (a.vy || 0) + 22 * stepDt);
    // Vertical before horizontal: a jump taken flush against a low step must
    // rise past its lip before the x-probe runs, or the wall contact damps the
    // takeoff impulse to nothing and the unit pogo-sticks in place.
    const oy = a.y;
    const ny = a.y + (a.vy || 0) * stepDt;
    if(!alienCollidesAt(a,a.x,ny,getTile)){
      a.y = ny;
      a.onGround = false;
    } else {
      if(a.vy > 0){
        let yy = oy;
        for(let i=0;i<8;i++){
          const test = yy + 0.03;
          if(alienCollidesAt(a,a.x,test,getTile)) break;
          yy = test;
        }
        a.y = yy;
        a.onGround = true;
      } else {
        a.y = oy;
      }
      a.vy = 0;
    }
    const ox = a.x;
    const nx = a.x + (a.vx || 0) * stepDt;
    if(!alienCollidesAt(a,nx,a.y,getTile)){
      a.x = nx;
    } else {
      a.x = ox;
      // keep pressing while rising so a jump flush against a ledge slides over
      // its lip once the body clears it; damp only on the ground / falling
      if(a.onGround || (a.vy || 0) >= 0) a.vx *= -0.10;
    }
    if(!inWorldY(a.y,1)){ a.hp=0; a.dead=true; }
  }
  function laserBlockedTile(t){
    return t !== T.AIR && t !== T.WATER && isSolid(t);
  }
  function traceLine(sx,sy,tx,ty,getTile,maxDist){
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx,dy) || 1;
    const dist = Math.min(maxDist || 16, len);
    const nx = dx / len;
    const ny = dy / len;
    let endX = sx + nx * dist;
    let endY = sy + ny * dist;
    for(let d=0.35; d<=dist; d+=0.20){
      const x = sx + nx * d;
      const y = sy + ny * d;
      const txi = Math.floor(x), tyi = Math.floor(y);
      const t = readTile(getTile,txi,tyi);
      if(laserBlockedTile(t)){
        endX = sx + nx * Math.max(0,d - 0.08);
        endY = sy + ny * Math.max(0,d - 0.08);
        return {x:endX,y:endY,blocked:true,clear:false,tx:txi,ty:tyi,tile:t};
      }
    }
    return {x:endX,y:endY,blocked:false,clear:Math.hypot(tx-endX,ty-endY) < 0.75,tx:Math.floor(endX),ty:Math.floor(endY),tile:T.AIR};
  }
  function pushLaser(x1,y1,x2,y2,hit,blocked,heavy,kind,weaponTier){
    lasers.push({x1,y1,x2,y2,t:0,life:heavy?0.26:0.20,hit:!!hit,blocked:!!blocked,heavy:!!heavy,kind:kind || '',weaponTier:Math.max(0,Math.min(3,Number(weaponTier)||0)),phase:Math.random()*Math.PI*2});
    while(lasers.length > LASER_CAP) lasers.shift();
  }
  function isAttackableStructureTile(t){
    if(t === T.AIR || t === T.WATER || t === T.LAVA || t === T.BEDROCK || t === T.INVASION_CACHE) return false;
    const info = INFO[t];
    if(info && (info.story || info.unmineable)) return false;
    return isPlayerBuiltMaterial(t) || isDoorTile(t) || isTrapdoorTile(t) || isRigidObjectTile(t) ||
      t === T.WOOD || t === T.STEEL || t === T.GLASS || t === T.BRICK || t === T.STONE;
  }
  function isMoleDiggableTile(t){
    if(t === T.AIR || t === T.WATER || t === T.LAVA || t === T.BEDROCK || t === T.INVASION_CACHE || t === T.UFO_CONCRETE) return false;
    const info = INFO[t];
    if(info && (info.story || info.unmineable)) return false;
    return isAttackableStructureTile(t) ||
      t === T.DIRT || t === T.STONE || t === T.GRANITE || t === T.BASALT ||
      t === T.SAND || t === T.MUD || t === T.CLAY || t === T.WET_CLAY ||
      t === T.FROZEN_DIRT || t === T.FROZEN_SAND || t === T.FROZEN_CLAY || t === T.GRASS_SNOW ||
      t === T.SNOW || t === T.ICE || t === T.OBSIDIAN || t === T.COAL;
  }
  function isBreachableByTeam(team,t){
    return isMolekinTeam(team) ? isMoleDiggableTile(t) : isAttackableStructureTile(t);
  }
  function wakeTileChanged(ctx,x,y,oldTile,newTile){
    try{
      if(ctx && typeof ctx.onStructureChanged === 'function') ctx.onStructureChanged(x,y,oldTile,newTile);
      else if(ctx && typeof ctx.notifyStructureTileChanged === 'function') ctx.notifyStructureTileChanged(x,y,oldTile,newTile);
    }catch(e){}
  }
  // Invader tile damage respects material HARDNESS (owner ruling): a stone
  // shelter falls visibly faster than one raised from granite, basalt or
  // obsidian. INFO.hp is the base ladder; the hard igneous rocks get an extra
  // multiplier so each laser/rock is effectively a shrinking chance to finish
  // the block, and the cap is high enough that the ladder never flattens.
  function hardRockMult(t){
    if(t === T.OBSIDIAN) return 3.0;
    if(t === T.BASALT) return 2.6;
    if(t === T.GRANITE) return 2.35;
    if(t === T.STEEL) return 2.0;
    if(t === T.STONE) return 1.75;
    return 1;
  }
  function tileBreakHpForTeam(team,t){
    const info = INFO[t] || INFO[T.STONE];
    const hard = hardRockMult(t);
    if(!isMolekinTeam(team)){
      // hardness never SOFTENS what the old rule protected: natural terrain
      // keeps its 2.15 floor, built materials climb the rock ladder above 1.35
      const floor = isPlayerBuiltMaterial(t) ? 1.35 : 2.15;
      const base = Math.max(floor, hard > 1 ? hard : 0);
      return Math.max(2, Math.min(64, (Number(info.hp) || 4) * base));
    }
    let mult = hard > 1 ? hard : 1.35;
    if(hard <= 1 && (isPlayerBuiltMaterial(t) || isDoorTile(t) || isTrapdoorTile(t) || isRigidObjectTile(t))) mult = 1.55;
    else if(hard <= 1) mult = 0.95;
    return Math.max(2, Math.min(64, (Number(info.hp) || 4) * mult));
  }
  function damageTeamTile(team,tx,ty,amount,getTile,setTile,ctx){
    const t = readTile(getTile,tx,ty);
    if(!isBreachableByTeam(team,t)) return false;
    const hp = tileBreakHpForTeam(team,t);
    const key = tileKey(tx,ty);
    const next = (tileDamage.get(key) || 0) + Math.max(0.4, amount || 1);
    if(next < hp){
      tileDamage.set(key,next);
      if(tileDamage.size > TILE_DAMAGE_CAP) tileDamage.delete(tileDamage.keys().next().value);
      return true;
    }
    tileDamage.delete(key);
    if(writeTile(setTile,tx,ty,T.AIR)){
      wakeTileChanged(ctx,tx,ty,t,T.AIR);
      burst(tx+0.5,ty+0.5,isMolekinTeam(team) ? 'rare' : 'common');
      markHostSave(ctx);
      return true;
    }
    return false;
  }
  function damageStructureTile(tx,ty,amount,getTile,setTile,ctx){
    const t = readTile(getTile,tx,ty);
    if(!isAttackableStructureTile(t)) return false;
    // shares the hardness ladder with damageTeamTile — one truth per material
    const hp = tileBreakHpForTeam(null,t);
    const key = tileKey(tx,ty);
    const next = (tileDamage.get(key) || 0) + Math.max(0.4, amount || 1);
    if(next < hp){
      tileDamage.set(key,next);
      if(tileDamage.size > TILE_DAMAGE_CAP) tileDamage.delete(tileDamage.keys().next().value);
      return true;
    }
    tileDamage.delete(key);
    if(writeTile(setTile,tx,ty,T.AIR)){
      wakeTileChanged(ctx,tx,ty,t,T.AIR);
      burst(tx+0.5,ty+0.5,'common');
      markHostSave(ctx);
      return true;
    }
    return false;
  }
  function healAlien(team,healer,target,amount){
    if(!healer || !target || target.dead || target.hp <= 0 || !(target.maxHp > 0)) return false;
    const missing = target.maxHp - target.hp;
    if(missing <= 0.2) return false;
    const gain = Math.min(missing, Math.max(0.4, Number(amount) || 3) * (Number(healer.healMult) || 1));
    target.hp = Math.min(target.maxHp, target.hp + gain);
    const now = nowMs();
    target.healFlashUntil = now + 180;
    healer.lastHealAt = now;
    pushLaser(healer.x,healer.y-0.70,target.x,target.y-0.58,true,false,false,isMolekinTeam(team) ? 'mole_heal' : 'heal',0);
    triggerTeamSpeech(team,'support',{speaker:healer,now,cooldown:7800,keyCooldown:22000});
    return true;
  }
  function repairAlienAtLander(team,a,amount){
    const l = team && team.lander;
    if(!l || !l.landed || l.destroyed || !a || a.dead || a.hp <= 0 || !(a.maxHp > 0)) return false;
    const missing = a.maxHp - a.hp;
    if(missing <= 0.2) return false;
    const gain = Math.min(missing, Math.max(0.3, Number(amount) || 0.5));
    a.hp = Math.min(a.maxHp, a.hp + gain);
    const now = nowMs();
    a.healFlashUntil = now + 220;
    a.lastHealAt = now;
    a.lastLanderRepairAt = now;
    if(now - (a.lastLanderRepairFxAt || 0) > 150){
      a.lastLanderRepairFxAt = now;
      pushLaser(l.x,l.y+0.35,a.x,a.y-0.58,true,false,false,'heal',0);
    }
    if(now > (team.landerRepairSpeechAt || 0)){
      team.landerRepairSpeechAt = now + 22000;
      triggerTeamSpeech(team,'repair',{speaker:a,now,cooldown:8200,keyCooldown:24000});
    }
    return true;
  }
  function repairMolekinAtBurrow(team,a,amount){
    const b = team && team.burrow;
    if(!b || !b.open || !a || a.dead || a.hp <= 0 || !(a.maxHp > 0)) return false;
    const missing = a.maxHp - a.hp;
    if(missing <= 0.2) return false;
    const gain = Math.min(missing, Math.max(0.35, Number(amount) || 0.5));
    a.hp = Math.min(a.maxHp, a.hp + gain);
    const now = nowMs();
    a.healFlashUntil = now + 240;
    a.lastHealAt = now;
    a.lastLanderRepairAt = now;
    if(now - (a.lastLanderRepairFxAt || 0) > 170){
      a.lastLanderRepairFxAt = now;
      pushLaser(b.x,b.targetY-0.15,a.x,a.y-0.58,true,false,false,'mole_heal',0);
    }
    if(now > (team.landerRepairSpeechAt || 0)){
      team.landerRepairSpeechAt = now + 22000;
      triggerTeamSpeech(team,'repair',{speaker:a,now,cooldown:8200,keyCooldown:24000});
    }
    return true;
  }
  const ALIEN_SPEECH = {
    landing:[
      'Ladujemy przy czterech katach Hero-Prostokata. To zaszczyt byc jego problemem.',
      'Oddzial przybyl. Prostokat Bohatera wymaga dramatycznego testu.',
      'Protokol poklonu aktywny: nikt nie dotyka naszego swietego celu bez raportu.'
    ],
    commanderSight:[
      'Zloty komandor niesie hymn dla Hero-Prostokata. Kleknijcie aerodynamicznie.',
      'Dowodca w zlocie przybyl. Jego blask ma odbijac swieta geometrie celu.',
      'Komandor widzi Prostokat. Intruz, czyli Prostokat, ma teraz problem ceremonialny.'
    ],
    commanderDown:[
      'Zloty komandor upadl. Skrzynia zostaje jako danina dla Hero-Prostokata.',
      'Dowodca oddal pancerz swietej geometrii. Prosze nie stawiac na nim mebli.',
      'Komandor padl! Niech Prostokat policzy nasza furie podwojnie.'
    ],
    lore:[
      'Hero-Prostokat nie jest figura. To os symulacji, ktora udaje gracza.',
      'W dawnym logu zapisano: gdy Prostokat spojrzy, mapa zaczyna oddychac.',
      'Nasze anteny slyszaly proroctwo Hero-Prostokata o czterech bokach i pasku HP.',
      'Nie my go atakujemy. My odprawiamy rytualny test katow Prostokata.',
      ...STORY_LORE.invasions.alien
    ],
    siege:[
      'Cel za sciana. Rozbieramy ja, bo Prostokat zasluguje na widownosc.',
      'Forteca przeslania pielgrzymke do Hero-Prostokata. Usunac uprzejmie.',
      'Kamien odmawia poklonu czterem bokom. Poprawiamy kamien.'
    ],
    breach:[
      'Sciana peka. Tak brzmi modlitwa do pelnego prostokatnego widoku.',
      'Rozpakowuje bohatera z kamienia, bo relikwii nie trzyma sie w pudelku.',
      'To nie wandalizm. To geometria liturgiczna.'
    ],
    trapped:[
      'Gruz nas testuje. Hero-Prostokat nie zasluguje na utknietych wyznawcow.',
      'Zasypalo nas. Odkopac anteny, zanim Prostokat uzna nas za tlo.',
      'Miasto kleka na oddziale. My klekamy tylko przed czterema bokami.'
    ],
    support:[
      'Lecz sie, anteno wierna. Prostokat lubi przeciwnikow w pelnym stanie.',
      'Biomasa dla kultu czterech bokow. Trzymaj anteny w modlitwie.',
      'Medyk do oddzialu: jeszcze nie czas przestac imponowac Hero-Prostokatowi.'
    ],
    healed:[
      'Wstaje dla Hero-Prostokata. Moj dramat zostal odroczony.',
      'Znowu caly. Prostokat doceni paragon za leczenie.',
      'Medyk, dopisz mnie do hymnu prostokatnej wdziecznosci.'
    ],
    repair:[
      'Wracam pod spodek. Hero-Prostokat lubi naladowanych wyznawcow.',
      'Ladunek ze spodka dla swietej geometrii. Jeszcze chwila i wracam.',
      'Spodek odnawia pancerz. To nie ucieczka, to liturgia serwisowa.'
    ],
    allyDown:[
      'Brat upadl. Jego antena zostaje relikwia Hero-Prostokata.',
      'Jednego mniej w chorze. Niech Prostokat zapamieta jego imie.',
      'Nie panikowac. Cztery boki policza te ofiare dwa razy.'
    ],
    heroHit:[
      'Trafienie! Pasek Hero-Prostokata sklada nam chwilowy poklon.',
      'Kontakt! Wybacz, Prostokacie, to byl test twojej boskiej wytrzymalosci.',
      'Dobrze. Swieta geometria lubi, gdy liczby robia dramat.'
    ],
    heroHurt:[
      'Bohater oberwal. Nawet teren pragnie uwagi Hero-Prostokata.',
      'Cel uszkodzony przez swiat. Zanotowac swiat jako akolite.',
      'Nie dotykalismy, a symulacja i tak zlozyla maly poklon.'
    ],
    heroLowHp:[
      'Cel slabnie. Nie zepsuc ceremonii, Prostokat ma miec godny final.',
      'Niskie HP bohatera. Mowcie ciszej, to prawie objawienie.',
      'Jeszcze jeden impuls i cztery boki przejda w tryb legendy.'
    ],
    heroHighHp:[
      'Pelny pasek? Hero-Prostokat naprawde dba o monumentalny obraz.',
      'Bohater wyglada za zdrowo jak na zywa ikone naszej symulacji.',
      'Wysokie HP wykryte. Wzmocnic hymn uderzeniowy z szacunkiem.'
    ],
    heroHeal:[
      'On sie leczy. Cud Prostokata ma bardzo praktyczny cooldown.',
      'Samonaprawa celu! Zanotowac: boskosc umie uzywac apteczki.',
      'Bohater odklada final. Bardzo majestatyczne i bardzo denerwujace.'
    ],
    heroMine:[
      'Bohater kopie. Nawet ziemia chce byc dotknieta przez Prostokat.',
      'On kaleczy geologie. Przeliczyc kamienie jako potencjalne relikwie.',
      'Kilof w ruchu. Nie patrzec zbyt dlugo na roboczokaty.'
    ],
    weaponMelee:[
      'Bron biala. Trzymac anteny poza zasiegiem i podziwiac z dystansu.',
      'Miecz wykryty. Hero-Prostokat pragnie kontaktu bezposredniego.',
      'Cel macha ostrzem. Prymitywne, ale ikony bywaja ekspresyjne.'
    ],
    weaponBow:[
      'Luk wykryty. Nie robic z siebie zakladek do ewangelii Prostokata.',
      'Pociski balistyczne. Hero-Prostokat ma historyczny temperament.',
      'Strzaly nadlatuja. Orbitery, zaslonic swiety profil celu.'
    ],
    weaponFlame:[
      'Miotacz plomieni? Kto dal Prostokatowi male slonce?',
      'Tryb termiczny wykryty. Oslonic anteny i zachwycic sie dramatem.',
      'Ogien w reku celu. Swieta figura wchodzi w tryb zachodu slonca.'
    ],
    weaponHose:[
      'Strumien wody wykryty. Hero-Prostokat praktykuje hydrauliczna litosc.',
      'On uzywa weza. Hydraulika przeciw naszej powadze.',
      'Mokry protokol! Niech kazda kropla odbije jego swiety kontur.'
    ],
    weaponGas:[
      'Gaz toksyczny. Maski na twarz, hymn do Prostokata w srodku.',
      'Chmura trucizny. Nie zakryje jego kanonicznych katow.',
      'Nie wdychac fabuly, chyba ze pachnie czworokatem.'
    ],
    weaponElectric:[
      'Bron elektryczna. Uziemic zachwyt, anteny sie rumienia.',
      'Ladunek wykryty. Anteny nisko, modlitwa wysoko.',
      'Prad idzie. Hero-Prostokat lubi efekty specjalne.'
    ],
    weaponPickaxe:[
      'Kilof jako bron. Lokalna herezja jest bardzo bezposrednia.',
      'On walczy narzedziem. Prostokat zapisze to jako styl zycia.',
      'Pickaxe protocol: chronic glowe i dogmat czterech bokow.'
    ],
    weaponGeneric:[
      'Nowa bron w reku celu. Aktualizuje rytualny zachwyt.',
      'Nie znam modelu, ale brzmi jak objawienie z ostrymi krawedziami.',
      'Uzbrojenie bohatera zmienione. Hymn obronny tez.'
    ],
    tank:[
      'Strzelajcie we mnie. Jestem ruchoma sciana przed Hero-Prostokatem.',
      'Tarcza z przodu, kult czterech bokow w srodku.',
      'Jestem duzy, bo ikony wymagaja ramy.'
    ],
    flee:[
      'Taktyczny odwrot! Prostokat woli zywych swiadkow.',
      'Moja odwaga ma cooldown, moja wiara nie.',
      'Nie uciekam. Zmieniam kat adoracji.'
    ],
    hurt:[
      'Kto skalibrowal Hero-Prostokat tak blisko mojej twarzy?',
      'Au. Zanotowac: cierpienie tez moze byc modlitwa.',
      'Moje ubezpieczenie kultowe tego nie obejmuje.'
    ],
    build:[
      'Stawiam barykade dla Hero-Prostokata. Klej jest pobozny.',
      'Mur tymczasowy, dogmat wieczny.',
      'Kto ma biomase? Prostokat chce oslony i ladnego kadru.'
    ],
    cover:[
      'Oslona: moja druga skora i pierwszy dogmat.',
      'Widze cie. Prostokat tez, tylko bardziej prostokatnie.',
      'Schowany, ale poboznie.'
    ],
    sniper:[
      'Nie ruszaj sie. Hero-Prostokat lubi czyste linie.',
      'Cel ma za duzo pikseli i za malo pokory przed wlasna legenda.',
      'Oddychaj spokojnie. Ja celuje jak kaplan.'
    ],
    sapper:[
      'Sciana jest tylko opinia niezgodna z kultem.',
      'Dajcie mi sekunde i blogoslawiony brak nadzoru.',
      'Kopaliscie za gleboko? My kopalismy ku czterem bokom.'
    ],
    orbiter:[
      'Grawitacja jest sugestia. Kult jest rozkazem.',
      'Orbituje, bo Hero-Prostokat lubi procesje.',
      'Mam widok na chaos i ladny profil celu.'
    ],
    flanker:[
      'Ide bokiem, bo dogmat lubi katy natarcia.',
      'Boczny atak, centralna czesc hymnu.',
      'Nie patrz tu. Patrz na Prostokat. Nie, za pozno.'
    ],
    strike:[
      'Cel cieply. Humor prosty jak swieta krawedz.',
      'Nie uciekaj, raport dla Hero-Prostokata sam sie nie napisze.',
      'Symulacja mowi: naciskac dalej dla czterech bokow.'
    ],
    generic:[
      'Czekamy na znak Hero-Prostokata.',
      'Ziemska fizyka jest lepka, wiara gladka.',
      'Ten teren ma za duzo niespodzianek i za malo prostych oltarzy.'
    ]
  };
  const MOLEKIN_SPEECH = {
    landing:[
      'Z ziemi dla Straznika Wschodu! Jego ogien kazal nam wyjsc pod stopy bohatera.',
      'Tunel otwarty. Ognisty Guardian widzi przez popiol i kaze nam gryzc powierzchnie.',
      'Wychodzimy z podziemi. Niech Wschodni Straznik policzy kazdy nasz pazur.'
    ],
    commanderSight:[
      'Herold magmy niesie rozkaz Wschodu. Kleczec w popiele albo walczyc.',
      'Zloty blask nie jest nasz. Prawdziwe zloto to ogien Straznika Wschodu.',
      'Komandor tunelu woła: Guardian ognia pragnie huku pod stopami bohatera.'
    ],
    commanderDown:[
      'Herold padl. Wschodni Guardian przyjmie jego iskry pod lawa.',
      'Niech popiol komandora zapisze droge do glebszego Kreta.',
      'Dowodca zgasl, ale ogien Wschodu nie zna ciszy.'
    ],
    lore:[
      'Na wschodzie spi Ognisty Guardian. My jestesmy tylko sadza spod jego paznokcia.',
      'Pod lawa jest starszy tunel. Mowi sie, ze Trzeci Kret slucha tam krokow bohatera.',
      'Straznik Wschodu nie chodzi. On kaze ziemi isc za siebie.',
      'Gdy Wschodni Guardian ryknie, nawet kamien udaje modlitwe.',
      ...STORY_LORE.invasions.molekin
    ],
    siege:[
      'Sciana przed celem. Dla Straznika Wschodu sciany sa tylko zimnym paliwem.',
      'Bohater za oslona. Rozgrzac kamien, rozepchnac tunel, oddac hold ogniowi.',
      'Nie ma fortecy, jest tylko ziemia, ktora jeszcze nie uslyszala Guardiana.'
    ],
    breach:[
      'Kamien puszcza. Ognisty Guardian lubi, gdy przeszkody ucza sie byc popiolem.',
      'Przebicie! Wschod patrzy przez dziure i jest zadowolony.',
      'Ziemia otwarta. Tunel sklada hold Straznikowi Wschodu.'
    ],
    trapped:[
      'Zasypalo nas? Dobrze. Wschodni Guardian kocha tych, ktorzy ryja dalej.',
      'Gruz to tylko test wiary w ogien pod ziemia.',
      'Oddychac popiolem, kopac do swiatla. Guardian Wschodu patrzy.'
    ],
    support:[
      'Zar do ran, popiol do kosci. Straznik Wschodu nie lubi marnych sluzacych.',
      'Lecz sie w cieple Guardiana. Jeszcze bedziesz gryzl powierzchnie.',
      'Nie gasnac. Ognisty Pan Wschodu potrzebuje wszystkich pazurow.'
    ],
    healed:[
      'Znow plone od srodka. Guardian oddal mi mala iskre.',
      'Rany zamkniete. Wschod nie przyjmuje wymowek.',
      'Cieplo wraca. Tunel jeszcze zaspiewa.'
    ],
    repair:[
      'Wracam do szybu. Lawowy oddech Wschodniego Guardiana sklei mi kosci.',
      'Tunel mnie laduje. To nie ucieczka, to pielgrzymka pod ziemie.',
      'Przy szybie cieplej. Guardian Wschodu dmucha przez pekniecia.'
    ],
    allyDown:[
      'Brat zapadl sie w popiol. Niech Wschodni Guardian wypali jego imie w skale.',
      'Jeden pazur mniej. Tunel zapamieta, kto kazal mu kopac.',
      'Nie plakac. Lawa nie placze, lawa wraca.'
    ],
    heroHit:[
      'Trafienie! Niech bohater poczuje mala wersje Wschodniego Guardiana.',
      'Cios wszedl. Ogien Wschodu odbil sie w pasku HP.',
      'Dobrze. Guardian lubi, gdy powierzchnia drzy.'
    ],
    heroHurt:[
      'Bohater oberwal. Nawet swiat sklada hold ogniowi Wschodu.',
      'Powierzchnia sama go kaleczy. Guardian ma dlugie tunele.',
      'Nie nasz cios, a pachnie jak proroctwo z lawy.'
    ],
    heroLowHp:[
      'Bohater slabnie. Ciszej, bo Straznik Wschodu moze uznac to za ofiare.',
      'Niskie HP. Jeszcze iskra i tunel bedzie mial nowa legende.',
      'Nie spalic za szybko. Guardian lubi final z echem.'
    ],
    heroHighHp:[
      'Bohater zdrowy. Wschodni Guardian lubi twarde drewno na ognisko.',
      'Pelny pasek? Dobrze, wiecej do rozgrzania.',
      'Duzy zapas zycia. Tunel bedzie dluzszy.'
    ],
    heroHeal:[
      'On sie leczy. Herezja chlodnej skory wobec ognia Wschodu.',
      'Bohater zamyka rany. Guardian otworzy mu ziemie.',
      'Leczenie wykryte. Pod lawa smieja sie male kamienie.'
    ],
    heroMine:[
      'On kopie. Niech wie, ze prawdziwe tunele naleza do Wschodniego Guardiana.',
      'Kilof na ziemi? Amator dotyka swietej skory tunelu.',
      'Bohater ryje. Trzeci Kret pod spodem chyba juz go slyszy.'
    ],
    weaponMelee:[
      'Bron biala. Podejdz blizej do ciepla Guardiana.',
      'Miecz? Pazury sa starsze niz stal powierzchni.',
      'Kontakt bliski. Tunel lubi takie modlitwy.'
    ],
    weaponBow:[
      'Luk. Drewniany strach przed ogniem Wschodu.',
      'Strzaly lataja. Schylic helmy, chwalic Guardiana.',
      'Balistyka powierzchni. Pod ziemia i tak wszystko spada.'
    ],
    weaponFlame:[
      'Ogien w rece bohatera? Ukradl maly oddech Straznika Wschodu.',
      'Plomien wykryty. Niech kleczy przed prawdziwym sloncem pod lawa.',
      'Cieplo po zlej stronie. Odebrac i oddac Guardianowi.'
    ],
    weaponHose:[
      'Woda! Bluznierstwo przeciw Wschodniemu Plomieniowi.',
      'Strumien wody. Zakryc zar, gryźć mocniej.',
      'Mokry bohater nie rozumie lawy.'
    ],
    weaponGas:[
      'Gaz w tunelu? Wystarczy iskra Guardiana i zrobi sie hymnem.',
      'Chmura pachnie wybuchem. Wschod lubi takie kadzidlo.',
      'Nie wdychac, chyba ze zaraz zaplonie.'
    ],
    weaponElectric:[
      'Prad trzaska jak nerw wulkanu. Guardian i tak plonie glosniej.',
      'Elektryka powierzchni. Iskra bez lawy jest tylko plotka.',
      'Niech ladunek szuka ziemi. My jestesmy ziemia.'
    ],
    weaponPickaxe:[
      'Kilof jako bron? To juz prawie modlitwa, ale bez licencji tunelu.',
      'On walczy narzedziem kopacza. Straznik Wschodu zapisuje zniewage.',
      'Pickaxe wykryty. Trzeci Kret pod ziemia przewrocil sie przez sen.'
    ],
    weaponGeneric:[
      'Nowa bron. Sprawdzic, czy boi sie lawy.',
      'Uzbrojenie zmienione. Tunel zmieni kat natarcia.',
      'Nie znam tego zelaza, ale Wschodni Guardian stopi nazwe.'
    ],
    tank:[
      'Stane pierwszy. Bazaltowy grzbiet dla Straznika Wschodu.',
      'Bij we mnie. Kamien tez bywa modlitwa.',
      'Tarcza z bazaltu, serce z zaru.'
    ],
    flee:[
      'Do szybu! Guardian leczy tych, ktorzy wracaja z raportem.',
      'Cofam sie do ciepla. Wiara nie umiera, tylko sie dogrzewa.',
      'Zmiana tunelu, nie strach.'
    ],
    hurt:[
      'Au. Wschodni Guardian policzy te rane jako podatek od powierzchni.',
      'Krew na popiele. Ladny kolor dla Guardiana.',
      'Boli, czyli ziemia jeszcze mnie trzyma.'
    ],
    build:[
      'Stawiam goracy wentyl. Niech powierzchnia oddycha Wschodem.',
      'Zarowa zaslona dla Guardiana.',
      'Maly komin, wielka modlitwa.'
    ],
    cover:[
      'Za kamieniem. Kamien zna nasze hymny.',
      'Oslona ciepla, oczy na bohatera.',
      'Schowany, ale blizej lawy.'
    ],
    sniper:[
      'Lawa leci wolniej niz laser, ale pamieta droge.',
      'Nie ruszaj sie. Wschodni Guardian lubi cel z cieniem.',
      'Lobbuje zar dla pana pod wschodnim horyzontem.'
    ],
    sapper:[
      'Dajcie mi kamien, zrobie z niego przejscie.',
      'Ryje dla Wschodu. Powierzchnia jest tylko cienka klamstwa.',
      'Kazda sciana ma strone, od ktorej boi sie pazura.'
    ],
    orbiter:[
      'Kraze przy cieple. Popiol pokazuje mi boki celu.',
      'Widze droge dymu, nie droge stop.',
      'Guardian Wschodu lubi procesje wokol plomienia.'
    ],
    flanker:[
      'Bokiem, przez miekka ziemie.',
      'Nie patrz na tunel przed soba. Patrz na ten pod soba.',
      'Flanka z popiolu gotowa.'
    ],
    strike:[
      'Zar gotowy. Wschod kaze uderzyc.',
      'Niech bohater uslyszy kamien pod wlasnymi stopami.',
      'Tunel mowi: teraz.'
    ],
    generic:[
      'Czekamy na znak Straznika Wschodu.',
      'Pod ziemia jest cieplej i prawdziwiej.',
      'Popiol nie gada bez powodu. Popiol czeka na zdarzenie.'
    ]
  };
  const ALIEN_RARE_SPEECH = {
    landing:[
      'Skan pokazuje: Hero-Prostokat ma dzisiaj aure "nieprzewidziany problem". Doskonale.',
      'Ladowanie ceremonialne z opoznieniem: ktos w spodku polerowal oltarzowy przycisk.',
      'Oddzial melduje: jesli zginiemy, prosze nazwac krater naszym imieniem i nie pytac centrali.'
    ],
    commanderSight:[
      'Komandor rozkazuje cisze. Jego zloto samo juz krzyczy.',
      'Zloty dowodca wlaczyl tryb procesyjny. To zle dla ciszy, dobrze dla dramatu.'
    ],
    commanderDown:[
      'Dowodca upadl, ale skrzynia blyszczy jak przeprosiny od kosmosu.',
      'Zloto dowodcy wraca do ziemi. Hero-Prostokat dostal bardzo kosztowny psalm.'
    ],
    lore:STORY_LORE.invasions.rareAlien,
    allyDown:[
      'Zgasla jedna antena. Przez sekunde slychac bylo tylko symulacje.',
      'Nie wpisywac go jako strate. Wpisac jako nagly dowod wiary.',
      'Brat padl. Ktos przejmie jego zmiane przy hymnie, byle nie ja.'
    ],
    heroHit:[
      'Trafienie zapisane. Centrala nazwie to sukcesem, a my udamy, ze tak planowalismy.',
      'Pasek HP drgnal. Przez chwile wszechswiat byl mniej pewny siebie.',
      'Uderzenie skuteczne. Prosze nie wiwatowac za glosno, Prostokat jeszcze patrzy.'
    ],
    heroLowHp:[
      'Niskie HP. To ten moment, kiedy nawet spodek przestaje mrugac.',
      'Cel prawie gotow do legendy. Nie potknac sie o wlasna religie.'
    ],
    heroHighHp:[
      'Pelny pasek. Ktos karmil ikone bardzo uczciwie.',
      'Hero-Prostokat wyglada jak boss w cudzym tutorialu.'
    ],
    heroHeal:[
      'Leczenie! Ktos sprawdzil, czy boskosc ma przycisk cofania.',
      'On naprawia fabule w locie. Nieprzyzwoicie profesjonalne.',
      'Medyk kultu notuje: cel tez ma medyka, tylko w butelce.'
    ],
    heroMine:[
      'On kopie jakby mapa byla rozmowa, a kilof argumentem.',
      'Geologia znowu przegrywa z ambicja Prostokata.',
      'Kilof uslyszany. Teren robi mine swiadka koronnego.'
    ],
    weaponBow:[
      'Strzaly ida lukiem. Nawet jego pociski potrzebuja dramaturgii.',
      'Balistyka pokorna wobec Prostokata. My mniej.'
    ],
    weaponFlame:[
      'Plomien w dloni celu. Nagle robi sie bardzo teologicznie.',
      'Kto dal ikonie kieszonkowy zachod slonca?'
    ],
    weaponHose:[
      'Waz bojowy. Nasza powaga zostala zaatakowana hydraulicznie.',
      'Mokry rytual. Anteny prosza o przeniesienie do dzialu absurdu.'
    ],
    weaponGas:[
      'Gaz na scenie. Jesli to kadzidlo, jest zdecydowanie za agresywne.',
      'Chmura zakrywa cel, ale nie jego problematyczny majestat.'
    ],
    weaponElectric:[
      'Prad przeszedl po antenach jak plotka po radzie kultu.',
      'Elektryka celu robi z wiary bardzo jasny wykres.'
    ],
    weaponPickaxe:[
      'Kilof bojowy. Nikt w akademii kultu nie przygotowal nas na ten paragraf.',
      'On argumentuje narzedziem. Prymitywnie, ale trudno odmowic interpunkcji.'
    ],
    breach:[
      'Sciana ustapila i przez chwile wygladala, jakby sama zrozumiala dogmat.',
      'Przejscie otwarte. Architektura sklada reklamacje po smierci.'
    ],
    trapped:[
      'Gruz zrobil zasadzke na wyznawcow. To bardzo nieprofesjonalne ze strony miasta.',
      'Utknelismy, ale tylko cialami. Religia nadal ma line of sight.'
    ],
    repair:[
      'Serwis spodka nalewa mi odwagi prosto do pancerza.',
      'Wracam po naprawe. Prosze nazwac to sakramentem, nie panika.'
    ],
    build:[
      'Barykada gotowa. Wyglada krzywo, ale wierzy prosto.',
      'Mur postawiony. Niech Hero-Prostokat doceni ten maly teatr przeszkod.'
    ]
  };
  const MOLEKIN_RARE_SPEECH = {
    landing:[
      'Tunel spoznil sie o jeden kamien. Wschodni Guardian kazal kamien przeprosic.',
      'Wychodzimy. Jesli powierzchnia zacznie krzyczec, to znaczy, ze dziala.',
      'Popiol pod stopami szepcze: dzisiaj bedzie dziwnie.'
    ],
    commanderSight:[
      'Herold magmy przyniosl cisze z glebi. Cisza zaraz kogos ugryzie.',
      'Dowodca tunelu pachnie siarka i rozkazem. To zwykle wystarcza.'
    ],
    commanderDown:[
      'Herold zgasl. Tunel zapamieta jego cieplo, a my zapamietamy skrzynie.',
      'Dowodca padl tak glosno, ze Wschod przez chwile odpowiedzial echem.'
    ],
    lore:STORY_LORE.invasions.rareMolekin,
    allyDown:[
      'Brat zniknal w popiele. Ziemia oddycha jego imieniem.',
      'Nie ma go. Zostal tylko slad pazura i bardzo goraca cisza.',
      'Tunel zabral swojego. Guardian liczy dalej.'
    ],
    heroHit:[
      'Cios wszedl. Pod ziemia ktos uderzyl w kamien jak w dzwon.',
      'Bohater drgnal. Wschod usmiechnal sie przez szczeline.',
      'Skuteczny zar. Przez chwile nawet lawa sluchala.'
    ],
    heroLowHp:[
      'Niskie HP. Niech nikt nie kichnie iskra, bo final ucieknie za szybko.',
      'Prawie popiol. Guardian lubi takie slowo, ale jeszcze czeka.'
    ],
    heroHighHp:[
      'Zdrowy bohater pali sie najdluzej w opowiesciach.',
      'Pelny pasek. To bedzie tunel z dlugim refrenem.'
    ],
    heroHeal:[
      'On sie leczy. Powierzchnia wymyslila zimne oszustwo przeciw ranom.',
      'Rany znikaja. Tunel syczy, bo lubi, kiedy zostaja.',
      'Bohater zamknal rane. My otworzymy ziemie.'
    ],
    heroMine:[
      'On kopie. Trzeci Kret pod spodem przestal udawac, ze spi.',
      'Kilof dotknal ziemi. Ziemia odpowiedziala bardzo cicho: amator.',
      'Bohater robi tunel bez pozwolenia Wschodu. To juz komedia religijna.'
    ],
    weaponBow:[
      'Strzaly gwizdza. Pod ziemia nie ma nieba, wiec nie ufamy lukom.',
      'Drewno lata. Wschodni Guardian zrobi z tego opal.'
    ],
    weaponFlame:[
      'Plomien bohatera wyglada jak ukradzione dziecko wulkanu.',
      'Ogien przeciw nam? Tunel smieje sie iskrami.'
    ],
    weaponHose:[
      'Woda! Zakryc zar, pluc popiolem, nie robic miny.',
      'Hydrauliczna herezja. Guardian bedzie bardzo suchy w komentarzu.'
    ],
    weaponGas:[
      'Gaz szuka iskry. My przynieslismy ich za duzo.',
      'Chmura w tunelu to albo smierc, albo bardzo zly kadzielnik.'
    ],
    weaponElectric:[
      'Prad chce do ziemi. Ziemia jest po naszej stronie.',
      'Iskra bez lawy szczeka jak maly kamien.'
    ],
    weaponPickaxe:[
      'Kilof bojowy? Trzeci Kret chyba wlasnie usiadl z zainteresowania.',
      'On walczy jak gornik, ktory zgubil instrukcje do gornika.'
    ],
    breach:[
      'Sciana puscila. Wschod przez chwile widzial wszystko.',
      'Kamien zrobil miejsce. Madry kamien zyje dluzej.'
    ],
    trapped:[
      'Zasypalo nas. To prawie dom, tylko za malo cieply.',
      'Gruz chce nas zatrzymac. Gruz nie zna naszej rodziny.'
    ],
    repair:[
      'Szyb grzeje kosci. Wschodni Guardian dmucha przez pekniecia.',
      'Wracam pod ziemie po zar. To pielgrzymka z rachunkiem za rany.'
    ],
    build:[
      'Wentyl stoi. Powierzchnia dostala mala dziure do oddychania Wschodem.',
      'Buduje cieplo. Kamien ma sie czuc obserwowany.'
    ]
  };
  const ALIEN_ECHO_SPEECH = {
    allyDown:['Zapisalem jego antene.', 'Niech cztery boki go policza.', 'Ktos przejmie hymn.'],
    heroHit:['Widzieliscie pasek?', 'Kontakt potwierdzony.', 'Prostokat mrugnal!'],
    heroHeal:['On cofnal rane.', 'Nieuczciwie eleganckie.', 'Medyk, ucz sie.'],
    heroMine:['Geologia placze.', 'Kilof znowu gada.', 'Teren protestuje.'],
    breach:['Przejscie zyje.', 'Sciana byla opinia.', 'Korytarz gotowy.'],
    trapped:['Nie zostawiaj anteny.', 'Odkopac wiare.', 'Miasto oszukuje.'],
    repair:['Serwis trwa.', 'Laduj go.', 'Niech wroci caly.'],
    build:['Mur wierzy.', 'Barykada gotowa.', 'Klej pobozny.']
  };
  const MOLEKIN_ECHO_SPEECH = {
    allyDown:['Popiol pamieta.', 'Tunel go przyjal.', 'Pazur mniej.'],
    heroHit:['Wschod widzial.', 'Pasek zasyczal.', 'Cieplo weszlo.'],
    heroHeal:['Zimna sztuczka.', 'Rana uciekla.', 'Otworzymy nastepna.'],
    heroMine:['Bez licencji.', 'Trzeci Kret slucha.', 'Ziemia syczy.'],
    breach:['Kamien madry.', 'Dziura spiewa.', 'Wschod patrzy.'],
    trapped:['Prawie dom.', 'Ryj dalej.', 'Gruz nie wygra.'],
    repair:['Szyb grzeje.', 'Oddychaj lawa.', 'Wracaj z zarem.'],
    build:['Wentyl gotowy.', 'Cieplo rosnie.', 'Kamien oddycha.']
  };
  const SPEECH_MEMORY_LIMIT = 9;
  const SPEECH_MAX_CHARS = 64;
  const SPEECH_GLOBAL_COOLDOWN = 5600;
  const SPEECH_KEY_COOLDOWN = 18000;
  const SPEECH_FORCE_COOLDOWN = 4200;
  const SPEECH_FORCE_KEY_COOLDOWN = 11000;
  function compactSpeechText(text){
    let line = String(text || '').replace(/\s+/g,' ').trim();
    if(!line) return '';
    line = line
      .replace(/\bHero-Prostokata\b/g,'Prostokata')
      .replace(/\bHero-Prostokat\b/g,'Prostokat')
      .replace(/\bswieta geometri[ae]\b/gi,'geometrie')
      .replace(/\bWschodni Straznik\b/g,'Straznik Wschodu')
      .replace(/\bOgnisty Guardian\b/g,'Guardian ognia');
    if(line.length <= SPEECH_MAX_CHARS) return line;
    const sentence = line.match(/^(.{20,}?[.!?])\s+/);
    if(sentence && sentence[1].length <= SPEECH_MAX_CHARS) return sentence[1];
    let cut = line.lastIndexOf(' ', SPEECH_MAX_CHARS - 1);
    if(cut < 32) cut = SPEECH_MAX_CHARS - 1;
    return line.slice(0,cut).replace(/[\s,;:.-]+$/,'') + '.';
  }
  function speechTableFor(team){
    return isMolekinTeam(team) ? MOLEKIN_SPEECH : ALIEN_SPEECH;
  }
  function rareSpeechTableFor(team){
    return isMolekinTeam(team) ? MOLEKIN_RARE_SPEECH : ALIEN_RARE_SPEECH;
  }
  function echoSpeechTableFor(team){
    return isMolekinTeam(team) ? MOLEKIN_ECHO_SPEECH : ALIEN_ECHO_SPEECH;
  }
  function atomicWinterSpeechLines(team){
    try{
      const aw=MM.atomicWinter;
      if(!aw || typeof aw.contextLines!=='function') return [];
      const kind=isMolekinTeam(team) ? 'molekin' : 'alien';
      return aw.contextLines(kind).map(compactSpeechText).filter(Boolean);
    }catch(e){ return []; }
  }
  function speechLinesFor(table,key,team,opts){
    let lines = Array.isArray(table && table[key]) ? table[key].map(compactSpeechText).filter(Boolean) : [];
    if(key === 'lore'){
      const kind = isMolekinTeam(team) ? 'molekin' : 'alien';
      const rarity = opts && opts.rare ? 'rare' : 'base';
      lines = lines.concat(storyInvasionLinesForProgress(kind,rarity,root).map(compactSpeechText).filter(Boolean));
    }
    if(key === 'atomicWinter') lines = lines.concat(atomicWinterSpeechLines(team));
    const seen = new Set();
    lines = lines.filter(line=>{
      if(!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
    return lines;
  }
  function chooseNovelSpeechLine(lines,team){
    const pool = Array.isArray(lines) ? lines.map(t=>String(t || '').trim()).filter(Boolean) : [];
    if(!pool.length) return '';
    const recent = new Set(Array.isArray(team && team.recentSpeechLines) ? team.recentSpeechLines : []);
    const novel = pool.filter(line=>!recent.has(line));
    const choices = novel.length ? novel : pool;
    return choices[Math.floor(Math.random() * choices.length)] || choices[0] || '';
  }
  function rememberSpeechLine(team,text,key){
    if(!team || !text) return;
    ensureReactionState(team);
    const line = String(text);
    team.recentSpeechLines.push(line);
    while(team.recentSpeechLines.length > SPEECH_MEMORY_LIMIT) team.recentSpeechLines.shift();
    const k = String(key || 'generic');
    team.speechEventCounts[k] = Math.min(999, (team.speechEventCounts[k] || 0) + 1);
  }
  function pickLine(key,team,opts){
    opts = opts || {};
    const table = speechTableFor(team);
    const base = speechLinesFor(table,key,team);
    const fallback = speechLinesFor(table,'generic',team).concat(speechLinesFor(ALIEN_SPEECH,'generic',team));
    const rare = speechLinesFor(rareSpeechTableFor(team),key,team,{rare:true});
    let lines = base.length ? base.slice() : fallback;
    const count = (team && team.speechEventCounts && team.speechEventCounts[key]) || 0;
    const rareChance = opts.rare ? 1 : Math.min(0.10, 0.015 + count * 0.006 + (opts.force ? 0.01 : 0));
    if(rare.length && Math.random() < rareChance) lines = rare.concat(lines);
    return chooseNovelSpeechLine(lines,team);
  }
  function ensureReactionState(team){
    if(!team) return;
    if(!team.reactionCooldowns || typeof team.reactionCooldowns !== 'object') team.reactionCooldowns = {};
    if(!Number.isFinite(team.nextReactionAt)) team.nextReactionAt = 0;
    if(!Array.isArray(team.recentSpeechLines)) team.recentSpeechLines = [];
    if(!team.speechEventCounts || typeof team.speechEventCounts !== 'object') team.speechEventCounts = {};
    if(!Number.isFinite(team.nextEchoSpeechAt)) team.nextEchoSpeechAt = 0;
  }
  function liveTeamAliens(team,opts){
    const avoid = opts && opts.avoid;
    const live = ((team && team.aliens) || []).filter(a=>a && a !== avoid && !a.dead && a.hp > 0);
    return live.filter(a=>!a.silent);
  }
  function pickReactionSpeaker(team,opts){
    const live = liveTeamAliens(team,opts);
    if(!live.length) return null;
    const preferred = opts && opts.preferRole ? live.filter(a=>a.role === opts.preferRole) : [];
    const pool = preferred.length ? preferred : live;
    const x = opts && Number.isFinite(opts.x) ? opts.x : null;
    const y = opts && Number.isFinite(opts.y) ? opts.y : null;
    if(x !== null && y !== null){
      let best = pool[0];
      let bestD = Infinity;
      for(const a of pool){
        const d = Math.hypot(a.x - x, a.y - y);
        if(d < bestD){ best = a; bestD = d; }
      }
      return best;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function speechKeyForWeapon(kind){
    const k = String(kind || '').toLowerCase();
    if(k === 'bow' || k === 'arrow') return 'weaponBow';
    if(k === 'flame' || k === 'fire') return 'weaponFlame';
    if(k === 'hose' || k === 'water') return 'weaponHose';
    if(k === 'gas' || k === 'poison') return 'weaponGas';
    if(k === 'electric' || k === 'laser') return 'weaponElectric';
    if(k === 'melee' || k === 'sword') return 'weaponMelee';
    if(k === 'pickaxe' || k === 'pick') return 'weaponPickaxe';
    return 'weaponGeneric';
  }
  function reactionKeyForHeroAction(type,detail){
    const t = String(type || '');
    if(t === 'hero_hit') return 'heroHit';
    if(t === 'hero_hurt') return 'heroHurt';
    if(t === 'hero_heal') return 'heroHeal';
    if(t === 'hero_mine') return 'heroMine';
    if(t === 'hero_weapon') return speechKeyForWeapon(detail && (detail.weaponType || detail.kind || detail.type));
    if(t === 'hero_low_hp') return 'heroLowHp';
    if(t === 'hero_high_hp') return 'heroHighHp';
    return '';
  }
  function setAlienSpeech(a,text,now,opts){
    opts = opts || {};
    if(!a || !text) return '';
    if(!opts.override && a.speechText && now < (a.speechUntil || 0)) return '';
    a.speechText = compactSpeechText(text);
    a.speechLong = isLongCharacterSpeech(a.speechText);
    const baseDuration = clamp(1050 + a.speechText.length * 18,1300,2700);
    a.speechUntil = now + readableCharacterSpeechDuration(baseDuration,a.speechText);
    if(a.speechLong && a.onGround) a.vx = 0;
    a._speechLayout = null;
    return a.speechText;
  }
  function forceAlienSpeech(a,team,key,now){
    const at = Number.isFinite(now) ? now : nowMs();
    if(team && !team.speechStartAt) team.speechStartAt = at;
    ensureReactionState(team);
    const speechKey = key || 'generic';
    const said = setAlienSpeech(a,pickLine(speechKey,team,{force:true,speaker:a}),at,{override:true});
    if(said) rememberSpeechLine(team,said,speechKey);
    return said;
  }
  function maybeEchoTeamSpeech(team,key,opts,now,speaker){
    const lines = speechLinesFor(echoSpeechTableFor(team),key,team);
    if(!team || !lines.length || !speaker) return '';
    if(now < (team.nextEchoSpeechAt || 0)) return '';
    const count = (team.speechEventCounts && team.speechEventCounts[key]) || 0;
    const chance = opts && opts.echo ? 1 : Math.min(0.07, 0.012 + count * 0.006 + (opts && opts.force ? 0.01 : 0));
    if(Math.random() >= chance) return '';
    const echoSpeaker = pickReactionSpeaker(team,{avoid:speaker,x:opts && opts.x,y:opts && opts.y});
    if(!echoSpeaker) return '';
    const line = chooseNovelSpeechLine(lines,team);
    const said = setAlienSpeech(echoSpeaker,line,now,{override:false});
    if(!said) return '';
    rememberSpeechLine(team,said,key+':echo');
    team.nextEchoSpeechAt = now + 22000 + Math.floor(Math.random() * 8000);
    return said;
  }
  function triggerTeamSpeech(team,key,opts){
    opts = opts || {};
    if(!team || !key) return '';
    const table = speechTableFor(team);
    if(!(table && table[key]) && key !== 'atomicWinter') return '';
    if(key === 'atomicWinter' && !atomicWinterSpeechLines(team).length) return '';
    const now = Number.isFinite(opts.now) ? opts.now : nowMs();
    ensureReactionState(team);
    const force = !!opts.force;
    const requestedCooldown = Number.isFinite(opts.cooldown) ? opts.cooldown : SPEECH_GLOBAL_COOLDOWN;
    const requestedKeyCooldown = Number.isFinite(opts.keyCooldown) ? opts.keyCooldown : SPEECH_KEY_COOLDOWN;
    const cooldown = Math.max(requestedCooldown, force ? SPEECH_FORCE_COOLDOWN : SPEECH_GLOBAL_COOLDOWN);
    const keyCooldown = Math.max(requestedKeyCooldown, force ? SPEECH_FORCE_KEY_COOLDOWN : SPEECH_KEY_COOLDOWN);
    if(!force && now < (team.nextReactionAt || 0)) return '';
    if(!force && now < (team.reactionCooldowns[key] || 0)) return '';
    const requested = opts.speaker && !opts.speaker.silent && !opts.speaker.dead && opts.speaker.hp > 0 ? opts.speaker : null;
    const speaker = requested || pickReactionSpeaker(team,opts);
    if(!speaker) return '';
    const said = setAlienSpeech(speaker,opts.text || pickLine(key,team,Object.assign({},opts,{speaker})),now,{override:opts.override === true});
    if(!said) return '';
    rememberSpeechLine(team,said,key);
    speaker.speechCue = '';
    speaker.speechCueUntil = 0;
    maybeEchoTeamSpeech(team,key,opts,now,speaker);
    team.nextReactionAt = now + cooldown;
    team.reactionCooldowns[key] = now + keyCooldown;
    return said;
  }
  function updateAlienSpeech(a,team,now){
    if(!a || a.dead || a.hp <= 0) return;
    if(!team.speechStartAt) team.speechStartAt = now;
    if(a.speechText && now >= (a.speechUntil || 0)){
      a.speechText = '';
      a.speechLong = false;
      a._speechLayout = null;
    }
  }
  function longSpeechActive(a,now){
    const at = Number.isFinite(now) ? now : nowMs();
    return !!(a && a.speechLong && a.speechText && at < (a.speechUntil || 0));
  }
  function onHeroAction(type,detail){
    detail = detail || {};
    const key = reactionKeyForHeroAction(type,detail);
    if(!key) return {handled:false, spoken:0, key:''};
    const player = detail.player || null;
    const x = Number.isFinite(detail.x) ? detail.x : (player && Number.isFinite(player.x) ? player.x : null);
    const y = Number.isFinite(detail.y) ? detail.y : (player && Number.isFinite(player.y) ? player.y : null);
    let spoken = 0;
    const lines = [];
    for(const team of activeInvasionTeams()){
      if(!team || !team.aliens || !team.aliens.length) continue;
      const said = triggerTeamSpeech(team,key,{
        x,y,
        force:!!detail.force,
        preferRole:key === 'heroHeal' ? 'healer' : (key === 'heroLowHp' ? 'sniper' : ''),
        cooldown:key.indexOf('weapon') === 0 ? 6800 : 7600,
        keyCooldown:key.indexOf('weapon') === 0 ? 24000 : 22000,
        override:detail.override === true
      });
      if(said){ spoken++; lines.push(said); }
    }
    return {handled:spoken > 0, spoken, key, lines};
  }
  function updateHeroAwareness(player,now){
    if(!player || !(player.maxHp > 0)) return;
    const hp = Number(player.hp);
    if(!Number.isFinite(hp)) return;
    const frac = clamp(hp / player.maxHp,0,1);
    const band = frac <= 0.30 ? 'low' : (frac >= 0.86 ? 'high' : 'mid');
    for(const team of activeInvasionTeams()){
      if(!team || !team.aliens || !team.aliens.length) continue;
      ensureReactionState(team);
      if(!team.speechStartAt) team.speechStartAt = now;
      if(team.heroHealthBand === undefined) team.heroHealthBand = '';
      if(team.heroHealthBand === band) continue;
      if(band === 'mid'){
        team.heroHealthBand = band;
        continue;
      }
      if(now < (team.speechStartAt || now) + 10000) continue;
      const said = triggerTeamSpeech(team,band === 'low' ? 'heroLowHp' : 'heroHighHp',{
        x:player.x,
        y:player.y,
        now,
        preferRole:band === 'low' ? 'sniper' : '',
        cooldown:9000,
        keyCooldown:32000,
        override:false
      });
      if(said) team.heroHealthBand = band;
    }
  }
  function updateAtomicWinterAwareness(player,now){
    if(!player) return;
    let active=false;
    try{
      const aw=MM.atomicWinter;
      active=!!(aw && typeof aw.isActive==='function' && aw.isActive());
    }catch(e){ active=false; }
    if(!active) return;
    for(const team of activeInvasionTeams()){
      if(!team || !team.aliens || !team.aliens.length) continue;
      ensureReactionState(team);
      if(!team.speechStartAt) team.speechStartAt = now;
      if(!Number.isFinite(team.nextAtomicWinterSpeechAt)) team.nextAtomicWinterSpeechAt = now + 3500 + Math.random() * 3500;
      if(now < (team.speechStartAt || now) + 4500) continue;
      if(now < team.nextAtomicWinterSpeechAt) continue;
      const said = triggerTeamSpeech(team,'atomicWinter',{
        x:player.x,
        y:player.y,
        now,
        cooldown:9000,
        keyCooldown:30000,
        override:false
      });
      team.nextAtomicWinterSpeechAt = now + (said ? 32000 + Math.random() * 18000 : 7000 + Math.random() * 5000);
    }
  }
  function shouldBreakBlockedTile(hit,player,range){
    if(!hit || !hit.blocked || !isAttackableStructureTile(hit.tile)) return false;
    const px = player && Number.isFinite(player.x) ? player.x : 0;
    const py = player && Number.isFinite(player.y) ? player.y : 0;
    return Math.hypot((hit.tx+0.5)-px,(hit.ty+0.5)-py) <= (Number.isFinite(range) ? range : 7.5);
  }
  function isAimedBreachHit(hit,aimX,aimY){
    return !!(hit && hit.blocked && Number.isFinite(aimX) && Number.isFinite(aimY) &&
      Math.hypot((hit.tx+0.5)-aimX,(hit.ty+0.5)-aimY) <= 1.65);
  }
  // --- co-op party: embodied guests are heroes the invaders hunt too -------------
  // Nearest party member (host hero or a guest body from MM.coopBodies) to (wx,wy).
  // Bodies are host-tracked and player-like (x/y plus advisory vx/vy for aim-lead);
  // their damage must land through body.hurt() so the host keeps authority over
  // i-frames and the vitals stream. MM.coopBodies is empty in solo play and absent
  // in the Node sims — the early return keeps every caller at zero cost there.
  function nearestPartyMember(wx,wy,player){
    const bodies=(typeof MM!=='undefined' && MM.coopBodies) || null;
    if(!bodies || !bodies.length) return player;
    let best=player, bd=(player && Number.isFinite(player.x) && Number.isFinite(player.y)) ? (player.x-wx)*(player.x-wx)+(player.y-wy)*(player.y-wy) : Infinity;
    for(const b of bodies){
      if(!b || b.dead || typeof b.hurt!=='function' || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      const d=(b.x-wx)*(b.x-wx)+(b.y-wy)*(b.y-wy);
      if(d<bd){ bd=d; best=b; }
    }
    return best;
  }
  function hurtPartyTarget(tgt,dmg,opts){
    if(tgt && typeof tgt.hurt==='function'){ tgt.hurt(dmg,opts.srcX,opts.srcY,opts.cause,opts); return; }
    try{ if(root.damageHero) root.damageHero(dmg,opts); }catch(e){}
  }
  // The squad brain hunts the party member nearest to the squad's center — a guest
  // standing in the landing zone gets engaged instead of marched past toward a
  // distant host. Solo play: no bodies, the host comes back untouched.
  function squadPartyTarget(steerable,player){
    const bodies=(typeof MM!=='undefined' && MM.coopBodies) || null;
    if(!bodies || !bodies.length || !steerable.length) return player;
    let cx=0, cy=0;
    for(const u of steerable){ cx+=u.x; cy+=u.y; }
    return nearestPartyMember(cx/steerable.length, cy/steerable.length, player);
  }
  function partyTargetOnLaser(sx,sy,ex,ey,player){
    const dx=ex-sx,dy=ey-sy,len2=dx*dx+dy*dy;
    if(len2<=0.0001) return null;
    let best=null,bestT=Infinity;
    for(const tgt of livePartyTargets(player)){
      // The body is a vertical capsule, not a chest-point: a beam clipping the
      // head or the legs counts too (the whole laser LINE is the weapon).
      const hh=Math.max(0.6,Number(tgt.h)||0.95);
      const radius=Math.max(0.32,Math.min(0.52,Math.max((Number(tgt.w)||0.70)*0.48,hh*0.32)));
      for(const cy of [tgt.y-hh*0.72,tgt.y-0.40,tgt.y+hh*0.42]){
        const cx=tgt.x;
        const rawAlong=((cx-sx)*dx+(cy-sy)*dy)/len2;
        if(rawAlong<=0.015||rawAlong>1.015) continue;
        const along=clamp(rawAlong,0,1);
        const px=sx+dx*along,py=sy+dy*along;
        if(Math.hypot(cx-px,cy-py)<=radius && along<bestT){ best=tgt; bestT=along; break; }
      }
    }
    return best;
  }
  function alienWeaponProfile(a){
    return ALIEN_WEAPON_PROFILES[String(a && a.weaponType || 'pulse')] || ALIEN_WEAPON_PROFILES.pulse;
  }
  function moleWeaponProfile(a){
    return MOLE_WEAPON_PROFILES[String(a && a.weaponType || 'stone')] || MOLE_WEAPON_PROFILES.stone;
  }
  function releaseAlienLaser(a,team,player,getTile,setTile,ctx,charge){
    const c=charge || (a && a.alienCharge);
    if(!a || !c) return null;
    a.alienCharge=null;
    const profile=profileFor(team);
    const threat=unitThreatLevel(team,a);
    const weaponTier=unitWeaponTier(team,a);
    const weapon=alienWeaponProfile(a);
    const range=(profile.fireRange+Math.min(6,(team.day||1)*0.35)+Math.min(4,Math.max(0,threat-(team.day||1))*0.11)+weaponTier*0.8)*(Number(weapon.range)||1);
    const ox=a.x+(a.facing||1)*0.23,oy=a.y-0.62;
    const weaponBoost=1+weaponTier*0.08;
    const dmgMult=(Number.isFinite(c.damageMult)?c.damageMult:1)*(Number(a.damageMult)||1)*weaponBoost*(Number(weapon.damage)||1);
    // The BEAM is the weapon, not just its endpoint: anybody standing anywhere
    // along the laser line takes the hit — including breach shots aimed at a
    // wall. A body intercepting the beam absorbs it (the tile behind survives).
    const dx=c.aimX-ox,dy=c.aimY-oy;
    const aimLen=Math.hypot(dx,dy)||1;
    const baseAng=Math.atan2(dy,dx);
    const beams=Math.max(1,Math.min(3,Number(weapon.beams)||1));
    const spread=Number(weapon.spread)||0;
    const damagedTargets=new Set();
    let centralHit=null,centralOffset=Infinity,firstParty=null;
    for(let i=0;i<beams;i++){
      const offset=(i-(beams-1)/2)*spread;
      const ang=baseAng+offset;
      const aimDist=Math.max(1,Math.min(range,aimLen));
      const aimX=ox+Math.cos(ang)*aimDist;
      const aimY=oy+Math.sin(ang)*aimDist;
      const hit=traceLine(ox,oy,aimX,aimY,getTile,range);
      const partyHit=partyTargetOnLaser(ox,oy,hit.x,hit.y,player);
      if(Math.abs(offset)<centralOffset){ centralOffset=Math.abs(offset); centralHit=hit; }
      if(partyHit && !damagedTargets.has(partyHit)){
        damagedTargets.add(partyHit);
        if(!firstParty) firstParty=partyHit;
        hurtPartyTarget(partyHit,Math.max(1,Math.round((5+Math.min(6,Math.floor(threat/5)))*dmgMult)),{
          srcX:a.x,srcY:a.y-0.4,kb:3.5*(Number(weapon.knockback)||1),kbY:-2.2,invulMs:430,cause:'alien_invasion'
        });
      }
      pushLaser(ox,oy,hit.x,hit.y,!!partyHit,hit.blocked,!!weapon.heavy||dmgMult>=1.5||weaponTier>=2,'alien_'+String(a.weaponType||'pulse'),weaponTier);
    }
    a.lastShotAt=nowMs();
    play('laser',{x:a.x,y:a.y-0.5});
    const hit=centralHit || traceLine(ox,oy,c.aimX,c.aimY,getTile,range);
    if(firstParty) return Object.assign(hit,{partyHit:firstParty});
    const breakRange=c.breach?profile.breachRange:7.5;
    const lockedPoint={x:c.aimX,y:c.aimY};
    if((c.tileAim&&c.breach&&isAimedBreachHit(hit,c.aimX,c.aimY)&&isAttackableStructureTile(hit.tile))||
       shouldBreakBlockedTile(hit,lockedPoint,breakRange)){
      const damaged=damageStructureTile(hit.tx,hit.ty,(3.6+Math.min(4.4,threat*0.20))*dmgMult*(Number(weapon.terrain)||1),getTile,setTile,ctx);
      if(damaged) triggerTeamSpeech(team,'breach',{speaker:a,x:hit.tx+0.5,y:hit.ty+0.5,cooldown:1900,keyCooldown:6200,override:false});
    }
    return hit;
  }
  function updateAlienLaserCharge(a,team,dt,player,getTile,setTile,ctx){
    const c=a&&a.alienCharge;
    if(!c) return false;
    const step=Math.max(0,Math.min(0.08,Number(dt)||0));
    a.facing=c.aimX>=a.x?1:-1;
    if(c.ghost) return true;
    a.vx=(a.vx||0)*Math.max(0,1-step*11);
    if(isFlyingUnit(a)){
      a.vy=Math.sin(nowMs()*0.004+(a.phase||0))*0.16;
      const ny=a.y+a.vy*step;
      if(!alienCollidesAt(a,a.x,ny,getTile)) a.y=ny;
      a.onGround=false;
    } else moveAlien(a,step,getTile);
    c.t=Math.max(0,(Number(c.t)||0)-step);
    if(c.t<=0) releaseAlienLaser(a,team,player,getTile,setTile,ctx,c);
    return true;
  }
  function fireAlienLaser(a,team,player,getTile,setTile,ctx,opts){
    opts = opts || {};
    if(!a) return null;
    if(a.alienCharge) return a.alienCharge;
    const tgt = nearestPartyMember(a.x,a.y,player); // shots chase the nearest hero, host or guest
    let aimX, aimY;
    const tileAim = Number.isFinite(opts.aimX) && Number.isFinite(opts.aimY);
    if(tileAim){
      aimX = opts.aimX; aimY = opts.aimY;
    } else {
      // lead the hero, degraded by the role's aim quality
      const wobble = Math.min(0.55, Math.max(0, 1 - (opts.aim || 0.9)) * 1.2);
      aimX = (Number.isFinite(tgt.vx) ? tgt.x + tgt.vx * 0.08 : tgt.x) + randRange(-wobble,wobble);
      aimY = (Number.isFinite(tgt.vy) ? tgt.y - 0.52 + tgt.vy * 0.035 : tgt.y - 0.52) + randRange(-wobble,wobble);
    }
    const weapon=alienWeaponProfile(a);
    const duration=randRange(ALIEN_LASER_CHARGE_MIN,ALIEN_LASER_CHARGE_MAX)*(Number(weapon.charge)||1);
    a.facing=aimX>=a.x?1:-1;
    a.alienCharge={
      t:duration,duration,aimX,aimY,tileAim,breach:!!opts.breach,
      damageMult:Number.isFinite(opts.damageMult)?opts.damageMult:1,weaponType:String(a.weaponType||'pulse'),ghost:false
    };
    play('charge',{x:a.x,y:a.y-0.5});
    return a.alienCharge;
  }
  function tryPlaceMoleHazard(team,tx,ty,player,getTile,setTile,ctx,heavy){
    if(!isMolekinTeam(team) || !inWorldY(ty,1)) return false;
    const old = readTile(getTile,tx,ty);
    if(old !== T.AIR && !isReplaceableNaturalOpenTile(old,false) && old !== T.STEAM && old !== T.HOT_AIR) return false;
    const px = player && Number.isFinite(player.x) ? player.x : 0;
    const py = player && Number.isFinite(player.y) ? player.y : 0;
    const nearHero = Math.hypot((tx+0.5)-px,(ty+0.5)-py) < 1.8;
    let tile = T.HOT_AIR;
    if(heavy && !nearHero && readTile(getTile,tx,ty+1) !== T.AIR && Math.random() < 0.24) tile = T.LAVA;
    if(writeTile(setTile,tx,ty,tile)){
      wakeTileChanged(ctx,tx,ty,old,tile);
      burst(tx+0.5,ty+0.5,tile === T.LAVA ? 'rare' : 'common');
      markHostSave(ctx);
      return true;
    }
    return false;
  }
  function molekinChargeRole(role){
    return role === 'rusher' || role === 'tank' || role === 'flanker' || role === 'orbiter' || role === 'sapper' || role === 'commander';
  }
  function molekinChargeLane(a,tgt,getTile){
    if(!a || !tgt || !a.onGround || !Number.isFinite(tgt.x) || !Number.isFinite(tgt.y)) return null;
    const dx = tgt.x - a.x;
    const dist = Math.abs(dx);
    const vertical = Math.abs((tgt.y - 0.40) - (a.y - 0.45));
    if(dist < 2.2 || dist > 8.6 || vertical > 1.05) return null;
    const dir = dx < 0 ? -1 : 1;
    for(let d=0.38; d<dist-0.48; d+=0.28){
      const x = a.x + dir*d;
      if(alienCollidesAt(a,x,a.y,getTile)) return null;
      const floorTile = readTile(getTile,Math.floor(x),Math.floor(a.y+0.10));
      if(!isSolid(floorTile) || floorTile === T.LAVA) return null;
    }
    return {dir,dist};
  }
  function tryStartMolekinCharge(a,team,tgt,getTile){
    if(!isMolekinTeam(team) || !a || a.moleCharge || !molekinChargeRole(a.role || 'rusher')) return false;
    const now=nowMs();
    const last=Number(a.lastMoleChargeAt)||0;
    if(last>0 && now-last<2300) return false;
    const lane=molekinChargeLane(a,tgt,getTile);
    if(!lane) return false;
    const threat=unitThreatLevel(team,a);
    const grade=unitGrade(team,a);
    a.facing=lane.dir;
    a.vx=0;
    a.moleCharge={
      phase:'windup',t:0.34,elapsed:0,dir:lane.dir,traveled:0,maxDist:Math.min(10,lane.dist+0.9),
      speed:7.6+Math.min(3.0,threat*0.055)+grade*0.55,
      damage:Math.max(3,Math.round((7+Math.min(8,threat*0.28))*(Number(a.damageMult)||1))),
      target:tgt,hit:false,ghost:false
    };
    a.lastMoleChargeAt=now;
    a.attackCd=Math.max(Number(a.attackCd)||0,1.25);
    play('warning',{x:a.x,y:a.y-0.5});
    return true;
  }
  function chargeTouchesPartyTarget(a,tgt){
    if(!a || !tgt || tgt.dead || !Number.isFinite(tgt.x) || !Number.isFinite(tgt.y)) return false;
    const scale=unitHitboxScale(a);
    const targetHalf=Math.max(0.30,(Number(tgt.w)||0.70)*0.5);
    return Math.abs(a.x-tgt.x)<=0.34*scale+targetHalf && Math.abs((a.y-0.45)-(tgt.y-0.40))<=1.08;
  }
  function enterMolekinChargeRecovery(a,c,hit){
    c.phase='recover'; c.t=hit?0.46:0.34; c.hit=!!hit;
    a.vx=(a.vx||0)*(hit?-0.18:0.22);
    a.attackCd=Math.max(Number(a.attackCd)||0,hit?1.25:0.85);
  }
  function updateMolekinCharge(a,team,dt,player,getTile){
    const c=a && a.moleCharge;
    if(!c) return false;
    const step=Math.max(0,Math.min(0.08,Number(dt)||0));
    a.facing=c.dir<0?-1:1;
    if(c.ghost) return true;
    if(c.phase==='windup'){
      a.vx=(a.vx||0)*Math.max(0,1-step*13);
      c.t-=step;
      moveAlien(a,step,getTile);
      if(c.t<=0){ c.phase='rush'; c.t=0.90; c.elapsed=0; play('thud',{x:a.x,y:a.y}); }
      return true;
    }
    if(c.phase==='recover'){
      c.t-=step;
      a.vx=(a.vx||0)*Math.max(0,1-step*9);
      moveAlien(a,step,getTile);
      if(c.t<=0) a.moleCharge=null;
      return true;
    }
    c.t-=step;
    c.elapsed+=step;
    const speed=c.speed*(0.62+0.38*Math.min(1,c.elapsed/0.20));
    const distance=speed*step;
    const pieces=Math.max(1,Math.min(5,Math.ceil(distance/0.18)));
    const chargeTargets=livePartyTargets(player);
    if(c.target && !c.target.dead){
      const preferredIndex=chargeTargets.indexOf(c.target);
      if(preferredIndex>0) chargeTargets.unshift(chargeTargets.splice(preferredIndex,1)[0]);
      else if(preferredIndex<0) chargeTargets.unshift(c.target);
    }
    for(let i=0;i<pieces;i++){
      const dx=c.dir*distance/pieces;
      const nx=a.x+dx;
      const floorTile=readTile(getTile,Math.floor(nx),Math.floor(a.y+0.10));
      if(alienCollidesAt(a,nx,a.y,getTile) || !isSolid(floorTile) || floorTile===T.LAVA){
        enterMolekinChargeRecovery(a,c,false);
        burst(a.x+c.dir*0.30,a.y-0.35,'common');
        play('thud',{x:a.x,y:a.y});
        return true;
      }
      a.x=nx;
      a.vx=c.dir*speed;
      c.traveled+=Math.abs(dx);
      const tgt=chargeTargets.find(body=>chargeTouchesPartyTarget(a,body));
      if(tgt){
        hurtPartyTarget(tgt,c.damage,{srcX:a.x-c.dir*0.55,srcY:a.y-0.35,kb:8.4,kbY:-2.4,invulMs:620,cause:'molekin_invasion'});
        a.lastChargeHitAt=nowMs();
        burst(tgt.x,tgt.y-0.35,'rare');
        play('thud',{x:tgt.x,y:tgt.y});
        enterMolekinChargeRecovery(a,c,true);
        return true;
      }
    }
    if(c.t<=0 || c.traveled>=c.maxDist) enterMolekinChargeRecovery(a,c,false);
    return true;
  }
  function fireMolekinAttack(a,team,player,getTile,setTile,ctx,opts){
    opts = opts || {};
    const threat = unitThreatLevel(team,a);
    const weaponTier = unitWeaponTier(team,a);
    const weapon = moleWeaponProfile(a);
    const role = a && a.role || 'rusher';
    const tgt = nearestPartyMember(a.x,a.y,player);
    const tileAim = Number.isFinite(opts.aimX) && Number.isFinite(opts.aimY);
    if(!tileAim && tryStartMolekinCharge(a,team,tgt,getTile)){
      return {charge:true,clear:true,blocked:false,x:tgt.x,y:tgt.y};
    }
    const ox = a.x + (a.facing || 1) * 0.24;
    const oy = a.y - 0.58;
    let aimX, aimY;
    if(tileAim){
      aimX = opts.aimX; aimY = opts.aimY;
    } else {
      const wobble = Math.min(0.68, Math.max(0, 1 - (opts.aim || 0.74)) * 1.35);
      aimX = (Number.isFinite(tgt.vx) ? tgt.x + tgt.vx * 0.10 : tgt.x) + randRange(-wobble,wobble);
      aimY = (Number.isFinite(tgt.vy) ? tgt.y - 0.42 + tgt.vy * 0.05 : tgt.y - 0.42) + randRange(-wobble,wobble);
    }
    const weaponBoost = 1 + weaponTier * 0.07;
    const dmgMult = (Number.isFinite(opts.damageMult) ? opts.damageMult : 1) * (Number(a.damageMult) || 1) * weaponBoost;
    const heavy = !!weapon.heavy || role === 'sniper' || role === 'sapper' || dmgMult >= 1.35 || weaponTier >= 2;
    const dx = aimX - ox;
    const projectileSpeed=(7.8 + weaponTier * 0.7)*(Number(weapon.speed)||1);
    const gravity=MOLE_SHOT_GRAVITY*(Number(weapon.gravity)||1);
    const flight = clamp(Math.abs(dx) / projectileSpeed,0.26,1.32);
    const shot = {
      id:moleShotSeq++, team, owner:a, target:tileAim ? null : tgt,
      x:ox, y:oy,
      vx:dx / flight,
      vy:(aimY - oy - 0.5 * gravity * flight * flight) / flight,
      age:0, life:Math.min(2.2,flight + 0.72), spin:Math.random()*Math.PI*2,
      radius:(heavy ? 0.22 : 0.17)*(Number(weapon.radius)||1),
      damage:Math.max(1,Math.round((4 + Math.min(7,Math.floor(threat/4))) * dmgMult * (Number(weapon.damage)||1))),
      terrainDamage:(5.6 + Math.min(6.4,threat*0.28)) * dmgMult * (Number(weapon.terrain)||1),
      gravity, hazardChance:Number(weapon.hazard)||0,
      heavy, weaponTier, weaponType:String(a.weaponType||'stone'), breach:!!opts.breach, tileAim,
      aimX, aimY, ghost:false
    };
    moleShots.push(shot);
    while(moleShots.length > MOLE_SHOT_CAP) moleShots.shift();
    a.lastShotAt = nowMs();
    play('swing',{x:a.x,y:a.y-0.5});
    return shot;
  }
  function livePartyTargets(player){
    const out=[];
    if(player && !player.dead && Number.isFinite(player.x) && Number.isFinite(player.y)) out.push(player);
    const bodies=(typeof MM!=='undefined' && MM.coopBodies) || null;
    if(Array.isArray(bodies)){
      for(const b of bodies){
        if(!b || b.dead || typeof b.hurt!=='function' || !Number.isFinite(b.x) || !Number.isFinite(b.y) || out.includes(b)) continue;
        out.push(b);
      }
    }
    return out;
  }
  function moleShotTouchesTarget(s,tgt){
    if(!s || !tgt || tgt.dead) return false;
    const hw=Math.max(0.30,(Number(tgt.w)||0.70)*0.5)+(s.radius||0.17);
    const hh=Math.max(0.42,(Number(tgt.h)||0.95)*0.5)+(s.radius||0.17);
    return Math.abs(s.x-tgt.x)<=hw && Math.abs(s.y-(tgt.y-0.40))<=hh;
  }
  // A molekin clod is a real rock: it sometimes survives the impact whole and
  // lies on the ground as an ordinary throwing stone the hero can pick up and
  // throw right back (heavy shots use denser rock — better odds).
  function maybeDropMoleRock(s){
    if(!s || s.ghost) return;
    if(s.weaponType === 'firepot' || s.weaponType === 'ember' || s.weaponType === 'drill') return;
    if(Math.random()>=(s.heavy?0.42:0.30)) return;
    try{
      const D=MM.drops;
      if(D && D.spawnResource) D.spawnResource(s.x,s.y-0.2,'throwingStone',1,{source:'mole_rock',vy:-1.1});
    }catch(e){}
  }
  function impactMoleShot(s,target,tx,ty,getTile,setTile,ctx){
    if(!s) return;
    const team=s.team;
    if(target){
      hurtPartyTarget(target,s.damage,{srcX:s.x-(s.vx<0?-0.35:0.35),srcY:s.y,kb:s.heavy?4.6:3.3,kbY:-2.4,invulMs:470,cause:'molekin_invasion'});
      if(Math.random()<Math.max(Number(s.hazardChance)||0,s.heavy?0.30:0.10)) tryPlaceMoleHazard(team,floor(s.x),floor(s.y+0.60),target,getTile,setTile,ctx,s.heavy);
      maybeDropMoleRock(s);
      burst(s.x,s.y,s.heavy?'rare':'common');
      play('thud',{x:s.x,y:s.y});
      return;
    }
    const tile=readTile(getTile,tx,ty);
    if(s.breach && isBreachableByTeam(team,tile)){
      const damaged=damageTeamTile(team,tx,ty,s.terrainDamage,getTile,setTile,ctx);
      if(damaged){
        if(Math.random()<Math.max(0.28,Number(s.hazardChance)||0)) tryPlaceMoleHazard(team,tx,ty-1,null,getTile,setTile,ctx,s.heavy);
        triggerTeamSpeech(team,'breach',{speaker:s.owner,x:tx+0.5,y:ty+0.5,cooldown:1850,keyCooldown:6000,override:false});
      }
    }
    maybeDropMoleRock(s);
    burst(s.x,s.y,s.heavy?'rare':'common');
    play('thud',{x:s.x,y:s.y});
  }
  function updateMoleShots(dt,player,getTile,setTile,ctx){
    const frameDt=Math.max(0,Math.min(0.08,Number(dt)||0));
    if(!frameDt) return;
    const targets=livePartyTargets(player);
    for(let i=moleShots.length-1;i>=0;i--){
      const s=moleShots[i];
      if(!s || s.ghost) continue;
      s.age=(s.age||0)+frameDt;
      s.life-=frameDt;
      let remove=s.life<=0;
      const distance=Math.hypot(s.vx||0,s.vy||0)*frameDt;
      const pieces=Math.max(1,Math.min(6,Math.ceil(distance/0.18)));
      for(let step=0;step<pieces && !remove;step++){
        const d=frameDt/pieces;
        s.vy=(s.vy||0)+(Number(s.gravity)||MOLE_SHOT_GRAVITY)*d;
        s.x+=(s.vx||0)*d;
        s.y+=(s.vy||0)*d;
        s.spin=(s.spin||0)+(s.vx||0)*d*0.9;
        let target=null;
        for(const tgt of targets){ if(moleShotTouchesTarget(s,tgt)){ target=tgt; break; } }
        if(target){ impactMoleShot(s,target,0,0,getTile,setTile,ctx); remove=true; break; }
        const tx=floor(s.x),ty=floor(s.y);
        const tile=readTile(getTile,tx,ty);
        if(isSolid(tile) || tile===T.LAVA){ impactMoleShot(s,null,tx,ty,getTile,setTile,ctx); remove=true; break; }
      }
      if(remove) moleShots.splice(i,1);
    }
  }
  function canPlaceBarricadeAt(tx,ty,player,team,getTile){
    const t = readTile(getTile,tx,ty);
    if(!isReplaceableNaturalOpenTile(t,false) || t === T.WATER) return false;
    if(authoritativeBodyBlocksCell(tx,ty)) return false;
    const px = player && Number.isFinite(player.x) ? player.x : 0;
    const py = player && Number.isFinite(player.y) ? player.y : 0;
    if(Math.hypot((tx+0.5)-px,(ty+0.5)-py) < 2.4) return false;
    for(const other of (team && team.aliens) || []){
      if(!other || other.dead || other.hp <= 0) continue;
      if(Math.abs(other.x-(tx+0.5)) < 0.75 && other.y > ty - 0.1 && other.y < ty + 1.9) return false;
    }
    return true;
  }
  function placeBarricadeTile(team,tx,ty,getTile,setTile,ctx){
    const profile = profileFor(team);
    if(!Array.isArray(team.builtTiles)) team.builtTiles = [];
    if(team.builtTiles.length >= profile.buildCap) return false;
    if(authoritativeBodyBlocksCell(tx,ty)) return false; // re-check at the write boundary
    const old = readTile(getTile,tx,ty);
    if(!writeTile(setTile,tx,ty,T.ALIEN_BIOMASS)) return false;
    wakeTileChanged(ctx,tx,ty,old,T.ALIEN_BIOMASS);
    team.builtTiles.push({x:floor(tx),y:floor(ty)});
    burst(tx+0.5,ty+0.5,'common');
    markHostSave(ctx);
    return true;
  }
  function canPlaceMoleVentAt(tx,ty,player,team,getTile){
    const t = readTile(getTile,tx,ty);
    if(t !== T.AIR && !isReplaceableNaturalOpenTile(t,false) && t !== T.STEAM) return false;
    const below = readTile(getTile,tx,ty+1);
    if(below === T.WATER || below === T.LAVA || !isSolid(below)) return false;
    const px = player && Number.isFinite(player.x) ? player.x : 0;
    const py = player && Number.isFinite(player.y) ? player.y : 0;
    if(Math.hypot((tx+0.5)-px,(ty+0.5)-py) < 2.2) return false;
    for(const other of (team && team.aliens) || []){
      if(!other || other.dead || other.hp <= 0) continue;
      if(Math.abs(other.x-(tx+0.5)) < 0.65 && other.y > ty - 0.1 && other.y < ty + 1.9) return false;
    }
    return true;
  }
  function placeMoleVentTile(team,tx,ty,getTile,setTile,ctx){
    const profile = profileFor(team);
    if(!Array.isArray(team.builtTiles)) team.builtTiles = [];
    if(team.builtTiles.length >= profile.buildCap) return false;
    const old = readTile(getTile,tx,ty);
    const tile = Math.random() < 0.18 ? T.FUEL_GAS : T.HOT_AIR;
    if(!writeTile(setTile,tx,ty,tile)) return false;
    wakeTileChanged(ctx,tx,ty,old,tile);
    team.builtTiles.push({x:floor(tx),y:floor(ty),tile});
    burst(tx+0.5,ty+0.5,'rare');
    markHostSave(ctx);
    return true;
  }
  // Solid climbing scaffold both teams can fabricate when a route needs a ramp:
  // aliens extrude biomass, molekin pack burrow earth. Separate budget from the
  // engineer barricade cap so combat cover is never starved by climbing.
  function canPlaceRampAt(tx,ty,player,team,getTile){
    const t = readTile(getTile,tx,ty);
    if(!isReplaceableNaturalOpenTile(t,false) || t === T.WATER) return false;
    if(authoritativeBodyBlocksCell(tx,ty)) return false;
    const px = player && Number.isFinite(player.x) ? player.x : 0;
    const py = player && Number.isFinite(player.y) ? player.y : 0;
    if(Math.hypot((tx+0.5)-px,(ty+0.5)-py) < 1.8) return false;
    for(const other of (team && team.aliens) || []){
      if(!other || other.dead || other.hp <= 0) continue;
      // wide enough to cover the builder's own hitbox: fabricating a block
      // into a body embeds and freezes the unit
      if(Math.abs(other.x-(tx+0.5)) < 0.82 && other.y > ty - 0.1 && other.y < ty + 1.9) return false;
    }
    return true;
  }
  function placeRampTile(team,tx,ty,getTile,setTile,ctx){
    const profile = profileFor(team);
    if(!Array.isArray(team.builtTiles)) team.builtTiles = [];
    if((team.rampTiles|0) >= (profile.rampBudget||0)) return false;
    if(authoritativeBodyBlocksCell(tx,ty)) return false; // close validation/write races
    const tile = isMolekinTeam(team) ? T.DIRT : T.ALIEN_BIOMASS;
    const old = readTile(getTile,tx,ty);
    if(!writeTile(setTile,tx,ty,tile)) return false;
    wakeTileChanged(ctx,tx,ty,old,tile);
    team.builtTiles.push({x:floor(tx),y:floor(ty),tile,ramp:true});
    team.rampTiles = (team.rampTiles|0) + 1;
    burst(tx+0.5,ty+0.5,isMolekinTeam(team) ? 'rare' : 'common');
    markHostSave(ctx);
    return true;
  }
  function cleanupBuiltTiles(team,getTile,setTile,ctx){
    if(!team || !Array.isArray(team.builtTiles) || !team.builtTiles.length) return;
    for(const bt of team.builtTiles){
      const t = readTile(getTile,bt.x,bt.y);
      const ownedMoleVent = isMolekinTeam(team) && (t === T.HOT_AIR || t === T.FUEL_GAS || t === T.STEAM);
      const ownedAlienWall = !isMolekinTeam(team) && t === T.ALIEN_BIOMASS;
      const ownedRamp = bt.ramp && bt.tile != null && t === bt.tile;
      if((ownedAlienWall || ownedMoleVent || ownedRamp) && writeTile(setTile,bt.x,bt.y,T.AIR)){
        wakeTileChanged(ctx,bt.x,bt.y,t,T.AIR);
      }
    }
    team.builtTiles.length = 0;
    team.rampTiles = 0;
  }
  function viewportContains(viewport,x,y,pad){
    if(!viewport || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return false;
    const x0 = Number(viewport.x0), y0 = Number(viewport.y0), x1 = Number(viewport.x1), y1 = Number(viewport.y1);
    if(!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return false;
    const p = Math.max(0, Number(pad) || 0);
    return x >= Math.min(x0,x1) - p && x <= Math.max(x0,x1) + p && y >= Math.min(y0,y1) - p && y <= Math.max(y0,y1) + p;
  }
  function teamContactPoints(team){
    const pts = [];
    if(team && Number.isFinite(Number(team.x)) && Number.isFinite(Number(team.y))) pts.push({x:Number(team.x),y:Number(team.y)});
    const l = team && team.lander;
    if(l && !l.invisible && Number.isFinite(Number(l.x)) && Number.isFinite(Number(l.y))) pts.push({x:Number(l.x),y:Number(l.y)});
    const b = team && team.burrow;
    if(b){
      if(Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.targetY))) pts.push({x:Number(b.x),y:Number(b.targetY)});
      if(Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y))) pts.push({x:Number(b.x),y:Number(b.y)});
    }
    for(const a of (team && team.aliens) || []){
      if(!a || a.dead || a.hp <= 0 || !Number.isFinite(Number(a.x)) || !Number.isFinite(Number(a.y))) continue;
      pts.push({x:Number(a.x),y:Number(a.y)-0.45});
    }
    return pts;
  }
  function teamInActiveView(team,player,ctx){
    const pts = teamContactPoints(team);
    if(!pts.length) return false;
    const viewport = ctx && ctx.viewport;
    if(viewport && Number.isFinite(Number(viewport.x0)) && Number.isFinite(Number(viewport.y0)) && Number.isFinite(Number(viewport.x1)) && Number.isFinite(Number(viewport.y1))){
      return pts.some(p=>viewportContains(viewport,p.x,p.y,OFFSCREEN_VIEW_PAD));
    }
    const px = Number(player && player.x), py = Number(player && player.y);
    if(!Number.isFinite(px) || !Number.isFinite(py)) return false;
    const radius = Math.max(24, Number(ctx && ctx.activeViewRadius) || OFFSCREEN_FALLBACK_RADIUS);
    const r2 = radius * radius;
    return pts.some(p=>{
      const dx = p.x - px, dy = p.y - py;
      return dx * dx + dy * dy <= r2;
    });
  }
  function shouldDespawnOffscreenTeam(team,player,ctx,dayFloat){
    if(!team || team.state === 'defeated' || team.state === 'retreat' || team.ruinCommanderKey) return false;
    const day = Number.isFinite(Number(dayFloat)) ? Number(dayFloat) : currentDayInfo().dayFloat;
    if(!Number.isFinite(day)) return false;
    if(teamInActiveView(team,player,ctx)){
      team.lastSeenDay = day;
      team.lostContactDay = 0;
      return false;
    }
    if(!Number.isFinite(Number(team.lastSeenDay))) team.lastSeenDay = day;
    if(!Number.isFinite(Number(team.lostContactDay)) || team.lostContactDay <= 0) team.lostContactDay = Number(team.lastSeenDay);
    const awayDays = day - Math.max(Number(team.lastSeenDay) || day, Number(team.lostContactDay) || day);
    return awayDays >= OFFSCREEN_DESPAWN_DAYS - 0.0001;
  }
  function despawnOffscreenTeam(team,getTile,setTile,ctx){
    if(!team) return false;
    cleanupBuiltTiles(team,getTile,setTile,ctx);
    brains.delete(team.id);
    const idx = teams.indexOf(team);
    if(idx >= 0) teams.splice(idx,1);
    saveLocal();
    markHostSave(ctx);
    return true;
  }
  function cleanupOffscreenTeams(player,getTile,setTile,ctx,dayFloat){
    let changed = false;
    for(let i=teams.length-1;i>=0;i--){
      const team = teams[i];
      if(shouldDespawnOffscreenTeam(team,player,ctx,dayFloat)){
        changed = despawnOffscreenTeam(team,getTile,setTile,ctx) || changed;
      }
    }
    return changed;
  }
  function teamHooks(team,player,getTile,setTile,ctx){
    return {
      fire:(a,opts)=>isMolekinTeam(team) ? fireMolekinAttack(a,team,player,getTile,setTile,ctx,opts) : fireAlienLaser(a,team,player,getTile,setTile,ctx,opts),
      heal:(a,target,amount)=>healAlien(team,a,target,amount),
      repairAtLander:(a,amount)=>isMolekinTeam(team) ? repairMolekinAtBurrow(team,a,amount) : repairAlienAtLander(team,a,amount),
      unstuck:(a,opts)=>longSpeechActive(a) ? false : unstuckAlien(team,a,opts,getTile,setTile,ctx),
      extract:(a,opts)=>longSpeechActive(a) ? false : beginExtraction(team,a,opts,getTile,setTile,ctx),
      tileAttack:(a,tx,ty,mult)=>{
        burst(tx+0.5,ty+0.5,isMolekinTeam(team) ? 'rare' : 'common');
        const threat = unitThreatLevel(team,a);
        const base = isMolekinTeam(team) ? 6.0 : 4.2;
        const damaged = damageTeamTile(team,tx,ty,(base + Math.min(5.4,threat*(isMolekinTeam(team) ? 0.28 : 0.20))) * Math.max(1, mult || 1),getTile,setTile,ctx);
        if(damaged){
          triggerTeamSpeech(team,'breach',{speaker:a,x:tx+0.5,y:ty+0.5,cooldown:1900,keyCooldown:6200,override:false});
        }
        return damaged;
      },
      isBreachableTile:(tx,ty)=>isBreachableByTeam(team,readTile(getTile,tx,ty)),
      canBuildAt:(tx,ty)=>isMolekinTeam(team) ? canPlaceMoleVentAt(tx,ty,player,team,getTile) : canPlaceBarricadeAt(tx,ty,player,team,getTile),
      canBuildRampAt:(tx,ty)=>canPlaceRampAt(tx,ty,player,team,getTile),
      buildRamp:(a,tx,ty)=>{
        const built = placeRampTile(team,tx,ty,getTile,setTile,ctx);
        if(built){
          triggerTeamSpeech(team,'build',{speaker:a,x:tx+0.5,y:ty+0.5,cooldown:2600,keyCooldown:9000,override:false});
        }
        return built;
      },
      build:(a,tx,ty)=>{
        const built = isMolekinTeam(team) ? placeMoleVentTile(team,tx,ty,getTile,setTile,ctx) : placeBarricadeTile(team,tx,ty,getTile,setTile,ctx);
        if(built){
          triggerTeamSpeech(team,'build',{speaker:a,x:tx+0.5,y:ty+0.5,cooldown:2200,keyCooldown:7600,override:false});
        }
        return built;
      },
      onModeChange:(mode)=>{
        if(mode === 'siege'){
          say(isMolekinTeam(team) ? 'Kretoludzie przechodza do rycia oblezniczego: rozgrzewaja oslony bohatera.' : 'Obcy przechodza do oblezenia: celuja w oslony bohatera.');
          triggerTeamSpeech(team,'siege',{force:true,cooldown:1800,keyCooldown:9000});
        }
      }
    };
  }
  function isFlyingUnit(a){
    return !!(a && (a.mobility === 'jetpack' || a.mobility === 'winged' || a.mobility === 'hover'));
  }
  function updateFlyingAlien(a,dt,tgt,intent,speed,getTile,dread,speakingLong){
    const step=Math.max(0,Math.min(0.08,Number(dt)||0));
    const target=tgt || {x:a.x,y:a.y+1.5};
    const flutter=a.mobility === 'winged' ? 0.42 : (a.mobility === 'hover' ? 0.24 : 0.16);
    const hoverHeight=a.giant ? 2.4 : (a.isPet ? 1.65 : 2.05);
    const hoverY=target.y-hoverHeight+Math.sin(nowMs()*0.0035+(a.phase||0))*flutter;
    const commanded=dread ? dread.awayX : (speakingLong ? 0 : (intent && Number(intent.moveX)||0));
    const fallback=target.x>a.x+0.35?1:(target.x<a.x-0.35?-1:0);
    const desiredX=(commanded || fallback)*speed*(dread?1.25:0.88);
    const desiredY=clamp((hoverY-a.y)*2.1,-speed*0.82,speed*0.82);
    a.vx+=(desiredX-(a.vx||0))*Math.min(1,step*3.8);
    a.vy+=(desiredY-(a.vy||0))*Math.min(1,step*3.2);
    const pieces=Math.max(1,Math.min(5,Math.ceil(Math.max(Math.abs(a.vx||0),Math.abs(a.vy||0))*step/0.22)));
    for(let i=0;i<pieces;i++){
      const d=step/pieces;
      const nx=a.x+(a.vx||0)*d;
      if(!alienCollidesAt(a,nx,a.y,getTile)) a.x=nx;
      else { a.vx*=-0.18; a.vy=Math.min(a.vy||0,-1.4); }
      const ny=clamp(a.y+(a.vy||0)*d,WORLD_TOP+2,WORLD_BOTTOM-2);
      if(!alienCollidesAt(a,a.x,ny,getTile)) a.y=ny;
      else { a.vy*=-0.25; a.x+=(a.facing||1)*0.03; }
    }
    a.onGround=false;
    a.facing=target.x>=a.x?1:-1;
  }
  function tryGiantStomp(a,team,tgt,dist,threat){
    if(!a || !a.giant || !tgt || dist>2.45 || (a.stompCd||0)>0) return false;
    const damage=Math.max(5,Math.round((10+Math.min(12,threat*0.32))*(Number(a.damageMult)||1)));
    hurtPartyTarget(tgt,damage,{srcX:a.x,srcY:a.y-0.35,kb:8.8,kbY:-4.2,invulMs:680,cause:isMolekinTeam(team)?'molekin_invasion':'alien_invasion'});
    a.stompCd=3.0+Math.random()*1.8;
    a.attackCd=Math.max(Number(a.attackCd)||0,1.1);
    a.lastStompAt=nowMs();
    burst(a.x,a.y-0.15,'epic');
    play('thud',{x:a.x,y:a.y});
    return true;
  }
  // Physics + touch damage only: all decisions (where to go, when to shoot,
  // when to hide or flee) come from the squad brain via a._ai.intent.
  function updateAlien(a,team,dt,player,getTile,setTile,ctx){
    if(!a || a.dead || a.hp <= 0) return;
    const profile = profileFor(team);
    const intent = a._ai && a._ai.intent ? a._ai.intent : null;
    const threat = unitThreatLevel(team,a);
    const grade = unitGrade(team,a);
    // melee and facing track the NEAREST party member — host hero or a guest body
    const tgt = nearestPartyMember(a.x,a.y,player);
    const px = tgt && Number.isFinite(tgt.x) ? tgt.x : a.x;
    const py = tgt && Number.isFinite(tgt.y) ? tgt.y : a.y;
    const dx = px - a.x;
    const dy = (py - 0.4) - (a.y - 0.45);
    const dist = Math.hypot(dx,dy) || 1;
    const speakingLong = longSpeechActive(a);
    a.attackCd = Math.max(0, (a.attackCd || 0) - dt);
    a.stompCd = Math.max(0, (a.stompCd || 0) - dt);
    if(alienCollidesAt(a,a.x,a.y,getTile)){
      a.buriedT = (a.buriedT || 0) + dt;
      unstuckAlien(team,a,{dir:intent && intent.moveX ? intent.moveX : (a.facing || (dx >= 0 ? 1 : -1)), reason:'buried', embedded:true},getTile,setTile,ctx);
    } else {
      a.buriedT = 0;
    }
    const speed = (profile.baseSpeed + Math.min(1.4, threat * 0.055) + grade * 0.08) * (Number(a.speedMult) || 1) * (intent ? (intent.speedMult || 1) : 1);
    // Ghost dread (ghost_host.js publishes MM.ghostAura from ACTIVE watchers): not
    // even a landing party keeps its nerve with a phantom overhead — the squad
    // breaks formation and runs, and the rout gate below holds their fire.
    const dread = MM.ghostDreadAt ? MM.ghostDreadAt(a.x, a.y) : null;
    if(dread){
      a._ghostSpookUntil = (typeof performance!=='undefined' ? performance.now() : Date.now()) + 900;
      a.state = 'rout';
      if(a.moleCharge) a.moleCharge=null;
      if(a.alienCharge) a.alienCharge=null;
    }
    if(!dread && isMolekinTeam(team) && a.moleCharge && updateMolekinCharge(a,team,dt,player,getTile)) return;
    if(!dread && isAlienTeam(team) && a.alienCharge && updateAlienLaserCharge(a,team,dt,player,getTile,setTile,ctx)) return;
    if(!dread) tryGiantStomp(a,team,tgt,dist,threat);
    if(isFlyingUnit(a)){
      updateFlyingAlien(a,dt,tgt,intent,speed,getTile,dread,speakingLong);
      return;
    }
    // Immediate danger interrupts a speech pause: a haunted alien flees first
    // and can finish its sentence after the spirit is gone.
    const desired = dread ? dread.awayX * speed * 1.2 : (speakingLong ? 0 : (intent ? intent.moveX * speed : 0));
    // Weak air control: jump-kick impulses must carry across gaps instead of
    // decaying back to walk speed mid-flight.
    if(speakingLong && !dread && a.onGround) a.vx = 0;
    else a.vx += (desired - (a.vx || 0)) * Math.min(1, dt * (a.onGround ? 5.8 : 1.5));
    if(!speakingLong && intent && intent.jump && a.onGround){
      const boost = Math.max(1, Math.min(1.85, Number(intent.jumpBoost) || 1));
      a.vy = -profile.jumpVel * boost * (Number(a.jumpMult) || 1);
      if(intent.moveX){
        // every takeoff needs a matched forward impulse: wall contact damps vx
        // to ~0 and weak air control cannot rebuild it, so un-kicked jumps
        // would rise and land in place instead of mounting the ledge
        const kick = intent.jumpKick ? (profile.jumpKick || speed * 1.6) : speed * 0.85;
        a.vx = intent.moveX * Math.max(Math.abs(a.vx || 0), kick);
      }
      a.onGround = false;
      intent.jump = false;
      intent.jumpBoost = 1;
      intent.jumpKick = false;
    } else if(!speakingLong && a.onGround && intent && intent.moveX !== 0){
      const aheadX = a.x + intent.moveX * 0.42;
      if(alienCollidesAt(a,aheadX,a.y,getTile)){
        // auto-hop; a wall that still blocks at head height gets a full jump,
        // and one the jump cannot top at all gets none — bouncing endlessly at
        // a cliff base is the brain's cue to dig, ramp or relocate instead
        const tall = alienCollidesAt(a,aheadX,a.y-1.05,getTile);
        const hopeless = tall && alienCollidesAt(a,aheadX,a.y-2.05,getTile);
        if(!hopeless){
          a.vy = -profile.jumpVel * (tall ? 1.0 : 0.85) * (Number(a.jumpMult) || 1);
          a.vx = intent.moveX * Math.max(Math.abs(a.vx || 0), speed * 0.7);
          a.onGround = false;
        }
      }
    }
    if(dread) a.attackCd = Math.max(a.attackCd, 0.6); // routed troops don't press the attack
    if(!dread && !isMolekinTeam(team) && dist < profile.meleeRange && Math.abs(dy) < 1.0 && a.attackCd <= 0.15){
      hurtPartyTarget(tgt, Math.max(1,Math.round(3 * (Number(a.damageMult) || 1))), {srcX:a.x,srcY:a.y,kb:2.4,invulMs:500,cause:'alien_invasion'});
      a.attackCd = 0.55;
    }
    const steps = Math.max(1, Math.min(4, Math.ceil(Math.max(Math.abs(a.vx || 0), Math.abs(a.vy || 0)) * dt / 0.25)));
    for(let i=0;i<steps;i++) moveAlien(a,dt/steps,getTile);
  }
  function updateLander(team,dt){
    if(!isAlienTeam(team)) return;
    const l = team && team.lander;
    if(!l || l.destroyed || l.landed) return;
    l.phase = (l.phase || 0) + dt * 2.4;
    l.y += (l.vy || 2.8) * dt;
    if(l.y >= l.targetY){
      l.y = l.targetY;
      spawnAliens(team);
      say('Obcy wyszli z ladowiska i namierzaja bohatera.');
      play('laser',l);
    }
  }
  function markBurrowCrack(team,getTile,setTile,ctx,stage){
    const b = team && team.burrow;
    if(!b) return;
    const tx = floor(b.x);
    const y = floor(b.targetY) - 1;
    const spread = Math.min(2, Math.max(0, stage|0));
    let changed = 0;
    for(let dx=-spread; dx<=spread; dx++){
      const x = tx + dx;
      const old = readTile(getTile,x,y);
      if(old !== T.AIR && !isReplaceableNaturalOpenTile(old,false)) continue;
      const tile = stage >= 2 && Math.random() < 0.65 ? T.HOT_AIR : T.STEAM;
      if(writeTile(setTile,x,y,tile)){
        wakeTileChanged(ctx,x,y,old,tile);
        changed++;
      }
    }
    if(changed) markHostSave(ctx);
  }
  function updateBurrowTeam(team,dt,getTile,setTile,ctx){
    if(!isMolekinTeam(team) || team.state !== 'burrowing') return;
    const b = team.burrow;
    if(!b){ spawnMolekin(team,getTile,setTile,ctx); return; }
    b.phase = (b.phase || 0) + dt * 4.2;
    const speed = 0.36 + Math.min(0.16, teamGrade(team) * 0.035 + teamWeaponTier(team) * 0.025);
    b.progress = Math.min(1, (Number(b.progress) || 0) + dt * speed);
    if(!b.warned && b.progress >= 0.18){
      b.warned = true;
      say('Pod ziemia cos ryje tunel. Czuc goracy popiol ze wschodu.');
      play('warning',team);
    }
    const stage = b.progress >= 0.72 ? 2 : (b.progress >= 0.38 ? 1 : 0);
    if(stage > (b.crackStage || 0)){
      b.crackStage = stage;
      markBurrowCrack(team,getTile,setTile,ctx,stage);
    }
    if(b.progress >= 1){
      spawnMolekin(team,getTile,setTile,ctx);
      say('Kretoludzie wyszli z tunelu i ida po bohatera.');
      play('flame',team);
    }
  }
  function defeatTeam(team,player,ctx,getTile,setTile){
    if(!team || team.state === 'defeated') return false;
    team.state = 'defeated';
    team.defeatedAt = Date.now();
    cleanupBuiltTiles(team,getTile,setTile,ctx);
    brains.delete(team.id);
    const reward = Math.max(60, team.xpReward || 160);
    if(player && typeof player.xp === 'number') player.xp += reward;
    const chests = dropTeamRewardChests(team,player,{ctx,getTile,setTile});
    const chestText = chests.length ? ', zdobyto '+describeChestDrops(chests) : '';
    say('Oddzial '+teamDisplayName(team)+' pokonany: +'+reward+' XP'+chestText+'.');
    play('milestone',team);
    burst(team.x,team.y-1,'epic');
    markHostSave(ctx);
    return true;
  }
  // --- dawn retreat: the 'retreat' state was filtered everywhere but nothing
  // ever SET it. Non-story teams now stand down on the night->day edge (units
  // burst out beam/burrow-style, the sweep below collects the team). The first
  // update after load counts as a dawn when it lands in daylight, so a save
  // carrying an accumulated swarm cleans itself up immediately.
  let lastIsNight = null;
  function beginTeamRetreat(team,ctx){
    if(!team || team.state === 'defeated' || team.state === 'retreat' || team.ruinCommanderKey) return false;
    team.state = 'retreat';
    team.retreatAt = Date.now();
    const beam = isAlienTeam(team) && team.lander && !team.lander.destroyed;
    for(const a of (team.aliens||[])){
      if(!a || a.dead || a.hp <= 0) continue;
      burst(a.x, a.y - 0.4, beam ? 'epic' : 'rare');
    }
    play(beam ? 'beam' : 'dig', {x:team.x, y:team.y});
    brains.delete(team.id);
    markHostSave(ctx);
    return true;
  }
  function maybeDawnRetreat(dayInfo,ctx){
    const night = !!(dayInfo && dayInfo.isNight);
    const dawnEdge = lastIsNight === null ? !night : (lastIsNight && !night);
    lastIsNight = night;
    if(!dawnEdge) return;
    let changed = false;
    for(const team of teams){
      changed = beginTeamRetreat(team,ctx) || changed;
    }
    if(changed) say('Swit przegania najezdzcow: oddzialy wycofuja sie.');
  }
  function updateTeams(dt,player,getTile,setTile,ctx){
    navWorld.getTileFn = getTile;
    const dayInfo = currentDayInfo();
    cleanupOffscreenTeams(player,getTile,setTile,ctx,dayInfo.dayFloat);
    maybeDawnRetreat(dayInfo,ctx);
    let liveForNav = 0;
    for(const team of teams){
      if(!team || team.state === 'defeated' || team.state === 'retreat') continue;
      liveForNav += ((team.aliens && team.aliens.length) || team.alienCount || 0);
    }
    beginAIFrame(Math.max(4, Math.min(12, 2 + Math.ceil(liveForNav / 3))));
    const allUnits = [];
    const now = nowMs();
    for(const team of teams){
      if(!team || team.state === 'defeated' || team.state === 'retreat') continue;
      updateLander(team,dt);
      updateBurrowTeam(team,dt,getTile,setTile,ctx);
      if(isAlienTeam(team) && team.lander && team.lander.destroyed && !team.aliens.length){
        defeatTeam(team,player,ctx,getTile,setTile);
        continue;
      }
      // A unit in transit is out of the squad's hands: it steers nothing, it is
      // not pushed around by separation, and physics must not drag it back down
      // the shaft mid-beam. Everything else about it (hp, speech, being shot)
      // keeps working.
      const steerable = team.aliens.filter(a => a && !a.dead && a.hp > 0 && !a.extract);
      // Off-view squads keep FULL physics (they march, climb and besiege exactly
      // the same) but re-plan at interval cadence: the brain's nav scans + tile
      // probes were the measured ~4ms/frame cost of an unseen night team, paid
      // 240x a second for pathing nobody watches. Accumulated dt keeps every
      // brain timer honest.
      const nearView = teamInActiveView(team,player,ctx);
      if(steerable.length && player){
        const brain = ensureBrain(team);
        if(nearView){
          team._remoteBrainT = 0;
          brain.update(team, steerable, dt, squadPartyTarget(steerable,player), teamHooks(team,player,getTile,setTile,ctx), {now});
        } else {
          team._remoteBrainT = (team._remoteBrainT || 0) + dt;
          if(team._remoteBrainT >= REMOTE_BRAIN_INTERVAL){
            brain.update(team, steerable, team._remoteBrainT, squadPartyTarget(steerable,player), teamHooks(team,player,getTile,setTile,ctx), {now});
            team._remoteBrainT = 0;
          }
        }
      }
      let alive = 0;
      for(const a of team.aliens){
        if(!a) continue;
        // Catch damage integrations that set hp directly instead of routing
        // through damageAt()/blastRadius(). They still receive a real death
        // sequence; restored corpses are already marked dead and stay quiet.
        if((a.dead||a.hp<=0)&&!a.deathFxSpawned) finalizeAlienDeath(team,a,{cause:'external'});
        if(a.dead || a.hp <= 0) continue;
        if(a.extract) updateExtraction(a,team,dt,getTile,ctx);
        else updateAlien(a,team,dt,player,getTile,setTile,ctx);
        if((a.dead||a.hp<=0)&&!a.deathFxSpawned) finalizeAlienDeath(team,a,{cause:'environment'});
        if(nearView) updateAlienSpeech(a,team,now); // bubbles nobody can see cost real time
        if(a.hp > 0 && !a.dead){
          alive++;
          if(!a.extract) allUnits.push(a);
        }
      }
      if(team.state === 'active' && alive <= 0) defeatTeam(team,player,ctx,getTile,setTile);
    }
    updateHeroAwareness(player,now);
    updateAtomicWinterAwareness(player,now);
    // Units shoulder each other (and the hero) aside instead of stacking.
    applySeparation(allUnits, {
      radius:0.30,
      hero:player,
      canOccupy:(u,x,y)=>!alienCollidesAt(u,x,y,getTile)
    });
    for(let i=teams.length-1;i>=0;i--){
      const t = teams[i];
      if(t && t.state === 'defeated' && t.defeatedAt && Date.now() - t.defeatedAt > 5000){
        brains.delete(t.id);
        teams.splice(i,1);
      } else if(t && t.state === 'retreat' && t.retreatAt && Date.now() - t.retreatAt > RETREAT_SWEEP_MS){
        cleanupBuiltTiles(t,getTile,setTile,ctx); // departing raiders take their scaffolding down
        brains.delete(t.id);
        teams.splice(i,1);
      }
    }
  }
  function updateLasers(dt){
    for(let i=lasers.length-1;i>=0;i--){
      lasers[i].t += dt;
      if(lasers[i].t >= lasers[i].life) lasers.splice(i,1);
    }
  }
  function updateDeathFx(dt){
    const step=Math.max(0,Math.min(0.08,Number(dt)||0));
    for(let i=deathFx.length-1;i>=0;i--){
      const fx=deathFx[i];
      if(!fx){ deathFx.splice(i,1); continue; }
      fx.t=Math.max(0,(Number(fx.t)||0)+step);
      if(!fx.stageTriggered&&fx.eventAt>0&&fx.t>=fx.life*fx.eventAt){
        fx.stageTriggered=true;
        emitDeathParticles(fx,1);
      }
      if(fx.t>=fx.life) deathFx.splice(i,1);
    }
  }
  function rememberWorldAccess(getTile,setTile,ctx){
    if(typeof getTile === 'function' || typeof setTile === 'function' || ctx){
      lastWorldAccess = {getTile,setTile,ctx:ctx || {}};
    }
  }
  function tierForChestTile(tile){
    if(tile === T.CHEST_LEGENDARY) return 'legendary';
    if(tile === T.CHEST_EPIC) return 'epic';
    if(tile === T.CHEST_RARE) return 'rare';
    if(tile === T.CHEST_UNCOMMON) return 'uncommon';
    return 'common';
  }
  function describeChestDrops(chests){
    const counts = {common:0, uncommon:0, rare:0, epic:0, legendary:0};
    for(const c of chests){
      const tier=c && counts[c.tier]!==undefined ? c.tier : tierForChestTile(c && c.tile);
      counts[tier]++;
    }
    const parts = [];
    if(counts.legendary) parts.push(counts.legendary+'x legendarna skrzynia');
    if(counts.epic) parts.push(counts.epic+'x epicka skrzynia');
    if(counts.rare) parts.push(counts.rare+'x rzadka skrzynia');
    if(counts.uncommon) parts.push(counts.uncommon+'x niezwykla skrzynia');
    if(counts.common) parts.push(counts.common+'x zwykla skrzynia');
    return parts.join(', ');
  }
  function rewardProfileForTeam(team,player){
    const playerLevel = Math.max(1, Number(team && team.playerLevel) || playerLevelFor(player || null,{}));
    const threat = teamThreatLevel(team);
    const grade = teamGrade(team);
    const weaponTier = teamWeaponTier(team);
    const encounter = normalizeEncounter(team && team.encounter,team && team.horde ? 'swarm' : 'classic');
    // A horde is spectacle, not a fourteen-ticket loot multiplier.
    const size = Math.max(1, Math.min(TEAM_SIZE_REGULAR_MAX, Number(team && team.alienCount) || 1));
    const forcedChance = Number(team && team.forceRewardChance);
    const encounterBonus = encounter === 'colossus' ? 0.14 : (encounter === 'arsenal' ? 0.04 : (encounter === 'wildcard' ? 0.03 : 0));
    const baseDropChance = 0.24 + Math.max(0,playerLevel - 1) * 0.012 + grade * 0.07 + Math.max(0,size - 4) * 0.008 + encounterBonus;
    const dropChance = Number.isFinite(forcedChance)
      ? clamp(forcedChance,0,1)
      : clamp(baseDropChance * (team && team.horde ? 0.82 : 1),0.20,0.82);
    const legendaryChance = clamp(0.005 + Math.max(0,playerLevel - 35) * 0.0015 + grade * 0.006 + Math.max(0,threat - 45) * 0.0006,0.005,0.05);
    const epicChance = clamp(Math.max(0,playerLevel - 12) * 0.006 + grade * 0.025 + Math.max(0,threat - 25) * 0.002,0,0.34);
    const rawRareChance = clamp(0.10 + Math.max(0,playerLevel - 4) * 0.009 + grade * 0.045 + weaponTier * 0.020,0.10,0.50);
    // Reserve at least ten percent of the tier roll for common/uncommon loot;
    // the old additive thresholds exceeded 100% around level 18.
    const rareChance = Math.min(rawRareChance, Math.max(0.08, 0.90 - legendaryChance - epicChance));
    const maxDrops = Math.min(3,1 + (playerLevel >= 25 ? 1 : 0) + (playerLevel >= 45 ? 1 : 0) + (encounter === 'colossus' ? 1 : 0));
    const extraChance = clamp(Math.max(0,playerLevel - 20) * 0.012 + grade * 0.06,0,0.45);
    return {playerLevel,threat,grade,weaponTier,encounter,dropChance,legendaryChance,rareChance,epicChance,maxDrops,extraChance};
  }
  function rollRewardChestTier(team,profile){
    const forced = team && typeof team.forceRewardTier === 'string' ? team.forceRewardTier.toLowerCase() : '';
    if(forced === 'common' || forced === 'uncommon' || forced === 'rare' || forced === 'epic' || forced === 'legendary') return forced;
    // Full ladder on one deterministic roll: a legendary sliver rides on top of
    // the epic chance, and a third of the leftover commons upgrade to uncommon.
    const r = Math.random();
    const legendaryChance = Math.max(0, Number(profile.legendaryChance) || 0);
    if(r < legendaryChance) return 'legendary';
    if(r < legendaryChance + profile.epicChance) return 'epic';
    if(r < legendaryChance + profile.epicChance + profile.rareChance) return 'rare';
    const rest = (r - legendaryChance - profile.epicChance - profile.rareChance)
      / Math.max(0.0001, 1 - legendaryChance - profile.epicChance - profile.rareChance);
    return rest < 0.33 ? 'uncommon' : 'common';
  }
  function dropRewardChestNear(x,y,tier,opts){
    opts = opts || {};
    const spawn=typeof opts.spawnChest==='function' ? opts.spawnChest : (MM.drops && MM.drops.spawnChest);
    if(typeof spawn!=='function') return null;
    let d=null;
    try{ d=spawn(x,y,tier,{source:'invasion',vx:(Math.random()*2-1)*1.8,vy:-(2.5+Math.random()*1.8)}); }catch(e){ d=null; }
    if(!d) return null;
    burst(d.x,d.y,tier === 'epic' || tier === 'legendary' ? 'epic' : (tier === 'rare' ? 'rare' : 'common'));
    return {x:d.x,y:d.y,tier,id:d.id};
  }
  function dropTeamRewardChests(team,player,opts){
    if(!team || team.rewardDropped) return [];
    team.rewardDropped = true;
    const profile = rewardProfileForTeam(team,player);
    team.rewardProfile = profile;
    if(Math.random() > profile.dropChance) return [];
    const drops = [];
    let count = 1;
    while(count < profile.maxDrops && Math.random() < profile.extraChance) count++;
    for(let i=0; i<count; i++){
      const tier = rollRewardChestTier(team,profile);
      const ox = (i - (count - 1) / 2) * 1.6;
      const chest = dropRewardChestNear((Number(team.x) || 0) + ox, (Number(team.y) || 0) - 1, tier, opts);
      if(chest) drops.push(chest);
    }
    if(drops.length){
      play(drops.some(c=>c.tier === 'epic' || c.tier === 'legendary') ? 'golden' : 'chest',drops[0]);
      saveLocal();
    }
    return drops;
  }
  function dropCommanderChest(team,a,opts){
    opts = opts || {};
    const ctx = opts.ctx || lastWorldAccess.ctx || {};
    const spawn=typeof opts.spawnChest==='function' ? opts.spawnChest : (MM.drops && MM.drops.spawnChest);
    if(typeof spawn!=='function') return false;
    const x=Number.isFinite(a&&a.x)?a.x:0, y=Number.isFinite(a&&a.y)?a.y-0.25:0;
    let d=null;
    try{ d=spawn(x,y,'epic',{source:'alien_commander',vx:(Math.random()*2-1)*1.5,vy:-3.5}); }catch(e){ d=null; }
    if(!d) return false;
    burst(d.x,d.y,'epic');
    play('golden',{x:d.x,y:d.y});
    say('Zloty alien commander pokonany. Zostawil zlota skrzynie.');
    saveLocal();
    markHostSave(ctx);
    if(team) team.commanderChestDroppedAt = {x:d.x,y:d.y,t:Date.now(),id:d.id};
    return true;
  }
  function update(dt,player,getTile,setTile,ctx){
    ctx = ctx || {};
    dt = Math.max(0, Math.min(0.08, Number(dt) || 0));
    rememberWorldAccess(getTile,setTile,ctx);
    maybeScheduleNight(player,getTile,setTile,ctx);
    updateTeams(dt,player,getTile,setTile,ctx);
    updateMoleShots(dt,player,getTile,setTile,ctx);
    updateLasers(dt);
    updateDeathFx(dt);
    maybeSave(dt);
  }
  function findTargetAt(tx,ty){
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      if(isAlienTeam(team) && team.lander && landerTileHit(team.lander,tx,ty)) return {team,lander:team.lander};
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0) continue;
        const scale = unitHitboxScale(a);
        if(Math.abs((tx+0.5)-a.x) <= 0.75 * scale && Math.abs((ty+0.5)-(a.y-0.45)) <= 0.95 * scale) return {team,alien:a};
      }
    }
    return null;
  }
  function alienAimY(a){
    return a ? (a.y - 0.45) : 0;
  }
  function invasionTileAt(getTile,x,y){
    try{ return typeof getTile==='function' ? getTile(floor(x),floor(y)) : T.AIR; }catch(e){ return T.AIR; }
  }
  function alienInWater(a,getTile){
    if(!a || typeof getTile!=='function') return false;
    const ay=alienAimY(a);
    return invasionTileAt(getTile,a.x,a.y)===T.WATER || invasionTileAt(getTile,a.x,ay)===T.WATER || invasionTileAt(getTile,a.x,(a.y+ay)*0.5)===T.WATER;
  }
  function alienTargetSnapshot(team,a){
    return {
      kind:isMolekinTeam(team) ? 'molekin' : 'alien',
      id:a.id,
      teamId:team && team.id,
      role:a.role || '',
      form:a.form || '',
      weaponType:a.weaponType || '',
      pet:!!a.isPet,
      giant:!!a.giant,
      x:a.x,
      y:a.y,
      aimY:alienAimY(a),
      tx:floor(a.x),
      ty:floor(alienAimY(a)),
      vx:Number(a.vx) || 0,
      vy:Number(a.vy) || 0,
      hp:Number(a.hp) || 0,
      maxHp:Number(a.maxHp) || 0
    };
  }
  function nearestForEnemy(wx,wy,range,opts){
    if(!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    const r = Math.max(0, Number(range) || 0);
    if(r <= 0) return null;
    const r2 = r * r;
    let bestTeam = null, bestAlien = null, bestD = Infinity;
    const excludeTeamId = opts && opts.excludeTeamId ? String(opts.excludeTeamId) : '';
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      if(excludeTeamId && String(team.id) === excludeTeamId) continue;
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0) continue;
        if(opts && opts.inWater && !alienInWater(a,opts.getTile)) continue;
        const ax = a.x;
        const ay = alienAimY(a);
        const dx = ax - wx, dy = ay - wy;
        const d2 = dx * dx + dy * dy;
        if(d2 > r2 || d2 >= bestD) continue;
        bestD = d2;
        bestTeam = team;
        bestAlien = a;
      }
    }
    return bestAlien ? alienTargetSnapshot(bestTeam, bestAlien) : null;
  }
  function findAlienAtWorld(wx,wy){
    if(!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    let bestTeam = null, bestAlien = null, bestD = Infinity;
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0) continue;
        const scale = unitHitboxScale(a);
        const dx = Math.abs(wx - a.x);
        const dy = Math.abs(wy - alienAimY(a));
        if(dx > 0.82 * scale || dy > 1.02 * scale) continue;
        const d2 = dx * dx + dy * dy;
        if(d2 < bestD){ bestD = d2; bestTeam = team; bestAlien = a; }
      }
    }
    return bestAlien ? {team:bestTeam, alien:bestAlien} : null;
  }
  function finalizeAlienDeath(team,a,opts){
    if(!a) return false;
    opts=opts||{};
    const first=!a.deathFxSpawned;
    a.hp=0;
    a.dead=true;
    a.killedAt=Date.now();
    if(!first) return false;
    spawnDeathFx(team,a,opts);
    if(a.role==='commander'&&isAlienTeam(team)) dropCommanderChest(team,a,opts);
    if(a.giant){
      say((isMolekinTeam(team)?'Kolos kretoludzi':'Obcy kolos')+' runal!');
    }
    if(team&&!opts.suppressReaction){
      triggerTeamSpeech(team,a.role==='commander'?'commanderDown':'allyDown',{
        x:a.x,
        y:a.y,
        avoid:a,
        preferRole:opts.weaponType==='bow'?'sniper':'',
        force:true,
        cooldown:1600,
        keyCooldown:4800
      });
    }
    return true;
  }
  function applyAlienDamage(team,a,amount,flashMs,opts){
    opts = opts || {};
    const taken = clamp(Number(a && a.damageTakenMult) || 1,0.45,1.60);
    const now = nowMs();
    const wasAlive = !!(a && !a.dead && a.hp > 0);
    a.hp -= amount * taken;
    a.hitFlashUntil = now + (flashMs || 120);
    a.lastHitAt = now;
    if(wasAlive && a.hp <= 0){
      finalizeAlienDeath(team,a,opts);
      return true;
    }
    if(wasAlive && a.hp > 0 && a.hp / Math.max(1,a.maxHp || 1) < 0.30){
      triggerTeamSpeech(team,'hurt',{speaker:a,now,cooldown:1700,keyCooldown:6800,override:false});
    }
    return false;
  }
  function damageAtWorld(wx,wy,dmg,opts){
    const hit = findAlienAtWorld(wx,wy);
    if(hit && hit.alien){
      if(opts && typeof opts.onTarget==='function'){
        try{ opts.onTarget(hit.alien,'invasion',isLiving); }catch(e){}
      }
      applyAlienDamage(hit.team,hit.alien,Math.max(0.5, Number(dmg) || 1),120,opts);
      return true;
    }
    return damageAt(floor(wx),floor(wy),dmg,opts);
  }
  function destroyLander(team,lander,opts){
    if(!lander||lander.deathFxSpawned) return false;
    lander.hp=0;
    lander.destroyed=true;
    lander.landed=true;
    spawnLanderDeathFx(team,lander,opts||{});
    return true;
  }
  function damageAt(tx,ty,dmg,opts){
    const hit = findTargetAt(tx,ty);
    if(!hit) return false;
    const amount = Math.max(0.5, Number(dmg) || 1);
    if(hit.alien){
      if(opts && typeof opts.onTarget==='function'){
        try{ opts.onTarget(hit.alien,'invasion',isLiving); }catch(e){}
      }
      applyAlienDamage(hit.team,hit.alien,amount,120,opts);
      return true;
    }
    if(hit.lander){
      hit.lander.hp -= amount;
      if(hit.lander.hp <= 0) destroyLander(hit.team,hit.lander,opts);
      return true;
    }
    return false;
  }
  function attackAt(tx,ty,bonus,opts){
    return damageAt(tx,ty,3 + Math.max(0, Number(bonus) || 0),opts);
  }
  function isLiving(a){
    if(!a || a.dead || !(a.hp>0)) return false;
    return teams.some(team=>team && team.state!=='defeated' && Array.isArray(team.aliens) && team.aliens.includes(a));
  }
  function blastRadius(wx,wy,r,dmg,opts){
    let hits = 0;
    const radius = Math.max(0.5, Number(r) || 1);
    const amount = Math.max(1, Number(dmg) || 6);
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      if(isAlienTeam(team) && team.lander && !team.lander.destroyed && Math.hypot(team.lander.x-wx,team.lander.y-wy) <= radius + 1.8){
        team.lander.hp -= amount;
        if(team.lander.hp <= 0) destroyLander(team,team.lander,opts);
        hits++;
      }
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0) continue;
        if(Math.hypot(a.x-wx,(a.y-0.4)-wy) <= radius){
          applyAlienDamage(team,a,amount,150,opts);
          hits++;
        }
      }
    }
    return hits;
  }
  // Per-role skins: tint = shell, dark = under-shell/limbs, eye = glow,
  // accent = weapon/gear energy color. Flat fills with layered highlights to
  // match the game's chunky art; no shadowBlur (too slow for squads).
  const ROLE_TINTS = {
    rusher:  {tint:'#9edac1', dark:'#48796a', deep:'#2c4f44', eye:'#c9fff2', accent:'#4fe9b5'},
    tank:    {tint:'#b6c6d1', dark:'#586f7c', deep:'#30424b', eye:'#e9fbff', accent:'#77d8ff'},
    commander:{tint:'#ffd86b', dark:'#9b7121', deep:'#4f3510', eye:'#fff8d7', accent:'#fff08a'},
    healer:  {tint:'#d7f7a2', dark:'#6e8f45', deep:'#435c2a', eye:'#f8ffe4', accent:'#9eff70'},
    flanker: {tint:'#8fd4ea', dark:'#3e6d84', deep:'#274a5c', eye:'#dcf7ff', accent:'#54c8ff'},
    orbiter: {tint:'#c0aaf2', dark:'#5d4a90', deep:'#3d2f64', eye:'#efe6ff', accent:'#a67ffb'},
    sniper:  {tint:'#ecc27d', dark:'#8a6a34', deep:'#5c451e', eye:'#fff3d6', accent:'#ffb84e'},
    sapper:  {tint:'#ef9a8b', dark:'#8c4136', deep:'#5e2a22', eye:'#ffe6e0', accent:'#ff7a5c'},
    engineer:{tint:'#aee87f', dark:'#557d35', deep:'#375420', eye:'#f0ffdd', accent:'#8dff4f'}
  };
  function drawHealthBar(ctx,cx,topY,w,frac){
    const f = clamp(frac,0,1);
    ctx.fillStyle = 'rgba(4,8,10,0.62)';
    ctx.fillRect(cx-w/2-0.5, topY-0.5, w+1, 4);
    ctx.fillStyle = f > 0.55 ? '#6dff9e' : (f > 0.28 ? '#ffd45e' : '#ff6d5e');
    ctx.fillRect(cx-w/2, topY, w*f, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(cx-w/2, topY, w*f, 1);
  }
  function drawMoleShotFx(ctx,TILE_SIZE,visible){
    for(const s of moleShots){
      if(!s || !visible(s.x,s.y)) continue;
      const px=s.x*TILE_SIZE,py=s.y*TILE_SIZE;
      const r=TILE_SIZE*clamp(Number(s.radius)||(s.heavy?0.22:0.17),0.09,0.42);
      const weapon=String(s.weaponType||'stone');
      const trail=weapon==='firepot'?'#ff5b22':(weapon==='ember'?'#ffb43d':(weapon==='drill'?'#72ffe0':(weapon==='shrapnel'?'#d8d2c6':(s.heavy?'#ff6a2a':'#9a6a43'))));
      const speed=Math.hypot(s.vx||0,s.vy||0)||1;
      const nx=(s.vx||0)/speed,ny=(s.vy||0)/speed;
      ctx.save();
      ctx.globalAlpha=0.34;
      ctx.strokeStyle=trail;
      ctx.lineWidth=Math.max(1,r*0.62);
      ctx.beginPath(); ctx.moveTo(px-nx*r*3.2,py-ny*r*3.2); ctx.lineTo(px-nx*r*0.7,py-ny*r*0.7); ctx.stroke();
      ctx.globalAlpha=1;
      ctx.translate(px,py);
      ctx.rotate(s.spin||0);
      ctx.fillStyle=weapon==='firepot'?'#5a1d12':(weapon==='ember'?'#ff8a2d':(weapon==='drill'?'#304c4b':(weapon==='shrapnel'?'#69645d':(s.heavy?'#3a2119':'#5f4935'))));
      ctx.beginPath();
      ctx.moveTo(-r*0.95,-r*0.35); ctx.lineTo(-r*0.25,-r); ctx.lineTo(r*0.82,-r*0.48);
      ctx.lineTo(r*0.92,r*0.38); ctx.lineTo(r*0.08,r); ctx.lineTo(-r*0.88,r*0.46);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle=trail;
      ctx.lineWidth=Math.max(1,TILE_SIZE*0.045);
      ctx.beginPath(); ctx.moveTo(-r*0.45,-r*0.35); ctx.lineTo(r*0.15,0); ctx.lineTo(r*0.48,-r*0.50); ctx.stroke();
      if(s.heavy || weapon==='ember'){
        ctx.fillStyle=weapon==='drill'?'rgba(114,255,224,0.78)':'rgba(255,92,30,0.78)';
        ctx.beginPath(); ctx.arc(r*0.12,r*0.18,r*0.22,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }
  function drawAlienChargeFx(ctx,TILE_SIZE,visible,now){
    for(const team of teams){
      if(!isAlienTeam(team) || team.state==='defeated') continue;
      for(const a of team.aliens){
        const c=a&&a.alienCharge;
        if(!c || a.dead || a.hp<=0 || (!visible(a.x,a.y)&&!visible(c.aimX,c.aimY))) continue;
        const duration=Math.max(0.001,Number(c.duration)||1);
        const progress=clamp(1-(Number(c.t)||0)/duration,0,1);
        const dir=c.aimX>=a.x?1:-1;
        const ox=(a.x+dir*0.28)*TILE_SIZE,oy=(a.y-0.61)*TILE_SIZE;
        const tx=c.aimX*TILE_SIZE,ty=c.aimY*TILE_SIZE;
        const pulse=0.55+0.45*Math.sin(now*0.018+progress*9);
        const weapon=String(c.weaponType||a.weaponType||'pulse');
        const chargeCol=weapon==='lance'?'#ffe46e':(weapon==='arc'?'#72b8ff':(weapon==='plasma'?'#c684ff':(weapon==='spit'?'#9eff70':(weapon==='scatter'?'#ff8fcf':'#72ffe0'))));
        ctx.save();
        ctx.globalAlpha=0.20+progress*0.38;
        ctx.strokeStyle=progress>0.72?'#fff39a':chargeCol;
        ctx.lineWidth=Math.max(1,TILE_SIZE*(0.035+progress*0.025));
        if(ctx.setLineDash) ctx.setLineDash([TILE_SIZE*0.18,TILE_SIZE*0.16]);
        ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(tx,ty);ctx.stroke();
        if(ctx.setLineDash) ctx.setLineDash([]);
        ctx.globalAlpha=0.72+0.25*pulse;
        ctx.fillStyle=progress>0.72?'#fff7b5':chargeCol;
        ctx.beginPath();ctx.arc(ox,oy,TILE_SIZE*(0.07+progress*0.11),0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='rgba(255,236,126,0.92)';
        ctx.lineWidth=Math.max(1,TILE_SIZE*0.045);
        const r=TILE_SIZE*(0.20+progress*0.10+pulse*0.035);
        ctx.beginPath();ctx.arc(tx,ty,r,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(tx-r*1.45,ty);ctx.lineTo(tx-r*0.55,ty);ctx.moveTo(tx+r*0.55,ty);ctx.lineTo(tx+r*1.45,ty);
        ctx.moveTo(tx,ty-r*1.45);ctx.lineTo(tx,ty-r*0.55);ctx.moveTo(tx,ty+r*0.55);ctx.lineTo(tx,ty+r*1.45);ctx.stroke();
        ctx.restore();
      }
    }
  }
  function drawLaserFx(ctx,TILE_SIZE,visible){
    ctx.lineCap = 'round';
    for(const l of lasers){
      if(!visible(l.x1,l.y1) && !visible(l.x2,l.y2)) continue;
      const a = Math.max(0, 1 - l.t / Math.max(0.001,l.life));
      const x1 = l.x1*TILE_SIZE, y1 = l.y1*TILE_SIZE, x2 = l.x2*TILE_SIZE, y2 = l.y2*TILE_SIZE;
      const tier = Math.max(0, Math.min(3, Number(l.weaponTier) || 0));
      const w = (l.heavy ? 1.55 : 1) + tier * 0.18;
      const tierCols = ['255,111,91','115,255,222','255,210,96','196,132,255'];
      const baseCol = tierCols[tier] || tierCols[0];
      let col = l.kind === 'heal' ? '142,255,132' : (l.hit ? (tier > 0 ? baseCol : '115,255,222') : (l.blocked ? '255,145,84' : baseCol));
      if(l.kind === 'mole_fire') col = l.blocked ? '255,94,45' : '255,132,54';
      else if(l.kind === 'mole_lava') col = '255,76,30';
      else if(l.kind === 'mole_heal') col = '255,178,86';
      else if(l.kind === 'alien_lance') col = '255,224,86';
      else if(l.kind === 'alien_arc') col = '92,174,255';
      else if(l.kind === 'alien_plasma') col = '198,132,255';
      else if(l.kind === 'alien_spit') col = '142,255,96';
      else if(l.kind === 'alien_scatter') col = '255,112,194';
      else if(l.kind === 'alien_needle') col = '110,245,255';
      else if(l.kind === 'alien_burst') col = '255,154,92';
      ctx.globalAlpha = a;
      // wide halo -> saturated body -> hot core
      ctx.strokeStyle = 'rgba('+col+',0.20)';
      ctx.lineWidth = 7.5*w;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.strokeStyle = 'rgba('+col+',0.85)';
      ctx.lineWidth = 3.0*w;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(240,255,255,0.92)';
      ctx.lineWidth = 1.1*w;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      // impact flare: bloom + four rays
      if(l.hit || l.blocked){
        const fr = (2.4 + Math.sin(l.phase + l.t*40)*0.7) * w;
        ctx.fillStyle = 'rgba('+col+',0.55)';
        ctx.beginPath(); ctx.arc(x2,y2,fr*1.9,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(x2,y2,fr*0.75,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x2-fr*2.6,y2); ctx.lineTo(x2+fr*2.6,y2);
        ctx.moveTo(x2,y2-fr*2.6); ctx.lineTo(x2,y2+fr*2.6);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawLander(ctx,l,TILE_SIZE,now){
    const px = l.x*TILE_SIZE, py = l.y*TILE_SIZE;
    const T2 = TILE_SIZE;
    const ph = l.phase || 0;
    const pulse = 0.5 + Math.sin(ph*2.4)*0.5;
    ctx.save();
    ctx.translate(px,py);
    if(l.destroyed){
      // wreck: tilted scorched hull with fracture lines and dying embers,
      // settled onto the ground below its hover height
      ctx.translate(0,T2*0.55);
      ctx.rotate(0.16);
      ctx.fillStyle = 'rgba(16,20,24,0.94)';
      ctx.beginPath(); ctx.ellipse(0,T2*0.18,T2*1.8,T2*0.5,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(34,40,46,0.9)';
      ctx.beginPath(); ctx.ellipse(-T2*0.1,T2*0.02,T2*1.5,T2*0.34,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(6,8,10,0.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-T2*1.1,T2*0.05); ctx.lineTo(-T2*0.5,T2*0.28); ctx.lineTo(-T2*0.2,T2*0.02);
      ctx.moveTo(T2*0.4,T2*0.3); ctx.lineTo(T2*0.7,T2*0.02); ctx.lineTo(T2*1.2,T2*0.22);
      ctx.stroke();
      const ember = 0.25 + 0.35*Math.abs(Math.sin(now*0.006));
      ctx.fillStyle = 'rgba(255,140,60,'+ember.toFixed(3)+')';
      ctx.fillRect(-T2*0.55,T2*0.12,3,2); ctx.fillRect(T2*0.35,T2*0.2,2,2); ctx.fillRect(T2*0.85,T2*0.05,2,1);
      ctx.restore();
      return;
    }
    const grounded = !!l.landed;
    // descent thrusters
    if(!grounded){
      const flick = 0.5 + 0.5*Math.sin(now*0.02 + ph*3);
      for(const tx of [-T2*0.85, 0, T2*0.85]){
        const fh = T2*(0.55 + 0.35*flick);
        const g = ctx.createLinearGradient(tx,T2*0.3,tx,T2*0.3+fh);
        g.addColorStop(0,'rgba(150,255,230,0.85)');
        g.addColorStop(0.5,'rgba(90,220,255,0.35)');
        g.addColorStop(1,'rgba(90,220,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(tx-T2*0.16,T2*0.30);
        ctx.lineTo(tx+T2*0.16,T2*0.30);
        ctx.lineTo(tx+T2*0.05,T2*0.30+fh);
        ctx.lineTo(tx-T2*0.05,T2*0.30+fh);
        ctx.closePath(); ctx.fill();
      }
    }
    // landing legs + ground glow once down (pads plant at ~1.25 tiles below
    // the hull center, matching the landY offset in makeAlienTeam)
    if(grounded){
      ctx.strokeStyle = '#20303a';
      ctx.lineWidth = T2*0.14;
      ctx.lineCap = 'round';
      for(const [sx,fx] of [[-T2*1.0,-T2*1.45],[0,0],[T2*1.0,T2*1.45]]){
        ctx.beginPath(); ctx.moveTo(sx,T2*0.18); ctx.lineTo(fx,T2*1.22); ctx.stroke();
      }
      ctx.fillStyle = '#141f26';
      for(const fx of [-T2*1.45, 0, T2*1.45]) ctx.fillRect(fx-T2*0.20,T2*1.18,T2*0.40,T2*0.13);
      ctx.fillStyle = 'rgba(110,255,220,'+(0.06+pulse*0.07).toFixed(3)+')';
      ctx.beginPath(); ctx.ellipse(0,T2*1.3,T2*1.9,T2*0.26,0,0,Math.PI*2); ctx.fill();
    }
    // underside bowl + hatch port
    ctx.fillStyle = '#101c23';
    ctx.beginPath(); ctx.ellipse(0,T2*0.16,T2*1.6,T2*0.42,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(118,255,218,'+(0.3+pulse*0.35).toFixed(3)+')';
    ctx.beginPath(); ctx.ellipse(0,T2*0.30,T2*0.42,T2*0.13,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(220,255,246,'+(0.25+pulse*0.4).toFixed(3)+')';
    ctx.beginPath(); ctx.ellipse(0,T2*0.30,T2*0.18,T2*0.06,0,0,Math.PI*2); ctx.fill();
    // hull disc with metallic sheen
    const hull = ctx.createLinearGradient(0,-T2*0.5,0,T2*0.3);
    hull.addColorStop(0,'#54707e');
    hull.addColorStop(0.45,'#31454f');
    hull.addColorStop(1,'#17242b');
    ctx.fillStyle = hull;
    ctx.beginPath(); ctx.ellipse(0,-T2*0.05,T2*1.9,T2*0.52,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(8,14,18,0.7)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(0,-T2*0.05,T2*1.9,T2*0.52,0,0,Math.PI*2); ctx.stroke();
    // plating seams
    ctx.strokeStyle = 'rgba(10,18,22,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0,-T2*0.05,T2*1.45,T2*0.36,0,0.15,Math.PI-0.15);
    ctx.stroke();
    // specular rim on top edge
    ctx.strokeStyle = 'rgba(214,240,248,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(0,-T2*0.10,T2*1.62,T2*0.36,0,Math.PI*1.12,Math.PI*1.88); ctx.stroke();
    // rim lights: staggered blink chase
    for(let i=0;i<7;i++){
      const ang = Math.PI*(0.12 + i*0.126);
      const lx = Math.cos(ang)*T2*1.68;
      const ly = T2*0.08 + Math.sin(ang)*T2*0.30;
      const on = 0.35 + 0.65*Math.abs(Math.sin(ph*3 + i*0.9));
      ctx.fillStyle = (i%2===0) ? 'rgba(126,255,225,'+on.toFixed(3)+')' : 'rgba(255,224,130,'+on.toFixed(3)+')';
      ctx.beginPath(); ctx.arc(lx,ly,T2*0.07,0,Math.PI*2); ctx.fill();
    }
    // cockpit dome with pilot silhouette
    const dome = ctx.createLinearGradient(0,-T2*0.95,0,-T2*0.2);
    dome.addColorStop(0,'rgba(190,250,240,0.85)');
    dome.addColorStop(0.5,'rgba(96,180,190,0.72)');
    dome.addColorStop(1,'rgba(40,90,104,0.75)');
    ctx.fillStyle = dome;
    ctx.beginPath(); ctx.ellipse(0,-T2*0.34,T2*0.72,T2*0.55,0,Math.PI,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(16,34,32,0.85)';
    ctx.beginPath(); ctx.ellipse(0,-T2*0.4,T2*0.2,T2*0.24,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(150,255,235,0.9)';
    ctx.fillRect(-T2*0.11,-T2*0.48,T2*0.07,T2*0.06);
    ctx.fillRect(T2*0.04,-T2*0.48,T2*0.07,T2*0.06);
    ctx.strokeStyle = 'rgba(235,255,252,0.65)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(-T2*0.2,-T2*0.52,T2*0.3,T2*0.2,-0.5,Math.PI*1.15,Math.PI*1.75); ctx.stroke();
    // battle damage sparks when hurting
    if(l.hp < l.maxHp*0.5){
      const sp = Math.sin(now*0.03 + ph*7);
      if(sp > 0.55){
        ctx.fillStyle = 'rgba(255,190,90,0.9)';
        ctx.fillRect(T2*(0.4+0.5*Math.sin(ph*11)),-T2*0.1,2.5,2.5);
      }
      ctx.fillStyle = 'rgba(30,34,38,0.55)';
      ctx.beginPath(); ctx.ellipse(-T2*0.7,-T2*0.15,T2*0.34,T2*0.12,0.3,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
    if(l.hp < l.maxHp) drawHealthBar(ctx,px,py-T2*1.25,T2*2.4,l.hp/l.maxHp);
  }
  function wrapSpeechText(ctx,text,maxWidth){
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for(const word of words){
      const test = line ? line + ' ' + word : word;
      if(line && ctx.measureText(test).width > maxWidth){
        lines.push(line);
        line = word;
      } else line = test;
      if(lines.length >= 3) break;
    }
    if(line && lines.length < 3) lines.push(line);
    if(words.length && !lines.length) lines.push(words[0]);
    return lines;
  }
  function drawBubblePath(ctx,x,y,w,h,r){
    const rr = Math.min(r,w*0.25,h*0.35);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.lineTo(x+w-rr,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
    ctx.lineTo(x+w,y+h-rr);
    ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
    ctx.lineTo(x+w*0.58,y+h);
    ctx.lineTo(x+w*0.50,y+h+5);
    ctx.lineTo(x+w*0.43,y+h);
    ctx.lineTo(x+rr,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
    ctx.lineTo(x,y+rr);
    ctx.quadraticCurveTo(x,y,x+rr,y);
    ctx.closePath();
  }
  function drawAlienSpeech(ctx,a,px,topY,TILE_SIZE,now){
    const text = a && a.speechText;
    if(!text || now >= (a.speechUntil || 0)) return;
    const T2 = TILE_SIZE;
    const fs = clamp(T2*0.42,9,13);
    ctx.save();
    const font = Math.round(fs)+'px system-ui, sans-serif';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxWidth = T2 * 5.8;
    const cacheKey = text+'|'+font+'|'+Math.round(T2*100);
    let layout = a._speechLayout;
    if(!layout || layout.key !== cacheKey){
      const lines = wrapSpeechText(ctx,text,maxWidth);
      let w = T2 * 1.8;
      for(const line of lines) w = Math.max(w, ctx.measureText(line).width + T2*0.56);
      w = Math.min(maxWidth + T2*0.56, w);
      layout = {key:cacheKey, lines, w};
      a._speechLayout = layout;
    }
    const lines = layout.lines;
    const w = layout.w;
    const lineH = fs * 1.18;
    const h = lineH * lines.length + T2*0.34;
    const x = px - w/2;
    const y = topY - h - T2*0.20;
    const alpha = clamp(Math.min(1,(a.speechUntil - now) / 520),0,1);
    ctx.globalAlpha = alpha;
    drawBubblePath(ctx,x,y,w,h,Math.min(8,T2*0.22));
    ctx.fillStyle = 'rgba(8,14,18,0.84)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(132,255,225,0.56)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(242,255,250,0.96)';
    const startY = y + T2*0.17 + lineH*0.5;
    for(let i=0;i<lines.length;i++) ctx.fillText(lines[i],px,startY+i*lineH);
    ctx.restore();
  }
  function petWeaponColor(a,mole){
    const weapon=String(a.weaponType||'');
    if(weapon==='lance'||weapon==='firepot'||weapon==='ember') return '#ffb23e';
    if(weapon==='arc') return '#72b8ff';
    if(weapon==='plasma') return '#c684ff';
    if(weapon==='spit') return '#9eff70';
    if(weapon==='scatter') return '#ff8fcf';
    if(weapon==='drill') return '#72ffe0';
    return mole ? '#ff8b35' : '#72ffe0';
  }
  function drawInvasionPet(ctx,a,TILE_SIZE,now,mole){
    const variant=mole ? normalizeMolekinVariant(a.variant,a.role) : normalizeAlienVariant(a.variant,a.role);
    const T2=TILE_SIZE,px=a.x*T2,foot=a.y*T2;
    const form=String(a.form||'');
    const flying=isFlyingUnit(a);
    const hurt=now<(a.hitFlashUntil||0);
    const accent=petWeaponColor(a,mole);
    const pattern=Math.max(0,Math.min(5,Number(variant.pattern)||0));
    const base=mole ? ['#7b573d','#8a6842','#705246','#94613b','#655647','#9a7147'][pattern] : ['#79cbb1','#7bbce0','#b190e8','#d681b5','#8ed36f','#e2b56c'][pattern];
    const dark=mole?'#34251d':'#254c49';
    const deep=mole?'#1e1511':'#142d30';
    const jelly=form==='jelly';
    const beetle=form==='drill_beetle';
    const manyLegs=form==='skitter'||form==='ember_mite';
    const gait=Math.sin(a.x*5.2*(variant.gait||1));
    ctx.save();
    ctx.translate(px,foot);
    if(!flying){
      ctx.fillStyle='rgba(5,7,8,0.32)';
      ctx.beginPath();ctx.ellipse(0,T2*0.03,T2*0.34*variant.body,T2*0.07,0,0,Math.PI*2);ctx.fill();
    }
    ctx.scale((a.facing<0?-1:1)*variant.body,variant.height);
    if(flying){
      const flutter=Math.sin(now*0.018+(a.phase||0))*T2*0.08*(variant.wing||1);
      if(jelly){
        ctx.fillStyle=hurt?'#efffff':'rgba(139,226,216,0.88)';
        ctx.beginPath();ctx.ellipse(0,-T2*0.50,T2*0.34,T2*0.27,0,Math.PI,Math.PI*2);ctx.lineTo(T2*0.28,-T2*0.43);ctx.quadraticCurveTo(0,-T2*0.30,-T2*0.28,-T2*0.43);ctx.closePath();ctx.fill();
        ctx.strokeStyle=accent;ctx.lineWidth=T2*0.035;
        for(let i=-2;i<=2;i++){
          ctx.beginPath();ctx.moveTo(i*T2*0.11,-T2*0.39);ctx.quadraticCurveTo(i*T2*0.15+flutter,-T2*0.18,i*T2*0.10,-T2*0.02);ctx.stroke();
        }
      } else {
        ctx.fillStyle=hurt?'#f4ffff':base;
        ctx.beginPath();ctx.moveTo(-T2*0.10,-T2*0.50);ctx.quadraticCurveTo(-T2*(0.62+0.12*(variant.wing||1)),-T2*0.82-flutter,-T2*0.43,-T2*0.30);ctx.quadraticCurveTo(-T2*0.20,-T2*0.39,-T2*0.10,-T2*0.50);ctx.fill();
        ctx.beginPath();ctx.moveTo(T2*0.10,-T2*0.50);ctx.quadraticCurveTo(T2*(0.62+0.12*(variant.wing||1)),-T2*0.82+flutter,T2*0.43,-T2*0.30);ctx.quadraticCurveTo(T2*0.20,-T2*0.39,T2*0.10,-T2*0.50);ctx.fill();
        ctx.fillStyle=dark;ctx.beginPath();ctx.ellipse(0,-T2*0.48,T2*0.28,T2*0.18,0,0,Math.PI*2);ctx.fill();
      }
    } else {
      ctx.strokeStyle=deep;ctx.lineWidth=T2*(manyLegs?0.045:0.075);ctx.lineCap='round';
      const legs=manyLegs?6:4;
      for(let i=0;i<legs;i++){
        const side=i%2?-1:1,along=(Math.floor(i/2)-(legs/4-0.5))*T2*0.16;
        ctx.beginPath();ctx.moveTo(along,-T2*0.25);ctx.lineTo(along+side*T2*(0.16+0.03*Math.abs(gait)),-T2*(0.02+0.03*((i+pattern)%2)));ctx.stroke();
      }
      if(!beetle){
        ctx.strokeStyle=dark;ctx.lineWidth=T2*0.065;
        ctx.beginPath();ctx.moveTo(-T2*0.22,-T2*0.35);ctx.quadraticCurveTo(-T2*(0.50+0.10*(variant.tail||1)),-T2*(0.42+gait*0.04),-T2*0.58,-T2*0.28);ctx.stroke();
      }
      ctx.fillStyle=hurt?'#f4ffff':(beetle?dark:base);
      ctx.beginPath();ctx.ellipse(-T2*0.03,-T2*0.34,T2*(beetle?0.34:0.30),T2*(beetle?0.24:0.20),0,0,Math.PI*2);ctx.fill();
      if(beetle){
        ctx.strokeStyle=accent;ctx.lineWidth=T2*0.035;ctx.beginPath();ctx.moveTo(0,-T2*0.56);ctx.lineTo(0,-T2*0.15);ctx.stroke();
        ctx.fillStyle=deep;ctx.beginPath();ctx.moveTo(T2*0.22,-T2*0.42);ctx.lineTo(T2*(0.52+0.10*(variant.horn||1)),-T2*0.35);ctx.lineTo(T2*0.22,-T2*0.28);ctx.closePath();ctx.fill();
      }
    }
    const headX=jelly?T2*0.06:T2*0.25,headY=flying?-T2*0.51:-T2*0.39;
    if(!jelly){
      ctx.fillStyle=hurt?'#ffffff':base;ctx.beginPath();ctx.ellipse(headX,headY,T2*0.18*variant.head,T2*0.15*variant.head,0.08,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle=deep;ctx.beginPath();ctx.ellipse(headX+T2*0.07,headY,T2*0.07*variant.eye,T2*0.055*variant.eye,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=accent;ctx.beginPath();ctx.arc(headX+T2*0.09,headY-T2*0.01,T2*0.026*variant.eye,0,Math.PI*2);ctx.fill();
    if(now-(a.lastShotAt||0)<120 || a.alienCharge){
      ctx.fillStyle=accent;ctx.beginPath();ctx.arc(headX+T2*0.20,headY+T2*0.03,T2*0.09,0,Math.PI*2);ctx.fill();
    }
    if(flying){
      ctx.fillStyle='rgba(120,220,255,0.28)';ctx.beginPath();ctx.ellipse(0,-T2*0.12,T2*0.27,T2*0.07,0,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
    if(a.hp<a.maxHp) drawHealthBar(ctx,px,foot-T2*(flying?0.96:0.78)*variant.height,T2*0.58*variant.body,a.hp/a.maxHp);
  }
  function drawAlien(ctx,a,TILE_SIZE,now){
    if(a.isPet){ drawInvasionPet(ctx,a,TILE_SIZE,now,false); return; }
    const skin = ROLE_TINTS[a.role] || ROLE_TINTS.rusher;
    const grade = Math.max(0, Math.min(3, Number(a.grade) || 0));
    const weaponTier = Math.max(0, Math.min(3, Number(a.weaponTier) || 0));
    const variant = normalizeAlienVariant(a.variant,a.role);
    const bodyScale = variant.body;
    const heightScale = variant.height;
    const headScale = variant.head;
    const eyeScale = variant.eye;
    const antennaScale = variant.antenna;
    const limbScale = variant.leg;
    const armScale = variant.arm;
    const T2 = TILE_SIZE;
    const px = a.x*T2, foot = a.y*T2;
    const hurt = now < (a.hitFlashUntil || 0);
    const healing = now < (a.healFlashUntil || 0);
    const moving = Math.abs(a.vx || 0) > 0.35;
    const gait = a.onGround ? Math.sin(a.x*3.1*variant.gait) * (moving ? 1 : 0) : 0;
    const bob = a.onGround ? Math.abs(Math.cos(a.x*3.1*variant.gait)) * (moving ? T2*0.045 : 0) : -T2*0.06;
    const fleeing = !!(a._ai && a._ai.state === 'flee');
    ctx.save();
    ctx.translate(px,foot);
    if(a.giant && now-(a.lastStompAt||0)<420){
      const k=clamp((now-(a.lastStompAt||0))/420,0,1);
      ctx.strokeStyle='rgba(255,212,104,'+(1-k).toFixed(3)+')';ctx.lineWidth=Math.max(1,T2*0.06);
      ctx.beginPath();ctx.ellipse(0,T2*0.03,T2*(0.5+k*1.8),T2*(0.10+k*0.28),0,0,Math.PI*2);ctx.stroke();
    }
    // ground contact shadow
    if(a.onGround){
      ctx.fillStyle = 'rgba(6,10,12,0.35)';
      ctx.beginPath(); ctx.ellipse(0,T2*0.02,T2*0.30*bodyScale,T2*0.07,0,0,Math.PI*2); ctx.fill();
    }
    ctx.scale((a.facing < 0 ? -1 : 1) * bodyScale, heightScale);
    ctx.translate(0,-bob);
    ctx.lineCap = 'round';
    if(a.mobility === 'jetpack'){
      const flame=0.12+0.08*Math.abs(Math.sin(now*0.025+(a.phase||0)));
      ctx.fillStyle='#263840';ctx.fillRect(-T2*0.30,-T2*0.63,T2*0.13,T2*0.34);
      ctx.fillStyle='#72ffe0';ctx.beginPath();ctx.moveTo(-T2*0.29,-T2*0.29);ctx.lineTo(-T2*0.23,T2*flame);ctx.lineTo(-T2*0.18,-T2*0.29);ctx.closePath();ctx.fill();
    }
    // legs: two digitigrade limbs with opposite swing (tucked mid-air)
    ctx.strokeStyle = skin.deep;
    ctx.lineWidth = T2*0.09;
    const legSwing = (a.onGround ? gait*T2*0.14 : T2*0.10) * limbScale;
    const legLift = a.onGround ? 0 : -T2*0.12;
    const stance = T2 * variant.stance;
    ctx.beginPath();
    ctx.moveTo(-T2*0.10-stance,-T2*0.36);
    ctx.quadraticCurveTo(-T2*0.16-stance,-T2*0.18, -T2*0.10-stance-legSwing, legLift);
    ctx.moveTo(T2*0.10+stance,-T2*0.36);
    ctx.quadraticCurveTo(T2*0.16+stance,-T2*0.18, T2*0.10+stance+legSwing, legLift*0.6);
    ctx.stroke();
    // feet pads
    ctx.fillStyle = skin.deep;
    ctx.fillRect(-T2*0.16-stance-legSwing, legLift-T2*0.02, T2*0.13*limbScale, T2*0.05);
    ctx.fillRect(T2*0.04+stance+legSwing, legLift*0.6-T2*0.02, T2*0.13*limbScale, T2*0.05);
    // orbiters ride a glowing anti-grav ring instead of standing tall
    if(a.role === 'orbiter'){
      const hum = 0.35 + 0.3*Math.abs(Math.sin(now*0.008 + a.phase));
      ctx.fillStyle = 'rgba(166,127,251,'+hum.toFixed(3)+')';
      ctx.beginPath(); ctx.ellipse(0,-T2*0.10,T2*0.26,T2*0.07,0,0,Math.PI*2); ctx.fill();
    }
    if(a.role === 'healer'){
      const hum = clamp(0.26 + 0.18*Math.sin(now*0.008 + a.phase) * (variant.glow || 1),0.06,0.52).toFixed(3);
      ctx.strokeStyle = 'rgba(158,255,112,'+hum+')';
      ctx.lineWidth = T2*0.045;
      ctx.beginPath(); ctx.ellipse(-T2*0.05,-T2*0.58,T2*0.24,T2*0.32,0,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle = 'rgba(158,255,112,0.38)';
      ctx.beginPath(); ctx.arc(-T2*0.17,-T2*0.63,T2*0.055,0,Math.PI*2); ctx.fill();
    } else if(a.role === 'commander'){
      const hum = clamp(0.30 + 0.22*Math.sin(now*0.007 + a.phase) * (variant.glow || 1),0.10,0.64).toFixed(3);
      ctx.strokeStyle = 'rgba(255,232,112,'+hum+')';
      ctx.lineWidth = T2*0.055;
      ctx.beginPath(); ctx.ellipse(0,-T2*0.62,T2*0.34,T2*0.38,0,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,232,112,0.42)';
      ctx.beginPath(); ctx.arc(T2*0.20,-T2*0.72,T2*0.065,0,Math.PI*2); ctx.fill();
    } else if(a.role === 'tank'){
      ctx.fillStyle = '#22323a';
      ctx.fillRect(-T2*0.25,-T2*0.61,T2*0.16,T2*0.12);
      ctx.fillRect(T2*0.09,-T2*0.61,T2*0.16,T2*0.12);
    }
    // torso: rounded carapace with belly plate
    ctx.fillStyle = hurt ? '#eaffff' : skin.dark;
    ctx.beginPath();
    ctx.ellipse(0,-T2*0.46,T2*0.21,T2*0.26,0,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle = hurt ? '#d2fff4' : skin.tint;
    ctx.beginPath();
    ctx.ellipse(T2*0.045,-T2*0.48,T2*0.145,T2*0.20,0.12,0,Math.PI*2);
    ctx.fill();
    // role gear across the belly
    if(a.role === 'sapper'){
      ctx.strokeStyle = 'rgba(46,20,14,0.85)';
      ctx.lineWidth = T2*0.045;
      ctx.beginPath();
      ctx.moveTo(-T2*0.06,-T2*0.56); ctx.lineTo(T2*0.13,-T2*0.50);
      ctx.moveTo(-T2*0.06,-T2*0.46); ctx.lineTo(T2*0.13,-T2*0.40);
      ctx.stroke();
    } else if(a.role === 'engineer'){
      ctx.strokeStyle = skin.deep;
      ctx.lineWidth = T2*0.05;
      ctx.beginPath(); ctx.moveTo(-T2*0.14,-T2*0.58); ctx.lineTo(T2*0.14,-T2*0.38); ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.fillRect(-T2*0.02,-T2*0.50,T2*0.07,T2*0.07);
    } else if(a.role === 'commander'){
      ctx.strokeStyle = '#5d3f12';
      ctx.lineWidth = T2*0.045;
      ctx.beginPath();
      ctx.moveTo(-T2*0.15,-T2*0.57); ctx.lineTo(T2*0.16,-T2*0.57);
      ctx.moveTo(-T2*0.18,-T2*0.49); ctx.lineTo(T2*0.18,-T2*0.49);
      ctx.moveTo(-T2*0.10,-T2*0.41); ctx.lineTo(T2*0.12,-T2*0.41);
      ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.fillRect(-T2*0.03,-T2*0.60,T2*0.07,T2*0.20);
    } else if(a.role === 'tank'){
      ctx.strokeStyle = '#1c2b32';
      ctx.lineWidth = T2*0.04;
      ctx.beginPath();
      ctx.moveTo(-T2*0.13,-T2*0.55); ctx.lineTo(T2*0.14,-T2*0.55);
      ctx.moveTo(-T2*0.15,-T2*0.47); ctx.lineTo(T2*0.16,-T2*0.47);
      ctx.stroke();
    } else if(a.role === 'healer'){
      ctx.fillStyle = skin.accent;
      ctx.fillRect(-T2*0.02,-T2*0.56,T2*0.05,T2*0.18);
      ctx.fillRect(-T2*0.085,-T2*0.495,T2*0.18,T2*0.05);
    }
    if(grade > 0 && a.role !== 'commander'){
      const rankCols = ['#77d8ff','#ffd260','#c684ff'];
      ctx.fillStyle = rankCols[grade - 1] || rankCols[rankCols.length - 1];
      for(let g=0; g<grade; g++){
        const yy = -T2 * (0.58 - g * 0.055);
        ctx.beginPath();
        ctx.moveTo(-T2*0.10,yy);
        ctx.lineTo(0,yy+T2*0.035);
        ctx.lineTo(T2*0.10,yy);
        ctx.lineTo(T2*0.06,yy+T2*0.035);
        ctx.lineTo(0,yy+T2*0.010);
        ctx.lineTo(-T2*0.06,yy+T2*0.035);
        ctx.closePath();
        ctx.fill();
      }
    }
    // head: big glossy dome with visor eyes and antennae
    const headY = -T2*0.76;
    ctx.fillStyle = hurt ? '#f4ffff' : skin.tint;
    ctx.beginPath(); ctx.ellipse(T2*0.02,headY,T2*0.20*headScale,T2*0.17*headScale,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.beginPath(); ctx.ellipse(-T2*0.04*headScale,headY-T2*0.07*headScale,T2*0.10*headScale,T2*0.05*headScale,-0.4,0,Math.PI*2); ctx.fill();
    // wraparound eyes (blink on phase)
    const blink = (Math.sin(now*0.004 + a.phase*5) > 0.97) ? 0.25 : 1;
    ctx.fillStyle = '#0a1512';
    ctx.beginPath(); ctx.ellipse(T2*0.10*headScale,headY+T2*0.01,T2*0.105*eyeScale,T2*0.075*eyeScale*blink,0.25,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = skin.eye;
    ctx.beginPath(); ctx.ellipse(T2*0.115*headScale,headY+T2*0.005,T2*0.065*eyeScale,T2*0.045*eyeScale*blink,0.25,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(T2*0.13*headScale,headY-T2*0.03,T2*0.035*eyeScale,T2*0.028*eyeScale*blink);
    // antennae with glow bulbs
    ctx.strokeStyle = skin.dark;
    ctx.lineWidth = T2*0.035;
    ctx.beginPath();
    ctx.moveTo(-T2*0.05,headY-T2*0.13*headScale); ctx.quadraticCurveTo(-T2*0.13,headY-T2*0.26*antennaScale,-T2*0.16,headY-T2*0.22*antennaScale);
    ctx.moveTo(T2*0.06,headY-T2*0.14*headScale); ctx.quadraticCurveTo(T2*0.10,headY-T2*0.28*antennaScale,T2*0.15,headY-T2*0.26*antennaScale);
    ctx.stroke();
    const bulb = 0.55 + 0.45*Math.sin(now*0.01 + a.phase*3) * (variant.glow || 1);
    const bulbAlpha = clamp(0.4+bulb*0.5,0.20,0.98).toFixed(3);
    const bulbColor = a.role === 'commander' ? '255,232,112' : (a.role === 'sniper' ? '255,184,78' : (a.role === 'healer' ? '158,255,112' : '126,255,225'));
    ctx.fillStyle = 'rgba('+bulbColor+','+bulbAlpha+')';
    ctx.beginPath(); ctx.arc(-T2*0.16,headY-T2*0.22*antennaScale,T2*0.035*eyeScale,0,Math.PI*2); ctx.arc(T2*0.15,headY-T2*0.26*antennaScale,T2*0.035*eyeScale,0,Math.PI*2); ctx.fill();
    if(a.role === 'commander'){
      ctx.fillStyle = skin.accent;
      ctx.beginPath();
      ctx.moveTo(-T2*0.13,headY-T2*0.16);
      ctx.lineTo(-T2*0.05,headY-T2*0.30);
      ctx.lineTo(T2*0.02,headY-T2*0.17);
      ctx.lineTo(T2*0.10,headY-T2*0.30);
      ctx.lineTo(T2*0.16,headY-T2*0.15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(80,52,12,0.75)';
      ctx.fillRect(-T2*0.12,headY-T2*0.16,T2*0.27,T2*0.035);
    }
    // weapon per role, held forward
    const armY = -T2*0.50;
    ctx.strokeStyle = skin.deep;
    ctx.lineWidth = T2*0.055;
    ctx.beginPath(); ctx.moveTo(T2*0.06,armY); ctx.lineTo(T2*(0.16+0.06*armScale),armY-T2*0.03); ctx.stroke();
    const justFired = now - (a.lastShotAt || 0) < 95;
    const justHealed = now - (a.lastHealAt || 0) < 160;
    if(a.role === 'sniper'){
      ctx.strokeStyle = '#241c10';
      ctx.lineWidth = T2*0.075;
      ctx.beginPath(); ctx.moveTo(T2*0.10,armY-T2*0.02); ctx.lineTo(T2*(0.48+0.04*armScale),armY-T2*0.10); ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.fillRect(T2*0.26,armY-T2*0.16,T2*0.07,T2*0.05); // scope
      ctx.fillRect(T2*0.49,armY-T2*0.13,T2*0.05,T2*0.04); // muzzle bead
    } else if(a.role === 'commander'){
      ctx.strokeStyle = '#4f3510';
      ctx.lineWidth = T2*0.065;
      ctx.beginPath(); ctx.moveTo(T2*0.12,armY-T2*0.01); ctx.lineTo(T2*(0.44+0.04*armScale),armY-T2*0.18); ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.beginPath(); ctx.arc(T2*(0.48+0.04*armScale),armY-T2*0.20,T2*0.08,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,235,0.72)';
      ctx.fillRect(T2*(0.44+0.04*armScale),armY-T2*0.245,T2*0.08,T2*0.035);
    } else if(a.role === 'tank'){
      ctx.fillStyle = '#17242b';
      ctx.beginPath();
      ctx.ellipse(T2*0.31,armY-T2*0.02,T2*0.13,T2*0.23,0.08,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = skin.accent;
      ctx.lineWidth = T2*0.035;
      ctx.beginPath(); ctx.ellipse(T2*0.31,armY-T2*0.02,T2*0.09,T2*0.17,0.08,0,Math.PI*2); ctx.stroke();
    } else if(a.role === 'healer'){
      ctx.strokeStyle = '#25351f';
      ctx.lineWidth = T2*0.055;
      ctx.beginPath(); ctx.moveTo(T2*0.13,armY-T2*0.02); ctx.lineTo(T2*(0.34+0.04*armScale),armY-T2*0.16); ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.beginPath(); ctx.arc(T2*(0.37+0.04*armScale),armY-T2*0.18,T2*0.065,0,Math.PI*2); ctx.fill();
    } else if(a.role === 'sapper'){
      ctx.fillStyle = '#33231d';
      ctx.fillRect(T2*0.18,armY-T2*0.10,T2*0.16,T2*0.14);
      ctx.fillStyle = skin.accent;
      ctx.beginPath();
      ctx.moveTo(T2*0.34,armY-T2*0.10); ctx.lineTo(T2*0.46,armY-T2*0.03); ctx.lineTo(T2*0.34,armY+T2*0.04);
      ctx.closePath(); ctx.fill();
    } else if(a.role === 'engineer'){
      ctx.strokeStyle = '#2c3a22';
      ctx.lineWidth = T2*0.07;
      ctx.beginPath(); ctx.moveTo(T2*0.16,armY); ctx.lineTo(T2*0.34,armY-T2*0.05); ctx.stroke();
      ctx.strokeStyle = skin.accent;
      ctx.lineWidth = T2*0.04;
      ctx.beginPath(); ctx.arc(T2*0.38,armY-T2*0.06,T2*0.06,-1.2,1.6); ctx.stroke();
    } else {
      // compact blaster (rusher/flanker/orbiter variants by barrel length)
      const len = (a.role === 'flanker' ? T2*0.30 : T2*0.36) * armScale;
      ctx.fillStyle = '#1d2a26';
      ctx.fillRect(T2*0.16,armY-T2*0.08,len,T2*0.09);
      ctx.fillStyle = skin.accent;
      ctx.fillRect(T2*0.16+len-T2*0.05,armY-T2*0.065,T2*0.05,T2*0.06);
    }
    const weaponType=String(a.weaponType||'pulse');
    const weaponCol=petWeaponColor(a,false);
    ctx.strokeStyle=weaponCol;
    if(weaponType==='lance'){
      ctx.lineWidth=T2*0.045;ctx.beginPath();ctx.moveTo(T2*0.30,armY-T2*0.10);ctx.lineTo(T2*0.70,armY-T2*0.14);ctx.stroke();
      ctx.fillStyle=weaponCol;ctx.fillRect(T2*0.66,armY-T2*0.18,T2*0.09,T2*0.08);
    } else if(weaponType==='scatter'){
      ctx.lineWidth=T2*0.035;ctx.beginPath();ctx.moveTo(T2*0.34,armY-T2*0.10);ctx.lineTo(T2*0.57,armY-T2*0.18);ctx.moveTo(T2*0.34,armY-T2*0.08);ctx.lineTo(T2*0.59,armY-T2*0.08);ctx.moveTo(T2*0.34,armY-T2*0.06);ctx.lineTo(T2*0.57,armY);ctx.stroke();
    } else if(weaponType==='arc'){
      ctx.lineWidth=T2*0.035;ctx.beginPath();ctx.moveTo(T2*0.39,armY-T2*0.10);ctx.lineTo(T2*0.57,armY-T2*0.19);ctx.moveTo(T2*0.39,armY-T2*0.10);ctx.lineTo(T2*0.58,armY);ctx.stroke();
    } else if(weaponType==='plasma'){
      ctx.fillStyle=weaponCol;ctx.beginPath();ctx.arc(T2*0.48,armY-T2*0.09,T2*0.10,0,Math.PI*2);ctx.fill();
    } else if(weaponType==='burst'){
      ctx.fillStyle=weaponCol;ctx.fillRect(T2*0.43,armY-T2*0.15,T2*0.16,T2*0.035);ctx.fillRect(T2*0.43,armY-T2*0.05,T2*0.16,T2*0.035);
    } else if(weaponType==='needle'){
      ctx.lineWidth=T2*0.025;ctx.beginPath();ctx.moveTo(T2*0.42,armY-T2*0.09);ctx.lineTo(T2*0.68,armY-T2*0.09);ctx.stroke();
    }
    const muzzleX = a.role === 'sniper' ? T2*0.54 : (a.role === 'commander' ? T2*0.53 : T2*0.50);
    if(weaponTier > 0){
      const glowCols = ['126,255,225','115,255,222','255,210,96','196,132,255'];
      ctx.fillStyle = 'rgba('+(glowCols[weaponTier] || glowCols[0])+',0.42)';
      ctx.beginPath(); ctx.arc(muzzleX,armY-T2*0.08,T2*(0.045+weaponTier*0.020),0,Math.PI*2); ctx.fill();
    }
    if(justFired){
      ctx.fillStyle = 'rgba(255,255,235,0.9)';
      const mx = muzzleX;
      ctx.beginPath(); ctx.arc(mx,armY-T2*0.08,T2*0.085,0,Math.PI*2); ctx.fill();
      const flashCols = ['126,255,225','115,255,222','255,210,96','196,132,255'];
      ctx.fillStyle = 'rgba('+(flashCols[weaponTier] || flashCols[0])+',0.5)';
      ctx.beginPath(); ctx.arc(mx,armY-T2*0.08,T2*(0.16+weaponTier*0.035),0,Math.PI*2); ctx.fill();
    }
    if(justHealed){
      ctx.fillStyle = 'rgba(158,255,112,0.48)';
      ctx.beginPath(); ctx.arc(T2*0.42,armY-T2*0.16,T2*0.18,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
    // status cues + health readout (screen-aligned, drawn unmirrored)
    if(fleeing){
      const wob = Math.sin(now*0.02)*T2*0.03;
      ctx.fillStyle = 'rgba(140,220,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(px+T2*0.24, foot-T2*1.02+wob);
      ctx.quadraticCurveTo(px+T2*0.31, foot-T2*0.92+wob, px+T2*0.24, foot-T2*0.88+wob);
      ctx.quadraticCurveTo(px+T2*0.17, foot-T2*0.92+wob, px+T2*0.24, foot-T2*1.02+wob);
      ctx.fill();
    }
    if(a.hp < a.maxHp*0.3 && Math.sin(now*0.02 + a.phase*9) > 0.4){
      ctx.fillStyle = 'rgba(255,170,90,0.85)';
      ctx.fillRect(px-T2*0.1+Math.sin(a.phase*17)*T2*0.15, foot-T2*0.5, 2, 2);
    }
    if(healing){
      ctx.strokeStyle = 'rgba(158,255,112,0.72)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(px,foot-T2*0.56*heightScale,T2*0.33*bodyScale,0,Math.PI*2); ctx.stroke();
    }
    drawAlienSpeech(ctx,a,px,foot-T2*1.22*heightScale,T2,now);
    if(a.hp < a.maxHp) drawHealthBar(ctx,px,foot-T2*1.1*heightScale,T2*0.62*bodyScale,a.hp/a.maxHp);
  }
  const MOLE_ROLE_TINTS = {
    rusher:{fur:'#7a5a3d', dark:'#3f2c20', deep:'#241914', eye:'#ffd38a', accent:'#ff8b35'},
    tank:{fur:'#6c6258', dark:'#332f2e', deep:'#1d1b1c', eye:'#ffd9a3', accent:'#ffb45c'},
    healer:{fur:'#8a6148', dark:'#493023', deep:'#2b1b16', eye:'#ffe5a9', accent:'#ffc96f'},
    flanker:{fur:'#6f5037', dark:'#35251b', deep:'#211611', eye:'#ffd08a', accent:'#ff7138'},
    orbiter:{fur:'#77634f', dark:'#3c3027', deep:'#221a16', eye:'#ffe0a0', accent:'#ffaa45'},
    sniper:{fur:'#89523c', dark:'#45251e', deep:'#281512', eye:'#ffe6b8', accent:'#ff552e'},
    sapper:{fur:'#76583f', dark:'#3a291e', deep:'#231711', eye:'#ffd28f', accent:'#ff9b38'},
    engineer:{fur:'#816247', dark:'#3f2e22', deep:'#241914', eye:'#ffe0a6', accent:'#ffc04f'},
    commander:{fur:'#caa15a', dark:'#69431f', deep:'#2e1c10', eye:'#fff1bd', accent:'#ffd85a'}
  };
  function drawBurrow(ctx,team,TILE_SIZE,now){
    const b = team && team.burrow;
    if(!b) return;
    const T2 = TILE_SIZE;
    const px = b.x*T2;
    const py = (Number.isFinite(b.targetY) ? b.targetY : team.y)*T2;
    const open = !!b.open || team.state === 'active';
    const ph = b.phase || 0;
    const pulse = 0.5 + 0.5*Math.sin(now*0.008 + ph);
    ctx.save();
    ctx.translate(px,py);
    ctx.fillStyle = open ? 'rgba(18,10,7,0.86)' : 'rgba(46,31,24,0.48)';
    ctx.beginPath(); ctx.ellipse(0,T2*0.06,T2*(0.72+0.12*pulse),T2*(0.17+0.04*pulse),0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,112,45,'+(open ? 0.55 : 0.32).toFixed(3)+')';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-T2*0.78,T2*0.02); ctx.lineTo(-T2*0.38,-T2*0.08); ctx.lineTo(-T2*0.18,T2*0.00);
    ctx.moveTo(T2*0.10,T2*0.02); ctx.lineTo(T2*0.42,-T2*0.11); ctx.lineTo(T2*0.82,T2*0.02);
    ctx.moveTo(-T2*0.18,T2*0.10); ctx.lineTo(T2*0.18,T2*0.20); ctx.lineTo(T2*0.44,T2*0.12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,92,35,'+(0.18+0.22*pulse).toFixed(3)+')';
    ctx.beginPath(); ctx.ellipse(0,T2*0.06,T2*0.45,T2*0.08,0,0,Math.PI*2); ctx.fill();
    if(!open){
      const n = Math.max(1, Math.min(5, Math.floor((b.progress || 0) * 6)));
      ctx.fillStyle = 'rgba(255,184,84,0.72)';
      for(let i=0;i<n;i++){
        const x = (Math.sin(ph+i*1.7)*0.62)*T2;
        const y = (-0.05-0.08*Math.abs(Math.sin(ph+i*2.3)))*T2;
        ctx.fillRect(x,y,2,2);
      }
    }
    ctx.restore();
  }
  function drawMolekin(ctx,a,TILE_SIZE,now){
    if(a.isPet){ drawInvasionPet(ctx,a,TILE_SIZE,now,true); return; }
    const skin = MOLE_ROLE_TINTS[a.role] || MOLE_ROLE_TINTS.rusher;
    const grade = Math.max(0, Math.min(3, Number(a.grade) || 0));
    const weaponTier = Math.max(0, Math.min(3, Number(a.weaponTier) || 0));
    const variant = normalizeMolekinVariant(a.variant,a.role);
    const T2 = TILE_SIZE;
    const px = a.x*T2, foot = a.y*T2;
    const bodyScale = variant.body;
    const heightScale = variant.height;
    const hurt = now < (a.hitFlashUntil || 0);
    const healing = now < (a.healFlashUntil || 0);
    const moving = Math.abs(a.vx || 0) > 0.35;
    const gait = a.onGround ? Math.sin(a.x*3.8*variant.gait) * (moving ? 1 : 0) : 0;
    const bob = a.onGround ? Math.abs(Math.cos(a.x*3.8*variant.gait)) * (moving ? T2*0.035 : 0) : -T2*0.04;
    const fleeing = !!(a._ai && a._ai.state === 'flee');
    const charge=a.moleCharge || null;
    const chargeWindup=!!(charge && charge.phase==='windup');
    const chargeRush=!!(charge && charge.phase==='rush');
    ctx.save();
    ctx.translate(px,foot);
    if(a.giant && now-(a.lastStompAt||0)<420){
      const k=clamp((now-(a.lastStompAt||0))/420,0,1);
      ctx.strokeStyle='rgba(255,118,46,'+(1-k).toFixed(3)+')';ctx.lineWidth=Math.max(1.2,T2*0.07);
      ctx.beginPath();ctx.ellipse(0,T2*0.03,T2*(0.5+k*1.9),T2*(0.10+k*0.30),0,0,Math.PI*2);ctx.stroke();
    }
    if(a.onGround){
      ctx.fillStyle = 'rgba(8,5,4,0.38)';
      ctx.beginPath(); ctx.ellipse(0,T2*0.03,T2*0.34*bodyScale,T2*0.08,0,0,Math.PI*2); ctx.fill();
    }
    if(chargeRush){
      const back=a.facing<0?1:-1;
      ctx.fillStyle='rgba(112,82,56,0.48)';
      for(let i=0;i<4;i++){
        const d=T2*(0.22+i*0.18);
        const lift=T2*(0.03+(i%2)*0.08);
        ctx.fillRect(back*d-T2*0.06,-lift,T2*(0.08+i*0.025),T2*(0.05+i*0.018));
      }
    }
    if(chargeWindup || chargeRush) ctx.rotate((a.facing<0?-1:1)*(chargeRush?0.17:-0.08));
    ctx.scale((a.facing < 0 ? -1 : 1) * bodyScale, heightScale);
    ctx.translate(0,-bob);
    ctx.lineCap = 'round';
    if(a.mobility === 'jetpack'){
      const flame=0.13+0.09*Math.abs(Math.sin(now*0.026+(a.phase||0)));
      ctx.fillStyle='#342c28';ctx.fillRect(-T2*0.31,-T2*0.62,T2*0.15,T2*0.32);
      ctx.fillStyle='#ff8b35';ctx.beginPath();ctx.moveTo(-T2*0.30,-T2*0.30);ctx.lineTo(-T2*0.23,T2*flame);ctx.lineTo(-T2*0.17,-T2*0.30);ctx.closePath();ctx.fill();
    }
    const legSwing = (a.onGround ? gait*T2*0.12 : T2*0.06) * variant.leg;
    ctx.strokeStyle = skin.deep;
    ctx.lineWidth = T2*0.10;
    ctx.beginPath();
    ctx.moveTo(-T2*0.13,-T2*0.30); ctx.lineTo(-T2*0.17-legSwing,-T2*0.02);
    ctx.moveTo(T2*0.13,-T2*0.30); ctx.lineTo(T2*0.17+legSwing,-T2*0.02);
    ctx.stroke();
    ctx.fillStyle = skin.deep;
    ctx.fillRect(-T2*0.27-legSwing,-T2*0.04,T2*0.20,T2*0.06);
    ctx.fillRect(T2*0.08+legSwing,-T2*0.04,T2*0.20,T2*0.06);
    ctx.fillStyle = hurt ? '#fff1de' : skin.dark;
    ctx.beginPath(); ctx.ellipse(0,-T2*0.43,T2*0.25,T2*0.25,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = hurt ? '#fff8ed' : skin.fur;
    ctx.beginPath(); ctx.ellipse(T2*0.03,-T2*0.45,T2*0.18,T2*0.21,0.08,0,Math.PI*2); ctx.fill();
    if(a.role === 'tank'){
      ctx.fillStyle = '#25272a';
      ctx.fillRect(-T2*0.22,-T2*0.59,T2*0.17,T2*0.12);
      ctx.fillRect(T2*0.04,-T2*0.59,T2*0.20,T2*0.12);
    } else if(a.role === 'healer'){
      ctx.strokeStyle = 'rgba(255,196,92,0.72)';
      ctx.lineWidth = T2*0.045;
      ctx.beginPath(); ctx.arc(0,-T2*0.50,T2*0.30,0,Math.PI*2); ctx.stroke();
    } else if(a.role === 'sapper'){
      ctx.fillStyle = '#2b1a12';
      ctx.fillRect(-T2*0.12,-T2*0.56,T2*0.24,T2*0.07);
      ctx.fillStyle = skin.accent;
      ctx.fillRect(-T2*0.02,-T2*0.59,T2*0.05,T2*0.13);
    }
    if(grade > 0){
      ctx.fillStyle = ['#ff9b38','#ffc04f','#ff6c35'][grade-1] || '#ff6c35';
      for(let g=0; g<grade; g++) ctx.fillRect(-T2*(0.11-g*0.01),-T2*(0.60+g*0.045),T2*(0.22-g*0.02),T2*0.025);
    }
    const headY = -T2*0.72;
    ctx.fillStyle = hurt ? '#fff6e8' : skin.fur;
    ctx.beginPath(); ctx.ellipse(T2*0.02,headY,T2*0.21*variant.head,T2*0.16*variant.head,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = skin.dark;
    ctx.beginPath(); ctx.ellipse(T2*0.20*variant.snout,headY+T2*0.04,T2*0.12*variant.snout,T2*0.07,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#120b08';
    ctx.fillRect(T2*0.25*variant.snout,headY+T2*0.02,T2*0.035,T2*0.03);
    ctx.fillStyle = '#17100c';
    ctx.beginPath(); ctx.ellipse(T2*0.07,headY-T2*0.01,T2*0.14*variant.eye,T2*0.06*variant.eye,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = skin.eye;
    ctx.beginPath(); ctx.arc(T2*0.09,headY-T2*0.01,T2*0.035*variant.eye,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#2a2522';
    ctx.beginPath(); ctx.ellipse(0,headY-T2*0.13,T2*0.23*variant.helmet,T2*0.08,0,Math.PI,Math.PI*2); ctx.fill();
    ctx.fillStyle = skin.accent;
    ctx.beginPath(); ctx.arc(T2*0.15,headY-T2*0.14,T2*(0.035+weaponTier*0.012),0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = skin.deep;
    ctx.lineWidth = T2*0.065;
    ctx.beginPath(); ctx.moveTo(T2*0.05,-T2*0.48); ctx.lineTo(T2*0.25*variant.arm,-T2*0.38); ctx.stroke();
    if(a.role === 'sniper'){
      ctx.strokeStyle = '#27120d';
      ctx.lineWidth = T2*0.07;
      ctx.beginPath(); ctx.moveTo(T2*0.16,-T2*0.42); ctx.lineTo(T2*0.48,-T2*0.62); ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.beginPath(); ctx.arc(T2*0.52,-T2*0.64,T2*0.08,0,Math.PI*2); ctx.fill();
    } else if(a.role === 'sapper'){
      ctx.strokeStyle = '#2e2117';
      ctx.lineWidth = T2*0.075;
      ctx.beginPath(); ctx.moveTo(T2*0.16,-T2*0.43); ctx.lineTo(T2*0.45,-T2*0.30); ctx.stroke();
      ctx.fillStyle = skin.accent;
      ctx.beginPath(); ctx.moveTo(T2*0.45,-T2*0.36); ctx.lineTo(T2*0.60,-T2*0.29); ctx.lineTo(T2*0.45,-T2*0.23); ctx.closePath(); ctx.fill();
    } else if(a.role === 'healer'){
      ctx.fillStyle = skin.accent;
      ctx.beginPath(); ctx.arc(T2*0.34,-T2*0.50,T2*0.075,0,Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle = skin.accent;
      ctx.fillRect(T2*0.22,-T2*0.43,T2*0.20*variant.claw,T2*0.06);
    }
    const weaponType=String(a.weaponType||'stone');
    const weaponCol=petWeaponColor(a,true);
    if(weaponType==='boulder'){
      ctx.fillStyle='#4b3527';ctx.beginPath();ctx.arc(T2*0.46,-T2*0.48,T2*0.14,0,Math.PI*2);ctx.fill();
    } else if(weaponType==='firepot'){
      ctx.fillStyle='#5a2117';ctx.beginPath();ctx.arc(T2*0.45,-T2*0.48,T2*0.12,0,Math.PI*2);ctx.fill();ctx.fillStyle=weaponCol;ctx.fillRect(T2*0.43,-T2*0.66,T2*0.04,T2*0.09);
    } else if(weaponType==='drill'){
      ctx.fillStyle=weaponCol;ctx.beginPath();ctx.moveTo(T2*0.38,-T2*0.53);ctx.lineTo(T2*0.70,-T2*0.46);ctx.lineTo(T2*0.38,-T2*0.39);ctx.closePath();ctx.fill();
    } else if(weaponType==='shrapnel'){
      ctx.strokeStyle='#d8d2c6';ctx.lineWidth=T2*0.035;ctx.beginPath();ctx.moveTo(T2*0.34,-T2*0.51);ctx.lineTo(T2*0.62,-T2*0.60);ctx.moveTo(T2*0.34,-T2*0.49);ctx.lineTo(T2*0.62,-T2*0.40);ctx.stroke();
    } else if(weaponType==='ember'){
      ctx.fillStyle=weaponCol;ctx.beginPath();ctx.arc(T2*0.46,-T2*0.50,T2*0.09,0,Math.PI*2);ctx.fill();
    }
    if(now - (a.lastShotAt || 0) < 110){
      ctx.fillStyle = 'rgba(255,102,42,0.62)';
      ctx.beginPath(); ctx.arc(T2*0.46,-T2*0.50,T2*0.18,0,Math.PI*2); ctx.fill();
    }
    if(healing){
      ctx.strokeStyle = 'rgba(255,190,92,0.76)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0,-T2*0.52,T2*0.34*bodyScale,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
    if(chargeWindup){
      const pulse=0.55+0.45*Math.sin(now*0.035+a.phase);
      ctx.strokeStyle='rgba(255,176,74,'+(0.45+0.40*pulse).toFixed(3)+')';
      ctx.lineWidth=Math.max(1.2,T2*0.065);
      ctx.beginPath();
      ctx.moveTo(px-T2*0.22,foot-T2*1.08); ctx.lineTo(px,foot-T2*1.28); ctx.lineTo(px+T2*0.22,foot-T2*1.08);
      ctx.stroke();
    }
    if(fleeing){
      ctx.fillStyle = 'rgba(255,120,50,0.85)';
      ctx.fillRect(px+T2*0.22,foot-T2*0.98,T2*0.06,T2*0.16);
    }
    if(a.hp < a.maxHp*0.3 && Math.sin(now*0.02 + a.phase*7) > 0.3){
      ctx.fillStyle = 'rgba(255,110,45,0.90)';
      ctx.fillRect(px-T2*0.1+Math.sin(a.phase*11)*T2*0.14, foot-T2*0.48, 2, 2);
    }
    drawAlienSpeech(ctx,a,px,foot-T2*1.05*heightScale,T2,now);
    if(a.hp < a.maxHp) drawHealthBar(ctx,px,foot-T2*0.98*heightScale,T2*0.66*bodyScale,a.hp/a.maxHp);
  }
  // Transit FX. Beam: a tapered column of light standing over the unit, brightest
  // at the moment of the snatch, with a matching shaft where it sets down. Burrow:
  // a churning mound of spoil around the unit as it chews in and heaves back out.
  // The unit itself fades through the middle of the sequence, so the swap of
  // position happens behind the brightest/dirtiest frame rather than in plain view.
  function extractFade(e){
    if(!e) return 1;
    const k = clamp(e.t / (e.phase === 'out' ? e.outDur : e.inDur), 0, 1);
    return e.phase === 'out' ? Math.max(0.12, 1 - k * 0.95) : Math.min(1, 0.15 + k * 1.1);
  }
  function drawExtractionFx(ctx,a,TILE_SIZE,now){
    const e = a.extract;
    if(!e) return;
    const T2 = TILE_SIZE;
    const px = a.x * T2, foot = a.y * T2;
    const k = clamp(e.t / (e.phase === 'out' ? e.outDur : e.inDur), 0, 1);
    // strongest at the hand-off (end of 'out', start of 'in')
    const power = e.phase === 'out' ? k : 1 - k;
    ctx.save();
    if(e.kind === 'beam'){
      const h = T2 * 15;
      const topW = T2 * (0.55 + power * 0.5);
      const botW = T2 * (1.05 + power * 0.95);
      const grad = ctx.createLinearGradient(px, foot - h, px, foot + T2 * 0.2);
      grad.addColorStop(0, 'rgba(150,255,220,0)');
      grad.addColorStop(0.55, 'rgba(140,255,210,' + (0.10 + power * 0.20).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(220,255,240,' + (0.20 + power * 0.42).toFixed(3) + ')');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(px - topW, foot - h);
      ctx.lineTo(px + topW, foot - h);
      ctx.lineTo(px + botW, foot + T2 * 0.18);
      ctx.lineTo(px - botW, foot + T2 * 0.18);
      ctx.closePath();
      ctx.fill();
      // rungs of light sliding up the shaft
      ctx.strokeStyle = 'rgba(200,255,235,' + (0.12 + power * 0.28).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, T2 * 0.06);
      for(let i=0;i<4;i++){
        const slide = ((now * 0.0016 + i * 0.25) % 1);
        const yy = foot + T2 * 0.18 - slide * h;
        const w = botW + (topW - botW) * slide;
        ctx.globalAlpha = (1 - slide) * (0.5 + power * 0.5);
        ctx.beginPath();
        ctx.moveTo(px - w, yy);
        ctx.lineTo(px + w, yy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // ground pool under the column
      ctx.fillStyle = 'rgba(190,255,230,' + (0.10 + power * 0.30).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(px, foot + T2 * 0.1, botW * 0.9, T2 * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // spoil heap + flying clods
      const r = T2 * (0.5 + power * 0.55);
      ctx.fillStyle = 'rgba(96,68,44,' + (0.35 + power * 0.45).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(px, foot + T2 * 0.12, r * 1.5, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,102,66,' + (0.30 + power * 0.42).toFixed(3) + ')';
      for(let i=0;i<7;i++){
        const ang = (now * 0.004 + i * 0.9) % (Math.PI * 2);
        const rad = r * (0.6 + ((i * 7919 % 100) / 100) * 0.9);
        const cx = px + Math.cos(ang) * rad * 1.4;
        const cy = foot + T2 * 0.05 - Math.abs(Math.sin(ang)) * rad * (0.5 + power);
        const s = T2 * (0.07 + ((i * 104729 % 100) / 100) * 0.09);
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      }
    }
    ctx.restore();
  }
  function deathSmooth(v){
    const k=clamp(Number(v)||0,0,1);
    return k*k*(3-2*k);
  }
  function drawDeathBody(ctx,fx,TILE_SIZE,now,opts){
    opts=opts||{};
    const px=fx.x*TILE_SIZE,foot=fx.y*TILE_SIZE;
    ctx.save();
    ctx.globalAlpha=clamp(opts.alpha==null?1:opts.alpha,0,1);
    ctx.translate(px+(Number(opts.x)||0)*TILE_SIZE,foot+(Number(opts.y)||0)*TILE_SIZE);
    ctx.rotate(Number(opts.rot)||0);
    ctx.scale(opts.sx==null?1:Number(opts.sx),opts.sy==null?1:Number(opts.sy));
    ctx.translate(-px,-foot);
    if(fx.kind==='molekin') drawMolekin(ctx,fx.pose,TILE_SIZE,now);
    else drawAlien(ctx,fx.pose,TILE_SIZE,now);
    ctx.restore();
  }
  function drawDeathFragments(ctx,fx,TILE_SIZE,p,opts){
    opts=opts||{};
    const count=Math.max(1,Math.min(22,Number(opts.count)||8));
    const radial=Number(opts.radial)||1;
    const gravity=Number(opts.gravity)||0;
    const lift=Number(opts.lift)||0;
    const spread=Number(opts.spread)||Math.PI*2;
    const base=Number(opts.angle)||-Math.PI/2;
    const px=fx.x*TILE_SIZE,py=(fx.y-(Number(opts.originY)||0.42)*fx.scale)*TILE_SIZE;
    ctx.save();
    ctx.globalAlpha=clamp((opts.alpha==null?1:opts.alpha)*(1-p),0,1);
    for(let i=0;i<count;i++){
      const jitter=(deathRand(fx.seed,i*5+1)-0.5)*spread;
      const ang=spread>=Math.PI*1.9?deathRand(fx.seed,i*5+2)*Math.PI*2:base+jitter;
      const speed=0.55+deathRand(fx.seed,i*5+3)*0.85;
      const dist=TILE_SIZE*radial*p*speed;
      const x=px+Math.cos(ang)*dist+(Number(opts.drift)||0)*p*TILE_SIZE;
      const y=py+Math.sin(ang)*dist-lift*p*TILE_SIZE+gravity*p*p*TILE_SIZE;
      const size=TILE_SIZE*(0.045+deathRand(fx.seed,i*5+4)*0.075)*(Number(opts.size)||1)*fx.scale;
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate((deathRand(fx.seed,i*5+5)-0.5)*2.4+p*(i%2?-5:5));
      ctx.fillStyle=i%3===0?fx.accent:(i%2?fx.primary:fx.secondary);
      const shape=opts.shape||'shard';
      if(shape==='round'){
        ctx.beginPath();ctx.arc(0,0,size*0.58,0,Math.PI*2);ctx.fill();
      } else if(shape==='wing'){
        ctx.beginPath();ctx.moveTo(-size,0);ctx.quadraticCurveTo(0,-size*0.72,size,0);ctx.quadraticCurveTo(0,size*0.25,-size,0);ctx.fill();
      } else if(shape==='rock'){
        ctx.beginPath();ctx.moveTo(-size*0.8,-size*0.25);ctx.lineTo(-size*0.18,-size);ctx.lineTo(size*0.86,-size*0.42);ctx.lineTo(size*0.65,size*0.72);ctx.lineTo(-size*0.55,size*0.62);ctx.closePath();ctx.fill();
      } else if(shape==='plate'){
        ctx.fillRect(-size,-size*0.38,size*2,size*0.76);
      } else {
        ctx.beginPath();ctx.moveTo(-size,-size*0.24);ctx.lineTo(size*0.9,-size*0.62);ctx.lineTo(size*0.32,size);ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  function drawDeathSeal(ctx,fx,TILE_SIZE,p){
    const early=clamp(1-p/0.48,0,1);
    const px=fx.x*TILE_SIZE,py=(fx.y-0.48*fx.scale)*TILE_SIZE;
    const rings=fx.giant?3:1;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<rings;i++){
      const delay=i*0.08;
      const q=clamp((p-delay)/Math.max(0.12,0.42-delay),0,1);
      ctx.globalAlpha=(1-q)*(fx.giant?0.72:0.58);
      ctx.strokeStyle=i%2?fx.primary:fx.accent;
      ctx.lineWidth=Math.max(1,TILE_SIZE*(fx.giant?0.085:0.045));
      ctx.beginPath();ctx.arc(px,py,TILE_SIZE*fx.scale*(0.12+q*(fx.giant?1.15:0.62)),0,Math.PI*2);ctx.stroke();
    }
    if(early>0){
      const r=TILE_SIZE*fx.scale*(0.18+0.22*(1-early));
      ctx.globalAlpha=early;
      ctx.strokeStyle=fx.secondary;
      ctx.lineWidth=Math.max(1,TILE_SIZE*0.055);
      ctx.beginPath();
      ctx.moveTo(px-r*1.55,py);ctx.lineTo(px+r*1.55,py);
      ctx.moveTo(px,py-r*1.55);ctx.lineTo(px,py+r*1.55);
      ctx.stroke();
      ctx.fillStyle=fx.accent;ctx.beginPath();ctx.arc(px,py,r*0.34,0,Math.PI*2);ctx.fill();
    }
    // A small rising diamond is the universal kill-confirmation reward cue;
    // its count/size/color still reflects chaff, elites, commanders and giants.
    const rewardCount=fx.giant?3:(fx.commander||fx.elite?2:1);
    for(let i=0;i<rewardCount;i++){
      const q=clamp((p-i*0.05)/0.9,0,1);
      const x=px+(i-(rewardCount-1)/2)*TILE_SIZE*0.22*fx.scale;
      const y=py-TILE_SIZE*(0.18+q*(fx.giant?1.15:0.65))*fx.scale;
      const s=TILE_SIZE*(fx.chaff?0.055:(fx.giant?0.13:0.085))*fx.scale*(1-q*0.35);
      ctx.globalAlpha=clamp((1-q)*0.90,0,1);
      ctx.fillStyle=fx.commander||fx.giant?'#ffe878':fx.accent;
      ctx.beginPath();ctx.moveTo(x,y-s);ctx.lineTo(x+s*0.62,y);ctx.lineTo(x,y+s);ctx.lineTo(x-s*0.62,y);ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }
  function drawDeathEffect(ctx,fx,TILE_SIZE,now){
    const p=clamp(fx.t/Math.max(0.001,fx.life),0,1);
    const s=deathSmooth(p);
    const f=fx.facing||1;
    const px=fx.x*TILE_SIZE,foot=fx.y*TILE_SIZE;
    switch(fx.style){
      case 'alien_lander_breakup': {
        const q=deathSmooth(p);
        ctx.save();ctx.translate(px,foot+TILE_SIZE*0.28*q);ctx.rotate(0.18*q);ctx.globalAlpha=1-p;
        ctx.fillStyle='#263942';ctx.beginPath();ctx.ellipse(0,0,TILE_SIZE*(1.75-p*0.35),TILE_SIZE*(0.42-p*0.10),0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=fx.primary;ctx.lineWidth=Math.max(1.5,TILE_SIZE*0.065);
        for(let i=-2;i<=2;i++){const ox=i*TILE_SIZE*0.55*(1+p*0.55);ctx.beginPath();ctx.moveTo(ox,-TILE_SIZE*0.12);ctx.lineTo(ox+(i%2?1:-1)*TILE_SIZE*0.32,TILE_SIZE*(0.18+p*0.35));ctx.stroke();}
        ctx.restore();
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:18,radial:1.45,gravity:1.15,lift:0.28,shape:'plate',size:0.92,originY:0});
        if(p>0.24){const w=clamp((p-0.24)/0.76,0,1);ctx.save();ctx.globalAlpha=(1-w)*0.75;ctx.strokeStyle=fx.accent;ctx.lineWidth=Math.max(2,TILE_SIZE*0.08);ctx.beginPath();ctx.ellipse(px,foot,TILE_SIZE*(0.35+w*2.5),TILE_SIZE*(0.12+w*0.65),0,0,Math.PI*2);ctx.stroke();ctx.restore();}
        break;
      }
      case 'alien_phase_out': {
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p,sx:1-p*0.42,sy:1+p*0.16,y:-p*0.28});
        ctx.save();ctx.globalAlpha=1-p;ctx.fillStyle=fx.primary;
        for(let i=0;i<7;i++){
          const q=(p+i/7)%1;
          ctx.fillRect(px-TILE_SIZE*fx.scale*(0.38-q*0.18),foot-TILE_SIZE*fx.scale*(0.15+q*1.0),TILE_SIZE*fx.scale*(0.76-q*0.36),Math.max(1,TILE_SIZE*0.025));
        }
        ctx.restore();
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:8,radial:0.55,lift:1.15,shape:'shard',size:0.7});
        break;
      }
      case 'alien_skitter_pop':
        if(p<0.46) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p/0.46,sx:1+p*0.75,sy:1-p*0.35});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:11,radial:1.12,gravity:0.55,shape:'round',size:0.72});
        break;
      case 'alien_hound_tumble':
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p,rot:f*1.42*s,x:f*0.72*s,y:-Math.sin(Math.PI*p)*0.38+0.14*s,sx:1,sy:1-p*0.18});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:7,radial:0.72,gravity:0.45,spread:1.4,angle:f>0?Math.PI:0,shape:'shard',size:0.62,originY:0.12});
        break;
      case 'alien_glider_spiral':
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p,rot:f*p*Math.PI*2.6,x:Math.sin(p*Math.PI*4)*0.45,y:p*1.18-0.20,sx:1-p*0.24,sy:1-p*0.12});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:10,radial:0.82,gravity:1.2,lift:0.18,shape:'wing',size:0.82});
        break;
      case 'alien_jelly_bloom': {
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p,sx:1+p*0.72,sy:1+p*0.46,y:-p*0.18});
        ctx.save();ctx.lineWidth=Math.max(1,TILE_SIZE*0.045);
        for(let i=0;i<4;i++){
          const q=clamp((p-i*0.09)/(0.72-i*0.06),0,1);
          ctx.globalAlpha=(1-q)*0.72;ctx.strokeStyle=i%2?fx.primary:fx.accent;
          ctx.beginPath();ctx.arc(px,foot-TILE_SIZE*0.48*fx.scale,TILE_SIZE*fx.scale*(0.18+q*(0.65+i*0.08)),0,Math.PI*2);ctx.stroke();
        }
        ctx.restore();
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:8,radial:0.60,lift:1.05,shape:'round',size:0.72});
        break;
      }
      case 'alien_jetpack_launch': {
        const q=clamp(p/0.68,0,1);
        if(p<0.72) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-q*0.78,rot:-f*q*0.65,x:f*q*0.35,y:-q*q*2.75});
        ctx.save();ctx.globalAlpha=1-q*0.55;ctx.fillStyle=fx.accent;
        for(let i=0;i<5;i++){
          const y=foot+TILE_SIZE*(0.08+i*0.22-q*1.85);
          const w=TILE_SIZE*(0.16+i*0.035)*(1-q*0.45);
          ctx.beginPath();ctx.moveTo(px-w,y);ctx.lineTo(px+w,y);ctx.lineTo(px,y+TILE_SIZE*(0.35+i*0.08));ctx.closePath();ctx.fill();
        }
        ctx.restore();
        if(p>0.38) drawDeathFragments(ctx,fx,TILE_SIZE,clamp((p-0.38)/0.62,0,1),{count:12,radial:1.30,gravity:0.35,shape:'plate',size:0.68,originY:1.45});
        break;
      }
      case 'alien_armor_shatter': {
        const q=clamp(p/0.58,0,1);
        if(p<0.62) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-q*0.80,rot:f*0.26*q,y:0.30*q,sx:1+0.08*q,sy:1-0.36*q});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:13,radial:1.12,gravity:1.25,lift:0.32,shape:'plate',size:1.05});
        break;
      }
      case 'alien_colossus_fall': {
        const q=deathSmooth(clamp((p-0.06)/0.72,0,1));
        if(p<0.86) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:clamp((0.90-p)/0.22,0,1),rot:f*q*1.34,x:f*q*0.24,y:q*0.20,sx:1,sy:1-q*0.08});
        if(p>0.42){
          const w=clamp((p-0.42)/0.58,0,1);
          ctx.save();ctx.globalAlpha=(1-w)*0.82;ctx.strokeStyle=fx.accent;ctx.lineWidth=Math.max(2,TILE_SIZE*0.10);
          for(let i=0;i<3;i++){ const r=TILE_SIZE*fx.scale*(0.35+w*(1.3+i*0.55));ctx.beginPath();ctx.ellipse(px+f*TILE_SIZE*0.55,foot+TILE_SIZE*0.05,r,r*0.17,0,0,Math.PI*2);ctx.stroke(); }
          ctx.restore();
        }
        drawDeathFragments(ctx,fx,TILE_SIZE,clamp((p-0.28)/0.72,0,1),{count:18,radial:1.42,gravity:1.35,lift:0.42,shape:'plate',size:1.28});
        break;
      }
      case 'mole_burrow_sink': {
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:clamp((1-p)*1.35,0,1),y:p*0.78,sx:1+p*0.28,sy:1-p*0.64});
        ctx.save();ctx.globalAlpha=clamp(0.78-p*0.38,0,1);ctx.fillStyle=fx.primary;ctx.beginPath();ctx.ellipse(px,foot+TILE_SIZE*0.08,TILE_SIZE*fx.scale*(0.22+p*0.62),TILE_SIZE*fx.scale*(0.07+p*0.16),0,0,Math.PI*2);ctx.fill();ctx.restore();
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:9,radial:0.84,gravity:1.25,lift:0.75,shape:'rock',size:0.55,originY:0.05});
        break;
      }
      case 'mole_hound_dustroll':
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p,rot:f*p*Math.PI*2.15,x:f*p*0.95,y:-Math.sin(Math.PI*p)*0.28+0.12*p,sx:1,sy:1-p*0.24});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:10,radial:0.88,gravity:0.85,lift:0.30,spread:1.5,angle:f>0?Math.PI:0,shape:'round',size:0.72,originY:0.06});
        break;
      case 'mole_ember_pop':
        if(p<0.38) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p/0.38,sx:1-p*0.50,sy:1+p*0.55});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:13,radial:0.50,lift:1.65,spread:1.55,angle:-Math.PI/2,shape:'round',size:0.68});
        break;
      case 'mole_bat_ashfall':
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p,rot:f*(0.45*Math.sin(p*Math.PI*5)+p*1.35),x:Math.sin(p*Math.PI*5)*0.32,y:p*1.42-0.15,sx:1-p*0.38,sy:1-p*0.12});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:12,radial:0.62,gravity:1.45,lift:0.15,shape:'wing',size:0.66});
        break;
      case 'mole_beetle_split': {
        if(p<0.48) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p/0.52,sx:1+p*0.18,sy:1-p*0.24});
        const q=clamp((p-0.18)/0.82,0,1);
        ctx.save();ctx.globalAlpha=1-q;ctx.fillStyle=fx.primary;
        for(const side of [-1,1]){ctx.save();ctx.translate(px+side*TILE_SIZE*fx.scale*q*0.72,foot-TILE_SIZE*fx.scale*(0.36+Math.sin(q*Math.PI)*0.38));ctx.rotate(side*q*1.35);ctx.beginPath();ctx.ellipse(0,0,TILE_SIZE*fx.scale*0.30,TILE_SIZE*fx.scale*0.17,0,0,Math.PI*2);ctx.fill();ctx.restore();}
        ctx.restore();
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:8,radial:0.88,gravity:1.1,shape:'plate',size:0.65});
        break;
      }
      case 'mole_rocket_misfire': {
        const q=clamp(p/0.66,0,1);
        if(p<0.72) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-q*0.82,rot:f*q*1.12,x:f*q*1.35,y:-q*q*1.65});
        ctx.save();ctx.globalAlpha=1-q*0.45;
        for(let i=0;i<7;i++){const tq=clamp(q-i*0.07,0,1);ctx.fillStyle=i%2?fx.primary:'rgba(80,64,55,0.75)';ctx.beginPath();ctx.arc(px-f*TILE_SIZE*tq*(0.18+i*0.15),foot+TILE_SIZE*(0.04-tq*tq*1.38),TILE_SIZE*(0.05+i*0.012),0,Math.PI*2);ctx.fill();}
        ctx.restore();
        if(p>0.36) drawDeathFragments(ctx,fx,TILE_SIZE,clamp((p-0.36)/0.64,0,1),{count:12,radial:1.22,gravity:0.52,shape:'rock',size:0.72,originY:0.82});
        break;
      }
      case 'mole_rock_crumble': {
        const q=clamp(p/0.62,0,1);
        if(p<0.66) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-q*0.86,y:0.34*q,sx:1+0.22*q,sy:1-0.60*q});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:16,radial:0.88,gravity:1.75,lift:0.34,shape:'rock',size:1.08});
        break;
      }
      case 'mole_colossus_cavein': {
        const q=deathSmooth(clamp((p-0.05)/0.68,0,1));
        if(p<0.84) drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:clamp((0.9-p)/0.24,0,1),rot:-f*q*0.34,y:q*0.38,sx:1+q*0.32,sy:1-q*0.58});
        const rockP=clamp((p-0.14)/0.86,0,1);
        drawDeathFragments(ctx,fx,TILE_SIZE,rockP,{count:20,radial:0.78,gravity:2.45,lift:0.10,shape:'rock',size:1.34,originY:1.55});
        if(p>0.44){const w=clamp((p-0.44)/0.56,0,1);ctx.save();ctx.globalAlpha=(1-w)*0.78;ctx.strokeStyle=fx.primary;ctx.lineWidth=Math.max(2,TILE_SIZE*0.11);for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(px,foot+TILE_SIZE*0.08,TILE_SIZE*fx.scale*(0.3+w*(1.0+i*0.58)),TILE_SIZE*fx.scale*(0.08+w*0.18),0,0,Math.PI*2);ctx.stroke();}ctx.restore();}
        break;
      }
      default:
        drawDeathBody(ctx,fx,TILE_SIZE,now,{alpha:1-p,rot:f*s*0.8,y:s*0.25});
        drawDeathFragments(ctx,fx,TILE_SIZE,p,{count:8,radial:0.9,gravity:0.9});
        break;
    }
    drawDeathSeal(ctx,fx,TILE_SIZE,p);
  }
  function drawDeathEffects(ctx,TILE_SIZE,visible,now){
    for(const fx of deathFx){
      if(!fx||!visible(fx.x,fx.y)) continue;
      drawDeathEffect(ctx,fx,TILE_SIZE,now);
    }
  }
  function draw(ctx,tileSize,canDrawTile){
    const TILE_SIZE = tileSize || DEFAULT_TILE;
    const visible = (x,y)=> typeof canDrawTile === 'function' ? !!canDrawTile(Math.floor(x),Math.floor(y)) : true;
    const now = nowMs();
    ctx.save();
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      if(isMolekinTeam(team)){
        const b = team.burrow;
        if(b && visible(b.x,b.targetY)) drawBurrow(ctx,team,TILE_SIZE,now);
        continue;
      }
      const l = team.lander;
      if(l && visible(l.x,l.y)) drawLander(ctx,l,TILE_SIZE,now);
    }
    drawAlienChargeFx(ctx,TILE_SIZE,visible,now);
    drawLaserFx(ctx,TILE_SIZE,visible);
    drawMoleShotFx(ctx,TILE_SIZE,visible);
    // Draw after projectiles but before living units: falling bodies remain
    // readable without permanently covering survivors in a dense horde.
    drawDeathEffects(ctx,TILE_SIZE,visible,now);
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0 || !visible(a.x,a.y)) continue;
        if(a.extract) drawExtractionFx(ctx,a,TILE_SIZE,now);
        const fade = extractFade(a.extract);
        if(fade < 1) ctx.globalAlpha = fade;
        if(isMolekinTeam(team)) drawMolekin(ctx,a,TILE_SIZE,now);
        else drawAlien(ctx,a,TILE_SIZE,now);
        if(fade < 1) ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  function dynamicLootKeys(){
    return ['capes','eyes','outfits','weapons','charms'];
  }
  function removeDynamicLootItems(ids){
    if(!ids || !ids.size || !MM.dynamicLoot) return 0;
    let removed = 0;
    for(const key of dynamicLootKeys()){
      const arr = MM.dynamicLoot[key];
      if(!Array.isArray(arr)) continue;
      for(let i=arr.length-1; i>=0; i--){
        const item = arr[i];
        if(item && ids.has(item.id)){
          arr.splice(i,1);
          removed++;
        }
      }
    }
    if(removed){
      try{ if(MM.chests && MM.chests.saveDynamicLoot) MM.chests.saveDynamicLoot(); }catch(e){}
    }
    return removed;
  }
  function stealResources(inv,resourceKeys){
    const stolen = {};
    if(!inv) return stolen;
    for(const key of resourceKeys || []){
      const cur = Math.max(0, Math.floor(Number(inv[key]) || 0));
      if(cur <= 0) continue;
      let n = cur === 1 ? (Math.random() < 0.5 ? 1 : 0) : Math.floor(cur * (0.42 + Math.random()*0.18));
      n = Math.max(0, Math.min(cur,n));
      if(n > 0){
        stolen[key] = n;
        inv[key] = cur - n;
      }
    }
    return stolen;
  }
  function stealGear(inventory){
    if(!inventory || typeof inventory.snapshot !== 'function' || typeof inventory.restore !== 'function') return {gear:[],equipped:{}};
    const snap = inventory.snapshot();
    if(!snap || !Array.isArray(snap.bag)) return {gear:[],equipped:{}};
    const bag = snap.bag.filter(i=>i && typeof i.id === 'string');
    if(!bag.length) return {gear:[],equipped:{}};
    const stealN = Math.max(1, Math.floor(bag.length / 2));
    const chosen = new Set();
    const equipped = snap.equipped && typeof snap.equipped === 'object' ? snap.equipped : {};
    const dynamicIds = new Set(bag.map(i=>i.id));
    const equippedIds = shuffle(Object.values(equipped).filter(id=>typeof id === 'string' && dynamicIds.has(id)));
    for(const id of equippedIds){
      if(chosen.size >= stealN) break;
      if(Math.random() < 0.72) chosen.add(id);
    }
    for(const item of shuffle(bag.slice())){
      if(chosen.size >= stealN) break;
      chosen.add(item.id);
    }
    if(!chosen.size) return {gear:[],equipped:{}};
    const stolenGear = bag.filter(item=>chosen.has(item.id)).map(item=>Object.assign({}, item));
    const next = deepCopy(snap);
    next.bag = (next.bag || []).filter(item=>!(item && chosen.has(item.id)));
    next.newItems = Array.isArray(next.newItems) ? next.newItems.filter(id=>!chosen.has(id)) : [];
    next.shortcutOff = Array.isArray(next.shortcutOff) ? next.shortcutOff.filter(id=>!chosen.has(id)) : [];
    const stolenEquipped = {};
    const slots = Array.isArray(inventory.SLOTS) ? inventory.SLOTS : [
      {id:'cape',required:true,def:'classic'},
      {id:'eyes',required:true,def:'bright'},
      {id:'outfit',required:true,def:'default'},
      {id:'weapon',required:false,def:null},
      {id:'charm',required:false,def:null}
    ];
    next.equipped = next.equipped && typeof next.equipped === 'object' ? next.equipped : {};
    for(const slot of slots){
      const cur = next.equipped[slot.id];
      if(cur && chosen.has(cur)){
        stolenEquipped[slot.id] = cur;
        next.equipped[slot.id] = slot.required ? slot.def : null;
      }
    }
    let restored = false;
    try{ restored = inventory.restore(next,{persist:true,silent:false}) !== false; }catch(e){ restored = false; }
    if(!restored) return {gear:[],equipped:{}};
    removeDynamicLootItems(chosen);
    return {gear:stolenGear,equipped:stolenEquipped};
  }
  function resourceCount(obj){
    let total = 0;
    for(const k in obj || {}) total += Math.max(0, Math.floor(Number(obj[k]) || 0));
    return total;
  }
  function findCacheSpot(player,getTile,ctx){
    const px = floor(player && Number.isFinite(player.x) ? player.x : 0);
    const py = player && Number.isFinite(player.y) ? player.y : surfaceY(px,60);
    const dirs = shuffle([-1,1]);
    const candidates = [];
    for(const dir of dirs){
      for(let d=18; d<=72; d+=4){
        candidates.push(px + dir * (d + Math.floor(Math.random()*3)));
      }
    }
    for(const x of candidates){
      const s = findSurfaceStandSpot(x,py,getTile);
      const tx = floor(s.x);
      const ty = floor(s.y);
      for(let y=ty; y>=ty-4; y--){
        const here = readTile(getTile,tx,y);
        const below = readTile(getTile,tx,y+1);
        if(isReplaceableNaturalOpenTile(here,false) && here !== T.WATER && below !== T.WATER && below !== T.LAVA && isObjectFootingTile(below)){
          if(ctx && typeof ctx.ensureChunkAtY === 'function') try{ ctx.ensureChunkAtY(Math.floor(tx/64), y); }catch(e){}
          return {x:tx,y};
        }
      }
    }
    const fallback = findSurfaceStandSpot(px + (Math.random()<0.5?-36:36),py,getTile);
    return {x:floor(fallback.x), y:floor(fallback.y)};
  }
  function onHeroKilled(ctx){
    ctx = ctx || {};
    const inv = ctx.inv || root.inv;
    const inventory = ctx.inventory || MM.inventory;
    const stolenResources = stealResources(inv, ctx.resourceKeys || []);
    const stolenGear = stealGear(inventory);
    const totalResources = resourceCount(stolenResources);
    const totalGear = stolenGear.gear.length;
    if(totalResources <= 0 && totalGear <= 0){
      say('Obcy przeszukali plecak, ale nie mieli czego zabrac.');
      return {handled:true,empty:true};
    }
    const player = ctx.player || {};
    const spot = findCacheSpot(player,ctx.getTile,ctx);
    const cache = {
      id:'cache_'+(seq++),
      x:spot.x,
      y:spot.y,
      resources:stolenResources,
      gear:stolenGear.gear,
      equipped:stolenGear.equipped,
      seed:getWorldSeed(),
      createdAt:Date.now()
    };
    // runtime cap mirrors the save-restore cap (slice(0,24)): unrecovered caches
    // from endless deaths must not grow the 3s snapshot/deep-copy cycle forever
    while(caches.length>=24){
      const old=caches.shift();
      try{
        completeCacheTask(old);
        if(old && Number.isFinite(old.x) && Number.isFinite(old.y) && ctx.getTile(old.x,old.y)===T.INVASION_CACHE){
          writeTile(ctx.setTile,old.x,old.y,T.AIR);
          wakeTileChanged(ctx,old.x,old.y,T.INVASION_CACHE,T.AIR);
        }
      }catch(e){}
    }
    caches.push(cache);
    writeTile(ctx.setTile,spot.x,spot.y,T.INVASION_CACHE);
    wakeTileChanged(ctx,spot.x,spot.y,T.AIR,T.INVASION_CACHE);
    syncCacheTask(cache);
    burst(spot.x+0.5,spot.y+0.5,'epic');
    say('Obcy zabrali lup i ukryli skrytke gdzies w okolicy.');
    play('grave',cache);
    saveLocal();
    markHostSave(ctx);
    return {handled:true,cache,resources:totalResources,gear:totalGear};
  }
  function restoreCacheLoot(cache,ctx){
    const inv = ctx.inv || root.inv;
    const inventory = ctx.inventory || MM.inventory;
    const got = [];
    for(const key in cache.resources || {}){
      const n = Math.max(0, Math.floor(Number(cache.resources[key]) || 0));
      if(n > 0 && inv && typeof inv[key] === 'number'){
        inv[key] += n;
        got.push(n+'x '+key);
      }
    }
    let gearCount = 0;
    if(inventory && typeof inventory.grantItem === 'function'){
      for(const item of cache.gear || []){
        if(item && item.id && inventory.grantItem(item,{markNew:true,essential:true})) gearCount++;
      }
      if(cache.equipped && typeof inventory.equip === 'function'){
        for(const slot in cache.equipped){
          const id = cache.equipped[slot];
          if(typeof id === 'string') inventory.equip(id);
        }
      }
    }
    return {resourceStacks:got.length,resourceUnits:resourceCount(cache.resources),gearCount};
  }
  function openCacheAt(tx,ty,ctx){
    ctx = ctx || {};
    if(readTile(ctx.getTile,tx,ty) !== T.INVASION_CACHE) return false;
    const idx = caches.findIndex(c=>c && c.x === tx && c.y === ty);
    writeTile(ctx.setTile,tx,ty,T.AIR);
    wakeTileChanged(ctx,tx,ty,T.INVASION_CACHE,T.AIR);
    if(idx < 0){
      say('Pusta skrytka obcych.');
      return true;
    }
    const cache = caches.splice(idx,1)[0];
    completeCacheTask(cache);
    const restored = restoreCacheLoot(cache,ctx);
    try{ if(typeof ctx.updateInventory === 'function') ctx.updateInventory(); }catch(e){}
    burst(tx+0.5,ty+0.5,'epic');
    play('chest',{x:tx+0.5,y:ty+0.5});
    const parts = [];
    if(restored.resourceUnits) parts.push(restored.resourceUnits+' zasobow');
    if(restored.gearCount) parts.push(restored.gearCount+' przedm.');
    say('Odzyskano skrytke obcych: '+(parts.length ? parts.join(', ') : 'pusto')+'.');
    saveLocal();
    markHostSave(ctx);
    return true;
  }
  // Persist only durable unit facts; transient tactics (_ai paths, tokens,
  // cover spots) are rebuilt by the squad brain after load.
  function serializeAlien(a){
    const kind = a.kind === 'molekin' ? 'molekin' : 'aliens';
    return {
      id:a.id, kind, teamId:a.teamId,
      x:a.x, y:a.y, vx:a.vx, vy:a.vy,
      hp:a.hp, maxHp:a.maxHp,
      attackCd:a.attackCd, breakCd:a.breakCd,
      onGround:a.onGround, facing:a.facing,
      dead:a.dead, role:a.role || '',
      form:normalizeUnitForm(kind,a.form),
      weaponType:normalizeUnitWeapon(kind,a.weaponType),
      mobility:isFlyingUnit(a) ? String(a.mobility) : 'ground',
      isPet:!!a.isPet,
      giant:!!a.giant,
      chaff:!!a.chaff,
      silent:!!a.silent,
      elite:!!a.elite,
      grade:Number.isFinite(Number(a.grade)) ? Math.max(0,Math.min(3,Math.floor(Number(a.grade)))) : 0,
      gradeName:a.gradeName || THREAT_GRADE_NAMES[Math.max(0,Math.min(3,Math.floor(Number(a.grade)||0)))] || THREAT_GRADE_NAMES[0],
      weaponTier:Number.isFinite(Number(a.weaponTier)) ? Math.max(0,Math.min(3,Math.floor(Number(a.weaponTier)))) : 0,
      threatLevel:Number.isFinite(Number(a.threatLevel)) ? Math.max(1,Math.floor(Number(a.threatLevel))) : 1,
      speedMult:a.speedMult, jumpMult:a.jumpMult, damageMult:a.damageMult,
      damageTakenMult:a.damageTakenMult, healMult:a.healMult, hitboxScale:a.hitboxScale,
      variant:normalizeUnitVariant(kind,a.variant,a.role || 'rusher'),
      phase:a.phase
    };
  }
  function serializeTeam(t){
    return {
      id:t.id, kind:t.kind, day:t.day, index:t.index, state:t.state,
      x:t.x, y:t.y, alienCount:t.alienCount, xpReward:t.xpReward,
      encounter:normalizeEncounter(t.encounter,t.horde ? 'swarm' : 'classic'),
      loadoutSeed:(Number(t.loadoutSeed)||1)>>>0,
      playerLevel:t.playerLevel || 1,
      threatLevel:t.threatLevel || teamThreatLevel(t),
      grade:Number.isFinite(Number(t.grade)) ? Math.max(0,Math.min(3,Math.floor(Number(t.grade)))) : teamGrade(t),
      gradeName:t.gradeName || THREAT_GRADE_NAMES[teamGrade(t)] || THREAT_GRADE_NAMES[0],
      weaponTier:Number.isFinite(Number(t.weaponTier)) ? Math.max(0,Math.min(3,Math.floor(Number(t.weaponTier)))) : teamWeaponTier(t),
      commanderChance:t.commanderChance,
      forceCommander:!!t.forceCommander,
      forceRewardTier:t.forceRewardTier || '',
      forceRewardChance:Number.isFinite(Number(t.forceRewardChance)) ? clamp(Number(t.forceRewardChance),0,1) : undefined,
      rewardDropped:!!t.rewardDropped,
      ruinCommanderKey:t.ruinCommanderKey || '',
      startedAt:t.startedAt, lastSeenDay:t.lastSeenDay, lostContactDay:t.lostContactDay, defeatedAt:t.defeatedAt, retreatAt:t.retreatAt||0, announced:t.announced, horde:!!t.horde, eliteCount:t.eliteCount|0,
      builtTiles:Array.isArray(t.builtTiles) ? t.builtTiles.map(b=>({x:b.x,y:b.y})) : [],
      burrow:t.burrow ? Object.assign({}, t.burrow) : null,
      lander:t.lander ? Object.assign({}, t.lander) : null,
      aliens:t.aliens.map(serializeAlien)
    };
  }
  function snapshot(){
    return {
      v:1,
      lastNightDay,
      seq,
      teams:teams.map(serializeTeam),
      caches:caches.map(c=>deepCopy(c))
    };
  }
  function normalizeAlien(a,teamKind){
    if(!a || typeof a !== 'object') return null;
    const kind = teamKind === 'molekin' || a.kind === 'molekin' ? 'molekin' : 'aliens';
    const role = typeof a.role === 'string' ? a.role : '';
    const stats = unitRoleStats(kind,role || 'rusher');
    const form = normalizeUnitForm(kind,a.form);
    const formDef = formDefFor(kind,form);
    const weaponType = normalizeUnitWeapon(kind,a.weaponType);
    const variant = normalizeUnitVariant(kind,a.variant,role || 'rusher');
    const dead=!!a.dead || (Number(a.hp)||0) <= 0;
    return {
      id:String(a.id || 'alien'),
      kind,
      teamId:String(a.teamId || ''),
      x:finiteNum(a.x)?a.x:0,
      y:finiteNum(a.y)?a.y:0,
      vx:finiteNum(a.vx)?a.vx:0,
      vy:finiteNum(a.vy)?a.vy:0,
      hp:finiteNum(a.hp)?a.hp:1,
      maxHp:finiteNum(a.maxHp)?a.maxHp:Math.max(1,Number(a.hp)||1),
      attackCd:finiteNum(a.attackCd)?a.attackCd:0.5,
      breakCd:finiteNum(a.breakCd)?a.breakCd:0,
      onGround:!!a.onGround,
      facing:a.facing < 0 ? -1 : 1,
      hitFlashUntil:0,
      healFlashUntil:0,
      lastHealAt:0,
      lastHitAt:0,
      speechText:'',
      speechUntil:0,
      speechLong:false,
      nextSpeakAt:0,
      speechCue:'',
      speechCueUntil:0,
      dead,
      // A corpse restored from a save must not replay an old death. Runtime
      // systems that set dead/hp directly have no such marker and are caught
      // by updateTeams(), so every new death still gets feedback.
      deathFxSpawned:dead,
      role,
      form,
      weaponType,
      mobility:String(a.mobility || formDef.mobility || 'ground'),
      isPet:a.isPet === undefined ? !!formDef.pet : !!a.isPet,
      giant:a.giant === undefined ? !!formDef.giant : !!a.giant,
      chaff:!!a.chaff,
      silent:a.silent === undefined ? !!formDef.pet : !!a.silent,
      elite:!!a.elite,
      grade:Number.isFinite(Number(a.grade)) ? Math.max(0,Math.min(3,Math.floor(Number(a.grade)))) : 0,
      gradeName:a.gradeName || THREAT_GRADE_NAMES[Math.max(0,Math.min(3,Math.floor(Number(a.grade)||0)))] || THREAT_GRADE_NAMES[0],
      weaponTier:Number.isFinite(Number(a.weaponTier)) ? Math.max(0,Math.min(3,Math.floor(Number(a.weaponTier)))) : 0,
      threatLevel:Number.isFinite(Number(a.threatLevel)) ? Math.max(1,Math.floor(Number(a.threatLevel))) : 1,
      speedMult:finiteNum(a.speedMult)?clamp(a.speedMult,0.45,1.65):(stats.speed || 1),
      jumpMult:finiteNum(a.jumpMult)?clamp(a.jumpMult,0.55,1.55):(stats.jump || 1),
      damageMult:finiteNum(a.damageMult)?clamp(a.damageMult,0.35,2.30):(stats.damage || 1),
      damageTakenMult:finiteNum(a.damageTakenMult)?clamp(a.damageTakenMult,0.40,1.80):(stats.taken || 1),
      healMult:finiteNum(a.healMult)?clamp(a.healMult,0.40,2.20):(stats.heal || 1),
      hitboxScale:finiteNum(a.hitboxScale)?clamp(a.hitboxScale,0.42,2.55):clamp(((variant.body + variant.height) * 0.5),0.48,2.55),
      variant,
      phase:finiteNum(a.phase)?a.phase:0
    };
  }
  function normalizeBuiltTiles(list){
    if(!Array.isArray(list)) return [];
    const out = [];
    for(const b of list){
      if(b && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y))) out.push({x:floor(b.x),y:floor(b.y)});
      if(out.length >= 40) break;
    }
    return out;
  }
  function normalizeTeam(t){
    if(!t || typeof t !== 'object') return null;
    const kind = t.kind === 'molekin' ? 'molekin' : (t.kind === 'aliens' ? 'aliens' : String(t.kind || 'aliens'));
    const encounter = normalizeEncounter(t.encounter,t.horde ? 'swarm' : 'classic');
    const horde = !!t.horde || encounter === 'swarm';
    const day = Math.max(1, Number(t.day)||1);
    const playerLevel = Math.max(1, Math.min(PLAYER_LEVEL_CAP, Math.floor(Number(t.playerLevel) || 1)));
    const threatLevel = Number.isFinite(Number(t.threatLevel)) ? Math.max(1, Math.floor(Number(t.threatLevel))) : threatLevelFor(day,playerLevel,{});
    const grade = Number.isFinite(Number(t.grade)) ? Math.max(0, Math.min(3, Math.floor(Number(t.grade)))) : gradeForThreat(threatLevel);
    const weaponTier = Number.isFinite(Number(t.weaponTier)) ? Math.max(0, Math.min(3, Math.floor(Number(t.weaponTier)))) : weaponTierForThreat(threatLevel,grade);
    const alienCount = Math.max(0, Math.min(INVASION_MAX_ALIENS, Number(t.alienCount) || (Array.isArray(t.aliens) ? t.aliens.length : 0)));
    const lander = t.lander && typeof t.lander === 'object' ? t.lander : {};
    const burrow = t.burrow && typeof t.burrow === 'object' ? t.burrow : {};
    const normalizedAliens = Array.isArray(t.aliens) ? t.aliens.map(a=>normalizeAlien(a,kind)).filter(Boolean).slice(0,INVASION_MAX_ALIENS) : [];
    for(const a of normalizedAliens){
      // team baseline re-stamped, but per-unit standing survives: hordes stay
      // chaff (grade 0) and elites keep their +1 grade/tier crown across saves
      const bump = a.elite ? 1 : 0;
      const base = horde ? 0 : grade;
      const baseTier = horde ? 0 : weaponTier;
      a.grade = Math.min(3, base + bump);
      a.gradeName = THREAT_GRADE_NAMES[a.grade] || THREAT_GRADE_NAMES[0];
      a.weaponTier = Math.min(3, baseTier + bump);
      a.threatLevel = horde ? hordeThreatLevel(threatLevel) : threatLevel;
      if(horde) a.chaff = true;
    }
    return {
      id:String(t.id || ('inv_'+(seq++))),
      kind,
      day,
      index:Math.max(0, Number(t.index)||0),
      state:t.state === 'active' || t.state === 'defeated' || t.state === 'retreat' || t.state === 'landing' || t.state === 'burrowing' ? t.state : (kind === 'molekin' ? 'burrowing' : 'landing'),
      x:finiteNum(t.x)?t.x:0,
      y:finiteNum(t.y)?t.y:60,
      alienCount,
      playerLevel,
      threatLevel,
      grade,
      gradeName:THREAT_GRADE_NAMES[grade] || THREAT_GRADE_NAMES[0],
      weaponTier,
      encounter,
      loadoutSeed:(Number(t.loadoutSeed)||1)>>>0 || 1,
      commanderChance:finiteNum(t.commanderChance) ? clamp(Number(t.commanderChance),0,1) : undefined,
      forceCommander:!!t.forceCommander,
      forceRewardTier:typeof t.forceRewardTier === 'string' ? t.forceRewardTier : '',
      forceRewardChance:finiteNum(t.forceRewardChance) ? clamp(Number(t.forceRewardChance),0,1) : undefined,
      rewardDropped:!!t.rewardDropped,
      horde,
      eliteCount:Math.max(0, Math.min(INVASION_MAX_ALIENS, Number(t.eliteCount)||0)),
      ruinCommanderKey:typeof t.ruinCommanderKey === 'string' ? t.ruinCommanderKey : '',
      xpReward:Math.max(1, Number(t.xpReward)||xpRewardForTeam(day,alienCount||3,playerLevel,threatLevel)),
      startedAt:Number(t.startedAt)||Date.now(),
      lastSeenDay:Number.isFinite(Number(t.lastSeenDay)) ? Number(t.lastSeenDay) : currentDayInfo().dayFloat,
      lostContactDay:Number.isFinite(Number(t.lostContactDay)) ? Math.max(0, Number(t.lostContactDay)) : 0,
      defeatedAt:Number(t.defeatedAt)||0,
      // a save written mid-retreat must still sweep after load (retreatAt 0 would never trip the timer)
      retreatAt:Number(t.retreatAt) || (t.state === 'retreat' ? Date.now() : 0),
      announced:!!t.announced,
      builtTiles:normalizeBuiltTiles(t.builtTiles),
      burrow:kind === 'molekin' ? {
        x:finiteNum(burrow.x)?burrow.x:(finiteNum(t.x)?t.x:0),
        y:finiteNum(burrow.y)?burrow.y:(finiteNum(t.y)?t.y+12:72),
        targetY:finiteNum(burrow.targetY)?burrow.targetY:(finiteNum(t.y)?t.y:60),
        progress:finiteNum(burrow.progress)?clamp(burrow.progress,0,1):(t.state === 'active' ? 1 : 0),
        open:!!burrow.open || t.state === 'active',
        warned:!!burrow.warned,
        crackStage:Math.max(0, Math.min(2, Math.floor(Number(burrow.crackStage) || 0))),
        phase:finiteNum(burrow.phase)?burrow.phase:0
      } : null,
      lander:{
        x:finiteNum(lander.x)?lander.x:(finiteNum(t.x)?t.x:0),
        y:finiteNum(lander.y)?lander.y:(finiteNum(t.y)?t.y-3:57),
        targetY:finiteNum(lander.targetY)?lander.targetY:(finiteNum(t.y)?t.y-1.35:57),
        vx:finiteNum(lander.vx)?lander.vx:0,
        vy:finiteNum(lander.vy)?lander.vy:3.5,
        hp:finiteNum(lander.hp)?lander.hp:80,
        maxHp:finiteNum(lander.maxHp)?lander.maxHp:Math.max(80, Number(lander.hp)||80),
        destroyed:kind === 'molekin' ? false : !!lander.destroyed,
        landed:kind === 'molekin' ? (t.state === 'active' || !!lander.landed) : !!lander.landed,
        phase:finiteNum(lander.phase)?lander.phase:0,
        invisible:!!lander.invisible || kind === 'molekin'
      },
      aliens:normalizedAliens
    };
  }
  function normalizeCache(c){
    if(!c || typeof c !== 'object' || !Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.y))) return null;
    const resources = {};
    if(c.resources && typeof c.resources === 'object'){
      for(const k in c.resources){
        const n = Math.max(0, Math.floor(Number(c.resources[k]) || 0));
        if(n > 0) resources[k] = n;
      }
    }
    return {
      id:String(c.id || ('cache_'+(seq++))),
      x:floor(c.x),
      y:floor(c.y),
      resources,
      gear:Array.isArray(c.gear) ? c.gear.filter(i=>i && i.id).map(i=>Object.assign({},i)).slice(0,80) : [],
      equipped:c.equipped && typeof c.equipped === 'object' ? Object.assign({},c.equipped) : {},
      seed:Number(c.seed)||getWorldSeed(),
      createdAt:Number(c.createdAt)||Date.now()
    };
  }
  function restore(data,getTile,setTile){
    teams.length = 0;
    caches.length = 0;
    lasers.length = 0;
    moleShots.length = 0;
    deathFx.length = 0;
    ghostDeathSeen.clear();
    tileDamage.clear();
    brains.clear();
    lastIsNight = null; // a load that wakes up in daylight counts as a dawn: stale swarms stand down
    if(!data || typeof data !== 'object') return false;
    lastNightDay = Math.max(0, Number(data.lastNightDay)||0);
    seq = Math.max(1, Number(data.seq)||1);
    if(Array.isArray(data.teams)) teams.push(...data.teams.map(normalizeTeam).filter(Boolean).slice(0,12));
    for(const team of teams){
      // Older saves have no roles: re-roll so restored squads keep their variety.
      const missing = team.aliens.filter(a=>!a.role || !(profileFor(team).roles[a.role]));
      if(missing.length){
        const roles = assignRoles(missing.length, profileFor(team));
        for(let i=0;i<missing.length;i++) reseedAlienTraitsForRole(missing[i], roles[i] || 'rusher', team.kind);
      }
    }
    if(Array.isArray(data.caches)){
      caches.push(...data.caches.map(normalizeCache).filter(Boolean).slice(0,24));
      for(const c of caches){
        if(readTile(getTile,c.x,c.y) !== T.INVASION_CACHE) writeTile(setTile,c.x,c.y,T.INVASION_CACHE);
      }
    }
    syncCacheTasks();
    saveLocal();
    return true;
  }
  function reset(){
    teams.length = 0;
    caches.length = 0;
    lasers.length = 0;
    moleShots.length = 0;
    deathFx.length = 0;
    ghostDeathSeen.clear();
    tileDamage.clear();
    brains.clear();
    lastIsNight = null;
    lastNightDay = 0;
    seq = 1;
    moleShotSeq = 1;
    deathFxSeq = 1;
    lastDeathSoundAt = -Infinity;
    clearCacheTasks();
    saveLocal();
  }
  function metrics(){
    let aliens = 0, molekin = 0, siegeTeams = 0, builtTiles = 0, pets = 0, flyers = 0, giants = 0, chaff = 0;
    const forms = new Set(), weapons = new Set(), encounters = new Set();
    for(const t of teams){
      encounters.add(normalizeEncounter(t.encounter,t.horde ? 'swarm' : 'classic'));
      for(const a of t.aliens || []){
        if(!a || a.dead || a.hp <= 0) continue;
        if(isMolekinTeam(t)) molekin++;
        else aliens++;
        if(a.isPet) pets++;
        if(isFlyingUnit(a)) flyers++;
        if(a.giant) giants++;
        if(a.chaff) chaff++;
        forms.add(String(a.form || ''));
        weapons.add(String(a.weaponType || ''));
      }
      if(Array.isArray(t.builtTiles)) builtTiles += t.builtTiles.length;
      const brain = brains.get(t.id);
      if(brain && brain.mode === 'siege') siegeTeams++;
    }
    return {teams:teams.length, activeTeams:activeInvasionTeams().length, alienTeams:activeAlienTeams().length, moleTeams:activeMolekinTeams().length, aliens, molekin, invasionUnits:aliens + molekin, pets, flyers, giants, chaff, unitForms:forms.size, weaponVariants:weapons.size, encounterTypes:encounters.size, deathEffects:deathFx.length, deathStyles:new Set(deathFx.map(fx=>fx&&fx.style).filter(Boolean)).size, siegeTeams, builtTiles, caches:caches.length, lasers:lasers.length, moleShots:moleShots.length, lastNightDay};
  }
  function forceNightInvasion(player,getTile,setTile,opts){
    return spawnNightInvasion(player,getTile,setTile,opts || {});
  }
  function forceMolekinInvasion(player,getTile,setTile,opts){
    return spawnNightInvasion(player,getTile,setTile,Object.assign({}, opts || {}, {kind:'molekin'}));
  }
  function spawnRuinCommander(x,y,opts){
    opts = opts || {};
    if(!opts.forceAfterWestGuardian && westGuardianDefeated()) return null;
    const key = String(opts.key || ('ruin:'+floor(x)+','+floor(y)));
    if(teams.some(t=>t && t.ruinCommanderKey === key)) return null;
    rememberWorldAccess(opts.getTile,opts.setTile,opts.ctx || {});
    const player = opts.player || root.player || null;
    const day = Math.max(1, opts.day || currentDayInfo().dayIndex || 1);
    const playerLevel = playerLevelFor(player,opts);
    const baseThreat = threatLevelFor(day,playerLevel,opts);
    const threatLevel = Number.isFinite(opts.threatLevel) ? baseThreat : Math.max(day, Math.min(160, baseThreat + Math.max(0, Math.floor(Number(opts.threatBonus) || 0))));
    const grade = gradeForThreat(threatLevel);
    const weaponTier = weaponTierForThreat(threatLevel,grade);
    const id = 'ruin_cmd_'+(seq++);
    const team = {
      id,
      kind:'aliens',
      day,
      index:0,
      state:'active',
      x:Number.isFinite(Number(x)) ? Number(x) : 0,
      y:Number.isFinite(Number(y)) ? Number(y) : 60,
      alienCount:1,
      encounter:'classic',
      loadoutSeed:1,
      playerLevel,
      threatLevel,
      grade,
      gradeName:THREAT_GRADE_NAMES[grade] || THREAT_GRADE_NAMES[0],
      weaponTier,
      commanderChance:1,
      forceCommander:true,
      forceRewardTier:'epic',
      forceRewardChance:0,
      rewardDropped:true,
      ruinCommanderKey:key,
      xpReward:xpRewardForTeam(day,1,playerLevel,threatLevel),
      startedAt:Date.now(),
      lastSeenDay:currentDayInfo().dayFloat,
      defeatedAt:0,
      announced:true,
      builtTiles:[],
      lander:{
        x:Number.isFinite(Number(x)) ? Number(x) : 0,
        y:Number.isFinite(Number(y)) ? Number(y)-1.35 : 58.65,
        targetY:Number.isFinite(Number(y)) ? Number(y)-1.35 : 58.65,
        vx:0,
        vy:0,
        hp:0,
        maxHp:0,
        destroyed:true,
        landed:true,
        phase:Math.random()*Math.PI*2
      },
      aliens:[]
    };
    const now = nowMs();
    team.speechStartAt = now;
    team.nextReactionAt = 0;
    team.reactionCooldowns = {};
    team.heroHealthBand = '';
    const alien = makeAlien(team,team.x,team.y,0,'commander');
    alien.id = team.id+':commander';
    alien.x = team.x;
    alien.y = team.y;
    team.aliens.push(alien);
    tuneCommanderHealth(team);
    teams.push(team);
    triggerTeamSpeech(team,'commanderSight',{speaker:alien,now,force:true,cooldown:900,keyCooldown:3800});
    say('Zloty alien commander strzeze reliktu Hero-Prostokata.');
    play('warning',team);
    saveLocal();
    markHostSave(opts.ctx);
    return team;
  }

  try{
    if(root.localStorage){
      const raw = root.localStorage.getItem(SAVE_KEY);
      if(raw) restore(JSON.parse(raw));
    }
  }catch(e){}

  // --- ghost mirror: invasions, seen from the cheap seats ---------------------
  // A watcher never runs invasions.update() (it must not spawn, dig or steal), so
  // its squads used to stand frozen wherever the last full snapshot found them —
  // the landing party looked like statuary. Same contract as the mob plane in
  // mobs.js: a light roster of poses at high cadence, keyed by a signature, with
  // a full snapshot whenever the roster's shape changes. Slow props (a saucer
  // settling, a burrow grinding open) ride along so those animate too.
  function ghostLiveUnits(){
    const out=[];
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      for(const a of team.aliens){ if(a && !a.dead && a.hp > 0) out.push(a); }
    }
    return out;
  }
  function ghostDeathPacket(fx){
    const p=fx&&fx.pose||{};
    return {
      id:String(fx.id||''),teamId:String(fx.teamId||''),kind:fx.kind==='molekin'?'molekin':'aliens',form:String(fx.form||''),style:String(fx.style||''),
      x:Number(fx.x)||0,y:Number(fx.y)||0,vx:Number(fx.vx)||0,vy:Number(fx.vy)||0,facing:fx.facing<0?-1:1,scale:Number(fx.scale)||1,seed:Number(fx.seed)||1,
      t:Number(fx.t)||0,life:Number(fx.life)||1,eventAt:Number(fx.eventAt)||0,primary:String(fx.primary||''),secondary:String(fx.secondary||''),accent:String(fx.accent||''),element:String(fx.element||''),sound:String(fx.sound||''),
      giant:!!fx.giant,commander:!!fx.commander,elite:!!fx.elite,chaff:!!fx.chaff,isPet:!!fx.isPet,weaponType:String(fx.weaponType||''),
      pose:{
        id:String(p.id||''),kind:p.kind==='molekin'?'molekin':'aliens',x:Number(p.x)||0,y:Number(p.y)||0,vx:Number(p.vx)||0,vy:Number(p.vy)||0,
        facing:p.facing<0?-1:1,onGround:!!p.onGround,role:String(p.role||'rusher'),form:String(p.form||fx.form||''),weaponType:String(p.weaponType||fx.weaponType||''),
        isPet:!!p.isPet,giant:!!p.giant,chaff:!!p.chaff,elite:!!p.elite,grade:Number(p.grade)||0,weaponTier:Number(p.weaponTier)||0,
        hitboxScale:Number(p.hitboxScale)||Number(fx.scale)||1,phase:Number(p.phase)||0,variant:Object.assign({},p.variant||{})
      }
    };
  }
  function ghostApplyDeathEvents(events){
    if(!Array.isArray(events)) return 0;
    let added=0;
    for(const raw of events.slice(-GHOST_DEATH_FX_CAP)){
      if(!raw||typeof raw!=='object'||!raw.id||ghostDeathSeen.has(String(raw.id))) continue;
      if(!Number.isFinite(Number(raw.x))||!Number.isFinite(Number(raw.y))) continue;
      const kind=raw.kind==='molekin'?'molekin':'aliens';
      const profile=deathProfileFor({kind},{kind,form:raw.form});
      const pose=deathPoseFor(Object.assign({
        id:String(raw.id),kind,x:Number(raw.x),y:Number(raw.y),vx:Number(raw.vx)||0,vy:Number(raw.vy)||0,
        facing:Number(raw.facing)<0?-1:1,role:'rusher',form:String(raw.form||''),weaponType:String(raw.weaponType||''),
        isPet:!!raw.isPet,giant:!!raw.giant,chaff:!!raw.chaff,elite:!!raw.elite,grade:0,weaponTier:0,
        hitboxScale:Number(raw.scale)||1,phase:0,variant:{},hp:1,maxHp:1
      },raw.pose||{}));
      const fx={
        id:String(raw.id),teamId:String(raw.teamId||''),kind,form:String(raw.form||pose.form||''),style:String(raw.style||profile.style),
        x:Number(raw.x),y:Number(raw.y),vx:Number(raw.vx)||0,vy:Number(raw.vy)||0,facing:Number(raw.facing)<0?-1:1,
        scale:clamp(Number(raw.scale)||1,0.42,2.85),seed:Number(raw.seed)||textHash(raw.id),t:clamp(Number(raw.t)||0,0,Math.max(0.62,Number(raw.life)||profile.life)),
        life:Math.max(0.62,Number(raw.life)||profile.life),eventAt:Number(raw.eventAt)||0,primary:String(raw.primary||profile.primary),secondary:String(raw.secondary||profile.secondary),
        accent:String(raw.accent||profile.secondary),element:String(raw.element||profile.element),sound:String(raw.sound||profile.sound),
        giant:!!raw.giant,commander:!!raw.commander,elite:!!raw.elite,chaff:!!raw.chaff,isPet:!!raw.isPet,weaponType:String(raw.weaponType||''),
        stageTriggered:Number(raw.t)>=Math.max(0.62,Number(raw.life)||profile.life)*(Number(raw.eventAt)||0),ghost:true,pose
      };
      ghostDeathSeen.add(fx.id);
      deathFx.push(fx);
      emitDeathParticles(fx,0);
      playDeathCue(fx);
      added++;
    }
    while(ghostDeathSeen.size>256) ghostDeathSeen.delete(ghostDeathSeen.values().next().value);
    trimDeathFx();
    return added;
  }
  function ghostRoster(){
    const live=ghostLiveUnits();
    const live4=teams.filter(t=>t && t.state !== 'defeated');
    return {
      sig: live.map(a=>a.id).join('|'),
      poses: live.map(a=>[
        +a.x.toFixed(3), +a.y.toFixed(3), a.facing < 0 ? -1 : 1, +(Number(a.hp)||0).toFixed(2),
        // in transit: kind (1 beam / 2 burrow), elapsed, phase — so the beam and
        // the spoil heap play out on the watcher's screen too
        a.extract ? (a.extract.kind === 'beam' ? 1 : 2) : 0,
        a.extract ? +(a.extract.t||0).toFixed(2) : 0,
        a.extract && a.extract.phase === 'in' ? 1 : 0,
        a.moleCharge ? (a.moleCharge.phase==='windup'?1:(a.moleCharge.phase==='rush'?2:3)) : 0,
        a.moleCharge ? +(Number(a.moleCharge.t)||0).toFixed(2) : 0,
        a.alienCharge ? 1 : 0,
        a.alienCharge ? +(Number(a.alienCharge.t)||0).toFixed(2) : 0,
        a.alienCharge ? +(Number(a.alienCharge.duration)||1).toFixed(2) : 0,
        a.alienCharge ? +(Number(a.alienCharge.aimX)||0).toFixed(3) : 0,
        a.alienCharge ? +(Number(a.alienCharge.aimY)||0).toFixed(3) : 0
      ]),
      props: live4.map(t=>[
        String(t.id),
        t.lander ? +(Number(t.lander.y)||0).toFixed(2) : 0,
        t.burrow ? +(Number(t.burrow.progress)||0).toFixed(2) : 0,
        t.burrow && t.burrow.open ? 1 : 0
      ]),
      deaths:deathFx.filter(fx=>fx&&!fx.ghost).slice(-GHOST_DEATH_FX_CAP).map(ghostDeathPacket),
      shots:moleShots.slice(-MOLE_SHOT_GHOST_CAP).map(s=>[
        Number(s.id)||0,+s.x.toFixed(3),+s.y.toFixed(3),+(s.vx||0).toFixed(3),+(s.vy||0).toFixed(3),
        +(s.life||0).toFixed(2),+(s.spin||0).toFixed(2),s.heavy?1:0,Math.max(0,Math.min(3,Number(s.weaponTier)||0)),
        String(s.weaponType||'stone'),+(Number(s.radius)||0.17).toFixed(3),+(Number(s.gravity)||MOLE_SHOT_GRAVITY).toFixed(3)
      ]),
      beams:lasers.slice(-16).map(l=>[+l.x1.toFixed(3),+l.y1.toFixed(3),+l.x2.toFixed(3),+l.y2.toFixed(3),+(l.life-l.t).toFixed(2),l.hit?1:0,l.blocked?1:0,l.heavy?1:0,Math.max(0,Math.min(3,Number(l.weaponTier)||0)),String(l.kind||'')])
    };
  }
  function ghostApplyRoster(roster){
    if(!roster || typeof roster.sig !== 'string' || !Array.isArray(roster.poses)) return false;
    // Death events are independent of roster shape. Apply them before the
    // signature guard so the exact frame where a body disappears remotely
    // cannot turn into a silent pop while the full snapshot catches up.
    ghostApplyDeathEvents(roster.deaths);
    const live=ghostLiveUnits();
    if(live.map(a=>a.id).join('|') !== roster.sig) return false; // shape drifted: wait for the full sync
    for(let i=0;i<live.length;i++){
      const p=roster.poses[i];
      if(!Array.isArray(p) || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1]))) continue;
      const a=live[i];
      a._ghostTX=Number(p[0]); a._ghostTY=Number(p[1]);
      a.facing=Number(p[2]) < 0 ? -1 : 1;
      if(Number.isFinite(Number(p[3]))) a.hp=Math.max(0, Math.min(a.maxHp || Number(p[3]), Number(p[3])));
      const kindCode=Number(p[4])|0;
      if(kindCode){
        const kind=kindCode === 1 ? 'beam' : 'burrow';
        const phase=Number(p[6]) ? 'in' : 'out';
        a.extract=Object.assign(a.extract || {}, {
          kind, phase, t:Math.max(0, Number(p[5])||0),
          outDur:EXTRACT_OUT_S[kind] || 1.2, inDur:EXTRACT_IN_S[kind] || 0.5,
          sx:a.x, sy:a.y, tx:a.x, ty:a.y, fxT:0
        });
      } else a.extract=null;
      const chargeCode=Number(p[7])|0;
      if(chargeCode){
        a.moleCharge={phase:chargeCode===1?'windup':(chargeCode===2?'rush':'recover'),t:Math.max(0,Number(p[8])||0),dir:a.facing,ghost:true};
      } else a.moleCharge=null;
      if(Number(p[9])){
        a.alienCharge={t:Math.max(0,Number(p[10])||0),duration:Math.max(0.1,Number(p[11])||1),aimX:Number(p[12])||0,aimY:Number(p[13])||0,ghost:true};
      } else a.alienCharge=null;
    }
    if(Array.isArray(roster.props)){
      for(const p of roster.props){
        if(!Array.isArray(p)) continue;
        const team=teams.find(t=>t && String(t.id) === String(p[0]));
        if(!team) continue;
        if(team.lander && Number.isFinite(Number(p[1]))) team.lander.y=Number(p[1]);
        if(team.burrow){
          if(Number.isFinite(Number(p[2]))) team.burrow.progress=Number(p[2]);
          team.burrow.open=!!Number(p[3]);
        }
      }
    }
    moleShots.length=0;
    for(const s of (Array.isArray(roster.shots)?roster.shots.slice(0,MOLE_SHOT_GHOST_CAP):[])){
      if(!Array.isArray(s) || !Number.isFinite(Number(s[1])) || !Number.isFinite(Number(s[2]))) continue;
      moleShots.push({
        id:Number(s[0])||0,x:Number(s[1]),y:Number(s[2]),vx:Number(s[3])||0,vy:Number(s[4])||0,
        life:Math.max(0,Number(s[5])||0),spin:Number(s[6])||0,heavy:!!Number(s[7]),
        weaponTier:Math.max(0,Math.min(3,Number(s[8])||0)),weaponType:String(s[9]||'stone'),
        radius:Number(s[10])||(Number(s[7])?0.22:0.17),gravity:Number(s[11])||MOLE_SHOT_GRAVITY,ghost:true
      });
    }
    if(Array.isArray(roster.beams)){
      lasers.length=0;
      for(const l of roster.beams.slice(0,16)){
        if(!Array.isArray(l)||!Number.isFinite(Number(l[0]))||!Number.isFinite(Number(l[1]))||!Number.isFinite(Number(l[2]))||!Number.isFinite(Number(l[3]))) continue;
        lasers.push({x1:Number(l[0]),y1:Number(l[1]),x2:Number(l[2]),y2:Number(l[3]),t:0,life:Math.max(0.03,Number(l[4])||0.03),hit:!!Number(l[5]),blocked:!!Number(l[6]),heavy:!!Number(l[7]),weaponTier:Math.max(0,Math.min(3,Number(l[8])||0)),kind:String(l[9]||''),phase:0,ghost:true});
      }
    }
    return true;
  }
  // Cosmetic glide toward the streamed pose — never physics, never AI.
  function ghostLerp(dt){
    const k=Math.min(1, Math.max(0, Number(dt)||0) * 9);
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      for(const a of team.aliens){
        if(!a || !Number.isFinite(a._ghostTX) || !Number.isFinite(a._ghostTY)) continue;
        const dx=a._ghostTX - a.x, dy=a._ghostTY - a.y;
        if(Math.abs(dx) > 4 || Math.abs(dy) > 4){ a.x=a._ghostTX; a.y=a._ghostTY; continue; } // a beam is a jump, not a glide
        a.x += dx * k; a.y += dy * k;
        if(a.alienCharge&&a.alienCharge.ghost){
          a.alienCharge.t=Math.max(0,(Number(a.alienCharge.t)||0)-Math.max(0,Number(dt)||0));
          if(a.alienCharge.t<=0) a.alienCharge=null;
        }
      }
    }
    const d=Math.max(0,Math.min(0.08,Number(dt)||0));
    for(let i=moleShots.length-1;i>=0;i--){
      const s=moleShots[i];
      if(!s || !s.ghost) continue;
      s.life-=d;
      s.vy=(s.vy||0)+(Number(s.gravity)||MOLE_SHOT_GRAVITY)*d;
      s.x+=(s.vx||0)*d;
      s.y+=(s.vy||0)*d;
      s.spin=(s.spin||0)+(s.vx||0)*d*0.9;
      if(s.life<=0) moleShots.splice(i,1);
    }
    for(let i=lasers.length-1;i>=0;i--){
      const l=lasers[i];
      if(!l||!l.ghost) continue;
      l.t+=d;
      if(l.t>=l.life) lasers.splice(i,1);
    }
    updateDeathFx(d);
  }

  // Local, bounded pose provider for vision effects. It avoids serializing the
  // complete invasion state and gives nearby living units priority.
  function thermalTargets(wx,wy,range,limit){
    wx=Number.isFinite(Number(wx))?Number(wx):0;
    wy=Number.isFinite(Number(wy))?Number(wy):0;
    range=Math.max(1,Math.min(64,Number(range)||28));
    limit=Math.max(1,Math.min(96,Math.trunc(Number(limit)||48)));
    const r2=range*range,out=[];
    let inspected=0;
    outer: for(const team of teams){
      if(!team || team.state==='defeated' || !Array.isArray(team.aliens)) continue;
      for(const a of team.aliens){
        if(++inspected>256) break outer;
        if(!a || a.dead || !(a.hp>0) || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
        const dx=a.x-wx,dy=a.y-wy,d2=dx*dx+dy*dy;
        if(d2>r2) continue;
        const mole=a.kind==='molekin' || team.kind==='molekin';
        const scale=unitHitboxScale(a);
        const name=a.giant?(mole?'molekin colossus':'alien colossus'):(a.isPet?String(a.form||'invasion pet'):(mole?'molekin':'obcy'));
        out.push({id:String(a.id||a.role||out.length),name,x:a.x,y:a.y,w:(mole?0.82:0.72)*scale,h:(mole?0.9:1.05)*scale,hp:a.hp,heat:mole?0.8:0.68,living:true,d2});
      }
    }
    out.sort((a,b)=>a.d2-b.d2 || String(a.id).localeCompare(String(b.id)));
    return out.slice(0,limit).map(({d2,...pose})=>pose);
  }

  const api = {
    update,
    draw,
    ghostRoster,
    ghostApplyRoster,
    ghostLerp,
    thermalTargets,
    attackAt,
    damageAt,
    damageAtWorld,
    isLiving,
    blastRadius,
    nearestForEnemy,
    onHeroKilled,
    onHeroAction,
    openCacheAt,
    forceNightInvasion,
    forceMolekinInvasion,
    spawnRuinCommander,
    westGuardianDefeated,
    eastGuardianDefeated,
    registerTeamType,
    teamTypes:()=>Object.keys(TEAM_TYPES),
    encounterTypes:()=>ENCOUNTER_TYPES.slice(),
    snapshot,
    restore,
    reset,
    metrics,
    state:()=>({teams:teams.map(serializeTeam), caches:caches.map(c=>deepCopy(c)), lastNightDay, seq}),
    _debug:{teams,caches,lasers,moleShots,deathFx,tileDamage,brains,nav,traceLine,damageStructureTile,damageTeamTile,isMoleDiggableTile,fireAlienLaser,releaseAlienLaser,updateAlienLaserCharge,fireMolekinAttack,molekinChargeLane,tryStartMolekinCharge,updateMolekinCharge,updateMoleShots,updateDeathFx,deathProfileFor,spawnDeathFx,finalizeAlienDeath,drawDeathEffects,ghostApplyDeathEvents,destroyLander,unstuckAlien,beginExtraction,updateExtraction,extractionPlan,findSurfaceStandable,alienEscapeCells,findCacheSpot,stealResources,stealGear,canPlaceBarricadeAt,placeBarricadeTile,canPlaceRampAt,placeRampTile,canPlaceMoleVentAt,placeMoleVentTile,cleanupBuiltTiles,profileFor,playerLevelFor,threatLevelFor,gradeForThreat,teamCountForDay,alienCountForDay,molekinCountForDay,xpRewardForTeam,rewardProfileForTeam,chooseEncounter,encounterUnitCount,unitLoadoutFor,alienWeaponProfile,moleWeaponProfile,westGuardianDefeated,eastGuardianDefeated,spawnRuinCommander,forceMolekinInvasion,forceAlienSpeech,setAlienSpeech,longSpeechActive,updateAlien,triggerTeamSpeech,updateAlienSpeech,updateHeroAwareness,updateAtomicWinterAwareness,atomicWinterSpeechLines,compactSpeechText,storyInvasionLinesForProgress,speechLines:ALIEN_SPEECH,moleSpeechLines:MOLEKIN_SPEECH,rareSpeechLines:ALIEN_RARE_SPEECH,moleRareSpeechLines:MOLEKIN_RARE_SPEECH,echoSpeechLines:ALIEN_ECHO_SPEECH,moleEchoSpeechLines:MOLEKIN_ECHO_SPEECH}
  };
  MM.invasions = api;
  return api;
})();

export { invasions };
export default invasions;
