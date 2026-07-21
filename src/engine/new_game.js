const MANUAL_SAVE_META_KEY = 'mm_save_slots_meta_v1';
const MANUAL_SAVE_PREFIX = 'mm_slot_';
const AUTOSAVE_CHUNK_PREFIX = 'mm_save_v7_chunk_';
export const NEW_GAME_SEED_SESSION_KEY = 'mm_new_game_seed_v1';

// A new game resets the active profile, not the player's preferences or explicit
// named saves. Keeping this list here makes the destructive boundary testable and
// keeps future settings from being mixed into the save-reset UI code.
export const NEW_GAME_PREFERENCE_KEYS = Object.freeze([
  'mm_audio_v1',
  'mm_arrow_pref_v1',
  'mm_craft_avail_v1',
  'mm_craft_collapsed_v1',
  'mm_craft_group_v1',
  'mm_debug_menu_settings_v1',
  'mm_dynamo_orientation_v1',
  'mm_fps_unlocked',
  'mm_grass_density',
  'mm_grass_height',
  'mm_lighting_off_v1',
  'mm_minimap_off_v1',
  'mm_player_speed_mult',
  'mm_pump_orientation_v1',
  'mm_world_settings_v2'
]);

// Player KNOWLEDGE (not world state) also survives a reset: the discovery
// journal explicitly promises "starting a new world keeps what the player
// already learned" (discovery.js), and the closed-layer tally is the whole
// point of starting another layer (finale.js).
export const NEW_GAME_KNOWLEDGE_KEYS = Object.freeze([
  'mm_discoveries_v1',
  'mm_layers_v1'
]);

const PREFERENCE_KEYS = new Set([...NEW_GAME_PREFERENCE_KEYS, ...NEW_GAME_KNOWLEDGE_KEYS]);

export function normalizeWorldSeed(value){
  const seed=Number(value);
  return Number.isInteger(seed) && seed>0 && seed<1000000000 ? seed : null;
}

export function randomWorldSeed(random=Math.random){
  const roll=Number(random());
  return Math.max(1, Math.min(999999999, Math.floor((Number.isFinite(roll)?roll:0.5)*1000000000)));
}

export function queueWorldSeed(storage,value){
  if(!storage || typeof storage.setItem!=='function') return null;
  const seed=normalizeWorldSeed(value);
  if(seed===null) return null;
  try{ storage.setItem(NEW_GAME_SEED_SESSION_KEY,String(seed)); }
  catch(e){ return null; }
  return seed;
}

export function queueFreshWorldSeed(storage,random=Math.random){
  return queueWorldSeed(storage,randomWorldSeed(random));
}

export function consumeFreshWorldSeed(storage){
  if(!storage || typeof storage.getItem!=='function') return null;
  let raw=null;
  try{ raw=storage.getItem(NEW_GAME_SEED_SESSION_KEY); }
  catch(e){ return null; }
  finally{ try{ storage.removeItem(NEW_GAME_SEED_SESSION_KEY); }catch(e){} }
  return normalizeWorldSeed(raw);
}

function storageKeys(storage){
  const keys=[];
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);
    if(typeof key==='string') keys.push(key);
  }
  return keys;
}

function namedSaveChunkRefs(storage,keys){
  const refs=new Set();
  for(const key of keys){
    if(!key.startsWith(MANUAL_SAVE_PREFIX)) continue;
    try{
      const data=JSON.parse(storage.getItem(key));
      const chunks=data && data.world && Array.isArray(data.world.chunkRefs)
        ? data.world.chunkRefs
        : [];
      for(const ref of chunks){
        if(ref && typeof ref.key==='string' && ref.key.startsWith(AUTOSAVE_CHUNK_PREFIX)) refs.add(ref.key);
      }
    }catch(e){ /* a damaged named save stays available for export/recovery */ }
  }
  return refs;
}

export function clearActiveGameStorage(storage){
  if(!storage || typeof storage.key!=='function' || typeof storage.removeItem!=='function') return [];
  const keys=storageKeys(storage);
  const namedChunkRefs=namedSaveChunkRefs(storage,keys);
  let meteoritesEnabled=null;
  try{
    const meteorites=JSON.parse(storage.getItem('mm_meteorites_v1'));
    if(meteorites && typeof meteorites.enabled==='boolean') meteoritesEnabled=meteorites.enabled;
  }catch(e){ /* malformed gameplay state is simply discarded */ }
  const remove=keys.filter(key=>{
    if(!key.startsWith('mm_')) return false;
    if(key===MANUAL_SAVE_META_KEY || key.startsWith(MANUAL_SAVE_PREFIX)) return false;
    if(PREFERENCE_KEYS.has(key) || namedChunkRefs.has(key)) return false;
    return true;
  });
  // Remove from a snapshot rather than walking Storage while mutating it; forward
  // iteration can otherwise skip consecutive autosave chunks.
  for(const key of remove) storage.removeItem(key);
  // Meteorite persistence co-mingles a player setting with the current run's
  // countdown. Keep the toggle but omit nextIn so the fresh world rolls a new one.
  if(meteoritesEnabled!==null){
    try{ storage.setItem('mm_meteorites_v1', JSON.stringify({v:2,enabled:meteoritesEnabled})); }catch(e){}
  }
  return remove;
}
