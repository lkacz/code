const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.world || !MM.worldGen || !MM.T || !MM.weapons || !MM.inventory || !window.player)
  return fail('sand/world/weapon APIs did not finish booting');

const T=MM.T;
const getTile=MM.world.getTile;
const setTile=MM.world.setTile;
const cx=Math.floor(player.x);
const floor=MM.worldGen.surfaceHeight(cx)-1;
MM.weapons.reset();
if(MM.mobs && MM.mobs.clearAll) MM.mobs.clearAll();
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.30});

for(let x=cx-12;x<=cx+13;x++){
  setTile(x,floor,T.STONE);
  for(let y=floor-9;y<floor;y++) setTile(x,y,T.AIR);
}
window.__mmDebugHero(cx-9,floor-1.1);
player.onGround=true;
window.inv.sand=20;
if(!MM.inventory.equip('throw_sand')) return fail('could not equip the sand throw');

const seeds=[];
const counts=[];
for(let i=0;i<6;i++){
  player.atkCd=0;
  if(!MM.weapons.fireHeld(player,cx+8,floor-2.5+(i%3)*0.35,1/60))
    return fail('real sand throw path refused projectile '+i);
  const a=MM.weapons._debug.arrows.at(-1);
  if(!a || !a.sandSpray || !a.sandSeed) return fail('sand projectile lacks visual seed');
  // Freeze the real projectile at a comparison position after it was created by
  // the normal input/ammo path; the renderer still uses its velocity direction.
  a.x=cx-4.5+i*2.45;
  a.y=floor-3.0-(i%2)*1.35;
  a.vx=9.5+(i%3)*1.2;
  a.vy=-1.4+(i%4)*0.8;
  a.travel=0.8+i*0.42;
  a.stuck=true;
  a.stuckT=20;
  seeds.push(a.sandSeed);
  counts.push(MM.weapons._debug.sandVisualPattern(a.sandSeed).count);
  MM.weapons.update(0.5,getTile,setTile);
}

if(new Set(seeds).size!==seeds.length) return fail('comparison throws repeated a visual seed');
if(new Set(counts).size<3) return fail('grain counts do not visibly vary: '+counts.join(','));
const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
const controls=document.getElementById('controls'); if(controls) controls.style.display='none';
return 'ok :: six real sand throws; uniqueSeeds='+new Set(seeds).size+'; grainCounts='+counts.join(',');
