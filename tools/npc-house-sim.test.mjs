import assert from 'node:assert/strict';

// Procedural NPC houses are real tile structures. This sim drives the generated-NPC
// manager against an in-memory world (where setTile/getTile actually persist) to prove
// the house is assembled from blocks, that wrecking >20% of it evicts the resident, and
// that rebuilding it brings the resident home.

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = {};
const messages = [];
globalThis.msg = text => messages.push(String(text));
let gameDay = 4;
globalThis.MM.seasons = { metrics(){ return {dayFloat:gameDay}; } };

const { T } = await import('../src/constants.js');
const { npcRegistry } = await import('../src/engine/npc_system.js');
const { generatedNpcs } = await import('../src/engine/generated_npcs.js');

const SURFACE = 30;
const tiles = new Map();
const tkey = (x,y) => Math.round(x)+','+Math.round(y);
function getTile(x,y){
  const k = tkey(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return Math.round(y) >= SURFACE ? T.GRASS : T.AIR;
}
function setTile(x,y,v){ tiles.set(tkey(x,y), v); }

const worldGen = {
  worldSeed: 1357,
  settings:{ seaLevel:62 },
  biomeType(){ return 0; },           // forest → timber cabin palette
  surfaceHeight(){ return SURFACE; }
};

globalThis.inv = {};
globalThis.MM.inventory = { grantItem(){ return true; }, equip(){ return true; }, getItem(){ return null; } };

let saveMarks = 0;
const ctx = {
  worldGen,
  gameDayFloat(){ return gameDay; },
  onInventoryChange(){},
  onChange(){ saveMarks++; }
};

generatedNpcs.reset();

// Locate a deterministic resident candidate to the right of spawn.
let candidate = null;
for(let cell=1; cell<200; cell++){
  candidate = generatedNpcs._candidateForCell(cell, worldGen);
  if(candidate) break;
}
assert.ok(candidate, 'a deterministic resident candidate exists for the test world');

const player = { x:candidate.x, y:SURFACE-1, hp:100 };

// First scan builds the house and materializes the resident.
generatedNpcs.update(1, player, getTile, setTile, ctx);
let npc = npcRegistry.get(candidate.id);
assert.ok(npc, 'resident materializes near its freshly built home');

// The home is real, block-built terrain: structural cells are actual tiles in the world.
const cells = generatedNpcs._houseCells(candidate, getTile, worldGen).cells;
const structural = cells.filter(c => c.structural);
assert.ok(structural.length >= 12, 'house footprint has a substantial structural shell');
const placed = structural.filter(c => getTile(c.x, c.y) === c.t);
assert.equal(placed.length, structural.length, 'every structural cell is built from its blueprint block');
const usedBlocks = new Set(structural.map(c => c.t));
assert.ok(usedBlocks.has(T.WOOD), 'forest cabin is assembled from timber blocks');
assert.ok(usedBlocks.has(T.WOOD_DOOR), 'forest cabin doorway is a structural wood door');
const doorCells = cells.filter(c => c.role === 'door');
assert.ok(doorCells.length >= 2, 'house blueprint includes a full doorway');
assert.ok(doorCells.every(c => c.structural && getTile(c.x, c.y) === T.WOOD_DOOR), 'doorway materializes as structural door blocks, not air');
assert.ok(cells.some(c => getTile(c.x, c.y) === T.GLASS), 'the cabin carries glass windows');
assert.ok(cells.some(c => getTile(c.x, c.y) === T.TORCH), 'the cabin is lit by a torch');
assert.equal(generatedNpcs._houseIntegrity(candidate, getTile, worldGen), 1, 'a fresh house reads as fully intact');

let local = generatedNpcs._debug().locals.find(s => s.id === candidate.id);
assert.ok(local && local.houseBuilt && local.housePhysical, 'manager records the house as physically built');

// Wreck ~30% of the load-bearing shell.
const wreckCount = Math.ceil(structural.length * 0.30);
const wrecked = structural.slice(0, wreckCount).map(c => ({ x:c.x, y:c.y, t:c.t }));
wrecked.forEach(c => setTile(c.x, c.y, T.AIR));
const damaged = generatedNpcs._houseIntegrity(candidate, getTile, worldGen);
assert.ok(damaged < 1 - 0.20, 'tearing out >20% of the shell drops integrity below the abandonment threshold');

const msgBefore = messages.length;
generatedNpcs.update(1, player, getTile, setTile, ctx);
assert.equal(npcRegistry.get(candidate.id), null, 'resident abandons a wrecked home');
local = generatedNpcs._debug().locals.find(s => s.id === candidate.id);
assert.ok(local && local.abandoned, 'manager marks the resident as having abandoned the home');
assert.ok(messages.slice(msgBefore).some(m => m.includes(candidate.role)), 'abandonment is announced to the player');

// Abandoned residents do not return on the day clock — even days later, with the house
// still in ruins, the resident stays gone.
gameDay += 12;
generatedNpcs.update(1, player, getTile, setTile, ctx);
assert.equal(npcRegistry.get(candidate.id), null, 'a wrecked home keeps its resident away regardless of elapsed days');

// Rebuild the shell exactly as it was — the resident moves back in.
wrecked.forEach(c => setTile(c.x, c.y, c.t));
assert.ok(generatedNpcs._houseIntegrity(candidate, getTile, worldGen) >= 0.9, 'rebuilt shell restores integrity');
const msgRebuild = messages.length;
generatedNpcs.update(1, player, getTile, setTile, ctx);   // detect rebuild → reoccupy
generatedNpcs.update(1, player, getTile, setTile, ctx);   // next scan re-materializes
npc = npcRegistry.get(candidate.id);
assert.ok(npc, 'resident returns once the player rebuilds the house');
local = generatedNpcs._debug().locals.find(s => s.id === candidate.id);
assert.ok(local && !local.abandoned, 'manager clears the abandoned flag after a rebuild');
assert.ok(messages.slice(msgRebuild).some(m => m.includes(candidate.role)), 'the homecoming is announced to the player');
assert.ok(saveMarks >= 1, 'house lifecycle changes mark the save dirty');

// Legacy migration: older saves had "built" houses with AIR doorway cells. The
// maintenance pass should upgrade those cells once, without treating it as damage.
generatedNpcs.reset();
tiles.clear();
const legacyCandidate = generatedNpcs._candidateForCell(candidate.cell, worldGen);
const legacyCells = generatedNpcs._houseCells(legacyCandidate, getTile, worldGen).cells;
// Legacy saves predate the construction-background layer, so only foreground cells exist.
legacyCells.forEach(c => { if(c.layer === 'bg') return; setTile(c.x, c.y, c.role === 'door' ? T.AIR : c.t); });
generatedNpcs.restore({v:2, seed:worldGen.worldSeed, locals:[{
  id:legacyCandidate.id,
  houseBuilt:true,
  housePhysical:true,
  houseDoorsMigrated:false
}]});
player.x = legacyCandidate.x;
generatedNpcs.update(1, player, getTile, setTile, ctx);
const migratedDoorCells = legacyCells.filter(c => c.role === 'door');
assert.ok(migratedDoorCells.every(c => getTile(c.x, c.y) === T.WOOD_DOOR), 'legacy air doorways migrate to structural door tiles');
local = generatedNpcs._debug().locals.find(s => s.id === legacyCandidate.id);
assert.ok(local && local.houseDoorsMigrated && !local.abandoned, 'door migration is one-time and does not abandon an otherwise intact house');

generatedNpcs.reset();
console.log('npc-house-sim: all assertions passed');
