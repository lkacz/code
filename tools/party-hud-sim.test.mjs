// Party HUD regressions (engine/party_hud.js — the pure geometry core):
// on/off-screen classification against the standard world→screen mapping,
// elliptical edge clamping for the off-screen arrows, the stable self-first
// roster sort, and the hp color thresholds. The DOM/canvas painters are
// browser-only and must stay inert under Node (no document, no crash).
// Run: node tools/party-hud-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const HUD = await import('../src/engine/party_hud.js');
const { partyPointers, partyRoster, hpColor, focusPulse, FOCUS_MS } = HUD;

assert.ok(globalThis.MM.partyHud && typeof globalThis.MM.partyHud.draw === 'function',
	'module registers MM.partyHud with a draw entry point');

// --- partyPointers: classification ---------------------------------------------------
const view = { W: 800, H: 600, tile: 20, zoom: 1, camX: 0, camY: 0, margin: 46, heroX: 20, heroY: 15 };
{
	const r = partyPointers([
		{ id: 'a', name: 'Ala', x: 20, y: 15, hpFrac: 0.8 },            // sx=400 sy=300 → centre
		{ id: 'b', name: 'Bob', x: 100, y: 15, hpFrac: 0.3 },           // sx=2000 → far right
		{ id: 'me', name: 'Ja', x: 20, y: 15, hpFrac: 1, self: true },  // self never gets a pointer
		{ id: 'd', name: 'Duch', x: 20, y: 15, hpFrac: 0, dead: true }, // dead never gets a pointer
		{ id: 'n', name: 'NaN', x: NaN, y: 15, hpFrac: 1 }              // garbage coords are inert
	], view);
	assert.equal(r.onScreen.length, 1, 'exactly the centred member is on screen');
	assert.equal(r.onScreen[0].id, 'a', 'the centred member is classified on-screen');
	assert.equal(r.onScreen[0].sx, 400, 'screen x follows (x-camX)*tile*zoom');
	assert.equal(r.onScreen[0].sy, 300, 'screen y follows (y-camY)*tile*zoom');
	assert.equal(r.offScreen.length, 1, 'exactly the far member gets an edge arrow');
	const off = r.offScreen[0];
	assert.equal(off.id, 'b', 'the far member is the off-screen one');
	// edge = max(24, min(W,H)/2 - 52) = 248; straight right of centre → ang 0
	assert.ok(Math.abs(off.ang) < 1e-9, 'arrow angle points straight right');
	assert.ok(Math.abs(off.ex - 648) < 1e-6 && Math.abs(off.ey - 300) < 1e-6, 'arrow clamps to the edge ellipse');
	assert.equal(off.dist, 80, 'distance label measures from the hero, in world tiles');
}
// margin is exclusive: a point AT the margin line is already off-screen
{
	const r = partyPointers([{ id: 'm', name: 'Rim', x: 2.3, y: 15, hpFrac: 1 }], view); // sx=46 = margin
	assert.equal(r.onScreen.length, 0, 'a member exactly on the margin line is off-screen');
	assert.equal(r.offScreen.length, 1, 'the margin-line member gets an arrow');
}
// vertical clamp: a member far above pins to the top of the ellipse
{
	const r = partyPointers([{ id: 'up', name: 'Góra', x: 20, y: -15, hpFrac: 1 }], view);
	const off = r.offScreen[0];
	assert.ok(Math.abs(off.ang + Math.PI / 2) < 1e-9, 'arrow points straight up');
	assert.ok(Math.abs(off.ex - 400) < 1e-6 && Math.abs(off.ey - 52) < 1e-6, 'vertical clamp lands above centre');
}
// zoom scales the mapping; hpFrac is clamped into [0,1]; missing hero → null dist
{
	const r = partyPointers([{ id: 'z', name: 'Zoom', x: 30, y: 15, hpFrac: 1.7 }],
		{ W: 800, H: 600, tile: 20, zoom: 2, camX: 10, camY: 5 });
	assert.equal(r.offScreen.length, 1, 'zoomed-out-of-view member is off-screen'); // sx=(30-10)*40=800
	assert.equal(r.offScreen[0].hpFrac, 1, 'hpFrac clamps high');
	assert.equal(r.offScreen[0].dist, null, 'no hero position → no distance label');
}
assert.deepEqual(partyPointers(null, view), { onScreen: [], offScreen: [] }, 'non-array members are inert');
assert.deepEqual(partyPointers([{ id: 'x', x: 1, y: 1 }], null), { onScreen: [], offScreen: [] }, 'missing view is inert');

// --- partyRoster: stable, self-first, display-safe -----------------------------------
{
	const rows = partyRoster([
		{ id: 'b', name: 'Zed', x: 1, y: 1, hpFrac: 0.4 },
		{ id: 'a', name: 'Ala', x: 2, y: 2, hpFrac: -0.5, dead: true },
		{ id: 'me', name: 'Ignored', x: 3, y: 3, hpFrac: 2, self: true },
		{ id: 'n', name: 'NoPos', x: NaN, y: 1, hpFrac: 1 }, // positionless non-self drops out
		{ id: 'q', x: 4, y: 4, hpFrac: 0.6 }                 // nameless falls back to 'Gracz'
	]);
	assert.deepEqual(rows.map(r => r.id), ['me', 'a', 'q', 'b'], 'self first, then alphabetical, positionless dropped');
	assert.equal(rows[0].name, 'Ty', 'self renders as "Ty"');
	assert.equal(rows[0].hpFrac, 1, 'hpFrac clamps high in the roster');
	assert.equal(rows[1].hpFrac, 0, 'hpFrac clamps low in the roster');
	assert.equal(rows[1].dead, true, 'dead members stay listed (greyed), never dropped');
	assert.equal(rows[2].name, 'Gracz', 'nameless member gets the fallback name');
}
assert.deepEqual(partyRoster(null), [], 'non-array roster input is inert');

// --- hpColor thresholds ---------------------------------------------------------------
assert.equal(hpColor(1), '#58d68d', 'full hp is green');
assert.equal(hpColor(0.51), '#58d68d', 'above half is green');
assert.equal(hpColor(0.5), '#f4c05a', 'half is amber');
assert.equal(hpColor(0.26), '#f4c05a', 'above quarter is amber');
assert.equal(hpColor(0.25), '#e5533d', 'quarter is red');
assert.equal(hpColor(0), '#e5533d', 'empty is red');
assert.equal(hpColor(7), '#58d68d', 'clamped high stays green');

// --- focus pulse: click-to-highlight contract ------------------------------------------
assert.ok(FOCUS_MS >= 2000, 'the focus pulse lives long enough to spot');
assert.equal(focusPulse(1000, 1000), null, 'an expired pulse is null (the painter clears it)');
assert.equal(focusPulse(2000, 1000), null, 'past-deadline is null');
{
	const a = focusPulse(500, 3500);
	assert.ok(a > 0 && a <= 1, 'a live pulse is a drawable alpha');
}
assert.equal(focusPulse(NaN, 100), null, 'garbage clocks are inert');

// --- painters stay inert under Node ---------------------------------------------------
HUD.draw(null, { members: [{ id: 'a', name: 'Ala', x: 20, y: 15, hpFrac: 0.8 }], W: 800, H: 600, tile: 20, zoom: 1, camX: 0, camY: 0 });
HUD.hide();

console.log('party-hud-sim: all assertions passed');
