const fail=message=>'FAIL :: '+message;
for(let i=0;i<80 && !(window.MM && MM.inventoryFeedback && MM.smartFeed && window.inv);i++){
  await sleep(100);
}
if(!window.MM || !MM.inventoryFeedback || !MM.smartFeed || !window.inv)
  return fail('shared feedback APIs did not finish booting');

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(180);
const mobile=innerWidth<600;
document.documentElement.dataset.inputMode=mobile?'touch':'pc';
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true'){
  document.getElementById('craftToggle')?.click();
  await sleep(100);
}

const keys=Object.keys(inv)
  .filter(key=>typeof inv[key]==='number' && key!=='bedrockPickDurability')
  .slice(0,8);
if(keys.length<8) return fail('not enough resource counters for the batch scene');
for(const key of keys) inv[key]=50;
MM.inventoryFeedback.reset();
MM.smartFeed.clear();
MM.smartFeed.setExpanded(true);
keys.forEach((key,index)=>{
  inv[key]+=index<4 ? (index+1)*3 : -(index-2)*2;
});
const changes=MM.inventoryFeedback.sync({inventoryFeedbackContext:{kind:'qa_batch'}});
await sleep(120);

const host=document.getElementById('smartFeed');
const card=host?.querySelector('.smartFeedBubble[data-kind="inventory"]');
const rows=card?.querySelectorAll('.smartFeedItem') || [];
const gainRows=[...rows].filter(row=>row.dataset.direction==='gain');
const lossRows=[...rows].filter(row=>row.dataset.direction==='loss');
const rect=host?.getBoundingClientRect();
const actionRailRect=document.getElementById('touchActionRail')?.getBoundingClientRect();
const immediateRect=document.getElementById('messages')?.getBoundingClientRect();
const itemGrid=card?.querySelector('.smartFeedItems');
const gridColumns=itemGrid
  ? getComputedStyle(itemGrid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
  : 0;
const state=MM.smartFeed.state();
const checks={
  changed:changes.length===8,
  compact:state.history[0]?.items.length===8 && MM.inventoryFeedback.state().current===null,
  rows:rows.length===8,
  gainHandles:gainRows.length===4 && gainRows.every(row=>!!row.querySelector('.smartFeedItemHotbar')),
  lossesInert:lossRows.length===4 && lossRows.every(row=>!row.querySelector('.smartFeedItemHotbar')),
  leftAnchored:rect && rect.left<=12 && rect.right<innerWidth-40,
  mobileWidth:!mobile || rect.width<=311,
  mobileSingleColumn:!mobile || gridColumns===1,
  clearsTouchActions:!mobile || !actionRailRect || rect.bottom<=actionRailRect.top-8,
  immediateLaneClear:!mobile || !immediateRect || immediateRect.width===0 ||
    (immediateRect.left<=12 && immediateRect.bottom<=rect.top-8),
  visible:rect && rect.width>200 && rect.height>90
};
const ok=Object.values(checks).every(Boolean);
return (ok?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  mode:document.documentElement.dataset.inputMode,
  gridColumns,
  rect:rect && {
    left:Math.round(rect.left),
    top:Math.round(rect.top),
    right:Math.round(rect.right),
    bottom:Math.round(rect.bottom),
    width:Math.round(rect.width),
    height:Math.round(rect.height)
  },
  actionRailTop:actionRailRect&&Math.round(actionRailRect.top),
  immediateRect:immediateRect&&{
    left:Math.round(immediateRect.left),
    top:Math.round(immediateRect.top),
    right:Math.round(immediateRect.right),
    bottom:Math.round(immediateRect.bottom)
  },
  checks
});
