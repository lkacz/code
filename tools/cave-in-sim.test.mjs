// Zawał — cave-ins and pit props (src/engine/cave_in.js).
// The PRODUCER the burial system was missing: hero_crush.js, progress.js's
// crushResistBonus and main.js's "Miażdży cię zawał" message all predate it.
// Run: node tools/cave-in-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { caveIn: C } = await import('../src/engine/cave_in.js');

// a wide natural-rock gallery: solid stone with a hollowed-out corridor
const tiles = new Map();
const k = (x, y) => x + ',' + y;
const getTile = (x, y) => tiles.has(k(x, y)) ? tiles.get(k(x, y)) : T.STONE;
const setTile = (x, y, t) => tiles.set(k(x, y), t);
function carveGallery(y, x0, x1){ for(let x = x0; x <= x1; x++) setTile(x, y, T.AIR); }

const realRandom = Math.random;
try {
  // ------------------------------------------------------------- span detection
  {
    C.reset(); tiles.clear();
    carveGallery(50, 0, 30);                       // wide open corridor at y=50
    const span = C._debug.unsupportedSpan(15, 49, getTile);   // ceiling above it
    assert.ok(span >= C.CFG.SPAN_MIN, 'a wide hollow gallery has an unsupported span (' + span + ')');

    tiles.clear();
    carveGallery(50, 10, 12);                      // a narrow 3-wide nook
    assert.ok(C._debug.unsupportedSpan(11, 49, getTile) < C.CFG.SPAN_MIN,
      'a narrow nook is not an unsupported span — small digs stay safe');

    tiles.clear();
    assert.equal(C._debug.unsupportedSpan(11, 49, getTile), 0,
      'solid rock underneath means nothing is unsupported');
  }

  // ------------------------------------------------- only NATURAL rock caves in
  {
    assert.equal(C._debug.isNaturalRock(T.STONE), true, 'stone caves in');
    assert.equal(C._debug.isNaturalRock(T.GRANITE), true, 'granite caves in');
    assert.equal(C._debug.isNaturalRock(T.DIRT), true, 'dirt caves in');
    assert.equal(C._debug.isNaturalRock(T.BRICK), false, 'BUILT walls never spontaneously collapse');
    assert.equal(C._debug.isNaturalRock(T.STEEL), false, 'steel never spontaneously collapses');
    assert.equal(C._debug.isNaturalRock(T.GOLD_ORE), false, 'ore worth mining is not treated as loose rock');
    assert.equal(C._debug.isNaturalRock(T.BEDROCK), false, 'bedrock is forever');
  }

  // --------------------------------------------------------- disturb -> warning
  {
    C.reset(); tiles.clear();
    carveGallery(50, 0, 30);
    Math.random = () => 0;                      // force the risk roll to fire
    const started = C.disturb(15, 50, 2, getTile);
    assert.equal(started, 1, 'mining under a wide unsupported roof starts a cave-in');
    assert.equal(C.metrics().watching, 1, 'the roof is being watched');

    // the WARNING is the whole point: it must not bury you instantly
    C.update(0.1, null, getTile, setTile);
    assert.equal(C.metrics().collapsed, 0, 'nothing collapses during the warning window');
    assert.ok(C.CFG.WARN_TIME > 1.5, 'the warning window is generous enough to react to');
  }

  // ------------------------------------------------------- props are the answer
  {
    C.reset(); tiles.clear();
    carveGallery(50, 0, 30);
    Math.random = () => 0;
    C.noteProp(15, 50);
    assert.equal(C.proppedNear(15, 49), true, 'a prop steadies the roof above it');
    assert.equal(C.disturb(15, 50, 2, getTile), 0, 'a propped roof never starts creaking');
    assert.equal(C.proppedNear(80, 49), false, 'a prop far away steadies nothing');

    // a prop planted DURING the warning saves the roof
    C.reset(); tiles.clear();
    carveGallery(50, 0, 30);
    C.disturb(15, 50, 2, getTile);
    assert.equal(C.metrics().watching, 1, 'roof is creaking');
    C.noteProp(15, 50);
    C.update(0.1, null, getTile, setTile);
    assert.equal(C.metrics().watching, 0, 'propping mid-warning cancels the collapse');
    assert.equal(C.metrics().collapsed, 0, '...and nothing ever falls');

    // a prop tile in the span also blocks the span scan outright
    C.reset(); tiles.clear();
    carveGallery(50, 0, 30);
    setTile(14, 50, T.PIT_PROP);
    assert.equal(C._debug.unsupportedSpan(15, 49, getTile), 0, 'a prop tile breaks the unsupported span');
  }

  // --------------------------------------------------------------- the collapse
  {
    C.reset(); tiles.clear();
    carveGallery(50, 0, 30);
    Math.random = () => 0;
    let spawned = 0;
    MM.fallingSolids = { spawnLoose: () => { spawned++; return true; }, onTileRemoved(){} };
    C.disturb(15, 50, 2, getTile);
    C.update(C.CFG.WARN_TIME + 0.1, null, getTile, setTile);
    assert.equal(C.metrics().collapsed, 1, 'the roof lets go after the warning');
    assert.ok(spawned > 0, 'rubble is handed to falling.js — never written as a raw setTile');
    assert.equal(C.metrics().watching, 0, 'the watch entry is consumed');
    MM.fallingSolids = undefined;
  }

  // --------------------------------------------- damage sweeps hero AND guests
  {
    C.reset(); tiles.clear();
    carveGallery(50, 0, 30);
    Math.random = () => 0;
    MM.fallingSolids = { spawnLoose: () => true, onTileRemoved(){} };

    let heroHits = 0, guestHits = 0;
    globalThis.player = { x: 15, y: 50 };
    globalThis.damageHero = (n, o) => { if(o && o.cause === 'cave_in') heroHits++; };
    MM.coopBodies = [{ x: 15.5, y: 50, hurt: (n, o) => { if(o && o.cause === 'cave_in') guestHits++; } }];

    C.disturb(15, 50, 2, getTile);
    C.update(C.CFG.WARN_TIME + 0.1, null, getTile, setTile);
    assert.ok(heroHits > 0, 'the hero under a collapse is crushed');
    assert.ok(guestHits > 0, 'a COOP BODY under the same collapse is crushed too (CLAUDE.md rule 3)');

    // ...and a body standing well clear is untouched
    heroHits = 0; guestHits = 0;
    C.reset(); tiles.clear(); carveGallery(50, 0, 30);
    MM.coopBodies = [{ x: 400, y: 50, hurt: () => { guestHits++; } }];
    globalThis.player = { x: 400, y: 50 };
    C.disturb(15, 50, 2, getTile);
    C.update(C.CFG.WARN_TIME + 0.1, null, getTile, setTile);
    assert.equal(heroHits, 0, 'a hero standing clear is not hit');
    assert.equal(guestHits, 0, 'a guest standing clear is not hit');

    MM.coopBodies = undefined; globalThis.player = undefined; globalThis.damageHero = undefined;
    MM.fallingSolids = undefined;
  }

  // ----------------------------------------------------------------- boundedness
  {
    C.reset(); tiles.clear();
    carveGallery(50, -200, 200);
    Math.random = () => 0;
    for(let x = -180; x < 180; x++) C.disturb(x, 50, 2, getTile);
    assert.ok(C.metrics().watching <= C.CFG.MAX_WATCH,
      'simultaneously creaking roofs are hard-bounded (' + C.metrics().watching + ')');
  }

  // ------------------------------------------------------------ props persist
  {
    C.reset();
    C.noteProp(5, 60); C.noteProp(6, 60);
    const snap = C.snapshot();
    assert.equal(snap.props.length, 2, 'props ride the save');
    C.reset();
    assert.equal(C.proppedNear(5, 60), false, 'reset clears them');
    C.restore(snap);
    assert.equal(C.proppedNear(5, 60), true, 'a reload keeps the roof you already shored up');
    C.restore({ props: [{ evil: 1 }, 'x'.repeat(500), '7,70'] });
    assert.equal(C.proppedNear(7, 70), true, 'a sane entry survives sanitisation');
    assert.ok(C.metrics().props <= 2, 'hostile save entries are rejected, not trusted');
  }
} finally {
  Math.random = realRandom;
  MM.coopBodies = undefined;
  globalThis.player = undefined;
  globalThis.damageHero = undefined;
}

// ------------------------------------------------------------- wiring contract
{
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const modSrc = await readFile(new URL('../src/engine/cave_in.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /CAVE_IN\.disturb\(tx, ty/, 'mining shakes the roof through the shared break hook');
  assert.match(mainSrc, /CAVE_IN\.update\(dt, player, getTile, setTile\)/, 'the module is ticked each frame');
  assert.match(mainSrc, /CAVE_IN\.noteProp\(tx,ty\)/, 'placing a prop registers it');
  assert.match(mainSrc, /CAVE_IN\.clearProp\(tx,ty\)/, 'removing a prop unregisters it');
  assert.match(mainSrc, /caveIn: timedSavePart/, 'props are saved');
  assert.match(mainSrc, /id:'pit_prop'/, 'pit props are craftable');
  // rubble must use the shared falling physics, not a bespoke tile write
  assert.match(modSrc, /F\.spawnLoose/, 'collapse routes through falling.js');
  assert.match(modSrc, /MM\.coopBodies/, 'damage sweeps coop bodies');
  const invSrc = await readFile(new URL('../src/inventory.js', import.meta.url), 'utf8');
  assert.match(invSrc, /key:'pitProp'/, 'the prop is a real inventory resource');
}

console.log('cave-in-sim: all assertions passed');
