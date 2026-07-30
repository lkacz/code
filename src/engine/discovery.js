import { KNOWLEDGE_CATALOG, KNOWLEDGE_STAGES } from './discovery_catalog.js';

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
  const LEGACY_CATALOG = {
    stone_melt:     'Ogień topi kamień w lawę',
    sand_glass:     'Rozgrzany piasek wytapia się w szkło',
    water_boil:     'Płomień gotuje wodę w parę',
    energy_sprint:  'Energia napędza szybszy bieg i wyższy skok',
    energy_dynamo:  'Dynamo oddaje zgromadzoną energię bohaterowi',
    solar_charge:   'Słońce ładuje bohatera na pustyni i w koronach drzew',
    uranium_charge: 'Promieniotwórcza ruda powoli zasila energię bohatera',
    shelter_healing:'Dach, ściany i światło zmieniają dom w miejsce leczenia',
    gas_boom:       'Obłok gazu detonuje od ognia',
    electric_water: 'Prąd elektryzuje całą taflę wody',
    electric_weapon_charge: 'Karabin elektryczny ładuje baterie urządzeń',
    react_freeze:   'Mokry wróg + mróz = bryła lodu',
    react_thermal:  'Szok termiczny (ogień na zmrożonym)',
    react_toxic:    'Toksyczny zapłon (ogień + trucizna)',
    react_chain:    'Porażenie łańcuchowe po mokrych celach',
    arrow_recover:  'Strzały, które nie pękły, da się odzyskać',
    rubber_ricochet:'Kauczukowa kulka odbija się od wroga w następnego',
    rubber_napalm:  'Smołowa kulka łapie ogień i roznosi go rykoszetem',
    grav_bedrock:   'Skała macierzysta nie da się wyrwać nawet grawitacją',
    grav_golden:    'Złoty pień rozbity w locie płaci dziesięciokrotnie',
    grav_bait:      'Rzucone mięso ściąga drapieżniki do miejsca upadku',
    grav_feed:      'Blokowy kolos wchłania rzucone bloki i rośnie',
    parry:          'Perfekcyjna parada odbija pociski',
    melee_bleed:    'Metalowe ostrza otwierają krwawiące rany',
    melee_stun:     'Kamienny obuch potrafi oszołomić',
    melee_panic:    'Błysk diamentu sieje panikę',
    sand_blind:     'Piasek w oczy oślepia wroga',
    spit_toxic:     'Plucie wodą bywa toksyczne',
    grapple_swing:  'Hak na linie podciąga cię do terenu',
    sandstorm:      'Pustynna wichura usypuje wydmy',
    soft_drifts:    'Miękkie zaspy rozsypują się w biegu',
    leaf_gale:      'Jesienna zamieć niesie liście z wiatrem',
    snow_gale:      'Śnieżna zamieć przywiewa zaspy',
    sand_gale:      'Pustynna zamieć niesie tumany piasku',
    soot_gale:      'Zamieć sadzy grzebie świat pod całunem',
    pollen_gale:    'Wiosenna zamieć niesie złoty pyłek kwiatów',
    graphite:       'Gęsta sadza prasuje się w grafit',
    graphene:       'Prąd wyżarza grafit w grafen',
    smr:            'Ogniwo SMR — wieczna iskra pod opieką',
    avalanche:      'Wstrząs zrzuca lawinę z zaśnieżonego zbocza',
    icicle:         'Odwilż strąca sople — lód spada i rani',
    thin_ice:       'Cienki lód trzeszczy, pęka i topi śmiałków',
    slain_guardian_fire:  'Bestiariusz: ukojony Strażnik Ognia (wschodni żar)',
    slain_guardian_ice:   'Bestiariusz: rozmrożony Strażnik Lodu (zachodni chłód)',
    slain_guardian_earth: 'Bestiariusz: uśpiony Trzeci Kret (głębinowy)',
    slain_guardian_air:   'Bestiariusz: ściągnięty Strażnik Nieba',
    slain_guardian_mother:'Bestiariusz: cisza w samym środku świata',
    hot_spring:     'Lawa grzeje kamień, kamień grzeje wodę',
    morning_fog:    'Poranna mgła zalega w dolinach',
    aurora:         'Zorza polarna ładuje powietrze energią',
    weathervane:    'Wiatrowskaz pokazuje żywy wiatr',
    lightning_rod:  'Piorunochron zamienia burzę w żniwa',
    waterhole:      'Zwierzyna schodzi się do wodopoju',
    storm_birds:    'Ptaki zrywają się na długo przed zamiecią',
    graffiti:       'Sadza to pigment — znaki prowadzą drużynę',
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
  const generatedCatalog=Object.fromEntries(KNOWLEDGE_CATALOG.map(row=>[row.id,row.label]));
  for(const id of Object.keys(generatedCatalog)){
    if(Object.prototype.hasOwnProperty.call(LEGACY_CATALOG,id)) throw new Error('Duplicate discovery id: '+id);
  }
  const CATALOG=Object.freeze(Object.assign({},LEGACY_CATALOG,generatedCatalog));
  const CATALOG_IDS=Object.freeze(Object.keys(CATALOG));
  const CATALOG_SET=new Set(CATALOG_IDS);
  const CATALOG_COUNT=CATALOG_IDS.length;
  const PROFILE_RAW_CAP=131072;
  const PROFILE_SCAN_CAP=Math.max(512,Math.min(4096,CATALOG_COUNT+128));
  const DISCOVERY_XP_CAP=1000000000;
  // Undiscovered entries show as "???" in the Ekwipunek journal tab, with only
  // the category and a foggy hint — enough to hunt, not enough to spoil.
  const LEGACY_HINTS = {
    biome_forest:    {cat:'Biomy', hint:'Wyrusz między drzewa i poszukaj zielonej krainy…'},
    biome_plains:    {cat:'Biomy', hint:'Szeroki, otwarty horyzont czeka poza lasem…'},
    biome_snow:      {cat:'Biomy', hint:'Daleko od ciepłych ziem śnieg przykrywa powierzchnię…'},
    biome_desert:    {cat:'Biomy', hint:'Idź tam, gdzie deszcz ustępuje piaskowi i skwarowi…'},
    biome_swamp:     {cat:'Biomy', hint:'Wilgotna, grząska kraina kryje się pośród zieleni…'},
    biome_sea:       {cat:'Biomy', hint:'Odszukaj wodę, której drugi brzeg znika za horyzontem…'},
    biome_lake:      {cat:'Biomy', hint:'Nie każda wielka tafla wody prowadzi do oceanu…'},
    biome_mountains: {cat:'Biomy', hint:'Wspinaj się tam, gdzie ziemia wyrasta ku chmurom…'},
    biome_city:      {cat:'Biomy', hint:'Gdzieś na powierzchni stoją ruiny dawnej cywilizacji…'},
    stone_melt:     {cat:'🔥 Żywioły i teren',   hint:'Bardzo gorący strumień zmienia twardą skałę w coś płynnego…', tier:'application'},
    sand_glass:     {cat:'🔥 Żywioły i teren',   hint:'Pustynny materiał pod długim żarem robi się przezroczysty…', tier:'application'},
    water_boil:     {cat:'🔥 Żywioły i teren',   hint:'Płomień nad taflą nie zostaje bez odpowiedzi…', tier:'observation', icon:'💨', chain:'steam'},
    energy_sprint:  {cat:'⚡ Energia bohatera',  hint:'Spróbuj poruszać się szybciej, kiedy masz energię do wydania…', tier:'observation', icon:'»', chain:'hero_energy'},
    energy_dynamo:  {cat:'⚡ Energia bohatera',  hint:'Podejdź do pracującego dynama, mając niepełny pasek energii…', tier:'principle', icon:'⚡', chain:'hero_energy'},
    solar_charge:   {cat:'⚡ Energia bohatera',  hint:'W pełnym słońcu niektóre wysokie lub gorące miejsca sprzyjają ładowaniu…', tier:'observation', icon:'☀', chain:'hero_energy'},
    uranium_charge: {cat:'⚡ Energia bohatera',  hint:'Zbliż się do promieniotwórczej rudy z niepełną energią…', tier:'application', icon:'☢', chain:'hero_energy'},
    shelter_healing:{cat:'🏠 Dom i schronienie', hint:'Zamknij oświetloną przestrzeń dachem i ścianami, a potem odpocznij…', tier:'principle', icon:'♥', chain:'shelter'},
    gas_boom:       {cat:'🔥 Żywioły i teren',   hint:'Pewien obłok bardzo nie lubi otwartego ognia…', tier:'application'},
    electric_water: {cat:'⚗️ Reakcje bojowe',    hint:'Prąd puszczony w pewien żywioł niesie się dalej, niż celujesz…', tier:'application'},
    electric_weapon_charge: {cat:'🏹 Techniki', hint:'Nie każda wiązka elektryczna musi służyć do niszczenia…'},
    react_freeze:   {cat:'⚗️ Reakcje bojowe',    hint:'Dwa zimne i mokre statusy na jednym celu dają coś twardego…', tier:'application'},
    react_thermal:  {cat:'⚗️ Reakcje bojowe',    hint:'Skrajne temperatury zderzone na jednym celu bolą podwójnie…', tier:'application'},
    react_toxic:    {cat:'⚗️ Reakcje bojowe',    hint:'Trucizna w żyłach + iskra z zewnątrz…', tier:'application'},
    react_chain:    {cat:'⚗️ Reakcje bojowe',    hint:'Kilka przemoczonych celów blisko siebie i odrobina prądu…', tier:'application'},
    slain_guardian_fire:  {cat:'📖 Bestiariusz', hint:'Ukój wschodni żar, a jego serce trafi do kroniki…', tier:'breakthrough'},
    slain_guardian_ice:   {cat:'📖 Bestiariusz', hint:'Zgaś zachodni chłód, by zapisać go w bestiariuszu…', tier:'breakthrough'},
    slain_guardian_earth: {cat:'📖 Bestiariusz', hint:'Obudź i uśpij Trzeciego Kreta pod ziemią…', tier:'breakthrough'},
    slain_guardian_air:   {cat:'📖 Bestiariusz', hint:'Ściągnij ambicję z nieba, a karta się odsłoni…', tier:'breakthrough'},
    slain_guardian_mother:{cat:'📖 Bestiariusz', hint:'Dotrzyj do samego środka świata i spotkaj siebie…', tier:'breakthrough'},
    arrow_recover:  {cat:'🏹 Techniki',          hint:'Nie każdy wystrzelony pocisk ginie bezpowrotnie…'},
    rubber_ricochet:{cat:'🏹 Techniki',          hint:'Jeden pocisk, dwóch trafionych — jeśli materiał jest dość sprężysty…'},
    grav_bedrock:   {cat:'🏹 Techniki',          hint:'Wyceluj działko grawitacyjne w dno świata i patrz, jak odmawia…'},
    grav_golden:    {cat:'🏹 Techniki',          hint:'Najrzadsze drzewo świata może polecieć — i pęknąć — z zyskiem…'},
    grav_bait:      {cat:'🏹 Techniki',          hint:'Głodny świat słyszy, gdzie upada coś jadalnego…'},
    grav_feed:      {cat:'🏹 Techniki',          hint:'Rzuć blokiem w coś, co samo jest zbudowane z bloków…'},
    rubber_napalm:  {cat:'🏹 Techniki',          hint:'Przeprowadź coś nasyconego smołą przez płomień i patrz, dokąd to poleci…'},
    parry:          {cat:'🏹 Techniki',          hint:'Obrona podniesiona w idealnym momencie robi coś więcej…'},
    melee_bleed:    {cat:'🏹 Techniki',          hint:'Broń z pewnego kruszcu zostawia rany, które nie chcą się zamknąć…'},
    melee_stun:     {cat:'🏹 Techniki',          hint:'Ciężki, tępy materiał czasem zatrzymuje cel w miejscu…'},
    melee_panic:    {cat:'🏹 Techniki',          hint:'Najtwardszy klejnot świata budzi w stworach czysty strach…'},
    sand_blind:     {cat:'🏹 Techniki',          hint:'Garść czegoś sypkiego rzucona w ślepia…'},
    spit_toxic:     {cat:'🏹 Techniki',          hint:'Nabierz łyk i spróbuj splunąć w stwora — bywa gorzej niż mokro…'},
    grapple_swing:  {cat:'🏹 Techniki',          hint:'Zaczep hak na twardej skale i daj się pociągnąć…'},
    sandstorm:      {cat:'🌪 Pogoda',            hint:'Wschodnia pustynia przy naprawdę silnym wietrze…'},
    soft_drifts:    {cat:'🌪 Pogoda',            hint:'Przebiegnij przez to, co zima i jesień usypały na ziemi…'},
    leaf_gale:      {cat:'🌪 Pogoda',            hint:'Jesienią, gdy wichura targa koronami drzew…'},
    snow_gale:      {cat:'🌪 Pogoda',            hint:'Zimą, gdy mroźny wiatr wieje naprawdę mocno…'},
    sand_gale:      {cat:'🌪 Pogoda',            hint:'Pustynna wichura niesie coś drobniejszego niż wydmy…'},
    soot_gale:      {cat:'🌪 Pogoda',            hint:'Czarna postać z węgla umie przyzwać czarny wiatr…'},
    pollen_gale:    {cat:'🌪 Pogoda',            hint:'Wiosną, gdy wiatr targa kwitnącą ziemię…'},
    graphite:       {cat:'⚙ Przemysł',           hint:'Pozwól czarnemu dymowi długo osiadać w jednym miejscu…', tier:'application', chain:'carbon'},
    graphene:       {cat:'⚙ Przemysł',           hint:'Grafitowa żyła a raz po raz uderzający w nią prąd…', tier:'breakthrough', chain:'carbon', requires:['graphite']},
    smr:            {cat:'⚙ Przemysł',           hint:'Grafit, coś promieniotwórczego i garść elektroniki…', tier:'breakthrough', chain:'carbon', requires:['graphene']},
    avalanche:      {cat:'🌪 Pogoda',            hint:'Głęboki śnieg na stromym zboczu nie lubi wstrząsów…'},
    icicle:         {cat:'🌪 Pogoda',            hint:'Zimny nawis z wilgocią nad głową, a potem odwilż…'},
    thin_ice:       {cat:'🌪 Pogoda',            hint:'Mroźną zimą jezioro wygląda na przejezdne…'},
    hot_spring:     {cat:'🌍 Świat',             hint:'Woda, pod nią kamień, pod kamieniem coś bardzo gorącego…'},
    morning_fog:    {cat:'🌍 Świat',             hint:'Wstań przed świtem w bezwietrznej dolinie…'},
    aurora:         {cat:'🌍 Świat',             hint:'Mroźna, bezchmurna noc w lodowych krainach…'},
    weathervane:    {cat:'⚙ Przemysł',           hint:'Stal i drewno na dachu zdradzą, skąd wieje…'},
    lightning_rod:  {cat:'⚙ Przemysł',           hint:'Postaw wysoki metalowy maszt i poczekaj na burzę…', tier:'application'},
    waterhole:      {cat:'🌍 Świat',             hint:'Obserwuj brzeg jeziora o świcie albo zmierzchu…'},
    storm_birds:    {cat:'🌍 Świat',             hint:'Patrz na ptaki, gdy wiatr rośnie a chmury ciemnieją…'},
    graffiti:       {cat:'🌍 Świat',             hint:'Czarny pigment i ściana — zostaw drużynie wiadomość…'},
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
    steam_lift:   {cat:'⚙️ Maszyny parowe', hint:'Woda, żar i dysza skierowana w niebo — stań nad nią…', tier:'application', chain:'steam', requires:['water_boil']},
    steam_flight: {cat:'⚙️ Maszyny parowe', hint:'Kadłub z fotelem, kocioł z wodą i rząd dysz od spodu…', tier:'breakthrough', chain:'steam', requires:['steam_lift']},
    antenna_cloak: {cat:'📡 Antenki', hint:'Pewna antenka potrafi zgiąć światło wokół ciebie — naciśnij Q…'},
    antenna_surge: {cat:'📡 Antenki', hint:'Burzowa antenka magazynuje iskrę do nóg — naciśnij Q…'},
    antenna_echo:  {cat:'📡 Antenki', hint:'Czułek-echosonda słyszy przez skałę — naciśnij Q…'},
  };
  const generatedHints=Object.fromEntries(KNOWLEDGE_CATALOG.map(row=>[row.id,{
    cat:row.cat,
    hint:row.hint,
    tier:row.tier,
    stage:row.stage,
    chain:row.chain,
    icon:row.icon,
    requires:row.requires.slice(),
    order:row.order
  }]));
  const HINTS=Object.freeze(Object.assign({},LEGACY_HINTS,generatedHints));
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
  // Reward bands keep the total economy close to the old flat 40 XP while
  // letting the journal communicate a real ladder: notice → understand → use
  // deliberately → achieve a breakthrough.
  const DISCOVERY_TIERS=Object.freeze({
    observation:Object.freeze({id:'observation',rank:1,label:'Obserwacja',xp:20,color:'#83d5ff',icon:'!'}),
    principle:Object.freeze({id:'principle',rank:2,label:'Zasada',xp:40,color:'#9fe2b2',icon:'◆'}),
    application:Object.freeze({id:'application',rank:3,label:'Zastosowanie',xp:75,color:'#ffca72',icon:'✦'}),
    breakthrough:Object.freeze({id:'breakthrough',rank:4,label:'Przełom',xp:120,color:'#e5a7ff',icon:'★'})
  });
  const DISCOVERY_STAGES=KNOWLEDGE_STAGES;
  const DISCOVERY_XP = DISCOVERY_TIERS.principle.xp; // compatibility: the default band
  function isCollectionId(id){
    return /^(?:craft_cat_|block_cat_|biome_|sky_biome_|slain_guardian_)/.test(id)
      || id==='legendary_chest';
  }
  function tierKeyFor(id,hint){
    if(hint && DISCOVERY_TIERS[hint.tier]) return hint.tier;
    if(/^(?:craft_cat_|block_cat_|biome_|sky_biome_)/.test(id)) return 'observation';
    if(/^slain_guardian_/.test(id)) return 'breakthrough';
    if(/^react_/.test(id)) return 'application';
    return 'principle';
  }
  function stageKeyFor(id,hint,tierKey){
    if(hint && DISCOVERY_STAGES[hint.stage]) return hint.stage;
    if(tierKey==='observation' || /^(?:craft_cat_|block_cat_|biome_|sky_biome_)/.test(id)) return 'observation';
    if(tierKey==='principle') return 'insight';
    return 'discovery';
  }
  function buildMeta(id){
    const hint=HINTS[id]||{};
    const tierKey=tierKeyFor(id,hint);
    const tier=DISCOVERY_TIERS[tierKey]||DISCOVERY_TIERS.principle;
    const stageKey=stageKeyFor(id,hint,tierKey);
    const stage=DISCOVERY_STAGES[stageKey]||DISCOVERY_STAGES.discovery;
    const collection=isCollectionId(id);
    const requires=(Array.isArray(hint.requires)?hint.requires:[])
      .filter(req=>typeof req==='string' && CATALOG_SET.has(req));
    return Object.freeze({
      id,
      stage:stage.id,
      stageRank:stage.rank,
      stageLabel:stage.label,
      collection,
      tier:tier.id,
      tierRank:tier.rank,
      tierLabel:tier.label,
      // Atlas cards and trophies document where/what the player has seen.
      // They are satisfying collection stamps, not scientific conclusions, so
      // they no longer inflate the knowledge score or repeatedly mint XP.
      xp:collection?0:tier.xp,
      color:tier.color,
      icon:String(hint.icon||tier.icon),
      category:String(hint.cat||'❔ Sekrety'),
      chain:String(hint.chain||''),
      order:Number.isFinite(Number(hint.order))?Number(hint.order):0,
      requires:Object.freeze(requires)
    });
  }
  const META=Object.freeze(Object.fromEntries(CATALOG_IDS.map(id=>[id,buildMeta(id)])));
  const KNOWLEDGE_IDS=Object.freeze(CATALOG_IDS.filter(id=>!META[id].collection));
  const COLLECTION_IDS=Object.freeze(CATALOG_IDS.filter(id=>META[id].collection));
  const TOTAL_DISCOVERY_XP=CATALOG_IDS.reduce((sum,id)=>sum+META[id].xp,0);
  const RULES_BY_EVENT=new Map();
  const RULE_BY_ID=new Map();
  for(const row of KNOWLEDGE_CATALOG){
    const trigger=row.trigger;
    if(!trigger || typeof trigger.event!=='string' || !trigger.event) continue;
    const rule=Object.freeze({
      id:row.id,
      event:trigger.event,
      match:trigger.match||null,
      count:Math.max(1,Math.min(100000,Math.trunc(Number(trigger.count)||1))),
      distinctBy:typeof trigger.distinctBy==='string' ? trigger.distinctBy : '',
      distinct:Math.max(0,Math.min(64,Math.trunc(Number(trigger.distinct)||0))),
      witnessRadius:Number.isFinite(Number(trigger.witnessRadius))
        ? Math.max(0,Math.min(64,Number(trigger.witnessRadius)))
        : 0,
      order:row.order
    });
    RULE_BY_ID.set(row.id,rule);
    const list=RULES_BY_EVENT.get(rule.event)||[];
    list.push(rule);
    RULES_BY_EVENT.set(rule.event,list);
  }
  for(const list of RULES_BY_EVENT.values()) list.sort((a,b)=>a.order-b.order);
  // Fail loudly during development if a declarative chain contains a cycle.
  // A cycle would leave every member permanently hidden and is otherwise very
  // hard to notice in a two-hundred-entry journal.
  {
    const visiting=new Set(), visited=new Set();
    const visit=id=>{
      if(visited.has(id)) return;
      if(visiting.has(id)) throw new Error('Cyclic discovery prerequisite: '+id);
      visiting.add(id);
      for(const req of META[id].requires) visit(req);
      visiting.delete(id);
      visited.add(id);
    };
    for(const id of CATALOG_IDS) visit(id);
  }

  const seen = new Set();
  const evidence = new Map();
  let persistTimer=0;
  function restoreSeenList(value){
    if(!Array.isArray(value)) return;
    const count=Math.min(value.length,PROFILE_SCAN_CAP);
    for(let i=0;i<count && seen.size<CATALOG_COUNT;i++){
      const id=value[i];
      if(typeof id === 'string' && CATALOG_SET.has(id)) seen.add(id);
    }
  }
  function restoreEvidenceMap(value){
    if(!value || typeof value!=='object' || Array.isArray(value)) return;
    let scanned=0;
    for(const [id,raw] of Object.entries(value)){
      if(scanned++>=PROFILE_SCAN_CAP || !RULE_BY_ID.has(id) || seen.has(id)) continue;
      const rule=RULE_BY_ID.get(id);
      const tuple=Array.isArray(raw)?raw:[raw,[]];
      const count=Math.max(0,Math.min(rule.count,Math.trunc(Number(tuple[0])||0)));
      const values=[];
      if(rule.distinctBy && Array.isArray(tuple[1])){
        for(const item of tuple[1].slice(0,Math.max(rule.distinct,1))){
          const value=String(item).slice(0,80);
          if(value && !values.includes(value)) values.push(value);
        }
      }
      if(count>0 || values.length) evidence.set(id,{count,values});
    }
  }
  try{
    if(typeof localStorage !== 'undefined'){
      const raw = localStorage.getItem(KEY);
      if(typeof raw==='string' && raw.length<=PROFILE_RAW_CAP){
        const profile = JSON.parse(raw);
        // v1 was a bare array.  v2 keeps that knowledge and adds bounded latent
        // evidence for count/distinct rules.
        if(Array.isArray(profile)) restoreSeenList(profile);
        else if(profile && typeof profile==='object'){
          restoreSeenList(profile.list);
          restoreEvidenceMap(profile.evidence);
        }
      }
    }
  }catch(e){ /* private mode / headless: session-only journal */ }

  function evidenceObject(){
    const out={};
    let count=0;
    for(const [id,state] of evidence){
      if(count++>=PROFILE_SCAN_CAP || seen.has(id) || !RULE_BY_ID.has(id)) continue;
      out[id]=[state.count,state.values.slice(0,64)];
    }
    return out;
  }
  function persist(){
    if(persistTimer){
      try{ clearTimeout(persistTimer); }catch(e){}
      persistTimer=0;
    }
    try{
      if(typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify({
        v:2,
        list:[...seen],
        evidence:evidenceObject()
      }));
    }catch(e){ /* ignore */ }
  }
  function persistSoon(){
    if(persistTimer) return;
    if(typeof setTimeout!=='function'){ persist(); return; }
    persistTimer=setTimeout(persist,700);
  }

  function discoveryTarget(options){
    const src=options && options.target && typeof options.target==='object' ? options.target : options;
    if(!src || !Number.isFinite(Number(src.x)) || !Number.isFinite(Number(src.y))) return null;
    return {x:Number(src.x),y:Number(src.y)};
  }

  // Report that a discoverable interaction just happened. Returns true only the
  // first time (callers can key extra celebration off it). Empty text remains a
  // backwards-compatible silent migration; omitted text uses the catalog label.
  // XP always comes from catalog metadata, never from caller-controlled options.
  function note(id, text, options){
    if(text && typeof text==='object' && options===undefined){
      options=text;
      text=undefined;
    }
    const opts=options && typeof options==='object' ? options : {};
    if(typeof id !== 'string' || !CATALOG_SET.has(id)) return false;
    if(!actorCanLearn(opts)) return false;
    if(seen.has(id)) return false;
    seen.add(id);
    evidence.delete(id);
    persist();
    const loud = opts.silent!==true && text!=='';
    const displayText=typeof text==='string' && text.trim() ? text.trim() : CATALOG[id];
    const meta=META[id];
    const target=discoveryTarget(opts);
    let awarded=0;
    try{
      // silent (migration) entries record knowledge without paying XP again
      const p = root.player;
      if(loud && p && typeof p === 'object'){
        const rawXp=Number(p.xp);
        const xp=Number.isFinite(rawXp) ? Math.max(0,Math.min(DISCOVERY_XP_CAP,rawXp)) : 0;
        const next=Math.min(DISCOVERY_XP_CAP,xp+meta.xp);
        awarded=Math.max(0,next-xp);
        p.xp=next;
        if(awarded>0 && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function'){
          root.dispatchEvent(new root.CustomEvent('mm-xp-awarded', {detail:{
            amount:awarded,
            special:true,
            source:'discovery',
            discoveryId:id,
            tier:meta.tier,
            x:target&&target.x,
            y:target&&target.y
          }}));
        }
      }
    }catch(e){ /* headless */ }
    let presented=false;
    try{
      if(loud && typeof root.dispatchEvent==='function' && typeof root.CustomEvent==='function'){
        const event=new root.CustomEvent('mm-discovery-earned',{
          cancelable:true,
          detail:{
            id,
            label:CATALOG[id],
            text:displayText,
            category:meta.category,
            stage:meta.stage,
            stageRank:meta.stageRank,
            stageLabel:meta.stageLabel,
            collection:meta.collection,
            tier:meta.tier,
            tierRank:meta.tierRank,
            tierLabel:meta.tierLabel,
            xp:awarded,
            xpValue:meta.xp,
            color:meta.color,
            icon:meta.icon,
            chain:meta.chain,
            requires:meta.requires.slice(),
            source:String(opts.source||'world'),
            actor:String(opts.actor||'local-hero'),
            target
          }
        });
        root.dispatchEvent(event);
        presented=event.defaultPrevented;
      }
    }catch(e){ /* headless */ }
    try{
      if(root.msg && loud && !presented) root.msg(
        (meta.collection?'📚 Karta Atlasu: ':'🧪 Odkrycie: ')+displayText+
        (awarded>0 ? ' (+' + awarded + ' XP)' : '')
      );
    }catch(e){ /* headless */ }
    try{
      if(loud && !presented && root.MM.audio && root.MM.audio.play) root.MM.audio.play('chest');
    }catch(e){ /* no audio */ }
    return true;
  }

  function matchValue(actual,expected){
    if(expected && typeof expected==='object' && !Array.isArray(expected)){
      if(Array.isArray(expected.$in) && !expected.$in.some(value=>matchValue(actual,value))) return false;
      if(Object.prototype.hasOwnProperty.call(expected,'$ne') && matchValue(actual,expected.$ne)) return false;
      if(Object.prototype.hasOwnProperty.call(expected,'$gte') && !(Number(actual)>=Number(expected.$gte))) return false;
      if(Object.prototype.hasOwnProperty.call(expected,'$lte') && !(Number(actual)<=Number(expected.$lte))) return false;
      if(Object.prototype.hasOwnProperty.call(expected,'$gt') && !(Number(actual)>Number(expected.$gt))) return false;
      if(Object.prototype.hasOwnProperty.call(expected,'$lt') && !(Number(actual)<Number(expected.$lt))) return false;
      if(Object.prototype.hasOwnProperty.call(expected,'$truthy') && (!!actual)!==!!expected.$truthy) return false;
      return true;
    }
    if(Array.isArray(expected)) return expected.some(value=>matchValue(actual,value));
    return actual===expected;
  }
  function matchesRule(rule,detail){
    if(rule.match){
      for(const [key,expected] of Object.entries(rule.match)){
        if(!matchValue(detail[key],expected)) return false;
      }
    }
    if(rule.witnessRadius>0){
      const target=discoveryTarget(detail);
      const p=root.player;
      if(!target || !p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return false;
      if(Math.hypot(target.x-Number(p.x),target.y-Number(p.y))>rule.witnessRadius) return false;
    }
    return true;
  }
  function requirementsMet(id){
    const row=META[id];
    return !!row && row.requires.every(req=>seen.has(req));
  }
  function ruleEvidenceReady(rule,state){
    if(!state || state.count<rule.count) return false;
    return !rule.distinctBy || state.values.length>=Math.max(1,rule.distinct);
  }
  function actorCanLearn(detail){
    const actor=String(detail.actor||'local-hero');
    if(actor==='watcher' || actor==='remote-hero' || actor==='host-for-guest') return false;
    // Spectator mode intentionally cannot mutate the local knowledge profile.
    if(MM.ghostMode && !MM.ghostHeroIntents) return false;
    return true;
  }
  // Accept one confirmed gameplay fact.  Every event touches only its prebuilt
  // rule list, records bounded latent evidence, and can reveal at most one card;
  // this prevents the first mined block from dumping an entire tutorial at once.
  function observe(type,payload){
    const event=typeof type==='string' ? type.trim().slice(0,80) : '';
    const rules=RULES_BY_EVENT.get(event);
    if(!event || !rules || !rules.length) return null;
    const detail=payload && typeof payload==='object' ? payload : {};
    if(!actorCanLearn(detail)) return null;
    let changed=false;
    const candidates=[];
    for(const rule of rules){
      if(seen.has(rule.id) || !matchesRule(rule,detail)) continue;
      let state=evidence.get(rule.id);
      if(!state){ state={count:0,values:[]}; evidence.set(rule.id,state); }
      if(state.count<rule.count){
        state.count++;
        changed=true;
      }
      if(rule.distinctBy){
        const raw=detail[rule.distinctBy];
        if(raw!==undefined && raw!==null){
          const value=String(raw).slice(0,80);
          if(value && !state.values.includes(value) && state.values.length<64){
            state.values.push(value);
            changed=true;
          }
        }
      }
      if(ruleEvidenceReady(rule,state) && requirementsMet(rule.id)) candidates.push(rule);
    }
    if(changed) persistSoon();
    if(!candidates.length) return null;
    candidates.sort((a,b)=>a.order-b.order);
    const winner=candidates[0];
    const target=discoveryTarget(detail);
    const learned=note(winner.id,undefined,{
      source:'observation:'+event,
      actor:String(detail.actor||'local-hero'),
      target,
      silent:detail.silent===true
    });
    return learned ? winner.id : null;
  }
  function evidenceFor(id){
    const rule=RULE_BY_ID.get(String(id));
    const state=evidence.get(String(id));
    if(!rule) return null;
    return {
      count:state?state.count:0,
      needed:rule.count,
      distinct:state?state.values.length:0,
      distinctNeeded:rule.distinct,
      ready:ruleEvidenceReady(rule,state),
      requirementsMet:requirementsMet(rule.id)
    };
  }

  function noteBiome(biomeId, biomeLabel, options){
    const n=Number(biomeId);
    if(!Number.isInteger(n) || n<0 || n>=BIOME_DISCOVERY_IDS.length) return false;
    const id=BIOME_DISCOVERY_IDS[n];
    const fallback=String(CATALOG[id] || id).replace(/^Biom:\s*/, '');
    const label=typeof biomeLabel==='string' && biomeLabel.trim() ? biomeLabel.trim() : fallback;
    const opts=options && typeof options==='object' ? Object.assign({},options) : {};
    if(!discoveryTarget(opts) && root.player) opts.target={x:root.player.x,y:root.player.y};
    return note(id, 'Nowy biom: '+label+'!',opts);
  }

  function has(id){ return seen.has(String(id)); }
  function count(){ return seen.size; }
  function knowledgeCount(){ let n=0; for(const id of seen) if(META[id] && !META[id].collection) n++; return n; }
  function collectionCount(){ let n=0; for(const id of seen) if(META[id] && META[id].collection) n++; return n; }
  function list(){ return [...seen]; }
  function total(){ return CATALOG_COUNT; }
  function knowledgeTotal(){ return KNOWLEDGE_IDS.length; }
  function collectionTotal(){ return COLLECTION_IDS.length; }
  function label(id){ return CATALOG[id] || String(id); }
  function meta(id){ return META[id] || null; }
  function xpFor(id){ const row=meta(id); return row?row.xp:0; }
  // Help-panel view: found entries by label plus the remaining count.
  function progress(){
    const allFound = [...seen].filter(id => CATALOG[id]).map(id => ({
      id,
      label:CATALOG[id],
      stage:META[id].stage,
      stageLabel:META[id].stageLabel,
      collection:META[id].collection,
      tier:META[id].tier,
      tierLabel:META[id].tierLabel,
      xp:META[id].xp
    }));
    const found=allFound.filter(row=>!row.collection);
    const collections=allFound.filter(row=>row.collection);
    const stages={observation:0,insight:0,discovery:0};
    for(const row of found) stages[row.stage]=(stages[row.stage]||0)+1;
    return {
      count:found.length,
      total:knowledgeTotal(),
      found,
      recent:found.slice(-3).reverse(),
      collectionCount:collections.length,
      collectionTotal:collectionTotal(),
      collections,
      recentCollections:collections.slice(-3).reverse(),
      atlasCount:allFound.length,
      atlasTotal:total(),
      stages,
      xpTotal:TOTAL_DISCOVERY_XP
    };
  }
  // Journal-tab view (Ekwipunek → Odkrycia): every catalog entry, found ones
  // with their label, unfound ones masked to "???" + category hint.
  function entries(){
    return CATALOG_IDS.map(id => {
      const found = seen.has(id);
      const h = HINTS[id] || {};
      const m=META[id];
      return {
        id,
        found,
        label:found ? CATALOG[id] : null,
        cat:m.category,
        hint:h.hint||'',
        stage:m.stage,
        stageRank:m.stageRank,
        stageLabel:m.stageLabel,
        collection:m.collection,
        tier:m.tier,
        tierRank:m.tierRank,
        tierLabel:m.tierLabel,
        xp:m.xp,
        color:m.color,
        icon:m.icon,
        chain:m.chain,
        requires:m.requires.slice(),
        evidence:evidenceFor(id)
      };
    });
  }
  function reset(){ seen.clear(); evidence.clear(); persist(); }
  function snapshot(){ return {v:2,list:[...seen],evidence:evidenceObject()}; }
  function restore(src){
    if(!src || !Array.isArray(src.list)) return false;
    const next=new Set();
    const count=Math.min(src.list.length,PROFILE_SCAN_CAP);
    for(let i=0;i<count && next.size<CATALOG_COUNT;i++){
      const id=src.list[i];
      if(typeof id==='string' && CATALOG_SET.has(id)) next.add(id);
    }
    seen.clear();
    for(const id of next) seen.add(id);
    evidence.clear();
    if(src.evidence && typeof src.evidence==='object'){
      for(const [id,raw] of Object.entries(src.evidence)){
        if(!RULE_BY_ID.has(id) || seen.has(id)) continue;
        const rule=RULE_BY_ID.get(id);
        const tuple=Array.isArray(raw)?raw:[raw,[]];
        const count=Math.max(0,Math.min(rule.count,Math.trunc(Number(tuple[0])||0)));
        const values=[];
        if(rule.distinctBy && Array.isArray(tuple[1])){
          for(const item of tuple[1].slice(0,64)){
            const value=String(item).slice(0,80);
            if(value && !values.includes(value)) values.push(value);
          }
        }
        if(count || values.length) evidence.set(id,{count,values});
      }
    }
    persist();
    return true;
  }
  function bridgeBrowserEvent(type,handler){
    try{
      if(typeof root.addEventListener==='function') root.addEventListener(type,event=>{
        try{ handler((event&&event.detail)||{}); }catch(e){}
      });
    }catch(e){}
  }
  bridgeBrowserEvent('mm-combat-event',detail=>observe('combat_event',detail));
  bridgeBrowserEvent('mm-xp-awarded',detail=>{
    if(detail && detail.species) observe('mob_killed',detail);
  });
  bridgeBrowserEvent('mm-boss-killed',detail=>observe('boss_defeated',detail));
  bridgeBrowserEvent('mm-hero-died',detail=>observe('hero_died',detail));
  bridgeBrowserEvent('mm-skill-point-gained',detail=>observe('skill_point',detail));
  bridgeBrowserEvent('mm-berry-harvest',detail=>observe('berry_harvest',detail));
  try{
    if(typeof root.addEventListener==='function') root.addEventListener('pagehide',()=>{
      if(persistTimer) persist();
    });
  }catch(e){}

  const api = {
    note,
    observe,
    evidenceFor,
    noteBiome,
    has,
    count,
    knowledgeCount,
    collectionCount,
    list,
    total,
    knowledgeTotal,
    collectionTotal,
    label,
    meta,
    xpFor,
    progress,
    entries,
    CATALOG,
    HINTS,
    META,
    DISCOVERY_TIERS,
    DISCOVERY_STAGES,
    KNOWLEDGE_CATALOG,
    BIOME_DISCOVERY_IDS,
    DISCOVERY_XP,
    TOTAL_DISCOVERY_XP,
    reset,
    snapshot,
    restore
  };
  MM.discovery = api;
  return api;
})();

export { discovery };
export default discovery;
