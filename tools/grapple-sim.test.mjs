// Grapple hook — deterministic self-movement simulation.
//
// Contract: a fired rope hook flies nearly straight, ANCHORS on the first solid
// tile it meets, then reels the hero's OWN body toward the anchor at a capped
// speed that stays under the multiplayer pose envelope (30 t/s). It closes
// distance monotonically, detaches on arrival / manual let-go (keeping the reel
// momentum as a fling) / rope-snap (anchor tile removed) / open-air fizzle, and
// NEVER writes the world (no setTile) or reads window.player — so it needs no
// hero-act intent and no host seam (pure guest-authoritative self-movement).
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

function makeCtx(){
  return {
    fillStyle:'', strokeStyle:'', lineWidth:1, globalAlpha:1,
    save(){}, restore(){}, fillRect(){}, drawImage(){}, beginPath(){}, moveTo(){},
    lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, arc(){}, stroke(){},
    translate(){}, rotate(){},
    createLinearGradient(){ return {addColorStop(){}}; },
    createRadialGradient(){ return {addColorStop(){}}; },
    canvas:{width:800,height:600}
  };
}
globalThis.document = {
  createElement(){ return {width:0, height:0, getContext(){ return makeCtx(); }}; }
};

const { T } = await import('../src/constants.js');
const { grapple } = await import('../src/engine/grapple.js');
const { weapons } = await import('../src/engine/weapons.js');
assert.ok(grapple, 'grapple module exports');

const CFG = grapple.config;
const REEL = CFG.REEL_SPEED;
assert.ok(REEL < 30, 'reel cap is deliberately below the 30 t/s multiplayer pose envelope');

// A world whose right half (x>=20) is a solid stone wall; everything else air.
const wallRight = (x,y)=> x>=20 ? T.STONE : T.AIR;
const allAir = ()=> T.AIR;
const makePlayer = ()=> ({x:5,y:10,w:0.8,h:1.8,vx:0,vy:0,facing:1});
const state = ()=> grapple._debug.state();

// Emulate physics(): step sets velocity, then the engine integrates position.
function integrate(p, dt){ p.x += p.vx*dt; p.y += p.vy*dt; }

// --- 1. Fire → fly → anchor on the wall ------------------------------------
{
  grapple.reset();
  const p = makePlayer();
  assert.ok(grapple.fire(p, 30, 10), 'fire launches a hook');
  assert.ok(grapple.isActive(), 'active after fire');
  assert.equal(state().phase, 'fly', 'a fresh hook is in flight');
  let anchored = false;
  for(let i=0;i<240 && !anchored;i++){ grapple.step(p, 1/60, wallRight, {}); anchored = grapple.anchored(); }
  assert.ok(anchored, 'the hook anchors on the wall');
  const s = state();
  assert.ok(s.ax >= 19.5 && s.ax < 21, 'anchor sits at the wall face (~x=20), got '+s.ax);
  assert.equal(wallRight(s.atx, s.aty), T.STONE, 'the remembered anchor tile is solid');
  assert.ok(p.vx === 0 && p.vy === 0, 'the body does not move during flight (only the hook flies)');
}

// --- 2. Reel closes distance monotonically, capped, under the MP envelope ---
{
  grapple.reset();
  const p = makePlayer();
  grapple.fire(p, 30, 10);
  for(let i=0;i<240 && !grapple.anchored();i++) grapple.step(p, 1/60, wallRight, {});
  assert.ok(grapple.anchored(), 'anchored before reeling');
  const ax = state().ax;
  let prevDx = Infinity, maxSpeed = 0, arrived = false, reason = null;
  for(let i=0;i<900;i++){
    const r = grapple.step(p, 1/60, wallRight, {});
    if(r.released){ arrived = true; reason = r.reason; break; }
    const sp = Math.hypot(p.vx, p.vy);
    if(sp > maxSpeed) maxSpeed = sp;
    integrate(p, 1/60);
    const dx = Math.abs(ax - p.x);
    assert.ok(dx <= prevDx + 1e-6, 'the reel keeps closing horizontal distance to the anchor');
    prevDx = dx;
  }
  assert.ok(arrived, 'the reel finishes within the time budget');
  assert.equal(reason, 'arrived', 'a clear run detaches with reason "arrived"');
  assert.ok(maxSpeed <= REEL + 1e-2, 'reel speed never exceeds its cap ('+REEL+'), peak '+maxSpeed.toFixed(2));
  assert.ok(maxSpeed < 30, 'reel speed stays under the multiplayer pose envelope');
  assert.ok(p.vx > 0, 'the body keeps forward momentum on arrival (a small pop, not a dead stop)');
  assert.ok(!grapple.isActive(), 'inactive after arrival');
}

// --- 3. Manual let-go hands back the reel momentum (the fling) --------------
{
  grapple.reset();
  const p = makePlayer();
  grapple.fire(p, 30, 10);
  for(let i=0;i<240 && !grapple.anchored();i++) grapple.step(p, 1/60, wallRight, {});
  assert.ok(grapple.anchored(), 'anchored before release');
  for(let i=0;i<24;i++){ grapple.step(p, 1/60, wallRight, {}); integrate(p, 1/60); } // build reel speed
  const vxBefore = p.vx, vyBefore = p.vy;
  assert.ok(vxBefore > 5, 'the reel has built a real forward speed to fling');
  const r = grapple.step(p, 1/60, wallRight, {release:true});
  assert.ok(r.released && r.reason === 'manual', 'tapping release lets go of the rope');
  assert.ok(Math.abs(p.vx - vxBefore) < 1e-6 && Math.abs(p.vy - vyBefore) < 1e-6,
    'release hands back exactly the reel velocity (momentum-preserving fling)');
  assert.ok(!grapple.isActive(), 'inactive after manual release');
}

// --- 4. Open-air cast fizzles, never anchors -------------------------------
{
  grapple.reset();
  const p = makePlayer();
  grapple.fire(p, 30, 10);
  let reason = null;
  for(let i=0;i<600;i++){ const r = grapple.step(p, 1/60, allAir, {}); if(r.released){ reason = r.reason; break; } }
  assert.ok(reason === 'range' || reason === 'flytime', 'a cast into open air fizzles (range/flytime), got '+reason);
  assert.ok(!grapple.anchored() && !grapple.isActive(), 'no anchor, no active rope after a miss');
}

// --- 5. Mining away the anchor tile snaps the rope -------------------------
{
  grapple.reset();
  const p = makePlayer();
  grapple.fire(p, 30, 10);
  let solid = true;
  const dyn = (x,y)=> (solid && x>=20) ? T.STONE : T.AIR;
  for(let i=0;i<240 && !grapple.anchored();i++) grapple.step(p, 1/60, dyn, {});
  assert.ok(grapple.anchored(), 'anchored before the tile is removed');
  solid = false; // the anchor tile is mined out from under the hook
  const r = grapple.step(p, 1/60, dyn, {});
  assert.ok(r.released && r.reason === 'snapped', 'removing the anchor tile snaps the rope');
}

// --- 6. Re-firing replaces the active rope ---------------------------------
{
  grapple.reset();
  const p = makePlayer();
  grapple.fire(p, 30, 10);
  for(let i=0;i<240 && !grapple.anchored();i++) grapple.step(p, 1/60, wallRight, {});
  assert.ok(grapple.anchored(), 'first rope anchored');
  grapple.fire(p, -30, 10); // re-cast the other way
  assert.equal(state().phase, 'fly', 're-firing replaces the anchored rope with a fresh cast');
  grapple.reset();
}

// --- 7. Draw is a pure cosmetic pass (no throw, no world touch) -------------
{
  grapple.reset();
  const p = makePlayer();
  grapple.fire(p, 30, 10);
  grapple.step(p, 1/60, wallRight, {});
  grapple.draw(makeCtx(), 24, ()=>true); // must not throw with a live rope
  grapple.reset();
  grapple.draw(makeCtx(), 24, ()=>true); // must not throw with no rope
}

// --- 8. Arrow-tier classification: grapple is UTILITY ammo ------------------
{
  const tiers = weapons._debug.arrowTiers;
  const gr = tiers.find(t=>t.id === 'grapple');
  assert.ok(gr, 'the grapple movement tier is registered in ARROW_TIERS');
  assert.equal(gr.grapple, true, 'the grapple tier is flagged as a movement hook');
  assert.equal(gr.key, 'arrowGrapple', 'the grapple tier consumes arrowGrapple ammo');
  assert.ok(gr.breakChance == null, 'a rope has no break chance — excluded from the durability map');
  const durability = Object.fromEntries(tiers.filter(t=>t.breakChance!=null).map(t=>[t.id,t.breakChance]));
  assert.ok(!('grapple' in durability), 'grapple stays out of the arrow-durability map');
  // the seven combat tiers still own the "real tier" roster (utility ammo excluded)
  const real = tiers.filter(t=>!t.snowball && !t.grapple);
  assert.equal(real.length, 7, 'still exactly seven real combat arrow tiers');
}

// --- 9. Source-shape pins: the fire divert + MP-safety contract -------------
{
  const wsrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
  assert.match(wsrc, /if\(tier\.grapple\) return fireGrappleShot\(player,aimX,aimY,w\);/,
    'a pinned grapple diverts out of the combat-arrow path (both fireBowShot and firePowerBow)');
  assert.match(wsrc, /MM\.grapple && MM\.grapple\.fire/, 'the grapple shot calls the grapple module, not pushArrow');
  assert.match(wsrc, /if\(tier\.grapple\) continue;/, 'auto-fire skips the grapple hook');

  const msrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(msrc, /GRAPPLE\.step\(player, dt, getTile, \{release:grRelease\}\)/,
    'the reel runs from physics() on the local body with the shared getTile');
  assert.match(msrc, /if\(GRAPPLE && GRAPPLE\.draw\) GRAPPLE\.draw\(ctx,TILE,worldFxVisible\);/,
    'the rope renders in the world pass');

  const gsrc = await readFile(new URL('../src/engine/grapple.js', import.meta.url), 'utf8');
  // Strip comments first — the module DOCUMENTS the "no setTile / no window.player"
  // contract in its header, and that prose must not trip the code check.
  const gcode = gsrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/setTile\s*\(/.test(gcode), 'grapple never writes the world (no setTile call) — pure self-movement');
  assert.ok(!/window\s*\.\s*player/.test(gcode), 'grapple takes the body as a parameter (never reads window.player)');
}

console.log('grapple-sim: all assertions passed');
