const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.world || !MM.worldGen || !MM.T || !MM.drops || !MM.inventory || !window.player)
  return fail('jewel/world/inventory APIs did not finish booting');

const T=MM.T;
const setTile=MM.world.setTile;
const cx=Math.floor(player.x);
const floor=MM.worldGen.surfaceHeight(cx)-1;
MM.drops.reset();
if(MM.mobs && MM.mobs.clearAll) MM.mobs.clearAll();
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.78});

for(let x=cx-12;x<=cx+12;x++){
  setTile(x,floor,T.STONE);
  for(let y=floor-8;y<floor;y++) setTile(x,y,T.AIR);
}
window.__mmDebugHero(cx-7.5,floor-1.1);
player.onGround=true;

const keys=['jewelBlessed','jewelDevout','jewelDivinity'];
const drops=keys.map((key,i)=>MM.drops.spawnJewel(cx-2+i*4,floor-1.15,key,{
  vx:0,vy:0,announce:true,source:'qa'
}));
if(drops.some(d=>!d)) return fail('one of the three jewels did not spawn');

// Also exercise the real inventory tab in this browser run before leaving the
// unobstructed world frame ready for the visual screenshot.
Object.assign(window.inv,{jewelBlessed:1,jewelDevout:1,jewelDivinity:1});
MM.inventoryUI.open();
document.querySelector('.invTabBtn[data-key="jewels"]')?.click();
const cardCount=document.querySelectorAll('.invJewelCard').length;
const forge=document.querySelector('.invJewelForge');
const target=document.querySelector('.invJewelTarget');
if(cardCount!==3 || !forge || !target) return fail('jewel inventory tab is incomplete: cards='+cardCount);
MM.inventoryUI.close();

const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
const controls=document.getElementById('controls'); if(controls) controls.style.display='none';
return 'ok :: 3 physical jewels, 3 inventory cards, upgrade target='+target.options.length;
