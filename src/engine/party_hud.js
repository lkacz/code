// Party HUD (party_hud.js): the co-op team roster + off-screen teammate arrows.
// A "beyond" feature — it exists only when a session has a party (a host with
// embodied guests, or a guest sharing a host's world). Pure geometry core
// (importable/testable under Node) below the RENDER line; DOM/canvas painters
// above it only touch the browser when called.
//
// Model/renderer split like vitals_hud.js: partyPointers() decides who is on
// screen and where an off-screen teammate's edge arrow points; the painters
// just draw what it returns. Data is role-agnostic — main.js hands it a plain
// member list ({id,name,x,y,hpFrac,self,dead,facing}) gathered from whichever
// of ghost_host / ghost_client is live, so ONE HUD serves both ends.

const MMR = (typeof window !== 'undefined' && window.MM) ? window.MM : null;

// --- pure geometry ----------------------------------------------------------------
// World→screen is the game's standard mapping: sx = (x - camX) * tile * zoom.
// A member is "on screen" when its screen point sits inside the margin box; an
// off-screen member is clamped to an ellipse near the viewport edge with an arrow
// angle from screen centre, plus the true world distance for the label.
export function partyPointers(members, view){
	const out = { onScreen: [], offScreen: [] };
	if(!Array.isArray(members) || !view) return out;
	const tile = Number(view.tile) || 20;
	const z = Number(view.zoom) || 1;
	const W = Number(view.W) || 0, H = Number(view.H) || 0;
	const camX = Number(view.camX) || 0, camY = Number(view.camY) || 0;
	const margin = Number.isFinite(view.margin) ? view.margin : 46;
	const cx = W / 2, cy = H / 2;
	const edge = Math.max(24, Math.min(W, H) / 2 - 52);
	for(const m of members){
		if(!m || m.self || m.dead) continue;
		if(!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
		const sx = (m.x - camX) * tile * z;
		const sy = (m.y - camY) * tile * z;
		if(!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
		const hpFrac = Math.max(0, Math.min(1, Number(m.hpFrac) || 0));
		if(sx > margin && sx < W - margin && sy > margin && sy < H - margin){
			out.onScreen.push({ id: m.id, name: m.name, hpFrac, sx, sy });
		} else {
			const ang = Math.atan2(sy - cy, sx - cx);
			// elliptical clamp keeps the arrow off the extreme corners on wide screens
			const ex = cx + Math.cos(ang) * edge;
			const ey = cy + Math.sin(ang) * edge;
			let dist = null;
			if(Number.isFinite(view.heroX) && Number.isFinite(view.heroY)){
				dist = Math.hypot(m.x - view.heroX, m.y - view.heroY);
			}
			out.offScreen.push({ id: m.id, name: m.name, hpFrac, ex, ey, ang, dist });
		}
	}
	return out;
}
// The roster is a stable-sorted view: self first (rendered as "Ty"), then the
// rest by name, so the DOM rows never reorder frame to frame and flicker.
export function partyRoster(members){
	if(!Array.isArray(members)) return [];
	const rows = members.filter(m => m && (m.self || (Number.isFinite(m.x) && Number.isFinite(m.y))))
		.map(m => ({ id: m.id, name: m.self ? 'Ty' : (m.name || 'Gracz'), hpFrac: Math.max(0, Math.min(1, Number(m.hpFrac) || 0)), self: !!m.self, dead: !!m.dead }));
	rows.sort((a, b) => (a.self ? -1 : b.self ? 1 : String(a.name).localeCompare(String(b.name))));
	return rows;
}
export function hpColor(frac){
	const f = Math.max(0, Math.min(1, frac));
	if(f > 0.5) return '#58d68d';
	if(f > 0.25) return '#f4c05a';
	return '#e5533d';
}
// Click-to-focus: a roster row click highlights that teammate's arrow/marker
// for a short pulse. Pure: alpha in (0,1] while alive, null when expired.
export const FOCUS_MS = 3000;
export function focusPulse(nowMs, until){
	if(!Number.isFinite(nowMs) || !Number.isFinite(until) || nowMs >= until) return null;
	return 0.55 + 0.45 * Math.sin(nowMs / 120);
}

// ============================ RENDER (browser) ============================

let bar = null, rows = new Map(), lastSig = '';
let focus = null; // {id, until} — set by a roster row click, read by the painters
function ensureBar(){
	if(bar || typeof document === 'undefined') return bar;
	bar = document.createElement('div');
	bar.id = 'partyBar';
	bar.style.cssText = 'position:fixed; left:10px; top:92px; z-index:95; display:none; flex-direction:column; gap:4px;'
		+ ' padding:7px 9px; border-radius:12px; border:1px solid rgba(120,180,255,.28); background:rgba(10,15,24,.72);'
		+ ' color:#dcebff; font:11.5px system-ui; box-shadow:0 6px 18px rgba(0,0,0,.4); pointer-events:auto; max-width:180px;';
	const head = document.createElement('div');
	head.id = 'partyBarHead';
	head.style.cssText = 'font-weight:800;color:#8fc7ff;letter-spacing:.3px;';
	head.textContent = '👥 Drużyna';
	bar.appendChild(head);
	// touch layouts wrap the top bar taller — nudge the roster below it
	const st = document.createElement('style');
	st.textContent = 'html[data-input-mode="touch"] #partyBar{ top:128px; max-width:150px; }';
	document.head.appendChild(st);
	document.body.appendChild(bar);
	return bar;
}
// Rebuild rows only when the roster COMPOSITION changes (join/leave/rename);
// HP fills update in place every frame without touching the DOM structure, so a
// full room never thrashes layout.
function syncRoster(roster){
	const b = ensureBar();
	if(!b) return;
	if(!roster.length){ b.style.display = 'none'; return; }
	b.style.display = 'flex';
	const sig = roster.map(r => r.id + ':' + r.name).join('|');
	if(sig !== lastSig){
		lastSig = sig;
		for(const [, el] of rows){ if(el.parentNode) el.parentNode.removeChild(el); }
		rows.clear();
		for(const r of roster){
			const row = document.createElement('div');
			row.style.cssText = 'display:flex;align-items:center;gap:6px;' + (r.self ? '' : 'cursor:pointer;');
			const nm = document.createElement('span');
			nm.className = 'partyName';
			nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;'
				+ (r.self ? 'color:#aef0c2;' : '');
			nm.textContent = r.name;
			const barWrap = document.createElement('span');
			barWrap.style.cssText = 'width:46px;height:5px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden;flex:none;';
			const fill = document.createElement('span');
			fill.className = 'partyHpFill';
			fill.style.cssText = 'display:block;height:100%;border-radius:99px;transition:width .2s ease;';
			barWrap.appendChild(fill);
			row.append(nm, barWrap);
			// clicking a teammate's row pulses its marker/arrow for a moment —
			// display-only, both ends, zero protocol (self has nothing to point at)
			if(!r.self){
				const id = r.id;
				row.addEventListener('click', () => { focus = { id, until: Date.now() + FOCUS_MS }; });
			}
			b.appendChild(row);
			rows.set(r.id, row);
		}
	}
	for(const r of roster){
		const el = rows.get(r.id);
		if(!el) continue;
		const fill = el.querySelector('.partyHpFill');
		if(fill){ fill.style.width = Math.round(r.hpFrac * 100) + '%'; fill.style.background = r.dead ? '#555' : hpColor(r.hpFrac); }
		el.style.opacity = r.dead ? '0.5' : '1';
		// a dead teammate keeps its row, marked with a skull until respawn
		const nm = el.querySelector('.partyName');
		const label = (r.dead ? '💀 ' : '') + r.name;
		if(nm && nm.textContent !== label) nm.textContent = label;
	}
}
// Screen-space edge arrows to off-screen teammates — drawn in draw() after the
// world transform is gone, exactly like the boss/task off-screen pointers.
function drawArrows(ctx, data){
	if(!ctx || !data || !data.offScreen.length) return;
	for(const p of data.offScreen){
		ctx.save();
		ctx.translate(p.ex, p.ey);
		ctx.rotate(p.ang);
		ctx.fillStyle = hpColor(p.hpFrac);
		ctx.globalAlpha = 0.9;
		ctx.beginPath();
		ctx.moveTo(13, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8);
		ctx.closePath(); ctx.fill();
		ctx.rotate(-p.ang);
		const label = String(p.name || 'Gracz').slice(0, 12) + (Number.isFinite(p.dist) ? ' ' + Math.round(p.dist) + 'm' : '');
		const w = Math.max(40, label.length * 6.4 + 12);
		ctx.globalAlpha = 1;
		ctx.fillStyle = 'rgba(0,0,0,0.55)';
		ctx.fillRect(-w / 2, 12, w, 15);
		ctx.fillStyle = '#eaf3ff';
		ctx.font = '10.5px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText(label, 0, 23);
		ctx.restore();
	}
	// on-screen teammates get a small name+hp tag ABOVE their head handled by the
	// existing body painters (paintBodyTag) — the HUD owns only the edge arrows
	// and the roster, so the two never double up.
}
// The clicked teammate's marker pulses briefly: a ring at its on-screen spot
// or around its edge arrow, so "where is Bob" is one roster click.
function drawFocus(ctx, data){
	if(!ctx || !focus) return;
	const a = focusPulse(Date.now(), focus.until);
	if(a == null){ focus = null; return; }
	const on = data.onScreen.find(p => p.id === focus.id);
	const off = on ? null : data.offScreen.find(p => p.id === focus.id);
	const px = on ? on.sx : (off ? off.ex : null);
	const py = on ? on.sy : (off ? off.ey : null);
	if(px == null) return; // the teammate left the feed mid-pulse
	ctx.save();
	ctx.globalAlpha = a;
	ctx.strokeStyle = '#8fc7ff';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.arc(px, py, 22 + 6 * a, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}
// The one entry point main.js calls each frame: gather-free — it takes the
// already-built member list and the view, updates the roster and paints arrows.
export function draw(ctx, opts){
	if(!opts) return;
	const members = Array.isArray(opts.members) ? opts.members : [];
	syncRoster(partyRoster(members));
	const data = partyPointers(members, opts);
	drawArrows(ctx, data);
	drawFocus(ctx, data);
}
export function hide(){ if(bar) bar.style.display = 'none'; lastSig = ''; }

const api = { draw, hide, partyPointers, partyRoster, hpColor, focusPulse, FOCUS_MS };
if(MMR) MMR.partyHud = api;
export const partyHud = api;
export default partyHud;
