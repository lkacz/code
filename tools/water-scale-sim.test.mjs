// Deterministic Node test for LARGE-SCALE water behavior (no browser needed).
// Covers the ocean/lake-scale regressions the cell-level suite cannot see:
//   * a big walled lake draining through a floor breach into a cavern (bulk drain
//     must complete in seconds, not minutes, with no floating cells or water walls)
//   * a sealed 400-wide ocean with a massive left/right imbalance (must level flat
//     globally — the old windowed solver left full-block steps between its windows
//     and never converged)
//   * an ocean floor breached over a huge cavern (the far field must keep feeding
//     the drain via the surface band instead of freezing into drawdown cliffs)
// Also asserts the perf contract: worst single update() tick and worst pressure
// pass stay within loose wall-clock bounds (10x headroom over measured values).
// Run: node tools/water-scale-sim.test.mjs
import { strict as assert } from 'assert';
import { performance } from 'node:perf_hooks';

const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8,MUD:14,WIRE:23,STEAM:27,CLAY:65,WET_CLAY:66,BRICK:67};
globalThis.window = globalThis;
const WORLD_H = 140;
const WORLD_MIN_Y = -140;
const WORLD_MAX_Y = 280;
globalThis.MM = { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, TILE:20, particles:{ spawnSplash(){}, spawnBubble(){} } };

const { water } = await import('../src/engine/water.js');
assert.ok(water, 'water module exports');
const UNITS = water.UNITS;

// Dense typed-array world: string-keyed maps would dominate the runtime at this scale.
const X0=-100, X1=700, W=X1-X0, H=WORLD_MAX_Y-WORLD_MIN_Y;
const grid = new Uint8Array(W*H);
const idx=(x,y)=>(y-WORLD_MIN_Y)*W+(x-X0);
const getTile=(x,y)=>{ if(y<WORLD_MIN_Y||y>=WORLD_MAX_Y||x<X0||x>=X1) return T.STONE; return grid[idx(x,y)]; };
const setTile=(x,y,v)=>{ if(y>=WORLD_MIN_Y&&y<WORLD_MAX_Y&&x>=X0&&x<X1) grid[idx(x,y)]=v; };
const fillRect=(x0,x1,y0,y1,v)=>{ for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) setTile(x,y,v); };
function resetWorld(){ grid.fill(T.AIR); water.reset(); delete globalThis.player; }

const unitsAt=(x,yF,yT)=>{ let d=0; for(let y=yF;y<yT;y++) d+=water.levelAt(x,y,getTile); return d; };
function volume(){
  let v=0;
  for(let y=WORLD_MIN_Y;y<WORLD_MAX_Y;y++) for(let x=X0;x<X1;x++)
    if(grid[idx(x,y)]===T.WATER) v+=water.levelAt(x,y,getTile);
  return v;
}
// Wall-clock instrumented stepper: returns worst tick / worst pressure pass in ms.
function step(n){
  let worstTick=0, worstPress=0;
  for(let i=0;i<n;i++){
    const a=performance.now();
    water.update(getTile,setTile,1/60);
    const ms=performance.now()-a;
    if(ms>worstTick) worstTick=ms;
    const p=water.metrics().pressureMs;
    if(p>worstPress) worstPress=p;
  }
  return {worstTick, worstPress};
}
// Artifact audit. floating: water directly over air (transient during flow, must be
// zero at rest). stacked: a partial cell over water with headroom (a "wall of water"
// in the making). walls: adjacent columns whose surface runs overlap vertically
// (one connected surface) but sit >`tol` units apart. Columns on different sealed
// floors are legitimately at different levels and are not compared.
function audit(rx0,rx1,tol){
  const out={floating:0, stacked:0, maxWall:0};
  for(let y=WORLD_MIN_Y;y<WORLD_MAX_Y-1;y++) for(let x=X0;x<X1;x++){
    if(grid[idx(x,y)]!==T.WATER) continue;
    const below=getTile(x,y+1);
    if(below===T.AIR) out.floating++;
    else if(below===T.WATER && water.levelAt(x,y+1,getTile)<UNITS) out.stacked++;
  }
  let prev=null;
  for(let x=rx0;x<=rx1;x++){
    let run=null;
    for(let y=WORLD_MIN_Y;y<WORLD_MAX_Y;y++){
      if(getTile(x,y)===T.WATER){
        let bot=y; while(bot+1<WORLD_MAX_Y && getTile(x,bot+1)===T.WATER) bot++;
        run={top:y,bot,elev:(WORLD_MAX_Y-y)*UNITS-(UNITS-water.levelAt(x,y,getTile))};
        break;
      }
    }
    if(run && prev && run.top<=prev.bot && prev.top<=run.bot){
      const jump=Math.abs(run.elev-prev.elev);
      if(jump>out.maxWall) out.maxWall=jump;
    }
    prev=run;
  }
  assert.equal(out.floating, 0, `no floating water at rest (found ${out.floating})`);
  assert.equal(out.stacked, 0, `no stacked partial cells (found ${out.stacked})`);
  assert.ok(out.maxWall<=tol, `no wall of water on a connected surface (max step ${out.maxWall} units, tolerance ${tol})`);
  return out;
}

// --- 1. Walled lake (200x8 = 16000 units) drains through a 2-wide floor breach ---
// Cavern capacity 12000 units. The bulk drain used to take ~2 sim-minutes with a
// fixed 72-block/pass rate; body-scaled rates + drain-mouth feeding finish it in
// seconds. The remaining lake water must sit dead flat over the breach columns.
resetWorld();
fillRect(0,400,60,140,T.STONE);
fillRect(50,249,60,67,T.AIR);
fillRect(50,249,60,67,T.WATER);
fillRect(90,209,90,99,T.AIR);   // cavern 120x10
fillRect(150,151,68,89,T.AIR);  // breach shaft
globalThis.player={x:150,y:63};
water.onTileChanged(150,68,getTile);
water.onTileChanged(151,68,getTile);
const lakeVol=volume();
assert.equal(lakeVol, 16000, 'lake scenario volume');
const perf1=step(30*60); // 30 sim-seconds
assert.equal(volume(), lakeVol, 'lake drain conserves volume');
let cavern=0; for(let x=90;x<=209;x++) cavern+=unitsAt(x,90,100);
assert.ok(cavern>=11400, `cavern filled by the drain (${cavern}/12000 units in 30 sim-s)`);
audit(50,249,2);
audit(90,209,2);

// --- 2. Sealed 400-wide ocean levels a massive imbalance globally ---
// Left half 20 deep, right half 4 deep. The old solver leveled ±40-column windows
// and left full-block walls between them forever; the global path must produce one
// flat surface (within 1/10 block) across all 400 columns.
resetWorld();
fillRect(-2,420,100,140,T.STONE);
fillRect(-2,-1,40,99,T.STONE);
fillRect(400,420,40,99,T.STONE);
fillRect(0,199,80,99,T.WATER);
fillRect(200,399,96,99,T.WATER);
globalThis.player={x:200,y:85};
for(let x=0;x<400;x+=16) water.onTileChanged(x,98,getTile);
const oceanVol=volume();
const perf2=step(60*60); // 60 sim-seconds (measured: settles in ~13-18)
assert.equal(volume(), oceanVol, 'ocean leveling conserves volume');
const elevs=[];
for(let x=0;x<400;x++){
  for(let y=40;y<100;y++){
    if(getTile(x,y)===T.WATER){ elevs.push((100-y)*UNITS - (UNITS-water.levelAt(x,y,getTile))); break; }
  }
}
assert.equal(elevs.length, 400, 'every ocean column still holds water');
assert.ok(Math.max(...elevs)-Math.min(...elevs)<=1,
  `ocean surface flat to 1/10 block across 400 columns (spread ${Math.max(...elevs)-Math.min(...elevs)} units)`);
audit(0,399,1);

// --- 3. Ocean floor breach over a huge cavern: the far field keeps feeding the drain ---
// 400x10 ocean, 4-wide breach, 280x24 cavern below. The old behavior froze drawdown
// cliffs beside the breach (far columns only crept diffusively). Now >=90% of the
// water must reach the cavern within 60 sim-seconds; whatever remains on the old
// floor must be a smooth residual sheet, not a cliff.
resetWorld();
fillRect(-2,420,100,140,T.STONE);
fillRect(-2,-1,40,99,T.STONE);
fillRect(400,420,40,99,T.STONE);
fillRect(0,399,90,99,T.WATER);
fillRect(60,339,110,133,T.AIR);
fillRect(198,201,100,109,T.AIR);
globalThis.player={x:200,y:95};
water.onTileChanged(199,100,getTile);
water.onTileChanged(200,100,getTile);
const holeVol=volume();
assert.equal(holeVol, 40000, 'ocean-hole scenario volume');
const perf3=step(60*60); // 60 sim-seconds
assert.equal(volume(), holeVol, 'breach drain conserves volume');
let inCavern=0; for(let x=60;x<=339;x++) inCavern+=unitsAt(x,110,134);
assert.ok(inCavern>=holeVol*0.9, `bulk of the ocean reached the cavern (${inCavern}/${holeVol} units in 60 sim-s)`);
for(let x=0;x<400;x++){
  const sheet=unitsAt(x,85,100);
  assert.ok(sheet<=UNITS, `no perched bulk on the old ocean floor at x=${x} (${sheet} units)`);
}
// The residual sheet is still trickling at this snapshot: allow up to half a block
// of transient step. The artifact this guards against is the frozen multi-block
// drawdown cliff of the old solver (24 blocks tall).
audit(0,399,5);
audit(60,339,5);

// --- 4. Perf contract: loose wall-clock bounds (~10x headroom over measured) ---
// Measured on the dev machine: worst tick ~5ms during the initial ocean shock,
// worst pressure pass ~3ms (budgeted). These bounds catch order-of-magnitude
// regressions (e.g. reintroducing per-pass double flood fills) without being
// flaky on slower machines.
for(const [name,p] of [['lake',perf1],['ocean-level',perf2],['ocean-hole',perf3]]){
  assert.ok(p.worstTick<50, `${name}: worst update() tick within budget (${p.worstTick.toFixed(1)}ms)`);
  assert.ok(p.worstPress<30, `${name}: worst pressure pass within budget (${p.worstPress.toFixed(1)}ms)`);
}

console.log('OK: all large-scale water tests passed');
