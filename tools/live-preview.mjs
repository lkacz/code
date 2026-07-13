#!/usr/bin/env node
// Generic live preview: launch a real browser, load the real page, optionally poke
// it, and write a PNG you can actually look at. No dependencies — Node 22+ ships
// fetch and WebSocket, and Chrome/Edge speak CDP over that socket.
//
// This is the reusable core of every tools/*-qa.mjs driver in this repo. Use it
// when you want to SEE the app rather than assert about it.
//
//   node tools/live-preview.mjs                                  # boot + screenshot
//   node tools/live-preview.mjs --out=tools/shot.png --wait=3000
//   node tools/live-preview.mjs --eval="player.x+','+player.y"   # read live state
//   node tools/live-preview.mjs --script=tools/scenes/x.js       # run a scene file
//   node tools/live-preview.mjs --shots=4 --interval=700         # a strip over time
//   node tools/live-preview.mjs --url=https://lkacz.github.io/code/index.html
//   node tools/live-preview.mjs --head                           # watch it yourself
//
// --script runs a file whose contents are evaluated in the page as an async IIFE
// body; whatever it returns is printed. `await sleep(ms)` is provided.
//
// Exit code is non-zero if the page threw, if the script returned a string
// starting with FAIL, or if the browser never came up — so it works in CI too.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a === '--' + name || a.startsWith('--' + name + '='));
	if(!hit) return dflt;
	const eq = hit.indexOf('=');
	return eq === -1 ? true : hit.slice(eq + 1);
};
const url      = opt('url', 'http://127.0.0.1:8123/index.html');
const out      = opt('out', 'tools/live-preview.png');
const wait     = Number(opt('wait', 2500));
const shots    = Math.max(1, Number(opt('shots', 1)));
const interval = Number(opt('interval', 800));
const headful  = !!opt('head', false);
const evalExpr = opt('eval', '');
const script   = opt('script', '');
// A big window is expensive: headless Chrome/Edge software-rasters every pixel with
// --disable-gpu, and on a canvas game that can drag the frame rate (and therefore
// the simulation) down by an order of magnitude. Keep it small unless you need the
// pixels. See the "starved simulation" note in docs/LIVE-PREVIEW.md.
const [winW, winH] = String(opt('size', '1100x620')).split('x').map(Number);

const BROWSERS = [
	process.env.CHROME_PATH,
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0;
const pending = new Map();
// Every call carries a deadline. A wedged Runtime.evaluate (page pinned at 100% CPU,
// a promise that never settles) would otherwise hang the driver forever with no output.
function send(ws, method, params, budget = 60000){
	const id = ++msgId;
	ws.send(JSON.stringify({ id, method, params: params || {} }));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, budget);
		pending.set(id, {
			resolve: v => { clearTimeout(timer); resolve(v); },
			reject:  e => { clearTimeout(timer); reject(e); },
		});
	});
}

async function main(){
	const bin = BROWSERS.find(p => existsSync(p));
	if(!bin) throw new Error('No Chrome/Edge found. Set CHROME_PATH=/path/to/chrome');

	// A throwaway profile keeps localStorage clean between runs — the app persists
	// saves/settings, so a reused profile silently carries state into the next run.
	const profile = await mkdtemp(join(tmpdir(), 'live-preview-'));
	const proc = spawn(bin, [
		headful ? '--auto-open-devtools-for-tabs' : '--headless=new',
		'--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
		'--force-device-scale-factor=1',      // pointer math must not fight a DPR of 2
		'--autoplay-policy=no-user-gesture-required', // WebAudio runs headless if you let it
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank',
	], { stdio: 'ignore' });

	let ws, failed = false;
	try{
		// The port is written into the profile dir once the browser is listening.
		let target = null;
		for(let i = 0; i < 80 && !target; i++){
			await sleep(250);
			try{
				const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if(!port) continue;
				const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
				target = list.find(t => t.type === 'page');
			}catch(e){ /* not up yet */ }
		}
		if(!target) throw new Error('DevTools endpoint never came up');

		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

		const events = [], errors = [], logs = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if(m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if(m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
				return;
			}
			if(!m.method) return;
			events.push(m.method);
			// Page errors are the single most valuable signal and are invisible in a
			// screenshot — a module that failed to load renders a plausible-looking
			// empty page. Always surface them.
			if(m.method === 'Runtime.exceptionThrown'){
				try{ errors.push(m.params.exceptionDetails.exception?.description
					|| m.params.exceptionDetails.text); }catch(e){ /* ignore */ }
			}
			if(m.method === 'Runtime.consoleAPICalled'){
				const txt = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
				if(m.params.type === 'error') errors.push('console.error: ' + txt);
				else logs.push(txt);
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride',
			{ width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for(let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(wait); // let the app boot: modules, first frames, intro screens

		const evaluate = async (expression, budget = 120000) => {
			const r = await send(ws, 'Runtime.evaluate',
				{ expression, awaitPromise: true, returnByValue: true, timeout: budget - 5000 }, budget);
			if(r.exceptionDetails){
				throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
			}
			return r.result?.value;
		};

		if(evalExpr){
			const v = await evaluate(`(async()=>{ return (${evalExpr}); })()`);
			console.log('eval:', typeof v === 'object' ? JSON.stringify(v) : String(v));
			if(String(v).startsWith('FAIL')) failed = true;
		}
		if(script){
			const body = await readFile(script, 'utf8');
			const v = await evaluate(
				`(async()=>{ const sleep=ms=>new Promise(r=>setTimeout(r,ms));\n${body}\n})()`);
			console.log('script:', typeof v === 'object' ? JSON.stringify(v) : String(v));
			if(String(v).startsWith('FAIL')) failed = true;
		}

		for(let i = 0; i < shots; i++){
			if(i) await sleep(interval);
			const path = shots === 1 ? out : out.replace(/\.png$/, `-${i + 1}.png`);
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(path, Buffer.from(shot.data, 'base64'));
			console.log('wrote', path);
		}

		if(logs.length) console.log('console:', logs.slice(0, 10).join(' | ').slice(0, 600));
		if(errors.length){
			failed = true;
			console.log('PAGE ERRORS:\n  ' + errors.slice(0, 6).join('\n  '));
		}
		if(headful){ console.log('headful: browser stays open 60s'); await sleep(60000); }
	} finally {
		try{ if(ws) ws.close(); }catch(e){ /* closing */ }
		try{ proc.kill(); }catch(e){ /* gone */ }
		await sleep(300);
		try{ await rm(profile, { recursive: true, force: true }); }catch(e){ /* profile busy */ }
	}
	if(failed) process.exit(1);
}
main().catch(err => { console.error(String(err)); process.exit(1); });
