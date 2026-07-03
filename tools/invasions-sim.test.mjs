import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.performance = globalThis.performance || {now:()=>Date.now()};
const storage = new Map();
globalThis.localStorage = {
  getItem:k=>storage.has(k) ? storage.get(k) : null,
  setItem:(k,v)=>storage.set(k,String(v)),
  removeItem:k=>storage.delete(k)
};
const messages = [];
globalThis.msg = t=>messages.push(String(t));

const { T } = await import('../src/constants.js');
const { STORY_LORE } = await import('../src/engine/story_lore.js');
const taskCalls = [];
MM.tasks = {
  upsertAlienCache(cache){ taskCalls.push(['upsert', cache && cache.id, cache && cache.x, cache && cache.y]); return true; },
  completeAlienCache(cache){ taskCalls.push(['complete', cache && cache.id]); return true; },
  syncAlienCaches(caches){ taskCalls.push(['sync', Array.isArray(caches) ? caches.length : -1]); return true; },
  removeSource(source){ taskCalls.push(['removeSource', source]); return 0; }
};
const { invasions } = await import('../src/engine/invasions.js');

MM.TILE = 20;
MM.worldGen = {worldSeed:1234, surfaceHeight:()=>50};
MM.background = {timeInfo:()=>({phase:'night', isDay:false, hour:23})};
MM.seasons = {metrics:()=>({dayFloat:2})};

const overrides = new Map();
function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
function getTile(x,y){
  const k = key(x,y);
  if(overrides.has(k)) return overrides.get(k);
  return y >= 50 ? T.STONE : T.AIR;
}
function setTile(x,y,t){ overrides.set(key(x,y),t); }
const player = {x:0,y:49,hp:100,maxHp:100,vx:0,vy:0,xp:0};
let saveMarks = 0;
const ctx = {getTile,setTile,spawnBurst(){},msg:globalThis.msg,ensureChunkAtY(){},notifyStructureTileChanged(){},saveState(){ saveMarks++; }};

invasions.reset();
saveMarks = 0;
invasions.update(0.016, player, getTile, setTile, ctx);
assert.equal(invasions.metrics().teams, 1, 'first night update schedules one alien team');
assert.equal(invasions.metrics().lastNightDay, 2, 'night spawn is recorded for the current in-game day');
assert.ok(saveMarks >= 1, 'night scheduling asks the host save system to persist active invasion state');
invasions.update(0.016, player, getTile, setTile, ctx);
assert.equal(invasions.metrics().teams, 1, 'same night does not spawn duplicate teams');

invasions.reset();
MM.guardianLairs = {status:()=>({defeated:{fire:false, ice:true}})};
invasions.update(0.016, player, getTile, setTile, ctx);
assert.equal(invasions.metrics().alienTeams, 0, 'natural alien teams stop spawning after the western ice guardian is defeated');
assert.equal(invasions.metrics().moleTeams, 1, 'night pressure can continue as eastern molekin after the west guardian falls');
assert.equal(invasions._debug.westGuardianDefeated(), true, 'invasion system detects the defeated west/ice guardian state');
delete MM.guardianLairs;

invasions.reset();
MM.guardianLairs = {status:()=>({defeated:{fire:true, ice:true}})};
invasions.update(0.016, player, getTile, setTile, ctx);
assert.equal(invasions.metrics().teams, 0, 'natural night invasions stop when both west/ice and east/fire guardians are defeated');
assert.equal(invasions._debug.eastGuardianDefeated(), true, 'invasion system detects the defeated east/fire guardian state');
delete MM.guardianLairs;

invasions.reset();
MM.guardianLairs = {status:()=>({defeated:{fire:true, ice:false}})};
const fireBlockedMoles = invasions.forceNightInvasion(player,getTile,setTile,{day:2,teams:1,kind:'molekin',natural:true});
assert.equal(fireBlockedMoles.length, 0, 'natural molekin teams are blocked after the eastern fire guardian is defeated');
const fireDefeatedFallback = invasions.forceNightInvasion(player,getTile,setTile,{day:2,teams:1,natural:true});
assert.equal(fireDefeatedFallback.length, 1, 'natural night pressure can still fall back to UFO aliens while the west guardian is alive');
assert.equal(fireDefeatedFallback[0].kind, 'aliens', 'fire-guardian defeat filters molekin out of natural mixed scheduling');
delete MM.guardianLairs;

invasions.reset();
const scalable = invasions.forceNightInvasion(player,getTile,setTile,{day:9,teams:3,alienCount:1});
assert.equal(scalable.length, 3, 'force spawn can create several scalable invading teams');
assert.equal(invasions.metrics().activeTeams, 3, 'all forced teams are active invasion pressure');

// player-level scaling keeps pressure visible: more squads, more aliens,
// stronger visible grades/weapons, better XP and better reward odds.
invasions.reset();
overrides.clear();
player.xp = 0;
const lowPressure = invasions.forceNightInvasion(player,getTile,setTile,{day:3});
const lowTeam = lowPressure[0];
const lowRewardProfile = invasions._debug.rewardProfileForTeam(lowTeam,player);
invasions.reset();
player.xp = 12000;
const highPressure = invasions.forceNightInvasion(player,getTile,setTile,{day:3});
const highTeam = highPressure[0];
const highRewardProfile = invasions._debug.rewardProfileForTeam(highTeam,player);
assert.ok(highTeam.playerLevel > lowTeam.playerLevel, 'high-XP hero maps to a higher invasion player level');
assert.ok(highPressure.length > lowPressure.length, 'high-level hero attracts more alien teams at the same world day');
assert.ok(highTeam.alienCount > lowTeam.alienCount, 'high-level invasion squads field more aliens at the same world day');
assert.ok(highTeam.threatLevel > lowTeam.threatLevel, 'high-level invasion records a higher threat level');
assert.ok(highTeam.grade > lowTeam.grade, 'high-level invasion records a visible higher alien grade');
assert.ok(highTeam.weaponTier > lowTeam.weaponTier, 'high-level invasion uses visibly better alien weapons');
assert.ok(highTeam.xpReward > lowTeam.xpReward, 'high-level invasion pays a larger XP reward');
assert.ok(highRewardProfile.dropChance > lowRewardProfile.dropChance, 'high-level invasion drops chests more often');
assert.ok(highRewardProfile.rareChance > lowRewardProfile.rareChance, 'high-level invasion has better rare chest odds');
assert.ok(highRewardProfile.epicChance > lowRewardProfile.epicChance, 'high-level invasion has better epic chest odds');
assert.ok(highRewardProfile.maxDrops >= lowRewardProfile.maxDrops, 'high-level invasion can award at least as many reward chests');
invasions.reset();
player.xp = 12000;
invasions.forceNightInvasion(player,getTile,setTile,{day:3,teams:1});
for(let i=0;i<120;i++) invasions.update(0.1, player, getTile, setTile, ctx);
const upgradedSquad = invasions.state().teams[0];
assert.ok(upgradedSquad.aliens.every(a=>a.grade === upgradedSquad.grade && a.weaponTier === upgradedSquad.weaponTier), 'spawned high-level aliens inherit visible grade and weapon tier');
assert.ok(upgradedSquad.aliens.some(a=>a.maxHp > lowTeam.day * 3 + 18), 'spawned high-level aliens have scaled durability');
invasions.reset();
overrides.clear();
player.xp = 12000;
const rewardSquad = invasions.forceNightInvasion(player,getTile,setTile,{day:3,teams:1,alienCount:1,forceRewardChance:1,forceRewardTier:'epic'})[0];
const rewardLander = rewardSquad.lander;
assert.ok(invasions.damageAt(Math.floor(rewardLander.x),Math.floor(rewardLander.y),9999), 'hero can destroy a reward-scaled invasion lander');
invasions.update(0.1, player, getTile, setTile, ctx);
let scaledRewardChestSeen = false;
for(let x=Math.floor(rewardSquad.x)-6; x<=Math.floor(rewardSquad.x)+6; x++){
  for(let y=45; y<=52; y++) if(getTile(x,y) === T.CHEST_EPIC) scaledRewardChestSeen = true;
}
assert.ok(scaledRewardChestSeen, 'defeating a high-level alien squad can materialize an epic reward chest');
player.xp = 0;

invasions.reset();
invasions.forceNightInvasion(player,getTile,setTile,{day:5,teams:1,alienCount:1});
let state = invasions.state();
const lander = state.teams[0].lander;
assert.ok(invasions.damageAt(Math.floor(lander.x),Math.floor(lander.y),999), 'hero weapons can damage an invasion lander');
invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(player.xp >= 160, 'defeating an invading team grants substantial XP');

invasions.reset();
invasions.forceNightInvasion(player,getTile,setTile,{day:4,teams:1,alienCount:1});
for(let i=0;i<110;i++) invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(invasions.metrics().aliens >= 1, 'landing completes by deploying small alien attackers');
state = invasions.state();
const alien = state.teams[0].aliens[0];
assert.ok(invasions.attackAt(Math.floor(alien.x),Math.floor(alien.y-0.45),500), 'melee attacks can hit small aliens');
invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(invasions.metrics().activeTeams === 0 || player.xp > 0, 'killing the final alien can finish the team');

// --- tactical AI integration ------------------------------------------------
// Roles, separation, and the siege that breaches a shelter the hero hides in.
invasions.reset();
overrides.clear();
for(let y=45; y<=49; y++){ setTile(-2,y,T.STONE); setTile(2,y,T.STONE); }
for(let x=-2; x<=2; x++) setTile(x,45,T.STONE);
invasions.forceNightInvasion(player,getTile,setTile,{day:6,teams:1,alienCount:5});
let sawLaser = false, sawSiege = false, sawTileDamage = false;
for(let i=0;i<420;i++){
  invasions.update(0.1, player, getTile, setTile, ctx);
  const m = invasions.metrics();
  if(m.lasers > 0) sawLaser = true;
  if(m.siegeTeams > 0) sawSiege = true;
  if(invasions._debug.tileDamage.size > 0) sawTileDamage = true;
}
state = invasions.state();
const squad = state.teams[0];
assert.ok(squad && squad.aliens.length >= 5, 'siege scenario fields a full squad');
const roleSet = new Set(squad.aliens.map(a=>a.role));
assert.ok([...roleSet].every(r=>typeof r === 'string' && r.length > 0), 'every alien carries a tactical role');
assert.ok(roleSet.size >= 4, 'a five-alien squad mixes at least four different tactics');
assert.ok(roleSet.has('tank') && roleSet.has('healer'), 'mixed squads include tank and healer roles');
assert.ok(squad.aliens.every(a=>a.variant && Number.isFinite(a.variant.body) && Number.isFinite(a.speedMult)), 'each alien persists procedural look and behavior traits');
let minGap = Infinity;
const liveAliens = squad.aliens.filter(a=>!a.dead && a.hp > 0);
for(let i=0;i<liveAliens.length;i++){
  for(let j=i+1;j<liveAliens.length;j++){
    const gap = Math.hypot(liveAliens[i].x-liveAliens[j].x, liveAliens[i].y-liveAliens[j].y);
    if(gap < minGap) minGap = gap;
  }
}
assert.ok(minGap > 0.3, 'separation keeps invaders from overlapping (min gap '+minGap.toFixed(2)+')');
assert.ok(sawLaser, 'invaders fire lasers during the assault');
assert.ok(sawSiege, 'a sheltered hero flips the squad into siege mode');
let wallBreached = false;
for(let y=45; y<=49; y++){ if(getTile(-2,y)!==T.STONE || getTile(2,y)!==T.STONE) wallBreached = true; }
for(let x=-2; x<=2; x++){ if(getTile(x,45)!==T.STONE) wallBreached = true; }
assert.ok(sawTileDamage || wallBreached, 'the siege chews through the shelter shell');

const actualSquad = invasions._debug.teams[0];
const tank = actualSquad.aliens.find(a=>a.role === 'tank');
const healer = actualSquad.aliens.find(a=>a.role === 'healer');
assert.ok(tank && healer, 'debug squad exposes live tank and healer units');
const tankBeforeHit = tank.hp;
assert.ok(invasions.blastRadius(tank.x,tank.y-0.4,0.2,10), 'direct blast can hit the tank');
assert.ok(tank.hp > tankBeforeHit - 10, 'tank role reduces incoming damage');
tank.hp = Math.max(1, tank.maxHp - 14);
healer.attackCd = 0;
const tankBeforeHeal = tank.hp;
for(let i=0;i<60;i++) invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(tank.hp > tankBeforeHeal, 'healer role restores a wounded teammate');
actualSquad.lander.landed = true;
actualSquad.lander.destroyed = false;
const repairTarget = actualSquad.aliens.find(a=>a !== healer && !a.dead && a.hp > 0) || tank;
repairTarget.x = actualSquad.x;
repairTarget.y = actualSquad.y;
repairTarget.vx = 0;
repairTarget.hp = Math.max(2, repairTarget.maxHp * 0.32);
if(repairTarget._ai){
  repairTarget._ai.state = 'approach';
  repairTarget._ai.repairCooldownUntil = 0;
}
healer.attackCd = 99;
const repairBefore = repairTarget.hp;
clearSquadSpeech(actualSquad);
for(let i=0;i<12;i++) invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(repairTarget.hp > repairBefore, 'wounded alien recharges health at the landed saucer');
assert.ok(repairTarget.lastLanderRepairAt > 0, 'saucer repair records the lander recharge event');
assert.ok(squadSaid(actualSquad,'repair'), 'saucer recharge triggers event-based alien worship chatter');
const buriedAlien = actualSquad.aliens.find(a=>a !== healer && !a.dead && a.hp > 0) || tank;
buriedAlien.x = 14.5;
buriedAlien.y = 49;
buriedAlien.vx = 0;
buriedAlien.vy = 0;
buriedAlien.hp = buriedAlien.maxHp;
buriedAlien.facing = 1;
buriedAlien.nextUnstuckDigAt = 0;
buriedAlien.unstuckFailCount = 0;
if(buriedAlien._ai){
  buriedAlien._ai.state = 'approach';
  buriedAlien._ai.repairCooldownUntil = performance.now() + 20000;
}
const rubbleX = Math.floor(buriedAlien.x);
const rubbleY = Math.floor(buriedAlien.y - 0.45);
setTile(rubbleX,rubbleY,T.STONE);
clearSquadSpeech(actualSquad);
actualSquad.unstuckSpeechAt = 0;
for(let i=0;i<8;i++) invasions.update(0.1, player, getTile, setTile, ctx);
assert.equal(getTile(rubbleX,rubbleY), T.AIR, 'alien escape logic breaks a collapsed block intersecting its hitbox');
assert.ok(buriedAlien.lastUnstuckAt > 0, 'buried alien records an unstuck rescue event');
assert.ok(squadSaid(actualSquad,'trapped'), 'buried alien rescue triggers event-based rubble chatter');
const trappedAlien = buriedAlien;
trappedAlien.x = 18.5;
trappedAlien.y = 49;
trappedAlien.vx = 0;
trappedAlien.vy = 0;
trappedAlien.hp = trappedAlien.maxHp;
trappedAlien.facing = 1;
trappedAlien.nextUnstuckDigAt = 0;
trappedAlien.unstuckFailCount = 0;
const pocketX = Math.floor(trappedAlien.x);
const pocketY = Math.floor(trappedAlien.y - 0.45);
const frontWallX = pocketX + 1;
setTile(pocketX,pocketY,T.AIR);
setTile(pocketX,Math.floor(trappedAlien.y - 0.95),T.AIR);
setTile(frontWallX,pocketY,T.STONE);
setTile(frontWallX,Math.floor(trappedAlien.y - 0.95),T.STONE);
clearSquadSpeech(actualSquad);
actualSquad.unstuckSpeechAt = 0;
const trappedNow = performance.now() + 5000;
assert.ok(invasions._debug.unstuckAlien(actualSquad,trappedAlien,{dir:1,reason:'stuck',now:trappedNow},getTile,setTile,ctx), 'alien trapped in an open pocket can start breaching out');
assert.equal(getTile(frontWallX,pocketY), T.AIR, 'non-buried alien escape logic breaks a collapsed wall in its path');
assert.ok(trappedAlien.lastUnstuckAt >= trappedNow, 'pocket escape records an unstuck rescue event');
assert.ok(squadSaid(actualSquad,'trapped'), 'pocket escape also uses event-based rubble chatter');
const loreLines = invasions._debug.speechLines.lore || [];
assert.ok(loreLines.some(line=>/prostokat|rectangle|hero/i.test(line)), 'alien chatter now worships the hero rectangle');
assert.ok(STORY_LORE.invasions.alien.every(line=>loreLines.includes(line)), 'alien lore chatter includes shared layered-simulation backstory fragments');
const earlyAlienLore = invasions._debug.storyInvasionLinesForProgress('alien','base',{MM:{progress:{guardianHearts(){ return {}; }}}});
const lateAlienLore = invasions._debug.storyInvasionLinesForProgress('alien','base',{MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true,sky:true,mother:true}; }}}});
const lateRareAlienLore = invasions._debug.storyInvasionLinesForProgress('alien','rare',{MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true,sky:true,mother:true}; }}}});
assert.ok(earlyAlienLore.some(line=>/obserwator|Prostokat|symulac/i.test(line)), 'early alien dynamic lore starts with observer/simulation unease');
assert.ok(!earlyAlienLore.some(line=>/Macierzyst|lustrem|samym soba/i.test(line)), 'early alien dynamic lore avoids final self-confrontation spoilers');
assert.ok(lateAlienLore.some(line=>/odtracenie|ambicja|Macierzyst/i.test(line)), 'late alien dynamic lore carries unlocked guardian metaphors');
assert.ok((invasions._debug.rareSpeechLines.lore || []).some(line=>/Stary|symulac|warstw/i.test(line)), 'alien rare lore starts with mentor suspicion and deeper simulation unease');
assert.ok(lateRareAlienLore.some(line=>/lustrem|samym soba/i.test(line)), 'late rare alien lore hints that the final fight is with oneself');
const forcedLore = invasions._debug.forceAlienSpeech(tank, actualSquad, 'lore');
assert.equal(tank.speechText, forcedLore, 'forced debug speech appears above the selected alien');
assert.ok(/prostokat|rectangle|hero|obserwator|anten|symulac|Zachodni/i.test(forcedLore), 'forced lore speech mentions the hero cult or currently unlocked backstory');

function clearSquadSpeech(team){
  for(const a of team.aliens){
    a.speechText = '';
    a.speechUntil = 0;
    a.speechCue = '';
    a.speechCueUntil = 0;
  }
  team.nextReactionAt = 0;
  team.reactionCooldowns = {};
  team.recentSpeechLines = [];
  team.speechEventCounts = {};
  team.nextEchoSpeechAt = 0;
}
function squadSaid(team,key){
  const table = team && team.kind === 'molekin' ? invasions._debug.moleSpeechLines : invasions._debug.speechLines;
  const rare = team && team.kind === 'molekin' ? invasions._debug.moleRareSpeechLines : invasions._debug.rareSpeechLines;
  const echo = team && team.kind === 'molekin' ? invasions._debug.moleEchoSpeechLines : invasions._debug.echoSpeechLines;
  const lines = new Set([...(table && table[key] || []), ...(rare && rare[key] || []), ...(echo && echo[key] || [])]);
  return team.aliens.some(a=>lines.has(a.speechText));
}

clearSquadSpeech(actualSquad);
actualSquad.speechStartAt = performance.now() - 20000;
actualSquad.loreHintSpoken = false;
const originalRandom = Math.random;
Math.random = () => 0;
try{
  for(let i=0;i<8;i++){
    for(const a of actualSquad.aliens){
      invasions._debug.updateAlienSpeech(a,actualSquad,performance.now()+5000+i*1000);
    }
  }
} finally {
  Math.random = originalRandom;
}
assert.ok(actualSquad.aliens.every(a=>!a.speechText), 'alien chatter stays silent without a world event');

clearSquadSpeech(actualSquad);
const repeatedHeroHitLines = [];
Math.random = () => 0;
try{
  for(let i=0;i<4;i++){
    repeatedHeroHitLines.push(invasions._debug.forceAlienSpeech(tank, actualSquad, 'heroHit', performance.now()+6000+i));
  }
} finally {
  Math.random = originalRandom;
}
assert.ok(new Set(repeatedHeroHitLines.filter(Boolean)).size >= 3, 'alien speech memory avoids immediate repeated lines for the same event');
assert.ok((invasions._debug.rareSpeechLines.heroHit || []).length >= 2, 'alien chatter has rare event variants for repeated combat moments');

clearSquadSpeech(actualSquad);
Math.random = () => 0;
try{
  invasions._debug.triggerTeamSpeech(actualSquad,'heroHit',{force:true,echo:true,now:performance.now()+6020,cooldown:0,keyCooldown:0});
} finally {
  Math.random = originalRandom;
}
assert.ok(actualSquad.aliens.filter(a=>a.speechText).length >= 2, 'rare team echo can create a surprising second reaction without ambient chatter');

// team chatter reacts to battle events and hero behavior
clearSquadSpeech(actualSquad);
const victim = actualSquad.aliens.find(a=>a.role === 'sniper') || actualSquad.aliens.find(a=>a !== tank && a !== healer);
victim.x = actualSquad.x + 8;
victim.y = actualSquad.y;
assert.ok(invasions.damageAt(Math.floor(victim.x),Math.floor(victim.y-0.45),victim.maxHp * 4,{weaponType:'bow'}), 'hero can kill a selected squad member');
assert.ok(victim.dead, 'selected squad member dies from overwhelming damage');
assert.ok(squadSaid(actualSquad,'allyDown'), 'surviving aliens react when a teammate dies');

clearSquadSpeech(actualSquad);
assert.ok(invasions.onHeroAction('hero_hit',{player,x:tank.x,y:tank.y,force:true}).handled, 'hero-hit event is accepted by invasion chatter');
assert.ok(squadSaid(actualSquad,'heroHit'), 'aliens celebrate landing an effective hit on the hero');

clearSquadSpeech(actualSquad);
assert.ok(invasions.onHeroAction('hero_mine',{player,x:tank.x,y:tank.y,tileLabel:'granite',tool:'meteor',force:true}).handled, 'hero mining event is accepted by invasion chatter');
assert.ok(squadSaid(actualSquad,'heroMine'), 'aliens comment on the hero digging terrain');

clearSquadSpeech(actualSquad);
assert.ok(invasions.onHeroAction('hero_heal',{player,amount:24,source:'potion',force:true}).handled, 'hero healing event is accepted by invasion chatter');
assert.ok(squadSaid(actualSquad,'heroHeal'), 'aliens react when the hero heals');

clearSquadSpeech(actualSquad);
assert.ok(invasions.onHeroAction('hero_weapon',{player,weaponType:'electric',weaponName:'Karabin elektryczny',force:true}).handled, 'specific weapon event is accepted by invasion chatter');
assert.ok(squadSaid(actualSquad,'weaponElectric'), 'aliens identify electric weapon usage');

clearSquadSpeech(actualSquad);
player.hp = 20;
actualSquad.heroHealthBand = 'mid';
actualSquad.speechStartAt = performance.now() - 5000;
invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(squadSaid(actualSquad,'heroLowHp'), 'aliens notice when the hero is low on health');

clearSquadSpeech(actualSquad);
player.hp = player.maxHp;
actualSquad.heroHealthBand = 'mid';
actualSquad.speechStartAt = performance.now() - 5000;
invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(squadSaid(actualSquad,'heroHighHp'), 'aliens notice when the hero is healthy');

// roles survive save/load
const roleSnap = invasions.snapshot();
assert.ok(roleSnap.teams[0].aliens.every(a=>a.role), 'snapshot persists tactical roles');
assert.ok(roleSnap.teams[0].aliens.every(a=>a.variant && Number.isFinite(a.speedMult) && Number.isFinite(a.damageTakenMult)), 'snapshot persists generated traits and stat multipliers');
assert.ok(roleSnap.teams[0].aliens.every(a=>a._ai === undefined), 'snapshot strips transient AI state');
assert.ok(roleSnap.teams[0].aliens.every(a=>a.speechText === undefined), 'snapshot strips transient alien speech bubbles');
invasions.reset();
invasions.restore(roleSnap,getTile,setTile);
const restoredRoles = invasions.state().teams[0].aliens.map(a=>a.role);
assert.deepEqual(restoredRoles, roleSnap.teams[0].aliens.map(a=>a.role), 'restore keeps each alien on its role');
assert.deepEqual(invasions.state().teams[0].aliens.map(a=>a.variant.body), roleSnap.teams[0].aliens.map(a=>a.variant.body), 'restore keeps procedural bodies stable');
const legacySnap = JSON.parse(JSON.stringify(roleSnap));
for(const a of legacySnap.teams[0].aliens){
  delete a.role;
  delete a.speedMult;
  delete a.jumpMult;
  delete a.damageMult;
  delete a.damageTakenMult;
  delete a.healMult;
  delete a.hitboxScale;
  delete a.variant;
}
invasions.reset();
invasions.restore(legacySnap,getTile,setTile);
const legacyAliens = invasions.state().teams[0].aliens;
const legacyTank = legacyAliens.find(a=>a.role === 'tank');
const legacyHealer = legacyAliens.find(a=>a.role === 'healer');
assert.ok(legacyTank && legacyTank.damageTakenMult < 0.85 && legacyTank.hitboxScale > 1, 'legacy saves re-roll tank traits with tank durability and body shape');
assert.ok(legacyHealer && legacyHealer.healMult > 1 && legacyHealer.damageMult < 0.75, 'legacy saves re-roll healer traits with support behavior stats');

// molekin night teams are a second, distinct invasion system: they burrow up,
// worship the eastern fire guardian, use fire/lava pressure, and dig terrain.
invasions.reset();
overrides.clear();
player.x = 0; player.y = 49; player.hp = player.maxHp; player.xp = 0;
const moleSpawned = invasions.forceMolekinInvasion(player,getTile,setTile,{day:7,teams:1,alienCount:8});
assert.equal(moleSpawned.length, 1, 'debug force can spawn one molekin invasion team');
assert.equal(moleSpawned[0].kind, 'molekin', 'forced molekin team records its own kind');
assert.equal(moleSpawned[0].state, 'burrowing', 'molekin team starts below ground before emerging');
assert.ok(moleSpawned[0].burrow && moleSpawned[0].lander && moleSpawned[0].lander.invisible, 'molekin team has a burrow and an invisible repair anchor, not a visible saucer');
saveMarks = 0;
for(let i=0;i<18;i++) invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(saveMarks >= 1, 'molekin warning cracks mark world changes for saving');
for(let i=0;i<32;i++) invasions.update(0.1, player, getTile, setTile, ctx);
const moleTeam = invasions._debug.teams[0];
assert.equal(moleTeam.kind, 'molekin', 'spawned team remains molekin after emergence');
assert.equal(moleTeam.state, 'active', 'molekin team emerges into active combat state');
assert.ok(moleTeam.burrow.open, 'molekin burrow opens after the warning phase');
assert.equal(invasions.metrics().moleTeams, 1, 'metrics expose active molekin teams separately');
assert.ok(invasions.metrics().molekin >= 8, 'metrics count live molekin units separately from aliens');
assert.equal(invasions.metrics().alienTeams, 0, 'forced molekin debug spawn does not create UFO teams');
const moleRoles = new Set(moleTeam.aliens.map(a=>a.role));
assert.ok(moleRoles.size >= 4 && moleRoles.has('tank') && moleRoles.has('healer') && moleRoles.has('sapper'), 'molekin squads reuse tactical depth with tank, healer, and digger roles');
assert.ok(moleTeam.aliens.every(a=>a.kind === 'molekin' && a.variant && Number.isFinite(a.variant.helmet) && Number.isFinite(a.variant.snout)), 'each molekin unit persists a distinct burrower look');
const burrowX = Math.floor(moleTeam.burrow.x);
assert.equal(getTile(burrowX, Math.floor(moleTeam.burrow.targetY)+1), T.AIR, 'molekin emergence cuts a tunnel through the ground below the surface');
const moleLines = invasions._debug.moleSpeechLines.lore || [];
assert.ok(moleLines.some(line=>/Wschod|Ognist|Guardian|Trzeci|Kret/i.test(line)), 'molekin lore points toward the eastern fire guardian and deeper mole lore');
assert.ok(STORY_LORE.invasions.molekin.every(line=>moleLines.includes(line)), 'molekin lore chatter includes shared underground backstory fragments');
const lateMoleLore = invasions._debug.storyInvasionLinesForProgress('molekin','base',{MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true}; }}}});
const lateRareMoleLore = invasions._debug.storyInvasionLinesForProgress('molekin','rare',{MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true,sky:true,mother:true}; }}}});
assert.ok(lateMoleLore.some(line=>/namietnosc|pamietac|wstyd|Trzeci Kret/i.test(line)), 'progressive molekin lore carries passion and hidden-memory metaphors after the relevant guardians');
assert.ok((invasions._debug.moleRareSpeechLines.lore || []).some(line=>/Starego|pierwszy|pros/i.test(line)), 'molekin rare lore hints that the first NPC is more than a tutorial helper');
assert.ok(lateRareMoleLore.some(line=>/to ja|ostatnim panem/i.test(line)), 'late molekin rare lore hints at the self-confrontation ending');
const moleSpeaker = moleTeam.aliens.find(a=>a.role === 'sapper') || moleTeam.aliens[0];
const forcedMoleLore = invasions._debug.forceAlienSpeech(moleSpeaker,moleTeam,'lore');
assert.equal(moleSpeaker.speechText, forcedMoleLore, 'debug forced speech also works for molekin');
assert.ok(/Wschod|Ognist|Guardian|Trzeci|Kret|tunel|powierzchnia|warstwa|kamien|Bohater/i.test(forcedMoleLore), 'forced molekin speech worships or foreshadows the currently unlocked eastern underground plot');
clearSquadSpeech(moleTeam);
moleTeam.speechStartAt = performance.now() - 20000;
Math.random = () => 0;
try{
  for(let i=0;i<8;i++){
    for(const a of moleTeam.aliens){
      invasions._debug.updateAlienSpeech(a,moleTeam,performance.now()+5000+i*1000);
    }
  }
} finally {
  Math.random = originalRandom;
}
assert.ok(moleTeam.aliens.every(a=>!a.speechText), 'molekin chatter also stays silent without a world event');
let moleHeroDamage = 0;
const previousDamageHero = globalThis.damageHero;
globalThis.damageHero = (amount,opts)=>{ moleHeroDamage += amount; player.hp -= amount; invasions.onHeroAction(opts && opts.cause === 'molekin_invasion' ? 'hero_hit' : 'hero_hurt',{player,force:true,cause:opts && opts.cause}); return true; };
try{
  const shooter = moleTeam.aliens.find(a=>a.role === 'sniper') || moleTeam.aliens[0];
  shooter.x = player.x - 4;
  shooter.y = player.y;
  shooter.facing = 1;
  clearSquadSpeech(moleTeam);
  const hit = invasions._debug.fireMolekinAttack(shooter,moleTeam,player,getTile,setTile,ctx,{aim:1});
  assert.ok(hit && hit.clear, 'molekin fire attack can hit the hero through line of sight');
  assert.ok(moleHeroDamage > 0, 'molekin fire attack damages the hero with its own invasion cause');
  assert.ok(squadSaid(moleTeam,'heroHit'), 'molekin team reacts to an effective hit on the hero');
assert.ok(invasions._debug.lasers.some(l=>/^mole_/.test(l.kind)), 'molekin attack uses fire/lava visual effects instead of alien lasers');
} finally {
  globalThis.damageHero = previousDamageHero;
  player.hp = player.maxHp;
}
const repairMole = moleTeam.aliens.find(a=>a.role !== 'healer' && !a.dead && a.hp > 0) || moleTeam.aliens[0];
repairMole.x = moleTeam.burrow.x;
repairMole.y = moleTeam.burrow.targetY;
repairMole.vx = 0;
repairMole.vy = 0;
repairMole.hp = Math.max(2, repairMole.maxHp * 0.22);
if(repairMole._ai){
  repairMole._ai.state = 'approach';
  repairMole._ai.repairCooldownUntil = 0;
}
for(const a of moleTeam.aliens){
  if(a.role !== 'healer') continue;
  a.attackCd = 99;
  if(a._ai){
    a._ai.state = 'approach';
    a._ai.supportId = '';
  }
}
const moleRepairBefore = repairMole.hp;
clearSquadSpeech(moleTeam);
moleTeam.landerRepairSpeechAt = 0;
for(let i=0;i<10;i++) invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(repairMole.hp > moleRepairBefore, 'wounded molekin can recharge health at the opened burrow');
assert.ok(repairMole.lastLanderRepairAt > 0, 'molekin burrow repair records the recharge event through the shared AI path');
assert.ok(squadSaid(moleTeam,'repair'), 'molekin burrow repair triggers event-based worship chatter');
const trappedMole = repairMole;
trappedMole.x = burrowX + 7.5;
trappedMole.y = 49;
trappedMole.vx = 0;
trappedMole.vy = 0;
trappedMole.hp = trappedMole.maxHp;
trappedMole.facing = 1;
trappedMole.nextUnstuckDigAt = 0;
trappedMole.unstuckFailCount = 0;
const graniteX = Math.floor(trappedMole.x);
const graniteY = Math.floor(trappedMole.y - 0.45);
setTile(graniteX,graniteY,T.GRANITE);
clearSquadSpeech(moleTeam);
moleTeam.unstuckSpeechAt = 0;
assert.ok(invasions._debug.unstuckAlien(moleTeam,trappedMole,{dir:1,reason:'buried',embedded:true,now:performance.now()+9000},getTile,setTile,ctx), 'buried molekin can dig itself out of natural granite');
assert.equal(getTile(graniteX,graniteY), T.AIR, 'molekin unstuck clears natural geology from its hitbox');
assert.ok(squadSaid(moleTeam,'trapped'), 'molekin digging out of rubble triggers trapped chatter');
const digX = burrowX + 5;
setTile(digX,49,T.STONE);
assert.ok(invasions._debug.damageTeamTile(moleTeam,digX,49,999,getTile,setTile,ctx), 'molekin dig damage can destroy ordinary stone');
assert.equal(getTile(digX,49), T.AIR, 'molekin dig damage clears destroyed stone');
setTile(digX+1,49,T.UFO_CONCRETE);
assert.equal(invasions._debug.damageTeamTile(moleTeam,digX+1,49,999,getTile,setTile,ctx), false, 'molekin digging cannot bypass UFO concrete');
assert.equal(getTile(digX+1,49), T.UFO_CONCRETE, 'UFO concrete remains intact against molekin digging');
const moleSnap = invasions.snapshot();
assert.equal(moleSnap.teams[0].kind, 'molekin', 'snapshot persists molekin team kind');
assert.ok(moleSnap.teams[0].burrow && moleSnap.teams[0].burrow.open, 'snapshot persists open molekin burrow state');
assert.ok(moleSnap.teams[0].aliens.every(a=>a.kind === 'molekin' && Number.isFinite(a.variant.helmet)), 'snapshot persists molekin procedural variants');
invasions.reset();
invasions.restore(moleSnap,getTile,setTile);
const restoredMole = invasions.state().teams[0];
assert.equal(restoredMole.kind, 'molekin', 'restore keeps molekin team kind');
assert.ok(restoredMole.burrow && restoredMole.burrow.open, 'restore keeps molekin burrow state');
assert.ok(restoredMole.aliens.every(a=>a.kind === 'molekin' && Number.isFinite(a.variant.snout)), 'restore keeps molekin procedural bodies stable');

// rare golden commanders stand out, carry double tank health, and drop golden chests
invasions.reset();
overrides.clear();
player.x = 0; player.y = 49; player.hp = player.maxHp;
invasions.forceNightInvasion(player,getTile,setTile,{day:8,teams:1,alienCount:5,forceCommander:true});
for(let i=0;i<120;i++) invasions.update(0.1, player, getTile, setTile, ctx);
const commanderTeam = invasions._debug.teams[0];
const commander = commanderTeam.aliens.find(a=>a.role === 'commander');
const commanderTank = commanderTeam.aliens.find(a=>a.role === 'tank');
assert.ok(commander && commanderTank, 'forced commander squad contains a golden commander and a tank baseline');
assert.equal(commander.maxHp, commanderTank.maxHp * 2, 'golden alien commander has exactly double the tank health');
assert.ok(commander.variant.body > 1.1 && commander.hitboxScale > 1.05, 'golden commander is visually larger than ordinary aliens');
commander.x = 12; commander.y = 49; commander.hp = commander.maxHp; commander.dead = false;
for(const a of commanderTeam.aliens){
  if(a !== commander){ a.x = 18 + commanderTeam.aliens.indexOf(a) * 2; a.y = 49; }
}
assert.ok(invasions.damageAt(Math.floor(commander.x),Math.floor(commander.y-0.45),commander.maxHp * 3,{weaponType:'melee'}), 'hero can kill the golden commander');
assert.ok(commander.dead, 'golden commander dies from overwhelming damage');
let commanderChestSeen = false;
for(let x=8; x<=16; x++){
  for(let y=45; y<=52; y++) if(getTile(x,y) === T.CHEST_EPIC) commanderChestSeen = true;
}
assert.ok(commanderChestSeen, 'golden commander death materializes a golden epic chest near the fall site');

// engineer barricades are tracked and cleaned up when the team falls
const debugTeam = invasions._debug.teams[0];
invasions._debug.cleanupBuiltTiles(debugTeam,getTile,setTile,ctx); // clear any sim-built walls first
assert.ok(invasions._debug.placeBarricadeTile(debugTeam,30,49,getTile,setTile,ctx), 'invaders can raise barricade tiles');
assert.equal(getTile(30,49), T.ALIEN_BIOMASS, 'barricades are alien biomass tiles');
assert.equal(debugTeam.builtTiles.length, 1, 'placed barricades are tracked on the team');
invasions._debug.cleanupBuiltTiles(debugTeam,getTile,setTile,ctx);
assert.equal(getTile(30,49), T.AIR, 'defeated teams leave no barricades behind');
assert.equal(debugTeam.builtTiles.length, 0, 'cleanup empties the built-tile ledger');

// team scalability: other invader kinds register their own profiles
assert.ok(invasions.teamTypes().includes('aliens'), 'alien profile is registered by default');
invasions.registerTeamType('dwarves', {baseSpeed:2.0, roles:{rusher:{weight:3}, sapper:{weight:2}}});
assert.ok(invasions.teamTypes().includes('dwarves'), 'new invader kinds can register team profiles');

const inv = {wood:10, stone:8, diamond:1};
const originalInv = {...inv};
const originalBag = [
  {id:'blade_1',kind:'weapon',name:'Blade',attackDamage:7},
  {id:'charm_1',kind:'charm',name:'Charm',moveSpeedMult:1.1},
  {id:'cape_1',kind:'cape',name:'Cape',airJumps:2},
  {id:'eyes_1',kind:'eyes',name:'Eyes',visionRadius:14}
];
let snap = {
  v:1,
  equipped:{cape:'classic',eyes:'bright',outfit:'default',weapon:'blade_1',charm:'charm_1'},
  colors:{},
  bag:originalBag.map(i=>({...i})),
  discarded:[],
  shortcutOff:[],
  newItems:originalBag.map(i=>i.id)
};
const grants = [];
const slots = [
  {id:'cape',accepts:'cape',required:true,def:'classic'},
  {id:'eyes',accepts:'eyes',required:true,def:'bright'},
  {id:'outfit',accepts:'outfit',required:true,def:'default'},
  {id:'weapon',accepts:'weapon',required:false,def:null},
  {id:'charm',accepts:'charm',required:false,def:null}
];
const inventory = {
  SLOTS:slots,
  snapshot:()=>JSON.parse(JSON.stringify(snap)),
  restore(next){ snap=JSON.parse(JSON.stringify(next)); return true; },
  grantItem(item){ grants.push(item.id); if(!snap.bag.some(i=>i.id===item.id)) snap.bag.push({...item}); return true; },
  equip(id){
    const item = snap.bag.find(i=>i.id===id);
    const slot = slots.find(s=>item && s.accepts===item.kind);
    if(slot){ snap.equipped[slot.id]=id; return true; }
    return false;
  }
};
let dynamicLootSaves = 0;
MM.dynamicLoot = {capes:[],eyes:[],outfits:[],weapons:[],charms:[]};
MM.chests = {saveDynamicLoot(){ dynamicLootSaves++; }};
for(const item of originalBag){
  const keyName = item.kind === 'cape' ? 'capes' : item.kind === 'eyes' ? 'eyes' : item.kind === 'outfit' ? 'outfits' : item.kind === 'weapon' ? 'weapons' : 'charms';
  MM.dynamicLoot[keyName].push({...item});
}
overrides.clear();
saveMarks = 0;
taskCalls.length = 0;
const theft = invasions.onHeroKilled({player, inv, resourceKeys:['wood','stone','diamond'], inventory, getTile, setTile, ...ctx});
assert.equal(theft.handled, true, 'alien-caused death is handled by the invasion theft path');
assert.ok(theft.cache && getTile(theft.cache.x,theft.cache.y)===T.INVASION_CACHE, 'stolen loot is hidden in a special neighborhood cache tile');
assert.ok(taskCalls.some(c=>c[0] === 'upsert' && c[1] === theft.cache.id), 'stolen loot cache registers a recovery task');
assert.ok(inv.wood < originalInv.wood || inv.stone < originalInv.stone || inv.diamond < originalInv.diamond, 'alien theft removes roughly half of carried resources');
assert.ok(snap.bag.length < originalBag.length, 'alien theft removes random dynamic gear from the bag');
assert.ok(theft.cache.gear.length >= 1, 'alien cache records stolen gear objects for recovery');
const stolenIds = new Set(theft.cache.gear.map(item=>item.id));
const dynamicIds = new Set(Object.values(MM.dynamicLoot).flat().map(item=>item && item.id).filter(Boolean));
for(const id of stolenIds) assert.equal(dynamicIds.has(id), false, 'stolen gear is removed from the dynamic loot pool until recovery');
assert.ok(dynamicLootSaves >= 1, 'stealing gear persists the dynamic loot pool cleanup');
assert.ok(saveMarks >= 1, 'creating a theft cache asks the host save system to persist it');
const theftSnap = invasions.snapshot();
invasions.reset();
taskCalls.length = 0;
assert.equal(invasions.restore(theftSnap,getTile,setTile), true, 'invasion restore accepts theft-cache snapshots');
assert.ok(taskCalls.some(c=>c[0] === 'sync' && c[1] === 1), 'restoring theft caches refreshes task tracker state');
taskCalls.length = 0;
assert.ok(invasions.openCacheAt(theft.cache.x,theft.cache.y,{inv, inventory, getTile, setTile, updateInventory(){}, saveState(){}, notifyStructureTileChanged(){}}), 'opening the cache restores stolen loot');
assert.ok(taskCalls.some(c=>c[0] === 'complete' && c[1] === theft.cache.id), 'opening the stolen loot cache completes its task');
assert.equal(getTile(theft.cache.x,theft.cache.y), T.AIR, 'opened cache tile is cleared');
assert.equal(snap.bag.length, originalBag.length, 'opening the cache grants stolen gear back');
assert.ok(inv.wood >= originalInv.wood && inv.stone >= originalInv.stone, 'opening the cache restores stolen resources');
assert.ok(grants.length >= theft.cache.gear.length, 'each stolen gear item is granted back through inventory APIs');

saveMarks = 0;
overrides.set(key(8,49), T.WOOD);
assert.ok(invasions._debug.damageStructureTile(8,49,99,getTile,setTile,ctx), 'alien lasers can destroy a player-built shelter tile');
assert.equal(getTile(8,49), T.AIR, 'destroyed shelter tile is removed from the world');
assert.ok(saveMarks >= 1, 'alien structure damage asks the host save system to persist world changes');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ invasions as INVASIONS \} from '\.\/engine\/invasions\.js';/, 'main imports the invasion engine');
assert.match(mainSrc, /import \{ tasks as TASKS \} from '\.\/engine\/tasks\.js';/, 'main imports the task tracker before invasion cache updates');
assert.match(mainSrc, /cause==='alien_invasion'[\s\S]*INVASIONS\.onHeroKilled/, 'alien deaths route to invasion theft before normal gravestones');
assert.match(mainSrc, /invasions: timedSavePart\('invasions',[^\n]*INVASIONS && INVASIONS\.snapshot/, 'save payload includes invasion state');
assert.match(mainSrc, /tasks: timedSavePart\('tasks',[^\n]*TASKS && TASKS\.snapshot/, 'save payload includes the task tracker state');
assert.match(mainSrc, /INVASIONS\.restore\(data\.invasions,getTile,setTile\)/, 'load path restores invasion teams and caches');
assert.match(mainSrc, /TASKS\.drawHUD\(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible,player\)/, 'main gives task targets the shared red pointer before boss arrows');
assert.match(mainSrc, /INVASIONS\.update\(dt, player, getTile, setTile/, 'main update loop advances invasions');
assert.match(mainSrc, /INVASIONS\.draw\(ctx,TILE,worldFxVisible\)/, 'main draw loop renders invasions');
assert.match(mainSrc, /injectInvasionDebugPanel/, 'main wires the invasion debug panel into the menu');
assert.match(mainSrc, /forceMolekinInvasion/, 'main exposes a debug action for forcing molekin night attacks');
assert.match(mainSrc, /tryOpenInvasionCacheAt/, 'main has a dedicated invasion cache opener');
assert.match(mainSrc, /const invasionHitCause = opts\.cause==='alien_invasion' \|\| opts\.cause==='molekin_invasion';[\s\S]*notifyInvasionHeroAction\(invasionHitCause\?'hero_hit':'hero_hurt'/, 'successful invasion hero damage notifies team chatter');
assert.match(mainSrc, /notifyInvasionHeroAction\('hero_mine'/, 'successful mining notifies alien chatter');
assert.match(mainSrc, /notifyInvasionWeaponUse/, 'weapon usage notifies alien chatter');
assert.match(weaponsSrc, /MM\.invasions && MM\.invasions\.attackAt/, 'melee weapons can hit invasion enemies');
assert.match(weaponsSrc, /MM\.invasions && MM\.invasions\.damageAt/, 'ranged and stream weapons can damage invasion enemies');
assert.match(weaponsSrc, /MM\.invasions && MM\.invasions\.blastRadius/, 'gas explosions damage invasion enemies');

console.log('invasions-sim: all assertions passed');
