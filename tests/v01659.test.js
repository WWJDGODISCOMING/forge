// v0.16.59: live workout discard / end / restore and Start workout. The modules import Firebase from a CDN, so these
// check the code paths in the source (the live-core maths is covered in v01651).
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { VERSION } from '../js/version.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const body = (src, start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a + 1); return src.slice(a, b < 0 ? undefined : b); };

test('version is 0.16.59 in js and sw', () => {
  eq(VERSION, '0.16.59');
  assert(read('sw.js').includes("const VERSION = '0.16.59'"));
  assert(read('CHANGELOG.md').includes('## 0.16.59'));
});

test('discard clears the session and storage before it waits on native, and native waits are capped', () => {
  const src = read('js/native/live-workout.js');
  const d = body(src, 'export async function discard', 'export async function refresh');
  assert(d.indexOf('session = null') < d.indexOf('endLive'), 'state cleared first');
  assert(d.indexOf('save()') < d.indexOf('endLive'), 'storage cleared first');
  assert(d.includes('quick('), 'native stop is time-boxed');
  assert(d.includes('gone.add'));
});

test('end clears the session before the native save, so nothing can restore it', () => {
  const f = body(read('js/native/live-workout.js'), 'export async function finish', 'export async function discard');
  assert(f.indexOf('session = null') < f.indexOf('endLive('), 'cleared first');
  assert(f.includes('gone.add'));
  assert(f.includes('quick('));
});

test('restore is idempotent and drops finished, unknown or discarded leftovers', () => {
  const r = body(read('js/native/live-workout.js'), 'export function restore', 'function onNative');
  assert(r.includes('if (session) return session'));
  assert(r.includes('gone.has'));
  assert(r.includes('removeItem'));
  assert(r.includes('LIVE_KINDS[o.session.kind]'));
});

test('a late native update for another or a finished workout is ignored', () => {
  const n = body(read('js/native/live-workout.js'), 'function onNative', 'function attach');
  assert(n.includes('!session'));
  assert(n.includes('e.id !== session.id'));
});

test('End always opens the sheet (or redraws the truth); Discard is confirmed inside the one sheet', () => {
  const src = read('js/screens/live.js');
  assert(src.includes('if (!cur) return renderLive(el)'));
  assert(!src.includes('confirmSheet'), 'no second sheet opened over a closing one');
  assert(src.includes('data-sure'));
  const end = body(src, "$('[data-end]', el).onclick", 'clearInterval(tickId)');
  assert(end.indexOf('stopTicking()') < end.indexOf('live.discard()'), 'ticking stops, then discard');
  assert(end.includes("location.hash = '#/train'"));
});

test('Start workout explains a running live workout and offers to end it', () => {
  const t = read('js/screens/train.js');
  const s = body(t, 'export function startPlan', 'dayOverride = null');
  assert(s.includes('liveWorkout.isActive()') && s.indexOf('liveBlocksStart') < s.indexOf('startWorkout(plan)'));
  assert(t.includes('A live workout is running') && t.includes('data-endit') && t.includes('data-open'));
});

test('resume draws Today for a returning user without waiting for every collection', () => {
  const a = read('js/app.js');
  assert(a.includes('mayDrawEarly()'));
  assert(a.includes('state.loaded.profile && state.loaded.settings'));
});
