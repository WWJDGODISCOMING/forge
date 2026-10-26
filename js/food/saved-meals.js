// Favorite meals (v0.16.75): a whole meal (several items) saved once and logged again in one tap, or a recent meal
// from an earlier day logged again. Pure functions, no DOM and no Firestore (tests/v01675.test.js).
// A saved meal is one `saved_meals` doc: { name, meal?, items: [{ name, kcal, protein_g, carbs_g, fat_g, servings, brand?, portion?, food_id? }], last_used_at? }.
// Items hold the macros PER SERVING plus `servings`, like log entries, so editing My foods never rewrites a favorite.
import { LIMITS, MEALS, MEAL_LABEL, dayBefore, entriesOn, logFields, totalsOf } from './core.js';

export const MAX_ITEMS = 20;
export const MAX_NAME = 40;
export const MAX_RECENT = 3;

const byCreated = (a, b) => (a.created_at || '').localeCompare(b.created_at || '');
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** One saved item from a log entry or a picked food. Same limits as a log entry, so logging it back always passes the rules. */
export function cleanItem(x) {
  const f = logFields({ item: x || {}, servings: x && x.servings, meal: 'snack', day: '2000-01-01' });
  const { day, meal, ...item } = f; // eslint-disable-line no-unused-vars
  return { ...item, name: String(item.name || '').slice(0, LIMITS.name) };
}

/** Items for a saved meal from log entries, oldest first. Empty and unnamed entries are skipped. */
export function itemsFromEntries(entries) {
  return entries.filter((e) => e && !e.deleted && e.name).sort(byCreated).slice(0, MAX_ITEMS).map(cleanItem);
}

/** A name to start from: "Dinner: Chicken, Rice" (the first two items), at most MAX_NAME letters. */
export function defaultName(items, meal) {
  const head = items.slice(0, 2).map((i) => i.name.split(/[,(]/)[0].trim()).filter(Boolean).join(', ');
  const label = MEAL_LABEL[meal] === 'Snacks' ? 'Snack' : (MEAL_LABEL[meal] || '');
  return clip(label && head ? `${label}: ${head}` : head || label || 'My meal', MAX_NAME);
}

/** Validates a favorite from the form. Returns { ok, meal } (fields for the doc) or { ok: false, error }. */
export function cleanMeal({ name, items, meal } = {}) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return { ok: false, error: 'Give it a name.' };
  if (n.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} letters.` };
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.name).map(cleanItem);
  if (!list.length) return { ok: false, error: 'Add at least one food.' };
  if (list.length > MAX_ITEMS) return { ok: false, error: `A favorite holds up to ${MAX_ITEMS} foods.` };
  return { ok: true, meal: { name: n, items: list, ...(MEALS.includes(meal) ? { meal } : {}) } };
}

/** Totals for a list of saved items (each scaled by its servings). */
export const mealTotals = (items) => totalsOf(items);

/** "3 foods · 640 kcal · 52 g protein" */
export function mealLine(items) {
  const t = totalsOf(items);
  const n = items.length;
  return `${n} ${n === 1 ? 'food' : 'foods'} · ${t.kcal.toLocaleString('en-US')} kcal${t.protein_g ? ` · ${Math.round(t.protein_g)} g protein` : ''}`;
}

/** Fields for new food_logs records: every item, into `meal` on `day` (macros and servings copied as saved). */
export function logMealFields(items, { meal, day }) {
  return items.map((i) => logFields({ item: i, servings: i.servings, meal, day }));
}

/** Your favorites, most recently used first (never used: newest first), then by name. Deleted ones are hidden. */
export function sortFavorites(meals) {
  const used = (m) => m.last_used_at || '';
  return meals.filter((m) => m && !m.deleted && m.name && Array.isArray(m.items) && m.items.length)
    .sort((a, b) => used(b).localeCompare(used(a)) || (b.created_at || '').localeCompare(a.created_at || '') || a.name.localeCompare(b.name));
}

const sig = (items) => items.map((x) => `${x.name}|${x.servings}|${x.kcal}`).sort().join('\n'); // order does not matter
const sameItems = (a, b) => a.length === b.length && sig(a) === sig(b);

/**
 * Meals from the last few days you could log again: a day's meal with 2 or more items, newest first, at most MAX_RECENT,
 * leaving out ones that already match a favorite. `today` is YYYY-MM-DD; today's own meals are not offered.
 */
export function recentMeals(logs, today, { days = 7, favorites = [], limit = MAX_RECENT } = {}) {
  const out = [];
  let day = today;
  const have = sortFavorites(favorites).map((f) => f.items);
  for (let i = 0; i < days && out.length < limit; i++) {
    day = dayBefore(day);
    for (const meal of [...MEALS].reverse()) { // dinner first: last night's dinner is the likeliest
      const items = itemsFromEntries(entriesOn(logs, day).filter((l) => l.meal === meal));
      if (items.length < 2 || have.some((h) => sameItems(h, items))) continue;
      out.push({ day, meal, items, daysAgo: i + 1 });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** "Last night's dinner", "Yesterday's lunch", "Mon dinner". `weekday` is the short weekday for older days. */
export function recentLabel(r, weekday = '') {
  const m = MEAL_LABEL[r.meal] === 'Snacks' ? 'snacks' : MEAL_LABEL[r.meal].toLowerCase();
  if (r.daysAgo === 1) return r.meal === 'dinner' ? 'Last night’s dinner' : `Yesterday’s ${m}`;
  return `${weekday || `${r.daysAgo} days ago`} ${m}`;
}

/** Swap item `i` for `next`, keeping the servings you had. Out of range or no item → the list unchanged. */
export function swapItem(items, i, next) {
  if (!next || i < 0 || i >= items.length) return items;
  return items.map((x, k) => (k === i ? cleanItem({ ...next, servings: x.servings }) : x));
}

export const removeItem = (items, i) => items.filter((_, k) => k !== i);

/** Changes an item's servings by one stepper tap, using the food stepper's rule (js/food/core.js stepServings). */
export function setServings(items, i, servings) {
  return items.map((x, k) => (k === i ? cleanItem({ ...x, servings }) : x));
}
