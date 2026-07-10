// Discovery journal: one-shot "you found a secret interaction!" toasts.
//
// The simulation is full of hidden interactions (flame melts stone into lava,
// gas clouds detonate, wet + frost freezes solid...). Systems report the moment
// one actually HAPPENS via note(id, text); the first occurrence per world
// profile shows a toast and is remembered in localStorage, so experimenting is
// rewarded exactly once and the journal doubles as a completion counter.
//
// Deliberately NOT part of the save file: discoveries are player knowledge,
// not world state — starting a new world keeps what the player already learned.
const discovery = (function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const KEY = 'mm_discoveries_v1';

  // Every discoverable interaction ships with a catalog entry, so the help
  // panel can show real progress (n/total) and name what was already found.
  // A note() with an id outside the catalog is a bug — pinned by the test.
  const CATALOG = {
    stone_melt:     'Ogień topi kamień w lawę',
    sand_glass:     'Rozgrzany piasek wytapia się w szkło',
    water_boil:     'Płomień gotuje wodę w parę',
    gas_boom:       'Obłok gazu detonuje od ognia',
    electric_water: 'Prąd elektryzuje całą taflę wody',
    react_freeze:   'Mokry wróg + mróz = bryła lodu',
    react_thermal:  'Szok termiczny (ogień na zmrożonym)',
    react_toxic:    'Toksyczny zapłon (ogień + trucizna)',
    react_chain:    'Porażenie łańcuchowe po mokrych celach',
    arrow_recover:  'Wbite drewniane strzały da się podnieść',
    parry:          'Perfekcyjna parada odbija pociski',
  };

  const seen = new Set();
  try{
    if(typeof localStorage !== 'undefined'){
      const raw = localStorage.getItem(KEY);
      if(raw){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr)) for(const id of arr) if(typeof id === 'string') seen.add(id);
      }
    }
  }catch(e){ /* private mode / headless: session-only journal */ }

  function persist(){
    try{
      if(typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify([...seen]));
    }catch(e){ /* ignore */ }
  }

  // Report that a discoverable interaction just happened. Returns true only the
  // first time (callers can key extra celebration off it).
  function note(id, text){
    if(typeof id !== 'string' || !id) return false;
    if(seen.has(id)) return false;
    seen.add(id);
    persist();
    try{
      if(root.msg && typeof text === 'string' && text) root.msg('🧪 Odkrycie: ' + text);
    }catch(e){ /* headless */ }
    try{
      if(root.MM.audio && root.MM.audio.play) root.MM.audio.play('chest');
    }catch(e){ /* no audio */ }
    return true;
  }

  function has(id){ return seen.has(String(id)); }
  function count(){ return seen.size; }
  function list(){ return [...seen]; }
  function total(){ return Object.keys(CATALOG).length; }
  function label(id){ return CATALOG[id] || String(id); }
  // Help-panel view: found entries by label plus the remaining count.
  function progress(){
    const found = [...seen].filter(id => CATALOG[id]).map(id => ({id, label: CATALOG[id]}));
    return {count: found.length, total: total(), found};
  }
  function reset(){ seen.clear(); persist(); }

  const api = { note, has, count, list, total, label, progress, CATALOG, reset };
  MM.discovery = api;
  return api;
})();

export { discovery };
export default discovery;
