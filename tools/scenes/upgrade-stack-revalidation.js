const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.inventory || typeof MM.onLootGained!=='function') return fail('loot APIs did not finish booting');

const host=document.getElementById('upgradeNotice');
if(!host) return fail('upgrade notice host is missing');
while(host.querySelector('.upgradeNotice')) host.querySelector('.upLater')?.click();

const items=[
  {id:'qa_stack_eyes_medium',kind:'eyes',name:'Oczy średnie QA',tier:'epic',visionRadius:60},
  {id:'qa_stack_eyes_strong',kind:'eyes',name:'Oczy najmocniejsze QA',tier:'legendary',visionRadius:90}
];
for(const item of items){
  if(!MM.inventory.grantItem(item,{markNew:true})) return fail('could not grant '+item.id);
}
if(MM.onLootGained(items.map(item=>MM.inventory.getItem(item.id)))!==2) return fail('fresh upgrades were not announced');
if(host.querySelectorAll('.upgradeNotice').length!==1) return fail('more than one upgrade card is visible');

const strong=host.querySelector('[data-item-id="qa_stack_eyes_strong"]');
if(!strong) return fail('the strongest upgrade was not promoted first');
if(strong.dataset.queueRemaining!=='1') return fail('the waiting upgrade is not represented by the queue counter');
strong.querySelector('.upEquip').click();

const remaining=host.querySelector('[data-item-id="qa_stack_eyes_medium"]');
if(!remaining || host.querySelectorAll('.upgradeNotice').length!==1) return fail('equipping the active card did not promote the waiting card');
if(!remaining.classList.contains('noLongerUpgrade')) return fail('remaining card was not re-evaluated against newly equipped gear');
if(!remaining.querySelector('.upDelta').textContent.includes('▼')) return fail('remaining card still advertises a stale positive delta');
if(remaining.querySelector('.upEquip').disabled) return fail('player cannot deliberately equip the remaining item');

return 'ok :: visible=1; queued=1; equipped=strong; promoted=medium; pendingDelta='+remaining.querySelector('.upDelta').textContent;
