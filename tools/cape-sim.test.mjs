import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, INFO } = await import('../src/constants.js');
const { cape } = await import('../src/engine/cape.js');
const { wind } = await import('../src/engine/wind.js');

MM.wind = wind;
MM.customization = {capeStyle:'classic', capeColor:'#b91818'};

const solid = t => t !== T.AIR && !(INFO[t] && INFO[t].passable);
const openTile = (x,y)=> y>=90 ? T.STONE : T.AIR;
const waterTile = (x,y)=> {
  if(y>=90) return T.STONE;
  if(y>=49 && y<=53) return T.WATER;
  return T.AIR;
};
const lavaTile = (x,y)=> {
  if(y>=90) return T.STONE;
  if(y>=49 && y<=53) return T.LAVA;
  return T.AIR;
};
const wallTile = (x,y)=> {
  if(y>=90) return T.STONE;
  if(x<=-1 && y>=49 && y<=58) return T.STONE;
  return T.AIR;
};

function makePlayer(opts={}){
  return {
    x:0,
    y:50,
    w:0.7,
    h:0.95,
    vx:opts.vx||0,
    vy:opts.vy||0,
    facing:opts.facing==null ? 1 : opts.facing,
    onGround:opts.onGround!==false
  };
}
function settle(player, windSpeed=0, getTile=openTile, seconds=2.2){
  wind.reset();
  wind.setOverride(windSpeed);
  cape.init(player);
  const steps=Math.ceil(seconds*60);
  for(let i=0; i<steps; i++) cape.update(player,1/60,getTile,solid);
  const tail=cape._segments[cape._segments.length-1];
  const mid=cape._segments[Math.floor(cape._segments.length/2)];
  return {tail:{x:tail.x,y:tail.y}, mid:{x:mid.x,y:mid.y}, all:cape._segments.map(s=>({x:s.x,y:s.y}))};
}

let p=makePlayer({facing:1});
const idle=settle(p,0);
assert.ok(idle.tail.x < p.x-0.08, 'idle cape hangs behind the facing direction');
assert.ok(idle.tail.y > p.y-0.1, 'idle cape droops below the shoulder anchor');
// Collar HEIGHT is a visual contract no tail pin can see: moving the anchor
// translates the whole chain, so tail.x is bit-identical and tail.y only
// drifts further inside the threshold above. 0.30 = the shoulder line; the
// old 0.5 sat at the navel and read as a belt-cape. The literal is on
// purpose — deriving it from CAPE.ANCHOR_FRAC would pin nothing.
assert.ok(Math.abs(idle.all[0].y - (p.y - p.h/2 + p.h*0.30)) < 0.02,
  'cape collar pins to the shoulder line (0.30 of body height), not the waist');

p=makePlayer({facing:1});
const forwardWind=settle(p,5.0);
p=makePlayer({facing:1});
const backWind=settle(p,-5.0);
assert.ok(forwardWind.tail.x > idle.tail.x+0.22, 'tail moves with strong wind blowing forward');
assert.ok(backWind.tail.x < idle.tail.x-0.12, 'tail streams farther backward in opposite wind');
assert.ok(forwardWind.tail.x > backWind.tail.x+0.35, 'cape direction follows wind sign');

p=makePlayer({facing:1,vx:5,onGround:true});
const runningRight=settle(p,0);
p=makePlayer({facing:1,vx:-5,onGround:true});
const runningLeft=settle(p,0);
assert.ok(runningRight.tail.x < idle.tail.x-0.06, 'running right pulls the cape farther left');
assert.ok(runningLeft.tail.x > idle.tail.x+0.06, 'running left can trail the cape to the right even while facing right');

p=makePlayer({facing:1,vy:-9,onGround:false});
const jumping=settle(p,0);
p=makePlayer({facing:1,vy:9,onGround:false});
const falling=settle(p,0);
assert.ok(jumping.tail.y > falling.tail.y+0.06, 'jumping upward leaves the cape lower than falling');
// New with the aerodynamic model: the relative airflow of a fast fall streams
// the cloth UP past the shoulder — the old pose filter kept it drooping.
assert.ok(falling.tail.y < p.y-0.2, 'fast fall streams the cape upward past the anchor');

p=makePlayer({facing:1});
const openStrong=settle(p,5.0,openTile);
p=makePlayer({facing:1});
const submergedStrong=settle(p,5.0,waterTile);
assert.ok(Math.abs(submergedStrong.tail.x-idle.tail.x) < Math.abs(openStrong.tail.x-idle.tail.x)*0.55, 'water damps wind response');

p=makePlayer({facing:1});
const inLava=settle(p,5.0,lavaTile);
assert.ok(inLava.tail.y < submergedStrong.tail.y-0.5,
  'lava is denser than the cloth: the cape rides up instead of sinking as it does in water');

p=makePlayer({facing:1});
const blocked=settle(p,-5.0,wallTile);
assert.ok(blocked.all.every(s=>s.x>-1.05), 'cape collision keeps segments out of the stone wall');
// Tightened: the old pin tolerated a full tile of penetration (the wall face
// is at x=0). Every simulated node must sit in a genuinely open tile; the
// anchor (node 0) is excluded because the test hero is embedded in the wall.
assert.ok(blocked.all.every((s,i)=> i===0 || !solid(wallTile(Math.floor(s.x),Math.floor(s.y)))),
  'no cape segment rests inside a solid tile');

// --- momentum: a sudden stop whips the tail past the anchor (follow-through
// the old first-order filter was structurally incapable of) -----------------
p=makePlayer({facing:1,vx:6});
wind.reset(); wind.setOverride(0);
cape.init(p);
for(let i=0;i<120;i++) cape.update(p,1/60,openTile,solid);
p.vx=0;
let whipMax=-Infinity;
for(let i=0;i<45;i++){
  cape.update(p,1/60,openTile,solid);
  const t=cape._segments[cape._segments.length-1];
  if(t.x>whipMax) whipMax=t.x;
}
assert.ok(whipMax > p.x+0.03, 'stopping from a sprint swings the tail forward past the anchor');

// --- turn-around continuity: flipping facing must never teleport nodes (the
// old forwardSlack clamp moved the tail 0.73 tiles in one frame) -------------
p=makePlayer({facing:1});
wind.reset(); wind.setOverride(0);
cape.init(p);
for(let i=0;i<130;i++) cape.update(p,1/60,openTile,solid);
const beforeFlip=cape._segments.map(s=>({x:s.x,y:s.y}));
p.facing=-1;
cape.update(p,1/60,openTile,solid);
let maxJump=0;
cape._segments.forEach((s,i)=>{
  const d=Math.hypot(s.x-beforeFlip[i].x,s.y-beforeFlip[i].y);
  if(d>maxJump) maxJump=d;
});
assert.ok(maxJump < 0.25, 'turning around moves no node more than a quarter tile in one frame');

// --- NaN heal: a poisoned node re-seeds the chain instead of erasing the
// cape for the rest of the session -------------------------------------------
cape._segments[5].x=NaN;
cape.update(p,1/60,openTile,solid);
cape.update(p,1/60,openTile,solid);
assert.ok(cape._segments.every(s=>Number.isFinite(s.x+s.y)), 'a NaN segment heals within two frames');

// --- teleport guard: a long anchor jump re-seeds at the new spot instead of
// sweeping the chain through the world ---------------------------------------
p=makePlayer({facing:1});
wind.reset(); wind.setOverride(0);
cape.init(p);
for(let i=0;i<60;i++) cape.update(p,1/60,openTile,solid);
p.x=40;
cape.update(p,1/60,openTile,solid);
// Tight by construction: init() seeds the chain at backOff 0.28 + (SEGS-1)*0.02
// spread = 0.50 max. A <2 tolerance was carried by the single-pass root→tip
// constraint (which re-derives every node from the anchor anyway), so it
// passed with the guard deleted and even against the pre-change module.
assert.ok(cape._segments.every(s=>Math.abs(s.x-40)<1.2), 'teleporting re-seeds the chain at the new anchor');
// The constraint pass rewrites x/y but never px/py, so a swept chain looks
// correct while carrying a 40-tile/frame velocity in its Verlet history that
// then bleeds out as a whip. Only the guard zeroes it.
assert.ok(cape._segments.every(s=>Math.hypot(s.x-s.px,s.y-s.py)<0.05),
  'a teleport re-seeds the Verlet history too — no 40-tile/frame velocity survives the jump');

// --- determinism: the sim reads no wall clock and rolls no dice --------------
function detRun(){
  const q=makePlayer({facing:1});
  wind.reset(); wind.setOverride(2.5);
  cape.init(q);
  for(let i=0;i<100;i++) cape.update(q,1/60,openTile,solid);
  return JSON.stringify(cape._segments.map(s=>[s.x,s.y]));
}
assert.equal(detRun(), detRun(), 'cape sim is deterministic under fixed dt');

// --- fabrics change the physics: silk streams far, leather barely stirs ------
MM.customization.capeFabric='silk';
p=makePlayer({facing:1});
const silky=settle(p,5.0);
MM.customization.capeFabric='leather';
p=makePlayer({facing:1});
const leathery=settle(p,5.0);
delete MM.customization.capeFabric;
assert.ok(silky.tail.x > leathery.tail.x+0.15, 'silk streams in wind visibly farther than leather');

// --- fabric resolver is wired through MM.cape --------------------------------
assert.equal(cape.fabricForItem({kind:'cape', name:'Peleryna yeti'}).fabric, 'fur', 'fabricForItem resolves loot names');
assert.equal(cape.fabricForItem({id:'royal'}).fabric, 'silk', 'fabricForItem resolves builtin ids');

// --- constraint pins: the fused bend limit and the per-fabric straighten blend
// are invisible to tail-x — they live in the chain's CURVATURE. Max per-link
// turn (radians) of the settled chain is the only quantity that sees them.
function maxTurn(fabric, windSpeed, vx){
  MM.customization.capeFabric=fabric;
  const r=settle(makePlayer({facing:1, vx:vx||0}), windSpeed);
  delete MM.customization.capeFabric;
  let mx=0;
  for(let i=2;i<r.all.length;i++){
    const ax=r.all[i-1].x-r.all[i-2].x, ay=r.all[i-1].y-r.all[i-2].y;
    const bx=r.all[i].x-r.all[i-1].x,   by=r.all[i].y-r.all[i-1].y;
    const ang=Math.abs(Math.atan2(ax*by-ay*bx, ax*bx+ay*by));
    if(ang>mx) mx=ang;
  }
  return mx;
}
// bendLimit is a HARD cap the constraint pass may never let a link cross. The
// bounds are LITERAL (not read from FABRICS) so flattening the table cannot
// flatten the expectation with it; scale/gilded saturate their tight caps —
// those are the pins that notice a widened bendLimit.
assert.ok(maxTurn('silk',5.0,0)     < 0.85+1e-6, 'no silk link bends past its 0.85 bendLimit');
assert.ok(maxTurn('spectral',0,6)   < 0.95+1e-6, 'no spectral link bends past its 0.95 bendLimit');
assert.ok(maxTurn('scale',0,6)      < 0.40+1e-6, 'scale plates hold their tight 0.40 bend cap');
assert.ok(maxTurn('gilded',8.0,6)   < 0.38+1e-6, 'gilded holds its 0.38 bend cap in a gale');
// straighten is what makes a stiff fabric READ rigid: frost (0.200) settles
// into a near-plank while spectral (0.004) keeps a deep curve in the same air.
assert.ok(maxTurn('frost',5.0,0)    < 0.10, 'frost straightens into a near-rigid plank');
assert.ok(maxTurn('frost',0,6)      < 0.10, 'frost stays rigid while sprinting too');
assert.ok(maxTurn('spectral',5.0,0) > 0.45, 'spectral keeps a deep fluid curve in the same wind');

// --- body collision: the world shoves the cloth, never the reverse ----------
function bodyRun(setup){
  const q=makePlayer({facing:1});
  wind.reset(); wind.setOverride(0);
  MM.coopBodies=undefined; MM.mobs=undefined;
  if(setup) setup();
  cape.init(q);
  for(let i=0;i<180;i++) cape.update(q,1/60,openTile,solid);
  const out=cape._segments.map(s=>({x:s.x,y:s.y}));
  MM.coopBodies=undefined; MM.mobs=undefined;   // leak nothing into later scenes
  return out;
}
const maxDelta=(a,b)=>a.reduce((m,s,i)=>Math.max(m,Math.hypot(s.x-b[i].x,s.y-b[i].y)),0);

const noBody=bodyRun();
const peer={x:-0.30,y:50,w:0.7,h:0.95,vx:3,vy:0};
const peerSnap=JSON.stringify(peer);
const withPeer=bodyRun(()=>{ MM.coopBodies=[peer]; });
assert.ok(maxDelta(noBody,withPeer)>0.05, 'a co-op body straddling the hang line pushes the cloth aside');
assert.equal(JSON.stringify(peer), peerSnap, 'cape collision never writes a peer body');

const farAway=bodyRun(()=>{ MM.coopBodies=[{x:-3.2,y:50,w:0.7,h:0.95,vx:3,vy:0}]; });
assert.equal(maxDelta(noBody,farAway), 0, 'a body outside the 2.5-tile gate changes nothing');

// mob colliders size from spec.body (mobs.js spawns carry no w/h) — a bear
// must not shove the cloth exactly like a critter
const mobRun=body=>bodyRun(()=>{
  const m={id:'M',x:-0.30,y:50,vx:0,vy:0,hp:9};   // mobs.js spawn literal: no w/h
  MM.mobs={ forEachLive(fn){ fn(m,{id:'M',body}); } };
});
const bearPose=mobRun({w:1.6,h:1.2}), critterPose=mobRun({w:0.9,h:0.45});
assert.ok(maxDelta(noBody,bearPose)>0.05, 'a nearby mob pushes the cloth aside');
assert.ok(maxDelta(bearPose,critterPose)>0.02, 'mob collider size tracks spec.body, not a fixed fallback');

// --- hostile input: the sim's four input guards are load-bearing ------------
// Each bound is a behaviour, not a magic number: an explosion frame must not
// whip the cloth across the screen, a stalled frame must not integrate half a
// second in one step, a frame-time spike must not step a node far enough to
// tunnel, and the quadratic drag must stay saturated or the cloth goes rigid.
const poseOf = ()=> cape._segments.map(s=>({x:s.x,y:s.y}));

p=makePlayer();
wind.reset(); wind.setOverride(0);
cape.init(p);
for(let i=0;i<120;i++) cape.update(p,1/60,openTile,solid);
const calmPose=poseOf();
p.vx=400;
cape.update(p,0.5,openTile,solid);
const hostilePose=poseOf();
assert.ok(hostilePose.every(s=>Number.isFinite(s.x+s.y)), 'a hostile frame keeps every node finite');
assert.ok(maxDelta(calmPose,hostilePose) < 0.35,
  'an explosion-speed body in a stalled frame moves no node more than a third of a tile');
p.vx=0;
cape.update(p,1/60,openTile,solid);
assert.ok(cape._segments.every(s=>Number.isFinite(s.x+s.y)), 'the frame after a hostile frame is still finite');

// MAX_STEP: alternating 1/240 and 1/30 frames drive the tcv correction to 8x
p=makePlayer({vx:12});
wind.reset(); wind.setOverride(0);
cape.init(p);
let spikeJump=0;
for(let i=0;i<300;i++){
  const sdt=i%2?1/30:1/240;
  p.x+=12*sdt;
  const pre=poseOf();
  cape.update(p,sdt,openTile,solid);
  spikeJump=Math.max(spikeJump, maxDelta(pre,poseOf()));
}
assert.ok(spikeJump < 0.62,
  'a sprint through 8x frame-time spikes never steps a node far enough to tunnel');

// quadratic saturation: unclamped drag over-damps the cloth into a rigid plank
p=makePlayer({vy:60});
wind.reset(); wind.setOverride(0);
cape.init(p);
let loY=Infinity, hiY=-Infinity;
for(let i=0;i<240;i++){
  cape.update(p,1/60,openTile,solid);
  if(i>=180){ const t=cape._segments[cape._segments.length-1]; if(t.y<loY) loY=t.y; if(t.y>hiY) hiY=t.y; }
}
assert.ok(hiY-loY > 0.15, 'saturated drag keeps the cloth alive in a terminal-velocity dive');

// --- emissive gating: one glow per SIM frame, even with the mirror draw -----
{
  const stopStub={addColorStop(){}};
  const ctxStub=new Proxy({}, {
    get(t,k){
      if(k==='createLinearGradient') return ()=>stopStub;
      if(k==='createPattern') return ()=>null;
      return typeof t[k]==='function'?t[k]:(t[k]=()=>{});
    },
    set(){ return true; }
  });
  let glowCalls=0;
  MM.postFx={ glow(){ glowCalls++; return true; } };
  MM.customization.capeFabric='ember';
  p=makePlayer();
  window.player=p;
  wind.reset(); wind.setOverride(0);
  cape.init(p);
  cape.update(p,1/60,openTile,solid);
  cape.draw(ctxStub,20);
  cape.draw(ctxStub,20);   // the home-mirror reflection pass
  assert.equal(glowCalls, 1, 'two draws between sim frames register exactly one emissive');
  cape.update(p,1/60,openTile,solid);
  cape.draw(ctxStub,20);
  assert.equal(glowCalls, 2, 'the next sim frame re-arms the glow');
  delete MM.customization.capeFabric;
  delete MM.postFx;
  delete window.player;
}

wind.reset();
console.log('cape-sim: all assertions passed');
