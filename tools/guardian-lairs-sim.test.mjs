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
const combatEvents = [];
globalThis.dispatchEvent = (ev)=>{ if(ev && ev.type==='mm-combat-event') combatEvents.push(ev.detail); return true; };

const { T, INFO, CHUNK_W } = await import('../src/constants.js');
const { STORY_LORE } = await import('../src/engine/story_lore.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { softDrifts } = await import('../src/engine/soft_drifts.js');
const { icicles } = await import('../src/engine/icicles.js');
const { thinIce } = await import('../src/engine/thin_ice.js');
const { smoke } = await import('../src/engine/smoke.js');
const { meteorites } = await import('../src/engine/meteorites.js');
const { guardianLairs } = await import('../src/engine/guardian_lairs.js');
const { world } = await import('../src/engine/world.js');

assert.ok(guardianLairs && world && meteorites && softDrifts && icicles && thinIce, 'guardian, meteorite, snow-drift, icicle, thin-ice, and world modules export');

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
assert.ok(fire.ops.some(o=>o.t===T.BEDROCK), 'fire lair has a protected bedrock containment slab');
assert.ok(fire.ops.some(o=>o.t===T.GRAPHITE), 'fire lair uses compressed black soot graphite');
assert.ok(fire.ops.some(o=>o.t===T.GRAPHENE), 'fire lair uses annealed graphene reinforcement');
assert.ok(fire.ops.some(o=>o.t===T.MOTHER_LAVA), 'fire lair uses mother lava relic material');
assert.ok(fire.ops.some(o=>o.t===T.VOLCANO_MASTER_STONE), 'fire lair uses protected volcano stone');
assert.ok(fire.ops.some(o=>o.t===T.CHIMNEY), 'fire lair has working soot chimneys');
assert.ok(fire.design && fire.design.schema==='east_fire_crucible_v3', 'east guardian uses the authored crucible v3 design');
assert.equal(fire.design.stable, true, 'fire crucible declares a stable structural shell');
assert.ok(fire.foundation && fire.foundation.thickness>=8, 'fire crucible has at least eight continuous protected foundation rows');
assert.ok(fire.foundation.cells>900, 'fire crucible foundation spans the whole arena footprint');
assert.ok(fire.sootBeds.length>=10, 'fire crucible defines abundant real Sadza drift beds');
assert.ok(fire.chimneys.length>=4 && fire.embers.length>=40, 'fire crucible precomputes rich but bounded atmosphere decoration');
assert.equal(new Set(fire.ops.map(o=>o.x+','+o.y)).size, fire.ops.length, 'fire layout resolves overlapping passes to one final op per cell');
assert.equal(fire.ops.some(o=>INFO[o.t] && (INFO[o.t].fragileFall || o.t===T.UNSTABLE_SAND || o.t===T.UNSTABLE_GRASS)), false, 'fire arena contains no self-collapsing structural material');
assert.ok(ice.ops.some(o=>o.t===T.ICE), 'ice lair has ice walls');
assert.ok(ice.ops.some(o=>o.t===T.SNOW), 'ice lair has snow reliquary blocks');
assert.ok(ice.ops.some(o=>o.t===T.DIAMOND), 'ice lair has crystal pillars');
assert.ok(ice.ops.some(o=>o.t===T.MOTHER_ICE), 'ice palace uses Mother Ice keystones');
assert.ok(ice.ops.some(o=>o.t===T.THIN_ICE), 'ice palace has real breakable mirror pools');
assert.ok(ice.ops.some(o=>o.t===T.WATER), 'thin-ice mirrors retain a safe water layer underneath');
assert.ok(ice.ops.some(o=>o.t===T.GRASS_SNOW), 'ice palace threshold uses snowy grass');
assert.ok(ice.ops.some(o=>o.t===T.FROZEN_DIRT) && ice.ops.some(o=>o.t===T.FROZEN_SAND) && ice.ops.some(o=>o.t===T.FROZEN_CLAY), 'ice palace archives every permafrost earth type');
assert.ok(ice.ops.some(o=>o.t===T.TOXIC_SNOW), 'ice palace safely displays toxic snow in sealed roof reliquaries');
assert.ok(ice.ops.some(o=>o.t===T.GLASS), 'ice palace uses heartglass arches and mirrors');
assert.ok(ice.ops.some(o=>o.t===T.BEDROCK), 'ice palace has protected structural roots');
assert.ok(ice.design && ice.design.schema==='west_ice_palace_v3', 'west guardian uses the authored ice palace v3 design');
assert.equal(ice.design.stable,true,'ice palace declares a stable structural shell');
assert.deepEqual(ice.design.systems,['snow_drifts','thin_ice','icicles','blizzard_weather','fire_thaw'],'ice palace explicitly composes every live frozen-world system');
assert.ok(ice.foundation && ice.foundation.thickness>=7 && ice.foundation.cells>800,'ice palace has a continuous protected root-bed');
assert.ok(ice.snowBeds.length>=20 && ice.snowMotes.length>=50 && ice.mirrorPools.length===4,'ice palace precomputes rich but bounded snow and reflection dressing');
assert.equal(new Set(ice.ops.map(o=>o.x+','+o.y)).size,ice.ops.length,'ice layout resolves overlapping passes to one final op per cell');
const iceOpByKey=new Map(ice.ops.map(o=>[o.x+','+o.y,o]));
const unsupportedIceGlass=ice.ops.filter(o=>INFO[o.t] && INFO[o.t].fragileFall && !iceOpByKey.has(o.x+','+(o.y+1)));
assert.equal(unsupportedIceGlass.length,0,'heartglass is fully supported decoration, never a self-falling structural span');
assert.equal(fire.sidekickSpawns.length, 2, 'fire lair defines two sidekick spawns');
assert.equal(ice.sidekickSpawns.length, 2, 'ice lair defines two sidekick spawns');

const fireAgain = guardianLairs.layoutFor('fire');
assert.equal(fireAgain.ax, fire.ax, 'same seed gives same fire anchor');
WG.worldSeed = 20260631; WG.clearCaches && WG.clearCaches(); guardianLairs.clearCache();
const shifted = guardianLairs.layoutFor('fire');
assert.notEqual(shifted.ax, fire.ax, 'different seed changes guardian anchor');

WG.worldSeed = 20260630; WG.clearCaches && WG.clearCaches(); guardianLairs.clearCache(); world.clear();
softDrifts.reset();
const fire2 = guardianLairs.layoutFor('fire');
const ice2 = guardianLairs.layoutFor('ice');
function assertFireFoundationIntact(label){
  let bad=null;
  for(let y=fire2.foundation.y0;y<=fire2.foundation.y1 && !bad;y++){
    for(let x=fire2.foundation.x0;x<=fire2.foundation.x1;x++){
      const tile=world.getTile(x,y);
      if(tile!==T.BEDROCK){ bad={x,y,tile}; break; }
    }
  }
  assert.equal(bad,null,label+(bad?' at '+bad.x+','+bad.y+' tile '+bad.tile:''));
}
function assertIceFoundationIntact(label){
  let bad=null;
  for(let y=ice2.foundation.y0;y<=ice2.foundation.y1 && !bad;y++){
    for(let x=ice2.foundation.x0;x<=ice2.foundation.x1;x++){
      const tile=world.getTile(x,y);
      if(tile!==T.BEDROCK){ bad={x,y,tile}; break; }
    }
  }
  assert.equal(bad,null,label+(bad?' at '+bad.x+','+bad.y+' tile '+bad.tile:''));
}
const forced = fire2.ops.filter(o=>o.f===1).slice(0,240);
for(const o of forced) assert.equal(world.getTile(o.x,o.y), o.t, 'forced guardian op materializes at '+o.x+','+o.y);
for(const o of fire2.foundation.sample) assert.equal(world.getTile(o.x,o.y), T.BEDROCK, 'fire foundation sample materializes as protected bedrock at '+o.x+','+o.y);
assertFireFoundationIntact('every authored fire-foundation cell materializes as protected bedrock');
for(const o of ice2.foundation.sample) assert.equal(world.getTile(o.x,o.y),T.BEDROCK,'ice foundation sample materializes as protected bedrock at '+o.x+','+o.y);
assertIceFoundationIntact('every authored ice-foundation cell materializes as protected bedrock');
const snapshot=[];
for(let x=fire2.minX;x<=fire2.maxX;x++) for(let y=fire2.minY;y<=fire2.maxY;y++) snapshot.push(world.getTile(x,y));
world.clear();
let i=0, same=true;
for(let x=fire2.minX;x<=fire2.maxX;x++) for(let y=fire2.minY;y<=fire2.maxY;y++){ if(world.getTile(x,y)!==snapshot[i++]){ same=false; break; } }
assert.ok(same, 'guardian lair regenerates identically after world clear');

const marks = {};
const weather = {storms:0, clouds:0, strikes:0, lastStorm:null};
const granted = [];
const victoryChests = [];
let guardianRelicRolls = 0;
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
globalThis.MM.drops = {
  spawnChest(x,y,tier,opts){ const d={x,y,tier,opts:Object.assign({},opts)}; victoryChests.push(d); return d; },
  rollGuardianDrop(){ guardianRelicRolls++; return {}; },
  rollJewelDrop(){ return {}; }
};
globalThis.MM.clouds = {
  startStorm(duration,intensity){ weather.storms++; weather.lastStorm={duration,intensity}; return weather.lastStorm; },
  addCloud(){ weather.clouds++; return {}; },
  strike(){ weather.strikes++; return {x:0,y:0}; },
  metrics(){ return {clouds:weather.clouds, storm:{active:weather.storms>0,intensity:weather.lastStorm?weather.lastStorm.intensity:0,tLeft:weather.lastStorm?weather.lastStorm.duration:0}}; }
};
globalThis.player = {x:fire2.minX-8,y:fire2.floorY-4,hp:500,maxHp:500,vx:0,vy:0,w:0.7,h:0.95};
globalThis.MM.tutorial = {complete:false, step:0, state:'unfinished'};
globalThis.tutorialComplete = false;
guardianLairs.reset();
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
let status = guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='fire' && e.boss).length, 0, 'standing near but outside the fire arena does not awaken the guardian');
assert.ok(guardianLairs.spawnGuardian('fire','flare',{x:fire2.ax-10,y:fire2.floorY-8,ambient:true}), 'test installs a roaming ambient fire sidekick before arena entry');
assert.equal(guardianLairs.status().entities.filter(e=>e.kind==='fire' && !e.boss).length, 1, 'ambient sidekick exists without a boss');
globalThis.player.x = fire2.ax;
globalThis.player.y = fire2.floorY-4;
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
status = guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='fire' && e.boss).length, 1, 'first arena entry awakens one boss even with an unfinished tutorial and ambient blocker');
assert.equal(status.entities.filter(e=>e.kind==='fire' && !e.boss).length, 2, 'arena entry replaces ambient actors with exactly the authored sidekick pair');
assert.ok(softDrifts.metrics().byMat.soot>=8, 'awakening seeds real black Sadza fluff across the fire arena');
assert.ok(weather.storms >= 1, 'guardian fight start forces cloudy storm weather');
assert.ok(weather.clouds >= 4, 'guardian fight start seeds heavy clouds over the lair');
const renderCalls = {};
const renderGradient = {addColorStop(){ renderCalls.addColorStop=(renderCalls.addColorStop||0)+1; }};
const renderCtx = new Proxy({}, {
  get(target,key){
    if(key in target) return target[key];
    if(key==='createRadialGradient' || key==='createLinearGradient') return ()=>renderGradient;
    if(key==='measureText') return text=>({width:String(text||'').length*7});
    return (...args)=>{ renderCalls[key]=(renderCalls[key]||0)+1; return args.length; };
  },
  set(target,key,value){ target[key]=value; return true; }
});
guardianLairs.draw(renderCtx,20,()=>true,fire2.ax-70,fire2.floorY-52,2800,1400,1);
assert.ok((renderCalls.arc||0)>40, 'active East arena render emits a rich bounded set of circular fire, soot, and entity forms');
assert.ok((renderCalls.bezierCurveTo||0)>=8, 'active East arena render includes authored heat-haze ribbons');
assert.ok((renderCalls.ellipse||0)>=1, 'Magma Hound has a distinct non-orb silhouette');
guardianLairs._debug().hazards.push({type:'projectile',kind:'fire',x:fire2.ax,y:fire2.floorY-8,vx:0,vy:0,r:0.35,t:0,life:3,dmg:0});
globalThis.player.x = ice.ax;
globalThis.player.y = ice.floorY-4;
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
status = guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='fire').length, 0, 'fire guardian sleeps when the hero leaves the east gate neighbourhood');
assert.equal(guardianLairs._debug().hazards.some(h=>h.kind==='fire'), false, 'sleeping a guardian clears its local hazards');
assert.equal(status.entities.filter(e=>e.kind==='ice' && e.boss).length, 1, 'ice guardian can awaken after leaving the fire gate');
assert.equal(status.stages.ice,'aurex','West encounter begins at the monumental sovereign shell');
assert.ok(softDrifts.metrics().byMat.snow>=10,'awakening seeds real ploughable snow fluff across the ice palace');
assert.equal(softDrifts._debug.storm.active,true,'ice awakening starts a real owner-scoped snow gale');
assert.equal(softDrifts._debug.storm.mat,'snow','West guardian gale uses snow, not a recolored generic storm');
assert.ok(icicles.metrics().hanging>0,'ice awakening grows real icicles from the authored cathedral roof');
const westBezierBefore=renderCalls.bezierCurveTo||0, westEllipseBefore=renderCalls.ellipse||0;
guardianLairs.draw(renderCtx,20,()=>true,ice2.ax-70,ice2.floorY-52,2800,1400,1);
assert.ok((renderCalls.bezierCurveTo||0)>=westBezierBefore+3,'West arena renders three bounded aurora ribbons');
assert.ok((renderCalls.ellipse||0)>westEllipseBefore,'West squad artwork uses distinct curved mirror and sentinel forms');
const rawIceBoss = guardianLairs._debug().entities.find(e=>e.kind==='ice' && e.boss);
assert.ok(rawIceBoss, 'ice boss debug entity is active');
assert.ok(rawIceBoss.maxHp >= 940, 'ice guardian has late-game boss durability');
rawIceBoss.hp = rawIceBoss.maxHp;
const iceWeakHp = rawIceBoss.hp;
assert.equal(guardianLairs.damageAt(Math.floor(rawIceBoss.x), Math.floor(rawIceBoss.y), 20, {kind:'flame',element:'fire',source:'hero'}), true, 'flame can hit the ice guardian');
assert.ok(rawIceBoss.hp <= iceWeakHp-25, 'ice guardian takes amplified flame damage');
assert.ok(combatEvents.some(e=>e && e.target==='guardian' && e.element==='fire' && e.bonusDamagePct>=100), 'ice guardian flame weakness emits a bonus combat event');
rawIceBoss.hp = rawIceBoss.maxHp;
const fireArrowHp=rawIceBoss.hp;
assert.equal(guardianLairs.damageAt(Math.floor(rawIceBoss.x),Math.floor(rawIceBoss.y),20,{kind:'arrow',weaponType:'bow',fire:true,source:'hero'}),true,'a burning arrow can hit the ice guardian');
assert.ok(rawIceBoss.hp<=fireArrowHp-25,'the fire flag alone activates the ice guardian weakness');
rawIceBoss.hp = rawIceBoss.maxHp;
const icePlainHp = rawIceBoss.hp;
assert.equal(guardianLairs.damageAt(Math.floor(rawIceBoss.x), Math.floor(rawIceBoss.y), 20, {kind:'hose',element:'water',source:'hero'}), true, 'hose can hit the ice guardian without the flame bonus');
assert.ok(rawIceBoss.hp > icePlainHp-20, 'ice guardian does not take amplified hose damage');
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
assert.ok(rawBoss.maxHp >= 900, 'fire guardian has late-game boss durability');
rawBoss.hp = rawBoss.maxHp;
const fireWeakHp = rawBoss.hp;
assert.equal(guardianLairs.damageAt(Math.floor(rawBoss.x), Math.floor(rawBoss.y), 20, {kind:'hose',element:'water',source:'hero'}), true, 'hose can hit the fire guardian');
assert.ok(rawBoss.hp <= fireWeakHp-40, 'fire guardian takes amplified water damage');
assert.ok(combatEvents.some(e=>e && e.target==='guardian' && e.element==='water' && e.bonusDamagePct>=200), 'fire guardian water weakness emits a bonus combat event');
rawBoss.hp = rawBoss.maxHp;
const firePlainHp = rawBoss.hp;
assert.equal(guardianLairs.damageAt(Math.floor(rawBoss.x), Math.floor(rawBoss.y), 20, {kind:'flame',element:'fire',source:'hero'}), true, 'flame can hit the fire guardian without the water bonus');
assert.ok(rawBoss.hp > firePlainHp-25, 'fire guardian does not take amplified flame damage');
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
assert.ok(rawSidekick.maxHp >= 170, 'guardian sidekicks have enough durability to matter');
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
const bestWeaponBeforeReward = Math.max(...ownedWeapons.map(scoreItem));
let guardianCollateralBlasts=0;
globalThis.MM.mobs={blastRadius(){ guardianCollateralBlasts++; return 1; }};
const cratersBeforeShellBreak = meteorites.metrics().craters;
for(let dead=0;dead<12;dead++) guardianLairs._debug().entities.push({id:-100-dead,kind:'ice',role:'sentinel',boss:false,dead:true});
assert.equal(guardianLairs.damageAt(Math.floor(bossAfterStorm.x), Math.floor(bossAfterStorm.y), 9999), true, 'direct damage can break the symbolic Ignivar shell');
status = guardianLairs.status();
assert.equal(status.stages.fire, 'human', 'breaking Ignivar advances the persistent East encounter to its human stage');
assert.equal(status.entities.filter(e=>e.kind==='fire' && e.role==='boss').length, 0, 'the symbolic dragon is gone after its shell breaks');
assert.equal(status.entities.filter(e=>e.kind==='fire' && e.role==='trueSelf').length, 1, 'a single human fire-bearer emerges from Ignivar');
assert.equal(guardianLairs.metrics().alive,1,'dead entity-cap slots neither block Nara reveal nor pollute live metrics');
assert.equal(status.entities.filter(e=>e.kind==='fire' && !e.boss).length, 0, 'Ignivar sidekicks dissolve during the human reveal');
assert.equal(guardianLairs._debug().hazards.some(h=>h.kind==='fire' && ['stormMeteor','skyLightning'].includes(h.type)), false, 'dragon weather hazards are cleared for the personal duel');
assert.equal(meteorites.metrics().craters, cratersBeforeShellBreak, 'breaking the symbolic shell is a reveal, not the guardian death crater');
assert.equal(globalThis.inv.heartFire, 0, 'Ignivar shell alone does not award the Heart of Fire');
assert.equal(marks.fire, undefined, 'Ignivar shell alone does not complete story progress');
assert.equal(granted.length, 0, 'Ignivar shell alone does not grant the final ghost reward');
assert.equal(victoryChests.length, 0, 'Ignivar shell alone does not raise the victory cache');
assert.equal(guardianRelicRolls, 0, 'Ignivar shell alone does not release the signature relic rain');

const revealRenderBefore = renderCalls.ellipse||0;
guardianLairs.draw(renderCtx,20,()=>true,fire2.ax-70,fire2.floorY-52,2800,1400,1);
assert.ok((renderCalls.ellipse||0)>revealRenderBefore, 'Nara reveal renders a distinctly human face, body, and torch silhouette');

// Leaving or saving after the reveal resumes at Nara; the player never repeats
// the dragon just because the final duel was interrupted.
const humanStageSnap = guardianLairs.snapshot();
assert.equal(humanStageSnap.v, 4, 'both two-stage guardians use snapshot schema v4');
assert.equal(humanStageSnap.avatarBroken.fire, true, 'snapshot records the broken Ignivar shell');
guardianLairs.clearActive();
guardianLairs.restore(humanStageSnap);
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
status = guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='fire' && e.role==='trueSelf').length, 1, 'restoring inside the East arena resumes directly at Nara');
assert.equal(status.entities.some(e=>e.kind==='fire' && e.role==='boss'), false, 'restoring the human stage never respawns Ignivar');
assert.equal(status.storm.fire, false, 'dragon meteor weather remains disabled during Nara duel');

let nara = guardianLairs._debug().entities.find(e=>e.kind==='fire' && e.role==='trueSelf');
assert.ok(nara && nara.human && /Nara/.test(nara.name), 'the final East guardian is an identified human woman');
assert.ok(nara.maxHp>=500 && nara.maxHp<=600, 'Nara has moderate final-duel durability');
for(let step=0;step<50;step++) guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
const telegraphedTorchJet=guardianLairs._debug().hazards.find(h=>h.type==='torchJet');
assert.ok(telegraphedTorchJet && telegraphedTorchJet.delay>=0.7,'Nara opens with a clearly telegraphed coal-torch jet');
const naraStartHp=nara.hp;
assert.equal(guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),30,{kind:'flame',element:'fire',source:'hero'}),true,'ordinary flame impact is consumed by Nara ward');
assert.equal(nara.hp,naraStartHp,'Nara takes no non-ice damage while her torch is lit');
assert.equal(guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),2,{kind:'hose',element:'water',source:'hero'}),true,'ordinary water can weaken Nara lit ward');
const waterDamage=naraStartHp-nara.hp, waterCooling=nara.frostMeter;
nara.hp=naraStartHp; nara.frostMeter=0;
assert.equal(guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),2,{kind:'spit',weaponType:'thrown',element:'water',spit:true,cause:'spit',source:'hero'}),true,'spitting can weaken Nara lit ward');
const spitDamage=naraStartHp-nara.hp, spitCooling=nara.frostMeter;
nara.hp=naraStartHp; nara.frostMeter=0;
assert.equal(guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),2,{kind:'snowball',weaponType:'thrown',element:'ice',snowball:true,cause:'snowball',source:'hero'}),true,'snowball can weaken Nara lit ward');
const snowDamage=naraStartHp-nara.hp, snowCooling=nara.frostMeter;
assert.ok(snowDamage>spitDamage && spitDamage>waterDamage,'damage hierarchy is snowball > spit > other water ('+[snowDamage,spitDamage,waterDamage].join(' > ')+')');
assert.ok(snowCooling>spitCooling && spitCooling>waterCooling,'torch-cooling hierarchy is snowball > spit > other water ('+[snowCooling,spitCooling,waterCooling].join(' > ')+')');
nara.hp=naraStartHp; nara.frostMeter=0;
for(let snow=0;snow<3;snow++){
  assert.equal(guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),2,{kind:'snowball',weaponType:'thrown',element:'ice',snowball:true,cause:'snowball',source:'hero'}),true,'snowball '+(snow+1)+' hits Nara');
}
assert.ok(nara.hp<=naraStartHp-50,'three humble snowballs deal visibly heavy secret-weapon damage');
assert.equal(nara.torchLit,false,'three snowballs cool and extinguish Nara coal torch');
assert.ok(nara.vulnerableT>=6,'extinguishing the torch opens a generous readable damage window');
const dousedHp=nara.hp;
assert.equal(guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),25,{kind:'arrow',weaponType:'bow',source:'hero'}),true,'ordinary weapons can hit during the doused window');
assert.ok(nara.hp<dousedHp-24,'doused Nara takes normal weapon damage');
for(let step=0;step<140;step++) guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
assert.equal(nara.torchLit,true,'Nara visibly relights after the vulnerability window');
const relitHp=nara.hp;
guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),25,{kind:'arrow',weaponType:'bow',source:'hero'});
assert.equal(nara.hp,relitHp,'the fire ward returns when Nara relights');
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='torchRelight') || guardianLairs._debug().hazards.some(h=>h.type==='ring'),'relight produces an authored warning effect');

const cratersBeforeGuardianDeath = meteorites.metrics().craters;
globalThis.player.hp=37;
const heroHpBeforeDeathBlast=globalThis.player.hp;
assert.equal(guardianLairs.damageAt(Math.floor(nara.x),Math.floor(nara.y),9999,{kind:'snowball',element:'ice',snowball:true,cause:'snowball',source:'hero'}), true, 'ice can defeat the real figure behind Ignivar');
const deathBlastCraters = meteorites.snapshot().craters;
const deathBlastCrater = deathBlastCraters[deathBlastCraters.length-1];
assert.ok(meteorites.metrics().craters > cratersBeforeGuardianDeath, 'defeating Nara creates the final guardian death crater');
assert.ok(deathBlastCrater && deathBlastCrater.r >= 38, 'guardian death crater is colossal');
assert.equal(deathBlastCrater.site, 'guardian_defeat', 'guardian death crater is recorded as a guardian defeat impact');
assert.ok(guardianCollateralBlasts>=1,'guardian death explosion damages ordinary nearby mobs through the shared blast router');
assert.equal(globalThis.player.hp, heroHpBeforeDeathBlast, 'guardian death blast does not damage the hero');
assert.equal(globalThis.inv.heartFire, 1, 'fire heart awarded once');
assert.equal(marks.fire, 1, 'progress records fire guardian defeat');
assert.equal(granted.length, 1, 'released guardian ghost grants exactly one item after the first defeat');
assert.ok(scoreItem(granted[0].item) > bestWeaponBeforeReward, 'released guardian ghost reward outclasses the previous weapon');
assert.equal(granted[0].opts.equip, true, 'released guardian ghost auto-equips the reward');
assert.match(granted[0].item.name,/Nara.*Coalheart Torch/i,'East victory grants Nara personal coal-smoke torch');
assert.equal(granted[0].item.coalSmoke,true,'Nara reward retains the coal-smoke visual identity');
assert.equal(victoryChests.length, 1, 'first fire guardian victory raises exactly one guaranteed cache');
assert.equal(victoryChests[0].tier, 'legendary', 'east guardian victory cache is legendary');
assert.equal(victoryChests[0].opts.source, 'fire_guardian_victory', 'victory cache records its one-time fire guardian source');
assert.equal(guardianRelicRolls, 1, 'first guardian victory releases the signature relic rain');
assertFireFoundationIntact('colossal death blast leaves the complete arena containment floor intact');
status = guardianLairs.status();
assert.ok(status.ghosts.fire, 'fire defeat leaves a released guardian ghost NPC');
assert.equal(status.stages.fire,'complete','the East story completes only after the human figure is defeated');
assert.equal(status.ghosts.fire.form,'human','Nara remains as a recognisably human post-fight presence');
assert.match(status.ghosts.fire.text, /west.*ice|Aurex/i, 'first released ghost points toward the opposite guardian');
assert.match(status.ghosts.fire.text, /namietnosc|odtracenie|chlod/i, 'released guardian ghost carries the metaphorical meaning of fire and ice');
assert.match(STORY_LORE.metaphor.guardians.east_fire.symbol, /namietnosc/i, 'shared lore names the fire guardian passion metaphor');
guardianLairs.update(0.05, globalThis.player, world.getTile, world.setTile);
assert.equal(guardianLairs.forceAwaken('fire'), true, 'debug rematch can force a defeated guardian');
const rematch = guardianLairs.status().entities.find(e=>e.kind==='fire' && e.role==='boss');
assert.ok(rematch, 'debug rematch restarts at the symbolic dragon shell');
assert.equal(guardianLairs.damageAt(Math.floor(rematch.x), Math.floor(rematch.y), 9999), true, 'debug rematch can break Ignivar again');
const rematchNara=guardianLairs._debug().entities.find(e=>e.kind==='fire' && e.role==='trueSelf');
assert.ok(rematchNara,'debug rematch still requires the human final stage');
assert.equal(guardianLairs.damageAt(Math.floor(rematchNara.x),Math.floor(rematchNara.y),9999,{element:'ice',kind:'snowball',snowball:true}),true,'debug rematch can defeat Nara again');
assert.equal(globalThis.inv.heartFire, 1, 'debug rematch does not duplicate heart reward');
assert.equal(granted.length, 1, 'debug rematch does not duplicate the ghost item reward');
assert.equal(victoryChests.length, 1, 'debug rematch does not duplicate the legendary victory cache');
assert.equal(guardianRelicRolls, 1, 'debug rematch does not duplicate the signature relic rain');

// West is equally authored but structurally different: Aurex breaks into a
// five-facet nonhuman choir. The final lock is opened by briefly NOT attacking.
globalThis.player.x=ice2.ax;
globalThis.player.y=ice2.floorY-5;
globalThis.player.hp=1e9;
globalThis.player.maxHp=1e9;
guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
status=guardianLairs.status();
assert.equal(status.stages.ice,'aurex','returning west begins with Aurex while its shell is unbroken');
const aurex=guardianLairs._debug().entities.find(e=>e.kind==='ice' && e.role==='boss');
assert.ok(aurex && /Aurex/.test(aurex.name),'the West shell is the named Rime Sovereign');
const westPatterns=new Set();
for(let turn=0;turn<4;turn++){
  aurex.attackCd=0;
  guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
  for(const h of guardianLairs._debug().hazards){
    if(h.kind!=='ice' || h.source!==aurex.id) continue;
    if(h.type==='projectile' && h.variant==='icicle') westPatterns.add('icicle');
    else westPatterns.add(h.type);
  }
  if(guardianLairs._debug().effects.some(e=>e.kind==='ice' && e.type==='iceWall')) westPatterns.add('iceWall');
}
assert.ok(westPatterns.has('projectile') && westPatterns.has('iceWall') && westPatterns.has('blizzard') && westPatterns.has('icicle'),'Aurex cycles shard, maze, blizzard, and icicle-curtain attack families');
aurex.hp=aurex.maxHp*0.63;
guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='auroraCrown'),'Aurex first phase change raises an authored Aurora Crown');
aurex.hp=aurex.maxHp*0.31;
const remoteIcicleKey=(ice2.ax+240)+','+(ice2.floorY-13);
icicles._debug.hang.set(remoteIcicleKey,{x:ice2.ax+240,y:ice2.floorY-13,len:0.8,maxLen:1,drip:5});
guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='palaceFracture'),'Aurex final phase visibly fractures the palace');
assert.equal(icicles._debug.hang.has(remoteIcicleKey),true,'Aurex fractures only palace icicles, leaving remote frozen caves intact');
icicles._debug.hang.delete(remoteIcicleKey);

const westMirror=guardianLairs._debug().entities.find(e=>e.kind==='ice' && e.role==='mirror');
const westSentinel=guardianLairs._debug().entities.find(e=>e.kind==='ice' && e.role==='sentinel');
assert.ok(westMirror && westSentinel,'Aurex arrives with both distinct ice companions');
guardianLairs.damageAt(Math.floor(westMirror.x),Math.floor(westMirror.y),9999,{element:'fire',kind:'flame'});
guardianLairs.damageAt(Math.floor(westSentinel.x),Math.floor(westSentinel.y),9999,{element:'fire',kind:'flame'});
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='mirrorDeath'),'Aurora Mirror has a unique visible implosion death');
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='sentinelDeath'),'Glacier Sentinel has a unique heavy shard death');

const cratersBeforeAurexBreak=meteorites.metrics().craters;
assert.equal(guardianLairs.damageAt(Math.floor(aurex.x),Math.floor(aurex.y),9999,{element:'fire',kind:'flame'}),true,'fire breaks the symbolic Aurex sovereign shell');
status=guardianLairs.status();
assert.equal(status.stages.ice,'choir','breaking Aurex advances the persistent West encounter to Sile');
assert.equal(status.entities.some(e=>e.kind==='ice' && e.role==='boss'),false,'Aurex shell is gone after its sovereign form shatters');
assert.equal(status.entities.filter(e=>e.kind==='ice' && e.role==='choir').length,1,'one five-facet Sile choir emerges from Aurex');
assert.equal(status.entities.filter(e=>e.kind==='ice' && !e.boss).length,0,'Aurex sidekicks remain dissolved during the choir reveal');
assert.equal(guardianLairs._debug().hazards.some(h=>h.kind==='ice' && ['stormMeteor','skyLightning'].includes(h.type)),false,'Aurex weather hazards are cleared for the listening duel');
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='sovereignShatter'),'Aurex shell break has a bespoke sovereign-shatter effect');
assert.equal(meteorites.metrics().craters,cratersBeforeAurexBreak,'breaking Aurex is a reveal, not the final death crater');
assert.equal(globalThis.inv.heartIce,0,'Aurex shell alone does not award the Heart of Ice');
assert.equal(marks.ice,undefined,'Aurex shell alone does not complete West story progress');
assert.equal(granted.length,1,'Aurex shell alone does not grant the final West relic');
assert.equal(victoryChests.length,1,'Aurex shell alone does not raise a victory cache');

const choirRenderBefore=(renderCalls.createLinearGradient||0)+(renderCalls.ellipse||0);
guardianLairs.draw(renderCtx,20,()=>true,ice2.ax-70,ice2.floorY-52,2800,1400,1);
assert.ok((renderCalls.createLinearGradient||0)+(renderCalls.ellipse||0)>choirRenderBefore,'Sile renders as translucent orbiting heartglass facets rather than a copied human form');
const choirStageSnap=guardianLairs.snapshot();
assert.equal(choirStageSnap.v,4,'West choir persistence is included in guardian snapshot v4');
assert.equal(choirStageSnap.avatarBroken.ice,true,'snapshot records the broken Aurex shell');
guardianLairs.clearActive();
guardianLairs.restore(choirStageSnap);
guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
status=guardianLairs.status();
assert.equal(status.entities.filter(e=>e.kind==='ice' && e.role==='choir').length,1,'restoring inside the West arena resumes directly at Sile');
assert.equal(status.entities.some(e=>e.kind==='ice' && e.role==='boss'),false,'restoring the choir stage never respawns Aurex');
assert.equal(status.storm.ice,false,'Aurex meteor weather remains disabled during Sile duel');

let sile=guardianLairs._debug().entities.find(e=>e.kind==='ice' && e.role==='choir');
assert.ok(sile && sile.choir && /Sile/.test(sile.name),'the final West guardian is an identified nonhuman collective');
assert.ok(sile.maxHp>=600 && sile.maxHp<=700,'Sile has moderate final-duel durability');
const sileStartHp=sile.hp;
assert.equal(guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),40,{element:'fire',kind:'flame',source:'hero'}),true,'a premature fire strike reaches Sile ward');
assert.equal(sile.hp,sileStartHp,'all attacks are reflected while Sile is sealed');
assert.equal(sile.quietT,0,'attacking the sealed choir restarts the visible listening timer');
for(let step=0;step<20;step++) guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
const passiveQuiet=sile.quietT;
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),4,{element:'fire',source:'status',cause:'burn_dot'});
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),4,{element:'fire',kind:'fire_turret',source:'turret'});
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),4,{element:'electric',kind:'companion_laser',source:'companion'});
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),4,{kind:'explosion',source:'meteor',cause:'meteor_blast'});
assert.equal(sile.quietT,passiveQuiet,'status, turrets, companions, and weather cannot deadlock Sile after the player stops attacking');
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),4,{kind:'arrow',source:'hero'});
assert.equal(sile.quietT,0,'a fresh deliberate player strike still restarts Sile silence');
globalThis.MM.bossStatus.applyRadius(sile.x,sile.y,2,'chill',{dur:4,source:'hero',cause:'snowball_chill'});
for(let step=0;step<55;step++) guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
assert.equal(sile.sealed,false,'briefly not attacking opens Sile heartglass on real time even while chilled');
assert.ok(sile.listeningT>=6.8,'successful listening opens a generous readable answer window');
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='choirListen'),'opening the choir produces a bespoke five-ring listening effect');
const openHp=sile.hp;
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),20,{kind:'arrow',weaponType:'bow',source:'hero'});
const ordinaryOpenDamage=openHp-sile.hp;
sile.hp=openHp;
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),20,{kind:'snowball',element:'ice',snowball:true,source:'hero'});
const iceOpenDamage=openHp-sile.hp;
sile.hp=openHp;
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),20,{kind:'flame',element:'fire',source:'hero'});
const fireOpenDamage=openHp-sile.hp;
assert.ok(fireOpenDamage>ordinaryOpenDamage && ordinaryOpenDamage>iceOpenDamage,'open-heartglass hierarchy is fire > ordinary > ice ('+[fireOpenDamage,ordinaryOpenDamage,iceOpenDamage].join(' > ')+')');
assert.ok(combatEvents.some(e=>e && e.cause==='heartglass_fire_weakness' && e.bonusDamagePct>=250),'Sile fire weakness emits a major readable combat event');
const combatEventsBeforeBurnTick=combatEvents.length;
sile.hp=openHp;
guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),2,{element:'fire',source:'status',cause:'burn_dot'});
assert.ok(sile.hp<openHp,'a lingering burn keeps its ice-weakness damage during the open answer window');
assert.equal(combatEvents.length,combatEventsBeforeBurnTick,'burn ticks do not flood the major combat-event channel');
globalThis.MM.bossStatus.applyRadius(sile.x,sile.y,2,'chill',{dur:10,source:'hero',cause:'snowball_chill'});
for(let step=0;step<145;step++) guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
assert.equal(sile.sealed,true,'Sile facets close after the real-time answer window even while chilled');
for(let retry=0;retry<3;retry++){
  guardianLairs.update(1.0,globalThis.player,world.getTile,world.setTile);
  guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),5,{kind:'arrow',weaponType:'bow',source:'hero'});
}
assert.equal(sile.sealed,true,'repeated impatience keeps the choir sealed');
assert.equal(sile.quietT,0,'each premature hit visibly restarts the listening solution');
for(let step=0;step<55;step++) guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
assert.equal(sile.sealed,false,'a second deliberate pause reopens the choir');

const cratersBeforeSileDeath=meteorites.metrics().craters;
const bestWeaponBeforeIceReward=Math.max(...ownedWeapons.map(scoreItem));
assert.equal(guardianLairs.damageAt(Math.floor(sile.x),Math.floor(sile.y),9999,{kind:'flame',element:'fire',source:'hero'}),true,'fire can release the real choir beneath Aurex');
assert.ok(meteorites.metrics().craters>cratersBeforeSileDeath,'defeating Sile creates the final West guardian death crater');
assert.ok(guardianLairs._debug().effects.some(e=>e.type==='choirRelease'),'Sile death releases five facets and a warm meltwater core');
assert.equal(globalThis.inv.heartIce,1,'ice heart awarded once, after Sile');
assert.equal(marks.ice,1,'progress records the final West defeat');
assert.equal(granted.length,2,'released Sile ghost grants exactly one additional item');
assert.ok(scoreItem(granted[1].item)>bestWeaponBeforeIceReward,'Sile ghost reward outclasses the previous best weapon');
assert.match(granted[1].item.name,/Sile.*Heartglass Refrain/i,'West victory grants Sile personal heartglass bow');
assert.equal(granted[1].item.weaponType,'bow','Sile reward is a rapid bow rather than the old generic electric beam');
assert.equal(granted[1].item.mergePerk,'frost','Sile reward carries the persisted frost combat perk');
assert.equal(victoryChests.length,2,'first West victory raises exactly one additional guaranteed cache');
assert.equal(victoryChests[1].tier,'epic','West guardian victory cache is epic');
assert.equal(victoryChests[1].opts.source,'ice_guardian_victory','victory cache records its one-time ice guardian source');
assert.equal(guardianRelicRolls,4,'West squad releases two companion drops plus one final signature relic rain');
assertIceFoundationIntact('colossal West death blast leaves the complete protected root-bed intact');
status=guardianLairs.status();
assert.equal(status.stages.ice,'complete','West story completes only after the choir is released');
assert.ok(status.ghosts.ice && status.ghosts.ice.form==='choir','West defeat leaves Sile as a five-facet ghost presence');
globalThis.player.x=status.ghosts.ice.x;
globalThis.player.y=status.ghosts.ice.y;
guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
assert.match(guardianLairs.status().ghosts.ice.text,/underground gate/i,'Sile prioritizes the newly opened underground objective after both hearts are free');

assert.equal(guardianLairs.forceAwaken('ice'),true,'debug West rematch restarts the complete authored arc');
const rematchAurex=guardianLairs._debug().entities.find(e=>e.kind==='ice' && e.role==='boss');
assert.ok(rematchAurex,'debug West rematch starts at Aurex, not Sile');
guardianLairs.damageAt(Math.floor(rematchAurex.x),Math.floor(rematchAurex.y),9999,{element:'fire',kind:'flame'});
const rematchSile=guardianLairs._debug().entities.find(e=>e.kind==='ice' && e.role==='choir');
assert.ok(rematchSile,'debug West rematch still requires the listening final stage');
rematchSile.quietT=rematchSile.quietNeed;
guardianLairs.update(0.05,globalThis.player,world.getTile,world.setTile);
guardianLairs.damageAt(Math.floor(rematchSile.x),Math.floor(rematchSile.y),9999,{element:'fire',kind:'flame'});
assert.equal(globalThis.inv.heartIce,1,'debug West rematch does not duplicate Heart of Ice');
assert.equal(granted.length,2,'debug West rematch does not duplicate Sile relic');
assert.equal(victoryChests.length,2,'debug West rematch does not duplicate victory cache');
assert.equal(guardianRelicRolls,4,'debug West rematch does not duplicate signature relic rain');

status = guardianLairs.status();
assert.equal(status.underground.enabled, true, 'defeating both guardians enables the underground gate');
assert.ok(Math.abs(status.underground.mouthX) <= 240, 'underground passage opens near the world start');
assert.match(status.ghosts.fire.text, /underground gate/i, 'released ghosts switch to underground guidance once both guardians are dead');
assert.match(status.ghosts.fire.text, /namietnosc/i, 'released ghosts keep their defeated guardian metaphor after both gates are free');
const gateLayout = guardianLairs.undergroundGateLayout();
assert.ok(gateLayout.ops.some(o=>o.t === T.ALIEN_BIOMASS), 'underground guide passage uses alien biomass');
assert.ok(gateLayout.ops.some(o=>o.t === T.ANTIMATTER_CRYSTAL), 'underground gate uses antimatter crystal');
assert.equal(gateLayout.sealed, true, 'underground guide entrance starts sealed');
assert.ok(gateLayout.design && gateLayout.design.schema === 'mole_surface_gate_v2', 'underground guide has a coherent surface-gate design schema');
assert.ok(gateLayout.seal && gateLayout.seal.bedrockThickness >= 3, 'underground guide entrance has at least three bedrock layers');
assert.ok(gateLayout.seal && gateLayout.seal.bedrockCells > 300, 'underground guide passage has a substantial bedrock containment shell');
const gateForcedByKey = new Map();
for(const o of gateLayout.ops) if(o.f === 1) gateForcedByKey.set(o.x+','+o.y, o);
const gateForced = [...gateForcedByKey.values()].slice(0,260);
for(const o of gateForced) assert.equal(world.getTile(o.x,o.y), o.t, 'forced underground gate op materializes at '+o.x+','+o.y);
let passageAir = 0;
for(const o of gateLayout.ops) if(o.t === T.AIR && Math.abs(o.x - status.underground.mouthX) <= 14) passageAir++;
assert.ok(passageAir > 20, 'underground passage carves a clear access route');
assert.notEqual(world.getTile(gateLayout.seal.x, gateLayout.seal.y), T.AIR, 'underground guide mouth is physically sealed');
assert.notEqual(world.getTile(status.underground.x, status.underground.y), T.BEDROCK, 'underground gate center is not sealed by bedrock');
const snap = guardianLairs.snapshot();
guardianLairs.reset();
assert.equal(guardianLairs._debug().state.defeated.ice, false, 'reset clears runtime defeated flags even while external progress still owns its heart');
guardianLairs.restore(snap);
assert.equal(guardianLairs._debug().state.defeated.ice, true, 'restore preserves guardian defeated flags');
assert.equal(guardianLairs.status().underground.enabled, true, 'restore preserves underground gate enablement');
const cleanCrossSave={v:4,defeated:{fire:false,ice:false},avatarBroken:{fire:false,ice:false},awakened:{fire:false,ice:false},ambientCd:{fire:28,ice:34},ghosts:{fire:null,ice:null},underground:{enabled:false}};
guardianLairs.restore(cleanCrossSave);
assert.equal(guardianLairs._debug().state.defeated.fire,false,'guardian restore ignores stale progress hearts from a previously loaded save');
assert.equal(guardianLairs._debug().state.avatarBroken.fire,false,'clean cross-save restore cannot inherit the previous save\'s broken Ignivar shell');
assert.equal(guardianLairs._debug().state.defeated.ice,false,'clean cross-save restore ignores the previous save\'s Heart of Ice');
assert.equal(guardianLairs._debug().state.avatarBroken.ice,false,'clean cross-save restore cannot inherit the previous save\'s broken Aurex shell');
guardianLairs.restore(snap);
world.clear();
const restoredGateLayout = guardianLairs.undergroundGateLayout();
const restoredForcedByKey = new Map();
for(const o of restoredGateLayout.ops) if(o.f === 1) restoredForcedByKey.set(o.x+','+o.y, o);
const restoredGateSample = [...restoredForcedByKey.values()].slice(0,120);
for(const o of restoredGateSample) assert.equal(world.getTile(o.x,o.y), o.t, 'underground gate regenerates from guardian snapshot at '+o.x+','+o.y);

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const guardianSrc = await readFile(new URL('../src/engine/guardian_lairs.js', import.meta.url), 'utf8');
const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.match(mainSrc, /function debugJumpGuardian\(kind\)/, 'main exposes a guardian debug jump helper');
assert.match(mainSrc, /window\.teleportHeroToGuardian = function\(kind\)/, 'console debug can teleport the hero to a guardian lair');
assert.match(mainSrc, /guardian:\(kind\)=> debugJumpGuardian\(kind\)/, 'travel debug panel is wired to guardian teleport');
assert.match(mainSrc, /GUARDIANS && GUARDIANS\.collideHero/, 'player physics resolves against guardian bodies');
assert.match(guardianSrc, /isSolidCollisionTile as isSolid/, 'guardian engine uses world solid collision rules');
assert.match(guardianSrc, /function moveEntityPhysical/, 'guardian entities use collision-aware movement');
assert.match(guardianSrc, /function entityCollidesTerrainAt/, 'guardian entities test body circles against terrain');
assert.match(guardianSrc, /function clipLineToSolid/, 'guardian beam attacks clip against terrain instead of drawing through blocks');
assert.match(guardianSrc, /function playerInsideGuardianArena\(kind,player,L\)/, 'guardian awakening is tied to entering the generated arena bounds');
assert.match(guardianSrc, /function awakenOnArenaEntry\(kind,player,L,getTile,setTile\)/, 'guardian engine has a dedicated geometry-only first-entry activation path');
assert.match(guardianSrc, /east_fire_crucible_v3/, 'guardian engine contains the hardened East fire crucible design');
assert.match(guardianSrc, /west_ice_palace_v3/, 'guardian engine contains the hardened West ice-palace design');
assert.match(guardianSrc, /seedFireArenaAtmosphere/, 'fire guardian awakening connects to real Sadza and smoke systems');
assert.match(guardianSrc, /function seedIceArenaAtmosphere/, 'ice guardian awakening connects to snow-drift and icicle systems');
assert.match(guardianSrc, /function guardianWeaknessMultiplier/, 'guardian fights resolve elemental weapon weaknesses inside the guardian engine');
assert.match(guardianSrc, /function hitTrueSelf/, 'Nara has a dedicated ice-and-doused-window damage contract');
assert.match(guardianSrc, /function spawnNaraTorchJet/, 'Nara uses an authored coal-torch attack rather than the dragon attack set');
assert.match(guardianSrc, /Passion is a fire alarm/, 'Nara has thought-provoking fire and simulation dialogue');
assert.match(guardianSrc, /Did you just spit at the firewall\? Disgusting\. Clever\./, 'Nara reacts distinctly to the second-best joke weapon');
assert.match(guardianSrc, /function drawNara\(/, 'Nara has dedicated code-native human artwork');
assert.match(guardianSrc, /function updateIceChoir/, 'Sile has a dedicated listen-before-answer combat contract');
assert.match(guardianSrc, /Every strike restarts the silence/, 'Sile explicitly teaches that impatience resets its ward');
assert.match(guardianSrc, /Cold is not the absence of feeling/, 'Sile has original thought-provoking ice and simulation dialogue');
assert.match(guardianSrc, /function drawIceArenaAtmosphere/, 'West arena has dedicated aurora, snowfall, and reflection artwork');
assert.match(guardianSrc, /function drawIceEntity/, 'West squad has dedicated code-native ice artwork');
assert.match(weaponsSrc, /function projectileImpactOpts\(a\)/, 'projectile impact metadata has one hardened classifier');
assert.match(weaponsSrc, /const trueSnow=!!a\.snowball && \(a\.splat==='snow' \|\| a\.splat==='toxic'\)/, 'only real snow and toxic snow qualify for the ice secret');
assert.match(weaponsSrc, /guardianLairs\.damageAt\(tx,ty,hitDmg,arrowOpts\)/, 'guardian impacts receive complete projectile metadata');
assert.match(guardianSrc, /function spawnGuardianGhost/, 'guardian death spawns a released story ghost');
assert.match(guardianSrc, /function enableUndergroundGate/, 'both guardian hearts enable the underground gate');
assert.match(guardianSrc, /function undergroundGateLayout/, 'underground gate is deterministic guardian terrain');
assert.match(uiSrc, /actions\.guardian/, 'travel debug UI includes guardian teleport actions');
assert.match(uiSrc, /Fire gate/, 'travel debug UI includes the fire guardian jump');
assert.match(uiSrc, /Ice gate/, 'travel debug UI includes the ice guardian jump');

// Long-fight budget: authored patterns must recycle their hazards/effects instead
// of accumulating work every frame. This runs three minutes of the human stage
// without waiting on wall-clock animation.
guardianLairs.reset();
smoke.reset();
globalThis.player={x:fire2.ax,y:fire2.floorY-4,hp:1e9,maxHp:1e9,vx:0,vy:0,w:0.7,h:0.95};
const perfNara=guardianLairs.spawnGuardian('fire','trueSelf',{x:fire2.ax,y:fire2.floorY-2.15,seed:424242});
assert.ok(perfNara,'long-fight budget spawns Nara directly');
let peakHazards=0,peakEffects=0,peakSmoke=0;
const seenNaraPatterns=new Set();
const perfStart=performance.now();
for(let step=0;step<10800;step++){
  guardianLairs.update(1/60,globalThis.player,()=>T.AIR,()=>{});
  smoke.update(1/60,()=>T.AIR);
  const dbg=guardianLairs._debug();
  peakHazards=Math.max(peakHazards,dbg.hazards.length);
  peakEffects=Math.max(peakEffects,dbg.effects.length);
  peakSmoke=Math.max(peakSmoke,smoke.metrics().active);
  for(const h of dbg.hazards) seenNaraPatterns.add(h.type);
}
const perfMs=performance.now()-perfStart;
assert.ok(seenNaraPatterns.has('torchJet') && seenNaraPatterns.has('projectile') && seenNaraPatterns.has('impact'),'long Nara duel exercises all three authored attack families');
assert.ok(peakHazards<24,'three-minute Nara duel keeps live hazards tightly bounded (peak '+peakHazards+')');
assert.ok(peakEffects<=guardianLairs.config.EFFECT_CAP,'three-minute Nara duel never exceeds the shared effect cap');
assert.ok(peakSmoke>0 && peakSmoke<=smoke.config.MAX_CELLS,'coal-torch smoke stays active and inside the global smoke cap (peak '+peakSmoke+')');
assert.ok(perfMs<2500,'three simulated Nara minutes with real smoke stay within the CPU budget ('+perfMs.toFixed(1)+' ms)');

// Sile's orbiting art and remembered-position attacks also stay tightly
// bounded over a long fight. The natural no-input cycle repeatedly alternates
// a short sealed attack phase with a generous listening window.
guardianLairs.reset();
globalThis.player={x:ice2.ax,y:ice2.floorY-5,hp:1e9,maxHp:1e9,vx:0,vy:0,w:0.7,h:0.95};
const perfSile=guardianLairs.spawnGuardian('ice','choir',{x:ice2.ax,y:ice2.floorY-8.5,seed:515151});
assert.ok(perfSile,'long-fight budget spawns Sile directly');
let peakIceHazards=0,peakIceEffects=0;
const seenSilePatterns=new Set();
const perfIceStart=performance.now();
for(let step=0;step<10800;step++){
  guardianLairs.update(1/60,globalThis.player,()=>T.AIR,()=>{});
  const dbg=guardianLairs._debug();
  peakIceHazards=Math.max(peakIceHazards,dbg.hazards.length);
  peakIceEffects=Math.max(peakIceEffects,dbg.effects.length);
  for(const h of dbg.hazards){
    if(h.variant==='memoryEcho') seenSilePatterns.add('memory');
    if(h.variant==='heartglass') seenSilePatterns.add('heartglass');
    if(h.variant==='hush') seenSilePatterns.add('hush');
  }
}
const perfIceMs=performance.now()-perfIceStart;
assert.deepEqual([...seenSilePatterns].sort(),['heartglass','hush','memory'],'three-minute Sile duel exercises all authored echo families');
assert.ok(peakIceHazards<24,'three-minute Sile duel keeps live hazards tightly bounded (peak '+peakIceHazards+')');
assert.ok(peakIceEffects<=guardianLairs.config.EFFECT_CAP,'three-minute Sile duel never exceeds the shared effect cap');
assert.ok(perfIceMs<2500,'three simulated Sile minutes stay within the CPU budget ('+perfIceMs.toFixed(1)+' ms)');

// Regression: the sealed surface gate has no historical biome filter and could
// surface in an ocean/lake/city. Whenever solid ground exists near the start it must
// relocate onto it, so the mouth footprint never lands in a water/city biome.
{
  const badBiome = b => b===5 || b===6 || b===8;
  const clearWindow = x => { for(let dx=-12; dx<=12; dx+=2){ if(badBiome(WG.biomeType(x+dx))) return false; } return true; };
  let placedInWater = 0, oceanLocked = 0, sampled = 0;
  for(let s=0; s<40; s++){
    const seed = 4242 + s*911;
    WG.worldSeed = seed;
    WG.clearCaches && WG.clearCaches();
    guardianLairs.clearCache();
    guardianLairs.reset();
    world.clear();
    guardianLairs.enableUndergroundGate(world.getTile, world.setTile, {force:true});
    const U = guardianLairs.undergroundGateLayout();
    sampled++;
    let landNearby = false;
    for(let x=-220; x<=220 && !landNearby; x++) if(clearWindow(x)) landNearby = true;
    if(badBiome(WG.biomeType(Math.round(U.mouthX)))){ if(landNearby) placedInWater++; else oceanLocked++; }
  }
  assert.ok(sampled >= 40, 'underground gate biome sampling ran across many seeds');
  assert.equal(placedInWater, 0, 'sealed surface gate avoids ocean/lake/city biomes whenever solid ground exists near the start ('+oceanLocked+' seeds were fully ocean-locked)');
}

console.log('guardian-lairs-sim: all assertions passed; nara180s='+perfMs.toFixed(1)+'ms sile180s='+perfIceMs.toFixed(1)+'ms peakHazards='+Math.max(peakHazards,peakIceHazards)+' peakEffects='+Math.max(peakEffects,peakIceEffects)+' peakSmoke='+peakSmoke);
