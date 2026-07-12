// Threat-look engine: the stronger the mob, the stronger it LOOKS.
//
// One shared visual grammar across the whole bestiary so danger is legible at a
// glance, the way it is in nature:
//  - menace score  : log-scaled effective power (maxHp × dmg of the INSTANCE, so
//                    hostility-scaled far-world veterans climb grades naturally)
//  - 6 grades      : 0 płochliwy · 1 czujny · 2 groźny · 3 zabójczy · 4 koszmarny · 5 apeks
//  - allometry     : higher grades are bigger AND disproportionately bulkier
//                    (elephant-leg rule), with a forward menace lean
//  - weaponry      : spines/hackles, horns & antler tines, claws, tusks — all grow
//                    monotonically with grade (dominance signalling)
//  - aposematism   : deadly organics advertise with dark warning chevrons
//  - history       : veterans carry pale battle scars and broken horn tips,
//                    seeded per individual so no two look alike
//  - eyes          : glow ramp amber → orange → red → white-hot apex stare
//  - tools         : tool-users upgrade gear with grade (bone → forged → ornate → runic)
//  - presence      : apex-only aura halo, rim-light pulse and breath motes
//
// The body palette itself is graded at spawn (applySpawnLook): prey fades pale
// and drab, apex predators go dark and saturated. Overlays are drawn as solid,
// shaded pixels so they read as anatomy, not UI decals.
//
// Pure & import-safe in Node (tests feed buildLook directly); DOM is only touched
// lazily inside draw calls (pre-baked glow sprites).

// ---------------------------------------------------------------------------
// color helpers (self-contained: module is dependency-free on purpose)
function hexToRgb(hex){ const n=parseInt(hex.slice(1),16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,'0')).join(''); }
function rgbToHsl(r,g,b){ r/=255; g/=255; b/=255; const max=Math.max(r,g,b), min=Math.min(r,g,b); let h,s; const l=(max+min)/2; if(max===min){ h=s=0; } else { const d=max-min; s=l>0.5? d/(2-max-min): d/(max+min); switch(max){ case r: h=(g-b)/d+(g<b?6:0); break; case g: h=(b-r)/d+2; break; default: h=(r-g)/d+4; } h/=6; } return {h,s,l}; }
function hslToRgb(h,s,l){ let r,g,b; if(s===0){ r=g=b=l; } else { const hue2rgb=(p,q,t)=>{ if(t<0) t+=1; if(t>1) t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; }; const q=l<0.5? l*(1+s): l+s-l*s; const p=2*l-q; r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); } return {r:(r*255)|0,g:(g*255)|0,b:(b*255)|0}; }
function mixHex(a,b,t){ try{ const ca=hexToRgb(a), cb=hexToRgb(b); return rgbToHex(ca.r+(cb.r-ca.r)*t, ca.g+(cb.g-ca.g)*t, ca.b+(cb.b-ca.b)*t); }catch(e){ return a; } }
function rgba(hex,a){ try{ const c=hexToRgb(hex); return 'rgba('+c.r+','+c.g+','+c.b+','+(+a).toFixed(3)+')'; }catch(e){ return 'rgba(255,255,255,'+(+a).toFixed(3)+')'; } }
// Saturation ×sMul, lightness +lAdd — the spawn-time body grading primitive.
export function gradeBodyColor(hex, sMul, lAdd){
  try{
    const {r,g,b}=hexToRgb(hex);
    const c=rgbToHsl(r,g,b);
    const s=Math.max(0,Math.min(1,c.s*sMul));
    const l=Math.max(0.06,Math.min(0.96,c.l+lAdd));
    const o=hslToRgb(c.h,s,l);
    return rgbToHex(o.r,o.g,o.b);
  }catch(e){ return hex; }
}

// deterministic per-individual rolls
function xorshift(seed){ let s=(seed>>>0)||0x9e3779b9; return function(){ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return (s>>>8)/16777216; }; }

// ---------------------------------------------------------------------------
// menace score
export const THREAT_GRADE_NAMES=['płochliwy','czujny','groźny','zabójczy','koszmarny','apeks'];
export const THREAT_GRADE_THRESHOLDS=[0.22,0.36,0.52,0.70,0.84];
const P_LOW=1.5, P_HIGH=2600;
const LOG_SPAN=Math.log(P_HIGH/P_LOW);

export function menacePower(st){
  const hp=Math.max(1,Number(st&&st.hp)||1);
  const dmg=Math.max(0,Number(st&&st.dmg)||0);
  const speed=Math.max(0,Math.min(12,Number(st&&st.speed)||0));
  const bias=Math.max(0.1,Number(st&&st.menaceBias)||1);
  let p=Math.pow(hp,0.62)*Math.pow(1+dmg,0.85)*(0.9+speed*0.04)*bias;
  if(st&&st.alwaysAggro) p*=1.12;
  return p;
}
export function menaceScore(st){
  const power=menacePower(st);
  const t=Math.max(0,Math.min(1,Math.log(Math.max(1e-6,power/P_LOW))/LOG_SPAN));
  let grade=0;
  while(grade<THREAT_GRADE_THRESHOLDS.length && t>THREAT_GRADE_THRESHOLDS[grade]) grade++;
  return {power,t,grade};
}

// ---------------------------------------------------------------------------
// Per-grade feature intensities (all monotonic — pinned by tests).
//
// Every channel here is something a real animal actually does when it is bigger
// and older: it carries more muscle over the shoulders (hump), its hide gets
// weathered and mottled, its keratin (horn/claw/tooth) grows longer, darker and
// thicker, its eyes catch more light (tapetum shine), it breathes visibly, it
// plants heavier. Nothing is a badge, a chevron or a spike-row stuck on top.
export const GRADE_FX=[
  //          silhouette                    build            hide      keratin                 face          presence               tools
  {size:0.94, minScale:0,    bulk:1.00, lean:0,     hump:0,    weather:0, horn:0, claw:0, fang:0, fin:0,    eye:0, breath:0, dust:0, shadow:0,    gear:0},
  {size:1.00, minScale:0,    bulk:1.00, lean:0,     hump:0,    weather:0, horn:0, claw:0, fang:0, fin:0,    eye:0, breath:0, dust:0, shadow:0,    gear:0},
  {size:1.06, minScale:0.86, bulk:1.02, lean:0.015, hump:0.30, weather:1, horn:1, claw:1, fang:0, fin:0.35, eye:1, breath:0, dust:0, shadow:0.18, gear:0},
  {size:1.13, minScale:0.94, bulk:1.05, lean:0.035, hump:0.55, weather:2, horn:2, claw:2, fang:1, fin:0.60, eye:2, breath:0, dust:0, shadow:0.30, gear:1},
  {size:1.21, minScale:1.02, bulk:1.09, lean:0.055, hump:0.80, weather:3, horn:3, claw:3, fang:2, fin:0.82, eye:3, breath:1, dust:1, shadow:0.42, gear:2},
  {size:1.32, minScale:1.10, bulk:1.14, lean:0.080, hump:1.00, weather:4, horn:4, claw:3, fang:3, fin:1.00, eye:4, breath:2, dust:2, shadow:0.55, gear:3}
];
// body-palette grading per grade: prey pale/drab, apex dark/saturated
export const GRADE_PALETTE=[
  {sMul:0.82, lAdd:+0.07},
  {sMul:1.00, lAdd: 0.00},
  {sMul:1.12, lAdd:-0.03},
  {sMul:1.22, lAdd:-0.06},
  {sMul:1.32, lAdd:-0.10},
  {sMul:1.40, lAdd:-0.13}
];
// Eye-shine ramp: a wolf's tapetum at dusk → a predator's hot red stare.
// The eye escalates in COLOUR ONLY. Its drawn size is fixed (EYE_R) — an eye
// that grows with the grade stops reading as an eye and starts reading as a
// lamp bolted to the head.
//
// But no two species share an eye. Each iris starts from the SPECIES' own
// tint (a ghoul's grave-lime, a yeti's glacier blue, a dragon's gold) and is
// pulled toward the menace red as the grade climbs — identity at the bottom
// of the ladder, unmistakable danger at the top.
const EYE_COLORS=[null,null,'#e9922e','#f4571c','#fa1f0c','#ff0400'];
const EYE_MENACE_MIX=[0,0,0.45,0.65,0.82,0.94];
const EYE_TINTS_FAMILY={
  beast:'#c98a3a', cervid:'#6b5638', aquatic:'#3c4a56', serpent:'#c2b23c',
  dragon:'#ffc23c', humanoid:'#cfa25a', avian:'#f0b83c', arthropod:'#2a2018',
  amorph:'#9adf6a', construct:'#8ad8ff', wisp:'#dff4ff', jelly:'#bcd8e8'
};
const EYE_R=1.55;          // iris orb radius, in pixels, at every grade
const EYE_HALO_R=3.4;      // catch-light radius, likewise fixed
// The one place the eye's geometry is decided. Size is constant by construction;
// only alpha may climb, so "scarier" can never mean "bigger".
export function eyeRender(grade){
  const g=Math.max(0,Math.min(5,Number(grade)||0));
  return { r:EYE_R, haloR:EYE_HALO_R, haloAlpha: g>=5 ? 0.34 : (g>=4 ? 0.22 : 0) };
}
// Every transform the eye is nested inside by the time drawPost runs. Keep these
// in step with the mobs.js draw loop (ctx.scale(m.scale)) and drawThreatLookPre
// (horizontal bulk) — they are what the eye's radius must be divided by to hold a
// constant SCREEN size, and what the tests multiply back to verify it.
export function eyeScaleY(m){ return Math.max(0.05, Number(m&&m.scale)||1); }
export function eyeScaleX(m,look){ return eyeScaleY(m) * ((look&&look.grade>=2) ? look.bulk : 1); }

// ---------------------------------------------------------------------------
// Eye anatomy. Once an eye is bigger than a dot it has to read as a living
// EYE, not a lamp: a lidded opening in the skull, a dark warm sclera, a shaded
// iris, a pupil shaped by the animal's diet (slits hunt, bars graze, rounds
// think), a moist catch-light — and it blinks. Species too small for that
// detail keep the ember dot; arachnids get a cluster of ocelli; bone, masks
// and machines have no lids and never blink.
const EYE_LID_COVER=[0,0,0.10,0.16,0.24,0.30]; // resting glare: lids narrow with grade

// Deterministic per-individual blink: a 150ms sweep every 3.0–5.6s.
// Returns lid closure 0..1. Pure, so the tests can pin the rhythm.
export function blinkState(seed,tMs){
  const s=((seed>>>0)||1);
  const period=3.0+((s>>>4)%1024)/1024*2.6;
  const local=((tMs*0.001)+(s%97)*0.131)%period;
  if(local>=0.15) return 0;
  return Math.sin((local/0.15)*Math.PI);
}

// What kind of eye this creature can even have. Pure — pinned by tests.
// A mob drawn facing the screen (humanoids, owls, the yeti's flat face) shows
// TWO eyes; a mob drawn in profile (beasts, fish, serpents, the dragon) shows
// ONE. Aspect, brow weight and sclera darkness vary by family so the eye
// belongs to the animal instead of being one template stamped on everything.
export function eyeGeometry(m,spec,look){
  if(!look || look.grade<2) return {mode:'none'};
  const fam=look.family;
  if(fam==='construct'||fam==='wisp'||fam==='jelly') return {mode:'none'};
  const meta=look.meta||{};
  if(meta.noEye) return {mode:'none'};                 // sand worms hunt blind
  const body=(spec&&spec.body)||{w:1,h:1};
  // eye size follows the SPECIES' anatomy (a dragon's eye out-sizes a wolf's),
  // never the grade — the grade may only recolour it
  const r=typeof meta.eyeR==='number' ? meta.eyeR
    : Math.max(1.4, Math.min(4.2, 1.1+Math.sqrt(Math.max(0.1,(body.w||1)*(body.h||1)))*1.05));
  const twin=Array.isArray(meta.eyes) || fam==='humanoid';
  if(fam==='arthropod') return {mode:'compound', r:Math.min(r,2.6), blink:false, twin:false};
  const aspect=typeof meta.eyeAspect==='number' ? meta.eyeAspect
    : fam==='cervid' ? 1.30                            // the soft almond of a grazer
    : (fam==='beast'&&!meta.pred) ? 1.20
    : fam==='humanoid' ? 1.05
    : 1.0;
  const sclera=fam==='aquatic' ? '#11161c' : '#3b2d20'; // a shark's eye is a black bead
  const brow=typeof meta.brow==='number' ? meta.brow
    : fam==='dragon' ? 1.0
    : (fam==='beast'&&meta.pred) ? 0.6
    : fam==='humanoid' ? 0.5
    : fam==='cervid' ? 0.25
    : 0;
  if(meta.lidless || r<2.1) return {mode:'dot', r, blink:false, twin};
  const pupil=(fam==='serpent'||fam==='dragon') ? 'slit'
    : (fam==='beast'||fam==='cervid') ? (meta.pred?'slit':'bar')
    : 'round';
  return {mode:'complex', r, pupil, blink:true, twin, aspect, sclera, brow};
}
// keratin ages the way real horn does: pale and thin when young, dark, dense
// and yellowed at the base when old
const KERATIN=['#d8c9a3','#d8c9a3','#c9b590','#ab9068','#87693f','#63492a'];

// hot/cold world-side only tints the BREATH (vapour is the one honest place for it)
function breathColor(side){
  if(side==='hot')  return '#ffb87a';
  if(side==='cold') return '#e6f6ff';
  return '#dfe6dc';
}

// ---------------------------------------------------------------------------
// Species → family, anatomy anchors and armament. The family decides WHICH
// organic channels a creature can even express (a deer never grows fangs; a
// wolf never grows antlers; a jellyfish grows neither). The anchors pin the
// features onto the hand-drawn art instead of onto a guessed bounding box.
//
//   eye     [forwardPx, upPx]  from (sx,sy); forward is flipped by faceDir
//   withers [forwardPx, topPx] the shoulder line where muscle mass piles up
//   pred    carnivore: may grow claws and fangs
//   horns   grows horn even though it is not a cervid (goat, bison)
export const SPECIES_LOOK={
  // --- prey & critters: never express weapons, only size and coat -------------
  SQUIRREL:{family:'beast'}, RABBIT:{family:'beast'}, ZABA:{family:'amorph'},
  FIREFLY:{family:'wisp'},
  JASZCZUR:{family:'beast', pred:true, eye:[5,-7], withers:[2,-6], jaw:[8,-4]},
  FISH:{family:'aquatic'},
  BIRD:{family:'avian', eye:[5,-6]},
  OWL:{family:'avian', pred:true, eyes:[[-1.5,-5.5],[2.5,-5.5]], eyeTint:'#ffb020'}, // owls face you
  CRAB:{family:'arthropod', pred:true}, BAT:{family:'avian', pred:true, eye:[1,-2]},
  // --- beasts of the wild ----------------------------------------------------
  DEER:{family:'cervid', eye:[12,-18], hornX:10, hornY:-19, withers:[4,-13]},
  WIOSENNY_JELEN:{family:'cervid', eye:[20,-16], hornX:13, hornY:-23, withers:[6,-16]},
  JESIENNY_LOS:{family:'cervid', hornX:12, hornY:-22, withers:[6,-17]},
  GOAT:{family:'beast', horns:true, eye:[11,-15], hornX:8, hornY:-17, withers:[4,-11]},
  WOLF:{family:'beast', pred:true, eye:[12,-13], withers:[5,-11], jaw:[19,-9], paw:[9,-2]},
  BEAR:{family:'beast', pred:true, eye:[11,-12], withers:[4,-12], jaw:[17,-6], paw:[10,-1]},
  ZIMOWY_NIEDZWIEDZ:{family:'beast', pred:true, eye:[14,-16], withers:[5,-17], jaw:[21,-9], paw:[12,-1]},
  THUNDER_BISON:{family:'beast', horns:true, eye:[23,-15], hornX:15, hornY:-20, withers:[2,-19]},
  LETNI_ZUBR:{family:'beast', horns:true, eye:[28,-13], hornX:16, hornY:-22, withers:[3,-24]},
  // --- water: fins, not spines ------------------------------------------------
  PIRANHA:{family:'aquatic', pred:true, eye:[3,-2], fin:[-1,-3]},
  SHARK:{family:'aquatic', pred:true, fin:[0,-5], eyeTint:'#46525c'},
  EEL:{family:'serpent', pred:true, fin:[0,-3]},
  LAKE_SERPENT:{family:'serpent', pred:true, fin:[0,-4]},
  JACKPOT_WHALE:{family:'aquatic', pred:true, fin:[-4,-12], eyeR:2.2},
  ATLANTIS_MEDUZA:{family:'jelly'},
  // --- desert / swamp / mountain ----------------------------------------------
  SAND_WORM:{family:'serpent', pred:true, fin:[-2,-8], noEye:true},
  GIANT_SCORPION:{family:'arthropod', pred:true, eye:[14,-16]},
  BOG_LURKER:{family:'amorph', pred:true, eyes:[[4,-14],[-2,-13]], eyeTint:'#d8c86a'},
  BRAMBLE_STALKER:{family:'amorph', pred:true, eyes:[[-3,-7],[4,-7]], eyeTint:'#8adf5a'},
  STONE_GOLEM:{family:'construct'},
  VULTURE:{family:'avian', pred:true}, VULTURE_HATCHLING:{family:'avian'},
  JACKPOT_YETI:{family:'humanoid', pred:true, withers:[0,-30], eyes:[[-6,-28],[6,-28]], eyeTint:'#9fe8ff'},
  // --- night & undead ----------------------------------------------------------
  GHOUL:{family:'humanoid', pred:true, eye:[5,-25], eyes:[[5,-24],[8,-24]], eyeTint:'#b8e86a', withers:[0,-22], jaw:[8,-21], paw:[8,-1]},
  SZKIELET:{family:'humanoid', eye:[1,-24], eyes:[[0,-24],[3,-24]], eyeTint:'#cfe89a', withers:[0,-20], gear:'bow', lidless:true},
  PELZACZ:{family:'arthropod', pred:true},
  ICE_WRAITH:{family:'wisp'},
  // --- tool users & guardians ---------------------------------------------------
  TEMPLE_GUARD:{family:'humanoid', eye:[3,-25], eyes:[[3.5,-25],[-0.5,-24]], eyeTint:'#b9ff93', withers:[0,-22], gear:'halberd', handX:-12, handY:-18, lidless:true},
  GOLD_DWARF_GUARD:{family:'humanoid', eye:[2,-23], eyes:[[3,-23],[-1,-23]], eyeTint:'#ffd24a', withers:[0,-20], gear:'hammer', handX:13, handY:-14},
  ICE_SHAMAN:{family:'humanoid', eye:[2,-26], eyes:[[3,-26],[-2,-26]], eyeTint:'#bfe8ff', withers:[0,-22], gear:'staff', handX:-12, handY:-33},
  FIRE_SHAMAN:{family:'humanoid', eye:[2,-26], eyes:[[3,-26],[-2,-26]], eyeTint:'#ffc46a', withers:[0,-22], gear:'staff', handX:-12, handY:-33},
  STRAZNIK:{family:'construct'}, ATOMIC_BOMB:{family:'construct'},
  RADIATION_COCKROACH:{family:'arthropod'},
  GOLD_DRAGON:{family:'dragon', pred:true, eye:[40,-42], eyeTint:'#ffc23c', hornX:33, hornY:-51, withers:[6,-31], jaw:[46,-34], paw:[18,-1]},
  // --- sky ------------------------------------------------------------------------
  CLOUD_RAY:{family:'aquatic', fin:[0,-6]}, HARPY:{family:'avian', pred:true},
  VOLT_WISP:{family:'wisp'}, SPORE_DRIFTER:{family:'jelly'},
  CINDER_HAWK:{family:'avian', pred:true},
  SKY_SERAPH:{family:'humanoid', withers:[0,-26]},
  SKYGROVE_WARDEN:{family:'humanoid', pred:true, withers:[0,-30]},
  BALLOON_TYRANT:{family:'construct'}, STORM_HERALD:{family:'wisp'},
  AURORA_WYRM:{family:'serpent', pred:true, fin:[0,-7]},
  MIRAGE_DJINN:{family:'humanoid', withers:[0,-24]},
  CORSAIR_AUTOMATON:{family:'construct'}, SPORE_MOTHER:{family:'jelly'},
  GRAVITY_COLOSSUS:{family:'construct'}, HARPY_QUEEN:{family:'avian', pred:true},
  EMBER_PHOENIX:{family:'avian', pred:true}
};
function familyFor(id,spec){
  const meta=SPECIES_LOOK[id];
  if(meta && meta.family) return meta.family;
  if(spec && spec.organic===false) return 'construct';
  if(spec && spec.aquatic) return 'aquatic';
  if(spec && spec.flying) return 'avian';
  return 'beast';
}

// ---------------------------------------------------------------------------
// look profile
export function buildLook(input){
  const id=String(input&&input.id||'');
  const seed=(Number(input&&input.seed)||0)>>>0;
  const {power,t,grade}=menaceScore(input);
  const fx=GRADE_FX[grade];
  const pal=GRADE_PALETTE[grade];
  const side=(input&&(input.side==='hot'||input.side==='cold'))?input.side:'center';
  const tier=Math.max(0,Math.min(4,Number(input&&input.tier)||0));
  const family=familyFor(id,input&&input.spec);
  const meta=SPECIES_LOOK[id]||null;
  const rnd=xorshift(seed^0x51ed270b);
  // Weathered hide: an old animal's coat is not uniform. Deterministic soft
  // patches — matted fur, healed hide, sun-bleach — sitting INSIDE the torso,
  // never a drawn-on mark. Each is body-coloured, only darker or paler.
  const patches=[];
  for(let i=0;i<fx.weather;i++){
    patches.push({
      fx:(rnd()*0.52-0.26),          // torso-frame x fraction (inset: stays on hide)
      fy:0.34+rnd()*0.30,            // torso-frame y fraction
      rx:0.06+rnd()*0.09,            // fraction of torso width
      ry:0.05+rnd()*0.07,
      pale:rnd()<0.34,               // old healed hide goes pale; dirt goes dark
      d:0.10+rnd()*0.12              // how far from base colour
    });
  }
  return {
    id, grade, t, power, side, tier, seed, family, meta,
    name:THREAT_GRADE_NAMES[grade],
    size:fx.size, minScale:fx.minScale, bulk:fx.bulk, lean:fx.lean,
    fx, sMul:pal.sMul, lAdd:pal.lAdd,
    // each species keeps its own iris tint, pulled toward menace red with grade
    eyeCol:EYE_COLORS[grade]
      ? mixHex((meta&&meta.eyeTint)||EYE_TINTS_FAMILY[family]||'#c98a3a', EYE_COLORS[grade], EYE_MENACE_MIX[grade])
      : null,
    keratin:KERATIN[grade],
    breath:breathColor(side),
    patches,
    // a veteran that has locked horns too often carries a snapped one
    brokenHorn: fx.horn>=3 && rnd()<0.34 ? (rnd()<0.5?-1:1) : 0,
    hornCurl: 0.6+rnd()*0.7,         // individual horn sweep
    gearTier: fx.gear
  };
}

// live-mob wrapper: effective INSTANCE stats + cache keyed on them
function effectiveStats(m,spec){
  return {
    id:m.id,
    hp:Math.max(1,Number(m.maxHp)||Number(spec&&spec.hp)||1),
    dmg:Math.max(0,(Number(spec&&spec.dmg)||0)*(Number(m.dmgMult)||1)),
    speed:(Number(spec&&spec.speed)||0)*(Number(m.speedMul)||1),
    alwaysAggro:!!(spec&&spec.alwaysAggro),
    menaceBias:Number(spec&&spec.menaceBias)||1,
    side:m.hostilitySide, tier:m.hostilityTier,
    seed:((Math.floor((Number(m.spawnT)||0)*7.31)>>>0)^((Number(m.maxHp)||0)*131|0))>>>0,
    spec
  };
}
export function lookFor(m,spec){
  if(!m || m.id==='ZLOTY' || !spec) return null;
  // allocation-free cache check on the hot draw path
  const hp=Number(m.maxHp)||0, dm=Number(m.dmgMult)||1;
  if(m._tlLook && m._tlHp===hp && m._tlDm===dm && m._tlSide===m.hostilitySide && m._tlTier===m.hostilityTier){
    return m._tlLook;
  }
  m._tlHp=hp; m._tlDm=dm; m._tlSide=m.hostilitySide; m._tlTier=m.hostilityTier;
  m._tlLook=buildLook(effectiveStats(m,spec));
  return m._tlLook;
}
export function refreshLook(m){ if(m){ m._tlHp=null; m._tlLook=null; } }

// Spawn-time mutation: allometric scale floor+growth and body-palette grading.
// Only called from create() — restored mobs keep their persisted scale/color.
export function applySpawnLook(m,spec){
  const look=lookFor(m,spec);
  if(!look) return null;
  const flyingCap=(spec.flying||spec.aquatic)?1.38:1.72;
  let sc=Number(m.scale)||1;
  if(look.minScale>0) sc=Math.max(sc,look.minScale);
  sc*=look.size;
  m.scale=Math.max(0.35,Math.min(flyingCap,sc));
  if(typeof m.baseColor==='string' && (look.sMul!==1 || look.lAdd!==0)){
    m.baseColor=gradeBodyColor(m.baseColor,look.sMul,look.lAdd);
  }
  return look;
}


// ---------------------------------------------------------------------------
// Organic draw primitives. Everything here is a tapered, curved, two-tone
// solid — the shapes real keratin and real muscle make. No outlines, no
// chevrons, no repeated glyph rows.

// A horn, a claw, a fang, a tusk: one continuous taper from a thick base to a
// point, curling as it grows. dx,dy is the growth direction; curl bends it.
function keratinSpur(ctx,x,y,dx,dy,len,thick,curl,col,tipCol){
  const steps=7;
  const L=[],R=[];
  const nx=-dy, ny=dx;                       // normal to the growth axis
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    const w=thick*(1-t)*(1-t*0.30);          // taper: thick root, fine point
    const px=x + dx*len*t + curl*len*t*t;    // quadratic curl, like real horn
    const py=y + dy*len*t - curl*len*t*t*0.18;
    L.push([px+nx*w*0.5, py+ny*w*0.5]);
    R.push([px-nx*w*0.5, py-ny*w*0.5]);
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0],L[0][1]);
  for(let i=1;i<=steps;i++) ctx.lineTo(L[i][0],L[i][1]);
  for(let i=steps;i>=0;i--) ctx.lineTo(R[i][0],R[i][1]);
  ctx.closePath();
  ctx.fillStyle=col; ctx.fill();
  // worn pale point, where the horn is polished by use
  ctx.beginPath();
  ctx.moveTo(L[steps-2][0],L[steps-2][1]);
  ctx.lineTo(L[steps][0],L[steps][1]);
  ctx.lineTo(R[steps-2][0],R[steps-2][1]);
  ctx.closePath();
  ctx.fillStyle=tipCol; ctx.fill();
}
// A dorsal fin: a smooth swept blade, not a saw-tooth.
function dorsalFin(ctx,x,y,dir,w,h,col,edge){
  ctx.beginPath();
  ctx.moveTo(x-dir*w*0.55, y);
  ctx.quadraticCurveTo(x-dir*w*0.10, y-h*1.05, x+dir*w*0.20, y-h);
  ctx.quadraticCurveTo(x+dir*w*0.34, y-h*0.34, x+dir*w*0.55, y+0.5);
  ctx.closePath();
  ctx.fillStyle=col; ctx.fill();
  ctx.beginPath();                            // leading edge catches the light
  ctx.moveTo(x-dir*w*0.55, y);
  ctx.quadraticCurveTo(x-dir*w*0.10, y-h*1.05, x+dir*w*0.20, y-h);
  ctx.strokeStyle=edge; ctx.lineWidth=1; ctx.stroke();
}
// lazily pre-baked additive glow sprite for the eye-shine (one per colour)
const glowSprites=new Map();
function glowSprite(col){
  if(glowSprites.has(col)) return glowSprites.get(col);
  let c=null;
  try{
    if(typeof document!=='undefined'){
      c=document.createElement('canvas'); c.width=c.height=32;
      const g=c.getContext('2d');
      // a soft falloff with no hard mid-stop: a stepped gradient composited with
      // 'lighter' draws a visible ring around the eye, which reads as a monocle
      const grad=g.createRadialGradient(16,16,0,16,16,16);
      grad.addColorStop(0,rgba(col,0.55));
      grad.addColorStop(0.35,rgba(col,0.24));
      grad.addColorStop(0.70,rgba(col,0.07));
      grad.addColorStop(1,rgba(col,0));
      g.fillStyle=grad; g.fillRect(0,0,32,32);
    }
  }catch(e){ c=null; }
  glowSprites.set(col,c);
  return c;
}

// ---------------------------------------------------------------------------
// The living eye. Everything is drawn through kx/ky, dividing out the mob's
// scale and bulk transforms, so the eye's SCREEN size never grows with the
// grade — only its colour, its glare and its glow do.
const PI2=Math.PI*2;
// anchors: one [x,y] for profile species, two for mobs that face the screen
function drawEyeAnatomy(ctx,m,look,g,geo,anchors,faceDir,baseCol,phase){
  const er=eyeRender(g);
  const col=look.eyeCol;
  const kx=1/(eyeScaleX(m,look)||1), ky=1/(eyeScaleY(m)||1);
  const twinDim=anchors.length>1?0.75:1;     // paired halos overlap; keep the sum calm
  const haloAt=(hx,hy)=>{
    if(er.haloAlpha<=0) return;
    const s=glowSprite(col);
    if(!s) return;
    const hw=er.haloR*kx, hh=er.haloR*ky;
    const prev=ctx.globalCompositeOperation;
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=(er.haloAlpha+0.06*Math.sin(phase*1.6))*twinDim;
    ctx.drawImage(s,hx-hw,hy-hh,hw*2,hh*2);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation=prev;
  };
  if(geo.mode==='dot'){
    // ember in a socket: bone, masks and the too-small-to-detail
    for(const [ex,ey] of anchors){
      ctx.fillStyle='rgba(12,9,7,0.78)';
      ctx.beginPath(); ctx.ellipse(ex,ey,(er.r+0.9)*kx,(er.r+0.9)*ky,0,0,PI2); ctx.fill();
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.ellipse(ex,ey,er.r*kx,er.r*ky,0,0,PI2); ctx.fill();
      haloAt(ex,ey);
    }
    return;
  }
  if(geo.mode==='compound'){
    // an arachnid face: one principal ocellus and two lesser ones, no lids
    const [ex,ey]=anchors[0];
    const r=geo.r;
    ctx.fillStyle='rgba(12,9,7,0.72)';
    ctx.beginPath(); ctx.ellipse(ex,ey,r*0.72*kx,r*0.72*ky,0,0,PI2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex-faceDir*r*0.85*kx,ey+r*0.30*ky,r*0.45*kx,r*0.45*ky,0,0,PI2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex+faceDir*r*0.60*kx,ey-r*0.45*ky,r*0.40*kx,r*0.40*ky,0,0,PI2); ctx.fill();
    ctx.fillStyle=col;
    ctx.beginPath(); ctx.ellipse(ex,ey,r*0.50*kx,r*0.50*ky,0,0,PI2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex-faceDir*r*0.85*kx,ey+r*0.30*ky,r*0.26*kx,r*0.26*ky,0,0,PI2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex+faceDir*r*0.60*kx,ey-r*0.45*ky,r*0.22*kx,r*0.22*ky,0,0,PI2); ctx.fill();
    haloAt(ex,ey);
    return;
  }
  // --- complex: full anatomy, once per visible eye ----------------------------
  const r=geo.r;
  const rx=v=>v*kx, ry=v=>v*ky;
  const aspect=geo.aspect||1;
  const scleraCol=g>=4 ? mixHex(geo.sclera||'#3b2d20','#7a1812',0.5) : (geo.sclera||'#3b2d20');
  const tMs=(typeof performance!=='undefined'&&performance.now)?performance.now():phase*200;
  const blink=geo.blink?blinkState(look.seed,tMs):0;  // both eyes blink as one
  const coverU=Math.min(1,EYE_LID_COVER[g]+blink);
  const coverL=blink*0.34;
  const lidCol=mixHex(baseCol,'#0d0906',0.34);
  const midX=anchors.length>1 ? (anchors[0][0]+anchors[1][0])*0.5 : null;
  for(const [ex,ey] of anchors){
    // a front-facing pair frowns toward the nose (the angry V-brow);
    // a profile eye slants against the facing direction
    const slant=midX==null ? -faceDir*0.16 : (ex<midX ? 0.16 : -0.16);
    // socket shadow seats the eye in the skull instead of floating on the fur
    ctx.fillStyle='rgba(10,7,5,0.38)';
    ctx.beginPath(); ctx.ellipse(ex,ey,rx(r*1.22*aspect),ry(r*1.22),0,0,PI2); ctx.fill();
    // everything else lives inside the visible eyeball
    ctx.save();
    ctx.beginPath(); ctx.ellipse(ex,ey,rx(r*aspect),ry(r),0,0,PI2); ctx.clip();
    // sclera: family-dark (a shark's is nearly black) — bloodshot from koszmarny up
    ctx.fillStyle=scleraCol;
    ctx.fillRect(ex-r*3,ey-r*3,r*6,r*6);
    // iris disc, darker at the rim, warmer around the pupil
    ctx.fillStyle=col;
    ctx.beginPath(); ctx.ellipse(ex,ey,rx(r*0.74),ry(r*0.74),0,0,PI2); ctx.fill();
    ctx.fillStyle=mixHex(col,'#ffe2a8',0.42);
    ctx.beginPath(); ctx.ellipse(ex,ey+ry(r*0.06),rx(r*0.40),ry(r*0.40),0,0,PI2); ctx.fill();
    // the pupil is the diet: slits hunt, bars graze, rounds think
    ctx.fillStyle='#0c0806';
    ctx.beginPath();
    if(geo.pupil==='slit') ctx.ellipse(ex+faceDir*rx(r*0.04),ey,rx(r*0.17),ry(r*0.60),0,0,PI2);
    else if(geo.pupil==='bar') ctx.ellipse(ex,ey,rx(r*0.56),ry(r*0.21),0,0,PI2);
    else ctx.ellipse(ex,ey,rx(r*0.34),ry(r*0.34),0,0,PI2);
    ctx.fill();
    // moist catch-light — the same light direction for both eyes of a pair
    ctx.fillStyle='rgba(255,250,238,0.85)';
    ctx.beginPath();
    ctx.ellipse(ex-faceDir*rx(r*0.26),ey-ry(r*0.30),rx(Math.max(0.5,r*0.15)),ry(Math.max(0.5,r*0.15)),0,0,PI2);
    ctx.fill();
    // lids: the resting glare narrows with the grade, and the eye BLINKS.
    // The iris is always drawn and the lids close OVER it, so a mid-blink frame
    // still carries the full anatomy underneath.
    if(coverU>0.01){
      ctx.fillStyle=lidCol;
      ctx.save();
      ctx.translate(ex,ey);
      ctx.rotate(slant);
      ctx.fillRect(-r*3,-ry(r)+ry(2*r)*coverU-r*6,r*6,r*6);
      ctx.restore();
    }
    if(coverL>0.01){
      ctx.fillStyle=lidCol;
      ctx.fillRect(ex-r*3,ey+ry(r)-ry(2*r)*coverL,r*6,r*6);
    }
    ctx.restore();
    // brow ridge: the heavier the species' brow, the deeper the eye sits
    if(geo.brow>0){
      ctx.fillStyle=rgba(mixHex(baseCol,'#0a0705',0.5),0.30+geo.brow*0.28);
      ctx.save();
      ctx.translate(ex,ey-ry(r*0.95));
      ctx.rotate(slant*0.7);
      ctx.beginPath(); ctx.ellipse(0,0,rx(r*(0.95+0.25*geo.brow)*aspect),ry(r*0.30),0,0,PI2); ctx.fill();
      ctx.restore();
    }
    haloAt(ex,ey);
  }
}

// ---------------------------------------------------------------------------
// pre-draw: allometric bulk + a forward-weighted stance. Feet stay planted.
export function drawThreatLookPre(ctx,TILE,m,spec,sx,sy,faceDir){
  const look=lookFor(m,spec);
  if(!look || look.grade<2) return;
  const bulk=look.bulk, lean=(spec.flying||spec.aquatic)?0:look.lean;
  if(bulk===1 && lean===0) return;
  const footY=sy+((spec.body&&spec.body.h)||1)*0.5*TILE;
  ctx.translate(sx,footY);
  ctx.transform(bulk,0,-faceDir*lean,1,0,0);
  ctx.translate(-sx,-footY);
}

// ---------------------------------------------------------------------------
// post-draw anatomy. artTop = the highest pixel the species art really drew
// this frame, so nothing floats above a head that isn't there.
export function drawThreatLookPost(ctx,TILE,m,spec,sx,sy,faceDir,phase,artTop,hpTop){
  const look=lookFor(m,spec);
  if(!look || look.grade<2) return;
  const fx=look.fx, g=look.grade, fam=look.family, meta=look.meta;
  const body=(spec&&spec.body)||{w:1,h:1};
  const bw=Math.max(10,(body.w||1)*TILE);
  const colH=(body.h||1)*TILE;                 // collider height ≈ the torso
  const footY=sy+Math.max(2,colH*0.5);
  const top=Math.min(artTop,sy-4);
  const bh=Math.max(8,footY-top);
  const base=typeof m.baseColor==='string' ? m.baseColor : '#8a7a66';
  const lit=mixHex(base,'#ffffff',0.20);       // where the light rakes the hide
  const keratin=look.keratin;
  const keratinRoot=mixHex(keratin,'#2a1f10',0.38);
  const keratinTip=mixHex(keratin,'#fff4dc',0.42);
  const organic=spec.organic!==false;
  const pred=!!(meta&&meta.pred);
  const grounded=!!spec.ground;
  ctx.save();

  // -- weight: a heavier animal presses a broader, darker contact shadow -------
  if(fx.shadow>0 && grounded){
    ctx.fillStyle='rgba(0,0,0,'+(0.05+fx.shadow*0.10).toFixed(3)+')';
    ctx.beginPath();
    ctx.ellipse(sx,footY-0.5,bw*(0.30+fx.shadow*0.18),Math.max(1.6,bw*0.07),0,0,Math.PI*2);
    ctx.fill();
  }

  // -- build: muscle piles over the shoulders (bears, bison, big cats, apes) ---
  const canHump = fam==='beast'||fam==='cervid'||fam==='humanoid'||fam==='dragon';
  if(fx.hump>0 && canHump){
    const wx = meta&&meta.withers ? sx+faceDir*meta.withers[0] : sx+faceDir*bw*0.14;
    const wy = meta&&meta.withers ? sy+meta.withers[1] : sy-colH*0.5;
    // sized off the COLLIDER, never off the art top: the hump raises the art top,
    // and feeding that back in would grow a mountain on the animal's back
    const ww = Math.max(6, bw*(fam==='humanoid'?0.50:0.44));
    const wh = fx.hump*(2.2+colH*0.10);
    ctx.fillStyle=mixHex(base,'#100b06',0.16);   // mass sits in its own shade
    ctx.beginPath();
    ctx.moveTo(wx-ww*0.5, wy+1.5);
    ctx.quadraticCurveTo(wx-ww*0.18, wy-wh, wx+faceDir*ww*0.12, wy-wh*0.94);
    ctx.quadraticCurveTo(wx+ww*0.40, wy-wh*0.42, wx+ww*0.5, wy+1.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle=rgba(lit,0.38);              // light rakes over the crest
    ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(wx-ww*0.34, wy-wh*0.46);
    ctx.quadraticCurveTo(wx-ww*0.10, wy-wh*0.96, wx+faceDir*ww*0.10, wy-wh*0.90);
    ctx.stroke();
    hpTop(wy-wh);
  }

  // -- hide: an old coat is mottled and matted. This is the SAME hide, lighter or
  //    darker — never a foreign colour, or it reads as a hole in the animal.
  if(fx.weather>0 && look.patches.length && fam!=='wisp' && fam!=='jelly'){
    const tw=bw*0.78, th=colH;                 // stay inside the torso
    const cy=footY-colH*0.55;
    for(const p of look.patches){
      const col=p.pale ? mixHex(base,'#ffffff',p.d*0.55) : mixHex(base,'#000000',p.d*0.85);
      ctx.fillStyle=rgba(col,organic?0.30:0.22);
      ctx.beginPath();
      ctx.ellipse(sx+p.fx*tw, cy+(p.fy-0.5)*th, Math.max(1.4,p.rx*tw), Math.max(1.2,p.ry*th), 0, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // -- horn: cervids, bovids and the dragon. It thickens, darkens and curls.
  //    This is a PROFILE view: both horns sweep the same way, the far one set
  //    back and shaded. Mirroring them left/right would draw a front-on V that
  //    floats off the skull.
  const horned = fam==='cervid' || fam==='dragon' || !!(meta&&meta.horns);
  if(fx.horn>0 && horned && meta && typeof meta.hornX==='number'){
    const hx=sx+faceDir*meta.hornX, hy=sy+meta.hornY;
    const cervid=fam==='cervid';
    const len=(cervid?3.0:3.5)+fx.horn*(cervid?2.4:1.9);
    const thick=1.5+fx.horn*(cervid?0.42:0.62);
    // antlers rake back over the spine; bovid horns drive forward off the brow
    const dirX=cervid ? -faceDir*0.34 : faceDir*0.50;
    const dirY=cervid ? -0.94 : -0.86;
    const curl=(cervid?-faceDir:faceDir)*look.hornCurl*(cervid?0.22:0.42);
    const tines=cervid ? Math.max(1,Math.min(3,fx.horn-1)) : 1;
    const far=mixHex(keratinRoot,'#000000',0.30);
    for(const side of [{d:-1,col:far,tip:far,l:0.86},{d:1,col:keratinRoot,tip:keratinTip,l:1}]){
      const snapped=look.brokenHorn===side.d;   // this one lost a fight, once
      const rootX=hx-faceDir*(side.d<0?2.4:0);
      const rootY=hy-(side.d<0?1.2:0);
      for(let i=0;i<tines;i++){
        const l=len*side.l*(1-i*0.24)*(snapped?0.52:1);
        keratinSpur(ctx,rootX+dirX*i*2.2,rootY-i*2.2,dirX+(cervid?-faceDir*i*0.16:0),dirY+i*0.12,
          l,thick*(1-i*0.20),curl,side.col,snapped?side.col:side.tip);
        if(rootY-l<top) hpTop(rootY-l);
      }
    }
  }

  // -- claw: carnivores only, on the planted forefoot. Real claw horn is dark and
  //    curls forward from the TOE — it does not hang below the foot like a tooth.
  if(fx.claw>0 && pred && grounded && fam!=='amorph'){
    const paw=meta&&meta.paw;
    const px=paw? sx+faceDir*paw[0] : sx+faceDir*bw*0.24;
    const py=paw? sy+paw[1] : footY-2;
    const n=Math.min(3,fx.claw);
    const clawTip=mixHex(keratin,'#e0d2b8',0.18);
    for(let i=0;i<n;i++){
      keratinSpur(ctx,px+faceDir*i*1.9,py-i*0.5,faceDir*0.94,0.34,1.8+fx.claw*0.62,1.3+fx.claw*0.20,
        faceDir*0.22,keratinRoot,clawTip);
    }
  }

  // -- fang: the jaw of a carnivore, never a herbivore ------------------------------
  const eyeA=meta&&meta.eye;
  const headX=eyeA? sx+faceDir*eyeA[0] : sx+faceDir*bw*(fam==='avian'?0.18:fam==='humanoid'?0.10:0.34);
  const headY=eyeA? sy+eyeA[1] : top+bh*(fam==='humanoid'?0.12:fam==='aquatic'?0.42:0.24);
  const jawA=meta&&meta.jaw;
  if(fx.fang>0 && pred && organic && fam!=='wisp' && fam!=='construct'){
    const jx=jawA? sx+faceDir*jawA[0] : headX+faceDir*4;
    const jy=jawA? sy+jawA[1] : headY+4;
    const n=Math.min(3,fx.fang);
    const ivory=mixHex('#e9dfc6','#8a7a5e',0.22);
    for(let i=0;i<n;i++){
      keratinSpur(ctx,jx-faceDir*i*1.9,jy,-faceDir*0.14,0.99,1.6+fx.fang*0.55,1.1+fx.fang*0.22,
        -faceDir*0.06,ivory,'#f8f2e4');
    }
  }

  // -- fin: swimmers get a taller, swept dorsal — one blade, not a saw ------------
  if(fx.fin>0 && (fam==='aquatic'||fam==='serpent')){
    const f=meta&&meta.fin;
    const fx0=f? sx+faceDir*f[0] : sx;
    const fy0=f? sy+f[1] : sy-colH*0.42;
    dorsalFin(ctx,fx0,fy0+1,faceDir,bw*0.34,3+fx.fin*(3+bh*0.10),mixHex(base,'#0c0f14',0.30),rgba(lit,0.45));
    hpTop(fy0-3-fx.fin*(3+bh*0.10));
  }

  // -- eye-shine: the tapetum of a hunter. It reads by CONTRAST — a dark socket
  //    around a small hot pupil — not by bloom. A big additive halo just washes
  //    the animal out against a bright sky and hides the very mass we built.
  if(fx.eye>0 && look.eyeCol){
    const geo=eyeGeometry(m,spec,look);
    if(geo.mode!=='none'){
      // two eyes for a face that meets yours, one for a profile
      const anchors=(meta&&Array.isArray(meta.eyes))
        ? [[sx+faceDir*meta.eyes[0][0],sy+meta.eyes[0][1]],[sx+faceDir*meta.eyes[1][0],sy+meta.eyes[1][1]]]
        : geo.twin ? [[headX-2.1,headY],[headX+2.3,headY]]
        : [[headX,headY]];
      drawEyeAnatomy(ctx,m,look,g,geo,anchors,faceDir,base,phase);
    }
  }

  // -- breath: a big warm body in cold air; a furnace on the hot side --------------
  if(fx.breath>0 && organic && fam!=='wisp' && fam!=='jelly'){
    const cycle=(phase*0.30)%1;                 // slow, heavy respiration
    const push=cycle<0.42 ? cycle/0.42 : 0;     // exhale, then nothing
    if(push>0){
      const n=1+fx.breath;
      for(let i=0;i<n;i++){
        const t2=push*(1-i*0.22);
        const bxp=headX+faceDir*(4+t2*(9+i*3));
        const byp=headY+4-t2*(4+i*2);
        const r=1.4+t2*(2.2+i*0.9);
        ctx.fillStyle=rgba(look.breath,0.30*(1-t2)*(1-i*0.18));
        ctx.beginPath(); ctx.arc(bxp,byp,r,0,Math.PI*2); ctx.fill();
      }
    }
  }

  // -- dust: an apex body displaces the ground it stands on -------------------------
  if(fx.dust>0 && grounded){
    for(let i=0;i<fx.dust*2;i++){
      const t2=((phase*0.22)+i*0.31)%1;
      const dxp=sx+((i%2)?-1:1)*bw*(0.22+t2*0.26);
      const dyp=footY-t2*(3+fx.dust*2.5);
      ctx.fillStyle=rgba(mixHex(base,'#8d8172',0.55),0.16*(1-t2));
      ctx.fillRect(dxp,dyp,1.3,1.3);
    }
  }

  // -- gear: only for the species that actually carry one -----------------------------
  if(look.gearTier>0 && meta && meta.gear){
    drawGear(ctx,look,meta,m,sx,sy,faceDir,phase,hpTop,keratinRoot);
  }

  ctx.restore();
}

// Gear ages the way a weapon does: a plain shaft gains a forged head, then a
// worked one, then the marks of long use and hard metal.
//   1 reinforced (g3) · 2 forged (g4) · 3 master-work (g5)
const GEAR_WOOD='#6b4a2b';
const GEAR_METAL=['#8a6a3c','#9aa0a6','#cbd2d8','#f0d894'];
function drawGear(ctx,look,meta,m,sx,sy,faceDir,phase,hpTop,dark){
  const tier=Math.max(1,Math.min(3,look.gearTier));
  const metal=GEAR_METAL[tier];
  const edge=mixHex(metal,'#ffffff',0.35);
  if(meta.gear==='bow'){
    // the skeleton's bow: bound tips → a deeper recurve → a heavier war bow
    const bx=sx+faceDir*8, by=sy-14;
    const r=5+tier*0.9;
    ctx.strokeStyle=tier>=2?metal:GEAR_WOOD;
    ctx.lineWidth=1.2+tier*0.5;
    ctx.beginPath();
    ctx.arc(bx,by,r,faceDir>0?-1.18:Math.PI-1.18,faceDir>0?1.18:Math.PI+1.18);
    ctx.stroke();
    ctx.strokeStyle='rgba(228,222,206,0.85)';
    ctx.lineWidth=0.9;
    ctx.beginPath();
    ctx.moveTo(bx+faceDir*r*0.38,by-r*0.90);
    ctx.lineTo(bx+faceDir*r*0.38,by+r*0.90);
    ctx.stroke();
    if(tier>=3){                                 // a nocked arrow, ready
      ctx.strokeStyle=edge; ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.moveTo(bx-faceDir*3,by);
      ctx.lineTo(bx+faceDir*(r+4),by);
      ctx.stroke();
    }
    hpTop(by-r);
  } else if(meta.gear==='halberd'){
    // temple guard: a stave, then a forged head, then a long war blade
    const gx=sx+faceDir*(meta.handX||-12), gy=sy+(meta.handY||-18);
    ctx.strokeStyle=GEAR_WOOD; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(gx,gy+10); ctx.lineTo(gx,gy-8); ctx.stroke();
    const bladeL=5+tier*3.2;
    keratinSpur(ctx,gx,gy-8,-faceDir*0.18,-1,bladeL,2.2+tier*0.9,-faceDir*0.10,metal,edge);
    if(tier>=2){                                  // the beard of the axe head
      ctx.fillStyle=metal;
      ctx.beginPath();
      ctx.moveTo(gx,gy-8);
      ctx.quadraticCurveTo(gx-faceDir*(4+tier*1.6),gy-10-tier,gx-faceDir*1.2,gy-13-tier*1.6);
      ctx.closePath(); ctx.fill();
    }
    hpTop(gy-8-bladeL);
  } else if(meta.gear==='hammer'){
    // dwarf: the head grows heavier. Skipped while the arm is mid-swing.
    if(m && (m.state==='hammer' || m.state==='throw')) return;
    const hx=sx+faceDir*(meta.handX||13), hy=sy+(meta.handY||-14);
    const hw=4+tier*1.5, hh=3+tier*1.1;
    ctx.fillStyle=dark;
    ctx.fillRect(hx-faceDir*1-hw*0.5,hy-hh*0.5-1,hw,hh+2);
    ctx.fillStyle=metal;
    ctx.fillRect(hx-faceDir*1-hw*0.5,hy-hh*0.5,hw,hh);
    ctx.fillStyle=edge;
    ctx.fillRect(hx-faceDir*1-hw*0.5,hy-hh*0.5,hw,1);
    if(tier>=3){                                   // a bearded head, hard-used
      ctx.fillStyle=metal;
      ctx.beginPath();
      ctx.moveTo(hx-faceDir*(1+hw*0.5),hy-hh*0.5);
      ctx.lineTo(hx-faceDir*(4+hw*0.5),hy);
      ctx.lineTo(hx-faceDir*(1+hw*0.5),hy+hh*0.5);
      ctx.closePath(); ctx.fill();
    }
  } else if(meta.gear==='staff'){
    // shaman: the focus at the head of the staff swells and starts to burn
    const gx=sx+faceDir*(meta.handX||-12), gy=sy+(meta.handY||-33);
    ctx.strokeStyle=GEAR_WOOD; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(gx,gy+4); ctx.lineTo(gx,gy+30); ctx.stroke();
    const r=2+tier*1.1;
    const col=look.breath;
    if(tier>=2){
      const s=glowSprite(col);
      if(s){
        const gr=r*3.2;
        const prev=ctx.globalCompositeOperation;
        ctx.globalCompositeOperation='lighter';
        ctx.globalAlpha=0.40+0.14*Math.sin(phase*2.1);
        ctx.drawImage(s,gx-gr,gy-gr,gr*2,gr*2);
        ctx.globalAlpha=1;
        ctx.globalCompositeOperation=prev;
      }
    }
    ctx.fillStyle=col;
    ctx.beginPath(); ctx.arc(gx,gy,r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=mixHex(col,'#ffffff',0.5);
    ctx.beginPath(); ctx.arc(gx-r*0.28,gy-r*0.28,r*0.36,0,Math.PI*2); ctx.fill();
    hpTop(gy-r*2);
  }
}

// ---------------------------------------------------------------------------
const threatLook={
  menacePower, menaceScore, buildLook, lookFor, refreshLook, applySpawnLook,
  gradeBodyColor, eyeRender, eyeScaleX, eyeScaleY, eyeGeometry, blinkState,
  drawPre:drawThreatLookPre, drawPost:drawThreatLookPost,
  GRADE_FX, GRADE_PALETTE, SPECIES_LOOK,
  THREAT_GRADE_NAMES, THREAT_GRADE_THRESHOLDS
};
try{
  if(typeof window!=='undefined'){ (window.MM=window.MM||{}).threatLook=threatLook; }
}catch(e){ /* headless import */ }
export default threatLook;
export { threatLook };
