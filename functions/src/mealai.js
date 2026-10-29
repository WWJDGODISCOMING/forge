// Meal plan AI (v0.16.22): asks an xAI model for a week of meals that fit the user's food preferences, then checks EVERY meal on
// the server before anything is returned or saved. A meal that fails any rule is replaced by the rule-based pick for that slot
// (the same picker the app uses offline), so an unsafe or off-list meal never ships. The prompt, the preferences and the reply
// are never logged: the only logger is log.js and we hand it counts and durations. No network in tests: `fetch` is injected.
// src/meal/ holds copies of js/food/meal-library.js and meal-plan.js (a test keeps them identical to the app's files).
import { P } from './paths.js';
import { log } from './log.js';
import { XAI_URL, MODEL } from './snap.js';
import {
  cleanPrefs, generateWeek, eligible, scaleFor, mealOf, slotsFor, slotShare, planTargets, weekStartOf, addDays, matchesAvoidText, scaleQty,
  FISH_CAP_OZ, CAFFEINE_CAP_MG, MAX_AVOID,
} from './meal/meal-plan.js';
import { dayIn } from './decode.js';
import { SECTIONS, getRecipe } from './meal/meal-library.js';

export const MAX_TOKENS = 9000; // a week of meals with steps; reasoning tokens share this budget
export const TIMEOUT_MS = 80000;
export const MAX_REPLY_CHARS = 120000;
export const MAX_BODY_CHARS = 4000; // the request from the app is tiny (preferences only)
export const PER_HOUR = 2;
export const PER_DAY = 5;
export const GLOBAL_PER_DAY = 300;
export const MAX_MEAL_KCAL = 1500;

/** Short code the wiring maps to an HttpsError: 'invalid' | 'limited' | 'busy' | 'down' | 'garbled' | 'nokey'. */
export class MealAiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (x, lo, hi) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : NaN; };

// ---------- input ----------
/** The request → { weekStart, prefs, targets }. Same rules as the app's cleanPrefs; throws MealAiError('invalid'). */
export function cleanInput(data) {
  const d = data && typeof data === 'object' ? data : null;
  if (!d || JSON.stringify(d).length > MAX_BODY_CHARS) throw new MealAiError('invalid');
  const ws = d.weekStart;
  if (typeof ws !== 'string' || !DAY_KEY.test(ws) || Number.isNaN(Date.parse(`${ws}T12:00:00Z`)) || weekStartOf(ws) !== ws) throw new MealAiError('invalid');
  const p = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
  const avoid = (Array.isArray(p.avoid) ? p.avoid : []).filter((a) => typeof a === 'string' && a.length <= 40).slice(0, MAX_AVOID);
  const prefs = cleanPrefs({ diets: Array.isArray(p.diets) ? p.diets : [], avoid, leftovers: p.leftovers, cooking: p.cooking, snacks: p.snacks });
  const t = d.targets && typeof d.targets === 'object' ? d.targets : {};
  const cal = num(t.calories, 800, 6000);
  const protein = num(t.proteinG, 20, 400);
  return { weekStart: ws, prefs, targets: { calories: Number.isNaN(cal) ? undefined : cal, proteinG: Number.isNaN(protein) ? undefined : protein } };
}

// ---------- the prompt ----------
const DIET_WORDS = { low_histamine: 'low-histamine (fresh-cooked only)', pregnancy_safe: 'pregnancy-safe', vegetarian: 'vegetarian', dairy_free: 'dairy-free', gluten_free: 'gluten-free' };
export function buildPrompt({ prefs, targets, weekStart }) {
  const t = planTargets(prefs, targets);
  const slots = slotsFor(prefs.snacks);
  const rules = [
    prefs.diets.length ? `Diet: ${prefs.diets.map((d) => DIET_WORDS[d]).join(', ')}.` : 'No special diet.',
    prefs.avoid.length ? `Never use these foods: ${prefs.avoid.join(', ')}.` : '',
    prefs.leftovers === 'freeze' ? 'No fridge leftovers: every meal is cooked fresh or comes straight from the freezer.' : '',
    `Cooking style: ${prefs.cooking === 'scratch' ? 'from scratch' : prefs.cooking === 'batch' ? 'batch prep' : 'a mix of from scratch and batch prep'}.`,
  ].filter(Boolean).join(' ');
  return 'You plan home-cooked meals for a nutrition app. Reply with JSON only, no other text: '
    + '{"days":[{"meals":[{"slot":"breakfast","name":"short dish name","kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"fish_oz":number,"caffeine_mg":number,'
    + `"ingredients":[{"name":"plain ingredient","qty":"e.g. 1/2 cup","section":"${Object.keys(SECTIONS).join('|')}"}],"steps":["short step"]}]}]}. `
    + `Plan exactly 7 days starting ${weekStart}, in order. Each day has one meal for each of these slots: ${slots.join(', ')}. `
    + `Aim for about ${Math.round(t.kcal)} kcal and ${Math.round(t.protein)} g protein per day (never under ${t.floor} kcal). Numbers are for one serving, as estimates. `
    + 'Use at most 12 ingredients and 8 steps per meal, each step under 200 characters, names under 80 characters. Vary the meals across the week. '
    + 'Fully cook all eggs, meat and fish. Set fish_oz to the ounces of cooked fish in the meal and caffeine_mg to its caffeine, or 0. '
    + rules;
}

// ---------- reading the reply ----------
const ING_MAX = 12, STEPS_MAX = 8;
function cleanMeal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clean(raw.name, 80);
  if (!name) return null;
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : []).slice(0, ING_MAX).map((i) => ({
    name: clean(i && typeof i === 'object' ? i.name : i, 60), qty: clean(i && typeof i === 'object' ? i.qty : '', 30),
    section: SECTIONS[i && i.section] ? i.section : 'pantry',
  })).filter((i) => i.name);
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, STEPS_MAX).map((s) => clean(s, 200)).filter(Boolean);
  return {
    slot: typeof raw.slot === 'string' ? raw.slot.trim().toLowerCase() : '', name, servings: 1,
    kcal: num(raw.kcal, 0, 100000), protein_g: num(raw.protein_g, 0, 100000), carbs_g: num(raw.carbs_g, 0, 100000), fat_g: num(raw.fat_g, 0, 100000),
    fish_oz: Number.isNaN(num(raw.fish_oz, 0, 100000)) ? 0 : num(raw.fish_oz, 0, 100000),
    caffeine_mg: Number.isNaN(num(raw.caffeine_mg, 0, 100000)) ? 0 : num(raw.caffeine_mg, 0, 100000),
    ingredients, steps,
  };
}

/** The model's reply text → up to 7 days of cleaned (not yet checked) meals. Throws 'garbled' for anything unusable. */
export function parseDays(text) {
  const s = String(text || '');
  if (s.length > MAX_REPLY_CHARS) throw new MealAiError('garbled');
  let obj;
  try { const m = /\{[\s\S]*\}/.exec(s); obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; }
  if (!obj || !Array.isArray(obj.days) || !obj.days.length) throw new MealAiError('garbled');
  const days = obj.days.slice(0, 7).map((d) => (d && Array.isArray(d.meals) ? d.meals.slice(0, 8).map(cleanMeal).filter(Boolean) : []));
  if (!days.some((d) => d.length)) throw new MealAiError('garbled');
  return days;
}

// ---------- the safety check ----------
const RX = {
  meat: /\b(chicken|beef|turkey|pork|bacon|ham|lamb|veal|sausage|steak|duck|venison|liver|salami|chorizo|pepperoni|prosciutto|meatball|mince|ground (?:beef|turkey|pork))\b/,
  fish: /\b(salmon|cod|tilapia|haddock|pollock|trout|halibut|tuna|sardines?|anchov\w*|mackerel|swordfish|sea ?bass|snapper|mahi|fish|herring|shark|tilefish|marlin|bluefish|catfish|shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|squid|seafood)\b/,
  fishOnly: /\b(salmon|cod|tilapia|haddock|pollock|trout|halibut|tuna|sardines?|anchov\w*|mackerel|swordfish|sea ?bass|snapper|mahi|fish|herring|shark|tilefish|marlin|bluefish|catfish)\b/,
  dairy: /\b(milk|cheese|butter|yogh?urt|cream|ghee|whey|kefir|paneer|custard|ricotta|mozzarella|parmesan|cheddar|buttermilk|casein|ice cream)\b/,
  gluten: /\b(wheat|bread|pasta|flour|barley|rye|couscous|bulgur|farro|semolina|bagel|tortilla|noodles?|crackers?|spaghetti|penne|macaroni|breadcrumbs?|panko|pita|naan|seitan|cereal|oats?|oatmeal|granola|pancakes?|waffles?|toast|baguette|croutons?|dumplings?|pizza|spelt)\b/,
  lowHistamine: /\b(tomato\w*|spinach|eggplant|aubergine|vinegar|bacon|ham|salami|prosciutto|pepperoni|chorizo|sausage|smoked|cured|canned|tinned|tuna|sardines?|anchov\w*|mackerel|herring|pickle\w*|sauerkraut|kimchi|soy sauce|tamari|miso|tempeh|natto|kombucha|kefir|yogh?urt|sour cream|buttermilk|parmesan|cheddar|gouda|brie|camembert|blue cheese|gorgonzola|feta|swiss|provolone|aged|fermented|wine|beer|ketchup|mustard|chili|chilli|cayenne|curry|hot sauce|sriracha|salsa|capers|olives|sourdough|deli|shrimp|prawns?|crab|lobster|shellfish|fish sauce|worcestershire|hot dogs?|cold cuts|lunch meat|leftovers?|chocolate|cocoa|strawberr\w*|pineapple|citrus|lemon|lime|orange|walnuts?|cashews?|peanuts?|avocados?)\b/,
  fridge: /\b(leftovers?|fridge|refrigerat\w*|overnight|next day|make[- ]ahead|chill(?:ed)? (?:for|until|overnight)|keeps? for \d+ days?)\b/,
  rawPregnancy: /\b(raw|undercooked|runny|rare|medium[- ]rare|pink in the middle|soft[- ]?boiled|sunny[- ]side|over[- ]easy|poached eggs?|jammy|sushi|sashimi|ceviche|tartare|carpaccio|poke|cookie dough|raw egg|homemade mayo\w*|hollandaise|aioli|eggnog|tiramisu|mousse|caesar)\b/,
  mercury: /\b(swordfish|shark|king mackerel|mackerel|marlin|tilefish|orange roughy|bigeye|bluefin|tuna)\b/,
  unpasteurized: /\b(unpasteuri[sz]ed|raw milk|raw cheese)\b/,
  softCheese: /\b(brie|camembert|blue cheese|gorgonzola|roquefort|queso fresco|queso blanco|feta|goat cheese|chevre|stilton)\b/,
  pasteurized: /(?<!un)pasteuri[sz]ed/,
  deli: /\b(deli|cold cuts?|lunch meat|salami|prosciutto|pepperoni|bologna|hot dogs?|frankfurters?|smoked (?:salmon|fish|trout)|lox|cured|jerky)\b/,
  heated: /\b(steaming|piping hot|heated|reheated?|165)\b/,
  liver: /\b(liver|p[aâ]t[eé]|liverwurst|organ meat|foie gras)\b/,
  alcohol: /\b(wine|beer|rum|whisk(?:e)?y|vodka|brandy|bourbon|sake|liqueur|champagne|sherry)\b/,
  sprouts: /\b(alfalfa|bean|radish|mung|clover) sprouts?\b/,
};
const PLANT_MILK = /\b(coconut|almond|oat|rice|soy|cashew|hemp) (milk|yogh?urt|cream|butter|cheese)\b|\bpeanut butter\b|\bcocoa butter\b|\bnut butter\b|\bcream of tartar\b/g;
const GF_OK = /\b(rice|almond|corn|coconut|chickpea|buckwheat|tapioca|potato|cassava|gluten[- ]free) (flour|noodles?|pasta|bread|tortilla|oats?|crackers?)\b|\bgluten[- ]free\b|\brice noodles?\b|\bcorn tortillas?\b/g;
const LH_OK = /\b(cottage cheese|ricotta|cream cheese|fresh mozzarella|fresh)\b/g;
const CAFFEINE = [[/\bcoffee\b/, 95], [/\bespresso\b/, 65], [/\bmatcha\b/, 70], [/\b(black|green|iced|chai) tea\b|\bearl grey\b/, 40], [/\bcola\b/, 35], [/\bcocoa|chocolate\b/, 15], [/\benergy drink\b/, 150]];

const textOf = (m) => [m.name, ...m.ingredients.map((i) => i.name), ...m.steps].join(' | ').toLowerCase();
const ingText = (m) => [m.name, ...m.ingredients.map((i) => i.name)].join(' | ').toLowerCase();

/** Diets the user asked for, plus any implied by the skip list ("dairy", "gluten" typed as foods to avoid). */
function effectiveDiets(prefs) {
  const set = new Set(prefs.diets);
  if (prefs.avoid.some((a) => /\b(dairy|milk|lactose)\b/.test(a))) set.add('dairy_free');
  if (prefs.avoid.some((a) => /\b(gluten|wheat)\b/.test(a))) set.add('gluten_free');
  return set;
}

/** Estimated cooked fish, in ounces: the larger of what the model said and what the ingredient amounts show. */
export function fishOunces(m) {
  let est = 0;
  for (const i of m.ingredients) {
    if (!RX.fishOnly.test(i.name.toLowerCase())) continue;
    const q = /(\d+(?:\.\d+)?)\s*(oz|ounces?|g|grams?|lb|pounds?)\b/i.exec(i.qty);
    if (!q) { est += 6; continue; }
    const n = Number(q[1]);
    est += /^oz|^ounce/i.test(q[2]) ? n : /^lb|^pound/i.test(q[2]) ? n * 16 : n / 28.35;
  }
  if (!est && RX.fishOnly.test(textOf(m))) est = 6;
  return Math.max(m.fish_oz, Math.round(est * 10) / 10);
}
/** Estimated caffeine, in mg: the larger of what the model said and what the ingredient names suggest. */
export function caffeineMg(m) {
  const t = ingText(m).replace(/\b(herbal|chamomile|ginger|mint|rooibos|decaf\w*) (tea|coffee)\b/g, '');
  const est = CAFFEINE.reduce((n, [rx, mg]) => n + (rx.test(t) ? mg : 0), 0);
  return Math.max(m.caffeine_mg, est);
}

/** Why a meal can't ship ('' when it can). Caps that span meals (fish per week, caffeine per day) are checked by the caller. */
export function unsafeReason(m, prefs) {
  if (![m.kcal, m.protein_g, m.carbs_g, m.fat_g].every(Number.isFinite)) return 'numbers';
  if ([m.protein_g, m.carbs_g, m.fat_g].some((x) => x < 0) || m.kcal < 50 || m.kcal > MAX_MEAL_KCAL || m.protein_g > 200 || m.carbs_g > 400 || m.fat_g > 200) return 'numbers';
  const energy = 4 * m.protein_g + 4 * m.carbs_g + 9 * m.fat_g;
  if (energy < m.kcal * 0.6 || energy > m.kcal * 1.4) return 'numbers';
  if (!m.ingredients.length || !m.steps.length) return 'incomplete';
  const diets = effectiveDiets(prefs);
  const t = textOf(m);
  if (matchesAvoidText([m.name, ...m.ingredients.map((i) => i.name), ...m.steps], prefs.avoid)) return 'avoid';
  if (diets.has('vegetarian') && (RX.meat.test(t) || RX.fish.test(t))) return 'vegetarian';
  if (diets.has('dairy_free') && RX.dairy.test(t.replace(PLANT_MILK, ' '))) return 'dairy';
  if (diets.has('gluten_free') && RX.gluten.test(t.replace(GF_OK, ' '))) return 'gluten';
  if (diets.has('low_histamine') && RX.lowHistamine.test(t.replace(LH_OK, ' '))) return 'histamine';
  if ((prefs.leftovers === 'freeze' || diets.has('low_histamine')) && RX.fridge.test(t)) return 'leftovers';
  if (diets.has('pregnancy_safe')) {
    const heated = RX.heated.test(m.steps.join(' ').toLowerCase());
    if (RX.rawPregnancy.test(t) || RX.mercury.test(t) || RX.unpasteurized.test(t) || RX.liver.test(t) || RX.alcohol.test(t) || RX.sprouts.test(t)) return 'pregnancy';
    if (RX.softCheese.test(t) && !RX.pasteurized.test(t)) return 'pregnancy';
    if (RX.deli.test(t) && !heated) return 'pregnancy';
  }
  return '';
}

// ---------- building the week ----------
const rulePayload = (rec, servings, slot) => ({
  ...mealOf(rec, servings, slot),
  ingredients: rec.ingredients.slice(0, ING_MAX).map((i) => ({ name: clean(i.name, 60), qty: clean(scaleQty(i.qty, servings), 30), section: i.section })),
  steps: rec.steps.slice(0, STEPS_MAX).map((s) => clean(s, 200)),
});
const round = (m) => ({ ...m, kcal: Math.round(m.kcal), protein_g: Math.round(m.protein_g), carbs_g: Math.round(m.carbs_g), fat_g: Math.round(m.fat_g), fish_oz: Math.round(m.fish_oz * 10) / 10, caffeine_mg: Math.round(m.caffeine_mg) });

/**
 * AI days (from parseDays) + the user's rules → the week to return: { weekStart, floor, kcalTarget, proteinTarget, days, fish_oz, gaps, source: 'ai' }.
 * Every meal is checked; one that fails (or breaks the fish or caffeine caps, or is missing) becomes the rule-based pick for its slot.
 * A day that would land under the calorie floor is replaced whole by the rule-based day.
 */
export function buildWeek({ aiDays, prefs: prefsIn, targets, weekStart }) {
  const prefs = cleanPrefs(prefsIn);
  const base = generateWeek({ prefs, targets, weekStart });
  const t = planTargets(prefs, targets);
  const slots = slotsFor(prefs.snacks);
  const capMg = prefs.diets.includes('pregnancy_safe') ? CAFFEINE_CAP_MG.pregnancy : CAFFEINE_CAP_MG.normal;
  let fish = 0;
  const stats = { replaced: 0 };

  // The rule-based meal for a slot that also fits the running fish and caffeine totals (else a recipe with neither).
  const ruleMeal = (d, slot, cafSoFar) => {
    const b = base.days[d] && base.days[d].meals.find((m) => m.slot === slot);
    const fits = (fo, cf) => fish + fo <= FISH_CAP_OZ + 1e-9 && cafSoFar + cf <= capMg;
    if (b && fits(b.fish_oz, b.caffeine_mg)) return rulePayload(getRecipe(b.id), b.servings, slot);
    const slotKcal = t.kcal * slotShare(prefs.snacks, slot);
    const pool = eligible(prefs, slot).filter((r) => !r.fish_oz && !r.caffeine_mg).sort((x, y) => Math.abs(x.kcal * scaleFor(x, slotKcal) - slotKcal) - Math.abs(y.kcal * scaleFor(y, slotKcal) - slotKcal) || x.id.localeCompare(y.id));
    return pool.length ? rulePayload(pool[0], scaleFor(pool[0], slotKcal), slot) : null;
  };

  const buildDay = (d, useAi) => {
    const meals = [];
    let caf = 0;
    for (const slot of slots) {
      let pick = null;
      const ai = useAi && (aiDays[d] || []).find((m) => m.slot === slot);
      if (ai && !unsafeReason(ai, prefs)) {
        const fo = fishOunces(ai), cf = caffeineMg(ai);
        if (fish + fo <= FISH_CAP_OZ + 1e-9 && caf + cf <= capMg) pick = round({ ...ai, fish_oz: fo, caffeine_mg: cf });
      }
      if (!pick) { pick = ruleMeal(d, slot, caf); if (pick) stats.replaced++; }
      if (!pick) continue;
      fish += pick.fish_oz;
      caf += pick.caffeine_mg;
      meals.push(pick);
    }
    return meals;
  };

  const days = [];
  for (let d = 0; d < 7; d++) {
    const before = fish;
    let meals = buildDay(d, true);
    if (meals.reduce((n, m) => n + m.kcal, 0) < t.floor) { fish = before; meals = buildDay(d, false); }
    // the rule-based day is already lifted to the floor by scaling servings; when it still isn't (a gap), keep what exists
    days.push({
      date: addDays(base.weekStart, d), meals,
      kcal: meals.reduce((n, m) => n + m.kcal, 0), protein_g: meals.reduce((n, m) => n + m.protein_g, 0), caffeine_mg: meals.reduce((n, m) => n + m.caffeine_mg, 0),
    });
  }
  return {
    weekStart: base.weekStart, source: 'ai', floor: t.floor, kcalTarget: t.kcal, proteinTarget: t.protein, days,
    fish_oz: Math.round(fish * 10) / 10, gaps: [], replaced: stats.replaced,
  };
}

// ---------- the limits ----------
/** The quota day: the calendar day in the user's zone (America/New_York unless a valid tz is given). */
export const dayStamp = (now, tz) => dayIn(now, tz);

/** Counts this request: 2 an hour and 5 a day for the user, and a daily cap for everyone. { limited: true } when a cap is hit. */
export async function meterMealAi({ db, uid, now }) {
  const uref = db.doc(P.mealAi(uid));
  const gref = db.doc(P.mealAiDaily(dayStamp(now)));
  return db.runTransaction(async (tx) => {
    const [us, gs] = await Promise.all([tx.get(uref), tx.get(gref)]);
    const u = us.exists ? us.data() : {};
    const g = gs.exists ? gs.data() : {};
    const hourFresh = u.hour_start && now >= u.hour_start && now - u.hour_start < 3600000;
    const hourN = hourFresh ? u.hour_n || 0 : 0;
    const day = dayStamp(now);
    const dayN = u.day === day ? u.day_n || 0 : 0;
    const globalN = g.n || 0;
    if (hourN >= PER_HOUR || dayN >= PER_DAY || globalN >= GLOBAL_PER_DAY) return { limited: true };
    tx.set(uref, { hour_start: hourFresh ? u.hour_start : now, hour_n: hourN + 1, day, day_n: dayN + 1 });
    tx.set(gref, { n: globalN + 1 });
    return { limited: false };
  });
}

/** Removes the counter for Delete everything (kept while its day is open so a reset can't dodge the limit). */
export async function deleteMealAiData({ db, uid, now = Date.now() }) {
  try {
    const ref = db.doc(P.mealAi(uid));
    const snap = await ref.get();
    if (!snap.exists) return;
    if (snap.data().day === dayStamp(now)) return;
    await ref.delete();
  } catch (e) { if (e && (e.code === 5 || e.code === 'not-found')) return; throw e; }
}

// ---------- the whole job ----------
/** Check, count, ask the model, check every meal. Nothing is stored; the app keeps the week on the phone. Returns { plan }. Throws MealAiError. */
export async function personalizeMealPlan({ db, uid, data, apiKey, fetch, now = Date.now() }) {
  const input = cleanInput(data);
  if (!apiKey) { log('meal_ai_error', { reason: 'nokey' }); throw new MealAiError('nokey'); }
  if ((await meterMealAi({ db, uid, now })).limited) throw new MealAiError('limited');
  const started = Date.now();
  let res;
  try {
    res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0.4, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildPrompt(input) }],
      }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
  } catch (e) {
    const name = e && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error';
    log('meal_ai_error', { reason: name, ms: Date.now() - started });
    throw name === 'TimeoutError' || name === 'AbortError' ? new MealAiError('busy') : new MealAiError('down');
  }
  if (!res.ok) {
    log('meal_ai_error', { status: res.status, ms: Date.now() - started }); // the reply body is never logged
    throw new MealAiError(res.status === 429 ? 'busy' : 'down');
  }
  let body;
  try { body = await res.json(); } catch { throw new MealAiError('down'); }
  const choice = body && body.choices && body.choices[0];
  if (!choice || choice.finish_reason === 'length') throw new MealAiError('garbled'); // cut off mid-reply
  const aiDays = parseDays(choice.message && choice.message.content);
  const plan = buildWeek({ aiDays, prefs: input.prefs, targets: input.targets, weekStart: input.weekStart });
  if (!plan.days.some((d) => d.meals.length)) throw new MealAiError('garbled');
  log('meal_ai', { replaced: plan.replaced, ms: Date.now() - started });
  return { plan };
}
