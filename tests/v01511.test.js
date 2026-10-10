// v0.15.11: the running iPhone app notices a newer build (update on resume), what's new, native cleanup, missions footer.
import { readFileSync } from 'node:fs';
import { test, eq as eq1, assert } from './harness.js';
import { isNewBuild, safeToReload, cmpVersion, versionChange, checkForUpdate, cleanOldCaches, announceUpdate, highlightsFor, _reset } from '../js/native/update.js';
import { whatsNew, readVersion, highlightProblem } from '../scripts/build-www.mjs';

const eq = (a, b, m) => (a && typeof a === 'object' ? eq1(JSON.stringify(a), JSON.stringify(b), m) : eq1(a, b, m));
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
const native = () => { globalThis.window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false, Plugins: {} } }; };
const web = () => { globalThis.window = {}; };

test('isNewBuild: version, builtAt or expiry differing means a new install', () => {
  const a = { version: '0.15.10', builtAt: '2026-10-10T10:00:00Z' };
  eq(isNewBuild(a, { ...a }), false);
  eq(isNewBuild(a, { version: '0.15.11', builtAt: a.builtAt }), true);
  eq(isNewBuild(a, { version: a.version, builtAt: '2026-10-11T10:00:00Z' }), true);
  eq(isNewBuild({ ...a, expires: '2026-10-17T00:00:00Z' }, { ...a, expires: '2026-10-18T00:00:00Z' }), true);
  eq(isNewBuild(a, null), false); // unreadable
  eq(isNewBuild(a, {}), false);
  eq(isNewBuild({ builtAt: 'x' }, { version: '0.15.11', builtAt: 'x' }), false); // an old build without a version: compare what both know
  eq(isNewBuild(null, { version: '0.15.11' }), false);
});

test('safeToReload: never in the player or workout list, or while typing', () => {
  eq(safeToReload({ route: 'today' }), true);
  eq(safeToReload({ route: 'body' }), true);
  eq(safeToReload({ route: 'play' }), false);
  eq(safeToReload({ route: 'session' }), false);
  eq(safeToReload({ route: 'today', typing: true }), false);
  eq(safeToReload({ route: 'timer', busy: true }), false);
  eq(safeToReload({ route: 'timer', busy: false }), true);
});

test('checkForUpdate: holds while a timer run, a dialog or the tour is active, then reloads', async () => {
  _reset();
  let reloads = 0, busy = false, build = { version: '0.15.10', builtAt: 'a' };
  const deps = { read: async () => build, route: () => 'timer', typing: () => false, busy: () => busy, reload: () => { reloads++; } };
  await checkForUpdate(deps);
  build = { version: '0.15.11', builtAt: 'b' };
  busy = true; // a boxing round running, Log food open, or the tour showing
  eq(await checkForUpdate(deps), 'later');
  eq(await checkForUpdate(deps), 'later');
  eq(reloads, 0);
  busy = false;
  eq(await checkForUpdate(deps), 'reloading');
  eq(reloads, 1);
});

test('the default busy check sees dialog[open], the timer run and the tour', async () => {
  _reset();
  const u = src('js/native/update.js');
  assert(u.includes("dialog[open]") && u.includes('holdReloadWhile'));
  assert(src('js/screens/timer.js').includes('export const isTimerRunning'));
  const app = src('js/app.js');
  assert(app.includes('holdReloadWhile(isTimerRunning)') && app.includes('holdReloadWhile(isTourActive)'));
  const { checkForUpdate: c, holdReloadWhile, _reset: r } = await import('../js/native/update.js');
  r();
  let reloads = 0, hook = true, build = { version: '1', builtAt: 'a' };
  holdReloadWhile(() => hook);
  const deps = { read: async () => build, route: () => 'today', typing: () => false, reload: () => { reloads++; } };
  await c(deps);
  build = { version: '2', builtAt: 'b' };
  eq(await c(deps), 'later');
  hook = false;
  eq(await c(deps), 'reloading');
  eq(reloads, 1);
  r();
});

test('cmpVersion compares numbers, not strings', () => {
  eq(cmpVersion('0.15.11', '0.15.9'), 1);
  eq(cmpVersion('0.15.9', '0.15.10'), -1);
  eq(cmpVersion('0.16', '0.16.0'), 0);
});

test('checkForUpdate: first look is the baseline, a changed build reloads once it is safe', async () => {
  _reset();
  let reloads = 0, route = 'today', build = { version: '0.15.10', builtAt: 'a' };
  const deps = { read: async () => build, route: () => route, typing: () => false, reload: () => { reloads++; } };
  eq(await checkForUpdate(deps), 'same'); // baseline
  eq(await checkForUpdate(deps), 'same');
  eq(reloads, 0);
  build = { version: '0.15.11', builtAt: 'b' };
  route = 'play'; // mid-workout: wait
  eq(await checkForUpdate(deps), 'later');
  eq(reloads, 0);
  eq(await checkForUpdate(deps), 'later'); // still waiting, still no reload
  route = 'today'; // left the player: the pending update goes through
  eq(await checkForUpdate(deps), 'reloading');
  eq(reloads, 1);
});

test('checkForUpdate: offline or unreadable never reloads', async () => {
  _reset();
  let reloads = 0;
  const base = { route: () => 'today', typing: () => false, reload: () => { reloads++; } };
  await checkForUpdate({ ...base, read: async () => ({ version: '0.15.10', builtAt: 'a' }) });
  eq(await checkForUpdate({ ...base, read: async () => { throw new Error('offline'); } }), 'same');
  eq(await checkForUpdate({ ...base, read: async () => null }), 'same');
  eq(reloads, 0);
});

test('versionChange: silent on first install, once per new version', () => {
  const s = store();
  eq(versionChange(s, '0.15.11'), null);
  eq(versionChange(s, '0.15.11'), null);
  eq(versionChange(s, '0.15.12'), { from: '0.15.11', to: '0.15.12' });
  eq(versionChange(s, '0.15.12'), null);
  eq(versionChange(s, '0.15.1'), null); // never "updated" backwards
});

test('announceUpdate: a toast with a What’s new action, only on native and only once', async () => {
  web();
  const toasts = [];
  const t = (...a) => toasts.push(a);
  eq(await announceUpdate({ store: store(), toast: t }), false);
  native();
  const s = store();
  s.setItem('forge.seenVersion', '0.0.1');
  const cur = readVersion(src('js/version.js'));
  eq(await announceUpdate({ store: s, toast: t, load: async () => ({ [cur]: { items: ['Something plain.'] } }) }), true);
  assert(/^Updated to \d+\.\d+\.\d+$/.test(toasts[0][0]), toasts[0][0]);
  eq(toasts[0][2].action.label, 'What’s new');
  eq(await announceUpdate({ store: s, toast: t }), false);
  s.setItem('forge.seenVersion', '0.0.1'); // a version with no highlights: the toast has no button
  eq(await announceUpdate({ store: s, toast: t, load: async () => ({}) }), true);
  eq(toasts[1][2], undefined);
  web();
});

test('cleanOldCaches: native only, removes service workers and forge-* caches once', async () => {
  web();
  eq(await cleanOldCaches(store()), false);
  native();
  const unreg = [], deleted = [];
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unreg.push(1); } }] } }, configurable: true });
  globalThis.caches = { keys: async () => ['forge-0.15.2', 'other', 'forge-0.15.9'], delete: async (k) => { deleted.push(k); } };
  const s = store();
  eq(await cleanOldCaches(s), true);
  eq(unreg.length, 1);
  eq(deleted, ['forge-0.15.2', 'forge-0.15.9']);
  eq(await cleanOldCaches(s), false); // not again
  delete globalThis.caches;
  if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator;
  web();
});

test('whatsNew reads only the plain What is new block; readVersion reads js/version.js', () => {
  const md = '# Changelog\n\n## 0.15.11 — Update on resume (2026-10-10)\n\n- **Dev:** see `app-install.json`.\n\n### What\'s new\n\n- Forge **updates** itself.\n- Timers are safe.\n\n## 0.15.10 — Older (2026-10-10)\n\n- Old thing\n';
  const w = whatsNew(md);
  eq(Object.keys(w), ['0.15.11', '0.15.10']);
  eq(w['0.15.11'].items, ['Forge updates itself.', 'Timers are safe.']);
  eq(w['0.15.10'].items, []);
  eq(Object.keys(whatsNew(md, 1)), ['0.15.11']);
  eq(readVersion("export const VERSION = '0.15.11';"), '0.15.11');
  const real = whatsNew(src('CHANGELOG.md'));
  const cur = real[readVersion(src('js/version.js'))].items;
  assert(cur.length >= 1 && cur.length <= 4, 'the current version has 1 to 4 highlights');
  eq(highlightsFor(real, 'nope'), []);
});

test('every What is new highlight is short, plain and complete (no code, file names or an ellipsis)', () => {
  eq(highlightProblem('Forge now updates itself.'), '');
  for (const bad of ['See `x`', 'app-install.json changed', 'run.js', 'a.command', '--flag', 'Cut off…', 'x'.repeat(91)]) assert(highlightProblem(bad), bad);
  const bad = [];
  for (const [v, { items }] of Object.entries(whatsNew(src('CHANGELOG.md'), 99))) for (const t of items) { const p = highlightProblem(t); if (p) bad.push(`${v}: "${t}" ${p}`); }
  assert(bad.length === 0, bad.join('; '));
});

test('the build writes version into app-install.json, and the app wires the check', () => {
  const b = src('scripts/build-www.mjs');
  assert(/JSON\.stringify\(\{ version, builtAt/.test(b) && b.includes('whats-new.json'));
  assert(!b.includes('short('), 'no truncation with an ellipsis');
  const app = src('js/app.js');
  assert(app.includes('./native/update.js') && app.includes('setupUpdates'));
  const u = src('js/native/update.js');
  assert(u.includes("'resume'") && u.includes('visibilitychange') && u.includes("cache: 'no-store'"));
  assert(JSON.parse(src('package.json')).devDependencies['@capacitor/app']);
  assert(src('ios/App/CapApp-SPM/Package.swift').includes('CapacitorApp'));
  const r = src('scripts/Refresh Forge.command');
  assert(r.includes('process launch --terminate-existing') && r.includes('close and reopen it'));
});

test('missions footer keeps its tail in one piece', () => {
  assert(/class="nw">\+\$\{m\.bonus\} XP bonus\./.test(src('js/missions/ui.js')), 'tail is nowrap');
  const css = src('css/missions.css');
  assert(/\.ms-foot\s*\{[^}]*text-wrap:\s*balance/.test(css) && /\.ms-foot \.nw\s*\{[^}]*nowrap/.test(css));
});
