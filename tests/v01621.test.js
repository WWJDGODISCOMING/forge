// v0.16.21: meal plans. Library data, every filter and floor, avoid matching, determinism, swaps, and a sweep over many rule sets.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { RECIPES, TAGS, SLOTS, getRecipe } from '../js/food/meal-library.js';
import {
  cleanPrefs, parseAvoid, matchesAvoid, fits, eligible, generateWeek, alternatives, withSwap, groceryList, batchPrep,
  weekStartOf, planTargets, calorieFloor, MEAL_FOOTER, FISH_CAP_OZ, CAFFEINE_CAP_MG, DIETS, slotsFor,
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
  const freeze = batchPrep(plan, { ...LHPS, cooking: 'batch' });
  assert(freeze.items.length > 0 && freeze.tips.join(' ').toLowerCase().includes('same day'));
  const normal = batchPrep(plan, { ...LHPS, leftovers: 'normal', cooking: 'both' });
  assert(!normal.tips.join(' ').toLowerCase().includes('same day'));
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
