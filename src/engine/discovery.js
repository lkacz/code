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
    sandstorm:      'Pustynna wichura usypuje wydmy',
    hero_conduct:   'Mokry bohater przewodzi prąd (x1.5)',
    hero_frozen:    'Mokry + zziębnięty na mrozie = zamarzasz',
    hero_fizzle:    'Ogień gaśnie na przemoczonym bohaterze',
    mob_gear:       'Pokonane stwory gubią swoje rzemiosło',
    epic_drop:      'Epicki łup ogłasza się słupem światła',
    volcano_sacrifice: 'Wulkan przyjmuje ofiary i oddaje z nawiązką',
  };
  // Undiscovered entries show as "???" in the Ekwipunek journal tab, with only
  // the category and a foggy hint — enough to hunt, not enough to spoil.
  const HINTS = {
    stone_melt:     {cat:'🔥 Żywioły i teren',   hint:'Bardzo gorący strumień zmienia twardą skałę w coś płynnego…'},
    sand_glass:     {cat:'🔥 Żywioły i teren',   hint:'Pustynny materiał pod długim żarem robi się przezroczysty…'},
    water_boil:     {cat:'🔥 Żywioły i teren',   hint:'Płomień nad taflą nie zostaje bez odpowiedzi…'},
    gas_boom:       {cat:'🔥 Żywioły i teren',   hint:'Pewien obłok bardzo nie lubi otwartego ognia…'},
    electric_water: {cat:'⚗️ Reakcje bojowe',    hint:'Prąd puszczony w pewien żywioł niesie się dalej, niż celujesz…'},
    react_freeze:   {cat:'⚗️ Reakcje bojowe',    hint:'Dwa zimne i mokre statusy na jednym celu dają coś twardego…'},
    react_thermal:  {cat:'⚗️ Reakcje bojowe',    hint:'Skrajne temperatury zderzone na jednym celu bolą podwójnie…'},
    react_toxic:    {cat:'⚗️ Reakcje bojowe',    hint:'Trucizna w żyłach + iskra z zewnątrz…'},
    react_chain:    {cat:'⚗️ Reakcje bojowe',    hint:'Kilka przemoczonych celów blisko siebie i odrobina prądu…'},
    arrow_recover:  {cat:'🏹 Techniki',          hint:'Nie każdy wystrzelony pocisk ginie bezpowrotnie…'},
    parry:          {cat:'🏹 Techniki',          hint:'Obrona podniesiona w idealnym momencie robi coś więcej…'},
    sandstorm:      {cat:'🌪 Pogoda',            hint:'Wschodnia pustynia przy naprawdę silnym wietrze…'},
    hero_conduct:   {cat:'🧍 Na własnej skórze', hint:'Przemocz się i stań na drodze porażenia…'},
    hero_frozen:    {cat:'🧍 Na własnej skórze', hint:'Dwa zimna naraz, daleko na zachodzie, pod gołym niebem…'},
    hero_fizzle:    {cat:'🧍 Na własnej skórze', hint:'Dobrze przemoczony możesz wejść tam, gdzie zwykle parzy…'},
    mob_gear:       {cat:'🎁 Łupy',              hint:'To, czym stwór walczy albo czym jest, może po nim zostać…'},
    epic_drop:      {cat:'🎁 Łupy',              hint:'Na krańcach świata spadają skarby, których nie sposób przegapić…'},
    volcano_sacrifice: {cat:'🎁 Łupy',           hint:'Zwykły przedmiot wrzucony w ogień góry czasem wraca lepszy…'},
  };
  const DISCOVERY_XP = 40; // every fresh journal entry pays experience (progress.js levels off player.xp)

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
  // first time (callers can key extra celebration off it). A fresh entry pays
  // DISCOVERY_XP straight into player.xp (progress.js turns xp into levels).
  function note(id, text){
    if(typeof id !== 'string' || !id) return false;
    if(seen.has(id)) return false;
    seen.add(id);
    persist();
    try{
      if(root.msg && typeof text === 'string' && text) root.msg('🧪 Odkrycie: ' + text + ' (+' + DISCOVERY_XP + ' XP)');
    }catch(e){ /* headless */ }
    try{
      const p = root.player;
      if(p && typeof p === 'object'){
        p.xp = (Number(p.xp) || 0) + DISCOVERY_XP;
        if(typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function'){
          root.dispatchEvent(new root.CustomEvent('mm-xp-awarded', {detail:{amount:DISCOVERY_XP, special:true, source:'discovery'}}));
        }
      }
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
  // Journal-tab view (Ekwipunek → Odkrycia): every catalog entry, found ones
  // with their label, unfound ones masked to "???" + category hint.
  function entries(){
    return Object.keys(CATALOG).map(id => {
      const found = seen.has(id);
      const h = HINTS[id] || {};
      return {id, found, label: found ? CATALOG[id] : null, cat: h.cat || '❔ Sekrety', hint: h.hint || ''};
    });
  }
  function reset(){ seen.clear(); persist(); }

  const api = { note, has, count, list, total, label, progress, entries, CATALOG, HINTS, DISCOVERY_XP, reset };
  MM.discovery = api;
  return api;
})();

export { discovery };
export default discovery;
