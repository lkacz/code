// Grafika Ultra: four opt-in, purely cosmetic render passes layered over the
// standard pipeline — bloom (additive halos over emissive tiles), deep ambient
// occlusion (extra chunk-bake shading), specular material glints, and water
// surface reflections. Standard mode stays byte-identical: every hook in
// main.js / water.js is an early-out on the flags below, and all four default
// to OFF. Every pass is display-only — no world writes, no stream plane, no
// hero-state reads in sim code — so multiplayer guests simply render with
// their own local settings (the guest storage lockdown never patches getItem,
// so a persisted choice loads fine; an in-session write is silently dropped).
//
// QA seams: window.__mmNoPostFX forces every pass off (screenshot goldens),
// window.__mmForceGfxUltra forces every pass on without touching storage
// (tile-art-shot --setflag=__mmForceGfxUltra runs before boot, so chunk bakes
// are ultra from the first frame). AO and specular are baked into the chunk
// canvases; the pause-panel toggles clear the render cache on change — a
// mid-session flag flip from the console needs the same clear to fully apply.
import { T, INFO } from '../constants.js';

const HAS_WINDOW = typeof window !== 'undefined';
if(HAS_WINDOW) window.MM = window.MM || {};

export const GFX_ULTRA_KEY = 'mm_gfx_ultra_v1';
export const GFX_COMPONENTS = Object.freeze(['bloom', 'ao', 'specular', 'reflections', 'heroSheen', 'shadows', 'godRays', 'lightTint', 'heatShimmer', 'wetGround', 'dustMotes', 'iceReflections']);

// Persisted shape is a plain {bloom,ao,specular,reflections} boolean object;
// anything else (corrupt JSON, wrong types, missing fields) falls back to
// all-off — standard mode is the failure mode by design.
export function normalizeGfxConfig(raw){
	const out = { bloom:false, ao:false, specular:false, reflections:false, heroSheen:false, shadows:false, godRays:false, lightTint:false, heatShimmer:false, wetGround:false, dustMotes:false, iceReflections:false };
	if(raw && typeof raw === 'object'){
		for(const key of GFX_COMPONENTS) out[key] = raw[key] === true;
	}
	return out;
}
export function parseGfxConfig(json){
	if(typeof json !== 'string' || !json) return normalizeGfxConfig(null);
	try{ return normalizeGfxConfig(JSON.parse(json)); }
	catch(e){ return normalizeGfxConfig(null); }
}

// The emitter rescan is throttled by frame health; the halos themselves are
// drawn every frame from the cached list so camera motion never leaves a
// stale glow behind (positions are world-space, only the LIST is cached).
export function bloomScanIntervalMs(frameMs){
	const ms = Number.isFinite(frameMs) ? frameMs : 16;
	if(ms > 40) return 400;
	if(ms > 24) return 250;
	return 120;
}

// Declarative bloom sources: fixed levels for the classic emitters the
// lighting BFS also knows, INFO[t].lightLevel for powered furnishings, and a
// color table where the default warm white would read wrong. Chest tiles are
// excluded — the pulsing tier aura in drawWorldVisible is already their glow.
const BLOOM_LEVELS = {
	[T.TORCH]: 13,
	[T.LAVA]: 12,
	[T.MOTHER_LAVA]: 12,
	[T.GLOWSHROOM]: 9,
	[T.ALTAR]: 8,
	[T.RADIOACTIVE_ORE]: 8,
	[T.ANTIMATTER_CRYSTAL]: 8
};
const BLOOM_COLORS = {
	[T.TORCH]: '255,176,84',
	[T.LAVA]: '255,124,44',
	[T.MOTHER_LAVA]: '255,124,44',
	[T.GLOWSHROOM]: '96,240,192',
	[T.ALTAR]: '196,128,255',
	[T.RADIOACTIVE_ORE]: '128,255,96',
	[T.ANTIMATTER_CRYSTAL]: '128,220,255'
};
export const BLOOM_MIN_LEVEL = 6;
export const BLOOM_MAX_EMITTERS = 160;

export function bloomSourceFor(t){
	if(INFO[t] && INFO[t].chestTier) return null;
	const fixed = BLOOM_LEVELS[t] || 0;
	const declared = Number(INFO[t] && INFO[t].lightLevel);
	const level = Math.max(fixed, Number.isFinite(declared) ? declared : 0);
	if(level < BLOOM_MIN_LEVEL) return null;
	return { level: Math.min(15, Math.round(level)), color: BLOOM_COLORS[t] || '255,236,190' };
}

// Viewport scan for glow-worthy tiles. visibleAt is the caller's fog/vision
// predicate (worldFxVisible in the live game): an emitter the player has not
// discovered must never bloom through the fog pass that draws after us.
// poweredAt gates furnishings the same way the light field does (lighting.js
// tileEmitterLevel): a device that draws home power blooms only while it runs,
// and fails CLOSED when no predicate is supplied — a dead appliance whose
// sprite renders power-off and whose light is 0 must never halo.
// Past the cap the scan keeps walking and reservoir-replaces deterministically
// (hash % seen), so a lava lake with hundreds of emitters keeps its glow
// spread over the whole window instead of cutting off at a scan-order row.
export function collectBloomEmitters(opts){
	const out = [];
	if(!opts || typeof opts.getTile !== 'function') return out;
	const max = Math.max(1, Number.isFinite(opts.max) ? opts.max : BLOOM_MAX_EMITTERS);
	const visibleAt = typeof opts.visibleAt === 'function' ? opts.visibleAt : null;
	const poweredAt = typeof opts.poweredAt === 'function' ? opts.poweredAt : null;
	let seen = 0;
	for(let y = opts.y0; y <= opts.y1; y++){
		for(let x = opts.x0; x <= opts.x1; x++){
			const t = opts.getTile(x, y);
			if(t === T.AIR || t === T.WATER) continue;
			const src = bloomSourceFor(t);
			if(!src) continue;
			if(INFO[t] && INFO[t].requiresHomePower && !(poweredAt && poweredAt(x, y, t))) continue;
			if(visibleAt && !visibleAt(x, y)) continue;
			seen++;
			const e = { x, y, t, level: src.level, color: src.color };
			if(out.length < max) out.push(e);
			else {
				let h = (x * 374761393 + y * 668265263) | 0;
				h = ((h ^ (h >>> 13)) * 1274126177) | 0;
				h = (h ^ (h >>> 16)) >>> 0;
				const idx = h % seen;
				if(idx < max) out[idx] = e;
			}
		}
	}
	return out;
}

// --- hero sheen (środowiskowa powłoka bohatera) ------------------------------
// A faked environment reflection built like a 2D matcap: each body zone gets
// the color it WOULD mirror — the crown reflects the sky or the cave ceiling,
// the torso reflects walls/vegetation beside the hero, the legs reflect the
// actual ground stood on. Zone colors are SAMPLED from the world model through
// the caller's tile->color table (the minimap palette) — never from the
// framebuffer (the getImageData taboo holds). Nearby glow emitters (the bloom
// table, power-gated like bloom) tint the whole coat the way a torch tints a
// breastplate. The drawn stops CHASE the sampled target exponentially, so a
// biome border, a cave descent or the passing of dawn glides the finish
// instead of snapping between patterns. Cave darkness needs no special case:
// the lighting overlay draws over the hero later in the frame and dims the
// coat together with everything else.
const HERO_SHEEN_WATER = [70, 140, 220];
const HERO_SHEEN_SKY_DAY = [126, 178, 255];
const HERO_SHEEN_SKY_NIGHT = [18, 24, 44];
// rgb cache per tile->color TABLE (WeakMap keyed on the function): the live
// call site passes the same minimapTileColor reference every frame, so parses
// happen once per tile id; a test may bring its own table without poisoning.
const heroSheenRgbCaches = new WeakMap();
function heroSheenTileRgb(tileColor, t){
	let cache = heroSheenRgbCaches.get(tileColor);
	if(!cache){ cache = new Map(); heroSheenRgbCaches.set(tileColor, cache); }
	if(cache.has(t)) return cache.get(t);
	let rgb = null;
	const hex = tileColor(t);
	if(typeof hex === 'string'){
		const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
		if(m){
			const s = m[1];
			rgb = s.length === 3
				? [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]
				: [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
		}
	}
	cache.set(t, rgb);
	return rgb;
}
function mixRgb(a, b, t){
	return [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t
	];
}
function avgRgb(list){
	if(!list.length) return null;
	const out = [0, 0, 0];
	for(const c of list){ out[0] += c[0]; out[1] += c[1]; out[2] += c[2]; }
	return [out[0] / list.length, out[1] / list.length, out[2] / list.length];
}
// One environment probe (~200 tile reads, cadence-limited by the pass): three
// zone averages + the strongest glow emitter in reach. Pure and unit-tested.
export function heroSheenEnvSample(opts){
	const o = opts || {};
	if(typeof o.getTile !== 'function' || typeof o.tileColor !== 'function') return null;
	const px = o.px | 0, py = o.py | 0;
	const daylight = Math.max(0, Math.min(1, Number.isFinite(o.daylight) ? o.daylight : 1));
	// what an OPEN column above the head reflects: the sky — unless the hero is
	// well below the surface, where a tall shaft must read as cave dark, not as
	// a patch of noon blue glowing on the crown
	const surf = (typeof o.surfaceHeight === 'function') ? o.surfaceHeight(px) : null;
	const underground = Number.isFinite(surf) && (py - surf) > 6;
	const sky = underground ? [16, 16, 22] : mixRgb(HERO_SHEEN_SKY_NIGHT, HERO_SHEEN_SKY_DAY, daylight);
	const colorAt = (x, y) => {
		const t = o.getTile(x, y);
		if(t === T.AIR) return null;
		if(t === T.WATER) return HERO_SHEEN_WATER;
		return heroSheenTileRgb(o.tileColor, t);
	};
	// crown: first thing over the head per column — a cave ceiling arrives as
	// its rock color, an open column reflects the sky of the moment
	const above = [];
	for(let dx = -2; dx <= 2; dx++){
		let hit = null;
		for(let dy = 2; dy <= 9 && !hit; dy++) hit = colorAt(px + dx, py - dy);
		above.push(hit || sky);
	}
	// torso: nearest wall/vegetation within reach on either side
	const beside = [];
	for(let dy = -1; dy <= 1; dy++){
		for(const dir of [-1, 1]){
			let hit = null;
			for(let dx = 1; dx <= 5 && !hit; dx++) hit = colorAt(px + dir * dx, py + dy);
			if(hit) beside.push(hit);
		}
	}
	// legs: the actual ground stood on (grass field -> green boots)
	const below = [];
	for(let dx = -2; dx <= 2; dx++){
		let hit = null;
		for(let dy = 1; dy <= 6 && !hit; dy++) hit = colorAt(px + dx, py + dy);
		if(hit) below.push(hit);
	}
	let top = avgRgb(above) || sky;
	let bot = avgRgb(below) || [46, 42, 40];
	let mid = avgRgb(beside) || mixRgb(top, bot, 0.55);
	// open-air ambient: the coat dims with dusk (floor 0.3 — a mirror finish
	// still catches SOMETHING at night); emitters shine AFTER this scaling
	const light = 0.3 + 0.7 * daylight;
	top = [top[0] * light, top[1] * light, top[2] * light];
	mid = [mid[0] * light, mid[1] * light, mid[2] * light];
	bot = [bot[0] * light, bot[1] * light, bot[2] * light];
	// strongest glow emitter in reach tints the coat (bloom table + the same
	// home-power gate bloom uses; fails CLOSED without a predicate)
	let warm = null, warmW = 0;
	for(let dy = -4; dy <= 4; dy++){
		for(let dx = -5; dx <= 5; dx++){
			const t = o.getTile(px + dx, py + dy);
			if(t === T.AIR || t === T.WATER) continue;
			const src = bloomSourceFor(t);
			if(!src) continue;
			if(INFO[t] && INFO[t].requiresHomePower && !(typeof o.poweredAt === 'function' && o.poweredAt(px + dx, py + dy, t))) continue;
			const w = (src.level / 15) * (1 - Math.max(Math.abs(dx), Math.abs(dy)) / 7);
			if(w > warmW){
				warmW = w;
				const p = src.color.split(',');
				warm = [+p[0], +p[1], +p[2]];
			}
		}
	}
	if(warm){
		const k = Math.min(0.55, warmW * 0.8);
		top = mixRgb(top, warm, k * 0.6);
		mid = mixRgb(mid, warm, k);
		bot = mixRgb(bot, warm, k * 0.8);
	}
	if(o.submerged){
		top = mixRgb(top, HERO_SHEEN_WATER, 0.45);
		mid = mixRgb(mid, HERO_SHEEN_WATER, 0.45);
		bot = mixRgb(bot, HERO_SHEEN_WATER, 0.45);
	}
	const fin = (c) => [Math.round(Math.max(0, Math.min(255, c[0]))), Math.round(Math.max(0, Math.min(255, c[1]))), Math.round(Math.max(0, Math.min(255, c[2])))];
	return { top: fin(top), mid: fin(mid), bot: fin(bot) };
}

let sheenCur = null;      // drawn stops (floats) chasing the sampled target
let sheenTarget = null;   // last sampled environment
let sheenKey = '';
let sheenSampleAt = 0;
let sheenChaseAt = 0;

// --- dynamic shadows (dynamiczne cienie) -------------------------------------
// Sun-driven ground shadows. The solar model matches the visible celestial
// pass (background.js celestialPosition: the sun RISES on the screen LEFT), so
// morning shadows stretch right (+x), noon shadows sit short and dense under
// the caster, evening shadows stretch left. The moon sweeps the SAME
// left-to-right arc (moonPosition shares celestialPosition, and the night's
// tDay is the moon's own frac), so moonlit shadows keep the sun's sign — just
// faint, scaled by the streamed moonlight level; no moon, no shadow.
export function shadowParams(time){
	const t = time && Number.isFinite(time.tDay) ? Math.max(0, Math.min(1, time.tDay)) : 0.5;
	const arc = Math.sin(t * Math.PI);
	const dir = Math.cos(t * Math.PI); // +1 rise (light source left, shadow right) .. -1 set
	const day = !time || time.isDay !== false;
	if(day){
		return { skew: dir * (0.6 + 1.3 * (1 - arc)), stretch: 0.5 + 1.9 * (1 - arc), alpha: 0.18 + 0.14 * arc };
	}
	const moon = time && Number.isFinite(time.moonlight) ? Math.max(0, Math.min(0.22, time.moonlight)) : 0;
	if(moon <= 0.005) return { skew: 0, stretch: 0, alpha: 0 };
	return { skew: dir * 1.1, stretch: 1.1, alpha: 0.10 * (moon / 0.22) };
}

let treeShadows = [];
let treeShadowKey = '';
let treeShadowScanAt = 0;

// --- live pass state (browser only) -----------------------------------------
const glowSprites = new Map(); // color string -> prerendered radial sprite
function glowSpriteFor(color){
	if(typeof document === 'undefined') return null;
	let spr = glowSprites.get(color);
	if(spr) return spr;
	const c = document.createElement('canvas');
	c.width = 64; c.height = 64;
	const g = c.getContext('2d');
	if(!g) return null;
	const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
	grad.addColorStop(0, 'rgba(' + color + ',0.55)');
	grad.addColorStop(0.45, 'rgba(' + color + ',0.18)');
	grad.addColorStop(1, 'rgba(' + color + ',0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, 64, 64);
	glowSprites.set(color, spr = c);
	return spr;
}

// Wet-ground model: rain soaks the surface in ~8 s, dry-out takes ~45 s.
// Pure so the suite can pin the rates; the live pass integrates per frame.
export function wetGroundStep(wetness, dtSec, raining){
	const w = Number.isFinite(wetness) ? wetness : 0;
	const dt = Math.max(0, Math.min(0.25, Number.isFinite(dtSec) ? dtSec : 0));
	return Math.max(0, Math.min(1, raining ? w + dt / 8 : w - dt / 45));
}

// Canopy-gap finder for god rays: a beam site is a run of open surface
// columns (width<=4) flanked by canopy (leaves/wood within 14 tiles above the
// surface) on both sides — the classic hole in the forest roof. Pure and
// injected with predicates so the suite can drive it with a fake world.
export function collectCanopyGaps(opts){
	const out = [];
	if(!opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function' || typeof opts.isCanopy !== 'function') return out;
	const maxBeams = Number.isFinite(opts.maxBeams) ? opts.maxBeams : 24;
	const canopyTop = (x, surf) => {
		for(let dy = 1; dy <= 14; dy++){
			if(opts.isCanopy(opts.getTile(x, surf - dy))) {
				let top = surf - dy;
				for(let up = dy + 1; up <= 14; up++){ if(opts.isCanopy(opts.getTile(x, surf - up))) top = surf - up; }
				return top;
			}
		}
		return null;
	};
	let x = opts.x0;
	while(x <= opts.x1 && out.length < maxBeams){
		const surf = opts.surfaceHeight(x);
		if(!Number.isFinite(surf) || canopyTop(x, surf) !== null){ x++; continue; }
		let end = x;
		while(end + 1 <= opts.x1 && end - x < 3){
			const s2 = opts.surfaceHeight(end + 1);
			if(!Number.isFinite(s2) || canopyTop(end + 1, s2) !== null) break;
			end++;
		}
		const leftTop = x - 1 >= opts.x0 - 2 ? canopyTop(x - 1, opts.surfaceHeight(x - 1)) : null;
		const rightTop = canopyTop(end + 1, opts.surfaceHeight(end + 1));
		if(leftTop !== null && rightTop !== null){
			let groundY = surf, groundX = x;
			for(let gx = x; gx <= end; gx++){ const s3 = opts.surfaceHeight(gx); if(Number.isFinite(s3) && s3 > groundY){ groundY = s3; groundX = gx; } }
			out.push({ x0: x, x1: end, groundX, topY: Math.min(leftTop, rightTop), groundY });
		}
		x = end + 1;
	}
	return out;
}

// Ice-run finder: frozen water lives at the WATER LINE, which sits ABOVE the
// worldgen ground row for every lake/sea (the bed is clay/dirt) — so the scan
// uses the repo's anchor-then-scan-down convention (soft_drifts/thin_ice):
// from well above the terrain anchor, the FIRST blocking tile decides. The
// break is load-bearing: without it the scan would dig into underground cave
// ice and mirror inside caves. Pure and injected so the suite can pin the
// lake geometry (ice rows above the bed row) directly.
export function collectIceRuns(opts){
	const out = [];
	if(!opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function') return out;
	const max = Number.isFinite(opts.max) ? opts.max : 140;
	for(let x = opts.x0; x <= opts.x1 && out.length < max; x++){
		const anchor = opts.surfaceHeight(x);
		if(!Number.isFinite(anchor)) continue;
		const from = Math.max(1, Math.floor(anchor) - 40);
		for(let y = from; y <= Math.floor(anchor); y++){
			const t = opts.getTile(x, y);
			if(t === T.AIR) continue;
			if(t === T.ICE || t === T.MOTHER_ICE || t === T.THIN_ICE) out.push({ x, surf: y });
			break;
		}
	}
	return out;
}

const config = normalizeGfxConfig(null);
const metrics = { bloomScans: 0, bloomEmitters: 0, bloomDraws: 0, reflectionColumns: 0, specGlints: 0, heroSheenDraws: 0, shadowDraws: 0, godRayBeams: 0, tintDraws: 0, shimmerSlices: 0, wetSheenColumns: 0, dustMotes: 0, iceColumns: 0 };
let bloomEmitters = [];
let bloomScanAt = 0;
let bloomScanKey = '';
let godRayBeams = [];
let godRayKey = '';
let godRayScanAt = 0;
let iceRuns = [];
let iceRunKey = '';
let iceRunScanAt = 0;
let wetness = 0;
let wetLastAt = 0;
let selfBlitCanvas = null;
let selfBlitCtx = null;

// Self-blit staging: drawing a canvas onto itself once per SLICE is the
// pattern water.js deliberately avoids — snapshot the scene ONCE per pass
// into a reused scratch and blit slices from the copy instead.
function snapshotSceneCanvas(srcCanvas){
	if(typeof document === 'undefined' || !srcCanvas || !(srcCanvas.width > 0)) return null;
	if(!selfBlitCanvas){
		selfBlitCanvas = document.createElement('canvas');
		selfBlitCtx = selfBlitCanvas.getContext('2d');
	}
	if(!selfBlitCtx) return null;
	if(selfBlitCanvas.width !== srcCanvas.width || selfBlitCanvas.height !== srcCanvas.height){
		selfBlitCanvas.width = srcCanvas.width;
		selfBlitCanvas.height = srcCanvas.height;
	}
	selfBlitCtx.setTransform(1, 0, 0, 1, 0, 0);
	selfBlitCtx.clearRect(0, 0, selfBlitCanvas.width, selfBlitCanvas.height);
	selfBlitCtx.drawImage(srcCanvas, 0, 0);
	return selfBlitCanvas;
}

// --- hero mirror backdrop -----------------------------------------------------
// The coat's reflection is REAL: a rect of the finished scene around the hero,
// grabbed BEFORE the sprite is drawn (so the hero can never reflect itself) and
// blitted back over the body flipped and compressed. drawImage-only — the
// getImageData taboo holds. The grab is downscaled on the way in, which both
// caps the scratch and pre-blurs the image the way a curved surface would.
// Field of view the coat mirrors, in body sizes. Kept deliberately tight: a
// 14x19px sprite squeezing half a screen into itself is a smear, while ~4x3
// tiles keeps whole features (a trunk, the ground line, a torch) recognisable.
const HERO_MIRROR_SPREAD_X = 5;
const HERO_MIRROR_SPREAD_Y = 3;
const HERO_MIRROR_MAX_PX = 256;
let heroMirrorCanvas = null;
let heroMirrorCtx = null;
let heroMirrorFresh = false;
let heroMirrorUsed = false;
let heroCoatCanvas = null;
let heroCoatCtx = null;
// Barrel mapping from a destination band (0..1 down the body) to the source
// band of the grab. Exponent > 1 keeps the middle of the field large and
// squeezes the periphery — the signature look of a curved mirror. Exported for
// the unit test: the shape of this curve IS the effect.
export function heroMirrorCurve(v){
	const u = 2 * Math.max(0, Math.min(1, v)) - 1;
	return 0.5 + 0.5 * Math.sign(u) * Math.pow(Math.abs(u), 1.6);
}

// Assemble one frame of the coat off-screen: the grabbed field, flipped and
// bent through the barrel curve, then masked by a Fresnel falloff (thin over
// the middle, near-solid at the rim). Masking needs its own canvas — a
// destination-in fill on the live scene would erase the world.
function buildHeroCoat(ctx, mirror, bw, bh){
	if(typeof document === 'undefined' || !(bw > 0) || !(bh > 0)) return null;
	let m = null;
	try{ m = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null; }catch(e){ m = null; }
	const sxScale = (m && Number.isFinite(m.a) && m.a > 0) ? m.a : 1;
	const syScale = (m && Number.isFinite(m.d) && m.d > 0) ? m.d : 1;
	const w = Math.max(4, Math.min(512, Math.round(bw * sxScale)));
	const h = Math.max(4, Math.min(512, Math.round(bh * syScale)));
	if(!heroCoatCanvas){
		heroCoatCanvas = document.createElement('canvas');
		heroCoatCtx = heroCoatCanvas.getContext('2d');
	}
	if(!heroCoatCtx) return null;
	if(heroCoatCanvas.width !== w || heroCoatCanvas.height !== h){
		heroCoatCanvas.width = w;
		heroCoatCanvas.height = h;
	}
	const g = heroCoatCtx;
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.clearRect(0, 0, w, h);
	g.globalCompositeOperation = 'source-over';
	g.imageSmoothingEnabled = true;
	// mirror image: flip horizontally by drawing under a negated x axis
	g.setTransform(-1, 0, 0, 1, w, 0);
	const bands = 7;
	for(let i = 0; i < bands; i++){
		const v0 = i / bands, v1 = (i + 1) / bands;
		const s0 = heroMirrorCurve(v0), s1 = heroMirrorCurve(v1);
		const sy0 = s0 * mirror.height;
		const shh = Math.max(1, (s1 - s0) * mirror.height);
		// +1px of overlap keeps the bands from seaming apart
		g.drawImage(mirror, 0, sy0, mirror.width, shh, 0, v0 * h, w, h / bands + 1);
	}
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.globalCompositeOperation = 'destination-in';
	const mask = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.62);
	mask.addColorStop(0, 'rgba(0,0,0,0.30)');
	mask.addColorStop(0.55, 'rgba(0,0,0,0.52)');
	mask.addColorStop(1, 'rgba(0,0,0,1)');
	g.fillStyle = mask;
	g.fillRect(0, 0, w, h);
	g.globalCompositeOperation = 'source-over';
	return heroCoatCanvas;
}

// The emitter scan is SHARED by bloom, light-tint and heat-shimmer: one
// cadence-cached viewport walk, three different draws over the same list.
function ensureEmitterScan(opts){
	if(!opts || typeof opts.getTile !== 'function') return bloomEmitters;
	const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
	const x0 = Math.floor(opts.sx) - 2, y0 = Math.floor(opts.sy) - 2;
	const x1 = Math.ceil(opts.sx + opts.viewX) + 2, y1 = Math.ceil(opts.sy + opts.viewY) + 2;
	const key = x0 + ',' + y0 + ',' + x1 + ',' + y1;
	if(key !== bloomScanKey || now - bloomScanAt > bloomScanIntervalMs(opts.frameMs)){
		bloomEmitters = collectBloomEmitters({ x0, x1, y0, y1, getTile: opts.getTile, visibleAt: opts.visibleAt, poweredAt: opts.poweredAt, max: BLOOM_MAX_EMITTERS });
		bloomScanAt = now; bloomScanKey = key;
		metrics.bloomScans++;
	}
	metrics.bloomEmitters = bloomEmitters.length;
	return bloomEmitters;
}

function loadConfig(){
	let json = null;
	try{ json = (typeof localStorage !== 'undefined') ? localStorage.getItem(GFX_ULTRA_KEY) : null; }catch(e){ json = null; }
	const loaded = parseGfxConfig(json);
	for(const key of GFX_COMPONENTS) config[key] = loaded[key];
	return config;
}
function saveConfig(){
	try{ if(typeof localStorage !== 'undefined') localStorage.setItem(GFX_ULTRA_KEY, JSON.stringify(config)); }catch(e){}
}

const api = {
	KEY: GFX_ULTRA_KEY,
	COMPONENTS: GFX_COMPONENTS,
	config,
	metrics,
	load: loadConfig,
	save: saveConfig,
	set(name, value){
		if(!GFX_COMPONENTS.includes(name)) return false;
		config[name] = value === true;
		saveConfig();
		return config[name];
	},
	// Effective flag: the QA kill switch beats everything, the QA force flag
	// beats storage, otherwise the persisted per-component choice decides.
	on(name){
		if(HAS_WINDOW && window.__mmNoPostFX) return false;
		if(HAS_WINDOW && window.__mmForceGfxUltra) return true;
		return config[name] === true;
	},
	anyOn(){
		for(const key of GFX_COMPONENTS) if(api.on(key)) return true;
		return false;
	},
	// Frees the full-frame snapshot scratch once neither self-blit consumer
	// needs it (settings handlers call this on toggle-off; the gated call
	// sites cannot, because an off pass is never invoked).
	releaseScratch(){
		if(!config.heroSheen){ heroMirrorCanvas = null; heroMirrorCtx = null; heroCoatCanvas = null; heroCoatCtx = null; heroMirrorFresh = false; }
		if(!config.heatShimmer && !config.iceReflections){ selfBlitCanvas = null; selfBlitCtx = null; return true; }
		return false;
	},
	// QA seam: the current (chased) coat stops plus whether the last draw used a
	// real mirrored backdrop — lets a live driver assert "green over grass, warm
	// near a torch, mirror actually blitted" without pixel readbacks.
	_sheenState(){
		if(!sheenCur) return null;
		return {
			top: sheenCur.top.map(Math.round),
			mid: sheenCur.mid.map(Math.round),
			bot: sheenCur.bot.map(Math.round),
			mirrored: heroMirrorUsed
		};
	},
	// Grab the world behind the hero. MUST be called in world space BEFORE the
	// hero sprite is drawn; the snapshot is consumed by the very next
	// drawHeroSheenPass and then invalidated, so a pass without a fresh grab
	// (mock contexts, screenshot tools) falls back to the sampled tint alone.
	captureHeroBackdrop(ctx, opts){
		heroMirrorFresh = false;
		if(!api.on('heroSheen')) return 0;
		if(typeof document === 'undefined') return 0;
		if(!ctx || !ctx.canvas || !opts || !(opts.bw > 0) || !(opts.bh > 0)) return 0;
		let m = null;
		try{ m = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null; }catch(e){ m = null; }
		if(!m || !Number.isFinite(m.a) || m.a <= 0 || !Number.isFinite(m.d) || m.d <= 0) return 0;
		const src = ctx.canvas;
		if(!(src.width > 0) || !(src.height > 0)) return 0;
		const fw = opts.bw * HERO_MIRROR_SPREAD_X, fh = opts.bh * HERO_MIRROR_SPREAD_Y;
		// the mirrored field sits a little high: more sky/ceiling than floor,
		// which is what a standing figure actually catches
		const cx = opts.bx + opts.bw * 0.5, cy = opts.by + opts.bh * 0.5 - opts.bh * 0.25;
		const dx0 = m.a * (cx - fw * 0.5) + m.e, dy0 = m.d * (cy - fh * 0.5) + m.f;
		const sx = Math.max(0, Math.floor(dx0)), sy = Math.max(0, Math.floor(dy0));
		const ex = Math.min(src.width, Math.ceil(dx0 + m.a * fw));
		const ey = Math.min(src.height, Math.ceil(dy0 + m.d * fh));
		const sw = ex - sx, sh = ey - sy;
		if(!(sw > 4) || !(sh > 4)) return 0; // hero at the very screen edge
		if(!heroMirrorCanvas){
			heroMirrorCanvas = document.createElement('canvas');
			heroMirrorCtx = heroMirrorCanvas.getContext('2d');
		}
		if(!heroMirrorCtx) return 0;
		const k = Math.min(1, HERO_MIRROR_MAX_PX / Math.max(sw, sh));
		const cw = Math.max(4, Math.round(sw * k)), ch = Math.max(4, Math.round(sh * k));
		if(heroMirrorCanvas.width !== cw || heroMirrorCanvas.height !== ch){
			heroMirrorCanvas.width = cw;
			heroMirrorCanvas.height = ch;
		}
		heroMirrorCtx.setTransform(1, 0, 0, 1, 0, 0);
		heroMirrorCtx.clearRect(0, 0, cw, ch);
		heroMirrorCtx.imageSmoothingEnabled = true;
		heroMirrorCtx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
		heroMirrorFresh = true;
		return 1;
	},
	// Bloom frame driver. Runs in WORLD space (main.js calls it under the world
	// transform, after the darkness overlay and before fog): emitter list is
	// rescanned on a frame-health cadence or when the tile window moves; halos
	// draw every frame so panning cannot smear or lag them.
	drawBloomPass(ctx, opts){
		if(!api.on('bloom')){ if(!api.on('lightTint') && !api.on('heatShimmer')){ bloomEmitters.length = 0; bloomScanKey = ''; } return 0; }
		if(!ctx || !opts || typeof opts.getTile !== 'function') return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		ensureEmitterScan(opts);
		if(!bloomEmitters.length) return 0;
		const tSec = now / 1000;
		let drawn = 0;
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		ctx.imageSmoothingEnabled = true;
		for(const e of bloomEmitters){
			const spr = glowSpriteFor(e.color);
			if(!spr) break;
			const pulse = 0.82 + 0.18 * Math.sin(tSec * 2.1 + e.x * 0.73 + e.y * 0.41);
			const r = TILE * (0.7 + e.level * 0.2) * pulse;
			ctx.globalAlpha = Math.min(0.68, 0.3 + e.level * 0.018);
			ctx.drawImage(spr, e.x * TILE + TILE * 0.5 - r, e.y * TILE + TILE * 0.5 - r, r * 2, r * 2);
			drawn++;
		}
		ctx.restore();
		metrics.bloomDraws += drawn;
		return drawn;
	},
	// Hero coating frame driver. Runs in WORLD space right after the hero
	// sprite. Environment is resampled on a short cadence (or when the hero
	// changes tile / dives), the drawn stops chase it exponentially, and the
	// coat is painted in two layers: a source-over tint that carries the REAL
	// hue of the surroundings (additive-only washed everything toward white)
	// and an additive gloss (crown rim + one slow travelling highlight).
	drawHeroSheenPass(ctx, opts){
		if(!api.on('heroSheen')) return 0;
		if(!ctx || !opts || !(opts.bw > 0) || !(opts.bh > 0)) return 0;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const key = (opts.px | 0) + '|' + (opts.py | 0) + '|' + (opts.submerged ? 1 : 0);
		if(!sheenTarget || key !== sheenKey || now - sheenSampleAt > 240){
			const sampled = heroSheenEnvSample(opts);
			if(sampled) sheenTarget = sampled;
			sheenKey = key; sheenSampleAt = now;
		}
		// neutral steel finish until the first successful probe (headless mocks)
		const target = sheenTarget || { top: [150, 170, 200], mid: [120, 130, 150], bot: [90, 95, 105] };
		if(!sheenCur){
			sheenCur = { top: target.top.slice(), mid: target.mid.slice(), bot: target.bot.slice() };
		} else {
			const dt = Math.min(0.25, Math.max(0, (now - sheenChaseAt) / 1000));
			const k = 1 - Math.exp(-dt / 0.4);
			for(const zone of ['top', 'mid', 'bot']){
				const cur = sheenCur[zone], tgt = target[zone];
				for(let i = 0; i < 3; i++) cur[i] += (tgt[i] - cur[i]) * k;
			}
		}
		sheenChaseAt = now;
		const bx = opts.bx, by = opts.by, bw = opts.bw, bh = opts.bh;
		const rgb = (z) => Math.round(sheenCur[z][0]) + ',' + Math.round(sheenCur[z][1]) + ',' + Math.round(sheenCur[z][2]);
		const mirror = (heroMirrorFresh && heroMirrorCanvas && heroMirrorCanvas.width > 0) ? heroMirrorCanvas : null;
		heroMirrorUsed = !!mirror;
		heroMirrorFresh = false; // one grab feeds exactly one draw
		const daylight = Math.max(0, Math.min(1, Number.isFinite(opts.daylight) ? opts.daylight : 1));
		ctx.save();
		// The outfit is a plain filled RECT with a 1px outline (inventory.js
		// drawOutfit) — clip to that whole rect, inset by a pixel so the outline
		// stays crisp. An inset rounded capsule used to leave the coat looking
		// like a sticker floating inside the sprite.
		ctx.beginPath();
		ctx.rect(bx + 1, by + 1, bw - 2, bh - 2);
		ctx.clip();
		// Base wash: the sampled environment carries hue the mirror can miss —
		// the layers drawn after the hero (plants, mobs, the water overlay) are
		// not in the grab, and a torch just out of frame still belongs on the
		// coat. Weak under a live mirror, the whole effect without one.
		const baseA = mirror ? 0.14 : 0.42;
		const grad = ctx.createLinearGradient(0, by, 0, by + bh);
		grad.addColorStop(0, 'rgba(' + rgb('top') + ',' + baseA.toFixed(2) + ')');
		grad.addColorStop(0.52, 'rgba(' + rgb('mid') + ',' + (baseA * 0.82).toFixed(2) + ')');
		grad.addColorStop(1, 'rgba(' + rgb('bot') + ',' + (baseA * 0.95).toFixed(2) + ')');
		ctx.fillStyle = grad;
		ctx.fillRect(bx, by, bw, bh);
		const coat = mirror ? buildHeroCoat(ctx, mirror, bw, bh) : null;
		if(coat){
			// Fresnel-masked blit: a polished surface mirrors hardest where it
			// turns away from the viewer, so the coat is near-opaque at the rim
			// and thin over the middle — which is also what keeps the hero's face
			// and outfit readable instead of replacing the sprite with a window.
			ctx.save();
			ctx.imageSmoothingEnabled = true;
			ctx.globalAlpha = 0.72;
			ctx.drawImage(coat, bx, by, bw, bh);
			ctx.restore();
		}
		ctx.globalCompositeOperation = 'lighter';
		// Specular highlight on the side the light comes from (same solar model
		// as the shadows: the sun rises on the SCREEN LEFT). It is anchored to
		// the body, so a standing hero shows a still highlight.
		const t = (opts.time && Number.isFinite(opts.time.tDay)) ? Math.max(0, Math.min(1, opts.time.tDay)) : 0.5;
		const dir = (opts.time && opts.time.isDay === false) ? 0 : Math.cos(t * Math.PI);
		const hx = bx + bw * (0.5 - dir * 0.26), hy = by + bh * 0.28;
		const spec = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(bw, bh) * 0.55);
		spec.addColorStop(0, 'rgba(255,255,255,' + (0.12 + 0.16 * daylight).toFixed(3) + ')');
		spec.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = spec;
		ctx.fillRect(bx, by, bw, bh);
		// Fresnel-ish edges: a polished surface is brightest where it turns away
		const edge = ctx.createLinearGradient(bx, 0, bx + bw, 0);
		edge.addColorStop(0, 'rgba(255,255,255,0.16)');
		edge.addColorStop(0.22, 'rgba(255,255,255,0)');
		edge.addColorStop(0.78, 'rgba(255,255,255,0)');
		edge.addColorStop(1, 'rgba(255,255,255,0.16)');
		ctx.fillStyle = edge;
		ctx.fillRect(bx, by, bw, bh);
		ctx.restore();
		metrics.heroSheenDraws++;
		return 1;
	},
	// One ground shadow for one caster (hero / remote body / mob). sunlit=false
	// (caves) keeps the classic ambient blob byte-for-byte so jump arcs still
	// read underground; sunlit=true swaps in the directional sun/moon shadow.
	// Returns 1 whenever the caster was HANDLED — a moonless night draws
	// nothing on purpose and must not fall back to the static blob.
	drawCasterShadow(ctx, opts){
		if(!ctx || !opts || !(opts.k > 0)) return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const k = Math.min(1, opts.k);
		const fx = opts.x * TILE, gy = opts.groundY * TILE + 2;
		const bw = (opts.w || 0.9) * TILE, bh = (opts.h || 1) * TILE;
		const size = 0.55 + 0.45 * k;
		if(!opts.sunlit){
			ctx.fillStyle = 'rgba(0,0,0,' + (0.25 * k).toFixed(3) + ')';
			ctx.beginPath(); ctx.ellipse(fx, gy, bw * 0.6 * size / 2, 4 * size, 0, 0, Math.PI * 2); ctx.fill();
			metrics.shadowDraws++;
			return 1;
		}
		const p = shadowParams(opts.time);
		if(p.alpha <= 0.005) return 1;
		const rx = Math.max(bw * 0.35, bw * 0.5 + bh * p.stretch * 0.45) * size;
		ctx.fillStyle = 'rgba(6,8,16,' + (p.alpha * k).toFixed(3) + ')';
		ctx.beginPath(); ctx.ellipse(fx + p.skew * bh * 0.45 * size, gy, rx, 4.4 * size, 0, 0, Math.PI * 2); ctx.fill();
		metrics.shadowDraws++;
		return 1;
	},
	// Tree shadows: trunk columns found by a cadence-cached scan of the visible
	// surface (trees do not move — the list rescans only when the window shifts
	// or every 400 ms). Each tree casts one elongated ground ellipse whose
	// reach and lean follow the trunk height and the solar arc. visibleAt is
	// the fog predicate: an undiscovered forest must not announce itself.
	drawTreeShadowsPass(ctx, opts){
		if(!api.on('shadows')){ treeShadowKey = ''; treeShadows.length = 0; return 0; }
		if(!ctx || !opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function' || typeof opts.isTrunk !== 'function') return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const x0 = Math.floor(opts.sx) - 2, x1 = Math.ceil(opts.sx + opts.viewX) + 2;
		const key = x0 + '|' + x1;
		if(key !== treeShadowKey || now - treeShadowScanAt > 400){
			treeShadows.length = 0;
			for(let x = x0; x <= x1 && treeShadows.length < 48; x++){
				const surf = opts.surfaceHeight(x);
				if(!Number.isFinite(surf)) continue;
				if(!opts.isTrunk(opts.getTile(x, surf - 1))) continue;
				let h = 1;
				while(h < 14 && opts.isTrunk(opts.getTile(x, surf - 1 - h))) h++;
				if(h < 3) continue; // planks and stumps stay shadowless
				treeShadows.push({ x, surf, h });
			}
			treeShadowKey = key; treeShadowScanAt = now;
		}
		if(!treeShadows.length) return 0;
		const p = shadowParams(opts.time);
		if(p.alpha <= 0.005) return 0;
		const visibleAt = typeof opts.visibleAt === 'function' ? opts.visibleAt : null;
		let drawn = 0;
		ctx.fillStyle = 'rgba(6,8,16,' + (p.alpha * 0.85).toFixed(3) + ')';
		for(const tr of treeShadows){
			if(visibleAt && !visibleAt(tr.x, tr.surf)) continue;
			const reach = Math.max(TILE * 0.5, tr.h * p.stretch * 0.55 * TILE);
			ctx.beginPath();
			ctx.ellipse((tr.x + 0.5) * TILE + p.skew * tr.h * 0.35 * TILE, tr.surf * TILE + 2, reach, 4.4, 0, 0, Math.PI * 2);
			ctx.fill();
			drawn++;
		}
		metrics.shadowDraws += drawn;
		return drawn;
	},
	// Light temperature: broad, soft, source-over ambience around the SAME
	// cached emitters bloom uses — warm amber floods around torches and lava,
	// teal around glowshrooms, green around radioactive ore. Where bloom is the
	// tight bright core, this is the room-filling color wash over the darkness
	// overlay painted just before it.
	drawLightTintPass(ctx, opts){
		if(!api.on('lightTint')) return 0;
		if(!ctx || !opts || typeof opts.getTile !== 'function') return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const emitters = ensureEmitterScan(opts);
		if(!emitters.length) return 0;
		// The washes are ~7x bloom's sprite area and overlapping ones saturate to
		// a flat wall of color anyway: dedupe to one wash per 8x8-tile cell and
		// budget the fill rate like the sibling passes.
		const cap = (Number.isFinite(opts.frameMs) && opts.frameMs > 28) ? 24 : 64;
		const cells = new Set();
		let drawn = 0;
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		for(const e of emitters){
			if(drawn >= cap) break;
			const cell = (e.x >> 3) + ',' + (e.y >> 3);
			if(cells.has(cell)) continue;
			cells.add(cell);
			const spr = glowSpriteFor(e.color);
			if(!spr) break;
			const r = TILE * (2.6 + e.level * 0.4);
			ctx.globalAlpha = Math.min(0.26, 0.08 + e.level * 0.010);
			ctx.drawImage(spr, e.x * TILE + TILE * 0.5 - r, e.y * TILE + TILE * 0.5 - r, r * 2, r * 2);
			drawn++;
		}
		ctx.restore();
		metrics.tintDraws += drawn;
		return drawn;
	},
	// God rays: additive light shafts through canopy gaps, leaning with the
	// same solar model the shadows use (a beam points the way shadows fall).
	// Gap sites come from a cadence-cached scan; strongest at golden hour.
	drawGodRaysPass(ctx, opts){
		if(!api.on('godRays')){ godRayKey = ''; godRayBeams.length = 0; return 0; }
		if(!ctx || !opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function' || typeof opts.isCanopy !== 'function') return 0;
		const time = opts.time;
		if(time && time.isDay === false) return 0;
		const t = time && Number.isFinite(time.tDay) ? Math.max(0, Math.min(1, time.tDay)) : 0.5;
		const arc = Math.sin(t * Math.PI);
		const daylight = Math.max(0, Math.min(1, Number.isFinite(opts.daylight) ? opts.daylight : 1));
		const alpha = daylight * (0.11 + 0.15 * (1 - arc));
		if(alpha <= 0.01) return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const x0 = Math.floor(opts.sx) - 2, x1 = Math.ceil(opts.sx + opts.viewX) + 2;
		const key = x0 + '|' + x1;
		if(key !== godRayKey || now - godRayScanAt > 400){
			godRayBeams = collectCanopyGaps({ x0, x1, getTile: opts.getTile, surfaceHeight: opts.surfaceHeight, isCanopy: opts.isCanopy, maxBeams: 24 });
			godRayKey = key; godRayScanAt = now;
		}
		if(!godRayBeams.length) return 0;
		const p = shadowParams(time);
		const visibleAt = typeof opts.visibleAt === 'function' ? opts.visibleAt : null;
		let drawn = 0;
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		for(const b of godRayBeams){
			// probe the fog on the column that produced the beam's landing row —
			// x0 may be a shallower column whose visibility says nothing about it
			if(visibleAt && !visibleAt(Number.isFinite(b.groundX) ? b.groundX : b.x0, b.groundY)) continue;
			const topPx = b.topY * TILE, groundPx = b.groundY * TILE;
			const h = groundPx - topPx;
			if(h <= TILE) continue;
			// the beam's MOUTH is the canopy gap: anchor the top there and lean
			// the FOOT along the light direction (the way shadows fall); the
			// clamp keeps an unusually tall beam from sliding its foot into
			// columns the gap never measured
			const drop = Math.max(-4 * TILE, Math.min(4 * TILE, p.skew * h * 0.5));
			const gx0 = b.x0 * TILE, gx1 = (b.x1 + 1) * TILE;
			const grad = ctx.createLinearGradient(0, topPx, 0, groundPx);
			grad.addColorStop(0, 'rgba(255,244,200,' + alpha.toFixed(3) + ')');
			grad.addColorStop(1, 'rgba(255,244,200,' + (alpha * 0.45).toFixed(3) + ')');
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(gx0, topPx);
			ctx.lineTo(gx1, topPx);
			ctx.lineTo(gx1 + drop, groundPx);
			ctx.lineTo(gx0 + drop, groundPx);
			ctx.closePath();
			ctx.fill();
			drawn++;
		}
		ctx.restore();
		metrics.godRayBeams += drawn;
		return drawn;
	},
	// Heat shimmer: thin self-blit slices above open-air lava (from the shared
	// emitter cache) and geothermal pools, each shifted by a phase-offset sine.
	// drawImage-only, like the water reflections — the readback taboo holds.
	drawHeatShimmerPass(ctx, opts){
		if(!api.on('heatShimmer')){
			if(!api.on('iceReflections') && selfBlitCanvas){ selfBlitCanvas = null; selfBlitCtx = null; }
			return 0;
		}
		if(!ctx || !opts || typeof opts.getTile !== 'function' || !ctx.canvas) return 0;
		let m = null;
		try{ m = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null; }catch(e){ m = null; }
		if(!m || !Number.isFinite(m.a) || m.a <= 0 || !Number.isFinite(m.d) || m.d <= 0) return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const stressed = Number.isFinite(opts.frameMs) && opts.frameMs > 28;
		const cap = stressed ? 12 : 30;
		const emitters = ensureEmitterScan(opts);
		const sources = [];
		for(const e of emitters){
			if(sources.length >= cap) break;
			if((e.t === T.LAVA || e.t === T.MOTHER_LAVA) && opts.getTile(e.x, e.y - 1) === T.AIR) sources.push({ x: e.x, y: e.y });
		}
		if(Array.isArray(opts.pools)){
			for(const p of opts.pools){
				if(sources.length >= cap) break;
				if(p && Number.isFinite(p.x) && Number.isFinite(p.y)) sources.push({ x: p.x, y: p.y });
			}
		}
		if(!sources.length) return 0;
		const srcCanvas = snapshotSceneCanvas(ctx.canvas);
		if(!srcCanvas) return 0;
		let slices = 0;
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		for(const s of sources){
			for(let i = 0; i < 3; i++){
				const wyPx = s.y * TILE - 4 - i * 4;
				const wxPx = s.x * TILE;
				const sxDev = m.a * wxPx + m.e, swDev = m.a * TILE;
				const syDev = m.d * wyPx + m.f, shDev = m.d * 4;
				if(sxDev < 0 || sxDev + swDev > srcCanvas.width || syDev < 0 || syDev + shDev > srcCanvas.height) continue;
				const wob = Math.sin(now * 0.006 + i * 1.7 + s.x * 0.9) * (2.6 - i * 0.6);
				ctx.drawImage(srcCanvas, sxDev, syDev, swDev, shDev, wxPx + wob, wyPx, TILE, 4);
				slices++;
			}
		}
		ctx.restore();
		metrics.shimmerSlices += slices;
		return slices;
	},
	// Wet ground: rain soaks the surface (wetGroundStep model), leaving a
	// fading sheen line on non-frozen ground and splash ticks while it pours.
	// QA seam: window.__mmForceWet pins wetness to 1 without weather.
	drawWetGroundPass(ctx, opts){
		if(!api.on('wetGround')){ wetness = 0; wetLastAt = 0; return 0; }
		if(!ctx || !opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function') return 0;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const dtSec = wetLastAt > 0 ? (now - wetLastAt) / 1000 : 0;
		wetLastAt = now;
		const rainingAt = typeof opts.rainingAt === 'function' ? opts.rainingAt : null;
		const centerX = Math.floor(opts.sx + opts.viewX * 0.5);
		const raining = !!(rainingAt && rainingAt(centerX));
		wetness = wetGroundStep(wetness, dtSec, raining);
		if(HAS_WINDOW && window.__mmForceWet) wetness = 1;
		if(wetness <= 0.02) return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const daylight = Math.max(0, Math.min(1, Number.isFinite(opts.daylight) ? opts.daylight : 1));
		const alpha = (0.10 + 0.26 * wetness) * (0.35 + 0.65 * daylight);
		const skipWet = typeof opts.skipWetTile === 'function' ? opts.skipWetTile : null;
		const visibleAt = typeof opts.visibleAt === 'function' ? opts.visibleAt : null;
		const x0 = Math.floor(opts.sx), x1 = Math.ceil(opts.sx + opts.viewX);
		let cols = 0;
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		ctx.fillStyle = 'rgba(190,222,255,' + alpha.toFixed(3) + ')';
		for(let x = x0; x <= x1; x++){
			const surf = opts.surfaceHeight(x);
			if(!Number.isFinite(surf)) continue;
			const t = opts.getTile(x, surf);
			if(t === T.AIR || t === T.WATER) continue;
			if(skipWet && skipWet(t)) continue;
			if(visibleAt && !visibleAt(x, surf)) continue;
			ctx.fillRect(x * TILE, surf * TILE, TILE, 2);
			cols++;
		}
		if(raining && cols){
			ctx.fillStyle = 'rgba(235,245,255,0.5)';
			const bucket = Math.floor(now / 120);
			for(let k = 0; k < 14; k++){
				let h = ((bucket + k * 131) * 374761393) | 0; h = ((h ^ (h >>> 13)) * 1274126177) | 0; h = (h ^ (h >>> 16)) >>> 0;
				const x = x0 + (h % Math.max(1, x1 - x0));
				const surf = opts.surfaceHeight(x);
				if(!Number.isFinite(surf) || (visibleAt && !visibleAt(x, surf))) continue;
				if(!(rainingAt && rainingAt(x))) continue;
				ctx.fillRect(x * TILE + (h >>> 8) % TILE, surf * TILE - 2 - (h >>> 16) % 3, 1, 2);
			}
		}
		ctx.restore();
		metrics.wetSheenColumns += cols;
		return cols;
	},
	// Dust motes: stateless deterministic specks drifting in daylight air just
	// above the surface — position and twinkle derive from a hash and the
	// clock, so there is no particle state to allocate or stream.
	drawDustMotesPass(ctx, opts){
		if(!api.on('dustMotes')) return 0;
		if(!ctx || !opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function') return 0;
		const daylight = Math.max(0, Math.min(1, Number.isFinite(opts.daylight) ? opts.daylight : 1));
		if(daylight <= 0.25) return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const budget = (Number.isFinite(opts.frameMs) && opts.frameMs > 28) ? 20 : 48;
		const visibleAt = typeof opts.visibleAt === 'function' ? opts.visibleAt : null;
		const epoch = Math.floor(now / 9000);
		// mote identity is WORLD-anchored (hash of the world column, not a
		// camera-relative slot): panning must not reshuffle the field
		const x0 = Math.floor(opts.sx) - 1, x1 = Math.ceil(opts.sx + opts.viewX) + 1;
		let drawn = 0;
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		for(let x = x0; x <= x1 && drawn < budget; x++){
			let h = ((epoch * 92821 + x * 68917) * 374761393) | 0; h = ((h ^ (h >>> 13)) * 1274126177) | 0; h = (h ^ (h >>> 16)) >>> 0;
			if((h & 3) !== 0) continue; // roughly one mote per four columns
			const surf = opts.surfaceHeight(x);
			if(!Number.isFinite(surf)) continue;
			const y = surf - 1 - ((h >>> 4) % 6);
			if(opts.getTile(x, y) !== T.AIR) continue;
			if(visibleAt && !visibleAt(x, y)) continue;
			const k = h & 31;
			const px = x * TILE + ((h >>> 8) % TILE) + Math.sin(now * 0.0004 + k * 2.1) * 8;
			const py = y * TILE + ((h >>> 12) % TILE) + Math.cos(now * 0.0003 + k * 1.3) * 6;
			const tw = 0.5 + 0.5 * Math.sin(now * 0.001 + k * 2.7);
			if(tw < 0.25) continue;
			ctx.fillStyle = 'rgba(255,248,220,' + (0.30 * tw * daylight).toFixed(3) + ')';
			ctx.fillRect(px, py, 2.2, 2.2);
			drawn++;
		}
		ctx.restore();
		metrics.dustMotes += drawn;
		return drawn;
	},
	// Ice reflections: frozen sheets (ICE / MOTHER_ICE / THIN_ICE at the
	// surface) mirror a faint STATIC strip of the scene — no ripple, matte
	// alpha — clipped into the top of the ice tile. The water pass's frozen
	// lakes stay dark on purpose; this is their subtle winter counterpart.
	drawIceReflectionsPass(ctx, opts){
		if(!api.on('iceReflections')){
			iceRunKey = ''; iceRuns.length = 0;
			if(!api.on('heatShimmer') && selfBlitCanvas){ selfBlitCanvas = null; selfBlitCtx = null; }
			return 0;
		}
		if(!ctx || !opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function' || !ctx.canvas) return 0;
		let m = null;
		try{ m = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null; }catch(e){ m = null; }
		if(!m || !Number.isFinite(m.a) || m.a <= 0 || !Number.isFinite(m.d) || m.d <= 0) return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const x0 = Math.floor(opts.sx) - 1, x1 = Math.ceil(opts.sx + opts.viewX) + 1;
		const key = x0 + '|' + x1;
		if(key !== iceRunKey || now - iceRunScanAt > 400){
			iceRuns = collectIceRuns({ x0, x1, getTile: opts.getTile, surfaceHeight: opts.surfaceHeight, max: 140 });
			iceRunKey = key; iceRunScanAt = now;
		}
		if(!iceRuns.length) return 0;
		const visibleAt = typeof opts.visibleAt === 'function' ? opts.visibleAt : null;
		const srcCanvas = snapshotSceneCanvas(ctx.canvas);
		if(!srcCanvas) return 0;
		let cols = 0;
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.globalAlpha = 0.24;
		for(const run of iceRuns){
			if(visibleAt && !visibleAt(run.x, run.surf)) continue;
			const wxPx = run.x * TILE, topPx = run.surf * TILE;
			const bandPx = TILE * 3;
			const sxDev = m.a * wxPx + m.e, swDev = m.a * TILE;
			let syDev = m.d * (topPx - bandPx) + m.f;
			let shDev = m.d * bandPx;
			if(syDev < 0){ shDev += syDev; syDev = 0; }
			if(!(shDev > 1) || syDev >= srcCanvas.height || sxDev < 0 || sxDev + swDev > srcCanvas.width) continue;
			const visPx = shDev / m.d;
			const destH = Math.min(TILE * 0.85, visPx * 0.45);
			if(!(destH > 1)) continue;
			ctx.save();
			ctx.beginPath();
			ctx.rect(wxPx, topPx, TILE, TILE * 0.9);
			ctx.clip();
			ctx.translate(wxPx, topPx);
			ctx.scale(1, -1);
			ctx.drawImage(srcCanvas, sxDev, syDev, swDev, shDev, 0, -destH, TILE, destH);
			ctx.restore();
			cols++;
		}
		ctx.restore();
		metrics.iceColumns += cols;
		return cols;
	}
};

loadConfig();
if(HAS_WINDOW) window.MM.postFx = api;
export const postFx = HAS_WINDOW && window.MM ? window.MM.postFx : api;
export default postFx;
