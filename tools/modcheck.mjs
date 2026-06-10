// Static ES-module graph checker: finds imports that reference missing exports.
// Usage: node modcheck.mjs <projectRoot> <entry>
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const entry = process.argv[3] ?? 'src/main.js';

const modules = new Map(); // abs path -> { exports:Set, imports:[{names,defaultName,from,resolved}] }

function parse(absPath) {
  if (modules.has(absPath)) return;
  if (!fs.existsSync(absPath)) { modules.set(absPath, { missing: true, exports: new Set(), imports: [] }); return; }
  const src = fs.readFileSync(absPath, 'utf8');
  const exports = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var|function\*?|class|async\s+function\*?)\s+([A-Za-z_$][\w$]*)/gm)) exports.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm))
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) exports.add(name);
    }
  if (/^\s*export\s+default/m.test(src)) exports.add('default');
  for (const m of src.matchAll(/^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) exports.add('*reexport:' + m[1]);

  const imports = [];
  for (const m of src.matchAll(/^\s*import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}|\*\s*as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"]/gm)) {
    const defaultName = m[1] ?? m[4] ?? null;
    const ns = m[3] ?? null;
    const names = m[2] ? m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) : [];
    const from = m[5];
    const resolved = path.resolve(path.dirname(absPath), from);
    imports.push({ defaultName, ns, names, from, resolved });
  }
  modules.set(absPath, { exports, imports, missing: false });
  for (const imp of imports) parse(imp.resolved);
}

parse(path.resolve(root, entry));

let problems = 0;
for (const [abs, mod] of modules) {
  const rel = path.relative(root, abs).replaceAll('\\', '/');
  if (mod.missing) { console.log(`MISSING FILE: ${rel}`); problems++; continue; }
  for (const imp of mod.imports) {
    const target = modules.get(imp.resolved);
    const trel = path.relative(root, imp.resolved).replaceAll('\\', '/');
    if (!target || target.missing) { console.log(`${rel}: imports from missing file ${imp.from}`); problems++; continue; }
    for (const n of imp.names) {
      if (!target.exports.has(n)) { console.log(`${rel}: import { ${n} } from '${imp.from}' -> NOT EXPORTED by ${trel}`); problems++; }
    }
    if (imp.defaultName && !target.exports.has('default')) {
      console.log(`${rel}: default import '${imp.defaultName}' from '${imp.from}' -> NO default export in ${trel}`); problems++;
    }
  }
}
console.log(problems ? `\n${problems} problem(s) found across ${modules.size} modules.` : `OK: ${modules.size} modules, no import/export mismatches.`);
console.log('Modules:', [...modules.keys()].map(p => path.relative(root, p).replaceAll('\\', '/')).join(', '));
