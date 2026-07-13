const fail = message => 'FAIL :: ' + message;
const winter = window.MM && window.MM.atomicWinter;
const panel = document.getElementById('atomicWinterTimerPanel');
const value = document.getElementById('atomicWinterTimerValue');
if(!winter || !panel || !value) return fail('atomic winter timer API or DOM is missing');

const read = () => ({ hidden:panel.hidden, text:value.textContent, title:panel.title });
const waitHud = async () => { await sleep(420); return read(); };

winter.trigger({ x:player.x, y:player.y, player });
let shown = await waitHud();
if(shown.hidden) return fail('timer stayed hidden after trigger');
if(!/^1:39:5\d$|^1:40:00$/.test(shown.text)) return fail('unexpected start value: ' + shown.text);

const snap = winter.snapshot();
winter.restore({ ...snap, active:true, tLeft:65.2 });
const restored = await waitHud();
if(restored.hidden || !/^0:01:0[56]$/.test(restored.text)) return fail('restore did not show the saved 65.2 seconds: ' + JSON.stringify(restored));

winter.reset();
const cleared = await waitHud();
if(!cleared.hidden) return fail('timer stayed visible after reset');

winter.restore({ ...snap, active:true, tLeft:0.1 });
winter.update(0.2,player,()=>0);
const expired = await waitHud();
if(!expired.hidden) return fail('timer stayed visible after the event expired');

winter.restore({ ...snap, active:true, tLeft:3723 });
const final = await waitHud();
if(final.hidden || !/^1:02:0[23]$/.test(final.text)) return fail('final preview timer is wrong: ' + JSON.stringify(final));
const progress=parseFloat(panel.style.getPropertyValue('--atomic-winter-progress'));
if(!(progress>0 && progress<100)) return fail('timer progress fill is invalid: ' + progress);
if(!panel.getAttribute('aria-label').includes(final.text)) return fail('accessible timer label is stale');
if(innerWidth<=760){
	const timerRect=panel.getBoundingClientRect();
	const craftRect=document.getElementById('craft').getBoundingClientRect();
	if(craftRect.top<timerRect.bottom+8) return fail('mobile craft panel overlaps the timer');
}

return 'ok :: start=' + shown.text + '; restored=' + restored.text + '; final=' + final.text + '; hiddenAfterReset=' + cleared.hidden + '; hiddenAfterExpiry=' + expired.hidden;
