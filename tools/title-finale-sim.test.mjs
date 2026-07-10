// The game's bookends: title screen (boot greeting, QA auto-skip contract,
// splash humor pool) and finale (layer-closure report: deaths tally, unlock on
// the mother guardian, stats model, in-character credits). Also pins the
// main.js/index.html wiring shapes so the integration can't silently unwire.
// Run: node tools/title-finale-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

// window-style event bus (Node's globalThis is not an EventTarget)
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);

// localStorage stub (defineProperty: some Node builds expose a getter-only global)
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: k => { store.delete(String(k)); },
    key: i => [...store.keys()][i] ?? null,
    get length(){ return store.size; }
  }
});

const { titleScreen } = await import('../src/engine/title_screen.js');
const { finale } = await import('../src/engine/finale.js');
const { STORY_LORE } = await import('../src/engine/story_lore.js');
assert.ok(titleScreen && finale, 'both modules export');

// --- title: splash pool ------------------------------------------------------
assert.ok(titleScreen.SPLASHES.length >= 20, 'a real splash pool (got ' + titleScreen.SPLASHES.length + ')');
assert.equal(new Set(titleScreen.SPLASHES).size, titleScreen.SPLASHES.length, 'no duplicate splashes');
for(const s of titleScreen.SPLASHES) assert.ok(typeof s === 'string' && s.trim().length > 8, 'splash is a real sentence: ' + s);
const first = titleScreen.pickSplash(() => 0.3);
assert.ok(titleScreen.SPLASHES.includes(first), 'pickSplash draws from the pool');
assert.notEqual(titleScreen.pickSplash(() => 0.3), first, 'same roll twice never repeats back-to-back');

// --- title: automation skip contract ----------------------------------------
const skip = titleScreen.shouldAutoSkip;
assert.equal(skip({ua: 'Mozilla/5.0 HeadlessEdg/126.0'}), true, 'headless UA skips');
assert.equal(skip({webdriver: true}), true, 'webdriver skips');
assert.equal(skip({ua: 'Mozilla/5.0 Edg/126.0'}), false, 'a human browser shows');
assert.equal(skip({ua: 'HeadlessEdg', search: '?seed=42&title=1'}), false, '?title=1 forces the screen even headless');
assert.equal(skip({ua: 'Mozilla/5.0', search: '?title=0'}), true, '?title=0 force-skips for humans');
assert.equal(skip({}), false, 'no signals at all: show');

// --- title: Node boot is inert (no DOM => skipped, never throws) -------------
assert.equal(titleScreen.boot({hasSave: true}), 'skipped', 'DOM-less boot skips gracefully');
assert.equal(titleScreen.isOpen(), false, 'skip leaves the screen closed');

// --- finale: deaths ride the mm-hero-died event and persist ------------------
finale.reset();
assert.equal(finale.metrics().deaths, 0, 'fresh profile starts at zero deaths');
for(const cause of ['lava', 'ghost', 'inner_self']) globalThis.dispatchEvent(new CustomEvent('mm-hero-died', {detail: {cause}}));
assert.equal(finale.report().deaths, 3, 'each death counts once');
assert.equal(JSON.parse(store.get('mm_finale_v1')).deaths, 3, 'deaths persist in mm_finale_v1');

// --- finale: only the mother guardian unlocks the ceremony --------------------
assert.equal(finale.unlocked(), false, 'locked before the story completes');
globalThis.dispatchEvent(new CustomEvent('mm-guardian-defeated', {detail: {kind: 'ice'}}));
assert.equal(finale.unlocked(), false, 'side guardians do not unlock the finale');
globalThis.dispatchEvent(new CustomEvent('mm-guardian-defeated', {detail: {kind: 'mother', center: true}}));
assert.equal(finale.unlocked(), true, 'the mother guardian unlocks it');
assert.equal(finale.isOpen(), false, 'the report waits for the epilogue speech');
finale.update(finale.config.BANNER_DELAY + 1);
assert.equal(finale.isOpen(), false, 'banner window still leaves the screen closed');
finale.update(finale.config.AUTO_OPEN_DELAY);
assert.equal(finale.isOpen(), true, 'the one-time auto-open fires after the epilogue window');
finale.close();
assert.equal(finale.isOpen(), false, 'close() works');
assert.equal(JSON.parse(store.get('mm_finale_v1')).seen, true, 'viewing is remembered');
finale.update(1000);
assert.equal(finale.isOpen(), false, 'auto-open never fires twice');

// --- finale: report model pulls from the progression APIs --------------------
const rep = finale.report({
  progress: {
    guardianHearts: () => ({ice: 1, fire: 1, earth: 1, air: 1, mother: 1}),
    level: () => ({level: 17}),
    snapshot: () => ({bossKills: 9}),
    milestones: () => [{id: 'a', done: true}, {id: 'b', done: true}, {id: 'c', done: false}]
  },
  discovery: {progress: () => ({count: 7, total: 18})},
  seasons: {metrics: () => ({day: 23.7})},
  seed: 424242
});
assert.equal(rep.day, 23, 'day comes from seasons.metrics');
assert.equal(rep.level, 17, 'level comes from progress.level');
assert.equal(rep.bossKills, 9, 'boss kills come from the progress snapshot');
assert.equal(rep.discoveries.count + '/' + rep.discoveries.total, '7/18', 'discovery counters flow through');
assert.equal(rep.milestones.done + '/' + rep.milestones.total, '2/3', 'milestone counters flow through');
assert.equal(rep.seed, 424242, 'the world seed reaches the report');
assert.equal(rep.deaths, 3, 'the deaths tally reaches the report');
assert.equal(rep.guardians.length, 5, 'all five story guardians are listed');
assert.deepEqual(rep.guardians.map(g => g.key), ['ice', 'fire', 'earth', 'air', 'mother'], 'story order preserved');
const loreGuardians = STORY_LORE.metaphor.guardians;
assert.equal(rep.guardians[0].name, loreGuardians.west_ice.name, 'guardian names come from the story lore');
assert.equal(rep.guardians[4].symbol, loreGuardians.mother_self.symbol, 'guardian symbols come from the story lore');
assert.ok(rep.guardians.every(g => g.defeated), 'hearts mark guardians defeated');

// --- finale: credits stay diegetic -------------------------------------------
const cred = finale.credits(rep);
assert.ok(cred.length >= 8, 'a proper credits roll');
assert.ok(cred.every(c => Array.isArray(c) && c.length === 2), 'credits are [role, name] pairs');
assert.ok(cred.some(c => c[1].includes('424242')), 'the seed gets a scenography credit');
assert.ok(cred.some(c => /dziękujemy/i.test(c[1])), 'the simulation says thank you');

// --- finale: reset + new-game sweep clear the profile -------------------------
finale.reset();
assert.deepEqual(finale.metrics(), {deaths: 0, unlocked: false, seen: false, open: false}, 'reset zeroes everything');
const { clearActiveGameStorage, NEW_GAME_PREFERENCE_KEYS } = await import('../src/engine/new_game.js');
assert.ok(!NEW_GAME_PREFERENCE_KEYS.includes('mm_finale_v1'), 'finale history is game state, not a preference');
store.set('mm_finale_v1', JSON.stringify({v: 1, deaths: 5, unlocked: true, seen: true}));
store.set('mm_audio_v1', '{"volume":0.5}');
clearActiveGameStorage(globalThis.localStorage);
assert.equal(store.has('mm_finale_v1'), false, 'a new game clears the finale history');
assert.equal(store.has('mm_audio_v1'), true, 'preferences survive a new game');

// --- wiring pins: main.js + index.html keep the bookends installed ------------
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(/import \{ titleScreen as TITLE_SCREEN \} from '\.\/engine\/title_screen\.js';/.test(mainSrc), 'main.js imports the title screen');
assert.ok(/import \{ finale as FINALE \} from '\.\/engine\/finale\.js';/.test(mainSrc), 'main.js imports the finale');
assert.ok(/new CustomEvent\('mm-hero-died'/.test(mainSrc), 'heroDied dispatches mm-hero-died');
assert.ok(/TITLE_SCREEN\.boot\(\{ hasSave: !!localStorage\.getItem\(SAVE_KEY\), onNewGame: startNewGame \}\)/.test(mainSrc), 'title boots with the autosave probe and startNewGame');
assert.ok(/FINALE\.wire\(\{ onNewGame: startNewGame \}\)/.test(mainSrc), 'finale gets the new-game hook');
assert.ok(/function uiOverlayHold\(\)/.test(mainSrc), 'the overlay hold gate exists');
assert.ok(/if\(!paused && !overlayHold\)\{/.test(mainSrc), 'the sim step gates on the overlay hold');
assert.ok(/if\(FINALE && FINALE\.update\) FINALE\.update\(dt\);/.test(mainSrc), 'the finale timers tick inside runGameStep');
const htmlSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(/<title>Mini Miner – Warstwy Symulacji<\/title>/.test(htmlSrc), 'the page carries the real game title');
assert.ok(/id="openFinale"[^>]*hidden/.test(htmlSrc), 'the menu ships a hidden Zakończenie entry');
assert.ok(/#titleScreen\{[^}]*z-index:200/.test(htmlSrc), 'title screen styles installed above the HUD');
assert.ok(/#finaleScreen\{[^}]*z-index:200/.test(htmlSrc), 'finale styles installed above the HUD');
assert.ok(/#finaleBanner\{[^}]*z-index:90/.test(htmlSrc), 'the finale banner sits under the overlays');

console.log('title-finale-sim: all assertions passed');
