const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.inventory || !MM.inventoryUI || !window.player)
  return fail('jewel inventory APIs did not finish booting');

Object.assign(window.inv,{jewelBlessed:2,jewelDevout:1,jewelDivinity:1});
MM.inventoryUI.open();
const tab=document.querySelector('.invTabBtn[data-key="jewels"]');
if(!tab) return fail('Juwele tab is missing');
tab.click();
const cards=[...document.querySelectorAll('.invJewelCard')];
const apply=document.querySelector('.invJewelApply');
const target=document.querySelector('.invJewelTarget');
if(cards.length!==3 || !apply || !target) return fail('jewel forge controls are incomplete');
if(!cards.every(card=>card.querySelector('.invJewelGem') && card.querySelector('.invJewelOdds')))
  return fail('a jewel card lacks its gem or odds');
const overlayRect=document.getElementById('invOverlay').getBoundingClientRect();
const forgeRect=document.querySelector('.invJewelForge').getBoundingClientRect();
const selectRect=target.getBoundingClientRect();
if(forgeRect.right>overlayRect.right) return fail('jewel forge overflows the inventory overlay');
return 'ok :: jewel forge visible; cards='+cards.length+'; targets='+target.options.length
  +'; forge='+Math.round(forgeRect.width)+'x'+Math.round(forgeRect.height)
  +'; select='+Math.round(selectRect.width)+'x'+Math.round(selectRect.height);
