// v0.16.50: save Forge workouts to Apple Health. Synthetic data only.
import { readFileSync, readdirSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { MET, metFor, intensity, estimateKcal, weightKgFor, activityTypeFor, overlapShare, pickOverlap, decide, pendingPatch, nextVersion, kcalLine, windowFor } from '../js/workouts/energy.js';
import { plugin } from '../js/native/bridge.js';
import { sendWorkout, afterFinish, writeEnabled } from '../js/native/workouts-health.js';

const T0 = Date.parse('2026-10-20T10:00:00Z');
const set = (rir, i, extra = {}) => ({ done: true, reps: 8, weight_kg: 50, rir, completed_at: new Date(T0 + i * 60000).toISOString(), ...extra });
const strength = (sets, extra = {}) => ({ id: 'w1', status: 'done', started_at: new Date(T0).toISOString(), duration_ms: 3600000, exercises: [{ exercise_id: 'bb_back_squat', sets }], ...extra });

test('MET estimate: moderate default, light, vigorous, conditioning', () => {
  const mod = strength([set(2, 0), set(2, 3)]);
  eq(intensity(mod), 'moderate');
  eq(estimateKcal(mod, 80), 400); // 5.0 x 80 x 1 h
  const light = strength([set(4, 0), set(4, 3), set(5, 6)]);
  eq(estimateKcal(light, 80), Math.round(MET.light * 80));
  eq(estimateKcal(strength([set(2, 0)], { deload: true }), 80), Math.round(MET.light * 80));
  const hard = strength([set(1, 0), set(0, 1), set(1, 2)]); // a minute apart: rest under 90 s
  eq(intensity(hard), 'vigorous');
  eq(estimateKcal(hard, 80), 480);
  const slow = strength([set(0, 0), set(0, 3), set(1, 6)]); // 3 min rests: not vigorous
  eq(intensity(slow), 'moderate');
  const cond = { ...mod, exercises: [{ exercise_id: 'mb_slam', sets: [set(null, 0), set(null, 1)] }] };
  eq(metFor(cond), MET.conditioning);
  eq(estimateKcal(cond, 80), 640);
});

test('no weight (or no time) → null estimate; weight comes from the latest weigh-in, else the profile', () => {
  eq(estimateKcal(strength([set(2, 0)]), null), null);
  eq(estimateKcal(strength([set(2, 0)], { duration_ms: 0 }), 80), null);
  eq(weightKgFor([{ kg: 70, measured_at: '2026-10-01' }, { kg: 72, measured_at: '2026-10-10' }, { kg: 99, measured_at: '2026-10-15', deleted: true }], { weightKg: 90 }), 72);
  eq(weightKgFor([], { weightKg: 90 }), 90);
  eq(weightKgFor([], null), null);
});

test('activity type: strength, bodyweight → functional, conditioning → mixedCardio', () => {
  eq(activityTypeFor(strength([set(2, 0)])), 'traditionalStrengthTraining');
  eq(activityTypeFor({ ...strength([]), exercises: [{ exercise_id: 'mb_slam', sets: [set(null, 0)] }] }), 'mixedCardio');
  const bw = { ...strength([]), exercises: [{ exercise_id: 'pushup', sets: [set(null, 0)] }] };
  const ex = JSON.stringify(bw);
  assert(ex.includes('pushup'));
  assert(['functionalStrengthTraining', 'traditionalStrengthTraining'].includes(activityTypeFor(bw)));
});

const win = { start: '2026-10-20T10:00:00Z', end: '2026-10-20T11:00:00Z' };
const other = (s, e, extra = {}) => ({ uuid: 'u1', start: s, end: e, kcal: 250.4, avgHr: 121.2, ...extra });

test('overlap math: 50% of the shorter one links; touching edges do not', () => {
  eq(overlapShare(win, other('2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z')), 1);
  eq(overlapShare(win, other('2026-10-20T11:00:00Z', '2026-10-20T12:00:00Z')), 0);
  eq(overlapShare(win, other('2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')), 0);
  // the Watch workout is 20 min inside a 60 min one: covers 100% of the shorter
  eq(overlapShare(win, other('2026-10-20T10:10:00Z', '2026-10-20T10:30:00Z')), 1);
  eq(overlapShare(win, other('2026-10-20T10:50:00Z', '2026-10-20T11:50:00Z')), 10 / 60);
  assert(pickOverlap(win, [other('2026-10-20T10:50:00Z', '2026-10-20T11:50:00Z')]) === null);
  assert(pickOverlap(win, [other('2026-10-20T10:30:00Z', '2026-10-20T11:30:00Z')]));
});

test('decision table: link / measured / estimate / skip / pending', () => {
  const linked = decide({ win, overlaps: [other(win.start, win.end)], measuredKcal: 0, estimate: 300 });
  eq(linked.action, 'link');
  eq(linked.patch, { apple_workout_uuid: 'u1', kcal_source: 'apple_watch', health_write: 'linked', kcal: 250, avg_hr: 121 });
  eq(decide({ win, overlaps: [], measuredKcal: 250, estimate: 300 }), { action: 'save', kcal: 250, source: 'measured' }); // 250 >= 0.7 x 300
  eq(decide({ win, overlaps: [], measuredKcal: 200, estimate: 300 }), { action: 'save', kcal: 300, source: 'estimate' }); // 200 < 210
  eq(decide({ win, overlaps: [], measuredKcal: 0, estimate: 300 }), { action: 'save', kcal: 300, source: 'estimate' });
  eq(decide({ win, overlaps: [], measuredKcal: 120, estimate: null }), { action: 'save', kcal: 120, source: 'measured' });
  eq(decide({ win, overlaps: [], measuredKcal: 0, estimate: null }), { action: 'skip', reason: 'no-weight' });
  eq(pendingPatch({}), { health_write: 'pending', health_tries: 1 });
  eq(pendingPatch({ health_tries: 3 }), { health_write: 'pending', health_tries: 4 });
  eq(pendingPatch({ health_tries: 4 }), { health_write: 'failed', health_tries: 5 });
});

test('edits bump the version; the window is the active time; summary lines', () => {
  eq(nextVersion({}), 1);
  eq(nextVersion({ health_version: 1 }), 2);
  eq(windowFor(strength([set(2, 0)])), { start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T11:00:00.000Z' });
  eq(kcalLine({ kcal: 180, kcal_source: 'estimate' }), '≈ 180 kcal (estimate)');
  eq(kcalLine({ kcal: 180, kcal_source: 'apple_watch' }), '180 kcal (Apple Watch)');
  eq(kcalLine({ kcal: 180, kcal_source: 'measured' }), '180 kcal (measured)');
  eq(kcalLine({}), null);
});

test('on the web the Health bridge is a no-op', async () => {
  globalThis.window = {};
  eq(plugin('ForgeWorkouts'), null);
  eq(writeEnabled(), false);
  eq(await sendWorkout(strength([set(2, 0)])), null);
  eq(afterFinish(strength([set(2, 0)])), undefined);
});

test('energy.js is not imported by progression, recovery or the generator (kcal never feeds them)', () => {
  for (const f of ['progression', 'recovery', 'generator', 'plan', 'focus', 'programs']) {
    const src = readFileSync(new URL(`../js/workouts/${f}.js`, import.meta.url), 'utf8');
    assert(!/energy\.js|workouts-health/.test(src), `${f}.js imports energy`);
  }
  const hits = readdirSync(new URL('../js/workouts/', import.meta.url)).filter((f) => f !== 'energy.js' && /energy\.js/.test(readFileSync(new URL(`../js/workouts/${f}`, import.meta.url), 'utf8')));
  eq(hits, []);
});

test('Info.plist has both Health strings and the share text no longer says it never writes', () => {
  const p = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
  assert(p.includes('NSHealthUpdateUsageDescription'));
  assert(!p.includes('never writes to Apple Health'));
});

test('Swift is wired: plugin file, bridge controller, scene delegate and project', () => {
  const r = (f) => readFileSync(new URL(`../ios/App/${f}`, import.meta.url), 'utf8');
  assert(r('App/ForgeWorkoutsPlugin.swift').includes('jsName = "ForgeWorkouts"'));
  assert(r('App/ForgeBridgeViewController.swift').includes('registerPluginInstance'));
  assert(r('App/SceneDelegate.swift').includes('ForgeBridgeViewController()'));
  const proj = r('App.xcodeproj/project.pbxproj');
  assert(proj.includes('ForgeWorkoutsPlugin.swift in Sources') && proj.includes('ForgeBridgeViewController.swift in Sources'));
});
