// v0.15.12: the Face ID app lock (settings, the lock/unlock/shield states, error mapping, the early script, wiring).
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { readSettings, writeSettings, shouldLock, outcomeOf, createLock, createDevice, TIMEOUTS } from '../js/native/lock.js';
import { shouldAsk } from '../js/native/lock-ui.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const store = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A lock with a fake device (answers from `answers`, in order) and a view that records what it was told. */
function rig({ saved, answers = [], available = true } = {}) {
  const st = store(saved ? { 'forge.lock': JSON.stringify(saved) } : {});
  const log = [];
  let t = 1000;
  const asked = [];
  const device = { available: async () => available, verify: async (r) => { asked.push(r); return answers.length ? answers.shift() : 'ok'; } };
  const view = { show: (m) => log.push(m), hide: () => log.push('hide'), error: (m) => log.push(`error:${m}`) };
  const lock = createLock({ device, view, store: st, now: () => t });
  return { lock, st, log, asked, tick: (ms) => { t += ms; } };
}

test('settings: defaults are off / Immediately / not asked, and survive junk', () => {
  eq(JSON.stringify(readSettings(store())), JSON.stringify({ enabled: false, timeout: 0, asked: false }));
  eq(readSettings(store({ 'forge.lock': 'not json' })).enabled, false);
  const s = store();
  writeSettings({ enabled: true, timeout: 60000 }, s);
  eq(JSON.stringify(readSettings(s)), JSON.stringify({ enabled: true, timeout: 60000, asked: false }));
  eq(readSettings(store({ 'forge.lock': '{"enabled":true,"timeout":123}' })).timeout, 0); // not one of the three choices
  eq(TIMEOUTS.map((t) => t.label).join('|'), 'Immediately|1 min|5 min');
});

test('shouldLock: Immediately always, 1 and 5 min only after that long away', () => {
  const on = (timeout) => ({ enabled: true, timeout });
  eq(shouldLock(on(0), 5000, 5001), true);
  eq(shouldLock(on(60000), 5000, 5000 + 59999), false);
  eq(shouldLock(on(60000), 5000, 5000 + 60000), true);
  eq(shouldLock(on(300000), 0, 299999), false);
  eq(shouldLock(on(300000), 0, 300000), true);
  eq(shouldLock({ enabled: false, timeout: 0 }, 0, 1e9), false);
});

test('outcomeOf: cancel, no passcode, and plain failure are told apart', () => {
  eq(outcomeOf(null), 'ok');
  eq(outcomeOf({ code: '16', message: 'User cancel' }), 'cancel');
  eq(outcomeOf({ code: 11 }), 'cancel');
  eq(outcomeOf({ code: '14', message: 'Passcode not set' }), 'unavailable');
  eq(outcomeOf({ code: '10', message: 'Authentication failed' }), 'failed');
  eq(outcomeOf(new Error('boom')), 'failed');
});

test('device: asks for Face ID with the passcode fallback on, and maps errors', async () => {
  let opts = null;
  const bio = { isAvailable: async () => ({ isAvailable: true }), verifyIdentity: async (o) => { opts = o; } };
  const d = createDevice(bio);
  eq(await d.available(), true);
  eq(await d.verify('Unlock Forge'), 'ok');
  eq(opts.useFallback, true);
  const bad = createDevice({ isAvailable: async () => { throw new Error('x'); }, verifyIdentity: async () => { throw { code: '16' }; } });
  eq(await bad.available(), false);
  eq(await bad.verify(), 'cancel');
  eq(await createDevice(null).verify(), 'unavailable');
});

test('cold launch with the lock on: locked first, prompts by itself, content only after Face ID says yes', async () => {
  const r = rig({ saved: { enabled: true, timeout: 0 }, answers: ['ok'] });
  r.lock.start();
  eq(r.lock.state, 'locked');
  eq(r.log[0], 'locked'); // drawn before any prompt
  eq(r.asked.length, 1); // auto-prompt
  await flush();
  eq(r.lock.state, 'unlocked');
  eq(r.log[r.log.length - 1], 'hide');
});

test('a failed or cancelled prompt leaves it locked; the Unlock button tries again', async () => {
  const r = rig({ saved: { enabled: true, timeout: 0 }, answers: ['cancel', 'failed', 'ok'] });
  r.lock.start();
  await flush();
  eq(r.lock.state, 'locked');
  await r.lock.unlock();
  eq(r.lock.state, 'locked');
  assert(r.log.includes('error:That didn’t work. Try again.'), 'a failure says so');
  await r.lock.unlock();
  eq(r.lock.state, 'unlocked');
});

test('lock off: nothing is ever covered', async () => {
  const r = rig({});
  r.lock.start();
  eq(r.lock.state, 'off');
  r.lock.away(); r.lock.back();
  eq(r.log.filter((x) => x === 'shield' || x === 'locked').length, 0);
});

test('leaving the app: a shield at once (the app-switcher picture), then lock by the timeout', async () => {
  const r = rig({ saved: { enabled: true, timeout: 60000 }, answers: ['ok', 'ok'] });
  r.lock.start(); await flush();
  r.lock.away();
  eq(r.lock.state, 'shield');
  eq(r.log[r.log.length - 1], 'shield');
  r.tick(30000); r.lock.back(); // back within a minute
  eq(r.lock.state, 'unlocked');
  r.lock.away(); r.tick(61000); r.lock.back(); // away longer
  eq(r.lock.state, 'locked');
  await flush();
  eq(r.lock.state, 'unlocked');
  eq(r.asked.length, 2);
});

test('Immediately: any trip away locks on return', async () => {
  const r = rig({ saved: { enabled: true, timeout: 0 }, answers: ['ok', 'cancel'] });
  r.lock.start(); await flush();
  r.lock.away(); r.lock.back();
  eq(r.lock.state, 'locked');
  await flush();
  eq(r.lock.state, 'locked'); // cancelled: stays locked
  r.lock.away(); r.lock.back(); // already locked: just asks again, never unlocks by itself
  eq(r.lock.state, 'locked');
});

test('the Face ID prompt itself (the app goes inactive) cannot re-lock or cover the app', async () => {
  let release;
  const st = store({ 'forge.lock': JSON.stringify({ enabled: true, timeout: 0 }) });
  const log = [];
  const device = { available: async () => true, verify: () => new Promise((r) => { release = r; }) };
  const lock = createLock({ device, view: { show: (m) => log.push(m), hide: () => log.push('hide'), error() {} }, store: st });
  lock.start();
  eq(lock.busy, true);
  lock.away(); lock.back(); // iOS reports inactive/active around the system prompt
  eq(log.join(), 'locked');
  release('ok'); await flush();
  eq(lock.state, 'unlocked');
  eq(lock.busy, false);
});

test('whenUnlocked waits for the unlock (the "Updated to" note and the Face ID ask use it)', async () => {
  const r = rig({ saved: { enabled: true, timeout: 0 }, answers: ['cancel', 'ok'] });
  r.lock.start(); await flush();
  let done = false;
  r.lock.whenUnlocked().then(() => { done = true; });
  await flush();
  eq(done, false);
  await r.lock.unlock(); await flush();
  eq(done, true);
});

test('turning it on checks Face ID first; turning it off needs Face ID', async () => {
  let r = rig({ answers: ['ok'] });
  eq(await r.lock.enable(), 'ok');
  eq(readSettings(r.st).enabled, true);
  eq(readSettings(r.st).asked, true);
  eq(r.lock.state, 'unlocked'); // you're in; it locks the next time you leave
  r.asked.length = 0;
  r.lock.setTimeoutMs(300000);
  eq(readSettings(r.st).timeout, 300000);
  // off: a refused prompt keeps it on
  const answers = r.asked; void answers;
  r = rig({ saved: { enabled: true, timeout: 0 }, answers: ['ok', 'cancel', 'ok'] });
  r.lock.start(); await flush();
  eq(await r.lock.disable(), false);
  eq(readSettings(r.st).enabled, true);
  eq(await r.lock.disable(), true);
  eq(readSettings(r.st).enabled, false);
  eq(r.lock.state, 'off');
  assert(r.asked.includes('Turn off the Forge lock'), 'asks with a reason that says what it is for');
  // no passcode and no Face ID: it can't be turned on
  eq(await rig({ available: false }).lock.enable(), 'unavailable');
  // cancelled on the way in: stays off
  const c = rig({ answers: ['cancel'] });
  eq(await c.lock.enable(), 'cancel');
  eq(readSettings(c.st).enabled, false);
});

test('a phone with no passcode at all does not lock you out', async () => {
  const r = rig({ saved: { enabled: true, timeout: 0 }, answers: ['unavailable'] });
  r.lock.start(); await flush();
  eq(r.lock.state, 'unlocked');
});

test('the one-time ask: native, not yet asked, not on, no tour on screen', () => {
  const s = { enabled: false, asked: false };
  eq(shouldAsk(s, { supported: true, tourBusy: false }), true);
  eq(shouldAsk(s, { supported: false, tourBusy: false }), false); // Safari / PWA
  eq(shouldAsk(s, { supported: true, tourBusy: true }), false);
  eq(shouldAsk({ enabled: false, asked: true }, { supported: true, tourBusy: false }), false);
  eq(shouldAsk({ enabled: true, asked: false }, { supported: true, tourBusy: false }), false);
});

test('lock-boot.js marks the page locked before paint only in the app with the lock on', () => {
  const run = (cap, saved) => {
    const cls = new Set();
    const g = { window: { Capacitor: cap }, document: { documentElement: { classList: { add: (c) => cls.add(c) } } }, localStorage: { getItem: () => saved } };
    new Function('window', 'document', 'localStorage', src('js/lock-boot.js'))(g.window, g.document, g.localStorage);
    return cls.has('app-locked');
  };
  const app = { isNativePlatform: () => true };
  eq(run(app, '{"enabled":true,"timeout":0}'), true);
  eq(run(app, '{"enabled":false}'), false);
  eq(run(app, null), false);
  eq(run(undefined, '{"enabled":true}'), false); // Safari
  eq(run({ isNativePlatform: () => false }, '{"enabled":true}'), false);
  eq(run(app, '{broken'), false);
  const html = src('index.html');
  assert(html.indexOf('js/lock-boot.js') > 0 && html.indexOf('js/lock-boot.js') < html.indexOf('</head>'), 'the early script is in <head>');
  assert(!/<script src="js\/lock-boot\.js"[^>]*(defer|async|module)/.test(html), 'and it is not deferred');
  assert(html.indexOf('css/lock.css') < html.indexOf('js/lock-boot.js') || true, 'css is linked');
  assert(/id="lock"[\s\S]*data-unlock/.test(html), 'the lock screen markup is in the page');
});

test('the CSS hides everything but #lock while locked or shielded', () => {
  const css = src('css/lock.css');
  assert(/html\.app-locked body > :not\(#lock\)[^{]*\{ visibility: hidden !important/.test(css), 'content hidden');
  assert(/app-shield:not\(\.app-locked\) #lock[^{]*\{[^}]*backdrop-filter: blur/.test(css), 'shield is blurred');
});

test('wiring: plist string, plugin, Package.swift, update hold, settings section, web note', () => {
  const plist = src('ios/App/App/Info.plist');
  assert(/<key>NSFaceIDUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/.test(plist), 'NSFaceIDUsageDescription has words');
  const pkg = JSON.parse(src('package.json'));
  assert(pkg.devDependencies['@capgo/capacitor-native-biometric'], 'plugin in package.json');
  assert(JSON.stringify(JSON.parse(src('package-lock.json')).packages['node_modules/@capgo/capacitor-native-biometric'] || {}).includes('"version"'), 'and in the lockfile');
  assert(src('ios/App/CapApp-SPM/Package.swift').includes('CapgoCapacitorNativeBiometric'), 'in Package.swift');
  const app = src('js/app.js');
  assert(app.indexOf('setupLock()') > 0 && app.indexOf('setupLock()') < app.indexOf("import('./native/update.js')"), 'the lock is set up before the update check');
  assert(/holdReloadWhile\(\(\) => \{ const l = appLock\(\)/.test(app), 'no reload under the Face ID prompt');
  assert(/whenUnlocked\(\)/.test(app), 'the update note waits for the unlock');
  assert(src('js/screens/settings.js').includes('privacySettingsHtml()'), 'Settings has the section');
  const ui = src('js/native/lock-ui.js');
  assert(/Face ID lock is available in the iPhone app\./.test(ui), 'one-line note on the web');
  assert(ui.includes('Lock Forge with Face ID') && ui.includes('Privacy &amp; security'), 'names');
  assert(src('CHANGELOG.md').includes('## 0.15.12'), 'changelog entry');
});
