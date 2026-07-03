import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = {};
globalThis.msg = text => messages.push(String(text));
const messages = [];

const { T } = await import('../src/constants.js');
const { STORY_LORE, storyRevealStage, storyWhispersForProgress, storyInvasionLinesForProgress } = await import('../src/engine/story_lore.js');
const { tutorialNpc } = await import('../src/engine/tutorial_npc.js');

const questSteps=tutorialNpc.questSteps();
assert.deepEqual(questSteps.map(s=>s.id), ['watch_area','tree_watch_short','tree_watch_long','sand_hide','water','raw_meat','cooked_meat','duel','master_stone','reward_choice','done'], 'mentor tutorial is defined as a scalable ordered quest chain');
assert.deepEqual(questSteps.filter(s=>s.kind==='observe').map(s=>s.seconds), [12,30,60,30], 'mentor prologue carries timed simulation-observation tasks');
assert.ok(questSteps.filter(s=>s.kind==='handoff').every(s=>s.item && s.amount>0 && s.next), 'handoff quest steps declare resource requirements and next phase');
assert.equal(questSteps.find(s=>s.id==='reward_choice').choices.length, 3, 'mentor stream reward step declares three choices');
assert.ok(STORY_LORE.arc.some(a=>a.id==='mentor_reveal'), 'shared story lore names the mentor reveal for later systems');
assert.ok(STORY_LORE.premise.join(' ').includes('symulacji'), 'shared story lore records the layered simulation premise');
assert.equal(STORY_LORE.metaphor.order.length, 5, 'shared story lore defines the five metaphorical boss conflicts');
assert.match(STORY_LORE.metaphor.guardians.west_ice.reveal, /odtraceni|chlod/i, 'ice guardian metaphor is emotional rejection and coldness');
assert.match(STORY_LORE.metaphor.guardians.east_fire.reveal, /namietnos|pozar/i, 'fire guardian metaphor is unfulfilled or destructive passion');
assert.match(STORY_LORE.metaphor.guardians.mother_self.reveal, /soba|siebie/i, 'mother guardian metaphor is the fight with oneself');
const earlyLoreRoot = {MM:{progress:{guardianHearts(){ return {}; }}}};
const iceLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true}; }}}};
const earthLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true}; }}}};
const finalLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true,sky:true,mother:true}; }}}};
assert.equal(storyRevealStage(earlyLoreRoot), 'start', 'lore reveal starts with observer unease before guardian spoilers');
assert.equal(storyRevealStage(iceLoreRoot), 'west_ice', 'ice heart advances lore to rejection/coldness');
assert.equal(storyRevealStage(earthLoreRoot), 'earth_mole', 'earth heart advances lore to hidden-memory stage');
assert.ok(!storyWhispersForProgress(earlyLoreRoot).some(line=>/Macierzyst|Centrum swiata|Stary Kwadrat.*maska/i.test(line)), 'early whispers avoid final mentor/center spoilers');
assert.ok(storyWhispersForProgress(iceLoreRoot).some(line=>/chlod|odtrac/i.test(line)), 'post-ice whispers reveal the rejection metaphor');
assert.ok(storyWhispersForProgress(finalLoreRoot).some(line=>/Centrum|Stary Kwadrat/i.test(line)), 'late whispers can mention center and mentor suspicion');
assert.ok(storyInvasionLinesForProgress('alien','rare',finalLoreRoot).some(line=>/lustrem|samym soba/i.test(line)), 'late rare alien lore can hint at self-confrontation');

const worldGen = {
  worldSeed:12345,
  settings:{seaLevel:62},
  biomeType(){ return 1; },
  surfaceHeight(){ return 30; }
};
const tileOverrides = new Map();
function tileKey(x,y){ return Math.floor(x)+','+Math.floor(y); }
function getTile(x,y){
  const custom=tileOverrides.get(tileKey(x,y));
  if(custom!==undefined) return custom;
  if(y>=30) return T.GRASS;
  return T.AIR;
}
function setTile(x,y,t){ tileOverrides.set(tileKey(x,y),t); }

let inventoryUpdates=0;
let saveMarks=0;
let heroDamage=0;
let equipped=null;
const granted=[];
globalThis.MM.inventory = {
  grantItem(item,opts){
    granted.push({item:Object.assign({},item), opts:Object.assign({},opts)});
    return true;
  },
  equip(id){ equipped=id; return true; },
  getItem(){ return null; }
};
globalThis.inv = { water:0, meat:0, bakedMeat:0, masterStone:0, arrowWood:0 };
const player = {x:0.5,y:29,w:0.7,h:0.95,hp:100,vx:0,vy:0};
const ctx = {
  worldGen,
  onInventoryChange(){ inventoryUpdates++; },
  onChange(){ saveMarks++; },
  damageHero(amount){ heroDamage+=amount; player.hp-=amount; }
};
assert.equal(tutorialNpc.setContext(ctx), true, 'mentor registers one shared quest context for all damage and input paths');
function standByMentor(){
  const s=tutorialNpc._debug();
  player.x=s.x;
  player.y=s.y;
}
function runNpc(seconds){
  const ticks=Math.ceil(seconds/0.1);
  for(let i=0;i<ticks;i++) tutorialNpc.update(0.1,player,getTile,setTile,ctx);
}
function standAt(x,y){
  player.x=x;
  player.y=y;
}

tutorialNpc.reset();
assert.equal(tutorialNpc.hasPosition(), false, 'mentor starts unplaced after reset');
assert.equal(tutorialNpc.placeNearWorldStart(getTile,worldGen), true, 'mentor can be anchored near the world start');
assert.equal(tutorialNpc.hasPosition(), true, 'mentor has a world position after placement');
let state=tutorialNpc._debug();
assert.ok(Math.abs(state.x)<=40 && Math.abs(state.y-29)<0.01, 'mentor is near the start and standing on the surface');

standAt(state.x+6,state.y);
runNpc(12.2);
assert.equal(tutorialNpc.phase(), 'tree_watch_short', 'area observation advances into the first tree experiment');
assert.equal(tutorialNpc.summary().status, 'observe', 'tree experiment is exposed as an observe job');

const treeX=Math.floor(state.x)+2;
const treeSupportY=26;
setTile(treeX,treeSupportY,T.LEAF);
standAt(treeX+0.5,treeSupportY-1);
runNpc(30.2);
assert.equal(tutorialNpc.phase(), 'tree_watch_long', 'thirty seconds on a tree advances to the longer tree observation');
standAt(treeX+0.5,treeSupportY-1);
runNpc(60.2);
assert.equal(tutorialNpc.phase(), 'sand_hide', 'sixty seconds on a tree advances to the sand hiding test');

const sandX=Math.floor(state.x)+3;
setTile(sandX,30,T.SAND);
standAt(sandX+0.5,29);
runNpc(30.2);
assert.equal(tutorialNpc.phase(), 'water', 'sand hiding finishes the simulation prologue and starts the water request');

standByMentor();
globalThis.inv.water=1;
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc.phase(), 'raw_meat', 'water handoff advances to the food request');
assert.equal(globalThis.inv.water, 0, 'water handoff consumes one water block');
assert.ok(inventoryUpdates>=1 && saveMarks>=1, 'resource handoff refreshes inventory and marks the save dirty');

globalThis.inv.meat=1;
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc.phase(), 'cooked_meat', 'raw meat handoff asks the hero to cook meat next');
assert.equal(globalThis.inv.meat, 0, 'raw meat handoff consumes one raw meat');

globalThis.inv.bakedMeat=1;
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc.phase(), 'duel', 'cooked meat handoff starts the duel');
assert.equal(globalThis.inv.bakedMeat, 0, 'cooked meat handoff consumes one cooked meat');
state=tutorialNpc._debug();
assert.equal(state.hp, state.maxHp, 'duel starts with full mentor HP');

assert.equal(tutorialNpc.damageAt(Math.floor(state.x),Math.floor(state.y),5), true, 'mentor can be damaged during the duel');
assert.ok(tutorialNpc._debug().hp<state.maxHp, 'duel damage lowers mentor HP');
for(let i=0; i<13; i++) tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.ok(heroDamage>=5, 'mentor can hit the hero back during the duel');

const originalGrantItem=globalThis.MM.inventory.grantItem;
globalThis.MM.inventory.grantItem=(item,opts)=>{
  granted.push({item:Object.assign({},item), opts:Object.assign({},opts)});
  return !!(opts && opts.essential);
};
const inventoryUpdatesBeforeDefeat=inventoryUpdates;
const saveMarksBeforeDefeat=saveMarks;
assert.equal(tutorialNpc.damageAt(Math.floor(state.x),Math.floor(state.y),999), true, 'mentor defeat is acknowledged even when only essential rewards can bypass a full bag');
assert.equal(tutorialNpc.phase(), 'master_stone', 'mentor defeat advances even with a full ordinary loot bag');
assert.equal(tutorialNpc._debug().hp, 0, 'mentor is defeated instead of being pinned at one HP by reward capacity');
assert.equal(globalThis.inv.arrowWood, 30, 'mentor reward grants starter wooden arrows');
assert.ok(inventoryUpdates>inventoryUpdatesBeforeDefeat, 'contextless mentor damage refreshes inventory through the registered quest context');
assert.ok(saveMarks>saveMarksBeforeDefeat, 'contextless mentor damage marks the save dirty through the registered quest context');
assert.equal(granted.length, 1, 'mentor reward grants exactly one weapon item');
assert.equal(granted[0].item.id, 'mentor_bow_wood', 'mentor reward grants the dedicated wooden bow');
assert.equal(granted[0].opts.equip, true, 'mentor reward equips the bow immediately');
assert.equal(granted[0].opts.essential, true, 'mentor bow is granted as essential quest gear');
assert.equal(equipped, 'mentor_bow_wood', 'mentor reward explicitly equips the bow');
globalThis.MM.inventory.grantItem=originalGrantItem;

assert.ok(messages.some(m=>m.includes('luk')), 'mentor announces the bow reward');

standByMentor();
globalThis.inv.masterStone=1;
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc.phase(), 'reward_choice', 'master stone handoff opens the stream weapon reward choice');
assert.equal(globalThis.inv.masterStone, 0, 'master stone handoff consumes one master stone');
assert.equal(tutorialNpc.handleKey('4',player,ctx), false, 'unrelated number keys are not consumed by the mentor choice');
player.x+=20;
assert.equal(tutorialNpc.handleKey('1',player,ctx), false, 'mentor choice keys are not consumed when the hero is too far away');
assert.equal(tutorialNpc.phase(), 'reward_choice', 'distant reward-choice key press leaves the choice pending');
standByMentor();
const inventoryUpdatesBeforeChoice=inventoryUpdates;
const saveMarksBeforeChoice=saveMarks;
assert.equal(tutorialNpc.handleKey('2',player), true, 'mentor handles a valid stream reward choice through the registered context');
assert.equal(tutorialNpc.phase(), 'done', 'stream reward choice completes the tutorial arc');
assert.ok(inventoryUpdates>inventoryUpdatesBeforeChoice, 'default-context reward choice refreshes inventory');
assert.ok(saveMarks>saveMarksBeforeChoice, 'default-context reward choice marks the save dirty');
assert.equal(granted.length, 2, 'mentor grants exactly one stream reward after the bow');
assert.equal(granted[1].item.id, 'mentor_flamethrower', 'choice 2 grants the mentor flamethrower variant');
assert.equal(granted[1].opts.equip, true, 'stream reward is equipped immediately');
assert.equal(equipped, 'mentor_flamethrower', 'stream reward explicitly equips the chosen weapon');

const snap=tutorialNpc.snapshot();
tutorialNpc.reset();
assert.equal(tutorialNpc.restore(snap), true, 'tutorial snapshot restores');
assert.equal(tutorialNpc.phase(), 'done', 'restored tutorial keeps completed phase');
assert.equal(tutorialNpc._debug().rewarded, true, 'restored tutorial keeps reward state');
assert.equal(tutorialNpc._debug().streamRewarded, true, 'restored tutorial keeps stream reward state');
assert.equal(tutorialNpc._debug().streamChoice, 'mentor_flamethrower', 'restored tutorial keeps chosen stream reward');

tutorialNpc.reset();
assert.equal(tutorialNpc.restore({v:1,x:6.5,y:29,phase:'duel',hp:0,rewarded:false}), true, 'legacy failed-reward duel snapshot restores');
assert.equal(tutorialNpc.phase(), 'duel', 'legacy failed-reward save remains in the duel');
assert.equal(tutorialNpc._debug().hp, 1, 'legacy failed-reward save becomes finishable again');

tutorialNpc.reset();
assert.equal(tutorialNpc.restore({v:1,x:6.5,y:29,phase:'done',hp:28,rewarded:false}), true, 'legacy completed snapshot restores');
assert.equal(tutorialNpc.phase(), 'master_stone', 'legacy bow-complete snapshot migrates to the volcano request');
assert.equal(tutorialNpc._debug().rewarded, true, 'legacy bow-complete snapshot normalizes bow reward state');
assert.equal(tutorialNpc._debug().hp, 0, 'legacy completed snapshot keeps mentor defeated');

tutorialNpc.reset();
assert.equal(tutorialNpc.restore({v:2,x:6.5,y:29,phase:'done',hp:0,bowRewarded:true,streamRewarded:true,streamChoice:'mentor_water_hose'}), true, 'completed stream-reward snapshot restores');
assert.equal(tutorialNpc.phase(), 'done', 'completed stream-reward snapshot remains done');
assert.equal(tutorialNpc._debug().streamChoice, 'mentor_water_hose', 'completed stream-reward snapshot keeps its chosen weapon');

tutorialNpc.reset();
assert.equal(tutorialNpc.attackAt(0,29,50), false, 'mentor is not attackable before the duel');
tutorialNpc.restore({v:1,x:6.5,y:29,phase:'water',hp:28,rewarded:false});
const calls=[];
const drawCtx = {
  fillStyle:'', strokeStyle:'', lineWidth:1, font:'',
  save(){ calls.push('save'); },
  restore(){ calls.push('restore'); },
  beginPath(){ calls.push('beginPath'); },
  ellipse(){ calls.push('ellipse'); },
  arc(){ calls.push('arc'); },
  fill(){ calls.push('fill'); },
  stroke(){ calls.push('stroke'); },
  fillRect(){ calls.push('fillRect'); },
  strokeRect(){ calls.push('strokeRect'); },
  moveTo(){ calls.push('moveTo'); },
  lineTo(){ calls.push('lineTo'); },
  quadraticCurveTo(){ calls.push('quadraticCurveTo'); },
  translate(){ calls.push('translate'); },
  measureText(text){ return {width:String(text).length*6}; },
  fillText(text){ calls.push(['fillText',String(text)]); }
};
// Dialogue is click-driven: the bubble only appears after the NPC is spoken to.
tutorialNpc.draw(drawCtx,20,()=>true);
assert.ok(!calls.some(c=>Array.isArray(c) && c[0]==='fillText'), 'mentor stays quiet until clicked');
assert.equal(tutorialNpc.talk({x:6.5,y:29}), true, 'clicking the mentor makes him speak');
tutorialNpc.draw(drawCtx,20,()=>true);
assert.ok(calls.includes('arc'), 'comic cloud bubble uses round cloud arcs');
assert.ok(calls.some(c=>Array.isArray(c) && c[0]==='fillText'), 'comic cloud bubble renders dialogue text once spoken to');
calls.length=0;
tutorialNpc.restore({v:2,x:6.5,y:29,phase:'reward_choice',hp:0,bowRewarded:true,streamRewarded:false});
tutorialNpc.talk({x:6.5,y:29});
tutorialNpc.draw(drawCtx,20,()=>true);
assert.ok(calls.some(c=>Array.isArray(c) && c[1]==='1 Waz'), 'reward choice bubble labels the water hose option');
assert.ok(calls.some(c=>Array.isArray(c) && c[1]==='2 Ogien'), 'reward choice bubble labels the flamethrower option');
assert.ok(calls.some(c=>Array.isArray(c) && c[1]==='3 Gaz'), 'reward choice bubble labels the gas emitter option');

tutorialNpc.setContext({});
console.log('tutorial-npc-sim: all assertions passed');
