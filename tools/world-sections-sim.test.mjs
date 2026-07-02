// Vertical world-section regression tests.
// The legacy 64xWORLD_H chunks remain intact, while sky/deep sections are
// generated lazily as 64xWORLD_SECTION_H slabs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const {
  CHUNK_W,
  WORLD_H,
  WORLD_SECTION_H,
  WORLD_MIN_SECTION,
  WORLD_MAX_SECTION,
  WORLD_MIN_Y,
  WORLD_MAX_Y,
  T
} = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { worldLayers } = await import('../src/engine/world_layers.js');
const { world } = await import('../src/engine/world.js');
const { solar } = await import('../src/engine/solar.js');

WG.worldSeed = 20260701;
WG.clearCaches();
world.clear();

assert.equal(WORLD_SECTION_H, 70, 'vertical section height is the half-height slab size');
assert.equal(WORLD_MIN_SECTION, -2, 'world has two generated sky sections above the legacy surface');
assert.equal(WORLD_MAX_SECTION, 3, 'world has two generated deep sections below the legacy map');
assert.equal(WORLD_MIN_Y, -140, 'top extended coordinate is exposed through constants');
assert.equal(WORLD_MAX_Y, 280, 'bottom extended coordinate is exposed through constants');

{
  const lowSky = worldLayers.layerEnvelope(WG, 0, -24);
  const highSky = worldLayers.layerEnvelope(WG, 0, WORLD_MIN_Y + 12);
  const deep = worldLayers.layerEnvelope(WG, 0, WORLD_H + 86);
  assert.ok(lowSky.sky > 0 && lowSky.lowSky > highSky.lowSky, 'world layer envelope differentiates lower sky from high sky');
  assert.ok(deep.deep > 0.5 && deep.mantle > 0, 'world layer envelope exposes deep-world intensity');
  assert.equal(worldLayers.skyTile(WG, 11, -35, -1), world.getTile(11, -35), 'sky sections use the shared world layer generator');
  assert.equal(worldLayers.deepTile(WG, 11, WORLD_H + 32), world.getTile(11, WORLD_H + 32), 'deep sections use the shared world layer generator');
}

{
  const boundedFields = ['temperature','moisture','continental','erosion','peak','mountain','volcanic','city','ocean','lake','desert','snow','swamp','island','beach','valley','ravine','skyFlux','crystalBias','basaltBias','deepFracture'];
  let ocean = null, mountain = null, volcano = null, city = null;
  for(let x=-24000; x<=24000; x+=8){
    const p = worldLayers.columnProfile(WG, x);
    for(const f of boundedFields){
      assert.equal(Number.isFinite(p[f]), true, 'column profile field '+f+' is finite');
      assert.ok(p[f] >= 0 && p[f] <= 1, 'column profile field '+f+' is normalized');
    }
    if(!ocean && p.ocean > 0.9) ocean = p;
    if(!mountain && p.mountain > 0.7 && p.volcanic <= 0) mountain = p;
    if(!volcano && p.volcanic > 0.9) volcano = p;
    if(!city && p.city > 0.4) city = p;
  }
  assert.ok(ocean, 'column profiles expose ocean context for vertical-layer blending');
  assert.ok(mountain, 'column profiles expose mountain context for vertical-layer blending');
  assert.ok(volcano, 'column profiles expose volcanic context for vertical-layer blending');
  assert.ok(city, 'column profiles expose city context for vertical-layer blending');
  assert.ok(mountain.skyFlux > ocean.skyFlux, 'mountain columns pull more sky-island/veil energy than open ocean');
  assert.ok(volcano.basaltBias > mountain.basaltBias, 'volcanic columns bias lower layers toward basaltic geology');
  assert.ok(city.deepFracture > ocean.deepFracture, 'devastated cities increase deep fracture variation beneath them');
}

{
  const cfg = worldLayers.skyLayerConfig(-1);
  const normalizedTraitFields = ['gate','mass','spread','keel','crown','jag'];
  let ocean = null, mountain = null, volcano = null, city = null;
  for(let cell=-600; cell<=600; cell++){
    const tr = worldLayers.skyCellTraits(WG, cell, -1, cfg);
    for(const f of normalizedTraitFields){
      assert.equal(Number.isFinite(tr[f]), true, 'sky cell trait '+f+' is finite');
      assert.ok(tr[f] >= 0 && tr[f] <= 1, 'sky cell trait '+f+' is normalized');
    }
    assert.equal(Number.isFinite(tr.lift), true, 'sky cell lift trait is finite');
    if(!ocean && tr.profile.ocean > 0.9 && tr.profile.mountain < 0.2) ocean = tr;
    if(!mountain && tr.profile.mountain > 0.7 && tr.profile.ocean < 0.2 && tr.profile.volcanic <= 0) mountain = tr;
    if(!volcano && tr.profile.volcanic > 0.9) volcano = tr;
    if(!city && tr.profile.city > 0.4) city = tr;
  }
  assert.ok(ocean, 'sky cell traits include open-ocean cells');
  assert.ok(mountain, 'sky cell traits include mountain cells');
  assert.ok(volcano, 'sky cell traits include volcanic cells');
  assert.ok(city, 'sky cell traits include city cells');
  assert.ok(volcano.gate < ocean.gate, 'volcanic columns make sky islands more likely than open ocean');
  assert.ok(volcano.keel > ocean.keel, 'volcanic sky islands grow heavier basalt keels than open-ocean islands');
  assert.ok(mountain.jag > ocean.jag, 'mountain sky islands are more jagged than open-ocean islands');
  assert.ok(city.crown > ocean.crown, 'city sky islands bias toward brighter relic crowns');

  const strataFields = ['crustDepth','continuityDepth','fold','band','lens','massWarp','igneous','crystal','fracture','virtualDepth','graniteLine','basaltLine','mantleLine'];
  const oceanDeep = worldLayers.deepStrataProfile(WG, ocean.roughCenter, WORLD_H + 78);
  const volcanoDeep = worldLayers.deepStrataProfile(WG, volcano.roughCenter, WORLD_H + 78);
  for(const st of [oceanDeep, volcanoDeep]){
    for(const f of strataFields){
      assert.equal(Number.isFinite(st[f]), true, 'deep strata field '+f+' is finite');
    }
    for(const f of ['igneous','crystal','fracture']){
      assert.ok(st[f] >= 0 && st[f] <= 1, 'deep strata field '+f+' is normalized');
    }
  }
  assert.ok(volcanoDeep.igneous > oceanDeep.igneous, 'volcanic deep strata are more igneous than open-ocean strata');
  assert.ok(volcanoDeep.mantleLine < oceanDeep.mantleLine, 'volcanic deep strata pull mantle/basalt transitions upward');
  assert.ok(oceanDeep.continuityDepth > oceanDeep.deep + 40, 'deep strata continue the legacy crust depth instead of resetting at WORLD_H');
}

{
  world.clear();
  WG.clearCaches();
  const t0 = Date.now();
  for(let cx=-6; cx<=6; cx++){
    for(const sy of [WORLD_MIN_SECTION, -1, 2, WORLD_MAX_SECTION]){
      world.ensureSection(cx, sy);
    }
  }
  const elapsed = Date.now() - t0;
  const m = world.metrics();
  assert.ok(elapsed < 3000, 'extended vertical section generation stays within a broad performance budget ('+elapsed+' ms)');
  assert.ok(m.chunks <= 60, 'vertical section generation touches only requested compact section chunks');
  assert.ok(m.heightCache < 5000, 'vertical section generation keeps surface-column cache bounded for local warmups');
  world.clear();
  WG.clearCaches();
}

const base = world.ensureChunk(0);
assert.equal(base.length, CHUNK_W * WORLD_H, 'legacy chunk storage stays full-height');
assert.equal(world.ensureSection(0, 0).length, CHUNK_W * WORLD_SECTION_H, 'base section 0 views the top half of a legacy chunk');
assert.equal(world.ensureSection(0, 1).length, CHUNK_W * WORLD_SECTION_H, 'base section 1 views the bottom half of a legacy chunk');
assert.equal(world.chunkArray(0).length, CHUNK_W * WORLD_H, 'chunkArray(cx) preserves legacy full-height access');
assert.equal(world.chunkArray({cx:0, sy:0}).length, CHUNK_W * WORLD_SECTION_H, 'chunkArray({cx,sy}) returns a section-height base view');

const skySection = world.ensureSection(0, -1);
const deepSection = world.ensureSection(0, 2);
assert.equal(skySection.length, CHUNK_W * WORLD_SECTION_H, 'sky section is a compact slab');
assert.equal(deepSection.length, CHUNK_W * WORLD_SECTION_H, 'deep section is a compact slab');
assert.equal(world._world.get('c0:s-1'), skySection, 'sky sections use a section-qualified storage key');
assert.equal(world._world.get('c0:s2'), deepSection, 'deep sections use a section-qualified storage key');

const sampleA = [-40, -24, -8, 142, 188, 236].map(y => world.getTile(11, y));
world.clear();
WG.clearCaches();
const sampleB = [-40, -24, -8, 142, 188, 236].map(y => world.getTile(11, y));
assert.deepEqual(sampleB, sampleA, 'extended sections regenerate deterministically from seed and coordinates');

world.clear();
WG.clearCaches();
{
  let skySolid = 0, lowSkySolid = 0, highSkySolid = 0, skyTopFaces = 0;
  let skySolarPanels = 0, skyBatteries = 0, skySpringPlatforms = 0, skyBeacons = 0;
  let skyTransitionDust = 0, skyTransitionGlass = 0, skyTransitionRare = 0;
  let exposedSolarRelic = null;
  const materials = new Set();
  for(let x=-384; x<=384; x++){
    for(let y=WORLD_MIN_Y; y<0; y++){
      const t = world.getTile(x,y);
      if(t===T.AIR) continue;
      skySolid++;
      if(y<-WORLD_SECTION_H) highSkySolid++;
      else lowSkySolid++;
      materials.add(t);
      if(t===T.SOLAR_PANEL) skySolarPanels++;
      if(t===T.SOLAR_BATTERY) skyBatteries++;
      if(t===T.SPRING_PLATFORM) skySpringPlatforms++;
      if(t===T.ANTIGRAVITY_BEACON) skyBeacons++;
      if(y>=-28 && y<0 && t===T.METEOR_DUST) skyTransitionDust++;
      if(y>=-28 && y<0 && t===T.GLASS) skyTransitionGlass++;
      if(y>=-28 && y<0 && t===T.IRIDIUM) skyTransitionRare++;
      if(!exposedSolarRelic && (t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY) && solar.skyExposed(x,y,world.getTile)){
        exposedSolarRelic = {x,y,t};
      }
      if(world.getTile(x,y-1)===T.AIR) skyTopFaces++;
    }
  }
  assert.ok(skySolid > 1600, 'sky generation creates substantial floating-island mass');
  assert.ok(lowSkySolid > 500, 'lower sky layer contains generated islands');
  assert.ok(highSkySolid > 500, 'upper sky layer contains generated islands');
  assert.ok(skyTopFaces > 40, 'sky islands expose traversable top faces');
  assert.ok(materials.has(T.GLASS), 'sky islands include glass/crystal crust');
  assert.ok(materials.has(T.METEOR_DUST), 'sky islands include meteor dust paths and interiors');
  assert.ok(materials.has(T.BASALT) || materials.has(T.GRANITE), 'sky islands include heavy underside geology');
  assert.ok(skySolarPanels >= 4, 'sky islands include exposed solar-panel relics for future energy progression');
  assert.ok(skyBatteries >= 8, 'sky islands include solar batteries and charged relic caches');
  assert.ok(skySpringPlatforms >= 2, 'high sky islands include rare movement platform relics');
  assert.ok(skyBeacons >= 10, 'sky islands include antigravity beacon cores');
  assert.ok(skyTransitionDust >= 400, 'lower sky transition includes meteor-dust veils near the old surface');
  assert.ok(skyTransitionGlass >= 200 && skyTransitionGlass < 1600, 'lower sky transition includes sparse crystal flecks without becoming a ceiling');
  assert.ok(skyTransitionRare >= 8 && skyTransitionRare < 120, 'lower sky transition has rare high-value flecks without flooding the start sky');
  assert.ok(exposedSolarRelic, 'at least one generated sky solar relic is exposed to direct sky light');

  solar.reset();
  MM.clouds = {metrics:()=>({clouds:0,cloudMass:0,drops:0,storm:{active:false,intensity:0}})};
  MM.background = {timeInfo:()=>({cycleT:0.25})};
  for(let i=0; i<40; i++) solar.update(0.25,{x:exposedSolarRelic.x,y:exposedSolarRelic.y},world.getTile);
  const skySolar = solar.metrics();
  assert.ok(skySolar.cells > 0, 'solar engine discovers generated sky solar relics near the player');
  assert.ok(skySolar.currentPower > 0 && skySolar.storedEnergy > 0, 'generated sky solar relics produce daylight energy');
}

{
  const upper = {air:0, water:0, stone:0, granite:0, basalt:0, diamond:0};
  for(let x=-384; x<=384; x++){
    for(let y=WORLD_H; y<WORLD_H+38; y++){
      const t = world.getTile(x,y);
      if(t===T.AIR) upper.air++;
      if(t===T.WATER) upper.water++;
      if(t===T.STONE) upper.stone++;
      if(t===T.GRANITE) upper.granite++;
      if(t===T.BASALT) upper.basalt++;
      if(t===T.DIAMOND) upper.diamond++;
    }
  }
  const upperSolid = upper.stone + upper.granite + upper.basalt + upper.diamond;
  assert.ok(upper.air > 5000 && upper.air < 15000, 'upper deep transition carries cave voids across WORLD_H without becoming mostly empty');
  assert.ok(upper.water > 1500 && upper.water < 8000, 'upper deep transition includes flooded channels and aquifer pockets without forming a flat water shelf');
  assert.ok(upperSolid > upper.air + upper.water, 'upper deep transition remains a traversable rock mass, not an open horizontal band');
  assert.ok(upper.basalt > 7000 && upper.granite > 1200, 'upper deep transition continues mature basalt/granite crust instead of restarting as shallow stone');
  assert.ok(upper.stone < upper.basalt * 0.08, 'upper deep transition does not repeat the mid-world shallow stone strata');
  assert.ok(upper.diamond > 60, 'upper deep transition keeps rare resource seams');
}

{
  const deep = {air:0, water:0, solid:0, maxOpenRun:0};
  for(let x=-384; x<=384; x++){
    let run = 0;
    for(let y=WORLD_H; y<WORLD_H+120; y++){
      const t = world.getTile(x,y);
      const open = t === T.AIR || t === T.WATER;
      if(open){
        if(t===T.AIR) deep.air++;
        if(t===T.WATER) deep.water++;
        run++;
      } else {
        deep.solid++;
        run = 0;
      }
      if(run > deep.maxOpenRun) deep.maxOpenRun = run;
    }
  }
  assert.ok(deep.solid > deep.air + deep.water, 'deep sections remain dominated by coherent rock masses');
  assert.ok(deep.water > 3000, 'deep sections contain meaningful flooded cave/channel systems');
  assert.ok(deep.maxOpenRun < 86, 'deep cave systems avoid huge vertical void wedges');
}

{
  let resetLike = 0;
  let sampled = 0;
  let minContact = Infinity;
  let maxContact = -Infinity;
  let contactAbove = 0;
  let contactBelow = 0;
  for(let x=-384; x<=384; x+=8){
    const st = worldLayers.deepStrataProfile(WG, x, WORLD_H);
    const contact = worldLayers.midLowContactY(WG, x);
    sampled++;
    if(st.continuityDepth < 45 || st.virtualDepth < st.graniteLine) resetLike++;
    minContact = Math.min(minContact, contact);
    maxContact = Math.max(maxContact, contact);
    if(contact < WORLD_H - 3) contactBelow++;
    if(contact > WORLD_H + 3) contactAbove++;
  }
  assert.ok(sampled > 50 && resetLike <= 2, 'WORLD_H boundary keeps mature crust depth across most columns');
  assert.ok(maxContact - minContact >= 24, 'mid/low contact is a broad warped band, not a flat section seam');
  assert.ok(contactBelow > 12 && contactAbove > 8, 'mid/low contact crosses above and below WORLD_H across nearby columns');
}

{
  let maxTransitionWater = 0;
  let air139 = 0, air140 = 0, solid139 = 0, solid140 = 0;
  for(let y=WORLD_H-26; y<=WORLD_H+10; y++){
    let water = 0;
    for(let x=-384; x<=384; x++){
      const t = world.getTile(x,y);
      if(t===T.WATER) water++;
      if(y===WORLD_H-1){
        if(t===T.AIR) air139++;
        else if(t!==T.WATER) solid139++;
      } else if(y===WORLD_H){
        if(t===T.AIR) air140++;
        else if(t!==T.WATER) solid140++;
      }
    }
    maxTransitionWater = Math.max(maxTransitionWater, water);
  }
  assert.ok(maxTransitionWater < 80, 'mid/low contact band does not contain a flat aquifer shelf');
  assert.ok(Math.abs(air139-air140) < 120, 'air/open cave ratio is continuous across WORLD_H');
  assert.ok(solid139 > 240 && solid140 > 240, 'WORLD_H boundary keeps enough rock mass on both sides to avoid an empty horizontal seam');
}

{
  let volcanoX = null;
  for(let x=-24000; x<=24000; x+=4){
    const col = WG.column(x);
    if(col && col.volcano && Math.abs(x-col.volcano.center) <= 2){
      volcanoX = Math.round(col.volcano.center);
      break;
    }
  }
  assert.ok(volcanoX !== null, 'test seed includes a volcanic column for root continuity checks');
  const midRoot = worldLayers.volcanoRootProfile(WG, volcanoX, WORLD_H - 8);
  const lowRoot = worldLayers.volcanoRootProfile(WG, volcanoX, WORLD_H + 72);
  const endRoot = worldLayers.volcanoRootProfile(WG, volcanoX, WORLD_H + 134);
  assert.ok(midRoot.active && lowRoot.active, 'volcano roots continue from the legacy band into low-world sections');
  assert.ok(endRoot.endFade < 0.35, 'volcano roots taper and end inside the low world instead of running forever');
  let volcanicTiles = 0, lavaTiles = 0;
  for(let dx=-5; dx<=5; dx++){
    for(let y=WORLD_H; y<WORLD_H+118; y++){
      const t = world.getTile(volcanoX+dx, y);
      if(t===T.LAVA) lavaTiles++;
      if(t===T.LAVA || t===T.OBSIDIAN || t===T.BASALT) volcanicTiles++;
    }
  }
  assert.ok(volcanicTiles > 500, 'volcano root materializes as a substantial low-world basalt/obsidian/lava conduit');
  assert.ok(lavaTiles > 40, 'volcano root carries visible lava into the low world');

  // The conduit jacket must cross WORLD_H as one body: volcanic mass present on
  // every row through the contact band, with no cliff jump at the seam.
  const vol = WG.column(volcanoX).volcano;
  const nearPipe = vol.pipe + 6;
  let prevVolc = null;
  for(let y=126; y<=154; y++){
    let volc = 0;
    for(let dx=-nearPipe; dx<=nearPipe; dx++){
      const t = world.getTile(volcanoX+dx, y);
      if(t===T.LAVA || t===T.OBSIDIAN || t===T.BASALT) volc++;
    }
    assert.ok(volc > 0, 'volcano conduit jacket stays present across the mid/low contact (y='+y+')');
    if(prevVolc!==null && y>=138 && y<=142){
      assert.ok(Math.abs(volc-prevVolc) <= 8, 'volcanic mass does not jump at the WORLD_H contact (y='+y+': '+prevVolc+'->'+volc+')');
    }
    prevVolc = volc;
  }
}

{
  // Aquifer: a warped regional water table with genuinely wet and dry stretches,
  // never a single flat world row.
  let minA = Infinity, maxA = -Infinity, dryCols = 0, wetCols = 0;
  for(let x=-2400; x<=2400; x+=8){
    const a = WG.aquiferAt(x);
    assert.equal(Number.isFinite(a), true, 'aquifer level is finite');
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    if(a > WORLD_H - 2) dryCols++;
    if(a < 100) wetCols++;
  }
  assert.ok(maxA - minA >= 30, 'aquifer table swings regionally instead of tracking one row (spread '+(maxA-minA)+')');
  assert.ok(dryCols > 0, 'some regions run dry so caves stay open into the deep sections');
  assert.ok(wetCols > 0, 'some regions keep shallow saturated water tables');

  // Underground pocket surfaces must scatter across many rows (no shelf).
  const tops = new Map();
  let watered = 0;
  for(let x=-384; x<=384; x++){
    for(let y=74; y<139; y++){
      const t = world.getTile(x, y);
      if(t===T.WATER && world.getTile(x, y-1)!==T.WATER){
        tops.set(y, (tops.get(y)||0)+1);
        watered++;
        break;
      }
    }
  }
  let flattest = 0;
  for(const c of tops.values()) flattest = Math.max(flattest, c);
  assert.ok(watered > 10, 'mid-band aquifer pockets exist ('+watered+' columns)');
  assert.ok(flattest <= Math.max(10, watered*0.4), 'aquifer pocket surfaces never align into one flat row (peak '+flattest+' of '+watered+')');

  // Deep flooding follows the same table: wet stretches stay wet below the
  // contact, dry stretches carry open caves much deeper before pooling.
  let wetFlood = 0, wetOpen = 0, dryFlood = 0, dryOpen = 0;
  for(let x=-4800; x<=4800; x+=3){
    const a = WG.aquiferAt(x);
    const cave = worldLayers.deepCaveProfile(WG, x, WORLD_H+52);
    if(!cave.open) continue;
    if(a < 104){ wetOpen++; if(cave.flooded) wetFlood++; }
    else if(a > WORLD_H){ dryOpen++; if(cave.flooded) dryFlood++; }
  }
  assert.ok(wetOpen > 20 && dryOpen > 20, 'aquifer sampling covers wet and dry deep caves');
  assert.ok(wetFlood/wetOpen > 0.7, 'wet water-table regions keep flooded caves below the contact');
  assert.ok(dryFlood/dryOpen < 0.5, 'dry water-table regions continue as open caves below the contact');
}

{
  // Ore systems cross the contact and pool into masses instead of uniform flecks.
  let coalAbove = 0, coalBelow = 0;
  for(let x=-384; x<=384; x++){
    for(let y=126; y<140; y++) if(world.getTile(x,y)===T.COAL) coalAbove++;
    for(let y=140; y<169; y++) if(world.getTile(x,y)===T.COAL) coalBelow++;
  }
  assert.ok(coalAbove >= 15 && coalBelow >= 30, 'coal seams continue across the mid/low contact (above '+coalAbove+', below '+coalBelow+')');

  let diamonds = 0, clustered = 0;
  for(let x=-384; x<=384; x++){
    for(let y=150; y<270; y++){
      if(world.getTile(x,y)!==T.DIAMOND) continue;
      diamonds++;
      let neighbor = false;
      for(let dy=-1; dy<=1 && !neighbor; dy++){
        for(let dx=-1; dx<=1; dx++){
          if((dx||dy) && world.getTile(x+dx,y+dy)===T.DIAMOND){ neighbor = true; break; }
        }
      }
      if(neighbor) clustered++;
    }
  }
  assert.ok(diamonds > 300, 'deep sections keep a meaningful diamond supply ('+diamonds+')');
  assert.ok(clustered/Math.max(1,diamonds) > 0.18, 'deep ores cluster into pocket masses ('+(clustered/Math.max(1,diamonds)*100).toFixed(1)+'% adjacent)');
}

{
  // Bedrock exists only as a ragged true-boundary roof, never a clean shelf.
  const bedrockTops = new Set();
  for(let x=-200; x<=200; x++){
    let y = WORLD_MAX_Y-1;
    while(y > WORLD_MAX_Y-14 && world.getTile(x,y)===T.BEDROCK) y--;
    const top = y+1;
    assert.ok(top >= WORLD_MAX_Y-11 && top <= WORLD_MAX_Y-3, 'bedrock roof stays a bounded boundary feature (top '+top+')');
    bedrockTops.add(top);
  }
  assert.ok(bedrockTops.size >= 4, 'bedrock roof is ragged rather than flat ('+bedrockTops.size+' levels)');
}

world.clear();
assert.equal(world.peekTile(0, 10, 255), 255, 'peekTile does not generate an unloaded base chunk');
world.ensureChunk(0);
assert.equal(world.peekTile(0, 10, 255), world.getTile(0, 10), 'peekTile reads loaded legacy base chunks');
world.ensureSection(0, -1);
assert.equal(world.peekTile(3, -5, 255), world.getTile(3, -5), 'peekTile reads loaded sky sections');

world.clear();
world.setTile(3, -5, T.GLASS);
assert.equal(world.getTile(3, -5), T.GLASS, 'edits in sky sections round-trip through getTile');
assert.ok(world.chunkVersion(0, -1) > 0, 'sky edit bumps the section chunk version');
assert.ok(world.modifiedChunkIds().some(ref => ref && ref.cx === 0 && ref.sy === -1), 'sky edit is listed as a section save ref');

world.setTile(4, 145, T.BASALT);
assert.equal(world.getTile(4, 145), T.BASALT, 'edits in deep sections round-trip through getTile');
assert.ok(world.chunkVersion(0, 2) > 0, 'deep edit bumps the section chunk version');
assert.ok(world.modifiedChunkIds().some(ref => ref && ref.cx === 0 && ref.sy === 2), 'deep edit is listed as a section save ref');

assert.equal(world.setInfrastructure(7, -6, T.COPPER_WIRE), true, 'infrastructure overlays can live in sky sections');
let snap = world.snapshotInfrastructure();
assert.ok(snap.list.some(o => o.x === 7 && o.y === -6 && o.t === T.COPPER_WIRE), 'sky infrastructure is persisted');
world.clearInfrastructure(7, -6, T.COPPER_WIRE);
world.restoreInfrastructure(snap);
assert.ok(world.hasInfrastructure(7, -6, T.COPPER_WIRE), 'sky infrastructure restores by absolute y');

assert.equal(world.setConstructionBackground(8, 150, T.BRICK), true, 'background construction can live in deep sections');
const bgSnap = world.snapshotConstructionBackground();
assert.ok(bgSnap.list.some(o => o.x === 8 && o.y === 150 && o.t === T.BRICK), 'deep construction background is persisted');

assert.equal(world.getTile(0, WORLD_MIN_Y - 1), T.AIR, 'above extended bounds is void air');
assert.equal(world.getTile(0, WORLD_MAX_Y), T.BEDROCK, 'below extended bounds is hard bedrock');

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/engine/world.js', import.meta.url), 'utf8');
assert.match(worldSource, /WORLD_LAYERS\.legacyGeologyRockTile\(WG,wx,y,depth,biome\)/, 'legacy terrain geology delegates to the shared world layer model');
assert.doesNotMatch(worldSource, /function geologyLayerDepth\(/, 'legacy terrain no longer keeps a private geology-depth model');
assert.doesNotMatch(worldSource, /function geologyMix\(/, 'legacy terrain no longer keeps a private geology material mixer');
assert.match(mainSource, /function ensureChunkAtY\(cx,y\)[\s\S]*WORLD\.ensureSection\(cx,sy\)/, 'main can eagerly load the chunk section matching a world y');
assert.match(mainSource, /function teleportHeroTo\(x,y,opts\)[\s\S]*ensureChunkAtY\(Math\.floor\(x\/CHUNK_W\),y\)/, 'debug and scripted teleports load the destination vertical section');
assert.match(mainSource, /function ensureChunks\(\)[\s\S]*ensureChunkAtY\(pcx\+d,player\.y\)/, 'runtime chunk warming follows the player vertical section');
assert.match(mainSource, /function placePlayer\(skipMsg,opts\)[\s\S]*ensureChunkAtY\(Math\.floor\(respawnPoint\.x\/CHUNK_W\),respawnPoint\.y\)/, 'totem respawn placement warms the saved vertical section');
assert.match(mainSource, /function deathRespawnTarget\(\)[\s\S]*ensureChunkAtY\(Math\.floor\(respawnPoint\.x\/CHUNK_W\),respawnPoint\.y\)/, 'death respawn target warms the saved vertical section');
assert.match(mainSource, /function debugGasOrigin\(\)[\s\S]*ensureChunkAtY\(Math\.floor\(tx\/CHUNK_W\),ty\)/, 'debug gas placement probes the correct vertical section');
assert.match(mainSource, /function debugRigCellsClear\(cells\)[\s\S]*ensureChunkAtY\(Math\.floor\(cell\.x\/CHUNK_W\),cell\.y\)/, 'debug rig placement validates cells in the correct vertical section');
