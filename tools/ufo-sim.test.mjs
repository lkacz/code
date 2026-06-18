// Deterministic Node test for the UFO visitor (no browser needed).
// Verifies: seeded procedural generation, the 2-3-in-game-day scheduler (first
// visit at half the wait), victim selection and the three abduction flows
// (animal lifted and detached at the hatch, hero physically pulled then carried
// far and released with a souvenir, boss dematerialized through bosses.abduct),
// the shield (damped damage) vs the open-hatch window (amplified damage), the
// destruction payout (antimatter + artifact through the loot pipeline) and the
// single-saucer cap.
// Run: node tools/ufo-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // engine modules attach to window.MM
globalThis.MM = {};

const SURF = 90;
const messages = [];
globalThis.msg = (t)=>messages.push(String(t));
globalThis.player = { x:0, y:SURF-1, hp:100, maxHp:100, xp:0, vx:0, vy:0, hpInvul:0, energy:0, maxEnergy:100 };
globalThis.inv = { antimatter:0 };

MM.worldGen = { surfaceHeight: ()=>SURF };
let fakeMob = null, abductedMob = null;
MM.mobs = { nearestLiving: ()=>fakeMob, abduct: (m)=>{ abductedMob=m; fakeMob=null; return true; } };
let drainedByUfo=0;
MM.heroEnergy = { drain(){ const p=globalThis.player; const n=Math.max(0, Number(p.energy)||0); p.energy=0; drainedByUfo+=n; return n; } };

const { ufo } = await import('../src/engine/ufo.js');
assert.ok(ufo && ufo.forceSpawn, 'ufo module exports');

// step with a tiny hero integrator (the game's physics() is not loaded here)
function step(seconds, dt){
  const d = dt||1/30;
  for(let i=0;i<Math.round(seconds/d);i++){
    ufo.update(d, player);
    player.x += player.vx*d; player.y += player.vy*d; player.vy += 9*d;
    if(player.y > SURF-1){ player.y = SURF-1; player.vy = 0; player.vx *= 0.8; }
  }
}

// --- 1. Procedural determinism: same seed → same craft; seeds differ ---
const a1=ufo._gen(12345), a2=ufo._gen(12345), b1=ufo._gen(99999);
assert.equal(a1.name, a2.name, 'same seed → same name');
assert.equal(a1.hullW, a2.hullW, 'same seed → same hull');
assert.equal(a1.hp, a2.hp, 'same seed → same hp');
assert.ok(a1.name!==b1.name || a1.hullW!==b1.hullW, 'different seeds → different craft');
assert.ok(a1.hp >= 100, 'tough hull (hp '+a1.hp+')');

// --- 2. Scheduler: first visit at half of the 2-3 day period (600..900s) ---
let st=ufo.state();
assert.equal(st.visits, 0, 'fresh clock');
assert.ok(st.nextAt>=600 && st.nextAt<=900, 'first wait halved ('+st.nextAt.toFixed(0)+'s)');
let elapsed=0;
while(!ufo.current() && elapsed<1000){ ufo.update(10, player); elapsed+=10; }
assert.ok(ufo.current(), 'saucer arrived on schedule');
assert.ok(elapsed>=st.nextAt-10 && elapsed<=st.nextAt+20, 'arrival near nextAt (got '+elapsed+')');
assert.ok(messages.some(t=>t.includes('nadlatuje')), 'arrival is announced');
ufo.reset();

// --- 3. Animal abduction: lifted into the hatch, detached alive ---
fakeMob={ x:6, y:SURF-1, hp:10, id:'RABBIT', vx:0, vy:0, facing:1 };
player.x=0; player.y=SURF-1; player.vx=player.vy=0;
let c=ufo.forceSpawn({seed:1, prefer:'mob'});
assert.ok(c, 'debug spawn works');
let sawLift=false, groundY=fakeMob.y;
for(let i=0;i<60*40 && !abductedMob;i++){
  ufo.update(1/30, player);
  if(fakeMob && fakeMob.y < groundY-2) sawLift=true;
}
assert.ok(abductedMob && abductedMob.id==='RABBIT', 'the rabbit was abducted');
assert.ok(sawLift, 'victim visibly rose in the beam');
assert.ok(messages.some(t=>t.includes('odlatuje z łupem')), 'departure with prey is announced');
step(60, 0.1); // saucer accelerates away and despawns
assert.equal(ufo.current(), null, 'saucer left the area');
ufo.reset();

// --- 4. Hero abduction: pulled up, carried far, released with a souvenir ---
player.x=0; player.y=SURF-1; player.vx=player.vy=0; player.hp=100; player.energy=80; drainedByUfo=0;
fakeMob=null;
c=ufo.forceSpawn({seed:2, prefer:'hero'});
let carried=false;
for(let i=0;i<60*60;i++){
  ufo.update(1/30, player);
  player.x += player.vx/30; player.y += player.vy/30; player.vy += 9/30;
  if(player.y > SURF-1){ player.y = SURF-1; player.vy = 0; }
  const cur=ufo.current();
  if(cur && cur.phase==='carry') carried=true;
  if(carried && cur && cur.phase==='leave') break;
}
assert.ok(carried, 'hero was hauled into the saucer');
assert.ok(Math.abs(player.x-0) >= 60, 'hero deported far away ('+Math.abs(player.x).toFixed(0)+' tiles)');
assert.equal(player.energy, 0, 'hero energy is drained by UFO capture');
assert.equal(drainedByUfo, 80, 'UFO capture drains the stored hero energy exactly once');
assert.equal(inv.antimatter, 1, 'souvenir antimatter crumb');
assert.ok(messages.some(t=>t.includes('wyrzucili')), 'release is announced');
step(60, 0.1);
assert.equal(ufo.current(), null, 'saucer gone after deportation');
ufo.reset();

// --- 5. Boss abduction: the beam charges, then the beast dematerializes ---
let bossTaken=false;
const fakeBoss={ x:4, y:SURF-4, name:'Testowy', dead:false, parts:[] };
MM.bosses={ nearestForAbduction: ()=>fakeBoss, abduct: (b)=>{ bossTaken = b===fakeBoss; return true; } };
player.x=0; player.y=SURF-1; player.vx=player.vy=0;
c=ufo.forceSpawn({seed:3, prefer:'boss'});
for(let i=0;i<60*40 && !bossTaken;i++){ ufo.update(1/30, player); }
assert.ok(bossTaken, 'boss dematerialized through bosses.abduct');
assert.ok(messages.some(t=>t.includes('potwór Testowy')), 'boss catch is announced');
step(60, 0.1);
MM.bosses=null;
ufo.reset();

// --- 6. Shield vs open hatch, destruction payout ---
player.x=0; player.y=SURF-1; player.vx=player.vy=0; player.hp=100; player.xp=0;
inv.antimatter=0; messages.length=0;
let looted=null; MM.onLootGained=(items)=>{ looted=items; };
c=ufo.forceSpawn({seed:777, prefer:'hero'});
// shielded phase: 10 damage lands damped
let cur=ufo.current();
const hp0=cur.hp;
assert.ok(ufo.damageAt(Math.floor(cur.x), Math.floor(cur.y), 10), 'hull hit registers');
assert.ok(Math.abs((hp0-ufo.current().hp) - 3.5) < 0.01, 'shield damps damage to 35%');
assert.ok(!ufo.damageAt(Math.floor(cur.x)+20, Math.floor(cur.y), 10), 'misses beside the hull do nothing');
// wait for the beam window: full vulnerability
for(let i=0;i<60*30 && !(ufo.current() && ufo.current().phase==='beam');i++){
  ufo.update(1/30, player);
  player.x += player.vx/30; player.y += player.vy/30; player.vy += 9/30;
  if(player.y > SURF-1){ player.y = SURF-1; player.vy = 0; }
}
cur=ufo.current();
assert.equal(cur.phase, 'beam', 'beam phase reached');
const hp1=cur.hp;
ufo.damageAt(Math.floor(cur.x), Math.floor(cur.y), 10);
assert.ok(Math.abs((hp1-ufo.current().hp) - 20) < 0.01, 'open hatch doubles damage');
// shoot it down (deterministic artifact gate)
const realRandom=Math.random; Math.random=()=>0.1;
try{
  for(let i=0;i<200 && ufo.current();i++){ const cc=ufo.current(); ufo.damageAt(Math.floor(cc.x), Math.floor(cc.y), 50); ufo.update(1/30, player); }
}finally{ Math.random=realRandom; }
assert.equal(ufo.current(), null, 'saucer destroyed');
assert.ok(inv.antimatter>=2, 'antimatter payout ('+inv.antimatter+')');
assert.ok(player.xp>=120, 'XP prize');
assert.ok(Array.isArray(looted) && looted.length===1 && looted[0].tier==='epic', 'alien artifact routed through the loot pipeline');
assert.ok(MM.dynamicLoot && Object.values(MM.dynamicLoot).some(arr=>Array.isArray(arr)&&arr.length), 'artifact persisted in dynamic loot');
assert.ok(messages.some(t=>t.includes('zestrzelony')), 'kill is announced');
assert.ok(ufo.state().acc < 1, 'visit clock restarted after the kill (acc='+ufo.state().acc.toFixed(2)+')');

// --- 7. Single-saucer cap ---
c=ufo.forceSpawn({seed:5});
assert.ok(c, 'slot free again');
assert.equal(ufo.forceSpawn({seed:6}), null, 'only one saucer at a time');

console.log('ufo-sim: all assertions passed');
