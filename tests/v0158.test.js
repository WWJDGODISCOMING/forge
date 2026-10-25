// v0.15.8: Change today's workout (option logic, Undo snapshots, per-day length). Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq as strictEq, assert } from './harness.js';
const eq = (a, b, m) => strictEq(JSON.stringify(a), JSON.stringify(b), m);
import {
  LENGTHS, blankEdits, takeSnapshot, restoreSnapshot, isChanged, pickedIds, withSwapAvoid, carryRest, swapResult, swapMessage, noSwapReason, lengthMessage,
} from '../js/workouts/change.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Change: New exercises avoids what is showing but keeps hand-picked ones', () => {
  const ed = { ...blankEdits('l1|'), forced: { bench: 'db_press' }, avoid: ['old'] };
  const keep = withSwapAvoid(ed, ['db_press', 'row', 'curl']);
  eq(keep.avoid, ['old', 'row', 'curl']);
  eq(keep.forced, { bench: 'db_press' });
  const all = withSwapAvoid(ed, ['db_press', 'row'], { replacePicks: true });
  eq(all.avoid, ['old', 'db_press', 'row']);
  eq(all.forced, {});
  eq(ed.avoid, ['old'], 'the input is not mutated');
  eq([...pickedIds(ed)], ['db_press']);
});

test('Change: rest overrides travel with the slot', () => {
  eq(carryRest({ a: 120, z: 90 }, ['a', 'b'], ['x', 'b']), { z: 90, x: 120 });
  eq(carryRest({ a: 120 }, ['a', 'b'], ['a', 'c']), { a: 120 }, 'an exercise that stays keeps its rest');
});

test('Change: result states and plain-words messages', () => {
  eq(swapResult(['a', 'b'], ['a', 'b']).state, 'none');
  eq(swapResult(['a', 'b'], ['c', 'd']).state, 'all');
  const some = swapResult(['a', 'b', 'c'], ['a', 'x', 'c']);
  eq(some, { changed: 1, total: 3, state: 'some' });
  eq(swapMessage(some), '1 of 3 swapped');
  eq(swapMessage(swapResult(['a'], ['b'])), '1 exercise swapped');
  eq(noSwapReason('Home gym', 'Upper'), 'No other moves fit Home gym for Upper. Try a different focus or location.');
  eq(lengthMessage('Lower', 30), 'Lower · 30 min');
  eq(lengthMessage('Lower', null), 'Lower');
  eq(LENGTHS, [20, 30, 45, 60]);
});

test('Change: Undo restores the exact previous workout, and is not aliased', () => {
  const live = { edits: { key: 'l1|', forced: { a: 'b' }, rest: { b: 150 }, avoid: ['x'] }, dayOverride: 'lower', minOverride: 30, locationId: 'l1' };
  const before = takeSnapshot(live);
  live.edits.avoid.push('y'); live.edits.forced.c = 'd'; live.edits.rest.b = 60; live.dayOverride = null;
  eq(before.edits.avoid, ['x']);
  eq(before.edits.forced, { a: 'b' });
  eq(before.edits.rest, { b: 150 });
  const back = restoreSnapshot(before);
  eq(back, before);
  back.edits.avoid.push('z');
  eq(before.edits.avoid, ['x'], 'restoring gives a private copy');
  eq(back.dayOverride, 'lower');
  eq(back.minOverride, 30);
  eq(back.locationId, 'l1');
});

test('Change: "Back to recommended" only has something to do after a change', () => {
  assert(!isChanged({ edits: blankEdits(), dayOverride: null, minOverride: null }));
  assert(isChanged({ edits: blankEdits(), dayOverride: 'push', minOverride: null }));
  assert(isChanged({ edits: blankEdits(), dayOverride: null, minOverride: 20 }));
  assert(isChanged({ edits: { ...blankEdits(), avoid: ['a'] }, dayOverride: null, minOverride: null }));
  assert(isChanged({ edits: { ...blankEdits(), forced: { a: 'b' } }, dayOverride: null, minOverride: null }));
});

test('Change: the generator takes a one-day session length without touching the profile', async () => {
  const { generateWorkout } = await import('../js/workouts/generator.js');
  const { HOME_PRESET } = await import('../js/workouts/equipment.js');
  const { allExercises } = await import('../js/workouts/library.js');
  const profile = { experience: 'intermediate', sessionMin: 60, trainingDays: 4, injuries: [] };
  const run = (extra = {}) => generateWorkout({
    programKey: 'smart', dayType: 'full_a', location: { equipment: [...HOME_PRESET], weight_inventory: {} }, profile, unit: 'lb', exercises: allExercises(), ...extra,
  });
  const usual = run();
  const short = run({ sessionMin: 20 });
  assert(usual.exercises.length > 0, 'fixture builds a workout');
  assert(short.est_minutes < usual.est_minutes, 'a shorter session is actually shorter');
  eq(profile.sessionMin, 60, 'profile unchanged');
});

test('Change: every day type fits the chosen length (home and gym), and 20 < 30 < 45 when the library allows', async () => {
  const { generateWorkout } = await import('../js/workouts/generator.js');
  const { HOME_PRESET, YMCA_PRESET } = await import('../js/workouts/equipment.js');
  const { allExercises } = await import('../js/workouts/library.js');
  const { DAY_TYPES } = await import('../js/workouts/programs.js');
  const profile = { experience: 'intermediate', sessionMin: 45, trainingDays: 4, injuries: [] };
  for (const [place, equipment] of [['home', HOME_PRESET], ['gym', YMCA_PRESET]]) {
    for (const dayType of Object.keys(DAY_TYPES)) {
      const est = {};
      for (const sessionMin of LENGTHS) {
        const w = generateWorkout({
          programKey: 'smart', dayType, location: { equipment: [...equipment], weight_inventory: {} }, profile, unit: 'lb', exercises: allExercises(), sessionMin: sessionMin === 45 ? null : sessionMin,
        });
        if (!w.exercises.length) continue; // the place has nothing for this day type
        assert(w.est_minutes <= sessionMin + 2, `${place} ${dayType} at ${sessionMin} min comes out ${w.est_minutes} min`);
        est[sessionMin] = w.est_minutes;
      }
      for (const [short, long] of [[20, 30], [30, 45]]) {
        if (est[short] != null && est[long] != null && est[long] > short + 2) assert(est[short] < est[long], `${place} ${dayType}: ${short} min (${est[short]}) is not shorter than ${long} min (${est[long]})`);
      }
    }
  }
});

test('Change: the button, sheet and Undo are wired; the old Switch and day select are gone', () => {
  const t = src('js/screens/train.js');
  assert(t.includes(`aria-label="Change today's workout"`) && t.includes('Change</button>'));
  assert(t.includes(`sheet('Change workout'`) && t.includes(`label: 'Undo'`));
  assert(!t.includes('data-day') && !t.includes('Or train a different day'));
  assert(src('css/player.css').includes('prefers-reduced-motion: reduce) { .pv-ex.flash'));
  assert(src('js/ui.js').includes('toast-act'));
});
