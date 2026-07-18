import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.performance={now:()=>1000};
globalThis.MM={};
const messages=[];
globalThis.msg=text=>messages.push(String(text));
globalThis.inv={wood:0,glass:0,torch:0,dynamo:0,coal:0};

const { T }=await import('../src/constants.js');
const { dynamo }=await import('../src/engine/dynamo.js');
const { npcRegistry }=await import('../src/engine/npc_system.js');
const {
  findFirstLargeWaterShoreX,
  triangleMentor,
  tesseractMentor,
  trapezoidMentor
}=await import('../src/engine/mentor_npcs.js');

const tiles=new Map();
const backgrounds=new Map();
const key=(x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  const k=key(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=30 ? T.GRASS : T.AIR;
}
function setTile(x,y,t){
  const k=key(x,y);
  if(t===T.AIR) tiles.delete(k);
  else tiles.set(k,t);
}
function backgroundAt(x,y){ return backgrounds.get(key(x,y)) ?? T.AIR; }

const basin={left:100,right:220,width:121};
const worldGen={
  settings:{seaLevel:62},
  surfaceHeight(x){ return x>=basin.left && x<=basin.right ? 74 : 30; },
  biomeType(x){ return x>=basin.left && x<=basin.right ? 5 : 1; },
  oceanBasinAt(x){ return x>=basin.left && x<=basin.right ? basin : null; }
};
assert.equal(findFirstLargeWaterShoreX(worldGen),98,'the water mentor selects the near shore of the first large water body');

let inventoryUpdates=0;
let saveMarks=0;
const ctx={
  worldGen,
  backgroundAt,
  isBurning(){ return false; },
  isFurnishingPowered(){ return false; },
  onInventoryChange(){ inventoryUpdates++; },
  onChange(){ saveMarks++; }
};
npcRegistry.setContext(ctx);

for(const npc of [triangleMentor,tesseractMentor,trapezoidMentor]) npc.reset();
assert.equal(triangleMentor.placeNearWorldStart(getTile,worldGen),true,'Triangle can be placed at its fixed teaching region');
assert.equal(tesseractMentor.placeNearWorldStart(getTile,worldGen),true,'Tesseract can be placed at its fixed teaching region');
assert.equal(trapezoidMentor.placeNearWorldStart(getTile,worldGen),true,'Trapezoid can be placed beside the selected large water');
assert.ok(Math.abs(triangleMentor._debug().x-500.5)<0.01,'Triangle waits around field +500');
assert.ok(Math.abs(tesseractMentor._debug().x+499.5)<0.01,'Tesseract waits around field -500');
assert.ok(Math.abs(trapezoidMentor._debug().x-98.5)<0.01,'Trapezoid waits on dry land at the first large-water shore');
assert.equal(triangleMentor.questSteps()[0].kind,'briefing','follow-up mentors begin with a click-driven command');

function clickNpc(npc,player){
  const s=npc._debug();
  player.x=s.x; player.y=s.y;
  return npc.interactAt(Math.floor(s.x),Math.floor(s.y),player,ctx);
}
function tickNpc(npc,player,seconds){
  const count=Math.ceil(seconds/0.1);
  for(let i=0;i<count;i++) npc.update(0.1,player,getTile,setTile,ctx);
}

const player={x:0,y:29,w:0.7,h:0.95,hp:100,maxHp:100};
assert.equal(clickNpc(triangleMentor,player),true,'clicking Triangle starts the house lesson');
assert.equal(triangleMentor.phase(),'build_house','Triangle issues the house command before checking the build');
assert.equal(globalThis.inv.wood,24,'Triangle supplies wood for the first house');
assert.equal(globalThis.inv.glass,4,'Triangle supplies windows for the first house');
assert.equal(globalThis.inv.torch,2,'Triangle supplies light for the first house');
assert.match(triangleMentor.summary().line,/podloga.*sciany.*dach.*tlo.*pochodnia/i,'Triangle explains every condition used by the real shelter validator');

const houseLeft=506;
for(let x=houseLeft;x<=houseLeft+4;x++){
  setTile(x,25,T.WOOD);
  setTile(x,29,T.WOOD);
}
for(let y=26;y<=28;y++){
  setTile(houseLeft,y,T.WOOD);
  setTile(houseLeft+4,y,T.WOOD);
  for(let x=houseLeft+1;x<=houseLeft+3;x++) backgrounds.set(key(x,y),T.WOOD);
}
setTile(houseLeft+1,27,T.TORCH);
player.x=houseLeft+2.5;
player.y=27.5;
tickNpc(triangleMentor,player,1.3);
assert.equal(triangleMentor.phase(),'done','Triangle accepts a house recognized by the real house-healing system');

assert.equal(clickNpc(tesseractMentor,player),true,'clicking Tesseract starts the crafting and energy lesson');
assert.equal(tesseractMentor.phase(),'coal_power','Tesseract waits for actual hot-air generation');
assert.equal(globalThis.inv.dynamo,1,'Tesseract carries and gives the hero one dynamo');
assert.equal(globalThis.inv.coal,3,'Tesseract supplies coal for the energy experiment');
assert.match(tesseractMentor.summary().line,/wegiel.*wirnik.*podpal/i,'Tesseract explains how coal heat reaches the dynamo');
assert.match(tesseractMentor.summary().line,/drewno albo wegiel.*czarnym dymem/i,'Tesseract explains the smoky coal fallback for flamethrowers');
dynamo.reset();
const slotX=Math.floor(player.x)+3, slotY=27;
setTile(slotX-1,slotY,T.DYNAMO);
setTile(slotX,slotY,T.DYNAMO_SLOT);
setTile(slotX+1,slotY,T.DYNAMO);
player.x=slotX+0.5;
player.y=slotY+0.5;
assert.equal(dynamo.recordFlow(slotX,slotY,T.HOT_AIR,1,getTile),true,'hot air passing through the real rotor creates the lesson signal');
assert.equal(dynamo.generatedNear(player.x,player.y,'hot',10).kind,'hot','dynamo exposes its nearby physical generation source');
tickNpc(tesseractMentor,player,1.3);
assert.equal(tesseractMentor.phase(),'done','Tesseract accepts energy actually generated from hot air');

let aboard=false;
globalThis.MM.boats={heroOnBoat(){ return aboard ? {id:1} : null; }};
assert.equal(clickNpc(trapezoidMentor,player),true,'clicking Trapezoid starts the boat lesson');
assert.equal(trapezoidMentor.phase(),'build_boat','Trapezoid waits for a real raft boarding event');
assert.equal(globalThis.inv.wood,32,'Trapezoid adds eight planks to the unused house wood');
assert.match(trapezoidMentor.summary().line,/drewno.*wodzie.*tratwa/i,'Trapezoid explains the real wood-on-water construction rule');
tickNpc(trapezoidMentor,player,0.5);
assert.equal(trapezoidMentor.phase(),'build_boat','standing on land cannot complete the boat lesson');
aboard=true;
tickNpc(trapezoidMentor,player,1.3);
assert.equal(trapezoidMentor.phase(),'done','standing on a real floating raft completes Trapezoid training');

const snapshot=npcRegistry.snapshot();
npcRegistry.reset();
assert.equal(triangleMentor.phase(),'briefing','registry reset returns fixed mentors to their initial lessons');
assert.equal(npcRegistry.restore(snapshot),true,'fixed mentor progress restores through the shared NPC save plane');
assert.equal(triangleMentor.phase(),'done','Triangle completion survives reload');
assert.equal(tesseractMentor.phase(),'done','Tesseract completion survives reload');
assert.equal(trapezoidMentor.phase(),'done','Trapezoid completion survives reload');
assert.ok(inventoryUpdates>=3 && saveMarks>=6,'mentor rewards and progress notify inventory and save systems');

console.log('mentor-npcs-sim: all assertions passed');
