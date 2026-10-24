// v0.16.64 (#192): the player lists every set up front. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { setRows, setValues, addSet, editSet } from '../js/workouts/setlist.js';

const mk = () => ({
  sets: [
    { warmup: true, plan_weight_kg: 20, plan_reps: 10, weight_kg: 20, reps: 10, done: true, rir: null },
    { warmup: false, plan_weight_kg: 60, plan_reps: 8, weight_kg: 60, reps: 8, done: true, rir: 2 },
    { warmup: false, plan_weight_kg: 60, plan_reps: 8, weight_kg: null, reps: null, done: false, rir: null },
    { warmup: false, plan_weight_kg: null, plan_reps: null, weight_kg: null, reps: null, done: false, rir: null },
  ],
});

test('rows: labels, states, prefilled values', () => {
  const r = setRows(mk(), 2, 12);
  eq(r.map((x) => x.label).join(), 'W1,1,2,3');
  eq(r.map((x) => x.state).join(), 'done,done,current,todo');
  eq(r[1].rir, 2);
  eq(r[2].kg, 60);
  eq(r[2].reps, 8);
  eq(r[3].kg, 60, 'unplanned set starts where the last done working set ended');
  eq(r[3].reps, 8);
});

test('values fall back to the default reps when nothing is known', () => {
  const it = { sets: [{ warmup: false, done: false }] };
  eq(setValues(it, 0, 10).reps, 10);
  eq(setValues(it, 0, 10).kg, null);
});

test('add set copies the last working set plan', () => {
  const it = mk();
  const j = addSet(it);
  eq(j, 4);
  eq(it.sets[4].done, false);
  eq(it.sets[4].warmup, false);
  assert(setRows(it, 2).length === 5);
});

test('editing an upcoming set changes its plan; a finished set changes its result', () => {
  const it = mk();
  editSet(it, 3, { kg: 65, reps: 6 });
  eq(it.sets[3].plan_weight_kg, 65);
  eq(it.sets[3].plan_reps, 6);
  eq(it.sets[3].weight_kg, null);
  editSet(it, 1, { kg: 62.5, reps: 7 });
  eq(it.sets[1].weight_kg, 62.5);
  eq(it.sets[1].reps, 7);
  eq(setRows(it, 2)[3].reps, 6);
});

test('the player draws the list, keeps the rep counter and RIR chips, and has haptics', () => {
  const src = readFileSync(new URL('../js/screens/player.js', import.meta.url), 'utf8');
  assert(src.includes('data-setlist') && src.includes('data-addset'), 'list and add row');
  assert(src.includes('data-hero-n') && src.includes('data-rir'), 'counter and RIR kept');
  assert(/data-setrow[\s\S]{0,300}haptics\.select/.test(src), 'row taps give a haptic');
  const css = readFileSync(new URL('../css/player.css', import.meta.url), 'utf8');
  assert(/\.pl-set \{[^}]*min-height: 44px/.test(css), 'big tap target');
});
