// Declarative knowledge added on top of the historical secret-interaction
// catalog in discovery.js.  Each row describes WHAT the hero can learn and the
// rare, confirmed fact that is allowed to count as evidence.  The discovery
// engine compiles these rows into event indexes once at boot; no catalogue-wide
// polling runs in the game loop.
//
// stage is the kind of knowledge:
//   observation -> "I saw/did this"
//   insight     -> "I understand the rule"
//   discovery   -> "I deliberately used the rule"
//
// tier remains the independent complexity / XP band used by the existing
// economy: observation (20), principle (40), application (75), breakthrough
// (120).  Keeping those axes separate lets a subtle observation be valuable and
// a simple but useful insight remain easy to earn.

export const KNOWLEDGE_STAGES=Object.freeze({
  observation:Object.freeze({id:'observation',rank:1,label:'Obserwacja',icon:'!'}),
  insight:Object.freeze({id:'insight',rank:2,label:'Spostrzeżenie',icon:'◆'}),
  discovery:Object.freeze({id:'discovery',rank:3,label:'Odkrycie',icon:'✦'})
});

const rows=[
  // --- Pierwsze kroki ------------------------------------------------------
  {
    id:'first_steps',
    label:'Ruch pozwala poznawać świat',
    cat:'👣 Pierwsze kroki',
    hint:'Zrób kilka kroków od miejsca startu…',
    stage:'observation',tier:'observation',chain:'foundations',
    trigger:{event:'hero_moved',count:1}
  },
  {
    id:'world_has_distance',
    label:'Świat ciągnie się dalej niż pierwszy ekran',
    cat:'👣 Pierwsze kroki',
    hint:'Nie zatrzymuj się po pierwszych kilku krokach…',
    stage:'insight',tier:'principle',chain:'foundations',requires:['first_steps'],
    trigger:{event:'hero_moved',count:12,distinctBy:'cell',distinct:12}
  },
  {
    id:'ground_jump',
    label:'Od ziemi można się odbić',
    cat:'👣 Pierwsze kroki',
    hint:'Spróbuj wznieść się nad podłoże…',
    stage:'observation',tier:'observation',chain:'movement',
    trigger:{event:'hero_jump',match:{from:'ground'}}
  },
  {
    id:'air_jump',
    label:'Dodatkowy skok działa również w powietrzu',
    cat:'👣 Pierwsze kroki',
    hint:'Rozwiń mobilność i spróbuj skoczyć ponownie przed lądowaniem…',
    stage:'discovery',tier:'application',chain:'movement',requires:['ground_jump'],
    trigger:{event:'hero_jump',match:{from:'air'}}
  },
  {
    id:'ladder_climb',
    label:'Drabina zastępuje grunt pod stopami',
    cat:'👣 Pierwsze kroki',
    hint:'Wejdź na drabinę i użyj kierunku góra lub dół…',
    stage:'observation',tier:'observation',chain:'movement',
    trigger:{event:'hero_climbed',count:1}
  },
  {
    id:'quiet_steps',
    label:'Powolny krok wycisza ruch i skraca zasięg wykrycia',
    cat:'👣 Ruch i skradanie',
    hint:'Przytrzymaj skradanie i przejdź kilka kroków…',
    stage:'insight',tier:'principle',chain:'stealth',requires:['first_steps'],
    trigger:{event:'hero_moved',match:{quiet:true},count:4,distinctBy:'cell',distinct:4}
  },
  {
    id:'sprint_is_audible',
    label:'Sprint niesie kroki znacznie dalej niż spokojny marsz',
    cat:'👂 Hałas i skradanie',
    hint:'Po cichym przejściu rozpędź się do pełnego biegu…',
    stage:'insight',tier:'principle',chain:'stealth',requires:['quiet_steps'],
    trigger:{event:'hero_moved',match:{sprinting:true}}
  },
  {
    id:'water_entry',
    label:'W wodzie ciało traci zwykłe oparcie',
    cat:'🌊 Woda i przetrwanie',
    hint:'Wejdź do jeziora albo morza…',
    stage:'observation',tier:'observation',chain:'water',
    trigger:{event:'hero_water_enter'}
  },
  {
    id:'water_buoyancy',
    label:'Ruch w wodzie podlega wyporowi i oporowi',
    cat:'🌊 Woda i przetrwanie',
    hint:'Przepłyń kilka długości ciała bez stania na dnie…',
    stage:'insight',tier:'principle',chain:'water',requires:['water_entry'],
    trigger:{event:'hero_swim',count:5}
  },
  {
    id:'controlled_dive',
    label:'Pod wodą można świadomie nurkować i się wynurzać',
    cat:'🌊 Woda i przetrwanie',
    hint:'Zanurkuj tak, aby woda przykryła głowę…',
    stage:'discovery',tier:'application',chain:'water',requires:['water_buoyancy'],
    trigger:{event:'hero_dive',match:{headCovered:true,controlled:true}}
  },
  {
    id:'air_is_finite',
    label:'Pod wodą zapas powietrza jest skończony',
    cat:'🌊 Woda i przetrwanie',
    hint:'Pozostań pod powierzchnią wystarczająco długo, by zabrakło oddechu…',
    stage:'insight',tier:'principle',chain:'water',requires:['controlled_dive'],
    trigger:{event:'drowning_warning'}
  },
  {
    id:'depth_pressure',
    label:'Głęboka woda wywiera niszczące ciśnienie',
    cat:'🌊 Woda i przetrwanie',
    hint:'Zejdź głębiej pod długim słupem wody…',
    stage:'discovery',tier:'principle',chain:'water',requires:['controlled_dive'],
    trigger:{event:'water_pressure',match:{warn:true}}
  },
  {
    id:'open_water_chill',
    label:'Długie pływanie w otwartej wodzie wychładza ciało',
    cat:'🌊 Woda i przetrwanie',
    hint:'Pozostań na otwartej wodzie bez gruntu pod stopami…',
    stage:'insight',tier:'principle',chain:'survival_temperature',requires:['water_entry'],
    trigger:{event:'survival_warning',match:{kind:'water_chill'}}
  },
  {
    id:'deep_cold_exposure',
    label:'Głęboki mróz rani bez ognia albo schronienia',
    cat:'🌡 Przetrwanie',
    hint:'Wejdź bez osłony w najzimniejszą część świata…',
    stage:'observation',tier:'observation',chain:'survival_temperature',
    trigger:{event:'survival_warning',match:{kind:'cold'}}
  },
  {
    id:'extreme_heat_exposure',
    label:'Skrajny upał rani bez cienia albo chłodnej wody',
    cat:'🌡 Przetrwanie',
    hint:'Wejdź bez osłony w najgorętszą część świata…',
    stage:'observation',tier:'observation',chain:'survival_temperature',
    trigger:{event:'survival_warning',match:{kind:'heat'}}
  },
  {
    id:'underwater_energy_shock',
    label:'Zużywanie energii pod wodą razi bohatera',
    cat:'🌊 Woda i przetrwanie',
    hint:'Uruchom energochłonną zdolność podczas głębokiego zanurzenia…',
    stage:'discovery',tier:'application',chain:'water',requires:['controlled_dive'],
    trigger:{event:'survival_warning',match:{kind:'underwater_energy'}}
  },
  {
    id:'mud_drag',
    label:'Błoto mocno spowalnia ruch',
    cat:'👣 Pierwsze kroki',
    hint:'Przejdź po ciężkim, mokrym podłożu…',
    stage:'observation',tier:'observation',chain:'terrain',
    trigger:{event:'hero_surface',match:{surface:'mud',moving:true}}
  },
  {
    id:'ice_inertia',
    label:'Lód wyraźnie zmienia przyczepność ruchu',
    cat:'👣 Pierwsze kroki',
    hint:'Rozpędź się na gładkim, zimnym podłożu…',
    stage:'insight',tier:'principle',chain:'terrain',
    trigger:{event:'hero_surface',match:{surface:'ice',moving:true}}
  },
  {
    id:'quicksand_escape',
    label:'Ruchome piaski wymagają rytmicznych skoków',
    cat:'🌊 Woda i przetrwanie',
    hint:'Jeśli piasek zacznie wciągać, nie przestawaj walczyć o powierzchnię…',
    stage:'discovery',tier:'application',chain:'terrain',
    trigger:{event:'quicksand_escape'}
  },

  // --- Kopanie i geologia -------------------------------------------------
  {
    id:'blocks_can_be_mined',
    label:'Bloki można wykopywać',
    cat:'⛏ Podstawy kopania',
    hint:'Użyj kilofa na najbliższym zwykłym bloku…',
    stage:'observation',tier:'observation',chain:'mining',
    trigger:{event:'tile_mined',match:{layer:'foreground'}}
  },
  {
    id:'mining_returns_material',
    label:'Wykopany blok wraca jako materiał',
    cat:'⛏ Podstawy kopania',
    hint:'Wykop kolejny blok i sprawdź, co trafia do zasobów…',
    stage:'insight',tier:'observation',chain:'mining',requires:['blocks_can_be_mined'],
    trigger:{event:'tile_mined',match:{hasDrop:true}}
  },
  {
    id:'materials_have_hardness',
    label:'Materiały stawiają kilofowi różny opór',
    cat:'⛏ Podstawy kopania',
    hint:'Porównaj miękką ziemię z twardszą skałą…',
    stage:'insight',tier:'principle',chain:'mining',requires:['blocks_can_be_mined'],
    trigger:{event:'tile_mined',count:2,distinctBy:'hardness',distinct:2}
  },
  {
    id:'hard_mining_is_louder',
    label:'Twardszy materiał rozsyła uderzenia kilofa na większą odległość',
    cat:'👂 Hałas i skradanie',
    hint:'Porównaj kopanie miękkiego i bardzo twardego materiału…',
    stage:'insight',tier:'principle',chain:'stealth',requires:['blocks_can_be_mined'],
    trigger:{event:'mining_noise',distinctBy:'band',distinct:2}
  },
  {
    id:'tools_have_limits',
    label:'Nie każdy kilof naruszy każdy materiał',
    cat:'⛏ Podstawy kopania',
    hint:'Spróbuj uderzyć zbyt twardy blok prostym narzędziem…',
    stage:'observation',tier:'observation',chain:'mining',
    trigger:{event:'mine_blocked',match:{reason:'tool'}}
  },
  {
    id:'soil_over_stone',
    label:'Kamień tworzy twardszą warstwę podłoża',
    cat:'🪨 Geologia',
    hint:'Wydobądź pierwszy blok litej skały…',
    stage:'observation',tier:'observation',chain:'geology',requires:['blocks_can_be_mined'],
    trigger:{event:'tile_mined',match:{material:'stone'}}
  },
  {
    id:'sand_is_resource',
    label:'Sypki piasek również można odzyskać',
    cat:'🪨 Geologia',
    hint:'Wykop blok piasku, zanim osunie się w wolne miejsce…',
    stage:'observation',tier:'observation',chain:'geology',requires:['blocks_can_be_mined'],
    trigger:{event:'tile_mined',match:{material:'sand'}}
  },
  {
    id:'clay_below_wetlands',
    label:'Glina kryje się w wilgotnych warstwach',
    cat:'🪨 Geologia',
    hint:'Szukaj ciężkiego, brunatnego materiału w mokrej ziemi…',
    stage:'observation',tier:'principle',chain:'geology',
    trigger:{event:'tile_mined',match:{material:'clay'}}
  },
  {
    id:'ore_in_rock',
    label:'Skała skrywa użyteczne rudy',
    cat:'🪨 Geologia',
    hint:'Wypatruj w skale żyły o innym kolorze…',
    stage:'observation',tier:'observation',chain:'geology',requires:['soil_over_stone'],
    trigger:{event:'tile_mined',match:{ore:true}}
  },
  {
    id:'ore_variety',
    label:'Różne głębokości i krainy skrywają różne rudy',
    cat:'🪨 Geologia',
    hint:'Wydobądź kilka różnych rodzajów rudy…',
    stage:'insight',tier:'principle',chain:'geology',requires:['ore_in_rock'],
    trigger:{event:'tile_mined',match:{ore:true},distinctBy:'tile',distinct:3}
  },
  {
    id:'coal_holds_energy',
    label:'Węgiel jest skałą, która magazynuje ogień',
    cat:'🪨 Geologia',
    hint:'Wydobądź czarną, palną żyłę…',
    stage:'insight',tier:'principle',chain:'carbon',
    trigger:{event:'tile_mined',match:{material:'coal'}}
  },
  {
    id:'precious_ore',
    label:'Najrzadsze żyły stają się cennymi materiałami',
    cat:'🪨 Geologia',
    hint:'Znajdź w skale diament, złoto albo srebro…',
    stage:'observation',tier:'principle',chain:'geology',requires:['ore_in_rock'],
    trigger:{event:'tile_mined',match:{precious:true}}
  },
  {
    id:'meteor_materials',
    label:'Kamienie z nieba zawierają obce materiały',
    cat:'🪨 Geologia',
    hint:'Rozbij fragment świeżego meteorytu…',
    stage:'discovery',tier:'application',chain:'meteor',
    trigger:{event:'tile_mined',match:{meteorite:true}}
  },
  {
    id:'bedrock_boundary',
    label:'Skała macierzysta wyznacza granicę zwykłego kopania',
    cat:'🪨 Geologia',
    hint:'Zejdź do najtwardszej warstwy i spróbuj ją naruszyć…',
    stage:'discovery',tier:'application',chain:'depths',requires:['deep_underground'],
    trigger:{event:'mine_blocked',match:{reason:'bedrock'}}
  },
  {
    id:'water_can_be_collected',
    label:'Wodę można zebrać jak zasób',
    cat:'⛏ Podstawy kopania',
    hint:'Skieruj narzędzie na kafel wody…',
    stage:'discovery',tier:'principle',chain:'water',
    trigger:{event:'tile_mined',match:{material:'water'}}
  },
  {
    id:'background_can_be_removed',
    label:'Ściana tła jest oddzielną warstwą budowli',
    cat:'⛏ Podstawy kopania',
    hint:'Przełącz kopanie na tylną ścianę konstrukcji…',
    stage:'insight',tier:'principle',chain:'building_layers',
    trigger:{event:'tile_mined',match:{layer:'background'}}
  },
  {
    id:'infrastructure_can_be_recovered',
    label:'Instalacje dają się odzyskać bez burzenia ściany',
    cat:'⛏ Podstawy kopania',
    hint:'Usuń przewód, rurę albo drabinę z warstwy instalacji…',
    stage:'insight',tier:'principle',chain:'building_layers',
    trigger:{event:'tile_mined',match:{layer:'overlay'}}
  },
  {
    id:'underground_layer',
    label:'Pod powierzchnią zaczyna się osobny świat',
    cat:'🧭 Eksploracja',
    hint:'Zejdź wyraźnie poniżej lokalnego gruntu…',
    stage:'observation',tier:'observation',chain:'depths',
    trigger:{event:'depth_zone',match:{zone:'underground'}}
  },
  {
    id:'deep_underground',
    label:'Głębokie warstwy zmieniają zagrożenia i surowce',
    cat:'🧭 Eksploracja',
    hint:'Kontynuuj zejście daleko pod zwykłe jaskinie…',
    stage:'insight',tier:'application',chain:'depths',requires:['underground_layer'],
    trigger:{event:'depth_zone',match:{zone:'deep'}}
  },

  // --- Budowanie, ciężar i podparcie -------------------------------------
  {
    id:'blocks_can_be_placed',
    label:'Bloki można ponownie stawiać',
    cat:'🧱 Budowanie i fizyka',
    hint:'Wybierz posiadany blok i umieść go w pustym miejscu…',
    stage:'observation',tier:'observation',chain:'building',
    trigger:{event:'tile_placed',match:{layer:'foreground'}}
  },
  {
    id:'building_spends_material',
    label:'Budowanie przenosi materiał z zasobów do świata',
    cat:'🧱 Budowanie i fizyka',
    hint:'Postaw kolejny zwykły blok i obserwuj jego licznik…',
    stage:'insight',tier:'observation',chain:'building',requires:['blocks_can_be_placed'],
    trigger:{event:'tile_placed',match:{spent:true}}
  },
  {
    id:'placement_needs_support',
    label:'Ciężki blok potrzebuje drogi podparcia',
    cat:'🧱 Budowanie i fizyka',
    hint:'Spróbuj postawić ciężki materiał całkiem w powietrzu…',
    stage:'insight',tier:'principle',chain:'structure',
    trigger:{event:'place_blocked',match:{reason:'support'}}
  },
  {
    id:'side_bracing',
    label:'Ściana i strop mogą podtrzymać sąsiedni element',
    cat:'🧱 Budowanie i fizyka',
    hint:'Umieść blok przy stabilnej ścianie zamiast bezpośrednio na ziemi…',
    stage:'discovery',tier:'application',chain:'structure',requires:['placement_needs_support'],
    trigger:{event:'tile_placed',match:{support:{$in:['side','ceiling']}}}
  },
  {
    id:'background_wall',
    label:'Tło zamyka wnętrze bez blokowania przejścia',
    cat:'🧱 Budowanie i fizyka',
    hint:'Przenieś materiał na tylną warstwę konstrukcji…',
    stage:'observation',tier:'principle',chain:'building_layers',
    trigger:{event:'tile_placed',match:{layer:'background'}}
  },
  {
    id:'torch_is_light',
    label:'Pochodnia tworzy własne źródło światła',
    cat:'🧱 Budowanie i fizyka',
    hint:'Postaw pochodnię w mroku albo nocą…',
    stage:'observation',tier:'observation',chain:'shelter',
    trigger:{event:'tile_placed',match:{material:'torch'}}
  },
  {
    id:'ladder_is_overlay',
    label:'Drabina może dzielić kratkę z konstrukcją',
    cat:'🧱 Budowanie i fizyka',
    hint:'Umieść drabinę na ścianie lub w szybie…',
    stage:'insight',tier:'principle',chain:'building_layers',
    trigger:{event:'tile_placed',match:{material:'ladder'}}
  },
  {
    id:'doors_control_passage',
    label:'Drzwi zmieniają ścianę w kontrolowane przejście',
    cat:'🧱 Budowanie i fizyka',
    hint:'Umieść pierwsze drzwi w otworze budowli…',
    stage:'discovery',tier:'principle',chain:'shelter',
    trigger:{event:'tile_placed',match:{door:true}}
  },
  {
    id:'infrastructure_layer',
    label:'Rury i przewody biegną własną warstwą',
    cat:'⚙ Przemysł',
    hint:'Poprowadź instalację przez istniejącą konstrukcję…',
    stage:'insight',tier:'principle',chain:'infrastructure',
    trigger:{event:'tile_placed',match:{layer:'overlay'}}
  },
  {
    id:'machines_are_blocks',
    label:'Maszyny stają się częścią fizycznego świata',
    cat:'⚙ Przemysł',
    hint:'Postaw pierwsze wykonane urządzenie…',
    stage:'observation',tier:'principle',chain:'machines',
    trigger:{event:'tile_placed',match:{machine:true}}
  },
  {
    id:'solid_displaces_water',
    label:'Bryła wypiera wodę zamiast ją unicestwiać',
    cat:'🌊 Woda i przetrwanie',
    hint:'Umieść stały blok bezpośrednio w wodzie…',
    stage:'insight',tier:'application',chain:'water',requires:['blocks_can_be_placed','water_entry'],
    trigger:{event:'tile_placed',match:{replacedWater:true}}
  },
  {
    id:'sand_obeys_gravity',
    label:'Niepodparty piasek spada',
    cat:'🧱 Budowanie i fizyka',
    hint:'Usuń podporę spod piasku albo postaw go nad pustką…',
    stage:'observation',tier:'observation',chain:'gravity',
    trigger:{event:'falling_sand',count:1,witnessRadius:16}
  },
  {
    id:'sand_forms_slopes',
    label:'Piasek rozsypuje się w naturalne zbocza',
    cat:'🧱 Budowanie i fizyka',
    hint:'Pozwól kilku porcjom piasku spaść na nierówne podłoże…',
    stage:'insight',tier:'principle',chain:'gravity',requires:['sand_obeys_gravity'],
    trigger:{event:'falling_sand',match:{rolled:true},count:3,witnessRadius:18}
  },
  {
    id:'blocks_can_fall',
    label:'Ciężkie bloki również mogą utracić podparcie',
    cat:'🧱 Budowanie i fizyka',
    hint:'Podkop ciężki element konstrukcji…',
    stage:'observation',tier:'principle',chain:'gravity',
    trigger:{event:'falling_block',count:1,witnessRadius:16}
  },
  {
    id:'glass_hates_falling',
    label:'Szkło rozbija się przy upadku',
    cat:'🧱 Budowanie i fizyka',
    hint:'Pozwól szklanemu elementowi spaść na twarde podłoże…',
    stage:'discovery',tier:'application',chain:'gravity',requires:['blocks_can_fall'],
    trigger:{event:'fragile_shatter',match:{material:'glass'},witnessRadius:18}
  },
  {
    id:'unsupported_build_collapses',
    label:'Konstrukcja bez nośnej drogi rozpada się',
    cat:'🧱 Budowanie i fizyka',
    hint:'Usuń kluczowe podparcie z większej budowli…',
    stage:'discovery',tier:'application',chain:'structure',requires:['placement_needs_support'],
    trigger:{event:'structure_collapse',match:{built:true},witnessRadius:20}
  },
  {
    id:'natural_roof_creaks',
    label:'Szeroki naturalny strop ostrzega przed zawałem',
    cat:'🧱 Budowanie i fizyka',
    hint:'Poszerz podziemną komorę bez podpór i słuchaj skały…',
    stage:'observation',tier:'principle',chain:'cave_safety',requires:['underground_layer'],
    trigger:{event:'cave_in_warning',witnessRadius:22}
  },
  {
    id:'cave_in_follows_warning',
    label:'Trzeszczący strop naprawdę może runąć',
    cat:'🧱 Budowanie i fizyka',
    hint:'Nie podeprzyj ostrzegającego stropu i obserwuj skutek z bezpiecznej odległości…',
    stage:'insight',tier:'application',chain:'cave_safety',requires:['natural_roof_creaks'],
    trigger:{event:'cave_in',witnessRadius:24}
  },
  {
    id:'pit_prop_prevents_cave_in',
    label:'Drewniany stempel zatrzymuje zawał',
    cat:'🧱 Budowanie i fizyka',
    hint:'Postaw stempel pod trzeszczącym stropem przed upływem ostrzeżenia…',
    stage:'discovery',tier:'breakthrough',chain:'cave_safety',requires:['natural_roof_creaks'],
    trigger:{event:'cave_in_prevented',witnessRadius:24}
  },

  // --- Rzemiosło i przemysł ----------------------------------------------
  {
    id:'first_craft',
    label:'Materiały można łączyć w nowe przedmioty',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wykonaj dowolną dostępną recepturę…',
    stage:'observation',tier:'observation',chain:'crafting',
    trigger:{event:'crafted',count:1}
  },
  {
    id:'craft_transforms_cost',
    label:'Receptura zużywa składniki i tworzy określony rezultat',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wykonaj kolejną recepturę i porównaj składniki z wynikiem…',
    stage:'insight',tier:'principle',chain:'crafting',requires:['first_craft'],
    trigger:{event:'crafted',count:2}
  },
  {
    id:'batch_crafting',
    label:'Znany przepis można wykonać seriami',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wytwórz kilka porcji tego samego przepisu naraz…',
    stage:'discovery',tier:'application',chain:'crafting',requires:['craft_transforms_cost'],
    trigger:{event:'crafted',match:{count:{$gte:2}}}
  },
  {
    id:'crafted_tool',
    label:'Lepsze narzędzie otwiera twardsze materiały',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wytwórz narzędzie z materiałów lepszych niż startowe…',
    stage:'insight',tier:'principle',chain:'mining',requires:['tools_have_limits'],
    trigger:{event:'crafted',match:{group:'tools'}}
  },
  {
    id:'crafted_building_part',
    label:'Budulec może zostać przetworzony w część konstrukcji',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wykonaj drzwi, szkło, cegły albo inny element budowli…',
    stage:'insight',tier:'principle',chain:'building',
    trigger:{event:'crafted',match:{group:'building'}}
  },
  {
    id:'crafted_processing',
    label:'Przerób zmienia właściwości surowca',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wykonaj recepturę z działu Przerób…',
    stage:'insight',tier:'principle',chain:'industry',
    trigger:{event:'crafted',match:{group:'processing'}}
  },
  {
    id:'crafted_weapon',
    label:'Materiał broni wpływa na sposób walki',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wykonaj pierwszą broń albo specjalną amunicję…',
    stage:'observation',tier:'principle',chain:'combat',
    trigger:{event:'crafted',match:{group:'weapons'}}
  },
  {
    id:'crafted_machine',
    label:'Złożone części można zamienić w maszynę',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Połącz metal, przewody lub elektronikę w działające urządzenie…',
    stage:'discovery',tier:'application',chain:'machines',
    trigger:{event:'crafted',match:{group:'machines'}}
  },
  {
    id:'crafted_alchemy',
    label:'Żywe i mineralne składniki mogą zmieniać ciało',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wykonaj pierwszy eliksir lub potrawę z działu alchemii…',
    stage:'discovery',tier:'application',chain:'alchemy',
    trigger:{event:'crafted',match:{group:'alchemy'}}
  },
  {
    id:'crafted_furniture',
    label:'Budowla może służyć wygodzie, nie tylko obronie',
    cat:'🛠 Rzemiosło praktyczne',
    hint:'Wykonaj pierwszy mebel albo element wystroju…',
    stage:'observation',tier:'principle',chain:'shelter',
    trigger:{event:'crafted',match:{group:{$in:['furniture','decor','electronics','wonders']}}}
  },
  {
    id:'kiln_fires_clay',
    label:'Długie, zamknięte grzanie wypala glinę w cegłę',
    cat:'⚙ Przemysł',
    hint:'Umieść glinę w pobliżu rozgrzanego pieca wypałowego…',
    stage:'discovery',tier:'application',chain:'industry',requires:['clay_below_wetlands'],
    trigger:{event:'tile_transition',match:{change:'clay_to_brick'},witnessRadius:14}
  },
  {
    id:'heat_cooks_meat',
    label:'Kontrolowane ciepło zamienia mięso w bezpieczniejszy pokarm',
    cat:'⚙ Przemysł',
    hint:'Ogrzej świeże mięso bez spalenia go na popiół…',
    stage:'insight',tier:'principle',chain:'food',
    trigger:{event:'tile_transition',match:{change:'meat_to_baked'},witnessRadius:14}
  },
  {
    id:'power_source_placed',
    label:'Źródło energii musi najpierw znaleźć się w świecie',
    cat:'⚙ Przemysł',
    hint:'Postaw dynamo, panel słoneczny, baterię albo inne źródło mocy…',
    stage:'observation',tier:'principle',chain:'power',
    trigger:{event:'tile_placed',match:{powerSource:true}}
  },
  {
    id:'power_cable_placed',
    label:'Energia potrzebuje przewodzącej drogi',
    cat:'⚙ Przemysł',
    hint:'Połącz źródło z przyszłym odbiornikiem przewodem…',
    stage:'insight',tier:'principle',chain:'power',requires:['power_source_placed'],
    trigger:{event:'tile_placed',match:{powerCable:true}}
  },
  {
    id:'power_device_placed',
    label:'Sieć ma sens dopiero z urządzeniem odbierającym energię',
    cat:'⚙ Przemysł',
    hint:'Po źródle i przewodzie postaw maszynę zużywającą moc…',
    stage:'discovery',tier:'application',chain:'power',requires:['power_cable_placed'],
    trigger:{event:'tile_placed',match:{powerDevice:true}}
  },
  {
    id:'power_generation_real',
    label:'Źródło naprawdę wytwarza energię dopiero pod wpływem ruchu',
    cat:'⚙ Przemysł',
    hint:'Pozwól wodzie albo wiatrowi wykonać pracę na dynamie…',
    stage:'insight',tier:'application',chain:'power',requires:['power_source_placed'],
    trigger:{event:'power_generated',match:{amount:{$gt:0}}}
  },
  {
    id:'power_generation_media',
    label:'To samo dynamo może czerpać moc z różnych ruchomych żywiołów',
    cat:'⚙ Przemysł',
    hint:'Porównaj pracę dynama napędzanego wodą i wiatrem…',
    stage:'discovery',tier:'application',chain:'power',requires:['power_generation_real'],
    trigger:{event:'power_generated',match:{amount:{$gt:0}},distinctBy:'medium',distinct:2}
  },
  {
    id:'fluid_network_parts',
    label:'Pompa i rury tworzą osobną sieć przepływu',
    cat:'⚙ Przemysł',
    hint:'Postaw element instalacji wodnej…',
    stage:'insight',tier:'application',chain:'water_network',
    trigger:{event:'tile_placed',match:{fluidDevice:true}}
  },

  // --- Jedzenie, dom i transport -----------------------------------------
  {
    id:'food_restores_health',
    label:'Jedzenie może przywracać zdrowie',
    cat:'🍖 Jedzenie i skażenie',
    hint:'Zjedz coś, gdy bohater jest ranny…',
    stage:'observation',tier:'observation',chain:'food',
    trigger:{event:'food_consumed',match:{healing:{$gt:0}}}
  },
  {
    id:'spoiled_food_harms',
    label:'Zepsute mięso zamiast leczyć odbiera zdrowie',
    cat:'🍖 Jedzenie i skażenie',
    hint:'Ryzykowny zapach ostrzega, że nie każdy pokarm jest bezpieczny…',
    stage:'insight',tier:'principle',chain:'food',
    trigger:{event:'food_consumed',match:{spoiled:true,delta:{$lt:0}}}
  },
  {
    id:'food_strength_varies',
    label:'Różne potrawy przywracają różną ilość zdrowia',
    cat:'🍖 Jedzenie i skażenie',
    hint:'Porównaj skutki dwóch rodzajów leczniczego jedzenia…',
    stage:'insight',tier:'principle',chain:'food',requires:['food_restores_health'],
    trigger:{event:'food_consumed',match:{healing:{$gt:0}},distinctBy:'healing',distinct:2}
  },
  {
    id:'baked_food_recovers_more',
    label:'Upieczenie mięsa wyraźnie zwiększa jego wartość leczniczą',
    cat:'🍖 Jedzenie i skażenie',
    hint:'Najpierw ugotuj mięso, a potem zjedz je po odniesieniu ran…',
    stage:'discovery',tier:'principle',chain:'food',requires:['food_restores_health','heat_cooks_meat'],
    trigger:{event:'food_consumed',match:{cooked:true,healing:{$gte:30}}}
  },
  {
    id:'furniture_improves_rest',
    label:'Wyposażenie domu przyspiesza odpoczynek i leczenie',
    cat:'🏠 Domowe zacisze',
    hint:'Odpocznij jako ranny w bezpiecznym domu z wyposażeniem…',
    stage:'insight',tier:'principle',chain:'shelter',requires:['shelter_healing'],
    trigger:{event:'home_healing',match:{furnishings:{$gt:0},comfort:{$gt:1}}}
  },
  {
    id:'varied_home_comfort',
    label:'Różnorodne wyposażenie daje większy komfort niż jeden typ mebla',
    cat:'🏠 Domowe zacisze',
    hint:'Połącz w jednym bezpiecznym wnętrzu kilka rodzajów wyposażenia…',
    stage:'discovery',tier:'principle',chain:'shelter',requires:['furniture_improves_rest'],
    trigger:{event:'home_healing',match:{types:{$gte:3},comfort:{$gte:1.5}}}
  },
  {
    id:'wood_becomes_raft',
    label:'Drewno położone na otwartej wodzie staje się tratwą',
    cat:'⛵ Transport',
    hint:'Połóż drewno tam, gdzie nie podtrzymuje go ląd…',
    stage:'observation',tier:'principle',chain:'boats',
    trigger:{event:'boat_event',match:{kind:'created'}}
  },
  {
    id:'raft_can_expand',
    label:'Pływającą tratwę można powiększać kolejnymi belkami',
    cat:'⛵ Transport',
    hint:'Dołącz pasujące drewno do burty istniejącej tratwy…',
    stage:'insight',tier:'principle',chain:'boats',requires:['wood_becomes_raft'],
    trigger:{event:'boat_event',match:{kind:'extended'}}
  },
  {
    id:'raft_boarded_from_water',
    label:'Z wody można wdrapać się bezpośrednio na pokład',
    cat:'⛵ Transport',
    hint:'Dotknij pływającej tratwy i spróbuj wyskoczyć na jej pokład…',
    stage:'observation',tier:'observation',chain:'boats',requires:['wood_becomes_raft'],
    trigger:{event:'boat_event',match:{kind:'boarded'}}
  },
  {
    id:'rowing_spends_energy',
    label:'Mocne pociągnięcie wiosłem zużywa energię bohatera',
    cat:'⛵ Transport',
    hint:'Na pływającej tratwie naciśnij kierunek krótkim ruchem…',
    stage:'insight',tier:'principle',chain:'boats',requires:['wood_becomes_raft'],
    trigger:{event:'boat_event',match:{kind:'row',strong:true}}
  },
  {
    id:'empty_energy_weakens_oars',
    label:'Bez energii wiosło nadal działa, lecz znacznie słabiej',
    cat:'⛵ Transport',
    hint:'Spróbuj wiosłować po całkowitym wyczerpaniu energii…',
    stage:'discovery',tier:'principle',chain:'boats',requires:['rowing_spends_energy'],
    trigger:{event:'boat_event',match:{kind:'row',strong:false}}
  },
  {
    id:'sail_catches_wind',
    label:'Podniesiony żagiel zamienia wiatr w napęd bez zużycia energii',
    cat:'⛵ Transport',
    hint:'Podnieś żagiel podczas wyraźnego wiatru na otwartej wodzie…',
    stage:'discovery',tier:'principle',chain:'boats',requires:['wood_becomes_raft'],
    trigger:{event:'boat_event',match:{kind:'sail',wind:{$gt:0.2}}}
  },
  {
    id:'glider_slows_fall',
    label:'Lotnia przechwytuje spadanie i ogranicza prędkość opadania',
    cat:'🪂 Transport powietrzny',
    hint:'Przytrzymaj skok podczas opadania z lotnią…',
    stage:'observation',tier:'principle',chain:'glider',
    trigger:{event:'glider_opened'}
  },
  {
    id:'glider_catches_wind',
    label:'Otwarta lotnia pozwala wiatrowi przenosić bohatera',
    cat:'🪂 Transport powietrzny',
    hint:'Utrzymaj lotnię otwartą podczas wyraźnego wiatru…',
    stage:'insight',tier:'principle',chain:'glider',requires:['glider_slows_fall'],
    trigger:{event:'glider_wind',match:{wind:{$gt:0.1}}}
  },
  {
    id:'thermal_lifts_glider',
    label:'Wznoszące się gorące powietrze potrafi unieść lotnię',
    cat:'🪂 Transport powietrzny',
    hint:'Przeleć otwartą lotnią nad silnym źródłem ciepła…',
    stage:'discovery',tier:'breakthrough',chain:'glider',requires:['glider_slows_fall'],
    trigger:{event:'glider_thermal',match:{lift:{$gt:0.08}}}
  },
  {
    id:'spring_launch',
    label:'Platforma sprężynowa zamienia lądowanie w kolejne odbicie',
    cat:'🪂 Transport powietrzny',
    hint:'Wyląduj na platformie sprężynowej…',
    stage:'observation',tier:'observation',chain:'spring',
    trigger:{event:'spring_launch'}
  },
  {
    id:'powered_spring_launch',
    label:'Zasilona sprężyna wyrzuca dalej niż sama mechanika',
    cat:'🪂 Transport powietrzny',
    hint:'Dostarcz platformie energię i ponownie na niej wyląduj…',
    stage:'discovery',tier:'principle',chain:'spring',requires:['spring_launch'],
    trigger:{event:'spring_launch',match:{powered:true,spent:{$gt:0}}}
  },
  {
    id:'teleport_pair_transports',
    label:'Sparowane teleportery przenoszą ciało między odległymi punktami',
    cat:'🌀 Teleportacja',
    hint:'Zasil dwa sparowane teleportery i wejdź na jeden z nich…',
    stage:'observation',tier:'observation',chain:'teleport',
    trigger:{event:'teleport_completed',match:{entity:'hero'}}
  },
  {
    id:'teleport_rotates_momentum',
    label:'Teleporter obraca zachowany pęd zgodnie z kierunkiem wyjścia',
    cat:'🌀 Teleportacja',
    hint:'Wpadnij w teleporter podczas szybkiego ruchu i obserwuj wyjście…',
    stage:'insight',tier:'breakthrough',chain:'teleport',requires:['teleport_pair_transports'],
    trigger:{event:'teleport_completed',match:{entity:'hero',moving:true}}
  },
  {
    id:'teleport_transports_projectiles',
    label:'Ta sama para portali może przekierować także pociski',
    cat:'🌀 Teleportacja',
    hint:'Wystrzel pocisk w aktywne wejście teleportera…',
    stage:'discovery',tier:'application',chain:'teleport',requires:['teleport_pair_transports'],
    trigger:{event:'teleport_completed',match:{entity:'projectile'}}
  },

  // --- Przemiany świata i przyroda ---------------------------------------
  {
    id:'water_fills_space',
    label:'Woda przemieszcza się do wolnej przestrzeni',
    cat:'🌿 Żywy świat',
    hint:'Otwórz bok zbiornika albo postaw wodę przy pustej kratce…',
    stage:'observation',tier:'observation',chain:'water',
    trigger:{event:'tile_transition',match:{change:'air_to_water'},count:2,witnessRadius:12}
  },
  {
    id:'water_makes_mud',
    label:'Woda zmienia luźny piasek w błoto',
    cat:'🌿 Żywy świat',
    hint:'Skieruj wodę na piasek…',
    stage:'insight',tier:'principle',chain:'terrain',
    trigger:{event:'tile_transition',match:{change:'sand_to_mud'},witnessRadius:14}
  },
  {
    id:'water_wets_clay',
    label:'Glina nasiąka wodą przed dalszym przetwarzaniem',
    cat:'🌿 Żywy świat',
    hint:'Dopuść wodę do suchej gliny…',
    stage:'insight',tier:'principle',chain:'industry',requires:['clay_below_wetlands'],
    trigger:{event:'tile_transition',match:{change:'clay_to_wet_clay'},witnessRadius:14}
  },
  {
    id:'heat_thaws_frozen_ground',
    label:'Ciepło przywraca zamarzniętej ziemi zwykłą postać',
    cat:'🌿 Żywy świat',
    hint:'Ogrzej śnieg, lód albo zmarzniętą glebę…',
    stage:'insight',tier:'principle',chain:'temperature',
    trigger:{event:'tile_transition',match:{change:{$in:['snow_to_water','ice_to_water','frozen_to_thawed']}},witnessRadius:16}
  },
  {
    id:'water_quenches_lava',
    label:'Woda hartuje lawę w obsydian',
    cat:'🌿 Żywy świat',
    hint:'Doprowadź wodę do płynnej lawy…',
    stage:'discovery',tier:'application',chain:'temperature',
    trigger:{event:'tile_transition',match:{change:'lava_to_obsidian'},witnessRadius:18}
  },
  {
    id:'lava_cools_in_air',
    label:'Lawa pozostawiona bez żaru z czasem zastyga',
    cat:'🌿 Żywy świat',
    hint:'Obserwuj płynną skałę na otwartym powietrzu…',
    stage:'insight',tier:'principle',chain:'temperature',
    trigger:{event:'tile_transition',match:{change:'lava_cool'},witnessRadius:18}
  },
  {
    id:'first_night',
    label:'Noc zmienia widoczność i zachowanie świata',
    cat:'🌿 Żywy świat',
    hint:'Pozostań na powierzchni po zachodzie słońca…',
    stage:'observation',tier:'observation',chain:'day_cycle',
    trigger:{event:'environment_state',match:{night:true}}
  },
  {
    id:'rain_soaks_hero',
    label:'Deszcz może nadać bohaterowi status mokrego',
    cat:'🌿 Żywy świat',
    hint:'Stań bez dachu podczas opadów…',
    stage:'observation',tier:'principle',chain:'weather',
    trigger:{event:'environment_state',match:{raining:true}}
  },
  {
    id:'seasons_change_world',
    label:'Pory roku cyklicznie zmieniają warunki świata',
    cat:'🍂 Pory roku',
    hint:'Pozostań w świecie do pierwszej zmiany pory roku…',
    stage:'observation',tier:'observation',chain:'seasons',
    trigger:{event:'season_changed'}
  },
  {
    id:'full_season_cycle',
    label:'Świat przechodzi przez cztery powracające pory roku',
    cat:'🍂 Pory roku',
    hint:'Doświadcz każdej pory w pełnym cyklu…',
    stage:'insight',tier:'principle',chain:'seasons',requires:['seasons_change_world'],
    trigger:{event:'season_changed',distinctBy:'season',distinct:4}
  },
  {
    id:'winter_freezes_water',
    label:'Zima zamyka powierzchnię wody warstwą lodu',
    cat:'🍂 Pory roku',
    hint:'Obserwuj płytką wodę podczas narastającej zimy…',
    stage:'insight',tier:'principle',chain:'seasons',requires:['seasons_change_world'],
    trigger:{event:'seasonal_transition',match:{change:'water_to_ice'},witnessRadius:18}
  },
  {
    id:'thaw_returns_water',
    label:'Odwilż przywraca wodę uwięzioną w sezonowym lodzie',
    cat:'🍂 Pory roku',
    hint:'Wróć do zamarzniętej wody, gdy zima ustąpi…',
    stage:'insight',tier:'principle',chain:'seasons',requires:['winter_freezes_water'],
    trigger:{event:'seasonal_transition',match:{change:'ice_to_water'},witnessRadius:18}
  },
  {
    id:'autumn_changes_leaves',
    label:'Jesień przebarwia liście zamiast natychmiast niszczyć drzewa',
    cat:'🍂 Pory roku',
    hint:'Obserwuj koronę drzewa podczas nadejścia jesieni…',
    stage:'observation',tier:'observation',chain:'seasons',requires:['seasons_change_world'],
    trigger:{event:'seasonal_transition',match:{change:'leaf_to_autumn'},witnessRadius:18}
  },
  {
    id:'spring_restores_leaves',
    label:'Wiosna przywraca zielone liście po sezonowym spoczynku',
    cat:'🍂 Pory roku',
    hint:'Wróć do przebarwionego drzewa po nadejściu wiosny…',
    stage:'discovery',tier:'principle',chain:'seasons',requires:['autumn_changes_leaves'],
    trigger:{event:'seasonal_transition',match:{change:'leaf_regrowth'},witnessRadius:18}
  },
  {
    id:'berry_harvest',
    label:'Dojrzałe jagody można zbierać wielokrotnie',
    cat:'🌿 Żywy świat',
    hint:'Znajdź dojrzały krzew i zbierz owoce…',
    stage:'observation',tier:'observation',chain:'plants',
    trigger:{event:'berry_harvest'}
  },
  {
    id:'tree_can_fall',
    label:'Podcięty pień przewraca całe drzewo',
    cat:'🌿 Żywy świat',
    hint:'Usuń dolny fragment stojącego pnia…',
    stage:'observation',tier:'principle',chain:'forest',
    trigger:{event:'tree_fall',witnessRadius:20}
  },
  {
    id:'first_fish',
    label:'Woda skrywa zasoby, których nie wydobywa kilof',
    cat:'🌿 Żywy świat',
    hint:'Zarzuć wędkę i podetnij w chwili brania…',
    stage:'observation',tier:'principle',chain:'fishing',
    trigger:{event:'fish_caught'}
  },
  {
    id:'golden_fish',
    label:'Wyjątkowy połów może otworzyć drogę do głębin',
    cat:'🌿 Żywy świat',
    hint:'Łów cierpliwie, aż trafi się coś naprawdę niezwykłego…',
    stage:'discovery',tier:'breakthrough',chain:'fishing',requires:['first_fish'],
    trigger:{event:'golden_fish_caught',match:{golden:true}}
  },
  {
    id:'sky_layer',
    label:'Wysoko nad chmurami istnieją kolejne warstwy świata',
    cat:'🧭 Eksploracja',
    hint:'Wznieś się znacznie ponad zwykłą powierzchnię…',
    stage:'discovery',tier:'application',chain:'sky',
    trigger:{event:'depth_zone',match:{zone:'sky'}}
  },

  // --- Walka, rozwój i łupy ----------------------------------------------
  {
    id:'first_hunt',
    label:'Pokonane zagrożenia przekazują doświadczenie',
    cat:'⚔ Nauka walki',
    hint:'Pokonaj stworzenie, które nadal stanowi dla bohatera wyzwanie…',
    stage:'observation',tier:'observation',chain:'combat',
    trigger:{event:'mob_killed'}
  },
  {
    id:'creatures_differ',
    label:'Świat zamieszkuje wiele odmiennych gatunków',
    cat:'⚔ Nauka walki',
    hint:'Pokonaj kilka różnych rodzajów stworzeń…',
    stage:'insight',tier:'principle',chain:'combat',requires:['first_hunt'],
    trigger:{event:'mob_killed',distinctBy:'species',distinct:3}
  },
  {
    id:'elemental_hit',
    label:'Obrażenia mogą nieść własny żywioł',
    cat:'⚔ Nauka walki',
    hint:'Traf przeciwnika ogniem, wodą, mrozem, prądem albo gazem…',
    stage:'observation',tier:'principle',chain:'combat_elements',
    trigger:{event:'combat_event',match:{kind:'elemental'}}
  },
  {
    id:'critical_opening',
    label:'Nieświadomy przeciwnik przyjmuje silniejszy cios z zaskoczenia',
    cat:'⚔ Nauka walki',
    hint:'Podejdź bez alarmowania stworzenia i uderz je jako pierwszy…',
    stage:'discovery',tier:'application',chain:'stealth',requires:['quiet_steps'],
    trigger:{event:'combat_event',match:{kind:'crit',cause:'backstab'}}
  },
  {
    id:'active_defense',
    label:'Aktywna obrona pochłania część nadchodzącego uderzenia',
    cat:'⚔ Nauka walki',
    hint:'Przyjmij cios podczas używania obrony…',
    stage:'insight',tier:'principle',chain:'combat',
    trigger:{event:'combat_event',match:{kind:'defend'}}
  },
  {
    id:'noise_attracts_creatures',
    label:'Stworzenia potrafią podejść do źródła hałasu, którego nie widzą',
    cat:'👂 Hałas i skradanie',
    hint:'Wywołaj dźwięk poza wzrokiem pobliskiego stworzenia i obserwuj jego ruch…',
    stage:'discovery',tier:'application',chain:'stealth',requires:['sprint_is_audible'],
    trigger:{event:'noise_attracted_creature',match:{heard:true},witnessRadius:24}
  },
  {
    id:'special_attack',
    label:'Naładowana technika zmienia zwykły atak',
    cat:'⚔ Nauka walki',
    hint:'Użyj specjalnej lub naładowanej techniki broni…',
    stage:'discovery',tier:'application',chain:'combat',
    trigger:{event:'combat_event',match:{kind:'special'}}
  },
  {
    id:'first_boss',
    label:'Niektóre stworzenia są wydarzeniami całego świata',
    cat:'⚔ Nauka walki',
    hint:'Pokonaj pierwszego pełnoprawnego bossa…',
    stage:'discovery',tier:'breakthrough',chain:'bosses',
    trigger:{event:'boss_defeated'}
  },
  {
    id:'guardian_fire_water_window',
    label:'Woda gasi pochodnie Strażnika Ognia i otwiera chwilę słabości',
    cat:'⚔ Prawa Strażników',
    hint:'Podczas walki z ogniem spróbuj ugasić źródło jego mocy…',
    stage:'discovery',tier:'principle',chain:'guardian_laws',
    trigger:{event:'guardian_principle',match:{kind:'fire_torch_cooled'},witnessRadius:32}
  },
  {
    id:'guardian_ice_listens_to_silence',
    label:'Serce ze szkła otwiera się dopiero, gdy lodowa kraina naprawdę ucichnie',
    cat:'⚔ Prawa Strażników',
    hint:'Przy Strażniku Lodu przestań walczyć z ciszą i pozwól jej wybrzmieć…',
    stage:'discovery',tier:'principle',chain:'guardian_laws',
    trigger:{event:'guardian_principle',match:{kind:'ice_silence_opened'},witnessRadius:32}
  },
  {
    id:'guardian_earth_fears_gas',
    label:'Trujący gaz płoszy Trzeciego Kreta i zmusza go do ucieczki w czystszy kamień',
    cat:'⚔ Prawa Strażników',
    hint:'Gdy odsłoni się rdzeń Strażnika Ziemi, sprawdź, jak reaguje na gaz…',
    stage:'discovery',tier:'principle',chain:'guardian_laws',
    trigger:{event:'guardian_principle',match:{kind:'earth_gas_repels'},witnessRadius:32}
  },
  {
    id:'guardian_earth_cairn_memory',
    label:'Kamienny kopiec pamięta otrzymane ciosy i oddaje je Strażnikowi Ziemi',
    cat:'⚔ Prawa Strażników',
    hint:'Nie ignoruj kopców wyrastających podczas walki pod ziemią…',
    stage:'discovery',tier:'principle',chain:'guardian_laws',
    trigger:{event:'guardian_principle',match:{kind:'earth_cairn_releases_damage'},witnessRadius:32}
  },
  {
    id:'guardian_air_resonator_shield',
    label:'Rezonatory przechwytują obrażenia przeznaczone dla Strażnika Nieba',
    cat:'⚔ Prawa Strażników',
    hint:'Zanim zaatakujesz koronę burzy, sprawdź, co podtrzymuje jej ochronę…',
    stage:'insight',tier:'principle',chain:'guardian_laws',
    trigger:{event:'guardian_principle',match:{kind:'air_resonators_shield'},witnessRadius:32}
  },
  {
    id:'guardian_center_reflects_damage',
    label:'Zwierciadło nie przyjmuje ciosu — odbija go prosto w bohatera',
    cat:'⚔ Prawa Strażników',
    hint:'W samym środku świata uważnie obserwuj, kto naprawdę cierpi po twoim ataku…',
    stage:'discovery',tier:'principle',chain:'guardian_laws',
    trigger:{event:'guardian_principle',match:{kind:'center_mirror_reflects'},witnessRadius:32}
  },
  {
    id:'death_teaches_risk',
    label:'Kosztowna śmierć odbiera zasoby lub uruchamia Echo Chwili',
    cat:'🧍 Na własnej skórze',
    hint:'Ta obserwacja przyjdzie sama, jeśli ryzyko okaże się zbyt duże…',
    stage:'observation',tier:'principle',chain:'survival',
    trigger:{event:'hero_died',match:{costly:true}}
  },
  {
    id:'death_leaves_escrow',
    label:'Duch Chwili przechowuje utracone zasoby w miejscu śmierci',
    cat:'⏳ Echo Chwili',
    hint:'Po kosztownej śmierci zwróć uwagę na świetlistego ducha…',
    stage:'observation',tier:'observation',chain:'temporal_echo',requires:['death_teaches_risk'],
    trigger:{event:'temporal_echo_started',match:{resources:{$gt:0}}}
  },
  {
    id:'echo_is_timed',
    label:'Świetlisty Duch Chwili istnieje tylko przez jedną minutę',
    cat:'⏳ Echo Chwili',
    hint:'Spójrz na odliczanie po śmierci i rusz natychmiast…',
    stage:'insight',tier:'principle',chain:'temporal_echo',requires:['death_leaves_escrow'],
    trigger:{event:'temporal_echo_timer_seen',match:{seconds:{$gt:0}}}
  },
  {
    id:'echo_rewinds_world',
    label:'Dotknięcie ducha cofa świat do chwili śmierci i przywraca pełne zdrowie',
    cat:'⏳ Echo Chwili',
    hint:'Dotrzyj do Ducha Chwili przed końcem odliczania…',
    stage:'discovery',tier:'breakthrough',chain:'temporal_echo',requires:['echo_is_timed'],
    trigger:{event:'temporal_echo_recovered',match:{worldRestored:true,fullHealth:true}}
  },
  {
    id:'expired_echo_loses_resources',
    label:'Po wygaśnięciu Echa depozyt przepada, a duch znika',
    cat:'⏳ Echo Chwili',
    hint:'Pozwól odliczaniu dobiec końca, aby poznać cenę spóźnienia…',
    stage:'insight',tier:'principle',chain:'temporal_echo',requires:['echo_is_timed'],
    trigger:{event:'temporal_echo_expired',match:{lost:{$gt:0}}}
  },
  {
    id:'skill_point',
    label:'Poziomy zamieniają doświadczenie w wybór rozwoju',
    cat:'🧍 Na własnej skórze',
    hint:'Zdobądź dość doświadczenia, aby otrzymać punkt umiejętności…',
    stage:'insight',tier:'principle',chain:'progression',
    trigger:{event:'skill_point'}
  },
  {
    id:'chests_release_loot',
    label:'Skrzynie wyrzucają fizyczny łup do świata',
    cat:'🎁 Łupy',
    hint:'Otwórz pierwszą znalezioną skrzynię…',
    stage:'observation',tier:'observation',chain:'loot',
    trigger:{event:'chest_opened',match:{spawned:{$gt:0}}}
  },
  {
    id:'chest_rarity',
    label:'Kolor skrzyni zapowiada jakość, lecz nie gwarantuje wyniku',
    cat:'🎁 Łupy',
    hint:'Otwórz skrzynię rzadszą niż zwykła…',
    stage:'insight',tier:'principle',chain:'loot',requires:['chests_release_loot'],
    trigger:{event:'rare_chest_opened',match:{tier:{$in:['rare','epic','legendary']}}}
  },
  {
    id:'legendary_chest',
    label:'Legendarna skrzynia wieńczy drabinę skarbów',
    cat:'🎁 Łupy',
    hint:'Odszukaj i otwórz najrzadszy rodzaj skrzyni…',
    stage:'discovery',tier:'breakthrough',chain:'loot',requires:['chest_rarity'],
    trigger:{event:'legendary_chest_opened',match:{tier:'legendary'}}
  }
];

function freezeTrigger(trigger){
  if(!trigger || typeof trigger!=='object') return null;
  const out=Object.assign({},trigger);
  if(trigger.match && typeof trigger.match==='object') out.match=Object.freeze(Object.assign({},trigger.match));
  return Object.freeze(out);
}

export const KNOWLEDGE_CATALOG=Object.freeze(rows.map((row,index)=>Object.freeze({
  id:String(row.id),
  label:String(row.label),
  cat:String(row.cat),
  hint:String(row.hint),
  stage:String(row.stage||'discovery'),
  tier:String(row.tier||'principle'),
  chain:String(row.chain||''),
  icon:row.icon==null?'':String(row.icon),
  requires:Object.freeze(Array.isArray(row.requires)?row.requires.map(String):[]),
  order:index,
  trigger:freezeTrigger(row.trigger)
})));

export default KNOWLEDGE_CATALOG;
