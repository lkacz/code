#!/usr/bin/env node
// Wires the committed hooks and commit template into local git config. Runs
// from npm's "prepare" on any local install; CI installs with
// --ignore-scripts, so runners never gain hooks they don't need. Safe no-op
// when git or a work tree is unavailable (tarball installs).
import { execFileSync } from 'node:child_process';

try {
	execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
	execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
	execFileSync('git', ['config', 'commit.template', '.gitmessage']);
	console.log('git wired: hooks .githooks/ (pre-commit, pre-push), commit template .gitmessage');
} catch {
	// not a git checkout — nothing to wire
}
