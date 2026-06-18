// Deterministic Node test for the water simulation core (no browser needed).
// Verifies: gravity falls, waterfall stream events, basin filling, pressure leveling
// (flat surface), volume conservation, displacement, wave-spring API safety, and the
// pressure-flow regressions: flooding mined side tunnels, leveling under cave roofs,
// and passive wake-up at negative world coordinates.
// Run: node tools/water-sim.test.mjs
import { strict as assert } from 'assert';

const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8};
globalThis.window = globalThis; // water.js attaches to window.MM
globalThis.MM = { T, WORLD_H:140, TILE:20, particles:{ spawnSplash(){}, spawnBubble(){} } };

const { water } = await import('../src/engine/water.js');
assert.ok(water, 'water module exports');

// Sparse world: default bedrock below y=100, air above; supports negative x.
const H = 140;
let tiles;
function resetWorld(){ tiles = new Map(); water.reset(); delete globalThis.player; }
const getTile = (x,y)=>{ if(y<0||y>=H) return T.STONE; const v=tiles.get(x+','+y); return v===undefined ? (y>=100? T.STONE : T.AIR) : v; };
const setTile = (x,y,v)=>{ if(y>=0&&y<H) tiles.set(x+','+y,v); };
const countWater = ()=>{ let c=0; for(const v of tiles.values()) if(v===T.WATER) c++; return c; };
const step = (n)=>{ for(let i=0;i<n;i++) water.update(getTile,setTile,1/60); };
const depthAt = (x, yFrom, yTo)=>{ let d=0; for(let y=yFrom;y<yTo;y++) if(getTile(x,y)===T.WATER) d++; return d; };

// --- 1. Gravity: a lone unit falls to the floor ---
resetWorld();
assert.ok(water.addSource(60, 80, getTile, setTile), 'addSource places water');
step(300);
assert.equal(getTile(60,99), T.WATER, 'water landed on the floor');
assert.equal(countWater(), 1, 'volume conserved during fall');

// --- 2. Waterfall events: a tall drop registers a stream ---
resetWorld();
water.addSource(60, 60, getTile, setTile);
step(2); // first update performs the multi-cell drop
assert.ok(water.metrics().streams >= 1, 'tall drop produced a waterfall stream');

// --- 3. Basin fill + pressure leveling: pour into a carved pit, surface levels out flat ---
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR); // pit dug 5 deep into bedrock
const POURED = 70;
for(let i=0;i<POURED;i++){ water.addSource(90, 70, getTile, setTile); step(14); }
step(3000); // settle + leveling passes
assert.equal(countWater(), POURED, 'volume conserved through pour/spread/leveling');
const surf=[];
let pitVolume=0;
for(let x=80;x<100;x++){ const d=depthAt(x,95,105); surf.push(d); pitVolume+=d; }
const minD=Math.min(...surf), maxD=Math.max(...surf);
assert.ok(maxD-minD<=1, `surface level within 1 tile (got min=${minD} max=${maxD})`);
assert.ok(pitVolume>=POURED*0.9, `pit retained the pour (got ${pitVolume}/${POURED})`);

// --- 4. Uneven pool inside a pit levels out ---
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR);    // carved pit
for(let x=80;x<90;x++) for(let y=101;y<105;y++) setTile(x,y,T.WATER);   // left: 4 deep
for(let x=90;x<100;x++) setTile(x,104,T.WATER);                          // right: 1 deep
for(let x=80;x<100;x++) water.onTileChanged(x,102,getTile);
const before=countWater();
step(4000);
assert.equal(countWater(), before, 'leveling conserves volume');
const surf2=[];
for(let x=80;x<100;x++) surf2.push(depthAt(x,95,105));
assert.ok(Math.max(...surf2)-Math.min(...surf2)<=1, 'uneven pool leveled flat');

// --- 5. Displacement: a solid dropped into water pushes it out, not deletes it ---
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR);
for(let x=80;x<100;x++) for(let y=102;y<105;y++) setTile(x,y,T.WATER);
const beforeDisp=countWater();
assert.ok(water.displaceAt(90,104,getTile,setTile), 'displaceAt found an opening');
setTile(90,104,T.STONE); // the solid claims the cell
assert.equal(countWater()-1, beforeDisp-1, 'displaced unit preserved'); // -1: one cell is now stone
assert.equal(countWater(), beforeDisp, 'no water lost to displacement');

// --- 6. Mined side tunnel at depth floods to the pool's level (user-reported bug) ---
resetWorld();
for(let x=78;x<=112;x++) for(let y=92;y<100;y++) setTile(x,y,T.STONE);  // solid rock mass
for(let x=80;x<100;x++) for(let y=93;y<100;y++) setTile(x,y,T.AIR);     // carved basin (open above)
for(let x=80;x<100;x++) for(let y=94;y<100;y++) setTile(x,y,T.WATER);   // filled 6 deep (surface row 94)
// mine a 1-tall tunnel through the right wall at depth (row 98); roof and floor are stone
for(let x=100;x<=110;x++) setTile(x,98,T.AIR);
water.onTileChanged(100,98,getTile); // what main.js does after mining
const beforeTunnel=countWater();
step(6000);
assert.equal(countWater(), beforeTunnel, 'tunnel flood conserves volume');
for(let x=101;x<=110;x++) assert.equal(getTile(x,98), T.WATER, `tunnel cell x=${x} flooded`);
// pool surface dropped to compensate (11 cells moved out) but stays level
const surf3=[];
for(let x=80;x<100;x++) surf3.push(depthAt(x,90,100));
assert.ok(Math.max(...surf3)-Math.min(...surf3)<=1, 'pool stays level after feeding the tunnel');

// --- 7. Cave pool under a partial roof equalizes through side air paths ---
// Roof-capped columns beside a lower open pocket are NOT sealed: air enters sideways as
// they drain, so the whole pocket must end up at one level (≈58 units / 20 cols ≈ 3).
resetWorld();
for(let x=78;x<=102;x++) for(let y=90;y<100;y++) setTile(x,y,T.STONE);  // solid rock mass
for(let x=80;x<100;x++) for(let y=95;y<100;y++) setTile(x,y,T.AIR);     // cave pocket
for(let x=86;x<100;x++) setTile(x,94,T.AIR);                             // right part open (air above)
for(let x=80;x<86;x++) for(let y=95;y<100;y++) setTile(x,y,T.WATER);    // capped columns: full to the roof
for(let x=86;x<93;x++) for(let y=97;y<100;y++) setTile(x,y,T.WATER);    // open: 3 deep
for(let x=93;x<100;x++) setTile(x,99,T.WATER);                           // open: 1 deep (uneven)
const caveVol=countWater();
for(let x=86;x<100;x++) water.onTileChanged(x,98,getTile);
step(4000);
assert.equal(countWater(), caveVol, 'cave equalization conserves volume');
const caveSurf=[];
for(let x=80;x<100;x++) caveSurf.push(depthAt(x,94,100));
assert.ok(Math.max(...caveSurf)-Math.min(...caveSurf)<=1, `whole cave pocket leveled (got ${caveSurf.join(',')})`);

// --- 8. Passive wake-up works at negative world x ---
resetWorld();
globalThis.player = { x: -150 };          // passive scan sweeps around the player
setTile(-150, 50, T.WATER);                // stagnant floating water, never marked active
water.reset();                             // ensure nothing is in the active set
step(1200);                                // passive scan must find and drop it
assert.equal(getTile(-150,99), T.WATER, 'negative-x water woken passively and fell');
delete globalThis.player;

// --- 9. Newly generated chunk beside dormant water: boundary wake floods the new cave ---
resetWorld();
for(let x=78;x<=130;x++) for(let y=92;y<100;y++) setTile(x,y,T.STONE);  // rock mass
for(let x=80;x<100;x++) for(let y=93;y<100;y++) setTile(x,y,T.AIR);     // old basin
for(let x=80;x<100;x++) for(let y=94;y<100;y++) setTile(x,y,T.WATER);   // settled, fully dormant
// "world generation" carves a cave in the next chunk touching the basin wall — note:
// no onTileChanged calls, exactly like real chunk generation
for(let x=100;x<=120;x++) for(let y=96;y<100;y++) setTile(x,y,T.AIR);
water.noteChunkGenerated(100,163); // chunk boundary at x=100
step(8000);
const cave=[];
for(let x=101;x<=120;x++) cave.push(depthAt(x,90,100));
assert.ok(Math.min(...cave)>=1, `generated cave received water (depths ${cave.join(',')})`);
const allSurf=[];
for(let x=80;x<=120;x++) allSurf.push(depthAt(x,90,100));
// basin floor is 1 higher than cave floor: combined surface must still be level within 1
const tops=[];
for(let x=80;x<=120;x++){ let t=-1; for(let y=90;y<100;y++) if(getTile(x,y)===T.WATER){ t=y; break; } if(t>=0) tops.push(t); }
assert.ok(Math.max(...tops)-Math.min(...tops)<=1, `combined body level within 1 (tops ${Math.min(...tops)}..${Math.max(...tops)})`);

// --- 9b. Chunk seam wake must not generate further chunks while probing seams ---
// The browser regression was a self-propagating chain: noteChunkGenerated(cx)
// scanned x0-1 / x1+1 with the normal generating getTile(), which created the
// neighboring chunk, which queued another wake, and so on.
resetWorld();
const seamGetCalls=[];
const seamPeekCalls=[];
globalThis.MM.world = {
  peekTile(x,y,fallback){
    seamPeekCalls.push(x);
    return fallback===undefined ? T.AIR : fallback;
  }
};
water.noteChunkGenerated(100,163);
water.update((x,y)=>{ seamGetCalls.push(x); return getTile(x,y); }, setTile, 1/60);
assert.ok(seamPeekCalls.includes(99) && seamPeekCalls.includes(164), 'chunk wake probes seam columns with peekTile');
assert.equal(seamGetCalls.some(x=>x>=99 && x<=164), false, 'chunk wake does not force-load neighbor seam chunks');
delete globalThis.MM.world;

// --- 10. Suspended water layer over air self-heals with no notification at all ---
resetWorld();
globalThis.player = { x: 90 };
for(let x=85;x<95;x++) setTile(x,60,T.WATER); // floating band, air below, never woken
step(2000);
let stillFloating=false;
for(let x=85;x<95;x++) if(getTile(x,60)===T.WATER) stillFloating=true;
assert.ok(!stillFloating, 'suspended band collapsed via passive scan');
let landed=0; for(let x=70;x<=110;x++) landed+=depthAt(x,95,100);
assert.equal(landed, 10, 'all band water landed on the ground');
delete globalThis.player;

// --- 11. No corner-clipping: water must not spill diagonally through a solid wall ---
resetWorld();
for(let x=80;x<=90;x++) for(let y=80;y<100;y++) setTile(x,y,T.STONE);  // rock block
for(let y=80;y<=90;y++) setTile(85,y,T.WATER);                          // water-filled shaft
setTile(84,91,T.AIR);                                                    // sealed pocket, diagonal to shaft bottom
water.onTileChanged(85,90,getTile);
step(2000);
assert.equal(getTile(84,91), T.AIR, 'sealed diagonal pocket stays dry (no wall clipping)');

// --- 12. Pond drains across a shelf and over a far cliff (no perched bulk remains) ---
resetWorld();
for(let x=60;x<=95;x++) for(let y=90;y<100;y++) setTile(x,y,T.STONE);  // shelf, cliff at x=96
for(let y=85;y<=89;y++) setTile(69,y,T.STONE);                          // left retaining wall
for(let x=70;x<=80;x++) for(let y=86;y<=89;y++) setTile(x,y,T.WATER);  // 4-deep pond, right edge open
const pondVol=countWater();
water.onTileChanged(81,89,getTile);
step(9000);
assert.equal(countWater(), pondVol, 'shelf drain conserves volume');
let maxShelfDepth=0;
for(let x=70;x<=95;x++) maxShelfDepth=Math.max(maxShelfDepth, depthAt(x,80,95));
assert.ok(maxShelfDepth<=1, `pond bulk drained over the cliff (max remaining depth ${maxShelfDepth})`);
let overCliff=0; for(let x=96;x<=130;x++) overCliff+=depthAt(x,90,100);
assert.ok(overCliff>=pondVol*0.5, `most water went over the cliff (${overCliff}/${pondVol})`);

// --- 13. U-tube pressure: water poured into one arm RISES in the other until level ---
resetWorld();
for(let x=80;x<=92;x++) for(let y=70;y<100;y++) setTile(x,y,T.STONE);  // rock block
for(let y=72;y<=96;y++) setTile(82,y,T.AIR);                            // left arm (1-wide)
for(let y=72;y<=96;y++) setTile(90,y,T.AIR);                            // right arm (1-wide)
for(let x=82;x<=90;x++) setTile(x,97,T.AIR);                            // bottom channel
for(let y=75;y<=96;y++) setTile(82,y,T.WATER);                          // fill left arm
for(let x=82;x<=90;x++) setTile(x,97,T.WATER);                          // fill channel
const uVol=countWater();
water.onTileChanged(82,80,getTile);
step(8000);
assert.equal(countWater(), uVol, 'U-tube conserves volume');
const topOf=(x)=>{ for(let y=70;y<100;y++) if(getTile(x,y)===T.WATER) return y; return -1; };
const lTop=topOf(82), rTop=topOf(90);
assert.ok(rTop>=0, 'right arm received water');
assert.ok(Math.abs(lTop-rTop)<=1, `arms level within 1 (left top ${lTop}, right top ${rTop})`);
assert.ok(rTop<=88, `water rose high in the right arm (top ${rTop})`);

// --- 14. Passage to higher water: a lower gallery floods and rises toward the source level ---
resetWorld();
for(let x=70;x<=110;x++) for(let y=60;y<100;y++) setTile(x,y,T.STONE);
for(let x=72;x<=82;x++) for(let y=63;y<75;y++) setTile(x,y,T.AIR);      // upper reservoir basin
for(let x=72;x<=82;x++) for(let y=66;y<75;y++) setTile(x,y,T.WATER);    // filled to y=66
for(let y=75;y<=90;y++) setTile(80,y,T.AIR);                            // shaft down from the basin floor
setTile(80,75,T.WATER); // (carved through — water above will follow)
for(let x=81;x<=105;x++) for(let y=89;y<=90;y++) setTile(x,y,T.AIR);    // 2-tall lower gallery
for(let y=80;y<=88;y++) setTile(103,y,T.AIR);                            // riser at the gallery's far end
const pVol=countWater();
water.onTileChanged(80,76,getTile);
step(12000);
assert.equal(countWater(), pVol, 'gallery flood conserves volume');
for(let x=81;x<=102;x++) assert.equal(getTile(x,90), T.WATER, `gallery floor cell x=${x} flooded`);
// the riser must carry water upward — well above the gallery ceiling
let riserTop=-1; for(let y=78;y<=90;y++) if(getTile(103,y)===T.WATER){ riserTop=y; break; }
assert.ok(riserTop>=0 && riserTop<=87, `water rose in the riser (top ${riserTop})`);

// --- 14b. Surface-level cave mouth: a lake floods under an overhang, but not over open shore ---
resetWorld();
for(let x=40;x<=80;x++) for(let y=94;y<100;y++) setTile(x,y,T.WATER);   // broad reservoir
for(let y=94;y<100;y++) setTile(39,y,T.STONE);                          // closed left bank
for(let x=81;x<=86;x++) setTile(x,93,T.STONE);                          // roofed cave mouth at waterline
for(let x=81;x<=87;x++) for(let y=95;y<100;y++) setTile(x,y,T.STONE);    // one-tile-high mouth, not a drain
setTile(87,94,T.STONE);
const roofedVol=countWater();
water.onTileChanged(81,94,getTile);
step(8000);
assert.equal(countWater(), roofedVol, 'surface-mouth equalization conserves volume');
for(let x=81;x<=86;x++) assert.equal(getTile(x,94), T.WATER, `covered mouth surface x=${x} flooded`);

resetWorld();
for(let x=40;x<=80;x++) for(let y=94;y<100;y++) setTile(x,y,T.WATER);   // same reservoir
for(let y=94;y<100;y++) setTile(39,y,T.STONE);
for(let y=95;y<100;y++) setTile(81,y,T.STONE);                          // dry open shore shelf
const shoreVol=countWater();
water.onTileChanged(81,94,getTile);
step(3000);
assert.equal(countWater(), shoreVol, 'open shore guard conserves volume');
assert.equal(getTile(81,94), T.AIR, 'surface equalization does not crawl over an open dry shore');

// --- 14c. Wide enclosed lakes level globally, not as separate local pressure windows ---
resetWorld();
const wideL=50, wideR=140, wideSplit=81;
for(let y=80;y<115;y++){ setTile(wideL-1,y,T.STONE); setTile(wideR+1,y,T.STONE); }
for(let x=wideL;x<=wideSplit;x++) for(let y=84;y<115;y++) setTile(x,y,T.WATER);      // deep left half
for(let x=wideSplit+1;x<=wideR;x++) for(let y=107;y<115;y++) setTile(x,y,T.WATER);   // shallow right half
const wideVol=countWater();
for(let x=wideL;x<=wideR;x+=8) water.onTileChanged(x,100,getTile);
step(6000);
assert.equal(countWater(), wideVol, 'wide basin leveling conserves volume');
const wideTops=[];
for(let x=wideL;x<=wideR;x++){ const t=topOf(x); if(t>=0) wideTops.push(t); }
assert.ok(Math.max(...wideTops)-Math.min(...wideTops)<=1, `wide basin level within 1 (tops ${Math.min(...wideTops)}..${Math.max(...wideTops)})`);

// --- 14d. Overflow over a tree-trunk lip is not a submerged communicating pipe ---
resetWorld();
for(let x=44;x<=106;x++) setTile(x,100,T.STONE);
for(let y=88;y<=100;y++){ setTile(44,y,T.STONE); setTile(106,y,T.STONE); }
for(let y=94;y<=99;y++) setTile(60,y,T.WOOD); // trunk/lip separating the basins
for(let x=45;x<60;x++) for(let y=91;y<100;y++) setTile(x,y,T.WATER);    // narrow high basin
setTile(60,93,T.WATER);                                                 // the overflow tile above the trunk
for(let x=61;x<106;x++) for(let y=97;y<100;y++) setTile(x,y,T.WATER);   // wider lower basin
const lipVol=countWater();
water.onTileChanged(60,93,getTile);
step(7000);
assert.equal(countWater(), lipVol, 'tree-lip overflow conserves volume');
let leftMinDepth=Infinity;
for(let x=45;x<60;x++) leftMinDepth=Math.min(leftMinDepth, depthAt(x,88,100));
let rightMaxDepth=0;
for(let x=61;x<106;x++) rightMaxDepth=Math.max(rightMaxDepth, depthAt(x,88,100));
assert.ok(leftMinDepth>=6, `source basin remains at/above the trunk lip (min depth ${leftMinDepth})`);
assert.ok(rightMaxDepth<=5, `wide receiving basin only gets overflow above the lip (max depth ${rightMaxDepth})`);

// --- 15. Wave API safety: disturb/snapshot/restore never throw, reject junk ---
water.disturb(85, 200); water.disturb(85.7, -300); water.disturb(NaN, 50); water.disturb(10, Infinity);
const snap=water.snapshot();
assert.ok(snap && snap.v===2, 'snapshot v2');
water.restore(snap);
water.restore({v:1, active:[[1,2]], ripples:[{L:0,R:5,y:60,ttl:300}]}); // legacy save shape
water.restore(null); water.restore('garbage');

console.log('OK: all water simulation tests passed');
