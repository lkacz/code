import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const backgroundSrc = await readFile(new URL('../src/engine/background.js', import.meta.url), 'utf8');
const meteoritesSrc = await readFile(new URL('../src/engine/meteorites.js', import.meta.url), 'utf8');
const capeSrc = await readFile(new URL('../src/engine/cape.js', import.meta.url), 'utf8');
const htmlSrc = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const { debugShortcutsEnabled, devToolsArmed, applyDevToolsFlag } = await import('../src/engine/debug_shortcuts.js');
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

// The 🛠 trigger is CSS-gated on <html data-dev-tools='1'>; without a switch the
// gate silently deleted the developer toolbox from the author's own game.
assert.equal(devToolsArmed(''), true, 'a normal solo page arms the developer toolbox');
assert.equal(devToolsArmed('?seed=777'), true, 'ordinary query parameters keep the toolbox armed');
assert.equal(devToolsArmed('?watch=ROOM7'), false, 'a spectator/guest replica never gets world-writing debug panels');
assert.equal(devToolsArmed('?via=rtc&watch=ROOM7'), false, 'the watch refusal does not depend on parameter order');
assert.equal(devToolsArmed('?dev=0'), false, 'dev=0 is an explicit opt-out for clean captures');
{
	const attrs={};
	const fakeRoot={setAttribute:(k,v)=>{ attrs[k]=v; },removeAttribute:k=>{ delete attrs[k]; }};
	assert.equal(applyDevToolsFlag({documentElement:fakeRoot},''), true, 'applying the flag reports the armed decision');
	assert.equal(attrs['data-dev-tools'], '1', 'the CSS gate is opened by the data-dev-tools attribute');
	assert.equal(applyDevToolsFlag({documentElement:fakeRoot},'?watch=ROOM7'), false, 'a spectator page reports a disarmed toolbox');
	assert.equal('data-dev-tools' in attrs, false, 'a spectator page leaves the CSS gate closed');
	assert.equal(applyDevToolsFlag(null,''), true, 'the flag helper survives a document-less host (Node tests)');
}
assert.match(htmlSrc, /:root:not\(\[data-dev-tools='1'\]\) \.devOnly\{ display:none !important; \}/, 'developer-only UI stays hidden until the flag is published');
assert.match(mainSrc, /import \{ applyDevToolsFlag, debugShortcutsEnabled \} from '\.\/engine\/debug_shortcuts\.js'/, 'main uses the shared debug-shortcut predicate');
assert.match(mainSrc, /applyDevToolsFlag\(\);\nconst menuPanel=document\.getElementById\('menuPanel'\);/, 'boot publishes the dev-tools flag before wiring the toolbox');
assert.match(mainSrc, /const debugKeysEnabled=debugShortcutsEnabled\(\);/, 'the keydown event takes one toolbox state snapshot');
for(const key of ['f3','g',';','p','j','k','l','m','v','o']){
	assert.match(mainSrc, new RegExp("if\\(debugKeysEnabled && k==='"+key+"'"), 'debug shortcut '+key.toUpperCase()+' is toolbox-gated');
}
for(const key of ['c','t','e','h','x','f','b','n','u']){
	assert.match(mainSrc, new RegExp("if\\(k==='"+key+"'"), 'normal shortcut '+key.toUpperCase()+' stays available outside debug');
}
assert.match(mainSrc, /if\(k==='r'&&/, 'normal rotation shortcut stays available outside debug');
assert.match(mainSrc, /godBtn\.addEventListener\('click',toggleGod\)/, 'developer toolbox buttons remain directly operable');
assert.match(htmlSrc, /Debug \(tylko przy otwartym panelu\):/, 'the toolbox explains when its keyboard shortcuts are armed');
assert.match(mainSrc, /F3\/M\/G\/; i pozostałe skróty testowe działają wyłącznie przy otwartym panelu deweloperskim/, 'legacy help no longer advertises active cheats outside the toolbox');

assert.match(uiSrc, /const DEBUG_SETTINGS_KEY='mm_debug_menu_settings_v1'/, 'debug menu settings use one stable localStorage key');
assert.match(uiSrc, /simulation:\{speed:1\}/, 'global simulation pace has a stable real-time default');
assert.match(uiSrc, /window\.__simulationTimeScale=speed/, 'simulation pace control publishes one shared scale for the game loop');
assert.match(uiSrc, /Wspólny zegar dla fizyki, pogody, stworzeń, maszyn/, 'simulation pace control explains its global scope');
assert.match(mainSrc, /function advanceSimulationClock\(dt\)[\s\S]*window\.__mmSimulationTimeMs=simulationClockMs/, 'scaled simulation time is published as the shared world clock');
assert.match(backgroundSrc, /function simulationClockNow\(\)[\s\S]*window\.__mmSimulationTimeMs/, 'the day and night cycle follows the shared scaled world clock');
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

assert.match(uiSrc, /energy:\{autoRenews:false\}/, 'hero energy auto-renew has a safe disabled default');
assert.match(uiSrc, /function injectEnergyDebugPanel\(actions, menuPanel\)/, 'ui exposes the hero energy debug toggle');
assert.match(uiSrc, /Energy: auto renews/, 'debug menu names the auto-renew toggle explicitly');
assert.match(uiSrc, /debugSet\('energy','autoRenews',chk\.checked\)/, 'energy auto-renew persists across app runs');
assert.match(uiSrc, /dataset\.devTools==='1'/, 'stored debug energy renewal stays disabled on guest replicas');
assert.match(mainSrc, /function renewDebugHeroEnergyIfEmpty\(\)[\s\S]*player\.energy=player\.maxEnergy\|\|heroEnergyCapacity\(\)/, 'an exhausted hero is refilled to the current full capacity');
assert.match(mainSrc, /function setDebugEnergyAutoRenews\(enabled\)/, 'main exposes one setter for the persisted toggle');
assert.match(mainSrc, /injectEnergyDebugPanel\(\{[\s\S]*autoRenews:setDebugEnergyAutoRenews/, 'main wires the energy toggle into the debug menu');

assert.match(uiSrc, /function injectMechDebugPanel\(actions, menuPanel\)/, 'ui exposes a mech debug panel injector');
assert.match(uiSrc, /\['spawnForge','Spawn forge'/, 'mech debug panel can force-spawn forge mechs');
assert.match(uiSrc, /\['spawnCrawler','Spawn gasienice'/, 'mech debug panel can force-spawn tracked forge crawlers');
assert.match(uiSrc, /\['spawnDrill','Spawn wiertnice'/, 'mech debug panel can force-spawn the vertical boring rig');
assert.match(uiSrc, /\['procRight','Strefa ->'/, 'mech debug panel can force far-zone prototype mech spawns');
assert.match(uiSrc, /\['capture','Przejmij'/, 'mech debug panel can capture a pilot-defeated mech');
assert.match(uiSrc, /\['driveRight','Krok ->'/, 'mech debug panel can test rider movement power gating');
assert.match(uiSrc, /\['powerRig','Zasil rig'/, 'mech debug panel can place authentic local power rigs');
assert.match(uiSrc, /\['shield','Pancerz'/, 'mech debug panel can test armor absorption');
assert.match(uiSrc, /\['pit','Dol'/, 'mech debug panel can set up pit jump/escape tests');
assert.match(uiSrc, /\['wall','Sciana'/, 'mech debug panel can set up house/wall attack tests');
assert.match(mainSrc, /injectMechDebugPanel\(\{/, 'main wires the mech debug panel into the menu');
for(const action of ['zoneLeft','zoneRight','procLeft','procRight','spawnSolar','spawnForge','spawnCrawler','spawnDrill','killPilot','board','capture','driveLeft','driveRight','jumpTest','fillPower','emptyPower','powerRig','shield','damage','fireHit','waterHit','destroy','wall','trees','pit','mob','saveLoad','reset','metrics']){
	assert.match(mainSrc, new RegExp(action+':'), 'main wires mech debug action '+action);
}

// --- cape workshop ----------------------------------------------------------
// The knob roster lives in THREE places (cape.js defaults, cape.js ranges, the
// ui.js slider table) and a knob missing from any of them is invisible: the
// slider silently disappears, or the panel offers a control the integrator
// never reads. Extract all three literals and compare them.
assert.match(uiSrc, /function injectCapeDebugPanel\(actions, menuPanel\)/, 'ui exposes a cape debug panel injector');
assert.match(uiSrc, /injectGearDebugPanel, injectCapeDebugPanel, setRadarPulsing/, 'the cape panel is published on the ui api object');
{
	const knobBlock=/const CAPE_KNOBS=\[([\s\S]*?)\n {2}\];/.exec(uiSrc);
	assert.ok(knobBlock, 'CAPE_KNOBS is a literal slider table');
	const knobKeys=[...knobBlock[1].matchAll(/\['(\w+)'/g)].map(m=>m[1]);
	assert.deepEqual(knobKeys, ['grav','gov','flutter','drag','wind','stiff','damp','len','bias'],
		'every tuning knob has a slider, in the order the panel presents them');

	const defBlock=/const TUNE_DEFAULTS=Object\.freeze\(\{([\s\S]*?)\}\);/.exec(capeSrc);
	assert.ok(defBlock, 'cape.js publishes its tuning defaults as one frozen literal');
	const defKeys=[...defBlock[1].matchAll(/(\w+):/g)].map(m=>m[1]);
	assert.deepEqual(new Set(defKeys), new Set(knobKeys), 'the panel exposes exactly the knobs the integrator defaults');

	const rangeBlock=/const TUNE_RANGE=Object\.freeze\(\{([\s\S]*?)\}\);/.exec(capeSrc);
	assert.ok(rangeBlock, 'cape.js publishes its tuning ranges as one frozen literal');
	const rangeKeys=[...rangeBlock[1].matchAll(/(\w+):\[/g)].map(m=>m[1]);
	assert.deepEqual(new Set(rangeKeys), new Set(knobKeys), 'every knob carries a sanitiser range');
	// The integrator must actually READ each knob — a renamed constant that
	// stops consulting `tune` leaves a slider that moves nothing.
	for(const key of knobKeys){
		assert.match(capeSrc, new RegExp('tune\\.'+key+'\\b'), 'the cape integrator reads tune.'+key);
	}
}
assert.match(uiSrc, /input\.min=String\(r\[0\]\); input\.max=String\(r\[1\]\);/, 'slider bounds come from the sim sanitiser, not a second table in the panel');
assert.match(uiSrc, /debugSet\('cape',key,v\)/, 'moving a cape slider persists that knob');
assert.match(uiSrc, /debugHasKey\('cape',key\) \? debugNumber\('cape',key,fallback,r\[0\],r\[1\]\) : fallback/,
	'a half-written cape section keeps the shipped default for the knobs it never mentions');
assert.match(uiSrc, /let colorTouched=false;/, 'the cape colour picker only overrides once it has been touched');
assert.match(uiSrc, /dump\.select\(\); dump\.blur\(\);/, 'the export field hands focus back — a focused toolbox input freezes the mid-edit guard');
{
	const capeWire=/injectCapeDebugPanel\(\{([\s\S]*?)\n\}, menuPanel\);/.exec(mainSrc);
	assert.ok(capeWire, 'main wires the cape workshop into the toolbox');
	for(const key of ['fabrics','styles','defaults','range','look','tune','metrics','export']){
		assert.match(capeWire[1], new RegExp('(^|\\n)\\t'+key+':'), 'main wires cape workshop action '+key);
	}
}

assert.match(meteoritesSrc, /const STORE_KEY = 'mm_meteorites_v1'/, 'meteorite debug toggle already has stable persisted settings');
assert.match(meteoritesSrc, /localStorage\.setItem\(STORE_KEY/, 'meteorite debug toggle writes persisted settings');
assert.match(meteoritesSrc, /localStorage\.getItem\(STORE_KEY\)/, 'meteorite debug toggle reads persisted settings');

console.log('debug-settings-sim: all assertions passed');
