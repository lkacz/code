#!/usr/bin/env node
// Live QA for the hero coating (powłoka bohatera, engine/post_fx.js): enables
// ONLY heroSheen through the REAL config path (MM.postFx.set — the pause-panel
// handler's own call), walks the hero through four environments (snow spawn,
// grass field, torch-lit sealed stone room, underwater) and asserts the
// SAMPLED coat colors via the MM.postFx._sheenState() QA seam: green legs on
// grass, rock-gray crown in a stone room (never noon blue), a warm shift when
// a torch appears in reach, blue everywhere underwater. 3x-magnified clips
// around the hero are written next to the other QA screenshots (ignored).
//
// Usage: npm start (server on 8123), then:
//   node tools/hero-sheen-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '777');
const outDir = 'tools';

const EDGE_CANDIDATES = [
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

let msgId = 0;
const pending = new Map();
function send(ws, method, params){
	const id = ++msgId;
	ws.send(JSON.stringify({ id, method, params: params || {} }));
	return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BOOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.background && MM.fog && MM.postFx && MM.world && MM.worldGen && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.world && window.player)) return 'FAIL boot-timeout';
	MM.fog.setRevealAll(true);
	MM.background.importState({cycleT:0.25});
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	// REAL path: only the coat, everything else off
	for(const name of MM.postFx.COMPONENTS) MM.postFx.set(name, name==='heroSheen');
	return 'OK';
})()`;

// scene scripts return 'OK {json}' with the live coat stops
const SCENE_SNOW = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	await sleep(2500);
	const s=MM.postFx._sheenState();
	return s ? 'OK '+JSON.stringify(s) : 'FAIL no-sheen-state';
})()`;

const SCENE_GRASS = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const peek=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
	// hop east in big steps until a surface GRASS column generates in view
	let found=null;
	for(let hop=1; hop<=14 && !found; hop++){
		const bx=hop*260;
		window.__mmDebugHero(bx, MM.worldGen.surfaceHeight(bx)-2);
		await sleep(900);
		for(let x=bx-80; x<=bx+80 && !found; x++){
			const s=MM.worldGen.surfaceHeight(x);
			if(peek(x,s)===1 && peek(x,s-1)===0 && peek(x,s-2)===0) found={x,s};
		}
	}
	if(!found) return 'FAIL no-grass-found';
	window.__mmDebugHero(found.x, found.s-2);
	await sleep(2600);
	if(window.player) player.hp=player.maxHp;
	const st=MM.postFx._sheenState();
	return st ? 'OK '+JSON.stringify({st,at:found.x+','+found.s,ground:MM.world.peekTile(found.x,found.s,0)}) : 'FAIL no-sheen-state';
})()`;

const SCENE_CAVE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const peek=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
	// deterministic stage: a SEALED all-stone room carved deep underground — a
	// natural pocket in this seed keeps landing beside underground lakes, whose
	// water the coat then (correctly, but unpredictably) mirrors
	const ox=Math.floor(player.x);
	window.__mmDebugHero(ox-600, 215);
	await sleep(1400); // generate the band
	const cx=Math.floor(player.x), cy=218;
	for(let x=cx-4;x<=cx+4;x++) for(let y=cy-5;y<=cy+3;y++) MM.world.setTile(x,y,3);
	for(let x=cx-3;x<=cx+3;x++) for(let y=cy-3;y<=cy+1;y++) MM.world.setTile(x,y,0);
	window.__mmDebugHero(cx, cy+1);
	await sleep(2600); // settle + coat chase converges
	if(window.player) player.hp=player.maxHp;
	const before=MM.postFx._sheenState();
	MM.world.setTile(cx+2,cy+1,3);  // pedestal on the room floor
	MM.world.setTile(cx+2,cy,16);   // torch beside the hero
	await sleep(2600);
	if(window.player) player.hp=player.maxHp;
	const after=MM.postFx._sheenState();
	const torchAlive=peek(cx+2,cy)===16;
	const heroInRoom=Math.abs(Math.floor(player.x)-cx)<=2 && Math.abs(Math.floor(player.y)-(cy+1))<=1;
	return (before&&after) ? 'OK '+JSON.stringify({before,after,at:cx+','+cy,torchAlive,heroInRoom}) : 'FAIL no-sheen-state';
})()`;

// The blade sheen rides the same toggle: a POLISHED weapon mirrors the world
// (anisotropically, along its length), a wooden stick must stay matte.
const SCENE_BLADE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const M=MM.postFx.metrics;
	const swing=async()=>{ for(let i=0;i<5;i++){ try{ MM.weapons.fireHeld(player, player.x+3, player.y-0.2, 0.016); }catch(e){} await sleep(150); } };
	// wooden stick first (the starting weapon): matte by design
	let wood=null;
	try{ wood=MM.inventory.grantItem({id:'qa_wood_stick',name:'Drewniany kij QA',kind:'weapon',tier:'common',stats:{attackDamage:2}},{equip:true}); }catch(e){}
	await sleep(500);
	const woodBefore=M.bladeSheens|0;
	await swing();
	const woodDelta=(M.bladeSheens|0)-woodBefore;
	// then steel: the material profile keys off the item NAME
	let steel=null;
	try{ steel=MM.inventory.grantItem({id:'qa_steel_sword',name:'Stalowy miecz QA',kind:'weapon',tier:'rare',stats:{attackDamage:6}},{equip:true}); }catch(e){}
	await sleep(500);
	const steelBefore=M.bladeSheens|0;
	await swing();
	const steelDelta=(M.bladeSheens|0)-steelBefore;
	if(window.player) player.hp=player.maxHp;
	return 'OK '+JSON.stringify({wood,steel,woodDelta,steelDelta});
})()`;

const SCENE_WATER = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const peek=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
	// sealed basin (gfx-ultra-qa stage A pattern), hero dropped INTO the water
	const sx0=Math.floor(player.x);
	const surf0=MM.worldGen.surfaceHeight(sx0);
	const solidId=peek(sx0,surf0+10)||3;
	const px0=sx0+3, base=surf0;
	for(let k=0;k<12;k++){
		const x=px0+k;
		for(let y=base-5;y<base;y++) MM.world.setTile(x,y,0);
		MM.world.setTile(x,base+3,solidId);
		MM.world.setTile(x,base,8);
		MM.world.setTile(x,base+1,8);
		MM.world.setTile(x,base+2,8);
	}
	for(const wx of [px0-1,px0+12]){
		for(let y=base-1;y<=base+3;y++) MM.world.setTile(wx,y,solidId);
	}
	await sleep(700);
	window.__mmDebugHero(px0+6, base+1);
	await sleep(2600);
	if(window.player) player.hp=player.maxHp;
	const st=MM.postFx._sheenState();
	return st ? 'OK '+JSON.stringify({st,inWater:peek(px0+6,base+1)===8}) : 'FAIL no-sheen-state';
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-sheenqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--window-size=1600,900',
		'about:blank'
	], { stdio: 'ignore' });

	let ws, pump = null, failed = false;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const res = await fetch(`http://127.0.0.1:${portLine}/json/list`);
				const list = await res.json();
				target = list.find(t => t.type === 'page');
			} catch (e) { /* not up yet */ }
		}
		if (!target) throw new Error('DevTools endpoint never came up');

		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const events = [];
		const pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 600)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __origGEBI=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){
				const el=__origGEBI.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
				return el;
			};` });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);

		const evalStage = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 180000 });
			const status = r && r.result ? String(r.result.value) : '(no result)';
			console.log(label + ':', status);
			return status;
		};
		const snapClip = async (name) => {
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', clip: { x: 630, y: 280, width: 340, height: 340, scale: 3 } });
			await writeFile(join(outDir, 'hero-sheen-qa-' + name), Buffer.from(shot.data, 'base64'));
		};

		const boot = await evalStage('boot', BOOT);
		if(!boot.startsWith('OK')) throw new Error('boot failed');
		const rSnow = await evalStage('snow', SCENE_SNOW);
		await snapClip('sheen-snow.png');
		const rGrass = await evalStage('grass', SCENE_GRASS);
		await snapClip('sheen-grass.png');
		const rCave = await evalStage('cave', SCENE_CAVE);
		await snapClip('sheen-cave-torch.png');
		const rBlade = await evalStage('blade', SCENE_BLADE);
		await snapClip('sheen-blade.png');
		const rWater = await evalStage('water', SCENE_WATER);
		await snapClip('sheen-water.png');
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));

		if(![rSnow, rGrass, rCave, rBlade, rWater].every(s => s.startsWith('OK '))){ failed = true; console.error('a scene failed'); }
		else {
			const snow = JSON.parse(rSnow.slice(3));
			const grass = JSON.parse(rGrass.slice(3));
			const cave = JSON.parse(rCave.slice(3));
			const blade = JSON.parse(rBlade.slice(3));
			const water = JSON.parse(rWater.slice(3));
			const checks = [
				// the real mirror blit must actually run in every scene — the tint
				// alone is the fallback path, not the effect
				['snow: the grabbed backdrop is mirrored onto the hero', snow.mirrored === true],
				['grass: the grabbed backdrop is mirrored onto the hero', grass.st.mirrored === true],
				['cave: the grabbed backdrop is mirrored onto the hero', cave.after.mirrored === true],
				['underwater: the grabbed backdrop is mirrored onto the hero', water.st.mirrored === true],
				// the source must be the FULL world grab (creatures, fire, water,
				// machines), not the pre-sprite fallback
				['snow: the reflection sources the finished world', snow.full === true],
				['grass: the reflection sources the finished world', grass.st.full === true],
				['cave: the reflection sources the finished world', cave.after.full === true],
				['underwater: the reflection sources the finished world', water.st.full === true],
				['snow spawn: coat is bright (winter white reflects)', (snow.bot[0] + snow.bot[1] + snow.bot[2]) / 3 > 110],
				['grass field: legs pick up GREEN from the ground', grass.st.bot[1] > grass.st.bot[0] && grass.st.bot[1] > grass.st.bot[2]],
				['grass field: probe really stood on grass', grass.ground === 1],
				['cave: hero really stands in the stone room', cave.heroInRoom === true],
				['cave: crown reflects the rock ceiling, not the noon sky (no blue dominance)', cave.before.top[2] - cave.before.top[0] < 40],
				['cave torch: stage torch survived', cave.torchAlive === true],
				['cave torch: coat warms up (red rises)', cave.after.mid[0] > cave.before.mid[0] + 8],
				['underwater: coat shifts blue in every zone', water.st.top[2] > water.st.top[0] && water.st.mid[2] > water.st.mid[0] && water.st.bot[2] > water.st.bot[0]],
				['underwater: hero really submerged', water.inWater === true],
				['blade: QA weapons really got equipped', blade.wood === true && blade.steel === true],
				['blade: a wooden stick stays matte', blade.woodDelta === 0],
				['blade: polished steel mirrors the world', blade.steelDelta > 0]
			];
			for (const [label, ok] of checks){
				console.log((ok ? 'PASS ' : 'FAIL ') + label);
				if (!ok) failed = true;
			}
		}
	} finally {
		try { if (pump) clearInterval(pump); } catch (e) { /* not started */ }
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } res(); }
		});
		await sleep(600);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* profile locked; temp dir */ }
	}
	if (failed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
