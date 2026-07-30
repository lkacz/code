// Adaptive HUD feedback for every resource, tool and carried-gear change.
// Short runs stay sequential and expressive. A backlog longer than five changes
// becomes compact batches so a large loot/death transaction cannot occupy the
// notification lane for tens of seconds. Gameplay systems only need to keep
// emitting the existing inventory/resource events; this module compares
// snapshots so old and new mutation paths share one presentation path.

export const INVENTORY_FEEDBACK_COMPACT_THRESHOLD=5;
export const INVENTORY_FEEDBACK_BATCH_SIZE=8;

function finiteCount(value){
  const n=Number(value);
  return Number.isFinite(n) ? Math.max(0,Math.floor(n)) : 0;
}

function changeEntry(type,key,name,delta,meta,context){
  const amount=Math.trunc(Number(delta)||0);
  if(!amount) return null;
  const ctx=context && typeof context==='object' ? context : {};
  const preview=type==='gear'
    ? {kind:'gear',item:meta && meta.item ? Object.assign({},meta.item) : null}
    : {
        kind:type,
        tile:meta && meta.tile ? String(meta.tile) : '',
        icon:meta && meta.icon ? String(meta.icon) : ''
      };
  return {
    type,
    key:String(key||''),
    name:String(name||key||'Przedmiot'),
    delta:amount,
    direction:amount>0?'gain':'loss',
    color:meta && meta.color ? String(meta.color) : '#9fb8d1',
    tier:meta && meta.tier ? String(meta.tier) : '',
    cause:ctx.kind==='death'?'death':String(ctx.kind||''),
    deathCause:ctx.kind==='death' ? String(ctx.cause||'damage') : '',
    preview
  };
}

function itemMap(items){
  const out=new Map();
  for(const item of Array.isArray(items)?items:[]){
    if(!item || typeof item.id!=='string' || !item.id) continue;
    out.set(item.id,item);
  }
  return out;
}

export function diffInventoryFeedback(previous,current,config={},context={}){
  const before=previous && typeof previous==='object' ? previous : {};
  const after=current && typeof current==='object' ? current : {};
  const entries=[];
  const resourceDefs=Array.isArray(config.resourceDefs)?config.resourceDefs:[];
  const specialDefs=Array.isArray(config.specialDefs)?config.specialDefs:[];
  const beforeResources=before.resources||{};
  const afterResources=after.resources||{};
  const beforeSpecials=before.specials||{};
  const afterSpecials=after.specials||{};

  for(const def of resourceDefs){
    if(!def || !def.key) continue;
    const delta=finiteCount(afterResources[def.key])-finiteCount(beforeResources[def.key]);
    const entry=changeEntry('resource',def.key,def.label||def.key,delta,def,context);
    if(entry) entries.push(entry);
  }
  for(const def of specialDefs){
    if(!def || !def.key) continue;
    const delta=finiteCount(afterSpecials[def.key])-finiteCount(beforeSpecials[def.key]);
    const entry=changeEntry('tool',def.key,def.label||def.key,delta,def,context);
    if(entry) entries.push(entry);
  }

  const beforeItems=itemMap(before.items);
  const afterItems=itemMap(after.items);
  const tierColors=config.tierColors||{};
  for(const [id,item] of beforeItems){
    if(afterItems.has(id)) continue;
    const entry=changeEntry('gear',id,item.name||id,-1,{
      tier:item.tier,
      color:tierColors[item.tier]||item.color||'#ff8d7a',
      item
    },context);
    if(entry) entries.push(entry);
  }
  for(const [id,item] of afterItems){
    if(beforeItems.has(id)) continue;
    const entry=changeEntry('gear',id,item.name||id,1,{
      tier:item.tier,
      color:tierColors[item.tier]||item.color||'#8ee6ae',
      item
    },context);
    if(entry) entries.push(entry);
  }
  return entries;
}

function canMerge(a,b){
  return !!(a && b && a.type===b.type && a.key===b.key
    && a.direction===b.direction && a.cause===b.cause
    && a.deathCause===b.deathCause);
}

function compactBatch(entries){
  const list=(Array.isArray(entries)?entries:[]).filter(Boolean);
  const directions=new Set(list.map(entry=>entry.direction));
  const causes=new Set(list.map(entry=>entry.cause||''));
  const deathCauses=new Set(list.map(entry=>entry.deathCause||''));
  const direction=directions.size===1 && list.length ? list[0].direction : 'mixed';
  return {
    type:'batch',
    key:'batch',
    name:'Zmiany ekwipunku',
    delta:list.reduce((sum,entry)=>sum+(Number(entry.delta)||0),0),
    direction,
    color:direction==='gain'?'#66d695':direction==='loss'?'#e37a6d':'#79b8e8',
    cause:causes.size===1 && list.length ? list[0].cause||'' : '',
    deathCause:deathCauses.size===1 && list.length ? list[0].deathCause||'' : '',
    entries:list
  };
}

function compactTakeCount(length){
  const count=Math.max(0,Math.floor(Number(length)||0));
  if(count<=INVENTORY_FEEDBACK_BATCH_SIZE) return count;
  // Avoid an eight-item card followed by a lonely one-item card.
  if(count-INVENTORY_FEEDBACK_BATCH_SIZE===1) return INVENTORY_FEEDBACK_BATCH_SIZE-1;
  return INVENTORY_FEEDBACK_BATCH_SIZE;
}

export function createInventoryFeedbackQueue(){
  let current=null;
  const pending=[];
  let compactMode=false;

  function promote(){
    if(!current && pending.length){
      if(compactMode && pending.length>1){
        const take=compactTakeCount(pending.length);
        current=compactBatch(pending.splice(0,take));
      }else current=pending.shift();
    }
    return current;
  }
  function push(entries){
    for(const raw of Array.isArray(entries)?entries:[]){
      if(!raw || !raw.delta) continue;
      const entry=Object.assign({},raw);
      const tail=pending[pending.length-1];
      if(canMerge(tail,entry)) tail.delta+=entry.delta;
      else pending.push(entry);
    }
    const queued=(current ? (current.type==='batch'?current.entries.length:1) : 0)+pending.length;
    if(queued>INVENTORY_FEEDBACK_COMPACT_THRESHOLD) compactMode=true;
    promote();
    return state();
  }
  function finish(){
    current=null;
    promote();
    if(!current && !pending.length) compactMode=false;
    return state();
  }
  function clear(){
    current=null;
    pending.length=0;
    compactMode=false;
    return state();
  }
  function state(){
    return {current, pending:pending.slice(), compactMode};
  }
  return {push,finish,clear,state};
}

function cloneItems(items){
  return (Array.isArray(items)?items:[])
    .filter(item=>item && typeof item.id==='string')
    .map(item=>Object.assign({},item));
}

const DEATH_CAUSE_LABELS=Object.freeze({
  alien_invasion:'po śmierci — inwazja Obcych',
  molekin_invasion:'po śmierci — inwazja kretoludzi'
});

function statusCopy(entry){
  if(entry.cause==='death' && entry.direction==='loss'){
    return {
      verb:'Utracono',
      context:DEATH_CAUSE_LABELS[entry.deathCause] || 'po śmierci'
    };
  }
  if(entry.cause==='death' && entry.direction==='gain'){
    return {verb:'Odzyskano',context:'po śmierci'};
  }
  return entry.direction==='gain'
    ? {verb:'Zdobyto',context:'w ekwipunku'}
    : {verb:'Utracono',context:'z ekwipunku'};
}

export function createInventoryFeedback(options={}){
  const eventTarget=options.eventTarget || (typeof window!=='undefined'?window:null);
  const host=options.host || null;
  const publish=typeof options.publish==='function' ? options.publish : null;
  const resourceDefs=Array.isArray(options.resourceDefs)?options.resourceDefs:[];
  const specialDefs=Array.isArray(options.specialDefs)?options.specialDefs:[];
  const tierColors=options.tierColors||{};
  const visibilityDoc=options.document || (host && host.ownerDocument)
    || (eventTarget && eventTarget.document)
    || (typeof document!=='undefined'?document:null);
  const pollInterval=Math.max(250,Number(options.pollInterval)||850);
  const feedbackQueue=createInventoryFeedbackQueue();
  let previous=null;
  let active=false;
  let pendingContext=null;
  let visibleEntry=null;
  let holdTimer=0;
  let exitTimer=0;
  let pollTimer=0;

  function readSnapshot(){
    const resources={};
    const specials={};
    for(const def of resourceDefs){
      if(!def || !def.key) continue;
      let value=0;
      try{ value=options.getResourceCount ? options.getResourceCount(def.key) : 0; }catch(e){ value=0; }
      resources[def.key]=finiteCount(value);
    }
    for(const def of specialDefs){
      if(!def || !def.key) continue;
      let value=0;
      try{ value=options.getSpecialCount ? options.getSpecialCount(def.key) : 0; }catch(e){ value=0; }
      specials[def.key]=finiteCount(value);
    }
    let items=[];
    try{
      const raw=options.getItems ? options.getItems() : [];
      items=options.itemsAreSnapshots===true
        ? (Array.isArray(raw)?raw.filter(item=>item && typeof item.id==='string'):[])
        : cloneItems(raw);
    }catch(e){ items=[]; }
    return {resources,specials,items};
  }

  function clearTimers(){
    if(holdTimer) clearTimeout(holdTimer);
    if(exitTimer) clearTimeout(exitTimer);
    holdTimer=0;
    exitTimer=0;
  }

  function visibleText(entry){
    if(entry.type==='batch'){
      return entry.entries.map(item=>{
        const amount=(item.delta>0?'+':'−')+Math.abs(item.delta);
        return amount+' '+item.name;
      }).join(', ')+'.';
    }
    const amount=Math.abs(entry.delta);
    const copy=statusCopy(entry);
    return copy.verb+' '+amount+': '+entry.name+', '+copy.context+'.';
  }

  function makeThumbnail(entry){
    const canvas=document.createElement('canvas');
    canvas.className='inventoryFeedThumb';
    canvas.width=80;
    canvas.height=80;
    canvas.setAttribute('aria-hidden','true');
    let drawn=false;
    try{
      drawn=!!(options.drawThumbnail && options.drawThumbnail(canvas,entry));
    }catch(e){ drawn=false; }
    if(!drawn){
      const g=canvas.getContext && canvas.getContext('2d');
      if(g){
        g.clearRect(0,0,80,80);
        g.fillStyle=entry.color||'#9fb8d1';
        g.beginPath();
        g.moveTo(40,8); g.lineTo(70,25); g.lineTo(70,58);
        g.lineTo(40,74); g.lineTo(10,58); g.lineTo(10,25);
        g.closePath(); g.fill();
        g.fillStyle='rgba(255,255,255,.34)';
        g.beginPath(); g.moveTo(40,8); g.lineTo(70,25); g.lineTo(40,42); g.lineTo(10,25); g.closePath(); g.fill();
      }
    }
    return canvas;
  }

  function renderBatch(row,entry,queueState){
    row.classList.add('inventoryFeedBatch');
    row.dataset.count=String(entry.entries.length);
    const gains=entry.entries.filter(item=>item.delta>0).length;
    const losses=entry.entries.length-gains;
    const title=document.createElement('strong');
    title.className='inventoryFeedBatchTitle';
    title.textContent=gains===entry.entries.length
      ? 'ZDOBYTO'
      : losses===entry.entries.length ? 'UTRACONO' : 'ZMIANY EKWIPUNKU';
    const count=document.createElement('span');
    count.className='inventoryFeedBatchCount';
    count.textContent=entry.entries.length+' POZYCJI';
    const head=document.createElement('div');
    head.className='inventoryFeedBatchHead';
    head.append(title,count);
    if(entry.cause==='death'){
      const cause=document.createElement('span');
      cause.className='inventoryFeedBatchCause';
      cause.textContent=statusCopy({
        cause:'death',
        direction:losses?'loss':'gain',
        deathCause:entry.deathCause
      }).context;
      head.appendChild(cause);
    }
    if(queueState.pending.length){
      const queued=document.createElement('span');
      queued.className='inventoryFeedBatchQueued';
      queued.textContent='DALEJ '+queueState.pending.length;
      head.appendChild(queued);
    }

    const list=document.createElement('div');
    list.className='inventoryFeedBatchList';
    const useMiniThumbs=typeof matchMedia!=='function' || !matchMedia('(max-width:619px)').matches;
    for(const item of entry.entries){
      const line=document.createElement('div');
      line.className='inventoryFeedBatchItem';
      line.dataset.direction=item.direction;
      line.style.setProperty('--inventory-feed-item-accent',item.color||'#9fb8d1');
      const name=document.createElement('span');
      name.className='inventoryFeedBatchName';
      name.textContent=item.name;
      const amount=document.createElement('strong');
      amount.className='inventoryFeedBatchAmount';
      amount.textContent=(item.delta>0?'+':'−')+Math.abs(item.delta);
      if(useMiniThumbs){
        const thumbnail=makeThumbnail(item);
        thumbnail.classList.add('inventoryFeedMiniThumb');
        line.append(thumbnail,name,amount);
      }else line.append(name,amount);
      list.appendChild(line);
    }
    row.append(head,list);
  }

  function renderCurrent(){
    if(!host) return;
    const queueState=feedbackQueue.state();
    const entry=queueState.current;
    if(!entry){
      visibleEntry=null;
      host.replaceChildren();
      host.removeAttribute('data-active');
      return;
    }
    if(visibleEntry===entry) return;
    visibleEntry=entry;
    clearTimers();

    const row=document.createElement('div');
    row.className='inventoryFeedEntry';
    row.dataset.direction=entry.direction;
    row.dataset.type=entry.type;
    if(entry.cause) row.dataset.cause=entry.cause;
    row.style.setProperty('--inventory-feed-accent',entry.color||'#9fb8d1');

    if(entry.type==='batch'){
      renderBatch(row,entry,queueState);
    }else{
      const thumbnail=makeThumbnail(entry);
      const amount=document.createElement('strong');
      amount.className='inventoryFeedAmount';
      amount.textContent=(entry.delta>0?'+':'−')+Math.abs(entry.delta);
      const copy=document.createElement('span');
      copy.className='inventoryFeedCopy';
      const name=document.createElement('span');
      name.className='inventoryFeedName';
      name.textContent=entry.name;
      const meta=document.createElement('span');
      meta.className='inventoryFeedMeta';
      const status=statusCopy(entry);
      const verb=document.createElement('b');
      verb.className='inventoryFeedVerb';
      verb.textContent=status.verb;
      const context=document.createElement('span');
      context.className='inventoryFeedContext';
      context.textContent=status.context;
      meta.append(verb,context);
      if(queueState.pending.length){
        const queued=document.createElement('span');
        queued.className='inventoryFeedQueued';
        queued.textContent='jeszcze '+queueState.pending.length;
        meta.appendChild(queued);
      }
      copy.append(name,meta);
      row.append(thumbnail,copy,amount);
    }
    host.replaceChildren(row);
    host.dataset.active='true';
    host.setAttribute('aria-label',visibleText(entry));

    const show=()=>row.classList.add('show');
    if(typeof requestAnimationFrame==='function') requestAnimationFrame(show);
    else show();
    const holdMs=entry.type==='batch'
      ? Math.min(3200,1800+entry.entries.length*130)
      : Math.min(2200,Math.max(1350,1050+entry.name.length*14));
    holdTimer=setTimeout(()=>{
      holdTimer=0;
      row.classList.remove('show');
      row.classList.add('leaving');
      const reduced=typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      exitTimer=setTimeout(()=>{
        exitTimer=0;
        visibleEntry=null;
        feedbackQueue.finish();
        renderCurrent();
      },reduced?0:230);
    },holdMs);
  }

  function deliverCurrent(){
    if(!publish){
      renderCurrent();
      return;
    }
    // Preserve the proven >5 compacting policy, but hand completed cards to the
    // shared feed immediately. Its own two-second reveal clock is now the only
    // presentation clock, so two independent queues cannot drift or duplicate.
    let guard=0;
    while(guard++<100){
      const queueState=feedbackQueue.state();
      const entry=queueState.current;
      if(!entry) break;
      try{
        publish(entry,queueState);
      }catch(e){
        // A presentation failure must not eat inventory feedback. Leave the
        // current entry in place and fall back to the legacy renderer.
        renderCurrent();
        return;
      }
      feedbackQueue.finish();
    }
    visibleEntry=null;
    if(host){
      host.replaceChildren();
      host.removeAttribute('data-active');
    }
  }

  function sync(detail){
    const next=readSnapshot();
    if(!previous || !active){
      previous=next;
      return [];
    }
    const context=pendingContext || ((detail && detail.inventoryFeedbackContext) || {});
    const entries=diffInventoryFeedback(previous,next,{resourceDefs,specialDefs,tierColors},context);
    previous=next;
    if(entries.length){
      pendingContext=null;
      feedbackQueue.push(entries);
      deliverCurrent();
    }
    return entries;
  }

  function noteDeath(event){
    const detail=event && event.detail || {};
    const context={kind:'death',cause:String(detail.cause||'damage')};
    pendingContext=context;
    const clear=()=>{
      if(pendingContext===context) pendingContext=null;
    };
    if(typeof queueMicrotask==='function') queueMicrotask(clear);
    else Promise.resolve().then(clear);
  }

  function resourceListener(event){ sync(event && event.detail); }
  function inventoryListener(event){ sync(event && event.detail); }
  if(eventTarget && typeof eventTarget.addEventListener==='function'){
    eventTarget.addEventListener('mm-resources-change',resourceListener);
    eventTarget.addEventListener('mm-inventory-change',inventoryListener);
    eventTarget.addEventListener('mm-hero-died',noteDeath);
  }

  function start(){
    previous=readSnapshot();
    active=true;
    if(!pollTimer) pollTimer=setInterval(()=>{
      if(visibilityDoc && visibilityDoc.hidden) return;
      sync();
    },pollInterval);
    return api;
  }
  function reset(opts={}){
    previous=readSnapshot();
    pendingContext=null;
    if(opts.clear!==false){
      clearTimers();
      visibleEntry=null;
      feedbackQueue.clear();
      renderCurrent();
    }
    return api;
  }
  function stop(){
    active=false;
    if(pollTimer) clearInterval(pollTimer);
    pollTimer=0;
    reset();
    return api;
  }
  function destroy(){
    stop();
    if(eventTarget && typeof eventTarget.removeEventListener==='function'){
      eventTarget.removeEventListener('mm-resources-change',resourceListener);
      eventTarget.removeEventListener('mm-inventory-change',inventoryListener);
      eventTarget.removeEventListener('mm-hero-died',noteDeath);
    }
  }
  const api={start,stop,reset,sync,destroy,state:()=>feedbackQueue.state(),isActive:()=>active};
  previous=readSnapshot();
  return api;
}
