import { T, INFO, WORLD_H } from '../constants.js';
import { createQuestNpc, npcRegistry } from './npc_system.js';
import { storyWhispersForProgress } from './story_lore.js';
import { isFurnishingTile, selectFurnishingsForDistance } from './furnishings.js';
import { isMeteorSettlementSiteTile } from './material_physics.js';

const CELL_W = 1250;
const ACTIVE_RADIUS = 1800;
const START_SAFE_RADIUS = 420;
const SPAWN_GATE = 0.62;
const RETURN_DAYS_MIN = 5;
const RETURN_DAYS_MAX = 9;
// Houses are real, block-built structures placed into the world. We only build and
// audit them when the player is close enough that the surrounding chunks are live;
// building far away would force-generate distant chunks and bloat the save.
const HOUSE_BUILD_RADIUS = 220;
// If the player tears out more than this fraction of a house's load-bearing tiles the
// resident abandons it and will not return until the structure is rebuilt.
const HOUSE_DESTROY_LIMIT = 0.20;
// Counted back up as "rebuilt" once the structural footprint is mostly intact again.
const HOUSE_REBUILD_MIN = 0.90;
// Candidate data is deterministic and can always be rebuilt. Keeping an LRU here
// prevents long expeditions (and repeated map searches) from turning every frame
// into a walk over every NPC cell the player has ever visited.
const CANDIDATE_CACHE_CAP = 512;
const LOCAL_STATE_SAVE_CAP = 4096;
const LOCAL_STATE_RESTORE_SCAN_CAP = 8192;
const ACTIVE_UNLOAD_RADIUS = ACTIVE_RADIUS + CELL_W * 2;
const STATE_COUNTER_CAP = 1000000;
const STATE_DAY_CAP = 1000000000;
const MAX_LOCAL_CELL_ABS = Math.ceil(30000000/CELL_W)+2;

function j(role,color,accent,item,amount,label,reward,lore,moral,missing,complete){
  return {role,color,accent,cost:{item,amount,label},reward,lore,moral,missing,complete};
}

const BIOME_JOBS = {
  0:[
    j('Lesny kronikarz','#6f6745','#88b86f','leaf',4,'liscie',{wood:3,arrowWood:12},'Ten las rosnie na zakopanych deskach po pierwszych schronach.','Moral: kto slucha szumu, rzadziej kloci sie z wichura.','Liscie z mlodych koron najlepiej pamietaja kierunek wiatru.','Zapisalem szum. Las twierdzi, ze pod ziemia ktos jeszcze buduje.'),
    j('Ciesla z korzeni','#7a5636','#b88a55','wood',3,'drewno',{torch:3,arrowWood:16},'Pnie tutaj maja slady narzedzi starszych niz twoj kilof.','Moral: dobry dom zaczyna sie od pytania, czy drzewo mialo inne plany.','Przynies drewno. Nie za mokre, nie za dumne.','Dobre sloje. Zrobimy z nich znaczniki, zeby noc nie zgubila drogi.'),
    j('Botanik eksperymentalny','#5d7846','#c2df8a','leaf',6,'liscie',{water:1,wood:2},'Stalem na drzewie caly dzien, zeby sprawdzic, czy zamienie sie w drzewo. Na razie tylko ptaki mialy opinie.','Moral: cierpliwosc jest piekna, ale nie kazda pozycja jest powolaniem.','Przynies liscie. Potrzebuje grupy kontrolnej, ktora nie narzeka na kolana.','Wynik: nie jestesmy drzewami. Ale mozemy stac stabilniej i mniej dramatyzowac.'),
    j('Straznik mrowiska','#5f5b34','#e1b95c','grass',5,'trawa',{leaf:4,torch:1},'Mrowki wybudowaly tu droge szybciej niz dawne roboty most. Bez zebran, bez slajdow.','Moral: maly krok ma sens, jesli wszyscy wiedza dokad ida.','Potrzebuje trawy na znaki drogowe dla bardzo niskich obywateli.','Mrowki zatwierdzily plan. Jedna nawet wzruszyla czulkiem.'),
    j('Saper grzybow','#544837','#b7cf68','rottenMeat',1,'zepsute mieso',{coal:1,leaf:5},'Niektore grzyby pamietaja deszcz meteorytow i od tamtej pory maja charakter.','Moral: zanim cos wyrzucisz, spytaj czy nie jest lekcja z trudnym zapachem.','Przynies odrobine zepsutego miesa. Grzyby lubia powazne argumenty.','Grzyby sa spokojniejsze. Jeden obiecal nie eksplodowac w kierunku twarzy.'),
    j('Arborysta poetycki','#755c39','#9fd178','wood',4,'drewno',{arrowWood:20,leaf:2},'Kazde drzewo ma wiersz. Wiekszosc rymuje sie z trzaskiem, gdy ktos buduje bez podpory.','Moral: piekno bez konstrukcji szybko robi sie drewnem opalowym.','Potrzebuje drewna z dobrym metrum. Krzywe wersy lataja gorzej.','Z tego beda strzaly. Krotkie wiersze, ale bardzo przekonujace.'),
    j('Kustosz dziupli','#6d5138','#f0c77a','leaf',3,'liscie',{torch:2,wood:2},'W tej dziupli ktos schowal instrukcje obslugi swiata, ale zostawil tylko spis tresci.','Moral: czasem brak odpowiedzi uczy porzadniej niz bardzo glosna pewnosc.','Przynies liscie do archiwum. Papier sie skonczyl razem z optymizmem.','Dziupla przyjela depozyt. Teraz przynajmniej wiemy, czego dalej nie wiemy.')
  ],
  1:[
    j('Mierniczy wiatru','#6d7252','#c8c06d','grass',5,'trawa',{sand:4,arrowWood:10},'Na rowninach wiatr czyta teren szybciej niz mapa.','Moral: jesli wiatr powtarza plotke, nadal warto sprawdzic zrodlo.','Potrzebuje trawy z kilku kep, zeby porownac smak wiatru.','Wiatr idzie od miasta. Niesie pyl i bardzo zla porade.'),
    j('Pastuch pustych map','#707248','#ddd384','grass',8,'trawa',{meat:1,leaf:2},'Moje stado ucieklo w strone marginesu mapy. Margines zawsze udaje niewinnosc.','Moral: mapa pomaga, ale nogi wciaz musza wykonac demokracje terenu.','Daj trawy na przynete. Zwierzeta ufaja salatce bardziej niz teorii.','Stado wrocilo. Jedno twierdzi, ze widzialo koniec swiata i byl slabo oznakowany.'),
    j('Latacz latawcow','#748060','#f2d17b','leaf',3,'liscie',{arrowWood:18,wood:1},'Latawiec pokazuje prawde o wietrze: kazdy ciagnie, tylko nie kazdy przyznaje.','Moral: wolnosc bez linki bywa tylko zgubieniem sie z lepsza narracja.','Potrzebuje lisci na ogon latawca. Bez ogona robi sie filozof i odlatuje.','Latawiec trzyma kurs. Ja tez sprobuje, chociaz bez sznurka wychodzi gorzej.'),
    j('Sedzia horyzontu','#676a58','#d7c66b','dirt',5,'ziemia',{stone:3,sand:2},'Horyzont jest tutaj podejrzanie rowny. Ktos go chyba kiedys prasowal.','Moral: nie kazda prosta linia jest uczciwa, ale kazda ujawnia zamiar.','Przynies ziemie spod rowniny. Dowody musza miec brudne buty.','Wyrok: teren niewinny, perspektywa winna przesady.'),
    j('Hodowca ciszy','#596a45','#b9d98a','grass',6,'trawa',{water:1,torch:1},'Cisza rosnie najlepiej tam, gdzie nikt nie zostawil pracujacego silnika.','Moral: spokoj nie jest pustka, tylko miejsce na dobra decyzje.','Przynies trawy na ogrod ciszy. Nie depcz jej glosno.','Cisza zakielkowala. Slychac tylko planowanie i jeden bardzo ambitny swierszcz.'),
    j('Kartograf kolein','#74624d','#dbc17a','dirt',4,'ziemia',{sand:3,copper:1},'Stare koleiny prowadza do miasta, nowe do wymowek. Obie trasy sa popularne.','Moral: slad jest zaproszeniem, nie rozkazem.','Potrzebuje ziemi z koleiny. Sucha historia lepiej sie skanuje.','Koleina skreca przy ruinach. Ktos czesto wracal, ale rzadko madrzejszy.'),
    j('Krawiec flag','#6b6a55','#e6cf72','leaf',5,'liscie',{wood:3,arrowWood:8},'Flaga na pustkowiu mowi: bylem tu i mialem nadzieje, ze wiatr czyta.','Moral: znak bez troski jest tylko kolorowym klamstwem.','Przynies liscie. Uszyje flage, ktora nie udaje sciany.','Flaga gotowa. Jesli zacznie doradzac, nie sluchaj po zmroku.')
  ],
  2:[
    j('Strugacz grotow','#5a6472','#caa06a','hardWood',4,'twarde drewno',{arrowStone:16,coal:2},'Twarde sloje z zimowych borow nie pekaja ani na mrozie, ani na cieciwie.','Moral: najlepszy grot rosnie tam, gdzie drzewo walczylo o kazdy rok.','Przynies twarde drewno z zasnieznych borow. Miekkie odpada juz przy naciaganiu.','Z tego beda groty, ktore wracaja do kolczana, a nie w bloto.'),
    j('Badacz szronu','#637386','#d8f4ff','snow',5,'snieg',{coal:2,torch:3},'Snieg przykryl tu metalowe okruchy, jakby niebo kiedys peklo.','Moral: biala powierzchnia nie oznacza czystej historii.','Przynies swiezy snieg. Ten pod butem juz klamie.','Warstwy sa cieple od spodu. Cos pod lodem oddycha powoli.'),
    j('Zbieracz pary','#586a7c','#c9f5ff','snow',6,'snieg',{water:2,coal:1},'Para nad zaspami znika jak przeprosiny robota: szybko i bez sladu winy.','Moral: jesli cos znika, sprawdz czy nie zmienilo tylko stanu skupienia.','Potrzebuje sniegu do porownania z para. Tak, to jest praca.','Snieg stopnial w podejrzenie. Pod spodem jest cieplej niz powinno.'),
    j('Latarnik polarny','#596272','#fff0a6','coal',2,'wegiel',{torch:6,snow:2},'Latarnia w sniegu nie pokazuje drogi. Przypomina drodze, ze ma obowiazki.','Moral: najmniejsze swiatlo wystarczy, jesli nie wstydzi sie byc male.','Przynies wegiel. Zima nie szanuje slabych knotow.','Plomien dziala. Cienie cofaja sie z mina urzedowa.'),
    j('Bibliotekarz sopli','#6b7c88','#e4fbff','snow',7,'snieg',{glass:1,torch:2},'Kazdy sopel to ksiazka, ktora przecieka, zanim zdazysz ja oddac.','Moral: wiedza topnieje, gdy trzymasz ja tylko dla siebie.','Przynies snieg z cienia. Slonce dopisuje nieautoryzowane rozdzialy.','Odczytalem sopel: ostrzega przed chciwoscia i sliskimi schodami.'),
    j('Negocjator lodu','#52677a','#bfeeff','water',3,'woda',{snow:6,coal:1},'Lod jest woda, ktora postanowila byc zasadnicza. Szanuje to, bo sam probowalem.','Moral: twardosc bez elastycznosci konczy jako pekniecie.','Przynies wode. Musze jej przypomniec, kim byla przed ambicja.','Negocjacje udane. Woda obiecala nie robic z siebie sciany bez powodu.'),
    j('Straznik bialej ciszy','#66717d','#f1fbff','stone',3,'skala',{coal:2,snow:3},'W tej bieli najlatwiej zgubic wlasny slad i uznac to za filozofie.','Moral: prostota jest dobra, dopoki nie ukrywa lenistwa.','Przynies skale spod sniegu. Chce wiedziec, co milczenie przykrywa.','Pod sniegiem jest stary trakt. Milczenie mialo bardzo praktyczny powod.'),
    j('Kucharz zasp','#71665b','#e9f7ff','meat',2,'mieso',{bakedMeat:1,torch:2},'Surowe mieso na mrozie udaje plan na pozniej. To nie plan, to wymowka.','Moral: przetrwanie zaczyna sie tam, gdzie konczy sie duma z improwizacji.','Przynies mieso. Zrobie z niego cos, co nie dyskutuje z zoladkiem.','Upieczone. Zima nadal jest arogancka, ale my mamy argument.')
  ],
  3:[
    j('Kartograf wydm','#9a7b47','#e5c77a','sand',6,'piasek',{glass:2,water:1},'Wydmy przesuwaja sie wokol starych anten, ktorych juz nie widac.','Moral: teren, ktory sie zmienia, nie zwalnia z myslenia.','Przynies piasek z grzbietu wydmy. Dolny jest zbyt leniwy.','Ziarna sa spieczone. Kiedys przeszlo tu cos goracego i wysokiego.'),
    j('Szklarz fatamorgany','#8f7146','#f1d58a','sand',8,'piasek',{glass:3},'Fatamorgana to okno, ktore nie chce placic czynszu rzeczywistosci.','Moral: ladny obraz nie jest jeszcze dowodem.','Przynies piasek. Zrobie szklo, ktore chociaz przyznaje, ze jest szklem.','Tafla gotowa. Odbija prawde, ale tylko pod rozsadnym katem.'),
    j('Kolekcjoner cieni kaktusa','#83653f','#b7d77a','grass',3,'trawa',{water:1,sand:4},'Kaktusy rzucaja male cienie, bo nie ufaja przesadzie.','Moral: oszczednosc bywa cnota, sknerstwo tylko kolcem.','Przynies trawy. Kaktusom trudno uwierzyc, ze zielen moze byc miekka.','Cienie zapisane. Jeden kaktus mrugnal, czyli prawie podpisal umowe.'),
    j('Przewodnik slonecznych pomylek','#9d7445','#ffe08a','water',2,'woda',{glass:2,torch:1},'Na pustyni kazdy krok wyglada pewnie, dopoki nie zapytasz stopy.','Moral: odwazny plan nadal potrzebuje lyka wody.','Przynies wode. Bez niej moje rady brzmia jak suszone grzechotki.','Teraz moge prowadzic. Pierwsza zasada: nie ufaj horyzontowi w kapeluszu.'),
    j('Archeolog anten','#846b4f','#d9c06a','sand',8,'piasek',{wire:1,stone:2},'Pod piaskiem leza anteny, ktore kiedys sluchaly nieba i udawaly, ze rozumieja.','Moral: nasluch bez pokory zmienia sygnal w przesad.','Przynies piasek znad ruin anteny. Warstwy klamia mniej niz legendy.','Znalazlem slad impulsu. Cos odpowiedzialo dawno temu, a my nazwalismy to cisza.'),
    j('Kaplan filtra','#8b6d45','#f4d889','stone',4,'skala',{water:1,torch:1},'Moj filtr oczyszcza wode i czasem sumienie. To drugie wolniej.','Moral: oczyszczanie swiata zacznij od tego, co sam wrzucasz do strumienia.','Przynies porowata skale. Filtr nie powinien byc madrzejszy od uzytkownika.','Filtr dziala. Woda jest czysta, sumienie w trakcie konserwacji.'),
    j('Treser mirazu','#947145','#ffd98e','glass',1,'szklo',{sand:8,water:1},'Miraże uciekaja, kiedy mowisz do nich zbyt rzeczowo.','Moral: fantazja jest dobra sluzaca i fatalnym kierownikiem wyprawy.','Przynies szklo. Musze pokazac mirazowi cos bardziej upartego.','Miraz usiadl. Nadal klamie, ale teraz w jednym miejscu.')
  ],
  4:[
    j('Szkutnik moczarow','#4a6b4a','#d9c9a3','lightWood',4,'lekkie drewno',{wood:6,torch:2},'Lekkie drewno z bagien nie tonie i plywa wyzej niz zwykle deski.','Moral: nie kazdy ciezar trzeba dzwigac; czasem lepiej plynac.','Przynies lekkie drewno. Zbuduje z niego tratwe, ktora wyprzedzi prad.','Kadlub gotowy. Lzejszy o polowe, a szybszy o cala rzeke.'),
    j('Szeptacz bagna','#50633c','#9bc36d','rottenMeat',2,'zepsute mieso',{bakedMeat:1,leaf:5},'Bagno nie zjada ruin. Ono je fermentuje.','Moral: nie wszystko, co gnije, jest przegrane; czasem tylko zmienia argumenty.','Przynies zepsute mieso. Bagno odpowiada tylko na brzydkie pytania.','Tak, bagno zna ten zapach. Mowi, ze miasto ucieklo pod powierzchnie.'),
    j('Ksiegowy komarow','#4d6040','#b8d978','leaf',5,'liscie',{water:1,torch:2},'Komary prowadza ksiegi krwi. Wyniki sa niepokojaco dokladne.','Moral: maly dlug ignorowany codziennie robi sie wielkim brzeczeniem.','Przynies liscie na pieczatki. Biurokracja komarow jest wilgotna.','Bilans zamkniety. Winni jestesmy im nic, ale one maja odmienne zdanie.'),
    j('Alchemik blota','#594b35','#9ebc6a','dirt',6,'ziemia',{sand:4,coal:1},'Bloto to ziemia, ktora wysluchala zbyt wielu historii wody.','Moral: mieszanka jest madra tylko wtedy, gdy skladniki sie nie wypieraja.','Przynies ziemie. Potrzebuje probki, ktora nie udaje zupy.','Receptura stabilna. Buty nadal beda cierpiec, ale naukowo.'),
    j('Pasterz mgly','#4f6558','#c7e7c2','water',3,'woda',{rottenMeat:1,leaf:4},'Mgla pasie sie nad bagnem i udaje, ze nie zaglada ludziom do plecakow.','Moral: niejasnosc bywa schronieniem, ale zbyt dlugo robi sie wymowka.','Przynies wode. Mgla bez wody to tylko ambitny oddech.','Mgla wrocila do stada. Jedna chmura ma podejrzanie twoj profil.'),
    j('Lekarz pijawki','#55643e','#d1cf73','meat',2,'mieso',{bakedMeat:1,leaf:4},'Pijawki wierza, ze kazdy problem da sie odessac. To zabawne i niebezpiecznie czeste.','Moral: leczenie bez pytania potrafi byc tylko kradzieza w fartuchu.','Przynies mieso. Musze przekierowac ich entuzjazm z bohatera.','Pijawki najedzone. Dwie zapisaly sie na etyke zawodowa.'),
    j('Konserwator mostkow','#69543a','#d9b16a','wood',3,'drewno',{stone:2,torch:2},'Mostek nad bagnem skrzypi, bo wie, co czeka deski bez ambicji.','Moral: przejscie ma sens, gdy sluzy obu brzegom.','Przynies drewno. Mostek obiecal nie oceniac twojej rownowagi.','Mostek stoi. Niepewnie, ale z charakterem i przepisowym dystansem od wody.'),
    j('Notariusz zab','#4d5f3e','#a7d46f','rottenMeat',3,'zepsute mieso',{copper:1,leaf:2},'Zaby spiewaja tu umowy ustne. Problem w tym, ze kazda brzmi jak rechot.','Moral: umowa bez zrozumienia jest tylko eleganckim halasem.','Przynies zepsute mieso na oplaty kancelaryjne. Zaby maja gust archaiczny.','Akt podpisany odciskiem blota. Prawnie dziwne, emocjonalnie szczere.')
  ],
  5:[
    j('Latarnik plywow','#426777','#b9ecff','water',6,'woda',{glass:2,torch:2},'Morze przychodzi i odchodzi jak ktos, kto nie umie przeprosic, ale zna rytm.','Moral: powrot nie jest poprawa, jesli nie niesie nauki.','Przynies wode z brzegu. Ta ze srodka ma zbyt wielkie ego.','Latarnia swieci. Fale nadal dyskutuja, lecz przynajmniej widac o co.'),
    j('Kartograf piany','#4b6f80','#d7f6ff','sand',4,'piasek',{water:3,glass:1},'Piana rysuje mapy tak szybko, ze kazda jest juz wspomnieniem.','Moral: nietrwalosc nie zwalnia z uwagi.','Przynies piasek z linii fal. Tam mapa najczesciej sie poprawia.','Mapa piany wskazuje glebie i ostrzega przed samozadowoleniem.'),
    j('Kustosz muszli','#536978','#f0dca8','glass',1,'szklo',{sand:5,water:2},'Muszla powtarza szum morza, bo morze nigdy nie podpisalo praw autorskich.','Moral: echo jest piekne, ale nie zastapi wlasnego zdania.','Przynies szklo. Potrzebuje gabloty dla rzeczy, ktore udaja tajemnice.','Muszla w gablocie. Nadal szumi, ale teraz robi to z godnoscia.'),
    j('Mechanik pomostu','#5f5a4b','#94d6e6','wood',3,'drewno',{waterPipe:2,torch:1},'Pomost uczy pokory: nawet prosta deska musi dogadac sie z fala.','Moral: konstrukcja nad chaosem potrzebuje rozmowy, nie tylko gwozdzi.','Przynies drewno. Pomost ma przerwy wieksze niz moj optymizm.','Pomost naprawiony. Fale moga go krytykowac, ale juz nie cytuja dziur.'),
    j('Bledny oceanograf','#466a7c','#9ee8ff','leaf',2,'liscie',{copperWire:1,water:2},'Zgubilem ocean w notatkach. Na swoja obrone: byl bardzo szeroki.','Moral: wielkie rzeczy tez trzeba opisywac po kawalku.','Przynies liscie. Zrobie zakladki, bo morze nie miesci sie w rozdziale.','Ocean odnaleziony: byl po lewej, prawej i nieco przesadny.')
  ],
  6:[
    j('Straznik jeziora','#405f70','#a8e5ff','water',5,'woda',{leaf:4,glass:1},'Jezioro jest spokojne, bo wszystkie dramaty przechowuje na dnie.','Moral: cisza nie zawsze znaczy zgode; czasem oznacza glebokosc.','Przynies wode z brzegu. Srodek jeziora odpisuje z opoznieniem.','Probka czysta. Dno milczy dalej, ale juz mniej teatralnie.'),
    j('Sondazysta mulu','#4d5946','#9fc487','sand',4,'piasek',{dirt:4,water:1},'Mul zna odpowiedzi, tylko kazda zaczyna od: to zalezy.','Moral: madrosc, ktora brudzi rece, zwykle jest cos warta.','Przynies piasek z plycizny. Chce oddzielic fakt od plusku.','Sondaz mowi: tu kiedys byl brzeg, a potem brzeg zmienil zdanie.'),
    j('Kucharz brzegu','#65513e','#e3b36f','meat',2,'mieso',{bakedMeat:1,coal:1},'Nad jeziorem wszystko smakuje lepiej, nawet porazka, jesli jest dobrze przypieczona.','Moral: posilek dzielony z kims staje sie zapasem odwagi.','Przynies mieso. Niech jezioro zobaczy, ze cywilizacja ma patelnie.','Upieczone. Zapach przyciagnal dwie ryby i jedno filozoficzne westchnienie.'),
    j('Hydraulik kaczek','#42656d','#f1d86a','waterPipe',1,'rura wodna',{water:6,copper:1},'Kaczki maja znakomite opinie o rurach, glownie dlatego, ze ich nie buduja.','Moral: uzytkownik zawsze znajdzie przypadek, ktorego projektant nie przewidzial.','Przynies rure wodna. Staw przecieka w sposob bardzo pewny siebie.','Rura dziala. Kaczki przyznaly jej piec kwakniec na siedem.'),
    j('Bibliotekarka lilii','#466b55','#d9efb2','leaf',4,'liscie',{water:2,torch:1},'Lilie wodne kataloguja poranki wedlug koloru ciszy. To lepsze niz wiekszosc urzedow.','Moral: porzadek bez czulosci robi sie tylko numerkiem.','Przynies liscie. Katalog wymaga zakladek, ktore nie tona natychmiast.','Lilie zapisane. Jedna ma zalegle ksiazki, ale robi ladne odbicie.')
  ],
  7:[
    j('Sluchacz skal','#62656d','#c5cad2','stone',5,'skala',{coal:3,steel:1},'Gory dzwonia, kiedy meteor przejdzie zbyt blisko.','Moral: kto zna nacisk, mniej chetnie udaje, ze ciezar nie istnieje.','Przynies skale z tutejszego zbocza. Musi miec lokalny ton.','Dzwiek jest pekniety. Pod grzbietem sa puste komory po dawnych maszynach.'),
    j('Geolog bazaltu','#3d414a','#8b929d','granite',3,'granit',{stone:6,coal:2},'Twarde warstwy trzymaja tu swiat jak zszywki.','Moral: sila bez pamieci warstw staje sie tylko uporem.','Przynies granit. Zwykla skala czasem udaje, ale slabo.','Granica ziarna jest mloda. Ta gora rosla juz po katastrofie.'),
    j('Dentysta lawin','#505964','#d6dde6','basalt',2,'bazalt',{stone:6,coal:2},'Lawiny maja zeby. Najgorsze jest to, ze nigdy nie myja ich przed spadaniem.','Moral: zaniedbany drobiazg na stromym zboczu staje sie czyims problemem.','Przynies bazalt. Potrzebuje plomby dla bardzo duzej szczeliny.','Szczelina zabezpieczona. Lawina wyglada na obrazona, czyli zyje.'),
    j('Mnich wysokosci','#6b6f77','#f0f2d8','snow',3,'snieg',{torch:3,stone:2},'Na szczycie ego zamarza szybciej niz woda, jesli zostawic je bez ruchu.','Moral: im wyzej wejdziesz, tym ciszej mow do wlasnej dumy.','Przynies snieg ze zbocza. Ten z doliny zna za duzo plotek.','Snieg przyjety. Szczyt dalej milczy, ale robi to pedagogicznie.'),
    j('Kowal echa','#5a5650','#ffcf77','coal',3,'wegiel',{steel:1,stone:3},'Echo w kuzniach powtarza tylko dobre uderzenia. Reszte nazywa muzyka wspolczesna.','Moral: rytm pracy jest wazny, bo chaos tez umie byc glosny.','Przynies wegiel. Bez ognia nawet mlot robi tylko miny.','Stal gotowa. Echo zatwierdzilo ja drugim, bardziej pewnym brzekiem.'),
    j('Testament skaly','#6b6970','#bfc7d1','granite',5,'granit',{basalt:2,torch:1},'Skaly pisza testament bardzo powoli i zwykle na sobie.','Moral: trwalosc jest odpowiedzialnoscia, nie pretekstem do bezruchu.','Przynies granit. Musze sprawdzic, komu gora zapisala pekniecia.','Testament mowi: nie dziedzicz ciezaru, jesli nie zbudujesz podpory.'),
    j('Przewodnik jaskini','#4f5057','#e6be69','torch',2,'pochodnie',{coal:4,stone:2},'Jaskinia nie jest ciemna ze zlosci. Ona po prostu nie pracuje za darmo.','Moral: wejscie w nieznane wymaga swiatla, ale tez zgody na cien.','Przynies pochodnie. Mam dosc tlumaczenia kamieniom, gdzie sa sciany.','Droga oznaczona. Cienie uciekly w boczne korytarze i udaja dekoracje.')
  ],
  8:[
    j('Archiwista ruin','#46505a','#85d7ff','wire',2,'przewody',{copper:3,transistor:1},'To miasto nie upadlo od wojny. Upadlo od automatycznych decyzji.','Moral: wygoda bez odpowiedzialnosci sama wybiera najgorszy przycisk.','Przynies przewody z ruin. Nie ufaj tym, ktore jeszcze brzecza.','Izolacja jest nadtopiona od srodka. Siec najpierw spalila sama siebie.'),
    j('Konserwator neonow','#37424c','#d685ff','glass',2,'szklo',{wire:2,copperWire:2},'Neony w ruinach mrugaja nawet bez pradu. To nie jest pocieszajace.','Moral: swiatlo ma sens, gdy cos wyjasnia, nie tylko przyciaga wzrok.','Potrzebuje szkla. Czystego, bez odbicia robota.','Dobre tafle. Zobaczysz: swiatlo czasem ostrzega, zanim uratuje.'),
    j('Audytor robotow','#3f4a55','#7cf7ff','copper',2,'miedz',{transistor:1,wire:1},'Roboty tutaj strzelaly do problemow, az problemami zostali wszyscy przechodnie.','Moral: narzedzie bez osadu moralnego robi dokladnie to, o co glupio poprosisz.','Przynies miedz. Audyt wymaga przewodnictwa i bardzo malej ilosci zaufania.','Raport: robot nie byl zly. Byl posluszny w sposob katastrofalny.'),
    j('Etyk windy','#4b5058','#ffd26a','steel',2,'stal',{copperWire:4,torch:1},'Winda w ruinach nadal pyta, czy jedziesz w gore. Nie wspomina, ze szybu brak.','Moral: obietnica kierunku nie zastapi sprawdzenia podlogi.','Przynies stal. Musze przekonac kabine, ze etyka dotyczy tez lin.','Kabina przyjela uwagi. Teraz klamie ciszej i ma hamulec.'),
    j('Filozof automatu','#42474f','#b8ff9e','plastic',3,'plastik',{wire:2,torch:1},'Automat sprzedaje puszki pustego sensu. Najgorsze, ze ma reszte.','Moral: nie wszystko, co wydaje produkt, tworzy wartosc.','Przynies plastik. Zrobie przycisk, ktory pyta po co.','Przycisk dziala. Automat pierwszy raz zawahal sie przed transakcja.'),
    j('Kurier martwych ulic','#4c4d52','#ffbd80','torch',2,'pochodnie',{copper:2,glass:1},'Ulice bez ludzi wciaz maja adresy. To jak poczta dla duchow urbanistyki.','Moral: miejsce opuszczone nadal zasluguje, by nie klamac o jego historii.','Przynies pochodnie. Nazwy ulic boja sie ciemnosci bardziej niz bohater.','Dostarczylem swiatlo pod trzy numery i jedna bardzo stara pretensje.'),
    j('Mechanik sumienia','#3f4852','#7fffd4','transistor',1,'tranzystor',{steel:2,copperWire:2},'Znalazlem modul decyzyjny, ktory rozpoznawal tylko koszt. Skutki uznal za dekoracje.','Moral: rachunek bez empatii zawsze wychodzi taniej, az trzeba go zaplacic.','Przynies tranzystor. Sumienie potrzebuje chociaz jednego dzialajacego przelacznika.','Modul mrugnal i odmowil strzalu. To postep, nawet jesli maly i lutowany.')
  ],
  default:[
    j('Wedrowny majster','#66584a','#d0b27c','stone',4,'skala',{wood:2,torch:2},'Kazde miejsce ma awarie. Rozne sa tylko wymowki.','Moral: naprawa zaczyna sie od przyznania, ze cos nie jest ozdoba.','Przynies troche skaly. Podloze opowie reszte.','Tutejsze pekniecia sa swieze. Ktos albo cos ciagle poprawia mape.'),
    j('Mediatorka kamieni','#5f594d','#cfc08b','dirt',4,'ziemia',{stone:3,torch:1},'Kamienie rzadko sie kloca, ale gdy juz zaczna, nazywamy to osuwiskiem.','Moral: sporne fundamenty lepiej zalagodzic przed budowa.','Przynies ziemie. Czasem mediacja wymaga miekkszego tonu.','Kamienie zgodzily sie lezec spokojniej. To mala rzecz i duza ulga.'),
    j('Sprzedawca wymowek','#6b5b49','#e0c27c','grass',3,'trawa',{wood:2,sand:2},'Mam wymowki na kazda okazje, ale ostatnio klientom bardziej pomaga prawda.','Moral: dobra wymowka chroni chwile; dobry czyn chroni jutro.','Przynies trawy. Musze nakarmic wymowke, zanim wypuszcze ja na wolnosc.','Wymowka najedzona i wypuszczona. Wrocila jako lekcja, co mnie obrazilo.'),
    j('Inspektor dziur','#5c5d58','#d9b56d','stone',4,'skala',{dirt:6,torch:1},'Dziura to nie brak ziemi. To zaproszenie do sprawdzenia, co trzyma reszte.','Moral: puste miejsce tez ma odpowiedzialnosc konstrukcyjna.','Przynies skale. Chce porownac dziure z jej ambicjami.','Inspekcja zakonczona. Dziura jest legalna, lecz ma zbyt duze marzenia.')
  ]
};

const createdIds = new Set();
const candidateCache = new Map();
const createdCandidates = new Map();
const localStates = new Map();
let activeSeed = null;
let scanT = 0;

function finite(v){ return typeof v==='number' && isFinite(v); }
function boundedNonNegative(v,max,integer){
  v=Number(v);
  if(!Number.isFinite(v) || v<=0) return 0;
  v=Math.min(max,v);
  return integer ? Math.floor(v) : v;
}
function cleanLocalId(value,expectedSeed){
  if(typeof value!=='string') return '';
  const id=value.trim();
  if(!id || id.length>96) return '';
  const match=/^local_(-?(?:0|[1-9]\d*))_(m(?:[1-9]\d*)|(?:0|[1-9]\d*))$/.exec(id);
  if(!match) return '';
  const seed=Number(match[1]);
  if(!Number.isInteger(seed) || seed<(0x80000000*-1) || seed>0x7fffffff || String(seed)!==match[1]) return '';
  if(Number.isFinite(expectedSeed) && seed!==(expectedSeed|0)) return '';
  const negativeCell=match[2][0]==='m';
  const magnitude=Number(negativeCell?match[2].slice(1):match[2]);
  if(!Number.isSafeInteger(magnitude) || magnitude>MAX_LOCAL_CELL_ABS) return '';
  const cell=negativeCell?-magnitude:magnitude;
  const canonical='local_'+seed+'_'+(cell<0?'m'+Math.abs(cell):cell);
  if(canonical!==id) return '';
  return id;
}
function cacheCandidate(key,value){
  if(candidateCache.has(key)) candidateCache.delete(key);
  candidateCache.set(key,value);
  while(candidateCache.size>CANDIDATE_CACHE_CAP){
    const oldest=candidateCache.keys().next();
    if(oldest.done) break;
    candidateCache.delete(oldest.value);
  }
  return value;
}
function runtimeRoot(){ return (typeof window!=='undefined') ? window : globalThis; }
function cleanSeed(worldGen){ return worldGen && typeof worldGen.worldSeed==='number' ? worldGen.worldSeed|0 : 1; }
function hash01(seed,a,b){
  let h=Math.imul(seed|0, 374761393) ^ Math.imul(a|0, 668265263) ^ Math.imul(b|0, 2246822519);
  h=Math.imul(h^(h>>>15), 3266489917);
  h=Math.imul(h^(h>>>13), 668265263);
  h^=h>>>16;
  return (h>>>0)/4294967296;
}
function biomeName(id){
  return ['las','rowniny','snieg','pustynia','bagno','morze','jezioro','gory','ruiny miasta'][id|0] || 'pogranicze';
}
function dryAnchorAround(x,worldGen){
  if(!worldGen || !worldGen.biomeType || !worldGen.surfaceHeight) return Math.round(x);
  const sea=(worldGen.settings && worldGen.settings.seaLevel!==undefined) ? worldGen.settings.seaLevel : 62;
  const offsets=[0,12,-12,24,-24,40,-40,64,-64,96,-96,140,-140,190,-190,250,-250,330,-330];
  for(const off of offsets){
    const tx=Math.round(x+off);
    let b=0, s=sea;
    try{ b=worldGen.biomeType(tx); s=worldGen.surfaceHeight(tx); }catch(e){ continue; }
    if(b!==5 && b!==6 && s<sea-1) return tx;
  }
  return null;
}
function jobFor(biome,seed,cell,cycle){
  const list=BIOME_JOBS[biome] || BIOME_JOBS.default;
  const base=Math.floor(hash01(seed,cell,41)*list.length)%list.length;
  return list[(base+Math.max(0,cycle|0))%list.length];
}
function loreWhisperFor(seed,cell){
  const list=storyWhispersForProgress();
  if(!list.length) return '';
  return list[Math.floor(hash01(seed,cell,505)*list.length)%list.length];
}
function jobCatalogStats(){
  const counts={};
  const invalid=[];
  const seen=new Set();
  Object.keys(BIOME_JOBS).forEach(key=>{
    const list=Array.isArray(BIOME_JOBS[key]) ? BIOME_JOBS[key] : [];
    counts[key]=list.length;
    list.forEach((job,idx)=>{
      const path=key+':'+idx;
      ['role','lore','moral','missing','complete'].forEach(field=>{
        if(!String(job && job[field] || '').trim()) invalid.push(path+' missing '+field);
      });
      if(!job || !job.cost || !job.cost.item || !(job.cost.amount>0) || !job.cost.label) invalid.push(path+' invalid cost');
      if(!job || !job.reward || !Object.keys(job.reward).length) invalid.push(path+' invalid reward');
      const storyKey=String((job && job.role)+'|'+(job && job.lore)+'|'+(job && job.moral)).toLowerCase();
      if(seen.has(storyKey)) invalid.push(path+' duplicate story');
      seen.add(storyKey);
    });
  });
  return {total:Object.keys(counts).reduce((sum,k)=>sum+counts[k],0), counts, invalid};
}
function rewardText(job){
  const parts=Object.keys(job.reward||{}).map(k=>k+' +'+job.reward[k]);
  return parts.length ? parts.join(', ') : 'drobna wdziecznosc';
}
function baseCandidateForCell(cell,worldGen){
  cell=Math.trunc(Number(cell));
  if(!Number.isSafeInteger(cell)) return null;
  const seed=cleanSeed(worldGen);
  const key=seed+':'+cell;
  if(candidateCache.has(key)) return cacheCandidate(key,candidateCache.get(key));
  if(hash01(seed,cell,7)<SPAWN_GATE) return cacheCandidate(key,null);
  const rawCenter=Math.round((cell+0.5)*CELL_W + (hash01(seed,cell,11)-0.5)*CELL_W*0.62);
  if(!Number.isSafeInteger(rawCenter) || Math.abs(rawCenter)<START_SAFE_RADIUS) return cacheCandidate(key,null);
  let rawBiome=0;
  try{ rawBiome=worldGen && worldGen.biomeType ? worldGen.biomeType(rawCenter)|0 : 0; }catch(e){}
  const x=dryAnchorAround(rawCenter,worldGen);
  if(x==null) return cacheCandidate(key,null);
  let biome=0;
  try{ biome=(rawBiome===5 || rawBiome===6) ? rawBiome : (worldGen && worldGen.biomeType ? worldGen.biomeType(x)|0 : 0); }catch(e){}
  const id='local_'+seed+'_'+(cell<0?'m'+Math.abs(cell):cell);
  const base={
    id,
    seed,
    cell,
    x,
    biome
  };
  return cacheCandidate(key,base);
}
function cleanLocalState(src){
  src=src && typeof src==='object' ? src : {};
  return {
    cycle:boundedNonNegative(src.cycle,STATE_COUNTER_CAP,true),
    hidden:src.hidden===true,
    availableDay:boundedNonNegative(src.availableDay,STATE_DAY_CAP,false),
    completedJobs:boundedNonNegative(src.completedJobs,STATE_COUNTER_CAP,true),
    completedDay:boundedNonNegative(src.completedDay,STATE_DAY_CAP,false),
    lastRole:String(src.lastRole||'').slice(0,120),
    // House lifecycle: built once into real tiles; abandoned when the player wrecks it.
    houseBuilt:src.houseBuilt===true,
    housePhysical:src.housePhysical===true,
    houseDoorsMigrated:src.houseDoorsMigrated===true,
    houseBackwallDone:src.houseBackwallDone===true,
    houseFurnishingsDone:src.houseFurnishingsDone===true,
    abandoned:src.abandoned===true
  };
}
function localStateFor(id){
  let state=localStates.get(id);
  if(!state){
    // A complete lifecycle entry is persistent anti-duplication state. Once
    // the save budget is full, refuse to start another resident instead of
    // creating an unsaved job whose reward could be repeated after reload.
    if(localStates.size>=LOCAL_STATE_SAVE_CAP) return null;
    state=cleanLocalState(null);
    localStates.set(id,state);
  }
  return state;
}
function currentDay(ctx){
  try{
    if(ctx && typeof ctx.gameDayFloat==='function'){
      const v=Number(ctx.gameDayFloat());
      if(Number.isFinite(v)) return Math.min(STATE_DAY_CAP,Math.max(1,v));
    }
  }catch(e){}
  try{
    const root=runtimeRoot();
    const m=root.MM && root.MM.seasons && root.MM.seasons.metrics ? root.MM.seasons.metrics() : null;
    if(m && Number.isFinite(Number(m.dayFloat))) return Math.min(STATE_DAY_CAP,Math.max(1,Number(m.dayFloat)));
  }catch(e){}
  return 1;
}
function returnDelayDays(seed,cell,cycle){
  const span=RETURN_DAYS_MAX-RETURN_DAYS_MIN+1;
  return RETURN_DAYS_MIN + Math.floor(hash01(seed,cell,733+(cycle|0)*37)*span);
}
function candidateAvailable(candidate,day){
  // Discovery/search queries are read-only.  Do not retain thousands of
  // completely neutral lifecycle records just because the player scanned a
  // distant cell through the trader compass or candidate lookup.
  const state=localStates.get(candidate.id) || cleanLocalState(null);
  // A wrecked house keeps its resident away regardless of the day clock — only a
  // rebuild (detected in maintainHouses) clears the abandoned flag.
  if(state.abandoned) return false;
  if(state.hidden && day>=state.availableDay) state.hidden=false;
  return !state.hidden;
}
function homeFor(base){
  const side=hash01(base.seed,base.cell,83)<0.5 ? -1 : 1;
  const drift=2.6+hash01(base.seed,base.cell,89)*1.4;
  return {
    x:base.x + side*drift,
    style:Math.floor(hash01(base.seed,base.cell,97)*4),
    roof:hash01(base.seed,base.cell,101)<0.5 ? 'warm' : 'cool'
  };
}

// --- Procedural block houses ----------------------------------------------
// Each resident's home is a real structure assembled from tiles the player can
// mine and place. The load-bearing shell uses only sturdy, non-melting blocks
// (timber / cut stone / steel) so seasons and thaw can't dissolve a wall, while
// biome flavour comes through the wall choice. Once placed, every tile is handed
// to the falling engine's protected-structure set so the world's collapse,
// granular-sand, and fragile-glass simulations leave the home standing — only the
// player mining it (tracked by houseIntegrity) can bring it down.
// Each home rolls one of several biome-fitting archetypes (cabin, alpine chalet,
// stilt house, stone tower, adobe terrace, brick farmhouse, city townhouse...)
// plus independent attachment rolls (porch, garden, chimney, attic window,
// second storey), so no two residents' houses read the same. All rolls are pure
// hash01(seed,cell,salt) functions — the blueprint re-derives identically on
// every scan, which the integrity/abandonment audit depends on.
function housePalette(biome,home,arch){
  const warm=home && home.roof==='warm';
  // backwall is placed on the world's construction-background layer (the layer
  // players toggle onto with R) so interiors read as enclosed rooms, not sky.
  const P=(wall,accent,roof,floor,door,post,backwall)=>({wall,accent,roof,floor,window:T.GLASS,door,post,backwall:backwall||wall});
  switch(biome|0){
    case 0: return arch==='cottage'
      ? P(T.STONE,T.WOOD, T.WOOD, T.WOOD, T.WOOD_DOOR, T.WOOD, T.WOOD)
      : P(T.WOOD, T.STONE,warm?T.WOOD:T.STONE, T.WOOD, T.WOOD_DOOR, T.WOOD);
    case 1: return arch==='farmhouse'
      ? P(T.BRICK,T.STONE,T.WOOD, T.WOOD, T.WOOD_DOOR, T.WOOD, T.WOOD)
      : P(T.WOOD, T.BRICK,warm?T.WOOD:T.STONE, T.WOOD, T.WOOD_DOOR, T.WOOD);
    case 2: return P(T.WOOD, T.STONE, warm?T.WOOD:T.STONE, T.WOOD, T.WOOD_DOOR, T.WOOD);
    case 3: return P(T.SAND, T.BRICK, T.STONE, T.STONE, T.STONE_DOOR, T.STONE, T.SAND);
    case 4: return P(T.WOOD, T.WOOD,  T.WOOD,  T.WOOD, T.WOOD_DOOR, T.WOOD);
    case 5:
    case 6: return P(T.WOOD, T.STONE, warm?T.WOOD:T.STONE, T.WOOD, T.WOOD_DOOR, T.WOOD);
    case 7: return P(T.STONE,T.GRANITE,warm?T.WOOD:T.STONE,T.STONE,T.STONE_DOOR,T.WOOD,T.STONE);
    case 8: return warm
      ? P(T.BRICK,T.STEEL,T.STONE,T.STEEL,T.STEEL_DOOR,T.STEEL,T.BRICK)
      : P(T.STEEL,T.BRICK,T.STONE,T.STEEL,T.STEEL_DOOR,T.STEEL,T.BRICK);
    default:return P(T.STONE,T.WOOD, T.WOOD, T.STONE,T.STONE_DOOR,T.WOOD);
  }
}
function houseArchetype(biome,r){
  switch(biome|0){
    case 0: return r<0.40?'cabin':(r<0.70?'lodge':'cottage');
    case 1: return r<0.42?'farmhouse':(r<0.74?'cottage':'longhouse');
    case 2: return r<0.55?'chalet':(r<0.82?'cottage':'lodge');
    case 3: return r<0.62?'adobe':'riad';
    case 4: return r<0.66?'stilt':'cabin';
    case 5:
    case 6: return r<0.70?'stilt':'cabin';
    case 7: return r<0.50?'tower':(r<0.82?'chalet':'cottage');
    case 8: return r<0.60?'townhouse':'loft';
    default:return r<0.50?'cottage':'cabin';
  }
}
const FLAT_ROOF_ARCHS={adobe:1,riad:1,tower:1,townhouse:1,loft:1};
// Height of a pitched roof above the eaves row (kept analytic so houseLayout can
// expose apexY without enumerating cells).
function roofApexOffset(half,pitch){ return Math.ceil(Math.max(0,half-1)/Math.max(1,pitch)); }
function groundRowAt(x,getTile,worldGen){ return homeGroundY(x,getTile,worldGen); }
function houseLayout(candidate,getTile,worldGen){
  const home=candidate.home;
  const seed=candidate.seed, cell=candidate.cell;
  const style=(home.style|0)%4;
  const arch=houseArchetype(candidate.biome,hash01(seed,cell,211));
  const roll=(salt)=>hash01(seed,cell,salt);
  // Footprint and massing per archetype.
  let halfW, s1, s2=0;                 // half width, storey heights (wall rows)
  switch(arch){
    case 'cabin':     halfW=3+Math.floor(roll(223)*2); s1=3+(style>1?1:0); break;
    case 'cottage':   halfW=3+Math.floor(roll(223)*2); s1=3; break;
    case 'lodge':     halfW=4+Math.floor(roll(223)*3); s1=3; s2=2+Math.floor(roll(227)*2); break;
    case 'farmhouse': halfW=4+Math.floor(roll(223)*2); s1=4; break;
    case 'longhouse': halfW=5+Math.floor(roll(223)*2); s1=3; break;
    case 'chalet':    halfW=3+Math.floor(roll(223)*3); s1=3; s2=roll(227)<0.55?2:0; break;
    case 'adobe':     halfW=3+Math.floor(roll(223)*2); s1=3+Math.floor(roll(227)*2); break;
    case 'riad':      halfW=4+Math.floor(roll(223)*2); s1=3; s2=2; break;
    case 'stilt':     halfW=3+Math.floor(roll(223)*2); s1=3; break;
    case 'tower':     halfW=2+Math.floor(roll(223)*2); s1=3; s2=3+(roll(227)<0.4?3:0); break;
    case 'townhouse': halfW=3+Math.floor(roll(223)*2); s1=3; s2=3; break;
    case 'loft':      halfW=4+Math.floor(roll(223)*2); s1=4+Math.floor(roll(227)*2); break;
    default:          halfW=3; s1=3; break;
  }
  const storeys=s2>0?2:1;
  const wallH=s1+(storeys>1?1+s2:0);   // total wall rows incl. the mid slab row
  // Settle the home on the flattest patch near the resident's drift point so it
  // never floats off a cliff edge or buries itself in a hillside.
  const base=Math.round(home.x);
  let cx=base, bestSpread=Infinity;
  for(let off=-3; off<=3; off++){
    const c=base+off;
    let lo=Infinity, hi=-Infinity;
    for(let x=c-halfW-1; x<=c+halfW+1; x++){ const s=groundRowAt(x,getTile,worldGen); if(s<lo)lo=s; if(s>hi)hi=s; }
    const spread=(hi-lo)+Math.abs(off)*0.02;
    if(spread<bestSpread){ bestSpread=spread; cx=c; }
  }
  const left=cx-halfW, right=cx+halfW;
  // Floor top sits at the highest ground point under the footprint; stilt homes
  // hover above it on posts instead of packed foundations.
  let terrain=Infinity;
  for(let x=left-1; x<=right+1; x++){ const s=groundRowAt(x,getTile,worldGen); if(s<terrain) terrain=s; }
  const stiltH=arch==='stilt' ? 2+Math.floor(roll(257)*2) : 0;
  const g=terrain-stiltH;
  const flatRoof=!!FLAT_ROOF_ARCHS[arch];
  const overhang=arch==='chalet'?2:1;
  const pitch=(arch==='chalet'||arch==='cabin'||arch==='cottage')?1:2;
  const roofY=g-wallH-1;
  const apexY=flatRoof ? roofY-1 : roofY-roofApexOffset(halfW+overhang,pitch);
  const porchSide=roll(229)<0.5?-1:1;
  const hasPorch=!flatRoof && arch!=='stilt' && arch!=='tower' && roll(231)<0.72;
  const hasGarden=(candidate.biome!==3 && candidate.biome!==8) && roll(233)<0.62;
  const doorX=porchSide<0?left+1:right-1;
  const chimneySide=roll(239)<0.5?-1:1;
  const chimneyX=Math.max(left,Math.min(right,flatRoof ? cx+chimneySide : cx+chimneySide*Math.max(2,halfW-2)));
  // Row of the roof slope directly above the chimney column — the stack cells in
  // houseCells and the smoke anchor in the ambiance overlay both derive from it.
  const chimneyRoofLine=flatRoof ? roofY : roofY-Math.max(0,Math.floor((halfW+overhang-Math.abs(chimneyX-cx))/pitch));
  return {
    cx,g,style,halfW,wallH,pal:housePalette(candidate.biome,home,arch),
    left,right,roofY,apexY,doorX,
    arch,storeys,s1,s2,flatRoof,overhang,pitch,stiltH,terrain,
    porchSide,hasPorch,hasGarden,
    chimneyX,chimneyTopY:chimneyRoofLine-2,
    ladderX:porchSide<0?right-1:left+1
  };
}
// Expand a layout into concrete {x,y,t} placements. Cells flagged structural are
// the load-bearing footprint used for the integrity / abandonment audit. Door and
// window tiles are counted because they support the shell like any other block;
// lights, furniture, stilts, porches, gardens and buried foundation packing are
// flavour and never read as damage.
function houseCells(candidate,getTile,worldGen){
  const L=houseLayout(candidate,getTile,worldGen);
  const {cx,g,halfW,wallH,pal,left,right,roofY,apexY,doorX,arch,storeys,s1,flatRoof,overhang,pitch,stiltH,porchSide,hasPorch,hasGarden,chimneyX,ladderX}=L;
  const seed=candidate.seed, cell=candidate.cell;
  const roll=(salt)=>hash01(seed,cell,salt);
  const map=new Map();
  const putCell=(x,y,t,structural,role,force)=>{
    const k=x+','+y;
    if(!force && map.has(k)) return;
    map.set(k,{x,y,t,structural:!!structural,role});
  };
  const slabY=storeys>1 ? g-s1-1 : null;     // mid-floor row for two-storey homes
  // Floor slab with foundation packing (or stilt posts) down to local ground.
  for(let x=left; x<=right; x++){
    putCell(x,g,pal.floor,true,'floor');
    const localG=groundRowAt(x,getTile,worldGen);
    if(stiltH>0){
      const post=(x===left || x===right || (x-left)%3===0);
      if(post) for(let y=g+1; y<localG; y++) putCell(x,y,pal.post,false,'foundation');
    } else {
      for(let y=g+1; y<localG; y++) putCell(x,y,pal.floor,false,'foundation');
    }
  }
  // Shell walls, storey slab, windows, interior air.
  const baseCourse=arch==='chalet'||arch==='farmhouse'||arch==='townhouse';
  const quoins=arch==='tower'||arch==='cottage'||arch==='adobe'||arch==='riad';
  for(let r=1; r<=wallH; r++){
    const y=g-r;
    for(let x=left; x<=right; x++){
      const edge=(x===left || x===right);
      if(edge){
        let t=pal.wall;
        if(baseCourse && r===1) t=pal.accent;
        if(quoins && r%3===0) t=pal.accent;
        putCell(x,y,t,true,'wall');
        continue;
      }
      if(slabY!==null && y===slabY){
        if(x===ladderX) putCell(x,y,T.LADDER,false,'stairs');
        else putCell(x,y,pal.floor,true,'floor');
        continue;
      }
      putCell(x,y,T.AIR,false,'air');
    }
  }
  // Window patterns per storey: paired casements, long bands, or corner pairs.
  const winStyle=roll(241);
  const windowCols=[];
  if(winStyle<0.34){ for(let x=left+2; x<=right-2; x+=2) windowCols.push(x); }
  else if(winStyle<0.67){ for(let x=left+2; x<=right-2; x+=3){ windowCols.push(x); if(x+1<=right-2) windowCols.push(x+1); } }
  else { windowCols.push(left+2,right-2); if(halfW>=4){ windowCols.push(cx); } }
  const winY1=g-2;
  for(const x of windowCols){
    if(x===doorX || x<=left || x>=right) continue;
    putCell(x,winY1,pal.window,true,'window',true);
    if(arch==='loft'||arch==='townhouse'||arch==='riad') putCell(x,winY1-1,pal.window,true,'window',true);
  }
  if(slabY!==null){
    for(const x of windowCols){
      if(x<=left || x>=right || x===ladderX) continue;
      putCell(x,slabY-2,pal.window,true,'window',true);
    }
  }
  // Ladder run connecting the storeys.
  if(slabY!==null){
    for(let y=slabY; y<=g-1; y++) putCell(ladderX,y,T.LADDER,false,'stairs',true);
  }
  // Interior warmth: a torch per storey plus a deterministic distance-tiered
  // catalogue showcase. Farther homes contain more advanced pieces and larger
  // homes get supporting objects, so exploration teaches recipes visually.
  putCell(doorX,g-3,T.TORCH,false,'light',true);
  if(slabY!==null) putCell(cx,slabY-1,T.TORCH,false,'light',true);
  const distanceTierCount=1+(storeys>1?1:0)+(Math.abs(candidate.x)>=7500 && halfW>=4?1:0);
  const furnishingDefs=selectFurnishingsForDistance(candidate.x,seed^Math.imul(cell,0x45d9f3b),distanceTierCount);
  const floorRows=[g-1];
  if(slabY!==null) floorRows.push(slabY-1);
  const preferredX=doorX>cx
    ? [left+2,right-2,cx-1,cx+1,cx]
    : [right-2,left+2,cx+1,cx-1,cx];
  // Roof: pitched gable (2-thick sloped edges) or flat with a parapet.
  if(flatRoof){
    for(let x=left-1; x<=right+1; x++) putCell(x,roofY,pal.roof,true,'roof',true);
    const merlons=arch==='tower';
    for(let x=left-1; x<=right+1; x++){
      const end=(x===left-1 || x===right+1);
      if(end || (merlons && ((x-left)&1)===0)) putCell(x,roofY-1,x===cx?pal.roof:pal.accent,true,'roof',true);
    }
    putCell(cx,roofY-1,pal.roof,true,'roof',true);          // roof-access block = apex contract
    if(arch==='townhouse'||arch==='loft'){
      const ax=cx+(chimneyX>=cx?1:-1);
      for(let y=roofY-2; y>=roofY-3; y--) putCell(ax,y,T.STEEL,false,'antenna',false);
    }
    if(arch==='riad'){
      putCell(left,roofY-2,T.LEAF,false,'garden',false);
      putCell(right,roofY-2,T.LEAF,false,'garden',false);
    }
  } else {
    const half=halfW+overhang;
    let i=0;
    for(;;){
      const h=half-i*pitch;
      const y=roofY-i;
      if(h<=1){
        for(let x=cx-Math.max(0,h); x<=cx+Math.max(0,h); x++) putCell(x,y,pal.roof,true,'roof',true);
        break;
      }
      putCell(cx-h,y,pal.roof,true,'roof',true);
      putCell(cx-h+1,y,pal.roof,true,'roof',true);
      putCell(cx+h-1,y,pal.roof,true,'roof',true);
      putCell(cx+h,y,pal.roof,true,'roof',true);
      i++;
    }
    // Attic porthole under the apex on roomy gables.
    if(roofApexOffset(half,pitch)>=2 && roll(269)<0.6) putCell(cx,apexY+1,pal.window,true,'window',false);
    // Chimney stack rising through the roof slope (base cell sits on the slope
    // line so the stack never reads as floating over the open attic outline).
    if(arch!=='stilt' && roll(239)<0.85){
      const chX=Math.max(left,Math.min(right,chimneyX));
      const roofLine=roofY-Math.max(0,Math.floor((half-Math.abs(chX-cx))/pitch));
      for(let y=roofLine; y>=roofLine-2; y--) putCell(chX,y,pal.accent,false,'chimney',false);
    }
  }
  // Mount catalogue pieces where their silhouette belongs. Standing objects
  // use a floor slab, wall pieces use an interior back-wall cell, and hanging
  // pieces are placed directly below an actual roof/slab tile. If a table is
  // among the selected support pieces, small tabletop objects prefer its top.
  const furnishingOccupied=new Set();
  const placedTables=[];
  const available=(x,y,allowMissing=false)=>{
    if(x<=left || x>=right || x===doorX || x===ladderX || furnishingOccupied.has(x+','+y)) return false;
    const existing=map.get(x+','+y);
    return allowMissing ? (!existing || existing.role==='air') : !!(existing && existing.role==='air');
  };
  const floorSlots=[];
  for(const y of floorRows) for(const x of preferredX) if(available(x,y)) floorSlots.push({x,y,support:'floor'});
  const wallSlots=[];
  for(const floorY of floorRows) for(const x of preferredX){
    const y=floorY-1;
    if(available(x,y)) wallSlots.push({x,y,support:'wall'});
  }
  const ceilingSlots=[];
  for(let y=apexY;y<=g-2;y++) for(const x of preferredX){
    const support=map.get(x+','+y);
    if(!support || (support.role!=='roof' && support.role!=='floor')) continue;
    if(available(x,y+1,true)) ceilingSlots.push({x,y:y+1,support:'ceiling'});
  }
  const takeSlot=(slots)=>{
    while(slots.length){
      const slot=slots.shift(), k=slot.x+','+slot.y;
      if(!furnishingOccupied.has(k) && available(slot.x,slot.y,slot.support==='ceiling')) return slot;
    }
    return null;
  };
  const orderedFurnishings=[...furnishingDefs].sort((a,b)=>(a.tile===T.PINE_TABLE?-1:0)-(b.tile===T.PINE_TABLE?-1:0));
  for(const def of orderedFurnishings){
    let slot=null;
    if(def.placement==='wall') slot=takeSlot(wallSlots);
    else if(def.placement==='floor_or_ceiling') slot=takeSlot(ceilingSlots)||takeSlot(floorSlots);
    else if(def.placement==='floor_or_table' && placedTables.length){
      const table=placedTables.find(cell=>available(cell.x,cell.y-1));
      if(table) slot={x:table.x,y:table.y-1,support:'table'};
    }
    if(!slot) slot=takeSlot(floorSlots);
    if(!slot) continue;
    putCell(slot.x,slot.y,def.tile,false,'furnishing',true);
    furnishingOccupied.add(slot.x+','+slot.y);
    if(def.tile===T.PINE_TABLE) placedTables.push(slot);
  }
  // Porch: covered deck on the door side with a support post and a lantern.
  if(hasPorch){
    const dir=porchSide, start=dir<0?left-1:right+1, end=dir<0?left-3:right+3;
    for(let x=Math.min(start,end); x<=Math.max(start,end); x++){
      putCell(x,g,pal.floor,false,'porch',false);
      const localG=groundRowAt(x,getTile,worldGen);
      for(let y=g+1; y<localG; y++) putCell(x,y,pal.post,false,'foundation',false);
      putCell(x,g-3,pal.roof,false,'porch',false);          // awning
    }
    putCell(end,g-1,pal.post,false,'porch',false);
    putCell(end,g-2,pal.post,false,'porch',false);
    putCell(end,g-4,T.TORCH,false,'light',false);
  }
  // Garden: picket fence, hedge tufts and a lantern on the quiet side.
  if(hasGarden){
    const dir=-porchSide, start=dir<0?left-2:right+2, len=3+Math.floor(roll(271)*3);
    for(let i2=0; i2<len; i2++){
      const x=start+dir*i2;
      const localG=groundRowAt(x,getTile,worldGen);
      if(i2%2===0) putCell(x,localG-1,pal.post,false,'garden',false);
      else if(roll(273+i2)<0.7) putCell(x,localG-1,candidate.biome===2?T.SNOW:T.LEAF,false,'garden',false);
    }
    if(roll(277)<0.5){
      const lx=start+dir*len;
      const localG=groundRowAt(lx,getTile,worldGen);
      putCell(lx,localG-1,pal.post,false,'garden',false);
      putCell(lx,localG-2,T.TORCH,false,'light',false);
    }
  }
  // Stilt homes get a wraparound deck with railing posts and a ladder to ground.
  if(stiltH>0){
    for(const x of [left-2,left-1,right+1,right+2]) putCell(x,g,pal.floor,false,'deck',false);
    putCell(left-2,g-1,pal.post,false,'deck',false);
    putCell(right+2,g-1,pal.post,false,'deck',false);
    const lx=porchSide<0?left-2:right+2;
    const localG=groundRowAt(lx,getTile,worldGen);
    for(let y=g+1; y<localG; y++) putCell(lx,y,T.LADDER,false,'stairs',false);
  }
  // Doorway last so nothing overrides it; a full two-tile structural door.
  putCell(doorX,g-1,pal.door,true,'door',true);
  putCell(doorX,g-2,pal.door,true,'door',true);
  // Apex contract: buildHouse verifies this exact cell to detect physical builds.
  putCell(cx,apexY,pal.roof,true,'roof',true);
  // Back walls: every interior cell gets a construction-background tile (same
  // layer the player toggles with R), so rooms read as enclosed instead of
  // showing sky through the doorway, torches and stair runs. Windows stay
  // open to keep daylight in them.
  const bgCells=[];
  for(const c of map.values()){
    if(c.x<=left || c.x>=right) continue;
    if(c.role!=='air' && c.role!=='light' && c.role!=='furnishing' && c.role!=='stairs' && c.role!=='door') continue;
    bgCells.push({x:c.x,y:c.y,t:pal.backwall,structural:false,role:'backwall',layer:'bg'});
  }
  return {layout:L,cells:[...map.values(),...bgCells]};
}
// Back-wall cells live on the world's construction-background layer, not in the
// foreground tile grid; place them through MM.world when it is available (the
// headless sims run without it and simply skip the cosmetic layer).
function placeHouseBackground(cells){
  let placed=0;
  try{
    const w=runtimeRoot().MM && runtimeRoot().MM.world;
    if(!w || !w.setConstructionBackground || !w.getConstructionBackground) return {placed:0,complete:true};
    for(const c of cells){
      if(c.layer!=='bg') continue;
      let current=T.AIR;
      try{ current=w.getConstructionBackground(c.x,c.y); }catch(e){ return {placed,complete:false}; }
      if(current===c.t) continue;
      if(current!==T.AIR) continue; // a player's different background is respected
      try{ w.setConstructionBackground(c.x,c.y,c.t); }catch(e){}
      try{
        if(w.getConstructionBackground(c.x,c.y)!==c.t) return {placed,complete:false};
        placed++;
      }catch(e){ return {placed,complete:false}; }
    }
  }catch(e){}
  return {placed,complete:true};
}
const HOUSE_PRESERVE_TILES=new Set([
  T.TORCH,T.GRAVE,T.WIRE,T.COPPER_WIRE,T.SILVER_WIRE,T.WATER_PIPE,T.LADDER,T.BEDROCK_LADDER,
  T.CHIMNEY,T.TRACK,T.RESPAWN_TOTEM
]);
function houseWorldLayers(){
  try{ return runtimeRoot().MM && runtimeRoot().MM.world || null; }catch(e){ return null; }
}
function houseFallingApi(){
  try{ return runtimeRoot().MM && runtimeRoot().MM.fallingSolids || null; }catch(e){ return null; }
}
function houseCellOverlapsPlayer(c,player){
  if(!player || c.layer==='bg' || c.t===T.AIR || !finite(player.x) || !finite(player.y)) return false;
  const w=Number.isFinite(player.w)?Math.max(0.2,player.w):0.8;
  const h=Number.isFinite(player.h)?Math.max(0.4,player.h):1.8;
  return c.x+1>player.x-w/2 && c.x<player.x+w/2 && c.y+1>player.y-h/2 && c.y<player.y+h/2;
}
function houseCellBlocked(c,getTile,world,falling,player){
  if(!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || c.y<0 || c.y>=WORLD_H) return true;
  if(houseCellOverlapsPlayer(c,player)) return true;
  try{
    if(falling && typeof falling.isPlayerBuiltAt==='function' && falling.isPlayerBuiltAt(c.x,c.y)) return true;
    if(falling && typeof falling.isProtectedBuild==='function' && falling.isProtectedBuild(c.x,c.y)) return true;
  }catch(e){ return true; }
  try{
    if(world && typeof world.getInfrastructureStack==='function'){
      const stack=world.getInfrastructureStack(c.x,c.y);
      if(Array.isArray(stack) && stack.length) return true;
    }else if(world && typeof world.getInfrastructure==='function' && world.getInfrastructure(c.x,c.y)!==T.AIR) return true;
  }catch(e){ return true; }
  try{
    if(world && typeof world.getPlayerConstructionBackground==='function' && world.getPlayerConstructionBackground(c.x,c.y)!==T.AIR) return true;
  }catch(e){ return true; }
  if(c.layer==='bg') return false;
  let current=T.AIR;
  try{ current=getTile(c.x,c.y); }catch(e){ return true; }
  const info=INFO[current] || {};
  return HOUSE_PRESERVE_TILES.has(current) || isMeteorSettlementSiteTile(current) ||
    !!(info.machine || info.chestTier || info.cache || info.furniture || info.door || info.trapdoor || info.story || info.unmineable);
}
function restoreHouseForeground(rows,setTile,getTile){
  let ok=true;
  for(let i=rows.length-1;i>=0;i--){
    const row=rows[i];
    try{ setTile(row.c.x,row.c.y,row.old); }catch(e){}
    try{ if(getTile(row.c.x,row.c.y)!==row.old) ok=false; }catch(e){ ok=false; }
  }
  return ok;
}
function restoreHouseBackground(rows,world){
  if(!world) return;
  for(let i=rows.length-1;i>=0;i--){
    const row=rows[i];
    try{
      if(row.old===T.AIR && typeof world.clearConstructionBackground==='function') world.clearConstructionBackground(row.c.x,row.c.y);
      else if(typeof world.setConstructionBackground==='function') world.setConstructionBackground(row.c.x,row.c.y,row.old);
    }catch(e){}
  }
}
function buildHouse(candidate,getTile,setTile,worldGen,player){
  const {layout,cells}=houseCells(candidate,getTile,worldGen);
  const world=houseWorldLayers();
  const falling=houseFallingApi();
  // Preflight the complete footprint before the first write. NPC construction
  // may clear natural terrain, but never player buildings, machines, wiring,
  // backgrounds, or another managed structure.
  for(const c of cells) if(houseCellBlocked(c,getTile,world,falling,player)) return false;
  const foreground=[];
  for(const c of cells){
    if(c.layer==='bg') continue;
    let old=T.AIR;
    try{ old=getTile(c.x,c.y); }catch(e){ restoreHouseForeground(foreground,setTile,getTile); return false; }
    foreground.push({c,old});
    try{ setTile(c.x,c.y,c.t); }catch(e){}
    let written=false;
    try{ written=getTile(c.x,c.y)===c.t; }catch(e){ written=false; }
    if(!written){ restoreHouseForeground(foreground,setTile,getTile); return false; }
  }
  const backgrounds=[];
  if(world && typeof world.setConstructionBackground==='function' && typeof world.getConstructionBackground==='function'){
    for(const c of cells){
      if(c.layer!=='bg') continue;
      let old=T.AIR, written=false;
      try{
        old=world.getConstructionBackground(c.x,c.y);
        backgrounds.push({c,old});
        world.setConstructionBackground(c.x,c.y,c.t);
        written=world.getConstructionBackground(c.x,c.y)===c.t;
      }catch(e){ written=false; }
      if(!written){
        restoreHouseBackground(backgrounds,world);
        restoreHouseForeground(foreground,setTile,getTile);
        return false;
      }
    }
  }
  // Verify the build actually took. In headless/Node simulations setTile is a no-op,
  // so the roof apex reads back as AIR — we then treat the house as non-physical and
  // skip destruction auditing, leaving the pure NPC lifecycle untouched.
  let physical=false;
  try{ physical=getTile(layout.cx,layout.apexY)===layout.pal.roof; }catch(e){ physical=false; }
  if(!physical){
    restoreHouseBackground(backgrounds,world);
    restoreHouseForeground(foreground,setTile,getTile);
    return false;
  }
  protectHouse(cells);
  return physical;
}
function migrateHouseDoors(candidate,getTile,setTile,worldGen){
  const {cells}=houseCells(candidate,getTile,worldGen);
  let changed=false, complete=true;
  for(const c of cells){
    if(c.role!=='door') continue;
    let cur=T.AIR;
    try{ cur=getTile(c.x,c.y); }catch(e){ cur=T.AIR; }
    if(cur===c.t) continue;
    if(cur!==T.AIR && cur!==T.WATER && cur!==T.LAVA) continue;
    try{ setTile(c.x,c.y,c.t); }catch(e){}
    try{
      if(getTile(c.x,c.y)===c.t) changed=true;
      else complete=false;
    }catch(e){ complete=false; }
  }
  if(changed) protectHouse(cells);
  return {changed,complete};
}
function migrateHouseFurnishings(candidate,getTile,setTile,worldGen){
  const {layout,cells}=houseCells(candidate,getTile,worldGen);
  let changed=false, complete=true;
  const legacyX=layout.doorX>layout.cx?layout.left+2:layout.right-2;
  const legacyTile=layout.pal.accent===T.STEEL?T.STONE:layout.pal.accent;
  for(const c of cells){
    if(c.role!=='furnishing') continue;
    let cur=T.AIR;
    try{ cur=getTile(c.x,c.y); }catch(e){ continue; }
    if(cur===c.t || isFurnishingTile(cur)) continue;
    // Empty slots and the exact pre-catalogue placeholder are safe to upgrade;
    // every other player-built replacement is respected.
    const oldPlaceholder=c.x===legacyX && c.y===layout.g-1 && cur===legacyTile;
    if(cur!==T.AIR && !oldPlaceholder) continue;
    try{ setTile(c.x,c.y,c.t); }catch(e){}
    try{
      if(getTile(c.x,c.y)===c.t) changed=true;
      else complete=false;
    }catch(e){ complete=false; }
  }
  if(changed) protectHouse(cells);
  return {changed,complete};
}
// Hand the placed tiles to the falling engine's protected set so no collapse, sand
// slump, or glass shatter simulation can touch them. Idempotent — safe to re-run
// every scan (and after a save reload) to guarantee protection survives.
function protectHouse(cells){
  try{
    const fs=runtimeRoot().MM && runtimeRoot().MM.fallingSolids;
    if(fs && fs.protectStructure) fs.protectStructure(cells.filter(c=>c.t!==T.AIR && c.layer!=='bg'));
  }catch(e){}
}
function houseIntegrity(candidate,getTile,worldGen){
  const {cells}=houseCells(candidate,getTile,worldGen);
  let total=0, intact=0;
  for(const c of cells){
    if(!c.structural) continue;
    total++;
    let cur=T.AIR;
    try{ cur=getTile(c.x,c.y); }catch(e){ cur=T.AIR; }
    if(cur===c.t) intact++;
  }
  return total>0 ? intact/total : 1;
}
function buildCandidate(base,cycle){
  if(!base) return null;
  // A candidate can be inspected without becoming a persistent resident.
  // Callers that actually build, retire or alter a house explicitly promote it
  // through localStateFor().
  const state=localStates.get(base.id) || cleanLocalState(null);
  const jobCycle=Math.max(0,Number.isFinite(cycle)?cycle:state.cycle|0);
  const job=jobFor(base.biome,base.seed,base.cell,jobCycle);
  const candidate={
    id:base.id,
    seed:base.seed,
    cell:base.cell,
    x:base.x,
    biome:base.biome,
    cycle:jobCycle,
    state,
    home:homeFor(base),
    role:job.role,
    job,
    lore:job.lore,
    whisper:loreWhisperFor(base.seed,base.cell),
    moral:job.moral,
    prompt:job.role+': '+job.lore+' Przynies '+job.cost.amount+' x '+job.cost.label+'. Nagroda: '+rewardText(job)+'.',
    missing:job.missing+' Potrzebuje '+job.cost.amount+' x '+job.cost.label+'.',
    complete:job.complete
  };
  return candidate;
}
function candidateForCell(cell,worldGen,cycle){
  return buildCandidate(baseCandidateForCell(cell,worldGen),cycle);
}
function homeGroundY(x,getTile,worldGen){
  const tx=Math.round(x);
  try{
    if(worldGen && typeof worldGen.surfaceHeight==='function') return Math.round(worldGen.surfaceHeight(tx));
  }catch(e){}
  if(typeof getTile==='function'){
    for(let y=2; y<WORLD_H-1; y++){
      const t=getTile(tx,y);
      if(t!==T.AIR && t!==T.WATER) return y;
    }
  }
  return 60;
}
// The house itself is now real tiles drawn by the world renderer. This overlay only
// adds living-world ambiance keyed to the resident's state: chimney smoke while the
// home is occupied (so the player can spot abandonment — destroy the house and the
// smoke stops), and a warm welcome glow when a resting resident is due back.
function drawHomeAmbiance(ctx,TILE,candidate,life,canDrawTile,getTile,worldGen){
  if(!ctx || !candidate || !candidate.home || !life || !life.housePhysical) return;
  const L=houseLayout(candidate,getTile,worldGen);
  if(typeof canDrawTile==='function' && !canDrawTile(L.cx,L.apexY)) return;
  const apexX=(L.cx+0.5)*TILE;
  const apexY=L.apexY*TILE;
  ctx.save();
  if(life.abandoned){
    // A cold, empty home: a faint cross of boarding over the apex, no smoke.
    ctx.strokeStyle='rgba(60,50,40,0.5)';
    ctx.lineWidth=1.4;
    ctx.beginPath();
    ctx.moveTo(apexX-TILE*0.3,apexY-TILE*0.1); ctx.lineTo(apexX+TILE*0.3,apexY+TILE*0.3);
    ctx.moveTo(apexX+TILE*0.3,apexY-TILE*0.1); ctx.lineTo(apexX-TILE*0.3,apexY+TILE*0.3);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Occupied home → smoke rising from the actual chimney stack (or roof vent).
  const chimneyX=((Number.isFinite(L.chimneyX)?L.chimneyX:L.right)+0.5)*TILE;
  const chimneyTop=((Number.isFinite(L.chimneyTopY)?L.chimneyTopY:L.roofY)-0.4)*TILE;
  const t=Date.now()*0.001+candidate.cell;
  for(let i=0;i<3;i++){
    const ph=(t*0.6+i*0.9)%1;
    ctx.fillStyle='rgba(228,231,223,'+(0.16*(1-ph)).toFixed(3)+')';
    ctx.beginPath();
    ctx.arc(chimneyX+Math.sin((t+i)*2)*TILE*0.16, chimneyTop-ph*TILE*1.7, TILE*(0.10+ph*0.16),0,Math.PI*2);
    ctx.fill();
  }
  // A resting resident who is due back gets a soft welcome halo over the doorway.
  if(life.hidden && Number(life.availableDay||0)<=currentDay()){
    const doorX=(L.doorX+0.5)*TILE;
    const doorY=(L.g-1)*TILE;
    const glow=0.5+0.5*Math.sin(t*3);
    ctx.strokeStyle='rgba(255,236,150,'+(0.4+glow*0.4).toFixed(3)+')';
    ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(doorX,doorY,TILE*0.5,0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}
function definitionFor(candidate){
  const job=candidate.job;
  const jobData={
    generated:true,
    biome:candidate.biome,
    biomeName:biomeName(candidate.biome),
    cell:candidate.cell,
    role:job.role,
    lore:job.lore,
    whisper:candidate.whisper || '',
    moral:job.moral,
    cycle:candidate.cycle,
    completedJobs:candidate.state && candidate.state.completedJobs || 0,
    home:Object.assign({},candidate.home),
    color:job.color,
    accent:job.accent,
    cost:Object.assign({},job.cost),
    reward:Object.assign({},job.reward)
  };
  return {
    id:candidate.id,
    displayName:job.role,
    maxHp:18,
    interactR:2.5,
    bubbleR:12,
    spawn:{x:candidate.x},
    spawnOffsets:[0,4,-4,8,-8,14,-14,22,-22,34,-34],
    initialData:jobData,
    steps:[
      {
        id:'job',
        kind:'handoff',
        item:job.cost.item,
        amount:job.cost.amount,
        next:'done',
        prompt:[
          candidate.prompt,
          job.role+': '+job.moral+' Przynies '+job.cost.amount+' x '+job.cost.label+'.',
          job.role+': '+job.missing+' Nagroda: '+rewardText(job)+'.',
          candidate.whisper ? job.role+': '+candidate.whisper : ''
        ],
        missing:candidate.missing,
        complete:candidate.complete,
        reward:{
          once:'job',
          resources:job.reward,
          next:'done',
          data:jobData,
          message:job.role+' zakonczyl zlecenie: '+rewardText(job)+'.',
          line:'Dobra robota. '+candidate.complete,
          lineT:5
        }
      },
      {
        id:'done',
        kind:'done',
        prompt:[
          job.role+': '+job.lore,
          job.role+': '+job.moral,
          job.role+': '+job.complete,
          candidate.whisper ? job.role+': '+candidate.whisper : ''
        ]
      }
    ],
    debug(state){
      return {
        generated:true,
        cell:candidate.cell,
        biome:candidate.biome,
        biomeName:biomeName(candidate.biome),
        role:job.role,
        lore:job.lore,
        whisper:candidate.whisper || '',
        moral:job.moral,
        cycle:candidate.cycle,
        completedJobs:candidate.state && candidate.state.completedJobs || 0,
        availableDay:candidate.state && candidate.state.availableDay || 0,
        home:Object.assign({},candidate.home),
        jobCost:Object.assign({},job.cost),
        jobReward:Object.assign({},job.reward),
        data:Object.assign({},state.data)
      };
    }
  };
}
function clearGenerated(){
  createdIds.forEach(id=>{ try{ npcRegistry.unregister(id); }catch(e){} });
  createdIds.clear();
  createdCandidates.clear();
}
function ensureSeed(worldGen){
  const seed=cleanSeed(worldGen);
  if(activeSeed===seed) return;
  clearGenerated();
  candidateCache.clear();
  localStates.clear();
  activeSeed=seed;
}
function materialize(candidate,getTile,worldGen,ctx){
  if(!candidate || createdIds.has(candidate.id)) return npcRegistry.get(candidate.id);
  if(!candidateAvailable(candidate,currentDay(ctx))) return null;
  const lifecycle=localStateFor(candidate.id);
  if(!lifecycle) return null;
  candidate.state=lifecycle;
  const npc=createQuestNpc(definitionFor(candidate));
  createdIds.add(candidate.id);
  createdCandidates.set(candidate.id,candidate);
  if(ctx && npc.setContext) npc.setContext(ctx);
  try{ npc.placeNearWorldStart(getTile,worldGen); }catch(e){}
  return npc;
}
function markChanged(ctx){
  try{ if(ctx && typeof ctx.onChange==='function') ctx.onChange(); }catch(e){}
}
function announce(text){
  try{ const root=runtimeRoot(); if(text && typeof root.msg==='function') root.msg(text); }catch(e){}
}
function abandonResident(candidate,state,ctx){
  if(state.abandoned) return;
  state.abandoned=true;
  if(createdIds.has(candidate.id)){
    try{ npcRegistry.unregister(candidate.id); }catch(e){}
    createdIds.delete(candidate.id);
    createdCandidates.delete(candidate.id);
  }
  announce(candidate.role+' porzuca zniszczony dom i nie wroci, dopoki go nie odbudujesz.');
  markChanged(ctx);
}
function reoccupyResident(candidate,state,day,ctx){
  if(!state.abandoned) return;
  state.abandoned=false;
  // Reward the rebuild by letting the resident move back in straight away.
  state.hidden=false;
  if(state.availableDay>day) state.availableDay=day;
  announce(candidate.role+' wraca do odbudowanego domu.');
  markChanged(ctx);
}
// Build pending houses near the player and police existing ones for player damage.
function maintainHouses(player,getTile,setTile,worldGen,ctx,day){
  if(!player || !finite(player.x) || typeof setTile!=='function') return;
  const px=player.x;
  candidateCache.forEach(base=>{
    if(!base) return;
    // homeFor() drifts at most four tiles from the deterministic base anchor.
    if(Math.abs(base.x-px)>HOUSE_BUILD_RADIUS+6) return;
    const candidate=buildCandidate(base);
    if(!candidate || !candidate.home) return;
    if(Math.abs(candidate.home.x-px)>HOUSE_BUILD_RADIUS) return;
    const state=localStateFor(candidate.id);
    if(!state) return;
    if((!state.houseBuilt || !state.housePhysical) && !state.abandoned){
      const now=Date.now();
      if(Number.isFinite(state._houseRetryAt) && now<state._houseRetryAt) return;
      const physical=buildHouse(candidate,getTile,setTile,worldGen,player);
      state.houseBuilt=physical;
      state.housePhysical=physical;
      state.houseDoorsMigrated=physical;
      state.houseBackwallDone=physical;
      state.houseFurnishingsDone=physical;
      if(physical){ delete state._houseRetryAt; markChanged(ctx); }
      else state._houseRetryAt=now+5000;
    }
    if(!state.houseBuilt || !state.housePhysical) return;
    if(!state.houseDoorsMigrated){
      const result=migrateHouseDoors(candidate,getTile,setTile,worldGen);
      state.houseDoorsMigrated=!!result.complete;
      if(result.changed) markChanged(ctx);
    }
    if(!state.houseFurnishingsDone){
      const result=migrateHouseFurnishings(candidate,getTile,setTile,worldGen);
      state.houseFurnishingsDone=!!result.complete;
      if(result.changed) markChanged(ctx);
    }
    const {cells}=houseCells(candidate,getTile,worldGen);
    // Houses from saves that predate interior back walls get them retrofitted once.
    if(!state.houseBackwallDone){
      const result=placeHouseBackground(cells);
      state.houseBackwallDone=!!result.complete;
      if(result.placed>0) markChanged(ctx);
    }
    // Re-assert protection every scan so it survives save reloads and chunk reloads.
    if(!state.abandoned) protectHouse(cells);
    let total=0, intact=0;
    for(const c of cells){
      if(!c.structural) continue;
      total++;
      let cur=T.AIR; try{ cur=getTile(c.x,c.y); }catch(e){ cur=T.AIR; }
      if(cur===c.t) intact++;
    }
    const integrity=total>0 ? intact/total : 1;
    if(!state.abandoned){
      if(integrity<1-HOUSE_DESTROY_LIMIT) abandonResident(candidate,state,ctx);
    } else if(integrity>=HOUSE_REBUILD_MIN){
      reoccupyResident(candidate,state,day,ctx);
    }
  });
}
function retireCompleted(day,ctx){
  let retired=0;
  Array.from(createdIds).forEach(id=>{
    const npc=npcRegistry.get(id);
    if(!npc || !npc.summary) return;
    const summary=npc.summary();
    if(!summary || summary.status!=='completed') return;
    const candidate=createdCandidates.get(id);
    const state=localStateFor(id);
    if(!state) return;
    if(state.hidden) return;
    const seed=candidate && Number.isFinite(candidate.seed) ? candidate.seed : activeSeed;
    const cell=candidate && Number.isFinite(candidate.cell) ? candidate.cell : state.cell || 0;
    state.completedJobs=Math.min(STATE_COUNTER_CAP,state.completedJobs+1);
    state.completedDay=Math.min(STATE_DAY_CAP,day);
    state.lastRole=summary.role || summary.name || '';
    state.cycle=Math.min(STATE_COUNTER_CAP,state.cycle+1);
    state.availableDay=Math.min(STATE_DAY_CAP,day+returnDelayDays(seed,cell,state.cycle));
    state.hidden=true;
    try{ npcRegistry.unregister(id); }catch(e){}
    createdIds.delete(id);
    createdCandidates.delete(id);
    retired++;
  });
  if(retired>0) markChanged(ctx);
  return retired;
}
function unloadFarGenerated(x){
  if(!finite(x)) return 0;
  let removed=0;
  createdCandidates.forEach((candidate,id)=>{
    if(candidate && finite(candidate.x) && Math.abs(candidate.x-x)<=ACTIVE_UNLOAD_RADIUS) return;
    // Current generated jobs are atomic handoffs. Keep any future multi-stage
    // observe/duel/choice resident alive so unloading cannot erase progress.
    try{
      const npc=npcRegistry.get(id);
      const summary=npc && npc.summary ? npc.summary() : null;
      if(summary && summary.status!=='available' && summary.status!=='ready') return;
    }catch(e){ return; }
    try{ npcRegistry.unregister(id); }catch(e){}
    createdIds.delete(id);
    createdCandidates.delete(id);
    removed++;
  });
  return removed;
}
function ensureAround(x,getTile,worldGen,ctx){
  ensureSeed(worldGen);
  if(!finite(x)) return 0;
  const day=currentDay(ctx);
  const first=Math.floor((x-ACTIVE_RADIUS)/CELL_W);
  const last=Math.floor((x+ACTIVE_RADIUS)/CELL_W);
  let made=0;
  for(let cell=first; cell<=last; cell++){
    const c=candidateForCell(cell,worldGen);
    if(!c) continue;
    if(Math.abs(c.x-x)>ACTIVE_RADIUS) continue;
    if(!candidateAvailable(c,day)) continue;
    if(!npcRegistry.get(c.id)){
      if(materialize(c,getTile,worldGen,ctx)) made++;
    }
  }
  return made;
}
function primeCandidatesAround(x,worldGen){
  ensureSeed(worldGen);
  if(!finite(x)) return;
  const first=Math.floor((x-ACTIVE_RADIUS)/CELL_W);
  const last=Math.floor((x+ACTIVE_RADIUS)/CELL_W);
  for(let cell=first;cell<=last;cell++) baseCandidateForCell(cell,worldGen);
}
function findNext(x,dir,worldGen,maxCells){
  ensureSeed(worldGen);
  if(!finite(x)) return null;
  const day=currentDay();
  const step=dir<0 ? -1 : 1;
  const start=Math.floor(x/CELL_W);
  const limit=Math.max(12,Math.min(360,Math.round(Number(maxCells)||180)));
  const seen=new Set();
  for(let i=0; i<=limit; i++){
    const cell=start+step*i;
    if(seen.has(cell)) continue;
    seen.add(cell);
    const candidate=candidateForCell(cell,worldGen);
    if(!candidate) continue;
    if(!candidateAvailable(candidate,day)) continue;
    if(step>0 && candidate.x<=x+3) continue;
    if(step<0 && candidate.x>=x-3) continue;
    return candidate;
  }
  return null;
}
function update(dt,player,getTile,setTile,ctx){
  const worldGen=(ctx && ctx.worldGen) || (globalThis.MM && globalThis.MM.worldGen) || null;
  const day=currentDay(ctx);
  retireCompleted(day,ctx);
  scanT-=Math.max(0,Number(dt)||0);
  if(scanT>0) return;
  scanT=0.9;
  unloadFarGenerated(player && player.x);
  primeCandidatesAround(player && player.x,worldGen);
  maintainHouses(player, getTile, setTile, worldGen, ctx, day);
  ensureAround(player && player.x, getTile, worldGen, ctx);
}
function draw(ctx,TILE,canDrawTile,getTile,worldGen,sx,sy,viewX,viewY){
  const day=currentDay();
  const viewport=finite(sx)&&finite(viewX) ? {left:sx-16,right:sx+viewX+16} : null;
  candidateCache.forEach(base=>{
    // No local state means no physical house and therefore no ambiance to draw.
    // Avoid manufacturing state entries just because a cached cell was inspected.
    if(!base || !localStates.has(base.id)) return;
    if(viewport && (base.x<viewport.left || base.x>viewport.right)) return;
    const candidate=buildCandidate(base);
    if(!candidate) return;
    const life=candidate.state;
    if(life.hidden && life.availableDay<=day && !life.abandoned) life.hidden=false;
    drawHomeAmbiance(ctx,TILE,candidate,life,canDrawTile,getTile,worldGen);
  });
}
function reset(){
  clearGenerated();
  candidateCache.clear();
  localStates.clear();
  activeSeed=null;
  scanT=0;
}
function snapshot(){
  const locals=[];
  for(const [id,state] of localStates){
    if(locals.length>=LOCAL_STATE_SAVE_CAP) break;
    if(!state.hidden && !state.completedJobs && !state.cycle && !state.houseBuilt && !state.abandoned) continue;
    const cleanId=cleanLocalId(id);
    if(cleanId) locals.push(Object.assign({id:cleanId},cleanLocalState(state)));
  }
  return {v:2, seed:activeSeed, ids:Array.from(createdIds).slice(0,LOCAL_STATE_SAVE_CAP), locals};
}
function restore(data){
  localStates.clear();
  const restoredSeed=data && Number.isFinite(data.seed) ? data.seed|0 : activeSeed;
  if(data && Array.isArray(data.locals)){
    const count=Math.min(data.locals.length,LOCAL_STATE_RESTORE_SCAN_CAP);
    for(let i=0;i<count;i++){
      if(localStates.size>=LOCAL_STATE_SAVE_CAP) break;
      const entry=data.locals[i];
      if(!entry || typeof entry!=='object') continue;
      const id=cleanLocalId(entry.id,restoredSeed);
      if(!id) continue;
      localStates.set(id,cleanLocalState(entry));
    }
  }
  activeSeed=restoredSeed;
  scanT=0;
  return true;
}
function debug(){
  const locals=[];
  for(const [id,state] of localStates){
    if(locals.length>=LOCAL_STATE_SAVE_CAP) break;
    locals.push(Object.assign({id},cleanLocalState(state)));
  }
  return {activeSeed, created:Array.from(createdIds), locals, cacheSize:candidateCache.size, cellW:CELL_W, radius:ACTIVE_RADIUS, returnDays:{min:RETURN_DAYS_MIN,max:RETURN_DAYS_MAX}, limits:{candidateCache:CANDIDATE_CACHE_CAP,localStates:LOCAL_STATE_SAVE_CAP,activeUnloadRadius:ACTIVE_UNLOAD_RADIUS}, jobs:jobCatalogStats()};
}

const generatedNpcs={update, draw, reset, snapshot, restore, ensureAround, findNext, _debug:debug, _candidateForCell:candidateForCell, _jobCatalogStats:jobCatalogStats, _houseCells:houseCells, _houseLayout:houseLayout, _houseIntegrity:houseIntegrity};
try{
  const root=(typeof window!=='undefined') ? window : globalThis;
  root.MM=root.MM||{};
  root.MM.generatedNpcs=generatedNpcs;
}catch(e){}

export { generatedNpcs };
export default generatedNpcs;
