// Sky biome wave regressions ("podniebne krainy"):
//  1. world_layers.js: 11 themed sky biomes tile the heavens beyond
//     |x| >= SKY_BIOME_START in seeded per-cycle permutations (every cycle of
//     11 regions on a side contains each biome exactly once, both sides), the
//     center home sky stays the classic neutral fabric, and every biome
//     region generates its signature materials.
//  2. mobs.js: all 16 sky species are registered and PINNED harder than the
//     ground roster (the sky must never be the easy bypass toward the east /
//     west guardians); grunts only spawn in their native sky regions; the sky
//     pressure scheduler hunts an airborne hero, fields the region boss, notes
//     the biome discovery, and everything disengages once the hero lands.
//  3. Boss defeat pays out and locks that region's respawn for a while.
//  4. Cross-file wiring: every biome's boss+grunt exists in SPECIES, carries a
//     themed GEAR_LOOT entry (drops.js), and has a discovery catalog label.
// Run: node tools/sky-biomes-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T, WORLD_MIN_Y } = await import('../src/constants.js');
const WL = (await import('../src/engine/world_layers.js')).default;
await import('../src/engine/trees.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');
const { mobs } = await import('../src/engine/mobs.js');
const { discovery } = await import('../src/engine/discovery.js');

WG.worldSeed = 20260711;
WG.clearCaches();
world.clear();
mobs.clearAll();

// --- 1. biome map ------------------------------------------------------------
assert.equal(WL.SKY_BIOMES.length, 11, 'the heavens split into 11 themed biomes');
assert.ok(WL.SKY_BIOME_START >= 400, 'home sky around spawn stays neutral');
assert.equal(WL.skyBiomeAt(WG, 0), null, 'world center has no sky biome');
assert.equal(WL.skyBiomeAt(WG, WL.SKY_BIOME_START-1), null, 'neutral zone reaches the biome start');
assert.equal(WL.skyBiomeAt(WG, -(WL.SKY_BIOME_START-1)), null, 'neutral zone is symmetric');

for(const side of [1,-1]){
  for(const cycle of [0,1]){
    const seen = new Set();
    for(let b=0; b<11; b++){
      const wx = side*(WL.SKY_BIOME_START + (cycle*11+b)*WL.SKY_REGION_W + 5);
      const region = WL.skyBiomeAt(WG, wx);
      assert.ok(region && region.key, 'region resolves at '+wx);
      seen.add(region.key);
    }
    assert.equal(seen.size, 11, 'cycle '+cycle+' on side '+side+' contains every biome exactly once');
  }
}
{
  const a = WL.skyBiomeAt(WG, 1234), b = WL.skyBiomeAt(WG, 1234);
  assert.equal(a.key, b.key, 'biome pick is deterministic');
  assert.equal(a.regionKey, b.regionKey, 'region key is deterministic');
  assert.ok(a.x0 <= 1234 && 1234 < a.x1, 'region bounds bracket the query column');
}

// --- 1b. themed generation: every biome shows its signature fabric -----------
const SIGNATURES = {
  heaven:  [T.SNOW, T.GOLD_ORE],
  skywood: [T.GRASS, T.DIRT, T.LEAF],
  balloon: [T.WOOD, T.DIRT],
  storm:   [T.BASALT, T.ELECTRONICS],
  frost:   [T.ICE, T.SNOW],
  mirage:  [T.SAND, T.GOLD_ORE],
  wreck:   [T.STEEL, T.TRACK],
  spore:   [T.CLAY, T.GLOWSHROOM],
  void:    [T.OBSIDIAN],
  roost:   [T.WOOD, T.GRASS],
  ember:   [T.BASALT, T.COAL, T.LAVA]
};
function findRegion(key){
  for(let x=WL.SKY_BIOME_START; x<WL.SKY_BIOME_START+WL.SKY_REGION_W*22; x+=WL.SKY_REGION_W){
    const r = WL.skyBiomeAt(WG, x+5);
    if(r && r.key===key) return r;
  }
  return null;
}
const MP = await import('../src/engine/material_physics.js');
const { INFO } = await import('../src/constants.js');
for(const [key, tiles] of Object.entries(SIGNATURES)){
  const region = findRegion(key);
  assert.ok(region, 'biome '+key+' appears within two east cycles');
  const counts = {};
  for(let x=region.x0; x<region.x1; x++){
    for(let y=WORLD_MIN_Y; y<0; y++){
      const t = WL.skyTile(WG, x, y, y<-70?-2:-1);
      if(t!==T.AIR) counts[t]=(counts[t]||0)+1;
      // FALL-EXEMPTION COVERAGE PIN: every tile a themed region GENERATES must
      // be reachable by falling.js's natural-sky-fabric exemption (classic
      // cohesion set, biome fabric set, anchors) or be inherently non-falling
      // (passable fixtures, gases, loose items, machines, chests-as-objects).
      // A themed tile outside all of these would rain down on first disturbance.
      if(t!==T.AIR){
        const info = INFO[t] || {};
        const exempt = MP.isNaturalFloatingCohesionTile(t) || MP.isNaturalFloatingAnchorTile(t) ||
          WL.skyBiomeNaturalFabricTile(WG, x, t) ||
          MP.isPassableForFalling(t) || !!info.gas || !!info.looseItem || !!info.machine || !!info.chestTier;
        assert.ok(exempt, key+' generates tile '+t+' at '+x+','+y+' with no fall-exemption route');
      }
    }
  }
  for(const t of tiles) assert.ok((counts[t]||0) > 0, key+' region generates signature tile '+t);
  const solid = Object.values(counts).reduce((s,n)=>s+n,0);
  assert.ok(solid > 800, key+' region carries real island mass ('+solid+')');
}
// The exemption is provenance-scoped: themed materials stay fully physical
// outside their region — the neutral home sky and foreign biomes are untouched.
assert.equal(WL.skyBiomeNaturalFabricTile(WG, 100, T.SAND), false, 'neutral home sky never treats sand as floating fabric');
assert.equal(MP.isNaturalFloatingCohesionTile(T.SAND), false, 'raw material predicate stays narrow (free-dropped sand still falls at y<0)');
{
  const mirage = findRegion('mirage'), frost = findRegion('frost');
  assert.equal(WL.skyBiomeNaturalFabricTile(WG, mirage.center, T.SAND), true, 'mirage region owns sand as island fabric');
  assert.equal(WL.skyBiomeNaturalFabricTile(WG, frost.center, T.SAND), false, 'frost region does not exempt foreign sand');
  assert.equal(WL.skyBiomeNaturalFabricTile(WG, frost.center, T.ICE), true, 'frost region owns ice as island fabric');
}

// --- 2. species roster + difficulty pins --------------------------------------
const SPECIES = mobs._debugSpecies();
const GRUNTS = ['CLOUD_RAY','HARPY','VOLT_WISP','SPORE_DRIFTER','CINDER_HAWK'];
const BOSSES = ['SKY_SERAPH','SKYGROVE_WARDEN','BALLOON_TYRANT','STORM_HERALD','AURORA_WYRM',
                'MIRAGE_DJINN','CORSAIR_AUTOMATON','SPORE_MOTHER','GRAVITY_COLOSSUS','HARPY_QUEEN','EMBER_PHOENIX'];
for(const id of [...GRUNTS, ...BOSSES]){
  assert.ok(SPECIES[id] && mobs.species.includes(id), 'sky species '+id+' is registered');
  assert.ok(SPECIES[id].alwaysAggro, id+' hunts on sight — the sky is hostile territory');
}
// The sky must out-gun the ground: pin grunt stats above every classic ground
// predator (bear 30/10, thunder bison 48/15) and bosses in raid territory.
for(const id of GRUNTS){
  assert.ok(SPECIES[id].hp >= 55, id+' hp '+SPECIES[id].hp+' >= 55 (harder than any ground predator)');
  assert.ok(SPECIES[id].dmg >= 14, id+' dmg '+SPECIES[id].dmg+' >= 14');
}
for(const id of BOSSES){
  assert.ok(SPECIES[id].hp >= 500, id+' boss hp '+SPECIES[id].hp+' >= 500');
  assert.ok(SPECIES[id].dmg >= 26, id+' boss dmg '+SPECIES[id].dmg+' >= 26');
  assert.ok(SPECIES[id].xp >= 300, id+' boss pays raid-tier xp');
  assert.equal(SPECIES[id].spawnTest(0,-30,()=>T.AIR), false, id+' only spawns through the region scheduler');
}
// Every biome's roster is wired to real species.
for(const b of WL.SKY_BIOMES){
  assert.ok(SPECIES[b.boss], 'biome '+b.key+' boss '+b.boss+' exists');
  assert.ok(SPECIES[b.grunt], 'biome '+b.key+' grunt '+b.grunt+' exists');
  assert.ok(BOSSES.includes(b.boss), 'biome '+b.key+' boss is in the pinned boss set');
}
// Each biome key resolves to exactly one boss (no two biomes share a terror).
assert.equal(new Set(WL.SKY_BIOMES.map(b=>b.boss)).size, 11, 'all 11 bosses are distinct');

// --- 2b. grunt spawn gating ----------------------------------------------------
const airTile = () => T.AIR;
const rayRegion = findRegion(WL.SKY_BIOMES.find(b=>b.grunt==='CLOUD_RAY').key);
const cx = Math.floor(rayRegion.center);
assert.equal(SPECIES.CLOUD_RAY.spawnTest(cx, -30, airTile), true, 'grunt spawns in its native sky region');
assert.equal(SPECIES.CLOUD_RAY.spawnTest(cx, 30, airTile), false, 'grunt never spawns below the sky');
assert.equal(SPECIES.CLOUD_RAY.spawnTest(100, -30, airTile), false, 'grunt never spawns in the neutral home sky');

// --- 3. pressure + boss scheduler end-to-end -----------------------------------
const notes = [];
MM.discovery = { note(id, txt){ notes.push(id); return !!txt; } };
const msgs = [];
globalThis.msg = (t) => { msgs.push(String(t)); };

simNow = 10000; // outlive the clearAll spawn freeze
const player = { x: rayRegion.center, y: -40, vx:0, vy:0, hp: 4000, maxHp: 4000, hpInvul: 0 };
globalThis.player = player;
for(let i=0; i<2400; i++){ simNow += 1000/30; mobs.update(1/30, player, airTile, ()=>{}); }
let diag = mobs.diagnose(airTile);
const gruntId = rayRegion.grunt, bossId = rayRegion.boss;
assert.ok((diag.species[gruntId]||0) >= 2, 'sky pressure fields '+gruntId+' hunters ('+JSON.stringify(diag.species)+')');
assert.equal(diag.species[bossId]||0, 1, 'the region boss '+bossId+' materializes');
assert.ok(notes.includes('sky_biome_'+rayRegion.key), 'first flight into the biome notes the discovery');
assert.ok(msgs.some(t=>t.includes(rayRegion.name)), 'the biome announces itself by name');
assert.ok(player.hp < 4000, 'an airborne hero takes real punishment in a sky biome');

// grunts and boss both hold the sky: nobody chases a hero who lands
player.y = 64; player.hp = 4000;
for(let i=0; i<1800; i++){ simNow += 1000/30; mobs.update(1/30, player, airTile, ()=>{}); }
assert.equal(player.hp, 4000, 'sky fauna never follows the hero down to the surface');

// --- 3b. boss defeat: payout + region lockout ----------------------------------
player.y = -40;
for(let i=0; i<600; i++){ simNow += 1000/30; mobs.update(1/30, player, airTile, ()=>{}); }
let boss = mobs.nearestLiving(player.x, player.y, 80, {exclude: GRUNTS});
assert.ok(boss && boss.id===bossId, 'boss is back on patrol when the hero returns skyward');
msgs.length = 0;
let guard = 0;
while(boss.hp > 0 && guard++ < 400){
  mobs.damageAt(Math.floor(boss.x), Math.floor(boss.y), 500, {source:'hero'});
  simNow += 1000/30;
  mobs.update(1/30, player, airTile, ()=>{});
  boss = mobs.nearestLiving(boss.x, boss.y, 12, {exclude: GRUNTS}) || boss;
}
for(let i=0; i<300; i++){ simNow += 1000/30; mobs.update(1/30, player, airTile, ()=>{}); }
assert.ok(msgs.some(t=>t.includes('pokonany')), 'boss defeat announces the trophy moment');
diag = mobs.diagnose(airTile);
assert.equal(diag.species[bossId]||0, 0, 'the slain boss stays down');
for(let i=0; i<900; i++){ simNow += 1000/30; mobs.update(1/30, player, airTile, ()=>{}); }
diag = mobs.diagnose(airTile);
assert.equal(diag.species[bossId]||0, 0, 'region lockout holds — no instant boss respawn');

// --- 3c. persistence: boss region binding + phoenix rebirth survive reload -----
mobs.clearAll();
simNow += 30000;
mobs.forceSpawn('EMBER_PHOENIX', {x:rayRegion.center, y:-40}, airTile);
let phx = mobs.nearestLiving(rayRegion.center, -40, 60);
assert.ok(phx && phx.id==='EMBER_PHOENIX', 'phoenix force-spawns for the round-trip check');
phx._skyRegionKey='ember:7';
phx._reborn=true;
mobs.deserialize(JSON.parse(JSON.stringify(mobs.serialize())));
phx = mobs.nearestLiving(rayRegion.center, -40, 60);
assert.ok(phx && phx.id==='EMBER_PHOENIX', 'phoenix survives the save round-trip');
assert.equal(phx._skyRegionKey, 'ember:7', 'boss region binding persists (kill-after-reload still arms the lockout)');
assert.equal(phx._reborn, true, 'a spent phoenix rebirth stays spent across reload');
mobs.clearAll();

// --- 4. cross-file wiring: loot + discovery labels -----------------------------
const { drops } = await import('../src/engine/drops.js');
for(const id of GRUNTS){
  const entry = drops._debug.GEAR_LOOT[id];
  assert.ok(entry, 'grunt '+id+' has themed gear loot');
  assert.ok(entry.chance >= 0.10, 'grunt '+id+' loot chance pays elite tier');
}
for(const id of BOSSES){
  const entry = drops._debug.GEAR_LOOT[id];
  assert.ok(entry, 'boss '+id+' has themed gear loot');
  assert.ok(entry.chance >= 0.5, 'boss '+id+' loot chance pays jackpot tier');
  assert.ok(entry.tiers && entry.tiers.epic >= 0.5, 'boss '+id+' loot leans epic');
}
for(const b of WL.SKY_BIOMES){
  assert.ok(discovery.CATALOG['sky_biome_'+b.key], 'discovery catalog labels sky biome '+b.key);
}

console.log('OK sky-biomes-sim: 11 biomes themed & permuted, 16 sky species pinned deadlier than ground, pressure+boss scheduler, defeat lockout, loot & journal wiring');
