// "Short on protein?" helper for the Food tab. Pure functions (tests/food.test.js): no DOM, no network, no AI.
// Picks a few high-protein, low-calorie ideas that fit the calories left under today's target. Your own foods and
// recent entries win over the built-in list. Per-serving numbers are rounded USDA-style estimates.

/** Built-in ideas. `match` words find the same food in My foods / recents. */
export const IDEAS = [
  { id: 'chicken', name: 'Chicken breast', portion: '4 oz cooked (113 g)', kcal: 187, protein_g: 35, match: ['chicken', 'breast'], tip: 'Lean and filling.' },
  { id: 'tuna', name: 'Tuna, canned in water', portion: '1 can drained (113 g)', kcal: 120, protein_g: 26, match: ['tuna'], tip: 'No cooking needed.' },
  { id: 'yogurt', name: 'Greek yogurt, nonfat', portion: '3/4 cup (170 g)', kcal: 100, protein_g: 17, match: ['greek', 'yogurt'], tip: 'Easy snack.' },
  { id: 'cottage', name: 'Cottage cheese, low-fat', portion: '1/2 cup (113 g)', kcal: 90, protein_g: 12, match: ['cottage'], tip: 'Slow-digesting protein.' },
  { id: 'eggs', name: 'Eggs', portion: '2 large', kcal: 143, protein_g: 13, match: ['egg'], tip: 'Quick and cheap.' },
  { id: 'whey', name: 'Protein shake', portion: '1 scoop', kcal: 120, protein_g: 24, match: ['protein', 'shake'], tip: 'Handy when you can’t cook.' },
  { id: 'beef', name: 'Lean ground beef (95%)', portion: '4 oz raw (113 g)', kcal: 150, protein_g: 22, match: ['ground', 'beef'], tip: 'Also has iron.' },
  { id: 'collagen', name: 'Collagen peptides', portion: '2 scoops (20 g)', kcal: 70, protein_g: 18, match: ['collagen'], tip: 'Collagen is an incomplete protein, so pair it with other protein.' },
];

export const MIN_LEFT_KCAL = 90; // below this nothing useful fits, so the card hides
export const MIN_SHORT_G = 10; // protein still to go before the card is worth showing
export const AFTERNOON_HOUR = 16;
export const MAX_IDEAS = 4;

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const density = (it) => num(it.protein_g) / Math.max(1, num(it.kcal)); // grams of protein per kcal

/**
 * What is left today: { protein, kcal } or null when there is no protein target. `kcal` is null with no calorie target.
 * `eaten` is { kcal, protein_g } from dayTotals.
 */
export function remaining(targets, eaten) {
  const p = targets && targets.proteinG;
  if (!(p > 0)) return null;
  const c = targets.calories;
  return { protein: Math.round(p - num(eaten && eaten.protein_g)), kcal: c > 0 ? Math.round(c - num(eaten && eaten.kcal)) : null, target: p };
}

/**
 * Should the card show? Only today. Protein still to go (at least MIN_SHORT_G), and either it is afternoon,
 * or at least a quarter of the target is left from midday on. `hour` is 0–23, fractions allowed.
 */
export function shouldShow({ isToday, hour, left }) {
  if (!isToday || !left) return false;
  if (left.protein < MIN_SHORT_G) return false;
  if (left.kcal != null && left.kcal < MIN_LEFT_KCAL) return false;
  return hour >= AFTERNOON_HOUR || (hour >= 12 && left.protein > left.target * 0.25);
}

/**
 * Up to MAX_IDEAS items for the card: [{ key, name, kcal, protein_g, portion, mine, tip? }].
 * Each must fit the calories left. Foods of yours (My foods or recents) with a high protein share come first,
 * then the built-in ideas, best protein per calorie first. A built-in idea you already have is shown with your numbers.
 */
export function suggest({ left, items = [] }) {
  if (!left) return [];
  const fits = (it) => num(it.kcal) >= 40 && num(it.protein_g) >= 8 && (left.kcal == null || it.kcal <= left.kcal);
  const lean = (it) => density(it) >= 0.075; // 30% of calories from protein or more
  const seen = new Set();
  const mine = [];
  for (const it of items) { // `items` = My foods then recents, already built by search.js
    const n = norm(it.name);
    if (!n || seen.has(n) || !fits(it) || !lean(it)) continue;
    seen.add(n);
    mine.push({ key: `mine:${it.key}`, name: it.name, kcal: Math.round(it.kcal), protein_g: Math.round(it.protein_g), portion: it.serving || '', mine: true, item: it });
  }
  const own = new Set(mine.map((m) => norm(m.name)));
  const mineByIdea = (idea) => mine.some((m) => idea.match.every((w) => norm(m.name).includes(w)));
  const built = IDEAS.filter((i) => fits(i) && !mineByIdea(i) && !own.has(norm(i.name)))
    .sort((a, b) => density(b) - density(a))
    .map((i) => ({ key: `idea:${i.id}`, name: i.name, kcal: i.kcal, protein_g: i.protein_g, portion: i.portion, mine: false, tip: i.tip, id: i.id }));
  mine.sort((a, b) => density(b) - density(a));
  const out = [...mine.slice(0, 2), ...built].slice(0, MAX_IDEAS);
  // A short list of yours leaves room for more of the built-in ones.
  return out.length >= MAX_IDEAS ? out : [...out, ...mine.slice(2).filter((m) => !out.includes(m))].slice(0, MAX_IDEAS);
}

/** The item handed to logFields for one tap. */
export function logItem(s) {
  if (s.item) return { ...s.item, portion: s.item.serving || s.item.portion || '' };
  return { name: s.name, kcal: s.kcal, protein_g: s.protein_g, carbs_g: 0, fat_g: 0, portion: s.portion };
}

/** Day key the card was dismissed for (per phone), or null. */
export const dismissKey = (uid) => `forge.proteinHelper.${uid || ''}`;
