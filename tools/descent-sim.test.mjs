// Zejście Warstw — the layer-descent endgame (challenge.descentFor + the
// finale branch + the composed hostility floor).
// finale.js minted mm_layers_v1.completions and NOTHING read it.
// Run: node tools/descent-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
// challenge.js reads location/localStorage at import time
globalThis.location = { search: '' };
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
globalThis.sessionStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const { challenge: C, CHALLENGE_MODS, DESCENT_BOONS } = await import('../src/engine/challenge.js');

// ------------------------------------------------------------- determinism
{
  const a = C.descentFor(3, 12345);
  const b = C.descentFor(3, 12345);
  assert.deepEqual(a, b, 'the same layer and base seed always derive the same world');
  assert.notEqual(C.descentFor(3, 12345).seed, C.descentFor(4, 12345).seed, 'each layer is a different world');
  assert.notEqual(C.descentFor(3, 1).seed, C.descentFor(3, 2).seed, 'a different base seed descends differently');
  assert.ok(Number.isInteger(a.seed) && a.seed >= 0, 'the derived seed is a usable worldgen seed');
  assert.ok(a.seed < 1e9, 'and stays inside the seed range');
  assert.equal(a.boonChoices.length,3,'every descent offers three deterministic positive protocols');
  assert.equal(new Set(a.boonChoices).size,3,'the protocol choices never repeat within one offer');
  assert.ok(a.boonChoices.every(key=>DESCENT_BOONS[key]),'every offered protocol comes from the bounded table');
}

// ------------------------------------------------------- curses only grow
{
  const layers = [1, 2, 3, 4, 5, 6, 7].map(n => C.descentFor(n, 777));
  assert.equal(layers[0].mods.length, 0, 'layer 1 is the ordinary world — no curses');
  for(let i = 1; i < layers.length; i++){
    assert.ok(layers[i].mods.length >= layers[i - 1].mods.length,
      'each layer carries at least as many curses as the last (' + layers[i].mods.length + ')');
  }
  assert.ok(layers[6].mods.length > 1, 'a deep layer is genuinely cursed');

  // EVERY mod must come from the shipped whitelist — a descent can never mint one
  for(const l of layers){
    for(const m of l.mods){
      assert.ok(CHALLENGE_MODS[m], 'descent mod "' + m + '" exists in the shipped table');
    }
    assert.deepEqual(l.mods, C.sanitizeMods(l.mods), 'descent mods are already canonical/sanitised');
    // the table's own exclusivity note must be honoured
    assert.ok(!(l.mods.includes('permanight') && l.mods.includes('permaday')),
      'permanight and permaday are never dealt together');
  }
}

// --------------------------------------------------------- the hostility floor
{
  assert.equal(C.descentFor(1, 5).hostilityFloor, 0, 'layer 1 has no descent floor');
  assert.ok(C.descentFor(5, 5).hostilityFloor > C.descentFor(2, 5).hostilityFloor, 'deeper layers start harder');
  assert.ok(C.descentFor(99, 5).hostilityFloor <= 2.2, 'the descent floor is capped');
}

// ------------------------------------------------------ it is a shareable link
// A descent remains expressible as the ordinary challenge query, including its
// one bounded, non-stacking positive protocol.
{
  const plan = C.descentFor(4, 999);
  const boon=plan.boonChoices[0];
  const link = C.challengeLink('https://example.test/', plan.seed, plan.mods,boon);
  assert.ok(link.includes('seed=' + plan.seed), 'the descent seed round-trips into a link');
  const parsed = C.parseChallenge(link.slice(link.indexOf('?')));
  assert.equal(parsed.seed, plan.seed, 'the link parses back to the same world');
  assert.deepEqual(parsed.mods, plan.mods, 'and the same curses');
  assert.equal(parsed.boon,boon,'and the same selected protocol');
  assert.deepEqual(C.boonModifiersFor(boon),DESCENT_BOONS[boon].mods,'the selected protocol derives one canonical stat bundle');
}

// ------------------------------------------------- floors COMPOSE, never clobber
{
  const { worldHostility: WH } = await import('../src/engine/world_hostility.js');
  const { attention: A } = await import('../src/engine/attention.js');
  A.reset();
  WH.setTuning({ intensity: 1, reach: 1, floor: 0 });

  // a veteran at layer 4 with a clean conscience still faces their baseline
  MM.finale = { layers: () => ({ completions: 3 }) };
  A.refresh();
  const descentOnly = WH.getTuning().floor;
  assert.ok(descentOnly > 0, 'the descent depth alone raises the floor');

  // ...and a rampage on top raises it further, not instead
  for(let i = 0; i < 12; i++) A.note('guardian');
  assert.ok(WH.getTuning().floor >= descentOnly, 'deeds compose with the descent floor rather than clobbering it');

  // a deep veteran who stays quiet never drops BELOW their layer baseline
  A.reset();
  assert.ok(WH.getTuning().floor >= descentOnly - 1e-9, 'clearing your deeds cannot undo how deep you are');

  MM.finale = undefined;
  A.reset();
  WH.setTuning({ floor: 0 });
}

// -------------------------------------------------------------- wiring contract
{
  const finSrc = await readFile(new URL('../src/engine/finale.js', import.meta.url), 'utf8');
  const attSrc = await readFile(new URL('../src/engine/attention.js', import.meta.url), 'utf8');
  assert.match(finSrc, /descentFor\(depth \+ 1/, 'the finale offers the NEXT layer down (unlock() already counted this world in completions, so +2 skipped a layer)');
  assert.match(finSrc, /C\.queueNext\(\{seed:plan\.seed,mods:plan\.mods,boon\}\)/,
    'the descent rides the existing one-shot challenge handoff with one selected protocol');
  assert.match(finSrc, /state\.onNewGame/, 'and then takes the ordinary new-game path');
  assert.match(attSrc, /Math\.max\(floorFor\(\), descentFloor\(\)\)/,
    'exactly ONE writer composes both floors by max');
  const mainSrc2 = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSrc2, /ATTENTION\.refresh\(\)/,
    'the composed floor is re-asserted at boot — a NEW game never runs ATTENTION.reset(), so without this the descent floor stays 0 through spawn worldgen');
  // boot-time law only: the descent must not write the world at runtime
  const chalSrc = await readFile(new URL('../src/engine/challenge.js', import.meta.url), 'utf8');
  const code = chalSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/setTile/.test(code), 'descent derivation never writes tiles — it is boot-time law');
}

console.log('descent-sim: all assertions passed');
