function normalizeCycle(value){
	const n=Number(value);
	if(!Number.isFinite(n)) return 0;
	return ((n%1)+1)%1;
}

function clamp01(value){
	return Math.max(0,Math.min(1,Number(value)||0));
}

// The live clock always advances from the fatal moment toward `fromCycle`.
// Rewinding therefore travels backwards by the wrapped forward distance rather
// than taking an arbitrary shortest path across midnight.
export function createTemporalCycleRewind(fromCycle,toCycle){
	const from=normalizeCycle(fromCycle);
	const to=normalizeCycle(toCycle);
	return Object.freeze({from,to,distance:normalizeCycle(from-to)});
}

export function temporalCycleAt(plan,progress){
	if(!plan || !Number.isFinite(plan.from) || !Number.isFinite(plan.distance)) return 0;
	const t=clamp01(progress);
	const eased=t*t*(3-2*t);
	return normalizeCycle(plan.from-plan.distance*eased);
}

export default Object.freeze({createTemporalCycleRewind,temporalCycleAt});
