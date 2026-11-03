// v0.16.94 (#259): what a weight number means (per hand / total / per side / stack). Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { LOAD_TYPES, loadLabel, loadPhrase, loadCaption, loadFieldAria } from '../js/workouts/loadtype.js';
import { workoutTotals, setLine } from '../js/workouts/totals.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const byId = (id) => EXERCISES.find((e) => e.id === id);

test('every exercise has a valid loadType; weighted ones are never "bodyweight"', () => {
  for (const e of EXERCISES) {
    assert(LOAD_TYPES.includes(e.loadType), `${e.id} has loadType ${e.loadType}`);
    if (!['bodyweight', 'band', 'other'].includes(e.load)) assert(e.loadType !== 'bodyweight', `${e.id} weighted but bodyweight`);
  }
});

test('classification: counts and the cue check', () => {
  const dumb = EXERCISES.filter((e) => e.load === 'dumbbell');
  eq(dumb.filter((e) => e.loadType === 'per_hand').length, 35);
  for (const e of EXERCISES.filter((x) => x.load === 'barbell' || x.load === 'smith')) eq(e.loadType, 'total');
  for (const e of EXERCISES.filter((x) => x.load === 'machine' || x.load === 'cable')) eq(e.loadType, 'machine_stack');
  for (const e of EXERCISES.filter((x) => x.load === 'dumbbell' || x.load === 'kettlebell')) {
    if (/one dumbbell|both hands/i.test(e.cues.join(' '))) assert(e.loadType !== 'per_hand', `${e.id} cues say one dumbbell`);
  }
  eq(byId('db_skull_crusher').loadType, 'per_hand');
  eq(byId('db_goblet_squat').loadType, 'total');
  eq(byId('db_one_arm_row').loadType, 'per_side');
  for (const id of ['db_single_leg_rdl', 'db_bulgarian_split_squat', 'db_reverse_lunge', 'db_walking_lunge', 'db_lateral_lunge', 'db_step_up']) {
    assert(/dumbbell in each hand/i.test(byId(id).cues[0]), `${id} cue`);
  }
});

test('labels in lb and kg for each type', () => {
  eq(loadLabel(30, byId('db_skull_crusher'), 'lb'), '30 lb each hand');
  eq(loadLabel(12.5, byId('db_skull_crusher'), 'kg'), '12.5 kg each hand');
  eq(loadLabel(30, byId('db_goblet_squat'), 'lb'), '30 lb total');
  eq(loadLabel(135, byId('bb_back_squat'), 'lb'), '135 lb total incl. bar');
  eq(loadLabel(30, byId('db_one_arm_row'), 'lb'), '30 lb per side');
  const stack = EXERCISES.find((e) => e.loadType === 'machine_stack');
  eq(loadLabel(50, stack, 'lb'), 'Stack 50 lb');
  eq(loadLabel(10, { id: 'pull_up', load: 'bodyweight', loadType: 'bodyweight' }, 'lb'), '+10 lb');
  eq(loadCaption(byId('db_skull_crusher')), 'each hand');
});

test('VoiceOver phrases say the full thing', () => {
  eq(loadPhrase(30, byId('db_skull_crusher'), 'lb'), '30 pounds in each hand');
  eq(loadPhrase(1, byId('db_skull_crusher'), 'lb'), '1 pound in each hand');
  eq(loadPhrase(14, byId('db_skull_crusher'), 'kg'), '14 kilograms in each hand');
  eq(loadPhrase(135, byId('bb_back_squat'), 'lb'), '135 pounds total, including the bar');
  eq(loadPhrase(30, byId('db_one_arm_row'), 'lb'), '30 pounds, one side at a time');
  eq(loadPhrase(50, EXERCISES.find((e) => e.loadType === 'machine_stack'), 'lb'), 'Stack set to 50 pounds');
  eq(loadFieldAria(byId('db_skull_crusher'), 'lb'), 'Weight in pounds, in each hand');
});

test('totals: per_hand volume is doubled, unilateral and others are not', () => {
  const lookup = (id) => byId(id);
  const w = (id) => ({ exercises: [{ exercise_id: id, sets: [{ done: true, reps: 10, weight_kg: 10 }] }] });
  eq(workoutTotals(w('db_skull_crusher'), lookup).volume, 200);
  eq(workoutTotals(w('db_goblet_squat'), lookup).volume, 100);
  eq(workoutTotals(w('db_one_arm_row'), lookup).volume, byId('db_one_arm_row').unilateral ? 200 : 100);
  eq(workoutTotals(w('db_bulgarian_split_squat'), lookup).volume, 400); // unilateral x two dumbbells
});

test('set lines, next-up and plan text carry the label', () => {
  eq(setLine({ reps: 10, weight: 30 }, byId('db_skull_crusher'), 'lb'), '10 reps x 30 lb each hand');
  eq(setLine({ reps: 10, weight: 30 }, null, 'lb'), '10 reps x 30 lb');
  assert(read('js/screens/train.js').includes('loadLabel(t.weight, ex, u)'), 'plan list');
});

test('screens use the label helper', () => {
  const p = read('js/screens/player.js');
  assert(p.includes('loadPhrase(draft.weight, ex, u)') && p.includes('data-wtype') && p.includes('data-wcap'), 'player hero + stepper');
  assert(p.includes('loadLabel(kgN, ex, u)'), 'set list');
  assert(read('js/workouts/live.js').includes('loadLabel('), 'next-up line');
  assert(read('js/screens/history.js').includes('loadLabel(r.b.v, r.ex, u)') && read('js/screens/history.js').includes('data-wtype'), 'history');
  assert(read('js/screens/player-extras.js').includes('data-hx-wtype'), 'exercise history sheet');
  assert(read('js/export.js').includes('weight_means'), 'csv');
});

test('version bumped', () => {
  assert(read('js/version.js').includes("'0.16.94'"));
  assert(read('CHANGELOG.md').includes('## 0.16.94'));
});
