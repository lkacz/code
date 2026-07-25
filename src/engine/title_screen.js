// Title screen: the game's opening bookend. The world boots and renders
// underneath; this overlay names the game, cracks one lore-flavored joke
// (rotating splash) and waits for the player — Kontynuuj / Nowa warstwa.
// While it is open, main.js freezes the simulation (loop gates on isOpen()),
// so nothing can eat the hero while the menu is admired.
//
// QA contract: every CDP driver runs headless Edge and none of them expects
// an overlay, so the screen AUTO-SKIPS under automation (Headless UA or
// navigator.webdriver). `?title=1` in the URL forces it anyway (the title's
// own QA driver uses this); `?title=0` force-skips for a human who wants a
// bare boot. Node sims import this module with no DOM: all document access
// hides behind guards, the pure helpers stay testable.
const titleScreen = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  // Lore + gameplay one-liners; boot picks one, then the screen keeps rolling
  // fresh ones every few seconds so idling on the menu is already content.
  const SPLASHES = [
    'Świat renderuje się tylko wtedy, gdy patrzysz.',
    'Drzewa ćwiczą upadki bez świadków.',
    'Stary Kwadrat już czeka. Podobno chce pić.',
    '100% kafli z wolnego wybiegu.',
    'Woda spływa w dół. Przeważnie.',
    'Zero mikropłatności — diamenty i tak leżą w ziemi.',
    'Pełzacze uprzejmie proszą: zgaś pochodnię.',
    'UFO przylatuje zgodnie z rozkładem.',
    'Lawa nie jest podłogą. Sprawdziliśmy dwukrotnie.',
    'Kret śpi pod mapą. Nie budzić. Albo budzić.',
    'Symulacja oszczędza ruch, gdy nikt nie patrzy.',
    'Twoje ciosy należą do ciebie. Zapamiętaj to na później.',
    'Handlarz przyjmuje wyłącznie diamenty. Inflacja.',
    'Śnieg pada wolumetrycznie.',
    'Każda śmierć to tylko zmiana współrzędnych.',
    'Jaskinie są ciemne od dnia premiery.',
    'Wiatr znosi strzały i plany.',
    'Piranie nie czytały patchnotów.',
    'Gdzieś jest środek mapy. Nie spiesz się do niego.',
    'Ekwipunek zapisuje się sam. Wspomnienia niestety też.',
    'Chmury pracują nawet w nocy. Nikt im nie płaci.',
    'Bedrock jest nieskończenie twardy. To nie metafora.',
    'Ocean ma dno, żebyś miał gdzie szukać wraków.',
    'Wulkan przyjmuje ofiary. Zwrotów nie przewidziano.'
  ];
  // Extra lines for observers who have already closed a layer (finale.layers):
  // the simulation remembers being watched and gets a little self-conscious.
  const VETERAN_SPLASHES = [
    'Znowu ty? Warstwa czuje się obserwowana.',
    'Drzewa już nie udają. Wiedzą, że wiesz.',
    'Stary Kwadrat poprosi o wodę. Tym razem naprawdę chce pić.',
    'Nowa warstwa, stare nawyki kursora.',
    'Symulacja przygotowała się na twoje spojrzenie. Trochę.'
  ];

  const state = {
    open: false,
    el: null,
    lastFocus: null,
    splashEl: null,
    splashTimer: null,
    splashIdx: -1,
    bootResult: null,   // 'shown' | 'skipped' — QA introspection
    onNewGame: null,
    hasSave: false
  };

  // --- pure helpers (Node-tested) -------------------------------------------
  // Automation never sees the title unless it asks for it: `?title=1` beats
  // every skip signal, `?title=0` beats every show signal, otherwise headless
  // UA / webdriver skip and a plain human boot shows.
  function shouldAutoSkip(env){
    const e = env || {};
    const search = String(e.search || '');
    if(/[?&]title=1\b/.test(search)) return false;
    if(/[?&]title=0\b/.test(search)) return true;
    if(e.webdriver === true) return true;
    if(/headless/i.test(String(e.ua || ''))) return true;
    return false;
  }
  function closedLayers(){
    try{ return Math.max(0, Math.floor(Number(MM.finale && MM.finale.layers && MM.finale.layers().completions) || 0)); }
    catch(e){ return 0; }
  }
  function splashPool(){
    return closedLayers() > 0 ? SPLASHES.concat(VETERAN_SPLASHES) : SPLASHES;
  }
  function pickSplash(rand){
    const r = (typeof rand === 'function') ? rand : Math.random;
    const pool = splashPool();
    let idx = Math.floor(Math.max(0, Math.min(0.999999, Number(r()) || 0)) * pool.length);
    if(idx === state.splashIdx) idx = (idx + 1) % pool.length; // never repeat back-to-back
    state.splashIdx = idx;
    return pool[idx];
  }

  // --- DOM -------------------------------------------------------------------
  function node(tag, cls, text){
    const n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }
  function build(){
    if(state.el || typeof document === 'undefined') return state.el;
    const el = node('div'); el.id = 'titleScreen';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'titleScreenTitle');
    const inner = node('div', 'tsInner');
    const closed = closedLayers();
    // veterans get greeted by the epithet their LAST layer earned (finale.js
    // stamps it into mm_layers_v1 next to the tally)
    let kick = closed > 0
      ? 'symulacja uruchomiona · zamknięte warstwy: ' + closed
      : 'symulacja uruchomiona · warstwa nieznana';
    try{
      const lv = closed > 0 && MM.finale && MM.finale.layers && MM.finale.layers().lastVerdict;
      if(lv && lv.title) kick += ' · ostatni werdykt: ' + lv.title;
    }catch(e){ /* the kicker survives without it */ }
    inner.appendChild(node('div', 'tsKicker', kick));
    const title = node('h1', 'tsTitle', 'MINI MINER'); title.id = 'titleScreenTitle';
    inner.appendChild(title);
    inner.appendChild(node('div', 'tsSub', '· Warstwy Symulacji ·'));
    state.splashEl = node('div', 'tsSplash', pickSplash());
    inner.appendChild(state.splashEl);
    const btns = node('div', 'tsButtons');
    const primary = node('button', 'tsPrimary', state.hasSave ? '▶ Kontynuuj' : '▶ Rozpocznij symulację');
    primary.type = 'button';
    primary.addEventListener('click', ()=>dismiss('button'));
    btns.appendChild(primary);
    if(state.hasSave){
      const fresh = node('button', 'tsSecondary', '🌱 Nowa warstwa (nowy świat)');
      fresh.type = 'button';
      fresh.addEventListener('click', ()=>{
        const ok = root.confirm ? root.confirm('Rozpocząć nową grę?\n\nBieżący świat, ekwipunek i postęp zostaną usunięte. Ręczne zapisy i ustawienia zostaną zachowane.') : true;
        if(!ok) return;
        fresh.disabled = true; fresh.textContent = 'Buduję nową warstwę…';
        let started = false;
        try{ if(typeof state.onNewGame === 'function') started = !!state.onNewGame(); }catch(e){}
        if(!started){ fresh.disabled = false; fresh.textContent = '🌱 Nowa warstwa (nowy świat)'; }
      });
      btns.appendChild(fresh);
    }
    inner.appendChild(btns);
    inner.appendChild(node('div', 'tsHint', state.hasSave ? 'Enter / klik = graj dalej · H w grze = pomoc' : 'Enter / klik = graj · H w grze = pomoc'));
    el.appendChild(inner);
    el.appendChild(node('div', 'tsFoot', 'Świat pod spodem już działa. Na razie udaje, że nie.'));
    (document.getElementById('ui') || document.body).appendChild(el);
    state.el = el;
    return el;
  }

  // Capture-phase: the title owns the keyboard while open, so gameplay
  // handlers (movement, inventory E, pause B…) never fire under the menu.
  // Browser/system combos (F-keys, Ctrl/Meta chords) pass through untouched.
  function focusableButtons(){
    if(!state.el) return [];
    return [...state.el.querySelectorAll('button:not([disabled])')].filter(b=>b.getClientRects().length>0);
  }
  function moveFocus(backward){
    const buttons=focusableButtons();
    if(!buttons.length) return;
    const at=buttons.indexOf(document.activeElement);
    const next=at<0 ? (backward?buttons.length-1:0) : (at+(backward?-1:1)+buttons.length)%buttons.length;
    buttons[next].focus();
  }
  function onKeyDown(e){
    if(!state.open) return;
    if(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(e.repeat) return;
    if(e.key === 'Tab'){ moveFocus(e.shiftKey); return; }
    if(e.key === 'Escape'){ dismiss('key'); return; }
    if(e.key === 'Enter' || e.key === ' '){
      const active=document.activeElement;
      if(active && state.el && state.el.contains(active) && active.tagName==='BUTTON') active.click();
      else {
        const primary=state.el && state.el.querySelector('.tsPrimary');
        if(primary) primary.click();
      }
    }
  }

  function show(){
    if(state.open || typeof document === 'undefined') return false;
    build();
    if(!state.el) return false;
    state.lastFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    state.open = true;
    state.el.classList.add('show');
    try{ document.body.classList.add('mmTitleOpen'); }catch(e){} // hides the HUD under the ceremony
    root.addEventListener('keydown', onKeyDown, true);
    if(state.splashTimer == null && typeof root.setInterval === 'function'){
      state.splashTimer = root.setInterval(()=>{
        if(state.splashEl) state.splashEl.textContent = pickSplash();
      }, 6000);
    }
    const focusPrimary=()=>{ try{ if(!state.open) return; const b=state.el && state.el.querySelector('.tsPrimary'); if(b) b.focus({preventScroll:true}); }catch(e){} };
    if(typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(focusPrimary); else focusPrimary();
    return true;
  }
  function dismiss(reason){
    if(!state.open) return false;
    state.open = false;
    try{ if(typeof document !== 'undefined') document.body.classList.remove('mmTitleOpen'); }catch(e){}
    root.removeEventListener('keydown', onKeyDown, true);
    if(state.splashTimer != null){ root.clearInterval(state.splashTimer); state.splashTimer = null; }
    if(state.el){
      const el = state.el;
      el.classList.add('leaving');
      if(typeof root.setTimeout === 'function') root.setTimeout(()=>{ try{ el.remove(); }catch(e){} }, 450);
      else { try{ el.remove(); }catch(e){} }
      state.el = null; state.splashEl = null;
    }
    try{ if(state.lastFocus && state.lastFocus.isConnected && state.lastFocus.focus) state.lastFocus.focus({preventScroll:true}); }catch(e){}
    state.lastFocus = null;
    // the dismissing click/keypress is the first user gesture: the rising sting
    // is literally the first sound the simulation makes
    try{ if(MM.audio && MM.audio.play) MM.audio.play('titleStart'); }catch(e){}
    return true;
  }
  function isOpen(){ return state.open; }

  // main.js hands over what only it knows: whether an autosave exists and how
  // to start a fresh world (startNewGame owns the destructive reset dance).
  function boot(opts){
    const o = opts || {};
    state.hasSave = !!o.hasSave;
    state.onNewGame = (typeof o.onNewGame === 'function') ? o.onNewGame : null;
    const env = {
      ua: (root.navigator && root.navigator.userAgent) || '',
      webdriver: !!(root.navigator && root.navigator.webdriver),
      search: (root.location && root.location.search) || ''
    };
    if(shouldAutoSkip(env)){ state.bootResult = 'skipped'; return state.bootResult; }
    state.bootResult = show() ? 'shown' : 'skipped';
    return state.bootResult;
  }

  function metrics(){ return {open: state.open, boot: state.bootResult, splashes: SPLASHES.length}; }

  const api = { boot, show, dismiss, isOpen, shouldAutoSkip, pickSplash, metrics, SPLASHES,
    _debug: {state} };
  MM.titleScreen = api;
  return api;
})();

export { titleScreen };
export default titleScreen;
