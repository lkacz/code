import { T } from '../constants.js';

const FOOD_EFFECTS = Object.freeze({
  [T.MEAT]: Object.freeze({ key: 'meat', label: 'Surowe mieso', hp: 12 }),
  [T.ROTTEN_MEAT]: Object.freeze({ key: 'rottenMeat', label: 'Zepsute mieso', hp: -20 }),
  [T.BAKED_MEAT]: Object.freeze({ key: 'bakedMeat', label: 'Pieczone mieso', hp: 35 })
});

function effectForTile(tileId) {
  return FOOD_EFFECTS[tileId] || null;
}

function numericHp(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function applyFoodEffect(player, inv, tileId, opts = {}) {
  const effect = effectForTile(tileId);
  if (!effect) return { ok: false, reason: 'not_food' };
  if (!player) return { ok: false, reason: 'no_player', effect };

  const godMode = !!opts.godMode;
  const immunityMode = !!opts.immunityMode;
  const count = inv ? Number(inv[effect.key] || 0) : 0;
  if (!godMode && count <= 0) return { ok: false, reason: 'none', effect };

  const maxHp = Math.max(1, numericHp(player.maxHp, 100));
  const before = Math.max(0, Math.min(maxHp, numericHp(player.hp, maxHp)));
  if (effect.hp > 0 && before >= maxHp) {
    player.hp = maxHp;
    return { ok: false, reason: 'full', effect, before, after: maxHp, delta: 0 };
  }

  if (!godMode && inv) inv[effect.key] = Math.max(0, count - 1);
  if (effect.hp < 0 && immunityMode) {
    player.hp = maxHp;
    return { ok: true, effect, before: maxHp, after: maxHp, delta: 0, dead: false, immune: true };
  }
  const after = effect.hp > 0
    ? Math.min(maxHp, before + effect.hp)
    : Math.max(0, before + effect.hp);
  player.hp = after;
  return {
    ok: true,
    effect,
    before,
    after,
    delta: after - before,
    dead: after <= 0 && effect.hp < 0
  };
}

export const food = { FOOD_EFFECTS, effectForTile, applyFoodEffect };
export default food;

if (typeof window !== 'undefined') {
  window.MM = window.MM || {};
  window.MM.food = food;
}
