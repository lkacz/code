// Deterministic Node coverage for the post-mole Sky Gate guardian.
// Run: node tools/sky-guardian-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {getItem(){ return null; }, setItem(){}, removeItem(){}};
globalThis.msg = ()=>{};
globalThis.CustomEvent = class CustomEvent{ constructor(type,init){ this.type=type; this.detail=init && init.detail; } };
globalThis.dispatchEvent = ()=>{};
let saveMarks = 0;
globalThis.__mmMarkWorldChanged = ()=>{ saveMarks++; };
globalThis.damageHero = (amount)=>{ if(globalThis.player) globalThis.player.hp-=amount; return true; };

const { T, CHUNK_W, WORLD_MIN_Y, WORLD_SECTION_H } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { skyGuardian } = await import('../src/engine/sky_guardian.js');
const { world } = await import('../src/engine/world.js');

assert.ok(skyGuardian && world, 'sky guardian dependencies export');

WG.worldSeed = 20260703;
WG.clearCaches && WG.clearCaches();
skyGuardian.clearCache();
skyGuardian.reset();
world.clear();

const marks = {earth:0, air:0};
globalThis.inv = {heartEarth:0, heartAir:0};
globalThis.MM.progress = {
  markGuardianHeart(kind){
    if(marks[kind]) return false;
    marks[kind]=1;
    return true;
  },
  guardianHearts(){ return Object.assign({}, marks); }
};

assert.equal(skyGuardian.status().unlocked, false, 'Sky Gate stays locked before the mole guardian is defeated');
marks.earth = 1;
globalThis.inv.heartEarth = 1;

const L = skyGuardian.layoutFor();
assert.equal(skyGuardian.status().unlocked, true, 'earth progress unlocks the Sky Gate');
assert.equal(L.kind, 'air', 'Sky Gate advertises the air guardian kind');
assert.equal(L.schema, 'sky_gate_cognitive_arena_v1', 'Sky Gate has a named procedural arena schema');
assert.deepEqual(L.zones, ['sky_gate','adaptive_wind_lanes','ambition_crown'], 'Sky Gate arena has intentional combat zones');
assert.ok(L.floorY < -70, 'Sky Gate sits in the upper world');
assert.ok(L.minY >= WORLD_MIN_Y, 'Sky Gate stays inside extended world bounds');
assert.ok(Math.floor(L.minX/CHUNK_W)!==Math.floor(L.maxX/CHUNK_W), 'Sky Gate arena spans multiple chunks');
assert.equal(L.resonators.length, 3, 'Sky Gate has three resonator anchors');
assert.ok(L.ops.some(o=>o.t===T.ANTIGRAVITY_BEACON), 'Sky Gate uses antigravity beacon technology');
assert.ok(L.ops.some(o=>o.t===T.SOLAR_BATTERY), 'Sky Gate uses sky power storage');
assert.ok(L.ops.some(o=>o.t===T.ANTIMATTER_CRYSTAL), 'Sky Gate uses antimatter resonator cores');
assert.ok(L.ops.some(o=>o.t===T.IRIDIUM), 'Sky Gate uses iridium edges');
assert.ok(L.ops.some(o=>o.t===T.GLASS), 'Sky Gate uses glass platforms');
assert.ok(L.ops.some(o=>o.t===T.METEOR_DUST), 'Sky Gate uses meteor dust circuit traces');

const sectionY = Math.floor(L.floorY / WORLD_SECTION_H);
const sectionX = Math.floor(L.ax / CHUNK_W);
const section = new Uint8Array(CHUNK_W * WORLD_SECTION_H);
section.fill(T.AIR);
assert.ok(skyGuardian.applyToSection(section,sectionX,sectionY) > 0, 'Sky Gate can be generated into a vertical world section');
assert.ok(skyGuardian.materializeArena(world.getTile, world.setTile) > 0, 'Sky Gate can be materialized into already generated chunks');

const forcedByKey = new Map();
for(const o of L.ops) if(o.f===1 && o.t!==T.AIR) forcedByKey.set(o.x+','+o.y, o);
for(const o of [...forcedByKey.values()].slice(0,180)){
  assert.equal(world.getTile(o.x,o.y), o.t, 'forced Sky Gate op materializes at '+o.x+','+o.y);
}

globalThis.player = {
  x:L.ax,
  y:L.gateY,
  w:0.7,
  h:0.95,
  hp:1200,
  maxHp:1200,
  vx:0,
  vy:0,
  onGround:true
};
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
let status = skyGuardian.status();
assert.equal(status.awakened, true, 'entering the Sky Gate awakens the air guardian');
assert.equal(status.entities.filter(e=>e.boss).length, 1, 'Sky Gate encounter has one guardian crown');
assert.equal(status.entities.filter(e=>e.resonator).length, 3, 'Sky Gate encounter opens with three shield resonators');
assert.equal(status.entities.filter(e=>e.leafling).length, 1, 'Sky Gate encounter starts with one celestial leafling sidekick');
assert.ok(skyGuardian.config.BOSS_HP >= 1800, 'air guardian has late-game durability');
assert.equal(skyGuardian.config.LEAFLING_MAX, 10, 'celestial leaflings have the requested multiplication cap');

let dbg = skyGuardian._debug();
let boss = dbg.entities.find(e=>e.boss);
assert.ok(boss, 'debug exposes the active air guardian');
let leaflings = dbg.activeLeaflings();
assert.equal(leaflings.length, 1, 'debug exposes the initial celestial leafling');
assert.ok(leaflings[0].maxHp < 60, 'celestial leafling is intentionally fragile instead of a heavy damage sponge');
assert.equal(skyGuardian.damageAt(Math.floor(leaflings[0].x), Math.floor(leaflings[0].y), 999, {kind:'arrow',source:'hero'}), true, 'destroying a celestial leafling is possible');
leaflings = dbg.activeLeaflings();
assert.equal(leaflings.length, 2, 'destroyed celestial leafling splits into two replacements');
for(const l of leaflings.slice()) assert.equal(skyGuardian.damageAt(Math.floor(l.x), Math.floor(l.y), 999, {kind:'melee',source:'hero'}), true, 'split leaflings can also be destroyed');
assert.equal(dbg.activeLeaflings().length, 4, 'destroying both split leaflings doubles the pressure again');
assert.ok(dbg.spawnLeaflings(20).length <= skyGuardian.config.LEAFLING_MAX, 'debug spawn respects the celestial leafling cap');
assert.ok(dbg.activeLeaflings().length <= skyGuardian.config.LEAFLING_MAX, 'live celestial leaflings never exceed the cap');
assert.equal(skyGuardian.damageAt(Math.floor(boss.x), Math.floor(boss.y), 60, {kind:'arrow',source:'hero'}), 'shield', 'resonators reroute direct damage into the shield');
assert.ok(boss.hp >= skyGuardian.config.BOSS_HP, 'shielded crown does not lose HP while resonators live');

assert.equal(dbg.clearResonators(), true, 'debug can clear resonators for direct combat coverage');
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
boss = dbg.entities.find(e=>e.boss && !e.dead);
assert.ok(boss && !boss.shielded, 'crown becomes exposed once resonators are gone');
for(let i=0;i<3;i++){
  assert.equal(skyGuardian.damageAt(Math.floor(boss.x), Math.floor(boss.y), 14, {kind:'arrow',source:'hero'}), true, 'exposed crown accepts repeated arrow hits');
}
boss.tacticCd = 0;
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
assert.equal(boss.adaptKind, 'arrow', 'air guardian remembers repeated arrow damage');
assert.equal(boss.tactic, 'crosswind', 'air guardian responds to repeated arrows with crosswind tactics');

boss.adaptKind = '';
boss.adaptCount = 0;
boss.samples = {still:1, air:0, far:0, above:0};
boss.tacticCd = 0;
boss.wellCd = 0;
dbg.hazards.length = 0;
globalThis.player.vx = 0;
globalThis.player.vy = 0;
globalThis.player.onGround = true;
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
assert.equal(boss.tactic, 'gravity_question', 'air guardian punishes a stationary hero with gravity tactics');
assert.ok(dbg.hazards.some(h=>h.type==='well'), 'gravity tactic creates a pull well hazard');

boss.samples = {still:0, air:1, far:0, above:1};
boss.tacticCd = 0;
boss.gustCd = 0;
boss.wellCd = 99;
dbg.hazards.length = 0;
globalThis.player.y = boss.y-10;
globalThis.player.vy = -2;
globalThis.player.onGround = false;
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
assert.equal(boss.tactic, 'downburst', 'air guardian reacts to airborne play with downburst tactics');
assert.ok(dbg.hazards.some(h=>h.type==='gust' && h.vertical), 'downburst tactic creates a vertical gust hazard');

dbg.clearResonators();
boss.hp = boss.maxHp * 0.60;
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
assert.equal(dbg.activeResonators().length, 3, 'air guardian rebuilds the shield at the second phase');
assert.equal(boss.shieldStage, 2, 'second shield phase is recorded on the boss');
let turretTargets = skyGuardian.targetsForTurret(L.ax,L.gateY,120,false);
assert.ok(turretTargets.some(t=>t.raw && t.raw.resonator), 'turrets can target air resonators');
assert.equal(turretTargets.some(t=>t.raw===boss), false, 'turrets cannot shoot the shielded crown through live resonators');
dbg.clearResonators();
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
turretTargets = skyGuardian.targetsForTurret(L.ax,L.gateY,120,true);
assert.ok(turretTargets.some(t=>t.raw===boss), 'turrets can target the crown when it is exposed');

const snap = skyGuardian.snapshot();
assert.ok(snap.entities.length >= 1, 'snapshot preserves active Sky Gate entities');
skyGuardian.reset();
assert.equal(skyGuardian.status().awakened, false, 'reset clears the Sky Gate encounter');
skyGuardian.restore(snap);
status = skyGuardian.status();
assert.equal(status.awakened, true, 'restore revives an active Sky Gate encounter');
assert.ok(status.entities.some(e=>e.boss), 'restore preserves the air guardian crown');
assert.ok(status.entities.some(e=>e.leafling), 'restore preserves celestial leafling sidekicks');
skyGuardian.restore({
  v:1,
  unlocked:true,
  awakened:true,
  seq:999,
  entities:[
    {role:'crown', boss:true, x:L.bossX, y:L.bossY, hp:skyGuardian.config.BOSS_HP},
    ...Array.from({length:18},(_,i)=>({role:'celestial_leafling', leafling:true, x:L.bossX+i*0.1, y:L.bossY, hp:skyGuardian.config.LEAFLING_HP}))
  ]
});
assert.equal(skyGuardian.status().leaflings, skyGuardian.config.LEAFLING_MAX, 'restore clamps overpopulated celestial leafling saves to the live cap');
skyGuardian.restore(snap);

const saveMarksBeforeStress = saveMarks;
const stressStartMs = performance.now();
for(let i=0;i<900;i++) skyGuardian.update(1/30, globalThis.player, world.getTile, world.setTile);
const stressMs = performance.now()-stressStartMs;
const stressMetrics = skyGuardian.metrics();
assert.ok(stressMs < 1200, '30 seconds of Sky Gate simulation stays within the perf budget ('+stressMs.toFixed(1)+' ms)');
assert.ok(stressMetrics.hazards <= skyGuardian.config.HAZARD_CAP, 'long Sky Gate fight respects the hazard cap');
assert.ok(stressMetrics.effects <= skyGuardian.config.EFFECT_CAP, 'long Sky Gate fight respects the effect cap');
assert.ok(saveMarks-saveMarksBeforeStress <= 6, 'long Sky Gate fight does not spam save marks');

dbg = skyGuardian._debug();
boss = dbg.entities.find(e=>e.boss && !e.dead);
dbg.clearResonators();
skyGuardian.update(0.05, globalThis.player, world.getTile, world.setTile);
boss.hp = 10;
const hpBeforeDeath = globalThis.player.hp;
assert.equal(skyGuardian.damageAt(Math.floor(boss.x), Math.floor(boss.y), 9999, {kind:'melee',source:'hero'}), true, 'direct damage can defeat the air guardian');
assert.equal(globalThis.inv.heartAir, 1, 'air guardian awards heartAir once');
assert.equal(marks.air, 1, 'progress records the air guardian defeat');
assert.equal(skyGuardian.status().defeated, true, 'Sky Gate records the defeated state');
assert.equal(globalThis.player.hp, hpBeforeDeath, 'air guardian reward event does not damage the hero');

assert.equal(skyGuardian.forceAwaken(world.getTile, world.setTile), true, 'debug rematch can force-awaken the defeated air guardian');
const rematchBoss = skyGuardian._debug().entities.find(e=>e.boss && !e.dead);
assert.ok(rematchBoss, 'debug rematch spawned the air guardian crown');
skyGuardian._debug().clearResonators();
rematchBoss.hp = 9;
assert.equal(skyGuardian.damageAt(Math.floor(rematchBoss.x), Math.floor(rematchBoss.y), 9999, {kind:'melee',source:'hero'}), true, 'debug rematch air guardian can be defeated');
assert.equal(globalThis.inv.heartAir, 1, 'debug rematch does not duplicate heartAir');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
const turretsSrc = await readFile(new URL('../src/engine/turrets.js', import.meta.url), 'utf8');
const progressSrc = await readFile(new URL('../src/engine/progress.js', import.meta.url), 'utf8');
const inventorySrc = await readFile(new URL('../src/inventory.js', import.meta.url), 'utf8');
const loreSrc = await readFile(new URL('../src/engine/story_lore.js', import.meta.url), 'utf8');
const skySrc = await readFile(new URL('../src/engine/sky_guardian.js', import.meta.url), 'utf8');

assert.match(mainSrc, /import \{ skyGuardian as SKY_GUARDIAN \} from '\.\/engine\/sky_guardian\.js';/, 'main imports the Sky Gate guardian engine');
assert.match(mainSrc, /skyGuardian:\s*timedSavePart\('skyGuardian',[^\n]*SKY_GUARDIAN && SKY_GUARDIAN\.snapshot/, 'save payload includes Sky Gate guardian state');
assert.match(mainSrc, /SKY_GUARDIAN\.restore\(data\.skyGuardian\)/, 'load path restores Sky Gate guardian state');
assert.match(mainSrc, /SKY_GUARDIAN && SKY_GUARDIAN\.update/, 'main update loop advances the Sky Gate guardian');
assert.match(mainSrc, /SKY_GUARDIAN && SKY_GUARDIAN\.draw/, 'main draw loop renders the Sky Gate guardian');
assert.match(mainSrc, /SKY_GUARDIAN && SKY_GUARDIAN\.drawHUD/, 'main HUD loop renders the Sky Gate pointer');
assert.match(mainSrc, /SKY_GUARDIAN && SKY_GUARDIAN\.collideHero/, 'player physics resolves against Sky Gate guardian bodies');
assert.match(mainSrc, /SKY_GUARDIAN && SKY_GUARDIAN\.attackAt/, 'melee attacks can hit Sky Gate guardian entities');
assert.match(mainSrc, /function debugJumpSkyGuardian\(\)/, 'main exposes Sky Gate debug jump helper');
assert.match(mainSrc, /function debugStartSkyGuardianFight\(\)/, 'main exposes Sky Gate debug fight-start helper');
assert.match(mainSrc, /window\.teleportHeroToSkyGuardian/, 'console debug can teleport to the Sky Gate');
assert.match(mainSrc, /window\.startSkyGuardianFight/, 'console debug can start the Sky Gate fight');
assert.match(mainSrc, /skyGate:\(\)=> debugJumpSkyGuardian\(\)/, 'travel debug panel can jump to Sky Gate');
assert.match(mainSrc, /skyFight:\(\)=> debugStartSkyGuardianFight\(\)/, 'travel debug panel can start the Sky Gate fight');
assert.match(uiSrc, /actions\.skyGate/, 'travel debug UI includes Sky Gate teleport action');
assert.match(uiSrc, /Sky Gate/, 'travel debug UI labels the Sky Gate jump');
assert.match(uiSrc, /actions\.skyFight/, 'travel debug UI includes Sky Gate fight-start action');
assert.match(uiSrc, /Sky fight/, 'travel debug UI labels the Sky Gate fight-start button');
assert.match(worldSrc, /import \{ skyGuardian as SKY_GUARDIAN \}/, 'world imports Sky Gate terrain');
assert.match(worldSrc, /SKY_GUARDIAN && SKY_GUARDIAN\.applyToSection/, 'world applies Sky Gate structures to vertical sections');
assert.match(weaponsSrc, /MM\.skyGuardian && MM\.skyGuardian\.damageAt/, 'player weapons can damage Sky Gate guardian entities');
assert.match(weaponsSrc, /MM\.skyGuardian && MM\.skyGuardian\.attackAt/, 'player melee bridge can hit Sky Gate guardian entities');
assert.match(turretsSrc, /MM\.skyGuardian && MM\.skyGuardian\.targetsForTurret/, 'turrets can target Sky Gate guardian entities');
assert.match(turretsSrc, /target\.kind==='skyGuardian'/, 'turret refresh supports Sky Gate targets');
assert.match(skySrc, /LEAFLING_MAX:\s*10/, 'Sky Guardian caps celestial leafling multiplication at ten');
assert.match(skySrc, /role:'celestial_leafling'/, 'Sky Guardian has a dedicated celestial leafling sidekick entity');
assert.match(skySrc, /spawnLeaflings\(2,layoutFor\(\),e\.x,e\.y/, 'destroyed celestial leaflings split into two replacements');
assert.match(progressSrc, /GUARDIAN_KEYS=\[[^\]]*'air'[^\]]*\]/, 'progress guardian heart history includes air');
assert.match(progressSrc, /heartAir/, 'progress can restore air heart milestones from inventory');
assert.match(inventorySrc, /key:'heartAir'/, 'inventory resources include the Heart of Air');
assert.match(loreSrc, /sky_guardian/, 'story lore includes a Sky Guardian reveal beat');
assert.match(loreSrc, /heartAir/, 'story lore can advance from the Heart of Air');

console.log('sky-guardian-sim: all assertions passed');
