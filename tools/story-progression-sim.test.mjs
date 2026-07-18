// Deterministic Node coverage for the diegetic goal chain: mentor steps → the
// two horizons → the underground gate → the tower of ambition → the center,
// with one-time world-reaction beats and self-healing task pointers.
// Run: node tools/story-progression-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {getItem(){ return null; }, setItem(){}, removeItem(){}};
const messages = [];
globalThis.msg = t => messages.push(String(t));
globalThis.CustomEvent = class CustomEvent{ constructor(type,init){ this.type=type; this.detail=init && init.detail; } };
globalThis.dispatchEvent = ()=>{};
globalThis.__mmMarkWorldChanged = ()=>{};

const { STORY_LORE } = await import('../src/engine/story_lore.js');
const { tasks } = await import('../src/engine/tasks.js');
const { storyProgression } = await import('../src/engine/story_progression.js');

assert.ok(storyProgression && globalThis.MM.storyProgression === storyProgression, 'story progression registers on MM');
assert.ok(tasks === globalThis.MM.tasks, 'story progression rides the shared task tracker');
const BEATS = STORY_LORE.progressionBeats;
assert.ok(BEATS && BEATS.horizons.length >= 2 && BEATS.earth.length >= 2, 'progression beats ship with the lore');

// --- Stubs: hearts, mentor, guardians, sky, center -----------------------------
const hearts = {};
globalThis.MM.progress = { guardianHearts(){ return Object.assign({},hearts); } };
let mentorPhase = 'water';
globalThis.MM.npcs = { mentor: {
  summary(){
    const tree=mentorPhase==='tree_watch_short' || mentorPhase==='tree_watch_long';
    const sand=mentorPhase==='sand_hide';
    const observing=tree || sand;
    const observeSeconds=mentorPhase==='tree_watch_short' ? 10 : 30;
    const handoff=mentorPhase==='water' ? {item:'water',amount:1,have:0}
      : mentorPhase==='raw_meat' ? {item:'meat',amount:1,have:0}
      : mentorPhase==='cooked_meat' ? {item:'bakedMeat',amount:1,have:0} : null;
    return {
      x: 10, y: 30,
      phase: mentorPhase,
      status: ['done','vanished'].includes(mentorPhase) ? 'completed' : (observing ? 'observe' : 'available'),
      required: handoff || (observing ? {item:'observe',amount:observeSeconds,have:2} : null),
      observe:observing ? {mode:sand?'sand_hide':'tree_top',seconds:observeSeconds,progress:2,active:true} : null
    };
  }
}};
const followupPhases={
  mentor_triangle:'briefing',
  mentor_tesseract:'briefing',
  mentor_trapezoid:'briefing'
};
const followupPositions={
  mentor_triangle:{x:500.5,y:29},
  mentor_tesseract:{x:-499.5,y:29},
  mentor_trapezoid:{x:120.5,y:61}
};
for(const id of Object.keys(followupPhases)){
  globalThis.MM.npcs[id]={summary(){
    const phase=followupPhases[id];
    const observing=phase!=='briefing' && phase!=='done';
    const mode=id==='mentor_triangle'?'built_house':id==='mentor_tesseract'?'coal_dynamo':'wooden_boat';
    return Object.assign({},followupPositions[id],{
      phase,
      status:phase==='done'?'completed':observing?'observe':'briefing',
      observe:observing?{mode,seconds:1,progress:0.4,active:false}:null
    });
  }};
}
let gateEnabled = false;
let gateEnableCalls = 0;
globalThis.MM.guardianLairs = {
  layoutFor(kind){ return kind==='ice' ? {ax:-10000, floorY:52} : {ax:10000, floorY:48}; },
  status(){ return {underground:{enabled:gateEnabled, mouthX:8740, mouthY:60, x:8740, y:96}}; },
  enableUndergroundGate(){ gateEnableCalls++; gateEnabled=true; return true; }
};
let skyMaterialized = 0;
globalThis.MM.skyGuardian = {
  layoutFor(){ return {ax:26, floorY:-92, towerBaseY:58}; },
  materializeArena(){ skyMaterialized++; return 5; }
};
globalThis.MM.worldGen = { surfaceHeight(){ return 58; } };
let centerPhase = 'dormant';
globalThis.MM.centerGuardian = {
  status(){ return {phase:centerPhase}; },
  callTarget(){ return {x:12.5, y:28}; }
};
globalThis.player = {x:0, y:30};

storyProgression.reset();
tasks.reset();
messages.length = 0;

function getTile(){ return 0; }
function setTile(){}
function tick(seconds){
  for(let t=0; t<seconds; t+=0.25) storyProgression.update(0.25, globalThis.player, getTile, setTile);
}
function activeStoryTasks(){
  return tasks.activeList().filter(t=>t.source==='story');
}
function taskById(id){
  return activeStoryTasks().find(t=>t.id===id) || null;
}

// --- Act 0: the mentor's current step is always the visible goal ----------------
tick(1.5);
let mentorTask = taskById('story:mentor');
assert.ok(mentorTask, 'the mentor step becomes a tracked goal');
assert.match(mentorTask.title, /Stary Kwadrat/, 'the goal carries the mentor\'s name, not a bare instruction');
assert.match(mentorTask.detail, /\(0\/1\)/, 'handoff goals show live progress');
assert.equal(mentorTask.target.x, 10, 'the goal points at the mentor');
assert.equal(activeStoryTasks().length, 1, 'one story goal at a time during the tutorial');
assert.equal(messages.length, 0, 'no horizon beats while the mentor still teaches');

mentorPhase = 'tree_watch_short';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title, /Dowolne drzewo \(10 s\)/, 'the short observation explicitly allows any tree');
assert.equal(mentorTask.target, undefined, 'the short tree observation clears the mentor location inherited from the prior step');
assert.equal(mentorTask.pointer, false, 'the short tree observation does not claim to have a map target');

mentorPhase = 'tree_watch_long';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title, /Dowolne drzewo \(30 s\)/, 'the long observation also allows any tree');
assert.equal(mentorTask.target, undefined, 'the long tree observation remains location-free');
assert.equal(mentorTask.pointer, false, 'the long tree observation has no map pointer');

mentorPhase = 'sand_hide';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title, /Miedzy piaskiem \(30 s\)/, 'the sand task names the safe between-block arrangement');
assert.match(mentorTask.detail, /zloty licznik/i, 'the sand task explains its overhead progress signal');
assert.match(mentorTask.detail, /naliczanie trwa/i, 'the active sand timer is reflected in the task tracker');
assert.equal(mentorTask.target, undefined, 'sand hiding can be completed away from the mentor');
assert.equal(mentorTask.pointer, false, 'the sand observation does not misdirect the player back to the mentor');

mentorPhase = 'raw_meat';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title, /Blok miesa \(3 skrawki\)/, 'the tracker names the crafted item and its scrap cost');
assert.match(mentorTask.detail, /zakladce Start/i, 'the tracker points to the correct crafting tab');
assert.match(mentorTask.detail, /Zwierzeta zostawiaja skrawki/i, 'the tracker explains what animals actually drop');

mentorPhase = 'cooked_meat';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title, /Upiecz Blok miesa/, 'the cooked-meat task is framed as an action with the retained block');
assert.match(mentorTask.detail, /nie zabral/i, 'the tracker confirms that the mentor did not take the uncooked meat');
assert.match(mentorTask.detail, /Symulator miotacza/i, 'the tracker names the tool supplied by the mentor');
assert.match(mentorTask.detail, /przytrzymaj LPM/i, 'the tracker explains the flame control');
assert.match(mentorTask.detail, /mozesz zatrzymac/i, 'the tracker confirms that the simulator remains with the hero');

mentorPhase = 'duel';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title, /Ostatnia lekcja/, 'the goal follows the mentor\'s quest phase');

// --- Act 1: the two horizons -----------------------------------------------------
mentorPhase = 'guardian_return';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title,/Wroc po dwoch straznikach/i,'the post-training return promise remains a tracked goal');
assert.match(mentorTask.detail,/Zachodu.*Wschodu.*wroc/i,'the return goal names both required guardian victories');
assert.ok(taskById('story:west') && taskById('story:east'),'the guardian targets open without hiding Square\'s return quest');
mentorPhase = 'guardian_verdict';
tick(1);
mentorTask = taskById('story:mentor');
assert.match(mentorTask.title,/Ktory byl trudniejszy/i,'the tracker asks for the promised verdict after both victories');
mentorPhase = 'vanished';
tick(1);
assert.equal(taskById('story:mentor'),null,'Square\'s goal retires after the verdict and disappearance');

mentorPhase = 'done';
tick(1);
assert.equal(taskById('story:mentor'), null, 'the mentor goal retires with the tutorial');
const west = taskById('story:west');
const east = taskById('story:east');
assert.ok(west && east, 'both horizons open as goals');
assert.equal(west.target.x, -9999.5, 'the west goal points into the cold');
assert.equal(east.target.x, 10000.5, 'the east goal points into the heat');
const triangleBriefing=taskById('story:mentor_triangle');
const tesseractBriefing=taskById('story:mentor_tesseract');
const trapezoidBriefing=taskById('story:mentor_trapezoid');
assert.ok(triangleBriefing && tesseractBriefing && trapezoidBriefing,'all three follow-up mentors become visible goals after Square training');
assert.equal(triangleBriefing.target.x,500.5,'the Triangle goal points to the +500 teaching region');
assert.equal(tesseractBriefing.target.x,-499.5,'the Tesseract goal points to the -500 teaching region');
assert.match(trapezoidBriefing.detail,/pierwszej duzej wody/i,'the Trapezoid goal explains its shoreline placement');
followupPhases.mentor_triangle='build_house';
tick(1);
const houseLesson=taskById('story:mentor_triangle');
assert.match(houseLesson.detail,/dach.*tlo.*swiatlo/i,'the Triangle lesson tracker lists the real house requirements');
assert.equal(houseLesson.pointer,false,'a house may be built anywhere after Triangle gives the lesson');
Object.keys(followupPhases).forEach(id=>{ followupPhases[id]='done'; });
tick(1);
assert.equal(taskById('story:mentor_triangle'),null,'completed Triangle training retires its task');
assert.equal(taskById('story:mentor_tesseract'),null,'completed Tesseract training retires its task');
assert.equal(taskById('story:mentor_trapezoid'),null,'completed Trapezoid training retires its task');
tick(12);
assert.ok(BEATS.horizons.every(line=>messages.includes(line)), 'the horizons beat plays in full');
const horizonsCount = messages.filter(m=>m===BEATS.horizons[0]).length;
assert.equal(horizonsCount, 1, 'beats play exactly once');

// --- Act 2: one heart retires one horizon -----------------------------------------
hearts.ice = 1;
tick(12);
assert.equal(taskById('story:west'), null, 'the fallen west guardian retires its goal');
assert.ok(taskById('story:east'), 'the east still burns');
assert.ok(BEATS.ice.every(line=>messages.includes(line)), 'the thaw beat plays after the ice heart');

hearts.fire = 1;
tick(14);
assert.equal(taskById('story:east'), null, 'the fallen east guardian retires its goal');
const gate = taskById('story:gate');
assert.ok(gate, 'both hearts open the way down');
assert.equal(gateEnableCalls > 0, true, 'the passage self-heals if the defeat hook was missed');
assert.equal(gate.target.x, 8740.5, 'the gate goal points at the passage mouth');
assert.ok(BEATS.fire.every(line=>messages.includes(line)), 'the quench beat plays after the fire heart');
assert.ok(BEATS.gate.every(line=>messages.includes(line)), 'the gate beat plays when the way down opens');

// --- Act 3: the tower rises --------------------------------------------------------
hearts.earth = 1;
tick(10);
assert.equal(taskById('story:gate'), null, 'the mole\'s fall retires the gate goal');
const sky = taskById('story:sky');
assert.ok(sky, 'the tower of ambition becomes the goal');
assert.equal(sky.target.y, 57, 'the sky goal points at the tower base on the surface');
assert.ok(skyMaterialized > 0, 'the sky arena (and its tower) materializes with the earth beat');
assert.ok(BEATS.earth.every(line=>messages.includes(line)), 'the tower beat plays after the earth heart');

// --- Act 4→5: the sky falls, the center calls --------------------------------------
hearts.air = 1;
tick(2);
assert.equal(taskById('story:sky'), null, 'the sky goal retires with the crown');
assert.equal(activeStoryTasks().length, 0, 'no goal is forced before the center wakes (the omen leads)');
centerPhase = 'calling';
tick(2);
const center = taskById('story:center');
assert.ok(center, 'the calling center becomes the final goal');
assert.equal(center.target.x, 12.5, 'the center goal points at the obelisk');
assert.match(center.detail, /prosbe o wode/, 'the final goal recalls the first request for water');

// --- The final call outranks an unfinished tutorial ---------------------------------
mentorPhase = 'water';
tick(2);
assert.ok(taskById('story:center'), 'the calling center outranks the mentor thread');
assert.equal(taskById('story:mentor'), null, 'the tutorial goal yields to the final call');
mentorPhase = 'done';

// --- Epilogue: the tracker goes quiet ----------------------------------------------
hearts.mother = 1;
tick(2);
assert.equal(activeStoryTasks().length, 0, 'the completed story leaves no dangling goals');

// --- Persistence: beats stay played across a reload ---------------------------------
const snap = storyProgression.snapshot();
assert.ok(snap.seen.horizons && snap.seen.earth, 'snapshot records played beats');
messages.length = 0;
storyProgression.reset();
assert.equal(storyProgression.restore(snap), true, 'restore accepts its own snapshot');
hearts.mother = 0;
centerPhase = 'calling';
tick(8);
assert.equal(messages.filter(m=>BEATS.horizons.includes(m)).length, 0, 'restored beats do not replay');
assert.ok(taskById('story:center'), 'restored progression still derives the current goal');

console.log('story-progression-sim: all assertions passed');
