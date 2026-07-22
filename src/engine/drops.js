// Physical ground loot: slain creatures shed collectible pickups that fall,
// bounce and lie in the world instead of teleporting into the inventory.
//
// Four payload kinds share one entity list. Chests are persistent heavy world
// objects: they open in place and are never vacuumed into the inventory.
//   * resource drops ({res,qty}) — meat scraps, trophy parts, spec.loot rolls;
//     picked up they add straight into the block inventory (window.inv).
//   * gear drops ({item}) — procedural equipment from THEMED species (a bat can
//     shed a cape, an owl its eyes, a skeleton its blade); picked up they ride
//     the chest-loot pipeline (MM.dynamicLoot -> bag + loot inbox popup).
//   * jewel drops ({res}) — very rare, long-lived permanent-upgrade stones with
//     their own reveal beam, particles and learned bell on arrival and pickup.
//
// Pickup contract: E sweeps everything in reach (the wardrobe/mech E
// precedence asks wantsInteractKey first). Normal auto-pickup comes only from
// worn lootMagnetLevel gear: current tile, then +1/+2/+3 tile rings. A separate
// persisted developer override lives in the debug toolbox. Rarity is a visible
// promise AND a ticking bomb: rare/epic
// drops glow in their tier color, epic ones carry a light beam — but the better
// the find, the FASTER it expires, with a countdown bar over rare+ gear.
// Lava eats ordinary drops; a COMMON gear offering has a slim ratcheting chance
// to come back better (the volcano sacrifice), and epic loot is lava-proof.
import { T, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSolidCollisionTile } from './material_physics.js';

window.MM = window.MM || {};

const drops = (function(){
  const AUTO_KEY='mm_drops_autopickup_v1';
  const MAX_DROPS=140;
  const SNAPSHOT_CAP=200;
  const DESPAWN_SEC=180;        // resources linger
  const JEWEL_LIFE=300;         // a once-in-many-kills prize gets a generous clock
  // Ticking bomb: the better the find, the faster it burns out. Rare+ gear
  // shows a countdown bar; the final seconds of an epic tick audibly.
  const GEAR_LIFE={common:150, uncommon:110, rare:75, epic:30, legendary:20};
  const GUARDIAN_RELIC_LIFE=120; // one-shot arc trophies get a merciful clock
  const BLINK_SEC=12;           // despawn warning window (capped at 25% of life)
  const GRAVITY=22, TERMINAL=17, BOUNCE=0.34;
  const RADIUS=0.18;            // collision half-extent in tiles
  const CHEST_RADIUS_X=0.38, CHEST_RADIUS_Y=0.30;
  const CHEST_GRAVITY=30, CHEST_TERMINAL=20, CHEST_BOUNCE=0.06;
  const PICKUP_RADIUS=1.75;     // manual E reach
  const AUTO_RADIUS=2.35;       // developer auto-pickup override reach
  const MOUSE_HIT=0.55;         // cursor-over-drop hit radius (hover preview)
  const MOUSE_PICKUP_RADIUS=3.0;// click-to-take reach (mirrors cursor mining)
  const COLLECT_DIST=0.55;
  const MAGNET_SPEED=9.5;       // tiles/s toward the hero while vacuumed
  const MERGE_DIST=0.85;        // settled same-resource piles merge
  const POP_VX=3.2, POP_VY_MIN=3.4, POP_VY_MAX=6.8;
  const UPGRADE_RECHECK_SEC=1.2;// lying drops re-judge vs equipment on this clock
  const _EXCITE_RADIUS=7.5;      // hero "big eyes" reaction range (tiles)

  // Mirrors inventory.js TIER_COLORS (single source there is DOM-side; the
  // engine keeps its own copy so Node sims render/spawn without the UI).
  const TIER_COLORS={common:'#b07f2c', uncommon:'#3fa650', rare:'#a74cc9', epic:'#e0b341', legendary:'#58e0d8'};
  const TIER_RANK={common:0, uncommon:1, rare:2, epic:3, legendary:4};
  const CHEST_LABEL={common:'Skrzynia zwykla', uncommon:'Skrzynia niezwykla', rare:'Skrzynia rzadka', epic:'Skrzynia epicka', legendary:'Skrzynia legendarna'};
  // Epic+ tiers get the full "come get me" treatment (beam, lava immunity, buff)
  const isHighTier=t=>t==='epic'||t==='legendary';
  const KIND_GLYPH={cape:'🧥', eyes:'👁️', outfit:'👕', weapon:'⚔️', charm:'🔮'};
  const RES_GLYPH={meatScrap:'🍖', fish:'🐟', goldenFish:'🐠', springAntler:'🦌', summerHorn:'🐂', autumnHeartwood:'🌳', winterFur:'🐻'};
  const JEWEL_STYLE={
    jewelBlessed:{label:'Kamień błogosławionych',color:'#ffd96a',edge:'#fff4b0',tier:'rare'},
    jewelDevout:{label:'Kamień nabożnych',color:'#9b8cff',edge:'#e6ddff',tier:'epic'},
    jewelDivinity:{label:'Kamień Divinity',color:'#65f4ff',edge:'#ffffff',tier:'legendary'}
  };
  const ARROW_RES_STYLE={
    arrowWood:{color:'#caa472',head:'#dfe6f1'},
    arrowStone:{color:'#9aa0a8',head:'#e1e5ea'},
    arrowObsidian:{color:'#7a5cc1',head:'#c7b8ff'},
    arrowDiamond:{color:'#48f1ff',head:'#dffcff'},
    arrowIridium:{color:'#b8d7ff',head:'#f0f7ff'}
  };

  // --- Thematic gear loot: EVERY species sheds what it plausibly carries -----
  // chance rolls once per kill (scaled up by land hostility, see dangerFor);
  // options are equally-weighted themed variants {kind, weaponType?, name};
  // tiers is a weighted rarity table (epic stays a rush, hostile lands lean up).
  // Design rule: the drop mirrors the creature's own craft — fire-breathers
  // shed flame weapons, archers shed bows, water dwellers shed hose streams,
  // shock hunters shed electric beams, armored beasts shed outfits.
  const T_TRASH   ={common:0.90,rare:0.09,epic:0.01}; // ambience critters
  const T_COMMON  ={common:0.80,rare:0.17,epic:0.03}; // everyday wildlife
  const T_HUNTER  ={common:0.66,rare:0.28,epic:0.06}; // real predators
  const T_ELITE   ={common:0.45,rare:0.42,epic:0.13}; // armed/enchanted foes
  const T_CHAMPION={common:0.20,rare:0.50,epic:0.30}; // named terrors
  const T_JACKPOT ={common:0.00,rare:0.45,epic:0.55}; // legendary encounters
  const GEAR_LOOT={
    // Sky & treetops: fliers shed capes, night hunters shed eyes
    BIRD:      {chance:0.05, tiers:T_COMMON, options:[{kind:'cape',name:'Peleryna z piór',desc:'Lekka jak ptak. W zasadzie to nadal ptak.'},{kind:'eyes',name:'Ptasie oczy',desc:'Widok z lotu ptaka, nogi na ziemi.'}]},
    BAT:       {chance:0.09, tiers:T_COMMON, options:[{kind:'cape',name:'Peleryna nietoperza',desc:'Pachnie jaskinią. Pranie nie pomaga.'}]},
    OWL:       {chance:0.10, tiers:T_HUNTER, options:[{kind:'eyes',name:'Sowie oczy',desc:'Sowa już nie potrzebuje. Ty w nocy — bardzo.'}]},
    VULTURE:   {chance:0.10, tiers:T_HUNTER, options:[{kind:'cape',name:'Peleryna sępia',desc:'Sęp czekał na twoją śmierć. Źle obstawił.'}]},
    VULTURE_HATCHLING:{chance:0.04, tiers:T_TRASH, options:[{kind:'cape',name:'Puchowa pelerynka',desc:'Rozmiar dziecięcy, ambicje dorosłe.'}]},
    FIREFLY:   {chance:0.03, tiers:T_TRASH, options:[{kind:'eyes',name:'Świetlikowe oczy',desc:'Świecą. Głównie wspomnieniem świetlika.'}]},
    // Meadow & forest wildlife: hides, charms of their signature trait
    SQUIRREL:  {chance:0.04, tiers:T_TRASH, options:[{kind:'charm',name:'Wiewiórczy ogon',desc:'Podobno daje zwinność. Wiewiórce nie dał.'}]},
    RABBIT:    {chance:0.05, tiers:T_TRASH, options:[{kind:'charm',name:'Królicza łapka',desc:'Na szczęście. Królika akurat opuściło.'}]},
    DEER:      {chance:0.05, tiers:T_COMMON, options:[{kind:'outfit',name:'Strój z jeleniej skóry',desc:'Jeleń by się obraził, gdyby mógł.'}]},
    GOAT:      {chance:0.06, tiers:T_COMMON, options:[{kind:'charm',name:'Górski róg',desc:'Twardy jak upór kozicy na krawędzi.'}]},
    ZABA:      {chance:0.06, tiers:T_TRASH, options:[{kind:'charm',name:'Żabia łapka',desc:'Skacz jak żaba. Tylko wyżej i bez rechotu.'}]},
    JASZCZUR:  {chance:0.06, tiers:T_COMMON, options:[{kind:'outfit',name:'Skóra jaszczura',desc:'Zrzucona całkiem dobrowolnie. Prawie.'}]},
    BEAR:      {chance:0.10, tiers:T_HUNTER, options:[{kind:'outfit',name:'Strój z niedźwiedziej skóry',desc:'Ciepły. Poprzedni właściciel — już mniej.'}]},
    WOLF:      {chance:0.06, tiers:T_COMMON, options:[{kind:'outfit',name:'Strój z wilczego futra',desc:'Wataha go nie szuka. Sprawdziliśmy.'}]},
    BRAMBLE_STALKER:{chance:0.09, tiers:T_HUNTER, options:[{kind:'outfit',name:'Strój cierniowy',desc:'Przytulanie na własną odpowiedzialność.'},{kind:'weapon',weaponType:'melee',name:'Cierniowe ostrze',desc:'Kłuje. To w zasadzie cała recenzja.'}]},
    THUNDER_BISON:{chance:0.11, tiers:T_ELITE, options:[{kind:'charm',name:'Róg burzowego bizona',desc:'W środku wciąż grzmi.'},{kind:'weapon',weaponType:'electric',name:'Grzmiąca wiązka',desc:'Bizon nosił to w rogach. Ty masz spust.'}]},
    // Water: fish spray hoses, shock hunters shed beams, armored shells outfits
    FISH:      {chance:0.05, tiers:T_COMMON, options:[{kind:'eyes',name:'Rybie oczy',desc:'Nie mrugają. Wygrasz każde gapienie się.'},{kind:'weapon',weaponType:'hose',name:'Sikawka z ryby',desc:'Ryba już jej nie potrzebuje.'}]},
    PIRANHA:   {chance:0.05, tiers:T_COMMON, options:[{kind:'eyes',name:'Oczy piranii',desc:'Widzą głównie okazje.'},{kind:'weapon',weaponType:'melee',name:'Zębate ostrze piranii',desc:'Zęby w linii prostej. Reszta to rękojeść.'}]},
    CRAB:      {chance:0.07, tiers:T_COMMON, options:[{kind:'outfit',name:'Pancerz kraba',desc:'Chodzenie bokiem niewymagane, ale wskazane.'}]},
    SHARK:     {chance:0.14, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'melee',name:'Ostrze z zęba rekina',desc:'Rekin ma jeszcze trzysta takich. Miał.'}]},
    EEL:       {chance:0.06, tiers:T_HUNTER, options:[{kind:'weapon',weaponType:'electric',name:'Iskrownik węgorza',desc:'Węgorz oddał go z oporem. Elektrycznym.'}]},
    LAKE_SERPENT:{chance:0.12, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'electric',name:'Bicz jeziornego węża',desc:'Jezioro wciąż się o niego upomina.'}]},
    ATLANTIS_MEDUZA:{chance:0.09, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'electric',name:'Parzydełkowa wiązka',desc:'Parzy na odległość. Postęp.'},{kind:'charm',name:'Dryfujący talizman Atlantydy',desc:'Atlantyda zatonęła. On dryfuje dalej.'}]},
    // Cold west: frost gear; the ice shaman rains — it sheds a water stream
    ICE_WRAITH:{chance:0.09, tiers:T_ELITE, options:[{kind:'charm',name:'Talizman szronu',desc:'Zimny w dotyku. Zawsze.'},{kind:'eyes',name:'Lodowe oczy',desc:'Patrzą chłodno na wszystko.'}]},
    ICE_SHAMAN:{chance:0.16, tiers:T_ELITE, options:[{kind:'charm',name:'Fetysz lodowego szamana',desc:'Wciąż mży, kiedy nikt nie patrzy.'},{kind:'weapon',weaponType:'hose',name:'Sikawka lodowej ulewy',desc:'Szaman wzywał deszcz. Ty go nosisz.'}]},
    ZIMOWY_NIEDZWIEDZ:{chance:0.30, tiers:T_CHAMPION, options:[{kind:'outfit',name:'Pancerz zimowego futra',desc:'Zima przestaje być argumentem.'},{kind:'cape',name:'Peleryna zamieci',desc:'Powiewa nawet bez wiatru.'}]},
    JACKPOT_YETI:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'cape',name:'Peleryna yeti',desc:'Dowód, że yeti istnieje. Istniało.'},{kind:'outfit',name:'Futro yeti',desc:'Nikt nie uwierzy, skąd je masz.'}]},
    // Hot east: fire-breathers shed flame throwers, venom shed gas
    FIRE_SHAMAN:{chance:0.16, tiers:T_ELITE, options:[{kind:'charm',name:'Fetysz ognistego szamana',desc:'Ciepły w dłoni. Podejrzanie.'},{kind:'weapon',weaponType:'flame',name:'Miotacz pustynnego żaru',desc:'Pustynia w wersji przenośnej.'}]},
    SOOT_SHAMAN:{chance:0.16, tiers:T_ELITE, options:[{kind:'charm',name:'Fetysz sadzowego zaklinacza',desc:'Brudzi palce. Szepcze o dymie.'},{kind:'outfit',name:'Kubrak z prasowanego węgla',desc:'Czarny, ciepły i lekko się tli.'}]},
    SAND_WORM: {chance:0.14, tiers:T_ELITE, options:[{kind:'charm',name:'Ząb pustynnego czerwia',desc:'Reszta czerwia była zdania odrębnego.'}]},
    GIANT_SCORPION:{chance:0.12, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'melee',name:'Żądło skorpiona',desc:'Ogon dołączony osobno. Bardzo osobno.'},{kind:'weapon',weaponType:'gas',name:'Emiter jadu skorpiona',desc:'Jad prosto od producenta.'}]},
    // Swamp & night
    BOG_LURKER:{chance:0.09, tiers:T_HUNTER, options:[{kind:'charm',name:'Bagienny amulet',desc:'Bulgocze przy niebezpieczeństwie. Albo obiedzie.'},{kind:'weapon',weaponType:'gas',name:'Emiter bagiennych oparów',desc:'Zapach bagna, teraz na wynos.'}]},
    GHOUL:     {chance:0.07, tiers:T_HUNTER, options:[{kind:'charm',name:'Talizman upiora',desc:'Upiór twierdził, że to pamiątka rodzinna.'},{kind:'eyes',name:'Nocne oczy upiora',desc:'Noc przestaje być wymówką.'}]},
    SZKIELET:  {chance:0.10, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'bow',name:'Kościany łuk',desc:'W 100% z materiałów z recyklingu.'},{kind:'weapon',weaponType:'melee',name:'Kościane ostrze',desc:'Kość niezgody. Dosłownie.'}]},
    // Deep caves & ruins
    PELZACZ:   {chance:0.08, tiers:T_HUNTER, options:[{kind:'eyes',name:'Oczy pełzacza',desc:'Widziały dno jaskini. Teraz widzą lepiej.'}]},
    STONE_GOLEM:{chance:0.11, tiers:T_ELITE, options:[{kind:'outfit',name:'Pancerz golema',desc:'Kamienny spokój w standardzie.'},{kind:'charm',name:'Kamienne serce',desc:'Bije. Rzadko, ale mocno.'}]},
    TEMPLE_GUARD:{chance:0.13, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'melee',name:'Ostrze strażnika świątyni',desc:'Strzegło świątyni. Teraz strzeże ciebie.'},{kind:'weapon',weaponType:'bow',name:'Łuk świątynny',desc:'Poświęcony. Cel też zaraz będzie.'}]},
    STRAZNIK:  {chance:0.12, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'electric',name:'Emiter wartownika',desc:'Miasto upadło. Gwarancja nie.'}]},
    RADIATION_COCKROACH:{chance:0.05, tiers:T_COMMON, options:[{kind:'charm',name:'Chitynowy talizman',desc:'Przetrwa wszystko. Ciebie też.'}]},
    // Gold hoard guardians: the dragon breathes fire — it sheds a flame thrower
    GOLD_DRAGON:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'weapon',weaponType:'flame',name:'Ognisty oddech smoka',desc:'Ostatni oddech. Zapakowany.'},{kind:'cape',name:'Peleryna złotego smoka',desc:'Lśni jak skarbiec, którego strzegła.'},{kind:'charm',name:'Złota łuska',desc:'Smok ich nie liczył. Od dziś liczy.'}]},
    GOLD_DWARF_GUARD:{chance:0.25, tiers:T_CHAMPION, options:[{kind:'weapon',weaponType:'melee',name:'Młot złotego krasnoluda',desc:'Krasnolud płakał. Młot nie.'},{kind:'charm',name:'Krasnoludzki grosz',desc:'Po dobroci go nie oddał.'}]},
    ZLOTY:     {chance:0.30, tiers:T_JACKPOT, options:[{kind:'charm',name:'Złota podkowa',desc:'Nie pytaj, gdzie ją nosił.'}]},
    // Seasonal hallmarks & sea legends
    WIOSENNY_JELEN:{chance:0.22, tiers:T_CHAMPION, options:[{kind:'charm',name:'Amulet wiosny',desc:'Pachnie świeżą trawą i nowym startem.'}]},
    LETNI_ZUBR:{chance:0.22, tiers:T_CHAMPION, options:[{kind:'charm',name:'Amulet lata',desc:'Ciepły jak południe, którego strzegł.'}]},
    JESIENNY_LOS:{chance:0.22, tiers:T_CHAMPION, options:[{kind:'charm',name:'Amulet jesieni',desc:'Szeleści przy każdym kroku.'}]},
    JACKPOT_WHALE:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'charm',name:'Serce głębin',desc:'Bije rytmem przypływów.'},{kind:'eyes',name:'Oczy lewiatana',desc:'Widziały dno oceanu. I ciebie.'}]},
    // Sky biome grunts: the heavens' patrols shed sky-craft (mobs.js sky fauna)
    CLOUD_RAY: {chance:0.11, tiers:T_ELITE, options:[{kind:'cape',name:'Peleryna obłocznej płaszczki',desc:'Szybuje lepiej niż jej właścicielka skończyła.'},{kind:'eyes',name:'Oczy przestworzy',desc:'Widzą prądy powietrza. I okazje.'}]},
    HARPY:     {chance:0.11, tiers:T_ELITE, options:[{kind:'cape',name:'Peleryna harpii',desc:'Pióra wciąż pamiętają nurkowanie.'},{kind:'weapon',weaponType:'melee',name:'Szpony harpii',desc:'Manikiur odradzamy.'}]},
    VOLT_WISP: {chance:0.12, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'electric',name:'Iskra burzowego wispa',desc:'Trzeszczy z wyrzutem, ale strzela.'},{kind:'charm',name:'Zamknięty piorun',desc:'W słoiku. Mniej więcej.'}]},
    SPORE_DRIFTER:{chance:0.11, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'gas',name:'Miech zarodnikowy',desc:'Rafa w wersji kieszonkowej.'},{kind:'charm',name:'Świecący zarodnik',desc:'Kiełkuje wyłącznie w ciemności.'}]},
    CINDER_HAWK:{chance:0.11, tiers:T_ELITE, options:[{kind:'weapon',weaponType:'flame',name:'Lotka popielnego jastrzębia',desc:'Wciąż się tli. To celowe.'},{kind:'eyes',name:'Żarowe oczy',desc:'Patrzą przez dym jak przez szybę.'}]},
    // Sky biome bosses: every regional terror pays out like the legend it is
    SKY_SERAPH:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'cape',name:'Peleryna Serafina Wyżyn',desc:'Świeci nawet w plecaku.'},{kind:'weapon',weaponType:'bow',name:'Promienny łuk wyżyn',desc:'Strzały same szukają światła.'},{kind:'charm',name:'Aureola serafina',desc:'Trochę zgięta. Walka była zacięta.'}]},
    SKYGROVE_WARDEN:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'outfit',name:'Kora Strażnika Puszczy',desc:'Pancerz, który kiedyś był lasem.'},{kind:'weapon',weaponType:'melee',name:'Konar strażnika',desc:'Cała puszcza w jednym zamachu.'}]},
    BALLOON_TYRANT:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'cape',name:'Czasza tyrana gaju',desc:'Opada wolniej, niż spadałeś przed nią.'},{kind:'charm',name:'Węzeł balonowy',desc:'Nie do rozwiązania. Sprawdzano.'}]},
    STORM_HERALD:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'weapon',weaponType:'electric',name:'Młot Herolda Burzy',desc:'Kuty piorunami, oddaje z nawiązką.'},{kind:'charm',name:'Kowadło chmur',desc:'Cięższe, niż wygląda. A wygląda jak chmura.'}]},
    AURORA_WYRM:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'weapon',weaponType:'hose',name:'Oddech zorzowego żmija',desc:'Zamieć na życzenie.'},{kind:'eyes',name:'Oczy zorzy',desc:'Noc polarna przestaje być ciemna.'},{kind:'cape',name:'Łuska zorzy',desc:'Mieni się wszystkimi kolorami mrozu.'}]},
    MIRAGE_DJINN:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'charm',name:'Lampa dżina',desc:'Życzeń brak. Dżin też już nie życzy.'},{kind:'weapon',weaponType:'gas',name:'Tchnienie fatamorgany',desc:'Wróg widzi wszystko. Poza prawdą.'}]},
    CORSAIR_AUTOMATON:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'outfit',name:'Kadłub korsarza wraków',desc:'Nitowany na wieczność. Prawie.'},{kind:'weapon',weaponType:'bow',name:'Harpunnik flotylli',desc:'Trafia i przyciąga. Kolejność dowolna.'},{kind:'antenna',profile:'echo',name:'Czułek wrakowego korsarza',desc:'Nasłuchiwał wraków. Teraz nasłuchuje dla ciebie.'}]},
    SPORE_MOTHER:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'weapon',weaponType:'gas',name:'Płuca Matki Zarodników',desc:'Oddychają za ciebie. W obie strony.'},{kind:'outfit',name:'Kapelusz rafy',desc:'Grzybobranie od środka.'}]},
    GRAVITY_COLOSSUS:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'charm',name:'Rdzeń grawitacji',desc:'Kieszeń ciągnie w dół. Cała reszta też.'},{kind:'outfit',name:'Płyty kolosa',desc:'Nic cię nie ruszy. Dosłownie.'}]},
    HARPY_QUEEN:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'cape',name:'Skrzydła Królowej Harpii',desc:'Korona spadła razem z resztą.'},{kind:'weapon',weaponType:'melee',name:'Królewskie szpony',desc:'Dworski ceremoniał: cięcie, ukłon.'}]},
    EMBER_PHOENIX:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'weapon',weaponType:'flame',name:'Ostatni płomień feniksa',desc:'Tym razem naprawdę ostatni.'},{kind:'cape',name:'Pióropusz żaru',desc:'Ciepły. Wiecznie.'},{kind:'charm',name:'Popiół odrodzenia',desc:'Feniksowi starczył raz. Tobie może też.'}]}
    // (ATOMIC_BOMB deliberately absent: a walking bomb leaves a crater, not loot)
  };

  // --- Guardian arc loot: bosses and their sidekicks drop signature relics ---
  // Boss kills spawn EVERY listed item as a unique-boosted epic (the arc's
  // trophies); sidekicks roll one rare/epic themed piece. The center mimic is
  // excluded on purpose — its story reward is the Serce Ciszy charm.
  const GUARDIAN_LOOT={
    fire:{
      boss:[{kind:'weapon',weaponType:'flame',name:'Oddech Ignivara',desc:'Słoneczny żmij już go nie potrzebuje.'},{kind:'cape',name:'Peleryna słonecznego żmija',desc:'Łuska po łusce, bliżej słońca.'}],
      sidekicks:{flare:{kind:'charm',name:'Węgielny fetysz wyroczni',desc:'Wyrocznia tego nie przewidziała.'}, bulwark:{kind:'outfit',name:'Pancerz magmowego ogara',desc:'Grzeje. Wewnątrz i na zewnątrz.'}}
    },
    ice:{
      boss:[{kind:'weapon',weaponType:'hose',name:'Lodowa sikawka Aurexa',desc:'Zima w strumieniu. Aurex by się skrzywił.'},{kind:'eyes',name:'Oczy wiecznej zamieci',desc:'Przez śnieżycę widzisz jak w dzień.'}],
      sidekicks:{mirror:{kind:'eyes',name:'Zwierciadło zorzy',desc:'Odbija spojrzenia i zaklęcia.'}, sentinel:{kind:'outfit',name:'Pancerz lodowca',desc:'Powolny jak lodowiec, twardy tak samo.'}}
    },
    earth:{
      boss:[{kind:'outfit',name:'Pancerz Nyxolitha',desc:'Rdzeń wytrzymał wszystko poza tobą.'},{kind:'charm',name:'Rdzeń korzennego jądra',desc:'Wciąż kopie. Stare nawyki.'}],
      sidekicks:{drone:{kind:'charm',name:'Rdzeń drona',desc:'Brzęczy pracowicie nawet w kieszeni.'}, zombieGolem:{kind:'outfit',name:'Zgniły pancerz golema',desc:'Śmierdzi, ale trzyma.'}}
    },
    air:{
      boss:[{kind:'cape',name:'Peleryna Astraela',desc:'Korona spadła. Peleryna sfrunęła.'},{kind:'weapon',weaponType:'bow',name:'Łuk podniebnej korony',desc:'Strzela tam, gdzie kończy się niebo.'}],
      sidekicks:{resonator:{kind:'charm',name:'Rezonator korony',desc:'Wciąż stroi się do nieba.'}}
    }
  };
  const SIDEKICK_DROP_CHANCE=0.38;
  const SIDEKICK_EPIC_CHANCE=0.42;
  const SIDEKICK_LEGENDARY_CHANCE=0.07; // carved from below the epic band
  // Bad-luck insurance: after this many eligible kills without a gear drop the
  // next one is guaranteed and never lands below rare — the wait itself paid.
  const PITY_KILLS=25;
  // Volcano sacrifice: a COMMON gear drop consumed by lava rolls this chance to
  // be flung back out upgraded; every refused offering ratchets the odds.
  const SACRIFICE_BASE=0.01, SACRIFICE_STEP=0.0025, SACRIFICE_MAX=0.05;
  const SACRIFICE_EPIC_CHANCE=0.15;
  const SACRIFICE_LEGENDARY_CHANCE=0.04; // the volcano, too, can hand back a legend

  const list=[];
  // Weapon collision probes run many times per frame (arrows and stream
  // particles in particular). Keep the sparse, persistent chest subset
  // indexed separately instead of rescanning every resource and gear drop.
  const chestDrops=new Set();
  const arrowCollectFx=[];
  let seq=1;
  let dry=0; // eligible kills since the last gear drop (persisted in snapshot)
  let sacrificeDry=0; // refused volcano offerings since the last gift (persisted)
  let rand=Math.random; // _debug.setRandom swaps in a scripted queue for tests
  let debugAutoPref=false; // developer-only override; ordinary play uses worn gear
  try{
    const raw=(typeof localStorage!=='undefined') ? localStorage.getItem(AUTO_KEY) : null;
    if(raw==='1') debugAutoPref=true;
  }catch(e){ /* headless */ }

  const WORLD_TOP=Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM=Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : 400;
  const finiteNum=v=>typeof v==='number' && isFinite(v);

  function debugAutoPickup(){ return debugAutoPref; }
  function setDebugAutoPickup(on){
    debugAutoPref=!!on;
    try{ if(typeof localStorage!=='undefined') localStorage.setItem(AUTO_KEY, debugAutoPref?'1':'0'); }catch(e){}
    return debugAutoPref;
  }
  // Compatibility aliases for older debug scripts. These never include the
  // equipment effect; their sole meaning is the developer override.
  function autoPickup(){ return debugAutoPickup(); }
  function setAutoPickup(on){ return setDebugAutoPickup(on); }
  function lootMagnetLevel(){
    const raw=MM.activeModifiers && MM.activeModifiers.lootMagnetLevel;
    return typeof raw==='number' && isFinite(raw) ? Math.max(0,Math.min(4,Math.trunc(raw))) : 0;
  }
  function inAutoPickupReach(d,player,level){
    if(!d || !player) return false;
    if(debugAutoPref) return dist2ToPlayer(d,player)<=AUTO_RADIUS*AUTO_RADIUS;
    if(level<=0) return false;
    const ring=level-1;
    return Math.abs(Math.floor(d.x)-Math.floor(player.x))<=ring
      && Math.abs(Math.floor(d.y)-Math.floor(player.y))<=ring;
  }

  function getSafe(getTile,x,y){ try{ return getTile ? getTile(Math.floor(x),Math.floor(y)) : T.AIR; }catch(e){ return T.AIR; } }
  function solidAt(getTile,x,y){
    if(y>=WORLD_BOTTOM) return true;
    if(y<WORLD_TOP) return false;
    return isSolidCollisionTile(getSafe(getTile,x,y));
  }

  function tierRank(t){ return TIER_RANK[t]||0; }
  function evictForRoom(incomingKind){
    if(list.length<MAX_DROPS) return true;
    if(incomingKind!=='chest' && chestDrops.size===list.length) return false;
    // Oldest, least precious first: resources before gear, low tiers before high
    let worst=-1, worstScore=Infinity;
    for(let i=0;i<list.length;i++){
      const d=list[i];
      // Persistent reward chests must never disappear merely because a mob
      // tried to shed another scrap/gear pickup at the entity cap.
      if(d.kind==='chest' && incomingKind!=='chest') continue;
      const score=(d.kind==='chest'?3000:d.kind==='jewel'?2200:d.kind==='gear'?1000:0)+tierRank(d.tier)*100-d.age*0.01;
      if(score<worstScore){ worstScore=score; worst=i; }
    }
    if(worst<0) return false;
    chestDrops.delete(list[worst]);
    list.splice(worst,1);
    return true;
  }

  function makeDrop(x,y,fields,opts){
    if(!finiteNum(x) || !finiteNum(y)) return null;
    if(!evictForRoom(fields && fields.kind)) return null;
    opts=opts||{};
    const d=Object.assign({
      id:seq++,
      x, y:Math.max(WORLD_TOP+1,Math.min(WORLD_BOTTOM-2,y)),
      vx:finiteNum(opts.vx) ? opts.vx : (rand()*2-1)*POP_VX,
      vy:finiteNum(opts.vy) ? opts.vy : -(POP_VY_MIN+rand()*(POP_VY_MAX-POP_VY_MIN)),
      age:0, settled:false, airT:0, spin:(rand()*2-1)*7
    },fields);
    list.push(d);
    if(d.kind==='chest') chestDrops.add(d);
    return d;
  }

  function spawnResource(x,y,res,qty,opts){
    if(typeof res!=='string' || !res) return null;
    qty=Math.max(1,Math.floor(Number(qty)||1));
    opts=opts||{};
    const tier=TIER_RANK[opts.tier]!==undefined ? opts.tier : 'common';
    // color/glyph resolved ONCE here — draw() must never scan the resource
    // registry per frame (140 drops × registry find() was a real frame tax)
    const d=makeDrop(x,y,{kind:'resource',res,qty,tier,life:DESPAWN_SEC,color:resourceColor(res),glyph:RES_GLYPH[res]||null,source:opts.source||'resource'},opts);
    if(d && opts.announce===true && tier!=='common') announceDrop(d);
    return d;
  }
  function announceJewel(d){
    if(!d) return;
    const style=JEWEL_STYLE[d.res]||JEWEL_STYLE.jewelBlessed;
    const px=d.x*(MM.TILE||20), py=d.y*(MM.TILE||20);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(px,py,d.tier); }catch(e){}
    try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(px,py-8,d.tier,12); }catch(e){}
    // A dedicated clear bell is deliberately unlike combat noise: the player
    // should learn this sound after hearing it once, even off-screen.
    try{ if(MM.audio && MM.audio.play) MM.audio.play('jewel',{x:d.x,y:d.y,priority:true}); }catch(e){}
    try{ if(typeof window.msg==='function') window.msg('💎 JEWEL! '+style.label+' wypadł z przeciwnika!'); }catch(e){}
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('jewel_drop','Z potężnego przeciwnika wypadł jewel do trwałego ulepszania przedmiotów!'); }catch(e){}
  }
  function spawnJewel(x,y,key,opts){
    const style=JEWEL_STYLE[key]; if(!style) return null;
    opts=opts||{};
    const d=makeDrop(x,y,{kind:'jewel',res:key,jewel:key,qty:1,tier:style.tier,life:JEWEL_LIFE,color:style.color,glyph:'◆',source:opts.source||'mob'},opts);
    if(d && opts.announce!==false) announceJewel(d);
    return d;
  }
  // The moment of the drop IS the dopamine beat: rare+ gear announces itself
  // with a burst and its tier fanfare the instant it leaves the corpse.
  function announceDrop(d){
    if(!d || d.tier==='common') return;
    const px=d.x*(MM.TILE||20), py=d.y*(MM.TILE||20);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(px,py,d.tier); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play(isHighTier(d.tier)?'golden':'chest',{x:d.x,y:d.y}); }catch(e){}
    if(isHighTier(d.tier)){
      try{ if(typeof window.msg==='function') window.msg(d.tier==='legendary' ? '🌟 Legendarny łup spadł na ziemię!' : '✨ Coś wyjątkowego upadło na ziemię!'); }catch(e){}
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('epic_drop','Epicki łup ogłasza się słupem światła — nie da się go przegapić!'); }catch(e){}
    }
  }
  // "Better than worn": the drop outclasses the item the hero actually WEARS
  // in its group — or fills a group where nothing comparable is worn AND beats
  // everything owned. That's the find worth gawking at before touching it.
  function isWornUpgrade(d){
    if(d.kind!=='gear' || !d.item) return false;
    const inv=MM.inventory;
    if(!inv || typeof inv.compareItem!=='function') return false;
    let cmp=null;
    try{ cmp=inv.compareItem(d.item); }catch(e){ return false; }
    if(!cmp) return false;
    if(cmp.isEquippedUpgrade) return true;
    return !cmp.equippedComparable && cmp.isNewBest && cmp.score>0;
  }
  function spawnGear(x,y,item,opts){
    if(!item || typeof item!=='object' || typeof item.id!=='string') return null;
    const tier=TIER_RANK[item.tier]!==undefined ? item.tier : 'common';
    const d=makeDrop(x,y,{kind:'gear', item:Object.assign({},item), qty:1, tier, life:GEAR_LIFE[tier]||GEAR_LIFE.common},opts);
    if(d){
      d.upgrade=isWornUpgrade(d);
      d._cmpT=rand()*UPGRADE_RECHECK_SEC; // staggered re-judge clock
      if(!opts || opts.announce!==false) announceDrop(d);
    }
    return d;
  }

  function spawnChest(x,y,tier,opts){
    opts=opts||{};
    tier=TIER_RANK[tier]!==undefined ? tier : 'common';
    const seed=finiteNum(Number(opts.lootSeed)) ? (Number(opts.lootSeed)>>>0)
      : ((Math.imul(Math.round(x*1000)|0,73856093)^Math.imul(Math.round(y*1000)|0,19349663)^((rand()*0xffffffff)>>>0))>>>0);
    const d=makeDrop(x,y,{kind:'chest', qty:1, tier, lootSeed:seed, source:opts.source||'reward', persistent:true},opts);
    if(d){
      d.spin=0;
      d.vx=finiteNum(opts.vx) ? opts.vx : (rand()*2-1)*1.35;
      d.vy=finiteNum(opts.vy) ? opts.vy : -(1.5+rand()*2.2);
    }
    return d;
  }

  // The species tables stay 3-tier (their weight sums are test-pinned); the
  // roll itself spans the FULL 5-tier ladder: a slice of every common roll
  // upgrades to uncommon and a slice of every epic roll ascends to legendary —
  // so something amazing is possible from ANY kill, just less likely at home.
  const UNCOMMON_SHARE=0.30;          // fraction of the common weight that upgrades
  const LEGENDARY_BASE_SHARE=0.15;    // fraction of the epic weight that ascends…
  const LEGENDARY_DANGER_BONUS=0.25;  // …growing further in hostile lands
  function rollTier(tiers,danger){
    let c=Math.max(0,Number(tiers && tiers.common)||0);
    let r=Math.max(0,Number(tiers && tiers.rare)||0);
    let e=Math.max(0,Number(tiers && tiers.epic)||0);
    // Hostile lands promise better finds: rare/epic weights swell with danger
    // while common stays flat, so the far east/west visibly pays out.
    const d=Math.max(0,Math.min(1,Number(danger)||0));
    if(d>0){ r*=1+2.2*d; e*=1+5*d; }
    const u=c*UNCOMMON_SHARE; c-=u;
    const l=e*(LEGENDARY_BASE_SHARE+LEGENDARY_DANGER_BONUS*d); e-=l;
    const total=c+u+r+e+l;
    if(!(total>0)) return 'common';
    let roll=rand()*total;
    if((roll-=c)<0) return 'common';
    if((roll-=u)<0) return 'uncommon';
    if((roll-=r)<0) return 'rare';
    if((roll-=e)<0) return 'epic';
    return 'legendary';
  }
  // Land danger 0..1 for a kill position: the mob's own rolled hostility wins
  // (it already encodes the shared world gradient), the gradient is the fallback.
  function dangerFor(m){
    let h=Number(m && m.hostility);
    if(!isFinite(h)){
      h=0;
      try{
        const wh=MM.worldHostility;
        if(wh && typeof wh.at==='function') h=Number(wh.at(Number(m && m.x)||0).hostility)||0;
      }catch(e){}
    }
    const tier=Number(m && m.hostilityTier);
    if(isFinite(tier)) h=Math.max(h, tier/4);
    return Math.max(0,Math.min(1,h));
  }
  // Jewel odds key off the defeated creature itself, not only the map. A rabbit
  // sits around 0.04%; a serious elite reaches percent territory; named/boss
  // mobs receive an additional premium without ever making jewels routine.
  function jewelPowerFor(m,spec){
    spec=spec||{};
    const hp=Math.max(1,Number(m&&m.maxHp)||Number(spec.hp)||1);
    const dmg=Math.max(0,Number(spec.dmg)||Number(m&&m.dmg)||0);
    const xp=Math.max(0,Number(spec.xp)||0);
    const scale=Math.max(0.4,Number(m&&m.scale)||1);
    const raw=Math.sqrt(hp*Math.max(1,dmg))+xp*0.22+Math.max(0,scale-1)*18;
    return Math.max(0,Math.min(1,raw/115));
  }
  function jewelBossLike(m,spec){
    if(spec && spec.boss) return true;
    const table=m&&GEAR_LOOT[m.id];
    return !!((m&&/^JACKPOT_|SKY_SERAPH|AURORA_WYRM|STORM_HERALD|EMBER_PHOENIX|GOLD_DRAGON/.test(m.id||'')) || (table&&table.chance>=0.45));
  }
  // Challenge 'scarce': gear/jewel roll chances scale down through one derived
  // knob (1 when no challenge — the guard mirrors the coopBodies idiom)
  function scarcityMult(){
    const c=MM.challenge;
    if(!c || !c.lootTuning) return 1;
    const t=c.lootTuning();
    return t ? t.dropChanceMult : 1;
  }
  function jewelChanceFor(m,spec){
    const p=jewelPowerFor(m,spec), danger=dangerFor(m);
    const boss=jewelBossLike(m,spec);
    return Math.min(0.18,0.00035+0.042*Math.pow(p,2.15)+0.004*danger*p+(boss?0.075:0))*scarcityMult();
  }
  function rollJewelDrop(m,spec){
    if(!m || !finiteNum(Number(m.x)) || !finiteNum(Number(m.y))) return null;
    if(m.id==='ATOMIC_BOMB' || !(rand()<jewelChanceFor(m,spec))) return null;
    const p=jewelPowerFor(m,spec), boss=jewelBossLike(m,spec);
    const divinityShare=Math.min(0.42,0.01+p*0.19+(boss?0.18:0));
    const devoutShare=Math.min(0.46,0.10+p*0.25+(boss?0.08:0));
    const r=rand();
    const key=r<divinityShare?'jewelDivinity':r<divinityShare+devoutShare?'jewelDevout':'jewelBlessed';
    return spawnJewel(Number(m.x),Number(m.y)-0.35,key,{source:'mob'});
  }
  function makeGearId(kind,tag){
    return kind+'_drop_'+String(tag||'x').toLowerCase()+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  }
  function genThemedItem(def,tier,extra){
    const chests=MM.chests;
    if(!def || !chests || typeof chests.genItem!=='function') return null;
    let item=null;
    try{ item=chests.genItem(()=>rand(), tier, Object.assign({kind:def.kind, weaponType:def.weaponType, profile:def.profile},extra)); }catch(e){ return null; }
    if(!item) return null;
    if(typeof def.name==='string') item.name=def.name;
    if(typeof def.desc==='string') item.desc=def.desc; // the flavor one-liner IS half the drop
    return item;
  }
  // One gear roll per kill: species-bound themed variant + danger-scaled tier;
  // chests.genItem builds the function-pure item (same purity contract as chest
  // loot), we only re-skin it with the species' flavor name.
  function rollGearDrop(m){
    if(!m || typeof m.id!=='string') return null;
    const table=GEAR_LOOT[m.id];
    if(!table) return null;
    const danger=dangerFor(m);
    const chance=Math.min(0.9, table.chance*(1+0.8*danger))*scarcityMult();
    const pity=dry>=PITY_KILLS;
    if(!pity && !(rand()<=chance)){ dry++; return null; }
    const options=Array.isArray(table.options)&&table.options.length ? table.options : [{kind:'charm'}];
    const def=options[Math.min(options.length-1,Math.floor(rand()*options.length))];
    let tier=rollTier(table.tiers, pity ? Math.min(1,danger+0.35) : danger);
    if(pity && tierRank(tier)<TIER_RANK.rare) tier='rare';
    const item=genThemedItem(def,tier);
    if(!item) return null;
    item.id=makeGearId(def.kind,m.id);
    const d=spawnGear(m.x,(Number(m.y)||0)-0.2,item);
    if(d){ d.source='mob'; dry=0; }
    return d;
  }
  // Guardian arc rewards: a slain guardian sheds ALL its signature relics as
  // unique-boosted epics; a broken sidekick rolls one rare/epic themed piece.
  function rollGuardianDrop(kind,x,y,opts){
    opts=opts||{};
    const table=GUARDIAN_LOOT[kind];
    if(!table || !finiteNum(x) || !finiteNum(y)) return null;
    if(opts.boss){
      const spawned=[];
      for(const def of table.boss){
        const item=genThemedItem(def,'epic',{forceUnique:true});
        if(!item) continue;
        item.id=makeGearId(def.kind,'guardian_'+kind);
        const d=spawnGear(x-0.5+spawned.length*1.1, y-0.3, item);
        if(d){ d.source='guardian'; d.life=GUARDIAN_RELIC_LIFE; spawned.push(d); }
      }
      return spawned.length ? spawned : null;
    }
    const def=table.sidekicks && table.sidekicks[opts.role];
    if(!def) return null;
    if(!(rand()<=SIDEKICK_DROP_CHANCE)) return null;
    const tr=rand();
    const tier= tr<SIDEKICK_LEGENDARY_CHANCE ? 'legendary'
      : tr<SIDEKICK_LEGENDARY_CHANCE+SIDEKICK_EPIC_CHANCE ? 'epic' : 'rare';
    const item=genThemedItem(def,tier);
    if(!item) return null;
    item.id=makeGearId(def.kind,'guardian_'+kind+'_'+String(opts.role||''));
    const d=spawnGear(x,y-0.3,item);
    if(d) d.source='guardian';
    return d;
  }

  // --- pickup ---------------------------------------------------------------
  function resourceLabel(res){
    try{
      const defs=MM.inventory && MM.inventory.RESOURCES;
      if(Array.isArray(defs)){ const hit=defs.find(r=>r && r.key===res); if(hit && hit.label) return hit.label; }
    }catch(e){}
    return res;
  }
  function arrowStyleFor(res){ return ARROW_RES_STYLE[res] || null; }
  function showArrowCollect(x,y,res,player){
    const style=arrowStyleFor(res);
    if(!style || !finiteNum(x) || !finiteNum(y)) return false;
    const p=player || (typeof window!=='undefined' ? window.player : null);
    const tx=p && finiteNum(p.x) ? p.x : x;
    const ty=p && finiteNum(p.y) ? p.y-0.3 : y-0.3;
    if(arrowCollectFx.length>=24) arrowCollectFx.shift();
    arrowCollectFx.push({
      sx:x, sy:y, x, y, px:x, py:y, tx, ty,
      t:0, life:0.44, ang:Math.atan2(ty-y,tx-x), color:style.color, headColor:style.head
    });
    return true;
  }
  function collectResource(d,silent){
    const inv=window.inv;
    if(!inv || typeof inv!=='object') return false;
    inv[d.res]=(Number(inv[d.res])||0)+d.qty;
    try{ if(typeof MM.noteCraftResultSeen==='function') MM.noteCraftResultSeen(d.res,{source:d.source||'drop'}); }catch(e){}
    try{ if(typeof window.updateInventoryHud==='function') window.updateInventoryHud(); }catch(e){}
    if(!silent){
      try{ if(typeof window.msg==='function') window.msg('Podniesiono: '+resourceLabel(d.res)+' ×'+d.qty); }catch(e){}
    }
    return true;
  }
  // Picked-up gear rides the chest pipeline: dynamicLoot pool -> inventory bag
  // sync -> loot-inbox popup with the full compare/equip celebration.
  function collectGear(d){
    const item=d.item;
    if(!item || typeof item.id!=='string') return false;
    if(!MM.dynamicLoot) MM.dynamicLoot={capes:[],eyes:[],outfits:[],weapons:[],charms:[]};
    const keyMap={cape:'capes', eyes:'eyes', outfit:'outfits', weapon:'weapons', charm:'charms'};
    const k=keyMap[item.kind]||'charms';
    if(!Array.isArray(MM.dynamicLoot[k])) MM.dynamicLoot[k]=[];
    if(!MM.dynamicLoot[k].some(e=>e && e.id===item.id)) MM.dynamicLoot[k].push(Object.assign({},item));
    try{ if(MM.chests && MM.chests.saveDynamicLoot) MM.chests.saveDynamicLoot(); }catch(e){}
    try{
      if(typeof MM.onLootGained==='function') MM.onLootGained([item], item.tier||'common');
      else if(typeof window.updateDynamicCustomization==='function') window.updateDynamicCustomization();
    }catch(e){}
    // The aha beat: the first creature-shed gear teaches the rule that loot
    // mirrors the creature — and sends the player theorizing about the rest.
    // (chest/volcano-sourced drops don't teach that rule, so they don't note it)
    if(d.source==='mob' || d.source==='guardian'){
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('mob_gear','Pokonane stwory gubią swoje rzemiosło — każdy nosi coś swojego!'); }catch(e){}
    }
    return true;
  }
  function collect(d,opts){
    if(d.kind==='chest'){
      try{
        return !!(MM.chests && typeof MM.chests.openDroppedChest==='function' && MM.chests.openDroppedChest(d,opts||{}));
      }catch(e){ return false; }
    }
    const silent=!!(opts && opts.silent);
    const ok=d.kind==='gear' ? collectGear(d) : collectResource(d,silent);
    if(!ok) return false;
    if(d.kind==='resource' && arrowStyleFor(d.res)) showArrowCollect(d.x,d.y,d.res,opts && opts.player);
    const idx=list.indexOf(d);
    if(idx>=0) list.splice(idx,1);
    // snatching an epic+ find is a rush — a short euphoria buff makes the body agree
    if(d.kind==='gear' && isHighTier(d.tier)){
      try{ if(MM.progress && MM.progress.addBuff) MM.progress.addBuff({stackKey:'loot_euphoria',name:'Euforia', icon:'✨', dur:12, stats:{moveSpeedMult:1.15, jumpPowerMult:1.1}}); }catch(e){}
    }
    const px=d.x*(MM.TILE||20), py=d.y*(MM.TILE||20);
    try{
      if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(px,py,d.tier==='common'?'hit':d.tier);
    }catch(e){}
    if(!silent){
      try{
        if(MM.audio && MM.audio.play){
          const snd=d.kind==='jewel' ? 'jewel' : isHighTier(d.tier) ? 'golden' : tierRank(d.tier)>0 ? 'chest' : 'harvest';
          MM.audio.play(snd,{x:d.x,y:d.y});
        }
      }catch(e){}
    }
    return true;
  }

  function dist2ToPlayer(d,player){
    const dx=d.x-player.x, dy=d.y-(player.y-0.3);
    return dx*dx+dy*dy;
  }
  function nearestInReach(player,radius){
    if(!player || !finiteNum(player.x) || !finiteNum(player.y)) return null;
    const r2=radius*radius;
    let best=null, bestD=Infinity;
    for(const d of list){
      const dd=dist2ToPlayer(d,player);
      if(dd<=r2 && dd<bestD){ bestD=dd; best=d; }
    }
    return best;
  }
  // One E press scoops EVERYTHING in reach — chasing three meat scraps with
  // three key presses is a chore, one clean sweep is a reward. Resources merge
  // into a single message; one fanfare plays for the best tier grabbed.
  function pickupNearest(player){
    if(!player || !finiteNum(player.x) || !finiteNum(player.y)) return false;
    const r2=PICKUP_RADIUS*PICKUP_RADIUS;
    const grabbed=[];
    for(const d of list){ if(dist2ToPlayer(d,player)<=r2) grabbed.push(d); }
    if(!grabbed.length) return false;
    const gains=[]; let best='common', any=false, openedChest=false, grabbedJewel=false;
    for(const d of grabbed){
      const wasResource=d.kind==='resource'||d.kind==='jewel';
      if(!collect(d,{silent:true,player})) continue;
      any=true;
      if(d.kind==='chest') openedChest=true; // chest handler owns its fanfare
      if(d.kind==='jewel') grabbedJewel=true;
      if(tierRank(d.tier)>tierRank(best)) best=d.tier;
      if(wasResource) gains.push(resourceLabel(d.res)+' ×'+d.qty);
    }
    if(!any) return false;
    if(gains.length){
      try{ if(typeof window.msg==='function') window.msg('Podniesiono: '+gains.join(', ')); }catch(e){}
    }
    try{
      if(MM.audio && MM.audio.play){
        if(!openedChest) MM.audio.play(grabbedJewel?'jewel':isHighTier(best)?'golden':tierRank(best)>0?'chest':'harvest',{x:player.x,y:player.y});
      }
    }catch(e){}
    return true;
  }
  // E-precedence probe (inventory_ui): manual E remains useful beyond a worn
  // magnet's ring, while holding E still opens the wardrobe as usual.
  function wantsInteractKey(player){
    return !!nearestInReach(player,PICKUP_RADIUS);
  }

  // --- cursor pickup (PC): hover previews a drop, a click takes exactly it ---
  // opts.visible gates fog: an undiscovered drop neither previews nor grabs.
  let hoverDrop=null; // draw() highlights this one (set fresh each frame by hoverAt)
  function dropAtPoint(wx,wy,opts){
    if(!finiteNum(wx) || !finiteNum(wy)) return null;
    // A finger obscures more of the world than a cursor. Callers may enlarge the
    // visual hit target while pickup reach and exact single-drop selection stay
    // unchanged. Clamp it so a tap never vacuums an unrelated nearby pile.
    const hitScale=Math.max(1,Math.min(1.8,finiteNum(opts&&opts.hitScale)?opts.hitScale:1));
    let best=null, bestD=Infinity;
    for(const d of list){
      const dx=d.x-wx, dy=d.y-wy;
      const dd=dx*dx+dy*dy;
      const hit=(d.kind==='chest' ? 0.66 : MOUSE_HIT)*hitScale;
      const r2=hit*hit;
      if(dd<=r2 && dd<bestD){ bestD=dd; best=d; }
    }
    if(best && opts && typeof opts.visible==='function' && !opts.visible(Math.floor(best.x),Math.floor(best.y))) return null;
    return best;
  }
  // Preview payload for the corner panel: enough to render name/tier/stats
  // without handing the caller the live entity.
  function hoverAt(wx,wy,player,opts){
    const d=dropAtPoint(wx,wy,opts);
    hoverDrop=d;
    if(!d) return null;
    const inReach=!!(player && finiteNum(player.x) && dist2ToPlayer(d,player)<=MOUSE_PICKUP_RADIUS*MOUSE_PICKUP_RADIUS);
    const info={id:d.id, kind:d.kind, tier:d.tier, x:d.x, y:d.y, qty:d.qty, inReach};
    if(d.kind==='gear') info.item=Object.assign({},d.item);
    else if(d.kind==='chest') { info.label=CHEST_LABEL[d.tier]||CHEST_LABEL.common; info.glyph='📦'; }
    else { info.res=d.res; info.label=resourceLabel(d.res); info.glyph=d.glyph; info.color=d.color; }
    return info;
  }
  // Selective grab: 'picked' consumed the click, 'far' means walk closer
  // (the caller lets the click fall through to mining/attacking), null = no drop.
  function pickupAt(wx,wy,player,opts){
    const d=dropAtPoint(wx,wy,opts);
    if(!d) return null;
    if(!player || !finiteNum(player.x) || dist2ToPlayer(d,player)>MOUSE_PICKUP_RADIUS*MOUSE_PICKUP_RADIUS) return 'far';
    return collect(d,{player}) ? 'picked' : null;
  }

  function chestAtPoint(wx,wy,radius){
    if(!finiteNum(wx) || !finiteNum(wy)) return null;
    radius=Math.max(0.25,finiteNum(radius)?radius:0.52);
    let best=null, bestD=Infinity;
    const hitRadius=radius+Math.max(CHEST_RADIUS_X,CHEST_RADIUS_Y);
    const hitRadius2=hitRadius*hitRadius;
    for(const d of chestDrops){
      const dx=d.x-wx, dy=d.y-wy, dd=dx*dx+dy*dy;
      if(dd<=hitRadius2 && dd<bestD){ best=d; bestD=dd; }
    }
    return best;
  }

  function remove(drop){
    const i=typeof drop==='number' ? list.findIndex(d=>d.id===drop) : list.indexOf(drop);
    if(i<0) return false;
    const removed=list[i];
    chestDrops.delete(removed);
    list.splice(i,1);
    if(hoverDrop===removed) hoverDrop=null;
    return true;
  }

  // --- simulation -----------------------------------------------------------
  function updateArrowCollectFx(dt,player){
    const p=player || (typeof window!=='undefined' ? window.player : null);
    for(let i=arrowCollectFx.length-1;i>=0;i--){
      const fx=arrowCollectFx[i];
      fx.t+=dt;
      if(p && finiteNum(p.x) && finiteNum(p.y)){ fx.tx=p.x; fx.ty=p.y-0.3; }
      const u=Math.max(0,Math.min(1,fx.t/fx.life));
      const ease=1-Math.pow(1-u,3);
      fx.px=fx.x; fx.py=fx.y;
      fx.x=fx.sx+(fx.tx-fx.sx)*ease;
      fx.y=fx.sy+(fx.ty-fx.sy)*ease-Math.sin(Math.PI*u)*0.18;
      const dx=fx.x-fx.px, dy=fx.y-fx.py;
      if(Math.abs(dx)+Math.abs(dy)>0.0001) fx.ang=Math.atan2(dy,dx);
      if(u>=1) arrowCollectFx.splice(i,1);
    }
  }
  function stepPhysics(d,dt,getTile){
    const here=getSafe(getTile,d.x,d.y);
    d._tile=here;
    const inWater=here===T.WATER;
    const chest=d.kind==='chest';
    const rx=chest?CHEST_RADIUS_X:RADIUS, ry=chest?CHEST_RADIUS_Y:RADIUS;
    const gravity=chest?CHEST_GRAVITY:GRAVITY;
    const terminal=chest?CHEST_TERMINAL:TERMINAL;
    const bounce=chest?CHEST_BOUNCE:BOUNCE;
    d.airT+=dt;
    d.vy=Math.min(inWater?(chest?4.5:2.2):terminal, d.vy+(inWater?gravity*0.32:gravity)*dt);
    if(inWater){ d.vx*=Math.max(0,1-(chest?4.5:3.2)*dt); }
    // horizontal step (wall bounce)
    const nx=d.x+d.vx*dt;
    if(d.vx!==0 && solidAt(getTile,nx+Math.sign(d.vx)*rx,d.y)){ d.vx=-d.vx*(chest?0.12:0.45); }
    else d.x=nx;
    // vertical step (floor bounce / ceiling stop)
    const ny=d.y+d.vy*dt;
    if(d.vy>0 && solidAt(getTile,d.x,ny+ry)){
      d.y=Math.floor(ny+ry)-ry-0.001;
      if(Math.abs(d.vy)<(chest?2.4:1.5)){
        d.vy=0; d.vx=0; d.settled=true; d.spin=0;
        // touchdown twinkle: a rare+ find sparkles where it comes to rest
        if(!d._landed && d.tier!=='common'){
          d._landed=true;
          try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(d.x*(MM.TILE||20),(d.y-0.2)*(MM.TILE||20),d.tier,3); }catch(e){}
        }
      }
      else {
        // gear lands with an audible thud (throttled in the mixer) — loot has weight
        if(d.kind==='gear' && d.vy>4){ try{ if(MM.audio && MM.audio.play) MM.audio.play('thud',{x:d.x,y:d.y}); }catch(e){} }
        if(chest && d.vy>3){ try{ if(MM.audio && MM.audio.play) MM.audio.play('thud',{x:d.x,y:d.y}); }catch(e){} }
        d.vy=-d.vy*bounce; d.vx*=chest?0.22:0.6;
      }
    } else if(d.vy<0 && solidAt(getTile,d.x,ny-ry)){
      d.vy=0; d.y=ny+ (Math.floor(ny-ry)+1+ry+0.001-ny);
    } else {
      d.y=ny;
    }
    if(d.y>WORLD_BOTTOM-1.2){ d.y=WORLD_BOTTOM-1.2; d.vy=0; d.settled=true; }
  }
  function mergeSettledPiles(){
    for(let i=0;i<list.length;i++){
      const a=list[i];
      if(a.kind!=='resource' || !a.settled) continue;
      for(let j=i+1;j<list.length;j++){
        const b=list[j];
        if(b.kind!=='resource' || !b.settled || b.res!==a.res) continue;
        const dx=a.x-b.x, dy=a.y-b.y;
        if(dx*dx+dy*dy<=MERGE_DIST*MERGE_DIST){
          a.qty+=b.qty; a.age=Math.min(a.age,b.age);
          list.splice(j,1); j--;
        }
      }
    }
  }
  let mergeT=0;
  // Hero reaction state: the nearest worn-upgrade drop in sight range makes the
  // hero go wide-eyed (drawPlayer reads this). t counts seconds since spotting
  // THIS drop, so the face can pop at first glimpse and then hold the stare.
  let _excite=null; // {id,x,y,tier,t}
  function update(dt,player,getTile){
    if(!(dt>0) || !isFinite(dt)) return;
    dt=Math.min(0.25,dt);
    updateArrowCollectFx(dt,player);
    const magnetLevel=lootMagnetLevel();
    const auto=(debugAutoPref || magnetLevel>0) && player && finiteNum(player.x) && finiteNum(player.y);
    for(let i=list.length-1;i>=0;i--){
      const d=list[i];
      d.age+=dt;
      if(d._lavaGraceT>0) d._lavaGraceT-=dt;
      // equipment changes while loot lies on the ground: re-judge on a
      // staggered clock, never per frame (compareItem scans the bag)
      if(d.kind==='gear'){
        d._cmpT=(d._cmpT||0)-dt;
        if(d._cmpT<=0){ d._cmpT=UPGRADE_RECHECK_SEC; d.upgrade=isWornUpgrade(d); }
      }
      // ticking bomb: the better the find, the shorter its clock (d.life)
      const lifetime=finiteNum(d.life) ? d.life : DESPAWN_SEC;
      if(d.kind!=='chest' && d.age>=lifetime){ list.splice(i,1); continue; }
      // an epic+'s final seconds tick audibly — the bomb is heard, not just seen
      if(d.kind==='gear' && isHighTier(d.tier)){
        const tickLeft=lifetime-d.age;
        if(tickLeft<8){
          const sec=Math.ceil(tickLeft);
          if(sec!==d._tickSec){
            d._tickSec=sec;
            try{ if(MM.audio && MM.audio.play) MM.audio.play('spark',{x:d.x,y:d.y}); }catch(e){}
          }
        }
      }
      if(auto && d.kind!=='chest' && inAutoPickupReach(d,player,magnetLevel)){
        const dd=dist2ToPlayer(d,player);
        if(dd<=COLLECT_DIST*COLLECT_DIST){ collect(d,{player}); continue; }
        // Vacuum straight at the hero, ignoring terrain. Gear reach is tile-
        // exact (including diagonals); the debug override keeps its old circle.
        const dist=Math.sqrt(dd)||1;
        d.x+=((player.x-d.x)/dist)*MAGNET_SPEED*dt;
        d.y+=((player.y-0.3-d.y)/dist)*MAGNET_SPEED*dt;
        d.settled=false; d.vx=0; d.vy=0;
        continue;
      }
      if(!d.settled){
        stepPhysics(d,dt,getTile);
        if(d._tile===T.LAVA && burnInLava(i,d)) continue;
      } else {
        // Settled drops poll their footing on a staggered clock, not per frame
        // (two getTile reads × 140 settled drops was idle-frame scanning).
        d._supT=(d._supT||0)+dt;
        if(d._supT>=0.35){
          d._supT=0;
          d._tile=getSafe(getTile,d.x,d.y);
          if(d._tile===T.LAVA && burnInLava(i,d)) continue;
          const supportRadius=d.kind==='chest'?CHEST_RADIUS_Y:RADIUS;
          if(!solidAt(getTile,d.x,d.y+supportRadius+0.05) && !solidAt(getTile,d.x,d.y+1)){
            d.settled=false; d.vy=0.1; // ground mined away underneath: resume falling
          }
        }
      }
    }
    mergeT-=dt;
    if(mergeT<=0){ mergeT=0.5; mergeSettledPiles(); }
  }
  // Volcano sacrifice: a COMMON gear offering swallowed by lava has a slim,
  // ratcheting chance to come back BETTER — flung out of the fire in a wild
  // arc the player has to chase. Refused offerings feed the next roll.
  function volcanoSacrifice(d){
    const chance=Math.min(SACRIFICE_MAX, SACRIFICE_BASE+sacrificeDry*SACRIFICE_STEP);
    if(!(rand()<chance)){ sacrificeDry++; return null; }
    const kinds=['cape','eyes','outfit','weapon','charm'];
    const kind=kinds[Math.min(kinds.length-1,Math.floor(rand()*kinds.length))];
    const tr=rand();
    const tier= tr<SACRIFICE_LEGENDARY_CHANCE ? 'legendary'
      : tr<SACRIFICE_LEGENDARY_CHANCE+SACRIFICE_EPIC_CHANCE ? 'epic' : 'rare';
    const item=genThemedItem({kind, name:'Dar wulkanu', desc:'Wulkan przyjął ofiarę. Wypluł resztę.'},tier);
    if(!item) return null;
    item.id=makeGearId(kind,'volcano');
    const out=spawnGear(d.x, d.y-1.2, item, {vx:(rand()*2-1)*7, vy:-(9+rand()*4)});
    if(!out) return null;
    out.source='volcano';
    out._lavaGraceT=2.5; // the newborn gift must clear the lava it rose from
    sacrificeDry=0;
    try{ if(typeof window.msg==='function') window.msg('🌋 Wulkan przyjął ofiarę — coś wystrzeliło z krateru!'); }catch(e){}
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('volcano_sacrifice','Wulkan przyjął ofiarę i oddał z nawiązką!'); }catch(e){}
    return out;
  }
  // Lava eats dropped loot — walk into the volcano for your prize or lose it.
  // Epic finds are the exception: they sit IN the lava, glowing, daring you.
  function burnInLava(i,d){
    if(d.kind==='chest') return false;
    if(d.kind==='jewel') return false;
    if(isHighTier(d.tier)) return false;
    if(d._lavaGraceT>0) return false; // a fresh volcano gift arcs over its cradle
    if(d.kind==='gear' && d.tier==='common') volcanoSacrifice(d);
    list.splice(i,1);
    const px=d.x*(MM.TILE||20), py=d.y*(MM.TILE||20);
    try{ if(MM.particles && MM.particles.spawnSmoke) MM.particles.spawnSmoke(px,py-4,0.8); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('fire',{x:d.x,y:d.y}); }catch(e){}
    return true;
  }

  // --- rendering (ctx already world-transformed; camX/camY in tiles) ---------
  function resourceColor(res){
    try{
      const defs=MM.inventory && MM.inventory.RESOURCES;
      if(Array.isArray(defs)){ const hit=defs.find(r=>r && r.key===res); if(hit && hit.color) return hit.color; }
    }catch(e){}
    return '#c9a15a';
  }
  // Glow effects are pre-rendered sprites, not per-frame gradients: a canvas
  // gradient object per drop per frame is the classic softraster frame tax.
  // Only the small fixed tier/jewel palette ever glows, so the cache stays tiny.
  const fxSprites=new Map();
  function fxSprite(key,build){
    let s=fxSprites.get(key);
    if(s===undefined){
      s=null;
      try{ if(typeof document!=='undefined') s=build(); }catch(e){ s=null; }
      fxSprites.set(key,s);
    }
    return s;
  }
  function haloSprite(color){
    return fxSprite('halo:'+color,()=>{
      const c=document.createElement('canvas'); c.width=64; c.height=64;
      const g=c.getContext('2d');
      const grad=g.createRadialGradient(32,32,1,32,32,32);
      grad.addColorStop(0,color); grad.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=grad; g.fillRect(0,0,64,64);
      return c;
    });
  }
  function beamSprite(color){
    return fxSprite('beam:'+color,()=>{
      const c=document.createElement('canvas'); c.width=16; c.height=64;
      const g=c.getContext('2d');
      const grad=g.createLinearGradient(0,0,0,64);
      grad.addColorStop(0,'rgba(0,0,0,0)'); grad.addColorStop(1,color);
      g.fillStyle=grad; g.fillRect(0,0,16,64);
      return c;
    });
  }
  function drawArrowPickup(ctx,px,py,angle,TILE,style,alpha){
    ctx.save();
    ctx.globalAlpha=alpha==null?1:alpha;
    ctx.translate(px,py); ctx.rotate(angle||0);
    ctx.strokeStyle=style.color; ctx.lineWidth=Math.max(1.5,TILE*0.09); ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-TILE*0.38,0); ctx.lineTo(TILE*0.24,0); ctx.stroke();
    ctx.fillStyle=style.head;
    ctx.beginPath(); ctx.moveTo(TILE*0.40,0); ctx.lineTo(TILE*0.20,-TILE*0.12); ctx.lineTo(TILE*0.20,TILE*0.12); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#e8e2d2';
    ctx.fillRect(-TILE*0.42,-TILE*0.12,TILE*0.17,TILE*0.08);
    ctx.fillRect(-TILE*0.42,TILE*0.04,TILE*0.17,TILE*0.08);
    ctx.restore();
  }
  function drawChest(ctx,px,py,TILE,tier,airT,vx,vy,settled){
    const accent=TIER_COLORS[tier]||TIER_COLORS.common;
    const w=TILE*0.82, h=TILE*0.58;
    ctx.save();
    ctx.translate(px,py);
    if(!settled) ctx.rotate(Math.max(-0.16,Math.min(0.16,(vx||0)*0.025+(vy||0)*0.008)));
    ctx.fillStyle='#5b351b';
    ctx.fillRect(-w/2,-h/2,w,h);
    ctx.fillStyle='#8d5928';
    ctx.fillRect(-w/2+2,-h/2+2,w-4,h*0.42);
    ctx.fillStyle='#321d10';
    ctx.fillRect(-w/2,h*0.02,w,h*0.11);
    ctx.strokeStyle=accent; ctx.lineWidth=Math.max(1.5,TILE*0.09);
    ctx.strokeRect(-w/2,-h/2,w,h);
    ctx.fillStyle=accent;
    ctx.fillRect(-TILE*0.09,-TILE*0.05,TILE*0.18,TILE*0.23);
    ctx.fillStyle='#fff4bd';
    ctx.fillRect(-TILE*0.025,TILE*0.015,TILE*0.05,TILE*0.07);
    ctx.restore();
  }
  function drawJewel(ctx,px,py,TILE,d,now){
    const style=JEWEL_STYLE[d.res]||JEWEL_STYLE.jewelBlessed;
    const pulse=0.92+Math.sin(now*0.008+d.id)*0.10;
    const r=TILE*0.39*pulse;
    const rot=d.settled?Math.sin(now*0.002+d.id)*0.12:d.airT*d.spin*0.28;
    ctx.save(); ctx.translate(px,py); ctx.rotate(rot);
    ctx.globalCompositeOperation='lighter';
    ctx.strokeStyle=style.color; ctx.lineWidth=Math.max(1,TILE*0.055);
    for(let ring=0;ring<2;ring++){
      const rr=TILE*(0.54+ring*0.19)+Math.sin(now*0.004+d.id+ring)*TILE*0.035;
      const a=now*(ring?0.0015:-0.0019)+d.id;
      ctx.globalAlpha=ring?0.34:0.52;
      ctx.beginPath(); ctx.arc(0,0,rr,a,a+Math.PI*(ring?1.28:0.92)); ctx.stroke();
    }
    ctx.globalAlpha=0.72;
    for(let i=0;i<8;i++){
      const a=now*0.0012+d.id+i*Math.PI/4;
      const r0=TILE*0.53, r1=TILE*(0.68+(i%2)*0.12);
      ctx.beginPath(); ctx.moveTo(Math.cos(a)*r0,Math.sin(a)*r0); ctx.lineTo(Math.cos(a)*r1,Math.sin(a)*r1); ctx.stroke();
    }
    ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
    ctx.shadowColor=style.color; ctx.shadowBlur=TILE*0.45;
    ctx.fillStyle=style.color;
    ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(r*0.78,-r*0.20); ctx.lineTo(r*0.46,r*0.72); ctx.lineTo(0,r); ctx.lineTo(-r*0.46,r*0.72); ctx.lineTo(-r*0.78,-r*0.20); ctx.closePath(); ctx.fill();
    ctx.shadowBlur=0;
    ctx.fillStyle=style.edge;
    ctx.beginPath(); ctx.moveTo(0,-r*0.82); ctx.lineTo(r*0.55,-r*0.16); ctx.lineTo(0,r*0.08); ctx.lineTo(-r*0.40,-r*0.16); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.86)';
    ctx.beginPath(); ctx.moveTo(0,r*0.08); ctx.lineTo(r*0.40,r*0.60); ctx.lineTo(0,r*0.82); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.88)'; ctx.lineWidth=Math.max(1,TILE*0.045); ctx.stroke();
    ctx.restore();
  }
  function draw(ctx,TILE,camX,camY,zoom,canDrawTile,player){
    if(!ctx || (!list.length && !arrowCollectFx.length)) return;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    const viewL=camX-2, viewR=camX+(ctx.canvas.width/zoom)/TILE+2;
    const viewT=camY-2, viewB=camY+(ctx.canvas.height/zoom)/TILE+2;
    const now=performance.now();
    let hint=null;
    if(player && finiteNum(player.x)) hint=nearestInReach(player,PICKUP_RADIUS);
    // font strings built once per frame, not once per drop
    const glyphFont=Math.round(TILE*0.5)+'px sans-serif';
    const qtyFont='bold '+Math.max(9,Math.round(TILE*0.42))+'px sans-serif';
    const hintFont='bold '+Math.round(TILE*0.4)+'px sans-serif';
    ctx.save();
    for(const d of list){
      if(d.x<viewL || d.x>viewR || d.y<viewT || d.y>viewB) continue;
      if(visible && !visible(Math.floor(d.x),Math.floor(d.y))) continue;
      const lifetime=finiteNum(d.life) ? d.life : DESPAWN_SEC;
      const left=lifetime-d.age;
      const blinkWin=Math.min(BLINK_SEC, lifetime*0.25);
      if(d.kind!=='chest' && left<blinkWin && ((now/160)|0)%2===0) continue; // despawn blink
      const bob=d.kind==='chest' ? 0 : (d.settled ? Math.sin(now*0.003+d.id)*0.07 : 0);
      const px=d.x*TILE, py=(d.y+bob)*TILE;
      const tint=d.kind==='gear' ? (TIER_COLORS[d.tier]||TIER_COLORS.common) : (d.color||'#c9a15a');
      // tier halo: the promise of quality reads from across the screen
      if(d.kind==='gear'||d.kind==='jewel'){
        const halo=haloSprite(d.kind==='jewel'?(d.color||'#ffffff'):(TIER_COLORS[d.tier]||TIER_COLORS.common));
        if(halo){
          const pulse=0.65+0.35*Math.sin(now*0.005+d.id);
          const rank=tierRank(d.tier);
          const haloR=TILE*(d.kind==='jewel'?1.72+rank*0.08:d.tier==='legendary'?1.2:d.tier==='epic'?1.05:rank===2?0.85:rank===1?0.72:0.6);
          ctx.globalAlpha=(d.kind==='jewel'?0.62:d.tier==='legendary'?0.4:d.tier==='epic'?0.34:rank===2?0.28:rank===1?0.22:0.16)*pulse;
          ctx.drawImage(halo,px-haloR,py-haloR,haloR*2,haloR*2);
          ctx.globalAlpha=1;
        }
      }
      if(isHighTier(d.tier)||d.kind==='jewel'){
        // vertical light beam: "something great fell HERE" — tall, breathing,
        // with a slow-orbiting glint so it reads even at the screen's edge
        const beam=beamSprite(d.kind==='jewel'?(d.color||'#ffffff'):(TIER_COLORS[d.tier]||TIER_COLORS.epic));
        if(beam){
          const jewelRank=d.kind==='jewel'?tierRank(d.tier):0;
          const tall=d.kind==='jewel'?5.2+jewelRank*0.25:d.tier==='legendary'?4.2:3.4;
          const beamH=TILE*tall, beamW=Math.max(3,TILE*(d.kind==='jewel'?0.48+jewelRank*0.05:d.tier==='legendary'?0.3:0.24));
          ctx.globalAlpha=(d.kind==='jewel'?0.36:0.24)+0.14*Math.sin(now*0.004+d.id);
          ctx.drawImage(beam,px-beamW/2,py-beamH,beamW,beamH);
        }
        const ga=now*0.0016+d.id;
        const gx=px+Math.cos(ga)*TILE*0.55;
        const gy=py-TILE*0.6+Math.sin(ga*1.7)*TILE*0.35;
        const gs=Math.max(2,TILE*0.14);
        ctx.globalAlpha=0.45+0.45*Math.sin(now*0.009+d.id*2);
        ctx.fillStyle='#fff';
        ctx.fillRect(gx-gs/2,gy-1,gs,2);
        ctx.fillRect(gx-1,gy-gs/2,2,gs);
        ctx.globalAlpha=1;
      }
      // body: small tilted plaque with an outline; spins while flying
      const s=TILE*0.42;
      const arrowStyle=d.kind==='resource' ? arrowStyleFor(d.res) : null;
      if(d.kind==='chest'){
        drawChest(ctx,px,py,TILE,d.tier,d.airT,d.vx,d.vy,d.settled);
      } else if(d.kind==='jewel'){
        drawJewel(ctx,px,py,TILE,d,now);
      } else if(arrowStyle){
        const angle=d.settled ? -Math.PI/18 : Math.atan2(d.vy||0,d.vx||0);
        drawArrowPickup(ctx,px,py,angle,TILE,arrowStyle,1);
      } else {
        ctx.save();
        ctx.translate(px,py);
        ctx.rotate(d.settled ? Math.PI/24 : d.airT*d.spin*0.35);
        ctx.fillStyle=tint;
        ctx.fillRect(-s/2,-s/2,s,s);
        ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=1;
        ctx.strokeRect(-s/2,-s/2,s,s);
        const glyph=d.kind==='gear' ? KIND_GLYPH[d.item && d.item.kind] : d.glyph;
        if(glyph){
          ctx.font=glyphFont;
          ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(glyph,0,1);
        } else {
          ctx.fillStyle='rgba(255,255,255,0.35)';
          ctx.fillRect(-s/2+2,-s/2+2,s-4,3);
        }
        ctx.restore();
      }
      // cursor hover: a breathing ring says "this one previews in the corner"
      if(hoverDrop===d){
        const hr=(d.kind==='chest'?TILE*0.52:d.kind==='jewel'?TILE*0.78:s*0.95)+Math.sin(now*0.008)*1.2;
        ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(px,py,hr,0,Math.PI*2); ctx.stroke();
      }
      // ticking-bomb bar: rare+ gear wears its remaining time on its sleeve
      // (uncommon still burns slow enough that a bar would be standing noise)
      if(d.kind==='gear' && tierRank(d.tier)>=2){
        const frac=Math.max(0,Math.min(1,left/lifetime));
        const bw=TILE*0.9, bh=Math.max(2,TILE*0.12), bx=px-bw/2, by=py-TILE*0.55;
        ctx.fillStyle='rgba(10,12,16,0.72)';
        ctx.fillRect(bx-1,by-1,bw+2,bh+2);
        ctx.fillStyle= frac>0.5 ? tint : frac>0.25 ? '#ffb347' : '#ff5544';
        ctx.fillRect(bx,by,bw*frac,bh);
      }
      if(d.kind==='resource' && d.qty>1){
        ctx.font=qtyFont;
        ctx.textAlign='left'; ctx.textBaseline='alphabetic';
        ctx.fillStyle='#fff'; ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=2;
        ctx.strokeText('×'+d.qty,px+s*0.45,py+s*0.55);
        ctx.fillText('×'+d.qty,px+s*0.45,py+s*0.55);
      }
      if(hint===d){
        // manual pickup affordance: a little [E] tag over the nearest drop
        const bw=TILE*0.62, bh=TILE*0.52, bx=px-bw/2, by=py-TILE*1.15;
        ctx.fillStyle='rgba(12,14,18,0.82)';
        ctx.fillRect(bx,by,bw,bh);
        ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=1;
        ctx.strokeRect(bx,by,bw,bh);
        ctx.fillStyle='#fff';
        ctx.font=hintFont;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('E',px,by+bh/2+0.5);
      }
      // rare+ drops shed the occasional spark so they twinkle in the corner of the eye
      if(d.tier!=='common' && rand()<0.02){
        try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(px,py-TILE*0.3,d.tier,1); }catch(e){}
      }
    }
    for(const fx of arrowCollectFx){
      const alpha=Math.max(0,Math.min(1,1-fx.t/fx.life*0.45));
      ctx.globalAlpha=alpha*0.38;
      ctx.strokeStyle=fx.color; ctx.lineWidth=Math.max(1.5,TILE*0.08);
      ctx.beginPath(); ctx.moveTo(fx.px*TILE,fx.py*TILE); ctx.lineTo(fx.x*TILE,fx.y*TILE); ctx.stroke();
      ctx.globalAlpha=1;
      drawArrowPickup(ctx,fx.x*TILE,fx.y*TILE,fx.ang,TILE,{color:fx.color,head:fx.headColor},alpha);
    }
    ctx.restore();
  }

  // --- persistence ------------------------------------------------------------
  const ITEM_NUM_FIELDS=['airJumps','visionRadius','moveSpeedMult','jumpPowerMult','mineSpeedMult','waterMoveSpeedMult','attackDamage','fireDps','fireRange','fireCooldown','energyCost','energyCapacityBonus','lootMagnetLevel','crushResistBonus'];
  const ITEM_STR_FIELDS=['name','tier','desc','unique','weaponType','mergePerk'];
  const ITEM_MERGE_PERKS=new Set(['vampire','venom','frost','storm','fury']);
  const ITEM_KINDS=new Set(['cape','eyes','outfit','weapon','charm']);
  function sanitizeItem(raw){
    if(!raw || typeof raw!=='object') return null;
    if(typeof raw.id!=='string' || !raw.id || raw.id.length>96) return null;
    if(!ITEM_KINDS.has(raw.kind)) return null;
    const it={id:raw.id, kind:raw.kind};
    ITEM_NUM_FIELDS.forEach(f=>{ const v=raw[f]; if(typeof v==='number' && isFinite(v)) it[f]=v; });
    ITEM_STR_FIELDS.forEach(f=>{ const v=raw[f]; if(typeof v==='string' && v.length<=80) it[f]=v; });
    if(it.mergePerk && (it.kind!=='weapon' || !ITEM_MERGE_PERKS.has(it.mergePerk))) delete it.mergePerk;
    if(typeof it.lootMagnetLevel==='number'){
      const level=Math.trunc(it.lootMagnetLevel);
      if(level<1) delete it.lootMagnetLevel;
      else it.lootMagnetLevel=Math.min(4,level);
    }
    if(finiteNum(raw.enhancement)) it.enhancement=Math.max(-99,Math.min(99,Math.trunc(raw.enhancement)));
    return it;
  }
  function snapshot(){
    return {
      v:2,
      dry:Math.max(0,Math.min(PITY_KILLS,dry)),
      sac:Math.max(0,Math.min(200,sacrificeDry)),
      list:list.slice(0,SNAPSHOT_CAP).map(d=>{
        const out={x:+d.x.toFixed(4), y:+d.y.toFixed(4), kind:d.kind, tier:d.tier, age:+Math.min(9999,d.age).toFixed(2)};
        if(finiteNum(d.life)) out.life=+d.life.toFixed(1);
        if(d.kind==='resource'||d.kind==='jewel'){ out.res=d.res; out.qty=d.qty; }
        else if(d.kind==='gear') out.item=Object.assign({},d.item);
        else if(d.kind==='chest'){
          out.lootSeed=d.lootSeed>>>0;
          out.source=typeof d.source==='string' ? d.source.slice(0,40) : 'reward';
        }
        return out;
      })
    };
  }
  function restore(data){
    reset();
    if(!data || !Array.isArray(data.list)) return;
    if(finiteNum(data.dry)) dry=Math.max(0,Math.min(PITY_KILLS,Math.floor(data.dry)));
    if(finiteNum(data.sac)) sacrificeDry=Math.max(0,Math.min(200,Math.floor(data.sac)));
    for(const r of data.list){
      if(list.length>=MAX_DROPS) break;
      if(!r || !finiteNum(r.x) || !finiteNum(r.y)) continue;
      const tier=TIER_RANK[r.tier]!==undefined ? r.tier : 'common';
      const age=Math.max(0,Math.min(9999,Number(r.age)||0));
      const life=finiteNum(r.life) ? Math.max(5,Math.min(3600,r.life)) : null;
      if(r.kind==='gear'){
        const item=sanitizeItem(r.item);
        if(!item) continue;
        const d=spawnGear(r.x,r.y,item,{vx:0,vy:0,announce:false}); // a reload is not a find
        if(d){ d.tier=tier; d.age=age; if(life!=null) d.life=life; }
      } else if(r.kind==='chest'){
        const d=spawnChest(r.x,r.y,tier,{vx:0,vy:0,lootSeed:r.lootSeed,source:typeof r.source==='string'?r.source:'reward'});
        if(d){ d.age=age; }
      } else if(r.kind==='jewel' && JEWEL_STYLE[r.res]){
        const d=spawnJewel(r.x,r.y,r.res,{vx:0,vy:0,announce:false,source:'restore'});
        if(d){ d.age=age; if(life!=null) d.life=life; }
      } else if(typeof r.res==='string' && r.res.length<=48){
        const d=spawnResource(r.x,r.y,r.res,r.qty,{vx:0,vy:0});
        if(d){ d.tier=tier; d.age=age; if(life!=null) d.life=life; }
      }
    }
  }
  function reset(){ list.length=0; chestDrops.clear(); arrowCollectFx.length=0; mergeT=0; dry=0; sacrificeDry=0; hoverDrop=null; }

  const api={
    update,draw,
    spawnResource,spawnGear,spawnJewel,spawnChest,rollGearDrop,rollJewelDrop,rollGuardianDrop,showArrowCollect,
    pickupNearest,wantsInteractKey,hoverAt,pickupAt,chestAtPoint,remove,
    debugAutoPickup,setDebugAutoPickup,autoPickup,setAutoPickup,lootMagnetLevel,
    snapshot,restore,reset,
    metrics:()=>({active:list.length, jewels:list.filter(d=>d.kind==='jewel').length, chests:chestDrops.size, arrowCollectFx:arrowCollectFx.length, autoPickup:debugAutoPickup(), debugAutoPickup:debugAutoPickup(), lootMagnetLevel:lootMagnetLevel()}),
    _debug:{list,arrowCollectFx,arrowStyleFor, GEAR_LOOT, GUARDIAN_LOOT, JEWEL_STYLE, dangerFor, jewelPowerFor, jewelChanceFor, jewelBossLike, rollTier, setRandom:(fn)=>{ rand=typeof fn==='function'?fn:Math.random; }, collect, nearestInReach,inAutoPickupReach,
      dryStreak:()=>dry, setDryStreak:(n)=>{ dry=Math.max(0,Math.floor(Number(n)||0)); },
      sacrificeDry:()=>sacrificeDry,
      config:{MAX_DROPS,DESPAWN_SEC,JEWEL_LIFE,GEAR_LIFE,GUARDIAN_RELIC_LIFE,PICKUP_RADIUS,AUTO_RADIUS,COLLECT_DIST,MERGE_DIST,MOUSE_HIT,MOUSE_PICKUP_RADIUS,CHEST_RADIUS_X,CHEST_RADIUS_Y,CHEST_GRAVITY,CHEST_TERMINAL,CHEST_BOUNCE,SIDEKICK_DROP_CHANCE,SIDEKICK_EPIC_CHANCE,SIDEKICK_LEGENDARY_CHANCE,PITY_KILLS,SACRIFICE_BASE,SACRIFICE_STEP,SACRIFICE_MAX,SACRIFICE_LEGENDARY_CHANCE,UNCOMMON_SHARE,LEGENDARY_BASE_SHARE,LEGENDARY_DANGER_BONUS}}
  };
  MM.drops=api;
  return api;
})();

export { drops };
export default drops;
