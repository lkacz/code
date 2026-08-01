import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.MM={};
globalThis.performance={now:()=>1000};
const panel={hidden:false,title:''};
const status={textContent:'',title:''};
const hypothesisStatus={hidden:true,textContent:''};
globalThis.document={getElementById(id){
  if(id==='taskPanel') return panel;
  if(id==='taskStatus') return status;
  if(id==='hypothesisStatus') return hypothesisStatus;
  return null;
}};

const {tasks}=await import('../src/engine/tasks.js');
const {engagement,recommendHypothesis}=await import('../src/engine/engagement.js');

const entries=[
  {id:'near',found:false,hint:'Sprawdź trzy mokre reakcje',stageRank:1,tierRank:1,stageLabel:'Pierwsze prawa',xp:40,evidence:{count:2,needed:3,distinct:0,distinctNeeded:0,requirementsMet:true}},
  {id:'later',found:false,hint:'Porównaj dwa różne paliwa',stageRank:2,tierRank:1,stageLabel:'Maszyny',xp:60,evidence:{count:0,needed:2,distinct:0,distinctNeeded:0,requirementsMet:true}},
  {id:'blocked',found:false,hint:'Sekret',stageRank:0,tierRank:0,xp:90,evidence:{count:4,needed:4,requirementsMet:false}}
];
assert.equal(recommendHypothesis(entries).id,'near','started, prerequisite-valid evidence outranks untouched or blocked discoveries');

let feedMode='';
const notices=[];
MM.smartFeed={setFocusMode(value){ feedMode=value; },notify(kind,text){ notices.push({kind,text}); }};
MM.discovery={
  entries(){ return entries.map(row=>Object.assign({},row,{evidence:Object.assign({},row.evidence)})); },
  has(id){ return !!entries.find(row=>row.id===id&&row.found); },
  progress(){ return {count:1,total:3}; }
};
let mentorPhase='watch_area';
MM.npcs={mentor:{summary(){ return {phase:mentorPhase}; }}};
const hearts={};
MM.progress={guardianHearts(){ return Object.assign({},hearts); },milestones(){ return [{done:true},{done:false}]; }};
MM.guardianLairs={status(){ return {entities:[],lairs:{ice:{ax:-10000,floorY:50},fire:{ax:10000,floorY:50}}}; }};
MM.undergroundBoss={status(){ return {entities:[],lair:{x:200,y:100}}; }};
MM.skyGuardian={status(){ return {entities:[],lair:{x:300,floorY:-80}}; }};
MM.centerGuardian={completed(){ return false; },status(){ return {phase:'dormant'}; }};

tasks.reset();
const player={x:0,y:30,vx:0,vy:0};
engagement.setContext({player,getTile(){ return 0; },setTile(){}});
engagement.update(0.8);
assert.equal(feedMode,'onboarding','the observation lab reduces the visible feed to goals and feedback');
let active=tasks.activeList();
const hypothesis=active.find(task=>task.source==='hypothesis');
assert.ok(hypothesis,'the director publishes exactly one contextual Atlas hypothesis');
assert.equal(hypothesis.id,'hypothesis:near','the hypothesis preserves a stable discovery identity');
assert.deepEqual(hypothesis.progress,{current:2,target:3,label:'ślady'},'the hypothesis exposes evidence progress');
assert.match(hypothesis.reward,/40 XP/,'the task states its meaningful knowledge reward');

entries[0].found=true;
engagement.update(0.8);
active=tasks.activeList();
assert.equal(active.filter(task=>task.source==='hypothesis').length,1,'completing a hypothesis rolls forward to one next experiment');
assert.equal(active.find(task=>task.source==='hypothesis').id,'hypothesis:later','the next valid evidence chain becomes the new experiment');
mentorPhase='water';
engagement.update(0.8);
assert.equal(feedMode,'normal','the complete feed returns after the opening lab');

MM.guardianLairs.status=()=>({entities:[{boss:true,kind:'fire',sealed:true,hp:75,maxHp:100}],lairs:{ice:{ax:-10000,floorY:50},fire:{ax:10000,floorY:50}}});
engagement.update(0.8);
const lesson=tasks.activeList().find(task=>task.source==='combat');
assert.ok(lesson,'an active guardian creates one high-priority learning goal');
assert.match(lesson.detail,/śnieg.*woda/i,'the learning goal explains the current shield counter');
assert.deepEqual(lesson.progress,{current:25,target:100,label:'obrażeń'},'boss feedback makes the fight state measurable');

hearts.mother=true;
MM.centerGuardian.completed=()=>true;
MM.guardianLairs.status=()=>({entities:[],lairs:{ice:{ax:-10000,floorY:50},fire:{ax:10000,floorY:50}}});
let rematchKind='';
MM.guardianLairs.forceAwaken=kind=>{ rematchKind=kind; return true; };
engagement.update(0.8);
active=tasks.activeList();
assert.ok(active.some(task=>task.id==='mastery:atlas'),'postgame exposes Atlas completion as a long-term mastery goal');
assert.ok(active.some(task=>task.id==='mastery:milestones'),'postgame exposes unfinished milestones without inventing daily chores');
assert.equal(active.filter(task=>task.id.startsWith('mastery:rematch:')).length,4,'all authored guardian echoes become optional rematches');
assert.ok(notices.some(row=>/Archiwum otwiera cele/.test(row.text)),'mastery unlock is announced once as a coherent system');

const west=active.find(task=>task.id==='mastery:rematch:west');
assert.equal(engagement.handleTaskAction(west.action.id,west),false,'a remote rematch click tracks the arena instead of spawning an off-screen boss');
player.x=west.target.x; player.y=west.target.y;
assert.equal(engagement.handleTaskAction(west.action.id,west),true,'the same action starts the echo when the hero reaches its arena');
assert.equal(rematchKind,'ice','the western echo reuses the authored ice-guardian rematch seam');

console.log('engagement-sim: all assertions passed');
