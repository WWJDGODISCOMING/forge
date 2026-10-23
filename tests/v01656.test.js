import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { canViewfinder, nextGhost, GHOST_LEVELS, createCamera, systemCameraHtml } from '../js/photos/viewfinder.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const cam = { navigator: { mediaDevices: { getUserMedia() {} } } };

test('v0.16.56: the viewfinder is for the iPhone app with a camera only (a no-op on the web)', () => {
  eq(canViewfinder(true, cam), true);
  eq(canViewfinder(false, cam), false);
  eq(canViewfinder(true, { navigator: {} }), false);
  eq(canViewfinder(true, {}), false);
});

test('v0.16.56: the ghost button cycles faint, stronger, off, then faint again', () => {
  eq(nextGhost(GHOST_LEVELS[0]), GHOST_LEVELS[1]);
  eq(nextGhost(GHOST_LEVELS[1]), 0);
  eq(nextGhost(0), GHOST_LEVELS[0]);
  assert(GHOST_LEVELS[1] > GHOST_LEVELS[0], 'stronger is stronger');
});

test('v0.16.56: capture sheet uses the viewfinder with a system-picker fallback; the shell caches it', () => {
  const c = read('js/photos/capture.js');
  assert(/canViewfinder\(\)/.test(c) && /openViewfinder\(/.test(c), 'wired');
  assert(/systemCameraHtml\(\)/.test(c) && !/pick\.click\(\)/.test(c), 'fallback is a real label, not a programmatic click');
  assert(read('sw.js').includes("'./js/photos/viewfinder.js'"), 'in the offline shell');
  assert(/\.vf-btn \{ min-width: 44px; height: 44px/.test(read('css/photos.css')), '44 pt targets');
});

const fakeStream = () => { const t = { stopped: 0, stop() { this.stopped++; } }; return { t, getTracks: () => [t] }; };
const fakeVideo = () => ({ classList: { toggle() {} }, play: async () => {} });

test('v0.16.56: a camera that arrives after Cancel is stopped (no stray camera light)', async () => {
  const s = fakeStream();
  let give;
  const cam = createCamera({ getUserMedia: () => new Promise((r) => { give = () => r(s); }), video: fakeVideo() });
  const started = cam.start('environment');
  cam.close();
  give();
  eq(await started, false);
  eq(s.t.stopped, 1);
});

test('v0.16.56: two quick starts: the first stream is stopped, the second goes live', async () => {
  const a = fakeStream(); const b = fakeStream();
  const gives = [];
  const cam = createCamera({ getUserMedia: () => new Promise((r) => gives.push(r)), video: fakeVideo() });
  const p1 = cam.start('environment');
  const p2 = cam.start('user');
  gives[0](a); gives[1](b);
  eq(await p1, false); eq(await p2, true);
  eq(a.t.stopped, 1); eq(b.t.stopped, 0);
  cam.close();
  eq(b.t.stopped, 1);
});

test('v0.16.56: a failed start rejects', async () => {
  const cam = createCamera({ getUserMedia: async () => { throw new Error('denied'); }, video: fakeVideo() });
  let err = null;
  try { await cam.start('environment'); } catch (e) { err = e; }
  assert(err && err.message === 'denied', 'rejects');
});

test('v0.16.56: the fallback is a real capture="environment" input', () => {
  const h = systemCameraHtml();
  assert(/<label/.test(h) && /type="file"/.test(h) && /capture="environment"/.test(h), 'label + file input');
});

test('v0.16.56: viewfinder handles background, flip failure, focus and meals', () => {
  const v = read('js/photos/viewfinder.js');
  assert(/visibilitychange/.test(v) && /removeEventListener\('visibilitychange'/.test(v), 'background restart');
  assert(/Couldn’t switch cameras/.test(v), 'flip failure message');
  assert(/shutter\.focus\(\)/.test(v) && /opener\.focus/.test(v), 'focus in and out');
  assert(/aria-pressed="true"/.test(v), 'aria-pressed from the start');
  assert(/Meal photos/.test(read('docs/ios-setup.md')), 'meals decision recorded');
});

test('v0.16.56: the tab-bar decision is written down', () => {
  assert(/\*\*Tab bar\*\* \| \*\*Keep the CSS glass bar/.test(read('docs/ios-setup.md')), 'decision in docs/ios-setup.md');
});
