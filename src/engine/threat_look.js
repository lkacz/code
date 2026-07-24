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
//  - eyes          : NATIVE only — each species' own art eye pixels are tinted
//                    toward hot red via menaceEyeColor(); no overlay eyeball is
//                    ever drawn on top of a face (that template stare was
//                    rejected: every mob wore the same strange eyes)
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
  //          silhouette                    build            hide      keratin                 presence               tools
  {size:0.94, minScale:0,    bulk:1.00, lean:0,     hump:0,    weather:0, horn:0, claw:0, fang:0, fin:0,    breath:0, dust:0, shadow:0,    gear:0},
  {size:1.00, minScale:0,    bulk:1.00, lean:0,     hump:0,    weather:0, horn:0, claw:0, fang:0, fin:0,    breath:0, dust:0, shadow:0,    gear:0},
  {size:1.06, minScale:0.86, bulk:1.02, lean:0.015, hump:0.30, weather:1, horn:1, claw:1, fang:0, fin:0.35, breath:0, dust:0, shadow:0.18, gear:0},
  {size:1.13, minScale:0.94, bulk:1.05, lean:0.035, hump:0.55, weather:2, horn:2, claw:2, fang:1, fin:0.60, breath:0, dust:0, shadow:0.30, gear:1},
  {size:1.21, minScale:1.02, bulk:1.09, lean:0.055, hump:0.80, weather:3, horn:3, claw:3, fang:2, fin:0.82, breath:1, dust:1, shadow:0.42, gear:2},
  {size:1.32, minScale:1.10, bulk:1.14, lean:0.080, hump:1.00, weather:4, horn:4, claw:3, fang:3, fin:1.00, breath:2, dust:2, shadow:0.55, gear:3}
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
// Native menace eyes. The engine draws NO eye of its own — every face keeps
// exactly the eyes its hand-drawn art gave it (an owl's amber discs, a wolf's
// brown fleck, a skeleton's dark sockets). What the grade controls is only the
// COLOUR of those existing pixels: the art's own base colour is pulled toward
// an unmistakable hot red as the menace climbs. Identity at the bottom of the
// ladder (every species starts from its own art colour), pure danger at the
// top. Grades 0–1 return the art colour untouched.
//
// mobs.js wires this per species via its draw-loop eyeTint() helper — the ONE
// overlay this must never become again is a shared eyeball template stamped
// over the art.
const EYE_COLORS=[null,null,'#e9922e','#f4571c','#fa1f0c','#ff0400'];
const EYE_MENACE_MIX=[0,0,0.45,0.65,0.82,0.96];
export function menaceEyeColor(look,baseHex){
  let base=typeof baseHex==='string' ? baseHex : '#000000';
  // the art writes short hex ('#fff') which the mixer would misread
  if(/^#[0-9a-fA-F]{3}$/.test(base)) base='#'+base[1]+base[1]+base[2]+base[2]+base[3]+base[3];
  if(!look) return base;
  const g=Math.max(0,Math.min(5,Number(look.grade)||0));
  if(!EYE_COLORS[g]) return base;
  return mixHex(base,EYE_COLORS[g],EYE_MENACE_MIX[g]);
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
//   eye     [forwardPx, upPx]  from (sx,sy); forward is flipped by faceDir.
//           This is the HEAD anchor (fangs and breath hang off it) — the eyes
//           themselves live in each species' own art, never in this engine
//   withers [forwardPx, topPx] the shoulder line where muscle mass piles up
//   pred    carnivore: may grow claws and fangs
//   horns   grows horn even though it is not a cervid (goat, bison)
export const SPECIES_LOOK={
  // --- prey & critters: never express weapons, only size and coat -------------
  SQUIRREL:{family:'beast'}, RABBIT:{family:'beast'}, ZABA:{family:'amorph'},
  BARK_BEETLE:{family:'beast'}, SNOW_HARE:{family:'beast'}, HEARTWOOD_TREANT:{family:'beast'},
  FIREFLY:{family:'wisp'},
  JASZCZUR:{family:'beast', pred:true, eye:[5,-7], withers:[2,-6], jaw:[8,-4]},
  FISH:{family:'aquatic'},
  BIRD:{family:'avian', eye:[5,-6]},
  OWL:{family:'avian', pred:true},
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
  SHARK:{family:'aquatic', pred:true, fin:[0,-5]},
  EEL:{family:'serpent', pred:true, fin:[0,-3]},
  LAKE_SERPENT:{family:'serpent', pred:true, fin:[0,-4]},
  JACKPOT_WHALE:{family:'aquatic', pred:true, fin:[-4,-12]},
  ATLANTIS_MEDUZA:{family:'jelly'},
  // --- desert / swamp / mountain ----------------------------------------------
  SAND_WORM:{family:'serpent', pred:true, fin:[-2,-8]},
  GIANT_SCORPION:{family:'arthropod', pred:true, eye:[14,-16]},
  BOG_LURKER:{family:'amorph', pred:true},
  BRAMBLE_STALKER:{family:'amorph', pred:true},
  STONE_GOLEM:{family:'construct'},
  VULTURE:{family:'avian', pred:true}, VULTURE_HATCHLING:{family:'avian'},
  JACKPOT_YETI:{family:'humanoid', pred:true, withers:[0,-30]},
  // --- night & undead ----------------------------------------------------------
  GHOUL:{family:'humanoid', pred:true, eye:[5,-25], withers:[0,-22], jaw:[8,-21], paw:[8,-1]},
  SZKIELET:{family:'humanoid', eye:[1,-24], withers:[0,-20], gear:'bow'},
  PELZACZ:{family:'arthropod', pred:true},
  ICE_WRAITH:{family:'wisp'},
  // --- tool users & guardians ---------------------------------------------------
  TEMPLE_GUARD:{family:'humanoid', eye:[3,-25], withers:[0,-22], gear:'halberd', handX:-12, handY:-18},
  GOLD_DWARF_GUARD:{family:'humanoid', eye:[2,-23], withers:[0,-20], gear:'hammer', handX:13, handY:-14},
  ICE_SHAMAN:{family:'humanoid', eye:[2,-26], withers:[0,-22], gear:'staff', handX:-12, handY:-33},
  FIRE_SHAMAN:{family:'humanoid', eye:[2,-26], withers:[0,-22], gear:'staff', handX:-12, handY:-33},
  SOOT_SHAMAN:{family:'humanoid', eye:[2,-26], withers:[0,-22], gear:'staff', handX:-12, handY:-33},
  STRAZNIK:{family:'construct'}, ATOMIC_BOMB:{family:'construct'},
  RADIATION_COCKROACH:{family:'arthropod'},
  GOLD_DRAGON:{family:'dragon', pred:true, eye:[40,-42], hornX:33, hornY:-51, withers:[6,-31], jaw:[46,-34], paw:[18,-1]},
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
const _spurLx=new Float64Array(8),_spurLy=new Float64Array(8),_spurRx=new Float64Array(8),_spurRy=new Float64Array(8);
function keratinSpur(ctx,x,y,dx,dy,len,thick,curl,col,tipCol){
  const steps=7;
  const nx=-dy, ny=dx;                       // normal to the growth axis
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    const w=thick*(1-t)*(1-t*0.30);          // taper: thick root, fine point
    const px=x + dx*len*t + curl*len*t*t;    // quadratic curl, like real horn
    const py=y + dy*len*t - curl*len*t*t*0.18;
    _spurLx[i]=px+nx*w*0.5; _spurLy[i]=py+ny*w*0.5;
    _spurRx[i]=px-nx*w*0.5; _spurRy[i]=py-ny*w*0.5;
  }
  ctx.beginPath();
  ctx.moveTo(_spurLx[0],_spurLy[0]);
  for(let i=1;i<=steps;i++) ctx.lineTo(_spurLx[i],_spurLy[i]);
  for(let i=steps;i>=0;i--) ctx.lineTo(_spurRx[i],_spurRy[i]);
  ctx.closePath();
  ctx.fillStyle=col; ctx.fill();
  // worn pale point, where the horn is polished by use
  ctx.beginPath();
  ctx.moveTo(_spurLx[steps-2],_spurLy[steps-2]);
  ctx.lineTo(_spurLx[steps],_spurLy[steps]);
  ctx.lineTo(_spurRx[steps-2],_spurRy[steps-2]);
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
  const fx=look.fx, fam=look.family, meta=look.meta;
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

  // (The eyes are NOT drawn here. Each species' art owns its eyes; the draw
  //  loop in mobs.js tints those pixels via menaceEyeColor — an engine-drawn
  //  eyeball over the art read as the same alien stare on every mob.)

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
  gradeBodyColor, menaceEyeColor,
  drawPre:drawThreatLookPre, drawPost:drawThreatLookPost,
  GRADE_FX, GRADE_PALETTE, SPECIES_LOOK,
  THREAT_GRADE_NAMES, THREAT_GRADE_THRESHOLDS
};
try{
  if(typeof window!=='undefined'){ (window.MM=window.MM||{}).threatLook=threatLook; }
}catch(e){ /* headless import */ }
export default threatLook;
export { threatLook };
