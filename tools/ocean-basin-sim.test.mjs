// Ocean bedrock basin regression test.
// Real oceans must (a) dive far deeper than the legacy ~30-tile shelf, and
// (b) sit inside a hermetic bedrock basin: from a thin sediment bed under the
// sea floor down to the world bottom every column of a wide water segment is
// unmineable bedrock, so the only way across is over the water (boats).
// Ponds and small seas stay open underneath.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { CHUNK_W, WORLD_H, WORLD_MAX_Y, T } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { worldLayers } = await import('../src/engine/world_layers.js');
const { world } = await import('../src/engine/world.js');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

assert.equal(typeof WG.oceanBasinAt, 'function', 'worldgen exposes the ocean basin query');
assert.equal(typeof WG.oceanSealTop, 'function', 'worldgen exposes the seal-top query');
assert.ok(WG.OCEAN_SEAL_MIN_SPAN >= 60, 'seal threshold keeps ponds and small seas open underneath');
assert.match(mainSource, /function isOceanBasinBedrockAt\(tx,ty,t\)\{[\s\S]*WORLDGEN\.oceanSealTop/, 'main mining detects ocean basin bedrock jackets');
assert.match(mainSource, /Skała macierzysta pod oceanem jest nienaruszalna/, 'ocean basin bedrock has a dedicated unmineable reason');

function findRuns(sea, from, to){
  const runs = [];
  let start = null;
  for(let x=from; x<=to; x++){
    const water = WG.column(x).row > sea;
    if(water && start===null) start = x;
    else if(!water && start!==null){ runs.push({left:start, right:x-1, width:x-start}); start=null; }
  }
  if(start!==null) runs.push({left:start, right:to, width:to-start+1});
  return runs;
}

const seeds = [12345, 20260616, 42];
let sawDeepOcean = false;

for(const seed of seeds){
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  const sea = WG.settings.seaLevel;
  const runs = findRuns(sea, -14000, 14000);
  // Oceanic = wide AND predominantly open sea (biome 5); wide flooded inland
  // valleys are big lakes and must stay unsealed.
  const oceanFrac = r=>{
    let n=0; for(let x=r.left;x<=r.right;x++){ if(WG.column(x).biome===5) n++; }
    return n/r.width;
  };
  const oceans = runs.filter(r=>r.width >= WG.OCEAN_SEAL_MIN_SPAN && oceanFrac(r)>=0.6);
  const ponds  = runs.filter(r=>r.width >= 4 && r.width < WG.OCEAN_SEAL_MIN_SPAN*0.7);
  assert.ok(oceans.length >= 1, `seed ${seed}: at least one sealed-scale ocean exists in ±14k`);
  assert.ok(ponds.length >= 1, `seed ${seed}: small water bodies exist for the negative check`);

  // --- Every oceanic segment is a sealed basin; segment metadata is consistent ---
  const ocean = oceans.reduce((a,b)=>a.width>=b.width?a:b);
  const seg = WG.oceanBasinAt(Math.round((ocean.left+ocean.right)/2));
  assert.ok(seg, `seed ${seed}: wide water segment reports a sealed basin`);
  assert.ok(seg.width >= WG.OCEAN_SEAL_MIN_SPAN, `seed ${seed}: basin width above threshold`);

  // --- Depth: the basin floor dives far below the legacy shelf cap ---
  let deepest = 0;
  for(let x=seg.left; x<=seg.right; x++){
    const c = WG.column(x);
    if(c.row - sea > deepest) deepest = c.row - sea;
    assert.ok(c.row <= WORLD_H-16, `seed ${seed}: ocean floor stays above the basin clamp`);
  }
  if(deepest >= 40) sawDeepOcean = true;

  // --- Hermetic seal: sediment bed, then bedrock to the very world bottom ---
  const step = Math.max(1, Math.floor(seg.width/48));
  for(let x=seg.left; x<=seg.right; x+=step){
    const sealTop = WG.oceanSealTop(x);
    assert.ok(Number.isFinite(sealTop), `seed ${seed}: sealed column ${x} exposes a seal top`);
    assert.equal(sealTop, WG.column(x).row + WG.OCEAN_SEAL_SEDIMENT, `seed ${seed}: seal starts under a thin sediment bed`);
    // Surface section: every cell from the seal top to the section bottom is bedrock
    for(let y=sealTop; y<WORLD_H; y++){
      assert.equal(world.getTile(x,y), T.BEDROCK, `seed ${seed}: (${x},${y}) inside the basin jacket is bedrock`);
    }
    // Deep sections: the same seal continues to the absolute world bottom
    for(const y of [WORLD_H+1, WORLD_H+45, WORLD_H+90, WORLD_MAX_Y-8]){
      assert.equal(worldLayers.deepTile(WG,x,y), T.BEDROCK, `seed ${seed}: deep cell (${x},${y}) under the ocean is bedrock`);
    }
    // Water actually sits above the floor (this is an ocean, not a dry trench)
    const floor = WG.column(x).row;
    if(floor > sea+2){
      const t = world.getTile(x, Math.floor((sea+floor)/2));
      assert.ok(t===T.WATER || t===T.ICE, `seed ${seed}: basin column ${x} holds water above the floor`);
    }
  }

  // --- Negative: ponds/small seas are NOT sealed ---
  const pond = ponds[0];
  for(let x=pond.left; x<=pond.right; x++){
    assert.equal(WG.oceanBasinAt(x), null, `seed ${seed}: small water body at ${x} (w=${pond.width}) stays unsealed`);
  }

  // --- Land columns never report a basin ---
  const landRun = runs.length ? runs[0].left-6 : 0;
  if(WG.column(landRun).row <= sea) assert.equal(WG.oceanBasinAt(landRun), null, `seed ${seed}: land column has no basin`);
}

assert.ok(sawDeepOcean, 'at least one sampled ocean dives 40+ tiles deep (abyssal profile active)');

console.log('ocean-basin-sim: all assertions passed');
