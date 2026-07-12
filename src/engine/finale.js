// Finale: the game's closing bookend. When the Guardian Macierzysty falls,
// the center guardian plays its spoken epilogue in-world; this module waits
// out those lines, then offers (and once, gently forces) the "layer closure
// report" — a staged, full-screen ceremony: the world visibly de-rezzes into
// its own tiles, the report reveals act by act (guardians, counted-up stats,
// a personalized layer verdict, in-character credits), an intercepted
// transmission from the layer above looks back at the observer, and on exit
// the world reassembles tile by tile.
//
// Two ceremony modes, mirroring the title screen's automation contract:
//  - staged  — the real cinematic; any key or click fast-forwards to the end,
//              then Esc/Enter closes. Rides REAL time (rAF): the sim loop is
//              frozen under uiOverlayHold, so sim-dt never arrives while open.
//  - instant — everything final on open. Automation (headless UA/webdriver),
//              prefers-reduced-motion, and Node imports get this, so the QA
//              drivers keep their "open → count nodes → Esc closes" contract.
//              `?ceremony=1` forces staged even under automation (its own QA
//              scene uses this), `?ceremony=0` forces instant for humans.
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
  // Closed-layer tally: player knowledge, so it SURVIVES a new game (kept by
  // NEW_GAME_KNOWLEDGE_KEYS in new_game.js) — each finished world adds one.
  const LAYERS_KEY = 'mm_layers_v1';

  // The center guardian's epilogue speech runs ~20 s after the killing blow
  // (finale + epilogueArrival lines at 2.6–2.8 s spacing) — the banner slips
  // in under it, the auto-open waits for the last word.
  const BANNER_DELAY = 8;
  const AUTO_OPEN_DELAY = 26;

  // Staged-ceremony act schedule, in seconds of REAL time since open().
  const CEREMONY = {
    card: 1.30, kicker: 1.5, title: 2.35, sub: 2.95,
    guardians: 3.3, guardianStep: 0.34,
    stats: 5.35, statStep: 0.16, statCount: 0.85,
    verdict: 7.1, credits: 7.9, creditStep: 0.12,
    glitch: 9.7, meta: 10.25, buttons: 12.6
  };

  const GUARDIAN_ORDER = ['ice', 'fire', 'earth', 'air', 'mother'];
  const GUARDIAN_LORE = {
    ice:    {loreKey: 'west_ice',     icon: '❄️', hue: '#7fd4ff'},
    fire:   {loreKey: 'east_fire',    icon: '🔥', hue: '#ff9a5c'},
    earth:  {loreKey: 'earth_mole',   icon: '⛰️', hue: '#c9a06a'},
    air:    {loreKey: 'sky_ambition', icon: '☁️', hue: '#cfe8ff'},
    mother: {loreKey: 'mother_self',  icon: '🪞', hue: '#b9a6ff'}
  };

  const KICKER_TEXT = 'symulacja zakończona bez błędów · warstwa oddaje ster';
  const META_HEAD = '── przechwycona transmisja · warstwa nadrzędna ──';
  const META_LINE1 = 'raport odebrany. obserwator rozpoznany po stylu kopania.';
  const META_LINE2 = 'utrzymujemy tę warstwę otwartą. patrz, ile zechcesz.';

  const state = {
    deaths: 0,
    unlocked: false,
    seen: false,
    open: false,
    bannerT: -1,     // countdown to the banner (s of sim time), -1 = off
    autoT: -1,       // countdown to the one-time auto-open
    el: null,
    bannerEl: null,
    onNewGame: null,
    // ceremony runtime (DOM sessions only; Node stays on the flags above)
    mode: 'instant', // 'instant' | 'staged'
    done: true,      // staged play reached (or skipped to) the final act
    clock: 0,        // real seconds since open, visibility-clamped
    raf: 0,
    lastNow: 0,
    dom: null,
    fx: null,
    acts: [],
    typers: [],
    counters: [],
    metaLiveOn: false,
    metaAcc: 0,
    pointer: {x: 0, y: 0, moved: false}
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

  function completions(){
    try{
      if(typeof localStorage === 'undefined') return 0;
      const d = JSON.parse(localStorage.getItem(LAYERS_KEY));
      return Math.max(0, Math.floor(Number(d && d.completions) || 0));
    }catch(e){ return 0; }
  }
  function addCompletion(v){
    try{
      if(typeof localStorage === 'undefined') return;
      const data = {v: 1, completions: completions() + 1};
      // the layer's verdict crosses worlds with the tally: the next title
      // screen greets the veteran by their last earned epithet
      if(v && v.key) data.lastVerdict = {key: String(v.key), title: String(v.title || '')};
      localStorage.setItem(LAYERS_KEY, JSON.stringify(data));
    }catch(e){ /* ignore */ }
  }
  // Cross-world veterancy for the title screen and the credits roll.
  function layers(){
    const out = {completions: completions()};
    try{
      if(typeof localStorage !== 'undefined'){
        const d = JSON.parse(localStorage.getItem(LAYERS_KEY));
        if(d && d.lastVerdict && d.lastVerdict.key){
          out.lastVerdict = {key: String(d.lastVerdict.key), title: String(d.lastVerdict.title || '')};
        }
      }
    }catch(e){ /* ignore */ }
    return out;
  }

  function play(name, opts){
    try{ if(MM.audio && MM.audio.play) MM.audio.play(name, opts); }catch(e){ /* ignore */ }
  }

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
      return {key, icon: meta.icon, hue: meta.hue, name: g.name || key, symbol: g.symbol || '', defeated: !!hearts[key]};
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
  // The layer's verdict: one in-character epithet computed from how THIS run
  // actually went. Priority order is part of the contract (Node-tested):
  // a deathless run outranks everything, sheer stubbornness comes next, then
  // curiosity, completionism, speed, depth — and a warm default underneath.
  function verdict(rep){
    const r = rep || report();
    const d = r.discoveries || {count: 0, total: 0};
    const m = r.milestones || {done: 0, total: 0};
    const discRatio = d.total > 0 ? d.count / d.total : 0;
    if(r.deaths === 0) return {key: 'untouched', title: 'Warstwa Nietknięta',
      note: 'zero zmian współrzędnych — symulacja do końca nie wiedziała, jak cię zranić'};
    if(r.deaths >= 12) return {key: 'phoenix', title: 'Feniks Współrzędnych',
      note: r.deaths + ' powrotów, jedno domknięcie. Upór został policzony i doceniony'};
    if(discRatio >= 0.8) return {key: 'cartographer', title: 'Kartograf Reakcji',
      note: 'odkrycia ' + d.count + '/' + d.total + ' — tej warstwie prawie nic nie umknęło'};
    if(m.total > 0 && m.done >= m.total) return {key: 'protocol', title: 'Protokół Kompletny',
      note: 'wszystkie kamienie milowe odhaczone. Archiwum nie zgłasza uwag'};
    if(r.day <= 12) return {key: 'sprint', title: 'Sprint przez Warstwę',
      note: 'domknięta w ' + r.day + ' dni — symulacja nie zdążyła nawet zmienić pogody'};
    if(r.level >= 15) return {key: 'veteran', title: 'Weteran Głębi',
      note: 'poziom ' + r.level + ' — ta warstwa znała twoje kroki na pamięć'};
    return {key: 'observer', title: 'Obserwator Uważny',
      note: 'warstwa domknięta zgodnie z protokołem. Bez pośpiechu, bez litości'};
  }
  // Credits stay diegetic: the simulation thanks its own subsystems.
  function credits(rep){
    const r = rep || report();
    const closed = completions();
    return [
      ['Zamknięte warstwy', closed > 1 ? closed + ' (licząc tę — wprawa widoczna)' : (closed === 1 ? '1 (ta pierwsza boli najbardziej)' : 'wciąż otwarta')],
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

  // --- ceremony mode ----------------------------------------------------------
  // Same shape as titleScreen.shouldAutoSkip: overrides first, then automation
  // and reduced-motion pick the instant ceremony. Pure, Node-tested.
  function shouldInstant(env){
    const e = env || {};
    const search = String(e.search || '');
    if(/[?&]ceremony=1\b/.test(search)) return false;
    if(/[?&]ceremony=0\b/.test(search)) return true;
    if(e.reducedMotion === true) return true;
    if(e.webdriver === true) return true;
    if(/headless/i.test(String(e.ua || ''))) return true;
    return false;
  }
  function ceremonyEnv(){
    return {
      ua: (root.navigator && root.navigator.userAgent) || '',
      webdriver: !!(root.navigator && root.navigator.webdriver),
      search: (root.location && root.location.search) || '',
      reducedMotion: (()=>{ try{ return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){ return false; } })()
    };
  }

  // --- fx canvas: de-rez / motes / re-rez --------------------------------------
  // One <canvas> under the card. Staged open snapshots the (frozen) world and
  // tears it apart tile by tile, center out; afterwards a quiet field of
  // guardian-hued motes drifts up (and shies away from the cursor). A staged
  // close plays the tear in reverse while the overlay fades — the snapshot is
  // still valid because the sim held still the whole time.
  function createFx(host, staged){
    if(typeof document === 'undefined') return null;
    let cv, ctx;
    try{
      cv = document.createElement('canvas');
      cv.className = 'fnFx';
      cv.style.width = '100%';
      cv.style.height = '100%';
      host.appendChild(cv);
      ctx = cv.getContext('2d');
    }catch(e){ return null; }
    if(!ctx) return null;
    const dpr = Math.min(Number(root.devicePixelRatio) || 1, 1.75);
    const W = Math.max(320, root.innerWidth || 1280);
    const H = Math.max(240, root.innerHeight || 720);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const CELL = Math.max(34, Math.round(Math.min(W, H) / 20));
    const RISE = 0.95;           // per-cell flight time
    const WAVE = 1.05;           // center-out delay spread
    const cells = [];
    // Snapshot is DEFERRED to the fx loop's second frame: at open() the game
    // canvas still holds the last pre-ceremony frame WITH the canvas HUD
    // (minimap, vitals) — one draw() under ceremonyHold later it is clean
    // world only, which is what the shatter, re-rez and souvenir all want.
    let snap = null, captured = false;
    function ensureSnap(){
      if(captured) return;
      captured = true;
      try{
        const game = document.getElementById('game');
        if(game && game.width > 0 && game.height > 0){
          snap = document.createElement('canvas');
          snap.width = cv.width; snap.height = cv.height;
          snap.getContext('2d').drawImage(game, 0, 0, snap.width, snap.height);
        }
      }catch(e){ snap = null; } // no snapshot: ceremony still runs, just a darker intro
      if(staged && snap){
        const cx = W / 2, cy = H / 2, maxR = Math.hypot(cx, cy) || 1;
        for(let y = 0; y < H; y += CELL){
          for(let x = 0; x < W; x += CELL){
            const dx = x + CELL / 2 - cx, dy = y + CELL / 2 - cy;
            const r = Math.hypot(dx, dy);
            cells.push({
              x, y,
              delay: (r / maxR) * WAVE + Math.random() * 0.22,
              vx: (dx / (r || 1)) * (50 + Math.random() * 90),
              vy: (dy / (r || 1)) * (50 + Math.random() * 90) - 70,
              rot: (Math.random() - 0.5) * 2.6
            });
          }
        }
      }
    }

    const HUES = ['#7fd4ff', '#ff9a5c', '#c9a06a', '#cfe8ff', '#b9a6ff', '#ffd76a'];
    const motes = [];
    for(let i = 0; i < 90; i++){
      motes.push({
        x: Math.random() * W, y: Math.random() * H,
        s: 1.5 + Math.random() * 3,
        v: 5 + Math.random() * 13,
        drift: (Math.random() - 0.5) * 8,
        hue: HUES[i % HUES.length],
        ph: Math.random() * Math.PI * 2
      });
    }

    let phase = 'pre'; // transparent until the deferred capture two frames in
    let preFrames = 0;
    let t = 0;
    let mx = -9999, my = -9999;

    function drawCell(c, p, alpha){
      if(p <= 0){
        ctx.globalAlpha = alpha;
        ctx.drawImage(snap, c.x * dpr, c.y * dpr, CELL * dpr, CELL * dpr, c.x, c.y, CELL, CELL);
        return;
      }
      if(p >= 1) return;
      const e = p * p;
      const s = 1 - 0.4 * p;
      ctx.save();
      ctx.globalAlpha = alpha * (1 - p);
      ctx.translate(c.x + CELL / 2 + c.vx * e, c.y + CELL / 2 + c.vy * e);
      ctx.rotate(c.rot * e);
      ctx.drawImage(snap, c.x * dpr, c.y * dpr, CELL * dpr, CELL * dpr, -CELL * s / 2, -CELL * s / 2, CELL * s, CELL * s);
      ctx.restore();
    }
    function drawBackdrop(){
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(155,140,255,0.07)');
      g.addColorStop(1, 'rgba(155,140,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    function drawShatter(){
      drawBackdrop();
      let flying = false;
      for(const c of cells){
        const p = Math.max(0, Math.min(1, (t - c.delay) / RISE));
        if(p < 1) flying = true;
        drawCell(c, p, 1);
      }
      ctx.globalAlpha = 1;
      if(!flying || t > WAVE + 0.22 + RISE + 0.1){ phase = 'ambient'; t = 0; }
    }
    function drawAmbient(dt){
      drawBackdrop();
      for(const m of motes){
        m.y -= m.v * dt;
        m.x += m.drift * dt;
        m.ph += dt * 1.7;
        if(m.y < -6){ m.y = H + 6; m.x = Math.random() * W; }
        if(m.x < -6) m.x = W + 6; else if(m.x > W + 6) m.x = -6;
        let ox = 0, oy = 0;
        const dx = m.x - mx, dy = m.y - my;
        const d = Math.hypot(dx, dy);
        if(d < 90 && d > 0.01){ const push = (90 - d) * 0.45; ox = (dx / d) * push; oy = (dy / d) * push; }
        ctx.globalAlpha = 0.28 + 0.22 * Math.sin(m.ph);
        ctx.fillStyle = m.hue;
        ctx.fillRect(m.x + ox - m.s / 2, m.y + oy - m.s / 2, m.s, m.s);
      }
      ctx.globalAlpha = 1;
    }
    function drawRerez(){
      drawBackdrop();
      for(const c of cells){
        const start = (c.delay / (WAVE + 0.22)) * 0.5;
        const q = Math.max(0, Math.min(1, (t - start) / 0.5));
        drawCell(c, 1 - q, 1);
      }
      ctx.globalAlpha = 1;
    }

    return {
      snapshot(){ ensureSnap(); return snap; },
      setPointer(x, y){ mx = x; my = y; },
      skipShatter(){ if(phase === 'shatter' || phase === 'pre'){ ensureSnap(); phase = 'ambient'; t = 0; } },
      startRerez(){
        ensureSnap();
        if(!snap || !cells.length) return false;
        phase = 'rerez'; t = 0;
        return true;
      },
      frame(dt){
        if(phase === 'pre'){
          // the overlay is still fading in over the live world: stay clear
          preFrames++;
          if(preFrames >= 2){
            ensureSnap();
            phase = (staged && snap) ? 'shatter' : 'ambient';
            t = 0;
          }
          return;
        }
        t += dt;
        try{
          if(phase === 'shatter') drawShatter();
          else if(phase === 'rerez') drawRerez();
          else drawAmbient(dt);
        }catch(e){ /* canvas died mid-ceremony: skip frames, DOM acts continue */ }
      }
    };
  }

  // --- souvenir card ----------------------------------------------------------
  // A downloadable 1200×630 keepsake: the frozen world as backdrop, the title,
  // the earned verdict, the five guardians and the run's numbers. Returns a
  // PNG data URL, or null where there is no canvas (Node) or it fails.
  function souvenir(){
    if(typeof document === 'undefined') return null;
    try{
      const r = report();
      const v = verdict(r);
      const W = 1200, H = 630;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      if(!ctx) return null;
      ctx.fillStyle = '#0a0e1a'; ctx.fillRect(0, 0, W, H);
      const snap = state.fx && state.fx.snapshot && state.fx.snapshot();
      if(snap && snap.width > 0){
        const s = Math.max(W / snap.width, H / snap.height);
        const dw = snap.width * s, dh = snap.height * s;
        ctx.drawImage(snap, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(6,8,16,.74)');
      g.addColorStop(0.5, 'rgba(6,8,16,.84)');
      g.addColorStop(1, 'rgba(6,8,16,.94)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7e93ad'; ctx.font = '600 17px system-ui,"Segoe UI",sans-serif';
      ctx.fillText('W A R S T W Y   S Y M U L A C J I   ·   R A P O R T   Z A M K N I Ę C I A', W / 2, 92);
      ctx.fillStyle = '#f2f7ff'; ctx.font = '900 84px system-ui,"Segoe UI",sans-serif';
      ctx.shadowColor = 'rgba(155,140,255,.55)'; ctx.shadowBlur = 28;
      ctx.fillText('KONIEC WARSTWY', W / 2, 185);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd76a'; ctx.font = '800 44px system-ui,"Segoe UI",sans-serif';
      ctx.fillText(v.title, W / 2, 268);
      ctx.fillStyle = '#cbb98d'; ctx.font = 'italic 21px system-ui,"Segoe UI",sans-serif';
      ctx.fillText(v.note, W / 2, 305);
      const gy = 392, spread = 96, gx0 = W / 2 - spread * 2;
      for(let i = 0; i < r.guardians.length; i++){
        const gu = r.guardians[i];
        ctx.globalAlpha = gu.defeated ? 1 : 0.35;
        ctx.font = '40px "Segoe UI Emoji",system-ui,sans-serif';
        ctx.fillText(gu.icon, gx0 + i * spread, gy);
        if(gu.defeated){
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#8be28b'; ctx.font = '700 22px system-ui,sans-serif';
          ctx.fillText('✓', gx0 + i * spread + 30, gy + 8);
        }
      }
      ctx.globalAlpha = 1;
      const stats = [
        [String(r.day), 'dzień symulacji'], [String(r.level), 'poziom'],
        [r.discoveries.count + '/' + r.discoveries.total, 'odkrycia'],
        [r.milestones.done + '/' + r.milestones.total, 'kamienie milowe'],
        [String(r.bossKills), 'bossowie'], [String(r.deaths), 'zmiany współrzędnych']
      ];
      const cw = W / stats.length;
      for(let i = 0; i < stats.length; i++){
        const cx = cw * i + cw / 2;
        ctx.fillStyle = '#ffd76a'; ctx.font = '800 34px system-ui,"Segoe UI",sans-serif';
        ctx.fillText(stats[i][0], cx, 488);
        ctx.fillStyle = '#8ea1b8'; ctx.font = '600 15px system-ui,"Segoe UI",sans-serif';
        ctx.fillText(stats[i][1], cx, 516);
      }
      ctx.fillStyle = '#5f7189'; ctx.font = '600 16px system-ui,"Segoe UI",sans-serif';
      ctx.fillText('Mini Miner · seed #' + r.seed + ' · ' + new Date().toISOString().slice(0, 10), W / 2, 585);
      return cv.toDataURL('image/png');
    }catch(e){ return null; }
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

  function statRow(grid, label, target, suffix, staged){
    const cell = node('div', 'fnStat');
    const val = node('div', 'fnStatVal', staged ? '0' + suffix : String(target) + suffix);
    cell.appendChild(val);
    cell.appendChild(node('div', 'fnStatLabel', label));
    grid.appendChild(cell);
    if(staged) state.counters.push({el: val, target, suffix, t: 0, delay: 0, dur: CEREMONY.statCount, fired: false, silent: false});
  }
  function isTouchUi(){
    try{ return !!(document.body && document.body.dataset && document.body.dataset.inputMode === 'touch'); }
    catch(e){ return false; }
  }
  function liveMetaLine(){
    const p = state.pointer;
    const secs = Math.max(0, Math.floor(state.clock));
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const cur = p.moved ? (Math.round(p.x) + '×' + Math.round(p.y))
      : (isTouchUi() ? 'dotyk wyczuwalny przez szybę' : 'bez ruchu (to też widzimy)');
    return 'obserwator: aktywny · kursor: ' + cur + ' · czas po twojej stronie: ' + mm + ':' + ss;
  }
  function build(){
    if(typeof document === 'undefined') return null;
    const staged = state.mode === 'staged';
    const r = report();
    const v = verdict(r);
    const el = node('div'); el.id = 'finaleScreen';
    if(staged) el.classList.add('staged');
    const dom = state.dom = {gRows: [], gMarks: [], credRows: []};
    state.fx = createFx(el, staged);

    const card = dom.card = node('div', 'fnCard');
    dom.kicker = node('div', 'fnKicker', staged ? '' : KICKER_TEXT);
    card.appendChild(dom.kicker);
    dom.title = node('h1', 'fnTitle', 'KONIEC WARSTWY');
    card.appendChild(dom.title);
    dom.sub = node('div', 'fnSub fnAct', 'Raport zamknięcia — Warstwy Symulacji');
    card.appendChild(dom.sub);

    const gList = node('div', 'fnGuardians');
    for(const g of r.guardians){
      const row = node('div', 'fnGuardian' + (g.defeated ? ' done' : ''));
      try{ row.style.setProperty('--g', g.hue); }catch(e){}
      row.appendChild(node('span', 'fnGIcon', g.icon));
      const txt = node('div', 'fnGText');
      txt.appendChild(node('div', 'fnGName', g.name));
      txt.appendChild(node('div', 'fnGSymbol', g.symbol));
      row.appendChild(txt);
      const mark = node('span', 'fnGMark', g.defeated ? '✓' : '·');
      row.appendChild(mark);
      gList.appendChild(row);
      dom.gRows.push(row);
      dom.gMarks.push(mark);
    }
    card.appendChild(gList);

    const grid = dom.stats = node('div', 'fnStats fnAct');
    statRow(grid, 'dzień symulacji', r.day, '', staged);
    statRow(grid, 'poziom bohatera', r.level, '', staged);
    statRow(grid, 'odkrycia', r.discoveries.count, '/' + r.discoveries.total, staged);
    statRow(grid, 'kamienie milowe', r.milestones.done, '/' + r.milestones.total, staged);
    statRow(grid, 'pokonani bossowie', r.bossKills, '', staged);
    statRow(grid, 'zmiany współrzędnych', r.deaths, '', staged);
    card.appendChild(grid);

    const seal = dom.verdict = node('div', 'fnVerdict fnAct');
    seal.appendChild(node('div', 'fnVerdictKicker', 'werdykt warstwy'));
    seal.appendChild(node('div', 'fnVerdictTitle', v.title));
    seal.appendChild(node('div', 'fnVerdictNote', v.note));
    card.appendChild(seal);

    const credWrap = node('div', 'fnCredits');
    for(const [role, name] of credits(r)){
      const line = node('div', 'fnCredit fnAct');
      if(role) line.appendChild(node('span', 'fnCreditRole', role));
      line.appendChild(node('span', 'fnCreditName', name));
      credWrap.appendChild(line);
      dom.credRows.push(line);
    }
    card.appendChild(credWrap);

    const meta = dom.meta = node('div', 'fnMeta fnAct');
    meta.appendChild(node('div', 'fnMetaHead', META_HEAD));
    dom.metaLine1 = node('div', 'fnMetaLine', staged ? '' : META_LINE1);
    meta.appendChild(dom.metaLine1);
    dom.metaLive = node('div', 'fnMetaLine fnMetaLive', staged ? '' : liveMetaLine());
    meta.appendChild(dom.metaLive);
    dom.metaLine2 = node('div', 'fnMetaLine', staged ? '' : META_LINE2);
    meta.appendChild(dom.metaLine2);
    card.appendChild(meta);

    const btns = dom.buttons = node('div', 'fnButtons fnAct');
    const playBtn = node('button', 'fnPrimary', '▶ Graj dalej — świat został twój');
    playBtn.type = 'button';
    playBtn.addEventListener('click', ()=>close());
    btns.appendChild(playBtn);
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
    const keep = node('button', 'fnSecondary', '📸 Pamiątka warstwy');
    keep.type = 'button';
    keep.addEventListener('click', ()=>{
      const url = souvenir();
      if(!url){ keep.disabled = true; keep.textContent = 'pamiątka niedostępna'; return; }
      try{
        const a = document.createElement('a');
        a.href = url;
        a.download = 'koniec-warstwy-' + (report().seed || 0) + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        play('uiClick');
      }catch(e){}
    });
    btns.appendChild(keep);
    card.appendChild(btns);
    dom.hint = node('div', 'fnHint fnAct', staged
      ? (isTouchUi()
        ? 'dotknięcie przyspiesza ceremonię · raport wraca spod ☰ Menu → Zakończenie'
        : 'klik / dowolny klawisz przyspiesza ceremonię · Esc zamyka · raport wraca spod ☰ Menu → Zakończenie')
      : 'Esc zamyka · raport wraca spod ☰ Menu → Zakończenie');
    card.appendChild(dom.hint);

    el.appendChild(card);
    el.addEventListener('pointermove', (e)=>{
      state.pointer.x = e.clientX; state.pointer.y = e.clientY; state.pointer.moved = true;
      if(state.fx) state.fx.setPointer(e.clientX, e.clientY);
    });
    el.addEventListener('pointerdown', ()=>{
      if(state.mode === 'staged' && !state.done) finishCeremony(false);
    });
    (document.getElementById('ui') || document.body).appendChild(el);
    return el;
  }

  // --- staged timeline ---------------------------------------------------------
  function reveal(el, scroll){
    if(!el) return;
    el.classList.add('on');
    if(scroll !== false){
      try{ el.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }catch(e){}
    }
  }
  function startTyper(el, text, instant, wait){
    if(!el) return;
    if(instant){ el.textContent = text; return; }
    state.typers.push({el, text, i: 0, cps: 34, wait: Math.max(0, wait || 0)});
  }
  function scheduleActs(){
    const d = state.dom;
    if(!d) return;
    const T = CEREMONY;
    const acts = state.acts = [];
    const add = (at, run)=>acts.push({at, run, fired: false});
    add(0.05, (inst)=>{ if(!inst && state.fx) play('finaleShatter'); });
    add(T.card, ()=>reveal(d.card, false));
    add(T.kicker, (inst)=>startTyper(d.kicker, KICKER_TEXT, inst));
    add(T.title, (inst)=>{ reveal(d.title, false); if(!inst) play('finaleFanfare'); });
    add(T.sub, ()=>reveal(d.sub, false));
    d.gRows.forEach((row, i)=>{
      add(T.guardians + i * T.guardianStep, (inst)=>{
        reveal(row);
        if(!inst){
          play('finaleGuardian', {step: i});
          if(row.classList.contains('done') && d.gMarks[i]) d.gMarks[i].classList.add('pop');
        }
      });
    });
    add(T.stats, (inst)=>{
      reveal(d.stats);
      state.counters.forEach((c, i)=>{ c.delay = i * T.statStep; c.silent = !!inst; if(inst){ c.t = c.dur + c.delay; } });
      if(inst) tickCounters(0);
    });
    add(T.verdict, (inst)=>{ reveal(d.verdict); if(!inst) play('finaleSeal'); });
    d.credRows.forEach((row, i)=>add(T.credits + i * T.creditStep, ()=>reveal(row, i === 0)));
    add(T.glitch, (inst)=>{
      if(inst) return;
      d.card.classList.add('glitching');
      play('finaleGlitch');
      if(typeof root.setTimeout === 'function') root.setTimeout(()=>{ try{ d.card.classList.remove('glitching'); }catch(e){} }, 1400);
    });
    add(T.meta, (inst)=>{
      reveal(d.meta);
      startTyper(d.metaLine1, META_LINE1, inst);
      startTyper(d.metaLine2, META_LINE2, inst, 2.2);
      state.metaLiveOn = true;
    });
    add(T.buttons, ()=>{ reveal(d.buttons); reveal(d.hint, false); state.done = true; });
  }
  function fireDueActs(){
    for(const a of state.acts){
      if(!a.fired && state.clock >= a.at){ a.fired = true; try{ a.run(false); }catch(e){} }
    }
  }
  function tickTypers(dt){
    for(const t of state.typers){
      if(t.wait > 0){ t.wait -= dt; continue; }
      if(t.i >= t.text.length) continue;
      t.i = Math.min(t.text.length, t.i + t.cps * dt);
      t.el.textContent = t.text.slice(0, Math.floor(t.i));
    }
  }
  function easeOutCubic(x){ return 1 - Math.pow(1 - x, 3); }
  function tickCounters(dt){
    for(const c of state.counters){
      if(c.fired && c.t >= c.dur + c.delay) continue;
      c.t += dt;
      const p = Math.max(0, Math.min(1, (c.t - c.delay) / c.dur));
      if(p <= 0) continue;
      c.el.textContent = String(Math.round(easeOutCubic(p) * c.target)) + c.suffix;
      if(p >= 1 && !c.fired){
        c.fired = true;
        if(!c.silent){
          play('uiClick');
          try{ c.el.parentNode && c.el.parentNode.classList.add('landed'); }catch(e){}
        }
      }
    }
  }
  function updateLiveMeta(dt){
    if(!state.metaLiveOn || !state.dom || !state.dom.metaLive) return;
    state.metaAcc += dt;
    if(state.metaAcc < 0.15) return;
    state.metaAcc = 0;
    try{ state.dom.metaLive.textContent = liveMetaLine(); }catch(e){}
  }
  // Fast-forward: every pending act fires in instant flavor, typers and
  // counters jump to their final text. The live transmission line keeps
  // ticking — that is the one part meant to stay alive.
  function finishCeremony(silent){
    if(state.mode !== 'staged' || state.done){ return; }
    for(const a of state.acts){
      if(!a.fired){ a.fired = true; try{ a.run(true); }catch(e){} }
    }
    for(const t of state.typers){ t.i = t.text.length; t.wait = 0; try{ t.el.textContent = t.text; }catch(e){} }
    for(const c of state.counters){ c.t = c.dur + c.delay; c.fired = true; try{ c.el.textContent = String(c.target) + c.suffix; }catch(e){} }
    if(state.fx) state.fx.skipShatter();
    if(state.dom && state.dom.card){ try{ state.dom.card.classList.remove('glitching'); }catch(e){} }
    state.done = true;
    if(!silent) play('uiClick');
  }

  function startLoop(){
    if(typeof root.requestAnimationFrame !== 'function') return;
    state.lastNow = 0;
    const step = (now)=>{
      if(!state.el){ state.raf = 0; return; }
      const dt = state.lastNow ? Math.min(0.1, Math.max(0, (now - state.lastNow) / 1000)) : 0.016;
      state.lastNow = now;
      state.clock += dt; // keeps running after the acts: the live line's clock
      if(state.open && state.mode === 'staged' && !state.done) fireDueActs();
      tickTypers(dt);
      tickCounters(dt);
      updateLiveMeta(dt);
      if(state.fx) state.fx.frame(dt);
      state.raf = root.requestAnimationFrame(step);
    };
    state.raf = root.requestAnimationFrame(step);
  }
  function stopLoop(){
    if(state.raf && typeof root.cancelAnimationFrame === 'function'){ try{ root.cancelAnimationFrame(state.raf); }catch(e){} }
    state.raf = 0;
  }
  function clearCeremony(){
    state.dom = null; state.fx = null;
    state.acts = []; state.typers = []; state.counters = [];
    state.metaLiveOn = false; state.metaAcc = 0;
  }

  function onKeyDown(e){
    if(!state.open) return;
    if(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(e.repeat) return;
    // first press mid-play fast-forwards the ceremony; a finished ceremony
    // closes on Esc/Enter like every other overlay
    if(state.mode === 'staged' && !state.done){ finishCeremony(false); return; }
    if(e.key === 'Escape' || e.key === 'Enter') close();
  }

  function open(){
    if(state.open) return false;
    state.open = true;
    state.autoT = -1;
    hideBanner();
    if(!state.seen){ state.seen = true; persist(); }
    const hasDom = (typeof document !== 'undefined');
    state.mode = (!hasDom || shouldInstant(ceremonyEnv())) ? 'instant' : 'staged';
    state.done = state.mode === 'instant';
    state.clock = 0; state.metaAcc = 0;
    state.acts = []; state.typers = []; state.counters = [];
    state.metaLiveOn = state.mode === 'instant';
    state.pointer.moved = false;
    if(hasDom){
      if(state.el){ try{ state.el.remove(); }catch(e){} state.el = null; stopLoop(); clearCeremony(); }
      state.el = build();
      if(state.el) state.el.classList.add('show');
      if(state.mode === 'staged') scheduleActs();
      try{ document.body.classList.add('mmFinaleOpen'); }catch(e){} // hides the HUD under the ceremony
      root.addEventListener('keydown', onKeyDown, true);
      startLoop();
    }
    if(state.mode === 'instant') play('finaleFanfare');
    return true;
  }
  function close(){
    if(!state.open) return false;
    finishCeremony(true); // no act may fire after the curtain starts falling
    state.open = false;
    try{ if(typeof document !== 'undefined') document.body.classList.remove('mmFinaleOpen'); }catch(e){}
    root.removeEventListener('keydown', onKeyDown, true);
    if(state.el){
      const el = state.el;
      el.classList.add('leaving');
      // staged exits reassemble the world tile by tile under the fading overlay
      const rerez = !!(state.fx && state.mode === 'staged' && state.fx.startRerez());
      if(rerez) play('finaleRerez');
      const wait = rerez ? 1050 : 450;
      const finish = ()=>{
        try{ el.remove(); }catch(e){}
        if(state.el === el){ state.el = null; stopLoop(); clearCeremony(); }
      };
      if(typeof root.setTimeout === 'function') root.setTimeout(finish, wait);
      else finish();
    }
    play('uiClose');
    return true;
  }
  function isOpen(){ return state.open; }
  function unlocked(){ return state.unlocked; }

  function unlock(){
    if(!state.unlocked){
      state.unlocked = true;
      persist();
      addCompletion(verdict(report())); // exactly once per world: the layer counts as closed
    }
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
  function ceremony(){
    return {mode: state.mode, done: state.done, fx: !!state.fx, acts: state.acts.length,
      actsFired: state.acts.filter(a => a.fired).length};
  }

  if(typeof root.addEventListener === 'function'){
    root.addEventListener('mm-hero-died', ()=>{ state.deaths++; persist(); });
    root.addEventListener('mm-guardian-defeated', (e)=>{
      const kind = e && e.detail && e.detail.kind;
      if(kind === 'mother') unlock();
    });
  }

  const api = { report, credits, verdict, shouldInstant, souvenir, open, close, isOpen, unlocked, unlock,
    update, wire, reset, metrics, ceremony, layers,
    config: {BANNER_DELAY, AUTO_OPEN_DELAY, CEREMONY},
    _debug: {state} };
  MM.finale = api;
  return api;
})();

export { finale };
export default finale;
