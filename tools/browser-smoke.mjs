#!/usr/bin/env node
// Real-browser smoke test for the exact allowlisted Pages artifact. This reuses
// the dependency-free CDP driver and the locally installed Chrome/Edge binary.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT || 18125);
if(!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid SMOKE_PORT: ${process.env.SMOKE_PORT}`);

const url = `http://127.0.0.1:${port}/index.html`;
const tempRoot = await mkdtemp(join(tmpdir(), 'pages-browser-smoke-'));
const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean).find(candidate => existsSync(candidate));
if(!browser) throw new Error('No installed Chrome/Edge binary found');
const server = spawn(process.execPath, [join(repoRoot, 'tools/server.mjs'), '--artifact', `--port=${port}`], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function waitForServer(){
  for(let attempt = 0; attempt < 40; attempt++){
    if(server.exitCode != null) throw new Error(`Artifact server exited early: ${serverOutput.trim()}`);
    try{
      const response = await fetch(url);
      if(response.ok) return;
    }catch{ /* starting */ }
    await sleep(250);
  }
  throw new Error(`Artifact server did not become ready: ${serverOutput.trim()}`);
}

const runtimeAssertion = `(()=>{
  const main = [...document.scripts].some(script => script.type === 'module' && new URL(script.src).pathname.endsWith('/src/main.js'));
  const canvas = document.querySelector('#game');
  const checks = {
    document: document.readyState === 'complete',
    main,
    canvas: canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0,
    MM: !!window.MM && typeof window.MM === 'object',
    player: !!window.player && Number.isFinite(window.player.x) && Number.isFinite(window.player.y),
    heartbeat: Number.isFinite(window.__mmFrameMs) && window.__mmFrameMs > 0
  };
  return Object.values(checks).every(Boolean) ? 'PASS ' + JSON.stringify(checks) : 'FAIL ' + JSON.stringify(checks);
})()`;

try{
  await waitForServer();
  const preview = spawn(process.execPath, [
    join(repoRoot, 'tools/live-preview.mjs'),
    `--url=${url}`,
    '--wait=3500',
    '--size=960x540',
    `--out=${join(tempRoot, 'browser-smoke.png')}`,
    `--eval=${runtimeAssertion}`
  ], { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, CHROME_PATH: browser } });
  const code = await new Promise((resolveExit, rejectExit) => {
    preview.once('error', rejectExit);
    preview.once('exit', resolveExit);
  });
  if(code !== 0) throw new Error(`Browser smoke failed with exit code ${code}`);
  console.log('Browser smoke passed for the staged Pages artifact');
} finally {
  if(server.exitCode == null) server.kill();
  await rm(tempRoot, { recursive: true, force: true });
}
