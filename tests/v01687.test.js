// v0.16.87 (#246): rest survives a relaunch, Finish is idempotent, away time counts once, stale saves are dropped.
// js/workouts/live.js imports Firebase from a CDN, so its guards are checked in the source; the pure parts run for real.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { removeAwayFields, restIsOrphaned } from '../js/workouts/clock.js';
import { windowFor } from '../js/workouts/energy.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const body = (src, start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a + 1); return src.slice(a, b < 0 ? undefined : b); };

const KEYS = ['profile', 'settings', 'locations', 'weights', 'workouts', 'cardio', 'programs', 'exercises'];
const stub = ({ loaded = KEYS, workouts = [] } = {}) => {
  const l = Object.fromEntries(KEYS.map((k) => [k, loaded.includes(k)]));
  return { user: { uid: 'u' }, loaded: l, partial: KEYS.some((k) => !l[k]), workouts };
};

test('a restored rest survives a boot where profile loads before workouts', () => {
  eq(restIsOrphaned(stub({ loaded: ['profile', 'settings'], workouts: [] })), false);
  eq(restIsOrphaned(stub({ loaded: KEYS.filter((k) => k !== 'cardio'), workouts: [] })), false, 'still partial');
});

test('the rest is dropped once workouts loaded with none active', () => {
  eq(restIsOrphaned(stub({ workouts: [] })), true);
  eq(restIsOrphaned(stub({ workouts: [{ id: 'a', status: 'done' }, { id: 'b', status: 'active', deleted: true }] })), true);
  eq(restIsOrphaned(stub({ workouts: [{ id: 'a', status: 'active' }] })), false);
});

test('app.js uses the guard', () => {
  assert(/restIsOrphaned\(state\)/.test(read('js/app.js')));
});

test('finishWorkout returns null with no live workout, before touching anything', () => {
  const src = read('js/workouts/live.js');
  const fn = body(src, 'export function finishWorkout()', 'let lastFinished');
  assert(/const w = live\.w;\s*if \(!w\) return null;/.test(fn), 'guard first');
  assert(fn.indexOf('if (!w) return null') < fn.indexOf('isPaused(w)'), 'before isPaused/elapsedMs');
});

test('saveAndSummarize no-ops on null', () => {
  const fn = body(read('js/screens/overlays.js'), 'export function saveAndSummarize()', 'export async function offerHealth');
  assert(/if \(id == null\) return;/.test(fn));
  assert(fn.indexOf('id == null') < fn.indexOf('location.hash'));
  assert(fn.indexOf('id == null') < fn.indexOf('afterFinish'));
});

test('removeAwayFields adds only the newly covered time when the gap overlaps a pause', () => {
  const T = Date.parse('2026-01-05T10:00:00Z');
  const min = 60000;
  const iso = (ms) => new Date(ms).toISOString();
  const w = { started_at: iso(T - 30 * min), paused_ms: 5 * min, pauses: [{ start: iso(T), end: iso(T + 5 * min) }] };
  const r = removeAwayFields(w, 10 * min, T + 20 * min, T + 2 * min);
  eq(r.paused_ms - w.paused_ms, 7 * min, 'recorded pause is T+5m..T+12m');
  const recorded = r.pauses.reduce((n, p) => n + (Date.parse(p.end) - Date.parse(p.start)), 0);
  eq(recorded, r.paused_ms, 'paused_ms matches the pauses');
  const done = { ...w, ...r, duration_ms: 20 * min };
  const win = windowFor(done);
  eq(Date.parse(win.end) - Date.parse(win.start) - recorded, done.duration_ms, 'Health active time equals duration_ms');
});

test('removeAwayFields with no overlap adds the whole gap; a gap fully inside a pause adds nothing', () => {
  const T = Date.parse('2026-01-05T10:00:00Z');
  const min = 60000;
  const iso = (ms) => new Date(ms).toISOString();
  eq(removeAwayFields({ paused_ms: 0, pauses: [] }, 8 * min, T, T - 8 * min).paused_ms, 8 * min);
  const w = { paused_ms: 10 * min, pauses: [{ start: iso(T), end: iso(T + 10 * min) }] };
  const r = removeAwayFields(w, 4 * min, T + 20 * min, T + 2 * min);
  eq(r.paused_ms, 10 * min);
  eq(r.pauses.length, 1);
});

test('syncLive clears a pending save when the workout leaves active', () => {
  const fn = body(read('js/workouts/live.js'), 'export function syncLive()', 'export function save(');
  const none = body(fn, 'if (!w) {', 'if (!live.w || live.w.id');
  assert(/clearTimeout\(saveTimer\)/.test(none), 'timer cleared when no active doc');
  assert(/saveTimer = null/.test(none));
});
