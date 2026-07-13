const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.world || !MM.worldGen || !MM.T || !MM.fire || !MM.weapons || !MM.mobs || !window.player)
  return fail('fire/world/weapon/mob APIs did not finish booting');

const T=MM.T;
const getTile=MM.world.getTile;
const setTile=MM.world.setTile;
const cx=Math.floor(player.x);
const floor=MM.worldGen.surfaceHeight(cx)-1;

MM.fire.reset();
MM.weapons.reset();
MM.mobs.clearAll();
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.34});

// A clean, compact stage keeps the three consumers of the shared sprites in
// view: persistent fuel, a burning creature, and the hero's live flame stream.
for(let x=cx-11;x<=cx+11;x++){
  setTile(x,floor,T.STONE);
  for(let y=floor-7;y<floor;y++) setTile(x,y,T.AIR);
}
window.__mmDebugHero(cx-7.5,floor-1.1);
player.onGround=true;

const fuelX=[cx+2,cx+4,cx+6];
for(const x of fuelX){
  setTile(x,floor-1,T.COAL);
  if(!MM.fire.ignite(x,floor-1,getTile,setTile)) return fail('coal did not ignite at '+x);
}

if(!MM.mobs.forceSpawn('WOLF',{x:cx-0.5,y:floor-1.1},getTile)) return fail('burning-mob comparison target did not spawn');
const target=MM.mobs.nearestLiving(cx-0.5,floor-1.1,5);
if(!target || !MM.mobs.applyStatus(target,'burn',{dur:12,dps:0.1,source:'qa'}))
  return fail('could not apply the shared burning overlay to the mob');

for(let i=0;i<8;i++){
  MM.weapons.spawnExternalStream('flame',player.x+0.4,player.y-0.35,1,-0.05,{
    range:7,emitScale:1.35,spread:0.18,scale:0.92,source:'qa'
  });
}

const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
const controls=document.getElementById('controls'); if(controls) controls.style.display='none';
const metrics=MM.weapons.metrics();
if(MM.fire.count()!==fuelX.length || metrics.puffs<8 || !MM.mobs.hasStatus(target,'burn'))
  return fail('comparison scene state mismatch: '+JSON.stringify({fires:MM.fire.count(),puffs:metrics.puffs,burning:MM.mobs.hasStatus(target,'burn')}));

return 'ok :: shared flame sprites visible on '+MM.fire.count()+' fuel blocks, 1 mob and '+metrics.puffs+' fire-hose puffs';
