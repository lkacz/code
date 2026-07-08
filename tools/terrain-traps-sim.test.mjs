// Natural terrain hazard simulator.
// Verifies unstable sand/grass collapse under hero and mob weight, carve a
// poison/rotten-meat pit, and quicksand requires repeated fresh jump taps.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.damageHero = (amount)=>{ globalThis.player.hp=Math.max(0,globalThis.player.hp-amount); return true; };
globalThis.player = { x:0, y:0, w:0.7, h:0.95, vx:0, vy:0, hp:100, maxHp:100 };

const { T } = await import('../src/constants.js');

const gasCalls=[];
let waterN=0, fallingN=0;
globalThis.MM.gases = {
  add(kind,x,y,opts){
    gasCalls.push({kind,x,y});
    if(opts && opts.setTile) opts.setTile(Math.floor(x),Math.floor(y),T.POISON_GAS);
    return 1;
  }
};
globalThis.MM.water = { onTileChanged(){ waterN++; } };
globalThis.MM.fallingSolids = { onTileRemoved(){ fallingN++; } };

const { terrainTraps } = await import('../src/engine/terrain_traps.js');

function makeMap(defaultTile=T.DIRT){
  const cells=new Map();
  const key=(x,y)=>Math.floor(x)+','+Math.floor(y);
  return {
    cells,
    getTile(x,y){ return cells.has(key(x,y)) ? cells.get(key(x,y)) : defaultTile; },
    setTile(x,y,t){ cells.set(key(x,y),t); },
    count(t){ let n=0; for(const v of cells.values()) if(v===t) n++; return n; },
    has(t){ return [...cells.values()].includes(t); }
  };
}

// Hero pressure collapses unstable sand into a gas/meat pit.
{
  terrainTraps.reset();
  gasCalls.length=0; waterN=0; fallingN=0;
  const map=makeMap(T.DIRT);
  map.setTile(0,10,T.UNSTABLE_SAND);
  const hero={x:0.5,y:9.50,w:0.7,h:0.95,vy:0,onGround:true};
  assert.equal(terrainTraps.stepEntity(hero,map.getTile,map.setTile,{kind:'hero'}), true, 'hero footfall triggers unstable sand');
  assert.equal(map.getTile(0,10), T.AIR, 'unstable cover disappears');
  assert.ok(map.has(T.ROTTEN_MEAT), 'collapse leaves rotten meat in the pit');
  assert.ok(gasCalls.some(g=>g.kind==='poison'), 'collapse vents poison gas');
  assert.ok(waterN>0, 'collapse notifies fluid systems');
  assert.ok(fallingN>0, 'collapse notifies falling-solid systems');
  assert.equal(hero.onGround, false, 'hero begins falling after the cover gives way');
}

// Ground mobs are also heavy enough to spring unstable grass.
{
  terrainTraps.reset();
  const map=makeMap(T.DIRT);
  map.setTile(5,10,T.UNSTABLE_GRASS);
  const mob={id:'TEST',x:5.5,y:9.45,vy:0,onGround:true};
  assert.equal(terrainTraps.stepEntity(mob,map.getTile,map.setTile,{kind:'mob',halfW:0.32,halfH:0.52}), true, 'mob footfall triggers unstable grass');
  assert.equal(map.getTile(5,10), T.AIR, 'mob-triggered cover collapses');
  assert.equal(mob.onGround, false, 'mob loses footing after triggering the trap');
}

// Quicksand slows, sinks, damages if ignored, and consumes fresh jump taps into escape.
{
  terrainTraps.reset();
  const map=makeMap(T.STONE);
  for(let y=10;y<=13;y++) map.setTile(10,y,T.QUICKSAND);
  globalThis.player={x:10.5,y:10.25,w:0.7,h:0.95,vx:5,vy:0,hp:100,maxHp:100,onGround:false};
  let state=terrainTraps.updateHeroQuicksand(0.12,globalThis.player,map.getTile,map.setTile,{jumpPressed:false});
  assert.equal(state.inQuicksand, true, 'hero detects quicksand contact');
  assert.ok(globalThis.player.vx<5, 'quicksand drags horizontal movement');
  assert.ok(globalThis.player.vy>0, 'quicksand pulls the hero downward');
  let escaped=false;
  for(let i=0;i<6;i++){
    state=terrainTraps.updateHeroQuicksand(0.08,globalThis.player,map.getTile,map.setTile,{jumpPressed:true});
    escaped = escaped || !!state.escaped;
    if(escaped) break;
  }
  assert.equal(escaped, true, 'repeated fresh jump taps pull the hero free');
  assert.ok(globalThis.player.vy<-6, 'escape launches the hero out of quicksand');
  assert.ok(globalThis.player.y<10, 'escape places the hero above the quicksand lip');
}

// Generated worlds include all three natural hazard tile types in broad spans.
{
  const { worldGen: WG } = await import('../src/engine/worldgen.js');
  const { world } = await import('../src/engine/world.js');
  WG.worldSeed=20260708;
  WG.clearCaches && WG.clearCaches();
  world.clear();
  const seen={unstableSand:0, unstableGrass:0, quicksand:0};
  for(let x=-16000; x<=16000; x++){
    const y=WG.surfaceHeight(x);
    const t=world.getTile(x,y);
    if(t===T.UNSTABLE_SAND) seen.unstableSand++;
    else if(t===T.UNSTABLE_GRASS) seen.unstableGrass++;
    else if(t===T.QUICKSAND) seen.quicksand++;
    if(seen.unstableSand && seen.unstableGrass && seen.quicksand) break;
  }
  assert.ok(seen.unstableSand>0, 'worldgen places unstable sand');
  assert.ok(seen.unstableGrass>0, 'worldgen places unstable grass');
  assert.ok(seen.quicksand>0, 'worldgen places quicksand');
}

console.log('terrain-traps-sim: all assertions passed');
