// Shared collateral-damage router for explosions. Creature families live in
// separate engines (ordinary mobs, invasion squads and block-built mechs), so an
// explosion must explicitly reach all three or one group appears mysteriously
// immune. Callers may skip the family that already applied its local damage.
export function damageBlastCreatures(mm,x,y,r,dmg,opts){
  const root=mm && mm.MM ? mm.MM : mm;
  if(!root) return {mobs:0,invasions:0,mechs:0,total:0};
  const wx=Number(x), wy=Number(y), radius=Number(r), amount=Number(dmg);
  if(!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(radius) || radius<=0 || !Number.isFinite(amount) || amount<=0){
    return {mobs:0,invasions:0,mechs:0,total:0};
  }
  const input=opts && typeof opts==='object' && !Array.isArray(opts) ? opts : {};
  // Callers may add ownership/filter metadata, but this router always describes
  // an actual blast. Do not let a stale copied `kind`/`element` silently turn
  // explosion damage into melee, fire, etc. inside one creature subsystem.
  const shared=Object.assign({},input,{kind:'explosion',element:'blast'});
  if(typeof shared.cause!=='string' || !shared.cause) shared.cause='blast';
  delete shared.skipMobs;
  delete shared.skipInvasions;
  delete shared.skipMechs;
  let mobs=0,invasions=0,mechs=0;
  try{
    if(!input.skipMobs && root.mobs && typeof root.mobs.blastRadius==='function'){
      mobs=Number(root.mobs.blastRadius(wx,wy,radius,amount,shared))||0;
    }
  }catch(e){}
  try{
    if(!input.skipInvasions && root.invasions && typeof root.invasions.blastRadius==='function'){
      invasions=Number(root.invasions.blastRadius(wx,wy,radius,amount,shared))||0;
    }
  }catch(e){}
  try{
    if(!input.skipMechs && root.mechs && typeof root.mechs.blastRadius==='function'){
      mechs=Number(root.mechs.blastRadius(wx,wy,radius,amount,shared))||0;
    }
  }catch(e){}
  mobs=Number.isFinite(mobs) && mobs>0 ? Math.floor(mobs) : 0;
  invasions=Number.isFinite(invasions) && invasions>0 ? Math.floor(invasions) : 0;
  mechs=Number.isFinite(mechs) && mechs>0 ? Math.floor(mechs) : 0;
  return {mobs,invasions,mechs,total:mobs+invasions+mechs};
}

export default damageBlastCreatures;
