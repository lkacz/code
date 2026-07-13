// Browser acceptance scene: switching shortcut slots must not rotate their content.
const fail = message => 'FAIL :: ' + message;
if(!window.MM || !MM.inventory || !window.player) return fail('inventory did not finish booting');

const INV=MM.inventory;
const craft=document.getElementById('craft');
if(craft && craft.dataset.collapsed!=='true') document.getElementById('craftToggle')?.click();
const alpha={id:'qa_slot_alpha',kind:'weapon',weaponType:'melee',name:'Ostrze Alfa',attackDamage:50};
const beta={id:'qa_slot_beta',kind:'weapon',weaponType:'melee',name:'Ostrze Beta',attackDamage:40};
if(!INV.grantItem(alpha,{markNew:false}) || !INV.grantItem(beta,{markNew:false}))
  return fail('could not grant deterministic slot weapons');
inv.tools.stone=true;
player.tool='basic';

const slot=key=>document.querySelector('#weaponBar .wepSlot[data-wkey="'+key+'"]');
const equipped=()=>INV.equippedId('weapon');
const shown=key=>(slot(key)?.querySelector('.wname')?.textContent||'').trim();
if(!slot('1') || !slot('2')) return fail('weapon toolbar slots are missing');

// Tool content follows the same rule: repeated active presses cycle, returning
// from a weapon merely restores the remembered pickaxe.
slot('1').click();
if(player.tool!=='stone') return fail('repeated active tool press did not cycle to stone');
slot('2').click();
if(equipped()!=='qa_slot_alpha') return fail('first melee press did not select strongest weapon');
slot('1').click();
if(player.tool!=='stone') return fail('returning to tools rotated the remembered pickaxe');
slot('2').click();
if(equipped()!=='qa_slot_alpha') return fail('2 -> 1 -> 2 advanced instead of restoring Alpha');

// Repeated presses while slot 2 is active still deliberately rotate.
slot('2').click();
if(equipped()!=='qa_slot_beta') return fail('second consecutive melee press did not rotate');

// Switching away must neither alter the inactive label nor advance on return.
slot('1').click();
if(equipped()!==null) return fail('tool slot did not holster the weapon');
if(shown('2')!=='Ostrze Beta') return fail('inactive melee slot changed content to '+shown('2'));
slot('2').click();
if(equipped()!=='qa_slot_beta') return fail('2 -> 1 -> 2 advanced instead of restoring Beta');

slot('2').click();
if(equipped()==='qa_slot_beta') return fail('repeated active slot press stopped cycling');

// Return the screenshot to the stable remembered state with tools active.
for(let i=0;i<20 && equipped()!=='qa_slot_beta';i++) slot('2').click();
if(equipped()!=='qa_slot_beta') return fail('could not cycle back to Beta');
slot('1').click();
if(shown('2')!=='Ostrze Beta') return fail('final inactive slot preview lost Beta');

return 'ok :: repeated-active=cycles; tools=stone; 2-1-2=Beta; inactive-preview=Beta';
