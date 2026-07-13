// Runs inside the page. `sleep(ms)` is provided. Return a string; prefix it with
// FAIL to make the driver exit non-zero.
for(let i=0;i<400 && !(window.MM && window.player);i++) await sleep(50);
if(!window.player) return 'FAIL boot-timeout';

// drive the real game: open the pause panel through the real key path
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true}));
await sleep(400);
const paused = !document.getElementById('pausePanel')?.hidden;

// mutate the world through the public API and watch it react
MM.background.importState({cycleT:0.02});   // night
await sleep(600);
return 'ok :: paused=' + paused + ' :: hp=' + player.hp;
