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

// The emitter rescan runs on ONE fixed cadence; the halos themselves are drawn
// every frame from the cached list so camera motion never leaves a stale glow
// behind (positions are world-space, only the LIST is cached).
// This used to stretch to 250/400ms on slower frames, which made a newly lit
// torch take three times longer to start glowing on a slower machine — the same
// machine-dependent behaviour the quality rule forbids. Since bloomSourceFor was
// memoized the whole scan costs ~10us, so there is nothing left to buy.
export const BLOOM_SCAN_INTERVAL_MS = 120;
export function bloomScanIntervalMs(){ return BLOOM_SCAN_INTERVAL_MS; }

// Tile glow reads the TILE ATTRIBUTE (constants.js TILE_GLOW stamps INFO[t].glow)
// or a furnishing's declared lightLevel — never a private table in here, so the
// lighting BFS and the renderer cannot drift apart. Chest tiles are excluded:
// their pulsing tier aura registers itself, because only the chest renderer
// knows the pulse.
export const BLOOM_MIN_LEVEL = 6;
export const BLOOM_MAX_EMITTERS = 160;

// Memoized per tile id, lazily. This function was ~88% of the emitter scan's cost
// (measured 9.0ns/call over ~5800 solid tiles = 52us of a 59us scan) because INFO is
// a 147-key dictionary-mode object and every miss ran three lookups plus two
// Number(undefined) coercions. The inputs it reads -- glow, lightLevel, chestTier --
// are written only at module init, so the answer per tile id is immutable.
// LAZY is load-bearing: furnishings.js stamps INFO after constants.js, and an eager
// table built at import time would miss every furnishing.
const glowSourceMemo = [];   // tile id -> frozen source, or null for "not an emitter"

export function bloomSourceFor(t){
	const hit = glowSourceMemo[t];
	if(hit !== undefined) return hit;
	const out = computeBloomSource(t);
	glowSourceMemo[t] = out;
	return out;
}

function computeBloomSource(t){
	const info = INFO[t];
	if(info && info.chestTier) return null;
	const attr = info && info.glow;
	const declared = Number(info && info.lightLevel);
	const level = Math.max(
		Number(attr && attr.level) || 0,
		Number.isFinite(declared) ? declared : 0
	);
	if(level < BLOOM_MIN_LEVEL) return null;
	// Normalised HERE, once per tile id. constants.js documents TILE_GLOW colours as
	// '#rgb' | '#rrggbb' | 'r,g,b', but the tile draw path passed this string straight
	// into 'rgba(' + color + ',0.55)' -- so a hex colour, exactly as documented, would
	// have thrown SyntaxError from addColorStop inside the frame's draw loop.
	return Object.freeze({ level: Math.min(15, Math.round(level)), color: emissiveRgb((attr && attr.color) || '255,236,190') });
}

// --- heat shimmer field -------------------------------------------------------
// How a real heat haze is rendered (SFML/Unity/Godot all land on the same
// recipe): you do NOT move the hot air's pixels around the screen. You keep the
// destination fixed and sample the scene from a DISPLACED source coordinate --
// refraction is a lookup offset, not a translation. Two consequences fall out
// for free, and both were the bugs in the old three-slice version:
//   * nothing can ever spill onto a neighbouring block, because the region that
//     gets painted never moves;
//   * no strip of un-displaced original is left behind at the vacated edge.
// The offset itself comes from a coherent-noise map scrolled UPWARD over time
// (hot air rises), damped with height (rising air cools and mixes). We have no
// shader, so a sum of two incommensurate sines stands in for the noise: it never
// visibly repeats, where one sine reads as a rhythmic left-right pump.
// Both the wavelength and the amplitude are WORLD px, so the shear the eye
// actually judges -- offset change per pixel of height -- comes out the same at
// every zoom, and only the row height below is a device measure.
// These two numbers are not free: peak displacement over wavelength IS the
// gradient, and the gradient times the row height is the jump between adjacent
// sampled rows. At 1.8/52 the jump is ~0.57 device px, comfortably sub-pixel, so
// the rows melt into a continuous field. The old version ran a ~1.9 px jump,
// which is precisely why it read as three blocks sliding over each other.
export const HEAT_WAVE_PX = 52;        // wavelength of the field, WORLD px
export const HEAT_AMP_PX = [0.6, 1.8]; // peak displacement by strength, WORLD px
export const HEAT_RISE = 0.0045;       // how fast the pattern climbs (rad/ms)
export const HEAT_RISE_2 = 0.0026;     // the second component drifts at its own
                                       // rate, so the shape morphs as it rises
// Row height in DEVICE px, growing with height: the sampling only has to be fine
// where the field is steep, and the envelope has already flattened it near the
// top. Free rows back with nothing visible given up.
export const HEAT_ROW_PX = [2, 6];
// Two hard work caps, both frame-rate INDEPENDENT (a weak machine is shown the
// same effect, it is never quietly degraded). The band cap is the one that bites:
// each band pays for its own strip copy, so twenty small plumes cost far more than
// one lava lake of the same total width — measured ~22us per band against ~135us
// for a whole 40-tile lake.
export const HEAT_ROW_BUDGET = 260;
export const HEAT_BAND_CAP = 10;
export const HEAT_MERGE_GAP = 2;       // tiles of open air a single plume bridges
export const HEAT_PLUME_TILES = [1.15, 2.5];  // plume height by strength
// Recycled source-collection scratch for the shimmer pass (list + object pool).
const heatSrcList = [];
const heatSrcPool = [];

// Strength of a tile's plume, straight off the tile attribute (constants.js
// TILE_HEAT stamps INFO[t].heat). Live sources (fire, geothermal) pass their own.
// Memoized per tile id like bloomSourceFor above (the INFO dictionary lookup was
// 88% of that scan's cost); lazy is load-bearing — furnishings stamp INFO late.
const heatSourceMemo = [];
export function heatSourceFor(t){
	const hit = heatSourceMemo[t];
	if(hit !== undefined) return hit;
	const h = Number(INFO[t] && INFO[t].heat);
	return heatSourceMemo[t] = (Number.isFinite(h) && h > 0) ? Math.min(1, h) : 0;
}
function heatLerp(a, b, k){ return a + (b - a) * Math.max(0, Math.min(1, k)); }
export function heatPlumeTiles(strength){ return heatLerp(HEAT_PLUME_TILES[0], HEAT_PLUME_TILES[1], strength); }
export function heatAmpPx(strength){ return heatLerp(HEAT_AMP_PX[0], HEAT_AMP_PX[1], strength); }
export function heatRowHeight(h){ return heatLerp(HEAT_ROW_PX[0], HEAT_ROW_PX[1], h); }

// Rows a plume of this device height will cost. Shares the stepping rule with the
// draw loop, so the work the budget reserves is the work that actually happens.
export function heatRowCount(plumeH){
	if(!(plumeH > 0)) return 0;
	let n = 0, d = 0;
	while(d < plumeH && n < 512){ d += heatRowHeight(d / plumeH); n++; }
	return n;
}

// Height envelope: full at the source, zero at the plume top. Superlinear, so the
// haze dies out well before the band's top edge and no horizontal seam can show
// where the effect stops.
export function heatEnvelope(h){
	if(!(h > 0)) return h === 0 ? 1 : 0;
	if(h >= 1) return 0;
	const e = 1 - h;
	return e * Math.sqrt(e);
}

// THE displacement, in device px, for one sampled row. rowY/baseY/plumeH/amp/wave
// are all device px; baseY is the top of the hot tile and rowY climbs toward
// baseY - plumeH. Continuous in rowY by construction (one smooth field, sampled)
// and travelling upward in `now` -- the two properties the old version lacked.
export function heatOffsetPx(rowY, baseY, plumeH, amp, wave, seed, now){
	if(!(plumeH > 0) || !(amp > 0) || !(wave > 0)) return 0;
	const h = (baseY - rowY) / plumeH;
	if(!(h >= 0) || h >= 1) return 0;
	// +now on the phase, with canvas y growing DOWNWARD, is what sends the pattern
	// up the screen: a fixed phase sits at a row that decreases as time advances.
	const p = (rowY / wave) * Math.PI * 2 + now * HEAT_RISE + seed;
	const w = Math.sin(p) * 0.64 + Math.sin(p * 1.87 - now * HEAT_RISE_2 + seed * 2.3) * 0.36;
	return w * amp * heatEnvelope(h);
}

// Contiguous hot tiles on one row become ONE band. This is what keeps the pass
// affordable: a forty-tile lava lake costs the rows of a single band instead of
// forty stacked plumes, and it is also the truthful shape -- a lake boils as one
// sheet of air, not as forty separate columns.
// Ordered hottest first, then nearest the view centre, and cut off by a fixed
// row budget: a torch-lit base never crowds out the lava lake next to the hero.
export function buildHeatBands(sources, opts){
	const bands = [];
	if(!Array.isArray(sources) || !sources.length) return bands;
	const rows = new Map();
	for(const s of sources){
		if(!s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !(s.strength > 0)) continue;
		const y = Math.round(s.y);
		let list = rows.get(y);
		if(!list){ list = []; rows.set(y, list); }
		list.push({ x: Math.round(s.x), strength: Math.min(1, s.strength) });
	}
	// Bridging a small GAP as well as strict adjacency: two fires a tile or two
	// apart share one body of rising air, and one band over both costs one set of
	// rows instead of two. The gap columns must be as OPEN as the sources are,
	// checked with the same probe the ceiling clip uses — otherwise a pillar
	// standing between two plumes would clip the merged band down to nothing and
	// lose both. Without the predicate (pure callers, tests) only true neighbours
	// merge, which is the conservative reading.
	const mergeGap = (opts && Number.isFinite(opts.mergeGap)) ? Math.max(0, opts.mergeGap) : HEAT_MERGE_GAP;
	const airAbove = (opts && typeof opts.airAbove === 'function') ? opts.airAbove : null;
	for(const [y, list] of rows){
		list.sort((a, b) => a.x - b.x);
		let run = null;
		for(const cell of list){
			const gap = run ? cell.x - run.x1 - 1 : -1;
			let join = false;
			if(run && gap <= 0) join = true;
			else if(run && gap <= mergeGap && airAbove){
				const need = Math.ceil(heatPlumeTiles(Math.max(run.strength, cell.strength)));
				join = true;
				for(let gx = run.x1 + 1; gx < cell.x && join; gx++) if(!airAbove(gx, y, need)) join = false;
			}
			if(join){
				run.x1 = Math.max(run.x1, cell.x);
				run.strength = Math.max(run.strength, cell.strength);
			} else {
				run = { x0: cell.x, x1: cell.x, y, strength: cell.strength };
				bands.push(run);
			}
		}
	}
	const focus = (opts && Number.isFinite(opts.focusX)) ? opts.focusX : 0;
	bands.sort((a, b) => (b.strength - a.strength) || (Math.abs((a.x0 + a.x1) * 0.5 - focus) - Math.abs((b.x0 + b.x1) * 0.5 - focus)));
	const budget = (opts && Number.isFinite(opts.rowBudget)) ? opts.rowBudget : HEAT_ROW_BUDGET;
	const bandCap = (opts && Number.isFinite(opts.bandCap)) ? opts.bandCap : HEAT_BAND_CAP;
	const scale = (opts && opts.scale > 0) ? opts.scale : 1;
	const tile = (opts && opts.TILE > 0) ? opts.TILE : 20;
	const out = [];
	let spent = 0;
	for(const b of bands){
		if(out.length >= bandCap) break;
		const need = Math.max(1, heatRowCount(heatPlumeTiles(b.strength) * tile * scale));
		if(spent + need > budget) continue;
		spent += need;
		b.rows = need;
		out.push(b);
	}
	return out;
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
			// Built only once the reservoir has decided to keep it. A lava lake offers ~2000
			// candidate emitters for 160 slots, so the old order allocated ~1800 objects per
			// scan purely to drop them. The hash does not read the object, so the choice of
			// which emitters survive is bit-identical.
			if(out.length < max) out.push({ x, y, t, level: src.level, color: src.color });
			else {
				let h = (x * 374761393 + y * 668265263) | 0;
				h = ((h ^ (h >>> 13)) * 1274126177) | 0;
				h = (h ^ (h >>> 16)) >>> 0;
				const idx = h % seen;
				if(idx < max) out[idx] = { x, y, t, level: src.level, color: src.color };
			}
		}
	}
	return out;
}

// --- the glow attribute (poświata) -------------------------------------------
// ONE rule for the whole game: anything that emits light — a tile, a creature, a
// part of a creature, a held weapon, a projectile, a dropped item, a machine
// lamp, an effect — carries a `glow` DESCRIPTOR, and that attribute alone makes
// it bloom and, when it moves, leave a light streak. No draw site paints its own
// halo any more.
//
//   {color}   '#rgb' | '#rrggbb' | 'r,g,b'
//   {r}       radius in WORLD pixels — entities, parts, effects
//   {level}   0..15 light units instead of r — tiles, so the renderer and the
//             lighting BFS read the same number (constants.js TILE_GLOW)
//   {a}       peak alpha; derived from level/r when absent
//   {trail}   true → motion streak (needs a stable key at the call site)
//   {pulse}   0..1 breathing depth, phase derived from the position
//
// Why every glow was wrong before: each site hand-rolled a flat additive ellipse
// or arc at one constant alpha (a HARD rim, so it read as a coloured blob glued
// onto the sprite instead of light leaving a body), and drew it INSIDE the entity
// pass — underneath the darkness overlay that follows, so the night dimmed the
// one thing that exists to survive the night. Now every source, tile or entity,
// lands in one batched pass above the darkness and below the fog.
//
// No toggle, because it was measured rather than assumed (tools/mob-glow-qa.mjs,
// 400 cycles, software canvas): ~120-160 us per frame for a typical 12-source
// scene, ~460 us for a pessimistic 40, and 9 us for the tile scan+draw. Well
// under 1% of a 60 fps frame is cheaper to ship than to hide behind an option.
// glowTier() is 1 normally, 2 with the `bloom` component on (which now AMPLIFIES
// every source uniformly instead of owning tiles alone), and 0 under the QA kill
// switch (__mmNoPostFX), which keeps screenshot goldens comparable.
export const EMISSIVE_MAX = 128;       // per-frame entity queue cap
// Shared hand-off descriptor for api.glow(): addEmissive copies it into the
// pooled queue synchronously, so one reused object replaces a per-call literal.
const glowHandoff = { x: 0, y: 0, r: 0, color: '', a: 0, pulse: 0, key: '', trail: false };
export const EMISSIVE_TRAIL_MAX = 32;  // trailed sources per frame
export const TRAIL_PTS = 7;            // history depth
export const TRAIL_SAMPLE_MS = 26;     // ~6 samples over ~170 ms of movement
export const TRAIL_MIN_PX = 1.1;       // below this the source counts as still
export const TRAIL_BREAK_PX = 140;     // respawn/teleport guard (world px)
export const TRAIL_TTL_MS = 900;       // histories of gone entities expire
// A source that stops sampling (still, or crawling below TRAIL_MIN_PX) retracts
// one tail point per period instead of pinning its full frozen streak to the old
// world positions forever — which is also what a light streak physically does.
export const TRAIL_RETRACT_MS = TRAIL_SAMPLE_MS * 2;

// Colour normaliser: the art writes '#rgb'/'#rrggbb', the bloom table writes
// 'r,g,b', and glowSpriteFor keys its cache on the triplet. Unparseable input
// falls back to the same warm white bloom uses rather than throwing inside a
// draw loop.
const emissiveRgbCache = new Map();
export function emissiveRgb(color){
	if(typeof color !== 'string' || !color) return '255,236,190';
	const hit = emissiveRgbCache.get(color);
	if(hit) return hit;
	let out = null;
	if(color.charCodeAt(0) === 35){
		let h = color.slice(1);
		if(h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		if(h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)){
			const n = parseInt(h, 16);
			out = ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
		}
	} else if(/^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/.test(color)){
		out = color.replace(/\s+/g, '');
	}
	if(!out) out = '255,236,190';
	if(emissiveRgbCache.size < 512) emissiveRgbCache.set(color, out);
	return out;
}

// Trails are WORLD-space position history — the model every trail renderer uses
// (Unity's TrailRenderer, "ribbon trails"): sample the position at intervals,
// then draw a tapering stroke through the samples. The other standard answer, a
// full-screen accumulation buffer faded a few percent per frame (what every
// "canvas motion trail" tutorial reaches for, and what a long exposure
// physically does), is WRONG for a scrolling world: that buffer lives in SCREEN
// space, so it smears with the CAMERA and a standing torch grows a tail
// whenever the player walks. History in world coordinates is camera-independent
// by construction and its cost scales with the handful of glowing entities
// instead of with the framebuffer.
// One stamp per sample was rejected as well: a fast mover needs so many stamps
// to keep the streak unbroken that either the beads show or the count explodes.
// A round-capped stroke per segment interpolates the gap for free.
export function trailSampleDue(hist, x, y, now){
	if(!hist || !hist.pts || !hist.pts.length) return true;
	if(!((now - hist.at) >= TRAIL_SAMPLE_MS)) return false;
	const last = hist.pts[hist.pts.length - 1];
	return (Math.abs(x - last.x) + Math.abs(y - last.y)) > TRAIL_MIN_PX;
}
// A jump this large is not motion, it is a teleport, a respawn or a key reused
// by a different entity: keeping the history would draw a light beam across the
// world. The trail restarts instead.
export function trailBroken(hist, x, y){
	if(!hist || !hist.pts || !hist.pts.length) return false;
	const last = hist.pts[hist.pts.length - 1];
	return (Math.abs(x - last.x) + Math.abs(y - last.y)) > TRAIL_BREAK_PX;
}
// Segment weight along the streak: 0 at the oldest sample, 1 at the head. The
// square keeps the tail thin and dim (a light streak fades fast) while the last
// third stays bright enough to connect to the body.
export function trailTaper(i, n){
	if(!(n > 1)) return 1;
	const t = Math.max(0, Math.min(1, i / (n - 1)));
	return t * t;
}

// The descriptor normaliser: turns a `glow` attribute as any object may write it
// into the exact numbers the pass draws, or null when the thing does not glow.
// Pure, so the suite can pin the ramps that decide how big and bright a level-13
// torch is versus a level-9 glowshroom.
export function normalizeGlow(spec, TILE){
	if(!spec || typeof spec !== 'object') return null;
	const tile = (Number.isFinite(TILE) && TILE > 0) ? TILE : 20;
	const level = Number(spec.level);
	const hasLevel = Number.isFinite(level) && level > 0;
	let r = Number(spec.r);
	if(!(r > 0)){
		// rTiles lets a world object declare its radius in TILES, so its descriptor
		// can be a frozen constant instead of an object rebuilt every frame.
		const rt = Number(spec.rTiles);
		if(rt > 0) r = tile * rt;
		else if(hasLevel) r = tile * (0.7 + Math.min(15, level) * 0.2); // the tile ramp
		else return null;
	}
	let a = Number(spec.a);
	if(!Number.isFinite(a)){
		a = hasLevel ? Math.min(0.68, 0.3 + Math.min(15, level) * 0.018) : 0.55;
	}
	return {
		rgb: emissiveRgb(spec.color),
		r: Math.min(320, r),
		a: Math.max(0, Math.min(1, a)),
		trail: spec.trail === true,
		pulse: Math.max(0, Math.min(1, Number(spec.pulse) || 0))
	};
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
			// Weight is (level/15)·(1−ring/7) with level ≤ 15 and a STRICT > below, so a
			// cell whose upper bound (1−ring/7) cannot beat the current winner is dead —
			// skip it before the tile read. Bit-exact: an adjacent torch collapses the
			// 99-cell walk to 25 reads without changing which emitter wins.
			const ring = Math.max(Math.abs(dx), Math.abs(dy));
			if(1 - ring / 7 <= warmW) continue;
			const t = o.getTile(px + dx, py + dy);
			if(t === T.AIR || t === T.WATER) continue;
			const src = bloomSourceFor(t);
			if(!src) continue;
			if(INFO[t] && INFO[t].requiresHomePower && !(typeof o.poweredAt === 'function' && o.poweredAt(px + dx, py + dy, t))) continue;
			const w = (src.level / 15) * (1 - ring / 7);
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
// Every glow used to cost TWO blits: a wide dim bleed and, over it, a tight bright
// core. Measured, the core blit was 24% of the pass -- and it is redundant, because
// the two layers can be baked into ONE sprite whose radial profile is their sum.
//
// The equivalence is exact, not approximate, and pinned as arithmetic in
// tools/post-fx-sim.test.mjs rather than eyeballed:
//   wide output = A1*P(u),  core output = A2*P(g*u),  A2/A1 = 1/0.34 exactly
// because neither globalAlpha ever clamps (the largest alpha any source declares is
// 0.68, and 0.68*1.22 = 0.83 < 1). So one blit of profile
//   Q(u) = P(u) + (1/0.34)*P(g*u)
// drawn at alpha A1*Q(0) reproduces both layers. Q(0) > 1 so the sprite stores
// Q normalised; the residual is 8-bit quantisation of the skirt, bounded at
// 0.31/255 -- below one displayable level.
// g is the core's radius ratio and depends on the bloom tier, so sprites are keyed
// on (colour, tier). 128px, not 64: the core now gets MORE source pixels across its
// radius than the separate core blit gave it, so detail improves.
const GLOW_SPRITE_PX = 64;
const GLOW_BAKED_PX = 128;
const GLOW_STOP_INNER = 2 / 32;         // the plain sprite's inner flat radius
const GLOW_CORE_WEIGHT = 1 / 0.34;      // the core layer's alpha relative to the bleed

// The plain sprite's alpha profile, as the browser rasterises it: a radial gradient
// from radius 2 to 32 with stops 0.55 / 0.18 / 0, i.e. flat inside r=2 and piecewise
// linear outside. Stated here so the bake can be exact instead of eyeballed.
export function glowProfile(u){
	if(!(u > 0)) return 0.55;
	if(u >= 1) return 0;
	if(u <= GLOW_STOP_INNER) return 0.55;
	const t = (u - GLOW_STOP_INNER) / (1 - GLOW_STOP_INNER);
	if(t <= 0.45) return 0.55 + (0.18 - 0.55) * (t / 0.45);
	return 0.18 * (1 - (t - 0.45) / 0.55);
}
// Gain applied at draw time to undo the normalisation baked into the sprite.
export const GLOW_BAKE_GAIN = glowProfile(0) * (1 + GLOW_CORE_WEIGHT);
export const GLOW_AMP_A = 1.22;          // the bloom tier's uniform alpha gain
export const GLOW_A_MAX = 1 / GLOW_AMP_A;  // above this the two-layer bake stops being exact
export function glowCoreRatio(tier){ return 1.85 * (tier >= 2 ? 1.30 : 1); }
export function glowBakedProfile(u, g){
	if(!(u >= 0) || u >= 1) return 0;
	const inner = u * g;
	return (glowProfile(u) + GLOW_CORE_WEIGHT * (inner < 1 ? glowProfile(inner) : 0)) / GLOW_BAKE_GAIN;
}
// Q is piecewise linear, so a stop at every breakpoint of BOTH terms makes the
// gradient's own linear interpolation exact between them. Uniform sampling would
// round the kink where the core term ends and cost ~2.6/255 there.
export function glowBakeStops(g){
	const out = [0, GLOW_STOP_INNER, GLOW_STOP_INNER + 0.45 * (1 - GLOW_STOP_INNER), 1];
	for(const u of [GLOW_STOP_INNER, GLOW_STOP_INNER + 0.45 * (1 - GLOW_STOP_INNER), 1]) out.push(u / g);
	return [...new Set(out.filter(u => u >= 0 && u <= 1))].sort((a, b) => a - b);
}

const glowSprites = new Map(); // color string -> prerendered radial sprite
// One Map per tier, keyed on the colour string directly: the pass looks a sprite
// up per source per frame, and the old `color + '|' + tier` key built ~300
// throwaway strings a frame in the one pass that is deliberately never gated.
const glowBakedSprites = [null, new Map(), new Map()]; // [tier] -> color -> sprite
function glowBakedSpriteFor(color, tier){
	if(typeof document === 'undefined') return null;
	const byColor = glowBakedSprites[tier] || (glowBakedSprites[tier] = new Map());
	let spr = byColor.get(color);
	if(spr) return spr;
	const c = document.createElement('canvas');
	c.width = GLOW_BAKED_PX; c.height = GLOW_BAKED_PX;
	const g2 = c.getContext('2d');
	if(!g2) return null;
	const half = GLOW_BAKED_PX / 2;
	const grad = g2.createRadialGradient(half, half, 0, half, half, half);
	const g = glowCoreRatio(tier);
	for(const u of glowBakeStops(g)) grad.addColorStop(u, 'rgba(' + color + ',' + glowBakedProfile(u, g).toFixed(5) + ')');
	g2.fillStyle = grad;
	g2.fillRect(0, 0, GLOW_BAKED_PX, GLOW_BAKED_PX);
	byColor.set(color, spr = c);
	return spr;
}
const glowStrokes = new Map();  // color string -> 'rgb(r,g,b)', built once per colour
// The streak stroke rebuilt this string per trailed source per frame -- up to 32
// allocations plus 32 CSS colour parses -- two lines under a comment correctly
// explaining why the per-SEGMENT alpha avoids exactly that.
function glowStrokeFor(color){
	let hit = glowStrokes.get(color);
	if(hit === undefined){
		hit = 'rgb(' + color + ')';
		if(glowStrokes.size < 512) glowStrokes.set(color, hit);
	}
	return hit;
}
function glowSpriteFor(color){
	if(typeof document === 'undefined') return null;
	let spr = glowSprites.get(color);
	if(spr) return spr;
	const c = document.createElement('canvas');
	c.width = GLOW_SPRITE_PX; c.height = GLOW_SPRITE_PX;
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
const metrics = { bloomScans: 0, bloomEmitters: 0, bloomDraws: 0, shimmerBands: 0, emissiveSources: 0, emissiveHalos: 0, emissiveStreaks: 0, reflectionColumns: 0, specGlints: 0, heroSheenDraws: 0, bladeSheens: 0, shadowDraws: 0, godRayBeams: 0, tintDraws: 0, shimmerSlices: 0, wetSheenColumns: 0, dustMotes: 0, iceColumns: 0 };
let bloomEmitters = [];
let bloomScanAt = 0;
let bloomScanKey = '';
let bloomScanGen = 0;          // bumped on every rescan; memoized consumers key on it
// Light-tint winners: the 8×8-cell dedupe is a pure function of the cadence-cached
// emitter list, so it is rebuilt per SCAN, not per frame.
const tintWinners = [];
let tintWinnersGen = -1;
const tintCells = new Set();
// Entity emissive queue: filled during the entity passes (mobs, threat look),
// drained once per frame by drawEmissivePass. Entries are recycled objects — the
// queue is a ring, not a fresh array per frame, so a hundred glowing creatures
// allocate nothing.
const emissiveQueue = [];
let emissiveCount = 0;
let emissiveFrame = 0;
const emissiveTrails = new Map(); // key -> {pts:[{x,y}], at, seen, frame}
let emissiveTrailSweepAt = 0;
// Remembered tile size so api.glow() can turn a {level} attribute into a radius
// without every caller having to hand TILE in.
let lastGlowTilePx = 20;
const NO_TILES = Object.freeze([]);
let godRayBeams = [];
let godRayKey = '';
let godRayScanAt = 0;
let iceRuns = [];
const ICE_STRIDE = 7;
const iceCols = [];   // flat geometry scratch, stride ICE_STRIDE: no per-frame alloc
let iceRunKey = '';
let iceRunScanAt = 0;
let wetness = 0;
let wetLastAt = 0;


// A REGION snapshot, not the whole frame. The heat shimmer only ever reads a few
// hundred pixels around each plume, and copying the entire 1600x900 canvas to get
// them was almost the whole cost of the pass (measured: ~330us a frame, of which
// the row blits were a small fraction). Taken per BAND rather than once over a
// union box, because two plumes at opposite screen edges would union back into
// the whole frame. Two plumes that do overlap compound their displacement, which
// is fine -- both of them are hot air.
let heatBlitCanvas = null, heatBlitCtx = null;
function snapshotSceneRegion(srcCanvas, rx, ry, rw, rh){
	if(typeof document === 'undefined' || !srcCanvas || !(rw > 0) || !(rh > 0)) return null;
	if(!heatBlitCanvas){
		heatBlitCanvas = document.createElement('canvas');
		heatBlitCtx = heatBlitCanvas.getContext('2d');
	}
	if(!heatBlitCtx) return null;
	if(heatBlitCanvas.width < rw || heatBlitCanvas.height < rh){
		heatBlitCanvas.width = Math.max(heatBlitCanvas.width | 0, rw);
		heatBlitCanvas.height = Math.max(heatBlitCanvas.height | 0, rh);
	}
	heatBlitCtx.setTransform(1, 0, 0, 1, 0, 0);
	heatBlitCtx.clearRect(0, 0, rw, rh);
	heatBlitCtx.drawImage(srcCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
	return heatBlitCanvas;
}

// --- hero mirror backdrop -----------------------------------------------------
// The coat's reflection is REAL: a rect of the finished scene around the hero,
// grabbed BEFORE the sprite is drawn (so the hero can never reflect itself) and
// blitted back over the body, compressed but NOT flipped — the surroundings
// shrunk in place. drawImage-only — the getImageData taboo holds. The grab is
// downscaled on the way in, which both caps the scratch and pre-blurs the image
// the way a curved surface would.
// Field of view the coat mirrors, in body sizes. Kept deliberately tight: a
// 14x19px sprite squeezing half a screen into itself is a smear, while ~4x3
// tiles keeps whole features (a trunk, the ground line, a torch) recognisable.
const HERO_MIRROR_SPREAD_X = 5;
const HERO_MIRROR_SPREAD_Y = 3;
const HERO_MIRROR_MAX_PX = 256;
let heroMirrorCanvas = null;   // grab taken BEFORE the sprite (hero-free)
let heroMirrorCtx = null;
let heroMirrorAt = 0;
let heroSceneCanvas = null;    // grab of the FINISHED world, hero patched out
let heroSceneCtx = null;
let heroSceneAt = 0;
let heroGrabRect = null;       // device rect of the grab + the patch sub-rect
let heroMirrorUsed = false;
let heroSceneUsed = false;
let heroCoatCanvas = null;
let heroCoatCtx = null;
// Steady-state scratch: the coat mirrors heroSceneCanvas, so the pre-sprite grab
// only needs the hero-footprint PATCH pasted over the sprite (~5% of the field's
// pixels); the full field lands in heroMirrorCanvas only when the scene grab went
// stale. heroMirrorFull records which of the two the mirror canvas holds — the
// fallback paths must never blit a stale full field grabbed frames ago.
let heroPatchCanvas = null;
let heroPatchCtx = null;
let heroMirrorFull = false;
// Cached gradients: both are pure functions of geometry that only changes on a
// zoom step or a weapon swap, not per frame.
let coatMaskGrad = null;
let coatMaskKey = -1;
let bladeSpineGrad = null;
let bladeSpineKey = -1;
const SHEEN_ZONES = ['top', 'mid', 'bot'];
// A grab older than this is stale (pause, teleport, a frame that drew no hero)
// and the coat falls back to the sampled tint rather than showing a ghost.
const HERO_GRAB_TTL_MS = 250;
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
	// The grab that produced `mirror` already read the world transform this frame;
	// reuse its scale instead of allocating a second DOMMatrix.
	let sxScale = 1, syScale = 1;
	if(heroGrabRect && heroGrabRect.ka > 0 && heroGrabRect.kd > 0){
		sxScale = heroGrabRect.ka; syScale = heroGrabRect.kd;
	} else {
		let m = null;
		try{ m = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null; }catch(e){ m = null; }
		if(m && Number.isFinite(m.a) && m.a > 0) sxScale = m.a;
		if(m && Number.isFinite(m.d) && m.d > 0) syScale = m.d;
	}
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
	// The image is NOT flipped: the coat shows the surroundings shrunk in place,
	// so what stands to the hero's left reads on the coat's left. A mirror flip
	// is only correct for a plane facing the viewer; here it just moved familiar
	// scenery to the wrong side and read as an artifact.
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
	// The Fresnel mask depends only on (w,h) — rebuild it on a zoom step, not per frame.
	const mk = w * 4096 + h;
	if(!coatMaskGrad || coatMaskKey !== mk){
		coatMaskKey = mk;
		coatMaskGrad = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.62);
		coatMaskGrad.addColorStop(0, 'rgba(0,0,0,0.30)');
		coatMaskGrad.addColorStop(0.55, 'rgba(0,0,0,0.52)');
		coatMaskGrad.addColorStop(1, 'rgba(0,0,0,1)');
	}
	g.fillStyle = coatMaskGrad;
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
		bloomScanGen++;
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
		if(!config.heroSheen){
			heroMirrorCanvas = null; heroMirrorCtx = null;
			heroSceneCanvas = null; heroSceneCtx = null;
			heroCoatCanvas = null; heroCoatCtx = null;
			heroPatchCanvas = null; heroPatchCtx = null; heroMirrorFull = false;
			coatMaskGrad = null; coatMaskKey = -1;
			bladeSpineGrad = null; bladeSpineKey = -1;
			heroGrabRect = null; heroMirrorAt = 0; heroSceneAt = 0;
		}
		// One region scratch now serves BOTH self-blit passes: each takes its snapshot
		// at its own start and consumes it before returning, and they never interleave.
		if(!config.heatShimmer && !config.iceReflections){ heatBlitCanvas = null; heatBlitCtx = null; return true; }
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
			mirrored: heroMirrorUsed,
			full: heroSceneUsed
		};
	},
	// Grab the world behind the hero. MUST be called in world space BEFORE the
	// hero sprite is drawn; the snapshot is consumed by the very next
	// drawHeroSheenPass and then invalidated, so a pass without a fresh grab
	// (mock contexts, screenshot tools) falls back to the sampled tint alone.
	captureHeroBackdrop(ctx, opts){
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
		const k = Math.min(1, HERO_MIRROR_MAX_PX / Math.max(sw, sh));
		const cw = Math.max(4, Math.round(sw * k)), ch = Math.max(4, Math.round(sh * k));
		// Remember the exact rect so the full-scene grab later in the frame can
		// sample the SAME field, plus where the hero sits inside it (with a
		// margin for the cape and the held weapon) — that is the patch the
		// full-scene grab replaces with this hero-free copy.
		const gk = cw / sw;
		const bdx = (m.a * opts.bx + m.e - sx) * gk, bdy = (m.d * opts.by + m.f - sy) * gk;
		const bdw = m.a * opts.bw * gk, bdh = m.d * opts.bh * gk;
		const mx = bdw * 0.55, my = bdh * 0.15;
		let ex0 = bdx - mx, ey0 = bdy - my, ex1 = bdx + bdw + mx, ey1 = bdy + bdh + my;
		// opts.erase widens the patch over anything else that belongs to the hero
		// rather than to the world — the cape, which trails a tile behind him and
		// used to show up mirrored on his own chest.
		if(opts.erase && Number.isFinite(opts.erase.x) && Number.isFinite(opts.erase.y) && opts.erase.w > 0 && opts.erase.h > 0){
			const rx0 = (m.a * opts.erase.x + m.e - sx) * gk, ry0 = (m.d * opts.erase.y + m.f - sy) * gk;
			ex0 = Math.min(ex0, rx0); ey0 = Math.min(ey0, ry0);
			ex1 = Math.max(ex1, rx0 + m.a * opts.erase.w * gk);
			ey1 = Math.max(ey1, ry0 + m.d * opts.erase.h * gk);
		}
		// Whole-pixel patch rect: an integer rect makes the paste a pure copy and the
		// patch-only grab sample the exact grid the full-field downscale would.
		const px = Math.max(0, Math.min(cw, Math.floor(ex0))), py = Math.max(0, Math.min(ch, Math.floor(ey0)));
		const pw = Math.max(0, Math.min(cw - px, Math.ceil(ex1) - px));
		const ph = Math.max(0, Math.min(ch - py, Math.ceil(ey1) - py));
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		// Steady state: last frame's full-scene grab is fresh, so this frame's coat
		// mirrors heroSceneCanvas and the only pixels ever read from THIS grab are
		// the hero-footprint patch. Copy just the patch (~5% of the field); the full
		// field is grabbed only when the scene grab went stale (first frame, resize,
		// pause) and the coat needs the backdrop itself.
		const sceneFresh = heroSceneAt > 0 && (now - heroSceneAt) < HERO_GRAB_TTL_MS
			&& heroSceneCanvas && heroSceneCanvas.width > 0;
		// No clearRect on either path: the game canvas is opaque ({alpha:false}), the
		// source rect is clamped inside it, and each draw covers its whole target —
		// source-over with an opaque source replaces every pixel, so a clear is memset
		// for nothing (it was ~45% of this helper's touched area).
		if(sceneFresh){
			if(!heroPatchCanvas){
				heroPatchCanvas = document.createElement('canvas');
				heroPatchCtx = heroPatchCanvas.getContext('2d');
			}
			if(!heroPatchCtx) return 0;
			if(pw > 0 && ph > 0){
				if(heroPatchCanvas.width < pw) heroPatchCanvas.width = pw;   // grow-only scratch
				if(heroPatchCanvas.height < ph) heroPatchCanvas.height = ph;
				heroPatchCtx.setTransform(1, 0, 0, 1, 0, 0);
				heroPatchCtx.imageSmoothingEnabled = true;
				heroPatchCtx.drawImage(src, sx + px / gk, sy + py / gk, pw / gk, ph / gk, 0, 0, pw, ph);
			}
			heroMirrorFull = false;
		} else {
			if(!heroMirrorCanvas){
				heroMirrorCanvas = document.createElement('canvas');
				heroMirrorCtx = heroMirrorCanvas.getContext('2d');
			}
			if(!heroMirrorCtx) return 0;
			if(heroMirrorCanvas.width !== cw || heroMirrorCanvas.height !== ch){
				heroMirrorCanvas.width = cw;
				heroMirrorCanvas.height = ch;
			}
			heroMirrorCtx.setTransform(1, 0, 0, 1, 0, 0);
			heroMirrorCtx.imageSmoothingEnabled = true;
			heroMirrorCtx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
			heroMirrorFull = true;
		}
		heroGrabRect = { sx, sy, sw, sh, cw, ch, px, py, pw, ph, ka: m.a, kd: m.d };
		heroMirrorAt = now;
		return 1;
	},
	// Grab the FINISHED world (mobs, creatures, projectiles, fire, gases,
	// water, machines — everything drawn after the hero), then paste the
	// pre-sprite grab back over the hero's own footprint so the coat never
	// mirrors the hero, his cape or his blade. Call it once per frame at the
	// end of the world pass, BEFORE the darkness/fog overlays: the coat is
	// dimmed by those overlays itself, and a pre-dimmed source would double it.
	// The result feeds the NEXT frame's coat — one frame of lag is invisible in
	// a reflection compressed to a 14x19px sprite, and it keeps the coat drawn
	// in its proper layer (fog and darkness still cover the hero).
	captureHeroScene(ctx){
		if(!api.on('heroSheen')) return 0;
		if(typeof document === 'undefined') return 0;
		if(!ctx || !ctx.canvas || !heroGrabRect || !heroMirrorCanvas) return 0;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		if(!(heroMirrorAt > 0) || now - heroMirrorAt > HERO_GRAB_TTL_MS) return 0; // no matching backdrop this frame
		const r = heroGrabRect;
		const src = ctx.canvas;
		if(!(src.width > 0) || !(src.height > 0)) return 0;
		if(!heroSceneCanvas){
			heroSceneCanvas = document.createElement('canvas');
			heroSceneCtx = heroSceneCanvas.getContext('2d');
		}
		if(!heroSceneCtx) return 0;
		if(heroSceneCanvas.width !== r.cw || heroSceneCanvas.height !== r.ch){
			heroSceneCanvas.width = r.cw;
			heroSceneCanvas.height = r.ch;
		}
		const g = heroSceneCtx;
		g.setTransform(1, 0, 0, 1, 0, 0);
		// No clearRect: the draw below covers the whole scratch from an opaque,
		// clamped source rect — see captureHeroBackdrop for the argument.
		g.imageSmoothingEnabled = true;
		g.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, r.cw, r.ch);
		if(r.pw > 0 && r.ph > 0){
			// The hero-free patch: cut from the full-field grab when one was taken,
			// otherwise it IS the whole patch canvas (steady state).
			const patch = heroMirrorFull ? heroMirrorCanvas : heroPatchCanvas;
			if(patch) g.drawImage(patch,
				heroMirrorFull ? r.px : 0, heroMirrorFull ? r.py : 0, r.pw, r.ph,
				r.px, r.py, r.pw, r.ph);
		}
		heroSceneAt = now;
		return 1;
	},
	// Blade sheen. A polished blade is a long, narrow mirror, and real metal
	// reflects ANISOTROPICALLY: the image smears along the length (the same
	// reason brushed metal stretches a highlight along its grain) because the
	// surface curves across the blade and barely along it. So the grabbed field
	// is squeezed hard across the blade and stretched over its whole length,
	// plus the bright spine every polished edge carries.
	// Called from weapons.js INSIDE the weapon's own transform, so a swing
	// rotates the smear with the blade for free. The rect must be the metal
	// itself (weapons.js only passes rectangular blades — a polygon head would
	// let the sheen spill onto the background).
	drawBladeSheenPass(ctx, opts){
		if(!api.on('heroSheen')) return 0;
		if(!ctx || !opts || !(opts.w > 0) || !(opts.h > 0)) return 0;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const fresh = (t) => t > 0 && (now - t) < HERO_GRAB_TTL_MS;
		const src = (fresh(heroSceneAt) && heroSceneCanvas && heroSceneCanvas.width > 0)
			? heroSceneCanvas
			: ((heroMirrorFull && fresh(heroMirrorAt) && heroMirrorCanvas && heroMirrorCanvas.width > 0) ? heroMirrorCanvas : null);
		if(!src) return 0;
		const x = opts.x, y = opts.y, w = opts.w, h = opts.h;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, w, h);
		ctx.clip();
		ctx.imageSmoothingEnabled = true;
		ctx.globalAlpha = Number.isFinite(opts.alpha) ? opts.alpha : 0.55;
		ctx.drawImage(src, 0, 0, src.width, src.height, x, y, w, h);
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'lighter';
		// The spine gradient is a pure function of (x,w), and weapons.js passes
		// literal constant rects — cache it across frames, rebuild on weapon swap.
		const sk = x * 4096 + w;
		if(!bladeSpineGrad || bladeSpineKey !== sk){
			bladeSpineKey = sk;
			bladeSpineGrad = ctx.createLinearGradient(x, 0, x + w, 0);
			bladeSpineGrad.addColorStop(0, 'rgba(255,255,255,0)');
			bladeSpineGrad.addColorStop(0.42, 'rgba(255,255,255,0.34)');
			bladeSpineGrad.addColorStop(0.62, 'rgba(255,255,255,0.10)');
			bladeSpineGrad.addColorStop(1, 'rgba(255,255,255,0)');
		}
		ctx.fillStyle = bladeSpineGrad;
		ctx.fillRect(x, y, w, h);
		ctx.restore();
		metrics.bladeSheens++;
		return 1;
	},
	// Effective glow tier: 1 normally, 2 with the `bloom` component on (it now
	// AMPLIFIES every source — tiles, creatures, projectiles — instead of owning
	// tiles alone), 0 under the QA kill switch. Tier 1 is not optional: the glow
	// REPLACES art the sources used to draw for themselves, so switching it off
	// would delete a firefly's light rather than remove an extra.
	glowTier(){
		if(HAS_WINDOW && window.__mmNoPostFX) return 0;
		return api.on('bloom') ? 2 : 1;
	},
	emissiveTier(){ return api.glowTier(); },  // earlier name, kept for QA seams
	// THE attribute seam. Hand it the object's own `glow` descriptor and where the
	// glowing part is (world pixels) and the renderer does the rest. Every domain —
	// mobs, weapons, projectiles, drops, machines, effects — comes through here, so
	// a new glowing thing is a DATA change, not a draw change.
	glow(x, y, spec, key, TILE){
		const g = normalizeGlow(spec, Number.isFinite(TILE) ? TILE : lastGlowTilePx);
		if(!g) return false;
		// addEmissive copies every field into its pooled ring entry synchronously,
		// so a shared scratch descriptor is safe and saves one literal per source
		// per frame (normalizeGlow stays pure — the suite pins its ramps).
		const s = glowHandoff;
		s.x = x; s.y = y; s.r = g.r; s.color = g.rgb; s.a = g.a; s.pulse = g.pulse;
		s.key = key; s.trail = g.trail && typeof key === 'string' && !!key;
		return api.addEmissive(s);
	},
	// Low-level inlet: radius already in world pixels. Nothing is painted here, so
	// a caller cannot accidentally land its glow under the darkness overlay. `key`
	// is required for a trail (a stable per-source identity); without one the
	// source is a still light.
	addEmissive(src){
		if(!src || !Number.isFinite(src.x) || !Number.isFinite(src.y)) return false;
		const r = Number(src.r);
		if(!(r > 0)) return false;
		if(api.glowTier() < 1) return false;
		if(emissiveCount >= EMISSIVE_MAX) return false;
		let e = emissiveQueue[emissiveCount];
		if(!e) e = emissiveQueue[emissiveCount] = { x: 0, y: 0, r: 0, rgb: '', a: 1, key: '', trail: false, pulse: 0 };
		e.x = src.x; e.y = src.y;
		e.r = Math.min(320, r);
		e.rgb = emissiveRgb(src.color);
		// Ceiling is 1/ampA(max), not 1: above it the OLD core blit clamped to opaque
		// while the baked profile would not, and the two stop being equivalent. The
		// largest alpha anything in the game declares is 0.68, so this never fires
		// today -- it is here so a future source cannot silently break the bake.
		e.a = Math.max(0, Math.min(GLOW_A_MAX, Number.isFinite(src.a) ? src.a : 0.55));
		e.pulse = Math.max(0, Math.min(1, Number(src.pulse) || 0));
		e.key = (src.trail && typeof src.key === 'string') ? src.key : '';
		e.trail = !!e.key;
		emissiveCount++;
		return true;
	},
	emissiveQueued(){ return emissiveCount; },
	// ONE glow frame driver for the whole game. Runs in WORLD space, called from
	// main.js above the darkness overlay (glow is what lives in the dark) and below
	// the fog pass (undiscovered black still wins on top). Two kinds of source land
	// in the same draw with the same two-layer look:
	//   TILES     found by a cadence-cached viewport scan of the tile glow attribute
	//             (INFO[t].glow) — hundreds of STATIC emitters, so scanning beats
	//             registering each one every frame, and a tile cannot streak.
	//   ENTITIES  registered during their own draw via api.glow / addEmissive, which
	//             is also what earns them a motion streak.
	// Drains the entity queue unconditionally: an early return that left entries
	// behind would draw last frame's glow at stale positions.
	drawGlowPass(ctx, opts){
		const n = emissiveCount;
		emissiveCount = 0;
		const tier = api.glowTier();
		if(tier < 1){
			// Killed: drop the histories too, so coming back cannot resume a streak
			// from wherever a source used to be. A merely EMPTY frame keeps them —
			// expiry is the TTL sweep's job, not a one-frame cull's.
			if(emissiveTrails.size) emissiveTrails.clear();
			if(!api.on('lightTint') && !api.on('heatShimmer')){ bloomEmitters.length = 0; bloomScanKey = ''; }
			return 0;
		}
		if(!ctx) return 0;
		const TILE = (opts && Number.isFinite(opts.TILE)) ? opts.TILE : lastGlowTilePx;
		lastGlowTilePx = TILE;
		const now = (opts && Number.isFinite(opts.now)) ? opts.now
			: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0);
		const tiles = (opts && typeof opts.getTile === 'function') ? ensureEmitterScan(opts) : NO_TILES;
		if(!n && !tiles.length) return 0;
		// Tier 2 is the `bloom` component: it AMPLIFIES every source uniformly —
		// tiles, creatures, projectiles alike — instead of owning tiles alone.
		const ampR = tier >= 2 ? 1.30 : 1;
		const ampA = tier >= 2 ? GLOW_AMP_A : 1;
		metrics.emissiveSources += n;
		emissiveFrame++;
		let halos = 0, streaks = 0, drawn = 0;
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		ctx.imageSmoothingEnabled = true;
		// Streaks first so the head halo always caps the tail it belongs to.
		if(n){
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			let trailed = 0;
			for(let i = 0; i < n; i++){
				const e = emissiveQueue[i];
				if(!e.trail) continue;
				if(trailed >= EMISSIVE_TRAIL_MAX) break; // only trailed sources use this loop
				trailed++;
				let hist = emissiveTrails.get(e.key);
				if(!hist){
					if(emissiveTrails.size >= EMISSIVE_MAX * 2) continue;
					hist = { pts: [], at: 0, seen: now, frame: 0 };
					emissiveTrails.set(e.key, hist);
				}
				hist.seen = now;
				if(hist.frame !== emissiveFrame){
					hist.frame = emissiveFrame;
					if(trailBroken(hist, e.x, e.y)) hist.pts.length = 0;
					if(trailSampleDue(hist, e.x, e.y, now)){
						hist.pts.push({ x: e.x, y: e.y });
						if(hist.pts.length > TRAIL_PTS) hist.pts.shift();
						hist.at = now;
					} else if(hist.pts.length && now - hist.at > TRAIL_RETRACT_MS){
						// No new sample due: the source stands still. Retract the tail
						// into the body one point per period — a stopped mob used to keep
						// drawing its full frozen streak at the old positions forever.
						hist.pts.shift();
						hist.at = now;
					}
				}
				const pts = hist.pts;
				if(pts.length < 2) continue;
				// One colour per source, alpha per segment: varying globalAlpha instead
				// of rebuilding an rgba() string keeps the whole streak allocation-free.
				ctx.strokeStyle = glowStrokeFor(e.rgb);
				for(let s = 1; s < pts.length; s++){
					const w = trailTaper(s, pts.length);
					ctx.globalAlpha = Math.min(0.55, e.a * 0.42 * ampA * w);
					ctx.lineWidth = Math.max(0.7, e.r * 0.42 * w);
					ctx.beginPath();
					ctx.moveTo(pts[s - 1].x, pts[s - 1].y);
					ctx.lineTo(pts[s].x, pts[s].y);
					ctx.stroke();
					streaks++;
				}
				// close the gap between the newest sample and where the source is NOW
				ctx.globalAlpha = Math.min(0.55, e.a * 0.42 * ampA);
				ctx.lineWidth = Math.max(0.7, e.r * 0.42);
				ctx.beginPath();
				ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
				ctx.lineTo(e.x, e.y);
				ctx.stroke();
				streaks++;
			}
		}
		const tSec = now / 1000;
		// A wide dim bleed UNDER a tight bright core: the two-layer shape of a real
		// bloom, and the thing that makes a glow read as light instead of as a
		// coloured disc stuck on the sprite. Both source kinds get it.
		// `lighter` is commutative under clamping, so skipping a globalAlpha set when
		// the value repeats is bit-exact (no reordering happens — same draw order).
		const gain = 0.34 * ampA * GLOW_BAKE_GAIN;
		let lastGA = -1;
		for(let i = 0; i < n; i++){
			const e = emissiveQueue[i];
			const spr = glowBakedSpriteFor(e.rgb, tier);
			if(!spr) continue;   // one bad colour must not drop the rest
			const beat = e.pulse > 0
				? (1 - e.pulse) + e.pulse * (0.82 + 0.18 * Math.sin(tSec * 2.1 + e.x * 0.07 + e.y * 0.04))
				: 1;
			const wr = e.r * beat * 1.85 * ampR;
			const ga = Math.min(1, e.a * gain);
			if(ga !== lastGA){ ctx.globalAlpha = ga; lastGA = ga; }
			ctx.drawImage(spr, e.x - wr, e.y - wr, wr * 2, wr * 2);
			halos += 1;
		}
		for(let i = 0; i < tiles.length; i++){
			const e = tiles[i];
			const spr = glowBakedSpriteFor(e.color, tier);
			if(!spr) continue;   // one bad colour must not drop the rest
			// Per-emitter phase from the tile position: deterministic, so a torch
			// breathes without a stored animation state.
			const pulse = 0.82 + 0.18 * Math.sin(tSec * 2.1 + e.x * 0.73 + e.y * 0.41);
			const wr = TILE * (0.7 + e.level * 0.2) * pulse * 1.85 * ampR;   // normalizeGlow's ramp
			const a = Math.min(0.68, 0.3 + e.level * 0.018);
			const cx = e.x * TILE + TILE * 0.5, cy = e.y * TILE + TILE * 0.5;
			const ga = Math.min(1, a * gain);
			if(ga !== lastGA){ ctx.globalAlpha = ga; lastGA = ga; }
			ctx.drawImage(spr, cx - wr, cy - wr, wr * 2, wr * 2);
			drawn++;
		}
		ctx.restore();
		metrics.emissiveHalos += halos;
		metrics.emissiveStreaks += streaks;
		metrics.bloomDraws += drawn;
		// Histories of sources that stopped being drawn (dead, culled, fogged) expire
		// on a slow sweep rather than per frame.
		if(emissiveTrails.size && now - emissiveTrailSweepAt > 500){
			emissiveTrailSweepAt = now;
			for(const [key, hist] of emissiveTrails){
				if(now - hist.seen > TRAIL_TTL_MS) emissiveTrails.delete(key);
			}
		}
		return halos + drawn;
	},
	// Former names, kept so QA seams and the cost harness keep working: both halves
	// of the old split now run through the one pass above.
	drawEmissivePass(ctx, opts){ return api.drawGlowPass(ctx, opts); },
	drawBloomPass(ctx, opts){ return api.on('bloom') ? api.drawGlowPass(ctx, opts) : 0; },
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
			for(const zone of SHEEN_ZONES){
				const cur = sheenCur[zone], tgt = target[zone];
				for(let i = 0; i < 3; i++) cur[i] += (tgt[i] - cur[i]) * k;
			}
		}
		sheenChaseAt = now;
		const bx = opts.bx, by = opts.by, bw = opts.bw, bh = opts.bh;
		const rgb = (z) => Math.round(sheenCur[z][0]) + ',' + Math.round(sheenCur[z][1]) + ',' + Math.round(sheenCur[z][2]);
		// Prefer the full-scene grab (everything the world drew last frame);
		// fall back to this frame's pre-sprite grab on the very first frame or
		// right after a resize, and to the sampled tint when both went stale.
		const fresh = (t) => t > 0 && (now - t) < HERO_GRAB_TTL_MS;
		// The full-field fallback is only valid when the mirror canvas actually HOLDS
		// a full field (heroMirrorFull) — on patch-only frames it is frames old.
		const mirror = (fresh(heroSceneAt) && heroSceneCanvas && heroSceneCanvas.width > 0)
			? heroSceneCanvas
			: ((heroMirrorFull && fresh(heroMirrorAt) && heroMirrorCanvas && heroMirrorCanvas.width > 0) ? heroMirrorCanvas : null);
		heroSceneUsed = mirror === heroSceneCanvas;
		heroMirrorUsed = !!mirror;
		const daylight = Math.max(0, Math.min(1, Number.isFinite(opts.daylight) ? opts.daylight : 1));
		ctx.save();
		// The outfit is a plain filled RECT with a 1px outline (inventory.js
		// drawOutfit) — clip to that WHOLE rect. Any inset leaves a ring of bare
		// outfit colour between the black outline and the coat, and since the
		// inset is world-space it grows with zoom: the "extra border" the coat
		// used to show. The stroke straddles the edge, so its outer half still
		// separates the hero from the background.
		ctx.beginPath();
		ctx.rect(bx, by, bw, bh);
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
			// Fresnel-masked blit: a polished surface reflects hardest where it
			// turns away from the viewer, so the coat is near-opaque at the rim
			// and thin over the middle — which is also what keeps the hero's face
			// and outfit readable instead of replacing the sprite with a window.
			// No inner save/restore: the outer restore below resets both fields,
			// and nothing between here and it reads imageSmoothingEnabled.
			ctx.imageSmoothingEnabled = true;
			ctx.globalAlpha = 0.72;
			ctx.drawImage(coat, bx, by, bw, bh);
			ctx.globalAlpha = 1;
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
		// FIXED cap (owner's rule: a weak machine sees the full picture; constant
		// work bounds yes, frame-time-keyed quality never). 64 cannot bind anyway:
		// a 40x28 viewport holds at most ~20 8x8 dedupe cells.
		const cap = 64;
		// The cell dedupe is a pure function of the cadence-cached emitter list —
		// rebuild the winners when the scan refreshes, not every frame. Numeric cell
		// key: x is viewport-bounded, y ∈ −140..280, so (cx·65536)+(cy+32768) cannot
		// collide. The cap stays a draw-time cut (it varies, the winners do not).
		if(tintWinnersGen !== bloomScanGen){
			tintWinnersGen = bloomScanGen;
			tintWinners.length = 0;
			tintCells.clear();
			for(const e of emitters){
				const cell = ((e.x >> 3) * 65536) + ((e.y >> 3) + 32768);
				if(tintCells.has(cell)) continue;
				tintCells.add(cell);
				tintWinners.push(e);
			}
		}
		let drawn = 0;
		ctx.save();
		// The doc above PROMISES source-over; enforce it instead of inheriting
		// whatever the previous overlay left behind.
		ctx.globalCompositeOperation = 'source-over';
		ctx.imageSmoothingEnabled = true;
		for(let i = 0; i < tintWinners.length; i++){
			if(drawn >= cap) break;
			const e = tintWinners[i];
			const spr = glowSpriteFor(e.color);
			if(!spr) continue;   // one bad colour must not drop the rest
			const r = TILE * (2.6 + e.level * 0.4);
			ctx.globalAlpha = 0.08 + e.level * 0.010;   // level ≤ 15 ⇒ max 0.23; the old 0.26 clamp was dead code
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
		// alpha is fixed for the whole frame — build the two stop strings once,
		// not per beam (they were 48 string builds a frame at the 24-beam cap).
		const rayTop = 'rgba(255,244,200,' + alpha.toFixed(3) + ')';
		const rayBot = 'rgba(255,244,200,' + (alpha * 0.45).toFixed(3) + ')';
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
			grad.addColorStop(0, rayTop);
			grad.addColorStop(1, rayBot);
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
	// Heat shimmer: the air over hot things refracts what is behind it. Built the
	// way a shader does it (see heatOffsetPx above) -- the painted rect never
	// moves, only the coordinate it samples FROM, so the distortion can never climb
	// onto a neighbouring block. Sampled in thin rows off one smooth field that
	// travels upward and fades with height, which is what makes it read as rising
	// air instead of a rhythmic slosh.
	// Runs in DEVICE space (transform reset): rows land on whole pixels, the blits
	// are 1:1, and only the source x carries a fraction -- that fraction is the
	// whole point, it is what keeps the wave from quantising into visible steps.
	// drawImage-only, like the water reflections -- the readback taboo holds.
	drawHeatShimmerPass(ctx, opts){
		if(!api.on('heatShimmer')){
			if(heatBlitCanvas){ heatBlitCanvas = null; heatBlitCtx = null; }
			return 0;
		}
		if(!ctx || !opts || typeof opts.getTile !== 'function' || !ctx.canvas) return 0;
		let m = null;
		try{ m = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null; }catch(e){ m = null; }
		if(!m || !Number.isFinite(m.a) || m.a <= 0 || !Number.isFinite(m.d) || m.d <= 0) return 0;
		if(typeof ctx.setTransform !== 'function') return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const now = Number.isFinite(opts.now) ? opts.now : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0);
		const getTile = opts.getTile;
		// Sources: hot TILES off the shared emitter scan (the attribute decides, see
		// heatSourceFor) plus the live registries that are not tiles at all. Every one
		// of them needs open air overhead -- a capped lava vein bends nothing.
		// Pooled source list: entries are recycled objects valid until the next call
		// (~170 throwaway objects per frame during a large fire otherwise).
		const sources = heatSrcList;
		sources.length = 0;
		const emitters = ensureEmitterScan(opts);
		for(let i = 0; i < emitters.length; i++){
			const e = emitters[i];
			const strength = heatSourceFor(e.t);
			if(!(strength > 0) || getTile(e.x, e.y - 1) !== T.AIR) continue;
			const p = heatSrcPool[sources.length] || (heatSrcPool[sources.length] = { x: 0, y: 0, strength: 0 });
			p.x = e.x; p.y = e.y; p.strength = strength;
			sources.push(p);
		}
		// The live feeds (geothermal pools, burning tiles) are culled on x only by
		// their callers, while the band sort (hottest first) and the band/row caps
		// run BEFORE off-canvas bands are discarded — so a fire in a mine below the
		// screen could outrank and silently suppress the plumes actually in view.
		// Cut to the visible rows (+3: the tallest plume is 2.5 tiles).
		const yMin = Number.isFinite(opts.sy) ? Math.floor(opts.sy) - 1 : -Infinity;
		const yMax = (Number.isFinite(opts.sy) && Number.isFinite(opts.viewY)) ? Math.ceil(opts.sy + opts.viewY) + 3 : Infinity;
		for(let li = 0; li < 2; li++){
			const list = li === 0 ? opts.pools : opts.burning;
			const strength = li === 0 ? 0.5 : 0.8;
			if(!Array.isArray(list)) continue;
			for(let i = 0; i < list.length; i++){
				const s = list[i];
				if(!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
				const ry = Math.round(s.y);
				if(ry < yMin || ry > yMax) continue;
				if(getTile(Math.round(s.x), ry - 1) !== T.AIR) continue;
				if(typeof opts.visibleAt === 'function' && !opts.visibleAt(Math.round(s.x), ry)) continue;
				const p = heatSrcPool[sources.length] || (heatSrcPool[sources.length] = { x: 0, y: 0, strength: 0 });
				p.x = s.x; p.y = s.y; p.strength = strength;
				sources.push(p);
			}
		}
		if(!sources.length) return 0;
		// The same probe the ceiling clip runs, lent to the merger so it only bridges
		// a gap that is genuinely open air (QA seam: opts.mergeGap A/Bs the merge).
		const airAbove = (x, y, need) => {
			for(let k = 0; k < need; k++) if(getTile(x, y - 1 - k) !== T.AIR) return false;
			return true;
		};
		const bands = buildHeatBands(sources, { focusX: opts.sx + (Number(opts.viewX) || 0) * 0.5, TILE, scale: m.d,
			rowBudget: HEAT_ROW_BUDGET, bandCap: HEAT_BAND_CAP,
			mergeGap: Number.isFinite(opts.mergeGap) ? opts.mergeGap : HEAT_MERGE_GAP, airAbove });
		if(!bands.length) return 0;
		const cw = ctx.canvas.width | 0, ch = ctx.canvas.height | 0;
		if(cw < 2 || ch < 2) return 0;
		let rowsDrawn = 0, bandsDrawn = 0;
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.imageSmoothingEnabled = true;
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = 1;
		for(const band of bands){
			// Clip the plume to the open air actually above the run: it must never
			// distort through the ceiling of a lava cavern.
			const wantTiles = heatPlumeTiles(band.strength);
			let openTiles = Math.ceil(wantTiles);
			for(let x = band.x0; x <= band.x1 && openTiles > 0; x++){
				let k = 0;
				while(k < openTiles && getTile(x, band.y - 1 - k) === T.AIR) k++;
				if(k < openTiles) openTiles = k;
			}
			if(openTiles <= 0) continue;
			const plumeTiles = Math.min(wantTiles, openTiles);
			const baseY = Math.round(m.d * (band.y * TILE) + m.f);
			const plumeH = plumeTiles * TILE * m.d;
			const topY = Math.max(0, Math.round(baseY - plumeH));
			if(baseY <= 0 || topY >= ch || baseY - topY < HEAT_ROW_PX[0]) continue;
			const amp = heatAmpPx(band.strength) * m.d;
			const wave = HEAT_WAVE_PX * m.d;
			// A plume SPREADS as it rises. Widening the band with height also drags its
			// left/right edge off the vertical, so the seam where the effect stops is a
			// moving diagonal instead of a straight line begging to be noticed -- and by
			// then the envelope has faded the displacement to nearly nothing anyway.
			const spread = TILE * m.d * 0.5;
			const coreX0 = m.a * (band.x0 * TILE) + m.e;
			const coreX1 = m.a * ((band.x1 + 1) * TILE) + m.e;
			const seed = (band.x0 * 0.7 + band.y * 1.3) % 6.283;
			// Only the strip this plume can actually read is copied: its own columns,
			// plus the spread, plus the peak displacement it may sample across.
			const margin = Math.ceil(amp) + 1;
			const regX0 = Math.max(0, Math.round(coreX0 - spread) - margin);
			const regX1 = Math.min(cw, Math.round(coreX1 + spread) + margin);
			const regY0 = Math.max(0, topY), regY1 = Math.min(ch, baseY);
			const regW = regX1 - regX0, regH = regY1 - regY0;
			if(regW < 2 || regH < 2) continue;
			const srcCanvas = snapshotSceneRegion(ctx.canvas, regX0, regY0, regW, regH);
			if(!srcCanvas) continue;
			bandsDrawn++;
			// Row boundaries are derived from ROUNDED distances up the plume, so
			// consecutive rows share an edge exactly -- a rounded height per row would
			// drift and leave hairline strips of undistorted world between them.
			let d = 0, edge = baseY;
			while(d < plumeH){
				const h = d / plumeH;
				d += heatRowHeight(h);
				const ry = Math.round(baseY - Math.min(d, plumeH));
				const rh = Math.min(edge, ch) - ry;
				edge = ry;
				if(ry < 0) break;
				if(rh < 1 || ry >= ch) continue;
				const grow = spread * h;
				const x0 = Math.round(Math.max(regX0, coreX0 - grow));
				const x1 = Math.round(Math.min(regX1, coreX1 + grow));
				const w = x1 - x0;
				if(w < 1) continue;
				const off = heatOffsetPx(ry, baseY, plumeH, amp, wave, seed, now);
				if(off > -0.05 && off < 0.05) continue;   // this row sits on a node of the field
				const sx = Math.max(regX0, Math.min(regX1 - w, x0 + off));
				ctx.drawImage(srcCanvas, sx - regX0, ry - regY0, w, rh, x0, ry, w, rh);
				rowsDrawn++;
			}
		}
		ctx.restore();
		metrics.shimmerBands += bandsDrawn;
		metrics.shimmerSlices += rowsDrawn;
		return rowsDrawn;
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
		// FIXED budget — same rule as the tint cap above; 48 motes cost ~5 µs even
		// on a software canvas, so the old stressed-frame halving bought nothing.
		const budget = 48;
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
			iceRunKey = ''; iceRuns.length = 0; iceCols.length = 0;
			if(!api.on('heatShimmer') && heatBlitCanvas){ heatBlitCanvas = null; heatBlitCtx = null; }
			return 0;
		}
		if(!ctx || !opts || typeof opts.getTile !== 'function' || typeof opts.surfaceHeight !== 'function' || !ctx.canvas) return 0;
		let m = null;
		try{ m = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : null; }catch(e){ m = null; }
		if(!m || !Number.isFinite(m.a) || m.a <= 0 || !Number.isFinite(m.d) || m.d <= 0) return 0;
		const TILE = Number.isFinite(opts.TILE) ? opts.TILE : 20;
		const cw = ctx.canvas.width | 0, ch = ctx.canvas.height | 0;
		if(cw < 2 || ch < 2) return 0;
		const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
		const x0 = Math.floor(opts.sx) - 1, x1 = Math.ceil(opts.sx + opts.viewX) + 1;
		const key = x0 + '|' + x1;
		if(key !== iceRunKey || now - iceRunScanAt > 400){
			iceRuns = collectIceRuns({ x0, x1, getTile: opts.getTile, surfaceHeight: opts.surfaceHeight, max: 140 });
			iceRunKey = key; iceRunScanAt = now;
		}
		if(!iceRuns.length) return 0;
		const visibleAt = typeof opts.visibleAt === 'function' ? opts.visibleAt : null;
		// Resolve every column's geometry and apply EVERY cull FIRST, then copy pixels.
		// The snapshot used to be taken before this, so a frame that draws nothing still
		// paid for it -- and the run scan is x-only (this pass is given no sy/viewY), so
		// "nothing" is the normal case: underground, fogged, or the surface off-screen.
		iceCols.length = 0;
		let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
		for(const run of iceRuns){
			if(visibleAt && !visibleAt(run.x, run.surf)) continue;
			const wxPx = run.x * TILE, topPx = run.surf * TILE;
			const bandPx = TILE * 3;
			const sxDev = m.a * wxPx + m.e, swDev = m.a * TILE;
			let syDev = m.d * (topPx - bandPx) + m.f;
			let shDev = m.d * bandPx;
			if(syDev < 0){ shDev += syDev; syDev = 0; }
			if(!(shDev > 1) || syDev >= ch || sxDev < 0 || sxDev + swDev > cw) continue;
			const destH = Math.min(TILE * 0.85, (shDev / m.d) * 0.45);
			if(!(destH > 1)) continue;
			iceCols.push(wxPx, topPx, sxDev, syDev, swDev, shDev, destH);
			if(sxDev < rx0) rx0 = sxDev;
			if(syDev < ry0) ry0 = syDev;
			if(sxDev + swDev > rx1) rx1 = sxDev + swDev;
			if(syDev + shDev > ry1) ry1 = syDev + shDev;
		}
		if(!iceCols.length) return 0;
		// Only the band the ice actually reads: three tiles above the ice line, across
		// the surviving columns. A screen-wide lake reads ~1600x120 of a 1600x900 frame.
		const regX0 = Math.max(0, Math.floor(rx0)), regY0 = Math.max(0, Math.floor(ry0));
		const regW = Math.min(cw, Math.ceil(rx1)) - regX0, regH = Math.min(ch, Math.ceil(ry1)) - regY0;
		if(regW < 2 || regH < 2) return 0;
		const srcCanvas = snapshotSceneRegion(ctx.canvas, regX0, regY0, regW, regH);
		if(!srcCanvas) return 0;
		let cols = 0;
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.globalAlpha = 0.24;
		for(let i = 0; i < iceCols.length; i += ICE_STRIDE){
			const wxPx = iceCols[i], topPx = iceCols[i + 1];
			const sxDev = iceCols[i + 2] - regX0, syDev = iceCols[i + 3] - regY0;
			const swDev = iceCols[i + 4], shDev = iceCols[i + 5], destH = iceCols[i + 6];
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
