import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SMART_FEED_DISCOVERY_HOLD_MS,
  SMART_FEED_IDLE_DELAY_MS,
  SMART_FEED_MAX_HOLD_MS,
  SMART_FEED_MIN_INTERVAL_MS,
  classifySmartFeedMessage,
  createSmartFeed,
  createSmartFeedQueue
} from '../src/engine/smart_feed.js';

const queue=createSmartFeedQueue({minInterval:2000,maxHistory:3,maxPending:6});
queue.push({kind:'inventory',text:'Drewno +3'},0);
assert.equal(queue.promote(0).text,'Drewno +3','the first card appears immediately');
queue.push({kind:'inventory',text:'Kamień +2'},100);
assert.equal(queue.promote(1999),null,'a second card cannot appear before the pacing window');
assert.equal(queue.delay(1999),1);
assert.equal(queue.promote(2000).text,'Kamień +2','the next card appears at exactly two seconds');

queue.push({kind:'inventory',text:'Piasek +1',priority:40},2100);
queue.push({kind:'discovery',text:'Woda zamienia się w parę',priority:100},2200);
assert.equal(queue.promote(4000).kind,'discovery','an important discovery becomes the next card without bypassing pacing');
assert.equal(queue.promote(5999),null);
assert.equal(queue.promote(10199),null,'a discovery keeps the compact feed spotlight for its extended visual cue');
assert.equal(queue.promote(10200).text,'Piasek +1');

queue.push({kind:'world',text:'Nadciąga burza',dedupeKey:'weather:storm',target:{x:10,y:20}},12200);
const storm=queue.promote(12200);
assert.equal(storm.count,1);
const merged=queue.push({kind:'world',text:'Nadciąga burza',dedupeKey:'weather:storm',target:{x:30,y:40}},12700);
assert.equal(merged.location,'history','a recent repeated event updates its visible history card');
let currentStorm=queue.state().history.find(notice=>notice.dedupeKey==='weather:storm');
assert.equal(currentStorm.count,2,'duplicates receive a count badge instead of another queued card');
assert.deepEqual(currentStorm.target,{x:30,y:40},'merged events keep the newest snapshot location');
queue.push({kind:'world',text:'Nadciąga burza',dedupeKey:'weather:storm'},12800);
currentStorm=queue.state().history.find(notice=>notice.dedupeKey==='weather:storm');
assert.equal(currentStorm.target,null,'a newer duplicate without a target clears the stale waypoint capability');

queue.push({kind:'info',text:'A'},14200);
queue.promote(14200);
queue.push({kind:'info',text:'B'},16200);
queue.promote(16200);
assert.equal(queue.state().history.length,3,'session history stays bounded');
assert.equal(queue.state().history[0].text,'B','newest history stays at the top');

const defaultPacing=createSmartFeedQueue();
defaultPacing.push({kind:'info',text:'Pierwszy'},0);
defaultPacing.promote(0);
defaultPacing.push({kind:'info',text:'Drugi'},1);
assert.equal(defaultPacing.promote(3999),null,'default notices remain visible for two seconds longer than before');
assert.equal(defaultPacing.delay(3999),1);
assert.equal(defaultPacing.promote(4000).text,'Drugi','the default queue advances after four seconds');

const bounded=createSmartFeedQueue({minInterval:2000,maxPending:3,maxHistory:2});
for(let i=0;i<8;i++) bounded.push({kind:'info',text:'N'+i,priority:i},0);
assert.equal(bounded.state().pending.length,3,'hostile bursts cannot grow the pending queue without bound');
assert.deepEqual(
  bounded.state().pending.map(n=>n.priority).sort((a,b)=>b-a),
  [7,6,5],
  'when capped, higher-value pending notices survive'
);
const staged=createSmartFeedQueue({minInterval:0});
staged.push({kind:'discovery',stage:'observation',presentation:'collection',text:'Nowy biom',holdFor:2100,xp:5,dedupeKey:'atlas'},0);
const stagedNotice=staged.promote(0);
assert.equal(stagedNotice.stage,'observation','knowledge stage survives feed normalization');
assert.equal(stagedNotice.presentation,'collection','collection stamps retain their quieter presentation mode');
assert.equal(stagedNotice.holdFor,2100,'a basic atlas stamp can use a shorter spotlight than a breakthrough');
staged.push({kind:'discovery',stage:'observation',presentation:'collection',text:'Nowy katalog',xp:5,dedupeKey:'atlas'},100);
const stagedMerged=staged.state().history[0];
assert.equal(stagedMerged.count,2,'a burst of collection stamps compacts into one feed card');
assert.equal(stagedMerged.xp,10,'compacted collection cards retain the full awarded XP');

const resourceIdentity=createSmartFeedQueue({minInterval:0});
resourceIdentity.push({
  kind:'inventory',
  title:'ZDOBYTO',
  taskId:'t'.repeat(120),
  discoveryId:'d'.repeat(140),
  undoToken:'u'.repeat(140),
  actions:[{callback:'UNTRUSTED'}],
  callback:()=>{},
  items:[
    {
      name:'Drewno',
      delta:2,
      resourceKey:'wood',
      gearId:'gear-wood',
      tile:'UNTRUSTED_TILE',
      item:{id:'UNTRUSTED_ITEM'},
      kind:'UNTRUSTED_KIND'
    },
    {name:'Kamień',delta:-3,resourceKey:'stone',gearId:'g'.repeat(100)},
    {name:'Nieznany',delta:1,resourceKey:'x'.repeat(180)}
  ]
},0);
const resourceNotice=resourceIdentity.promote(0);
assert.equal(resourceNotice.items[0].resourceKey,'wood','resource identity survives feed normalization');
assert.equal(resourceNotice.items[1].resourceKey,'stone','loss identity remains available for inert rendering');
assert.equal(resourceNotice.items[2].resourceKey.length,96,'public feed resource identities are length-bounded');
assert.equal(resourceNotice.items[0].gearId,'gear-wood','opaque gear identity survives feed normalization');
assert.equal(resourceNotice.items[1].gearId.length,64,'public feed gear identities are length-bounded');
assert.equal('tile' in resourceNotice.items[0],false,'the generic feed never forwards an untrusted tile identity');
assert.equal('item' in resourceNotice.items[0],false,'the generic feed never forwards a raw inventory item');
assert.equal('kind' in resourceNotice.items[0],false,'the generic feed never forwards a producer-selected item kind');
assert.equal(resourceNotice.taskId.length,80,'task identities are length-bounded');
assert.equal(resourceNotice.discoveryId.length,96,'discovery identities are length-bounded');
assert.equal(resourceNotice.undoToken.length,96,'undo capabilities are length-bounded');
assert.equal('actions' in resourceNotice,false,'producer-supplied actions never cross the feed boundary');
assert.equal('callback' in resourceNotice,false,'producer callbacks never cross the feed boundary');
resourceNotice.text='ZEPSUTE';
resourceNotice.target={x:999,y:999};
resourceNotice.items.push({name:'Wstrzyknięte',delta:1,resourceKey:'wood'});
const protectedResourceNotice=resourceIdentity.state().history[0];
assert.notEqual(protectedResourceNotice.text,'ZEPSUTE','promote returns a detached notice snapshot');
assert.equal(protectedResourceNotice.target,null,'mutating a promoted target cannot alter queue capabilities');
assert.equal(protectedResourceNotice.items.length,3,'mutating promoted items cannot bypass the normalized item budget');

const leakedState=resourceIdentity.state();
leakedState.history[0].items[0].resourceKey='stone';
leakedState.history[0].items.length=100;
assert.equal(resourceIdentity.state().history[0].items[0].resourceKey,'wood','state returns detached item descriptors');
assert.equal(resourceIdentity.state().history[0].items.length,3,'state cannot be used to grow the internal render workload');

const staleItems=createSmartFeedQueue({minInterval:0});
staleItems.push({
  kind:'inventory',
  text:'Drewno +1',
  dedupeKey:'inventory:wood',
  items:[{name:'Drewno',delta:1,resourceKey:'wood'}]
},0);
staleItems.promote(0);
staleItems.push({kind:'inventory',text:'Pakiet rozliczony',dedupeKey:'inventory:wood'},1);
assert.equal(staleItems.state().history[0].items.length,0,'newest duplicate clears stale item actions when it has no items');
assert.equal(staleItems.state().history[0].omittedItems,0,'newest duplicate also clears the old omitted-item count');

const invalidNotice=createSmartFeedQueue({minInterval:0});
assert.equal(invalidNotice.push({}).accepted,false,'an empty payload cannot create a title-only feed card');
let hostileConversion=0;
assert.equal(invalidNotice.push({
  get text(){ throw new Error('hostile getter'); },
  title:{toString(){ hostileConversion++; return 'Nie wywołuj'; }}
}).accepted,false,'a hostile optional producer is rejected instead of breaking the queue');
assert.equal(hostileConversion,0,'object labels never execute producer-controlled string conversion');
const cappedCounters=invalidNotice.push({
  kind:'inventory',
  text:'Pakiet',
  count:Number.MAX_VALUE,
  xp:Number.MAX_VALUE,
  omittedItems:Number.MAX_VALUE
},0).notice;
assert.equal(cappedCounters.count,1_000_000_000,'notice counters are bounded');
assert.equal(cappedCounters.xp,1_000_000_000,'notice XP is bounded');
assert.equal(cappedCounters.omittedItems,1_000_000_000,'omitted-item counters are bounded');

let normalizedNames=0;
const oversizedItems=Array.from({length:1000},(_,index)=>({
  get name(){ normalizedNames++; return 'Pozycja '+index; },
  delta:1
}));
const boundedItems=createSmartFeedQueue({minInterval:0});
boundedItems.push({kind:'inventory',title:'Duży pakiet',items:oversizedItems,holdFor:1e12},0);
const boundedItemNotice=boundedItems.promote(0);
assert.equal(boundedItemNotice.items.length,12,'only the visible item budget crosses normalization');
assert.equal(normalizedNames,12,'oversized payload entries past the visible budget are never stringified');
assert.equal(boundedItemNotice.omittedItems,988,'the bounded normalizer still reports the truncated remainder');
assert.equal(boundedItemNotice.holdFor,SMART_FEED_MAX_HOLD_MS,'producer hold times cannot stall the feed indefinitely');

class FakeClassList{
  constructor(node){ this.node=node; }
  values(){ return this.node.className.split(/\s+/).filter(Boolean); }
  contains(value){ return this.values().includes(value); }
  add(...values){
    const next=new Set(this.values());
    for(const value of values) next.add(value);
    this.node.className=[...next].join(' ');
  }
  toggle(value,force){
    const present=this.contains(value);
    const next=force===undefined ? !present : !!force;
    if(next) this.add(value);
    else this.node.className=this.values().filter(entry=>entry!==value).join(' ');
    return next;
  }
}

class FakeElement{
  constructor(tagName,ownerDocument){
    this.tagName=tagName;
    this.ownerDocument=ownerDocument;
    this.children=[];
    this.dataset={};
    this.attributes={};
    this.className='';
    this.classList=new FakeClassList(this);
    this.style={setProperty:()=>{}};
    this.textContent='';
    this.isConnected=true;
  }
  append(...nodes){ this.children.push(...nodes); }
  appendChild(node){ this.children.push(node); return node; }
  replaceChildren(...nodes){ this.children=[...nodes]; }
  setAttribute(name,value){ this.attributes[name]=String(value); }
  addEventListener(){}
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  focus(){ this.ownerDocument.activeElement=this; }
}

const fakeDocument={
  activeElement:null,
  createElement(tagName){ return new FakeElement(tagName,this); }
};
const fakeHost=new FakeElement('aside',fakeDocument);
const bindingKinds=new Map([
  ['Legacy',true],
  ['Pancerz',{kind:'equip',compact:true}],
  ['Kryształ',{kind:'resource',compact:true}],
  ['Kilof',{kind:'equip',compact:false}],
  ['Fałsz',{kind:'callback',compact:true}]
]);
let noticeBindingSeen=null;
let urgentAnnouncements=0;
const renderedFeed=createSmartFeed({
  host:fakeHost,
  document:fakeDocument,
  now:()=>0,
  minInterval:0,
  onUrgent:()=>{ urgentAnnouncements++; },
  bindInventoryItem:({item})=>bindingKinds.get(item.name),
  bindNoticeActions:({body,notice})=>{
    noticeBindingSeen=notice;
    const action=fakeDocument.createElement('button');
    action.className='mainOwnedAction';
    body.appendChild(action);
    return 1;
  }
});
renderedFeed.push({
  kind:'inventory',
  text:'Akcje',
  actions:[{label:'NIE UFAJ'}],
  items:[...bindingKinds.keys()].map(name=>({name,delta:1}))
});
const walk=(node,out=[])=>{
  out.push(node);
  for(const child of node.children||[]) walk(child,out);
  return out;
};
const renderedNodes=walk(fakeHost);
const actionCard=renderedNodes.find(node=>node.classList?.contains('smartFeedBubble'));
const itemRows=renderedNodes.filter(node=>node.classList?.contains('smartFeedItem'));
assert.equal(actionCard.dataset.actionItems,'4','all accepted item descriptors contribute to the generic action count');
assert.equal(actionCard.dataset.hotbarItems,'1','the legacy hotbar count includes only hotbar descriptors');
assert.equal(actionCard.dataset.noticeActions,'1','main-controlled notice actions mark the card');
assert.deepEqual(
  itemRows.map(row=>row.dataset.feedActionable||''),
  ['hotbar','equip','resource','equip',''],
  'only whitelisted descriptor kinds make an inventory row actionable'
);
assert.deepEqual(
  itemRows.map(row=>row.dataset.compactAction||''),
  ['true','true','','',''],
  'only the first two compact descriptors remain exposed on a compact card'
);
assert.equal(itemRows[0].dataset.hotbarAssignable,'true','legacy true retains the hotbar assignment marker');
assert.equal('hotbarAssignable' in itemRows[1].dataset,false,'non-hotbar actions never inherit hotbar behavior');
assert.equal('actions' in noticeBindingSeen,false,'notice binders receive only normalized inert data');
const feedAnnouncer=fakeHost.children.find(node=>node.className==='srOnly');
const announcedBeforeUrgent=feedAnnouncer.textContent;
renderedFeed.notify('warning','Natychmiastowy alarm',{urgent:true});
assert.equal(urgentAnnouncements,1,'urgent notices still reach the immediate HUD lane');
assert.equal(feedAnnouncer.textContent,announcedBeforeUrgent,'urgent notices are not announced again by the archival feed');
assert.equal(renderedFeed.showOlder().kind,'inventory','the back arrow can revisit a notice that left the live slot');
assert.notEqual(renderedFeed.state().selectedNoticeId,'','browsing history pauses the compact view on the selected notice');
assert.equal(renderedFeed.showNewer().kind,'warning','the forward arrow returns toward the live notice');
assert.equal(renderedFeed.state().selectedNoticeId,'','reaching the newest notice resumes the live view');
assert.equal(renderedFeed.setFilter('inventory'),'inventory','the player can select one notice category');
assert.equal(renderedFeed.state().filterKind,'inventory');
const filteredCards=walk(fakeHost,[]).filter(node=>node.classList?.contains('smartFeedBubble'));
assert.deepEqual(filteredCards.map(card=>card.dataset.kind),['inventory'],'the compact feed renders only the selected category');
assert.equal(renderedFeed.setFilter('not-a-kind'),'all','unknown filters safely fall back to all categories');
assert.equal(renderedFeed.minimize(),true,'a drained compact feed can collapse to its inbox icon');
assert.equal(renderedFeed.state().idle,true,'the minimized state is observable for deterministic UI checks');
assert.ok(walk(fakeHost,[]).some(node=>node.classList?.contains('smartFeedInbox')),'the idle feed renders only an accessible inbox control');
assert.equal(renderedFeed.open(),true,'the inbox can restore the latest communication');
assert.equal(renderedFeed.state().idle,false);
renderedFeed.destroy();

assert.equal(SMART_FEED_MIN_INTERVAL_MS,4000);
assert.equal(SMART_FEED_DISCOVERY_HOLD_MS,6200);
assert.equal(SMART_FEED_MAX_HOLD_MS,15000);
assert.equal(SMART_FEED_IDLE_DELAY_MS,1400);
assert.equal(classifySmartFeedMessage('Nadciąga meteoryt!').kind,'world');
assert.equal(classifySmartFeedMessage('Brak energii').kind,'warning');
assert.equal(classifySmartFeedMessage('Zapisano grę').kind,'success');

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/engine/smart_feed.js',import.meta.url),'utf8');
const mainSource=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const dragSource=readFileSync(new URL('../src/engine/craft_drag.js',import.meta.url),'utf8');
const uiSource=readFileSync(new URL('../src/engine/ui.js',import.meta.url),'utf8');
const bossSource=readFileSync(new URL('../src/engine/bosses.js',import.meta.url),'utf8');
assert.match(html,/<aside id="smartFeed"[^>]*role="region"/,'the shared feed has one landmark');
assert.match(source,/setAttribute\('role','log'\)/,'the visible history exposes chronological log semantics');
assert.match(source,/aria-expanded/,'the compact/expanded control is accessible');
assert.match(source,/Pokaż starszy komunikat/,'compact history exposes an accessible back arrow');
assert.match(source,/Pokaż nowszy komunikat/,'compact history exposes an accessible forward arrow');
assert.match(source,/Filtruj komunikaty według kategorii/,'the category filter has an accessible label');
assert.match(mainSource,/host:document\.getElementById\('smartFeed'\),\s*minInterval:4000/,'the live game uses the extended four-second queue pace');
assert.match(mainSource,/NOWY WPIS W ATLASIE[^\n]*holdFor:4100[\s\S]{0,260}NOWE ODKRYCIE[^\n]*holdFor:6200/,'every discovery tier keeps its card for two extra seconds');
assert.match(source,/opts\.urgent===true/,'structured producers can archive an urgent notice while using the immediate lane');
assert.match(source,/itemInput\.slice\(0,SMART_FEED_MAX_ITEMS\)\.map\(normalizeItem\)/,'item normalization work is bounded before public payloads are traversed');
assert.match(source,/raw\.slice\(0,scanBudget\)\.replace/, 'text normalization bounds its scan before whitespace processing');
assert.match(source,/pending:pending\.map\(noticeSnapshot\)[\s\S]{0,80}history:history\.map\(noticeSnapshot\)/, 'public queue state deep-snapshots renderable notices');
assert.match(source,/if\(urgent&&onUrgent&&opts\.announce===undefined\) notice\.announce=false/,'urgent notices have exactly one live-region owner');
assert.match(source,/previousStack\.scrollTop/,'incoming cards preserve the reader scroll anchor');
assert.match(source,/const restoreControl=controlFocusSnapshot\(active\)/,'feed rebuilds capture the focused direct action');
assert.match(source,/if\(restoreControl\)\{[\s\S]{0,140}restoreControlFocus\(restoreControl,stack\)/,'feed rebuilds restore that action or fall back to the header control');
assert.match(source,/options\.expanded===undefined \? false/,'the feed starts compact instead of covering gameplay');
assert.match(source,/state\.lastPromotion\+state\.lastHold\+idleDelay/,'the feed automatically minimizes only after the visible notice has finished');
assert.match(source,/active\.matches\(':focus-visible'\)/,'only keyboard-visible focus postpones automatic minimization');
assert.match(source,/className='smartFeedInbox'/,'the inactive feed leaves a single inbox affordance');
assert.match(source,/bindInventoryItem\(\{row,handle:icon,item,notice\}\)/,'inventory rows expose one narrow decoration seam');
assert.match(source,/bindNoticeActions\(\{card,body,notice\}\)/,'notice cards expose a main-controlled action seam');
assert.match(mainSource,/resourceKey:entry\.type==='resource'\?entry\.key:''/,'only inventory resources publish an actionable identity');
assert.match(mainSource,/gearId:entry\.type==='gear'\?entry\.key:''/,'gear notifications publish only an opaque inventory identity');
assert.match(mainSource,/item\.delta<=0[\s\S]*SMART_FEED_RESOURCE_DEFS\.get/,'losses are inert and resource keys are revalidated against the game catalog');
assert.match(mainSource,/MM\.craftDrag\.makeDraggable\(handle/,'feed resources reuse the shared mouse/touch drag layer');
assert.match(mainSource,/function assignSmartFeedResource\(slot,item\)\{[\s\S]{0,180}assignHotbarWithUndo\(slot,def\.tile,def\.label\)/,'feed assignment uses the guarded hotbar remap helper');
assert.match(mainSource,/function assignHotbarWithUndo\(slot,key,label\)\{[\s\S]{0,1200}MM\.hotbar\.assign\(slot,key\)/,'guarded remaps still mutate through the canonical hotbar chokepoint');
assert.match(mainSource,/if\(previousKey===key\)[\s\S]{0,620}return true;[\s\S]{0,80}MM\.hotbar\.assign\(slot,key\)/,'a same-slot assignment exits before mutating, saving, or scheduling a pulse');
assert.match(mainSource,/handle\.addEventListener\('keydown',event=>\{\s*if\(event\.repeat\) return;/,'held hotbar keys cannot amplify remaps and timers through keyboard autorepeat');
assert.match(mainSource,/function bindSmartFeedNoticeActions\(\{body,notice\}\)/,'main owns every executable notice action');
assert.match(mainSource,/TASKS\.setPriority\(task\.id\)/,'task actions revalidate and select a canonical active task');
assert.match(mainSource,/id:'smart_feed:waypoint'[\s\S]{0,220}pointer:true/,'targeted notices reuse one bounded snapshot waypoint');
assert.match(mainSource,/MM\.inventory\.equip\(state\.live\.gear\.id\)/,'quick equip re-resolves gear before using the inventory chokepoint');
assert.match(mainSource,/MM\.craftUI\.openForIngredient\(live\.key/,'resource actions use the exact crafting UI bridge');
assert.match(mainSource,/openForIngredient\(live\.key,\{focus:true,keyboard:event\.detail===0\}\)/,'pointer and keyboard activation both move focus into the newly opened crafting results');
assert.match(mainSource,/const TEMPORAL_ECHO_TASK_ID='temporal_echo:return'/,'the timed echo has one stable recovery-task identity');
assert.match(mainSource,/function upsertGraveReturnTask\(marker,echo,opts\)\{[\s\S]{0,420}announcedFeedTasks\.delete\(id\)/,'recurring grave objectives can announce again after a rewind or recovery');
assert.match(mainSource,/kind:'recovery',[\s\S]{0,100}reactivate:!\(opts&&opts\.reactivate===false\)/,'a newly created grave can reactivate its stable dismissed task identity');
assert.match(mainSource,/function resetActivityPresentation\(\)\{[\s\S]{0,180}smartFeedHotbarUndo=null;[\s\S]{0,80}removeHotbarUndoToast\(\)/,'loading, rewinding, or replacing the world invalidates stale hotbar undo capabilities');
assert.match(mainSource,/toast\.setAttribute\('role','group'\)[\s\S]{0,120}Cofnij zmianę paska/, 'the interactive undo toast leaves live announcements to the unified feed');
assert.match(mainSource,/function removeHotbarUndoToast\(\)[\s\S]{0,420}old\.contains\(document\.activeElement\)[\s\S]{0,640}fallback\.focus/, 'removing a focused undo action restores keyboard focus');
assert.match(mainSource,/mm-inventory-change',event=>\{[\s\S]{0,180}event\.detail\.key==='color'\) return/, 'pure color changes do not rebuild the hidden Smart Feed');
assert.match(mainSource,/upsertGraveReturnTask\(grave,true\)/,'a grounded temporal spirit becomes a real tracked task');
assert.match(mainSource,/collapseTemporalEcho[\s\S]{0,520}removeGraveReturnTask\(TEMPORAL_ECHO_TASK_ID\)/,'an expired or broken echo retires its tracker');
assert.match(mainSource,/TASKS\.complete\(GRAVE_RETURN_TASK_ID\)/,'recovering an ordinary grave completes its active objective');
assert.match(dragSource,/document\.addEventListener\('pointerup',onUp,true\)/,'drag completion survives a source re-render');
assert.match(dragSource,/e\.pointerId!==drag\.pointerId/,'multi-pointer events cannot hijack an active resource drag');
assert.match(html,/smartFeedBubble\[data-action-items\][^}]*smartFeedItems\{ display:grid; pointer-events:none/,'compact cards reveal only their explicit item actions');
assert.match(html,/smartFeedItemHotbar,[\s\S]{0,180}smartFeedItemCraft\{ pointer-events:auto/,'compact item controls remain actionable without capturing the whole feed');
assert.match(html,/@media \(pointer:coarse\)[\s\S]*smartFeedItemHotbar,\.smartFeedItemEquip\{ width:42px; height:42px/,'touch devices receive large dedicated action targets without disabling feed scrolling');
assert.match(html,/:root\[data-input-mode='touch'\] #smartFeed \.smartFeedItems\{ grid-template-columns:minmax\(0,1fr\)/,'all touch feed item lists use a readable single-column layout');
assert.match(html,/@media \(orientation:portrait\) and \(max-width:820px\)[\s\S]{0,520}#smartFeed\{ top:calc\(var\(--safe-top\) \+ 310px\); bottom:auto; \}/,'portrait touch feed starts below the fixed top hotbar instead of crossing it');
assert.match(html,/@media \(orientation:portrait\) and \(max-width:820px\)[\s\S]{0,1000}#smartFeed\[data-expanded='true'\] \.smartFeedStack\{ max-height:min\(28vh,240px\); \}/,'expanded portrait history stays clear of the touch action rail');
assert.match(html,/@media \(orientation:portrait\) and \(max-width:820px\)[\s\S]{0,1400}#messages\{ left:calc\(var\(--safe-left\) \+ 10px\);[\s\S]{0,160}top:calc\(var\(--safe-top\) \+ 96px\)/,'portrait transient status uses the free upper-left lane instead of covering the feed');
assert.match(html,/@media \(orientation:portrait\) and \(max-width:480px\) and \(max-height:700px\)[\s\S]{0,520}#smartFeed\{ width:min\(168px/,'short phones keep the feed in the left lane away from action controls');
assert.match(html,/\.smartFeedAction\{[^}]*width:30px; height:30px/,'notice actions use compact icon-only button surfaces');
assert.match(html,/#smartFeed\{[^}]*width:min\(190px/,'the left notification lane is about half its former width');
assert.match(html,/\.smartFeedBubble\{[^}]*rgba\(7,12,20,\.68\)/,'notification cards keep the game visible through a translucent surface');
assert.match(html,/\.smartFeedItems\{[^}]*grid-template-columns:minmax\(0,1fr\)/,'inventory history uses one readable named row per change');
assert.doesNotMatch(html,/#smartFeed\[data-expanded='false'\] \.smartFeedText[^}]*-webkit-line-clamp/,'compact cards never hide copy behind an ellipsis');
assert.match(html,/\.smartFeedXp\{[^}]*white-space:nowrap/,'short XP labels always remain on one line');
assert.match(mainSource,/button\.dataset\.actionLabel=label;[\s\S]{0,180}button\.setAttribute\('aria-label',label\)/,'icon-only actions retain a full accessible name and tooltip');
assert.doesNotMatch(mainSource,/const text=document\.createElement\('span'\);\s*text\.textContent=label;/,'notice action labels no longer consume card width');
assert.match(mainSource,/function shouldPublishInventoryFeedback\(entry\)[\s\S]{0,180}entry\.cause==='direct'\) return false/,'direct player inventory changes are filtered before publication');
assert.match(mainSource,/Zaczął się dzień\.[\s\S]{0,80}Zapadła noc\./,'day and night transitions enter the useful world feed');
assert.match(mainSource,/Zaczęła się wiosna\.[\s\S]{0,220}Zaczęła się zima\./,'all season transitions have concise world notices');
assert.match(mainSource,/const ui=inventoryOverlay&&inventoryOverlay\.style\.display==='block'[\s\S]{0,80}\? inventoryOverlay[\s\S]{0,40}: document\.body/,'the undo toast mounts above an open inventory modal');
assert.match(uiSource,/function msgImmediate\(text\)/,'the HUD retains a direct lane that cannot recursively duplicate urgent feed cards');
assert.match(bossSource,/puchnie od energii - uciekaj!',\{[\s\S]{0,90}urgent:true,[\s\S]{0,90}target:\{x:bx\+0\.5,y:by\+0\.5\}/,'the short boss-heart escape window bypasses pacing and exposes its snapshot location');
assert.match(bossSource,/pojawił się '\+dirTxt\+'!',\{[\s\S]{0,80}target:\{x:m\.x,y:m\.y\}/,'boss arrival notices expose a trackable snapshot location');
assert.match(html,/prefers-reduced-motion:reduce[^}]*smartFeedBubble/,'feed motion respects reduced-motion preferences');

console.log('smart-feed-sim: all assertions passed');
