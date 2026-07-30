// One calm notification lane for discoveries, inventory changes and world
// events. Producers submit structured notices; this module owns pacing,
// de-duplication, short history and the compact/expanded presentation.

export const SMART_FEED_MIN_INTERVAL_MS=2000;
export const SMART_FEED_DISCOVERY_HOLD_MS=4200;
export const SMART_FEED_MAX_PENDING=32;
export const SMART_FEED_MAX_HISTORY=24;

const KIND_META=Object.freeze({
  discovery:{icon:'!',title:'ODKRYCIE',accent:'#ffd66e',priority:100},
  world:{icon:'◈',title:'ŚWIAT',accent:'#81c7ff',priority:72},
  omen:{icon:'◉',title:'OMEN',accent:'#c7a2ff',priority:78},
  story:{icon:'◆',title:'OPOWIEŚĆ',accent:'#e5b7ff',priority:82},
  task:{icon:'◎',title:'ZADANIE',accent:'#ffca72',priority:68},
  achievement:{icon:'★',title:'ROZWÓJ',accent:'#ffe17c',priority:76},
  inventory:{icon:'▣',title:'EKWIPUNEK',accent:'#7fe2aa',priority:46},
  warning:{icon:'!',title:'UWAGA',accent:'#ff9b86',priority:64},
  success:{icon:'✓',title:'SUKCES',accent:'#83dda7',priority:55},
  system:{icon:'•',title:'SYSTEM',accent:'#a8b7c8',priority:38},
  info:{icon:'•',title:'INFORMACJA',accent:'#9fb8d1',priority:36}
});

function finite(value,fallback=0){
  const n=Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value,max=420){
  return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max);
}

function normalizedKey(value){
  return safeText(value,180).toLocaleLowerCase('pl-PL').replace(/\d+(?:[.,]\d+)?/g,'#');
}

function kindMeta(kind){
  return KIND_META[kind] || KIND_META.info;
}

export function classifySmartFeedMessage(value){
  const text=safeText(value);
  if(!text) return null;
  let kind='info';
  if(/(?:boss|guardian|strażni|inwazj|meteor|ufo|obcy|kretolud|warstw|wulkan|krater|biom|zorza|burz|zamieć|atomow|atomic|winter|portal|świat)/i.test(text)) kind='world';
  if(/^(?:👁|oko)|(?:zwróciło na ciebie uwagę|warstwa cię pamięta|symulacja patrzy)/i.test(text)) kind='omen';
  else if(/(?:brak|nie możesz|nie mozna|zablok|za daleko|błąd|uwaga|nie udało|wstrzyman)/i.test(text)) kind='warning';
  else if(/(?:zapisano|nadpisano|odzyskano|ukończono|odblokowano|zwycięstwo|sukces)/i.test(text)) kind='success';
  else if(/(?:zapis|wczyt|ustawieni|tryb|debug|seed)/i.test(text)) kind='system';
  const meta=kindMeta(kind);
  return {
    kind,
    title:meta.title,
    text,
    icon:meta.icon,
    accent:meta.accent,
    priority:meta.priority,
    dedupeKey:'message:'+normalizedKey(text)
  };
}

function normalizeItem(item){
  if(!item || typeof item!=='object') return null;
  const delta=Math.trunc(finite(item.delta));
  return {
    name:safeText(item.name||item.label||'Przedmiot',90),
    delta,
    icon:safeText(item.icon||'',8),
    color:safeText(item.color||'',32)
  };
}

function normalizeNotice(raw,sequence,at){
  const src=raw && typeof raw==='object' ? raw : {text:raw};
  const kind=KIND_META[src.kind] ? src.kind : 'info';
  const meta=kindMeta(kind);
  const text=safeText(src.text);
  const title=safeText(src.title||meta.title,80);
  const rawItems=(Array.isArray(src.items)?src.items:[]).map(normalizeItem).filter(Boolean);
  const items=rawItems.slice(0,12);
  if(!text && !title && !items.length) return null;
  const target=src.target && Number.isFinite(Number(src.target.x)) && Number.isFinite(Number(src.target.y))
    ? {x:Number(src.target.x),y:Number(src.target.y)}
    : null;
  return {
    id:'smart-notice-'+sequence,
    sequence,
    kind,
    title:title||meta.title,
    text,
    icon:safeText(src.icon||meta.icon,8),
    accent:safeText(src.accent||meta.accent,32),
    priority:Math.max(0,Math.min(200,finite(src.priority,meta.priority))),
    dedupeKey:safeText(src.dedupeKey||'',220),
    xp:Math.max(0,Math.trunc(finite(src.xp))),
    stage:safeText(src.stage||'',24),
    presentation:safeText(src.presentation||'',24),
    tier:safeText(src.tier||'',60),
    context:safeText(src.context||'',100),
    count:Math.max(1,Math.trunc(finite(src.count,1))),
    occurredAt:finite(src.occurredAt,at),
    createdAt:at,
    holdFor:Math.max(0,finite(src.holdFor,kind==='discovery'?SMART_FEED_DISCOVERY_HOLD_MS:0)),
    target,
    items,
    omittedItems:Math.max(0,rawItems.length-items.length+Math.trunc(finite(src.omittedItems)))
  };
}

export function createSmartFeedQueue(options={}){
  const minInterval=Math.max(0,finite(options.minInterval,SMART_FEED_MIN_INTERVAL_MS));
  const maxPending=Math.max(1,Math.trunc(finite(options.maxPending,SMART_FEED_MAX_PENDING)));
  const maxHistory=Math.max(1,Math.trunc(finite(options.maxHistory,SMART_FEED_MAX_HISTORY)));
  const dedupeWindow=Math.max(0,finite(options.dedupeWindow,8000));
  const pending=[];
  const history=[];
  let lastPromotion=-Infinity;
  let lastHold=minInterval;
  let sequence=0;

  function push(raw,now=Date.now()){
    const at=finite(now,Date.now());
    const notice=normalizeNotice(raw,++sequence,at);
    if(!notice) return {accepted:false,merged:false,notice:null};
    if(notice.dedupeKey){
      const queued=pending.find(item=>item.dedupeKey===notice.dedupeKey);
      if(queued){
        queued.count+=notice.count;
        queued.text=notice.text||queued.text;
        queued.title=notice.title||queued.title;
        queued.stage=notice.stage||queued.stage;
        queued.presentation=notice.presentation||queued.presentation;
        queued.xp=Math.min(1000000000,queued.xp+notice.xp);
        queued.occurredAt=notice.occurredAt;
        queued.createdAt=at;
        if(notice.items.length){
          queued.items=notice.items;
          queued.omittedItems=notice.omittedItems;
        }
        return {accepted:true,merged:true,notice:queued,location:'pending'};
      }
      const shown=history.find(item=>item.dedupeKey===notice.dedupeKey && at-item.createdAt<=dedupeWindow);
      if(shown){
        shown.count+=notice.count;
        shown.text=notice.text||shown.text;
        shown.title=notice.title||shown.title;
        shown.stage=notice.stage||shown.stage;
        shown.presentation=notice.presentation||shown.presentation;
        shown.xp=Math.min(1000000000,shown.xp+notice.xp);
        shown.occurredAt=notice.occurredAt;
        shown.createdAt=at;
        if(notice.items.length){
          shown.items=notice.items;
          shown.omittedItems=notice.omittedItems;
        }
        return {accepted:true,merged:true,notice:shown,location:'history'};
      }
    }
    pending.push(notice);
    if(pending.length>maxPending){
      pending.sort((a,b)=>b.priority-a.priority || b.sequence-a.sequence);
      pending.length=maxPending;
    }
    return {accepted:true,merged:false,notice,location:'pending'};
  }

  function promote(now=Date.now()){
    const at=finite(now,Date.now());
    if(!pending.length || at-lastPromotion<lastHold) return null;
    pending.sort((a,b)=>b.priority-a.priority || a.sequence-b.sequence);
    const notice=pending.shift();
    notice.createdAt=at;
    history.unshift(notice);
    if(history.length>maxHistory) history.length=maxHistory;
    lastPromotion=at;
    lastHold=Math.max(minInterval,notice.holdFor);
    return notice;
  }

  function delay(now=Date.now()){
    if(!pending.length) return null;
    return Math.max(0,lastHold-(finite(now,Date.now())-lastPromotion));
  }

  function clear(){
    pending.length=0;
    history.length=0;
    lastPromotion=-Infinity;
    lastHold=minInterval;
  }

  function state(){
    return {
      pending:pending.slice(),
      history:history.slice(),
      lastPromotion,
      lastHold,
      minInterval,
      maxPending,
      maxHistory
    };
  }

  return {push,promote,delay,clear,state};
}

function relativeAge(createdAt,now){
  const seconds=Math.max(0,Math.floor((now-createdAt)/1000));
  if(seconds<4) return 'teraz';
  if(seconds<60) return seconds+' s';
  return Math.floor(seconds/60)+' min';
}

function appendInventoryItems(doc,body,items,omittedItems=0){
  if(!items.length) return;
  const list=doc.createElement('div');
  list.className='smartFeedItems';
  for(const item of items){
    const row=doc.createElement('div');
    row.className='smartFeedItem';
    row.dataset.direction=item.delta<0?'loss':'gain';
    if(item.color) row.style.setProperty('--smart-item-accent',item.color);
    const icon=doc.createElement('span');
    icon.className='smartFeedItemIcon';
    icon.textContent=item.icon||'◆';
    const name=doc.createElement('span');
    name.className='smartFeedItemName';
    name.textContent=item.name;
    const amount=doc.createElement('strong');
    amount.className='smartFeedItemAmount';
    amount.textContent=(item.delta>0?'+':item.delta<0?'−':'')+Math.abs(item.delta);
    row.append(icon,name,amount);
    list.appendChild(row);
  }
  body.appendChild(list);
  if(omittedItems>0){
    const more=doc.createElement('div');
    more.className='smartFeedMore';
    more.textContent='+'+omittedItems+' więcej';
    body.appendChild(more);
  }
}

export function createSmartFeed(options={}){
  const host=options.host||null;
  const doc=options.document || (host && host.ownerDocument) || (typeof document!=='undefined'?document:null);
  const clock=typeof options.now==='function' ? options.now : ()=>Date.now();
  const onPromote=typeof options.onPromote==='function' ? options.onPromote : null;
  const onUrgent=typeof options.onUrgent==='function' ? options.onUrgent : null;
  const queue=createSmartFeedQueue(options);
  let expanded=options.expanded===undefined ? false : !!options.expanded;
  let timer=0;
  let newestId='';
  let destroyed=false;
  const announcer=doc ? doc.createElement('div') : null;
  if(announcer){
    announcer.className='srOnly';
    announcer.setAttribute('role','status');
    announcer.setAttribute('aria-live','polite');
    announcer.setAttribute('aria-atomic','true');
  }

  function clearTimer(){
    if(timer) clearTimeout(timer);
    timer=0;
  }

  function cardFor(notice,now){
    const card=doc.createElement('article');
    card.className='smartFeedBubble';
    card.dataset.kind=notice.kind;
    if(notice.stage) card.dataset.stage=notice.stage;
    if(notice.presentation) card.dataset.presentation=notice.presentation;
    card.dataset.noticeId=notice.id;
    card.style.setProperty('--smart-feed-accent',notice.accent||kindMeta(notice.kind).accent);
    if(notice.id===newestId) card.classList.add('is-new');

    const icon=doc.createElement('span');
    icon.className='smartFeedIcon';
    icon.textContent=notice.icon||kindMeta(notice.kind).icon;
    icon.setAttribute('aria-hidden','true');
    const body=doc.createElement('div');
    body.className='smartFeedBody';
    const meta=doc.createElement('div');
    meta.className='smartFeedMeta';
    const title=doc.createElement('strong');
    title.className='smartFeedTitle';
    title.textContent=notice.title;
    meta.appendChild(title);
    if(notice.tier){
      const tier=doc.createElement('span');
      tier.className='smartFeedTier';
      tier.textContent=notice.tier;
      meta.appendChild(tier);
    }
    const age=doc.createElement('time');
    age.className='smartFeedAge';
    age.textContent=relativeAge(notice.occurredAt,now);
    meta.appendChild(age);
    body.appendChild(meta);
    if(notice.text){
      const copy=doc.createElement('p');
      copy.className='smartFeedText';
      copy.textContent=notice.text;
      body.appendChild(copy);
    }
    appendInventoryItems(doc,body,notice.items,notice.omittedItems);
    if(notice.context || notice.xp>0){
      const footer=doc.createElement('div');
      footer.className='smartFeedFooter';
      if(notice.context){
        const context=doc.createElement('span');
        context.textContent=notice.context;
        footer.appendChild(context);
      }
      if(notice.xp>0){
        const xp=doc.createElement('strong');
        xp.className='smartFeedXp';
        xp.textContent='+'+notice.xp+' XP';
        footer.appendChild(xp);
      }
      body.appendChild(footer);
    }
    if(notice.count>1){
      const count=doc.createElement('strong');
      count.className='smartFeedRepeat';
      count.textContent='×'+notice.count;
      card.append(icon,body,count);
    }else card.append(icon,body);
    return card;
  }

  function render(){
    if(!host || !doc || destroyed) return;
    const active=doc.activeElement;
    const restoreToggleFocus=!!(active && active.classList && active.classList.contains('smartFeedToggle'));
    const restoreStackFocus=!!(active && active.classList && active.classList.contains('smartFeedStack'));
    const previousStack=host.querySelector('.smartFeedStack');
    let scrollAnchor=null;
    if(expanded && previousStack && previousStack.scrollTop>2){
      const top=previousStack.scrollTop;
      const cards=[...previousStack.querySelectorAll('.smartFeedBubble')];
      const anchor=cards.find(card=>card.offsetTop+card.offsetHeight>top);
      if(anchor) scrollAnchor={
        id:anchor.dataset.noticeId,
        offset:anchor.offsetTop-top
      };
    }
    const state=queue.state();
    host.dataset.expanded=expanded?'true':'false';
    host.classList.toggle('is-empty',!state.history.length && !state.pending.length);
    host.replaceChildren();
    if(!state.history.length && !state.pending.length) return;

    const head=doc.createElement('div');
    head.className='smartFeedHead';
    const label=doc.createElement('span');
    label.className='smartFeedLabel';
    label.textContent='DZIENNIK ZDARZEŃ';
    const queueStatus=doc.createElement('span');
    queueStatus.className='smartFeedLive';
    queueStatus.textContent=state.pending.length ? '+'+state.pending.length+' w kolejce' : 'na żywo';
    const toggle=doc.createElement('button');
    toggle.type='button';
    toggle.className='smartFeedToggle';
    toggle.setAttribute('aria-expanded',expanded?'true':'false');
    toggle.setAttribute('aria-controls','smartFeedHistory');
    toggle.setAttribute('aria-label',expanded?'Zwiń dziennik zdarzeń':'Rozwiń dziennik zdarzeń');
    toggle.textContent=expanded?'⌃':'⌄';
    toggle.addEventListener('click',()=>{
      expanded=!expanded;
      newestId='';
      render();
    });
    head.append(label,queueStatus,toggle);

    const stack=doc.createElement('div');
    stack.id='smartFeedHistory';
    stack.className='smartFeedStack';
    stack.setAttribute('role','log');
    stack.setAttribute('aria-live','off');
    stack.setAttribute('aria-label','Historia komunikatów, najnowsze na początku');
    stack.tabIndex=expanded?0:-1;
    const visible=expanded ? state.history : state.history.slice(0,1);
    const now=clock();
    for(const notice of visible) stack.appendChild(cardFor(notice,now));
    host.append(head,stack,announcer);
    if(scrollAnchor){
      const anchor=[...stack.querySelectorAll('.smartFeedBubble')]
        .find(card=>card.dataset.noticeId===scrollAnchor.id);
      if(anchor) stack.scrollTop=Math.max(0,anchor.offsetTop-scrollAnchor.offset);
    }
    if(restoreToggleFocus) toggle.focus({preventScroll:true});
    else if(restoreStackFocus && expanded) stack.focus({preventScroll:true});
    if(newestId){
      const latest=state.history.find(notice=>notice.id===newestId);
      if(latest){
        const itemSummary=latest.items.length
          ? latest.items.slice(0,6).map(item=>(item.delta>0?'plus ':'minus ')+Math.abs(item.delta)+' '+item.name).join(', ')
            +(latest.items.length>6 || latest.omittedItems>0
              ?', oraz '+(Math.max(0,latest.items.length-6)+latest.omittedItems)+' więcej':'')
          : '';
        const announce=[latest.title,latest.text,itemSummary,latest.context,latest.xp>0?'+'+latest.xp+' XP':'']
          .filter(Boolean).join('. ');
        const speak=()=>{ if(announcer.isConnected) announcer.textContent=announce; };
        if(typeof requestAnimationFrame==='function') requestAnimationFrame(speak);
        else speak();
      }
    }
    newestId='';
  }

  function updateStatus(){
    if(!host || !doc || destroyed) return;
    const state=queue.state();
    host.classList.toggle('is-empty',!state.history.length && !state.pending.length);
    const status=host.querySelector('.smartFeedLive');
    if(status) status.textContent=state.pending.length ? '+'+state.pending.length+' w kolejce' : 'na żywo';
  }

  function schedule(){
    const wait=queue.delay(clock());
    if(wait==null){
      clearTimer();
      return;
    }
    if(timer) return;
    timer=setTimeout(()=>{
      timer=0;
      pump();
    },Math.max(0,wait));
  }

  function pump(forceRender=false){
    if(destroyed) return null;
    const promoted=queue.promote(clock());
    if(promoted){
      newestId=promoted.id;
      if(onPromote){
        try{ onPromote(promoted); }catch(e){ /* presentation callbacks are optional */ }
      }
    }
    if(promoted || forceRender) render();
    else updateStatus();
    schedule();
    return promoted;
  }

  function push(notice){
    if(destroyed) return false;
    const result=queue.push(notice,clock());
    if(!result.accepted) return false;
    pump(result.location==='history');
    return true;
  }

  function acceptMessage(text,opts={}){
    const notice=classifySmartFeedMessage(text);
    if(!notice) return false;
    // The old msg() channel also carries frame-critical warnings and noisy
    // interaction failures. Only archive clearly high-value legacy messages;
    // structured producers use notify()/push() and never depend on wording.
    if(opts.legacy && !['world','omen','success'].includes(notice.kind)) return false;
    push(Object.assign(notice,opts));
    return true;
  }

  function notify(kind,text,opts={}){
    const meta=kindMeta(kind);
    const urgent=opts.urgent===true;
    const notice=Object.assign({
      kind,
      title:meta.title,
      text:safeText(text),
      icon:meta.icon,
      accent:meta.accent,
      priority:meta.priority,
      dedupeKey:kind+':'+normalizedKey(text)
    },opts);
    if(urgent) notice.priority=Math.max(120,finite(notice.priority,meta.priority));
    const accepted=push(notice);
    if(urgent && onUrgent){
      try{ onUrgent(safeText(text),notice); }catch(e){ /* immediate lane is optional */ }
    }
    return accepted;
  }

  function clear(){
    clearTimer();
    queue.clear();
    newestId='';
    render();
  }

  function setExpanded(value){
    expanded=!!value;
    render();
    return expanded;
  }

  function destroy(){
    destroyed=true;
    clearTimer();
    queue.clear();
    if(host) host.replaceChildren();
  }

  const api={
    push,
    acceptMessage,
    notify,
    world:(text,opts)=>notify('world',text,opts),
    story:(text,opts)=>notify('story',text,opts),
    clear,
    destroy,
    setExpanded,
    isExpanded:()=>expanded,
    state:()=>Object.assign(queue.state(),{expanded}),
    flush:()=>pump()
  };
  render();
  return api;
}

export default createSmartFeed;
