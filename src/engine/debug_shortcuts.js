// Debug hotkeys are deliberately armed only while the developer toolbox is
// visibly open. Requiring both DOM signals makes the check fail closed when a
// stale/custom UI leaves the panel and its trigger out of sync.
function debugShortcutsEnabled(doc=globalThis.document){
  if(!doc || typeof doc.getElementById!=='function') return false;
  const panel=doc.getElementById('menuPanel');
  const trigger=doc.getElementById('debugMenuBtn');
  if(!panel || !trigger) return false;
  if(panel.isConnected===false || trigger.isConnected===false) return false;
  return panel.hidden===false && trigger.getAttribute('aria-expanded')==='true';
}

// The toolbox trigger and panel are CSS-gated in index.html
// (`:root:not([data-dev-tools='1']) .devOnly`) so a build can drop developer
// tools wholesale. That gate shipped without a switch, which also hid the 🛠
// icon from the author's own game — this predicate is the switch. Armed by
// default (the page IS the developer's game); two deliberate refusals:
//   * `?watch=` — a spectator/guest replica must never expose world-writing
//     debug panels: they bypass the host chokepoints the multiplayer contract
//     depends on, and a guest's world truth is streamed, not owned.
//   * `?dev=0` — explicit opt-out for clean screenshots and QA captures.
function devToolsArmed(search){
  const q = String(search != null ? search : ((globalThis.location && globalThis.location.search) || ''));
  if(/[?&]dev=0(?:&|$)/.test(q)) return false;
  if(/[?&]watch=/.test(q)) return false;
  return true;
}

// Publishes the decision on <html> for the CSS gate. Returns what it decided so
// callers can log/branch without re-reading the DOM.
function applyDevToolsFlag(doc=globalThis.document, search){
  const armed = devToolsArmed(search);
  const root = doc && doc.documentElement;
  if(!root) return armed;
  if(armed) root.setAttribute('data-dev-tools','1');
  else root.removeAttribute('data-dev-tools');
  return armed;
}

export { debugShortcutsEnabled, devToolsArmed, applyDevToolsFlag };
