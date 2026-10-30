// v0.16.45: Apple Watch workouts, Eaten vs burned, leg activity. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert, near } from './harness.js';
import { mapActivity, planWorkoutImport, workoutToCardio, skipReason, sourceTag } from '../js/health/apple-workouts.js';
import { energyChanged, newerDays, dayBalance, deficitText, todayLine, weekTotals, weekText, mergeEnergy, backfillStart, dayFraction } from '../js/nutrition/balance.js';
import { legActivity, legSummary } from '../js/workouts/leg-activity.js';
import { setsPerMuscle } from '../js/workouts/sets-per-muscle.js';
import { todayDue, TODAY_EVERY_MS, autoReadMode, backfillKey } from '../js/native/autoread.js';
import { fieldStatus } from '../js/health/status.js';
import { shiftDay } from '../js/health/metrics.js';

const W = (o) => ({ platformId: 'U1', workoutType: 'running', duration: 1800, startDate: '2026-10-20T10:00:00', endDate: '2026-10-20T10:30:00', totalEnergyBurned: 240, sourceName: 'Apple Watch', sourceId: 'com.apple.health.X', metadata: {}, ...o });

test('workout mapping: indoor run without distance is Jog in place; outdoor run and treadmill with distance are Run', () => {
  eq(mapActivity(W({ workoutType: 'runningTreadmill' })).activity, 'jog_in_place');
  eq(mapActivity(W({ metadata: { HKIndoorWorkout: 1 } })).activity, 'jog_in_place');
  eq(mapActivity(W({ metadata: { HKIndoorWorkout: 1 }, totalDistance: 150 })).activity, 'jog_in_place');
  eq(mapActivity(W({ workoutType: 'runningTreadmill', totalDistance: 3000 })).activity, 'run');
  eq(mapActivity(W({ totalDistance: 5000 })).activity, 'run');
  eq(mapActivity(W({})).activity, 'run'); // outdoor, no distance: still a run
});

test('workout mapping: the table, swim*, and unknown → other with a readable note', () => {
  const m = (t) => mapActivity(W({ workoutType: t })).activity;
  eq(m('walking'), 'walk'); eq(m('cycling'), 'bike'); eq(m('bikingStationary'), 'bike'); eq(m('rowingMachine'), 'row');
  eq(m('elliptical'), 'elliptical'); eq(m('stepTraining'), 'stairs'); eq(m('kickboxing'), 'boxing');
  eq(m('highIntensityIntervalTraining'), 'hiit'); eq(m('jumpRope'), 'jump_rope'); eq(m('swimmingPool'), 'swim');
  const o = mapActivity(W({ workoutType: 'mixedCardio' }));
  eq(o.activity, 'other');
  eq(o.notes, 'Mixed cardio · Apple Watch');
  eq(mapActivity(W({ workoutType: 'traditionalStrengthTraining' })).activity, 'other');
});

test('workout record: minutes, kcal, hr, no distance for Jog in place, deterministic id', () => {
  const f = workoutToCardio(W({ workoutType: 'runningTreadmill', avg_hr: 142, max_hr: 171 }));
  eq(f.activity, 'jog_in_place'); eq(f.duration_min, 30); eq(f.calories, 240); eq(f.avg_hr, 142); eq(f.max_hr, 171);
  eq(f.distance_km, null); eq(f.day, '2026-10-20'); eq(f.hk_uuid, 'U1');
  eq(workoutToCardio(W({ totalDistance: 5230 })).distance_km, 5.23);
  eq(workoutToCardio(W({ duration: 10 })).duration_min, 1);
  const p = planWorkoutImport([W({})]);
  eq(p.create[0].id, 'hk_U1');
});

test('Forge-written workouts are skipped (source id, ForgeWorkoutId) and so are linked overlaps', () => {
  eq(skipReason(W({ sourceId: 'com.christianeverett.forge' })), 'forge');
  eq(skipReason(W({ metadata: { ForgeWorkoutId: 'abc' } }), [], [{ id: 'abc', live_id: 'abc' }]), 'forge'); // with its Forge row (#254: without one it is imported)
  const forge = { started_at: '2026-10-20T10:02:00', finished_at: '2026-10-20T10:28:00', apple_workout_uuid: 'U1' };
  eq(skipReason(W({}), [forge]), 'linked');
  eq(skipReason(W({}), [{ ...forge, apple_workout_uuid: 'other' }]), null);
  eq(skipReason(W({}), [{ ...forge, started_at: '2026-10-20T11:00:00', finished_at: '2026-10-20T11:30:00' }]), null);
  eq(planWorkoutImport([W({ sourceId: 'com.christianeverett.forge' }), W({ platformId: 'U2' })]).create.length, 1);
});

test('idempotent: an existing doc is updated in place; a deleted one is never revived or rewritten', () => {
  const existing = new Map([['hk_U1', { deleted: false }], ['hk_U2', { deleted: true }]]);
  const p = planWorkoutImport([W({}), W({ platformId: 'U2' }), W({ platformId: 'U3' }), W({ platformId: 'U3' })], { existing });
  eq(p.update.map((x) => x.id).join(), 'hk_U1');
  eq(p.create.map((x) => x.id).join(), 'hk_U3');
  assert(!p.create.concat(p.update).some((x) => x.id === 'hk_U2'));
  eq(p.skipped, 2);
});

test('kcal fallback: sums active energy from the same source inside the window when totalEnergyBurned is missing', () => {
  const samples = [
    { startDate: '2026-10-20T10:05:00', value: 100, sourceId: 'com.apple.health.X' },
    { startDate: '2026-10-20T10:20:00', value: 60.4, sourceId: 'com.apple.health.X' },
    { startDate: '2026-10-20T10:10:00', value: 500, sourceId: 'com.other' },
    { startDate: '2026-10-20T12:00:00', value: 900, sourceId: 'com.apple.health.X' },
  ];
  eq(workoutToCardio(W({ totalEnergyBurned: undefined }), samples).calories, 160);
  eq(workoutToCardio(W({ totalEnergyBurned: undefined }), []).calories, null);
});

test('History tag: Apple Watch rows say so; typed rows say Manual', () => {
  eq(sourceTag({ source: 'apple_health', hk_source: 'Apple Watch' }), 'Apple Watch');
  eq(sourceTag({ source: 'manual' }), 'Manual');
});

test('Workouts chip counts imported cardio', () => {
  const st = fieldStatus([], '2026-10-21', [{ source: 'apple_health', day: '2026-10-20' }, { source: 'manual', day: '2026-10-19' }, { source: 'apple_health', day: '2026-10-19', deleted: true }]);
  const w = st.fields.find((f) => f.key === 'workouts');
  eq(w.lastDay, '2026-10-20'); eq(w.count28, 1);
});

// ---- balance ----
test('balance: active + Apple resting; workout kcal is never added on top', () => {
  const b = dayBalance({ eaten: 1620, active: 790, basal: 1150, today: false });
  eq(b.burned, 1940); eq(b.net, -320); eq(b.deficit, 320); eq(b.restingFrom, 'apple');
  eq(deficitText(b.deficit, b.eaten), '320 calorie deficit');
  const src = readFileSync(new URL('../js/nutrition/balance.js', import.meta.url), 'utf8');
  assert(!/calories\b.*cardio|cardio.*kcal/i.test(src.replace(/\/\/.*/g, '')), 'balance does not read cardio');
});

test('balance: partial-day proration of Mifflin, full value for past days', () => {
  const profile = { weightKg: 80, heightCm: 180, age: 40, sex: 'male' }; // 1730
  const noon = new Date(2026, 9, 21, 12, 0, 0);
  near(dayFraction(noon), 0.5, 0.001);
  near(dayBalance({ eaten: 0, profile, today: true, now: noon }).resting, 865, 0.5);
  near(dayBalance({ eaten: 0, profile, today: false, now: noon }).resting, 1730, 0.5);
  eq(dayBalance({ eaten: 0, profile, today: true, now: noon }).restingFrom, 'estimate');
});

test('balance: Apple basal beats Mifflin; no Health data and no profile → null; profile alone still gives resting', () => {
  const profile = { weightKg: 80, heightCm: 180, age: 40, sex: 'male' };
  eq(dayBalance({ eaten: 1000, active: 300, basal: 900, profile, today: false }).resting, 900);
  eq(dayBalance({ eaten: 1000 }), null);
  eq(dayBalance({ eaten: 1000, active: 0, profile: null }), null);
  const only = dayBalance({ eaten: 1000, active: 400 });
  eq(only.burned, 400); eq(only.resting, null);
  assert(dayBalance({ eaten: 1000, profile, today: false }).burned > 1700);
});

test('deficit math: signed text, over, even, nothing eaten', () => {
  eq(deficitText(612, 1500), '612 calorie deficit');
  eq(deficitText(-210, 2000), '210 calories over');
  eq(deficitText(0, 2000), 'Even');
  eq(deficitText(500, 0), '');
  eq(deficitText(1234, 1), '1,234 calorie deficit');
  eq(todayLine(dayBalance({ eaten: 1620, active: 790, basal: 1150 })), 'Burned 1,940 so far · 320 calorie deficit');
});

test('weekly deficit total counts only days with food and burn', () => {
  const rows = [
    { day: 'a', balance: dayBalance({ eaten: 2000, active: 500, basal: 1700 }) }, // +200
    { day: 'b', balance: dayBalance({ eaten: 2500, active: 300, basal: 1700 }) }, // -500
    { day: 'c', balance: null },
    { day: 'd', balance: dayBalance({ eaten: 0, active: 500, basal: 1700 }) }, // not eaten: left out
  ];
  const t = weekTotals(rows);
  eq(t.counted, 2); eq(t.deficit, -300);
  eq(weekText(t), '300 calories over across 2 days');
  eq(weekText(weekTotals([])), '');
});

test('the calorie ceiling never rises with burned energy: balance and its UI do not import targets for the ceiling', () => {
  const ui = readFileSync(new URL('../js/screens/balance-ui.js', import.meta.url), 'utf8');
  assert(!/computeTargets|currentTargets|calories \+/.test(ui), 'balance UI does not touch targets');
  assert(/doesn’t raise your target/.test(ui));
});

test('backfill: 30 days read on first run, idempotent merge, only today + yesterday afterwards', () => {
  const today = '2026-10-21';
  eq(backfillStart({}, today, shiftDay), '2026-09-22');
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push({ day: shiftDay(today, -i), active: 500, resting: 1700 });
  const once = mergeEnergy({}, entries, 1);
  const twice = mergeEnergy(once, entries, 1);
  eq(JSON.stringify(twice), JSON.stringify(once));
  eq(Object.keys(once).length, 30);
  eq(backfillStart(once, today, shiftDay), '2026-10-20');
  // a re-read of today overwrites it (still changing)
  eq(mergeEnergy(once, [{ day: today, active: 650 }], 2)[today].active, 650);
  eq(mergeEnergy(once, [{ day: today, active: 650 }], 2)[today].resting, 1700);
});

// ---- leg activity ----
const hd = (rows) => rows.map(([id, steps]) => ({ id, steps }));
const FROM = '2026-10-19', TO = '2026-10-26';

test('leg activity: 3,000 steps → 0; 10,500 steps → 3.0 step units', () => {
  const z = legActivity({ healthDaily: hd([['2026-10-20', 3000]]), cardio: [], from: FROM, to: TO });
  eq(z.quads, 0); eq(z.sources.stepUnits, 0);
  const a = legActivity({ healthDaily: hd([['2026-10-20', 10500]]), cardio: [], from: FROM, to: TO });
  eq(a.sources.stepUnits, 3);
  eq(a.calves, 3); eq(a.quads, 2); eq(a.glutes, 1.5); eq(a.hamstrings, 1); // 3 × 1 / 0.7 / 0.5 / 0.35, to 0.5
});

test('leg activity: 45 min jog → 3 bonus units; 30 min bike → 2.5 units weighted to quads; walk adds nothing', () => {
  const jog = legActivity({ healthDaily: [], cardio: [{ activity: 'jog_in_place', day: '2026-10-20', duration_min: 45 }], from: FROM, to: TO });
  eq(jog.sources.cardioUnits, 3); eq(jog.calves, 3); eq(jog.sources.stepUnits, 0);
  const bike = legActivity({ healthDaily: [], cardio: [{ activity: 'bike', day: '2026-10-20', duration_min: 30 }], from: FROM, to: TO });
  eq(bike.sources.cardioUnits, 2.5); eq(bike.quads, 2.5); eq(bike.glutes, 1.5); eq(bike.hamstrings, 1); eq(bike.calves, 1); // 0.5/0.35/0.3 × 2.5, to 0.5
  const walk = legActivity({ healthDaily: hd([['2026-10-20', 8000]]), cardio: [{ activity: 'walk', day: '2026-10-20', duration_min: 60 }], from: FROM, to: TO });
  eq(walk.sources.cardioUnits, 0); eq(walk.sources.stepUnits, 2);
});

test('leg activity: capped at 4.0, rounded to 0.5; null with no steps and no qualifying cardio; window respected', () => {
  const big = legActivity({ healthDaily: hd([['2026-10-20', 40000], ['2026-10-21', 40000]]), cardio: [{ activity: 'run', day: '2026-10-22', duration_min: 90 }], from: FROM, to: TO });
  for (const m of ['quads', 'hamstrings', 'glutes', 'calves']) { assert(big[m] <= 4); eq(big[m] * 2, Math.round(big[m] * 2)); }
  eq(big.calves, 4);
  eq(legActivity({ healthDaily: [], cardio: [], from: FROM, to: TO }), null);
  eq(legActivity({ healthDaily: [], cardio: [{ activity: 'walk', day: '2026-10-20', duration_min: 60 }, { activity: 'swim', day: '2026-10-20', duration_min: 60 }], from: FROM, to: TO }), null);
  eq(legActivity({ healthDaily: hd([['2026-10-10', 20000]]), cardio: [{ activity: 'run', day: '2026-10-10', duration_min: 30, deleted: true }], from: FROM, to: TO }), null);
});

test('leg activity sheet text names steps and jogging', () => {
  const a = legActivity({ healthDaily: hd([['2026-10-20', 52300]]), cardio: [{ activity: 'run', day: '2026-10-20', duration_min: 45 }], from: FROM, to: TO });
  const t = legSummary(a);
  assert(t.startsWith('From 52,300 steps and 45 min of jogging this week.'), t);
  assert(t.includes('doesn’t count toward your 10–20 sets, progression or leg-day suggestions'));
});

test('isolation: setsPerMuscle is unchanged by steps and cardio, and training modules never import leg-activity', () => {
  const dir = new URL('../js/', import.meta.url);
  const w = [{ started_at: '2026-10-20T10:00:00', exercises: [{ exercise_id: 'back_squat', sets: [{ done: true }, { done: true }] }] }];
  const before = JSON.stringify(setsPerMuscle(w, FROM, TO));
  legActivity({ healthDaily: hd([['2026-10-20', 30000]]), cardio: [{ activity: 'run', day: '2026-10-20', duration_min: 60 }], from: FROM, to: TO });
  eq(JSON.stringify(setsPerMuscle(w, FROM, TO)), before);
  for (const f of ['workouts/progression.js', 'workouts/recovery.js', 'workouts/generator.js', 'workouts/focus.js', 'workouts/rings.js']) {
    let src = '';
    try { src = readFileSync(new URL(f, dir), 'utf8'); } catch { continue; }
    assert(!/leg-activity/.test(src), `${f} must not import leg-activity`);
  }
  const sets = readFileSync(new URL('workouts/sets-per-muscle.js', dir), 'utf8').replace(/\/\/.*/g, '');
  assert(!/leg|steps|cardio/i.test(sets), 'setsPerMuscle stays hard-sets only');
});

// ---- today re-sync ----
test('today re-read is due every 3 minutes, independent of the 6 h read', () => {
  const now = new Date('2026-10-21T12:00:00');
  assert(todayDue({ now, todayAt: 0 }));
  assert(!todayDue({ now, todayAt: now.getTime() - 60000 }));
  assert(todayDue({ now, todayAt: now.getTime() - TODAY_EVERY_MS }));
});

test('no network calls in the new pure modules; READ_TYPES asks for workouts, heartRate and basalCalories', async () => {
  for (const f of ['health/apple-workouts.js', 'nutrition/balance.js', 'workouts/leg-activity.js']) {
    const src = readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
    assert(!/fetch\(|functions\.js|firebase/.test(src), `${f} is pure`);
  }
  const h = readFileSync(new URL('../js/native/health.js', import.meta.url), 'utf8');
  for (const t of ["'workouts'", "'heartRate'", "'basalCalories'"]) assert(h.includes(t), t);
});

// ---- review round 1 ----
test('a re-read with the same numbers is not a change (no state.set, no redraw); a new number is', () => {
  const a = mergeEnergy({}, [{ day: '2026-10-21', active: 400, resting: 1500 }], 1);
  const same = mergeEnergy(a, [{ day: '2026-10-21', active: 400, resting: 1500 }], 999);
  assert(!energyChanged(a, same));
  assert(energyChanged(a, mergeEnergy(a, [{ day: '2026-10-21', active: 410 }], 999)));
  assert(energyChanged(a, mergeEnergy(a, [{ day: '2026-10-20', resting: 1700 }], 999)));
});

test('today re-read writes only the days that differ from health_daily', () => {
  const rows = [{ id: '2026-10-21', steps: 5000, active_kcal: 300 }];
  eq(newerDays([{ day: '2026-10-21', steps: 5000, active_kcal: 300 }], rows).length, 0);
  eq(newerDays([{ day: '2026-10-21', steps: 5200, active_kcal: 300 }], rows).length, 1);
  eq(newerDays([{ day: '2026-10-22', steps: 10 }], rows).length, 1);
});

test('the player ignores energy, health_daily and cardio patches while a workout is active', () => {
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const m = src.match(/const PLAYER_QUIET = new Set\(\[([^\]]*)\]\)/);
  assert(m, 'PLAYER_QUIET exists');
  for (const k of ['energy', 'health_daily', 'workouts']) assert(m[1].includes(`'${k}'`), k);
  assert(/keys\.every\(\(k\) => PLAYER_QUIET\.has\(k\)\)/.test(src));
});

test('first launch of 0.16.45: the 30-day workouts + energy read runs at once, not after the 6 h wait, and backs off after a failure', () => {
  const now = new Date('2026-10-21T14:00:00');
  const base = { now, last: now.getTime() - 60000, today: '2026-10-21', rows: [] };
  eq(autoReadMode({ ...base, backfill: false }), null);
  eq(autoReadMode({ ...base, backfill: true }), 'backfill');
  eq(autoReadMode({ ...base, backfill: true, backfillFailedAt: now.getTime() - 60000 }), null);
  eq(autoReadMode({ ...base, backfill: true, backfillFailedAt: now.getTime() - 21 * 60000 }), 'backfill');
  assert(backfillKey('u1') !== backfillKey('u2'), 'one flag per account');
  const src = readFileSync(new URL('../js/screens/apple.js', import.meta.url), 'utf8');
  assert(/first \? from30 : backfillStart/.test(src) && /first && from30 < since \? from30 : since/.test(src), 'workouts and energy reach back 30 days on the first read');
  assert(/if \(first && workoutsOk\) markBackfillDone\(uid\)/.test(src));
});

test('the backfill plan is idempotent: a second pass over the same Watch workouts creates nothing and never revives a deleted row', () => {
  const ws = [W({}), W({ platformId: 'U2' }), W({ platformId: 'U3', startDate: '2026-09-25T08:00:00', endDate: '2026-09-25T08:30:00' })];
  const first = planWorkoutImport(ws, {});
  eq(first.create.length, 3);
  const existing = new Map(first.create.map((c) => [c.id, { deleted: c.id === 'hk_U2' }]));
  const second = planWorkoutImport(ws, { existing });
  eq(second.create.length, 0);
  assert(!second.update.some((u) => u.id === 'hk_U2'));
});
