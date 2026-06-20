import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const meteoritesSrc = await readFile(new URL('../src/engine/meteorites.js', import.meta.url), 'utf8');

assert.match(uiSrc, /const DEBUG_SETTINGS_KEY='mm_debug_menu_settings_v1'/, 'debug menu settings use one stable localStorage key');
assert.match(uiSrc, /function debugSet\(section,key,value\)/, 'debug UI has a shared setting writer');
assert.match(uiSrc, /debugSettings:\{load:readDebugSettings,set:debugSet,section:debugSection\}/, 'debug setting helpers are exposed for future debug panels');

assert.match(uiSrc, /range\.value=String\(debugNumber\('time','value',0,0,1\)\)/, 'time slider restores its saved position');
assert.match(uiSrc, /debugSet\('time','active',chk\.checked\)/, 'time override toggle persists across app runs');
assert.match(uiSrc, /debugSet\('time','value',readTimeValue\(\)\)/, 'time override value persists across app runs');

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

assert.match(meteoritesSrc, /const STORE_KEY = 'mm_meteorites_v1'/, 'meteorite debug toggle already has stable persisted settings');
assert.match(meteoritesSrc, /localStorage\.setItem\(STORE_KEY/, 'meteorite debug toggle writes persisted settings');
assert.match(meteoritesSrc, /localStorage\.getItem\(STORE_KEY\)/, 'meteorite debug toggle reads persisted settings');

console.log('debug-settings-sim: all assertions passed');
