// Deterministic Node test for the golden sprinter (no browser needed).
// Verifies: the in-game-day scheduler (first visit at half of the 7-day period,
// later visits at the full period), the three forms' locomotion envelopes (bird
// flies above the terrain, runner hugs it, mole tunnels below and periodically
// surfaces), top sprint speed, the timed escape (vanishes without loot), and
// the kill ceremony (epic chest materializes + diamonds + XP + announcement).
// Run: node tools/golden-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // engine modules attach to window.MM
globalThis.MM = {};

const SURF = 90; // flat world: solid ground from y=90 down
const H = 200;
let tiles = new Map();
const getTile = (x,y)=>{ if(y<0||y>=H) return 3; const v=tiles.get(x+','+y); return v===undefined ? (y>=SURF? 3 : 0) : v; };
const setTile = (x,y,v)=>{ if(y>=0&&y<H) tiles.set(x+','+y,v); };

const messages = [];
globalThis.msg = (t)=>messages.push(String(t));
globalThis.player = { x:0, y:SURF-1, hp:100, maxHp:100, xp:0, vx:0, vy:0, hpInvul:0 };
globalThis.inv = { diamond:0 };

const { T } = await import('../src/constants.js');
const { mobs } = await import('../src/engine/mobs.js');
assert.ok(mobs && mobs.spawnGolden, 'mobs module exports spawnGolden');
// world.js / worldgen.js claimed MM.world / MM.worldGen during import — restore stubs
MM.world = { getTile, setTile };
MM.worldGen = { surfaceHeight: ()=>SURF, biomeType: ()=>1 };
MM.particles = { spawnBurst(){}, spawnSplash(){} };

const goldenCount = ()=> (mobs.diagnose(getTile).species.ZLOTY || 0);
const step = (seconds, dt)=>{ const d = dt||1/30; for(let i=0;i<Math.round(seconds/d);i++) mobs.update(d, player, getTile); };

// --- 1. Scheduler: first visit arrives at half the 7-day period (3.5 days = 2100s) ---
let st = mobs.goldenState();
assert.equal(st.visits, 0, 'fresh clock: no visits yet');
assert.equal(st.period, 7*600, 'period is 7 in-game days of 600s');
let elapsed = 0;
while(goldenCount()===0 && elapsed < 2500){ mobs.update(10, player, getTile); elapsed += 10; }
assert.ok(goldenCount()===1, 'golden sprinter appeared on schedule');
assert.ok(elapsed >= 2090 && elapsed <= 2150, `first visit at ~2100s of play (got ${elapsed})`);
assert.ok(messages.some(t=>t.includes('przemierza okolicę')), 'arrival is announced');
assert.equal(mobs.goldenState().visits, 1, 'visit counted');

// it is transient: never serialized into the save
assert.ok(!mobs.serialize().list.some(r=>r.id==='ZLOTY'), 'golden sprinter is excluded from saves');

// --- 2. Lifetime escape: it dissolves without leaving loot ---
step(60, 10); // its 34s lifetime expires well within this window
assert.equal(goldenCount(), 0, 'visitor left after its lifetime');
assert.ok(messages.some(t=>t.includes('umknął')), 'escape is announced');
assert.ok(![...tiles.values()].includes(T.CHEST_EPIC), 'no chest from an escaped sprinter');
assert.equal(inv.diamond, 0, 'no diamonds from an escaped sprinter');

// --- 3. Second visit waits the full 7 days (4200s, counted from the first spawn) ---
let elapsed2 = 60; // step(60) above already counted toward the next period
while(goldenCount()===0 && elapsed2 < 4500){ mobs.update(10, player, getTile); elapsed2 += 10; }
assert.ok(goldenCount()===1, 'second visit arrived');
assert.ok(elapsed2 >= 4150 && elapsed2 <= 4300, `second visit after a full period (got ${elapsed2})`);
step(60, 10); // let it run off so the form tests own the single slot

// --- 4. Forms interact with REAL blocks: the bird climbs over towers, the
//        runner leaps low walls and wheels around tall ones, the mole tunnels
//        deep without touching a single block ---
function buildWall(x0,w,h){ const keys=[]; for(let dx=0;dx<w;dx++) for(let dy=1;dy<=h;dy++){ setTile(x0+dx, SURF-dy, 3); keys.push((x0+dx)+','+(SURF-dy)); } return keys; }
function clearKeys(keys){ keys.forEach(k=>tiles.delete(k)); }

// bird: clears a 12-tall player tower instead of clipping through it
const bird = mobs.spawnGolden('bird', player);
assert.ok(bird && bird._g.form==='bird', 'debug spawn honors the requested form');
assert.ok(bird.hp >= 80, 'tough to kill (hp '+bird.hp+')');
const bd=bird._g.dir, btx=Math.round(bird.x+bd*12);
let wallKeys=buildWall(btx, 2, 12);
let x0=bird.x, clip=0, frames=0, passed=false;
for(let i=0;i<30*5 && bird.hp>0;i++){
  mobs.update(1/30, player, getTile); frames++;
  if(getTile(Math.floor(bird.x), Math.floor(bird.y))===3) clip++;
  if((bird.x-(btx+bd*3))*bd > 0) { passed=true; break; }
}
assert.ok(passed, 'bird crossed the tower zone');
assert.ok(clip <= frames*0.03, 'bird flies over real obstacles, never through ('+clip+'/'+frames+' clipped frames)');
assert.ok(Math.abs(bird.x-x0)/(frames/30) > 6, 'sprinter speed kept while climbing');
clearKeys(wallKeys);
bird._g.t = 0.01; step(1); // dismiss
assert.equal(goldenCount(), 0, 'bird dismissed for next form');

// runner on open ground: gallops at the real surface
const runner = mobs.spawnGolden('runner', player);
let lo=Infinity, hi=-Infinity;
for(let i=0;i<90;i++){ mobs.update(1/30, player, getTile); lo=Math.min(lo,runner.y); hi=Math.max(hi,runner.y); }
assert.ok(lo > SURF-5 && hi < SURF+0.5, `runner gallops along the surface (y ${lo.toFixed(1)}..${hi.toFixed(1)})`);
// low wall (3 tall): it leaps over without changing course
const rd=runner._g.dir, rwx=Math.round(runner.x+rd*10);
wallKeys=buildWall(rwx, 1, 3);
clip=0; frames=0; passed=false;
for(let i=0;i<30*6 && runner.hp>0;i++){
  mobs.update(1/30, player, getTile); frames++;
  if(getTile(Math.floor(runner.x), Math.floor(runner.y))===3) clip++;
  if((runner.x-(rwx+rd*2))*rd > 0){ passed=true; break; }
}
assert.ok(passed, 'runner leapt the low wall');
assert.equal(runner._g.dir, rd, 'course held over a climbable step');
assert.ok(clip <= 4, 'runner does not clip through blocks ('+clip+' frames)');
clearKeys(wallKeys);
runner._g.t = 0.01; step(1);

// tall wall (8 tall): too high to leap — it wheels around and never passes
const r2 = mobs.spawnGolden('runner', player);
const rd2=r2._g.dir, rwx2=Math.round(r2.x+rd2*10);
wallKeys=buildWall(rwx2, 1, 8);
let flipped=false, breached=false;
for(let i=0;i<30*5 && r2.hp>0;i++){
  mobs.update(1/30, player, getTile);
  if(r2._g.dir!==rd2) flipped=true;
  if((r2.x-rwx2)*rd2 > 0.5) breached=true;
}
assert.ok(flipped, 'runner wheeled around at the tall wall');
assert.ok(!breached, 'tall wall actually blocked the path');
clearKeys(wallKeys);
r2._g.t = 0.01; step(1);

// mole: deep continuous tunneling — never surfaces, never edits a block
const mole = mobs.spawnGolden('mole', player);
const tiles0=tiles.size;
step(1.5); // settle into the depth band
let prevX=mole.x, prevY=mole.y, maxStep=0, minDepth=Infinity, maxDepth=-Infinity;
for(let i=0;i<30*6 && mole.hp>0;i++){
  mobs.update(1/30, player, getTile);
  maxStep=Math.max(maxStep, Math.abs(mole.x-prevX)+Math.abs(mole.y-prevY));
  prevX=mole.x; prevY=mole.y;
  minDepth=Math.min(minDepth, mole.y-SURF); maxDepth=Math.max(maxDepth, mole.y-SURF);
}
assert.ok(minDepth > 2, `mole stays deep underground (shallowest ${minDepth.toFixed(1)} below surface)`);
assert.ok(maxDepth < 14, `mole keeps to its tunneling band (deepest ${maxDepth.toFixed(1)})`);
assert.ok(maxStep < 1.0, `path is continuous, no teleports (max step ${maxStep.toFixed(2)} tiles/frame)`);
assert.equal(tiles.size, tiles0, 'tunneling never removes or places a single block');
mole._g.t = 0.01; step(1);

// --- 5. Kill ceremony: epic chest + diamonds + XP + announcement ---
messages.length = 0;
const prey = mobs.spawnGolden('runner', player);
const xp0 = player.xp;
mobs.damageAt(Math.floor(prey.x), Math.floor(prey.y), 500);
assert.ok(prey.hp <= 0, 'massive hit fells the sprinter');
step(0.2);
assert.equal(goldenCount(), 0, 'corpse cleaned up');
assert.ok(player.xp - xp0 >= 150, 'big XP prize ('+(player.xp-xp0)+')');
assert.ok(inv.diamond >= 3 && inv.diamond <= 5, 'guaranteed diamonds ('+inv.diamond+')');
assert.ok([...tiles.values()].includes(T.CHEST_EPIC), 'an epic chest materialized at the fall site');
assert.ok(messages.some(t=>t.includes('pokonany')), 'victory is announced');

// --- 6. Single-slot cap: a second sprinter cannot be summoned while one lives ---
const a = mobs.spawnGolden('bird', player);
assert.ok(a, 'slot free again after the kill');
assert.equal(mobs.spawnGolden('mole', player), null, 'limit of one golden visitor at a time');

console.log('golden-sim: all assertions passed');
