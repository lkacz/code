// Deterministic Node test for the water simulation core (no browser needed).
// The sim tracks sub-tile fill levels (UNITS=10 per block): volume is measured in
// units of 1/10 block and conservation is exact in those units. Verifies: gravity
// falls, waterfall stream events, basin filling, hydrostatic pressure leveling to a
// flat sub-tile surface, thin-film spreading (no stranded single blocks or walls of
// water), volume conservation, displacement, wave-spring API safety, and the
// pressure-flow regressions: flooding mined side tunnels, leveling under cave roofs,
// and passive wake-up at negative world coordinates.
// Run: node tools/water-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

const T = {AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7,WATER:8,MUD:14,WIRE:23,STEAM:27,CLAY:65,WET_CLAY:66,BRICK:67};
globalThis.window = globalThis; // water.js attaches to window.MM
const WORLD_H = 140;
const WORLD_MIN_Y = -140;
const WORLD_MAX_Y = 280;
// waterDeterministicPressureBudget: the leveling pass normally stops early past a
// 3ms wall-clock budget and (since the fair-sweep cursor) resumes ROTATED — which
// body gets solver attention then depends on machine load, so convergence-rate
// assertions (e.g. "shore settles within 12000 steps") become load-flaky. The flag
// disables only the wall-clock stop (EQ_BODIES still applies), making every pass
// deterministic — same convention as water-scale-sim.test.mjs.
globalThis.MM = { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, TILE:20, waterDeterministicPressureBudget:true, particles:{ spawnSplash(){}, spawnBubble(){} } };

const { water } = await import('../src/engine/water.js');
assert.ok(water, 'water module exports');

// Sparse world: default bedrock below y=100, air above; supports negative x.
let tiles;
function resetWorld(){ tiles = new Map(); water.reset(); delete globalThis.player; }
const getTile = (x,y)=>{ if(y<WORLD_MIN_Y||y>=WORLD_MAX_Y) return T.STONE; const v=tiles.get(x+','+y); return v===undefined ? (y>=100? T.STONE : T.AIR) : v; };
const setTile = (x,y,v)=>{ if(y>=WORLD_MIN_Y&&y<WORLD_MAX_Y) tiles.set(x+','+y,v); };
const UNITS = water.UNITS;
assert.equal(UNITS, 10, 'water exposes 1/10-block sub-tile granularity');
const countWater = ()=>{ let c=0; for(const v of tiles.values()) if(v===T.WATER) c++; return c; };
const countTile = tile=>{ let c=0; for(const v of tiles.values()) if(v===tile) c++; return c; };
// Total water volume in units of 1/10 block — the sim's exact conservation currency.
const volume = ()=>{
  let v=0;
  for(const [key,val] of tiles){
    if(val!==T.WATER) continue;
    const c=key.indexOf(',');
    v+=water.levelAt(+key.slice(0,c),+key.slice(c+1),getTile);
  }
  return v;
};
const step = (n)=>{ for(let i=0;i<n;i++) water.update(getTile,setTile,1/60); };
const depthAt = (x, yFrom, yTo)=>{ let d=0; for(let y=yFrom;y<yTo;y++) if(getTile(x,y)===T.WATER) d++; return d; };
// Column depth in sub-tile units — measures true water volume per column.
const unitsAt = (x, yFrom, yTo)=>{ let d=0; for(let y=yFrom;y<yTo;y++) d+=water.levelAt(x,y,getTile); return d; };

// --- 1. Gravity + thin-film spreading: a lone block falls, then relaxes into a puddle ---
// A single block of water on open flat ground must not survive as a square lump: it
// spreads into a shallow sub-tile film whose neighboring columns differ by <=1 unit.
resetWorld();
assert.ok(water.addSource(60, 80, getTile, setTile), 'addSource places water');
step(300);
assert.equal(getTile(60,99), T.WATER, 'water landed on the floor');
assert.equal(volume(), UNITS, 'volume conserved during fall and spread');
assert.ok(countWater()>=3, `single block spread into a film (${countWater()} cells)`);
for(let x=50;x<70;x++){
  const a=water.levelAt(x,99,getTile), b=water.levelAt(x+1,99,getTile);
  if(a>0 && b>0) assert.ok(Math.abs(a-b)<=1, `film is smooth at x=${x} (${a} vs ${b})`);
  assert.ok(water.levelAt(x,99,getTile)<UNITS, `no full square lump remains at x=${x}`);
}

resetWorld();
assert.ok(WORLD_MIN_Y<0 && WORLD_MAX_Y>WORLD_H, 'water tests cover extended vertical sections');
for(let x=10; x<=14; x++) setTile(x,-10,T.STONE);
assert.ok(water.addSource(12,-11,getTile,setTile), 'sky-layer water source is accepted');
step(10);
assert.equal(getTile(12,-11), T.WATER, 'sky-layer water rests on a sky-island surface');
let skySnap=water.snapshot();
assert.ok(skySnap.active.some(([x,y])=>x===12 && y===-11), 'water snapshot preserves sky-layer active cells');
water.reset();
water.restore(skySnap);
assert.ok(water._debug().active.includes('12,-11'), 'water restore rehydrates sky-layer active cells');

resetWorld();
for(let y=WORLD_H+5; y<=WORLD_H+12; y++) setTile(18,y,T.AIR);
setTile(18,WORLD_H+13,T.STONE);
assert.ok(water.addSource(18,WORLD_H+5,getTile,setTile), 'deep-layer water source is accepted');
step(300);
assert.equal(getTile(18,WORLD_H+12), T.WATER, 'deep-layer water falls to the local deep floor');

resetWorld();
for(let y=45;y<=51;y++){ setTile(-1,y,T.STONE); setTile(1,y,T.STONE); }
setTile(0,51,T.STONE);
setTile(0,50,T.WIRE);
assert.ok(water.addSource(0,45,getTile,setTile), 'water source above passable wiring is accepted');
step(4);
assert.equal(getTile(0,50),T.WIRE,'falling water does not overwrite passable wiring');
assert.equal(getTile(0,49),T.WATER,'falling water rests above passable wiring when no lower opening exists');

// --- 2. Waterfall events: a tall drop registers a stream ---
resetWorld();
water.addSource(60, 60, getTile, setTile);
step(2); // first update performs the multi-cell drop
assert.ok(water.metrics().streams >= 1, 'tall drop produced a waterfall stream');

// --- 3. Basin fill + pressure leveling: pour into a carved pit, surface levels out flat ---
// 70 blocks over 20 columns = 35 units per column: 3 full rows and a 5/10 surface row.
// The whole basin must end at one sub-tile level, not merely within one whole tile.
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR); // pit dug 5 deep into bedrock
const POURED = 70;
for(let i=0;i<POURED;i++){ water.addSource(90, 70, getTile, setTile); step(14); }
step(3000); // settle + leveling passes
assert.equal(volume(), POURED*UNITS, 'volume conserved through pour/spread/leveling');
const surfU=[];
let pitUnits=0;
for(let x=80;x<100;x++){ const d=unitsAt(x,95,105); surfU.push(d); pitUnits+=d; }
const minU=Math.min(...surfU), maxU=Math.max(...surfU);
assert.ok(maxU-minU<=1, `basin surface flat to 1/10 block (got min=${minU} max=${maxU} units)`);
assert.ok(pitUnits>=POURED*UNITS*0.9, `pit retained the pour (got ${pitUnits}/${POURED*UNITS} units)`);

// --- 4. Uneven pool inside a pit levels out to one sub-tile surface ---
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR);    // carved pit
for(let x=80;x<90;x++) for(let y=101;y<105;y++) setTile(x,y,T.WATER);   // left: 4 deep
for(let x=90;x<100;x++) setTile(x,104,T.WATER);                          // right: 1 deep
for(let x=80;x<100;x++) water.onTileChanged(x,102,getTile);
const before=volume();
step(4000);
assert.equal(volume(), before, 'leveling conserves volume');
const surf2=[];
for(let x=80;x<100;x++) surf2.push(unitsAt(x,95,105));
assert.ok(Math.max(...surf2)-Math.min(...surf2)<=1, `uneven pool leveled flat to 1/10 block (got ${surf2.join(',')})`);

// --- 5. Displacement: a solid dropped into water pushes it out, not deletes it ---
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR);
for(let x=80;x<100;x++) for(let y=102;y<105;y++) setTile(x,y,T.WATER);
const beforeDispVol=volume();
assert.ok(water.displaceAt(90,104,getTile,setTile), 'displaceAt found an opening');
setTile(90,104,T.STONE); // the solid claims the cell
assert.equal(volume(), beforeDispVol, 'no water lost to displacement');

// --- 6. Mined side tunnel at depth floods to the pool's level (user-reported bug) ---
resetWorld();
for(let x=78;x<=112;x++) for(let y=92;y<100;y++) setTile(x,y,T.STONE);  // solid rock mass
for(let x=80;x<100;x++) for(let y=93;y<100;y++) setTile(x,y,T.AIR);     // carved basin (open above)
for(let x=80;x<100;x++) for(let y=94;y<100;y++) setTile(x,y,T.WATER);   // filled 6 deep (surface row 94)
// mine a 1-tall tunnel through the right wall at depth (row 98); roof and floor are stone
for(let x=100;x<=110;x++) setTile(x,98,T.AIR);
water.onTileChanged(100,98,getTile); // what main.js does after mining
const beforeTunnel=volume();
step(6000);
assert.equal(volume(), beforeTunnel, 'tunnel flood conserves volume');
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
const caveVol=volume();
for(let x=86;x<100;x++) water.onTileChanged(x,98,getTile);
step(4000);
assert.equal(volume(), caveVol, 'cave equalization conserves volume');
const caveSurf=[];
for(let x=80;x<100;x++) caveSurf.push(depthAt(x,94,100));
assert.ok(Math.max(...caveSurf)-Math.min(...caveSurf)<=1, `whole cave pocket leveled (got ${caveSurf.join(',')})`);

// --- 8a. Passive scans are time-cadenced, not tied to every render tick ---
resetWorld();
globalThis.player = { x: 0 };
water.update(getTile, setTile, 1/60);
assert.equal(water.metrics().passiveScanColumns, 0, 'short idle frame does not run passive scan');
for(let i=0;i<7;i++) water.update(getTile, setTile, 1/60);
assert.ok(water._debug().passiveScanTotalColumns > 0, 'passive scan still runs on its simulation cadence');
water.update(getTile, setTile, 2);
assert.ok(water._debug().passiveScanLastColumns <= 64*3, 'large dt catch-up is bounded');
delete globalThis.player;

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
let landed=0; for(let x=20;x<=160;x++) landed+=unitsAt(x,95,100);
assert.equal(landed, 10*UNITS, 'all band water landed on the ground (film spread included)');
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
const pondVol=volume();
water.onTileChanged(81,89,getTile);
step(9000);
assert.equal(volume(), pondVol, 'shelf drain conserves volume');
let maxShelfUnits=0;
for(let x=70;x<=95;x++) maxShelfUnits=Math.max(maxShelfUnits, unitsAt(x,80,95));
assert.ok(maxShelfUnits<=UNITS, `pond bulk drained over the cliff (max remaining depth ${maxShelfUnits} units)`);
let overCliff=0; for(let x=96;x<=130;x++) overCliff+=unitsAt(x,90,100);
assert.ok(overCliff>=pondVol*0.5, `most water went over the cliff (${overCliff}/${pondVol} units)`);

// --- 12a. A freshly opened shelf flow reacts on the next simulation tick ---
resetWorld();
setTile(74,75,T.STONE);
setTile(74,76,T.STONE);
for(let x=75;x<=85;x++) setTile(x,76,T.STONE);                          // flat shelf, open drop at x=86
for(let x=75;x<=80;x++) setTile(x,75,T.WATER);                           // settled shallow pond
const shelfVol=volume();
water.onTileChanged(81,75,getTile);                                      // player mined/placed beside the pond
step(1);
assert.equal(volume(), shelfVol, 'instant shelf wake conserves volume');
assert.ok(getTile(81,75)===T.WATER || getTile(82,75)===T.WATER, 'water begins advancing sideways on the first tick after an edit');

// --- 12b. Vertical drain mouths pull neighboring water instead of leaving surface gaps ---
resetWorld();
for(let x=78;x<=82;x++) for(let y=71;y<100;y++) setTile(x,y,T.STONE);
for(let y=71;y<100;y++) setTile(80,y,T.AIR);                            // narrow shaft through the floor
setTile(79,70,T.WATER);
setTile(80,70,T.WATER);
setTile(81,70,T.WATER);
const shaftVol=volume();
water.onTileChanged(80,70,getTile);
step(1);
assert.equal(volume(), shaftVol, 'shaft-mouth pull conserves volume');
let shaftLowered=false; for(let y=71;y<100;y++) if(getTile(80,y)===T.WATER) shaftLowered=true;
assert.equal(shaftLowered, true, 'source water transfers downward through the shaft immediately');
assert.equal(getTile(80,70), T.WATER, 'shaft mouth is refilled by neighboring water instead of staying as a surface gap');
let shaftTopWater=0; for(const x of [79,80,81]) if(getTile(x,70)===T.WATER) shaftTopWater++;
assert.ok(shaftTopWater>=1 && shaftTopWater<=2, 'refilling the drain mouth keeps the shaft mouth wet while flow starts downward');

// --- 12c. Side drain inlets close first, then fall, instead of diagonal-skipping the mouth ---
resetWorld();
for(let x=72;x<=79;x++) setTile(x,75,T.STONE);
for(let x=72;x<=79;x++) setTile(x,74,T.WATER);                           // shallow pond beside a vertical drop
const inletVol=volume();
water.onTileChanged(80,74,getTile);
step(1);
assert.equal(volume(), inletVol, 'side drain inlet conserves volume');
assert.equal(getTile(80,74), T.WATER, 'water fills the open shaft mouth before falling down it');
assert.equal(getTile(80,75), T.AIR, 'first response closes the surface gap rather than skipping diagonally downward');
step(80);
assert.ok(depthAt(80,76,100)>0, 'refilled shaft mouth then transfers water downward');

// --- 13. U-tube pressure: water poured into one arm RISES in the other until level ---
resetWorld();
for(let x=80;x<=92;x++) for(let y=70;y<100;y++) setTile(x,y,T.STONE);  // rock block
for(let y=72;y<=96;y++) setTile(82,y,T.AIR);                            // left arm (1-wide)
for(let y=72;y<=96;y++) setTile(90,y,T.AIR);                            // right arm (1-wide)
for(let x=82;x<=90;x++) setTile(x,97,T.AIR);                            // bottom channel
for(let y=75;y<=96;y++) setTile(82,y,T.WATER);                          // fill left arm
for(let x=82;x<=90;x++) setTile(x,97,T.WATER);                          // fill channel
const uVol=volume();
water.onTileChanged(82,80,getTile);
step(8000);
assert.equal(volume(), uVol, 'U-tube conserves volume');
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
const pVol=volume();
water.onTileChanged(80,76,getTile);
step(12000);
assert.equal(volume(), pVol, 'gallery flood conserves volume');
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
const roofedVol=volume();
water.onTileChanged(81,94,getTile);
step(8000);
assert.equal(volume(), roofedVol, 'surface-mouth equalization conserves volume');
for(let x=81;x<=86;x++) assert.equal(getTile(x,94), T.WATER, `covered mouth surface x=${x} flooded`);

// Open shore at the waterline: with sub-tile levels the reservoir no longer holds a
// square wall of water a full block above the shelf — the excess seeps across and
// drains over the far cliff until the surface settles at the lip (within 2/10 block).
resetWorld();
for(let x=40;x<=80;x++) for(let y=94;y<100;y++) setTile(x,y,T.WATER);   // same reservoir
for(let y=94;y<100;y++) setTile(39,y,T.STONE);
for(let y=95;y<100;y++) setTile(81,y,T.STONE);                          // dry shore shelf, open cliff beyond
const shoreVol=volume();
water.onTileChanged(81,94,getTile);
step(12000);
assert.equal(volume(), shoreVol, 'open shore seep conserves volume');
for(let x=45;x<=80;x++) assert.ok(water.levelAt(x,94,getTile)<=2, `reservoir surface settled to the lip at x=${x} (${water.levelAt(x,94,getTile)} units)`);
for(let x=45;x<=80;x++) assert.equal(unitsAt(x,95,100), 5*UNITS, `reservoir bulk below the lip intact at x=${x}`);
let spilled=0; for(let x=82;x<=130;x++) spilled+=unitsAt(x,90,100);
assert.ok(spilled>0, 'overflow drained over the far cliff');

// --- 14c. Wide enclosed lakes level globally, not as separate local pressure windows ---
resetWorld();
const wideL=50, wideR=140, wideSplit=81;
for(let y=80;y<115;y++){ setTile(wideL-1,y,T.STONE); setTile(wideR+1,y,T.STONE); }
for(let x=wideL;x<=wideSplit;x++) for(let y=84;y<115;y++) setTile(x,y,T.WATER);      // deep left half
for(let x=wideSplit+1;x<=wideR;x++) for(let y=107;y<115;y++) setTile(x,y,T.WATER);   // shallow right half
const wideVol=volume();
for(let x=wideL;x<=wideR;x+=8) water.onTileChanged(x,100,getTile);
step(6000);
assert.equal(volume(), wideVol, 'wide basin leveling conserves volume');
const wideTops=[];
for(let x=wideL;x<=wideR;x++){ const t=topOf(x); if(t>=0) wideTops.push(t); }
assert.ok(Math.max(...wideTops)-Math.min(...wideTops)<=1, `wide basin level within 1 (tops ${Math.min(...wideTops)}..${Math.max(...wideTops)})`);
// Surface elevation (top row + its sub-tile fill) must be flat to 1/10 block across
// the basin — column volume sums differ legitimately where bedrock seals lower cavities.
const surfElev=(x)=>{ for(let y=70;y<115;y++){ if(getTile(x,y)===T.WATER) return (115-y-1)*UNITS + water.levelAt(x,y,getTile); } return -1; };
const elevs=[];
for(let x=wideL;x<=wideR;x++){ const e=surfElev(x); if(e>=0) elevs.push(e); }
assert.ok(Math.max(...elevs)-Math.min(...elevs)<=1, `wide basin surface flat to 1/10 block (elev ${Math.min(...elevs)}..${Math.max(...elevs)})`);

// --- 14d. Overflow over a tree-trunk lip is not a submerged communicating pipe ---
resetWorld();
for(let x=44;x<=106;x++) setTile(x,100,T.STONE);
for(let y=88;y<=100;y++){ setTile(44,y,T.STONE); setTile(106,y,T.STONE); }
for(let y=94;y<=99;y++) setTile(60,y,T.WOOD); // trunk/lip separating the basins
for(let x=45;x<60;x++) for(let y=91;y<100;y++) setTile(x,y,T.WATER);    // narrow high basin
setTile(60,93,T.WATER);                                                 // the overflow tile above the trunk
for(let x=61;x<106;x++) for(let y=97;y<100;y++) setTile(x,y,T.WATER);   // wider lower basin
const lipVol=volume();
water.onTileChanged(60,93,getTile);
step(7000);
assert.equal(volume(), lipVol, 'tree-lip overflow conserves volume');
let leftMinDepth=Infinity;
for(let x=45;x<60;x++) leftMinDepth=Math.min(leftMinDepth, depthAt(x,88,100));
let rightMaxDepth=0;
for(let x=61;x<106;x++) rightMaxDepth=Math.max(rightMaxDepth, depthAt(x,88,100));
assert.ok(leftMinDepth>=6, `source basin remains at/above the trunk lip (min depth ${leftMinDepth})`);
assert.ok(rightMaxDepth<=5, `wide receiving basin only gets overflow above the lip (max depth ${rightMaxDepth})`);

// --- 14e. No walls of water: a free-standing water pillar collapses into a smooth film ---
resetWorld();
for(let y=95;y<100;y++) setTile(70,y,T.WATER);   // 5-tall pillar standing on open bedrock floor
water.onTileChanged(70,97,getTile);
const wallVol=volume();
step(5000);
assert.equal(volume(), wallVol, 'wall collapse conserves volume');
let maxCol=0, wetCols=0;
for(let x=40;x<=100;x++){ const u=unitsAt(x,90,100); if(u>maxCol) maxCol=u; if(u>0) wetCols++; }
assert.ok(maxCol<=UNITS+1, `no wall of water remains (tallest column ${maxCol} units)`);
assert.ok(wetCols>=5, `pillar spread across the floor (${wetCols} columns)`);
for(let x=40;x<100;x++){
  const a=unitsAt(x,90,100), b=unitsAt(x+1,90,100);
  if(a>0 && b>0) assert.ok(Math.abs(a-b)<=1, `collapsed pillar links smoothly at x=${x} (${a} vs ${b})`);
}

// --- 14f. Sub-block basin film: 3 blocks poured into a 20-wide trench span the whole
// basin as one level sheet of 1-2 tenths — the headline sub-tile capability.
resetWorld();
for(let x=80;x<100;x++) setTile(x,99,T.AIR);     // 1-deep trench in bedrock (walls at 79/100)
for(const px of [84, 90, 96]) water.addSource(px, 95, getTile, setTile);
step(8000);
assert.equal(volume(), 3*UNITS, 'film pour conserves volume');
const filmCols=[];
for(let x=80;x<100;x++) filmCols.push(water.levelAt(x,99,getTile));
const wetFilm=filmCols.filter(u=>u>0);
assert.ok(wetFilm.length>=15, `film spans the basin (${wetFilm.length}/20 columns wet)`);
assert.ok(Math.max(...filmCols)<=2, `film stays sub-block (max ${Math.max(...filmCols)} units)`);
assert.ok(Math.max(...wetFilm)-Math.min(...wetFilm)<=1, `film level within 1/10 block across the basin (${filmCols.join(',')})`);

// --- 15. Water absorbs into sand as mud, consuming the water cell ---
resetWorld();
setTile(0,49,T.STONE);
setTile(-1,50,T.STONE); setTile(1,50,T.STONE);
setTile(-1,51,T.STONE); setTile(1,51,T.STONE);
setTile(0,51,T.SAND);
assert.ok(water.addSource(0,50,getTile,setTile), 'water source placed over sand');
step(260);
assert.equal(getTile(0,51),T.MUD,'sand touching water eventually becomes mud');
assert.equal(getTile(0,50),T.AIR,'the absorbed water cell is consumed');
assert.equal(countWater(),0,'absorption conserves by removing one water tile');

// --- 16. Sun-exposed mud dries back to sand and vents steam ---
resetWorld();
setTile(0,50,T.MUD);
water.onTileChanged(0,50,getTile);
step(700);
assert.equal(getTile(0,50),T.SAND,'sunlit mud dries back into sand');
assert.ok(countTile(T.STEAM)>=1,'drying mud releases a steam tile');

// --- 17. Water hydrates clay into wet clay, consuming the water cell ---
resetWorld();
setTile(10,49,T.STONE);
setTile(9,50,T.STONE); setTile(11,50,T.STONE);
setTile(9,51,T.STONE); setTile(11,51,T.STONE);
setTile(10,51,T.CLAY);
assert.ok(water.addSource(10,50,getTile,setTile), 'water source placed over clay');
step(240);
assert.equal(getTile(10,51),T.WET_CLAY,'clay touching water becomes wet clay');
assert.equal(getTile(10,50),T.AIR,'hydrating clay consumes the adjacent water cell');
assert.equal(countWater(),0,'clay hydration removes one water tile');

// --- 18. Sun-exposed wet clay dries back to clay and vents steam ---
resetWorld();
setTile(10,50,T.WET_CLAY);
water.onTileChanged(10,50,getTile);
step(620);
assert.equal(getTile(10,50),T.WET_CLAY,'sunlit wet clay stays workable far longer than mud');
assert.equal(countTile(T.STEAM),0,'slow-drying wet clay does not release steam at the old fast timing');
step(3200);
assert.equal(getTile(10,50),T.CLAY,'sunlit wet clay dries back into clay');
assert.ok(countTile(T.STEAM)>=1,'drying wet clay releases a steam tile');

// --- 19. Wave API safety: disturb/snapshot/restore never throw, reject junk ---
water.disturb(85, 200); water.disturb(85.7, -300); water.disturb(NaN, 50); water.disturb(10, Infinity);
const snap=water.snapshot();
assert.ok(snap && snap.v===3, 'snapshot v3');
water.restore(snap);
water.restore({v:1, active:[[1,2]], ripples:[{L:0,R:5,y:60,ttl:300}]}); // legacy save shape
water.restore(null);
assert.deepEqual(water._debug().active,[],'missing water payload clears state inherited from the previous world');
water.restore('garbage');
water.restore({
  v:2,
  active:[[1,2],[NaN,3],[4,Infinity],'bad','-3,5'],
  lateral:[[1,2],[Infinity,1],[2,-5],[3,99]],
  passiveScanOffset:-50,
  pressureIntervalCurrent:999,
  pressureAcc:Infinity,
  lateralAcc:-4
});
const clean=water._debug();
assert.deepEqual(new Set(clean.active), new Set(['1,2','-3,5']), 'water restore drops malformed active cells but keeps valid negative-x cells');
assert.deepEqual(clean.cooldown, [[1,2],[3,5]], 'water restore sanitizes malformed and oversized lateral cooldowns');
assert.equal(clean.pressureIntervalCurrent, 0.9, 'water restore clamps pressure interval');
assert.equal(clean.pressureAcc, 0, 'water restore rejects invalid pressure accumulator');
{
  const cap=clean.restoreCaps.active;
  const oversized=new Array(cap+1).fill(null);
  oversized[cap]=[7,60];
  water.restore({v:3,active:oversized});
  assert.deepEqual(water._debug().active,[],'water restore bounds scanned rows even when every preceding entry is malformed');
}
water.restore({v:3, levels:[[5,60,4],[6,60,'x'],[7,60,0],[8,60,15],[9,'y',3]]});
const levClean=water._debug().levels;
assert.deepEqual(levClean, [[5,60,4]], 'water restore drops malformed sub-tile levels but keeps valid ones');
water.reset();
const afterReset=water._debug();
assert.equal(afterReset.pressureAcc, 0, 'water reset clears inherited pressure accumulator');
assert.equal(afterReset.pressureIntervalCurrent, 0.4, 'water reset restores default pressure cadence');
assert.deepEqual(afterReset.active, [], 'water reset clears active water cells');
assert.deepEqual(afterReset.levels, [], 'water reset clears sub-tile levels');

// --- 19b. Sub-tile levels survive snapshot/restore exactly ---
resetWorld();
setTile(50,99,T.WATER);                 // becomes a spread film with partial cells
water.onTileChanged(50,99,getTile);
step(800);
const volBeforeSnap=volume();
assert.ok(water._debug().levels.length>0, 'spread film produced partial cells');
const levSnap=water.snapshot();
assert.ok(Array.isArray(levSnap.levels) && levSnap.levels.length>0, 'snapshot carries sub-tile levels');
water.reset();
water.restore(levSnap);
assert.equal(volume(), volBeforeSnap, 'restore rehydrates sub-tile levels exactly');
assert.deepEqual(water._debug().toxicWater, [], 'fresh restore without toxic payload has no toxic water');

// --- 19c. Toxic water is an overlay state: it flows, saves, and clears after one game day ---
resetWorld();
setTile(0,99,T.WATER);
water.onTileChanged(0,99,getTile);
assert.equal(water.polluteAt(0,99,getTile,setTile,{source:'test',seconds:120}), true, 'water can be marked as toxic without changing its tile id');
assert.equal(getTile(0,99), T.WATER, 'toxic water remains the normal water tile for gameplay systems');
assert.equal(water.isToxicAt(0,99,getTile), true, 'toxic water state is queryable per cell');
step(240);
assert.ok(water._debug().toxicWater.some(([x,y])=>x!==0 && y===99), 'toxic water contamination travels with flowing water units');
const toxicSnap=water.snapshot();
assert.ok(Array.isArray(toxicSnap.toxic) && toxicSnap.toxic.length>0, 'water snapshot carries toxic-water cells');
const toxicCell=toxicSnap.toxic[0];
water.reset();
water.restore(toxicSnap);
assert.equal(water.isToxicAt(toxicCell[0],toxicCell[1],getTile), true, 'water restore rehydrates toxic-water cells');
water.update(getTile,setTile,121);
assert.equal(water.metrics().toxicWater, 0, 'toxic water clears back to ordinary water after its timer');

// --- 20. displaceAt conserves volume when a solid enters water (engine contract) ---
// This is the primitive the player-placement integration relies on: pushing the unit out
// instead of deleting it, exactly like falling blocks, trees and meat.
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR);
for(let x=80;x<100;x++) for(let y=101;y<105;y++) setTile(x,y,T.WATER); // 4-deep pool
step(200);
{
  const before=volume();
  const tx=90, ty=103; // submerged cell
  assert.equal(getTile(tx,ty), T.WATER, 'target cell is submerged before placement');
  water.displaceAt(tx,ty,getTile,setTile); // player/build path: push the unit out first
  setTile(tx,ty,T.STONE);                  // then the solid claims the cell
  step(400);
  assert.equal(volume(), before, 'placing a solid into water displaces the units instead of deleting them');
}

// --- 20b. solidifyAt: freezing weather makes a cell volume-true before icing it ---
// Seasonal freeze turns a water cell into one FULL ice block; partial surface cells
// must first borrow their deficit from the body below (no volume minted at thaw).
resetWorld();
for(let x=80;x<100;x++) for(let y=100;y<105;y++) setTile(x,y,T.AIR);
for(let x=80;x<100;x++) for(let y=102;y<105;y++) setTile(x,y,T.WATER); // 3-deep pool
water.addSource(90,100,getTile,setTile); // one extra block → leveling leaves a partial top row
step(1200);
let pcell=null;
for(let x=80;x<100 && !pcell;x++){
  for(let y=100;y<105;y++){
    if(getTile(x,y)!==T.WATER) continue;
    const u=water.levelAt(x,y,getTile);
    if(u>0 && u<UNITS && getTile(x,y+1)===T.WATER) pcell={x,y};
    break;
  }
}
assert.ok(pcell, 'pool has a partial surface cell over deeper water');
{
  const before=volume();
  assert.equal(water.solidifyAt(pcell.x,pcell.y,getTile,setTile), true, 'solidifyAt can make a deep-pool surface cell full');
  assert.equal(volume(), before, 'solidifyAt conserves volume (borrows from below)');
  assert.equal(water.levelAt(pcell.x,pcell.y,getTile), UNITS, 'solidified cell is a full block');
}
resetWorld();
setTile(50,99,T.WATER);
water.onTileChanged(50,99,getTile);
step(800); // spreads into a sub-tile film on bedrock
let filmCell=null;
for(let x=40;x<60 && !filmCell;x++){
  const u=water.levelAt(x,99,getTile);
  if(u>0 && u<UNITS) filmCell={x,y:99};
}
assert.ok(filmCell, 'spread film has partial cells');
assert.equal(water.solidifyAt(filmCell.x,filmCell.y,getTile,setTile), false, 'thin films cannot be made full volume-true and must stay liquid');

// --- 21. Integration: player block placement uses displaceAt (industry-standard, volume-conserving) ---
// The player's own placement path must displace water like every other solid-placement path,
// not just wake neighbors and let the overwrite delete the cell.
const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /function tryPlace\(tx,ty\)[\s\S]*const displacePlacedWater=\(\)=>\{[\s\S]*WATER\.displaceAt\(tx,ty,getTile,setTile\)/, 'player block placement displaces water via displaceAt instead of deleting it');
assert.match(mainSrc, /if\(!displacePlacedWater\(\)\)\{ msg\('Brak miejsca na wypchniecie wody'\); return false; \}\s*if\(!setForegroundConfirmed\(tx,ty,id\)\)/, 'placement requires successful displacement immediately before a confirmed tile write');
assert.match(mainSrc, /const undoPrev=\(isGasTileId\(prevRaw\)\|\|prevRaw===T\.WATER\)\?T\.AIR:prevRaw;/, 'undo reveals air after a displaced water placement instead of minting a second fluid unit');
assert.match(mainSrc, /oldForeground:\(isGasTileId\(cur\)\|\|cur===T\.WATER\)\?T\.AIR:cur/, 'background-to-foreground toggles use the same volume-safe water undo contract');
assert.match(mainSrc, /function waterCollectionChanceAt\(tx,ty\)[\s\S]*WATER\.levelAt\(tx,ty,getTile\)[\s\S]*Number\(units\)[\s\S]*\/unitsMax/, 'water collection chance is proportional to the sub-block fill level');
assert.match(mainSrc, /const dropCtx=dropContextForTile\(tId,mineTx,mineTy\);[\s\S]*setForegroundConfirmed\(mineTx,mineTy,T\.AIR\)[\s\S]*awardTileDrops\(info,dropCtx\)/, 'player mining rolls water drops using the pre-removal fill context and only after confirmed removal');

console.log('OK: all water simulation tests passed');
