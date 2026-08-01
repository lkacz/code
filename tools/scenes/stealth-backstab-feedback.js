const fail=message=>'FAIL :: '+message;
for(let i=0;i<240 && !(window.MM && window.player && MM.mobs && MM.world && MM.worldGen);i++) await sleep(25);
if(!window.MM || !window.player || !MM.mobs || !MM.world || !MM.worldGen || !MM.noise)
  return fail('combat/perception APIs did not finish booting');

const T=MM.T;
const getTile=MM.world.getTile;
const setTile=MM.world.setTile;
const cx=Math.floor(player.x);
const floor=MM.worldGen.surfaceHeight(cx)-1;

MM.mobs.clearAll();
MM.mobs.freezeSpawns(120000);
if(MM.companions && MM.companions.reset) MM.companions.reset();
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.31});

// A flat real-world stage: the near wolf receives the backstab while the second
// one keeps the cyan ready marker, so one frame demonstrates both sides of the
// stealth loop without using a fake overlay.
for(let x=cx-5;x<=cx+11;x++){
  setTile(x,floor,T.STONE);
  for(let y=floor-6;y<floor;y++) setTile(x,y,T.AIR);
}
const wolf=MM.mobs._debugSpecies().WOLF;
const heroY=floor-(player.h||0.95)*0.5-0.001;
const mobY=floor-(wolf.body.h||1)*0.5-0.001;
const heroX=cx+0.2;
const nearX=cx+1.55;
const farX=cx+5.2;
if(window.__mmDebugHero) window.__mmDebugHero(heroX,heroY);
player.vx=0;
player.vy=0;
player.onGround=true;
player.facing=1;
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',bubbles:true}));
player.quiet=true;

MM.mobs.deserialize({
  v:6,
  list:[
    {id:'WOLF',x:nearX,y:mobY,vx:0,vy:0,hp:wolf.hp,maxHp:wolf.hp,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0},
    {id:'WOLF',x:farX,y:mobY,vx:0,vy:0,hp:wolf.hp,maxHp:wolf.hp,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}
  ],
  aggro:{mode:'rel',m:{}}
});
MM.mobs.freezeSpawns(120000);

if(MM.ghostBridge){
  MM.ghostBridge.nudgeZoom(2.0);
  MM.ghostBridge.snapCameraToPlayer();
}
const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
const controls=document.getElementById('controls'); if(controls) controls.style.display='none';
const craft=document.getElementById('craft'); if(craft) craft.style.display='none';

MM.mobs.update(1/60,player,getTile,setTile);
const immediate=MM.mobs.ghostRoster().poses.map(p=>p[10]);
if(immediate[0]!==1 || immediate[1]!==1) return fail('first perception frame did not arm: '+JSON.stringify({immediate,hero:{x:player.x,y:player.y,quiet:player.quiet,onGround:player.onGround},poses:MM.mobs.ghostRoster().poses}));
if(MM.mobs.ghostRoster().poses.some(p=>p[2]!==1)){
  const raw=[];
  MM.mobs.forEachLive(m=>raw.push({vx:m.vx,vy:m.vy,facing:m.facing,stable:m._stableFacing,state:m.state,ghostSpook:m._ghostSpookUntil,progressionFlee:m._progressionFlee,nature:m._natureDrive}));
  return fail('post-perception systems changed facing on frame one: '+JSON.stringify(raw));
}
await sleep(180);
const ready=MM.mobs.ghostRoster().poses.map(p=>p[10]);
if(ready[0]!==1 || ready[1]!==1){
  const raw=[];
  MM.mobs.forEachLive(m=>raw.push({x:m.x,y:m.y,vx:m.vx,vy:m.vy,facing:m.facing,stable:m._stableFacing,pending:m._pendingFacing,noticed:m._noticed,aggro:m._aggro,progressionFlee:m._progressionFlee,state:m.state,awareness:m._awarenessUi}));
  return fail('rear stealth markers did not arm: '+JSON.stringify({ready,hero:{x:player.x,y:player.y,vx:player.vx,vy:player.vy,quiet:player.quiet,onGround:player.onGround,bodyQuiet:MM.noise.bodyQuiet(player)},mobs:raw}));
}

const hit=MM.mobs.attackAt(Math.floor(nearX),Math.floor(mobY),0,{source:'hero',kind:'melee',x:player.x,y:player.y});
if(!hit) return fail('backstab did not reach the near wolf');
await sleep(260);

const saved=MM.mobs.serialize().list;
const states=MM.mobs.ghostRoster().poses.map(p=>p[10]);
const loss=wolf.hp-saved[0].hp;
const expected=3*MM.noise.CFG.BACKSTAB_MULT;
if(Math.abs(loss-expected)>0.02) return fail('wrong rear damage: '+loss+' expected '+expected);
if(states[0]!==3 || states[1]!==1) return fail('detection/readiness states diverged: '+JSON.stringify(states));

return 'ok :: backstab='+loss.toFixed(2)+'; expected='+expected.toFixed(2)+'; awareness='+states.join(',');
