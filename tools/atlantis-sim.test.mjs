// Atlantis regression: sealed ocean floors can host rare underwater cities with
// guarded resources, without ever punching through the bedrock basin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T, CHUNK_W, WORLD_H } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');
const { mobs } = await import('../src/engine/mobs.js');

const worldSource = readFileSync(new URL('../src/engine/world.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(worldSource, /function applyAtlantis\(arr,cx\)[\s\S]*applyOceanBasinSeal\(arr,cx\)/,
  'Atlantis generation runs before the ocean basin seal is reasserted');
assert.match(worldSource, /worldAPI\.nearestAtlantis = nearestAtlantisSite;/,
  'world exposes an Atlantis finder for debug travel');
assert.match(mainSource, /window\.teleportHeroToNearestAtlantis = function\(dir\)\{ return debugJumpAtlantis\(dir\); \};/,
  'main exposes an Atlantis debug teleport bridge');
assert.match(mainSource, /atlantis:\(dir\)=> debugJumpAtlantis\(dir\)/,
  'travel debug actions include Atlantis teleporting');
assert.match(uiSource, /travelDebugAtlantisLeft[\s\S]*travelDebugAtlantisRight/,
  'debug menu exposes left and right Atlantis buttons');

const ATLANTIS_TILES = new Set([
  T.GLASS, T.OBSIDIAN, T.STEEL, T.SOLAR_BATTERY, T.ANTIGRAVITY_BEACON,
  T.IRIDIUM, T.METEORIC_IRON, T.ANTIMATTER_CRYSTAL, T.GLOWSHROOM,
  T.CHEST_RARE, T.CHEST_EPIC, T.STEEL_DOOR
]);

function scanAtlantis(seed, from=-30000, to=30000){
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  mobs.clearAll();
  const counts = {glass:0, steel:0, obsidian:0, rare:0, epic:0, iridium:0, meteor:0, anti:0, beacon:0, battery:0, shroom:0, door:0, bg:0};
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  let violations = 0;
  for(let cx=Math.floor(from/CHUNK_W); cx<=Math.floor(to/CHUNK_W); cx++){
    const arr = world.ensureChunk(cx);
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx = cx*CHUNK_W + lx;
      const sealTop = WG.oceanSealTop(wx);
      if(sealTop==null) continue;
      for(let y=WG.settings.seaLevel+1; y<sealTop; y++){
        if(world.getConstructionBackground(wx, y)!==T.AIR) counts.bg++;
        const t = arr[y*CHUNK_W+lx];
        if(!ATLANTIS_TILES.has(t)) continue;
        if(t===T.GLASS) counts.glass++;
        else if(t===T.STEEL) counts.steel++;
        else if(t===T.OBSIDIAN) counts.obsidian++;
        else if(t===T.CHEST_RARE) counts.rare++;
        else if(t===T.CHEST_EPIC) counts.epic++;
        else if(t===T.IRIDIUM) counts.iridium++;
        else if(t===T.METEORIC_IRON) counts.meteor++;
        else if(t===T.ANTIMATTER_CRYSTAL) counts.anti++;
        else if(t===T.ANTIGRAVITY_BEACON) counts.beacon++;
        else if(t===T.SOLAR_BATTERY) counts.battery++;
        else if(t===T.GLOWSHROOM) counts.shroom++;
        else if(t===T.STEEL_DOOR) counts.door++;
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, y);
      }
      for(let y=sealTop; y<WORLD_H; y++){
        if(arr[y*CHUNK_W+lx]!==T.BEDROCK) violations++;
      }
    }
  }
  return {seed, counts, minX, maxX, maxY, violations};
}

const site = scanAtlantis(12345);
assert.ok(Number.isFinite(site.minX) && site.maxX-site.minX>=60, 'seed 12345 produces a broad Atlantis city in a sealed ocean');
assert.ok(site.counts.glass>=180, 'Atlantis has a large glass dome signature');
assert.ok(site.counts.steel>=70, 'Atlantis has visible steel platforms and ribs');
assert.ok(site.counts.obsidian>=180, 'Atlantis has heavy obsidian foundations and spires');
assert.ok(site.counts.bg>=150, 'Atlantis domes and vaults have generated interior back-walls');
assert.ok(site.counts.door>=2, 'Atlantis vaults include steel pressure-lock doors');
assert.ok(site.counts.beacon>=2, 'Atlantis has multiple glowing/powered spire beacons');
assert.ok(site.counts.shroom>=5, 'Atlantis has bioluminescent interior lighting');
assert.ok(site.counts.epic>=1 && site.counts.rare>=2, 'Atlantis contains guarded rare/epic loot chests');
assert.ok(site.counts.iridium>=1 && site.counts.meteor>=2, 'Atlantis carries scarce advanced resources');
assert.equal(site.violations, 0, 'Atlantis never overwrites the sealed ocean bedrock basin');
assert.equal(typeof world.nearestAtlantis, 'function', 'world has a callable Atlantis finder');
const nearestAtlantis = world.nearestAtlantis(0,0,60000);
assert.ok(nearestAtlantis && Number.isFinite(nearestAtlantis.center), 'debug finder locates a generated Atlantis city');
assert.ok(nearestAtlantis.radius>=50 && nearestAtlantis.basin && nearestAtlantis.baseFloor>nearestAtlantis.sea,
  'debug finder returns enough Atlantis landing metadata');
const sameAtlantisFromLeft = world.nearestAtlantis(nearestAtlantis.left-50,1,2000);
assert.ok(sameAtlantisFromLeft && sameAtlantisFromLeft.cell===nearestAtlantis.cell,
  'directional Atlantis finder can target the same city from outside its edge');

const meduza = mobs._debugSpecies().ATLANTIS_MEDUZA;
assert.ok(meduza && mobs.species.includes('ATLANTIS_MEDUZA'), 'Atlantis meduza species is registered');
assert.equal(meduza.strictWater, true, 'Atlantis meduzas use strict water confinement');
assert.equal(meduza.alwaysAggro, true, 'Atlantis meduzas are active guardians');
assert.equal(meduza.contactCause, 'atlantis_meduza', 'Atlantis meduza damage has a distinct cause');
assert.equal(meduza.piranhaIgnore, true, 'piranhas do not erase Atlantis guardians before the player arrives');

let actualSpawn = null;
for(let x=site.minX-12; x<=site.maxX+12 && !actualSpawn; x++){
  const sealTop = WG.oceanSealTop(x);
  if(sealTop==null) continue;
  for(let y=WG.settings.seaLevel+1; y<sealTop; y++){
    if(meduza.spawnTest(x,y,world.getTile)){ actualSpawn = {x,y}; break; }
  }
}
assert.ok(actualSpawn, 'a generated Atlantis city offers valid meduza guard water');

let ordinaryOcean = null;
for(let x=-30000; x<=30000 && !ordinaryOcean; x+=3){
  if(Math.abs(x-actualSpawn.x)<300 || WG.oceanSealTop(x)==null) continue;
  const floor = WG.column(x).row;
  const y = Math.min(floor-4, WG.settings.seaLevel+5);
  if(world.getTile(x,y)===T.WATER && !meduza.spawnTest(x,y,world.getTile)) ordinaryOcean = {x,y};
}
assert.ok(ordinaryOcean, 'ordinary ocean water stays free of Atlantis meduza spawns');

const originalBiomeType = WG.biomeType;
const originalOceanBasinAt = WG.oceanBasinAt;
const originalRandom = Math.random;
let rnd = 987654321;
function seededRandom(){
  rnd = (Math.imul(rnd,1664525)+1013904223)>>>0;
  return rnd/4294967296;
}
function atlantisSea(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if((x===6 && y===13) || (x===7 && y===14)) return T.GLASS;
  if((x===8 && y===15) || (x===9 && y===16)) return T.OBSIDIAN;
  if(x===10 && y===15) return T.CHEST_EPIC;
  if(y>=10 && y<=18) return T.WATER;
  if(y>=19) return T.STONE;
  return T.AIR;
}
function ordinarySea(_x,y){
  y=Math.floor(y);
  if(y>=10 && y<=18) return T.WATER;
  if(y>=19) return T.STONE;
  return T.AIR;
}

try{
  Math.random = seededRandom;
  WG.biomeType = () => 5;
  WG.oceanBasinAt = () => ({left:-80,right:80,width:161});
  assert.equal(meduza.spawnTest(0,13,atlantisSea), true, 'meduzas spawn next to an Atlantis block signature');
  assert.equal(meduza.spawnTest(0,13,ordinarySea), false, 'meduzas reject ocean water without Atlantis structures');

  const player = {x:40,y:4,w:0.7,h:0.95,hp:100,maxHp:100,vx:0,vy:0,hpInvul:0};
  globalThis.player = player;
  globalThis.damageHero = () => {};
  mobs.clearAll();
  mobs.deserialize({
    v:4,
    list:[{id:'ATLANTIS_MEDUZA',x:0.5,y:9.45,vx:0,vy:-3,hp:28,maxHp:28,scale:1,speedMul:1,jumpMul:1,attackCd:3,waterTopY:10,desiredDepth:0}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  simNow += 80;
  mobs.update(0.08,player,atlantisSea,()=>{});
  const clamped = mobs.serialize().list.find(m=>m.id==='ATLANTIS_MEDUZA');
  assert.ok(clamped, 'strict-water meduza remains alive after a surface clamp');
  assert.equal(atlantisSea(Math.floor(clamped.x),Math.floor(clamped.y)), T.WATER, 'meduza is snapped back into water when it rises out');
  assert.ok(clamped.vy>=0, 'meduza upward velocity is cancelled at the water surface');

  const bites = [];
  globalThis.damageHero = (amount,opts)=>{ bites.push({amount,opts}); return true; };
  mobs.deserialize({
    v:4,
    list:[{id:'ATLANTIS_MEDUZA',x:0.5,y:13.4,vx:0,vy:0,hp:28,maxHp:28,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:3}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=0.5; player.y=13.4; player.hpInvul=0;
  simNow += 500;
  mobs.update(0.08,player,atlantisSea,()=>{});
  assert.ok(bites.length>=1, 'touching an Atlantis meduza damages a swimming hero');
  assert.equal(bites[0].opts.cause, 'atlantis_meduza', 'meduza contact damage uses its own cause');
} finally {
  Math.random = originalRandom;
  WG.biomeType = originalBiomeType;
  WG.oceanBasinAt = originalOceanBasinAt;
  delete globalThis.damageHero;
  mobs.clearAll();
}

console.log('atlantis-sim: all assertions passed');
