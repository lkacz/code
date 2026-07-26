// The staged scene shared by the two post-FX cost harnesses.
//
// tools/postfx-bench-qa.mjs times each pass directly on a SOFTWARE canvas
// (--disable-gpu), which is where a pass can be flushed synchronously and
// measured in isolation. tools/postfx-gpu-qa.mjs measures the same passes on a
// real GPU, where no such flush exists and vsync itself has to serve as the
// ruler. Both need the SAME scene or their numbers cannot be compared, so it
// lives here rather than being copy-pasted into each driver.
//
// Every feature sits inside ONE emitter-scan window on purpose: the first
// version of the software bench gave each case its own x offset (to get its own
// scan cache key) and thereby pushed the ice sheet and the pond out of view, so
// those cases dutifully measured zero draws.

export const BOOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.postFx && MM.world && MM.worldGen && MM.background && MM.fog && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.world && window.player)) return 'FAIL boot-timeout';
	MM.fog.setRevealAll(true);
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	MM.background.importState({cycleT:0.28});     // morning: sun low, so rays/shadows have work
	for(const n of MM.postFx.COMPONENTS) MM.postFx.set(n,false);
	return 'OK '+JSON.stringify({components:MM.postFx.COMPONENTS.length});
})()`;

// One staged stretch of surface carrying work for every pass at once: canopy for
// rays and tree shadows, a pond, an ice sheet, a lava pool, torches, and the hero
// in the middle for the coat.
export const STAGE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world, WG=MM.worldGen;
	const cx=Math.round(player.x), cy=WG.surfaceHeight(cx);
	window.__mmDebugHero(cx, cy-2);
	await sleep(1400);
	const bx=Math.round(player.x), by=WG.surfaceHeight(bx);
	// torches on a back wall (glow + light-tint emitters)
	for(let i=-6;i<=6;i+=3){ W.setTile(bx+i, by-3, 3); W.setTile(bx+i, by-4, 16); }
	// lava pool right (shimmer + tint + glow)
	for(let x=bx+8;x<=bx+15;x++){ W.setTile(x,by,13); W.setTile(x,by-1,0); W.setTile(x,by-2,0); }
	// pond left, then an ice sheet just beyond it (both still inside the window)
	for(let x=bx-9;x<=bx-4;x++){ W.setTile(x,by,8); W.setTile(x,by-1,0); }
	for(let x=bx-17;x<=bx-10;x++){ W.setTile(x,by,12); W.setTile(x,by-1,0); }
	// a trunk with a canopy that has a deliberate gap: tree shadows + god rays
	for(let y=by-1;y>=by-6;y--) W.setTile(bx-2,y,5);
	for(const dx of [-5,-4,-3,-1,0,1]) W.setTile(bx+dx, by-7, 6);
	await sleep(900);
	if(window.player) player.hp=player.maxHp;
	return 'OK '+JSON.stringify({bx,by,lava:W.getTile(bx+10,by),pond:W.getTile(bx-6,by),ice:W.getTile(bx-12,by),trunk:W.getTile(bx-2,by-3),leaf:W.getTile(bx-4,by-7)});
})()`;

// The per-case driver source, shared so both harnesses call the passes with the
// same arguments and the same transform. Emitted into the page as JS.
export const CASES_SRC = `
	const P=await import('/src/engine/post_fx.js');
	const cv=document.getElementById('game');
	const ctx=cv.getContext('2d');
	const W=MM.world, WG=MM.worldGen;
	const TILE=20, SC=2;
	const bx=Math.round(player.x), by=WG.surfaceHeight(bx);
	const setT=()=>ctx.setTransform(SC,0,0,SC, 800-SC*TILE*bx, 500-SC*TILE*by);
	const base={TILE, sx:bx-20, sy:by-14, viewX:40, viewY:28,
		getTile:W.getTile, surfaceHeight:WG.surfaceHeight,
		visibleAt:()=>true, poweredAt:()=>true, frameMs:16,
		isTrunk:(t)=>t===5||t===139||t===140||t===141, isCanopy:(t)=>t===6||t===39,
		time:(MM.background&&MM.background.timeInfo)?MM.background.timeInfo():null,
		daylight:1, rainingAt:()=>true, skipWetTile:()=>false, tileColor:()=>'#808080',
		pools:null, burning:null};
	const body={bx:(player.x-player.w/2)*TILE, by:(player.y-player.h/2)*TILE, bw:player.w*TILE, bh:player.h*TILE};
	const F=P.postFx;
	const glowSrc=(n)=>{ for(let i=0;i<n;i++) F.glow(TILE*(bx+((i*7)%20)-10), TILE*(by-2-((i*3)%6)), {color:'#ffd08a', r:9, a:0.5, trail:(i%3)===0}, 'bench'+i, TILE); };
	const CASES=[
		['glow: tiles only',     ['bloom'],          ()=>F.drawGlowPass(ctx,{...base,now:performance.now()})],
		['glow: +12 entities',   ['bloom'],          ()=>{ glowSrc(12); return F.drawGlowPass(ctx,{...base,now:performance.now()}); }],
		['glow: +40 entities',   ['bloom'],          ()=>{ glowSrc(40); return F.drawGlowPass(ctx,{...base,now:performance.now()}); }],
		['glow: tiles, no bloom',[],                 ()=>F.drawGlowPass(ctx,{...base,now:performance.now()})],
		['lightTint',            ['lightTint'],      ()=>F.drawLightTintPass(ctx,{...base})],
		['heatShimmer',          ['heatShimmer'],    ()=>F.drawHeatShimmerPass(ctx,{...base,now:performance.now()})],
		['iceReflections',       ['iceReflections'], ()=>F.drawIceReflectionsPass(ctx,{...base})],
		['godRays',              ['godRays'],        ()=>F.drawGodRaysPass(ctx,{...base})],
		['treeShadows',          ['shadows'],        ()=>F.drawTreeShadowsPass(ctx,{...base})],
		['wetGround',            ['wetGround'],      ()=>{ window.__mmForceWet=true; return F.drawWetGroundPass(ctx,{...base}); }],
		['dustMotes',            ['dustMotes'],      ()=>F.drawDustMotesPass(ctx,{...base})],
		['heroSheen: grab+coat', ['heroSheen'],      ()=>{ F.captureHeroBackdrop(ctx,{...body,erase:null});
			const r=F.drawHeroSheenPass(ctx,{...body, getTile:W.getTile, tileColor:()=>'#808080', poweredAt:()=>true,
				surfaceHeight:WG.surfaceHeight, px:bx, py:by-2, daylight:1, time:null, submerged:false});
			F.captureHeroScene(ctx); return r; }],
		['casterShadow',         ['shadows'],        ()=>F.drawCasterShadow(ctx,{TILE,x:player.x,w:player.w,h:player.h,groundY:by,k:1,sunlit:true,
			time:(MM.background&&MM.background.timeInfo)?MM.background.timeInfo():null})]
	];
	const drive=(c)=>{ ctx.save(); setT(); let r=0;
		try{ r=c[2]()||0; }catch(e){ errs[c[0]]=String(e && e.message).slice(0,90); }
		ctx.restore(); return r; };
`;
