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

console.log('coop-projectile-sim: all assertions passed');
