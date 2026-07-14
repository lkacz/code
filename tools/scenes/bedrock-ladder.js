// Live browser acceptance scene for the single-anchored bedrock ladder.
const fail = message => 'FAIL :: ' + message;
if(!window.MM || !MM.world || !MM.T || !window.player || !window.inv || !window.updateInventoryHud)
  return fail('game APIs did not finish booting');

const T=MM.T;
if(!Number.isFinite(T.BEDROCK_LADDER)) return fail('bedrock ladder tile is missing');

// Exercise the real crafting-panel path: learning the raw bedrock resource must
// reveal the recipe, and one click must exchange one rock for six ladders.
inv.bedrock=2;
window.updateInventoryHud({noSave:true});
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed==='true') document.getElementById('craftToggle').click();
const search=document.getElementById('craftSearch');
if(search){
  search.value='macierzyste';
  search.dispatchEvent(new Event('input',{bubbles:true}));
}
const row=document.getElementById('craft_bedrock_ladders');
if(!row) return fail('bedrock ladder recipe did not unlock from mined bedrock');
row.click();
const craftButton=document.querySelector('#craftDetail .craftPrimary');
if(!craftButton || craftButton.disabled) return fail('bedrock ladder recipe is not craftable');
craftButton.click();
if(inv.bedrock!==1 || inv.bedrockLadder!==6)
  return fail('recipe exchange mismatch: bedrock='+inv.bedrock+', ladders='+inv.bedrockLadder);

// Stage two columns beside the hero. The wooden run is visibly anchored at both
// ends; the taller blue-grey bedrock run has only a bottom anchor and open air above.
const cx=Math.floor(player.x)+4;
const baseY=Math.floor(player.y+player.h/2)+5;
for(let x=cx-8;x<=cx+8;x++){
  for(let y=baseY-13;y<baseY;y++){
    MM.world.clearInfrastructure(x,y);
    MM.world.setTile(x,y,T.AIR);
  }
  MM.world.setTile(x,baseY,T.STONE);
}
MM.world.setTile(cx-3,baseY-9,T.STONE);
for(let y=baseY-8;y<baseY;y++) MM.world.setInfrastructure(cx-3,y,T.LADDER);
for(let y=baseY-10;y<baseY;y++) MM.world.setInfrastructure(cx+3,y,T.BEDROCK_LADDER);

window.__mmDebugHero(cx,baseY-2);
const bedrockRun=[];
for(let y=baseY-10;y<baseY;y++){
  if(MM.world.hasInfrastructure(cx+3,y,T.BEDROCK_LADDER)) bedrockRun.push(y);
}
const snap=MM.world.snapshotInfrastructure();
if(bedrockRun.length!==10 || !snap.list.some(o=>o.x===cx+3 && o.t===T.BEDROCK_LADDER))
  return fail('bedrock ladder run did not persist in infrastructure snapshot');

return 'ok :: crafted=6 from 1 bedrock; bottomAnchoredRun='+bedrockRun.length+'; saved=true';
