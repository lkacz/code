// Threat-look ("Groza") contract: the stronger the mob, the stronger it LOOKS.
// Pins the whole visual-menace ladder:
//  - menace score is monotonic in hp and dmg; thresholds ascend inside (0,1)
//  - the REAL bestiary (stats parsed from mobs.js source) lands in the intended
//    grade bands — squirrels read harmless, gold dragons read nightmarish,
//    sky bosses read apex; a far-world (hostility-scaled) wolf out-menaces its
//    center-world twin
//  - per-grade feature intensities (size/bulk/lean/hump/horns/claws/fangs/
//    fins/gear) are monotonic, palettes darken & saturate
//  - eyes are NATIVE: menaceEyeColor tints each species' OWN art eye pixels
//    toward red with the grade; the engine draws no eyeball of its own — the
//    shared overlay stare (socket/iris/lids/halo template) is pinned dead
//  - looks are deterministic per seed; spawn mutation respects physics caps
//  - every species declared in mobs.js is consciously mapped in SPECIES_LOOK
//  - mobs.js wiring pins: spawn hook, drawPre posture, drawPost layers on the
//    real art top, the old drawMobThreatMarks decal system is gone
//  - draw smoke: every family renders at every grade on a stub 2D context
// Run: node tools/threat-look-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

const TL = await import('../src/engine/threat_look.js');
const {
  menaceScore, buildLook, lookFor, applySpawnLook, gradeBodyColor, menaceEyeColor,
  drawThreatLookPre, drawThreatLookPost,
  GRADE_FX, GRADE_PALETTE, SPECIES_LOOK, THREAT_GRADE_NAMES, THREAT_GRADE_THRESHOLDS
} = TL;

const mobsSrc = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');

// --- thresholds & names ------------------------------------------------------
assert.equal(THREAT_GRADE_NAMES.length, 6, 'six grades');
assert.equal(THREAT_GRADE_THRESHOLDS.length, 5, 'five thresholds');
for(let i=0;i<THREAT_GRADE_THRESHOLDS.length;i++){
  const t=THREAT_GRADE_THRESHOLDS[i];
  assert.ok(t>0 && t<1, 'threshold in (0,1)');
  if(i) assert.ok(t>THREAT_GRADE_THRESHOLDS[i-1], 'thresholds ascend');
}

// --- menace monotonicity -----------------------------------------------------
for(let hp=2; hp<=800; hp=Math.ceil(hp*1.6)){
  const a=menaceScore({hp, dmg:10, speed:3});
  const b=menaceScore({hp:hp*1.5, dmg:10, speed:3});
  assert.ok(b.t>a.t, 'menace strictly increases with hp ('+hp+')');
}
for(let dmg=0; dmg<=44; dmg+=6){
  const a=menaceScore({hp:40, dmg, speed:3});
  const b=menaceScore({hp:40, dmg:dmg+5, speed:3});
  assert.ok(b.t>a.t, 'menace strictly increases with dmg ('+dmg+')');
}

// --- parse the REAL bestiary out of mobs.js source ----------------------------
function parseSpecies(src){
  const out={};
  // Production stats may use a named numeric constant so gameplay, rendering and
  // save migration can share one value. Resolve those simple constants instead of
  // forcing species declarations to duplicate a magic number for this audit.
  const constants={};
  for(const hit of src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(-?[\d.]+)\s*;/g))
    constants[hit[1]]=Number(hit[2]);
  const re=/id:\s*'([A-Z_]+)'/g;
  let m;
  while((m=re.exec(src))){
    const id=m[1];
    if(out[id]) continue;
    const win=src.slice(m.index, m.index+520);
    const num=(k)=>{
      const h=win.match(new RegExp(k+':\\s*([A-Z][A-Z0-9_]*|-?[\\d.]+)'));
      if(!h) return null;
      return Object.prototype.hasOwnProperty.call(constants,h[1]) ? constants[h[1]] : Number(h[1]);
    };
    const hp=num('hp'), dmg=num('dmg');
    if(hp==null || dmg==null) continue; // not a species literal (e.g. serialized refs)
    out[id]={
      id, hp, dmg,
      speed:num('speed')||0,
      menaceBias:num('menaceBias')||1,
      alwaysAggro:/alwaysAggro\s*:\s*true/.test(win),
      organicFalse:/organic\s*:\s*false/.test(win),
      flying:/flying\s*:\s*true/.test(win),
      aquatic:/aquatic\s*:\s*true/.test(win)
    };
  }
  return out;
}
const SPECIES=parseSpecies(mobsSrc);
assert.ok(Object.keys(SPECIES).length>=55, 'parsed the species registry ('+Object.keys(SPECIES).length+')');

function gradeOf(id){
  const s=SPECIES[id];
  assert.ok(s, 'species parsed: '+id);
  return menaceScore(s).grade;
}

// --- the bestiary ladder (exact pins away from boundaries, ranges near them) --
const EXACT={
  FIREFLY:0, SQUIRREL:0, RABBIT:0, ZABA:0,
  BIRD:1, OWL:1, DEER:1,
  WOLF:2, GHOUL:2, BEAR:2, SZKIELET:2, TEMPLE_GUARD:2, STRAZNIK:2, PELZACZ:2,
  THUNDER_BISON:3, SHARK:3, STONE_GOLEM:3, SAND_WORM:3, GOLD_DWARF_GUARD:3,
  ZIMOWY_NIEDZWIEDZ:3, ICE_SHAMAN:3, FIRE_SHAMAN:3, HARPY:3, CLOUD_RAY:3,
  GIANT_SCORPION:4, JACKPOT_YETI:4,
  GRAVITY_COLOSSUS:5, SPORE_MOTHER:5, SKYGROVE_WARDEN:5, CORSAIR_AUTOMATON:5, AURORA_WYRM:5
};
for(const id in EXACT){
  assert.equal(gradeOf(id), EXACT[id], id+' grade (t='+menaceScore(SPECIES[id]).t.toFixed(3)+')');
}
const RANGE={
  FISH:[0,1], GOAT:[1,2], PIRANHA:[1,2], BAT:[1,2], CRAB:[1,2],
  ICE_WRAITH:[2,3], ATLANTIS_MEDUZA:[2,3], WIOSENNY_JELEN:[2,3], RADIATION_COCKROACH:[2,3],
  // The bomb's 8000-point armoured shell is intentionally an apex-level threat.
  ATOMIC_BOMB:[5,5], LAKE_SERPENT:[2,3],
  GOLD_DRAGON:[4,5], JACKPOT_WHALE:[4,5], MIRAGE_DJINN:[4,5],
  SKY_SERAPH:[4,5], STORM_HERALD:[4,5], BALLOON_TYRANT:[4,5], HARPY_QUEEN:[4,5], EMBER_PHOENIX:[4,5]
};
for(const id in RANGE){
  const g=gradeOf(id);
  assert.ok(g>=RANGE[id][0] && g<=RANGE[id][1], id+' grade '+g+' in ['+RANGE[id]+'] (t='+menaceScore(SPECIES[id]).t.toFixed(3)+')');
}
// the arc of dread is strictly readable across the classic encounter ladder
const LADDER=['SQUIRREL','BIRD','WOLF','THUNDER_BISON','GIANT_SCORPION','GRAVITY_COLOSSUS'];
for(let i=1;i<LADDER.length;i++){
  assert.ok(gradeOf(LADDER[i])>gradeOf(LADDER[i-1]), LADDER[i-1]+' < '+LADDER[i]);
}

// --- instance escalation: hostility-scaled veterans climb the ladder ----------
{
  const wolf=SPECIES.WOLF;
  const near=menaceScore(wolf);
  const far=menaceScore({...wolf, hp:wolf.hp*2.3, dmg:wolf.dmg*1.9});
  assert.ok(far.grade>=near.grade+1, 'far-world wolf reads at least one grade angrier ('+near.grade+' -> '+far.grade+')');
}

// --- per-grade intensities are monotonic --------------------------------------
assert.equal(GRADE_FX.length, 6, 'one fx row per grade');
const KEYS=['size','minScale','bulk','lean','hump','weather','horn','claw','fang','fin','breath','dust','shadow','gear'];
for(const k of KEYS){
  for(let g=1; g<6; g++){
    assert.ok(GRADE_FX[g][k]>=GRADE_FX[g-1][k], 'GRADE_FX.'+k+' nondecreasing at g'+g);
  }
}
assert.ok(GRADE_FX[5].size>GRADE_FX[1].size, 'apex is visibly bigger');
assert.ok(GRADE_FX[0].size<1, 'harmless prey reads softer/smaller');
// the escalation must be ORGANIC: no schematic decal channels may come back.
// 'eye' is banned too — the engine-drawn eye overlay is dead; eyes are native
// art pixels tinted through menaceEyeColor, never a drawn channel.
for(const banned of ['spikes','plates','bands','aura','scars','motes','eye']){
  assert.ok(!(banned in GRADE_FX[5]), 'decal channel "'+banned+'" must stay dead');
}
for(let g=2; g<6; g++){
  assert.ok(GRADE_PALETTE[g].sMul>=GRADE_PALETTE[g-1].sMul, 'palette saturates upward');
  assert.ok(GRADE_PALETTE[g].lAdd<=GRADE_PALETTE[g-1].lAdd, 'palette darkens upward');
}
assert.ok(GRADE_PALETTE[0].lAdd>0 && GRADE_PALETTE[0].sMul<1, 'grade 0 is pale and drab');

// gradeBodyColor really moves saturation & lightness the way the table says
{
  const base='#8a6a3c';
  const dark=gradeBodyColor(base, 1.4, -0.13);
  const pale=gradeBodyColor(base, 0.8, +0.07);
  const lum=h=>{ const n=parseInt(h.slice(1),16); return ((n>>16)&255)*0.299+((n>>8)&255)*0.587+(n&255)*0.114; };
  assert.ok(lum(dark)<lum(base), 'apex grading darkens');
  assert.ok(lum(pale)>lum(base), 'prey grading lightens');
}

// --- determinism & per-individual variation -----------------------------------
{
  const a=buildLook({id:'WOLF', hp:40, dmg:12, speed:3.4, seed:1234, side:'hot', tier:3});
  const b=buildLook({id:'WOLF', hp:40, dmg:12, speed:3.4, seed:1234, side:'hot', tier:3});
  assert.deepEqual(a.patches, b.patches, 'same seed -> identical weathering');
  assert.equal(a.brokenHorn, b.brokenHorn, 'same seed -> same broken horn');
  assert.equal(a.hornCurl, b.hornCurl, 'same seed -> same horn sweep');
  const c=buildLook({id:'WOLF', hp:40, dmg:12, speed:3.4, seed:98765, side:'hot', tier:3});
  assert.equal(a.grade, c.grade, 'seed changes flavour, not grade');
  // weathering must land INSIDE the torso — it is hide colour, not a drawn mark
  for(const p of a.patches.concat(c.patches)){
    assert.ok(p.fx>=-0.27 && p.fx<=0.27, 'patch stays within the flank');
    assert.ok(p.fy>=0.33 && p.fy<=0.65, 'patch stays on the torso band');
    assert.ok(p.rx>0 && p.rx<=0.16 && p.ry>0 && p.ry<=0.13, 'patches stay small');
    assert.ok(p.d>0 && p.d<0.25, 'weathering is low-contrast, never a badge');
  }
}

// --- anatomy gating: a species only grows what its body could grow --------------
{
  const deer=buildLook({id:'DEER', hp:400, dmg:40, speed:3, seed:7});
  assert.equal(deer.grade, 5, 'a monstrous deer still grades apex');
  assert.ok(!deer.meta.pred, 'a cervid is never flagged a carnivore (no fangs/claws)');
  assert.equal(deer.family, 'cervid', 'deer keeps antler anatomy');
  const wolf=buildLook({id:'WOLF', hp:400, dmg:40, speed:3, seed:7});
  assert.ok(wolf.meta.pred, 'a wolf may grow claws and fangs');
  assert.ok(!wolf.meta.horns && wolf.family!=='cervid', 'a wolf never grows antlers');
  const shark=buildLook({id:'SHARK', hp:400, dmg:40, speed:3, seed:7});
  assert.ok(Array.isArray(shark.meta.fin), 'a shark grows one dorsal fin');
  assert.equal(shark.family, 'aquatic');
  const jelly=buildLook({id:'SPORE_MOTHER', hp:720, dmg:26, speed:3, seed:7});
  assert.ok(!jelly.meta.pred && !jelly.meta.fin && !jelly.meta.horns, 'a jelly grows no weapons at all');
  // every armament flag belongs to a species that can actually carry one
  for(const id of Object.keys(SPECIES_LOOK)){
    const meta=SPECIES_LOOK[id];
    if(meta.horns) assert.ok(meta.family!=='cervid', id+': horns flag is for non-cervid bovids only');
    if(meta.fin) assert.ok(meta.family==='aquatic'||meta.family==='serpent', id+': fins are for swimmers');
    if(meta.gear) assert.equal(meta.family, 'humanoid', id+': only humanoids carry tools');
    // Horn must be anchored on the real skull. Without an anchor the renderer
    // would fall back to a guessed box and the horns float off the head — the
    // bug that made a bison look like it had a bird stuck above it.
    const canHorn = meta.family==='cervid' || meta.family==='dragon' || meta.horns;
    if(canHorn){
      assert.equal(typeof meta.hornX, 'number', id+': horned species needs an explicit hornX');
      assert.equal(typeof meta.hornY, 'number', id+': horned species needs an explicit hornY');
      assert.ok(meta.hornY<0, id+': horns sit above the mob origin');
    }
  }
}

// --- live-mob wrapper & spawn mutation -----------------------------------------
{
  assert.equal(lookFor({id:'ZLOTY'},{hp:90,dmg:0}), null, 'the golden sprinter is exempt');
  const spec={id:'WOLF', hp:16, dmg:6, speed:3.4, ground:true, body:{w:1.3,h:0.75}};
  const m={id:'WOLF', maxHp:16, dmgMult:1, speedMul:1, spawnT:123456.7, scale:0.9, baseColor:'#bcbcbc', hostilitySide:'center', hostilityTier:0};
  const look=lookFor(m,spec);
  assert.ok(look && look.grade===2, 'wolf instance grades from effective stats');
  const cached=lookFor(m,spec);
  assert.equal(look, cached, 'look is cached per instance');
  m.maxHp=40; m.dmgMult=1.9;
  const angry=lookFor(m,spec);
  assert.ok(angry!==look && angry.grade>look.grade, 'cache refreshes when effective stats change');

  // spawn mutation: scale floor + growth, capped by physics contract
  const big={id:'WOLF', maxHp:16*2.3, dmgMult:1.9, speedMul:1, spawnT:5555, scale:0.75, baseColor:'#bcbcbc'};
  applySpawnLook(big,spec);
  assert.ok(big.scale>0.75, 'veteran wolves grow');
  assert.ok(big.scale<=1.72, 'ground scale cap respected');
  assert.notEqual(big.baseColor, '#bcbcbc', 'body palette graded at spawn');
  const fly={id:'HARPY_QUEEN', maxHp:520, dmgMult:1.6, speedMul:1, spawnT:42, scale:1.3, baseColor:'#c19a5e'};
  applySpawnLook(fly,{id:'HARPY_QUEEN', hp:520, dmg:32, speed:3, flying:true, body:{w:1.6,h:1.4}});
  assert.ok(fly.scale<=1.38+1e-9, 'flying scale cap respected');
}

// --- SPECIES_LOOK: conscious full coverage of the declared bestiary ------------
{
  const declared=Object.keys(SPECIES).filter(id=>id!=='ZLOTY');
  for(const id of declared){
    assert.ok(SPECIES_LOOK[id], 'SPECIES_LOOK maps declared species '+id);
  }
  for(const id of Object.keys(SPECIES_LOOK)){
    assert.ok(mobsSrc.includes("id:'"+id+"'") || mobsSrc.includes("id: '"+id+"'"), 'SPECIES_LOOK key exists in mobs.js: '+id);
  }
}

// --- wiring pins in mobs.js -----------------------------------------------------
assert.ok(/import \{ threatLook as THREAT_LOOK \} from '\.\/threat_look\.js';/.test(mobsSrc), 'mobs.js imports the threat look engine');
assert.ok(/applyMobProgressionTraits\(m,spec,h\);\s*\n\s*THREAT_LOOK\.applySpawnLook\(m,spec\);/.test(mobsSrc), 'spawn hook runs right after progression traits');
assert.ok(/THREAT_LOOK\.drawPre\(ctx,TILE,m,spec,screenX,screenY,faceDir\);/.test(mobsSrc), 'draw loop applies menace posture');
assert.ok(/THREAT_LOOK\.drawPost\(ctx,TILE,m,spec,screenX,screenY,faceDir,phase,topY,hpTop\);/.test(mobsSrc), 'draw loop layers features on the real art top');
assert.ok(!/function drawMobThreatMarks/.test(mobsSrc), 'old decal overlay system removed');
assert.ok(/id:'ICE_SHAMAN'[\s\S]{0,400}menaceBias:8/.test(mobsSrc), 'ice shaman carries a caster menace bias');
assert.ok(/id:'FIRE_SHAMAN'[\s\S]{0,400}menaceBias:8/.test(mobsSrc), 'fire shaman carries a caster menace bias');
assert.ok(/id:'ATOMIC_BOMB'[\s\S]{0,400}menaceBias:30/.test(mobsSrc), 'the bomb reads as the dread object it is');

// --- draw smoke: every family, every grade, on a stub 2D context ----------------
function stubCtx(){
  const grad={addColorStop(){}};
  const ctx={
    canvas:{width:800,height:600},
    fillStyle:'', strokeStyle:'', lineWidth:1, lineCap:'', globalAlpha:1, globalCompositeOperation:'source-over',
    arcs:[], images:[],                        // recorded so the tests can measure what was drawn
    save(){}, restore(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){},
    quadraticCurveTo(){}, fill(){}, stroke(){}, fillRect(){}, strokeRect(){}, clip(){},
    arc(x,y,r){ ctx.arcs.push({x,y,r,rx:r,ry:r,fill:ctx.fillStyle}); },
    ellipse(x,y,rx,ry){ ctx.arcs.push({x,y,r:rx,rx,ry,fill:ctx.fillStyle}); },
    drawImage(img,x,y,w,h){ ctx.images.push({x,y,w,h,alpha:ctx.globalAlpha}); },
    translate(){}, transform(){}, scale(){}, rotate(){},
    createRadialGradient(){ return grad; }, createLinearGradient(){ return grad; }
  };
  return ctx;
}

// --- native menace eyes: the ART keeps its own eyes; only their COLOUR climbs ----
// The old engine stamped one shared eyeball template (socket, iris, lids, halo)
// over every face — every mob wore the same strange eyes, so it was ripped out.
// menaceEyeColor is all that remains: each species' hand-drawn eye pixels are
// pulled from their OWN art colour toward hot red as the grade climbs.
{
  const lookAt=(g)=>{                        // a real look landing on grade g
    for(let dmg=0; dmg<=60; dmg+=2){
      for(let hp=2; hp<=4000; hp=Math.ceil(hp*1.15)){
        const look=buildLook({id:'WOLF', hp, dmg, speed:3, seed:11});
        if(look.grade===g) return look;
      }
    }
    return null;
  };
  const rgb=h=>({r:parseInt(h.slice(1,3),16), g:parseInt(h.slice(3,5),16), b:parseInt(h.slice(5,7),16)});
  for(let g=0; g<6; g++) assert.ok(lookAt(g), 'harness reaches grade '+g);
  // grades 0-1 and the exempt golden sprinter leave the art colour alone
  assert.equal(menaceEyeColor(lookAt(0),'#3a2c18'), '#3a2c18', 'g0 keeps the art eye untouched');
  assert.equal(menaceEyeColor(lookAt(1),'#3a2c18'), '#3a2c18', 'g1 keeps the art eye untouched');
  assert.equal(menaceEyeColor(null,'#3a2c18'), '#3a2c18', 'no look (the golden sprinter) keeps the art eye');
  // the art writes short hex too — it must not be misread by the mixer
  assert.equal(menaceEyeColor(null,'#fff'), '#ffffff', 'short-hex art colours expand cleanly');
  assert.equal(menaceEyeColor(lookAt(0),'#fff'), '#ffffff', 'short-hex passthrough at calm grades');
  // red dominance strictly climbs g2..g5 from ANY art base — dark beast fleck,
  // glacier blue, owl amber, grave lime and pale shark ring alike
  for(const base of ['#3a2c18','#9fe8ff','#ffb020','#000000','#d8ff9a','#e9f6fa']){
    let prev=null;
    for(let g=2; g<6; g++){
      const c=rgb(menaceEyeColor(lookAt(g), base));
      if(prev){
        assert.ok(c.r>=prev.r, base+' g'+g+': red channel never drops');
        assert.ok(c.r-c.g > prev.r-prev.g, base+' g'+g+': red dominance strictly increases');
      }
      prev=c;
    }
    const apex=rgb(menaceEyeColor(lookAt(5), base));
    assert.ok(apex.r>=240 && apex.g<=25 && apex.b<=25,
      base+': the apex stare is pure red ('+menaceEyeColor(lookAt(5),base)+')');
  }
  // identity below apex: different art eyes remain DIFFERENT eyes — no species
  // shares another's stare until the red swallows everything at g5
  const g3=(b)=>menaceEyeColor(lookAt(3), b);
  assert.notEqual(g3('#9fe8ff'), g3('#ffb020'), 'yeti glacier vs owl amber stay distinct at g3');
  assert.notEqual(g3('#3a2c18'), g3('#d8ff9a'), 'wolf brown vs ghoul lime stay distinct at g3');
  assert.notEqual(g3('#e9f6fa'), g3('#123c3c'), 'shark ring vs wyrm teal stay distinct at g3');
  // pure function of (look, base)
  assert.equal(menaceEyeColor(lookAt(4),'#ffb020'), menaceEyeColor(lookAt(4),'#ffb020'), 'deterministic per (look, base)');
}

// --- the overlay eyeball is DEAD and stays dead ----------------------------------
// v2 drew a full anatomical eye (socket shadow → sclera → iris → diet pupil →
// catch-light → blinking lids → additive halo) over the finished sprite. The
// verdict: awful — the same strange eyes stamped over every design. None of
// its machinery may return; eyes belong to each species' own art.
{
  const tlSrc=readFileSync(new URL('../src/engine/threat_look.js', import.meta.url), 'utf8');
  for(const banned of ['drawEyeAnatomy','eyeGeometry','blinkState','eyeRender','eyeScaleX','eyeScaleY','EYE_LID_COVER','EYE_TINTS_FAMILY','meta.eyes']){
    assert.ok(!tlSrc.includes(banned), 'overlay machinery "'+banned+'" must stay dead');
  }
  // the look no longer composes an engine iris colour of its own
  assert.ok(!('eyeCol' in buildLook({id:'WOLF', hp:400, dmg:30, speed:3, seed:7})),
    'the look carries no engine-composed iris colour');
  // no species meta may pin overlay anchors or overlay-only flags again
  for(const id of Object.keys(SPECIES_LOOK)){
    const meta=SPECIES_LOOK[id];
    for(const dead of ['eyes','eyeTint','eyeR','lidless','noEye','eyeAspect','brow']){
      assert.ok(!(dead in meta), id+': overlay meta "'+dead+'" pruned');
    }
  }
  // and drawPost paints nothing anywhere near the head anchor beyond the
  // organic channels: a full-post render of an apex wolf draws NO filled
  // ellipse in the head region (the overlay iris/socket used to land there)
  const spec={id:'WOLF', hp:16, dmg:6, speed:3.4, ground:true, body:{w:1.4,h:1.0}};
  const m={id:'WOLF', maxHp:2600, dmgMult:4, speedMul:1, spawnT:99, scale:1, baseColor:'#bcbcbc', state:'idle'};
  applySpawnLook(m,spec);
  assert.equal(lookFor(m,spec).grade, 5, 'apex wolf harness');
  const ctx=stubCtx();
  drawThreatLookPost(ctx,20,m,spec,100,100,1,1.3,70,()=>{});
  const headX=100+SPECIES_LOOK.WOLF.eye[0], headY=100+SPECIES_LOOK.WOLF.eye[1];
  const nearHead=ctx.arcs.filter(a=>Math.abs(a.x-headX)<5 && Math.abs(a.y-headY)<5 && a.r<6);
  assert.equal(nearHead.length, 0, 'no engine-drawn eye lands on the head (got '+nearHead.length+')');
}

// --- native wiring: every sighted species tints its OWN art eyes -----------------
// The draw loop hands each species an eyeTint() that runs its art colour
// through menaceEyeColor. Sighted organics must use it on their eye pixels;
// automatons, wisps, glow-bodies and the blind sand worm keep their own
// sensor light. Coverage is CONSCIOUS: adding a species means deciding here.
{
  const swStart=mobsSrc.indexOf('switch(m.id){');
  assert.ok(swStart>0, 'mob draw switch found');
  const swEnd=mobsSrc.indexOf('drawMobAttackIntent(ctx,TILE,spec', swStart);
  assert.ok(swEnd>swStart, 'mob draw switch bounded');
  const sw=mobsSrc.slice(swStart, swEnd);
  const bodies={};
  {
    // split on the case labels' own indentation; a label-only line
    // (case 'ICE_SHAMAN': falling through to FIRE_SHAMAN) carries forward
    const parts=sw.split(/\n {8}case /).slice(1);
    let pending=[];
    for(const part of parts){
      const nl=part.indexOf('\n');
      const firstLine=nl<0?part:part.slice(0,nl);
      const ids=[...firstLine.matchAll(/'([A-Z_]+)'/g)].map(h=>h[1]);
      if(!firstLine.includes('{')){ pending.push(...ids); continue; }
      for(const id of [...pending, ...ids]) bodies[id]=part;
      pending=[];
    }
  }
  const SIGHTED=['BIRD','FISH','PIRANHA','BEAR','BRAMBLE_STALKER','DEER','THUNDER_BISON','WOLF',
    'JACKPOT_YETI','OWL','VULTURE','VULTURE_HATCHLING','SHARK','JACKPOT_WHALE','EEL','LAKE_SERPENT',
    'GOAT','JASZCZUR','ZABA','BOG_LURKER','GIANT_SCORPION','TEMPLE_GUARD','WIOSENNY_JELEN','LETNI_ZUBR',
    'JESIENNY_LOS','ZIMOWY_NIEDZWIEDZ','GHOUL','BAT','SZKIELET','PELZACZ','GOLD_DRAGON','GOLD_DWARF_GUARD',
    'RADIATION_COCKROACH','ICE_SHAMAN','FIRE_SHAMAN','CLOUD_RAY','HARPY','HARPY_QUEEN','CINDER_HAWK',
    'SKY_SERAPH','SKYGROVE_WARDEN','BALLOON_TYRANT','AURORA_WYRM','MIRAGE_DJINN','SPORE_MOTHER','EMBER_PHOENIX'];
  for(const id of SIGHTED){
    assert.ok(bodies[id], id+': draw case parsed');
    assert.ok(bodies[id].includes('eyeTint('), id+': tints its OWN art eyes natively');
  }
  const SENSOR=['STRAZNIK','STONE_GOLEM','CORSAIR_AUTOMATON','GRAVITY_COLOSSUS','ATOMIC_BOMB',
    'VOLT_WISP','STORM_HERALD','ICE_WRAITH','SAND_WORM','ATLANTIS_MEDUZA','SPORE_DRIFTER','FIREFLY','ZLOTY'];
  for(const id of SENSOR){
    assert.ok(bodies[id], id+': draw case parsed');
    assert.ok(!bodies[id].includes('eyeTint('), id+': sensors/glow bodies keep their own light');
  }
  // the helper is the single bridge between the art and the menace ramp
  assert.ok(/const eyeTint=\(base\)=>THREAT_LOOK\.menaceEyeColor\(mobLook,base\);/.test(mobsSrc),
    'the draw loop derives eyeTint from menaceEyeColor');
}
{
  const FAMS=[
    ['WOLF',{ground:true,body:{w:1.3,h:0.75}}],
    ['DEER',{ground:true,body:{w:1.2,h:1.0}}],
    ['SZKIELET',{ground:true,body:{w:0.7,h:1.5}}],
    ['TEMPLE_GUARD',{ground:true,body:{w:0.9,h:1.6}}],
    ['GOLD_DWARF_GUARD',{ground:true,body:{w:0.9,h:1.4}}],
    ['FIRE_SHAMAN',{ground:true,body:{w:1.05,h:1.48}}],
    ['STRAZNIK',{ground:true,organic:false,body:{w:0.9,h:1.5}}],
    ['SHARK',{aquatic:true,body:{w:1.8,h:0.7}}],
    ['SAND_WORM',{ground:true,body:{w:1.4,h:1.2}}],
    ['HARPY',{flying:true,body:{w:1.2,h:1.1}}],
    ['VOLT_WISP',{flying:true,body:{w:0.8,h:0.8}}],
    ['SPORE_MOTHER',{flying:true,body:{w:1.8,h:1.6}}],
    ['GOLD_DRAGON',{ground:true,body:{w:2.8,h:1.9}}],
    ['GIANT_SCORPION',{ground:true,body:{w:2.2,h:1.1}}]
  ];
  const HP_FOR_GRADE=[3,10,30,90,300,1200];
  for(const [id,flags] of FAMS){
    for(let g=0; g<6; g++){
      const spec={id, hp:HP_FOR_GRADE[g], dmg:4+g*8, speed:3, ...flags};
      const m={id, maxHp:HP_FOR_GRADE[g], dmgMult:1, speedMul:1, spawnT:777+g, scale:1,
        baseColor:'#8a7a5c', hostilitySide:g%2?'hot':'cold', hostilityTier:Math.min(4,g), state:'idle'};
      const ctx=stubCtx();
      drawThreatLookPre(ctx,20,m,spec,100,100,1);
      drawThreatLookPost(ctx,20,m,spec,100,100,1,1.3,70,()=>{});
      drawThreatLookPost(ctx,20,m,spec,100,100,-1,4.1,70,()=>{}); // mirrored
    }
  }
}

console.log('threat-look-sim: ALL OK');
