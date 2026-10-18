// v0.16.23: "Jog in place" in Log cardio. Synthetic data only.
import { test, eq, assert } from './harness.js';
import { VERSION } from '../js/version.js';
import { CARDIO_TYPES, NO_DISTANCE, cardioDistanceKm, cardioStatsHtml, cardioCsvRows, CARDIO_CSV_COLUMNS } from '../js/cardio-types.js';
import { toCSV } from '../js/csv.js';


test('Jog in place is offered right after Run, with its label and no distance', () => {
  const keys = Object.keys(CARDIO_TYPES);
  const idx = keys.indexOf('jog_in_place');
  assert(idx > 0, 'offered');
  eq(CARDIO_TYPES.jog_in_place, 'Jog in place');
  eq(keys[idx - 1], 'run');
  assert(NO_DISTANCE.includes('jog_in_place'), 'no distance for jog in place');
  assert(!NO_DISTANCE.includes('run'), 'run keeps distance');
});

test('save path: a distance typed for Run is dropped after switching to Jog in place', () => {
  // The sheet's submit handler calls cardioDistanceKm(form.activity.value, form.dist.value, unit) with whatever is left in the hidden box.
  eq(cardioDistanceKm('run', '3.1', 'mi') > 4.9, true, 'run keeps it');
  eq(cardioDistanceKm('jog_in_place', '3.1', 'mi'), null);
  eq(cardioDistanceKm('jog_in_place', '5', 'km'), null);
  eq(cardioDistanceKm('run', '', 'km'), null);
  eq(cardioDistanceKm('run', '5', 'km'), 5);
});

test('detail sheet: no Distance tile for Jog in place, kept for Run', () => {
  const jog = cardioStatsHtml({ activity: 'jog_in_place', duration_min: 20, distance_km: null, calories: 150 }, 'lb');
  assert(!jog.includes('Distance'), 'no distance tile');
  assert(jog.includes('Minutes') && jog.includes('Calories'), 'minutes and calories stay');
  const run = cardioStatsHtml({ activity: 'run', duration_min: 30, distance_km: null, calories: null }, 'lb');
  assert(run.includes('Distance') && run.includes('—'), 'run with no distance still shows a dash');
  assert(cardioStatsHtml({ activity: 'run', duration_min: 30, distance_km: 5 }, 'kg').includes('5.00 km'), 'run distance shown');
});

test('CSV: activity_name sits right after activity, key kept, unknown falls back', () => {
  const rows = cardioCsvRows([
    { id: 'b', day: '2026-10-18', started_at: '2026-10-18T10:00:00Z', activity: 'jog_in_place', duration_min: 20, distance_km: null },
    { id: 'a', day: '2026-10-17', started_at: '2026-10-17T10:00:00Z', activity: 'mystery', duration_min: 10, distance_km: null },
    { id: 'c', deleted: true, started_at: '2026-10-16T10:00:00Z', activity: 'run', duration_min: 5 },
  ]);
  eq(rows.length, 2);
  eq(rows[0].activity_name, 'mystery');
  eq(rows[1].activity, 'jog_in_place');
  eq(rows[1].activity_name, 'Jog in place');
  const i = CARDIO_CSV_COLUMNS.indexOf('activity');
  eq(CARDIO_CSV_COLUMNS[i + 1], 'activity_name');
  assert(toCSV(rows, CARDIO_CSV_COLUMNS).includes('jog_in_place,Jog in place'), 'both in the file');
});
