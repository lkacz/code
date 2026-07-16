// Keybinds regression tests. Three layers:
//  1. Model — translate() is a collision-free permutation-with-holes:
//     custom keys map to their action's default, orphaned defaults go dead,
//     conflicts swap so every action always holds exactly one key.
//  2. Persistence — only non-default bindings are stored; tampered blobs that
//     would alias two actions onto one key reset to defaults (fail closed).
//  3. Source pins — main.js and inventory_ui.js must run physical keys
//     through the translation layer (a raw e.key comparison silently ignores
//     rebinds), and the pause panel must expose the new fullscreen / music /
//     keybind controls this wave added.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

// ---------------- environment ----------------------------------------------
globalThis.window = globalThis;
globalThis.MM = {};
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { keybinds: KB } = await import('../src/engine/keybinds.js?phase=main');
assert.ok(KB && MM.keybinds === KB, 'module installs itself on MM');

// ---------------- registry sanity -------------------------------------------
{
  const defs = new Set();
  for (const a of KB.ACTIONS) {
    assert.ok(a.id && a.label && a.group, 'action ' + a.id + ' carries id/label/group');
    assert.ok(KB.isBindable(a.def).ok, 'default key of ' + a.id + ' is itself bindable');
    assert.ok(!defs.has(a.def), 'default keys are unique (' + a.def + ')');
    defs.add(a.def);
    assert.ok(KB.GROUPS.some(g => g.id === a.group), 'group ' + a.group + ' is declared');
  }
  // every letter branch of the main keydown handler must be represented so a
  // rebind can never half-apply (one handler remapped, another raw)
  for (const key of ['a','d','w','s','e','t','f','r','z','x','q','b','u','m','n','c','h','g','i','v','p','j','k','l','o']) {
    assert.ok(KB.ACTIONS.some(a => a.def === key), "an action owns default key '" + key + "'");
  }
}

// ---------------- default state ---------------------------------------------
{
  assert.equal(KB.translate('a'), 'a', 'defaults translate to themselves');
  assert.equal(KB.translate('E'), 'e', 'translate lowercases');
  assert.equal(KB.translate('escape'), 'escape', 'non-action keys pass through');
  assert.equal(KB.keyFor('interact'), 'e', 'keyFor reports the default');
  assert.equal(KB.isCustomized(), false, 'fresh state has no customizations');
}

// ---------------- rebinding + dead keys --------------------------------------
{
  const r = KB.setBinding('interact', 'y');
  assert.ok(r.ok && !r.swapped, 'binding to a free key needs no swap');
  assert.equal(KB.keyFor('interact'), 'y');
  assert.equal(KB.translate('y'), 'e', 'the new physical key produces the logical default');
  assert.equal(KB.translate('e'), '§e', 'the orphaned default goes dead (matches no read site)');
  assert.equal(KB.isCustomized(), true);
  assert.equal(JSON.parse(store['mm_keybinds_v1']).interact, 'y', 'only the non-default binding persists');
}

// ---------------- conflict swap ----------------------------------------------
{
  const r = KB.setBinding('craft', 'y'); // y is interact's key now
  assert.ok(r.ok && r.swapped && r.swapped.id === 'interact', 'conflicts swap with the holder');
  assert.equal(KB.keyFor('craft'), 'y');
  assert.equal(KB.keyFor('interact'), 't', 'the holder receives the requester’s previous key');
  assert.equal(KB.translate('y'), 't', 'pressing y now crafts');
  assert.equal(KB.translate('t'), 'e', 'pressing t now interacts');
  assert.equal(KB.translate('e'), '§e', 'e stays dead — no key was lost, none aliased');
  const seen = new Set();
  for (const a of KB.ACTIONS) {
    const k = KB.keyFor(a.id);
    assert.ok(!seen.has(k), 'after swaps every action still holds a unique key');
    seen.add(k);
  }
}

// ---------------- reserved keys ----------------------------------------------
{
  for (const bad of ['1', '0', ' ', 'arrowleft', 'escape', 'enter', 'f3', '+', '-', '[', ']', '/', '']) {
    assert.equal(KB.setBinding('jump', bad).ok, false, "reserved key '" + bad + "' is rejected");
  }
  assert.equal(KB.keyFor('jump'), 'w', 'rejected attempts leave the binding untouched');
}

// ---------------- reset -------------------------------------------------------
{
  KB.resetAll();
  assert.equal(KB.translate('y'), 'y', 'reset restores identity translation');
  assert.equal(KB.translate('e'), 'e');
  assert.equal(KB.isCustomized(), false);
  assert.equal(store['mm_keybinds_v1'], '{}', 'reset persists an empty blob');
}

// ---------------- persistence round-trip -------------------------------------
{
  store['mm_keybinds_v1'] = JSON.stringify({ interact: 'y', pause: ';' });
  const { keybinds: KB2 } = await import('../src/engine/keybinds.js?phase=reload');
  assert.equal(KB2.keyFor('interact'), 'y', 'bindings survive a reload');
  assert.equal(KB2.keyFor('pause'), ';');
  assert.equal(KB2.translate('y'), 'e');
  assert.equal(KB2.translate(';'), 'b');
}
{
  // tampered blob aliasing two actions onto one key resets to defaults
  store['mm_keybinds_v1'] = JSON.stringify({ interact: 't' }); // craft already owns t
  const { keybinds: KB3 } = await import('../src/engine/keybinds.js?phase=tamper');
  assert.equal(KB3.keyFor('interact'), 'e', 'colliding blob fails closed to defaults');
  assert.equal(KB3.keyFor('craft'), 't');
  // junk blobs must not throw
  store['mm_keybinds_v1'] = '{not json';
  const { keybinds: KB4 } = await import('../src/engine/keybinds.js?phase=junk');
  assert.equal(KB4.keyFor('interact'), 'e', 'unparseable blob falls back to defaults');
}

// ---------------- display names ----------------------------------------------
{
  assert.equal(KB.displayKey(' '), 'Spacja');
  assert.equal(KB.displayKey('arrowleft'), '←');
  assert.equal(KB.displayKey('a'), 'A');
}

// ---------------- source-shape pins ------------------------------------------
const mainSrc = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
{
  // both key listeners translate the physical key before anything reads it
  const translated = mainSrc.match(/KEYBINDS\.translate\(e\.key\.toLowerCase\(\)\)/g) || [];
  assert.ok(translated.length >= 2, 'main.js keydown AND keyup run keys through KEYBINDS.translate (got ' + translated.length + ')');
  assert.match(mainSrc, /KEYBINDS\.translate\(ev\.key\.toLowerCase\(\)\)==='z'/, 'the undo listener honors rebinds');
  // fullscreen: rebindable key branch + pause-panel button + change sync
  assert.match(mainSrc, /k==='u'&&!keysOnce\.has\('u'\)\)\{ toggleFullscreen\(\)/, 'fullscreen key branch (default U)');
  assert.match(mainSrc, /k==='q'&&!keysOnce\.has\('q'\)\)\{ toggleSpecialVision\(\)/, 'Q toggles equipment-powered night or thermal vision');
  assert.match(mainSrc, /\['fullscreenchange','webkitfullscreenchange'\]/, 'standard and WebKit fullscreen changes synchronize the UI');
  assert.match(mainSrc, /document\.fullscreenElement \|\| document\.webkitFullscreenElement/, 'fullscreen state supports standard and WebKit browsers');
  assert.match(mainSrc, /root\.requestFullscreen \|\| root\.webkitRequestFullscreen/, 'fullscreen entry supports standard and WebKit browsers');
  assert.match(mainSrc, /document\.exitFullscreen \|\| document\.webkitExitFullscreen/, 'fullscreen exit supports standard and WebKit browsers');
  assert.match(mainSrc, /getElementById\('fullscreenBtn'\)\?\.addEventListener\('click',toggleFullscreen\)/, 'the permanent HUD control toggles fullscreen');
  assert.match(mainSrc, /MM\.fullscreen=\{active:fullscreenActive,supported:fullscreenSupported,toggle:toggleFullscreen,sync:syncFullscreenControls\}/, 'fullscreen state is exposed for integration checks');
  assert.match(mainSrc, /pauseFullscreenBtn/, 'pause panel exposes the fullscreen button');
  // music switch + keybind editor reachable from the pause card
  assert.match(mainSrc, /Muzyka włączona/, 'pause panel exposes the music on/off switch');
  assert.match(mainSrc, /setMusicOn\(musicOn\.checked\)/, 'the switch drives MM.audio.setMusicOn');
  assert.match(mainSrc, /openKeybindPanel/, 'pause panel opens the keybind editor');
  assert.match(mainSrc, /addEventListener\('keydown',keybindTrapKeydown,true\)/, 'the keybind editor traps keys in the capture phase');
}
{
  const invSrc = fs.readFileSync(path.join(SRC, 'inventory_ui.js'), 'utf8');
  const hits = invSrc.match(/logicalKey\(e\)==='e'/g) || [];
  assert.ok(hits.length >= 3, 'inventory_ui compares the logical interact key everywhere (got ' + hits.length + ')');
  assert.match(invSrc, /MM\.keybinds\.translate/, 'inventory_ui consults the shared translation');
}
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /#keybindPanel\{/, 'index.html styles the keybind panel');
  assert.match(html, /id="fullscreenBtn"[^>]*aria-pressed="false"/, 'the HUD exposes an accessible fullscreen button');
  assert.match(html, /#menuWrap #fullscreenBtn\[aria-pressed="true"\]/, 'active fullscreen mode has a distinct HUD state');
}

console.log('keybinds-sim: all tests passed');
