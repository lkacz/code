// Visual/integration scene for the home workshop.
//   ?qa=gallery -> a 32-object in-world showroom
//   ?qa=craft   -> the tier-4 recipe collection and procedural detail preview
for(let i=0;i<400 && !(window.MM && MM.furnishings && MM.world && window.player && window.inv);i++) await sleep(50);
if(!(window.MM && MM.furnishings && MM.world && window.player)) return 'FAIL boot-timeout';

const defs=MM.furnishings.definitions||[];
if(defs.length!==32) return 'FAIL catalogue='+defs.length;
try{ MM.titleScreen && MM.titleScreen.dismiss('qa'); }catch(e){}
try{ MM.fog && MM.fog.setRevealAll(true); }catch(e){}
try{ MM.background && MM.background.importState({cycleT:.32}); }catch(e){}

const mode=new URLSearchParams(location.search).get('qa')||'gallery';
if(mode==='craft'){
  for(const resource of MM.inventory.RESOURCES||[]){
    if(resource && resource.key && typeof inv[resource.key]==='number') inv[resource.key]=99;
  }
  if(typeof window.updateInventoryHud==='function') window.updateInventoryHud();
  await sleep(450);
  const craft=document.getElementById('craft');
  if(craft && craft.dataset.collapsed==='true') document.getElementById('craftToggle')?.click();
  await sleep(250);
  const tab=[...document.querySelectorAll('.craftTab')].find(el=>el.textContent.includes('Osobliwości'));
  if(!tab) return 'FAIL missing-wonders-tab tabs='+[...document.querySelectorAll('.craftTab')].map(x=>x.textContent).join('|');
  tab.click();
  await sleep(200);
  const cosmic=document.getElementById('craft_furnishing_cosmicOrrery');
  if(!cosmic) return 'FAIL missing-cosmic-recipe rows='+document.querySelectorAll('.homeRecipe').length;
  cosmic.click();
  await sleep(350);
  const preview=document.querySelector('.craftDetail.homeDetail[data-tier="4"] .craftHomeCanvas');
  if(!preview) return 'FAIL missing-tier4-preview';
  const pixels=preview.getContext('2d').getImageData(0,0,preview.width,preview.height).data;
  let painted=0;
  for(let i=3;i<pixels.length;i+=4) if(pixels[i]) painted++;
  const groups=['Meble','Dekoracje','Elektronika','Osobliwości'].filter(label=>[...document.querySelectorAll('.craftTab')].some(el=>el.textContent.includes(label)));
  if(painted<preview.width*preview.height*.35) return 'FAIL preview-too-empty='+painted;
  if(groups.length!==4) return 'FAIL home-tabs='+groups.join(',');
  return 'ok :: craft rows='+document.querySelectorAll('.homeRecipe').length+' tier='+document.getElementById('craftDetail')?.dataset.tier+' previewPixels='+painted;
}

// Build a compact four-row showroom around the camera. Background brick keeps
// every open-fixture silhouette readable while the objects retain transparency.
const W=MM.world, T=MM.T;
const x0=Math.floor(player.x)-8;
const y0=Math.floor(player.y)-7;
for(let y=y0-1;y<=y0+13;y++){
  for(let x=x0-2;x<=x0+19;x++){
    W.setTile(x,y,T.AIR);
    if(W.setConstructionBackground) W.setConstructionBackground(x,y,T.BRICK);
  }
}
for(let x=x0-2;x<=x0+19;x++){
  W.setTile(x,y0-1,T.BRICK);
  W.setTile(x,y0+12,T.BRICK);
}
for(let y=y0;y<y0+12;y++){
  W.setTile(x0-2,y,T.BRICK);
  W.setTile(x0+19,y,T.BRICK);
}
defs.forEach((def,i)=>{
  const col=i%8, row=Math.floor(i/8);
  W.setTile(x0+col*2,y0+1+row*3,def.tile);
  W.setTile(x0+col*2,y0+2+row*3,T.BRICK);
});
player.x=x0+8;
player.y=y0+11;
player.vx=0; player.vy=0;
for(let i=0;i<2;i++){
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'-',bubbles:true}));
  document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'-',bubbles:true}));
}
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true}));
document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'c',bubbles:true}));
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true') document.getElementById('craftToggle')?.click();
await sleep(900);
const placed=defs.filter((def,i)=>W.getTile(x0+(i%8)*2,y0+1+Math.floor(i/8)*3)===def.tile).length;
if(placed!==32) return 'FAIL showroom-placed='+placed;
return 'ok :: showroom='+placed+' effects='+defs.filter(def=>def.effect!=='still').length;
