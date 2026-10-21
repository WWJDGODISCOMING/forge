// Ask Forge (v0.16.47): "Can I eat this?" The rules-based answer. Pure, no DOM, no network. It is the whole answer when Ask Forge AI is
// off (or unreachable), and the server uses the same file (functions/src/meal/ask-rules.js, a test keeps the copies identical) so the AI
// can never be kinder than the numbers: the final verdict is the stricter of the two. General guidance only, never a diagnosis.
import { matchesAvoidText, DEFAULT_KCAL, cleanPrefs } from './meal-plan.js';

export const ASK_FOOTER = 'General guidance from your numbers, not medical advice. Check with your doctor, OB, or a registered dietitian.';
export const VERDICTS = ['yes', 'half', 'better'];
export const HEADLINE = { yes: 'Yes, go for it', half: 'Have half', better: 'Better pick' };
export const MAX_QUESTION = 200;
const RANK = { yes: 0, half: 1, better: 2 };

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

/** The stricter of two verdicts. */
export const stricter = (a, b) => (RANK[b] > RANK[a] ? b : a);

/** "Is it too late for a Noosa vanilla bean yogurt?" → "noosa vanilla bean yogurt". Falls back to the whole question. */
export function foodFromQuestion(q) {
  let t = String(q || '').replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const lead = [
    /^(hey |hi )?(forge[, ]+)?/, /^(is|would|will) (it|that|this) (be )?(ok|okay|fine|alright|too late|too much|a bad idea|bad|good)( for me)?( to (eat|have|get))?( for| to have| to eat)? ?/,
    /^(can|could|should|may|am) i (still |really |even )?(eat|have|get|grab|snack on|drink|order|add)? ?/, /^(what about|how about|thoughts on|is there room for|do i have room for) ?/,
    /^(is|are) /, /^(a|an|the|some|my|one|1|two|2) /,
  ];
  for (let i = 0; i < 3; i++) for (const rx of lead) t = t.replace(rx, '').trim();
  t = t.replace(/\b(right now|tonight|today|this evening|this late|now|later|after dinner|before bed|for dessert|for a snack|for breakfast|for lunch|for dinner)\b/g, ' ').replace(/\b(ok|okay|fine|alright|allowed)$/, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(a|an|the|some) /, '').trim();
  return (t || String(q || '').trim()).slice(0, 60);
}

// ---------- the person's own rules ----------
const RX = {
  meat: /\b(chicken|beef|turkey|pork|bacon|ham|lamb|veal|sausage|steak|duck|salami|chorizo|pepperoni|prosciutto|meatball|burger|hot dogs?|jerky|pulled pork|brisket)\b/,
  fish: /\b(salmon|cod|tilapia|trout|halibut|tuna|sardines?|anchov\w*|mackerel|fish|shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|squid|seafood|sushi)\b/,
  dairy: /\b(milk|cheese|butter|yogh?urt|cream|ghee|whey|kefir|paneer|custard|ricotta|mozzarella|parmesan|cheddar|latte|cappuccino|ice cream|gelato|milkshake|frappuccino)\b/,
  gluten: /\b(wheat|bread|pasta|flour|barley|rye|couscous|bagel|tortilla|noodles?|crackers?|spaghetti|pizza|cereal|oats?|oatmeal|granola|pancakes?|waffles?|toast|croissant|muffin|cookies?|cake|brownie|donuts?|doughnuts?|pretzels?|sandwich|burrito|wrap|biscuit|pie)\b/,
  lowHistamine: /\b(tomato\w*|spinach|eggplant|vinegar|bacon|ham|salami|prosciutto|pepperoni|chorizo|sausage|smoked|cured|canned|tuna|sardines?|anchov\w*|mackerel|pickle\w*|sauerkraut|kimchi|soy sauce|miso|tempeh|kombucha|kefir|yogh?urt|sour cream|buttermilk|parmesan|cheddar|gouda|brie|blue cheese|feta|swiss|aged|fermented|wine|beer|ketchup|mustard|chili|curry|hot sauce|sriracha|salsa|olives|deli|shrimp|shellfish|leftovers?|chocolate|cocoa|strawberr\w*|pineapple|citrus|lemon|orange|walnuts?|cashews?|peanuts?|avocados?|energy drink)\b/,
  rawPregnancy: /\b(raw|undercooked|runny|rare|soft[- ]?boiled|sunny[- ]side|sushi|sashimi|ceviche|tartare|carpaccio|poke|cookie dough|hollandaise|aioli|eggnog|tiramisu|mousse|caesar)\b/,
  mercury: /\b(swordfish|shark|king mackerel|marlin|tilefish|orange roughy|bigeye|bluefin|tuna)\b/,
  softCheese: /\b(brie|camembert|blue cheese|gorgonzola|roquefort|queso fresco|feta|goat cheese|chevre|stilton)\b/,
  deli: /\b(deli|cold cuts?|lunch meat|salami|prosciutto|pepperoni|hot dogs?|smoked salmon|lox|jerky)\b/,
  other: /\b(liver|p[aâ]t[eé]|unpasteuri[sz]ed|raw milk|wine|beer|rum|whisk(?:e)?y|vodka|cocktail|margarita|champagne|sprouts)\b/,
};
const PLANT = /\b(coconut|almond|oat|rice|soy|cashew|hemp) (milk|yogh?urt|cream|butter|cheese)\b|\bpeanut butter\b|\bcocoa butter\b|\bnut butter\b/g;
const GF_OK = /\bgluten[- ]free(?: \w+)?\b|\b(rice|corn|chickpea|almond) (noodles?|pasta|bread|tortilla|crackers?)\b/g;
const LH_OK = /\b(cottage cheese|ricotta|cream cheese|fresh mozzarella|fresh)\b/g;
const DIET_WORD = { low_histamine: 'low-histamine', pregnancy_safe: 'pregnancy-safe', vegetarian: 'vegetarian', dairy_free: 'dairy-free', gluten_free: 'gluten-free' };

/** Does the food clash with the saved food preferences? → { code, reason } or null. Text match on the name only, so it errs on the side of caution. */
export function dietConflict(name, prefsIn) {
  const prefs = cleanPrefs(prefsIn);
  const t = ` ${String(name || '').toLowerCase()} `;
  if (matchesAvoidText([name], prefs.avoid)) return { code: 'avoid', reason: 'It’s on your list of foods to skip.' };
  const d = new Set(prefs.diets);
  if (prefs.avoid.some((a) => /\b(dairy|milk|lactose)\b/.test(a))) d.add('dairy_free');
  if (prefs.avoid.some((a) => /\b(gluten|wheat)\b/.test(a))) d.add('gluten_free');
  const clash = (code) => ({ code, reason: `It doesn’t look ${DIET_WORD[code]}, which you asked Forge to follow.` });
  if (d.has('pregnancy_safe') && (RX.rawPregnancy.test(t) || RX.mercury.test(t) || RX.other.test(t) || RX.deli.test(t) || (RX.softCheese.test(t) && !/(?<!un)pasteuri[sz]ed/.test(t)))) {
    return { code: 'pregnancy_safe', reason: 'Foods like this are usually on the “skip or check first” list in pregnancy. Ask your OB or midwife if you’re unsure.' };
  }
  if (d.has('vegetarian') && (RX.meat.test(t) || RX.fish.test(t))) return clash('vegetarian');
  if (d.has('dairy_free') && RX.dairy.test(t.replace(PLANT, ' '))) return clash('dairy_free');
  if (d.has('gluten_free') && RX.gluten.test(t.replace(GF_OK, ' '))) return clash('gluten_free');
  if (d.has('low_histamine') && RX.lowHistamine.test(t.replace(LH_OK, ' '))) return { code: 'low_histamine', reason: 'It’s often a higher-histamine food, and you asked Forge to keep things low-histamine.' };
  return null;
}

// ---------- the numbers ----------
/** Clean food numbers for one serving, or null. */
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const kcal = Number(raw.kcal);
  if (!name || !Number.isFinite(kcal) || kcal < 0 || kcal > 5000) return null;
  const m = (x, hi) => Math.round(Math.min(hi, Math.max(0, num(x))) * 10) / 10;
  return { name, kcal: Math.round(kcal), protein_g: m(raw.protein_g, 500), carbs_g: m(raw.carbs_g, 500), fat_g: m(raw.fat_g, 500), serving: String(raw.serving || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) };
}

/** Today's numbers for the question; blanks are 0 / defaults. burned is null when we have nothing to show. */
export function cleanContext(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const n = (x, lo, hi, dflt) => { const v = Number(x); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; };
  return {
    eatenKcal: Math.round(n(c.eatenKcal, 0, 20000, 0)), eatenProtein: Math.round(n(c.eatenProtein, 0, 1000, 0)),
    eatenCarbs: Math.round(n(c.eatenCarbs, 0, 2000, 0)), eatenFat: Math.round(n(c.eatenFat, 0, 1000, 0)),
    ceiling: Math.round(n(c.ceiling, 800, 6000, DEFAULT_KCAL)), proteinGoal: Math.round(n(c.proteinGoal, 0, 400, 0)),
    burned: c.burned == null ? null : Math.round(n(c.burned, 0, 20000, 0)), hour: Math.floor(n(c.hour, 0, 23, 12)),
  };
}

/**
 * The rules-based answer for one serving. → {
 *   verdict: 'yes' | 'half' | 'better', headline, reason, better (a lighter idea or ''), factor (1 | 0.5 | 0 = what "Log it" would add),
 *   numbers: { kcal, protein_g, left, after, proteinLeft }, conflict: code | '' }.
 * The ceiling is the day's calorie goal; the day isn't over, so "left" is simply ceiling − eaten.
 */
export function judge(itemIn, ctxIn, prefsIn) {
  const item = cleanItem(itemIn);
  if (!item) return null;
  const ctx = cleanContext(ctxIn);
  const left = ctx.ceiling - ctx.eatenKcal;
  const half = item.kcal / 2;
  const proteinLeft = ctx.proteinGoal > 0 ? Math.max(0, ctx.proteinGoal - ctx.eatenProtein) : null;
  const numbers = { kcal: item.kcal, protein_g: item.protein_g, left, after: left - item.kcal, proteinLeft };
  const prot = item.protein_g > 0 ? ` It has ${fmt(item.protein_g)} g protein${proteinLeft != null ? (proteinLeft > 0 ? `, and you have ${fmt(proteinLeft)} g to go` : ', and you’ve already hit your protein goal') : ''}.` : '';
  const conflict = dietConflict(item.name, prefsIn);
  let verdict, reason, better = '', factor;
  if (conflict) {
    verdict = 'better'; factor = 0; reason = conflict.reason;
    better = 'Pick something that fits your food preferences. Your Plan tab has ideas.';
  } else if (item.kcal <= left) {
    verdict = 'yes'; factor = 1;
    reason = `${fmt(item.kcal)} kcal fits. You’d have ${fmt(left - item.kcal)} kcal left of your ${fmt(ctx.ceiling)} today.${prot}`;
    if (ctx.hour >= 21 && item.kcal >= 300) reason += ' It’s late, so a smaller bite may sit more comfortably.';
  } else if (half <= left) {
    verdict = 'half'; factor = 0.5;
    reason = `The whole thing is ${fmt(item.kcal)} kcal, which goes ${fmt(item.kcal - left)} over your ${fmt(ctx.ceiling)}. Half is ${fmt(half)} kcal and leaves ${fmt(left - half)}.${prot}`;
  } else {
    verdict = 'better'; factor = 0;
    reason = left > 0
      ? `Even half (${fmt(half)} kcal) is more than the ${fmt(left)} kcal you have left today.`
      : `You’re already at your ${fmt(ctx.ceiling)} kcal for today, so this would be extra.`;
    better = left >= 80 ? `Something around ${fmt(Math.floor(left / 10) * 10)} kcal or less would fit: a pear or apple, or a small protein snack.` : 'Water is a good choice. You can plan this in tomorrow.';
  }
  return { verdict, headline: HEADLINE[verdict], reason, better, factor, numbers, conflict: conflict ? conflict.code : '' };
}
