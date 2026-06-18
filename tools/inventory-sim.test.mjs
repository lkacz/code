// Inventory & loot item-system regression tests (Node, no DOM — window stubbed).
// Covers: the clean percent ladder (snapping at display AND generation), stat
// chips, the "Moc" power score ordering, legacy-loot normalization on ingest,
// weapon shortcut category cycling (strongest-first, opt-out, empty category)
// and shortcutOff hygiene on discard. Run: npm run test:inventory
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const { T, INFO } = await import('../src/constants.js');
await import('../src/inventory.js');
const INV = globalThis.MM.inventory;
const { chests } = await import('../src/engine/chests.js');

// --- resource registry: city salvage materials are tracked and placeable where intended ---
const res = key => INV.RESOURCES.find(r => r.key === key);
assert.equal(INFO[T.COAL].drop, 'coal', 'coal blocks drop coal');
assert.equal(res('coal')?.tile, 'COAL', 'coal is a placeable mined resource');
assert.equal(res('wire')?.tile, 'WIRE', 'wire is a placeable salvaged resource');
assert.equal(res('plastic')?.tile, null, 'plastic is tracked as a non-placeable component');
assert.equal(res('copper')?.tile, null, 'copper is tracked as a non-placeable component');
assert.equal(res('copperWire')?.tile, 'COPPER_WIRE', 'copper wire is a placeable power cable resource');
assert.equal(res('transistor')?.tile, null, 'transistor is tracked as a non-placeable component');
assert.equal(res('dynamo')?.tile, 'DYNAMO', 'dynamo is a craftable placeable machine resource');
assert.equal(res('teleporter')?.tile, 'TELEPORTER', 'teleporter is a placeable machine resource');
assert.equal(INFO[T.DYNAMO_SLOT].passable, true, 'dynamo slot is passable for the hero and machine flow');
assert.equal(INFO[T.COPPER_WIRE].drop, 'copperWire', 'copper wire drops itself when dismantled');
assert.equal(INFO[T.COPPER_WIRE].conductor, true, 'copper wire is marked as an energy conductor');
assert.equal(INFO[T.TELEPORTER].machine, 'teleporter', 'teleporter tile is marked as a machine');
assert.equal(INFO[T.TELEPORTER].powerDevice, true, 'teleporter is marked as a powered device');
assert.equal(INFO[T.DYNAMO].powerSource, true, 'dynamo casing is marked as a power source');

// --- percent ladder snapping ---------------------------------------------
assert.equal(INV.snapPct(1), 0, 'noise under 2.5% disappears');
assert.equal(INV.snapPct(3), 5);
assert.equal(INV.snapPct(7), 5);
assert.equal(INV.snapPct(13), 15);
assert.equal(INV.snapPct(22), 20);
assert.equal(INV.snapPct(-7), -5, 'maluses snap symmetrically');
assert.equal(INV.snapPct(62), 60, '10-steps between 50 and 100');
assert.equal(INV.snapPct(140), 150, '25-steps above 100');
assert.equal(INV.snapPct(500), 200, 'hard cap at 200%');

// --- stat chips: clean percent text, maluses marked ----------------------
const chipTexts = id => INV.statChips(INV.getItem(id)).map(c => c.text);
assert.deepEqual(chipTexts('ninja'), ['+20%', '+15%'], 'ninja outfit chips');
assert.deepEqual(chipTexts('sleepy'), ['-30%', '-5%', '-5%'], 'sleepy eyes chips (vision as percent of base 10)');
assert.ok(INV.statChips(INV.getItem('stone_blade')).some(c => !c.good), 'stone blade move malus flagged bad');
assert.ok(INV.statChips(INV.getItem('bow_wood')).some(c => c.text.endsWith('/s')), 'bow shows fire rate');
assert.equal((INV.weaponCategory(INV.getItem('electric_gun')) || {}).id, 'stream', 'electric gun maps to stream category');
assert.ok(INV.statChips(INV.getItem('electric_gun')).some(c => c.label === 'Wiązka' && c.text.endsWith('/s')), 'electric gun shows beam damage');
assert.ok(INV.statChips(INV.getItem('electric_gun')).some(c => c.label === 'Zużycie energii' && c.text.endsWith('/s')), 'electric gun shows energy drain');
assert.equal(INV.STAT_LABELS.energyCapacityBonus, 'Pojemność energii', 'energy capacity has a player-facing stat label');
assert.equal(INV.STAT_RULES.energyCapacityBonus, 'sum', 'energy capacity stacks additively');
assert.equal(INV.registerItem({id:'battery_charm_test', kind:'charm', name:'Akumulator testowy', energyCapacityBonus:50}), true, 'energy capacity loot is registerable');
assert.ok(INV.statChips(INV.getItem('battery_charm_test')).some(c => c.text === '+50E'), 'energy capacity appears as a stat chip');
INV.equip('battery_charm_test');
assert.equal(globalThis.MM.activeModifiers.energyCapacityBonus, 50, 'equipped capacity item contributes to modifiers');
INV.unequip('charm');

// --- power score: intuitive ordering within a kind ------------------------
const s = id => INV.itemScore(INV.getItem(id));
assert.ok(s('classic') < s('tattered'), 'capes: classic < tattered');
assert.ok(s('tattered') < s('triangle'), 'capes: tattered < triangle');
assert.ok(s('triangle') < s('shadow'), 'capes: triangle < shadow');
assert.ok(s('shadow') < s('royal'), 'capes: shadow < royal');
assert.ok(s('royal') <= s('winged'), 'capes: royal <= winged');
assert.ok(s('stick') < s('spear'), 'melee: stick < spear');
assert.ok(s('sleepy') < s('bright') && s('bright') < s('glow'), 'eyes ordered by quality');

// --- legacy dirty loot normalizes onto the ladder at ingest ---------------
globalThis.MM.dynamicLoot = { weapons: [
  { id: 'w_dirty', kind: 'weapon', weaponType: 'melee', name: 'Test', attackDamage: 4, moveSpeedMult: 1.0437, jumpPowerMult: 1.137, tier: 'rare' },
  { id: 'w_electric', kind: 'weapon', weaponType: 'electric', name: 'Beam', fireDps:10, fireRange:8, energyCost:11, tier:'rare' }
] };
window.updateDynamicCustomization();
const dirty = INV.getItem('w_dirty');
assert.equal(dirty.moveSpeedMult, 1.05, '1.0437 snaps to +5%');
assert.equal(dirty.jumpPowerMult, 1.15, '1.137 snaps to +15%');
assert.equal(INV.getItem('w_electric').energyCost, 11, 'electric loot keeps energyCost through sanitization');

// --- shortcut category cycling: strongest first, opt-out respected --------
// melee by score: w_dirty(36) > stone_blade(15) >= spear(15) > stick(6)
INV.unequip('weapon');
assert.equal(INV.cycleWeaponCategory('melee').id, 'w_dirty', 'first press = strongest enabled melee');
assert.equal(INV.cycleWeaponCategory('melee').id, 'stone_blade', 'second press = next strongest');
INV.setShortcut('stone_blade', false);
INV.unequip('weapon');
assert.equal(INV.cycleWeaponCategory('melee').id, 'w_dirty');
assert.equal(INV.cycleWeaponCategory('melee').id, 'spear', 'opted-out weapon is skipped');
INV.setShortcut('stone_blade', true);
assert.equal(INV.cycleWeaponCategory('bow').id, 'bow_wood', 'bow category reachable');
INV.setShortcut('bow_wood', false);
assert.equal(INV.cycleWeaponCategory('bow'), null, 'empty category yields null');
INV.setShortcut('bow_wood', true);
assert.equal((INV.weaponCategory(INV.getItem('flamethrower')) || {}).id, 'stream', 'flame maps to stream category');
assert.equal((INV.weaponCategory(INV.getItem('electric_gun')) || {}).id, 'stream', 'electric maps to stream category');
INV.unequip('weapon');
assert.equal(INV.cycleWeaponCategory('stream').id, 'electric_gun', 'stream shortcut reaches the strongest electric gun first');
INV.setShortcut('electric_gun', false);
INV.unequip('weapon');
assert.notEqual(INV.cycleWeaponCategory('stream')?.id, 'electric_gun', 'electric gun can be opted out of stream cycling');
INV.setShortcut('electric_gun', true);

// --- discard removes the item AND its shortcut opt-out entry --------------
INV.setShortcut('w_dirty', false);
assert.equal(INV.isShortcut('w_dirty'), false);
INV.discard('w_dirty');
assert.equal(INV.getItem('w_dirty'), null, 'discarded item gone');
assert.equal(INV.isShortcut('w_dirty'), true, 'opt-out entry cleaned up with the item');

// --- chest generation: every stat lands on the clean ladder ---------------
const RNG = seed => { let st = seed >>> 0; return () => { st = (st * 1664525 + 1013904223) >>> 0; return (st >>> 8) / 0xFFFFFF; }; };
const onLadder = m => { const p = (m - 1) * 100; return Math.abs(p - Math.round(p)) < 1e-6 && Math.round(p) % 5 === 0; };
const sums = { common: 0, rare: 0, epic: 0 }, counts = { common: 0, rare: 0, epic: 0 };
for (let i = 0; i < 2000; i++) {
  const tier = ['common', 'rare', 'epic'][i % 3];
  const item = chests.genItem(RNG(i * 7919 + 1), tier);
  for (const k of ['moveSpeedMult', 'jumpPowerMult', 'mineSpeedMult'])
    if (typeof item[k] === 'number') assert.ok(onLadder(item[k]), tier + ' ' + k + '=' + item[k] + ' off the 5% ladder');
  if (typeof item.fireRange === 'number') assert.equal(item.fireRange * 2, Math.round(item.fireRange * 2), 'fireRange in 0.5 steps');
  if (typeof item.energyCost === 'number') assert.equal(item.energyCost, Math.round(item.energyCost), 'energyCost integer');
  if (item.weaponType === 'electric') assert.ok(item.energyCost > 0, 'electric loot always has an energyCost');
  if (typeof item.visionRadius === 'number') assert.equal(item.visionRadius, Math.round(item.visionRadius), 'vision in whole tiles');
  if (typeof item.attackDamage === 'number') assert.equal(item.attackDamage, Math.round(item.attackDamage), 'damage integer');
  sums[tier] += INV.itemScore(item); counts[tier]++;
}
assert.ok(sums.epic / counts.epic > sums.rare / counts.rare, 'epic loot averages stronger than rare');
assert.ok(sums.rare / counts.rare > sums.common / counts.common, 'rare loot averages stronger than common');

// --- save snapshots carry the exact equipped look and shortcut state -------
INV.equip('ninja');
INV.setColor('outfit', '#123456');
INV.setShortcut('bow_wood', false);
const snap = INV.snapshot();
INV.equip('miner');
INV.setColor('outfit', '#abcdef');
INV.setShortcut('bow_wood', true);
assert.equal(INV.restore(snap, { persist: false, silent: true }), true, 'inventory snapshot restores');
assert.equal(INV.equippedId('outfit'), 'ninja', 'snapshot restores outfit');
assert.equal(INV.getColors().outfit, '#123456', 'snapshot restores outfit color');
assert.equal(INV.isShortcut('bow_wood'), false, 'snapshot restores shortcut exclusions');

console.log('inventory-sim: all assertions passed (avg Moc common/rare/epic: '
  + [(sums.common / counts.common).toFixed(1), (sums.rare / counts.rare).toFixed(1), (sums.epic / counts.epic).toFixed(1)].join('/') + ')');
