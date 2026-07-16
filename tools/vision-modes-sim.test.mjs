// Night/thermal vision regressions:
//   * explicit off/night/thermal modes with sanitized equipment levels 1..4
//   * safe energy drain, depletion shutdown and anti-toggle cooldown
//   * night phosphor work is bounded and cannot render without a fog contract
//   * thermal vision accepts only supplied, living, currently visible targets
//     and inspects a bounded prefix instead of scanning any world registry
// Run: node tools/vision-modes-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const {
  VISION_LIMITS,
  VISION_MODES,
  createVisionModel,
  sanitizeVisionSnapshot,
} = await import('../src/engine/vision_modes.js');

function energyStore(initial) {
  let energy = initial;
  return {
    canSpend: amount => energy >= amount,
    spendContinuous(amount) {
      const paid = Math.min(energy, amount);
      energy -= paid;
      return paid;
    },
    info: () => ({ energy }),
    value: () => energy,
  };
}

function mockContext(width = 800, height = 450) {
  const calls = [];
  let depth = 0;
  const ctx = {
    canvas: { width, height },
    calls,
    save() { depth++; calls.push(['save']); },
    restore() { depth--; calls.push(['restore']); },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    strokeRect(...args) { calls.push(['strokeRect', ...args]); },
    beginPath() { calls.push(['beginPath']); },
    rect(...args) { calls.push(['rect', ...args]); },
    clip() { calls.push(['clip']); },
    ellipse(...args) { calls.push(['ellipse', ...args]); },
    fill() { calls.push(['fill']); },
    createRadialGradient() {
      const stops = [];
      calls.push(['radialGradient', stops]);
      return { addColorStop: (at, color) => stops.push([at, color]) };
    },
    get depth() { return depth; },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
  };
  return ctx;
}

const VIEW = { x: 0, y: 0, width: 400, height: 240, tileSize: 20, worldX: 10, worldY: 20 };

// --- 1. snapshot hardening and level caps -----------------------------------
assert.deepEqual(sanitizeVisionSnapshot(null), { v: 1, mode: 'off', level: 1 });
assert.deepEqual(sanitizeVisionSnapshot({ mode: 'xray', level: 999 }), { v: 1, mode: 'off', level: 4 },
  'unknown modes fail closed and oversized item levels clamp to four');
assert.deepEqual(sanitizeVisionSnapshot({ mode: 'thermal', level: -8 }), { v: 1, mode: 'thermal', level: 1 });

{
  const model = createVisionModel();
  model.restore({ mode: 'night', level: 99, cooldown: -100 });
  assert.deepEqual(model.snapshot(), { v: 1, mode: 'night', level: 4 }, 'restore keeps only durable sanitized state');
  model.restore({ mode: true, level: 'oops' });
  assert.deepEqual(model.snapshot(), { v: 1, mode: 'off', level: 1 }, 'truthy malformed data cannot enable vision');
}

// --- 2. energy and cooldown safety ------------------------------------------
{
  const model = createVisionModel();
  const empty = energyStore(0);
  assert.equal(model.setMode('night', 2, empty).blocked, 'energy', 'vision cannot start for free');
  assert.equal(model.mode(), 'off');

  const battery = energyStore(2);
  const start = model.setMode('night', 2, battery);
  assert.equal(start.changed, true);
  assert.equal(model.info().level, 2);
  assert.equal(model.setMode('thermal', 2, battery).blocked, 'cooldown', 'rapid mode switching is gated');
  model.update(1, battery); // energy integration clamps one long frame to 0.1 s
  assert.ok(battery.value() > 1.9, 'a stalled frame cannot drain an unbounded amount');
  for (let i = 0; i < 4; i++) model.update(0.1, battery);
  assert.ok(model.info().cooldown <= 1e-9, 'cooldown decays under normal updates');
  assert.equal(model.setMode('thermal', 4, battery).changed, true, 'switch works after cooldown');
  assert.equal(model.info().drainPerSecond, 1.65, 'thermal level four has the intended higher running cost');

  let depleted = false;
  for (let i = 0; i < 40 && model.isOn(); i++) depleted = model.update(0.1, battery).depleted || depleted;
  assert.equal(depleted, true, 'partial payment shuts the device down');
  assert.equal(model.mode(), 'off');
  assert.ok(model.info().cooldown > 0, 'depletion adds a restart cooldown');
}

// Losing/changing equipment reconciles an active saved mode without energy use.
{
  const model = createVisionModel();
  model.restore({ mode: 'thermal', level: 4 });
  assert.equal(model.reconcileAvailability({ thermal: 2 }).reason, 'level-clamped');
  assert.equal(model.level(), 2);
  assert.equal(model.reconcileAvailability({ thermal: 0 }).reason, 'unequipped');
  assert.equal(model.mode(), 'off');
}

// --- 3. night rendering cannot bypass fog -----------------------------------
{
  const model = createVisionModel();
  model.restore({ mode: 'night', level: 4 });
  const ctx = mockContext();
  const refused = model.drawOverlay(ctx, VIEW, {});
  assert.equal(refused.drawn, false);
  assert.equal(refused.reason, 'visibility-contract', 'no fog/LOS contract means no effect');
  assert.equal(ctx.calls.filter(c => c[0] === 'fillRect').length, 0, 'failed contract paints no pixels');
  assert.equal(ctx.depth, 0, 'failed rendering restores canvas state');

  const brokenCtx = mockContext();
  brokenCtx.clip = () => { throw new Error('broken canvas'); };
  const hardened = model.drawOverlay(brokenCtx, VIEW, { isTileVisible: () => true });
  assert.equal(hardened.reason, 'visibility-error', 'a failed Canvas clip is contained');
  assert.equal(brokenCtx.depth, 0, 'Canvas failures cannot leak a saved context state');

  let checks = 0;
  const clipped = model.drawOverlay(ctx, VIEW, {
    isTileVisible(wx, wy) { checks++; return wx < 16 && wy < 26; },
  });
  assert.equal(clipped.drawn, true);
  assert.equal(clipped.clipped, true);
  assert.equal(checks, Math.ceil(VIEW.width / VIEW.tileSize) * Math.ceil(VIEW.height / VIEW.tileSize));
  assert.ok(ctx.calls.some(c => c[0] === 'clip'), 'night tint is clipped to current LOS tiles');
  const painted = ctx.calls.filter(c => c[0] === 'fillRect').length;
  assert.ok(painted <= 2 + VISION_LIMITS.maxScanlines + VISION_LIMITS.maxNoiseMarks,
    `phosphor work stays bounded (${painted} fill calls)`);
  assert.equal(ctx.depth, 0);
}

// A huge visibility mask fails closed instead of entering an unbounded tile loop.
{
  const model = createVisionModel();
  model.restore({ mode: 'night', level: 1 });
  const ctx = mockContext(16000, 16000);
  let checks = 0;
  const out = model.drawOverlay(ctx, { width: 16000, height: 16000, tileSize: 1 }, { isTileVisible: () => { checks++; return true; } });
  assert.equal(out.reason, 'visibility-budget');
  assert.equal(checks, 0, 'budget is checked before invoking visibility callbacks');
}

// --- 4. thermal targets: supplied + living + visible + in range -------------
{
  const model = createVisionModel();
  model.restore({ mode: 'thermal', level: 2 });
  // A fake world API would explode if the module attempted a global scan.
  MM.world = { getTile() { throw new Error('thermal module scanned the world'); } };
  const targets = [
    { id: 'visible', x: 20, y: 26, w: 1, h: 1.4, hp: 10, visible: true, heat: 0.9 },
    { id: 'hidden', x: 21, y: 26, hp: 10, visible: false },
    { id: 'dead', x: 19, y: 26, hp: 0, visible: true },
    { id: 'far', x: 50, y: 26, hp: 10, visible: true },
    { id: 'implicit', x: 18, y: 26, hp: 10 },
  ];
  const prepared = model.collectThermalTargets(targets, VIEW, { origin: { x: 20, y: 26 } });
  assert.deepEqual(prepared.map(row => row.target.id), ['visible'], 'hidden, dead, distant and unconfirmed targets are rejected');
  const ctx = mockContext();
  const draw = model.drawThermalTargets(ctx, targets, VIEW, { origin: { x: 20, y: 26 } });
  assert.equal(draw.drawn, 1);
  assert.ok(ctx.calls.some(c => c[0] === 'ellipse'), 'a visible living target receives a warm silhouette');
  assert.equal(ctx.depth, 0);
}

// Supplied callbacks can integrate entity-specific living/visibility rules,
// but work remains capped even for a maliciously large list.
{
  const model = createVisionModel();
  model.restore({ mode: 'thermal', level: 4 });
  const huge = Array.from({ length: 10000 }, (_, i) => ({ x: 12 + (i % 10), y: 22, hp: 1 }));
  let visibleChecks = 0;
  const prepared = model.collectThermalTargets(huge, VIEW, {
    origin: { x: 16, y: 22 },
    isVisible() { visibleChecks++; return true; },
    isLiving: () => true,
  });
  assert.ok(visibleChecks <= VISION_LIMITS.maxTargetInspect, 'target inspection has a hard frame budget');
  assert.ok(prepared.length <= VISION_LIMITS.maxThermalTargets[4], 'thermal silhouettes have a level-specific draw cap');
}

// Integrated draw supports the safe "effect before fog" render order.
{
  const model = createVisionModel();
  model.restore({ mode: VISION_MODES.THERMAL, level: 1 });
  const ctx = mockContext();
  const out = model.draw(ctx, VIEW, {
    fogWillRenderAfter: true,
    targetsAreVisible: true,
    origin: { x: 20, y: 26 },
    targets: [{ x: 20, y: 26, hp: 2 }],
  });
  assert.equal(out.overlay.drawn, true);
  assert.equal(out.targets.drawn, 1);
}

// Main integration keeps entity collection local/bounded and applies the same
// combat/meteor shake to thermal silhouettes as to the world and final fog.
{
  const { readFile } = await import('node:fs/promises');
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const mobsSrc = await readFile(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
  const invasionsSrc = await readFile(new URL('../src/engine/invasions.js', import.meta.url), 'utf8');
  const collectBlock = mainSrc.slice(mainSrc.indexOf('function collectThermalVisionTargets()'), mainSrc.indexOf('function drawSpecialVisionOverlay'));
  assert.match(collectBlock, /MOBS\.thermalTargets\(player\.x,player\.y,28,80\)/, 'thermal rendering uses the bounded spatial mob provider');
  assert.ok(!collectBlock.includes('MOBS.ghostRoster'), 'thermal rendering never serializes the full ghost roster');
  assert.match(collectBlock, /NPCS && NPCS\.nearby/, 'nearby NPCs participate in thermal vision');
  assert.match(collectBlock, /INVASIONS\.thermalTargets/, 'nearby invasion units participate in thermal vision');
  assert.match(collectBlock, /\[GUARDIANS,'guardian'.*UNDERGROUND,'underground'.*SKY_GUARDIAN,'sky'/s, 'guardian families participate in thermal vision');
  assert.match(mainSrc, /drawSpecialVisionOverlay\(camRenderX,camRenderY,screenShake\)/, 'thermal targets receive the exact active screen shake');
  assert.match(mainSrc, /toScreen:\(t,view\)=>\(\{[\s\S]*\+shakeX,[\s\S]*\+shakeY,/, 'world-to-screen thermal bounds include both shake axes');
  assert.match(mainSrc, /KEYBINDS\.keyFor\('vision'\)/, 'special-vision UI follows a rebound shortcut');
  assert.match(mobsSrc, /function thermalTargets\(wx,wy,range,limit\)/, 'mobs expose a dedicated local thermal provider');
  assert.match(mobsSrc, /if\(\+\+inspected>512\) break outer/, 'mob provider has a hard inspection cap');
  assert.match(invasionsSrc, /if\(\+\+inspected>256\) break outer/, 'invasion provider has a hard inspection cap');
}

console.log('vision-modes-sim: all assertions passed');
