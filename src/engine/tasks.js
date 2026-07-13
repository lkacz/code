// Persistent task tracker: lightweight objectives, optional world targets, and
// one shared red off-screen pointer for urgent trackable tasks.
const tasks = (function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const active = new Map();
  const discarded = new Map();
  const history = [];
  const MAX_ACTIVE = 160;
  const MAX_DISCARDED = 160;
  const MAX_HISTORY = 80;
  let priorityTaskId = '';
  let context = {};
  let uiBound = false;
  let taskListOpen = false;
  let lastListSignature = '';
  let lastHudAt = 0;
  let lastHudText = '';
  let lastHudTitle = '';

  function nowMs(){ return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function nowStamp(){ return Date.now ? Date.now() : Math.floor(nowMs()); }
  function finite(v){ return typeof v === 'number' && Number.isFinite(v); }
  function num(v, fallback){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(v,a,b){ return v < a ? a : (v > b ? b : v); }
  function cleanText(v, fallback, maxLen){
    const s = (v == null ? '' : String(v)).trim();
    const out = s || (fallback || '');
    return out.slice(0, maxLen || 96);
  }
  function cleanTarget(src){
    if(!src || typeof src !== 'object') return null;
    const x = num(src.x, NaN);
    const y = num(src.y, NaN);
    if(!finite(x) || !finite(y)) return null;
    const target = {x:+x.toFixed(3), y:+y.toFixed(3)};
    if(src.label) target.label = cleanText(src.label, '', 64);
    return target;
  }
  function baseTaskId(src){
    if(!src || typeof src !== 'object') return '';
    const direct = cleanText(src.id, '', 80);
    if(direct) return direct;
    const source = cleanText(src.source, 'task', 32);
    const kind = cleanText(src.kind, 'objective', 32);
    const key = cleanText(src.key, '', 48);
    return key ? source+':'+kind+':'+key : '';
  }
  function serializeTask(t){
    const out = {
      id:t.id,
      kind:t.kind,
      source:t.source,
      title:t.title,
      detail:t.detail,
      status:t.status,
      priority:t.priority,
      pointer:!!t.pointer,
      createdAt:t.createdAt,
      updatedAt:t.updatedAt
    };
    if(t.target) out.target = Object.assign({}, t.target);
    if(t.completedAt) out.completedAt = t.completedAt;
    if(t.discardedAt) out.discardedAt = t.discardedAt;
    if(t.firstSeenAt) out.firstSeenAt = t.firstSeenAt;
    return out;
  }
  function normalizeTask(src){
    if(!src || typeof src !== 'object') return null;
    const id = baseTaskId(src);
    if(!id) return null;
    const prev = active.get(id) || null;
    const srcTarget = cleanTarget(src.target) || cleanTarget(src);
    const target = srcTarget || (prev && prev.target ? cleanTarget(prev.target) : null);
    const status = src.status === 'done' || src.status === 'completed'
      ? 'done'
      : (src.status === 'discarded' ? 'discarded' : 'active');
    const n = nowStamp();
    return {
      id,
      kind:cleanText(src.kind || (prev && prev.kind), 'task', 32),
      source:cleanText(src.source || (prev && prev.source), 'system', 32),
      title:cleanText(src.title || (prev && prev.title), 'Zadanie', 80),
      detail:cleanText(src.detail || (prev && prev.detail), '', 140),
      status,
      priority:clamp(Math.round(num(src.priority, prev ? prev.priority : 10)), -100, 100),
      pointer:!!(target && src.pointer !== false),
      target,
      createdAt:Math.max(0, Math.floor(num(src.createdAt, prev ? prev.createdAt : n))),
      updatedAt:Math.max(0, Math.floor(num(src.updatedAt, n))),
      completedAt:status === 'done' ? Math.max(0, Math.floor(num(src.completedAt, n))) : 0,
      discardedAt:status === 'discarded' ? Math.max(0, Math.floor(num(src.discardedAt, n))) : 0,
      firstSeenAt:Math.max(0, Math.floor(num(src.firstSeenAt, prev ? prev.firstSeenAt : n)))
    };
  }
  function trimActive(){
    if(active.size <= MAX_ACTIVE) return;
    const list = activeList();
    while(active.size > MAX_ACTIVE && list.length){
      const t = list.pop();
      if(t) active.delete(t.id);
    }
  }
  function trimDiscarded(){
    if(discarded.size <= MAX_DISCARDED) return;
    const list = Array.from(discarded.values()).sort((a,b)=>(b.discardedAt || 0) - (a.discardedAt || 0));
    while(discarded.size > MAX_DISCARDED && list.length){
      const t = list.pop();
      if(t) discarded.delete(t.id);
    }
  }
  function pushHistory(task){
    if(!task) return;
    for(let i=history.length-1;i>=0;i--){
      if(history[i] && history[i].id === task.id) history.splice(i,1);
    }
    history.unshift(serializeTask(task));
    while(history.length > MAX_HISTORY) history.pop();
  }
  function playerRef(player){
    return player || root.player || MM.player || null;
  }
  function distanceToTask(task, player){
    const p = playerRef(player);
    if(!task || !task.target || !p || !finite(num(p.x, NaN)) || !finite(num(p.y, NaN))) return Infinity;
    return Math.hypot(task.target.x - Number(p.x), task.target.y - Number(p.y));
  }
  function activeList(player){
    const p = playerRef(player);
    const out = Array.from(active.values()).filter(t=>t && t.status === 'active').map(t=>{
      const view = serializeTask(t);
      view.isPriority = t.id === priorityTaskId;
      return view;
    });
    out.sort((a,b)=>compareTaskOrder(a,b,p));
    return out;
  }
  function compareTaskOrder(a,b,player){
    const userPriority = Number(!!(b && b.isPriority)) - Number(!!(a && a.isPriority));
    if(userPriority) return userPriority;
    const dp = ((b && b.priority) || 0) - ((a && a.priority) || 0);
    if(dp) return dp;
    const da = distanceToTask(a,player);
    const db = distanceToTask(b,player);
    if(da !== db) return da - db;
    return ((a && a.createdAt) || 0) - ((b && b.createdAt) || 0);
  }
  function upsert(src){
    const task = normalizeTask(src);
    if(!task) return null;
    if(task.status === 'done'){
      active.delete(task.id);
      discarded.delete(task.id);
      if(priorityTaskId === task.id) priorityTaskId = '';
      pushHistory(task);
      updateHud();
      const result=serializeTask(task);
      notifyChange('complete', result);
      return result;
    }
    // A discarded objective stays dismissed when its source periodically
    // re-publishes it. It is released when that source completes/removes it.
    if(discarded.has(task.id)) return serializeTask(discarded.get(task.id));
    active.set(task.id, task);
    trimActive();
    updateHud();
    return serializeTask(task);
  }
  function complete(id, opts){
    const taskId = cleanText(id, '', 80);
    if(!taskId) return false;
    const existing = active.get(taskId) || discarded.get(taskId);
    if(!existing) return false;
    active.delete(taskId);
    discarded.delete(taskId);
    if(priorityTaskId === taskId) priorityTaskId = '';
    const completedAt=nowStamp();
    const done = Object.assign({}, existing, {
      status:'done',
      updatedAt:completedAt,
      completedAt,
      discardedAt:0
    });
    pushHistory(done);
    updateHud();
    notifyChange('complete', serializeTask(done));
    if(opts && opts.message){
      try{ if(root.msg) root.msg(opts.message); }catch(e){}
    }
    return true;
  }
  function remove(id){
    const taskId = cleanText(id, '', 80);
    const existing = active.get(taskId) || discarded.get(taskId) || null;
    if(!existing) return false;
    active.delete(taskId);
    discarded.delete(taskId);
    if(priorityTaskId === taskId) priorityTaskId = '';
    updateHud();
    notifyChange('remove', serializeTask(existing));
    return true;
  }
  function discard(id){
    const taskId = cleanText(id, '', 80);
    const existing = active.get(taskId);
    if(!existing) return false;
    active.delete(taskId);
    if(priorityTaskId === taskId) priorityTaskId = '';
    const dismissed = Object.assign({}, existing, {
      status:'discarded',
      updatedAt:nowStamp(),
      discardedAt:nowStamp()
    });
    discarded.set(taskId, dismissed);
    trimDiscarded();
    lastListSignature = '';
    updateHud();
    notifyChange('discard', serializeTask(dismissed));
    return true;
  }
  function setPriority(id){
    const nextId = cleanText(id, '', 80);
    if(nextId && !active.has(nextId)) return false;
    if(priorityTaskId === nextId) return true;
    priorityTaskId = nextId;
    lastListSignature = '';
    updateHud();
    notifyChange('priority', nextId ? serializeTask(active.get(nextId)) : null);
    return true;
  }
  function togglePriority(id){
    const taskId = cleanText(id, '', 80);
    if(!taskId || !active.has(taskId)) return false;
    return setPriority(priorityTaskId === taskId ? '' : taskId);
  }
  function removeSource(source){
    const src = cleanText(source, '', 32);
    if(!src) return 0;
    let removed = 0;
    for(const t of Array.from(active.values())){
      if(t && t.source === src){
        active.delete(t.id);
        removed++;
      }
    }
    for(const t of Array.from(discarded.values())){
      if(t && t.source === src){
        discarded.delete(t.id);
        removed++;
      }
    }
    if(priorityTaskId && !active.has(priorityTaskId)) priorityTaskId = '';
    if(removed){
      lastListSignature = '';
      updateHud();
      notifyChange('remove-source', {source:src, removed});
    }
    return removed;
  }
  function cacheTaskId(cacheOrId){
    const raw = typeof cacheOrId === 'string' ? cacheOrId : (cacheOrId && cacheOrId.id);
    const id = cleanText(raw, '', 64);
    return id ? 'invasion_cache:'+id : '';
  }
  function cacheDetail(cache){
    const parts = [];
    let resources = 0;
    for(const k in (cache && cache.resources) || {}) resources += Math.max(0, Math.floor(Number(cache.resources[k]) || 0));
    const gear = Array.isArray(cache && cache.gear) ? cache.gear.length : 0;
    if(resources) parts.push(resources+' zasobow');
    if(gear) parts.push(gear+' przedm.');
    return parts.length ? 'Skrytka obcych: '+parts.join(', ') : 'Skrytka obcych';
  }
  function upsertAlienCache(cache){
    if(!cache) return null;
    const id = cacheTaskId(cache);
    if(!id) return null;
    return upsert({
      id,
      source:'invasions',
      kind:'recovery',
      title:'Odzyskaj skradziony lup',
      detail:cacheDetail(cache),
      priority:90,
      pointer:true,
      target:{x:Math.floor(num(cache.x,0))+0.5, y:Math.floor(num(cache.y,0))+0.5, label:'Skrytka obcych'},
      createdAt:num(cache.createdAt, nowStamp())
    });
  }
  function completeAlienCache(cacheOrId){
    const id = cacheTaskId(cacheOrId);
    return id ? complete(id) : false;
  }
  function syncAlienCaches(caches){
    const keep = new Set();
    if(Array.isArray(caches)){
      for(const cache of caches){
        const id = cacheTaskId(cache);
        if(id){
          keep.add(id);
          upsertAlienCache(cache);
        }
      }
    }
    let removed = 0;
    for(const t of Array.from(active.values())){
      if(t && t.source === 'invasions' && t.kind === 'recovery' && !keep.has(t.id)){
        active.delete(t.id);
        removed++;
      }
    }
    for(const t of Array.from(discarded.values())){
      if(t && t.source === 'invasions' && t.kind === 'recovery' && !keep.has(t.id)){
        discarded.delete(t.id);
        removed++;
      }
    }
    if(priorityTaskId && !active.has(priorityTaskId)) priorityTaskId = '';
    if(removed){
      lastListSignature = '';
      updateHud();
      notifyChange('sync', {source:'invasions', removed});
    }
    return keep.size;
  }
  function trackedTarget(player){
    if(priorityTaskId){
      const selected = active.get(priorityTaskId);
      if(!selected){
        priorityTaskId = '';
        lastListSignature = '';
        notifyChange('priority', null);
      }
      else if(!selected.pointer || !selected.target) return null;
      else {
        const task = serializeTask(selected);
        task.isPriority = true;
        return {
          task,
          x:selected.target.x,
          y:selected.target.y,
          dist:distanceToTask(selected, player)
        };
      }
    }
    // This path runs every rendered frame. Select the best trackable task in
    // one pass instead of cloning and sorting the complete task list at 60+ FPS.
    const p=playerRef(player);
    let selected=null;
    for(const task of active.values()){
      if(!task || task.status!=='active' || !task.pointer || !task.target) continue;
      if(!selected || compareTaskOrder(task,selected,p)<0) selected=task;
    }
    if(!selected) return null;
    const task = serializeTask(selected);
    return {
      task,
      x:selected.target.x,
      y:selected.target.y,
      dist:distanceToTask(selected, p)
    };
  }
  function formatDistance(d){
    if(!Number.isFinite(d)) return '';
    if(d >= 1000) return (d/1000).toFixed(d >= 10000 ? 0 : 1)+'km';
    return Math.max(0, Math.round(d))+'m';
  }
  function drawHUD(ctx,W,H,camX,camY,zoom,tileSize,_canDrawTile,player){
    const target = trackedTarget(player);
    if(!target || !ctx) return false;
    const tile = Number(tileSize) || MM.TILE || 20;
    const z = Number(zoom) || 1;
    const sx = (target.x - (Number(camX) || 0)) * tile * z;
    const sy = (target.y - (Number(camY) || 0)) * tile * z;
    if(!Number.isFinite(sx) || !Number.isFinite(sy)) return false;
    const margin = 40;
    if(sx > margin && sx < W - margin && sy > margin && sy < H - margin) return false;
    const cx = W / 2;
    const cy = H / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const edge = Math.max(24, Math.min(W,H) / 2 - 46);
    const ex = cx + Math.cos(ang) * edge;
    const ey = cy + Math.sin(ang) * edge;
    const pulse = 0.62 + 0.38 * Math.sin(nowMs() * 0.005);
    const distanceLabel = formatDistance(target.dist);
    const label = target.task && target.task.isPriority && distanceLabel ? '★ '+distanceLabel : distanceLabel;
    const labelW = Math.max(52, Math.min(96, label.length * 7 + 18));
    ctx.save();
    ctx.translate(ex,ey);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,60,80,'+pulse.toFixed(2)+')';
    ctx.beginPath();
    ctx.moveTo(14,0);
    ctx.lineTo(-8,-9);
    ctx.lineTo(-8,9);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-ang);
    if(label){
      ctx.fillStyle = 'rgba(0,0,0,0.58)';
      ctx.fillRect(-labelW/2,14,labelW,16);
      ctx.fillStyle = '#fff';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(label,0,26);
    }
    ctx.restore();
    return true;
  }
  function setContext(next){
    context = next && typeof next === 'object' ? next : {};
    return true;
  }
  function notifyChange(kind, task){
    try{
      if(context && typeof context.onChange === 'function') context.onChange({kind, task});
    }catch(e){}
  }
  function sourceLabel(source){
    if(source === 'story') return 'Fabuła';
    if(source === 'invasions') return 'Inwazja';
    if(source === 'tutorial') return 'Samouczek';
    return cleanText(source, 'Zadanie', 28);
  }
  function setTaskListOpen(open){
    const doc = root.document;
    if(!doc || !doc.getElementById) return false;
    const trigger = doc.getElementById('taskPanel');
    const panel = doc.getElementById('taskListPanel');
    if(!trigger || !panel) return false;
    taskListOpen = !!open && active.size > 0;
    panel.hidden = !taskListOpen;
    if(trigger.setAttribute) trigger.setAttribute('aria-expanded', taskListOpen ? 'true' : 'false');
    if(taskListOpen){
      renderTaskList(playerRef());
      const close = doc.getElementById('taskListClose');
      if(close && close.focus) close.focus({preventScroll:true});
    }else if(trigger.focus && open === false){
      trigger.focus({preventScroll:true});
    }
    return taskListOpen;
  }
  function taskActionButton(doc, action, task, label, className){
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'taskAction '+className;
    button.dataset.action = action;
    button.dataset.taskId = task.id;
    button.textContent = label;
    if(action === 'priority'){
      button.setAttribute('aria-pressed', task.isPriority ? 'true' : 'false');
      button.title = task.target
        ? (task.isPriority ? 'Usuń priorytet i zwolnij czerwoną strzałkę' : 'Pokazuj ten cel czerwoną strzałką')
        : 'To zadanie nie ma lokalizacji, ale może pozostać na górze listy';
    }
    return button;
  }
  function renderTaskList(player){
    const doc = root.document;
    if(!doc || !doc.getElementById || !doc.createElement) return;
    const host = doc.getElementById('taskList');
    const count = doc.getElementById('taskListCount');
    if(!host) return;
    const list = activeList(player);
    const signature = list.map(t=>{
      const d = distanceToTask(t, player);
      return [t.id,t.title,t.detail,t.isPriority ? 1 : 0,Number.isFinite(d) ? Math.round(d) : '-'].join('|');
    }).join('::');
    if(signature === lastListSignature && host.childNodes && host.childNodes.length === list.length) return;
    lastListSignature = signature;
    if(count) count.textContent = String(list.length);
    while(host.firstChild) host.removeChild(host.firstChild);
    for(const task of list){
      const item = doc.createElement('article');
      item.className = 'taskItem'+(task.isPriority ? ' priority' : '');
      item.dataset.taskId = task.id;

      const copy = doc.createElement('div');
      copy.className = 'taskCopy';
      const title = doc.createElement('strong');
      title.className = 'taskTitle';
      title.textContent = (task.isPriority ? '★ ' : '')+task.title;
      copy.appendChild(title);
      if(task.detail){
        const detail = doc.createElement('p');
        detail.className = 'taskDetail';
        detail.textContent = task.detail;
        copy.appendChild(detail);
      }
      const meta = doc.createElement('div');
      meta.className = 'taskMeta';
      const dist = distanceToTask(task, player);
      const location = Number.isFinite(dist) ? 'Cel na mapie · '+formatDistance(dist) : 'Brak lokalizacji';
      meta.textContent = sourceLabel(task.source)+' · '+location;
      copy.appendChild(meta);
      item.appendChild(copy);

      const actions = doc.createElement('div');
      actions.className = 'taskActions';
      actions.appendChild(taskActionButton(doc,'priority',task,task.isPriority ? '★ Priorytet' : '☆ Ustaw priorytet','taskPriority'));
      actions.appendChild(taskActionButton(doc,'discard',task,'Odrzuć','taskDiscard'));
      item.appendChild(actions);
      host.appendChild(item);
    }
  }
  function bindTaskUi(){
    if(uiBound) return;
    const doc = root.document;
    if(!doc || !doc.getElementById) return;
    const trigger = doc.getElementById('taskPanel');
    const listPanel = doc.getElementById('taskListPanel');
    const list = doc.getElementById('taskList');
    const close = doc.getElementById('taskListClose');
    if(!trigger || !listPanel || !list || typeof trigger.addEventListener !== 'function') return;
    uiBound = true;
    trigger.addEventListener('click',()=>setTaskListOpen(!taskListOpen));
    if(close) close.addEventListener('click',()=>setTaskListOpen(false));
    list.addEventListener('click',event=>{
      const button = event.target && event.target.closest ? event.target.closest('button[data-action][data-task-id]') : null;
      if(!button) return;
      const id = button.dataset.taskId || '';
      if(button.dataset.action === 'priority') togglePriority(id);
      else if(button.dataset.action === 'discard') discard(id);
      if(active.size < 1) setTaskListOpen(false);
      else renderTaskList(playerRef());
    });
    if(typeof doc.addEventListener === 'function'){
      doc.addEventListener('keydown',event=>{
        if(event.key === 'Escape' && taskListOpen){ event.preventDefault(); setTaskListOpen(false); }
      });
      doc.addEventListener('pointerdown',event=>{
        if(!taskListOpen) return;
        const target = event.target;
        if((listPanel.contains && listPanel.contains(target)) || (trigger.contains && trigger.contains(target))) return;
        setTaskListOpen(false);
      });
    }
  }
  function updateHud(player){
    const doc = root.document;
    if(!doc || !doc.getElementById) return;
    bindTaskUi();
    const now = nowMs();
    if(player && now - lastHudAt < 250) return;
    lastHudAt = now;
    const panel = doc.getElementById('taskPanel');
    const status = doc.getElementById('taskStatus');
    if(!panel || !status) return;
    const list = activeList(player);
    if(!list.length){
      if(taskListOpen) setTaskListOpen(false);
      panel.hidden = true;
      lastHudText = '';
      lastHudTitle = '';
      status.textContent = '';
      status.title = '';
      return;
    }
    const first = list[0];
    const dist = distanceToTask(first, player);
    const distText = Number.isFinite(dist) ? ' '+formatDistance(dist) : '';
    const more = list.length > 1 ? ' +'+(list.length-1) : '';
    const text = 'Zadania '+list.length+' - '+(first.isPriority ? '★ ' : '')+first.title+distText+more;
    const title = list.map(t=>{
      const d = distanceToTask(t, player);
      return t.title+(Number.isFinite(d) ? ' ('+formatDistance(d)+')' : '')+(t.detail ? ' - '+t.detail : '');
    }).join('\n');
    panel.hidden = false;
    if(text !== lastHudText){ lastHudText = text; status.textContent = text; }
    if(title !== lastHudTitle){ lastHudTitle = title; status.title = title; panel.title = title; }
    if(taskListOpen) renderTaskList(player);
  }
  function snapshot(){
    return {
      v:2,
      active:activeList().slice(0,MAX_ACTIVE),
      discarded:Array.from(discarded.values()).slice(0,MAX_DISCARDED).map(serializeTask),
      priorityId:priorityTaskId || '',
      history:history.slice(0,MAX_HISTORY).map(t=>Object.assign({}, t))
    };
  }
  function restore(data){
    active.clear();
    discarded.clear();
    history.length = 0;
    priorityTaskId = '';
    if(!data || typeof data !== 'object'){
      updateHud();
      return false;
    }
    const savedActive = Array.isArray(data.active) ? data.active : (Array.isArray(data.tasks) ? data.tasks : []);
    for(const src of savedActive.slice(0,MAX_ACTIVE)){
      const task = normalizeTask(src);
      if(task && task.status === 'active') active.set(task.id, task);
      else if(task) pushHistory(task);
    }
    if(Array.isArray(data.discarded)){
      for(const src of data.discarded.slice(0,MAX_DISCARDED)){
        const task = normalizeTask(Object.assign({}, src, {status:'discarded'}));
        if(task){
          active.delete(task.id); // corrupted saves cannot make one task both active and discarded
          discarded.set(task.id, task);
        }
      }
    }
    if(Array.isArray(data.history)){
      // Snapshots are newest-first; pushHistory unshifts, so restore backwards
      // to preserve the visible/history ordering exactly.
      for(const src of data.history.slice(0,MAX_HISTORY).reverse()){
        const task = normalizeTask(Object.assign({}, src, {status:'done'}));
        if(task) pushHistory(task);
      }
    }
    trimActive();
    trimDiscarded();
    const savedPriorityId = cleanText(data.priorityId, '', 80);
    if(savedPriorityId && active.has(savedPriorityId)) priorityTaskId = savedPriorityId;
    lastListSignature = '';
    updateHud();
    return true;
  }
  function reset(){
    active.clear();
    discarded.clear();
    history.length = 0;
    priorityTaskId = '';
    lastListSignature = '';
    updateHud();
  }
  function metrics(){
    let trackable = 0;
    for(const t of active.values()) if(t && t.pointer && t.target) trackable++;
    return {active:active.size, discarded:discarded.size, history:history.length, trackable, priorityId:priorityTaskId || ''};
  }
  function state(){
    return {
      active:activeList(),
      discarded:Array.from(discarded.values()).map(serializeTask),
      priorityId:priorityTaskId || '',
      history:history.map(t=>Object.assign({}, t))
    };
  }

  const api = {
    upsert,
    complete,
    remove,
    discard,
    setPriority,
    togglePriority,
    removeSource,
    activeList,
    trackedTarget,
    drawHUD,
    updateHud,
    snapshot,
    restore,
    reset,
    metrics,
    state,
    upsertAlienCache,
    completeAlienCache,
    syncAlienCaches,
    setContext
  };
  MM.tasks = api;
  return api;
})();

export { tasks };
export default tasks;
