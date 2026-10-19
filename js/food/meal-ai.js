// Meal plan AI (v0.16.22): the optional "Personalize with AI" week. It is off unless Settings → "Meal plan AI" is on, and nothing here
// runs (no network) while it is off. The server (personalizeMealPlan) checks every meal before it answers; the app checks the shape and
// the skip list again as a backup and keeps the rule-based plan if anything looks wrong. Pure helpers plus one network call, no DOM.
import { matchesAvoidText, weekStartOf, addDays, SLOT_LABEL } from './meal-plan.js';

export const AI_FAIL = 'The AI plan didn’t work out. Your standard plan is still here.';
const SLOTS = Object.keys(SLOT_LABEL);
const KEY = (ws) => `forge.mealai.${ws}`;
const fin = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const str = (x, n) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/**
 * Checks an AI week from the server (or the cache) against the user's rules and returns a clean copy, or null when anything is off:
 * not 7 days in order for this week, bad numbers, or any meal that matches the skip list. Never repairs: a bad plan is dropped whole.
 */
export function checkAiPlan(plan, prefs, weekStart) {
  if (!plan || typeof plan !== 'object' || plan.weekStart !== weekStart || weekStartOf(weekStart) !== weekStart) return null;
  if (!Array.isArray(plan.days) || plan.days.length !== 7) return null;
  const days = [];
  for (let d = 0; d < 7; d++) {
    const day = plan.days[d];
    if (!day || day.date !== addDays(weekStart, d) || !Array.isArray(day.meals) || day.meals.length > 5) return null;
    const meals = [];
    for (const m of day.meals) {
      if (!m || !SLOTS.includes(m.slot)) return null;
      const name = str(m.name, 80);
      if (!name || ![m.kcal, m.protein_g, m.carbs_g, m.fat_g].every(fin) || m.kcal > 5000) return null;
      const ingredients = (Array.isArray(m.ingredients) ? m.ingredients : []).slice(0, 12).map((i) => ({ name: str(i && i.name, 60), qty: str(i && i.qty, 30), section: str(i && i.section, 12) })).filter((i) => i.name);
      const steps = (Array.isArray(m.steps) ? m.steps : []).slice(0, 8).map((s) => str(s, 200)).filter(Boolean);
      if (matchesAvoidText([name, ...ingredients.map((i) => i.name), ...steps], prefs.avoid)) return null;
      meals.push({
        slot: m.slot, ...(typeof m.id === 'string' && m.id.length <= 40 ? { id: m.id } : {}), name, servings: fin(m.servings) && m.servings > 0 && m.servings <= 10 ? m.servings : 1,
        kcal: Math.round(m.kcal), protein_g: Math.round(m.protein_g), carbs_g: Math.round(m.carbs_g), fat_g: Math.round(m.fat_g),
        fish_oz: fin(m.fish_oz) ? m.fish_oz : 0, caffeine_mg: fin(m.caffeine_mg) ? m.caffeine_mg : 0, ingredients, steps,
      });
    }
    if (!meals.length) return null;
    days.push({
      date: day.date, meals,
      kcal: meals.reduce((n, m) => n + m.kcal, 0), protein_g: meals.reduce((n, m) => n + m.protein_g, 0), caffeine_mg: meals.reduce((n, m) => n + m.caffeine_mg, 0),
    });
  }
  return {
    weekStart, source: 'ai', days, gaps: [],
    floor: fin(plan.floor) ? plan.floor : 1500, kcalTarget: fin(plan.kcalTarget) ? plan.kcalTarget : 2000, proteinTarget: fin(plan.proteinTarget) ? plan.proteinTarget : 100,
    fish_oz: fin(plan.fish_oz) ? plan.fish_oz : 0,
  };
}

const PREFIX = 'forge.mealai.';
/** What the week was made for: the five preferences and the protein CHOICE ('auto' or the custom grams). Changing the goal makes the week stale; the daily drift of auto targets with weight does not. */
const fingerprint = (prefs, proteinChoice) => JSON.stringify([prefs.diets, prefs.avoid, prefs.leftovers, prefs.cooking, prefs.snacks, proteinChoice ?? null]);

/** The saved AI week for this week start, if it was made for this account and these preferences and still passes the skip list; otherwise null (and it is forgotten). */
export function cachedAiPlan(weekStart, prefs, uid, store = globalThis.localStorage, proteinChoice) {
  try {
    const raw = store && store.getItem(KEY(weekStart));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const ok = saved && uid && saved.uid === uid && saved.fp === fingerprint(prefs, proteinChoice) ? checkAiPlan(saved.plan, prefs, weekStart) : null;
    if (!ok) store.removeItem(KEY(weekStart));
    return ok;
  } catch { return null; }
}
export function saveAiPlan(plan, prefs, uid, store = globalThis.localStorage, proteinChoice) {
  try { store.setItem(KEY(plan.weekStart), JSON.stringify({ uid, fp: fingerprint(prefs, proteinChoice), plan })); } catch { /* private mode: the week still shows this time */ }
}
export function clearAiPlan(weekStart, store = globalThis.localStorage) {
  try { store.removeItem(KEY(weekStart)); } catch { /* nothing saved */ }
}
/** Forgets every saved AI week on this phone (Sign out, Delete everything). */
export function clearAllAiPlans(store = globalThis.localStorage) {
  try {
    const keys = [];
    for (let i = 0; i < store.length; i++) keys.push(store.key(i));
    keys.filter((k) => k && k.startsWith(PREFIX)).forEach((k) => store.removeItem(k));
  } catch { /* nothing saved */ }
}

/** Asks the server for the AI week. Resolves to a checked plan; rejects with a short, calm message for the screen. `call` is js/functions.js call. */
export async function requestAiPlan({ prefs, targets, weekStart, call }) {
  const send = { weekStart, prefs: { diets: prefs.diets, avoid: prefs.avoid, leftovers: prefs.leftovers, cooking: prefs.cooking, snacks: prefs.snacks }, targets: { calories: targets.calories, proteinG: targets.proteinG } };
  let res;
  try { res = await call('personalizeMealPlan', send, { timeout: 95000 }); } catch (e) { throw new Error(e && e.message ? e.message : AI_FAIL); }
  const plan = checkAiPlan(res && res.plan, prefs, weekStart);
  if (!plan) throw new Error(AI_FAIL);
  return plan;
}
