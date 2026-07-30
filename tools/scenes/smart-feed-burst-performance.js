const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.smartFeed) return fail('smart feed did not finish booting');

document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(120);
MM.smartFeed.clear();

const host=document.getElementById('smartFeed');
const originalReplace=host.replaceChildren.bind(host);
let rebuilds=0;
host.replaceChildren=(...nodes)=>{
  rebuilds++;
  return originalReplace(...nodes);
};

for(let i=0;i<100;i++){
  MM.smartFeed.push({
    kind:'info',
    text:'Burst '+i,
    priority:i%5,
    dedupeKey:'qa:burst:'+i
  });
}
await sleep(80);
host.replaceChildren=originalReplace;

const state=MM.smartFeed.state();
const checks={
  oneVisible:state.history.length===1,
  boundedPending:state.pending.length===state.maxPending,
  noQueuedDomChurn:rebuilds<=2
};
return (Object.values(checks).every(Boolean)?'ok':'FAIL')+' :: '+JSON.stringify({
  rebuilds,
  history:state.history.length,
  pending:state.pending.length,
  checks
});
