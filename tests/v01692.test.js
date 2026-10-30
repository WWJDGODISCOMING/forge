// v0.16.92 (#253): + Log a workout. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { validateManual, localStart, planManualMerge, healthPayload, healthTypeFor, mergeNotes } from '../js/health/manual-workout.js';
import { workoutToCardio } from '../js/health/apple-workouts.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = new Date(2026, 9, 30, 20, 0, 0);
const base = { activity: 'run', day: '2026-10-29', time: '07:00', min: '30' };

test('start time is saved as local date + time, and a past day keeps its time', () => {
  const v = validateManual(base, { now: NOW });
  assert(v.ok, v.error);
  const d = new Date(v.fields.started_at);
  eq(d.getHours(), 7); eq(d.getMinutes(), 0); eq(d.getDate(), 29);
  eq(v.fields.day, '2026-10-29');
  eq(v.fields.manual, true);
  eq(localStart('2026-10-29', '19:45').getHours(), 19);
  eq(localStart('2026-02-31', '10:00'), null);
  eq(localStart('', '10:00'), null);
});

test('a start in the future is refused', () => {
  assert(!validateManual({ ...base, day: '2026-10-30', time: '21:00' }, { now: NOW }).ok);
});

test('validation rejects out-of-range values and accepts the edges', () => {
  const bad = (o) => !validateManual({ ...base, ...o }, { now: NOW }).ok;
  assert(bad({ min: '0' }) && bad({ min: '601' }) && bad({ min: '' }) && bad({ min: '-5' }));
  assert(bad({ kcal: '-1' }) && bad({ kcal: '5001' }));
  assert(bad({ hr: '29' }) && bad({ hr: '231' }));
  assert(bad({ dist: '-0.5' }));
  assert(bad({ time: '' }));
  const ok = (o) => validateManual({ ...base, ...o }, { now: NOW }).ok;
  assert(ok({ min: '1' }) && ok({ min: '600' }) && ok({ kcal: '0' }) && ok({ kcal: '5000' }) && ok({ hr: '30' }) && ok({ hr: '230' }) && ok({ dist: '0' }));
});

test('optional fields stay null; distance converts from miles; strength drops distance; other keeps its name', () => {
  const v = validateManual(base, { now: NOW }).fields;
  eq(v.calories, null); eq(v.avg_hr, null); eq(v.distance_km, null);
  const mi = validateManual({ ...base, dist: '1' }, { distUnit: 'mi', now: NOW }).fields;
  assert(Math.abs(mi.distance_km - 1.609) < 0.001);
  eq(validateManual({ ...base, activity: 'strength', dist: '3' }, { now: NOW }).fields.distance_km, null);
  const o = validateManual({ ...base, activity: 'other', name: '  Climbing ' }, { now: NOW }).fields;
  eq(o.name, 'Climbing');
  eq(validateManual(base, { now: NOW }).fields.name, undefined);
});

const manual = (o) => ({ id: 'm1', manual: true, activity: 'run', started_at: new Date(2026, 9, 29, 7, 0).toISOString(), duration_min: 30, ...o });
const watch = (o) => workoutToCardio({ platformId: 'U1', workoutType: 'running', startDate: new Date(2026, 9, 29, 7, 5).toISOString(), endDate: new Date(2026, 9, 29, 7, 33).toISOString(), duration: 28 * 60, totalEnergyBurned: 300, ...o });

test('merge planning: overlap ≥ 50% of the same kind offers a merge; the best match first', () => {
  const m = planManualMerge(watch(), [manual({}), manual({ id: 'm2', started_at: new Date(2026, 9, 29, 7, 20).toISOString() })]);
  eq(m.length, 2); eq(m[0].id, 'm1');
  assert(m[0].share > 0.9);
});

test('merge planning: other kinds, far apart, deleted, non-manual and merged rows are left alone', () => {
  const w = watch();
  eq(planManualMerge(w, [manual({ activity: 'walk' })]).length, 0);
  eq(planManualMerge(w, [manual({ started_at: new Date(2026, 9, 29, 12, 0).toISOString() })]).length, 0);
  eq(planManualMerge(w, [manual({ deleted: true })]).length, 0);
  eq(planManualMerge(w, [manual({ manual: false })]).length, 0);
  eq(planManualMerge(w, [manual({ merged_into: 'x' })]).length, 0);
  eq(planManualMerge(w, [manual({ started_at: new Date(2026, 9, 29, 7, 25).toISOString(), duration_min: 30 })]).length, 0); // 8 of the shorter 28 min is under half
});

test('merge notes keep both', () => {
  eq(mergeNotes({ notes: 'felt great' }, { notes: '' }), 'felt great');
  eq(mergeNotes({ notes: 'a' }, { notes: 'b' }), 'b · a');
});

test('Health payload: type map, end time, kcal; null without a usable window', () => {
  eq(healthTypeFor('run'), 'running'); eq(healthTypeFor('walk'), 'walking'); eq(healthTypeFor('strength'), 'traditionalStrengthTraining'); eq(healthTypeFor('row'), 'mixedCardio');
  const p = healthPayload(manual({ calories: 250 }));
  eq(p.id, 'm1'); eq(p.kcal, 250); eq(Date.parse(p.end) - Date.parse(p.start), 30 * 60000);
  eq(healthPayload({ id: 'x', started_at: 'nope', duration_min: 5 }), null);
});

test('wiring: History and Train have the button, one sheet, merge offered on import', () => {
  assert(read('js/screens/history.js').includes('data-log-workout') && read('js/screens/history.js').includes('+ Log a workout'));
  assert(read('js/screens/train.js').includes('+ Log a workout') && read('js/screens/train.js').includes('openLogWorkout'));
  assert(read('js/screens/apple.js').includes('planManualMerge') && read('js/screens/apple.js').includes('offerMerge'));
  assert(read('js/screens/log-workout.js').includes('Also save to Apple Health'));
});
