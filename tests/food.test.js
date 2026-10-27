// Food logging (v0.11.0): totals, per-meal grouping, search, the 3-tap path, the Nutrition pillar and the weekly block.
// Synthetic data only.
import { test, eq, near, assert } from './harness.js';
import {
  mealForHour, totalsOf, dayTotals, groupByMeal, progress, cleanFood, logFields, quickItem, copyMealFields, dayBefore, stepServings, daysLogged, MEALS,
} from '../js/food/core.js';
import { searchLocal, recentItems, search } from '../js/food/search.js';
import { createFlow } from '../js/food/flow.js';
import { forgeScore, foodDays, piecewise, MAP, COMPONENTS, MIN_FOOD_DAYS } from '../js/health/score.js';
import { weeklyReport } from '../js/health/weekly.js';
import { reportText } from '../js/health/weektext.js';

const DAY = '2026-10-09';
let n = 0;
const log = (day, meal, extra = {}) => ({
  id: `l${++n}`, day, meal, name: 'Oats', kcal: 300, protein_g: 10, carbs_g: 50, fat_g: 5, servings: 1,
  created_at: `2026-10-0${(n % 9) + 1}T0${n % 10}:00:00Z`, deleted: false, ...extra,
});

test('totals: macros scale by servings, deleted entries are ignored, results are rounded', () => {
  const t = totalsOf([log(DAY, 'lunch', { servings: 1.5 }), log(DAY, 'lunch', { kcal: 101, protein_g: 3.33, servings: 2 }), log(DAY, 'lunch', { deleted: true })]);
  eq(t.kcal, 652); // 450 + 202
  near(t.protein_g, 21.7, 1e-9); // 15 + 6.66
  near(t.carbs_g, 175, 1e-9);
  near(t.fat_g, 17.5, 1e-9);
  eq(totalsOf([]).kcal, 0);
});

test('dayTotals only counts the asked day', () => {
  const logs = [log(DAY, 'lunch'), log('2026-10-08', 'lunch'), log(DAY, 'dinner', { kcal: 700 })];
  eq(dayTotals(logs, DAY).kcal, 1000);
  eq(dayTotals(logs, '2026-10-08').kcal, 300);
  eq(dayTotals(logs, '2026-10-01').kcal, 0);
});

test('groupByMeal: fixed meal order, empty meals kept, oldest first, per-meal totals', () => {
  const logs = [
    log(DAY, 'dinner', { name: 'Rice', kcal: 400, created_at: '2026-10-09T18:00:00Z' }),
    log(DAY, 'breakfast', { name: 'Eggs', kcal: 200, created_at: '2026-10-09T08:00:00Z' }),
    log(DAY, 'breakfast', { name: 'Toast', kcal: 100, created_at: '2026-10-09T07:00:00Z' }),
    log('2026-10-08', 'lunch'),
  ];
  const g = groupByMeal(logs, DAY);
  eq(g.map((x) => x.meal).join(), MEALS.join());
  eq(g[0].entries.map((e) => e.name).join(), 'Toast,Eggs');
  eq(g[0].totals.kcal, 300);
  eq(g[1].entries.length, 0);
  eq(g[1].totals.kcal, 0);
  eq(g[2].totals.kcal, 400);
  eq(g[3].label, 'Snacks');
});

test('meal by time of day', () => {
  eq(mealForHour(7), 'breakfast');
  eq(mealForHour(10.4), 'breakfast');
  eq(mealForHour(12), 'lunch');
  eq(mealForHour(15.5), 'snack');
  eq(mealForHour(19), 'dinner');
  eq(mealForHour(23), 'snack');
  eq(mealForHour(2), 'breakfast');
});

test('progress against a target', () => {
  eq(progress(1050, 2100).pct, 50);
  eq(progress(2300, 2100).left, -200);
  eq(progress(10, 0), null);
});

test('servings stepper: quarters up to 1, halves after, always 0.25 to 20', () => {
  eq(stepServings(1, 1), 1.5);
  eq(stepServings(1, -1), 0.75);
  eq(stepServings(0.5, -1), 0.25);
  eq(stepServings(0.25, -1), 0.25);
  eq(stepServings(0.75, 1), 1);
  eq(stepServings(1.5, -1), 1);
  eq(stepServings(20, 1), 20);
});

test('cleanFood: trims, defaults blanks to 0, and enforces the same limits as the rules', () => {
  const ok = cleanFood({ name: '  Yoghurt ', kcal: '130', protein_g: '17.04', carbs_g: '', fat_g: '4', serving: ' 1 cup ' });
  assert(ok.ok);
  eq(JSON.stringify(ok.food), JSON.stringify({ name: 'Yoghurt', kcal: 130, protein_g: 17, carbs_g: 0, fat_g: 4, serving: '1 cup' }));
  for (const bad of [{ name: '' }, { name: 'x'.repeat(81) }, { kcal: -1 }, { kcal: 5001 }, { kcal: 'abc' }, { protein_g: 501 }, { carbs_g: -1 }, { fat_g: 501 }, { serving: 'x'.repeat(41) }]) {
    assert(!cleanFood({ name: 'A', kcal: 100, ...bad }).ok, JSON.stringify(bad));
  }
  assert(cleanFood({ name: 'x'.repeat(80), kcal: 5000, protein_g: 500, carbs_g: 500, fat_g: 500, serving: 'x'.repeat(40) }).ok);
});

test('quick add: calories (and maybe protein) only', () => {
  const q = quickItem('600', '');
  eq(q.kcal, 600); eq(q.protein_g, 0); eq(q.carbs_g, 0);
  eq(quickItem('600', '35').protein_g, 35);
  eq(quickItem('', ''), null);
  eq(quickItem('0', ''), null);
  eq(quickItem('5001', ''), null);
  eq(quickItem('600', '-1'), null);
});

test('quick add: optional carbs and fat are kept and count toward the day', () => {
  const q = quickItem('600', '30', '55.55', '20');
  eq(q.carbs_g, 55.6); eq(q.fat_g, 20); eq(q.protein_g, 30);
  const blank = quickItem('600', '', '', '');
  eq(blank.carbs_g, 0); eq(blank.fat_g, 0);
  eq(quickItem('600', '', '40').carbs_g, 40);
  eq(quickItem('600', '', '', '12').fat_g, 12);
  eq(quickItem('600', '', '-1', ''), null);
  eq(quickItem('600', '', '', '501'), null);
  eq(quickItem('600', '', 'abc', ''), null);
  const f = createFlow({ foods: [], logs: [], hour: 12, day: DAY }).quick('600', '30', '50', '20');
  eq(f.carbs_g, 50); eq(f.fat_g, 20);
  const t = totalsOf([{ ...f, servings: 1 }]);
  eq(t.carbs_g, 50); eq(t.fat_g, 20);
});

test('a log entry copies the macros: editing the food later does not change history', () => {
  const food = { id: 'f1', name: 'Yoghurt', kcal: 130, protein_g: 17, carbs_g: 6, fat_g: 4, serving: '1 cup' };
  const entry = logFields({ item: { ...food, food_id: 'f1' }, servings: 2, meal: 'snack', day: DAY });
  food.kcal = 999;
  eq(entry.kcal, 130);
  eq(entry.food_id, 'f1');
  eq(dayTotals([entry], DAY).kcal, 260);
  assert(!('food_id' in logFields({ item: food, servings: 1, meal: 'snack', day: DAY })), 'quick add / no id: no food_id key');
  eq(logFields({ item: food, servings: 99, meal: 'snack', day: DAY }).servings, 20);
});

test('copy yesterday’s meal: same foods and servings on the new day, other meals untouched', () => {
  const logs = [
    log('2026-10-08', 'lunch', { name: 'Salad', servings: 1.5, created_at: '2026-10-08T12:00:00Z' }),
    log('2026-10-08', 'lunch', { name: 'Soup', created_at: '2026-10-08T12:05:00Z', food_id: 'f9' }),
    log('2026-10-08', 'dinner', { name: 'Pasta' }),
    log('2026-10-08', 'lunch', { name: 'Gone', deleted: true }),
  ];
  const c = copyMealFields(logs, '2026-10-08', DAY, 'lunch');
  eq(c.map((x) => x.name).join(), 'Salad,Soup');
  eq(c[0].servings, 1.5);
  eq(c[1].food_id, 'f9');
  assert(c.every((x) => x.day === DAY && x.meal === 'lunch'));
  eq(copyMealFields(logs, '2026-10-08', DAY, 'breakfast').length, 0);
  eq(dayBefore('2026-03-01'), '2026-02-28');
  eq(dayBefore('2027-01-01'), '2026-12-31');
});

const foods = [
  { id: 'f1', name: 'Greek yoghurt', kcal: 130, protein_g: 17, carbs_g: 6, fat_g: 4, serving: '1 cup' },
  { id: 'f2', name: 'Banana', kcal: 105, protein_g: 1, carbs_g: 27, fat_g: 0, serving: '1 medium' },
  { id: 'f3', name: 'Almonds', kcal: 160, protein_g: 6, carbs_g: 6, fat_g: 14, serving: '28 g' },
];

test('search: recent foods first, then the rest of My foods; word match; no network', async () => {
  const logs = [
    log(DAY, 'snack', { name: 'Almonds', food_id: 'f3', created_at: '2026-10-09T15:00:00Z' }),
    log(DAY, 'lunch', { name: 'Chicken wrap', created_at: '2026-10-09T12:00:00Z' }),
    log('2026-10-08', 'snack', { name: 'Almonds', food_id: 'f3', created_at: '2026-10-08T15:00:00Z' }),
  ];
  const first = searchLocal('', { foods, logs });
  eq(first.map((x) => x.name).join(), 'Almonds,Chicken wrap,Banana,Greek yoghurt');
  eq(first[0].kind, 'mine');
  eq(first[1].kind, 'recent');
  eq(searchLocal('yog', { foods, logs }).map((x) => x.name).join(), 'Greek yoghurt');
  eq(searchLocal('GREEK  cup', { foods, logs }).length, 0, 'serving text is not searched');
  eq(searchLocal('wrap', { foods, logs })[0].name, 'Chicken wrap');
  eq(searchLocal('zzz', { foods, logs }).length, 0);
  eq(recentItems(logs).length, 2, 'one per food');
  eq((await search('ban', { foods, logs })).length, 1);
  eq(searchLocal('', { foods: [{ ...foods[0], deleted: true }], logs: [] }).length, 0);
});

test('3-tap path: open the sheet, tap a recent food, tap Add. Servings 1 and the meal are already set', () => {
  const logs = [log('2026-10-08', 'lunch', { name: 'Chicken wrap', kcal: 520, protein_g: 35 })];
  const flow = createFlow({ foods, logs, hour: 12.5, day: DAY }); // tap 1: the sheet is open
  const items = flow.results();
  eq(items[0].name, 'Chicken wrap', 'your recent food is at the top without typing');
  flow.select(items[0]); // tap 2
  const fields = flow.commit(); // tap 3
  eq(flow.f.taps, 3);
  eq(fields.name, 'Chicken wrap');
  eq(fields.meal, 'lunch');
  eq(fields.servings, 1);
  eq(fields.day, DAY);
  eq(fields.kcal, 520);
  eq(createFlow({ foods, logs: [], hour: 12, day: DAY }).commit(), null, 'nothing picked, nothing logged');
});

test('3-tap path: a My food, a different meal and 2 servings take only the taps they need', () => {
  const flow = createFlow({ foods, logs: [], hour: 8, day: DAY });
  eq(flow.f.meal, 'breakfast');
  flow.search('yog');
  flow.select(flow.results()[0]);
  flow.step(1); flow.step(1);
  flow.setMeal('snack');
  const f = flow.commit();
  eq(f.servings, 2);
  eq(f.meal, 'snack');
  eq(f.food_id, 'f1');
  const q = createFlow({ foods, logs: [], hour: 19, day: DAY });
  const qf = q.quick('600', '');
  eq(qf.kcal, 600); eq(qf.meal, 'dinner'); eq(qf.name, 'Quick add'); eq(q.f.taps, 2, 'open + Add');
  eq(createFlow({ foods, logs: [], hour: 19, day: DAY }).quick('', ''), null);
});

// ---- Forge Score: Nutrition ----
const TARGETS = { calories: 2000, proteinG: 150 };
const eaten = (days, kcal, protein) => days.flatMap((d) => [{ day: d, meal: 'lunch', name: 'Meal', kcal, protein_g: protein, carbs_g: 0, fat_g: 0, servings: 1 }]);
const lastDays = (k, from = '2026-10-10') => Array.from({ length: k }, (_, i) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - i); return d.toISOString().slice(0, 10); });
const nutrition = (foodLogs, targets = TARGETS) => forgeScore({ foodLogs, targets, today: '2026-10-10' }).pillars.find((p) => p.key === 'nutrition');

test('Nutrition mappings and weights (docs/forge-score.md)', () => {
  eq(COMPONENTS.nutrition.map((c) => c[0]).join(), 'logging,calories,protein');
  eq(piecewise(MAP.logged, 7), 100); eq(piecewise(MAP.logged, 0), 0); near(piecewise(MAP.logged, 3.5), 50, 1e-9);
  eq(piecewise(MAP.kcalOff, 0), 100); eq(piecewise(MAP.kcalOff, 0.1), 100); near(piecewise(MAP.kcalOff, 0.3), 0, 1e-9); near(piecewise(MAP.kcalOff, 0.2), 50, 1e-9);
  eq(piecewise(MAP.proteinRatio, 1), 100); eq(piecewise(MAP.proteinRatio, 1.4), 100); eq(piecewise(MAP.proteinRatio, 0.5), 0); near(piecewise(MAP.proteinRatio, 0.75), 50, 1e-9);
  eq(MIN_FOOD_DAYS, 3);
});

test('Nutrition stays "not tracked yet" until 3 logged days in the last 7', () => {
  eq(nutrition([]).tracked, false);
  eq(nutrition(eaten(lastDays(2), 2000, 150)).tracked, false, '2 days');
  eq(nutrition(eaten(lastDays(3), 2000, 150)).tracked, true, '3 days');
  eq(nutrition(eaten(['2026-10-10', '2026-10-09', '2026-10-01'], 2000, 150)).tracked, false, 'old days do not count');
  assert(forgeScore({ foodLogs: eaten(lastDays(2), 2000, 150), targets: TARGETS, today: '2026-10-10' }).notTracked.includes('nutrition'));
  eq(forgeScore({ foodLogs: eaten(lastDays(5), 2000, 150), targets: TARGETS, today: '2026-10-10' }).notTracked.includes('nutrition'), false);
});

test('Nutrition scoring: on target scores high, logging every day gets full marks, deleted entries do not count', () => {
  const perfect = nutrition(eaten(lastDays(13), 2000, 160));
  const v = (k) => perfect.components.find((c) => c.key === k).value;
  eq(v('logging'), 100); eq(v('calories'), 100); eq(v('protein'), 100);
  eq(perfect.score, 100);
  const part = nutrition(eaten(lastDays(4), 2000, 160));
  eq(part.components.find((c) => c.key === 'logging').raw, '4 of 7 days logged');
  const under = nutrition(eaten(lastDays(13), 1000, 75)); // half of target
  eq(under.components.find((c) => c.key === 'calories').value, 0);
  eq(under.components.find((c) => c.key === 'protein').value, 0);
  const within = nutrition(eaten(lastDays(13), 2150, 150)); // +7.5%
  eq(within.components.find((c) => c.key === 'calories').value, 100);
  assert(/within 10%/.test(perfect.components.find((c) => c.key === 'calories').raw));
  const gone = eaten(lastDays(13), 2000, 160).map((l) => ({ ...l, deleted: true }));
  eq(nutrition(gone).tracked, false);
  // No targets (no profile yet): only the logging component.
  const noT = nutrition(eaten(lastDays(13), 2000, 160), null);
  eq(noT.components.find((c) => c.key === 'calories').value, null);
  eq(noT.components.find((c) => c.key === 'logging').value, 100);
});

test('foodDays sums servings per day and ignores zero-calorie or malformed days', () => {
  const m = foodDays([
    { day: DAY, kcal: 100, protein_g: 5, servings: 2 }, { day: DAY, kcal: 50, protein_g: 1, servings: 1 },
    { day: '2026-10-08', kcal: 0, protein_g: 5, servings: 1 }, { day: 'bad', kcal: 100, servings: 1 },
  ]);
  eq(m.size, 1);
  eq(m.get(DAY).kcal, 250);
  eq(m.get(DAY).protein_g, 11);
  eq(daysLogged([{ day: DAY, kcal: 1, servings: 1 }, { day: DAY, kcal: 1, servings: 1 }, { day: '2026-09-01', kcal: 1, servings: 1 }], '2026-10-01', '2026-10-31').size, 1);
});

// ---- Weekly report ----
test('weekly report: nutrition block averages the logged days only, and the share text mentions it', () => {
  const weekStart = '2026-10-05'; // a Monday
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
  const foodLogs = [...eaten(days.slice(0, 3), 1800, 140), ...eaten([days[3]], 2400, 100)];
  const r = weeklyReport({ weekStart, today: '2026-10-11', foodLogs, targets: TARGETS, profile: { goal: 'lose' } });
  eq(r.nutrition.daysLogged, 4);
  eq(r.nutrition.avgKcal, 1950);
  eq(r.nutrition.avgProtein, 130);
  eq(r.nutrition.targetKcal, 2000);
  eq(r.hasData, true);
  assert(reportText(r, 'metric').includes('Food 4/7 days logged · about 1,950 kcal, 130 g protein a day'));
  const none = weeklyReport({ weekStart, today: '2026-10-11', foodLogs: [], targets: TARGETS, profile: {} });
  eq(none.nutrition, null);
  eq(none.hasData, false);
  assert(!/Food/.test(reportText(none, 'metric')));
});

// v0.14.5 (rebase onto 0.14.4): the long-term views score days with scoreSamples, which came after food logging
// was built. They must see food too, or Nutrition would be missing from Long term, the coach and the doctor summary.
import { scoreSamples } from '../js/health/score.js';
import { weeklyScores } from '../js/health/longterm.js';

test('long-term scoring sees food: scoreSamples and weeklyScores carry the Nutrition pillar; no food → no pillar, no crash', () => {
  const logs = eaten(lastDays(13), 2000, 160);
  const [withFood] = scoreSamples({ foodLogs: logs, targets: TARGETS, days: ['2026-10-10'] });
  assert(withFood.pillars.nutrition != null && withFood.pillars.nutrition > 50, `nutrition pillar ${withFood.pillars.nutrition}`);
  const [none] = scoreSamples({ days: ['2026-10-10'] });
  eq(none.pillars.nutrition ?? null, null);
  const weeks = weeklyScores({ foodLogs: logs, targets: TARGETS }, '2026-10-10', 2);
  assert(weeks.every((w) => w.pillars.nutrition == null || w.pillars.nutrition > 50), 'weekly pillar values are scores');
  eq(weeklyScores({}, '2026-10-10', 2).length, 0);
});

// ---- Protein helper (v0.16.73)
import { IDEAS, remaining, shouldShow, suggest, logItem, createOneTap, MAX_IDEAS } from '../js/food/protein-helper.js';
const T = { proteinG: 150, calories: 2000 };

test('protein helper: remaining reads goals from targets, null without a protein target', () => {
  const r = remaining(T, { kcal: 1500, protein_g: 100 });
  eq([r.protein, r.kcal, r.target].join(), '50,500,150');
  eq(remaining({ calories: 2000 }, { kcal: 0, protein_g: 0 }), null);
  eq(remaining(null, {}), null);
});

test('protein helper: shows after 4 PM or with a big gap from midday; hides when met, low on calories, or not today', () => {
  const L = (protein, kcal) => ({ protein, kcal, target: 150 });
  assert(shouldShow({ isToday: true, hour: 17, left: L(30, 600) }));
  assert(shouldShow({ isToday: true, hour: 13, left: L(60, 900) }));
  assert(!shouldShow({ isToday: true, hour: 13, left: L(20, 900) }), 'small gap before 4 PM');
  assert(!shouldShow({ isToday: true, hour: 9, left: L(150, 2000) }), 'too early');
  assert(!shouldShow({ isToday: true, hour: 18, left: L(5, 600) }), 'target nearly met');
  assert(!shouldShow({ isToday: true, hour: 18, left: L(-10, 600) }), 'target met');
  assert(!shouldShow({ isToday: true, hour: 18, left: L(40, 50) }), 'calories too low');
  assert(!shouldShow({ isToday: false, hour: 18, left: L(40, 600) }));
  assert(!shouldShow({ isToday: true, hour: 18, left: null }));
});

test('protein helper: ideas fit the calories left, at most four, best protein per kcal first', () => {
  const s = suggest({ left: { protein: 60, kcal: 400, target: 150 } });
  assert(s.length >= 3 && s.length <= MAX_IDEAS);
  assert(s.every((x) => x.kcal <= 400));
  assert(s.every((x, i) => i === 0 || x.protein_g / x.kcal <= s[i - 1].protein_g / s[i - 1].kcal), 'sorted by protein per kcal');
  eq(suggest({ left: { protein: 60, kcal: 100, target: 150 } }).every((x) => x.kcal <= 100), true);
  eq(suggest({ left: { protein: 60, kcal: 60, target: 150 } }).length, 0);
  eq(suggest({ left: { protein: 60, kcal: null, target: 150 } }).length, MAX_IDEAS);
  eq(suggest({ left: null }).length, 0);
});

test('protein helper: your own foods come first and replace the built-in twin', () => {
  const items = [
    { key: 'mine:a', name: 'Greek yogurt (Fage 0%)', kcal: 90, protein_g: 18, serving: '170 g', food_id: 'a' },
    { key: 'mine:b', name: 'Oatmeal', kcal: 150, protein_g: 5, serving: '' },
  ];
  const s = suggest({ left: { protein: 60, kcal: 500, target: 150 }, items });
  eq(s[0].mine, true);
  eq(s[0].name, 'Greek yogurt (Fage 0%)');
  assert(!s.some((x) => x.id === 'yogurt'), 'built-in yogurt hidden');
  assert(!s.some((x) => x.name === 'Oatmeal'), 'low-protein food ignored');
  const it = logItem(s[0]);
  eq(it.food_id, 'a');
  eq(it.portion, '170 g');
});

test('protein helper: built-in ideas log as plain items, collagen says it is incomplete', () => {
  const idea = suggest({ left: { protein: 60, kcal: 500, target: 150 } })[0];
  const f = logFields({ item: logItem(idea), servings: 1, meal: 'snack', day: DAY });
  eq(f.protein_g, idea.protein_g);
  eq(f.portion, idea.portion);
  assert(/incomplete/i.test(IDEAS.find((i) => i.id === 'collagen').tip));
  assert(IDEAS.every((i) => i.protein_g / i.kcal >= 0.075), 'every idea is high-protein for its calories');
});

test('protein helper: every built-in idea logs its own carbs and fat, and its calories match its macros', () => {
  for (const idea of IDEAS) {
    assert(Number.isFinite(idea.carbs_g) && Number.isFinite(idea.fat_g), `${idea.id} has carbs and fat`);
    const f = logFields({ item: logItem(idea), servings: 1, meal: 'snack', day: DAY });
    eq(f.carbs_g, idea.carbs_g);
    eq(f.fat_g, idea.fat_g);
    const est = 4 * idea.protein_g + 4 * idea.carbs_g + 9 * idea.fat_g;
    assert(Math.abs(est - idea.kcal) / idea.kcal <= 0.15, `${idea.id}: ${idea.kcal} kcal vs ${est} from macros`);
  }
  const s = suggest({ left: { protein: 60, kcal: 500, target: 150 } });
  assert(s.every((x) => x.mine || (Number.isFinite(x.carbs_g) && Number.isFinite(x.fat_g))), 'suggestions carry macros through to the tap');
  eq(logItem(s[0]).fat_g, s[0].fat_g);
});

test('protein helper: one tap logs once (a quick double tap is ignored) and Undo deletes exactly that entry', () => {
  let t = 1000; const written = [], removed = [];
  const one = createOneTap({ write: (s) => { const r = { id: `r${written.length}`, name: s.name }; written.push(r); return r; }, remove: (id) => removed.push(id), now: () => t, lockMs: 1000 });
  const a = one.tap({ name: 'Eggs' });
  eq(one.tap({ name: 'Eggs' }), null);
  t += 300; eq(one.tap({ name: 'Eggs' }), null);
  eq(written.length, 1);
  a.undo();
  eq(removed.join(), 'r0');
  t += 1000;
  const b = one.tap({ name: 'Tuna' }); // later taps work again
  eq(written.length, 2);
  b.undo();
  eq(removed.join(), 'r0,r1');
});
