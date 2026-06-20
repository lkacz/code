import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, INFO } = await import('../src/constants.js');
const { cape } = await import('../src/engine/cape.js');
const { wind } = await import('../src/engine/wind.js');

MM.wind = wind;
MM.customization = {capeStyle:'classic', capeColor:'#b91818'};

const solid = t => t !== T.AIR && !(INFO[t] && INFO[t].passable);
const openTile = (x,y)=> y>=90 ? T.STONE : T.AIR;
const waterTile = (x,y)=> {
  if(y>=90) return T.STONE;
  if(y>=49 && y<=53) return T.WATER;
  return T.AIR;
};
const wallTile = (x,y)=> {
  if(y>=90) return T.STONE;
  if(x<=-1 && y>=49 && y<=58) return T.STONE;
  return T.AIR;
};

function makePlayer(opts={}){
  return {
    x:0,
    y:50,
    w:0.7,
    h:0.95,
    vx:opts.vx||0,
    vy:opts.vy||0,
    facing:opts.facing==null ? 1 : opts.facing,
    onGround:opts.onGround!==false
  };
}
function settle(player, windSpeed=0, getTile=openTile, seconds=2.2){
  wind.reset();
  wind.setOverride(windSpeed);
  cape.init(player);
  const steps=Math.ceil(seconds*60);
  for(let i=0; i<steps; i++) cape.update(player,1/60,getTile,solid);
  const tail=cape._segments[cape._segments.length-1];
  const mid=cape._segments[Math.floor(cape._segments.length/2)];
  return {tail:{x:tail.x,y:tail.y}, mid:{x:mid.x,y:mid.y}, all:cape._segments.map(s=>({x:s.x,y:s.y}))};
}

let p=makePlayer({facing:1});
const idle=settle(p,0);
assert.ok(idle.tail.x < p.x-0.08, 'idle cape hangs behind the facing direction');
assert.ok(idle.tail.y > p.y-0.1, 'idle cape droops below the shoulder anchor');

p=makePlayer({facing:1});
const forwardWind=settle(p,5.0);
p=makePlayer({facing:1});
const backWind=settle(p,-5.0);
assert.ok(forwardWind.tail.x > idle.tail.x+0.22, 'tail moves with strong wind blowing forward');
assert.ok(backWind.tail.x < idle.tail.x-0.12, 'tail streams farther backward in opposite wind');
assert.ok(forwardWind.tail.x > backWind.tail.x+0.35, 'cape direction follows wind sign');

p=makePlayer({facing:1,vx:5,onGround:true});
const runningRight=settle(p,0);
p=makePlayer({facing:1,vx:-5,onGround:true});
const runningLeft=settle(p,0);
assert.ok(runningRight.tail.x < idle.tail.x-0.06, 'running right pulls the cape farther left');
assert.ok(runningLeft.tail.x > idle.tail.x+0.06, 'running left can trail the cape to the right even while facing right');

p=makePlayer({facing:1,vy:-9,onGround:false});
const jumping=settle(p,0);
p=makePlayer({facing:1,vy:9,onGround:false});
const falling=settle(p,0);
assert.ok(jumping.tail.y > falling.tail.y+0.06, 'jumping upward leaves the cape lower than falling');

p=makePlayer({facing:1});
const openStrong=settle(p,5.0,openTile);
p=makePlayer({facing:1});
const submergedStrong=settle(p,5.0,waterTile);
assert.ok(Math.abs(submergedStrong.tail.x-idle.tail.x) < Math.abs(openStrong.tail.x-idle.tail.x)*0.55, 'water damps wind response');

p=makePlayer({facing:1});
const blocked=settle(p,-5.0,wallTile);
assert.ok(blocked.all.every(s=>s.x>-1.05), 'cape collision keeps segments out of the stone wall');

wind.reset();
console.log('cape-sim: all assertions passed');
