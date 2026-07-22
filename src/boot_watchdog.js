// Boot watchdog — classic script, deliberately OUTSIDE the ES-module graph.
// If any module in src/main.js's import tree stalls or fails to download, the
// browser silently abandons the whole graph: the player is left staring at the
// static HUD skeleton with a black world and no hint of what happened. This
// file loads independently of that graph, so it can still speak for the game.
//
// Contract: the game is "alive" once the main loop publishes its first frame
// (window.__mmFrameMs, set every frame by main.js). Until then the watchdog
// listens for module-load errors and runs a timeout; both paths end in a
// visible "the world did not load" panel with a retry button. The moment the
// heartbeat appears — even after the panel is shown — the watchdog disarms
// and cleans up after itself.
(function(){
	// GitHub Pages cannot emit frame-ancestors/X-Frame-Options. Refuse public
	// framing here as defense-in-depth: this also prevents accidentally deployed
	// same-origin QA harnesses from driving a player's real storage. Localhost and
	// file:// remain embeddable for the repository's isolated visual harnesses.
	(function guardPublicFrame(){
		var host = String(location.hostname || '').toLowerCase();
		var local = location.protocol === 'file:' || host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
		if (local || window.top === window.self) return;
		// main.js checks this before creating the live simulation. Keep the flag set
		// even while a permitted top-navigation is pending so no framed instance can
		// reach save/state side effects in the meantime.
		window.__mmPublicFrameBlocked = true;
		try{ window.top.location = window.self.location.href; }
		catch(e){
			document.documentElement.style.display = 'none';
			window.addEventListener('DOMContentLoaded', function(){
				document.body.textContent = 'Ta gra działa wyłącznie jako strona najwyższego poziomu.';
				document.documentElement.style.display = '';
			}, {once:true});
		}
	})();
	// The frame refusal is a terminal, intentional state. Its dedicated message
	// must not be replaced by the generic failed-module timeout fifteen seconds
	// later.
	if (window.__mmPublicFrameBlocked) return;
	var BOOT_TIMEOUT_MS = 15000; // slow connections still beat this; a dead one never will
	var POLL_MS = 500;
	var overlay = null;
	var pollT = null;
	var deadlineT = null;
	var done = false;

	function booted(){ return typeof window.__mmFrameMs === 'number'; }

	function disarm(){
		if (done) return;
		done = true;
		if (pollT) clearInterval(pollT);
		if (deadlineT) clearTimeout(deadlineT);
		window.removeEventListener('error', onScriptError, true);
		if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
		overlay = null;
	}

	function showOverlay(detail){
		if (done || overlay || !document.body) return;
		overlay = document.createElement('div');
		overlay.id = 'bootWatchdog';
		overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(5,8,14,.88);font-family:system-ui,sans-serif;';
		var panel = document.createElement('div');
		panel.style.cssText = 'max-width:420px;margin:16px;padding:22px 26px;background:#141a26;border:1px solid rgba(255,255,255,.16);border-radius:14px;color:#e8e8e8;text-align:center;';
		var h = document.createElement('div');
		h.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:8px;';
		h.textContent = 'Świat się nie załadował';
		var p = document.createElement('div');
		p.style.cssText = 'font-size:13px;line-height:1.5;opacity:.85;margin-bottom:16px;';
		p.textContent = detail || 'Część plików gry nie dotarła (słabe połączenie lub przerwane pobieranie). Odśwież, aby spróbować ponownie.';
		var btn = document.createElement('button');
		btn.style.cssText = 'padding:10px 22px;font-size:14px;font-weight:600;color:#fff;background:#2f6fed;border:0;border-radius:10px;cursor:pointer;';
		btn.textContent = 'Spróbuj ponownie';
		btn.addEventListener('click', function(){ location.reload(); });
		panel.appendChild(h); panel.appendChild(p); panel.appendChild(btn);
		overlay.appendChild(panel);
		document.body.appendChild(overlay);
	}

	function onScriptError(e){
		if (done || booted()) return;
		var t = e && e.target;
		// A failed <script>/module fetch dispatches an error event on the element;
		// runtime errors inside a loaded game are not the watchdog's business.
		if (t && t.tagName === 'SCRIPT'){
			showOverlay('Nie udało się pobrać skryptów gry (' + (t.src ? t.src.split('/').pop() : 'moduł') + '). Odśwież, aby spróbować ponownie.');
		}
	}

	window.addEventListener('error', onScriptError, true);

	function start(){
		if (booted()){ disarm(); return; }
		pollT = setInterval(function(){ if (booted()) disarm(); }, POLL_MS);
		deadlineT = setTimeout(function(){ if (!booted()) showOverlay(); }, BOOT_TIMEOUT_MS);
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
	else start();
})();
