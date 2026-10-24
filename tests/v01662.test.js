// v0.16.62 (#190): goal date. Pure maths and the safety caps. Synthetic numbers only.
import { test, eq, assert } from './harness.js';
import { goalDatePlan, goalDateSettings, goalDateNote, recommendLine, safeFloor, weekLine } from '../js/nutrition/goaldate.js';

const TODAY = '2026-10-24';
const base = { trendKg: 90, goalKg: 80, today: TODAY, burn: 2600, ceiling: 1500, sex: 'male' };
const fmt = (d) => d;

test('settings: off unless switched on; bad dates ignored', () => {
  const j = (s) => JSON.stringify(goalDateSettings(s));
  eq(j(undefined), '{"on":false,"day":null}');
  eq(j({ goal_date_on: true, goal_date: '2027-01-01' }), '{"on":true,"day":"2027-01-01"}');
  eq(goalDateSettings({ goal_date_on: true, goal_date: 'soon' }).day, null);
  eq(goalDateSettings({ goal_date_on: 'yes' }).on, false);
});

test('the hint follows the date, and is never below the floor (male, ceiling 1,500, burn 2,300)', () => {
  const b = { ...base, burn: 2300 };
  const kcal = (d) => goalDatePlan({ ...b, goalDay: d }).kcal;
  const far = kcal('2027-10-24'), mid = kcal('2027-06-01'), near = kcal('2027-03-01');
  assert(far > mid && mid > near, `different dates, different hints: ${far} ${mid} ${near}`);
  for (const d of ['2027-10-24', '2027-06-01', '2027-03-01', '2026-12-24', '2026-11-07']) assert(kcal(d) >= 1500, `floor held for ${d}: ${kcal(d)}`);
  assert(far > 1500, 'a far date is allowed to sit above the ceiling');
});

test('when the date needs more than the ceiling, the line says the ceiling is ahead; the ceiling is never changed', () => {
  const p = goalDatePlan({ ...base, burn: 2300, goalDay: '2027-03-01' });
  eq(p.status, 'ok');
  assert(p.kcal > 1500 && p.ceiling === 1500, `${p.kcal}`);
  eq(recommendLine(p, fmt), `To hit 2027-03-01: ~${p.kcal.toLocaleString('en-US')} cal/day. Your 1,500 ceiling is already ahead of that pace.`);
  const low = goalDatePlan({ ...base, ceiling: 3000, burn: 2300, goalDay: '2027-10-24' }); // need is under the ceiling: no extra words
  assert(!/ceiling/.test(recommendLine(low, fmt)), recommendLine(low, fmt));
});

test('burn at or below the floor: no pace to suggest, a calm state, never 0.0', () => {
  for (const burn of [1500, 1400, 1520]) {
    const p = goalDatePlan({ ...base, burn, goalDay: '2027-06-01' });
    eq(p.status, 'unrealistic');
    eq(p.noRoom, true);
    eq(p.suggestedDay, null);
    assert(p.kcal >= 1500, `${p.kcal}`);
    eq(recommendLine(p, fmt), '');
  }
  assert(goalDatePlan({ ...base, burn: 2300, goalDay: '2027-06-01' }).noRoom === false);
});

test('the intake follows the pace when there is room (higher ceiling)', () => {
  const p = goalDatePlan({ ...base, ceiling: 2400, goalDay: '2027-03-06' }); // 10 kg in 133 days ≈ 0.53 kg/wk
  eq(p.status, 'ok');
  assert(p.kcal > 1500 && p.kcal <= 2400, `${p.kcal}`);
  const expected = 2600 - (10 / 133) * 7 * 7700 / 7;
  assert(Math.abs(p.kcal - expected) <= 10, `${p.kcal} vs ${expected}`);
});

test('safety: never more than 1% of body weight a week', () => {
  const p = goalDatePlan({ ...base, ceiling: 3000, goalDay: '2026-11-07' }); // 10 kg in 2 weeks
  eq(p.status, 'unrealistic');
  assert(Math.abs(p.requiredKgPerWeek) <= 0.9 + 1e-9, `${p.requiredKgPerWeek}`);
  assert(p.suggestedDay > '2026-11-07', 'suggests a later date');
  // 10 kg at 0.9 kg/week = 11.1 weeks = 78 days
  eq(p.suggestedDay, '2027-01-10');
});

test('safety: never below the floor (1,500 for men)', () => {
  const p = goalDatePlan({ ...base, ceiling: 3000, burn: 1900, goalDay: '2026-12-24' });
  assert(p.kcal >= 1500, `${p.kcal}`);
  eq(p.status, 'unrealistic');
  // the floor leaves 400 kcal/day = 0.36 kg/week, so ~28 weeks
  assert(p.suggestedDay > '2027-03-01', p.suggestedDay);
});

test('safety: a lower ceiling the user set is the floor; never suggest lower', () => {
  eq(safeFloor('male', 1400), 1400);
  eq(safeFloor('male', 1800), 1500);
  eq(safeFloor('female', 2000), 1200);
  const p = goalDatePlan({ ...base, ceiling: 1400, burn: 2400, goalDay: '2026-12-24' });
  assert(p.kcal >= 1400, `${p.kcal}`);
});

test('past or same-day dates give no calories; reached and no-weight are handled', () => {
  eq(goalDatePlan({ ...base, goalDay: TODAY }).status, 'nodate');
  eq(goalDatePlan({ ...base, goalDay: '2026-10-01' }).status, 'nodate');
  eq(recommendLine(goalDatePlan({ ...base, goalDay: TODAY }), fmt), '');
  eq(goalDatePlan({ ...base, trendKg: 80.05, goalDay: '2027-01-01' }).status, 'reached');
  eq(goalDatePlan({ ...base, trendKg: null, goalDay: '2027-01-01' }).status, 'noweight');
});

test('gaining is capped at half a percent a week and 500 kcal over', () => {
  const p = goalDatePlan({ trendKg: 70, goalKg: 75, today: TODAY, goalDay: '2026-11-24', burn: 2500, ceiling: 2800, sex: 'male' });
  eq(p.status, 'unrealistic');
  assert(p.requiredKgPerWeek <= 0.35 + 1e-9, `${p.requiredKgPerWeek}`);
  assert(p.kcal <= 3000, `${p.kcal}`);
});

test('ahead / on track / behind compare your trend pace to the date', () => {
  const need = (10 / 133) * 7; // ≈ 0.526 kg/week
  const at = (slope) => goalDatePlan({ ...base, ceiling: 2400, goalDay: '2027-03-06', actualKgPerWeek: slope }).pace;
  eq(at(-need * 1.5), 'ahead');
  eq(at(-need), 'on');
  eq(at(-need * 0.5), 'behind');
  eq(at(+0.2), 'behind');
  eq(at(null), 'unknown');
});

test('the small print and the sheet use plain words', () => {
  const p = goalDatePlan({ ...base, ceiling: 2400, goalDay: '2027-03-06' });
  assert(/^To hit 2027-03-06: ~[\d,]+ cal\/day$/.test(recommendLine(p, fmt)), recommendLine(p, fmt));
  const tight = goalDatePlan({ ...base, ceiling: 3000, goalDay: '2026-11-07' });
  assert(/^A safer date is /.test(recommendLine(tight, fmt)));
  assert(weekLine({ ...tight, weekKg: -0.4 }, 'imperial').startsWith('This week: down 0.9 lb'), weekLine({ ...tight, weekKg: -0.4 }, 'imperial'));
});

test('the week line never says 0.0 when there is no room', () => {
  const p = goalDatePlan({ ...base, burn: 1500, goalDay: '2027-06-01', weekKg: -0.1 });
  const w = weekLine(p, 'imperial');
  assert(!/0\.0/.test(w) && !/needs/.test(w), w);
  assert(weekLine({ ...p, weekKg: null }, 'imperial').startsWith('This week: keep weighing in.'));
});

test('Settings note: says what is missing or out of range', () => {
  const t = '2026-10-24';
  const n = (o, u = 'imperial') => goalDateNote({ on: true, day: '2027-03-01', weightText: '176', ...o }, t, u);
  eq(goalDateNote({ on: false, day: '', weightText: '' }, t, 'imperial'), '');
  eq(n({ day: '' }), 'Pick a date to see your plan.');
  eq(n({ day: '2026-10-24' }), 'Pick a date after today.');
  eq(n({ day: '2026-01-01' }), 'Pick a date after today.');
  eq(n({ weightText: '20' }), 'Enter a weight between 66 and 772 lb.');
  eq(n({ weightText: '900' }), 'Enter a weight between 66 and 772 lb.');
  eq(n({ weightText: '' }), 'Enter a weight between 66 and 772 lb.');
  eq(n({ weightText: '29' }, 'metric'), 'Enter a weight between 30 and 350 kg.');
  eq(n({}), '');
  eq(n({ weightText: '80' }, 'metric'), '');
});
