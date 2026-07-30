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
