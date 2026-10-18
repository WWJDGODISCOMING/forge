// Meal plan AI, no network: node --test test/
// The model is a stub that returns canned JSON. Preferences and fixtures are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fakeDb } from './fake-db.js';
import { setSink } from '../src/log.js';
import {
  cleanInput, parseDays, unsafeReason, buildWeek, personalizeMealPlan, meterMealAi, deleteMealAiData, fishOunces, caffeineMg,
  MealAiError, PER_HOUR, PER_DAY, GLOBAL_PER_DAY,
} from '../src/mealai.js';
import { generateWeek, slotsFor, FISH_CAP_OZ } from '../src/meal/meal-plan.js';

const NOW = Date.parse('2026-10-18T15:00:00Z');
const WEEK = '2026-10-19';
const TARGETS = { calories: 2100, proteinG: 110 };
const LHPS = { diets: ['low_histamine', 'pregnancy_safe'], leftovers: 'freeze', cooking: 'both', snacks: 1, avoid: ['mushroom'] };

const meal = (slot, over = {}) => ({
  slot, name: 'Herb chicken with rice', kcal: 600, protein_g: 40, carbs_g: 60, fat_g: 20, fish_oz: 0, caffeine_mg: 0,
  ingredients: [{ name: 'chicken breast', qty: '5 oz', section: 'protein' }, { name: 'rice', qty: '1 cup', section: 'grains' }],
  steps: ['Bake the chicken until cooked through.', 'Serve over rice.'], ...over,
});
const goodDays = (snacks = 1, over = {}) => Array.from({ length: 7 }, () => ({
  meals: slotsFor(snacks).map((s) => meal(s, over)),
}));
const reply = (days) => JSON.stringify({ days });
const model = (content, status = 200, extra = {}) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => ({ choices: [{ message: { content }, ...extra }] }), text: async () => 'err' }; };
  f.calls = calls;
  return f;
};
const input = (prefs = LHPS) => ({ weekStart: WEEK, prefs, targets: TARGETS });
const run = (over = {}) => personalizeMealPlan({ db: over.db || fakeDb(), uid: 'u1', data: over.data || input(), apiKey: 'KEY123', fetch: over.fetch || model(reply(goodDays())), now: over.now || NOW });
const code = async (p) => { try { await p; } catch (e) { return e instanceof MealAiError ? e.code : `other:${e.message}`; } return null; };

const texts = (plan) => plan.days.flatMap((d) => d.meals).map((m) => `${m.name} ${m.ingredients.map((i) => i.name).join(' ')} ${m.steps.join(' ')}`.toLowerCase());

test('the server copies of the meal library and picker are identical to the app’s files', () => {
  const app = new URL('../../js/food/', import.meta.url);
  if (!existsSync(new URL('meal-plan.js', app))) return; // functions deployed on their own
  for (const f of ['meal-library.js', 'meal-plan.js']) {
    assert.equal(readFileSync(new URL(`../src/meal/${f}`, import.meta.url), 'utf8'), readFileSync(new URL(f, app), 'utf8'), `${f}: copy js/food/${f} to functions/src/meal/`);
  }
});

test('cleanInput: Monday week start, diets whitelist, at most 20 avoid terms of 40 characters, digits-only terms dropped', () => {
  const ok = cleanInput({ weekStart: WEEK, prefs: { diets: ['vegetarian', 'keto', 5], avoid: ['Tomatoes', '8,532', '532', 'x'.repeat(41), 'ab', 7, 'spicy'], leftovers: 'freeze', cooking: 'batch', snacks: 2 } });
  assert.deepEqual(ok.prefs.diets, ['vegetarian']);
  assert.deepEqual(ok.prefs.avoid, ['tomatoes', 'spicy']);
  assert.equal(ok.prefs.leftovers, 'freeze'); assert.equal(ok.prefs.snacks, 2);
  const many = cleanInput({ weekStart: WEEK, prefs: { avoid: Array.from({ length: 50 }, (_, i) => `food${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 2) % 26)}`) } });
  assert.ok(many.prefs.avoid.length <= 20);
  for (const bad of [null, 'x', {}, { weekStart: '2026-10-20' }, { weekStart: '2026-10-18' }, { weekStart: '2026-02-30' }, { weekStart: 'next week' }, { weekStart: 20261019 }, { weekStart: WEEK, prefs: { notes: 'y'.repeat(5000) } }]) {
    assert.throws(() => cleanInput(bad), (e) => e instanceof MealAiError && e.code === 'invalid');
  }
  const t = cleanInput({ weekStart: WEEK, targets: { calories: 'lots', proteinG: 99999 } });
  assert.equal(t.targets.calories, undefined); assert.equal(t.targets.proteinG, 400);
});

test('parseDays: strict about shape, cleans text, caps lists, and throws for garbage', () => {
  for (const bad of ['', 'sorry', '{"days": 3}', '{nope', '{"days":[]}', '{"days":[{"meals":[]}]}', 'x'.repeat(200000), null]) {
    assert.throws(() => parseDays(bad), (e) => e.code === 'garbled');
  }
  const days = parseDays('```json\n' + reply([{ meals: [meal('dinner', { name: '<b>Soup</b>\n bowl', steps: Array.from({ length: 20 }, () => 'z'.repeat(500)), ingredients: Array.from({ length: 30 }, (_, i) => ({ name: `item${i}`, qty: '1', section: 'junk' })) }), null, 5] }]) + '\n```');
  const m = days[0][0];
  assert.equal(m.name, 'Soup bowl');
  assert.equal(m.steps.length, 8); assert.ok(m.steps.every((s) => s.length <= 200));
  assert.equal(m.ingredients.length, 12); assert.ok(m.ingredients.every((i) => i.section === 'pantry'));
  assert.equal(parseDays(reply(Array.from({ length: 12 }, () => ({ meals: [meal('lunch')] })))).length, 7);
});

test('unsafeReason: every pregnancy-safe rule', () => {
  const ps = { diets: ['pregnancy_safe'], avoid: [], leftovers: 'normal' };
  const bad = [
    { name: 'Sushi rolls' }, { name: 'Raw cookie dough bites' }, { name: 'Steak', steps: ['Cook to medium rare.'] }, { name: 'Soft-boiled eggs' },
    { name: 'Eggs', steps: ['Cook until the yolk is runny.'] }, { name: 'Swordfish steak' }, { name: 'Tuna salad' }, { name: 'King mackerel plate' },
    { name: 'Chicken liver pâté on toast' }, { name: 'Brie and apple' }, { name: 'Wine braised beef' }, { name: 'Sandwich', ingredients: [{ name: 'deli turkey', qty: '2 oz' }], steps: ['Stack and serve.'] },
    { name: 'Bowl', ingredients: [{ name: 'raw milk', qty: '1 cup' }] }, { name: 'Salad', ingredients: [{ name: 'alfalfa sprouts', qty: '1 cup' }] },
    { name: 'Bagel', ingredients: [{ name: 'smoked salmon', qty: '2 oz' }], steps: ['Top the bagel.'] },
  ];
  for (const o of bad) assert.equal(unsafeReason(meal('dinner', o), ps), 'pregnancy', JSON.stringify(o));
  assert.equal(unsafeReason(meal('lunch', { name: 'Turkey wrap', ingredients: [{ name: 'deli turkey', qty: '2 oz' }], steps: ['Heat the turkey until steaming hot.'] }), ps), '');
  assert.equal(unsafeReason(meal('lunch', { name: 'Brie bake', ingredients: [{ name: 'pasteurized brie', qty: '2 oz' }, { name: 'apple', qty: '1' }] }), ps), '');
  assert.equal(unsafeReason(meal('lunch'), ps), '');
  assert.equal(unsafeReason(meal('lunch'), { diets: [], avoid: [], leftovers: 'normal' }), '');
});

test('unsafeReason: low-histamine exclusions and the leftovers rule', () => {
  const lh = { diets: ['low_histamine'], avoid: [], leftovers: 'normal' };
  for (const n of ['Tomato pasta', 'Spinach omelet', 'Eggplant bake', 'Vinegar slaw', 'Smoked salmon plate', 'Bacon and rice', 'Canned tuna melt', 'Aged cheddar toast', 'Kimchi bowl', 'Miso soup', 'Spicy chili', 'Salami plate']) {
    assert.equal(unsafeReason(meal('lunch', { name: n }), lh), 'histamine', n);
  }
  assert.equal(unsafeReason(meal('lunch', { steps: ['Cook, then keep the extras in the fridge for 3 days.'] }), { diets: [], avoid: [], leftovers: 'freeze' }), 'leftovers');
  assert.equal(unsafeReason(meal('lunch', { steps: ['Cook, then keep the extras in the fridge for 3 days.'] }), lh), 'leftovers');
  assert.equal(unsafeReason(meal('lunch', { steps: ['Make ahead and chill overnight.'] }), { diets: [], avoid: [], leftovers: 'freeze' }), 'leftovers');
  assert.equal(unsafeReason(meal('lunch', { steps: ['Cool, then freeze extra portions the same day.'] }), { diets: [], avoid: [], leftovers: 'freeze' }), '');
  assert.equal(unsafeReason(meal('lunch', { ingredients: [{ name: 'cottage cheese', qty: '1/2 cup' }] }), lh), '');
});

test('unsafeReason: other diet chips, the avoid list with its aliases, and the numbers', () => {
  assert.equal(unsafeReason(meal('lunch'), { diets: ['vegetarian'], avoid: [] }), 'vegetarian');
  assert.equal(unsafeReason(meal('lunch', { ingredients: [{ name: 'tofu', qty: '5 oz' }], steps: ['Pan-fry.'], name: 'Tofu bowl' }), { diets: ['vegetarian'], avoid: [] }), '');
  assert.equal(unsafeReason(meal('lunch', { name: 'Yogurt bowl' }), { diets: ['dairy_free'], avoid: [] }), 'dairy');
  assert.equal(unsafeReason(meal('lunch', { name: 'Oat bowl', ingredients: [{ name: 'oat milk', qty: '1 cup' }, { name: 'rice', qty: '1 cup' }], steps: ['Simmer.'] }), { diets: ['dairy_free'], avoid: [] }), '');
  assert.equal(unsafeReason(meal('lunch', { name: 'Pasta' }), { diets: ['gluten_free'], avoid: [] }), 'gluten');
  assert.equal(unsafeReason(meal('lunch', { name: 'Toast' }), { diets: [], avoid: ['gluten'] }), 'gluten');
  assert.equal(unsafeReason(meal('lunch', { name: 'Rice noodle soup', ingredients: [{ name: 'rice noodles', qty: '2 oz' }], steps: ['Simmer.'] }), { diets: ['gluten_free'], avoid: [] }), '');
  const avoid = (a, o) => unsafeReason(meal('dinner', o), { diets: [], avoid: a });
  assert.equal(avoid(['tomatoes'], { ingredients: [{ name: 'tomato sauce', qty: '1 cup' }] }), 'avoid');
  assert.equal(avoid(['spicy'], { name: 'Hot sauce chicken', ingredients: [{ name: 'hot sauce', qty: '1 tsp' }] }), 'avoid');
  assert.equal(avoid(['nightshade'], { ingredients: [{ name: 'paprika', qty: '1 tsp' }] }), 'avoid');
  assert.equal(avoid(['fish'], { name: 'Baked salmon' }), 'avoid');
  assert.equal(avoid(['mushroom'], { steps: ['Add the mushrooms.'] }), 'avoid');
  assert.equal(avoid(['tomatoes'], {}), '');
  for (const o of [{ kcal: NaN }, { kcal: 20 }, { kcal: 5000 }, { protein_g: -1 }, { carbs_g: undefined }, { kcal: 600, protein_g: 1, carbs_g: 1, fat_g: 1 }]) {
    assert.equal(unsafeReason(meal('dinner', o), { diets: [], avoid: [] }), 'numbers', JSON.stringify(o));
  }
  assert.equal(unsafeReason(meal('dinner', { steps: [] }), { diets: [], avoid: [] }), 'incomplete');
});

test('fish ounces and caffeine are read from the ingredients when the model says zero', () => {
  assert.equal(fishOunces(meal('dinner', { name: 'Salmon', ingredients: [{ name: 'salmon fillet', qty: '6 oz' }] })), 6);
  assert.equal(fishOunces(meal('dinner', { name: 'Cod', ingredients: [{ name: 'cod', qty: '170 g' }] })), 6);
  assert.equal(fishOunces(meal('dinner', { name: 'Fish stew', ingredients: [{ name: 'white fish', qty: 'some' }] })), 6);
  assert.equal(fishOunces(meal('dinner', { fish_oz: 9 })), 9);
  assert.equal(fishOunces(meal('dinner')), 0);
  assert.equal(caffeineMg(meal('snack1', { ingredients: [{ name: 'coffee', qty: '1 cup' }] })), 95);
  assert.equal(caffeineMg(meal('snack1', { ingredients: [{ name: 'herbal tea', qty: '1 cup' }] })), 0);
  assert.equal(caffeineMg(meal('snack1', { caffeine_mg: 80 })), 80);
});

test('buildWeek: a clean AI week is kept as is', () => {
  const week = buildWeek({ aiDays: parseDays(reply(goodDays())), prefs: { diets: [], avoid: [], snacks: 1 }, targets: TARGETS, weekStart: WEEK });
  assert.equal(week.replaced, 0);
  assert.equal(week.days.length, 7);
  assert.ok(week.days.every((d) => d.meals.length === 4 && d.meals.every((m) => m.name === 'Herb chicken with rice')));
});

test('buildWeek: unsafe, off-list and missing meals are replaced by rule-based picks that fit the rules', () => {
  const days = goodDays();
  days[0].meals[0] = meal('breakfast', { name: 'Tomato toast', ingredients: [{ name: 'tomato', qty: '1' }] });
  days[1].meals[1] = meal('lunch', { name: 'Sushi', ingredients: [{ name: 'raw salmon', qty: '4 oz' }], steps: ['Roll.'] });
  days[2].meals[2] = meal('dinner', { name: 'Mushroom stew', ingredients: [{ name: 'mushrooms', qty: '1 cup' }] });
  days[3].meals = days[3].meals.filter((m) => m.slot !== 'snack1');
  const week = buildWeek({ aiDays: parseDays(reply(days)), prefs: LHPS, targets: TARGETS, weekStart: WEEK });
  assert.ok(week.replaced >= 4);
  for (const t of texts(week)) { assert.ok(!/tomato|raw|mushroom|sushi/.test(t), t); }
  assert.equal(week.days[0].meals[0].id !== undefined, true, 'the replacement is a library recipe');
  assert.equal(week.days[3].meals.length, 4, 'the missing snack was filled');
});

test('buildWeek: fish stays within 12 oz a week and caffeine within 200 mg a day', () => {
  const fishy = goodDays().map((d) => ({ meals: d.meals.map((m) => (m.slot === 'dinner' ? meal('dinner', { name: 'Baked salmon', fish_oz: 6, ingredients: [{ name: 'salmon', qty: '6 oz' }], steps: ['Bake until it flakes.'] }) : m)) }));
  const w = buildWeek({ aiDays: parseDays(reply(fishy)), prefs: { diets: ['pregnancy_safe'], avoid: [], snacks: 1 }, targets: TARGETS, weekStart: WEEK });
  assert.ok(w.fish_oz <= FISH_CAP_OZ + 1e-9, `fish ${w.fish_oz}`);
  assert.equal(w.days.flatMap((d) => d.meals).filter((m) => m.fish_oz > 0).length, 2);
  const buzzy = goodDays().map((d) => ({ meals: d.meals.map((m) => (m.slot.startsWith('snack') ? meal(m.slot, { name: 'Coffee cake', kcal: 300, protein_g: 5, carbs_g: 40, fat_g: 12, caffeine_mg: 120 }) : m)) }));
  const w2 = buildWeek({ aiDays: parseDays(reply(buzzy)), prefs: { diets: ['pregnancy_safe'], avoid: [], snacks: 2 }, targets: TARGETS, weekStart: WEEK });
  for (const d of w2.days) assert.ok(d.caffeine_mg <= 200, `caffeine ${d.caffeine_mg}`);
});

test('buildWeek: the calorie floor holds (1,500, or 1,800 when pregnancy-safe); a thin day becomes the rule-based day', () => {
  const thin = goodDays().map(() => ({ meals: slotsFor(1).map((s) => meal(s, { kcal: 150, protein_g: 10, carbs_g: 15, fat_g: 5 })) }));
  for (const [diets, floor] of [[[], 1500], [['pregnancy_safe'], 1800]]) {
    const w = buildWeek({ aiDays: parseDays(reply(thin)), prefs: { diets, avoid: [], snacks: 1 }, targets: { calories: 1200, proteinG: 60 }, weekStart: WEEK });
    assert.equal(w.floor, floor);
    for (const d of w.days) assert.ok(d.kcal >= floor, `${d.date} ${d.kcal} < ${floor}`);
  }
});

test('buildWeek sweep: many rule sets and hostile output never ship an avoided or excluded item, and never a NaN', () => {
  const hostile = ['Tomato soup', 'Spicy curry', 'Salmon sushi', 'Liver pâté', 'Mushroom risotto', 'Brie toast', 'Vinegar slaw', 'Coffee smoothie', 'Wine stew', 'Deli turkey sandwich'];
  const sets = [
    { diets: ['low_histamine', 'pregnancy_safe'], avoid: ['mushroom', 'tomato'], leftovers: 'freeze' },
    { diets: ['pregnancy_safe', 'vegetarian'], avoid: ['spicy'], leftovers: 'normal' },
    { diets: ['dairy_free', 'gluten_free'], avoid: ['fish', 'nut'], leftovers: 'normal' },
    { diets: ['low_histamine'], avoid: ['old leftovers'], leftovers: 'freeze', snacks: 2 },
    { diets: [], avoid: ['tomatoes', 'spicy', 'mushrooms'], leftovers: 'normal', snacks: 0 },
  ];
  const bad = /tomato|raw salmon|sushi|liver|pâté|brie|vinegar|wine|deli/;
  sets.forEach((raw, k) => {
    const days = goodDays(raw.snacks ?? 1).map((d, i) => ({ meals: d.meals.map((m, j) => ((i + j) % 2 ? meal(m.slot, { name: hostile[(i + j + k) % hostile.length], ingredients: [{ name: hostile[(i * 3 + j) % hostile.length].toLowerCase(), qty: '3 oz' }] }) : m)) }));
    const prefs = { ...raw, cooking: 'both', snacks: raw.snacks ?? 1 };
    const w = buildWeek({ aiDays: parseDays(reply(days)), prefs, targets: TARGETS, weekStart: WEEK });
    const flat = w.days.flatMap((d) => d.meals);
    for (const m of flat) {
      for (const n of [m.kcal, m.protein_g, m.carbs_g, m.fat_g, m.fish_oz, m.caffeine_mg]) assert.ok(Number.isFinite(n), `NaN in ${m.name}`);
      assert.ok(m.name.length <= 80 && m.ingredients.length <= 12 && m.steps.length <= 8);
      if (!m.id) assert.equal(unsafeReason(m, prefs), '', `${k}: ${m.name} fails the check`); // library recipes are covered by the app’s own tests
    }
    for (const d of w.days) assert.ok(Number.isFinite(d.kcal) && d.kcal >= (prefs.diets.includes('pregnancy_safe') ? 1800 : 1500));
    assert.ok(w.fish_oz <= FISH_CAP_OZ + 1e-9);
    if (raw.diets.includes('pregnancy_safe')) for (const t of texts(w)) assert.ok(!bad.test(t) || /heated|steaming/.test(t), `${k}: ${t}`);
    if (raw.diets.includes('low_histamine')) for (const t of texts(w)) assert.ok(!/tomato|vinegar|wine|deli/.test(t), `${k}: ${t}`);
  });
});

test('personalizeMealPlan: sends the preferences (not the key in the URL), saves the plan for this user only with source ai, and logs no contents', async () => {
  const db = fakeDb();
  const lines = [];
  setSink((l) => lines.push(l));
  const fetch = model(reply(goodDays()));
  const { plan } = await run({ db, fetch });
  setSink(console.log);
  assert.equal(plan.source, 'ai');
  assert.equal(plan.days.length, 7);
  const call = fetch.calls[0];
  assert.match(call.url, /api\.x\.ai/);
  assert.equal(call.init.headers.authorization, 'Bearer KEY123');
  assert.ok(!call.url.includes('KEY123'));
  assert.ok(JSON.parse(call.init.body).messages[0].content.includes('mushroom'));
  const saved = (await db.doc(`users/u1/meal_plans/${WEEK}`).get()).data();
  assert.equal(saved.source, 'ai'); assert.equal(saved.user_id, 'u1'); assert.equal(saved.id, WEEK); assert.equal(saved.weekStart, WEEK); assert.equal(saved.deleted, false);
  assert.equal(saved.days.length, 7);
  assert.deepEqual(Object.keys(saved).sort(), ['created_at', 'days', 'deleted', 'id', 'source', 'updated_at', 'user_id', 'weekStart']);
  assert.equal((await db.doc(`users/u2/meal_plans/${WEEK}`).get()).exists, false);
  const logged = lines.join('\n');
  for (const secret of ['KEY123', 'mushroom', 'Herb chicken', 'chicken breast']) assert.ok(!logged.includes(secret), `logged ${secret}`);
});

test('personalizeMealPlan: a missing key is a friendly error and uses no quota', async () => {
  const db = fakeDb();
  assert.equal(await code(personalizeMealPlan({ db, uid: 'u1', data: input(), apiKey: '', fetch: model(reply(goodDays())), now: NOW })), 'nokey');
  assert.equal((await db.doc('users/u1/private/meal_ai').get()).exists, false);
});

test('personalizeMealPlan: bad input is rejected before anything is counted or sent', async () => {
  const db = fakeDb();
  const fetch = model(reply(goodDays()));
  assert.equal(await code(run({ db, fetch, data: { weekStart: '2026-10-21', prefs: {} } })), 'invalid');
  assert.equal(fetch.calls.length, 0);
  assert.equal((await db.doc('users/u1/private/meal_ai').get()).exists, false);
});

test('rate limit: 2 an hour and 5 a day per user, and a daily cap for everyone', async () => {
  assert.equal(PER_HOUR, 2); assert.equal(PER_DAY, 5);
  const db = fakeDb();
  assert.equal((await meterMealAi({ db, uid: 'u1', now: NOW })).limited, false);
  assert.equal((await meterMealAi({ db, uid: 'u1', now: NOW + 1000 })).limited, false);
  assert.equal((await meterMealAi({ db, uid: 'u1', now: NOW + 2000 })).limited, true);
  assert.equal((await meterMealAi({ db, uid: 'u2', now: NOW })).limited, false, 'another user is not affected');
  // a new hour frees two more
  const later = NOW + 3601000;
  assert.equal((await meterMealAi({ db, uid: 'u1', now: later })).limited, false);
  assert.equal((await meterMealAi({ db, uid: 'u1', now: later + 1000 })).limited, false);
  assert.equal((await meterMealAi({ db, uid: 'u1', now: later + 2000 })).limited, true);
});

test('rate limit: five a day per user, however the hours fall', async () => {
  const db = fakeDb();
  let ok = 0;
  for (let h = 0; h < 8; h++) for (let k = 0; k < 2; k++) if (!(await meterMealAi({ db, uid: 'u1', now: NOW + h * 3601000 + k })).limited) ok++; // 15:00 to 22:00 UTC, one day
  assert.equal(ok, PER_DAY);
  assert.ok(ok <= PER_DAY, `allowed ${ok}`);
});

test('rate limit: the global daily cap returns resource-exhausted through the job', async () => {
  const db = fakeDb();
  await db.doc('meal_ai_daily/2026-10-18').set({ n: GLOBAL_PER_DAY });
  const fetch = model(reply(goodDays()));
  assert.equal(await code(run({ db, fetch })), 'limited');
  assert.equal(fetch.calls.length, 0);
  await db.doc('users/u1/private/meal_ai').set({ hour_start: NOW - 60000, hour_n: 2, day: '2026-10-18', day_n: 2 });
  await db.doc('meal_ai_daily/2026-10-18').set({ n: 1 });
  assert.equal(await code(run({ db, fetch })), 'limited');
});

test('personalizeMealPlan: model errors, timeouts, garbled, oversized and cut-off replies are calm errors and nothing is saved', async () => {
  const cases = [
    [model('', 500), 'down'], [model('', 429), 'busy'],
    [async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, 'busy'],
    [async () => { throw Object.assign(new Error('n'), { name: 'TypeError' }); }, 'down'],
    [model('I cannot do that'), 'garbled'], [model('{"days": "x"}'), 'garbled'], [model('x'.repeat(130000)), 'garbled'],
    [model(reply(goodDays()), 200, { finish_reason: 'length' }), 'garbled'],
  ];
  for (const [fetch, expect] of cases) {
    const db = fakeDb();
    assert.equal(await code(run({ db, fetch })), expect);
    assert.equal((await db.doc(`users/u1/meal_plans/${WEEK}`).get()).exists, false);
  }
});

test('personalizeMealPlan: unsafe AI output is replaced before it is returned or saved', async () => {
  const days = goodDays().map((d, i) => ({ meals: d.meals.map((m) => (m.slot === 'dinner' ? meal('dinner', { name: i % 2 ? 'Swordfish steak' : 'Tomato mushroom pasta', ingredients: [{ name: i % 2 ? 'swordfish' : 'tomatoes', qty: '6 oz' }] }) : m)) }));
  const db = fakeDb();
  const { plan } = await run({ db, fetch: model(reply(days)) });
  const saved = (await db.doc(`users/u1/meal_plans/${WEEK}`).get()).data();
  for (const t of [...texts(plan), ...texts(saved)]) assert.ok(!/swordfish|tomato|mushroom/.test(t), t);
  assert.equal(plan.days.length, 7);
  assert.ok(plan.days.every((d) => d.meals.some((m) => m.slot === 'dinner')));
});

test('a fresh rule-based week and the AI week have the same shape the app reads', async () => {
  const base = generateWeek({ prefs: LHPS, targets: TARGETS, weekStart: WEEK });
  const { plan } = await run();
  for (const k of ['weekStart', 'floor', 'kcalTarget', 'proteinTarget', 'days', 'fish_oz', 'gaps']) assert.ok(k in plan && k in base, k);
  for (const k of ['slot', 'name', 'servings', 'kcal', 'protein_g', 'carbs_g', 'fat_g']) assert.ok(k in plan.days[0].meals[0], k);
});

test('Delete everything: the meal AI counter is removed once its day has passed', async () => {
  const db = fakeDb();
  await meterMealAi({ db, uid: 'u1', now: NOW });
  await deleteMealAiData({ db, uid: 'u1', now: NOW + 60000 });
  assert.equal((await db.doc('users/u1/private/meal_ai').get()).exists, true, 'kept while the day is open');
  await deleteMealAiData({ db, uid: 'u1', now: NOW + 86400000 });
  assert.equal((await db.doc('users/u1/private/meal_ai').get()).exists, false);
});
