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

export { debugShortcutsEnabled };
