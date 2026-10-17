// v0.16.20: effort ratings (RIR) drive progression. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { nextTarget } from '../js/workouts/progression.js';
import { hardestSet, shouldAskEffort, exerciseRir, setEffort } from '../js/workouts/effort.js';
import { buildIndex } from '../js/workouts/history.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BENCH = { id: 'bench', load: 'barbell', kind: 'compound', pattern: 'horizontal_push', reps: [6, 10] };
const PUSHUP = { id: 'pu', load: 'bodyweight', kind: 'compound', pattern: 'horizontal_push', reps: [8, 15] };
const PLANK = { id: 'plank', load: 'bodyweight', timed: true, reps: [30, 60] };
const sess = (weight, reps, rir, n = 3, planReps) => ({ date: 'd', rir, sets: Array.from({ length: n }, () => ({ weight, reps, rir: null, planReps: planReps ?? reps })) });
const T = (ex, hist, o = {}) => nextTarget(ex, hist, { unit: 'lb', role: 'main', experience: 'intermediate', ...o });

test('no rating: same as before (top of range, weight up one step)', () => {
  const t = T(BENCH, [sess(100, 10, null)]);
  eq(t.weight, 105);
  eq(t.mode, 'weight');
});

test('RIR 2: normal progression', () => {
  const t = T(BENCH, [sess(100, 10, 2)]);
  eq(t.weight, 105);
  assert(!/easy/.test(t.note));
});

test('RIR 3+ with every set at the top: one extra step, reason in the user units', () => {
  const t = T(BENCH, [sess(100, 10, 3)]);
  eq(t.weight, 110);
  eq(t.note, 'Felt easy last time, +10 lb.');
  eq(T(BENCH, [sess(100, 10, 4)]).weight, 110);
  const kg = T(BENCH, [sess(60, 10, 3)], { unit: 'kg' });
  eq(kg.weight, 65);
  eq(kg.note, 'Felt easy last time, +5 kg.');
});

test('RIR 3+ below the top of the range: +2 reps, same weight', () => {
  const t = T(BENCH, [sess(100, 7, 3)]);
  eq(t.weight, 100);
  eq(t.reps, 9);
  eq(t.note, 'Felt easy last time, +2 reps.');
});

test('RIR 3+ on bodyweight: +2 reps', () => {
  const t = T(PUSHUP, [sess(null, 10, 3)]);
  eq(t.reps, 12);
  eq(t.note, 'Felt easy last time, +2 reps.');
  eq(T(PUSHUP, [sess(null, 10, 2)]).reps, 11);
});

test('RIR 1: hold the weight, add a rep only below the top', () => {
  const a = T(BENCH, [sess(100, 8, 1)]);
  eq(a.weight, 100);
  eq(a.reps, 9);
  const b = T(BENCH, [sess(100, 10, 1)]);
  eq(b.weight, 100);
  eq(b.reps, 10);
});

test('RIR 0: hold; a second tough session in a row eases about 5%', () => {
  const a = T(BENCH, [sess(100, 10, 0)]);
  eq(a.weight, 100);
  eq(a.mode, 'hold');
  const b = T(BENCH, [sess(100, 8, 0), sess(100, 8, 0)]);
  eq(b.weight, 95);
  eq(b.mode, 'ease');
  const c = T(BENCH, [sess(100, 8, 0), sess(100, 8, 2)]);
  eq(c.weight, 100);
});

test('missed reps (rated): hold, and ease after two in a row', () => {
  const a = T(BENCH, [sess(100, 7, 2, 3, 8)]);
  eq(a.weight, 100);
  eq(a.mode, 'hold');
  const b = T(BENCH, [sess(100, 7, 2, 3, 8), sess(100, 7, null, 3, 8)]);
  eq(b.weight, 95);
});

test('deload weeks ignore the rating', () => {
  const t = T(BENCH, [sess(100, 10, 4)], { deload: true });
  eq(t.mode, 'deload');
  assert(!/easy/.test(t.note));
});

test('timed exercises ignore the rating', () => {
  const a = T(PLANK, [sess(null, 40, 4, 2)]);
  const b = T(PLANK, [sess(null, 40, null, 2)]);
  eq(a.reps, b.reps);
});

test('hardest set: highest estimated 1RM, ties go to the last', () => {
  const sets = [{ weight_kg: 100, reps: 5, rir: 2 }, { weight_kg: 100, reps: 8, rir: 0 }, { weight_kg: 80, reps: 5, rir: 3 }];
  eq(hardestSet(sets), sets[1]);
  const same = [{ weight_kg: 50, reps: 8 }, { weight_kg: 50, reps: 8 }];
  eq(hardestSet(same), same[1]);
});

const done = (reps, plan, extra = {}) => ({ warmup: false, done: true, reps, plan_reps: plan, weight_kg: 50, rir: null, ...extra });
test('prompt skip rules', () => {
  const ok = { sets: [done(8, 8), done(8, 8)] };
  eq(shouldAskEffort(ok, BENCH), true);
  eq(shouldAskEffort({ sets: [done(8, 8), done(8, 8, { done: false })] }, BENCH), false, 'not the last set yet');
  eq(shouldAskEffort({ sets: [done(8, 8), done(6, 8)] }, BENCH), false, 'missed reps');
  eq(shouldAskEffort({ sets: [done(8, 8, { rir: 2 }), done(8, 8)] }, BENCH), false, 'already rated a set');
  eq(shouldAskEffort(ok, PLANK), false, 'timed');
  eq(shouldAskEffort({ sets: [done(8, 8, { warmup: true })] }, BENCH), false, 'warm-ups only');
  eq(shouldAskEffort({ ...ok, effort_rir: 1 }, BENCH), false, 'already rated');
  eq(shouldAskEffort({ ...ok, effort_skipped: true }, BENCH), false, 'skipped');
  eq(shouldAskEffort({ sets: [done(8, 8, { warmup: true }), done(8, 8)] }, BENCH), true, 'warm-ups do not count');
});

test('exercise rating: given rating wins, else the hardest rated set, editable', () => {
  const it = { sets: [done(8, 8, { rir: 3 }), done(8, 8, { rir: 1, weight_kg: 60 })] };
  eq(exerciseRir(it), 1);
  setEffort(it, 4);
  eq(exerciseRir(it), 4);
  setEffort(it, null);
  eq(exerciseRir(it), null); // cleared on purpose: the per-set ratings don't show through
  eq(shouldAskEffort({ sets: [done(8, 8)], effort_rir: null }), false);
  eq(exerciseRir({ sets: [done(8, 8)] }), null);
});

test('history carries the exercise rating and planned reps', () => {
  const w = { id: 'w', status: 'done', started_at: '2026-10-01T10:00:00Z', exercises: [{ exercise_id: 'bench', effort_rir: 3, sets: [done(8, 8)] }] };
  const s = buildIndex([w], 'lb').historyFor('bench')[0];
  eq(s.rir, 3);
  eq(s.sets[0].planReps, 8);
});

const DB = { id: 'db', load: 'dumbbell', kind: 'compound', pattern: 'horizontal_push', reps: [8, 12] };
const MACH = { id: 'm', load: 'machine', kind: 'compound', pattern: 'horizontal_push', reps: [8, 12] };

test('exerciseRir only accepts integers 0-4', () => {
  for (const bad of ['3', NaN, '__proto__', 7, -1, 1.5]) eq(exerciseRir({ sets: [done(8, 8)], effort_rir: bad }), null);
  eq(exerciseRir({ sets: [done(8, 8, { rir: '3' })] }), null);
});

test('easy double step is capped at about 15%; otherwise one step with the reason', () => {
  const t = T(DB, [sess(5, 12, 4)]);
  eq(t.weight, 10);
  eq(t.note, 'Felt easy last time, +5 lb.');
  assert(T(DB, [sess(30, 12, 4)]).weight <= 35);
  eq(T(BENCH, [sess(135, 10, 3)]).weight, 145);
});

test('ease-down snaps to the step, has a floor, and holds when the drop is big', () => {
  eq(T(BENCH, [sess(135, 8, 0), sess(135, 8, 0)]).weight, 125);
  eq(T(BENCH, [sess(225, 8, 0), sess(225, 8, 0)]).weight, 210);
  const d = T(DB, [sess(10, 8, 0), sess(10, 8, 0)]);
  eq(d.weight, 10);
  eq(d.reps, 8);
  const m = T(MACH, [sess(2.5, 8, 0), sess(2.5, 8, 0)]);
  eq(m.weight, 2.5);
  assert(/Tough twice/.test(m.note));
});

test('two missed sessions (unrated, known plan) hold, then ease', () => {
  eq(T(BENCH, [sess(135, 7, null, 3, 10), sess(135, 7, null, 3, 10)]).mode, 'ease');
  eq(T(BENCH, [sess(135, 7, null, 3, 10)]).mode, 'hold');
});

test('bodyweight reasons talk about reps, not weight', () => {
  eq(T(PUSHUP, [sess(null, 10, 0)]).note, 'Went to failure last time: same reps again.');
  eq(T(PUSHUP, [sess(null, 10, 1)]).note, 'Close to the limit last time: one more rep.');
});

test('UI wiring: prompt copy, Rate sets toggle, history edit', () => {
  const p = src('js/screens/player.js');
  assert(p.includes('How many more reps could you have done?'));
  assert(p.includes('Rate sets'));
  assert(src('js/screens/history.js').includes('data-effort'));
  assert(src('css/player.css').includes('.pl-effort'));
});
