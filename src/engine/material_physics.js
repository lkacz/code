import { T, INFO } from '../constants.js';

export const BUILD_MATERIAL_PROFILES = Object.freeze({
  [T.IRIDIUM]: Object.freeze({strength:28, support:20, weight:1.22, compression:0.16, lateral:0.86, flex:1.24, down:0.24, warn:0.38, fail:0.985, wind:0.008, rubbleRoll:4}),
  [T.UFO_CONCRETE]: Object.freeze({strength:27, support:19, weight:1.32, compression:0.22, lateral:1.05, flex:0.95, down:0.24, warn:0.30, fail:0.965, wind:0.009, rubbleRoll:5}),
  [T.MOTHER_ICE]: Object.freeze({strength:25, support:17, weight:1.10, compression:0.22, lateral:1.18, flex:0.82, down:0.25, warn:0.24, fail:0.900, wind:0.012, rubbleRoll:3}),
  [T.MOTHER_LAVA]: Object.freeze({strength:25, support:17, weight:1.18, compression:0.28, lateral:1.08, flex:0.90, down:0.26, warn:0.22, fail:0.905, wind:0.010, rubbleRoll:3}),
  [T.METEORIC_IRON]: Object.freeze({strength:26, support:17, weight:1.45, compression:0.17, lateral:0.93, flex:1.18, down:0.27, warn:0.36, fail:0.975, wind:0.007, rubbleRoll:4}),
  [T.STEEL]: Object.freeze({strength:24, support:18, weight:1.35, compression:0.18, lateral:1.02, flex:1.18, down:0.27, warn:0.34, fail:0.970, wind:0.006, rubbleRoll:5}),
  [T.TRACK]: Object.freeze({strength:22, support:16, weight:1.42, compression:0.20, lateral:0.98, flex:1.12, down:0.27, warn:0.34, fail:0.960, wind:0.008, rubbleRoll:5}),
  [T.STEEL_DOOR]: Object.freeze({strength:16.8, support:12.8, weight:1.04, compression:0.26, lateral:0.92, flex:1.08, down:0.24, warn:0.34, fail:0.940, wind:0.022, rubbleRoll:4}),
  [T.STEEL_TRAPDOOR]: Object.freeze({strength:15.6, support:11.9, weight:0.98, compression:0.28, lateral:0.88, flex:1.06, down:0.23, warn:0.35, fail:0.935, wind:0.026, rubbleRoll:4}),
  [T.ANTIMATTER_CRYSTAL]: Object.freeze({strength:22, weight:1.05, compression:0.24, lateral:1.18, flex:0.72, down:0.28, warn:0.20, fail:0.860, wind:0.010, rubbleRoll:3}),
  [T.OBSIDIAN]: Object.freeze({strength:19, support:13, weight:1.30, compression:0.43, lateral:1.08, flex:0.92, down:0.26, warn:0.24, fail:0.930, wind:0.010, rubbleRoll:3}),
  [T.DIAMOND]: Object.freeze({strength:21, weight:1.08, compression:0.30, lateral:1.20, flex:0.78, down:0.25, warn:0.22, fail:0.870, wind:0.090, rubbleRoll:3}),
  [T.GOLD_ORE]: Object.freeze({strength:12.4, weight:1.32, compression:0.42, lateral:1.10, flex:0.78, down:0.24, warn:0.23, fail:0.860, wind:0.018, rubbleRoll:3}),
  [T.BASALT]: Object.freeze({strength:17, support:12.5, weight:1.24, compression:0.40, lateral:1.06, flex:0.95, down:0.25, warn:0.25, fail:0.925, wind:0.009, rubbleRoll:4}),
  [T.GRANITE]: Object.freeze({strength:15, support:12, weight:1.18, compression:0.38, lateral:1.06, flex:0.96, down:0.24, warn:0.26, fail:0.920, wind:0.011, rubbleRoll:4}),
  [T.RADIOACTIVE_ORE]: Object.freeze({strength:15.5, weight:1.48, compression:0.44, lateral:1.16, flex:0.80, down:0.30, warn:0.22, fail:0.880, wind:0.012, rubbleRoll:3}),
  [T.STONE]: Object.freeze({strength:11, support:11, weight:1.05, compression:0.37, lateral:1.05, flex:1.00, down:0.21, warn:0.28, fail:0.930, wind:0.014, rubbleWind:0.022, rubbleRoll:4}),
  [T.STONE_DOOR]: Object.freeze({strength:8.9, support:7.4, weight:0.92, compression:0.43, lateral:1.14, flex:0.86, down:0.25, warn:0.25, fail:0.890, wind:0.030, rubbleRoll:3}),
  [T.STONE_TRAPDOOR]: Object.freeze({strength:8.0, support:6.7, weight:0.86, compression:0.46, lateral:1.18, flex:0.82, down:0.25, warn:0.24, fail:0.875, wind:0.034, rubbleRoll:3}),
  [T.WOOD]: Object.freeze({strength:6.2, weight:0.72, compression:0.26, lateral:0.90, flex:1.12, down:0.17, warn:0.42, fail:0.925, wind:0.060, rubbleRoll:4}),
  [T.WOOD_DOOR]: Object.freeze({strength:5.2, support:4.6, weight:0.52, compression:0.24, lateral:0.84, flex:1.22, down:0.15, warn:0.46, fail:0.900, wind:0.082, rubbleRoll:4}),
  [T.WOOD_TRAPDOOR]: Object.freeze({strength:4.8, support:4.2, weight:0.48, compression:0.24, lateral:0.80, flex:1.18, down:0.15, warn:0.47, fail:0.890, wind:0.090, rubbleRoll:4}),
  [T.COAL]: Object.freeze({strength:6.8, weight:0.86, compression:0.48, lateral:1.20, flex:0.76, down:0.22, warn:0.20, fail:0.830, wind:0.045, rubbleRoll:3}),
  [T.ALIEN_BIOMASS]: Object.freeze({strength:5.1, weight:0.62, compression:0.30, lateral:1.06, flex:1.20, down:0.16, warn:0.36, fail:0.900, wind:0.085, rubbleRoll:4}),
  [T.GLASS]: Object.freeze({strength:3.4, weight:0.88, compression:0.70, lateral:1.45, flex:0.55, down:0.28, warn:0.18, fail:0.720, wind:0.160, rubbleRoll:2}),
  [T.ELECTRONICS]: Object.freeze({strength:3.2, weight:0.72, compression:0.64, lateral:1.50, flex:0.55, down:0.24, warn:0.18, fail:0.760, wind:0.090, rubbleRoll:2}),
  [T.ICE]: Object.freeze({strength:6.4, weight:0.82, compression:0.48, lateral:1.18, flex:0.78, down:0.24, warn:0.22, fail:0.860, wind:0.045, rubbleRoll:3}),
  [T.SNOW]: Object.freeze({strength:4.8, weight:0.72, compression:0.54, lateral:1.22, flex:0.78, down:0.22, warn:0.22, fail:0.830, wind:0.075, rubbleRoll:3}),
  // Gas-tainted snowpack packs slightly denser (chemical crust) but behaves like snow.
  [T.TOXIC_SNOW]: Object.freeze({strength:4.9, weight:0.74, compression:0.54, lateral:1.22, flex:0.78, down:0.22, warn:0.22, fail:0.830, wind:0.070, rubbleRoll:3}),
  [T.DIRT]: Object.freeze({strength:6.5, weight:1.00, compression:0.42, lateral:1.15, flex:0.86, down:0.22, warn:0.25, fail:0.880, wind:0.065, rubbleRoll:3}),
  [T.GRASS]: Object.freeze({strength:6.5, weight:1.00, compression:0.42, lateral:1.15, flex:0.86, down:0.22, warn:0.25, fail:0.880, wind:0.065, rubbleRoll:3}),
  [T.GRASS_SNOW]: Object.freeze({strength:6.5, weight:1.00, compression:0.42, lateral:1.15, flex:0.86, down:0.22, warn:0.25, fail:0.880, wind:0.065, rubbleRoll:3}),
  // Permafrost binds soil grains with ice: markedly stiffer than the thawed base,
  // slightly heavier, and it sheds wind erosion like rock instead of loose earth.
  [T.FROZEN_DIRT]: Object.freeze({strength:11.5, support:9, weight:1.08, compression:0.36, lateral:1.10, flex:0.90, down:0.23, warn:0.25, fail:0.905, wind:0.014, rubbleRoll:3}),
  [T.FROZEN_SAND]: Object.freeze({strength:10.2, support:8, weight:1.02, compression:0.38, lateral:1.12, flex:0.88, down:0.23, warn:0.25, fail:0.900, wind:0.016, rubbleRoll:3}),
  [T.FROZEN_CLAY]: Object.freeze({strength:11.0, support:8.6, weight:1.12, compression:0.37, lateral:1.10, flex:0.86, down:0.23, warn:0.24, fail:0.900, wind:0.014, rubbleRoll:3}),
  [T.MUD]: Object.freeze({strength:6.5, weight:1.00, compression:0.42, lateral:1.15, flex:0.86, down:0.22, warn:0.25, fail:0.880, wind:0.045, rubbleRoll:3}),
  [T.CLAY]: Object.freeze({strength:7.2, weight:1.06, compression:0.48, lateral:1.18, flex:0.80, down:0.23, warn:0.24, fail:0.875, wind:0.040, rubbleRoll:3}),
  [T.WET_CLAY]: Object.freeze({strength:5.8, weight:1.12, compression:0.58, lateral:1.26, flex:0.74, down:0.25, warn:0.22, fail:0.835, wind:0.020, rubbleRoll:2}),
  [T.BRICK]: Object.freeze({strength:12.6, support:10.2, weight:1.08, compression:0.36, lateral:1.00, flex:0.92, down:0.22, warn:0.27, fail:0.910, wind:0.018, rubbleRoll:4}),
  [T.CHIMNEY]: Object.freeze({strength:10.9, support:8.8, weight:0.96, compression:0.34, lateral:0.98, flex:0.94, down:0.21, warn:0.29, fail:0.900, wind:0.021, rubbleRoll:4})
});

export function buildMaterialProfile(t){
  return BUILD_MATERIAL_PROFILES[t] || null;
}

export function isPassableForFalling(t){
  return t===T.AIR || t===T.WATER || (t!==T.DYNAMO_SLOT && t!==T.TELEPORTER && !!(INFO[t] && INFO[t].passable));
}

export function isGasTile(t){
  return !!(INFO[t] && INFO[t].gas);
}

export function isFoliageTile(t){
  return t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED;
}

// Pilot chairs are ordinary furniture: passable fixtures placeable anywhere.
// Inside a healing shelter they add comfort (house_healing.js); crowning a
// tracked machine they become the control seat (mechs.js).
export function isChairTile(t){
  return !!(INFO[t] && INFO[t].chair);
}

export function isAirOrGasTile(t){
  return t===T.AIR || isGasTile(t);
}

export function isWaterOpenTile(t){
  return isAirOrGasTile(t);
}

export function isWaterFillTile(t){
  return isWaterOpenTile(t) || isFoliageTile(t);
}

export function isSkyOpenTile(t){
  return t===T.AIR || isFoliageTile(t) || isGasTile(t);
}

export function isPlantSpaceTile(t){
  return t===T.AIR || t===T.WATER || isGasTile(t);
}

export function isCreatureOpenTile(t){
  return t===T.AIR || t===T.WATER || isFoliageTile(t) || isGasTile(t);
}

export function isCondensedWaterTargetTile(t){
  return t===T.AIR || t===T.WATER || isGasTile(t);
}

export function canGasReplaceTile(gasTile,targetTile){
  return isGasTile(gasTile) && targetTile===T.AIR;
}

export function canGasSwapTile(gasTile,targetTile){
  return gasTile===T.HOT_AIR && isGasTile(targetTile) && targetTile!==T.HOT_AIR;
}

export function isWindPorousTile(t){
  if(isNaturalHazardMaterial(t)) return false;
  if(t===T.AIR) return true;
  const info=INFO[t];
  return !!(info && (info.passable || info.gas));
}

export function isSmokePorousTile(t){
  // Smoke shares thin-fixture/gas porosity with wind, but it cannot occupy a
  // liquid cell. Closed doors and trapdoors remain structural barriers.
  return t!==T.WATER && t!==T.LAVA && isWindPorousTile(t);
}

export function isPlayerPassableTile(t){
  return t===T.AIR || t===T.WATER || t===T.LAVA || !!(INFO[t] && INFO[t].passable);
}

export function isDoorTile(t){
  return !!(INFO[t] && INFO[t].door);
}

export function isTrapdoorTile(t){
  return !!(INFO[t] && INFO[t].trapdoor);
}

export function isHeroPassableTile(t){
  return isPlayerPassableTile(t) || isDoorTile(t);
}

export function isNpcPassableTile(t){
  return isHeroPassableTile(t);
}

export function isSolidCollisionTile(t){
  return !isPlayerPassableTile(t);
}

export function isSunTransparentTile(t){
  if(isNaturalHazardMaterial(t)) return false;
  if(t===T.AIR || t===T.GLASS || t===T.WIRE || t===T.COPPER_WIRE || t===T.TORCH || isFoliageTile(t)) return true;
  const info=INFO[t];
  return !!(info && (info.gas || info.passable));
}

export function isLavaVentOpenTile(t){
  return t===T.AIR || t===T.TORCH || t===T.GRAVE || isGasTile(t);
}

export function isHeatRayPassableTile(t){
  if(t===T.AIR) return true;
  if(t===T.WATER || t===T.LAVA) return false;
  if(isNaturalHazardMaterial(t)) return false;
  return !!(INFO[t] && INFO[t].passable);
}

export function isVisualOpenFluidTile(t){
  return t===T.AIR || t===T.WATER || t===T.LAVA || isGasTile(t);
}

export function isReplaceableNaturalOpenTile(t,allowLava=false){
  return t===T.AIR || t===T.WATER || (allowLava && t===T.LAVA) || isGasTile(t);
}

export function isGeneratedStructureReplaceableTile(t){
  return isReplaceableNaturalOpenTile(t,false) ||
    t===T.UNSTABLE_SAND || t===T.UNSTABLE_GRASS || t===T.QUICKSAND ||
    t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED ||
    t===T.TORCH || t===T.GRAVE;
}

export function isLavaExposureOpenTile(t){
  return isReplaceableNaturalOpenTile(t,false) || t===T.TORCH || t===T.GRAVE;
}

export function isMeteorImpactGroundTile(t){
  return t===T.GRASS || t===T.SAND || t===T.UNSTABLE_GRASS ||
    t===T.UNSTABLE_SAND || t===T.QUICKSAND || t===T.DIRT || t===T.STONE ||
    t===T.GRANITE || t===T.BASALT || t===T.BEDROCK || t===T.SNOW || t===T.TOXIC_SNOW ||
    t===T.GRASS_SNOW || t===T.FROZEN_DIRT || t===T.FROZEN_SAND || t===T.FROZEN_CLAY ||
    t===T.ICE || t===T.MUD || t===T.CLAY || t===T.WET_CLAY ||
    t===T.BRICK || t===T.OBSIDIAN || t===T.COAL ||
    t===T.GOLD_ORE || t===T.UFO_CONCRETE || t===T.MOTHER_ICE || t===T.MOTHER_LAVA ||
    t===T.DIAMOND || t===T.IRIDIUM || t===T.METEORIC_IRON ||
    t===T.RADIOACTIVE_ORE || t===T.ALIEN_BIOMASS ||
    t===T.ANTIMATTER_CRYSTAL || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE;
}

export function isMeteorPickDenseRockMaterial(t){
  return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK;
}

export function isMeteorPickSparkMaterial(t){
  return isMeteorPickDenseRockMaterial(t) || t===T.COAL || t===T.GOLD_ORE || t===T.OBSIDIAN ||
    t===T.METEORIC_IRON || t===T.RADIOACTIVE_ORE || t===T.ANTIMATTER_CRYSTAL;
}

export function isBlastProtectedTile(t){
  if(t===T.UFO_CONCRETE) return false;
  const info=INFO[t] || INFO[T.AIR];
  return t===T.AIR || t===T.OBSIDIAN || t===T.DIAMOND || t===T.IRIDIUM ||
    t===T.BEDROCK || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE ||
    !!(info && (info.chestTier || info.cache || info.story || info.unmineable));
}

export function isMeteorProtectedTile(t){
  if(t===T.UFO_CONCRETE) return false;
  const info=INFO[t] || INFO[T.AIR];
  return t===T.ANTIGRAVITY_BEACON || t===T.METEOR_SIREN ||
    t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE ||
    !!(info && (info.chestTier || info.cache || info.story || info.unmineable));
}

export function isMeteorWaterSiteTile(t){
  return t===T.WATER || t===T.ICE;
}

export function isMeteorForestSiteTile(t){
  return t===T.WOOD || isFoliageTile(t);
}

export function isMeteorLifeSiteTile(t){
  return t===T.GRASS || t===T.GRASS_SNOW || t===T.UNSTABLE_GRASS || t===T.MUD || t===T.ALIEN_BIOMASS;
}

export function isMeteorSettlementSiteTile(t){
  const info=INFO[t] || INFO[T.AIR];
  return !!(info && (info.machine || info.chestTier || info.cache || info.door || info.trapdoor)) ||
    t===T.STEEL || t===T.CHIMNEY || t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || t===T.LADDER || t===T.BEDROCK_LADDER;
}

export function isCreatureRockFloorTile(t){
  return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK || t===T.COAL || t===T.GOLD_ORE;
}

export function isIridiumArrowPierceableTile(t){
  const info=INFO[t] || INFO[T.AIR];
  if(t===T.AIR || t===T.WATER || t===T.LAVA) return false;
  if(t===T.UFO_CONCRETE) return true;
  if(info.machine || info.chestTier || info.cache || info.story || info.unmineable) return false;
  if(t===T.OBSIDIAN || t===T.DIAMOND || t===T.IRIDIUM || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE) return false;
  return t!==T.AIR && !(info && info.passable);
}

export function isUfoVaultMaterial(t){
  return t===T.UFO_CONCRETE;
}

export function isStructuralMaterial(t){
  return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK ||
    t===T.STONE_DOOR || t===T.STONE_TRAPDOOR || t===T.STEEL || t===T.STEEL_DOOR || t===T.STEEL_TRAPDOOR ||
    t===T.METEORIC_IRON || t===T.IRIDIUM || t===T.OBSIDIAN || t===T.BRICK || t===T.CHIMNEY;
}

export function isMetalStructuralMaterial(t){
  return t===T.STEEL || t===T.STEEL_DOOR || t===T.STEEL_TRAPDOOR || t===T.METEORIC_IRON || t===T.IRIDIUM;
}

export function isRockStructuralMaterial(t){
  return t===T.STONE || t===T.STONE_DOOR || t===T.STONE_TRAPDOOR || t===T.GRANITE || t===T.BASALT || t===T.OBSIDIAN || t===T.BRICK || t===T.CHIMNEY || t===T.BEDROCK;
}

export function isLightStructuralMaterial(t){
  return t===T.WOOD || t===T.WOOD_DOOR || t===T.WOOD_TRAPDOOR || t===T.ALIEN_BIOMASS;
}

export function isWeakFillMaterial(t){
  return t===T.DIRT || t===T.GRASS || t===T.GRASS_SNOW || t===T.UNSTABLE_GRASS ||
    t===T.UNSTABLE_SAND || t===T.QUICKSAND || t===T.MUD || t===T.CLAY ||
    t===T.WET_CLAY || t===T.SNOW || t===T.TOXIC_SNOW;
}

export function isNonStructuralResourceMaterial(t){
  return t===T.COAL || t===T.GOLD_ORE || t===T.RADIOACTIVE_ORE || t===T.ELECTRONICS || t===T.METEOR_DUST;
}

export function isLimitedBrittleStructuralMaterial(t){
  return t===T.GLASS || t===T.ICE || t===T.DIAMOND || t===T.OBSIDIAN || t===T.ANTIMATTER_CRYSTAL;
}

export function isUtilityMaterial(t){
  const info=INFO[t];
  if(t===T.TORCH || t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || t===T.LADDER || t===T.BEDROCK_LADDER || t===T.GRAVE) return true;
  if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE) return true;
  if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) return true;
  return !!(info && (info.machine || info.chestTier || info.cache || info.gas || isLooseItemMaterial(t)));
}

export function isHardStructuralMaterial(t){
  return isMetalStructuralMaterial(t) || isRockStructuralMaterial(t);
}

export function isBuildLoadTransferMaterial(t){
  if(isPassableForFalling(t) || isUtilityMaterial(t) || isWeakFillMaterial(t) || isNonStructuralResourceMaterial(t)) return false;
  if(isFragileFallingMaterial(t) || isLooseRigidMaterial(t)) return false;
  const p = buildMaterialProfile(t);
  return isUfoVaultMaterial(t) || isHardStructuralMaterial(t) || isLightStructuralMaterial(t) ||
    t===T.ICE || t===T.ANTIMATTER_CRYSTAL || !!(p && Number.isFinite(p.support));
}

export function isNaturalFloatingAnchorTile(t){
  return t===T.ANTIGRAVITY_BEACON || t===T.ANTIMATTER_CRYSTAL || t===T.IRIDIUM;
}

export function isNaturalFloatingCohesionTile(t){
  return isNaturalFloatingAnchorTile(t) ||
    t===T.GLASS || t===T.METEOR_DUST || t===T.BASALT || t===T.GRANITE;
}

export function isFragileFallingMaterial(t){
  return t===T.GLASS;
}

export function isLooseRigidMaterial(t){
  return t===T.DIAMOND || t===T.ELECTRONICS || t===T.COAL || t===T.RADIOACTIVE_ORE || t===T.BAKED_MEAT;
}

export function isLooseItemMaterial(t){
  const info=INFO[t];
  return !!(info && info.looseItem);
}

export function isMeatDecayMaterial(t){
  return t===T.MEAT || t===T.ROTTEN_MEAT;
}

export function looseItemPhysicsMode(t){
  if(!isLooseItemMaterial(t)) return null;
  if(isMeatDecayMaterial(t)) return 'meat-decay';
  if(isLooseRigidMaterial(t)) return 'loose-rigid';
  return 'unhandled';
}

export function isRigidObjectTile(t){
  const info=INFO[t];
  if(!info) return false;
  if(info.chestTier) return true;
  if(info.cache) return true;
  if(t===T.TELEPORTER) return true;
  return !!(info.machine && t!==T.DYNAMO_SLOT && t!==T.COPPER_WIRE && t!==T.WATER_PIPE);
}

export function isMountedFixtureTile(t){
  return t===T.TORCH;
}

export function isNaturalHazardMaterial(t){
  return t===T.UNSTABLE_SAND || t===T.UNSTABLE_GRASS || t===T.QUICKSAND;
}

export function isPlayerBuiltMaterial(t){
  const info=INFO[t];
  if(!buildMaterialProfile(t)) return false;
  if(isUfoVaultMaterial(t)) return false;
  if(!info || !info.color || info.passable || info.chestTier || info.cache || info.gas || info.machine || isLooseItemMaterial(t)) return false;
  if(t===T.AIR || t===T.WATER || t===T.LAVA || t===T.SAND ||
    t===T.UNSTABLE_SAND || t===T.UNSTABLE_GRASS || t===T.QUICKSAND ||
    t===T.BEDROCK) return false;
  if(t===T.TORCH || t===T.WIRE || t===T.COPPER_WIRE || t===T.LADDER || t===T.BEDROCK_LADDER || t===T.GRAVE) return false;
  if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) return false;
  return true;
}

export function isPlayerBuiltPhysicsMaterial(t){
  return isPlayerBuiltMaterial(t);
}

export function isPlayerBuiltStructuralMaterial(t){
  return isPlayerBuiltMaterial(t) && !isWeakFillMaterial(t) && !isNonStructuralResourceMaterial(t);
}

export function materialPhysicsRoute(t){
  const info=INFO[t];
  if(!info) return null;
  if(t===T.AIR) return 'void';
  if(t===T.WATER || t===T.LAVA) return 'fluid';
  if(isGasTile(t)) return 'gas';
  if(isFoliageTile(t)) return 'foliage';
  if(isRigidObjectTile(t)) return 'rigid-object';
  if(isMountedFixtureTile(t)) return 'mounted-fixture';
  if(isLooseItemMaterial(t)) return 'loose-item';
  if(isNaturalHazardMaterial(t)) return 'natural-hazard';
  if(t===T.SAND || t===T.UNSTABLE_SAND) return 'granular';
  if(t===T.BEDROCK) return 'bedrock';
  if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || info.story) return 'story';
  if(isUfoVaultMaterial(t)) return 'ufo-vault';
  if(isPlayerBuiltMaterial(t)) return 'build-material';
  if(t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || t===T.GRAVE || t===T.METEOR_DUST || info.passable) return 'passable-utility';
  if(info.machine) return 'rigid-object';
  return null;
}

export function materialPhysicsCoverage(){
  return Object.freeze(Object.entries(T).map(([name,id])=>Object.freeze({
    name,
    id,
    route: materialPhysicsRoute(id)
  })));
}

export function isRubbleTrackedMaterial(t){
  return t!==T.BEDROCK && !isUfoVaultMaterial(t) && (isStructuralMaterial(t) || isPlayerBuiltMaterial(t));
}

export function isLegacyPhysicsAuditMaterial(t){
  return isFragileFallingMaterial(t) || t===T.WIRE || t===T.ELECTRONICS || isMetalStructuralMaterial(t);
}

export function isObjectFootingTile(t){
  return t===T.SAND || isBuildFoundationTile(t);
}

export function isObjectBraceTile(t){
  return isBuildFoundationTile(t);
}

export function isObjectCrushableSupportTile(t){
  if(isObjectFootingTile(t) || isPassableForFalling(t)) return false;
  return isFragileFallingMaterial(t) || isLooseRigidMaterial(t) || isNonStructuralResourceMaterial(t);
}

export function isLoadBearingSupportTile(t){
  const info=INFO[t];
  if(isPassableForFalling(t) || isStructuralMaterial(t) || isFragileFallingMaterial(t) || isLooseRigidMaterial(t)) return false;
  if(isWeakFillMaterial(t) || isNonStructuralResourceMaterial(t)) return false;
  if(isUfoVaultMaterial(t)) return true;
  if(t===T.DYNAMO_SLOT) return false;
  if(info && info.chestTier) return false;
  if(t===T.INVASION_CACHE) return false;
  if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) return false;
  if(info && (info.machine || info.cache || isLooseItemMaterial(t) || info.gas)) return false;
  return isLightStructuralMaterial(t) || t===T.ICE || t===T.ANTIMATTER_CRYSTAL;
}

export function isBuildFoundationTile(t){
  if(t===T.BEDROCK) return true;
  if(isNaturalHazardMaterial(t)) return false;
  if(isPassableForFalling(t) || isUtilityMaterial(t) || isNonStructuralResourceMaterial(t)) return false;
  if(isFragileFallingMaterial(t) || isLooseRigidMaterial(t)) return false;
  const p = buildMaterialProfile(t);
  return isUfoVaultMaterial(t) || isHardStructuralMaterial(t) || isLightStructuralMaterial(t) ||
    isWeakFillMaterial(t) || t===T.ICE || t===T.ANTIMATTER_CRYSTAL || !!(p && Number.isFinite(p.support));
}

export function isBuildAnchorTile(t){
  return isBuildLoadTransferMaterial(t);
}

export function isStableMachineSupportTile(t){
  return isBuildFoundationTile(t) && t!==T.LEAF && t!==T.AUTUMN_LEAF_ORANGE && t!==T.AUTUMN_LEAF_RED;
}

export function isSafeLandingFloorTile(t){
  if(isDoorTile(t)) return false;
  if(t===T.WOOD || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE) return false;
  return isObjectFootingTile(t);
}

export function isBuiltPillarMaterial(t){
  const info=INFO[t];
  if(!info || !info.color || info.chestTier || info.cache) return false;
  if(info.passable || info.machine || isLooseItemMaterial(t) || info.gas) return false;
  if(isUfoVaultMaterial(t)) return false;
  if(t===T.AIR || t===T.WATER || t===T.LAVA || t===T.TORCH || t===T.WIRE || t===T.GRAVE || t===T.INVASION_CACHE || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE) return false;
  if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT || t===T.ELECTRONICS) return false;
  return true;
}

export function generatedCityStructuralTile(t){
  return isStructuralMaterial(t);
}

export function generatedCitySupportTile(t){
  return isStructuralMaterial(t) || isBuildAnchorTile(t) || (isWeakFillMaterial(t) && !isNaturalHazardMaterial(t));
}

export function fallingWindResponseForMaterial(t,rubble){
  if(t===T.SAND) return 0.22;
  const p=buildMaterialProfile(t);
  if(p){
    if(rubble && Number.isFinite(p.rubbleWind)) return p.rubbleWind;
    return Number.isFinite(p.wind) ? p.wind : 0.035;
  }
  if(t===T.BEDROCK) return 0.009;
  return 0.035;
}

export function isWindExposureBlockerTile(t){
  if(t===T.AIR || t===T.WATER || t===T.LAVA) return false;
  const info=INFO[t];
  if(info && (info.gas || info.passable)) return false;
  if(isMountedFixtureTile(t) || t===T.GRAVE) return false;
  return !!(info && info.color);
}

export function structuralSupportStrengthForMaterial(t){
  if(t===T.BEDROCK) return 100;
  if(!isStructuralMaterial(t)) return 0;
  const p=buildMaterialProfile(t);
  if(p && Number.isFinite(p.support)) return p.support;
  return p && Number.isFinite(p.strength) ? p.strength : 0;
}

export function structuralRubbleRollLimit(t){
  const p=buildMaterialProfile(t);
  if(p && Number.isFinite(p.rubbleRoll)) return p.rubbleRoll;
  return 4;
}
