// Material physics audit guard. This keeps the resource registry, placement
// support predicates, generated-city audit predicates and build profiles from
// drifting apart as new tiles are added.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, INFO } = await import('../src/constants.js');
const {
  BUILD_MATERIAL_PROFILES,
  buildMaterialProfile,
  fallingWindResponseForMaterial,
  generatedCitySupportTile,
  generatedCityStructuralTile,
  canGasReplaceTile,
  canGasSwapTile,
  isBlastProtectedTile,
  isBuildAnchorTile,
  isBuildFoundationTile,
  isBuildLoadTransferMaterial,
  isCondensedWaterTargetTile,
  isCreatureRockFloorTile,
  isFoliageTile,
  isGeneratedStructureReplaceableTile,
  isGasTile,
  isAirOrGasTile,
  isHeatRayPassableTile,
  isIridiumArrowPierceableTile,
  isLavaExposureOpenTile,
  isLavaVentOpenTile,
  isLegacyPhysicsAuditMaterial,
  isMeteorImpactGroundTile,
  isMeteorPickDenseRockMaterial,
  isMeteorPickSparkMaterial,
  isMeteorForestSiteTile,
  isMeteorProtectedTile,
  isMeteorLifeSiteTile,
  isMeteorSettlementSiteTile,
  isMeteorWaterSiteTile,
  isMountedFixtureTile,
  isCreatureOpenTile,
  isLooseRigidMaterial,
  isNonStructuralResourceMaterial,
  isObjectBraceTile,
  isObjectCrushableSupportTile,
  isObjectFootingTile,
  isPassableForFalling,
  isPlantSpaceTile,
  isPlayerPassableTile,
  isPlayerBuiltMaterial,
  isPlayerBuiltStructuralMaterial,
  isReplaceableNaturalOpenTile,
  isRigidObjectTile,
  isRubbleTrackedMaterial,
  isSafeLandingFloorTile,
  isSkyOpenTile,
  isStableMachineSupportTile,
  isSolidCollisionTile,
  isStructuralMaterial,
  isSunTransparentTile,
  isVisualOpenFluidTile,
  isWaterFillTile,
  isWaterOpenTile,
  isWindPorousTile,
  isWindExposureBlockerTile,
  isWeakFillMaterial,
  materialPhysicsCoverage,
  materialPhysicsRoute,
  structuralSupportStrengthForMaterial
} = await import('../src/engine/material_physics.js');

function resourceRows(){
  const src=readFileSync(new URL('../src/inventory.js', import.meta.url),'utf8');
  const body=src.match(/const RESOURCES=\[([\s\S]*?)\];/);
  assert.ok(body, 'inventory exposes a RESOURCES registry');
  return [...body[1].matchAll(/\{key:'([^']+)'[\s\S]*?tile:(?:'([^']+)'|null)/g)]
    .map(m=>({key:m[1], tile:m[2]}));
}

function projectPhysicsSourceFiles(){
  const engineDir=new URL('../src/engine/', import.meta.url);
  const engineSources=readdirSync(engineDir,{withFileTypes:true})
    .filter(d=>d.isFile() && d.name.endsWith('.js') && d.name!=='material_physics.js')
    .map(d=>['src/engine/'+d.name, readFileSync(new URL(d.name, engineDir),'utf8')]);
  return [
    ['src/main.js', readFileSync(new URL('../src/main.js', import.meta.url),'utf8')],
    ...engineSources
  ];
}

function assertNoMaterialPolicyDrift(){
  const constantsSolidImport=/import\s*\{[\s\S]*?\bisSolid\b[\s\S]*?\}\s*from ['"](?:\.\/constants\.js|\.\.\/constants\.js)['"]/;
  const rawInfoPassability=/(?:INFO\[[^\]]+\]|\binfo)\s*\.\s*(?:gas|passable)\b/;
  for(const [name,src] of projectPhysicsSourceFiles()){
    assert.doesNotMatch(src, constantsSolidImport, name+' does not import raw isSolid from constants');
    assert.doesNotMatch(src, rawInfoPassability, name+' does not inspect raw INFO gas/passable flags outside material_physics.js');
  }
}

function assertProfileShape(name,t){
  const p=buildMaterialProfile(t);
  assert.ok(p, name+' has an explicit build profile');
  for(const field of ['strength','weight','compression','lateral','flex','down','warn','fail','wind']){
    assert.equal(typeof p[field], 'number', name+' profile has numeric '+field);
    assert.ok(Number.isFinite(p[field]), name+' profile '+field+' is finite');
  }
  if(isStructuralMaterial(t) && t!==T.BEDROCK){
    assert.equal(typeof p.support, 'number', name+' profile has numeric terrain support');
    assert.ok(Number.isFinite(p.support), name+' profile support is finite');
  }
}

function assertNoSupportRole(name,t){
  assert.equal(isBuildAnchorTile(t), false, name+' route is not a lateral build anchor');
  assert.equal(isBuildFoundationTile(t), false, name+' route is not a build foundation');
  assert.equal(isStableMachineSupportTile(t), false, name+' route is not stable machine support');
  assert.equal(isObjectFootingTile(t), false, name+' route is not object footing');
  assert.equal(isObjectBraceTile(t), false, name+' route is not object bracing');
}

function assertRouteContract(row){
  const {name,id:t,route}=row;
  if(route==='void'){
    assertNoSupportRole(name,t);
    assert.equal(isPassableForFalling(t), true, name+' void route is passable to falling solids');
    assert.equal(isPlayerBuiltMaterial(t), false, name+' void route is not player-built material');
    return;
  }
  if(route==='fluid' || route==='gas' || route==='foliage'){
    assertNoSupportRole(name,t);
    assert.equal(isPlayerBuiltMaterial(t), false, name+' open-medium route is not player-built material');
    if(route==='gas') assert.equal(isGasTile(t), true, name+' gas route matches gas predicate');
    if(route==='foliage') assert.equal(isFoliageTile(t), true, name+' foliage route matches foliage predicate');
    return;
  }
  if(route==='rigid-object'){
    assert.ok(isRigidObjectTile(t), name+' rigid-object route reaches rigid object physics');
    assertNoSupportRole(name,t);
    assert.equal(isPlayerBuiltMaterial(t), false, name+' rigid object is not a player-built material');
    assert.equal(isRubbleTrackedMaterial(t), false, name+' rigid object is not tracked as structural rubble');
    return;
  }
  if(route==='mounted-fixture'){
    assert.ok(isMountedFixtureTile(t), name+' mounted-fixture route reaches fixture physics');
    assertNoSupportRole(name,t);
    assert.equal(isPassableForFalling(t), true, name+' mounted fixture remains passable for falling solids');
    assert.equal(isRubbleTrackedMaterial(t), false, name+' mounted fixture is not tracked as structural rubble');
    return;
  }
  if(route==='loose-item'){
    assertNoSupportRole(name,t);
    assert.equal(isPlayerBuiltMaterial(t), false, name+' loose item is not a player-built material');
    assert.equal(isRubbleTrackedMaterial(t), false, name+' loose item is not structural rubble');
    return;
  }
  if(route==='granular'){
    assert.equal(t, T.SAND, name+' is the granular tile handled by sand physics');
    assert.equal(isBuildAnchorTile(t), false, name+' granular route is not a build anchor');
    assert.equal(isBuildFoundationTile(t), false, name+' granular route is not a build foundation');
    assert.equal(isObjectFootingTile(t), true, name+' granular route can act as loose-object footing');
    assert.equal(isPlayerBuiltMaterial(t), false, name+' granular route is not tracked as a player frame');
    return;
  }
  if(route==='bedrock'){
    assert.equal(t, T.BEDROCK, name+' is the bedrock route');
    assert.equal(isBuildAnchorTile(t), true, name+' bedrock can anchor structures');
    assert.equal(isBuildFoundationTile(t), true, name+' bedrock can support structures');
    assert.equal(isRubbleTrackedMaterial(t), false, name+' bedrock never becomes rubble');
    assert.equal(isPlayerBuiltMaterial(t), false, name+' bedrock is not player-built material');
    return;
  }
  if(route==='story'){
    assertNoSupportRole(name,t);
    assert.equal(isPlayerBuiltMaterial(t), false, name+' story route does not enter player-built physics');
    assert.equal(isRubbleTrackedMaterial(t), false, name+' story route does not become generic rubble');
    return;
  }
  if(route==='build-material'){
    assert.ok(buildMaterialProfile(t), name+' build-material route has a profile');
    assert.ok(isPlayerBuiltMaterial(t), name+' build-material route reaches player-built physics');
    assert.equal(isRigidObjectTile(t), false, name+' build material is not a rigid object');
    assert.equal(isMountedFixtureTile(t), false, name+' build material is not a mounted fixture');
    assert.equal(isPassableForFalling(t), false, name+' build material is not passable to falling solids');
    assert.equal(isRubbleTrackedMaterial(t), true, name+' build material is tracked as rubble after collapse');
    return;
  }
  if(route==='passable-utility'){
    assertNoSupportRole(name,t);
    assert.equal(isPlayerBuiltMaterial(t), false, name+' passable utility is not a player-built frame');
    assert.equal(isRubbleTrackedMaterial(t), false, name+' passable utility is not structural rubble');
    return;
  }
  assert.fail(name+' has no route contract for '+route);
}

const rows=resourceRows();
const classified=[];
const routeCounts=new Map();
const tileNameById=new Map(Object.entries(T).map(([name,id])=>[id,name]));
for(const row of materialPhysicsCoverage()){
  assert.equal(typeof row.name, 'string', 'material physics coverage row has a tile name');
  assert.equal(typeof row.id, 'number', row.name+' coverage row has a numeric id');
  assert.ok(row.route, row.name+' has a canonical material physics route');
  assertRouteContract(row);
  routeCounts.set(row.route,(routeCounts.get(row.route)||0)+1);
}
for(const route of ['void','fluid','gas','foliage','rigid-object','mounted-fixture','loose-item','granular','bedrock','story','build-material','passable-utility']){
  assert.ok(routeCounts.get(route)>0, 'canonical material route '+route+' is represented');
}
assert.equal(materialPhysicsRoute(T.AIR), 'void', 'air has the void material route');
assert.equal(materialPhysicsRoute(T.WATER), 'fluid', 'water has the fluid material route');
assert.equal(materialPhysicsRoute(T.STEAM), 'gas', 'steam has the gas material route');
assert.equal(materialPhysicsRoute(T.LEAF), 'foliage', 'leaves have the foliage material route');
assert.equal(materialPhysicsRoute(T.SAND), 'granular', 'sand has the granular material route');
assert.equal(materialPhysicsRoute(T.BEDROCK), 'bedrock', 'bedrock has the bedrock material route');
assert.equal(materialPhysicsRoute(T.VOLCANO_MASTER_STONE), 'story', 'story stones have the story material route');
assert.equal(materialPhysicsRoute(T.TORCH), 'mounted-fixture', 'torches have the mounted-fixture material route');
assert.equal(materialPhysicsRoute(T.MEAT), 'loose-item', 'loose item tiles have the loose-item material route');
assert.equal(materialPhysicsRoute(T.DYNAMO), 'rigid-object', 'machines have the rigid-object material route');
assert.equal(materialPhysicsRoute(T.COPPER_WIRE), 'passable-utility', 'thin infrastructure has the passable-utility material route');
assert.equal(materialPhysicsRoute(T.STONE), 'build-material', 'stone has the build-material route');
for(const r of rows){
  if(!r.tile) continue;
  const id=T[r.tile];
  assert.equal(typeof id, 'number', r.key+' maps to a known T.'+r.tile);
  const route=materialPhysicsRoute(id);
  assert.ok(route, r.key+' / '+r.tile+' has a canonical material physics route');
  if(route==='build-material'){
    assert.ok(isPlayerBuiltMaterial(id), r.tile+' build route is reachable by the player-built solver');
    assertProfileShape(r.tile,id);
    classified.push([r.key,'build']);
    continue;
  }
  if(route==='rigid-object'){
    assert.ok(isRigidObjectTile(id), r.tile+' object route is reachable by rigid-object physics');
    assert.ok(!isBuildAnchorTile(id), r.tile+' rigid object is not a building anchor');
    classified.push([r.key,'object']);
    continue;
  }
  if(route==='mounted-fixture'){
    assert.ok(isMountedFixtureTile(id), r.tile+' fixture route is reachable by mounted-fixture physics');
    assert.ok(isPassableForFalling(id), r.tile+' mounted fixture stays passable');
    classified.push([r.key,'fixture']);
    continue;
  }
  if(['fluid','foliage','granular','passable-utility','story','loose-item','gas'].includes(route)){
    if(id!==T.SAND && id!==T.VOLCANO_MASTER_STONE && id!==T.SERVANT_STONE) assert.ok(!isStableMachineSupportTile(id), r.tile+' non-structural resource does not support machines');
    classified.push([r.key,'nonstructural']);
    continue;
  }
  assert.fail(r.key+' / '+r.tile+' has unsupported material physics route '+route);
}

for(const [raw] of Object.entries(BUILD_MATERIAL_PROFILES)){
  const t=Number(raw);
  const name=tileNameById.get(t) || String(t);
  assert.ok(isPlayerBuiltMaterial(t), name+' profile is reachable by the player-built solver');
  assertProfileShape(name,t);
}
const intentionalProfileAliases=new Set(['DIRT/GRASS']);
const profileSignatureFields=['strength','support','weight','compression','lateral','flex','down','warn','fail','wind','rubbleWind','rubbleRoll'];
const profileSignatures=new Map();
for(const [raw,p] of Object.entries(BUILD_MATERIAL_PROFILES)){
  const name=tileNameById.get(Number(raw)) || String(raw);
  const sig=profileSignatureFields.map(f=>Number.isFinite(p[f]) ? p[f] : '').join('|');
  const prev=profileSignatures.get(sig);
  if(prev){
    const alias=[prev,name].sort().join('/');
    assert.ok(intentionalProfileAliases.has(alias), prev+' and '+name+' have identical material physics only if explicitly allowed');
  } else {
    profileSignatures.set(sig,name);
  }
}

assert.ok(classified.some(([key,kind])=>key==='steel' && kind==='build'), 'steel resource enters the build stress graph');
assert.ok(classified.some(([key,kind])=>key==='waterPump' && kind==='object'), 'water pump resource enters rigid object physics');
assert.ok(classified.some(([key,kind])=>key==='torch' && kind==='fixture'), 'torch resource enters mounted fixture physics');

assert.equal(isBuildAnchorTile(T.WATER_PUMP), false, 'machines are not building anchors');
assert.equal(isBuildAnchorTile(T.CHEST_COMMON), false, 'chests are not building anchors');
assert.equal(isBuildAnchorTile(T.GLASS), false, 'fragile glass is not a building anchor');
assert.equal(isBuildAnchorTile(T.ELECTRONICS), false, 'electronics are not a building anchor');
assert.equal(isBuildAnchorTile(T.DIRT), false, 'weak fill is not a lateral building anchor');
assert.equal(isBuildAnchorTile(T.COAL), false, 'resource lumps are not building anchors');
assert.equal(isBuildAnchorTile(T.RADIOACTIVE_ORE), false, 'ore is not a building anchor');
assert.equal(isBuildAnchorTile(T.WOOD), true, 'wood is a light structural anchor');
assert.equal(isBuildAnchorTile(T.STONE), true, 'stone remains a valid terrain/build anchor');

assert.equal(isBuildFoundationTile(T.DIRT), true, 'weak fill can act as simple vertical footing');
assert.equal(isBuildFoundationTile(T.GRASS), true, 'surface soil can act as simple vertical footing');
assert.equal(isBuildFoundationTile(T.COAL), false, 'coal is tracked by physics but is not terrain footing');
assert.equal(isBuildFoundationTile(T.ELECTRONICS), false, 'electronics are tracked by physics but are not terrain footing');
assert.equal(isBuildFoundationTile(T.WATER_PUMP), false, 'machines are not terrain footing for buildings');
assert.equal(isBuildLoadTransferMaterial(T.STEEL), true, 'steel transfers structural load');
assert.equal(isBuildLoadTransferMaterial(T.ALIEN_BIOMASS), true, 'alien biomass transfers light structural load');
assert.equal(isBuildLoadTransferMaterial(T.DIRT), false, 'weak fill does not transfer frame load');
assert.equal(isBuildLoadTransferMaterial(T.RADIOACTIVE_ORE), false, 'ore does not transfer frame load');
assert.equal(isWeakFillMaterial(T.MUD), true, 'mud is classified as weak fill');
assert.equal(isNonStructuralResourceMaterial(T.COAL), true, 'coal is classified as non-structural resource');
assert.equal(isLooseRigidMaterial(T.COAL), true, 'untracked coal behaves as a loose rigid resource block');
assert.equal(isLooseRigidMaterial(T.RADIOACTIVE_ORE), true, 'untracked radioactive ore behaves as a loose rigid resource block');
assert.equal(isLooseRigidMaterial(T.STONE), false, 'ordinary stone is not a loose resource block');
assert.equal(isPlayerBuiltMaterial(T.COAL), true, 'coal remains tracked by player-built physics');
assert.equal(isPlayerBuiltStructuralMaterial(T.COAL), false, 'coal tracking does not imply structural support role');
assert.equal(isPlayerBuiltStructuralMaterial(T.WOOD), true, 'wood tracking includes structural support role');

assert.equal(isStableMachineSupportTile(T.WATER_PUMP), false, 'machines do not support machine placement');
assert.equal(isStableMachineSupportTile(T.CHEST_RARE), false, 'chests do not support machine placement');
assert.equal(isStableMachineSupportTile(T.GLASS), false, 'fragile glass does not support machine placement');
assert.equal(isStableMachineSupportTile(T.STONE), true, 'stone supports machine placement');
assert.equal(isStableMachineSupportTile(T.DIRT), true, 'simple machines can stand on weak fill footing');

assert.equal(isSafeLandingFloorTile(T.STONE), true, 'teleport landing can use real terrain footing');
assert.equal(isSafeLandingFloorTile(T.DIRT), true, 'teleport landing can use ordinary weak ground');
assert.equal(isSafeLandingFloorTile(T.SAND), true, 'teleport landing can use sand floors');
assert.equal(isSafeLandingFloorTile(T.WATER_PUMP), false, 'teleport landing does not use machine tops as floors');
assert.equal(isSafeLandingFloorTile(T.CHEST_COMMON), false, 'teleport landing does not use chest tops as floors');
assert.equal(isSafeLandingFloorTile(T.GLASS), false, 'teleport landing avoids fragile glass floors');
assert.equal(isSafeLandingFloorTile(T.DIAMOND), false, 'teleport landing avoids loose rigid ore floors');
assert.equal(isSafeLandingFloorTile(T.COAL), false, 'teleport landing avoids loose coal seam floors');
assert.equal(isSafeLandingFloorTile(T.WOOD), false, 'teleport landing keeps the old tree-trunk avoidance behavior');

assert.equal(isObjectFootingTile(T.WATER_PUMP), false, 'machines cannot be object footings');
assert.equal(isObjectFootingTile(T.CHEST_COMMON), false, 'chests cannot be object footings');
assert.equal(isObjectFootingTile(T.GLASS), false, 'fragile glass cannot be an object footing');
assert.equal(isObjectFootingTile(T.DIAMOND), false, 'loose rigid ore cannot be an object footing');
assert.equal(isObjectFootingTile(T.COAL), false, 'non-structural resources cannot be object footings');
assert.equal(isObjectFootingTile(T.ELECTRONICS), false, 'electronics cannot be an object footing');
assert.equal(isObjectFootingTile(T.DIRT), true, 'ordinary ground remains an object footing');
assert.equal(isObjectFootingTile(T.SAND), true, 'sand can carry loose objects without becoming a build foundation');
assert.equal(isObjectBraceTile(T.GLASS), false, 'fragile glass cannot side-brace rigid objects');
assert.equal(isObjectBraceTile(T.COAL), false, 'coal cannot side-brace rigid objects');
assert.equal(isObjectBraceTile(T.DIRT), true, 'ordinary ground can still side-brace fixtures and objects');
assert.equal(isObjectBraceTile(T.SAND), false, 'sand does not side-brace mounted objects');
assert.equal(isObjectCrushableSupportTile(T.COAL), true, 'rigid objects crush invalid coal supports instead of hovering on them');
assert.equal(isObjectCrushableSupportTile(T.GLASS), true, 'rigid objects crush invalid fragile supports instead of hovering on them');
assert.equal(isObjectCrushableSupportTile(T.SAND), false, 'rigid objects can rest on sand as an ordinary floor');

assert.equal(generatedCityStructuralTile(T.STEEL), true, 'city steel uses shared structural classification');
assert.equal(generatedCityStructuralTile(T.IRIDIUM), true, 'advanced metals are structural if generated or restored');
assert.equal(generatedCitySupportTile(T.DYNAMO), false, 'generated machines do not count as city supports');
assert.equal(generatedCitySupportTile(T.CHEST_EPIC), false, 'generated chests do not count as city supports');
assert.equal(generatedCitySupportTile(T.DIRT), true, 'generated weak fill can act as city terrain footing without becoming a player anchor');
assert.equal(generatedCitySupportTile(T.STONE), true, 'generated stone remains a city support');

assert.equal(isWindExposureBlockerTile(T.STONE), true, 'solid terrain blocks wind exposure');
assert.equal(isWindExposureBlockerTile(T.WATER_PUMP), true, 'solid machines block wind without becoming supports');
assert.equal(isWindExposureBlockerTile(T.CHEST_COMMON), true, 'chests block wind without becoming supports');
assert.equal(isWindExposureBlockerTile(T.WIRE), false, 'passable wires do not become wind canopies');
assert.equal(isWindExposureBlockerTile(T.DYNAMO_SLOT), false, 'passable dynamo slots do not become wind canopies');
assert.equal(isWindExposureBlockerTile(T.TORCH), false, 'mounted fixtures do not block wind exposure');
assert.equal(isWindExposureBlockerTile(T.LEAF), false, 'leaves are porous to wind exposure');
assert.equal(isWindExposureBlockerTile(T.STEAM), false, 'gases do not block wind exposure');
assert.equal(isWindPorousTile(T.AIR), true, 'wind treats air as porous');
assert.equal(isWindPorousTile(T.WIRE), true, 'wind treats passable wiring as porous');
assert.equal(isWindPorousTile(T.DYNAMO_SLOT), true, 'wind treats passable machine slots as porous');
assert.equal(isWindPorousTile(T.STEAM), true, 'wind treats gases as porous');
assert.equal(isWindPorousTile(T.STONE), false, 'wind treats solid terrain as closed');

assert.equal(isGasTile(T.STEAM), true, 'steam is a gas tile');
assert.equal(isGasTile(T.AIR), false, 'air is open space, not a gas tile');
assert.equal(isAirOrGasTile(T.AIR), true, 'generic open-gas policy treats air as open');
assert.equal(isAirOrGasTile(T.STEAM), true, 'generic open-gas policy treats gas as open');
assert.equal(isAirOrGasTile(T.WATER), false, 'generic open-gas policy does not include liquids');
assert.equal(isFoliageTile(T.LEAF), true, 'green leaves are foliage');
assert.equal(isFoliageTile(T.AUTUMN_LEAF_RED), true, 'seasonal leaves are foliage');
assert.equal(isFoliageTile(T.WOOD), false, 'tree trunks are not foliage');
assert.equal(isWaterOpenTile(T.AIR), true, 'water sees air as open');
assert.equal(isWaterOpenTile(T.STEAM), true, 'water sees gases as open');
assert.equal(isWaterOpenTile(T.LEAF), false, 'water does not treat foliage as air for pressure/head checks');
assert.equal(isWaterFillTile(T.LEAF), true, 'water can flow through/occupy foliage cells');
assert.equal(isWaterFillTile(T.WIRE), false, 'water does not overwrite passable wiring');
assert.equal(isWaterFillTile(T.DYNAMO_SLOT), false, 'water does not overwrite dynamo slots');
assert.equal(isWaterFillTile(T.TORCH), false, 'water does not overwrite mounted fixtures');
assert.equal(isSkyOpenTile(T.AIR), true, 'sky exposure sees air as open');
assert.equal(isSkyOpenTile(T.LEAF), true, 'sky exposure filters through foliage');
assert.equal(isSkyOpenTile(T.STEAM), true, 'sky exposure filters through gases');
assert.equal(isSkyOpenTile(T.WATER), false, 'sky exposure treats water as a surface, not open sky');
assert.equal(isPlantSpaceTile(T.AIR), true, 'plants can occupy air');
assert.equal(isPlantSpaceTile(T.WATER), true, 'plants can stay rooted through water');
assert.equal(isPlantSpaceTile(T.STEAM), true, 'plants can occupy transient gases');
assert.equal(isPlantSpaceTile(T.LEAF), false, 'plants do not overwrite foliage canopy cells');
assert.equal(isCreatureOpenTile(T.AIR), true, 'creatures can move through air');
assert.equal(isCreatureOpenTile(T.WATER), true, 'creatures can move through water');
assert.equal(isCreatureOpenTile(T.LEAF), true, 'creatures can move through foliage');
assert.equal(isCreatureOpenTile(T.STEAM), true, 'creatures can move through gas');
assert.equal(isCreatureOpenTile(T.STONE), false, 'creatures collide with solid terrain');
assert.equal(isPlayerPassableTile(T.AIR), true, 'player passability includes air');
assert.equal(isPlayerPassableTile(T.WATER), true, 'player passability includes water');
assert.equal(isPlayerPassableTile(T.LAVA), true, 'player passability includes lava as a damaging medium');
assert.equal(isPlayerPassableTile(T.WIRE), true, 'player passability includes passable wiring');
assert.equal(isPlayerPassableTile(T.TELEPORTER), true, 'player passability includes teleporter cells');
assert.equal(isPlayerPassableTile(T.STONE), false, 'player passability excludes solid terrain');
assert.equal(isSolidCollisionTile(T.STONE), true, 'solid collision blocks stone');
assert.equal(isSolidCollisionTile(T.WATER), false, 'solid collision does not block water');
assert.equal(isSolidCollisionTile(T.LAVA), false, 'solid collision does not block lava');
assert.equal(isSolidCollisionTile(T.WIRE), false, 'solid collision does not block thin passable infrastructure');
assert.equal(isSolidCollisionTile(T.TELEPORTER), false, 'solid collision does not block teleporter cells');
assert.equal(isSunTransparentTile(T.AIR), true, 'sunlight passes through air');
assert.equal(isSunTransparentTile(T.GLASS), true, 'sunlight passes through glass');
assert.equal(isSunTransparentTile(T.WIRE), true, 'sunlight passes through thin wiring');
assert.equal(isSunTransparentTile(T.LEAF), true, 'sunlight filters through foliage');
assert.equal(isSunTransparentTile(T.STEAM), true, 'sunlight passes through gases');
assert.equal(isSunTransparentTile(T.STONE), false, 'sunlight is blocked by stone');
assert.equal(isLavaVentOpenTile(T.AIR), true, 'lava vent scan treats air as open');
assert.equal(isLavaVentOpenTile(T.STEAM), true, 'lava vent scan treats gas as open');
assert.equal(isLavaVentOpenTile(T.TORCH), true, 'lava vent scan keeps torch openings');
assert.equal(isLavaVentOpenTile(T.GRAVE), true, 'lava vent scan keeps grave openings');
assert.equal(isLavaVentOpenTile(T.WATER), false, 'lava vent scan does not treat water as an air vent');
assert.equal(isHeatRayPassableTile(T.AIR), true, 'heat rays pass through air');
assert.equal(isHeatRayPassableTile(T.WIRE), true, 'heat rays pass through thin passable infrastructure');
assert.equal(isHeatRayPassableTile(T.WATER), false, 'heat rays stop at water');
assert.equal(isHeatRayPassableTile(T.LAVA), false, 'heat rays stop at lava');
assert.equal(isHeatRayPassableTile(T.STONE), false, 'heat rays stop at stone');
assert.equal(isVisualOpenFluidTile(T.AIR), true, 'wind surface visuals skip air');
assert.equal(isVisualOpenFluidTile(T.WATER), true, 'wind surface visuals skip water');
assert.equal(isVisualOpenFluidTile(T.LAVA), true, 'wind surface visuals skip lava');
assert.equal(isVisualOpenFluidTile(T.STEAM), true, 'wind surface visuals skip gas');
assert.equal(isVisualOpenFluidTile(T.WIRE), false, 'wind surface visuals can still sample thin infrastructure materials');
assert.equal(isCondensedWaterTargetTile(T.AIR), true, 'steam condensate can form in air');
assert.equal(isCondensedWaterTargetTile(T.WATER), true, 'steam condensate can merge with water');
assert.equal(isCondensedWaterTargetTile(T.STEAM), true, 'steam condensate can replace gas');
assert.equal(isCondensedWaterTargetTile(T.LEAF), false, 'steam condensate does not erase foliage directly');
assert.equal(canGasReplaceTile(T.POISON_GAS,T.AIR), true, 'gas can occupy air');
assert.equal(canGasReplaceTile(T.POISON_GAS,T.WIRE), false, 'gas does not overwrite passable wiring');
assert.equal(canGasReplaceTile(T.POISON_GAS,T.LEAF), false, 'gas does not overwrite foliage');
assert.equal(canGasSwapTile(T.HOT_AIR,T.POISON_GAS), true, 'hot air can bubble through heavier gases');
assert.equal(canGasSwapTile(T.STEAM,T.POISON_GAS), false, 'ordinary gases do not swap through each other');
assert.equal(canGasSwapTile(T.HOT_AIR,T.HOT_AIR), false, 'hot air does not swap with itself');

assert.equal(isReplaceableNaturalOpenTile(T.AIR), true, 'air is naturally replaceable by settling solids');
assert.equal(isReplaceableNaturalOpenTile(T.WATER), true, 'water can be displaced by settling solids');
assert.equal(isReplaceableNaturalOpenTile(T.STEAM), true, 'gas can be displaced by settling solids');
assert.equal(isReplaceableNaturalOpenTile(T.LAVA), false, 'lava is not replaced unless a caller explicitly allows it');
assert.equal(isReplaceableNaturalOpenTile(T.LAVA,true), true, 'callers can explicitly allow lava replacement');
assert.equal(isReplaceableNaturalOpenTile(T.TORCH), false, 'mounted fixtures are passable but not natural replacement cells');
assert.equal(isReplaceableNaturalOpenTile(T.WIRE), false, 'passable wiring is not overwritten by natural settlement');

assert.equal(isGeneratedStructureReplaceableTile(T.AIR), true, 'generated structures can occupy air');
assert.equal(isGeneratedStructureReplaceableTile(T.WATER), true, 'generated structures can displace water');
assert.equal(isGeneratedStructureReplaceableTile(T.LEAF), true, 'generated structures can clear foliage');
assert.equal(isGeneratedStructureReplaceableTile(T.TORCH), true, 'generated structures can replace old marker fixtures');
assert.equal(isGeneratedStructureReplaceableTile(T.WIRE), false, 'generated structures do not softly overwrite infrastructure wires');
assert.equal(isGeneratedStructureReplaceableTile(T.STONE), false, 'generated structures do not softly overwrite real terrain');

assert.equal(isLavaExposureOpenTile(T.AIR), true, 'lava exposure sees air as open');
assert.equal(isLavaExposureOpenTile(T.WATER), true, 'lava exposure sees water as an active contact');
assert.equal(isLavaExposureOpenTile(T.TORCH), true, 'lava exposure keeps the torch fixture exception');
assert.equal(isLavaExposureOpenTile(T.GRAVE), true, 'lava exposure keeps the grave fixture exception');
assert.equal(isLavaExposureOpenTile(T.WIRE), false, 'lava exposure does not make wiring an open cell');
assert.equal(isLavaExposureOpenTile(T.STONE), false, 'lava exposure treats terrain as closed');

for(const t of [T.STONE,T.GRANITE,T.BASALT,T.COAL,T.DIAMOND,T.ALIEN_BIOMASS,T.ANTIMATTER_CRYSTAL,T.VOLCANO_MASTER_STONE]){
  assert.equal(isMeteorImpactGroundTile(t), true, 'meteor impacts treat '+(INFO[t]?.name || t)+' as terrain/resource ground');
}
for(const t of [T.STEEL,T.WOOD,T.WATER_PUMP,T.CHEST_COMMON,T.WIRE,T.WATER,T.LAVA,T.AIR]){
  assert.equal(isMeteorImpactGroundTile(t), false, 'meteor impacts do not treat '+(INFO[t]?.name || t)+' as crater ground');
}
for(const t of [T.STONE,T.GRANITE,T.BASALT,T.BEDROCK]){
  assert.equal(isMeteorPickDenseRockMaterial(t), true, 'meteor pick dense-rock spark tier includes '+(INFO[t]?.name || t));
  assert.equal(isMeteorPickSparkMaterial(t), true, 'meteor pick spark materials include '+(INFO[t]?.name || t));
}
for(const t of [T.COAL,T.OBSIDIAN,T.METEORIC_IRON,T.RADIOACTIVE_ORE,T.ANTIMATTER_CRYSTAL]){
  assert.equal(isMeteorPickDenseRockMaterial(t), false, 'meteor pick treats '+(INFO[t]?.name || t)+' as mineral, not dense rock');
  assert.equal(isMeteorPickSparkMaterial(t), true, 'meteor pick spark materials include '+(INFO[t]?.name || t));
}
for(const t of [T.DIRT,T.WOOD,T.STEEL,T.DIAMOND,T.IRIDIUM,T.WATER_PUMP,T.WIRE,T.WATER]){
  assert.equal(isMeteorPickSparkMaterial(t), false, 'meteor pick spark materials exclude '+(INFO[t]?.name || t));
}

for(const t of [T.AIR,T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC,T.OBSIDIAN,T.DIAMOND,T.IRIDIUM,T.BEDROCK,T.VOLCANO_MASTER_STONE,T.SERVANT_STONE]){
  assert.equal(isBlastProtectedTile(t), true, 'blast protection preserves '+(INFO[t]?.name || t));
}
for(const t of [T.STONE,T.GRANITE,T.BASALT,T.STEEL,T.WOOD,T.COAL,T.ALIEN_BIOMASS,T.WATER_PUMP]){
  assert.equal(isBlastProtectedTile(t), false, 'blast crater can affect '+(INFO[t]?.name || t));
}
for(const t of [T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC,T.VOLCANO_MASTER_STONE,T.SERVANT_STONE,T.ANTIGRAVITY_BEACON,T.METEOR_SIREN,T.BEDROCK]){
  assert.equal(isMeteorProtectedTile(t), true, 'meteor terrain jobs preserve '+(INFO[t]?.name || t));
}
for(const t of [T.AIR,T.STONE,T.OBSIDIAN,T.DIAMOND,T.IRIDIUM,T.WATER_PUMP,T.TURRET,T.WIRE,T.WATER]){
  assert.equal(isMeteorProtectedTile(t), false, 'meteor protected policy does not over-protect '+(INFO[t]?.name || t));
}
for(const t of [T.WATER,T.ICE]){
  assert.equal(isMeteorWaterSiteTile(t), true, 'meteor consequence water sites include '+(INFO[t]?.name || t));
}
for(const t of [T.WOOD,T.LEAF,T.AUTUMN_LEAF_ORANGE,T.AUTUMN_LEAF_RED]){
  assert.equal(isMeteorForestSiteTile(t), true, 'meteor consequence forest sites include '+(INFO[t]?.name || t));
}
for(const t of [T.GRASS,T.MUD,T.ALIEN_BIOMASS]){
  assert.equal(isMeteorLifeSiteTile(t), true, 'meteor consequence living sites include '+(INFO[t]?.name || t));
}
for(const t of [T.STEEL,T.WIRE,T.COPPER_WIRE,T.WATER_PIPE,T.DYNAMO,T.WATER_PUMP,T.CHEST_COMMON,T.TURRET]){
  assert.equal(isMeteorSettlementSiteTile(t), true, 'meteor consequence settlement sites include '+(INFO[t]?.name || t));
}
for(const t of [T.AIR,T.STONE,T.SAND,T.COAL,T.WATER,T.ICE,T.WOOD,T.GRASS,T.ALIEN_BIOMASS]){
  assert.equal(isMeteorSettlementSiteTile(t), false, 'meteor consequence settlement sites exclude '+(INFO[t]?.name || t));
}
for(const t of [T.STONE,T.GRANITE,T.BASALT,T.BEDROCK,T.COAL]){
  assert.equal(isCreatureRockFloorTile(t), true, 'creature rock-floor substrate includes '+(INFO[t]?.name || t));
}
for(const t of [T.OBSIDIAN,T.DIAMOND,T.STEEL,T.SAND,T.DIRT,T.GRASS,T.WOOD,T.WATER,T.AIR]){
  assert.equal(isCreatureRockFloorTile(t), false, 'creature rock-floor substrate excludes '+(INFO[t]?.name || t));
}
for(const t of [T.STONE,T.GRANITE,T.BASALT,T.STEEL,T.WOOD,T.COAL,T.RADIOACTIVE_ORE]){
  assert.equal(isIridiumArrowPierceableTile(t), true, 'iridium arrows can pierce ordinary solid '+(INFO[t]?.name || t));
}
for(const t of [T.AIR,T.WATER,T.LAVA,T.CHEST_COMMON,T.WATER_PUMP,T.OBSIDIAN,T.DIAMOND,T.IRIDIUM,T.BEDROCK,T.VOLCANO_MASTER_STONE,T.SERVANT_STONE]){
  assert.equal(isIridiumArrowPierceableTile(t), false, 'iridium arrows cannot pierce protected/non-solid '+(INFO[t]?.name || t));
}

assert.ok(structuralSupportStrengthForMaterial(T.STEEL)>structuralSupportStrengthForMaterial(T.STONE), 'steel structural support exceeds stone');
assert.ok(structuralSupportStrengthForMaterial(T.BASALT)>structuralSupportStrengthForMaterial(T.STONE), 'basalt structural support differs from stone');
assert.equal(structuralSupportStrengthForMaterial(T.STEEL), buildMaterialProfile(T.STEEL).support, 'structural support strength is derived from steel material profile support');
assert.equal(structuralSupportStrengthForMaterial(T.BASALT), buildMaterialProfile(T.BASALT).support, 'structural support strength is derived from basalt material profile support');
assert.equal(structuralSupportStrengthForMaterial(T.COAL), 0, 'unknown/non-structural support strength does not fall back to stone-like strength');
assert.ok(buildMaterialProfile(T.WOOD).flex>buildMaterialProfile(T.GLASS).flex, 'wood flex differs from brittle glass');
assert.ok(buildMaterialProfile(T.COAL).fail<buildMaterialProfile(T.STONE).fail, 'coal fails earlier than stone');
assert.ok(fallingWindResponseForMaterial(T.SAND,false)>fallingWindResponseForMaterial(T.STEEL,false), 'sand is more wind-responsive than steel');
assert.ok(isStructuralMaterial(T.OBSIDIAN) && isPlayerBuiltMaterial(T.OBSIDIAN), 'obsidian participates in both structural and player-built physics');
assert.equal(isRubbleTrackedMaterial(T.BEDROCK), false, 'bedrock is never rubble-tracked');
for(const t of [T.GLASS,T.WIRE,T.ELECTRONICS,T.STEEL,T.METEORIC_IRON,T.IRIDIUM]){
  assert.equal(isLegacyPhysicsAuditMaterial(t), true, 'chunk/save audit wakes legacy '+(INFO[t]?.name || t));
}
for(const t of [T.STONE,T.WOOD,T.COAL,T.DIAMOND,T.WATER_PUMP,T.TORCH,T.BEDROCK,T.AIR,T.WATER]){
  assert.equal(isLegacyPhysicsAuditMaterial(t), false, 'chunk/save audit does not over-select '+(INFO[t]?.name || t));
}

const mainSource=readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
const fallingSource=readFileSync(new URL('../src/engine/falling.js', import.meta.url),'utf8');
const worldSource=readFileSync(new URL('../src/engine/world.js', import.meta.url),'utf8');
const meatSource=readFileSync(new URL('../src/engine/meat.js', import.meta.url),'utf8');
const volcanoSource=readFileSync(new URL('../src/engine/volcano.js', import.meta.url),'utf8');
const waterSource=readFileSync(new URL('../src/engine/water.js', import.meta.url),'utf8');
const gasSource=readFileSync(new URL('../src/engine/gases.js', import.meta.url),'utf8');
const pumpSource=readFileSync(new URL('../src/engine/pumps.js', import.meta.url),'utf8');
const windSource=readFileSync(new URL('../src/engine/wind.js', import.meta.url),'utf8');
const cloudSource=readFileSync(new URL('../src/engine/clouds.js', import.meta.url),'utf8');
const seasonSource=readFileSync(new URL('../src/engine/seasons.js', import.meta.url),'utf8');
const plantSource=readFileSync(new URL('../src/engine/plants.js', import.meta.url),'utf8');
const solarSource=readFileSync(new URL('../src/engine/solar.js', import.meta.url),'utf8');
const fogSource=readFileSync(new URL('../src/engine/fog.js', import.meta.url),'utf8');
const grassSource=readFileSync(new URL('../src/engine/grass.js', import.meta.url),'utf8');
const teleporterSource=readFileSync(new URL('../src/engine/teleporters.js', import.meta.url),'utf8');
const turretSource=readFileSync(new URL('../src/engine/turrets.js', import.meta.url),'utf8');
const treeSource=readFileSync(new URL('../src/engine/trees.js', import.meta.url),'utf8');
const ufoSource=readFileSync(new URL('../src/engine/ufo.js', import.meta.url),'utf8');
const fireSource=readFileSync(new URL('../src/engine/fire.js', import.meta.url),'utf8');
const meteoriteSource=readFileSync(new URL('../src/engine/meteorites.js', import.meta.url),'utf8');
const ruinsSource=readFileSync(new URL('../src/engine/ruins.js', import.meta.url),'utf8');
const weaponsSource=readFileSync(new URL('../src/engine/weapons.js', import.meta.url),'utf8');
const bossSource=readFileSync(new URL('../src/engine/bosses.js', import.meta.url),'utf8');
const mobSource=readFileSync(new URL('../src/engine/mobs.js', import.meta.url),'utf8');
const trapSource=readFileSync(new URL('../src/engine/traps.js', import.meta.url),'utf8');
assertNoMaterialPolicyDrift();
assert.match(mainSource, /isStableMachineSupportTile/, 'placement support uses shared material physics');
assert.match(mainSource, /isSafeLandingFloorTile/, 'teleport landing floors use shared material physics');
assert.match(mainSource, /isReplaceableNaturalOpenTile/, 'placement replaceable-cell checks use shared material physics');
assert.match(mainSource, /function isGasTileId\(t\)\{ return isGasTile\(t\); \}/, 'main gas identity delegates to shared material physics');
assert.match(mainSource, /function isTransientTerrainTile\(t\)\{\s*return isGasTile\(t\);\s*\}/, 'save stripping delegates transient gas identity to shared material physics');
assert.match(mainSource, /if\(isGasTileId\(tId\)\) return false;/, 'mining gas rejection uses shared gas identity');
assert.match(mainSource, /isSolidCollisionTile as isSolid/, 'main collision checks use shared solid-collision predicates');
assert.match(mainSource, /function meteorPickSparkTile\(t\)\{\s*return isMeteorPickSparkMaterial\(t\);\s*\}/, 'meteor pick mining feedback uses shared material predicates');
assert.match(mainSource, /emitMeteorPickSpark\(tx,ty,isMeteorPickDenseRockMaterial\(tId\)\?7:5\);/, 'meteor pick dense-rock intensity uses shared material predicates');
assert.match(mainSource, /return isReplaceableNaturalOpenTile\(cur,false\) && \(slot \|\| cur!==T\.WATER\);/, 'dynamo placement uses shared natural-open replacement rules');
assert.match(mainSource, /const support = isStableMachineSupport\(below\)/, 'non-structural placement fallback uses the same stable support predicate');
assert.match(fallingSource, /from '\.\/material_physics\.js'/, 'falling solver imports shared material physics');
assert.match(fallingSource, /function builtMaterialProfile\(t\)\{\s*return sharedBuildMaterialProfile\(t\);\s*\}/, 'falling solver does not invent generic build profiles');
assert.doesNotMatch(fallingSource, /\|\|\s*\{strength:/, 'build solver has no silent generic strength fallback');
assert.match(fallingSource, /isGasTile\(oldTile\).*isGasTile\(newTile\)/, 'falling raw writes notify gases through shared gas identity');
assert.match(fallingSource, /if\(isLegacyPhysicsAuditMaterial\(t\)\) return true;/, 'falling chunk audit uses shared legacy material wake predicates');
assert.doesNotMatch(fallingSource, /T\.GLASS \|\| t===T\.WIRE \|\| t===T\.ELECTRONICS/, 'falling chunk audit does not keep a private legacy material list');
assert.match(fallingSource, /function canCrushBearingSupport\(t\)\{[\s\S]*?return isBuildFoundationTile\(t\);[\s\S]*?\}/, 'bearing crushes use shared foundation predicates');
assert.match(worldSource, /generatedCitySupportTile/, 'generated-city audit uses shared support predicates');
assert.match(worldSource, /isGeneratedStructureReplaceableTile/, 'generated-city placement uses shared replacement predicates');
assert.match(worldSource, /isLavaExposureOpenTile/, 'generated lava registration uses shared exposure predicates');
assert.match(worldSource, /isReplaceableNaturalOpenTile\(arr\[i\],false\)/, 'small generated structures use shared natural-open replacement predicates');
assert.match(worldSource, /isRockStructuralMaterial\(t\) && isObjectFootingTile\(t\)/, 'cave treasure footing uses shared material physics');
assert.match(meatSource, /import \{ isGasTile, isObjectFootingTile, isReplaceableNaturalOpenTile \} from '\.\/material_physics\.js'/, 'loose meat drops import shared gas, footing and open-cell predicates');
assert.match(meatSource, /function supportedBy\(t\)\{\s*return isObjectFootingTile\(t\);\s*\}/, 'loose meat drops do not keep a private solid-support list');
assert.match(meatSource, /const canOccupy = t=>isReplaceableNaturalOpenTile\(t,false\);/, 'loose meat drops use the shared natural-open predicate');
assert.match(meatSource, /old!==T\.AIR && !isGasTile\(old\)/, 'rotten meat gas fallback uses shared gas identity');
assert.match(volcanoSource, /import \{[^}]*isBlastProtectedTile[^}]*isObjectFootingTile[^}]*isPassableForFalling[^}]*isReplaceableNaturalOpenTile[^}]*\} from '\.\/material_physics\.js'/, 'volcano projectiles import shared material predicates');
assert.match(volcanoSource, /function supportSolid\(t\)\{ return isObjectFootingTile\(t\); \}/, 'volcano story stones do not keep a private solid-support list');
assert.match(volcanoSource, /function projectileOpen\(t\)\{ return isPassableForFalling\(t\) \|\| t===T\.LAVA; \}/, 'volcano projectiles use shared falling passability for flight');
assert.match(volcanoSource, /isReplaceableNaturalOpenTile\(here,allowLava\)/, 'volcano rest-cell search uses shared natural replacement predicate');
assert.match(volcanoSource, /isReplaceableNaturalOpenTile\(old,false\)/, 'volcano master stones do not settle by overwriting passable fixtures');
assert.match(volcanoSource, /if\(isBlastProtectedTile\(t\)\) continue;/, 'volcano servant blasts do not keep a private blast-protection list');
assert.match(waterSource, /import \{ isFoliageTile, isGasTile, isWaterFillTile, isWaterOpenTile \} from '\.\/material_physics\.js'/, 'water simulation imports shared fluid occupancy predicates');
assert.match(waterSource, /function isAir\(t\)\{ return isWaterOpenTile\(t\); \}/, 'water pressure and surface checks use shared water-open predicates');
assert.match(waterSource, /function canFill\(t\)\{ return isWaterFillTile\(t\); \}/, 'water flow uses shared water-fill predicates');
assert.match(gasSource, /import \{ canGasReplaceTile, canGasSwapTile, isCondensedWaterTargetTile \} from '\.\/material_physics\.js'/, 'gas simulation imports shared gas occupancy predicates');
assert.match(gasSource, /function canReplaceWithGas\(tile,dst\)\{\s*return canGasReplaceTile\(tile,dst\);\s*\}/, 'gas motion uses shared replacement predicates');
assert.match(gasSource, /function canSwapThroughGas\(tile,dst\)\{\s*return canGasSwapTile\(tile,dst\);\s*\}/, 'gas swapping uses shared material predicates');
assert.match(gasSource, /if\(!isCondensedWaterTargetTile\(cur\)\) return false;/, 'steam condensate uses shared water target predicates');
assert.match(pumpSource, /import \{ isWaterFillTile \} from '\.\/material_physics\.js'/, 'water pumps import shared hydraulic receiver predicates');
assert.match(pumpSource, /return isWaterFillTile\(t\);/, 'pump outlets use the same water-fill predicate as natural water');
assert.match(windSource, /isWindExposureBlockerTile/, 'wind exposure uses shared material physics predicates');
assert.match(windSource, /isWindPorousTile/, 'wind open-cell checks use shared material physics predicates');
assert.match(windSource, /fallingWindResponseForMaterial/, 'wind visuals reuse material wind response profiles');
assert.match(windSource, /isVisualOpenFluidTile/, 'wind surface material sampling uses shared visual-open fluid predicates');
assert.match(windSource, /function isLeafTile\(t\)\{ return isFoliageTile\(t\); \}/, 'wind particle material descriptors use shared foliage predicates');
assert.match(cloudSource, /import \{ isFoliageTile, isSkyOpenTile, isWaterOpenTile \} from '\.\/material_physics\.js'/, 'cloud weather imports shared sky and water-open predicates');
assert.match(cloudSource, /function skyOpenTile\(t\)\{\s*return isSkyOpenTile\(t\);\s*\}/, 'cloud weather uses shared sky-open predicates');
assert.match(cloudSource, /isWaterOpenTile\(pt\)/, 'rain deposition uses shared water-open predicates');
assert.match(seasonSource, /import \{ isSkyOpenTile \} from '\.\/material_physics\.js'/, 'seasonal terrain effects import shared sky-open predicates');
assert.match(seasonSource, /function skyOpenTile\(t\)\{\s*return isSkyOpenTile\(t\);\s*\}/, 'seasonal terrain effects use shared sky-open predicates');
assert.match(plantSource, /import \{ isGasTile, isPlantSpaceTile \} from '\.\/material_physics\.js'/, 'plant ecology imports shared gas and plant-space predicates');
assert.match(plantSource, /function plantSpace\(t\)\{ return isPlantSpaceTile\(t\); \}/, 'plant ecology uses shared plant-space predicates');
assert.match(solarSource, /import \{ isSunTransparentTile \} from '\.\/material_physics\.js'/, 'solar charging imports shared sunlight transparency predicates');
assert.match(solarSource, /function transparentForSun\(t\)\{\s*return isSunTransparentTile\(t\);\s*\}/, 'solar charging uses shared sunlight transparency predicates');
assert.match(fogSource, /import \{ isAirOrGasTile, isGasTile \} from '\.\/material_physics\.js'/, 'fog visibility imports shared air/gas predicates');
assert.match(fogSource, /if\(isAirOrGasTile\(tt\)\) continue;/, 'fog fallback sky scan uses shared air/gas predicates');
assert.match(grassSource, /import \{ isAirOrGasTile, isFoliageTile \} from '\.\/material_physics\.js'/, 'grass overlays import shared open and foliage predicates');
assert.match(grassSource, /function openAbove\(t\)\{ return isAirOrGasTile\(t\); \}/, 'grass overlay open checks use shared air/gas predicates');
assert.match(grassSource, /function leafTile\(t\)\{ return isFoliageTile\(t\); \}/, 'grass overlay foliage checks use shared foliage predicates');
assert.match(teleporterSource, /import \{ isPlayerPassableTile \} from '\.\/material_physics\.js'/, 'teleporter exits import shared player passability predicates');
assert.match(teleporterSource, /function passableForPlayer\(t\)\{\s*return isPlayerPassableTile\(t\);\s*\}/, 'teleporter exit validation uses shared player passability');
assert.match(turretSource, /import \{[^}]*isPlayerPassableTile[^}]*\} from '\.\/material_physics\.js'/, 'turret sight checks import shared open-medium predicates');
assert.match(turretSource, /if\(isPlayerPassableTile\(t\)\) continue;/, 'turret sight checks use shared open-medium predicates');
assert.match(turretSource, /isSolidCollisionTile as isSolid/, 'turret hard cover checks use shared solid-collision predicates');
assert.match(treeSource, /import \{ fallingWindResponseForMaterial, isPassableForFalling \} from '\.\/material_physics\.js'/, 'tree debris imports shared falling material physics');
assert.match(treeSource, /function passThrough\(t\)\{ return !isLeaf\(t\) && isPassableForFalling\(t\); \}/, 'tree debris uses shared passability while preserving foliage collisions');
assert.match(treeSource, /fallingWindResponseForMaterial\(t,false\)/, 'tree debris wind response starts from shared material profiles');
assert.match(ufoSource, /import \{ isObjectFootingTile, isReplaceableNaturalOpenTile \} from '\.\/material_physics\.js'/, 'UFO wreck salvage imports shared material support predicates');
assert.match(ufoSource, /function dropCellSupported\(t\)\{\s*return isObjectFootingTile\(t\);\s*\}/, 'UFO wreck salvage does not keep a private solid-support rule');
assert.match(ufoSource, /function dropCellFree\(t\)\{[\s\S]*isReplaceableNaturalOpenTile\(t,false\)/, 'UFO wreck salvage uses shared natural open-cell checks');
assert.match(fireSource, /import \{ isLavaExposureOpenTile, isLavaVentOpenTile \} from '\.\/material_physics\.js'/, 'lava systems import shared exposure and vent predicates');
assert.match(fireSource, /function lavaOpenTile\(t\)\{\s*return isLavaExposureOpenTile\(t\);\s*\}/, 'lava exposure does not keep a private open-cell list');
assert.match(fireSource, /if\(isLavaVentOpenTile\(t\)\) return true;/, 'lava wake scans use shared vent-open predicates');
assert.match(meteoriteSource, /import \{[^}]*isGasTile[^}]*isMeteorForestSiteTile[^}]*isMeteorImpactGroundTile[^}]*isMeteorLifeSiteTile[^}]*isMeteorProtectedTile[^}]*isMeteorSettlementSiteTile[^}]*isMeteorWaterSiteTile[^}]*\} from '\.\/material_physics\.js'/, 'meteor impacts import shared gas, ground, site and protection predicates');
assert.match(meteoriteSource, /function isGas\(t\)\{ return isGasTile\(t\); \}/, 'meteor impact side-effects use shared gas identity');
assert.match(meteoriteSource, /function meteorGroundTile\(t\)\{\s*return isMeteorImpactGroundTile\(t\);\s*\}/, 'meteor impacts do not keep a private terrain/resource ground list');
assert.match(meteoriteSource, /function protectedTile\(t\)\{\s*return isMeteorProtectedTile\(t\);\s*\}/, 'meteor impacts do not keep a private protected-tile list');
assert.match(meteoriteSource, /if\(isMeteorWaterSiteTile\(t\)\) water\+\+;/, 'meteor consequence water classification uses shared material predicates');
assert.match(meteoriteSource, /if\(isMeteorForestSiteTile\(t\)\) forest\+\+;/, 'meteor consequence forest classification uses shared material predicates');
assert.match(meteoriteSource, /if\(isMeteorLifeSiteTile\(t\)\) life\+\+;/, 'meteor consequence life classification uses shared material predicates');
assert.match(meteoriteSource, /if\(isMeteorSettlementSiteTile\(t\)\) built\+\+;/, 'meteor consequence settlement classification uses shared material predicates');
assert.match(ruinsSource, /import \{ isReplaceableNaturalOpenTile \} from '\.\/material_physics\.js'/, 'ruin soft hints import shared natural-open predicates');
assert.match(ruinsSource, /isReplaceableNaturalOpenTile\(cur,false\)/, 'ruin soft hints do not keep a private air-water list');
assert.match(weaponsSource, /import \{[^}]*isBlastProtectedTile[^}]*isCondensedWaterTargetTile[^}]*isHeatRayPassableTile[^}]*isIridiumArrowPierceableTile[^}]*\} from '\.\/material_physics\.js'/, 'weapon impacts and streams import shared material predicates');
assert.match(weaponsSource, /isSolidCollisionTile as isSolid/, 'weapon projectiles use shared solid-collision predicates');
assert.match(weaponsSource, /if\(isBlastProtectedTile\(t\)\) continue;/, 'gas explosions do not keep a private blast-protection list');
assert.match(weaponsSource, /if\(!isCondensedWaterTargetTile\(t\)\) return;/, 'hose condensation uses shared condensate target predicates');
assert.match(weaponsSource, /function flameHeatRayPasses\(t\)\{\s*return isHeatRayPassableTile\(t\);\s*\}/, 'flame heat rays use shared material passability');
assert.match(weaponsSource, /function arrowPierceableTile\(t\)\{\s*return isIridiumArrowPierceableTile\(t\);\s*\}/, 'iridium arrow piercing does not keep a private material list');
assert.match(bossSource, /import \{ isBlastProtectedTile, isCreatureOpenTile, isFoliageTile \} from '\.\/material_physics\.js'/, 'bosses import shared material collision and damage predicates');
assert.match(bossSource, /function openT\(t\)\{ return isCreatureOpenTile\(t\); \}/, 'boss collision uses shared creature-open predicates');
assert.match(bossSource, /function isLeafTile\(t\)\{ return isFoliageTile\(t\); \}/, 'boss feeding text and nutrition uses shared foliage predicates');
assert.match(bossSource, /if\(isBlastProtectedTile\(t\)\) continue;/, 'boss heart blasts do not keep a private blast-protection list');
assert.match(mobSource, /isSolidCollisionTile as isSolid/, 'mob collision and projectile checks use shared solid-collision predicates');
assert.match(mobSource, /import \{[^}]*isCreatureRockFloorTile[^}]*isSolidCollisionTile as isSolid[^}]*\} from '\.\/material_physics\.js'/, 'mob substrate and collision checks import shared material predicates');
assert.match(mobSource, /function isRockFloor\(t\)\{ return isCreatureRockFloorTile\(t\); \}/, 'mob rock-floor substrate does not keep a private terrain list');
assert.match(trapSource, /isSolidCollisionTile as isSolid/, 'trap darts and wall searches use shared solid-collision predicates');

const forbiddenPhysicsDrift = [
  {name:'main stable support', source:mainSource, pattern:/function isStableMachineSupport\(t\)\{\s*return isStableMachineSupportTile\(t\);\s*\}/},
  {name:'main safe landing', source:mainSource, pattern:/function safeLandingFloor\(t\)\{\s*return isSafeLandingFloorTile\(t\);\s*\}/},
  {name:'falling wire anchors', source:fallingSource, pattern:/n\[1\]===1 \? isObjectFooting\(t\) : isObjectBrace\(t\)/},
  {name:'falling object footing', source:fallingSource, pattern:/function isObjectFooting\(t\)\{ return isObjectFootingTile\(t\); \}/},
  {name:'falling object brace', source:fallingSource, pattern:/function isObjectBrace\(t\)\{ return isObjectBraceTile\(t\); \}/},
  {name:'falling rubble crush', source:fallingSource, pattern:/function rubbleCrushes\(t\)\{ return isObjectCrushableSupportTile\(t\); \}/}
];
for(const rule of forbiddenPhysicsDrift){
  assert.match(rule.source, rule.pattern, rule.name+' remains a shared material-physics wrapper');
}

console.log('material-physics-sim: all assertions passed');
