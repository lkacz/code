// Assemble the exact static runtime published by GitHub Pages.
// Keeping this allowlist in code prevents QA harnesses, logs, repository metadata,
// and future developer-only files from silently becoming same-origin production pages.
import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(repoRoot, '.pages-artifact');
const runtimeEntries = ['index.html', '.nojekyll', 'src'];

async function copyTree(source, destination){
  const info = await lstat(source);
  if(info.isSymbolicLink()) throw new Error(`Refusing symbolic link in runtime artifact: ${source}`);
  if(info.isDirectory()){
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for(const entry of entries){
      if(entry.name === '.' || entry.name === '..') throw new Error(`Invalid runtime entry: ${entry.name}`);
      await copyTree(join(source, entry.name), join(destination, entry.name));
    }
    return;
  }
  if(!info.isFile()) throw new Error(`Refusing non-file runtime entry: ${source}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function inventory(root, relative = ''){
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files = [];
  for(const entry of entries.sort((a, b) => a.name.localeCompare(b.name))){
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if(entry.isDirectory()) files.push(...await inventory(root, child));
    else if(entry.isFile()) files.push(child);
    else throw new Error(`Unexpected staged entry: ${child}`);
  }
  return files;
}

if(dirname(outputRoot) !== repoRoot) throw new Error('Unsafe Pages output path');
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for(const entry of runtimeEntries) await copyTree(join(repoRoot, entry), join(outputRoot, entry));

const files = await inventory(outputRoot);
const forbidden = files.filter(file =>
  !(file === 'index.html' || file === '.nojekyll' || file.startsWith('src/'))
  || /(^|\/)(?:tools|\.git|\.github|node_modules)(?:\/|$)/.test(file)
  || /\.log(?:\.|$)/i.test(file)
);
if(forbidden.length) throw new Error(`Forbidden Pages artifact entries: ${forbidden.join(', ')}`);
if(!files.includes('index.html') || !files.includes('src/main.js')) throw new Error('Pages artifact is incomplete');

console.log(`Pages artifact ready: ${files.length} files in ${outputRoot}`);
