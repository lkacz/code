const fail=message=>'FAIL :: '+message;
for(let i=0;i<300&&!(window.MM&&window.player&&MM.tasks&&MM.engagement);i++) await sleep(50);
if(!(window.MM&&window.player&&MM.tasks&&MM.engagement)) return fail('engagement systems did not boot');
document.querySelector('#titleScreen .tsPrimary')?.click();
await sleep(1300);

const craft=document.getElementById('craft');
const taskPanel=document.getElementById('taskPanel');
if(taskPanel&&taskPanel.hidden===false) taskPanel.click();
await sleep(220);

const active=MM.tasks.activeList(player);
const story=active.find(task=>task.source==='story');
const hypothesis=active.find(task=>task.source==='hypothesis');
const feed=MM.smartFeed&&MM.smartFeed.state&&MM.smartFeed.state();
const list=document.getElementById('taskList');
const panelRect=taskPanel&&taskPanel.getBoundingClientRect();
const listRect=document.getElementById('taskListPanel')?.getBoundingClientRect();
const checks={
  craftStartsClosed:craft?.dataset.collapsed==='true',
  activeLab:!!story&&/Laboratorium/.test(story.title),
  contextualHypothesis:!!hypothesis&&!!hypothesis.progress,
  focusedFeed:feed?.focusMode==='onboarding',
  twoIntentions:!document.getElementById('hypothesisStatus')?.hidden,
  structuredList:!!list?.querySelector('.taskProgressBar')&&!!list?.querySelector('.taskChips'),
  noTopOverlap:!!panelRect&&!!listRect&&listRect.top>=panelRect.bottom
};
return (Object.values(checks).every(Boolean)?'ok':fail('opening engagement contract'))+' :: '+JSON.stringify({
  checks,
  story:story&&story.title,
  hypothesis:hypothesis&&hypothesis.title,
  active:active.map(task=>task.id),
  feedMode:feed&&feed.focusMode
});
