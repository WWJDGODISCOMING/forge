import { test, eq, assert } from './harness.js';
import { workoutTotals, comparableWorkout, fmtHold, deltaText, setLine } from '../js/workouts/totals.js';

const lib = {
  bench: { id: 'bench', load: 'barbell' },
  curl: { id: 'curl', load: 'dumbbell', unilateral: true },
  plank: { id: 'plank', timed: true, load: 'bodyweight' },
  vest: { id: 'vest', timed: true, load: 'other' },
  pushup: { id: 'pushup', load: 'bodyweight' },
};
const lookup = (id) => lib[id] || null;
const set = (reps, weight_kg, extra = {}) => ({ done: true, reps, weight_kg, ...extra });
const wk = (id, label, started_at, exercises) => ({ id, label, started_at, status: 'done', exercises });

test('totals: volume is weight x reps, warm-ups and undone sets are skipped', () => {
  const w = wk('a', 'Push', '2026-10-01', [{ exercise_id: 'bench', sets: [set(10, 20), set(5, 100, { warmup: true }), { reps: 8, weight_kg: 20 }] }]);
  const t = workoutTotals(w, lookup);
  eq(t.volume, 200);
  eq(t.reps, 10);
  eq(t.holdSec, 0);
});

test('totals: per-arm moves count both sides, in the display unit', () => {
  const w = wk('a', 'Pull', '2026-10-01', [{ exercise_id: 'curl', sets: [set(10, 10)] }]);
  const t = workoutTotals(w, lookup, (kg) => kg * 2);
  eq(t.volume, 400);
  eq(t.reps, 20);
});

test('totals: timed moves add hold time, not reps; bodyweight adds reps, no volume', () => {
  const w = wk('a', 'Core', '2026-10-01', [
    { exercise_id: 'plank', sets: [set(45, null), set(30, null)] },
    { exercise_id: 'vest', sets: [set(20, 10)] },
    { exercise_id: 'pushup', sets: [set(12, null)] },
  ]);
  const t = workoutTotals(w, lookup);
  eq(t.holdSec, 95);
  eq(t.reps, 12);
  eq(t.volume, 0);
});

test('totals: comparable workout is the latest earlier one with the same label', () => {
  const all = [wk('1', 'Push', '2026-09-20', []), wk('2', 'Push', '2026-09-27', []), wk('3', 'Pull', '2026-09-28', []), wk('4', 'Push', '2026-10-05', [])];
  eq(comparableWorkout(all[3], all).id, '2');
  eq(comparableWorkout(all[0], all), null);
  eq(comparableWorkout({ ...all[3], label: '' }, all), null);
});

test('totals: delta text and tone', () => {
  eq(deltaText(120, 100).text, '+20 vs last');
  eq(deltaText(120, 100).tone, 'up');
  eq(deltaText(80, 100).text, '−20 vs last');
  eq(deltaText(80, 100).tone, 'down');
  eq(deltaText(5, 5).tone, 'same');
  eq(deltaText(5, null), null);
  eq(deltaText(95, 60, fmtHold).text, '+35 s vs last');
});

test('totals: hold time formatting and set lines', () => {
  eq(fmtHold(45), '45 s');
  eq(fmtHold(125), '2:05');
  eq(setLine({ reps: 10, weight: 30 }, lib.bench, 'lb'), '10 reps x 30 lb');
  eq(setLine({ reps: 1, weight: null }, lib.pushup, 'lb'), '1 rep');
  eq(setLine({ reps: 45, weight: null }, lib.plank, 'lb'), '45 s');
  eq(setLine({ reps: 20, weight: 10 }, lib.vest, 'kg'), '20 s x 10 kg');
  assert(!setLine({ reps: 8, weight: 0 }, lib.bench, 'lb').includes('x'));
});
