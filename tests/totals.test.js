import { test, eq, assert } from './harness.js';
import { workoutTotals, comparableWorkout, fmtHold, deltaText, setLine, kcalReading, kcalComparable, KCAL_TAG } from '../js/workouts/totals.js';
import { fitText } from '../js/ui/sharecard.js';

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

test('calories: a saved number wins, else the estimate, and each carries its source', () => {
  const r = (w, e) => { const k = kcalReading(w, e); return `${k.kcal} ${k.source}`; };
  eq(r({ kcal: 312.4, kcal_source: 'apple_watch' }, 250), '312 apple_watch');
  eq(r({ kcal: 280, kcal_source: 'measured' }, 250), '280 measured');
  eq(r({ kcal: 280 }, 250), '280 estimate');
  eq(r({}, 249.6), '250 estimate');
  eq(kcalReading({}, null), null);
  eq(KCAL_TAG.estimate, 'est.');
});

test('calories: the change shows only against the same kind of number', () => {
  const watch = { kcal: 300, source: 'apple_watch' };
  const est = { kcal: 250, source: 'estimate' };
  eq(kcalComparable(watch, { kcal: 280, source: 'apple_watch' }), 280);
  eq(kcalComparable(est, { kcal: 240, source: 'estimate' }), 240);
  eq(kcalComparable(watch, est), null);
  eq(kcalComparable(est, { kcal: 300, source: 'measured' }), null);
  eq(kcalComparable(est, null), null);
});

test('share image: fitText keeps long labels and big numbers inside their box', () => {
  // A stand-in canvas: each character is 0.55 of the font size wide.
  const ctx = { font: '', measureText(t) { const px = Number(/(\d+)px/.exec(this.font)[1]); return { width: t.length * px * 0.55 }; } };
  const px = () => Number(/(\d+)px/.exec(ctx.font)[1]);
  const wide = (t) => ctx.measureText(t).width;
  const rest = '1:05 · 24 sets';
  const sub = `Upper body strength and shoulders, heavy day with the long name · ${rest}`;
  const a = fitText(ctx, sub, 936, { weight: 600, size: 38, min: 26, keep: rest.length + 3 });
  assert(wide(a) <= 936, `subtitle is ${wide(a)}px`);
  assert(a.endsWith(` · ${rest}`) && a.includes('…'), `the label is cut and time and sets stay: ${a}`);
  const v = fitText(ctx, '12,345 lb', 396, { weight: 900, size: 54, min: 30 });
  assert(wide(v) <= 396 && v === '12,345 lb', 'a 5-digit volume fits as is or shrunk');
  const huge = fitText(ctx, '1,234,567,890 lb', 396, { weight: 900, size: 54, min: 30 });
  assert(wide(huge) <= 396 && px() >= 30, 'an absurdly long value still fits, never below the smallest size');
  const d = fitText(ctx, '−1,234 vs last, which is a very long change line', 396, { weight: 700, size: 26, min: 18 });
  assert(wide(d) <= 396, 'the change line fits');
  eq(fitText(ctx, 'Push', 936, { size: 38, min: 26 }), 'Push');
});
