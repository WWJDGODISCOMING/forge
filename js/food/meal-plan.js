// Meal plans (v0.16.21): a pure, rule-based week picker over the built-in recipe library. No DOM, no network, no randomness:
// the same prefs, targets and week start always give the same week. All numbers are estimates.
// Not medical advice: the screen carries MEAL_FOOTER on every plan, and nothing here makes a health claim.
import { RECIPES, SECTIONS, getRecipe } from './meal-library.js';

export const MEAL_FOOTER = 'Not medical advice. Check with your doctor, OB, or a registered dietitian.';
export const DIETS = [
  ['low_histamine', 'Low-histamine'], ['pregnancy_safe', 'Pregnancy-safe'], ['vegetarian', 'Vegetarian'], ['dairy_free', 'Dairy-free'], ['gluten_free', 'Gluten-free'],
];
export const LEFTOVERS = { freeze: 'Freeze right away, no fridge leftovers', normal: 'Normal' };
export const COOKING = { scratch: 'From scratch', batch: 'Batch prep', both: 'Both' };
export const FLOOR_KCAL = 1500;
export const FLOOR_KCAL_PREGNANCY = 1800;
export const FISH_CAP_OZ = 12; // cooked fish per week
export const CAFFEINE_CAP_MG = { pregnancy: 200, normal: 400 };
export const MAX_AVOID = 20;
export const DEFAULT_KCAL = 2000;
export const DEFAULT_PROTEIN = 100;

const MIN_SCALE = 0.75;
const MAX_SCALE = 2;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Share of the day's calories for each slot, by number of snacks. */
const SPLIT = {
  0: { breakfast: 0.28, lunch: 0.34, dinner: 0.38 },
  1: { breakfast: 0.25, lunch: 0.3, dinner: 0.33, snack1: 0.12 },
  2: { breakfast: 0.23, lunch: 0.28, dinner: 0.31, snack1: 0.09, snack2: 0.09 },
};
export const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack1: 'Snack', snack2: 'Snack' };
export const slotsFor = (snacks) => Object.keys(SPLIT[snacks] || SPLIT[0]);
const recipeSlot = (slot) => (slot.startsWith('snack') ? 'snack' : slot);

const r1 = (x) => Math.round(x * 10) / 10;
const finite = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Clean whatever is stored on profile.meal_prefs into a safe, complete shape. */
export function cleanPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const known = new Set(DIETS.map((d) => d[0]));
  const diets = [...new Set(Array.isArray(p.diets) ? p.diets.filter((d) => known.has(d)) : [])];
  const avoid = [];
  for (const a of Array.isArray(p.avoid) ? p.avoid : []) {
    const t = String(a).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 30);
    if (t.length >= 3 && !avoid.includes(t) && avoid.length < MAX_AVOID) avoid.push(t);
  }
  const swaps = {};
  if (p.swaps && typeof p.swaps === 'object') for (const [k, v] of Object.entries(p.swaps)) if (typeof v === 'string' && k.length < 40) swaps[k] = v;
  return {
    diets, avoid, swaps,
    leftovers: p.leftovers === 'freeze' ? 'freeze' : 'normal',
    cooking: ['scratch', 'batch', 'both'].includes(p.cooking) ? p.cooking : 'both',
    snacks: [0, 1, 2].includes(p.snacks) ? p.snacks : 1,
  };
}

/** Splits free text ("tomatoes, spicy; mushrooms") into avoid tags. */
export const parseAvoid = (text) => cleanPrefs({ avoid: String(text || '').split(/[,;\n]/) }).avoid;

// ---------- avoid matching ----------
const stemWord = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('oes') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(stemWord).join(' ');

/** Everything the avoid list is matched against: tags, name, and ingredient names, plus "dairy" and "gluten" when they apply. */
function haystack(rec) {
  const bits = [rec.name, ...rec.tags.map((t) => t.replace(/_/g, ' ')), ...rec.ingredients.map((i) => i.name)];
  if (!rec.tags.includes('dairy_free')) bits.push('dairy');
  if (!rec.tags.includes('gluten_free')) bits.push('gluten');
  return ` ${bits.map(norm).join(' | ')} `;
}
const hayCache = new Map();
const hay = (rec) => { if (!hayCache.has(rec.id)) hayCache.set(rec.id, haystack(rec)); return hayCache.get(rec.id); };

/** True when any avoid tag appears in the recipe. Substring match on purpose: over-excluding is safer than missing an avoided food. */
export function matchesAvoid(rec, avoid) {
  const h = hay(rec);
  return avoid.some((a) => { const n = norm(a); return n.length >= 3 && h.includes(n); });
}

// ---------- filters ----------
const DIET_TAG = { low_histamine: 'low_histamine', pregnancy_safe: 'pregnancy_safe', vegetarian: 'vegetarian', dairy_free: 'dairy_free', gluten_free: 'gluten_free' };

/** Does this recipe fit the user's rules? (diet chips, avoid list, leftovers rule). Caps and floors are handled by the picker. */
export function fits(rec, prefsIn) {
  const prefs = cleanPrefs(prefsIn);
  for (const d of prefs.diets) if (!rec.tags.includes(DIET_TAG[d])) return false;
  if (prefs.leftovers === 'freeze' && rec.fridge) return false;
  if (prefs.diets.includes('low_histamine') && rec.fridge) return false; // low-histamine means fresh-cooked
  if (matchesAvoid(rec, prefs.avoid)) return false;
  return true;
}

export const eligible = (prefs, slot) => RECIPES.filter((x) => x.slot === recipeSlot(slot) && fits(x, prefs));

// ---------- dates ----------
/** Monday of the week containing `day` (YYYY-MM-DD), by calendar arithmetic only. */
export function weekStartOf(day) {
  if (!DAY_KEY.test(day)) return day;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- the picker ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export const calorieFloor = (prefs) => (cleanPrefs(prefs).diets.includes('pregnancy_safe') ? FLOOR_KCAL_PREGNANCY : FLOOR_KCAL);
export const swapKey = (weekStart, dayIdx, slot) => `${weekStart}:${dayIdx}:${slot}`;

/** kcal and protein targets for the plan: the user's own goal, never below the floor. */
export function planTargets(prefs, targets) {
  const floor = calorieFloor(prefs);
  const cal = finite(targets && targets.calories, DEFAULT_KCAL);
  const protein = finite(targets && targets.proteinG, DEFAULT_PROTEIN);
  return { floor, kcal: Math.max(floor, cal > 0 ? cal : DEFAULT_KCAL), protein: protein > 0 ? protein : DEFAULT_PROTEIN };
}

const fixedServing = (rec) => rec.fish_oz > 0 || rec.caffeine_mg > 0; // fish and caffeine are capped per week and day, so never scaled
const scaleFor = (rec, slotKcal) => (fixedServing(rec) ? 1 : Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((slotKcal / rec.kcal) * 4) / 4)));

function mealOf(rec, servings, slot) {
  return {
    slot, id: rec.id, name: rec.name, servings,
    kcal: Math.round(rec.kcal * servings), protein_g: Math.round(rec.protein_g * servings),
    fish_oz: r1(rec.fish_oz * servings), caffeine_mg: Math.round(rec.caffeine_mg * servings),
  };
}

/** Rank candidates: protein density close to the target's, recipes not yet used this week first, ties broken by a stable hash. */
function ranked(cands, { slot, dayIdx, weekStart, used, ratio, batch }) {
  return cands.map((rec) => {
    const dens = rec.protein_g / rec.kcal;
    const reuse = used.get(rec.id) || 0;
    const style = batch ? (rec.tags.includes('batch_friendly') ? -0.05 : 0.05) : (rec.tags.includes('batch_friendly') ? 0 : -0.01);
    const score = Math.abs(dens - ratio) * 10 + reuse * (batch ? 0.5 : 2) + style + hash(`${weekStart}|${dayIdx}|${slot}|${rec.id}`) * 0.05;
    return { rec, score };
  }).sort((a, b) => a.score - b.score || a.rec.id.localeCompare(b.rec.id)).map((x) => x.rec);
}

/**
 * The week. `targets` is { calories, proteinG } from the user's existing goal (null is fine).
 * Returns { weekStart, floor, kcalTarget, proteinTarget, days: [{ date, meals, kcal, protein_g, caffeine_mg }], fish_oz, gaps }.
 * A slot with no recipe that fits the rules is left out of the day and listed in `gaps`.
 */
export function generateWeek({ prefs: prefsIn, targets, weekStart }) {
  const prefs = cleanPrefs(prefsIn);
  const ws = weekStartOf(weekStart);
  const t = planTargets(prefs, targets);
  const split = SPLIT[prefs.snacks];
  const slots = Object.keys(split);
  const pregnant = prefs.diets.includes('pregnancy_safe');
  const capMg = pregnant ? CAFFEINE_CAP_MG.pregnancy : CAFFEINE_CAP_MG.normal;
  const batch = prefs.cooking === 'batch';
  const ratio = t.protein / t.kcal;
  const used = new Map();
  const picks = []; // picks[day][slot] = { rec, servings }
  for (let d = 0; d < 7; d++) picks.push({});
  let fish = 0;
  const dayCaf = Array(7).fill(0);
  const gaps = [];

  const take = (d, slot, rec) => {
    const servings = scaleFor(rec, t.kcal * split[slot]);
    if (fish + rec.fish_oz * servings > FISH_CAP_OZ + 1e-9) return false;
    if (dayCaf[d] + rec.caffeine_mg * servings > capMg) return false;
    fish += rec.fish_oz * servings;
    dayCaf[d] += rec.caffeine_mg * servings;
    used.set(rec.id, (used.get(rec.id) || 0) + 1);
    picks[d][slot] = { rec, servings };
    return true;
  };

  // your swaps first, if they still fit the rules and the caps
  for (let d = 0; d < 7; d++) for (const slot of slots) {
    const id = prefs.swaps[swapKey(ws, d, slot)];
    const rec = id && getRecipe(id);
    if (rec && rec.slot === recipeSlot(slot) && fits(rec, prefs)) take(d, slot, rec);
  }
  // then fill the rest. Slot-major so each slot rotates through its own recipes across the week.
  for (const slot of slots) for (let d = 0; d < 7; d++) {
    if (picks[d][slot]) continue;
    const ids = new Set(Object.values(picks[d]).map((p) => p.rec.id));
    const all = ranked(eligible(prefs, slot), { slot, dayIdx: d, weekStart: ws, used, ratio, batch });
    const order = [...all.filter((x) => !ids.has(x.id)), ...all.filter((x) => ids.has(x.id))]; // not twice in one day if avoidable
    if (!order.some((rec) => take(d, slot, rec))) gaps.push({ day: d, slot });
  }

  // a day never lands under the floor: scale its meals up (in quarter steps) when needed
  const days = picks.map((day, d) => {
    let entries = slots.filter((s) => day[s]).map((s) => ({ slot: s, ...day[s] }));
    const total = () => entries.reduce((n, e) => n + e.rec.kcal * e.servings, 0);
    for (let pass = 0; pass < 6 && entries.length && total() < t.floor; pass++) {
      const room = entries.filter((e) => !fixedServing(e.rec) && e.servings < MAX_SCALE);
      if (!room.length) break;
      const missing = t.floor - total();
      const share = missing / room.reduce((n, e) => n + e.rec.kcal, 0);
      for (const e of room) e.servings = Math.min(MAX_SCALE, Math.ceil((e.servings + share) * 4) / 4);
    }
    const meals = entries.map((e) => mealOf(e.rec, e.servings, e.slot));
    return {
      date: addDays(ws, d), meals,
      kcal: meals.reduce((n, m) => n + m.kcal, 0), protein_g: meals.reduce((n, m) => n + m.protein_g, 0),
      caffeine_mg: meals.reduce((n, m) => n + m.caffeine_mg, 0),
    };
  });
  return {
    weekStart: ws, floor: t.floor, kcalTarget: t.kcal, proteinTarget: t.protein, days,
    fish_oz: r1(days.reduce((n, d) => n + d.meals.reduce((m, x) => m + x.fish_oz, 0), 0)), gaps,
  };
}

/** Up to `count` other recipes that fit the same rules, the fish and caffeine caps, and the slot, best first. */
export function alternatives({ prefs: prefsIn, targets, weekStart, dayIdx, slot, count = 2 }) {
  const prefs = cleanPrefs(prefsIn);
  const ws = weekStartOf(weekStart);
  const plan = generateWeek({ prefs, targets, weekStart: ws });
  const day = plan.days[dayIdx];
  if (!day) return [];
  const current = day.meals.find((m) => m.slot === slot);
  const t = planTargets(prefs, targets);
  const split = SPLIT[prefs.snacks];
  if (!split[slot]) return [];
  const capMg = prefs.diets.includes('pregnancy_safe') ? CAFFEINE_CAP_MG.pregnancy : CAFFEINE_CAP_MG.normal;
  const fishOthers = plan.fish_oz - (current ? current.fish_oz : 0);
  const cafOthers = day.caffeine_mg - (current ? current.caffeine_mg : 0);
  const onDay = new Set(day.meals.map((m) => m.id));
  const used = new Map();
  for (const dd of plan.days) for (const m of dd.meals) used.set(m.id, (used.get(m.id) || 0) + 1);
  const cands = eligible(prefs, slot).filter((rec) => {
    if (current && rec.id === current.id) return false;
    if (onDay.has(rec.id)) return false;
    return fishOthers + rec.fish_oz <= FISH_CAP_OZ + 1e-9 && cafOthers + rec.caffeine_mg <= capMg;
  });
  const out = ranked(cands, { slot, dayIdx, weekStart: ws, used, ratio: t.protein / t.kcal, batch: prefs.cooking === 'batch' }).slice(0, count);
  return out.map((rec) => mealOf(rec, scaleFor(rec, t.kcal * split[slot]), slot));
}

/** Prefs with one swap applied (or cleared with id = null). Pure: returns a new prefs object. */
export function withSwap(prefsIn, weekStart, dayIdx, slot, id) {
  const prefs = cleanPrefs(prefsIn);
  const swaps = { ...prefs.swaps };
  const key = swapKey(weekStartOf(weekStart), dayIdx, slot);
  if (id) swaps[key] = id; else delete swaps[key];
  return { ...prefs, swaps };
}

// ---------- grocery list and batch prep (chunk 5) ----------
/** The week's shopping, grouped by store section. Same item twice → one row with "× n" (quantities are per recipe, not summed). */
export function groceryList(plan) {
  const rows = new Map();
  for (const d of plan.days) for (const m of d.meals) {
    const rec = getRecipe(m.id);
    if (!rec) continue;
    for (const ing of rec.ingredients) {
      const key = `${ing.section}|${ing.name}`;
      const row = rows.get(key) || { name: ing.name, section: ing.section, uses: 0, qty: ing.qty };
      row.uses += 1;
      rows.set(key, row);
    }
  }
  return Object.keys(SECTIONS).map((section) => ({
    section, label: SECTIONS[section],
    items: [...rows.values()].filter((r) => r.section === section).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.items.length);
}

/** Sunday prep: batch-friendly meals that appear more than once, or freezer-friendly ones, with freeze-same-day guidance when asked. */
export function batchPrep(plan, prefsIn) {
  const prefs = cleanPrefs(prefsIn);
  if (prefs.cooking === 'scratch') return null;
  const counts = new Map();
  for (const d of plan.days) for (const m of d.meals) counts.set(m.id, (counts.get(m.id) || 0) + 1);
  const items = [...counts].map(([id, n]) => ({ rec: getRecipe(id), n })).filter((x) => x.rec && x.rec.tags.includes('batch_friendly'))
    .sort((a, b) => b.n - a.n || a.rec.name.localeCompare(b.rec.name)).slice(0, 4)
    .map((x) => ({ id: x.rec.id, name: x.rec.name, portions: x.n, freezes: x.rec.tags.includes('freezer_friendly') }));
  const tips = ['Cook, then portion into containers.'];
  if (prefs.leftovers === 'freeze') tips.push('Cool and freeze the extra portions the same day. Skip the fridge for leftovers.', 'Thaw one portion at a time and reheat until steaming hot.');
  else tips.push('Chill extra portions within 2 hours and eat within 3 days, or freeze them.');
  return { items, tips };
}
