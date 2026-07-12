// Threat-look ("Groza") contract: the stronger the mob, the stronger it LOOKS.
// Pins the whole visual-menace ladder:
//  - menace score is monotonic in hp and dmg; thresholds ascend inside (0,1)
//  - the REAL bestiary (stats parsed from mobs.js source) lands in the intended
//    grade bands — squirrels read harmless, gold dragons read nightmarish,
//    sky bosses read apex; a far-world (hostility-scaled) wolf out-menaces its
//    center-world twin
//  - per-grade feature intensities (size/bulk/lean/spines/horns/claws/scars/
//    eyes/bands/motes/aura/gear) are monotonic, palettes darken & saturate
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
  menaceScore, buildLook, lookFor, applySpawnLook, gradeBodyColor, eyeRender,
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
  const re=/id:\s*'([A-Z_]+)'/g;
  let m;
  while((m=re.exec(src))){
    const id=m[1];
    if(out[id]) continue;
    const win=src.slice(m.index, m.index+520);
    const num=(k)=>{ const h=win.match(new RegExp(k+':\\s*(-?[\\d.]+)')); return h?Number(h[1]):null; };
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
  ATOMIC_BOMB:[3,4], LAKE_SERPENT:[2,3],
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
const KEYS=['size','minScale','bulk','lean','hump','weather','horn','claw','fang','fin','eye','breath','dust','shadow','gear'];
for(const k of KEYS){
  for(let g=1; g<6; g++){
    assert.ok(GRADE_FX[g][k]>=GRADE_FX[g-1][k], 'GRADE_FX.'+k+' nondecreasing at g'+g);
  }
}
assert.ok(GRADE_FX[5].size>GRADE_FX[1].size, 'apex is visibly bigger');
assert.ok(GRADE_FX[0].size<1, 'harmless prey reads softer/smaller');
// the escalation must be ORGANIC: no schematic decal channels may come back
for(const banned of ['spikes','plates','bands','aura','scars','motes']){
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

// --- the eye escalates in COLOUR, never in SIZE ---------------------------------
// A predator's eye that swells with its grade stops reading as an eye and starts
// reading as a lamp bolted to its head. It must burn redder instead.
{
  const spec={id:'WOLF', hp:16, dmg:6, speed:3.4, ground:true, body:{w:1.4,h:1.0}};
  // derive an instance that really lands on each grade rather than guessing stats
  const instanceForGrade=(g)=>{
    for(let dmgMult=1; dmgMult<=8; dmgMult++){
      for(let hp=2; hp<=4000; hp=Math.ceil(hp*1.15)){
        const m={id:'WOLF', maxHp:hp, dmgMult, speedMul:1, spawnT:99, scale:1, baseColor:'#bcbcbc', state:'idle'};
        if(lookFor(m,spec).grade===g) return m;
      }
    }
    return null;
  };
  const eyes=[];
  for(let g=2; g<6; g++){
    const m=instanceForGrade(g);
    assert.ok(m, 'a wolf instance exists at grade '+g);
    // Spawn the mob for real: applySpawnLook is what gives it the grade's scale,
    // and the mobs.js draw loop nests the whole sprite inside ctx.scale(m.scale)
    // while drawPre adds the horizontal bulk. Measuring the raw radius handed to
    // the canvas would MISS that — which is exactly how a swelling eye shipped.
    applySpawnLook(m,spec);
    const look=lookFor(m,spec);
    assert.equal(look.grade, g, 'wolf harness lands on grade '+g);
    const ctx=stubCtx();
    drawThreatLookPost(ctx,20,m,spec,100,100,1,1.3,70,()=>{});
    const iris=ctx.arcs.filter(a=>String(a.fill).toLowerCase()===look.eyeCol.toLowerCase());
    assert.equal(iris.length, 1, 'g'+g+': exactly one iris drawn');
    const er=eyeRender(g);
    // project into SCREEN space: radius × every transform the eye is nested in
    eyes.push({
      g, col:look.eyeCol, scale:m.scale, haloA:er.haloAlpha,
      screenW:iris[0].rx * TL.eyeScaleX(m,look),
      screenH:iris[0].ry * TL.eyeScaleY(m)
    });
  }
  const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<eps, msg+' ('+a.toFixed(3)+' vs '+b.toFixed(3)+')');
  const rgb=h=>({r:parseInt(h.slice(1,3),16), g:parseInt(h.slice(3,5),16), b:parseInt(h.slice(5,7),16)});
  // the whole point: the apex wolf's BODY really is much bigger, and its eye is NOT
  assert.ok(eyes[eyes.length-1].scale > eyes[0].scale*1.25, 'the apex body really is much bigger');
  for(let i=1;i<eyes.length;i++){
    assert.ok(eyes[i].scale > eyes[i-1].scale, 'g'+eyes[i].g+': the body keeps growing with the grade');
  }
  for(let i=0;i<eyes.length;i++){
    near(eyes[i].screenW, eyes[0].screenW, 0.01, 'g'+eyes[i].g+': iris SCREEN width is fixed across grades');
    near(eyes[i].screenH, eyes[0].screenH, 0.01, 'g'+eyes[i].g+': iris SCREEN height is fixed across grades');
    near(eyes[i].screenW, eyes[i].screenH, 0.01, 'g'+eyes[i].g+': the eye stays round under body bulk');
    if(i){
      const prev=rgb(eyes[i-1].col), cur=rgb(eyes[i].col);
      assert.ok(cur.r>=prev.r, 'g'+eyes[i].g+': red channel never drops');
      assert.ok(cur.g<prev.g, 'g'+eyes[i].g+': the eye burns REDDER (green channel falls)');
      assert.ok(cur.r-cur.g > prev.r-prev.g, 'g'+eyes[i].g+': red dominance strictly increases');
    }
  }
  // intensity may climb through ALPHA — the only channel allowed to grow at all
  const lit=eyes.filter(e=>e.haloA>0);
  assert.ok(lit.length>=2, 'the top grades carry a catch-light');
  assert.ok(lit[lit.length-1].haloA > lit[0].haloA, 'apex stare burns hotter, not bigger');
  // and the apex iris is essentially pure red
  const apex=rgb(eyes[eyes.length-1].col);
  assert.ok(apex.r>=250 && apex.g<=20 && apex.b<=20, 'apex eye is pure red');
}

// --- eye anatomy: diet shapes the pupil, anatomy decides the mode ---------------
// Once the eye is bigger than a dot it must be a real eye — lids, iris, pupil,
// catch-light — never a flat disc. And the pupil is honest biology: predators
// carry slits, grazers carry horizontal bars (the goat pupil), primates rounds.
{
  const geoFor=(id,body,hp,dmg)=>{
    const spec={id, hp:hp||400, dmg:dmg||30, speed:3, ground:true, body};
    const m={id, maxHp:hp||400, dmgMult:1, speedMul:1, spawnT:55, scale:1, baseColor:'#8a7a5c'};
    return TL.eyeGeometry(m,spec,lookFor(m,spec));
  };
  const wolf=geoFor('WOLF',{w:1.4,h:1.0});
  assert.equal(wolf.mode, 'complex', 'wolf eye carries full anatomy');
  assert.equal(wolf.pupil, 'slit', 'a hunting beast has a slit pupil');
  assert.ok(wolf.blink, 'a living eye blinks');
  assert.equal(geoFor('DEER',{w:1.4,h:1.1}).pupil, 'bar', 'a grazer has the horizontal bar pupil');
  assert.equal(geoFor('GOAT',{w:1.2,h:1.0}).pupil, 'bar', 'the goat keeps its famous pupil');
  assert.equal(geoFor('GHOUL',{w:0.9,h:1.6}).pupil, 'round', 'humanoids look at you with round pupils');
  assert.equal(geoFor('GOLD_DRAGON',{w:3.35,h:2.35}).pupil, 'slit', 'the dragon eye is a reptile eye');
  assert.equal(geoFor('AURORA_WYRM',{w:2.8,h:1.0}).pupil, 'slit', 'serpents likewise');
  // anatomy gates the mode
  assert.equal(geoFor('SZKIELET',{w:0.8,h:1.6}).mode, 'dot', 'bare bone has no lids — ember in a socket');
  assert.equal(geoFor('TEMPLE_GUARD',{w:0.92,h:1.55}).mode, 'dot', 'a bronze mask does not blink');
  assert.equal(geoFor('GIANT_SCORPION',{w:2.35,h:1.1}).mode, 'compound', 'arachnids get ocelli clusters');
  assert.ok(!geoFor('GIANT_SCORPION',{w:2.35,h:1.1}).blink, 'ocelli have no lids');
  assert.equal(geoFor('SAND_WORM',{w:1.85,h:0.92}).mode, 'none', 'the sand worm hunts blind');
  assert.equal(geoFor('STRAZNIK',{w:0.95,h:1.55}).mode, 'none', 'machines keep their own sensors');
  assert.equal(geoFor('VOLT_WISP',{w:0.9,h:0.9}).mode, 'none', 'a wisp IS glow — no eye overlay');
  // the eye follows the SPECIES' anatomy, never the grade
  const dragonR=geoFor('GOLD_DRAGON',{w:3.35,h:2.35}).r;
  assert.ok(dragonR>wolf.r, 'a dragon eye out-sizes a wolf eye');
  assert.ok(dragonR<=4.2, 'but even a dragon eye is capped');
  assert.equal(TL.eyeGeometry({id:'JACKPOT_WHALE',maxHp:400,dmgMult:1,spawnT:1,scale:1},
    {id:'JACKPOT_WHALE',hp:400,dmg:30,speed:3,aquatic:true,body:{w:4.8,h:1.38}},
    buildLook({id:'JACKPOT_WHALE',hp:400,dmg:30,speed:3,seed:1})).r, 2.2,
    'the whale eye stays small relative to its bulk, like the real animal');
  const g1={id:'WOLF', maxHp:5, dmgMult:1, speedMul:1, spawnT:55, scale:1};
  assert.equal(TL.eyeGeometry(g1,{id:'WOLF',hp:5,dmg:2,speed:3,ground:true,body:{w:1.4,h:1.0}},
    lookFor(g1,{id:'WOLF',hp:5,dmg:2,speed:3,ground:true,body:{w:1.4,h:1.0}})).mode, 'none',
    'calm low grades keep the art\'s own eyes');
}

// --- facing decides the eye count: two for a face, one for a profile -------------
{
  const spec={id:'GHOUL', hp:400, dmg:30, speed:3, ground:true, body:{w:0.9,h:1.6}};
  const m={id:'GHOUL', maxHp:400, dmgMult:1, speedMul:1, spawnT:55, scale:1, baseColor:'#4a5d49', state:'idle'};
  const look=lookFor(m,spec);
  assert.ok(TL.eyeGeometry(m,spec,look).twin, 'a screen-facing humanoid is two-eyed');
  const ctx=stubCtx();
  drawThreatLookPost(ctx,20,m,spec,100,100,1,1.3,70,()=>{});
  const irises=ctx.arcs.filter(a=>String(a.fill).toLowerCase()===look.eyeCol.toLowerCase());
  assert.equal(irises.length, 2, 'the ghoul looks at you with BOTH eyes');
  assert.ok(Math.abs(irises[0].y-irises[1].y)<2 && irises[0].x!==irises[1].x, 'the pair sits side by side on the face');
  // profile beasts stay one-eyed (the wolf block above already pins iris.length===1)
  const wspec={id:'WOLF', hp:400, dmg:30, speed:3, ground:true, body:{w:1.4,h:1.0}};
  const wm={id:'WOLF', maxHp:400, dmgMult:1, speedMul:1, spawnT:55, scale:1};
  assert.ok(!TL.eyeGeometry(wm,wspec,lookFor(wm,wspec)).twin, 'a profile beast shows a single eye');
  // every screen-facing face in the art carries BOTH its eye anchors, pinned on
  // the actual sprite pixels — no auto-guessed second eye on the core cast
  for(const id of ['GHOUL','SZKIELET','TEMPLE_GUARD','GOLD_DWARF_GUARD','ICE_SHAMAN','FIRE_SHAMAN','JACKPOT_YETI','OWL','BOG_LURKER','BRAMBLE_STALKER']){
    const eyes=SPECIES_LOOK[id].eyes;
    assert.ok(Array.isArray(eyes) && eyes.length===2, id+': two art-pinned eye anchors');
    assert.ok(eyes[0][0]!==eyes[1][0] || eyes[0][1]!==eyes[1][1], id+': the two anchors differ');
  }
}

// --- no two species share an eye ---------------------------------------------------
// The iris starts from the species' own tint and is pulled toward menace red as
// the grade climbs: identity at the bottom of the ladder, pure danger at the top.
{
  const at=(id,hp,dmg)=>buildLook({id, hp, dmg, speed:3, seed:9});
  // same grade, five species — five different irises
  const g3=['WOLF','GHOUL','GOLD_DRAGON','ICE_SHAMAN','JACKPOT_YETI'].map(id=>{
    const look=at(id,120,20);
    assert.equal(look.grade, 3, id+' harness lands on g3');
    return {id, col:look.eyeCol};
  });
  for(let i=0;i<g3.length;i++) for(let j=i+1;j<g3.length;j++){
    assert.notEqual(g3[i].col, g3[j].col, g3[i].id+' vs '+g3[j].id+': different species, different eyes');
  }
  // the yeti's glacier-blue and the shaman's ice really read cold at g3
  const rgb=h=>({r:parseInt(h.slice(1,3),16), g:parseInt(h.slice(3,5),16), b:parseInt(h.slice(5,7),16)});
  const yeti=rgb(g3.find(e=>e.id==='JACKPOT_YETI').col), wolfE=rgb(g3.find(e=>e.id==='WOLF').col);
  assert.ok(yeti.b>wolfE.b+20, 'the yeti eye keeps its glacier blue against the wolf amber');
  // but at apex, EVERY eye converges to the one unmistakable signal
  for(const id of ['WOLF','GHOUL','ICE_SHAMAN','GOLD_DRAGON']){
    const look=at(id,2600,60);
    assert.equal(look.grade, 5, id+' harness lands on g5');
    const c=rgb(look.eyeCol);
    assert.ok(c.r>=245 && c.g<=25 && c.b<=25, id+': the apex stare is red no matter the species ('+look.eyeCol+')');
  }
  // and the eye SHAPE varies by family too, not just the colour
  const geoOf=(id,body,flags)=>{
    const spec={id, hp:400, dmg:30, speed:3, ...(flags||{ground:true}), body};
    const m={id, maxHp:400, dmgMult:1, speedMul:1, spawnT:5, scale:1};
    return TL.eyeGeometry(m,spec,lookFor(m,spec));
  };
  const deer=geoOf('DEER',{w:1.4,h:1.1}), ghoul=geoOf('GHOUL',{w:0.9,h:1.6});
  assert.ok(deer.aspect>ghoul.aspect, 'a grazer wears the soft almond, a humanoid the rounder socket');
  const shark=geoOf('SHARK',{w:2.4,h:0.7},{aquatic:true}), wolf2=geoOf('WOLF',{w:1.4,h:1.0});
  const lum=h=>{ const n=parseInt(h.slice(1),16); return ((n>>16)&255)*0.299+((n>>8)&255)*0.587+(n&255)*0.114; };
  assert.ok(lum(shark.sclera)<lum(wolf2.sclera), 'the shark eye is a black bead, the wolf eye a warm one');
  const dragon=geoOf('GOLD_DRAGON',{w:3.35,h:2.35});
  assert.ok(dragon.brow>wolf2.brow && wolf2.brow>deer.brow, 'brow weight orders dragon > predator > grazer');
}

// --- blinking: a real rhythm, not a strobe ---------------------------------------
{
  for(const seed of [7, 12345, 987654321]){
    let peak=0, closedSamples=0, total=0, blinks=0, prev=0;
    for(let t=0; t<=30000; t+=16){
      const f=TL.blinkState(seed,t);
      assert.ok(f>=0 && f<=1, 'closure stays in [0,1]');
      if(f>peak) peak=f;
      if(f>0.05) closedSamples++;
      if(prev===0 && f>0) blinks++;
      prev=f; total++;
    }
    assert.ok(peak>0.95, 'seed '+seed+': the lids really meet ('+peak.toFixed(2)+')');
    assert.ok(closedSamples/total<0.10, 'seed '+seed+': the eye is open the vast majority of the time');
    assert.ok(blinks>=5 && blinks<=11, 'seed '+seed+': blinks land every 3.0-5.6s over 30s ('+blinks+')');
    assert.equal(TL.blinkState(seed,4321), TL.blinkState(seed,4321), 'deterministic per (seed,t)');
  }
  // individuals do not blink in unison
  const a=[],b=[];
  for(let t=0;t<=30000;t+=16){ a.push(TL.blinkState(7,t)>0.5?1:0); b.push(TL.blinkState(12345,t)>0.5?1:0); }
  assert.ok(a.join('')!==b.join(''), 'different seeds carry different blink phases');
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
