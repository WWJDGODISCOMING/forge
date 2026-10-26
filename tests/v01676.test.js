// v0.16.76 (#227): progress photo camera: reliable shutter, clean close, error recovery, self-timer. Synthetic only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { VERSION } from '../js/version.js';
import { TIMER_STEPS, TIMER_KEY, nextTimer, timerLabel, loadTimer, saveTimer, createCountdown, grabFrame } from '../js/photos/viewfinder.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const memStore = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

// A fake clock so countdown tests don't wait.
const clock = () => {
  const q = [];
  return { setT: (fn) => { q.push(fn); return q.length; }, clearT: (id) => { q[id - 1] = null; }, tick: () => { const fn = q.shift(); if (fn) fn(); return !!fn; }, size: () => q.filter(Boolean).length };
};

const canvasFor = (blobOut, throwOn) => () => ({
  width: 0, height: 0,
  getContext: () => ({ translate() {}, scale() {}, drawImage() { if (throwOn === 'draw') throw new Error('draw'); } }),
  toBlob(cb) { if (blobOut !== 'never') cb(blobOut); },
});
const vid = { videoWidth: 640, videoHeight: 480 };

test('v0.16.76: timer cycles Off, 3s, 10s and back', () => {
  eq(TIMER_STEPS.join(), '0,3,10');
  eq(nextTimer(0), 3); eq(nextTimer(3), 10); eq(nextTimer(10), 0);
  eq(timerLabel(0), 'Timer off'); eq(timerLabel(10), 'Timer 10 seconds');
});

test('v0.16.76: the last timer choice is remembered, and junk falls back to off', () => {
  const s = memStore();
  eq(loadTimer(s), 0);
  saveTimer(10, s);
  eq(loadTimer(s), 10);
  s.setItem(TIMER_KEY, '7');
  eq(loadTimer(s), 0);
  eq(loadTimer({ getItem() { throw new Error('private'); } }), 0);
  saveTimer(3, { setItem() { throw new Error('private'); } }); // must not throw
});

test('v0.16.76: a 3 second countdown ticks 3, 2, 1 and then fires once', () => {
  const c = clock(); const ticks = []; let done = 0;
  createCountdown({ seconds: 3, onTick: (n) => ticks.push(n), onDone: () => done++, setT: c.setT, clearT: c.clearT });
  eq(ticks.join(), '3');
  c.tick(); c.tick();
  eq(ticks.join(), '3,2,1'); eq(done, 0);
  c.tick();
  eq(done, 1);
  eq(c.tick(), false, 'nothing left scheduled');
});

test('v0.16.76: cancelling a countdown never takes the photo', () => {
  const c = clock(); let done = 0;
  const cd = createCountdown({ seconds: 10, onTick() {}, onDone: () => done++, setT: c.setT, clearT: c.clearT });
  c.tick();
  cd.cancel();
  eq(cd.active, false);
  for (let i = 0; i < 12; i++) c.tick();
  eq(done, 0);
});

test('v0.16.76: capture gives a JPEG file, mirrored only for the front camera', async () => {
  const f = await grabFrame({ video: vid, makeCanvas: canvasFor(new Blob(['x'], { type: 'image/jpeg' })), facing: 'environment' });
  eq(f.name, 'pose.jpg'); eq(f.type, 'image/jpeg');
  let flipped = 0;
  const mk = () => ({ ...canvasFor(new Blob(['x']))(), getContext: () => ({ translate() { flipped++; }, scale() {}, drawImage() {} }) });
  await grabFrame({ video: vid, makeCanvas: mk, facing: 'user' });
  eq(flipped, 1);
});

test('v0.16.76: capture errors reject instead of hanging (no blob, draw failure, timeout, no frame yet)', async () => {
  const fails = async (opts) => { try { await grabFrame(opts); return false; } catch { return true; } };
  assert(await fails({ video: vid, makeCanvas: canvasFor(null), facing: 'environment' }), 'null blob');
  assert(await fails({ video: vid, makeCanvas: canvasFor(new Blob(['x']), 'draw'), facing: 'environment' }), 'draw throws');
  assert(await fails({ video: { videoWidth: 0, videoHeight: 0 }, makeCanvas: canvasFor(new Blob(['x'])), facing: 'environment' }), 'not ready');
  assert(await fails({ video: vid, makeCanvas: canvasFor('never'), facing: 'environment', ms: 5 }), 'timeout');
});

test('v0.16.76: close and error paths release the camera and leave the page tappable', () => {
  const v = read('js/photos/viewfinder.js');
  const teardown = v.slice(v.indexOf('const teardown'), v.indexOf('const finish'));
  assert(/cam\.close\(\)/.test(teardown) && /srcObject = null/.test(teardown), 'camera released');
  assert(/root\.remove\(\)/.test(teardown) && /querySelectorAll\('\.vf'\)/.test(teardown), 'no overlay left behind');
  assert(/removeEventListener\('keydown'/.test(teardown) && /removeEventListener\('visibilitychange'/.test(teardown), 'listeners off');
  assert(/const fail = /.test(v) && /toast\(/.test(v) && /resolve\(null\)/.test(v), 'error closes with a gentle toast');
  assert(/grabFrame\(/.test(v) && /catch \{\s*fail\(\)/.test(v), 'shutter errors go to fail()');
});

test('v0.16.76: the timer shows in the top bar, big countdown, ticks and Duo-safe layout', () => {
  const v = read('js/photos/viewfinder.js');
  assert(/data-timer/.test(v) && /data-count/.test(v), 'timer button and countdown');
  assert(/haptics\.select\(\)/.test(v), 'ticks');
  const css = read('css/photos.css');
  assert(/\.vf-count \{[^}]*font-size: min\(40vw/.test(css), 'big countdown');
  assert(/\.vf-title \{[^}]*text-overflow: ellipsis/.test(css), 'title shrinks so the bar fits narrow Duo widths and large text');
});

test('v0.16.76: version bumped in js and sw', () => {
  eq(VERSION, '0.16.76');
  assert(read('sw.js').includes("const VERSION = '0.16.76'"), 'sw');
  assert(read('CHANGELOG.md').includes('## 0.16.76'), 'changelog');
});
