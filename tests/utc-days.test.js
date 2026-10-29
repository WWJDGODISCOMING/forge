// #248: timestamps become local days (America/New_York), not UTC days. Synthetic data only.
import { test, eq } from './harness.js';
import { liftChanges } from '../js/coach/lifts.js';
import { dayKey } from '../js/weight/smoothing.js';

const inNY = (fn) => {
  const was = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
};

const wk = (started_at, kg) => ({
  id: started_at, status: 'done', started_at, finished_at: started_at,
  exercises: [{ exercise_id: 'barbell-back-squat', role: 'main', sets: [{ done: true, weight_kg: kg, reps: 5 }] }], prs: [],
});

test('dayKey puts a 9:30 PM ET workout on its own evening', () => {
  eq(inNY(() => dayKey('2026-10-28T01:30:00.000Z')), '2026-10-27');
});

test('liftChanges: an evening-ET workout on the last day of block 0 still counts', () => {
  const l = inNY(() => liftChanges({
    workouts: [wk('2026-10-28T01:30:00.000Z', 100), wk('2026-09-20T15:00:00.000Z', 90)],
    unit: 'kg', today: '2026-10-27', nameOf: () => 'Squat',
  }));
  eq(l.length, 1);
  eq(l[0].now != null, true, 'the Oct 27 evening session is in block 0');
});

test('liftChanges: an evening session just before block 0 starts is not pulled into block 0', () => {
  // today 10-27: block 0 = 09-30..10-27. 09-30 01:30Z is Sep 29, 9:30 PM ET => block 1.
  const l = inNY(() => liftChanges({
    workouts: [wk('2026-10-20T15:00:00.000Z', 100), wk('2026-09-30T01:30:00.000Z', 80)],
    unit: 'kg', today: '2026-10-27', nameOf: () => 'Squat',
  }));
  eq(l[0].before4 != null, true);
  eq(l[0].change4 > 0, true);
});
