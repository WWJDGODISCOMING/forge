// v0.16.22: the optional meal-plan AI in the app. AI is off by default and makes no calls then; a returned week is re-checked
// (shape and skip list) and a bad one is dropped whole. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { checkAiPlan, cachedAiPlan, saveAiPlan, clearAiPlan, clearAllAiPlans, requestAiPlan, AI_FAIL } from '../js/food/meal-ai.js';
import { cleanPrefs, groceryList, parseQty, addDays, MEAL_FOOTER } from '../js/food/meal-plan.js';

const WEEK = '2026-10-19';
const meal = (slot, over = {}) => ({
  slot, name: 'Herb chicken with rice', servings: 1, kcal: 600, protein_g: 40, carbs_g: 60, fat_g: 20, fish_oz: 0, caffeine_mg: 0,
  ingredients: [{ name: 'chicken breast', qty: '5 oz', section: 'protein' }, { name: 'rice', qty: '1 cup', section: 'grains' }],
  steps: ['Bake the chicken until cooked through.', 'Serve over rice.'], ...over,
});
const week = (over = {}) => ({
  weekStart: WEEK, source: 'ai', floor: 1500, kcalTarget: 2000, proteinTarget: 100, fish_oz: 0,
  days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(WEEK, i), meals: ['breakfast', 'lunch', 'dinner'].map((s) => meal(s)) })), ...over,
});
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), size: () => m.size, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; };
const prefs = cleanPrefs({ diets: ['low_histamine'], avoid: ['mushrooms'] });

test('checkAiPlan keeps a good week, with finished day totals', () => {
  const p = checkAiPlan(week(), prefs, WEEK);
  assert(p, 'good week kept');
  eq(p.days.length, 7); eq(p.days[0].kcal, 1800); eq(p.source, 'ai');
  eq(groceryList(p).flatMap((g) => g.items).some((i) => i.name === 'Chicken breast'), true, 'the grocery list reads the meal’s own ingredients');
});

test('checkAiPlan drops a whole week for a wrong shape, wrong dates, bad numbers or a skip-list hit', () => {
  const bad = [
    null, 'x', {}, week({ weekStart: '2026-10-26' }), week({ days: [] }), week({ days: week().days.slice(0, 6) }),
    week({ days: week().days.map((d, i) => ({ ...d, date: addDays(WEEK, i === 3 ? 9 : i) })) }),
    week({ days: week().days.map((d, i) => (i === 2 ? { ...d, meals: [] } : d)) }),
    week({ days: week().days.map((d, i) => (i === 2 ? { ...d, meals: [meal('brunch')] } : d)) }),
    week({ days: week().days.map((d, i) => (i === 2 ? { ...d, meals: [meal('lunch', { kcal: NaN })] } : d)) }),
    week({ days: week().days.map((d, i) => (i === 2 ? { ...d, meals: [meal('lunch', { protein_g: -4 })] } : d)) }),
    week({ days: week().days.map((d, i) => (i === 2 ? { ...d, meals: [meal('lunch', { name: '' })] } : d)) }),
    week({ days: week().days.map((d, i) => (i === 5 ? { ...d, meals: [meal('dinner', { name: 'Creamy mushroom pasta' })] } : d)) }),
    week({ days: week().days.map((d, i) => (i === 5 ? { ...d, meals: [meal('dinner', { steps: ['Stir in the mushrooms.'] })] } : d)) }),
  ];
  for (const [i, b] of bad.entries()) eq(checkAiPlan(b, prefs, WEEK), null, `case ${i}`);
  eq(checkAiPlan(week(), prefs, '2026-10-20'), null, 'not a Monday');
});

test('checkAiPlan applies the skip-list aliases (spicy, tomatoes) like the standard plan', () => {
  const p = cleanPrefs({ avoid: ['tomatoes', 'spicy'] });
  const withIng = (name) => week({ days: week().days.map((d, i) => (i === 0 ? { ...d, meals: [meal('dinner', { ingredients: [{ name, qty: '1', section: 'produce' }] })] } : d)) });
  eq(checkAiPlan(withIng('tomato sauce'), p, WEEK), null);
  eq(checkAiPlan(withIng('hot sauce'), p, WEEK), null);
  assert(checkAiPlan(withIng('zucchini'), p, WEEK));
});

test('checkAiPlan trims long text and lists instead of trusting them', () => {
  const p = checkAiPlan(week({ days: week().days.map((d, i) => (i === 0 ? { ...d, meals: [meal('dinner', { name: 'x'.repeat(200), steps: Array.from({ length: 20 }, () => 'y'.repeat(500)), ingredients: Array.from({ length: 30 }, (_, k) => ({ name: `item ${k}`, qty: '1' })) })] } : d)) }), cleanPrefs({}), WEEK);
  const m = p.days[0].meals[0];
  assert(m.name.length <= 80 && m.steps.length <= 8 && m.steps.every((s) => s.length <= 200) && m.ingredients.length <= 12);
});

test('the saved AI week comes back only while it passes the current skip list; a new skip term drops it', () => {
  const s = store();
  const p = checkAiPlan(week(), cleanPrefs({}), WEEK);
  saveAiPlan(p, cleanPrefs({}), 'u1', s);
  assert(cachedAiPlan(WEEK, cleanPrefs({}), 'u1', s), 'comes back');
  eq(cachedAiPlan(WEEK, cleanPrefs({ avoid: ['chicken'] }), 'u1', s), null);
  eq(s.size(), 0, 'and is forgotten');
  saveAiPlan(p, cleanPrefs({}), 'u1', s); clearAiPlan(WEEK, s);
  eq(cachedAiPlan(WEEK, cleanPrefs({}), 'u1', s), null, 'Use the standard plan clears it');
  s.setItem(`forge.mealai.${WEEK}`, '{not json');
  eq(cachedAiPlan(WEEK, cleanPrefs({}), 'u1', s), null, 'junk is ignored');
});

test('a saved AI week is dropped (and its key removed) when the diet chips or other preferences change', () => {
  for (const change of [{ diets: ['pregnancy_safe'] }, { diets: ['low_histamine'] }, { leftovers: 'freeze' }, { snacks: 2 }, { cooking: 'batch' }]) {
    const s = store();
    saveAiPlan(checkAiPlan(week(), cleanPrefs({}), WEEK), cleanPrefs({}), 'u1', s);
    assert(cachedAiPlan(WEEK, cleanPrefs({}), 'u1', s), 'same prefs keep it');
    eq(cachedAiPlan(WEEK, cleanPrefs(change), 'u1', s), null, JSON.stringify(change));
    eq(s.size(), 0, 'key removed');
  }
});

test('a saved AI week made under one account is not shown to another (or to nobody)', () => {
  const s = store();
  saveAiPlan(checkAiPlan(week(), cleanPrefs({}), WEEK), cleanPrefs({}), 'uidA', s);
  eq(cachedAiPlan(WEEK, cleanPrefs({}), 'uidB', s), null);
  eq(s.size(), 0, 'key removed');
  saveAiPlan(checkAiPlan(week(), cleanPrefs({}), WEEK), cleanPrefs({}), 'uidA', s);
  eq(cachedAiPlan(WEEK, cleanPrefs({}), undefined, s), null);
});

test('Sign out and Delete everything clear every saved AI week', () => {
  const s = store();
  const p = checkAiPlan(week(), cleanPrefs({}), WEEK);
  saveAiPlan(p, cleanPrefs({}), 'u1', s);
  saveAiPlan(Object.assign({}, p, { weekStart: '2026-10-12' }), cleanPrefs({}), 'u1', s);
  s.setItem('other.key', 'keep');
  clearAllAiPlans(s);
  eq(s.size(), 1, 'only the other key is left');
  const settings = readFileSync(new URL('../js/screens/settings.js', import.meta.url), 'utf8');
  const out = settings.indexOf('await signOut();');
  assert(settings.slice(out - 120, out).includes('clearAllAiPlans'), 'sign out clears them');
  const del = settings.indexOf('await clearLocalCache();');
  assert(settings.slice(del - 120, del).includes('clearAllAiPlans'), 'Delete everything clears them');
});

test('amounts with a thousands comma parse as one number', () => {
  eq(parseQty('1,000 g').n, 1000);
  eq(parseQty('1,000 g').unit, 'g');
  eq(parseQty('8,532 g').n, 8532);
  const m = meal('dinner', { ingredients: [{ name: 'potatoes', qty: '1,000 g', section: 'produce' }] });
  const rows = groceryList(week({ days: [{ date: WEEK, meals: [m, m, m, m] }] })).flatMap((g) => g.items);
  const r = rows.find((i) => /potato/i.test(i.name));
  eq(r.qty, '4000 g');
});

test('requestAiPlan sends only preferences and targets, and returns a checked plan', async () => {
  const calls = [];
  const call = async (name, data, opts) => { calls.push({ name, data, opts }); return { plan: week() }; };
  const p = await requestAiPlan({ prefs: cleanPrefs({ diets: ['vegetarian'], avoid: ['mushrooms'], swaps: { x: 'y' } }), targets: { calories: 2100, proteinG: 110 }, weekStart: WEEK, call });
  eq(p.days.length, 7);
  eq(calls.length, 1); eq(calls[0].name, 'personalizeMealPlan');
  eq(JSON.stringify(Object.keys(calls[0].data).sort()), JSON.stringify(['prefs', 'targets', 'weekStart']));
  eq(JSON.stringify(Object.keys(calls[0].data.prefs).sort()), JSON.stringify(['avoid', 'cooking', 'diets', 'leftovers', 'snacks']));
});

test('requestAiPlan: a server error keeps its calm message; an unusable or off-list reply becomes one friendly message', async () => {
  let err = null;
  try { await requestAiPlan({ prefs, targets: {}, weekStart: WEEK, call: async () => { throw new Error('That’s enough AI plans for now. Try again later, or use the standard plan.'); } }); } catch (e) { err = e; }
  eq(err.message, 'That’s enough AI plans for now. Try again later, or use the standard plan.');
  for (const reply of [{}, null, { plan: { days: [] } }, { plan: week({ days: week().days.map((d) => ({ ...d, meals: [meal('dinner', { name: 'Mushroom soup' })] })) }) }]) {
    err = null;
    try { await requestAiPlan({ prefs, targets: {}, weekStart: WEEK, call: async () => reply }); } catch (e) { err = e; }
    eq(err && err.message, AI_FAIL);
  }
});

test('AI is off by default: the Plan reads no AI week and makes no call unless Settings → Meal plan AI is on', () => {
  const plan = readFileSync(new URL('../js/screens/food-plan.js', import.meta.url), 'utf8');
  assert(plan.includes('state.settings.meal_ai === true'), 'switch is opt-in');
  assert(plan.includes('const aiPlan = aiOn ? cachedAiPlan('), 'no AI week is read while off');
  assert(plan.includes("await import('../functions.js')"), 'the functions SDK loads only on tap');
  assert(!/^import .*functions\.js/m.test(plan), 'no static import of the functions SDK');
  assert(plan.includes("${aiOn ? (aiPlan ?"), 'the row only exists when on');
  const settings = readFileSync(new URL('../js/screens/settings.js', import.meta.url), 'utf8');
  assert(settings.includes('name="mealai" ${st.meal_ai === true ?'), 'unchecked unless saved as true');
  assert(settings.includes('Sends your food preferences to xAI'), 'the switch says where the data goes');
});

test('the front end never holds a key and the AI path adds no food log fields', () => {
  for (const f of ['../js/food/meal-ai.js', '../js/screens/food-plan.js', '../js/screens/settings.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert(!/XAI_|api\.x\.ai|xai-[A-Za-z0-9]{8}/.test(src.replace(/Sends your food preferences to xAI/g, '')), `${f} mentions a key or the xAI URL`);
  }
  const plan = readFileSync(new URL('../js/screens/food-plan.js', import.meta.url), 'utf8');
  assert(plan.includes('logFields({ item: { name: meal.name, kcal: meal.kcal, protein_g: meal.protein_g, carbs_g: meal.carbs_g, fat_g: meal.fat_g, portion: plannedPortion(meal) }'), 'logging a planned meal is unchanged');
  assert(plan.includes('MEAL_FOOTER') && MEAL_FOOTER.startsWith('Not medical advice'), 'footer stays');
});

test('Swap is hidden on an AI week (its meals are not in the standard picker) and the recipe opens from the meal’s own steps', () => {
  const plan = readFileSync(new URL('../js/screens/food-plan.js', import.meta.url), 'utf8');
  assert(plan.includes('mealRow(m, d.date, !aiPlan)'));
  assert(plan.includes('const own = Array.isArray(meal.ingredients) && meal.ingredients.length'));
});

test('grocery list: an AI meal’s own amounts are not scaled twice and Unicode fractions parse', () => {
  const replaced = meal('dinner', { servings: 1.25, ingredients: [{ name: 'fresh rosemary', qty: '1¼ tsp', section: 'produce' }, { name: 'green onion', qty: '2½', section: 'produce' }, { name: 'butter', qty: '½ tbsp', section: 'pantry' }] });
  const rows = groceryList(week({ days: [{ date: WEEK, meals: [replaced] }] })).flatMap((g) => g.items);
  const row = (n) => rows.find((i) => i.name === n);
  eq(row('Fresh rosemary').qty, '1¼ tsp');
  eq(row('Green onions').qty, '3');
  eq(row('Butter').qty, '1½ tsp');
  for (const r of rows) assert((r.qty.match(/[⅛¼⅜½⅝¾⅞⅓⅔]/g) || []).length <= 1, `two fractions in ${r.qty}`);
});

test('digits-only skip terms are dropped by the app’s own cleaning too', () => {
  eq(JSON.stringify(cleanPrefs({ avoid: ['8,532', '532', 'tomatoes', '12 oz'] }).avoid), JSON.stringify(['tomatoes', '12 oz']));
});
