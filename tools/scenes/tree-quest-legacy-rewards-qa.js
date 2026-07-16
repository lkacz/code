// A save created before tree-task rewards existed must receive each owed reward
// exactly once after loading, without replaying the completed timers.
for(let i=0;i<400 && !(window.MM && window.player && window.inv && MM.ghostBridge && MM.tutorialNpc);i++) await sleep(50);
if(!(window.MM && window.player && window.inv && MM.ghostBridge && MM.tutorialNpc)) return 'FAIL boot-timeout';

const bridge=MM.ghostBridge;
const mentor=MM.tutorialNpc;
const p=window.player;
const masterBefore=Math.max(0,Number(window.inv.masterStone)||0);
const chestCount=()=>{
  const snap=bridge.snapshotDrops();
  return (snap && Array.isArray(snap.list) ? snap.list : [])
    .filter(drop=>drop && drop.kind==='chest' && drop.source==='mentor_tree_watch_short').length;
};
const chestsBefore=chestCount();

mentor.restore({v:4,x:p.x-2,y:p.y,phase:'water',hp:28,bowRewarded:false,streamRewarded:false,observe:null});
await sleep(450);
const afterFirst={chests:chestCount()-chestsBefore,stones:(Number(window.inv.masterStone)||0)-masterBefore};
await sleep(450);
const afterSecond={chests:chestCount()-chestsBefore,stones:(Number(window.inv.masterStone)||0)-masterBefore};
const verdict={phase:mentor.phase(),afterFirst,afterSecond};
if(afterFirst.chests!==1 || afterFirst.stones!==1) return 'FAIL legacy-reward-missing :: '+JSON.stringify(verdict);
if(afterSecond.chests!==1 || afterSecond.stones!==1) return 'FAIL legacy-reward-duplicated :: '+JSON.stringify(verdict);
return 'ok :: '+JSON.stringify(verdict);
