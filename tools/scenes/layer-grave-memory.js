for(let i=0;i<400 && !(window.MM && window.player && MM.ghostBridge && MM.layerGraves);i++) await sleep(50);
if(!window.player || !MM.ghostBridge || !MM.layerGraves || !MM.world || !MM.T) return 'FAIL boot-timeout';

const history={
  v:2,completions:3,lastVerdict:{key:'cartographer',title:'Kartograf Reakcji'},
  history:[{
    layer:3,seed:424242,day:27,level:14,deaths:5,bossKills:8,
    discoveries:{count:42,total:55},milestones:{done:9,total:11},
    verdict:{key:'cartographer',title:'Kartograf Reakcji',note:'Warstwa pamięta, że zaglądałeś pod każdy kamień.'}
  }]
};
localStorage.setItem('mm_layers_v1',JSON.stringify(history));
const layers=MM.finale.layers();
const seed=MM.worldGen.worldSeed;
const ty=Math.floor(player.y);
let tx=Math.floor(player.x)+2;
for(let x=tx;x<tx+100;x++){
  if(MM.layerGraves.memoryAt(seed,x,ty,layers).kind==='personal'){ tx=x; break; }
}
MM.world.ensureChunk(Math.floor(tx/MM.CHUNK_W));
MM.ghostBridge.setTile(tx,ty,MM.T.GRAVE);
if(MM.ghostBridge.getTile(tx,ty)!==MM.T.GRAVE) return 'FAIL grave-setup';

const receipt=MM.ghostBridge.ghostHeroUseAt(tx,ty);
if(!receipt || !receipt.ok || !receipt.memoryGrave || !Array.isArray(receipt.loot)) return 'FAIL claim '+JSON.stringify(receipt);
for(const row of receipt.loot) MM.ghostBridge.ghostHeroGain(row[0],row[1]);
MM.ghostBridge.ghostHeroLayerGraveOpened(tx,ty,receipt.loot);
await sleep(250);

const overlay=document.getElementById('layerGraveMemory');
const card=overlay && overlay.querySelector('.lgCard');
const rect=card && card.getBoundingClientRect();
const lootRows=overlay ? overlay.querySelectorAll('.lgLoot li').length : 0;
const title=overlay ? overlay.querySelector('h2')?.textContent : '';
const focused=document.activeElement && document.activeElement.classList.contains('lgClose');
if(!overlay || overlay.dataset.layerGraveKind!=='personal') return 'FAIL modal-kind';
if(!/Duch warstwy #3/.test(title||'')) return 'FAIL personal-title '+title;
if(!rect || rect.left<0 || rect.top<0 || rect.right>innerWidth || rect.bottom>innerHeight) return 'FAIL viewport '+JSON.stringify(rect);
if(lootRows!==receipt.loot.length) return 'FAIL loot-rows '+lootRows+'/'+receipt.loot.length;
if(!focused || !MM.ghostBridge.overlayHold()) return 'FAIL modal-contract focus='+focused+' hold='+MM.ghostBridge.overlayHold();
if(MM.ghostBridge.getTile(tx,ty)!==MM.T.AIR) return 'FAIL grave-not-consumed';
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
await sleep(30);
if(MM.layerGraves.isOpen()) return 'FAIL escape-close';
MM.ghostBridge.ghostHeroLayerGraveOpened(tx,ty,receipt.loot);
await sleep(30);
if(!MM.layerGraves.isOpen()) return 'FAIL reopen';
return 'ok :: kind=personal :: title='+title+' :: loot='+lootRows+' :: card='+Math.round(rect.width)+'x'+Math.round(rect.height);
