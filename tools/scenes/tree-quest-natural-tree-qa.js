// Finds and uses a real procedurally generated tree. No terrain is built by QA.
for(let i=0;i<400 && !(window.MM && window.player && MM.ghostBridge && MM.tutorialNpc);i++) await sleep(50);
if(!(window.MM && window.player && MM.ghostBridge && MM.tutorialNpc)) return 'FAIL boot-timeout';

const bridge=MM.ghostBridge;
const mentor=MM.tutorialNpc;
const p=window.player;
const T=MM.T;
const origin=Math.floor(p.x);
let perch=null;
for(let radius=0;radius<=1800 && !perch;radius++){
  for(const dir of (radius ? [-1,1] : [1])){
    const x=origin+radius*dir;
    const surface=MM.worldGen && MM.worldGen.surfaceHeight ? Math.round(MM.worldGen.surfaceHeight(x)) : 60;
    for(let y=Math.max(3,surface-20);y<=Math.min(110,surface+2);y++){
      if(bridge.getTile(x,y)!==T.WOOD || bridge.getTile(x,y+1)!==T.WOOD || bridge.getTile(x,y-1)===T.WOOD) continue;
      let foliage=0;
      for(let dy=-4;dy<=3;dy++) for(let dx=-4;dx<=4;dx++){
        const tile=bridge.getTile(x+dx,y+dy);
        if(tile===T.LEAF || tile===T.AUTUMN_LEAF_ORANGE || tile===T.AUTUMN_LEAF_RED) foliage++;
      }
      if(foliage>=4){ perch={x,y,foliage}; break; }
    }
    if(perch) break;
  }
}
if(!perch) return 'FAIL no-natural-tree-found';

p.x=perch.x+0.5;
p.y=perch.y-p.h*0.5-0.001;
p.vx=0; p.vy=0; p.onGround=true;
mentor.restore({v:6,x:perch.x-5.5,y:perch.y+5,phase:'tree_watch_short',hp:28,treeShortRewarded:false,treeLongRewarded:false,observe:{phase:'tree_watch_short',t:0,best:0,ok:false,lineCd:0}});
bridge.revealAround();
bridge.snapCameraToPlayer();

let shownFrames=0;
const originalSignal=mentor.drawObservationSignal;
mentor.drawObservationSignal=function(...args){
  const shown=originalSignal.apply(this,args);
  if(shown) shownFrames++;
  return shown;
};
await sleep(1400);
const summary=mentor.summary();
const verdict={perch,phase:summary.phase,active:!!summary.observe.active,progress:Number(summary.observe.progress)||0,shownFrames};
if(!verdict.active || verdict.progress<0.5 || shownFrames<2) return 'FAIL natural-tree-timer :: '+JSON.stringify(verdict);
return 'ok :: '+JSON.stringify(verdict);
