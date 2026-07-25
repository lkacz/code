#!/usr/bin/env node
// Removes disposable ignored artifacts: server logs, the staged Pages
// artifact, QA screenshots under tools/. Git-driven — only paths git ALREADY
// ignores are candidates, so a tracked or unignored file can never be hit —
// with node_modules/ and .cache/ excluded (deleting them only costs a full
// npm ci for zero benefit).
//
// Usage: npm run clean [-- --dry-run]
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const dryRun = process.argv.includes('--dry-run');
const PROTECTED = /^(node_modules\/|\.cache\/)/;

let status;
try {
	status = execFileSync('git', ['status', '--porcelain', '--ignored'], { encoding: 'utf8' });
} catch (err) {
	console.error('clean: git unavailable or not a work tree:', err.message);
	process.exit(1);
}

const victims = status
	.split('\n')
	.filter(line => line.startsWith('!! '))
	.map(line => line.slice(3).trim())
	.filter(Boolean)
	.filter(p => !PROTECTED.test(p));

if (!victims.length) {
	console.log('clean: nothing to remove');
	process.exit(0);
}

let removed = 0;
for (const victim of victims) {
	if (dryRun) {
		console.log('would remove', victim);
		continue;
	}
	try {
		rmSync(victim, { recursive: true, force: true });
		removed++;
	} catch (err) {
		console.error('clean: failed to remove', victim, '-', err.message);
		process.exitCode = 1;
	}
}
console.log(dryRun
	? `clean: dry run — ${victims.length} item(s) would be removed`
	: `clean: removed ${removed}/${victims.length} item(s) (node_modules/ and .cache/ untouched)`);
