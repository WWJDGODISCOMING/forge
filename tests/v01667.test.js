// v0.16.67 (#195): Switch workout (muscle groups, saved, from scratch) + time/place chips. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOCATION_PRESETS, YMCA_PRESET } from '../js/workouts/equipment.js';
import { generateWorkout, jointAvoidSet } from '../js/workouts/generator.js';
import {
  muscleDay, cleanMuscles, musclesLabel, cleanItem, itemsDay, cleanSaved, addSaved, removeSaved, itemsFromPlan, resolveCustomDay, choiceKey, durationLabel, defaultItem, MAX_SAVED,
} from '../js/workouts/switch-core.js';
import { takeSnapshot, restoreSnapshot, isChanged, blankEdits } from '../js/workouts/change.js';

const byId = (id) => EXERCISES.find((e) => e.id === id);
const HOME = LOCATION_PRESETS.find((l) => l.key === 'home');
const YMCA = { equipment: YMCA_PRESET, weight_inventory: {} };
const profile = { experience: 'intermediate', sessionMin: 60, trainingDays: 3, injuries: '' };
const gen = (customDay, extra = {}, loc = YMCA, prof = profile) =>
  generateWorkout({ programKey: 'smart', customDay, location: loc, profile: prof, exercises: EXERCISES, unit: 'lb', ...extra });
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('muscle groups: cleaned, capped, labelled', () => {
  eq(cleanMuscles(['chest', 'chest', 'bogus', 'arms', 'back', 'legs', 'abs']).join(), 'chest,arms,back,legs');
  eq(musclesLabel(['chest', 'arms']), 'Chest + Arms');
  eq(cleanMuscles(null).length, 0);
});

test('muscle day builds a workout that trains the chosen muscles', () => {
  const w = gen(muscleDay(['chest', 'arms']));
  assert(w.exercises.length >= 4, 'a real session');
  eq(w.label, 'Chest + Arms');
  eq(w.dayType, 'muscles');
  const prim = new Set(w.exercises.flatMap((it) => byId(it.exercise_id).primary || []));
  assert(prim.has('chest') && (prim.has('biceps') || prim.has('triceps')), 'chest and arms are both trained');
  eq(new Set(w.exercises.map((it) => it.exercise_id)).size, w.exercises.length, 'no repeats');
});

test('muscle day respects the gym: no barbell at home', () => {
  const w = gen(muscleDay(['chest', 'legs']), {}, HOME);
  assert(w.exercises.length > 0);
  for (const it of w.exercises) assert(!JSON.stringify(byId(it.exercise_id).equip).includes('barbell'), `${it.exercise_id} needs a barbell`);
});

test('muscle day respects Joints to protect', () => {
  const p = { ...profile, protectJoints: ['knee', 'lower_back'] };
  const avoid = jointAvoidSet(p);
  const w = gen(muscleDay(['legs', 'glutes']), {}, YMCA, p);
  assert(w.exercises.length > 0, 'still a workout');
  for (const it of w.exercises) assert(!(byId(it.exercise_id).avoid || []).some((t) => avoid.has(t)), `${it.exercise_id} stresses a protected joint`);
});

test('duration chips: a shorter session is shorter, and still fits', () => {
  const d = muscleDay(['chest', 'back', 'legs']);
  const long = gen(d, { sessionMin: 60 });
  const short = gen(d, { sessionMin: 20 });
  assert(short.est_minutes < long.est_minutes, `${short.est_minutes} < ${long.est_minutes}`);
  assert(short.est_minutes <= 22);
  eq(durationLabel(20), '20m');
  eq(durationLabel(60), '1h');
});

test('saved workout: keeps its exercises, sets and reps; skips what this gym cannot do', () => {
  const items = [{ exercise_id: 'bb_bench_press', sets: 4, reps_lo: 6, reps_hi: 8 }, { exercise_id: 'db_one_arm_row', sets: 3, reps_lo: 10, reps_hi: 12 }];
  const w = gen(itemsDay(items, 'Push day'));
  eq(w.exercises.map((i) => i.exercise_id).join(), 'bb_bench_press,db_one_arm_row');
  eq(w.exercises[0].target.sets, 4);
  eq(w.label, 'Push day');
  const home = gen(itemsDay(items, 'Push day'), {}, HOME);
  assert(!home.exercises.some((i) => i.exercise_id === 'bb_bench_press'), 'no barbell at home');
});

test('your own list is not trimmed by the length chips', () => {
  const items = ['bb_bench_press', 'db_one_arm_row', 'bb_back_squat', 'bb_deadlift'].map((id) => ({ exercise_id: id, sets: 5, reps_lo: 5, reps_hi: 5 }));
  const w = gen(itemsDay(items), { sessionMin: 20 });
  eq(w.exercises.length, 4);
  eq(w.exercises[0].target.sets, 5);
});

test('items are repaired and capped', () => {
  eq(cleanItem(null), null);
  eq(cleanItem({ exercise_id: 'x', sets: 99, reps_lo: 12, reps_hi: 3 }).sets, 8);
  const c = cleanItem({ exercise_id: 'x', sets: 3, reps_lo: 12, reps_hi: 3 });
  assert(c.reps_hi >= c.reps_lo);
  const d = defaultItem(byId('bb_bench_press'));
  eq(d.sets, 3);
  assert(d.reps_lo >= 1);
});

test('saved list: add, replace, remove, cap', () => {
  const e = (id, name) => ({ id, name, items: [{ exercise_id: 'bb_bench_press', sets: 3, reps_lo: 8, reps_hi: 10 }] });
  let l = addSaved([], e('a', 'A'));
  l = addSaved(l, e('b', 'B'));
  eq(l.map((s) => s.id).join(), 'b,a');
  l = addSaved(l, e('a', 'A2'));
  eq(l.map((s) => s.name).join(), 'A2,B');
  eq(removeSaved(l, 'b').map((s) => s.id).join(), 'a');
  eq(cleanSaved([{ id: 'z', name: 'Empty', items: [] }, { nope: 1 }, null]).length, 0, 'invalid and empty entries are dropped');
  let big = [];
  for (let i = 0; i < MAX_SAVED + 5; i++) big = addSaved(big, e(`id${i}`, `W${i}`));
  eq(big.length, MAX_SAVED);
});

test('saving what Train shows keeps its sets and reps', () => {
  const w = gen(muscleDay(['chest']));
  const items = itemsFromPlan(w);
  eq(items.length, w.exercises.length);
  eq(items[0].sets, w.exercises[0].target.sets);
});

test('a choice resolves to a day; a deleted saved workout falls back to the usual plan', () => {
  const saved = [{ id: 's1', name: 'Mine', items: [{ exercise_id: 'bb_bench_press', sets: 3, reps_lo: 8, reps_hi: 10 }] }];
  eq(resolveCustomDay(null, saved), null);
  eq(resolveCustomDay({ kind: 'muscles', groups: ['chest'] }, saved).key, 'muscles');
  eq(resolveCustomDay({ kind: 'saved', id: 's1' }, saved).label, 'Mine');
  eq(resolveCustomDay({ kind: 'saved', id: 'gone' }, saved), null);
  eq(resolveCustomDay({ kind: 'scratch', name: 'X', items: [] }, saved), null);
  assert(choiceKey({ kind: 'muscles', groups: ['arms', 'chest'] }) !== choiceKey({ kind: 'muscles', groups: ['chest'] }));
});

test('Undo brings back the switch, and Back to recommended knows about it', () => {
  const choice = { kind: 'muscles', groups: ['chest'] };
  const snap = takeSnapshot({ edits: blankEdits('k'), choice });
  choice.groups.push('arms');
  eq(restoreSnapshot(snap).choice.groups.join(), 'chest', 'the snapshot is a private copy');
  eq(takeSnapshot({ edits: blankEdits('k') }).choice, null);
  assert(isChanged({ edits: blankEdits('k'), choice }));
  assert(!isChanged({ edits: blankEdits('k'), choice: null }));
});

test('Train wires Switch, the chips, haptics and no rules change', () => {
  const t = src('../js/screens/train.js');
  for (const s of ['data-switch', 'data-len=', 'data-pv-gym', 'Pick muscle groups', 'Saved workouts', 'Create from scratch', 'Save for later']) assert(t.includes(s), s);
  assert(t.includes("tick('light'); openSwitch"), 'haptic on Switch');
  assert(src('../sw.js').includes('switch-core.js'), 'in the offline shell');
  assert(!src('../firestore.rules').includes('saved_workouts'), 'saved workouts ride in settings, no rules change');
  const css = src('../css/player.css');
  assert(css.includes('.pv-chip{') || css.includes('.pv-chip {'));
  assert(/min-height: 44px/.test(css.slice(css.indexOf('.pv-chip {'))), '44px tap targets');
});
