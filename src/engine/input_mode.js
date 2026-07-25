// Input-mode detection: decides whether the player is on a touch screen (phone/
// tablet) or a mouse+keyboard setup, so the touch-only control clusters (movement
// pad, mining ring, fire/ult/radar buttons) show on exactly the right devices.
//
// Resolution has two layers:
//   1. capability guess — media features sampled at boot (pointer:coarse, hover,
//      pointer:fine) plus touch-point count; picks the mode before any input.
//   2. last-input-wins — real input flips the mode at any time: a touch shows the
//      touch UI, a mouse press or a movement key hides it. Hybrid laptops and
//      tablets with keyboards therefore follow whatever the player actually uses.
// A short grace window after a touch ignores mouse presses (defensive against
// synthetic/compat mouse events some stacks emit right after a tap). Pen input is
// deliberately neutral: it works fine with either layout.
//
// The DOM binding stamps data-input-mode="touch"|"pc" on <html> — index.html CSS
// gates every .touchUi cluster off that attribute (with a media-query fallback
// for the pre-JS first paint) — exposes MM.inputMode {get,isTouch,model} and
// dispatches 'mm-input-mode-change' on window whenever the mode flips.
// The pure model is exported for tools/input-mode-sim.test.mjs.
window.MM = window.MM || {};

const TOUCH_STICKY_MS = 700; // mouse presses this soon after a touch are ghosts

export function createInputModeModel(caps){
	let cap = normalize(caps);
	let mode = resolveFromCaps(cap);
	let lastTouchMs = -Infinity;

	function normalize(c){
		c = c || {};
		return { coarse: !!c.coarse, hover: !!c.hover, fine: !!c.fine, hasTouch: !!c.hasTouch };
	}
	function resolveFromCaps(c){
		if(c.coarse) return 'touch';
		if(c.hover && c.fine) return 'pc';
		// exotic combos (fine pointer without hover, or no data): trust touch presence
		return c.hasTouch ? 'touch' : 'pc';
	}
	function set(next){ if(next===mode) return false; mode = next; return true; }

	return {
		mode: () => mode,
		capabilities: () => Object.assign({}, cap),
		// kind: 'touch' | 'mouse' | 'pen' | 'key'; returns true when the mode flipped
		note(kind, nowMs){
			const now = Number.isFinite(nowMs) ? nowMs : Date.now();
			if(kind==='touch'){ lastTouchMs = now; return set('touch'); }
			if(kind==='mouse'){
				if(now - lastTouchMs < TOUCH_STICKY_MS) return false;
				return set('pc');
			}
			if(kind==='key') return set('pc');
			return false; // pen and anything unknown: keep the current layout
		},
		// capability change (tablet docked/undocked, emulation toggled): fresh guess,
		// which the next real input is free to override again
		setCapabilities(next){
			cap = normalize(next);
			return set(resolveFromCaps(cap));
		}
	};
}

function domInit(){
	if(typeof document==='undefined' || typeof window.matchMedia!=='function') return;
	const mm = q => window.matchMedia(q);
	const readCaps = () => ({
		coarse: mm('(pointer:coarse)').matches,
		fine: mm('(pointer:fine)').matches,
		hover: mm('(hover:hover)').matches,
		hasTouch: ((navigator.maxTouchPoints|0) > 0) || ('ontouchstart' in window)
	});
	const model = createInputModeModel(readCaps());
	const root = document.documentElement;
	function apply(force){
		const changed = root.dataset.inputMode !== model.mode();
		if(changed) root.dataset.inputMode = model.mode();
		if(changed || force){
			try{ window.dispatchEvent(new CustomEvent('mm-input-mode-change',{detail:{mode:model.mode()}})); }catch(e){ /* CustomEvent missing in odd embeds */ }
		}
	}
	apply(true);

	window.addEventListener('pointerdown', ev => {
		const kind = ev.pointerType==='touch' ? 'touch' : ev.pointerType==='mouse' ? 'mouse' : 'pen';
		if(model.note(kind)) apply(false);
	}, {capture:true, passive:true});
	// touchstart fallback: some WebViews deliver touch without pointer events
	window.addEventListener('touchstart', () => { if(model.note('touch')) apply(false); }, {capture:true, passive:true});

	// Only movement keys count as "keyboard player" evidence — typing in a search
	// field (phone virtual keyboards included) must not hide the touch controls.
	const GAME_KEYS = new Set(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d',' ']);
	window.addEventListener('keydown', ev => {
		const t = ev.target;
		if(t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName||''))) return;
		if(!GAME_KEYS.has((ev.key||'').toLowerCase())) return;
		if(model.note('key')) apply(false);
	}, {capture:true});

	for(const q of ['(pointer:coarse)','(hover:hover)','(pointer:fine)']){
		try{
			const mq = mm(q);
			const onchange = () => { if(model.setCapabilities(readCaps())) apply(false); };
			if(mq.addEventListener) mq.addEventListener('change', onchange);
			else if(mq.addListener) mq.addListener(onchange);
		}catch(e){ /* matchMedia change events unsupported */ }
	}

	MM.inputMode = { get: () => model.mode(), isTouch: () => model.mode()==='touch', model };
}
domInit();
