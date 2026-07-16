import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const meteoritesSrc = await readFile(new URL('../src/engine/meteorites.js', import.meta.url), 'utf8');
const htmlSrc = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const { debugShortcutsEnabled } = await import('../src/engine/debug_shortcuts.js');
function fakeDebugDocument({panelHidden=true,expanded='false',panelConnected=true,buttonConnected=true}={}){
	const controls={
		menuPanel:{hidden:panelHidden,isConnected:panelConnected},
		debugMenuBtn:{isConnected:buttonConnected,getAttribute:name=>name==='aria-expanded'?expanded:null},
	};
	return {getElementById:id=>controls[id]||null};
}
assert.equal(debugShortcutsEnabled(null), false, 'debug shortcuts fail closed without a document');
assert.equal(debugShortcutsEnabled({getElementById:()=>null}), false, 'debug shortcuts fail closed without the developer controls');
assert.equal(debugShortcutsEnabled(fakeDebugDocument()), false, 'a closed toolbox does not arm debug shortcuts');
assert.equal(debugShortcutsEnabled(fakeDebugDocument({panelHidden:false,expanded:'false'})), false, 'a visible but unsynchronised toolbox fails closed');
assert.equal(debugShortcutsEnabled(fakeDebugDocument({panelHidden:true,expanded:'true'})), false, 'aria state alone cannot arm hidden debug shortcuts');
assert.equal(debugShortcutsEnabled(fakeDebugDocument({panelHidden:false,expanded:'true',panelConnected:false})), false, 'stale developer controls cannot arm shortcuts');
assert.equal(debugShortcutsEnabled(fakeDebugDocument({panelHidden:false,expanded:'true'})), true, 'opening the developer toolbox explicitly arms debug shortcuts');

assert.match(mainSrc, /import \{ debugShortcutsEnabled \} from '\.\/engine\/debug_shortcuts\.js'/, 'main uses the shared debug-shortcut predicate');
assert.match(mainSrc, /const debugKeysEnabled=debugShortcutsEnabled\(\);/, 'the keydown event takes one toolbox state snapshot');
for(const key of ['f3','g','i','p','j','k','l','m','v','o']){
	assert.match(mainSrc, new RegExp("if\\(debugKeysEnabled && k==='"+key+"'"), 'debug shortcut '+key.toUpperCase()+' is toolbox-gated');
}
for(const key of ['c','t','e','h','x','f','b','n','u']){
	assert.match(mainSrc, new RegExp("if\\(k==='"+key+"'"), 'normal shortcut '+key.toUpperCase()+' stays available outside debug');
}
assert.match(mainSrc, /if\(k==='r'&&/, 'normal rotation shortcut stays available outside debug');
assert.match(mainSrc, /godBtn\.addEventListener\('click',toggleGod\)/, 'developer toolbox buttons remain directly operable');
assert.match(htmlSrc, /Debug \(tylko przy otwartym panelu\):/, 'the toolbox explains when its keyboard shortcuts are armed');
assert.match(mainSrc, /F3\/M\/G\/I i pozostałe skróty testowe działają wyłącznie przy otwartym panelu deweloperskim/, 'legacy help no longer advertises active cheats outside the toolbox');

assert.match(uiSrc, /const DEBUG_SETTINGS_KEY='mm_debug_menu_settings_v1'/, 'debug menu settings use one stable localStorage key');
assert.match(uiSrc, /function debugSet\(section,key,value\)/, 'debug UI has a shared setting writer');
assert.match(uiSrc, /debugSettings:\{load:readDebugSettings,set:debugSet,section:debugSection\}/, 'debug setting helpers are exposed for future debug panels');

assert.match(uiSrc, /range\.value=String\(debugNumber\('time','value',0,0,1\)\)/, 'time slider restores its saved position');
assert.match(uiSrc, /debugSet\('time','active',chk\.checked\)/, 'time override toggle persists across app runs');
assert.match(uiSrc, /debugSet\('time','value',readTimeValue\(\)\)/, 'time override value persists across app runs');

assert.match(uiSrc, /background:\{blur:1\}/, 'background debug settings have a stable default blur scale');
assert.match(uiSrc, /function injectBackgroundDebugPanel\(menuPanel\)/, 'ui exposes a background debug panel injector');
assert.match(uiSrc, /blur\.value=String\(debugNumber\('background','blur',1,0\.5,2\.2\)\)/, 'background blur slider restores its saved scale');
assert.match(uiSrc, /window\.__backdropBlurScale=value;/, 'background blur slider applies to the live renderer');
assert.match(uiSrc, /debugSet\('background','blur',readBlur\(\)\)/, 'background blur slider persists changes');

assert.match(uiSrc, /power\.value=String\(debugNumber\('gas','power',2,0\.5,5\)\)/, 'gas debug power slider restores saved power');
assert.match(uiSrc, /debugSet\('gas','power',readPower\(\)\)/, 'gas debug power slider persists changes');

assert.match(uiSrc, /function applyStoredWindDebugSettings\(\)/, 'wind debug mode is restored when the panel is injected');
assert.match(uiSrc, /debugHasKey\('wind','mode'\)/, 'wind restore only applies explicitly saved wind modes');
assert.match(uiSrc, /debugSet\('wind','mode','override'\)/, 'wind forced override mode persists');
assert.match(uiSrc, /debugSet\('wind','mode','profile'\)/, 'wind weather profile mode persists');
assert.match(uiSrc, /debugSet\('wind','mode','natural'\)/, 'wind natural mode persists');
assert.match(uiSrc, /if\(actions\.exact\) actions\.exact\(v\);/, 'saved wind override is reapplied through debug actions');
assert.match(uiSrc, /if\(actions\.profile\) actions\.profile\(saved\.profile\);/, 'saved wind weather profile is reapplied through debug actions');

assert.match(uiSrc, /function applyStoredSeasonDebugSettings\(\)/, 'season debug mode is restored when the panel is injected');
assert.match(uiSrc, /debugSet\('seasons','enabled',!on\)/, 'season debug enable toggle persists');
assert.match(uiSrc, /debugSet\('seasons','forced',null\)/, 'season natural mode persists');
assert.match(uiSrc, /debugSet\('seasons','forced',id\)/, 'forced season debug mode persists');
assert.match(uiSrc, /debugHasKey\('seasons','forced'\)/, 'season restore only applies explicitly saved forced mode');
assert.match(uiSrc, /debugHasKey\('seasons','enabled'\)/, 'season restore only applies explicitly saved enabled toggle');

assert.match(uiSrc, /hostility:\{intensity:1,reach:1\}/, 'hostility ramp debug settings have stable defaults');
assert.match(uiSrc, /function injectHostilityDebugPanel\(actions, menuPanel\)/, 'ui exposes a hostility ramp debug panel injector');
assert.match(uiSrc, /debugNumber\('hostility','intensity',1,0,3\)/, 'hostility intensity slider restores its saved value');
assert.match(uiSrc, /debugNumber\('hostility','reach',1,0\.25,4\)/, 'hostility reach slider restores its saved value');
assert.match(uiSrc, /debugSet\('hostility','intensity',readIntensity\(\)\)/, 'hostility intensity slider persists changes');
assert.match(uiSrc, /debugSet\('hostility','reach',readReach\(\)\)/, 'hostility reach slider persists changes');

assert.match(uiSrc, /function injectMechDebugPanel\(actions, menuPanel\)/, 'ui exposes a mech debug panel injector');
assert.match(uiSrc, /\['spawnForge','Spawn forge'/, 'mech debug panel can force-spawn forge mechs');
assert.match(uiSrc, /\['spawnCrawler','Spawn gasienice'/, 'mech debug panel can force-spawn tracked forge crawlers');
assert.match(uiSrc, /\['procRight','Strefa ->'/, 'mech debug panel can force far-zone prototype mech spawns');
assert.match(uiSrc, /\['capture','Przejmij'/, 'mech debug panel can capture a pilot-defeated mech');
assert.match(uiSrc, /\['driveRight','Krok ->'/, 'mech debug panel can test rider movement power gating');
assert.match(uiSrc, /\['powerRig','Zasil rig'/, 'mech debug panel can place authentic local power rigs');
assert.match(uiSrc, /\['shield','Pancerz'/, 'mech debug panel can test armor absorption');
assert.match(uiSrc, /\['pit','Dol'/, 'mech debug panel can set up pit jump/escape tests');
assert.match(uiSrc, /\['wall','Sciana'/, 'mech debug panel can set up house/wall attack tests');
assert.match(mainSrc, /injectMechDebugPanel\(\{/, 'main wires the mech debug panel into the menu');
for(const action of ['zoneLeft','zoneRight','procLeft','procRight','spawnSolar','spawnForge','spawnCrawler','killPilot','board','capture','driveLeft','driveRight','jumpTest','fillPower','emptyPower','powerRig','shield','damage','fireHit','waterHit','destroy','wall','trees','pit','mob','saveLoad','reset','metrics']){
	assert.match(mainSrc, new RegExp(action+':'), 'main wires mech debug action '+action);
}

assert.match(meteoritesSrc, /const STORE_KEY = 'mm_meteorites_v1'/, 'meteorite debug toggle already has stable persisted settings');
assert.match(meteoritesSrc, /localStorage\.setItem\(STORE_KEY/, 'meteorite debug toggle writes persisted settings');
assert.match(meteoritesSrc, /localStorage\.getItem\(STORE_KEY\)/, 'meteorite debug toggle reads persisted settings');

console.log('debug-settings-sim: all assertions passed');
