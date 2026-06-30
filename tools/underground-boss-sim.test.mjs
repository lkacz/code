// Deterministic Node coverage for the underground progression boss.
// Run: node tools/underground-boss-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {getItem(){ return null; }, setItem(){}, removeItem(){}};
globalThis.msg = ()=>{};
globalThis.damageHero = (amount)=>{ if(globalThis.player) globalThis.player.hp-=amount; };
globalThis.CustomEvent = class CustomEvent{ constructor(type,init){ this.type=type; this.detail=init && init.detail; } };
globalThis.dispatchEvent = ()=>{};
let saveMarks = 0;
globalThis.__mmMarkWorldChanged = ()=>{ saveMarks++; };

const { T, CHUNK_W, WORLD_H } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { meteorites } = await import('../src/engine/meteorites.js');
const { guardianLairs } = await import('../src/engine/guardian_lairs.js');
const { undergroundBoss } = await import('../src/engine/underground_boss.js');
const { world } = await import('../src/engine/world.js');

assert.ok(guardianLairs && undergroundBoss && world && meteorites, 'underground boss dependencies export');

WG.worldSeed = 20260630;
WG.clearCaches && WG.clearCaches();
guardianLairs.clearCache();
guardianLairs.reset();
undergroundBoss.clearCache();
undergroundBoss.reset();
meteorites.reset();
world.clear();

const marks = {fire:1, ice:1};
globalThis.inv = {heartFire:1, heartIce:1, heartEarth:0};
globalThis.MM.progress = {
  markGuardianHeart(kind){ if(marks[kind]) return false; marks[kind]=1; return true; },
  guardianHearts(){ return Object.assign({}, marks); }
};

guardianLairs.enableUndergroundGate(world.getTile, world.setTile, {force:true});
const L = undergroundBoss.layoutFor();
assert.ok(Math.abs(L.gateX) <= 240, 'underground boss attaches to the center-world alien gate');
assert.ok(L.floorY < WORLD_H-4, 'underground boss arena stays above the bottom bedrock band');
assert.ok(Math.floor(L.minX/CHUNK_W)!==Math.floor(L.maxX/CHUNK_W), 'underground boss arena spans multiple chunks');
assert.ok(L.ops.some(o=>o.t===T.AIR), 'underground boss arena carves walkable air');
assert.ok(L.ops.some(o=>o.t===T.ANTIMATTER_CRYSTAL), 'underground boss arena uses antimatter crystals');
assert.ok(L.ops.some(o=>o.t===T.ALIEN_BIOMASS), 'underground boss arena uses alien biomass');
assert.ok(L.ops.some(o=>o.t===T.IRIDIUM), 'underground boss arena uses iridium anchor blocks');
assert.equal(undergroundBoss.status().unlocked, true, 'fire and ice progress unlocks the underground boss');
assert.ok(undergroundBoss.materializeArena(world.getTile, world.setTile) > 0, 'underground boss can materialize into already generated gate chunks');

const forcedByKey = new Map();
for(const o of L.ops) if(o.f===1) forcedByKey.set(o.x+','+o.y, o);
for(const o of [...forcedByKey.values()].slice(0,220)){
  assert.equal(world.getTile(o.x,o.y), o.t, 'forced underground arena op materializes at '+o.x+','+o.y);
}
world.clear();
for(const o of [...forcedByKey.values()].slice(0,120)){
  assert.equal(world.getTile(o.x,o.y), o.t, 'underground arena regenerates deterministically at '+o.x+','+o.y);
}

globalThis.player = {x:L.ax, y:L.floorY-3, w:0.7, h:0.95, hp:600, maxHp:600, vx:0, vy:0};
undergroundBoss.update(0.05, globalThis.player, world.getTile, world.setTile);
let status = undergroundBoss.status();
assert.equal(status.awakened, true, 'entering the underground arena awakens the boss');
assert.equal(status.entities.filter(e=>e.boss).length, 1, 'underground encounter has one boss core');
assert.equal(status.entities.filter(e=>e.role==='drone').length, 2, 'underground encounter has two drill drones');

for(let i=0;i<160;i++) undergroundBoss.update(1/30, globalThis.player, world.getTile, world.setTile);
assert.ok(undergroundBoss.metrics().hazards > 0, 'underground boss special timers create hazards');

const dbg = undergroundBoss._debug();
let core = dbg.entities.find(e=>e.boss);
assert.ok(core, 'debug exposes the active underground core');
let drones = dbg.entities.filter(e=>e.role==='drone');
assert.equal(drones.length, 2, 'debug exposes both underground drill drones');
assert.equal(dbg.forceBurrow(L.ax-9999,L.floorY-999), true, 'debug can force the excavator into a tunneling phase');
assert.ok(core.targetX >= L.minX+7 && core.targetX <= L.maxX-7, 'debug-forced burrow target clamps inside the arena X bounds');
assert.ok(core.targetY >= L.minY+7 && core.targetY <= L.floorY-4.2, 'debug-forced burrow target clamps inside the arena Y bounds');
const saveMarksBeforeBurrow = saveMarks;
for(let i=0;i<30;i++) undergroundBoss.update(1/30, globalThis.player, world.getTile, world.setTile);
assert.equal(core.mode, 'burrow', 'forced underground boss is actively burrowing before it resurfaces');
assert.ok(undergroundBoss.metrics().tunnelsCarved > 0, 'burrowing excavator carves real world blocks');
assert.ok(saveMarks-saveMarksBeforeBurrow <= 3, 'burrowing terrain edits are batched into a small number of save marks');
assert.equal(undergroundBoss.targetsForTurret(core.x, core.y, 80, true).some(t=>t.raw===core), false, 'turrets cannot target the core while it is underground');
const hiddenHp = core.hp;
assert.equal(undergroundBoss.damageAt(Math.floor(core.x), Math.floor(core.y), 120), false, 'buried core cannot be damaged directly');
assert.equal(core.hp, hiddenHp, 'buried core keeps its health while under rock');

assert.equal(dbg.forceEmerge(), true, 'debug can force an exposed damage window');
assert.equal(undergroundBoss.targetsForTurret(core.x, core.y, 80, true).some(t=>t.raw===core), true, 'turrets can target the core once it resurfaces');
const exposedHp = core.hp;
assert.equal(undergroundBoss.damageAt(Math.floor(core.x), Math.floor(core.y), 120), true, 'surfaced core accepts normal damage');
assert.ok(core.hp <= exposedHp-100, 'surfaced core takes full weapon damage');

for(const d of drones){
  d.hp = 8;
  assert.equal(undergroundBoss.damageAt(Math.floor(d.x), Math.floor(d.y), 20), true, 'drill drone can be destroyed through normal damage');
}
assert.equal(dbg.entities.filter(e=>e.role==='drone' && !e.dead).length, 0, 'destroyed drill drones leave the excavator without helpers');

const overlapHero = {x:core.x, y:core.y, w:0.7, h:0.95, hp:300, vx:0, vy:0};
assert.equal(undergroundBoss.collideHero(overlapHero,0.1), true, 'underground boss physically separates an overlapping hero');
assert.ok(Math.hypot(overlapHero.x-core.x, overlapHero.y-core.y)>0.1, 'collision pushes the hero out of the boss body');

const snap = undergroundBoss.snapshot();
assert.ok(snap.entities.length >= 1, 'snapshot preserves active underground entities');
undergroundBoss.reset();
assert.equal(undergroundBoss.status().awakened, false, 'reset clears the underground encounter');
undergroundBoss.restore(snap);
status = undergroundBoss.status();
assert.equal(status.awakened, true, 'restore revives an active underground encounter');
assert.ok(status.entities.some(e=>e.boss && e.hp<e.maxHp), 'restore preserves underground boss damage');
assert.ok(status.tunnelsCarved > 0, 'restore preserves excavated tunnel metrics');

const savedActiveState = undergroundBoss.snapshot();
undergroundBoss.restore({
  v:1,
  unlocked:true,
  awakened:true,
  entities:[
    {role:'core',id:'broken-core',x:999999,y:-9999,vx:99,vy:-99,hp:99999,mode:'phasebug',modeT:99,targetX:-999999,targetY:999999},
    {role:'drone',id:'earth-drone-1-broken',droneRole:'spoon',x:-999999,y:999999,hp:99999,shotCd:-9,carveCd:-9,sealCd:-9}
  ]
});
status = undergroundBoss.status();
const sanitizedCore = status.entities.find(e=>e.boss);
const sanitizedDrone = status.entities.find(e=>e.role==='drone');
assert.equal(sanitizedCore.mode, 'emerge', 'restore sanitizes invalid underground core modes');
assert.ok(sanitizedCore.x >= L.minX+8 && sanitizedCore.x <= L.maxX-8, 'restore clamps underground core X into the arena');
assert.ok(sanitizedCore.y >= L.minY+6 && sanitizedCore.y <= L.floorY-4.2, 'restore clamps underground core Y into the arena');
assert.equal(sanitizedCore.hp, undergroundBoss.config.BOSS_HP, 'restore clamps oversized underground core HP');
assert.equal(sanitizedDrone.droneRole, 'backfill', 'restore sanitizes invalid underground drone roles');
assert.equal(sanitizedDrone.hp, undergroundBoss.config.DRONE_HP, 'restore clamps oversized underground drone HP');
undergroundBoss.restore(savedActiveState);

globalThis.player.x = L.ax+140;
globalThis.player.y = L.floorY-3;
undergroundBoss.update(0.1, globalThis.player, world.getTile, world.setTile);
status = undergroundBoss.status();
assert.equal(status.entities.length, 0, 'underground boss sleeps when the hero leaves its neighbourhood');
assert.equal(undergroundBoss.metrics().hazards, 0, 'sleeping the underground boss clears local hazards');

globalThis.player.x = L.ax;
globalThis.player.y = L.floorY-3;
undergroundBoss.update(0.05, globalThis.player, world.getTile, world.setTile);
core = undergroundBoss._debug().entities.find(e=>e.boss);
drones = undergroundBoss._debug().entities.filter(e=>e.role==='drone');
globalThis.player.hp = 5000;
const saveMarksBeforeStress = saveMarks;
const stressStartMs = performance.now();
for(let i=0;i<1350;i++) undergroundBoss.update(1/30, globalThis.player, world.getTile, world.setTile);
const stressMs = performance.now()-stressStartMs;
const stressMetrics = undergroundBoss.metrics();
assert.ok(stressMs < 1500, '45 seconds of underground fight simulation stays within the perf budget ('+stressMs.toFixed(1)+' ms)');
assert.ok(stressMetrics.hazards <= undergroundBoss.config.HAZARD_CAP, 'long underground fight respects the hazard cap');
assert.ok(stressMetrics.effects <= undergroundBoss.config.EFFECT_CAP, 'long underground fight respects the effect cap');
assert.ok(saveMarks-saveMarksBeforeStress <= 12, 'long underground fight does not spam save marks');
core = undergroundBoss._debug().entities.find(e=>e.boss);
drones = undergroundBoss._debug().entities.filter(e=>e.role==='drone');
for(const d of drones) d.dead = true;
undergroundBoss._debug().forceEmerge();
core.hp = 12;
const cratersBefore = meteorites.metrics().craters;
const hpBeforeDeathBlast = globalThis.player.hp;
assert.equal(undergroundBoss.damageAt(Math.floor(core.x), Math.floor(core.y), 9999), true, 'direct damage can defeat the underground boss');
assert.equal(globalThis.inv.heartEarth, 1, 'underground boss awards heartEarth once');
assert.equal(marks.earth, 1, 'progress records the earth guardian defeat');
assert.ok(meteorites.metrics().craters > cratersBefore, 'underground boss death uses the normal meteorite crater pipeline');
const deathCrater = meteorites.snapshot().craters.at(-1);
assert.equal(deathCrater.site, 'underground_boss_defeat', 'underground boss crater is tagged as its defeat impact');
assert.ok(deathCrater.r >= 38, 'underground boss death crater is colossal');
assert.equal(globalThis.player.hp, hpBeforeDeathBlast, 'underground boss death blast does not damage the hero');

assert.equal(undergroundBoss.forceAwaken(), true, 'debug rematch can force-awaken the defeated underground boss');
const rematch = undergroundBoss.status().entities.find(e=>e.boss);
assert.ok(rematch, 'debug rematch spawned the underground boss core');
const rawRematch = undergroundBoss._debug().entities.find(e=>e.boss);
undergroundBoss._debug().entities.filter(e=>e.role==='drone').forEach(e=>{ e.dead=true; });
undergroundBoss._debug().forceEmerge();
rawRematch.hp = 9;
assert.equal(undergroundBoss.damageAt(Math.floor(rawRematch.x), Math.floor(rawRematch.y), 9999), true, 'debug rematch underground boss can be defeated');
assert.equal(globalThis.inv.heartEarth, 1, 'debug rematch does not duplicate heartEarth');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
const turretsSrc = await readFile(new URL('../src/engine/turrets.js', import.meta.url), 'utf8');
const progressSrc = await readFile(new URL('../src/engine/progress.js', import.meta.url), 'utf8');
const inventorySrc = await readFile(new URL('../src/inventory.js', import.meta.url), 'utf8');

assert.match(mainSrc, /import \{ undergroundBoss as UNDERGROUND \} from '\.\/engine\/underground_boss\.js';/, 'main imports the underground boss engine');
assert.match(mainSrc, /undergroundBoss:\s*timedSavePart\('undergroundBoss',[^\n]*UNDERGROUND && UNDERGROUND\.snapshot/, 'save payload includes underground boss state');
assert.match(mainSrc, /UNDERGROUND\.restore\(data\.undergroundBoss\)/, 'load path restores underground boss state');
assert.match(mainSrc, /UNDERGROUND && UNDERGROUND\.update/, 'main update loop advances underground boss');
assert.match(mainSrc, /UNDERGROUND && UNDERGROUND\.draw/, 'main draw loop renders underground boss');
assert.match(mainSrc, /UNDERGROUND && UNDERGROUND\.drawHUD/, 'main HUD loop renders underground boss pointer');
assert.match(mainSrc, /UNDERGROUND && UNDERGROUND\.collideHero/, 'player physics resolves against underground boss bodies');
assert.match(mainSrc, /UNDERGROUND && UNDERGROUND\.attackAt/, 'melee attacks can hit underground boss entities');
assert.match(mainSrc, /function debugJumpUndergroundBoss\(\)/, 'main exposes underground boss debug jump helper');
assert.match(mainSrc, /function debugStartUndergroundFight\(\)/, 'main exposes an underground boss debug fight-start helper');
assert.match(mainSrc, /window\.teleportHeroToUndergroundBoss/, 'console debug can teleport to the underground boss');
assert.match(mainSrc, /window\.startUndergroundBossFight/, 'console debug can start the underground boss fight');
assert.match(mainSrc, /undergroundFight:\(\)=> debugStartUndergroundFight\(\)/, 'travel debug panel can start the underground fight');
assert.match(uiSrc, /actions\.underground/, 'travel debug UI includes underground teleport action');
assert.match(uiSrc, /Underground gate/, 'travel debug UI labels the underground gate jump');
assert.match(uiSrc, /actions\.undergroundFight/, 'travel debug UI includes underground fight-start action');
assert.match(uiSrc, /Underground fight/, 'travel debug UI labels the underground fight-start button');
assert.match(worldSrc, /import \{ undergroundBoss as UNDERGROUND \}/, 'world imports underground boss terrain');
assert.match(worldSrc, /UNDERGROUND && UNDERGROUND\.applyToChunk/, 'world applies underground boss structures to chunks');
assert.match(weaponsSrc, /MM\.undergroundBoss && MM\.undergroundBoss\.damageAt/, 'player weapons can damage underground boss entities');
assert.match(turretsSrc, /MM\.undergroundBoss && MM\.undergroundBoss\.targetsForTurret/, 'turrets can target underground boss entities');
assert.match(turretsSrc, /target\.kind==='underground'/, 'turret refresh supports underground targets');
assert.match(await readFile(new URL('../src/engine/underground_boss.js', import.meta.url), 'utf8'), /mode==='burrow'/, 'underground boss has a true burrowing phase');
assert.match(await readFile(new URL('../src/engine/underground_boss.js', import.meta.url), 'utf8'), /carveTunnelAt/, 'underground boss carves real terrain tunnels');
assert.match(progressSrc, /'earth'/, 'progress guardian keys include earth');
assert.match(progressSrc, /heartEarth/, 'progress can restore earth heart milestones from inventory');
assert.match(inventorySrc, /key:'heartEarth'/, 'inventory resources include the Heart of Earth');

console.log('underground-boss-sim: all assertions passed');
