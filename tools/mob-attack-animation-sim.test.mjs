import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');

function has(pattern, message) {
  assert.match(src, pattern, message);
}

has(/const MOB_ATTACK_TELEGRAPH_MS = 420;/, 'shared attack telegraph timing should exist');
has(/function markMobTelegraph\(m,kind,opts\)/, 'mobs need a reusable pre-attack marker');
has(/function markMobAttack\(m,kind,opts\)/, 'mobs need a reusable strike marker');
has(/function mobAttackVisual\(m,spec,now\)/, 'renderer should derive attack state from mob data');
has(/function applyMobAttackPose\(ctx,TILE,spec,screenX,screenY,faceDir,attack\)/, 'renderer should pose attacking mobs');
has(/function drawMobAttackIntent\(ctx,TILE,spec,screenX,screenY,faceDir,phase,attack,hpTop\)/, 'renderer should draw attack intent accents');
has(/const attack=mobAttackVisual\(m,spec,now\);\s*applyMobAttackPose\(ctx,TILE,spec,screenX,screenY,faceDir,attack\);/, 'draw loop should apply attack pose before drawing each mob body');
has(/drawMobAttackIntent\(ctx,TILE,spec,screenX,screenY,faceDir,phase,attack,hpTop\);/, 'draw loop should draw attack accents above each mob body');
has(/markMobAttack\(m,cause,\{target:touchPoint,power:piranhaTouchTarget\?0\.8:1\}\);/, 'contact damage should visibly mark the mob strike');

[
  /function shootAt\(m, target, speed, dmg\)[\s\S]*markMobAttack\(m,'throw',\{target,power:0\.9\}\);/,
  /function sentinelLaserAt\(m,target,dmg,getTile,setTile,lines,damageTarget\)[\s\S]*markMobAttack\(m,'laser',\{target,power:1\.1,strikeMs:300\}\);/,
  /function shootSandWormSpit\(m,target,speed,dmg\)[\s\S]*markMobAttack\(m,'spit',\{target,power:1\.15\}\);/,
  /function shootStoneGolemRock\(m,target,speed,dmg\)[\s\S]*markMobAttack\(m,'throw',\{target,power:1\.25\}\);/,
  /function shootGoldDragonBreath\(m,target,speed,dmg,getTile,setTile\)[\s\S]*spawnExternalStream\('flame'[\s\S]*cause:'gold_dragon_fire'[\s\S]*markMobAttack\(m,'gold_dragon_fire',\{target,power:1\.55,strikeMs:460\}\);/,
  /function shootGoldDwarfPick\(m,target,speed,dmg\)[\s\S]*markMobAttack\(m,'gold_dwarf_pick',\{target,power:1\.05,strikeMs:340\}\);/
].forEach((pattern) => has(pattern, 'ranged mob attacks should trigger attack visuals'));

[
  'vulture_capture',
  'vulture_talon',
  'thunder_bison_charge',
  'jackpot_yeti_slam',
  'jackpot_whale_ram',
  'lake_serpent_shock',
  'giant_scorpion_sting',
  'gold_dragon_claw',
  'gold_dwarf_hammer'
].forEach((cause) => {
  has(new RegExp(`markMobAttack\\(m,'${cause}'`), `${cause} should trigger a visible strike`);
});

[
  /markMobTelegraph\(m,'talon',\{target:player,power:1\.15,ms:900\}\);/,
  /markMobTelegraph\(m,'bite',\{target:player,power:1\.25,ms:420\}\);/,
  /markMobTelegraph\(m,'charge',\{target:player,power:1\.25,ms:650\}\);/,
  /markMobTelegraph\(m,'throw',\{target:player,power:0\.95,ms:640\}\);/,
  /markMobTelegraph\(m,'shock',\{target:player,power:0\.95,ms:540\}\);/,
  /markMobTelegraph\(m,'gold_dwarf_hammer',\{target:player,power:1\.15,ms:420\}\);/
].forEach((pattern) => has(pattern, 'wakeups and windups should telegraph before striking'));
has(/markMobTelegraph\(m,'sentinel_laser',\{target:\{x:aim\.x,y:aim\.y\},power:1\.15,ms:SENTINEL_CHARGE_SECONDS\*1000\}\);/, 'each city sentinel eye-laser should expose its full one-second warning');

has(/case 'GOLD_DRAGON':[\s\S]*const breath=m\.state==='breath'[\s\S]*flameX\+faceDir\*len/, 'gold dragon rendering should visibly show fire breath');
has(/case 'GOLD_DWARF_GUARD':[\s\S]*const hammer=m\.state==='hammer'[\s\S]*ctx\.arc\(screenX\+faceDir\*12,screenY-12,16/, 'gold dwarf rendering should visibly show the hammer swing');

has(/ctx\.fillRect\(headX-faceDir\*3-2,headY-3,4,4\);[\s\S]*ctx\.fillRect\(headX-faceDir\*8-1,headY-1,2,1\);/, 'attack visuals should include clear eye or face expression changes');
has(/ctx\.quadraticCurveTo\(ax\+faceDir\*bw\*0\.22,headY,ax,headY\+bh\*0\.18\);/, 'attack visuals should include a motion arc or slash line');

console.log('mob-attack-animation-sim: all assertions passed');
