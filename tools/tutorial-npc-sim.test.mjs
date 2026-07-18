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
assert.deepEqual(questSteps.map(s=>s.id), ['watch_area','tree_watch_short','tree_watch_long','sand_hide','water','raw_meat','cooked_meat','duel','master_stone','reward_choice','guardian_return','guardian_verdict','vanished'], 'mentor tutorial includes the post-training return quest and final verdict');
assert.deepEqual(questSteps.filter(s=>s.kind==='observe').map(s=>s.seconds), [12,10,30,30], 'mentor prologue carries a ten-second tree trial followed by a thirty-second trial');
assert.ok(questSteps.filter(s=>s.kind==='handoff').every(s=>s.item && s.amount>0 && s.next), 'handoff quest steps declare resource requirements and next phase');
assert.equal(questSteps.find(s=>s.id==='reward_choice').choices.length, 3, 'mentor stream reward step declares three choices');
assert.equal(questSteps.find(s=>s.id==='guardian_verdict').choices.length, 2, 'guardian verdict declares independent west/east choices');
assert.ok(STORY_LORE.arc.some(a=>a.id==='mentor_reveal'), 'shared story lore names the mentor reveal for later systems');
assert.ok(STORY_LORE.premise.join(' ').includes('symulacji'), 'shared story lore records the layered simulation premise');
assert.equal(STORY_LORE.metaphor.order.length, 5, 'shared story lore defines the five metaphorical boss conflicts');
assert.match(STORY_LORE.metaphor.guardians.west_ice.reveal, /odtraceni|chlod/i, 'ice guardian metaphor is emotional rejection and coldness');
assert.match(STORY_LORE.metaphor.guardians.east_fire.reveal, /namietnos|pozar/i, 'fire guardian metaphor is unfulfilled or destructive passion');
assert.match(STORY_LORE.metaphor.guardians.mother_self.reveal, /soba|siebie/i, 'mother guardian metaphor is the fight with oneself');
// Stage mapping is one act ahead of the fallen guardian: each heart unlocks the
// reflection on what it meant AND the foreshadowing of the next node, so the
// guidance arrives before the fight and closure after it.
const earlyLoreRoot = {MM:{progress:{guardianHearts(){ return {}; }}}};
const iceLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true}; }}}};
const bothLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true,fire:true}; }}}};
const earthLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true}; }}}};
const airLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true,air:true}; }}}};
const finalLoreRoot = {MM:{progress:{guardianHearts(){ return {ice:true,fire:true,earth:true,sky:true,mother:true}; }}}};
assert.equal(storyRevealStage(earlyLoreRoot), 'start', 'lore reveal starts with observer unease before guardian spoilers');
assert.equal(storyRevealStage(iceLoreRoot), 'west_ice', 'ice heart advances lore to rejection/coldness');
assert.equal(storyRevealStage(bothLoreRoot), 'earth_mole', 'both elemental hearts foreshadow the buried mole');
assert.equal(storyRevealStage(earthLoreRoot), 'sky_ambition', 'earth heart foreshadows the false final above');
assert.equal(storyRevealStage(airLoreRoot), 'mother_self', 'air heart turns the whispers toward the center and the mentor');
assert.equal(storyRevealStage(finalLoreRoot), 'epilogue', 'mother heart closes the arc with the quiet epilogue stage');
assert.ok(!storyWhispersForProgress(earlyLoreRoot).some(line=>/Macierzyst|Centrum swiata|Stary Kwadrat.*maska/i.test(line)), 'early whispers avoid final mentor/center spoilers');
assert.ok(storyWhispersForProgress(iceLoreRoot).some(line=>/chlod|odtrac/i.test(line)), 'post-ice whispers reveal the rejection metaphor');
assert.ok(storyWhispersForProgress(airLoreRoot).some(line=>/Centrum|Stary Kwadrat/i.test(line)), 'post-sky whispers mention center and mentor suspicion before the finale');
assert.ok(storyWhispersForProgress(finalLoreRoot).some(line=>/Centrum|Stary Kwadrat/i.test(line)), 'late whispers can mention center and mentor suspicion');
assert.ok(storyWhispersForProgress(finalLoreRoot).some(line=>/oddycha rowniej|paska ladowania|Przestalismy sprawdzac/i.test(line)), 'epilogue whispers describe the world breathing on its own');
assert.ok(storyInvasionLinesForProgress('alien','rare',airLoreRoot).some(line=>/lustrem|samym soba/i.test(line)), 'post-sky rare alien lore hints at self-confrontation');
assert.ok(STORY_LORE.center && Array.isArray(STORY_LORE.center.reveal) && STORY_LORE.center.reveal.length>=8, 'center lore carries the full mentor confession');
assert.ok(Array.isArray(STORY_LORE.center.mirrorHints) && STORY_LORE.center.mirrorHints.length>=3, 'center lore teaches the reversed-damage rule diegetically');
assert.match(STORY_LORE.center.reveal.join(' '), /kazdy cios nalezy do tego, kto go zadaje/i, 'the confession states the single rule of the final fight');

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
const rewardChests=[];
globalThis.MM.inventory = {
  grantItem(item,opts){
    granted.push({item:Object.assign({},item), opts:Object.assign({},opts)});
    return true;
  },
  equip(id){ equipped=id; return true; },
  getItem(){ return null; }
};
globalThis.MM.drops = {
  spawnChest(x,y,tier,opts){
    const chest={x,y,tier,opts:Object.assign({},opts)};
    rewardChests.push(chest);
    return chest;
  }
};
const guardianHearts={};
globalThis.MM.progress={guardianHearts(){ return Object.assign({},guardianHearts); }};
globalThis.inv = { water:0, meat:0, bakedMeat:0, masterStone:0, arrowWood:0, rottenMeat:0 };
const player = {x:0.5,y:29,w:0.7,h:0.95,hp:100,vx:0,vy:0};
const ctx = {
  player,
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
// Natural foliage is passable. Being visibly inside a connected crown must
// still start feedback even before the hero settles on the highest wood tile.
const canopyX=treeX+4;
setTile(canopyX,26,T.WOOD);
setTile(canopyX,25,T.LEAF);
setTile(canopyX+1,24,T.AUTUMN_LEAF_RED);
setTile(canopyX-1,24,T.LEAF);
standAt(canopyX+1.5,24.5);
runNpc(0.2);
assert.equal(tutorialNpc.summary().observe.active, true, 'direct contact with a connected passable crown starts the tree timer');

setTile(treeX,treeSupportY,T.AUTUMN_LEAF_ORANGE);
const treeStandingY=treeSupportY-player.h*0.5-0.001;
standAt(treeX+0.5,treeStandingY);
runNpc(0.2);
let treeObserve=tutorialNpc.summary().observe;
assert.equal(treeObserve.active, true, 'standing with either foot on a seasonal tree crown starts the timer');
assert.ok(treeObserve.progress>0, 'active tree observation accumulates time');
const signalCalls=[];
const signalCtx={
  save(){ signalCalls.push('save'); }, restore(){ signalCalls.push('restore'); },
  translate(x,y){ signalCalls.push(['translate',x,y]); }, scale(){ signalCalls.push('scale'); },
  beginPath(){ signalCalls.push('beginPath'); }, arc(){ signalCalls.push('arc'); },
  fill(){ signalCalls.push('fill'); }, stroke(){ signalCalls.push('stroke'); },
  fillRect(){ signalCalls.push('fillRect'); }, fillText(text){ signalCalls.push(['fillText',String(text)]); },
  measureText(text){ return {width:String(text).length*6}; }
};
assert.equal(tutorialNpc.drawObservationSignal(signalCtx,40,player,true,1250), true, 'active tree timer draws the overhead progress signal');
assert.equal(signalCalls.find(call=>Array.isArray(call) && call[0]==='translate')[1], player.x*40, 'signal follows world coordinates even when its artwork is size-capped');
assert.ok(signalCalls.some(call=>Array.isArray(call) && /s$/.test(call[1])), 'overhead progress signal includes the remaining seconds');
standAt(treeX+0.5,treeStandingY-0.4);
runNpc(0.2);
assert.equal(tutorialNpc.summary().observe.active, false, 'hovering above a tree does not count as standing on it');
assert.equal(tutorialNpc.drawObservationSignal(signalCtx,20,player,true,1450), false, 'overhead timer disappears as soon as time is no longer being counted');
standAt(treeX+0.5,treeStandingY);
runNpc(10.2);
assert.equal(tutorialNpc.phase(), 'tree_watch_long', 'ten seconds on a tree advances to the longer tree observation');
assert.equal(rewardChests.length, 1, 'the first tree task grants exactly one physical chest');
assert.equal(rewardChests[0].tier, 'uncommon', 'the first tree task chest has the promised uncommon tier');
standAt(treeX+0.5,treeStandingY);
runNpc(30.2);
assert.equal(tutorialNpc.phase(), 'sand_hide', 'thirty seconds on a tree advances to the sand hiding test');
assert.equal(globalThis.inv.masterStone, 1, 'the second tree task grants one master stone');

const sandX=Math.floor(state.x)+3;
const sandSupportY=30;
const sandStandingY=sandSupportY-player.h*0.5-0.001;
setTile(sandX,sandSupportY,T.SAND);
standAt(sandX+0.5,sandStandingY);
runNpc(0.2);
assert.equal(tutorialNpc.summary().observe.active, false, 'standing on one exposed sand block no longer counts as hiding');
assert.equal(tutorialNpc.drawObservationSignal(signalCtx,20,player,true,1600), false, 'sand timer stays hidden until the safe enclosure is complete');
setTile(sandX-1,sandSupportY,T.SAND);
setTile(sandX+1,sandSupportY,T.SAND);
setTile(sandX-1,sandSupportY-1,T.SAND);
runNpc(0.2);
assert.equal(tutorialNpc.summary().observe.active, false, 'one sand side wall is not enough to hide the hero');
setTile(sandX+1,sandSupportY-1,T.SAND);
runNpc(0.2);
const sandObserve=tutorialNpc.summary().observe;
assert.equal(sandObserve.active, true, 'sand underfoot with walls on both sides starts the hiding timer');
assert.ok(sandObserve.progress>0, 'active sand hiding accumulates observation time');
assert.equal(getTile(sandX,sandSupportY-1),T.AIR,'the safe sand U requires no block over or inside the hero');
signalCalls.length=0;
assert.equal(tutorialNpc.drawObservationSignal(signalCtx,24,player,true,1750), true, 'active sand hiding draws its overhead timer and icon');
assert.ok(signalCalls.some(call=>Array.isArray(call) && /s$/.test(call[1])), 'sand signal includes the remaining seconds');
runNpc(30.2);
assert.equal(tutorialNpc.phase(), 'water', 'sand hiding finishes the simulation prologue and starts the water request');
assert.ok(messages.some(m=>/proba ukrycia w piasku zaliczona/i.test(m)), 'sand completion is announced globally even when the mentor is off-screen');

standByMentor();
globalThis.inv.water=1;
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc.phase(), 'water', 'carried water cannot overwrite the sand completion line on the next frame');
assert.equal(globalThis.inv.water, 1, 'water remains untouched while the sand completion is being announced');
const sandCompletionHold=tutorialNpc._debug().handoffHoldT;
assert.ok(sandCompletionHold>0, 'sand completion opens a short handoff reading window');
runNpc(sandCompletionHold+0.2);
assert.equal(tutorialNpc.phase(), 'raw_meat', 'water handoff resumes after the sand completion has been readable');
assert.equal(globalThis.inv.water, 0, 'water handoff consumes one water block');
assert.match(tutorialNpc.summary().line, /3 skrawk/i, 'water handoff explains that animals drop three meat scraps, not a ready block');
assert.match(tutorialNpc.summary().line, /craft|Blok miesa/i, 'water handoff points to crafting the meat block');
assert.ok(inventoryUpdates>=1 && saveMarks>=1, 'resource handoff refreshes inventory and marks the save dirty');

globalThis.inv.meat=1;
const rawMeatBefore=globalThis.inv.meat;
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc.phase(), 'cooked_meat', 'raw meat handoff asks the hero to cook meat next');
assert.equal(globalThis.inv.meat, rawMeatBefore, 'mentor verifies the raw meat block without taking it from the hero');
assert.equal(globalThis.inv.wood||0, 0, 'mentor does not add free wood with the cooking simulator');
assert.equal(granted.length, 1, 'raw meat handoff grants one permanent cooking tool');
assert.equal(granted[0].item.id, 'mentor_cooking_flame_simulator', 'the cooking tool is the dedicated mentor flame simulator');
assert.equal(granted[0].item.weaponType, 'flame', 'the simulator uses the real flame-stream controls');
assert.equal(granted[0].opts.equip, true, 'the cooking simulator equips immediately');
assert.equal(equipped, 'mentor_cooking_flame_simulator', 'the hero is ready to cook without searching the inventory');
assert.match(tutorialNpc.summary().line, /nie zabieram/i, 'mentor explicitly confirms that the uncooked meat remains with the hero');
assert.match(tutorialNpc.summary().line, /przytrzymaj LPM/i, 'mentor explains how to operate the simulator');
assert.match(tutorialNpc.summary().line, /zostaje twoj/i, 'mentor explicitly says the simulator is permanent');
assert.match(tutorialNpc.summary().line, /drewno albo wegiel/i, 'mentor explains both available flamethrower fuels');
assert.match(tutorialNpc.summary().line, /czarny dym/i, 'mentor warns that coal makes the flamethrower smoke');

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
assert.equal(granted.length, 2, 'mentor defeat adds the bow after the retained cooking simulator');
assert.equal(granted[1].item.id, 'mentor_bow_wood', 'mentor reward grants the dedicated wooden bow');
assert.equal(granted[1].opts.equip, true, 'mentor reward equips the bow immediately');
assert.equal(granted[1].opts.essential, true, 'mentor bow is granted as essential quest gear');
assert.equal(equipped, 'mentor_bow_wood', 'mentor reward explicitly equips the bow');
globalThis.MM.inventory.grantItem=originalGrantItem;

assert.ok(messages.some(m=>m.includes('luk')), 'mentor announces the bow reward');
assert.equal(globalThis.inv.masterStone, 1, 'a master stone already carried during the duel remains with the hero after victory');
assert.match(tutorialNpc.summary().line, /znajdz wulkan.*przynies kamien mistrza/i, 'mentor issues the master-stone command before accepting an existing stone');
const masterStoneCommandHold=tutorialNpc._debug().handoffHoldT;
assert.ok(masterStoneCommandHold>0, 'the master-stone command opens a readable handoff window');

standByMentor();
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc.phase(), 'master_stone', 'the mentor cannot take an already-carried master stone on the next frame');
assert.equal(globalThis.inv.masterStone, 1, 'the master stone remains untouched while the command is being displayed');
runNpc(masterStoneCommandHold+0.2);
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
assert.equal(tutorialNpc.phase(), 'guardian_return', 'stream reward choice starts the post-training guardian return quest');
assert.ok(inventoryUpdates>inventoryUpdatesBeforeChoice, 'default-context reward choice refreshes inventory');
assert.ok(saveMarks>saveMarksBeforeChoice, 'default-context reward choice marks the save dirty');
assert.equal(granted.length, 3, 'mentor grants exactly one stream reward after the simulator and bow');
assert.equal(granted[2].item.id, 'mentor_flamethrower', 'choice 2 grants the mentor flamethrower variant');
assert.equal(granted[2].opts.equip, true, 'stream reward is equipped immediately');
assert.equal(equipped, 'mentor_flamethrower', 'stream reward explicitly equips the chosen weapon');
assert.match(tutorialNpc.summary().line, /koniec treningu/i, 'the final reward immediately announces the end of Square training');
assert.match(tutorialNpc.summary().line, /zdany na siebie/i, 'Square makes clear that the hero continues alone');
assert.match(tutorialNpc.summary().line, /nikomu nie ufaj/i, 'Square ends with the warning not to trust anyone');
assert.match(tutorialNpc.summary().line, /Straznika Zachodu i Wschodu/i, 'Square assigns both horizon guardians after ending the training');
assert.match(tutorialNpc.summary().line, /wroc.*ktory byl trudniejszy/i, 'Square clearly asks the hero to return with a difficulty verdict');
let followupMentorsMentioned=false;
for(let i=0;i<4;i++){
  tutorialNpc.talk(player);
  followupMentorsMentioned=followupMentorsMentioned || /Trojkat.*\+500.*Teserakt.*-500.*Trapezoid.*duzej wodzie/i.test(tutorialNpc.summary().line);
}
assert.equal(followupMentorsMentioned,true,'Square points toward all three follow-up mentors after training');
assert.equal(tutorialNpc.phase(),'guardian_return','talking before both victories cannot skip the return condition');
guardianHearts.ice=1;
tutorialNpc.talk(player);
assert.equal(tutorialNpc.phase(),'guardian_return','defeating only the western guardian is insufficient');
guardianHearts.fire=1;
assert.equal(tutorialNpc.talk(player),true,'returning after both guardian victories advances the final conversation');
assert.equal(tutorialNpc.phase(),'guardian_verdict','Square requires a west/east difficulty choice after both victories');
assert.match(tutorialNpc.summary().line,/Ktory byl trudniejszy/i,'Square asks the promised comparison question');
player.x+=20;
assert.equal(tutorialNpc.handleKey('1',player),false,'the guardian verdict cannot be submitted from far away');
standByMentor();
const rottenBefore=globalThis.inv.rottenMeat;
assert.equal(tutorialNpc.handleKey('1',player),true,'the western guardian can be selected as the harder fight');
assert.equal(tutorialNpc.phase(),'vanished','the final verdict closes Square quest state');
assert.equal(tutorialNpc.summary().line,'Aha','Square responds with exactly Aha');
assert.equal(globalThis.inv.rottenMeat,rottenBefore+1,'Square awards exactly one piece of rotten meat');
assert.equal(tutorialNpc.hidden(),false,'Square remains visible while the Aha response is readable');
assert.equal(tutorialNpc.handleKey('2',player),false,'a second verdict cannot duplicate the rotten meat reward');
runNpc(5);
assert.equal(tutorialNpc.hidden(),true,'Square disappears after the Aha response finishes');
assert.equal(globalThis.inv.rottenMeat,rottenBefore+1,'delayed disappearance cannot duplicate the reward');

const snap=tutorialNpc.snapshot();
tutorialNpc.reset();
assert.equal(tutorialNpc.restore(snap), true, 'tutorial snapshot restores');
assert.equal(tutorialNpc.phase(), 'vanished', 'restored tutorial keeps the completed verdict phase');
assert.equal(tutorialNpc.hidden(), true, 'restored tutorial keeps Square permanently absent');
assert.equal(tutorialNpc._debug().rewarded, true, 'restored tutorial keeps reward state');
assert.equal(tutorialNpc._debug().streamRewarded, true, 'restored tutorial keeps stream reward state');
assert.equal(tutorialNpc._debug().guardianVerdictRewarded, true, 'restored tutorial keeps the rotten-meat verdict reward state');
assert.equal(tutorialNpc._debug().guardianVerdict, 'west', 'restored tutorial keeps which guardian was judged harder');
assert.equal(tutorialNpc._debug().cookingFlameRewarded, true, 'restored tutorial keeps the permanent cooking simulator reward state');
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
assert.equal(tutorialNpc.phase(), 'guardian_return', 'old completed stream-reward saves receive the new guardian return quest');
assert.equal(tutorialNpc._debug().streamChoice, 'mentor_water_hose', 'completed stream-reward snapshot keeps its chosen weapon');

tutorialNpc.reset();
assert.equal(tutorialNpc.attackAt(0,29,50), false, 'mentor is not attackable before the duel');

const legacyChestBefore=rewardChests.length;
const legacyStoneBefore=globalThis.inv.masterStone;
tutorialNpc.restore({v:4,x:6.5,y:29,phase:'water',hp:28,bowRewarded:false,streamRewarded:false});
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(rewardChests.length, legacyChestBefore+1, 'an older save past both tree trials receives its missing chest once after load');
assert.equal(globalThis.inv.masterStone, legacyStoneBefore+1, 'an older save past both tree trials receives its missing master stone once after load');
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(rewardChests.length, legacyChestBefore+1, 'legacy chest catch-up cannot duplicate on later frames');
assert.equal(globalThis.inv.masterStone, legacyStoneBefore+1, 'legacy stone catch-up cannot duplicate on later frames');

const legacyCookingGrantedBefore=granted.length;
const legacyCookingMeatBefore=globalThis.inv.meat|0;
const legacyCookingWoodBefore=globalThis.inv.wood|0;
tutorialNpc.reset();
tutorialNpc.restore({v:6,x:6.5,y:29,phase:'cooked_meat',hp:28,bowRewarded:false,streamRewarded:false});
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(tutorialNpc._debug().cookingFlameRewarded, true, 'an existing save already waiting for cooked meat receives the new simulator');
assert.equal(granted.length, legacyCookingGrantedBefore+1, 'legacy cooked-meat catch-up grants the simulator exactly once');
assert.equal(globalThis.inv.meat, legacyCookingMeatBefore+1, 'legacy cooked-meat catch-up returns a raw block to cook');
assert.equal(globalThis.inv.wood|0, legacyCookingWoodBefore, 'legacy cooked-meat catch-up does not inject free fuel');
tutorialNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(granted.length, legacyCookingGrantedBefore+1, 'simulator catch-up cannot duplicate on later frames');

tutorialNpc.reset();
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
