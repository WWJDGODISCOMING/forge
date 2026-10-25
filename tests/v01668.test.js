// v0.16.68 (#203): Past days, each day's missions. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { dayDetail, pastDays, firstDay, neighbours, isDayKey } from '../js/missions/day-core.js';
import { backTarget, tabOf, routeDepth } from '../js/nav.js';

const at = (day, h = 8) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const data = {
  weights: [{ id: 'w1', kg: 80.2, day: '2026-10-10', measured_at: at('2026-10-10') }],
  bodyMeasures: [{ id: 'b1', day: '2026-10-10', measured_at: at('2026-10-10'), metrics: { fat_ratio_pct: 21.34 } }],
  workouts: [{ id: 'k1', status: 'done', label: 'Upper body', started_at: at('2026-10-10', 17), duration_ms: 2700000 }],
  cardio: [],
  healthDaily: [{ id: '2026-10-10', day: '2026-10-10', steps: 9100 }, { id: '2026-10-09', day: '2026-10-09', steps: 3200 }],
  foodLogs: [
    { id: 'f1', day: '2026-10-10', kcal: 600, protein_g: 40, servings: 2 },
    { id: 'f2', day: '2026-10-10', kcal: 300, protein_g: 30 },
    { id: 'f3', day: '2026-10-09', kcal: 200, protein_g: 5, deleted: true },
  ],
};
const targets = { steps: 8000, bed: '23:00', proteinG: 120, calories: 1500 };
const opts = { targets, today: '2026-10-12' };

test('past day: real values for every mission', () => {
  const d = dayDetail('2026-10-10', data, opts);
  eq(d.weighIn.kg, 80.2);
  eq(d.weighIn.fatPct, 21.34);
  eq(d.steps, 9100);
  eq(d.calories.kcal, 1500);
  eq(d.calories.ceiling, 1500);
  eq(d.protein.g, 110);
  eq(d.training.length, 1);
  eq(d.training[0].minutes, 45);
  eq(d.isToday, false);
  eq(d.empty, false);
  const by = Object.fromEntries(d.missions.map((m) => [m.id, m.done]));
  eq(by.weigh, true); eq(by.train, true); eq(by.steps, true); eq(by.protein, false);
  eq(d.done, 3);
});

test('missing-data day: nothing logged, missions missed, no crash', () => {
  const d = dayDetail('2026-10-08', data, opts);
  assert(d.empty);
  eq(d.weighIn.kg, null);
  eq(d.steps, null);
  eq(d.calories.logged, 0);
  eq(d.training.length, 0);
  eq(d.done, 0);
});

test('a day with only steps and a deleted food log is not empty and ignores deleted rows', () => {
  const d = dayDetail('2026-10-09', data, opts);
  eq(d.steps, 3200);
  eq(d.calories.logged, 0);
  assert(!d.empty);
});

test('no food logging and no Apple Health: only weigh-in and train missions, no throw', () => {
  const d = dayDetail('2026-10-10', { weights: data.weights, workouts: [] }, opts);
  eq(d.missions.map((m) => m.id).join(), 'weigh,train');
  eq(d.done, 1);
});

test('today and future flags', () => {
  eq(dayDetail('2026-10-12', data, opts).isToday, true);
  eq(dayDetail('2026-10-13', data, opts).isFuture, true);
});

test('past days list: newest first from the first day with data to today', () => {
  const list = pastDays(data, { ...opts, startedDay: '2026-10-09' });
  eq(list[0].day, '2026-10-12');
  eq(list[list.length - 1].day, '2026-10-09');
  eq(list.length, 4);
  eq(list.find((x) => x.day === '2026-10-11').empty, true);
  eq(pastDays({}, opts).length, 0);
  eq(firstDay(data, '2026-10-01'), '2026-10-01');
});

test('prev/next stop at the first day and at today', () => {
  const n = neighbours('2026-10-12', { first: '2026-10-09', today: '2026-10-12' });
  eq(n.prev, '2026-10-11'); eq(n.next, null);
  const m = neighbours('2026-10-09', { first: '2026-10-09', today: '2026-10-12' });
  eq(m.prev, null); eq(m.next, '2026-10-10');
});

test('day keys are validated', () => {
  assert(isDayKey('2026-10-10')); assert(!isDayKey('2026-02-31')); assert(!isDayKey('nope')); assert(!isDayKey(undefined));
});

test('routes: days sits under Awards and Back works', () => {
  eq(tabOf('days'), 'score');
  eq(backTarget(['days']), '#/awards');
  eq(backTarget(['days', '2026-10-10']), '#/days');
  eq(routeDepth(['days']), 1);
});

test('wiring: route, shell, week strip links, Today link, no new Firestore writes', () => {
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  assert(src('../js/app.js').includes("days: (day)"));
  assert(src('../sw.js').includes("'./js/screens/days.js'") && src('../sw.js').includes("'./js/missions/day-core.js'"));
  assert(src('../js/missions/ui.js').includes('href="#/days/${d.day}"'));
  assert(src('../js/screens/days.js').includes('href="#/today"'));
  assert(!/patch\(|put\(/.test(src('../js/screens/days.js') + src('../js/missions/day-core.js')), 'read-only');
});
