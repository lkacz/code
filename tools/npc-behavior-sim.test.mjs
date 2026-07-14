import assert from 'node:assert/strict';

// NPCs are now mobile members of the hero's species: they fall under gravity, walk and
// jump, collide with blocks and each other, occasionally do self-healing chores, and
// speak only when clicked. This sim drives the registry against a real in-memory world
// and checks those invariants hold (no falling through floors, no walking through walls,
// chores leave no permanent damage, dialogue is click-gated).

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = {};
globalThis.msg = ()=>{};

const { T } = await import('../src/constants.js');
const { createQuestNpc, npcRegistry } = await import('../src/engine/npc_system.js');
const { isBriefCharacterSpeech, readableCharacterSpeechDuration } = await import('../src/engine/character_speech.js');

const SURFACE = 40;
const HOME = 0;
const tiles = new Map();
const tk = (x,y)=>Math.round(x)+','+Math.round(y);
function getTile(x,y){ const k=tk(x,y); if(tiles.has(k)) return tiles.get(k); return Math.round(y)>=SURFACE ? T.STONE : T.AIR; }
function setTile(x,y,v){ tiles.set(tk(x,y), v); }
const worldGen = { worldSeed:11, settings:{seaLevel:62}, biomeType(){ return 1; }, surfaceHeight(){ return SURFACE; } };
globalThis.MM.worldGen = worldGen;

// Walls boxing a pen around the home so we can prove block collision in both directions.
for(let y=SURFACE-4; y<SURFACE; y++){ setTile(HOME-5,y,T.STONE); setTile(HOME+5,y,T.STONE); }
const naturalPen = new Map();
for(let x=HOME-4; x<=HOME+4; x++) for(let y=SURFACE-4; y<SURFACE; y++) naturalPen.set(tk(x,y), getTile(x,y));

function makeNpc(id,homeX,prompt=id+' chce drewna'){
  return createQuestNpc({
    id, displayName:id, maxHp:10,
    initialData:{ role:id, home:{x:homeX}, color:'#6f6745', accent:'#c2df8a' },
    steps:[
      {id:'job',kind:'handoff',item:'wood',amount:99,next:'done',prompt,missing:'brak',complete:'dzieki'},
      {id:'done',kind:'done',prompt:'hej'}
    ]
  });
}

// Deterministic RNG so the wandering is reproducible across runs.
let seed=12345;
const realRandom=Math.random;
Math.random=()=>{ seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff; return seed/0x7fffffff; };

npcRegistry.reset();
const npc=makeNpc('rover',HOME);
npc.restore({v:1,x:HOME,y:SURFACE-5,phase:'job',hp:10}); // start in mid-air over the pen
const player={x:HOME,y:SURFACE-1,hp:100};

let landed=false, moved=false, everInsideWall=false;
let prevX=npc._debug().x;
for(let i=0;i<900;i++){
  npcRegistry.update(1/30,player,getTile,setTile,{worldGen});
  const s=npc._debug();
  if(s.move && s.move.onGround) landed=true;
  if(Math.abs(s.x-prevX)>0.01) moved=true;
  prevX=s.x;
  // Never penetrate a wall tile or fall through the floor.
  if(isSolidWorld(s.x,s.y)) everInsideWall=true;
  assert.ok(s.y<SURFACE+0.2, 'NPC never falls through the solid floor');
  assert.ok(Math.abs(s.x-HOME)<8, 'NPC roams but stays near its home');
}
function isSolidWorld(x,y){
  const t=getTile(Math.floor(x),Math.floor(y));
  return t!==T.AIR && t!==T.WATER && t!==T.LAVA;
}
assert.ok(landed, 'NPC falls under gravity and lands on the ground');
assert.ok(moved, 'NPC walks around procedurally');
assert.ok(!everInsideWall, 'NPC never walks inside a solid block');

// Let any in-flight chore settle without starting new ones (idle bias), then prove the
// world was left exactly as found — dig/build chores are self-healing.
Math.random=()=>0.0;
for(let i=0;i<240;i++) npcRegistry.update(1/30,player,getTile,setTile,{worldGen});
let dirty=0;
for(const [k,v] of naturalPen){ if(getTile(+k.slice(0,k.indexOf(',')),+k.slice(k.indexOf(',')+1))!==v) dirty++; }
assert.equal(dirty, 0, 'NPC chores self-heal: the world is left exactly as it was found');
Math.random=realRandom;

// Click-to-talk: silent until clicked, then a bubble line is set.
assert.equal(npc._debug().lineT, 0, 'NPC stays silent until spoken to');
const s=npc._debug();
const tileX=Math.floor(s.x), tileY=Math.floor(s.y);
player.x=s.x; player.y=s.y;
assert.equal(npc.interactAt(tileX,tileY,player), true, 'clicking the NPC tile within reach makes it talk');
assert.ok(npc._debug().lineT>0, 'talking surfaces a dialogue line');
// Out of reach → no talk.
assert.equal(npc.interactAt(tileX+40,tileY,{x:s.x+40,y:s.y}), false, 'clicking far away does not talk');

// Readability: short exclamations remain compatible with movement, while longer
// dialogue doubles its previous display time and owns a stationary speaking pose.
for(const bark of ['Niech żyje Strażniczka Wschodu!','Boli!','Walnął mnie!','Uciekać!']){
  assert.equal(isBriefCharacterSpeech(bark),true,'short bark stays movement-safe: '+bark);
}
const longLine='Zatrzymaj się, bo muszę opowiedzieć ci o bardzo ważnym przejściu pod górami.';
assert.equal(isBriefCharacterSpeech(longLine),false,'a multi-clause dialogue line is classified as long');
assert.equal(readableCharacterSpeechDuration(4.6,longLine),9.2,'long NPC dialogue is displayed exactly twice as long');

const longSpeaker=makeNpc('long_speaker',HOME,longLine);
longSpeaker.restore({v:1,x:HOME+0.5,y:SURFACE-1,phase:'job',hp:10});
let longState=longSpeaker._debug();
player.x=longState.x; player.y=longState.y;
longState.move.onGround=true; longState.move.vx=0; longState.move.vy=0;
longState.ai.mode='wander'; longState.ai.targetX=HOME+4; longState.ai.t=20;
assert.equal(longSpeaker.interactAt(Math.floor(longState.x),Math.floor(longState.y),player),true,'long-dialogue NPC starts speaking');
longState=longSpeaker._debug();
assert.equal(longState.lineLong,true,'long dialogue marks the stationary speaking pose');
assert.ok(Math.abs(longState.lineT-9.2)<0.001,'long dialogue bubble receives doubled lifetime');
const longStartX=longState.x;
for(let i=0;i<30;i++) longSpeaker.update(0.1,player,getTile,setTile,{worldGen});
assert.ok(Math.abs(longSpeaker._debug().x-longStartX)<0.001,'NPC stands still while long dialogue remains visible');
for(let i=0;i<70;i++) longSpeaker.update(0.1,player,getTile,setTile,{worldGen});
assert.equal(longSpeaker._debug().lineT,0,'long dialogue eventually leaves the screen');
assert.ok(Math.abs(longSpeaker._debug().x-longStartX)>0.05,'NPC resumes walking after the long dialogue disappears');

const shortSpeaker=makeNpc('short_speaker',HOME,'Niech żyje Strażniczka Wschodu!');
shortSpeaker.restore({v:1,x:HOME+0.5,y:SURFACE-1,phase:'job',hp:10});
let shortState=shortSpeaker._debug();
player.x=shortState.x; player.y=shortState.y;
shortState.move.onGround=true; shortState.move.vx=0; shortState.move.vy=0;
shortState.ai.mode='wander'; shortState.ai.targetX=HOME+4; shortState.ai.t=20;
assert.equal(shortSpeaker.interactAt(Math.floor(shortState.x),Math.floor(shortState.y),player),true,'short-bark NPC starts speaking');
shortState=shortSpeaker._debug();
assert.equal(shortState.lineLong,false,'short bark does not claim a stationary pose');
assert.ok(Math.abs(shortState.lineT-4.6)<0.001,'short bark keeps its original display lifetime');
const shortStartX=shortState.x;
shortSpeaker.update(0.1,player,getTile,setTile,{worldGen});
assert.ok(Math.abs(shortSpeaker._debug().x-shortStartX)>0.01,'NPC can keep walking while delivering a short bark');

// NPC-NPC separation: two residents dropped on the same spot push apart.
npcRegistry.reset();
const a=makeNpc('twin_a',HOME), b=makeNpc('twin_b',HOME);
a.restore({v:1,x:HOME,y:SURFACE-1,phase:'job',hp:10});
b.restore({v:1,x:HOME,y:SURFACE-1,phase:'job',hp:10});
for(let i=0;i<30;i++) npcRegistry.update(1/30,player,getTile,setTile,{worldGen});
const dx=Math.abs(a._debug().x-b._debug().x);
assert.ok(dx>0.2, 'overlapping NPCs collide and push apart (separation '+dx.toFixed(2)+')');

// Doors are structural for the world but passable for NPC movement. Dropping an NPC
// into a doorway should not trigger the wall-penetration detector.
npcRegistry.reset();
tiles.clear();
setTile(HOME,SURFACE-1,T.WOOD_DOOR);
const doorWalker=makeNpc('door_walker',HOME);
doorWalker.restore({v:1,x:HOME+0.5,y:SURFACE-1,phase:'job',hp:10});
for(let i=0;i<20;i++) npcRegistry.update(1/30,player,getTile,setTile,{worldGen});
const ds=doorWalker._debug();
assert.equal(getTile(HOME,SURFACE-1), T.WOOD_DOOR, 'test doorway remains a real structural tile');
assert.ok(Math.abs(ds.x-(HOME+0.5))<1.2 && ds.y<SURFACE+0.2, 'NPC can move through/inside a door tile without being ejected as if it were a wall');

// Trapdoors are structural floors by default, but NPCs can pass through them from below.
npcRegistry.reset();
tiles.clear();
for(let x=HOME-4; x<=HOME+4; x++) setTile(x,SURFACE-1,T.WOOD_TRAPDOOR);
const hatchWalker=makeNpc('hatch_walker',HOME);
hatchWalker.restore({v:1,x:HOME+0.5,y:SURFACE-3,phase:'job',hp:10});
let stoodOnTrapdoor=false, fellThroughTrapdoor=false;
for(let i=0;i<60;i++){
  npcRegistry.update(1/30,player,getTile,setTile,{worldGen});
  const s=hatchWalker._debug();
  if(s.move.onGround && s.y<SURFACE-1.1) stoodOnTrapdoor=true;
  if(s.y>SURFACE-0.2) fellThroughTrapdoor=true;
}
const hs=hatchWalker._debug();
assert.equal(getTile(HOME,SURFACE-1), T.WOOD_TRAPDOOR, 'test trapdoor remains a real structural tile');
assert.ok(stoodOnTrapdoor && !fellThroughTrapdoor && hs.y<SURFACE+0.2, 'NPC treats a closed trapdoor as a walkable floor from above');

npcRegistry.reset();
tiles.clear();
setTile(HOME,SURFACE-3,T.WOOD_TRAPDOOR);
const hatchJumper=makeNpc('hatch_jumper',HOME);
hatchJumper.restore({v:1,x:HOME+0.5,y:SURFACE-1.4,phase:'job',hp:10});
hatchJumper._debug().move.vy=-8;
let passedUpward=false;
for(let i=0;i<16;i++){
  npcRegistry.update(1/30,player,getTile,setTile,{worldGen});
  if(hatchJumper._debug().y<SURFACE-3.1) passedUpward=true;
}
assert.ok(passedUpward, 'NPC can pass upward through an overhead trapdoor while jumping from below');

npcRegistry.reset();
console.log('npc-behavior-sim: all assertions passed');
