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
  window.__simulationTimeScale=4;
  const before={maxHp:player.maxHp};
  player.hp=0;
  window.heroDied('temporal_browser_qa');
  const armed=MM.temporalEcho.state();
  const markerAtDeath=!!(localStorage.getItem('mm_temporal_echo_pending_v1')||sessionStorage.getItem('mm_temporal_echo_pending_v1'));
  const racing=await waitFor(()=>MM.temporalEcho.state().phase==='racing'&&MM.temporalEcho.state(),12000);
  const trigger=document.getElementById('debugMenuBtn');
  const panel=document.getElementById('menuPanel');
  if(trigger&&panel&&panel.hidden) trigger.click();
  await sleep(100);
  const began=MM.temporalEcho.debugRewind();
  const finished=await waitFor(()=>MM.temporalEcho.state().phase==='idle'&&MM.temporalEcho.state().cooldown>0&&MM.temporalEcho.state(),12000);
  const checkpoint=MM.world.temporalCheckpointState();
  const checks={
    armed:armed.phase==='armed',
    storageWritable,
    markerAtDeath,
    racing:!!racing,
    began,
    finished:!!finished,
    fullHealth:Math.abs(player.hp-player.maxHp)<0.001,
    capacity:player.maxHp===before.maxHp,
    checkpointReleased:checkpoint.active===false,
    markerCleared:!(localStorage.getItem('mm_temporal_echo_pending_v1')||sessionStorage.getItem('mm_temporal_echo_pending_v1')),
    cooldownPersisted:!!(localStorage.getItem('mm_temporal_echo_cooldown_v1')||sessionStorage.getItem('mm_temporal_echo_cooldown_v1')),
    exactRestore:window.__mmTemporalRestoreDegraded!==true
  };
  const diagnostics={
    localKeys:Object.keys(localStorage).filter(key=>key.includes('temporal')),
    sessionKeys:Object.keys(sessionStorage).filter(key=>key.includes('temporal')),
    cooldown:MM.temporalEcho.state().cooldown,
    storageError:window.__mmTemporalStorageError||''
  };
  return (Object.values(checks).every(Boolean)?'PASS ':'FAIL ')+JSON.stringify({checks,diagnostics});
})()`;

try{
  await waitForServer();
  const preview=spawn(process.execPath,[
    join(repoRoot,'tools/live-preview.mjs'),
    `--url=${url}`,
    '--wait=3500',
    '--size=960x540',
    `--out=${join(tempRoot,'temporal-echo.png')}`,
    `--eval=${lifecycleAssertion}`
  ],{cwd:repoRoot,stdio:'inherit',env:{...process.env,CHROME_PATH:browser}});
  const code=await new Promise((resolveExit,rejectExit)=>{
    preview.once('error',rejectExit);
    preview.once('exit',resolveExit);
  });
  if(code!==0) throw new Error(`Temporal Echo browser QA failed with exit code ${code}`);
  console.log('Temporal Echo browser lifecycle passed');
}finally{
  if(server.exitCode==null) server.kill();
  await rm(tempRoot,{recursive:true,force:true});
}
