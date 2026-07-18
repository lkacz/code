// P0-2 (forged hero projectiles): a co-op / hero-guest projectile is INERT to the
// world. A guest may only NAME a shot; the host flies the real arrow, and that arrow
// must never edit terrain, ignite the world, spawn or detonate gas, or hurt the host.
// The forged-shot exploit: a hero guest sends { fire:true, splat:'gascloud' } to drop
// free poison gas and then detonate it — removing terrain, spreading fire and wounding
// the host hero. These tests reproduce that shot and prove it does nothing, at BOTH
// layers: the spawn resolver strips the world-hazard flags, and the arrow simulation
// gates every world-touching branch on !a.coopOwner (defense in depth).
// Run: node tools/coop-projectile-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type, opts){ this.type = type; this.detail = opts && opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now: () => simNow };
Math.random = (() => { let s = 0x1234abcd; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();

const { T } = await import('../src/constants.js');
const { weapons } = await import('../src/engine/weapons.js');
assert.ok(weapons && weapons.spawnHeroProjectile, 'weapons + hero projectile resolver present');
const dbg = weapons._debug;

// A soft-tile world around the blast so terrain removal (setTile → AIR) is observable.
let tiles = new Map();
const key = (x, y) => x + ',' + y;
function resetWorld(){
	tiles = new Map();
	// solid DIRT everywhere (so an explosion's terrain removal is observable) EXCEPT
	// an AIR corridor along row y=0 for the arrow to actually fly down
	for(let y = -4; y <= 4; y++) for(let x = -4; x <= 12; x++) tiles.set(key(x, y), y === 0 ? T.AIR : T.DIRT);
}
const getTile = (x, y) => { const v = tiles.get(key(x, y)); return v === undefined ? T.AIR : v; };
let setAirCalls = 0;
const setTile = (x, y, v) => { if(v === T.AIR) setAirCalls++; tiles.set(key(x, y), v); };

// Spies for the two host-harming effects.
let damageHeroCalls = 0;
globalThis.window.damageHero = () => { damageHeroCalls++; return true; };
const audio = [];
MM.audio = { play: (id) => audio.push(id) };
MM.mobs = { blastRadius: () => 0, damageAt: () => false, nearestLiving: () => null, igniteAt: () => false, poisonRadius: () => 0, wetRadius: () => 0, douseRadius: () => 0 };
MM.discovery = { note: () => true };

function reset(){
	weapons.reset();
	setAirCalls = 0; damageHeroCalls = 0; audio.length = 0;
	resetWorld();
}
function countGasPuffs(){ return dbg.puffs.filter(p => p && p.kind === 'gas').length; }
function stepArrows(n){ for(let i = 0; i < n; i++){ simNow += 16; weapons.update(0.016, getTile, setTile); } }

// ---------------------------------------------------------------------------
// 1) Spawn resolver strips the world-hazard flags from a forged guest shot.
// ---------------------------------------------------------------------------
reset();
const body = { x: 0.5, y: 0.5 };
const forged = { vx: 12, vy: 0, dmg: 6, fire: true, splat: 'gascloud' };
assert.equal(weapons.spawnHeroProjectile(body, forged), true, 'the guest shot is accepted (it may still wound creatures)');
const shaft = dbg.arrows[dbg.arrows.length - 1];
assert.ok(shaft && shaft.coopOwner === true, 'the spawned shaft is coop-attributed');
assert.equal(!!shaft.fire, false, 'the forged fire flag is dropped at the source (no world ignition)');
assert.notEqual(shaft.splat, 'gascloud', 'the forged gascloud burst is dropped at the source');
// only the safe soak burst survives the whitelist
reset();
assert.equal(weapons.spawnHeroProjectile({ x: 0.5, y: 0.5 }, { vx: 12, vy: 0, dmg: 6, splat: 'wet' }), true, 'a wet balloon shot is accepted');
assert.equal(dbg.arrows[dbg.arrows.length - 1].splat, 'wet', 'the wet soak burst is the only world-safe burst that passes');

// ---------------------------------------------------------------------------
// 2) POSITIVE CONTROL: a HERO (non-coop) fire arrow flying into a gas cloud DOES
//    detonate — terrain is removed, the blast plays, the host is hurt. This proves
//    the following coop assertions actually discriminate a real explosion.
// ---------------------------------------------------------------------------
reset();
globalThis.player = { x: 5.5, y: 0.5, w: 0.7, h: 0.95, hp: 100 };
weapons.spawnGasCloud(5.5, 0.5, 2, { source: 'hero' }); // stage the gas the guest wanted for free
const gasBefore = countGasPuffs();
assert.ok(gasBefore > 0, 'the staged gas cloud exists');
dbg.pushArrow({ x: 4.0, y: 0.5, vx: 18, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood', fire: true });
stepArrows(12);
assert.ok(audio.includes('explosion') || setAirCalls > 0 || damageHeroCalls > 0,
	'CONTROL: a hero fire arrow detonates the gas — terrain/host/FX react');

// ---------------------------------------------------------------------------
// 3) THE EXPLOIT, NEUTRALIZED: the identical shot from a guest (coopOwner) detonates
//    NOTHING — no terrain removed, no blast, and the host hero is untouched.
// ---------------------------------------------------------------------------
reset();
globalThis.player = { x: 5.5, y: 0.5, w: 0.7, h: 0.95, hp: 100 };
weapons.spawnGasCloud(5.5, 0.5, 2, { source: 'hero' });
const coopGasBefore = countGasPuffs();
// inject a coop fire arrow straight through the gas (defense in depth: even if `fire`
// leaks onto a coop shaft, the sim must not detonate)
dbg.pushArrow({ x: 4.0, y: 0.5, vx: 18, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood', fire: true, coopOwner: true });
stepArrows(12);
assert.equal(setAirCalls, 0, 'EXPLOIT NEUTRALIZED: a coop fire arrow removes no terrain');
assert.equal(damageHeroCalls, 0, 'EXPLOIT NEUTRALIZED: a coop fire arrow never hurts the host hero');
assert.ok(!audio.includes('explosion'), 'EXPLOIT NEUTRALIZED: no gas detonation from a coop arrow');
assert.ok(countGasPuffs() >= 1, 'the gas cloud is not consumed by a coop arrow (it was never detonated)');

// ---------------------------------------------------------------------------
// 4) A coop arrow never CATCHES fire in flight either (lava/flame), so it can't
//    become a terrain-igniter the long way around. A hero arrow does catch.
// ---------------------------------------------------------------------------
reset();
tiles.set(key(6, 0), T.LAVA);
globalThis.player = { x: 20, y: 20, w: 0.7, h: 0.95, hp: 100 }; // out of harm's way
const heroOverLava = dbg.pushArrow({ x: 5.2, y: 0.4, vx: 16, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood' });
stepArrows(6);
assert.equal(!!heroOverLava.fire, true, 'CONTROL: a hero arrow catches fire over lava');
reset();
tiles.set(key(6, 0), T.LAVA);
globalThis.player = { x: 20, y: 20, w: 0.7, h: 0.95, hp: 100 };
const coopOverLava = dbg.pushArrow({ x: 5.2, y: 0.4, vx: 16, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood', coopOwner: true });
stepArrows(6);
assert.equal(!!coopOverLava.fire, false, 'EXPLOIT NEUTRALIZED: a coop arrow never catches fire over lava (no terrain ignition on impact)');

// Defense in depth: even a forged co-op shaft with an iridium tier and pierce
// budget cannot enter the block-removal branch.
reset();
tiles.set(key(6, 0), T.DIRT);
dbg.pushArrow({ x: 5.2, y: 0.4, vx: 16, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'iridium', pierceLeft: 1 });
stepArrows(6);
assert.ok(setAirCalls > 0, 'CONTROL: an ordinary iridium arrow still pierces a terrain block');
reset();
tiles.set(key(6, 0), T.DIRT);
dbg.pushArrow({ x: 5.2, y: 0.4, vx: 16, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'iridium', pierceLeft: 1, coopOwner: true });
stepArrows(6);
assert.equal(setAirCalls, 0, 'EXPLOIT NEUTRALIZED: a forged co-op iridium shaft cannot remove terrain');

// ---------------------------------------------------------------------------
// 5) RECOVERY ECONOMY: ordinary host arrows still become pickups, while a
//    co-op shaft cannot turn its wood tier (or a forged cached key) into ammo.
// ---------------------------------------------------------------------------
reset();
const spawnedResources = [];
MM.drops = { spawnResource: (x, y, resourceKey, count) => { spawnedResources.push({ resourceKey, count }); return true; } };
const hostRecover = { x: 1, y: 1, vx: 10, vy: 0, life: 2, tier: 'wood' };
assert.equal(dbg.arrowResourceKey(hostRecover), 'arrowWood', 'CONTROL: an ordinary wood arrow maps to its host resource');
assert.equal(dbg.dropSurvivingArrow(hostRecover), true, 'CONTROL: an ordinary surviving arrow becomes recoverable');
assert.equal(hostRecover.recoverable, true, 'CONTROL: the ordinary arrow is marked recoverable');
assert.equal(dbg.spawnDroppedArrowPickup(hostRecover), true, 'CONTROL: the ordinary arrow can spawn its pickup');
assert.deepEqual(spawnedResources, [{ resourceKey: 'arrowWood', count: 1 }], 'CONTROL: recovery returns exactly one wood arrow');

const coopRecover = { x: 1, y: 1, vx: 10, vy: 0, life: 2, tier: 'wood', coopOwner: true, recoverable: false, recoverKey: 'arrowWood' };
assert.equal(dbg.arrowResourceKey(coopRecover), null, 'EXPLOIT NEUTRALIZED: a co-op shaft has no host resource identity');
assert.equal(dbg.dropSurvivingArrow(coopRecover), false, 'EXPLOIT NEUTRALIZED: a co-op shaft cannot become recoverable after a hit');
assert.equal(dbg.spawnDroppedArrowPickup(coopRecover), false, 'EXPLOIT NEUTRALIZED: even a forged cached key cannot spawn a host pickup');
assert.equal(spawnedResources.length, 1, 'EXPLOIT NEUTRALIZED: no extra arrow resource was minted');
globalThis.inv = {};
globalThis.player = { x: 1, y: 1, w: 0.7, h: 0.95, hp: 100 };
const forgedStuckCoop = dbg.pushArrow({ x: 1, y: 1, vx: 0, vy: 0, life: 2, tier: 'wood', stuck: true, stuckT: 3,
	coopOwner: true, recoverable: true, recoverKey: 'arrowWood' });
stepArrows(1);
assert.equal(globalThis.inv.arrowWood, undefined, 'EXPLOIT NEUTRALIZED: forged recoverable state cannot mint ammo through proximity pickup');
assert.ok(dbg.arrows.includes(forgedStuckCoop), 'EXPLOIT NEUTRALIZED: the rejected co-op pickup remains a projectile, not a resource');

// ---------------------------------------------------------------------------
// 6) CREATURE FANOUT: hero arrows retain center-mimic and villager routing;
//    co-op arrows skip both because those handlers can reflect into the host or
//    mutate protected NPC state.
// ---------------------------------------------------------------------------
reset();
let centerGuardianCalls = 0;
let npcDamageCalls = 0;
MM.centerGuardian = { damageAt: () => { centerGuardianCalls++; return true; } };
MM.npcSystem = { damageAt: () => { npcDamageCalls++; return true; } };
dbg.pushArrow({ x: 0.5, y: 0.5, vx: 8, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood' });
stepArrows(1);
assert.ok(centerGuardianCalls > 0, 'CONTROL: an ordinary hero arrow still reaches centerGuardian');

reset();
centerGuardianCalls = 0; npcDamageCalls = 0;
MM.centerGuardian = { damageAt: () => { centerGuardianCalls++; return false; } };
MM.npcSystem = { damageAt: () => { npcDamageCalls++; return true; } };
dbg.pushArrow({ x: 0.5, y: 0.5, vx: 8, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood' });
stepArrows(1);
assert.ok(npcDamageCalls > 0, 'CONTROL: an ordinary hero arrow still reaches npcSystem');

reset();
centerGuardianCalls = 0; npcDamageCalls = 0;
MM.centerGuardian = { damageAt: () => { centerGuardianCalls++; return true; } };
MM.npcSystem = { damageAt: () => { npcDamageCalls++; return true; } };
dbg.pushArrow({ x: 0.5, y: 0.5, vx: 8, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood', coopOwner: true, recoverable: false });
stepArrows(1);
assert.equal(centerGuardianCalls, 0, 'EXPLOIT NEUTRALIZED: a co-op arrow never enters the centerGuardian reflection path');
assert.equal(npcDamageCalls, 0, 'EXPLOIT NEUTRALIZED: a co-op arrow never damages npcSystem villagers');

reset();
let mechDamageCalls = 0;
MM.centerGuardian = { damageAt: () => false };
MM.mechs = { damageAt: () => { mechDamageCalls++; return true; } };
dbg.pushArrow({ x: 0.5, y: 0.5, vx: 8, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood' });
stepArrows(1);
assert.ok(mechDamageCalls > 0, 'CONTROL: an ordinary hero arrow can still damage a mech');

reset();
mechDamageCalls = 0;
MM.centerGuardian = { damageAt: () => false };
MM.mechs = {
	damageAt: () => { mechDamageCalls++; return true; },
	attackAt: () => { mechDamageCalls++; return true; }
};
dbg.pushArrow({ x: 0.5, y: 0.5, vx: 8, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood', coopOwner: true, recoverable: false });
stepArrows(1);
weapons.coopMeleeAt({ x: 0.5, y: 0.5 }, 1.5, 0.5, { bonus: 4 });
assert.equal(mechDamageCalls, 0, 'EXPLOIT NEUTRALIZED: co-op arrows and melee cannot destroy mechs, collapse blocks, or award host XP');

// Every special combat family carries its own defeat/story/economy callbacks.
// A forged co-op shaft and co-op melee must stop at ordinary MM.mobs.
reset();
let ordinaryMobCalls = 0;
const specialCalls = { guardians:0, underground:0, sky:0, bosses:0, invasions:0, ufo:0 };
MM.mobs = { damageAt: () => { ordinaryMobCalls++; return false; }, attackAt: () => { ordinaryMobCalls++; return true; }, nearestLiving: () => null };
MM.guardianLairs = { damageAt: () => { specialCalls.guardians++; return true; }, attackAt: () => { specialCalls.guardians++; return true; } };
MM.undergroundBoss = { damageAt: () => { specialCalls.underground++; return true; }, attackAt: () => { specialCalls.underground++; return true; } };
MM.skyGuardian = { damageAt: () => { specialCalls.sky++; return true; }, attackAt: () => { specialCalls.sky++; return true; } };
MM.bosses = { damageAt: () => { specialCalls.bosses++; return true; } };
MM.invasions = { damageAt: () => { specialCalls.invasions++; return true; }, attackAt: () => { specialCalls.invasions++; return true; } };
MM.ufo = { damageAt: () => { specialCalls.ufo++; return true; }, attackAt: () => { specialCalls.ufo++; return true; } };
dbg.pushArrow({ x: 0.5, y: 0.5, vx: 8, vy: 0, dmg: 6, life: 3, stuck: false, stuckT: 3, tier: 'wood', coopOwner: true, recoverable: false });
stepArrows(1);
weapons.coopMeleeAt({ x: 0.5, y: 0.5 }, 1.5, 0.5, { bonus: 4 });
assert.ok(ordinaryMobCalls >= 2, 'co-op arrows and melee still reach ordinary mobs');
assert.deepEqual(specialCalls, { guardians:0, underground:0, sky:0, bosses:0, invasions:0, ufo:0 },
	'EXPLOIT NEUTRALIZED: co-op combat never enters special defeat systems');

// ---------------------------------------------------------------------------
// 7) ADMISSION + DUEL LIVENESS: a saturated projectile store must reject the
//    shot honestly (so ghost_host can refund ammo), and target-only stale duel
//    consent cannot arm an in-flight arrow.
// ---------------------------------------------------------------------------
reset();
for(let i=0;i<128;i++) dbg.arrows.push({
	x:i,y:0,vx:0,vy:0,life:3,tier:'wood',embeddedMob:{id:i},recoverable:false
});
const audioBeforeCap=audio.length;
assert.equal(weapons.spawnCoopArrow({x:0.5,y:0.5},4,0.5,{ownerGid:'gcap-owner'}),false,
	'a co-op arrow reports entity-cap rejection so its host-side ammo can be refunded');
assert.equal(weapons.spawnHeroProjectile({x:0.5,y:0.5},{vx:12,vy:0,ownerGid:'gcap-hero'}),false,
	'a hero-guest projectile also reports entity-cap rejection');
assert.equal(dbg.arrows.length,128,'capacity rejection preserves all embedded body arrows');
assert.equal(audio.length,audioBeforeCap,'a rejected shot emits no bow audio');

reset();
MM.mobs={damageAt:()=>false,nearestLiving:()=>null};
let duelHurt=0;
const duelTarget={gid:'gduel-target',x:2.5,y:0.5,w:0.7,h:0.95,dead:false,duelWith:'gduel-owner',hurt:()=>{ duelHurt++; }};
MM.coopBodies=[
	{gid:'gduel-owner',x:0.5,y:0.5,w:0.7,h:0.95,dead:false,duelWith:null},
	duelTarget
];
dbg.pushArrow({x:2.5,y:0.5,vx:0,vy:0,dmg:6,life:3,stuck:false,stuckT:3,tier:'wood',coopOwner:true,ownerGid:'gduel-owner',duelGid:'gduel-target'});
stepArrows(1);
assert.equal(duelHurt,0,'target-only stale duel consent cannot wound after the owner forfeits');

reset();
MM.mobs={damageAt:()=>false,nearestLiving:()=>null};
duelHurt=0;
duelTarget.duelWith='gduel-owner';
MM.coopBodies=[
	{gid:'gduel-owner',x:0.5,y:0.5,w:0.7,h:0.95,dead:false,duelWith:'gduel-target'},
	duelTarget
];
dbg.pushArrow({x:2.5,y:0.5,vx:0,vy:0,dmg:6,life:3,stuck:false,stuckT:3,tier:'wood',coopOwner:true,ownerGid:'gduel-owner',duelGid:'gduel-target'});
stepArrows(1);
assert.equal(duelHurt,1,'mutual live duel consent still permits an arrow hit');
MM.coopBodies=[];

// ---------------------------------------------------------------------------
// 8) WET BURSTS: both owners still soak/douse creatures. Only the hero's own
//    balloon may extinguish tile fire or water host-world crops.
// ---------------------------------------------------------------------------
let wetCreatureCalls = 0;
let douseCreatureCalls = 0;
let wetBossCalls = 0;
let extinguishCalls = 0;
let waterCropCalls = 0;
let lastWetSource = '';
MM.mobs = {
	wetRadius: (x, y, radius, opts) => { wetCreatureCalls++; lastWetSource = opts && opts.source; return 1; },
	douseRadius: () => { douseCreatureCalls++; return 1; },
	damageAt: () => false,
	nearestLiving: () => null
};
MM.bossStatus = { applyRadius: () => { wetBossCalls++; return 1; } };
MM.plants = { waterAt: () => { waterCropCalls++; return true; } };
MM.fire.isBurning = () => true;
MM.fire.extinguish = () => { extinguishCalls++; return true; };

dbg.splatProjectile({ x: 2.5, y: 0.5, splat: 'wet' }, getTile, setTile);
assert.ok(wetCreatureCalls > 0 && douseCreatureCalls > 0 && wetBossCalls > 0, 'CONTROL: a hero wet burst still affects creatures');
assert.ok(extinguishCalls > 0, 'CONTROL: a hero wet burst still extinguishes tile fire');
assert.ok(waterCropCalls > 0, 'CONTROL: a hero wet burst still waters crops');
assert.equal(lastWetSource, 'hero', 'CONTROL: hero wet status keeps hero attribution');

wetCreatureCalls = 0; douseCreatureCalls = 0; wetBossCalls = 0;
extinguishCalls = 0; waterCropCalls = 0; lastWetSource = '';
dbg.splatProjectile({ x: 2.5, y: 0.5, splat: 'wet', coopOwner: true }, getTile, setTile);
assert.ok(wetCreatureCalls > 0 && douseCreatureCalls > 0, 'co-op wet bursts retain ordinary-creature wet and douse effects');
assert.equal(wetBossCalls, 0, 'co-op wet bursts cannot mutate special boss status systems');
assert.equal(lastWetSource, 'coop', 'co-op wet status is attributed to the co-op attacker');
assert.equal(extinguishCalls, 0, 'EXPLOIT NEUTRALIZED: a co-op wet burst cannot extinguish host-world tile fire');
assert.equal(waterCropCalls, 0, 'EXPLOIT NEUTRALIZED: a co-op wet burst cannot water host-world crops');

// Defense in depth for impossible cached flags: non-wet splats do nothing, and
// leaked fire/stagger statuses retain co-op attribution instead of becoming a
// host-hero kill path.
let hostileStatusCalls = 0;
let hostileBossStatusCalls = 0;
MM.mobs = {
	damageAt: () => true,
	nearestLiving: () => ({ id:'target' }),
	statusRadius: () => { hostileStatusCalls++; return 1; },
	poisonRadius: () => { hostileStatusCalls++; return 1; },
	chillRadius: () => { hostileStatusCalls++; return 1; },
	wetRadius: () => { hostileStatusCalls++; return 1; },
	igniteAt: (x,y,opts) => { hostileStatusCalls++; assert.equal(opts.source,'coop','forged fire remains co-op attributed'); return true; },
	chillAt: (x,y,opts) => { hostileStatusCalls++; assert.equal(opts.source,'coop','forged stagger remains co-op attributed'); return true; }
};
MM.bossStatus = { applyRadius: () => { hostileBossStatusCalls++; return 1; } };
for(const splat of ['toxic','snow','sand','spit','gascloud','bomb']) dbg.splatProjectile({ x:2.5, y:0.5, splat, coopOwner:true, toxicSpit:true },getTile,setTile);
assert.equal(hostileStatusCalls,0,'forged non-wet co-op splats cannot apply creature statuses');
assert.equal(hostileBossStatusCalls,0,'forged co-op splats cannot touch boss status');
reset();
dbg.pushArrow({ x:0.5, y:0.5, vx:8, vy:0, dmg:6, life:3, stuck:false, stuckT:3, tier:'wood', coopOwner:true, fire:true, stagger:2 });
stepArrows(1);
assert.equal(hostileStatusCalls,2,'forged fire/stagger flags are bounded to two ordinary-mob status calls');
assert.equal(hostileBossStatusCalls,0,'forged status flags still cannot touch bosses');

console.log('coop-projectile-sim: all assertions passed');
