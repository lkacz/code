// Hotbar slot picker (keys 5-9/0): assign any placeable block to a slot.
// Replaces the old <details> accordion with a searchable icon grid:
//   - search box with Polish-diacritics folding ("snieg" finds "Śnieg"),
//     ranked results (prefix > word start > substring), Enter = top hit,
//     the matched fragment is highlighted in result labels
//   - category chips (Wszystko / per-group); search + chips stay PINNED above
//     the scrolling grid, section headers are sticky while scrolling
//   - sectioned grid of REAL tile art (painted via MM.drawEntityTile onto
//     pixelated mini-canvases), live counts, dimmed zero-stock, hover/focus
//     states, current assignment ring
//   - "Ostatnie" section: the last-used assignments, persisted per profile
//   - full keyboard flow (arrows walk the grid, Enter assigns, Esc closes,
//     typing anywhere returns to the search box) and touch-sized cards
// Split follows engine/crafting.js: createHotPickerModel is DOM-free and
// covered headless by tools/hot-picker-sim.test.mjs; createHotPicker renders
// into the #hotSelectMenu shell owned by index.html (its sizing styles are
// pinned by inventory-sim — the shell keeps scrolling, the grid lives inside).
// Dismissal note: main.js closes the popover on document POINTERDOWN outside
// the menu — 'click' would fire after chip re-renders detach the target and
// misread an inside press as outside (the popup used to vanish on every chip).

const RECENT_KEY_DEFAULT='mm_hotbar_recent_v1';
const RECENT_CAP=8;

// Fold to a search-comparable form: lowercase + Polish diacritics stripped.
const FOLD_MAP={'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z'};
export function foldText(s){
  return String(s||'').toLowerCase().replace(/[ąćęłńóśźż]/g,ch=>FOLD_MAP[ch]||ch);
}

// score: 3 = label prefix, 2 = word start, 1 = substring (label or internal key)
function matchScore(item,q){
  if(!q) return 1;
  const label=foldText(item.label);
  if(label.startsWith(q)) return 3;
  if(label.includes(' '+q)) return 2;
  if(label.includes(q)) return 1;
  const key=foldText(item.resKey||item.k);
  if(key.startsWith(q)) return 2;
  if(key.includes(q)) return 1;
  return 0;
}

export function createHotPickerModel(opts){
  opts=opts||{};
  const groups=Array.isArray(opts.groups)?opts.groups:[];
  const catalogFn=typeof opts.catalog==='function'?opts.catalog:()=>[];
  const storageKey=opts.storageKey||RECENT_KEY_DEFAULT;
  const storage=opts.storage!==undefined?opts.storage:(typeof localStorage!=='undefined'?localStorage:null);
  const groupByTile=new Map();
  groups.forEach(g=>(g.tiles||[]).forEach(t=>groupByTile.set(t,g.id)));
  function groupOf(k){ return groupByTile.get(k)||'other'; }

  let recent=[];
  try{
    const raw=storage&&storage.getItem(storageKey);
    if(raw){ const arr=JSON.parse(raw); if(Array.isArray(arr)) recent=arr.filter(k=>typeof k==='string').slice(0,RECENT_CAP); }
  }catch(e){ /* private mode: session-only recents */ }
  function persistRecent(){
    try{ if(storage) storage.setItem(storageKey,JSON.stringify(recent)); }catch(e){ /* ignore */ }
  }
  function noteUse(k){
    if(typeof k!=='string'||!k) return;
    recent=[k,...recent.filter(r=>r!==k)].slice(0,RECENT_CAP);
    persistRecent();
  }
  function recents(){ return recent.slice(); }

  function search(query){
    const q=foldText(query).trim();
    const items=catalogFn();
    if(!q) return items;
    return items
      .map((item,i)=>({item,score:matchScore(item,q),i}))
      .filter(e=>e.score>0)
      .sort((a,b)=>b.score-a.score||a.i-b.i)
      .map(e=>e.item);
  }

  // Sections for display. query wins over group filter; groupId 'all' = everything.
  function sections(query,groupId){
    const q=foldText(query).trim();
    if(q){
      const hits=search(q);
      return hits.length?[{id:'results',label:'Wyniki ('+hits.length+')',items:hits}]:[];
    }
    const items=catalogFn();
    const byKey=new Map(items.map(it=>[it.k,it]));
    const grouped=new Map(groups.map(g=>[g.id,[]]));
    items.forEach(it=>{
      const gid=groupOf(it.k);
      if(!grouped.has(gid)) grouped.set(gid,[]);
      grouped.get(gid).push(it);
    });
    const out=[];
    if((!groupId||groupId==='all')){
      const rec=recent.map(k=>byKey.get(k)).filter(Boolean);
      if(rec.length) out.push({id:'recent',label:'Ostatnie',items:rec});
    }
    groups.forEach(g=>{
      if(groupId&&groupId!=='all'&&g.id!==groupId) return;
      const its=grouped.get(g.id)||[];
      if(its.length) out.push({id:g.id,label:g.label,items:its});
    });
    return out;
  }

  return { search, sections, noteUse, recents, groupOf, foldText };
}

// ---------------------------------------------------------------------------
// Popover UI. Text always lands via textContent / createElement (no innerHTML
// on user-influenced strings). Hover/focus/sticky states need real CSS rules,
// so the module installs one <style id="hotPickerCss"> next to the shell.
// ---------------------------------------------------------------------------
const PICKER_CSS=`
#hotSelectMenu .hpCard{ position:relative; display:flex; flex-direction:column; align-items:center; gap:3px;
  background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.14); border-radius:9px;
  color:#e8edf6; cursor:pointer; font:inherit; min-width:0;
  transition:background .12s ease, border-color .12s ease, transform .06s ease; }
#hotSelectMenu .hpCard:hover{ background:rgba(255,255,255,.13); border-color:rgba(255,255,255,.4); transform:translateY(-1px); }
#hotSelectMenu .hpCard:active{ transform:translateY(0) scale(.97); }
#hotSelectMenu .hpCard:focus-visible{ outline:2px solid #7cc4ff; outline-offset:1px; }
#hotSelectMenu .hpCard.hpCur{ outline:2px solid #2c7ef8; background:rgba(44,126,248,.16); }
#hotSelectMenu .hpCard.hpDim{ opacity:.45; }
#hotSelectMenu .hpCard.hpDim:hover, #hotSelectMenu .hpCard.hpDim:focus-visible{ opacity:.85; }
#hotSelectMenu .hpChip{ flex:none; border-radius:999px; padding:3px 10px; font-size:11px; cursor:pointer;
  border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); color:#e8edf6; font:inherit;
  transition:background .12s ease, border-color .12s ease; }
#hotSelectMenu .hpChip:hover{ background:rgba(255,255,255,.14); border-color:rgba(255,255,255,.4); }
#hotSelectMenu .hpChip:focus-visible{ outline:2px solid #7cc4ff; outline-offset:1px; }
#hotSelectMenu .hpChip.on{ border-color:#2c7ef8; background:rgba(44,126,248,.28); }
#hotSelectMenu .hpSecHead{ position:sticky; top:0; z-index:2; font-weight:600; font-size:11px; opacity:.85;
  padding:5px 2px 4px; letter-spacing:.3px; text-transform:uppercase;
  background:linear-gradient(180deg, rgba(15,18,26,.98) 78%, rgba(15,18,26,0)); }
#hotSelectMenu .hpEmpty{ padding:16px 6px; opacity:.7; font-size:12px; text-align:center; cursor:pointer; border-radius:8px; }
#hotSelectMenu .hpEmpty:hover{ background:rgba(255,255,255,.06); opacity:.95; }
#hotSelectMenu .hpMark{ color:#8fd0ff; font-weight:700; }
`;
function ensurePickerCss(){
  if(typeof document==='undefined'||document.getElementById('hotPickerCss')) return;
  const st=document.createElement('style');
  st.id='hotPickerCss';
  st.textContent=PICKER_CSS;
  document.head.appendChild(st);
}

export function createHotPicker(deps){
  deps=deps||{};
  const menu=deps.menu, optionsEl=deps.options, titleEl=deps.title, footEl=deps.foot;
  const model=deps.model;
  const tileSize=Number(deps.tileSize)||20;
  const drawTile=typeof deps.drawTile==='function'?deps.drawTile:null;
  const isTouch=typeof deps.isTouch==='function'?deps.isTouch:()=>false;
  const isGod=typeof deps.isGod==='function'?deps.isGod:()=>false;
  if(!menu||!optionsEl||!model) return null;
  ensurePickerCss();

  const state={open:false, slot:0, anchor:null, query:'', group:'all'};
  const iconCache=new Map(); // tile key -> canvas (art is deterministic per key)
  // Search + chips live in a controls host pinned BETWEEN the title and the
  // scrolling #hotSelectOptions: they must never scroll out of reach.
  let controlsHost=null, searchInput=null, chipHost=null, gridHost=null;

  function tileIcon(item){
    const cached=iconCache.get(item.k);
    if(cached) return cloneIcon(cached);
    const c=document.createElement('canvas');
    c.width=tileSize; c.height=tileSize;
    const g=c.getContext('2d');
    let ok=false;
    if(drawTile){ try{ ok=!!drawTile(g,item,0,0); }catch(e){ ok=false; } }
    if(!ok){
      // fallback swatch: resource color with a simple bevel
      g.fillStyle=item.col||'#9ca3af';
      g.fillRect(0,0,tileSize,tileSize);
      g.fillStyle='rgba(255,255,255,.18)'; g.fillRect(0,0,tileSize,2); g.fillRect(0,0,2,tileSize);
      g.fillStyle='rgba(0,0,0,.25)'; g.fillRect(0,tileSize-2,tileSize,2); g.fillRect(tileSize-2,0,2,tileSize);
    }
    iconCache.set(item.k,c);
    return cloneIcon(c);
  }
  function cloneIcon(src){
    const c=document.createElement('canvas');
    c.width=src.width; c.height=src.height;
    c.getContext('2d').drawImage(src,0,0);
    return c;
  }

  function countInfo(item){
    if(typeof deps.count==='function'){ const v=deps.count(item); if(v&&typeof v==='object') return v; }
    return {text:'',n:0};
  }

  function assignItem(item){
    model.noteUse(item.k);
    if(typeof deps.assign==='function') deps.assign(state.slot,item);
    close();
  }

  function cardButtons(){ return gridHost?[...gridHost.querySelectorAll('button[data-hot-card]')]:[]; }
  function gridColumns(){
    const cards=cardButtons();
    if(cards.length<2) return 1;
    const top0=cards[0].offsetTop;
    let n=1;
    while(n<cards.length&&cards[n].offsetTop===top0) n++;
    return Math.max(1,n);
  }
  function focusCard(idx){
    const cards=cardButtons();
    if(!cards.length) return;
    const i=Math.max(0,Math.min(cards.length-1,idx));
    cards[i].focus();
    cards[i].scrollIntoView({block:'nearest'});
  }
  function onCardKey(e){
    const cards=cardButtons();
    const idx=cards.indexOf(e.currentTarget);
    if(idx<0) return;
    const cols=gridColumns();
    if(e.key==='ArrowRight'){ e.preventDefault(); focusCard(idx+1); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); focusCard(idx-1); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); focusCard(idx+cols); }
    else if(e.key==='ArrowUp'){
      e.preventDefault();
      if(idx-cols<0&&searchInput) searchInput.focus();
      else focusCard(idx-cols);
    }
    else if(e.key==='Escape'){ e.preventDefault(); close(); }
    else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&searchInput){
      // keep typing from anywhere: route the character into the search box
      e.preventDefault();
      searchInput.focus();
      state.query+=e.key;
      searchInput.value=state.query;
      refreshViews();
    }
  }

  // Result labels highlight the folded-match fragment. Folding maps every char
  // 1:1, so an index in the folded string is valid in the original label.
  function labelNode(item){
    const lab=document.createElement('span');
    lab.style.cssText='max-width:100%; font-size:10px; line-height:1.15; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    const q=foldText(state.query).trim();
    const idx=q?foldText(item.label).indexOf(q):-1;
    if(idx<0){ lab.textContent=item.label; return lab; }
    lab.appendChild(document.createTextNode(item.label.slice(0,idx)));
    const b=document.createElement('b');
    b.className='hpMark';
    b.textContent=item.label.slice(idx,idx+q.length);
    lab.appendChild(b);
    lab.appendChild(document.createTextNode(item.label.slice(idx+q.length)));
    return lab;
  }

  function makeCard(item){
    const cur=typeof deps.current==='function'?deps.current(state.slot):null;
    const info=countInfo(item);
    const touch=isTouch();
    const b=document.createElement('button');
    b.type='button';
    b.className='hpCard';
    b.dataset.hotCard=item.k;
    b.title=item.label+(info.text?(' — '+info.text):'');
    b.style.cssText='padding:'+(touch?'8px 3px 6px':'6px 3px 5px')+'; min-height:'+(touch?'62px':'56px')+';'
      +(item.col?' border-color:'+item.col+'66;':'');
    if(cur===item.k){ b.classList.add('hpCur'); b.setAttribute('aria-pressed','true'); }
    if(info.n===0&&info.text!=='∞') b.classList.add('hpDim'); // owned nothing: visible but dimmed
    const icon=tileIcon(item);
    icon.style.cssText='width:'+(touch?34:30)+'px; height:'+(touch?34:30)+'px; image-rendering:pixelated; border-radius:4px; flex:none;';
    b.appendChild(icon);
    b.appendChild(labelNode(item));
    if(info.text){
      const qty=document.createElement('span');
      qty.textContent=info.text;
      qty.style.cssText='position:absolute; top:2px; right:4px; font-size:9px; opacity:.8; background:rgba(0,0,0,.45); border-radius:6px; padding:0 4px;';
      b.appendChild(qty);
    }
    b.addEventListener('click',()=>assignItem(item));
    b.addEventListener('keydown',onCardKey);
    return b;
  }

  function renderChips(){
    chipHost.textContent='';
    // Chips mirror discovery: a category chip appears only once its first block
    // does (sections() already skips empty groups — the chip row follows suit,
    // so a fresh save shows just "Wszystko" and the row grows with knowledge).
    const present=new Set(model.sections('','all').map(s=>s.id));
    const mk=(id,label)=>{
      const c=document.createElement('button');
      c.type='button';
      c.className='hpChip'+((state.group===id&&!state.query)?' on':'');
      c.dataset.hotChip=id;
      c.textContent=label;
      c.addEventListener('click',()=>{
        state.group=id;
        if(state.query){ state.query=''; if(searchInput) searchInput.value=''; }
        refreshViews();
        // the row just re-rendered: put focus back on the pressed chip
        const again=chipHost.querySelector('button[data-hot-chip="'+id+'"]');
        if(again) again.focus();
      });
      chipHost.appendChild(c);
    };
    mk('all','Wszystko');
    (deps.groups||[]).forEach(g=>{ if(present.has(g.id)) mk(g.id,g.label); });
  }

  function renderGrid(){
    gridHost.textContent='';
    const secs=model.sections(state.query,state.group);
    if(!secs.length){
      const empty=document.createElement('div');
      empty.className='hpEmpty';
      if(state.query.trim()){
        empty.textContent='Brak wyników dla „'+state.query+'” — kliknij, aby wyczyścić';
        empty.addEventListener('click',()=>{
          state.query='';
          if(searchInput){ searchInput.value=''; searchInput.focus(); }
          refreshViews();
        });
      } else {
        // fresh save: nothing discovered yet — the empty grid explains itself
        empty.textContent='Nie odkryłeś jeszcze żadnych bloków — wykop pierwszy surowiec!';
      }
      gridHost.appendChild(empty);
      return;
    }
    secs.forEach(sec=>{
      const head=document.createElement('div');
      head.className='hpSecHead';
      head.textContent=sec.label;
      gridHost.appendChild(head);
      const grid=document.createElement('div');
      grid.style.cssText='display:grid; grid-template-columns:repeat(auto-fill,minmax('+(isTouch()?'72px':'64px')+',1fr)); gap:4px; padding-bottom:4px;';
      sec.items.forEach(item=>grid.appendChild(makeCard(item)));
      gridHost.appendChild(grid);
    });
  }

  function refreshViews(){
    renderChips();
    renderGrid();
    optionsEl.scrollTop=0;
  }

  function render(){
    // pinned controls (search + chips) between the title and the scrolling grid
    if(!controlsHost){
      controlsHost=document.createElement('div');
      controlsHost.style.cssText='flex:0 0 auto; display:flex; flex-direction:column; gap:6px; margin-bottom:6px;';
      menu.insertBefore(controlsHost,optionsEl);
    }
    controlsHost.textContent='';
    searchInput=document.createElement('input');
    searchInput.type='text';
    searchInput.placeholder='Szukaj bloku… (Enter = pierwszy wynik)';
    searchInput.setAttribute('aria-label','Szukaj bloku');
    searchInput.style.cssText='width:100%; box-sizing:border-box; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.18);'
      +' border-radius:8px; color:#fff; padding:6px 9px; font-size:12px; outline:none;';
    searchInput.value=state.query;
    searchInput.addEventListener('input',()=>{ state.query=searchInput.value; refreshViews(); });
    searchInput.addEventListener('keydown',e=>{
      if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
      else if(e.key==='Enter'){
        e.preventDefault();
        const first=model.sections(state.query,state.group)[0];
        if(first&&first.items[0]) assignItem(first.items[0]);
      }
      else if(e.key==='ArrowDown'){ e.preventDefault(); focusCard(0); }
    });
    controlsHost.appendChild(searchInput);
    chipHost=document.createElement('div');
    chipHost.style.cssText='display:flex; gap:4px; overflow-x:auto; scrollbar-width:none; padding-bottom:2px; touch-action:pan-x;';
    controlsHost.appendChild(chipHost);
    // grid area — the shell (#hotSelectOptions) owns vertical scrolling
    optionsEl.textContent='';
    gridHost=document.createElement('div');
    gridHost.style.cssText='display:flex; flex-direction:column; min-height:0;';
    optionsEl.appendChild(gridHost);
    refreshViews();
  }

  function position(anchor){
    const rect=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():{left:innerWidth/2,top:innerHeight-90,width:0};
    const vw=Math.max(320,innerWidth||320);
    const width=Math.min(520,vw-16);
    menu.style.width=width+'px';
    menu.style.maxWidth=width+'px';
    const cx=Math.max(width/2+8,Math.min(vw-width/2-8,rect.left+rect.width/2));
    menu.style.display='flex';
    menu.style.left=cx+'px';
    menu.style.top=(rect.top-8)+'px';
    menu.style.transform='translate(-50%,-100%)';
  }

  function open(slot,anchor){
    state.open=true;
    state.slot=slot|0;
    state.anchor=anchor||null;
    state.query='';
    state.group='all';
    const key=typeof deps.keyLabel==='function'?deps.keyLabel(state.slot):String(state.slot);
    menu.setAttribute('role','dialog');
    menu.setAttribute('aria-label','Wybór bloku dla slotu '+key);
    if(titleEl) titleEl.textContent='Slot '+key+' — wybierz blok';
    if(footEl){
      footEl.textContent=isGod()
        ? 'Tryb Boga: pełny katalog, zasoby i skrzynie bez limitu.'
        : 'Widzisz tylko odkryte bloki — zbieraj nowe surowce, aby poszerzyć listę. Skrzynie tylko w trybie Boga.';
    }
    render();
    position(anchor);
    if(!isTouch()&&searchInput) searchInput.focus();
  }

  function close(){
    if(!state.open&&menu.style.display==='none') return;
    state.open=false;
    menu.style.display='none';
    if(searchInput&&document.activeElement===searchInput) searchInput.blur();
  }

  return { open, close, isOpen:()=>state.open, model };
}

const hotPicker={ createHotPickerModel, createHotPicker, foldText };
export default hotPicker;
