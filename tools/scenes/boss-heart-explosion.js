const fail = message => 'FAIL :: ' + message;

if(!window.MM || !window.player || !MM.world || !MM.bosses)
  return fail('boss/world APIs did not finish booting');

const getTile = (x,y) => MM.world.getTile(x,y);
const setTile = (x,y,tile) => MM.world.setTile(x,y,tile);
const blastCalls = [];
const restores = [];
const xpEvents = [];
const bossEvents = [];
const xpHandler = event => xpEvents.push(event && event.detail ? event.detail : {});
const bossHandler = event => bossEvents.push(event && event.detail ? event.detail : {});
window.addEventListener('mm-xp-awarded',xpHandler);
window.addEventListener('mm-boss-killed',bossHandler);

// Observe the real integration boundary while preserving each creature engine's
// normal blast behavior. This catches a future regression where boss explosions
// reach ordinary mobs but silently skip squads or mechs.
for(const family of ['mobs','invasions','mechs']){
  const api = MM[family];
  if(!api || typeof api.blastRadius !== 'function')
    return fail(family+'.blastRadius is unavailable');
  const original = api.blastRadius;
  api.blastRadius = function(x,y,r,damage,options){
    blastCalls.push({family,x,y,r,damage,options:Object.assign({},options)});
    return original.apply(this,arguments);
  };
  restores.push(() => { api.blastRadius = original; });
}

const originalMsg = window.msg;
const messages = [];
window.msg = function(text){
  messages.push(String(text));
  return typeof originalMsg === 'function' ? originalMsg.apply(this,arguments) : undefined;
};
restores.push(() => { window.msg = originalMsg; });

let verdict;
try{
  MM.bosses.clearAll();
  const spawnX = Math.round(player.x + 18);
  const monster = MM.bosses.forceSpawn(getTile,{x:spawnX,seed:0x4b1d5eed,freeze:true});
  if(!monster) verdict = fail('could not force-spawn a boss near the hero');
  else {
    // Keep the detonation in the camera but outside its hero-damage radius.
    player.x = monster.x - 18;
    player.vx = 0;
    player.vy = 0;
    const xpBefore = Number(player.xp)||0;
    const killedName = MM.bosses.killNearest(getTile,setTile);
    if(!killedName || !monster.dying || !monster.heartItem)
      verdict = fail('the real boss death path did not detach its heart');
    else {
      const start = {x:monster.heartItem.x,y:monster.heartItem.y};
      let minY=start.y, maxY=start.y, sawFalling=false;
      let last = Object.assign({},start);
      for(let i=0; i<800 && !monster.dead; i++){
        MM.bosses.update(getTile,setTile,0.05);
        if(monster.heartItem){
          last={x:monster.heartItem.x,y:monster.heartItem.y};
          minY=Math.min(minY,last.y);
          maxY=Math.max(maxY,last.y);
          if(monster.heartItem.vy>0.2) sawFalling=true;
        }
      }
      const xpAfter = Number(player.xp)||0;
      const xpDelta = xpAfter-xpBefore;
      const bossEvent = bossEvents.find(event => event && event.name===killedName);
      const xpEvent = xpEvents.find(event => event && event.source==='boss');
      const routed = new Set(blastCalls.map(call => call.family));
      const badMetadata = blastCalls.find(call => !call.options
        || call.options.kind!=='explosion' || call.options.cause!=='boss_blast');
      const xpMessage = messages.find(text => /Nagroda:\s*\+\d+\s*XP/i.test(text));
      const eventDistance = bossEvent
        ? Math.hypot(Number(bossEvent.x)-last.x,Number(bossEvent.y)-last.y)
        : Infinity;

      if(!monster.dead) verdict = fail('heart agony did not reach the final explosion');
      else if(!sawFalling || maxY-minY<0.25)
        verdict = fail('detached heart did not visibly fall under gravity');
      else if(routed.size!==3 || !routed.has('mobs') || !routed.has('invasions') || !routed.has('mechs'))
        verdict = fail('boss blast missed a creature family: '+Array.from(routed).join(','));
      else if(badMetadata)
        verdict = fail('boss blast lost explosion metadata for '+badMetadata.family);
      else if(!(xpDelta>0) || !xpEvent || Number(xpEvent.amount)!==xpDelta)
        verdict = fail('XP event did not match the player XP gain: delta='+xpDelta);
      else if(!bossEvent || Number(bossEvent.xp)!==xpDelta || eventDistance>0.05)
        verdict = fail('boss-killed event did not follow the fallen heart/XP reward');
      else if(!xpMessage)
        verdict = fail('boss death message did not state the XP reward');
      else verdict = 'ok :: heartDrop='+(maxY-minY).toFixed(2)
        +'; blast=mobs+invasions+mechs; xp=+'+xpDelta
        +'; eventOffset='+eventDistance.toFixed(3);
    }
  }
} finally {
  for(let i=restores.length-1;i>=0;i--) restores[i]();
  window.removeEventListener('mm-xp-awarded',xpHandler);
  window.removeEventListener('mm-boss-killed',bossHandler);
}

return verdict || fail('scene ended without a verdict');
