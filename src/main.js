// Mini Miner - prosty prototyp 2D side-view mining
console.log('[MiniMiner] Script start');
window.addEventListener('error', e=>{
  try {
    const m=document.getElementById('messages');
    if(m) m.textContent = 'Błąd: '+e.message;
  } catch(_){}
  console.error('Global error', e.error||e.message);
});
// Założenia: proceduralny świat, warstwy: roślinność, piach, kamień, diamenty w kamieniu
// Fog-of-war: tylko odkryte kafelki są wyświetlane
// Crafting kilofów: basic (infinite), stone, diamond

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Rozmiary świata w chunkach (póki co ograniczony, można rozszerzać generację on-demand)
const CHUNK_WIDTH = 64; // kafelki szerokości chunku
const WORLD_HEIGHT = 96; // wysokość w kafelkach
const TILE_SIZE = 16; // px

// Warstwy y: 0 (góra) -> WORLD_HEIGHT-1 (dół)
const SURFACE_GRASS_DEPTH = 1;
const SAND_DEPTH = 8; // pod trawą
const STONE_START = SURFACE_GRASS_DEPTH + SAND_DEPTH;

// Szanse na diament w kamieniu (głębiej większa)
function diamondChance(y){
  const depth = y - STONE_START;
  if (depth < 0) return 0;
  return Math.min(0.002 + depth * 0.0008, 0.05); // do 5%
}

// Typy kafelków
const TILE = {
  AIR: 0,
  GRASS: 1,
  SAND: 2,
  STONE: 3,
  DIAMOND: 4,
  TREE_TRUNK: 5,
  LEAF: 6,
};

const TILE_INFO = {
  [TILE.AIR]:   { hp:0, color:'#00000000', drop:null },
  [TILE.GRASS]: { hp:2, color:'#2e8b2e', drop:'grass' },
  [TILE.SAND]:  { hp:2, color:'#c2b280', drop:'sand' },
  [TILE.STONE]: { hp:6, color:'#777', drop:'stone' },
  [TILE.DIAMOND]: { hp:10, color:'#3ef', drop:'diamond' },
  [TILE.TREE_TRUNK]: { hp:4, color:'#8b5a2b', drop:'wood' },
  [TILE.LEAF]: { hp:1, color:'#2faa2f', drop:'leaf' },
};

// Świat przechowujemy w mapie chunków => {chunkX: Int16Array}
const world = new Map();
const discovered = new Map(); // boolean maska visibility

function keyChunk(x){ return x|0; }
function chunkKey(cx){ return 'c'+cx; }

function getChunk(cx){
  const k = chunkKey(cx);
  if(!world.has(k)) generateChunk(cx);
  return world.get(k);
}
function getDiscoverChunk(cx){
  const k = chunkKey(cx);
  if(!discovered.has(k)) discovered.set(k,new Uint8Array(CHUNK_WIDTH*WORLD_HEIGHT));
  return discovered.get(k);
}

function tileIndex(localX,y){ return y*CHUNK_WIDTH + localX; }

function getTile(x,y){
  if(y<0||y>=WORLD_HEIGHT) return TILE.AIR;
  const cx = Math.floor(x/CHUNK_WIDTH);
  const lx = ((x%CHUNK_WIDTH)+CHUNK_WIDTH)%CHUNK_WIDTH;
  const chunk = getChunk(cx);
  return chunk[tileIndex(lx,y)];
}
function setTile(x,y,val){
  if(y<0||y>=WORLD_HEIGHT) return;
  const cx = Math.floor(x/CHUNK_WIDTH);
  const lx = ((x%CHUNK_WIDTH)+CHUNK_WIDTH)%CHUNK_WIDTH;
  const chunk = getChunk(cx);
  chunk[tileIndex(lx,y)] = val;
}
function discover(x,y){
  if(y<0||y>=WORLD_HEIGHT) return;
  const cx = Math.floor(x/CHUNK_WIDTH);
  const lx = ((x%CHUNK_WIDTH)+CHUNK_WIDTH)%CHUNK_WIDTH;
  const dchunk = getDiscoverChunk(cx);
  dchunk[tileIndex(lx,y)] = 1;
}
function isDiscovered(x,y){
  if(y<0||y>=WORLD_HEIGHT) return false;
  const cx = Math.floor(x/CHUNK_WIDTH);
  const lx = ((x%CHUNK_WIDTH)+CHUNK_WIDTH)%CHUNK_WIDTH;
  const dchunk = getDiscoverChunk(cx);
  return !!dchunk[tileIndex(lx,y)];
}

// Siew losowości deterministyczny na bazie x
function randSeed(n){
  // prosta funkcja hashująca
  let x = Math.sin(n*127.1)*43758.5453;
  return x - Math.floor(x);
}

function generateChunk(cx){
  const arr = new Uint8Array(CHUNK_WIDTH*WORLD_HEIGHT);
  // prosty "heightmap" teren
  for(let lx=0; lx<CHUNK_WIDTH; lx++){
    const wx = cx*CHUNK_WIDTH + lx;
    const hNoise = randSeed(wx*0.1);
    const surfaceY = Math.floor(20 + hNoise*5); // 20..25
    for(let y=0;y<WORLD_HEIGHT;y++){
      let tile = TILE.AIR;
      if(y>=surfaceY){
        const depth = y - surfaceY;
        if(depth < SURFACE_GRASS_DEPTH) tile = TILE.GRASS;
        else if(depth < SURFACE_GRASS_DEPTH + SAND_DEPTH) tile = TILE.SAND;
        else {
          // stone / diamond chance
          tile = Math.random() < diamondChance(y) ? TILE.DIAMOND : TILE.STONE;
        }
      }
      arr[tileIndex(lx,y)] = tile;
    }
    // Drzewo szansa
    if(randSeed(wx) < 0.08){
      const treeBaseY = surfaceY;
      const height = 3 + Math.floor(randSeed(wx+99)*3); // 3..5
      for(let t=0;t<height;t++){
        const ty = treeBaseY + t;
        if(ty<WORLD_HEIGHT) arr[tileIndex(lx,ty)] = TILE.TREE_TRUNK;
      }
      // liście prosty kwadrat
      const spread = 2;
      for(let dx=-spread; dx<=spread; dx++){
        for(let dy=height-2; dy<=height+1; dy++){
          if(Math.abs(dx)+Math.abs(dy-(height))>spread+1) continue;
          const ly = treeBaseY + dy;
            const lx2 = lx+dx;
            if(lx2>=0 && lx2<CHUNK_WIDTH && ly>=0 && ly<WORLD_HEIGHT){
              if(arr[tileIndex(lx2,ly)]===TILE.AIR) arr[tileIndex(lx2,ly)] = TILE.LEAF;
            }
        }
      }
    }
  }
  world.set(chunkKey(cx),arr);
}

// Player – początkowo ustawimy tylko podstawowe współrzędne; po wygenerowaniu chunku ustawimy go na powierzchni
const player = {
  x: 0,
  y: 0, // tymczasowo; zostanie zmienione przez placePlayerAtSurface()
  vx: 0,
  vy: 0,
  w: 0.6,
  h: 0.9,
  onGround: false,
  facing: 1,
  tool: 'basic',
};

const inventory = {
  grass:0, sand:0, stone:0, diamond:0, wood:0, leaf:0,
  tools: { stone:false, diamond:false }
};

const toolPower = { basic:1, stone:2, diamond:4 };

// Crafting przepisy
function canCraftStonePick(){ return inventory.stone >= 10; }
function craftStonePick(){ if(canCraftStonePick()){ inventory.stone -= 10; inventory.tools.stone = true; msg('Zrobiono kamienny kilof! (klawisz 2)'); updateUI(); }}
function canCraftDiamondPick(){ return inventory.diamond >= 5; }
function craftDiamondPick(){ if(canCraftDiamondPick()){ inventory.diamond -=5; inventory.tools.diamond = true; msg('Zrobiono diamentowy kilof! (klawisz 3)'); updateUI(); }}

// Input
const keys = {};
window.addEventListener('keydown',e=>{ keys[e.key.toLowerCase()] = true; if(['1','2','3'].includes(e.key)) selectTool(e.key); });
window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()] = false; });

function selectTool(num){
  if(num==='1') player.tool='basic';
  else if(num==='2' && inventory.tools.stone) player.tool='stone';
  else if(num==='3' && inventory.tools.diamond) player.tool='diamond';
  updateUI();
}

// Kamera
let cameraX = 0;
let cameraY = 0;

function physics(dt){
  const speed = 5;
  if(keys['a']||keys['arrowleft']){ player.vx = -speed; player.facing=-1; }
  else if(keys['d']||keys['arrowright']){ player.vx = speed; player.facing=1; }
  else player.vx = 0;

  if((keys['w']||keys['arrowup']||keys[' ']) && player.onGround){ player.vy = -9; player.onGround=false; }

  // grawitacja
  player.vy += 20*dt;
  if(player.vy>20) player.vy=20;

  // ruch X
  player.x += player.vx*dt;
  // kolizje X poprzez sprawdzenie tile pod nogami i na wysokości
  collideAxis('x');
  // ruch Y
  player.y += player.vy*dt;
  collideAxis('y');

  // odkrywanie w zasięgu
  const rad = 8;
  for(let dx=-rad; dx<=rad; dx++){
    for(let dy=-rad; dy<=rad; dy++){
      if(dx*dx+dy*dy <= rad*rad){
        discover(Math.floor(player.x+dx), Math.floor(player.y+dy));
      }
    }
  }

  cameraX = player.x - (canvas.width/TILE_SIZE)/2 + 0.5;
  cameraY = player.y - (canvas.height/TILE_SIZE)/2 + 0.5;
}

function collideAxis(axis){
  if(axis==='x'){
    const minX = Math.floor(player.x - player.w/2);
    const maxX = Math.floor(player.x + player.w/2);
    const minY = Math.floor(player.y - player.h/2);
    const maxY = Math.floor(player.y + player.h/2);
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        const t = getTile(x,y);
        if(t!==TILE.AIR){
          if(player.vx>0) player.x = x - player.w/2 - 0.001;
          if(player.vx<0) player.x = x + 1 + player.w/2 + 0.001;
        }
      }
    }
  } else {
    const minX = Math.floor(player.x - player.w/2);
    const maxX = Math.floor(player.x + player.w/2);
    const minY = Math.floor(player.y - player.h/2);
    const maxY = Math.floor(player.y + player.h/2);
    player.onGround = false;
    for(let y=minY; y<=maxY; y++){
      for(let x=minX; x<=maxX; x++){
        const t = getTile(x,y);
        if(t!==TILE.AIR){
          if(player.vy>0){ player.y = y - player.h/2 - 0.001; player.vy=0; player.onGround=true; }
          if(player.vy<0){ player.y = y + 1 + player.h/2 + 0.001; player.vy=0; }
        }
      }
    }
  }
}

// Kopanie
let mining = false;
let mineTarget = null;
let mineProgress = 0;
let mineTimeRequired = 1; // sekundy (modyfikowane przez narzędzie i twardość)

canvas.addEventListener('mousedown', e=>{ startMining(e); });
canvas.addEventListener('touchstart', e=>{ startMining(e.touches[0]); });
window.addEventListener('mouseup', ()=> mining=false );
window.addEventListener('touchend', ()=> mining=false );

function startMining(e){
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left)/TILE_SIZE + cameraX;
  const my = (e.clientY - rect.top)/TILE_SIZE + cameraY;
  const tx = Math.floor(mx);
  const ty = Math.floor(my);
  const t = getTile(tx,ty);
  if(t!==TILE.AIR){
    mining = true;
    mineTarget = {x:tx,y:ty,type:t, hp: TILE_INFO[t].hp};
    const power = toolPower[player.tool];
    mineTimeRequired = Math.max(0.15, TILE_INFO[t].hp / (power*4));
    mineProgress = 0;
  }
}

function updateMining(dt){
  if(!mining || !mineTarget) return;
  // jeśli tile się zmienił - przerwij
  if(getTile(mineTarget.x, mineTarget.y)!==mineTarget.type){ mining=false; mineTarget=null; return; }
  mineProgress += dt;
  if(mineProgress >= mineTimeRequired){
    // zbierz
    const info = TILE_INFO[mineTarget.type];
    setTile(mineTarget.x, mineTarget.y, TILE.AIR);
    if(info.drop){ inventory[info.drop] = (inventory[info.drop]||0)+1; }
    mining=false; mineTarget=null; mineProgress=0; updateUI();
  }
}

// Rysowanie
function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const tilesX = Math.ceil(canvas.width / TILE_SIZE);
  const tilesY = Math.ceil(canvas.height / TILE_SIZE);
  for(let sx=0; sx<=tilesX; sx++){
    for(let sy=0; sy<=tilesY; sy++){
      const wx = Math.floor(cameraX + sx);
      const wy = Math.floor(cameraY + sy);
      if(!isDiscovered(wx,wy)) continue;
      const t = getTile(wx,wy);
      if(t===TILE.AIR) continue;
      ctx.fillStyle = TILE_INFO[t].color;
      ctx.fillRect(sx*TILE_SIZE, sy*TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  // player
  const px = (player.x - cameraX - player.w/2)*TILE_SIZE;
  const py = (player.y - cameraY - player.h/2)*TILE_SIZE;
  ctx.fillStyle = '#ffd37f';
  ctx.fillRect(px,py,player.w*TILE_SIZE,player.h*TILE_SIZE);

  // mining overlay
  if(mining && mineTarget){
    const sx = (mineTarget.x - cameraX)*TILE_SIZE;
    const sy = (mineTarget.y - cameraY)*TILE_SIZE;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(sx+1,sy+1,TILE_SIZE-2,TILE_SIZE-2);
    const p = mineProgress / mineTimeRequired;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(sx, sy + (1-p)*TILE_SIZE, TILE_SIZE, p*TILE_SIZE);
  }
}

let last=0;
let frames=0;
function loop(ts){
  const dt = Math.min(0.05,(ts-last)/1000);
  last=ts;
  physics(dt);
  updateMining(dt);
  render();
  frames++;
  // Awaryjne odkrycie jeśli po paru klatkach nadal brak widocznych kafelków (np. coś poszło nie tak z placePlayerAtSurface)
  if(frames===30){
    const x0 = Math.floor(player.x)-40;
    for(let x=x0; x<x0+80; x++){
      for(let y=0; y<60; y++) discover(x,y);
    }
  }
  requestAnimationFrame(loop);
}

function updateUI(){
  const invDiv = document.getElementById('inventory');
  invDiv.innerHTML = '<b>Inwentarz</b><br>' +
    ['grass','sand','stone','diamond','wood','leaf'].map(k=>`${k}: ${inventory[k]}`).join('<br>') +
    `<br>Narzędzie: ${player.tool}`;
  const craftDiv = document.getElementById('crafting');
  craftDiv.innerHTML = '<b>Crafting</b><br>' +
    `<button ${canCraftStonePick()?'':'disabled'} id="cStone">Kamienny kilof (10 stone)</button><br>`+
    `<button ${canCraftDiamondPick()?'':'disabled'} id="cDia">Diamentowy kilof (5 diamond)</button>`;
  document.getElementById('cStone')?.addEventListener('click', craftStonePick);
  document.getElementById('cDia')?.addEventListener('click', craftDiamondPick);
}

function msg(t){
  const m = document.getElementById('messages');
  m.textContent = t;
  clearTimeout(msg._t);
  msg._t = setTimeout(()=>{ m.textContent=''; }, 4000);
}

// Ustaw gracza przy powierzchni i odkryj początkowy obszar, żeby nie było czarnego ekranu.
function placePlayerAtSurface(){
  const x = Math.floor(player.x);
  // Upewnij się, że chunk istnieje
  getChunk(Math.floor(x/CHUNK_WIDTH));
  let y=0;
  while(y < WORLD_HEIGHT-1 && getTile(x,y) === TILE.AIR) y++;
  player.y = y - 1; // tuż nad pierwszym blokiem
  // Odkryj większy obszar startowy
  const rad = 20;
  for(let dx=-rad; dx<=rad; dx++){
    for(let dy=-rad; dy<=rad; dy++){
      if(dx*dx + dy*dy <= rad*rad*1.2){
        discover(x+dx, player.y+dy);
      }
    }
  }
}
placePlayerAtSurface();

updateUI();
msg('Sterowanie: A/D lewo/prawo, W lub Spacja skok, mysz/tap kopie, 1/2/3 wybór kilofa. Wykop kamień by zrobić lepszy kilof.');

// Uruchom pętlę dopiero po ustawieniu gracza
requestAnimationFrame(loop);

// Adaptacja do rozmiaru okna
function resize(){
  canvas.width = Math.min(window.innerWidth, 1280);
  canvas.height = Math.min(window.innerHeight, 720);
}
window.addEventListener('resize', resize);
resize();
