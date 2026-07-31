// Rare generated graves are not failed player-death markers. They are compact
// archives left by the simulation: each one yields deterministic resources and
// one lore fragment, occasionally drawn from a layer this player actually
// completed. The model is DOM-free and Node-testable; the small dialog below is
// only a presentation shell around its immutable result.
const GENERAL_MEMORIES=Object.freeze([
  Object.freeze({
    title:'Miejsce po obserwatorze',
    text:'Świat nie trwa bez przerwy. Dalekie miejsca są składane ponownie dopiero wtedy, gdy wraca do nich spojrzenie.',
    signal:'Fragment protokołu oszczędzania warstwy'
  }),
  Object.freeze({
    title:'Wiersz bez zakończenia',
    text:'Śmierć nie usuwa Obserwatora. Zmienia jego współrzędne i dopisuje kolejny wiersz do raportu.',
    signal:'Dziennik procesu odrodzenia'
  }),
  Object.freeze({
    title:'Pamięć krótsza od świata',
    text:'Warstwa pamięta mniej niż gracz. Dlatego część prawdy przenosi się między światami w rzeczach, które wyglądają jak groby.',
    signal:'Archiwum warstwy nadrzędnej'
  }),
  Object.freeze({
    title:'Nazwane zagrożenie',
    text:'Każdy Strażnik jest jednocześnie wrogiem i stanem, którego symulacja nie umiała nazwać inaczej.',
    signal:'Notatka projektanta zachowań'
  }),
  Object.freeze({
    title:'Ślad wcześniejszej kompilacji',
    text:'Ruiny nie zawsze należą do przeszłości tego świata. Niektóre zostały zapamiętane z warstwy, której już nie można otworzyć.',
    signal:'Błąd porządkowania chronologii'
  }),
  Object.freeze({
    title:'Zasada zachowania',
    text:'Materia znika z mapy, ale nie z rachunku. Symulacja odkłada drobne resztki tam, gdzie pamięć staje się wystarczająco ciężka.',
    signal:'Bilans zasobów po zamknięciu'
  }),
  Object.freeze({
    title:'Głos spod warstwy',
    text:'Nie jesteś pierwszą wersją swoich decyzji. Jesteś tylko pierwszą, która potrafi je pamiętać.',
    signal:'Transmisja bez nadawcy'
  }),
  Object.freeze({
    title:'Granica mapy',
    text:'To, czego jeszcze nie odkryto, nie jest puste. Czeka w postaci reguł, aż Obserwator nada mu kształt.',
    signal:'Instrukcja generowania terenu'
  })
]);

const MAX_HISTORY=12;

function int(value,fallback=0){
  const n=Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function nonNegative(value){ return Math.max(0,int(value)); }

function hashAt(seed,x,y,salt){
  let h=(int(seed)^Math.imul(int(x),0x45d9f3b)^Math.imul(int(y),0x119de1f3)^Math.imul(int(salt),0x27d4eb2d))|0;
  h=Math.imul(h^(h>>>16),0x7feb352d);
  h=Math.imul(h^(h>>>15),0x846ca68b);
  return (h^(h>>>16))>>>0;
}

function historyRecord(raw,index){
  if(!raw || typeof raw!=='object') return null;
  const verdict=raw.verdict && typeof raw.verdict==='object' ? raw.verdict : null;
  if(!verdict || !verdict.key) return null;
  const discoveries=raw.discoveries && typeof raw.discoveries==='object' ? raw.discoveries : {};
  const milestones=raw.milestones && typeof raw.milestones==='object' ? raw.milestones : {};
  return Object.freeze({
    layer:Math.max(1,int(raw.layer,index+1)),
    seed:int(raw.seed),
    day:Math.max(1,int(raw.day,1)),
    level:Math.max(1,int(raw.level,1)),
    deaths:nonNegative(raw.deaths),
    bossKills:nonNegative(raw.bossKills),
    discoveries:Object.freeze({count:nonNegative(discoveries.count),total:nonNegative(discoveries.total)}),
    milestones:Object.freeze({done:nonNegative(milestones.done),total:nonNegative(milestones.total)}),
    verdict:Object.freeze({
      key:String(verdict.key),
      title:String(verdict.title||'Zamknięta warstwa'),
      note:String(verdict.note||'Raport przetrwał, choć świat został zamknięty.')
    })
  });
}

export function normalizeLayerHistory(layers){
  const src=layers && typeof layers==='object' ? layers : {};
  const completions=nonNegative(src.completions);
  const records=Array.isArray(src.history)
    ? src.history.map(historyRecord).filter(Boolean).slice(-MAX_HISTORY)
    : [];
  // v1 profiles remembered only the last verdict. Keep that real player
  // history useful instead of waiting for another full completion.
  if(!records.length && completions>0 && src.lastVerdict && src.lastVerdict.key){
    const legacy=historyRecord({
      layer:completions,
      verdict:{
        key:src.lastVerdict.key,
        title:src.lastVerdict.title,
        note:'Starszy raport zachował werdykt, lecz utracił szczegółowe pomiary.'
      }
    },completions-1);
    if(legacy) records.push(legacy);
  }
  return Object.freeze({completions,history:Object.freeze(records)});
}

export function layerGraveLoot(seed,x,y){
  const out=[];
  const add=(key,amount)=>{
    const n=Math.max(0,int(amount));
    if(n>0) out.push(Object.freeze([key,n]));
  };
  add('stone',2+(hashAt(seed,x,y,1)%4));
  if(hashAt(seed,x,y,2)%100<62) add('coal',1+(hashAt(seed,x,y,3)%4));
  else add('gold',1+(hashAt(seed,x,y,4)%2));
  if(hashAt(seed,x,y,5)%100<22) add('silverOre',1+(hashAt(seed,x,y,6)%2));
  if(hashAt(seed,x,y,7)%100<5) add('diamond',1);
  return Object.freeze(out);
}

function personalMemory(record){
  const knownDetails=record.seed!==0 || record.day>1 || record.level>1 || record.deaths>0
    || record.bossKills>0 || record.discoveries.total>0 || record.milestones.total>0;
  const measurements=knownDetails
    ? 'Ziarno '+record.seed+' · dzień '+record.day+' · poziom '+record.level+' · zgony '+record.deaths+'.'
    : 'Szczegółowe pomiary tej warstwy zostały już nadpisane.';
  const progress=knownDetails
    ? 'Pokonani bossowie: '+record.bossKills+' · odkrycia: '+record.discoveries.count+'/'+record.discoveries.total+' · kamienie milowe: '+record.milestones.done+'/'+record.milestones.total+'.'
    : '';
  return Object.freeze({
    kind:'personal',
    title:'Duch warstwy #'+record.layer,
    signal:record.verdict.title,
    text:'To nie jest twój dawny bohater. To zapis, który pamięta rytm jego kroków. '+record.verdict.note,
    measurements,
    progress,
    layer:record.layer,
    verdict:record.verdict.key
  });
}

export function layerGraveMemory(seed,x,y,layers){
  const archive=normalizeLayerHistory(layers);
  const personal=archive.history.length>0 && hashAt(seed,x,y,20)%100<68;
  if(personal){
    const record=archive.history[hashAt(seed,x,y,21)%archive.history.length];
    return personalMemory(record);
  }
  const memory=GENERAL_MEMORIES[hashAt(seed,x,y,22)%GENERAL_MEMORIES.length];
  return Object.freeze({
    kind:'simulation',
    title:memory.title,
    signal:memory.signal,
    text:memory.text,
    measurements:'Współrzędne archiwum: '+int(x)+', '+int(y)+'.',
    progress:'',
    layer:0,
    verdict:''
  });
}

export function layerGraveEntry(seed,x,y,layers){
  return Object.freeze({
    seed:int(seed),
    x:int(x),
    y:int(y),
    memory:layerGraveMemory(seed,x,y,layers),
    loot:layerGraveLoot(seed,x,y)
  });
}

function createLayerGraves(){
  const root=typeof window!=='undefined' ? window : globalThis;
  const MM=root.MM=root.MM||{};
  let overlay=null;
  let lastFocus=null;
  let currentEntry=null;

  function focusable(){
    if(!overlay) return [];
    return [...overlay.querySelectorAll('button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
      .filter(el=>!el.hidden && el.getClientRects().length>0);
  }
  function onKeyDown(event){
    if(!overlay) return;
    if(event.key==='Escape'){
      event.preventDefault(); event.stopImmediatePropagation(); close(); return;
    }
    if(event.key==='Tab'){
      const items=focusable();
      event.preventDefault(); event.stopImmediatePropagation();
      if(!items.length) return;
      const at=items.indexOf(document.activeElement);
      const next=at<0 ? (event.shiftKey?items.length-1:0) : (at+(event.shiftKey?-1:1)+items.length)%items.length;
      items[next].focus();
    }
  }
  function addText(parent,className,text){
    if(!text) return null;
    const el=document.createElement('p'); el.className=className; el.textContent=text; parent.appendChild(el); return el;
  }
  function installStyle(){
    if(document.getElementById('layerGraveStyle')) return;
    const style=document.createElement('style'); style.id='layerGraveStyle';
    style.textContent=`
#layerGraveMemory{position:fixed;inset:0;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 50% 45%,rgba(64,41,108,.28),rgba(4,7,14,.88) 62%);backdrop-filter:blur(3px);z-index:9800;color:#edf8ff;font-family:system-ui,sans-serif}
#layerGraveMemory .lgCard{box-sizing:border-box;position:relative;width:min(620px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 32px));overflow:auto;border:1px solid rgba(149,225,255,.55);border-radius:18px;padding:24px 26px 22px;background:linear-gradient(145deg,rgba(20,25,43,.97),rgba(20,12,36,.97));box-shadow:0 24px 90px rgba(0,0,0,.72),0 0 38px rgba(92,213,255,.12)}
#layerGraveMemory .lgRune{width:56px;height:56px;display:grid;place-items:center;margin:0 auto 11px;border:1px solid rgba(143,230,255,.65);border-radius:50%;color:#9eeaff;font-size:30px;box-shadow:0 0 24px rgba(99,215,255,.25) inset,0 0 20px rgba(139,91,255,.18)}
#layerGraveMemory .lgKicker{text-align:center;margin:0 0 7px;color:#9cb3c8;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}
#layerGraveMemory h2{text-align:center;margin:0;color:#f5fbff;font:700 clamp(22px,4vw,31px)/1.15 Georgia,serif}
#layerGraveMemory .lgSignal{text-align:center;margin:9px 0 20px;color:#bb9eff;font-size:14px}
#layerGraveMemory .lgText{margin:0;padding:17px 18px;border-left:2px solid #78dff7;background:rgba(106,209,255,.055);font:italic 17px/1.62 Georgia,serif;color:#e7f7ff}
#layerGraveMemory .lgMeasure,#layerGraveMemory .lgProgress{margin:13px 0 0;color:#aebdca;font-size:13px;line-height:1.5}
#layerGraveMemory .lgLootTitle{margin:22px 0 9px;color:#88e8ca;font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}
#layerGraveMemory .lgLoot{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px;padding:0;list-style:none}
#layerGraveMemory .lgLoot li{padding:7px 10px;border:1px solid rgba(112,222,188,.28);border-radius:999px;background:rgba(44,157,126,.11);color:#c8f7e8;font-size:13px}
#layerGraveMemory .lgClose{display:block;min-width:150px;margin:0 auto;padding:10px 18px;border:1px solid rgba(163,225,255,.45);border-radius:11px;background:#223a55;color:#f4fbff;font:700 14px system-ui,sans-serif;cursor:pointer}
#layerGraveMemory .lgClose:hover,#layerGraveMemory .lgClose:focus-visible{background:#2d4e70;outline:2px solid #99e8ff;outline-offset:2px}
@media(max-width:560px){#layerGraveMemory{padding:8px}#layerGraveMemory .lgCard{padding:20px 18px 18px;max-height:calc(100vh - 16px)}#layerGraveMemory .lgText{font-size:15px}}
@media(prefers-reduced-motion:reduce){#layerGraveMemory{backdrop-filter:none}}
`;
    document.head.appendChild(style);
  }
  function close(){
    if(!overlay) return false;
    const old=overlay; overlay=null; currentEntry=null;
    root.removeEventListener('keydown',onKeyDown,true);
    try{ if(MM.modalInput && MM.modalInput.pop) MM.modalInput.pop('layer-grave'); }catch(e){}
    try{ old.remove(); }catch(e){}
    try{ if(lastFocus && lastFocus.isConnected && lastFocus.focus) lastFocus.focus({preventScroll:true}); }catch(e){}
    lastFocus=null;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('uiClose'); }catch(e){}
    return true;
  }
  function open(entry,opts){
    if(typeof document==='undefined' || !document.body || !entry || !entry.memory) return false;
    if(overlay) close();
    installStyle();
    currentEntry=entry;
    lastFocus=document.activeElement && document.activeElement!==document.body ? document.activeElement : null;
    const memory=entry.memory;
    overlay=document.createElement('div'); overlay.id='layerGraveMemory';
    overlay.dataset.layerGraveKind=memory.kind;
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-labelledby','layerGraveMemoryTitle');
    const card=document.createElement('section'); card.className='lgCard';
    const rune=document.createElement('div'); rune.className='lgRune'; rune.setAttribute('aria-hidden','true'); rune.textContent=memory.kind==='personal'?'◈':'⌁'; card.appendChild(rune);
    addText(card,'lgKicker',memory.kind==='personal'?'echo poprzedniej warstwy':'archiwum symulacji');
    const title=document.createElement('h2'); title.id='layerGraveMemoryTitle'; title.textContent=memory.title; card.appendChild(title);
    addText(card,'lgSignal',memory.signal);
    addText(card,'lgText',memory.text);
    addText(card,'lgMeasure',memory.measurements);
    addText(card,'lgProgress',memory.progress);
    const loot=opts && Array.isArray(opts.loot) ? opts.loot : entry.loot;
    if(loot && loot.length){
      addText(card,'lgLootTitle','odzyskane pozostałości');
      const list=document.createElement('ul'); list.className='lgLoot';
      for(const row of loot){
        if(!row) continue;
        const li=document.createElement('li');
        li.textContent=Array.isArray(row) ? (String(row[1])+'× '+String(row[0])) : String(row);
        list.appendChild(li);
      }
      card.appendChild(list);
    }
    const button=document.createElement('button'); button.type='button'; button.className='lgClose'; button.textContent='Zachowaj pamięć'; button.addEventListener('click',close); card.appendChild(button);
    overlay.appendChild(card);
    overlay.addEventListener('pointerdown',event=>{ if(event.target===overlay) close(); });
    document.body.appendChild(overlay);
    try{ if(MM.modalInput && MM.modalInput.push) MM.modalInput.push('layer-grave',overlay); }catch(e){}
    root.addEventListener('keydown',onKeyDown,true);
    try{ button.focus({preventScroll:true}); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('uiOpen'); }catch(e){}
    return true;
  }
  function isOpen(){ return !!overlay; }
  function current(){ return currentEntry; }
  const api={open,close,isOpen,current,entryAt:layerGraveEntry,lootAt:layerGraveLoot,memoryAt:layerGraveMemory,normalizeHistory:normalizeLayerHistory,GENERAL_MEMORIES};
  MM.layerGraves=api;
  return api;
}

const layerGraves=createLayerGraves();

export { GENERAL_MEMORIES, MAX_HISTORY, layerGraves };
export default layerGraves;
