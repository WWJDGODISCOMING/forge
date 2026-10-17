// v0.10.0 Forge Coach (no-AI mode): every answer function, the hidden-chip rule, numbers that match the source
// modules, and actions that only call existing functions. Synthetic data only.
import { readFileSync, readdirSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { weekLabel, recoveredPhrase, needsStarter, weekAnswer, goalAnswer, weightAnswer, weightLabel, trainAnswer, recoveredAnswer, scoreAnswer, strongerAnswer, availableQuestions, QUESTIONS, MEDICAL as COACH_MEDICAL } from '../js/coach/answers.js';
import { runAction } from '../js/coach/actions.js';
import { liftChanges } from '../js/coach/lifts.js';
import { dailyWeights, smooth, trendChange } from '../js/weight/smoothing.js';
import { shiftDay } from '../js/health/metrics.js';
import { buildSeries, allTrends } from '../js/health/trends.js';
import { goalPath } from '../js/health/goalpath.js';
import { weeklyReport, reportWeekFor } from '../js/health/weekly.js';
import { readiness, fmtH } from '../js/health/readiness.js';
import { forgeScore } from '../js/health/score.js';
import { fmtDelta } from '../js/health/delta.js';
import { MEDICAL } from '../js/health/insights.js';
import { weightToDisplay } from '../js/units.js';
import { e1rm } from '../js/workouts/progression.js';
import { fatigueAt, recoveryPct } from '../js/workouts/recovery.js';
import { EXERCISES } from '../js/workouts/exercises.js';
import { backTarget } from '../js/nav.js';
import { freshCount, SHOW_MUSCLES } from '../js/workouts/recovery.js';

const TODAY = '2026-10-10'; // a Saturday
const dayAt = (i) => shiftDay(TODAY, -i);
const exById = (id) => EXERCISES.find((e) => e.id === id) || null;
const nameOf = (id) => (exById(id) || { name: id }).name;
const LIFT = EXERCISES.find((e) => e.primary && e.primary.length).id;

/** A weight series ending today: `n` days, kg falling `perDay`, with a small repeatable wiggle. */
const weights = (n, perDay = 0.04, last = null) => {
  const entries = Array.from({ length: n }, (_, k) => ({ day: dayAt(n - 1 - k), kg: 90 - perDay * k + (((k * 7) % 5) - 2) * 0.15 }));
  if (last != null) entries[entries.length - 1].kg = last;
  return smooth(dailyWeights(entries));
};
const healthRows = (today = {}) => {
  const rows = [];
  for (let i = 30; i >= 1; i--) rows.push({ id: dayAt(i), hrv_sdnn_ms: 50 + ((i * 7) % 5 - 2) * 1.5, rhr_bpm: 55 + ((i * 7) % 3 - 1), resp_rate: 14, wrist_temp_delta_c: 0, steps: 8000, exercise_min: 30, sleep: { asleep_min: 420 + ((i * 7) % 7 - 3) * 8 } });
  rows.push({ id: TODAY, hrv_sdnn_ms: 50, rhr_bpm: 55, resp_rate: 14, wrist_temp_delta_c: 0, sleep: { asleep_min: 420 }, ...today });
  return rows;
};
const set = (kg, reps) => ({ done: true, warmup: false, weight_kg: kg, reps, rir: 2, completed_at: null });
const workout = (i, kg, reps, extra = {}) => ({
  id: `w${i}`, status: 'done', started_at: `${dayAt(i)}T10:00:00.000Z`, finished_at: `${dayAt(i)}T11:00:00.000Z`,
  exercises: [{ exercise_id: LIFT, role: 'main', sets: [set(kg, reps), set(kg, reps), set(kg, reps)] }], prs: [], ...extra,
});

/** Builds the same shape as js/coach/data.js, but from the pure modules and synthetic inputs. */
function build({ ws = weights(30), goalKg = 80, rows = healthRows(), workouts = [workout(5, 100, 5), workout(33, 90, 5), workout(90, 80, 5)], profile = { goal: 'lose', trainingDays: 3, targetWeightKg: goalKg }, plan = 'default', stalled = [], overridden = false, active = false } = {}) {
  const series = buildSeries({ weights: ws, measures: [], rows });
  const fatigue = fatigueAt(workouts, exById, Date.parse(`${TODAY}T12:00:00Z`));
  return {
    today: TODAY, units: 'metric', unit: 'kg', goal: profile.goal, goalKg,
    weights: ws, trends: allTrends({ series, today: TODAY, goal: profile.goal }),
    goalPath: goalPath({ series: ws, goalKg, today: TODAY }),
    report: weeklyReport({ weekStart: reportWeekFor(TODAY), today: TODAY, series: ws, measures: [], rows, workouts, cardio: [], profile }),
    readiness: readiness({ rows, today: TODAY, load: 0, units: 'metric' }),
    readinessOverridden: overridden,
    score: forgeScore({ rows, series: ws, measures: [], workouts, cardio: [], profile, today: TODAY }),
    plan: plan === 'default' ? { label: 'Upper body', exercises: [{}, {}, {}], est_minutes: 45, location: { name: 'Home gym' }, deload: false, readiness: null } : plan,
    recovery: recoveryPct(fatigue),
    activeWorkout: active,
    hasTraining: workouts.length > 0,
    lifts: liftChanges({ workouts, unit: 'kg', today: TODAY, nameOf }),
    stalled,
  };
}

const ALL = [weekAnswer, goalAnswer, weightAnswer, trainAnswer, recoveredAnswer, scoreAnswer, strongerAnswer];
const textOf = (a) => [a.headline, ...a.lines, a.why, a.note || '', a.action ? a.action.label + a.action.ask : ''].join(' | ');

// ---------- enough data ----------

test('coach: with enough data every question answers with a headline, 2–4 lines and a Why', () => {
  const d = build({ stalled: [{ id: LIFT, name: nameOf(LIFT) }] });
  for (const f of ALL) {
    const a = f(d, TODAY);
    assert(a, `${f.name} returned nothing`);
    assert(a.headline && a.headline.length > 3, `${f.name} headline`);
    assert(a.lines.length >= 2 && a.lines.length <= 4, `${f.name} has ${a.lines.length} lines`);
    assert(a.why && a.why.length > 10, `${f.name} why`);
  }
  eq(availableQuestions(d, TODAY).length, QUESTIONS.length - 4, 'all seven chips show (missions, program, long term and the focus question need their own data)');
});

// ---------- too little data: null, so the chip is hidden ----------

test('coach: with no data every answer is null and no chip shows (and nothing throws)', () => {
  for (const f of ALL) eq(f({}, TODAY), null, f.name);
  const bare = build({ ws: [], rows: [], workouts: [], plan: null, goalKg: null, profile: { goal: 'health' } });
  for (const f of ALL) eq(f(bare, TODAY), null, `${f.name} on an empty account`);
  eq(availableQuestions(bare, TODAY).length, 0);
});

test('coach: each question needs its own data', () => {
  eq(weightAnswer(build({ ws: weights(2) }), TODAY), null, 'two weigh-ins');
  eq(goalAnswer(build({ ws: weights(4) }), TODAY), null, 'too few weigh-ins for a goal path');
  eq(scoreAnswer(build({ rows: [], ws: weights(3), workouts: [] }), TODAY), null, 'fewer than 3 pillars tracked');
  eq(trainAnswer(build({ plan: { exercises: [] } }), TODAY), null, 'no plan');
  eq(recoveredAnswer(build({ rows: [], workouts: [] }), TODAY), null, 'no readiness and no training');
  eq(weekAnswer(build({ ws: [], rows: [], workouts: [] }), TODAY), null, 'nothing logged');
});

// ---------- edge cases ----------

test('coach goal: no goal hides it; goal reached says so; moving away and steady are handled', () => {
  eq(goalAnswer(build({ goalKg: null }), TODAY), null, 'no goal');
  const ws = weights(30);
  const here = ws[ws.length - 1].trend;
  const reached = goalAnswer(build({ ws, goalKg: here + 0.05 }), TODAY);
  assert(reached.headline.includes('at your goal'), reached.headline);
  const away = goalAnswer(build({ ws, goalKg: here + 10 }), TODAY); // losing, goal is higher
  assert(away.headline.includes('away from your goal'), away.headline);
  const flat = goalAnswer(build({ ws: weights(30, 0), goalKg: 80 }), TODAY);
  assert(flat.headline.includes('steady'), flat.headline);
  const ok = goalAnswer(build({ ws, goalKg: here - 5 }), TODAY);
  assert(ok.headline.startsWith('On pace for'), ok.headline);
});

test('coach goal: faster than the safe pace is called out', () => {
  const a = goalAnswer(build({ ws: weights(30, 0.2), goalKg: 60 }), TODAY);
  assert(textOf(a).includes('safe'), 'mentions the safe pace');
  assert(a.lines.some((l) => l.includes('faster than the safe')), a.lines.join(' / '));
});

test('coach stronger: lifting with no history is hidden; one block of history is hidden; two blocks answer', () => {
  eq(strongerAnswer(build({ workouts: [] }), TODAY), null);
  eq(strongerAnswer(build({ workouts: [workout(5, 100, 5)] }), TODAY), null, 'nothing to compare with yet');
  const a = strongerAnswer(build({ workouts: [workout(5, 100, 5), workout(33, 90, 5)] }), TODAY);
  eq(a.headline, 'Your main lift is up over 4 weeks.');
  eq(a.action, undefined, 'no stalled lift, no deload suggestion');
});

test('coach stronger: deload weeks do not count toward 1RM', () => {
  const l = liftChanges({ workouts: [workout(5, 100, 5), workout(33, 90, 5), workout(10, 200, 5, { deload: true })], unit: 'kg', today: TODAY, nameOf });
  eq(l[0].now, Math.round(e1rm(100, 5)));
});

test('coach recovered: red offers "Make today lighter" only when Readiness was overridden', () => {
  const red = { hrv_sdnn_ms: 20, rhr_bpm: 80, sleep: { asleep_min: 200 }, resp_rate: 20, wrist_temp_delta_c: 1.2 };
  const d = build({ rows: healthRows(red) });
  assert(d.readiness.status === 'ok' && d.readiness.level === 'red', `fixture should be red, got ${d.readiness.level}`);
  const plain = recoveredAnswer(d, TODAY);
  eq(plain.action, undefined);
  assert(plain.lines.some((l) => l.includes('already set to a lighter day')));
  const over = recoveredAnswer({ ...d, readinessOverridden: true }, TODAY);
  eq(over.action.id, 'lighter');
  eq(over.action.label, 'Make today lighter');
  assert(over.note === MEDICAL, 'reuses the MEDICAL wording');
  eq(COACH_MEDICAL, MEDICAL);
});

test('coach recovered: without Apple Health it uses training alone', () => {
  const a = recoveredAnswer(build({ rows: [] }), TODAY);
  assert(a && a.headline.includes('muscle groups are fresh'));
});

test('coach train: an open workout replaces the Start action', () => {
  const a = trainAnswer(build({ active: true }), TODAY);
  eq(a.action, undefined);
  assert(a.headline.includes('in progress'));
});

test('coach weight: the chip words follow the reading against the trend', () => {
  eq(weightLabel(build({ ws: weights(30, 0.04, 95) })), 'Why did my weight go up?');
  eq(weightLabel(build({ ws: weights(30, 0.04, 80) })), 'Why did my weight go down?');
  eq(weightLabel({}), 'Why did my weight change?');
});

test('coach weight: a steady trend reads as noise; body composition adds the fat vs lean split', () => {
  const steady = weightAnswer(build({ ws: weights(30, 0) }), TODAY);
  assert(steady.headline.includes('steady'), steady.headline);
  const moving = weightAnswer(build({ ws: weights(30, 0.1) }), TODAY);
  assert(/trend is (up|down)/.test(moving.headline), moving.headline);
  assert(moving.lines.some((l) => l.includes('Salt, carbs and water')));
  const d = build();
  const mk = (key, slope) => ({ key, t28: { enough: true, slopePerWeek: slope } });
  const withComp = weightAnswer({ ...d, trends: [mk('fat_mass_kg', -0.3), mk('fat_free_mass_kg', 0.05)] }, TODAY);
  assert(withComp.lines.some((l) => l.includes('fat') && l.includes('lean')), withComp.lines.join(' / '));
  assert(withComp.lines.length <= 4);
});

// ---------- no NaN / undefined / Infinity ----------

test('coach: no answer ever shows NaN, undefined, null or Infinity', () => {
  const red = healthRows({ hrv_sdnn_ms: 20, rhr_bpm: 80, sleep: { asleep_min: 200 }, resp_rate: 20 });
  const fixtures = [
    build(), build({ ws: weights(30, 0) }), build({ ws: weights(30, 0.2), goalKg: 60 }), build({ goalKg: weights(30)[29].trend + 0.05 }),
    build({ rows: red, overridden: true }), build({ rows: [] }), build({ workouts: [workout(5, 100, 5), workout(33, 90, 5)] }),
    build({ ws: weights(8) }), build({ ws: weights(30, -0.05), goalKg: 100 }),
    build({ stalled: [{ id: LIFT, name: nameOf(LIFT) }] }),
  ];
  for (const d of fixtures) for (const f of ALL) {
    const a = f(d, TODAY);
    if (a) assert(!/NaN|undefined|null|Infinity/.test(textOf(a)), `${f.name}: ${textOf(a)}`);
  }
});

// ---------- numbers come from the source modules ----------

test('coach numbers: weekly answer matches the weekly report', () => {
  const d = build();
  const a = weekAnswer(d, TODAY);
  const r = d.report;
  assert(a.lines[0].startsWith(`${r.training.workouts} workout`), a.lines[0]);
  assert(a.lines[0].includes(`${r.training.planned} planned`));
  const dl = fmtDelta(weightToDisplay(r.weight.change, 'metric'), { digits: 1, unit: 'kg' });
  assert(a.lines.some((l) => l.includes(dl.text)), `${dl.text} in ${a.lines.join(' / ')}`);
  assert(a.lines.includes(r.suggestion.text), 'the report’s own suggestion, word for word');
});

test('coach numbers: goal answer matches the goal path', () => {
  const d = build({ goalKg: 80 });
  const p = d.goalPath;
  assert(p.status === 'ok', p.status);
  const a = goalAnswer(d, TODAY);
  const day = (k) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  assert(a.headline.includes(day(p.etaDay)), `${a.headline} vs ${p.etaDay}`);
  assert(a.lines[0].includes(Math.abs(p.current).toFixed(1)), a.lines[0]);
  assert(a.lines[0].includes(Math.abs(p.remaining).toFixed(1)), a.lines[0]);
  assert(a.lines.some((l) => l.includes(Math.abs(p.capKgPerWeek).toFixed(1))), 'the safe pace');
});

test('coach numbers: weight answer matches the smoothing module', () => {
  const ws = weights(30, 0.1);
  const a = weightAnswer(build({ ws }), TODAY);
  const change = trendChange(ws, 7);
  assert(a.headline.includes(Math.abs(change).toFixed(1)), `${a.headline} vs ${change}`);
  const last = ws[ws.length - 1];
  assert(a.lines[0].includes(last.kg.toFixed(1)) && a.lines[0].includes(last.trend.toFixed(1)), a.lines[0]);
});

test('coach numbers: score answer matches the Forge Score', () => {
  const d = build();
  const a = scoreAnswer(d, TODAY);
  eq(a.headline, `Your Forge Score is ${Math.round(d.score.score)}.`);
  for (const p of d.score.pillars.filter((x) => x.tracked && x.score != null)) assert(a.lines[0].includes(`${p.label} ${Math.round(p.score)}`), p.label);
});

test('coach numbers: strength answer matches e1rm() from the progression module', () => {
  const l = liftChanges({ workouts: [workout(5, 100, 5), workout(33, 90, 5), workout(90, 80, 5)], unit: 'kg', today: TODAY, nameOf });
  eq(l.length, 1);
  eq(l[0].now, Math.round(e1rm(100, 5)));
  eq(l[0].before4, Math.round(e1rm(90, 5)));
  eq(l[0].change4, Math.round(e1rm(100, 5)) - Math.round(e1rm(90, 5)));
  eq(l[0].change12, Math.round(e1rm(100, 5)) - Math.round(e1rm(80, 5)));
  const a = strongerAnswer(build(), TODAY);
  assert(a.lines[0].includes(`${l[0].now} kg`) && a.lines[0].includes(`+${l[0].change4} kg in 4 weeks`) && a.lines[0].includes(`+${l[0].change12} kg in 12 weeks`), a.lines[0]);
});

// ---------- actions ----------

const spies = () => {
  const calls = [];
  const spy = (name, ret) => (...args) => { calls.push([name, ...args]); return ret; };
  const plan = { exercises: [{}] };
  return {
    calls,
    deps: {
      previewPlan: spy('previewPlan', plan), startPlan: spy('startPlan'), startDeload: spy('startDeload'),
      overrideReadiness: spy('overrideReadiness'), confirm: async (o) => { calls.push(['confirm', o.title]); return true; },
    },
    plan,
  };
};

test('coach actions: Start this workout uses previewPlan + startPlan, nothing else', async () => {
  const s = spies();
  eq(await runAction('start_workout', s.deps), 'started');
  eq(s.calls.map((c) => c[0]).join(), 'previewPlan,startPlan');
  eq(s.calls[1][1], s.plan, 'starts the plan Today shows');
});

test('coach actions: Make today lighter turns Readiness back on', async () => {
  const s = spies();
  await runAction('lighter', s.deps);
  eq(JSON.stringify(s.calls), JSON.stringify([['overrideReadiness', false]]));
});

test('coach actions: deload asks first, and "no" changes nothing', async () => {
  const s = spies();
  eq(await runAction('deload', s.deps), 'deload');
  eq(s.calls.map((c) => c[0]).join(), 'confirm,startDeload');
  const n = spies();
  n.deps.confirm = async () => false;
  eq(await runAction('deload', n.deps), 'cancelled');
  eq(n.calls.length, 0, 'startDeload was not called');
  eq(await runAction('nope', n.deps), 'none');
});

test('coach: only the three actions exist, and answers offer them by name', () => {
  const stalled = [{ id: LIFT, name: nameOf(LIFT) }];
  eq(trainAnswer(build(), TODAY).action.id, 'start_workout');
  eq(trainAnswer(build(), TODAY).action.label, 'Start this workout');
  eq(strongerAnswer(build({ stalled }), TODAY).action.id, 'deload');
  eq(strongerAnswer(build({ stalled }), TODAY).action.label, 'Start a deload week');
});

// ---------- housekeeping ----------

test('coach: no network and no new storage in the coach code', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const files = [...readdirSync(new URL('../js/coach', import.meta.url)).map((f) => `js/coach/${f}`), 'js/screens/coach.js'];
  for (const f of files) {
    const src = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|firebase|functions\.js|put\(|patch\(|localStorage/.test(src), `${f} touches the network or storage`);
  }
});

test('coach: the screen is a detail screen under Today', () => {
  eq(backTarget(['coach']), '#/today');
});

// ---------- review round 1 ----------

/** Same data as build(), with the latest reading set to kg against a given trend, in the given units. */
const withLast = (kg, trend, units) => {
  const w = weights(30).map((x) => ({ ...x }));
  Object.assign(w[w.length - 1], { kg, trend });
  return { ...build({ ws: w }), weights: w, units };
};

test('coach week: the chip label matches the data (last week, or this week while partial)', () => {
  eq(weekLabel({ report: { partial: false } }), 'How did last week go?');
  eq(weekLabel({ report: { partial: true } }), 'How is this week going?');
  const d = build();
  eq(availableQuestions(d, TODAY).find((q) => q.id === 'week').label, weekLabel(d));
});

test('coach train: names the muscles today trains (not the most recovered) and what amber does', () => {
  const rec = Object.fromEntries(SHOW_MUSCLES.map((m) => [m, 100]));
  rec.quads = 96; rec.glutes = 97;
  const plan = { label: 'Lower', exercises: [{}, {}], est_minutes: 40, location: { name: 'Home gym' }, deload: false, readiness: 'amber' };
  const a = trainAnswer({ ...build({ plan }), recovery: rec, planMuscles: ['quads', 'glutes', 'hamstrings'] }, TODAY);
  const text = a.lines.join(' | ');
  assert(text.includes('Today works quads, glutes and hamstrings (all 95%+ recovered)'), text);
  assert(!text.includes('Most recovered'), text);
  assert(text.includes('Readiness is amber, so each accessory has one set less.'), text);
  rec.quads = 60;
  const b = trainAnswer({ ...build({ plan }), recovery: rec, planMuscles: ['quads', 'glutes'] }, TODAY);
  assert(b.lines.join(' | ').includes('the lowest is 60% recovered'), b.lines.join(' | '));
});

test('coach recovered: the fresh count is the Body tab count (one shared list)', () => {
  const rec = Object.fromEntries(SHOW_MUSCLES.map((m) => [m, 100]));
  rec.abductors = 100; // modelled, but not one of the groups the Body tab shows
  eq(freshCount(rec), SHOW_MUSCLES.length);
  const all = recoveredAnswer({ ...build({ rows: [] }), recovery: rec }, TODAY);
  eq(all.headline, `${SHOW_MUSCLES.length} of ${SHOW_MUSCLES.length} muscle groups are fresh.`);
  rec.chest = 10;
  const some = recoveredAnswer({ ...build({ rows: [] }), recovery: rec }, TODAY);
  eq(some.headline, `${freshCount(rec)} of ${SHOW_MUSCLES.length} muscle groups are fresh.`);
});

test('coach weight: the gap is the difference of the displayed numbers', () => {
  for (const [kg, trend] of [[92.25, 91.85], [91.37, 92.03], [90.46, 90.04]]) {
    const a = weightAnswer(withLast(kg, trend, 'imperial'), TODAY);
    const m = /Scale ([\d.]+) lb, trend ([\d.]+) lb: ([\d.]+) lb (above|below)/.exec(a.lines[0]);
    assert(m, a.lines[0]);
    eq(Math.abs(Number(m[1]) - Number(m[2])).toFixed(1), m[3], a.lines[0]);
  }
});

test('coach weight: uses the user’s units and only blames training when the scale is above the trend', () => {
  const up = weightAnswer(withLast(91, 90, 'imperial'), TODAY).lines.join(' | ');
  assert(up.includes('Hard sessions hold water') || up.includes('No workouts'), up);
  assert(up.includes('2 lb or more') && !up.includes('kilo'), up);
  const down = weightAnswer(withLast(89, 90, 'imperial'), TODAY).lines.join(' | ');
  assert(down.includes('Some of today’s drop is likely water; the trend is what counts.'), down);
  assert(!down.includes('Hard sessions') && !down.includes('No workouts'), down);
  assert(weightAnswer(withLast(91, 90, 'metric'), TODAY).lines.join(' | ').includes('a kilo or more'));
});

test('coach screen: the starter card applies with no weigh-ins and no workouts, even though Train has a chip', () => {
  const none = build({ ws: [], rows: [], workouts: [] });
  eq(needsStarter(none), true);
  assert(availableQuestions(none, TODAY).some((q) => q.id === 'train'), 'the Train chip is still offered');
  eq(needsStarter(build()), false);
  eq(needsStarter(build({ ws: [] })), false, 'workouts alone are enough');
  eq(needsStarter(build({ workouts: [] })), false, 'weigh-ins alone are enough');
});

test('coach goal: the safe pace is shown with one decimal', () => {
  const a = goalAnswer(build({ ws: weights(30, 0.2), goalKg: 60 }), TODAY);
  assert(/safe (pace is up to )?\d+\.\d kg/.test(textOf(a)) && !/safe (pace is up to )?\d+\.\d\d/.test(textOf(a)), textOf(a));
});

test('readiness: sleep times read "1 h", "45 min" and "1 h 5 min"', () => {
  eq(fmtH(60), '1 h');
  eq(fmtH(45), '45 min');
  eq(fmtH(65), '1 h 5 min');
  eq(fmtH(119.6), '2 h');
});

test('coach train: recovered wording never says 100%+', () => {
  eq(recoveredPhrase(100), 'fully recovered');
  eq(recoveredPhrase(87), 'all 85%+ recovered');
  eq(recoveredPhrase(60), 'the lowest is 60% recovered');
  eq(recoveredPhrase(99), 'all 95%+ recovered');
  const rec = Object.fromEntries(SHOW_MUSCLES.map((m) => [m, 100]));
  const plan = { label: 'Lower', exercises: [{}], est_minutes: 40, location: { name: 'Home gym' }, deload: false };
  const a = trainAnswer({ ...build({ plan }), recovery: rec, planMuscles: ['quads', 'glutes'] }, TODAY);
  assert(a.lines.join(' | ').includes('Today works quads and glutes (fully recovered)'), a.lines.join(' | '));
});
