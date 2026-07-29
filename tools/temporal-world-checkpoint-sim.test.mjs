import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.MM={};

const { CHUNK_W, T }=await import('../src/constants.js');
const { world }=await import('../src/engine/world.js');

world.clear();
world.setTile(1,20,T.STONE);
world.setTile(2,20,T.DIRT);
world.setTile(3,20,T.GLASS);
world.setInfrastructure(1,20,T.COPPER_WIRE);
world.setConstructionBackground(2,20,T.BRICK);

assert.equal(world.beginTemporalCheckpoint({sectionCap:16,overlayCap:256}),true);
for(let x=1;x<=40;x++) world.setTile(x,20,T.AIR);
world.setTransientTile(3,20,T.POISON_GAS);
world.clearInfrastructure(1,20);
world.clearConstructionBackground(2,20);
const compact=world.temporalCheckpointState();
assert.equal(compact.valid,true);
assert.equal(compact.sections,1,'many foreground writes in one slab make one COW snapshot');
assert.equal(compact.overlayCells,2,'overlay layers retain first-write records');
assert.ok(compact.estimatedBytes<10000,'small branch checkpoint stays compact');
assert.equal(world.restoreTemporalCheckpoint(),true);
assert.equal(world.getTile(1,20),T.STONE);
assert.equal(world.getTile(2,20),T.DIRT);
assert.equal(world.getTile(3,20),T.GLASS,'transient tile writes rewind too');
assert.equal(world.hasInfrastructure(1,20,T.COPPER_WIRE),true);
assert.equal(world.getConstructionBackground(2,20),T.BRICK);

world.setTile(4.9,20.8,T.OBSIDIAN);
assert.equal(world.getTile(4,20),T.OBSIDIAN,'fractional writer coordinates normalize to one integer cell');

const generatedX=CHUNK_W*9+7;
world.getTile(generatedX,20);
const generatedChunk=9;
const generatedVersionKey='c'+generatedChunk;
const generatedHadVersion=world._versions.has(generatedVersionKey);
const generatedVersion=world._versions.get(generatedVersionKey);
assert.equal(world._modifiedChunks.has(generatedChunk),false);
assert.equal(world.beginTemporalCheckpoint({sectionCap:16,overlayCap:256}),true);
world.setTile(generatedX,20,T.STEEL);
assert.equal(world._modifiedChunks.has(generatedChunk),true);
assert.equal(world.restoreTemporalCheckpoint(),true);
assert.equal(world._modifiedChunks.has(generatedChunk),false,'rewind does not pin a generated chunk in save storage');
assert.equal(world._versions.has(generatedVersionKey),generatedHadVersion,'rewind restores version-map presence');
assert.equal(world._versions.get(generatedVersionKey),generatedVersion,'rewind restores the original render/save version');

assert.equal(world.beginTemporalCheckpoint({sectionCap:16,overlayCap:256}),true);
for(let cx=0;cx<17;cx++) world.setTile(cx*CHUNK_W+5,21,T.STEEL);
const overflow=world.temporalCheckpointState();
assert.equal(overflow.valid,false,'section cap fails closed');
assert.equal(overflow.reason,'section-cap');
assert.equal(world.restoreTemporalCheckpoint(),false,'an incomplete checkpoint can never partially rewind');
assert.equal(world.commitTemporalCheckpoint(),true,'caller can safely commit an overflowed branch');

console.log('temporal-world-checkpoint-sim: all assertions passed');
