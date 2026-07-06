// Deterministic Node coverage for the center Inner Self guardian: the call after
// the sky falls, the mentor confession, the reversed-damage mirror fight, the
// mutual killing blow, and the quiet epilogue.
// Run: node tools/center-guardian-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {getItem(){ return null; }, setItem(){}, removeItem(){}};
const messages = [];
globalThis.msg = t => messages.push(String(t));
globalThis.CustomEvent = class CustomEvent{ constructor(type,init){ this.type=type; this.detail=init && init.detail; } };
const events = [];
globalThis.dispatchEvent = e => events.push(e);
globalThis.__mmMarkWorldChanged = ()=>{};

const { T } = await import('../src/constants.js');
const { STORY_LORE } = await import('../src/engine/story_lore.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { centerGuardian } = await import('../src/engine/center_guardian.js');

assert.ok(centerGuardian && globalThis.MM.centerGuardian === centerGuardian, 'center guardian registers on MM');
assert.ok(STORY_LORE.center && STORY_LORE.center.reveal.length >= 8, 'center lore ships the full confession');

WG.worldSeed = 777001;
WG.clearCaches && WG.clearCaches();
centerGuardian.clearCache();
centerGuardian.reset();

// --- Minimal world + hero + progress stubs -----------------------------------
const tiles = new Map();
const tk = (x,y)=>Math.floor(x)+','+Math.floor(y);
const L = centerGuardian.layoutFor();
function getTile(x,y){
  const v = tiles.get(tk(x,y));
  if(v !== undefined) return v;
  return y >= L.floorY ? T.GRASS : T.AIR;
}
function setTile(x,y,t){ tiles.set(tk(x,y),t); }

assert.equal(L.schema, 'center_mirror_dais_v1', 'center arena has a named deterministic schema');
assert.ok(L.ops.some(o=>o.t===T.MOTHER_ICE), 'obelisk embeds the western relic material');
assert.ok(L.ops.some(o=>o.t===T.MOTHER_LAVA), 'obelisk embeds the eastern relic material');
assert.ok(L.ops.some(o=>o.t===T.ANTIMATTER_CRYSTAL), 'obelisk is crowned by the unnamed truth');
assert.ok(Math.abs(L.obeliskX) <= 4000, 'the center rises where the story began');

const hearts = {};
let heartMarks = 0;
globalThis.MM.progress = {
  markGuardianHeart(kind){
    if(hearts[kind]) return false;
    hearts[kind]=1; heartMarks++;
    return true;
  },
  guardianHearts(){ return Object.assign({},hearts); }
};
const granted = [];
globalThis.MM.inventory = { grantItem(item){ granted.push(Object.assign({},item)); return true; } };
let mentorHidden = null;
globalThis.MM.npcs = { mentor: {
  summary(){ return {x:L.obeliskX+2, y:L.floorY-1, phase:'done', status:'completed'}; },
  setHidden(v){ mentorHidden = !!v; }
}};
globalThis.inv = {};

globalThis.player = { x:L.obeliskX+6, y:L.floorY-1, w:0.7, h:0.95, hp:120, maxHp:120, vx:0, vy:0, facing:1, onGround:true };
const heroHits = [];
globalThis.damageHero = (amount,opts)=>{
  opts=opts||{};
  heroHits.push({amount:Math.round(amount), cause:opts.cause||''});
  globalThis.player.hp -= amount;
  if(globalThis.player.hp <= 0){
    globalThis.player.hp = 0;
    // emulate main.js heroDied routing for the mirror causes
    const res = centerGuardian.onHeroKilled({cause:opts.cause, player:globalThis.player});
    if(res && res.handled){ globalThis.player.hp = globalThis.player.maxHp; }
  }
  return true;
};

function tick(seconds, step){
  step = step || 0.05;
  for(let t=0; t<seconds; t+=step) centerGuardian.update(step, globalThis.player, getTile, setTile);
}

// --- Dormant until the Heart of Air ------------------------------------------
tick(1);
assert.equal(centerGuardian.status().phase, 'dormant', 'center sleeps while the sky guardian stands');
assert.equal(centerGuardian.damageAt(Math.floor(L.obeliskX), L.floorY-2, 10), false, 'nothing to hit while dormant');

hearts.air = 1;
tick(0.2);
assert.equal(centerGuardian.status().phase, 'calling', 'the heart of air wakes the center');
assert.equal(getTile(L.obeliskX, L.floorY-6), T.ANTIMATTER_CRYSTAL, 'the obelisk materializes at the world start');
tick(16);
const omen = STORY_LORE.center.falseFinalOmen;
assert.ok(omen.every(line=>messages.includes(line)), 'the false-final omen plays in full after the sky falls');

// --- The confession -----------------------------------------------------------
globalThis.player.x = L.obeliskX+1; globalThis.player.y = L.floorY-2;
const revealLines = STORY_LORE.center.reveal;
for(let i=0;i<revealLines.length;i++){
  assert.equal(centerGuardian.interactAt(Math.floor(L.obeliskX), L.floorY-3, globalThis.player), true, 'obelisk click advances confession line '+i);
}
assert.equal(centerGuardian.status().revealIdx, revealLines.length, 'the whole confession can be heard');
tick(2.2);
assert.equal(centerGuardian.status().phase, 'battle', 'the confession ends in the mirror rising');
assert.equal(mentorHidden, true, 'the mentor dissolves into the mimic');
const st = centerGuardian.status();
assert.equal(st.mimic.maxHp, 120, 'the mirror carries exactly the hero\'s strength');
assert.ok(messages.includes(STORY_LORE.center.transform), 'the transformation is narrated');

// --- Reversed damage: the hero's blows come back -------------------------------
const dbg = centerGuardian._debug();
const m = dbg.mimic;
const hpBefore = m.hp;
const heroHpBefore = globalThis.player.hp;
assert.equal(centerGuardian.damageAt(Math.floor(m.x), Math.floor(m.y), 18, {kind:'arrow',source:'hero'}), true, 'the mirror consumes the hero\'s hit');
assert.equal(m.hp, hpBefore, 'the mirror takes no damage from the hero');
tick(0.5);
assert.equal(globalThis.player.hp, heroHpBefore-18, 'the blow returns to the one who dealt it');
assert.ok(heroHits.some(h=>h.cause==='inner_mirror' && h.amount===18), 'reflection routes through the central damage entry');
assert.ok(messages.includes(STORY_LORE.center.mirrorHints[0]), 'the first reflection teaches the rule');
assert.equal(centerGuardian.attackAt(Math.floor(m.x), Math.floor(m.y), 5), true, 'melee clicks are consumed by the mirror too');
tick(0.5);

// --- The mimic's strikes drain the mimic ---------------------------------------
globalThis.player.hp = globalThis.player.maxHp;
globalThis.player.x = m.x + 0.8; globalThis.player.y = m.y;
m.strikeCd = 0;
const mimicHpBefore = m.hp;
tick(0.1);
const strike = heroHits.filter(h=>h.cause==='inner_self').pop();
assert.ok(strike, 'the mimic strikes the adjacent hero');
assert.equal(dbg.strikeDamage(), strike.amount, 'strikes use the mirror-scaled damage');
assert.equal(Math.round(mimicHpBefore - m.hp), strike.amount, 'every landed strike costs the mimic exactly what it dealt');

// --- Leash: walking away suspends, returning resumes ---------------------------
globalThis.player.x = L.obeliskX + 200;
tick(0.4);
assert.equal(centerGuardian.status().suspended, true, 'the mirror waits when the hero leaves');
globalThis.player.x = L.obeliskX + 3; globalThis.player.y = L.floorY-2;
tick(0.4);
assert.equal(centerGuardian.status().suspended, false, 'the fight resumes when the hero returns');

// --- Snapshot/restore keeps the wound ------------------------------------------
const snap = centerGuardian.snapshot();
assert.equal(snap.phase, 'battle', 'snapshot records the battle');
assert.ok(snap.mimic.hp < snap.mimic.maxHp, 'snapshot records mirror progress');
centerGuardian.reset();
assert.equal(centerGuardian.status().phase, 'dormant', 'reset returns to dormant');
assert.equal(centerGuardian.restore(snap), true, 'restore accepts its own snapshot');
assert.equal(centerGuardian.status().phase, 'battle', 'restore resumes the battle');
assert.equal(centerGuardian.status().mimic.hp, snap.mimic.hp, 'restore keeps the mirror\'s spent heart');

// --- The mutual fall -------------------------------------------------------------
globalThis.player.x = dbg.mimic.x + 0.8; globalThis.player.y = dbg.mimic.y;
globalThis.player.hp = globalThis.player.maxHp;
// Let the mirror spend itself: strike until its heart crosses zero.
for(let guard=0; guard<400 && centerGuardian.status().phase==='battle'; guard++){
  dbg.mimic.strikeCd = 0;
  dbg.state.suspended = false;
  globalThis.player.hp = globalThis.player.maxHp; // the hero endures; acceptance, not attrition
  globalThis.player.x = dbg.mimic.x + 0.8;
  globalThis.player.y = dbg.mimic.y;
  centerGuardian.update(0.1, globalThis.player, getTile, setTile);
}
assert.equal(centerGuardian.status().phase, 'fallen', 'the mirror spends its own heart and both fall');
assert.ok(heroHits.some(h=>h.cause==='inner_self_final'), 'the killing blow is dealt and accepted');
assert.equal(hearts.mother, 1, 'the mother heart marks story completion');
assert.equal(globalThis.inv.heartMother, 1, 'the heart lands in the inventory');
assert.ok(granted.some(g=>g.id==='serce_ciszy'), 'the Heart of Quiet charm is granted');
assert.equal(mentorHidden, false, 'the freed mentor returns');
assert.equal(getTile(L.obeliskX, L.floorY-5), T.TORCH, 'the obelisk quiets into a lantern');
assert.ok([2,-2,3,-3].some(off=>getTile(L.obeliskX+off, L.floorY-1)===T.CHEST_EPIC), 'the story leaves one epic chest at the dais');
assert.ok(events.some(e=>e.type==='mm-guardian-defeated' && e.detail && e.detail.kind==='mother'), 'the defeat event fires for progress systems');
assert.equal(centerGuardian.completed(), true, 'the arc reports completion');

// Threshold speech and finale lines reached the log.
tick(14);
assert.ok(messages.includes(STORY_LORE.center.strikeLines.hp50), 'the mimic speaks at half heart');
assert.ok(STORY_LORE.center.finale.every(line=>messages.includes(line)), 'the mutual fall is fully narrated');
assert.ok(STORY_LORE.center.epilogueArrival.every(line=>messages.includes(line)), 'the epilogue arrival plays');

// --- Epilogue conversation --------------------------------------------------------
const talk0 = STORY_LORE.center.epilogueTalk[0];
assert.equal(centerGuardian.interactAt(Math.floor(L.obeliskX), L.floorY-3, globalThis.player), true, 'the obelisk still answers after the fall');
assert.ok(messages.includes(talk0), 'the freed mentor speaks closure lines');

// --- Battle damage never dropped a grave: all deaths were handled ------------------
assert.equal(centerGuardian.onHeroKilled({cause:'lava'}), null, 'unrelated deaths are not intercepted');

// --- applyToChunk regen coverage ---------------------------------------------------
const { CHUNK_W, WORLD_H } = await import('../src/constants.js');
const chunkX = Math.floor(L.obeliskX / CHUNK_W);
const arr = new Uint8Array(CHUNK_W * WORLD_H);
assert.ok(centerGuardian.applyToChunk(arr, chunkX) > 0, 'chunk regeneration reconstructs the dais');
const lx = ((L.obeliskX % CHUNK_W) + CHUNK_W) % CHUNK_W;
assert.equal(arr[(L.floorY-6)*CHUNK_W + lx], T.GLASS, 'regen includes the epilogue lantern top');

console.log('center-guardian-sim: all assertions passed');
