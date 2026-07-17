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
    electric_weapon_charge: 'Karabin elektryczny ładuje baterie urządzeń',
    react_freeze:   'Mokry wróg + mróz = bryła lodu',
    react_thermal:  'Szok termiczny (ogień na zmrożonym)',
    react_toxic:    'Toksyczny zapłon (ogień + trucizna)',
    react_chain:    'Porażenie łańcuchowe po mokrych celach',
    arrow_recover:  'Strzały, które nie pękły, da się odzyskać',
    parry:          'Perfekcyjna parada odbija pociski',
    melee_bleed:    'Metalowe ostrza otwierają krwawiące rany',
    melee_stun:     'Kamienny obuch potrafi oszołomić',
    melee_panic:    'Błysk diamentu sieje panikę',
    sand_blind:     'Piasek w oczy oślepia wroga',
    spit_toxic:     'Plucie wodą bywa toksyczne',
    sandstorm:      'Pustynna wichura usypuje wydmy',
    hero_conduct:   'Mokry bohater przewodzi prąd (x1.5)',
    hero_frozen:    'Mokry + zziębnięty na mrozie = zamarzasz',
    hero_fizzle:    'Ogień gaśnie na przemoczonym bohaterze',
    mob_gear:       'Pokonane stwory gubią swoje rzemiosło',
    epic_drop:      'Epicki łup ogłasza się słupem światła',
    jewel_drop:     'Jewel trwale ulepsza wybrany przedmiot',
    volcano_sacrifice: 'Wulkan przyjmuje ofiary i oddaje z nawiązką',
    // Category discoveries (main.js noteCategoryDiscoveries): the FIRST unlocked
    // recipe of a craft group / first held block of a picker group opens the
    // category — tab/chip appears and the journal pays the discovery XP.
    craft_cat_survival:   'Dział Rzemiosła: Start',
    craft_cat_tools:      'Dział Rzemiosła: Narzędzia',
    craft_cat_building:   'Dział Rzemiosła: Budowle',
    craft_cat_processing: 'Dział Rzemiosła: Przerób',
    craft_cat_weapons:    'Dział Rzemiosła: Walka',
    craft_cat_machines:   'Dział Rzemiosła: Maszyny',
    craft_cat_alchemy:    'Dział Rzemiosła: Eliksiry',
    craft_cat_relics:     'Dział Rzemiosła: Relikty',
    craft_cat_furniture:  'Dział Rzemiosła: Meble',
    craft_cat_decor:      'Dział Rzemiosła: Dekoracje',
    craft_cat_electronics:'Dział Rzemiosła: Elektronika domowa',
    craft_cat_wonders:    'Dział Rzemiosła: Osobliwości domowe',
    block_cat_basic:      'Katalog bloków: Podstawowe',
    block_cat_rock:       'Katalog bloków: Skały i rudy',
    block_cat_build:      'Katalog bloków: Budulce',
    block_cat_machine:    'Katalog bloków: Maszyny',
    block_cat_utility:    'Katalog bloków: Instalacje',
    block_cat_food:       'Katalog bloków: Jedzenie',
    block_cat_home:       'Katalog bloków: Wyposażenie domu',
    // Surface biomes: crossing into each one for the first time is exploration
    // knowledge, using the same one-shot toast and XP reward as other entries.
    biome_forest:    'Biom: Las',
    biome_plains:    'Biom: Równiny',
    biome_snow:      'Biom: Śnieg/Lód',
    biome_desert:    'Biom: Pustynia',
    biome_swamp:     'Biom: Bagno',
    biome_sea:       'Biom: Morze',
    biome_lake:      'Biom: Jezioro',
    biome_mountains: 'Biom: Góry',
    biome_city:      'Biom: Zniszczone miasto',
    // Sky biomes (world_layers.js SKY_BIOMES): first flight into each themed
    // region of the high heavens is a discovery (mobs.js sky pressure notes it).
    sky_biome_heaven:  'Podniebna kraina: Rajskie Wyżyny',
    sky_biome_skywood: 'Podniebna kraina: Podniebna Puszcza',
    sky_biome_balloon: 'Podniebna kraina: Balonowy Gaj',
    sky_biome_storm:   'Podniebna kraina: Burzowa Kuźnia',
    sky_biome_frost:   'Podniebna kraina: Lodowa Korona',
    sky_biome_mirage:  'Podniebna kraina: Ogrody Fatamorgany',
    sky_biome_wreck:   'Podniebna kraina: Rdzawa Flotylla',
    sky_biome_spore:   'Podniebna kraina: Zarodnikowa Rafa',
    sky_biome_void:    'Podniebna kraina: Grawitacyjna Otchłań',
    sky_biome_roost:   'Podniebna kraina: Gniazdowisko Harpii',
    sky_biome_ember:   'Podniebna kraina: Żarowe Łuki',
    // Steam circuit (engine/steam_machines.js + mech flight in engine/mechs.js)
    steam_lift:   'Kolumna pary unosi wszystko nad dyszą',
    steam_flight: 'Parowy mech wzbija się w powietrze',
    // Antenna actives (engine/antennas.js — first firing of each Q-power)
    antenna_cloak: 'Kamuflaż antenki: stwory tracą cię z oczu',
    antenna_surge: 'Przepięcie antenki: zryw prędkości',
    antenna_echo:  'Echolokacja antenki: pingi przez ściany',
  };
  const CATALOG_IDS=Object.freeze(Object.keys(CATALOG));
  const CATALOG_SET=new Set(CATALOG_IDS);
  const CATALOG_COUNT=CATALOG_IDS.length;
  const PROFILE_RAW_CAP=32768;
  const PROFILE_SCAN_CAP=512;
  const DISCOVERY_XP_CAP=1000000000;
  // Undiscovered entries show as "???" in the Ekwipunek journal tab, with only
  // the category and a foggy hint — enough to hunt, not enough to spoil.
  const HINTS = {
    biome_forest:    {cat:'Biomy', hint:'Wyrusz między drzewa i poszukaj zielonej krainy…'},
    biome_plains:    {cat:'Biomy', hint:'Szeroki, otwarty horyzont czeka poza lasem…'},
    biome_snow:      {cat:'Biomy', hint:'Daleko od ciepłych ziem śnieg przykrywa powierzchnię…'},
    biome_desert:    {cat:'Biomy', hint:'Idź tam, gdzie deszcz ustępuje piaskowi i skwarowi…'},
    biome_swamp:     {cat:'Biomy', hint:'Wilgotna, grząska kraina kryje się pośród zieleni…'},
    biome_sea:       {cat:'Biomy', hint:'Odszukaj wodę, której drugi brzeg znika za horyzontem…'},
    biome_lake:      {cat:'Biomy', hint:'Nie każda wielka tafla wody prowadzi do oceanu…'},
    biome_mountains: {cat:'Biomy', hint:'Wspinaj się tam, gdzie ziemia wyrasta ku chmurom…'},
    biome_city:      {cat:'Biomy', hint:'Gdzieś na powierzchni stoją ruiny dawnej cywilizacji…'},
    stone_melt:     {cat:'🔥 Żywioły i teren',   hint:'Bardzo gorący strumień zmienia twardą skałę w coś płynnego…'},
    sand_glass:     {cat:'🔥 Żywioły i teren',   hint:'Pustynny materiał pod długim żarem robi się przezroczysty…'},
    water_boil:     {cat:'🔥 Żywioły i teren',   hint:'Płomień nad taflą nie zostaje bez odpowiedzi…'},
    gas_boom:       {cat:'🔥 Żywioły i teren',   hint:'Pewien obłok bardzo nie lubi otwartego ognia…'},
    electric_water: {cat:'⚗️ Reakcje bojowe',    hint:'Prąd puszczony w pewien żywioł niesie się dalej, niż celujesz…'},
    electric_weapon_charge: {cat:'🏹 Techniki', hint:'Nie każda wiązka elektryczna musi służyć do niszczenia…'},
    react_freeze:   {cat:'⚗️ Reakcje bojowe',    hint:'Dwa zimne i mokre statusy na jednym celu dają coś twardego…'},
    react_thermal:  {cat:'⚗️ Reakcje bojowe',    hint:'Skrajne temperatury zderzone na jednym celu bolą podwójnie…'},
    react_toxic:    {cat:'⚗️ Reakcje bojowe',    hint:'Trucizna w żyłach + iskra z zewnątrz…'},
    react_chain:    {cat:'⚗️ Reakcje bojowe',    hint:'Kilka przemoczonych celów blisko siebie i odrobina prądu…'},
    arrow_recover:  {cat:'🏹 Techniki',          hint:'Nie każdy wystrzelony pocisk ginie bezpowrotnie…'},
    parry:          {cat:'🏹 Techniki',          hint:'Obrona podniesiona w idealnym momencie robi coś więcej…'},
    melee_bleed:    {cat:'🏹 Techniki',          hint:'Broń z pewnego kruszcu zostawia rany, które nie chcą się zamknąć…'},
    melee_stun:     {cat:'🏹 Techniki',          hint:'Ciężki, tępy materiał czasem zatrzymuje cel w miejscu…'},
    melee_panic:    {cat:'🏹 Techniki',          hint:'Najtwardszy klejnot świata budzi w stworach czysty strach…'},
    sand_blind:     {cat:'🏹 Techniki',          hint:'Garść czegoś sypkiego rzucona w ślepia…'},
    spit_toxic:     {cat:'🏹 Techniki',          hint:'Nabierz łyk i spróbuj splunąć w stwora — bywa gorzej niż mokro…'},
    sandstorm:      {cat:'🌪 Pogoda',            hint:'Wschodnia pustynia przy naprawdę silnym wietrze…'},
    hero_conduct:   {cat:'🧍 Na własnej skórze', hint:'Przemocz się i stań na drodze porażenia…'},
    hero_frozen:    {cat:'🧍 Na własnej skórze', hint:'Dwa zimna naraz, daleko na zachodzie, pod gołym niebem…'},
    hero_fizzle:    {cat:'🧍 Na własnej skórze', hint:'Dobrze przemoczony możesz wejść tam, gdzie zwykle parzy…'},
    mob_gear:       {cat:'🎁 Łupy',              hint:'To, czym stwór walczy albo czym jest, może po nim zostać…'},
    epic_drop:      {cat:'🎁 Łupy',              hint:'Na krańcach świata spadają skarby, których nie sposób przegapić…'},
    jewel_drop:     {cat:'🎁 Łupy',              hint:'Najpotężniejsi przeciwnicy mogą zgubić kamień, który zmienia przedmiot na zawsze…'},
    volcano_sacrifice: {cat:'🎁 Łupy',           hint:'Zwykły przedmiot wrzucony w ogień góry czasem wraca lepszy…'},
    craft_cat_survival:   {cat:'📚 Katalogi', hint:'Pierwsze deski i pierwsza noc otwierają najprostszy dział…'},
    craft_cat_tools:      {cat:'📚 Katalogi', hint:'Twardszy surowiec w plecaku podpowiada lepsze narzędzia…'},
    craft_cat_building:   {cat:'📚 Katalogi', hint:'Zapas budulca budzi w głowie plany konstrukcji…'},
    craft_cat_processing: {cat:'📚 Katalogi', hint:'Niektóre surowce chcą być wypalone w coś nowego…'},
    craft_cat_weapons:    {cat:'📚 Katalogi', hint:'Materiał na grot i drzewce to początek arsenału…'},
    craft_cat_machines:   {cat:'📚 Katalogi', hint:'Metal, przewody i części z ruin miast składają się w maszyny…'},
    craft_cat_alchemy:    {cat:'📚 Katalogi', hint:'Woda i coś żywego — tak zaczynają się eliksiry…'},
    craft_cat_relics:     {cat:'📚 Katalogi', hint:'Trofea i klejnoty proszą się o oprawę…'},
    craft_cat_furniture:  {cat:'📚 Katalogi', hint:'Kilka desek może znaczyć coś więcej niż kolejną ścianę…'},
    craft_cat_decor:      {cat:'📚 Katalogi', hint:'Szkło, glina i odrobina zieleni potrafią odmienić schronienie…'},
    craft_cat_electronics:{cat:'📚 Katalogi', hint:'Części ze zniszczonego miasta mogą znów umilić codzienność…'},
    craft_cat_wonders:    {cat:'📚 Katalogi', hint:'Relikty z krańców świata nie muszą służyć wyłącznie do walki…'},
    block_cat_basic:      {cat:'📚 Katalogi', hint:'Pierwszy wykopany blok otwiera katalog podstaw…'},
    block_cat_rock:       {cat:'📚 Katalogi', hint:'Pod powierzchnią czekają skały i kruszce…'},
    block_cat_build:      {cat:'📚 Katalogi', hint:'Przetworzone materiały tworzą półkę budulców…'},
    block_cat_machine:    {cat:'📚 Katalogi', hint:'Złożone urządzenia trafiają na osobną półkę…'},
    block_cat_utility:    {cat:'📚 Katalogi', hint:'Drabiny, rury, przewody — infrastruktura ma swoją kartę…'},
    block_cat_food:       {cat:'📚 Katalogi', hint:'Zapasy jedzenia zasługują na własną spiżarnię…'},
    block_cat_home:       {cat:'📚 Katalogi', hint:'Pierwszy wykonany mebel otwiera katalog domowego wyposażenia…'},
    sky_biome_heaven:  {cat:'🌌 Podniebne krainy', hint:'Gdzieś wysoko lśnią białe wyspy ze złotem w sercu…'},
    sky_biome_skywood: {cat:'🌌 Podniebne krainy', hint:'Ponoć las potrafi rosnąć nawet bez ziemi pod korzeniami…'},
    sky_biome_balloon: {cat:'🌌 Podniebne krainy', hint:'Drzewa o koronach lekkich jak balony unoszą całe wyspy…'},
    sky_biome_storm:   {cat:'🌌 Podniebne krainy', hint:'Nad chmurami ktoś wykuwa pioruny na bazaltowych kowadłach…'},
    sky_biome_frost:   {cat:'🌌 Podniebne krainy', hint:'Najzimniejszy lód świata wcale nie leży na ziemi…'},
    sky_biome_mirage:  {cat:'🌌 Podniebne krainy', hint:'Szklane kopuły i złoto pośród piasku, który nie powinien latać…'},
    sky_biome_wreck:   {cat:'🌌 Podniebne krainy', hint:'Cała flotylla stalowych kadłubów dryfuje bez załogi…'},
    sky_biome_spore:   {cat:'🌌 Podniebne krainy', hint:'Świecąca rafa unosi się w powietrzu i oddycha trującym pyłem…'},
    sky_biome_void:    {cat:'🌌 Podniebne krainy', hint:'Obsydianowe bryły krążą wokół czegoś, co wygina grawitację…'},
    sky_biome_roost:   {cat:'🌌 Podniebne krainy', hint:'Wielkie gniazda z kości i drewna. Coś je uwiło. Coś dużego…'},
    sky_biome_ember:   {cat:'🌌 Podniebne krainy', hint:'Łuki żaru i lawy płoną wysoko nad wschodnimi pustkowiami…'},
    steam_lift:   {cat:'⚙️ Maszyny parowe', hint:'Woda, żar i dysza skierowana w niebo — stań nad nią…'},
    steam_flight: {cat:'⚙️ Maszyny parowe', hint:'Kadłub z fotelem, kocioł z wodą i rząd dysz od spodu…'},
    antenna_cloak: {cat:'📡 Antenki', hint:'Pewna antenka potrafi zgiąć światło wokół ciebie — naciśnij Q…'},
    antenna_surge: {cat:'📡 Antenki', hint:'Burzowa antenka magazynuje iskrę do nóg — naciśnij Q…'},
    antenna_echo:  {cat:'📡 Antenki', hint:'Czułek-echosonda słyszy przez skałę — naciśnij Q…'},
  };
  const BIOME_DISCOVERY_IDS = Object.freeze([
    'biome_forest',
    'biome_plains',
    'biome_snow',
    'biome_desert',
    'biome_swamp',
    'biome_sea',
    'biome_lake',
    'biome_mountains',
    'biome_city'
  ]);
  const DISCOVERY_XP = 40; // every fresh journal entry pays experience (progress.js levels off player.xp)

  const seen = new Set();
  try{
    if(typeof localStorage !== 'undefined'){
      const raw = localStorage.getItem(KEY);
      if(typeof raw==='string' && raw.length<=PROFILE_RAW_CAP){
        const arr = JSON.parse(raw);
        if(Array.isArray(arr)){
          // The catalog is the schema. Ignore unknown/corrupt entries so a
          // tampered profile cannot inflate progress beyond n/total or retain
          // an unbounded collection of arbitrary strings.
          const count=Math.min(arr.length,PROFILE_SCAN_CAP);
          for(let i=0;i<count;i++){
            const id=arr[i];
            if(typeof id === 'string' && CATALOG_SET.has(id)) seen.add(id);
            if(seen.size>=CATALOG_COUNT) break;
          }
        }
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
  // An empty text = SILENT entry (no toast, no jingle) — used when seeding
  // knowledge a loaded save already earned (category migration).
  function note(id, text){
    if(typeof id !== 'string' || !CATALOG_SET.has(id)) return false;
    if(seen.has(id)) return false;
    seen.add(id);
    persist();
    const loud = typeof text === 'string' && !!text;
    let awarded=0;
    try{
      // silent (migration) entries record knowledge without paying XP again
      const p = root.player;
      if(loud && p && typeof p === 'object'){
        const rawXp=Number(p.xp);
        const xp=Number.isFinite(rawXp) ? Math.max(0,Math.min(DISCOVERY_XP_CAP,rawXp)) : 0;
        const next=Math.min(DISCOVERY_XP_CAP,xp+DISCOVERY_XP);
        awarded=Math.max(0,next-xp);
        p.xp=next;
        if(awarded>0 && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function'){
          root.dispatchEvent(new root.CustomEvent('mm-xp-awarded', {detail:{amount:awarded, special:true, source:'discovery'}}));
        }
      }
    }catch(e){ /* headless */ }
    try{
      if(root.msg && loud) root.msg('🧪 Odkrycie: ' + text + (awarded>0 ? ' (+' + awarded + ' XP)' : ''));
    }catch(e){ /* headless */ }
    try{
      if(loud && root.MM.audio && root.MM.audio.play) root.MM.audio.play('chest');
    }catch(e){ /* no audio */ }
    return true;
  }

  function noteBiome(biomeId, biomeLabel){
    const n=Number(biomeId);
    if(!Number.isInteger(n) || n<0 || n>=BIOME_DISCOVERY_IDS.length) return false;
    const id=BIOME_DISCOVERY_IDS[n];
    const fallback=String(CATALOG[id] || id).replace(/^Biom:\s*/, '');
    const label=typeof biomeLabel==='string' && biomeLabel.trim() ? biomeLabel.trim() : fallback;
    return note(id, 'Nowy biom: '+label+'!');
  }

  function has(id){ return seen.has(String(id)); }
  function count(){ return seen.size; }
  function list(){ return [...seen]; }
  function total(){ return CATALOG_COUNT; }
  function label(id){ return CATALOG[id] || String(id); }
  // Help-panel view: found entries by label plus the remaining count.
  function progress(){
    const found = [...seen].filter(id => CATALOG[id]).map(id => ({id, label: CATALOG[id]}));
    return {count: found.length, total: total(), found};
  }
  // Journal-tab view (Ekwipunek → Odkrycia): every catalog entry, found ones
  // with their label, unfound ones masked to "???" + category hint.
  function entries(){
    return CATALOG_IDS.map(id => {
      const found = seen.has(id);
      const h = HINTS[id] || {};
      return {id, found, label: found ? CATALOG[id] : null, cat: h.cat || '❔ Sekrety', hint: h.hint || ''};
    });
  }
  function reset(){ seen.clear(); persist(); }

  const api = { note, noteBiome, has, count, list, total, label, progress, entries, CATALOG, HINTS, BIOME_DISCOVERY_IDS, DISCOVERY_XP, reset };
  MM.discovery = api;
  return api;
})();

export { discovery };
export default discovery;
