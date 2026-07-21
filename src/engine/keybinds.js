// Rebindable keyboard actions. The model is a pure key→key permutation layered
// UNDER the existing input code: every gameplay read site keeps checking the
// DEFAULT key ('e' opens the wardrobe, 'b' pauses…), and the keydown/keyup
// listeners run each physical key through translate() first. Rebinding an
// action therefore never touches a consumer — it only changes which physical
// key produces the logical one.
//
// Contracts:
// - translate() is a permutation-with-holes: a custom-bound key maps to its
//   action's default key; a default key whose action moved away (and which no
//   other action claimed) maps to a dead '§'-prefixed name so it matches no
//   read site (keyup still clears it from the pressed-keys map).
// - Conflicts swap: binding an action to a key another action holds gives that
//   other action this action's previous key, so every action always has
//   exactly one key and translate() stays collision-free.
// - Arrows and Space are fixed aliases (movement read sites test them
//   directly) and digits/Escape/F-keys/zoom chars are reserved — isBindable()
//   rejects them all, so browser/UI chrome can't be shadowed.
// - Persistence: mm_keybinds_v1 stores only non-default bindings; a tampered
//   blob that would produce a key collision resets to defaults (fail closed).
window.MM = window.MM || {};
(function(){
  const STORE_KEY='mm_keybinds_v1';
  const GROUPS=[
    {id:'ruch', label:'Ruch'},
    {id:'akcja', label:'Interakcja'},
    {id:'widok', label:'Widok i panele'},
    {id:'debug', label:'Debug'},
  ];
  const ACTIONS=[
    {id:'left',       group:'ruch',  def:'a', label:'W lewo',                    aliases:['arrowleft']},
    {id:'right',      group:'ruch',  def:'d', label:'W prawo',                   aliases:['arrowright']},
    {id:'jump',       group:'ruch',  def:'w', label:'Skok / w górę',             aliases:[' ','arrowup']},
    {id:'down',       group:'ruch',  def:'s', label:'W dół / zejście',           aliases:['arrowdown']},
    {id:'interact',   group:'akcja', def:'e', label:'Interakcja / podnieś / ekwipunek'},
    {id:'craft',      group:'akcja', def:'t', label:'Receptury (rzemiosło)'},
    {id:'fish',       group:'akcja', def:'f', label:'Wędkowanie'},
    {id:'rotate',     group:'akcja', def:'r', label:'Obrót / tryb tła'},
    {id:'undo',       group:'akcja', def:'z', label:'Cofnij budowlę'},
    {id:'scanner',    group:'akcja', def:'x', label:'Skaner kraterów'},
    // 'q' moved from vision to the antenna active power (2026-07 antenna wave);
    // vision landed on the previously free 'y' — read sites track the defaults.
    {id:'antenna',    group:'akcja', def:'q', label:'Moc antenki'},
    {id:'vision',     group:'widok', def:'y', label:'Noktowizja / termowizja'},
    {id:'pause',      group:'widok', def:'b', label:'Pauza i ustawienia'},
    {id:'fullscreen', group:'widok', def:'u', label:'Pełny ekran'},
    {id:'map',        group:'debug', def:'m', label:'Odsłoń całą mapę'},
    {id:'minimap',    group:'widok', def:'n', label:'Minimapa'},
    {id:'center',     group:'widok', def:'c', label:'Wyśrodkuj kamerę'},
    {id:'help',       group:'widok', def:'h', label:'Pomoc'},
    {id:'god',        group:'debug', def:'g', label:'Tryb boga'},
    {id:'immunity',   group:'debug', def:'i', label:'Nieśmiertelność'},
    {id:'mobDebug',   group:'debug', def:'v', label:'Debug mobów'},
    {id:'chestDebug', group:'debug', def:'p', label:'Podświetl skrzynie'},
    {id:'chestCount', group:'debug', def:'j', label:'Policz skrzynie'},
    {id:'chestSpawn', group:'debug', def:'k', label:'Wstaw skrzynię (tier)'},
    {id:'chestPlace', group:'debug', def:'l', label:'Postaw skrzynię (los)'},
    {id:'eruption',   group:'debug', def:'o', label:'Erupcja wulkanu'},
  ];
  const byId={}; for(const a of ACTIONS) byId[a.id]=a;
  // single letters (incl. Polish) and a few punctuation chars; everything else
  // — digits (weapons/hotbar), space/arrows (fixed aliases), +-=[] (zoom),
  // '/' (panel search), Escape/Enter/F-keys (multi-char) — is unbindable
  const BINDABLE_RE=/^[a-ząćęłńóśźż;,.'`]$/;

  let custom={}; // actionId -> physical key, only when it differs from def
  function keyFor(id){ const a=byId[id]; if(!a) return null; return custom[id]||a.def; }
  function isBindable(key){
    const k=String(key||'').toLowerCase();
    if(!BINDABLE_RE.test(k)) return {ok:false, reason:'invalid'};
    return {ok:true};
  }

  // physical→logical map + the set of orphaned defaults (dead keys)
  let phys={}, stolen=new Set();
  function rebuild(){
    phys={}; stolen=new Set();
    const bound=new Set();
    for(const a of ACTIONS){ const cur=keyFor(a.id); bound.add(cur); if(cur!==a.def) phys[cur]=a.def; }
    for(const a of ACTIONS){ if(keyFor(a.id)!==a.def && !bound.has(a.def)) stolen.add(a.def); }
  }
  function translate(key){
    const k=String(key||'').toLowerCase();
    if(Object.prototype.hasOwnProperty.call(phys,k)) return phys[k];
    return stolen.has(k) ? '§'+k : k;
  }

  function save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(custom)); }catch(e){} }
  function load(){
    custom={};
    let d=null;
    try{ const raw=localStorage.getItem(STORE_KEY); if(raw) d=JSON.parse(raw); }catch(e){ d=null; }
    if(d && typeof d==='object'){
      for(const id in d){
        const a=byId[id]; const k=String(d[id]||'').toLowerCase();
        if(a && isBindable(k).ok && k!==a.def) custom[id]=k;
      }
      // a hand-edited blob can alias two actions onto one key — fail closed
      const used=new Set();
      for(const a of ACTIONS){ const cur=keyFor(a.id); if(used.has(cur)){ custom={}; break; } used.add(cur); }
    }
    rebuild();
  }

  function setBinding(id,key){
    const a=byId[id]; if(!a) return {ok:false, reason:'unknown-action'};
    const k=String(key||'').toLowerCase();
    const v=isBindable(k); if(!v.ok) return v;
    const prev=keyFor(id);
    if(prev===k) return {ok:true, swapped:null};
    const assign=(aid,ak)=>{ if(ak===byId[aid].def) delete custom[aid]; else custom[aid]=ak; };
    let swapped=null;
    for(const b of ACTIONS){
      if(b.id!==id && keyFor(b.id)===k){ assign(b.id, prev); swapped={id:b.id, label:b.label, key:prev}; break; }
    }
    assign(id,k);
    save(); rebuild();
    return {ok:true, swapped};
  }
  function resetAll(){ custom={}; save(); rebuild(); }
  function bindings(){ const out={}; for(const a of ACTIONS) out[a.id]=keyFor(a.id); return out; }
  function isCustomized(){ for(const id in custom) return true; return false; }

  const PRETTY={' ':'Spacja', arrowleft:'←', arrowright:'→', arrowup:'↑', arrowdown:'↓'};
  function displayKey(k){
    const s=String(k==null?'':k).toLowerCase();
    return PRETTY[s] || (s.length===1 ? s.toUpperCase() : s);
  }

  load();
  MM.keybinds={ ACTIONS, GROUPS, keyFor, translate, setBinding, resetAll,
    isBindable, bindings, isCustomized, displayKey, _load:load };
})();
// ESM export (progressive migration)
export const keybinds = (typeof window!=='undefined' && window.MM) ? window.MM.keybinds : undefined;
export default keybinds;
