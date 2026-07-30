// Visible chunk canvases share a deliberately small rebuild budget. Process the
// camera centre first so ambient edge activity cannot starve terrain edits at
// the hero. The helper mutates and returns the supplied array to avoid allocating
// another per-frame list.
export function prioritizeVisibleRenderSections(refs,centerChunk,centerSection){
	if(!Array.isArray(refs) || refs.length<2) return Array.isArray(refs)?refs:[];
	const cc=Number.isFinite(centerChunk)?centerChunk:0;
	const cs=Number.isFinite(centerSection)?centerSection:0;
	refs.sort((a,b)=>{
		const adx=Math.abs(a.cx-cc), ady=Math.abs(a.section-cs);
		const bdx=Math.abs(b.cx-cc), bdy=Math.abs(b.section-cs);
		const ar=Math.max(adx,ady), br=Math.max(bdx,bdy);
		return (ar-br)
			|| ((adx+ady)-(bdx+bdy))
			|| (ady-bdy)
			|| (a.cx-b.cx)
			|| (a.section-b.section);
	});
	return refs;
}

export default Object.freeze({prioritizeVisibleRenderSections});
