import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  NEW_GAME_PREFERENCE_KEYS,
  clearActiveGameStorage,
  consumeFreshWorldSeed,
  queueFreshWorldSeed
} from '../src/engine/new_game.js';

class MemoryStorage {
  constructor(entries=[]){ this.data=new Map(entries); }
  get length(){ return this.data.size; }
  key(index){ return [...this.data.keys()][index] ?? null; }
  getItem(key){ return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key,value){ this.data.set(String(key),String(value)); }
  removeItem(key){ this.data.delete(String(key)); }
}

const namedChunk='mm_save_v7_chunk_named_1';
const storage=new MemoryStorage([
  ['foreign_app_data','keep'],
  ['mm_save_slots_meta_v1',JSON.stringify([{id:'named'}])],
  ['mm_slot_inline',JSON.stringify({v:7,world:{modified:[]}})],
  ['mm_slot_named',JSON.stringify({v:7,world:{chunkRefs:[{key:namedChunk}]}})],
  [namedChunk,'named-chunk-data'],
  ['mm_save_v7_chunk_active_1','active-a'],
  ['mm_save_v7_chunk_active_2','active-b'],
  ['mm_meteorites_v1',JSON.stringify({v:2,enabled:true,nextIn:4321})]
]);

for(const key of NEW_GAME_PREFERENCE_KEYS) storage.setItem(key,'preference');
const gameplayKeys=[
  'mm_save_v7','mm_save_v6','mm_save_v5','mm_save_v4','mm_save_v3','mm_save_v2',
  'mm_save_critical_v1','mm_last_slot_v1','mm_inventory_v1','mm_custom_inv_v1',
  'mm_discarded_loot_v1','mm_dynamic_loot_v1','mm_progress_v1','mm_plants_v1',
  'mm_invasions_v1','mm_ufo_v1','mm_golden_v1','mm_discoveries_v1',
  'mm_alien_ruin_commanders_v1:123','mm_respawn_v1','mm_respawn_totems_v1',
  'mm_healing_shelters_v1','mm_grave_v1','mm_loot_inbox_v1','mm_ocean_hint_v1'
];
for(const key of gameplayKeys) storage.setItem(key,'game-state');

const removed=clearActiveGameStorage(storage);
for(const key of gameplayKeys) assert.equal(storage.getItem(key),null,key+' is reset');
assert.equal(storage.getItem('mm_save_v7_chunk_active_1'),null,'first consecutive active chunk is reset');
assert.equal(storage.getItem('mm_save_v7_chunk_active_2'),null,'second consecutive active chunk is reset');
assert.ok(removed.includes('mm_last_slot_v1'),'fresh game detaches from the previously loaded named slot');

for(const key of NEW_GAME_PREFERENCE_KEYS) assert.equal(storage.getItem(key),'preference',key+' preference survives');
assert.equal(storage.getItem('foreign_app_data'),'keep','unrelated origin data survives');
assert.ok(storage.getItem('mm_save_slots_meta_v1'),'named-save metadata survives');
assert.ok(storage.getItem('mm_slot_inline'),'inline named save survives');
assert.ok(storage.getItem('mm_slot_named'),'external-chunk named save survives');
assert.equal(storage.getItem(namedChunk),'named-chunk-data','chunk referenced by a named save survives');
assert.deepEqual(JSON.parse(storage.getItem('mm_meteorites_v1')),{v:2,enabled:true},'meteorite toggle survives but the old run countdown does not');

const session=new MemoryStorage();
assert.equal(queueFreshWorldSeed(session,()=>0.42),420000000,'new game queues a fresh deterministic seed');
assert.equal(consumeFreshWorldSeed(session),420000000,'world generation consumes the queued seed');
assert.equal(consumeFreshWorldSeed(session),null,'the fresh seed is one-shot');

const mainSrc=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
const worldgenSrc=await readFile(new URL('../src/engine/worldgen.js',import.meta.url),'utf8');
const indexSrc=await readFile(new URL('../index.html',import.meta.url),'utf8');

assert.doesNotMatch(indexSrc,/id="inv"/,'the redundant resource HUD bar is absent');
assert.doesNotMatch(mainSrc,/function buildResourceHud\(/,'the resource HUD is no longer generated at runtime');
assert.match(mainSrc,/newGame\.textContent='Rozpocznij od nowa'/,'pause settings expose the new-game action');
assert.match(mainSrc,/window\.confirm\('Rozpocząć nową grę\?/,'new game requires explicit confirmation');
assert.match(mainSrc,/_startingNewGame=true;[\s\S]*clearActiveGameStorage\(localStorage\);[\s\S]*queueFreshWorldSeed[\s\S]*window\.location\.reload\(\)/,'new game suppresses saves, purges state, queues a new world, then reloads');
assert.match(mainSrc,/function flushPendingSave\(\)\{[\s\S]*if\(_startingNewGame\)\{[\s\S]*clearActiveGameStorage\(localStorage\)/,'unload cannot resurrect the abandoned profile');
assert.match(mainSrc,/if\(PLANTS && PLANTS\.reset\) PLANTS\.reset\(\)/,'plant pagehide persistence is neutralized before reset');
assert.match(worldgenSrc,/consumeFreshWorldSeed\([^)]*sessionStorage[^)]*\) \|\| 12345/,'world generation consumes the one-shot new-game seed');

console.log('new-game-sim: all assertions passed');
