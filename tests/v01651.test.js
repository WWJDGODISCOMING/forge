// v0.16.51: live workout. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import {
  LIVE_KINDS, newLive, pauseLive, resumeLive, endLive, activeMs, isPaused, fmtElapsed, fmtDistance, fmtPace,
  activeKcal, totalKcal, liveToCardio, alreadyLive,
} from '../js/workouts/live-core.js';
import { planWorkoutImport } from '../js/health/apple-workouts.js';
import { VERSION } from '../js/version.js';

const T0 = Date.parse('2026-10-22T10:00:00Z');
const MIN = 60000;

test('pause and resume take the paused time out of the clock', () => {
  let s = newLive('run', T0);
  eq(activeMs(s, T0 + 10 * MIN), 10 * MIN);
  s = pauseLive(s, T0 + 10 * MIN);
  assert(isPaused(s));
  eq(activeMs(s, T0 + 30 * MIN), 10 * MIN, 'frozen while paused');
  s = resumeLive(s, T0 + 15 * MIN);
  eq(activeMs(s, T0 + 20 * MIN), 15 * MIN);
  s = endLive(s, T0 + 25 * MIN);
  eq(activeMs(s, T0 + 99 * MIN), 20 * MIN, 'ending stops the clock');
  eq(s.pauses.length, 1);
});

test('double pause / resume / end (screen + lock-screen button) change nothing', () => {
  let s = newLive('walk', T0);
  const p1 = pauseLive(s, T0 + MIN);
  eq(pauseLive(p1, T0 + 2 * MIN), p1);
  eq(resumeLive(s, T0 + MIN), s);
  const e = endLive(p1, T0 + 5 * MIN); // ended while paused: the pause closes
  eq(e.pauses.length, 1);
  eq(activeMs(e, T0 + 5 * MIN), MIN);
  eq(endLive(e, T0 + 9 * MIN), e);
  eq(pauseLive(e, T0 + 9 * MIN), e);
});

test('formatting: clock, distance in mi and km, pace', () => {
  eq(fmtElapsed(7 * 1000 + 5 * MIN), '5:07');
  eq(fmtElapsed(3725000), '1:02:05');
  eq(fmtDistance(1609.344, 'mi'), '1.00');
  eq(fmtDistance(5000, 'km'), '5.00');
  eq(fmtPace(1609.344, 9 * MIN + 15000, 'mi'), '9\'15"');
  eq(fmtPace(1000, 6 * MIN, 'km'), '6\'00"');
  eq(fmtPace(10, MIN, 'mi'), '--\'--"', 'too little distance to mean anything');
});

test('kcal: measured wins, else MET × kg × hours; total adds resting; unknown weight is null, not a made-up number', () => {
  eq(activeKcal('run', 30 * MIN, 80, 123.4), 123);
  eq(activeKcal('jog_in_place', 30 * MIN, 80, 0), Math.round(8.0 * 80 * 0.5));
  eq(activeKcal('jog_in_place', 30 * MIN, null, 0), null);
  eq(totalKcal(320, 30 * MIN, 80), 320 + 40);
  eq(totalKcal(320, 30 * MIN, null), 320);
  eq(totalKcal(null, MIN, 80), null);
});

test('jog in place has no distance; walk and run do', () => {
  assert(!LIVE_KINDS.jog_in_place.distance && LIVE_KINDS.jog_in_place.indoor);
  assert(LIVE_KINDS.walk.distance && LIVE_KINDS.run.distance);
  assert(newLive('nope', T0).kind === 'jog_in_place');
});

test('liveToCardio: minutes without pauses, Health uuid kept, no distance for jog in place', () => {
  let s = newLive('run', T0, 'live_x');
  s = endLive(resumeLive(pauseLive(s, T0 + 10 * MIN), T0 + 12 * MIN), T0 + 32 * MIN);
  const { id, fields } = liveToCardio(s, { hk: { uuid: 'U-1', kcal: 301.6, distanceM: 4200.4, avgHr: 151.2, maxHr: 170.4 }, weightKg: 80 });
  eq(id, 'live_x');
  eq(fields.duration_min, 30);
  eq(fields.calories, 302);
  eq(fields.distance_km, 4.2);
  eq(fields.avg_hr, 151);
  eq(fields.hk_uuid, 'U-1');
  eq(fields.hk_source, 'Forge');
  const jog = liveToCardio(endLive(newLive('jog_in_place', T0, 'live_j'), T0 + 10 * MIN), { hk: { uuid: 'U-2', kcal: 0, distanceM: 900 }, weightKg: 80 });
  eq(jog.fields.distance_km, null);
  eq(jog.fields.calories, Math.round(8.0 * 80 * (10 / 60)));
  const web = liveToCardio(endLive(newLive('walk', T0, 'live_w'), T0 + 20 * MIN), { hk: null, weightKg: 70 });
  eq(web.fields.hk_uuid, undefined);
  eq(web.fields.calories, Math.round(3.8 * 70 / 3));
});

test('no duplicate against the Apple Health import (#146): by metadata and by the stored Health uuid', () => {
  const hkw = (extra = {}) => ({ platformId: 'U-1', startDate: '2026-10-22T10:00:00Z', endDate: '2026-10-22T10:30:00Z', duration: 1800, workoutActivityType: 'running', sourceName: 'Forge', ...extra });
  eq(planWorkoutImport([hkw({ metadata: { ForgeWorkoutId: 'live_x' } })]).create.length, 0, 'metadata');
  eq(planWorkoutImport([hkw({ sourceId: 'com.christianeverett.forge' })]).create.length, 0, 'source');
  const cardio = [{ id: 'live_x', live_id: 'live_x', hk_uuid: 'U-1' }];
  assert(alreadyLive(cardio, 'U-1'));
  eq(planWorkoutImport([hkw()], { cardio }).create.length, 0, 'uuid on the Forge row');
  eq(planWorkoutImport([hkw()], { cardio: [] }).create.length, 1, 'a real Watch workout still imports');
  assert(!alreadyLive([{ id: 'live_x', live_id: 'live_x', hk_uuid: 'U-1', deleted: true }], 'U-1'));
});

test('0.16.51 wiring: version, service worker, route, native methods, plist keys, project files', () => {
  eq(VERSION, '0.16.51');
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert(read('sw.js').includes("const VERSION = '0.16.51'"));
  for (const f of ['js/workouts/live-core.js', 'js/native/live-workout.js', 'js/screens/live.js', 'css/live.css']) assert(read('sw.js').includes('./' + f), f + ' cached');
  assert(read('index.html').includes('css/live.css'));
  assert(read('js/app.js').includes("live: () => import('./screens/live.js')"));
  const plugin = read('ios/App/App/ForgeWorkoutsPlugin.swift');
  for (const m of ['startLive', 'pauseLive', 'resumeLive', 'endLive', 'liveState']) assert(plugin.includes(`name: "${m}"`), m);
  const plist = read('ios/App/App/Info.plist');
  assert(plist.includes('NSSupportsLiveActivities') && plist.includes('NSMotionUsageDescription'));
  const proj = read('ios/App/App.xcodeproj/project.pbxproj');
  assert(proj.includes('ForgeLiveWorkout.swift in Sources') && proj.includes('ForgeLiveShared.swift in Sources'));
  assert(read('ios/App/App/ForgeLiveWorkout.swift').includes('HKLiveWorkoutBuilder'));
  assert(read('ios/App/ForgeLiveActivity/ForgeLiveActivityBundle.swift').includes('DynamicIsland'));
});
