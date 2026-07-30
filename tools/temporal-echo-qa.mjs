#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=18126;
const url=`http://127.0.0.1:${port}/index.html`;
const tempRoot=await mkdtemp(join(tmpdir(),'temporal-echo-qa-'));
const browser=[
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find(existsSync);
if(!browser) throw new Error('No installed Chrome/Edge binary found');

const server=spawn(process.execPath,[join(repoRoot,'tools/server.mjs'),`--port=${port}`],{
  cwd:repoRoot,stdio:['ignore','pipe','pipe']
});
let serverOutput='';
server.stdout.on('data',chunk=>{ serverOutput+=chunk; });
server.stderr.on('data',chunk=>{ serverOutput+=chunk; });
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));

async function waitForServer(){
  for(let attempt=0;attempt<40;attempt++){
    if(server.exitCode!=null) throw new Error(`Artifact server exited early: ${serverOutput.trim()}`);
    try{ const response=await fetch(url); if(response.ok) return; }catch{ /* starting */ }
    await sleep(250);
  }
  throw new Error(`Artifact server did not become ready: ${serverOutput.trim()}`);
}

const lifecycleAssertion=`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const waitFor=async(fn,ms)=>{
    const end=performance.now()+ms;
    while(performance.now()<end){ const value=fn(); if(value) return value; await sleep(100); }
    return null;
  };
  document.querySelector('#titleScreen .tsPrimary')?.click();
  await sleep(500);
  let storageWritable=false;
  try{ localStorage.setItem('mm_temporal_echo_qa_probe','1'); storageWritable=localStorage.getItem('mm_temporal_echo_qa_probe')==='1'; localStorage.removeItem('mm_temporal_echo_qa_probe'); }catch{}
  window.__simulationTimeScale=1;
  const deathX=Math.floor(player.x)+96;
  window.__mmDebugHero(deathX,MM.worldGen.surfaceHeight(deathX)-2);
  await sleep(250);
  inv.stone=20;
  const before={maxHp:player.maxHp,stone:inv.stone};
  player.hp=0;
  window.heroDied('temporal_browser_qa');
  const armed=MM.temporalEcho.state();
  const markerAtDeath=!!(localStorage.getItem('mm_temporal_echo_pending_v1')||sessionStorage.getItem('mm_temporal_echo_pending_v1'));
  const racing=await waitFor(()=>MM.temporalEcho.state().phase==='racing'&&MM.temporalEcho.state(),12000);
  const temporalTarget=MM.temporalEcho.target();
  const constants=await import('/src/constants.js');
  const physics=await import('/src/engine/material_physics.js');
  const groundedTarget=!!(temporalTarget&&physics.isObjectFootingTile(MM.world.getTile(temporalTarget.x,temporalTarget.y+1)));
  let graveSelfHealed=false;
  if(temporalTarget){
    MM.world.setTile(temporalTarget.x,temporalTarget.y,constants.T.AIR);
    graveSelfHealed=!!(await waitFor(()=>MM.world.getTile(temporalTarget.x,temporalTarget.y)===constants.T.GRAVE,2000));
  }
  const deathCycle=Number(armed.payload?.data?.background?.cycleT);
  const shiftedCycle=(deathCycle+0.16)%1;
  const shiftedState={...MM.background.snapshot(),cycleT:shiftedCycle};
  MM.background.importState(shiftedState);
  await sleep(120);
  const skyBeforeTouch=MM.background.snapshot().cycleT;
  if(temporalTarget) window.__mmDebugHero(temporalTarget.x+0.12,temporalTarget.y-0.3);
  let sawRewinding=false;
  const skySamples=[];
  let finished=null;
  for(let i=0;i<240;i++){
    const state=MM.temporalEcho.state();
    const sky=MM.background.snapshot();
    skySamples.push(sky.cycleT);
    if(state.phase==='rewinding') sawRewinding=true;
    if(state.phase==='idle'&&state.cooldown>0){ finished=state; break; }
    await sleep(30);
  }
  const checkpoint=MM.world.temporalCheckpointState();
  const cycleDistance=(a,b)=>Math.min(Math.abs(a-b),1-Math.abs(a-b));
  const forwardFromDeath=value=>((value-deathCycle)%1+1)%1;
  const initialSkyDistance=forwardFromDeath(skyBeforeTouch);
  const skyMovedBackward=skySamples.some(value=>forwardFromDeath(value)<initialSkyDistance-0.025);
  const finalSkyError=cycleDistance(MM.background.snapshot().cycleT,deathCycle);
  const checks={
    armed:armed.phase==='armed',
    storageWritable,
    markerAtDeath,
    racing:!!racing,
    temporalTarget:!!temporalTarget,
    spiritTarget:temporalTarget?.kind==='spirit',
    groundedTarget,
    graveSelfHealed,
    autoContact:sawRewinding,
    finished:!!finished,
    resourcesRestored:inv.stone===before.stone,
    fullHealth:Math.abs(player.hp-player.maxHp)<0.001,
    capacity:player.maxHp===before.maxHp,
    skyMovedBackward,
    skyReturnedToDeath:finalSkyError<0.004,
    checkpointReleased:checkpoint.active===false,
    markerCleared:!(localStorage.getItem('mm_temporal_echo_pending_v1')||sessionStorage.getItem('mm_temporal_echo_pending_v1')),
    cooldownPersisted:!!(localStorage.getItem('mm_temporal_echo_cooldown_v1')||sessionStorage.getItem('mm_temporal_echo_cooldown_v1')),
    exactRestore:window.__mmTemporalRestoreDegraded!==true
  };
  const diagnostics={
    localKeys:Object.keys(localStorage).filter(key=>key.includes('temporal')),
    sessionKeys:Object.keys(sessionStorage).filter(key=>key.includes('temporal')),
    cooldown:MM.temporalEcho.state().cooldown,
    initialSkyDistance,
    finalSkyError,
    skySamples:skySamples.length,
    storageError:window.__mmTemporalStorageError||''
  };
  return (Object.values(checks).every(Boolean)?'PASS ':'FAIL ')+JSON.stringify({checks,diagnostics});
})()`;

const expiryAssertion=`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const waitFor=async(fn,ms)=>{
    const end=performance.now()+ms;
    while(performance.now()<end){ const value=fn(); if(value) return value; await sleep(100); }
    return null;
  };
  document.querySelector('#titleScreen .tsPrimary')?.click();
  await sleep(500);
  window.__simulationTimeScale=4;
  const deathX=Math.floor(player.x)+96;
  window.__mmDebugHero(deathX,MM.worldGen.surfaceHeight(deathX)-2);
  await sleep(250);
  inv.stone=20;
  const before=inv.stone;
  player.hp=0;
  window.heroDied('temporal_expiry_qa');
  const racing=await waitFor(()=>MM.temporalEcho.state().phase==='racing'&&MM.temporalEcho.state(),12000);
  const target=MM.temporalEcho.target();
  const afterSplit=inv.stone;
  const constants=await import('/src/constants.js');
  const trigger=document.getElementById('debugMenuBtn');
  const panel=document.getElementById('menuPanel');
  if(trigger&&panel&&panel.hidden) trigger.click();
  await sleep(100);
  const expired=MM.temporalEcho.debugExpire();
  await sleep(250);
  const state=MM.temporalEcho.state();
  const checkpoint=MM.world.temporalCheckpointState();
  const checks={
    racing:!!racing,
    target:target?.kind==='spirit',
    resourceSplit:afterSplit===Math.ceil(before/2),
    expired,
    collapseReason:state.collapseReason==='expired',
    escrowForfeited:inv.stone===afterSplit,
    emptyGravestone:!!target&&MM.world.getTile(target.x,target.y)===constants.T.GRAVE
      && MM.temporalEcho.target()===null
      && !localStorage.getItem('mm_grave_v1'),
    checkpointReleased:checkpoint.active===false,
    markerCleared:!(localStorage.getItem('mm_temporal_echo_pending_v1')||sessionStorage.getItem('mm_temporal_echo_pending_v1'))
  };
  return (Object.values(checks).every(Boolean)?'PASS ':'FAIL ')+JSON.stringify({checks,before,afterSplit,afterExpiry:inv.stone});
})()`;

async function runPreview(name,assertion){
  const preview=spawn(process.execPath,[
    join(repoRoot,'tools/live-preview.mjs'),
    `--url=${url}`,
    '--wait=3500',
    '--size=960x540',
    `--out=${join(tempRoot,name+'.png')}`,
    `--eval=${assertion}`
  ],{cwd:repoRoot,stdio:'inherit',env:{...process.env,CHROME_PATH:browser}});
  const code=await new Promise((resolveExit,rejectExit)=>{
    preview.once('error',rejectExit);
    preview.once('exit',resolveExit);
  });
  if(code!==0) throw new Error(`Temporal Echo ${name} browser QA failed with exit code ${code}`);
}

try{
  await waitForServer();
  await runPreview('temporal-echo-success',lifecycleAssertion);
  await runPreview('temporal-echo-expiry',expiryAssertion);
  console.log('Temporal Echo browser success + expiry lifecycle passed');
}finally{
  if(server.exitCode==null) server.kill();
  await rm(tempRoot,{recursive:true,force:true});
}
