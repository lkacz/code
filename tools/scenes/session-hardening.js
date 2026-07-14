const fail = message => 'FAIL :: ' + message;

if(!window.MM || !MM.tasks || !MM.inventory || !MM.heroLamp || !MM.heroEnergy || !MM.progress || !window.damageHero)
  return fail('game APIs did not finish booting');

// Player menu: exercise the real click handlers and verify the release-facing
// controls that replaced the developer-only toolbox.
const menuButton = document.getElementById('menuBtn');
if(!menuButton) return fail('player menu button is missing');
menuButton.click();
const pausePanel = document.getElementById('pausePanel');
if(!pausePanel || pausePanel.hidden) return fail('player menu did not open');
if(document.activeElement !== pausePanel.querySelector('.pauseResume'))
  return fail('opening the menu did not move focus to Resume');
if(!pausePanel.querySelector('.pauseFullscreenBtn')) return fail('fullscreen control is missing');
const fullscreenButton = document.getElementById('fullscreenBtn');
if(!MM.fullscreen || typeof MM.fullscreen.toggle!=='function' || typeof MM.fullscreen.active!=='function')
  return fail('fullscreen integration API is missing');
if(!fullscreenButton || fullscreenButton.getAttribute('aria-pressed')!==String(MM.fullscreen.active()))
  return fail('fullscreen HUD control is missing or out of sync');
if(!pausePanel.querySelector('#newWorldSeedInput')) return fail('new-world seed control is missing');
if(!pausePanel.querySelector('.pauseDanger')) return fail('new-world action is missing');
if(!pausePanel.querySelector('#playerSaveMenu')) return fail('save controls are missing');
pausePanel.querySelector('.pauseResume').click();
if(!pausePanel.hidden || document.activeElement !== menuButton)
  return fail('closing the menu did not restore state/focus');

// Eye lamp: charge the real hero energy service, toggle through the flashlight
// button, then prove the model consumes energy while lit.
MM.lighting.config.enabled = true;
MM.heroEnergy.add(50, {silent:true});
const lampButton = document.getElementById('lampBtn');
if(!lampButton) return fail('flashlight button is missing');
lampButton.click();
if(!MM.heroLamp.isOn() || lampButton.getAttribute('aria-pressed') !== 'true')
  return fail('flashlight button did not enable the eye lamp');
const energyBefore = MM.heroEnergy.info().energy;
for(let i=0; i<10; i++) MM.heroLamp.update(0.1, MM.heroEnergy);
const energyAfter = MM.heroEnergy.info().energy;
if(!(energyAfter < energyBefore)) return fail('eye lamp did not consume hero energy');
lampButton.click();
if(MM.heroLamp.isOn() || lampButton.getAttribute('aria-pressed') !== 'false')
  return fail('flashlight button did not disable the eye lamp');

// Toughness: exercise the real central damage handler, including its shared
// defense-bypass family, rather than only inspecting the progression numbers.
const progressBefore = MM.progress.snapshot();
const heroBefore = {hp:player.hp,hpInvul:player.hpInvul,hurtFlashUntil:player.hurtFlashUntil,vx:player.vx,vy:player.vy};
MM.progress.restore(Object.assign({},progressBefore,{hard:5}));
player.hp=player.maxHp; player.hpInvul=0; player.vx=0; player.vy=0;
const hpBeforeBlockable=player.hp;
if(!window.damageHero(4,{cause:'qa_hit',invulMs:1,kb:0,kbY:0})) return fail('blockable Toughness test hit was refused');
const blockableLoss=hpBeforeBlockable-player.hp;
player.hpInvul=0;
const hpBeforeBypass=player.hp;
if(!window.damageHero(4,{cause:'qa_bypass',defenseBypass:true,invulMs:1,kb:0,kbY:0})) return fail('bypass Toughness test hit was refused');
const bypassLoss=hpBeforeBypass-player.hp;
MM.progress.restore(progressBefore);
Object.assign(player,heroBefore);
if(Math.abs(blockableLoss-3.4)>0.02 || Math.abs(bypassLoss-4)>0.02)
  return fail('Toughness damage math mismatch: blockable='+blockableLoss+', bypass='+bypassLoss);

// Tasks: open the real list, select a far task as priority, verify that it owns
// the tracked red-arrow target, then discard another task from the same panel.
MM.tasks.reset();
const px = window.player.x;
const py = window.player.y;
MM.tasks.upsert({id:'qa:near', source:'qa', title:'Bliski cel', priority:20, target:{x:px+3,y:py}});
MM.tasks.upsert({id:'qa:far', source:'qa', title:'Priorytet QA', priority:1, target:{x:px+80,y:py}});
MM.tasks.updateHud(window.player);
const taskButton = document.getElementById('taskPanel');
taskButton.click();
const taskListPanel = document.getElementById('taskListPanel');
if(taskListPanel.hidden || document.querySelectorAll('#taskList .taskItem').length !== 2)
  return fail('task list did not show every active task');
document.querySelector('#taskList .taskPriority[data-task-id="qa:far"]').click();
const tracked = MM.tasks.trackedTarget(window.player);
if(MM.tasks.metrics().priorityId !== 'qa:far' || !tracked || !tracked.task || tracked.task.id !== 'qa:far')
  return fail('priority task did not take over the tracked red arrow');
document.querySelector('#taskList .taskDiscard[data-task-id="qa:near"]').click();
const taskState = MM.tasks.state();
if(taskState.active.length !== 1 || taskState.discarded.length !== 1 || taskState.discarded[0].id !== 'qa:near')
  return fail('discarding a task did not update the task lists');

// Loot notices: three genuine upgrades must coexist. Dismissing one must remove
// only that card and leave the other two visible for the captured screenshot.
const upgrades = [
  {id:'qa_cape_upgrade',kind:'cape',name:'Peleryna QA',tier:'epic',airJumps:20},
  {id:'qa_eyes_upgrade',kind:'eyes',name:'Oczy QA',tier:'epic',visionRadius:80},
  {id:'qa_outfit_upgrade',kind:'outfit',name:'Strój QA',tier:'epic',mineSpeedMult:5}
];
for(const item of upgrades){
  if(!MM.inventory.grantItem(item,{markNew:true})) return fail('could not grant '+item.id);
}
const gained = MM.onLootGained(upgrades.map(item=>MM.inventory.getItem(item.id)));
const noticeHost = document.getElementById('upgradeNotice');
if(gained !== 3 || noticeHost.querySelectorAll('.upgradeNotice').length !== 3)
  return fail('upgrade notices did not stack');
noticeHost.querySelector('.upLater').click();
if(noticeHost.querySelectorAll('.upgradeNotice').length !== 2 || !noticeHost.classList.contains('show'))
  return fail('dismissing one upgrade replaced or hid the remaining cards');

return 'ok :: menu=player controls; lampDrain='+(energyBefore-energyAfter).toFixed(2)
  +'; toughness=3.4/4; tasks=1 active/1 discarded/priority qa:far; upgradeCards=2';
