// Save-schema regression: resources and hotbar state must survive save/load.
// This is a light static guard because main.js is browser/DOM-bound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

assert.match(src, /function snapshotInventory\(\)/, 'save code defines an inventory snapshot helper');
assert.match(src, /function restoreInventory\(src\)/, 'load code defines an inventory restore helper');
assert.match(src, /function snapshotHotbar\(\)/, 'save code defines a hotbar snapshot helper');
assert.match(src, /function restoreHotbar\(src\)/, 'load code defines a hotbar restore helper');
assert.match(src, /function snapshotEquipment\(\)/, 'save code defines an equipment snapshot helper');
assert.match(src, /function restoreEquipment\(src\)/, 'load code defines an equipment restore helper');
assert.match(src, /inv:\s*snapshotInventory\(\)/, 'save payload includes resource inventory');
assert.match(src, /hotbar:\s*snapshotHotbar\(\)/, 'save payload includes hotbar state');
assert.match(src, /equipment:\s*snapshotEquipment\(\)/, 'save payload includes equipped gear and outfit');
assert.match(src, /gases:\s*\(GASES && GASES\.snapshot\)/, 'save payload includes active gas state');
assert.match(src, /wind:\s*\(WIND && WIND\.snapshot\)/, 'save payload includes weather wind state');
assert.match(src, /dynamo:\s*\(DYNAMO && DYNAMO\.snapshot\)/, 'save payload includes dynamo machine state');
assert.match(src, /teleporters:\s*\(TELEPORTERS && TELEPORTERS\.snapshot\)/, 'save payload includes teleporter machine state');
assert.match(src, /tool:\s*player\.tool/, 'save payload includes the active pickaxe');
assert.match(src, /energy:\+\(player\.energy\|\|0\)\.toFixed\(2\)/, 'save payload includes stored hero energy');
assert.match(src, /restoreInventory\(data\.inv\)/, 'load path restores resource inventory');
assert.match(src, /restoreHotbar\(data\.hotbar/, 'load path restores hotbar state');
assert.match(src, /restoreEquipment\(data\.equipment\)/, 'load path restores equipped gear and outfit');
assert.match(src, /GASES\.restore\(data\.gases,getTile,setTile\)/, 'load path restores active gas state through transient world writes');
assert.match(src, /GASES\.auditChunks\(restoredChunks,getTile\)/, 'load path re-audits saved gas tiles from chunks');
assert.match(src, /WIND\.restore\(data\.wind\)/, 'load path restores weather wind state');
assert.match(src, /DYNAMO\.restore\(data\.dynamo,getTile\)/, 'load path restores dynamo machine state after terrain');
assert.match(src, /TELEPORTERS\.restore\(data\.teleporters,getTile\)/, 'load path restores teleporter batteries after terrain');
assert.match(src, /player\.energy = \(data\.player && typeof data\.player\.energy==='number'\) \? data\.player\.energy : 0/, 'load path restores stored hero energy');
assert.match(src, /function chunkForTerrainSave\(arr\)/, 'save path strips transient world layers from terrain chunks');
assert.match(src, /function stripTransientTerrainTiles\(arr\)/, 'load path sanitizes transient world layers from saved chunks');
assert.match(src, /encodeRLE\(chunkForTerrainSave\(arr\)\)/, 'full and incremental chunk saves encode sanitized terrain chunks');
assert.match(src, /stripTransientTerrainTiles\(ch\.rle\? decodeRLE\(ch\.data, CHUNK_W\*WORLD_H\): decodeRaw\(ch\.data\)\)/, 'inline modified chunk restore removes transient tiles from terrain');
assert.match(src, /stripTransientTerrainTiles\(ref\.rle===false \? decodeRaw\(data\) : decodeRLE\(data, CHUNK_W\*WORLD_H\)\)/, 'referenced autosave restore removes transient tiles from terrain');
assert.match(src, /updateInventory\(\{noSave:true\}\)/, 'load path refreshes inventory UI without dirtying the save');
assert.match(src, /refreshHotbarDom\(\)/, 'load path refreshes visible hotbar labels');
assert.match(src, /updateHotbarSel\(\)/, 'load path refreshes visible hotbar selection');
assert.match(src, /function updateInventory\(opts\)/, 'inventory refresh accepts options');
assert.match(src, /if\(!\(opts&&opts\.noSave\)\) saveState\(\)/, 'inventory refresh can suppress save scheduling');
assert.match(src, /function recordSaveFailure\(e,manual\)/, 'autosave records and backs off after storage failures');
assert.match(src, /autosaveChunkKey\(cx,job\.id\)/, 'autosave writes unique per-job chunk blobs');
assert.match(src, /cleanupAutosaveChunks\(new Set\(\),job\.refs\)/, 'failed autosave batches clean uncommitted blobs');
assert.match(src, /id:'coal_torches'/, 'crafting exposes a coal-assisted torch recipe');
assert.match(src, /cost:\{wood:1,\s*coal:1\}/, 'coal torch recipe consumes wood and coal');
assert.match(src, /inv\.torch\+=8/, 'coal torch recipe yields the larger torch batch');
assert.match(src, /id:'copper_wire'/, 'crafting exposes copper power cable');
assert.match(src, /id:'teleporter'/, 'crafting exposes teleporters');

console.log('save-schema-sim: all assertions passed');
