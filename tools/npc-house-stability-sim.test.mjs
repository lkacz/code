import assert from 'node:assert/strict';

// Regression: procedurally built NPC houses must not be eaten by the world's
// structural-collapse / granular / fragile simulations. The falling engine audits
// every visible chunk each frame and auto-claims above-surface build material as a
// player structure, then topples anything unsupported — which used to demolish the
// cabins. NPC houses now register their tiles as protected, so the same audit loop
// leaves them standing while an unprotected control structure still collapses.

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = {};
globalThis.msg = ()=>{};
let gameDay = 4;
globalThis.MM.seasons = { metrics(){ return {dayFloat:gameDay}; } };

const { T } = await import('../src/constants.js');
const { fallingSolids: FALLING } = await import('../src/engine/falling.js');
const { npcRegistry } = await import('../src/engine/npc_system.js');
const { generatedNpcs } = await import('../src/engine/generated_npcs.js');

const SURFACE = 44;
const tiles = new Map();
const tk = (x,y)=>Math.round(x)+','+Math.round(y);
function getTile(x,y){ const k=tk(x,y); if(tiles.has(k)) return tiles.get(k); return Math.round(y)>=SURFACE ? T.STONE : T.AIR; }
function setTile(x,y,v){ tiles.set(tk(x,y), v); }

const worldGen = { worldSeed:24680, settings:{seaLevel:62}, biomeType(){ return 0; }, surfaceHeight(){ return SURFACE; } };
globalThis.MM.worldGen = worldGen;
globalThis.MM.water = { displaceAt(){}, onTileChanged(){} };
globalThis.inv = {};
globalThis.MM.inventory = { grantItem(){return true;}, equip(){return true;}, getItem(){return null;} };

FALLING.reset();
FALLING.init(getTile,setTile);
generatedNpcs.reset();

let candidate=null;
for(let c=1;c<200;c++){ candidate=generatedNpcs._candidateForCell(c,worldGen); if(candidate) break; }
assert.ok(candidate, 'a resident candidate exists');
const player={x:candidate.x+20,y:SURFACE-1,hp:100};
const ctx={worldGen,gameDayFloat(){return gameDay;},onInventoryChange(){},onChange(){}};

// Build the house (protection is applied during build).
generatedNpcs.update(1,player,getTile,setTile,ctx);
const layout=generatedNpcs._houseLayout(candidate,getTile,worldGen);
const wallX=layout.left, wallY=layout.g-1;
assert.equal(getTile(wallX,wallY), layout.pal.wall, 'a wall block is placed');
assert.equal(FALLING.isProtectedBuild(wallX,wallY), true, 'house tiles are registered as protected');

// Unprotected control: a floating timber column in the same area. The audit should
// claim and collapse it, proving the audit loop is genuinely active.
const ctrlX=layout.right+5;
for(let y=SURFACE-8; y<=SURFACE-6; y++) setTile(ctrlX,y,T.WOOD);
assert.equal(FALLING.isProtectedBuild(ctrlX,SURFACE-7), false, 'control column is not protected');

const structural=generatedNpcs._houseCells(candidate,getTile,worldGen).cells.filter(c=>c.structural);
const before=structural.filter(c=>getTile(c.x,c.y)===c.t).length;

// Run the same audit + simulation the live game runs over visible chunks.
const CHUNK_W=64;
const chunks=[Math.floor((layout.left-2)/CHUNK_W), Math.floor((layout.right+6)/CHUNK_W)];
for(let i=0;i<80;i++){
  FALLING.auditChunks([...new Set(chunks)],{force:true,immediate:true});
  FALLING.update(getTile,setTile,0.1);
}

const after=structural.filter(c=>getTile(c.x,c.y)===c.t).length;
assert.equal(after, before, 'every structural house tile survives the collapse-audit loop');
assert.equal(generatedNpcs._houseIntegrity(candidate,getTile,worldGen), 1, 'house integrity stays at 100% under audit');
assert.ok(npcRegistry.get(candidate.id), 'resident stays home because the house never collapsed');

const controlIntact=[SURFACE-8,SURFACE-7,SURFACE-6].filter(y=>getTile(ctrlX,y)===T.WOOD).length;
assert.ok(controlIntact<3, 'the unprotected control column is collapsed by the same audit, proving it was active');

FALLING.reset();
generatedNpcs.reset();
console.log('npc-house-stability-sim: all assertions passed');
