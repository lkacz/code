// Browser integration check for both timed tree rewards. The timers start just
// before their thresholds so the QA remains fast even under software rendering.
for(let i=0;i<400 && !(window.MM && window.player && window.inv && MM.ghostBridge && MM.tutorialNpc && MM.drops);i++) await sleep(50);
if(!(window.MM && window.player && window.inv && MM.ghostBridge && MM.tutorialNpc && MM.drops)) return 'FAIL boot-timeout';

const bridge=MM.ghostBridge;
const mentor=MM.tutorialNpc;
const p=window.player;
const T=MM.T;
const treeX=Math.floor(p.x)+4;
const groundY=Math.floor(p.y+p.h*0.5+0.6);
const topY=groundY-4;
for(let y=topY-2;y<groundY;y++) for(let x=treeX-2;x<=treeX+2;x++) bridge.setTile(x,y,T.AIR);
function standOnTree(){
  // Rebuild before each independent threshold probe: the live tree-stability
  // system is allowed to process QA-placed unregistered wood between probes.
  for(let y=topY;y<groundY;y++) bridge.setTile(treeX,y,T.WOOD);
  p.x=treeX+0.5;
  p.y=topY-p.h*0.5-0.001;
  p.vx=0; p.vy=0; p.onGround=true;
  bridge.revealAround();
}

const originalSpawnChest=MM.drops.spawnChest;
let chestRewards=0;
MM.drops.spawnChest=function(...args){
  if(args[3] && args[3].source==='mentor_tree_watch_short') chestRewards++;
  return originalSpawnChest.apply(this,args);
};

standOnTree();
mentor.restore({v:6,x:treeX-4.5,y:groundY-1,phase:'tree_watch_short',hp:28,treeShortRewarded:false,treeLongRewarded:false,observe:{phase:'tree_watch_short',t:9.92,best:9.92,ok:true,lineCd:0}});
for(let i=0;i<3;i++) mentor.update(0.1,p,bridge.getTile,bridge.setTile);
await sleep(220);
const shortPhase=mentor.phase();
const shortChestCount=chestRewards;
const shortSummary=mentor.summary();

const masterBefore=Math.max(0,Number(window.inv.masterStone)||0);
standOnTree();
mentor.restore({v:6,x:treeX-4.5,y:groundY-1,phase:'tree_watch_long',hp:28,treeShortRewarded:true,treeLongRewarded:false,observe:{phase:'tree_watch_long',t:29.92,best:29.92,ok:true,lineCd:0}});
for(let i=0;i<3;i++) mentor.update(0.1,p,bridge.getTile,bridge.setTile);
await sleep(220);
const longPhase=mentor.phase();
const masterGain=(Math.max(0,Number(window.inv.masterStone)||0)-masterBefore);
const longSummary=mentor.summary();
const dropSnapshot=bridge.snapshotDrops();
const questChests=(dropSnapshot && Array.isArray(dropSnapshot.list) ? dropSnapshot.list : [])
  .filter(drop=>drop && drop.kind==='chest' && drop.source==='mentor_tree_watch_short');
MM.drops.spawnChest=originalSpawnChest;

const chestDistance=questChests[0] ? Math.abs(questChests[0].x-(treeX+0.5)) : null;
const verdict={shortPhase,shortChestCount,longPhase,masterGain,treeX,chestDistance,shortSummary,longSummary,questChests};
if(shortPhase!=='tree_watch_long' || shortChestCount!==1) return 'FAIL short-reward :: '+JSON.stringify(verdict);
if(longPhase!=='sand_hide' || masterGain!==1) return 'FAIL long-reward :: '+JSON.stringify(verdict);
if(questChests.length!==1) return 'FAIL chest-not-persistent :: '+JSON.stringify(verdict);
if(chestDistance>2) return 'FAIL chest-landed-too-far :: '+JSON.stringify(verdict);
return 'ok :: '+JSON.stringify(verdict);
