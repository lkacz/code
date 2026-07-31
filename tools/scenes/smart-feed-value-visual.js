const fail=message=>'FAIL :: '+message;
for(let i=0;i<100 && !(window.MM&&MM.smartFeed&&MM.inventoryUI);i++) await sleep(100);
if(!(window.MM&&MM.smartFeed&&MM.inventoryUI)) return fail('smart feed did not initialize');

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(180);
document.documentElement.dataset.inputMode='pc';
const craft=document.getElementById('craft');
if(craft&&craft.dataset.collapsed!=='true') document.getElementById('craftToggle')?.click();

const host=document.getElementById('smartFeed');
MM.smartFeed.clear();
if(MM.smartFeed.isExpanded()) MM.smartFeed.setExpanded(false);
MM.smartFeed.push({
  kind:'discovery',
  title:'NOWE ODKRYCIE',
  text:'To jest celowo długi komunikat sprawdzający, czy pełna treść pozostaje czytelna bez wielokropka i bez dodatkowego klikania.',
  xp:40,
  discoveryId:'blocks_can_be_mined',
  target:{x:player.x+8,y:player.y-2},
  holdFor:0,
  dedupeKey:'qa:value-feed-long-copy'
});
await sleep(120);

const card=host.querySelector('.smartFeedBubble');
const copy=card?.querySelector('.smartFeedText');
const xp=card?.querySelector('.smartFeedXp');
const actionButtons=[...(card?.querySelectorAll('.smartFeedAction')||[])];
const compactChecks={
  narrow:host.getBoundingClientRect().width<=191,
  fullText:!!copy&&copy.scrollHeight<=copy.clientHeight+1&&getComputedStyle(copy).webkitLineClamp==='none',
  xpOneLine:!!xp&&getComputedStyle(xp).whiteSpace==='nowrap'&&xp.getBoundingClientRect().height<22,
  iconOnly:actionButtons.length===2&&actionButtons.every(button=>button.textContent.length<=2),
  accessibleActions:actionButtons.some(button=>/Atlas/.test(button.getAttribute('aria-label')||''))&&
    actionButtons.some(button=>/miejsce/.test(button.getAttribute('aria-label')||''))
};

// Isolate the idle-clock check from the live simulation, which intentionally
// keeps producing discoveries and tasks while the hero moves in this scene.
MM.smartFeed.destroy();
const {createSmartFeed}=await import('./src/engine/smart_feed.js');
const qaFeed=createSmartFeed({host,minInterval:80,idleDelay:120,maxHistory:12});
qaFeed.push({kind:'world',text:'Cichy test koperty',holdFor:80,dedupeKey:'qa:idle-inbox'});
await sleep(350);
const idleState=qaFeed.state();
const idleChecks={
  idle:idleState.idle===true,
  inbox:!!host.querySelector('.smartFeedInbox'),
  noCard:!host.querySelector('.smartFeedBubble')
};
host.querySelector('.smartFeedInbox')?.click();
await sleep(80);
idleChecks.reopens=!!host.querySelector('.smartFeedBubble')&&!qaFeed.state().idle;

qaFeed.clear();
qaFeed.push({kind:'world',text:'Test fokusu myszy',holdFor:80,dedupeKey:'qa:pointer-focus'});
await sleep(30);
const pointerFocused=host.querySelector('.smartFeedToggle');
if(pointerFocused){
  pointerFocused.matches=selector=>selector===':focus-visible'?false:HTMLElement.prototype.matches.call(pointerFocused,selector);
  pointerFocused.focus();
}
await sleep(350);
idleChecks.pointerFocusDoesNotPin=qaFeed.state().idle===true;

host.querySelector('.smartFeedInbox')?.click();
qaFeed.clear();
qaFeed.push({kind:'world',text:'Test fokusu klawiatury',holdFor:80,dedupeKey:'qa:keyboard-focus'});
await sleep(30);
const keyboardFocused=host.querySelector('.smartFeedToggle');
if(keyboardFocused){
  keyboardFocused.matches=selector=>selector===':focus-visible'?true:HTMLElement.prototype.matches.call(keyboardFocused,selector);
  keyboardFocused.focus();
}
await sleep(350);
idleChecks.keyboardFocusDefers=qaFeed.state().idle===false;
keyboardFocused?.blur();

qaFeed.clear();
qaFeed.setExpanded(true);
qaFeed.push({
  kind:'inventory',
  title:'NAGRODA',
  context:'za odkrycie ukrytej komnaty',
  items:[
    {name:'Fragment niezwykle starego mechanizmu',delta:12,icon:'◆'},
    {name:'Błękitny kryształ wzmacniający',delta:-12,icon:'◇'},
    {name:'Pieczęć podziemnego obserwatorium',delta:1,icon:'✦'}
  ],
  dedupeKey:'qa:value-feed-readable-items'
});
await sleep(120);
const rows=[...host.querySelectorAll('.smartFeedItem')];
const list=host.querySelector('.smartFeedItems');
const historyChecks={
  oneColumn:!!list&&getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/).length===1,
  namedRows:rows.length===3&&rows.every(row=>row.querySelector('.smartFeedItemName')?.textContent.length>10),
  namesCanWrap:rows.every(row=>getComputedStyle(row.querySelector('.smartFeedItemName')).whiteSpace!=='nowrap'),
  signedAmounts:rows.map(row=>row.querySelector('.smartFeedItemAmount')?.textContent).join('|').includes('−12')
};

const checks={compact:compactChecks,idle:idleChecks,history:historyChecks};
const ok=Object.values(checks).every(group=>Object.values(group).every(Boolean));
return (ok?'ok':'FAIL')+' :: '+JSON.stringify({checks,width:Math.round(host.getBoundingClientRect().width),idleState});
