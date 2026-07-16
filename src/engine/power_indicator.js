// Shared status lamp for placed energy generators. The state deliberately
// represents live generation, not energy that merely remains in a buffer.
export function isEnergyGenerating(power, externallyCharged=false){
  return Number.isFinite(Number(power)) && Number(power)>0.001 && !externallyCharged;
}

export function drawEnergyGenerationLamp(ctx,TILE,px,py,generating,pulse=0){
  if(!ctx || !Number.isFinite(TILE) || TILE<=0) return;
  const on=!!generating;
  const beat=on ? Math.max(0,Math.min(1,Number(pulse)||0)) : 0;
  const cx=px+TILE*0.78;
  const cy=py+TILE*0.22;
  const bezelR=Math.max(2.6,TILE*0.125);
  const lampR=Math.max(1.6,TILE*0.073);
  const color=on ? '#59ff73' : '#ff4f58';

  ctx.save();
  ctx.globalCompositeOperation='source-over';

  // An explicit additive halo is substantially cheaper than canvas shadows
  // when a large solar array fills the screen.
  if(on){
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=0.18+beat*0.12;
    ctx.fillStyle='rgba(78,255,111,0.92)';
    ctx.beginPath();
    ctx.arc(cx,cy,TILE*(0.16+beat*0.035),0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
  }

  // Recessed metal bezel keeps both states legible on bright machinery.
  ctx.fillStyle='rgba(3,8,11,0.94)';
  ctx.beginPath();
  ctx.arc(cx,cy,bezelR,0,Math.PI*2);
  ctx.fill();
  ctx.strokeStyle='rgba(198,225,230,0.72)';
  ctx.lineWidth=Math.max(1,TILE*0.025);
  ctx.stroke();

  // Green breathes while power is being made; idle red stays steady.
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.arc(cx,cy,lampR*(on ? 1+beat*0.08 : 1),0,Math.PI*2);
  ctx.fill();

  // A small specular highlight makes the lamp read as a physical LED.
  ctx.globalAlpha=on ? 0.94 : 0.72;
  ctx.fillStyle='#ffffff';
  ctx.beginPath();
  ctx.arc(cx-lampR*0.30,cy-lampR*0.32,Math.max(0.65,lampR*0.24),0,Math.PI*2);
  ctx.fill();
  ctx.restore();
}
