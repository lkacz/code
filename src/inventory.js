// Scalable inventory system — core data model (no DOM here; UI lives in inventory_ui.js).
// Replaces the old customization.js "Stylizacja" system. The player has equipment
// slots (cape / eyes / outfit / weapon / charm), a bag of collected loot from chests
// and a resources view over the block inventory.
//
// Rendering/engine contracts kept intact so cape.js / eyes.js / main.js keep working:
//   MM.customization    {capeStyle,eyeStyle,outfitStyle,capeColor,outfitColor}
//   MM.activeModifiers  {maxAirJumps,visionRadius,mineSpeedMult,moveSpeedMult,jumpPowerMult,waterMoveSpeedMult,attackDamage}
//   MM.drawOutfit(ctx,x,y,w,h,style,cust)
// Loot pipeline: window.updateDynamicCustomization syncs chest loot into the bag;
// MM.recomputeModifiers / MM.getModifiers expose the stat engine.
(function(){
  window.MM = window.MM || {};
  const STORAGE_KEY='mm_inventory_v1';
  const LEGACY_CUST_KEY='mm_custom_inv_v1';
  const LEGACY_DISCARD_KEY='mm_discarded_loot_v1';

  // --- Equipment slots (scalable: add an entry here and the UI follows) ---
  const SLOTS=[
    {id:'cape',   label:'Peleryna', accepts:'cape',   required:true,  def:'classic'},
    {id:'eyes',   label:'Oczy',     accepts:'eyes',   required:true,  def:'bright'},
    {id:'outfit', label:'Strój',    accepts:'outfit', required:true,  def:'default'},
    {id:'weapon', label:'Broń',     accepts:'weapon', required:false, def:null, emptyLabel:'Pięści'},
    {id:'charm',  label:'Talizman', accepts:'charm',  required:false, def:null, emptyLabel:'—'}
  ];
  const KIND_LABELS={cape:'Peleryny', eyes:'Oczy', outfit:'Stroje', weapon:'Bronie', charm:'Talizmany'};
  // Loot-tier accent colors (single source — UI badges, held-weapon tinting, …)
  const TIER_COLORS={common:'#b07f2c', rare:'#a74cc9', epic:'#e0b341'};

  // --- Weapon shortcut categories (number keys; key 1 = pickaxe, lives in main.js) ---
  // Pressing a category's key cycles through the owned weapons of its types that the
  // player left enabled for the shortcut (see isShortcut/setShortcut). Adding a new
  // category is one entry here — input handling and the UI badge follow.
  const WEAPON_CATEGORIES=[
    {id:'melee',  key:'2', label:'Broń biała', icon:'⚔️', types:['melee']},
    {id:'bow',    key:'3', label:'Łuki',       icon:'🏹', types:['bow']},
    {id:'stream', key:'4', label:'Miotacze',   icon:'🔥', types:['flame','hose','gas','electric']}
  ];

  // --- Player-facing stat presentation (single source for ALL item stat display) ---
  // Multiplier stats live as multipliers in the engine but the player only ever
  // sees clean signed percentages snapped to a ladder (5%-steps up to 50%, then
  // 10%-steps to 100%, then 25%-steps, capped at 200%). Vision converts to the
  // same percent language against its baseline of 10 tiles. Damage-like stats
  // stay small integers. One shared chip builder + one power score replace the
  // three ad-hoc stat formats the UI used to mix.
  const VISION_BASE=10;
  function pctOf(mult){ return (mult-1)*100; }
  function snapPct(p){
    if(typeof p!=='number' || !isFinite(p)) return 0;
    const a=Math.abs(p); let s;
    if(a<2.5) return 0;
    if(a<=50) s=Math.round(a/5)*5;
    else if(a<=100) s=Math.round(a/10)*10;
    else s=Math.min(200, Math.round(a/25)*25);
    return p<0? -s : s;
  }
  function snapMult(m){ return +(1+snapPct(pctOf(m))/100).toFixed(2); }
  function fmtPct(p){ return (p>0?'+':'')+p+'%'; }
  // Compact stat pills: {icon,label,text,good} — rendered identically by the
  // inventory grid, the stats panel and the loot popup (textContent only).
  function statChips(item){
    const chips=[]; if(!item) return chips;
    if(typeof item.attackDamage==='number' && item.attackDamage)
      chips.push({icon:'⚔️', label:item.weaponType==='bow'?'Strzała':'Obrażenia', text:'+'+item.attackDamage, good:item.attackDamage>0});
    if(item.weaponType==='bow' && typeof item.fireCooldown==='number' && item.fireCooldown>0)
      chips.push({icon:'🏹', label:'Tempo', text:(1/item.fireCooldown).toFixed(1)+'/s', good:true});
    if(typeof item.fireDps==='number'){
      const streamIcon=item.weaponType==='hose'?'💧':item.weaponType==='gas'?'☠️':item.weaponType==='electric'?'⚡':'🔥';
      const streamLabel=item.weaponType==='electric'?'Wiązka':'Strumień';
      chips.push({icon:streamIcon, label:streamLabel, text:item.fireDps+'/s', good:true});
    }
    if(typeof item.fireRange==='number')
      chips.push({icon:'↔️', label:'Zasięg', text:String(item.fireRange), good:true});
    if(typeof item.energyCost==='number' && item.energyCost>0)
      chips.push({icon:'⚡', label:'Zużycie energii', text:item.energyCost+'/s', good:false});
    if(typeof item.energyCapacityBonus==='number' && item.energyCapacityBonus)
      chips.push({icon:'⚡', label:'Pojemność energii', text:(item.energyCapacityBonus>0?'+':'')+item.energyCapacityBonus+'E', good:item.energyCapacityBonus>0});
    if(typeof item.waterMoveSpeedMult==='number' && item.waterMoveSpeedMult)
      chips.push({icon:'~', label:'Ruch w wodzie', text:Math.round(item.waterMoveSpeedMult*100)+'%', good:item.waterMoveSpeedMult>0.5});
    if(typeof item.airJumps==='number' && item.airJumps)
      chips.push({icon:'🪽', label:'Skoki', text:'+'+item.airJumps, good:item.airJumps>0});
    if(typeof item.crushResistBonus==='number' && item.crushResistBonus)
      chips.push({icon:'🪨', label:'Udźwig/ciśnienie', text:'+'+item.crushResistBonus, good:item.crushResistBonus>0});
    if(typeof item.visionRadius==='number'){
      const p=snapPct((item.visionRadius-VISION_BASE)*100/VISION_BASE);
      if(p) chips.push({icon:'👁️', label:'Widzenie', text:fmtPct(p), good:p>0});
    }
    [['moveSpeedMult','🏃','Ruch'],['jumpPowerMult','⬆️','Skok'],['mineSpeedMult','⛏️','Kopanie']].forEach(([k,icon,label])=>{
      if(typeof item[k]==='number'){ const p=snapPct(pctOf(item[k])); if(p) chips.push({icon, label, text:fmtPct(p), good:p>0}); }
    });
    return chips;
  }
  // One comparable power number per item ("Moc"). Weights put every stat on a
  // shared scale (~6 pts per damage point); only meaningful within one kind —
  // the UI sorts and compares items inside a tab / weapon category, never across.
  function itemScore(item){
    if(!item) return 0;
    let s=0;
    if(typeof item.attackDamage==='number') s+=item.attackDamage*6;
    if(typeof item.fireDps==='number') s+=item.fireDps*5;
    if(typeof item.fireRange==='number') s+=item.fireRange*2;
    if(typeof item.energyCost==='number') s-=item.energyCost*0.45;
    if(typeof item.energyCapacityBonus==='number') s+=item.energyCapacityBonus*0.55;
    if(typeof item.waterMoveSpeedMult==='number') s+=(item.waterMoveSpeedMult-0.5)*80;
    if(item.weaponType==='bow' && typeof item.fireCooldown==='number') s+=(0.6-item.fireCooldown)*40; // faster bow = stronger
    if(typeof item.airJumps==='number') s+=item.airJumps*12;
    if(typeof item.crushResistBonus==='number') s+=item.crushResistBonus*10;
    if(typeof item.visionRadius==='number') s+=(item.visionRadius-VISION_BASE)*3;
    ['moveSpeedMult','jumpPowerMult','mineSpeedMult'].forEach(k=>{
      if(typeof item[k]==='number') s+=pctOf(item[k])*0.6;
    });
    return Math.max(0, Math.round(s));
  }

  // Stat metadata: combination rule + display label. sum: additive, mul: multiplicative,
  // max: maximum wins. Unknown stats fall back to "last write wins".
  const STAT_RULES={
    maxAirJumps:'sum',
    visionRadius:'max',
    mineSpeedMult:'mul',
    moveSpeedMult:'mul',
    jumpPowerMult:'mul',
    waterMoveSpeedMult:'max',
    attackDamage:'sum',
    energyCapacityBonus:'sum',
    crushResistBonus:'sum'
  };
  const STAT_LABELS={
    maxAirJumps:'Skoki dodatkowe',
    visionRadius:'Zasięg widzenia',
    moveSpeedMult:'Prędkość ruchu',
    waterMoveSpeedMult:'Ruch w wodzie',
    jumpPowerMult:'Moc skoku',
    mineSpeedMult:'Szybkość kopania',
    attackDamage:'Obrażenia',
    energyCapacityBonus:'Pojemność energii',
    crushResistBonus:'Udźwig/ciśnienie'
  };
  const BASE_ATTACK=3; // bare-handed melee damage

  // --- Built-in items (gear ids preserved from the old customization system) ---
  // One function stat per item (see KIND_STAT_PRIORITY): capes jump, eyes see,
  // outfits carry a single work/movement profile, weapons only their class
  // numbers, charms one passive. Descs are flavor/usage — chips carry the numbers.
  const BUILTIN_ITEMS=[
    // Capes: airJumps = additional mid-air jumps (0 => only ground jump)
    {id:'classic',  kind:'cape', name:'Klasyczna',    airJumps:0, desc:'Tylko skok z ziemi'},
    {id:'triangle', kind:'cape', name:'Trójkątna',    airJumps:1, desc:'Podwójny skok'},
    {id:'royal',    kind:'cape', name:'Królewska',    shiny:true, airJumps:3, desc:'Cztery skoki'},
    {id:'tattered', kind:'cape', name:'Postrzępiona', airJumps:1, desc:'Podwójny skok'},
    {id:'winged',   kind:'cape', name:'Skrzydlata',   shiny:true, airJumps:3, desc:'Cztery skoki'},
    {id:'shadow',   kind:'cape', name:'Cienista',     airJumps:2, desc:'Trzy skoki'},
    // Eyes: visionRadius drives fog reveal (base 10)
    {id:'sleepy', kind:'eyes', name:'Wąskie',     visionRadius:7,  desc:'Przymrużone — niewiele widać'},
    {id:'bright', kind:'eyes', name:'Szerokie',   visionRadius:11, desc:'Czujne spojrzenie'},
    {id:'glow',   kind:'eyes', name:'Przełomowe', visionRadius:15, desc:'Przeszywają mrok'},
    {id:'gold',   kind:'eyes', name:'Złote',      visionRadius:13, desc:'Błyszczą w ciemności'},
    // Outfits: one profile stat each — the suit says how you work, not everything at once
    {id:'default',    kind:'outfit', name:'Podstawowy', desc:'Zwykłe ubranie bez bonusów'},
    {id:'miner',      kind:'outfit', name:'Górnik',  mineSpeedMult:1.5,  desc:'Strój do kopania'},
    {id:'mystic',     kind:'outfit', name:'Mistyk',  jumpPowerMult:1.15, desc:'Lekka szata wędrowca'},
    {id:'ninja',      kind:'outfit', name:'Ninja',   moveSpeedMult:1.20, desc:'Strój cichego zabójcy'},
    {id:'ironperson', kind:'outfit', name:'Iron',    crushResistBonus:2, desc:'Pancerz wzmacnia na zawały i głębiny'},
    // Weapons (starter set; better ones drop from chests).
    // weaponType: 'melee' (default) strikes the aimed tile, 'bow' shoots arrows,
    // 'flame'/'hose'/'gas' streams terrain effects; 'electric' fires an energy beam.
    {id:'stick',        kind:'weapon', weaponType:'melee', name:'Kij',             attackDamage:1, desc:'Prosty kij na początek'},
    {id:'stone_blade',  kind:'weapon', weaponType:'melee', name:'Ostrze kamienne', attackDamage:3, desc:'Ciężkie, ale skuteczne'},
    {id:'spear',        kind:'weapon', weaponType:'melee', name:'Włócznia',        attackDamage:2, desc:'Lekka i poręczna'},
    {id:'bow_wood',     kind:'weapon', weaponType:'bow',   name:'Łuk myśliwski',   attackDamage:4, fireCooldown:0.55, desc:'LPM strzela strzałami; PPM odpala naładowany ult'},
    {id:'flamethrower', kind:'weapon', weaponType:'flame', name:'Miotacz ognia',   fireDps:6, fireRange:6.5, desc:'Strumień ognia (przytrzymaj LPM): podpala wrogów, trawę i drzewa; PPM = ult'},
    {id:'water_hose',   kind:'weapon', weaponType:'hose',  name:'Wąż wodny',       fireDps:2, fireRange:6,   desc:'Strumień wody (przytrzymaj LPM): gasi ogień, czasem zostawia wodę; PPM = ult'},
    {id:'gas_emitter',  kind:'weapon', weaponType:'gas',   name:'Emiter gazu',     fireDps:5, fireRange:5.5, desc:'Trujący obłok (przytrzymaj LPM): zatruwa żywe stworzenia; PPM = ult'},
    {id:'electric_gun',  kind:'weapon', weaponType:'electric', name:'Karabin elektryczny', fireDps:12, fireRange:8.5, energyCost:10, tier:'rare', desc:'Wiązka elektryczna (przytrzymaj LPM): zużywa energię i razi linią jak roboty; PPM = ult'},
    // Charms (passive trinkets; more drop from chests)
    {id:'lucky_pebble', kind:'charm', name:'Kamyk szczęścia', mineSpeedMult:1.05, desc:'Podobno przynosi szczęście'}
  ];

  // --- Resources metadata (bridges the block inventory `window.inv`) ---
  const RESOURCES=[
    {key:'grass',   label:'Trawa',   color:'#2e8b2e', tile:'GRASS'},
    {key:'sand',    label:'Piasek',  color:'#c2b280', tile:'SAND'},
    {key:'clay',    label:'Glina',   color:'#8f7a62', tile:'CLAY'},
    {key:'dirt',    label:'Ziemia',  color:'#73543a', tile:'DIRT'},
    {key:'granite', label:'Granit',  color:'#7d7f87', tile:'GRANITE'},
    {key:'basalt',  label:'Bazalt',  color:'#30333a', tile:'BASALT'},
    {key:'stone',   label:'Skala',   color:'#888a90', tile:'STONE'},
    {key:'coal',    label:'Węgiel',  color:'#25272b', tile:'COAL'},
    {key:'gold',    label:'Złoto',   color:'#f2b93b', tile:'GOLD_ORE'},
    {key:'diamond', label:'Diament', color:'#3ef',    tile:'DIAMOND'},
    {key:'iridium', label:'Iryd',    color:'#b8d7ff', tile:'IRIDIUM'},
    {key:'meteoricIron', label:'Żelazo meteorytowe', color:'#7f878d', tile:'METEORIC_IRON'},
    {key:'radioactiveOre', label:'Ruda radioaktywna', color:'#8aff4f', tile:'RADIOACTIVE_ORE'},
    {key:'alienBiomass', label:'Biomasa obca', color:'#79c95d', tile:'ALIEN_BIOMASS'},
    {key:'ufoConcrete', label:'Beton UFO', color:'#536977', tile:null},
    {key:'motherIce', label:'Lod macierzysty', color:'#d8fbff', tile:'MOTHER_ICE'},
    {key:'motherLava', label:'Lawa macierzysta', color:'#ff7a33', tile:'MOTHER_LAVA'},
    {key:'meteorDust', label:'Pyl meteorytowy', color:'#c8a6ff', tile:'METEOR_DUST'},
    {key:'wood',    label:'Drewno',  color:'#8b5a2b', tile:'WOOD'},
    {key:'ladder',  label:'Drabinka', color:'#b98243', tile:'LADDER'},
    {key:'woodDoor', label:'Drzwi drewniane', color:'#9b6730', tile:'WOOD_DOOR'},
    {key:'stoneDoor', label:'Drzwi kamienne', color:'#8d9098', tile:'STONE_DOOR'},
    {key:'steelDoor', label:'Drzwi stalowe', color:'#9aa8b5', tile:'STEEL_DOOR'},
    {key:'woodTrapdoor', label:'Zapadnia drewniana', color:'#a57136', tile:'WOOD_TRAPDOOR'},
    {key:'stoneTrapdoor', label:'Zapadnia kamienna', color:'#858992', tile:'STONE_TRAPDOOR'},
    {key:'steelTrapdoor', label:'Zapadnia stalowa', color:'#91a0ad', tile:'STEEL_TRAPDOOR'},
    {key:'arrowWood', label:'Strzaly drewniane', color:'#caa472', tile:null},
    {key:'arrowStone', label:'Strzaly kamienne', color:'#9aa0a8', tile:null},
    {key:'arrowObsidian', label:'Strzaly obsydianowe', color:'#7a5cc1', tile:null},
    {key:'arrowDiamond', label:'Strzaly diamentowe', color:'#48f1ff', tile:null},
    {key:'arrowIridium', label:'Strzaly irydowe', color:'#b8d7ff', tile:null},
    {key:'leaf',    label:'Liść',    color:'#2faa2f', tile:'LEAF'},
    {key:'snow',    label:'Śnieg',   color:'#e6f1ff', tile:'SNOW'},
    {key:'water',   label:'Woda',    color:'#2477ff', tile:'WATER'},
    {key:'obsidian',label:'Obsydian',color:'#7a5cc1', tile:'OBSIDIAN'},
    {key:'glass',   label:'Szklo',   color:'#9deeff', tile:'GLASS'},
    {key:'brick',   label:'Cegla',   color:'#a65a3a', tile:'BRICK'},
    {key:'chimney', label:'Komin',   color:'#6b5548', tile:'CHIMNEY'},
    {key:'respawnTotem', label:'Totem odrodzenia', color:'#e23b4e', tile:'RESPAWN_TOTEM'},
    {key:'steel',   label:'Stal',    color:'#8f9aa6', tile:'STEEL'},
    {key:'track',   label:'Gasienica', color:'#48515b', tile:'TRACK'},
    {key:'meat',    label:'Mieso',   color:'#bd5145', tile:'MEAT'},
    {key:'rottenMeat', label:'Zepsute mieso', color:'#647136', tile:'ROTTEN_MEAT'},
    {key:'bakedMeat', label:'Pieczone mieso', color:'#9b5a2e', tile:'BAKED_MEAT'},
    {key:'fish',    label:'Ryba',    color:'#6fb7d9', tile:null},
    {key:'glowshroom', label:'Świecący grzyb', color:'#7de3a8', tile:'GLOWSHROOM'},
    {key:'goldenFish', label:'Złota rybka', color:'#ffd76a', tile:null},
    {key:'fishingRod', label:'Wędka', color:'#b98243', tile:null},
    {key:'wire',    label:'Przewody',color:'#c56f32', tile:'WIRE'},
    {key:'plastic', label:'Plastik', color:'#d7dbe3', tile:null},
    {key:'copper',  label:'Miedz',   color:'#cc7a36', tile:null},
    {key:'copperWire', label:'Przewod miedziany', color:'#d68535', tile:'COPPER_WIRE'},
    {key:'waterPipe', label:'Rura fluidowa', color:'#2d8ec9', tile:'WATER_PIPE'},
    {key:'waterPump', label:'Pompa fluidowa', color:'#58d4ff', tile:'WATER_PUMP'},
    {key:'transistor', label:'Tranzystor', color:'#47d18c', tile:'TRANSISTOR'},
    {key:'dynamo',  label:'Dynamo',  color:'#ffd24a', tile:'DYNAMO'},
    {key:'vendingMachine', label:'Automat vendingowy', color:'#55d7ff', tile:'VENDING_MACHINE'},
    {key:'solarPanel', label:'Panel sloneczny', color:'#2290b2', tile:'SOLAR_PANEL'},
    {key:'solarBattery', label:'Panel sloneczny z bateria', color:'#19b3a8', tile:'SOLAR_BATTERY'},
    {key:'teleporter', label:'Teleporter', color:'#7cf7ff', tile:'TELEPORTER'},
    {key:'antigravityBeacon', label:'Beacon antygrawitacyjny', color:'#c46bff', tile:'ANTIGRAVITY_BEACON'},
    {key:'meteorSiren', label:'Syrena meteorytowa', color:'#ff9f45', tile:'METEOR_SIREN'},
    {key:'craterScanner', label:'Skaner kraterow', color:'#9deeff', tile:null},
    {key:'turret', label:'Wiezyczka', color:'#9fb0c8', tile:'TURRET'},
    {key:'fireTurret', label:'Wiezyczka ogniowa', color:'#ff6a21', tile:'FIRE_TURRET'},
    {key:'waterTurret', label:'Wiezyczka wodna', color:'#38a7ff', tile:'WATER_TURRET'},
    {key:'springPlatform', label:'Platforma sprezynowa', color:'#7cc7d8', tile:'SPRING_PLATFORM'},
    {key:'torch',   label:'Pochodnia',color:'#ffb84a', tile:'TORCH'},
    {key:'masterStone', label:'Kamien mistrza', color:'#ff6a21', tile:'VOLCANO_MASTER_STONE'},
    {key:'servantStone', label:'Kamien slugi', color:'#8b2d17', tile:'SERVANT_STONE'},
    {key:'springAntler', label:'Poroze wiosny', color:'#d8a96b', tile:null},
    {key:'summerHorn', label:'Rog lata', color:'#9b6b38', tile:null},
    {key:'autumnHeartwood', label:'Jesienne twardziel', color:'#b57936', tile:null},
    {key:'winterFur', label:'Zimowe futro', color:'#e8f4ff', tile:null},
    {key:'heartFire', label:'Serce ognia', color:'#ff6a21', tile:null},
    {key:'heartIce', label:'Serce lodu', color:'#9deeff', tile:null},
    {key:'heartEarth', label:'Serce ziemi', color:'#79c95d', tile:null},
    {key:'heartAir', label:'Serce powietrza', color:'#a8d7ff', tile:null},
    {key:'heartMother', label:'Serce macierzyste', color:'#9b8cff', tile:null}, // the center: what remains after meeting yourself
    {key:'antimatter', label:'Antymateria', color:'#c46bff', tile:'ANTIMATTER_CRYSTAL'} // dropped by downed UFOs and rare antimatter meteors
  ];

  // --- State ---
  const state={
    equipped:{cape:'classic', eyes:'bright', outfit:'default', weapon:null, charm:null},
    colors:{cape:'#b91818', outfit:'#f4c05a'},
    bag:[],            // dynamic loot items collected from chests
    discarded:new Set(), // ids the player threw away (never re-added by loot sync)
    shortcutOff:new Set(), // weapon ids excluded from number-key cycling (opt-out: new loot joins its category automatically)
    newItems:new Set() // looted items not yet acknowledged in the inventory UI
  };
  const extraItems=[]; // runtime-registered items (mods/extensions)
  const MAX_BAG=300, MAX_DISCARDED=1000; // localStorage quota guards for long-lived saves
  const discardUndo=[]; // session-only safety net for accidental item deletion
  const DISCARD_UNDO_LIMIT=20;

  // --- Function purity: each kind carries ONLY the stats of its job -----------
  // One item = its function, nothing else: capes jump, eyes see, outfits set one
  // work/movement profile, weapons fight with their class numbers, charms hold a
  // single passive. Tiers make those same numbers bigger — rarity means superior
  // magnitude, never extra unrelated stats. Priority order decides which stat
  // survives when legacy loot carried several (first hit wins).
  const KIND_STAT_PRIORITY={
    cape:['airJumps'],
    eyes:['visionRadius'],
    outfit:['mineSpeedMult','moveSpeedMult','jumpPowerMult','crushResistBonus'],
    charm:['energyCapacityBonus','waterMoveSpeedMult','mineSpeedMult','moveSpeedMult','jumpPowerMult','crushResistBonus']
  };
  const KIND_STAT_MAX={cape:1, eyes:1, outfit:1, charm:1};
  const WEAPON_TYPE_STATS={
    melee:['attackDamage'],
    bow:['attackDamage','fireCooldown'],
    flame:['fireDps','fireRange'],
    hose:['fireDps','fireRange'],
    gas:['fireDps','fireRange'],
    electric:['fireDps','fireRange','energyCost']
  };
  function allowedStatsFor(kind,weaponType){
    if(kind==='weapon') return WEAPON_TYPE_STATS[weaponType||'melee']||WEAPON_TYPE_STATS.melee;
    return KIND_STAT_PRIORITY[kind]||[];
  }

  // Loot items come from localStorage (bag + dynamic-loot keys) — whitelist their
  // fields on ingest so tampered/corrupt entries can't smuggle objects or markup
  // into stat math and innerHTML-based displays downstream.
  const ITEM_NUM_FIELDS=['airJumps','visionRadius','moveSpeedMult','jumpPowerMult','mineSpeedMult','waterMoveSpeedMult','attackDamage','fireDps','fireRange','fireCooldown','energyCost','energyCapacityBonus','crushResistBonus'];
  const ITEM_STR_FIELDS=['name','tier','desc','unique','weaponType'];
  const ITEM_KINDS=new Set(['cape','eyes','outfit','weapon','charm']);
  function sanitizeLootItem(raw,fallbackKind){
    if(!raw || typeof raw!=='object') return null;
    if(typeof raw.id!=='string' || !raw.id || raw.id.length>64) return null;
    const kind=ITEM_KINDS.has(raw.kind)? raw.kind : (ITEM_KINDS.has(fallbackKind)? fallbackKind : null);
    if(!kind) return null;
    const it={id:raw.id, kind};
    ITEM_NUM_FIELDS.forEach(f=>{ const v=raw[f]; if(typeof v==='number' && isFinite(v)) it[f]=v; });
    ITEM_STR_FIELDS.forEach(f=>{ const v=raw[f]; if(typeof v==='string' && v.length<=80) it[f]=v; });
    // Normalize multipliers onto the clean percent ladder: pre-rework loot carries
    // raw rolls like 1.0437 — snapped here once, so every stored item reads clean.
    ['moveSpeedMult','jumpPowerMult','mineSpeedMult'].forEach(f=>{
      if(typeof it[f]==='number'){ const m=snapMult(it[f]); if(m===1) delete it[f]; else it[f]=m; }
    });
    if(typeof it.waterMoveSpeedMult==='number'){
      it.waterMoveSpeedMult=Math.max(0.25, Math.min(1.25, Math.round(it.waterMoveSpeedMult*20)/20));
    }
    // Function purity (also the one-shot migration for pre-rework saves): keep only
    // the stats of this kind's job, at most KIND_STAT_MAX of them in priority order.
    const allowed=allowedStatsFor(kind, it.weaponType);
    const max=kind==='weapon'? allowed.length : (KIND_STAT_MAX[kind]||allowed.length);
    let kept=0;
    allowed.forEach(f=>{ if(typeof it[f]==='number'){ if(kept<max) kept++; else delete it[f]; } });
    ITEM_NUM_FIELDS.forEach(f=>{ if(!allowed.includes(f)) delete it[f]; });
    return it;
  }
  function pushToBag(item, opts){
    opts=opts||{};
    if(state.bag.length>=MAX_BAG && !opts.essential){
      return false;
    }
    state.bag.push(item);
    if(opts.markNew!==false) state.newItems.add(item.id);
    return true;
  }

  function itemsOfKind(kind){ return allItems().filter(i=>i.kind===kind); }
  function allItems(){
    return BUILTIN_ITEMS.concat(extraItems, state.bag).filter(i=>!state.discarded.has(i.id));
  }
  function findItem(id){ if(!id) return null; return allItems().find(i=>i.id===id)||null; }
  function slotFor(kind){ return SLOTS.find(s=>s.accepts===kind)||null; }

  // --- Weapon shortcut categories ---
  function weaponCategory(item){
    if(!item || item.kind!=='weapon') return null;
    const t=item.weaponType||'melee';
    return WEAPON_CATEGORIES.find(c=>c.types.includes(t))||null;
  }
  // Owned weapons of a category, strongest first — the SAME order the inventory
  // grid displays, so the shortcut key cycles exactly what the player sees there
  // (first press = best weapon). includeDisabled lists everything (for the UI);
  // the default view is what the key cycles through.
  function categoryWeapons(catId, includeDisabled){
    return itemsOfKind('weapon').filter(i=>{
      const c=weaponCategory(i);
      return !!c && c.id===catId && (includeDisabled || !state.shortcutOff.has(i.id));
    }).sort((a,b)=>itemScore(b)-itemScore(a));
  }
  function isShortcut(itemId){ return !state.shortcutOff.has(itemId); }
  function setShortcut(itemId,on){
    const item=findItem(itemId);
    if(!item || item.kind!=='weapon') return false;
    if(on) state.shortcutOff.delete(itemId); else state.shortcutOff.add(itemId);
    notifyChange({key:'shortcut', value:itemId});
    return true;
  }
  // Equip the next enabled weapon of the category (wraps; entering from another
  // category or from bare hands starts at the first). Returns the item or null.
  function cycleWeaponCategory(catId){
    const list=categoryWeapons(catId);
    if(!list.length) return null;
    const idx=list.findIndex(i=>i.id===state.equipped.weapon);
    const next=list[(idx+1)%list.length]; // idx -1 → list[0]
    equip(next.id);
    return next;
  }

  // --- Compat: MM.customization mirrors the equipped gear for renderers ---
  if(!MM.customization) MM.customization={};
  function syncCustomization(){
    const c=MM.customization;
    c.capeStyle=state.equipped.cape||'classic';
    c.eyeStyle=state.equipped.eyes||'bright';
    c.outfitStyle=state.equipped.outfit||'default';
    c.capeColor=state.colors.cape;
    c.outfitColor=state.colors.outfit;
  }
  // Legacy code paths may write MM.customization directly; adopt those writes.
  function adoptCustomizationWrites(){
    const c=MM.customization; if(!c) return;
    if(c.capeStyle && c.capeStyle!==state.equipped.cape && findItem(c.capeStyle)) state.equipped.cape=c.capeStyle;
    if(c.eyeStyle && c.eyeStyle!==state.equipped.eyes && findItem(c.eyeStyle)) state.equipped.eyes=c.eyeStyle;
    if(c.outfitStyle && c.outfitStyle!==state.equipped.outfit && findItem(c.outfitStyle)) state.equipped.outfit=c.outfitStyle;
    if(c.capeColor) state.colors.cape=c.capeColor;
    if(c.outfitColor) state.colors.outfit=c.outfitColor;
  }

  // --- Stat engine ---
  function applyStat(mods,key,val){
    if(val==null) return;
    const rule=STAT_RULES[key];
    if(rule==='sum'){ mods[key]=(mods[key]||0)+val; }
    else if(rule==='mul'){ mods[key]=(mods[key]==null?1:mods[key])*val; }
    else if(rule==='max'){ mods[key]=Math.max(mods[key]||0,val); }
    else { mods[key]=val; }
  }
  function clampRange(v,min,max){ return Math.min(max, Math.max(min,v)); }
  // Pluggable stat providers beyond equipment (progress.js registers one at boot)
  const MODIFIER_SOURCES=[];
  function registerModifierSource(name,fn){
    if(typeof fn!=='function') return false;
    MODIFIER_SOURCES.push({name,fn});
    try{ computeModifiers(); }catch(e){ /* boot order: compute runs again later */ }
    return true;
  }
  function statContributions(item,fn){
    if(!item) return;
    if(typeof item.airJumps==='number') fn('maxAirJumps', item.airJumps);
    if(typeof item.visionRadius==='number') fn('visionRadius', item.visionRadius);
    if(typeof item.mineSpeedMult==='number') fn('mineSpeedMult', item.mineSpeedMult);
    if(typeof item.moveSpeedMult==='number') fn('moveSpeedMult', item.moveSpeedMult);
    if(typeof item.jumpPowerMult==='number') fn('jumpPowerMult', item.jumpPowerMult);
    if(typeof item.waterMoveSpeedMult==='number') fn('waterMoveSpeedMult', item.waterMoveSpeedMult);
    if(typeof item.attackDamage==='number') fn('attackDamage', item.attackDamage);
    if(typeof item.energyCapacityBonus==='number') fn('energyCapacityBonus', item.energyCapacityBonus);
    if(typeof item.crushResistBonus==='number') fn('crushResistBonus', item.crushResistBonus);
  }
  function computeModifiers(){
    adoptCustomizationWrites();
    ensureValid();
    const mods={};
    SLOTS.forEach(s=>{ statContributions(findItem(state.equipped[s.id]), (k,v)=>applyStat(mods,k,v)); });
    // External modifier sources (skill points, future buffs/potions/world boons):
    // each provider returns a bundle of canonical stat keys merged by the same
    // STAT_RULES as gear — adding a source is one registerModifierSource() call.
    for(const src of MODIFIER_SOURCES){
      let b=null; try{ b=src.fn(); }catch(e){ continue; }
      if(!b) continue;
      for(const k in b){ const v=b[k]; if(typeof v==='number' && isFinite(v)) applyStat(mods,k,v); }
    }
    // Defaults to keep the engine stable
    if(mods.moveSpeedMult==null) mods.moveSpeedMult=1;
    if(mods.waterMoveSpeedMult==null) mods.waterMoveSpeedMult=0.5;
    if(mods.mineSpeedMult==null) mods.mineSpeedMult=1;
    if(mods.jumpPowerMult==null) mods.jumpPowerMult=1;
    if(mods.attackDamage==null) mods.attackDamage=0;
    if(mods.energyCapacityBonus==null) mods.energyCapacityBonus=0;
    if(mods.crushResistBonus==null) mods.crushResistBonus=0;
    // Safety clamps (future-proof against extreme stacking)
    mods.moveSpeedMult=clampRange(mods.moveSpeedMult, 0.3, 30);
    mods.waterMoveSpeedMult=clampRange(mods.waterMoveSpeedMult, 0.25, 1.25);
    mods.jumpPowerMult=clampRange(mods.jumpPowerMult, 0.3, 3);
    mods.attackDamage=clampRange(mods.attackDamage, 0, 97);
    mods.energyCapacityBonus=clampRange(mods.energyCapacityBonus, 0, 10000);
    mods.crushResistBonus=clampRange(mods.crushResistBonus, 0, 500);
    MM.activeModifiers=mods;
    return mods;
  }

  function ensureValid(){
    SLOTS.forEach(s=>{
      const cur=state.equipped[s.id];
      if(cur && findItem(cur)) return;
      state.equipped[s.id]= s.required? s.def : null;
    });
  }

  // --- Persistence ---
  function snapshot(){
    return {
      v:1,
      equipped:Object.assign({}, state.equipped),
      colors:Object.assign({}, state.colors),
      bag:state.bag.map(i=>Object.assign({}, i)),
      discarded:[...state.discarded],
      shortcutOff:[...state.shortcutOff],
      newItems:[...state.newItems]
    };
  }
  function restoreSnapshot(src, opts){
    opts=opts||{};
    if(!src || typeof src!=='object') return false;
    const defaults={cape:'classic', eyes:'bright', outfit:'default', weapon:null, charm:null};
    Object.assign(state.equipped, defaults);
    if(src.equipped && typeof src.equipped==='object'){
      SLOTS.forEach(s=>{
        const v=src.equipped[s.id];
        state.equipped[s.id]=(typeof v==='string' && v.length<=64) ? v : (s.required? s.def : null);
      });
    }
    state.colors.cape='#b91818';
    state.colors.outfit='#f4c05a';
    if(src.colors && typeof src.colors==='object'){
      if(typeof src.colors.cape==='string' && src.colors.cape.length<=32) state.colors.cape=src.colors.cape;
      if(typeof src.colors.outfit==='string' && src.colors.outfit.length<=32) state.colors.outfit=src.colors.outfit;
    }
    state.bag=Array.isArray(src.bag) ? src.bag.map(i=>sanitizeLootItem(i)).filter(Boolean).slice(0,MAX_BAG) : [];
    state.discarded=new Set();
    if(Array.isArray(src.discarded)){
      src.discarded.slice(0,MAX_DISCARDED).forEach(id=>{ if(typeof id==='string' && id.length<=96) state.discarded.add(id); });
    }
    state.shortcutOff=new Set();
    if(Array.isArray(src.shortcutOff)){
      src.shortcutOff.slice(0,MAX_DISCARDED).forEach(id=>{ if(typeof id==='string' && id.length<=96) state.shortcutOff.add(id); });
    }
    state.newItems=new Set();
    if(Array.isArray(src.newItems)){
      src.newItems.slice(0,MAX_DISCARDED).forEach(id=>{
        if(typeof id==='string' && id.length<=96 && state.bag.some(i=>i.id===id)) state.newItems.add(id);
      });
    }
    ensureValid();
    syncCustomization();
    computeModifiers();
    if(opts.persist!==false) save();
    if(!opts.silent){
      const detail={key:'restore'};
      try{ window.dispatchEvent(new CustomEvent('mm-customization-change',{detail})); }catch(e){ /* no-op */ }
      try{ window.dispatchEvent(new CustomEvent('mm-inventory-change',{detail})); }catch(e){ /* no-op */ }
    }
    return true;
  }
  function save(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    }catch(e){ /* storage full / unavailable — keep playing with session state */ }
  }
  function migrateLegacy(){
    try{
      const raw=localStorage.getItem(LEGACY_CUST_KEY);
      if(raw){
        const d=JSON.parse(raw);
        if(d && typeof d==='object'){
          if(d.capeStyle) state.equipped.cape=d.capeStyle;
          if(d.eyeStyle) state.equipped.eyes=d.eyeStyle;
          if(d.outfitStyle) state.equipped.outfit=d.outfitStyle;
          if(d.capeColor) state.colors.cape=d.capeColor;
          if(d.outfitColor) state.colors.outfit=d.outfitColor;
        }
      }
    }catch(e){ /* corrupt legacy data — defaults stand */ }
    try{
      const raw=localStorage.getItem(LEGACY_DISCARD_KEY);
      if(raw){ const arr=JSON.parse(raw); if(Array.isArray(arr)) arr.forEach(id=>state.discarded.add(id)); }
    }catch(e){ /* ignore */ }
  }
  function load(){
    let raw=null;
    try{ raw=localStorage.getItem(STORAGE_KEY); }catch(e){ raw=null; }
    if(!raw){ migrateLegacy(); return; }
    try{
      const d=JSON.parse(raw);
      if(d && typeof d==='object') restoreSnapshot(d,{persist:false,silent:true});
    }catch(e){ migrateLegacy(); }
  }

  // --- Mutations ---
  function notifyChange(detail){
    syncCustomization();
    computeModifiers();
    save();
    try{ window.dispatchEvent(new CustomEvent('mm-customization-change',{detail:detail||{}})); }catch(e){ /* no-op */ }
    try{ window.dispatchEvent(new CustomEvent('mm-inventory-change',{detail:detail||{}})); }catch(e){ /* no-op */ }
  }
  function equip(itemId){
    const item=findItem(itemId); if(!item) return false;
    const slot=slotFor(item.kind); if(!slot) return false;
    if(state.equipped[slot.id]===itemId) return true;
    state.equipped[slot.id]=itemId;
    state.newItems.delete(itemId);
    notifyChange({key:slot.id, value:itemId});
    return true;
  }
  function unequip(slotId){
    const slot=SLOTS.find(s=>s.id===slotId); if(!slot) return false;
    const next= slot.required? slot.def : null;
    if(state.equipped[slot.id]===next) return false;
    state.equipped[slot.id]=next;
    notifyChange({key:slot.id, value:next});
    return true;
  }
  function discard(itemId){
    const item=findItem(itemId); if(!item) return false;
    const builtin=BUILTIN_ITEMS.some(i=>i.id===itemId);
    if(builtin) return false; // built-in gear can't be thrown away
    discardUndo.unshift(Object.assign({}, item));
    if(discardUndo.length>DISCARD_UNDO_LIMIT) discardUndo.length=DISCARD_UNDO_LIMIT;
    state.discarded.add(itemId);
    state.newItems.delete(itemId);
    state.shortcutOff.delete(itemId); // a discarded weapon must not pin its id in the opt-out set forever
    // FIFO cap (Sets iterate in insertion order): ids of long-gone loot expire first
    if(state.discarded.size>MAX_DISCARDED){ state.discarded.delete(state.discarded.values().next().value); }
    const bi=state.bag.findIndex(i=>i.id===itemId); if(bi>=0) state.bag.splice(bi,1);
    // Mirror removal into the chest loot pools so it never re-syncs back
    if(MM.dynamicLoot){
      Object.keys(MM.dynamicLoot).forEach(k=>{
        const arr=MM.dynamicLoot[k]; if(!Array.isArray(arr)) return;
        const idx=arr.findIndex(i=>i && i.id===itemId); if(idx>=0) arr.splice(idx,1);
      });
      if(MM.chests && MM.chests.saveDynamicLoot) MM.chests.saveDynamicLoot();
    }
    try{ localStorage.setItem(LEGACY_DISCARD_KEY, JSON.stringify([...state.discarded])); }catch(e){ /* ignore */ }
    ensureValid();
    notifyChange({key:'discard', value:itemId});
    return true;
  }
  function dynamicLootKeyForKind(kind){
    return kind==='cape'?'capes':kind==='eyes'?'eyes':kind==='outfit'?'outfits':kind==='weapon'?'weapons':kind==='charm'?'charms':null;
  }
  function restoreDynamicLootItem(item){
    const key=dynamicLootKeyForKind(item && item.kind);
    if(!key) return;
    if(!MM.dynamicLoot) MM.dynamicLoot={capes:[],eyes:[],outfits:[],weapons:[],charms:[]};
    if(!Array.isArray(MM.dynamicLoot[key])) MM.dynamicLoot[key]=[];
    if(!MM.dynamicLoot[key].some(i=>i && i.id===item.id)) MM.dynamicLoot[key].push(Object.assign({}, item));
    if(MM.chests && MM.chests.saveDynamicLoot) MM.chests.saveDynamicLoot();
  }
  function undoDiscard(){
    while(discardUndo.length){
      const item=discardUndo.shift();
      if(!item || !item.id || BUILTIN_ITEMS.some(i=>i.id===item.id)) continue;
      if(findItem(item.id)) return true;
      if(state.bag.length>=MAX_BAG){
        discardUndo.unshift(item);
        return false;
      }
      state.discarded.delete(item.id);
      if(!state.bag.some(i=>i.id===item.id)) state.bag.push(Object.assign({}, item));
      restoreDynamicLootItem(item);
      ensureValid();
      notifyChange({key:'undoDiscard', value:item.id});
      return true;
    }
    return false;
  }
  function discardUndoCount(){ return discardUndo.length; }
  function isNew(itemId){ return state.newItems.has(itemId); }
  function markSeen(ids){
    const before=state.newItems.size;
    if(Array.isArray(ids)) ids.forEach(id=>state.newItems.delete(id));
    else if(typeof ids==='string') state.newItems.delete(ids);
    else state.newItems.clear();
    if(state.newItems.size!==before) notifyChange({key:'seen'});
  }
  function capacity(){
    return {
      used:state.bag.filter(i=>!state.discarded.has(i.id)).length,
      max:MAX_BAG,
      free:Math.max(0, MAX_BAG-state.bag.length),
      full:state.bag.length>=MAX_BAG,
      warning:state.bag.length>=Math.floor(MAX_BAG*0.9)
    };
  }
  function comparableItems(item, opts){
    opts=opts||{};
    if(!item) return [];
    const itemCat=item.kind==='weapon' ? weaponCategory(item) : null;
    return itemsOfKind(item.kind).filter(other=>{
      if(!opts.includeSelf && other.id===item.id) return false;
      if(item.kind!=='weapon') return true;
      const otherCat=weaponCategory(other);
      return !!(itemCat && otherCat && itemCat.id===otherCat.id);
    });
  }
  function compareItem(input){
    const item=typeof input==='string' ? findItem(input) : input;
    if(!item) return null;
    const slot=slotFor(item.kind);
    const score=itemScore(item);
    const itemCat=item.kind==='weapon' ? weaponCategory(item) : null;
    const equipped=slot ? findItem(state.equipped[slot.id]) : null;
    const equippedComparable=!!(equipped && (item.kind!=='weapon' || (itemCat && weaponCategory(equipped) && weaponCategory(equipped).id===itemCat.id)));
    const bestExisting=comparableItems(item).sort((a,b)=>itemScore(b)-itemScore(a))[0]||null;
    const equippedScore=equippedComparable ? itemScore(equipped) : null;
    const bestScore=bestExisting ? itemScore(bestExisting) : null;
    const equippedDelta=equippedScore==null ? null : score-equippedScore;
    const bestDelta=bestScore==null ? null : score-bestScore;
    let verdict='newOption';
    if(bestExisting && bestDelta<0) verdict='belowBest';
    else if(bestExisting && bestDelta===0) verdict='matchesBest';
    else if(bestDelta==null || bestDelta>0) verdict='newBest';
    if(verdict!=='newBest' && equippedDelta!=null && equippedDelta>0) verdict='equippedUpgrade';
    return {
      item,
      score,
      slotId:slot?slot.id:null,
      groupId:item.kind==='weapon' && itemCat ? 'weapon:'+itemCat.id : item.kind,
      groupLabel:item.kind==='weapon' && itemCat ? itemCat.label : ((slot && slot.label) || KIND_LABELS[item.kind] || item.kind),
      equipped,
      equippedComparable,
      equippedScore,
      equippedDelta,
      bestExisting,
      bestScore,
      bestDelta,
      isNewBest:bestDelta==null || bestDelta>0,
      isEquippedUpgrade:equippedDelta!=null && equippedDelta>0,
      verdict
    };
  }
  function newItems(){
    return state.bag.filter(i=>!state.discarded.has(i.id) && state.newItems.has(i.id));
  }
  function setColor(which,color){
    if(which!=='cape' && which!=='outfit') return;
    if(typeof color!=='string') return;
    state.colors[which]=color;
    notifyChange({key:'color', value:which});
  }
  function registerItem(def){
    if(!def || !def.id || !def.kind || findItem(def.id)) return false;
    extraItems.push(def);
    return true;
  }
  function grantItem(raw, opts){
    opts=opts||{};
    const item=sanitizeLootItem(raw, raw && raw.kind);
    if(!item) return false;
    if(findItem(item.id)){
      if(opts.equip && item.kind) equip(item.id);
      return true;
    }
    if(!pushToBag(item,{markNew:opts.markNew!==false, essential:!!opts.essential})) return false;
    restoreDynamicLootItem(item);
    notifyChange({key:'grant', value:item.id});
    if(opts.equip) equip(item.id);
    return true;
  }

  // --- Dynamic loot sync: chests.js fills MM.dynamicLoot; merge new items into the bag ---
  const DYN_KIND_MAP={capes:'cape', eyes:'eyes', outfits:'outfit', weapons:'weapon', charms:'charm'};
  function syncDynamicLoot(){
    const dl=MM.dynamicLoot; if(!dl) return {added:0, blocked:0};
    let added=0;
    let blocked=0;
    Object.keys(DYN_KIND_MAP).forEach(k=>{
      const arr=dl[k]; if(!Array.isArray(arr)) return;
      arr.forEach(raw=>{
        const it=sanitizeLootItem(raw, DYN_KIND_MAP[k]);
        if(!it) return;
        if(state.discarded.has(it.id)) return;
        if(findItem(it.id)) return;
        if(pushToBag(it)) added++;
        else blocked++;
      });
    });
    if(added || blocked){
      if(added) save();
      try{ window.dispatchEvent(new CustomEvent('mm-inventory-change',{detail:{key:'loot', added, blocked}})); }catch(e){ /* no-op */ }
    }
    return {added, blocked};
  }
  window.updateDynamicCustomization=syncDynamicLoot;

  // --- Resources (view over window.inv, owned by main.js) ---
  function resourceList(){
    const inv=window.inv||{};
    return RESOURCES.map(r=>({key:r.key, label:r.label, color:r.color, tile:r.tile, count:inv[r.key]|0}));
  }
  function dropResource(key,n){
    const inv=window.inv; if(!inv || !(key in inv)) return 0;
    const take=Math.max(0, Math.min(inv[key]|0, n|0));
    inv[key]-=take;
    try{ window.dispatchEvent(new CustomEvent('mm-resources-change',{detail:{key, dropped:take}})); }catch(e){ /* no-op */ }
    return take;
  }

  // --- Shared outfit body renderer (used by main.js drawPlayer and the UI preview) ---
  const OUTFIT_BODY={ default:null /* uses colors.outfit */, miner:'#c89b50', mystic:'#6b42c7', ninja:'#23262e', ironperson:'#b3202a' };
  function outfitBaseColor(style, cust){ return OUTFIT_BODY[style] || (cust && cust.outfitColor) || '#f4c05a'; }
  function drawOutfit(ctx,x,y,w,h,style,cust){
    const base=outfitBaseColor(style,cust);
    ctx.fillStyle=base; ctx.fillRect(x,y,w,h);
    if(style==='miner'){
      ctx.fillStyle='#8a6a30'; ctx.fillRect(x, y, w, h*0.18);
      ctx.fillStyle='#ffe27a'; ctx.fillRect(x+w*0.5-w*0.1, y+h*0.04, w*0.2, h*0.10);
      ctx.fillStyle='#6e5526'; ctx.fillRect(x, y+h*0.62, w, h*0.08);
    } else if(style==='mystic'){
      ctx.fillStyle='rgba(255,255,255,0.10)'; ctx.fillRect(x, y, w, h*0.25);
      ctx.fillStyle='#cdb4ff';
      ctx.fillRect(x+w*0.2, y+h*0.55, 2, 2); ctx.fillRect(x+w*0.65, y+h*0.7, 2, 2); ctx.fillRect(x+w*0.45, y+h*0.85, 2, 2);
    } else if(style==='ninja'){
      ctx.fillStyle='#3a3f4d'; ctx.fillRect(x, y+h*0.28, w, h*0.14);
      ctx.fillStyle='#5560a8'; ctx.fillRect(x, y+h*0.55, w, h*0.07);
    } else if(style==='ironperson'){
      ctx.fillStyle='#e3a934'; ctx.fillRect(x+w*0.18, y+h*0.5, w*0.64, h*0.34);
      ctx.fillStyle='#7df9ff'; ctx.beginPath(); ctx.arc(x+w*0.5, y+h*0.62, Math.max(1.5, w*0.09), 0, Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle='#4b3212'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h);
  }
  MM.drawOutfit=drawOutfit;

  // --- Boot ---
  load();
  syncCustomization();
  computeModifiers();
  syncDynamicLoot(); // chests.js loads persisted loot before us (import order in main.js)

  // --- Public APIs ---
  // (Legacy MM.getCustomizationItems / MM.addDiscardedLoot / MM.discardedLoot /
  // MM.STAT_RULES shims were removed: nothing calls them since the loot popup
  // moved to MM.inventory. STAT_RULES stays reachable via MM.inventory.STAT_RULES.)
  MM.getModifiers=()=>Object.assign({}, MM.activeModifiers);
  MM.recomputeModifiers=computeModifiers;

  MM.inventory={
    SLOTS, KIND_LABELS, TIER_COLORS, STAT_LABELS, STAT_RULES, RESOURCES, BASE_ATTACK,
    WEAPON_CATEGORIES, KIND_STAT_PRIORITY, WEAPON_TYPE_STATS, allowedStatsFor,
    weaponCategory, categoryWeapons, isShortcut, setShortcut, cycleWeaponCategory,
    statChips, itemScore, snapPct, fmtPct, VISION_BASE,
    items:itemsOfKind,
    allItems,
    bagItems:()=>state.bag.filter(i=>!state.discarded.has(i.id)),
    getItem:findItem,
    isBuiltin:(id)=>BUILTIN_ITEMS.some(i=>i.id===id),
    equip, unequip, discard, undoDiscard, discardUndoCount, registerItem, grantItem, registerModifierSource,
    isNew, markSeen, newItems, capacity, compareItem,
    equippedId:(slotId)=>state.equipped[slotId]||null,
    equippedItem:(slotId)=>findItem(state.equipped[slotId]),
    isEquipped:(itemId)=>SLOTS.some(s=>state.equipped[s.id]===itemId),
    slotForKind:slotFor,
    setColor,
    getColors:()=>Object.assign({}, state.colors),
    attackDamage:()=>BASE_ATTACK + ((MM.activeModifiers && MM.activeModifiers.attackDamage)||0),
    attackBonus:()=>((MM.activeModifiers && MM.activeModifiers.attackDamage)||0),
    resources:resourceList,
    dropResource,
    snapshot,
    restore:restoreSnapshot,
    save
  };
})();
// ESM export (progressive migration)
export const inventory = (typeof window!=='undefined' && window.MM) ? window.MM.inventory : undefined;
export default inventory;
