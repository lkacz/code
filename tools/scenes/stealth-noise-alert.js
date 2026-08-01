const fail=message=>'FAIL :: '+message;
for(let i=0;i<240 && !(window.MM && window.player && MM.mobs && MM.world && MM.worldGen && MM.noise);i++) await sleep(25);
if(!window.MM || !window.player || !MM.mobs || !MM.world || !MM.worldGen || !MM.noise)
  return fail('perception APIs did not finish booting');

const T=MM.T;
const getTile=MM.world.getTile;
const setTile=MM.world.setTile;
const cx=Math.floor(player.x);
const floor=MM.worldGen.surfaceHeight(cx)-1;

MM.mobs.clearAll();
MM.mobs.freezeSpawns(120000);
MM.noise.reset();
if(MM.companions && MM.companions.reset) MM.companions.reset();
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
if(MM.background && MM.background.importState) MM.background.importState({cycleT:0.31});

for(let x=cx-8;x<=cx+11;x++){
  setTile(x,floor,T.STONE);
  for(let y=floor-6;y<floor;y++) setTile(x,y,T.AIR);
}
const wolf=MM.mobs._debugSpecies().WOLF;
const deer=MM.mobs._debugSpecies().DEER;
const heroY=floor-(player.h||0.95)*0.5-0.001;
const heroX=cx-5;
const wolfX=cx+1;
const deerX=cx+6;
if(window.__mmDebugHero) window.__mmDebugHero(heroX,heroY);
player.vx=0;
player.vy=0;
player.onGround=true;
player.facing=1;
player.quiet=true;
document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',bubbles:true}));

MM.mobs.deserialize({
  v:6,
  list:[
    {id:'WOLF',x:wolfX,y:floor-(wolf.body.h||1)*0.5-0.001,vx:0,vy:0,hp:wolf.hp,maxHp:wolf.hp,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0},
    {id:'DEER',x:deerX,y:floor-(deer.body.h||1)*0.5-0.001,vx:0,vy:0,hp:deer.hp,maxHp:deer.hp,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}
  ],
  aggro:{mode:'rel',m:{}}
});
MM.mobs.freezeSpawns(120000);

if(MM.ghostBridge){
  MM.ghostBridge.nudgeZoom(2.0);
  MM.ghostBridge.snapCameraToPlayer();
}
for(const id of ['ui','controls','craft']){
  const el=document.getElementById(id);
  if(el) el.style.display='none';
}

// The wolf hears one isolated step and must stop under ?. The deer is far enough
// not to hear it; two separate nearby steps then drive only the deer to ! + flee.
MM.noise.emit(wolfX-2,heroY,'step',1,{actor:'local-hero'});
MM.mobs.update(1/60,player,getTile,setTile);
let states=MM.mobs.ghostRoster().poses.map(p=>p[10]);
if(states[0]!==2 || states[1]!==0) return fail('first sound did not isolate vigilance: '+states.join(','));

MM.noise.tick(0.1);
MM.noise.emit(deerX+2,heroY,'step',1,{actor:'local-hero'});
MM.mobs.update(1/60,player,getTile,setTile);
MM.noise.tick(0.1);
MM.noise.emit(deerX+2,heroY,'step',1,{actor:'local-hero'});
MM.mobs.update(1/60,player,getTile,setTile);
states=MM.mobs.ghostRoster().poses.map(p=>p[10]);
const saved=MM.mobs.serialize().list;
if(states[0]!==2 || states[1]!==3) return fail('vigilance/recognition states diverged: '+states.join(','));
if(saved[0].state!=='listen' || saved[0].facing!==1 || saved[0].vx!==0)
  return fail('question-mark wolf did not hold and listen: '+JSON.stringify(saved[0]));
if(saved[1].state!=='flee_noise' || !(saved[1].vx<0))
  return fail('recognized deer did not flee from the sound: '+JSON.stringify(saved[1]));

await sleep(160);
states=MM.mobs.ghostRoster().poses.map(p=>p[10]);
if(states[0]!==2 || states[1]!==3) return fail('badges did not remain readable for capture: '+states.join(','));
return 'ok :: first=? CZUWA; repeated=! WYKRYTY; reaction='+saved[1].state;
