const fail=message=>'FAIL :: '+message;
for(let i=0;i<80 && !(window.MM && MM.smartFeed && MM.inventoryFeedback && MM.inventoryUI && MM.hotbar && window.inv);i++){
  await sleep(100);
}
if(!window.MM || !MM.smartFeed || !MM.inventoryFeedback || !MM.inventoryUI || !MM.hotbar || !window.inv){
  return fail('inventory feed or hotbar did not finish booting');
}
const hitTest=el=>{
  if(!el) return false;
  const rect=el.getBoundingClientRect();
  const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  return !!hit && (hit===el || el.contains(hit));
};

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(180);
const touch=innerWidth<600 || innerHeight<560;
document.documentElement.dataset.inputMode=touch?'touch':'pc';
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true'){
  document.getElementById('craftToggle')?.click();
  await sleep(80);
}

MM.smartFeed.clear();
MM.smartFeed.setExpanded(false);
MM.inventoryFeedback.reset();
MM.hotbar.assign(0,'GRASS');
MM.hotbar.assign(5,'WATER');

const woodBefore=(inv.wood|0);
inv.wood=woodBefore+2;
if(window.updateInventoryHud) window.updateInventoryHud({noSave:true,noCraftNotify:true});
else window.dispatchEvent(new CustomEvent('mm-resources-change'));
await sleep(180);

const host=document.getElementById('smartFeed');
let card=host?.querySelector('.smartFeedBubble[data-kind="inventory"]');
let row=card?.querySelector('.smartFeedItem[data-hotbar-assignable="true"]');
let handle=row?.querySelector('.smartFeedItemHotbar');
if(!card || !row || !handle) return fail('the +2 wood notice has no immediate hotbar handle');
if(row.querySelector('.smartFeedItemName')?.textContent!=='Drewno'){
  return fail('the actionable notice is not the wood gain');
}

const destination=document.querySelectorAll('#hotbarWrap .hotSlot')[5];
if(!destination) return fail('hotbar slot 0 is missing');
const from=handle.getBoundingClientRect();
const to=destination.getBoundingClientRect();
const pointerId=73;
const pointerType=touch?'touch':'mouse';
const event=(type,x,y,buttons)=>new PointerEvent(type,{
  bubbles:true,
  cancelable:true,
  pointerId,
  pointerType,
  isPrimary:true,
  button:0,
  buttons,
  clientX:x,
  clientY:y
});
const fx=from.left+from.width/2;
const fy=from.top+from.height/2;
const tx=to.left+to.width/2;
const ty=to.top+to.height/2;
const sourceHitTarget=hitTest(handle);
handle.dispatchEvent(event('pointerdown',fx,fy,1));
document.dispatchEvent(event('pointermove',tx,ty,1));
await sleep(40);

const midDrag={
  active:MM.craftDrag.dragging(),
  ghost:!!document.getElementById('craftDragGhost'),
  preview:document.querySelector('#craftDragGhost .craftDragPreview')?.textContent||'',
  targets:document.querySelectorAll('#hotbarWrap.hotDropActive .hotSlot').length,
  hovered:destination.classList.contains('dropHot')
};
document.dispatchEvent(event('pointerup',tx,ty,0));
await sleep(120);

const orderAfterDrag=MM.hotbar.order();
const undoToast=document.getElementById('hotbarUndoToast');
const dragChecks={
  sourceHitTarget,
  midActive:midDrag.active,
  oneGhost:midDrag.ghost,
  replacementPreview:/Slot 0: Woda → Drewno/.test(midDrag.preview),
  allSixTargets:midDrag.targets===6,
  destinationHovered:midDrag.hovered,
  slotZeroAssigned:orderAfterDrag[5]==='WOOD',
  slotZeroSelected:MM.hotbar.index()===5,
  inventoryUnchanged:(inv.wood|0)===woodBefore+2,
  undoOffered:!!undoToast?.querySelector('button'),
  dragCleaned:!MM.craftDrag.dragging()
    && !document.getElementById('craftDragGhost')
    && !document.body.classList.contains('mmTileDrag')
    && !document.getElementById('hotbarWrap').classList.contains('hotDropActive')
};

undoToast?.querySelector('button')?.click();
await sleep(100);
const undoChecks={
  restoredOldMapping:MM.hotbar.order()[5]==='WATER',
  toastClosed:!document.getElementById('hotbarUndoToast')
};

// Keyboard parity uses the exact same assignment chokepoint and prevents the
// global hotbar shortcut from merely selecting an unrelated old mapping.
card=host?.querySelector('.smartFeedBubble[data-kind="inventory"]');
row=card?.querySelector('.smartFeedItem[data-hotbar-assignable="true"]');
handle=row?.querySelector('.smartFeedItemHotbar');
handle.focus();
handle.dispatchEvent(new KeyboardEvent('keydown',{key:'5',bubbles:true,cancelable:true}));
await sleep(80);
const keyboardChecks={
  slotFiveAssigned:MM.hotbar.order()[0]==='WOOD',
  slotFiveSelected:MM.hotbar.index()===0,
  inventoryStillUnchanged:(inv.wood|0)===woodBefore+2,
  focusPreserved:document.activeElement?.classList?.contains('smartFeedItemHotbar')===true
};
const staleUndoButton=document.querySelector('#hotbarUndoToast button');
MM.hotbar.assign(0,'STONE');
staleUndoButton?.click();
await sleep(60);
const staleUndoChecks={
  staleGuarded:MM.hotbar.order()[0]==='STONE',
  staleToastClosed:!document.getElementById('hotbarUndoToast')
};
const mappingBeforeInvalid=MM.hotbar.order();
const validationChecks={
  prototypeRejected:MM.hotbar.assign(0,'toString')===false,
  fractionalRejected:MM.hotbar.assign(0.5,'WOOD')===false,
  mappingUnchanged:MM.hotbar.order().every((key,index)=>key===mappingBeforeInvalid[index])
};
MM.hotbar.remap(0,'WOOD','Drewno');
const abaUndoButton=document.querySelector('#hotbarUndoToast button');
MM.hotbar.assign(0,'SAND');
MM.hotbar.assign(0,'WOOD');
abaUndoButton?.click();
await sleep(60);
const abaUndoChecks={
  buttonExisted:!!abaUndoButton,
  staleRevisionRejected:MM.hotbar.order()[0]==='WOOD',
  staleToastClosed:!document.getElementById('hotbarUndoToast')
};
card=host?.querySelector('.smartFeedBubble[data-kind="inventory"]');
row=card?.querySelector('.smartFeedItem[data-hotbar-assignable="true"]');
handle=row?.querySelector('.smartFeedItemHotbar');

const compactChecks={
  cardStillTransparent:getComputedStyle(card).pointerEvents==='none',
  itemsVisible:getComputedStyle(row.parentElement).display==='grid',
  handleInteractive:getComputedStyle(handle).pointerEvents==='auto',
  handleHitTarget:hitTest(handle),
  oneColumnOnTouch:!touch || getComputedStyle(row.parentElement).gridTemplateColumns.trim().split(/\s+/).length===1,
  explicitAction:row.dataset.compactAction==='true',
  accessible:/Drewno.+5.+0/.test(handle.getAttribute('aria-label')||''),
  tileArt:!!handle.querySelector('canvas')
};

// Live inventory truth updates in place without rebuilding/detaching the feed.
// The redundant numeric "teraz ×…" copy is intentionally gone; depletion is
// still reflected visually and the action remains usable.
const sameRow=row;
inv.wood=0;
window.dispatchEvent(new CustomEvent('mm-resources-change'));
await sleep(80);
const liveChecks={
  sameDomRow:row===sameRow && row.isConnected,
  redundantCountHidden:!row.querySelector('.smartFeedItemLive'),
  depleted:row.classList.contains('is-depleted'),
  mappingStillUsable:getComputedStyle(handle).pointerEvents==='auto'
};

const craftButton=row.querySelector('.smartFeedItemCraft');
const craftHitTarget=hitTest(craftButton);
craftButton?.focus();
craftButton?.click();
await sleep(120);
const ingredientChip=document.getElementById('craftIngredientFilter');
const craftChecks={
  craftAction:!!craftButton,
  hitTarget:craftHitTarget,
  panelExpanded:craft?.dataset.collapsed==='false',
  exactFilter:MM.craftUI?.ingredientFilter?.()==='wood',
  visibleChip:!!ingredientChip && !ingredientChip.hidden && /Drewno/.test(ingredientChip.textContent),
  noSoftKeyboard:document.activeElement?.id!=='craftSearch',
  keyboardFocusMoved:document.activeElement?.classList?.contains('craftRecipe')===true
};
ingredientChip?.click();
await sleep(60);
craftChecks.clearable=MM.craftUI?.ingredientFilter?.()==='' && ingredientChip?.hidden===true;

// The inventory is a modal stacking context. Undo must mount inside it so the
// button stays visible, hit-testable and reachable by the modal focus trap.
MM.inventoryUI?.open?.();
await sleep(60);
MM.hotbar.remap(1,'WOOD','Drewno');
await sleep(50);
const modalToast=document.getElementById('hotbarUndoToast');
const modalToastButton=modalToast?.querySelector('button');
const modalUndoChecks={
  insideOverlay:modalToast?.parentElement?.id==='invOverlay',
  visible:!!modalToast && getComputedStyle(modalToast).display!=='none',
  hitTarget:hitTest(modalToastButton),
  inFocusTrap:[...(document.getElementById('invOverlay')?.querySelectorAll('button,[tabindex]')||[])].includes(modalToastButton),
  singleLiveOwner:modalToast?.getAttribute('role')==='group'&&!modalToast?.hasAttribute('aria-live')
};
modalToastButton?.focus();
modalToastButton?.click();
await sleep(40);
modalUndoChecks.focusRestored=document.getElementById('invOverlay')?.contains(document.activeElement)===true
  && document.activeElement!==modalToastButton;
MM.inventoryUI?.close?.();
await sleep(60);

const checks={
  drag:dragChecks,
  undo:undoChecks,
  keyboard:keyboardChecks,
  staleUndo:staleUndoChecks,
  validation:validationChecks,
  abaUndo:abaUndoChecks,
  compact:compactChecks,
  live:liveChecks,
  craft:craftChecks,
  modalUndo:modalUndoChecks
};
const allPassed=Object.values(checks).every(group=>Object.values(group).every(Boolean));
return (allPassed?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  inputMode:document.documentElement.dataset.inputMode,
  handle:{width:Math.round(from.width),height:Math.round(from.height)},
  midDrag,
  checks
});
