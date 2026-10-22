// v0.16.49: Restaurant meal builder. Synthetic data only; chain files are the repo's static JSON.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { CHAIN_IDS, validateChain, totalsFor, stepQty, picked, favoriteFood, orderSummary, qtyLabel } from '../js/food/restaurant.js';
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

test('stepQty: half-capable groups move by halves, others by ones; 0 removes; capped', () => {
  eq(stepQty(0, 1, true), 0.5);
  eq(stepQty(0.5, 1, true), 1);
  eq(stepQty(1, -1, true), 0.5);
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
  eq(orderSummary(c, sel), '2 items');
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

test('layout: rows keep a fixed-width stepper column so adding items never shifts them; motion is opt-in', () => {
  const css = read('../css/food.css');
  assert(/\.rest-ctl \{[^}]*width: 140px/.test(css), 'fixed stepper column');
  assert(/\.rest-ctl \[hidden\] \{[^}]*visibility: hidden/.test(css), 'hidden minus still takes its space');
  assert(/prefers-reduced-motion: no-preference\) \{\s*\.rest-item\.pop/.test(css), 'pop only without Reduce Motion');
});
