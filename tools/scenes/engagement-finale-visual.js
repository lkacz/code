const fail=message=>'FAIL :: '+message;
for(let i=0;i<300&&!(window.MM&&MM.finale&&MM.challenge);i++) await sleep(50);
if(!(window.MM&&MM.finale&&MM.challenge)) return fail('finale systems did not boot');
document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(300);

const verdict={key:'observer',title:'Obserwator Uważny',note:'zapis testowy'};
localStorage.setItem('mm_layers_v1',JSON.stringify({v:2,completions:2,lastVerdict:{key:verdict.key,title:verdict.title},history:[
  {layer:1,seed:101,day:20,level:8,deaths:5,bossKills:5,discoveries:{count:70,total:200},milestones:{done:4,total:8},verdict},
  {layer:2,seed:202,day:15,level:10,deaths:3,bossKills:6,discoveries:{count:95,total:200},milestones:{done:6,total:8},verdict}
]}));
MM.finale._debug.state.unlocked=false;
MM.finale._debug.state.seen=false;
MM.finale.unlock();
MM.finale.open();
await sleep(200);
document.querySelector('#finaleScreen .fnButtons button:nth-child(3)')?.click();
await sleep(120);

const screen=document.getElementById('finaleScreen');
const chooser=screen?.querySelector('.fnBoonChoices');
chooser?.scrollIntoView({block:'end'});
await sleep(120);
const checks={
  reportOpen:MM.finale.isOpen(),
  comparisons:screen?.querySelectorAll('.fnCompareChip').length===4,
  threeProtocols:chooser?.querySelectorAll('.fnBoonChoice').length===3,
  protocolVisible:chooser&&!chooser.hidden,
  archiveStyled:!!screen?.querySelector('.fnCompare .better, .fnCompare .worse, .fnCompare .same')
};
return (Object.values(checks).every(Boolean)?'ok':fail('finale engagement contract'))+' :: '+JSON.stringify({checks,protocols:[...chooser?.querySelectorAll('.fnBoonChoice b')||[]].map(node=>node.textContent)});
