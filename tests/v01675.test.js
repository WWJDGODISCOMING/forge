// v0.16.75 (#218): favorite meals. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq as strictEq, assert } from './harness.js';
import { totalsOf } from '../js/food/core.js';
import {
  cleanItem, itemsFromEntries, defaultName, cleanMeal, mealLine, logMealFields, sortFavorites, recentMeals, recentLabel, swapItem, removeItem, setServings, MAX_ITEMS,
} from '../js/food/saved-meals.js';
import { VERSION } from '../js/version.js';

const eq = (a, b, m) => strictEq(JSON.stringify(a), JSON.stringify(b), m);
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

let n = 0;
const log = (day, meal, name, extra = {}) => ({
  id: `l${++n}`, day, meal, name, kcal: 200, protein_g: 20, carbs_g: 10, fat_g: 5, servings: 1,
  created_at: `${day}T${String(8 + (n % 12)).padStart(2, '0')}:00:00Z`, deleted: false, ...extra,
});
const dinner = (day) => [log(day, 'dinner', 'Chicken breast', { kcal: 250, protein_g: 45 }), log(day, 'dinner', 'White rice', { servings: 1.5, kcal: 200, protein_g: 4 }), log(day, 'dinner', 'Broccoli', { kcal: 50 })];

test('items from entries: oldest first, deleted and unnamed skipped, macros and servings kept, day and meal dropped', () => {
  const e = dinner('2026-10-25');
  const items = itemsFromEntries([...e.slice().reverse(), log('2026-10-25', 'dinner', 'Gone', { deleted: true }), log('2026-10-25', 'dinner', '')]);
  eq(items.map((i) => i.name), ['Chicken breast', 'White rice', 'Broccoli']);
  eq(items[1].servings, 1.5);
  assert(!('day' in items[0]) && !('meal' in items[0]), 'no day or meal on a saved item');
  eq(items[0].protein_g, 45);
});

test('items keep brand, portion and food id, and stay inside the rules limits', () => {
  const it = cleanItem({ name: 'x'.repeat(200), kcal: 99999, protein_g: 12.34, servings: 99, brand: 'B'.repeat(80), portion: 'p'.repeat(80), food_id: 'usda:1' });
  assert(it.name.length <= 80 && it.brand.length <= 40 && it.portion.length <= 40);
  eq(it.servings, 20);
  eq(it.food_id, 'usda:1');
  eq(it.protein_g, 12.3);
  eq(cleanItem({ name: 'Egg', kcal: 70, servings: 0 }).servings >= 0.25, true);
});

test('default name: meal label and the first two foods, 40 letters at most', () => {
  eq(defaultName(itemsFromEntries(dinner('2026-10-25')), 'dinner'), 'Dinner: Chicken breast, White rice');
  eq(defaultName([{ name: 'Apple' }], 'snack'), 'Snack: Apple');
  assert(defaultName([{ name: 'A very long food name that goes on and on' }, { name: 'Another' }], 'lunch').length <= 40);
  eq(defaultName([], undefined), 'My meal');
});

test('cleanMeal: needs a name and 1 to 20 foods, trims, keeps a valid meal slot only', () => {
  const items = itemsFromEntries(dinner('2026-10-25'));
  const ok = cleanMeal({ name: '  Chicken   and rice ', items, meal: 'dinner' });
  assert(ok.ok);
  eq(ok.meal.name, 'Chicken and rice');
  eq(ok.meal.meal, 'dinner');
  eq(cleanMeal({ name: 'x', items, meal: 'brunch' }).meal.meal, undefined);
  eq(cleanMeal({ name: '', items }).error, 'Give it a name.');
  assert(cleanMeal({ name: 'x'.repeat(41), items }).error.includes('40'));
  eq(cleanMeal({ name: 'ok', items: [] }).ok, false);
  eq(cleanMeal({ name: 'ok' }).ok, false);
  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ name: `f${i}`, kcal: 1, servings: 1 }));
  eq(cleanMeal({ name: 'ok', items: many }).ok, false);
});

test('meal line and totals scale by servings', () => {
  const items = itemsFromEntries(dinner('2026-10-25'));
  eq(mealLine(items), '3 foods · 600 kcal · 71 g protein'); // kcal 250 + 1.5 × 200 + 50; protein 45 + 1.5 × 4 + 20
  eq(totalsOf(items).kcal, 600);
  eq(mealLine([items[0]]), '1 food · 250 kcal · 45 g protein');
});

test('log again: one new entry per item, into the chosen meal and day, with the saved servings', () => {
  const items = itemsFromEntries(dinner('2026-10-25'));
  const f = logMealFields(items, { meal: 'lunch', day: '2026-10-26' });
  eq(f.length, 3);
  assert(f.every((x) => x.meal === 'lunch' && x.day === '2026-10-26'));
  eq(f[1].servings, 1.5);
  eq(f[0].name, 'Chicken breast');
});

test('favorites sort: recently used first, then newest; deleted and empty ones hidden', () => {
  const it = [{ name: 'a', kcal: 1, servings: 1 }];
  const m = (id, extra) => ({ id, name: id, items: it, created_at: '2026-10-01T00:00:00Z', ...extra });
  const s = sortFavorites([m('old'), m('used', { last_used_at: '2026-10-20T00:00:00Z' }), m('new', { created_at: '2026-10-10T00:00:00Z' }), m('del', { deleted: true }), m('empty', { items: [] })]);
  eq(s.map((x) => x.id), ['used', 'new', 'old']);
});

test('recent meals: last night’s dinner first, 2+ foods only, not today, not ones already a favorite, at most 3', () => {
  const logs = [...dinner('2026-10-25'), log('2026-10-25', 'lunch', 'Salad'), ...dinner('2026-10-24'), log('2026-10-24', 'breakfast', 'Eggs'), log('2026-10-24', 'breakfast', 'Toast'), ...dinner('2026-10-26')];
  const r = recentMeals(logs, '2026-10-26');
  eq(r.map((x) => `${x.day} ${x.meal}`), ['2026-10-25 dinner', '2026-10-24 dinner', '2026-10-24 breakfast']);
  eq(r[0].daysAgo, 1);
  eq(recentLabel(r[0]), 'Last night’s dinner');
  eq(recentLabel({ meal: 'lunch', daysAgo: 1 }), 'Yesterday’s lunch');
  eq(recentLabel(r[1], 'Sat'), 'Sat dinner');
  // a favorite with the same foods hides the matching recents
  const fav = { id: 'f', name: 'Dinner', items: itemsFromEntries(dinner('2026-10-25')) };
  eq(recentMeals(logs, '2026-10-26', { favorites: [fav] }).map((x) => `${x.day} ${x.meal}`), ['2026-10-24 breakfast']);
  eq(recentMeals(logs, '2026-10-26', { limit: 1 }).length, 1);
  eq(recentMeals([], '2026-10-26'), []);
  eq(recentMeals(logs, '2026-10-26', { days: 1 }).length, 1);
});

test('swap keeps your servings; remove and servings edits do not touch the original list', () => {
  const items = itemsFromEntries(dinner('2026-10-25'));
  const next = swapItem(items, 1, { name: 'Ground beef', kcal: 300, protein_g: 26, carbs_g: 0, fat_g: 20, servings: 1, food_id: 'f9' });
  eq(next[1].name, 'Ground beef');
  eq(next[1].servings, 1.5);
  eq(next[1].food_id, 'f9');
  eq(items[1].name, 'White rice');
  eq(swapItem(items, 9, { name: 'x', kcal: 1 }), items);
  eq(swapItem(items, 0, null), items);
  eq(removeItem(items, 0).map((i) => i.name), ['White rice', 'Broccoli']);
  eq(setServings(items, 0, 2)[0].servings, 2);
  eq(items[0].servings, 1);
});

test('wiring: saved_meals is a collection, has rules, a watcher that never trips the Food error card, and the files are cached', () => {
  assert(/'saved_meals'\]/.test(read('js/db.js').split('\n').find((l) => l.startsWith('export const COLLECTIONS'))));
  assert(read('js/db.js').includes("NEWER_COLLECTIONS = ['foods', 'food_logs', 'meal_plans', 'saved_meals']"));
  const rules = read('firestore.rules');
  assert(rules.includes("col != 'saved_meals'") && rules.includes('d.items.size() <= 20'));
  assert(/allowedCollection[\s\S]*saved_meals/.test(rules));
  assert(read('js/app.js').includes("if (col === 'saved_meals') return;"), 'a favorites error must not show the "Food isn’t switched on" card');
  const sw = read('sw.js');
  assert(sw.includes('./js/food/saved-meals.js') && sw.includes('./js/screens/food-saved.js'));
});

test('UI: favorites row at the top of Log food, 44px+ targets, labels for VoiceOver, haptics, and Duo-safe styles', () => {
  const ui = read('js/screens/food-saved.js');
  const food = read('js/screens/food.js');
  assert(food.indexOf('favoritesRowHtml(choices)') < food.indexOf('class="food-search-row"'), 'row comes before search');
  assert(/data-fav="\$\{i\}" aria-label="Log /.test(ui) && /aria-label="Review or change/.test(ui));
  assert(/aria-label="Swap \$\{esc\(it\.name\)\}/.test(ui) && /aria-label="Remove /.test(ui) && /aria-label="Fewer servings of /.test(ui));
  assert(ui.includes('haptics.success()') && ui.includes('haptics.warning()') && ui.includes('haptics.select()'));
  assert(ui.includes("label: 'Undo'"), 'one-tap log can be undone');
  assert(ui.includes('tapping'), 'double-tap guard');
  const css = read('css/food.css');
  assert(/\.fav-card \.fav-edit \{[^}]*width: 44px/.test(css) && /\.fav-card \{[^}]*min-height: 64px/.test(css));
  assert(/\.fav-item-ctl \{[^}]*flex-wrap: wrap/.test(css), 'controls wrap at 320');
  assert(!/transition|animation/.test(css.slice(css.indexOf('/* Favorite meals'))), 'no motion in the new styles');
  assert(/scroll-behavior: smooth/.test(css) && css.includes('prefers-reduced-motion: no-preference'));
});

test('release: version 0.16.75 in version.js, sw.js and the CHANGELOG, QUEUE item in review', () => {
  assert(VERSION >= '0.16.75', 'version is at least 0.16.75');
  assert(read('CHANGELOG.md').includes('## 0.16.75'));
  assert(/#218[^\n]*\n- Issue: #218\n- Version: 0\.16\.75\n- Status: in-review/.test(read('QUEUE.md')));
});
