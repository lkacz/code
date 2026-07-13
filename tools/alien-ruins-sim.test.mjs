// Deterministic Node test for alien ruin complexes.
// Run: node tools/alien-ruins-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
const localStore = new Map();
globalThis.localStorage = {
  getItem:k=>localStore.has(k) ? localStore.get(k) : null,
  setItem:(k,v)=>{ localStore.set(k,String(v)); },
  removeItem:k=>{ localStore.delete(k); },
  clear:()=>{ localStore.clear(); }
};
globalThis.msg = ()=>{};
globalThis.inv = {ufoConcrete:0};

const { T, INFO, CHUNK_W } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const {
  BUILD_MATERIAL_PROFILES,
  isBuildAnchorTile,
  isBuildFoundationTile,
  isBlastProtectedTile,
  isIridiumArrowPierceableTile,
  isMeteorImpactGroundTile,
  isMeteorProtectedTile,
  isPlayerBuiltMaterial,
  isRubbleTrackedMaterial,
  isStructuralMaterial
} = await import('../src/engine/material_physics.js');
const { alienRuins } = await import('../src/engine/alien_ruins.js');
const { world } = await import('../src/engine/world.js');
const { invasions } = await import('../src/engine/invasions.js');
const { weapons } = await import('../src/engine/weapons.js');
const { meteorites } = await import('../src/engine/meteorites.js');
const { fallingSolids } = await import('../src/engine/falling.js');

assert.ok(alienRuins && world && invasions, 'alien ruin modules export');

WG.worldSeed = 20260703;
WG.clearCaches && WG.clearCaches();
localStorage.clear();
alienRuins.reset();
alienRuins.clearCache();
invasions.reset();
world.clear();

// --- 1. Anchors: deterministic, land-only, spaced like a ruin system ---
const SPAN = 15000;
const list = alienRuins.anchorsInRange(-SPAN, SPAN);
assert.ok(list.length >= 18, 'a healthy scatter of alien ruins ('+list.length+' over '+(2*SPAN)+' columns)');
for(let i=1;i<list.length;i++) assert.ok(list[i].x - list[i-1].x >= 70, 'alien ruins keep their distance');
for(const a of list){
  const b = WG.biomeType(a.x);
  assert.ok(b!==5 && b!==6 && b!==8, 'alien ruins avoid seas/lakes/cities (biome '+b+' at '+a.x+')');
}
assert.deepEqual(alienRuins.anchorsInRange(-SPAN, SPAN), list, 'same seed gives identical anchor set');
WG.worldSeed = 777;
WG.clearCaches && WG.clearCaches();
alienRuins.clearCache();
assert.notDeepEqual(alienRuins.anchorsInRange(-SPAN, SPAN), list, 'different seed changes alien ruins');
WG.worldSeed = 20260703;
WG.clearCaches && WG.clearCaches();
alienRuins.clearCache();
world.clear();

// --- 2. Architecture invariants: tech in every complex, UFO concrete shell, surface hints ---
const sizes = {small:0, medium:0, large:0, mega:0};
const variants = new Set();
let chestBlocks = 0;
let withCommander = 0;
for(const a of list){
  const L = alienRuins.layoutFor(a.n);
  assert.ok(L, 'layout exists for anchor');
  sizes[L.size]++;
  variants.add(L.size+':'+L.variant);
  chestBlocks += L.ops.filter(o=>[T.CHEST_COMMON,T.CHEST_UNCOMMON,T.CHEST_RARE,T.CHEST_EPIC,T.CHEST_LEGENDARY].includes(o.t)).length;
  if(L.commanders && L.commanders.length) withCommander++;
  assert.ok(L.tier >= 1 && L.tier <= 4, 'alien ruin exposes a tier');
  assert.ok(L.tech.length >= 1, 'every alien ruin has at least one technological element');
  assert.ok(L.ops.some(o=>o.f===1 && o.t===T.UFO_CONCRETE), 'walls use UFO concrete');
  assert.ok(L.ops.some(o=>o.f===1 && o.t===T.AIR && o.y > WG.surfaceHeight(L.ax)+3), 'a hollow complex lies underground');
  assert.ok(L.ops.some(o=>o.f===0 && o.y < WG.surfaceHeight(o.x)), 'surface hints rise above the terrain');
  const effectiveForced = new Map();
  for(const o of L.ops) if(o.f===1) effectiveForced.set(o.x+','+o.y,o.t);
  const surf = WG.surfaceHeight(L.ax);
  let topThroatAir = Infinity;
  for(const [key,t] of effectiveForced){
    if(t!==T.AIR) continue;
    const c=key.indexOf(',');
    const x=Number(key.slice(0,c)), y=Number(key.slice(c+1));
    if((x===L.ax-1 || x===L.ax) && y>surf && y<surf+32) topThroatAir=Math.min(topThroatAir,y);
  }
  assert.ok(Number.isFinite(topThroatAir), 'alien ruin has an internal central throat');
  assert.equal(effectiveForced.get((L.ax-1)+','+(topThroatAir-1)), T.UFO_CONCRETE, 'left throat entry is sealed by UFO concrete');
  assert.equal(effectiveForced.get(L.ax+','+(topThroatAir-1)), T.UFO_CONCRETE, 'right throat entry is sealed by UFO concrete');
  assert.equal(L.hints.length, L.ops.filter(o=>o.f===0).length, 'hint cells mirror soft ops');
  assert.ok(L.hints.length >= 5, 'alien markers are visible enough to suggest something below');
  const width = L.maxX - L.minX;
  if(L.size === 'small') assert.ok(width <= 24, 'small alien probes stay compact ('+width+')');
  if(L.size === 'large') assert.ok(width >= 28, 'large alien vaults sprawl ('+width+')');
}
// --- 2b. Hermetic hull: any path into a vault must break UFO concrete ---
// Invariant: every forced non-concrete cell (carved air, glyphs, cables, tech,
// chests) is backed by forced ops on all 8 sides. First contact from untouched
// ground is therefore always concrete — dirt can never touch the interior.
const DIRS8=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function assertHermetic(L){
  const finalTiles=new Map();
  for(const o of L.ops) if(o.f===1) finalTiles.set(o.x+','+o.y,o.t);
  let interior=0;
  for(const [k,t] of finalTiles){
    if(t===T.UFO_CONCRETE) continue;
    interior++;
    const c=k.indexOf(',');
    const x=+k.slice(0,c), y=+k.slice(c+1);
    for(const [dx,dy] of DIRS8){
      assert.ok(finalTiles.has((x+dx)+','+(y+dy)),
        'hermetic hull: '+L.size+' vault n='+L.n+' cell '+k+' (t='+t+') leaks to raw ground at '+(x+dx)+','+(y+dy));
    }
  }
  assert.ok(interior>10, 'vault has an interior to protect ('+interior+')');
}
for(const a of list) assertHermetic(alienRuins.layoutFor(a.n));

assert.ok(sizes.small>0 && sizes.medium>0 && sizes.large>0, 'all main alien ruin tiers occur (S:'+sizes.small+' M:'+sizes.medium+' L:'+sizes.large+' XL:'+sizes.mega+')');
assert.ok(variants.size >= 5, 'alien architecture varies across variants ('+variants.size+')');
assert.equal(chestBlocks, 0, 'alien ruins contain no generated chest blocks');
assert.ok(withCommander >= 1, 'some alien ruins contain a golden commander marker');

let mega = null;
for(let n=0;n<8000 && !mega;n++){
  const L = alienRuins.layoutFor(n);
  if(L && L.size === 'mega') mega = L;
}
assert.ok(mega, 'a mega alien nexus exists within a wide scan');
assertHermetic(mega);
assert.ok(mega.maxX - mega.minX >= 44, 'mega nexus has impressive width ('+(mega.maxX-mega.minX)+')');
assert.equal(mega.ops.filter(o=>[T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC].includes(o.t)).length, 0, 'mega nexus carries no pre-placed chest blocks');
assert.ok(mega.tech.length >= 4, 'mega nexus has multiple tech nodes');

// --- 3. Materialization through the real world generator, including chunk borders ---
const larges = list.filter(a=>a.size==='large');
const spanning = larges.find(a=>Math.floor(a.minX/CHUNK_W)!==Math.floor(a.maxX/CHUNK_W)) || larges[0] || list[0];
assert.ok(spanning, 'found an alien ruin to inspect');
const L = alienRuins.layoutFor(spanning.n);
const expected = new Map();
for(const o of L.ops) if(o.f===1) expected.set(o.x+','+o.y,o.t);
let checked = 0;
for(const [k,t] of expected){
  const [x,y] = k.split(',').map(Number);
  assert.equal(world.getTile(x,y), t, 'forced alien ruin op materialized at '+k);
  checked++;
}
assert.ok(checked > 90, 'a real alien structure was carved ('+checked+' cells)');
let settledHints = 0;
const uniqueHintCells = new Set();
for(const o of L.ops){
  if(o.f!==0) continue;
  uniqueHintCells.add(o.x+','+o.y);
  if(world.getTile(o.x,o.y) === o.t) settledHints++;
}
assert.ok(settledHints >= Math.max(3, Math.floor(uniqueHintCells.size * 0.45)), 'enough soft alien surface hints settled visibly ('+settledHints+'/'+uniqueHintCells.size+')');
const ufoCells = [...expected].filter(([,t])=>t===T.UFO_CONCRETE).map(([k])=>k);
assert.ok(ufoCells.length > 20, 'inspected alien ruin has substantial UFO concrete shell');
fallingSolids.reset();
fallingSolids.init((x,y)=>world.getTile(x,y),(x,y,t)=>world.setTile(x,y,t));
const touchedChunks = [...new Set(ufoCells.map(k=>Math.floor(Number(k.slice(0,k.indexOf(','))) / CHUNK_W)))];
fallingSolids.auditChunks(touchedChunks,{force:true,immediate:true});
fallingSolids.settleAll();
for(const k of ufoCells){
  const [x,y] = k.split(',').map(Number);
  assert.equal(world.getTile(x,y), T.UFO_CONCRETE, 'UFO concrete shell does not collapse during falling audit at '+k);
}

// --- 4. UFO concrete policy: closed to mining, open to blasts/meteors/iridium arrows ---
assert.equal(INFO[T.UFO_CONCRETE].unmineable, true, 'UFO concrete blocks normal mining');
assert.ok(BUILD_MATERIAL_PROFILES[T.UFO_CONCRETE], 'UFO concrete has a structural profile');
assert.equal(isStructuralMaterial(T.UFO_CONCRETE), false, 'UFO concrete does not collapse through ordinary structural physics');
assert.equal(isPlayerBuiltMaterial(T.UFO_CONCRETE), false, 'UFO concrete is not claimed as player-built rubble');
assert.equal(isRubbleTrackedMaterial(T.UFO_CONCRETE), false, 'UFO concrete never becomes falling rubble');
assert.equal(isBuildAnchorTile(T.UFO_CONCRETE), true, 'UFO concrete still anchors nearby structures');
assert.equal(isBuildFoundationTile(T.UFO_CONCRETE), true, 'UFO concrete still acts as a solid footing');
assert.equal(isBlastProtectedTile(T.UFO_CONCRETE), false, 'explosions can destroy UFO concrete');
assert.equal(isMeteorProtectedTile(T.UFO_CONCRETE), false, 'meteor terrain jobs can destroy UFO concrete');
assert.equal(isMeteorImpactGroundTile(T.UFO_CONCRETE), true, 'meteors impact UFO concrete as ground');
assert.equal(isIridiumArrowPierceableTile(T.UFO_CONCRETE), true, 'iridium arrows can pierce UFO concrete');
{
  const cells = new Map([['0,0',T.UFO_CONCRETE], ['3,0',T.IRIDIUM]]);
  const getTile = (x,y)=>cells.get(Math.floor(x)+','+Math.floor(y)) ?? T.AIR;
  const setTile = (x,y,t)=>{ cells.set(Math.floor(x)+','+Math.floor(y),t); };
  const ok = weapons.explodeAt(0,0,getTile,setTile,{force:true});
  assert.equal(ok, true, 'gas explosion runs in test harness');
  assert.equal(cells.get('0,0'), T.AIR, 'explosion removes UFO concrete');
  assert.equal(globalThis.inv.ufoConcrete, 1, 'destroyed UFO concrete yields summon material');
  assert.equal(cells.get('3,0'), T.IRIDIUM, 'explosion still preserves protected iridium');
}
{
  const before = globalThis.inv.ufoConcrete;
  const cells = new Map([['0,5',T.UFO_CONCRETE]]);
  const getTile = (x,y)=>cells.get(Math.floor(x)+','+Math.floor(y)) ?? T.AIR;
  const setTile = (x,y,t)=>{ cells.set(Math.floor(x)+','+Math.floor(y),t); };
  const ops = [{phase:0,x:0,y:5,t:T.AIR,d:0,place:false}];
  assert.equal(meteorites.impactAt(0,5,getTile,setTile,1,ops,{classId:'iron',surfaceY:5,skipActorDamage:true}), true, 'meteor crater pipeline can hit UFO concrete');
  assert.equal(cells.get('0,5'), T.AIR, 'meteor impact removes UFO concrete');
  assert.equal(globalThis.inv.ufoConcrete, before+1, 'meteor-destroyed UFO concrete also yields summon material');
}

// --- 5. Commander runtime: only event-triggered, spawned through invasions ---
let withCmd = null;
for(let n=-5000;n<=5000 && !withCmd;n++){
  const X = alienRuins.layoutFor(n);
  if(X && X.commanders && X.commanders.length) withCmd = X;
}
assert.ok(withCmd, 'found alien ruin with commander marker');
world.clear();
invasions.reset();
alienRuins.reset();
localStorage.clear();
const c = withCmd.commanders[0];
world.getTile(Math.floor(c.x),Math.floor(c.y));
const player = {x:c.x, y:c.y, hp:100, maxHp:100, xp:2500};
alienRuins.update(1,player,world.getTile,world.setTile,{});
let team = invasions._debug.teams.find(t=>t && t.ruinCommanderKey === c.key);
assert.ok(team, 'alien ruin wakes a commander team');
assert.equal(team.state, 'active', 'ruin commander spawns active, without a landing sequence');
assert.equal(team.aliens.length, 1, 'ruin commander is a lone guardian');
assert.equal(team.aliens[0].role, 'commander', 'spawned alien is the golden commander role');
assert.ok(team.aliens[0].maxHp >= 60, 'commander has boss-like health scaling');
alienRuins.update(1,player,world.getTile,world.setTile,{});
assert.equal(invasions._debug.teams.filter(t=>t && t.ruinCommanderKey === c.key).length, 1, 'commander marker does not spawn duplicates');
world.clear();
invasions.reset();
alienRuins.reset();
localStorage.clear();
MM.guardianLairs = {status:()=>({defeated:{fire:false, ice:true}})};
alienRuins.update(1,player,world.getTile,world.setTile,{});
assert.equal(invasions._debug.teams.filter(t=>t && t.ruinCommanderKey === c.key).length, 0, 'alien ruin commanders stop waking after the western ice guardian is defeated');
delete MM.guardianLairs;

console.log('alien-ruins-sim: all assertions passed (S:'+sizes.small+' M:'+sizes.medium+' L:'+sizes.large+' C:'+withCommander+')');
