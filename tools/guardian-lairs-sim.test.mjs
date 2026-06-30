// Deterministic Node coverage for elemental guardian lairs and standalone fights.
// Run: node tools/guardian-lairs-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {getItem(){ return null; }, setItem(){}, removeItem(){}};
globalThis.msg = ()=>{};
globalThis.damageHero = (amount)=>{ if(globalThis.player) globalThis.player.hp-=amount; };
globalThis.CustomEvent = class CustomEvent{ constructor(type,init){ this.type=type; this.detail=init && init.detail; } };
globalThis.dispatchEvent = ()=>{};

const { T, CHUNK_W } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { meteorites } = await import('../src/engine/meteorites.js');
const { guardianLairs } = await import('../src/engine/guardian_lairs.js');
const { world } = await import('../src/engine/world.js');

assert.ok(guardianLairs && world && meteorites, 'guardian, meteorite, and world modules export');

WG.worldSeed = 20260630;
WG.clearCaches && WG.clearCaches();
guardianLairs.clearCache();
guardianLairs.reset();
world.clear();

assert.equal(guardianLairs.config.DISTANCE, 10000, 'guardian threshold is exactly 10000 blocks');

const fire = guardianLairs.layoutFor('fire');
const ice = guardianLairs.layoutFor('ice');
assert.ok(fire.ax >= 10000, 'fire lair anchors east of +10000');
assert.ok(ice.ax <= -10000, 'ice lair anchors west of -10000');
assert.ok(Math.floor(fire.minX/CHUNK_W)!==Math.floor(fire.maxX/CHUNK_W), 'fire lair spans chunks');
assert.ok(Math.floor(ice.minX/CHUNK_W)!==Math.floor(ice.maxX/CHUNK_W), 'ice lair spans chunks');
assert.ok(![5,6,8].includes(WG.biomeType(fire.ax)), 'fire lair avoids ocean/lake/city biomes');
assert.ok(![5,6,8].includes(WG.biomeType(ice.ax)), 'ice lair avoids ocean/lake/city biomes');
assert.ok(fire.ops.some(o=>o.t===T.LAVA), 'fire lair has lava arena control');
assert.ok(fire.ops.some(o=>o.t===T.OBSIDIAN), 'fire lair has obsidian fortress blocks');
assert.ok(fire.ops.some(o=>o.t===T.BASALT), 'fire lair has basalt crucible blocks');
assert.ok(ice.ops.some(o=>o.t===T.ICE), 'ice lair has ice walls');
assert.ok(ice.ops.some(o=>o.t===T.SNOW), 'ice lair has snow reliquary blocks');
assert.ok(ice.ops.some(o=>o.t===T.DIAMOND), 'ice lair has crystal pillars');
assert.equal(fire.sidekickSpawns.length, 2, 'fire lair defines two sidekick spawns');
assert.equal(ice.sidekickSpawns.length, 2, 'ice lair defines two sidekick spawns');

const fireAgain = guardianLairs.layoutFor('fire');
assert.equal(fireAgain.ax, fire.ax, 'same seed gives same fire anchor');
WG.worldSeed = 20260631; WG.clearCaches && WG.clearCaches(); guardianLairs.clearCache();
const shifted = guardianLairs.layoutFor('fire');
assert.notEqual(shifted.ax, fire.ax, 'different seed changes guardian anchor');

WG.worldSeed = 20260630; WG.clearCaches && WG.clearCaches(); guardianLairs.clearCache(); world.clear();
const fire2 = guardianLairs.layoutFor('fire');
const forced = fire2.ops.filter(o=>o.f===1).slice(0,240);
for(const o of forced) assert.equal(world.getTile(o.x,o.y), o.t, 'forced guardian op materializes at '+o.x+','+o.y);
const snapshot=[];
for(let x=fire2.minX;x<=fire2.maxX;x++) for(let y=fire2.minY;y<=fire2.maxY;y++) snapshot.push(world.getTile(x,y));
world.clear();
let i=0, same=true;
for(let x=fire2.minX;x<=fire2.maxX;x++) for(let y=fire2.minY;y<=fire2.maxY;y++){ if(world.getTile(x,y)!==snapshot[i++]){ same=false; break; } }
assert.ok(same, 'guardian lair regenerates identically after world clear');

const marks = {};
const weather = {storms:0, clouds:0, strikes:0, lastStorm:null};
const granted = [];
const ownedWeapons = [
  {id:'baseline_beam', kind:'weapon', weaponType:'electric', fireDps:12, fireRange:8.5, energyCost:10, energyCapacityBonus:0}
];
function scoreItem(item){
  if(!item) return 0;
  let s = 0;
  if(typeof item.attackDamage === 'number') s += item.attackDamage * 6;
  if(typeof item.fireDps === 'number') s += item.fireDps * 5;
  if(typeof item.fireRange === 'number') s += item.fireRange * 2;
  if(typeof item.energyCost === 'number') s -= item.energyCost * 0.45;
  if(typeof item.energyCapacityBonus === 'number') s += item.energyCapacityBonus * 0.55;
  return Math.max(0, Math.round(s));
}
globalThis.inv = {heartFire:0, heartIce:0};
globalThis.MM.progress = {
  markGuardianHeart(kind){ if(marks[kind]) return false; marks[kind]=1; return true; },
  guardianHearts(){ return Object.assign({}, marks); }
};
globalThis.MM.inventory = {
  itemScore: scoreItem,
  items(kind){ return kind === 'weapon' ? ownedWeapons.slice() : []; },
  equippedItem(slot){ return slot === 'weapon' ? ownedWeapons[0] : null; },
  grantItem(item, opts){
    granted.push({item:Object.assign({}, item), opts:Object.assign({}, opts)});
    ownedWeapons.push(Object.assign({}, item));
    return true;
  }
};
globalThis.MM.clouds = {
  startStorm(duration,intensity){ weather.storms++; weather.lastStorm={duration,intensity}; return weather.lastStorm; },
  addCloud(){ weather.clouds++; return {}; },
  strike(){ weather.strikes++; return {x:0,y:0}; },
  metrics(){ return {clouds:weather.clouds, storm:{active:weather.storms>0,intensity:weather.lastStorm?weather.lastStorm.intensity:0,tLeft:weather.lastStorm?weather.lastStorm.duration:0}}; }
};
globalThis.player = {x:fire2.ax,y:fire2.floorY-4,hp:500,maxHp:500,vx:0,vy:0};
guardianLairs.reset();
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
let status = guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='fire' && e.boss).length, 1, 'entering fire lair awakens one boss');
assert.equal(status.entities.filter(e=>e.kind==='fire' && !e.boss).length, 2, 'entering fire lair guarantees both sidekicks');
assert.ok(weather.storms >= 1, 'guardian fight start forces cloudy storm weather');
assert.ok(weather.clouds >= 4, 'guardian fight start seeds heavy clouds over the lair');
guardianLairs._debug().hazards.push({type:'projectile',kind:'fire',x:fire2.ax,y:fire2.floorY-8,vx:0,vy:0,r:0.35,t:0,life:3,dmg:0});
globalThis.player.x = ice.ax;
globalThis.player.y = ice.floorY-4;
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
status = guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='fire').length, 0, 'fire guardian sleeps when the hero leaves the east gate neighbourhood');
assert.equal(guardianLairs._debug().hazards.some(h=>h.kind==='fire'), false, 'sleeping a guardian clears its local hazards');
assert.equal(status.entities.filter(e=>e.kind==='ice' && e.boss).length, 1, 'ice guardian can awaken after leaving the fire gate');
globalThis.player.x = fire2.ax;
globalThis.player.y = fire2.floorY-4;
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
status = guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='ice').length, 0, 'ice guardian sleeps when the hero returns east');
assert.equal(status.entities.filter(e=>e.kind==='fire' && e.boss).length, 1, 'returning to the fire gate reawakens the undefeated guardian');
for(let step=0; step<160; step++) guardianLairs.update(1/30, globalThis.player, world.getTile, world.setTile);
assert.ok(guardianLairs.metrics().hazards > 0, 'guardian special attack timers create hazards');
assert.equal(guardianLairs.metrics().stormMeteors, 0, 'guardian meteor storm waits until the boss is below half health');

const boss = guardianLairs.status().entities.find(e=>e.kind==='fire' && e.boss);
assert.ok(boss, 'fire boss is active before kill');
const rawBoss = guardianLairs._debug().entities.find(e=>e.kind==='fire' && e.boss);
assert.ok(rawBoss, 'fire boss debug entity is active');
rawBoss.hp = rawBoss.maxHp * 0.49;
guardianLairs.update(0.1, globalThis.player, world.getTile, world.setTile);
let stormMetrics = guardianLairs.metrics();
assert.equal(stormMetrics.storm.fire, true, 'fire meteor storm starts below 50 percent boss health');
assert.ok(stormMetrics.stormNextIn.fire >= 39 && stormMetrics.stormNextIn.fire <= 60, 'guardian meteor storm schedules one strike every 40-60 seconds');
assert.equal(stormMetrics.stormMeteors, 0, 'guardian meteor storm does not spawn an immediate barrage');
guardianLairs._debug().state.stormCd.fire = 0;
guardianLairs.update(0.02, globalThis.player, world.getTile, world.setTile);
stormMetrics = guardianLairs.metrics();
assert.equal(stormMetrics.stormMeteors, 1, 'guardian meteor storm spawns only one falling meteor when due');
assert.ok(stormMetrics.stormNextIn.fire >= 39 && stormMetrics.stormNextIn.fire <= 60, 'guardian meteor storm reschedules the next rare strike');
assert.equal(stormMetrics.lightning.fire, false, 'guardian lightning barrage waits until the boss is below 20 percent health');

rawBoss.hp = rawBoss.maxHp * 0.19;
guardianLairs._debug().state.lightningCarry.fire = 1;
guardianLairs.update(0.01, globalThis.player, world.getTile, world.setTile);
const lightningMetrics = guardianLairs.metrics();
assert.equal(lightningMetrics.lightning.fire, true, 'guardian lightning barrage starts below 20 percent boss health');
assert.ok(lightningMetrics.lightningRate.fire >= 6 && lightningMetrics.lightningRate.fire <= 10, 'guardian lightning barrage uses a high strike rate');
assert.ok(lightningMetrics.lightningBolts >= 1, 'guardian lightning barrage spawns local sky lightning hazards');
assert.ok(weather.strikes >= 1, 'guardian lightning barrage also calls into the cloud lightning system');

const rawSidekick = guardianLairs._debug().entities.find(e=>e.kind==='fire' && !e.boss);
assert.ok(rawSidekick, 'sidekick debug entity is active');
const pushedHero = {x:rawSidekick.x,y:rawSidekick.y,w:0.7,h:0.95,vx:0,vy:0,onGround:false,jumpCount:1};
assert.equal(guardianLairs.collideHero(pushedHero,0.1), true, 'guardian bodies physically separate the hero');
assert.ok(Math.hypot(pushedHero.x-rawSidekick.x,pushedHero.y-rawSidekick.y)>0.1, 'guardian body collision moves the hero out of overlap');
rawSidekick.hp = 7;
const cratersBeforeSidekickHit = meteorites.metrics().craters;
guardianLairs._debug().hazards.push({type:'stormMeteor',kind:'fire',x:rawSidekick.x,y:rawSidekick.y,vx:0,vy:0,r:0.7,t:0,life:1,impactY:rawSidekick.y+3,dmg:0,trail:[]});
guardianLairs.update(0.02, globalThis.player, world.getTile, world.setTile);
assert.equal(rawSidekick.hp, rawSidekick.maxHp, 'storm meteor hit resets sidekick health');
assert.ok(meteorites.metrics().craters > cratersBeforeSidekickHit, 'storm meteor hit uses the normal meteorite crater pipeline');

rawBoss.hp = 13;
const cratersBeforeBossHit = meteorites.metrics().craters;
guardianLairs._debug().hazards.push({type:'stormMeteor',kind:'fire',x:rawBoss.x,y:rawBoss.y,vx:0,vy:0,r:4,t:0,life:1,impactY:rawBoss.y+3,dmg:0,trail:[]});
guardianLairs.update(0.02, globalThis.player, world.getTile, world.setTile);
assert.equal(rawBoss.hp, rawBoss.maxHp, 'storm meteor hit resets boss health');
assert.ok(meteorites.metrics().craters > cratersBeforeBossHit, 'storm meteor boss hit also leaves a normal meteorite crater');
assert.equal(guardianLairs.metrics().storm.fire, false, 'meteor storm stops spawning once the boss is restored above half health');

const bossAfterStorm = guardianLairs.status().entities.find(e=>e.kind==='fire' && e.boss);
assert.ok(bossAfterStorm, 'fire boss remains active after storm reset');
globalThis.player.hp = 37;
const heroHpBeforeDeathBlast = globalThis.player.hp;
const cratersBeforeGuardianDeath = meteorites.metrics().craters;
const bestWeaponBeforeReward = Math.max(...ownedWeapons.map(scoreItem));
assert.equal(guardianLairs.damageAt(Math.floor(bossAfterStorm.x), Math.floor(bossAfterStorm.y), 9999), true, 'direct damage can defeat guardian boss');
const deathBlastCraters = meteorites.snapshot().craters;
const deathBlastCrater = deathBlastCraters[deathBlastCraters.length-1];
assert.ok(meteorites.metrics().craters > cratersBeforeGuardianDeath, 'defeating a guardian creates a meteorite death crater');
assert.ok(deathBlastCrater && deathBlastCrater.r >= 38, 'guardian death crater is colossal');
assert.equal(deathBlastCrater.site, 'guardian_defeat', 'guardian death crater is recorded as a guardian defeat impact');
assert.equal(globalThis.player.hp, heroHpBeforeDeathBlast, 'guardian death blast does not damage the hero');
assert.equal(globalThis.inv.heartFire, 1, 'fire heart awarded once');
assert.equal(marks.fire, 1, 'progress records fire guardian defeat');
assert.equal(granted.length, 1, 'released guardian ghost grants exactly one item after the first defeat');
assert.ok(scoreItem(granted[0].item) > bestWeaponBeforeReward, 'released guardian ghost reward outclasses the previous weapon');
assert.equal(granted[0].opts.equip, true, 'released guardian ghost auto-equips the reward');
status = guardianLairs.status();
assert.ok(status.ghosts.fire, 'fire defeat leaves a released guardian ghost NPC');
assert.match(status.ghosts.fire.text, /west.*ice|Aurex/i, 'first released ghost points toward the opposite guardian');
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
assert.equal(guardianLairs.forceAwaken('fire'), true, 'debug rematch can force a defeated guardian');
const rematch = guardianLairs.status().entities.find(e=>e.kind==='fire' && e.boss);
assert.ok(rematch, 'debug rematch spawned boss');
assert.equal(guardianLairs.damageAt(Math.floor(rematch.x), Math.floor(rematch.y), 9999), true, 'debug rematch boss can be defeated');
assert.equal(globalThis.inv.heartFire, 1, 'debug rematch does not duplicate heart reward');
assert.equal(granted.length, 1, 'debug rematch does not duplicate the ghost item reward');

guardianLairs.markDefeated('ice');
status = guardianLairs.status();
assert.equal(status.underground.enabled, true, 'defeating both guardians enables the underground gate');
assert.ok(Math.abs(status.underground.mouthX) <= 240, 'underground passage opens near the world start');
assert.match(status.ghosts.fire.text, /underground gate/i, 'released ghosts switch to underground guidance once both guardians are dead');
const gateLayout = guardianLairs.undergroundGateLayout();
assert.ok(gateLayout.ops.some(o=>o.t === T.ALIEN_BIOMASS), 'underground guide passage uses alien biomass');
assert.ok(gateLayout.ops.some(o=>o.t === T.ANTIMATTER_CRYSTAL), 'underground gate uses antimatter crystal');
const gateForcedByKey = new Map();
for(const o of gateLayout.ops) if(o.f === 1) gateForcedByKey.set(o.x+','+o.y, o);
const gateForced = [...gateForcedByKey.values()].slice(0,260);
for(const o of gateForced) assert.equal(world.getTile(o.x,o.y), o.t, 'forced underground gate op materializes at '+o.x+','+o.y);
let passageAir = 0;
for(const o of gateLayout.ops) if(o.t === T.AIR && Math.abs(o.x - status.underground.mouthX) <= 14) passageAir++;
assert.ok(passageAir > 20, 'underground passage carves a clear access route');
assert.notEqual(world.getTile(status.underground.x, status.underground.y), T.BEDROCK, 'underground gate center is not sealed by bedrock');
const snap = guardianLairs.snapshot();
guardianLairs.reset();
assert.equal(guardianLairs.metrics().defeated.ice, false, 'reset clears runtime defeated flags');
guardianLairs.restore(snap);
assert.equal(guardianLairs.metrics().defeated.ice, true, 'restore preserves guardian defeated flags');
assert.equal(guardianLairs.status().underground.enabled, true, 'restore preserves underground gate enablement');
world.clear();
const restoredGateLayout = guardianLairs.undergroundGateLayout();
const restoredForcedByKey = new Map();
for(const o of restoredGateLayout.ops) if(o.f === 1) restoredForcedByKey.set(o.x+','+o.y, o);
const restoredGateSample = [...restoredForcedByKey.values()].slice(0,120);
for(const o of restoredGateSample) assert.equal(world.getTile(o.x,o.y), o.t, 'underground gate regenerates from guardian snapshot at '+o.x+','+o.y);

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const guardianSrc = await readFile(new URL('../src/engine/guardian_lairs.js', import.meta.url), 'utf8');
assert.match(mainSrc, /function debugJumpGuardian\(kind\)/, 'main exposes a guardian debug jump helper');
assert.match(mainSrc, /window\.teleportHeroToGuardian = function\(kind\)/, 'console debug can teleport the hero to a guardian lair');
assert.match(mainSrc, /guardian:\(kind\)=> debugJumpGuardian\(kind\)/, 'travel debug panel is wired to guardian teleport');
assert.match(mainSrc, /GUARDIANS && GUARDIANS\.collideHero/, 'player physics resolves against guardian bodies');
assert.match(guardianSrc, /isSolidCollisionTile as isSolid/, 'guardian engine uses world solid collision rules');
assert.match(guardianSrc, /function moveEntityPhysical/, 'guardian entities use collision-aware movement');
assert.match(guardianSrc, /function entityCollidesTerrainAt/, 'guardian entities test body circles against terrain');
assert.match(guardianSrc, /function clipLineToSolid/, 'guardian beam attacks clip against terrain instead of drawing through blocks');
assert.match(guardianSrc, /function spawnGuardianGhost/, 'guardian death spawns a released story ghost');
assert.match(guardianSrc, /function enableUndergroundGate/, 'both guardian hearts enable the underground gate');
assert.match(guardianSrc, /function undergroundGateLayout/, 'underground gate is deterministic guardian terrain');
assert.match(uiSrc, /actions\.guardian/, 'travel debug UI includes guardian teleport actions');
assert.match(uiSrc, /Fire gate/, 'travel debug UI includes the fire guardian jump');
assert.match(uiSrc, /Ice gate/, 'travel debug UI includes the ice guardian jump');

console.log('guardian-lairs-sim: all assertions passed');
