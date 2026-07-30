const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.smartFeed) return fail('smart feed did not finish booting');

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(180);
document.documentElement.dataset.inputMode='pc';

const craft=document.getElementById('craft');
if(!craft) return fail('craft panel is missing');
if(craft.dataset.collapsed==='true'){
  document.getElementById('craftToggle')?.click();
  await sleep(120);
}

MM.smartFeed.clear();
MM.smartFeed.setExpanded(true);
MM.smartFeed.push({
  kind:'discovery',
  title:'NOWE ODKRYCIE',
  text:'Próbna karta sprawdzająca granicę paneli.',
  tier:'Obserwacja',
  xp:20,
  accent:'#83d5ff',
  dedupeKey:'qa:craft-layout'
});
await sleep(180);

const feed=document.getElementById('smartFeed');
const craftRect=craft.getBoundingClientRect();
const feedRect=feed.getBoundingClientRect();
const style=getComputedStyle(feed);
const visible=style.visibility!=='hidden' && style.display!=='none' && feedRect.width>0 && feedRect.height>0;
const overlaps=visible
  && craftRect.left<feedRect.right && craftRect.right>feedRect.left
  && craftRect.top<feedRect.bottom && craftRect.bottom>feedRect.top;
const inside=!visible || (feedRect.left>=0 && feedRect.right<=innerWidth);
const expectedHidden=innerWidth<860;
const checks={
  correctSmallBehavior:expectedHidden ? !visible : visible,
  noOverlap:!overlaps,
  insideViewport:inside
};

return (Object.values(checks).every(Boolean)?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  visible,
  craft:{left:Math.round(craftRect.left),right:Math.round(craftRect.right)},
  feed:{left:Math.round(feedRect.left),right:Math.round(feedRect.right),width:Math.round(feedRect.width)},
  checks
});
