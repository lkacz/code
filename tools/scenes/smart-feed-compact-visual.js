const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.smartFeed) return fail('smart feed did not finish booting');

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(180);
const touch=innerWidth<600 || innerHeight<560;
document.documentElement.dataset.inputMode=touch?'touch':'pc';
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true'){
  document.getElementById('craftToggle')?.click();
  await sleep(80);
}

MM.smartFeed.clear();
const startsCompact=!MM.smartFeed.isExpanded();
MM.smartFeed.setExpanded(false);
MM.smartFeed.push({
  kind:'inventory',
  title:'ZDOBYTO',
  context:'6 pozycji',
  items:[
    {name:'Drewno',delta:12,icon:'◆'},
    {name:'Kamień',delta:8,icon:'◆'},
    {name:'Woda',delta:4,icon:'💧'},
    {name:'Żelazo',delta:3,icon:'▰'},
    {name:'Piasek',delta:7,icon:'◆'},
    {name:'Diament',delta:1,icon:'◆'}
  ]
});
await sleep(160);

const host=document.getElementById('smartFeed');
const stack=host.querySelector('.smartFeedStack');
const card=host.querySelector('.smartFeedBubble');
const items=host.querySelector('.smartFeedItems');
const rect=host.getBoundingClientRect();
const checks={
  startsCompact,
  oneCard:host.querySelectorAll('.smartFeedBubble').length===1,
  cardNotClipped:!!card && card.scrollHeight<=card.clientHeight+1,
  detailsCondensed:!!items && getComputedStyle(items).display==='none',
  worldClicksPass:!!card && getComputedStyle(card).pointerEvents==='none',
  compactHeight:rect.height<=150,
  toggleCollapsed:host.querySelector('.smartFeedToggle')?.getAttribute('aria-expanded')==='false'
};

return (Object.values(checks).every(Boolean)?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  rect:{left:Math.round(rect.left),top:Math.round(rect.top),width:Math.round(rect.width),height:Math.round(rect.height)},
  stackHeight:stack&&stack.clientHeight,
  cardHeight:card&&card.clientHeight,
  checks
});
