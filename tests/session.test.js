import { test, eq, assert } from './harness.js';
import { elapsedMs, pauseFields, resumeFields, awayGapMs, removeAwayFields, isPaused, AWAY_THRESHOLD_MS } from '../js/workouts/clock.js';
import { buildQueue, nextOpenStep, restAfter, setLabel, supersetTag, validateSet, exerciseComplete, sessionStats, versusLast, REST, exercisePRs, replacePRs, restPhrase } from '../js/workouts/session-core.js';
import { muscleGlow, hasFigure } from '../js/ui/figure.js';
import { coverage } from '../js/ui/poses.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { exerciseRecords } from '../js/workouts/history.js';
import { bestSet, historyRows, trendValues, sparkPoints, trendWords, replaceKeepingTargets } from '../js/workouts/exhistory.js';

const T0 = Date.parse('2026-10-08T10:00:00Z');
const min = 60000;

// ---------- pause clock ----------
test('clock: elapsed counts active time only', () => {
  const w = { started_at: new Date(T0).toISOString(), paused_ms: 0, paused_at: null };
  eq(elapsedMs(w, T0 + 10 * min), 10 * min);
});

test('clock: pause freezes, resume banks the paused stretch', () => {
  let w = { started_at: new Date(T0).toISOString(), paused_ms: 0, paused_at: null };
  w = { ...w, ...pauseFields(w, T0 + 5 * min) };
  assert(isPaused(w));
  eq(elapsedMs(w, T0 + 5 * min), 5 * min);
  eq(elapsedMs(w, T0 + 20 * min), 5 * min, 'frozen while paused');
  w = { ...w, ...resumeFields(w, T0 + 20 * min) };
  assert(!isPaused(w));
  eq(w.paused_ms, 15 * min);
  eq(elapsedMs(w, T0 + 25 * min), 10 * min);
});

test('clock: double pause and resume while running are no-ops', () => {
  const w = { started_at: new Date(T0).toISOString(), paused_ms: 0, paused_at: new Date(T0 + min).toISOString() };
  eq(Object.keys(pauseFields(w, T0 + 2 * min)).length, 0);
  eq(Object.keys(resumeFields({ ...w, paused_at: null }, T0 + 2 * min)).length, 0);
});

test('clock: paused state survives a reload (pure function of stored fields)', () => {
  const stored = JSON.parse(JSON.stringify({ started_at: new Date(T0).toISOString(), paused_ms: 2 * min, paused_at: new Date(T0 + 12 * min).toISOString() }));
  eq(elapsedMs(stored, T0 + 60 * min), 10 * min);
});

test('away: over 10 minutes away (not paused) is reported; paused or short gaps are not', () => {
  const w = { started_at: new Date(T0).toISOString(), paused_ms: 0, paused_at: null };
  eq(awayGapMs(w, T0, T0 + 14 * min), 14 * min);
  eq(awayGapMs(w, T0, T0 + 9 * min), 0);
  eq(awayGapMs({ ...w, paused_at: new Date(T0).toISOString() }, T0, T0 + 30 * min), 0);
  eq(AWAY_THRESHOLD_MS, 10 * min);
});

test('away: "remove it" turns the gap into paused time', () => {
  const w = { started_at: new Date(T0).toISOString(), paused_ms: 3 * min, paused_at: null };
  const r = { ...w, ...removeAwayFields(w, 14 * min) };
  eq(r.paused_ms, 17 * min);
  eq(elapsedMs(r, T0 + 30 * min), 13 * min);
});

// ---------- queue ----------
const set = (o = {}) => ({ warmup: false, done: false, reps: null, weight_kg: null, plan_reps: 10, plan_weight_kg: 10, ...o });
const exs = () => [
  { exercise_id: 'a', role: 'main', superset: null, sets: [set({ warmup: true }), set(), set(), set()] },
  { exercise_id: 'b', role: 'accessory', superset: 'A', sets: [set(), set(), set()] },
  { exercise_id: 'c', role: 'accessory', superset: 'A', sets: [set(), set()] },
  { exercise_id: 'd', role: 'secondary', superset: null, sets: [set(), set()] },
];

test('queue: normal exercise in order, supersets alternate by round', () => {
  const q = buildQueue(exs()).map(({ i, j }) => `${i}.${j}`).join(' ');
  eq(q, '0.0 0.1 0.2 0.3 1.0 2.0 1.1 2.1 1.2 3.0 3.1');
});

test('queue: next open step skips done sets and wraps around', () => {
  const e = exs();
  const q = buildQueue(e);
  e[0].sets[0].done = true;
  e[0].sets[1].done = true;
  eq(nextOpenStep(q, e, 0), 2);
  e[3].sets.forEach((s) => (s.done = true));
  eq(nextOpenStep(q, e, 9), 2, 'wraps to the first open step');
  e.forEach((x) => x.sets.forEach((s) => (s.done = true)));
  eq(nextOpenStep(q, e, 0), -1);
});

test('labels: set N of M (warm-ups separate) and superset tags', () => {
  const e = exs();
  eq(JSON.stringify(setLabel(e[0], 0)), '{"warmup":true,"n":1,"of":1}');
  eq(JSON.stringify(setLabel(e[0], 2)), '{"warmup":false,"n":2,"of":3}');
  eq(supersetTag(e, 1), 'A1');
  eq(supersetTag(e, 2), 'A2');
  eq(supersetTag(e, 0), null);
});

test('rest: by role, warm-ups short, none mid-superset, rest after the round', () => {
  const e = exs();
  const q = buildQueue(e);
  eq(restAfter(q, e, 0, {}).sec, REST.warmup);
  eq(restAfter(q, e, 1, {}).sec, REST.main);
  eq(restAfter(q, e, 4, {}), null, 'A1 → A2 same round: no rest');
  eq(restAfter(q, e, 5, {}).sec, REST.accessory, 'after A2: rest');
  eq(restAfter(q, e, 8, {}).sec, REST.accessory, 'A1 round 3 has no partner: rest');
  eq(restAfter(q, e, 9, {}).sec, REST.secondary);
  eq(restAfter(q, e, 9, { timed: true }).sec, REST.timed);
  eq(restAfter(q, e, 1, {}, { deload: true }).sec, Math.round(REST.main * 0.8));
});

test('validate: reps needed; weight needed for loaded working sets only', () => {
  const s = set();
  eq(validateSet({ load: 'dumbbell' }, s, { reps: null, weightKg: 10 }), 'Enter your reps first.');
  eq(validateSet({ load: 'dumbbell' }, s, { reps: 10, weightKg: null }), 'Enter the weight first.');
  eq(validateSet({ load: 'dumbbell' }, set({ warmup: true }), { reps: 10, weightKg: null }), null);
  eq(validateSet({ load: 'bodyweight' }, s, { reps: 10, weightKg: null }), null);
  eq(validateSet({ load: 'bodyweight', timed: true }, s, { reps: 0 }), 'Enter the seconds first.');
});

test('exercise complete and session stats ignore warm-ups', () => {
  const e = exs();
  e[0].sets[1].done = e[0].sets[2].done = true;
  assert(!exerciseComplete(e[0]));
  e[0].sets[3].done = true;
  assert(exerciseComplete(e[0]));
  e[0].sets[0] = set({ warmup: true, done: true, reps: 10, weight_kg: 50 });
  e[0].sets[1] = set({ done: true, reps: 10, weight_kg: 20 });
  const st = sessionStats(e, (kg) => kg * 2);
  eq(st.sets, 3);
  eq(st.volume, 400);
});

test('vs last time: weight up, reps at same weight, bodyweight and timed', () => {
  const db = { load: 'dumbbell' };
  eq(versusLast(db, [{ weight: 35, reps: 8 }], [{ weight: 30, reps: 12 }], 'lb').text, '+5 lb');
  eq(versusLast(db, [{ weight: 30, reps: 12 }, { weight: 30, reps: 11 }], [{ weight: 30, reps: 10 }]).text, '+2 reps');
  eq(versusLast(db, [{ weight: 30, reps: 10 }], [{ weight: 30, reps: 10 }]).tone, 'same');
  eq(versusLast({ load: 'bodyweight' }, [{ reps: 15 }], [{ reps: 12 }]).text, '+3 reps');
  eq(versusLast({ load: 'bodyweight', timed: true }, [{ reps: 40 }], [{ reps: 45 }]).text, '-5s');
  eq(versusLast(db, [{ weight: 30, reps: 10 }], null), null);
});

test('figure: muscles light the right segments (primary strong, secondary faint)', () => {
  const squat = EXERCISES.find((e) => e.id === 'bb_back_squat');
  const g = muscleGlow(squat);
  eq(g.quads, 1);
  eq(g.glutes, 1);
  eq(g.hamstrings, 0.45);
  const curl = muscleGlow(EXERCISES.find((e) => e.id === 'db_curl'));
  eq(curl.biceps, 1);
  eq(curl.forearms, 0.45);
  // Lats light the lats, not the whole torso.
  const pull = muscleGlow({ primary: ['lats'], secondary: ['biceps'] });
  eq(Object.keys(pull).sort().join(), 'biceps,lats');
});

test('figure: the library maps most exercises; every mapping points at a real template', () => {
  for (const id of ['bb_back_squat', 'pullup', 'db_curl', 'bb_bench_press', 'bb_deadlift', 'pushup', 'db_reverse_lunge']) assert(hasFigure(id), id);
  assert(hasFigure('bike_steady'), 'cardio machines have a figure since v0.14.4');
  assert(!hasFigure('muscleup'), 'moves without a clear figure fall back to photos or the muscle list');
  const c = coverage(EXERCISES);
  assert(c.mapped.length >= 200, `coverage ${c.mapped.length}`);
  eq(c.total, EXERCISES.length);
});

// ---------- PRs survive only while their set is done (undo recomputes) ----------
test('PRs: undoing the PR set removes the PR; other exercises keep theirs', () => {
  const ex = EXERCISES.find((e) => e.id === 'db_curl');
  const history = [{ sets: [{ weight: 20, reps: 10 }] }];
  const item = { exercise_id: 'db_curl', sets: [
    { done: true, weight_kg: 20, reps: 12 },
    { done: true, weight_kg: 20, reps: 9 },
  ] };
  const recs = exercisePRs(ex, item, history, 'kg');
  const rep = recs.find((r) => r.type === 'reps');
  assert(rep && rep.value === 12 && rep.prev === 10 && rep.weight === 20, 'rep PR with old best and weight');
  let prs = replacePRs([{ exercise_id: 'pullup', type: 'reps', value: 9 }], ex.id, recs);
  // Undo the 12-rep set.
  item.sets[0].done = false;
  prs = replacePRs(prs, ex.id, exercisePRs(ex, item, history, 'kg'));
  eq(prs.filter((p) => p.exercise_id === 'db_curl').length, 0);
  eq(prs.filter((p) => p.exercise_id === 'pullup').length, 1);
});

test('PRs: undo keeps a PR that another done set still earns', () => {
  const ex = EXERCISES.find((e) => e.id === 'db_curl');
  const history = [{ sets: [{ weight: 20, reps: 10 }] }];
  const item = { exercise_id: 'db_curl', sets: [
    { done: true, weight_kg: 20, reps: 12 },
    { done: true, weight_kg: 20, reps: 11 },
  ] };
  item.sets[0].done = false;
  const recs = exercisePRs(ex, item, history, 'kg');
  eq(recs.find((r) => r.type === 'reps').value, 11);
});

test('history: exercise records — est. 1RM, heaviest, most reps; holds for timed work', () => {
  const sessions = [
    { date: '2026-10-01', sets: [{ weight: 100, reps: 5 }, { weight: 90, reps: 9 }] },
    { date: '2026-09-20', sets: [{ weight: 110, reps: 2 }] },
  ];
  const r = exerciseRecords(sessions, { load: 'barbell' });
  eq(r.heaviest.value, 110);
  eq(r.reps.value, 9);
  eq(r.e1rm.value, Math.round(90 * (1 + 9 / 30)));
  const h = exerciseRecords([{ date: 'x', sets: [{ reps: 45 }, { reps: 60 }] }], { timed: true });
  eq(h.hold.value, 60);
  eq(exerciseRecords([], {}).e1rm, null);
});

test('rest: a rest timer set in the preview wins for working sets, not warm-ups', () => {
  const e = exs();
  e[0].rest_sec = 240;
  const q = buildQueue(e);
  eq(restAfter(q, e, 0, {}).sec, REST.warmup, 'warm-up keeps its short rest');
  eq(restAfter(q, e, 1, {}, { deload: true }).sec, 240, 'your choice, even on a deload');
  e[3].rest_sec = 60; // superset member: no rest mid-round still holds
  const q2 = buildQueue(e);
  eq(restAfter(q2, e, 4, {}), null);
});

test('coach: rests are spoken in minutes and seconds', () => {
  eq(restPhrase(150), 'Rest 2 minutes 30');
  eq(restPhrase(120), 'Rest 2 minutes');
  eq(restPhrase(60), 'Rest 1 minute');
  eq(restPhrase(90), 'Rest 1 minute 30');
  eq(restPhrase(45), 'Rest 45 seconds');
});

// ---- per-exercise rest timer (v0.16.65) ----
import { REST_WHEEL, snapRest, restPref, withRestPref, restFromPref, restChipText } from '../js/workouts/restprefs.js';

const rpEx = { id: 'bench', sets: [{ warmup: true }, { warmup: true }, { reps: 8 }, { reps: 8 }], role: 'main' };

test('restprefs: wheel runs 0:15 to 10:00 in 15 s steps', () => {
  assert(REST_WHEEL[0] === 15 && REST_WHEEL[1] === 30 && REST_WHEEL.at(-1) === 600 && REST_WHEEL.length === 40, 'range');
  assert(snapRest(52) === 45 && snapRest(1) === 15 && snapRest(9999) === 600 && snapRest('x') === null && snapRest(NaN) === null, 'snap');
});

test('restprefs: read, write and clear a pref without touching others', () => {
  const settings = { rest_prefs: { squat: { on: true, warm: 30, work: 180 } } };
  assert(restPref(settings, 'bench') === null && restPref(null, 'bench') === null, 'none');
  assert(restPref(settings, 'squat').work === 180, 'read');
  const next = withRestPref(settings, 'bench', { on: false, warm: 20, work: null });
  assert(next.squat.work === 180 && next.bench.on === false && next.bench.warm === 15 && next.bench.work === null, 'set + snapped');
  assert(settings.rest_prefs.bench === undefined, 'input not mutated');
  assert(!('bench' in withRestPref({ rest_prefs: next }, 'bench', null)), 'cleared');
});

test('restprefs: warm-up and working sets read their own value; off means none', () => {
  const p = { on: true, warm: 30, work: 150 };
  assert(restFromPref(p, true).sec === 30 && restFromPref(p, false).sec === 150, 'split');
  assert(restFromPref({ on: true, warm: null, work: 90 }, true) === null, 'no warm value falls back');
  assert(restFromPref({ on: false, warm: 30, work: 90 }, false).off === true && restFromPref(null, false) === null, 'off / none');
});

test('restprefs: restAfter uses the exercise pref over the dots-menu rest and the default', () => {
  const ws = [{ ...rpEx, rest_sec: 75 }];
  const q = buildQueue(ws);
  const pref = { on: true, warm: 30, work: 150 };
  assert(restAfter(q, ws, 0, {}, { defaultSec: 60, pref }).sec === 30, 'warm-up uses warm');
  assert(restAfter(q, ws, 2, {}, { defaultSec: 60, pref }).sec === 150, 'working uses work');
  assert(restAfter(q, ws, 2, {}, { defaultSec: 60, pref: null }).sec === 75, 'no pref keeps the dots-menu rest');
  assert(restAfter(q, ws, 2, {}, { defaultSec: 60, pref: { on: false, warm: 30, work: 150 } }) === null, 'off gives no rest');
  assert(restAfter(q, ws, 2, {}, { defaultSec: 60, pref: { on: true, warm: 30, work: null } }).sec === 75, 'missing working value falls back');
});

test('restprefs: chip text', () => {
  const f = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  assert(restChipText(null, f) === 'Rest timer' && restChipText({ on: false }, f) === 'Rest off', 'plain');
  assert(restChipText({ on: true, warm: 30, work: 90 }, f) === 'Rest 0:30 · 1:30' && restChipText({ on: true, warm: null, work: 90 }, f) === 'Rest 1:30', 'values');
});

// ---------- History + Replace chips (#194) ----------
const hxSessions = [ // newest first, like historyFor
  { date: '2026-10-20T10:00:00Z', deload: false, sets: [{ weight: 135, reps: 8 }, { weight: 135, reps: 6 }] },
  { date: '2026-10-13T10:00:00Z', deload: true, sets: [{ weight: 115, reps: 8 }] },
  { date: '2026-10-06T10:00:00Z', deload: false, sets: [{ weight: 125, reps: 8 }, { weight: 125, reps: 9 }] },
];

test('exhistory: best set and rows', () => {
  assert(bestSet(hxSessions[0].sets).reps === 8, 'best is the highest estimated max');
  assert(bestSet([{ weight: null, reps: 10 }, { weight: null, reps: 14 }]).reps === 14, 'bodyweight: most reps');
  assert(bestSet([]) === null, 'no sets');
  const rows = historyRows(hxSessions, { limit: 2 });
  eq(rows.length, 2);
  eq(rows[0].best, '135 × 8');
  eq(rows[0].sets, ['135 × 8', '135 × 6']);
  assert(rows[1].deload, 'deload flagged');
  eq(historyRows([{ date: 'x', sets: [{ weight: null, reps: 45 }] }], { timed: true })[0].best, '45 s');
});

test('exhistory: trend runs oldest to newest and speaks plainly', () => {
  const v = trendValues(hxSessions);
  eq(v.length, 3);
  assert(v[0] < v[2], 'newest is higher');
  eq(trendWords(v), 'Trending up.');
  eq(trendWords([100, 100.2]), 'Holding steady.');
  eq(trendWords([120, 100]), 'Trending down.');
  assert(trendWords([100]).includes('more times'), 'one session: no trend yet');
  const p = sparkPoints([1, 2, 3], 300, 80, 8);
  assert(p[0].x === 8 && p[2].x === 292 && p[2].y < p[0].y, 'higher values sit higher');
  eq(sparkPoints([5], 300, 80)[0].x, 150);
  eq(sparkPoints([], 300, 80), []);
});

test('exhistory: Replace keeps sets, reps, superset, role and rest', () => {
  const set = (o = {}) => ({ warmup: false, plan_weight_kg: 60, plan_reps: 10, weight_kg: null, reps: null, rir: null, done: false, completed_at: null, ...o });
  const old = { exercise_id: 'a', role: 'secondary', superset: 'A', rest_sec: 90, note: '', target: { sets: 4, rep_lo: 8, rep_hi: 12, reps: 10, weight_kg: 60 }, sets: [set(), set(), set(), set()] };
  const fresh = { exercise_id: 'b', role: 'accessory', superset: null, note: 'x', target: { sets: 3, rep_lo: 10, rep_hi: 15, reps: 12, weight_kg: 20 }, sets: [set({ warmup: true, plan_weight_kg: 10 }), set({ plan_weight_kg: 20, plan_reps: 12 }), set({ plan_weight_kg: 20, plan_reps: 12 }), set({ plan_weight_kg: 20, plan_reps: 12 })] };
  const r = replaceKeepingTargets(old, fresh);
  eq(r.exercise_id, 'b');
  eq(r.role, 'secondary');
  eq(r.superset, 'A');
  eq(r.rest_sec, 90);
  eq(r.sets.filter((s) => !s.warmup).length, 4);
  assert(r.sets.filter((s) => !s.warmup).every((s) => s.plan_reps === 10 && s.plan_weight_kg === 20), 'old rep target, new move weight');
  eq(r.sets.filter((s) => s.warmup).length, 1);
  eq(r.target.rep_hi, 12);
  eq(r.target.sets, 4);
  assert(replaceKeepingTargets({ ...old, sets: [set({ done: true })] }, fresh) === null, 'refuses once a set is done');
});
