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
  world.clear();
  const cx=7;
  const base=new Uint8Array(CHUNK_W*WORLD_H);
  base[0]=T.STONE;
  assert.equal(world.setChunkArray('c'+cx,base),true,'validated base chunk arrays can be installed');
  assert.equal(world.getTile(cx*CHUNK_W,0),T.STONE,'installed base chunk is visible through normal tile reads');
  assert.equal(world.setChunkArray('c'+cx,new Uint8Array(base.length-1)),false,'wrong-length base chunks are rejected without replacing live terrain');
  assert.equal(world.getTile(cx*CHUNK_W,0),T.STONE,'rejected chunk data leaves the previous chunk intact');
  assert.equal(world.setChunkArray('c'+cx+':s0',new Uint8Array(CHUNK_W*WORLD_SECTION_H)),false,'non-canonical aliases for base sections are rejected');
  assert.equal(world.setChunkArray('c0:s'+(WORLD_MAX_SECTION+1),new Uint8Array(CHUNK_W*WORLD_SECTION_H)),false,'sections outside the vertical world range are rejected');
  assert.equal(world.setChunkArray('c1.5',new Uint8Array(CHUNK_W*WORLD_H)),false,'fractional chunk coordinates are rejected');
  assert.equal(world.setChunkArray('c999999999',new Uint8Array(CHUNK_W*WORLD_H)),false,'chunk coordinates outside the hardened world span are rejected');
  assert.equal(world.setChunkArray('c8',new Uint8ClampedArray(CHUNK_W*WORLD_H)),false,'non-Uint8Array chunk payloads are rejected');
  const sky=new Uint8Array(CHUNK_W*WORLD_SECTION_H);
  sky[0]=T.GLASS;
  assert.equal(world.setChunkArray('c'+cx+':s-1',sky),true,'validated non-base section arrays can be installed');
  assert.equal(world.getTile(cx*CHUNK_W,-70),T.GLASS,'installed sky section is visible at its world coordinate');
  world.clear();
}

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
  assert.ok(upper.diamond < 8, 'upper deep transition stays diamond-scarce so diamonds wait near bedrock (got '+upper.diamond+')');
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
  // Coal systems cross the contact, while diamonds are now a sparse bedrock-level
  // prize instead of an upper-deep transition resource.
  let coalAbove = 0, coalBelow = 0;
  for(let x=-384; x<=384; x++){
    for(let y=126; y<140; y++) if(world.getTile(x,y)===T.COAL) coalAbove++;
    for(let y=140; y<169; y++) if(world.getTile(x,y)===T.COAL) coalBelow++;
  }
  assert.ok(coalAbove >= 15 && coalBelow >= 30, 'coal seams continue across the mid/low contact (above '+coalAbove+', below '+coalBelow+')');

  let diamonds = 0, upperDiamonds = 0, midDiamonds = 0, bedrockDiamonds = 0;
  for(let x=-384; x<=384; x++){
    for(let y=150; y<270; y++){
      if(world.getTile(x,y)!==T.DIAMOND) continue;
      diamonds++;
      if(y<WORLD_H+60) upperDiamonds++;
      else if(y<WORLD_H+100) midDiamonds++;
      else bedrockDiamonds++;
    }
  }
  assert.ok(diamonds >= 45 && diamonds <= 140, 'deep sections keep a sparse diamond supply ('+diamonds+')');
  assert.ok(upperDiamonds <= 4, 'upper deep band has almost no diamonds ('+upperDiamonds+')');
  assert.ok(bedrockDiamonds > diamonds*0.65, 'most deep diamonds sit in the bedrockward band ('+bedrockDiamonds+'/'+diamonds+')');
  assert.ok(bedrockDiamonds > midDiamonds*3, 'bedrockward diamonds dominate mid-depth diamonds ('+bedrockDiamonds+' vs '+midDiamonds+')');
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
assert.equal(world.isConstructionBackgroundTile(T.WOOD_DOOR), false, 'doors cannot exist as construction background tiles');
assert.equal(world.isConstructionBackgroundTile(T.WOOD_TRAPDOOR), false, 'trapdoors cannot exist as construction background tiles');
assert.equal(world.setConstructionBackground(9, 150, T.WOOD_DOOR), false, 'doors cannot be placed into construction background');
assert.equal(world.setConstructionBackground(10, 150, T.WOOD_TRAPDOOR), false, 'trapdoors cannot be placed into construction background');
world.restoreConstructionBackground({v:1,list:[
  {x:11,y:150,t:T.STONE_DOOR},
  {x:12,y:150,t:T.STONE_TRAPDOOR},
  {x:13,y:150,t:T.BRICK}
]});
assert.equal(world.getConstructionBackground(11,150), T.AIR, 'restoring old saves drops background doors');
assert.equal(world.getConstructionBackground(12,150), T.AIR, 'restoring old saves drops background trapdoors');
assert.equal(world.getConstructionBackground(13,150), T.BRICK, 'restoring old saves keeps valid background walls');
assert.equal(world.setConstructionBackground(13, 150, T.STONE_DOOR), false, 'invalid background doors do not clear an existing background wall');
assert.equal(world.getConstructionBackground(13,150), T.BRICK, 'invalid background door attempts leave existing background walls intact');

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
assert.match(mainSource, /function totemRespawnSpot\(tx,ty\)[\s\S]*ensureChunkAtY\(Math\.floor\(tx\/CHUNK_W\),ty\)/, 'totem respawn spot warms the saved vertical section');
assert.match(mainSource, /function healingShelterRespawnSpot\(rec\)[\s\S]*ensureChunkAtY\(Math\.floor\(rec\.x\/CHUNK_W\),rec\.y\)/, 'healing shelter respawn spot warms the saved vertical section');
assert.match(mainSource, /function placePlayerAtRespawnSpot\(spot\)[\s\S]*ensureChunkAtY\(Math\.floor\(x\/CHUNK_W\),y\)/, 'respawn placement helper warms the destination vertical section');
assert.match(mainSource, /function placePlayer\(skipMsg,opts\)[\s\S]*const dest=nearestRespawnDestination\(\);[\s\S]*const spot=dest\.spot;[\s\S]*placePlayerAtRespawnSpot\(spot\)/, 'normal respawn routes its chosen totem or shelter through the section-aware placement helper');
assert.match(mainSource, /function debugGasOrigin\(\)[\s\S]*ensureChunkAtY\(Math\.floor\(tx\/CHUNK_W\),ty\)/, 'debug gas placement probes the correct vertical section');
assert.match(mainSource, /function debugRigCellsClear\(cells\)[\s\S]*ensureChunkAtY\(Math\.floor\(cell\.x\/CHUNK_W\),cell\.y\)/, 'debug rig placement validates cells in the correct vertical section');

{ // --- Chunk parking: far modified chunks compress into cold storage instead of
  // pinning the live map open (the 240->30 fps long-session decay fix).
  world.clear();
  WG.worldSeed = 20260701;
  WG.clearCaches();
  world._setChunkCapForTest(24);
  globalThis.player = { x: 2, y: 20 }; // anchors evict distance + protect radius
  world.ensureChunk(40);
  const mx = 40*CHUNK_W+5;
  let my = 60;
  for(let y=0; y<WORLD_H; y++){ if(world.getTile(mx,y)!==T.AIR){ my=y; break; } }
  world.setTile(mx,my,T.BRICK);
  assert.ok(world.chunkVersion(40)>0, 'mutating a chunk pins a version');
  const pristine = world.chunkArray('c40').slice();
  for(let cx=1; cx<=30; cx++) world.ensureChunk(cx);
  const stats1 = world.chunkCacheStats();
  assert.ok(stats1.live<=24, 'live map returns under the cap even with modified chunks present (was impossible pre-fix)');
  assert.ok(world._parked.has('c40'), 'far modified chunk is parked, not held live forever');
  assert.ok(stats1.parked>=1 && stats1.evictRuns>=1, 'parking and evictions are counted in chunkCacheStats');
  assert.ok(world.chunkVersion(40)>0, 'parked chunk keeps its modified version');
  assert.ok(world.modifiedChunkIds().some(id=>id===40), 'parked chunk still reports as modified for saves');
  const liveBefore = world._world.size;
  assert.equal(world.peekTile(mx,my,255), T.BRICK, 'peekTile reads parked chunks (they were always peekable pre-fix)');
  const viaSave = world.chunkArray('c40');
  assert.ok(viaSave && viaSave[my*CHUNK_W+5]===T.BRICK, 'chunkArray decodes parked chunks for the save path');
  assert.equal(world._world.size, liveBefore, 'peek/save reads do not rehydrate parked chunks');
  assert.equal(world.getTile(mx,my), T.BRICK, 'getTile rehydrates a parked chunk on real access');
  assert.equal(world._parked.has('c40'), false, 'rehydrated chunk leaves the cold store');
  assert.ok(world.chunkCacheStats().rehydrated>=1, 'rehydration is counted');
  assert.deepStrictEqual(Array.from(world.chunkArray('c40')), Array.from(pristine), 'park->rehydrate roundtrip is byte-for-byte lossless');

  // incompressible payloads fall back to a raw copy instead of a bloated RLE string
  const noise = new Uint8Array(CHUNK_W*WORLD_H);
  let seed = 1234567;
  for(let i=0;i<noise.length;i++){ seed=(seed*1103515245+12345)>>>0; let b=seed%251; if(b===T.TELEPORTER) b=(b+1)%251; noise[i]=b; }
  assert.equal(world.setChunkArray('c80',noise), true, 'noise chunk installs');
  world.markModifiedChunk(80);
  const noisePristine = world.chunkArray('c80').slice();
  for(let cx=31; cx<=45; cx++) world.ensureChunk(cx);
  assert.ok(world._parked.has('c80'), 'incompressible modified chunk still parks (raw-copy fallback)');
  assert.deepStrictEqual(Array.from(world.chunkArray('c80')), Array.from(noisePristine), 'raw-fallback parking is lossless too');

  // teleporter network discovery scans the LIVE map — those chunks must never park
  world.ensureChunk(60);
  let ty = 60;
  for(let y=0; y<WORLD_H; y++){ if(world.getTile(60*CHUNK_W+2,y)!==T.AIR){ ty=y; break; } }
  world.setTile(60*CHUNK_W+2,ty,T.TELEPORTER);
  for(let cx=46; cx<=70; cx++) world.ensureChunk(cx);
  world._evictFarChunks();
  assert.equal(world._parked.has('c60'), false, 'chunks holding a teleporter never park');
  assert.ok(world._world.has('c60'), 'teleporter chunk stays live for network scans');

  world._setChunkCapForTest(1536);
  delete globalThis.player;
  world.clear();
}

// Source pins: the eviction/parking contract.
assert.match(worldSource, /const revived=rehydrateChunk\(k\);/, 'chunk generation revives parked cold-store copies before regenerating');
assert.match(worldSource, /finally \{ genExit\(\); \}/, 'generation exits through the deferred-eviction gate');
assert.match(worldSource, /if\(genDepth>0\)\{ evictPending=true; return; \}/, 'eviction defers while any generation is in flight (no mid-frame chunk drops)');
assert.match(worldSource, /invalidateViewsFor\(parsed\);\s+\/\/ surgical/, 'eviction invalidates only the dropped chunk section views');
assert.doesNotMatch(worldSource, /sectionViews\.clear\(\); \/\/ cached views may alias deleted chunk arrays/, 'eviction no longer wipes the whole section-view cache');
assert.doesNotMatch(worldSource, /if\(versions\.get\(k\)\) continue;\s+\/\/ modified chunk/, 'modified chunks are no longer exempt from eviction (they park instead)');
assert.match(mainSource, /const arr=live \? worldMap\.get\(ref\.key\) : worldChunkArrayFor\(ref,false\);/, 'incremental autosave reads parked chunks through the parked-aware accessor');
assert.match(mainSource, /if\(ref\.base && live\)\{/, 'autosave audits only touch live chunks (no rehydration churn during saves)');

console.log('world-sections-sim: OK');
