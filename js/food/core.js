// Food logging maths. Pure functions, no DOM and no Firestore, so everything here is unit tested
// (tests/food.test.js). Log entries carry a copy of the macros PER SERVING plus `servings`, so editing a
// food in My foods never rewrites history. Limits match firestore.rules.

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };
export const LIMITS = { name: 80, serving: 40, kcal: 5000, macro: 500, servings: 20 };
export const QUICK_NAME = 'Quick add';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The meal to pre-select for a time of day (hour 0–23, fractions allowed). */
export function mealForHour(hour) {
  if (hour < 10.5) return 'breakfast';
  if (hour < 14.5) return 'lunch';
  if (hour < 17) return 'snack';
  if (hour < 21.5) return 'dinner';
  return 'snack';
}

/** Totals for entries, each scaled by its servings. */
export function totalsOf(entries) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const e of entries) {
    if (!e || e.deleted) continue;
    const s = num(e.servings) || 1;
    t.kcal += num(e.kcal) * s;
    t.protein_g += num(e.protein_g) * s;
    t.carbs_g += num(e.carbs_g) * s;
    t.fat_g += num(e.fat_g) * s;
  }
  return { kcal: Math.round(t.kcal), protein_g: r1(t.protein_g), carbs_g: r1(t.carbs_g), fat_g: r1(t.fat_g) };
}

export const entriesOn = (logs, day) => logs.filter((l) => l && !l.deleted && l.day === day);
export const dayTotals = (logs, day) => totalsOf(entriesOn(logs, day));

const byCreated = (a, b) => (a.created_at || '').localeCompare(b.created_at || '');

/** The day's entries grouped by meal, in meal order, oldest first inside a meal. Empty meals are kept. */
export function groupByMeal(logs, day) {
  const mine = entriesOn(logs, day);
  return MEALS.map((meal) => {
    const entries = mine.filter((l) => l.meal === meal).sort(byCreated);
    return { meal, label: MEAL_LABEL[meal], entries, totals: totalsOf(entries) };
  });
}

/** How much of a target you've used: { pct (can pass 100), left (negative when over) }. No target → null. */
export function progress(value, target) {
  if (!(target > 0)) return null;
  return { pct: Math.round((value / target) * 100), left: Math.round(target - value) };
}

/** Validates and cleans a "My foods" form. Returns { ok, food } or { ok: false, error }. */
export function cleanFood(f) {
  const name = String(f.name || '').trim();
  if (!name) return { ok: false, error: 'Give it a name.' };
  if (name.length > LIMITS.name) return { ok: false, error: `Keep the name under ${LIMITS.name} letters.` };
  const n = (v) => (v === '' || v == null ? 0 : Number(v));
  const kcal = n(f.kcal);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > LIMITS.kcal) return { ok: false, error: `Calories go from 0 to ${LIMITS.kcal}.` };
  const macros = {};
  for (const [k, label] of [['protein_g', 'Protein'], ['carbs_g', 'Carbs'], ['fat_g', 'Fat']]) {
    const v = n(f[k]);
    if (!Number.isFinite(v) || v < 0 || v > LIMITS.macro) return { ok: false, error: `${label} goes from 0 to ${LIMITS.macro} g.` };
    macros[k] = r1(v);
  }
  const serving = String(f.serving || '').trim();
  if (serving.length > LIMITS.serving) return { ok: false, error: `Keep the serving under ${LIMITS.serving} letters.` };
  const out = { name, kcal: Math.round(kcal), ...macros, serving };
  const barcode = String(f.barcode || '').replace(/[\s-]+/g, '');
  if (/^\d{8,14}$/.test(barcode)) out.barcode = barcode; // a scanned or typed barcode: the next scan finds this food first
  if (f.favorite === true || f.favorite === 'on' || f.favorite === 'true') out.favorite = true; // favorites sit at the top of search
  else if (f.favorite === false) out.favorite = false;
  return { ok: true, food: out };
}

/** Fields for a new food_logs record (the caller adds the standard fields with newRecord). */
export function logFields({ item, servings = 1, meal, day }) {
  const s = Math.min(LIMITS.servings, Math.max(0.25, num(servings) || 1));
  const out = {
    day, meal, name: item.name, kcal: Math.round(num(item.kcal)), protein_g: r1(num(item.protein_g)),
    carbs_g: r1(num(item.carbs_g)), fat_g: r1(num(item.fat_g)), servings: s,
  };
  if (item.food_id) out.food_id = item.food_id;
  if (item.brand) out.brand = String(item.brand).slice(0, 40);
  if (item.portion) out.portion = String(item.portion).slice(0, LIMITS.serving); // "5.3 oz (150 g)": what one serving of this entry is
  return out;
}

/** One tap on the servings stepper: quarters up to 1, halves after that, always 0.25–20. */
export function stepServings(s, dir) {
  const step = dir > 0 ? (s >= 1 ? 0.5 : 0.25) : (s > 1 ? 0.5 : 0.25);
  return Math.min(LIMITS.servings, Math.max(0.25, Math.round((s + dir * step) * 100) / 100));
}

/** "I don't know, about 600": calories and maybe protein, carbs and fat. null if there are no calories. */
export function quickItem(kcal, protein, carbs, fat) {
  const k = Number(kcal);
  if (!Number.isFinite(k) || k <= 0 || k > LIMITS.kcal) return null;
  const m = (v) => (v === '' || v == null ? 0 : Number(v));
  const [p, c, f] = [m(protein), m(carbs), m(fat)];
  if ([p, c, f].some((x) => !Number.isFinite(x) || x < 0 || x > LIMITS.macro)) return null;
  return { name: QUICK_NAME, kcal: Math.round(k), protein_g: r1(p), carbs_g: r1(c), fat_g: r1(f), serving: '' };
}

/** Entries of `meal` on `fromDay`, as fields for new records on `toDay` (macros and servings copied as logged). */
export function copyMealFields(logs, fromDay, toDay, meal) {
  return entriesOn(logs, fromDay).filter((l) => l.meal === meal).sort(byCreated)
    .map((l) => logFields({ item: l, servings: l.servings, meal, day: toDay }));
}

/** The day before `key` (YYYY-MM-DD), calendar arithmetic only. */
export function dayBefore(key) {
  if (!DAY.test(key)) return key;
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Set of days in [from, to] that have at least one entry with calories. */
export function daysLogged(logs, from, to) {
  const set = new Set();
  for (const l of logs) if (l && !l.deleted && l.day >= from && l.day <= to && num(l.kcal) * (num(l.servings) || 1) > 0) set.add(l.day);
  return set;
}
