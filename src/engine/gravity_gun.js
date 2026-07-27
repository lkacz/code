// Gravity gun — the MATERIAL LAW. Pure and headless-importable: no DOM, no
// setTile, no MM reads at import time. This module answers exactly four
// questions about a world tile:
//   1. can the gun CARRY it?           canCarryTile(t) -> {ok} | {ok:false,reason}
//   2. how does it FLY?                gravMass / gravDamage / gravMult / muzzleSpeed
//   3. what does it DO on a creature?  GRAV_EFFECTS[t] (status + curated cause)
//   4. what happens where it LANDS?    landingMode(t,speed) + driftMaterialFor(t)
// weapons.js owns the weapon state machine and calls MM.gravityWorld (a main.js
// seam) for every world write — this file never touches the world.
//
// Damage identity warning (the reason GRAV_CAUSE is a CURATED table): mobs.js
// combatElementFromOpts classifies an attack by SUBSTRING of its cause/kind
// strings (fire|electric|water|ice|gas|explosion families). A cause built as
// 'gravity_'+tileName would silently turn METEORIC_IRON into an *explosion*
// element and WET_CLAY into a *water* attack. Every cause below is chosen so it
// matches an element ONLY when the material genuinely carries one.
import { T, INFO } from '../constants.js';
import { materialPhysicsRoute, isFragileFallingMaterial } from './material_physics.js';
import { heroLoadWeight } from './hero_crush.js';

// The gun lifts what a hero could conceivably pry loose: plain construction
// matter, foliage, loose items and granular soils. Everything else refuses with
// a reason the HUD can voice. Machines/furniture keep coordinate-keyed state in
// their own modules (a carried DYNAMO would orphan its registry entry), fluids
// belong to their sims, bedrock is the world's floor, and the alien hull is
// welded shut by design (explosives are the lore-correct way in).
const CARRY_ROUTES=new Set(['build-material','foliage','loose-item','granular']);
const REFUSE_REASON={
  'void':'void',
  'fluid':'fluid',
  'gas':'gas',
  'rigid-object':'rigid',
  'mounted-fixture':'fixture',
  'passable-utility':'utility',
  'natural-hazard':'hazard',
  'bedrock':'bedrock',
  'story':'story',
  'ufo-vault':'hull'
};
export function canCarryTile(t){
  const id=Number(t);
  if(!Number.isFinite(id) || id<0 || !INFO[id]) return {ok:false, reason:'bounds'};
  const route=materialPhysicsRoute(id);
  if(CARRY_ROUTES.has(route)) return {ok:true, route};
  return {ok:false, reason:REFUSE_REASON[route]||'tile'};
}

// --- Flight profile ----------------------------------------------------------
// mass rides heroLoadWeight (the same number the crush system trusts), clamped;
// foliage and loose items get fixed light masses because their load weights
// describe burial, not throwing. Damage grows with hardness×mass; muzzle speed
// falls with mass alone so GRAPHENE — brutally hard but feather-light — still
// flies flat, which is the physically honest reading.
const ARROW_GRAV_REF=14; // weapons.js ARROW_GRAV — used only for the R45 helper
export function gravMass(t){
  const route=materialPhysicsRoute(t);
  if(route==='foliage') return 0.2;
  if(route==='loose-item') return 0.5;
  const w=heroLoadWeight(t);
  return Number.isFinite(w) ? Math.max(0.15, Math.min(1.5, w)) : 1.5;
}
export function gravDamage(t){
  const info=INFO[t]||{};
  const route=materialPhysicsRoute(t);
  if(route==='foliage') return 1;
  if(t===T.GLASS) return 5; // shards cut (bleed), they do not bludgeon
  const hp=Number(info.hp)||0;
  return Math.max(1, Math.min(36, Math.round(2 + hp*1.7*gravMass(t))));
}
export function gravMult(t){ return Math.max(0.6, Math.min(1.8, 0.6 + gravMass(t)*0.8)); }
export function muzzleSpeed(t){ return Math.max(9, Math.min(19, 20 - gravMass(t)*6)); }
// Slower than the pickaxe's hp/6: the gravity gun must never out-mine a pick.
export function channelSeconds(t){ return Math.max(0.25, (Number((INFO[t]||{}).hp)||0)/4); }
// 45° range in tiles — a design-claim helper ("rock = short range") for tests.
export function rangeAt45(t){ const v=muzzleSpeed(t); return v*v/(ARROW_GRAV_REF*gravMult(t)); }

// --- On-hit effects ----------------------------------------------------------
// {status, dur, dps, radius, also, cause}. status names are the REAL mob
// vocabulary (mobs.js): bleed stun panic sunder blind chill wet poison burn.
// "Confusion" from leaves = blind (the creature loses its target — the aggro
// gate drops) + a short panic bolt. radius>0 -> statusRadius, else statusAt.
export const GRAV_EFFECTS={
  [T.LEAF]:            {status:'blind', dur:4,   radius:1.3, also:{status:'panic', dur:2.5}, cause:'grav_leaf'},
  [T.AUTUMN_LEAF_ORANGE]:{status:'blind', dur:4, radius:1.3, also:{status:'panic', dur:2.5}, cause:'grav_leaf'},
  [T.AUTUMN_LEAF_RED]: {status:'blind', dur:4,   radius:1.3, also:{status:'panic', dur:2.5}, cause:'grav_leaf'},
  [T.SNOW]:            {status:'chill', dur:3,   radius:1.5, cause:'grav_ice'},
  [T.TOXIC_SNOW]:      {status:'poison', dur:5, dps:2, radius:1.5, also:{status:'chill', dur:4}, cause:'grav_toxic'},
  [T.SAND]:            {status:'blind', dur:5,   radius:1.05, also:{status:'stun', dur:2.6}, cause:'grav_grit'},
  [T.GLASS]:           {status:'bleed', dur:4, dps:2, radius:1.2, cause:'grav_glass'},
  [T.ICE]:             {status:'chill', dur:3.5, radius:1.4, cause:'grav_ice'},
  [T.WET_CLAY]:        {status:'wet',  dur:5,   radius:1.2, cause:'grav_soak'},
  [T.MUD]:             {status:'wet',  dur:4,   radius:1.2, cause:'grav_soak'},
  [T.STONE]:           {status:'stun', dur:1.1, cause:'grav_blunt'},
  [T.STONE_DOOR]:      {status:'stun', dur:1.1, cause:'grav_blunt'},
  [T.CHIMNEY]:         {status:'stun', dur:1.2, cause:'grav_blunt'},
  [T.STEEL_TRAPDOOR]:  {status:'stun', dur:1.2, cause:'grav_blunt'},
  [T.BRICK]:           {status:'stun', dur:1.2, cause:'grav_blunt'},
  [T.STEEL_DOOR]:      {status:'sunder', dur:3, cause:'grav_wedge'},
  [T.FROZEN_SAND]:     {status:'chill', dur:3,  radius:1.3, cause:'grav_ice'},
  [T.DIAMOND]:         {status:'panic', dur:3,  cause:'grav_glare'}, // the melee diamond identity
  [T.SILVER_INGOT]:    {status:'sunder', dur:3, cause:'grav_wedge'},
  [T.TIN_ORE]:         {status:'stun', dur:1.3, cause:'grav_blunt'},
  [T.TRACK]:           {status:'sunder', dur:3, cause:'grav_wedge'},
  [T.GRANITE]:         {status:'stun', dur:1.3, cause:'grav_blunt'},
  [T.GOLD_ORE]:        {status:'stun', dur:1.3, cause:'grav_blunt'},
  [T.STEEL]:           {status:'sunder', dur:3, cause:'grav_wedge'},
  [T.FROZEN_CLAY]:     {status:'chill', dur:3,  radius:1.3, cause:'grav_ice'},
  [T.FROZEN_DIRT]:     {status:'chill', dur:3,  radius:1.3, cause:'grav_ice'},
  [T.SILVER_ORE]:      {status:'stun', dur:1.3, cause:'grav_blunt'},
  [T.RADIOACTIVE_ORE]: {status:'poison', dur:6, dps:3, radius:1.6, cause:'grav_toxic'},
  [T.ANTIMATTER_CRYSTAL]:{status:'sunder', dur:4, cause:'grav_wedge'},
  [T.METEORIC_IRON]:   {status:'stun', dur:1.5, cause:'grav_blunt'}, // NEVER 'meteor' — element trap
  [T.MOTHER_ICE]:      {status:'chill', dur:5,  radius:2.0, cause:'grav_ice'},
  [T.OBSIDIAN]:        {status:'bleed', dur:4, dps:3, cause:'grav_glass'}, // volcanic glass edge
  [T.MOTHER_LAVA]:     {status:'burn', dur:3, dps:3, radius:1.8, cause:'grav_lava_relic'},
  [T.IRIDIUM]:         {status:'sunder', dur:4, cause:'grav_wedge'},
  [T.BASALT]:          {status:'stun', dur:1.6, cause:'grav_blunt'}
};

// --- Landing -----------------------------------------------------------------
// drift: soft matter never mints a tile back — it joins the soft-drift layer.
// shatter: fragile matter, golden wood (the 10× payout), or any block arriving
//          FASTER than its own muzzle speed allows (a plunging drop, not a flat
//          throw) breaks into its normal mining drop.
// bounce: rubber wood keeps a small ricochet budget (the pistol's geometry).
// settle: everything else re-places itself as a falling solid where it stops.
// The threshold is anchored to the material's OWN muzzle speed: a flat throw
// arrives near v0 and survives; gravity-fed arcs exceed it and break. A fixed
// global threshold below the muzzle range made settling dead code (measured
// live: every thrown stone shattered).
export const SHATTER_SPEED=12; // absolute floor of the per-material threshold
export function shatterSpeedFor(t){ return Math.max(SHATTER_SPEED, muzzleSpeed(t)*1.08); }
export const RUBBER_BOUNCES=2;
const DRIFT_MAT={
  [T.SNOW]:'snow', [T.TOXIC_SNOW]:'snow',
  [T.LEAF]:'leaves', [T.AUTUMN_LEAF_ORANGE]:'leaves', [T.AUTUMN_LEAF_RED]:'leaves',
  [T.SAND]:'sand'
};
export function driftMaterialFor(t){ return DRIFT_MAT[t]||null; }
export function landingMode(t, impactSpeed){
  if(t===T.RUBBER_WOOD) return 'bounce';
  if(driftMaterialFor(t)) return 'drift';
  if(t===T.GOLDEN_WOOD) return 'shatter'; // the golden trunk always pays out
  if(isFragileFallingMaterial(t)) return 'shatter';
  if((Number(impactSpeed)||0)>=shatterSpeedFor(t)) return 'shatter';
  return 'settle';
}
// Shatter payout: the tile's normal mining yield (drop or drops[] rolls) so the
// gun conserves matter — extraction paid nothing, the break pays exactly once.
export function shatterPayout(t, rand){
  const info=INFO[t];
  if(!info) return [];
  const r=typeof rand==='function'?rand:Math.random;
  const out=[];
  if(Array.isArray(info.drops)){
    for(const d of info.drops){
      if(!d || !d.item) continue;
      if(typeof d.chance==='number' && r()>=d.chance) continue;
      const min=Number(d.min)||1, max=Number(d.max)||min;
      const n=min+Math.floor(r()*(max-min+1));
      if(n>0) out.push({key:d.item, n});
    }
    return out;
  }
  if(info.drop) out.push({key:info.drop, n:1});
  return out;
}

export const gravityGun={
  canCarryTile, gravMass, gravDamage, gravMult, muzzleSpeed, channelSeconds, rangeAt45,
  GRAV_EFFECTS, SHATTER_SPEED, RUBBER_BOUNCES, driftMaterialFor, landingMode, shatterPayout,
  _debug:{CARRY_ROUTES, REFUSE_REASON, DRIFT_MAT}
};
try{ if(typeof window!=='undefined'){ window.MM=window.MM||{}; window.MM.gravityGun=gravityGun; } }catch(e){ /* headless test host */ }
export default gravityGun;
