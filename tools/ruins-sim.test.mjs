// Deterministic Node test for the buried-ruin system (no browser needed).
// Verifies: seeded anchor placement (deterministic per world seed, different
// across seeds, never under seas/lakes), the three size classes with their
// invariants (every ruin hides treasure underground and leaves subtle stone
// hints on the surface; large temples add an obsidian vault with an epic chest
// and diamond studs), exact materialization through real chunk generation —
// including ruins that span chunk borders — and identical regeneration after
// the world cache is cleared.
// Run: node tools/ruins-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // engine modules attach to window.MM
globalThis.MM = {};

const { T, CHUNK_W } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { ruins } = await import('../src/engine/ruins.js');
const { world } = await import('../src/engine/world.js');
assert.ok(ruins && world, 'modules export');

WG.worldSeed = 20260611; WG.clearCaches && WG.clearCaches();
ruins.clearCache(); world.clear();

// --- 1. Anchors: present, spaced, deterministic, seed-sensitive, dry-land only ---
const SPAN = 9000;
const list = ruins.anchorsInRange(-SPAN, SPAN);
assert.ok(list.length >= 20, 'a healthy scatter of ruins ('+list.length+' over '+(2*SPAN)+' columns)');
for(let i=1;i<list.length;i++) assert.ok(list[i].x - list[i-1].x >= 60, 'ruins keep their distance');
for(const a of list){ const b=WG.biomeType(a.x); assert.ok(b!==5 && b!==6, 'no ruins under seas/lakes (biome '+b+' at '+a.x+')'); }
const again = ruins.anchorsInRange(-SPAN, SPAN);
assert.deepEqual(again, list, 'same seed → identical anchor set');
// seed flips must flush worldgen's noise caches too (the game does the same
// via WG.clearCaches on seed change), or stale values poison later asserts
WG.worldSeed = 777; WG.clearCaches && WG.clearCaches(); ruins.clearCache();
const other = ruins.anchorsInRange(-SPAN, SPAN);
assert.ok(JSON.stringify(other) !== JSON.stringify(list), 'different seed → different ruins');
WG.worldSeed = 20260611; WG.clearCaches && WG.clearCaches(); ruins.clearCache(); world.clear();

// --- 2. Size classes, variants and per-ruin invariants ---
const sizes = { small:0, medium:0, large:0, mega:0 };
const variants = new Set();
for(const a of list){
  const L = ruins.layoutFor(a.n);
  sizes[L.size]++; variants.add(L.size+':'+L.variant);
  assert.ok(L.chests >= 1, 'every ruin hides at least one chest');
  const surfAtAx = WG.surfaceHeight(L.ax);
  assert.ok(L.ops.some(o=>o.f===1 && o.t===T.AIR && o.y > surfAtAx+2), 'a hollow lies underground');
  assert.ok(L.ops.some(o=>o.f===0 && o.y < WG.surfaceHeight(o.x)), 'subtle hints rise above the surface');
  assert.equal(L.hints.length, L.ops.filter(o=>o.f===0).length, 'hint cells mirror the soft ops (drawHints dressing)');
  assert.ok(L.hints.length >= 2, 'markers are substantial enough to spot');
  const w = L.maxX - L.minX;
  if(L.size==='small') assert.ok(w <= 14, 'small ruins stay tiny ('+w+')');
  if(L.size==='large'){
    assert.ok(w >= 14, 'large ruins sprawl ('+w+')');
    assert.ok(L.ops.some(o=>o.t===T.CHEST_EPIC), 'temple treasure room holds an epic chest');
    if(L.variant==='vault'){
      assert.ok(L.ops.some(o=>o.t===T.OBSIDIAN), 'vault is sealed in obsidian');
      assert.ok(L.ops.filter(o=>o.t===T.DIAMOND).length >= 2, 'vault is studded with diamonds');
    }
    if(L.variant==='lavaAltar') assert.ok(L.ops.some(o=>o.t===T.LAVA), 'altar rises from a lava moat');
    if(L.variant==='flooded') assert.ok(L.ops.some(o=>o.t===T.WATER), 'reliquary is flooded');
    assert.ok(L.maxY - surfAtAx >= 18, 'temple reaches deep');
  }
}
assert.ok(sizes.small>0 && sizes.medium>0 && sizes.large>0,
  `all main size classes occur (S:${sizes.small} M:${sizes.medium} L:${sizes.large} XL:${sizes.mega})`);
assert.ok(variants.size >= 5, 'architecture varies ('+variants.size+' distinct size:variant pairs)');

// --- 2b. The Buried City (1 in 100): deep, vast, lit, and worth the dig ---
let mega=null;
for(let n2=0; n2<6000 && !mega; n2++){ const L2=ruins.layoutFor(n2); if(L2 && L2.size==='mega') mega=L2; }
assert.ok(mega, 'a buried city exists within the scanned span');
const megaSurf = WG.surfaceHeight(mega.ax);
const cityTop = Math.min(...mega.ops.filter(o=>o.f===1 && o.t===T.AIR && o.y>megaSurf+5).map(o=>o.y));
assert.ok(cityTop - megaSurf >= 25 || cityTop >= 96, 'the city lies DEEP ('+(cityTop-megaSurf)+' below the surface)');
assert.ok(mega.maxX - mega.minX >= 44, 'a vast cavern ('+(mega.maxX-mega.minX)+' wide)');
assert.ok(mega.ops.filter(o=>o.t===T.CHEST_EPIC).length >= 2, 'the ziggurat hides multiple epic chests');
assert.ok(mega.ops.filter(o=>o.t===T.TORCH).length >= 8, 'the city is torch-lit for the reveal');
assert.ok(mega.ops.filter(o=>o.t===T.STONE_DOOR).length >= 2, 'the city tower entrances use structural stone doors');
assert.ok(mega.ops.some(o=>o.t===T.LAVA), 'a lava moat glows in the dark');
assert.ok(mega.ops.filter(o=>o.t===T.DIAMOND).length >= 4, 'crystal garden + studded vault sparkle');
assert.ok(mega.ops.some(o=>o.f===0 && o.t===T.OBSIDIAN && o.y < WG.surfaceHeight(o.x)), 'an obsidian monolith marks it on the surface');
const megaShare = sizes.mega + (list.some(a=>a.n===mega.n)? 0 : 0); // sanity only
assert.ok(megaShare <= Math.max(1, list.length*0.05), 'cities stay extremely rare');

// --- 3. Materialization through real chunk generation (exact, cross-chunk) ---
// pick a large ruin that spans a chunk border, if any; else the widest large
const larges = list.filter(a=>a.size==='large');
const spanning = larges.find(a=>Math.floor(a.minX/CHUNK_W)!==Math.floor(a.maxX/CHUNK_W)) || larges[0];
assert.ok(spanning, 'found a large ruin to inspect');
const L = ruins.layoutFor(spanning.n);
// expected final tile per cell: ops in order, later ops win
const expected = new Map();
for(const o of L.ops){ if(o.f===1) expected.set(o.x+','+o.y, o.t); }
let checked=0;
for(const [k,t] of expected){
  const [x,y]=k.split(',').map(Number);
  assert.equal(world.getTile(x,y), t, 'forced op materialized at '+k);
  checked++;
}
assert.ok(checked > 80, 'a real structure was carved ('+checked+' cells)');
// soft hints: with no trees in this Node world, all of them settle
for(const o of L.ops){ if(o.f===0) assert.equal(world.getTile(o.x,o.y), o.t, 'hint settled at '+o.x+','+o.y); }

// --- 4. Regeneration: clearing the world rebuilds the exact same ruin ---
const snapshot=[];
for(let x=L.minX;x<=L.maxX;x++) for(let y=L.minY;y<=L.maxY;y++) snapshot.push(world.getTile(x,y));
world.clear();
let i2=0, same=true;
for(let x=L.minX;x<=L.maxX;x++) for(let y=L.minY;y<=L.maxY;y++){ if(world.getTile(x,y)!==snapshot[i2++]){ same=false; break; } }
assert.ok(same, 'regenerated chunks rebuild the identical ruin');

// --- 5. Treasure really reachable: a chest tile exists inside the ruin body ---
let chestSeen=0;
for(let x=L.minX;x<=L.maxX;x++) for(let y=L.minY;y<=L.maxY;y++){
  const t=world.getTile(x,y);
  if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC) chestSeen++;
}
assert.ok(chestSeen>=1, 'treasure sits in the generated world ('+chestSeen+' chests)');

// --- 5b. nearest(): debug teleports hop to the right anchors ---
const mid=list[Math.floor(list.length/2)];
const right=ruins.nearest(mid.x, 1, null);
assert.ok(right && right.x>mid.x, 'nearest(+1) lands strictly to the right');
assert.equal(right.x, list.find(a=>a.x>mid.x+2).x, 'nearest(+1) is the very next ruin');
const left=ruins.nearest(mid.x, -1, null);
assert.ok(left && left.x<mid.x, 'nearest(-1) lands strictly to the left');
const nm=ruins.nearest(0, 1, 'mega');
assert.ok(nm && nm.size==='mega', 'nearest finds a mega city within its wide horizon');
const nl=ruins.nearest(0, 1, 'large');
assert.ok(nl && nl.size==='large', 'nearest filters by size class');

// --- 6. Layout generation stays cheap ---
ruins.clearCache();
const t0=Date.now();
for(let n=-120;n<=120;n++) ruins.layoutFor(n);
const ms=Date.now()-t0;
assert.ok(ms < 500, 'layouts for 241 cells generated quickly ('+ms+'ms)');

console.log('ruins-sim: all assertions passed (S:'+sizes.small+' M:'+sizes.medium+' L:'+sizes.large+')');
