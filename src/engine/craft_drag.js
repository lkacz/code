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
  const drawTile=typeof deps.drawTile==='function'?deps.drawTile:null;
  const tileSize=Number(deps.tileSize)||20;
  ensureDragCss();

  let drag=null; // {item, fromEl, startX, startY, started, ghost, overEl}

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
    lab.textContent=item.label||'';
    g.appendChild(lab);
    return g;
  }

  function setOver(slot){
    const el=slot?slot.el:null;
    if(drag.overEl===el) return;
    if(drag.overEl) drag.overEl.classList.remove('dropHot');
    drag.overEl=el;
    if(el) el.classList.add('dropHot');
  }

  function startDrag(){
    drag.started=true;
    drag.ghost=makeGhost(drag.item);
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

  function cleanup(){
    if(drag&&drag.overEl) drag.overEl.classList.remove('dropHot');
    if(drag&&drag.ghost&&drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    document.body.classList.remove('mmTileDrag');
    const wrap=hotbarWrap();
    if(wrap) wrap.classList.remove('hotDropActive');
    document.removeEventListener('keydown',onKeyCancel,true);
    drag=null;
  }

  function onKeyCancel(e){
    if(e.key==='Escape'&&drag){ e.preventDefault(); e.stopPropagation(); cleanup(); }
  }

  function onMove(e){
    if(!drag||e.target!==drag.fromEl) return;
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
    if(!drag||e.target!==drag.fromEl) return;
    const started=drag.started;
    const slot=started?slotAt(e.clientX,e.clientY):null;
    const item=drag.item, fromEl=drag.fromEl;
    cleanup();
    if(!started) return; // plain click: let it through untouched
    e.preventDefault();
    // a real drag must not double as a click on the source card
    fromEl.addEventListener('click',ev=>{ ev.stopPropagation(); ev.preventDefault(); },{capture:true,once:true});
    if(slot) assignFn(slot.idx,item);
  }

  function onCancel(e){
    if(!drag||e.target!==drag.fromEl) return;
    cleanup();
  }

  // itemFn resolves lazily at pointerdown: {k:<tile name>, label, col?}
  function makeDraggable(el,itemFn){
    el.classList.add('craftDragHandle');
    el.addEventListener('pointerdown',e=>{
      if(drag) return;
      if(e.button!=null&&e.button!==0) return;
      const item=typeof itemFn==='function'?itemFn():itemFn;
      if(!item||!item.k) return;
      drag={item,fromEl:el,startX:e.clientX,startY:e.clientY,started:false,ghost:null,overEl:null};
      try{ el.setPointerCapture(e.pointerId); }catch(err){ /* capture optional */ }
    });
    el.addEventListener('pointermove',onMove);
    el.addEventListener('pointerup',onUp);
    el.addEventListener('pointercancel',onCancel);
    // panel re-renders can detach the handle mid-drag: fires after capture dies
    el.addEventListener('lostpointercapture',onCancel);
    return el;
  }

  return { makeDraggable, dragging:()=>!!(drag&&drag.started), cancel:()=>{ if(drag) cleanup(); } };
}

const craftDrag={ createCraftDrag };
export default craftDrag;
