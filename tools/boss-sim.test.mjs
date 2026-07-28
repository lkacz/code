// Deterministic Node test for the procedural boss-monster core (no browser needed).
// Verifies: seeded generation (large connected bodies, buried heart, determinism),
// day/night spawn scheduling at findable-but-not-adjacent distances, gravity and
// ground physics, roam/hunt behavior, part-level destruction with connectivity
// pruning (severed chunks break off, the beast fights on), the heart-detonation
// crater (bedrock/chests survive, hero hurt, XP paid), harmless body contact, API safety,
// feeding/growth/balance, and the hardening regressions: growth never sinks below
// the feet line (and grounding survives growth), floaters bounce off tall cliffs
// instead of embedding, sealed-column spawns are rejected, hunger accrues even
// while a nearby hero suppresses feeding. Also: hurled blocks are FOOD, not damage
// (the gravity gun mends or grows this beast instead of hurting it), the eye is one
// part wearing a seeded face, the heart's heat feed, and full-tile in-flight blocks.
// Run: node tools/boss-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

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
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSource,/if\(mineBossTarget\)\{ updateBossMining\(dt\); return; \}/,
  'the held-mining loop follows a captured boss block instead of a fixed world tile');
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

// --- 5b. Material rules: the shell is terrain, while eye/heart are weak points ---
resetWorld();
const mm = bosses.forceSpawn(getTile, {x:300, seed:556, freeze:true, archetype:'walker'});
step(30);
const mbx=Math.round(mm.x), mby=Math.round(mm.y);
const shell=mm.parts.find(p=>p.role!=='core' && p.role!=='eye' && bosses.partAt(mbx+p.dx,mby+p.dy)?.part===p);
assert.ok(shell && shell.blockType, 'boss exposes a material body tile to the mining cursor');
const shellX=mbx+shell.dx, shellY=mby+shell.dy, shellHp=shell.hp;
assert.equal(bosses.damageAt(shellX,shellY,999,{kind:'melee',source:'hero'}), 'blocked', 'ordinary melee stops on a boss body block');
assert.equal(shell.hp,shellHp,'melee cannot damage the material shell');
assert.equal(bosses.damageAt(shellX,shellY,999,{kind:'electric',source:'hero'}), 'blocked', 'electric weapons stop on a boss body block');
assert.equal(shell.hp,shellHp,'electric damage cannot erode the material shell');
let arrowAnchor=null;
assert.equal(bosses.damageAt(shellX,shellY,999,{kind:'arrow',tier:'wood',pierceLeft:0,source:'hero',onTarget(target,family,isAlive,anchor){
  arrowAnchor={target,family,isAlive,anchor};
}}), 'blocked', 'ordinary arrows hit the shell like terrain');
assert.equal(shell.hp,shellHp,'ordinary arrows cannot damage the material shell');
assert.equal(arrowAnchor && arrowAnchor.target,mm,'a shell hit exposes the moving boss body to the arrow system');
assert.equal(arrowAnchor && arrowAnchor.family,'boss','the projectile target is tagged as a block boss');
assert.ok(arrowAnchor && Math.abs(arrowAnchor.anchor.localX-(shell.dx+0.5))<1e-9
  && Math.abs(arrowAnchor.anchor.localY-(shell.dy+0.5))<1e-9,'the anchor identifies the exact struck block in boss-local coordinates');
assert.equal(arrowAnchor.isAlive(mm),true,'the struck block initially keeps an embedded arrow attached');
assert.equal(bosses.damageAt(shellX,shellY,1,{kind:'arrow',tier:'iridium',pierceLeft:3,source:'hero'}), 'pierced', 'iridium arrows pierce a compatible boss block');
assert.ok(!mm.parts.includes(shell),'iridium piercing removes the dynamic block');
assert.equal(arrowAnchor.isAlive(mm),false,'destroying the struck block releases arrows anchored to it');

resetWorld();
const mined = bosses.forceSpawn(getTile, {x:300, seed:557, freeze:true, archetype:'walker'});
step(30);
const minedBx=Math.round(mined.x), minedBy=Math.round(mined.y);
const minedPart=mined.parts.find(p=>p.role!=='core' && p.role!=='eye' && bosses.partAt(minedBx+p.dx,minedBy+p.dy)?.part===p);
assert.ok(minedPart,'a mineable shell part is available');
assert.ok(bosses.mineAt(minedBx+minedPart.dx,minedBy+minedPart.dy),'a completed pickaxe mining cycle breaks the boss block');
assert.ok(!mined.parts.includes(minedPart),'pickaxe mining removes the body tile in one completed cycle');

resetWorld();
const movingMine = bosses.forceSpawn(getTile, {x:300, seed:558, freeze:true, archetype:'walker'});
step(30);
const movingBx=Math.round(movingMine.x), movingBy=Math.round(movingMine.y);
const movingPart=movingMine.parts.find(p=>p.role!=='core' && p.role!=='eye'
  && bosses.partAt(movingBx+p.dx,movingBy+p.dy)?.part===p);
assert.ok(movingPart,'a moving boss exposes a mineable shell part');
const movingTarget=bosses.partAt(movingBx+movingPart.dx,movingBy+movingPart.dy);
const targetBefore=bosses.resolvePartTarget(movingTarget);
assert.ok(targetBefore && targetBefore.part===movingPart,'pickaxe captures the exact boss-local block');
movingMine.x+=2.25;
const targetAfter=bosses.resolvePartTarget(movingTarget);
assert.ok(targetAfter && targetAfter.part===movingPart,'captured pickaxe target survives boss movement');
assert.ok(Math.abs(targetAfter.x-targetBefore.x-2.25)<1e-9,'captured pickaxe target follows the boss live position');
assert.ok(bosses.mineTarget(movingTarget),'completed mining strikes the captured block after the boss moves');
assert.ok(!movingMine.parts.includes(movingPart),'moving-boss mining removes the originally selected block');
assert.equal(bosses.resolvePartTarget(movingTarget),null,'a destroyed block invalidates its mining target');

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
assert.ok(bosses.damageAt(cbx, cby, 99999,{kind:'melee',source:'hero'}), 'a weapon striking the sealed heart still registers as a hit');
assert.equal(bosses.metrics().alive, 1, 'the sealed heart shrugged the blow off');
assert.equal(mh.core.hp, mh.core.maxHp, 'the protected heart took no damage');
// carve a path: destroy one armor block beside the heart, then strike again
assert.ok(bosses.attackAt(cbx+1, cby, 999), 'the armor beside the heart can be broken');
companions.restore({v:1,list:[{x:cbx+1.5,y:cby+0.96,biomass:3,hp:88,seed:8891,laserCd:99,gasCd:99}]},getTile);
assert.ok(bosses.damageAt(cbx, cby, 99999,{kind:'melee',source:'hero'}), 'the exposed heart can be destroyed by a weapon');
assert.equal(bosses.metrics().alive, 1, 'destroyed heart enters agony before the monster is removed');
assert.equal(bosses.metrics().killed, 0, 'kill credit waits for the delayed heart blast');
assert.ok(mh.dying, 'exposed heart is marked as dying');
assert.ok(mh.agonyMax >= CFG.HEART_AGONY_MIN && mh.agonyMax <= CFG.HEART_AGONY_MAX, 'heart agony lasts within the warning window');
assert.equal(mh.parts.length, 1, 'the block-built body collapses away from the dying heart');
assert.ok(mh.heartItem && Number.isFinite(mh.heartItem.x) && Number.isFinite(mh.heartItem.y), 'destroyed heart detaches as a physical item');
assert.ok(bosses._debug().fallingBodyBlocks.length > 0, 'collapsed boss body becomes falling block debris');
assert.equal(globalThis.player.hp, 100, 'hero gets a moment to escape before the heart blast');
assert.equal(globalThis.player.xp, 0, 'XP is delayed until the heart actually explodes');
const solidDuringAgony = (()=>{ let c=0; for(let x=cbx-12;x<=cbx+12;x++) for(let y=85;y<100;y++) if(getTile(x,y)!==T.AIR && getTile(x,y)!==T.WATER) c++; return c; })();
assert.equal(solidDuringAgony, solidBefore, 'heart agony has not cratered the terrain yet');
let heartMinY=mh.heartItem.y, heartMaxY=mh.heartItem.y, heartFalling=false;
for(let i=0;i<20;i++){
  step(1);
  heartMinY=Math.min(heartMinY,mh.heartItem.y);
  heartMaxY=Math.max(heartMaxY,mh.heartItem.y);
  if(mh.heartItem.vy>0.2) heartFalling=true;
}
assert.equal(bosses.metrics().alive, 1, 'heart is still in agony during the early warning beat');
assert.equal(bosses.metrics().killed, 0, 'early warning beat still has no kill credit');
assert.ok(heartFalling && heartMaxY-heartMinY>0.25,'detached heart visibly transitions into a gravity-driven fall');
assert.ok(Math.abs(mh.heartItem.vy)<3.2,'heavy heart settles with very little bounce instead of ricocheting');
globalThis.player.xp='corrupt-save-value';
const oldBlastApis={mobs:MM.mobs,invasions:MM.invasions,mechs:MM.mechs,vitalsHud:MM.vitalsHud};
const creatureBlastCalls=[];
let xpNotice=null;
MM.mobs={blastRadius(x,y,r,dmg,opts){ creatureBlastCalls.push({family:'mobs',x,y,r,dmg,opts}); return 1; }};
MM.invasions={blastRadius(x,y,r,dmg,opts){ creatureBlastCalls.push({family:'invasions',x,y,r,dmg,opts}); return true; }};
MM.mechs={blastRadius(x,y,r,dmg,opts){ creatureBlastCalls.push({family:'mechs',x,y,r,dmg,opts}); return 1; }};
MM.vitalsHud={noteXpAward(detail){ xpNotice=detail; }};
let lastHeart={x:mh.heartItem.x,y:mh.heartItem.y};
for(let i=0;i<90 && bosses.metrics().alive;i++){
  lastHeart={x:mh.heartItem.x,y:mh.heartItem.y};
  step(1);
}
const blast=bosses._debug().blasts[bosses._debug().blasts.length-1];
assert.ok(blast && Math.abs(blast.x/MM.TILE-lastHeart.x)<1 && Math.abs(blast.y/MM.TILE-lastHeart.y)<1,'detonation follows the physical heart to its final position');
assert.deepEqual(new Set(creatureBlastCalls.map(c=>c.family)),new Set(['mobs','invasions','mechs']),'boss blast damages mobs, invasion squads and mechs');
assert.ok(creatureBlastCalls.every(c=>c.opts.source==='boss' && c.opts.cause==='boss_blast'),'collateral damage records the boss explosion source');
assert.equal(xpNotice && xpNotice.amount,globalThis.player.xp,'boss XP emits a visible XP-award notification with the exact gain');
assert.ok(Number.isFinite(globalThis.player.xp) && globalThis.player.xp>0,'boss XP award recovers a malformed saved XP value instead of producing NaN');
MM.mobs=oldBlastApis.mobs; MM.invasions=oldBlastApis.invasions; MM.mechs=oldBlastApis.mechs; MM.vitalsHud=oldBlastApis.vitalsHud;
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
assert.ok(bosses.damageAt(Math.round(mbe.x)+eye.dx, Math.round(mbe.y)+eye.dy, 999,{kind:'melee',source:'hero'}), 'the eye can be struck out with a weapon');
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

// --- 30. Gravity-gun blocks are FOOD, not damage --------------------------------
// The beast is built of blocks, so a hurled block is masonry: it mends the plate
// it struck, or bolts on as new mass of the very material thrown. Nothing else
// about the damage chain may change — a plain arrow still bounces off the shell.
resetWorld();
const mAb = bosses.forceSpawn(getTile, {x:400, seed:8123, freeze:true});
const gravOpts = (tid)=>({kind:'arrow', tier:'gravity', source:'hero', grav:true, gravTid:tid});
const shellAb = mAb.parts.find(p=>p.role!=='core' && p.role!=='eye' && p.dy<0);
assert.ok(shellAb, 'found a shell plate to feed');
const abX = Math.round(mAb.x)+shellAb.dx, abY = Math.round(mAb.y)+shellAb.dy;
const partsBeforeAb = mAb.parts.length, hpBeforeAb = shellAb.hp, coreMaxBefore = mAb.core.maxHp;
assert.equal(bosses.damageAt(abX, abY, 999, gravOpts(T.DIAMOND)), 'absorbed',
  'a thrown block is absorbed, never blocked and never damaging');
assert.equal(shellAb.hp, hpBeforeAb, 'an absorbed block takes no HP off the plate it hit');
assert.equal(mAb.parts.length, partsBeforeAb+1, 'a healthy beast turns the block into new body mass');
const grownPart = mAb.parts[mAb.parts.length-1];
assert.equal(grownPart.blockType, T.DIAMOND, 'the new mass is made of the material that was thrown');
assert.ok(mAb.core.maxHp > coreMaxBefore, 'growing on thrown blocks toughens the heart');
assert.ok(mAb.absorbed===1 && mAb.absorbT>0, 'the swallow is counted and flashes');
// a WOUNDED plate is mended instead — the block plugs the hole it landed in
shellAb.hp = shellAb.maxHp*0.4;
const partsBeforeHeal = mAb.parts.length;
assert.equal(bosses.damageAt(abX, abY, 999, gravOpts(T.STONE)), 'absorbed', 'a wounded plate still absorbs');
assert.ok(shellAb.hp > shellAb.maxHp*0.4, 'the block mends the plate it struck');
assert.equal(mAb.parts.length, partsBeforeHeal, 'mending spends the block instead of growing');
// only the gravity marker unlocks this: every other projectile keeps its behaviour
assert.equal(bosses.damageAt(abX, abY, 5, {kind:'arrow', tier:'wood', source:'hero'}), 'blocked',
  'an ordinary arrow still stops dead on the shell');
assert.equal(bosses.damageAt(abX, abY, 5, {kind:'arrow', tier:'gravity', source:'hero'}), 'blocked',
  'tier alone never feeds the beast — the grav/gravTid pair is the marker');
assert.equal(bosses.damageAt(abX, abY, 5, gravOpts(0)), 'blocked', 'a block with no tile id is not food');
// the sealed heart column swallows too, rather than "glancing off"
const sealedM = bosses.forceSpawn(getTile, {x:520, seed:4242, freeze:true});
assert.ok(sealedM, 'second beast spawned');
const cx0 = Math.round(sealedM.x)+sealedM.core.dx, cy0 = Math.round(sealedM.y)+sealedM.core.dy;
assert.equal(bosses.damageAt(cx0, cy0, 999, gravOpts(T.STONE)), 'absorbed',
  'a block aimed at the sealed heart is eaten by the plating, not shrugged off');
// growth cap still bounds it: feeding can never grow a beast without limit
const mCap = bosses.forceSpawn(getTile, {x:640, seed:77, freeze:true});
const capShell = mCap.parts.find(p=>p.role!=='core' && p.role!=='eye' && p.dy<0);
for(let i=0;i<CFG.GROWTH_CAP+12;i++){
  bosses.damageAt(Math.round(mCap.x)+capShell.dx, Math.round(mCap.y)+capShell.dy, 999, gravOpts(T.STONE));
}
assert.ok(mCap.grown <= CFG.GROWTH_CAP, `fed growth respects GROWTH_CAP (${mCap.grown})`);
assert.ok(mCap.parts.every(p=>p.dy<=0), 'fed growth never sinks a part below the feet line either');

// --- 31. The eye: one part, a seeded face ---------------------------------------
// Variety lives in a SPEC, never in extra parts — turrets, status damage and the
// blinding rule all assume exactly one part carries role 'eye'.
resetWorld();
const mEyeA = bosses.forceSpawn(getTile, {x:200, seed:1234, freeze:true});
const mEyeB = bosses.forceSpawn(getTile, {x:260, seed:1234, freeze:true});
const mEyeC = bosses.forceSpawn(getTile, {x:320, seed:9999, freeze:true});
assert.equal(mEyeA.parts.filter(p=>p.role==='eye').length, 1, 'exactly one part is the eye');
assert.ok(mEyeA.eyeSpec, 'the generator rolls an eye spec');
assert.deepEqual(mEyeA.eyeSpec, mEyeB.eyeSpec, 'the same seed always grows the same face');
assert.notDeepEqual(mEyeA.eyeSpec, mEyeC.eyeSpec, 'a different seed grows a different face');
const EYE_SOCKET_NAMES = ['round','almond','wide'];
const EYE_PUPIL_NAMES = ['round','slit','cross','ring'];
for(const seed of [1,2,3,17,64,777,4242,90210]){
  const me = bosses.forceSpawn(getTile, {x:900+seed%40, seed, freeze:true});
  if(!me) continue;
  const s = me.eyeSpec;
  assert.ok(EYE_SOCKET_NAMES.includes(s.socket), 'socket comes from the known vocabulary: '+s.socket);
  assert.ok(EYE_PUPIL_NAMES.includes(s.pupil), 'pupil comes from the known vocabulary: '+s.pupil);
  assert.ok(s.lobes>=1 && s.lobes<=2, 'a compound eye stays within 1-2 pupils — three is mush at 20 px');
  assert.ok((s.pupil!=='slit' && s.pupil!=='ring') || s.lobes===1, 'a slit or ring pupil never splits into lobes');
  assert.ok(/^#[0-9a-f]{6}$/i.test(s.iris), 'the iris is a hex colour the emissive queue can parse: '+s.iris);
  assert.ok(/^#[0-9a-f]{6}$/i.test(s.sclera) && /^#[0-9a-f]{6}$/i.test(s.rim), 'sclera and rim are hex too');
  assert.ok(s.size>0.65 && s.size<=0.89, 'the socket fits inside its tile');
  assert.ok(s.squash>=0.80 && s.squash<=1.20, 'no beast gets a socket so flat the iris turns into a speck');
  assert.ok(s.blinkEvery>=2.6 && s.blinkEvery<=6.9, 'each beast owns its own blink clock');
  assert.equal(me.parts.filter(p=>p.role==='eye').length, 1, 'every seed still yields exactly one eye part');
}
// The face is AXIS-ALIGNED and centred on its own tile. An earlier cut rotated
// the socket while the gaze stayed a world-space direction, so the iris slid off
// the white it lives in; a brow was faked by shifting the whole eye down, which
// pulled it off the rim. Both are pinned dead.
const bossEyeSrc = await readFile(new URL('../src/engine/bosses.js', import.meta.url), 'utf8');
const iEyeFn = bossEyeSrc.indexOf('function drawBossEye(');
const eyeBody = bossEyeSrc.slice(iEyeFn, bossEyeSrc.indexOf('\n  }', iEyeFn));
assert.ok(iEyeFn > 0 && eyeBody.length > 400, 'the eye renderer was located');
assert.ok(!/ctx\.rotate\(/.test(eyeBody), 'the eye socket is never rotated — the gaze is a world-space direction');
assert.match(eyeBody, /ctx\.translate\(cx,cy\);/, 'the socket is centred on its own tile, with no brow offset');
assert.ok(!/tiltA|lidTop/.test(bossEyeSrc), 'the canted socket and the shifted brow stay dead');
// The heart's aura must never be clipped into a box: every radial gradient in
// the boss renderer paints a rect derived from its OWN radius. A fixed 3-tile
// box around a radius that grew past it cut the glow off square.
assert.match(bossEyeSrc, /ctx\.fillStyle=g; ctx\.fillRect\(gcx-gR,gcy-gR,gR\*2,gR\*2\);/,
  'the attached heart paints its glow into a box sized from the gradient radius');
assert.match(bossEyeSrc, /ctx\.fillRect\(-hR,-hR,hR\*2,hR\*2\);/,
  'the detached heart does the same');
assert.ok(!/fillRect\(X-TILE,Y-TILE,TILE\*3,TILE\*3\)/.test(bossEyeSrc), 'the clipped 3x3 aura box is gone');
assert.ok(!/fillRect\(-TILE\*1\.8,-TILE\*1\.8,TILE\*3\.6,TILE\*3\.6\)/.test(bossEyeSrc), 'so is its detached twin');
// blinding still works with the new face
resetWorld();
const mBlind = bosses.forceSpawn(getTile, {x:300, seed:1234, freeze:true});
const blindEye = mBlind.parts.find(p=>p.role==='eye');
assert.ok(bosses.damageAt(Math.round(mBlind.x)+blindEye.dx, Math.round(mBlind.y)+blindEye.dy, 999, {kind:'melee',source:'hero'}),
  'the procedural eye is still a strikeable weak point');
assert.ok(!mBlind.hasEye, 'striking it out still blinds the beast');
// ...but it is NOT a way past the absorb rule: a thrown block feeds the eye too
resetWorld();
const mEyeFeed = bosses.forceSpawn(getTile, {x:300, seed:1234, freeze:true});
const feedEye = mEyeFeed.parts.find(p=>p.role==='eye');
assert.equal(bosses.damageAt(Math.round(mEyeFeed.x)+feedEye.dx, Math.round(mEyeFeed.y)+feedEye.dy, 999, gravOpts(T.STONE)),
  'absorbed', 'the gun cannot pop the eye either — the beast eats that block as well');
assert.ok(mEyeFeed.hasEye, 'the eye survives a thrown block');

// --- 32. Heart heat: the shimmer feed only fires on a hot heart -------------------
// heatSources() is read by main.js BEFORE the boss draws, so it must come from
// state. A sealed, healthy heart is warm; a breached or dying one shimmers.
resetWorld();
const mHeat = bosses.forceSpawn(getTile, {x:300, seed:1234, freeze:true});
assert.deepEqual(bosses.heatSources(mHeat.x, 60), [], 'a sealed, healthy heart raises no heat haze');
// carve one armour neighbour away: the heart is exposed and starts radiating
const ring = mHeat.parts.find(p=>Math.abs(p.dx-mHeat.core.dx)+Math.abs(p.dy-mHeat.core.dy)===1);
bosses.damageAt(Math.round(mHeat.x)+ring.dx, Math.round(mHeat.y)+ring.dy, 999, {kind:'pickaxe',breakTerrain:true,source:'hero'});
const hot = bosses.heatSources(mHeat.x, 60);
assert.equal(hot.length, 1, 'a breached heart becomes a live heat emitter');
assert.ok(hot[0].strength>0.4 && hot[0].strength<=1, 'the emitter carries its own strength: '+hot[0].strength);
assert.ok(Math.abs(hot[0].x-(mHeat.x+mHeat.core.dx+0.5))<0.01, 'the emitter sits on the heart, in tile coords');
assert.deepEqual(bosses.heatSources(mHeat.x+400, 60), [], 'emitters are x-culled by the caller radius');
assert.ok(bosses.heatSources(mHeat.x, 60) === hot, 'the emitter list is pooled scratch, not a fresh array per frame');

// --- 33. In-flight blocks draw at full tile size ---------------------------------
// A block in the air is the same block it was in the ground. The renderer proves
// it by emitting a fill exactly TILE wide for a hurled block.
resetWorld();
const TILEpx = globalThis.MM.TILE;
const flightDbg = bosses._debug();
flightDbg.projectiles.push({x:10,y:30,vx:0,vy:0,t:0,max:2,tile:T.STONE,color:'#888a90',spin:0,dmg:1});
const flightCtx = recordingCtx();
bosses.draw(flightCtx, TILEpx, ()=>true);
const fullBlock = flightCtx.calls.find(c=>c.style==='#888a90' && c.w===TILEpx && c.h===TILEpx);
assert.ok(fullBlock, 'a hurled block renders at the full tile size it was ripped from');
assert.ok(Math.abs(fullBlock.x+TILEpx/2)<0.001 && Math.abs(fullBlock.y+TILEpx/2)<0.001,
  'the hurled block is centred on its own position');
assert.ok(!flightCtx.calls.some(c=>c.style==='#888a90' && Math.abs(c.w-TILEpx*0.7)<0.001),
  'the old 0.7-tile pebble draw is gone');

// --- 34. A LEANING beast is hit and stood on where it is DRAWN -------------------
// The lean used to live only in the renderer: at a normal maimed lean (~0.26 rad)
// a 6-tall beast's head was painted 1.6 tiles from the lattice the game actually
// hit-tested, so you struck the block behind the one you could see and a rider
// stood in mid-air. Every hero-facing query now maps through the same transform
// the renderer rotates by. These assertions are the contract.
resetWorld();
const mTilt = bosses.forceSpawn(getTile, {x:300, seed:1234, freeze:true, archetype:'walker'});
assert.ok(mTilt, 'tilt-case beast spawned');
step(20);                                   // settle it onto the ground
// upright first: the transform must be EXACTLY identity, or every other pin lies
mTilt.tilt = 0; mTilt.tiltV = 0;
const uprightPart = mTilt.parts.find(p=>p.dy<=-2 && p.role!=='core') || mTilt.parts[0];
const upTgt = bosses.resolvePartTarget({boss:mTilt, part:uprightPart});
assert.ok(Math.abs(upTgt.x-(mTilt.x+uprightPart.dx+0.5))<1e-12
       && Math.abs(upTgt.y-(mTilt.y+uprightPart.dy+0.5))<1e-12,
  'an upright beast reports its raw lattice position, bit for bit');
// now lean it the way a maimed beast leans
mTilt.tilt = 0.26; mTilt.tiltV = 0;
const leanTgt = bosses.resolvePartTarget({boss:mTilt, part:uprightPart});
const latticeX = mTilt.x+uprightPart.dx+0.5, latticeY = mTilt.y+uprightPart.dy+0.5;
const drift = Math.hypot(leanTgt.x-latticeX, leanTgt.y-latticeY);
assert.ok(drift > 0.35, `the lean genuinely moves a high part (${drift.toFixed(2)} tiles)`);
// A census over the WHOLE body, which is the honest form of this claim: click
// where each part is drawn and you must hit that part. A rotated body quantised
// onto a tile grid legitimately lets a few land on an immediate lattice
// neighbour, but none may miss the beast altogether.
let hitExact=0, hitNear=0, hitBoss=0, hitTotal=0;
for(const p of mTilt.parts){
  if(!(p.hp>0)) continue;
  hitTotal++;
  const at = bosses.resolvePartTarget({boss:mTilt, part:p});
  const hit = bosses.partAt(Math.floor(at.x), Math.floor(at.y));
  if(!hit) continue;
  if(hit.boss===mTilt) hitBoss++;
  if(hit.part===p) hitExact++;
  else if(Math.abs(hit.part.dx-p.dx)+Math.abs(hit.part.dy-p.dy)<=1) hitNear++;
}
assert.ok(hitTotal>20, 'the census covered a real body');
assert.equal(hitBoss, hitTotal, 'every drawn part tile belongs to the beast — no clicks fall through it');
assert.ok(hitExact >= hitTotal*0.85,
  `clicking a leaning beast where it is drawn hits that very block (${hitExact}/${hitTotal} exact)`);
assert.equal(hitExact+hitNear, hitTotal,
  'and the remainder land on an immediate lattice neighbour, never somewhere else');
// The regression this replaces: on the untilted lattice most of those probes
// answered for the wrong block. If this ever climbs back up, the lean has been
// dropped out of the hit test again.
let latticeHits=0;
for(const p of mTilt.parts){
  if(!(p.hp>0)) continue;
  const hit = bosses.partAt(Math.floor(mTilt.x+p.dx+0.5), Math.floor(mTilt.y+p.dy+0.5));
  if(hit && hit.part===p) latticeHits++;
}
assert.ok(latticeHits < hitTotal*0.3,
  `the untilted lattice no longer answers for a leaning body (${latticeHits}/${hitTotal} still coincide)`);
// a weapon resolves through the same lean the cursor does
const hpBeforeLean = mTilt.parts.reduce((s,p)=>s+p.hp,0);
bosses.damageAt(Math.floor(leanTgt.x), Math.floor(leanTgt.y), 2, {kind:'pickaxe', source:'hero'});
assert.ok(mTilt.parts.reduce((s,p)=>s+p.hp,0) < hpBeforeLean,
  'damageAt resolves through the same lean as partAt');
// the foot is never drawn below the ground its lattice rests on: the lean is
// taken about the feet AND lifted by the sagitta, so the body stands on its
// down-slope leg instead of sinking that leg into the terrain
for(const p of mTilt.parts){
  if(p.dy!==0) continue;
  const foot = bosses.resolvePartTarget({boss:mTilt, part:p});
  if(!foot) continue;
  assert.ok(foot.y <= mTilt.y+0.5+1e-9,
    `a leaning beast never buries a foot below its own feet line (${foot.y.toFixed(3)} vs ${(mTilt.y+0.5).toFixed(3)})`);
}
// the hero lands on the LEANING surface. Drop him over the drawn position of a
// top part and he must come to rest on it.
const crown = mTilt.parts.reduce((a,b)=> (b.dy<a.dy? b:a), mTilt.parts[0]);
const crownAt = bosses.resolvePartTarget({boss:mTilt, part:crown});
const rider = {x:crownAt.x, y:crownAt.y-3, vx:0, vy:0, w:0.7, h:0.95, onGround:false, jumpCount:0, hp:100, maxHp:100, hpInvul:99};
let landedOn=false;
for(let s=0;s<90 && !landedOn;s++){
  rider.vy += 22/60; rider.y += rider.vy/60;
  if(bosses.collideHero(rider, 1/60)) landedOn=true;
}
assert.ok(landedOn, 'the hero lands on a leaning beast at all');
const crownNow = bosses.resolvePartTarget({boss:mTilt, part:crown});
// He rests one part-half plus one hero-half below the DRAWN crown centre — the
// same relationship an upright beast gives. The tolerance is tight on purpose:
// landing on the untilted lattice instead puts this figure near 0 rather than 1,
// so a regression that drops the transform out of collideHero fails loudly here.
const restGap = crownNow.y - rider.y;
assert.ok(Math.abs(restGap-0.99) < 0.12,
  `the hero rests ON the drawn crown (gap ${restGap.toFixed(3)}, expected ~0.99)`);
const untiltedCrownY = mTilt.y+crown.dy+0.5;
assert.ok(Math.abs(crownNow.y-untiltedCrownY) > 0.5,
  `and the drawn crown is a genuinely different place from the lattice crown (${Math.abs(crownNow.y-untiltedCrownY).toFixed(2)} tiles apart)`);
assert.ok(Math.abs(rider.y-(untiltedCrownY-0.5-0.475)) > 0.5,
  'the hero is NOT standing where the untilted lattice would have put him');
// the whole thing is reversible: what goes out through the lean comes back in
const probe = bosses.partAt(Math.floor(crownNow.x), Math.floor(crownNow.y));
assert.ok(probe && probe.boss===mTilt, 'the forward and inverse maps agree on a leaning body');

console.log('OK: all boss monster simulation tests passed');
