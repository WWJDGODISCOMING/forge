// v0.16.21: meal plans. Library data, every filter and floor, avoid matching, determinism, swaps, and a sweep over many rule sets.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { RECIPES, TAGS, SLOTS, getRecipe } from '../js/food/meal-library.js';
import {
  cleanPrefs, parseAvoid, matchesAvoid, fits, eligible, generateWeek, alternatives, withSwap, groceryList, batchPrep,
  weekStartOf, planTargets, calorieFloor, MEAL_FOOTER, FISH_CAP_OZ, CAFFEINE_CAP_MG, DIETS, slotsFor,
  planWeekFor, scaleQty, fmtAmount, servingsText, plannedPortion, plannedLogDay, isPlannedLogged,
} from '../js/food/meal-plan.js';

const eqj = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m);
const WEEK = '2026-10-19';
const TARGETS = { calories: 2100, proteinG: 110 };
const LHPS = { diets: ['low_histamine', 'pregnancy_safe'], leftovers: 'freeze', cooking: 'both', snacks: 1, avoid: [] };
const words = (rec) => `${rec.name} ${rec.ingredients.map((i) => i.name).join(' ')}`.toLowerCase();
const LH_BAD = ['tomato', 'spinach', 'eggplant', 'vinegar', 'bacon', 'ham ', 'salami', 'prosciutto', 'smoked', 'cured', 'canned', 'tuna', 'sardine', 'anchov', 'pickle', 'sauerkraut', 'kimchi', 'soy sauce', 'miso', 'aged', 'parmesan', 'cheddar', 'gouda', 'wine', 'ketchup', 'mustard', 'chili', 'curry', 'hot sauce', 'chorizo', 'deli', 'capers', 'sourdough'];
const PS_BAD = ['raw', 'liver', 'deli', 'smoked', 'swordfish', 'shark', 'mackerel', 'tilefish', 'marlin', 'canned tuna', 'sushi', 'runny', 'pate', 'unpasteurized', 'salami', 'chorizo'];

test('meal library: about 30+ recipes, valid tags, sections, numbers, and steps', () => {
  assert(RECIPES.length >= 30, `only ${RECIPES.length} recipes`);
  const ids = new Set();
  for (const x of RECIPES) {
    assert(!ids.has(x.id), `duplicate id ${x.id}`); ids.add(x.id);
    assert(SLOTS.includes(x.slot), `${x.id} slot`);
    assert(x.kcal > 0 && x.protein_g >= 0 && Number.isFinite(x.kcal + x.protein_g), `${x.id} numbers`);
    for (const t of x.tags) assert(TAGS.includes(t), `${x.id} tag ${t}`);
    assert(x.ingredients.length && x.ingredients.every((i) => i.name && i.qty && i.section), `${x.id} ingredients`);
    assert(x.steps.length >= 1, `${x.id} steps`);
  }
});

test('meal library: low-histamine recipes contain none of the excluded foods and are fresh-cooked', () => {
  for (const x of RECIPES.filter((y) => y.tags.includes('low_histamine'))) {
    for (const bad of LH_BAD) assert(!` ${words(x)} `.includes(bad), `${x.id} has ${bad}`);
    assert(!x.fridge, `${x.id} needs fridge leftovers`);
    assert(!x.tags.includes('contains_tomato') && !x.tags.includes('spicy'), `${x.id} tomato or spicy`);
  }
});

test('meal library: pregnancy-safe recipes avoid the excluded foods, and fish and caffeine are labeled', () => {
  for (const x of RECIPES.filter((y) => y.tags.includes('pregnancy_safe'))) {
    for (const bad of PS_BAD) assert(!new RegExp(`\\b${bad}`).test(words(x)), `${x.id} has ${bad}`);
    assert(!x.steps.join(' ').toLowerCase().includes('runny'), `${x.id} runny`);
  }
  for (const x of RECIPES) if (/salmon|cod|tuna|swordfish/.test(words(x))) assert(x.fish_oz > 0, `${x.id} needs fish_oz`);
});

test('meal library: enough low-histamine + pregnancy-safe recipes for a week with 2 swaps per slot', () => {
  for (const slot of SLOTS) {
    const n = eligible(LHPS, slot).length;
    assert(n >= 5, `${slot}: only ${n}`);
  }
  const plan = generateWeek({ prefs: { ...LHPS, snacks: 2 }, targets: TARGETS, weekStart: WEEK });
  eq(plan.gaps.length, 0);
  for (let d = 0; d < 7; d++) for (const m of plan.days[d].meals) eq(alternatives({ prefs: { ...LHPS, snacks: 2 }, targets: TARGETS, weekStart: WEEK, dayIdx: d, slot: m.slot }).length, 2, `${d} ${m.slot}`);
});

test('cleanPrefs: safe defaults and clean-up', () => {
  const p = cleanPrefs(null);
  eqj(p.diets, []); eq(p.leftovers, 'normal'); eq(p.cooking, 'both'); eq(p.snacks, 1); eqj(p.avoid, []);
  const q = cleanPrefs({ diets: ['vegetarian', 'nope', 'vegetarian'], avoid: ['  Tomatoes ', 'x', 'tomatoes', 5], cooking: 'x', snacks: 9, leftovers: 'freeze' });
  eqj(q.diets, ['vegetarian']); eqj(q.avoid, ['tomatoes', '5'].filter((a) => a.length >= 3)); eq(q.cooking, 'both'); eq(q.snacks, 1); eq(q.leftovers, 'freeze');
  eqj(parseAvoid('Tomatoes, spicy; mushrooms\nok').sort(), ['mushrooms', 'spicy', 'tomatoes']);
  assert(cleanPrefs({ avoid: Array.from({ length: 50 }, (_, i) => `food${i}`) }).avoid.length <= 20);
});

test('diet chips filter by tag', () => {
  for (const [key] of DIETS) for (const x of RECIPES.filter((y) => fits(y, { diets: [key] }))) assert(x.tags.includes(key), `${x.id} ${key}`);
  assert(!fits(getRecipe('b-yogurt-parfait'), { diets: ['dairy_free'] }));
  assert(!fits(getRecipe('l-pasta-red'), { diets: ['gluten_free'] }));
  assert(!fits(getRecipe('d-liver'), { diets: ['vegetarian'] }));
  assert(fits(getRecipe('d-veg-stew'), { diets: ['vegetarian', 'dairy_free', 'gluten_free', 'low_histamine', 'pregnancy_safe'] }));
});

test('leftovers rule: freeze-right-away excludes dishes that need fridge leftovers', () => {
  const fr = getRecipe('l-cold-chickpea');
  assert(fits(fr, { leftovers: 'normal' }));
  assert(!fits(fr, { leftovers: 'freeze' }));
  assert(!fits(getRecipe('b-yogurt-parfait'), { leftovers: 'freeze' }));
});

test('avoid matching: tags, ingredient names, plurals, and aliases; ignores too-short terms', () => {
  const pasta = getRecipe('l-pasta-red');
  assert(matchesAvoid(pasta, ['tomatoes']), 'plural of an ingredient');
  assert(matchesAvoid(pasta, ['tomato']));
  assert(matchesAvoid(getRecipe('d-curry'), ['spicy']), 'tag');
  assert(matchesAvoid(getRecipe('b-tomato-toast'), ['contains tomato']), 'tag with underscore');
  assert(matchesAvoid(getRecipe('b-yogurt-parfait'), ['dairy']), 'dairy alias');
  assert(matchesAvoid(getRecipe('l-pasta-red'), ['gluten']), 'gluten alias');
  assert(matchesAvoid(getRecipe('d-chicken-veg'), ['Chicken']), 'case');
  assert(matchesAvoid(getRecipe('b-oat-apple'), ['berries']) === false);
  assert(matchesAvoid(getRecipe('b-quinoa-blue'), ['berries']), 'berries matches blueberries');
  assert(!matchesAvoid(getRecipe('b-oat-apple'), ['ab']), 'too short');
  assert(!fits(getRecipe('b-oat-apple'), { avoid: ['apple'] }));
});

test('pregnancy-safe: the unsafe recipes never show up, even with no other rules', () => {
  const unsafe = ['d-liver', 'd-swordfish', 'd-sushi', 'l-deli-turkey', 'l-tuna-sandwich', 'b-smoked-bagel', 'b-softegg', 's-salami'];
  for (const id of unsafe) assert(!fits(getRecipe(id), { diets: ['pregnancy_safe'] }), id);
  for (const slot of SLOTS) for (const x of eligible({ diets: ['pregnancy_safe'] }, slot)) assert(!unsafe.includes(x.id));
});

test('calorie floors: 1,500, or 1,800 with pregnancy-safe, whatever the goal says', () => {
  eq(calorieFloor({}), 1500); eq(calorieFloor({ diets: ['pregnancy_safe'] }), 1800);
  eq(planTargets({}, { calories: 1200, proteinG: 90 }).kcal, 1500);
  eq(planTargets({ diets: ['pregnancy_safe'] }, { calories: 1500, proteinG: 90 }).kcal, 1800);
  eq(planTargets({}, null).kcal, 2000);
  for (const diets of [[], ['pregnancy_safe']]) for (const calories of [900, 1200, 1500, 1700, 2200, NaN, -5, undefined]) for (const snacks of [0, 1, 2]) {
    const plan = generateWeek({ prefs: { diets, snacks }, targets: { calories, proteinG: 80 }, weekStart: WEEK });
    for (const d of plan.days) assert(d.kcal >= calorieFloor({ diets }), `${diets} ${calories} ${snacks}: ${d.date} ${d.kcal}`);
  }
});

test('plan fits the targets as estimates, within a reasonable band', () => {
  const plan = generateWeek({ prefs: LHPS, targets: TARGETS, weekStart: WEEK });
  eq(plan.days.length, 7);
  for (const d of plan.days) { assert(d.kcal > 1700 && d.kcal < 2500, `${d.date} ${d.kcal}`); assert(d.protein_g > 60, `${d.date} protein`); }
  eq(plan.days[0].date, WEEK); eq(plan.days[6].date, '2026-10-25');
});

test('fish is capped at 12 oz a week and caffeine at 200 mg a day when pregnancy-safe', () => {
  assert(FISH_CAP_OZ === 12 && CAFFEINE_CAP_MG.pregnancy === 200);
  for (const w of ['2026-10-19', '2026-11-02', '2027-01-04']) {
    const plan = generateWeek({ prefs: { diets: ['pregnancy_safe'], snacks: 2 }, targets: TARGETS, weekStart: w });
    assert(plan.fish_oz <= 12, `${w} fish ${plan.fish_oz}`);
    for (const d of plan.days) assert(d.caffeine_mg <= 200, `${w} caffeine ${d.caffeine_mg}`);
  }
  // force many fish and caffeine swaps: the caps still hold
  let prefs = { diets: ['pregnancy_safe'], snacks: 2 };
  for (let d = 0; d < 7; d++) { prefs = withSwap(prefs, WEEK, d, 'dinner', 'd-salmon-rice'); prefs = withSwap(prefs, WEEK, d, 'snack1', 's-coffee-shake'); prefs = withSwap(prefs, WEEK, d, 'snack2', 's-matcha-latte'); }
  const plan = generateWeek({ prefs, targets: TARGETS, weekStart: WEEK });
  assert(plan.fish_oz <= 12); for (const d of plan.days) assert(d.caffeine_mg <= 200, `${d.caffeine_mg}`);
});

test('determinism: same inputs, same week; a different week or prefs changes it', () => {
  const a = generateWeek({ prefs: LHPS, targets: TARGETS, weekStart: WEEK });
  const b = generateWeek({ prefs: JSON.parse(JSON.stringify(LHPS)), targets: { ...TARGETS }, weekStart: '2026-10-21' }); // any day of the week
  eq(JSON.stringify(a), JSON.stringify(b));
  const c = generateWeek({ prefs: LHPS, targets: TARGETS, weekStart: '2026-10-26' });
  assert(JSON.stringify(a.days.map((d) => d.meals.map((m) => m.id))) !== JSON.stringify(c.days.map((d) => d.meals.map((m) => m.id))));
  eq(weekStartOf('2026-10-25'), '2026-10-19'); eq(weekStartOf('2026-10-19'), '2026-10-19'); eq(weekStartOf('2026-10-26'), '2026-10-26');
});

test('swaps: two alternatives that fit the same rules; applying one replaces the meal and persists by week and slot', () => {
  const prefs = { ...LHPS, avoid: ['tomato', 'spicy'] };
  const alts = alternatives({ prefs, targets: TARGETS, weekStart: WEEK, dayIdx: 2, slot: 'dinner' });
  eq(alts.length, 2);
  const base = generateWeek({ prefs, targets: TARGETS, weekStart: WEEK });
  const cur = base.days[2].meals.find((m) => m.slot === 'dinner');
  for (const a of alts) { assert(a.id !== cur.id); assert(fits(getRecipe(a.id), prefs)); eq(getRecipe(a.id).slot, 'dinner'); }
  const next = withSwap(prefs, WEEK, 2, 'dinner', alts[0].id);
  eq(next.swaps[`${WEEK}:2:dinner`], alts[0].id);
  const plan = generateWeek({ prefs: next, targets: TARGETS, weekStart: WEEK });
  eq(plan.days[2].meals.find((m) => m.slot === 'dinner').id, alts[0].id);
  const other = generateWeek({ prefs: next, targets: TARGETS, weekStart: '2026-10-26' }); // the swap belongs to that week only
  eq(other.days[2].meals.find((m) => m.slot === 'dinner').id === alts[0].id, generateWeek({ prefs, targets: TARGETS, weekStart: '2026-10-26' }).days[2].meals.find((m) => m.slot === 'dinner').id === alts[0].id);
  eqj(withSwap(next, WEEK, 2, 'dinner', null).swaps, {});
  // a stale swap that no longer fits the rules is ignored
  const stale = generateWeek({ prefs: { ...next, avoid: [...prefs.avoid, getRecipe(alts[0].id).ingredients[0].name] }, targets: TARGETS, weekStart: WEEK });
  assert(stale.days[2].meals.find((m) => m.slot === 'dinner').id !== alts[0].id);
});

test('sweep: no plan ever holds an avoided or excluded item, and there is never a NaN', () => {
  const AVOIDS = [[], ['tomato'], ['spicy', 'tomatoes'], ['chicken', 'salmon', 'egg'], ['dairy'], ['rice']];
  const DIET_SETS = [[], ['low_histamine'], ['pregnancy_safe'], ['vegetarian'], ['dairy_free'], ['gluten_free'], ['low_histamine', 'pregnancy_safe'], ['low_histamine', 'pregnancy_safe', 'vegetarian', 'dairy_free', 'gluten_free']];
  let plans = 0;
  for (const diets of DIET_SETS) for (const avoid of AVOIDS) for (const leftovers of ['freeze', 'normal']) for (const cooking of ['scratch', 'batch', 'both']) for (const snacks of [0, 1, 2]) {
    const prefs = { diets, avoid, leftovers, cooking, snacks };
    const plan = generateWeek({ prefs, targets: { calories: 1900, proteinG: 95 }, weekStart: WEEK });
    plans++;
    eq(plan.days.length, 7);
    const clean = cleanPrefs(prefs);
    for (const d of plan.days) {
      for (const n of [d.kcal, d.protein_g, d.caffeine_mg]) assert(Number.isFinite(n), 'NaN in day');
      for (const m of d.meals) {
        const rec = getRecipe(m.id);
        for (const n of [m.kcal, m.protein_g, m.servings, m.fish_oz, m.caffeine_mg]) assert(Number.isFinite(n), `NaN in ${m.id}`);
        for (const dt of diets) assert(rec.tags.includes(dt), `${m.id} breaks ${dt}`);
        for (const a of clean.avoid) { if (['chicken', 'salmon', 'egg', 'rice', 'tomato'].includes(a)) assert(!words(rec).includes(a), `${m.id} has avoided ${a}`); if (a === 'spicy') assert(!rec.tags.includes('spicy')); if (a === 'dairy') assert(rec.tags.includes('dairy_free')); }
        assert(!matchesAvoid(rec, clean.avoid), `${m.id} matches avoid`);
        if (leftovers === 'freeze') assert(!rec.fridge, `${m.id} fridge leftovers`);
        if (diets.includes('low_histamine')) for (const bad of LH_BAD) assert(!` ${words(rec)} `.includes(bad), `${m.id} ${bad}`);
        if (diets.includes('pregnancy_safe')) for (const bad of PS_BAD) assert(!new RegExp(`\\b${bad}`).test(words(rec)), `${m.id} ${bad}`);
      }
      assert(d.kcal >= calorieFloor(clean) || d.meals.length === 0 || plan.gaps.length > 0, `${d.date} under floor ${d.kcal}`);
    }
    if (diets.includes('pregnancy_safe')) { assert(plan.fish_oz <= 12); for (const d of plan.days) assert(d.caffeine_mg <= 200); }
    const list = groceryList(plan);
    for (const g of list) for (const i of g.items) assert(i.name && i.uses > 0, 'grocery row');
  }
  assert(plans > 800);
});

test('grocery list groups by store section, merges repeats; batch prep follows cooking style and leftovers rule', () => {
  const plan = generateWeek({ prefs: LHPS, targets: TARGETS, weekStart: WEEK });
  const list = groceryList(plan);
  assert(list.length >= 3);
  const names = list.flatMap((g) => g.items.map((i) => `${g.section}|${i.name}`));
  eq(new Set(names).size, names.length);
  assert(list.some((g) => g.items.some((i) => i.uses > 1)));
  eq(batchPrep(plan, { ...LHPS, cooking: 'scratch' }), null);
  const freeze = batchPrep(generateWeek({ prefs: { ...LHPS, cooking: 'batch' }, targets: TARGETS, weekStart: WEEK }), { ...LHPS, cooking: 'batch' });
  assert(freeze.items.length > 0 && freeze.tips.join(' ').toLowerCase().includes('same day'));
  const lowHist = batchPrep(plan, { ...LHPS, leftovers: 'normal', cooking: 'both' });
  assert(lowHist.tips.join(' ').toLowerCase().includes('same day'), 'low-histamine always freezes the same day');
  const plain = generateWeek({ prefs: { diets: ['pregnancy_safe'], cooking: 'batch' }, targets: TARGETS, weekStart: WEEK });
  const normal = batchPrep(plain, { diets: ['pregnancy_safe'], leftovers: 'normal', cooking: 'both' });
  assert(!normal.tips.join(' ').toLowerCase().includes('same day'));
  for (const i of freeze.items) assert(i.portions >= 2 && i.meal && i.meal.id === i.id, 'prep lists only repeated meals, each tappable');
});

test('macros: every recipe and every planned meal has finite carbs and fat, and kcal is about 4P + 4C + 9F', () => {
  for (const x of RECIPES) {
    assert(Number.isFinite(x.carbs_g) && Number.isFinite(x.fat_g) && x.carbs_g >= 0 && x.fat_g > 0, `${x.id} macros`);
    assert(Math.abs(4 * x.protein_g + 4 * x.carbs_g + 9 * x.fat_g - x.kcal) / x.kcal < 0.15, `${x.id} kcal`);
  }
  const plan = generateWeek({ prefs: LHPS, targets: TARGETS, weekStart: WEEK });
  for (const d of plan.days) for (const m of d.meals) {
    assert(Number.isFinite(m.carbs_g) && Number.isFinite(m.fat_g) && m.carbs_g > 0 || m.id === 's-egg-hard' || m.id === 's-salami', `${m.id} carbs`);
    assert(Math.abs(4 * m.protein_g + 4 * m.carbs_g + 9 * m.fat_g - m.kcal) / m.kcal < 0.15, `${m.id} x${m.servings} kcal`);
  }
});

test('foods to skip: how people really type it', () => {
  const out = (t) => RECIPES.filter((x) => matchesAvoid(x, parseAvoid(t))).map((x) => x.id);
  for (const t of ['spicy foods', 'Spicy food']) for (const id of ['d-curry', 'b-spicy-eggs', 'l-spicy-chili']) assert(out(t).includes(id), `${t} ${id}`);
  for (const id of ['l-pasta-red', 'd-spag-bolognese', 'b-tomato-toast', 'l-spicy-chili']) assert(out('Tomato products').includes(id), id);
  for (const t of ['fish', 'seafood']) for (const id of ['l-salmon-potato', 'd-cod-quinoa', 'l-tuna-sandwich']) assert(out(t).includes(id), `${t} ${id}`);
  assert(out('nuts').includes('s-trail-mix'));
  for (const id of ['l-chicken-rice', 'd-beef-stew', 'l-turkey-quinoa', 'b-spicy-eggs', 's-salami']) assert(out('meat').includes(id), `meat ${id}`);
  for (const id of ['b-spicy-eggs', 's-salami']) assert(out('pork').includes(id), `pork ${id}`);
  for (const t of ['nightshades', 'peppers']) for (const id of ['l-pasta-red', 'd-chicken-veg', 'l-spicy-chili']) assert(out(t).includes(id), `${t} ${id}`);
  assert(!out('nightshades').includes('b-scramble-sweet') && !out('nightshades').includes('l-turkey-quinoa'), 'sweet potato is not a nightshade');
  assert(!out('nuts').includes('b-rice-pear'), 'coconut is not a nut here');
  eqj(parseAvoid('<b>Tomatoes</b>, null, !!!'), ['tomatoes', 'null']);
});

test('"old leftovers" in the skip list turns on Freeze right away', () => {
  eq(cleanPrefs({ avoid: ['old leftovers'] }).leftovers, 'freeze');
  eq(cleanPrefs({ avoid: ['tomatoes'] }).leftovers, 'normal');
  assert(!fits(getRecipe('b-yogurt-parfait'), { avoid: ['Old leftovers'] }));
});

test('meal_prefs sanitizing: swap keys, recipe ids, weeks and the cap; avoid terms are plain strings', () => {
  const today = '2026-10-21';
  const swaps = { '2026-10-19:0:dinner': 'd-salmon-rice', '2026-10-26:6:snack2': 's-apple-seed', '2026-10-19:0:dinnerx': 'd-salmon-rice', '2026-10-19:7:dinner': 'd-salmon-rice',
    '2026-10-19:1:lunch': 'nope', '2026-10-19:2:lunch': 'x'.repeat(100000), '2026-10-05:0:dinner': 'd-salmon-rice', '2026-11-30:0:dinner': 'd-salmon-rice', '2026-10-20:0:dinner': 'd-salmon-rice' };
  const p = cleanPrefs({ swaps, avoid: [{}, null, 5, '<b>tomatoes</b>', ['x']] }, { today });
  eqj(Object.keys(p.swaps).sort(), ['2026-10-19:0:dinner', '2026-10-26:6:snack2']);
  eqj(p.avoid, ['tomatoes']);
  const many = {};
  for (let w = 0; w < 60; w++) many[`${weekStartOf(`2026-${String(1 + (w % 9)).padStart(2, '0')}-01`)}:${w % 7}:lunch`] = 'l-beef-rice';
  assert(Object.keys(cleanPrefs({ swaps: many }).swaps).length <= 40);
  let prefs = {};
  for (let i = 0; i < 80; i++) prefs = withSwap(prefs, addWeeks(WEEK, i), i % 7, 'dinner', 'd-salmon-rice');
  assert(Object.keys(prefs.swaps).length <= 40, 'withSwap caps');
  assert(prefs.swaps[`${addWeeks(WEEK, 79)}:${79 % 7}:dinner`], 'the newest swap stays');
});
const addWeeks = (w, n) => { const d = new Date(`${w}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); };

test('amounts: scaled to the servings, summed in the grocery list, rice as rice, no water', () => {
  eq(scaleQty('1/2 cup', 1.25), '⅝ cup'); eq(scaleQty('1 small', 1.25), '1¼ small'); eq(scaleQty('2', 1.5), '3'); eq(scaleQty('to taste', 2), 'to taste');
  eq(servingsText(1.25), '1¼ servings'); eq(servingsText(1), '1 serving'); eq(fmtAmount(0.5), '½');
  const plan = { days: [{ meals: [{ id: 'l-chicken-rice', servings: 1.5 }, { id: 'd-salmon-rice', servings: 1 }, { id: 'b-oat-apple', servings: 1 }, { id: 'b-oat-apple', servings: 1.5 }] }] };
  const rows = groceryList(plan).flatMap((g) => g.items);
  const row = (n) => rows.find((r) => r.name === n);
  eq(row('rice').qty, 'about 2½ cups cooked'); assert(!row('cooked rice'));
  assert(!row('water'), 'water is not shopping');
  eq(row('apple').qty, '2½');
  eq(row('olive oil').qty, '2½ tbsp');
  eq(row('fresh salmon fillet').qty, '4 oz');
  const mixed = groceryList({ days: [{ meals: [{ id: 'l-chicken-rice', servings: 1 }, { id: 'b-turkey-patty', servings: 1 }] }] }).flatMap((g) => g.items);
  eq(mixed.find((r) => r.name === 'olive oil').qty, 'for 2 meals');
});

test('log this: a planned meal already in the log is recognised, so a second tap does nothing', () => {
  const meal = { slot: 'snack1', name: 'Mango coconut bowl', servings: 1.25 };
  const log = { day: '2026-10-21', meal: 'snack', name: 'Mango coconut bowl', portion: plannedPortion(meal), deleted: false };
  assert(isPlannedLogged([log], meal, '2026-10-21'));
  assert(!isPlannedLogged([log], meal, '2026-10-20'));
  assert(!isPlannedLogged([{ ...log, deleted: true }], meal, '2026-10-21'));
  assert(!isPlannedLogged([{ ...log, portion: '1 serving' }], meal, '2026-10-21'));
  eq(plannedLogDay('2026-10-25', '2026-10-21'), '2026-10-21'); eq(plannedLogDay('2026-10-20', '2026-10-21'), '2026-10-20');
});

test('the Plan shows next week on Sunday and Monday-to-Sunday weeks otherwise', () => {
  eq(planWeekFor('2026-10-18'), '2026-10-19'); // Sunday
  eq(planWeekFor('2026-10-19'), '2026-10-19'); // Monday
  eq(planWeekFor('2026-10-24'), '2026-10-19'); // Saturday
});

test('recipe copy: no lemon in a low-histamine plan, gluten-free only where it is true, fish notes, no stew in low-histamine', () => {
  assert(!RECIPES.some((x) => /lemon/i.test(x.name)));
  for (const id of ['d-sushi', 'b-yogurt-parfait']) assert(!getRecipe(id).tags.includes('gluten_free'), id);
  for (const id of ['b-oat-apple', 's-oat-bites']) assert(getRecipe(id).ingredients[0].qty.includes('certified gluten-free'), id);
  assert(!getRecipe('d-beef-stew').tags.includes('low_histamine'));
  for (const id of ['l-salmon-potato', 'd-salmon-rice', 'd-cod-quinoa']) assert(getRecipe(id).steps.join(' ').includes('fresh or frozen'), id);
  assert(!getRecipe('b-scramble-sweet').steps.join(' ').includes('until firm.') || !getRecipe('b-scramble-sweet').steps.join(' ').includes('set, until'));
});

test('copy: the footer is exact, no health claims in the library or the module', () => {
  eq(MEAL_FOOTER, 'Not medical advice. Check with your doctor, OB, or a registered dietitian.');
  const src = readFileSync(new URL('../js/food/meal-plan.js', import.meta.url), 'utf8') + readFileSync(new URL('../js/food/meal-library.js', import.meta.url), 'utf8');
  for (const claim of ['heals', 'cures', 'detox', 'anti-inflammatory', 'treats ', 'gut health']) assert(!src.toLowerCase().includes(claim), claim);
  eq(slotsFor(2).length, 5); eq(slotsFor(0).length, 3);
});

test('part 1 does not touch Cloud Functions, rules or config, and has no network calls', () => {
  for (const f of ['meal-plan.js', 'meal-library.js']) {
    const src = readFileSync(new URL(`../js/food/${f}`, import.meta.url), 'utf8');
    assert(!/fetch\(|XMLHttpRequest|XAI_API_KEY|import\(/.test(src), f);
  }
});

test('Log this: guards double taps, records carbs and fat, shows Logged once the entry exists; setup card and Sunday label', () => {
  const src = readFileSync(new URL('../js/screens/food-plan.js', import.meta.url), 'utf8');
  assert(src.includes('isPlannedLogged(state.food_logs, meal, day)) return false'), 'second tap must be a no-op');
  assert(src.includes('carbs_g: meal.carbs_g') && src.includes('fat_g: meal.fat_g'), 'carbs and fat passed to logFields');
  assert(src.includes('Logged <span'), 'logged state label');
  assert(src.includes('data-setup') && src.includes('Set up your meal plan'), 'first-run setup card');
  assert(src.includes('planWeekFor(todayKey())') && src.includes("'Next week'"), 'Sunday shows next week');
});
