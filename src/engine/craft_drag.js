// Drag-to-hotbar layer: drag a placeable resource tile (crafting panel today,
// any panel tomorrow) onto a #hotbarWrap slot to remap that slot — the
// pointer-based sibling of the hot_picker popover. main.js supplies the game
// bindings: live slot elements, the validated MM.hotbar.assign chokepoint,
// real tile art and key labels; this module never touches HOTBAR_ORDER itself.
// One pointer-events path serves mouse AND touch: handles opt out of native
// panning via touch-action:none, a plain tap/click stays a click (drag only
// starts past a movement threshold), and the floating ghost is
// pointer-events:none so elementFromPoint always sees the real drop target.
// Ghost text lands via textContent — no innerHTML on user-influenced strings.

const DRAG_THRESHOLD_PX=6;

const DRAG_CSS=`
.craftDragHandle{ cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none; }
body.mmTileDrag, body.mmTileDrag .craftDragHandle{ cursor:grabbing; }
#craftDragGhost{ position:fixed; left:0; top:0; z-index:3000; pointer-events:none;
  display:flex; align-items:center; gap:6px; padding:4px 9px; white-space:nowrap;
  background:rgba(15,18,26,.94); border:1px solid rgba(124,196,255,.6); border-radius:9px;
  color:#e8edf6; font-size:11px; box-shadow:0 8px 22px rgba(0,0,0,.55);
  transform:translate(-50%,-130%); }
#craftDragGhost .craftDragPreview{ margin-left:2px; padding-left:8px;
  border-left:1px solid rgba(124,196,255,.34); color:#a9d8ff; font-weight:700;
  font-variant-numeric:tabular-nums; }
#craftDragGhost .craftDragPreview[hidden]{ display:none; }
#hotbarWrap.hotDropActive .hotSlot{ outline:1px dashed rgba(124,196,255,.55);
  transition:transform .08s ease, outline-color .08s ease; }
#hotbarWrap.hotDropActive .hotSlot.dropHot{ outline:2px solid #7cc4ff; transform:translateY(-3px) scale(1.06); }
`;
function ensureDragCss(){
  if(typeof document==='undefined'||document.getElementById('craftDragCss')) return;
  const st=document.createElement('style');
  st.id='craftDragCss';
  st.textContent=DRAG_CSS;
  document.head.appendChild(st);
}

export function createCraftDrag(deps){
  deps=deps||{};
  if(typeof document==='undefined') return null;
  const slotsFn=typeof deps.slots==='function'?deps.slots:()=>[];
  const assignFn=typeof deps.assign==='function'?deps.assign:()=>false;
  const slotInfoFn=typeof deps.slotInfo==='function'?deps.slotInfo:null;
  const drawTile=typeof deps.drawTile==='function'?deps.drawTile:null;
  const tileSize=Number(deps.tileSize)||20;
  ensureDragCss();

  let drag=null; // {item, fromEl, pointerId, startX, startY, started, ghost, previewEl, overEl}
  let recentDragUntil=0;
  let recentDragSource=null;

  function hotbarWrap(){ return document.getElementById('hotbarWrap'); }
  function slotAt(x,y){
    const el=document.elementFromPoint(x,y);
    const slot=el&&el.closest?el.closest('.hotSlot'):null;
    if(!slot) return null;
    const idx=slotsFn().indexOf(slot);
    return idx>=0?{el:slot,idx}:null;
  }

  function makeGhost(item){
    const g=document.createElement('div');
    g.id='craftDragGhost';
    const c=document.createElement('canvas');
    c.width=tileSize; c.height=tileSize;
    c.style.cssText='width:22px; height:22px; image-rendering:pixelated; border-radius:4px; flex:none;';
    let ok=false;
    if(drawTile){ try{ ok=!!drawTile(c.getContext('2d'),item); }catch(e){ ok=false; } }
    if(!ok){
      const ctx=c.getContext('2d');
      ctx.fillStyle=item.col||'#9ca3af';
      ctx.fillRect(0,0,tileSize,tileSize);
    }
    g.appendChild(c);
    const lab=document.createElement('span');
    lab.className='craftDragLabel';
    lab.textContent=item.label||'';
    g.appendChild(lab);
    const preview=document.createElement('span');
    preview.className='craftDragPreview';
    preview.setAttribute('role','status');
    preview.setAttribute('aria-live','polite');
    preview.setAttribute('aria-atomic','true');
    preview.hidden=true;
    g.appendChild(preview);
    return {el:g,preview};
  }

  function slotPreviewText(slot){
    if(!slotInfoFn||!slot||!drag) return '';
    let info=null;
    try{ info=slotInfoFn(slot.idx,drag.item); }catch(err){ return ''; }
    if(typeof info==='string'||typeof info==='number') return String(info);
    if(!info||typeof info!=='object') return '';
    const keyLabel=info.keyLabel==null?String(slot.idx+1):String(info.keyLabel);
    const currentLabel=info.currentLabel==null?'Pusty':String(info.currentLabel);
    const fallbackNext=drag.item&&drag.item.label!=null?drag.item.label:'';
    const nextLabel=info.nextLabel==null?String(fallbackNext):String(info.nextLabel);
    return nextLabel?'Slot '+keyLabel+': '+currentLabel+' → '+nextLabel:'';
  }

  function updatePreview(slot){
    if(!drag||!drag.previewEl) return;
    const text=slotPreviewText(slot);
    drag.previewEl.textContent=text;
    drag.previewEl.hidden=!text;
  }

  function setOver(slot){
    const el=slot?slot.el:null;
    if(drag.overEl===el) return;
    if(drag.overEl) drag.overEl.classList.remove('dropHot');
    drag.overEl=el;
    if(el) el.classList.add('dropHot');
    updatePreview(slot);
  }

  function startDrag(){
    drag.started=true;
    const ghost=makeGhost(drag.item);
    drag.ghost=ghost.el;
    drag.previewEl=ghost.preview;
    document.body.appendChild(drag.ghost);
    document.body.classList.add('mmTileDrag');
    const wrap=hotbarWrap();
    if(wrap) wrap.classList.add('hotDropActive');
    document.addEventListener('keydown',onKeyCancel,true);
  }

  function moveGhost(x,y){
    drag.ghost.style.left=x+'px';
    drag.ghost.style.top=y+'px';
  }

  function cleanup(markRecent=false){
    const current=drag;
    if(!current) return;
    if(markRecent && current.started){
      recentDragUntil=Date.now()+600;
      recentDragSource=current.fromEl;
    }
    if(current.overEl) current.overEl.classList.remove('dropHot');
    if(current.ghost&&current.ghost.parentNode) current.ghost.parentNode.removeChild(current.ghost);
    document.body.classList.remove('mmTileDrag');
    const wrap=hotbarWrap();
    if(wrap) wrap.classList.remove('hotDropActive');
    document.removeEventListener('keydown',onKeyCancel,true);
    document.removeEventListener('pointermove',onMove,true);
    document.removeEventListener('pointerup',onUp,true);
    document.removeEventListener('pointercancel',onCancel,true);
    if(typeof window!=='undefined') window.removeEventListener('blur',onWindowBlur,true);
    drag=null;
    try{
      if(current.fromEl.hasPointerCapture && current.fromEl.hasPointerCapture(current.pointerId)){
        current.fromEl.releasePointerCapture(current.pointerId);
      }
    }catch(err){ /* detached sources release capture automatically */ }
  }

  function onKeyCancel(e){
    if(e.key==='Escape'&&drag){ e.preventDefault(); e.stopPropagation(); cleanup(); }
  }

  function onMove(e){
    if(!drag||e.pointerId!==drag.pointerId) return;
    if(!drag.started){
      const dx=e.clientX-drag.startX, dy=e.clientY-drag.startY;
      if(dx*dx+dy*dy<DRAG_THRESHOLD_PX*DRAG_THRESHOLD_PX) return;
      startDrag();
    }
    e.preventDefault();
    moveGhost(e.clientX,e.clientY);
    setOver(slotAt(e.clientX,e.clientY));
  }

  function onUp(e){
    if(!drag||e.pointerId!==drag.pointerId) return;
    const started=drag.started;
    const slot=started?slotAt(e.clientX,e.clientY):null;
    const item=drag.item, fromEl=drag.fromEl;
    cleanup(started);
    if(!started) return; // plain click: let it through untouched
    e.preventDefault();
    // a real drag must not double as a click on the source card
    const suppressClick=ev=>{ ev.stopPropagation(); ev.preventDefault(); };
    fromEl.addEventListener('click',suppressClick,{capture:true,once:true});
    // Some browsers do not synthesize a click after a drag. Do not leave the
    // one-shot listener behind to swallow a legitimate click minutes later.
    setTimeout(()=>{
      fromEl.removeEventListener('click',suppressClick,true);
      if(recentDragSource===fromEl && Date.now()>=recentDragUntil) recentDragSource=null;
    },650);
    if(slot){
      try{ assignFn(slot.idx,item); }catch(err){ /* assignment is optional UI sugar */ }
    }
  }

  function onCancel(e){
    if(!drag||e.pointerId!==drag.pointerId) return;
    cleanup();
  }

  function onWindowBlur(){
    if(!drag) return;
    if(drag.started){ cleanup(); return; }
    // Edge/WebViews can briefly blur the page while a newly pressed control
    // receives focus. Cancelling synchronously loses the first pointermove and
    // makes otherwise valid picker/inventory drags look inert. Keep only the
    // pre-threshold press alive for a short grace period; a genuine focus loss
    // still self-cleans, while pointerup/pointercancel clears it sooner.
    const pending=drag;
    setTimeout(()=>{
      if(drag===pending && !pending.started) cleanup();
    },250);
  }

  // itemFn resolves lazily at pointerdown: {k:<tile name>, label, col?}
  function makeDraggable(el,itemFn){
    el.classList.add('craftDragHandle');
    el.addEventListener('pointerdown',e=>{
      if(drag) return;
      if(e.button!=null&&e.button!==0) return;
      if(e.isPrimary===false) return;
      const item=typeof itemFn==='function'?itemFn():itemFn;
      if(!item||!item.k) return;
      drag={
        item,
        fromEl:el,
        pointerId:e.pointerId,
        startX:e.clientX,
        startY:e.clientY,
        started:false,
        ghost:null,
        previewEl:null,
        overEl:null
      };
      // Capture is preferred, but document listeners keep the gesture alive if
      // the feed/picker re-renders and detaches its source before pointerup.
      document.addEventListener('pointermove',onMove,true);
      document.addEventListener('pointerup',onUp,true);
      document.addEventListener('pointercancel',onCancel,true);
      if(typeof window!=='undefined') window.addEventListener('blur',onWindowBlur,true);
      try{ el.setPointerCapture(e.pointerId); }catch(err){ /* capture optional */ }
    });
    return el;
  }

  return {
    makeDraggable,
    // Includes the short pre-threshold phase. Consumers that re-render their
    // source UI can use this to avoid replacing the element mid-gesture.
    active:()=>!!drag,
    dragging:()=>!!(drag&&drag.started),
    // Suppress only the synthetic click belonging to the source that just
    // finished dragging. A quick tap on a different resource stays responsive.
    recentlyDragged:el=>Date.now()<recentDragUntil && (!el || el===recentDragSource),
    cancel:()=>{ if(drag) cleanup(); }
  };
}

const craftDrag={ createCraftDrag };
export default craftDrag;
