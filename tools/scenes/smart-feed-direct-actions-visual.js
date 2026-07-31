const fail=message=>'FAIL :: '+message;
for(let i=0;i<80 && !(window.player && window.MM && MM.smartFeed && MM.inventory && MM.inventoryFeedback && MM.discovery && MM.tasks);i++){
  await sleep(100);
}
if(!(window.player && window.MM && MM.smartFeed && MM.inventory && MM.inventoryFeedback && MM.discovery && MM.tasks)){
  return fail('direct-action APIs did not finish booting');
}

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(180);
const mobile=innerWidth<600 || innerHeight<560;
document.documentElement.dataset.inputMode=mobile?'touch':'pc';
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true') document.getElementById('craftToggle')?.click();

const actionByText=(card,text)=>[...(card?.querySelectorAll('.smartFeedAction')||[])]
  .find(button=>(button.dataset.actionLabel||button.getAttribute('aria-label')||'').includes(text));
const hitTest=el=>{
  if(!el) return false;
  const rect=el.getBoundingClientRect();
  const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  return !!hit && (hit===el || el.contains(hit));
};

// Urgent notices stay visual in both lanes but have one accessibility owner:
// the immediate HUD status, not the paced archival-feed announcer as well.
MM.smartFeed.clear();
MM.smartFeed.notify('warning','Alarm testowy QA',{
  urgent:true,
  dedupeKey:'qa:urgent-single-live-owner'
});
await sleep(80);
const immediateStatus=document.getElementById('messages');
const feedAnnouncer=document.querySelector('#smartFeed .srOnly');
const accessibilityChecks={
  immediateAnnounced:/Alarm testowy QA/.test(immediateStatus?.textContent||''),
  feedDidNotRepeat:!/Alarm testowy QA/.test(feedAnnouncer?.textContent||'')
};
if(immediateStatus) immediateStatus.textContent='';

// 1) A gear gain is re-resolved through MM.inventory and can be equipped from
// the compact feed without opening the hidden equipment overlay.
MM.smartFeed.clear();
MM.smartFeed.setExpanded(false);
MM.inventoryFeedback.reset();
const gearId='qa_feed_charm_'+Date.now().toString(36);
const granted=MM.inventory.grantItem({
  id:gearId,
  kind:'charm',
  name:'Kompas dymków',
  tier:'rare',
  desc:'Próba bezpośredniego wyposażania z Dziennika.',
  mineSpeedMult:1.08
},{equip:false,markNew:true});
if(!granted) return fail('QA gear could not enter the inventory');
MM.inventoryFeedback.sync({inventoryFeedbackContext:{kind:'qa_feed_gear'}});
await sleep(120);
let card=document.querySelector('#smartFeed .smartFeedBubble[data-kind="inventory"]');
let gearRow=card?.querySelector('.smartFeedItem[data-feed-actionable="equip"]');
let gearHandle=gearRow?.querySelector('.smartFeedItemEquip');
const gearBefore={
  row:!!gearRow,
  handle:!!gearHandle,
  target:gearHandle&&Math.round(gearHandle.getBoundingClientRect().width),
  compact:gearRow?.dataset.compactAction==='true',
  thumbnail:!!gearHandle?.querySelector('canvas'),
  hitTarget:hitTest(gearHandle)
};
gearHandle?.focus();
gearHandle?.click();
await sleep(100);
const gearChecks={
  ...gearBefore,
  equipped:MM.inventory.isEquipped(gearId),
  liveState:/w użyciu/.test(gearRow?.querySelector('.smartFeedItemLive')?.textContent||''),
  focusPreserved:document.activeElement?.classList?.contains('smartFeedItemEquip')===true
};

// 2) A real earned discovery exposes both actions. The snapshot waypoint uses
// one stable task id; Atlas opens and focuses the exact validated entry.
MM.discovery.reset();
MM.smartFeed.clear();
MM.tasks.remove('smart_feed:waypoint');
const discoveryTarget={x:player.x+11.5,y:player.y-3};
MM.discovery.note('blocks_can_be_mined',{target:discoveryTarget});
await sleep(140);
card=document.querySelector('#smartFeed .smartFeedBubble[data-kind="discovery"]');
const trackPlace=actionByText(card,'Śledź miejsce');
const openAtlas=actionByText(card,'Atlasie');
const discoveryActionHits=hitTest(trackPlace)&&hitTest(openAtlas);
trackPlace?.focus();
trackPlace?.click();
await sleep(80);
const trackedDiscovery=MM.tasks.trackedTarget(player);
const discoveryTrackChecks={
  card:!!card,
  twoActions:card?.querySelectorAll('.smartFeedAction').length===2,
  hitTargets:discoveryActionHits,
  focusPreserved:/Śledź miejsce/.test(document.activeElement?.dataset?.actionLabel||''),
  iconOnly:[trackPlace,openAtlas].every(button=>button && button.textContent.length<=2),
  waypoint:MM.tasks.metrics().priorityId==='smart_feed:waypoint',
  waypointX:Math.abs((trackedDiscovery?.x||0)-discoveryTarget.x)<0.001,
  waypointY:Math.abs((trackedDiscovery?.y||0)-discoveryTarget.y)<0.001
};
card=document.querySelector('#smartFeed .smartFeedBubble[data-kind="discovery"]');
actionByText(card,'Atlasie')?.click();
for(let i=0;i<20 && document.activeElement?.dataset?.discoveryId!=='blocks_can_be_mined';i++){
  await sleep(50);
}
const focusedDiscovery=document.activeElement;
let atlasTargetCard=[...document.querySelectorAll('.invDiscCard')]
  .find(node=>node.dataset.discoveryId==='blocks_can_be_mined');
window.dispatchEvent(new CustomEvent('mm-inventory-change'));
await sleep(100);
atlasTargetCard=[...document.querySelectorAll('.invDiscCard')]
  .find(node=>node.dataset.discoveryId==='blocks_can_be_mined');
const cardFocusSurvivesRebuild=document.activeElement?.dataset?.discoveryId==='blocks_can_be_mined';
const atlasNav=document.querySelector('.invDiscNavBtn.active');
const atlasNavKey=atlasNav?.dataset?.discoveryCategory||'';
atlasNav?.focus();
window.dispatchEvent(new CustomEvent('mm-inventory-change',{detail:{key:'qa-focus-rebuild'}}));
await sleep(100);
const rebuiltAtlasNav=document.activeElement;
rebuiltAtlasNav?.click();
const navFocusSurvivesDirectChange=document.activeElement?.dataset?.discoveryCategory===atlasNavKey;
const discoveryTabButton=document.querySelector('.invTabBtn[data-key="discovery"]');
const atlasChecks={
  overlay:MM.inventoryUI?.isOpen?.()===true,
  discoveryTab:discoveryTabButton?.classList.contains('sel')===true,
  focused:focusedDiscovery?.dataset?.discoveryId==='blocks_can_be_mined',
  focusSurvivesRebuild:cardFocusSurvivesRebuild,
  targetRendered:!!atlasTargetCard,
  navFocusSurvivesRebuild:!!atlasNavKey&&document.activeElement?.dataset?.discoveryCategory===atlasNavKey,
  navFocusSurvivesDirectChange,
  tabRole:discoveryTabButton?.getAttribute('role')==='tab',
  tabSelected:discoveryTabButton?.getAttribute('aria-selected')==='true',
  tabControls:discoveryTabButton?.getAttribute('aria-controls')==='invGrid',
  panelLabelled:document.getElementById('invGrid')?.getAttribute('aria-labelledby')===discoveryTabButton?.id
};
MM.inventoryUI?.close?.();
await sleep(60);
atlasChecks.closeFocusFallback=document.activeElement?.isConnected===true &&
  (document.activeElement?.classList?.contains('smartFeedAction')===true ||
    document.activeElement?.classList?.contains('smartFeedToggle')===true);

// 3) A real task notice selects the canonical active task. Once removed, the
// old action cannot resurrect it or overwrite another target.
MM.smartFeed.clear();
const taskId='qa:feed-action';
MM.tasks.upsert({
  id:taskId,
  source:'qa',
  kind:'story',
  title:'Sprawdź sygnał próbny',
  detail:'Feed powinien przypiąć ten cel.',
  priority:70,
  pointer:true,
  target:{x:player.x-9,y:player.y+2,label:'Sygnał próbny'}
});
await sleep(120);
card=document.querySelector('#smartFeed .smartFeedBubble[data-kind="task"]');
let taskAction=actionByText(card,'Śledź zadanie');
const taskHitTarget=hitTest(taskAction);
taskAction?.focus();
taskAction?.click();
await sleep(70);
const selectedTask=MM.tasks.metrics().priorityId===taskId;
const taskFocusPreserved=/Śledź zadanie/.test(document.activeElement?.dataset?.actionLabel||'');
card=document.querySelector('#smartFeed .smartFeedBubble[data-kind="task"]');
taskAction=actionByText(card,'Śledź zadanie');
MM.tasks.remove(taskId);
taskAction?.focus();
taskAction?.click();
await sleep(70);
const taskChecks={
  card:!!card,
  action:!!taskAction,
  hitTarget:taskHitTarget,
  focusPreserved:taskFocusPreserved,
  selected:selectedTask,
  staleRejected:MM.tasks.metrics().priorityId!==taskId &&
    !MM.tasks.activeList().some(task=>task.id===taskId),
  staleFocusFallback:document.activeElement?.classList?.contains('smartFeedToggle')===true
};

const checks={
  accessibility:accessibilityChecks,
  gear:gearChecks,
  discovery:discoveryTrackChecks,
  atlas:atlasChecks,
  task:taskChecks
};
const allPassed=Object.values(checks).every(group=>Object.values(group).every(Boolean));
return (allPassed?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  mode:document.documentElement.dataset.inputMode,
  gearTarget:gearBefore.target,
  trackedDiscovery:trackedDiscovery&&{id:trackedDiscovery.task?.id,x:trackedDiscovery.x,y:trackedDiscovery.y},
  focusedDiscovery:focusedDiscovery?.dataset?.discoveryId||'',
  atlasDebug:{
    activeTag:focusedDiscovery?.tagName||'',
    activeId:focusedDiscovery?.id||'',
    targetRendered:!!atlasTargetCard,
    targetTabIndex:atlasTargetCard?.tabIndex,
    targetConnected:atlasTargetCard?.isConnected
  },
  checks
});
