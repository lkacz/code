// Physical ground loot: slain creatures shed collectible pickups that fall,
// bounce and lie in the world instead of teleporting into the inventory.
//
// Two payload kinds share one entity list:
//   * resource drops ({res,qty}) — meat scraps, trophy parts, spec.loot rolls;
//     picked up they add straight into the block inventory (window.inv).
//   * gear drops ({item}) — procedural equipment from THEMED species (a bat can
//     shed a cape, an owl its eyes, a skeleton its blade); picked up they ride
//     the chest-loot pipeline (MM.dynamicLoot -> bag + loot inbox popup).
//
// Pickup contract: E sweeps everything in reach (the wardrobe/mech E
// precedence asks wantsInteractKey first); the persisted auto-pickup toggle
// (pause panel) vacuums drops instead — the default is ON only for touch mode,
// which has no E key. Rarity is a visible promise AND a ticking bomb: rare/epic
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
  // Ticking bomb: the better the find, the faster it burns out. Rare+ gear
  // shows a countdown bar; the final seconds of an epic tick audibly.
  const GEAR_LIFE={common:150, rare:75, epic:30};
  const GUARDIAN_RELIC_LIFE=120; // one-shot arc trophies get a merciful clock
  const BLINK_SEC=12;           // despawn warning window (capped at 25% of life)
  const GRAVITY=22, TERMINAL=17, BOUNCE=0.34;
  const RADIUS=0.18;            // collision half-extent in tiles
  const PICKUP_RADIUS=1.75;     // manual E reach
  const AUTO_RADIUS=2.35;       // auto-pickup magnet reach
  const MOUSE_HIT=0.55;         // cursor-over-drop hit radius (hover preview)
  const MOUSE_PICKUP_RADIUS=3.0;// click-to-take reach (mirrors cursor mining)
  const COLLECT_DIST=0.55;
  const MAGNET_SPEED=9.5;       // tiles/s toward the hero while vacuumed
  const MERGE_DIST=0.85;        // settled same-resource piles merge
  const POP_VX=3.2, POP_VY_MIN=3.4, POP_VY_MAX=6.8;

  // Mirrors inventory.js TIER_COLORS (single source there is DOM-side; the
  // engine keeps its own copy so Node sims render/spawn without the UI).
  const TIER_COLORS={common:'#b07f2c', rare:'#a74cc9', epic:'#e0b341'};
  const KIND_GLYPH={cape:'🧥', eyes:'👁️', outfit:'👕', weapon:'⚔️', charm:'🔮'};
  const RES_GLYPH={meatScrap:'🍖', fish:'🐟', goldenFish:'🐠', springAntler:'🦌', summerHorn:'🐂', autumnHeartwood:'🌳', winterFur:'🐻'};

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
    JACKPOT_WHALE:{chance:0.50, tiers:T_JACKPOT, options:[{kind:'charm',name:'Serce głębin',desc:'Bije rytmem przypływów.'},{kind:'eyes',name:'Oczy lewiatana',desc:'Widziały dno oceanu. I ciebie.'}]}
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
  // Bad-luck insurance: after this many eligible kills without a gear drop the
  // next one is guaranteed and never lands below rare — the wait itself paid.
  const PITY_KILLS=25;
  // Volcano sacrifice: a COMMON gear drop consumed by lava rolls this chance to
  // be flung back out upgraded; every refused offering ratchets the odds.
  const SACRIFICE_BASE=0.01, SACRIFICE_STEP=0.0025, SACRIFICE_MAX=0.05;
  const SACRIFICE_EPIC_CHANCE=0.15;

  const list=[];
  let seq=1;
  let dry=0; // eligible kills since the last gear drop (persisted in snapshot)
  let sacrificeDry=0; // refused volcano offerings since the last gift (persisted)
  let rand=Math.random; // _debug.setRandom swaps in a scripted queue for tests
  let autoPref=null;    // null = no explicit choice: touch defaults ON, PC OFF
  try{
    const raw=(typeof localStorage!=='undefined') ? localStorage.getItem(AUTO_KEY) : null;
    if(raw==='1') autoPref=true; else if(raw==='0') autoPref=false;
  }catch(e){ /* headless */ }

  const WORLD_TOP=Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM=Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : 400;
  const finiteNum=v=>typeof v==='number' && isFinite(v);

  function isTouchMode(){
    try{ return typeof document!=='undefined' && document.documentElement && document.documentElement.dataset.inputMode==='touch'; }catch(e){ return false; }
  }
  function autoPickup(){ return autoPref===null ? isTouchMode() : autoPref; }
  function setAutoPickup(on){
    autoPref=!!on;
    try{ if(typeof localStorage!=='undefined') localStorage.setItem(AUTO_KEY, autoPref?'1':'0'); }catch(e){}
    return autoPref;
  }

  function getSafe(getTile,x,y){ try{ return getTile ? getTile(Math.floor(x),Math.floor(y)) : T.AIR; }catch(e){ return T.AIR; } }
  function solidAt(getTile,x,y){
    if(y>=WORLD_BOTTOM) return true;
    if(y<WORLD_TOP) return false;
    return isSolidCollisionTile(getSafe(getTile,x,y));
  }

  function tierRank(t){ return t==='epic'?2 : t==='rare'?1 : 0; }
  function evictForRoom(){
    if(list.length<MAX_DROPS) return true;
    // Oldest, least precious first: resources before gear, low tiers before high
    let worst=-1, worstScore=Infinity;
    for(let i=0;i<list.length;i++){
      const d=list[i];
      const score=(d.kind==='gear'?1000:0)+tierRank(d.tier)*100-d.age*0.01;
      if(score<worstScore){ worstScore=score; worst=i; }
    }
    if(worst<0) return false;
    list.splice(worst,1);
    return true;
  }

  function makeDrop(x,y,fields,opts){
    if(!finiteNum(x) || !finiteNum(y)) return null;
    if(!evictForRoom()) return null;
    opts=opts||{};
    const d=Object.assign({
      id:seq++,
      x, y:Math.max(WORLD_TOP+1,Math.min(WORLD_BOTTOM-2,y)),
      vx:finiteNum(opts.vx) ? opts.vx : (rand()*2-1)*POP_VX,
      vy:finiteNum(opts.vy) ? opts.vy : -(POP_VY_MIN+rand()*(POP_VY_MAX-POP_VY_MIN)),
      age:0, settled:false, airT:0, spin:(rand()*2-1)*7
    },fields);
    list.push(d);
    return d;
  }

  function spawnResource(x,y,res,qty,opts){
    if(typeof res!=='string' || !res) return null;
    qty=Math.max(1,Math.floor(Number(qty)||1));
    // color/glyph resolved ONCE here — draw() must never scan the resource
    // registry per frame (140 drops × registry find() was a real frame tax)
    return makeDrop(x,y,{kind:'resource', res, qty, tier:'common', life:DESPAWN_SEC, color:resourceColor(res), glyph:RES_GLYPH[res]||null},opts);
  }
  // The moment of the drop IS the dopamine beat: rare+ gear announces itself
  // with a burst and its tier fanfare the instant it leaves the corpse.
  function announceDrop(d){
    if(!d || d.tier==='common') return;
    const px=d.x*(MM.TILE||20), py=d.y*(MM.TILE||20);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(px,py,d.tier); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play(d.tier==='epic'?'golden':'chest',{x:d.x,y:d.y}); }catch(e){}
    if(d.tier==='epic'){
      try{ if(typeof window.msg==='function') window.msg('✨ Coś wyjątkowego upadło na ziemię!'); }catch(e){}
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('epic_drop','Epicki łup ogłasza się słupem światła — nie da się go przegapić!'); }catch(e){}
    }
  }
  function spawnGear(x,y,item,opts){
    if(!item || typeof item!=='object' || typeof item.id!=='string') return null;
    const tier=(item.tier==='rare'||item.tier==='epic') ? item.tier : 'common';
    const d=makeDrop(x,y,{kind:'gear', item:Object.assign({},item), qty:1, tier, life:GEAR_LIFE[tier]||GEAR_LIFE.common},opts);
    if(d && (!opts || opts.announce!==false)) announceDrop(d);
    return d;
  }

  function rollTier(tiers,danger){
    let c=Math.max(0,Number(tiers && tiers.common)||0);
    let r=Math.max(0,Number(tiers && tiers.rare)||0);
    let e=Math.max(0,Number(tiers && tiers.epic)||0);
    // Hostile lands promise better finds: rare/epic weights swell with danger
    // while common stays flat, so the far east/west visibly pays out.
    const d=Math.max(0,Math.min(1,Number(danger)||0));
    if(d>0){ r*=1+2.2*d; e*=1+5*d; }
    const total=c+r+e;
    if(!(total>0)) return 'common';
    let roll=rand()*total;
    if((roll-=c)<0) return 'common';
    if((roll-=r)<0) return 'rare';
    return 'epic';
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
  function makeGearId(kind,tag){
    return kind+'_drop_'+String(tag||'x').toLowerCase()+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  }
  function genThemedItem(def,tier,extra){
    const chests=MM.chests;
    if(!def || !chests || typeof chests.genItem!=='function') return null;
    let item=null;
    try{ item=chests.genItem(()=>rand(), tier, Object.assign({kind:def.kind, weaponType:def.weaponType},extra)); }catch(e){ return null; }
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
    const chance=Math.min(0.9, table.chance*(1+0.8*danger));
    const pity=dry>=PITY_KILLS;
    if(!pity && !(rand()<=chance)){ dry++; return null; }
    const options=Array.isArray(table.options)&&table.options.length ? table.options : [{kind:'charm'}];
    const def=options[Math.min(options.length-1,Math.floor(rand()*options.length))];
    let tier=rollTier(table.tiers, pity ? Math.min(1,danger+0.35) : danger);
    if(pity && tier==='common') tier='rare';
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
    const tier=rand()<SIDEKICK_EPIC_CHANCE ? 'epic' : 'rare';
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
  function collectResource(d,silent){
    const inv=window.inv;
    if(!inv || typeof inv!=='object') return false;
    inv[d.res]=(Number(inv[d.res])||0)+d.qty;
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
    if(d.source){
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('mob_gear','Pokonane stwory gubią swoje rzemiosło — każdy nosi coś swojego!'); }catch(e){}
    }
    return true;
  }
  function collect(d,opts){
    const silent=!!(opts && opts.silent);
    const ok=d.kind==='gear' ? collectGear(d) : collectResource(d,silent);
    if(!ok) return false;
    const idx=list.indexOf(d);
    if(idx>=0) list.splice(idx,1);
    // snatching an epic is a rush — a short euphoria buff makes the body agree
    if(d.kind==='gear' && d.tier==='epic'){
      try{ if(MM.progress && MM.progress.addBuff) MM.progress.addBuff({name:'Euforia', icon:'✨', dur:12, stats:{moveSpeedMult:1.15, jumpPowerMult:1.1}}); }catch(e){}
    }
    const px=d.x*(MM.TILE||20), py=d.y*(MM.TILE||20);
    try{
      if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(px,py,d.tier==='common'?'hit':d.tier);
    }catch(e){}
    if(!silent){
      try{
        if(MM.audio && MM.audio.play){
          const snd=d.tier==='epic' ? 'golden' : d.tier==='rare' ? 'chest' : 'harvest';
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
    const gains=[]; let best='common', any=false;
    for(const d of grabbed){
      const wasResource=d.kind==='resource';
      if(!collect(d,{silent:true})) continue;
      any=true;
      if(tierRank(d.tier)>tierRank(best)) best=d.tier;
      if(wasResource) gains.push(resourceLabel(d.res)+' ×'+d.qty);
    }
    if(!any) return false;
    if(gains.length){
      try{ if(typeof window.msg==='function') window.msg('Podniesiono: '+gains.join(', ')); }catch(e){}
    }
    try{
      if(MM.audio && MM.audio.play){
        MM.audio.play(best==='epic'?'golden':best==='rare'?'chest':'harvest',{x:player.x,y:player.y});
      }
    }catch(e){}
    return true;
  }
  // E-precedence probe (inventory_ui): a drop in reach claims the interact key,
  // but only in manual mode — with auto-pickup on, E stays the wardrobe's.
  function wantsInteractKey(player){
    if(autoPickup()) return false;
    return !!nearestInReach(player,PICKUP_RADIUS);
  }

  // --- cursor pickup (PC): hover previews a drop, a click takes exactly it ---
  // opts.visible gates fog: an undiscovered drop neither previews nor grabs.
  let hoverDrop=null; // draw() highlights this one (set fresh each frame by hoverAt)
  function dropAtPoint(wx,wy,opts){
    if(!finiteNum(wx) || !finiteNum(wy)) return null;
    const r2=MOUSE_HIT*MOUSE_HIT;
    let best=null, bestD=Infinity;
    for(const d of list){
      const dx=d.x-wx, dy=d.y-wy;
      const dd=dx*dx+dy*dy;
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
    else { info.res=d.res; info.label=resourceLabel(d.res); info.glyph=d.glyph; info.color=d.color; }
    return info;
  }
  // Selective grab: 'picked' consumed the click, 'far' means walk closer
  // (the caller lets the click fall through to mining/attacking), null = no drop.
  function pickupAt(wx,wy,player,opts){
    const d=dropAtPoint(wx,wy,opts);
    if(!d) return null;
    if(!player || !finiteNum(player.x) || dist2ToPlayer(d,player)>MOUSE_PICKUP_RADIUS*MOUSE_PICKUP_RADIUS) return 'far';
    return collect(d) ? 'picked' : null;
  }

  // --- simulation -----------------------------------------------------------
  function stepPhysics(d,dt,getTile){
    const here=getSafe(getTile,d.x,d.y);
    d._tile=here; // update() reads this for the lava check — no second getTile
    const inWater=here===T.WATER;
    d.airT+=dt;
    d.vy=Math.min(inWater?2.2:TERMINAL, d.vy+(inWater?GRAVITY*0.25:GRAVITY)*dt);
    if(inWater){ d.vx*=Math.max(0,1-3.2*dt); }
    // horizontal step (wall bounce)
    const nx=d.x+d.vx*dt;
    if(d.vx!==0 && solidAt(getTile,nx+Math.sign(d.vx)*RADIUS,d.y)){ d.vx=-d.vx*0.45; }
    else d.x=nx;
    // vertical step (floor bounce / ceiling stop)
    const ny=d.y+d.vy*dt;
    if(d.vy>0 && solidAt(getTile,d.x,ny+RADIUS)){
      d.y=Math.floor(ny+RADIUS)-RADIUS-0.001;
      if(Math.abs(d.vy)<1.5){
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
        d.vy=-d.vy*BOUNCE; d.vx*=0.6;
      }
    } else if(d.vy<0 && solidAt(getTile,d.x,ny-RADIUS)){
      d.vy=0; d.y=ny+ (Math.floor(ny-RADIUS)+1+RADIUS+0.001-ny);
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
  function update(dt,player,getTile){
    if(!(dt>0) || !isFinite(dt)) return;
    dt=Math.min(0.25,dt);
    const auto=autoPickup() && player && finiteNum(player.x);
    for(let i=list.length-1;i>=0;i--){
      const d=list[i];
      d.age+=dt;
      if(d._lavaGraceT>0) d._lavaGraceT-=dt;
      // ticking bomb: the better the find, the shorter its clock (d.life)
      const lifetime=finiteNum(d.life) ? d.life : DESPAWN_SEC;
      if(d.age>=lifetime){ list.splice(i,1); continue; }
      // an epic's final seconds tick audibly — the bomb is heard, not just seen
      if(d.kind==='gear' && d.tier==='epic'){
        const tickLeft=lifetime-d.age;
        if(tickLeft<8){
          const sec=Math.ceil(tickLeft);
          if(sec!==d._tickSec){
            d._tickSec=sec;
            try{ if(MM.audio && MM.audio.play) MM.audio.play('spark',{x:d.x,y:d.y}); }catch(e){}
          }
        }
      }
      if(auto){
        const dd=dist2ToPlayer(d,player);
        if(dd<=COLLECT_DIST*COLLECT_DIST){ collect(d); continue; }
        if(dd<=AUTO_RADIUS*AUTO_RADIUS){
          // vacuum: fly straight at the hero, ignoring terrain (short hop)
          const dist=Math.sqrt(dd)||1;
          d.x+=((player.x-d.x)/dist)*MAGNET_SPEED*dt;
          d.y+=((player.y-0.3-d.y)/dist)*MAGNET_SPEED*dt;
          d.settled=false; d.vx=0; d.vy=0;
          continue;
        }
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
          if(!solidAt(getTile,d.x,d.y+RADIUS+0.05) && !solidAt(getTile,d.x,d.y+1)){
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
    const tier=rand()<SACRIFICE_EPIC_CHANCE ? 'epic' : 'rare';
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
    if(d.tier==='epic') return false;
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
  // Only tier colors ever glow, so the cache stays at four tiny canvases.
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
  function draw(ctx,TILE,camX,camY,zoom,canDrawTile,player){
    if(!ctx || !list.length) return;
    const visible=typeof canDrawTile==='function' ? canDrawTile : null;
    const viewL=camX-2, viewR=camX+(ctx.canvas.width/zoom)/TILE+2;
    const viewT=camY-2, viewB=camY+(ctx.canvas.height/zoom)/TILE+2;
    const now=performance.now();
    const manual=!autoPickup();
    let hint=null;
    if(manual && player && finiteNum(player.x)) hint=nearestInReach(player,PICKUP_RADIUS);
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
      if(left<blinkWin && ((now/160)|0)%2===0) continue; // despawn blink
      const bob=d.settled ? Math.sin(now*0.003+d.id)*0.07 : 0;
      const px=d.x*TILE, py=(d.y+bob)*TILE;
      const tint=d.kind==='gear' ? (TIER_COLORS[d.tier]||TIER_COLORS.common) : (d.color||'#c9a15a');
      // tier halo: the promise of quality reads from across the screen
      if(d.kind==='gear'){
        const halo=haloSprite(TIER_COLORS[d.tier]||TIER_COLORS.common);
        if(halo){
          const pulse=0.65+0.35*Math.sin(now*0.005+d.id);
          const haloR=TILE*(d.tier==='epic'?1.05:d.tier==='rare'?0.85:0.6);
          ctx.globalAlpha=(d.tier==='epic'?0.34:d.tier==='rare'?0.28:0.16)*pulse;
          ctx.drawImage(halo,px-haloR,py-haloR,haloR*2,haloR*2);
          ctx.globalAlpha=1;
        }
      }
      if(d.tier==='epic'){
        // vertical light beam: "something great fell HERE" — tall, breathing,
        // with a slow-orbiting glint so it reads even at the screen's edge
        const beam=beamSprite(TIER_COLORS.epic);
        if(beam){
          const beamH=TILE*3.4, beamW=Math.max(3,TILE*0.24);
          ctx.globalAlpha=0.24+0.12*Math.sin(now*0.004+d.id);
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
      // cursor hover: a breathing ring says "this one previews in the corner"
      if(hoverDrop===d){
        const hr=s*0.95+Math.sin(now*0.008)*1.2;
        ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(px,py,hr,0,Math.PI*2); ctx.stroke();
      }
      // ticking-bomb bar: rare+ gear wears its remaining time on its sleeve
      if(d.kind==='gear' && d.tier!=='common'){
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
    ctx.restore();
  }

  // --- persistence ------------------------------------------------------------
  const ITEM_NUM_FIELDS=['airJumps','visionRadius','moveSpeedMult','jumpPowerMult','mineSpeedMult','waterMoveSpeedMult','attackDamage','fireDps','fireRange','fireCooldown','energyCost','energyCapacityBonus','crushResistBonus'];
  const ITEM_STR_FIELDS=['name','tier','desc','unique','weaponType'];
  const ITEM_KINDS=new Set(['cape','eyes','outfit','weapon','charm']);
  function sanitizeItem(raw){
    if(!raw || typeof raw!=='object') return null;
    if(typeof raw.id!=='string' || !raw.id || raw.id.length>96) return null;
    if(!ITEM_KINDS.has(raw.kind)) return null;
    const it={id:raw.id, kind:raw.kind};
    ITEM_NUM_FIELDS.forEach(f=>{ const v=raw[f]; if(typeof v==='number' && isFinite(v)) it[f]=v; });
    ITEM_STR_FIELDS.forEach(f=>{ const v=raw[f]; if(typeof v==='string' && v.length<=80) it[f]=v; });
    return it;
  }
  function snapshot(){
    return {
      v:1,
      dry:Math.max(0,Math.min(PITY_KILLS,dry)),
      sac:Math.max(0,Math.min(200,sacrificeDry)),
      list:list.slice(0,SNAPSHOT_CAP).map(d=>{
        const out={x:+d.x.toFixed(4), y:+d.y.toFixed(4), kind:d.kind, tier:d.tier, age:+Math.min(9999,d.age).toFixed(2)};
        if(finiteNum(d.life)) out.life=+d.life.toFixed(1);
        if(d.kind==='resource'){ out.res=d.res; out.qty=d.qty; }
        else out.item=Object.assign({},d.item);
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
      const tier=(r.tier==='rare'||r.tier==='epic') ? r.tier : 'common';
      const age=Math.max(0,Math.min(9999,Number(r.age)||0));
      const life=finiteNum(r.life) ? Math.max(5,Math.min(3600,r.life)) : null;
      if(r.kind==='gear'){
        const item=sanitizeItem(r.item);
        if(!item) continue;
        const d=spawnGear(r.x,r.y,item,{vx:0,vy:0,announce:false}); // a reload is not a find
        if(d){ d.tier=tier; d.age=age; if(life!=null) d.life=life; }
      } else if(typeof r.res==='string' && r.res.length<=48){
        const d=spawnResource(r.x,r.y,r.res,r.qty,{vx:0,vy:0});
        if(d){ d.tier=tier; d.age=age; if(life!=null) d.life=life; }
      }
    }
  }
  function reset(){ list.length=0; mergeT=0; dry=0; sacrificeDry=0; hoverDrop=null; }

  const api={
    update,draw,
    spawnResource,spawnGear,rollGearDrop,rollGuardianDrop,
    pickupNearest,wantsInteractKey,hoverAt,pickupAt,
    autoPickup,setAutoPickup,
    snapshot,restore,reset,
    metrics:()=>({active:list.length, autoPickup:autoPickup()}),
    _debug:{list, GEAR_LOOT, GUARDIAN_LOOT, dangerFor, rollTier, setRandom:(fn)=>{ rand=typeof fn==='function'?fn:Math.random; }, collect, nearestInReach,
      dryStreak:()=>dry, setDryStreak:(n)=>{ dry=Math.max(0,Math.floor(Number(n)||0)); },
      sacrificeDry:()=>sacrificeDry,
      config:{MAX_DROPS,DESPAWN_SEC,GEAR_LIFE,GUARDIAN_RELIC_LIFE,PICKUP_RADIUS,AUTO_RADIUS,COLLECT_DIST,MERGE_DIST,MOUSE_HIT,MOUSE_PICKUP_RADIUS,SIDEKICK_DROP_CHANCE,SIDEKICK_EPIC_CHANCE,PITY_KILLS,SACRIFICE_BASE,SACRIFICE_STEP,SACRIFICE_MAX}}
  };
  MM.drops=api;
  return api;
})();

export { drops };
export default drops;
