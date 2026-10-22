// v0.16.49: Restaurant meal builder. Synthetic data only; chain files are the repo's static JSON.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { CHAIN_IDS, validateChain, totalsFor, stepQty, picked, favoriteFood, orderSummary, orderName, findSameFood, qtyLabel } from '../js/food/restaurant.js';
import { WIDE } from '../js/ui/skeleton.js';
import { cleanFood, logFields } from '../js/food/core.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const chain = (id) => JSON.parse(read(`../data/restaurants/${id}.json`));

test('every chain file is valid: https source, retrieved date, version, numeric macros', () => {
  eq(CHAIN_IDS.length, 10);
  for (const id of CHAIN_IDS) {
    const c = chain(id);
    eq(c.id, id);
    assert(validateChain(c).length === 0, `${id}: ${validateChain(c).join(", ")}`);
  }
});

test('validateChain catches a missing source, a bad date and a non-numeric macro', () => {
  const c = chain('subway');
  assert(validateChain({ ...c, source: 'http://x' }).length > 0);
  assert(validateChain({ ...c, retrieved: 'yesterday' }).length > 0);
  assert(validateChain({ ...c, items: [{ ...c.items[0], kcal: '100' }] }).length > 0);
  assert(validateChain({ ...c, items: [{ ...c.items[0], group: 'nope' }] }).length > 0);
});

test('Chipotle burrito = 1,085 cal (issue example)', () => {
  const c = chain('chipotle');
  const sel = { tortilla: 1, pollo: 1, 'brown-rice': 1, 'pinto-beans': 1, cheese: 1, 'cilantro-lime': 1, 'tomato-salsa': 1, 'red-salsa': 1 };
  eq(totalsFor(c, sel).kcal, 1085);
  eq(picked(c, sel).length, 8);
});

test('half portions halve the numbers and add up without drift', () => {
  const c = chain('chipotle');
  eq(totalsFor(c, { 'white-rice': 0.5 }).kcal, 105);
  eq(JSON.stringify(totalsFor(c, { pollo: 0.5, 'white-rice': 0.5 })), JSON.stringify({ kcal: 195, protein_g: 18, carbs_g: 20, fat_g: 5.5 }));
  eq(totalsFor(c, { cheese: 0.5, 'sour-cream': 0.5, guac: 0.5 }).kcal, 225); // 55 + 55 + 115
  eq(totalsFor(c, { 'tomato-salsa': 0.5 }).kcal, 13); // 12.5 rounds once, at the end
});

test('one tap on each of the 8 issue items logs full portions: 1,085 cal', () => {
  const c = chain('chipotle');
  const half = new Map(c.groups.map((g) => [g.id, !!g.half]));
  const sel = {};
  for (const id of ['tortilla', 'pollo', 'brown-rice', 'pinto-beans', 'cheese', 'cilantro-lime', 'tomato-salsa', 'red-salsa']) sel[id] = stepQty(0, 1, half.get(c.items.find((i) => i.id === id).group));
  eq(totalsFor(c, sel).kcal, 1085);
});

test('stepQty: + from 0 is one full portion, then halves in half groups; − goes 1 → ½ → 0; others move by ones; capped', () => {
  eq(stepQty(0, 1, true), 1);
  eq(stepQty(1, 1, true), 1.5);
  eq(stepQty(1.5, 1, true), 2);
  eq(stepQty(0, -1, true), 0);
  eq(stepQty(1, -1, true), 0.5);
  eq(stepQty(0.5, 1, true), 1);
  eq(stepQty(0.5, -1, true), 0);
  eq(stepQty(0, 1, false), 1);
  eq(stepQty(1, 1, false), 2);
  eq(stepQty(0, -1, false), 0);
  eq(stepQty(6, 1, false), 6);
  eq(qtyLabel(0.5), 'Half');
  eq(qtyLabel(1), '');
  eq(qtyLabel(2), '2×');
});

test('unknown items and zero quantities are ignored', () => {
  const c = chain('mcdonalds');
  eq(totalsFor(c, { 'big-mac': 2, ghost: 3, fries: 0 }).kcal, 1180);
});

test('a saved order becomes a valid favorite food and a valid log entry', () => {
  const c = chain('chipotle');
  const sel = { tortilla: 1, pollo: 1 };
  const fav = favoriteFood(c, sel, '  My burrito ');
  eq(fav.name, 'My burrito');
  eq(fav.favorite, true);
  eq(fav.kcal, 500);
  const clean = cleanFood(fav);
  assert(clean.ok);
  eq(clean.food.favorite, true);
  eq(favoriteFood(c, sel, '').name, 'Chipotle order');
  const f = logFields({ item: { ...clean.food, portion: orderSummary(c, sel), brand: c.name }, servings: 1, meal: 'lunch', day: '2026-10-22' });
  eq(f.kcal, 500);
  eq(f.brand, 'Chipotle');
});

test('Restaurant entry is in Log food, falls back to Create food / photo, and files are offline-cached', () => {
  const food = read('../js/screens/food.js');
  assert(food.includes('data-restaurant'), 'entry in the Log food sheet');
  const ui = read('../js/screens/food-restaurant.js');
  assert(ui.includes('onFallback') && ui.includes('Create the food yourself or snap a photo'), 'fallback copy');
  assert(ui.includes('haptics.select') && ui.includes('haptics.success'), 'haptics');
  assert(ui.includes('settleTicks'), 'tally rolls to the new numbers');
  const sw = read('../sw.js');
  for (const id of CHAIN_IDS) assert(sw.includes(`./data/restaurants/${id}.json`), `${id} precached`);
  assert(sw.includes('./js/food/restaurant.js') && sw.includes('./js/screens/food-restaurant.js'));
});

test('order names and portion text say what was ordered', () => {
  const m = chain('mcdonalds');
  const c = chain('chipotle');
  eq(orderName(m, { 'big-mac': 1 }, ''), 'Big Mac');
  eq(favoriteFood(m, { 'big-mac': 1 }, '').name, 'Big Mac');
  eq(orderName(m, { 'big-mac': 1 }, 'Lunch usual'), 'Lunch usual');
  eq(orderName(m, { 'big-mac': 1, 'fries-m': 1 }, ''), `${m.name} order`);
  eq(orderSummary(m, { 'big-mac': 1, 'fries-m': 1 }, 200), 'Big Mac, French Fries, medium');
  eq(orderSummary(c, { pollo: 1, 'white-rice': 0.5, 'pinto-beans': 1 }, 200), 'Chicken, ½ White rice, Pinto beans');
  eq(orderSummary(c, { 'white-rice': 2, cheese: 1.5 }, 200), '2 × White rice, 1½ × Cheese');
  const long = orderSummary(c, { tortilla: 1, pollo: 1, 'white-rice': 1, 'pinto-beans': 1, cheese: 1, 'sour-cream': 1 });
  assert(long.length <= 40 && long.endsWith('…'), `trimmed: ${long}`);
});

test('saving the same order twice reuses the My foods record', () => {
  const fav = cleanFood(favoriteFood(chain('chipotle'), { pollo: 1 }, '')).food;
  const rec = { id: 'x1', ...fav };
  eq(findSameFood([], fav), null);
  eq(findSameFood([rec], fav).id, 'x1');
  eq(findSameFood([{ ...rec, deleted: true }], fav), null);
  eq(findSameFood([{ ...rec, kcal: rec.kcal + 1 }], fav), null);
  eq(findSameFood([{ ...rec, name: rec.name.toUpperCase() }], fav).id, 'x1');
});

test('pinned spot values from the chains’ guides (Wendy’s chili, Cava Crazy Feta and vinaigrette, Chipotle bowl)', () => {
  const by = (id, item) => chain(id).items.find((i) => i.id === item);
  eq(by('wendys', 'chili-s').kcal, 280);
  eq(by('wendys', 'chili-s').protein_g, 19);
  eq(by('cava', 'crazy-feta').kcal, 70);
  eq(by('cava', 'crazy-feta').fat_g, 6);
  eq(by('cava', 'greek-vin').kcal, 150);
  eq(by('cava', 'greek-vin').fat_g, 16);
  eq(by('chipotle', 'bowl').kcal, 0);
  assert(!chain('panera').items.some((i) => /veggie|turkey/.test(i.id)), 'Panera items without complete, checked numbers stay out');
});

test('the static skeleton claims the wide width for every WIDE route (skel-boot.js), and its list matches skeleton.js', () => {
  const src = read('../js/skel-boot.js');
  const list = JSON.parse(/var WIDE = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'));
  eq([...list].sort().join(), [...WIDE].sort().join());
  const html = read('../index.html');
  assert(html.indexOf('js/skel-boot.js') > html.indexOf('</main>'), 'runs right after the skeleton');
  assert(html.indexOf('js/skel-boot.js') < html.indexOf('type="module" src="js/app.js"'), 'before the app boots');
  assert(read('../sw.js').includes('./js/skel-boot.js'), 'precached');
  const run = (hash, skel) => new Function('location', 'document', src)({ hash }, { querySelector: () => skel });
  for (const route of [...WIDE, 'weight', 'history']) {
    const classes = new Set(); const attrs = {};
    run(`#/${route}`, { classList: { add: (c) => classes.add(c) }, setAttribute: (k, v) => { attrs[k] = v; } });
    eq(classes.has('skel-wide'), WIDE.has(route));
    eq('data-play' in attrs, route === 'play');
  }
  run('', null); // no skeleton on the page: nothing to do
  const seen = new Set();
  run('#/today?x=1', { classList: { add: (c) => seen.add(c) }, setAttribute: () => {} });
  assert(seen.has('skel-wide'), 'a query string after the route is ignored');
});

test('layout: the stepper column is fixed width and beats the generic list rule; the off − keeps its space by class, not [hidden]', () => {
  const css = read('../css/food.css');
  const js = read('../js/screens/food-restaurant.js');
  assert(/\.list \.rest-item > \.rest-ctl \{[^}]*width: 140px[^}]*display: grid/.test(css), 'fixed stepper column with enough specificity');
  assert(/\.rest-ctl \.icon-btn\.off \{[^}]*visibility: hidden/.test(css), 'off minus keeps its space');
  assert(!/\.hidden = /.test(js), 'no [hidden] toggling in the builder');
  assert(/prefers-reduced-motion: no-preference\) \{\s*\.rest-item\.pop/.test(css), 'pop only without Reduce Motion');
  assert(!read('../js/screens/food.js').includes('Quick add: just calories'), 'one-line Quick add label');
});
