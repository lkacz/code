// Cloud rendering regression: ordinary clouds should not project moving terrain
// overlays. The old rectangular shadow strips looked like transparent water.
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
const spriteCalls=[];

const { T, WORLD_H, TILE } = await import('../src/constants.js');
Object.assign(globalThis.MM, { T, WORLD_H, TILE });

function gradient(){ return {addColorStop(){}}; }
function makeSpriteCtx(){
  return {
    fillStyle:'',
    globalCompositeOperation:'source-over',
    save(){},
    restore(){},
    translate(){},
    scale(){},
    clearRect(){},
    fillRect(){},
    beginPath(){},
    arc(){},
    fill(){},
    createRadialGradient(x0,y0,r0,x1,y1,r1){ spriteCalls.push(['radialGradient',x0,y0,r0,x1,y1,r1]); return gradient(); },
    createLinearGradient(){ return gradient(); }
  };
}
globalThis.document = {
  createElement(){ return {width:0, height:0, getContext(){ return makeSpriteCtx(); }}; }
};

const { clouds } = await import('../src/engine/clouds.js');
assert.ok(clouds, 'cloud module exports');

MM.worldGen = {
  settings:{seaLevel:62},
  surfaceHeight(){ return 12; },
  temperature(){ return 0.8; },
  worldSeed:123
};

clouds.reset();
clouds.config.CLOUD_VISUAL_X = 4;
clouds.config.CLOUD_SHADOWS = false;
clouds.setWindOverride(0);
clouds.setCycleOverride({isDay:true,tDay:0.5,cycleT:0.25});
clouds.addCloud(0,6,28);

const calls=[];
const ctx={
  fillStyle:'',
  shadowBlur:0,
  shadowColor:'',
  globalAlpha:1,
  globalCompositeOperation:'source-over',
  lineJoin:'',
  lineCap:'',
  lineWidth:1,
  strokeStyle:'',
  save(){ calls.push(['save']); },
  restore(){ calls.push(['restore']); },
  fillRect(x,y,w,h){ calls.push(['fillRect',x,y,w,h]); },
  drawImage(){ calls.push(['drawImage']); },
  beginPath(){ calls.push(['beginPath']); },
  ellipse(x,y,rx,ry){ calls.push(['ellipse',x,y,rx,ry]); },
  arc(){ calls.push(['arc']); },
  fill(){ calls.push(['fill']); },
  stroke(){ calls.push(['stroke', this.strokeStyle, this.lineWidth, this.shadowColor, this.shadowBlur]); },
  moveTo(){},
  lineTo(){},
  createRadialGradient(){ calls.push(['radialGradient']); return gradient(); },
  createLinearGradient(){ return gradient(); }
};

const getTile=()=>T.AIR;
clouds.draw(ctx,TILE,getTile,-30,0,60,30);

const stripCalls=calls.filter(c=>c[0]==='fillRect' && Math.abs(c[4]-TILE*0.85)<0.001 && Math.abs(c[3]-TILE*2)<0.001);
assert.equal(stripCalls.length, 0, 'cloud shadows are not rectangular surface strips');
assert.equal(calls.some(c=>c[0]==='ellipse'), false, 'ordinary cloud rendering draws no projected terrain shadow');

clouds.reset();
clouds.config.CLOUD_VISUAL_X = 4;
clouds.config.CLOUD_SHADOWS = false;
clouds.setWindOverride(0);
clouds.setCycleOverride({isDay:true,tDay:0.5,cycleT:0.25});
MM.atomicWinter = { isActive(){ return true; }, toxicRainAt(){ return true; } };
const atomicCloud = clouds.addCloud(0,6,80);
atomicCloud.atomic = true;
atomicCloud.toxic = true;
atomicCloud.raining = true;
const setTile=()=>{};
for(let i=0;i<90;i++) clouds.update(getTile,setTile,1/30);
calls.length=0;
spriteCalls.length=0;
clouds.draw(ctx,TILE,getTile,-30,0,60,30);
assert.equal(spriteCalls.some(c=>c[0]==='radialGradient' && c[6]>TILE*35), false, 'atomic cloud sprite does not paint an oversized green background glow');
assert.ok(calls.some(c=>c[0]==='stroke' && String(c[1]).includes('178,255,82')), 'atomic rain draws a bright radioactive green core stroke');
assert.ok(calls.some(c=>c[0]==='stroke' && String(c[3]).includes('112,255,70')), 'atomic rain draws a soft green glow stroke');
delete MM.atomicWinter;

clouds.reset();
clouds.config.CLOUD_SHADOWS = false;
console.log('cloud-shadow-render-sim: all assertions passed');
