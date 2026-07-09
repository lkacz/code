import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const {
  HOUSE_HEAL_RATE_MIN_FRAC,
  HOUSE_HEAL_RATE_MAX_FRAC,
  HOUSE_HEAL_RATE_MIN_SIZE,
  HOUSE_HEAL_RATE_FULL_SIZE,
  HOUSE_CHAIR_COMFORT_BONUS,
  HOUSE_CHAIR_COMFORT_MAX_CHAIRS,
  analyzeHouseAt,
  createHouseHealingState,
  houseComfortMult,
  houseHealRateFrac,
  houseHealRateFracForSize,
  updateHouseHealing
} = await import('../src/engine/house_healing.js');

function makeWorld(){
  const tiles = new Map();
  const bg = new Map();
  const k = (x,y) => x+','+y;
  return {
    set(x,y,t){ tiles.set(k(x,y),t); },
    setBg(x,y,t){ bg.set(k(x,y),t); },
    get(x,y){ return tiles.has(k(x,y)) ? tiles.get(k(x,y)) : T.AIR; },
    bg(x,y){ return bg.has(k(x,y)) ? bg.get(k(x,y)) : T.AIR; }
  };
}

function buildRectHouse(w,width=5,height=4,{light=T.TORCH, burningCoal=false, useBackground=true}={}){
  for(let x=0; x<width; x++){ w.set(x,0,T.WOOD); w.set(x,height-1,T.WOOD); }
  for(let y=1; y<height-1; y++){ w.set(0,y,T.WOOD); w.set(width-1,y,T.WOOD); }
  if(height>=3) w.set(0,height-2,T.WOOD_DOOR);
  if(width>=3) w.set(Math.floor(width/2),0,T.WOOD_TRAPDOOR);
  for(let x=1; x<width-1; x++){
    for(let y=1; y<height-1; y++){
      w.set(x,y,T.AIR);
      if(useBackground) w.setBg(x,y,T.BRICK);
    }
  }
  const lx=Math.floor(width/2), ly=Math.max(1,Math.floor(height/2)-1);
  if(light) w.set(lx,ly,light);
  if(burningCoal){ w.set(lx,height-1,T.COAL); w.set(lx,ly,T.AIR); }
}

function buildHouse(w,opts={}){
  buildRectHouse(w,5,4,opts);
}

function buildShapeHouse(w,interior,{lightAt=interior[0],useBackground=true}={}){
  const inside = new Set(interior.map(([x,y])=>x+','+y));
  for(const [x,y] of interior){
    w.set(x,y,T.AIR);
    if(useBackground) w.setBg(x,y,T.BRICK);
  }
  if(lightAt) w.set(lightAt[0],lightAt[1],T.TORCH);
  for(const [x,y] of interior){
    for(let dy=-1; dy<=1; dy++){
      for(let dx=-1; dx<=1; dx++){
        const tx=x+dx, ty=y+dy;
        if(inside.has(tx+','+ty)) continue;
        w.set(tx,ty,T.WOOD);
      }
    }
  }
}

const hero = {x:2.2,y:1.8,w:0.7,h:0.95,hp:50,maxHp:200};

{
  const w = makeWorld();
  buildHouse(w);
  const res = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,true,'wood house with a torch qualifies as a healing house');
  assert.equal(res.lit,true,'torch inside marks the house as lit');
  assert.equal(res.built,true,'door/trapdoor/wood shell marks the room as built');
  assert.equal(res.totalCells,20,'a 5x4 house reports its total footprint cells');
  assert.ok(res.healRateFrac>HOUSE_HEAL_RATE_MIN_FRAC && res.healRateFrac<HOUSE_HEAL_RATE_MAX_FRAC,'medium-small houses heal between the tiny and large limits');
}

{
  assert.equal(houseHealRateFracForSize(HOUSE_HEAL_RATE_MIN_SIZE),HOUSE_HEAL_RATE_MIN_FRAC,'minimum-sized houses heal at 0.1% of max health per second');
  assert.equal(houseHealRateFracForSize(HOUSE_HEAL_RATE_FULL_SIZE),HOUSE_HEAL_RATE_MAX_FRAC,'100-cell houses heal at 1% of max health per second');
  assert.equal(houseHealRateFracForSize(1000),HOUSE_HEAL_RATE_MAX_FRAC,'oversized valid houses clamp to the max healing rate');
}

{
  const w = makeWorld();
  buildRectHouse(w,3,3);
  const tinyHero = {x:1.2,y:1.2,w:0.7,h:0.95,hp:10,maxHp:100};
  const res = analyzeHouseAt(tinyHero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,true,'a 3x3 built lit shelter qualifies as the tiniest healing house');
  assert.equal(res.totalCells,9,'the tiniest house counts as a 3x3 footprint');
  assert.equal(houseHealRateFrac(res),HOUSE_HEAL_RATE_MIN_FRAC,'the tiniest house heals at the minimum rate');
}

{
  const w = makeWorld();
  buildRectHouse(w,10,10);
  const largeHero = {x:5.2,y:5.2,w:0.7,h:0.95,hp:10,maxHp:100};
  const res = analyzeHouseAt(largeHero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,true,'a 10x10 built lit house qualifies as a large healing house');
  assert.equal(res.totalCells,100,'a 10x10 house counts as 100 total cells including walls');
  assert.equal(houseHealRateFrac(res),HOUSE_HEAL_RATE_MAX_FRAC,'a 100-cell house heals at the maximum rate');
}

{
  const w = makeWorld();
  buildShapeHouse(w,[[1,1],[2,1],[3,1],[1,2],[1,3]]);
  const shapedHero = {x:1.2,y:1.2,w:0.7,h:0.95,hp:10,maxHp:100};
  const res = analyzeHouseAt(shapedHero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,true,'an L-shaped sealed lit room still qualifies');
  assert.ok(res.totalCells<res.footprintCells,'irregular houses count actual interior plus seal cells, not a padded bounding box');
}

{
  const w = makeWorld();
  buildHouse(w,{useBackground:false});
  const res = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,false,'sealed lit houses still need constructed background coverage');
  assert.equal(res.reason,'no_background','missing background reports the no_background reason');
}

{
  const w = makeWorld();
  buildHouse(w);
  w.setBg(2,1,T.AIR);
  const res = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,false,'the light-source tile must still have constructed background coverage');
  assert.equal(res.reason,'no_background','missing background behind a torch reports the no_background reason');
}

{
  const w = makeWorld();
  buildHouse(w,{light:null,burningCoal:true});
  const res = analyzeHouseAt(hero,w.get,{
    backgroundAt:w.bg,
    isBurning:(x,y)=>x===2 && y===3
  });
  assert.equal(res.ok,true,'burning coal in the shell counts as an indoor light source');
}

{
  const w = makeWorld();
  buildHouse(w,{light:null});
  const res = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,false,'sealed houses still need an indoor light source');
  assert.equal(res.reason,'dark','unlit sealed houses report the dark reason');
}

{
  const w = makeWorld();
  buildHouse(w,{light:null});
  w.set(0,0,T.TORCH);
  const res = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,false,'a diagonal exterior light source does not count as indoor lighting');
  assert.equal(res.reason,'dark','outside corner light keeps the sealed room dark');
}

{
  const w = makeWorld();
  buildHouse(w);
  w.set(2,0,T.AIR);
  const res = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,false,'a missing roof tile breaks house coverage');
  assert.ok(res.reason==='open' || res.reason==='too_large','open roofs are treated as outside exposure');
}

{
  const w = makeWorld();
  for(let x=0; x<=4; x++){ w.set(x,0,T.STONE); w.set(x,3,T.STONE); }
  for(let y=1; y<=2; y++){ w.set(0,y,T.STONE); w.set(4,y,T.STONE); }
  for(let x=1; x<=3; x++){
    for(let y=1; y<=2; y++){
      w.set(x,y,T.AIR);
      w.setBg(x,y,T.BRICK);
    }
  }
  w.set(2,1,T.TORCH);
  const res = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,true,'construction backwall can prove an all-stone room is a built house');
}

{
  const w = makeWorld();
  const built = new Set();
  const mark = (x,y,t)=>{ w.set(x,y,t); built.add(x+','+y); };
  for(let x=0; x<=4; x++){ mark(x,0,T.STONE); mark(x,3,T.STONE); }
  for(let y=1; y<=2; y++){ mark(0,y,T.STONE); mark(4,y,T.STONE); }
  for(let x=1; x<=3; x++) for(let y=1; y<=2; y++) w.set(x,y,T.AIR);
  w.set(2,1,T.TORCH);
  const res = analyzeHouseAt(hero,w.get,{isBuiltAt:(x,y)=>built.has(x+','+y)});
  assert.equal(res.ok,false,'player-built foreground stone shell still needs construction backwall');
  assert.equal(res.reason,'no_background','background coverage is intentionally required');
}

{
  const w = makeWorld();
  buildHouse(w);
  const doorwayHero = {...hero, x:0.5, y:2.0};
  const res = analyzeHouseAt(doorwayHero,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,true,'standing in a door tile still counts as inside the sealed lit house');
}

// Chairs are ordinary furniture: placed inside a shelter they never break the
// seal, count as a built signal, and add resting comfort to the heal rate.
{
  const w = makeWorld();
  buildHouse(w);
  const bare = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(bare.ok,true,'baseline shelter is valid before furnishing');
  assert.equal(bare.chairs,0,'an unfurnished shelter reports zero chairs');
  w.set(1,2,T.CHAIR_WOOD);
  const furnished = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(furnished.ok,true,'a chair inside the room is furniture, not a seal breaker');
  assert.equal(furnished.chairs,1,'the shelter counts its chair');
  assert.equal(furnished.healRateFrac,bare.healRateFrac*houseComfortMult(1),'one chair speeds healing by the comfort bonus');
  assert.equal(houseComfortMult(1),1+HOUSE_CHAIR_COMFORT_BONUS,'one chair applies the configured comfort bonus');
  w.set(3,2,T.CHAIR_STEEL);
  const twoChairs = analyzeHouseAt(hero,w.get,{backgroundAt:w.bg});
  assert.equal(twoChairs.chairs,2,'each chair material counts the same as furniture');
  assert.equal(twoChairs.healRateFrac,bare.healRateFrac*houseComfortMult(2),'a second chair stacks comfort once more');
  assert.equal(houseComfortMult(HOUSE_CHAIR_COMFORT_MAX_CHAIRS+3),houseComfortMult(HOUSE_CHAIR_COMFORT_MAX_CHAIRS),'comfort stops stacking past the chair cap');
  const p = {...hero, hp:50, maxHp:200};
  const st = createHouseHealingState();
  const res = updateHouseHealing(st,1,p,w.get,{backgroundAt:w.bg});
  assert.equal(res.inside,true,'furnished shelter still heals');
  assert.equal(p.hp,50 + p.maxHp*twoChairs.healRateFrac,'healing ticks at the comfort-boosted rate');
}

// A chair alone in the open is just furniture — no shelter, no healing.
{
  const w = makeWorld();
  w.set(10,10,T.CHAIR_WOOD);
  const camper = {x:10.5,y:10.3,w:0.7,h:0.95,hp:10,maxHp:100};
  const res = analyzeHouseAt(camper,w.get,{backgroundAt:w.bg});
  assert.equal(res.ok,false,'sitting on a chair under the open sky is not a healing shelter');
}

{
  const w = makeWorld();
  buildHouse(w);
  const p = {...hero, hp:50, maxHp:200};
  const st = createHouseHealingState();
  const res = updateHouseHealing(st,1,p,w.get,{backgroundAt:w.bg});
  assert.equal(res.inside,true,'healing update recognizes the valid house');
  assert.equal(res.entered,true,'first valid scan reports entering a healing house');
  assert.equal(res.healRateFrac,houseHealRateFrac(res.status),'healing update exposes the active size-scaled rate');
  assert.equal(p.hp,50 + p.maxHp*res.healRateFrac,'house healing restores the size-scaled fraction of max HP per second');
  p.hp=p.maxHp-0.2;
  updateHouseHealing(st,1,p,w.get,{backgroundAt:w.bg});
  assert.equal(p.hp,p.maxHp,'house healing clamps at max HP');
  w.set(2,0,T.AIR);
  const broken = updateHouseHealing(st,1,p,w.get,{backgroundAt:w.bg});
  assert.equal(broken.inside,false,'breaking the shelter stops home healing');
  assert.equal(broken.exited,true,'broken shelter reports exiting the healing-home state');
}

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSource, /import \{ houseHealing as HOUSE_HEALING \} from '\.\/engine\/house_healing\.js';/, 'main imports the house healing system');
assert.match(mainSource, /HOUSE_HEALING\.update\(houseHealingState,dt,player,getTile,\{[\s\S]*backgroundAt:getConstructionBackgroundTile[\s\S]*\}\)/, 'main evaluates house healing with foreground tiles and construction backwalls');
assert.match(mainSource, /notifyInvasionHeroAction\('hero_heal',\{amount:res\.report,source:'house'\}\)/, 'reported passive house healing is routed through hero heal notifications');
assert.match(mainSource, /if\(res && res\.entered && res\.status && res\.status\.ok\)[\s\S]*registerHealingShelterStatus\(res\.status\)/, 'entering a valid healing house registers it as a home respawn candidate');
assert.match(mainSource, /if\(res && res\.exited\)[\s\S]*validateHealingShelters\(\{changed:\{x:Math\.floor\(player\.x\),y:Math\.floor\(player\.y\)\},signal:true\}\)/, 'leaving a broken healing house revalidates remembered homes for broken-heart feedback');
assert.match(mainSource, /updateHouseHealing\(dt\);[\s\S]*if\(MEAT && MEAT\.update\)/, 'game step ticks house healing before later world systems');

console.log('house-healing-sim: all assertions passed');
