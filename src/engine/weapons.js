// Weapon use system: melee swings (with a visible slash + held-weapon animation),
// bow arrows (projectiles with gravity) and stream weapons selected by the
// equipped item's weaponType:
//   'flame' — ignites organic creatures (mobs.igniteRadius) and flammable tiles
//   'hose'  — water jet: extinguishes tile fire and burning creatures, knocks a
//             little damage loose, and now and then condenses into a real WATER tile
//   'gas'   — toxic cloud: poisons living (organic) creatures; lingers and pools
//   'electric' — spends hero energy to fire a straight robot-style beam
// The equipped weapon comes from MM.inventory.
import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, thawedEarthVariant, isFrozenEarth } from '../constants.js';
import { fire as FIRE } from './fire.js';
import { getFlamePuffSprites, flamePuffFrame, flamePuffAlpha, flamePuffRadius } from './flame_fx.js';
import { isBlastProtectedTile, isCondensedWaterTargetTile, isHeatRayPassableTile, isIridiumArrowPierceableTile, isSolidCollisionTile as isSolid } from './material_physics.js';
import { reactions as REACTIONS } from './reactions.js';
import { damageBlastCreatures } from './explosion_damage.js';
import { authoritativeBodyBlocksCell } from './body_footprint.js';
(function(){
  window.MM = window.MM || {};

  const arrows=[]; // {x,y,vx,vy,dmg,life,stuck,stuckT,travel,maxTravel}
  const arrowFragments=[]; // short-lived shaft/head pieces after an arrow breaks
  const mines=[]; // thrown, then resting {x,y,type,age,armed}
  const mineFragments=[]; // short-lived visual shrapnel; damage lands radially at detonation
  const puffs=[];  // {kind,x,y,vx,vy,life,total,dps}
  const electricBeams=[]; // {x1,y1,x2,y2,t,life,hit,blocked,phase}
  const ARROW_SPEED=22, ARROW_GRAV=14, ARROW_LIFE=5, ARROW_STUCK=4, ARROW_RECOVER_SECONDS=12, MAX_ARROWS=64;
  const MAX_ARROW_ENTITIES=128; // embedded arrows do not consume the whole in-flight budget
  const ARROW_EXPIRY_FALL_SECONDS=0.8, MAX_ARROW_FRAGMENTS=96;
  const MINE_ARM_SECONDS=0.55, MINE_TRIGGER_RADIUS=1.15, MINE_CRATER_RADIUS=3;
  const MINE_BLAST_DAMAGE=22, MINE_FRAGMENT_RADIUS=5.4, MINE_FRAGMENT_DAMAGE=26;
  const MAX_MINES=40, MAX_MINE_FRAGMENTS=96;
  const ARROW_DAMAGE_FALLOFF={close:1, mid:0.6, long:0.33};
  const BOW_CHARGE_SECONDS=4;
  const BOW_MAX_CHARGE_MULT=2;
  const BOW_OVERDRAW_ENERGY_PER_SEC=6;
  const SPEAR_CHARGE_SECONDS=1.2;
  const SPEAR_MAX_CHARGE_MULT=2;
  const MAX_PUFFS=220;
  const MAX_ELECTRIC_BEAMS=24;
  const MELEE_REACH=1;
  // Per-kind stream tuning: emission count/frame, muzzle speed, vertical pull
  // (negative = rises like heat, positive = arcs down like water), lifetime factor
  // lifeMult compensates for in-flight friction so the actual reach matches the
  // weapon's fireRange (with drag ~0.9/s a puff covers ~60% of v0*t — without the
  // boost puffs died ~2 tiles short and never touched the terrain they should melt)
  const STREAMS={
    flame:{speed:10, emit:3, grav:-2.2, lifeMult:1.45},
    hose: {speed:12, emit:3, grav:3.0,  lifeMult:1.45},
    gas:  {speed:6,  emit:2, grav:-1.2, lifeMult:1.9},
    steam:{speed:2,  emit:0, grav:-3.2, lifeMult:1.0}  // cosmetic, spawned by boiling
  };
  const STREAM_FUEL={
    // Wood stays the clean/default fuel. Coal is an automatic fallback and is
    // deliberately marked smoky so the renderer can expose that choice.
    flame:{key:'wood', primaryLabel:'drewna', label:'drewna lub wegla', rate:1, alternatives:[{key:'coal',label:'wegla',smoke:true}]},
    hose: {key:'water', label:'wody', rate:1},
    gas:  {key:'rottenMeat', label:'zepsutego miesa', rate:1}
  };
  // Every tier carries ONE identity beyond its numbers, so ammo choice is a
  // tactical decision, not just a bigger multiplier:
  //   iridium — pierces BLOCKS (unchanged classic)
  //   diamond — pierces CREATURES (overpenetration, up to 3 targets)
  //   obsidian — ignites when fired at FULL draw (volcanic glass edge)
  //   stone — staggers: the hit target briefly stops (hard chill tap)
  //   every real arrow can be recovered if it survives impact; break chance runs
  //   from wood (80%, most fragile) down to carbon fibre (10%, most durable).
  //   Two craft-material tiers sit off the mineral ladder: hard wood is a tough
  //   shaft (0.40 break — far sturdier than plain wood) and carbon fibre is a
  //   light, fast (speed 1.40) near-unbreakable shaft crafted from graphene.
  const ARROW_TIERS=[
    {id:'iridium',  key:'arrowIridium',  label:'irydowe',     damage:2.80, speed:1.32, life:1.55, spread:0.004, color:'#b8d7ff', head:'#f0f7ff', breakChance:0.20},
    {id:'diamond',  key:'arrowDiamond',  label:'diamentowe',  damage:2.15, speed:1.18, life:1.35, spread:0.012, color:'#48f1ff', head:'#dffcff', mobPierce:3, breakChance:0.35},
    {id:'obsidian', key:'arrowObsidian', label:'obsydianowe', damage:1.65, speed:1.08, life:1.15, spread:0.020, color:'#7a5cc1', head:'#c7b8ff', igniteOnFull:true, breakChance:0.50},
    {id:'stone',    key:'arrowStone',    label:'kamienne',    damage:1.25, speed:1.00, life:1.00, spread:0.032, color:'#9aa0a8', head:'#e1e5ea', stagger:0.6, breakChance:0.65},
    // Carbon fibre: light + very fast + almost never breaks (recover-and-reuse).
    {id:'carbon',   key:'arrowCarbon',   label:'weglowe',     damage:1.15, speed:1.40, life:1.15, spread:0.010, color:'#3a3f47', head:'#8b95a3', breakChance:0.10},
    // Hard wood: a tough shaft — modest speed but far sturdier than plain wood.
    {id:'hardwood', key:'arrowHardwood', label:'z twardego drewna', damage:1.10, speed:0.96, life:0.95, spread:0.042, color:'#7a5a34', head:'#caa06a', breakChance:0.40},
    {id:'wood',     key:'arrowWood',     label:'drewniane',   damage:1.00, speed:0.92, life:0.85, spread:0.050, color:'#caa472', head:'#dfe6f1', breakChance:0.80},
    // Utility ammo, deliberately below wood so 'auto' never wastes real arrows on
    // it — pin it from the HUD pips. Splats on impact: poison + chill instead of
    // raw damage (crafted from TOXIC_SNOW mined under gas-tainted blizzards).
    {id:'toxicSnowball', key:'toxicSnowball', label:'toksyczne śnieżki', damage:0.55, speed:0.82, life:0.90, spread:0.055, color:'#8fdd7f', head:'#d9ffd0', snowball:true, glow:{color:'#8fdd7f', r:6, a:0.30, trail:true}},
    // Grapple hook: a MOVEMENT arrow, never a combat shaft. It has no break
    // chance (a rope, not a shaft — excluded from the durability map) and is
    // skipped by 'auto' AND hidden from the pip row until owned/pinned, just
    // like the snowball. Firing a pinned grapple diverts to MM.grapple (see the
    // fireBowShot/firePowerBow guards) — it never enters the arrows array.
    {id:'grapple', key:'arrowGrapple', label:'hakowe', damage:0, speed:1, life:1, spread:0, color:'#9a7b4a', head:'#d9c48a', grapple:true}
  ];
  // --- Bouncing rubber ammunition (weaponType 'bouncy', slot 4) ----------------
  // The rubber-ball pistol trades damage for GEOMETRY: one shot is feeble, but the
  // ball ricochets off walls AND off the creatures it hits, so it reaches around a
  // corner, down a shaft, or through a whole pack. Every ricochet costs energy and
  // bite, so a chain naturally runs out instead of pinballing forever:
  //   - walls barely dull the ball (WALL_DAMAGE_KEEP) — that is the trick shot;
  //   - a BODY absorbs a lot (HIT_DAMAGE_KEEP) — that is the falloff the player feels;
  //   - the ball dies on bounce budget, on minimum speed or on its lifetime,
  //     whichever comes first, and the rubber survives often enough to pick up.
  // `dmg` is kept as a FLOAT through the chain (it is rounded only where damage is
  // actually applied), otherwise integer rounding would flatten the decay curve.
  const BOUNCY_SPEED=19;             // muzzle speed: flatter and faster than an arrow
  const BOUNCY_GRAVITY_MULT=0.52;    // a light ball hangs; the shot reads as a line
  const BOUNCY_LIFE=3.2;
  const BOUNCY_MAX_BOUNCES=6;
  const BOUNCY_WALL_RESTITUTION=0.86;
  const BOUNCY_BODY_RESTITUTION=0.70;
  const BOUNCY_WALL_DAMAGE_KEEP=0.92;
  const BOUNCY_HIT_DAMAGE_KEEP=0.62;
  const BOUNCY_MIN_SPEED=4.5;        // below this the ball has nothing left to give
  const BOUNCY_RECOVER_CHANCE=0.5;   // "część można podnieść": half the balls survive
  const BOUNCY_COLOR='#e0533f', BOUNCY_HIGHLIGHT='#ffbdae';
  // A LIT tar ball is already melting, so it gets only a short tail of bounces.
  // This is the arson budget: without it one ball could carry fire through six
  // wall hits and light a whole forest — the exact reason the plain ball is
  // exempt from catching fire at all.
  const BOUNCY_BURN_BOUNCES=3;
  // Ammunition kinds for the 'bouncy' family, keyed off the weapon's `bouncyKind`
  // exactly like THROWN_KINDS/`thrownKind` — so a second pistol is a second entry
  // here plus a recipe, and the slot-4 key already rotates between them.
  //   plain — inert rubber: bounces, never burns, half of them survive to pick up
  //   tar   — pitch-soaked rubber: does NOT burn on its own, but ANY contact with
  //           fire (a burning tile, lava, or a creature already alight) lights it,
  //           and a lit ball then sets flammable tiles and every creature it
  //           touches on fire. It never comes back — it burns away.
  const BOUNCY_KINDS={
    plain:{key:'rubberBall',    label:'Kulki kauczukowe', color:BOUNCY_COLOR, head:BOUNCY_HIGHLIGHT},
    tar:  {key:'rubberBallTar', label:'Kulki smołowe',    color:'#4a3a30',    head:'#a08258', flammable:true}
  };
  const BOUNCY_AMMO_KEY=BOUNCY_KINDS.plain.key;
  // --- Gravity gun (weaponType 'gravity') ------------------------------------
  // LMB channels a block OUT of the world (time ~ hardness, energy all the way),
  // RMB hurls it. The MATERIAL LAW — what lifts, how it flies, what it does on
  // a body, how it lands — lives in engine/gravity_gun.js; every world write
  // goes through the MM.gravityWorld seam (main.js). This file owns the weapon
  // FEEL only: channel state, energy drain, the projectile entry, the visuals.
  // All timers are wall-clock or fireHeld-dt: WEAPONS.update never runs on a
  // hero guest, so a per-frame cooldown decrement would jam there forever.
  const GRAV_REACH_DEFAULT=6;          // extraction reach in tiles (item fireRange overrides)
  const GRAV_CHANNEL_COST_DEFAULT=14;  // energy/s while ripping (item energyCost overrides)
  const GRAV_HOLD_DRAIN_PER_MASS=2.5;  // energy/s per unit mass while a block floats at the muzzle
  const GRAV_THROW_COST_BASE=4, GRAV_THROW_COST_PER_MASS=6;
  const GRAV_DAMAGE_CAP=45;            // ghost_net HERO_RULES.DMG_MAX — the shared projectile ceiling
  const grav={channel:null, heldTid:0, throwAtMs:0};
  // Refusal feedback: the material law names a reason, the gun voices it. The
  // silent ones (void/gas/hazard/tile/bounds) would only spam while sweeping aim.
  const GRAV_REFUSE_MSG={
    bedrock:'Skała macierzysta nie da się ruszyć',
    hull:'Kadłub obcych nie puszcza — rozbieraj go ładunkiem',
    rigid:'Urządzeń nie podniesiesz — rozbierz je',
    fluid:'Cieczy nie da się chwycić',
    utility:'To nie blok — to instalacja albo mebel',
    fixture:'To nie blok — to instalacja albo mebel',
    story:'Ten kamień ma swoją historię'
  };
  // Hand-thrown projectiles (weaponType 'thrown', rotated in the ranged slot with
  // bows). Slower and lobbier than arrows; each kind carries its own splat:
  //   snow  — white puff + a brief chill (slow) on creatures caught in it
  //   toxic — the toxic-snowball cloud (poison + hard chill)
  //   rock  — plain stone chips; the damage is in the direct hit itself
  const THROWN_KINDS={
    snowball:      {key:'snowball',      label:'Śnieżki',           color:'#eef7ff', head:'#ffffff', speed:15.5, lob:-2.2, life:2.4, splat:'snow', ball:true},
    toxicSnowball: {key:'toxicSnowball', label:'Toksyczne śnieżki', color:'#8fdd7f', head:'#d9ffd0', speed:15.0, lob:-2.2, life:2.4, splat:'toxic', ball:true, glow:{color:'#8fdd7f', r:6, a:0.30, trail:true}},
    stone:         {key:'throwingStone', label:'Kamienie',          color:'#9aa0a8', head:'#c9ced6', speed:16.5, lob:-2.8, life:2.6, splat:'rock', rock:true},
    // ^ the stone throw is TIERED like arrows: STONE_TIERS below picks the best
    //   owned rock material (any stone type can be knapped into throwing rocks),
    //   overrides damage/color per tier, and rolls a per-tier survival chance so
    //   thrown rocks can be picked back up — cheap rocks shatter the most.
    // Combo enablers for the elemental matrix and area control:
    waterBalloon:  {key:'waterBalloon',  label:'Balony wodne',      color:'#7cc4ff', head:'#dff2ff', speed:14.5, lob:-2.0, life:2.4, splat:'wet', ball:true},
    gasGrenade:    {key:'gasGrenade',    label:'Granaty gazowe',    color:'#9dbf5a', head:'#e2f0b8', speed:14.0, lob:-2.4, life:2.6, splat:'gascloud', ball:true},
    stickyBomb:    {key:'stickyBomb',    label:'Lepkie bomby',      color:'#b0703c', head:'#ffd9a8', speed:14.5, lob:-2.4, life:3.0, splat:'bomb', ball:true, sticky:true, fuse:1.5},
    antipersonnelMine:{key:'antipersonnelMine', label:'Miny przeciwpiechotne', color:'#46505a', head:'#ff5b45', speed:12.8, lob:-1.6, life:7.0, splat:'mine', ball:true, mineType:'blast', noDamage:true},
    fragmentationMine:{key:'fragmentationMine', label:'Miny odłamkowe', color:'#5b493d', head:'#ffb14a', speed:12.4, lob:-1.7, life:7.0, splat:'mine', ball:true, mineType:'fragmentation', noDamage:true},
    // Frost flask: a chill cloud, no direct damage — the reliable half of the
    // wet+chill -> frozen-solid combo. Molotov: a lobbed incendiary that ignites
    // creatures AND flammable terrain (host-only world write, like the bomb).
    frostFlask:    {key:'frostFlask',    label:'Lodowe fiolki',     color:'#bfe8ff', head:'#eaffff', speed:14.5, lob:-2.1, life:2.4, splat:'frost', ball:true},
    molotov:       {key:'molotov',       label:'Koktajle Mołotowa', color:'#ff7a3a', head:'#ffd08a', speed:14.0, lob:-2.2, life:2.5, splat:'fire',  ball:true},
    // Improvised fun weapons have deliberately strong utility identities:
    //   sand — a loose spray of fine grains: zero damage, BLIND + short STUN
    //   spit — one small saliva droplet; its ult becomes toxic green saliva
    sand:          {key:'sand',          label:'Piasek w oczy',     color:'#c7aa68', head:'#f0dc9b', speed:13.5, lob:-1.7, life:1.6, splat:'sand', visual:'sand', noDamage:true},
    spit:          {key:'water',         label:'Plucie',             color:'#cfe9df', head:'#f5fff8', speed:14.8, lob:-1.45, life:1.7, splat:'spit', visual:'spit'}
  };
  // A sand throw is one cheap gameplay collider, but its visible grains are a
  // stable random pattern attached to that throw. Integer hashing avoids both
  // per-frame Math.random shimmer and stored per-grain objects.
  function sandVisualNoise(seed,index,salt){
    let x=((Number(seed)>>>0)^Math.imul((index|0)+1,0x9e3779b1)^Math.imul((salt|0)+1,0x85ebca6b))>>>0;
    x=Math.imul(x^(x>>>16),0x7feb352d);
    x=Math.imul(x^(x>>>15),0x846ca68b);
    return ((x^(x>>>16))>>>0)/4294967296;
  }
  function sandVisualPattern(seed){
    seed=(Number(seed)>>>0)||1;
    return {
      count:10+Math.floor(sandVisualNoise(seed,0,0)*11),
      tail:0.50+sandVisualNoise(seed,0,1)*0.38,
      spread:0.18+sandVisualNoise(seed,0,2)*0.24,
      flutter:0.018+sandVisualNoise(seed,0,3)*0.030,
      tilt:(sandVisualNoise(seed,0,4)-0.5)*0.10
    };
  }
  const WATER_CONDENSE_CHANCE=0.008; // per dying hose puff (~1 tile per second of spray)
  // Elemental conversions use sustained contact so one lucky puff cannot reshape terrain.
  const WATER_BOIL_SECONDS=2.8; // flame must hold on water before it boils into steam
  const STONE_MELT_SECONDS=5.0; // flame must hold on one stone tile continuously
  const SAND_GLASS_SECONDS=10.0; // sand must be heated longer before it vitrifies
  const SAND_HEAT_CONTACT_SCALE=1.0;
  const STONE_HEAT_GRACE=0.22;  // tiny stream jitter grace; longer gaps lose the heat
  const WATER_HEAT_GRACE=0.45;  // water flickers/splashes, so allow a little stream jitter
  const QUENCH_CHANCE=0.5;      // hose hardens lava → obsidian
  const MUD_CHANCE=0.25;        // hose soaks sand → mud
  const HOSE_TURRET_REFILL=0.35; // tank water per hose puff swallowed by a water turret
  const SELF_FLAME_ARM_SEC=0.16; // muzzle is safe; lingering/backflow flame burns
  const ELECTRIC_PULSE_INTERVAL=0.10;
  const ELECTRIC_DEFAULT_ENERGY_PER_SEC=10;
  const SPECIAL_LUCKY_CHANCE=0.16;
  const HEAT_FORGED_GLASS_GRACE=0.55;
  const stoneHeat=new Map();    // key "x,y" -> {x,y,heat,gap}
  const sandHeat=new Map();     // key "x,y" -> {x,y,heat,gap}
  const waterHeat=new Map();    // key "x,y" -> {x,y,heat,gap}
  const heatForgedGlass=new Map(); // key -> {x,y,cool}; refreshed while flame keeps heating it
  const flameHeatRays=[];
  const streamFuelDebt={flame:0,hose:0,gas:0};
  const warnAt=Object.create(null);
  // One cooldown per weapon FAMILY: sharing a timer would mean firing the pistol
  // silently locks the bow (and vice versa) for a player who switches mid-fight.
  let bowCd=0, harpoonCd=0, meleeCd=0, bossAcc=0, ultCharge=1, electricCd=0, throwCd=0, bouncyCd=0;
  let heroFlameHitCd=0;
  let lastWeaponCombatFxAt=0, lastWeaponCombatFxKey='', lastWeaponCombatFxX=0, lastWeaponCombatFxY=0;
  let iridiumPierces=0;
  let lastGetTile=null, lastSetTile=null;
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  const bowCharge={active:false,t:0,required:BOW_CHARGE_SECONDS,aimX:0,aimY:0,player:null,full:false,overdrawT:0,energySpent:0,starved:false};
  const spearCharge={active:false,t:0,required:SPEAR_CHARGE_SECONDS,dir:1,player:null,full:false};
  const ULT_CHARGE_TIME=5;
  // Melee action visual. The form is captured when the hit starts so a spear
  // remains a thrust and an axe remains a chop even if equipment changes before
  // the short animation (or a ghost-network snapshot) has finished.
  const swing={t:0, dur:0.2, tx:0, ty:0, dir:1, form:'sword', charge:0};
  // Short, cosmetic-only impulse shared by every held-weapon renderer. Discrete
  // shots restart it; continuous emitters merely keep it alive, avoiding a
  // strobing muzzle flash when fireHeld() is called every simulation tick.
  const heldActionFx={kind:'',started:0,until:0,power:0,serial:0};

  function equippedWeapon(){ return (MM.inventory && MM.inventory.equippedItem)? MM.inventory.equippedItem('weapon'):null; }
  function weaponType(w){ return (w && w.weaponType)||'melee'; }
  function tierColor(it){ const tc=(MM.inventory && MM.inventory.TIER_COLORS)||{}; return (it && tc[it.tier])||null; }
  const WEAPON_TIER_RANK={common:0,uncommon:1,rare:2,epic:3,legendary:4};
  const WEAPON_TIER_GLOW={rare:'#bd75ff',epic:'#ffd45c',legendary:'#65f4ff'};
  const WEAPON_MATERIALS={
    wood:{id:'wood',body:'#76502b',edge:'#b9874a',accent:'#e2b66f',glow:'#d9a55c',dark:'#3f2817',grip:'#5b351d'},
    stone:{id:'stone',body:'#727982',edge:'#c4cbd2',accent:'#9da6af',glow:'#d8e0e7',dark:'#3c4249',grip:'#654321'},
    steel:{id:'steel',body:'#788694',edge:'#eef6ff',accent:'#b9c8d6',glow:'#d9efff',dark:'#36424c',grip:'#674326'},
    obsidian:{id:'obsidian',body:'#3c3158',edge:'#a98ad8',accent:'#7e59b5',glow:'#c994ff',dark:'#171020',grip:'#4a2f2b'},
    diamond:{id:'diamond',body:'#70c9db',edge:'#f0ffff',accent:'#86f0f2',glow:'#8fffff',dark:'#285f72',grip:'#4f5363'},
    iridium:{id:'iridium',body:'#7668a7',edge:'#f4eaff',accent:'#b887ff',glow:'#d7b4ff',dark:'#302749',grip:'#403557'},
    aquatic:{id:'aquatic',body:'#436d7c',edge:'#dffcff',accent:'#62dce7',glow:'#70efff',dark:'#203d4a',grip:'#405764'},
    arc:{id:'arc',body:'#3e5968',edge:'#efffff',accent:'#58eaff',glow:'#79f5ff',dark:'#1d303a',grip:'#3e434d'},
    exotic:{id:'exotic',body:'#62528b',edge:'#fff2b8',accent:'#e7b85b',glow:'#ffe27a',dark:'#28203d',grip:'#49354d'}
  };
  // Ultra blade sheen (engine/post_fx.js drawBladeSheenPass): only genuinely
  // polished materials mirror the world — a wooden stick and rough stone must
  // stay matte. The rect passed in has to be the metal ITSELF, not its bounding
  // box: the sheen is clipped to a rectangle, so a polygon head (axe, spear
  // point, trident prongs) would spill the reflection onto the background.
  const SHEEN_MATERIALS=new Set(['steel','diamond','iridium','obsidian','aquatic','arc','exotic']);
  // --- the glow attribute for shots -------------------------------------------
  // What a projectile EMITS, derived from what it IS. post_fx turns any of these
  // descriptors into a bloom halo plus a light streak along the flight path;
  // weapons.js only declares WHICH shot glows and in what colour. A lit arrow
  // burns, an enchanted shaft carries its prestige colour, a spit is toxic.
  const PROJECTILE_GLOW={
    fire: Object.freeze({color:'#ff9430', r:9,   a:0.52, trail:true}),
    spit: Object.freeze({color:'#a8ff6a', r:7,   a:0.42, trail:true}),
    water:Object.freeze({color:'#9fd8ff', r:6,   a:0.26, trail:true})
  };
  const PRESTIGE_GLOW_R=[0,0,6.5,8.5,10.5];
  function projectileGlow(a){
    if(!a) return null;
    if(a.fire) return PROJECTILE_GLOW.fire;
    if(a.toxicSpit) return PROJECTILE_GLOW.spit;
    if(a.waterJet || a.hose) return PROJECTILE_GLOW.water;
    const rank=Math.max(0,Math.min(4,Number(a.weaponPrestige)||0));
    if(rank>=2 && a.weaponGlow) return {color:a.weaponGlow, r:PRESTIGE_GLOW_R[rank], a:0.28+rank*0.06, trail:true};
    // ammo that carries its own attribute (see ARROW_TIERS / THROWN_KINDS)
    const tier=ARROW_TIERS.find(t=>t.id===a.tier) || THROWN_KINDS[a.tier];
    return (tier && tier.glow) || null;
  }
  let projGlowSeq=0;
  function projectileGlowKey(a){
    if(!a._gk) a._gk='p'+(++projGlowSeq);
    return a._gk;
  }
  function registerProjectileGlow(a,TILE){
    const spec=projectileGlow(a);
    if(!spec) return false;
    const P=(typeof window!=='undefined' && window.MM) ? window.MM.postFx : null;
    if(!P || !P.glow) return false;
    return P.glow(a.x*TILE, a.y*TILE, spec, projectileGlowKey(a), TILE);
  }
  function drawBladeSheen(ctx,material,x,y,w,h){
    if(!material || !SHEEN_MATERIALS.has(material.id)) return;
    const P=(typeof window!=='undefined' && window.MM) ? window.MM.postFx : null;
    if(!P || !P.drawBladeSheenPass || !P.on || !P.on('heroSheen')) return;
    P.drawBladeSheenPass(ctx,{x,y,w,h});
  }
  function weaponPrestigeRank(it){
    const base=it && WEAPON_TIER_RANK[it.tier] || 0;
    return it && it.unique ? Math.max(3,base) : base;
  }
  // Both helpers below are pure functions of item fields and run several times per
  // FRAME (world light, hero reflection, held art, blade sheen), so they memoize
  // per item object. The guard fields re-derive if anything they read mutates in
  // place (fusion/upgrades), which a bare WeakMap hit would miss.
  const weaponSeedMemo=new WeakMap();
  function computeWeaponVisualSeed(it){
    const text=String((it&&(it.id||it.name))||'weapon');
    let h=2166136261;
    for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=Math.imul(h,16777619); }
    return (h>>>0)/4294967296;
  }
  const WEAPON_SEED_DEFAULT=computeWeaponVisualSeed(null);
  function weaponVisualSeed(it){
    if(!it || typeof it!=='object') return WEAPON_SEED_DEFAULT;
    const hit=weaponSeedMemo.get(it);
    if(hit && hit.id===it.id && hit.name===it.name) return hit.seed;
    const seed=computeWeaponVisualSeed(it);
    weaponSeedMemo.set(it,{id:it.id,name:it.name,seed});
    return seed;
  }
  function weaponPrestigeColor(it){ return tierColor(it)||WEAPON_TIER_GLOW[it&&it.tier]||'#d7f5ff'; }
  const weaponMaterialMemo=new WeakMap();
  function computeWeaponMaterialProfile(it){
    const name=String((it&&(it.id||it.name))||'').toLowerCase();
    const aquatic=aquaticStyle(it);
    if(aquatic) return WEAPON_MATERIALS.aquatic;
    if(/iryd|irid/.test(name)) return WEAPON_MATERIALS.iridium;
    if(/diament|diamond/.test(name)) return WEAPON_MATERIALS.diamond;
    if(/obsyd|obsid/.test(name)) return WEAPON_MATERIALS.obsidian;
    if(/kamie|stone|rock/.test(name)) return WEAPON_MATERIALS.stone;
    if(/drewn|wood|patyk|stick|maczug|club|luk|bow/.test(name)) return WEAPON_MATERIALS.wood;
    if(weaponType(it)==='electric' || /elektr|electric|tesla|laser|plasm/.test(name)) return WEAPON_MATERIALS.arc;
    if(it && (it.unique || weaponPrestigeRank(it)>=3)) return WEAPON_MATERIALS.exotic;
    return WEAPON_MATERIALS.steel;
  }
  function weaponMaterialProfile(it){
    if(!it || typeof it!=='object') return computeWeaponMaterialProfile(it);
    const hit=weaponMaterialMemo.get(it);
    if(hit && hit.id===it.id && hit.name===it.name && hit.tier===it.tier && hit.unique===it.unique && hit.wt===it.weaponType) return hit.profile;
    const profile=computeWeaponMaterialProfile(it);
    weaponMaterialMemo.set(it,{id:it.id,name:it.name,tier:it.tier,unique:it.unique,wt:it.weaponType,profile});
    return profile;
  }
  function triggerHeldActionFx(kind,power,duration,continuous){
    const now=nowMs(), dur=Math.max(45,Number(duration)||150);
    const active=now<heldActionFx.until;
    if(continuous && active && heldActionFx.kind===kind){
      heldActionFx.until=now+dur;
      heldActionFx.power=Math.max(heldActionFx.power,Math.max(0.25,Number(power)||1));
      return heldActionFx;
    }
    heldActionFx.kind=String(kind||'weapon');
    heldActionFx.started=now;
    heldActionFx.until=now+dur;
    heldActionFx.power=Math.max(0.25,Number(power)||1);
    heldActionFx.serial=(heldActionFx.serial+1)>>>0;
    return heldActionFx;
  }
  function heldActionState(){
    const now=nowMs(), duration=Math.max(1,heldActionFx.until-heldActionFx.started);
    if(now>=heldActionFx.until) return {active:false,kind:heldActionFx.kind,age:1,kick:0,flash:0,power:0,serial:heldActionFx.serial};
    const age=clamp01((now-heldActionFx.started)/duration);
    const release=1-age;
    return {active:true,kind:heldActionFx.kind,age,kick:release*release,flash:Math.sin(Math.PI*release)*0.35+release*0.65,power:heldActionFx.power,serial:heldActionFx.serial};
  }
  function weaponCombatVisualMeta(w,weaponClass,extra){
    const mat=weaponMaterialProfile(w), cls=weaponClass||weaponType(w);
    const meta={
      forceVisual:true,
      weaponMaterial:mat.id,
      weaponPrestige:weaponPrestigeRank(w),
      weaponGlow:weaponPrestigeColor(w),
      weaponClass:cls,
      weaponForm:cls==='melee'?meleeVisualForm(w):cls
    };
    return extra&&typeof extra==='object'?Object.assign(meta,extra):meta;
  }
  function projectileCombatVisualMeta(a,extra){
    const cls=a&&a.harpoon?'harpoon':a&&a.thrown?'thrown':a&&a.bouncy?'bouncy':'bow';
    const meta={
      forceVisual:true,
      weaponMaterial:String(a&&a.weaponMaterial||''),
      weaponPrestige:Math.max(0,Math.min(4,Number(a&&a.weaponPrestige)||0)),
      weaponGlow:String(a&&a.weaponGlow||''),
      weaponClass:cls,
      weaponForm:cls,
      dir:Number(a&&a.vx)<0?-1:1
    };
    return extra&&typeof extra==='object'?Object.assign(meta,extra):meta;
  }
  function weaponLightSource(player){
    const it=equippedWeapon();
    if(!it||!player) return null;
    const type=weaponType(it);
    if(type==='thrown'){
      const spec=thrownSpec(it);
      if(!spec||resourceCount(spec.key)<=0) return null;
    }
    const rank=weaponPrestigeRank(it), material=weaponMaterialProfile(it);
    const action=heldActionState();
    const bowRatio=type==='bow'&&bowCharge.active?bowChargeRatio():0;
    let level=rank>=2?(rank===4?10:rank===3?8:6):0;
    if(action.active){
      const actionLevel=type==='electric'?14:type==='flame'?13:type==='hose'?9:type==='gas'?8:type==='harpoon'?9:7;
      const prestigeImpulse=rank>=2?1+Math.floor(Math.max(0,action.power-0.8)):0;
      level=Math.max(Math.min(15,level+prestigeImpulse),Math.min(15,actionLevel+Math.floor(Math.max(0,action.power-1)*2)));
    }
    if(rank>=2&&bowRatio>0.15) level=Math.max(level,Math.round(5+bowRatio*7));
    const sub=aquaticStyle(it)?heroSubmersion(player):0;
    if(sub>0.55&&aquaticStyle(it)) level=Math.min(15,level+1);
    if(level<6) return null;
    const facing=player.facing<0?-1:1;
    return {
      enabled:true,
      x:player.x+facing*0.38,
      y:player.y-Math.max(0.05,(Number(player.h)||0.95)*0.10),
      level:Math.max(1,Math.min(15,Math.round(level))),
      color:material.glow,
      material:material.id,
      radius:0.70+level*0.055+(action.active?0.16:0),
      intensity:clamp01(0.14+(level-5)*0.035+(action.active?0.08:0)),
      underwater:sub>0.45,
      facing,
      action:action.active?action.kind:''
    };
  }
  // The hex→"rgba(r,g,b," prefix is memoized (emissiveRgb's pattern in post_fx):
  // the regex + parseInt ran per gradient stop, several stops per frame, over a
  // handful of material colours that never change.
  const weaponRgbaPrefix=new Map();
  function weaponLightRgba(hex,alpha){
    const raw=String(hex||'').trim();
    let pre=weaponRgbaPrefix.get(raw);
    if(pre===undefined){
      const m=/^#([0-9a-f]{6})$/i.exec(raw);
      if(m){ const n=parseInt(m[1],16); pre='rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','; }
      else pre='rgba(170,235,255,';
      weaponRgbaPrefix.set(raw,pre);
    }
    return pre+clamp01(alpha).toFixed(3)+')';
  }
  function drawWorldLight(ctx,TILE,player){
    const light=weaponLightSource(player);
    if(!light||typeof ctx.createRadialGradient!=='function') return false;
    const now=nowMs()*0.001, pulse=0.90+0.10*Math.sin(now*(light.action?5.2:2.1)+weaponVisualSeed(equippedWeapon())*6.28);
    const x=light.x*TILE,y=light.y*TILE,r=light.radius*TILE*(light.underwater?1.18:1)*pulse;
    // A glowing weapon is a light the hero CARRIES: registered through the glow
    // attribute (the same level the light field uses), so it blooms above the
    // darkness overlay and streaks as he runs and swings. The pool below stays as
    // the weapon's own art on the ground around him.
    const P=(typeof window!=='undefined' && window.MM) ? window.MM.postFx : null;
    if(P && P.addEmissive){
      P.addEmissive({x,y,r:r*0.62,color:light.color,
        a:Math.min(0.62,0.20+light.intensity*1.5),key:'heldWeaponLight',trail:true});
    }
    ctx.save(); ctx.globalCompositeOperation='lighter';
    const g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,weaponLightRgba(light.color,light.intensity*(light.underwater?0.18:0.24)));
    g.addColorStop(0.38,weaponLightRgba(light.color,light.intensity*(light.underwater?0.075:0.09)));
    g.addColorStop(1,weaponLightRgba(light.color,0));
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    if(light.underwater){
      ctx.strokeStyle=weaponLightRgba(light.color,light.intensity*0.16); ctx.lineWidth=Math.max(0.8,TILE*0.035);
      for(let i=0;i<2;i++){
        const rr=r*(0.42+i*0.18),spin=now*(0.35+i*0.12)*(i?1:-1);
        ctx.beginPath(); ctx.arc(x,y,rr,spin,spin+Math.PI*0.72); ctx.stroke();
      }
    }
    ctx.restore();
    return true;
  }
  function drawHeroReflection(ctx,TILE,player){
    const light=weaponLightSource(player);
    if(!light||typeof ctx.createRadialGradient!=='function') return false;
    const w=Math.max(0.4,Number(player.w)||0.7)*TILE, h=Math.max(0.6,Number(player.h)||0.95)*TILE;
    const handX=(player.x+light.facing*(Number(player.w)||0.7)*0.40)*TILE;
    const handY=(player.y-h/TILE*0.10)*TILE;
    const r=Math.max(w,h)*0.78;
    ctx.save(); ctx.globalCompositeOperation='lighter';
    const g=ctx.createRadialGradient(handX,handY,0,handX,handY,r);
    g.addColorStop(0,weaponLightRgba(light.color,light.intensity*0.16));
    g.addColorStop(0.46,weaponLightRgba(light.color,light.intensity*0.05));
    g.addColorStop(1,weaponLightRgba(light.color,0));
    ctx.fillStyle=g; ctx.beginPath();
    ctx.arc(handX,handY,r,0,Math.PI*2); ctx.fill(); ctx.restore();
    return true;
  }
  function meleeVisualForm(it){
    if(aquaticStyle(it)==='trident') return 'trident';
    const name=String(it&&it.name||'').toLowerCase();
    if(/top[oó]r|axe/.test(name)) return 'axe';
    if(/maczug|patyk|club|stick/.test(name)) return 'club';
    if(/dzid|w[łl][oó]cz|spear/.test(name) || Number(it&&it.fireRange)>1) return 'spear';
    return 'sword';
  }
  function isChargeableSpear(it){
    return weaponType(it)==='melee' && meleeVisualForm(it)==='spear';
  }
  function meleeAttackPose(form,progress,facing){
    const p=Math.max(0,Math.min(1,Number(progress)||0));
    const dir=facing<0?-1:1;
    const smooth=t=>{ const v=Math.max(0,Math.min(1,t)); return v*v*(3-2*v); };
    if(form==='spear'||form==='trident'){
      // Brief pull-back, explosive straight extension, then a controlled return.
      let extension;
      if(p<0.18) extension=-3*smooth(p/0.18);
      else if(p<0.52) extension=-3+21*smooth((p-0.18)/0.34);
      else extension=18*(1-smooth((p-0.52)/0.48));
      return {style:'stab',angle:dir*(Math.PI*0.5-0.06),forward:dir*extension,lift:-1.2+Math.sin(p*Math.PI)*0.8};
    }
    if(form==='axe'){
      // An overhead hack that accelerates through a broad slashing follow-through.
      const cut=smooth(p);
      return {style:'hack',angle:dir*(-2.18+3.18*cut),forward:dir*Math.sin(p*Math.PI)*3.2,lift:-Math.sin(p*Math.PI)*2.4};
    }
    return {style:'slash',angle:dir*(-1.8+2.1*p),forward:0,lift:0};
  }
  function heldPrestigeFocus(it,facing){
    const type=weaponType(it);
    if(type==='melee'){
      const form=meleeVisualForm(it);
      if(form==='trident') return {x:0,y:-13};
      if(form==='spear') return {x:0,y:-14};
      if(form==='axe') return {x:0,y:-8.5};
      if(form==='club') return {x:0,y:-10};
      return {x:0,y:-9.5};
    }
    if(type==='bow') return {x:0,y:-2};
    if(type==='harpoon') return {x:facing*7,y:-3};
    if(type==='thrown') return {x:0,y:0};
    return {x:facing*3.5,y:-2.6};
  }
  function drawHeldPrestigeBack(ctx,TILE,it,facing){
    const rank=weaponPrestigeRank(it);
    if(rank<2) return;
    const now=nowMs()*0.001, seed=weaponVisualSeed(it)*Math.PI*2;
    const s=Math.max(0.55,TILE/20), pulse=0.90+Math.sin(now*2.4+seed)*0.10;
    const col=weaponPrestigeColor(it), focus=heldPrestigeFocus(it,facing);
    const cx=focus.x*s, cy=focus.y*s, r=(rank===4?6.4:rank===3?5.6:4.8)*s;
    ctx.save(); ctx.globalCompositeOperation='lighter';
    ctx.shadowColor=col; ctx.shadowBlur=(rank===4?4.5:rank===3?3.2:2.2)*s;
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    glow.addColorStop(0,weaponLightRgba(col,rank===4?0.085:rank===3?0.065:0.045));
    glow.addColorStop(0.46,weaponLightRgba(col,rank===4?0.040:rank===3?0.030:0.020));
    glow.addColorStop(1,weaponLightRgba(col,0));
    ctx.globalAlpha=pulse; ctx.fillStyle=glow;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function drawHeldPrestigeFront(ctx,TILE,it,facing){
    const rank=weaponPrestigeRank(it);
    if(rank<2) return;
    const now=nowMs()*0.001, seed=weaponVisualSeed(it)*Math.PI*2;
    const s=Math.max(0.55,TILE/20), col=weaponPrestigeColor(it);
    const glint=0.72+0.28*Math.sin(now*(rank===4?4.8:3.6)+seed);
    const focus=heldPrestigeFocus(it,facing), gx=focus.x*s, gy=focus.y*s;
    ctx.save(); ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=(rank===4?0.38:rank===3?0.30:0.22)*glint;
    ctx.fillStyle=rank===4?'#ffffff':col; ctx.shadowColor=col; ctx.shadowBlur=(rank===4?4:rank===3?3:2)*s;
    ctx.beginPath(); ctx.arc(gx,gy,(rank===4?0.72:rank===3?0.60:0.48)*s,0,Math.PI*2); ctx.fill();
    if(rank>=3){
      const arm=(rank===4?1.6:1.15)*s;
      ctx.globalAlpha=(rank===4?0.30:0.22)*glint; ctx.strokeStyle=col;
      ctx.lineWidth=Math.max(0.6,(rank===4?0.80:0.65)*s);
      ctx.beginPath(); ctx.moveTo(gx-arm,gy); ctx.lineTo(gx+arm,gy); ctx.moveTo(gx,gy-arm); ctx.lineTo(gx,gy+arm); ctx.stroke();
    }
    ctx.restore();
  }
  function clamp01(v){ return Math.max(0,Math.min(1,Number(v)||0)); }
  function mix(a,b,t){ return a+(b-a)*clamp01(t); }
  function tileGetter(){
    if(typeof lastGetTile==='function') return lastGetTile;
    try{ if(MM.world && typeof MM.world.getTile==='function') return (x,y)=>MM.world.getTile(x,y); }catch(e){}
    return null;
  }
  // Water penalties follow the hero's body, not merely the tile below the feet.
  // This makes wading almost normal and ramps smoothly into the full deep-water
  // profile once the head, torso and weapon arm are submerged.
  function heroSubmersion(player,getTile){
    if(!player) return 0;
    const getter=typeof getTile==='function' ? getTile : tileGetter();
    if(!getter) return 0;
    const w=Math.max(0.4,Number(player.w)||0.7), h=Math.max(0.6,Number(player.h)||0.95);
    const points=[
      [player.x,player.y-h*0.44],
      [player.x-w*0.28,player.y-h*0.10],
      [player.x+w*0.28,player.y-h*0.10],
      [player.x-w*0.18,player.y+h*0.32],
      [player.x+w*0.18,player.y+h*0.32]
    ];
    let wet=0;
    for(const p of points){ try{ if(getter(Math.floor(p[0]),Math.floor(p[1]))===T.WATER) wet++; }catch(e){} }
    return wet/points.length;
  }
  function aquaticStyle(w){
    const s=w && w.aquaticStyle;
    return s==='trident'||s==='crossbow'||s==='harpoon' ? s : '';
  }
  function meleeWaterProfile(w,player){
    const sub=heroSubmersion(player);
    if(aquaticStyle(w)==='trident') return {
      submersion:sub,
      damageMult:mix(0.65,1.45,sub),
      cooldownMult:mix(1.32,0.68,sub),
      effectMult:mix(0.75,1.20,sub)
    };
    const thrusting=meleeReach(w)>1;
    return {
      submersion:sub,
      damageMult:mix(1,thrusting?0.72:0.50,sub),
      cooldownMult:mix(1,thrusting?1.35:1.80,sub),
      effectMult:mix(1,thrusting?0.70:0.42,sub)
    };
  }
  function bowWaterProfile(w,player){
    const sub=heroSubmersion(player);
    if(aquaticStyle(w)==='crossbow') return {
      submersion:sub, chargeSeconds:mix(1.55,0.85,sub),
      damageMult:mix(0.65,1.35,sub), speedMult:mix(0.72,1.08,sub),
      gravityMult:mix(0.90,0.18,sub), waterDrag:0.995, windResponse:0.055,
      lifeMult:mix(0.88,1.18,sub)
    };
    return {
      submersion:sub, chargeSeconds:mix(BOW_CHARGE_SECONDS,7.2,sub),
      damageMult:mix(1,0.46,sub), speedMult:mix(1,0.38,sub),
      gravityMult:mix(1,0.58,sub), waterDrag:0.955, windResponse:0.16,
      lifeMult:mix(1,0.72,sub)
    };
  }
  function harpoonWaterProfile(w,player){
    const sub=heroSubmersion(player);
    return {
      submersion:sub,
      damageMult:mix(0.62,1.55,sub), speedMult:mix(0.64,1.14,sub),
      cooldownMult:mix(1.32,0.72,sub), gravityMult:mix(0.92,0.12,sub),
      waterDrag:0.997, windResponse:0.035, lifeMult:mix(0.82,1.30,sub)
    };
  }
  function addWorldGas(kind,x,y,opts){
    try{
      if(MM.gases && MM.gases.add){
        return MM.gases.add(kind,x,y,Object.assign({getTile:opts && opts.getTile,setTile:opts && opts.setTile},opts||{}));
      }
    }catch(e){}
    return 0;
  }
  function windSpeedAt(x,y,getTile){
    try{
      const W=MM.wind;
      if(W && typeof W.speedAt==='function') return W.speedAt(x,y,getTile);
    }catch(e){}
    return 0;
  }
  function applyWindToArrow(a,dt,getTile){
    if(!a || a.stuck) return false;
    const sp=windSpeedAt(a.x,a.y,getTile);
    if(Math.abs(sp)<0.05) return false;
    const before=a.vx||0;
    const response=Number.isFinite(a.windResponse) ? a.windResponse : (a.power ? 0.12 : 0.16);
    a.vx = before + sp*response*dt;
    const cap=Math.max(ARROW_SPEED*1.35, Number(a.windCap)||0);
    if(Math.abs(a.vx)>cap) a.vx=Math.sign(a.vx)*cap;
    return a.vx!==before;
  }
  function puffWindResponse(kind){
    if(kind==='steam') return 1.05;
    if(kind==='flame') return 0.86;
    if(kind==='gas') return 0.74;
    if(kind==='hose') return 0.24;
    return 0.50;
  }
  function applyWindToPuff(p,dt,getTile){
    if(!p) return false;
    const sp=windSpeedAt(p.x,p.y,getTile);
    if(Math.abs(sp)<0.05) return false;
    p.vx += sp*puffWindResponse(p.kind)*dt;
    const cap = p.kind==='hose' ? 15 : (p.kind==='flame' ? 16 : 12);
    if(Math.abs(p.vx)>cap) p.vx=Math.sign(p.vx)*cap;
    return true;
  }
  function igniteWorldGas(x,y,getTile,setTile,radius){
    try{ return !!(MM.gases && MM.gases.igniteAt && MM.gases.igniteAt(x,y,getTile,setTile,radius||1.5)); }catch(e){ return false; }
  }
  function applyBlockReaction(stimulus,tx,ty,getTile,setTile){
    try{
      return !!(REACTIONS && REACTIONS.apply && REACTIONS.apply(stimulus,tx,ty,getTile,setTile));
    }catch(e){ return false; }
  }
  function nowMs(){
    try{ if(typeof performance!=='undefined' && performance.now) return performance.now(); }catch(e){}
    return Date.now();
  }
  function sayLimited(id,text,delay){
    const t=nowMs(), wait=delay||900;
    if(t-(warnAt[id]||0)<wait) return;
    warnAt[id]=t;
    try{ if(window.msg) window.msg(text); }catch(e){}
  }
  function resourceCount(key){
    const inv=(typeof window!=='undefined' && window.inv) ? window.inv : null;
    if(!inv || typeof inv[key]!=='number') return 0;
    return Math.max(0, inv[key]|0);
  }
  function canSpendResource(key,n){
    const need=Math.max(0, n|0);
    return need<=0 || resourceCount(key)>=need;
  }
  function markWorldChanged(){
    try{ if(typeof window!=='undefined' && typeof window.__mmMarkWorldChanged==='function') window.__mmMarkWorldChanged(); }catch(e){}
  }
  function notifyResourceSpent(key,n){
    let updated=false;
    try{
      if(typeof window.updateInventoryHud==='function'){
        window.updateInventoryHud();
        updated=true;
      }
    }catch(e){}
    if(!updated){
      try{
        if(typeof window.dispatchEvent==='function' && typeof CustomEvent!=='undefined'){
          window.dispatchEvent(new CustomEvent('mm-resources-change',{detail:{key, spent:n}}));
        }
      }catch(e){}
      markWorldChanged();
    }
  }
  function notifyResourceGained(key,n){
    try{ if(typeof window.updateInventoryHud==='function') window.updateInventoryHud(); }catch(e){}
    try{
      if(typeof window.dispatchEvent==='function' && typeof CustomEvent!=='undefined'){
        window.dispatchEvent(new CustomEvent('mm-resources-change',{detail:{key, gained:n}}));
      }
    }catch(e){}
    markWorldChanged();
  }
  function addResource(key,n){
    const inv=(typeof window!=='undefined' && window.inv) ? window.inv : null;
    const add=Math.max(0, n|0);
    if(!inv || !key || add<=0) return false;
    if(typeof inv[key]!=='number') inv[key]=0;
    inv[key]+=add;
    notifyResourceGained(key,add);
    return true;
  }
  function awardUfoConcreteShard(tx,ty,t){
    if(t!==T.UFO_CONCRETE) return false;
    const ok=addResource('ufoConcrete',1);
    if(ok) sayLimited('ufo_concrete_drop','Beton UFO +1 - reliktowy material z ruin UFO.',1200);
    return ok;
  }
  function spendResource(key,n){
    const need=Math.max(0, n|0);
    if(need<=0) return true;
    const inv=(typeof window!=='undefined' && window.inv) ? window.inv : null;
    if(!inv || typeof inv[key]!=='number') return false;
    if((inv[key]|0)<need) return false;
    inv[key]=Math.max(0,(inv[key]|0)-need);
    notifyResourceSpent(key,need);
    return true;
  }
  function warnMissingResource(spec){
    if(!spec) return;
    sayLimited('res_'+spec.key,'Brak: '+spec.label);
  }
  function streamFuelChoices(kind){
    const spec=STREAM_FUEL[kind];
    if(!spec) return [];
    return [{key:spec.key,label:spec.primaryLabel||spec.label,smoke:!!spec.smoke}].concat(Array.isArray(spec.alternatives)?spec.alternatives:[]);
  }
  function streamFuelTotal(kind){
    return streamFuelChoices(kind).reduce((sum,f)=>sum+resourceCount(f.key),0);
  }
  function activeStreamFuel(kind){
    const choices=streamFuelChoices(kind);
    return choices.find(f=>resourceCount(f.key)>0) || choices[0] || null;
  }
  function canSpendStreamFuel(kind,n){
    return streamFuelTotal(kind)>=Math.max(0,n|0);
  }
  function spendStreamFuel(kind,n){
    let left=Math.max(0,n|0);
    const choices=streamFuelChoices(kind);
    if(left<=0) return {key:(choices[0]&&choices[0].key)||'',smoke:false};
    if(!choices.length || !canSpendStreamFuel(kind,left)) return null;
    let key=choices[0].key, smoke=false;
    for(const fuel of choices){
      const take=Math.min(left,resourceCount(fuel.key));
      if(take<=0) continue;
      if(!spendResource(fuel.key,take)) return null;
      key=fuel.key;
      smoke=smoke||!!fuel.smoke;
      left-=take;
      if(left<=0) break;
    }
    return left<=0 ? {key,smoke} : null;
  }
  function consumeStreamFuel(kind,dt){
    const spec=STREAM_FUEL[kind];
    if(!spec) return true;
    let fuel=activeStreamFuel(kind);
    if(!fuel || streamFuelTotal(kind)<=0){
      warnMissingResource(spec);
      return false;
    }
    const step=Math.max(0,Math.min(0.25, Number(dt)||0.016));
    streamFuelDebt[kind]=(streamFuelDebt[kind]||0)+step*(spec.rate||1);
    const due=Math.floor(streamFuelDebt[kind]+1e-9);
    if(due>0){
      const spent=spendStreamFuel(kind,due);
      if(!spent){
        streamFuelDebt[kind]=Math.min(streamFuelDebt[kind],0.99);
        warnMissingResource(spec);
        return false;
      }
      fuel=Object.assign({},fuel,spent);
      streamFuelDebt[kind]=Math.max(0,streamFuelDebt[kind]-due);
    }
    return {key:fuel.key,smoke:!!fuel.smoke};
  }
  function streamBurstFuelCost(kind,charge){
    const spec=STREAM_FUEL[kind];
    if(!spec) return 0;
    const c=Math.max(0.35,Math.min(1,Number(charge)||0));
    return Math.max(1,Math.ceil((0.75+c*1.5)*(spec.rate||1)));
  }
  function consumeStreamBurstFuel(kind,charge){
    const spec=STREAM_FUEL[kind];
    const cost=streamBurstFuelCost(kind,charge);
    if(!spec || cost<=0) return true;
    const spent=spendStreamFuel(kind,cost);
    if(!spent){
      warnMissingResource(spec);
      return false;
    }
    return spent;
  }
  // Arrow tier preference: 'auto' fires the strongest owned tier; a pinned tier id
  // fires that tier while it lasts (saving rare arrows for real threats) and falls
  // back to auto when the pinned stack runs dry. Persisted like other UI prefs.
  const ARROW_PREF_KEY='mm_arrow_pref_v1';
  let arrowPref='auto';
  try{
    const savedPref=(typeof localStorage!=='undefined') ? localStorage.getItem(ARROW_PREF_KEY) : null;
    if(savedPref && ARROW_TIERS.some(t=>t.id===savedPref)) arrowPref=savedPref;
  }catch(e){}
  function setArrowPref(id){
    arrowPref=(id && ARROW_TIERS.some(t=>t.id===id)) ? id : 'auto';
    try{
      if(typeof localStorage!=='undefined'){
        if(arrowPref==='auto') localStorage.removeItem(ARROW_PREF_KEY);
        else localStorage.setItem(ARROW_PREF_KEY,arrowPref);
      }
    }catch(e){}
    return arrowPref;
  }
  function pickArrowTier(){
    if(arrowPref!=='auto'){
      const pinned=ARROW_TIERS.find(t=>t.id===arrowPref);
      if(pinned && resourceCount(pinned.key)>0) return pinned;
    }
    for(const tier of ARROW_TIERS){
      if(tier.grapple) continue; // the grapple hook is a movement tool — never auto-fired
      if(resourceCount(tier.key)>0) return tier;
    }
    return null;
  }
  // HUD contract: everything the weapon bar shows about the bow in one call.
  // The seven REAL arrow tiers always render as pips; utility ammo (toxic
  // snowballs) only joins the row while the player owns some or pinned it —
  // an empty novelty tier must not widen the bar (pinned in stream-sim).
  function arrowInfo(){
    const active=pickArrowTier();
    let total=0;
    const tiers=[];
    for(const t of ARROW_TIERS){
      const count=resourceCount(t.key);
      total+=count;
      if((t.snowball || t.grapple) && count<=0 && arrowPref!==t.id) continue;
      tiers.push({id:t.id, key:t.key, label:t.label, color:t.color, damage:t.damage, breakChance:t.breakChance,
        count, active:!!(active && active.id===t.id), pinned:arrowPref===t.id});
    }
    return {tiers, activeId:active?active.id:null, pref:arrowPref, total};
  }
  function fuelInfo(kind){
    const spec=STREAM_FUEL[kind];
    if(!spec) return null;
    const fuels=streamFuelChoices(kind).map(f=>({key:f.key,label:f.label,count:resourceCount(f.key),smoke:!!f.smoke}));
    const active=fuels.find(f=>f.count>0) || fuels[0];
    return {key:active.key, label:spec.label, count:fuels.reduce((sum,f)=>sum+f.count,0), rate:spec.rate||1, fuels};
  }
  // Per-frame HUD gauge state (kept allocation-light next to the full metrics()).
  function hudStatus(){
    return {
      ult:ultCharge,
      bowActive:!!bowCharge.active, bowRatio:bowChargeRatio(), bowFull:!!bowCharge.full,
      spearActive:!!spearCharge.active, spearRatio:spearChargeRatio(), spearFull:!!spearCharge.full,
      gravActive:!!grav.channel, gravRatio:gravChannelRatio(), gravHeld:grav.heldTid|0
    };
  }
  function hasArrowAmmo(){ return !!pickArrowTier(); }
  function warnNoArrows(){ sayLimited('arrows_empty','Brak strzal'); }
  function hasHarpoonAmmo(){ return resourceCount('harpoonBolt')>0; }
  function warnNoHarpoons(){ sayLimited('harpoons_empty','Brak harpunow'); }
  function consumeHarpoon(){
    if(!hasHarpoonAmmo() || !spendResource('harpoonBolt',1)){ warnNoHarpoons(); return false; }
    return true;
  }
  function consumeArrowTier(){
    const tier=pickArrowTier();
    if(!tier){ warnNoArrows(); return null; }
    if(!spendResource(tier.key,1)){ warnNoArrows(); return null; }
    return tier;
  }
  function arrowAmmoCounts(){
    const out={};
    for(const tier of ARROW_TIERS) out[tier.id]=resourceCount(tier.key);
    return out;
  }
  function spreadAim(v,tier,scale){
    const spread=Math.max(0,Number(tier && tier.spread)||0)*(scale||1);
    if(spread<=0) return v;
    const a=(Math.random()-0.5)*spread*2;
    const ca=Math.cos(a), sa=Math.sin(a);
    return {dx:v.dx*ca - v.dy*sa, dy:v.dx*sa + v.dy*ca};
  }
  function pushArrow(a){
    // hero-mode guest: a locally fired projectile becomes an INTENT — the HOST
    // flies the real arrow (its physics, wind, elements) and streams it back on
    // the wfx plane; a local copy would be wiped by the next fx packet anyway
    // (ghostApplyFx replaces the arrows array wholesale)
    if(typeof MM!=='undefined' && MM.ghostHeroIntents && MM.ghostHeroIntents.shoot){ MM.ghostHeroIntents.shoot(a); return; }
    let moving=0;
    for(const existing of arrows) if(existing && !existing.embeddedMob) moving++;
    let evict=-1;
    if(moving>=MAX_ARROWS) evict=arrows.findIndex(existing=>existing && !existing.embeddedMob);
    else if(arrows.length>=MAX_ARROW_ENTITIES) evict=arrows.findIndex(existing=>existing && !existing.embeddedMob);
    if(evict<0 && arrows.length>=MAX_ARROW_ENTITIES){
      // Every retained entry is embedded in a living body. Preserve that
      // lifecycle promise; reject the incoming shaft with visible breakage
      // instead of making an older body-arrow disappear before its mob dies.
      if(a && arrowResourceKey(a)) spawnArrowBreakFx(a,'capacity');
      return null;
    }
    if(evict>=0){
      const old=arrows[evict];
      // Capacity pressure is rare, but it must never make a recoverable arrow
      // blink out. Show the same physical break-apart feedback as an impact.
      if(old && arrowResourceKey(old)) spawnArrowBreakFx(old,'capacity');
      arrows.splice(evict,1);
    }
    a.travel=Number.isFinite(a.travel) ? Math.max(0,a.travel) : 0;
    if(!Number.isFinite(a.maxTravel) || !(a.maxTravel>0)){
      a.maxTravel=Math.max(1,Math.hypot(a.vx||0,a.vy||0)*Math.max(0.1,a.life||ARROW_LIFE));
    }
    arrows.push(a);
    return a;
  }

  function arrowResourceKey(a){
    // Co-op shafts are host-simulated combat effects, never host-world
    // resources. The material identity remains available while an ordinary
    // arrow expires (for break FX); recovery functions separately enforce the
    // explicit recoverable flag before any pickup can be minted.
    if(!a || a.coopOwner || a.thrown || a.snowball || a.rock || a.splat) return null;
    if(typeof a.recoverKey==='string' && a.recoverKey) return a.recoverKey;
    const tier=ARROW_TIERS.find(t=>t.id===a.tier);
    return tier && !tier.snowball ? tier.key : null;
  }
  function arrowTierSpec(value){
    const id=typeof value==='string' ? value : value && value.tier;
    return ARROW_TIERS.find(t=>t.id===id && !t.snowball) || null;
  }
  function arrowBreakChance(value){
    if(value && Number.isFinite(value.breakChance)) return Math.max(0,Math.min(1,Number(value.breakChance)));
    const tier=arrowTierSpec(value);
    return tier ? Math.max(0,Math.min(1,Number(tier.breakChance)||0)) : 0;
  }
  function arrowBreaksOnImpact(a,roll){
    if(!arrowResourceKey(a)) return false;
    const chance=arrowBreakChance(a);
    const r=Number.isFinite(roll) ? Math.max(0,Math.min(1,roll)) : Math.random();
    return r<chance;
  }
  function spawnArrowBreakFx(a,cause){
    if(!a || !arrowResourceKey(a)) return false;
    const tier=arrowTierSpec(a) || {};
    const ang=Number.isFinite(a.ang) ? a.ang : Math.atan2(a.vy||0,a.vx||0);
    const inheritedX=Math.max(-5,Math.min(5,(a.vx||0)*0.12));
    const inheritedY=Math.max(-4,Math.min(4,(a.vy||0)*0.08));
    const pieces=[
      {along:-0.27,kind:'shaft',len:0.34,kick:-2.4,spin:-8.5},
      {along: 0.08,kind:'shaft',len:0.30,kick:-3.6,spin: 7.0},
      {along: 0.30,kind:'head', len:0.18,kick:-2.8,spin:10.5},
      {along:-0.43,kind:'fletch',len:0.16,kick:-3.2,spin:-11.0}
    ];
    while(arrowFragments.length+pieces.length>MAX_ARROW_FRAGMENTS) arrowFragments.shift();
    pieces.forEach((piece,index)=>{
      const side=index%2===0 ? -1 : 1;
      arrowFragments.push({
        x:a.x+Math.cos(ang)*piece.along,
        y:a.y+Math.sin(ang)*piece.along,
        vx:inheritedX+Math.cos(ang+side*1.15)*(1.4+index*0.35),
        vy:inheritedY+piece.kick-side*0.35,
        ang:ang+side*0.18, spin:piece.spin, kind:piece.kind, len:piece.len,
        color:a.color||tier.color||'#caa472', headColor:a.headColor||tier.head||'#dfe6f1',
        t:0, life:0.62+index*0.06, cause:cause||'impact', bounced:false
      });
    });
    try{
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(a.x*(MM.TILE||20),a.y*(MM.TILE||20),'common',4);
    }catch(e){}
    return true;
  }
  function breakArrowOnImpact(a,cause,roll){
    if(!arrowBreaksOnImpact(a,roll)) return false;
    spawnArrowBreakFx(a,cause);
    return true;
  }
  function makeArrowRecoverable(a){
    if(!a || a.coopOwner || a.recoverable===false) return false;
    const key=arrowResourceKey(a);
    if(!key) return false;
    a.recoverable=true;
    a.recoverKey=key;
    a.stuckT=ARROW_RECOVER_SECONDS;
    return true;
  }
  function stickArrowForRecovery(a,sdt){
    a.x-=(a.vx||0)*(sdt||0)*0.6;
    a.y-=(a.vy||0)*(sdt||0)*0.6;
    a.ang=Math.atan2(a.vy||0,a.vx||0);
    a.vx=0; a.vy=0;
    a.stuck=true;
    makeArrowRecoverable(a);
    return true;
  }
  function dropSurvivingArrow(a){
    if(!makeArrowRecoverable(a)) return false;
    a.stuck=false;
    a.spent=true;
    a.dropOnLand=true;
    a.vx=-(a.vx||0)*0.08;
    a.vy=Math.min(-1.1,(a.vy||0)*-0.08);
    a.life=Math.max(Number(a.life)||0,20);
    a.travel=0;
    a.maxTravel=Math.max(1,Math.hypot(a.vx,a.vy)*a.life);
    return true;
  }
  function beginArrowExpiryFall(a){
    if(!arrowResourceKey(a) || a.expiring) return false;
    a.embeddedMob=null;
    a.expiring=true;
    a.stuck=false;
    a.dropOnLand=false;
    a.recoverable=false;
    a.spent=true;
    a.expireT=ARROW_EXPIRY_FALL_SECONDS;
    a.ang=Number.isFinite(a.ang) ? a.ang : Math.atan2(a.vy||0,a.vx||0);
    a.expireSpin=(a.vx||0)>=0 ? 5.5 : -5.5;
    a.vx=Math.max(-3.5,Math.min(3.5,(a.vx||0)*0.16));
    a.vy=Math.max(-1.2,Math.min(1.8,(a.vy||0)*0.08));
    return true;
  }
  function updateExpiringArrow(a,dt,getTile){
    a.expireT-=dt;
    a.vy+=ARROW_GRAV*dt;
    a.ang=(a.ang||0)+(a.expireSpin||5.5)*dt;
    const nx=a.x+(a.vx||0)*dt, ny=a.y+(a.vy||0)*dt;
    let struck=false;
    try{ struck=!!(getTile && isSolid(getTile(Math.floor(nx),Math.floor(ny)))); }catch(e){}
    if(struck || a.expireT<=0){
      spawnArrowBreakFx(a,struck?'expiry_ground':'expiry_air');
      return false;
    }
    a.x=nx; a.y=ny;
    return true;
  }
  function updateArrowFragments(dt,getTile){
    for(let i=arrowFragments.length-1;i>=0;i--){
      const f=arrowFragments[i];
      f.t+=dt;
      if(f.t>=f.life){ arrowFragments.splice(i,1); continue; }
      f.vy+=ARROW_GRAV*0.82*dt;
      const nx=f.x+f.vx*dt, ny=f.y+f.vy*dt;
      let solid=false;
      try{ solid=!!(getTile && isSolid(getTile(Math.floor(nx),Math.floor(ny)))); }catch(e){}
      if(solid && !f.bounced){
        f.bounced=true; f.vy=-Math.abs(f.vy)*0.28; f.vx*=0.42; f.spin*=0.6;
      } else if(!solid){
        f.x=nx; f.y=ny;
      }
      f.ang+=f.spin*dt;
    }
  }
  function showRecoveredArrowFx(a,key,player){
    try{
      if(MM.drops && typeof MM.drops.showArrowCollect==='function'){
        MM.drops.showArrowCollect(a.x,a.y,key,player);
      }
    }catch(e){}
  }
  function attachArrowToMob(a,mob,family,isAlive,anchor){
    if(!arrowResourceKey(a) || !mob || !Number.isFinite(mob.x) || !Number.isFinite(mob.y)) return false;
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
    const anchorX=anchor && Number.isFinite(anchor.localX) ? anchor.localX : 0;
    const anchorY=anchor && Number.isFinite(anchor.localY) ? anchor.localY : 0;
    a.ang=Math.atan2(a.vy||0,a.vx||0);
    a.embeddedMob=mob;
    a.embeddedFamily=family||'mob';
    a.embeddedAlive=typeof isAlive==='function' ? isAlive : null;
    a.embeddedAnchorX=anchorX;
    a.embeddedAnchorY=anchorY;
    a.embeddedOffsetX=clamp(a.x-(mob.x+anchorX),-0.65,0.65);
    a.embeddedOffsetY=clamp(a.y-(mob.y+anchorY),-0.65,0.65);
    a.x=mob.x+anchorX+a.embeddedOffsetX;
    a.y=mob.y+anchorY+a.embeddedOffsetY;
    a.vx=0; a.vy=0;
    a.stuck=true;
    a.stuckT=Infinity;
    return true;
  }
  function embeddedMobAlive(a){
    const mob=a && a.embeddedMob;
    if(!mob || mob.dead || mob.destroyed || !Number.isFinite(mob.x) || !Number.isFinite(mob.y)) return false;
    if(typeof a.embeddedAlive==='function'){
      try{ return !!a.embeddedAlive(mob); }catch(e){ return false; }
    }
    if(!(mob.hp>0)) return false;
    try{
      if(a.embeddedFamily==='mob' && MM.mobs && typeof MM.mobs.isLiving==='function') return !!MM.mobs.isLiving(mob);
    }catch(e){ return false; }
    return true;
  }
  function releaseArrowFromMob(a){
    const mob=a.embeddedMob;
    const carryVx=mob && Number.isFinite(mob.vx) ? mob.vx : 0;
    const carryVy=mob && Number.isFinite(mob.vy) ? mob.vy : 0;
    a.embeddedMob=null;
    a.embeddedAlive=null;
    a.embeddedAnchorX=0;
    a.embeddedAnchorY=0;
    a.stuck=false;
    a.stuckT=ARROW_STUCK;
    a.dropOnLand=true;
    a.spent=true;
    a.recoverKey=arrowResourceKey(a);
    a.vx=carryVx*0.25;
    a.vy=Math.min(0,carryVy*0.2)-1.2;
    a.life=Math.max(Number(a.life)||0,20);
    a.travel=0;
    a.maxTravel=Math.max(1,Math.hypot(a.vx,a.vy)*a.life);
  }
  function spawnDroppedArrowPickup(a){
    if(!a || a.coopOwner || a.recoverable===false) return false;
    const key=arrowResourceKey(a);
    if(!key) return false;
    try{
      if(MM.drops && typeof MM.drops.spawnResource==='function'){
        return !!MM.drops.spawnResource(a.x,a.y-0.15,key,1,{vx:(a.vx||0)*0.2,vy:-0.8});
      }
    }catch(e){}
    return false;
  }

  function notifyMeleeSwing(tx,ty,player,chargeRatio){
    const form=meleeVisualForm(equippedWeapon());
    const charge=form==='spear'?clamp01(chargeRatio):0;
    swing.form=form;
    swing.charge=charge;
    swing.dur=(form==='axe'?0.32:(form==='spear'||form==='trident'?0.24+charge*0.10:0.2));
    swing.t=swing.dur; swing.tx=tx; swing.ty=ty; swing.dir=(player && player.facing>=0)?1:-1;
    triggerHeldActionFx('melee',1+charge*0.75,210+charge*110,false);
    const sound=form==='axe'?'axeSwing':((form==='spear'||form==='trident')?'spearThrust':'swing');
    try{ if(MM.audio && MM.audio.play) MM.audio.play(sound); }catch(e){}
    return form;
  }
  function combatElementFromOpts(opts){
    const raw=String((opts && (opts.element || opts.cause || opts.kind || opts.type || opts.weaponType)) || '').toLowerCase();
    if(raw.indexOf('fire')>=0 || raw.indexOf('flame')>=0 || raw.indexOf('heat')>=0 || raw.indexOf('lava')>=0) return 'fire';
    if(raw.indexOf('electric')>=0 || raw.indexOf('shock')>=0 || raw.indexOf('lightning')>=0 || raw.indexOf('laser')>=0) return 'electric';
    if(raw.indexOf('water')>=0 || raw.indexOf('hose')>=0 || raw.indexOf('pressure')>=0) return 'water';
    if(raw.indexOf('ice')>=0 || raw.indexOf('frost')>=0 || raw.indexOf('chill')>=0 || raw.indexOf('cold')>=0) return 'ice';
    if(raw.indexOf('gas')>=0 || raw.indexOf('poison')>=0 || raw.indexOf('toxic')>=0) return 'gas';
    if(raw.indexOf('explosion')>=0 || raw.indexOf('blast')>=0) return 'blast';
    return '';
  }
  function noteCombatEvent(detail){
    try{
      if(typeof window.dispatchEvent==='function' && typeof CustomEvent==='function'){
        window.dispatchEvent(new CustomEvent('mm-combat-event',{detail}));
      }
    }catch(e){}
  }
  function noteWeaponCombatHit(x,y,amount,opts,extra){
    opts=opts||{};
    extra=extra||{};
    const special=!!opts.specialAttack || !!extra.special;
    const lucky=!!opts.luckyStrike || !!extra.lucky;
    const element=combatElementFromOpts(opts);
    const major=!!extra.major || lucky || special || Math.abs(Number(amount)||0)>=8;
    if(!special && !lucky && !element && !major && !extra.forceVisual) return;
    const t=nowMs();
    const key=(lucky?'lucky':(special?'special':(element||'heavy')))+'|'+element+'|'+String(extra.weaponMaterial||'')+'|'+String(extra.weaponClass||'');
    if(!special && !lucky && t-lastWeaponCombatFxAt<320 && key===lastWeaponCombatFxKey && Math.hypot(x-lastWeaponCombatFxX,y-lastWeaponCombatFxY)<1.15) return;
    lastWeaponCombatFxAt=t;
    lastWeaponCombatFxKey=key;
    lastWeaponCombatFxX=x;
    lastWeaponCombatFxY=y;
    noteCombatEvent(Object.assign({
      kind:lucky?'lucky':(special?'special':(element?'elemental':'heavy')),
      source:'hero',
      target:'mob',
      x:Number.isFinite(x)?x:undefined,
      y:Number.isFinite(y)?y:undefined,
      amount:Math.abs(Number(amount)||0),
      element,
      cause:opts.cause || opts.kind || opts.type || opts.weaponType,
      special,
      lucky,
      major,
      power:Math.max(0.7,Math.min(2.35,Number(extra.power)||((major?1.15:0.85)+Math.abs(Number(amount)||0)/18)))
    },extra));
  }
  function noteLuckyStrike(){
    return false;
  }
  function specialAttackRoll(){
    const lucky=Math.random()<SPECIAL_LUCKY_CHANCE;
    // social facilitation: an active ghost audience sharpens every hero attack
    // that rolls here (melee, arrows, charged streams) — neutral 1.0 when solo
    const social=(MM.socialBoost && Number.isFinite(MM.socialBoost.dmg) && MM.socialBoost.dmg>0) ? MM.socialBoost.dmg : 1;
    return {mult:(lucky?4:2)*social,lucky};
  }
  function collectLooseTarget(tx,ty){
    try{
      return !!(MM.collectLooseItemAt && MM.collectLooseItemAt(tx,ty,{source:'melee_weapon',silent:true}));
    }catch(e){}
    return false;
  }
  function openChestFromWeaponHit(wx,wy,opts){
    const chests=MM.chests;
    if(!chests) return false;
    try{
      if(typeof chests.openFromWeaponHitAt==='function') return !!chests.openFromWeaponHitAt(wx,wy,Object.assign({source:'hero'},opts||{}));
      const tx=Math.floor(wx), ty=Math.floor(wy);
      const t=typeof lastGetTile==='function' ? lastGetTile(tx,ty) : null;
      if(typeof chests.openChestAt==='function' && t!=null && INFO[t] && INFO[t].chestTier) return !!chests.openChestAt(tx,ty);
    }catch(e){}
    return false;
  }

  // Keep the held-spear state transition next to fireHeld. Besides making the
  // input path self-contained, this prevents partial live reloads from leaving
  // fireHeld with a reference to a helper that was added farther down the file.
  function holdSpearCharge(player,aimX,w,dt){
    if(!player || !isChargeableSpear(w)) return false;
    if(!spearCharge.active){
      if(meleeCd>0 || (player.atkCd&&player.atkCd>0)) return false;
      if(bowCharge.active) resetBowCharge();
      spearCharge.active=true;
      spearCharge.t=0;
      spearCharge.required=SPEAR_CHARGE_SECONDS;
      spearCharge.player=player;
      spearCharge.full=false;
    }
    const rawDx=Number(aimX)-Number(player.x);
    spearCharge.dir=Number.isFinite(rawDx)&&Math.abs(rawDx)>0.05 ? (rawDx<0?-1:1) : (player.facing<0?-1:1);
    player.facing=spearCharge.dir;
    spearCharge.player=player;
    const wasFull=spearCharge.full;
    spearCharge.t=Math.min(spearCharge.required, spearCharge.t+Math.max(0,Math.min(0.12,Number(dt)||0)));
    spearCharge.full=spearCharge.t+1e-6>=spearCharge.required;
    if(!wasFull&&spearCharge.full){
      try{ if(MM.audio&&MM.audio.play) MM.audio.play('charge'); }catch(e){}
    }
    return true;
  }

  // ---- Firing (called every frame while the fire input is held) ----
  function fireHeld(player, aimX, aimY, dt){
    const w=equippedWeapon();
    const type=weaponType(w);
    if(type==='bow') return updateBowCharge(player, aimX, aimY, w, dt||0.016);
    if(isChargeableSpear(w)) return holdSpearCharge(player, aimX, w, dt||0.016);
    if(bowCharge.active || spearCharge.active) cancelHeld();
    if(type==='harpoon') return fireHarpoon(player, aimX, aimY, w);
    if(type==='thrown') return fireThrown(player, aimX, aimY, w);
    if(type==='bouncy') return fireBouncy(player, aimX, aimY, w);
    if(type==='gravity') return gravityChannel(player, aimX, aimY, w, dt||0.016);
    if(type==='electric') return fireElectric(player, aimX, aimY, w, 1);
    if(STREAMS[type]) return fireStream(player, aimX, aimY, w, dt||0.016, type);
    return fireMelee(player, aimX, aimY);
  }
  function aimVector(player, aimX, aimY){
    let dx=aimX-player.x, dy=aimY-player.y;
    const d=Math.hypot(dx,dy)||1;
    return {dx:dx/d, dy:dy/d};
  }
  function meleeTargetTile(player, aimX, aimY, reach, horizontalOnly){
    const px=Math.floor(player.x), py=Math.floor(player.y);
    const R=Math.max(1, reach||MELEE_REACH);
    if(horizontalOnly){
      const rawDx=Number(aimX)-Number(player.x);
      const dir=Number.isFinite(rawDx) && Math.abs(rawDx)>0.05 ? (rawDx<0?-1:1) : (player.facing<0?-1:1);
      const aimed=Math.max(1,Math.abs(Math.floor(Number.isFinite(aimX)?aimX:player.x+dir)-px));
      return {px,py,tx:px+dir*Math.min(R,aimed),ty:py,dir};
    }
    let tx=Math.floor(aimX), ty=Math.floor(aimY);
    tx=Math.max(px-R, Math.min(px+R, tx));
    ty=Math.max(py-R, Math.min(py+R, ty));
    return {px,py,tx,ty};
  }
  function consumeUltCharge(){
    if(ultCharge<0.35){
      try{ if(window.msg) window.msg('Ult ładuje się: '+Math.round(ultCharge*100)+'%'); }catch(e){}
      return 0;
    }
    const charge=Math.min(1,ultCharge);
    ultCharge=0;
    return charge;
  }
  // Combat feeds the ult on top of the passive timer: +8% per landed hit,
  // +20% when the hero triggers an elemental reaction (mobs.js calls this).
  function addUltCharge(v){
    const n=Number(v);
    if(!Number.isFinite(n) || n<=0) return;
    ultCharge=Math.min(1, ultCharge+n);
  }
  function fireUlt(player, aimX, aimY){
    const w=equippedWeapon();
    if(!w) return false;
    const type=weaponType(w);
    // Gravity gun: RMB IS the throw — it neither charges nor consumes the ult.
    // An empty hand returns false so tryWeaponUltOrDefend still falls through
    // to hero defense (the -25% block) exactly like every other weapon.
    if(type==='gravity'){ return gravThrow(player, aimX, aimY, w); }
    if(type==='electric'){
      if(ultCharge<0.35){
        try{ if(window.msg) window.msg('Ult ładuje się: '+Math.round(ultCharge*100)+'%'); }catch(e){}
        return false;
      }
      const plannedCharge=Math.min(1,ultCharge);
      const roll=specialAttackRoll();
      const plannedPower=roll.mult;
      const cost=electricShotEnergyCost(w,2,plannedCharge);
      if(!heroEnergyAvailable(player,cost)){
        electricCd=Math.max(electricCd,0.18);
        try{ if(window.msg) window.msg('Za mało energii'); }catch(e){}
        return false;
      }
      const charge=consumeUltCharge();
      return fireElectric(player, aimX, aimY, w, plannedPower, charge, roll);
    }
    if(type==='bow' && !hasArrowAmmo()){
      warnNoArrows();
      return false;
    }
    if(type==='harpoon' && !hasHarpoonAmmo()){
      warnNoHarpoons();
      return false;
    }
    if(type==='thrown'){
      const spec=thrownSpec(w);
      if(!spec || !canSpendResource(spec.key,1)){
        sayLimited('thrown_empty_'+(spec?spec.key:'none'),'Brak: '+(spec?spec.label:'amunicji'));
        return false;
      }
    }
    if(type==='bouncy'){
      const bspec=bouncySpec(w);
      if(!canSpendResource(bspec.key,1)){ warnNoBouncyAmmo(bspec); return false; }
    }
    if(STREAMS[type] && ultCharge>=0.35){
      const spec=STREAM_FUEL[type];
      const plannedCost=streamBurstFuelCost(type,Math.min(1,ultCharge));
      if(spec && plannedCost>0 && !canSpendStreamFuel(type,plannedCost)){
        warnMissingResource(spec);
        return false;
      }
    }
    const charge=consumeUltCharge();
    if(!charge) return false;
    if(type==='bow') return firePowerBow(player, aimX, aimY, w, charge);
    if(type==='harpoon') return firePowerHarpoon(player, aimX, aimY, w, charge);
    if(type==='thrown') return firePowerThrown(player, aimX, aimY, w, charge);
    if(type==='bouncy') return firePowerBouncy(player, aimX, aimY, w, charge);
    if(STREAMS[type]) return firePowerStream(player, aimX, aimY, w, type, charge);
    return firePowerMelee(player, aimX, aimY, w, charge);
  }
  function streamDamageOpts(kind,extra){
    const element = kind==='hose' ? 'water' : (kind==='flame' ? 'fire' : (kind==='gas' ? 'gas' : kind));
    const opts={source:'hero',kind,element,type:kind,weaponType:kind,stream:true};
    if(extra && typeof extra==='object') Object.assign(opts,extra);
    return opts;
  }
  function projectilePortalAttribution(entity){
    if(!entity || !Number.isFinite(entity._teleporterExitX) || !Number.isFinite(entity._teleporterExitY)) return {};
    return {
      teleporterExitX:Math.floor(entity._teleporterExitX),
      teleporterExitY:Math.floor(entity._teleporterExitY)
    };
  }
  function projectileEffectOpts(entity,opts){
    return Object.assign({},opts||{},projectilePortalAttribution(entity));
  }
  function puffStreamDamageOpts(kind,p,extra){
    const meta=projectilePortalAttribution(p);
    if(p && p.source) meta.source=p.source;
    if(p && p.cause) meta.cause=p.cause;
    if(p && p.ownerId) {
      meta.ownerId=p.ownerId;
      meta.exclude=[p.ownerId];
    }
    if(p && p.specialAttack) meta.specialAttack=true;
    if(p && p.luckyStrike) meta.luckyStrike=true;
    if(extra && typeof extra==='object') Object.assign(meta,extra);
    return streamDamageOpts(kind,meta);
  }
  function fireMelee(player, aimX, aimY, opts){
    if(meleeCd>0 || (player.atkCd && player.atkCd>0)) return false;
    // Ordinary melee keeps its classic reach. Spears trade free aiming for a
    // three-tile horizontal lane and may multiply damage through hold charge.
    const w=equippedWeapon();
    const form=meleeVisualForm(w);
    const chargeRatio=form==='spear'?clamp01(opts&&opts.chargeRatio):0;
    const damageMult=1+chargeRatio*(SPEAR_MAX_CHARGE_MULT-1);
    const water=meleeWaterProfile(w,player);
    const {px,tx,ty}=meleeTargetTile(player,aimX,aimY,meleeReach(w),form==='spear');
    const rawBonus=(MM.activeModifiers && MM.activeModifiers.attackDamage)||0;
    const baseBonus=Math.max(0,rawBonus*water.damageMult);
    const bonus=form==='spear' ? Math.max(0,(3+baseBonus)*damageMult-3) : baseBonus;
    const chestHit=openChestFromWeaponHit(tx+0.5,ty+0.5,{kind:'melee'});
    const collected=chestHit ? false : collectLooseTarget(tx,ty);
    const hit=chestHit || collected
           || (MM.guardianLairs && MM.guardianLairs.attackAt && MM.guardianLairs.attackAt(tx,ty,bonus))
           || (MM.undergroundBoss && MM.undergroundBoss.attackAt && MM.undergroundBoss.attackAt(tx,ty,bonus))
           || (MM.skyGuardian && MM.skyGuardian.attackAt && MM.skyGuardian.attackAt(tx,ty,bonus))
           || (MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,Math.max(1,2+bonus),{kind:'melee',source:'hero'}))
           || (MM.ufo && MM.ufo.attackAt && MM.ufo.attackAt(tx,ty,bonus))
           || (MM.invasions && MM.invasions.attackAt && MM.invasions.attackAt(tx,ty,bonus))
           || (MM.mechs && MM.mechs.attackAt && MM.mechs.attackAt(tx,ty,bonus,{source:'hero'}))
           || (MM.npcSystem && MM.npcSystem.attackAt && MM.npcSystem.attackAt(tx,ty,bonus))
           || (MM.mobs && MM.mobs.attackAt && MM.mobs.attackAt(tx,ty,bonus,{source:'hero'}));
    const cooldown=0.35*water.cooldownMult;
    meleeCd=cooldown; player.atkCd=Math.max(player.atkCd||0,cooldown);
    player.facing = tx>=px? 1 : -1;
    notifyMeleeSwing(tx,ty,player,chargeRatio);
    if(hit && !collected && !chestHit){
      addUltCharge(0.08);
      rollMeleeEffect(w,tx,ty,{chanceMult:water.effectMult});
      rollMergePerk(w,tx,ty,2+bonus,{chanceMult:water.effectMult});
      noteWeaponCombatHit(tx+0.5,ty+0.15,Math.max(1,2+bonus),{source:'hero',kind:'melee',charged:chargeRatio>0.05},weaponCombatVisualMeta(w,'melee',{major:chargeRatio>=0.75,dir:player.facing,power:0.82+chargeRatio*0.72+Math.min(0.45,bonus/16)}));
    }
    return !!hit;
  }
  function spearChargeRatio(){
    const required=Math.max(0.1,Number(spearCharge.required)||SPEAR_CHARGE_SECONDS);
    return spearCharge.active ? clamp01((spearCharge.t||0)/required) : 0;
  }
  function resetSpearCharge(){
    spearCharge.active=false;
    spearCharge.t=0;
    spearCharge.required=SPEAR_CHARGE_SECONDS;
    spearCharge.dir=1;
    spearCharge.player=null;
    spearCharge.full=false;
  }
  function bowChargeRatio(){
    const required=Math.max(0.1,Number(bowCharge.required)||BOW_CHARGE_SECONDS);
    return bowCharge.active ? Math.max(0,Math.min(1,(bowCharge.t||0)/required)) : 0;
  }
  function bowDamageMult(chargeRatio){
    return 1 + Math.max(0,Math.min(1,Number(chargeRatio)||0))*(BOW_MAX_CHARGE_MULT-1);
  }
  function bowOverdrawEnergyRate(w){
    return Math.max(0, Number(w && w.energyCost)||BOW_OVERDRAW_ENERGY_PER_SEC);
  }
  function heroEnergyStored(player){
    try{
      if(MM.heroEnergy && typeof MM.heroEnergy.info==='function'){
        const info=MM.heroEnergy.info() || {};
        return Math.max(0,Number(info.energy)||0);
      }
    }catch(e){}
    if(player && typeof player.energy==='number') return Math.max(0,Number(player.energy)||0);
    return null;
  }
  function spendHeroEnergyUpTo(player,amount){
    const n=Math.max(0,Number(amount)||0);
    if(n<=0) return 0;
    const stored=heroEnergyStored(player);
    const spend=stored==null ? n : Math.min(n,stored);
    if(spend<=0) return 0;
    return spendHeroEnergy(player,spend) ? spend : 0;
  }
  function resetBowCharge(){
    bowCharge.active=false;
    bowCharge.t=0;
    bowCharge.required=BOW_CHARGE_SECONDS;
    bowCharge.aimX=0;
    bowCharge.aimY=0;
    bowCharge.player=null;
    bowCharge.full=false;
    bowCharge.overdrawT=0;
    bowCharge.energySpent=0;
    bowCharge.starved=false;
  }
  function updateBowCharge(player, aimX, aimY, w, dt){
    if(!player) return false;
    const profile=bowWaterProfile(w,player);
    if(!bowCharge.active){
      if(bowCd>0) return false;
      if(!hasArrowAmmo()){ warnNoArrows(); return false; }
      bowCharge.active=true;
      bowCharge.t=0;
      bowCharge.required=profile.chargeSeconds;
      bowCharge.aimX=aimX;
      bowCharge.aimY=aimY;
      bowCharge.player=player;
      bowCharge.full=false;
      bowCharge.overdrawT=0;
      bowCharge.energySpent=0;
      bowCharge.starved=false;
    }
    const v=aimVector(player,aimX,aimY);
    player.facing=v.dx>=0?1:-1;
    bowCharge.aimX=aimX;
    bowCharge.aimY=aimY;
    bowCharge.player=player;
    bowCharge.required=profile.chargeSeconds;
    const step=Math.max(0,Math.min(0.12,Number(dt)||0));
    const before=bowCharge.t;
    bowCharge.t+=step;
    const required=Math.max(0.1,bowCharge.required);
    const wasFull=bowCharge.full;
    bowCharge.full=bowCharge.t+1e-6>=required;
    if(!wasFull && bowCharge.full){
      try{ if(MM.audio && MM.audio.play) MM.audio.play('charge'); }catch(e){}
    }
    const overDt=Math.max(0,bowCharge.t-Math.max(before,required));
    if(overDt>0){
      const spent=spendHeroEnergyUpTo(player,bowOverdrawEnergyRate(w)*overDt);
      bowCharge.energySpent+=spent;
      bowCharge.overdrawT+=overDt;
      if(spent<=0 && !bowCharge.starved){
        bowCharge.starved=true;
        sayLimited('bow_energy_empty','Brak energii na dalsze napiecie luku',1400);
      }
    }
    return true;
  }
  // Grapple hook (arrowGrapple, pinned "hakowe" tier). The bow launches a rope
  // hook rather than a shaft — the hook lives in the grapple module (MM.grapple),
  // NOT the arrows array, so it survives a guest's wfx stream and never becomes a
  // host-flown projectile. Ammo is already spent by consumeArrowTier() above.
  function fireGrappleShot(player,aimX,aimY,w){
    bowCd=Math.max(0.28,(w && w.fireCooldown)||0.5);
    if(player) player.facing = (Number(aimX)>=player.x) ? 1 : -1;
    triggerHeldActionFx(aquaticStyle(w)==='crossbow'?'crossbow':'bow',0.9,180,false);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    try{ if(MM.grapple && MM.grapple.fire) MM.grapple.fire(player,aimX,aimY); }catch(e){}
    return true;
  }
  function fireBowShot(player, aimX, aimY, w, chargeRatio){
    if(bowCd>0) return false;
    const tier=consumeArrowTier();
    if(!tier) return false;
    if(tier.grapple) return fireGrappleShot(player,aimX,aimY,w);
    const profile=bowWaterProfile(w,player);
    bowCd=Math.max(0.25, (w && w.fireCooldown)||0.55);
    const v=spreadAim(aimVector(player,aimX,aimY),tier,1);
    const sp=ARROW_SPEED*tier.speed*profile.speedMult;
    const baseDamage=Math.max(1,Math.round(((w && w.attackDamage)||3)*tier.damage*profile.damageMult));
    const ratio=Math.max(0,Math.min(1,Number(chargeRatio)||0));
    const full=ratio>=0.999;
    pushArrow({
      x:player.x + v.dx*0.7,
      y:player.y - 0.15 + v.dy*0.7,
      vx:v.dx*sp,
      vy:v.dy*sp - 1.2, // slight lob so mid-range shots arc naturally
      dmg:Math.max(1,Math.round(baseDamage*bowDamageMult(ratio))),
      life:ARROW_LIFE*tier.life*profile.lifeMult, stuck:false, stuckT:ARROW_STUCK,
      charged:ratio>0.01, fullDraw:full,
      fire:!!(full && tier.igniteOnFull), // obsidian edge ignites on a full draw
      tier:tier.id, snowball:!!tier.snowball, splat:tier.snowball?'toxic':undefined,
      stagger:tier.stagger||0,
      mobPierce:tier.mobPierce||0,
      recoverable:!tier.snowball, recoverKey:tier.snowball?null:tier.key,
      color:(full && !tier.snowball)?'#f5d66a':tier.color, headColor:(full && !tier.snowball)?'#fff1a8':tier.head, windCap:sp*1.35,
      aquatic:aquaticStyle(w)==='crossbow', gravityMult:profile.gravityMult,
      waterDrag:profile.waterDrag, windResponse:profile.windResponse,
      weaponPrestige:weaponPrestigeRank(w), weaponGlow:weaponPrestigeColor(w), weaponMaterial:weaponMaterialProfile(w).id, mergePerk:(w&&w.mergePerk)||undefined,
      pierceLeft:tier.id==='iridium' ? 3 : 0
    });
    player.facing = v.dx>=0?1:-1;
    triggerHeldActionFx(aquaticStyle(w)==='crossbow'?'crossbow':'bow',full?1.3:0.85,full?250:180,false);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function spawnHarpoonShot(player,aimX,aimY,w,opts){
    opts=opts||{};
    const profile=harpoonWaterProfile(w,player);
    const v=aimVector(player,aimX,aimY);
    const power=Math.max(1,Number(opts.power)||1);
    const sp=ARROW_SPEED*0.86*profile.speedMult*(opts.speedMult||1);
    const mobPierce=Number.isFinite(opts.mobPierce) ? Math.max(0,Number(opts.mobPierce)) : (profile.submersion>=0.8?1:0);
    pushArrow({
      x:player.x+v.dx*0.82, y:player.y-0.12+v.dy*0.82,
      vx:v.dx*sp, vy:v.dy*sp-0.35,
      dmg:Math.max(1,Math.round(((w&&w.attackDamage)||7)*profile.damageMult*power)),
      life:ARROW_LIFE*1.08*profile.lifeMult, stuck:false, stuckT:ARROW_RECOVER_SECONDS,
      tier:'harpoon', harpoon:true, aquatic:true,
      power:!!opts.powerShot, specialAttack:!!opts.powerShot, luckyStrike:!!opts.luckyStrike,
      mobPierce,
      recoverable:true, recoverKey:'harpoonBolt', breakChance:opts.powerShot?0.08:0.12,
      color:opts.powerShot?'#72e7ff':'#718896', headColor:opts.powerShot?'#e8fdff':'#dcebf2',
      gravityMult:profile.gravityMult, waterDrag:profile.waterDrag,
      weaponPrestige:weaponPrestigeRank(w), weaponGlow:weaponPrestigeColor(w), weaponMaterial:weaponMaterialProfile(w).id, mergePerk:(w&&w.mergePerk)||undefined,
      windResponse:profile.windResponse, windCap:sp*1.2
    });
    player.facing=v.dx>=0?1:-1;
    triggerHeldActionFx('harpoon',opts.powerShot?1.45:1,opts.powerShot?290:220,false);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function fireHarpoon(player,aimX,aimY,w){
    if(harpoonCd>0 || !player) return false;
    if(!consumeHarpoon()) return false;
    const profile=harpoonWaterProfile(w,player);
    harpoonCd=Math.max(0.24,((w&&w.fireCooldown)||0.68)*profile.cooldownMult);
    return spawnHarpoonShot(player,aimX,aimY,w,{});
  }
  // --- bouncy pistol ----------------------------------------------------------
  function bouncySpec(w){
    const id=(w && typeof w.bouncyKind==='string') ? w.bouncyKind : 'plain';
    return BOUNCY_KINDS[id] || BOUNCY_KINDS.plain;
  }
  function bouncyAmmoCount(kind){
    const spec=BOUNCY_KINDS[kind] || BOUNCY_KINDS.plain;
    return resourceCount(spec.key);
  }
  function bouncyInfo(kind){
    const id=(typeof kind==='string' && BOUNCY_KINDS[kind]) ? kind : 'plain';
    const spec=BOUNCY_KINDS[id];
    return {kind:id, key:spec.key, label:spec.label, color:spec.color, flammable:!!spec.flammable,
      count:resourceCount(spec.key), bounces:BOUNCY_MAX_BOUNCES};
  }
  function warnNoBouncyAmmo(spec){ sayLimited('bouncy_empty_'+spec.key,'Brak: '+spec.label); }
  function spawnBouncyBall(player,dx,dy,w,opts){
    opts=opts||{};
    const spec=opts.spec || bouncySpec(w);
    const sp=BOUNCY_SPEED*(opts.speedMult||1);
    const base=Math.max(1,(w && w.attackDamage)||3)*(opts.dmgMult||1);
    return pushArrow({
      x:player.x + dx*0.62,
      y:player.y - 0.18 + dy*0.62,
      vx:dx*sp,
      vy:dy*sp - 0.5,
      dmg:base,
      life:BOUNCY_LIFE*(opts.lifeMult||1), stuck:false, stuckT:ARROW_STUCK,
      bouncy:true, bounces:Math.max(1,Math.round(BOUNCY_MAX_BOUNCES*(opts.bounceMult||1))),
      // `flammable` only says the ball CAN take fire — it never starts alight.
      // Something in the world has to light it (see the ignition gate in update()).
      flammable:!!spec.flammable, bouncyKind:spec===BOUNCY_KINDS.tar?'tar':'plain',
      tier:'bouncy', color:spec.color, headColor:spec.head,
      gravityMult:BOUNCY_GRAVITY_MULT, windResponse:0.5, windCap:sp*1.2,
      power:!!opts.specialAttack, specialAttack:!!opts.specialAttack, luckyStrike:!!opts.luckyStrike,
      weaponPrestige:weaponPrestigeRank(w), weaponGlow:weaponPrestigeColor(w), weaponMaterial:weaponMaterialProfile(w).id, mergePerk:(w&&w.mergePerk)||undefined
    });
  }
  function fireBouncy(player, aimX, aimY, w){
    if(bouncyCd>0 || !player) return false;
    const spec=bouncySpec(w);
    if(!spendResource(spec.key,1)){ warnNoBouncyAmmo(spec); return false; }
    bouncyCd=Math.max(0.16,(w && w.fireCooldown)||0.28);
    const v=aimVector(player,aimX,aimY);
    spawnBouncyBall(player,v.dx,v.dy,w,{spec});
    player.facing=v.dx>=0?1:-1;
    triggerHeldActionFx('bouncy',0.9,150,false);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  // Ult: a tight burst of four balls with a longer bounce budget — a room full of
  // ricochets rather than one bigger bullet, which is what this weapon is FOR.
  // Tar balls in the burst leave the barrel ALREADY LIT: the ult is the one way
  // to strike a light yourself, so the incendiary pistol is not dead weight when
  // there is no fire in the room (same idea as obsidian arrows igniting on a full
  // draw). A lit ball immediately takes the short burn-bounce budget.
  function firePowerBouncy(player, aimX, aimY, w, charge){
    const spec=bouncySpec(w);
    const roll=specialAttackRoll();
    const v=aimVector(player,aimX,aimY);
    let fired=0;
    for(let i=0;i<4;i++){
      if(!spendResource(spec.key,1)) break;
      const ang=(i-1.5)*0.075;
      const ca=Math.cos(ang), sa=Math.sin(ang);
      const ball=spawnBouncyBall(player, v.dx*ca-v.dy*sa, v.dx*sa+v.dy*ca, w,
        {spec, speedMult:1.06+charge*0.18, dmgMult:roll.mult, bounceMult:1.5, lifeMult:1.25,
         specialAttack:true, luckyStrike:roll.lucky && i===0});
      // the guest path returns nothing (the HOST flies the real ball) — never
      // assume a projectile object came back
      if(ball && spec.flammable) igniteBouncyBall(ball);
      fired++;
    }
    if(!fired){ warnNoBouncyAmmo(spec); return false; }
    if(roll.lucky) noteLuckyStrike(player.x+v.dx*1.3,player.y-0.45+v.dy*1.3);
    player.facing=v.dx>=0?1:-1;
    triggerHeldActionFx('bouncy',1.5,260,false);
    bouncyCd=Math.max(bouncyCd,0.22);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  // --- Gravity gun ------------------------------------------------------------
  function gravityModule(){ return (typeof MM!=='undefined' && MM.gravityGun) ? MM.gravityGun : null; }
  function gravityWorld(){ return (typeof MM!=='undefined' && MM.gravityWorld) ? MM.gravityWorld : null; }
  function gravChannelRatio(){ return grav.channel ? Math.max(0,Math.min(1,grav.channel.t/grav.channel.need)) : 0; }
  function spendContinuousEnergy(player, amount){
    const n=Math.max(0,Number(amount)||0);
    if(n<=0) return 0;
    try{ if(MM.heroEnergy && typeof MM.heroEnergy.spendContinuous==='function') return MM.heroEnergy.spendContinuous(n); }catch(e){}
    if(player && typeof player.energy==='number'){
      const spent=Math.min(Math.max(0,player.energy||0),n);
      player.energy=Math.max(0,(player.energy||0)-spent);
      return spent;
    }
    return 0;
  }
  // LMB held: aim at a block within reach and RIP. Channel time comes from the
  // material's hardness, energy drains all the way, and a starved channel SLOWS
  // instead of failing — the rip is paid for in joules, not frames. The commit
  // is idempotent by construction: completing nulls the channel, and the very
  // next call re-targets a now-AIR cell, which the material law refuses.
  function gravityChannel(player, aimX, aimY, w, dt){
    const GG=gravityModule();
    if(!GG || !player) return false;
    if(grav.heldTid){ sayLimited('grav_full','Trzymasz już blok — PPM nim ciska',1400); return false; }
    const reach=Math.max(2,Math.min(10,Number(w && w.fireRange)||GRAV_REACH_DEFAULT));
    const tx=Math.floor(aimX), ty=Math.floor(aimY);
    if(Math.hypot(tx+0.5-player.x, ty+0.5-player.y)>reach+0.5){ grav.channel=null; return false; }
    let tid=T.AIR;
    try{ tid=lastGetTile ? lastGetTile(tx,ty) : T.AIR; }catch(e){ tid=T.AIR; }
    const v=GG.canCarryTile(tid);
    if(!v.ok){
      if(GRAV_REFUSE_MSG[v.reason]) sayLimited('grav_'+v.reason,GRAV_REFUSE_MSG[v.reason],1600);
      if(v.reason==='bedrock'){
        try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('grav_bedrock','Nawet działko grawitacyjne nie ruszy skały macierzystej'); }catch(e){}
      }
      grav.channel=null;
      return false;
    }
    const key=tx+','+ty+':'+tid;
    if(!grav.channel || grav.channel.key!==key){
      grav.channel={key, tx, ty, tid, need:GG.channelSeconds(tid), t:0};
      try{ if(MM.audio && MM.audio.play) MM.audio.play('charge',{x:tx+0.5,y:ty+0.5}); }catch(e){}
    }
    const want=Math.max(1,Number(w && w.energyCost)||GRAV_CHANNEL_COST_DEFAULT)*dt;
    const paid=spendContinuousEnergy(player,want);
    if(paid<want*0.5){
      grav.channel=null;
      sayLimited('grav_energy','Za mało energii na chwyt',1400);
      return false;
    }
    player.facing=(tx+0.5)>=player.x?1:-1;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('beam',{x:player.x,y:player.y}); }catch(e){}
    grav.channel.t+=dt*(paid/want);
    if(grav.channel.t<grav.channel.need) return true;
    const ctx={tx:grav.channel.tx, ty:grav.channel.ty};
    grav.channel=null;
    // hero-mode guest: extraction is a WORLD WRITE — an intent the host
    // validates; the held block arrives on the ack (setGravHeld), never here.
    if(typeof MM!=='undefined' && MM.ghostHeroIntents && MM.ghostHeroIntents.gravExtract){
      MM.ghostHeroIntents.gravExtract(ctx.tx,ctx.ty);
      return true;
    }
    const W=gravityWorld();
    const res=W && W.extractAt ? W.extractAt(ctx.tx,ctx.ty) : null;
    if(!res || !res.ok){
      if(res && GRAV_REFUSE_MSG[res.reason]) sayLimited('grav_'+res.reason,GRAV_REFUSE_MSG[res.reason],1600);
      return false;
    }
    grav.heldTid=res.tid|0;
    triggerHeldActionFx('gravity',1.2,240,false);
    return true;
  }
  // RMB: hurl the held block. The guest names only a DIRECTION — the host reads
  // the tile id from its own body state and flies the real projectile.
  function gravThrow(player, aimX, aimY, w){
    const GG=gravityModule();
    if(!GG || !player) return false;
    if(!grav.heldTid) return false; // empty hand -> hero defense fallback
    const t=nowMs();
    if(t<grav.throwAtMs) return true;
    const tid=grav.heldTid;
    const mass=GG.gravMass(tid);
    const cost=Math.round(GRAV_THROW_COST_BASE+GRAV_THROW_COST_PER_MASS*mass);
    if(!spendHeroEnergy(player,cost)){
      sayLimited('grav_energy','Za mało energii');
      grav.throwAtMs=t+180;
      return true;
    }
    const v=aimVector(player,aimX,aimY);
    player.facing=v.dx>=0?1:-1;
    grav.heldTid=0;
    grav.throwAtMs=t+280;
    if(typeof MM!=='undefined' && MM.ghostHeroIntents && MM.ghostHeroIntents.gravThrow){
      MM.ghostHeroIntents.gravThrow(v.dx,v.dy);
      return true;
    }
    spawnGravityProjectile(player, tid, v, {bonus:Number(w && w.attackDamage)||0});
    try{ if(MM.audio && MM.audio.play) MM.audio.play('thud',{x:player.x,y:player.y}); }catch(e){}
    return true;
  }
  // The single projectile mint — the host bridge calls this for guest throws,
  // so it re-validates the MATERIAL at the source (defense in depth) and caps
  // damage at the shared projectile ceiling.
  function spawnGravityProjectile(body, tid, dir, opts){
    const GG=gravityModule();
    if(!GG || !body || !dir) return false;
    tid=tid|0;
    if(!GG.canCarryTile(tid).ok) return false;
    opts=opts||{};
    const sp=GG.muzzleSpeed(tid);
    const dmg=Math.min(GRAV_DAMAGE_CAP, GG.gravDamage(tid)+Math.max(0,Math.round(Number(opts.bonus)||0)));
    const info=INFO[tid]||{};
    const a={
      x:body.x+dir.dx*0.8, y:body.y-0.15+dir.dy*0.8,
      vx:dir.dx*sp, vy:dir.dy*sp,
      dmg, life:ARROW_LIFE, stuck:false, stuckT:ARROW_STUCK,
      tier:'gravity', grav:true, gravTid:tid, gravMass:GG.gravMass(tid),
      gravityMult:GG.gravMult(tid),
      bounces: tid===T.RUBBER_WOOD ? GG.RUBBER_BOUNCES : 0,
      color:info.color||'#9aa0a8', headColor:info.color||'#9aa0a8',
      recoverable:false, windCap:sp*0.6, windResponse:0.08,
      ang:Math.atan2(dir.dy,dir.dx)
    };
    if(opts.coopOwner){ a.coopOwner=true; a.ownerGid=opts.ownerGid||null; a.duelGid=opts.duelGid||null; }
    return !!pushArrow(a);
  }
  // Creature impact: material damage already landed through the shared chain —
  // here the material's identity speaks (statuses are creature-facing, so a
  // coop block applies them too, tagged 'coop'), then the block breaks up.
  // World payouts (drops) stay host-only: a guest projectile is world-inert.
  function resolveGravityImpactOnCreature(a,tx,ty,getTile,setTile){
    const GG=gravityModule();
    const fx=GG && GG.GRAV_EFFECTS[a.gravTid];
    applyGravityStatusBurst(a,fx);
    if(!a.coopOwner){
      const W=gravityWorld();
      if(W && W.shatterAt) W.shatterAt(a.x,a.y,a.gravTid);
      if(W && W.noiseAt) W.noiseAt(a.x,a.y,a.gravTid,a.gravMass);
      gravityGoldenNote(a);
    }
    spawnGravityBreakFx(a);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('hit',{x:a.x,y:a.y}); }catch(e){}
  }
  function applyGravityStatusBurst(a,fx){
    if(!fx || !MM.mobs) return;
    const src=a.coopOwner?'coop':'hero';
    const apply=(status,dur,dps)=>{
      const opts={dur, source:src, cause:fx.cause};
      if(dps) opts.dps=dps;
      try{
        if(fx.radius>0 && MM.mobs.statusRadius) MM.mobs.statusRadius(a.x,a.y,fx.radius,status,opts);
        else if(MM.mobs.statusAt) MM.mobs.statusAt(Math.floor(a.x),Math.floor(a.y),status,opts);
      }catch(e){}
      try{
        if(fx.radius>0 && MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(a.x,a.y,fx.radius,status,opts);
      }catch(e){}
    };
    apply(fx.status,fx.dur,fx.dps);
    if(fx.also) apply(fx.also.status,fx.also.dur,fx.also.dps);
  }
  function gravityGoldenNote(a){
    if(a.gravTid!==T.GOLDEN_WOOD || a.coopOwner) return;
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('grav_golden','Złoty pień rozbity w locie płaci dziesięciokrotnie!'); }catch(e){}
  }
  function spawnGravityBreakFx(a){
    try{
      if(MM.particles && MM.particles.spawnBurst){
        const TILE=MM.TILE||20;
        MM.particles.spawnBurst(a.x*TILE,a.y*TILE,0,{color:a.color||'#9aa0a8'});
      }
    }catch(e){}
  }
  // Terrain impact. Returns 'continue' when the block keeps flying (rubber
  // ricochet), otherwise the block is spent. Landing writes are host-only.
  function resolveGravityImpactOnTile(a,tx,ty,dx,dy,getTile,setTile){
    const GG=gravityModule();
    if(!GG) return 'done';
    if(a.gravTid===T.RUBBER_WOOD && (a.bounces|0)>0 && bounceBallOffTile(a,tx,ty,dx,dy,getTile)) return 'continue';
    const speed=Math.hypot(a.vx||0,a.vy||0);
    const fx=GG.GRAV_EFFECTS[a.gravTid];
    if(fx && fx.radius>0) applyGravityStatusBurst(a,fx); // splashy matter splashes on the ground too
    const mode=GG.landingMode(a.gravTid,speed);
    // back out of the wall to the last OPEN cell the block actually crossed —
    // a fixed nudge can leave a fast block's center inside the face it struck,
    // and a falling solid spawned inside rock never re-enters the world
    if(speed>0.01){
      const ux=(a.vx||0)/speed, uy=(a.vy||0)/speed;
      for(let k=0;k<5;k++){
        let solid=false;
        try{ solid=isSolid(getTile(Math.floor(a.x),Math.floor(a.y))); }catch(e){ solid=false; }
        if(!solid) break;
        a.x-=ux*0.5; a.y-=uy*0.5;
      }
    }
    if(!a.coopOwner){
      const W=gravityWorld();
      if(W){
        if(mode==='drift'){ W.driftAt(a.x,a.y,a.gravTid); }
        else if(mode==='shatter'){ W.shatterAt(a.x,a.y,a.gravTid); gravityGoldenNote(a); }
        else { W.landAt(a.x,a.y,a.gravTid); } // 'settle' + a rubber ball out of budget
        W.noiseAt(a.x,a.y,a.gravTid,a.gravMass);
        if(a.gravTid===T.MEAT || a.gravTid===T.ROTTEN_MEAT || a.gravTid===T.BAKED_MEAT){
          try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('grav_bait','Rzucone mięso ściąga drapieżniki do miejsca upadku!'); }catch(e){}
        }
      }
    }
    spawnGravityBreakFx(a);
    try{ if(MM.audio && MM.audio.play) MM.audio.play(mode==='shatter'?'break':'place',{x:a.x,y:a.y}); }catch(e){}
    return 'done';
  }
  // Holding a block is WORK: mass drains energy every frame, and an empty tank
  // opens the hand — the block re-enters the world at the muzzle instead of
  // silently evaporating. Solo/host only (update never runs on a hero guest;
  // a guest's carried block is host body state and costs the guest nothing).
  function gravityHoldTick(dt){
    if(!grav.heldTid) return;
    if(typeof MM!=='undefined' && MM.ghostHeroIntents) return;
    const GG=gravityModule();
    const p=(typeof window!=='undefined' && window.player)||null;
    if(!GG || !p) return;
    const want=GRAV_HOLD_DRAIN_PER_MASS*GG.gravMass(grav.heldTid)*dt;
    const paid=spendContinuousEnergy(p,want);
    if(paid>=want*0.5) return;
    const W=gravityWorld();
    if(W && W.landAt) W.landAt(p.x+(p.facing<0?-1.2:1.2), p.y-0.4, grav.heldTid);
    grav.heldTid=0;
    sayLimited('grav_drop','Energia wyczerpana — blok upadł',1600);
  }
  function gravityInfo(){
    return {held:grav.heldTid|0, active:!!grav.channel, ratio:gravChannelRatio(),
      channelTx:grav.channel?grav.channel.tx:0, channelTy:grav.channel?grav.channel.ty:0};
  }
  // Guest ack seam: the host confirmed (or refused) an extraction — the held
  // block is display truth confirmed by the wire, never speculation.
  function setGravHeld(tid){ grav.heldTid=Math.max(0,tid|0); }
  function releaseHeld(player, aimX, aimY){
    // Gravity: lifting LMB mid-rip abandons the channel (the tile stays whole);
    // a block already held keeps floating — only RMB or empty energy lets it go.
    if(grav.channel){ grav.channel=null; return false; }
    const w=equippedWeapon();
    if(spearCharge.active){
      const p=player||spearCharge.player;
      if(!p||!isChargeableSpear(w)){ resetSpearCharge(); return false; }
      const ratio=spearChargeRatio();
      const fallbackX=p.x+(spearCharge.dir<0?-1:1)*meleeReach(w);
      const ax=Number.isFinite(aimX)?aimX:fallbackX;
      resetSpearCharge();
      return fireMelee(p,ax,p.y,{chargeRatio:ratio});
    }
    if(!bowCharge.active) return false;
    if(!w || weaponType(w)!=='bow'){ resetBowCharge(); return false; }
    const p=player || bowCharge.player;
    const ax=Number.isFinite(aimX) ? aimX : bowCharge.aimX;
    const ay=Number.isFinite(aimY) ? aimY : bowCharge.aimY;
    const ratio=bowChargeRatio();
    resetBowCharge();
    return fireBowShot(p, ax, ay, w, ratio);
  }
  function cancelHeld(){
    const was=bowCharge.active||spearCharge.active||!!grav.channel;
    resetBowCharge();
    resetSpearCharge();
    grav.channel=null;
    return was;
  }
  function firePowerBow(player, aimX, aimY, w, charge){
    const tier=consumeArrowTier();
    if(!tier) return false;
    if(tier.grapple) return fireGrappleShot(player,aimX,aimY,w);
    const profile=bowWaterProfile(w,player);
    const roll=specialAttackRoll();
    const v=spreadAim(aimVector(player,aimX,aimY),tier,0.45);
    const sp=ARROW_SPEED*tier.speed*(1.18+charge*0.28)*profile.speedMult;
    if(roll.lucky) noteLuckyStrike(player.x+v.dx*1.3,player.y-0.45+v.dy*1.3);
    pushArrow({
      x:player.x + v.dx*0.75,
      y:player.y - 0.15 + v.dy*0.75,
      vx:v.dx*sp,
      vy:v.dy*sp - 0.9,
      dmg:Math.max(1,Math.round(((w && w.attackDamage)||3)*tier.damage*roll.mult*profile.damageMult)),
      life:ARROW_LIFE*tier.life*(1.05+charge*0.35)*profile.lifeMult, stuck:false, stuckT:ARROW_STUCK,
      power:true, specialAttack:true, luckyStrike:roll.lucky, fire:(roll.lucky || charge>0.85 || tier.igniteOnFull) && !tier.snowball,
      tier:tier.id, snowball:!!tier.snowball, splat:tier.snowball?'toxic':undefined,
      stagger:tier.stagger||0,
      mobPierce:tier.mobPierce ? tier.mobPierce+1 : 0,
      recoverable:!tier.snowball, recoverKey:tier.snowball?null:tier.key,
      color:tier.color, headColor:tier.head, windCap:sp*1.25,
      aquatic:aquaticStyle(w)==='crossbow', gravityMult:profile.gravityMult,
      waterDrag:profile.waterDrag, windResponse:profile.windResponse,
      weaponPrestige:weaponPrestigeRank(w), weaponGlow:weaponPrestigeColor(w), weaponMaterial:weaponMaterialProfile(w).id, mergePerk:(w&&w.mergePerk)||undefined,
      pierceLeft:tier.id==='iridium' ? 5 : 0
    });
    player.facing = v.dx>=0?1:-1;
    triggerHeldActionFx(aquaticStyle(w)==='crossbow'?'crossbow':'bow',1.55,300,false);
    bowCd=Math.max(bowCd,0.25);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function firePowerHarpoon(player,aimX,aimY,w,charge){
    if(!consumeHarpoon()) return false;
    const roll=specialAttackRoll();
    if(roll.lucky) noteLuckyStrike(player.x,player.y-0.35);
    const profile=harpoonWaterProfile(w,player);
    harpoonCd=Math.max(harpoonCd,Math.max(0.20,((w&&w.fireCooldown)||0.68)*profile.cooldownMult*0.72));
    return spawnHarpoonShot(player,aimX,aimY,w,{
      power:roll.mult*(1.05+clamp01(charge)*0.30), powerShot:true,
      luckyStrike:roll.lucky, speedMult:1.15+clamp01(charge)*0.18, mobPierce:2
    });
  }
  function spendHeroEnergy(player, amount){
    const n=Math.max(0, Number(amount)||0);
    if(n<=0) return true;
    try{ if(MM.heroEnergy && typeof MM.heroEnergy.spend==='function') return !!MM.heroEnergy.spend(n); }catch(e){}
    if(player && typeof player.energy==='number'){
      const energy=Math.max(0,player.energy||0);
      const enough=n>=1 ? Math.floor(energy+1e-9)>=Math.ceil(n-1e-9) : (energy>=n && Math.floor(energy+1e-9)>=1);
      if(!enough) return false;
      player.energy=Math.max(0,(player.energy||0)-n);
      if(player.energy<0.0001) player.energy=0;
      return true;
    }
    return false;
  }
  function heroEnergyAvailable(player, amount){
    const n=Math.max(0, Number(amount)||0);
    if(n<=0) return true;
    try{
      if(MM.heroEnergy && typeof MM.heroEnergy.canSpend==='function') return !!MM.heroEnergy.canSpend(n);
      if(MM.heroEnergy && typeof MM.heroEnergy.info==='function'){
        const info=MM.heroEnergy.info()||{};
        const energy=Math.max(0,Number(info.energy)||0);
        return n>=1 ? Math.floor(energy+1e-9)>=Math.ceil(n-1e-9) : (energy>=n && Math.floor(energy+1e-9)>=1);
      }
    }catch(e){}
    if(player && typeof player.energy==='number'){
      const energy=Math.max(0,player.energy||0);
      return n>=1 ? Math.floor(energy+1e-9)>=Math.ceil(n-1e-9) : (energy>=n && Math.floor(energy+1e-9)>=1);
    }
    return true;
  }
  function electricShotEnergyCost(w,power,charge){
    const energyRate=Math.max(0, Number(w && w.energyCost)||ELECTRIC_DEFAULT_ENERGY_PER_SEC);
    const c=Math.max(0, Number(charge)||0);
    if(c>0) return energyRate*(0.85+c*1.15);
    return energyRate*ELECTRIC_PULSE_INTERVAL*Math.max(0.85,Math.min(1.2,Number(power)||1));
  }
  function electricBlocked(t){
    if(t===T.WATER || t===T.LAVA) return false;
    return isSolid(t);
  }
  function electricChargeTargetAt(tx,ty,amount,getTile){
    if(typeof getTile!=='function') return null;
    let tile=T.AIR;
    try{ tile=getTile(tx,ty); }catch(e){ return null; }
    let device=null;
    if(tile===T.TELEPORTER) device=MM.teleporters;
    else if(tile===T.WATER_PUMP) device=MM.pumps;
    else if(tile===T.TURRET || tile===T.FIRE_TURRET || tile===T.WATER_TURRET) device=MM.turrets;
    else if(tile===T.SPRING_PLATFORM) device=MM.springPlatforms;
    else if(tile===T.SOLAR_PANEL || tile===T.SOLAR_BATTERY) device=MM.solar;
    else if(tile===T.DYNAMO || tile===T.DYNAMO_SLOT) device=MM.dynamo;
    else if(tile===T.VENDING_MACHINE) device=MM.vending;
    else if(tile===T.STEAM_BOILER) device=MM.steamMachines;
    else if(tile===T.METEOR_SIREN) device=MM.meteorites;
    else if(INFO[tile] && INFO[tile].requiresHomePower) device=MM.furnishings;
    if(!device || typeof device.receiveElectricChargeAt!=='function') return null;
    let gained=0;
    try{ gained=Math.max(0,Number(device.receiveElectricChargeAt(tx,ty,amount,getTile))||0); }catch(e){ gained=0; }
    return {tile,gained,requested:Math.max(0,Number(amount)||0)};
  }
  function pushElectricBeam(b){
    if(electricBeams.length>=MAX_ELECTRIC_BEAMS) electricBeams.shift();
    electricBeams.push(b);
  }
  function electricDamageAt(tx,ty,dmg,opts){
    opts=Object.assign({kind:'electric',source:'hero'},opts||{});
    try{ if(MM.centerGuardian && MM.centerGuardian.damageAt && MM.centerGuardian.damageAt(tx,ty,dmg,opts)) return true; }catch(e){}
    try{ if(MM.mechs && MM.mechs.damageAt && MM.mechs.damageAt(tx,ty,dmg,opts)) return true; }catch(e){}
    try{ if(MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,dmg,opts)) return true; }catch(e){}
    try{ if(MM.npcSystem && MM.npcSystem.damageAt && MM.npcSystem.damageAt(tx,ty,dmg)) return true; }catch(e){}
    // boss families take opts too: a soaked (wet) boss conducts — x1.25 (boss_status.js)
    try{ if(MM.guardianLairs && MM.guardianLairs.damageAt && MM.guardianLairs.damageAt(tx,ty,dmg,opts)) return true; }catch(e){}
    try{ if(MM.undergroundBoss && MM.undergroundBoss.damageAt && MM.undergroundBoss.damageAt(tx,ty,dmg,opts)) return true; }catch(e){}
    try{ if(MM.skyGuardian && MM.skyGuardian.damageAt && MM.skyGuardian.damageAt(tx,ty,dmg,opts)) return true; }catch(e){}
    try{ if(MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,dmg,opts)) return true; }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,dmg)) return true; }catch(e){}
    try{ if(MM.invasions && MM.invasions.damageAt && MM.invasions.damageAt(tx,ty,dmg)) return true; }catch(e){}
    return false;
  }
  function fireElectric(player, aimX, aimY, w, power, charge, specialRoll){
    if(electricCd>0) return false;
    const v=aimVector(player,aimX,aimY);
    player.facing = v.dx>=0?1:-1;
    power=Math.max(0.5, Number(power)||1);
    const cadence=ELECTRIC_PULSE_INTERVAL;
    const energyCost=electricShotEnergyCost(w,power,charge);
    if(!spendHeroEnergy(player,energyCost)){
      electricCd=Math.max(electricCd,0.18);
      try{ if(window.msg) window.msg('Za mało energii'); }catch(e){}
      return false;
    }
    electricCd=cadence;
    const range=((w && w.fireRange)||8.5)*(power>1 ? Math.min(1.65,1+0.16*power) : 1);
    const baseDps=(w && w.fireDps)||10;
    const roll=specialRoll || (charge ? {mult:2,lucky:false} : null);
    const dmg=charge ? Math.max(2, baseDps*cadence*(roll ? roll.mult : 2)) : Math.max(0.75, baseDps*cadence*power);
    const sx=player.x + v.dx*0.62;
    const sy=player.y - 0.10 + v.dy*0.62;
    let ex=sx+v.dx*range, ey=sy+v.dy*range, hit=false, blocked=false, chestHit=false, chargedDevice=null;
    const worldObj=(typeof MM!=='undefined' && MM.world) ? MM.world : null;
    const tileGetter=(typeof lastGetTile==='function') ? lastGetTile
      : (worldObj && typeof worldObj.getTile==='function' ? (x,y)=>worldObj.getTile(x,y) : null);
    const tileSetter=(typeof lastSetTile==='function') ? lastSetTile
      : (worldObj && typeof worldObj.setTile==='function' ? (x,y,t)=>worldObj.setTile(x,y,t) : null);
    const step=0.18;
    for(let d=0.34; d<=range; d+=step){
      const x=sx+v.dx*d, y=sy+v.dy*d;
      const tx=Math.floor(x), ty=Math.floor(y);
      const t=tileGetter ? tileGetter(tx,ty) : null;
      if(openChestFromWeaponHit(x,y,{kind:'electric',specialAttack:!!charge,hitRadius:0.12})){
        ex=x; ey=y; hit=true; chestHit=true;
        break;
      }
      const chargeTarget=electricChargeTargetAt(tx,ty,energyCost,tileGetter);
      if(chargeTarget){
        ex=x; ey=y; hit=true; chargedDevice=chargeTarget;
        if(chargeTarget.gained>0){
          try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('electric_weapon_charge','Karabin elektryczny może awaryjnie ładować urządzenia.'); }catch(e){}
        }
        break;
      }
      if(tileGetter && tileSetter && applyBlockReaction('electric',tx,ty,tileGetter,tileSetter)){
        ex=sx+v.dx*Math.max(0,d-step*0.5);
        ey=sy+v.dy*Math.max(0,d-step*0.5);
        blocked=true;
        break;
      }
      if(t===T.GLASS && tileSetter && shatterGlassAt(tx,ty,tileSetter,tileGetter)){
        ex=sx+v.dx*Math.max(0,d-step*0.5);
        ey=sy+v.dy*Math.max(0,d-step*0.5);
        blocked=true;
        break;
      }
      if(electricBlocked(t)){
        ex=sx+v.dx*Math.max(0,d-step*0.5);
        ey=sy+v.dy*Math.max(0,d-step*0.5);
        blocked=true;
        break;
      }
      // Water conducts: the beam ends at the surface and electrifies the whole
      // pool — every aquatic creature in it takes the shock (like lightning).
      if(t===T.WATER){
        ex=x; ey=y; hit=true;
        try{
          if(MM.mobs && MM.mobs.shockAquaticRadius){
            const res=MM.mobs.shockAquaticRadius(x,y,4.5,{damage:Math.max(6,dmg*4),getTile:tileGetter,source:'hero',cause:'electric_water',naturalDeath:false});
            if(res && res.hit>0){
              try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('electric_water','Prąd elektryzuje całą taflę wody!'); }catch(e2){}
            }
          }
        }catch(e){}
        try{ if(MM.mobs && MM.mobs.wetRadius) MM.mobs.wetRadius(x,y,2.5,{dur:6}); }catch(e){}
        try{ const p=MM.particles, TILE=MM.TILE||20; if(p && p.spawnSparks) p.spawnSparks(x*TILE,y*TILE,'rare',12); }catch(e){}
        break;
      }
      // ordinary beam hits feed the ult; the ult's own hits must NOT refund it
      // (a successful ult consumes the whole charge — pinned in stream-sim)
      if(electricDamageAt(tx,ty,dmg,{specialAttack:!!charge,luckyStrike:!!(roll&&roll.lucky)})){ ex=x; ey=y; hit=true; if(!charge) addUltCharge(0.08); break; }
    }
    if(hit && !chestHit && roll && roll.lucky) noteLuckyStrike(ex,ey-0.4);
    if(hit && !chestHit) noteWeaponCombatHit(ex,ey-0.4,chargedDevice?0:dmg,{kind:chargedDevice?'electric_charge':'electric',element:'electric',source:'hero',specialAttack:!!charge,luckyStrike:!!(roll&&roll.lucky),chargeAmount:chargedDevice&&chargedDevice.gained||0},weaponCombatVisualMeta(w,'electric',{major:!!charge||!!chargedDevice,dir:player.facing,target:chargedDevice?'device':undefined}));
    pushElectricBeam({x1:sx,y1:sy,x2:ex,y2:ey,t:0,life:charge?0.28:0.18,hit,blocked,phase:Math.random()*Math.PI*2,power,chargeAmount:chargedDevice&&chargedDevice.gained||0});
    triggerHeldActionFx('electric',charge?1.6:Math.max(0.7,power),charge?300:150,false);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('beam'); }catch(e){}
    try{
      const p=MM.particles, TILE=MM.TILE||20;
      if((hit || blocked) && p && p.spawnSparks) p.spawnSparks(ex*TILE,ey*TILE,hit?'rare':'common',hit?10:5);
    }catch(e){}
    return true;
  }
  function fireStream(player, aimX, aimY, w, dt, kind){
    const fuel=consumeStreamFuel(kind,dt);
    if(!fuel) return false;
    try{ if(MM.audio && MM.audio.play) MM.audio.play(kind==='flame'?'flame': kind==='hose'?'hose':'gas'); }catch(e){}
    let dx=aimX-player.x, dy=aimY-player.y;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    player.facing = dx>=0?1:-1;
    const range=(w && w.fireRange)||6;
    const dps=(w && w.fireDps)||(kind==='hose'?2:6);
    spawnExternalStream(kind,player.x,player.y-0.1,dx,dy,{range,dps,source:'hero',coalSmoke:kind==='flame'&&!!fuel.smoke});
    triggerHeldActionFx(kind,0.72,125,true);
    // Elemental streams tick direct damage into boss bodies along the ray.
    // Guardian-specific weaknesses are resolved by guardian_lairs.damageAt.
    bossAcc+=dt;
    if(bossAcc>=0.2 && ((MM.guardianLairs && MM.guardianLairs.damageAt) || (MM.undergroundBoss && MM.undergroundBoss.damageAt) || (MM.skyGuardian && MM.skyGuardian.damageAt) || (MM.bosses && MM.bosses.damageAt) || (MM.ufo && MM.ufo.damageAt) || (MM.invasions && MM.invasions.damageAt) || (MM.mechs && MM.mechs.damageAt))){
      bossAcc=0;
      for(const t of [0.35,0.6,0.85]){
        const sx=Math.floor(player.x + dx*range*t), sy=Math.floor(player.y + dy*range*t);
        const opts=streamDamageOpts(kind,{x:sx+0.5,y:sy+0.5});
        let hit=false;
        if(MM.centerGuardian && MM.centerGuardian.damageAt && MM.centerGuardian.damageAt(sx,sy, dps*0.2, opts)) hit=true;
        else if(MM.mechs && MM.mechs.damageAt && MM.mechs.damageAt(sx,sy, dps*0.2, opts)) hit=true;
        else if(MM.guardianLairs && MM.guardianLairs.damageAt && MM.guardianLairs.damageAt(sx,sy, dps*0.2, opts)) hit=true;
        else if(kind==='flame' && MM.undergroundBoss && MM.undergroundBoss.heatAt && MM.undergroundBoss.heatAt(sx,sy,lastGetTile,lastSetTile,opts)) hit=true;
        else if(kind==='gas' && MM.undergroundBoss && MM.undergroundBoss.damageAt && MM.undergroundBoss.damageAt(sx,sy, dps*0.2, opts)) hit=true;
        else if(kind!=='hose' && MM.skyGuardian && MM.skyGuardian.damageAt && MM.skyGuardian.damageAt(sx,sy, dps*0.2, opts)) hit=true;
        else if(kind!=='hose' && MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(sx,sy, dps*0.2, opts)) hit=true;
        else if(kind!=='hose' && MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(sx,sy, dps*0.2)) hit=true;
        else if(kind!=='hose' && MM.invasions && MM.invasions.damageAt && MM.invasions.damageAt(sx,sy, dps*0.2)) hit=true;
        if(hit){ noteWeaponCombatHit(sx+0.5,sy+0.2,dps*0.2,opts,weaponCombatVisualMeta(w,kind,{dir:player.facing,power:0.72})); addUltCharge(0.03); break; }
      }
    }
    return true;
  }
  function spawnExternalStream(kind,x,y,dx,dy,opts){
    opts=opts||{};
    const cfg=STREAMS[kind];
    if(!cfg || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    const range=Math.max(0.5,Number(opts.range)||6);
    const dps=Math.max(0,Number(opts.dps)||((kind==='hose')?2:6));
    const emit=Math.max(1,Math.round((cfg.emit||1)*(Number(opts.emitScale)||1)));
    const spreadBase=Number.isFinite(opts.spread) ? Math.max(0,opts.spread) : 0.22;
    let made=0;
    if(kind==='flame') flameHeatRays.push({x,y,dx,dy,range});
    for(let i=0;i<emit && puffs.length<MAX_PUFFS;i++){
      const spread=(Math.random()-0.5)*spreadBase;
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const ex=dx*ca - dy*sa, ey=dx*sa + dy*ca;
      const sp=cfg.speed*(Number(opts.speedMult)||1)*(0.85+Math.random()*0.3);
      puffs.push({
        kind,
        x:x + ex*(Number(opts.muzzle)||0.6),
        y:y + ey*(Number(opts.muzzle)||0.6),
        vx:ex*sp, vy:ey*sp + (Number.isFinite(opts.vyKick)?opts.vyKick:-0.3),
        life:range/cfg.speed*cfg.lifeMult*(0.9+Math.random()*0.25),
        total:range/cfg.speed*cfg.lifeMult,
        dps,
        scale:Number(opts.scale)||1,
        source:opts.source || undefined,
        cause:opts.cause || undefined,
        ownerId:opts.ownerId || undefined,
        specialAttack:!!opts.specialAttack,
        luckyStrike:!!opts.luckyStrike,
        coalSmoke:kind==='flame'&&!!opts.coalSmoke
      });
      made++;
    }
    return made;
  }
  function firePowerStream(player, aimX, aimY, w, kind, charge){
    const fuel=consumeStreamBurstFuel(kind,charge);
    if(!fuel) return false;
    try{ if(MM.audio && MM.audio.play) MM.audio.play(kind==='flame'?'flame': kind==='hose'?'hose':'gas'); }catch(e){}
    const cfg=STREAMS[kind];
    const v=aimVector(player,aimX,aimY);
    const roll=specialAttackRoll();
    if(roll.lucky) noteLuckyStrike(player.x+v.dx*1.2,player.y-0.35+v.dy*1.2);
    player.facing = v.dx>=0?1:-1;
    const range=(w && w.fireRange)||6;
    const dps=((w && w.fireDps)||(kind==='hose'?2:6))*roll.mult;
    const totalLife=range/cfg.speed*cfg.lifeMult*(1.2+charge*0.4);
    const n=Math.min(MAX_PUFFS-puffs.length, Math.round(16+charge*18));
    triggerHeldActionFx(kind,1.35+charge*0.45,320,false);
    for(let i=0;i<n;i++){
      const spread=(Math.random()-0.5)*(0.42-charge*0.12);
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const ex=v.dx*ca - v.dy*sa, ey=v.dx*sa + v.dy*ca;
      const sp=cfg.speed*(1.05+charge*0.55)*(0.88+Math.random()*0.24);
      puffs.push({
        kind,
        x:player.x + ex*0.6, y:player.y - 0.1 + ey*0.6,
        vx:ex*sp, vy:ey*sp - 0.2,
        life:totalLife*(0.85+Math.random()*0.25),
        total:totalLife,
        dps,
        scale:1.25+charge*0.75,
        source:'hero',
        specialAttack:true,
        luckyStrike:roll.lucky,
        coalSmoke:kind==='flame'&&!!fuel.smoke
      });
    }
    for(const t of [0.35,0.55,0.75,0.95]){
      const sx=Math.floor(player.x + v.dx*range*t), sy=Math.floor(player.y + v.dy*range*t);
      const opts=streamDamageOpts(kind,{x:sx+0.5,y:sy+0.5,specialAttack:true,luckyStrike:roll.lucky});
      let hit=false;
      if(MM.centerGuardian && MM.centerGuardian.damageAt && MM.centerGuardian.damageAt(sx,sy,dps*0.18,opts)) hit=true;
      else if(MM.mechs && MM.mechs.damageAt && MM.mechs.damageAt(sx,sy,dps*0.18,opts)) hit=true;
      else if(MM.guardianLairs && MM.guardianLairs.damageAt && MM.guardianLairs.damageAt(sx,sy,dps*0.18,opts)) hit=true;
      else if(kind==='flame' && MM.undergroundBoss && MM.undergroundBoss.heatAt && MM.undergroundBoss.heatAt(sx,sy,lastGetTile,lastSetTile,opts)) hit=true;
      else if(kind==='gas' && MM.undergroundBoss && MM.undergroundBoss.damageAt && MM.undergroundBoss.damageAt(sx,sy,dps*0.18,opts)) hit=true;
      else if(kind!=='hose' && MM.skyGuardian && MM.skyGuardian.damageAt && MM.skyGuardian.damageAt(sx,sy,dps*0.18,opts)) hit=true;
      else if(kind!=='hose' && MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(sx,sy,dps*0.18,opts)) hit=true;
      else if(kind!=='hose' && MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(sx,sy,dps*0.18)) hit=true;
      else if(kind!=='hose' && MM.invasions && MM.invasions.damageAt && MM.invasions.damageAt(sx,sy,dps*0.18)) hit=true;
      if(hit){ noteWeaponCombatHit(sx+0.5,sy+0.2,dps*0.18,opts,weaponCombatVisualMeta(w,kind,{major:true,dir:player.facing,power:1.35+charge*0.35})); break; }
    }
    return true;
  }
  function firePowerMelee(player, aimX, aimY, w, charge){
    const v=aimVector(player,aimX,aimY);
    const form=meleeVisualForm(w);
    const {px,tx,ty}=meleeTargetTile(player,aimX,aimY,meleeReach(w),form==='spear');
    const bonus=(MM.activeModifiers && MM.activeModifiers.attackDamage)||0;
    const water=meleeWaterProfile(w,player);
    const roll=specialAttackRoll();
    const chargeFx=Math.max(0,Math.min(1,Number(charge)||0));
    const dmg=Math.max(1,Math.round((3 + bonus + ((w && w.attackDamage)||3))*roll.mult*water.damageMult));
    let hit=false;
    const chestHit=openChestFromWeaponHit(tx+0.5,ty+0.5,{kind:'melee',specialAttack:true});
    const collected=chestHit ? false : collectLooseTarget(tx,ty);
    hit = !!(chestHit || collected || (MM.centerGuardian && MM.centerGuardian.damageAt && MM.centerGuardian.damageAt(tx,ty,dmg,{kind:'melee',source:'hero'}))
      || (MM.guardianLairs && MM.guardianLairs.damageAt && MM.guardianLairs.damageAt(tx,ty,dmg))
      || (MM.undergroundBoss && MM.undergroundBoss.damageAt && MM.undergroundBoss.damageAt(tx,ty,dmg))
      || (MM.skyGuardian && MM.skyGuardian.damageAt && MM.skyGuardian.damageAt(tx,ty,dmg,{kind:'melee',source:'hero'}))
      || (MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,dmg,{kind:'melee',source:'hero',specialAttack:true,luckyStrike:roll.lucky}))
      || (MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,dmg))
      || (MM.invasions && MM.invasions.damageAt && MM.invasions.damageAt(tx,ty,dmg))
      || (MM.mechs && MM.mechs.damageAt && MM.mechs.damageAt(tx,ty,dmg,{source:'hero',kind:'melee',specialAttack:true,luckyStrike:roll.lucky}))
      || (MM.npcSystem && MM.npcSystem.damageAt && MM.npcSystem.damageAt(tx,ty,dmg))
      || (MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,dmg,{source:'hero',kind:'melee',specialAttack:true,luckyStrike:roll.lucky})));
    if(hit && !chestHit && roll.lucky) noteLuckyStrike(tx+0.5,ty-0.15);
    if(hit && !chestHit) noteWeaponCombatHit(tx+0.5,ty+0.15,dmg,{source:'hero',kind:'melee',specialAttack:true,luckyStrike:roll.lucky},weaponCombatVisualMeta(w,'melee',{major:true,dir:player.facing,power:1.35+chargeFx*0.45}));
    if(hit && !collected && !chestHit){
      rollMeleeEffect(w,tx,ty,{chanceMult:1.5*water.effectMult}); // a charged blow procs its material more often
      rollMergePerk(w,tx,ty,dmg,{chanceMult:1.5*water.effectMult});
    }
    player.facing = form==='spear' ? (tx>=px?1:-1) : (v.dx>=0?1:-1);
    meleeCd=Math.max(meleeCd,0.25*water.cooldownMult);
    player.atkCd=Math.max(player.atkCd||0,0.35*water.cooldownMult);
    notifyMeleeSwing(tx,ty,player,form==='spear'?chargeFx:0);
    blastsFx.push({x:tx+0.5,y:ty+0.5,R:0.82+chargeFx*0.12,t:0,max:0.35});
    return hit;
  }

  // A dying hose puff sometimes condenses into a real water tile
  function condenseWater(x,y,getTile,setTile){
    if(typeof setTile!=='function') return;
    if(Math.random()>=WATER_CONDENSE_CHANCE) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    const t=getTile(tx,ty);
    if(!isCondensedWaterTargetTile(t)) return;
    try{
      if(MM.water && MM.water.addSource) MM.water.addSource(tx,ty,getTile,setTile);
      else setTile(tx,ty,T.WATER);
    }catch(e){ /* fluid sim unavailable — no puddle */ }
  }
  function explosionEditableY(y){
    return Number.isFinite(y) && y>=WORLD_TOP+1 && y<WORLD_BOTTOM-3;
  }
  // --- Gas detonation (TNT effect) ----------------------------------------------
  // Toxic vapour touching open flame or lava explodes: nearby gas puffs are
  // consumed into the blast (bigger cloud → bigger boom), soft terrain craters,
  // creatures and the hero are hurt, and the rim catches fire. Obsidian and
  // diamonds survive; chests open through their normal loot path instead of
  // being erased. A short cooldown turns a stream
  // sprayed straight onto lava into rhythmic booms instead of a 60-per-second buzz.
  const blastsFx=[]; // {x,y,R,t,max}
  let explodeCd=0;
  function radialDamageAmount(base,distance,radius,minDamage){
    const b=Math.max(1,Number(base)||1), r=Math.max(0.1,Number(radius)||0.1);
    const d=Math.max(0,Number(distance)||0);
    return Math.max(Math.max(1,Number(minDamage)||1),Math.round(b*(1-d/(r+0.5))));
  }
  function damageBlastHeroes(wx,wy,r,dmg,cause){
    const radius=Math.max(0.5,Number(r)||1), base=Math.max(1,Number(dmg)||1);
    let hits=0;
    const pl=(typeof window!=='undefined' && window.player)||null;
    if(pl && typeof pl.hp==='number' && pl.hp>0 && typeof window.damageHero==='function'){
      const d=Math.hypot(pl.x-wx,pl.y-wy);
      if(d<radius){
        window.damageHero(radialDamageAmount(base,d,radius,3),{srcX:wx,srcY:wy,kb:6,kbY:-5,cause:cause||'explosion'});
        hits++;
      }
    }
    const bodies=(typeof MM!=='undefined' && MM.coopBodies)||null;
    if(Array.isArray(bodies)){
      for(const body of bodies){
        if(!body || body.dead || typeof body.hurt!=='function') continue;
        const d=Math.hypot((Number(body.x)||0)-wx,(Number(body.y)||0)-wy);
        if(d>=radius) continue;
        try{
          body.hurt(radialDamageAmount(base,d,radius,3),wx,wy,cause||'explosion');
          hits++;
        }catch(e){}
      }
    }
    return hits;
  }
  function explodeAt(wx,wy,getTile,setTile,opts){
    opts=opts||{};
    if(explodeCd>0 && !opts.force){ return false; } // fizzle — the triggering puff just burns off
    explodeCd=0.5;
    // consume the surrounding cloud into the blast
    let consumed=Math.max(0,(opts.extraConsumed|0)||0);
    for(let i=puffs.length-1;i>=0;i--){
      const q=puffs[i];
      if(q.kind!=='gas') continue;
      const dx=q.x-wx, dy=q.y-wy;
      if(dx*dx+dy*dy<=9){ puffs.splice(i,1); consumed++; }
    }
    try{ if(MM.gases && MM.gases.consumeRadius) consumed += MM.gases.consumeRadius('fuel',wx,wy,3,getTile,setTile); }catch(e){}
    const R=(opts.radius && Number.isFinite(opts.radius)) ? Math.max(0.8,Math.min(4,opts.radius)) : 2.2+Math.min(1.6, consumed*0.06);
    try{ if(MM.discovery && MM.discovery.note && consumed>0) MM.discovery.note('gas_boom','Obłok gazu można zdetonować ogniem!'); }catch(e){}
    const bx=Math.round(wx), by=Math.round(wy);
    // crater: soft tiles blasted out; precious and blast-resistant tiles survive
    const Ri=Math.ceil(R);
    for(let dy=-Ri;dy<=Ri;dy++){
      for(let dx=-Ri;dx<=Ri;dx++){
        if(dx*dx+dy*dy>R*R) continue;
        const tx=bx+dx, ty=by+dy;
        if(!explosionEditableY(ty)) continue;
        const t=getTile(tx,ty);
        if(opts.source!=='mob' && opts.source!=='enemy'
          && openChestFromWeaponHit(tx+0.5,ty+0.5,{kind:'explosion',specialAttack:true,hitRadius:0.72})){
          continue;
        }
        if(isBlastProtectedTile(t)) continue;
        if(typeof setTile!=='function') continue;
        awardUfoConcreteShard(tx,ty,t);
        setTile(tx,ty,T.AIR);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
      }
    }
    // the rim catches fire
    if(opts.igniteRim!==false && FIRE && FIRE.ignite){
      for(let k=0;k<6;k++){ const a=Math.random()*6.283; FIRE.ignite(Math.round(bx+Math.cos(a)*R), Math.round(by+Math.sin(a)*R), getTile, setTile); }
    }
    // creatures, bosses, plants
    const blastSource=typeof opts.source==='string' && opts.source ? opts.source : 'hero';
    const blastCause=typeof opts.cause==='string' && opts.cause ? opts.cause : 'weapon_blast';
    const blastDamage=Number.isFinite(Number(opts.damage)) ? Math.max(1,Math.min(120,Number(opts.damage))) : 14;
    const blastOpts={kind:'explosion',source:blastSource,cause:blastCause,terrainDamage:true};
    const edgeDamage=Math.max(2,Math.round(blastDamage*0.64));
    if(blastDamage===14) damageBlastCreatures(MM,wx,wy,R+1.5,14,{source:blastSource,cause:blastCause});
    else damageBlastCreatures(MM,wx,wy,R+1.5,blastDamage,{source:blastSource,cause:blastCause});
    try{ if(MM.centerGuardian && MM.centerGuardian.damageAt){ MM.centerGuardian.damageAt(bx,by,blastDamage,blastOpts); MM.centerGuardian.damageAt(bx+1,by,edgeDamage,blastOpts); MM.centerGuardian.damageAt(bx-1,by,edgeDamage,blastOpts); } }catch(e){}
    try{ if(MM.guardianLairs && MM.guardianLairs.damageAt){ MM.guardianLairs.damageAt(bx,by,blastDamage,blastOpts); MM.guardianLairs.damageAt(bx+1,by,edgeDamage,blastOpts); MM.guardianLairs.damageAt(bx-1,by,edgeDamage,blastOpts); MM.guardianLairs.damageAt(bx,by-1,edgeDamage,blastOpts); } }catch(e){}
    try{ if(MM.undergroundBoss && MM.undergroundBoss.damageAt){ const gasOpts=streamDamageOpts('gas',{x:wx,y:wy,type:'gasExplosion'}); MM.undergroundBoss.damageAt(bx,by,blastDamage,gasOpts); MM.undergroundBoss.damageAt(bx+1,by,edgeDamage,gasOpts); MM.undergroundBoss.damageAt(bx-1,by,edgeDamage,gasOpts); MM.undergroundBoss.damageAt(bx,by-1,edgeDamage,gasOpts); } }catch(e){}
    try{ if(MM.skyGuardian && MM.skyGuardian.damageAt){ const gasOpts=streamDamageOpts('gas',{x:wx,y:wy,type:'gasExplosion'}); MM.skyGuardian.damageAt(bx,by,blastDamage,gasOpts); MM.skyGuardian.damageAt(bx+1,by,edgeDamage,gasOpts); MM.skyGuardian.damageAt(bx-1,by,edgeDamage,gasOpts); MM.skyGuardian.damageAt(bx,by-1,edgeDamage,gasOpts); } }catch(e){}
    try{ if(MM.bosses && MM.bosses.damageAt){ MM.bosses.damageAt(bx,by,blastDamage*0.86,blastOpts); MM.bosses.damageAt(bx+1,by,edgeDamage,blastOpts); MM.bosses.damageAt(bx-1,by,edgeDamage,blastOpts); MM.bosses.damageAt(bx,by-1,edgeDamage,blastOpts); } }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt){ MM.ufo.damageAt(bx,by,blastDamage); MM.ufo.damageAt(bx,by-1,edgeDamage); } }catch(e){}
    try{ if(MM.plants && MM.plants.scorchAt) MM.plants.scorchAt(wx,wy,R+1); }catch(e){}
    // Host and embodied co-op heroes share the same distance falloff.
    const heroDamage=Number.isFinite(Number(opts.heroDamage)) ? Math.max(1,Math.min(120,Number(opts.heroDamage))) : 16;
    damageBlastHeroes(wx,wy,R+2,heroDamage,blastCause);
    // FX: expanding ring + spark burst + scattered short flames
    blastsFx.push({x:wx,y:wy,R,t:0,max:0.5});
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(wx*(MM.TILE||20),wy*(MM.TILE||20),'epic'); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('explosion',{x:wx,y:wy}); }catch(e){}
    for(let k=0;k<8 && puffs.length<MAX_PUFFS;k++){
      const a=Math.random()*6.283, sp=4+Math.random()*5;
      puffs.push({kind:'flame', x:wx, y:wy, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-1, life:0.3+Math.random()*0.3, total:0.55, dps:5});
    }
    return true;
  }

  function deployMine(a,getTile,setTile){
    if(!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
    if(mines.length>=MAX_MINES) mines.shift();
    const type=a.mineType==='fragmentation'?'fragmentation':'blast';
    mines.push({
      x:a.x,
      y:a.y,
      type,
      age:0,
      armed:false,
      color:type==='fragmentation'?'#5b493d':'#46505a',
      headColor:type==='fragmentation'?'#ffb14a':'#ff5b45'
    });
    const tile=MM.TILE||20;
    try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:0.42,element:'mine_set'}); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('dig',{x:a.x,y:a.y}); }catch(e){}
    return true;
  }
  function actorBodyTouchesMine(actor,mine,bodyIsCentered){
    if(!actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return false;
    const w=Math.max(0.25,Number(actor.w)||0.7);
    const h=Math.max(0.3,Number(actor.h)||0.95);
    const footY=bodyIsCentered===false ? actor.y : actor.y+h*0.5;
    return Math.abs(actor.x-mine.x)<=Math.max(0.58,w*0.52)
      && Math.abs(footY-mine.y)<=0.48;
  }
  function mineHasTriggerActor(mine,player){
    const pl=player || ((typeof window!=='undefined' && window.player)||null);
    if(pl && typeof pl.hp==='number' && pl.hp>0 && actorBodyTouchesMine(pl,mine,true)) return true;
    const bodies=(typeof MM!=='undefined' && MM.coopBodies)||null;
    if(Array.isArray(bodies)){
      for(const body of bodies){
        if(body && !body.dead && actorBodyTouchesMine(body,mine,true)) return true;
      }
    }
    try{
      if(MM.mobs && MM.mobs.nearestLiving && MM.mobs.nearestLiving(mine.x,mine.y-0.28,MINE_TRIGGER_RADIUS)) return true;
    }catch(e){}
    try{
      if(MM.invasions && MM.invasions.nearestForEnemy && MM.invasions.nearestForEnemy(mine.x,mine.y-0.28,MINE_TRIGGER_RADIUS)) return true;
    }catch(e){}
    try{
      if(MM.companions && MM.companions.nearestForEnemy && MM.companions.nearestForEnemy(mine.x,mine.y-0.28,MINE_TRIGGER_RADIUS)) return true;
    }catch(e){}
    try{
      if(MM.mechs && MM.mechs.findAt){
        const tx=Math.floor(mine.x), ty=Math.floor(mine.y);
        if(MM.mechs.findAt(tx,ty) || MM.mechs.findAt(tx,ty-1)) return true;
      }
    }catch(e){}
    try{
      if(MM.npcSystem && MM.npcSystem.list){
        for(const npc of MM.npcSystem.list()){
          const body=npc && typeof npc.body==='function' ? npc.body() : null;
          if(body && actorBodyTouchesMine(body,mine,true)) return true;
        }
      }
    }catch(e){}
    // Boss families already expose bounded turret target queries. Reusing them
    // keeps mines off private arrays while still making a boss-sized foot/body a
    // valid pressure trigger.
    try{
      for(const system of [MM.bosses,MM.guardianLairs,MM.undergroundBoss,MM.skyGuardian]){
        if(system && typeof system.nearestForTurret==='function'
          && system.nearestForTurret(mine.x,mine.y-0.28,MINE_TRIGGER_RADIUS,true)) return true;
      }
    }catch(e){}
    try{
      const center=MM.centerGuardian && MM.centerGuardian.status ? MM.centerGuardian.status() : null;
      if(center && center.mimic && Math.hypot(center.mimic.x-mine.x,center.mimic.y-mine.y)<=MINE_TRIGGER_RADIUS) return true;
    }catch(e){}
    try{
      const craft=MM.ufo && MM.ufo.current ? MM.ufo.current() : null;
      if(craft && craft.hp>0 && Math.hypot(craft.x-mine.x,craft.y-mine.y)<=MINE_TRIGGER_RADIUS) return true;
    }catch(e){}
    return false;
  }
  function spawnMineShrapnel(x,y){
    const count=12;
    for(let i=0;i<count;i++){
      if(mineFragments.length>=MAX_MINE_FRAGMENTS) mineFragments.shift();
      const angle=(i/count)*Math.PI*2+(Math.random()-0.5)*0.16;
      const speed=7.5+Math.random()*5.5;
      mineFragments.push({
        x,y:y-0.08,
        vx:Math.cos(angle)*speed,
        vy:Math.sin(angle)*speed-0.8,
        angle,
        t:0,
        life:0.42+Math.random()*0.30
      });
    }
  }
  function detonateMine(mine,getTile,setTile){
    if(!mine || typeof getTile!=='function' || typeof setTile!=='function') return false;
    const fragmentation=mine.type==='fragmentation';
    const cause=fragmentation?'fragmentation_mine':'antipersonnel_mine';
    const exploded=explodeAt(mine.x,mine.y,getTile,setTile,{
      force:true,
      radius:MINE_CRATER_RADIUS,
      damage:MINE_BLAST_DAMAGE,
      heroDamage:MINE_BLAST_DAMAGE,
      source:'hero',
      cause,
      igniteRim:false
    });
    if(fragmentation){
      spawnMineShrapnel(mine.x,mine.y);
      damageBlastCreatures(MM,mine.x,mine.y,MINE_FRAGMENT_RADIUS,MINE_FRAGMENT_DAMAGE,{
        source:'hero',
        cause:'fragmentation_mine_shrapnel'
      });
      damageBlastHeroes(mine.x,mine.y,MINE_FRAGMENT_RADIUS,MINE_FRAGMENT_DAMAGE,'fragmentation_mine_shrapnel');
      try{
        if(MM.particles && MM.particles.spawnSparks){
          MM.particles.spawnSparks(mine.x*(MM.TILE||20),mine.y*(MM.TILE||20),'rare',18);
        }
      }catch(e){}
    }
    return exploded;
  }
  function updateMines(dt,getTile,setTile,player){
    for(let i=mines.length-1;i>=0;i--){
      const mine=mines[i];
      mine.age+=dt;
      if(!mine.armed && mine.age>=MINE_ARM_SECONDS) mine.armed=true;
      if(!mine.armed || !mineHasTriggerActor(mine,player)) continue;
      mines.splice(i,1);
      detonateMine(mine,getTile,setTile);
    }
    for(let i=mineFragments.length-1;i>=0;i--){
      const f=mineFragments[i];
      f.t+=dt;
      if(f.t>=f.life){ mineFragments.splice(i,1); continue; }
      f.vy+=ARROW_GRAV*0.22*dt;
      f.x+=f.vx*dt;
      f.y+=f.vy*dt;
      f.angle=Math.atan2(f.vy,f.vx);
      if(typeof getTile==='function' && isSolid(getTile(Math.floor(f.x),Math.floor(f.y)))){
        mineFragments.splice(i,1);
      }
    }
  }

  // White cosmetic steam wisps (boiled water, quenched lava)
  function emitSteam(x,y,n,getTile,setTile){
    if(n>=3) addWorldGas('steam',x,y,{power:Math.min(1.8,n*0.22),cells:Math.min(4,Math.max(1,(n/2)|0)),getTile,setTile});
    for(let i=0;i<n && puffs.length<MAX_PUFFS;i++){
      puffs.push({
        kind:'steam',
        x:x+(Math.random()-0.5)*0.5, y:y+(Math.random()-0.5)*0.3,
        vx:(Math.random()-0.5)*1.2, vy:-1.5-Math.random()*1.5,
        life:0.6+Math.random()*0.5, total:1.0, dps:0
      });
    }
  }
  function thawColdTile(tx,ty,getTile,setTile){
    if(typeof setTile!=='function') return false;
    if(FIRE && FIRE.thawAt) return FIRE.thawAt(tx,ty,getTile,setTile);
    const t=getTile(tx,ty);
    if(t===T.GRASS_SNOW){ setTile(tx,ty,T.GRASS); return true; }
    const thawed=thawedEarthVariant(t);
    if(thawed!=null){ setTile(tx,ty,thawed); return true; }
    if(t!==T.SNOW && t!==T.ICE) return false;
    setTile(tx,ty,T.WATER);
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    return true;
  }
  function cookMeatAt(tx,ty,getTile,setTile){
    if(typeof setTile!=='function') return false;
    if(FIRE && FIRE.cookAt) return FIRE.cookAt(tx,ty,getTile,setTile);
    if(getTile(tx,ty)!==T.MEAT) return false;
    setTile(tx,ty,T.BAKED_MEAT);
    return true;
  }
  // Toxic snowball impact: the ball bursts into a small poison+chill cloud —
  // creatures caught in it are slowed hard (chill) and poisoned over time.
  const SNOWBALL_SPLAT={radius:1.5, poisonDur:5, poisonDps:2, chillDur:4};
  const SAND_BLIND_DUR=5.0, SAND_SHOCK_DUR=2.6;
  const TOXIC_SPIT_COLOR='#55db63', TOXIC_SPIT_HEAD='#dcffd6';
  // Crafted hand-weapon material identities (recipes in main.js): mirroring the
  // arrow-tier philosophy, each material carries ONE on-hit effect chance —
  // metal cuts (bleed DoT), stone concusses (short stun), diamond terrifies
  // (panic: the creature bolts). The item only names its identity (meleeEffect);
  // the numbers live here so every weapon of a material behaves the same.
  const MELEE_EFFECTS={
    bleed:{chance:0.35, dur:4,   dps:2, note:['melee_bleed','Metalowa krawędź otwiera rany — cel krwawi!']},
    stun: {chance:0.25, dur:1.1, dps:0, note:['melee_stun','Kamienny cios oszałamia cel!']},
    panic:{chance:0.30, dur:3.0, dps:0, note:['melee_panic','Błysk diamentu sieje panikę — wróg ucieka!']},
    // Sunder cracks armor (mobs STATUS 'sunder', armor 1.5 → target takes +50%
    // damage). note id is intentionally NOT in the discovery CATALOG, so the toast
    // no-ops and the structured-XP arc-balance economy is untouched.
    sunder:{chance:0.30, dur:3.0, dps:0, note:['melee_sunder','Ciężki obuch pęka pancerz — cel przyjmuje więcej obrażeń!']}
  };
  // Spears own the long three-tile lane even when loaded from an older save that
  // still stores fireRange:2; everything else keeps its configured/classic reach.
  function meleeReach(w){
    const r=Number(w && w.fireRange);
    const minReach=isChargeableSpear(w)?3:MELEE_REACH;
    return Number.isFinite(r) ? Math.max(minReach,Math.min(3,Math.round(r))) : minReach;
  }
  function rollMeleeEffect(w,tx,ty,opts){
    const spec=w && MELEE_EFFECTS[w.meleeEffect];
    if(!spec) return false;
    if(Math.random()>=spec.chance*((opts && opts.chanceMult)||1)) return false;
    let applied=false;
    try{
      if(MM.mobs && MM.mobs.statusAt){
        applied=!!MM.mobs.statusAt(tx,ty,w.meleeEffect,{dur:spec.dur,dps:spec.dps,source:'hero',cause:'melee_'+w.meleeEffect});
      }
    }catch(e){}
    if(!applied) return false;
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note(spec.note[0],spec.note[1]); }catch(e){}
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnImpactChips) p.spawnImpactChips((tx+0.5)*tile,(ty+0.2)*tile,{power:0.85});
    }catch(e){}
    return true;
  }
  // Merge-forged weapon perks (identity on the item as mergePerk — the fusion
  // forge in inventory.js mints it; ALL numbers live here). One roll per hit,
  // wired into the same chokepoints as meleeEffect/projectile creature hits.
  const MERGE_PERKS={
    vampire:{chance:0.45, note:['merge_vampire','Wampiryczne ostrze oddaje ci część zadanego bólu!']},
    venom:  {chance:0.35, dur:4,   dps:2, status:'poison', note:['merge_venom','Jadowa fuzja zatruwa cel!']},
    frost:  {chance:0.35, dur:2.5, dps:0, status:'chill',  note:['merge_frost','Szron fuzji spowalnia cel!']},
    storm:  {chance:0.30, dur:0.9, dps:0, status:'stun',   note:['merge_storm','Burzowa iskra wstrząsa celem!']},
    fury:   {chance:0.22, note:['merge_fury','Furia fuzji uderza drugi raz!']},
    ember:  {chance:0.30, dur:2.5, dps:2, status:'burn',   note:['merge_ember','Żar fuzji podpala cel!']}
  };
  function applyMergePerkAt(perk,tx,ty,dmg,opts){
    const spec=MERGE_PERKS[perk];
    if(!spec) return false;
    if(Math.random()>=spec.chance*((opts && opts.chanceMult)||1)) return false;
    let applied=false;
    try{
      if(perk==='vampire'){
        const p=(typeof window!=='undefined' && window.player)||null;
        if(p && Number.isFinite(p.hp) && Number.isFinite(p.maxHp) && p.hp>0){
          p.hp=Math.min(p.maxHp,p.hp+Math.max(1,Math.round((dmg||1)*0.12)));
          applied=true;
        }
      } else if(perk==='fury'){
        if(MM.mobs && MM.mobs.damageAt) applied=!!MM.mobs.damageAt(tx,ty,Math.max(1,Math.round((dmg||1)*0.5)),{source:'hero',kind:'merge_fury'});
      } else if(spec.status && MM.mobs && MM.mobs.statusAt){
        applied=!!MM.mobs.statusAt(tx,ty,spec.status,{dur:spec.dur,dps:spec.dps,source:'hero',cause:'merge_'+perk});
      }
    }catch(e){}
    if(!applied) return false;
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note(spec.note[0],spec.note[1]); }catch(e){}
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnImpactChips) p.spawnImpactChips((tx+0.5)*tile,(ty+0.2)*tile,{power:0.9});
    }catch(e){}
    return true;
  }
  function rollMergePerk(w,tx,ty,dmg,opts){
    if(!w || !w.mergePerk) return false;
    return applyMergePerkAt(w.mergePerk,tx,ty,dmg,opts);
  }
  function splatToxicSnowball(a){
    try{
      if(MM.mobs){
        if(MM.mobs.poisonRadius) MM.mobs.poisonRadius(a.x,a.y,SNOWBALL_SPLAT.radius,projectileEffectOpts(a,{dur:SNOWBALL_SPLAT.poisonDur,dps:SNOWBALL_SPLAT.poisonDps,source:'hero',cause:'toxic_snowball'}));
        if(MM.mobs.chillRadius) MM.mobs.chillRadius(a.x,a.y,SNOWBALL_SPLAT.radius,projectileEffectOpts(a,{dur:SNOWBALL_SPLAT.chillDur,source:'hero',cause:'toxic_snowball'}));
      }
    }catch(e){}
    try{ if(MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(a.x,a.y,SNOWBALL_SPLAT.radius,'chill',{dur:SNOWBALL_SPLAT.chillDur,source:'hero',cause:'toxic_snowball'}); }catch(e){}
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnImpactChips){
        p.spawnImpactChips(a.x*tile,a.y*tile,{power:0.9,element:'poison_splat'});
        p.spawnImpactChips(a.x*tile,a.y*tile,{power:0.6,element:'chill_splat'});
      }
    }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('splash',{x:a.x,y:a.y}); }catch(e){}
  }
  // Impact router for every splatting projectile (never sticks like an arrow).
  function splatProjectile(a,getTile,setTile){
    // A network-owned shaft is allowed only the deliberately harmless wet
    // creature status.  This is a defense-in-depth boundary for forged/stale
    // projectile flags that bypassed the spawn-time whitelist.
    if(a.coopOwner && a.splat!=='wet') return;
    if(a.splat==='toxic') return splatToxicSnowball(a);
    const tile=MM.TILE||20;
    if(a.splat==='snow'){
      // plain snowball: a face full of snow — brief slow, no lasting damage cloud
      try{ if(MM.mobs && MM.mobs.chillRadius) MM.mobs.chillRadius(a.x,a.y,1.1,projectileEffectOpts(a,{dur:1.4,source:'hero',cause:'snowball_chill'})); }catch(e){}
      try{ if(MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(a.x,a.y,1.1,'chill',{dur:1.4,source:'hero',cause:'snowball_chill'}); }catch(e){}
      try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:0.7,element:'chill_splat'}); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('splash',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
    if(a.splat==='frost'){
      // A frost flask: a wide, lasting chill cloud — the reliable setup half of
      // the wet+chill -> frozen-solid reaction. Creature-only, so guest-safe (and
      // the coop guard above already blocks a network-owned frost splat).
      try{ if(MM.mobs && MM.mobs.chillRadius) MM.mobs.chillRadius(a.x,a.y,1.8,projectileEffectOpts(a,{dur:3.2,source:'hero',cause:'frost_flask'})); }catch(e){}
      try{ if(MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(a.x,a.y,1.8,'chill',{dur:3.2,source:'hero',cause:'frost_flask'}); }catch(e){}
      try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:0.9,element:'chill_splat'}); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('splash',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
    if(a.splat==='rock'){
      // A stone clattering off the rock is a DECOY (engine/noise.js): creatures
      // that hear it walk over to look, which is the whole point of throwing one
      // across a cavern. This is what promotes thrown stones from joke to tool.
      try{ if(MM.noise && MM.noise.emit) MM.noise.emit(a.x,a.y,'decoy',1); }catch(e){}
      // survival roll: a hard rock often lands whole and can be picked back up;
      // the cheap stone shatters most of the time (per-tier chance)
      const survive=Number.isFinite(a.stoneSurvive)?a.stoneSurvive:0.45;
      if(a.stoneKey && Math.random()<survive){
        try{
          const D=MM.drops;
          if(D && D.spawnResource) D.spawnResource(a.x,a.y-0.2,a.stoneKey,1,{source:'thrown_rock',vy:-1.2});
        }catch(e){}
      }
      try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:1.1}); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('dig',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
    if(a.splat==='sand'){
      // A fistful of sand is pure crowd control: it never deals direct damage.
      // Blind drops the aggro gate, while the shorter stun sells the initial
      // shock of getting fine grains in the face.
      try{
        let affected=0;
        if(MM.mobs && MM.mobs.statusRadius){
          affected+=MM.mobs.statusRadius(a.x,a.y,1.05,'blind',projectileEffectOpts(a,{dur:SAND_BLIND_DUR,source:'hero',cause:'sand_blind'}))||0;
          affected+=MM.mobs.statusRadius(a.x,a.y,1.05,'stun',projectileEffectOpts(a,{dur:SAND_SHOCK_DUR,source:'hero',cause:'sand_shock'}))||0;
        }
        if(affected>0){
          try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('sand_blind','Piasek w oczy: wróg jest oślepiony i oszołomiony!'); }catch(e2){}
        }
      }catch(e){}
      try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:0.65,element:'sand_spray',fine:true}); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('dig',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
    if(a.splat==='spit'){
      // Normal saliva is just a small wet splat. The thrown-weapon ult marks its
      // droplets toxic, matching their vivid green projectile treatment.
      try{ if(MM.mobs && MM.mobs.wetRadius) MM.mobs.wetRadius(a.x,a.y,0.9,projectileEffectOpts(a,{dur:3,source:'hero',cause:'spit'})); }catch(e){}
      if(a.toxicSpit){
        try{
          if(MM.mobs && MM.mobs.poisonRadius
             && MM.mobs.poisonRadius(a.x,a.y,1.1,projectileEffectOpts(a,{dur:5,dps:1.5,source:'hero',cause:'toxic_spit_ult'}))>0){
            try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('spit_toxic','Toksyczna zielona ślina zatruwa trafione cele!'); }catch(e2){}
          }
        }catch(e){}
        try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:0.7,element:'toxic_spit'}); }catch(e){}
      }
      try{ if(MM.particles && MM.particles.spawnSplash) MM.particles.spawnSplash(a.x*tile,a.y*tile,0.4); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('splash',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
    if(a.splat==='wet'){
      // Water balloons always retain creature-facing soak/douse effects. A
      // co-op projectile stops there: tile fire and crops are host-world state.
      const wetSource=a.coopOwner?'coop':'hero';
      try{
        if(MM.mobs){
          if(MM.mobs.wetRadius) MM.mobs.wetRadius(a.x,a.y,1.8,projectileEffectOpts(a,{dur:8,source:wetSource,cause:'water_balloon'}));
          if(MM.mobs.douseRadius) MM.mobs.douseRadius(a.x,a.y,1.8);
        }
      }catch(e){}
      if(!a.coopOwner){ try{ if(MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(a.x,a.y,1.8,'wet',{dur:8,source:wetSource,cause:'water_balloon'}); }catch(e){} }
      if(!a.coopOwner){
        try{
          if(FIRE && FIRE.isBurning && FIRE.extinguish){
            const bx=Math.floor(a.x), by=Math.floor(a.y);
            for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ if(FIRE.isBurning(bx+dx,by+dy)) FIRE.extinguish(bx+dx,by+dy); }
          }
        }catch(e){}
        try{ if(MM.plants && MM.plants.waterAt) MM.plants.waterAt(a.x,a.y,1.6,2.2); }catch(e){}
      }
      try{ if(MM.particles && MM.particles.spawnSplash) MM.particles.spawnSplash(a.x*tile,a.y*tile,0.7); }catch(e){}
      try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:0.8,element:'water_splat'}); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('splash',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
    if(a.splat==='gascloud'){
      // gas grenade: releases a poison cloud where it lands (fire detonates it). A
      // coop arrow can never reach this (its splat whitelist is 'wet' only), but the
      // gate is explicit: a guest projectile spawns no world hazard.
      if(a.coopOwner) return;
      spawnGasCloud(a.x,a.y,1.6,{source:'hero'});
      try{ if(MM.audio && MM.audio.play) MM.audio.play('gas',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
    if(a.splat==='bomb'){
      if(a.coopOwner) return; // a guest projectile never detonates terrain
      const gt=(typeof getTile==='function') ? getTile : lastGetTile;
      const st=(typeof setTile==='function') ? setTile : lastSetTile;
      if(gt && st) explodeAt(a.x,a.y,gt,st,{force:true,radius:1.6});
      return;
    }
    if(a.splat==='mine'){
      if(a.coopOwner) return;
      deployMine(a,getTile,setTile);
      return;
    }
    if(a.splat==='fire'){
      // Molotov: burns creatures in the splash AND sets flammable terrain alight.
      // World-writing (tile ignite) — never for a guest projectile.
      if(a.coopOwner) return;
      try{ if(MM.mobs && MM.mobs.statusRadius) MM.mobs.statusRadius(a.x,a.y,1.6,'burn',projectileEffectOpts(a,{dur:4,dps:2,source:'hero',cause:'molotov'})); }catch(e){}
      try{ if(MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(a.x,a.y,1.6,'burn',{dur:4,dps:2,source:'hero',cause:'molotov'}); }catch(e){}
      try{
        const gt=(typeof getTile==='function') ? getTile : lastGetTile;
        if(FIRE && FIRE.ignite && gt){ const bx=Math.floor(a.x), by=Math.floor(a.y); for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) FIRE.ignite(bx+dx,by+dy,gt); }
      }catch(e){}
      try{ if(MM.particles && MM.particles.spawnImpactChips) MM.particles.spawnImpactChips(a.x*tile,a.y*tile,{power:1.0,element:'fire'}); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('gas',{x:a.x,y:a.y}); }catch(e){}
      return;
    }
  }
  function thrownSpec(w){ return (w && THROWN_KINDS[w.thrownKind]) || null; }
  // Throwing-rock material ladder (mirrors the arrow-tier idea): every stone
  // type knaps into throwing rocks. Harder rock = harder hit AND a better
  // chance the rock survives the impact as a ground pickup (drops plane).
  const STONE_TIERS=[
    {id:'stone',    key:'throwingStone',         label:'Kamień',   color:'#9aa0a8', head:'#c9ced6', dmg:6,  survive:0.45},
    {id:'granite',  key:'throwingStoneGranite',  label:'Granit',   color:'#8d8f97', head:'#c3c6ce', dmg:8,  survive:0.58},
    {id:'basalt',   key:'throwingStoneBasalt',   label:'Bazalt',   color:'#40444d', head:'#6a707c', dmg:10, survive:0.70},
    {id:'obsidian', key:'throwingStoneObsidian', label:'Obsydian', color:'#7a5cc1', head:'#a98df0', dmg:13, survive:0.82},
    {id:'diamond',  key:'throwingStoneDiamond',  label:'Diament',  color:'#48f1ff', head:'#c9fbff', dmg:17, survive:0.93},
    {id:'meteorite',key:'throwingStoneMeteorite',label:'Meteoryt', color:'#b0763f', head:'#e8c39a', dmg:22, survive:0.96}
  ];
  function bestStoneTier(){
    for(let i=STONE_TIERS.length-1;i>=0;i--){ if(resourceCount(STONE_TIERS[i].key)>0) return STONE_TIERS[i]; }
    return null;
  }
  function stoneInfo(){
    const active=bestStoneTier();
    return {
      tiers:STONE_TIERS.map(t=>({id:t.id,key:t.key,label:t.label,color:t.color,dmg:t.dmg,
        surviveChance:t.survive,count:resourceCount(t.key),active:!!active&&active.id===t.id})),
      active:active?{id:active.id,key:active.key,label:active.label,color:active.color,count:resourceCount(active.key)}:null
    };
  }
  // HUD readout for the ranged slot when a throw technique is selected.
  function thrownInfo(kind){
    const s=THROWN_KINDS[kind];
    if(!s) return null;
    if(s.rock){
      const t=bestStoneTier();
      if(t) return {kind, key:t.key, label:s.label+' ('+t.label+')', count:resourceCount(t.key), color:t.color, tierId:t.id};
      return {kind, key:s.key, label:s.label, count:0, color:s.color};
    }
    return {kind, key:s.key, label:s.label, count:resourceCount(s.key), color:s.color};
  }
  function pushThrownProjectile(player,dx,dy,spec,w,opts){
    opts=opts||{};
    const sp=spec.speed*(opts.speedMult||1);
    const toxicSpit=spec.visual==='spit' && !!opts.specialAttack;
    const sandSeed=spec.visual==='sand' ? (((Math.random()*0xffffffff)>>>0)||1) : 0;
    const stoneTier=opts.stoneTier||null; // rock material overrides damage/color/survival
    const baseDmg=stoneTier ? stoneTier.dmg : ((w && w.attackDamage)||2);
    return pushArrow({
      x:player.x + dx*0.6,
      y:player.y - 0.2 + dy*0.6,
      vx:dx*sp,
      vy:dy*sp + spec.lob,
      dmg:spec.noDamage ? 0 : Math.max(1,Math.round(baseDmg*(opts.dmgMult||1))),
      stoneKey:stoneTier?stoneTier.key:undefined, stoneSurvive:stoneTier?stoneTier.survive:undefined,
      life:spec.life, stuck:false, stuckT:ARROW_STUCK,
      thrown:true, snowball:!!spec.ball, rock:!!spec.rock, splat:spec.splat,
      deployMine:!!spec.mineType, mineType:spec.mineType||undefined,
      sandSpray:spec.visual==='sand', sandSeed, spitDroplet:spec.visual==='spit', toxicSpit,
      noDamage:!!spec.noDamage,
      stickyFuse:spec.sticky ? (spec.fuse||1.5) : 0,
      power:!!opts.specialAttack, specialAttack:!!opts.specialAttack, luckyStrike:!!opts.luckyStrike,
      tier:'thrown', color:toxicSpit?TOXIC_SPIT_COLOR:(stoneTier?stoneTier.color:spec.color), headColor:toxicSpit?TOXIC_SPIT_HEAD:(stoneTier?stoneTier.head:spec.head), windCap:sp*1.3,
      weaponPrestige:weaponPrestigeRank(w), weaponGlow:weaponPrestigeColor(w), weaponMaterial:weaponMaterialProfile(w).id, mergePerk:(w&&w.mergePerk)||undefined
    });
  }
  // `a.snowball` predates hand-thrown weapons and now means "round/ball"
  // internally (water balloons, gas grenades and sticky bombs all set it).
  // Elemental consumers must classify from the splat identity, otherwise every
  // round projectile becomes an ice weakness exploit.
  function projectileImpactOpts(a){
    a=a||{};
    const trueSnow=!!a.snowball && (a.splat==='snow' || a.splat==='toxic');
    const thrown=!!a.thrown || trueSnow;
    const water=a.splat==='wet';
    const spit=a.splat==='spit';
    let cause;
    if(trueSnow) cause=a.splat==='toxic'?'toxic_snowball':'snowball';
    else if(water) cause='water_balloon';
    else if(spit) cause='spit';
    else if(a.splat==='gascloud') cause='gas_grenade';
    else if(a.splat==='bomb') cause='sticky_bomb';
    else if(a.splat==='mine') cause=a.mineType==='fragmentation'?'fragmentation_mine':'antipersonnel_mine';
    return Object.assign({
      source:a.coopOwner?'coop':'hero',
      // 'bouncy' carries no elemental keyword by design (combatElementFromOpts
      // classifies from these strings) — a rubber ball is pure kinetic damage.
      kind:trueSnow?'snowball':(a.harpoon?'harpoon':(a.bouncy?'bouncy':(thrown?'thrown':'arrow'))),
      weaponType:a.bouncy?'bouncy':(thrown?'thrown':(a.harpoon?'harpoon':'bow')),
      element:trueSnow?'ice':((water||spit)?'water':(a.fire?'fire':undefined)),
      snowball:trueSnow,
      spit,
      cause,
      x:a.x,y:a.y,vx:a.vx,vy:a.vy,tier:a.tier,pierceLeft:a.pierceLeft||0,
      // A hurled world block carries its material identity through to the target:
      // the block boss is BUILT of blocks, so it eats this one instead of taking
      // the hit, and it needs to know which tile it just swallowed. Plain fields,
      // never a cause string — combatElementFromOpts classifies causes by substring.
      grav:!!a.grav, gravTid:a.gravTid|0,
      fire:!!a.fire,specialAttack:!!a.specialAttack,luckyStrike:!!a.luckyStrike
    },projectilePortalAttribution(a));
  }
  function fireThrown(player, aimX, aimY, w){
    if(throwCd>0) return false;
    const spec=thrownSpec(w);
    if(!spec) return false;
    // rocks spend the best owned material tier; other throws spend their own key
    const stoneTier=spec.rock ? bestStoneTier() : null;
    const spendKey=stoneTier ? stoneTier.key : spec.key;
    if(!spendResource(spendKey,1)){ sayLimited('thrown_empty_'+spec.key,'Brak: '+spec.label); return false; }
    throwCd=Math.max(0.2,(w && w.fireCooldown)||0.45);
    const v=aimVector(player,aimX,aimY);
    pushThrownProjectile(player,v.dx,v.dy,spec,w,{stoneTier});
    player.facing=v.dx>=0?1:-1;
    triggerHeldActionFx('thrown',0.9,190,false);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  // Ult: a fanned volley — up to 3 projectiles (5 on a nearly full charge).
  function firePowerThrown(player, aimX, aimY, w, charge){
    const spec=thrownSpec(w);
    if(!spec) return false;
    const roll=specialAttackRoll();
    const v=aimVector(player,aimX,aimY);
    const count=charge>0.85 ? 5 : 3;
    let thrown=0;
    for(let i=0;i<count;i++){
      const stoneTier=spec.rock ? bestStoneTier() : null; // re-resolve: a volley may drain a tier mid-burst
      if(!spendResource(stoneTier?stoneTier.key:spec.key,1)) break;
      const ang=(i-(count-1)/2)*0.09;
      const ca=Math.cos(ang), sa=Math.sin(ang);
      pushThrownProjectile(player, v.dx*ca-v.dy*sa, v.dx*sa+v.dy*ca, spec, w,
        {speedMult:1.05+charge*0.22, dmgMult:roll.mult, specialAttack:true, luckyStrike:roll.lucky && i===0, stoneTier});
      thrown++;
    }
    if(!thrown){ sayLimited('thrown_empty_'+spec.key,'Brak: '+spec.label); return false; }
    if(roll.lucky) noteLuckyStrike(player.x+v.dx*1.3,player.y-0.45+v.dy*1.3);
    player.facing=v.dx>=0?1:-1;
    triggerHeldActionFx('thrown',1.45,280,false);
    throwCd=Math.max(throwCd,0.3);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function shatterGlassAt(tx,ty,setTile,getTile,opts){
    if(typeof setTile!=='function') return false;
    if(getTile && getTile(tx,ty)!==T.GLASS) return false;
    opts=opts||{};
    const k=tileKey(tx,ty);
    if(opts.respectHeatForged && heatForgedGlass.has(k)) return false;
    setTile(tx,ty,T.AIR);
    heatForgedGlass.delete(k);
    try{
      const p=MM.particles;
      const tile=MM.TILE||20;
      if(p && p.spawnGlassShards) p.spawnGlassShards((tx+0.5)*tile,(ty+0.5)*tile,16);
      else if(p && p.spawnSparks) p.spawnSparks((tx+0.5)*tile,(ty+0.5)*tile,'rare',12);
      else if(p && p.spawnBurst) p.spawnBurst((tx+0.5)*tile,(ty+0.5)*tile,'rare');
    }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
    return true;
  }
  function arrowPierceableTile(t){
    return isIridiumArrowPierceableTile(t);
  }
  function triggerAntimatterBreak(tx,ty){
    try{
      if(MM.meteorites && typeof MM.meteorites.triggerAntimatterBurst==='function'){
        return MM.meteorites.triggerAntimatterBurst(tx+0.5,ty+0.5,1.15);
      }
    }catch(e){}
    return false;
  }
  function finishIridiumPierce(a,tx,ty){
    if(!a || a.tier!=='iridium' || !(a.pierceLeft>0)) return false;
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnSparks) p.spawnSparks((tx+0.5)*tile,(ty+0.5)*tile,'rare',8);
    }catch(e){}
    a.pierceLeft--;
    a.dmg=Math.max(1,Math.round((a.dmg||1)*0.78));
    a.vx*=0.92;
    a.vy*=0.92;
    iridiumPierces++;
    return true;
  }
  function tryIridiumPierceBlock(a,tx,ty,t,getTile,setTile){
    if(!a || a.coopOwner || a.tier!=='iridium' || !(a.pierceLeft>0) || typeof setTile!=='function') return false;
    if(t===T.ANTIMATTER_CRYSTAL){
      setTile(tx,ty,T.AIR);
      triggerAntimatterBreak(tx,ty);
    } else {
      if(!arrowPierceableTile(t)) return false;
      awardUfoConcreteShard(tx,ty,t);
      setTile(tx,ty,T.AIR);
    }
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
    markWorldChanged();
    return finishIridiumPierce(a,tx,ty);
  }
  function arrowRangeBand(a){
    const max=Number.isFinite(a && a.maxTravel) && a.maxTravel>0 ? a.maxTravel : 1;
    const frac=Math.max(0,Math.min(1,(Number(a && a.travel)||0)/max));
    if(frac<=1/3) return 'close';
    if(frac<=2/3) return 'mid';
    return 'long';
  }
  function arrowDamageAtRange(a){
    const base=Math.max(0.5,Number(a && a.dmg)||1);
    // A ricochet is SUPPOSED to travel far, so distance is not what dulls a rubber
    // ball — bounces are (bounceBallOff* already scale a.dmg). Stacking the arrow
    // range band on top would make every bounced hit the 1-damage floor at once
    // and erase the falloff curve the weapon is built around.
    if(a && a.bouncy) return Math.max(1,Math.round(base));
    // A thrown BLOCK is mass, not a shaft losing spin: its damage is its
    // momentum, and the steep arc already prices distance. Optional flavour:
    // a block arriving FASTER than it left (dropped from a ledge) hits harder.
    if(a && a.grav){
      const GG=gravityModule();
      const v0=GG?GG.muzzleSpeed(a.gravTid):14;
      const boost=Math.min(1.25,Math.max(1,Math.hypot(a.vx||0,a.vy||0)/Math.max(1,v0)));
      return Math.max(1,Math.round(base*boost));
    }
    const mult=ARROW_DAMAGE_FALLOFF[arrowRangeBand(a)] || ARROW_DAMAGE_FALLOFF.long;
    return Math.max(1,Math.round(base*mult));
  }
  function bounceArrowFromUnderground(a,tx,ty){
    if(!a) return false;
    const vx=Number(a.vx)||0, vy=Number(a.vy)||0;
    const speed=Math.max(3,Math.hypot(vx,vy)||1);
    const nx=-(vx/speed || 1), ny=-(vy/speed || -0.15);
    a.x += nx*0.78;
    a.y += ny*0.78;
    a.vx = nx*speed*0.58 + (Math.random()-0.5)*1.4;
    a.vy = ny*speed*0.36 - 1.05 + (Math.random()-0.5)*0.45;
    a.life=Math.min(a.life||0.6,0.85);
    a.ignoreUndergroundT=0.18;
    a.dmg=Math.max(1,Math.round((Number(a.dmg)||1)*0.42));
    a.pierceLeft=0;
    a.bounced=true;
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnSparks) p.spawnSparks((tx+0.5)*tile,(ty+0.5)*tile,'common',7);
    }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('spark',{x:tx+0.5,y:ty+0.5}); }catch(e){}
    return true;
  }
  // --- rubber-ball ricochet ----------------------------------------------------
  // A tile grid gives no surface normal, so the normal is RECONSTRUCTED from which
  // axis actually crossed into the blocking cell: sample the two cells the ball
  // could have entered through (same row / same column as where it started this
  // substep). Flipping only the blocked axis is what makes a floor bounce read as
  // a bounce instead of a straight rebound back at the shooter.
  function bouncyImpactFx(a,tx,ty,strength){
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnSparks) p.spawnSparks((tx+0.5)*tile,(ty+0.5)*tile,'common',Math.max(2,Math.round(3*strength)));
    }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('step',{x:a.x,y:a.y}); }catch(e){}
  }
  // A tar ball takes light. Only ever called for a `flammable` ball, and never on
  // a coop projectile — a guest shot must stay inert to the host's world, and
  // `fire` is what unlocks every world-touching branch below.
  function igniteBouncyBall(a){
    if(!a || !a.flammable || a.fire || a.coopOwner) return false;
    a.fire=true;
    a.bounces=Math.min(Number(a.bounces)||0, BOUNCY_BURN_BOUNCES);
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnSparks) p.spawnSparks(a.x*tile,a.y*tile,'rare',5);
    }catch(e){}
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('rubber_napalm','Smołowa kulka łapie ogień i roznosi go rykoszetem!'); }catch(e){}
    return true;
  }
  // Where a LIT ball touches, flammable terrain catches. fire.ignite() is the one
  // chokepoint and it already refuses non-flammable, wet or already-burning tiles,
  // so stone walls stay stone and the arson stays bounded by the fire system.
  function spreadBouncyFire(a,tx,ty,getTile,setTile){
    if(!a || !a.fire || a.coopOwner || !FIRE) return false;
    try{ return !!FIRE.ignite(tx,ty,getTile,setTile); }catch(e){ return false; }
  }
  // End of the chain: half the rubber survives as a real ground pickup, the rest
  // is spent. Never a coop ball — a guest projectile mints no host resources.
  // A ball that BURNED never comes back: the rubber went up with it.
  function retireBouncyBall(a){
    if(!a) return false;
    let dropped=false;
    if(!a.coopOwner && !a.fire && Math.random()<BOUNCY_RECOVER_CHANCE){
      try{
        if(MM.drops && typeof MM.drops.spawnResource==='function'){
          dropped=!!MM.drops.spawnResource(a.x,a.y-0.15,BOUNCY_AMMO_KEY,1,{vx:(a.vx||0)*0.15,vy:-0.9});
        }
      }catch(e){ dropped=false; }
    }
    if(!dropped){
      try{
        const p=MM.particles, tile=MM.TILE||20;
        if(p && p.spawnSparks) p.spawnSparks(a.x*tile,a.y*tile,a.fire?'rare':'common',3);
      }catch(e){}
    }
    // a ball that burns out leaves its last flame where it fell
    if(a.fire) spreadBouncyFire(a,Math.floor(a.x),Math.floor(a.y),lastGetTile,lastSetTile);
    return dropped;
  }
  function bounceBallOffTile(a,tx,ty,dx,dy,getTile){
    if(!a || !(a.bounces>0)) return false;
    const px=a.x-dx, py=a.y-dy;
    const prevTx=Math.floor(px), prevTy=Math.floor(py);
    // The cell we came FROM must be free, or there is no valid place to rebound
    // to (a ball buried by a world edit, or spawned inside geometry): retire it
    // instead of nudging it around inside solid rock forever.
    let trapped=false;
    try{ trapped=isSolid(getTile(prevTx,prevTy)); }catch(e){ trapped=true; }
    if(trapped) return false;
    const solidAt=(x,y)=>{ try{ return isSolid(getTile(x,y)); }catch(e){ return false; } };
    let flipX = prevTx!==tx && solidAt(tx,prevTy);
    let flipY = prevTy!==ty && solidAt(prevTx,ty);
    if(!flipX && !flipY){ flipX=true; flipY=true; } // clipped a corner exactly
    a.x=px; a.y=py;
    if(flipX) a.vx=-(a.vx||0);
    if(flipY) a.vy=-(a.vy||0);
    a.vx*=BOUNCY_WALL_RESTITUTION;
    a.vy*=BOUNCY_WALL_RESTITUTION;
    a.bounces--;
    a.bounced=true;
    a.dmg=Math.max(0.35,(Number(a.dmg)||1)*BOUNCY_WALL_DAMAGE_KEEP);
    a.pierceGate=0; // a wall does not shield the next creature
    bouncyImpactFx(a,tx,ty,1);
    return Math.hypot(a.vx,a.vy)>=BOUNCY_MIN_SPEED;
  }
  // Bouncing off a BODY: the target absorbs most of the punch, so the ball kicks
  // back along its own path (with a little lift and scatter, like a real ball off
  // a moving mass) and must clear the body before it can register another hit.
  function bounceBallOffBody(a){
    if(!a || !(a.bounces>0)) return false;
    const vx=Number(a.vx)||0, vy=Number(a.vy)||0;
    const speed=Math.hypot(vx,vy)||1;
    // Scatter kept SMALL on purpose. A body is round, so some deflection is
    // honest — but at ±16° the rebound missed a target six tiles away more often
    // than it hit, which turns a planned ricochet into a dice roll. ±9° plus a
    // gentle lift keeps the chain readable while still looking like a bounce.
    const scatter=(Math.random()-0.5)*0.30;
    const ang=Math.atan2(-vy,-vx)+scatter;
    const out=speed*BOUNCY_BODY_RESTITUTION;
    a.vx=Math.cos(ang)*out;
    a.vy=Math.sin(ang)*out - 1.1; // balls kick UP off a body
    a.bounces--;
    a.bounced=true;
    a.dmg=Math.max(0.35,(Number(a.dmg)||1)*BOUNCY_HIT_DAMAGE_KEEP);
    a.pierceGate=(Number(a.travel)||0)+0.9;
    return Math.hypot(a.vx,a.vy)>=BOUNCY_MIN_SPEED;
  }
  function tileKey(x,y){ return x+','+y; }
  function noteStoneHeat(tx,ty,touched){
    touched.add(tileKey(tx,ty));
  }
  function noteSandHeat(tx,ty,touched){
    touched.add(tileKey(tx,ty));
  }
  function noteWaterHeat(tx,ty,touched){
    touched.add(tileKey(tx,ty));
    // Flame particles jitter across a water surface; conduct a little heat through
    // the immediate pool so sustained spray boils water mass, not one lucky pixel.
    touched.add(tileKey(tx-1,ty));
    touched.add(tileKey(tx+1,ty));
    touched.add(tileKey(tx,ty-1));
    touched.add(tileKey(tx,ty+1));
  }
  function waterHeatRatioAt(tx,ty){
    const h=waterHeat.get(tileKey(tx,ty));
    return h ? Math.max(0,Math.min(1,(h.heat||0)/WATER_BOIL_SECONDS)) : 0;
  }
  function updateWaterHeat(touched,getTile,setTile,dt){
    if(!touched.size && !waterHeat.size) return;
    for(const k of touched){
      const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      if(getTile(x,y)!==T.WATER) continue;
      const h=waterHeat.get(k) || {x,y,heat:0,gap:0};
      h.heat+=dt;
      h.gap=0;
      if(h.heat>=WATER_BOIL_SECONDS && typeof setTile==='function'){
        setTile(x,y,T.AIR);
        waterHeat.delete(k);
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
        try{ if(MM.clouds && MM.clouds.injectVapor) MM.clouds.injectVapor(x,1); }catch(e){}
        emitSteam(x+0.5,y+0.25,3,getTile,setTile);
        try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('water_boil','Płomień gotuje wodę w parę!'); }catch(e){}
      } else {
        waterHeat.set(k,h);
      }
    }
    for(const [k,h] of waterHeat){
      if(touched.has(k)) continue;
      if(getTile(h.x,h.y)!==T.WATER){ waterHeat.delete(k); continue; }
      h.gap=(h.gap||0)+dt;
      if(h.gap>WATER_HEAT_GRACE) waterHeat.delete(k);
      else waterHeat.set(k,h);
    }
  }
  function waterHeatMaxRatio(){
    let best=0;
    for(const h of waterHeat.values()){
      const r=Math.max(0,Math.min(1,(h.heat||0)/WATER_BOIL_SECONDS));
      if(r>best) best=r;
    }
    return best;
  }
  function updateStoneHeat(touched,getTile,setTile,dt){
    if(!touched.size && !stoneHeat.size) return;
    for(const k of touched){
      const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      if(getTile(x,y)!==T.STONE) continue;
      const h=stoneHeat.get(k) || {x,y,heat:0,gap:0};
      h.heat+=dt;
      h.gap=0;
      if(h.heat>=STONE_MELT_SECONDS && typeof setTile==='function'){
        setTile(x,y,T.LAVA);
        stoneHeat.delete(k);
        if(FIRE && FIRE.noteLava) FIRE.noteLava(x,y);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
        try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('stone_melt','Długi płomień topi kamień w lawę!'); }catch(e){}
      } else {
        stoneHeat.set(k,h);
      }
    }
    for(const [k,h] of stoneHeat){
      if(touched.has(k)) continue;
      if(getTile(h.x,h.y)!==T.STONE){ stoneHeat.delete(k); continue; }
      h.gap=(h.gap||0)+dt;
      if(h.gap>STONE_HEAT_GRACE) stoneHeat.delete(k);
      else stoneHeat.set(k,h);
    }
  }
  function stoneHeatMaxRatio(){
    let best=0;
    for(const h of stoneHeat.values()){
      const r=Math.max(0,Math.min(1,(h.heat||0)/STONE_MELT_SECONDS));
      if(r>best) best=r;
    }
    return best;
  }
  function updateSandHeat(touched,getTile,setTile,dt){
    if(!touched.size && !sandHeat.size) return;
    for(const k of touched){
      const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      if(getTile(x,y)!==T.SAND) continue;
      const h=sandHeat.get(k) || {x,y,heat:0,gap:0};
      h.heat+=dt*SAND_HEAT_CONTACT_SCALE;
      h.gap=0;
      if(h.heat>=SAND_GLASS_SECONDS && typeof setTile==='function'){
        setTile(x,y,T.GLASS);
        heatForgedGlass.set(k,{x,y,cool:HEAT_FORGED_GLASS_GRACE});
        sandHeat.delete(k);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
        try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('sand_glass','Rozgrzany piasek wytapia się w szkło!'); }catch(e){}
      } else {
        sandHeat.set(k,h);
      }
    }
    for(const [k,h] of sandHeat){
      if(touched.has(k)) continue;
      if(getTile(h.x,h.y)!==T.SAND){ sandHeat.delete(k); continue; }
      h.gap=(h.gap||0)+dt;
      if(h.gap>STONE_HEAT_GRACE) sandHeat.delete(k);
      else sandHeat.set(k,h);
    }
  }
  function sandHeatMaxRatio(){
    let best=0;
    for(const h of sandHeat.values()){
      const r=Math.max(0,Math.min(1,(h.heat||0)/SAND_GLASS_SECONDS));
      if(r>best) best=r;
    }
    return best;
  }
  function flameHeatRayPasses(t){
    return isHeatRayPassableTile(t);
  }
  function applyFlameHeatRays(touchedSand,getTile){
    if(!flameHeatRays.length) return;
    for(const ray of flameHeatRays){
      const step=0.25;
      for(let d=0.7; d<=ray.range; d+=step){
        const tx=Math.floor(ray.x+ray.dx*d);
        const ty=Math.floor(ray.y+ray.dy*d);
        const t=getTile(tx,ty);
        if(flameHeatRayPasses(t)) continue;
        if(t===T.SAND) noteSandHeat(tx,ty,touchedSand);
        else if(t===T.GLASS){
          const k=tileKey(tx,ty);
          const h=heatForgedGlass.get(k);
          if(h) h.cool=HEAT_FORGED_GLASS_GRACE;
        }
        break;
      }
    }
    flameHeatRays.length=0;
  }
  function updateHeatForgedGlass(getTile,dt){
    if(!heatForgedGlass.size) return;
    for(const [k,h] of heatForgedGlass){
      if(getTile(h.x,h.y)!==T.GLASS){ heatForgedGlass.delete(k); continue; }
      h.cool-=dt;
      if(h.cool<=0) heatForgedGlass.delete(k);
    }
  }

  function spawnGasCloud(x,y,intensity,opts){
    opts=opts||{};
    const power=Math.max(0.25, Math.min(4, intensity||1));
    const persistent=addWorldGas('poison',x,y,{power,cells:Math.min(10,Math.round(2+power*2.4))});
    const n=Math.min(MAX_PUFFS-puffs.length, Math.round(8+power*9));
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2;
      const sp=(0.7+Math.random()*2.2)*(0.7+power*0.18);
      puffs.push({
        kind:'gas',
        x:x+(Math.random()-0.5)*0.9,
        y:y+(Math.random()-0.5)*0.45,
        vx:Math.cos(a)*sp*0.7,
        vy:-Math.abs(Math.sin(a))*sp - 0.3 - power*0.12,
        life:(2.8+Math.random()*1.6)*(0.85+power*0.15),
        total:3.8,
        dps:4+power*1.2,
        scale:1+power*0.12,
        source:opts.source || undefined
      });
    }
    return n+persistent;
  }
  function flameTouchesHero(p,pl){
    if(!p || !pl || typeof pl.x!=='number' || typeof pl.y!=='number') return false;
    const hw=Math.max(0.25,(pl.w||0.7)*0.5);
    const hh=Math.max(0.35,(pl.h||0.95)*0.5);
    const left=pl.x-hw, right=pl.x+hw, top=pl.y-hh, bottom=pl.y+hh;
    const cx=Math.max(left,Math.min(right,p.x));
    const cy=Math.max(top,Math.min(bottom,p.y));
    const dx=p.x-cx, dy=p.y-cy;
    const r=0.34+0.12*(p.scale||1);
    return dx*dx+dy*dy<=r*r;
  }
  function hurtHeroWithFlame(p){
    if(heroFlameHitCd>0) return false;
    if((p.age||0)<SELF_FLAME_ARM_SEC) return false;
    const pl=(typeof window!=='undefined' && window.player)||null;
    if(!flameTouchesHero(p,pl)) return false;
    if(typeof window.damageHero!=='function') return false;
    const dmg=Math.max(2,Math.round((p.dps||6)*0.38));
    const ok=window.damageHero(dmg,{
      srcX:p.x, srcY:p.y,
      kb:1.8, kbY:-1.2,
      invulMs:260,
      cause:p.cause || 'flamethrower'
    });
    if(ok) heroFlameHitCd=0.22;
    return !!ok;
  }

  // ---- Simulation ----
  function teleportPhysicalShot(entity,getTile,opts,stream){
    if(!entity || entity.ghost) return false;
    const portals=opts && opts.teleporters;
    if(!portals || typeof portals.tryTeleportProjectile!=='function') return false;
    const portalGet=(opts && typeof opts.getElectricNetworkTile==='function') ? opts.getElectricNetworkTile : getTile;
    const portalOpts={
      stream:!!stream,
      dynamo:opts && opts.dynamo,
      player:opts && opts.player
    };
    if(opts && Object.prototype.hasOwnProperty.call(opts,'heroEnergy')) portalOpts.heroEnergy=opts.heroEnergy;
    return !!portals.tryTeleportProjectile(entity,portalGet,portalOpts);
  }

  function update(dt, getTile, setTile, opts){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(!(dt>0) || !isFinite(dt)) return;
    opts=opts||{};
    gravityHoldTick(dt);
    ultCharge=Math.min(1, ultCharge + dt/ULT_CHARGE_TIME);
    if(bowCd>0) bowCd-=dt;
    if(harpoonCd>0) harpoonCd-=dt;
    if(meleeCd>0) meleeCd-=dt;
    if(electricCd>0) electricCd-=dt;
    if(throwCd>0) throwCd-=dt;
    if(bouncyCd>0) bouncyCd-=dt;
    if(swing.t>0) swing.t-=dt;
    for(let i=coopSwings.length-1;i>=0;i--){ coopSwings[i].t-=dt; if(coopSwings[i].t<=0) coopSwings.splice(i,1); }
    if(explodeCd>0) explodeCd-=dt;
    if(heroFlameHitCd>0) heroFlameHitCd=Math.max(0,heroFlameHitCd-dt);
    const heatedStoneTiles=new Set();
    const heatedSandTiles=new Set();
    const heatedWaterTiles=new Set();
    for(let i=blastsFx.length-1;i>=0;i--){ blastsFx[i].t+=dt; if(blastsFx[i].t>blastsFx[i].max) blastsFx.splice(i,1); }
    for(let i=electricBeams.length-1;i>=0;i--){
      const b=electricBeams[i];
      b.t+=dt;
      if(b.t>=b.life) electricBeams.splice(i,1);
    }
    updateMines(dt,getTile,setTile,opts.player);
    updateArrowFragments(dt,getTile);
    // Arrows
    for(let i=arrows.length-1;i>=0;i--){
      const a=arrows[i];
      if(a.expiring){
        if(!updateExpiringArrow(a,dt,getTile)) arrows.splice(i,1);
        continue;
      }
      if(a.embeddedMob){
        if(embeddedMobAlive(a)){
          a.x=a.embeddedMob.x+(a.embeddedAnchorX||0)+(a.embeddedOffsetX||0);
          a.y=a.embeddedMob.y+(a.embeddedAnchorY||0)+(a.embeddedOffsetY||0);
          continue;
        }
        releaseArrowFromMob(a);
      }
      if(a.stuck){
        a.stuckT-=dt;
        // Any material that survived impact can be reclaimed before it expires.
		if(a.recoverable){
			const p=(typeof window!=='undefined') ? window.player : null;
			if(p && Math.abs(p.x-a.x)<1.1 && Math.abs(p.y-a.y)<1.3){
				const recoverKey=arrowResourceKey(a);
				if(recoverKey && addResource(recoverKey,1)){
              showRecoveredArrowFx(a,recoverKey,p);
              try{ if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(a.x*(MM.TILE||20),a.y*(MM.TILE||20),'common',4); }catch(e){}
              try{ if(MM.audio && MM.audio.play) MM.audio.play('harvest'); }catch(e){}
              try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('arrow_recover','Strzałę, która przetrwała trafienie, można podnieść z powrotem!'); }catch(e){}
              arrows.splice(i,1); continue;
            }
          }
        }
        if(a.stuckT<=0){
          // a clung sticky bomb detonates when its fuse runs out
          if(a.stickyFuse){ splatProjectile(a,getTile,setTile); arrows.splice(i,1); }
          else if(!beginArrowExpiryFall(a)) arrows.splice(i,1);
        }
        continue;
      }
      a._teleporterCooldown=Math.max(0,(Number(a._teleporterCooldown)||0)-dt);
      a.inWater=false;
      a.life-=dt;
      if(a.life<=0){
        // A mine that somehow never finds a floor (for example after being
        // thrown into the void) is retired instead of arming in mid-air.
        if(a.deployMine){ arrows.splice(i,1); continue; }
        // A spent rubber ball is not a broken shaft: it settles, and often stays
        // as a pickup (retireBouncyBall owns that roll for every exit path).
        if(a.bouncy){ retireBouncyBall(a); arrows.splice(i,1); continue; }
        // A gravity block never evaporates mid-air — matter is conserved: an
        // expired flight resolves exactly like a terrain landing where it is.
        if(a.grav){ resolveGravityImpactOnTile(a,Math.floor(a.x),Math.floor(a.y),0,0,getTile,setTile); arrows.splice(i,1); continue; }
        if(!beginArrowExpiryFall(a)) arrows.splice(i,1);
        continue;
      }
      a.ignoreUndergroundT=Math.max(0,(Number(a.ignoreUndergroundT)||0)-dt);
      // a burning arrow flying into a gas cloud detonates it — but NEVER a coop
      // (guest) arrow: detonation removes terrain, spreads fire and hurts the host,
      // all of which a guest projectile is forbidden from doing (world stays host truth)
      if(a.fire && !a.coopOwner){
        for(const q of puffs){
          if(q.kind!=='gas') continue;
          const ddx=q.x-a.x, ddy=q.y-a.y;
          if(ddx*ddx+ddy*ddy<1.4){ explodeAt(q.x,q.y,getTile,setTile); break; }
        }
        igniteWorldGas(a.x,a.y,getTile,setTile,1.4);
      }
      a.vy+=ARROW_GRAV*(Number.isFinite(a.gravityMult)?a.gravityMult:1)*dt;
      applyWindToArrow(a,dt,getTile);
      const steps=Math.max(1, Math.ceil(Math.max(Math.abs(a.vx),Math.abs(a.vy))*dt/0.35));
      const sdt=dt/steps;
      for(let s=0;s<steps;s++){
        let dx=(a.vx||0)*sdt, dy=(a.vy||0)*sdt;
        a.x+=dx; a.y+=dy;
        a.travel=(Number(a.travel)||0)+Math.hypot(dx,dy);
        if(teleportPhysicalShot(a,getTile,opts,false)){
          dx=(a.vx||0)*sdt;
          dy=(a.vy||0)*sdt;
        }
        const tx=Math.floor(a.x), ty=Math.floor(a.y);
        // an arrow flying through open flame or over lava catches fire — but never a
        // coop (guest) arrow: a fire arrow ignites terrain on impact, and a guest
        // projectile must stay inert to the world (it may still wound creatures)
        // A PLAIN rubber ball is deliberately EXEMPT: a ricochet that can carry
        // fire through six wall bounces would set half a forest alight for one
        // ball. A TAR ball is the opposite — taking light from the world is the
        // whole weapon — but igniting cuts its bounce budget right down, which is
        // what keeps the same arson bounded (igniteBouncyBall owns that clamp).
        if(!a.fire && !a.coopOwner && ((FIRE && FIRE.isBurning(tx,ty)) || getTile(tx,ty)===T.LAVA)){
          if(!a.bouncy) a.fire=true;
          else if(a.flammable) igniteBouncyBall(a);
        }
        // Sand needs contact detection without ever entering a target's damage
        // handler (many of those deliberately clamp even zero to chip damage).
        // Its status splat is the entire effect.
        if(a.noDamage && !a.deployMine && !a.spent && MM.mobs && MM.mobs.nearestLiving
           && MM.mobs.nearestLiving(a.x,a.y,0.72)){
          noteWeaponCombatHit(a.x,a.y-0.10,0,{source:a.coopOwner?'coop':'hero',kind:'thrown'},projectileCombatVisualMeta(a,{target:'mob',power:0.65}));
          splatProjectile(a,getTile,setTile);
          if(!a.coopOwner) addUltCharge(0.08);
          arrows.splice(i,1);
          break;
        }
        // Creature hit (mob, boss part or a hovering saucer)
        const hitDmg=arrowDamageAtRange(a);
        let undergroundResult=false;
        // a co-op guest's arrow wounds like the hero's but is credited 'coop': no
        // host XP special-casing, no heroFocus power bookkeeping (mobs.js decides)
        const arrowOpts=projectileImpactOpts(a);
        if(!a.coopOwner && !a.noDamage && !a.spent && (a.ignoreUndergroundT||0)<=0 && MM.undergroundBoss && MM.undergroundBoss.damageAt){
          undergroundResult=MM.undergroundBoss.damageAt(tx,ty,hitDmg,arrowOpts);
          if(undergroundResult==='bounce'){
            bounceArrowFromUnderground(a,tx,ty);
            break;
          }
        }
        // consensual duel arrows: a coop arrow whose owner is mid-duel wounds the
        // consenting partner's body. Symmetry is re-verified at IMPACT time — a
        // forfeit mid-flight (demote, death, leave) disarms the arrow. Only bodies
        // ever match: the host hero carries no gid and stays untouchable.
        if(a.coopOwner && a.duelGid && a.ownerGid && !a.spent){
          const duelBodies=(typeof MM!=='undefined' && MM.coopBodies) || null;
          let duelHit=false;
          if(Array.isArray(duelBodies)){
            const owner=duelBodies.find(bb=>bb && bb.gid===a.ownerGid && !bb.dead);
            const target=duelBodies.find(bb=>bb && bb.gid===a.duelGid && !bb.dead && typeof bb.hurt==='function');
            // Re-check BOTH halves of consent. A target-only stale snapshot must
            // not keep an arrow armed after its owner left or forfeited.
            if(owner && target && owner.duelWith===a.duelGid && target.duelWith===a.ownerGid
              && Math.abs(a.x-target.x) < (target.w||0.62)/2+0.35 && Math.abs(a.y-target.y) < (target.h||0.92)/2+0.35){
              target.hurt(a.dmg, a.x, a.y, 'duel');
              duelHit=true;
            }
          }
          if(duelHit){ arrows.splice(i,1); break; }
        }
        const creatureGate=!a.noDamage && !a.spent && (Number(a.pierceGate)||0)<= (a.travel||0);
        let hitMob=null, hitMobFamily='', hitMobAlive=null, hitMobAnchor=null;
        const targetArrowOpts=Object.assign({},arrowOpts,{onTarget:(target,family,isAlive,anchor)=>{
          hitMob=target;
          hitMobFamily=family||'mob';
          hitMobAlive=typeof isAlive==='function' ? isAlive : null;
          hitMobAnchor=anchor && typeof anchor==='object' ? anchor : null;
        }});
        const beforeRoamingBoss=creatureGate && ((!a.coopOwner && MM.centerGuardian && MM.centerGuardian.damageAt && MM.centerGuardian.damageAt(tx,ty,hitDmg,arrowOpts))
          || (!a.coopOwner && MM.mechs && MM.mechs.damageAt && MM.mechs.damageAt(tx,ty,hitDmg,targetArrowOpts))
          || (MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,hitDmg,targetArrowOpts))
          || (!a.coopOwner && MM.guardianLairs && MM.guardianLairs.damageAt && MM.guardianLairs.damageAt(tx,ty,hitDmg,arrowOpts))
          || undergroundResult
          || (!a.coopOwner && MM.skyGuardian && MM.skyGuardian.damageAt && MM.skyGuardian.damageAt(tx,ty,hitDmg,arrowOpts)));
        let roamingBossResult=false;
        if(!a.coopOwner && creatureGate && !beforeRoamingBoss && MM.bosses && MM.bosses.damageAt){
          roamingBossResult=MM.bosses.damageAt(tx,ty,hitDmg,targetArrowOpts);
        }
        // The block boss ATE the block. No damage landed, so this must skip the
        // whole creature-hit chain: no ult charge, no status burst, and above all
        // no resolveGravityImpactOnCreature — that pays the tile's mining drops,
        // and a block that became boss flesh must not also become loot.
        if(roamingBossResult==='absorbed'){
          arrows.splice(i,1);
          break;
        }
        // Irydium treats a boss body tile exactly like a pierceable world block:
        // remove it, spend one penetration, lose momentum, and keep flying.
        if(roamingBossResult==='pierced' && finishIridiumPierce(a,tx,ty)){
          a.pierceGate=(a.travel||0)+0.55;
          continue;
        }
        if(roamingBossResult==='blocked'){
          if(a.bouncy){
            // Armour plate is a wall to a rubber ball: bounce off it instead of
            // sticking, so the shot keeps its identity against a boss too.
            if(bounceBallOffTile(a,tx,ty,dx,dy,getTile)) break;
            retireBouncyBall(a);
            arrows.splice(i,1);
            break;
          }
          if(a.deployMine){
            a.x-=a.vx*sdt*0.6; a.y-=a.vy*sdt*0.6;
            a.vx*=-0.22; a.vy=Math.min(2,Math.abs(a.vy)*0.18);
          } else if(a.stickyFuse){
            a.x-=a.vx*sdt*0.4; a.y-=a.vy*sdt*0.4;
            a.stuck=true; a.stuckT=a.stickyFuse;
          } else if(a.thrown || a.snowball || a.rock){
            a.x-=a.vx*sdt*0.5; a.y-=a.vy*sdt*0.5;
            splatProjectile(a,getTile,setTile);
            arrows.splice(i,1);
          } else if(a.dropOnLand && spawnDroppedArrowPickup(a)){
            arrows.splice(i,1);
          } else if(breakArrowOnImpact(a,'terrain')){
            arrows.splice(i,1);
          } else if(hitMob && attachArrowToMob(a,hitMob,hitMobFamily,hitMobAlive,hitMobAnchor)){
            if(!embeddedMobAlive(a)) releaseArrowFromMob(a);
          } else {
            stickArrowForRecovery(a,sdt);
          }
          break;
        }
        const creatureHit=creatureGate && (beforeRoamingBoss || roamingBossResult
          || (!a.coopOwner && MM.invasions && MM.invasions.damageAt && MM.invasions.damageAt(tx,ty,hitDmg,targetArrowOpts))
          || (!a.coopOwner && MM.npcSystem && MM.npcSystem.damageAt && MM.npcSystem.damageAt(tx,ty,hitDmg))
          || (!a.coopOwner && MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,hitDmg)));
        if(creatureHit){
          noteWeaponCombatHit(a.x,a.y-0.18,hitDmg,arrowOpts,projectileCombatVisualMeta(a,{major:!!a.power,tier:a.tier,power:a.power?1.35:0.82}));
          if(a.mergePerk && !a.coopOwner) applyMergePerkAt(a.mergePerk,tx,ty,hitDmg);
          if(a.fire && MM.mobs && MM.mobs.igniteAt) MM.mobs.igniteAt(tx,ty,{dur:2.5,dps:2,source:a.coopOwner?'coop':'hero',specialAttack:!!a.specialAttack});
          if(a.stagger && MM.mobs && MM.mobs.chillAt) MM.mobs.chillAt(tx,ty,{dur:a.stagger,source:a.coopOwner?'coop':'hero',cause:'stagger'}); // stone arrows stop the target in its tracks
          if(a.splat) splatProjectile(a,getTile,setTile);
          if(!a.coopOwner) addUltCharge(0.08); // only the hero's own shots feed the hero's ult
          // gravity block: the material speaks (status burst) and the block
          // breaks up on the body — its damage already landed via the chain
          if(a.grav){
            resolveGravityImpactOnCreature(a,tx,ty,getTile,setTile);
            arrows.splice(i,1);
            break;
          }
          // Rubber ball: rebound off the body it just hit and go looking for the
          // next one. This is the whole weapon — one shot, several victims, each
          // taking less than the last (bounceBallOffBody owns both curves).
          if(a.bouncy){
            // A creature that is ALREADY BURNING is a light source like any other:
            // set one enemy alight with anything, then carry that fire through the
            // rest of the pack on the rebound. hitMob is already resolved here, so
            // this costs no extra scan.
            if(a.flammable && !a.fire && hitMob && MM.mobs && MM.mobs.hasStatus && MM.mobs.hasStatus(hitMob,'burn')){
              igniteBouncyBall(a);
            }
            a.bodyHits=(Number(a.bodyHits)||0)+1;
            // the journal entry fires on the SECOND victim: one hit is a shot,
            // two from one ball is the trick the weapon exists for
            if(a.bodyHits===2 && !a.coopOwner){
              try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('rubber_ricochet','Kulka odbiła się od wroga prosto w następnego!'); }catch(e){}
            }
            if(bounceBallOffBody(a)) continue;
            retireBouncyBall(a);
            arrows.splice(i,1);
            break;
          }
          if(breakArrowOnImpact(a,'creature')){
            arrows.splice(i,1);
            break;
          }
          // diamond arrows overpenetrate: keep flying through up to 3 creatures
          if((a.mobPierce||0)>0){
            a.mobPierce--;
            a.dmg=Math.max(1,Math.round(a.dmg*0.7));
            a.pierceGate=(a.travel||0)+1.2; // clear the current body before the next hit registers
            continue;
          }
          if(hitMob && attachArrowToMob(a,hitMob,hitMobFamily,hitMobAlive,hitMobAnchor)){
            // A lethal hit has no living body to hold the arrow for another
            // frame, so begin the corpse drop immediately.
            if(!embeddedMobAlive(a)) releaseArrowFromMob(a);
            break;
          }
          if(dropSurvivingArrow(a)) break;
          arrows.splice(i,1); break;
        }
        const t=getTile(tx,ty);
        const chestProjectileOpts={kind:a.thrown?'thrown':'arrow',specialAttack:!!a.specialAttack,hitRadius:0.12};
        if(a.harpoon) chestProjectileOpts.kind='harpoon';
        if(!a.deployMine && !a.spent && !a.coopOwner && openChestFromWeaponHit(a.x,a.y,chestProjectileOpts)){
          noteWeaponCombatHit(a.x,a.y,0,{source:'hero',kind:chestProjectileOpts.kind},projectileCombatVisualMeta(a,{target:'chest',power:0.72}));
          if(a.splat) splatProjectile(a,getTile,setTile);
          if(a.bouncy){
            retireBouncyBall(a);
            arrows.splice(i,1);
          } else if(arrowResourceKey(a)){
            if(breakArrowOnImpact(a,'chest')) arrows.splice(i,1);
            else stickArrowForRecovery(a,sdt);
          } else arrows.splice(i,1);
          break;
        }
        // A soft ball does NOT shatter glass — it bounces off it (the pane is
        // solid, so the ricochet branch below owns it). Skipping this branch is
        // also what keeps the ball out of the shaft-fragment exit path.
        if(!a.bouncy && !a.noDamage && !a.spent && !a.coopOwner && t===T.GLASS && shatterGlassAt(tx,ty,setTile,getTile)){
          noteWeaponCombatHit(a.x,a.y,0,{source:'hero',kind:a.harpoon?'harpoon':'arrow'},projectileCombatVisualMeta(a,{target:'terrain',targetMaterial:'glass',power:0.9}));
          // a thrown block PUNCHES THROUGH a pane: the glass pays, the mass
          // barely notices — the shot keeps flying with a little bite shaved off
          if(a.grav){ a.dmg=Math.max(1,(Number(a.dmg)||1)*0.9); continue; }
          if(arrowResourceKey(a)){
            if(breakArrowOnImpact(a,'glass')){ arrows.splice(i,1); break; }
            continue;
          }
          arrows.splice(i,1); break;
        }
        if(isSolid(t)){
          noteWeaponCombatHit(a.x,a.y,0,{source:'hero',kind:a.harpoon?'harpoon':a.thrown?'thrown':'arrow'},projectileCombatVisualMeta(a,{target:'terrain',targetMaterial:String(t),power:a.power?1.2:0.72}));
          if(!a.spent && tryIridiumPierceBlock(a,tx,ty,t,getTile,setTile)){
            if(a.fire && FIRE) FIRE.ignite(tx,ty,getTile,setTile);
            continue;
          }
          // gravity block: rubber ricochets, soft matter drifts, fragile or fast
          // matter shatters into its mining yield, the rest settles back into
          // the world as a falling solid (resolveGravityImpactOnTile owns it all)
          if(a.grav){
            if(resolveGravityImpactOnTile(a,tx,ty,dx,dy,getTile,setTile)==='continue') continue;
            arrows.splice(i,1);
            break;
          }
          // rubber balls ricochet off the wall and keep hunting; when the bounce
          // budget or the speed runs out they settle (and half of them stay).
          // A LIT tar ball leaves fire on every surface it kisses — that, plus the
          // creature ignition below, is the whole point of the incendiary variant.
          if(a.bouncy){
            spreadBouncyFire(a,tx,ty,getTile,setTile);
            if(bounceBallOffTile(a,tx,ty,dx,dy,getTile)) continue;
            retireBouncyBall(a);
            arrows.splice(i,1);
            break;
          }
          // A thrown mine is not a contact grenade. Side/ceiling impacts make it
          // tumble down; a downward impact leaves it resting on the surface.
          if(a.deployMine){
            a.x-=dx; a.y-=dy;
            const floorImpact=dy>0 && Math.abs(dy)>=Math.abs(dx)*0.32;
            if(floorImpact){
              deployMine(a,getTile,setTile);
              arrows.splice(i,1);
            }else{
              if(Math.abs(dx)>=Math.abs(dy)) a.vx=-a.vx*0.24;
              else a.vy=Math.abs(a.vy)*0.20;
              a.vx*=0.82;
            }
            break;
          }
          // sticky bombs cling to the wall and detonate after their fuse
          if(a.stickyFuse){
            a.x-=a.vx*sdt*0.4; a.y-=a.vy*sdt*0.4;
            a.stuck=true;
            a.stuckT=a.stickyFuse;
            break;
          }
          // thrown projectiles never stick in a wall — they burst on impact
          if(a.thrown || a.snowball || a.rock){
            a.x-=a.vx*sdt*0.5; a.y-=a.vy*sdt*0.5;
            splatProjectile(a,getTile,setTile);
            arrows.splice(i,1);
            break;
          }
          if(a.dropOnLand){
            a.x-=a.vx*sdt*0.6; a.y-=a.vy*sdt*0.6;
            if(spawnDroppedArrowPickup(a)){
              arrows.splice(i,1);
            } else {
              a.dropOnLand=false;
              a.stuck=true;
              a.recoverable=true;
              a.stuckT=ARROW_RECOVER_SECONDS;
            }
            break;
          }
          if(!a.coopOwner && a.fire && FIRE){ FIRE.ignite(tx,ty,getTile,setTile); FIRE.ignite(Math.floor(a.x),Math.floor(a.y),getTile,setTile); }
          if(breakArrowOnImpact(a,'terrain')){
            arrows.splice(i,1);
            break;
          }
          stickArrowForRecovery(a,sdt);
          break;
        }
        if(t===T.WATER){
          const retention=Number.isFinite(a.waterDrag) ? Math.max(0.80,Math.min(0.999,a.waterDrag)) : 0.96;
          a.vx*=retention; a.vy*=retention; a.fire=false; a.inWater=true;
        } // water drag douses it too; aquatic shafts keep far more momentum
      }
    }
    // Stream puffs
    for(let i=puffs.length-1;i>=0;i--){
      const p=puffs[i];
      if(!p) continue; // explosions can shrink the puff array below the current loop index
      p.life-=dt;
      p.age=(p.age||0)+dt;
      if(p.life<=0){
        if(p.kind==='hose') condenseWater(p.x,p.y,getTile,setTile);
        else if(p.kind==='gas' && Math.random()<0.28) addWorldGas('poison',p.x,p.y,{power:0.25,cells:1,getTile,setTile});
        puffs.splice(i,1); continue;
      }
      let px0=p.x, py0=p.y;
      const cfg=STREAMS[p.kind]||STREAMS.flame;
      p._teleporterCooldown=Math.max(0,(Number(p._teleporterCooldown)||0)-dt);
      applyWindToPuff(p,dt,getTile);
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      if(p.source==='hero' && teleportPhysicalShot(p,getTile,opts,true)){
        // Wall reactions after a teleport belong at the exit, not at the
        // puff's pre-portal position.
        px0=p.x; py0=p.y;
      }
      p.vy+=cfg.grav*dt;
      p.vx*=1-Math.min(1,dt*0.9); p.vy*=1-Math.min(1,dt*(p.kind==='hose'?0.5:0.9));
      const tx=Math.floor(p.x), ty=Math.floor(p.y);
      const t=getTile(tx,ty);
      const info=INFO[t] || null;
      const hitWall=isSolid(t);
      if(p.source==='hero' && openChestFromWeaponHit(p.x,p.y,{kind:p.kind,specialAttack:!!p.specialAttack,hitRadius:0.16})){
        puffs.splice(i,1); continue;
      }
      if(p.kind==='flame' && applyBlockReaction('heat',tx,ty,getTile,setTile)){
        puffs.splice(i,1); continue;
      }
      if(p.kind==='hose' && applyBlockReaction('water',tx,ty,getTile,setTile)){
        puffs.splice(i,1); continue;
      }
      if(t===T.GLASS && shatterGlassAt(tx,ty,setTile,getTile,{respectHeatForged:p.kind==='flame'})){
        puffs.splice(i,1); continue;
      }
      if(p.kind==='flame'){
        if(igniteWorldGas(p.x,p.y,getTile,setTile,1.6)){ puffs.splice(i,1); continue; }
        hurtHeroWithFlame(p);
        if(t===T.WATER){
          noteWaterHeat(tx,ty,heatedWaterTiles);
          const heatR=waterHeatRatioAt(tx,ty);
          if(heatR>0.35 && Math.random()<(0.18+heatR*0.34)) emitSteam(p.x,p.y-0.3,1,getTile,setTile); // hissing surface
          puffs.splice(i,1); continue;
        }
        if(t===T.MEAT && cookMeatAt(tx,ty,getTile,setTile)){ puffs.splice(i,1); continue; }
        if(MM.companions && MM.companions.heatAt && MM.companions.heatAt(tx,ty,getTile,setTile,puffStreamDamageOpts('flame',p))){ puffs.splice(i,1); continue; }
        if(MM.undergroundBoss && MM.undergroundBoss.heatAt && MM.undergroundBoss.heatAt(tx,ty,getTile,setTile,puffStreamDamageOpts('flame',p))){ puffs.splice(i,1); continue; }
        if(info && info.flammable && Math.random()<0.22 && FIRE) FIRE.ignite(tx,ty,getTile,setTile);
        if(hitWall){
          // sustained flame melts bare rock into a lava pool; snow and ice thaw to water
          if(t===T.STONE && typeof setTile==='function'){
            noteStoneHeat(tx,ty,heatedStoneTiles);
          } else if((t===T.SNOW||t===T.TOXIC_SNOW||t===T.ICE||t===T.GRASS_SNOW||isFrozenEarth(t)) && Math.random()<0.3 && thawColdTile(tx,ty,getTile,setTile)){
            emitSteam(p.x,p.y-0.2,1,getTile,setTile);
          }
          puffs.splice(i,1); continue;
        }
        if(Math.random()<0.3 && MM.mobs && MM.mobs.igniteRadius) MM.mobs.igniteRadius(p.x,p.y,0.9,puffStreamDamageOpts('flame',p,{dur:2.5, dps:(p.dps||6)*0.6}));
        if(Math.random()<0.3 && MM.mechs && MM.mechs.igniteRadius) MM.mechs.igniteRadius(p.x,p.y,0.9,puffStreamDamageOpts('flame',p,{dur:2.5, dps:(p.dps||6)*0.6}));
        // bosses/guardians accept the weakened matrix: burn ticks at half dps
        if(Math.random()<0.3 && MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(p.x,p.y,0.9,'burn',puffStreamDamageOpts('flame',p,{dur:2.5, dps:(p.dps||6)*0.6}));
        if(Math.random()<0.25 && MM.plants && MM.plants.scorchAt) MM.plants.scorchAt(p.x,p.y,1.2);
      } else if(p.kind==='hose'){
        // A water turret under the jet drinks it: the hose tops up placed
        // turret tanks and mech-mounted ones through the same tank APIs the
        // pump network uses, so the spray is a portable refill line.
        if(t===T.WATER_TURRET && MM.turrets && MM.turrets.receiveWaterAt && MM.turrets.receiveWaterAt(tx,ty,HOSE_TURRET_REFILL,getTile)>0){
          puffs.splice(i,1); continue;
        }
        if(MM.mechs && MM.mechs.refillMountedWaterAt && MM.mechs.refillMountedWaterAt(tx,ty,HOSE_TURRET_REFILL)>0){
          puffs.splice(i,1); continue;
        }
        if(FIRE && FIRE.isBurning(tx,ty)) FIRE.extinguish(tx,ty);
        if(Math.random()<0.3 && MM.mobs && MM.mobs.douseRadius) MM.mobs.douseRadius(p.x,p.y,1.0);
        // soaking a boss primes the conduction combo (electric x1.25)
        if(Math.random()<0.3 && MM.bossStatus && MM.bossStatus.applyRadius) MM.bossStatus.applyRadius(p.x,p.y,1.0,'wet',{dur:6,source:'hero',cause:'hose'});
        // watering can: the jet hydrates the garden it passes over
        if(Math.random()<0.3 && MM.plants && MM.plants.waterAt) MM.plants.waterAt(p.x,p.y,0.3,1.6);
        if(Math.random()<0.10 && MM.mobs && MM.mobs.damageAt) MM.mobs.damageAt(tx,ty, Math.max(1,(p.dps||2)*0.5),puffStreamDamageOpts('hose',p));
        if(Math.random()<0.10 && MM.mechs && MM.mechs.damageAt) MM.mechs.damageAt(tx,ty, Math.max(1,(p.dps||2)*0.5),puffStreamDamageOpts('hose',p));
        if(t===T.LAVA){
          // quenching: molten rock hardens to obsidian under the jet
          if(typeof setTile==='function' && !authoritativeBodyBlocksCell(tx,ty) && Math.random()<QUENCH_CHANCE){
            setTile(tx,ty,T.OBSIDIAN);
            emitSteam(p.x,p.y-0.2,3,getTile,setTile);
          } else emitSteam(p.x,p.y-0.2,1,getTile,setTile);
          puffs.splice(i,1); continue;
        }
        if(t===T.WATER){ puffs.splice(i,1); continue; } // merged into the body of water
        if(hitWall){
          // soaked sand turns to boggy mud (halves the speed of anything walking on it)
          if(t===T.SAND && typeof setTile==='function' && Math.random()<MUD_CHANCE){
            setTile(tx,ty,T.MUD);
          } else condenseWater(px0,py0,getTile,setTile);
          puffs.splice(i,1); continue;
        }
      } else if(p.kind==='gas'){
        if(t===T.WATER){ puffs.splice(i,1); continue; }
        // toxic vapour DETONATES on contact with open flame or lava
        if((FIRE && FIRE.isBurning(tx,ty)) || t===T.LAVA){
          puffs.splice(i,1);
          explodeAt(p.x,p.y,getTile,setTile);
          continue;
        }
        if(hitWall){
          addWorldGas('poison',px0,py0,{power:0.18,cells:1,getTile,setTile});
          p.x=px0; p.y=py0; p.vx*=0.3; p.vy=-Math.abs(p.vy)*0.3;
        } // pools against walls
        if(Math.random()<0.3 && MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(p.x,p.y,0.95,puffStreamDamageOpts('gas',p,{dur:4, dps:(p.dps||5)*0.7}));
      } else { // steam: purely cosmetic, fades on contact
        if(hitWall || t===T.WATER){ puffs.splice(i,1); continue; }
      }
    }
    applyFlameHeatRays(heatedSandTiles,getTile);
    updateWaterHeat(heatedWaterTiles,getTile,setTile,dt);
    updateStoneHeat(heatedStoneTiles,getTile,setTile,dt);
    updateSandHeat(heatedSandTiles,getTile,setTile,dt);
    updateHeatForgedGlass(getTile,dt);
  }

  // ---- Rendering ----
  function drawStoneHeat(ctx,TILE,tileVisible){
    if(!stoneHeat.size) return;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const h of stoneHeat.values()){
      if(!tileVisible(h.x,h.y)) continue;
      const r=Math.max(0,Math.min(1,(h.heat||0)/STONE_MELT_SECONDS));
      const px=h.x*TILE, py=h.y*TILE;
      const pulse=0.82+0.18*Math.sin(now*0.018+h.x*1.7+h.y*0.9);
      const inset=Math.max(1,TILE*0.06);
      ctx.globalAlpha=(0.14+0.46*r)*pulse;
      ctx.fillStyle='#ff6a1f';
      ctx.fillRect(px+inset,py+inset,TILE-inset*2,TILE-inset*2);
      ctx.globalAlpha=0.18+0.58*r;
      ctx.fillStyle='#ffe27a';
      const crack=Math.max(1,TILE*(0.045+0.035*r));
      const len=Math.max(1,TILE*(0.12+0.62*r));
      ctx.fillRect(px+TILE*0.16,py+TILE*0.35,len,crack);
      ctx.fillRect(px+TILE*0.48,py+TILE*0.14,crack,Math.max(1,TILE*(0.18+0.56*r)));
      if(r>0.55){
        ctx.globalAlpha=(r-0.55)*1.2;
        ctx.fillStyle='#fff1b8';
        ctx.fillRect(px+TILE*0.30,py+TILE*0.66,Math.max(1,TILE*0.34*r),crack);
      }
    }
    ctx.restore();
  }
  function drawSandHeat(ctx,TILE,tileVisible){
    if(!sandHeat.size) return;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const h of sandHeat.values()){
      if(!tileVisible(h.x,h.y)) continue;
      const r=Math.max(0,Math.min(1,(h.heat||0)/SAND_GLASS_SECONDS));
      const px=h.x*TILE, py=h.y*TILE;
      const pulse=0.80+0.20*Math.sin(now*0.014+h.x*1.3+h.y*1.1);
      const inset=Math.max(1,TILE*0.08);
      ctx.globalAlpha=(0.10+0.40*r)*pulse;
      ctx.fillStyle='#ffb84a';
      ctx.fillRect(px+inset,py+inset,TILE-inset*2,TILE-inset*2);
      ctx.globalAlpha=0.12+0.50*r;
      ctx.fillStyle='#fff0c5';
      const bead=Math.max(1,TILE*(0.08+0.10*r));
      ctx.fillRect(px+TILE*0.18,py+TILE*0.25,bead,bead);
      ctx.fillRect(px+TILE*0.58,py+TILE*0.46,bead*0.8,bead*0.8);
      if(r>0.70){
        ctx.globalAlpha=(r-0.70)*1.4;
        ctx.fillStyle='#e9fbff';
        ctx.fillRect(px+TILE*0.25,py+TILE*0.68,TILE*0.50,Math.max(1,TILE*0.08));
      }
    }
    ctx.restore();
  }
  function drawProjectilePrestigeTrail(ctx,TILE,a){
    const rank=Math.max(0,Math.min(4,Number(a.weaponPrestige)||0));
    if(rank<2 || a.stuck || a.expiring || (!a.vx && !a.vy)) return;
    const ang=Math.atan2(a.vy||0,a.vx||1), col=a.weaponGlow||'#d7f5ff';
    const pulse=0.78+0.22*Math.sin(nowMs()*0.012+(a.x||0)*0.7+(a.y||0)*0.43);
    ctx.save(); ctx.translate(a.x*TILE,a.y*TILE); ctx.rotate(ang);
    // No shadowBlur here any more: the enchantment's GLOW is registered with
    // post_fx (which owns falloff and the streak, above the darkness overlay),
    // and shadowBlur is the most expensive way Canvas2D can fake one. What stays
    // is the art this rank draws — the wake bubbles and the rank-4 spark.
    ctx.globalCompositeOperation='lighter'; ctx.strokeStyle=col; ctx.fillStyle=col;
    ctx.lineCap='round';
    if(a.aquatic && a.inWater){
      const bubbles=rank===4?4:rank===3?3:2;
      for(let i=0;i<bubbles;i++){
        ctx.globalAlpha=(0.30+i*0.08)*pulse;
        const bx=-TILE*(0.22+i*0.18), by=Math.sin(i*2.3+(a.travel||0)*2)*TILE*0.07;
        ctx.lineWidth=Math.max(0.75,TILE*0.038);
        ctx.beginPath(); ctx.arc(bx,by,TILE*(0.035+i*0.008),0,Math.PI*2); ctx.stroke();
      }
    }else{
      const len=TILE*(rank===4?1.12:rank===3?0.84:0.58);
      ctx.globalAlpha=(rank===4?0.55:rank===3?0.38:0.22)*pulse;
      ctx.lineWidth=Math.max(1,TILE*(rank===4?0.15:rank===3?0.105:0.075));
      ctx.beginPath(); ctx.moveTo(-len,0); ctx.lineTo(-TILE*0.08,0); ctx.stroke();
      if(rank===4){
        ctx.globalAlpha=0.72*pulse; ctx.fillStyle='#ffffff';
        ctx.beginPath(); ctx.arc(-len*0.58,0,TILE*0.045,0,Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function draw(ctx,TILE,canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const tileVisible = (x,y)=> !visibleTile || visibleTile(Math.floor(x),Math.floor(y));
    if(mines.length){
      const now=nowMs();
      ctx.save();
      for(const mine of mines){
        if(!tileVisible(mine.x,mine.y)) continue;
        const x=mine.x*TILE, y=mine.y*TILE;
        const r=TILE*0.27;
        ctx.save();
        ctx.translate(x,y);
        ctx.fillStyle='rgba(0,0,0,0.32)';
        ctx.beginPath(); ctx.ellipse(0,TILE*0.055,r*1.12,r*0.36,0,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=mine.type==='fragmentation'?'#c88945':'#77818a';
        ctx.lineWidth=Math.max(1,TILE*0.055);
        for(let k=0;k<4;k++){
          const a=k*Math.PI*0.5;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a)*r*0.58,Math.sin(a)*r*0.22);
          ctx.lineTo(Math.cos(a)*r*1.18,Math.sin(a)*r*0.44);
          ctx.stroke();
        }
        ctx.fillStyle=mine.color;
        ctx.beginPath(); ctx.ellipse(0,0,r,r*0.46,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=mine.type==='fragmentation'?'#2f2824':'#252b30';
        ctx.beginPath(); ctx.ellipse(0,-r*0.08,r*0.52,r*0.27,0,0,Math.PI*2); ctx.fill();
        const blink=mine.armed ? (0.58+0.42*Math.sin(now*0.018+mine.x)*Math.sin(now*0.018+mine.x)) : 0.34;
        ctx.globalAlpha=blink;
        ctx.fillStyle=mine.headColor;
        ctx.beginPath(); ctx.arc(0,-r*0.13,Math.max(1.3,TILE*0.055),0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    if(mineFragments.length){
      ctx.save();
      ctx.lineCap='round';
      for(const f of mineFragments){
        if(!tileVisible(f.x,f.y)) continue;
        const alpha=Math.max(0,1-f.t/f.life);
        ctx.globalAlpha=alpha;
        ctx.strokeStyle=alpha>0.55?'#fff1bd':'#d89045';
        ctx.lineWidth=Math.max(1,TILE*0.065);
        const len=TILE*(0.16+alpha*0.22);
        ctx.save();
        ctx.translate(f.x*TILE,f.y*TILE);
        ctx.rotate(f.angle||0);
        ctx.beginPath(); ctx.moveTo(-len,0); ctx.lineTo(len*0.35,0); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    if(arrows.length){
      ctx.save();
      for(const a of arrows){
        if(!tileVisible(a.x,a.y)) continue;
        // The shot's own light: registered, so it blooms ABOVE the darkness
        // overlay and streaks along the flight path like any other glow source.
        if(!a.stuck && !a.embeddedMob) registerProjectileGlow(a,TILE);
        drawProjectilePrestigeTrail(ctx,TILE,a);
        if(a.sandSpray){
          // Each throw owns a different stable spray: grain count, tail length,
          // fan width, clumps, sizes and wobble all come from its compact seed.
          const seed=(Number(a.sandSeed)>>>0)||1;
          const pattern=sandVisualPattern(seed);
          const now=nowMs();
          const ang=Math.atan2(a.vy||0,a.vx||1)+pattern.tilt;
          const bloom=0.72+Math.min(1,(Number(a.travel)||0)/3)*0.36;
          ctx.save();
          ctx.translate(a.x*TILE,a.y*TILE); ctx.rotate(ang);
          for(let g=0;g<pattern.count;g++){
            const along=sandVisualNoise(seed,g,10);
            const side=sandVisualNoise(seed,g,11)-0.5;
            const clump=sandVisualNoise(seed,g,12);
            const phase=sandVisualNoise(seed,g,13)*Math.PI*2;
            const lead=clump>0.84 ? 0.10+(clump-0.84)*0.55 : 0;
            const gx=TILE*(lead-0.08-along*pattern.tail+(sandVisualNoise(seed,g,14)-0.5)*0.08);
            const fan=pattern.spread*(0.38+along*0.90)*bloom;
            const flutter=Math.sin(now*(0.012+sandVisualNoise(seed,g,15)*0.011)+phase)*pattern.flutter;
            const gy=TILE*(side*fan+flutter+(clump>0.72?(clump-0.72)*0.10:0));
            const sz=Math.max(0.65,TILE*(0.022+sandVisualNoise(seed,g,16)*0.052));
            ctx.globalAlpha=0.36+sandVisualNoise(seed,g,17)*0.58;
            const tone=sandVisualNoise(seed,g,18);
            ctx.fillStyle=tone>0.76?(a.headColor||'#f0dc9b'):tone<0.18?'#8f7341':(a.color||'#c7aa68');
            ctx.fillRect(gx-sz*0.5,gy-sz*0.5,sz,sz);
          }
          ctx.restore();
          ctx.globalAlpha=1;
          continue;
        }
        if(a.spitDroplet){
          // A compact saliva bead with two tiny trailing beads. The ult uses the
          // same silhouette, but glows toxic green through its projectile color.
          const ang=Math.atan2(a.vy||0,a.vx||1);
          const px=a.x*TILE, py=a.y*TILE;
          ctx.save();
          ctx.translate(px,py); ctx.rotate(ang);
          if(a.toxicSpit){
            ctx.globalCompositeOperation='lighter';
            ctx.fillStyle='rgba(74,235,83,0.22)';
            ctx.beginPath(); ctx.arc(0,0,TILE*0.18,0,Math.PI*2); ctx.fill();
            ctx.globalCompositeOperation='source-over';
          }
          ctx.globalAlpha=0.52;
          ctx.fillStyle=a.color||'#cfe9df';
          ctx.beginPath(); ctx.arc(-TILE*0.22,0,TILE*0.035,0,Math.PI*2); ctx.fill();
          ctx.globalAlpha=0.70;
          ctx.beginPath(); ctx.arc(-TILE*0.13,0,TILE*0.055,0,Math.PI*2); ctx.fill();
          ctx.globalAlpha=0.94;
          ctx.beginPath(); ctx.arc(0,0,TILE*(a.toxicSpit?0.115:0.095),0,Math.PI*2); ctx.fill();
          ctx.fillStyle=a.headColor||'#f5fff8';
          ctx.beginPath(); ctx.arc(-TILE*0.025,-TILE*0.032,TILE*0.034,0,Math.PI*2); ctx.fill();
          ctx.restore();
          ctx.globalAlpha=1;
          continue;
        }
        if(a.rock){
          // thrown stone: a tumbling grey chunk
          const px=a.x*TILE, py=a.y*TILE;
          a.rot=(a.rot||0)+0.22;
          ctx.save();
          ctx.translate(px,py); ctx.rotate(a.rot);
          ctx.fillStyle=a.color||'#9aa0a8';
          ctx.beginPath();
          ctx.moveTo(-TILE*0.20,-TILE*0.14);
          ctx.lineTo(TILE*0.14,-TILE*0.20);
          ctx.lineTo(TILE*0.24,TILE*0.06);
          ctx.lineTo(TILE*0.04,TILE*0.20);
          ctx.lineTo(-TILE*0.20,TILE*0.10);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle=a.headColor||'#c9ced6';
          ctx.fillRect(-TILE*0.06,-TILE*0.10,TILE*0.10,TILE*0.08);
          ctx.restore();
          continue;
        }
        if(a.grav){
          // A flying BLOCK: a tumbling tile-colored square. The spin rate rides
          // speed, so a heavy lob turns lazily and a flat shot whirls — the
          // rotation is the readout of the momentum the impact will spend.
          // Size is NOT a style choice here: this is the tile that vanished from
          // the world and the tile that will settle back out of the air, so it
          // flies at exactly one tile. At 0.62 it read as a pebble carrying a
          // boulder's damage.
          const px=a.x*TILE, py=a.y*TILE;
          const speed=Math.hypot(a.vx||0,a.vy||0);
          a.ang=(a.ang||0)+speed*0.011;
          const s=TILE;
          ctx.save();
          ctx.translate(px,py);
          ctx.rotate(a.ang);
          ctx.fillStyle='rgba(0,0,0,0.28)';
          ctx.fillRect(-s/2+1.5,-s/2+1.5,s,s);
          ctx.fillStyle=a.color||'#9aa0a8';
          ctx.fillRect(-s/2,-s/2,s,s);
          ctx.strokeStyle='rgba(255,255,255,0.35)';
          ctx.lineWidth=1;
          ctx.strokeRect(-s/2,-s/2,s,s);
          ctx.fillStyle='rgba(255,255,255,0.18)';
          ctx.fillRect(-s/2,-s/2,s,s*0.28);
          ctx.restore();
          continue;
        }
        if(a.bouncy){
          // Rubber ball: a squash-and-stretch sphere. It elongates ALONG its own
          // velocity, so a fast shot reads as a streak and a spent one as a bead —
          // the visual is the remaining energy, which is also the remaining threat.
          const px=a.x*TILE, py=a.y*TILE;
          const vx=a.vx||0, vy=a.vy||0;
          const speed=Math.hypot(vx,vy);
          const stretch=1+Math.min(0.55,speed/BOUNCY_SPEED*0.45);
          const r=TILE*0.155*(0.72+Math.min(1,(Number(a.bounces)||0)/BOUNCY_MAX_BOUNCES)*0.28);
          ctx.save();
          ctx.translate(px,py);
          if(speed>0.2) ctx.rotate(Math.atan2(vy,vx));
          ctx.fillStyle='rgba(224,83,63,0.22)';
          ctx.beginPath(); ctx.ellipse(-r*stretch*0.8,0,r*stretch*0.9,r*0.7,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle=a.color||BOUNCY_COLOR;
          ctx.beginPath(); ctx.ellipse(0,0,r*stretch,r,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle=a.headColor||BOUNCY_HIGHLIGHT;
          ctx.beginPath(); ctx.ellipse(-r*0.22,-r*0.32,r*0.34,r*0.28,0,0,Math.PI*2); ctx.fill();
          if(a.fire){
            // Burning tar: a hot core plus a flame trailing BEHIND the ball, so a
            // fast ricochet reads as a streak of fire instead of a red dot. The
            // trail sits on the tail side because the shape is already rotated
            // into the direction of travel.
            const fl=Math.sin(nowMs()*0.03 + a.x)*0.5+0.5;
            ctx.globalCompositeOperation='lighter';
            ctx.fillStyle='rgba(255,150,50,'+(0.42+0.26*fl).toFixed(3)+')';
            ctx.beginPath(); ctx.ellipse(-r*stretch*0.95,0,r*(1.15+fl*0.45),r*0.8,0,0,Math.PI*2); ctx.fill();
            ctx.fillStyle='rgba(255,236,164,'+(0.55+0.28*fl).toFixed(3)+')';
            ctx.beginPath(); ctx.arc(0,0,r*(0.52+fl*0.16),0,Math.PI*2); ctx.fill();
            ctx.globalCompositeOperation='source-over';
          }
          ctx.restore();
          continue;
        }
        if(a.deployMine){
          const px=a.x*TILE, py=a.y*TILE;
          a.rot=(a.rot||0)+0.18;
          ctx.save();
          ctx.translate(px,py); ctx.rotate(a.rot);
          const r=TILE*0.20;
          ctx.strokeStyle=a.mineType==='fragmentation'?'#c88945':'#77818a';
          ctx.lineWidth=Math.max(1,TILE*0.05);
          for(let k=0;k<4;k++){
            const ang=k*Math.PI*0.5;
            ctx.beginPath(); ctx.moveTo(Math.cos(ang)*r*0.45,Math.sin(ang)*r*0.45);
            ctx.lineTo(Math.cos(ang)*r*1.24,Math.sin(ang)*r*1.24); ctx.stroke();
          }
          ctx.fillStyle=a.color||'#46505a';
          ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
          ctx.fillStyle=a.headColor||'#ff5b45';
          ctx.beginPath(); ctx.arc(0,0,Math.max(1.2,TILE*0.055),0,Math.PI*2); ctx.fill();
          ctx.restore();
          continue;
        }
        if(a.snowball){
          // toxic snowball: a tumbling sickly-green ball with a faint drip trail
          const px=a.x*TILE, py=a.y*TILE;
          ctx.save();
          ctx.fillStyle='rgba(140,220,110,0.28)';
          ctx.beginPath(); ctx.arc(px-(a.vx||0)*0.012*TILE, py-(a.vy||0)*0.012*TILE, TILE*0.16, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle=a.color||'#8fdd7f';
          ctx.beginPath(); ctx.arc(px, py, TILE*0.20, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle=a.headColor||'#d9ffd0';
          ctx.beginPath(); ctx.arc(px-TILE*0.05, py-TILE*0.06, TILE*0.09, 0, Math.PI*2); ctx.fill();
          ctx.restore();
          continue;
        }
        if(a.harpoon){
          const ang=a.stuck || a.expiring ? a.ang||0 : Math.atan2(a.vy,a.vx);
          if(!a.stuck && !a.expiring) a.ang=ang;
          ctx.save();
          ctx.translate(a.x*TILE,a.y*TILE); ctx.rotate(ang);
          ctx.strokeStyle=a.color||'#718896'; ctx.lineWidth=a.power?4:3;
          ctx.beginPath(); ctx.moveTo(-TILE*0.72,0); ctx.lineTo(TILE*0.38,0); ctx.stroke();
          ctx.fillStyle=a.headColor||'#dcebf2';
          ctx.beginPath();
          ctx.moveTo(TILE*0.64,0); ctx.lineTo(TILE*0.30,-TILE*0.17); ctx.lineTo(TILE*0.38,0);
          ctx.lineTo(TILE*0.30,TILE*0.17); ctx.closePath(); ctx.fill();
          ctx.strokeStyle=a.headColor||'#dcebf2'; ctx.lineWidth=Math.max(1,TILE*0.055);
          ctx.beginPath(); ctx.moveTo(TILE*0.23,0); ctx.lineTo(TILE*0.08,-TILE*0.16);
          ctx.moveTo(TILE*0.23,0); ctx.lineTo(TILE*0.08,TILE*0.16); ctx.stroke();
          ctx.restore();
          continue;
        }
        const ang=a.stuck || a.expiring ? a.ang||0 : Math.atan2(a.vy,a.vx);
        if(!a.stuck && !a.expiring) a.ang=ang;
        ctx.save();
        ctx.translate(a.x*TILE, a.y*TILE); ctx.rotate(ang);
        ctx.strokeStyle=a.power?(a.color||'#f5d66a'):(a.color||'#caa472'); ctx.lineWidth=a.power?3.2:2;
        ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(6,0); ctx.stroke();
        ctx.fillStyle=a.headColor || (a.power?'#fff1a8':'#dfe6f1'); // head
        ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(4,-2.6); ctx.lineTo(4,2.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle='#e8e2d2'; // fletching
        ctx.fillRect(-11,-2.4,4,1.6); ctx.fillRect(-11,0.8,4,1.6);
        if(a.fire){ // burning arrowhead
          const fl=Math.sin(performance.now()*0.03 + a.x)*0.5+0.5;
          ctx.fillStyle='rgba(255,170,50,'+(0.6+0.3*fl)+')';
          ctx.beginPath(); ctx.arc(7,0,3+fl*1.5,0,Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }
    if(arrowFragments.length){
      ctx.save();
      ctx.lineCap='round';
      for(const f of arrowFragments){
        if(!tileVisible(f.x,f.y)) continue;
        const alpha=Math.max(0,Math.min(1,(f.life-f.t)/Math.min(0.3,f.life)));
        ctx.globalAlpha=alpha;
        ctx.save();
        ctx.translate(f.x*TILE,f.y*TILE);
        ctx.rotate(f.ang||0);
        if(f.kind==='head'){
          ctx.fillStyle=f.headColor||'#dfe6f1';
          ctx.beginPath();
          ctx.moveTo(TILE*0.16,0); ctx.lineTo(-TILE*0.10,-TILE*0.11); ctx.lineTo(-TILE*0.10,TILE*0.11);
          ctx.closePath(); ctx.fill();
        } else if(f.kind==='fletch'){
          ctx.fillStyle='#e8e2d2';
          ctx.fillRect(-TILE*0.10,-TILE*0.08,TILE*0.22,TILE*0.16);
        } else {
          ctx.strokeStyle=f.color||'#caa472';
          ctx.lineWidth=Math.max(1.4,TILE*0.08);
          ctx.beginPath(); ctx.moveTo(-TILE*f.len*0.5,0); ctx.lineTo(TILE*f.len*0.5,0); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
    }
    if(puffs.length){
      if(!spriteCache) buildPuffSprites();
      ctx.save();
      let comp='';
      for(const p of puffs){
        if(!tileVisible(p.x,p.y)) continue;
        const smokeFr=Math.max(0,p.life/p.total);
        if(p.kind==='flame' && p.coalSmoke){
          if(comp!=='source-over'){ ctx.globalCompositeOperation='source-over'; comp='source-over'; }
          const smokeSet=spriteCache.coalSmoke;
          const smokeSp=smokeFr>0.62?smokeSet.hot:(smokeFr>0.28?smokeSet.mid:smokeSet.tail);
          const smokeR=TILE*(0.27+(1-smokeFr)*0.48)*(p.scale||1);
          const smokeX=p.x*TILE-(p.vx||0)*TILE*0.018;
          const smokeY=p.y*TILE-smokeR*(0.18+(1-smokeFr)*0.42);
          ctx.globalAlpha=0.48+0.26*(1-smokeFr);
          ctx.drawImage(smokeSp,smokeX-smokeR,smokeY-smokeR,smokeR*2,smokeR*2);
        }
        // flame glows additively; water and gas read better as murky overlays
        const want=p.kind==='flame'? 'lighter':'source-over';
        if(comp!==want){ ctx.globalCompositeOperation=want; comp=want; }
        const fr=Math.max(0, p.life/p.total); // 1 fresh → 0 dying
        const r=p.kind==='flame'
          ? flamePuffRadius(TILE,fr,p.scale||1)
          : TILE*(0.25 + (1-fr)*0.65)*(p.scale||1);
        const set=spriteCache[p.kind]||spriteCache.flame;
        const sp=p.kind==='flame' ? flamePuffFrame(set,fr) : (fr>0.6?set.hot:(fr>0.3?set.mid:set.tail));
        ctx.globalAlpha=p.kind==='flame' ? flamePuffAlpha(fr) : (fr>0.3?1:Math.max(0,fr/0.3));
        ctx.drawImage(sp, p.x*TILE-r, p.y*TILE-r, r*2, r*2);
      }
      ctx.globalAlpha=1;
      ctx.restore();
    }
    if(electricBeams.length){
      const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.lineCap='round';
      ctx.lineJoin='round';
      for(const b of electricBeams){
        const mx=(b.x1+b.x2)*0.5, my=(b.y1+b.y2)*0.5;
        if(!tileVisible(b.x1,b.y1) && !tileVisible(mx,my) && !tileVisible(b.x2,b.y2)) continue;
        const life=Math.max(0.001,b.life||0.18);
        const age=Math.max(0,Math.min(1,(b.t||0)/life));
        const alpha=(1-age)*(b.hit?1.15:1);
        const dx=b.x2-b.x1, dy=b.y2-b.y1, len=Math.hypot(dx,dy)||1;
        const nx=dx/len, ny=dy/len, px=-ny, py=nx;
        const wob=(b.phase||0)+now*0.026;
        function jaggedPath(offsetAmp){
          ctx.beginPath();
          ctx.moveTo(b.x1*TILE,b.y1*TILE);
          const segs=Math.max(3,Math.min(11,Math.ceil(len*1.3)));
          for(let i=1;i<segs;i++){
            const t=i/segs;
            const bend=(Math.sin(wob+i*1.93)+Math.sin(wob*0.67+i*3.11))*0.5*offsetAmp*(1-Math.abs(0.5-t)*0.85);
            const x=(b.x1+nx*len*t+px*bend)*TILE;
            const y=(b.y1+ny*len*t+py*bend)*TILE;
            ctx.lineTo(x,y);
          }
          ctx.lineTo(b.x2*TILE,b.y2*TILE);
        }
        const scale=Math.max(0.75,Math.min(2.5,b.power||1));
        ctx.globalAlpha=Math.min(0.42,0.20*alpha);
        ctx.strokeStyle='#38f7ff';
        ctx.lineWidth=TILE*(0.42+0.12*scale);
        jaggedPath(0.10*scale); ctx.stroke();
        ctx.globalAlpha=Math.min(0.92,0.68*alpha);
        ctx.strokeStyle=b.hit?'#dffcff':'#78eeff';
        ctx.lineWidth=TILE*(0.16+0.035*scale);
        jaggedPath(0.055*scale); ctx.stroke();
        ctx.globalAlpha=Math.min(1,0.98*alpha);
        ctx.strokeStyle='#ffffff';
        ctx.lineWidth=Math.max(1.2,TILE*0.045);
        jaggedPath(0.018*scale); ctx.stroke();
        if(b.hit || b.blocked){
          const r=TILE*(0.22+0.12*scale)*(1+age*0.55);
          ctx.globalAlpha=Math.min(0.85,0.65*alpha);
          ctx.strokeStyle=b.hit?'#f1ffff':'#96f6ff';
          ctx.lineWidth=Math.max(1,TILE*0.06);
          ctx.beginPath(); ctx.arc(b.x2*TILE,b.y2*TILE,r,0,Math.PI*2); ctx.stroke();
        }
      }
      ctx.restore();
    }
    drawStoneHeat(ctx,TILE,tileVisible);
    drawSandHeat(ctx,TILE,tileVisible);
    // Explosion shockwave rings
    if(blastsFx.length){
      ctx.save();
      for(const b of blastsFx){
        if(!tileVisible(b.x,b.y)) continue;
        const fr=b.t/b.max;                 // 0 → 1 over the blast's life
        const r=(0.4+fr*1.6)*b.R*TILE;
        ctx.lineWidth=4*(1-fr)+1;
        ctx.strokeStyle='rgba(255,235,180,'+(0.9*(1-fr)).toFixed(2)+')';
        ctx.beginPath(); ctx.arc(b.x*TILE,b.y*TILE,r,0,Math.PI*2); ctx.stroke();
        ctx.lineWidth=2*(1-fr)+0.5;
        ctx.strokeStyle='rgba(255,120,40,'+(0.7*(1-fr)).toFixed(2)+')';
        ctx.beginPath(); ctx.arc(b.x*TILE,b.y*TILE,r*0.7,0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }
    // Co-op guest swings: the quick sword slash at each struck tile, one arc per
    // fighting body — drawn before the host swing (whose fog guard returns out).
    for(const s of coopSwings){
      if(!(s.t>0) || !tileVisible(s.tx,s.ty)) continue;
      const a=s.t/s.dur;
      const progress=1-a;
      const cx=(s.tx+0.5)*TILE, cy=(s.ty+0.5)*TILE;
      const dir=s.dir<0?-1:1;
      const pulse=Math.max(0,Math.sin(Math.min(1,progress)*Math.PI));
      const alpha=Math.max(0.08,pulse);
      const base=dir===1?-0.8:Math.PI+0.8;
      const sweep=progress*1.9*dir;
      ctx.save();
      ctx.lineCap='round';
      ctx.strokeStyle='rgba(255,255,255,'+(0.75*alpha).toFixed(2)+')';
      ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(cx,cy,TILE*0.78,base-0.6+sweep,base+0.25+sweep); ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,'+(0.4*alpha).toFixed(2)+')';
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(cx,cy,TILE*0.52,base-0.5+sweep,base+0.18+sweep); ctx.stroke();
      ctx.restore();
    }
    // Weapon-specific melee read at the struck tile: spears leave a straight
    // puncture trail, axes carve a heavy crescent, swords keep the quick slash.
    if(swing.t>0){
      if(!tileVisible(swing.tx,swing.ty)) return;
      const a=swing.t/swing.dur;
      const progress=1-a, form=swing.form||'sword';
      const cx=(swing.tx+0.5)*TILE, cy=(swing.ty+0.5)*TILE;
      const dir=swing.dir<0?-1:1;
      const pulse=Math.max(0,Math.sin(Math.min(1,progress)*Math.PI));
      const alpha=Math.max(0.08,pulse);
      const held=equippedWeapon(), prestige=weaponPrestigeRank(held);
      ctx.save();
      ctx.lineCap='round';
      if(form==='spear'||form==='trident'){
        // The held spear now carries the full thrust animation. Do not draw the
        // old detached white arrow glyph on the target tile.
      }else{
        const axe=form==='axe';
        const base=dir===1?(axe?-1.2:-0.8):(axe?Math.PI+1.2:Math.PI+0.8);
        const sweep=progress*(axe?2.65:1.9)*dir;
        ctx.strokeStyle='rgba(255,255,255,'+((axe?0.88:0.75)*alpha).toFixed(2)+')';
        ctx.lineWidth=axe?Math.max(4,TILE*0.2):3;
        ctx.beginPath(); ctx.arc(cx,cy,TILE*(axe?0.9:0.78),base-(axe?0.82:0.6)+sweep,base+(axe?0.38:0.25)+sweep); ctx.stroke();
        ctx.strokeStyle='rgba(255,255,255,'+((axe?0.5:0.4)*alpha).toFixed(2)+')';
        ctx.lineWidth=axe?Math.max(2,TILE*0.085):1.5;
        ctx.beginPath(); ctx.arc(cx,cy,TILE*(axe?0.62:0.52),base-(axe?0.7:0.5)+sweep,base+(axe?0.3:0.18)+sweep); ctx.stroke();
      }
      if(prestige>=2 && form!=='spear' && form!=='trident'){
        const col=weaponPrestigeColor(held);
        ctx.globalCompositeOperation='lighter';
        ctx.shadowColor=col; ctx.shadowBlur=prestige===4?14:8;
        ctx.strokeStyle=col; ctx.lineCap='round';
        ctx.globalAlpha=Math.min(1,alpha*(0.28+prestige*0.05));
        if(form==='spear'||form==='trident'){
          ctx.lineWidth=Math.max(1,prestige===4?4:2.4);
          ctx.beginPath(); ctx.moveTo(cx-dir*TILE*0.92,cy); ctx.lineTo(cx+dir*TILE*(0.5+0.28*pulse),cy); ctx.stroke();
        }else{
          const axe=form==='axe', base=dir===1?(axe?-1.2:-0.8):(axe?Math.PI+1.2:Math.PI+0.8);
          const sweep=progress*(axe?2.65:1.9)*dir;
          for(let i=0;i<prestige-1;i++){
            ctx.lineWidth=Math.max(1,(prestige===4?4.2:2.8)-i*0.7);
            ctx.beginPath();
            ctx.arc(cx,cy,TILE*((axe?0.95:0.83)+i*0.09),base-(axe?0.9:0.72)+sweep-i*0.08,base+(axe?0.46:0.34)+sweep-i*0.04);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
    // gravity channel: a violet tether from the hero to the gripped tile and a
    // rising fill on the tile itself — the extraction progress, readable in
    // the world exactly where the player is looking
    if(grav.channel){
      const p=(typeof window!=='undefined' && window.player)||null;
      if(p){
        const c=grav.channel, ratio=gravChannelRatio();
        const gx=(c.tx+0.5)*TILE, gy=(c.ty+0.5)*TILE;
        const wob=Math.sin(nowMs()*0.02)*1.2;
        ctx.save();
        ctx.strokeStyle='rgba(180,140,255,0.55)';
        ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(p.x*TILE,(p.y-0.1)*TILE);
        ctx.quadraticCurveTo((p.x*TILE+gx)/2,(p.y*TILE+gy)/2+wob,gx,gy);
        ctx.stroke();
        ctx.fillStyle='rgba(180,140,255,0.22)';
        ctx.fillRect(c.tx*TILE, c.ty*TILE+(1-ratio)*TILE, TILE, ratio*TILE);
        ctx.strokeStyle='rgba(220,200,255,0.8)';
        ctx.lineWidth=1;
        ctx.strokeRect(c.tx*TILE+0.5, c.ty*TILE+0.5, TILE-1, TILE-1);
        ctx.restore();
      }
    }
  }
  function drawHeldAquaticFx(ctx,TILE,it,facing,player){
    const style=aquaticStyle(it);
    if(!style) return;
    const submerged=heroSubmersion(player);
    if(submerged<0.28) return;
    const now=nowMs()*0.001, seed=weaponVisualSeed(it)*Math.PI*2;
    const s=Math.max(0.7,TILE/20), col=weaponMaterialProfile(it).glow;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=Math.max(0.75,s*0.8);
    for(let i=0;i<4;i++){
      const phase=(now*(0.42+i*0.08)+seed+i*0.23)%1;
      const bx=facing*(4.5+i*2.1)*s+Math.sin(now*1.8+seed+i)*1.4*s;
      const by=(-2.5-phase*13-i*0.7)*s;
      ctx.globalAlpha=(0.12+submerged*0.24)*(1-phase);
      ctx.beginPath(); ctx.arc(bx,by,(0.65+(i%2)*0.45)*s,0,Math.PI*2); ctx.stroke();
    }
    ctx.globalAlpha=0.10+submerged*0.13;
    for(let i=0;i<2;i++){
      const sweep=now*(0.65+i*0.17)+seed+i*2.4;
      ctx.beginPath();
      ctx.arc(facing*4*s,-4*s,(8+i*3)*s,sweep,sweep+0.72);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawHeldChargeFx(ctx,TILE,it,facing){
    const bowRatio=weaponType(it)==='bow'&&bowCharge.active?bowChargeRatio():0;
    const spearActive=isChargeableSpear(it)&&spearCharge.active;
    const spearRatio=spearActive?spearChargeRatio():0;
    const rank=weaponPrestigeRank(it);
    const ultRatio=rank>=3&&ultCharge>0.72?clamp01((ultCharge-0.72)/0.28):0;
    // While a bow is being drawn its physical tension is the only progress
    // shown; a ready ultimate must not make a freshly nocked arrow look full.
    const charge=spearActive?spearRatio:(bowCharge.active?bowRatio:ultRatio);
    if(charge<=0.015) return;
    const now=nowMs()*0.001, seed=weaponVisualSeed(it)*Math.PI*2;
    const s=Math.max(0.7,TILE/20), mat=weaponMaterialProfile(it);
    const col=rank>=2?weaponPrestigeColor(it):mat.glow;
    const full=spearActive?spearCharge.full:(bowCharge.active?bowRatio>=0.999:ultRatio>=0.999);
    if(spearActive){
      // The glow climbs the shaft as force builds. At full charge the point locks
      // into a bright cross, while the held pose itself pulls farther backwards.
      const baseY=3*s, tipY=-21*s, chargedY=baseY+(tipY-baseY)*charge;
      const pulse=full?0.78+0.22*Math.sin(now*6.2+seed):1;
      ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.lineCap='round';
      ctx.strokeStyle=col; ctx.fillStyle=full?'#ffffff':col; ctx.shadowColor=col;
      ctx.shadowBlur=(2+charge*(rank>=3?9:6))*s;
      ctx.globalAlpha=(0.18+charge*0.42)*pulse;
      ctx.lineWidth=Math.max(0.9,(0.85+charge*0.85)*s);
      ctx.beginPath(); ctx.moveTo(0,baseY); ctx.lineTo(0,chargedY); ctx.stroke();
      const motes=1+Math.floor(charge*4.2);
      for(let i=0;i<motes;i++){
        const y=baseY-(baseY-tipY)*((i+1)/(motes+1))*charge;
        const side=(i%2?1:-1)*(1.5+charge*2.2)*s;
        ctx.globalAlpha=(0.15+charge*0.34)*pulse;
        ctx.fillRect(side-0.55*s,y-0.55*s,1.1*s,1.1*s);
      }
      if(full){
        const d=3.2*s; ctx.globalAlpha=0.72*pulse; ctx.lineWidth=Math.max(0.8,1.05*s);
        ctx.beginPath(); ctx.moveTo(0,tipY-d); ctx.lineTo(0,tipY+d); ctx.moveTo(-d,tipY); ctx.lineTo(d,tipY); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if(!bowCharge.active){
      // A ready high-tier technique should read on the item, not as a second
      // orbiting aura around the hero. Keep one jewel pulse at the weapon focus.
      const focus=heldPrestigeFocus(it,facing), cx=focus.x*s, cy=focus.y*s;
      const pulse=full?0.82+0.18*Math.sin(now*3.8+seed):1;
      ctx.save(); ctx.globalCompositeOperation='lighter';
      ctx.fillStyle=full?'#ffffff':col; ctx.strokeStyle=col; ctx.shadowColor=col;
      ctx.shadowBlur=(2.2+charge*2.2)*s;
      ctx.globalAlpha=(0.10+charge*0.18)*pulse;
      ctx.beginPath(); ctx.arc(cx,cy,(0.46+charge*0.42)*s,0,Math.PI*2); ctx.fill();
      if(full){
        const d=1.7*s;
        ctx.globalAlpha=0.24*pulse; ctx.lineWidth=Math.max(0.6,0.7*s);
        ctx.beginPath(); ctx.moveTo(cx,cy-d); ctx.lineTo(cx+d,cy); ctx.lineTo(cx,cy+d); ctx.lineTo(cx-d,cy); ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const cx=facing*(weaponType(it)==='bow'?2.5:3.8)*s, cy=-3.2*s;
    const pulse=full?0.78+0.22*Math.sin(now*4.2+seed):1;
    ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.strokeStyle=col; ctx.fillStyle=col; ctx.shadowColor=col;
    ctx.shadowBlur=(3+charge*(rank>=3?8:5))*s; ctx.lineCap='round';
    const rings=1+Math.floor(charge*2.99);
    for(let i=0;i<rings;i++){
      const r=(4.6+i*2.5-charge*0.8)*s;
      const spin=now*(0.36+i*0.14)*(i%2?-1:1)+seed+i*1.7;
      ctx.globalAlpha=(0.10+charge*(full?0.27:0.17))*pulse*(1-i*0.13);
      ctx.lineWidth=Math.max(0.7,(0.75+charge*0.45)*s);
      ctx.beginPath(); ctx.arc(cx,cy,r,spin,spin+Math.PI*(0.42+charge*0.58)); ctx.stroke();
    }
    const motes=1+Math.floor(charge*4.2);
    for(let i=0;i<motes;i++){
      const a=seed+i*Math.PI*2/motes+now*(i%2?0.72:-0.54);
      const r=(4.5+(i%3)*1.8)*(1-charge*0.16)*s;
      ctx.globalAlpha=(0.16+charge*0.36)*pulse;
      ctx.beginPath(); ctx.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,(0.45+charge*0.48)*s,0,Math.PI*2); ctx.fill();
    }
    if(full){
      ctx.globalAlpha=0.68*pulse; ctx.strokeStyle=rank===4?'#ffffff':col; ctx.lineWidth=Math.max(0.8,s);
      const d=2.4*s;
      ctx.beginPath(); ctx.moveTo(cx,cy-d); ctx.lineTo(cx+d,cy); ctx.lineTo(cx,cy+d); ctx.lineTo(cx-d,cy); ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  }
  function drawHeldActionFx(ctx,TILE,it,facing,player,action){
    if(!action || !action.active) return;
    const type=weaponType(it), kind=action.kind||type;
    const s=Math.max(0.7,TILE/20), power=Math.max(0.4,action.power||1);
    const alpha=Math.min(1,action.flash*(0.55+power*0.24));
    const mat=weaponMaterialProfile(it), prestige=weaponPrestigeRank(it);
    const col=prestige>=2?weaponPrestigeColor(it):mat.glow;
    const muzzle=(kind==='harpoon'?16:(kind==='bow'||kind==='crossbow'?10:8))*s*facing;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=alpha;
    ctx.strokeStyle=col; ctx.fillStyle=col; ctx.shadowColor=col;
    ctx.shadowBlur=(4+prestige*2.2)*s; ctx.lineWidth=Math.max(0.9,(0.9+power*0.45)*s);
    if(kind==='melee'){
      const form=meleeVisualForm(it), tip=(form==='spear'||form==='trident'?-20:form==='axe'?-13:-17)*s;
      ctx.beginPath(); ctx.moveTo(-3.5*s,tip+2*s); ctx.lineTo(0,tip-3*s); ctx.lineTo(3.5*s,tip+2*s); ctx.stroke();
      if(prestige>=3){ ctx.globalAlpha*=0.7; ctx.beginPath(); ctx.arc(0,tip,5.5*s,-2.8,-0.35); ctx.stroke(); }
    }else if(kind==='bow'||kind==='crossbow'){
      ctx.beginPath(); ctx.arc(muzzle,-2*s,(3.5+power*1.8)*s,-1.05,1.05); ctx.stroke();
      ctx.globalAlpha*=0.72; ctx.beginPath(); ctx.moveTo(muzzle,-2*s); ctx.lineTo(muzzle+facing*(7+power*3)*s,-2*s); ctx.stroke();
    }else if(kind==='harpoon'){
      ctx.beginPath(); ctx.moveTo(muzzle,-2.8*s); ctx.lineTo(muzzle+facing*(8+power*3)*s,-5.2*s);
      ctx.moveTo(muzzle,-2.8*s); ctx.lineTo(muzzle+facing*(8+power*3)*s,-0.4*s); ctx.stroke();
      for(let i=0;i<3;i++){
        ctx.globalAlpha=alpha*(0.62-i*0.12);
        ctx.beginPath(); ctx.arc(muzzle-facing*(2+i*2.4)*s,(-5.5-i*1.5)*s,(0.8+i*0.2)*s,0,Math.PI*2); ctx.stroke();
      }
    }else if(kind==='electric'){
      ctx.beginPath(); ctx.moveTo(muzzle,-2.6*s); ctx.lineTo(muzzle+facing*3*s,-5*s);
      ctx.lineTo(muzzle+facing*6*s,-1*s); ctx.lineTo(muzzle+facing*10*s,-3*s); ctx.stroke();
      ctx.globalAlpha*=0.65; ctx.beginPath(); ctx.arc(muzzle,-2.6*s,(3+power)*s,0,Math.PI*2); ctx.stroke();
    }else if(kind==='flame'){
      ctx.fillStyle=prestige>=2?col:'#ffad42';
      ctx.beginPath(); ctx.moveTo(muzzle,-4*s); ctx.lineTo(muzzle+facing*(8+power*4)*s,-2.6*s);
      ctx.lineTo(muzzle,-1*s); ctx.closePath(); ctx.fill();
      ctx.globalAlpha*=0.78; ctx.fillStyle='#fff1b2'; ctx.beginPath(); ctx.arc(muzzle+facing*2*s,-2.6*s,1.4*s,0,Math.PI*2); ctx.fill();
    }else if(kind==='hose'){
      ctx.strokeStyle=prestige>=2?col:'#92e7ff';
      ctx.beginPath(); ctx.moveTo(muzzle,-2.6*s); ctx.lineTo(muzzle+facing*(11+power*4)*s,-2.6*s); ctx.stroke();
      for(let i=0;i<3;i++){ ctx.globalAlpha=alpha*(0.72-i*0.14); ctx.beginPath(); ctx.arc(muzzle+facing*(4+i*4)*s,(-3+i%2)*s,(0.8+i*0.2)*s,0,Math.PI*2); ctx.fill(); }
    }else if(kind==='gas'){
      for(let i=0;i<4;i++){
        ctx.globalAlpha=alpha*(0.66-i*0.10); ctx.beginPath();
        ctx.arc(muzzle+facing*(2+i*2.8)*s,(-2.8+Math.sin(i*2.1+action.serial)*2.1)*s,(1.7+i*0.35)*s,0,Math.PI*2); ctx.fill();
      }
    }else if(kind==='thrown'){
      ctx.beginPath(); ctx.arc(facing*3*s,-6*s,(5+power*2)*s,facing>0?-2.5:-0.65,facing>0?-0.5:-2.65); ctx.stroke();
      ctx.beginPath(); ctx.arc(facing*9*s,-8*s,1.5*s,0,Math.PI*2); ctx.fill();
    }else if(kind==='bouncy'){
      // a short compressed-air pop, not a flame: one ring plus the leaving ball
      ctx.strokeStyle=BOUNCY_HIGHLIGHT; ctx.fillStyle=BOUNCY_COLOR;
      ctx.beginPath(); ctx.arc(muzzle,-2.6*s,(2.2+power*1.4)*s,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha*=0.85;
      ctx.beginPath(); ctx.arc(muzzle+facing*(4+power*2.5)*s,-2.6*s,1.5*s,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
    drawHeldAquaticFx(ctx,TILE,it,facing,player);
  }
  // The equipped weapon in the hero's hand (world space, called after drawPlayer).
  // Melee blades sweep forward during a swing so hits read on the character too.
  function drawHeld(ctx,TILE,player){
    const it=equippedWeapon(); if(!it) return;
    const type=weaponType(it);
    const heldThrownSpec=type==='thrown' ? thrownSpec(it) : null;
    // Selecting a throw technique equips the technique, not an imaginary piece
    // of ammo. Keep the hand empty until its matching inventory resource exists.
    if(type==='thrown' && (!heldThrownSpec || resourceCount(heldThrownSpec.key)<=0)) return;
    const facing=(player.facing>=0)?1:-1;
    const bw=player.w*TILE, bh=player.h*TILE;
    const col=tierColor(it);
    const material=weaponMaterialProfile(it);
    const action=heldActionState();
    const idleNow=nowMs()*0.001, idleSeed=weaponVisualSeed(it)*Math.PI*2;
    const idleBob=Math.sin(idleNow*2.05+idleSeed)*Math.min(0.7,TILE*0.025);
    const idleSway=Math.sin(idleNow*1.35+idleSeed*0.7)*0.018;
    ctx.save();
    ctx.translate(player.x*TILE + facing*(bw*0.5+1), player.y*TILE + bh*0.10);
    ctx.translate(-facing*action.kick*(1.2+action.power*1.5),idleBob+action.kick*0.45);
    ctx.rotate(facing*(idleSway-action.kick*0.045));
    if(type==='melee'){
      const prog= swing.t>0? 1-swing.t/swing.dur : 0;
      const form=meleeVisualForm(it);
      const spearDraw=form==='spear'&&spearCharge.active?spearChargeRatio():0;
      if(swing.t>0){
        const pose=meleeAttackPose(swing.form||form,prog,facing);
        const thrustScale=(swing.form==='spear')?1+(swing.charge||0)*0.20:1;
        ctx.translate(pose.forward*thrustScale,pose.lift);
        ctx.rotate(pose.angle);
      }else if(spearDraw>0){
        const tension=spearDraw*spearDraw;
        const tremor=tension>0.5?Math.sin(nowMs()*0.055)*(tension-0.5)*1.3:0;
        ctx.translate(-facing*(2+spearDraw*7),-spearDraw*1.2+tremor);
        ctx.rotate(facing*(Math.PI*0.5-0.06));
      }else ctx.rotate(facing*-0.5);
      drawHeldPrestigeBack(ctx,TILE,it,facing);
      const prestige=weaponPrestigeRank(it);
      const metal=it.meleeEffect==='panic'?'#75efff':it.meleeEffect==='stun'?'#aab0b8':material.edge;
      if(form==='trident'){
        ctx.fillStyle=material.body; ctx.fillRect(-1,-16,2,19);
        drawBladeSheen(ctx,material,-1,-16,2,19); // the shaft is the metal here
        ctx.fillStyle=col||material.accent;
        ctx.fillRect(-1,-18,2,4); ctx.fillRect(-5,-17,2,5); ctx.fillRect(3,-17,2,5);
        ctx.fillRect(-5,-17,10,1.5);
        ctx.fillStyle=material.dark; ctx.fillRect(-1,3,2,4);
        if(prestige>=3){
          ctx.fillStyle=prestige===4?'#f4ffff':'#bff8ff';
          ctx.fillRect(-6,-18,2,2); ctx.fillRect(4,-18,2,2); ctx.fillRect(-1.5,-20,3,2);
        }
      }else if(form==='spear'){
        ctx.fillStyle=material.grip; ctx.fillRect(-1,-17,2,22);
        ctx.fillStyle=metal;
        ctx.beginPath(); ctx.moveTo(0,-22); ctx.lineTo(-3.4,-15); ctx.lineTo(0,-12.5); ctx.lineTo(3.4,-15); ctx.closePath(); ctx.fill();
        ctx.fillStyle=col||material.accent; ctx.fillRect(-2.4,-13.2,4.8,1.7);
        if(prestige>=3){
          ctx.beginPath(); ctx.moveTo(-2,-15); ctx.lineTo(-6,-12); ctx.lineTo(-2,-11); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(2,-15); ctx.lineTo(6,-12); ctx.lineTo(2,-11); ctx.closePath(); ctx.fill();
        }
      }else if(form==='axe'){
        ctx.fillStyle=material.grip; ctx.fillRect(-1.2,-9,2.4,16);
        ctx.fillStyle=metal;
        ctx.beginPath(); ctx.moveTo(-1,-12); ctx.lineTo(-8,-14); ctx.lineTo(-9,-7); ctx.lineTo(-3,-4); ctx.lineTo(0,-7); ctx.closePath(); ctx.fill();
        if(prestige>=3){
          ctx.beginPath(); ctx.moveTo(1,-12); ctx.lineTo(8,-13); ctx.lineTo(9,-6); ctx.lineTo(3,-4); ctx.lineTo(0,-7); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle=col||'#8f9aa6'; ctx.fillRect(-2.1,-8.5,4.2,2.2);
      }else if(form==='club'){
        ctx.fillStyle=material.grip; ctx.fillRect(-1.2,-5,2.4,12);
        ctx.fillStyle=col||material.body;
        ctx.beginPath(); ctx.moveTo(-2,-16); ctx.lineTo(3,-15); ctx.lineTo(4,-7); ctx.lineTo(1,-3); ctx.lineTo(-3,-5); ctx.lineTo(-4,-12); ctx.closePath(); ctx.fill();
        if(prestige>=3){
          ctx.fillStyle=metal;
          ctx.fillRect(-6,-13,3,1.6); ctx.fillRect(3,-10,3,1.6); ctx.fillRect(-5,-7,3,1.6);
        }
      }else{
        const bladeLen=prestige===4?17:prestige===3?15:14;
        ctx.fillStyle=metal; ctx.fillRect(-1.2,-bladeLen,2.4,bladeLen);
        ctx.beginPath(); ctx.moveTo(-1.2,-bladeLen); ctx.lineTo(0,-bladeLen-3.5); ctx.lineTo(1.2,-bladeLen); ctx.closePath(); ctx.fill();
        drawBladeSheen(ctx,material,-1.2,-bladeLen,2.4,bladeLen); // rectangular blade body
        ctx.fillStyle=col||material.accent; ctx.fillRect(-2.6,0,5.2,1.6);
        ctx.fillStyle=material.grip; ctx.fillRect(-0.9,1.6,1.8,3.4);
        if(prestige>=3){
          ctx.fillStyle=prestige===4?'#ffffff':(col||'#ffd45c');
          ctx.fillRect(-0.35,-bladeLen+4,0.7,5.5);
          ctx.fillRect(-4.2,-0.8,8.4,0.8);
        }
      }
    } else if(type==='bow'){
      drawHeldPrestigeBack(ctx,TILE,it,facing);
      const draw=bowCharge.active ? bowChargeRatio() : 0;
      const full=draw>=0.999;
      const pulse=full ? (0.72+0.28*Math.sin(nowMs()*0.018)) : 0;
      const prestige=weaponPrestigeRank(it);
      if(aquaticStyle(it)==='crossbow'){
        ctx.fillStyle=material.body; ctx.fillRect(facing===1?-4:-9,-4,13,3.5);
        ctx.fillStyle=col||material.accent; ctx.fillRect(facing===1?4:-8,-5,5,5.5);
        ctx.fillStyle=material.grip; ctx.fillRect(-1,-1,2.5,4);
      }
      ctx.strokeStyle=full ? '#f5d66a' : (col||'#9a6a32'); ctx.lineWidth=1.6+draw*0.5; ctx.lineCap='round';
      const a0=facing===1? -1.15 : Math.PI-1.15, a1=facing===1? 1.15 : Math.PI+1.15;
      ctx.beginPath(); ctx.arc(0,-2,6,a0,a1); ctx.stroke();
      if(prestige>=3){
        ctx.fillStyle=prestige===4?'#ffffff':(col||'#ffd45c');
        ctx.beginPath(); ctx.arc(0,-2,prestige===4?1.7:1.2,0,Math.PI*2); ctx.fill();
        ctx.fillRect(facing===1?1.8:-3.8,-8,2,2); ctx.fillRect(facing===1?1.8:-3.8,2,2,2);
      }
      if(full){
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        ctx.strokeStyle='rgba(255,236,150,'+(0.38+0.22*pulse).toFixed(3)+')';
        ctx.lineWidth=4;
        ctx.beginPath(); ctx.arc(0,-2,7.5,a0,a1); ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle=full?'#fff1a8':'#e8e2d2'; ctx.lineWidth=0.8+draw*0.7;
      const ex=Math.cos(1.15)*6*facing, ey=Math.sin(1.15)*6;
      const pull=-facing*(1.2+draw*7.2);
      ctx.beginPath(); ctx.moveTo(ex,-2-ey); ctx.lineTo(pull,-2); ctx.lineTo(ex,-2+ey); ctx.stroke();
      // wind readout while aiming: arrows really drift with the wind, so show it
      if(draw>0.05){
        let windSp=0;
        try{ if(MM.wind && typeof MM.wind.speed==='function') windSp=Number(MM.wind.speed())||0; }catch(e){}
        if(Math.abs(windSp)>=0.25){
          const wlen=Math.max(3,Math.min(14,Math.abs(windSp)*3.2));
          const wdir=windSp>=0?1:-1;
          const wy=-14;
          ctx.save();
          ctx.globalAlpha=0.85;
          ctx.strokeStyle=Math.abs(windSp)>3.5?'#ffb84a':'#bfe3ff';
          ctx.lineWidth=1.4;
          ctx.beginPath(); ctx.moveTo(-wdir*wlen*0.5,wy); ctx.lineTo(wdir*wlen*0.5,wy); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(wdir*wlen*0.5,wy);
          ctx.lineTo(wdir*(wlen*0.5-3),wy-2.4);
          ctx.moveTo(wdir*wlen*0.5,wy);
          ctx.lineTo(wdir*(wlen*0.5-3),wy+2.4);
          ctx.stroke();
          ctx.restore();
        }
      }
      if(draw>0.03){
        ctx.strokeStyle=full?'#fff7c7':'#dfe6f1';
        ctx.lineWidth=1.2+draw*0.6;
        ctx.beginPath(); ctx.moveTo(pull,-2); ctx.lineTo(facing*(7.4+draw*1.4),-2); ctx.stroke();
        ctx.fillStyle=full?'#fff1a8':'#dfe6f1';
        ctx.beginPath();
        ctx.moveTo(facing*(8.8+draw*1.4),-2);
        ctx.lineTo(facing*(5.9+draw*1.1),-4.2);
        ctx.lineTo(facing*(5.9+draw*1.1),0.2);
        ctx.closePath(); ctx.fill();
      }
    } else if(type==='harpoon'){
      drawHeldPrestigeBack(ctx,TILE,it,facing);
      const prestige=weaponPrestigeRank(it);
      ctx.fillStyle=material.dark; ctx.fillRect(facing===1?-4:-9,-5,13,4);
      ctx.fillStyle=col||material.accent; ctx.fillRect(facing===1?5:-9,-4.5,4,3);
      ctx.fillStyle=material.body; ctx.fillRect(facing===1?8:-14,-3.5,6,1.5);
      ctx.fillStyle=material.edge;
      ctx.beginPath();
      if(facing===1){ ctx.moveTo(16,-2.8); ctx.lineTo(12,-5); ctx.lineTo(12,-0.6); }
      else { ctx.moveTo(-16,-2.8); ctx.lineTo(-12,-5); ctx.lineTo(-12,-0.6); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle=material.grip; ctx.fillRect(facing===1?-1:-3,-1,3,4);
      if(prestige>=3){
        ctx.fillStyle=prestige===4?'#ffffff':(col||'#72e7ff');
        ctx.beginPath(); ctx.arc(facing===1?3:-3,-3,prestige===4?1.5:1.1,0,Math.PI*2); ctx.fill();
        ctx.fillRect(facing===1?8:-10,-6,2,2); ctx.fillRect(facing===1?8:-10,-1,2,2);
      }
    } else if(type==='thrown'){
      // a throw-ready projectile bobbing in the raised hand
      const spec=heldThrownSpec;
      const bob=Math.sin(nowMs()*0.006)*0.8;
      ctx.translate(facing*1.5, -4+bob);
      drawHeldPrestigeBack(ctx,TILE,it,facing);
      if(spec && spec.visual==='sand'){
        for(let g=0;g<6;g++){
          const sz=0.8+(g%2)*0.35;
          ctx.fillStyle=g%3===0?(spec.head||'#f0dc9b'):(spec.color||'#c7aa68');
          ctx.fillRect(-2.8+(g%3)*2.1,-1.3+Math.floor(g/3)*2.0,sz,sz);
        }
      }else if(spec && spec.visual==='spit'){
        ctx.globalAlpha=0.88;
        ctx.fillStyle=spec.color||'#cfe9df';
        ctx.beginPath(); ctx.arc(0,0,1.8,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=spec.head||'#f5fff8';
        ctx.beginPath(); ctx.arc(-0.5,-0.6,0.65,0,Math.PI*2); ctx.fill();
        ctx.globalAlpha=1;
      }else if(spec && spec.rock){
        ctx.fillStyle=(spec && spec.color)||'#9aa0a8';
        ctx.beginPath();
        ctx.moveTo(-3.4,-2.2); ctx.lineTo(2.4,-3.2); ctx.lineTo(4,1); ctx.lineTo(0.8,3.2); ctx.lineTo(-3.4,1.6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle=(spec && spec.head)||'#c9ced6'; ctx.fillRect(-1,-1.6,1.8,1.4);
      }else{
        ctx.fillStyle=(spec && spec.color)||'#eef7ff';
        ctx.beginPath(); ctx.arc(0,0,3.4,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=(spec && spec.head)||'#ffffff';
        ctx.beginPath(); ctx.arc(-1,-1.1,1.5,0,Math.PI*2); ctx.fill();
      }
    } else {
      // stream device: body + nozzle tinted by class, with a faint idle wisp
      drawHeldPrestigeBack(ctx,TILE,it,facing);
      const tint= type==='flame'? '#b35324' : type==='hose'? '#2c7ef8' : type==='electric'? '#53e9ff' : type==='bouncy'? BOUNCY_COLOR : '#4d9230';
      const prestige=weaponPrestigeRank(it);
      ctx.fillStyle=material.dark; ctx.fillRect(facing===1?-2:-4.5, -4, 6.5, 3);
      ctx.fillStyle=col||tint; ctx.fillRect(facing===1?4.5:-6.5, -3.7, 2.2, 2.4);
      ctx.fillStyle=material.grip; ctx.fillRect(facing===1?-0.5:-1.5, -1, 2, 3.4);
      if(type==='flame'){
        ctx.fillStyle='#7b3d22'; ctx.beginPath(); ctx.arc(facing===1?-2.8:2.8,-2.4,2.2,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#ff9b35'; ctx.fillRect(facing===1?6.5:-8.5,-4.2,1.2,3.4);
      }else if(type==='hose'){
        ctx.strokeStyle='#9fe6ff'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.arc(facing===1?-2.5:2.5,-2.5,2.2,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle='#4db6ff'; ctx.fillRect(facing===1?6.5:-8.5,-3.8,2,2.6);
      }else if(type==='gas'){
        ctx.fillStyle='#8fd35d'; ctx.beginPath(); ctx.arc(facing===1?-2.6:2.6,-2.5,2,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#d8ffb0'; ctx.fillRect(facing===1?-3.3:1.9,-3.5,1.2,1.2);
      }else if(type==='electric'){
        ctx.strokeStyle='#8ffaff'; ctx.lineWidth=1;
        for(let i=0;i<3;i++){ const x=(facing===1?0.4+i*1.7:-0.4-i*1.7); ctx.beginPath(); ctx.arc(x,-2.5,1.1,0,Math.PI*2); ctx.stroke(); }
      }else if(type==='bouncy'){
        // a stubby pistol: short slide, a drum of balls under the barrel tinted
        // by the ammo it is loaded with (red rubber vs black tar)
        const bspec=bouncySpec(it);
        ctx.fillStyle=material.body; ctx.fillRect(facing===1?-1:-5.5, -3.2, 6.5, 1.6);
        ctx.fillStyle=bspec.color;
        ctx.beginPath(); ctx.arc(facing===1?-2.4:2.4,-1.2,1.5,0,Math.PI*2); ctx.fill();
        ctx.fillStyle=bspec.head;
        ctx.beginPath(); ctx.arc(facing===1?-2.8:2.0,-1.7,0.55,0,Math.PI*2); ctx.fill();
      }else if(type==='gravity'){
        // gravity emitter: a coil ring around the barrel and a violet field arc;
        // the held BLOCK floats ahead of the muzzle, slowly turning — the whole
        // weapon readout is "what am I about to throw"
        ctx.strokeStyle='#b48cff'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.arc(facing===1?2.6:-2.6,-2.6,2.1,0,Math.PI*2); ctx.stroke();
        ctx.strokeStyle='rgba(180,140,255,0.45)';
        ctx.beginPath(); ctx.arc(facing===1?2.6:-2.6,-2.6,3.1,-0.7,0.7); ctx.stroke();
        if(grav.heldTid){
          const info=INFO[grav.heldTid]||{};
          // The held block is the same block it will be in flight and the same
          // block it was in the ground — one tile, all the way through. The stand-
          // off is measured from the hero, not scaled off s, or a full-size block
          // would drift a tile and a half out of the hand.
          const s=TILE;
          const off=TILE*0.9;
          const hover=Math.sin(nowMs()*0.004)*1.4;
          ctx.save();
          ctx.translate(facing===1?off:-off, -3+hover);
          ctx.rotate(nowMs()*0.0011*facing);
          ctx.fillStyle='rgba(180,140,255,0.22)';
          ctx.beginPath(); ctx.arc(0,0,s*0.62,0,Math.PI*2); ctx.fill();
          ctx.fillStyle=info.color||'#9aa0a8';
          ctx.fillRect(-s/2,-s/2,s,s);
          ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1;
          ctx.strokeRect(-s/2,-s/2,s,s);
          ctx.restore();
        }
      }
      if(prestige>=3){
        ctx.fillStyle=prestige===4?'#ffffff':(col||tint);
        ctx.beginPath(); ctx.arc(facing===1?2.5:-2.5,-2.5,prestige===4?1.35:0.95,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=0.5;
      ctx.fillStyle=tint;
      ctx.fillRect(facing===1?7:-9, -3.4, 2, 1.8);
      ctx.globalAlpha=1;
    }
    drawHeldChargeFx(ctx,TILE,it,facing);
    drawHeldActionFx(ctx,TILE,it,facing,player,action);
    if(!action.active) drawHeldAquaticFx(ctx,TILE,it,facing,player);
    drawHeldPrestigeFront(ctx,TILE,it,facing);
    ctx.restore();
  }
  // Baked radial sprites per stream kind: a per-puff createRadialGradient at up to
  // 220 puffs × 60fps caused constant allocation churn — stamp these instead.
  let spriteCache=null;
  function buildPuffSprites(){
    function mk(stops){
      const S=32, c=document.createElement('canvas'); c.width=c.height=S*2;
      const g=c.getContext('2d');
      const gr=g.createRadialGradient(S,S,1,S,S,S);
      stops.forEach(([t,col])=>gr.addColorStop(t,col));
      g.fillStyle=gr; g.beginPath(); g.arc(S,S,S,0,Math.PI*2); g.fill();
      return c;
    }
    spriteCache={
      flame:getFlamePuffSprites(),
      coalSmoke:{
        hot:  mk([[0,'rgba(12,11,10,0.78)'],[0.52,'rgba(34,31,28,0.58)'],[1,'rgba(48,44,40,0)']]),
        mid:  mk([[0,'rgba(18,17,16,0.68)'],[0.58,'rgba(46,43,40,0.46)'],[1,'rgba(62,58,54,0)']]),
        tail: mk([[0,'rgba(28,27,26,0.50)'],[0.62,'rgba(66,63,60,0.32)'],[1,'rgba(80,77,73,0)']])
      },
      hose:{
        hot:  mk([[0,'rgba(225,245,255,0.9)'],[0.5,'rgba(140,195,255,0.6)'],[1,'rgba(60,120,230,0)']]),
        mid:  mk([[0,'rgba(150,200,255,0.65)'],[1,'rgba(60,110,220,0)']]),
        tail: mk([[0,'rgba(140,180,230,0.4)'],[1,'rgba(90,130,200,0)']])
      },
      gas:{
        hot:  mk([[0,'rgba(215,255,170,0.75)'],[0.5,'rgba(150,230,90,0.5)'],[1,'rgba(80,160,40,0)']]),
        mid:  mk([[0,'rgba(140,220,90,0.55)'],[1,'rgba(70,150,40,0)']]),
        tail: mk([[0,'rgba(95,145,65,0.45)'],[1,'rgba(50,90,40,0)']])
      },
      steam:{
        hot:  mk([[0,'rgba(255,255,255,0.7)'],[0.6,'rgba(225,232,240,0.4)'],[1,'rgba(210,220,230,0)']]),
        mid:  mk([[0,'rgba(235,240,246,0.5)'],[1,'rgba(210,220,230,0)']]),
        tail: mk([[0,'rgba(220,228,236,0.3)'],[1,'rgba(205,215,228,0)']])
      }
    };
  }

  function bowChargeStatus(){
    return {
      active:!!bowCharge.active,
      t:+(bowCharge.t||0).toFixed(3),
      ratio:+bowChargeRatio().toFixed(3),
      required:+(bowCharge.required||BOW_CHARGE_SECONDS).toFixed(3),
      full:!!bowCharge.full,
      overdrawT:+(bowCharge.overdrawT||0).toFixed(3),
      energySpent:+(bowCharge.energySpent||0).toFixed(3)
    };
  }
  function spearChargeStatus(){
    return {
      active:!!spearCharge.active,
      t:+(spearCharge.t||0).toFixed(3),
      ratio:+spearChargeRatio().toFixed(3),
      required:+(spearCharge.required||SPEAR_CHARGE_SECONDS).toFixed(3),
      full:!!spearCharge.full,
      dir:spearCharge.dir<0?-1:1
    };
  }
  function reset(){ arrows.length=0; arrowFragments.length=0; mines.length=0; mineFragments.length=0; puffs.length=0; electricBeams.length=0; flameHeatRays.length=0; blastsFx.length=0; stoneHeat.clear(); sandHeat.clear(); waterHeat.clear(); heatForgedGlass.clear(); streamFuelDebt.flame=0; streamFuelDebt.hose=0; streamFuelDebt.gas=0; bowCd=0; harpoonCd=0; meleeCd=0; electricCd=0; throwCd=0; bouncyCd=0; bossAcc=0; explodeCd=0; heroFlameHitCd=0; iridiumPierces=0; ultCharge=1; lastGetTile=null; lastSetTile=null; swing.t=0; swing.form='sword'; swing.charge=0; heldActionFx.kind=''; heldActionFx.started=0; heldActionFx.until=0; heldActionFx.power=0; heldActionFx.serial=0; grav.channel=null; grav.heldTid=0; grav.throwAtMs=0; resetBowCharge(); resetSpearCharge(); }

  // --- ghost mirror: the hero's weapons, seen from the cheap seats ------------
  // A watcher runs the full renderer but no simulation, so its weapons module
  // stayed empty and the hero appeared to fight thin air — walking, but never
  // swinging, shooting or burning. The host ships a compact snapshot of the
  // COSMETIC state only (no damage, no ammo, no tile writes; draw() is already
  // read-only), and the watcher integrates it locally between packets so arrows
  // keep flying smoothly instead of teleporting once per network tick.
  const GHOST_FX_CAP={arrows:24, mines:32, mineFragments:48, puffs:80, beams:8, blasts:8};
  const FX_STUCK=1, FX_POWER=2, FX_ROCK=4, FX_SNOW=8, FX_SAND=16, FX_SPIT=32, FX_TOXIC_SPIT=64, FX_HARPOON=128, FX_AQUATIC=256, FX_BOUNCY=512, FX_GRAV=1024;
  const FX_MINE=2048, FX_FRAG_MINE=4096;
  // --- co-op guest combat: body-attributed swings and arrows -----------------------
  // Embodied multiplayer guests fight through the SAME damage chains and the SAME
  // projectile array as the hero, but attributed 'coop': no host ult charge, no
  // special-finisher bookkeeping, and no tile side-effects (no chest opening, no
  // glass shattering, no recoverable pickups) — guest combat wounds creatures only.
  // The host validates ownership/cooldown/ammo BEFORE calling in (ghost_host.js).
  const coopSwings=[];
  const COOP_SWING_CAP=8;
  const coopGid=(v)=>typeof v==='string' && /^g[a-zA-Z0-9._-]{1,39}$/.test(v) ? v : null;
  function noteCoopSwing(tx,ty,dir){
    if(coopSwings.length>=COOP_SWING_CAP) coopSwings.shift();
    coopSwings.push({t:0.22, tx, ty, dir:dir<0?-1:1, dur:0.22});
  }
  function coopMeleeAt(body, aimX, aimY, opts){
    if(!body || !Number.isFinite(body.x) || !Number.isFinite(body.y)) return false;
    opts=opts||{};
    const bonus=Math.max(0,Math.min(40,Number(opts.bonus)||0));
    const reach=Math.max(1,Math.min(4,Number(opts.reach)||MELEE_REACH));
    const {px,tx,ty}=meleeTargetTile(body,aimX,aimY,reach,false);
    // Guest combat is intentionally limited to ordinary mobs. Boss/guardian/UFO
    // defeat paths carry host story, terrain and economy side effects.
    const hit=(MM.mobs && MM.mobs.attackAt && MM.mobs.attackAt(tx,ty,bonus,{source:'coop'}));
    noteCoopSwing(tx,ty,tx>=px?1:-1);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('swing',{x:tx+0.5,y:ty+0.5}); }catch(e){}
    return !!hit;
  }
  function spawnCoopArrow(body, aimX, aimY, opts){
    if(!body || !Number.isFinite(body.x) || !Number.isFinite(body.y)) return false;
    opts=opts||{};
    const v=aimVector(body,aimX,aimY);
    if(!Number.isFinite(v.dx) || !Number.isFinite(v.dy)) return false;
    const sp=Math.max(6,Math.min(24,Number(opts.speed)||15));
    const spawned=pushArrow({
      x:body.x + v.dx*0.7,
      y:body.y - 0.15 + v.dy*0.7,
      vx:v.dx*sp,
      vy:v.dy*sp - 1.2,
      dmg:Math.max(1,Math.min(30,Math.round(Number(opts.dmg)||3))),
      life:ARROW_LIFE*0.85, stuck:false, stuckT:ARROW_STUCK,
      tier:'wood', color:'#caa472', headColor:'#dfe6f1',
      recoverable:false, coopOwner:true, windCap:sp*1.35,
      // duel identity, HOST-stamped at fire time: consent is re-verified at impact
      ownerGid:coopGid(opts.ownerGid),
      duelGid:coopGid(opts.duelGid)
    });
    if(!spawned) return false;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow',{x:body.x,y:body.y}); }catch(e){}
    return true;
  }
  // HOST-side resolver for a hero guest's projectile intent: velocity capped,
  // damage clamped, flag whitelist — then the REAL arrow flies, coop-attributed
  // (no host ult, no chests, no glass — same contract as spawnCoopArrow).
  function spawnHeroProjectile(body, spec){
    if(!body || !Number.isFinite(body.x) || !Number.isFinite(body.y)) return false;
    spec=spec||{};
    let vx=Number(spec.vx)||0, vy=Number(spec.vy)||0;
    const sp=Math.hypot(vx,vy);
    if(!(sp>0.5)) return false;
    const cap=Math.min(26,sp); vx=vx/sp*cap; vy=vy/sp*cap;
    const spawned=pushArrow({
      x:body.x+(vx/cap)*0.7, y:body.y-0.15+(vy/cap)*0.7,
      vx, vy,
      dmg:Math.max(1,Math.min(45,Math.round(Number(spec.dmg)||1))),
      life:ARROW_LIFE*0.85, stuck:false, stuckT:ARROW_STUCK,
      tier:spec.bouncy?'bouncy':'wood',
      color:spec.bouncy?BOUNCY_COLOR:'#caa472', headColor:spec.bouncy?BOUNCY_HIGHLIGHT:'#dfe6f1',
      recoverable:false, coopOwner:true, windCap:cap*1.35,
      // A coop (guest) projectile is INERT to the world by contract: it may wound
      // creatures but must never edit terrain, ignite the world, spawn/detonate gas or
      // hurt the host. So world-hazard flags a hostile client might smuggle are dropped
      // at the source — no `fire` (no world ignition), and the burst whitelist is 'wet'
      // ONLY (a creature-facing soak — no terrain, economy, or host damage).
      // The gas-grenade and bomb bursts stay hero-only. Defense in depth: the arrow
      // simulation also gates every world-touching branch on !a.coopOwner.
      // For co-op specifically, the wet soak affects creatures only; tile fire
      // and crops stay unchanged.
      snowball:!!spec.snowball, rock:!!spec.rock, thrown:!!spec.thrown, harpoon:!!spec.harpoon,
      stickyFuse:spec.sticky?2.5:0, // the fuse length is the HOST's, the guest only names the kind
      // A guest may only NAME a rubber ball; the bounce budget, restitution and
      // falloff are the host's own constants — never numbers off the wire.
      bouncy:!!spec.bouncy, bounces:spec.bouncy?BOUNCY_MAX_BOUNCES:0,
      gravityMult:spec.bouncy?BOUNCY_GRAVITY_MULT:1,
      splat:(spec.splat==='wet')?'wet':undefined, // burst kind only — radii/durations are the handlers' own
      // duel identity, HOST-stamped: consent is re-verified at impact time
      ownerGid:coopGid(spec.ownerGid),
      duelGid:coopGid(spec.duelGid)
    });
    if(!spawned) return false;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow',{x:body.x,y:body.y}); }catch(e){}
    return true;
  }
  function ghostFxState(){
    const st={};
    if(swing.t>0) st.sw=[+swing.t.toFixed(3), swing.tx, swing.ty, swing.dir, +swing.dur.toFixed(3), swing.form, +clamp01(swing.charge).toFixed(2)];
    if(coopSwings.length) st.cw=coopSwings.map(s=>[+s.t.toFixed(3), s.tx, s.ty, s.dir, +s.dur.toFixed(3)]);
    const held=heldActionState();
    if(held.active) st.ha=[held.kind,+Math.max(0,(heldActionFx.until-nowMs())/1000).toFixed(3),+held.power.toFixed(2),held.serial>>>0];
    if(bowCharge.active) st.bc=[+bowChargeRatio().toFixed(3),bowCharge.full?1:0];
    if(spearCharge.active) st.sc=[+spearChargeRatio().toFixed(3),spearCharge.full?1:0,spearCharge.dir<0?-1:1];
    st.uc=+ultCharge.toFixed(3);
    if(arrows.length) st.ar=arrows.slice(-GHOST_FX_CAP.arrows).map(a=>[
      +a.x.toFixed(2), +a.y.toFixed(2), +(a.vx||0).toFixed(2), +(a.vy||0).toFixed(2),
      (a.stuck?FX_STUCK:0)|(a.power?FX_POWER:0)|(a.rock?FX_ROCK:0)|(a.snowball?FX_SNOW:0)|
      (a.sandSpray?FX_SAND:0)|(a.spitDroplet?FX_SPIT:0)|(a.toxicSpit?FX_TOXIC_SPIT:0)|(a.harpoon?FX_HARPOON:0)|(a.aquatic?FX_AQUATIC:0)|(a.bouncy?FX_BOUNCY:0)|(a.grav?FX_GRAV:0),
      +(a.ang||0).toFixed(3), a.color||'', a.headColor||'', (Number(a.sandSeed)>>>0)||0,
      Math.max(0,Math.min(4,Number(a.weaponPrestige)||0)), a.weaponGlow||'', a.weaponMaterial||'',
      (a.deployMine?FX_MINE:0)|(a.mineType==='fragmentation'?FX_FRAG_MINE:0)
    ]);
    if(mines.length) st.mn=mines.slice(-GHOST_FX_CAP.mines).map(m=>[
      +m.x.toFixed(2),+m.y.toFixed(2),m.type==='fragmentation'?1:0,m.armed?1:0,+Math.max(0,m.age||0).toFixed(2)
    ]);
    if(mineFragments.length) st.mf=mineFragments.slice(-GHOST_FX_CAP.mineFragments).map(f=>[
      +f.x.toFixed(2),+f.y.toFixed(2),+(f.vx||0).toFixed(2),+(f.vy||0).toFixed(2),
      +(f.t||0).toFixed(3),+(f.life||0.5).toFixed(3),+(f.angle||0).toFixed(3)
    ]);
    if(puffs.length) st.pf=puffs.slice(-GHOST_FX_CAP.puffs).map(p=>[
      p.kind, +p.x.toFixed(2), +p.y.toFixed(2), +(p.vx||0).toFixed(2), +(p.vy||0).toFixed(2),
      +(p.life||0).toFixed(2), +(p.total||0).toFixed(2), p.coalSmoke?1:0
    ]);
    if(electricBeams.length) st.eb=electricBeams.slice(-GHOST_FX_CAP.beams).map(b=>[
      +b.x1.toFixed(2), +b.y1.toFixed(2), +b.x2.toFixed(2), +b.y2.toFixed(2),
      +(b.t||0).toFixed(3), +(b.life||0.2).toFixed(3), b.hit?1:0, b.blocked?1:0, +(b.phase||0).toFixed(2)
    ]);
    if(blastsFx.length) st.bl=blastsFx.slice(-GHOST_FX_CAP.blasts).map(b=>[
      +b.x.toFixed(2), +b.y.toFixed(2), +(b.R||1).toFixed(2), +(b.t||0).toFixed(3), +(b.max||0.4).toFixed(3)
    ]);
    return st;
  }
  const num=(v,d)=>Number.isFinite(Number(v))?Number(v):(d||0);
  function ghostApplyFx(st){
    if(!st || typeof st!=='object') return false;
    // A hostile host must not be able to blow the watcher's frame budget.
    const sw=Array.isArray(st.sw)?st.sw:null;
    swing.t=sw?Math.max(0,Math.min(2,num(sw[0]))):0;
    if(!sw) swing.charge=0;
    if(sw){
      swing.tx=num(sw[1]); swing.ty=num(sw[2]); swing.dir=num(sw[3])<0?-1:1; swing.dur=Math.max(0.05,Math.min(2,num(sw[4],0.2)));
      swing.form=['sword','club','axe','spear','trident'].includes(sw[5])?sw[5]:'sword';
      swing.charge=clamp01(num(sw[6]));
    }
    coopSwings.length=0;
    for(const s of (Array.isArray(st.cw)?st.cw.slice(0,COOP_SWING_CAP):[])){
      if(!Array.isArray(s)) continue;
      coopSwings.push({t:Math.max(0,Math.min(2,num(s[0]))), tx:num(s[1]), ty:num(s[2]), dir:num(s[3])<0?-1:1, dur:Math.max(0.05,Math.min(2,num(s[4],0.22)))});
    }
    const ha=Array.isArray(st.ha)?st.ha:null;
    if(ha){
      const now=nowMs(), duration=Math.max(45,Math.min(650,num(ha[1],0.15)*1000));
      heldActionFx.kind=typeof ha[0]==='string'?ha[0].slice(0,16):'weapon'; heldActionFx.started=now;
      heldActionFx.until=now+duration; heldActionFx.power=Math.max(0.25,Math.min(3,num(ha[2],1))); heldActionFx.serial=num(ha[3])>>>0;
    }else{
      heldActionFx.until=0; heldActionFx.power=0;
    }
    const bc=Array.isArray(st.bc)?st.bc:null;
    if(bc){ bowCharge.active=true; bowCharge.required=1; bowCharge.t=Math.max(0,Math.min(1,num(bc[0]))); bowCharge.full=!!num(bc[1]); }
    else { bowCharge.active=false; bowCharge.t=0; bowCharge.full=false; }
    const sc=Array.isArray(st.sc)?st.sc:null;
    if(sc){ spearCharge.active=true; spearCharge.required=1; spearCharge.t=clamp01(num(sc[0])); spearCharge.full=!!num(sc[1]); spearCharge.dir=num(sc[2])<0?-1:1; }
    else { spearCharge.active=false; spearCharge.t=0; spearCharge.full=false; }
    if(Number.isFinite(Number(st.uc))) ultCharge=Math.max(0,Math.min(1,num(st.uc)));
    arrows.length=0;
    for(const a of (Array.isArray(st.ar)?st.ar.slice(0,GHOST_FX_CAP.arrows):[])){
      if(!Array.isArray(a)) continue;
      const f=num(a[4])|0;
      const mf=num(a[12])|0;
      arrows.push({x:num(a[0]), y:num(a[1]), vx:num(a[2]), vy:num(a[3]),
        stuck:!!(f&FX_STUCK), power:!!(f&FX_POWER), rock:!!(f&FX_ROCK), snowball:!!(f&FX_SNOW),
        sandSpray:!!(f&FX_SAND), spitDroplet:!!(f&FX_SPIT), toxicSpit:!!(f&FX_TOXIC_SPIT), harpoon:!!(f&FX_HARPOON),
        deployMine:!!(mf&FX_MINE),mineType:(mf&FX_FRAG_MINE)?'fragmentation':((mf&FX_MINE)?'blast':undefined),
        ang:num(a[5]), color:typeof a[6]==='string'?a[6].slice(0,24):'', headColor:typeof a[7]==='string'?a[7].slice(0,24):'',
        sandSeed:(num(a[8])>>>0)||1,
        weaponPrestige:Math.max(0,Math.min(4,num(a[9]))), weaponGlow:typeof a[10]==='string'?a[10].slice(0,24):'',
        weaponMaterial:typeof a[11]==='string'?a[11].slice(0,16):'', aquatic:!!(f&FX_AQUATIC),
        bouncy:!!(f&FX_BOUNCY), bounces:(f&FX_BOUNCY)?BOUNCY_MAX_BOUNCES:0,
        grav:!!(f&FX_GRAV), // replica renders the tinted block; all physics stays host-side
        gravityMult:(f&FX_HARPOON)?0.12:((f&FX_BOUNCY)?BOUNCY_GRAVITY_MULT:1),
        life:9, stuckT:9, travel:0, maxTravel:1e9, ghost:true});
    }
    mines.length=0;
    for(const m of (Array.isArray(st.mn)?st.mn.slice(0,GHOST_FX_CAP.mines):[])){
      if(!Array.isArray(m)) continue;
      const fragmentation=!!num(m[2]);
      mines.push({x:num(m[0]),y:num(m[1]),type:fragmentation?'fragmentation':'blast',
        armed:!!num(m[3]),age:Math.max(0,num(m[4])),color:fragmentation?'#5b493d':'#46505a',
        headColor:fragmentation?'#ffb14a':'#ff5b45',ghost:true});
    }
    mineFragments.length=0;
    for(const f of (Array.isArray(st.mf)?st.mf.slice(0,GHOST_FX_CAP.mineFragments):[])){
      if(!Array.isArray(f)) continue;
      mineFragments.push({x:num(f[0]),y:num(f[1]),vx:num(f[2]),vy:num(f[3]),t:Math.max(0,num(f[4])),
        life:Math.max(0.05,num(f[5],0.5)),angle:num(f[6]),ghost:true});
    }
    puffs.length=0;
    for(const p of (Array.isArray(st.pf)?st.pf.slice(0,GHOST_FX_CAP.puffs):[])){
      if(!Array.isArray(p)) continue;
      puffs.push({kind:typeof p[0]==='string'?p[0].slice(0,12):'flame', x:num(p[1]), y:num(p[2]),
        vx:num(p[3]), vy:num(p[4]), life:Math.max(0,num(p[5])), total:Math.max(0.05,num(p[6],0.5)),
        coalSmoke:!!num(p[7]), dps:0, ghost:true});
    }
    electricBeams.length=0;
    for(const b of (Array.isArray(st.eb)?st.eb.slice(0,GHOST_FX_CAP.beams):[])){
      if(!Array.isArray(b)) continue;
      electricBeams.push({x1:num(b[0]), y1:num(b[1]), x2:num(b[2]), y2:num(b[3]),
        t:num(b[4]), life:Math.max(0.05,num(b[5],0.2)), hit:!!num(b[6]), blocked:!!num(b[7]), phase:num(b[8]), ghost:true});
    }
    blastsFx.length=0;
    for(const b of (Array.isArray(st.bl)?st.bl.slice(0,GHOST_FX_CAP.blasts):[])){
      if(!Array.isArray(b)) continue;
      blastsFx.push({x:num(b[0]), y:num(b[1]), R:Math.max(0.2,num(b[2],1)), t:num(b[3]), max:Math.max(0.05,num(b[4],0.4)), ghost:true});
    }
    return true;
  }
  // Cosmetic-only integration between packets. Deliberately NOT update(): no
  // damage, no ignition, no pickups, no tile writes — a watcher may never change
  // the world it is watching.
  function ghostStepFx(dt){
    const d=Math.max(0, Math.min(0.1, Number(dt)||0));
    if(!d) return;
    if(swing.t>0) swing.t-=d;
    for(let i=coopSwings.length-1;i>=0;i--){ coopSwings[i].t-=d; if(coopSwings[i].t<=0) coopSwings.splice(i,1); }
    if(bowCharge.active && !bowCharge.full){ bowCharge.t=Math.min(bowCharge.required,bowCharge.t+d*0.35); bowCharge.full=bowCharge.t>=bowCharge.required; }
    if(spearCharge.active && !spearCharge.full){ spearCharge.t=Math.min(spearCharge.required,spearCharge.t+d*0.82); spearCharge.full=spearCharge.t>=spearCharge.required; }
    for(let i=arrows.length-1;i>=0;i--){
      const a=arrows[i];
      if(a.stuck) continue;
      a.x+=a.vx*d; a.y+=a.vy*d; a.vy+=ARROW_GRAV*(Number.isFinite(a.gravityMult)?a.gravityMult:1)*d;
    }
    for(let i=mineFragments.length-1;i>=0;i--){
      const f=mineFragments[i];
      f.t+=d;
      f.x+=(f.vx||0)*d;
      f.y+=(f.vy||0)*d;
      f.vy=(f.vy||0)+ARROW_GRAV*0.22*d;
      f.angle=Math.atan2(f.vy||0,f.vx||1);
      if(f.t>=f.life) mineFragments.splice(i,1);
    }
    for(let i=puffs.length-1;i>=0;i--){
      const p=puffs[i];
      p.life-=d; p.x+=(p.vx||0)*d; p.y+=(p.vy||0)*d;
      if(p.life<=0) puffs.splice(i,1);
    }
    for(let i=electricBeams.length-1;i>=0;i--){
      const b=electricBeams[i]; b.t+=d;
      if(b.t>=b.life) electricBeams.splice(i,1);
    }
    for(let i=blastsFx.length-1;i>=0;i--){
      const b=blastsFx[i]; b.t+=d;
      if(b.t>b.max) blastsFx.splice(i,1);
    }
  }
  MM.weapons={fireHeld,releaseHeld,cancelHeld,fireUlt,update,draw,drawHeld,drawWorldLight,drawHeroReflection,lightSource:weaponLightSource,notifyMeleeSwing,reset,explodeAt,spawnGasCloud,spawnExternalStream,
    coopMeleeAt,spawnCoopArrow,spawnHeroProjectile,
    ghostFxState,ghostApplyFx,ghostStepFx,
    arrowInfo,setArrowPref,fuelInfo,thrownInfo,stoneInfo,bouncyInfo,hudStatus,addUltCharge,
    gravityInfo,setGravHeld,spawnGravityProjectile,
    metrics:()=>({arrows:arrows.length,arrowFragments:arrowFragments.length,mines:mines.length,mineFragments:mineFragments.length,puffs:puffs.length,electricBeams:electricBeams.length,arrowAmmo:arrowAmmoCounts(),harpoonAmmo:resourceCount('harpoonBolt'),bouncyAmmo:bouncyAmmoCount(),ultCharge,bowCharge:bowChargeStatus(),spearCharge:spearChargeStatus(),stoneHeat:stoneHeat.size,stoneHeatMax:stoneHeatMaxRatio(),sandHeat:sandHeat.size,sandHeatMax:sandHeatMaxRatio(),waterHeat:waterHeat.size,waterHeatMax:waterHeatMaxRatio(),iridiumPierces}),
    _debug:{arrows,arrowFragments,mines,mineFragments,puffs,electricBeams,arrowTiers:ARROW_TIERS,arrowResourceKey,dropSurvivingArrow,spawnDroppedArrowPickup,splatProjectile,deployMine,detonateMine,mineHasTriggerActor,damageBlastHeroes,radialDamageAmount,mineTuning:{armSeconds:MINE_ARM_SECONDS,triggerRadius:MINE_TRIGGER_RADIUS,craterRadius:MINE_CRATER_RADIUS,blastDamage:MINE_BLAST_DAMAGE,fragmentRadius:MINE_FRAGMENT_RADIUS,fragmentDamage:MINE_FRAGMENT_DAMAGE},arrowBreakChance,arrowBreaksOnImpact,spawnArrowBreakFx,beginArrowExpiryFall,pushArrow,arrowDamageAtRange,arrowRangeBand,arrowDamageFalloff:ARROW_DAMAGE_FALLOFF,bowCharge,bowChargeRatio,bowDamageMult,spearCharge,spearChargeRatio,spearChargeStatus,heroSubmersion,meleeWaterProfile,bowWaterProfile,harpoonWaterProfile,weaponPrestigeRank,weaponVisualSeed,weaponPrestigeColor,weaponMaterialProfile,weaponCombatVisualMeta,projectileCombatVisualMeta,projectileImpactOpts,weaponLightSource,weaponLightRgba,meleeVisualForm,meleeAttackPose,swing,heldActionFx,heldActionState,triggerHeldActionFx,drawHeldChargeFx,drawProjectilePrestigeTrail,waterHeat,electricChargeTargetAt,meleeEffects:MELEE_EFFECTS,meleeReach,thrownKinds:THROWN_KINDS,sandVisualPattern,
      spawnBouncyBall,bounceBallOffTile,bounceBallOffBody,retireBouncyBall,bouncyAmmoCount,
      bouncySpec,igniteBouncyBall,spreadBouncyFire,bouncyKinds:BOUNCY_KINDS,bouncyBurnBounces:BOUNCY_BURN_BOUNCES,
      bouncyTuning:{speed:BOUNCY_SPEED,gravityMult:BOUNCY_GRAVITY_MULT,life:BOUNCY_LIFE,maxBounces:BOUNCY_MAX_BOUNCES,
        wallRestitution:BOUNCY_WALL_RESTITUTION,bodyRestitution:BOUNCY_BODY_RESTITUTION,
        wallDamageKeep:BOUNCY_WALL_DAMAGE_KEEP,hitDamageKeep:BOUNCY_HIT_DAMAGE_KEEP,
        minSpeed:BOUNCY_MIN_SPEED,recoverChance:BOUNCY_RECOVER_CHANCE,ammoKey:BOUNCY_AMMO_KEY}}};
})();
// ESM export (progressive migration)
export const weapons = (typeof window!=='undefined' && window.MM) ? window.MM.weapons : undefined;
export default weapons;
