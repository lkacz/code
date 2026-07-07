// Hero burial & crush regressions: a collapse must never teleport the hero out
// of the pile. Light loads are re-loosened and rest on him (he is a block),
// heavy loads pin and crush him in place, and walls he is merely shoved against
// ease him out gently. Also covers the hero-as-block guards in trees.js debris
// settling and falling.js forced settles, plus the trainable Twardość stat.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){},
};

const { T, INFO } = await import('../src/constants.js');
const {
  CRUSH_TUNING, heroLoadWeight, heroCrushCapacity, crushTickDamage, canEjectOntoHero,
  heroEmbeddedTiles, resolveHeroBurial,
} = await import('../src/engine/hero_crush.js');

const key = (x,y)=>x+','+y;
const tiles = new Map();
const getTile = (x,y)=>tiles.get(key(x,y)) ?? T.AIR;
const setTile = (x,y,t)=>{
  if(t===T.AIR) tiles.delete(key(x,y));
  else tiles.set(key(x,y), t);
};
const solidAt = (x,y)=>{
  const t=getTile(x,y);
  if(t===T.AIR || t===T.WATER || t===T.LAVA) return false;
  const info=INFO[t];
  return !(info && info.passable);
};

// 0.7×0.95 hero centered on (0.5, 8.5) occupies exactly cell (0,8)
const player={x:0.5, y:8.5, w:0.7, h:0.95, vx:0, vy:0};
window.player=player;
const heroAt=(x,y)=>{ player.x=x; player.y=y; };
const resolve=(buried, opts={})=>resolveHeroBurial({
  player, getTile, solidAt,
  buriedCells:buried,
  capacityBonus:opts.capacityBonus||0,
  isLooseLoad:opts.isLooseLoad || (()=>true),
  minY:-140,
  dt:opts.dt ?? 1/60,
});

// --- Weights, capacity, eject eligibility ---
assert.equal(heroLoadWeight(T.SAND), 0.9, 'sand is lighter than the 1.0 default');
assert.ok(heroLoadWeight(T.STONE)>1 && heroLoadWeight(T.STONE)<1.1, 'stone weight comes from the material profile');
assert.ok(heroLoadWeight(T.BEDROCK)>CRUSH_TUNING.BASE_CAPACITY*10, 'bedrock always exceeds any trained capacity');
assert.equal(heroCrushCapacity(0), CRUSH_TUNING.BASE_CAPACITY, 'untrained capacity is the base');
assert.equal(heroCrushCapacity(3), CRUSH_TUNING.BASE_CAPACITY+3, 'crushResistBonus adds linearly');
assert.equal(canEjectOntoHero(T.STONE), true, 'stone can be re-loosened onto the hero');
assert.equal(canEjectOntoHero(T.BEDROCK), false, 'bedrock stays a tile');
assert.equal(canEjectOntoHero(T.CHEST_COMMON), false, 'chests stay tiles');
assert.equal(crushTickDamage(0), 0, 'no excess, no crush tick');
assert.equal(crushTickDamage(2), Math.round(CRUSH_TUNING.DMG_BASE+2*CRUSH_TUNING.DMG_PER_EXCESS), 'tick scales with excess');
assert.equal(crushTickDamage(1e6), CRUSH_TUNING.DMG_MAX, 'tick damage is capped');

// --- Light burial: the hero shoulders it, the material is ejected to rest on him ---
{
  tiles.clear(); heroAt(0.5,8.5);
  setTile(0,8,T.SAND);
  const buried=new Set([key(0,8)]);
  const res=resolve(buried);
  assert.equal(res.status, 'rest', 'a single sand tile is within base capacity');
  assert.ok(Math.abs(res.load-0.9)<1e-9, 'load counts the buried sand');
  assert.equal(res.eject.length, 1, 'the buried cell is handed back for re-loosening');
  assert.equal(res.eject[0].x, 0);
  assert.equal(res.eject[0].y, 8);
}

// --- Heavy burial: loose overburden pins and crushes; Twardość points survive it ---
{
  tiles.clear(); heroAt(0.5,8.5);
  setTile(0,8,T.SAND);
  for(let y=3;y<=7;y++) setTile(0,y,T.STONE);
  const buried=new Set([key(0,8)]);
  const res=resolve(buried);
  assert.equal(res.status, 'pinned', 'five stones of rubble over the head exceed base capacity');
  assert.ok(res.load>heroCrushCapacity(0), 'load exceeds untrained capacity');
  assert.ok(res.damage>=CRUSH_TUNING.DMG_BASE, 'crush tick starts at the base damage');
  assert.ok(res.damage<=CRUSH_TUNING.DMG_MAX, 'crush tick is capped');
  const trained=resolve(new Set([key(0,8)]), {capacityBonus:7.5});
  assert.equal(trained.status, 'rest', 'five Twardość points shoulder the same collapse');
  const deeper=new Set([key(0,8)]);
  for(let y=-3;y<=2;y++) setTile(0,y,T.STONE);
  const worse=resolve(deeper);
  assert.ok(worse.damage>=res.damage, 'more overburden never hurts less');
}

// --- Architecture is not load: the overburden walk stops at non-loose cells ---
{
  tiles.clear(); heroAt(0.5,8.5);
  setTile(0,8,T.SAND);
  for(let y=3;y<=7;y++) setTile(0,y,T.STONE);
  const res=resolve(new Set([key(0,8)]), {isLooseLoad:(x,y,t)=>t===T.SAND});
  assert.equal(res.status, 'rest', 'a self-supporting stone roof does not press on the hero');
  assert.ok(Math.abs(res.load-0.9)<1e-9, 'only the buried sand counts');
}

// --- Bedrock burial can never be shrugged off ---
{
  tiles.clear(); heroAt(0.5,8.5);
  setTile(0,8,T.BEDROCK);
  const res=resolve(new Set([key(0,8)]), {capacityBonus:400});
  assert.equal(res.status, 'pinned', 'bedrock overwhelms even a maxed hero');
}

// --- Shove without burial: bounded ease-out, never a snap ---
{
  tiles.clear(); heroAt(0.5,8.5);
  setTile(0,8,T.STONE);
  const res=resolve(new Set(), {dt:1/60});
  assert.equal(res.status, 'shoved', 'overlap without a burial record is a shove');
  assert.ok(res.push, 'shove produces a correction push');
  const mag=Math.hypot(res.push.dx,res.push.dy);
  assert.ok(mag<=CRUSH_TUNING.DEPEN_RATE/60+1e-9, 'correction is rate-limited, not a teleport');
  assert.ok(mag>0, 'correction actually moves the hero');
}

// --- Doors/trapdoors are utilities, not collapse material ---
{
  tiles.clear(); heroAt(0.5,8.5);
  setTile(0,8,T.WOOD_TRAPDOOR);
  assert.equal(heroEmbeddedTiles(player,solidAt,getTile).length, 0, 'trapdoors never read as burial');
  assert.equal(resolve(new Set([key(0,8)])).status, 'clear');
}

// --- Stale burial records are pruned ---
{
  tiles.clear(); heroAt(0.5,8.5);
  const buried=new Set([key(0,8)]);
  const res=resolve(buried);
  assert.equal(res.status, 'clear', 'no tiles overlap after the cell was mined');
  assert.equal(buried.size, 0, 'the mined cell left the burial set');
}

// --- Twardość: trainable stat feeding crushResistBonus ---
{
  const { progress } = await import('../src/engine/progress.js');
  progress.reset();
  player.xp=60; // level 2 → one skill point
  assert.equal(progress.points(), 1, 'level 2 grants one spendable point');
  assert.equal(progress.spend('hard'), true, 'Twardość can be trained');
  assert.equal(progress.stats().hard, 1, 'Twardość point is stored');
  assert.equal(progress.points(), 0, 'training Twardość consumes the point');
  assert.equal(progress.bonuses().crushResistBonus, CRUSH_TUNING.CAPACITY_PER_POINT, 'each point adds the tuned capacity');
  const snap=progress.snapshot();
  progress.reset();
  assert.equal(progress.stats().hard, 0, 'reset clears Twardość');
  progress.restore(snap);
  assert.equal(progress.stats().hard, 1, 'restore brings back trained Twardość');
  progress.reset();
  player.xp=0;
}

// --- falling.js: spawnLoose hovers on the hero, forced settles stack over his head ---
{
  const { fallingSolids } = await import('../src/engine/falling.js');
  tiles.clear();
  fallingSolids.reset();
  MM.world={ getConstructionBackground:()=>T.AIR };
  MM.water={ displaceAt(){}, onTileChanged(){} };
  fallingSolids.init(getTile,setTile);
  for(let x=-4;x<=4;x++) setTile(x,10,T.STONE);
  heroAt(0.5,9.5); // standing on the floor, occupying cell (0,9)
  assert.equal(fallingSolids.spawnLoose(0,9,T.SAND), true, 'ejected sand becomes a loose grain');
  for(let i=0;i<40;i++) fallingSolids.update(getTile,setTile,1/20);
  assert.equal(getTile(0,9), T.AIR, 'the grain hovers on the hero instead of solidifying into him');
  assert.equal(fallingSolids.metrics().sand, 1, 'the hovering grain stays live');
  const load=fallingSolids.heroRestingLoad();
  assert.equal(load.count, 1, 'the hovering grain reads as resting on the hero');
  assert.ok(Math.abs(load.weight-heroLoadWeight(T.SAND))<1e-9, 'resting load reports the material weight');
  fallingSolids.settleAll(); // autosave freeze while he still stands there
  assert.equal(getTile(0,9), T.AIR, 'forced settle does not fill the hero cell');
  assert.equal(getTile(0,8), T.SAND, 'forced settle stacks the grain over his head — he is a block');
  assert.equal(fallingSolids.isSettledRubbleAt(0,8), false, 'sand is granular, not rubble-tracked');
  assert.equal(fallingSolids.heroRestingLoad().count, 0, 'settled grains leave the resting load');
}

// --- falling.js: live settles never materialize blocks onto (or above) the hero.
// Regression for the chimney ratchet: mid-jump, a stacking block whose claimed
// cell walks up into the hero must hover, not solidify over his head.
{
  const { fallingSolids } = await import('../src/engine/falling.js');
  tiles.clear();
  fallingSolids.reset();
  MM.world={ getConstructionBackground:()=>T.AIR };
  MM.water={ displaceAt(){}, onTileChanged(){} };
  fallingSolids.init(getTile,setTile);
  for(let x=-4;x<=4;x++) setTile(x,10,T.STONE);
  setTile(-1,9,T.STONE); setTile(1,9,T.STONE); // side walls: the stack cannot roll away
  heroAt(0.5,8.5); // mid-jump: occupying cell (0,8), directly above the landing column
  fallingSolids.spawnLoose(0,9,T.STONE);
  fallingSolids.spawnLoose(0,9,T.STONE); // co-located pair, as after hovering on him
  for(let i=0;i<40;i++) fallingSolids.update(getTile,setTile,1/20);
  assert.equal(getTile(0,9), T.STONE, 'the first block settles under the hero');
  assert.equal(getTile(0,8), T.AIR, 'no block solidifies into the hero');
  assert.equal(getTile(0,7), T.AIR, 'no chimney block appears above his head');
  assert.equal(fallingSolids.metrics().active, 1, 'the displaced block keeps hovering instead');
}

// --- trees.js: felled debris hovers on the hero, save-time settle force-writes ---
{
  const { worldGen } = await import('../src/engine/worldgen.js');
  const { trees } = await import('../src/engine/trees.js');
  worldGen.randSeed=()=>0;
  worldGen.surfaceHeight=()=>10;
  tiles.clear();
  trees.reset(); if(trees.resetIdentities) trees.resetIdentities();
  MM.fallingSolids={ onTileRemoved(){}, afterPlacement(){} };
  MM.water={ displaceAt(){}, onTileChanged(){} };
  for(let x=-4;x<=4;x++) setTile(x,10,T.STONE);
  heroAt(0.5,9.5); // occupying cell (0,9)
  trees._fallingBlocks.push({x:0,y:5,t:T.WOOD,dir:0,hBudget:0,windCarry:0});
  for(let i=0;i<60;i++) trees.updateFallingBlocks(getTile,setTile,1/20);
  assert.equal(getTile(0,9), T.AIR, 'the log hovers on the hero instead of burying him');
  assert.equal(trees._fallingBlocks.length, 1, 'the hovering log stays live');
  const treeLoad=trees.heroRestingLoad();
  assert.equal(treeLoad.count, 1, 'the hovering log reads as resting on the hero');
  assert.ok(Math.abs(treeLoad.weight-heroLoadWeight(T.WOOD))<1e-9, 'log load uses the wood weight');
  heroAt(5.5,9.5); // step aside
  for(let i=0;i<60;i++) trees.updateFallingBlocks(getTile,setTile,1/20);
  assert.equal(getTile(0,9), T.WOOD, 'the log settles once the hero moves away');
  assert.equal(trees._fallingBlocks.length, 0, 'the settled log left the falling list');
  assert.equal(trees.heroRestingLoad().count, 0, 'settled logs leave the resting load');
  assert.equal(trees.isFallenDebrisAt(0,9), true, 'settled logs read as loose load for the crush resolver');

  // save-time settle may not lose pieces: it writes through the hero and the
  // burial resolver re-loosens the tile next frame
  heroAt(0.5,9.5);
  setTile(0,9,T.AIR); trees.reset(); if(trees.resetIdentities) trees.resetIdentities();
  trees._fallingBlocks.push({x:0,y:5,t:T.WOOD,dir:0,hBudget:0,windCarry:0});
  trees.settleAll(getTile,setTile);
  assert.equal(getTile(0,9), T.WOOD, 'forced settle keeps the mass even inside the hero cell');
}

// --- main.js wiring contract (headless: source assertions like save-schema-sim) ---
{
  const src=readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(src, /updateHeroCrush\(dt\);/, 'physics runs the burial resolver every frame');
  assert.match(src, /collide\('x',px\)/, 'x collision receives the pre-move span');
  assert.match(src, /collide\('y',py\)/, 'y collision receives the pre-move span');
  assert.match(src, /continue; \/\/ embedded before the move/, 'embedded tiles are excluded from collision snapping');
  assert.match(src, /noteTileBuriesHero\(tx,ty,next\)/, 'world tile changes feed the burial set');
  assert.match(src, /cause:'crushed'/, 'crush damage routes through the central hero damage handler');
  assert.match(src, /waterStackAboveY\(tileX,headY\)/, 'deep-water pressure is based on the water stack above the hero');
  assert.match(src, /updateWaterPressure\([\s\S]*?MM\.activeModifiers[\s\S]*?crushResistBonus/, 'deep-water pressure reuses Twardość crushResistBonus');
  assert.match(src, /cause:'water_pressure'/, 'pressure damage routes through the central hero damage handler');
  assert.match(src, /nearestOpenGraveCell\(gx,gy\)/, 'a buried death still finds a reachable gravestone');
  assert.match(src, /heroPileWeight=measureHeroPile\(\)/, 'resting-entity piles are measured every frame');
  assert.match(src, /heroPileWeight>0 && player\.vy<0/, 'a pile on the hero blocks upward movement');
}

console.log('hero-crush-sim: all assertions passed');
