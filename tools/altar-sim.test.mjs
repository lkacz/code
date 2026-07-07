// Summoning-altar regression tests: rare deterministic shrine placement in
// worldgen (obsidian dais + torches + the indestructible ALTAR tile), and the
// ritual contract in engine/altar.js — offering cost, gargantuan (scale 3)
// summon, per-altar daily cooldown, refund when the summon finds no ground.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };
const messages = [];
globalThis.msg = (t)=>messages.push(String(t));

const { T, INFO, CHUNK_W } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');
const { altar } = await import('../src/engine/altar.js');
assert.ok(altar, 'altar module exports');

// --- tile contract ----------------------------------------------------------
assert.equal(INFO[T.ALTAR].unmineable, true, 'the altar stone is indestructible');
assert.equal(INFO[T.ALTAR].story, true, 'the altar is protected from machinery/backdrop builds');
assert.equal(INFO[T.ALTAR].drop, null, 'the altar drops nothing');

// --- placement: rare, deterministic, well-formed ----------------------------
worldGen.worldSeed = 20260707;
worldGen.clearCaches();

function scanAltars(cx0, cx1){
  const found = [];
  for(let cx = cx0; cx <= cx1; cx++){
    for(let lx = 0; lx < CHUNK_W; lx++){
      const x = cx * CHUNK_W + lx;
      const surf = worldGen.surfaceHeight(x);
      for(let y = surf - 6; y < surf; y++){
        if(world.getTile(x, y) === T.ALTAR) found.push({x, y});
      }
    }
  }
  return found;
}
const altars = scanAltars(-120, 120);
assert.ok(altars.length >= 1, 'at least one altar spawns across 241 chunks (found ' + altars.length + ')');
assert.ok(altars.length <= 24, 'altars stay rare (found ' + altars.length + ')');
let wellFormed = 0;
for(const a of altars){
  if(world.getTile(a.x, a.y + 1) === T.OBSIDIAN) wellFormed++;
}
assert.ok(wellFormed >= Math.ceil(altars.length * 0.8), 'altars stand on their obsidian dais');
const fullyDressed = altars.some(a =>
  world.getTile(a.x - 2, a.y + 1) === T.OBSIDIAN &&
  world.getTile(a.x + 2, a.y + 1) === T.OBSIDIAN &&
  (world.getTile(a.x - 2, a.y - 1) === T.TORCH || world.getTile(a.x + 2, a.y - 1) === T.TORCH));
assert.ok(fullyDressed, 'at least one shrine keeps its pillars and torches');

// determinism: regenerating the world reproduces the same shrines
world.clear();
worldGen.clearCaches();
const altars2 = scanAltars(-120, 120);
assert.deepEqual(altars2, altars, 'shrine placement is a pure function of the seed');

// --- ritual: cost, summon, cooldown, refund ---------------------------------
const A = altars[0];
const getTile = (x,y)=>world.getTile(x,y);
globalThis.inv = { diamond:0, obsidian:0 };
const player = { x:A.x + 3, y:A.y };
globalThis.player = player;

let day = 5.2;
const spawns = [];
let spawnResult = ()=>({name:'Testowy Tytan'});
const forceSpawn = (gt, opts)=>{ spawns.push(opts); return spawnResult(); };
const ctx = ()=>({ getTile, inv, player, forceSpawn, gameDayFloat:()=>day });

altar.reset();
// clicking anything else falls through
assert.equal(altar.tryUseAt(A.x + 1, A.y, ctx()), false, 'non-altar tiles are not consumed');
// too poor: click consumed, offering explained, nothing summoned
assert.equal(altar.tryUseAt(A.x, A.y, ctx()), true, 'altar click is consumed even when refused');
assert.equal(spawns.length, 0, 'no summon without the offering');
assert.ok(messages.some(m=>m.includes('Rytuał wymaga ofiary')), 'the altar names its price');

// paid ritual: offering consumed, gargantuan called beyond the shrine
const cost = altar.cost();
inv.diamond = cost.diamond; inv.obsidian = cost.obsidian;
assert.equal(altar.tryUseAt(A.x, A.y, ctx()), true, 'paid ritual is consumed');
assert.equal(spawns.length, 1, 'the ritual summons once');
assert.equal(spawns[0].scale, 3, 'the altar calls a gargantuan (epic-chest hoard on death)');
assert.equal(inv.diamond, 0, 'diamonds are offered');
assert.equal(inv.obsidian, 0, 'obsidian is offered');
assert.ok(messages.some(m=>m.includes('Ołtarz płonie')), 'a successful ritual announces the beast');

// same-day repeat: the stone still smokes
inv.diamond = cost.diamond; inv.obsidian = cost.obsidian;
assert.equal(altar.tryUseAt(A.x, A.y, ctx()), true, 'cooldown click is consumed');
assert.equal(spawns.length, 1, 'no second summon on the same day');
assert.equal(inv.diamond, cost.diamond, 'cooldown does not eat the offering');
assert.ok(messages.some(m=>m.includes('jeszcze dymi')), 'cooldown explains itself');

// next day: the altar answers again
day += 1.01;
assert.equal(altar.tryUseAt(A.x, A.y, ctx()), true, 'next-day ritual accepted');
assert.equal(spawns.length, 2, 'the altar answers again a day later');

// failed summon refunds the offering
day += 1.01;
inv.diamond = cost.diamond; inv.obsidian = cost.obsidian;
spawnResult = ()=>null;
assert.equal(altar.tryUseAt(A.x, A.y, ctx()), true, 'failed ritual is still an interaction');
assert.equal(inv.diamond, cost.diamond, 'failed summon refunds diamonds');
assert.equal(inv.obsidian, cost.obsidian, 'failed summon refunds obsidian');
assert.ok(messages.some(m=>m.includes('ofiara wraca')), 'refund is announced');
// and leaves no cooldown behind
spawnResult = ()=>({name:'Drugi Tytan'});
assert.equal(altar.tryUseAt(A.x, A.y, ctx()), true, 'retry after refund works');
assert.equal(spawns.length, 5, 'refunded ritual can be retried immediately');

// reset clears session cooldowns
altar.reset();
assert.equal(altar._usedAt().size, 0, 'reset clears the cooldown ledger');

console.log('altar-sim: all assertions passed');
