// Engagement director: turns existing simulation evidence into one contextual
// hypothesis, exposes readable boss lessons, and opens optional post-finale
// mastery/rematch goals. It derives UI truth only; the sole gameplay actions
// call the guardians' existing rematch seams and never write terrain directly.
const root=typeof window!=='undefined' ? window : globalThis;
const MM=root.MM=root.MM||{};

const LAB_PHASES=new Set(['watch_area','tree_watch_short','tree_watch_long','sand_hide']);
const REMATCHES=Object.freeze([
  {key:'west',title:'Echo Zachodu',detail:'Wróć do lodowego pałacu i rozpocznij świadomy rewanż.',reward:'doskonalenie taktyki'},
  {key:'east',title:'Echo Wschodu',detail:'Wróć do żarzącej areny i rozpocznij świadomy rewanż.',reward:'doskonalenie taktyki'},
  {key:'earth',title:'Echo Głębi',detail:'Wróć do Root Kernel i ponownie odkop prawdę.',reward:'doskonalenie taktyki'},
  {key:'air',title:'Echo Ambicji',detail:'Wróć do Sky Gate i ponownie przełam rezonatory.',reward:'doskonalenie taktyki'}
]);

export function recommendHypothesis(entries){
  const rows=Array.isArray(entries) ? entries : [];
  return rows.filter(entry=>{
    const e=entry&&entry.evidence;
    return !!(entry && !entry.found && e && e.requirementsMet!==false && (Number(e.needed)>0 || Number(e.distinctNeeded)>0));
  }).sort((a,b)=>{
    const ae=a.evidence||{}, be=b.evidence||{};
    const ap=(Number(ae.count)||0)+(Number(ae.distinct)||0);
    const bp=(Number(be.count)||0)+(Number(be.distinct)||0);
    if(!!bp!==!!ap) return Number(!!bp)-Number(!!ap);
    const ar=Math.max((Number(ae.count)||0)/Math.max(1,Number(ae.needed)||1),(Number(ae.distinct)||0)/Math.max(1,Number(ae.distinctNeeded)||1));
    const br=Math.max((Number(be.count)||0)/Math.max(1,Number(be.needed)||1),(Number(be.distinct)||0)/Math.max(1,Number(be.distinctNeeded)||1));
    return br-ar || (Number(a.stageRank)||0)-(Number(b.stageRank)||0) || (Number(a.tierRank)||0)-(Number(b.tierRank)||0) || String(a.id).localeCompare(String(b.id));
  })[0] || null;
}

function hypothesisProgress(entry){
  const e=entry&&entry.evidence||{};
  if(Number(e.distinctNeeded)>1) return {current:Number(e.distinct)||0,target:Number(e.distinctNeeded)||1,label:'różne ślady'};
  return {current:Number(e.count)||0,target:Math.max(1,Number(e.needed)||1),label:'ślady'};
}

const state={tick:0,currentHypothesis:'',feedMode:'',bossKey:'',lesson:'',masteryAnnounced:false};
let context={};
function tasks(){ return MM.tasks||null; }
function notify(kind,text,opts){
  try{ if(MM.smartFeed&&MM.smartFeed.notify) MM.smartFeed.notify(kind,text,opts||{}); else if(root.msg) root.msg(text); }catch(e){}
}
function hearts(){
  try{ return MM.progress&&MM.progress.guardianHearts ? (MM.progress.guardianHearts()||{}) : {}; }catch(e){ return {}; }
}
function postgame(){
  const h=hearts();
  if(h.mother) return true;
  try{ return !!(MM.centerGuardian&&MM.centerGuardian.completed&&MM.centerGuardian.completed()); }catch(e){ return false; }
}
function mentorPhase(){
  try{ const s=MM.npcs&&MM.npcs.mentor&&MM.npcs.mentor.summary&&MM.npcs.mentor.summary(); return s&&s.phase||''; }catch(e){ return ''; }
}
function syncFeedFocus(){
  const next=LAB_PHASES.has(mentorPhase()) ? 'onboarding' : 'normal';
  if(next===state.feedMode) return;
  state.feedMode=next;
  try{ if(MM.smartFeed&&MM.smartFeed.setFocusMode) MM.smartFeed.setFocusMode(next); }catch(e){}
}
function syncHypothesis(){
  const api=tasks();
  const discovery=MM.discovery;
  if(!api||!api.upsert||!discovery||!discovery.entries) return;
  const entry=recommendHypothesis(discovery.entries());
  const previous=state.currentHypothesis;
  if(!entry){
    if(previous) api.complete('hypothesis:'+previous);
    state.currentHypothesis='';
    return;
  }
  if(previous&&previous!==entry.id){
    if(discovery.has&&discovery.has(previous)) api.complete('hypothesis:'+previous);
    else api.remove('hypothesis:'+previous);
  }
  state.currentHypothesis=entry.id;
  api.upsert({
    id:'hypothesis:'+entry.id,
    source:'hypothesis',
    kind:'experiment',
    title:'Hipoteza Atlasu: '+String(entry.hint||'zbierz kolejny dowód'),
    detail:'Sprawdź tę zależność w świecie. Atlas zapisuje fakty, nie czas spędzony w menu.',
    priority:32,
    pointer:false,
    target:null,
    progress:hypothesisProgress(entry),
    difficulty:entry.stageLabel||entry.stage||'eksploracja',
    reward:'+'+(Number(entry.xp)||0)+' XP · wpis Atlasu',
    reason:'Wybrane z najbliższego niedokończonego łańcucha dowodów'
  });
}

function lairTarget(key){
  try{
    if(key==='west'||key==='east'){
      const s=MM.guardianLairs&&MM.guardianLairs.status&&MM.guardianLairs.status();
      const L=s&&s.lairs&&(key==='west'?s.lairs.ice:s.lairs.fire);
      if(L) return {x:Number(L.ax)+0.5,y:Number(L.floorY)-2,label:key==='west'?'Echo Zachodu':'Echo Wschodu'};
    }
    if(key==='earth'){
      const s=MM.undergroundBoss&&MM.undergroundBoss.status&&MM.undergroundBoss.status();
      const L=s&&s.lair; if(L) return {x:Number(L.x)+0.5,y:Number(L.y)-2,label:'Echo Głębi'};
    }
    if(key==='air'){
      const s=MM.skyGuardian&&MM.skyGuardian.status&&MM.skyGuardian.status();
      const L=s&&s.lair; if(L) return {x:Number(L.x)+0.5,y:Number(L.floorY)-2,label:'Echo Ambicji'};
    }
  }catch(e){}
  return null;
}
function upsertMastery(id,src){
  const api=tasks();
  return api&&api.upsert ? api.upsert(Object.assign({id:'mastery:'+id,source:'mastery',kind:'mastery',priority:14,pointer:false,target:null},src)) : null;
}
function syncMastery(){
  const api=tasks();
  if(!api||!postgame()) return;
  if(!state.masteryAnnounced){
    state.masteryAnnounced=true;
    notify('story','Archiwum otwiera cele mistrzowskie: pełny Atlas, kamienie milowe i echa Strażników.',{title:'PO ZAKOŃCZENIU',dedupeKey:'mastery:unlocked',priority:86});
  }
  try{
    const p=MM.discovery&&MM.discovery.progress&&MM.discovery.progress();
    if(p&&p.count<p.total) upsertMastery('atlas',{title:'Domknij Atlas wiedzy',detail:'Odnajdź brakujące reakcje i zależności symulacji.',progress:{current:p.count,target:p.total,label:'odkrycia'},reward:'pełne archiwum',difficulty:'długoterminowe'});
    else if(api.state&&api.state().active.some(t=>t.id==='mastery:atlas')) api.complete('mastery:atlas');
  }catch(e){}
  try{
    const rows=MM.progress&&MM.progress.milestones&&MM.progress.milestones();
    if(Array.isArray(rows)){
      const done=rows.filter(row=>row&&row.done).length;
      if(done<rows.length) upsertMastery('milestones',{title:'Dokończ protokół warstwy',detail:'Zamknij pominięte kamienie milowe bez resetowania świata.',progress:{current:done,target:Math.max(1,rows.length),label:'kamienie'},reward:'kompletny protokół',difficulty:'długoterminowe'});
      else if(api.state&&api.state().active.some(t=>t.id==='mastery:milestones')) api.complete('mastery:milestones');
    }
  }catch(e){}
  upsertMastery('archive',{title:'Porównaj i wybierz następną warstwę',detail:'Raport pokazuje zmianę względem poprzedniego zamknięcia oraz dodatni protokół zejścia.',action:{id:'open-finale',label:'Otwórz archiwum'},reward:'nowa strategia'});
  for(const rematch of REMATCHES){
    const target=lairTarget(rematch.key);
    upsertMastery('rematch:'+rematch.key,{title:rematch.title,detail:rematch.detail,target,pointer:!!target,action:{id:'rematch:'+rematch.key,label:'Rozpocznij echo'},reward:rematch.reward,difficulty:'opcjonalne'});
  }
}

function activeBossLesson(){
  try{
    const s=MM.guardianLairs&&MM.guardianLairs.status&&MM.guardianLairs.status();
    const boss=s&&Array.isArray(s.entities)&&s.entities.find(e=>e&&e.boss);
    if(boss){
      if(boss.kind==='fire') return {key:'east',title:'Lekcja Ignivara',detail:boss.sealed?'Tarcza jest literalnym ogniem: śnieg działa najlepiej, woda i plucie też chłodzą.':'Okno jest otwarte. Uderzaj teraz; odnowiony żar ponownie zamknie rdzeń.',boss};
      return {key:'west',title:'Lekcja Aurexa',detail:boss.sealed?'Każdy cios restartuje ciszę. Przestań atakować, poczekaj na pełne otwarcie heartglass.':'Cisza się domknęła — odpowiedz serią, zanim lód wróci.',boss};
    }
  }catch(e){}
  try{
    const s=MM.undergroundBoss&&MM.undergroundBoss.status&&MM.undergroundBoss.status();
    const boss=s&&Array.isArray(s.entities)&&s.entities.find(e=>e&&e.boss);
    if(boss){
      let detail=s.stage==='surveyor'?'Mara zakopuje część obrażeń. Rozbij kopce pamięci, aby ból wrócił.':'Gaz wypłasza Nyxolitha z kamienia; atakuj, gdy wynurzy się w świeżym tunelu.';
      if(s.vulnerable===false) detail='Pancerz odbija ciosy. Śledź świeży tunel i przygotuj gaz na wynurzenie.';
      return {key:'earth',title:'Lekcja Głębi',detail,boss};
    }
  }catch(e){}
  try{
    const s=MM.skyGuardian&&MM.skyGuardian.status&&MM.skyGuardian.status();
    const boss=s&&Array.isArray(s.entities)&&s.entities.find(e=>e&&e.boss);
    if(boss){
      const detail=boss.shielded?'Astrael przekierowuje obrażenia. Najpierw zniszcz aktywne rezonatory.':'Tarcza zgasła. Zmień rytm ataku, zanim Astrael zaadaptuje się ponownie.';
      return {key:'air',title:'Lekcja Astraela',detail,boss};
    }
  }catch(e){}
  try{
    const s=MM.centerGuardian&&MM.centerGuardian.status&&MM.centerGuardian.status();
    if(s&&s.phase==='battle'&&s.mimic) return {key:'mother',title:'Lekcja Lustra',detail:'Lustro czyta powtarzalny rytm. Zmień narzędzie, dystans albo tempo i wykorzystaj własne odbicie.',boss:s.mimic};
  }catch(e){}
  return null;
}
function syncBossLesson(){
  const api=tasks(); if(!api) return;
  const lesson=activeBossLesson();
  if(!lesson){ if(state.bossKey&&api.removeSource) api.removeSource('combat'); state.bossKey=''; state.lesson=''; return; }
  state.bossKey=lesson.key; state.lesson=lesson.detail;
  const hp=Math.max(0,Number(lesson.boss.hp)||0), max=Math.max(1,Number(lesson.boss.maxHp)||1);
  api.upsert({id:'combat:guardian',source:'combat',kind:'lesson',title:lesson.title,detail:lesson.detail,priority:88,pointer:false,target:null,progress:{current:max-hp,target:max,label:'obrażeń'},reward:'przełam mechanikę',difficulty:'reaktywne'});
}

function nearTarget(target){
  const p=context.player||root.player;
  return !!(target&&p&&Math.hypot(Number(p.x)-target.x,Number(p.y)-target.y)<=90);
}
function handleTaskAction(actionId,task){
  const id=String(actionId||'');
  if(id==='open-finale'){
    try{ if(MM.finale&&MM.finale.open) return !!MM.finale.open({instant:true}); }catch(e){}
    return false;
  }
  if(!id.startsWith('rematch:')) return false;
  const key=id.slice(8), target=task&&task.target||lairTarget(key);
  if(!nearTarget(target)){
    try{ if(tasks()&&tasks().setPriority&&task) tasks().setPriority(task.id); }catch(e){}
    notify('task','Najpierw dotrzyj do areny. Czerwona strzałka prowadzi do miejsca echa.',{title:'ECHO STRAŻNIKA',dedupeKey:'rematch:travel:'+key,priority:72});
    return false;
  }
  let started=false;
  try{
    if(key==='west'||key==='east') started=!!(MM.guardianLairs&&MM.guardianLairs.forceAwaken&&MM.guardianLairs.forceAwaken(key==='west'?'ice':'fire'));
    else if(key==='earth') started=!!(MM.undergroundBoss&&MM.undergroundBoss.forceAwaken&&MM.undergroundBoss.forceAwaken(context.getTile,context.setTile));
    else if(key==='air') started=!!(MM.skyGuardian&&MM.skyGuardian.forceAwaken&&MM.skyGuardian.forceAwaken(context.getTile,context.setTile));
  }catch(e){ started=false; }
  notify(started?'story':'warning',started?'Echo odpowiada. Próba nie zmienia zdobytych serc ani postępu fabuły.':'Echo nie może rozpocząć się w tej chwili.',{title:started?'ECHO AKTYWNE':'ECHO NIEDOSTĘPNE',dedupeKey:'rematch:start:'+key,priority:started?90:82});
  state.tick=1;
  return started;
}

function update(dt){
  if(!(dt>0)||!Number.isFinite(dt)) return;
  state.tick+=Math.min(1,dt);
  if(state.tick<0.75) return;
  state.tick=0;
  syncFeedFocus();
  syncHypothesis();
  syncBossLesson();
  syncMastery();
}
function setContext(next){ context=next&&typeof next==='object'?next:{}; return true; }
function reset(){
  state.tick=0; state.currentHypothesis=''; state.feedMode=''; state.bossKey=''; state.lesson=''; state.masteryAnnounced=false;
  try{ const api=tasks(); if(api&&api.removeSource){ api.removeSource('hypothesis'); api.removeSource('combat'); api.removeSource('mastery'); } }catch(e){}
}
function metrics(){ return {hypothesis:state.currentHypothesis,boss:state.bossKey,postgame:postgame(),feedMode:state.feedMode}; }

try{
  if(typeof root.addEventListener==='function'){
    root.addEventListener('mm-discovery-earned',event=>{
      const id=String(event&&event.detail&&event.detail.id||'');
      if(id&&id===state.currentHypothesis){ try{ const api=tasks(); if(api) api.complete('hypothesis:'+id); }catch(e){} state.currentHypothesis=''; }
      state.tick=1;
    });
    root.addEventListener('mm-hero-died',()=>{
      if(!state.lesson) return;
      notify('warning','Wniosek po porażce: '+state.lesson,{title:'ANALIZA STARCIA',dedupeKey:'combat:postmortem:'+state.bossKey,priority:112,urgent:true});
    });
  }
}catch(e){}

const api={update,setContext,handleTaskAction,reset,metrics,recommendHypothesis,REMATCHES};
MM.engagement=api;
export const engagement=api;
export default engagement;
