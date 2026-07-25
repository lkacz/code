// Pure tile-line rasterizer used by held-pointer building. Keeping this free of
// DOM/world state makes fast pointer jumps deterministic and easy to harden.

const DEFAULT_CELL_LIMIT = 96;
const HARD_CELL_LIMIT = 4096;

export function rasterizeTileLine(x0,y0,x1,y1,limit=DEFAULT_CELL_LIMIT){
	if(![x0,y0,x1,y1].every(Number.isFinite)) return [];
	x0=Math.floor(x0); y0=Math.floor(y0);
	x1=Math.floor(x1); y1=Math.floor(y1);
	const cap=Math.max(1,Math.min(HARD_CELL_LIMIT,Math.floor(Number(limit)||DEFAULT_CELL_LIMIT)));
	const cells=[];
	const dx=Math.abs(x1-x0), sx=x0<x1?1:-1;
	const dy=-Math.abs(y1-y0), sy=y0<y1?1:-1;
	let err=dx+dy;
	while(cells.length<cap){
		cells.push({tx:x0,ty:y0});
		if(x0===x1 && y0===y1) break;
		const e2=err*2;
		if(e2>=dy){ err+=dy; x0+=sx; }
		if(e2<=dx){ err+=dx; y0+=sy; }
	}
	return cells;
}

export const BUILD_STROKE_CELL_LIMIT = DEFAULT_CELL_LIMIT;
