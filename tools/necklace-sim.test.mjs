import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { necklace } = await import('../src/engine/necklace.js');

assert.ok(necklace, 'necklace module exports');

let equippedCharm = null;
let windSpeed = 0;
MM.inventory = {
  equippedId(slot){ return slot === 'charm' && equippedCharm ? equippedCharm.id : null; },
  equippedItem(slot){ return slot === 'charm' ? equippedCharm : null; },
  getItem(id){ return equippedCharm && equippedCharm.id === id ? equippedCharm : null; }
};
MM.wind = {
  speed:()=>windSpeed,
  speedAt:()=>windSpeed
};

function makePlayer(opts={}){
  return {
    x:opts.x ?? 0,
    y:opts.y ?? 50,
    w:0.7,
    h:0.95,
    vx:opts.vx ?? 0,
    vy:opts.vy ?? 0,
    onGround:opts.onGround !== false
  };
}
function runNecklace(player, seconds=1, getTile){
  necklace.init(player);
  const steps=Math.ceil(seconds*60);
  for(let i=0;i<steps;i++){
    player.x += (player.vx||0)/60;
    necklace.update(player,1/60,getTile);
  }
  return {
    points:necklace._points.map(p=>({x:p.x,y:p.y})),
    pendant:Object.assign({}, necklace._pendant())
  };
}

equippedCharm = null;
let p = makePlayer();
assert.equal(necklace.init(p), false, 'necklace does not initialize without an equipped charm');
assert.equal(necklace.active(), false, 'necklace is inactive without a charm');
assert.equal(necklace._points.length, 0, 'necklace has no physics beads without a charm');

equippedCharm = {id:'lucky_charm', kind:'charm', name:'Talizman diamentowy', tier:'rare', visionRadius:12};
p = makePlayer();
assert.equal(necklace.init(p), true, 'necklace initializes when a charm is equipped');
assert.equal(necklace.active(), true, 'necklace is active with an equipped charm');
assert.equal(necklace._points.length, 13, 'necklace creates an articulated bead chain');
const a = necklace._debug.anchors(p);
assert.ok(a.lx < p.x - p.w*0.35 && a.rx > p.x + p.w*0.35, 'chain starts at the hero sides, as if wrapped around the neck');
const idle = runNecklace(p,1);
assert.ok(idle.pendant.y > a.chestY, 'pendant hangs below the upper chest instead of near the eyes');
assert.ok(idle.points.every(pt=>pt.y >= a.guardY-0.001), 'front chain stays below the eye safety line');

p = makePlayer({vx:6});
const moving = runNecklace(p,1);
assert.ok(moving.pendant.x < p.x - 0.18, `running hero leaves pendant lagging behind (${moving.pendant.x.toFixed(2)} vs ${p.x.toFixed(2)})`);
assert.ok(Math.abs(moving.pendant.spin) > 0.4, 'movement tilts the pendant instead of leaving it rigid');

p = makePlayer({vy:-9,onGround:false});
const jumping = runNecklace(p,0.7);
assert.ok(jumping.pendant.y > idle.pendant.y + 0.004, `jumping upward makes the pendant trail downward (${jumping.pendant.y.toFixed(3)} vs ${idle.pendant.y.toFixed(3)})`);

windSpeed = 6.4;
p = makePlayer();
const windRight = runNecklace(p,1);
windSpeed = -6.4;
p = makePlayer();
const windLeft = runNecklace(p,1);
assert.ok(windRight.pendant.x > windLeft.pendant.x + 0.12, `wind pushes the pendant side-to-side (${windRight.pendant.x.toFixed(2)} vs ${windLeft.pendant.x.toFixed(2)})`);
assert.ok(windRight.points.every(pt=>pt.y >= necklace._debug.anchors(p).guardY-0.001), 'wind motion still keeps chain below the eyes');

// Submerged (water tile = 8): wind is muted and the swing heavily damped, matching cape drag
const WATER_TILE = 8;
windSpeed = 6.4;
p = makePlayer();
const submerged = runNecklace(p,1,()=>WATER_TILE);
assert.ok(Math.abs(submerged.pendant.x - p.x) < Math.abs(windRight.pendant.x - p.x)*0.5,
  `underwater wind push is damped (${submerged.pendant.x.toFixed(3)} vs dry ${windRight.pendant.x.toFixed(3)})`);
assert.ok(submerged.points.every(pt=>pt.y >= necklace._debug.anchors(p).guardY-0.001), 'submerged chain stays below the eyes');

// Non-finite wind samples must not poison the verlet state
windSpeed = NaN;
p = makePlayer();
const nanRun = runNecklace(p,0.5);
assert.ok(nanRun.points.every(pt=>isFinite(pt.x) && isFinite(pt.y)), 'NaN wind does not corrupt bead positions');
assert.ok(isFinite(nanRun.pendant.x) && isFinite(nanRun.pendant.y) && isFinite(nanRun.pendant.spin), 'NaN wind does not corrupt the pendant');
windSpeed = 0;

equippedCharm = null;
assert.equal(necklace.update(p,1/60), false, 'unequipping the charm disables necklace physics');
assert.equal(necklace._points.length, 0, 'unequipping clears necklace beads');

equippedCharm = {id:'summer_horn_charm', kind:'charm', name:'Rog letniego zubra', tier:'epic', attackDamage:3};
const pal = necklace._debug.palette(equippedCharm);
assert.equal(pal.chain, '#ffe08a', 'epic charm uses a brighter necklace chain');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ necklace as NECKLACE \} from '\.\/engine\/necklace\.js';/, 'main imports the necklace engine');
assert.match(mainSrc, /function initScarf\(\)\{ CAPE\.init\(player\); if\(NECKLACE && NECKLACE\.init\) NECKLACE\.init\(player\); \}/, 'hero accessory reset initializes necklace with cape');
assert.match(mainSrc, /function updateCape\(dt\)\{ CAPE\.update\(player,dt,getTile,isSolid\); if\(NECKLACE && NECKLACE\.update\) NECKLACE\.update\(player,dt,getTile\); \}/, 'hero accessory tick updates necklace with cape and wind sampling context');
const backDrawIdx = mainSrc.indexOf('if(NECKLACE && NECKLACE.drawBack)');
const outfitIdx = mainSrc.indexOf('MM.drawOutfit(ctx, bodyX, bodyY, bw, bh, style, c)');
const frontDrawIdx = mainSrc.indexOf('if(NECKLACE && NECKLACE.drawFront)');
const eyesIdx = mainSrc.indexOf('// Eyes (for all outfits except ninja/ironperson');
assert.ok(backDrawIdx > 0 && backDrawIdx < outfitIdx, 'back chain draws behind the outfit body');
assert.ok(frontDrawIdx > outfitIdx && frontDrawIdx < eyesIdx, 'front chain draws over the outfit but before the eyes');
assert.ok(!mainSrc.includes('NECKLACE.draw(ctx,TILE,player);'), 'necklace is no longer drawn after eyes');

console.log('necklace-sim: all assertions passed');
