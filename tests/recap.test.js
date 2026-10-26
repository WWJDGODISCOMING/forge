// Weekly recap (v0.16.74): when the card is due, the numbers, and the rule-based focus tip. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { weeklyReport } from '../js/health/weekly.js';
import { buildRecap, recapDue, recapWeekFor, recapText, rowText, TIPS } from '../js/health/recap.js';

const MON = '2026-10-12'; // a Monday; the recap covers 2026-10-05 .. 2026-10-11
const PREV = '2026-10-05';
const day = (n) => `2026-10-${String(n).padStart(2, '0')}`;
const workout = (d) => ({ status: 'done', started_at: `${d}T17:00:00`, prs: [], exercises: [{ exercise_id: 'x', sets: [{ done: true, weight_kg: 50, reps: 5 }] }] });
const food = (d, kcal, p) => ({ id: `${d}-${kcal}`, day: d, kcal, protein_g: p, carbs_g: 0, fat_g: 0, servings: 1, meal: 'lunch' });
const report = (extra = {}) => weeklyReport({ weekStart: PREV, today: MON, profile: { trainingDays: 3, goal: 'lose' }, targets: { calories: 2200, proteinG: 150 }, ...extra });

test('recap: due Monday to Wednesday for last week, once, and only with data', () => {
  eq(recapWeekFor(MON), PREV);
  eq(recapWeekFor('2026-10-18'), PREV); // Sunday still means the week before this one
  assert(recapDue({ today: MON, seen: null, hasData: true }));
  assert(recapDue({ today: '2026-10-14', seen: null, hasData: true }), 'Wednesday');
  assert(!recapDue({ today: '2026-10-15', seen: null, hasData: true }), 'Thursday');
  assert(!recapDue({ today: MON, seen: PREV, hasData: true }), 'already seen');
  assert(recapDue({ today: '2026-10-19', seen: PREV, hasData: true }), 'a new week is new again');
  assert(!recapDue({ today: MON, seen: null, hasData: false }), 'nothing logged: no card');
});

test('recap: rows carry workouts, protein, calories, steps and missions against goals', () => {
  const r = report({
    workouts: [workout(day(6)), workout(day(8)), workout(day(10))],
    foodLogs: [food(day(6), 2000, 140), food(day(7), 2400, 160)],
    rows: [5, 6, 7, 8].map((n) => ({ id: day(n), steps: 9000 })),
  });
  const rc = buildRecap({ report: r, stepsGoal: 8000, missions: { done: 12, total: 20 } });
  const by = Object.fromEntries(rc.rows.map((x) => [x.key, x]));
  eq(by.workouts.value, 3); eq(by.workouts.goal, 3);
  eq(by.protein.value, 150); eq(by.protein.goal, 150);
  eq(by.calories.value, 2200); eq(by.calories.ceiling, true);
  eq(by.steps.value, 9000); eq(by.steps.goal, 8000);
  eq(by.missions.value, 12);
  eq(rowText(by.steps), '9,000 of 8,000');
  eq(rowText(by.protein), '150 g · goal 150 g');
  eq(rowText(by.calories), '2,200 kcal · limit 2,200 kcal');
});

test('recap: the tip is the area furthest under its goal, and a full week gets the steady tip', () => {
  const low = buildRecap({ report: report({ workouts: [workout(day(6))], foodLogs: [food(day(6), 2000, 140)] }), stepsGoal: 8000 });
  eq(low.tip.id, 'workouts'); // 1 of 3 = 0.33, protein 0.93
  const steps = buildRecap({ report: report({ workouts: [workout(day(6)), workout(day(8)), workout(day(10))], rows: [{ id: day(6), steps: 2000 }] }), stepsGoal: 8000 });
  eq(steps.tip.id, 'steps');
  const over = buildRecap({ report: report({ workouts: [workout(day(6)), workout(day(8)), workout(day(10))], foodLogs: [food(day(6), 3300, 150)] }), stepsGoal: 8000 });
  eq(over.tip.id, 'calories'); // 2200 / 3300 = 0.67
  const good = buildRecap({ report: report({ workouts: [workout(day(6)), workout(day(8)), workout(day(10))] }) });
  eq(good.tip.id, 'steady');
});

test('recap: a week with nothing logged is quiet, kind, and has no rows', () => {
  const rc = buildRecap({ report: report() });
  eq(rc.quiet, true); eq(rc.rows.length, 0); eq(rc.tip.id, 'quiet');
  assert(!/miss|fail|bad|lazy|shame/i.test(rc.tip.text));
});

test('recap: goals come from the caller (nothing hard-coded to one person)', () => {
  const r = report({ workouts: [workout(day(6))], rows: [{ id: day(6), steps: 5000 }] });
  eq(buildRecap({ report: r, stepsGoal: 5000 }).rows.find((x) => x.key === 'steps').ratio, 1);
  eq(buildRecap({ report: r, stepsGoal: 10000 }).rows.find((x) => x.key === 'steps').ratio, 0.5);
});

test('recap: share text, tips never diagnose or shame, and the screen is wired up', () => {
  const rc = buildRecap({ report: report({ workouts: [workout(day(6))] }) });
  const t = recapText(rc, 'Oct 5 – Oct 11', '−0.4 lb');
  assert(t.includes('Weight trend −0.4 lb') && t.includes('Workouts 1 of 3') && t.endsWith('Shared from Forge'));
  for (const f of Object.values(TIPS)) assert(!/diagnos|disease|disorder|should have|failed|guilt/i.test(f({ goal: 3 })));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert(sw.includes('./js/health/recap.js') && sw.includes('./js/screens/recap.js'), 'precached');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert(app.includes('recaps:'), 'route registered');
  const ui = readFileSync(new URL('../js/screens/recap.js', import.meta.url), 'utf8');
  assert(ui.includes('haptics.select()') && ui.includes('aria-label'), 'haptics and labels');
});
