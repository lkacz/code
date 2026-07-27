// Developer armoury: ONE catalogue of everything the hero can wear or fire, and
// a pure builder that turns a catalogue row plus the panel's knobs into an item
// definition ready for MM.inventory.grantItem.
//
// Three sources feed the debug panel; only the first one lives here:
//   * LOOT    — this file: the procedural axes chests.js genItem can roll
//               (kind x profile), plus literals for what genItem structurally
//               cannot reach (see LITERAL_ROWS).
//   * CRAFT   — main.js: every RECIPES entry, executed without paying its cost.
//   * BUILTIN — inventory.js: the always-owned starter items (equip only).
// Keeping the loot axis here keeps it headless-testable: the catalogue is a data
// table and buildDef() takes its generator as a parameter instead of importing
// chests.js, so tools/gear-forge-sim.test.mjs can drive it with a seeded RNG.
//
// Why literals exist at all — each verified by running the real sanitizer:
//   * genItem's forced-weaponType whitelist is ['melee','bow','flame','hose',
//     'gas','electric'], so 'harpoon', 'bouncy' and 'gravity' are unreachable
//     by rolling;
//   * genItem never writes meleeEffect or mergePerk at any tier;
//   * a perk-LESS pickaxe cannot be forced (above common the perk pool holds no
//     null, and opts.profile only accepts the three perk names).
// 'thrown' is deliberately absent: thrownKind is not in inventory.js's
// ITEM_STR_FIELDS, so a minted thrown weapon comes back with no ammo identity
// and fires nothing (measured). All ten throws are builtins every hero already
// owns — their real test axis is AMMO, not the weapon.

export const TIER_ORDER=['common','uncommon','rare','epic','legendary'];
export const TIER_LABELS={common:'Zwykły', uncommon:'Niezwykły', rare:'Rzadki', epic:'Epicki', legendary:'Legendarny'};

// Mirror of chests.js UNIQUE_NAMES (not exported there). The unique marker is an
// identity string read by antennas.js (cooldown) and the inventory UI, so the
// forge must be able to stamp it on literals too. Pinned against the original in
// tools/gear-forge-sim.test.mjs — drift there breaks this suite on purpose.
export const UNIQUE_MARKERS={cape:'sky_bound', eyes:'deep_vision', outfit:'earth_breaker', charm:'wind_dancer', weapon:'storm_edge', pickaxe:'deep_delver', antenna:'signal_lord'};

// --- Procedural rows: one row per DISTINCT thing genItem can be forced to roll.
// `minTier` records where genItem's own pool check starts accepting the forced
// profile — below it the force silently falls through to a random roll, so the
// panel bumps the tier instead of handing the author a different item than the
// row promised.
export const GEN_ROWS=[
  {kind:'cape',    profile:null,      label:'Peleryna — skoki w powietrzu'},
  {kind:'eyes',    profile:'vision',  label:'Oczy — zasięg widzenia'},
  {kind:'eyes',    profile:'night',   label:'Oczy — noktowizja'},
  {kind:'eyes',    profile:'thermal', label:'Oczy — termowizja'},
  {kind:'outfit',  profile:'mine',    label:'Strój — szybkość kopania'},
  {kind:'outfit',  profile:'move',    label:'Strój — prędkość ruchu'},
  {kind:'outfit',  profile:'jump',    label:'Strój — moc skoku'},
  {kind:'outfit',  profile:'magnet',  label:'Strój — zbieranie łupów'},
  {kind:'outfit',  profile:'crush',   label:'Strój — udźwig/ciśnienie', minTier:'rare'},
  {kind:'charm',   profile:'mine',    label:'Talizman — kopanie'},
  {kind:'charm',   profile:'move',    label:'Talizman — ruch'},
  {kind:'charm',   profile:'jump',    label:'Talizman — skok'},
  {kind:'charm',   profile:'energy',  label:'Talizman — pojemność energii'},
  {kind:'charm',   profile:'swim',    label:'Talizman — pływanie'},
  {kind:'charm',   profile:'magnet',  label:'Talizman — zbieranie łupów'},
  {kind:'charm',   profile:'compass', label:'Talizman — kompas skarbów'},
  {kind:'charm',   profile:'crush',   label:'Talizman — udźwig/ciśnienie', minTier:'rare'},
  {kind:'pickaxe', profile:'lucky',   label:'Kilof — szczęśliwy przebój'},
  {kind:'pickaxe', profile:'double',  label:'Kilof — podwójny urobek'},
  {kind:'pickaxe', profile:'vein',    label:'Kilof — pękająca żyła'},
  {kind:'antenna', profile:'vision',  label:'Antenka — radar (pasywna)'},
  {kind:'antenna', profile:'attack',  label:'Antenka — bojowa (pasywna)'},
  {kind:'antenna', profile:'guard',   label:'Antenka — ochronna (pasywna)'},
  {kind:'antenna', profile:'cloak',   label:'Antenka [Q] — kamuflaż', minTier:'uncommon'},
  {kind:'antenna', profile:'surge',   label:'Antenka [Q] — przepięcie', minTier:'uncommon'},
  {kind:'antenna', profile:'echo',    label:'Antenka [Q] — echolokacja', minTier:'uncommon'},
  {kind:'antenna', profile:'magnet',  label:'Antenka [Q] — zryw łowcy', minTier:'uncommon'},
  {kind:'weapon',  weaponType:'melee',    label:'Broń — biała (klawisz 2)'},
  {kind:'weapon',  weaponType:'bow',      label:'Broń — łuk (klawisz 3)'},
  {kind:'weapon',  weaponType:'flame',    label:'Broń — miotacz ognia (klawisz 4)'},
  {kind:'weapon',  weaponType:'hose',     label:'Broń — wąż wodny (klawisz 4)'},
  {kind:'weapon',  weaponType:'gas',      label:'Broń — emiter gazu (klawisz 4)'},
  {kind:'weapon',  weaponType:'electric', label:'Broń — karabin elektryczny (klawisz 4)'}
];

// --- Literal rows: the axes rolling cannot reach. Numbers copied from the
// crafted originals in main.js RECIPES where one exists, so the forge hands out
// the SAME weapon the crafting ladder does.
export const LITERAL_ROWS=[
  // Aquatic trio — aquaticStyle only survives sanitize when it matches the
  // weaponType it was declared for (trident:melee, crossbow:bow, harpoon:harpoon).
  {id:'lit_aquatic_harpoon', kind:'weapon', label:'Wyrzutnia harpunów (wodna)',
    def:{weaponType:'harpoon', aquaticStyle:'harpoon', name:'Wyrzutnia harpunów', attackDamage:9, fireCooldown:0.68,
      desc:'Pod wodą zachowuje pęd i przebija cele. Na lądzie jest ciężka i wolna'}},
  {id:'lit_aquatic_trident', kind:'weapon', label:'Trójząb stalowy (wodny)',
    def:{weaponType:'melee', aquaticStyle:'trident', meleeEffect:'bleed', name:'Trójząb stalowy', attackDamage:7, fireRange:3,
      desc:'Pod wodą: szybkie pchnięcia, zasięg i siła. Na lądzie jest nieporęczny'}},
  {id:'lit_aquatic_crossbow', kind:'weapon', label:'Kusza podwodna (wodna)',
    def:{weaponType:'bow', aquaticStyle:'crossbow', name:'Kusza podwodna', attackDamage:7, fireCooldown:0.55,
      desc:'Pod wodą szybko napina cięciwę i ogranicza opad. Na lądzie jest słabsza'}},
  // Rubber pistols — weaponType 'bouncy' is outside genItem's roll whitelist.
  {id:'lit_bouncy_plain', kind:'weapon', label:'Pistolet kauczukowy (rykoszet)',
    def:{weaponType:'bouncy', bouncyKind:'plain', name:'Pistolet kauczukowy', attackDamage:3, fireCooldown:0.28,
      desc:'Klawisz 4: kulki kauczukowe. Kulka odbija się od ścian i wrogów — każde odbicie słabsze. PPM = seria'}},
  {id:'lit_bouncy_tar', kind:'weapon', label:'Pistolet smołowy (zapalny rykoszet)',
    def:{weaponType:'bouncy', bouncyKind:'tar', name:'Pistolet smołowy', attackDamage:3, fireCooldown:0.30,
      desc:'Klawisz 4: kulki smołowe. Przeleć kulkę przez ogień — zapalona roznosi pożar rykoszetem'}},
  // Gravity gun — weaponType 'gravity' is outside genItem's roll whitelist.
  {id:'lit_gravity_gun', kind:'weapon', label:'Działko grawitacyjne (wyrywa bloki)',
    def:{weaponType:'gravity', name:'Działko grawitacyjne', attackDamage:2, fireRange:6, energyCost:14,
      desc:'LPM wyrywa blok ze świata (im twardszy, tym dłużej i drożej), PPM go ciska. Materiał decyduje o obrażeniach i skutkach'}},
  // Melee material effects — genItem writes no meleeEffect at any tier.
  {id:'lit_melee_bleed', kind:'weapon', label:'Broń biała — krwawienie',
    def:{weaponType:'melee', meleeEffect:'bleed', name:'Ostrze stalowe', attackDamage:7, desc:'Metalowa krawędź otwiera krwawiące rany'}},
  {id:'lit_melee_stun', kind:'weapon', label:'Broń biała — ogłuszenie',
    def:{weaponType:'melee', meleeEffect:'stun', name:'Obuch kamienny', attackDamage:4, desc:'Kamienny obuch oszałamia trafionego'}},
  {id:'lit_melee_panic', kind:'weapon', label:'Broń biała — panika',
    def:{weaponType:'melee', meleeEffect:'panic', name:'Ostrze diamentowe', attackDamage:9, desc:'Błysk diamentu sieje panikę — trafieni uciekają'}},
  {id:'lit_melee_sunder', kind:'weapon', label:'Broń biała — rozłupanie pancerza',
    def:{weaponType:'melee', meleeEffect:'sunder', name:'Młot bojowy', attackDamage:6, desc:'Ciężki obuch pęka pancerz — cel przyjmuje więcej obrażeń'}},
  // Spear reach: fireRange is the melee LANE, capped at 3 tiles by weapons.js.
  {id:'lit_melee_spear', kind:'weapon', label:'Broń biała — dzida (zasięg 3, ładowana)',
    def:{weaponType:'melee', meleeEffect:'bleed', name:'Dzida metalowa', attackDamage:5, fireRange:3,
      desc:'Poziome pchnięcie na trzy pola; przytrzymaj LPM, aby zwiększyć siłę'}},
  // Merge-forge perks — only mergeWeapons mints these in normal play.
  {id:'lit_merge_vampire', kind:'weapon', label:'Fuzja — wampiryzm',
    def:{weaponType:'melee', mergePerk:'vampire', name:'Ostrze fuzji: wampiryzm', attackDamage:8, desc:'Oddaje ci część zadanego bólu'}},
  {id:'lit_merge_venom', kind:'weapon', label:'Fuzja — jad',
    def:{weaponType:'melee', mergePerk:'venom', name:'Ostrze fuzji: jad', attackDamage:8, desc:'Zatruwa trafiony cel'}},
  {id:'lit_merge_frost', kind:'weapon', label:'Fuzja — szron',
    def:{weaponType:'melee', mergePerk:'frost', name:'Ostrze fuzji: szron', attackDamage:8, desc:'Szron spowalnia trafiony cel'}},
  {id:'lit_merge_storm', kind:'weapon', label:'Fuzja — burza',
    def:{weaponType:'melee', mergePerk:'storm', name:'Ostrze fuzji: burza', attackDamage:8, desc:'Burzowa iskra wstrząsa celem'}},
  {id:'lit_merge_fury', kind:'weapon', label:'Fuzja — furia',
    def:{weaponType:'melee', mergePerk:'fury', name:'Ostrze fuzji: furia', attackDamage:8, desc:'Czasem uderza drugi raz'}},
  {id:'lit_merge_ember', kind:'weapon', label:'Fuzja — żar',
    def:{weaponType:'melee', mergePerk:'ember', name:'Ostrze fuzji: żar', attackDamage:8, desc:'Podpala trafiony cel'}},
  // A pickaxe head with no perk: the plain speed baseline to compare perks against.
  {id:'lit_pickaxe_plain', kind:'pickaxe', label:'Kilof — bez perku (wzorzec)',
    def:{name:'Kilof gładki', mineSpeedMult:1.30, desc:'Sam urobek, żadnego perku — punkt odniesienia dla porównań'}}
];

// One catalogue row per selectable thing. `mode` decides which builder runs.
export const CATALOG=GEN_ROWS.map(row=>({
  id:'gen_'+row.kind+'_'+(row.profile||row.weaponType||'base'),
  mode:'gen',
  group:'loot',
  kind:row.kind,
  profile:row.profile||null,
  weaponType:row.weaponType||null,
  minTier:row.minTier||null,
  label:row.label
})).concat(LITERAL_ROWS.map(row=>({
  id:row.id,
  mode:'lit',
  group:'loot',
  kind:row.kind,
  profile:null,
  weaponType:row.def.weaponType||null,
  minTier:null,
  label:row.label,
  def:row.def
})));

const BY_ID=new Map(CATALOG.map(e=>[e.id,e]));
export function catalogEntry(id){ return BY_ID.get(String(id||''))||null; }
export function catalogFor(kind){ return kind ? CATALOG.filter(e=>e.kind===kind) : CATALOG.slice(); }

// grantItem returns TRUE without adding when the id already exists, so a reused
// id is a silent no-op that still reports success. Every mint gets a fresh one.
export function mintItemId(kind, rand){
  const r=typeof rand==='function'?rand:Math.random;
  return 'dbg_'+String(kind||'item')+'_'+Date.now().toString(36)+r().toString(36).slice(2,5);
}

// sanitizeLootItem DROPS an over-long string instead of truncating it (name 80,
// desc 180), and the UI then falls back to a numeric stub. Trim here so a long
// custom name degrades to a shorter name rather than to no name at all.
function clampText(s, max){
  const t=String(s==null?'':s).replace(/[\u0000-\u001f]+/g,' ').trim();
  return t.length>max ? t.slice(0,max) : t;
}

export function tierAtLeast(tier, min){
  if(!min) return tier;
  const at=TIER_ORDER.indexOf(tier), floor=TIER_ORDER.indexOf(min);
  if(at<0) return min;
  return at<floor ? min : tier;
}

// Build a grantItem-ready definition. opts:
//   tier    — one of TIER_ORDER (raised to the row's minTier when it has one)
//   plus    — signed enhancement level seeded onto the item (adoptSeedEnhancement)
//   unique  — stamp the unique marker / ask genItem for a guaranteed unique roll
//   name    — optional display-name override (weapons.js also picks its render
//             material from the name, so this doubles as a visual test knob)
//   genItem — injected generator (defaults to MM.chests.genItem)
//   rand    — injected RNG (defaults to Math.random)
export function buildDef(entryId, opts){
  opts=opts||{};
  const entry=catalogEntry(entryId);
  if(!entry) return null;
  const rand=typeof opts.rand==='function'?opts.rand:Math.random;
  const tier=tierAtLeast(TIER_ORDER.includes(opts.tier)?opts.tier:'rare', entry.minTier);
  let def=null;
  if(entry.mode==='gen'){
    const gen=typeof opts.genItem==='function'
      ? opts.genItem
      : ((typeof window!=='undefined' && window.MM && window.MM.chests) ? window.MM.chests.genItem : null);
    if(typeof gen!=='function') return null;
    const genOpts={kind:entry.kind};
    if(entry.profile) genOpts.profile=entry.profile;
    if(entry.weaponType) genOpts.weaponType=entry.weaponType;
    if(opts.unique) genOpts.forceUnique=true;
    def=gen(rand, tier, genOpts);
    if(!def || typeof def!=='object') return null;
  }else{
    def=Object.assign({kind:entry.kind}, entry.def);
    if(opts.unique) def.unique=UNIQUE_MARKERS[entry.kind]||'storm_edge';
  }
  def.kind=entry.kind;
  def.tier=tier;
  def.id=mintItemId(entry.kind, rand);
  if(opts.name) def.name=clampText(opts.name,80);
  else if(def.name) def.name=clampText(def.name,80);
  if(def.desc) def.desc=clampText(def.desc,180);
  const plus=Math.trunc(Number(opts.plus)||0);
  if(plus) def.enhancement=Math.max(-99,Math.min(99,plus));
  return def;
}

// --- Ammunition and consumable stock -----------------------------------------
// Every key below is a real window.inv resource (inventory.js RESOURCES). The
// panel hands out whole bundles because a half-stocked hero cannot exercise the
// auto-pick ladders (best owned arrow / best owned throwing stone).
export const AMMO_BUNDLES=[
  {id:'arrows', label:'Strzały (wszystkie tiery)', amount:200,
    keys:['arrowWood','arrowStone','arrowObsidian','arrowDiamond','arrowIridium','arrowHardwood','arrowCarbon','arrowGrapple']},
  {id:'thrown', label:'Rzuty (wszystkie rodzaje)', amount:200,
    keys:['snowball','toxicSnowball','waterBalloon','gasGrenade','stickyBomb','frostFlask','molotov','sand','water']},
  {id:'stones', label:'Kamienie do rzucania (ladder)', amount:200,
    keys:['throwingStone','throwingStoneGranite','throwingStoneBasalt','throwingStoneObsidian','throwingStoneDiamond','throwingStoneMeteorite']},
  {id:'bouncy', label:'Kulki kauczukowe i smołowe', amount:200,
    keys:['rubberBall','rubberBallTar']},
  {id:'harpoon', label:'Bełty harpunowe', amount:200,
    keys:['harpoonBolt']},
  {id:'fuel', label:'Paliwo strumieni (ogień/woda/gaz)', amount:400,
    keys:['wood','coal','water','rottenMeat']},
  {id:'jewels', label:'Klejnoty ulepszeń', amount:40,
    keys:['jewelBlessed','jewelDevout','jewelDivinity']}
];

export function ammoBundle(id){ return AMMO_BUNDLES.find(b=>b.id===String(id||''))||null; }
// Flat [{key,amount}] for one bundle, or for every bundle when id is omitted.
export function ammoGrants(id){
  const list=id ? [ammoBundle(id)].filter(Boolean) : AMMO_BUNDLES;
  const out=[];
  for(const b of list) for(const key of b.keys) out.push({key, amount:b.amount});
  return out;
}

export const gearForge={
  TIER_ORDER, TIER_LABELS, UNIQUE_MARKERS, GEN_ROWS, LITERAL_ROWS, CATALOG,
  catalogEntry, catalogFor, mintItemId, tierAtLeast, buildDef,
  AMMO_BUNDLES, ammoBundle, ammoGrants
};
try{ if(typeof window!=='undefined'){ window.MM=window.MM||{}; window.MM.gearForge=gearForge; } }catch(e){ /* headless test host */ }
export default gearForge;
