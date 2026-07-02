// Vertical world-slice diagnostic renderer.
// Renders full-height (WORLD_MIN_Y..WORLD_MAX_Y) PNG slices around interesting
// generated sites (origin, volcano, city, ocean) so vertical integration —
// sky / surface / mid / deep transitions, cave & water systems, volcano roots,
// ore pockets, bedrock floor — can be inspected by eye across seeds.
//
// Usage:
//   node tools/world-slice-diag.mjs [seed ...] [--out DIR]
//
// Output PNGs are written OUTSIDE the repository (OS temp dir) unless --out
// points elsewhere; diagnostic bitmaps are not tracked project artifacts.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

globalThis.window = globalThis;
globalThis.MM = globalThis.MM || {};

const { WORLD_MIN_Y, WORLD_MAX_Y, T, INFO } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const OUT_DIR = outFlag >= 0 ? args[outFlag + 1] : join(tmpdir(), 'world-slices');
const seeds = args.filter((a, i) => i !== outFlag && i !== outFlag + 1).map(Number).filter(Number.isFinite);
if (!seeds.length) seeds.push(WG.worldSeed);

// ---- minimal PNG encoder (RGBA, filter 0) ------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- palette ------------------------------------------------------------------
function hexToRgb(h) {
  if (!h) return null;
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const TILE_RGB = {};
for (const [id, info] of Object.entries(INFO)) TILE_RGB[id] = hexToRgb(info.color);
function airColor(y, surface) {
  if (y < surface) { // open sky above terrain
    const t = Math.max(0, Math.min(1, -y / 140));
    return [140 + 60 * t, 185 + 40 * t, 235 + 20 * t];
  }
  return [54, 30, 18]; // cave air: warm dark brown, distinct from basalt
}

// ---- site finders ---------------------------------------------------------------
function findVolcano() {
  for (let x = 0; x <= 30000; x += 4) {
    for (const s of [x, -x]) {
      const c = WG.column(s);
      if (c && c.volcano && Math.abs(s - c.volcano.center) <= 2) return c.volcano.center;
    }
  }
  return null;
}
function findCity() {
  for (let x = 0; x <= 40000; x += 8) {
    for (const s of [x, -x]) {
      const c = WG.column(s);
      if (c && c.city) return c.city.center;
    }
  }
  return null;
}
function findOcean() {
  for (let x = 0; x <= 30000; x += 8) {
    for (const s of [x, -x]) {
      if (WG.biomeType(s) !== 5) continue;
      let run = 0;
      while (run < 400 && WG.biomeType(s + run) === 5) run++;
      if (run > 60) return s + Math.floor(run / 2);
    }
  }
  return null;
}

function renderSlice(centerX, width, label, seed) {
  const x0 = Math.round(centerX - width / 2);
  const h = WORLD_MAX_Y - WORLD_MIN_Y;
  const rgba = Buffer.alloc(width * h * 4);
  for (let px = 0; px < width; px++) {
    const wx = x0 + px;
    const surface = WG.surfaceHeight(wx);
    for (let py = 0; py < h; py++) {
      const y = WORLD_MIN_Y + py;
      const t = world.getTile(wx, y);
      const c = t === T.AIR ? airColor(y, surface) : (TILE_RGB[t] || [255, 0, 255]);
      const o = (py * width + px) * 4;
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
  }
  // section-boundary ticks on the left edge for orientation
  for (const by of [-140, -70, 0, 70, 140, 210, 280]) {
    const py = by - WORLD_MIN_Y;
    if (py < 0 || py >= h) continue;
    for (let px = 0; px < 3; px++) {
      const o = (py * width + px) * 4;
      rgba[o] = 255; rgba[o + 1] = 40; rgba[o + 2] = 40; rgba[o + 3] = 255;
    }
  }
  const file = join(OUT_DIR, `slice_${seed}_${label}.png`);
  writeFileSync(file, encodePNG(width, h, rgba));
  console.log(`wrote ${file} (x ${x0}..${x0 + width - 1})`);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const seed of seeds) {
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  const sites = { origin: 0 };
  const v = findVolcano(); if (v != null) sites.volcano = v;
  const c = findCity(); if (c != null) sites.city = c;
  const o = findOcean(); if (o != null) sites.ocean = o;
  console.log(`seed ${seed}: sites ${JSON.stringify(sites)}`);
  for (const [label, x] of Object.entries(sites)) renderSlice(x, 640, label, seed);
}
