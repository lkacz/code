const fail = message => 'FAIL :: ' + message;
if(!window.MM || !MM.heroEnergy || !window.player) return fail('hero energy API did not finish booting');

const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true') document.getElementById('craftToggle')?.click();
const dispatchKey=(type,key,code)=>document.body.dispatchEvent(new KeyboardEvent(type,{key,code,bubbles:true,cancelable:true}));
const down=(key,code)=>dispatchKey('keydown',key,code);
const up=(key,code)=>dispatchKey('keyup',key,code);

// Start from a full battery and let any pre-scene floating number expire.
player.energy=MM.heroEnergy.info().max;
await sleep(1150);

const proto=CanvasRenderingContext2D.prototype;
const originalFillText=proto.fillText;
const energyTexts=[];
proto.fillText=function(value,...args){
	const text=String(value);
	if(String(this.fillStyle).toLowerCase()==='#ffd66b' && /^-\d+$/.test(text)) energyTexts.push(text);
	return originalFillText.call(this,value,...args);
};
const finish=result=>{ proto.fillText=originalFillText; return result; };

// A normal hold must stay silent while Shift remains down, then show exactly
// the rounded total after the final Shift key is released.
const firstStart=player.energy;
down('d','KeyD');
down('Shift','ShiftLeft');
await sleep(1050);
const firstBeforeRelease=player.energy;
if(energyTexts.length) return finish(fail('turbo emitted energy numbers during Shift hold: '+[...new Set(energyTexts)].join(',')));
up('Shift','ShiftLeft');
up('d','KeyD');
await sleep(180);
const firstExpected='-'+Math.max(1,Math.round(firstStart-firstBeforeRelease));
const firstShown=[...new Set(energyTexts)];
if(firstShown.length!==1 || firstShown[0]!==firstExpected)
	return finish(fail('Shift release summary mismatch: expected '+firstExpected+', got '+firstShown.join(',')));

// Exhaustion is the other valid end: it reports once before key release. The
// reporting lock prevents passive trickle charge from starting notification spam.
await sleep(1150);
energyTexts.length=0;
player.energy=2;
down('d','KeyD');
down('Shift','ShiftLeft');
await sleep(650);
const depletionShown=[...new Set(energyTexts)];
if(depletionShown.length!==1 || depletionShown[0]!=='-2')
	return finish(fail('depletion should show one -2 summary, got '+depletionShown.join(',')));
await sleep(260);
if([...new Set(energyTexts)].join(',')!=='-2') return finish(fail('depleted held Shift resumed notification spam'));
up('Shift','ShiftLeft');
up('d','KeyD');

// Leave a fresh release summary on screen for visual QA.
await sleep(1150);
energyTexts.length=0;
player.energy=MM.heroEnergy.info().max;
const finalStart=player.energy;
down('d','KeyD');
down('Shift','ShiftLeft');
await sleep(650);
const finalBeforeRelease=player.energy;
if(energyTexts.length) return finish(fail('final hold emitted a premature number'));
up('Shift','ShiftLeft');
up('d','KeyD');
await sleep(160);
const finalExpected='-'+Math.max(1,Math.round(finalStart-finalBeforeRelease));
const finalShown=[...new Set(energyTexts)];
if(finalShown.length!==1 || finalShown[0]!==finalExpected)
	return finish(fail('final release summary mismatch: expected '+finalExpected+', got '+finalShown.join(',')));

return finish('ok :: silentDuringHold=true; release='+firstExpected+'; depletion=-2 once; final='+finalExpected);
