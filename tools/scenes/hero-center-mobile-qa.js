for(let i=0;i<400 && !(window.MM && window.player && MM.inventoryUI && MM.progress);i++) await sleep(50);
if(!(window.MM && MM.inventoryUI && MM.progress)) return 'FAIL :: centrum bohatera nie uruchomiło się';

player.xp=Math.max(Number(player.xp)||0,420);
const press=key=>{
  const code=/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():'';
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true}));
  document.body.dispatchEvent(new KeyboardEvent('keyup',{key,code,bubbles:true,cancelable:true}));
};
press('e');
await sleep(80);
const eReserved=!MM.inventoryUI.isOpen();
press('i');
await sleep(120);
const iOpened=MM.inventoryUI.isOpen();
press('i');
await sleep(80);
const iClosed=!MM.inventoryUI.isOpen();
document.getElementById('heroCenterBtn').click();
await sleep(250);
const iconOpened=MM.inventoryUI.isOpen();

const dialog=document.getElementById('invDialog');
const hero=document.getElementById('heroView');
const nav=document.getElementById('invPrimaryNav');
const attrs=[...document.querySelectorAll('.heroAttribute')];
const attrButtons=[...document.querySelectorAll('.heroAttribute button')];
const rect=dialog.getBoundingClientRect();
const navRect=nav.getBoundingClientRect();
const overflowX=document.documentElement.scrollWidth>innerWidth+1;
const touchTargets=attrButtons.every(button=>{
  const box=button.getBoundingClientRect();
  return box.width>=100 && box.height>=30;
});
const checks={
  open:MM.inventoryUI.isOpen(),
  eReserved,
  iOpened,
  iClosed,
  iconOpened,
  iconExpanded:document.getElementById('heroCenterBtn').getAttribute('aria-expanded')==='true',
  heroVisible:!hero.hidden && hero.getClientRects().length>0,
  attributes:attrs.length===5,
  dialogFits:rect.left>=0 && rect.right<=innerWidth+1 && rect.top>=0 && rect.bottom<=innerHeight+1,
  navFits:navRect.left>=0 && navRect.right<=innerWidth+1,
  noPageOverflow:!overflowX,
  touchTargets
};
return Object.values(checks).every(Boolean)
  ? 'PASS :: '+JSON.stringify(checks)
  : 'FAIL :: '+JSON.stringify(checks);
