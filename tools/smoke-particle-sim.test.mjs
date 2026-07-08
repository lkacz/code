// Smoke particle behavior test: plumes rise high, expand, and draw through cached sprites.
// Run: node tools/smoke-particle-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = { TILE:20 };
let audioStarts=0;
globalThis.AudioContext = class {
  constructor(){ this.currentTime=0; this.destination={}; }
  createOscillator(){
    return {
      type:'triangle',
      frequency:{ setValueAtTime(){}, linearRampToValueAtTime(){} },
      connect(){},
      start(){ audioStarts++; },
      stop(){}
    };
  }
  createGain(){
    return {
      gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} },
      connect(){}
    };
  }
};

function makeCtx(){
  const calls=[];
  return {
    calls,
    fillStyle:'',
    strokeStyle:'',
    globalAlpha:1,
    globalCompositeOperation:'source-over',
    save(){ calls.push('save'); },
    restore(){ calls.push('restore'); },
    translate(){ calls.push('translate'); },
    rotate(){ calls.push('rotate'); },
    beginPath(){ calls.push('beginPath'); },
    moveTo(){ calls.push('moveTo'); },
    lineTo(){ calls.push('lineTo'); },
    arc(){ calls.push('arc'); },
    fill(){ calls.push('fill'); },
    stroke(){ calls.push('stroke'); },
    fillRect(){ calls.push('fillRect'); },
    drawImage(){ calls.push('drawImage'); },
    createRadialGradient(){ return { addColorStop(){} }; },
    canvas:{width:800,height:600}
  };
}
function countCalls(ctx,name){
  return ctx.calls.filter(c=>c===name).length;
}

globalThis.document = {
  createElement(){ return {width:0, height:0, getContext(){ return makeCtx(); }}; }
};

const { T: PT, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { particles } = await import('../src/engine/particles.js');
assert.ok(particles, 'particles module exports');

const realRandom=Math.random;
Math.random=()=>0.5;
try{
  particles.reset();
  particles.spawnBurst(40,40,'common');
  assert.equal(audioStarts,0, 'generic visual burst does not play chest audio');
  particles.spawnBurst(40,40,'rare',{sound:true});
  assert.equal(audioStarts,1, 'burst sound is opt-in for explicit chest-like use');
  particles.reset();
  particles.spawnSmoke(100,100,4,{tileSize:20,tileX:5,tileY:5});
  const before=particles._debugSnapshot().filter(p=>p.kind==='smoke');
  assert.ok(before.length>=4, 'strong smoke source emits a small plume batch');
  const first=before[0];
  assert.ok(first.max>=4.5, 'smoke lifetime is long enough for a tall plume');
  particles.update(2.0,20);
  const after=particles._debugSnapshot().filter(p=>p.kind==='smoke');
  assert.equal(after.length,before.length, 'smoke is still alive after two seconds');
  assert.ok(after[0].y < first.y - 55, 'smoke rises much higher than the old short puff');
  assert.ok(after[0].r > first.r + 25, 'smoke expands into a broad plume');
  const ctx=makeCtx();
  particles.draw(ctx,()=>true,20);
  assert.ok(ctx.calls.includes('drawImage'), 'smoke uses cached sprite draw calls');
  assert.ok(particles.metrics().smokeSprites>0, 'smoke sprite cache is populated');

  particles.reset();
  globalThis.__mmFrameMs=16;
  for(let i=0;i<90;i++){
    particles.spawnSmoke(100+(i%6),100,4,{tileSize:20,tileX:5+(i%6),tileY:5});
  }
  particles.update(0.25,20);
  const fullPlumeSmoke=particles.metrics().smoke;
  assert.ok(fullPlumeSmoke>=300, 'test builds a dense coal-like smoke plume');
  const normalCtx=makeCtx();
  particles.draw(normalCtx,()=>true,20);
  const normalDraws=countCalls(normalCtx,'drawImage');
  assert.ok(normalDraws>=fullPlumeSmoke*0.9, 'normal high-density smoke draws continuously, not every other puff');

  globalThis.__mmFrameMs=45;
  particles.update(0.016,20);
  const afterSpikeSmoke=particles.metrics().smoke;
  assert.ok(afterSpikeSmoke>=fullPlumeSmoke*0.95, 'one slow frame does not trim away the visible smoke plume');
  const stressedCtx=makeCtx();
  particles.draw(stressedCtx,()=>true,20);
  const stressedDraws=countCalls(stressedCtx,'drawImage');
  assert.ok(stressedDraws>=afterSpikeSmoke*0.75, 'stressed smoke fades rather than flickering by sparse draw skipping');
  assert.ok(particles.metrics().smokeAlphaScale<1, 'stress still soft-throttles smoke opacity');

  particles.reset();
  globalThis.__mmFrameMs=16;
  globalThis.MM.wind = { speedAt(){ return 5; }, speed(){ return 5; } };
  particles.spawnSmoke(100,100,4,{tileSize:20,tileX:5,tileY:5});
  let windBefore=particles._debugSnapshot().find(p=>p.kind==='smoke');
  particles.update(1.0,20,()=>0);
  let windAfter=particles._debugSnapshot().find(p=>p.kind==='smoke');
  assert.ok(windAfter.x > windBefore.x + 10, 'smoke plume drifts clearly with exposed positive wind');

  particles.reset();
  particles.spawnSplash(100,100,1);
  windBefore=particles._debugSnapshot().find(p=>p.kind==='splash');
  particles.update(0.45,20,()=>0);
  windAfter=particles._debugSnapshot().find(p=>p.kind==='splash');
  assert.ok(windAfter.x > windBefore.x + 2, 'water splash droplets are lightly carried by wind');
  delete globalThis.MM.wind;

  particles.reset();
  assert.equal(typeof particles._debugAdd, 'function', 'particle tests can inject deterministic particles');
  const floorGetTile=(x,y)=> y>=3 ? PT.STONE : PT.AIR;
  particles._debugAdd({kind:'spark',x:42,y:42,vx:0,vy:14,life:0,max:2,tier:'common',size:3});
  for(let i=0;i<10;i++) particles.update(1/30,20,floorGetTile);
  let collided=particles._debugSnapshot()[0];
  assert.ok(collided.y <= 60 - 1.1, 'physical particles collide with solid floors');
  assert.ok(collided.vy <= 0.2 || collided.onGround, 'floor collision kills or reverses downward particle velocity');

  particles.reset();
  const skyFloorY=Math.max(WORLD_MIN_Y+8, -12);
  const skyFloorGetTile=(x,y)=> y===skyFloorY ? PT.STONE : PT.AIR;
  particles._debugAdd({kind:'spark',x:42,y:(skyFloorY-2)*20+2,vx:0,vy:14,life:0,max:2,tier:'common',size:3});
  for(let i=0;i<12;i++) particles.update(1/30,20,skyFloorGetTile);
  collided=particles._debugSnapshot()[0];
  assert.ok(collided.y <= skyFloorY*20 - 1.1, 'physical particles collide with solid sky-section floors');
  assert.ok(collided.vy <= 0.2 || collided.onGround, 'sky-section floor collision kills or reverses downward particle velocity');

  particles.reset();
  const deepFloorY=Math.min(WORLD_MAX_Y-8, WORLD_H+12);
  const deepFloorGetTile=(x,y)=> y===deepFloorY ? PT.STONE : PT.AIR;
  particles._debugAdd({kind:'spark',x:42,y:(deepFloorY-2)*20+2,vx:0,vy:14,life:0,max:2,tier:'common',size:3});
  for(let i=0;i<12;i++) particles.update(1/30,20,deepFloorGetTile);
  collided=particles._debugSnapshot()[0];
  assert.ok(collided.y <= deepFloorY*20 - 1.1, 'physical particles collide with solid deep-section floors');
  assert.ok(collided.vy <= 0.2 || collided.onGround, 'deep-section floor collision kills or reverses downward particle velocity');

  particles.reset();
  const wallGetTile=(x,y)=> x>=3 ? PT.STONE : PT.AIR;
  particles._debugAdd({kind:'glass',x:42,y:42,vx:16,vy:0,life:0,max:2,size:4});
  for(let i=0;i<6;i++) particles.update(1/30,20,wallGetTile);
  collided=particles._debugSnapshot()[0];
  assert.ok(collided.x <= 60 - 1.2, 'physical particles collide with solid walls');
  assert.ok(collided.vx <= 0, 'wall collision reflects particle velocity');

  particles.reset();
  particles.spawnImpactChips(80,70,{element:'fire',major:true,power:1.25,dir:1});
  const chips=particles._debugSnapshot().filter(p=>p.kind==='impactChip');
  assert.ok(chips.length>=8, 'important combat impacts emit physical chips');
  assert.ok(chips.every(p=>Array.isArray(p.rgb) && p.size>0), 'impact chips carry material color and size');
  const chipBefore=chips[0];
  particles.update(0.12,20,()=>PT.AIR);
  const chipAfter=particles._debugSnapshot().find(p=>p.kind==='impactChip');
  assert.ok(chipAfter && Math.hypot(chipAfter.x-chipBefore.x, chipAfter.y-chipBefore.y)>0.5, 'impact chips fly under physical integration');
  const chipCtx=makeCtx();
  particles.draw(chipCtx,()=>true,20);
  assert.ok(chipCtx.calls.includes('rotate') && chipCtx.calls.includes('fillRect'), 'impact chips draw as rotated falling debris');

  particles.reset();
  particles._debugAdd({kind:'impactChip',x:42,y:42,vx:0,vy:14,life:0,max:2,size:4,rgb:[255,205,86]});
  for(let i=0;i<10;i++) particles.update(1/30,20,floorGetTile);
  collided=particles._debugSnapshot()[0];
  assert.ok(collided.y <= 60 - 1.1, 'impact chips collide with solid floors');
  assert.ok(collided.vy <= 0.2 || collided.onGround, 'impact chips lose or reverse downward velocity on floor impact');

  particles.reset();
  particles.spawnEnergyAbsorb(20,20,60,30,1);
  assert.ok(particles.count()>0, 'energy absorption emits a small particle batch');
  particles.update(0.08,20);
  const energyCtx=makeCtx();
  particles.draw(energyCtx,()=>true,20);
  assert.ok(energyCtx.calls.includes('lineTo') && energyCtx.calls.includes('stroke'), 'energy absorption draws electric streaks');

  particles.reset();
  particles.spawnEnergyAbsorb(20,20,60,30,1,{quick:true,hue:'gold'});
  const quickEnergy=particles._debugSnapshot().filter(p=>p.kind==='energy');
  assert.ok(quickEnergy.length>0, 'quick energy absorption still emits particles');
  assert.ok(quickEnergy.every(p=>p.hue==='gold'), 'quick warm energy absorption can force a gold palette');
  assert.ok(quickEnergy.every(p=>p.max<=0.25), 'quick energy absorption uses a shorter lifetime for faster flare motion');

  particles.reset();
  particles.spawnTurboSparks(80,90,1,1);
  const turboSparks=particles._debugSnapshot().filter(p=>p.kind==='spark');
  assert.ok(turboSparks.length>=3, 'turbo mode emits a compact electric spark batch');
  particles.update(0.03,20);
  const turboCtx=makeCtx();
  particles.draw(turboCtx,()=>true,20);
  assert.ok(turboCtx.calls.includes('fillRect'), 'turbo sparks draw as lightweight electric pixels');
} finally {
  Math.random=realRandom;
  delete globalThis.__mmFrameMs;
  particles.reset();
}

console.log('smoke-particle-sim: all assertions passed');
