// Deterministic Node test for the procedural boss-monster core (no browser needed).
// Verifies: seeded generation (large connected bodies, buried heart, determinism),
// day/night spawn scheduling at findable-but-not-adjacent distances, gravity and
// ground physics, roam/hunt behavior, part-level destruction with connectivity
// pruning (severed chunks break off, the beast fights on), the heart-detonation
// crater (bedrock/chests survive, hero hurt, XP paid), harmless body contact, API safety,
// feeding/growth/balance, and the hardening regressions: growth never sinks below
// the feet line (and grounding survives growth), floaters bounce off tall cliffs
// instead of embedding, sealed-column spawns are rejected, hunger accrues even
// while a nearby hero suppresses feeding.
// Run: node tools/boss-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // bosses.js attaches to window.MM
globalThis.MM = {};
globalThis.inv = {ufoConcrete:0};
const { T, INFO } = await import('../src/constants.js');

// Sparse world: bedrock from y=90 down, open sky above; supports negative x.
const H = 140;
let tiles;
const getTile = (x,y)=>{ if(y<0||y>=H) return T.STONE; const v=tiles.get(x+','+y); return v===undefined ? (y>=90? T.STONE : T.AIR) : v; };
const setTile = (x,y,v)=>{ if(y>=0&&y<H) tiles.set(x+','+y,v); };

globalThis.MM = {
  T, WORLD_H:140, TILE:20,
  INFO,
  worldGen: { surfaceHeight: ()=>90, biomeType: ()=>0, settings:{seaLevel:95} },
  world: { getTile, setTile },          // attackAt reaches the world through MM.world
  water: { onTileChanged(){}, disturb(){} },
  particles: { spawnBurst(){}, spawnSplash(){} },
};

const { companions } = await import('../src/engine/companions.js');
const { bosses } = await import('../src/engine/bosses.js');
assert.ok(bosses, 'bosses module exports');
const CFG = bosses.config;
assert.equal(CFG.FEED_BUILD_SPEED_MULT, 3, 'bosses feed/build themselves 3x faster');
assert.equal(CFG.SATIATE_BITES, 12, 'bosses eat twice as many blocks per meal');
assert.equal(CFG.GROWTH_CAP, 28, 'bosses can grow twice as much over their starting size');

const step = (n,dt=1/30)=>{ for(let i=0;i<n;i++) bosses.update(getTile,setTile,dt); };
function resetWorld(){
  tiles = new Map();
  bosses.reset();
  companions.reset();
  globalThis.inv = {ufoConcrete:0};
  delete globalThis.MM.wind;
  bosses.setCycleOverride({isDay:true, tDay:0.5});
  globalThis.player = {x:0, y:88, hp:100, maxHp:100, xp:0, vx:0, vy:0, hpInvul:0, tool:'basic'};
}
// every remaining part must still be reachable from the heart (4-neighbor lattice)
function assertConnected(m,label){
  const byKey=new Map(); for(const p of m.parts) byKey.set(p.dx+','+p.dy,p);
  const seen=new Set([m.core.dx+','+m.core.dy]); const q=[m.core];
  while(q.length){
    const c=q.pop();
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const k=(c.dx+dx)+','+(c.dy+dy);
      if(byKey.has(k) && !seen.has(k)){ seen.add(k); q.push(byKey.get(k)); }
    }
  }
  assert.equal(seen.size, m.parts.length, label+': all parts connected to the heart');
}
function recordingCtx(){
  const calls=[];
  const gradient={addColorStop(){}};
  return {
    calls,
    fillStyle:'#000',
    strokeStyle:'#000',
    lineWidth:1,
    globalAlpha:1,
    font:'',
    textAlign:'left',
    save(){}, restore(){}, translate(){}, rotate(){},
    beginPath(){}, moveTo(){}, lineTo(){}, closePath(){}, arc(){},
    stroke(){}, fill(){}, strokeRect(){},
    fillRect(x,y,w,h){ calls.push({x,y,w,h,style:this.fillStyle,alpha:this.globalAlpha}); },
    createRadialGradient(){ return gradient; },
  };
}

// --- 1. Generation: a large, connected, seeded structure with a buried heart ---
resetWorld();
const m1 = bosses.forceSpawn(getTile, {x:200, seed:1234, freeze:true});
assert.ok(m1, 'forceSpawn returns the monster');
assert.ok(m1.parts.length >= 18, `large structure (got ${m1.parts.length} parts)`);
assert.ok(m1.core && m1.core.role==='core', 'monster has a heart');
assert.ok(typeof m1.name==='string' && m1.name.length>3, 'monster has a generated name');
assertConnected(m1, 'fresh body');
// the heart is armored: all four neighbors exist
for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
  assert.ok(m1.parts.some(p=>p.dx===m1.core.dx+dx && p.dy===m1.core.dy+dy), 'heart is covered by armor');
}
// determinism: same seed → same body; different seed → different beast
const m2 = bosses.forceSpawn(getTile, {x:400, seed:1234, freeze:true});
assert.equal(m2.parts.length, m1.parts.length, 'same seed regenerates the same body');
assert.equal(m2.name, m1.name, 'same seed regenerates the same name');
const m3 = bosses.forceSpawn(getTile, {x:600, seed:9999, freeze:true});
assert.ok(m3.parts.length!==m1.parts.length || m3.name!==m1.name || m3.archetype!==m1.archetype,
  'different seeds produce different monsters');

// --- 2. Day/night scheduling at a findable distance ---
resetWorld();
// step in small slices and measure the moment it appears (before it roams away)
let dist0 = -1;
for(let s=0; s<30*(CFG.INITIAL_DELAY+3) && dist0<0; s+=5){
  step(5);
  const list = bosses._debug().monsters;
  if(list.length) dist0 = Math.abs(list[0].x - 0);
}
assert.equal(bosses.metrics().alive, 1, 'first monster appeared after the initial delay');
assert.ok(dist0 >= CFG.SPAWN_MIN-2 && dist0 <= CFG.SPAWN_MAX+2,
  `spawn is near but not adjacent (${dist0.toFixed(0)} columns away)`);
bosses.setCycleOverride({isDay:false, tDay:0.1}); // dusk falls
step(30);
assert.equal(bosses.metrics().alive, 2, 'nightfall brought a second monster');
bosses.setCycleOverride({isDay:true, tDay:0.1});  // dawn
step(30*3);
assert.equal(bosses.metrics().alive, 2, 'population capped at MAX_ALIVE');

// --- 3. Physics: a monster dropped from the sky lands on the ground ---
resetWorld();
const mf = bosses.forceSpawn(getTile, {x:300, seed:42, freeze:true, archetype:'walker'});
mf.y = 70; mf.vy = 0;            // hoist it into the air
step(30*4);
assert.ok(Math.abs(mf.y-89) <= 1, `gravity landed the beast on the surface (y=${mf.y.toFixed(1)})`);
let feetSolid=false;
for(const p of mf.parts){ if(p.dy===0 && getTile(Math.round(mf.x)+p.dx, Math.round(mf.y)+1)===T.STONE) feetSolid=true; }
assert.ok(feetSolid, 'feet rest on solid ground');

resetWorld();
for(let x=294; x<=306; x++) setTile(x,82,T.POISON_GAS);
const mgas = bosses.forceSpawn(getTile, {x:300, seed:4242, freeze:true, archetype:'walker'});
mgas.y = 70; mgas.vy = 0;
step(30*4);
assert.ok(Math.abs(mgas.y-89) <= 1, `monster falls through gas and lands on terrain (y=${mgas.y.toFixed(1)})`);
assert.equal(getTile(300,82), T.POISON_GAS, 'gas is not consumed by boss collision');

// --- 4. Behavior: it roams on its own and hunts the hero when close ---
resetWorld();
const mw = bosses.forceSpawn(getTile, {x:300, seed:77, archetype:'walker'});
step(30*2); // settle
const xs=[]; for(let s=0;s<12;s++){ step(30); xs.push(mw.x); }
const roamDev = Math.max(...xs)-Math.min(...xs);
assert.ok(roamDev > 0.5, `monster roams under its own power (moved ${roamDev.toFixed(2)} tiles)`);
globalThis.player.x = mw.x + 12; globalThis.player.y = 88; // walk into its sense range
step(30);
assert.equal(mw.state, 'hunt', 'monster noticed the hero and hunts');
const gapBefore = Math.abs(globalThis.player.x - mw.x);
step(30*3);
assert.ok(Math.abs(globalThis.player.x - mw.x) < gapBefore, 'hunting monster closes the distance');

// --- 5. Destructible parts: attacked blocks break off, the rest stays connected ---
resetWorld();
const md = bosses.forceSpawn(getTile, {x:300, seed:555, freeze:true, archetype:'walker'});
step(30); // settle on the ground
const partsBefore = md.parts.length;
const bx=Math.round(md.x), by=Math.round(md.y);
let destroyed=0;
for(const p of [...md.parts]){
  if(p===md.core || destroyed>=5) continue;
  if(bosses.attackAt(bx+p.dx, by+p.dy, 999)) destroyed++;
}
assert.ok(md.parts.length < partsBefore, `parts were destroyed (${partsBefore} -> ${md.parts.length})`);
assert.ok(md.parts.length > 0 && !md.dead, 'the beast survives losing parts');
assertConnected(md, 'wounded body');
// light hits only chip: a fresh part takes damage but stays attached
const tough=md.parts.find(p=>p!==md.core && p.hp===p.maxHp);
if(tough){
  bosses.attackAt(bx+tough.dx, by+tough.dy, 1);
  assert.ok(tough.hp===tough.maxHp-1 && md.parts.includes(tough), 'partial damage chips without destroying');
}

// --- 6. Heart destruction: the sealed heart deflects blows until the hero carves a
// path through the plating; once exposed, detonation craters the world, spares loot,
// pays XP ---
resetWorld();
const mh = bosses.forceSpawn(getTile, {x:300, seed:888, freeze:true, archetype:'walker'});
step(30); // settle
const cbx=Math.round(mh.x)+mh.core.dx, cby=Math.round(mh.y)+mh.core.dy;
setTile(300+9, 91, T.CHEST_EPIC);  // buried treasure just inside the blast radius
setTile(cbx+8, cby+1, T.BEDROCK);
setTile(cbx+7, cby+1, T.VOLCANO_MASTER_STONE);
setTile(cbx+6, cby+1, T.OBSIDIAN);
setTile(cbx+5, cby+1, T.DIAMOND);
setTile(cbx+4, cby+1, T.IRIDIUM);
setTile(cbx+3, cby+1, T.UFO_CONCRETE);
globalThis.player.x = cbx+3; globalThis.player.y = 88; globalThis.player.hpInvul = 0;
const solidBefore = (()=>{ let c=0; for(let x=cbx-12;x<=cbx+12;x++) for(let y=85;y<100;y++) if(getTile(x,y)!==T.AIR && getTile(x,y)!==T.WATER) c++; return c; })();
// fully armored heart: even an overwhelming blow glances off the plating
assert.ok(bosses.attackAt(cbx, cby, 99999), 'striking the sealed heart still registers as a hit');
assert.equal(bosses.metrics().alive, 1, 'the sealed heart shrugged the blow off');
assert.equal(mh.core.hp, mh.core.maxHp, 'the protected heart took no damage');
// carve a path: destroy one armor block beside the heart, then strike again
assert.ok(bosses.attackAt(cbx+1, cby, 999), 'the armor beside the heart can be broken');
companions.restore({v:1,list:[{x:cbx+1.5,y:cby+0.96,biomass:3,hp:88,seed:8891,laserCd:99,gasCd:99}]},getTile);
assert.ok(bosses.attackAt(cbx, cby, 99999), 'the exposed heart can be struck');
assert.equal(bosses.metrics().alive, 1, 'destroyed heart enters agony before the monster is removed');
assert.equal(bosses.metrics().killed, 0, 'kill credit waits for the delayed heart blast');
assert.ok(mh.dying, 'exposed heart is marked as dying');
assert.ok(mh.agonyMax >= CFG.HEART_AGONY_MIN && mh.agonyMax <= CFG.HEART_AGONY_MAX, 'heart agony lasts within the warning window');
assert.equal(mh.parts.length, 1, 'the block-built body collapses away from the dying heart');
assert.ok(bosses._debug().fallingBodyBlocks.length > 0, 'collapsed boss body becomes falling block debris');
assert.equal(globalThis.player.hp, 100, 'hero gets a moment to escape before the heart blast');
assert.equal(globalThis.player.xp, 0, 'XP is delayed until the heart actually explodes');
const solidDuringAgony = (()=>{ let c=0; for(let x=cbx-12;x<=cbx+12;x++) for(let y=85;y<100;y++) if(getTile(x,y)!==T.AIR && getTile(x,y)!==T.WATER) c++; return c; })();
assert.equal(solidDuringAgony, solidBefore, 'heart agony has not cratered the terrain yet');
step(20);
assert.equal(bosses.metrics().alive, 1, 'heart is still in agony during the early warning beat');
assert.equal(bosses.metrics().killed, 0, 'early warning beat still has no kill credit');
step(90);
const solidAfter = (()=>{ let c=0; for(let x=cbx-12;x<=cbx+12;x++) for(let y=85;y<100;y++) if(getTile(x,y)!==T.AIR && getTile(x,y)!==T.WATER) c++; return c; })();
assert.ok(solidAfter < solidBefore-10, `blast cratered the terrain (${solidBefore} -> ${solidAfter} solids)`);
assert.equal(getTile(300+9,91), T.CHEST_EPIC, 'chests survive the blast');
assert.equal(getTile(cbx+8,cby+1), T.BEDROCK, 'bedrock survives the boss heart blast');
assert.equal(getTile(cbx+7,cby+1), T.VOLCANO_MASTER_STONE, 'story stones survive the boss heart blast');
assert.equal(getTile(cbx+6,cby+1), T.OBSIDIAN, 'obsidian survives the boss heart blast');
assert.equal(getTile(cbx+5,cby+1), T.DIAMOND, 'diamond survives the boss heart blast');
assert.equal(getTile(cbx+4,cby+1), T.IRIDIUM, 'iridium survives the boss heart blast');
assert.equal(getTile(cbx+3,cby+1), T.AIR, 'boss heart blast can destroy UFO concrete');
assert.equal(globalThis.inv.ufoConcrete, 1, 'boss-destroyed UFO concrete yields summon material');
assert.equal(bosses.metrics().alive, 0, 'monster is gone after its heart burst');
assert.equal(bosses.metrics().killed, 1, 'kill recorded');
assert.ok(globalThis.player.hp < 100, `nearby hero took blast damage (hp=${globalThis.player.hp})`);
assert.ok(companions._debug.list()[0].hp<88, 'nearby companion also takes boss blast damage');
assert.ok(globalThis.player.xp > 0, `hero earned XP (+${globalThis.player.xp})`);

resetWorld();
const mhBar = bosses.forceSpawn(getTile, {x:300, seed:889, freeze:true, archetype:'walker'});
step(30);
for(const part of mhBar.parts) part.hp = part.maxHp;
mhBar.core.hp = mhBar.core.maxHp * 0.25;
const structuralHp = mhBar.parts.reduce((sum,part)=>sum+part.hp,0);
const structuralMax = mhBar.parts.reduce((sum,part)=>sum+part.maxHp,0);
assert.ok(structuralHp/structuralMax > 0.75, 'test setup keeps the old structural health bar mostly full');
const bossCtx = recordingCtx();
bosses.draw(bossCtx, globalThis.MM.TILE, ()=>true);
const healthBarFill = bossCtx.calls.find(call=>call.h===4 && call.style==='#ff4040');
const expectedBossBarW = (mhBar.maxDx-mhBar.minDx+1)*globalThis.MM.TILE*0.8;
assert.ok(healthBarFill, 'boss draw emits the enraged health bar fill');
assert.ok(Math.abs(healthBarFill.w - expectedBossBarW*0.25) < 0.001,
  `boss health bar follows heart HP, not remaining body blocks (${healthBarFill.w} vs ${expectedBossBarW*0.25})`);

// --- 7. Passive body contact: standing inside the beast is harmless ---
resetWorld();
const mc = bosses.forceSpawn(getTile, {x:300, seed:31, archetype:'walker'});
step(30);
globalThis.player.x = mc.x; globalThis.player.y = Math.round(mc.y)-1; globalThis.player.hpInvul = 0;
step(30);
assert.equal(globalThis.player.hp, 100, 'standing inside boss bulk does not deal passive contact damage');

// --- 8. Lag-spike physics: lands on a 1-tile-thick sky platform, never tunnels ---
resetWorld();
for(let x=290;x<=320;x++) setTile(x,80,T.STONE);   // thin floating platform
const mt = bosses.forceSpawn(getTile, {x:305, seed:42, freeze:true, archetype:'walker'});
mt.y = 70; mt.vy = 0;                               // drop it from above the platform
step(40, 0.1);                                      // worst-case clamped dt ticks
assert.ok(mt.y <= 79.6, `feet stopped on the thin platform (y=${mt.y.toFixed(1)})`);

// --- 9. Floater archetype: hovers above the terrain instead of walking ---
resetWorld();
const mfl = bosses.forceSpawn(getTile, {x:300, seed:64, archetype:'floater'});
step(30*8);
assert.ok(mfl.y < 87 && mfl.y > 70, `floater hovers above the ground (y=${mfl.y.toFixed(1)})`);

resetWorld();
globalThis.MM.wind = { speedAt(){ return 5; } };
const mwf = bosses.forceSpawn(getTile, {x:300, seed:64, archetype:'floater'});
mwf.speed = 0;
mwf.vx = 0;
step(20);
assert.ok(mwf.vx > 0.04, `strong wind pushes a floating boss body (vx=${mwf.vx.toFixed(3)})`);
delete globalThis.MM.wind;

// --- 10. Hopper archetype: travels in airborne hops ---
resetWorld();
const mh2 = bosses.forceSpawn(getTile, {x:300, seed:13, archetype:'hopper'});
let hopMinY=99, hopXMin=1e9, hopXMax=-1e9;
for(let s=0;s<30*10;s++){
  bosses.update(getTile,setTile,1/30);
  if(mh2.y<hopMinY)hopMinY=mh2.y; if(mh2.x<hopXMin)hopXMin=mh2.x; if(mh2.x>hopXMax)hopXMax=mh2.x;
}
assert.ok(hopMinY < 88.4, `hopper leaves the ground mid-hop (minY=${hopMinY.toFixed(1)})`);
assert.ok(hopXMax-hopXMin > 0.5, `hopper covers ground (moved ${(hopXMax-hopXMin).toFixed(1)} tiles)`);

// --- 11. Even forced spawns respect the hard population ceiling ---
resetWorld();
for(let i=0;i<12;i++) bosses.forceSpawn(getTile, {x:300+i*30, seed:i+1, freeze:true});
assert.ok(bosses.metrics().alive <= CFG.HARD_CAP, `forced spawns hard-capped (alive=${bosses.metrics().alive})`);

// --- 12. Perf smoke: a crowded minute simulates quickly ---
resetWorld();
for(let i=0;i<6;i++) bosses.forceSpawn(getTile, {x:250+i*40, seed:i+101});
const tPerf = Date.now();
step(30*60);
const perfMs = Date.now()-tPerf;
console.log('perf: 60 s with '+bosses.metrics().alive+' bosses simulated in '+perfMs+' ms');
assert.ok(perfMs < 5000, `boss update stays cheap (took ${perfMs} ms)`);

// --- 13. killNearest debug helper: full death path on the closest monster ---
resetWorld();
bosses.forceSpawn(getTile, {x:300, seed:21, freeze:true});
bosses.forceSpawn(getTile, {x:-200, seed:22, freeze:true});
step(30); // settle
globalThis.player.x = 290; // the x=300 beast is the nearest
const killedName = bosses.killNearest(getTile, setTile);
assert.ok(typeof killedName==='string' && killedName.length>3, 'killNearest returns the victim name');
assert.equal(bosses.metrics().alive, 2, 'killNearest starts the nearest monster death agony');
assert.equal(bosses.metrics().killed, 0, 'killNearest waits for delayed blast before kill credit');
assert.ok(bosses._debug().monsters.some(m=>m.dying && Math.abs(m.x-300)<30), 'nearest monster is the one in agony');
step(90);
assert.equal(bosses.metrics().alive, 1, 'only the nearest monster died');
assert.equal(bosses.metrics().killed, 1, 'kill recorded through the real death path');
assert.ok(Math.abs(bosses._debug().monsters[0].x - (-200)) < 30, 'the distant monster survived');
assert.equal(getTile(300, 92), T.AIR, 'detonation cratered the terrain under the victim');
assert.ok(bosses.killNearest(getTile, setTile), 'killNearest can start the last monster death agony');
step(90);
assert.equal(bosses.killNearest(getTile, setTile), null, 'killNearest drains to null when no monsters remain');

// --- 14. API safety: junk never throws; reset clears everything ---
assert.equal(bosses.attackAt(NaN, 5), false, 'attackAt rejects junk');
bosses.update('junk','junk',1/30);
bosses.update(getTile,setTile,'junk');
bosses.setCycleOverride('junk'); bosses.setCycleOverride(null);
const fsj = bosses.forceSpawn('junk'); // invalid accessor: falls back to MM.world
assert.ok(fsj===null || (fsj && fsj.parts.length>0), 'forceSpawn with junk accessor falls back gracefully');
bosses.reset();
assert.equal(bosses.metrics().alive+bosses.metrics().debris, 0, 'reset clears all monsters and debris');

// --- 15. Feeding & growth: a hungry beast drinks/eats nearby blocks and grows ---
resetWorld();
globalThis.player.x = 360;                        // hero out of sense range but within cull range
const mfe = bosses.forceSpawn(getTile, {x:300, seed:202, archetype:'walker'});
for(let x=303; x<=314; x++){ setTile(x,88,T.WATER); setTile(x,89,T.WATER); } // a pond to drink
const waterBefore = (()=>{ let c=0; for(let x=300;x<=320;x++) for(let y=85;y<90;y++) if(getTile(x,y)===T.WATER) c++; return c; })();
mfe.hunger = 1.2;                                 // make it peckish right now
const partsBeforeFeed = mfe.parts.length;
let sawFeedState=false;
for(let s=0;s<30*24;s++){ bosses.update(getTile,setTile,1/30); if(mfe.state==='feed') sawFeedState=true; if(mfe.dead) break; }
const waterAfter = (()=>{ let c=0; for(let x=300;x<=320;x++) for(let y=85;y<90;y++) if(getTile(x,y)===T.WATER) c++; return c; })();
const eatenDuringMeal = waterBefore - waterAfter;
assert.ok(sawFeedState, 'a hungry beast entered the feeding state');
assert.ok(eatenDuringMeal >= CFG.SATIATE_BITES, `the beast consumed a larger meal (${eatenDuringMeal} blocks)`);
assert.ok(mfe.parts.length > partsBeforeFeed, `feeding grew the body (${partsBeforeFeed} -> ${mfe.parts.length} parts)`);
assert.ok(mfe.grown >= Math.floor(CFG.SATIATE_BITES/CFG.GROW_PER_MEAL), `larger meal recorded larger growth (${mfe.grown})`);

// --- 16. Eating is peaceable: a feeding beast ignores a hero in its sense range ---
resetWorld();
const mpe = bosses.forceSpawn(getTile, {x:300, seed:202, archetype:'walker'});
for(let x=285; x<=296; x++){ setTile(x,88,T.WATER); setTile(x,89,T.WATER); } // pond on the far side from the hero
globalThis.player.x = mpe.x + 14; globalThis.player.y = 88; // inside sense: a non-feeding beast would hunt
globalThis.player.hp = 100; globalThis.player.hpInvul = 0;
mpe.hunger = 1.2;
let fedTicks=0, peacefulHp=true;
for(let s=0;s<30*10;s++){
  bosses.update(getTile,setTile,1/30);
  if(mpe.state==='hunt') break;                  // meal finished — hunting is now allowed
  if(mpe.state==='feed') fedTicks++;
  if(globalThis.player.hp<100) peacefulHp=false;
}
assert.ok(fedTicks > 10, `beast kept grazing instead of hunting the in-range hero (${fedTicks} feed ticks)`);
assert.ok(peacefulHp, 'a feeding beast dealt no damage to the hero standing in its sense range');

// --- 17. Balance: losing the legs on one side makes the body lean ---
resetWorld();
const mbz = bosses.forceSpawn(getTile, {x:300, seed:303, freeze:true, archetype:'walker'});
step(15);
let healthyTilt=0; for(let s=0;s<60;s++){ bosses.update(getTile,setTile,1/30); healthyTilt=Math.max(healthyTilt,Math.abs(mbz.tilt)); }
assert.ok(healthyTilt < 0.18, `a well-footed beast stands roughly upright (max tilt ${healthyTilt.toFixed(3)})`);
// shear off every leg on the left side
const bbx=Math.round(mbz.x), bby=Math.round(mbz.y);
let removedLegs=0;
for(const p of [...mbz.parts]){ if(p.role==='leg' && p.dx<0){ if(bosses.attackAt(bbx+p.dx, bby+p.dy, 999)) removedLegs++; } }
if(removedLegs>0 && !mbz.dead){
  let woundedTilt=0; for(let s=0;s<90;s++){ bosses.update(getTile,setTile,1/30); woundedTilt=Math.max(woundedTilt,Math.abs(mbz.tilt)); }
  assert.ok(woundedTilt > healthyTilt + 0.04, `a maimed beast struggles to stay upright (tilt ${woundedTilt.toFixed(3)} vs healthy ${healthyTilt.toFixed(3)})`);
} else {
  console.log('note: balance test seed had no removable left legs; skipped lean assertion');
}

// --- 18. Growth stays at/above the feet line; a grown beast still feels the ground ---
// (regression: a part grown at dy=1 lifted the body out of the terrain and then
//  groundedAt — which only read the dy===0 row — never registered ground again)
resetWorld();
globalThis.player.x = 360;                        // out of sense range, within cull range
const mgr = bosses.forceSpawn(getTile, {x:300, seed:404, archetype:'walker'});
for(let x=303; x<=314; x++){ setTile(x,88,T.WATER); setTile(x,89,T.WATER); }
mgr.hunger = 1.2;
for(let s=0; s<30*20 && mgr.grown<1; s++) bosses.update(getTile,setTile,1/30);
assert.ok(mgr.grown>=1, `beast grew while feeding (grown=${mgr.grown})`);
assert.ok(mgr.parts.every(p=>p.dy<=0), 'no part ever grows below the feet line');
let groundedSeen=false;
for(let s=0; s<30*3; s++){ bosses.update(getTile,setTile,1/30); if(mgr.onGround) groundedSeen=true; }
assert.ok(groundedSeen, 'a grown beast still registers as grounded');

// --- 19. Floaters bounce off tall cliffs instead of embedding in the rock ---
resetWorld();
const mflw = bosses.forceSpawn(getTile, {x:300, seed:64, archetype:'floater'});
for(let x=308; x<=310; x++) for(let y=50; y<90; y++) setTile(x,y,T.STONE); // 40-tall cliff
globalThis.player.x = 314; globalThis.player.y = 88;  // prey beyond the wall lures it in
let embedded=false;
for(let s=0; s<30*15 && !embedded; s++){
  bosses.update(getTile,setTile,1/30);
  const fbx=Math.round(mflw.x), fby=Math.round(mflw.y);
  for(const p of mflw.parts){
    const t=getTile(fbx+p.dx, fby+p.dy);
    if(t!==T.AIR && t!==T.WATER && t!==T.LEAF){ embedded=true; break; }
  }
}
assert.ok(!embedded, 'a floater never embeds itself inside a tall cliff');

// --- 20. Spawning into a column sealed under solid rock is rejected, not buried ---
resetWorld();
for(let x=494; x<=506; x++) for(let y=55; y<90; y++) setTile(x,y,T.STONE);
const sealed = bosses.forceSpawn(getTile, {x:500, seed:77});
assert.equal(sealed, null, 'spawn into a sealed column is rejected');
assert.equal(bosses.metrics().alive, 0, 'no buried monster was pushed into the world');

// --- 21. Hunger keeps accruing even while a nearby hero suppresses feeding ---
resetWorld();
const mhg = bosses.forceSpawn(getTile, {x:300, seed:11, archetype:'walker'});
globalThis.player.x = mhg.x; globalThis.player.y = 88;  // right on top: feeding suppressed
mhg.hunger = 0.2;
for(let s=0; s<30*4; s++){ bosses.update(getTile,setTile,1/30); globalThis.player.x = mhg.x; }
assert.ok(mhg.hunger > 0.3, `hunger accrues beside the hero (hunger=${mhg.hunger.toFixed(2)})`);

// --- 22. Smooth motion: a walker climbs stairs in hop arcs, never teleporting ---
// (regression: collision used to anchor the body to Math.round(x,y) and climb
//  ledges by teleporting y a whole tile at a time — block-by-block movement)
resetWorld();
for(let i=1;i<=6;i++) for(let x=304+i*4;x<=360;x++) for(let y=90-i;y<90;y++) setTile(x,y,T.STONE);
const msm = bosses.forceSpawn(getTile, {x:300, seed:77, archetype:'walker'});
let maxDx=0, maxDy=0, prevX=msm.x, prevY=msm.y;
for(let s=0;s<30*25 && msm.y>85.5;s++){
  globalThis.player.x = msm.x + 12; globalThis.player.y = msm.y - 2; // lure it up the stairs
  bosses.update(getTile,setTile,1/30);
  maxDx=Math.max(maxDx,Math.abs(msm.x-prevX)); maxDy=Math.max(maxDy,Math.abs(msm.y-prevY));
  prevX=msm.x; prevY=msm.y;
}
assert.ok(msm.y<=86.5, `walker hopped its way up the staircase (y=${msm.y.toFixed(1)})`);
assert.ok(maxDx<0.5, `horizontal motion stays continuous (max ${maxDx.toFixed(2)} tiles/frame)`);
assert.ok(maxDy<0.95, `vertical motion stays continuous — no whole-tile jumps (max ${maxDy.toFixed(2)} tiles/frame)`);

// --- 23. Fall damage: a drop deeper than FALL_SAFE body-heights bruises every part ---
resetWorld();
const mfd = bosses.forceSpawn(getTile, {x:300, seed:42, freeze:true, archetype:'walker'});
step(30); // settle flush on the ground
const hpSum = m=>m.parts.reduce((s,p)=>s+p.hp,0);
const partsB4=mfd.parts.length, hpB4=hpSum(mfd);
mfd.y -= mfd.height*CFG.FALL_SAFE - 1; mfd.vy=0;   // shallow drop: inside the safe range
step(30*3);
assert.equal(hpSum(mfd), hpB4, 'a shallow fall leaves the beast unhurt');
mfd.y -= mfd.height*CFG.FALL_SAFE + 6; mfd.vy=0;   // deep drop: well past the safe range
step(30*3);
assert.ok(hpSum(mfd) < hpB4, `a deep fall costs health (${hpB4} -> ${hpSum(mfd)})`);
assert.equal(mfd.parts.length, partsB4, 'fall damage bruises but never severs parts');
assert.ok(mfd.parts.every(p=>p.hp>=1), 'no part is destroyed outright by a fall');

// --- 24. Blindness: losing the eye ends hero-tracking; body overlap stays harmless ---
resetWorld();
const mbe = bosses.forceSpawn(getTile, {x:300, seed:77, freeze:true, archetype:'walker'});
step(30); // settle
assert.ok(mbe.hasEye, 'a fresh beast has its eye');
const eye = mbe.parts.find(p=>p.role==='eye');
assert.ok(eye, 'generator placed an eye part');
assert.ok(bosses.attackAt(Math.round(mbe.x)+eye.dx, Math.round(mbe.y)+eye.dy, 999), 'the eye can be struck out');
assert.ok(!mbe.hasEye, 'losing the eye blinds the beast');
mbe.frozen=false;
let hunted=false;
for(let s=0;s<30*5;s++){
  globalThis.player.x = mbe.x+10; globalThis.player.y = 88;  // well inside sense range
  bosses.update(getTile,setTile,1/30);
  if(mbe.state==='hunt') hunted=true;
}
assert.ok(!hunted, 'a blind beast never picks up the hero trail');
globalThis.player.hp=100; globalThis.player.hpInvul=0;
globalThis.player.x = mbe.x; globalThis.player.y = mbe.y-1;  // stand inside its bulk
bosses.update(getTile,setTile,1/30);
assert.equal(globalThis.player.hp, 100, 'a blind boss body still does not deal passive contact damage');

// --- 25. Rigid bodies: two overlapping beasts shove each other apart ---
resetWorld();
const ra = bosses.forceSpawn(getTile, {x:300, seed:51, freeze:true, archetype:'walker'});
const rb = bosses.forceSpawn(getTile, {x:302, seed:52, freeze:true, archetype:'walker'});
assert.ok(ra && rb, 'two beasts spawned on top of each other');
step(30*4);
const sepOx = Math.min(ra.x+ra.maxDx+1, rb.x+rb.maxDx+1) - Math.max(ra.x+ra.minDx, rb.x+rb.minDx);
const sepOy = Math.min(ra.y+1, rb.y+1) - Math.max(ra.y-ra.height+1, rb.y-rb.height+1);
assert.ok(sepOx<=0.05 || sepOy<=0.05, `rigid bodies separated (ox=${sepOx.toFixed(2)}, oy=${sepOy.toFixed(2)})`);

// --- 26. The hero lands on a beast's back, rides it, and a shaking fit hurls him off ---
resetWorld();
const rs = bosses.forceSpawn(getTile, {x:300, seed:53, archetype:'walker'});
step(30);
let stood=false, shaken=false, hurt=false;
globalThis.player.hp=100; globalThis.player.hpInvul=0; globalThis.player.vy=2; globalThis.player.vx=0;
globalThis.player.y = rs.y - rs.height - 1.5;
for(let s=0;s<30*20 && !hurt;s++){
  const pl=globalThis.player;
  pl.x = rs.x + (rs.minDx+rs.maxDx+1)/2;          // stay over the crown
  bosses.update(getTile,setTile,1/30);
  pl.vy += 22/30; pl.y += pl.vy/30;                // crude hero gravity
  pl.onGround=false;
  if(bosses.collideHero(pl,1/30)) stood=true;
  if(rs.shakeT>0) shaken=true;
  if(pl.hp<100) hurt=true;
}
assert.ok(stood, 'the hero stands on the beast (collideHero supports him)');
assert.ok(shaken, 'a ridden beast threw a shaking fit');
assert.ok(hurt, 'riding through the shake hurt the hero');
assert.ok(globalThis.player.vy<0 || globalThis.player.y<rs.y-rs.height-1, 'the shake knocked the hero away');

// --- 27. Curative grazing: a wounded, NOT hungry beast eats its own element to mend ---
resetWorld();
globalThis.player.x = 360;                          // out of sense range
let mhl=null, woundPart=null;
for(const seed of [202,203,204,205,206,207]){       // find a beast with curable flesh
  bosses.clearAll();
  const cand = bosses.forceSpawn(getTile, {x:300, seed, archetype:'walker'});
  woundPart = cand && cand.parts.find(pp=>pp.role!=='core' && (pp.blockType===T.GRASS||pp.blockType===T.SAND||pp.blockType===T.SNOW||pp.blockType===T.WOOD));
  if(woundPart){ mhl=cand; break; }
}
assert.ok(mhl && woundPart, 'found a beast with heal-able flesh');
step(30);
woundPart.hp = 1;
mhl.hunger = 0;                                     // explicitly not hungry: feeding is purely curative
const cureBlock = woundPart.blockType;              // for these elements eaten == grown type
for(let x=294; x<=312; x++){ if(getTile(x,89)===T.AIR) setTile(x,89,cureBlock); }
let curedOk=false;
for(let s=0;s<30*25 && !curedOk;s++){ bosses.update(getTile,setTile,1/30); if(woundPart.hp>=woundPart.maxHp) curedOk=true; }
assert.ok(curedOk, `the beast grazed its element back to health (hp=${woundPart.hp}/${woundPart.maxHp})`);

// --- 28. Ranged attack: a hunting beast rips a block from the terrain and throws it ---
resetWorld();
const mth = bosses.forceSpawn(getTile, {x:300, seed:99, archetype:'walker'});
step(30);
// a wall a walker can't climb keeps it at throwing distance from the stationary hero
for(let y=87;y<90;y++){ setTile(306,y,T.STONE); setTile(307,y,T.STONE); }
globalThis.player.x = 312; globalThis.player.y = 88; globalThis.player.vx=0;
globalThis.player.hp=100; globalThis.player.hpInvul=0;
let sawProjectile=false, blockHit=false;
for(let s=0;s<30*25 && !blockHit;s++){
  globalThis.player.x = 312; globalThis.player.y = 88;  // hold still on the far side
  bosses.update(getTile,setTile,1/30);
  if(bosses._debug().projectiles.length) sawProjectile=true;
  if(globalThis.player.hp<100) blockHit=true;
}
assert.ok(sawProjectile, 'the hunting beast hurled a block from the terrain');
assert.ok(blockHit, `a thrown block struck the hero (hp=${globalThis.player.hp})`);

// --- 29. Wind reaches boss-owned light objects too: hurled blocks and debris ---
resetWorld();
globalThis.MM.wind = { speedAt(){ return 5; } };
const dbg = bosses._debug();
dbg.projectiles.push({x:0,y:30,vx:0,vy:0,t:0,max:2,tile:T.LEAF,color:'#2faa2f',spin:0,dmg:1});
dbg.debris.push({x:0,y:30*20,vx:0,vy:0,c:'#999',t:0,max:1,s:3});
for(let i=0;i<10;i++) bosses.update(getTile,setTile,0.1);
assert.ok(dbg.projectiles.length && dbg.projectiles[0].vx>0.5, 'wind bends boss-thrown light blocks');
assert.ok(dbg.debris.length && dbg.debris[0].vx>0.5, 'wind carries boss debris particles');
delete globalThis.MM.wind;

console.log('OK: all boss monster simulation tests passed');
