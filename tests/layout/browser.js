// A tiny headless-Chromium driver (Chrome DevTools Protocol over the built-in WebSocket) plus a static server.
// No npm dependencies. findChrome() returns null when there is no browser, and the layout test then skips.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUBS } from './stubs.js';
import { WORKOUT_DAY } from './seed.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

/** Why the layout test can't run here, or '' when it can (needs Chrome and a global WebSocket, Node 22+). */
export function skipReason() {
  if (typeof WebSocket === 'undefined') return 'Node 22+ needed for the layout test (no global WebSocket)';
  return findChrome() ? '' : 'no Chrome/Chromium found; set CHROME=/path';
}

export function findChrome() {
  const c = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  return c.find((p) => existsSync(p)) || null;
}

function serve() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      let file = join(ROOT, path === '/' ? 'index.html' : path);
      if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/** Pin "now" to a fixed instant (the clock still runs), so day-dependent screens look the same on any weekday. */
function pinClock(iso) {
  return `(() => { const R = Date, off = new R(${JSON.stringify(iso)}).getTime() - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    window.Date = D; })();`;
}

/**
 * Shut everything down in bounded time (default 5 s). Never throws and never hangs: whatever is still alive
 * when the bound passes is logged as a warning and abandoned (timers are unref'd so they can't hold the process).
 */
export async function teardown({ ws, proc, srv, dir }, boundMs = 5000) {
  const warn = (what) => console.warn(`  ! teardown: ${what}`);
  const deadline = Date.now() + boundMs;
  const left = () => Math.max(0, deadline - Date.now());
  const within = (p, ms, what) => new Promise((resolve) => {
    const t = setTimeout(() => { warn(`${what} did not finish in ${ms} ms; moving on`); resolve(false); }, ms);
    t.unref();
    Promise.resolve(p).then(() => { clearTimeout(t); resolve(true); }, () => { clearTimeout(t); resolve(true); });
  });
  try { ws && ws.close(); } catch { /* ignore */ }
  // Kill Chrome and wait (bounded) for it to exit.
  const exited = proc && (proc.exitCode !== null || proc.signalCode !== null)
    ? Promise.resolve()
    : new Promise((r) => { try { proc.once('exit', r); proc.kill('SIGKILL'); } catch { r(); } });
  // Chrome never gets the whole budget: server close and dir removal keep a floor (FLOOR ms each), even if that runs slightly past the bound.
  const FLOOR = 300;
  await within(exited, Math.max(FLOOR, Math.min(2000, boundMs - 700)), 'Chrome exit');
  try { proc && proc.stdout && proc.stdout.destroy(); } catch { /* ignore */ }
  try { proc && proc.stderr && proc.stderr.destroy(); } catch { /* ignore */ }
  try { proc && proc.unref && proc.unref(); } catch { /* ignore */ } // a Chrome that won't die can't keep the shard's event loop alive
  // Drop keep-alive sockets so close() can't wait on them.
  try { srv.closeAllConnections && srv.closeAllConnections(); } catch { /* ignore */ }
  await within(new Promise((r) => { try { srv.close(() => r()); } catch { r(); } }), Math.max(FLOOR, Math.min(1500, left())), 'server close');
  // Profile dir removal is best-effort (Chrome may still hold files for a moment).
  await within(rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }), Math.max(FLOOR, left()),'profile dir removal');
}

export async function launch() {
  const chrome = findChrome();
  const srv = await serve();
  const port = srv.address().port;
  // Shared CI runners sometimes start Chrome slowly or not at all; try up to 3 times before failing.
  const start = () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-layout-'));
    const p = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--remote-debugging-port=0',
      `--user-data-dir=${dir}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const url = new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Chrome did not start')), 40000);
      p.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
      p.on('exit', () => { clearTimeout(t); reject(new Error('Chrome exited early')); });
    });
    return { p, dir, url };
  };
  let proc, dir, wsUrl, lastErr;
  for (let attempt = 1; attempt <= 3 && !wsUrl; attempt++) {
    const s = start();
    try { wsUrl = await s.url; proc = s.p; dir = s.dir; }
    catch (e) { lastErr = e; try { s.p.kill('SIGKILL'); } catch {} try { rmSync(s.dir, { recursive: true, force: true }); } catch {} }
  }
  if (!wsUrl) { srv.close(); throw lastErr; }
  const dbgPort = new URL(wsUrl).port;
  const target = await (await fetch(`http://127.0.0.1:${dbgPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else handlers.forEach((h) => h(msg));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(n, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

  // Serve the Firebase SDK files from stubs; refuse every other outside request so nothing waits on a network.
  const errors = [];
  handlers.push((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text).split('\n')[0]);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' ').split('\n')[0]);
  });
  handlers.push(async (msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const file = request.url.split('/').pop();
    try {
      if (request.url.includes('gstatic.com/firebasejs/') && STUBS[file]) {
        await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/javascript' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(STUBS[file]).toString('base64') });
      } else await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } catch { /* page navigated away */ }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });

  let kept = null;
  const api = {
    pinned: WORKOUT_DAY,
    base: `http://127.0.0.1:${port}`,
    send,
    errors,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async viewport(width, height, dark, { motion = false } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: motion ? 'no-preference' : 'reduce' }] });
    },
    /** Open the app at a hash route with a seeded account. */
    async open(route, seedData, init = '', { persist = false, at = api.pinned, loading = false } = {}) {
      await api.dropInit();
      await send('Page.navigate', { url: 'about:blank' });
      // persist: the setup script also runs after a page reload, and storage is only cleared on the first load (resume/update tests)
      const tok = Math.random().toString(36).slice(2);
      const boot = `window.__SEED = ${JSON.stringify(seedData)};
        try { if (!${persist} || sessionStorage.getItem('__booted') !== '${tok}') { localStorage.clear(); localStorage.setItem('forge.seen', '1'); sessionStorage.setItem('__booted', '${tok}'); } } catch (e) {}
        try { delete Navigator.prototype.serviceWorker; } catch (e) {}
        window.__cls = 0; window.__shifts = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push(Math.round(e.startTime) + 'ms ' + e.value.toFixed(3) + ' ' + (e.sources || []).map((s) => s.node && (s.node.nodeName + '.' + (s.node.className || ''))).join(',')); } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
        ${at ? pinClock(at) : ''}
        ${init}`;
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: boot });
      await send('Page.navigate', { url: `${api.base}/index.html#/${route}` });
      // Wait for a real screen (not the skeleton), then let async cards and fonts settle.
      for (let i = 0; i < (loading ? 0 : 150); i++) { // loading: the slow-data fixture holds every snapshot (window.__HOLD), so stay on the skeleton
        await new Promise((r) => setTimeout(r, 100));
        const ready = await api.eval(`!!document.querySelector('#main') && !document.querySelector('#main .skeleton') && document.querySelector('#main').children.length > 0`).catch(() => false);
        if (ready) break;
      }
      await new Promise((r) => setTimeout(r, loading ? 250 : 450));
      if (persist) kept = identifier;
      else await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    },
    /** Remove a script kept by open(..., { persist: true }). */
    async dropInit() {
      if (kept) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: kept }).catch(() => {});
      kept = null;
    },
    async screenshot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(dirname(path), { recursive: true });
      (await import('node:fs')).writeFileSync(path, Buffer.from(data, 'base64'));
    },
    async close() { await teardown({ ws, proc, srv, dir }); },
  };
  return api;
}
