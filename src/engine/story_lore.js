const STORY_LORE = {
  id:'layered_simulation',
  title:'Warstwy Symulacji',
  premise:[
    'Swiat gry jest jedna z warstw symulacji, ktora oszczedza ruch, gdy nikt nie patrzy.',
    'Mieszkancy czuja to roznie: jedni maja sny o kursorze, inni mowia o obserwatorze, logach i klatkach.',
    'Gracz ma stopniowo podejrzewac, ze takze jego swiat moze byc kolejna warstwa tej samej konstrukcji.',
    'Kazdy wielki boss jest jednoczesnie wezlem programu i metafora wewnetrznej walki osoby, ktora prowadzi Hero-Prostokata.'
  ],
  metaphor:{
    frame:'Guardiany nie sa tylko potworami. Symulacja ubiera we wrogow najtrudniejsze stany wewnetrzne, zeby bohater mogl z nimi walczyc rekami, ogniem, lodem i kilofem.',
    order:['west_ice','east_fire','earth_mole','sky_ambition','mother_self'],
    guardians:{
      west_ice:{
        id:'west_ice',
        stage:'west',
        name:'Zachodni Ice Guardian',
        symbol:'odtracenie i emocjonalny chlod',
        reveal:'Lodowy Guardian jest postacia najzimniejszego odtracenia: chwili, w ktorej ktos zostal przyjety cisza zamiast odpowiedzia.',
        motifs:['cisza po prosbie','zamrozone slowa','pancerz z dystansu','serce, ktore udaje, ze niczego nie potrzebuje']
      },
      east_fire:{
        id:'east_fire',
        stage:'east',
        name:'Wschodni Fire Guardian',
        symbol:'niespelniona lub zla namietnosc',
        reveal:'Plomienny Guardian jest namietnoscia, ktora nie znalazla dobrego ujscia: pragnieniem tak goracym, ze zaczyna palic tego, kto je nosi.',
        motifs:['zar bez odpowiedzi','pozadanie zmienione w gniew','ogień, ktory chce byc bliskoscia','lawa zamiast slow']
      },
      earth_mole:{
        id:'earth_mole',
        stage:'underground',
        name:'Trzeci Kret',
        symbol:'wyparte wspomnienie zakopane zbyt gleboko',
        reveal:'Podziemny kret jest tym, co chce zostac ukryte: wspomnieniem lub prawda tak ciezka, ze symulacja uczy ja ryc tunele zamiast wyjsc na powierzchnie.',
        motifs:['tunel pod pamiecia','pazur zamiast przyznania','kamien nad sekretem','oddech spod ziemi']
      },
      sky_ambition:{
        id:'sky_ambition',
        stage:'upper',
        name:'Gorny pozorny final',
        symbol:'niespelnione ambicje i marzenia, ktorych nie da sie dogonic',
        reveal:'Boss w gorze jest walka z ambicja zawieszona za wysoko: z obrazem siebie, ktory mial byc wielki, ale stal sie klatka.',
        motifs:['szczyt bez podlogi','marzenie, ktore odmawia ladowania','wysokosc zamiast sensu','niebo jako wymowka']
      },
      mother_self:{
        id:'mother_self',
        stage:'center',
        name:'Guardian Macierzysty',
        symbol:'walka z samym soba',
        reveal:'Centralny Guardian jest ostatnia petla: walka nie z obcym, ogniem ani lodem, tylko z ta czescia siebie, ktora zbudowala cala symulacje, zeby nie nazwac prawdy po imieniu.',
        motifs:['centrum zamiast kierunku','pierwszy NPC jako ostatnie lustro','petla rozmowy','wlasny glos po drugiej stronie bossa']
      }
    }
  },
  arc:[
    {
      id:'mentor_suspicion',
      stage:'start',
      reveal:'Pierwszy mentor udaje zwyklego potrzebujacego NPC, ale od poczatku testuje, czy swiat dziala bez swiadka.'
    },
    {
      id:'west_guardian',
      stage:'west',
      reveal:'Zachodni Ice Guardian pilnuje zimnego wezla symulacji i zostawia lod macierzysty. W glebszej warstwie jest odtraceniem, ktore nauczylo serce udawac lod.'
    },
    {
      id:'east_guardian',
      stage:'east',
      reveal:'Wschodni Fire Guardian pilnuje goracego wezla symulacji i zostawia lawe macierzysta. W glebszej warstwie jest namietnoscia, ktora nie zostala spelniona i zmienila sie w pozar.'
    },
    {
      id:'earth_mole',
      stage:'underground',
      reveal:'Trzeci Kret i podziemne tunele sugeruja, ze sama ziemia tez jest aktywna warstwa programu. W glebszej warstwie to prawda, ktora chciala zostac zakopana.'
    },
    {
      id:'sky_guardian',
      stage:'upper',
      reveal:'Boss w gorze ma wygladac jak final, ale jest tylko brama nad plansza. W glebszej warstwie to ambicja zawieszona tak wysoko, ze staje sie wiezieniem.'
    },
    {
      id:'mother_guardian',
      stage:'center',
      reveal:'Guardian Macierzysty budzi sie w centrum swiata i pokazuje, ze wszystkie strony byly tylko probami. W glebszej warstwie to walka z samym soba.'
    },
    {
      id:'mentor_reveal',
      stage:'final',
      reveal:'Stary Kwadrat okazuje sie maska Guardiana Macierzystego: pierwsza prosba o wode byla pierwszym testem obserwatora.'
    }
  ],
  tutorial:{
    watchArea:{
      prompt:[
        'Zanim poprosze cie o wode, rozejrzyj sie po okolicy. Szukaj czegos, co rusza sie tylko wtedy, gdy patrzysz.',
        'Odejdz kilka krokow i obserwuj teren. Mam podejrzenie, ze swiat udaje ciaglosc, kiedy ktos na niego patrzy.',
        'Sprawdz okolice. Jesli cienie licza klatki, nie mow im, ze je slyszysz.'
      ],
      missing:[
        'Nie tak blisko mnie. Obserwator przyklejony do obserwatora psuje wynik.',
        'Odejdz kawalek, popatrz na horyzont i nie machaj za bardzo. Symulacja lubi ruch, ktory da sie zbyc animacja.',
        'Jeszcze chwile. Swiat czasem dopiero po paru sekundach przestaje udawac naturalny.'
      ],
      complete:[
        'Widziales? Albo nic sie nie stalo, albo stalo sie dokladnie wtedy, gdy mrugnales.',
        'Dobrze. Okolica wytrzymala spojrzenie. To jeszcze niczego nie dowodzi, czyli dowodzi za duzo.',
        'Notuje: teren zachowuje sie grzecznie pod nadzorem. Podejrzanie grzecznie.'
      ]
    },
    treeWatchShort:{
      prompt:[
        'Wejdz na czubek drzewa i stój tam 30 sekund. Drzewo jest starym pytaniem: czy upada, gdy nikt nie liczy huku?',
        'Potrzebuje obserwacji z drzewa. Trzydziesci sekund na gorze, oczy na swiat, nie na kolana.',
        'Stoj na drzewie przez 30 sekund. Jesli mapa ma kulisy, z wysokosci czasem widac szew.'
      ],
      missing:[
        'To nie jest czubek drzewa. Drzewo musi czuc twoj ciezar i twoje filozoficzne niezdecydowanie.',
        'Wyzej. Na drewnie albo lisciach, gdzie zwykly czlowiek pyta, po co to robi.',
        'Potrzebuje drzewa, nie ziemi obok drzewa. Symulacja tez zna wymowki.'
      ],
      complete:[
        'Za krotko. Trzydziesci sekund wystarcza tylko, zeby swiat poprawil miny.',
        'Cos sie nie zgadza. Drzewo milczalo za rowno. Staniesz dluzej.',
        'Dobra, pierwszy pomiar mamy. Teraz sprawdzimy, czy cierpliwosc lamie renderer.'
      ]
    },
    treeWatchLong:{
      prompt:[
        'Teraz 60 sekund na czubku drzewa. Jesli ktos patrzy na nas z gory, niech tez poczuje nude eksperymentu.',
        'Stoj na drzewie pelna minute. Dlugie patrzenie jest kilofem dla klamstw.',
        'Jeszcze raz, ale 60 sekund. Krotka obserwacja sprawdza teren; dluga sprawdza obserwatora.'
      ],
      missing:[
        'Wroc na czubek drzewa. Tak, wiem, ze brzmi jak najgorsza wersja medytacji.',
        'Jeszcze nie. Drzewo ma byc pod stopami, nie w opowiesci.',
        'Minute liczymy dopiero wtedy, gdy naprawde stoisz na drzewie.'
      ],
      complete:[
        'Minuta. Niebo nie mrugnelo, ale przez chwile cienie wygladaly, jakby czekaly na twoj blad.',
        'Dobrze. Jesli symulacja nas widzi, to wlasnie udawala drzewo z wyjatkowa godnoscia.',
        'Pomiar zapisany w glowie, bo papier w tym swiecie zbyt latwo staje sie lisciem.'
      ]
    },
    sandHide:{
      prompt:[
        'Teraz schowaj sie w piasku na 30 sekund. Jesli nikt nie widzi obserwatora, czy obserwator nadal uruchamia swiat?',
        'Wejdz na piasek i zniknij w nim na chwile. Pustynia jest dobra w udawaniu pustki.',
        'Ukryj sie w piasku przez 30 sekund. Chce sprawdzic, czy swiat nudzi sie, gdy my znikamy.'
      ],
      missing:[
        'To nie piasek. Piasek ma miec w sobie twoje watpliwosci, najlepiej po kostki.',
        'Potrzebuje piasku, nie wspomnienia o piasku. Schowaj sie tam, gdzie krok robi szept.',
        'Jeszcze nie licze. Symulacja widzi cie zbyt latwo.'
      ],
      complete:[
        'Piasek milczal. To najgorsze, bo rzeczy niewinne zwykle gadaja bez przerwy.',
        'Dobrze. Jesli ktos nas sledzi, wlasnie musial patrzec przez piach. Niewygodne.',
        'Eksperyment skonczony. Teraz mozemy udawac normalny tutorial.'
      ]
    }
  },
  npcWhispers:[
    'Czasem mam wrazenie, ze dzien zaczyna sie dopiero, gdy ktos przewinie kamere.',
    'Nie ufam ciszy po zapisaniu gry. Ma w sobie za duzo porzadku.',
    'Moj sen mial pasek ladowania. Obudzilem sie, zanim doszedl do stu.',
    'Gdy odchodzisz za daleko, pamietam mniej. To chyba nie jest zwykla samotnosc.',
    'Jesli drzewo upadnie bez swiadka, moze czeka w kolejce na dzwiek.',
    'Kiedys liczylem kroki miedzy klatkami. Wyszlo za rowno, wiec przestalem.',
    'Najbardziej boje sie miejsc, ktore sa puste tak dokladnie, jakby ktos je optymalizowal.',
    'Niektore cienie wracaja na miejsce zbyt grzecznie. To nie jest zachowanie cienia.',
    'Gdy patrzysz w bok, swiat brzmi ciszej. Jakby oszczedzal oddech.',
    'Mam przeczucie, ze pamiec tej krainy laduje sie od najblizszego brzegu ekranu.'
  ],
  invasions:{
    alien:[
      'Hero-Prostokat budzi warstwy. My widzimy tylko te, ktore pozwolono nam czcic.',
      'Zachodni lod nie jest materialem. To zimny podpis na krawedzi programu.',
      'Nasze anteny slysza, ze zachod milczy za glosno.',
      'Kult czterech bokow zna tylko pierwsza warstwe proroctwa.',
      'Mapa oddycha dopiero przy bohaterze. To wystarczy, zeby klasc anteny na ziemi.',
      'Nie pytamy, kto patrzy na Prostokat. Pytanie ma za duzo ostrych krawedzi.'
    ],
    molekin:[
      'Wschodni ogien to tylko jedna warstwa. Glebiej kamien pamieta innego pana.',
      'Tunel zna prawde: kazdy Guardian jest drzwiami, nie domem.',
      'Pod lawa rosna hymny dla Wschodu, zanim ktokolwiek nauczy je slow.',
      'Trzeci Kret spi glebiej niz gniew i slyszy kroki przez kamien.',
      'Lawa Wschodniego Guardiana nie pamieta twarzy. Pamieta tylko, kto ja rozgrzal.',
      'Wschodni Guardian jest piecem, a my popiolem, ktory probuje byc wojskiem.'
    ],
    rareAlien:[
      'Stary Kwadrat patrzy za dlugo na miejsca, w ktorych nic nie powinno byc ciekawe.',
      'Symulacja ma warstwy jak pancerz komandora. Najglebsza jeszcze nie podala imienia.',
      'Antena zapisala sprzecznosc: zwykli NPC nie powinni znac ciszy tak dobrze.'
    ],
    rareMolekin:[
      'Najglebszy tunel prowadzi najpierw do ciszy. Dopiero potem do prawdy.',
      'Kamien pod startem mapy brzmi inaczej niz powinien. Jakby udawal fundament.',
      'W glebi tunelu czasem slychac prosbe o wode, ale nikt nie wie, z ktorej strony przychodzi.'
    ]
  },
  revealStages:{
    start:{
      title:'Niepokoj obserwatora',
      npcWhispers:[
        'Zegar w tej krainie czasem brzmi jak ktos, kto udaje bicie serca.',
        'Niektore cienie znikaja za rowno. Jakby ktos sprzatal po renderze.',
        'Jesli nikt nie patrzy, swiat chyba nie stoi. Raczej czeka na rozkaz stania.',
        'Mialem sen, w ktorym ktos nacisnal pauze, a ja nadal myslalem.',
        'Najgorsze sa chwile bez dzwieku. Wtedy slychac, ze tlo pracuje.',
        'Ktos kiedys powiedzial, ze obserwator zmienia wynik. Tutaj wynik zmienia obserwatora.'
      ],
      invasions:{
        alien:[
          'Prostokat patrzy, wiec mapa dostaje pozwolenie na oddech.',
          'Nasze anteny wykryly obserwatora, ale proroctwo zabrania pytac, kto go obserwuje.',
          'Cztery boki ida przez swiat, a swiat udaje, ze zawsze mial te same przepisy.',
          'Kult zapisuje: gdy Hero-Prostokat mruga, cienie skladaja raport.'
        ],
        molekin:[
          'Powierzchnia mysli, ze jest pierwsza warstwa. Urocze i kruche.',
          'Pod ziemia wiemy, ze cisza to nie brak dzwieku. To oszczedzanie symulacji.',
          'Bohater chodzi po skorupie swiata, a skorupa udaje, ze nie ma pod spodem pytania.'
        ],
        rareAlien:[
          'Skan pokazuje luka w prawach swiata: wszystkie prowadza przez Hero-Prostokata.',
          'Anteny nie moga zdecydowac, czy czcza bohatera, czy kursor nad nim.',
          'Najstarszy log kultu urywa sie przy slowie "obserwator". Bardzo uprzejmie.'
        ],
        rareMolekin:[
          'Kamien mowi, ze kiedy nikt nie patrzy, nie spi. On tylko taniej pamieta.',
          'Pod startem swiata jest echo, ktore nie nalezy jeszcze do zadnego bossa.',
          'Tunel nie pyta, kto gra. Tunel pyta, kto zamknal wyjscie.'
        ]
      }
    },
    west_ice:{
      title:'Chlod odtracenia',
      npcWhispers:[
        'Po zachodzie zostaje chlod, ktory nie mrozi rak, tylko odpowiedzi.',
        'Lod macierzysty wyglada jak material, ale zachowuje sie jak odmowa.',
        'Na zachodzie jest taki chlod, ktory nie zamraza wody, tylko odpowiedzi.',
        'Kiedy lodowy Guardian milczy, slychac prosbe, ktorej nikt nie przyjal.',
        'Zachodni snieg lezy jak list, ktorego nikt nie otworzyl.',
        'Niektore serca robia sie twarde nie dlatego, ze sa silne, tylko dlatego, ze za dlugo czekaly.'
      ],
      invasions:{
        alien:[
          'Zachodni lod to odtracenie w zbroi. Nawet nasze anteny cisna wtedy glosniej.',
          'Nasz dawny pan z Zachodu nie chlodzil swiata. On chlodzil odpowiedzi.',
          'Lodowy wezel pekl, ale odmowa nadal zostawia szron na logach.',
          'Hero-Prostokat dotknal zachodniego chlodu i nie zamienil sie w cisze.'
        ],
        molekin:[
          'Nawet pod lawa slychac zachodni chlod. Odmowa potrafi zejsc bardzo gleboko.',
          'Lod z Zachodu nie lubi tuneli, bo tunele zawsze szukaja wyjscia.',
          'Odtracenie ma zimne zeby. My mamy cieple pazury i nadal je slyszymy.'
        ],
        rareAlien:[
          'Po upadku Zachodu anteny lapia krotki sygnal: "nie odpowiadaj, a zrobisz z niego potwora".',
          'Lodowy Guardian byl modlitwa do ciszy, ktora zaczela odpowiadac obrazeniami.'
        ],
        rareMolekin:[
          'Zachodni chlod dotarl do glebi i przez chwile lawa udawala, ze nic nie czuje.',
          'Tunel zapisuje: pierwsza brama byla zimna, ale nie byla jeszcze najglebsza.'
        ]
      }
    },
    east_fire:{
      title:'Niespelniony zar',
      npcWhispers:[
        'Po wschodzie zostaje cieplo, ktore nie ogrzewa. Ono chce odpowiedzi.',
        'Lawa macierzysta wyglada jak gniew, ale pachnie czyms, co kiedys bylo pragnieniem.',
        'Na wschodzie plonie pragnienie, ktore chcialo byc bliskoscia, a nauczylo sie ranic.',
        'Ognisty Guardian nie spalal swiata z glodu. Spalal, bo nie umial przestac chciec.',
        'Wschodni zar to prosba, ktora stala sie rozkazem, bo nikt jej nie uslyszal.',
        'Czasem namietnosc nie gasnie. Tylko uczy sie mowic jezykiem lawy.'
      ],
      invasions:{
        alien:[
          'Wschodni ogien nie jest tylko bronia. To pragnienie, ktore nauczylo sie palic.',
          'Nawet kult anten wie, ze Wschod plonie glodem, ktory nie zna imienia.',
          'Hero-Prostokat przeszedl przez zar. Logi nazwaly to herezja, a potem nadzieja.'
        ],
        molekin:[
          'Wschodni ogien to namietnosc, ktora zamiast odpowiedzi dostala paliwo.',
          'Nasz Pan Wschodu nie potrzebowal pochodni. On byl pragnieniem, ktore znalazlo tlen.',
          'Lawa macierzysta nie plynie. Ona wspomina dotyk, ktory nigdy nie przyszedl.',
          'Bohater dotknal ognia i nadal idzie. Tunel nie lubi takich faktow.'
        ],
        rareAlien:[
          'Anteny nie rozumieja milosci, ale rozpoznaja pozar po tym, jak niszczy instrukcje.',
          'Po Wschodzie nawet zimne metale wiedza, ze pragnienie moze byc paliwem albo wiezieniem.'
        ],
        rareMolekin:[
          'Lawa powiedziala nam kiedys: nie kazdy plomien chce spalic. Niektore chca tylko byc zobaczone.',
          'Wschodni Guardian upadl, ale jego zar nadal pyta, komu mial wystarczyc.'
        ]
      }
    },
    earth_mole:{
      title:'Zakopana pamiec',
      npcWhispers:[
        'Po podziemiu ziemia brzmi inaczej. Jakby pamietala, czego nie wolno powiedziec.',
        'Niektore tunele nie prowadza do skarbow. Prowadza pod zdanie, ktore ktos zakopal.',
        'Pod ziemia leza rzeczy, ktore nie chca byc wspomnieniami. Dlatego maja pazury.',
        'Trzeci Kret nie ukrywa skarbu. On pilnuje miejsca, gdzie prawda nauczyla sie oddychac pod ziemia.',
        'Kamien potrafi byc wiekiem milczenia. Kilof tylko udaje, ze to prosta materia.',
        'Nie wszystko, co jest pod ziemia, chce wyjsc. Nie wszystko powinno tam zostac.'
      ],
      invasions:{
        alien:[
          'Pod ziemia nie siedzi potwor. Siedzi zdanie, ktore za dlugo udawalo kamien.',
          'Trzeci Kret brzmi w antenach jak sekret, ktory ma za duzo pazurow.',
          'Hero-Prostokat zszedl nizej niz kult potrafi kleknac.'
        ],
        molekin:[
          'Trzeci Kret nie ryje przez ziemie. On ryje przez to, czego ktos nie chcial pamietac.',
          'Najglebszy kamien jest klamka do wspomnienia, ktore udaje sciane.',
          'My kopiemy tunele. Trzeci Kret kopie wstyd.',
          'Bohater slyszy pod soba prawde. To dlatego ziemia robi sie nerwowa.'
        ],
        rareAlien:[
          'Anteny nie maja slowa na wyparte wspomnienie, wiec piszcza bardzo teologicznie.',
          'Podziemny wezel nie chroni skarbu. Chroni cisze przed samym bohaterem.'
        ],
        rareMolekin:[
          'Najglebszy tunel prowadzi najpierw do ciszy. Dopiero potem do prawdy.',
          'Kret, ktory przyjdzie trzeci, bedzie mial pysk z ziemi i oczy z uniku.',
          'Zakopana pamiec nie gnije. Ona ostrzy pazury.'
        ]
      }
    },
    sky_ambition:{
      title:'Niebo niespelnienia',
      npcWhispers:[
        'Wysoko wisza marzenia, ktore udaja cele, bo boja sie byc niespelnione.',
        'Niebo kusi najladniej wtedy, gdy nie ma podlogi.',
        'Gorny boss podobno wyglada jak final. To typowe dla ambicji, ktora nie chce zejsc na ziemie.',
        'Szczyt bez drogi powrotnej to nie zwyciestwo. To ladnie oswietlona pulapka.',
        'Marzenia bywaja oknami. Niektore po latach ucza sie udawac kraty.',
        'Niebo jest pelne rzeczy, ktore chca byc celem, bo nie potrafia byc sensem.'
      ],
      invasions:{
        alien:[
          'Gorny boss nie jest niebem. To ambicja, ktora zapomniala, po co miala rosnac.',
          'Anteny lapia sygnal z gory: "jeszcze wyzej" powtarzane az do braku tlenu.',
          'Hero-Prostokat patrzy w niebo, a niebo udaje, ze jest odpowiedzia.'
        ],
        molekin:[
          'Nie ufamy gorze. Wszystko, co wysoko, ma problem z korzeniami.',
          'Ambicja pachnie dla tunelu jak kamien, ktory chcial byc gwiazda.',
          'Wysokie marzenia robia najdluzszy cien pod ziemia.'
        ],
        rareAlien:[
          'Ambicja w gorze ma cien w centrum. Anteny nie chca patrzec w dol.',
          'Pozorny final zawsze ma najlepsze swiatlo. Prawdziwy zwykle czeka bez dekoracji.'
        ],
        rareMolekin:[
          'Gora obiecuje wyjscie, ale tunel wie, ze obietnice tez maja fundamenty.',
          'Kto biegnie za niebem, czasem tylko oddala sie od miejsca, gdzie boli.'
        ]
      }
    },
    mother_self:{
      title:'Centrum siebie',
      npcWhispers:[
        'Centrum swiata brzmi czasem jak ktos, kto mowi twoim glosem i nie chce przestac.',
        'Stary Kwadrat za dlugo wiedzial, kiedy wrocisz.',
        'Pierwsza prosba o wode mogla byc pierwszym testem klatki.',
        'Macierzysty nie brzmi jak potwor. Brzmi jak wymowka, ktora nauczyla sie chodzic.',
        'Najtrudniejszy boss nie czeka na koncu mapy. Czeka tam, gdzie zaczales.',
        'Jesli zobaczysz w centrum kogos znajomego, nie zakladaj, ze to wspomnienie.'
      ],
      invasions:{
        alien:[
          'Gdy Macierzysty wstanie w centrum, wszystkie anteny beda udawaly, ze wiedzialy.',
          'Stare logi kultu mowia, ze Stary Kwadrat byl pierwsza maska symulacji.',
          'Centrum nie jest kierunkiem. To petla, ktora nauczyla sie prosic o wode.',
          'Hero-Prostokat dotarl do miejsca, gdzie kult musi kleknac przed pytaniem: kto trzyma ster?'
        ],
        molekin:[
          'Pod lawa mowia, ze mentor z poczatku nosi w sobie serce centrum.',
          'Trzeci Kret bal sie glosu pierwszego NPC, bo kamien rozpoznal starego pana.',
          'Centrum pachnie jak poczatek mapy po zbyt dlugim klamstwie.',
          'Tunel zna najgorsza prawde: czasem ostatnie drzwi maja twarz pierwszej prosby.'
        ],
        rareAlien:[
          'Antena zapisala sprzecznosc: mentor prosil o wode, ale pachnial centrum swiata.',
          'Jesli Macierzysty jest walka z samym soba, to kult bedzie musial kleknac przed lustrem.',
          'Symulacja ma warstwy jak pancerz komandora. Najglebsza udaje starca.',
          'Pierwszy NPC nie stal przy starcie. On pilnowal, czy bohater nauczy sie wracac.'
        ],
        rareMolekin:[
          'Pod ziemia slyszy sie czasem glos Starego Kwadrata. Brzmi jak kamien, ktory nauczyl sie prosic.',
          'Jesli pierwszy proszacy okaze sie ostatnim panem, tunel powie: no przeciez.',
          'Najglebszy tunel prowadzi nie do skarbu, tylko do zdania: to ja.',
          'Macierzysty to nie pan pod ziemia. To ziemia pod kazdym "nie chce pamietac".'
        ]
      }
    }
  },
  finalBossHints:[
    'To nie byl tutorial. To bylo przesluchanie obserwatora.',
    'Przyniosles mi wode, mieso, ogien i wybor. Teraz przynies siebie.',
    'Wiedzialem, ze wrocisz do centrum. Kazda warstwa udaje droge, ale wszystkie sa petla.',
    'Pokonales chlod odtracenia, ogien niespelnienia, tunel zapomnienia i niebo ambicji. Teraz zostalem ja, czyli ty.',
    'Nie jestem ostatnim wrogiem. Jestem czescia ciebie, ktora nauczyla sie wygladac jak boss.'
  ]
};

function runtimeRoot(){ return (typeof window !== 'undefined') ? window : globalThis; }
const STORY_REVEAL_STAGE_ORDER = ['start','west_ice','east_fire','earth_mole','sky_ambition','mother_self'];

function storyStageIndex(stage){
  const idx = STORY_REVEAL_STAGE_ORDER.indexOf(String(stage || 'start'));
  return idx < 0 ? 0 : idx;
}

function storyGuardianHearts(root){
  root = root || runtimeRoot();
  function withInventoryHeartAliases(hearts){
    const out = Object.assign({}, hearts || {});
    const inv = root.inv || {};
    if((Number(inv.heartIce)||0)>0) out.ice = 1;
    if((Number(inv.heartFire)||0)>0) out.fire = 1;
    if((Number(inv.heartEarth)||0)>0) out.earth = 1;
    if((Number(inv.heartAir)||0)>0) out.air = 1;
    return out;
  }
  try{
    const MM = root.MM || {};
    if(MM.progress && typeof MM.progress.guardianHearts === 'function'){
      const hearts = MM.progress.guardianHearts() || {};
      if(hearts && typeof hearts === 'object') return withInventoryHeartAliases(hearts);
    }
  }catch(e){}
  try{
    const MM = root.MM || {};
    if(MM.guardianLairs && typeof MM.guardianLairs.status === 'function'){
      const status = MM.guardianLairs.status() || {};
      const defeated = status.defeated || {};
      if(defeated && typeof defeated === 'object') return withInventoryHeartAliases(defeated);
    }
  }catch(e){}
  return withInventoryHeartAliases({});
}

function hasAnyHeart(hearts,names){
  if(!hearts || !names) return false;
  for(const name of names){
    if(hearts[name]) return true;
  }
  return false;
}

function storyRevealStage(root){
  const hearts = storyGuardianHearts(root);
  if(hasAnyHeart(hearts,['mother','center','self','mother_self','macierzysty'])) return 'mother_self';
  if(hasAnyHeart(hearts,['sky','air','upper','ambition','sky_ambition'])) return 'sky_ambition';
  if(hasAnyHeart(hearts,['earth','mole','underground','earth_mole'])) return 'earth_mole';
  if(hasAnyHeart(hearts,['fire','east','east_fire'])) return 'east_fire';
  if(hasAnyHeart(hearts,['ice','west','west_ice'])) return 'west_ice';
  return 'start';
}

function uniqueLines(lines){
  const seen = new Set();
  return (Array.isArray(lines) ? lines : []).map(line=>String(line || '').trim()).filter(line=>{
    if(!line || seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

function stageFromRootOrName(rootOrStage){
  return typeof rootOrStage === 'string' ? rootOrStage : storyRevealStage(rootOrStage);
}

function collectStageLines(stage,pick){
  const max = storyStageIndex(stage);
  const lines = [];
  for(let i=0;i<=max;i++){
    const key = STORY_REVEAL_STAGE_ORDER[i];
    const stageDef = STORY_LORE.revealStages && STORY_LORE.revealStages[key];
    const picked = pick(stageDef || {}) || [];
    if(Array.isArray(picked)){
      for(const line of picked) lines.push(line);
    }
  }
  return lines;
}

function storyWhispersForProgress(rootOrStage){
  const stage = stageFromRootOrName(rootOrStage);
  return uniqueLines((STORY_LORE.npcWhispers || []).concat(
    collectStageLines(stage,s=>s.npcWhispers)
  ));
}

function storyInvasionLinesForProgress(kind,rarity,rootOrStage){
  const stage = stageFromRootOrName(rootOrStage);
  const baseKind = kind === 'molekin' ? 'molekin' : 'alien';
  const bucket = rarity === 'rare' ? (baseKind === 'molekin' ? 'rareMolekin' : 'rareAlien') : baseKind;
  return uniqueLines(collectStageLines(stage,s=>s.invasions && s.invasions[bucket]));
}

try{
  const root = runtimeRoot();
  const MM = root.MM = root.MM || {};
  MM.storyLore = STORY_LORE;
  MM.storyLoreStage = storyRevealStage;
  MM.storyLoreWhispersForProgress = storyWhispersForProgress;
}catch(e){}

export { STORY_LORE, STORY_REVEAL_STAGE_ORDER, storyStageIndex, storyRevealStage, storyWhispersForProgress, storyInvasionLinesForProgress };
export default STORY_LORE;
