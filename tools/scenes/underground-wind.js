const fail = message => 'FAIL :: ' + message;
if(!window.MM || !window.player || !MM.wind || !MM.world || !MM.worldGen)
  return fail('wind/world APIs did not finish booting');

MM.wind.reset();
MM.wind.setOverride(7.2);
const x=Math.floor(player.x);
const surface=MM.worldGen.surfaceHeight(x);
const original={x:player.x,y:player.y,vx:player.vx,vy:player.vy,onGround:player.onGround};

try{
  // Directly exercise the real browser runtime with the strongest supported gale.
  player.x=x+0.5;
  player.y=surface+8;
  player.vx=1.5;
  player.vy=-8;
  player.onGround=false;
  const before=player.vx;
  const result=MM.wind.applyToHero(player,1,MM.world.getTile,{inWater:false});
  if(result.applied || !result.underground || player.vx!==before)
    return fail('maximum gale changed underground hero velocity: '+JSON.stringify({before,after:player.vx,result,surface,y:player.y}));

  player.y=surface-2;
  player.vx=0;
  const exposed=MM.wind.applyToHero(player,1/60,MM.world.getTile,{inWater:false});
  if(!exposed.applied || !(player.vx>0))
    return fail('surface control sample did not catch the same gale: '+JSON.stringify(exposed));

  return 'ok :: undergroundDelta=0; surfaceDelta='+exposed.delta.toFixed(3)+'; gale='+MM.wind.speed().toFixed(1);
} finally {
  Object.assign(player,original);
  MM.wind.reset();
}
