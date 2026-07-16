// Live integration scene for docs/LIVE-PREVIEW.md.
// Builds a small real tree, starts the mentor's first tree observation and
// verifies that the world renderer actually draws the overhead timer.
for(let i=0;i<400 && !(window.MM && window.player && MM.ghostBridge && MM.tutorialNpc);i++) await sleep(50);
if(!(window.MM && window.player && MM.ghostBridge && MM.tutorialNpc)) return 'FAIL boot-timeout';

// Use the real shortcut so the screenshot shows the world rather than a QA-only
// DOM mutation of the crafting panel.
const craftPanel=document.getElementById('craft');
if(craftPanel && craftPanel.dataset.collapsed!=='true'){
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true}));
  document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'t',bubbles:true}));
  await sleep(120);
}

const bridge=MM.ghostBridge;
const mentor=MM.tutorialNpc;
const p=window.player;
const T=MM.T;
const treeX=Math.floor(p.x)+4;
const groundY=Math.floor(p.y+p.h*0.5+0.6);
const crownY=groundY-5;

// Clear a compact stage, then build a trunk with a leafy crown. The top trunk
// tile is solid, so this exercises the same physics/contact path as gameplay.
for(let y=crownY-3;y<groundY;y++){
  for(let x=treeX-3;x<=treeX+3;x++) bridge.setTile(x,y,T.AIR);
}
for(let y=crownY;y<groundY;y++) bridge.setTile(treeX,y,T.WOOD);
for(const [dx,dy] of [[-2,0],[-1,0],[1,0],[2,0],[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],[-1,-2],[0,-2],[1,-2]]){
  bridge.setTile(treeX+dx,crownY+dy,T.LEAF);
}

p.x=treeX+0.5;
p.y=crownY-p.h*0.5-0.001;
p.vx=0; p.vy=0; p.onGround=true;
mentor.restore({v:6,x:treeX-4.5,y:groundY-1,phase:'tree_watch_short',hp:28,rewards:{},treeShortRewarded:false,treeLongRewarded:false,observe:{phase:'tree_watch_short',t:0,best:0,ok:false,lineCd:0}});
bridge.revealAround();
bridge.snapCameraToPlayer();

const originalSignal=mentor.drawObservationSignal;
let signalFrames=0;
mentor.drawObservationSignal=function(...args){
  const shown=originalSignal.apply(this,args);
  if(shown) signalFrames++;
  return shown;
};

await sleep(650);
const activeBefore=!!mentor.summary().observe.active;
// Step away in mid-air: the timer and indicator must stop immediately.
p.x=treeX+3.5;
p.y=crownY-p.h*0.5-0.001;
p.vx=0; p.vy=0; p.onGround=false;
await sleep(350);
const inactiveAway=!mentor.summary().observe.active;
// Return for the final screenshot.
p.x=treeX+0.5;
p.y=crownY-p.h*0.5-0.001;
p.vx=0; p.vy=0; p.onGround=true;
bridge.snapCameraToPlayer();
await sleep(650);
const summary=mentor.summary();
const progress=summary && summary.observe ? Number(summary.observe.progress)||0 : 0;
const active=!!(summary && summary.observe && summary.observe.active);
const storyTask=MM.tasks && MM.tasks.activeList ? MM.tasks.activeList().find(task=>task && task.id==='story:mentor') : null;
const locationFree=!!(storyTask && !storyTask.target && storyTask.pointer===false);
window.__treeQuestTimerQA={active,activeBefore,inactiveAway,progress,signalFrames,phase:summary && summary.phase,locationFree,taskTitle:storyTask && storyTask.title,treeX,crownY};
if(!activeBefore || !inactiveAway) return 'FAIL timer-contact-gating :: '+JSON.stringify(window.__treeQuestTimerQA);
if(!active) return 'FAIL timer-inactive :: '+JSON.stringify(window.__treeQuestTimerQA);
if(!locationFree) return 'FAIL tree-task-has-map-target :: '+JSON.stringify(window.__treeQuestTimerQA);
if(progress<0.35) return 'FAIL timer-not-advancing :: '+JSON.stringify(window.__treeQuestTimerQA);
if(signalFrames<2) return 'FAIL indicator-not-rendered :: '+JSON.stringify(window.__treeQuestTimerQA);
return 'ok :: '+JSON.stringify(window.__treeQuestTimerQA);
