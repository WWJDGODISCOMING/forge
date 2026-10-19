import { test, eq, near, assert } from './harness.js';
import { todayRings, weeklySets, groupOf, WEEKLY_SET_TARGET } from '../js/workouts/rings.js';
import { EXERCISES } from '../js/workouts/exercises.js';

const byId = (id) => EXERCISES.find((e) => e.id === id);
const NOW = new Date(2026, 9, 8, 18).getTime(); // Thu 8 Oct 2026, local
const at = (d, h = 9) => new Date(2026, 9, d, h).toISOString();
const sets = (n) => Array.from({ length: n }, () => ({ done: true, warmup: false }));
const w = (day, items, status = 'done') => ({
  status, started_at: at(day), finished_at: at(day, 10),
  exercises: items.map(([id, n]) => ({ exercise_id: id, sets: [{ done: true, warmup: true }, ...sets(n)] })),
});

test('rings: patterns map to push / pull / legs; core and conditioning count for none', () => {
  eq(groupOf('horizontal_push'), 'push');
  eq(groupOf('vertical_pull'), 'pull');
  eq(groupOf('hinge'), 'legs');
  eq(groupOf('core_flexion'), null);
  eq(groupOf('conditioning'), null);
});

test('rings: weekly sets count this week only, working sets only, finished workouts only', () => {
  const ws = [
    w(5, [['bb_back_squat', 3], ['bb_bench_press', 4]]), // Mon this week
    w(7, [['pullup', 3], ['plank', 3]]),
    w(2, [['bb_deadlift', 5]]), // last week
    w(8, [['bb_back_squat', 2]], 'active'), // in progress: not yet
  ];
  const s = weeklySets(ws, byId, NOW);
  eq(JSON.stringify(s), '{"push":4,"pull":3,"legs":3}');
});

test('rings: training days vs goal, sets capped per group, recovery average', () => {
  const ws = [w(5, [['bb_back_squat', 30]]), w(6, [['bb_bench_press', 3]])];
  const [tr, st, rc] = todayRings({ workouts: ws, profile: { trainingDays: 4, experience: 'intermediate' }, exerciseById: byId, now: NOW });
  eq(tr.text, '2/4 days');
  near(tr.value, 0.5, 1e-9);
  const per = WEEKLY_SET_TARGET.intermediate;
  eq(st.done, per + 3, '30 leg sets only count up to the legs target');
  near(st.value, (per + 3) / (per * 3), 1e-9);
  assert(rc.value > 0 && rc.value < 1, 'fresh % drops after a big leg day');
  const none = todayRings({ workouts: [], profile: {}, exerciseById: byId, now: NOW });
  eq(none.map((r) => r.text).join(' | '), '0/3 days | 0/10 push · 0/10 pull · 0/10 legs | 100% fresh');
});

test('rings: calories and protein join when food is passed (US-style numbers), and cap nothing', () => {
  const food = { kcal: 1850, protein_g: 120.4, targetKcal: 2200, targetProtein: 160 };
  const r = todayRings({ workouts: [], profile: {}, exerciseById: byId, now: NOW, food });
  eq(r.map((x) => x.key).join(), 'training,sets,recovery,calories,protein');
  eq(r[3].text, '1,850 of 2,200 kcal');
  eq(r[4].text, '120 of 160 g');
  assert(!r[3].over, 'under target is not over');
  near(r[3].value, 1850 / 2200, 1e-9);
  assert(todayRings({ workouts: [], profile: {}, exerciseById: byId, now: NOW }).length === 3, 'no food: three rings as before');
  eq(todayRings({ workouts: [], profile: {}, exerciseById: byId, now: NOW, food: { ...food, kcal: 2500 } })[3].value > 1, true, 'over target reads above 1');
});

test('rings: over the calorie target is flagged, says how far over, and draws a darker second lap', async () => {
  const { ringsHtml, foodSummary, foodRingSvg } = await import('../js/ui/rings.js');
  const food = { kcal: 3380, protein_g: 123, targetKcal: 2070, targetProtein: 181 };
  const r = todayRings({ workouts: [], profile: {}, exerciseById: byId, now: NOW, food });
  eq(r[3].over, true);
  eq(r[3].text, '3,380 of 2,070\u00a0kcal');
  eq(r[3].extra, '1,310\u00a0kcal over', 'the over amount is its own legend line');
  const html = ringsHtml(r);
  assert(html.includes('data-ring="calories-over"'), 'second lap drawn');
  assert(html.includes('var(--warn-deep)') && html.includes('class="warn"'), 'warn colours');
  assert(html.includes('<small class="warn">1,310 kcal over</small>'), 'over amount sits on its own warn line');
  assert(!/<small[^>]*>\s*·/.test(html), 'no legend line starts with a dot');
  const css = (await import('node:fs')).readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert(css.includes('.ring-arc.ring-over { transition-delay: 1s; }'), 'second lap waits for the first');
  assert(css.includes('.ring-arc.ring-over { transition: none; transition-delay: 0s; }'), 'second lap is instant under reduced motion');
  const ok = ringsHtml(todayRings({ workouts: [], profile: {}, exerciseById: byId, now: NOW, food: { ...food, kcal: 1270 } }));
  assert(!ok.includes('calories-over') && ok.includes('var(--ring-kcal)') && !ok.includes('var(--warn)'), 'normal eating is not warn');
  // The Food card: same rules, and number and unit never split.
  const s = foodSummary({ kcal: 3380, protein_g: 123 }, { calories: 2070, proteinG: 181 });
  eq(s.over, true);
  eq(s.note, '1,310 kcal over');
  eq(s.protein, '123 of 181 g protein');
  assert(!/\d (kcal|g)\b/.test(s.note + s.protein), 'no plain space between a number and its unit');
  const svg = foodRingSvg({ kcal: 3380, protein_g: 123 }, { calories: 2070, proteinG: 181 }, 'x');
  assert(svg.includes('data-over') && svg.includes('var(--warn)'), 'card ring shows the over lap');
  const calm = foodRingSvg({ kcal: 1270, protein_g: 110 }, { calories: 2070, proteinG: 181 }, 'x');
  assert(!calm.includes('data-over') && !calm.includes('var(--warn)') && calm.includes('var(--ring-protein)'), 'card ring is calm under target');
});

test('rings: cardio counts as a training day', () => {
  const [tr] = todayRings({ workouts: [], cardio: [{ started_at: at(6) }], profile: { trainingDays: 3 }, exerciseById: byId, now: NOW });
  eq(tr.done, 1);
});

test('rings: a deload week lowers the weekly sets target and says so', () => {
  const r = todayRings({ workouts: [], profile: { experience: 'intermediate' }, exerciseById: byId, now: NOW, deload: true })[1];
  eq(r.per, Math.round(WEEKLY_SET_TARGET.intermediate * 0.5));
  eq(r.label, 'Sets · deload');
});

import { pillarDelay } from '../js/health/ui.js';
test('pillar cascade: 60 ms steps, trails the ring on entry, immediate when scrolled to', () => {
  eq(pillarDelay(0, true), 240); eq(pillarDelay(4, true), 480);
  eq(pillarDelay(0, false), 0); eq(pillarDelay(3, false), 180);
});
