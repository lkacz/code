const fail=message=>'FAIL :: '+message;
for(let i=0;i<80 && !(window.MM && MM.discovery && MM.inventoryUI && window.player);i++){
  await sleep(100);
}
if(!(window.MM && MM.discovery && MM.inventoryUI && window.player)){
  return fail('knowledge atlas did not finish booting');
}

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(180);

// A clean throwaway browser profile lets this scene exercise all three stages
// plus a partially filled evidence trail without depending on a saved game.
MM.discovery.reset();
for(let i=0;i<7;i++){
  MM.discovery.observe('hero_moved',{cell:'qa-cell-'+i,silent:true});
}
MM.discovery.note('ground_jump','',{silent:true});
MM.discovery.note('water_entry','',{silent:true});
for(let i=0;i<3;i++){
  MM.discovery.observe('hero_swim',{silent:true});
}
MM.discovery.note('blocks_can_be_mined','',{silent:true});
MM.discovery.note('materials_have_hardness','',{silent:true});
MM.discovery.note('blocks_can_be_placed','',{silent:true});
MM.discovery.note('sand_obeys_gravity','',{silent:true});
MM.discovery.note('air_jump','',{silent:true});

MM.inventoryUI.open();
document.getElementById('invEquipmentNav')?.click();
await sleep(120);
const knowledgeTab=document.querySelector('.invTabBtn[data-key="discovery"]');
if(!knowledgeTab) return fail('knowledge tab is missing');
knowledgeTab.click();
await sleep(350);

const overlay=document.getElementById('invOverlay');
const panel=document.getElementById('invDialog');
const grid=document.getElementById('invGrid');
const header=document.getElementById('invHeader');
const primaryNav=document.getElementById('invPrimaryNav');
const closeButton=document.getElementById('invClose');
const tabStrip=document.getElementById('invTabs');
const summary=[...document.querySelectorAll('.invDiscSummary > span')];
const nav=[...document.querySelectorAll('.invDiscNavBtn')];
const cards=[...document.querySelectorAll('.invDiscCard')];
const evidence=[...document.querySelectorAll('.invDiscEvidence')];
const nextButton=nav.find(button=>button.textContent.includes('Następne'));
const collectionButton=nav.find(button=>button.textContent.includes('Karty'));
const progress=MM.discovery.progress();
const overlayRect=overlay?.getBoundingClientRect();
const panelRect=panel?.getBoundingClientRect();
const gridRect=grid?.getBoundingClientRect();
const headerRect=header?.getBoundingClientRect();
const primaryRect=primaryNav?.getBoundingClientRect();
const closeRect=closeButton?.getBoundingClientRect();
const visible=node=>{
  const rect=node.getBoundingClientRect();
  return rect.width>0 && rect.height>0 && rect.bottom>0 && rect.top<innerHeight;
};
const checks={
  overlayOpen:MM.inventoryUI.isOpen() && getComputedStyle(overlay).display!=='none',
  tabSelected:knowledgeTab.classList.contains('sel'),
  fullCatalog:MM.discovery.total()>=240,
  knowledgeSplit:progress.total>=195 && progress.collectionTotal>=40 &&
    progress.total+progress.collectionTotal===MM.discovery.total(),
  stageSummary:summary.length===4 && summary.every(node=>/\d+\s*\/\s*\d+/.test(node.textContent)),
  categoryNavigation:nav.length>=10 && nextButton?.classList.contains('active') && !!collectionButton,
  boundedCards:cards.length>0 && cards.length<=30,
  progressiveState:cards.some(card=>card.classList.contains('found')) &&
    cards.some(card=>card.classList.contains('zero')) && evidence.length>0,
  hiddenKnowledge:cards.filter(card=>card.classList.contains('zero'))
    .every(card=>card.querySelector('.invResLabel')?.textContent==='Nieodkryte'),
  semanticStages:cards.every(card=>['observation','insight','discovery']
    .includes(card.dataset.discoveryStage)),
  visibleContent:cards.some(visible),
  panelInViewport:!!panelRect && panelRect.left>=-1 && panelRect.right<=innerWidth+1 &&
    panelRect.top>=-1 && panelRect.bottom<=innerHeight+1,
  headerControlsInViewport:!!headerRect && !!primaryRect && !!closeRect &&
    primaryRect.left>=headerRect.left-1 && closeRect.right<=headerRect.right+1,
  gridInPanel:!!gridRect && !!panelRect && gridRect.left>=panelRect.left-1 &&
    gridRect.right<=panelRect.right+1,
  noPageOverflow:document.documentElement.scrollWidth<=innerWidth+2
};

return (Object.values(checks).every(Boolean)?'ok':'FAIL')+' :: '+JSON.stringify({
  viewport:[innerWidth,innerHeight],
  total:MM.discovery.total(),
  found:MM.discovery.count(),
  summary:summary.map(node=>node.textContent.trim()),
  navButtons:nav.length,
  cards:cards.length,
  evidence:evidence.length,
  pageScroll:[Math.round(scrollX),Math.round(scrollY)],
  header:headerRect && {
    left:Math.round(headerRect.left),
    right:Math.round(headerRect.right)
  },
  primaryNav:primaryRect && {
    left:Math.round(primaryRect.left),
    right:Math.round(primaryRect.right)
  },
  close:closeRect && {
    left:Math.round(closeRect.left),
    right:Math.round(closeRect.right)
  },
  tabs:tabStrip && {
    scrollLeft:Math.round(tabStrip.scrollLeft),
    clientWidth:tabStrip.clientWidth,
    scrollWidth:tabStrip.scrollWidth
  },
  panel:panelRect && {
    left:Math.round(panelRect.left),
    top:Math.round(panelRect.top),
    right:Math.round(panelRect.right),
    bottom:Math.round(panelRect.bottom)
  },
  checks
});
