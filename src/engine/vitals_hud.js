// Vitals HUD: the bottom-left hero status cluster (HP / energy / level+XP /
// buffs) rendered as one cohesive glass panel with game-industry-standard
// feedback: smoothly tweened fills, a Souls-style "damage chip" ghost bar that
// lingers and drains, heal/charge shimmer sweeps, low-HP heartbeat pulse with
// screen-edge vignette, floating +/- damage numbers, a level badge with a
// level-up ring burst, a pulsing skill-point pill and buff chips with
// remaining-duration rings.
//
// Split in two so the feel is testable headless (tools/vitals-hud-sim.test.mjs):
//   createVitalsModel() — pure animation state machine, update(inputs, dt)
//   vitalsHud.draw(ctx, opts) — canvas renderer driven by the shared model
window.MM = window.MM || {};

// --- animation model ---------------------------------------------------------
// All fills/chips are fractions [0..1]; deltas carry raw HP amounts.
const CHIP_HOLD_S = 0.35;      // damage chip freeze before draining
const CHIP_DRAIN_RATE = 7;     // exp approach rate of chip → fill
const FILL_DROP_RATE = 18;     // fill approach when losing (snappy)
const FILL_RISE_RATE = 8;      // fill approach when gaining (smooth)
const EN_CHIP_HOLD_S = 0.15;   // energy spends read faster than damage
const DISCRETE_DROP_FRAC = 0.008; // per-frame loss that counts as a "hit" —
// slow ambient drains (survival, beam upkeep) must NOT refresh the chip hold
// or the ghost bar freezes at the highest fill ever seen and never drains
const DELTA_LIFE_S = 1.1;      // floating damage number lifetime
const DELTA_MERGE_S = 0.3;     // rapid hits merge into one number
const XP_DELTA_LIFE_S = 1.35;  // floating XP award lifetime
const XP_DELTA_MERGE_S = 0.25; // rapid mob awards merge into one number
const LOW_HP_FRAC = 0.3;       // heartbeat pulse threshold
const LVL_BURST_S = 0.8;       // level-up ring burst duration
const BUFF_EXPIRING_S = 10;    // buff chips turn urgent below this

export function createVitalsModel(){
	const st={
		ready:false,
		pulseT:0,
		hp:{ fill:0, chip:0, holdT:0, shimmer:0, low:false, lowPulse:0, frac:0 },
		en:{ fill:0, chip:0, holdT:0, chargeHold:0, charging:false, full:false, frac:0 },
		xp:{ fill:0, lvlBurst:0, level:1 },
		deltas:[],
		xpDeltas:[],
		buffs:[]
	};
	let lastHp=0, lastEn=0, pendingHealDelta=0;
	const buffMax=new Map();

	function approach(cur,target,rate,dt){ return cur+(target-cur)*(1-Math.exp(-rate*dt)); }
	function frac(v,max){ return max>0? Math.max(0,Math.min(1,v/max)) : 0; }

	function pushDelta(dv){
		const last=st.deltas[st.deltas.length-1];
		if(last && last.t<DELTA_MERGE_S && (last.v<0)===(dv<0)){ last.v+=dv; last.t=0; return; }
		st.deltas.push({v:dv,t:0});
		if(st.deltas.length>4) st.deltas.shift();
	}
	function pushXpDelta(detail){
		const raw=(detail && typeof detail==='object') ? detail.amount : detail;
		const amount=Math.round(Number(raw)||0);
		if(amount<=0) return false;
		const special=!!(detail && typeof detail==='object' && detail.special);
		const fatigueMult=(detail && typeof detail==='object' && Number.isFinite(Number(detail.fatigueMult))) ? Number(detail.fatigueMult) : 1;
		const last=st.xpDeltas[st.xpDeltas.length-1];
		if(last && last.t<XP_DELTA_MERGE_S && last.special===special){
			last.v+=amount;
			last.t=0;
			last.fatigueMult=Math.min(last.fatigueMult||1,fatigueMult);
			return true;
		}
		st.xpDeltas.push({v:amount,t:0,special,fatigueMult});
		if(st.xpDeltas.length>4) st.xpDeltas.shift();
		return true;
	}

	function update(inp,dt){
		dt=Math.max(0,Math.min(0.1,Number(dt)||0));
		const hp=Number(inp.hp)||0, maxHp=Number(inp.maxHp)||0;
		const en=Number(inp.en)||0, enMax=Number(inp.enMax)||0;
		const level=Math.max(1,Number(inp.level)||1);
		const tHp=frac(hp,maxHp), tEn=frac(en,enMax);
		const tXp=frac(inp.xpInto,inp.xpNeed);
		if(!st.ready){
			// first sample snaps everything so a fresh HUD never plays intro tweens
			st.ready=true; lastHp=hp; lastEn=en;
			st.hp.fill=st.hp.chip=tHp; st.en.fill=st.en.chip=tEn;
			st.xp.fill=tXp; st.xp.level=level;
		}
		st.pulseT+=dt;

		// HP: a discrete hit freezes the chip at the pre-hit fill; it holds, then
		// drains toward the fill. Trickle losses just pull the fill (chip follows).
		const dvHp=hp-lastHp;
		if(dvHp<=-1){
			pendingHealDelta=0;
			pushDelta(dvHp);
		}else if(dvHp>0){
			pendingHealDelta+=dvHp;
			if(dvHp>=1 || pendingHealDelta>=1){
				pushDelta(pendingHealDelta);
				pendingHealDelta=0;
			}
		}else if(dvHp<0){
			pendingHealDelta=0;
		}
		if(maxHp>0 && -dvHp/maxHp>=DISCRETE_DROP_FRAC){
			st.hp.chip=Math.max(st.hp.chip,st.hp.fill);
			st.hp.holdT=CHIP_HOLD_S;
		}
		if(tHp<st.hp.fill-1e-4){
			st.hp.fill=approach(st.hp.fill,tHp,FILL_DROP_RATE,dt);
		}else{
			if(dvHp>=1) st.hp.shimmer=1;
			st.hp.fill=approach(st.hp.fill,tHp,FILL_RISE_RATE,dt);
		}
		if(st.hp.holdT>0) st.hp.holdT-=dt;
		else st.hp.chip=approach(st.hp.chip,st.hp.fill,CHIP_DRAIN_RATE,dt);
		if(st.hp.chip<st.hp.fill) st.hp.chip=st.hp.fill;
		st.hp.shimmer=Math.max(0,st.hp.shimmer-dt/0.45);
		st.hp.low=tHp>0 ? tHp<=LOW_HP_FRAC : false;
		if(st.hp.low){
			const urgency=1+(LOW_HP_FRAC-tHp)/LOW_HP_FRAC; // beats faster as HP sinks
			st.hp.lowPulse=(st.hp.lowPulse+dt*2.2*urgency)%1;
		}else st.hp.lowPulse=0;
		st.hp.frac=tHp;

		// Energy: same chip idea but faster, plus a "charging" flag for the renderer
		if(en>lastEn+0.01) st.en.chargeHold=0.3;
		st.en.chargeHold=Math.max(0,st.en.chargeHold-dt);
		st.en.charging=st.en.chargeHold>0;
		if(enMax>0 && (lastEn-en)/enMax>=DISCRETE_DROP_FRAC){
			st.en.chip=Math.max(st.en.chip,st.en.fill);
			st.en.holdT=EN_CHIP_HOLD_S;
		}
		if(tEn<st.en.fill-1e-4){
			st.en.fill=approach(st.en.fill,tEn,FILL_DROP_RATE,dt);
		}else{
			st.en.fill=approach(st.en.fill,tEn,FILL_RISE_RATE+2,dt);
		}
		if(st.en.holdT>0) st.en.holdT-=dt;
		else st.en.chip=approach(st.en.chip,st.en.fill,CHIP_DRAIN_RATE+3,dt);
		if(st.en.chip<st.en.fill) st.en.chip=st.en.fill;
		st.en.full=tEn>=0.999;
		st.en.frac=tEn;

		// XP: level-up snaps the bar to zero and fires the badge burst
		if(level>st.xp.level){ st.xp.lvlBurst=1; st.xp.fill=0; }
		st.xp.level=level;
		st.xp.lvlBurst=Math.max(0,st.xp.lvlBurst-dt/LVL_BURST_S);
		st.xp.fill=approach(st.xp.fill,tXp,10,dt);

		// floating damage numbers age out
		for(let i=st.deltas.length-1;i>=0;i--){
			st.deltas[i].t+=dt;
			if(st.deltas[i].t>DELTA_LIFE_S) st.deltas.splice(i,1);
		}
		for(let i=st.xpDeltas.length-1;i>=0;i--){
			st.xpDeltas[i].t+=dt;
			if(st.xpDeltas[i].t>XP_DELTA_LIFE_S) st.xpDeltas.splice(i,1);
		}

		// buff rings remember the longest duration seen per buff name
		const buffs=Array.isArray(inp.buffs)? inp.buffs : [];
		const seen=new Set();
		st.buffs.length=0;
		for(const b of buffs){
			const name=String(b.name||'Buff'), t=Math.max(0,Number(b.t)||0);
			seen.add(name);
			const max=Math.max(buffMax.get(name)||0,t);
			buffMax.set(name,max);
			st.buffs.push({name,icon:b.icon||'✦',t,frac:max>0?t/max:0,expiring:t<BUFF_EXPIRING_S});
		}
		for(const k of buffMax.keys()) if(!seen.has(k)) buffMax.delete(k);

		lastHp=hp; lastEn=en;
		return st;
	}
	return { update, state:st, pushXpDelta, noteXpAward:pushXpDelta };
}

// --- canvas renderer ---------------------------------------------------------
const PAD=12;                 // screen margin
const PANEL_W=272, PANEL_R=13;
const IN_X=12, IN_Y=11;       // panel inner padding
const HP_H=20, EN_H=13, BADGE=26, XP_H=8;
const GAP_A=8, GAP_B=9;       // hp→en, en→xp gaps
const PANEL_H=IN_Y+HP_H+GAP_A+EN_H+GAP_B+BADGE+IN_Y;
const FONT='system-ui, "Segoe UI", sans-serif';

const model=createVitalsModel();
let lastNow=0;
const gradCache=new Map();

function noteXpAward(detail){
	return model.noteXpAward(detail);
}
if(typeof window!=='undefined' && window.addEventListener){
	window.addEventListener('mm-xp-awarded',ev=>{ noteXpAward(ev && ev.detail); });
}

function roundedPath(ctx,x,y,w,h,r){
	r=Math.min(r,h/2,w/2);
	ctx.beginPath();
	if(ctx.roundRect){ ctx.roundRect(x,y,w,h,r); return; }
	ctx.moveTo(x+r,y);
	ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
	ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
	ctx.closePath();
}
// gradients are built in bar-local coords (callers translate first) so they cache
function grad(ctx,key,w,h,stops,vertical){
	const k=key+':'+w+'x'+h;
	let g=gradCache.get(k);
	if(!g){
		g=vertical? ctx.createLinearGradient(0,0,0,h) : ctx.createLinearGradient(0,0,w,0);
		for(const [p,c] of stops) g.addColorStop(p,c);
		gradCache.set(k,g);
		if(gradCache.size>64) gradCache.clear();
	}
	return g;
}

function drawHeart(ctx,cx,cy,s,color){
	ctx.save();
	ctx.translate(cx,cy); ctx.scale(s/12,s/12);
	ctx.beginPath();
	ctx.moveTo(0,3.6);
	ctx.bezierCurveTo(-6.4,-1.6,-3.4,-6.4,0,-3.0);
	ctx.bezierCurveTo(3.4,-6.4,6.4,-1.6,0,3.6);
	ctx.closePath();
	ctx.fillStyle=color; ctx.fill();
	ctx.restore();
}
function drawBolt(ctx,cx,cy,s,color){
	ctx.save();
	ctx.translate(cx,cy); ctx.scale(s/12,s/12);
	ctx.beginPath();
	ctx.moveTo(1.6,-6); ctx.lineTo(-3.4,0.8); ctx.lineTo(-0.4,0.8);
	ctx.lineTo(-1.6,6); ctx.lineTo(3.4,-0.8); ctx.lineTo(0.4,-0.8);
	ctx.closePath();
	ctx.fillStyle=color; ctx.fill();
	ctx.restore();
}
function textShadowed(ctx,text,x,y,fill){
	ctx.save();
	ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=2; ctx.shadowOffsetY=1;
	ctx.fillStyle=fill; ctx.fillText(text,x,y);
	ctx.restore();
}

// One capsule bar: trough + chip ghost + gradient fill + gloss + ticks + shimmer
function drawBar(ctx,x,y,w,h,s,opts){
	ctx.save();
	ctx.translate(x,y);
	roundedPath(ctx,0,0,w,h,h/2);
	ctx.fillStyle='rgba(6,8,14,0.72)';
	ctx.fill();
	ctx.save();
	roundedPath(ctx,0,0,w,h,h/2);
	ctx.clip();
	// chip ghost (recent loss) sits under the live fill
	if(s.chip>s.fill+0.002){
		ctx.fillStyle=opts.chipColor;
		ctx.fillRect(0,0,w*s.chip,h);
	}
	if(s.fill>0.001){
		ctx.fillStyle=grad(ctx,opts.key,w,h,opts.stops,false);
		ctx.fillRect(0,0,w*s.fill,h);
		// gloss: light top half sells the capsule volume
		ctx.fillStyle='rgba(255,255,255,0.16)';
		ctx.fillRect(0,0,w*s.fill,h*0.42);
	}
	// segment ticks keep big pools readable at a glance
	if(opts.ticks>1){
		ctx.fillStyle='rgba(0,0,0,0.38)';
		for(let i=1;i<opts.ticks;i++) ctx.fillRect(Math.round(w*i/opts.ticks),1,1,h-2);
	}
	// shimmer sweep on gain
	if(s.shimmer>0){
		const bx=(1-s.shimmer)*(w+40)-20;
		const sg=ctx.createLinearGradient(bx-18,0,bx+18,0);
		sg.addColorStop(0,'rgba(255,255,255,0)');
		sg.addColorStop(0.5,'rgba(255,255,255,'+(0.32*s.shimmer).toFixed(3)+')');
		sg.addColorStop(1,'rgba(255,255,255,0)');
		ctx.fillStyle=sg;
		ctx.fillRect(bx-18,0,36,h);
	}
	ctx.restore();
	roundedPath(ctx,0.5,0.5,w-1,h-1,(h-1)/2);
	ctx.strokeStyle=opts.stroke||'rgba(255,255,255,0.12)';
	ctx.lineWidth=1;
	ctx.stroke();
	ctx.restore();
}

function draw(ctx,o){
	const now=(typeof performance!=='undefined'&&performance.now)? performance.now() : Date.now();
	const dt=lastNow? (now-lastNow)/1000 : 0;
	lastNow=now;
	const lv=o.level||{level:1,into:0,need:60};
	const s=model.update({
		hp:o.hp, maxHp:o.maxHp, en:o.energy, enMax:o.energyMax,
		level:lv.level, xpInto:lv.into, xpNeed:lv.need, buffs:o.buffs
	},dt);
	const px=PAD, py=o.H-PAD-PANEL_H;
	const bw=PANEL_W-IN_X*2;

	ctx.save();
	ctx.textBaseline='alphabetic';

	// low-HP screen vignette (under the panel so it reads as ambience)
	if(s.hp.low && s.hp.frac>0){
		const beat=0.5+0.5*Math.sin(s.hp.lowPulse*Math.PI*2);
		const vg=ctx.createRadialGradient(o.W/2,o.H/2,Math.min(o.W,o.H)*0.38,o.W/2,o.H/2,Math.max(o.W,o.H)*0.72);
		vg.addColorStop(0,'rgba(160,20,20,0)');
		vg.addColorStop(1,'rgba(160,20,20,'+(0.10+0.09*beat).toFixed(3)+')');
		ctx.fillStyle=vg;
		ctx.fillRect(0,0,o.W,o.H);
	}

	// glass panel
	ctx.save();
	ctx.shadowColor='rgba(0,0,0,0.45)'; ctx.shadowBlur=14; ctx.shadowOffsetY=3;
	roundedPath(ctx,px,py,PANEL_W,PANEL_H,PANEL_R);
	ctx.fillStyle='rgba(9,13,21,0.66)';
	ctx.fill();
	ctx.restore();
	roundedPath(ctx,px+0.5,py+0.5,PANEL_W-1,PANEL_H-1,PANEL_R);
	ctx.strokeStyle='rgba(255,255,255,0.10)'; ctx.lineWidth=1; ctx.stroke();

	// --- HP row ---
	const hpY=py+IN_Y;
	if(s.hp.low){
		const beat=0.5+0.5*Math.sin(s.hp.lowPulse*Math.PI*2);
		ctx.save();
		ctx.shadowColor='rgba(255,58,48,'+(0.35+0.45*beat).toFixed(3)+')';
		ctx.shadowBlur=9+7*beat;
		roundedPath(ctx,px+IN_X,hpY,bw,HP_H,HP_H/2);
		ctx.strokeStyle='rgba(255,80,64,'+(0.5+0.4*beat).toFixed(3)+')';
		ctx.lineWidth=1.5; ctx.stroke();
		ctx.restore();
	}
	drawBar(ctx,px+IN_X,hpY,bw,HP_H,s.hp,{
		key:'hp', stops:[[0,'#ff3a34'],[0.55,'#ff6a38'],[1,'#ffa03d']],
		chipColor:'rgba(255,219,178,0.85)',
		ticks:o.maxHp>=50? Math.round(o.maxHp/25) : 0
	});
	{
		const beat=s.hp.low? 1+0.14*(0.5+0.5*Math.sin(s.hp.lowPulse*Math.PI*2)) : 1;
		drawHeart(ctx,px+IN_X+12,hpY+HP_H/2,11*beat,s.hp.low?'#ff6157':'#ff5a4d');
		ctx.font='600 9px '+FONT;
		textShadowed(ctx,'HP',px+IN_X+22,hpY+HP_H/2+3.5,'rgba(255,255,255,0.78)');
		ctx.font='700 11px '+FONT;
		const t=Math.round(o.hp)+' / '+Math.round(o.maxHp);
		textShadowed(ctx,t,px+IN_X+bw-8-ctx.measureText(t).width,hpY+HP_H/2+4,'#fff');
	}

	// --- Energy row ---
	const enY=hpY+HP_H+GAP_A;
	drawBar(ctx,px+IN_X,enY,bw,EN_H,s.en,{
		key:'en', stops:[[0,'#33d9ff'],[0.6,'#3f8dff'],[1,'#5a6bff']],
		chipColor:'rgba(191,234,255,0.8)',
		ticks:o.energyMax>=100? Math.round(o.energyMax/50) : 0,
		stroke:s.en.full? 'rgba(190,240,255,0.45)' : undefined
	});
	drawBolt(ctx,px+IN_X+12,enY+EN_H/2,10,'#7fe7ff');
	{
		ctx.font='600 9px '+FONT;
		textShadowed(ctx,'EN',px+IN_X+21,enY+EN_H/2+3,'rgba(255,255,255,0.75)');
		ctx.font='700 10px '+FONT;
		const t=Math.floor(Math.max(0,Number(o.energy)||0))+' / '+Math.round(o.energyMax);
		textShadowed(ctx,t,px+IN_X+bw-8-ctx.measureText(t).width,enY+EN_H/2+3.5,'#eafaff');
		// charging chevrons crawl at the fill edge while energy rises
		if(s.en.charging && s.en.fill>0.01 && s.en.fill<0.99){
			const ex=px+IN_X+bw*s.en.fill;
			const ph=(s.pulseT*2.4)%1;
			ctx.save();
			for(let i=0;i<2;i++){
				const a=Math.max(0,0.85-Math.abs(((ph+i*0.5)%1)-0.5)*1.7);
				ctx.fillStyle='rgba(255,255,255,'+(a*0.75).toFixed(3)+')';
				const cx0=ex+3+((ph+i*0.5)%1)*10;
				ctx.beginPath();
				ctx.moveTo(cx0,enY+3); ctx.lineTo(cx0+3.4,enY+EN_H/2); ctx.lineTo(cx0,enY+EN_H-3);
				ctx.lineTo(cx0+1.4,enY+EN_H-3); ctx.lineTo(cx0+4.8,enY+EN_H/2); ctx.lineTo(cx0+1.4,enY+3);
				ctx.closePath(); ctx.fill();
			}
			ctx.restore();
		}
	}

	// --- level badge + XP ---
	const xpY=enY+EN_H+GAP_B;
	const badgeX=px+IN_X, badgeY=xpY;
	ctx.save();
	roundedPath(ctx,badgeX,badgeY,BADGE,BADGE,7);
	ctx.fillStyle=grad(ctx,'badge',BADGE,BADGE,[[0,'#f9d54e'],[1,'#c9861d']],true);
	ctx.fill();
	roundedPath(ctx,badgeX+0.5,badgeY+0.5,BADGE-1,BADGE-1,7);
	ctx.strokeStyle='rgba(70,45,6,0.85)'; ctx.lineWidth=1; ctx.stroke();
	ctx.fillStyle='rgba(255,255,255,0.28)';
	ctx.fillRect(badgeX+3,badgeY+2,BADGE-6,2);
	ctx.font='800 '+(lv.level>=100?10:13)+'px '+FONT;
	ctx.textAlign='center';
	ctx.fillStyle='#3a2604';
	ctx.fillText(String(lv.level),badgeX+BADGE/2,badgeY+BADGE/2+4.5);
	ctx.textAlign='left';
	if(s.xp.lvlBurst>0){
		// level-up: golden ring blooms out of the badge
		const k=1-s.xp.lvlBurst;
		ctx.strokeStyle='rgba(255,214,104,'+(0.9*s.xp.lvlBurst).toFixed(3)+')';
		ctx.lineWidth=2.5-1.8*k;
		ctx.beginPath();
		ctx.arc(badgeX+BADGE/2,badgeY+BADGE/2,BADGE*0.55+k*22,0,Math.PI*2);
		ctx.stroke();
	}
	ctx.restore();
	{
		const tx=badgeX+BADGE+9, tw=px+IN_X+bw-tx;
		ctx.font='700 10px '+FONT;
		textShadowed(ctx,'Poz. '+lv.level,tx,badgeY+9,'rgba(255,255,255,0.92)');
		ctx.font='600 9px '+FONT;
		const xt=(lv.into|0)+' / '+(lv.need|0)+' XP';
		textShadowed(ctx,xt,tx+tw-ctx.measureText(xt).width,badgeY+9,'rgba(190,214,255,0.85)');
		const bx=tx, byy=badgeY+BADGE-XP_H-1;
		drawBar(ctx,bx,byy,tw,XP_H,{fill:s.xp.fill,chip:0,shimmer:0},{
			key:'xp', stops:[[0,'#79b6ff'],[1,'#2c7ef8']], chipColor:'rgba(0,0,0,0)', ticks:0
		});
	}

	// --- skill-point pill + buff chips float in a row above the panel ---
	const rowY=py-44; // 36px row + 8px gap to the panel edge
	if((o.points|0)>0){
		ctx.font='700 10px '+FONT;
		const label='+'+(o.points|0)+' pkt';
		const lw=ctx.measureText(label).width;
		const pw=lw+30;
		const pxr=px+PANEL_W-pw;
		const pyr=rowY+8;
		const pul=0.5+0.5*Math.sin(s.pulseT*3.4);
		ctx.save();
		ctx.shadowColor='rgba(246,201,69,'+(0.25+0.3*pul).toFixed(3)+')';
		ctx.shadowBlur=8;
		roundedPath(ctx,pxr,pyr,pw,20,10);
		ctx.fillStyle='rgba(52,38,8,0.88)';
		ctx.fill();
		ctx.restore();
		roundedPath(ctx,pxr+0.5,pyr+0.5,pw-1,19,9.5);
		ctx.strokeStyle='rgba(246,201,69,'+(0.55+0.35*pul).toFixed(3)+')';
		ctx.lineWidth=1; ctx.stroke();
		textShadowed(ctx,label,pxr+9,pyr+14,'#ffd968');
		// keycap hint: press E to spend
		roundedPath(ctx,pxr+lw+14,pyr+4,12,12,3);
		ctx.fillStyle='rgba(255,217,104,0.18)'; ctx.fill();
		ctx.strokeStyle='rgba(255,217,104,0.6)'; ctx.lineWidth=1;
		roundedPath(ctx,pxr+lw+14.5,pyr+4.5,11,11,3); ctx.stroke();
		ctx.font='700 8px '+FONT;
		ctx.fillStyle='#ffd968';
		ctx.fillText('E',pxr+lw+17.5,pyr+12.5);
	}
	if(s.buffs.length){
		let cx0=px;
		for(const b of s.buffs){
			const urgent=b.expiring;
			const pul=urgent? 0.5+0.5*Math.sin(s.pulseT*5) : 0;
			roundedPath(ctx,cx0,rowY,28,36,8);
			ctx.fillStyle='rgba(9,13,21,0.72)'; ctx.fill();
			roundedPath(ctx,cx0+0.5,rowY+0.5,27,35,7.5);
			ctx.strokeStyle=urgent? 'rgba(255,176,86,'+(0.5+0.4*pul).toFixed(3)+')' : 'rgba(255,255,255,0.14)';
			ctx.lineWidth=1; ctx.stroke();
			ctx.save();
			ctx.textAlign='center';
			ctx.font='12px '+FONT;
			ctx.fillStyle='#fff';
			ctx.fillText(b.icon,cx0+14,rowY+18);
			// remaining-duration ring sweeps around the icon
			if(b.frac>0){
				ctx.strokeStyle=urgent? '#ffb056' : '#ffd968';
				ctx.lineWidth=1.8;
				ctx.beginPath();
				ctx.arc(cx0+14,rowY+14,10.5,-Math.PI/2,-Math.PI/2+Math.PI*2*b.frac);
				ctx.stroke();
			}
			ctx.font='600 8px '+FONT;
			textShadowed(ctx,Math.ceil(b.t)+'s',cx0+14,rowY+31.5,urgent?'#ffcf9a':'rgba(255,255,255,0.78)');
			ctx.restore();
			cx0+=33;
		}
	}

	ctx.restore();
}

export const vitalsHud={ draw, createVitalsModel, model, noteXpAward };
MM.vitalsHud=vitalsHud;
