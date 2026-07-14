const fail = message => 'FAIL :: ' + message;
if(!window.MM || !window.player || !MM.mobs || !MM.worldGen)
  return fail('mob/world APIs did not finish booting');

MM.mobs.clearAll();
MM.mobs.freezeSpawns(120000);
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);

// Find a reasonably level nearby surface so the large silhouette and its skids
// can be judged against actual terrain rather than a synthetic blank canvas.
const origin=Math.round(player.x);
let bx=origin+5.5;
let floor=MM.worldGen.surfaceHeight(Math.floor(bx));
for(let dx=4;dx<=22;dx++){
  const x=origin+dx;
  const ys=[-2,-1,0,1,2].map(offset=>MM.worldGen.surfaceHeight(x+offset));
  const spread=Math.max(...ys)-Math.min(...ys);
  if(spread<=1){ bx=x+0.5; floor=ys[2]; break; }
}
const by=Math.floor(floor)-0.76;
const spec=MM.mobs._debugSpecies().ATOMIC_BOMB;
if(!spec || spec.hp<8000) return fail('atomic bomb toughness is below 8000 HP');

MM.mobs.deserialize({
  v:5,
  list:[{id:'ATOMIC_BOMB',x:bx,y:by,vx:0,vy:0,hp:spec.hp,maxHp:spec.hp,state:'armed',facing:1}],
  aggro:{mode:'rel',m:{}}
});
let saved=MM.mobs.serialize();
let bomb=saved.list.find(m=>m.id==='ATOMIC_BOMB');
if(!bomb) return fail('bomb did not deserialize into the live scene');
const fullHp=bomb.hp;

// One substantial strike must reveal the custom integrity bar and damage marks,
// yet leave most of the long encounter intact.
const hit=MM.mobs.damageAt(Math.floor(bx),Math.floor(by),Math.round(fullHp*0.20),{
  source:'hero',cause:'preview_strike',special:true
});
saved=MM.mobs.serialize();
bomb=saved.list.find(m=>m.id==='ATOMIC_BOMB');
if(!hit || !bomb || bomb.hp<=0 || bomb.hp>fullHp*0.82 || bomb.hp<fullHp*0.75)
  return fail('a 20% strike did not leave the expected durable damaged bomb: '+JSON.stringify(bomb));

const heroFloor=MM.worldGen.surfaceHeight(Math.floor(bx-5));
if(window.__mmDebugHero) window.__mmDebugHero(bx-5,Math.floor(heroFloor)-1);
if(MM.ghostBridge){
  MM.ghostBridge.nudgeZoom(1.72);
  MM.ghostBridge.snapCameraToPlayer();
}
const ui=document.getElementById('ui');
if(ui) ui.style.display='none';
const craft=document.getElementById('craft');
if(craft) craft.style.display='none';

await sleep(700);
return 'ok :: maxHp='+Math.round(fullHp)+'; afterHeavyHit='+Math.round(bomb.hp)
  +'; survived=true; body='+spec.body.w+'x'+spec.body.h;
