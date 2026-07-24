// Deterministic wooden-raft (boats) simulation test.
// Contract: wood placed into open water floats (never sinks), rafts ride the
// water surface with a fixed draft, extend plank-by-plank, catch the weather
// wind, row via energy-burning oar strokes, stop against terrain, beach on dry
// floors, break back into wood, and survive snapshot/restore round trips.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = globalThis.dispatchEvent || (()=>true);

const { T } = await import('../src/constants.js');
const { boats } = await import('../src/engine/boats.js');
const { mobs } = await import('../src/engine/mobs.js');
const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

assert.match(mainSrc, /function tryStartBoatMine\(tx,ty,opts\)\{[\s\S]*if\(!canPhysicallyTargetTile\(tx,ty\)\)/, 'raft plank mining obeys the same obstruction checks as tile mining');
assert.match(mainSrc, /if\(!canPhysicallyTargetTile\(mineTx,mineTy\)\)\{ stopMining\(\); resumeHeldMining\(\); return; \}/, 'drifting raft plank mining keeps rechecking line of sight');
assert.match(mainSrc, /const heroBoatNow=BOATS \? \(BOATS\.heroOnBoat \? BOATS\.heroOnBoat\(player\) : \(BOATS\.heroBoat \? BOATS\.heroBoat\(\) : null\)\) : null;/, 'boat movement state prefers a live deck query over cached heroBoat state');
assert.match(mainSrc, /const ridingFloatingBoat = !!\(heroBoatNow && heroBoatNow\.inWater && !heroBoatNow\.grounded\);[\s\S]*const swimming = inWater && !player\.onGround && !ridingFloatingBoat && !godMode && !warmBath;/, 'standing on a floating raft (or soaking in a geothermal spring) suppresses swim-chill damage');
assert.match(mainSrc, /const boatDeckInWater = inWater && player\.onGround && !!heroBoatNow;[\s\S]*const boatContactInWater = inWater && !boatDeckInWater && BOATS && BOATS\.heroTouchingBoat && !!BOATS\.heroTouchingBoat\(player,\{floating:true\}\);[\s\S]*const waterJumpSupport = groundedSolidInWater \|\| sideSolidInWater \|\| boatDeckInWater \|\| boatContactInWater;/, 'standing on or touching a boat allows boarding/jump input while the water sampler reports immersion');
assert.match(mainSrc, /BOATS\.boardHeroFromWater\(player,\{getTile\}\)\.ok/, 'jumping from water against a floating hull routes through the boat boarding helper');
assert.match(mainSrc, /BOATS\.row\(dir,\{heroEnergy:MM\.heroEnergy, godMode, player\}\)/, 'rowing validates against the current hero position, not only cached boat state');
assert.match(mainSrc, /const boatPrevX=player\.x;\s+const boatPrevY=player\.y;[\s\S]*BOATS\.collideHero\(player, dt\)[\s\S]*collide\('x',boatPrevX\);[\s\S]*collide\('y',boatPrevY\);/, 'boat-carried hero drift is swept through terrain on both axes after raft coupling');
assert.match(mainSrc, /const moved=player\.x-prev;[\s\S]*const dir=moved>COLLIDE_OVER_EPS\?1:moved<-COLLIDE_OVER_EPS\?-1:\(player\.vx>0\?1:player\.vx<0\?-1:0\);/, 'horizontal collision resolves externally carried movement using actual displacement direction');

// --- Synthetic world: a walled water pool with a stone floor ---
const tiles=new Map();
const K=(x,y)=>x+','+y;
const setT=(x,y,t)=>tiles.set(K(x,y),t);
const getTile=(x,y)=>tiles.has(K(x,y)) ? tiles.get(K(x,y)) : T.AIR;
for(let x=0;x<40;x++){
  for(let y=10;y<=14;y++) setT(x,y,T.WATER);
  setT(x,15,T.STONE);
}
for(let y=5;y<=15;y++){ setT(-1,y,T.STONE); setT(40,y,T.STONE); }
// dry shelf for the beaching check
for(let x=48;x<=54;x++) setT(x,15,T.STONE);

const water={ UNITS:10, levelAt:()=>10, disturb(){} };
const calm={ speedAt:()=>0 };
const breeze={ speedAt:()=>3 };
const step=(n,wind)=>{ for(let i=0;i<n;i++) boats.update(1/60,null,getTile,{wind:wind||calm,water}); };
function boatRectsOverlap(a,b){
  const ab=boats._debug.bounds(a), bb=boats._debug.bounds(b);
  const ar={left:a.x+ab.minDx,right:a.x+ab.maxDx+1,top:a.y+ab.minDy,bottom:a.y+ab.maxDy+1};
  const br={left:b.x+bb.minDx,right:b.x+bb.maxDx+1,top:b.y+bb.minDy,bottom:b.y+bb.maxDy+1};
  return Math.min(ar.right,br.right)>Math.max(ar.left,br.left)
    && Math.min(ar.bottom,br.bottom)>Math.max(ar.top,br.top);
}

boats.reset();

// --- Placement rules -------------------------------------------------------
assert.equal(boats.placementMode(5,10,getTile), 'boat', 'wood into surface water builds a raft');
assert.equal(boats.placementMode(5,9,getTile), 'boat', 'unsupported wood in air right above water floats');
assert.equal(boats.placementMode(5,9,getTile,{hasSupport:true}), null, 'supported wood above water stays an ordinary tile');
assert.equal(boats.placementMode(5,15,getTile), null, 'the stone floor cannot become a raft');
assert.equal(boats.placementMode(20,3,getTile), null, 'open air with no water below is not boat-buildable');

{
  const filmTiles=new Map();
  const FK=(x,y)=>x+','+y;
  filmTiles.set(FK(30,10), T.WATER);
  filmTiles.set(FK(30,11), T.STONE);
  const filmGetTile=(x,y)=>filmTiles.has(FK(x,y)) ? filmTiles.get(FK(x,y)) : T.AIR;
  const filmWater={ UNITS:10, levelAt:(x,y)=> (x===30 && y===10 ? 3 : 0), disturb(){} };
  assert.equal(boats.placementMode(30,10,filmGetTile,{water:filmWater}), null, 'thin shoreline water film is too shallow to spawn a boat');
  assert.equal(boats.placeWood(30,10,filmGetTile,{water:filmWater}).ok, false, 'direct boat API also rejects too-shallow water films');
}

{
  const shoreTiles=new Map();
  const SK=(x,y)=>x+','+y;
  const shoreSet=(x,y,t)=>shoreTiles.set(SK(x,y),t);
  const shoreGetTile=(x,y)=>shoreTiles.has(SK(x,y)) ? shoreTiles.get(SK(x,y)) : T.AIR;
  for(let x=0;x<=4;x++){ shoreSet(x,10,T.WATER); shoreSet(x,11,T.STONE); }
  for(let x=5;x<=12;x++) shoreSet(x,11,T.STONE);
  const shoreWater={ UNITS:10, levelAt:(x,y)=>shoreGetTile(x,y)===T.WATER ? 10 : 0, disturb(){} };
  const windRight={ speedAt:()=>5 };
  const windLeft={ speedAt:()=>-5 };
  boats.reset();
  assert.equal(boats.placementMode(4,10,shoreGetTile,{water:shoreWater}), 'boat', 'one-block-deep water can still launch a raft');
  const shorePlaced=boats.placeWood(4,10,shoreGetTile,{water:shoreWater});
  assert.ok(shorePlaced.ok && shorePlaced.created, 'raft can be built at the last water cell before a beach shelf');
  const shoreBoat=boats._debug.boats()[0];
  assert.equal(boats.placementMode(5,10,shoreGetTile,{water:shoreWater}), null, 'a plank beside the raft cannot be glued over dry shore air');
  for(let i=0;i<300;i++) boats.update(1/60,null,shoreGetTile,{wind:windRight,water:shoreWater});
  assert.ok(shoreBoat.inWater && !shoreBoat.grounded, 'shore wind cannot beach a floating raft onto a dry shelf');
  assert.ok(shoreBoat.x<=4.01, `raft stays in the water column instead of climbing shore (x=${shoreBoat.x.toFixed(3)})`);
  const awayX=shoreBoat.x;
  for(let i=0;i<220;i++) boats.update(1/60,null,shoreGetTile,{wind:windLeft,water:shoreWater});
  assert.ok(shoreBoat.x<awayX-0.45, `raft can still sail away from the shore block (moved ${(shoreBoat.x-awayX).toFixed(2)})`);
}

boats.reset();
const placed=boats.placeWood(5,13,getTile);
assert.ok(placed.ok && placed.created, 'wood dropped into deep water creates a raft');
const b=boats._debug.boats()[0];

// --- Buoyancy: wood does not sink — it floats up to the surface -------------
step(400);
const draft=boats.config.DRAFT;
assert.ok(Math.abs((b.y+1)-(10+draft))<0.1, `raft floats with the hull draft submerged (bottom=${(b.y+1).toFixed(2)}, want ~${(10+draft).toFixed(2)})`);
assert.ok(b.inWater && !b.grounded, 'floating raft reports inWater, not grounded');

// --- Extending the raft ------------------------------------------------------
assert.equal(boats.placementMode(6,Math.round(b.y),getTile), 'extend', 'a free cell beside a raft extends it');
const ext=boats.placeWood(6,Math.round(b.y),getTile);
assert.ok(ext.ok && ext.extended, 'plank glued to the raft');
assert.equal(b.cells.length, 2, 'raft has two planks');
assert.equal(boats._debug.boats().length, 1, 'extension does not spawn a second raft');

// --- Wind propulsion ---------------------------------------------------------
const x0=b.x;
step(240,breeze);
assert.ok(b.x>x0+1.5, `weather wind pushes the raft (moved ${(b.x-x0).toFixed(2)} tiles)`);
assert.ok(Math.abs(b.vx)<=boats.config.MAX_SPEED, 'raft speed stays clamped');

// --- Terrain stops the hull ---------------------------------------------------
step(4000,breeze);
const bb=boats._debug.bounds(b);
assert.ok(b.x+bb.maxDx+1<=40.01, 'raft cannot pass through the shore wall');
assert.ok(b.inWater, 'raft stays afloat against the wall');

// --- Hero platform + rowing ---------------------------------------------------
const p={x:b.x+0.5,y:b.y-0.6,vx:0,vy:0.5,w:0.7,h:0.95,onGround:false,jumpCount:1};
assert.ok(boats.collideHero(p,1/60), 'hero lands on the deck');
assert.ok(p.onGround && p.jumpCount===0, 'deck counts as ground and refreshes jumps');
assert.ok(boats.heroBoat()===b, 'heroBoat resolves to the raft under the hero feet');
assert.ok(boats.heroOnBoat(p)===b, 'live deck query resolves the raft under the hero feet');

const sideSwimmer={x:b.x+bb.minDx-0.42,y:b.y+0.55,vx:0.2,vy:-0.1,w:0.7,h:0.95,onGround:false,jumpCount:1};
assert.ok(boats.heroTouchingBoat(sideSwimmer,{floating:true}), 'swimmer beside the floating hull counts as touching the boat');
const boarded=boats.boardHeroFromWater(sideSwimmer,{getTile});
assert.ok(boarded.ok && boarded.boat===b, 'jumping while touching the hull boards the swimmer onto the deck');
assert.ok(sideSwimmer.onGround && sideSwimmer.jumpCount===0 && Math.abs(sideSwimmer.vy)<1e-9, 'boarding settles the swimmer as standing on the raft');
assert.ok(boats.heroOnBoat(sideSwimmer)===b, 'boarded swimmer is now on the boat deck');

let pool=10;
const heroEnergy={spend(n){ if(pool+1e-9<n) return false; pool-=n; return true; }};
const r1=boats.row(-1,{heroEnergy,player:p});
assert.ok(r1.ok && r1.strong, 'an energetic oar stroke lands');
assert.ok(b.vx<0, 'stroke pushes the boat in the rowed direction');
assert.ok(pool<10, 'the stroke burned hero energy');
const vAfterStrong=b.vx;
pool=0;
const r2=boats.row(-1,{heroEnergy,player:p});
assert.ok(r2.ok && !r2.strong, 'with an empty pool the stroke still lands, weakly');
assert.ok(b.vx<vAfterStrong && b.vx>vAfterStrong-boats.config.ROW_IMPULSE, 'weak stroke adds far less speed');
// repeated strokes never exceed the rowing cap
pool=1e9;
for(let i=0;i<60;i++) boats.row(-1,{heroEnergy,player:p});
assert.ok(Math.abs(b.vx)<=boats.config.ROW_MAX_SPEED+1e-9, 'rowing speed is capped');
b.vx=0;

// hero off the raft: rowing refuses
const away={x:2,y:2,vx:0,vy:0,w:0.7,h:0.95,onGround:false,jumpCount:0};
boats.collideHero(away,1/60);
assert.equal(boats.heroBoat(), null, 'hero away from rafts is not aboard');
assert.equal(boats.heroOnBoat(away), null, 'live deck query reports no raft for an off-boat hero');
assert.equal(boats.row(1,{heroEnergy,player:away}).ok, false, 'cannot row without standing on a raft');

// --- Object collisions: wood posts, other rafts, and fish --------------------
boats.reset();
setT(14,9,T.WOOD); setT(14,10,T.WOOD);
boats.restore({v:1,boats:[{x:12,y:9.55,vx:3,cells:[[0,0],[1,0]]}]});
const woodStop=boats._debug.boats()[0];
boats.update(1/30,null,getTile,{wind:calm,water});
const woodStopBounds=boats._debug.bounds(woodStop);
assert.ok(woodStop.x+woodStopBounds.maxDx+1<=14.01, 'solid wood posts block a wooden raft');
assert.equal(woodStop.vx, 0, 'wood collision cancels hull speed');
tiles.delete(K(14,9)); tiles.delete(K(14,10));

boats.reset();
boats.restore({v:1,boats:[{x:8,y:9.55,vx:5,cells:[[0,0],[1,0]]},{x:10.03,y:9.55,vx:0,cells:[[0,0]]}]});
const [rammer,target]=boats._debug.boats();
boats.update(1/30,null,getTile,{wind:calm,water});
assert.equal(boatRectsOverlap(rammer,target), false, 'separate wooden rafts push apart instead of overlapping');
assert.ok(rammer.vx<5, 'ramming raft loses speed on impact');
assert.ok(target.vx>0, 'hit raft receives momentum from the collision');

// The capped-fleet broad phase must retain the same collision result, including
// a pair straddling a spatial-bucket boundary. Distant boats are deliberately
// present so this exercises the indexed path rather than the small-fleet path.
boats.reset();
boats.restore({v:1,boats:[
  {x:14,y:9.55,vx:5,cells:[[0,0],[1,0]]},
  {x:16.03,y:9.55,vx:0,cells:[[0,0]]},
  ...Array.from({length:30},(_,i)=>({x:1000+i*40,y:9.55,vx:0,cells:[[0,0]]}))
]});
const [indexedRammer,indexedTarget]=boats._debug.boats();
boats.update(1/30,null,getTile,{wind:calm,water});
assert.equal(boatRectsOverlap(indexedRammer,indexedTarget), false, 'broad-phase fleet collision separates hulls across a bucket boundary');
assert.ok(indexedTarget.vx>0, 'broad-phase fleet collision transfers momentum in deterministic boat order');
assert.equal(boats._debug.broadPhaseMode(),'indexed','narrow sparse fleets retain the indexed collision path');

// Max-width sparse hulls touch many unique coarse buckets. Allocating a full
// fleet bitset for each one is slower than direct AABB checks, even though the
// boats never meet, so the planner must reject that construction shape early.
boats.reset();
const maxWideCells=Array.from({length:boats.config.MAX_CELLS},(_,dx)=>[dx,0]);
boats.restore({v:1,boats:Array.from({length:boats.config.MAX_BOATS},(_,i)=>({
  x:i*256, y:9.55, vx:0, cells:maxWideCells
}))});
boats.update(1/60,null,getTile,{wind:calm,water});
assert.equal(boats._debug.broadPhaseMode(),'wide-fallback','wide sparse fleets avoid high-construction-cost bitset buckets');

// The mob hull hook is read-only, so the simulation can share its stable cell
// array instead of allocating one clone per plank every frame.
boats.reset();
boats.restore({v:1,boats:[{x:10,y:9.55,vx:0,cells:[[0,0],[1,0]]}]});
const hookBoat=boats._debug.boats()[0];
let hookCells=null;
boats.update(1/60,null,getTile,{wind:calm,water,mobs:{collideBoat(record){ hookCells=record.cells; return null; }}});
assert.equal(hookCells,hookBoat.cells,'mob collision receives the stable read-only hull-cell array');

mobs.clearAll();
boats.reset();
boats.restore({v:1,boats:[{x:10,y:9.55,vx:3,cells:[[0,0],[1,0]]}]});
const fishBoat=boats._debug.boats()[0];
mobs.deserialize({v:4,list:[{id:'FISH',x:11.6,y:10.25,vx:0,vy:0,hp:4,waterTopY:10,desiredDepth:1}],aggro:{mode:'rel',m:{}}});
const fishBefore=mobs.serialize().list.find(m=>m.id==='FISH');
const fishHit=mobs.collideBoat({id:fishBoat.id,x:fishBoat.x,y:fishBoat.y,vx:fishBoat.vx,vy:0,cells:fishBoat.cells}, boats._debug.bounds(fishBoat), 1/60, {getTile});
const fishAfter=mobs.serialize().list.find(m=>m.id==='FISH');
assert.ok(fishHit.hits>=1 && fishHit.aquatic>=1, 'boat collision hook detects fish in the hull');
assert.ok(fishAfter.x>fishBefore.x+0.05, 'fish is shoved sideways out of the wooden hull');
assert.ok(fishAfter.vx>0, 'fish receives a visible bump from the moving boat');
mobs.clearAll();

mobs.clearAll();
boats.reset();
boats.restore({v:1,boats:[{x:10,y:9.55,vx:-4,cells:[[0,0],[1,0]]}]});
const piranhaBoat=boats._debug.boats()[0];
mobs.deserialize({v:4,list:[
  {id:'PIRANHA',x:10.25,y:10.25,vx:0,vy:0,hp:5,waterTopY:10,desiredDepth:1},
  {id:'PIRANHA',x:10.65,y:10.25,vx:0,vy:0,hp:5,waterTopY:10,desiredDepth:1},
  {id:'PIRANHA',x:11.05,y:10.25,vx:0,vy:0,hp:5,waterTopY:10,desiredDepth:1},
  {id:'PIRANHA',x:11.45,y:10.25,vx:0,vy:0,hp:5,waterTopY:10,desiredDepth:1}
],aggro:{mode:'rel',m:{}}});
const piranhaHit=mobs.collideBoat({id:piranhaBoat.id,x:piranhaBoat.x,y:piranhaBoat.y,vx:piranhaBoat.vx,vy:0,cells:piranhaBoat.cells}, boats._debug.bounds(piranhaBoat), 1/60, {getTile});
assert.ok(piranhaHit.hits>=4 && piranhaHit.aquatic>=4, 'boat collision hook still sees piranhas around the hull');
assert.equal(piranhaHit.blockers,0, 'piranhas do not count as boat blockers');
assert.equal(piranhaHit.drag,0, 'piranhas add no hull drag');
boats.update(1/60,null,getTile,{wind:calm,water,mobs});
assert.ok(piranhaBoat.vx<-3.5, 'a piranha crowd cannot cling to the hull and cancel opposite rowing momentum');
mobs.clearAll();

// --- Breaking planks: wood comes back, hulls split ---------------------------
boats.reset();
boats.restore({v:1,boats:[{x:10,y:9,vx:0,cells:[[0,0],[1,0],[2,0]]}]});
const s=boats._debug.boats()[0];
const rm=boats.removeCellAt(s.x+1.5,s.y+0.5); // knock out the middle plank
assert.ok(rm && rm.drop==='wood', 'mined plank returns wood');
assert.equal(boats._debug.boats().length, 2, 'severed hull splits into two rafts');
const totalCells=boats._debug.boats().reduce((n,x)=>n+x.cells.length,0);
assert.equal(totalCells, 2, 'split keeps exactly the surviving planks');

// --- Snapshot / restore round trip -------------------------------------------
const snap=boats.snapshot();
boats.reset();
assert.equal(boats._debug.boats().length, 0, 'reset clears rafts');
assert.ok(boats.restore(snap), 'snapshot restores');
assert.equal(boats._debug.boats().length, 2, 'both rafts came back');
assert.equal(boats._debug.boats().reduce((n,x)=>n+x.cells.length,0), 2, 'restored plank count matches');

// A cross-shaped hull has four independent arms after its articulation plank
// is removed; each arm must become a real raft rather than one disconnected body.
boats.reset();
boats.restore({v:1,boats:[{x:20,y:9,vx:0,cells:[[0,0],[-1,0],[1,0],[0,-1],[0,1]]}]});
assert.ok(boats.removeCellAt(20.5,9.5), 'articulation plank can be removed from a cross hull');
assert.equal(boats._debug.boats().length, 4, 'multi-way hull split creates all four connected components');
assert.ok(boats._debug.boats().every(h=>h.cells.length===1), 'each severed arm is represented exactly once');

// Hostile persistence must not create unbounded entities or gigantic sparse
// bounds that turn the per-frame hull-column scan into a denial of service.
boats.restore({v:1,boats:[
  {x:10,y:9,vx:Infinity,cells:[[0,0],[999999999,0],[-999999999,0]]},
  {x:Infinity,y:9,vx:0,cells:[[0,0]]},
  {x:11,y:9,vx:0,cells:[[0.5,0],[NaN,0]]},
  {x:12,y:9,vx:0,cells:[[0,0],[2,0]]}
]});
assert.equal(boats._debug.boats().length, 3, 'restore rejects invalid boats/cells and splits disconnected saved hulls safely');
assert.ok(boats._debug.boats().every(h=>boats._debug.bounds(h).w<=boats.config.MAX_CELLS), 'restored hull bounds remain strictly bounded');
assert.ok(boats._debug.boats().every(h=>Number.isFinite(h.vx)), 'non-finite saved velocity is neutralized');

const boatFlood=Array.from({length:boats.config.MAX_BOATS+37},(_,i)=>({x:1000+i,y:9,vx:0,cells:[[0,0]]}));
boats.restore({v:1,boats:boatFlood});
assert.equal(boats._debug.boats().length, boats.config.MAX_BOATS, 'restore processes at most the boat persistence cap');
assert.equal(boats.snapshot().boats.length, boats.config.MAX_BOATS, 'snapshot is bounded by the same boat cap');
assert.equal(boats.placeWood(5,10,getTile,{water}).ok, false, 'new standalone boats are refused once the runtime cap is reached');

// --- Beaching: no water under the hull → the raft is cargo and rests ---------
boats.reset();
boats.restore({v:1,boats:[{x:50,y:8,vx:0,cells:[[0,0]]}]});
const g=boats._debug.boats()[0];
step(400);
assert.ok(g.grounded && !g.inWater, 'raft without water beaches on the floor');
assert.ok(Math.abs((g.y+1)-15)<0.05, 'beached raft rests exactly on the ground');
// grounded raft refuses oar strokes
const gp={x:g.x+0.5,y:g.y-0.6,vx:0,vy:0.2,w:0.7,h:0.95,onGround:false,jumpCount:0};
boats.collideHero(gp,1/60);
assert.equal(boats.row(1,{heroEnergy}).ok, false, 'cannot row a beached raft');

// --- Propulsion registry stays extensible ------------------------------------
assert.ok(boats.registerPropulsion({id:'test-engine', thrust:()=>0}), 'future engines can register propulsion providers');
assert.ok(boats.metrics().propulsion.includes('wind') && boats.metrics().propulsion.includes('test-engine'), 'propulsion registry lists providers');
assert.equal(boats.registerPropulsion({id:'x'.repeat(65),thrust:()=>0}),false,'oversized propulsion ids are rejected');
assert.ok(boats.registerPropulsion({id:'faulty-engine',thrust(){ throw new Error('synthetic provider failure'); }}),'isolated faulty propulsion provider registers for the fault-containment test');
assert.doesNotThrow(()=>boats.update(1/60,null,getTile,{wind:calm,water}),'one faulty propulsion extension cannot crash the boat simulation');
for(let i=0;i<boats.config.MAX_PROPULSION_PROVIDERS;i++) boats.registerPropulsion({id:'bounded-'+i,thrust:()=>0});
assert.equal(boats.metrics().propulsion.length,boats.config.MAX_PROPULSION_PROVIDERS,'propulsion registry has a hard provider cap');
assert.equal(boats.registerPropulsion({id:'one-too-many',thrust:()=>0}),false,'propulsion provider flood is refused at the cap');

// --- Light wood is excellent for boats ---------------------------------------
// A raft remembers its wood, refunds it, rejects mixed hulls, floats higher, and
// the material survives (and is clamped on) persistence.
boats.reset();
const lightPlaced=boats.placeWood(5,13,getTile,{material:T.LIGHT_WOOD});
assert.equal(lightPlaced.ok, true, 'light wood builds a raft');
const lb=boats._debug.boats()[0];
assert.equal(lb.material, T.LIGHT_WOOD, 'the raft remembers it is built from light wood');
assert.equal(boats.placeWood(6,Math.round(lb.y),getTile,{material:T.WOOD}).ok, false, 'a light-wood raft rejects a plain-wood plank (hull stays one wood)');
assert.equal(boats.placeWood(6,Math.round(lb.y),getTile,{material:T.LIGHT_WOOD}).ok, true, 'same-wood extension is allowed');

// Light hull rides higher (lower draft) than a plain hull in the same water.
boats.reset();
boats.placeWood(5,13,getTile,{material:T.LIGHT_WOOD});
boats.placeWood(30,13,getTile);
const [lightBoat, plainBoat]=boats._debug.boats();
step(180, calm);
assert.ok(lightBoat.y < plainBoat.y - 1e-3, 'a light-wood raft floats higher than a plain-wood raft');

// Breaking a plank refunds the hull's own wood.
boats.reset();
boats.placeWood(5,13,getTile,{material:T.LIGHT_WOOD});
const ldrop=boats._debug.boats()[0];
assert.equal(boats.removeCellAt(ldrop.x+0.5, ldrop.y+0.5).drop, 'lightWood', 'breaking a light-wood plank refunds lightWood');
boats.reset();
boats.placeWood(5,13,getTile);
const pdrop=boats._debug.boats()[0];
assert.equal(boats.removeCellAt(pdrop.x+0.5, pdrop.y+0.5).drop, 'wood', 'a plain raft still refunds plain wood');

// Material survives snapshot/restore, and hostile/unknown materials clamp to wood.
boats.reset();
boats.placeWood(5,13,getTile,{material:T.LIGHT_WOOD});
const lsnap=boats.snapshot();
boats.reset();
boats.restore(lsnap);
assert.equal(boats._debug.boats()[0].material, T.LIGHT_WOOD, 'light-wood material survives snapshot/restore');
boats.restore({v:1,boats:[{x:12,y:9.55,vx:0,cells:[[0,0]]},{x:20,y:9.55,vx:0,cells:[[0,0]],material:999999}]});
const restoredMats=boats._debug.boats();
assert.equal(restoredMats[0].material, T.WOOD, 'a record with no material defaults to plain wood');
assert.equal(restoredMats[1].material, T.WOOD, 'an unknown saved material is clamped to plain wood');

// --- Sail: a raised sail turns the weather wind into a stronger fuel-free drive
boats.reset();
boats.placeWood(5,13,getTile);
const bareWindBoat=boats._debug.boats()[0];
step(150, breeze);
const bareWindReach=Math.abs(bareWindBoat.vx);
boats.reset();
boats.placeWood(5,13,getTile);
const sailBoat=boats._debug.boats()[0];
sailBoat.sail=true;
step(150, breeze);
assert.ok(Math.abs(sailBoat.vx) > bareWindReach + 0.4, 'a raised sail drives the raft faster downwind than bare wind (' + Math.abs(sailBoat.vx).toFixed(2) + ' vs ' + bareWindReach.toFixed(2) + ')');
// The sail flag survives snapshot/restore (and defaults off elsewhere).
const sailSnap=boats.snapshot();
boats.reset();
boats.restore(sailSnap);
assert.equal(boats._debug.boats()[0].sail, true, 'a raised sail persists through snapshot/restore');
boats.reset();
boats.placeWood(5,13,getTile);
assert.ok(!boats._debug.boats()[0].sail, 'a fresh raft starts with its sail down');

console.log('boats-sim: all assertions passed');
