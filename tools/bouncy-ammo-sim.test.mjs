// Rubber ammunition: the kauczuk tree, its resource, and the ricocheting pistol.
//
// The weapon's whole identity is GEOMETRY, so the things worth pinning are the
// ricochet mechanics, not the damage number: which axis a bounce flips, that the
// ball never comes to rest inside a solid, that a body rebound can carry the shot
// into a SECOND target for LESS damage, that the chain terminates, and that the
// spent rubber sometimes returns to the pouch. The co-op half pins the usual
// contract: a guest may only NAME a rubber ball — every number stays the host's.
// Run: node tools/bouncy-ammo-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type, opts){ this.type = type; this.detail = opts && opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now: () => simNow };
// Deterministic RNG: the ricochet scatter and the pickup roll both draw from it.
let rngSeed = 0x5eed1234;
Math.random = () => { rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0; return rngSeed / 4294967296; };

const { T, INFO, isWood } = await import('../src/constants.js');
const INV = (await import('../src/inventory.js')).inventory;
const { weapons } = await import('../src/engine/weapons.js');
const dbg = weapons._debug;
const TUNE = dbg.bouncyTuning;

// ---------------------------------------------------------------------------
// 1) THE TREE AND ITS RESOURCE
// ---------------------------------------------------------------------------
assert.equal(isWood(T.RUBBER_WOOD), true, 'a rubber trunk is wood-family (fells, burns, holds a tree up, crushes)');
assert.deepEqual(INFO[T.RUBBER_WOOD].drops, [{ item: 'rubber', min: 2, max: 3 }],
	'rubber wood yields raw rubber, not timber');
assert.equal(INFO[T.RUBBER_WOOD].drop, undefined, 'rubber wood uses the drops[] contract only (a `drop` too would double-award)');
assert.equal(INFO[T.RUBBER_WOOD].passable, false, 'a rubber trunk is solid like every other trunk');
assert.equal(INFO[T.RUBBER_WOOD].flammable, true, 'latex-soaked wood burns');

const rubberRes = INV.RESOURCES.find(r => r.key === 'rubber');
const ballRes = INV.RESOURCES.find(r => r.key === 'rubberBall');
assert.ok(rubberRes && rubberRes.tile === 'RUBBER_WOOD', 'kauczuk is a real resource that places its own trunk tile');
assert.ok(ballRes && ballRes.tile === null, 'rubber balls are ammunition, never a placeable block');
assert.equal(TUNE.ammoKey, 'rubberBall', 'the pistol spends the rubber-ball resource');

// slot 4 owns the pistol: it is a trigger device, not a drawn or thrown shot
const slot4 = INV.WEAPON_CATEGORIES.find(c => c.key === '4');
assert.ok(slot4 && slot4.types.includes('bouncy'), 'the bouncy pistol rotates in the slot-4 device category');
assert.ok(!INV.WEAPON_CATEGORIES.find(c => c.key === '3').types.includes('bouncy'), 'it is NOT in the ranged/bow slot');

// The species mints its own trunk tile through the same buildTree seam the other
// special woods use (worldgen determinism: a stubbed randSeed never swaps species).
{
	const { CHUNK_W, WORLD_H } = await import('../src/constants.js');
	const { worldGen } = await import('../src/engine/worldgen.js');
	const { trees } = await import('../src/engine/trees.js');
	worldGen.randSeed = () => 0;      // the stub every tree suite uses: no optional roll fires
	worldGen.surfaceHeight = () => 30;
	const arr = new Uint16Array(CHUNK_W * WORLD_H);
	trees.buildTree(arr, 5, 30, 'rubber', 5, false);
	let trunk = 0, plain = 0, leaf = 0;
	for(let i = 0; i < arr.length; i++){
		if(arr[i] === T.RUBBER_WOOD) trunk++;
		else if(arr[i] === T.WOOD) plain++;
		else if(arr[i] === T.LEAF) leaf++;
	}
	assert.ok(trunk >= 5, 'a rubber tree raises a tall bare bole of RUBBER_WOOD (' + trunk + ' cells)');
	assert.equal(plain, 0, 'no cell of a rubber tree is ordinary wood');
	assert.ok(leaf > 0, 'the rubber tree carries a canopy');
	// the bole is CONTINUOUS from the ground up — a gap would leave a floating crown
	let broke = false, seen = false;
	for(let y = 29; y >= 0; y--){
		const t = arr[y * CHUNK_W + 5];
		if(t === T.RUBBER_WOOD) seen = true;
		else if(seen){ broke = (t !== T.LEAF && t !== 0); break; }
	}
	assert.equal(broke, false, 'the raised bole has no gap under its crown');
	// the bole is taller than an ordinary oak's — that IS the species' silhouette
	const oak = new Uint16Array(CHUNK_W * WORLD_H);
	trees.buildTree(oak, 5, 30, 'oak', 5, false);
	let oakTrunk = 0;
	for(let i = 0; i < oak.length; i++) if(oak[i] === T.WOOD) oakTrunk++;
	assert.ok(trunk > oakTrunk, 'a rubber tree stands visibly taller than the oak it replaces (' + trunk + ' vs ' + oakTrunk + ')');
	trees.reset();
}

// ---------------------------------------------------------------------------
// 2) WORLD HARNESS for the projectile simulation
// ---------------------------------------------------------------------------
let tiles = new Map();
const key = (x, y) => x + ',' + y;
const getTile = (x, y) => { const v = tiles.get(key(x, y)); return v === undefined ? T.AIR : v; };
let setAirCalls = 0;
const setTile = (x, y, v) => { if(v === T.AIR) setAirCalls++; tiles.set(key(x, y), v); };
const audio = [];
MM.audio = { play: (id) => audio.push(id) };
MM.discovery = { note: () => true };
let spawnedDrops = [];
MM.drops = { spawnResource: (x, y, k, n) => { spawnedDrops.push({ k, n }); return true; } };

function openWorld(){
	tiles = new Map();
	for(let y = -6; y <= 8; y++) for(let x = -6; x <= 40; x++) tiles.set(key(x, y), T.AIR);
}
function reset(){
	weapons.reset();
	openWorld();
	setAirCalls = 0; audio.length = 0; spawnedDrops = [];
	MM.mobs = { damageAt: () => false, nearestLiving: () => null, igniteAt: () => false, chillAt: () => false };
	MM.centerGuardian = null; MM.mechs = null; MM.bosses = null; MM.invasions = null;
	MM.npcSystem = null; MM.ufo = null; MM.guardianLairs = null; MM.undergroundBoss = null; MM.skyGuardian = null;
	MM.coopBodies = [];
	globalThis.player = { x: 200, y: 200, w: 0.7, h: 0.95, hp: 100 };
	globalThis.inv = {};
}
function step(n, dt){ for(let i = 0; i < n; i++){ simNow += 16; weapons.update(dt || 0.016, getTile, setTile); } }
const live = () => dbg.arrows.filter(a => a && a.bouncy);

// ---------------------------------------------------------------------------
// 3) WALL RICOCHET: the reconstructed normal flips only the axis that crossed
// ---------------------------------------------------------------------------
reset();
tiles.set(key(6, 0), T.STONE);
const flat = dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: 4, gravityMult: 0 });
step(12);
assert.ok(flat.vx < 0, 'a ball into a VERTICAL wall reverses its horizontal travel');
assert.ok(Math.abs(flat.vy) < 1e-6, 'the untouched vertical axis is left alone (no phantom deflection)');
assert.equal(flat.bounces, 3, 'the wall spent exactly one bounce from the budget');
assert.ok(!(getTile(Math.floor(flat.x), Math.floor(flat.y)) === T.STONE), 'the ball never comes to rest inside the wall it hit');
assert.ok(Math.abs(flat.vx) < 16 && Math.abs(flat.vx) > 16 * TUNE.wallRestitution * 0.9,
	'the rebound keeps roughly the wall restitution of its speed (' + flat.vx.toFixed(2) + ')');

reset();
tiles.set(key(4, 2), T.STONE);
const dropped = dbg.pushArrow({ x: 4.5, y: 0.5, vx: 0, vy: 14, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: 4, gravityMult: 0 });
step(12);
assert.ok(dropped.vy < 0, 'a ball onto a FLOOR reverses its vertical travel — it bounces up, not back');
assert.ok(Math.abs(dropped.vx) < 1e-6, 'a floor bounce introduces no sideways drift');

// A wall barely dulls the ball: the trick shot has to stay worth taking.
reset();
tiles.set(key(6, 0), T.STONE);
const keepDmg = dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: 4, gravityMult: 0 });
step(12);
assert.ok(Math.abs(keepDmg.dmg - 4 * TUNE.wallDamageKeep) < 1e-6, 'a wall bounce costs only the wall damage-keep factor');
assert.ok(TUNE.wallDamageKeep > TUNE.hitDamageKeep, 'a BODY absorbs far more than a wall — that is the falloff the player feels');

// ---------------------------------------------------------------------------
// 4) THE CHAIN TERMINATES, and the spent rubber can be picked up
// ---------------------------------------------------------------------------
reset();
// a one-tile-wide shaft: the ball has nowhere to go but back and forth
for(let y = -2; y <= 2; y++){ tiles.set(key(2, y), T.STONE); tiles.set(key(8, y), T.STONE); }
dbg.pushArrow({ x: 5.5, y: 0.5, vx: 18, vy: 0, dmg: 4, life: 20, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: TUNE.maxBounces, gravityMult: 0 });
step(400);
assert.equal(live().length, 0, 'a ball trapped between two walls always runs out of bounces — it never pinballs forever');
assert.equal(setAirCalls, 0, 'a rubber ball edits no terrain at all, however many times it bounces');

// The pickup roll: over many retirements the recover chance is honoured, and the
// resource that comes back is the ammunition itself.
reset();
let recovered = 0;
for(let i = 0; i < 400; i++){
	spawnedDrops = [];
	if(dbg.retireBouncyBall({ x: 1, y: 1, vx: 0, vy: 0 })) recovered++;
	if(spawnedDrops.length) assert.equal(spawnedDrops[0].k, TUNE.ammoKey, 'a recovered ball returns as rubber-ball ammunition');
}
assert.ok(recovered > 400 * TUNE.recoverChance * 0.7 && recovered < 400 * TUNE.recoverChance * 1.3,
	'roughly the recover chance of spent balls can be picked back up (' + recovered + '/400)');

// ---------------------------------------------------------------------------
// 5) THE POINT OF THE WEAPON: one ball, several victims, each hit weaker
// ---------------------------------------------------------------------------
reset();
const hits = [];
MM.mobs = {
	// two creatures standing apart; the ball rebounds off the first and the
	// rebound is what carries it into the second
	damageAt: (tx, ty, dmg) => {
		if(ty !== 0) return false;
		if(tx === 8 || tx === 4){ hits.push({ tx, dmg }); return true; }
		return false;
	},
	nearestLiving: () => null, igniteAt: () => false, chillAt: () => false
};
const chain = dbg.pushArrow({ x: 6.5, y: 0.5, vx: 14, vy: 0, dmg: 5, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: TUNE.maxBounces, gravityMult: 0 });
step(40);
assert.ok(hits.length >= 2, 'one ball wounds more than one creature by rebounding off them (' + hits.length + ' hits)');
assert.ok(hits.some(h => h.tx === 8) && hits.some(h => h.tx === 4),
	'the rebound reaches a creature on the OTHER side — the ball came back');
assert.ok(hits[1].dmg < hits[0].dmg, 'the second victim takes STRICTLY less than the first (' + hits.map(h => h.dmg).join(' → ') + ')');
for(let i = 1; i < hits.length; i++) assert.ok(hits[i].dmg <= hits[i - 1].dmg, 'the chain never gets stronger again');
assert.ok(chain.bounces < TUNE.maxBounces, 'every body hit spends bounce budget, so the chain is finite');

// Range must NOT be what dulls a ricochet — a bounced ball is supposed to be far away.
{
	const near = { bouncy: true, dmg: 4, travel: 0, maxTravel: 30 };
	const far = { bouncy: true, dmg: 4, travel: 29, maxTravel: 30 };
	assert.equal(dbg.arrowDamageAtRange(near), dbg.arrowDamageAtRange(far),
		'distance does not dull a rubber ball — bounces do (or the falloff curve would collapse to 1 at once)');
	const arrowFar = { tier: 'wood', dmg: 4, travel: 29, maxTravel: 30 };
	assert.ok(dbg.arrowDamageAtRange(arrowFar) < 4, 'CONTROL: an ordinary arrow still loses damage with distance');
}

// ---------------------------------------------------------------------------
// 6) WORLD-INERTNESS: a soft ball breaks nothing and carries no fire
// ---------------------------------------------------------------------------
reset();
tiles.set(key(6, 0), T.GLASS);
const onGlass = dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: 4, gravityMult: 0 });
step(12);
assert.equal(getTile(6, 0), T.GLASS, 'a rubber ball bounces off a pane instead of shattering it');
assert.ok(onGlass.vx < 0, 'the pane is a wall to the ball, so it ricochets');

reset();
tiles.set(key(6, 0), T.LAVA);
const overLava = dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: 4, gravityMult: 0 });
step(8);
assert.equal(!!overLava.fire, false, 'a ball never catches fire — six burning wall bounces would torch a forest for one shot');

// ---------------------------------------------------------------------------
// 6b) THE INCENDIARY VARIANT: tar balls take light from the world and carry it
// ---------------------------------------------------------------------------
const TAR = dbg.bouncyKinds.tar;
assert.equal(TAR.flammable, true, 'the tar kind is the flammable one');
assert.equal(dbg.bouncyKinds.plain.flammable, undefined, 'plain rubber is NOT flammable — that separation is the whole balance');
assert.ok(INV.RESOURCES.find(r => r.key === TAR.key), 'tar balls are a real resource');
// a pistol names its ammo exactly like a throw technique names its thrownKind
assert.equal(dbg.bouncySpec({ bouncyKind: 'tar' }).key, TAR.key, 'a tar pistol chambers tar balls');
assert.equal(dbg.bouncySpec({}).key, TUNE.ammoKey, 'a pistol with no kind falls back to plain rubber');

// It does NOT start alight — something in the world has to light it.
reset();
const unlit = dbg.spawnBouncyBall({ x: 0.5, y: 0.5 }, 1, 0, { attackDamage: 3 }, { spec: TAR });
assert.equal(!!unlit.fire, false, 'a tar ball leaves the barrel COLD — it burns only after contact with fire');
assert.equal(unlit.flammable, true, 'but it is marked as able to take light');

// Flying over lava lights it — and lighting it cuts the bounce budget down, which
// is what bounds the arson a six-bounce firebrand would otherwise cause.
reset();
tiles.set(key(6, 0), T.LAVA);
const lit = dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, flammable: true, bounces: TUNE.maxBounces, gravityMult: 0 });
step(10);
assert.equal(!!lit.fire, true, 'a tar ball flying through lava CATCHES FIRE');
assert.ok(lit.bounces <= dbg.bouncyBurnBounces, 'igniting clamps the bounce budget (' + lit.bounces + ') — burning rubber is already melting');
// CONTROL: the plain ball over the same lava stays cold (proved in section 6 too)
reset();
tiles.set(key(6, 0), T.LAVA);
const cold = dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, bounces: TUNE.maxBounces, gravityMult: 0 });
step(10);
assert.equal(!!cold.fire, false, 'CONTROL: plain rubber over the same lava never lights');

// A LIT ball sets flammable terrain alight where it bounces. NOTE: weapons.js
// holds the fire MODULE by import, so a spy has to patch MM.fire's properties —
// replacing the whole MM.fire object silently misses (the import still points at
// the original), and every assertion here would pass for the wrong reason.
const realIgnite = MM.fire.ignite;
let ignited = [];
MM.fire.ignite = (x, y) => { ignited.push([x, y]); return true; };

reset();
ignited = [];
tiles.set(key(6, 0), T.WOOD);
const arson = dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, flammable: true, fire: true, bounces: 3, gravityMult: 0 });
step(12);
assert.ok(ignited.some(p => p[0] === 6 && p[1] === 0), 'a burning tar ball sets the surface it ricochets off alight');
assert.ok(arson.vx < 0, 'and it still bounces — spreading fire does not consume the shot');
// CONTROL: an unlit tar ball lights nothing
reset();
ignited = [];
tiles.set(key(6, 0), T.WOOD);
dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, flammable: true, bounces: 3, gravityMult: 0 });
step(12);
assert.equal(ignited.length, 0, 'CONTROL: an UNLIT tar ball starts no fires — it must be lit first');
// CONTROL: a co-op ball cannot burn the host's world even if it carries `fire`
reset();
ignited = [];
tiles.set(key(6, 0), T.WOOD);
dbg.pushArrow({ x: 3.5, y: 0.5, vx: 16, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, flammable: true, fire: true, coopOwner: true, bounces: 3, gravityMult: 0 });
step(12);
assert.equal(ignited.length, 0, 'EXPLOIT NEUTRALIZED: a co-op tar ball ignites no host terrain');
MM.fire.ignite = realIgnite;

// A creature already burning is a light source: carry that fire into the pack.
reset();
let burningMob = null;
MM.mobs = {
	damageAt: (tx, ty, dmg, opts) => { if(ty !== 0 || tx !== 8) return false; if(opts && opts.onTarget) opts.onTarget(burningMob, 'mob'); return true; },
	hasStatus: (m, s) => m === burningMob && s === 'burn',
	nearestLiving: () => null, igniteAt: () => true, chillAt: () => false
};
burningMob = { id: 'torch', x: 8.5, y: 0.5, hp: 20 };
const relay = dbg.pushArrow({ x: 6.5, y: 0.5, vx: 14, vy: 0, dmg: 4, life: 3, stuck: false, stuckT: 3,
	tier: 'bouncy', bouncy: true, flammable: true, bounces: TUNE.maxBounces, gravityMult: 0 });
step(20);
assert.equal(!!relay.fire, true, 'hitting a creature that is ALREADY BURNING lights the tar ball');

// Burned rubber never comes back.
reset();
spawnedDrops = [];
let burnedRecovered = 0;
for(let i = 0; i < 200; i++) if(dbg.retireBouncyBall({ x: 1, y: 1, vx: 0, vy: 0, fire: true })) burnedRecovered++;
assert.equal(burnedRecovered, 0, 'a ball that burned is gone — the rubber went up with it');
assert.equal(spawnedDrops.filter(d => d.k === TUNE.ammoKey).length, 0, 'and it mints no plain-rubber pickup either');

// ---------------------------------------------------------------------------
// 7) CO-OP: a guest NAMES a rubber ball; every number is the host resolver's
// ---------------------------------------------------------------------------
reset();
const forged = weapons.spawnHeroProjectile({ x: 0.5, y: 0.5 }, { vx: 14, vy: 0, dmg: 4, bouncy: true, bounces: 9999 });
assert.equal(forged, true, 'a hero guest may fire a rubber ball');
const guestBall = dbg.arrows[dbg.arrows.length - 1];
assert.equal(guestBall.bouncy, true, 'the host flies a real bouncing ball for the guest');
assert.equal(guestBall.bounces, TUNE.maxBounces, 'the bounce budget is the HOST constant, never the forged number off the wire');
assert.equal(guestBall.coopOwner, true, 'the guest ball stays coop-attributed');
spawnedDrops = [];
assert.equal(dbg.retireBouncyBall({ x: 1, y: 1, vx: 0, vy: 0, coopOwner: true }), false,
	'a co-op ball never mints host rubber, however its chain ends');
assert.equal(spawnedDrops.length, 0, 'no resource is created by a guest projectile');

// A non-bouncy hero shot must not silently inherit the ball behaviour.
reset();
weapons.spawnHeroProjectile({ x: 0.5, y: 0.5 }, { vx: 14, vy: 0, dmg: 4 });
assert.equal(!!dbg.arrows[dbg.arrows.length - 1].bouncy, false, 'an ordinary guest shot is still an ordinary shaft');

// ---------------------------------------------------------------------------
// 8) SOURCE PINS: the wiring the runtime cannot prove on its own
// ---------------------------------------------------------------------------
{
	const { readFileSync } = await import('fs');
	const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
	const mainSrc = src('src/main.js');
	const wsrc = src('src/engine/weapons.js');
	const treeSrc = src('src/engine/trees.js');
	const clientSrc = src('src/engine/ghost_client.js');
	const hostSrc = src('src/engine/ghost_host.js');

	assert.match(mainSrc, /\{id:'rubber_balls', name:'Kulki kauczukowe x12', cost:\{rubber:2\}/, 'the ball recipe is pinned');
	assert.match(mainSrc, /\{id:'bouncer_pistol', name:'Pistolet kauczukowy', cost:\{rubber:8, steel:2, wood:2\}/, 'the pistol recipe is pinned');
	assert.match(mainSrc, /\{id:'rubber_balls_tar', name:'Kulki smolowe x12', cost:\{rubber:2, coal:2\}/, 'the tar-ball recipe is pinned');
	assert.match(mainSrc, /\{id:'bouncer_pistol_tar', name:'Pistolet smolowy', cost:\{rubber:8, steel:2, coal:4\}/, 'the incendiary pistol recipe is pinned');
	assert.match(mainSrc, /bouncyKind:'tar'/, 'the incendiary pistol names its ammo kind');
	// The plain/tar split is the balance: only ONE of them may take light.
	assert.match(wsrc, /if\(!a\.bouncy\) a\.fire=true;\s*\n\s*else if\(a\.flammable\) igniteBouncyBall\(a\);/,
		'only a FLAMMABLE ball may catch fire — plain rubber stays exempt');
	assert.match(wsrc, /if\(!a \|\| !a\.flammable \|\| a\.fire \|\| a\.coopOwner\) return false;/,
		'ignition refuses a non-flammable ball, a double light, and every co-op projectile');
	assert.match(wsrc, /if\(!a \|\| !a\.fire \|\| a\.coopOwner \|\| !FIRE\) return false;/,
		'fire spread is gated on the ball actually burning AND on not being a guest shot');
	assert.match(mainSrc, /weaponType:'bouncy'/, 'the pistol is crafted as a bouncy-type weapon');
	assert.match(mainSrc, /'HARD_WOOD','RUBBER_WOOD'/, 'the rubber trunk is assignable from the hotbar slot picker');
	assert.match(wsrc, /if\(type==='bouncy'\) return fireBouncy\(player, aimX, aimY, w\);/, 'LMB routes the bouncy type to its own shot');
	assert.match(wsrc, /if\(type==='bouncy'\) return firePowerBouncy\(player, aimX, aimY, w, charge\);/, 'RMB routes the bouncy ult');
	assert.match(treeSrc, /variant==='oak' && biome===0 && WG\.randSeed\(wx\*9\.113\+419\) > 0\.86/,
		'rubber swaps a forest oak on its OWN salt with a HIGH roll (a stubbed randSeed never swaps)');
	assert.match(treeSrc, /variant==='rubber' \? T\.RUBBER_WOOD/, 'the rubber species mints its own trunk tile');
	// co-op: the client may only NAME the ball, and the host reads it as a boolean
	assert.match(clientSrc, /bo: a\.bouncy \? 1 : 0/, 'the shoot intent carries only a bouncy FLAG');
	assert.match(hostSrc, /bouncy: !!pl\.bo/, 'the host coerces the named flag to a boolean, taking no numbers from it');
	assert.match(wsrc, /bouncy:!!spec\.bouncy, bounces:spec\.bouncy\?BOUNCY_MAX_BOUNCES:0/, 'the resolver stamps the host bounce budget');
}

console.log('bouncy-ammo-sim: all assertions passed (wall+floor normals, chained victims, terminating chain, coop-inert)');
