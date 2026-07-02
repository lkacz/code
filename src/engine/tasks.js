// Persistent task tracker: lightweight objectives, optional world targets, and
// one shared red off-screen pointer for urgent trackable tasks.
const tasks = (function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const active = new Map();
  const history = [];
  const MAX_ACTIVE = 160;
  const MAX_HISTORY = 80;
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
    const status = src.status === 'done' || src.status === 'completed' ? 'done' : 'active';
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
    const out = Array.from(active.values()).filter(t=>t && t.status === 'active').map(serializeTask);
    out.sort((a,b)=>{
      const dp = (b.priority || 0) - (a.priority || 0);
      if(dp) return dp;
      const da = distanceToTask(a,p);
      const db = distanceToTask(b,p);
      if(da !== db) return da - db;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    return out;
  }
  function upsert(src){
    const task = normalizeTask(src);
    if(!task) return null;
    if(task.status === 'done'){
      active.delete(task.id);
      pushHistory(task);
      updateHud();
      return serializeTask(task);
    }
    active.set(task.id, task);
    trimActive();
    updateHud();
    return serializeTask(task);
  }
  function complete(id, opts){
    const taskId = cleanText(id, '', 80);
    if(!taskId) return false;
    const existing = active.get(taskId);
    if(!existing) return false;
    active.delete(taskId);
    const done = Object.assign({}, existing, {
      status:'done',
      updatedAt:nowStamp(),
      completedAt:nowStamp()
    });
    pushHistory(done);
    updateHud();
    if(opts && opts.message){
      try{ if(root.msg) root.msg(opts.message); }catch(e){}
    }
    return true;
  }
  function remove(id){
    const taskId = cleanText(id, '', 80);
    const ok = active.delete(taskId);
    if(ok) updateHud();
    return ok;
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
    if(removed) updateHud();
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
    if(removed) updateHud();
    return keep.size;
  }
  function trackedTarget(player){
    const list = activeList(player).filter(t=>t.pointer && t.target);
    if(!list.length) return null;
    const task = list[0];
    return {
      task,
      x:task.target.x,
      y:task.target.y,
      dist:distanceToTask(task, player)
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
    const label = formatDistance(target.dist);
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
  function updateHud(player){
    const doc = root.document;
    if(!doc || !doc.getElementById) return;
    const now = nowMs();
    if(player && now - lastHudAt < 250) return;
    lastHudAt = now;
    const panel = doc.getElementById('taskPanel');
    const status = doc.getElementById('taskStatus');
    if(!panel || !status) return;
    const list = activeList(player);
    if(!list.length){
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
    const text = 'Zadania '+list.length+' - '+first.title+distText+more;
    const title = list.map(t=>{
      const d = distanceToTask(t, player);
      return t.title+(Number.isFinite(d) ? ' ('+formatDistance(d)+')' : '')+(t.detail ? ' - '+t.detail : '');
    }).join('\n');
    panel.hidden = false;
    if(text !== lastHudText){ lastHudText = text; status.textContent = text; }
    if(title !== lastHudTitle){ lastHudTitle = title; status.title = title; panel.title = title; }
  }
  function snapshot(){
    return {
      v:1,
      active:activeList().slice(0,MAX_ACTIVE),
      history:history.slice(0,MAX_HISTORY).map(t=>Object.assign({}, t))
    };
  }
  function restore(data){
    active.clear();
    history.length = 0;
    if(!data || typeof data !== 'object'){
      updateHud();
      return false;
    }
    const savedActive = Array.isArray(data.active) ? data.active : (Array.isArray(data.tasks) ? data.tasks : []);
    for(const src of savedActive){
      const task = normalizeTask(src);
      if(task && task.status === 'active') active.set(task.id, task);
      else if(task) pushHistory(task);
    }
    if(Array.isArray(data.history)){
      for(const src of data.history){
        const task = normalizeTask(Object.assign({}, src, {status:'done'}));
        if(task) pushHistory(task);
      }
    }
    trimActive();
    updateHud();
    return true;
  }
  function reset(){
    active.clear();
    history.length = 0;
    updateHud();
  }
  function metrics(){
    let trackable = 0;
    for(const t of active.values()) if(t && t.pointer && t.target) trackable++;
    return {active:active.size, history:history.length, trackable};
  }
  function state(){
    return {
      active:activeList(),
      history:history.map(t=>Object.assign({}, t))
    };
  }

  const api = {
    upsert,
    complete,
    remove,
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
    syncAlienCaches
  };
  MM.tasks = api;
  return api;
})();

export { tasks };
export default tasks;
