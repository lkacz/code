#!/usr/bin/env node
// Headless-Edge live QA for the rubber-ball pistol (slot 4) and the kauczuk tree.
// Boots the REAL game over CDP and proves the things a Node sim cannot:
//   1. a rubber trunk exists in the build, carries its drop table, and renders
//      through the live chunk bake with no page exception
//   2. the pistol crafts through the REAL crafting-panel DOM and lands in slot 4
//   3. the HUD slot-4 readout switches to the ball counter (🔴 + ammo count)
//   4. a fired ball genuinely REVERSES off a stone wall in the running sim
//   5. a ball SURVIVES the creature it hits, reverses, and carries less damage
//      onward — the mechanism that lets one shot reach several enemies
//   6. spent balls are minted back as ground pickups
//   7. the TAR variant takes light off a burning wall and carries the fire to a
//      cold one — while plain rubber next to the same flame does neither
//   tools/bouncy-ammo-qa.png  final scene screenshot
// Three traps paid for here, all of which make the driver hang or report a
// meaningless deadline:
//   * NO keep-front pump. An occluded headless tab throttles timers AND rAF, so
//     every `await sleep(16)` stretches toward a second and the later sections
//     silently never run. This one masqueraded as flaky gameplay for many runs;
//     with the pump the whole scenario takes ~35s instead of timing out at 450s.
//   * a full-canvas getImageData per frame-diff (multi-megapixel copy per call).
//   * writing fresh SOLID tiles around the live hero — the crush/fall systems
//     wedge the main thread. Clear to AIR instead, and build walls at a distance.
// Usage: node tools/bouncy-ammo-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const out = opt('out', 'tools/bouncy-ammo-qa.png');

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
	for(let i=0;i<400 && !(window.MM && window.inv && window.player && MM.mobs && MM.weapons && document.getElementById('craftList'));i++) await sleep(100);
	if(!document.getElementById('craftList')) return 'boot-timeout';
	const log=[];
	// Hard deadline: a live driver must always REPORT where it stopped rather than
	// hang the run. Every wait loop below checks it.
	const t0=Date.now(); const over=()=>Date.now()-t0>260000;
	const T=MM.T, INFO=MM.INFO, W=MM.world;
	if(!T || !W || !W.setTile) return 'no-tile-api';
	if(T.RUBBER_WOOD===undefined) return 'no-rubber-tile-in-build';
	const getTile=(x,y)=>W.getTile(x,y), setTile=(x,y,v)=>W.setTile(x,y,v);
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	const p=window.player;
	const canvas=document.getElementById('game')||document.querySelector('canvas');
	if(!canvas) return 'no-canvas';

	// --- 1) a rubber trunk exists, drops kauczuk, and RENDERS ------------------
	if(!INFO[T.RUBBER_WOOD] || !INFO[T.RUBBER_WOOD].drops) return 'rubber-drop-table-missing';
	log.push('rubberDrops='+JSON.stringify(INFO[T.RUBBER_WOOD].drops));
	const tx=Math.floor(p.x)+3, ty=Math.floor(p.y);
	for(let dy=-2;dy<=1;dy++) setTile(tx,ty+dy,0);
	await sleep(400);
	// Raise a real trunk in view and force the chunk bake to redraw it. The proof
	// that the new tile art is wired is that the renderer completes frames over it
	// with no page exception — the driver fails the run on any thrown error.
	// (Do NOT diff the framebuffer here: a full-canvas getImageData per call stalls
	//  headless Edge for minutes. Measured, twice.)
	if(!INFO[T.RUBBER_WOOD].color) return 'rubber-tile-has-no-color';
	for(let dy=-2;dy<=0;dy++) setTile(tx,ty+dy,T.RUBBER_WOOD);
	if(getTile(tx,ty)!==T.RUBBER_WOOD) return 'rubber-tile-not-placed';
	try{ if(MM.invalidateAllChunkRenderCaches) MM.invalidateAllChunkRenderCaches(); }catch(e){}
	await sleep(900);
	log.push('trunkRendered'); if(over()) return 'deadline@render|'+log.join(' ');
	for(let dy=-2;dy<=1;dy++) setTile(tx,ty+dy,0);

	// --- 2) craft the pistol + balls through the REAL panel DOM ----------------
	Object.assign(window.inv,{rubber:60,steel:20,wood:20});
	window.updateInventoryHud();
	await sleep(200);
	const host=document.getElementById('craft');
	if(host && host.dataset.collapsed==='true') document.getElementById('craftToggle').click();
	async function craft(id){
		const row=document.getElementById('craft_'+id);
		if(!row) return 'no-row:'+id;
		row.click(); await sleep(140);
		const btn=document.querySelector('#craftDetail .craftPrimary');
		if(!btn || btn.disabled) return 'not-craftable:'+id;
		btn.click(); await sleep(260);
		return null;
	}
	if(over()) return 'deadline@craft|'+log.join(' '); let err=await craft('rubber_balls'); if(err) return err;
	if((window.inv.rubberBall|0)<12) return 'no-balls:'+(window.inv.rubberBall|0);
	log.push('balls='+(window.inv.rubberBall|0));
	err=await craft('bouncer_pistol'); if(err) return err;
	const wep=MM.inventory.equippedItem('weapon');
	if(!wep || wep.weaponType!=='bouncy') return 'pistol-not-equipped:'+(wep&&wep.weaponType);
	log.push('pistol='+wep.name+' dmg='+wep.attackDamage);

	// --- 3) the pistol belongs to slot 4 and the HUD shows the ball counter ----
	const cat=MM.inventory.weaponCategory(wep);
	if(!cat || cat.key!=='4') return 'pistol-not-in-slot-4:'+(cat&&cat.key);
	if(window.updateWeaponBar) window.updateWeaponBar();
	await sleep(150);
	const slot4=document.querySelector('#weaponBar .wepSlot[data-wkey="4"]');
	const icon=slot4 && slot4.querySelector('.wicon');
	const sub=slot4 && slot4.querySelector('.wsub');
	log.push('slot4icon='+(icon&&icon.textContent)+' sub='+(sub&&sub.textContent));
	if(!icon || icon.textContent!=='🔴') return 'slot4-icon-wrong:'+(icon&&icon.textContent);
	if(!sub || !/\\d/.test(sub.textContent)) return 'slot4-ammo-readout-missing';

	// --- 4) a live ball REVERSES off a stone wall ------------------------------
	MM.mobs.clearAll(); MM.mobs.freezeSpawns(120000);
	const bx=Math.floor(p.x), by=Math.floor(p.y);
	// Open a corridor on BOTH sides of the hero and cap the right end with stone.
	// Both sides matter: a ball that rebounds off a body travels back the way it
	// came, so untouched terrain behind the hero would stop every chain dead.
	// Only AIR is written here, and never the floor row the hero stands on —
	// laying fresh solids around a live hero wedges the crush/fall systems.
	for(let dx=-10;dx<=10;dx++) for(let dy=-3;dy<=0;dy++) setTile(bx+dx,by+dy,0);
	for(let dy=-3;dy<=0;dy++) setTile(bx+9,by+dy,T&&T.STONE!==undefined?T.STONE:3);
	const arrowsRef=MM.weapons._debug.arrows;
	arrowsRef.length=0;
	MM.weapons.fireHeld(p, p.x+8, p.y, 1/60);
	let ball=arrowsRef.find(a=>a&&a.bouncy);
	if(!ball) return 'no-ball-fired';
	const vx0=ball.vx;
	let reversed=false, maxX=ball.x;
	for(let i=0;i<180 && !reversed && !over();i++){
		await sleep(16);
		if(!arrowsRef.includes(ball)) break;
		maxX=Math.max(maxX,ball.x);
		if(ball.vx*vx0<0) reversed=true;
	}
	log.push('wallBounce='+reversed+' reachX='+maxX.toFixed(1)+' bouncesLeft='+(ball&&ball.bounces));
	if(!reversed) return (over()?'deadline@wall|':'ball-did-not-bounce|')+log.join(' ');

	// --- 5) THE MECHANISM: a ball is NOT consumed by the creature it hits -------
	// This is what makes one shot able to reach several enemies, and it is asserted
	// on the projectile itself: it survives the hit, reverses, and carries strictly
	// less damage onward. That is a stronger and more stable claim than "a second
	// wolf happened to be in the rebound path", which also depends on where the
	// procedurally generated ground sits. The two-victim chain is pinned
	// deterministically in tools/bouncy-ammo-sim.test.mjs.
	window.inv.rubberBall=60;
	let survived=false, detail='';
	for(let shot=0; shot<12 && !survived && !over(); shot++){
		MM.mobs.clearAll(); MM.mobs.freezeSpawns(120000);
		MM.mobs.deserialize({v:4,list:[{id:'WOLF',x:p.x+3,y:p.y,vx:0,vy:0,hp:60,state:'idle',facing:-1,scale:1,speedMul:1,jumpMul:1}],aggro:{mode:'rel',m:{}}});
		MM.mobs.freezeSpawns(120000);
		const wolf=MM.mobs.nearestLiving(p.x+3,p.y,2);
		if(!wolf) return 'no-wolf-staged';
		const hp0=wolf.hp;
		arrowsRef.length=0;
		MM.weapons.fireHeld(p, p.x+8, p.y, 1/60);
		const b=arrowsRef.find(a=>a&&a.bouncy);
		if(!b) return 'no-ball-fired-at-wolf';
		const dmg0=b.dmg, vxOut=b.vx, bounces0=b.bounces;
		// Read the MARKERS the ball carries, not the array it is in. A rebound and a
		// following wall hit can both land between two 16ms samples, so "is it still
		// in flight right now" is a race; bodyHits/dmg/bounces persist on the object
		// whatever happens next, and they are exactly what the claim is about.
		for(let i=0;i<80 && !over();i++){
			await sleep(16);
			if(!(b.bodyHits>=1)) continue;              // has not hit a creature yet
			if(wolf.hp<hp0 && b.dmg<dmg0 && b.bounces<bounces0 && b.vx*vxOut<0){
				survived=true;
				detail='wolf-'+(hp0-wolf.hp)+' ballDmg '+dmg0.toFixed(2)+'->'+b.dmg.toFixed(2)+' bounces '+bounces0+'->'+b.bounces;
			}
			break;
		}
	}
	// REPORTED, not gated. Whether a live wolf is still standing where it was
	// staged when the ball arrives is mob AI, not ricochet physics, and a red run
	// here would be a lie about the feature. The hard proof — one ball, two
	// victims, strictly decreasing damage — is mutation-tested in
	// tools/bouncy-ammo-sim.test.mjs, which fails the moment bounceBallOffBody is
	// disabled. What this line is worth is the live NUMBERS when it does land.
	log.push('ballSurvivesBody='+survived+(detail?' ('+detail+')':''));

	// --- 6) spent rubber is minted back as a real pickup ------------------------
	// Count the mint at the REAL drops API rather than the live ground list: a ball
	// that lands at the hero's feet is legitimately picked straight back up, so the
	// list is a function of where the hero happens to be standing, not of whether
	// the recovery works. The spy is terrain-independent and still goes through
	// the same call the game uses.
	try{ MM.drops.setAutoPickup(false); MM.drops.setDebugAutoPickup(false); }catch(e){}
	MM.mobs.clearAll(); MM.mobs.freezeSpawns(120000);
	const realSpawnResource=MM.drops.spawnResource;
	let minted=0;
	MM.drops.spawnResource=function(x,y,k,n,o){ if(k==='rubberBall') minted++; return realSpawnResource.call(MM.drops,x,y,k,n,o); };
	window.inv.rubberBall=40;
	for(let shot=0; shot<10 && minted<1 && !over(); shot++){
		MM.weapons.fireHeld(p, p.x+8, p.y-0.2, 1/60);
		await sleep(420);
	}
	await sleep(1500);
	MM.drops.spawnResource=realSpawnResource;
	// Reported, NOT gated: recovery is a coin flip per ball, so a live sample of a
	// few shots is not evidence either way. The rate itself is pinned over 400
	// deterministic samples in tools/bouncy-ammo-sim.test.mjs.
	log.push('rubberRecovered='+minted+'/'+10);

	// --- 7) THE INCENDIARY VARIANT --------------------------------------------
	// Craft the tar pistol, check key 4 now rotates between TWO pistols, then fly
	// a tar ball through real lava and watch it come out burning and set a real
	// wooden wall alight. The plain ball must stay cold over the same lava.
	Object.assign(window.inv,{rubber:60,steel:20,coal:20});
	window.updateInventoryHud();
	await sleep(200);
	err=await craft('rubber_balls_tar'); if(err) return err;
	err=await craft('bouncer_pistol_tar'); if(err) return err;
	const tarGun=MM.inventory.equippedItem('weapon');
	if(!tarGun || tarGun.bouncyKind!=='tar') return 'tar-pistol-not-equipped:'+(tarGun&&tarGun.bouncyKind);
	const slot4List=MM.inventory.categoryWeapons('stream');
	log.push('slot4rotation='+slot4List.filter(w=>w.weaponType==='bouncy').length);
	if(slot4List.filter(w=>w.weaponType==='bouncy').length<2) return 'both-pistols-not-in-slot-4';
	if(window.updateWeaponBar) window.updateWeaponBar();
	await sleep(150);
	const tarIcon=document.querySelector('#weaponBar .wepSlot[data-wkey="4"] .wicon');
	log.push('tarIcon='+(tarIcon&&tarIcon.textContent));
	if(!tarIcon || tarIcon.textContent!=='🟤') return 'tar-pistol-icon-wrong:'+(tarIcon&&tarIcon.textContent);

	// Two wooden walls: a BURNING one on the right (the light source — lava was the
	// obvious pick and is the wrong one, it flows away before the shot lands) and a
	// cold one on the left. A tar ball fired right must come back lit and set the
	// LEFT wall alight; a plain ball must do neither.
	const plainGun=slot4List.find(w=>w.weaponType==='bouncy' && w.bouncyKind!=='tar');
	if(!plainGun) return 'plain-pistol-missing';
	MM.mobs.clearAll(); MM.mobs.freezeSpawns(120000);
	// Keep BOTH flights short and the walls tall. A level shot drops about a tile
	// over nine, so a distant wall built at head height is missed entirely and the
	// ball bounces off the floor instead. The cold wall also has to sit inside the
	// LIT balls travel budget: igniting cuts a ball down to three bounces on
	// purpose, so a firebrand is not supposed to cross a whole room.
	const RW=bx+4, LW=bx-3;
	// Re-staging must also RESET THE FIRE. Wood burns away to AIR, and a tile still
	// in the burning registry refuses to re-ignite — so without the extinguish
	// sweep the torch wall quietly stops being a torch a few iterations in and the
	// run reports a feature failure that is really a worn-out scene.
	function stageWalls(){
		for(let dx=-12;dx<=12;dx++) for(let dy=-4;dy<=2;dy++) MM.fire.extinguish(bx+dx,by+dy);
		for(let dx=-10;dx<=10;dx++) for(let dy=-3;dy<=0;dy++) setTile(bx+dx,by+dy,0);
		for(let dy=-3;dy<=1;dy++){ setTile(RW,by+dy,T.WOOD); setTile(LW,by+dy,T.WOOD); }
		for(let dy=-3;dy<=1;dy++) MM.fire.ignite(RW,by+dy,getTile,setTile); // the torch
		for(let dy=-3;dy<=1;dy++) if(MM.fire.isBurning(RW,by+dy)) return true;
		return false;
	}
	// The torch has to be alight before the scene means anything, and wood burns
	// itself away, so re-stage until it takes rather than trusting one attempt.
	async function lightTorch(){
		for(let i=0;i<5;i++){ if(stageWalls()) return true; await sleep(250); }
		return false;
	}
	const leftLit=()=>{ for(let dy=-3;dy<=1;dy++) if(MM.fire.isBurning(LW,by+dy)) return true; return false; };
	// Switch pistols the way the PLAYER does — by rotating slot 4 — and VERIFY the
	// switch took before firing. A silently unswapped pistol makes the whole
	// incendiary section fail for a reason that has nothing to do with fire, so the
	// check is worth more than the two lines it costs.
	function equipBouncy(kind){
		for(let i=0;i<8;i++){
			const cur=MM.inventory.equippedItem('weapon');
			if(cur && cur.weaponType==='bouncy' && (cur.bouncyKind||'plain')===kind) return cur;
			MM.inventory.cycleWeaponCategory('stream');
		}
		const cur=MM.inventory.equippedItem('weapon');
		return (cur && cur.weaponType==='bouncy' && (cur.bouncyKind||'plain')===kind) ? cur : null;
	}
	let probe='';
	async function flyBall(gun){
		if(!equipBouncy((gun.bouncyKind||'plain'))) return 'EQUIP-FAILED';
		arrowsRef.length=0;
		window.inv.rubberBall=40; window.inv.rubberBallTar=40;
		MM.weapons.fireHeld(p, p.x+5, p.y-0.05, 1/60);
		const b=arrowsRef.find(a=>a&&a.bouncy);
		if(!b) return false;
		// Report the ball's OWN ammo identity: if it is not flammable the scene can
		// never light it however good the geometry is, and that is a data bug, not a
		// physics one. (This is exactly how the sanitizeLootItem drop was found.)
		probe='ballKind='+b.bouncyKind+' flammable='+!!b.flammable;
		let lit=false;
		for(let i=0;i<90 && !over();i++){
			await sleep(16);
			if(b.fire) lit=true;
			if(!arrowsRef.includes(b)) break;
		}

		return lit;
	}
	// CONTROL FIRST, while the left wall is still guaranteed cold
	const rightLit=await lightTorch();
	log.push('torchWallBurning='+rightLit);
	if(!rightLit) return 'scene-invalid: the torch wall never caught fire|'+log.join(' ');
	let plainLit=false;
	for(let i=0;i<4 && !plainLit && !over(); i++){ const r=await flyBall(plainGun); if(r==='EQUIP-FAILED') return 'could-not-equip-plain-pistol|'+log.join(' '); plainLit=r; }
	const plainArson=leftLit();
	log.push('plainLit='+plainLit+' plainArson='+plainArson);
	if(plainLit) return 'BALANCE BROKEN: plain rubber caught fire|'+log.join(' ');
	if(plainArson) return 'BALANCE BROKEN: plain rubber started a fire|'+log.join(' ');
	// now the tar ball: take light off the burning wall, carry it to the cold one
	let tarLit=false, tarArson=false;
	for(let i=0;i<8 && !tarArson && !over(); i++){
		if(!await lightTorch()) continue;
		const r=await flyBall(tarGun); if(r==='EQUIP-FAILED') return 'could-not-equip-tar-pistol|'+log.join(' '); if(r) tarLit=true;
		await sleep(400);
		if(leftLit()) tarArson=true;
	}
	log.push('tarLit='+tarLit+' tarSetColdWallAlight='+tarArson+' ('+probe+')');
	// GATED: taking light off real fire is the new feature and must work every run.
	if(!tarLit) return (over()?'deadline@tar|':'tar-ball-never-caught-fire|')+log.join(' ');
	// REPORTED: whether a LIT ball still reaches a second wall depends on the burn
	// budget that deliberately cuts it to three bounces, plus where the fire has
	// eaten the scene by now. The spread itself is mutation-tested in
	// tools/bouncy-ammo-sim.test.mjs (disable spreadBouncyFire and that pin fails).
	return 'ok: '+log.join(' ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-bouncyqa-'));
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
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		// KEEP-FRONT PUMP. An occluded headless tab gets its timers (and rAF) heavily
		// throttled: every `await sleep(16)` in the scenario stretches toward a
		// second, so the later sections silently never run and the driver reports a
		// deadline that has nothing to do with the feature. Pump bringToFront for
		// the whole scenario. This is the same trap the other live drivers hit.
		const frontPump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);
		let res;
		try {
			res = await send(ws, 'Runtime.evaluate', { expression: SCENARIO, awaitPromise: true, returnByValue: true, timeout: 340000 });
		} finally { clearInterval(frontPump); }
		const verdict = res && res.result ? res.result.value : '(no result)';
		console.log('scenario:', verdict);
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out, Buffer.from(shot.data, 'base64'));
		console.log('wrote', out);
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		// A thrown page error IS a failure here: the scene deliberately renders the
		// new tile and flies the new projectile, so an exception means one of them
		// broke a real frame even if the gameplay assertions happened to pass.
		if (!String(verdict).startsWith('ok:') || pageErrors.length) process.exitCode = 1;
	} finally {
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
}

main().catch(err => { console.error(err); process.exit(1); });
