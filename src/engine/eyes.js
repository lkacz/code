// Eyes/blink module: handles autonomous blinking timing
// API: MM.eyes.update(nowMs); MM.eyes.getEyeHeight(openHeight, eyeStyle)
import { BLINK_DUR } from '../constants.js';
(function(){
  window.MM = window.MM || {};
  const E = {};
  let blinkStart = 0;
  let blinking = false;
  let nextBlink = performance.now() + 2000 + Math.random()*3000;

  E.update = function(now){
    if(!blinking && now>nextBlink){ blinking=true; blinkStart=now; }
    if(blinking && now>blinkStart+BLINK_DUR){ blinking=false; nextBlink=now+2000+Math.random()*4000; }
  };

  // Returns current eye height given the fully-open height and style
  E.getEyeHeight = function(openHeight, eyeStyle){
    if(eyeStyle==='glow') return openHeight; // glow ignores blink squeeze
    if(!blinking) return openHeight;
    const p = (performance.now() - blinkStart) / BLINK_DUR;
    const tri = p<0.5? (p*2) : (1-(p-0.5)*2);
    const h = Math.max(1, openHeight * (1 - tri));
    return h;
  };

  MM.eyes = E;
})();
// ESM export (progressive migration)
export const eyes = (typeof window!=='undefined' && window.MM) ? window.MM.eyes : undefined;
export default eyes;
