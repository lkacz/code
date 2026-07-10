// Finale: the game's closing bookend. When the Guardian Macierzysty falls,
// the center guardian plays its spoken epilogue in-world; this module waits
// out those lines, then offers (and once, gently forces) the "layer closure
// report" — a full-screen ceremony with the run's numbers, the five guardians
// named for what they really were, and credits that stay in character.
//
// Persistence rides its own localStorage key (mm_finale_v1), like progress.js
// and discovery.js: it is player history, not world state. A new game clears
// it via the mm_-prefix sweep in new_game.js. The deaths counter lives here
// too, fed by the mm-hero-died event main.js dispatches from heroDied().
import { STORY_LORE } from './story_lore.js';

const finale = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const KEY = 'mm_finale_v1';

  // The center guardian's epilogue speech runs ~20 s after the killing blow
  // (finale + epilogueArrival lines at 2.6–2.8 s spacing) — the banner slips
  // in under it, the auto-open waits for the last word.
  const BANNER_DELAY = 8;
  const AUTO_OPEN_DELAY = 26;

  const GUARDIAN_ORDER = ['ice', 'fire', 'earth', 'air', 'mother'];
  const GUARDIAN_LORE = {
    ice:    {loreKey: 'west_ice',     icon: '❄️'},
    fire:   {loreKey: 'east_fire',    icon: '🔥'},
    earth:  {loreKey: 'earth_mole',   icon: '⛰️'},
    air:    {loreKey: 'sky_ambition', icon: '☁️'},
    mother: {loreKey: 'mother_self',  icon: '🪞'}
  };

  const state = {
    deaths: 0,
    unlocked: false,
    seen: false,
    open: false,
    bannerT: -1,     // countdown to the banner (s of sim time), -1 = off
    autoT: -1,       // countdown to the one-time auto-open
    el: null,
    bannerEl: null,
    onNewGame: null
  };

  function load(){
    try{
      if(typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(KEY);
      if(!raw) return;
      const d = JSON.parse(raw);
      if(d && typeof d === 'object'){
        state.deaths = Math.max(0, Math.floor(Number(d.deaths) || 0));
        state.unlocked = !!d.unlocked;
        state.seen = !!d.seen;
      }
    }catch(e){ /* private mode / headless: session-only */ }
  }
  function persist(){
    try{
      if(typeof localStorage === 'undefined') return;
      localStorage.setItem(KEY, JSON.stringify({v: 1, deaths: state.deaths, unlocked: state.unlocked, seen: state.seen}));
    }catch(e){ /* ignore */ }
  }
  load();

  // --- report model (Node-tested; every source is optional) ------------------
  // ctx overrides exist for tests; live callers pass nothing and the model
  // pulls from MM.progress / MM.discovery / MM.seasons / worldgen.
  function report(ctx){
    const c = ctx || {};
    const progress = c.progress || MM.progress || null;
    const discovery = c.discovery || MM.discovery || null;
    const seasons = c.seasons || MM.seasons || null;
    const hearts = (()=>{ try{ return (progress && progress.guardianHearts && progress.guardianHearts()) || {}; }catch(e){ return {}; } })();
    const lvl = (()=>{ try{ return (progress && progress.level && progress.level()) || {level: 1}; }catch(e){ return {level: 1}; } })();
    const snap = (()=>{ try{ return (progress && progress.snapshot && progress.snapshot()) || {}; }catch(e){ return {}; } })();
    const milestones = (()=>{ try{ return (progress && progress.milestones && progress.milestones()) || []; }catch(e){ return []; } })();
    const disc = (()=>{ try{ return (discovery && discovery.progress && discovery.progress()) || {count: 0, total: 0}; }catch(e){ return {count: 0, total: 0}; } })();
    const day = (()=>{ try{ return Math.max(1, Math.floor(Number(seasons && seasons.metrics && seasons.metrics().day) || 1)); }catch(e){ return 1; } })();
    const seed = (()=>{ try{ return Number(c.seed != null ? c.seed : (MM.worldGen && MM.worldGen.worldSeed)) || 0; }catch(e){ return 0; } })();
    const lore = STORY_LORE.metaphor && STORY_LORE.metaphor.guardians || {};
    const guardians = GUARDIAN_ORDER.map(key => {
      const meta = GUARDIAN_LORE[key];
      const g = lore[meta.loreKey] || {};
      return {key, icon: meta.icon, name: g.name || key, symbol: g.symbol || '', defeated: !!hearts[key]};
    });
    return {
      day,
      level: lvl.level,
      deaths: state.deaths,
      bossKills: Math.max(0, Math.floor(Number(snap.bossKills) || 0)),
      discoveries: {count: disc.count, total: disc.total},
      milestones: {done: milestones.filter(m => m.done).length, total: milestones.length},
      seed,
      guardians
    };
  }
  // Credits stay diegetic: the simulation thanks its own subsystems.
  function credits(rep){
    const r = rep || report();
    return [
      ['Hero-Prostokąt', 'w roli Obserwatora — Ty'],
      ['Stary Kwadrat', 'w roli Guardiana Macierzystego (rola życia)'],
      ['Trzeci Kret', 'grał siebie, przez sen'],
      ['Scenografia', 'worldgen, seed #' + r.seed],
      ['Woda', '10 poziomów w każdym kaflu, bez dublera'],
      ['Pogoda', 'chmury pracowały też, gdy nie patrzyłeś. Podobno.'],
      ['Kaskaderzy', 'drzewa — wszystkie upadki własne'],
      ['Zmiany współrzędnych', String(r.deaths) + '× (nikt nie zginął naprawdę)'],
      ['Podziękowania', 'dla każdego kafla, który udawał ciągłość'],
      ['', 'Dziękujemy, że patrzyłeś.']
    ];
  }

  // --- DOM -------------------------------------------------------------------
  function node(tag, cls, text){
    const n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }
  function hideBanner(){
    if(state.bannerEl){ try{ state.bannerEl.remove(); }catch(e){} state.bannerEl = null; }
  }
  function showBanner(){
    if(state.bannerEl || state.open || typeof document === 'undefined') return;
    const b = node('button', '', '🎬 Raport zamknięcia warstwy jest gotowy — obejrzyj');
    b.id = 'finaleBanner'; b.type = 'button';
    b.addEventListener('click', ()=>open());
    (document.getElementById('ui') || document.body).appendChild(b);
    state.bannerEl = b;
  }
  function syncMenuButton(){
    if(typeof document === 'undefined') return;
    const btn = document.getElementById('openFinale');
    if(!btn) return;
    btn.hidden = !state.unlocked;
    if(!btn.dataset.finaleWired){
      btn.dataset.finaleWired = '1';
      btn.addEventListener('click', ()=>open());
    }
  }

  function statRow(grid, label, value){
    const cell = node('div', 'fnStat');
    cell.appendChild(node('div', 'fnStatVal', String(value)));
    cell.appendChild(node('div', 'fnStatLabel', label));
    grid.appendChild(cell);
  }
  function build(){
    if(typeof document === 'undefined') return null;
    const r = report();
    const el = node('div'); el.id = 'finaleScreen';
    const card = node('div', 'fnCard');
    card.appendChild(node('div', 'fnKicker', 'symulacja zakończona bez błędów · warstwa oddaje ster'));
    card.appendChild(node('h1', 'fnTitle', 'KONIEC WARSTWY'));
    card.appendChild(node('div', 'fnSub', 'Raport zamknięcia — Warstwy Symulacji'));

    const gList = node('div', 'fnGuardians');
    for(const g of r.guardians){
      const row = node('div', 'fnGuardian' + (g.defeated ? ' done' : ''));
      row.appendChild(node('span', 'fnGIcon', g.icon));
      const txt = node('div', 'fnGText');
      txt.appendChild(node('div', 'fnGName', g.name));
      txt.appendChild(node('div', 'fnGSymbol', g.symbol));
      row.appendChild(txt);
      row.appendChild(node('span', 'fnGMark', g.defeated ? '✓' : '·'));
      gList.appendChild(row);
    }
    card.appendChild(gList);

    const grid = node('div', 'fnStats');
    statRow(grid, 'dzień symulacji', r.day);
    statRow(grid, 'poziom bohatera', r.level);
    statRow(grid, 'odkrycia', r.discoveries.count + '/' + r.discoveries.total);
    statRow(grid, 'kamienie milowe', r.milestones.done + '/' + r.milestones.total);
    statRow(grid, 'pokonani bossowie', r.bossKills);
    statRow(grid, 'zmiany współrzędnych', r.deaths);
    card.appendChild(grid);

    const credWrap = node('div', 'fnCredits');
    for(const [role, name] of credits(r)){
      const line = node('div', 'fnCredit');
      if(role) line.appendChild(node('span', 'fnCreditRole', role));
      line.appendChild(node('span', 'fnCreditName', name));
      credWrap.appendChild(line);
    }
    card.appendChild(credWrap);

    const btns = node('div', 'fnButtons');
    const play = node('button', 'fnPrimary', '▶ Graj dalej — świat został twój');
    play.type = 'button';
    play.addEventListener('click', ()=>close());
    btns.appendChild(play);
    const fresh = node('button', 'fnSecondary', '🌱 Nowa warstwa (nowy świat)');
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
    card.appendChild(btns);
    card.appendChild(node('div', 'fnHint', 'Esc zamyka · raport wraca spod ☰ Menu → Zakończenie'));

    el.appendChild(card);
    (document.getElementById('ui') || document.body).appendChild(el);
    return el;
  }

  function onKeyDown(e){
    if(!state.open) return;
    if(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(!e.repeat && (e.key === 'Escape' || e.key === 'Enter')) close();
  }

  function open(){
    if(state.open) return false;
    state.open = true;
    state.autoT = -1;
    hideBanner();
    if(!state.seen){ state.seen = true; persist(); }
    if(typeof document !== 'undefined'){
      state.el = build();
      if(state.el) state.el.classList.add('show');
      try{ document.body.classList.add('mmFinaleOpen'); }catch(e){} // hides the HUD under the ceremony
      root.addEventListener('keydown', onKeyDown, true);
    }
    try{ if(MM.audio && MM.audio.play) MM.audio.play('finaleFanfare'); }catch(e){}
    return true;
  }
  function close(){
    if(!state.open) return false;
    state.open = false;
    try{ if(typeof document !== 'undefined') document.body.classList.remove('mmFinaleOpen'); }catch(e){}
    root.removeEventListener('keydown', onKeyDown, true);
    if(state.el){
      const el = state.el;
      el.classList.add('leaving');
      if(typeof root.setTimeout === 'function') root.setTimeout(()=>{ try{ el.remove(); }catch(e){} }, 450);
      else { try{ el.remove(); }catch(e){} }
      state.el = null;
    }
    try{ if(MM.audio && MM.audio.play) MM.audio.play('uiClose'); }catch(e){}
    return true;
  }
  function isOpen(){ return state.open; }
  function unlocked(){ return state.unlocked; }

  function unlock(){
    if(!state.unlocked){ state.unlocked = true; persist(); }
    syncMenuButton();
    if(!state.seen){
      state.bannerT = BANNER_DELAY;
      state.autoT = AUTO_OPEN_DELAY;
    }
  }

  // Timers ride sim time (main.js calls update from runGameStep), so a pause
  // holds the ceremony too. A reload inside the window falls back to the
  // boot-time banner below — the auto-open never ambushes a fresh session.
  function update(dt){
    if(!(dt > 0) || !Number.isFinite(dt)) return;
    if(state.bannerT >= 0){
      state.bannerT -= dt;
      if(state.bannerT < 0) showBanner();
    }
    if(state.autoT >= 0 && !state.open){
      state.autoT -= dt;
      if(state.autoT < 0) open();
    }
  }

  function wire(opts){
    if(opts && typeof opts.onNewGame === 'function') state.onNewGame = opts.onNewGame;
    syncMenuButton();
    if(state.unlocked && !state.seen && !state.open) showBanner();
  }

  function reset(){
    state.deaths = 0; state.unlocked = false; state.seen = false;
    state.bannerT = -1; state.autoT = -1;
    hideBanner();
    if(state.open) close();
    persist();
    syncMenuButton();
  }
  function metrics(){
    return {deaths: state.deaths, unlocked: state.unlocked, seen: state.seen, open: state.open};
  }

  if(typeof root.addEventListener === 'function'){
    root.addEventListener('mm-hero-died', ()=>{ state.deaths++; persist(); });
    root.addEventListener('mm-guardian-defeated', (e)=>{
      const kind = e && e.detail && e.detail.kind;
      if(kind === 'mother') unlock();
    });
  }

  const api = { report, credits, open, close, isOpen, unlocked, unlock, update, wire, reset, metrics,
    config: {BANNER_DELAY, AUTO_OPEN_DELAY},
    _debug: {state} };
  MM.finale = api;
  return api;
})();

export { finale };
export default finale;
