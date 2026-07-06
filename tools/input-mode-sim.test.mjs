// Input-mode model regression: the touch/pc decision is a contract — capability
// guess picks the boot mode, then last-input-wins (touch shows the touch UI,
// mouse press or a movement key hides it), with a ghost-mouse grace window after
// touches and neutral pen input. DOM stamping/CSS gating is exercised by
// tools/mobile-controls-qa.mjs (CDP); this covers the state machine.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const { createInputModeModel } = await import('../src/engine/input_mode.js');

const PHONE = { coarse: true, hover: false, fine: false, hasTouch: true };
const DESKTOP = { coarse: false, hover: true, fine: true, hasTouch: false };
const TOUCH_LAPTOP = { coarse: false, hover: true, fine: true, hasTouch: true };
const KIOSK = { coarse: false, hover: false, fine: true, hasTouch: true }; // fine but hoverless

// --- 1. capability guess at boot
{
	assert.equal(createInputModeModel(PHONE).mode(), 'touch', 'coarse pointer boots into touch');
	assert.equal(createInputModeModel(DESKTOP).mode(), 'pc', 'hover+fine boots into pc');
	assert.equal(createInputModeModel(TOUCH_LAPTOP).mode(), 'pc', 'touch laptop primary input is the mouse');
	assert.equal(createInputModeModel(KIOSK).mode(), 'touch', 'hoverless fine pointer with touch points is a touch screen');
	assert.equal(createInputModeModel(undefined).mode(), 'pc', 'no capability data defaults to pc');
}

// --- 2. last-input-wins: touching a hybrid brings the touch UI up, mouse takes it down
{
	const m = createInputModeModel(TOUCH_LAPTOP);
	assert.equal(m.note('touch', 1000), true, 'first touch flips to touch mode');
	assert.equal(m.mode(), 'touch');
	assert.equal(m.note('touch', 1100), false, 'repeat touch is not a change');
	assert.equal(m.note('mouse', 5000), true, 'mouse press flips back to pc');
	assert.equal(m.mode(), 'pc');
}

// --- 3. ghost-mouse grace: synthetic mouse right after a tap must not hide the pad
{
	const m = createInputModeModel(PHONE);
	m.note('touch', 2000);
	assert.equal(m.note('mouse', 2400), false, 'mouse inside the grace window is ignored');
	assert.equal(m.mode(), 'touch');
	assert.equal(m.note('mouse', 2699), false, 'still ignored just under the window');
	assert.equal(m.note('mouse', 2701), true, 'mouse after the grace window counts');
	assert.equal(m.mode(), 'pc');
}

// --- 4. movement keys are keyboard-player evidence; pen is neutral
{
	const m = createInputModeModel(PHONE);
	assert.equal(m.mode(), 'touch');
	assert.equal(m.note('key', 1000), true, 'movement key flips to pc');
	assert.equal(m.mode(), 'pc');
	assert.equal(m.note('pen', 2000), false, 'pen never flips the mode');
	assert.equal(m.mode(), 'pc');
	m.note('touch', 3000);
	assert.equal(m.note('pen', 4000), false, 'pen is neutral from touch mode too');
	assert.equal(m.mode(), 'touch');
}

// --- 5. capability changes re-resolve, then input keeps overriding
{
	const m = createInputModeModel(DESKTOP);
	assert.equal(m.setCapabilities(PHONE), true, 'going coarse re-resolves to touch');
	assert.equal(m.mode(), 'touch');
	assert.equal(m.setCapabilities(PHONE), false, 'same capabilities are not a change');
	assert.equal(m.note('mouse', 9000), true, 'a real mouse still beats the guess');
	assert.equal(m.setCapabilities(DESKTOP), false, 'caps agreeing with current mode change nothing');
	assert.equal(m.capabilities().coarse, false, 'capabilities snapshot tracks the update');
}

console.log('input-mode-sim: OK');
