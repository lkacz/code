// Data-driven home workshop: 32 craftable fixtures, their inventory/recipe
// contract and all procedural canvas art. Keeping those concerns together makes
// the catalogue append-only and lets the recipe book, hot picker and world use
// exactly the same visual source.
import { T, INFO, TILE, HOME_FURNISHING_TILE_SPECS } from '../constants.js';
import { isSolidCollisionTile } from './material_physics.js';

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
  {tileName:'MIRROR',label:'Lustro obserwatora',description:'Prawdziwe lustro ścienne: odbija aktualny wygląd, ruch, pelerynę i trzymaną broń bohatera.',tier:2,cost:{glass:4,steel:1,gold:1},icon:'◫',visual:'mirror',effect:'mirror'},

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

export const FURNISHING_PLACEMENTS = Object.freeze({
  FLOOR:'floor',
  FLOOR_OR_TABLE:'floor_or_table',
  FLOOR_OR_CEILING:'floor_or_ceiling',
  WALL:'wall',
});

// Placement is deliberately explicit for the exceptional silhouettes. Every
// unlisted furnishing stands on the floor; small devices/decor may additionally
// occupy the tile directly above the catalogue's table. Wall pieces use the
// construction-background layer, while hanging decor may rest on the floor or
// mount beneath real ceiling support, never on an unrelated side wall.
const TABLETOP_NAMES=new Set([
  'POTTED_FERN','AQUARIUM','TERRARIUM','HOLOGRAM_ART','DESK_LAMP','RADIO',
  'TELEVISION','GAME_CONSOLE','COFFEE_MACHINE','MEMORY_PROJECTOR','CHRONO_CLOCK',
  'MINIATURE_SUN','COSMIC_ORRERY'
]);
const WALL_NAMES=new Set(['WALL_SHELF','WALL_CLOCK','MIRROR']);
const HANGING_NAMES=new Set(['CHANDELIER']);
function placementForName(name){
  if(WALL_NAMES.has(name)) return FURNISHING_PLACEMENTS.WALL;
  if(HANGING_NAMES.has(name)) return FURNISHING_PLACEMENTS.FLOOR_OR_CEILING;
  if(TABLETOP_NAMES.has(name)) return FURNISHING_PLACEMENTS.FLOOR_OR_TABLE;
  return FURNISHING_PLACEMENTS.FLOOR;
}

// Energy units per simulated second. A solar panel reaches 0.18 E/s only near
// clear noon; its full-day average is deliberately much lower. Small homes can
// lean on solar, while continuous loads still reward storage plus wind/hydro.
const HOME_POWER_DRAW=Object.freeze({
  AQUARIUM:.03, HOLOGRAM_ART:.06, DESK_LAMP:.025, RADIO:.035,
  TELEVISION:.06, GAME_CONSOLE:.05, REFRIGERATOR:.045, COFFEE_MACHINE:.08,
  AIR_PURIFIER:.06, MEDICAL_STATION:.09, HEALING_POD:.14,
  ZERO_G_LOUNGER:.10, MEMORY_PROJECTOR:.09, CHRONO_CLOCK:.08,
  MINIATURE_SUN:.15, DREAM_SYNTH:.12, COSMIC_ORRERY:.10
});

const SPEC_BY_NAME = new Map(HOME_FURNISHING_TILE_SPECS.map(spec=>[spec[0],spec]));

export const FURNISHINGS = Object.freeze(RAW.map(row=>{
  const spec=SPEC_BY_NAME.get(row.tileName);
  const tile=T[row.tileName];
  if(!spec || tile==null || !INFO[tile]) throw new Error('Invalid furnishing tile contract: '+row.tileName);
  const placement=placementForName(row.tileName);
  const powerDraw=Math.max(0,Number(HOME_POWER_DRAW[row.tileName])||0);
  Object.assign(INFO[tile],{
    furniturePlacement:placement,
    requiresHomePower:powerDraw>0,
    homePowerDraw:powerDraw
  });
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
    placement,
    requiresPower:powerDraw>0,
    powerDraw,
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

export function placementFor(ref){
  const def=getFurnishing(ref);
  if(def) return def.placement;
  const tile=Number(ref);
  return INFO[tile] && INFO[tile].chair ? FURNISHING_PLACEMENTS.FLOOR : null;
}

function safeTile(getTile,x,y){
  if(typeof getTile!=='function' || !Number.isFinite(x) || !Number.isFinite(y)) return T.AIR;
  try{
    const t=getTile(Math.floor(x),Math.floor(y));
    return Number.isInteger(t) && INFO[t] ? t : T.AIR;
  }catch(e){ return T.AIR; }
}
function floorSupportTile(t){ return isSolidCollisionTile(t); }
function tableSupportTile(t){ return t===T.PINE_TABLE; }

// Pure placement contract shared by the ghost preview and the actual placement
// mutation. `getBackground` is the construction back-wall provider.
export function validatePlacement(ref,x,y,getTile,opts={}){
  const placement=placementFor(ref);
  if(!placement) return {ok:true,applies:false};
  if(typeof getTile!=='function') return {ok:false,applies:true,reason:'Brak danych o podparciu'};
  const tx=Math.floor(Number(x)), ty=Math.floor(Number(y));
  if(!Number.isFinite(tx) || !Number.isFinite(ty)) return {ok:false,applies:true,reason:'Nieprawidlowe miejsce'};
  const below=safeTile(getTile,tx,ty+1), above=safeTile(getTile,tx,ty-1);
  const floor=floorSupportTile(below), table=tableSupportTile(below);
  if(placement===FURNISHING_PLACEMENTS.FLOOR) return floor
    ? {ok:true,applies:true,support:'floor'}
    : {ok:false,applies:true,reason:'Ten przedmiot musi stac na podlodze'};
  if(placement===FURNISHING_PLACEMENTS.FLOOR_OR_TABLE) return floor||table
    ? {ok:true,applies:true,support:table?'table':'floor'}
    : {ok:false,applies:true,reason:'Postaw na podlodze albo bezposrednio na stole'};
  if(placement===FURNISHING_PLACEMENTS.FLOOR_OR_CEILING){
    if(floorSupportTile(above)) return {ok:true,applies:true,support:'ceiling'};
    if(floor) return {ok:true,applies:true,support:'floor'};
    return {ok:false,applies:true,reason:'Ten element wymaga podlogi pod nim albo sufitu bezposrednio nad nim'};
  }
  if(placement===FURNISHING_PLACEMENTS.WALL){
    let background=T.AIR;
    try{ if(typeof opts.getBackground==='function') background=opts.getBackground(tx,ty); }catch(e){ background=T.AIR; }
    const wall=Number.isInteger(background) && !!INFO[background] && background!==T.AIR && isSolidCollisionTile(background);
    return wall
      ? {ok:true,applies:true,support:'wall'}
      : {ok:false,applies:true,reason:'Ten przedmiot wymaga sciany w tle'};
  }
  return {ok:false,applies:true,reason:'Nieobslugiwany sposob montazu'};
}

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
  const selected=selectFurnishingsForDistance(worldX,seed,count);
  // Tier-two is the first expedition band where the mirror can be learned.
  // Houses retain varied showcases, but every Ir-trader visit in this band has
  // one guaranteed mirror slot so old saves and unlucky house rolls always have
  // a deterministic discovery route without unlocking the recipe at spawn.
  if(furnishingTierAtDistance(worldX)===2 && selected.length>=2){
    const mirror=getByTile(T.MIRROR);
    if(mirror && !selected.includes(mirror)) selected[selected.length-1]=mirror;
  }
  return selected.map(furnishingTraderOffer).filter(Boolean);
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

function powerNetworkApi(power){ return power && (power.network||power.teleporters); }
function powerNetworkTileProvider(getTile,power){
  return power && typeof power.getNetworkTile==='function' ? power.getNetworkTile : getTile;
}
function availablePowerAt(x,y,getTile,power){
  const network=powerNetworkApi(power);
  const netGet=powerNetworkTileProvider(getTile,power);
  if(network && typeof network.availableNetworkEnergyAt==='function'){
    try{ return Math.max(0,Number(network.availableNetworkEnergyAt(x,y,netGet,power && power.dynamo))||0); }catch(e){}
  }
  // Small fallback for isolated tests/older saves: a source immediately beside
  // the device is a valid direct connection even when the network helper is not
  // present. Normal gameplay uses the canonical network API above.
  let total=0;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const sx=x+dx, sy=y+dy, tile=safeTile(netGet,sx,sy);
    if((tile===T.DYNAMO || tile===T.DYNAMO_SLOT) && power && power.dynamo && typeof power.dynamo.energyAt==='function'){
      try{ total+=Math.max(0,Number(power.dynamo.energyAt(sx,sy,netGet))||0); }catch(e){}
    }else if((tile===T.SOLAR_PANEL || tile===T.SOLAR_BATTERY) && power && power.solar && typeof power.solar.energyAt==='function'){
      try{ total+=Math.max(0,Number(power.solar.energyAt(sx,sy,netGet))||0); }catch(e){}
    }
  }
  return total;
}

const POWER_STATE_TTL_MS=1250;
const POWER_SCAN_INTERVAL=.5;
const POWER_RADIUS_X=20;
const POWER_RADIUS_Y=14;
const LOCAL_POWER_SECONDS=90;
const POWER_REMOTE_INTERVAL=1;
const POWER_CATCHUP_MAX_SECONDS=1800;
const POWER_STATE_CAP=1600;
const powerRuntime={scanT:0,remoteT:0,clockMs:0,states:new Map(),lastGetTile:null,scans:0,remoteTicks:0,visited:0,drained:0,changes:0,errors:0};

function ensurePowerState(x,y,getTile,tileHint){
  x=Math.floor(Number(x)); y=Math.floor(Number(y));
  if(!Number.isFinite(x)||!Number.isFinite(y)) return null;
  const tile=tileHint==null ? safeTile(getTile,x,y) : tileHint;
  const def=getByTile(tile);
  if(!def || !def.requiresPower) return null;
  const k=x+','+y;
  let state=powerRuntime.states.get(k);
  if(!state){
    if(powerRuntime.states.size>=POWER_STATE_CAP) return null;
    state={x,y,tile,powered:false,at:powerRuntime.clockMs,draw:def.powerDraw,localEnergy:0};
    powerRuntime.states.set(k,state);
  }
  state.x=x; state.y=y; state.tile=tile; state.draw=def.powerDraw;
  state.localEnergy=Math.max(0,Number(state.localEnergy)||0);
  return state;
}

export function isPoweredAt(x,y,getTile,power){
  const tile=safeTile(getTile,x,y);
  const def=getByTile(tile);
  if(!def || !def.requiresPower) return true;
  const k=Math.floor(x)+','+Math.floor(y);
  const state=powerRuntime.states.get(k);
  if(state && state.tile===tile && powerRuntime.clockMs-state.at<=POWER_STATE_TTL_MS) return !!state.powered;
  if(!power) return false;
  return availablePowerAt(Math.floor(x),Math.floor(y),getTile,power)>1e-6;
}

export function receiveElectricChargeAt(x,y,amount,getTile){
  x=Math.floor(Number(x)); y=Math.floor(Number(y));
  const tile=safeTile(getTile || (globalThis.MM && globalThis.MM.world && globalThis.MM.world.getTile),x,y);
  const def=getByTile(tile);
  if(!def || !def.requiresPower) return 0;
  const state=ensurePowerState(x,y,getTile,tile);
  if(!state) return 0;
  const capacity=Math.max(.5,def.powerDraw*LOCAL_POWER_SECONDS);
  const before=Math.max(0,Math.min(capacity,Number(state.localEnergy)||0));
  state.localEnergy=Math.min(capacity,before+Math.max(0,Number(amount)||0));
  if(state.localEnergy>before){ state.powered=true; state.at=powerRuntime.clockMs; }
  return state.localEnergy-before;
}

function drainPowerAt(x,y,amount,getTile,power){
  const want=Math.max(0,Number(amount)||0);
  if(want<=0) return 0;
  const network=powerNetworkApi(power);
  const netGet=powerNetworkTileProvider(getTile,power);
  if(network && typeof network.drainNetworkEnergyAt==='function'){
    try{ return Math.max(0,Number(network.drainNetworkEnergyAt(x,y,want,netGet,power && power.dynamo,{fair:true}))||0); }catch(e){ powerRuntime.errors++; return 0; }
  }
  // Read-only power adapters can still drive visuals/tests; production always
  // supplies drainNetworkEnergyAt so real sources pay the continuous cost.
  return availablePowerAt(x,y,getTile,power)>1e-6 ? want : 0;
}

function tickPowerState(k,state,elapsed,getTile,power){
  if(!state || !(elapsed>0)) return {changed:false,drained:0};
  const x=Number.isFinite(state.x) ? state.x : +(k.slice(0,k.indexOf(',')));
  const y=Number.isFinite(state.y) ? state.y : +(k.slice(k.indexOf(',')+1));
  const tile=safeTile(getTile,x,y), def=getByTile(tile);
  if(!def || !def.requiresPower || tile!==state.tile){
    powerRuntime.states.delete(k);
    return {changed:true,drained:0};
  }
  const wanted=Math.max(.000001,def.powerDraw*elapsed);
  const local=Math.min(wanted,Math.max(0,Number(state.localEnergy)||0));
  state.localEnergy=Math.max(0,(Number(state.localEnergy)||0)-local);
  const paid=local+drainPowerAt(x,y,wanted-local,getTile,power);
  const powered=paid+1e-8>=wanted;
  const changed=state.powered!==powered;
  if(changed){
    state.powered=powered;
    powerRuntime.changes++;
    try{ if(power && typeof power.onStateChanged==='function') power.onStateChanged(x,y,powered,def); }catch(e){ powerRuntime.errors++; }
  }
  state.x=x; state.y=y; state.at=powerRuntime.clockMs; state.draw=def.powerDraw;
  const drained=Math.min(wanted,paid);
  powerRuntime.drained+=drained;
  return {changed,drained};
}

export function updatePower(dt,player,getTile,power){
  const step=Math.max(0,Math.min(1,Number(dt)||0));
  powerRuntime.clockMs+=step*1000;
  powerRuntime.lastGetTile=getTile;
  if(!player || typeof getTile!=='function') return false;
  const px=Math.floor(Number(player.x)), py=Math.floor(Number(player.y));
  if(!Number.isFinite(px) || !Number.isFinite(py)) return false;
  let changed=false;
  powerRuntime.scanT-=step;
  if(powerRuntime.scanT<=0){
    powerRuntime.scanT=POWER_SCAN_INTERVAL;
    powerRuntime.scans++;
    for(let y=py-POWER_RADIUS_Y;y<=py+POWER_RADIUS_Y;y++){
      for(let x=px-POWER_RADIUS_X;x<=px+POWER_RADIUS_X;x++){
        powerRuntime.visited++;
        const tile=safeTile(getTile,x,y), def=getByTile(tile);
        if(!def || !def.requiresPower) continue;
        ensurePowerState(x,y,getTile,tile);
      }
    }
  }
  powerRuntime.remoteT+=step;
  const remoteStep=powerRuntime.remoteT>=POWER_REMOTE_INTERVAL ? powerRuntime.remoteT : 0;
  if(remoteStep>0){ powerRuntime.remoteT=0; powerRuntime.remoteTicks++; }
  // Drain continuously rather than in a half-second lump. This puts household
  // electronics in the same per-frame fair allocator as pumps, turrets and
  // teleporter batteries, so scan cadence cannot distort their network share.
  for(const [k,state] of powerRuntime.states){
    const x=Number.isFinite(state.x) ? state.x : 0;
    const y=Number.isFinite(state.y) ? state.y : 0;
    const nearby=Math.abs(x-px)<=POWER_RADIUS_X && Math.abs(y-py)<=POWER_RADIUS_Y;
    const elapsed=nearby ? step : remoteStep;
    if(!(elapsed>0)) continue;
    if(tickPowerState(k,state,elapsed,getTile,power).changed) changed=true;
  }
  return changed;
}

export function catchUpPower(dt,getTile,power){
  const elapsed=Math.max(0,Math.min(POWER_CATCHUP_MAX_SECONDS,Number(dt)||0));
  if(!(elapsed>0) || typeof getTile!=='function') return false;
  powerRuntime.clockMs+=elapsed*1000;
  powerRuntime.lastGetTile=getTile;
  let changed=false;
  for(const [k,state] of powerRuntime.states){
    if(tickPowerState(k,state,elapsed,getTile,power).changed) changed=true;
  }
  return changed;
}

export function onPowerTileChanged(x,y,oldTile,newTile,getTile){
  const tx=Math.floor(Number(x)), ty=Math.floor(Number(y));
  if(!Number.isFinite(tx)||!Number.isFinite(ty) || oldTile===newTile) return false;
  const id=tx+','+ty;
  const oldDef=getByTile(oldTile), nextDef=getByTile(newTile);
  if(oldDef && oldDef.requiresPower && (!nextDef || !nextDef.requiresPower)) powerRuntime.states.delete(id);
  if(nextDef && nextDef.requiresPower) return !!ensurePowerState(tx,ty,getTile,newTile);
  return false;
}

export function snapshotPower(){
  const getTile=powerRuntime.lastGetTile;
  const list=[];
  for(const state of powerRuntime.states.values()){
    if(!state || !Number.isFinite(state.x)||!Number.isFinite(state.y)) continue;
    if(getTile && safeTile(getTile,state.x,state.y)!==state.tile) continue;
    const def=getByTile(state.tile);
    if(!def || !def.requiresPower) continue;
    list.push({x:state.x,y:state.y,tile:state.tile,powered:!!state.powered,energy:+Math.max(0,Number(state.localEnergy)||0).toFixed(3)});
    if(list.length>=POWER_STATE_CAP) break;
  }
  return {v:1,list};
}

export function restorePower(data,getTile){
  powerRuntime.states.clear();
  powerRuntime.remoteT=0;
  powerRuntime.lastGetTile=getTile;
  const list=data && Array.isArray(data.list) ? data.list : [];
  for(const raw of list.slice(0,POWER_STATE_CAP)){
    if(!raw || !Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y))) continue;
    const x=Math.floor(raw.x), y=Math.floor(raw.y);
    const tile=safeTile(getTile,x,y);
    const state=ensurePowerState(x,y,getTile,tile);
    if(!state) continue;
    const capacity=Math.max(.5,state.draw*LOCAL_POWER_SECONDS);
    state.localEnergy=Math.max(0,Math.min(capacity,Number(raw.energy)||0));
    state.powered=!!raw.powered;
    state.at=powerRuntime.clockMs;
  }
  return powerRuntime.states.size;
}

export const FURNISHING_RESOURCES = Object.freeze(FURNISHINGS.map(def=>Object.freeze({
  key:def.key,
  label:def.label,
  color:def.color,
  tile:def.tileName,
  furniture:true,
  placeableInHome:true,
  furnitureCategory:def.category,
  placement:def.placement,
  requiresPower:def.requiresPower,
  powerDraw:def.powerDraw,
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
    placement:def.placement,
    requiresPower:def.requiresPower,
    powerDraw:def.powerDraw,
    homeRegenBonus:def.homeRegenBonus,
    ambientSound:def.sound,
    home:{tile:def.tile,tier:def.tier,bonus:def.homeRegenBonus,category:def.category,
      placement:def.placement,requiresPower:def.requiresPower,powerDraw:def.powerDraw},
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
    case 'mirror': {
      rect(g,px+3,py+1,14,18,'#6b4b2b'); rect(g,px+4,py+2,12,16,'#d3a85c');
      const glass=g.createLinearGradient(px+5,py+3,px+15,py+17);
      glass.addColorStop(0,'#dff7ff'); glass.addColorStop(.42,'#7298a9'); glass.addColorStop(1,'#243d4b');
      rect(g,px+5,py+3,10,14,glass);
      line(g,px+6,py+5,px+10,py+3,'rgba(255,255,255,.76)',1);
      line(g,px+5,py+15,px+8,py+17,'rgba(84,126,145,.7)',1);
      rect(g,px+8,py,4,1,'#efcc7a'); rect(g,px+8,py+19,4,1,deep); break;
    }
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

function drawPowerOff(g,def,px,py,s){
  const u=s/TILE;
  g.save();
  g.globalCompositeOperation='source-over';
  g.fillStyle='rgba(2,7,12,.34)';
  g.fillRect(px+2*u,py+2*u,s-4*u,s-4*u);
  circle(g,px+17*u,py+3*u,Math.max(.65,u),'#5f1920','#ff6670',Math.max(1,u*.7));
  g.globalAlpha=.72;
  fxLine(g,px+3*u,py+18*u,px+7*u,py+18*u,'#38434d',Math.max(1,u),1);
  g.restore();
}

const EFFECT_CACHE_TTL_MS=240;
const EFFECT_CACHE_MAX_ITEMS=512;
const EFFECT_VIEW_MAX_X=192;
const EFFECT_VIEW_MAX_Y=108;
const effectCache={provider:null,key:'',expires:0,cells:[],scans:0,hits:0,visited:0,errors:0,truncated:false};
const mirrorFallbackCache={provider:null,key:'',expires:0,cells:[],scans:0};

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
  mirrorFallbackCache.provider=null; mirrorFallbackCache.key=''; mirrorFallbackCache.expires=0;
  mirrorFallbackCache.cells=[]; mirrorFallbackCache.scans=0;
}
export function resetRuntimeCaches(){
  resetEffectCache();
  audioRuntime.scanT=0; audioRuntime.clockMs=0; audioRuntime.nextBySound.clear();
  audioRuntime.scans=0; audioRuntime.visited=0; audioRuntime.plays=0; audioRuntime.errors=0; audioRuntime.lastCandidates=0;
  powerRuntime.scanT=0; powerRuntime.remoteT=0; powerRuntime.clockMs=0; powerRuntime.states.clear(); powerRuntime.lastGetTile=null;
  powerRuntime.scans=0; powerRuntime.remoteTicks=0; powerRuntime.visited=0; powerRuntime.drained=0; powerRuntime.changes=0; powerRuntime.errors=0;
}
export function runtimeMetrics(){
  return {
    effects:{scans:effectCache.scans,hits:effectCache.hits,visited:effectCache.visited,cached:effectCache.cells.length,errors:effectCache.errors,truncated:effectCache.truncated,
      mirrorFallbackScans:mirrorFallbackCache.scans,mirrorFallbackCached:mirrorFallbackCache.cells.length},
    audio:{scans:audioRuntime.scans,visited:audioRuntime.visited,plays:audioRuntime.plays,errors:audioRuntime.errors,candidates:audioRuntime.lastCandidates,scheduled:audioRuntime.nextBySound.size},
    power:{scans:powerRuntime.scans,remoteTicks:powerRuntime.remoteTicks,visited:powerRuntime.visited,drained:+powerRuntime.drained.toFixed(4),changes:powerRuntime.changes,errors:powerRuntime.errors,tracked:powerRuntime.states.size}
  };
}

function ensureEffectCache(getTile,x0,y0,spanX,spanY,now){
  const x1=x0+spanX+1, y1=y0+spanY+1;
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
}

export function drawEffects(g,tileSize,sx,sy,viewX,viewY,getTile,visible,power){
  if(!g || typeof getTile!=='function') return false;
  const size=Math.max(1,Math.min(512,Number(tileSize)||TILE));
  const x0=Math.floor(Number(sx)||0), y0=Math.floor(Number(sy)||0);
  const spanX=Math.min(EFFECT_VIEW_MAX_X,Math.max(1,Math.ceil(Number(viewX)||1)));
  const spanY=Math.min(EFFECT_VIEW_MAX_Y,Math.max(1,Math.ceil(Number(viewY)||1)));
  const now=typeof performance!=='undefined' && performance.now ? performance.now() : Date.now();
  ensureEffectCache(getTile,x0,y0,spanX,spanY,now);

  let handled=false;
  for(const cell of effectCache.cells){
    let tile;
    try{ tile=getTile(cell.x,cell.y); }catch(e){ effectCache.errors++; continue; }
    const def=getByTile(tile);
    if(!def || def.effect==='still' || def.effect==='mirror') continue;
    if(typeof visible==='function'){
      try{ if(!visible(cell.x,cell.y)) continue; }catch(e){ effectCache.errors++; }
    }
    handled=true;
    if(def.requiresPower && !isPoweredAt(cell.x,cell.y,getTile,power)){
      drawPowerOff(g,def,cell.x*size,cell.y*size,size);
      continue;
    }
    drawEffectFor(g,def,cell.x*size,cell.y*size,size,now,(cell.x*31+cell.y*17)&255);
  }
  return handled;
}

// A full mirror invokes the canonical hero renderer (outfit, cape and weapon),
// so bound duplicate work in deliberately mirror-spammed rooms. The nearest
// four reflectable surfaces remain live; all other mirrors retain their static
// reflective tile art. Rejected callbacks (range/occlusion) do not spend budget.
const MIRROR_MAX_PER_FRAME=4;
const MIRROR_CANDIDATE_MAX=16;
const MIRROR_VISIBILITY_PROBE_MAX=64;

function finitePlayerBody(player){
  if(!player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return null;
  const w=Math.max(.2,Math.min(3,Number(player.w)||.8));
  const h=Math.max(.4,Math.min(4,Number(player.h)||1.8));
  const x=Number(player.x), y=Number(player.y);
  return {x,y,w,h,left:x-w*.5,right:x+w*.5,top:y-h*.5,bottom:y+h*.5};
}

// A side-view mirror represents the foreground plane directly in front of it.
// Merely being nearby is not enough: a useful slice of the hero's body must
// overlap the mirror cell in both axes. This rejects adjacent floors and the
// old "remote miniature" reflection seen through walls or from below.
export function mirrorPlayerOverlap(player,x,y){
  const body=finitePlayerBody(player);
  x=Math.floor(Number(x)); y=Math.floor(Number(y));
  if(!body || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const overlapX=Math.max(0,Math.min(body.right,x+1)-Math.max(body.left,x));
  const overlapY=Math.max(0,Math.min(body.bottom,y+1)-Math.max(body.top,y));
  if(overlapX<Math.min(.10,body.w*.18) || overlapY<Math.min(.12,body.h*.12)) return null;
  return {body,overlapX,overlapY,area:overlapX*overlapY};
}

export function mirrorSubjectProjection(player,mirror){
  if(!mirror || !Number.isFinite(Number(mirror.x)) || !Number.isFinite(Number(mirror.y))) return null;
  const hit=mirrorPlayerOverlap(player,mirror.x,mirror.y);
  if(!hit) return null;
  const glassW=Math.max(1,Number(mirror.glassW)||10);
  const glassH=Math.max(1,Number(mirror.glassH)||14);
  const centerX=Number.isFinite(Number(mirror.centerX)) ? Number(mirror.centerX) : (Number(mirror.x)+.5)*TILE;
  const centerY=Number.isFinite(Number(mirror.centerY)) ? Number(mirror.centerY) : (Number(mirror.y)+.5)*TILE;
  const dx=Math.max(-1,Math.min(1,(hit.body.x-(Number(mirror.x)+.5))/(.5+hit.body.w*.5)));
  const dy=Math.max(-1,Math.min(1,(hit.body.y-(Number(mirror.y)+.5))/(.5+hit.body.h*.5)));
  const fit=Math.min(glassW/(hit.body.w*TILE*1.06),glassH/(hit.body.h*TILE*1.04));
  return {
    scale:Math.max(.12,Math.min(.72,fit)),
    // Horizontal motion is optically reversed; vertical motion is preserved.
    centerX:centerX-dx*glassW*.28,
    centerY:centerY+dy*glassH*.28,
    overlapX:hit.overlapX,
    overlapY:hit.overlapY
  };
}

export function findMirrorAtPlayer(player,getTile){
  const body=finitePlayerBody(player);
  if(!body || typeof getTile!=='function') return null;
  const left=Math.floor(body.left+.001), right=Math.floor(body.right-.001);
  const top=Math.floor(body.top+.001), bottom=Math.floor(body.bottom-.001);
  let best=null;
  for(let y=top;y<=bottom;y++){
    for(let x=left;x<=right;x++){
      let tile;
      try{ tile=getTile(x,y); }catch(e){ continue; }
      if(tile!==T.MIRROR) continue;
      const hit=mirrorPlayerOverlap(player,x,y);
      if(hit && (!best || hit.area>best.area)) best={x,y,area:hit.area,overlapX:hit.overlapX,overlapY:hit.overlapY};
    }
  }
  return best;
}

function fallbackMirrorCells(getTile,x0,y0,spanX,spanY,px,py,now,maxDistance){
  const radius=Math.max(2,Math.min(24,Number(maxDistance)||10));
  const left=Math.max(x0,Math.floor(px-radius-1));
  const right=Math.min(x0+spanX+1,Math.ceil(px+radius+1));
  const top=Math.max(y0,Math.floor(py-radius-1));
  const bottom=Math.min(y0+spanY+1,Math.ceil(py+radius+1));
  if(right<left || bottom<top) return [];
  const key=left+','+top+','+right+','+bottom+','+Math.floor(px)+','+Math.floor(py);
  if(mirrorFallbackCache.provider===getTile && mirrorFallbackCache.key===key && now<mirrorFallbackCache.expires){
    return mirrorFallbackCache.cells;
  }
  const found=[];
  for(let y=top;y<=bottom;y++){
    for(let x=left;x<=right;x++){
      let tile;
      try{ tile=getTile(x,y); }catch(e){ effectCache.errors++; continue; }
      if(tile!==T.MIRROR) continue;
      const dx=x+.5-px, dy=y+.5-py;
      found.push({x,y,tile,dist2:dx*dx+dy*dy});
    }
  }
  found.sort((a,b)=>a.dist2-b.dist2 || a.y-b.y || a.x-b.x);
  mirrorFallbackCache.provider=getTile;
  mirrorFallbackCache.key=key;
  mirrorFallbackCache.expires=now+EFFECT_CACHE_TTL_MS;
  mirrorFallbackCache.cells=found.slice(0,MIRROR_VISIBILITY_PROBE_MAX).map(({x,y,tile})=>({x,y,tile}));
  mirrorFallbackCache.scans++;
  return mirrorFallbackCache.cells;
}

// Mirrors are composited after actors and machines. The callback deliberately
// owns the reflected subject so this catalogue module stays independent of the
// hero renderer, while the clip guarantees even a faulty callback cannot paint
// outside the glass. Repainting the narrow inner rim keeps the cached pixel-art
// frame crisp above the live reflection.
export function drawMirrors(g,tileSize,sx,sy,viewX,viewY,getTile,visible,opts={}){
  if(!g || typeof getTile!=='function' || typeof opts.renderReflection!=='function') return false;
  const size=Math.max(1,Math.min(512,Number(tileSize)||TILE));
  const x0=Math.floor(Number(sx)||0), y0=Math.floor(Number(sy)||0);
  const spanX=Math.min(EFFECT_VIEW_MAX_X,Math.max(1,Math.ceil(Number(viewX)||1)));
  const spanY=Math.min(EFFECT_VIEW_MAX_Y,Math.max(1,Math.ceil(Number(viewY)||1)));
  const now=typeof performance!=='undefined' && performance.now ? performance.now() : Date.now();
  ensureEffectCache(getTile,x0,y0,spanX,spanY,now);

  const player=opts.player;
  const px=player && Number.isFinite(Number(player.x)) ? Number(player.x) : x0+spanX*.5;
  const py=player && Number.isFinite(Number(player.y)) ? Number(player.y) : y0+spanY*.5;
  // A tall actor can geometrically cross two stacked cells. Only the mirror
  // with the largest covered area is the active foreground plane; rendering
  // every intersected tile would duplicate the hero and shimmer on ties.
  const activeMirror=findMirrorAtPlayer(player,getTile);
  if(!activeMirror) return false;
  const sourceCells=effectCache.truncated
    ? fallbackMirrorCells(getTile,x0,y0,spanX,spanY,px,py,now,opts.maxDistance)
    : effectCache.cells;
  const candidates=[];
  for(const cell of sourceCells){
    // The shared cache can contain hundreds of other animated furnishings.
    // Its recorded tile is safe as a fast rejection; only former mirror cells
    // need one live read to reject removal/replacement during the short TTL.
    if(cell.tile!==T.MIRROR) continue;
    if(cell.x!==activeMirror.x || cell.y!==activeMirror.y) continue;
    const dx=cell.x+.5-px, dy=cell.y+.5-py;
    candidates.push({cell,dist2:dx*dx+dy*dy});
  }
  candidates.sort((a,b)=>a.dist2-b.dist2 || a.cell.y-b.cell.y || a.cell.x-b.cell.x);

  const mirrors=[];
  for(const candidate of candidates.slice(0,MIRROR_VISIBILITY_PROBE_MAX)){
    const {cell,dist2}=candidate;
    if(typeof visible==='function'){
      try{ if(!visible(cell.x,cell.y)) continue; }catch(e){ effectCache.errors++; continue; }
    }
    let tile;
    try{ tile=getTile(cell.x,cell.y); }catch(e){ effectCache.errors++; continue; }
    if(tile!==T.MIRROR) continue;
    mirrors.push({cell,dist2});
    if(mirrors.length>=MIRROR_CANDIDATE_MAX) break;
  }

  let handled=false;
  let liveReflections=0;
  const u=size/TILE;
  for(const entry of mirrors){
    if(liveReflections>=MIRROR_MAX_PER_FRAME) break;
    const {x,y}=entry.cell;
    const tileX=x*size, tileY=y*size;
    const glassX=tileX+5*u, glassY=tileY+3*u;
    const glassW=10*u, glassH=14*u;
    const mirrorGeometry={x,y,size,glassX,glassY,glassW,glassH,centerX:glassX+glassW*.5,centerY:glassY+glassH*.52};
    const projection=mirrorSubjectProjection(player,mirrorGeometry);
    if(!projection) continue;
    let reflected=false;
    g.save();
    try{
      g.beginPath();
      g.rect(glassX,glassY,glassW,glassH);
      g.clip();
      const glass=g.createLinearGradient(glassX,glassY,glassX+glassW,glassY+glassH);
      glass.addColorStop(0,'#dff7ff');
      glass.addColorStop(.48,'#688c9d');
      glass.addColorStop(1,'#203745');
      g.fillStyle=glass;
      g.fillRect(glassX,glassY,glassW,glassH);
      try{
        reflected=opts.renderReflection(g,{
          ...mirrorGeometry,
          distance:Math.sqrt(entry.dist2),
          projection
        })!==false;
      }catch(e){ effectCache.errors++; }
      if(reflected) liveReflections++;

      // A cool tint integrates the reflected sprite with the glass rather than
      // making it look pasted on. The travelling streak gives immediate visual
      // feedback that this is a live surface even while the hero stands still.
      g.globalCompositeOperation='source-over';
      g.fillStyle=reflected?'rgba(113,180,205,.16)':'rgba(105,153,173,.22)';
      g.fillRect(glassX,glassY,glassW,glassH);
      const sweepPeriod=glassW+glassH;
      const rawSweep=now*.018+x*13+y*7;
      const sweep=((rawSweep%sweepPeriod)+sweepPeriod)%sweepPeriod-glassH;
      g.strokeStyle='rgba(240,253,255,.30)';
      g.lineWidth=Math.max(.7,u*.75);
      g.beginPath();
      g.moveTo(glassX+sweep,glassY+glassH);
      g.lineTo(glassX+sweep+glassH,glassY);
      g.stroke();
      handled=true;
    }finally{
      g.restore();
    }

    g.save();
    try{
      g.globalCompositeOperation='source-over';
      g.strokeStyle='rgba(244,218,153,.92)';
      g.lineWidth=Math.max(.75,u*.8);
      g.strokeRect(glassX+.35*u,glassY+.35*u,glassW-.7*u,glassH-.7*u);
      g.fillStyle='rgba(255,255,238,.88)';
      g.fillRect(glassX+1*u,glassY+1*u,Math.max(1,u),Math.max(1,u));
    }finally{
      g.restore();
    }
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
export function updateAudio(dt,player,getTile,audio,power){
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
      const powered=!!(def && (!def.requiresPower || isPoweredAt(x,y,getTile,power)));
      if(def && def.tile===T.RADIO && (!nearestRadio || dist2<nearestRadio.dist2)) nearestRadio={x,y,dist2,powered};
      if(def && def.requiresPower && !powered) continue;
      if(!def || !def.sound || !FURNISHING_SOUND_PROFILES[def.sound]) continue;
      const old=nearest.get(def.sound);
      if(!old || dist2<old.dist2) nearest.set(def.sound,{sound:def.sound,x,y,dist2});
    }
  }
  try{
    if(nearestRadio && typeof audio.setRadioSource==='function') audio.setRadioSource(nearestRadio.x+.5,nearestRadio.y+.5,{powered:nearestRadio.powered});
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
  placementFor,
  validatePlacement,
  placements:FURNISHING_PLACEMENTS,
  isPoweredAt,
  receiveElectricChargeAt,
  updatePower,
  catchUpPower,
  onTileChanged:onPowerTileChanged,
  snapshotPower,
  restorePower,
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
  drawMirrors,
  mirrorPlayerOverlap,
  mirrorSubjectProjection,
  findMirrorAtPlayer,
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
