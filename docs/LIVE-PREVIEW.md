# Live preview: driving and *seeing* a real running app

This is a handbook for an AI agent. It explains how to launch the real app in a real
browser, poke it, and look at the result — no test framework, no Puppeteer, no
dependencies at all. Everything here is what this repo's `tools/*-qa.mjs` drivers do;
`tools/live-preview.mjs` is the reusable core.

## First: separate two capabilities that get conflated

**1. Driving and asserting.** Launch a browser, load the page, run JavaScript inside
it, read state back, take screenshots. **Any agent can do this**, including a text-only
one. It is just a child process plus a WebSocket. If a model "cannot do live preview,"
this is almost never the blocker — it is usually that nobody told it the browser speaks
a protocol it can call directly.

**2. Actually looking at the rendered frame.** Reading a PNG *as an image* needs a
vision-capable model and a tool that returns images. A text-only agent cannot do this —
but it is rarely necessary, because almost everything you would check by eye can be
checked *inside the page* instead (see [Seeing without eyes](#seeing-without-eyes)).

So: capability 1 is universal, capability 2 is a bonus. Write your scenes so the
verdict comes from capability 1, and use the screenshot for the parts where taste
matters (layout, colour, "does this look broken").

## Requirements

- **Node 18+** (22+ preferred): `fetch` and `WebSocket` are global — no `ws` package.
- **Any Chromium**: Chrome, Edge, Chromium. Set `CHROME_PATH` if it is somewhere odd.
- **The app reachable over HTTP.** `file://` breaks ES modules and CORS. In this repo:
  `npm start` (serves `http://127.0.0.1:8123`). Any static server works.

## Use the driver

```bash
node tools/live-preview.mjs                                  # boot + screenshot
node tools/live-preview.mjs --out=tools/shot.png --wait=3000
node tools/live-preview.mjs --eval="player.hp + '/' + player.maxHp"
node tools/live-preview.mjs --script=tools/scenes/example.js # a scripted scene
node tools/live-preview.mjs --shots=4 --interval=700         # a strip over time
node tools/live-preview.mjs --url=https://lkacz.github.io/code/index.html
node tools/live-preview.mjs --head                           # watch it with your own eyes
```

`--script` runs a file **inside the page** as an async function body. `sleep(ms)` is
provided. Return a string; prefix it with `FAIL` to make the process exit non-zero, so
the same scene works as a CI check. See `tools/scenes/example.js`.

Then, if you have vision: read the PNG with your image-reading tool and *look* at it.

## The whole mechanism, in 30 lines

If you are in a different repo and want to build this from scratch:

```js
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'preview-'));
spawn('chrome', ['--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--window-size=1100,620', 'about:blank'], { stdio: 'ignore' });

// The browser writes the port it chose into the profile dir.
let port = '';
for (let i = 0; i < 80 && !port; i++) {
  await new Promise(r => setTimeout(r, 250));
  try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); } catch {}
}
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m.result); };
const send = (method, params) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

await send('Page.enable', {});
await send('Runtime.enable', {});
await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
await new Promise(r => setTimeout(r, 3000));

const { result } = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
console.log(result.value);
const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile('shot.png', Buffer.from(shot.data, 'base64'));
```

That is the entire trick. Four CDP methods do 95% of the work: `Page.navigate`,
`Runtime.evaluate`, `Page.captureScreenshot`, `Runtime.exceptionThrown` (an event).

## Seeing without eyes

A screenshot is a *last* resort for a verdict, not a first. Prefer asserting inside the
page, where you have the whole app in scope:

- **DOM truth** — `document.getElementById('pausePanel').hidden`,
  `el.getClientRects().length`, `getComputedStyle(el).color`, `el.textContent`.
- **App state** — whatever the app exposes (`MM.metrics()`, `player.hp`, module
  `_debug` handles). Expose a read-only debug surface if you don't have one.
- **Pixels, without vision** — you can sample the canvas *in the page*:
  ```js
  const c = document.getElementById('game');
  const px = c.getContext('2d').getImageData(x, y, 1, 1).data; // [r,g,b,a]
  ```
  That turns "is the health bar red" into a numeric assertion any agent can make.
- **Console + exceptions** — capture `Runtime.exceptionThrown` and
  `Runtime.consoleAPICalled`. **A page that threw during boot still screenshots as a
  plausible, calm, empty page.** This is the single most common way a preview lies to
  you. Always surface errors; treat any of them as failure.

## Gotchas that will waste your afternoon

Each of these cost real time in this repo. They are not hypothetical.

1. **The screenshot lies about errors.** See above. Wire up exception capture *first*.

2. **A big window starves the simulation.** With `--disable-gpu`, Chrome software-rasters
   every pixel. On a canvas app at 1600×900 the frame rate can collapse to ~3 fps — and
   if the app clamps `dt` per frame (most do), **two minutes of wall clock buys only a few
   seconds of simulated time.** A feature that needs 15 s of in-game time will look
   broken. Use a small window (960×540) and, if a scene needs lots of sim time, call the
   app's own functions directly instead of waiting for the world to get there.

3. **rAF is frozen in a background tab, and timers are throttled to ~1 Hz.** With two
   tabs (e.g. a host and a spectator) only one is in front. Consequences:
   - the backgrounded tab's `requestAnimationFrame` loop stops entirely;
   - `await sleep(250)` *inside* that page actually takes ~1000 ms, so an in-page polling
     loop blows your evaluate budget and times out.
   **Do all waiting and sampling on the driver side** (Node), and keep in-page evals as
   single instantaneous reads. Also: two reads 300 ms apart can land inside the same
   throttled tick and look "frozen" when nothing is wrong — space samples past one tick.

4. **Probabilistic things starve under virtual time.** If you drive the clock, rare
   random events may never fire. Test *logic* in a headless Node sim; use the browser for
   *visuals and integration*.

5. **`deviceScaleFactor`.** Force it to 1 (`--force-device-scale-factor=1` **and**
   `Emulation.setDeviceMetricsOverride`), or run it at 2 deliberately to catch DPR bugs.
   Pointer coordinates and canvas math are where DPR bugs hide.

6. **Reuse a browser profile and you inherit state.** localStorage saves, settings,
   first-run flags. Use a fresh temp `--user-data-dir` per run — or deliberately reuse
   one to test persistence across reloads.

7. **Synthetic key events: dispatch on `document.body`, not `window`.** Events targeted
   *at* `window` run its listeners in registration order and flatten the capture/bubble
   phases, so capture-phase handlers appear to leak. Body-targeted events reproduce real
   input ordering.

8. **Put a deadline on every CDP call.** A page pinned at 100% CPU never answers, and a
   driver with no timeout hangs forever with zero output. Fail loudly instead.

9. **Rendering may be gated.** Things can exist in the model and be deliberately not
   drawn — fog of war, culling, visibility checks. An empty-looking screenshot is not
   proof of absence; check the model.

10. **Audio needs a flag.** `--autoplay-policy=no-user-gesture-required` — WebAudio does
    run headless, and you can assert on the graph.

11. **Screenshot timing.** Capture *after* the frame you want exists. If the visual is
    produced during a render pass, wait a frame (or two) before capturing.

## Recipe for a new scene

1. **Boot-wait on a real condition**, not a fixed sleep:
   `for(let i=0;i<400 && !window.player;i++) await sleep(50);`
2. **Set the world up through the app's own API** (spawn, teleport, set tiles) instead of
   playing through 10 minutes of game.
3. **Drive the real input path** where the point is the input path (dispatch keys/pointer
   events); call functions directly where the point is the outcome.
4. **Return a verdict string.** `'ok :: hp=100'` or `'FAIL :: <what and why>'`, with the
   numbers you would need to debug it. Your future self reads this line, not the code.
5. **Screenshot the interesting moment**, not the aftermath.
6. **Separate setup failure from feature failure** in the message. "The arrows never flew
   on the HOST either" instantly tells you it is your scene, not the app.

## Telling another agent to do this

Paste this, adjusted for your project:

> You can preview the running app directly. Start the static server (`npm start`), then
> run `node tools/live-preview.mjs --script=<scene.js> --out=<shot.png>`. The script file
> runs inside the page (async body, `sleep(ms)` available) — set up state via the app's
> own API, drive real input events, and return a string starting with `FAIL` if the check
> fails. The driver prints page exceptions and console errors; treat any as failure.
> Read `docs/LIVE-PREVIEW.md` before writing the scene — especially the notes on
> background-tab throttling and the software-rasterizer frame rate, which will otherwise
> make working features look broken. If you can view images, open the PNG and look at it;
> if you cannot, assert inside the page (DOM, app state, or `getImageData` pixel checks).
