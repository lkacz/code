// Data-driven home workshop: 32 craftable fixtures, their inventory/recipe
// contract and all procedural canvas art. Keeping those concerns together makes
// the catalogue append-only and lets the recipe book, hot picker and world use
// exactly the same visual source.
import { T, INFO, TILE, HOME_FURNISHING_TILE_SPECS } from '../constants.js';

const RAW = [
  {tileName:'RUSTIC_STOOL',label:'Rustykalny stołek',description:'Prosty stołek z nieheblowanych desek. Mały początek prawdziwego domu.',tier:1,cost:{wood:2},icon:'▥',visual:'rustic_stool',effect:'still'},
  {tileName:'PINE_TABLE',label:'Sosnowy stolik',description:'Lekki stolik z miejscem na kubek, mapę albo kolejną wielką ideę.',tier:1,cost:{wood:4},icon:'▤',visual:'pine_table',effect:'still'},
  {tileName:'WALL_SHELF',label:'Półka ścienna',description:'Niewielka półka, która porządkuje drobiazgi i przełamuje pustą ścianę.',tier:1,cost:{wood:3,stone:1},icon:'▰',visual:'wall_shelf',effect:'still'},
  {tileName:'OAK_CABINET',label:'Dębowa szafka',description:'Ciężka, dwudrzwiowa szafka z mosiężnymi uchwytami i mnóstwem charakteru.',tier:1,cost:{wood:6,steel:1},icon:'▥',visual:'oak_cabinet',effect:'still'},
  {tileName:'COZY_BED',label:'Przytulne łóżko',description:'Miękkie łóżko z grubą narzutą. Sam widok zachęca do odpoczynku.',tier:1,cost:{wood:5,leaf:6},icon:'▱',visual:'cozy_bed',effect:'dream'},
  {tileName:'BOOKCASE',label:'Biblioteczka',description:'Regał pełen barwnych tomów, notatek badacza i historii znalezionych pod ziemią.',tier:1,cost:{wood:7,leaf:2},icon:'▥',visual:'bookcase',effect:'still'},
  {tileName:'PATCHWORK_SOFA',label:'Sofa patchworkowa',description:'Głęboka kanapa zszyta z kolorowych materiałów. Każda łata ma własną opowieść.',tier:1,cost:{wood:5,leaf:7},icon:'▰',visual:'patchwork_sofa',effect:'still'},
  {tileName:'HAMMOCK',label:'Hamak podróżnika',description:'Płócienny hamak rozpięty między solidnymi słupkami. Odpoczynek bez pośpiechu.',tier:1,cost:{wood:4,grass:7},icon:'⌣',visual:'hammock',effect:'float'},

  {tileName:'WOVEN_RUG',label:'Tkany dywan',description:'Ciepły dywan z geometrycznym wzorem, który natychmiast scala całe wnętrze.',tier:1,cost:{grass:7,leaf:2},icon:'◆',visual:'woven_rug',effect:'still'},
  {tileName:'POTTED_FERN',label:'Paproć w donicy',description:'Żywa zieleń w glinianej donicy. Mały fragment lasu przeniesiony do domu.',tier:1,cost:{clay:2,dirt:2,leaf:4},icon:'♧',visual:'potted_fern',effect:'plant'},
  {tileName:'WALL_CLOCK',label:'Zegar wahadłowy',description:'Cichy zegar z mosiężnym wahadłem. Odmierza spokojniejsze chwile między wyprawami.',tier:1,cost:{wood:3,gold:1},icon:'◷',visual:'wall_clock',effect:'clock',sound:'homeTick'},
  {tileName:'AQUARIUM',label:'Akwarium księżycowe',description:'Podświetlony zbiornik z drobnymi rybami, bąbelkami i falującymi roślinami.',tier:2,cost:{glass:5,water:4,steel:1},icon:'≈',visual:'aquarium',effect:'water',sound:'homeWater'},
  {tileName:'TERRARIUM',label:'Terrarium świetlików',description:'Szklany mikroświat z mchem, pędami i łagodnie migoczącymi świetlikami.',tier:2,cost:{glass:4,dirt:2,leaf:4,glowshroom:1},icon:'⌂',visual:'terrarium',effect:'plant'},
  {tileName:'CHANDELIER',label:'Żyrandol gwiezdny',description:'Rozgałęziony żyrandol rozrzucający po suficie ciepłe punkty światła.',tier:2,cost:{gold:2,glass:3,torch:2},icon:'✦',visual:'chandelier',effect:'light'},
  {tileName:'INDOOR_FOUNTAIN',label:'Fontanna domowa',description:'Kaskadowa fontanna o uspokajającym szumie i połyskującej tafli.',tier:2,cost:{stone:7,water:5,gold:1},icon:'♒',visual:'indoor_fountain',effect:'water',sound:'homeWater'},
  {tileName:'HOLOGRAM_ART',label:'Hologram zmiennokształtny',description:'Świetlna rzeźba, która nigdy nie przyjmuje dwa razy dokładnie tej samej formy.',tier:2,cost:{glass:3,transistor:2,copperWire:2,meteorDust:1},icon:'◇',visual:'hologram_art',effect:'holo',sound:'homeHum'},

  {tileName:'DESK_LAMP',label:'Lampa kreślarska',description:'Regulowana lampa do planów, map i nocnych projektów technicznych.',tier:2,cost:{steel:1,glass:1,copperWire:1,torch:1},icon:'◒',visual:'desk_lamp',effect:'light'},
  {tileName:'RADIO',label:'Radio dalekiego zasięgu',description:'Domowy odbiornik z sześcioma proceduralnymi stacjami: od lo-fi i jazzu po synthwave, folk, ambient i chiptune.',tier:2,cost:{wood:2,copperWire:2,transistor:1},icon:'▣',visual:'radio',effect:'radio'},
  {tileName:'TELEVISION',label:'Telewizor panoramiczny',description:'Ekran z własnym, proceduralnym programem. Nawet szum wygląda tu interesująco.',tier:2,cost:{glass:4,steel:3,copperWire:2,transistor:2},icon:'▣',visual:'television',effect:'screen',sound:'homeRadio'},
  {tileName:'GAME_CONSOLE',label:'Konsola pikselowa',description:'Kompaktowe centrum zabawy z dwoma kontrolerami i niekończącym się poziomem.',tier:2,cost:{plastic:4,copperWire:3,transistor:3,glass:1},icon:'⌘',visual:'game_console',effect:'game',sound:'homeRadio'},
  {tileName:'REFRIGERATOR',label:'Lodówka retro',description:'Obła lodówka z chromowaną klamką i kolekcją magnesów z wypraw.',tier:2,cost:{steel:6,copperWire:3,transistor:2,motherIce:1},icon:'▯',visual:'refrigerator',effect:'cool',sound:'homeHum'},
  {tileName:'COFFEE_MACHINE',label:'Automat kawowy',description:'Precyzyjna maszyna, która zamienia wodę i cierpliwość w aromatyczną przerwę.',tier:2,cost:{steel:3,waterPipe:1,copperWire:1,coal:1},icon:'♨',visual:'coffee_machine',effect:'steam',sound:'homeCoffee'},
  {tileName:'AIR_PURIFIER',label:'Oczyszczacz biojonowy',description:'Cichy obieg filtrów, roślin i jonizatorów wypełnia dom świeżym powietrzem.',tier:3,cost:{steel:4,glass:2,transistor:2,leaf:3},icon:'◎',visual:'air_purifier',effect:'air',sound:'homeHum'},
  {tileName:'MEDICAL_STATION',label:'Stacja medyczna',description:'Domowe stanowisko diagnostyczne z monitorem, apteczką i pulsującym skanerem.',tier:3,cost:{steel:5,glass:3,transistor:4,radioactiveOre:1},icon:'✚',visual:'medical_station',effect:'medical',sound:'homeMedical'},

  {tileName:'HEALING_POD',label:'Kapsuła regeneracyjna',description:'Bioaktywna kapsuła otulająca ciało kojącym światłem i mgłą naprawczą.',tier:4,cost:{medicalStation:1,glass:6,steel:6,alienBiomass:2},icon:'⬡',visual:'healing_pod',effect:'pod',sound:'homeMedical'},
  {tileName:'ZERO_G_LOUNGER',label:'Leżanka zerowej grawitacji',description:'Fotel odpoczynkowy unoszący użytkownika kilka centymetrów ponad podstawą.',tier:4,cost:{patchworkSofa:1,antimatter:1,iridium:2},icon:'⌁',visual:'zero_g_lounger',effect:'float',sound:'homeHum'},
  {tileName:'MEMORY_PROJECTOR',label:'Projektor wspomnień',description:'Przekłada odnalezione ślady na warstwowe, półprzezroczyste obrazy.',tier:4,cost:{hologramArt:1,transistor:4,meteorDust:3},icon:'◈',visual:'memory_projector',effect:'memory',sound:'homeDream'},
  {tileName:'CHRONO_CLOCK',label:'Zegar chronometryczny',description:'Wielopierścieniowy mechanizm pokazujący kilka możliwych chwil jednocześnie.',tier:4,cost:{wallClock:1,gold:3,iridium:2,antimatter:1},icon:'◴',visual:'chrono_clock',effect:'chrono',sound:'homeTick'},
  {tileName:'BIOLUM_GARDEN',label:'Ogród bioluminescencyjny',description:'Samowystarczalna rabata obcych roślin odpowiadających blaskiem na ruch.',tier:4,cost:{terrarium:1,glowshroom:6,alienBiomass:2},icon:'❋',visual:'biolum_garden',effect:'bio',sound:'homeDream'},
  {tileName:'MINIATURE_SUN',label:'Miniaturowe słońce',description:'Stabilizowana gwiazda wielkości dłoni. Wnosi do domu własny świt.',tier:4,cost:{chandelier:1,motherLava:1,antimatter:2,glass:6},icon:'☀',visual:'miniature_sun',effect:'sun',sound:'homeHum'},
  {tileName:'DREAM_SYNTH',label:'Syntezator snów',description:'Instrument splatający dźwięk, kolor i spokojne wspomnienia w nocne pejzaże.',tier:4,cost:{memoryProjector:1,alienBiomass:4,motherIce:1,transistor:3},icon:'≋',visual:'dream_synth',effect:'dream',sound:'homeDream'},
  {tileName:'COSMIC_ORRERY',label:'Kosmiczne planetarium',description:'Precyzyjny model nieznanego układu, którego planety poruszają się naprawdę.',tier:4,cost:{chronoClock:1,iridium:4,antimatter:2,meteorDust:5},icon:'⊙',visual:'cosmic_orrery',effect:'orbit',sound:'homeChime'}
];

const SPEC_BY_NAME = new Map(HOME_FURNISHING_TILE_SPECS.map(spec=>[spec[0],spec]));

export const FURNISHINGS = Object.freeze(RAW.map(row=>{
  const spec=SPEC_BY_NAME.get(row.tileName);
  const tile=T[row.tileName];
  if(!spec || tile==null || !INFO[tile]) throw new Error('Invalid furnishing tile contract: '+row.tileName);
  return Object.freeze({
    id:row.tileName.toLowerCase(),
    key:spec[1],
    tileName:row.tileName,
    tile,
    label:row.label,
    description:row.description,
    category:spec[5],
    group:spec[5],
    tier:row.tier,
    cost:Object.freeze({...row.cost}),
    icon:row.icon,
    visual:row.visual,
    effect:row.effect,
    sound:row.sound||null,
    color:spec[2],
    hp:spec[3],
    placeableInHome:true,
    homeRegenBonus:spec[4],
    lightLevel:Number(spec[6])||0
  });
}));

export const FURNISHING_BY_TILE = new Map(FURNISHINGS.map(def=>[def.tile,def]));
export const FURNISHING_BY_KEY = new Map(FURNISHINGS.map(def=>[def.key,def]));
const FURNISHING_BY_NAME = new Map(FURNISHINGS.map(def=>[def.tileName,def]));

export function getByTile(tile){ return FURNISHING_BY_TILE.get(Number(tile))||null; }
export function getByKey(key){ return FURNISHING_BY_KEY.get(String(key||''))||null; }
export function getFurnishing(ref){
  if(!ref) return null;
  if(typeof ref==='number') return getByTile(ref);
  if(typeof ref==='string') return getByKey(ref)||FURNISHING_BY_NAME.get(ref)||null;
  if(typeof ref==='object'){
    if(FURNISHINGS.includes(ref)) return ref;
    if(ref.tile!=null) return getByTile(ref.tile);
    if(ref.key) return getByKey(ref.key);
  }
  return null;
}
export function isFurnishingTile(tile){ return FURNISHING_BY_TILE.has(Number(tile)); }

// Exploration is the catalogue's primary progression track.  Distance is
// deliberately based on |x| so travelling east and west is equally valuable;
// the final band starts before the advertised 15,000-block frontier so a
// player can actually encounter a tier-four home/trader while approaching it.
export const FURNISHING_FRONTIER_DISTANCE = 15000;
export const FURNISHING_DISTANCE_BANDS = Object.freeze([
  Object.freeze({tier:1,minDistance:0,    label:'lokalne rzemioslo'}),
  Object.freeze({tier:2,minDistance:2500, label:'wyposazenie odkrywcow'}),
  Object.freeze({tier:3,minDistance:7500, label:'zaawansowana technika'}),
  Object.freeze({tier:4,minDistance:12500,label:'cuda z krancow swiata'})
]);

export function furnishingTierAtDistance(worldX){
  const distance=Math.min(FURNISHING_FRONTIER_DISTANCE,Math.abs(Number(worldX)||0));
  let tier=1;
  for(const band of FURNISHING_DISTANCE_BANDS){
    if(distance>=band.minDistance) tier=band.tier;
  }
  return tier;
}

function discoveryHash(seed,index,salt){
  let n=(Number(seed)||0)|0;
  n^=Math.imul((index|0)+1,0x9e3779b1);
  n^=Math.imul((salt|0)+17,0x85ebca6b);
  n=Math.imul(n^(n>>>16),0x7feb352d);
  n=Math.imul(n^(n>>>15),0x846ca68b);
  return (n^(n>>>16))>>>0;
}

function orderedDiscoveryPool(pool,seed,salt){
  return pool.map((def,index)=>({def,order:discoveryHash(seed,index,salt)}))
    .sort((a,b)=>a.order-b.order || a.def.tile-b.def.tile)
    .map(row=>row.def);
}

// The first result always comes from the highest tier available at this
// distance. Additional results may be one tier simpler, which gives larger
// houses a believable mix without weakening the exploration milestone.
export function selectFurnishingsForDistance(worldX,seed,count=1){
  const tier=furnishingTierAtDistance(worldX);
  const limit=Math.max(0,Math.min(4,Math.floor(Number(count)||0)));
  if(!limit) return [];
  const signedSeed=((Number(seed)||0)|0)^((Number(worldX)||0)<0?0x51ed270b:0x2c1b3c6d);
  const primary=orderedDiscoveryPool(FURNISHINGS.filter(def=>def.tier===tier),signedSeed,101);
  const support=orderedDiscoveryPool(FURNISHINGS.filter(def=>def.tier>=Math.max(1,tier-1) && def.tier<=tier),signedSeed,211);
  const out=[];
  const add=def=>{ if(def && !out.includes(def) && out.length<limit) out.push(def); };
  add(primary[0]);
  support.forEach(add);
  return out;
}

export function furnishingTraderOffer(def){
  def=getFurnishing(def);
  if(!def) return null;
  const iridiumCost=[0,1,2,4,6][def.tier]||6;
  return Object.freeze({
    id:'decor_'+def.key,
    label:def.label,
    icon:def.icon,
    cost:Object.freeze({iridium:iridiumCost}),
    give:Object.freeze({[def.key]:1}),
    effect:'furnishing',
    furnishingKey:def.key,
    furnishingTier:def.tier,
    description:def.description
  });
}

export function furnishingTraderOffersForDistance(worldX,seed,count=2){
  return selectFurnishingsForDistance(worldX,seed,count).map(furnishingTraderOffer).filter(Boolean);
}

// Only the two best chest grades roll catalogue finds.  Epic chests provide a
// modest alternate route into tiers 2-3; legendary chests can reveal any
// frontier wonder, but still do so rarely enough that distant homes matter.
export const FURNISHING_CHEST_CHANCES = Object.freeze({epic:0.10,legendary:0.26});
export function rollChestFurnishing(chestTier,rng){
  const chance=FURNISHING_CHEST_CHANCES[chestTier]||0;
  const r=typeof rng==='function'?rng:Math.random;
  if(!chance || r()>=chance) return null;
  const maxTier=chestTier==='legendary'?4:3;
  const minTier=chestTier==='legendary'?3:2;
  const tier=r()<0.62?maxTier:minTier;
  const pool=FURNISHINGS.filter(def=>def.tier===tier);
  if(!pool.length) return null;
  return pool[Math.min(pool.length-1,Math.floor(r()*pool.length))];
}

export function findNearestRadio(player,getTile,range=3){
  if(!player || typeof getTile!=='function') return null;
  const px=Math.floor(Number(player.x)), py=Math.floor(Number(player.y));
  if(!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const radius=Math.max(1,Math.min(6,Math.floor(Number(range)||3)));
  let nearest=null;
  for(let y=py-radius;y<=py+radius;y++){
    for(let x=px-radius;x<=px+radius;x++){
      let tile;
      try{ tile=getTile(x,y); }catch(e){ continue; }
      if(tile!==T.RADIO) continue;
      const dist2=(x-px)*(x-px)+(y-py)*(y-py);
      if(dist2>radius*radius || (nearest && nearest.dist2<=dist2)) continue;
      nearest={x,y,tile:T.RADIO,dist2,def:FURNISHING_BY_TILE.get(T.RADIO)};
    }
  }
  return nearest;
}

export const FURNISHING_RESOURCES = Object.freeze(FURNISHINGS.map(def=>Object.freeze({
  key:def.key,
  label:def.label,
  color:def.color,
  tile:def.tileName,
  furniture:true,
  placeableInHome:true,
  furnitureCategory:def.category,
  homeRegenBonus:def.homeRegenBonus,
  ambientSound:def.sound,
  tier:def.tier,
  description:def.description
})));

export function createRecipes({inventory,notify}={}){
  const bag=inventory || (typeof globalThis!=='undefined' && globalThis.inv) || {};
  const say=typeof notify==='function' ? notify : ()=>{};
  return FURNISHINGS.map(def=>({
    id:'furnishing_'+def.key,
    name:def.label,
    cost:{...def.cost},
    group:def.category,
    category:def.category,
    tier:def.tier,
    icon:def.icon,
    tint:def.color,
    out:def.key,
    amount:1,
    tile:def.tile,
    tileName:def.tileName,
    placeableInHome:true,
    homeRegenBonus:def.homeRegenBonus,
    ambientSound:def.sound,
    home:{tile:def.tile,tier:def.tier,bonus:def.homeRegenBonus,category:def.category},
    desc:def.description,
    make(){
      bag[def.key]=Math.max(0,Number(bag[def.key])||0)+1;
      say('Wytworzono: '+def.label+' · postaw w domu, aby podnieść regenerację');
      return true;
    }
  }));
}

function shade(hex,delta){
  const value=String(hex||'#888').replace('#','');
  const full=value.length===3 ? value.split('').map(c=>c+c).join('') : value.padEnd(6,'8').slice(0,6);
  const n=parseInt(full,16);
  const c=shift=>Math.max(0,Math.min(255,((n>>shift)&255)+delta));
  return 'rgb('+c(16)+','+c(8)+','+c(0)+')';
}
function rect(g,x,y,w,h,c){ if(c) g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h))); }
function line(g,x1,y1,x2,y2,c,w=1){
  g.strokeStyle=c; g.lineWidth=w; g.lineCap='round'; g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
}
function circle(g,x,y,r,c,stroke=null,w=1){
  g.beginPath(); g.arc(x,y,r,0,Math.PI*2);
  if(c){ g.fillStyle=c; g.fill(); }
  if(stroke){ g.strokeStyle=stroke; g.lineWidth=w; g.stroke(); }
}
function ellipse(g,x,y,rx,ry,c,stroke=null,w=1){
  g.beginPath(); g.ellipse(x,y,rx,ry,0,0,Math.PI*2);
  if(c){ g.fillStyle=c; g.fill(); }
  if(stroke){ g.strokeStyle=stroke; g.lineWidth=w; g.stroke(); }
}
function poly(g,points,c,stroke=null,w=1){
  g.beginPath(); g.moveTo(points[0][0],points[0][1]);
  for(let i=1;i<points.length;i++) g.lineTo(points[i][0],points[i][1]);
  g.closePath();
  if(c){ g.fillStyle=c; g.fill(); }
  if(stroke){ g.strokeStyle=stroke; g.lineWidth=w; g.stroke(); }
}
function furnitureShadow(g,px,py,w=16){
  ellipse(g,px+10,py+18,w*.5,1.7,'rgba(0,0,0,.28)');
}
function drawBooks(g,px,py,y,seed){
  const colors=['#d66a58','#e0b54d','#5ba8ca','#78a968','#a36bb5'];
  let x=px+4;
  for(let i=0;i<5;i++){
    const bw=1+(i+seed)%2, bh=3+((i*3+seed)%3);
    rect(g,x,py+y-bh,bw,bh,colors[(i+seed)%colors.length]);
    x+=bw+1;
  }
}

export function drawTile(g,t,px,py,wx=0,wy=0){
  const def=getByTile(t);
  if(!def || !g) return false;
  const c=def.color, dark=shade(c,-55), deep=shade(c,-85), light=shade(c,50);
  const h=((Math.imul((wx|0)^0x9e37,1103515245)^Math.imul((wy|0)^0x85eb,12345))>>>0);
  g.save();
  g.imageSmoothingEnabled=false;
  switch(def.visual){
    case 'rustic_stool':
      furnitureShadow(g,px,py,12); rect(g,px+4,py+7,12,4,dark); rect(g,px+5,py+6,10,3,c);
      rect(g,px+6,py+10,2,8,deep); rect(g,px+12,py+10,2,8,deep); rect(g,px+7,py+13,6,2,dark); rect(g,px+7,py+7,1,1,light); break;
    case 'pine_table':
      furnitureShadow(g,px,py,18); rect(g,px+1,py+7,18,3,deep); rect(g,px+2,py+5,16,4,c); rect(g,px+3,py+6,14,1,light);
      rect(g,px+3,py+9,2,9,dark); rect(g,px+15,py+9,2,9,dark); rect(g,px+11,py+2,4,3,'#d8d4c8'); rect(g,px+14,py+3,2,1,'#d8d4c8'); break;
    case 'wall_shelf':
      rect(g,px+2,py+4,2,12,deep); rect(g,px+16,py+4,2,12,deep); rect(g,px+2,py+8,16,2,c); rect(g,px+2,py+15,16,2,c);
      drawBooks(g,px,py,15,h&3); rect(g,px+5,py+4,4,4,'#a86d50'); circle(g,px+13,py+6,2,'#75a873'); break;
    case 'oak_cabinet':
      furnitureShadow(g,px,py,16); rect(g,px+3,py+2,14,16,deep); rect(g,px+4,py+3,12,14,c); line(g,px+10,py+4,px+10,py+16,dark,1);
      rect(g,px+5,py+4,4,5,shade(c,18)); rect(g,px+11,py+4,4,5,shade(c,18)); circle(g,px+8,py+11,1,'#e7bd57'); circle(g,px+12,py+11,1,'#e7bd57'); break;
    case 'cozy_bed':
      furnitureShadow(g,px,py,18); rect(g,px+1,py+10,18,7,deep); rect(g,px+2,py+8,17,7,'#e6d8c5'); rect(g,px+3,py+9,5,3,'#fff3dc');
      rect(g,px+8,py+9,10,6,c); rect(g,px+8,py+10,10,2,light); rect(g,px+2,py+16,2,2,dark); rect(g,px+17,py+16,2,2,dark); break;
    case 'bookcase':
      furnitureShadow(g,px,py,15); rect(g,px+2,py+1,16,18,deep); rect(g,px+4,py+3,12,14,'#3d291d');
      rect(g,px+3,py+7,14,2,c); rect(g,px+3,py+13,14,2,c); drawBooks(g,px,py,7,0); drawBooks(g,px,py,13,2); drawBooks(g,px,py,18,4); break;
    case 'patchwork_sofa':
      furnitureShadow(g,px,py,19); rect(g,px+1,py+9,18,8,deep); rect(g,px+3,py+6,14,8,c); rect(g,px+1,py+10,4,7,dark); rect(g,px+15,py+10,4,7,dark);
      rect(g,px+5,py+9,5,5,'#d6875c'); rect(g,px+10,py+9,5,5,'#6d9eb1'); rect(g,px+6,py+10,3,2,'#d3b35b'); rect(g,px+4,py+17,2,2,deep); rect(g,px+14,py+17,2,2,deep); break;
    case 'hammock':
      furnitureShadow(g,px,py,18); rect(g,px+1,py+3,2,16,deep); rect(g,px+17,py+3,2,16,deep); line(g,px+2,py+5,px+18,py+5,'#d8bd80',1);
      g.beginPath(); g.moveTo(px+3,py+7); g.quadraticCurveTo(px+10,py+18,px+17,py+7); g.strokeStyle=c; g.lineWidth=4; g.stroke(); line(g,px+4,py+8,px+16,py+8,light,1); break;
    case 'woven_rug':
      ellipse(g,px+10,py+17,9,2,deep); rect(g,px+2,py+12,16,6,c); poly(g,[[px+6,py+15],[px+10,py+12],[px+14,py+15],[px+10,py+18]],'#e0b76b');
      rect(g,px+3,py+13,2,1,light); rect(g,px+15,py+16,2,1,light); break;
    case 'potted_fern':
      furnitureShadow(g,px,py,11); poly(g,[[px+6,py+13],[px+14,py+13],[px+12,py+19],[px+8,py+19]],'#b66b3c',dark);
      line(g,px+10,py+14,px+10,py+3,'#397542',1); for(let i=0;i<4;i++){ line(g,px+10,py+5+i*2,px+4+i%2,py+3+i*2,'#66b35d',2); line(g,px+10,py+6+i*2,px+16-i%2,py+4+i*2,'#4f9b51',2); } break;
    case 'wall_clock':
      rect(g,px+8,py+9,4,9,dark); circle(g,px+10,py+7,6,c,light,1); circle(g,px+10,py+7,4,'#f4e7c0');
      line(g,px+10,py+7,px+10,py+4,deep,1); line(g,px+10,py+7,px+13,py+8,deep,1); circle(g,px+10,py+16,2,'#e7bd57'); break;
    case 'aquarium':
      furnitureShadow(g,px,py,18); rect(g,px+1,py+4,18,14,'#274f63'); rect(g,px+2,py+5,16,11,'rgba(67,178,215,.72)'); rect(g,px+2,py+5,16,2,'#a7efff');
      rect(g,px+3,py+14,14,2,'#d1b574'); line(g,px+5,py+14,px+6,py+9,'#4a9f70',1); line(g,px+15,py+14,px+14,py+8,'#63b56d',1);
      poly(g,[[px+7,py+9],[px+11,py+7],[px+11,py+11]],'#ffd35e'); circle(g,px+12,py+9,2,'#ef805a'); rect(g,px+17,py+16,2,2,deep); rect(g,px+2,py+16,2,2,deep); break;
    case 'terrarium':
      furnitureShadow(g,px,py,15); poly(g,[[px+4,py+5],[px+16,py+5],[px+18,py+17],[px+2,py+17]],'rgba(103,197,141,.24)','#a9e8d0',1);
      rect(g,px+3,py+14,14,3,'#6d5133'); circle(g,px+7,py+13,3,'#4d9854'); circle(g,px+13,py+12,4,'#63b663'); circle(g,px+6,py+8,1,'#d8ff85'); circle(g,px+14,py+7,1,'#d8ff85'); break;
    case 'chandelier':
      line(g,px+10,py,px+10,py+6,dark,1); circle(g,px+10,py+6,2,c); line(g,px+10,py+7,px+4,py+11,c,2); line(g,px+10,py+7,px+16,py+11,c,2);
      line(g,px+10,py+7,px+10,py+13,c,2); circle(g,px+4,py+13,3,'#ffe598'); circle(g,px+16,py+13,3,'#ffe598'); circle(g,px+10,py+15,3,'#fff1ad'); break;
    case 'indoor_fountain':
      furnitureShadow(g,px,py,18); ellipse(g,px+10,py+16,9,3,dark); ellipse(g,px+10,py+15,8,2,'#68c5dc'); rect(g,px+9,py+6,2,9,c); ellipse(g,px+10,py+8,5,2,c);
      line(g,px+6,py+8,px+5,py+14,'#a6efff',1); line(g,px+14,py+8,px+15,py+14,'#a6efff',1); circle(g,px+10,py+4,2,light); break;
    case 'hologram_art':
      furnitureShadow(g,px,py,13); rect(g,px+4,py+15,12,3,deep); rect(g,px+6,py+13,8,3,c);
      g.save(); g.globalAlpha=.72; poly(g,[[px+10,py+2],[px+15,py+9],[px+10,py+13],[px+5,py+9]],'rgba(115,235,255,.28)','#aaf8ff',1); line(g,px+10,py+2,px+10,py+13,'#76eaff',1); g.restore(); break;
    case 'desk_lamp':
      furnitureShadow(g,px,py,13); ellipse(g,px+9,py+17,6,2,deep); line(g,px+9,py+16,px+10,py+9,dark,2); line(g,px+10,py+9,px+15,py+5,dark,2);
      poly(g,[[px+12,py+3],[px+19,py+5],[px+16,py+10],[px+11,py+8]],c,light,1); poly(g,[[px+13,py+9],[px+18,py+9],[px+16,py+14]],'rgba(255,220,120,.25)'); break;
    case 'radio':
      furnitureShadow(g,px,py,16); rect(g,px+2,py+6,16,11,deep); rect(g,px+3,py+7,14,9,c); circle(g,px+8,py+12,4,'#342c28','#d9b26d',1);
      rect(g,px+12,py+9,4,1,'#f0d79d'); circle(g,px+14,py+13,1,'#f2cf64'); line(g,px+15,py+6,px+18,py+1,'#b7c3cd',1); break;
    case 'television':
      furnitureShadow(g,px,py,18); rect(g,px+1,py+4,18,13,deep); rect(g,px+3,py+6,12,8,'#173c58'); rect(g,px+4,py+7,10,6,'#4faac8');
      poly(g,[[px+5,py+12],[px+8,py+8],[px+10,py+11],[px+13,py+7],[px+13,py+13],[px+5,py+13]],'#7bd6a8'); circle(g,px+17,py+8,1,'#9ff4d9'); circle(g,px+17,py+12,1,'#e9ba61'); rect(g,px+4,py+17,2,2,dark); rect(g,px+14,py+17,2,2,dark); break;
    case 'game_console':
      furnitureShadow(g,px,py,16); rect(g,px+4,py+6,12,9,deep); rect(g,px+5,py+5,10,8,c); rect(g,px+7,py+7,6,3,'#26284a'); rect(g,px+9,py+15,2,3,dark);
      ellipse(g,px+4,py+16,4,2,'#6c72b9'); rect(g,px+2,py+15,4,1,'#d2e2ff'); ellipse(g,px+16,py+16,4,2,'#8e62b5'); circle(g,px+17,py+15,1,'#70e0c0'); break;
    case 'refrigerator':
      furnitureShadow(g,px,py,14); rect(g,px+4,py+1,12,18,deep); rect(g,px+5,py+2,10,16,c); line(g,px+5,py+8,px+15,py+8,'#849aa6',1); rect(g,px+13,py+4,1,3,'#eefaff'); rect(g,px+13,py+10,1,5,'#eefaff');
      rect(g,px+7,py+4,2,2,'#ed6d62'); rect(g,px+10,py+10,2,2,'#57b9d0'); rect(g,px+7,py+14,1,1,'#e8c552'); break;
    case 'coffee_machine':
      furnitureShadow(g,px,py,15); rect(g,px+4,py+3,12,13,deep); rect(g,px+5,py+4,10,10,c); rect(g,px+7,py+6,6,3,'#20262c'); circle(g,px+8,py+7,1,'#6fe5bd'); circle(g,px+12,py+7,1,'#efbf57');
      rect(g,px+8,py+10,4,2,'#323b40'); rect(g,px+7,py+13,6,4,'#f4e9d4'); rect(g,px+12,py+14,2,2,'#f4e9d4'); rect(g,px+5,py+17,10,1,dark); break;
    case 'air_purifier':
      furnitureShadow(g,px,py,14); rect(g,px+4,py+2,12,17,deep); rect(g,px+5,py+3,10,15,c); circle(g,px+10,py+9,4,'#234b51','#b8fff3',1);
      for(let i=0;i<4;i++) line(g,px+10,py+9,px+10+Math.cos(i*Math.PI/2)*3,py+9+Math.sin(i*Math.PI/2)*3,'#82e9db',1);
      for(let i=0;i<4;i++) rect(g,px+7+i*2,py+15,1,2,'#d5ffff'); break;
    case 'medical_station':
      furnitureShadow(g,px,py,17); rect(g,px+2,py+3,16,14,deep); rect(g,px+3,py+4,14,12,'#465a61'); rect(g,px+4,py+5,8,6,'#173f48');
      line(g,px+5,py+9,px+7,py+9,'#66efb0',1); line(g,px+7,py+9,px+8,py+6,'#66efb0',1); line(g,px+8,py+6,px+10,py+10,'#66efb0',1); line(g,px+10,py+10,px+11,py+8,'#66efb0',1);
      rect(g,px+13,py+6,3,7,'#e5f3ee'); rect(g,px+14,py+7,1,5,'#eb5f65'); rect(g,px+13,py+9,3,1,'#eb5f65'); rect(g,px+5,py+17,2,2,dark); rect(g,px+14,py+17,2,2,dark); break;
    case 'healing_pod':
      furnitureShadow(g,px,py,17); rect(g,px+3,py+4,14,14,deep); poly(g,[[px+6,py+2],[px+14,py+2],[px+17,py+6],[px+15,py+17],[px+5,py+17],[px+3,py+6]],'rgba(89,231,191,.28)','#9bffe0',1);
      ellipse(g,px+10,py+10,4,6,'rgba(112,255,207,.2)'); circle(g,px+10,py+7,2,'#bfffea'); rect(g,px+8,py+10,4,5,'#65cda9');
      line(g,px+6,py+5,px+5,py+11,'rgba(226,255,249,.75)',1); rect(g,px+8,py+18,4,1,c); break;
    case 'zero_g_lounger':
      furnitureShadow(g,px,py,16); rect(g,px+3,py+16,14,2,deep); circle(g,px+5,py+17,2,c); circle(g,px+15,py+17,2,c);
      g.beginPath(); g.moveTo(px+4,py+12); g.quadraticCurveTo(px+10,py+3,px+17,py+8); g.strokeStyle=light; g.lineWidth=4; g.stroke();
      g.beginPath(); g.moveTo(px+4,py+13); g.quadraticCurveTo(px+10,py+6,px+16,py+9); g.strokeStyle=c; g.lineWidth=3; g.stroke(); break;
    case 'memory_projector':
      furnitureShadow(g,px,py,14); rect(g,px+4,py+15,12,3,deep); rect(g,px+6,py+12,8,4,c); circle(g,px+10,py+13,2,'#c1fbff');
      g.save(); g.globalAlpha=.5; rect(g,px+4,py+3,12,8,'rgba(105,223,255,.22)'); rect(g,px+6,py+5,4,4,'#7de8ff'); rect(g,px+11,py+4,3,2,'#d6a5ff'); g.restore(); break;
    case 'chrono_clock':
      furnitureShadow(g,px,py,14); rect(g,px+8,py+14,4,4,deep); ellipse(g,px+10,py+9,7,7,'rgba(60,52,37,.65)',c,1); ellipse(g,px+10,py+9,5,7,null,light,1); ellipse(g,px+10,py+9,7,4,null,'#8de8ff',1);
      line(g,px+10,py+9,px+10,py+4,'#fff0a8',1); line(g,px+10,py+9,px+14,py+11,'#fff0a8',1); circle(g,px+10,py+9,1,'#fff'); break;
    case 'biolum_garden':
      furnitureShadow(g,px,py,18); poly(g,[[px+2,py+14],[px+18,py+14],[px+16,py+19],[px+4,py+19]],deep); rect(g,px+3,py+14,14,2,'#385943');
      for(let i=0;i<5;i++){ const x=px+4+i*3; const top=py+6+(i%2)*3; line(g,x,py+15,x,top,'#4ca36d',1); circle(g,x,top,2,i%2?'#72f0ca':'#9a7cff'); circle(g,x,top,1,'#eaffd5'); } break;
    case 'miniature_sun':
      furnitureShadow(g,px,py,14); rect(g,px+6,py+16,8,2,deep); rect(g,px+9,py+12,2,5,c);
      for(let i=0;i<8;i++){ const a=i*Math.PI/4; line(g,px+10+Math.cos(a)*6,py+8+Math.sin(a)*6,px+10+Math.cos(a)*8,py+8+Math.sin(a)*8,'#ffd15b',1); }
      circle(g,px+10,py+8,5,'#ffb02e','#fff1a3',1);
      circle(g,px+10,py+8,2,'#fff6c9'); ellipse(g,px+10,py+8,8,3,null,'rgba(255,195,74,.8)',1); break;
    case 'dream_synth':
      furnitureShadow(g,px,py,18); rect(g,px+1,py+10,18,7,deep); poly(g,[[px+2,py+9],[px+18,py+9],[px+16,py+3],[px+4,py+3]],c);
      rect(g,px+5,py+5,10,3,'#29234e'); for(let i=0;i<7;i++) rect(g,px+4+i*2,py+11,1,4,i%2?'#a7e9ff':'#f3eaff'); circle(g,px+6,py+6,1,'#79f2c9'); circle(g,px+14,py+6,1,'#ff85df'); break;
    case 'cosmic_orrery':
      furnitureShadow(g,px,py,17); rect(g,px+6,py+16,8,2,deep); rect(g,px+9,py+12,2,5,c); circle(g,px+10,py+9,3,'#ffd66d');
      ellipse(g,px+10,py+9,8,3,null,'#91b8ff',1); ellipse(g,px+10,py+9,5,7,null,'#c993ff',1); circle(g,px+3,py+9,2,'#71d9f2'); circle(g,px+12,py+3,1.5,'#ef7d9c'); circle(g,px+14,py+13,1.5,'#8ee28e'); break;
  }
  // Reliable tier glints sharpen advanced silhouettes even at the native 20 px
  // scale; the second fleck is reserved for the truly exotic tier-four pieces.
  if(def.tier>=3) rect(g,px+16,py+2,1,1,'rgba(255,255,255,.78)');
  if(def.tier>=4) rect(g,px+2+(h%4),py+4,1,1,'rgba(182,239,255,.62)');
  g.restore();
  return true;
}

function resolvePreviewContext(canvasOrCtx){
  if(!canvasOrCtx) return null;
  if(typeof canvasOrCtx.getContext==='function') return canvasOrCtx.getContext('2d');
  if(canvasOrCtx.canvas) return canvasOrCtx;
  return null;
}
export function drawPreview(canvasOrCtx,ref,opts={}){
  const def=getFurnishing(ref);
  const g=resolvePreviewContext(canvasOrCtx);
  if(!def || !g) return false;
  const canvas=g.canvas||canvasOrCtx;
  const w=Math.max(24,Number(canvas.width)||96), h=Math.max(24,Number(canvas.height)||96);
  g.save();
  g.clearRect(0,0,w,h);
  const bg=g.createRadialGradient(w*.5,h*.42,1,w*.5,h*.5,Math.max(w,h)*.65);
  bg.addColorStop(0,def.color+'42'); bg.addColorStop(.58,'rgba(12,21,31,.72)'); bg.addColorStop(1,'rgba(3,7,12,.96)');
  g.fillStyle=bg; g.fillRect(0,0,w,h);
  g.strokeStyle='rgba(255,255,255,.055)'; g.lineWidth=1;
  for(let x=0;x<w;x+=Math.max(8,Math.round(w/10))){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke(); }
  for(let y=0;y<h;y+=Math.max(8,Math.round(h/10))){ g.beginPath(); g.moveTo(0,y); g.lineTo(w,y); g.stroke(); }
  const scale=Math.min(w,h)/(TILE*(opts.compact?1.25:1.12));
  g.translate((w-TILE*scale)*.5,(h-TILE*scale)*.5);
  g.scale(scale,scale);
  drawTile(g,def.tile,0,0,7,11);
  g.restore();
  return true;
}

function fxLine(g,x1,y1,x2,y2,color,width=1,alpha=1){
  g.save(); g.globalAlpha=alpha; line(g,x1,y1,x2,y2,color,width); g.restore();
}
function radioVisualInfo(){
  try{
    const api=globalThis.MM && globalThis.MM.audio;
    const info=api && api.getRadioStationInfo && api.getRadioStationInfo();
    if(!info || !/^#[0-9a-f]{6}$/i.test(String(info.accent||''))) return null;
    return info;
  }catch(e){ return null; }
}
function drawEffectFor(g,def,px,py,s,now,seed){
  const u=s/TILE;
  const x=n=>px+n*u, y=n=>py+n*u;
  const phase=now*.001+seed*.17;
  g.save();
  g.globalCompositeOperation='lighter';
  switch(def.effect){
    case 'clock': {
      const a=phase*.8; fxLine(g,x(10),y(16),x(10)+Math.sin(a)*2*u,y(16)+Math.cos(a)*2*u,'#ffd66d',u,.65); break;
    }
    case 'water': {
      for(let i=0;i<3;i++){ const bx=x(5+i*5+Math.sin(phase+i)*1.2), by=y(14-((phase*5+i*4)%10)); circle(g,bx,by,Math.max(.45,u*.65),'rgba(151,239,255,.7)'); }
      if(def.visual==='indoor_fountain'){ fxLine(g,x(6),y(13),x(8),y(7+Math.sin(phase)*1.2),'#9bf1ff',u,.55); fxLine(g,x(14),y(13),x(12),y(7+Math.cos(phase)*1.2),'#9bf1ff',u,.55); }
      break;
    }
    case 'plant': {
      for(let i=0;i<2;i++){ const a=phase+i*3; circle(g,x(6+i*8+Math.sin(a)*2),y(6+Math.cos(a*.7)*2),Math.max(.5,u*.75),'rgba(202,255,141,.7)'); } break;
    }
    case 'light': {
      const glow=g.createRadialGradient(x(10),y(10),0,x(10),y(10),9*u); glow.addColorStop(0,'rgba(255,231,151,.16)'); glow.addColorStop(1,'rgba(255,210,90,0)');
      g.fillStyle=glow; g.fillRect(px,py,s,s); break;
    }
    case 'holo': {
      g.globalAlpha=.35+.15*Math.sin(phase*2); poly(g,[[x(10),y(1)],[x(17),y(13)],[x(3),y(13)]],'rgba(99,234,255,.18)','#a5f7ff',u); break;
    }
    case 'radio': {
      const station=radioVisualInfo();
      const accent=station ? station.accent : '#ffd36e';
      const live=!!(station && station.id!=='off');
      for(let i=1;i<=2;i++){ g.globalAlpha=(live ? .34 : .16)/i; g.beginPath(); g.arc(x(15),y(4),i*3*u,-1.4,.15); g.strokeStyle=accent; g.lineWidth=u; g.stroke(); }
      for(let i=0;i<4;i++){
        const height=live ? (1.5+(1+Math.sin(phase*5+i*1.7))*1.4) : .7;
        rect(g,x(11+i*1.5),y(15-height),Math.max(1,u),Math.max(1,height*u),accent);
      }
      break;
    }
    case 'screen':
    case 'game': {
      const yy=y(7+((phase*7)%6)); rect(g,x(4),yy,def.effect==='game'?9*u:10*u,Math.max(1,u),'rgba(143,239,255,.34)'); break;
    }
    case 'cool': {
      for(let i=0;i<2;i++){ const a=phase+i*2.7; circle(g,x(7+i*6+Math.sin(a)*1.5),y(2-Math.cos(a)),Math.max(.5,u*.7),'rgba(191,244,255,.45)'); } break;
    }
    case 'steam': {
      for(let i=0;i<2;i++){ g.globalAlpha=.25; g.beginPath(); g.moveTo(x(8+i*4),y(12)); g.bezierCurveTo(x(6+i*5),y(9),x(11+i*2),y(7),x(9+i*4),y(3)); g.strokeStyle='#efffff'; g.lineWidth=u; g.stroke(); } break;
    }
    case 'air': {
      fxLine(g,x(2),y(5+Math.sin(phase)*2),x(7),y(5+Math.sin(phase)*2),'#7df2df',u,.35); fxLine(g,x(13),y(14+Math.cos(phase)*2),x(19),y(14+Math.cos(phase)*2),'#7df2df',u,.35); break;
    }
    case 'medical':
    case 'pod': {
      g.globalAlpha=.28+.18*Math.sin(phase*3); const glow=g.createRadialGradient(x(10),y(9),0,x(10),y(9),8*u); glow.addColorStop(0,'rgba(105,255,194,.35)'); glow.addColorStop(1,'rgba(105,255,194,0)'); g.fillStyle=glow; g.fillRect(px,py,s,s);
      for(let i=0;i<2;i++){ const yy=y(15-((phase*3+i*6)%11)); circle(g,x(8+i*4),yy,Math.max(.45,u*.55),'rgba(181,255,228,.55)'); } break;
    }
    case 'float': {
      for(let i=0;i<3;i++){ const a=phase+i*2.1; circle(g,x(5+i*5+Math.sin(a)),y(5+Math.cos(a)*3),Math.max(.45,u*.55),'rgba(197,163,255,.55)'); } break;
    }
    case 'memory': {
      const yy=y(3+Math.sin(phase)*1.5); g.globalAlpha=.22; rect(g,x(3),yy,14*u,8*u,'rgba(112,222,255,.35)'); fxLine(g,x(5),yy+3*u,x(15),yy+3*u,'#baf7ff',u,.5); break;
    }
    case 'chrono': {
      g.translate(x(10),y(9)); g.rotate(phase*.35); g.strokeStyle='rgba(255,218,107,.55)'; g.lineWidth=u; g.beginPath(); g.ellipse(0,0,8*u,3*u,0,0,Math.PI*2); g.stroke(); break;
    }
    case 'bio': {
      for(let i=0;i<5;i++){ const pulse=.6+.4*Math.sin(phase*2+i); circle(g,x(4+i*3),y(6+(i%2)*4),Math.max(.6,u*pulse),'rgba(122,255,194,.72)'); } break;
    }
    case 'sun': {
      const pulse=.75+.2*Math.sin(phase*2); const glow=g.createRadialGradient(x(10),y(8),u,x(10),y(8),11*u); glow.addColorStop(0,'rgba(255,242,173,.45)'); glow.addColorStop(.45,'rgba(255,170,45,.18)'); glow.addColorStop(1,'rgba(255,130,20,0)'); g.globalAlpha=pulse; g.fillStyle=glow; g.fillRect(px-u*2,py-u*2,s+u*4,s+u*4);
      for(let i=0;i<4;i++){ const a=phase*.35+i*Math.PI/2; fxLine(g,x(10)+Math.cos(a)*6*u,y(8)+Math.sin(a)*6*u,x(10)+Math.cos(a)*10*u,y(8)+Math.sin(a)*10*u,'#ffe28a',u,.28); } break;
    }
    case 'dream': {
      for(let i=0;i<3;i++){ const yy=y(4+i*3+Math.sin(phase*1.6+i)*1.2); fxLine(g,x(3),yy,x(17),yy,'#d08cff',u,.18+i*.06); }
      circle(g,x(15+Math.sin(phase)*2),y(3+Math.cos(phase*.7)),Math.max(.45,u*.65),'rgba(202,222,255,.62)'); break;
    }
    case 'orbit': {
      for(let i=0;i<3;i++){ const a=phase*(.55+i*.18)+i*2; circle(g,x(10)+Math.cos(a)*(4+i*2)*u,y(9)+Math.sin(a)*(2+i)*u,Math.max(.7,u*(1.2-i*.15)),['#72e4ff','#ff91b7','#9cff9c'][i]); } break;
    }
  }
  g.restore();
}

const EFFECT_CACHE_TTL_MS=240;
const EFFECT_CACHE_MAX_ITEMS=512;
const EFFECT_VIEW_MAX_X=192;
const EFFECT_VIEW_MAX_Y=108;
const effectCache={provider:null,key:'',expires:0,cells:[],scans:0,hits:0,visited:0,errors:0,truncated:false};

export const FURNISHING_SOUND_PROFILES = Object.freeze({
  homeTick:Object.freeze({minMs:900,maxMs:1450}),
  homeWater:Object.freeze({minMs:2200,maxMs:3800}),
  homeHum:Object.freeze({minMs:4300,maxMs:7200}),
  homeRadio:Object.freeze({minMs:3600,maxMs:6500}),
  homeCoffee:Object.freeze({minMs:5200,maxMs:9000}),
  homeMedical:Object.freeze({minMs:2400,maxMs:4300}),
  homeDream:Object.freeze({minMs:5600,maxMs:9600}),
  homeChime:Object.freeze({minMs:6800,maxMs:11200})
});
const AUDIO_SCAN_INTERVAL=0.6;
const AUDIO_RADIUS_X=18;
const AUDIO_RADIUS_Y=12;
const AUDIO_MAX_PLAYS_PER_SCAN=2;
const HOME_AUDIO_BUS='ambience';
const audioRuntime={scanT:0,clockMs:0,nextBySound:new Map(),scans:0,visited:0,plays:0,errors:0,lastCandidates:0};

function resetEffectCache(){
  effectCache.provider=null; effectCache.key=''; effectCache.expires=0; effectCache.cells=[];
  effectCache.scans=0; effectCache.hits=0; effectCache.visited=0; effectCache.errors=0; effectCache.truncated=false;
}
export function resetRuntimeCaches(){
  resetEffectCache();
  audioRuntime.scanT=0; audioRuntime.clockMs=0; audioRuntime.nextBySound.clear();
  audioRuntime.scans=0; audioRuntime.visited=0; audioRuntime.plays=0; audioRuntime.errors=0; audioRuntime.lastCandidates=0;
}
export function runtimeMetrics(){
  return {
    effects:{scans:effectCache.scans,hits:effectCache.hits,visited:effectCache.visited,cached:effectCache.cells.length,errors:effectCache.errors,truncated:effectCache.truncated},
    audio:{scans:audioRuntime.scans,visited:audioRuntime.visited,plays:audioRuntime.plays,errors:audioRuntime.errors,candidates:audioRuntime.lastCandidates,scheduled:audioRuntime.nextBySound.size}
  };
}

export function drawEffects(g,tileSize,sx,sy,viewX,viewY,getTile,visible){
  if(!g || typeof getTile!=='function') return false;
  const size=Math.max(1,Math.min(512,Number(tileSize)||TILE));
  const x0=Math.floor(Number(sx)||0), y0=Math.floor(Number(sy)||0);
  const spanX=Math.min(EFFECT_VIEW_MAX_X,Math.max(1,Math.ceil(Number(viewX)||1)));
  const spanY=Math.min(EFFECT_VIEW_MAX_Y,Math.max(1,Math.ceil(Number(viewY)||1)));
  const x1=x0+spanX+1, y1=y0+spanY+1;
  const now=typeof performance!=='undefined' && performance.now ? performance.now() : Date.now();
  const cacheKey=x0+','+y0+','+x1+','+y1;
  if(effectCache.provider!==getTile || effectCache.key!==cacheKey || now>=effectCache.expires){
    effectCache.provider=getTile; effectCache.key=cacheKey; effectCache.expires=now+EFFECT_CACHE_TTL_MS;
    effectCache.cells=[]; effectCache.scans++; effectCache.truncated=false;
    scan: for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        effectCache.visited++;
        let tile;
        try{ tile=getTile(x,y); }catch(e){ effectCache.errors++; continue; }
        const def=getByTile(tile);
        if(!def || def.effect==='still') continue;
        effectCache.cells.push({x,y,tile});
        if(effectCache.cells.length>=EFFECT_CACHE_MAX_ITEMS){ effectCache.truncated=true; break scan; }
      }
    }
  }else effectCache.hits++;

  let handled=false;
  for(const cell of effectCache.cells){
    let tile;
    try{ tile=getTile(cell.x,cell.y); }catch(e){ effectCache.errors++; continue; }
    const def=getByTile(tile);
    if(!def || def.effect==='still') continue;
    if(typeof visible==='function'){
      try{ if(!visible(cell.x,cell.y)) continue; }catch(e){ effectCache.errors++; }
    }
    handled=true;
    drawEffectFor(g,def,cell.x*size,cell.y*size,size,now,(cell.x*31+cell.y*17)&255);
  }
  return handled;
}

function soundDelayMs(sound,x,y,cycle,first=false){
  const profile=FURNISHING_SOUND_PROFILES[sound];
  if(!profile) return 10000;
  let h=Math.imul((x|0)^0x9e3779b9,1103515245)^Math.imul((y|0)^0x85ebca6b,12345)^Math.imul(cycle|0,2654435761);
  h=(h^(h>>>16))>>>0;
  const t=(h&65535)/65535;
  const delay=profile.minMs+(profile.maxMs-profile.minMs)*t;
  return first ? Math.max(250,delay*.42) : delay;
}

// Sparse positional one-shots are intentionally used instead of permanent
// loops. They retain a lived-in soundscape without accumulating WebAudio nodes
// in large houses, and only the nearest copy of a sound family can speak.
export function updateAudio(dt,player,getTile,audio){
  const step=Math.max(0,Math.min(1,Number(dt)||0));
  audioRuntime.clockMs+=step*1000;
  if(!audio || typeof audio.play!=='function' || typeof getTile!=='function' || !player) return false;
  try{ if(typeof audio.isReady==='function' && !audio.isReady()) return false; }catch(e){ audioRuntime.errors++; return false; }
  try{ if(typeof audio.isMuted==='function' && audio.isMuted()) return false; }catch(e){ audioRuntime.errors++; return false; }
  audioRuntime.scanT-=step;
  if(audioRuntime.scanT>0) return false;
  audioRuntime.scanT=AUDIO_SCAN_INTERVAL;

  const px=Math.floor(Number(player.x)), py=Math.floor(Number(player.y));
  if(!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const nearest=new Map();
  let nearestRadio=null;
  audioRuntime.scans++;
  for(let y=py-AUDIO_RADIUS_Y;y<=py+AUDIO_RADIUS_Y;y++){
    for(let x=px-AUDIO_RADIUS_X;x<=px+AUDIO_RADIUS_X;x++){
      audioRuntime.visited++;
      let tile;
      try{ tile=getTile(x,y); }catch(e){ audioRuntime.errors++; continue; }
      const def=getByTile(tile);
      const dist2=(x-px)*(x-px)+(y-py)*(y-py);
      if(def && def.tile===T.RADIO && (!nearestRadio || dist2<nearestRadio.dist2)) nearestRadio={x,y,dist2};
      if(!def || !def.sound || !FURNISHING_SOUND_PROFILES[def.sound]) continue;
      const old=nearest.get(def.sound);
      if(!old || dist2<old.dist2) nearest.set(def.sound,{sound:def.sound,x,y,dist2});
    }
  }
  try{
    if(nearestRadio && typeof audio.setRadioSource==='function') audio.setRadioSource(nearestRadio.x+.5,nearestRadio.y+.5);
    else if(!nearestRadio && typeof audio.clearRadioSource==='function') audio.clearRadioSource();
  }catch(e){ audioRuntime.errors++; }
  const candidates=[...nearest.values()].sort((a,b)=>a.dist2-b.dist2 || a.sound.localeCompare(b.sound));
  audioRuntime.lastCandidates=candidates.length;
  let played=0;
  for(const candidate of candidates){
    const previous=audioRuntime.nextBySound.get(candidate.sound);
    if(previous==null){
      audioRuntime.nextBySound.set(candidate.sound,audioRuntime.clockMs+soundDelayMs(candidate.sound,candidate.x,candidate.y,0,true));
      continue;
    }
    if(audioRuntime.clockMs<previous || played>=AUDIO_MAX_PLAYS_PER_SCAN) continue;
    try{
      audio.play(candidate.sound,{x:candidate.x+.5,y:candidate.y+.5,bus:HOME_AUDIO_BUS,send:.14});
      played++; audioRuntime.plays++;
    }catch(e){ audioRuntime.errors++; }
    audioRuntime.nextBySound.set(candidate.sound,audioRuntime.clockMs+soundDelayMs(candidate.sound,candidate.x,candidate.y,audioRuntime.plays,false));
  }
  return played>0;
}

export const furnishings = {
  FURNISHINGS,
  definitions:FURNISHINGS,
  resources:FURNISHING_RESOURCES,
  byTile:FURNISHING_BY_TILE,
  byKey:FURNISHING_BY_KEY,
  getByTile,
  getByKey,
  getFurnishing,
  isFurnishingTile,
  furnishingTierAtDistance,
  selectFurnishingsForDistance,
  furnishingTraderOffer,
  furnishingTraderOffersForDistance,
  rollChestFurnishing,
  distanceBands:FURNISHING_DISTANCE_BANDS,
  frontierDistance:FURNISHING_FRONTIER_DISTANCE,
  chestChances:FURNISHING_CHEST_CHANCES,
  findNearestRadio,
  createRecipes,
  drawTile,
  drawPreview,
  drawEffects,
  updateAudio,
  resetRuntimeCaches,
  soundProfiles:FURNISHING_SOUND_PROFILES,
  _debug:Object.freeze({runtimeMetrics,resetRuntimeCaches})
};

if(typeof window!=='undefined'){
  window.MM=window.MM||{};
  window.MM.furnishings=furnishings;
}

export default furnishings;
