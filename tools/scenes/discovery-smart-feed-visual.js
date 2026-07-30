const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.smartFeed || !window.player)
  return fail('smart feed did not finish booting');

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(220);
const mobile=innerWidth<600 || innerHeight<560;
document.documentElement.dataset.inputMode=mobile?'touch':'pc';
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true'){
  document.getElementById('craftToggle')?.click();
  await sleep(100);
}

MM.smartFeed.clear();
MM.smartFeed.setExpanded(true);
MM.smartFeed.push({
  kind:'inventory',
  title:'ZDOBYTO',
  context:'6 pozycji',
  items:[
    {name:'Drewno',delta:12,icon:'◆',color:'#8b5a2b'},
    {name:'Kamień',delta:8,icon:'◆',color:'#9ca3af'},
    {name:'Woda',delta:4,icon:'💧',color:'#61b9e8'},
    {name:'Żelazo',delta:3,icon:'▰',color:'#aeb7c3'},
    {name:'Piasek',delta:7,icon:'◆',color:'#d7bd78'},
    {name:'Diament',delta:1,icon:'◆',color:'#43d8ff'}
  ]
});
await sleep(2050);
MM.smartFeed.world('Na wschodzie obudził się Strażnik Burzy.',{dedupeKey:'qa:guardian'});
await sleep(2050);

const target={x:player.x+3.5,y:player.y-0.35};
window.dispatchEvent(new CustomEvent('mm-discovery-earned',{
  cancelable:true,
  detail:{
    id:'qa_energy_sprint',
    label:'Energia napędza szybszy ruch',
    text:'Energia napędza turbo — biegniesz szybciej i skaczesz wyżej!',
    category:'⚡ Energia bohatera',
    tier:'observation',
    tierLabel:'Obserwacja',
    xp:20,
    color:'#83d5ff',
    icon:'!',
    target
  }
}));
for(let i=0;i<35 && !MM.smartFeed.state().history.some(row=>row.dedupeKey==='discovery:qa_energy_sprint');i++){
  await sleep(100);
}
await sleep(180);

const host=document.getElementById('smartFeed');
const cards=[...host.querySelectorAll('.smartFeedBubble')];
const inventoryCard=cards.find(card=>card.dataset.kind==='inventory');
const rect=host.getBoundingClientRect();
const messages=document.getElementById('messages');
const centerHasDiscoveryDuplicate=!!(messages && /Energia napędza turbo/i.test(messages.textContent));
const toggle=host.querySelector('.smartFeedToggle');
const intersects=(a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
const touchControls=['controls','dirRing','touchActionRail']
  .map(id=>document.getElementById(id))
  .filter(node=>node && getComputedStyle(node).display!=='none')
  .map(node=>node.getBoundingClientRect());
const checks={
  threeCards:cards.length>=3,
  discoveryVisible:cards.some(card=>card.dataset.kind==='discovery'),
  inventoryCondensed:inventoryCard?.querySelectorAll('.smartFeedItem').length===6,
  cardsNotClipped:cards.every(card=>card.scrollHeight<=card.clientHeight+1),
  leftSide:rect.left<innerWidth*0.5 && rect.right<innerWidth*0.8,
  noCentralDuplicate:!centerHasDiscoveryDuplicate,
  touchControlsClear:!mobile || !touchControls.some(control=>intersects(rect,control)),
  expandable:toggle?.getAttribute('aria-expanded')==='true',
  mobileWidth:!mobile || rect.width<=311
};
return (Object.values(checks).every(Boolean)?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  rect:{
    left:Math.round(rect.left),
    top:Math.round(rect.top),
    right:Math.round(rect.right),
    bottom:Math.round(rect.bottom),
    width:Math.round(rect.width),
    height:Math.round(rect.height)
  },
  kinds:cards.map(card=>card.dataset.kind),
  cardBoxes:cards.map(card=>({
    kind:card.dataset.kind,
    clientHeight:card.clientHeight,
    scrollHeight:card.scrollHeight
  })),
  checks
});
