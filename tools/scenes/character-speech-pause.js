// Live browser acceptance scene for readable character speech.
const fail = message => 'FAIL :: ' + message;
if(!window.MM || !MM.invasions || !MM.world || !window.player)
  return fail('game APIs did not finish booting');

const getTile=(x,y)=>MM.world.getTile(x,y);
const setTile=(x,y,t)=>MM.world.setTile(x,y,t);
const T=MM.T;
MM.invasions.reset();

const cx=Math.floor(player.x);
const floorY=Math.floor(player.y+player.h/2)+3;
for(let x=cx-8;x<=cx+14;x++){
  for(let y=floorY-7;y<floorY;y++) setTile(x,y,T.AIR);
  setTile(x,floorY,T.STONE);
}
if(window.__mmDebugHero) window.__mmDebugHero(cx,floorY-2);
const craftToggle=document.getElementById('craftToggle');
if(craftToggle && document.getElementById('craft')?.dataset.collapsed!=='true') craftToggle.click();

const spawned=MM.invasions.forceNightInvasion(player,getTile,setTile,{
  day:6, teams:1, kind:'aliens', alienCount:1, forceVisible:true, immediate:true
});
const team=spawned && spawned[0];
const unit=team && team.aliens && team.aliens[0];
if(!unit) return fail('could not create a visible alien speaker');

unit.x=cx+2.5;
unit.y=floorY-1;
unit.vx=0;
unit.vy=0;
unit.onGround=true;
unit._ai={intent:{moveX:1,speedMult:1,jump:false,jumpBoost:1,jumpKick:false}};

const longLine='Zatrzymajmy się i wyjaśnijmy cały plan przejścia przez podziemny korytarz.';
let at=performance.now();
MM.invasions._debug.setAlienSpeech(unit,longLine,at,{override:true});
const compactLong=MM.invasions._debug.compactSpeechText(longLine);
const oldLong=Math.max(1300,Math.min(2700,1050+compactLong.length*18));
if(!unit.speechLong || Math.abs((unit.speechUntil-at)-oldLong*2)>0.01)
  return fail('long speech was not classified and doubled');
const stoppedX=unit.x;
MM.invasions._debug.updateAlien(unit,team,0.1,{x:cx+30,y:floorY-1,hp:100,maxHp:100},getTile,setTile,{});
if(Math.abs(unit.x-stoppedX)>0.001) return fail('speaker moved during long dialogue');

MM.invasions._debug.updateAlienSpeech(unit,team,unit.speechUntil+1);
unit.vx=0; unit.vy=0; unit.onGround=true;
MM.invasions._debug.updateAlien(unit,team,0.1,{x:cx+30,y:floorY-1,hp:100,maxHp:100},getTile,setTile,{});
if(unit.x<=stoppedX+0.01) return fail('speaker did not resume after dialogue expired');

at=performance.now();
MM.invasions._debug.setAlienSpeech(unit,'Boli!',at,{override:true});
if(unit.speechLong) return fail('brief bark incorrectly stopped movement');
unit.vx=0; unit.vy=0; unit.onGround=true;
const barkX=unit.x;
MM.invasions._debug.updateAlien(unit,team,0.1,{x:cx+30,y:floorY-1,hp:100,maxHp:100},getTile,setTile,{});
if(unit.x<=barkX+0.01) return fail('brief bark interrupted movement');

// Leave a long, stationary line visible for the screenshot.
unit.x=cx+2.5; unit.y=floorY-1; unit.vx=0; unit.vy=0; unit.onGround=true;
at=performance.now();
MM.invasions._debug.setAlienSpeech(unit,longLine,at,{override:true});
await sleep(350);
if(!unit.speechText || !unit.speechLong || performance.now()>=unit.speechUntil)
  return fail('final long bubble did not remain active for rendering');
return 'ok :: long=stationary+2x; expired=resumed; short=moving; visibleMs='+Math.round(unit.speechUntil-performance.now());
