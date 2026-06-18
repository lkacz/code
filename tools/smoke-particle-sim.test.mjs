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
  particles.spawnEnergyAbsorb(20,20,60,30,1);
  assert.ok(particles.count()>0, 'energy absorption emits a small particle batch');
  particles.update(0.08,20);
  const energyCtx=makeCtx();
  particles.draw(energyCtx,()=>true,20);
  assert.ok(energyCtx.calls.includes('lineTo') && energyCtx.calls.includes('stroke'), 'energy absorption draws electric streaks');
} finally {
  Math.random=realRandom;
  delete globalThis.__mmFrameMs;
  particles.reset();
}

console.log('smoke-particle-sim: all assertions passed');
