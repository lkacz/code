// Minimal development server with an explicit file allowlist.
// Default mode exposes only the production runtime. --qa adds tools/ on a separate
// origin so smoke harness state cannot overwrite the normal development save.
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const args = process.argv.slice(2);
const qaMode = args.includes('--qa');
const artifactMode = args.includes('--artifact');
if(qaMode && artifactMode) throw new Error('--qa and --artifact cannot be combined');
const siteRoot = artifactMode ? join(repoRoot, '.pages-artifact') : repoRoot;
let port = qaMode ? 8124 : 8123;
for(let i = 0; i < args.length; i++){
  const value = args[i] === '--port' ? args[++i] : (args[i].startsWith('--port=') ? args[i].slice(7) : null);
  if(value != null){
    const parsed = Number(value);
    if(!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`Invalid port: ${value}`);
    port = parsed;
  }
}

const allowedRoots = new Set(['src']);
if(qaMode) allowedRoots.add('tools');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function commonHeaders(){
  return {
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN'
  };
}

function send(res, status, body, extra = {}){
  const payload = Buffer.from(body);
  res.writeHead(status, { ...commonHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': payload.length, ...extra });
  res.end(payload);
}

async function resolveRequest(requestUrl){
  let pathname;
  try{ pathname = decodeURIComponent(new URL(requestUrl, `http://${host}:${port}`).pathname); }
  catch{ return { status: 400 }; }
  if(pathname.includes('\0') || pathname.includes('\\')) return { status: 400 };
  if(pathname === '/') pathname = '/index.html';
  const segments = pathname.split('/').filter(Boolean);
  if(!segments.length || segments.some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))) return { status: 404 };

  let allowedRoot = siteRoot;
  if(segments.length === 1 && segments[0] === 'index.html'){
    // The entry document is the only root-level file served.
  }else if(allowedRoots.has(segments[0])){
    allowedRoot = join(siteRoot, segments[0]);
  }else return { status: 404 };

  const candidate = join(siteRoot, ...segments);
  const lexical = relative(allowedRoot, candidate);
  if(lexical === '..' || lexical.startsWith(`..${sep}`) || resolve(candidate) === resolve(allowedRoot)) return { status: 404 };
  try{
    const [candidateInfo, resolvedFile, resolvedRoot] = await Promise.all([lstat(candidate), realpath(candidate), realpath(allowedRoot)]);
    if(!candidateInfo.isFile() || candidateInfo.isSymbolicLink()) return { status: 404 };
    const physical = relative(resolvedRoot, resolvedFile);
    if(physical === '..' || physical.startsWith(`..${sep}`)) return { status: 404 };
    return { status: 200, file: resolvedFile };
  }catch{ return { status: 404 }; }
}

const server = createServer(async (req, res) => {
  if(req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
  const target = await resolveRequest(req.url || '/');
  if(target.status !== 200) return send(res, target.status, target.status === 400 ? 'Bad request\n' : 'Not found\n');
  const info = await lstat(target.file);
  const headers = { ...commonHeaders(), 'Content-Type': mime.get(extname(target.file).toLowerCase()) || 'application/octet-stream', 'Content-Length': info.size };
  res.writeHead(200, headers);
  if(req.method === 'HEAD') return res.end();
  const stream = createReadStream(target.file);
  stream.on('error', () => { if(!res.headersSent) send(res, 500, 'Read error\n'); else res.destroy(); });
  stream.pipe(res);
});

server.listen(port, host, () => {
  const scope = qaMode ? 'runtime + QA tools' : (artifactMode ? 'staged runtime artifact' : 'runtime only');
  console.log(`Serving ${scope} at http://${host}:${port}/`);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
