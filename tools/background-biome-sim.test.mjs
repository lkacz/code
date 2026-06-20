// Deterministic background-biome regression test.
// Verifies that the parallax sky palette follows actual worldgen biome ids and
// blends across biome boundaries instead of using unrelated backdrop noise.
// Run: node tools/background-biome-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { background } = await import('../src/engine/background.js');
assert.ok(background && background._debugBiomeBlend, 'background exposes biome debug blend');
assert.ok(background._debugSeasonTint, 'background exposes season tint debug hook');

const palettes = background._debugSkyPalettes;
const pure = (id)=>({
  biomeType(){ return id; },
  cityAt(){ return null; }
});

for(let id=0; id<=8; id++){
  const blend = background._debugBiomeBlend(0,pure(id));
  assert.equal(blend.a,id, 'dominant palette follows pure biome '+id);
  assert.equal(blend.b,id, 'secondary palette matches pure biome '+id);
  assert.equal(blend.t,0, 'pure biome '+id+' does not blend');
  assert.equal(blend.pal.dayTop,palettes[id].dayTop, 'pure biome '+id+' day top matches its palette');
  assert.deepEqual(blend.pal.mount,palettes[id].mount, 'pure biome '+id+' mountain colors match');
}

const boundary = {
  biomeType(x){ return x<0 ? 0 : 3; },
  cityAt(){ return null; }
};
const edge = background._debugBiomeBlend(0,boundary);
assert.equal(edge.a,3, 'boundary dominant side is the local desert biome');
assert.equal(edge.b,0, 'boundary secondary side is the nearby forest biome');
assert.ok(edge.t>0.30 && edge.t<0.48, 'boundary blends without overpowering the dominant biome');
assert.notEqual(edge.pal.dayTop,palettes[3].dayTop, 'boundary palette differs from pure desert');
assert.notEqual(edge.pal.dayTop,palettes[0].dayTop, 'boundary palette differs from pure forest');

const cityNearby = {
  biomeType(){ return 1; },
  cityAt(x){ return {center:0,radius:160}; }
};
const city = background._debugBiomeBlend(0,cityNearby);
assert.equal(city.a,1, 'city influence does not falsify the underlying biome id');
assert.ok(city.city>0.9, 'nearby city influence is strong at city center');
assert.notEqual(city.pal.dayTop,palettes[1].dayTop, 'city influence tints the base biome palette');
assert.equal(city.volcano.amount,0, 'city backdrop does not infer a volcano without volcano metadata');
assert.ok(city.relief<=0.34, 'flat city backdrop damps tall mountain silhouettes');

const realVolcano = {
  biomeType(){ return 7; },
  cityAt(){ return null; },
  volcanoAt(){ return {center:0,radius:24}; },
  nearestVolcano(){ return {center:0,radius:24}; }
};
const volcano = background._debugBiomeBlend(0,realVolcano);
assert.ok(volcano.volcano.amount>0.98, 'real volcano metadata enables volcano background cues');
assert.ok(volcano.relief>0.9, 'real volcano keeps strong distant relief');

const winterTint = background._debugSeasonTint({
  season:'winter', from:'winter', to:'winter', transition:false, blend:1,
  snowStrength:1, leafDropStrength:0, leafGrowStrength:0
});
assert.equal(winterTint.season,'winter', 'season tint reports the active season');
assert.ok(winterTint.alpha>=0.055 && winterTint.alpha<=0.075, 'winter tint is visible but bounded');
const autumnWinterTint = background._debugSeasonTint({
  season:'winter', from:'autumn', to:'winter', transition:true, blend:0.5,
  snowStrength:0.5, leafDropStrength:0.5, leafGrowStrength:0
});
assert.ok(autumnWinterTint.transition, 'season tint preserves transition state');
assert.notEqual(autumnWinterTint.color, winterTint.color, 'transition tint blends between seasons');
assert.ok(autumnWinterTint.alpha>0.035 && autumnWinterTint.alpha<winterTint.alpha, 'transition tint eases in smoothly');

assert.ok(background._debugBiomeBlendCached && background._debugClearBiomeBlendCache, 'background exposes blend cache debug hooks');
let biomeCalls=0, columnCalls=0, volcanoCalls=0;
const cachedWorld = {
  worldSeed:77,
  settings:{seaLevel:62,oceanFrac:0.22,mountainAmp:38,mountainThreshold:0.46,valleyGain:30,detailAmp:1},
  biomeType(){ biomeCalls++; return 1; },
  cityAt(){ return null; },
  volcanoAt(){ volcanoCalls++; return null; },
  nearestVolcano(){ return null; },
  column(){ columnCalls++; return {row:58,biome:1,mountainMask:0.12}; }
};
background._debugClearBiomeBlendCache();
background._debugBiomeBlendCached(10,cachedWorld);
background._debugBiomeBlendCached(11.9,cachedWorld);
assert.equal(background._debugBiomeBlendCacheSize(),2, 'nearby draw positions share the same cached interpolation endpoints');
assert.equal(biomeCalls,18, 'cached background blend samples each interpolation endpoint once');
assert.equal(volcanoCalls,18, 'cached background blend avoids repeated volcano sampling for shared endpoints');
assert.equal(columnCalls,14, 'cached background blend avoids repeated relief sampling for shared endpoints');
background._debugBiomeBlendCached(30,cachedWorld);
assert.equal(background._debugBiomeBlendCacheSize(),4, 'moving far enough computes a second endpoint pair');

assert.ok(background._debugStarPositions && background._debugStarLayerCount, 'background exposes star debug hooks');
const starLayers = background._debugStarLayerCount();
assert.ok(starLayers.dome>=140, 'single sky-dome star layer is populated');
assert.equal(starLayers.near,0, 'near parallax star layer is removed');
const starsHere = background._debugStarPositions(900,500,0.72,0,20).slice(0,30);
const starsFarAway = background._debugStarPositions(900,500,0.72,12000,20).slice(0,30);
assert.deepEqual(starsHere, starsFarAway, 'star field does not shift when the player walks');
const starsLater = background._debugStarPositions(900,500,0.78,0,20).slice(0,30);
assert.notDeepEqual(starsHere, starsLater, 'star field still rotates slowly with celestial time');
const starsBeforeWrap = background._debugStarPositions(900,500,0.999,0,20).slice(0,30);
const starsAfterWrap = background._debugStarPositions(900,500,0.001,0,20).slice(0,30);
const maxWrapJump = starsBeforeWrap.reduce((best,s,i)=>{
  const t=starsAfterWrap[i];
  const d=Math.hypot(s.x-t.x,s.y-t.y);
  return Math.max(best,d);
},0);
assert.ok(maxWrapJump<18, 'star dome rotation is continuous across the day/night cycle wrap');

function gradient(){ return {addColorStop(){}}; }
function makeOffscreenCtx(){
  return {
    fillStyle:'',
    strokeStyle:'',
    lineWidth:1,
    globalAlpha:1,
    save(){},
    restore(){},
    clearRect(){},
    fillRect(){},
    drawImage(){},
    beginPath(){},
    closePath(){},
    moveTo(){},
    lineTo(){},
    arc(){},
    fill(){},
    stroke(){},
    createLinearGradient(){ return gradient(); },
    createRadialGradient(){ return gradient(); }
  };
}
globalThis.document = {
  createElement(){ return {width:0,height:0,getContext(){ return makeOffscreenCtx(); }}; }
};
function makeBackgroundCtx(){
  const calls=[];
  const state=[];
  const ctx={
    calls,
    fillStyle:'',
    strokeStyle:'',
    lineWidth:1,
    globalAlpha:1,
    globalCompositeOperation:'source-over',
    save(){ state.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation}); },
    restore(){ const s=state.pop(); if(!s) return; Object.assign(this,s); },
    fillRect(x,y,w,h){ calls.push(['fillRect',+x.toFixed(3),+y.toFixed(3),+w.toFixed(3),+h.toFixed(3),+this.globalAlpha.toFixed(3)]); },
    drawImage(img,x=0,y=0){ calls.push(['drawImage',+Number(x||0).toFixed(3),+Number(y||0).toFixed(3)]); },
    beginPath(){},
    closePath(){},
    moveTo(){},
    lineTo(){},
    arc(){},
    ellipse(x,y,rx,ry){ calls.push(['ellipse',+x.toFixed(3),+y.toFixed(3),+rx.toFixed(3),+ry.toFixed(3),+this.globalAlpha.toFixed(3)]); },
    fill(){},
    stroke(){},
    createLinearGradient(){ return gradient(); },
    createRadialGradient(){ return gradient(); },
    canvas:{width:900,height:500}
  };
  return ctx;
}

const oldSeasonApi = globalThis.MM.seasons;
const oldTintOverrideActive = globalThis.__timeOverrideActive;
const oldTintOverrideValue = globalThis.__timeOverrideValue;
const oldTintNow = globalThis.performance.now;
globalThis.MM.seasons = {
  metrics(){ return {
    season:'winter', from:'winter', to:'winter', transition:false, blend:1,
    snowStrength:1, leafDropStrength:0, leafGrowStrength:0
  }; }
};
globalThis.__timeOverrideActive = true;
globalThis.__timeOverrideValue = 0.25;
globalThis.performance.now = ()=>2345678;
background.draw(makeBackgroundCtx(),320,180,0,20,pure(1));
const tintCtx = makeBackgroundCtx();
background.applyTint(tintCtx,320,180);
const seasonTintFills = tintCtx.calls.filter(c=>c[0]==='fillRect' && c[3]===320 && c[4]===180 && c[5]>=0.055 && c[5]<=0.075);
assert.equal(seasonTintFills.length,1, 'applyTint adds one screen-space seasonal atmosphere fill');
globalThis.MM.seasons = oldSeasonApi;
globalThis.performance.now = oldTintNow;
globalThis.__timeOverrideActive = oldTintOverrideActive;
globalThis.__timeOverrideValue = oldTintOverrideValue;

const oldTimeOverrideActive = globalThis.__timeOverrideActive;
const oldTimeOverrideValue = globalThis.__timeOverrideValue;
const oldNow = globalThis.performance.now;
globalThis.__timeOverrideActive = true;
globalThis.__timeOverrideValue = 0.72;
globalThis.performance.now = ()=>1234567;
const drawCtxA = makeBackgroundCtx();
const drawCtxB = makeBackgroundCtx();
background.draw(drawCtxA,900,500,0,20,pure(1));
background.draw(drawCtxB,900,500,12000,20,pure(1));
const smallStarsA = drawCtxA.calls.filter(c=>c[0]==='fillRect' && c[3]<=2 && c[4]<=2);
const smallStarsB = drawCtxB.calls.filter(c=>c[0]==='fillRect' && c[3]<=2 && c[4]<=2);
assert.ok(smallStarsA.length>60, 'actual draw emits visible sky-dome stars at night');
assert.deepEqual(smallStarsA, smallStarsB, 'actual star draw does not shift with player position');
const fractionalParallaxCtx = makeBackgroundCtx();
const oldDpr = globalThis.devicePixelRatio;
globalThis.devicePixelRatio = 2;
background.draw(fractionalParallaxCtx,900,500,0.13,20,pure(7));
globalThis.devicePixelRatio = oldDpr;
const parallaxImages = fractionalParallaxCtx.calls.filter(c=>c[0]==='drawImage');
assert.ok(parallaxImages.every(c=>Math.abs(c[1]*2-Math.round(c[1]*2))<0.001), 'mountain parallax repeats snap to device pixels');
assert.ok(parallaxImages.some(c=>Math.abs(c[1]-Math.round(c[1]))>0.001), 'high-DPI mountain parallax can still move in sub-CSS-pixel increments');
const volcanoDrawCtx = makeBackgroundCtx();
background.draw(volcanoDrawCtx,900,500,0,20,realVolcano);
const volcanoEllipses = volcanoDrawCtx.calls.filter(c=>c[0]==='ellipse');
const volcanoSmokePuffs = volcanoEllipses.filter(c=>Math.abs(c[1]-450)<180 && c[2]<250 && c[4]>12);
assert.equal(volcanoSmokePuffs.length,0, 'background volcano cue does not draw detached parallax smoke puffs');
globalThis.performance.now = oldNow;
globalThis.__timeOverrideActive = oldTimeOverrideActive;
globalThis.__timeOverrideValue = oldTimeOverrideValue;

console.log('background-biome-sim: all assertions passed');
