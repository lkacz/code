# Codex project instructions

Read `CLAUDE.md` before changing code; its verification and architecture rules
apply to every agent.

## Browser and visual QA

Do not conclude that browser testing is unavailable merely because an
assistant-provided browser connector has no active browser. This repository has
its own dependency-free Chrome/Edge CDP driver.

Before browser or visual QA, read `docs/LIVE-PREVIEW.md` in full. Use:

```bash
npm start
npm run preview -- --script=tools/scenes/<scene>.js --out=tools/<shot>.png
```

`tools/live-preview.mjs` launches an installed Chrome/Edge with a throwaway
profile, drives the real page, evaluates scripts inside it, reports page
exceptions, and captures screenshots. Prefer in-page state or pixel assertions
for deterministic verdicts; inspect the resulting PNG when visual judgment is
useful. Respect the handbook's guidance on small software-rendered windows,
background-tab throttling, driver-side waits, and marker-scoped process cleanup.

## GitHub authentication and publishing

Do not ask the user to log in merely because `gh auth status` reports an
expired or invalid GitHub CLI token. On this Windows workspace, normal Git
HTTPS operations use the already configured Git Credential Manager and work
independently of the `gh` session.

For routine repository publishing, use this order:

1. Verify existing Git access with `git ls-remote origin refs/heads/main` (or
   another read-only Git command).
2. Commit and run `git push origin main` normally; let Git Credential Manager
   supply the saved credential. Never print or extract the credential.
3. For this public repository, inspect GitHub Actions through the public GitHub
   REST API or the connected GitHub tools. Workflow/job logs and reruns should
   use the connected GitHub tools when available.
4. A push to `main` triggers `.github/workflows/pages.yml`. Confirm both the
   `check-and-package` and `deploy` jobs succeeded, then HTTP-check
   `https://lkacz.github.io/code/` before reporting deployment complete.

Treat Git and `gh` authentication as separate capabilities. Request a new
login only when the required operation genuinely cannot be completed with
Git Credential Manager, the public API, or the connected GitHub tools. A
failed `gh auth status` by itself is not such a blocker.

## Completion and publishing default

When a requested code change is genuinely complete and its required
verification has passed, finish the delivery without waiting for a separate
prompt: commit only the completed scope, push `main`, wait for both GitHub
Pages jobs, and verify the live site. Keep unrelated or unfinished worktree
changes out of the commit. Do not publish while required checks are failing or
the requested work is still in progress, and respect an explicit user request
not to commit, push, or deploy.
