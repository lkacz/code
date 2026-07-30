const fail=message=>'FAIL :: '+message;
if(!window.MM || !MM.world || !MM.worldGen || !MM.background
  || !MM.temporalEcho || !window.player || !window.__mmDebugHero)
  return fail('temporal visual APIs did not finish booting');

const waitFor=async(fn,ms)=>{
  const end=performance.now()+ms;
  while(performance.now()<end){
    const value=fn();
    if(value) return value;
    await sleep(40);
  }
  return null;
};

document.querySelector('#titleScreen .tsPrimary')?.click();
const craftPanel=document.getElementById('craft');
if(craftPanel && craftPanel.dataset.collapsed!=='true'){
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true}));
  document.body.dispatchEvent(new KeyboardEvent('keyup',{key:'t',bubbles:true}));
  await sleep(120);
}
window.__simulationTimeScale=1;
MM.background.importState({...MM.background.snapshot(),cycleT:0.18});
const deathX=Math.floor(player.x)+96;
window.__mmDebugHero(deathX,MM.worldGen.surfaceHeight(deathX)-2);
await sleep(300);
inv.stone=20;
player.hp=0;
window.heroDied('temporal_visual_qa');
const racing=await waitFor(()=>MM.temporalEcho.state().phase==='racing',12000);
const target=MM.temporalEcho.target();
if(!racing || !target) return fail('Echo did not enter its return race');

MM.background.importState({...MM.background.snapshot(),cycleT:0.40});
window.__mmDebugHero(target.x+0.12,target.y-0.3);
const rewinding=await waitFor(()=>MM.temporalEcho.state().phase==='rewinding',2500);
if(!rewinding) return fail('spirit contact did not begin automatic rewind');

// Leave the page in the expressive middle of the sequence so live-preview's
// screenshot captures the moving celestial trail, reverse rings and escrow HUD.
await sleep(620);
if(MM.temporalEcho.state().phase!=='rewinding') return fail('rewind visual ended before capture');
return 'ok :: phase=rewinding; cycle='+MM.background.snapshot().cycleT.toFixed(4)
  +'; targetCycle=0.1800; automaticContact=true';
