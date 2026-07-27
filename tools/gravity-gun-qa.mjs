#!/usr/bin/env node
// Headless-Edge live QA for the gravity gun (slot 4, weaponType 'gravity').
// Boots the REAL game over CDP and proves the things a Node sim cannot:
//   1. the gun crafts through the REAL crafting-panel DOM, auto-equips, and the
//      slot-4 HUD flips to the 🌀 icon with a live energy readout
//   2. holding LMB on a stone tile CHANNELS: energy drains, the tile leaves the
//      world through the real seam, and the gun reports the carried block
//   3. RMB hurls the block; the flying block lands and RE-ENTERS the world as a
//      real tile (falling-solid settle) — matter conserved end to end
//   4. a LEAF block thrown at a live wolf barely scratches it but BLINDS it
//      (the "confusion" identity), while a STONE block visibly wounds it
//   5. bedrock refuses extraction (the gun strains and gives up)
//   6. an empty energy tank cannot channel at all
//   tools/gravity-gun-qa.png  final scene screenshot
// Traps inherited from bouncy-ammo-qa (all paid for in real debugging hours):
//   * keep-front pump — an occluded headless tab throttles rAF AND timers
//   * no full-canvas getImageData
//   * never write fresh SOLID tiles around the live hero — stage at distance
// Usage: node tools/gravity-gun-qa.mjs [--url=http://127.0.0.1:8123/index.html]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
// The seed is PINNED: every earlier revision of this driver booted a random
// world and each run failed a different way (water pockets flooding the staging
// corridor, slopes dropping the settle out of scan, ridges eating the LOS ray).
const url = opt('url', 'http://127.0.0.1:8123/index.html?seed=777');
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const out = opt('out', 'tools/gravity-gun-qa.png');

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

const SCENARIO = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.inv && window.player && MM.mobs && MM.weapons && MM.gravityGun && MM.gravityWorld && document.getElementById('craftList'));i++) await sleep(100);
	if(!(window.MM && MM.gravityGun)) return 'boot-timeout';
	const log=[];
	const t0=Date.now(); const over=()=>Date.now()-t0>260000;
	const T=MM.T, W=MM.world;
	if(!T || !W || !W.setTile) return 'no-tile-api';
	const getTile=(x,y)=>W.getTile(x,y), setTile=(x,y,v)=>W.setTile(x,y,v);
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	const p=window.player;
	const topUp=()=>{ try{ MM.heroEnergy.add(9999); }catch(e){} };
	const ginfo=()=>MM.weapons.gravityInfo();
	// hold LMB on a world point for up to \`ms\`, stopping early when \`until\` holds
	let trace=[];
	async function channelAt(wx,wy,ms,until){
		trace=[];
		const start=Date.now();
		let i=0;
		while(Date.now()-start<ms){
			const r=MM.weapons.fireHeld(p, wx, wy, 0.12); // fast drive: the keep-front pump fires the blur teardown (cancelHeld) every ~900ms — the whole rip must fit between pumps
			if(i%12===0) trace.push([i, r?1:0, +ginfo().ratio.toFixed(2), ginfo().active?1:0, +MM.heroEnergy.info().energy.toFixed(0), (document.getElementById('messages')||{}).textContent||'']);
			i++;
			await sleep(20);
			if(until && until()) return true;
		}
		return until ? !!until() : true;
	}

	// --- 1) craft through the REAL panel, HUD flips to 🌀 ----------------------
	Object.assign(window.inv,{iridium:12,graphene:6,silverWire:10,transistor:8,steel:14});
	window.updateInventoryHud();
	await sleep(200);
	const host=document.getElementById('craft');
	if(host && host.dataset.collapsed==='true') document.getElementById('craftToggle').click();
	const row=document.getElementById('craft_gravity_gun');
	if(!row) return 'no-recipe-row';
	row.click(); await sleep(140);
	const btn=document.querySelector('#craftDetail .craftPrimary');
	if(!btn || btn.disabled) return 'not-craftable';
	btn.click(); await sleep(300);
	const wep=MM.inventory.equippedItem('weapon');
	if(!wep || wep.weaponType!=='gravity') return 'gun-not-equipped:'+(wep&&wep.weaponType);
	log.push('gun='+wep.name+' reach='+wep.fireRange+' drain='+wep.energyCost);
	if(window.updateWeaponBar) window.updateWeaponBar();
	await sleep(150);
	const slot4=document.querySelector('#weaponBar .wepSlot[data-wkey="4"]');
	const icon=slot4 && slot4.querySelector('.wicon');
	if(!icon || icon.textContent!=='🌀') return 'slot4-icon-wrong:'+(icon&&icon.textContent);
	log.push('slot4=🌀');

	// --- 2) channel a STONE out of the world -----------------------------------
	// Staging is re-derived from the LIVE hero position on every call: the hero
	// drifts (knockback, terrain edits, falling ground), and each of the three
	// earlier one-shot staging schemes died to a different flavour of that.
	// Rules paid for in this driver's own failures:
	//   * the target sits ON solid ground (a floater falls to the audits the
	//     previous extraction queued),
	//   * a corridor is cleared from ABOVE the target's ground line up past the
	//     hero's head (the LOS ray travels through air; a seed-dependent ridge
	//     between hero and target makes the channel complete-and-refuse forever),
	//   * the hero's own column and the target's support are never touched.
	async function stageAt(tid){
		// try successive columns on BOTH sides: an earlier extraction can leave a
		// whole side water-logged (the volume-true sim reclaims anything placed
		// into live water before the readback), and a far column on a slope falls
		// outside the gun's reach, which refuses silently
		for(const [dir,dist] of [[1,3],[1,4],[1,5],[-1,3],[-1,4],[-1,5]]){
			const hx=Math.floor(p.x);
			const tx=hx+dir*dist;
			let gy0=Math.floor(p.y);
			while(gy0<Math.floor(p.y)+10 && getTile(tx,gy0)===0) gy0++;
			if(getTile(tx,gy0)===0) continue;
			const ty1=gy0-1;
			const top=Math.min(Math.floor(p.y)-2, ty1-2);
			for(let cx=hx+dir;cx!==tx+dir;cx+=dir)
				for(let y=top;y<=ty1;y++)
					if(!(cx===tx && y===ty1) && getTile(cx,y)!==0) setTile(cx,y,0);
			await sleep(250);
			if(Math.hypot(tx+0.5-p.x, ty1+0.5-p.y)>5.8) continue;
			setTile(tx,ty1,tid);
			if(getTile(tx,ty1)===tid) return {tx,ty1};
		}
		return null;
	}
	topUp();
	let cell=await stageAt(T.STONE);
	if(!cell) return 'stage-stone-failed';
	const e0=MM.heroEnergy.info().energy;
	const ripped=await channelAt(cell.tx+0.5,cell.ty1+0.5,6000,()=>ginfo().held===T.STONE);
	if(!ripped) return 'stone-not-extracted held='+ginfo().held+' active='+ginfo().active+' probe='+JSON.stringify(MM.gravityWorld.extractAt(cell.tx,cell.ty1))+' trace='+JSON.stringify(trace);
	// the vacated cell need not stay AIR — the world is alive (water can flood
	// in through the real WATER.onTileChanged lifecycle); only the ripped
	// material must be GONE
	if(getTile(cell.tx,cell.ty1)===T.STONE) return 'tile-still-in-world:'+getTile(cell.tx,cell.ty1);
	const spent=e0-MM.heroEnergy.info().energy;
	if(!(spent>10)) return 'channel-cost-too-cheap:'+spent.toFixed(1);
	log.push('ripped stone, energy -'+spent.toFixed(0));
	if(over()) return 'deadline@extract|'+log.join(' ');

	// --- 3) throw: the block lands and RE-ENTERS the world ----------------------
	// Deterministic landing: an open strip ending in a GRANITE backstop wall.
	// A flat shot meets the wall at near-muzzle speed — below the material's
	// shatter threshold — so the block MUST settle; without the wall the landing
	// spot (and settle-vs-shatter) is a function of the world seed's terrain.
	const gy=Math.floor(p.y)+1;
	const wx=Math.floor(p.x)+10;
	for(let x=Math.floor(p.x)+5;x<=wx+1;x++){ for(let dy=-5;dy<=-1;dy++) setTile(x,gy+dy,0); }
	for(let x=Math.floor(p.x)+5;x<=wx+1;x++){ if(getTile(x,gy)===0) setTile(x,gy,T.GRANITE); } // floor the strip: sloped seeds drop the block past the scan
	for(let dy=-1;dy>=-5;dy--) setTile(wx,gy+dy,T.GRANITE); // bottom-up: each course rests on the last
	await sleep(300);
	topUp();
	if(!MM.weapons.fireUlt(p, p.x+7, p.y-0.5)) return 'throw-refused';
	if(ginfo().held!==0) return 'hand-not-empty-after-throw';
	let settled=null;
	for(let i=0;i<80 && !settled;i++){
		await sleep(100);
		for(let x=Math.floor(p.x)+4;x<wx && !settled;x++)
			for(let y=gy-7;y<=gy+10 && !settled;y++)
				if(getTile(x,y)===T.STONE) settled={x,y};
	}
	if(!settled) return 'block-never-settled';
	log.push('settled@+'+(settled.x-Math.floor(p.x))+','+(settled.y-Math.floor(p.y)));
	setTile(settled.x,settled.y,0);
	for(let dy=-5;dy<=-1;dy++) setTile(wx,gy+dy,0); // take the wall down
	if(over()) return 'deadline@settle|'+log.join(' ');

	// --- 4) material identity on a live creature -------------------------------
	// ORDER MATTERS: extract while the world is quiet, THEN spawn the target.
	// A wolf that has been hit fights back, and hero damage runs the same input
	// teardown that stops mining — WEAPONS.cancelHeld — so a bite mid-channel
	// resets the rip forever. Real gameplay behaviour; the driver respects it.
	async function ripQuiet(tid,label){
		MM.mobs.clearAll();
		topUp();
		const c=await stageAt(tid);
		if(!c) return 'stage-'+label+'-failed';
		if(!(await channelAt(c.tx+0.5,c.ty1+0.5,8000,()=>ginfo().held===tid)))
			return label+'-not-extracted probe='+JSON.stringify(MM.gravityWorld.extractAt(c.tx,c.ty1))+' g='+JSON.stringify(ginfo())+' trace='+JSON.stringify(trace);
		return null;
	}
	function freshWolf(){
		MM.mobs.clearAll(); MM.mobs.freezeSpawns(120000);
		MM.mobs.deserialize({v:4,list:[{id:'WOLF',x:p.x+4,y:p.y,vx:0,vy:0,hp:60,state:'idle',facing:-1,scale:1,speedMul:1,jumpMul:1}],aggro:{mode:'rel',m:{}}});
		return MM.mobs.nearestLiving(p.x+4,p.y,3);
	}
	MM.mobs.freezeSpawns(120000);
	// leaf: near-zero damage, but the wolf loses its senses (blind = "confusion")
	let err=await ripQuiet(T.LEAF,'leaf'); if(err) return err;
	const wolf=freshWolf();
	if(!wolf) return 'no-wolf';
	const hpBeforeLeaf=wolf.hp;
	topUp();
	MM.weapons.fireUlt(p, wolf.x, wolf.y-0.2);
	let blinded=false;
	for(let i=0;i<40 && !blinded;i++){ await sleep(80); blinded=!!(MM.mobs.hasStatus && MM.mobs.hasStatus(wolf,'blind')); }
	if(!blinded) return 'leaf-did-not-blind';
	const leafDmg=hpBeforeLeaf-wolf.hp;
	if(leafDmg>4) return 'leaf-hits-too-hard:'+leafDmg;
	log.push('leaf: -'+leafDmg+' hp, blind=true');
	// stone: real damage
	err=await ripQuiet(T.STONE,'stone2'); if(err) return err;
	const wolf2=freshWolf();
	if(!wolf2) return 'no-wolf2';
	const hpBeforeStone=wolf2.hp;
	topUp();
	MM.weapons.fireUlt(p, wolf2.x, wolf2.y-0.2);
	let wounded=false;
	for(let i=0;i<40 && !wounded;i++){ await sleep(80); wounded=(hpBeforeStone-wolf2.hp)>=8; }
	if(!wounded) return 'stone-hit-too-soft:'+(hpBeforeStone-wolf2.hp);
	log.push('stone: -'+(hpBeforeStone-wolf2.hp)+' hp');
	MM.mobs.clearAll();
	if(over()) return 'deadline@creature|'+log.join(' ');

	// --- 5) bedrock refuses ------------------------------------------------------
	topUp();
	cell=await stageAt(T.BEDROCK);
	if(!cell) return 'stage-bedrock-failed';
	await channelAt(cell.tx+0.5,cell.ty1+0.5,1200,null);
	if(ginfo().held!==0 || ginfo().active) return 'bedrock-did-not-refuse held='+ginfo().held;
	log.push('bedrock refused');
	setTile(cell.tx,cell.ty1,0);

	// --- 6) an empty tank cannot channel ---------------------------------------
	cell=await stageAt(T.STONE);
	if(!cell) return 'stage-drained-failed';
	try{ MM.heroEnergy.drain(); }catch(e){}
	await channelAt(cell.tx+0.5,cell.ty1+0.5,1500,null);
	if(ginfo().held!==0) return 'channel-worked-without-energy';
	log.push('empty tank refused');

	// leave a held block visible for the screenshot
	topUp();
	cell=await stageAt(T.DIAMOND);
	if(cell) await channelAt(cell.tx+0.5,cell.ty1+0.5,8000,()=>ginfo().held===T.DIAMOND);
	if(window.updateWeaponBar) window.updateWeaponBar();
	return 'ok|'+log.join(' | ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-gravqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank'
	], { stdio: 'ignore' });

	let ws;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const res = await fetch(`http://127.0.0.1:${portLine}/json/list`);
				target = (await res.json()).find(t => t.type === 'page');
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 500)); } catch (e) { /* ignore */ }
				}
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
					try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		// keep-front pump: an occluded headless tab throttles rAF AND timers
		const front = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 900);
		await send(ws, 'Page.bringToFront');
		await sleep(1500);

		const res = await send(ws, 'Runtime.evaluate', { expression: SCENARIO, awaitPromise: true, returnByValue: true, timeout: 280000 });
		const val = res && res.result ? res.result.value : '(no result)';
		console.log('scenario:', val);
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out, Buffer.from(shot.data, 'base64'));
		console.log('wrote', out);
		clearInterval(front);
		if (pageErrors.length){
			console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
			process.exitCode = 1;
		}
		if (typeof val !== 'string' || !val.startsWith('ok|')){
			console.log('gravity-gun-qa: FAILED');
			process.exitCode = 1;
		} else {
			console.log('gravity-gun-qa: all live checks passed');
		}
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				// Marker-scoped kill: never taskkill msedge.exe — that takes the
				// author's own browser down with it.
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } res(); }
		});
		await sleep(600);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* profile locked; temp dir */ }
	}
}

main().catch(err => { console.error(err); process.exit(1); });
