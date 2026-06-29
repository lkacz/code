import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = {};
globalThis.msg = text => messages.push(String(text));
const messages = [];
let gameDay = 3;
globalThis.MM.seasons = { metrics(){ return {dayFloat:gameDay}; } };

const { T } = await import('../src/constants.js');
const { npcRegistry } = await import('../src/engine/npc_system.js');
const { generatedNpcs } = await import('../src/engine/generated_npcs.js');

const stats=generatedNpcs._jobCatalogStats();
assert.ok(stats.total>=50 && stats.total<=80, 'procedural NPC catalog keeps a substantial 50-80 job template range');
assert.deepEqual(stats.invalid, [], 'procedural NPC catalog templates all carry role, story, moral, cost, and reward data');
assert.ok(stats.counts[0]>=7 && stats.counts[8]>=7, 'major biomes carry multiple distinct job stories');

const worldGen = {
  worldSeed:424242,
  settings:{seaLevel:62},
  biomeType(){ return 8; },
  surfaceHeight(){ return 30; }
};
function getTile(x,y){
  void x;
  if(y>=30) return T.GRASS;
  return T.AIR;
}
function setTile(){}

let candidate=null;
for(let cell=1; cell<80; cell++){
  candidate=generatedNpcs._candidateForCell(cell,worldGen);
  if(candidate) break;
}
assert.ok(candidate, 'procedural NPC generator creates a sparse deterministic candidate away from spawn');
assert.equal(candidate.biome, 8, 'candidate carries local biome context');
assert.ok(candidate.lore && candidate.prompt.includes(candidate.lore), 'candidate prompt carries local lore');
assert.ok(candidate.moral && candidate.moral.includes('Moral:'), 'candidate carries a distinct moral/story hook');
const nextCandidate=generatedNpcs.findNext(0,1,worldGen,80);
assert.ok(nextCandidate && nextCandidate.x>0, 'generated NPC manager can find the next deterministic local in a direction');
const houseCells = generatedNpcs._houseCells(candidate, getTile, worldGen).cells;
const doorCells = houseCells.filter(c => c.role === 'door');
assert.ok(doorCells.length >= 2, 'generated NPC houses reserve a real doorway footprint');
assert.ok(doorCells.every(c => c.structural && c.t === T.STEEL_DOOR), 'ruin-biome homes use structural steel doors instead of air gaps');

let inventoryUpdates=0;
let saveMarks=0;
globalThis.inv = {};
globalThis.MM.inventory = {
  grantItem(){ return true; },
  equip(){ return true; },
  getItem(){ return null; }
};
const ctx = {
  worldGen,
  gameDayFloat(){ return gameDay; },
  onInventoryChange(){ inventoryUpdates++; },
  onChange(){ saveMarks++; }
};
const player = {x:candidate.x,y:29,hp:100};

generatedNpcs.reset();
assert.equal(generatedNpcs.update(1,player,getTile,setTile,ctx), undefined, 'generated NPC manager updates without owning the NPC simulation loop');
let npc=npcRegistry.get(candidate.id);
assert.ok(npc, 'nearby generated NPC is materialized into the shared NPC registry');
assert.equal(npc.displayName(), candidate.role, 'generated NPC uses its lore/job role as display name');
let state=npc._debug();
assert.equal(state.generated, true, 'generated NPC debug metadata identifies procedural locals');
assert.equal(state.lore, candidate.lore, 'generated NPC keeps its lore metadata');
assert.equal(npc.questSteps()[0].item, candidate.job.cost.item, 'generated job asks for its deterministic resource');
let summary=npc.summary();
assert.equal(summary.generated, true, 'generated NPC summaries identify procedural locals');
assert.equal(summary.lore, candidate.lore, 'generated NPC summaries expose local lore before completion');
assert.equal(summary.moral, candidate.moral, 'generated NPC summaries expose local moral text before completion');
assert.equal(summary.role, candidate.role, 'generated NPC summaries expose the local role before completion');
assert.equal(typeof summary.prompt, 'string', 'generated NPC summaries collapse prompt variants into displayable text');
assert.equal(summary.rewards[Object.keys(candidate.job.reward)[0]], candidate.job.reward[Object.keys(candidate.job.reward)[0]], 'generated NPC summaries expose reward metadata before completion');
assert.equal(summary.required.item, candidate.job.cost.item, 'generated NPC summaries expose required resources');
assert.equal(npcRegistry.nearby(player,20).some(s=>s.id===candidate.id), true, 'generated NPCs are visible through the registry nearby-summary API');

player.x=state.x;
player.y=state.y;
globalThis.inv[candidate.job.cost.item]=candidate.job.cost.amount;
Object.keys(candidate.job.reward).forEach(k=>{ globalThis.inv[k]=0; });
npcRegistry.update(0.1,player,getTile,setTile,ctx);
assert.equal(npc.phase(), 'done', 'generated local job completes through the shared NPC handoff solver');
summary=npc.summary();
assert.equal(summary.status, 'completed', 'generated NPC summary marks completed jobs');
assert.equal(globalThis.inv[candidate.job.cost.item], 0, 'generated local job consumes the requested resource');
Object.keys(candidate.job.reward).forEach(k=>{
  assert.equal(globalThis.inv[k], candidate.job.reward[k], 'generated local job pays reward resource '+k);
});
assert.ok(inventoryUpdates>=1 && saveMarks>=1, 'generated local completion refreshes inventory and marks the save dirty');
assert.ok(messages.some(m=>m.includes(candidate.role)), 'generated local completion announces the job reward');

generatedNpcs.update(1,player,getTile,setTile,ctx);
assert.equal(npcRegistry.get(candidate.id), null, 'completed generated locals hide in their house after the job is done');
let managerState=generatedNpcs._debug();
let local=managerState.locals.find(s=>s.id===candidate.id);
assert.ok(local && local.hidden, 'generated NPC lifecycle records the resident as hidden at home');
assert.ok(local.availableDay>=gameDay+5 && local.availableDay<gameDay+10, 'generated NPC return is scheduled 5-9 in-game days after completion');
assert.equal(local.cycle, 1, 'generated NPC advances to the next job cycle while resting at home');

const snap=npcRegistry.snapshot();
assert.equal(snap.npcs[candidate.id], undefined, 'hidden generated NPCs do not remain as active registry actors');
const generatedSnap=generatedNpcs.snapshot();
assert.ok(generatedSnap.locals.some(s=>s.id===candidate.id && s.hidden), 'generated NPC manager snapshot persists hidden-home cooldowns');
generatedNpcs.reset();
assert.equal(npcRegistry.get(candidate.id), null, 'generated NPC reset unregisters materialized locals');
npcRegistry.restore(snap);
generatedNpcs.restore(generatedSnap);
gameDay=local.availableDay-0.25;
generatedNpcs.update(1,player,getTile,setTile,ctx);
assert.equal(npcRegistry.get(candidate.id), null, 'hidden generated locals do not rematerialize before their return day');
gameDay=local.availableDay+0.05;
const nextJobCandidate=generatedNpcs._candidateForCell(candidate.cell,worldGen);
assert.notEqual(nextJobCandidate.role, candidate.role, 'returning generated locals select the next job template for the same resident');
generatedNpcs.update(1,player,getTile,setTile,ctx);
npc=npcRegistry.get(candidate.id);
assert.ok(npc, 'generated local returns from the house when its cooldown expires');
assert.equal(npc.phase(), 'job', 'returning generated local starts a fresh job instead of staying completed');
assert.equal(npc.displayName(), nextJobCandidate.role, 'returning generated local appears with the next job identity');
assert.equal(npc._debug().data.completedJobs, 1, 'returning generated local keeps completed-job history in metadata');

generatedNpcs.reset();
console.log('generated-npcs-sim: all assertions passed');
