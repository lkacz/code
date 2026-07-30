const fail=message=>'FAIL :: '+message;
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
const rect=host?.getBoundingClientRect();
const state=MM.smartFeed.state();
const checks={
  changed:changes.length===8,
  compact:state.history[0]?.items.length===8 && MM.inventoryFeedback.state().current===null,
  rows:rows.length===8,
  leftAnchored:rect && rect.left<=12 && rect.right<innerWidth-40,
  mobileWidth:!mobile || rect.width<=311,
  visible:rect && rect.width>200 && rect.height>90
};
const ok=Object.values(checks).every(Boolean);
return (ok?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  mode:document.documentElement.dataset.inputMode,
  rect:rect && {
    left:Math.round(rect.left),
    top:Math.round(rect.top),
    right:Math.round(rect.right),
    bottom:Math.round(rect.bottom),
    width:Math.round(rect.width),
    height:Math.round(rect.height)
  },
  checks
});
