for(let i=0;i<300 && !(window.MM&&MM.smartFeed);i++) await sleep(50);
if(!(window.MM&&MM.smartFeed)) return 'FAIL :: smart feed did not initialize';

const host=document.getElementById('smartFeed');
if(!host) return 'FAIL :: #smartFeed is missing';
const craft=document.getElementById('craft');
if(craft) craft.dataset.collapsed='true';

MM.smartFeed.destroy();
const {createSmartFeed}=await import('./src/engine/smart_feed.js');
const feed=createSmartFeed({host,minInterval:0,maxHistory:12});
MM.smartFeed=feed;
feed.push({kind:'inventory',title:'ZDOBYTO',text:'Drewno i kamień trafiły do ekwipunku.'});
feed.push({kind:'world',title:'ŚWIAT',text:'Nadciąga burza nad zachodnim lasem.'});
feed.push({kind:'discovery',title:'ODKRYCIE',text:'Woda zamienia się w parę przy lawie.'});

const width=host.getBoundingClientRect().width;
if(width<170||width>191) return 'FAIL :: unexpected compact width '+width;
const cards=()=>[...host.querySelectorAll('.smartFeedBubble')];
if(cards().length!==1) return 'FAIL :: compact feed should show exactly one card';
if(host.querySelectorAll('.smartFeedFilter option').length!==12) return 'FAIL :: category options are incomplete';

const older=host.querySelector('.smartFeedOlder');
if(!older||older.disabled) return 'FAIL :: older-history arrow is unavailable';
older.click();
if(!cards()[0]||cards()[0].dataset.kind!=='world') return 'FAIL :: back arrow did not show the previous notice';

const filter=host.querySelector('.smartFeedFilter');
filter.value='inventory';
filter.dispatchEvent(new Event('change',{bubbles:true}));
if(!cards()[0]||cards()[0].dataset.kind!=='inventory') return 'FAIL :: category filter did not isolate inventory notices';

filter.value='all';
filter.dispatchEvent(new Event('change',{bubbles:true}));
host.querySelector('.smartFeedOlder').click();

const bubbleStyle=getComputedStyle(cards()[0]);
return 'ok :: width='+width+' history='+feed.state().history.length+' selected='+cards()[0].dataset.kind+' background='+bubbleStyle.backgroundImage;
