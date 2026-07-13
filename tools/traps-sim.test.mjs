// Deterministic Node test for ruin traps (no browser needed).
// Verifies: the catalog exists across generated layouts (dart / gas / boom /
// keystone lava+water / collapse), tripwire dart volleys hurt the hero,
// rune plates blast when stepped on, grave gas vents when the hero reaches
// for the chest, mining a rigged keystone unseals the whole fluid pocket
// (lava stays ready to pour), corridor floors collapse into surprise pits,
// and every trap fires exactly once per session.
// Run: node tools/traps-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // engine modules attach to window.MM
globalThis.MM = {};

const messages = [];
globalThis.msg = (t)=>messages.push(String(t));
globalThis.player = { x:0, y:0, w:0.7, h:0.95, vx:0, vy:0, hp:100, maxHp:100, hpInvul:0, xp:0 };

const { T } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { ruins } = await import('../src/engine/ruins.js');
const { world } = await import('../src/engine/world.js');
const { traps } = await import('../src/engine/traps.js');
assert.ok(traps && traps.update, 'traps module exports');

WG.worldSeed = 20260611; WG.clearCaches && WG.clearCaches();
ruins.clearCache(); world.clear(); traps.reset();

const step=(seconds)=>{ const dt=1/30; for(let i=0;i<Math.round(seconds*30);i++) traps.update(dt, player, world.getTile, world.setTile); };

// --- 1. The catalog: all five kinds (and both keystone fluids) generate ---
const kinds=new Map();
const found={};
for(let n=-1600;n<=1600;n++){
  const L=ruins.layoutFor(n); if(!L || !L.traps) continue;
  for(let i=0;i<L.traps.length;i++){
    const d=L.traps[i];
    const key=d.kind+(d.fluid? ':'+d.fluid:'');
    kinds.set(key,(kinds.get(key)||0)+1);
    if(!found[key]) found[key]={L,d};
    if(d.kind==='collapse' && !found['collapse:'+d.surprise]) found['collapse:'+d.surprise]={L,d};
  }
}
for(const k of ['dart','gas','boom','keystone:lava','keystone:water','collapse'])
  assert.ok(kinds.get(k)>0, k+' traps generate ('+(kinds.get(k)||0)+')');
assert.ok(found['collapse:lava'] && found['collapse:chest'], 'collapse pits hide both lava and bonus chests');

// helper: find a trap of a kind whose key tiles materialized intact
function liveTrap(kind, extra){
  for(let n=-1600;n<=1600;n++){
    const L=ruins.layoutFor(n); if(!L||!L.traps) continue;
    for(const d of L.traps){
      if(d.kind!==kind) continue;
      if(extra && !extra(d)) continue;
      const cells=d.cells||[[d.x,d.y]];
      if(kind!=='dart' && cells.some(([x,y])=>world.getTile(x,y)===T.AIR)) continue; // eroded away
      return d;
    }
  }
  return null;
}
function teleport(x,y){ player.x=x; player.y=y; player.vx=player.vy=0; player.hp=100; }

// --- 2. Dart tripwire: crossing it looses a volley that hurts ---
let d=liveTrap('dart'); assert.ok(d,'live dart trap found');
teleport(d.x+0.5, d.y+0.5);
step(2.5);
assert.ok(player.hp < 100, 'dart volley drew blood (hp '+player.hp+')');
assert.ok(messages.some(t=>t.includes('Strzałki')), 'dart trap announced');
const hpAfterDarts=player.hp;
step(2); // standing on the same wire again — it is spent
assert.equal(player.hp, hpAfterDarts, 'a fired trap stays dead for the session');

// --- 3. Rune plate: stepping on it detonates (weapons absent → direct blast) ---
d=liveTrap('boom'); assert.ok(d,'live boom plate found');
teleport(d.x+0.5, d.y-(player.h/2));
step(0.2);
assert.ok(player.hp <= 100-14, 'rune blast hurt the hero (hp '+player.hp+')');
assert.ok(messages.some(t=>t.includes('Runiczna')), 'boom announced');

// The normal browser build has the weapon engine, so the rune delegates its
// crater/FX there. Ownership must remain environmental rather than awarding the
// resulting collateral as a hero weapon kill.
traps.reset();
let delegatedBlastOpts=null;
MM.weapons={explodeAt(_x,_y,_getTile,_setTile,opts){ delegatedBlastOpts=opts; return true; }};
d=liveTrap('boom'); assert.ok(d,'live delegated boom plate found');
teleport(d.x+0.5,d.y-(player.h/2));
step(0.2);
assert.equal(delegatedBlastOpts && delegatedBlastOpts.source,'trap','delegated rune blast is not misattributed to the hero');
assert.equal(delegatedBlastOpts && delegatedBlastOpts.cause,'rune_mine_blast','delegated rune blast preserves its trap cause');
delete MM.weapons;

// --- 4. Grave gas: reaching for the chest vents the cloud ---
d=liveTrap('gas'); assert.ok(d,'live gas trap found');
teleport(d.x+0.5, d.y-0.8);
step(1.5);
assert.ok(player.hp < 100, 'gas ticked damage (hp '+player.hp+')');
assert.ok(messages.some(t=>t.includes('Grobowy gaz')), 'gas announced');

// --- 5. Keystone: mining one rigged block unseals the whole lava pocket ---
d=liveTrap('keystone', x=>x.fluid==='lava'); assert.ok(d,'live lava keystone found');
teleport(d.x+0.5, d.y+2); // near, but not touching — arm it first
step(1.1);
world.setTile(d.cells[0][0], d.cells[0][1], T.AIR); // the hero mines the wrong block
step(0.2);
for(const [cx,cy] of d.cells) assert.equal(world.getTile(cx,cy), T.AIR, 'whole seal opened at '+cx+','+cy);
assert.ok(d.cells.some(([cx,cy])=>world.getTile(cx,cy-1)===T.LAVA), 'the lava pocket waits right above the breach');
assert.ok(messages.some(t=>t.includes('LAWA')), 'keystone announced');

// --- 6. Collapse: the cracked floor crumbles underfoot into a surprise pit ---
d=liveTrap('collapse'); assert.ok(d,'live collapse trap found');
teleport(d.x+8, d.y-2); step(1.1); // arm from a safe distance
teleport(d.x+0.5, d.y-(player.h/2));
step(0.2);
const half=(d.w||3)>>1;
for(let x=d.x-half;x<=d.x+half;x++) assert.equal(world.getTile(x,d.y), T.AIR, 'floor tile '+x+' crumbled');
const pitPrize=world.getTile(d.x, d.y+4);
assert.ok(pitPrize===T.LAVA || pitPrize===T.CHEST_COMMON, 'the pit hides its surprise ('+pitPrize+')');
assert.ok(messages.some(t=>t.includes('Podłoga runęła')), 'collapse announced');

console.log('traps-sim: all assertions passed ('+[...kinds.entries()].map(([k,v])=>k+':'+v).join(' ')+')');
