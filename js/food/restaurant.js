// Restaurant meal builder (v0.16.49): pure logic, no DOM. A chain file (data/restaurants/<id>.json) lists items in
// groups. Picking an item sets a quantity: groups with `half: true` (build-your-own components) go 0.5 → 1 → 1.5…,
// the others count whole items. Totals are summed at full precision and rounded once, so ten half portions never
// drift from the printed numbers.
export const CHAIN_IDS = ['chipotle', 'chick-fil-a', 'panera', 'subway', 'starbucks', 'mcdonalds', 'taco-bell', 'wendys', 'cava', 'sweetgreen'];
export const MAX_QTY = 6;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isUrl = (s) => /^https:\/\/[^\s/]+\.[^\s]+$/.test(String(s || ''));
const r1 = (n) => Math.round(n * 10) / 10;

/** Problems with a chain file, as plain strings. Empty = valid. */
export function validateChain(c) {
  const bad = [];
  if (!c || typeof c !== 'object') return ['not an object'];
  if (!c.id || !c.name) bad.push('needs id and name');
  if (!isUrl(c.source)) bad.push('needs an https source URL');
  if (!isDate(c.retrieved)) bad.push('needs a retrieved date (YYYY-MM-DD)');
  if (!Number.isInteger(c.version) || c.version < 1) bad.push('needs an integer version');
  if (!Array.isArray(c.groups) || !c.groups.length) bad.push('needs groups');
  if (!Array.isArray(c.items) || !c.items.length) bad.push('needs items');
  const groups = new Set((c.groups || []).map((g) => g.id));
  const seen = new Set();
  for (const it of c.items || []) {
    if (!it.id || !it.name) bad.push('item needs id and name');
    if (seen.has(it.id)) bad.push(`duplicate item ${it.id}`);
    seen.add(it.id);
    if (!groups.has(it.group)) bad.push(`${it.id}: unknown group ${it.group}`);
    for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g']) if (!isNum(it[k])) bad.push(`${it.id}: ${k} must be a number`);
  }
  return bad;
}

/** The next quantity when you tap + or − on an item: half-capable groups move by 0.5, others by 1. 0 = removed. */
export function stepQty(qty, dir, half) {
  const step = half ? 0.5 : 1;
  const n = Math.round(((qty || 0) + dir * step) * 100) / 100;
  return Math.min(MAX_QTY, Math.max(0, n));
}

/** Totals for a selection ({ itemId: qty }). Calories are whole numbers, macros one decimal. */
export function totalsFor(chain, sel) {
  const by = new Map(chain.items.map((i) => [i.id, i]));
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const [id, q] of Object.entries(sel)) {
    const it = by.get(id);
    if (!it || !(q > 0)) continue;
    t.kcal += it.kcal * q; t.protein_g += it.protein_g * q; t.carbs_g += it.carbs_g * q; t.fat_g += it.fat_g * q;
  }
  return { kcal: Math.round(t.kcal), protein_g: r1(t.protein_g), carbs_g: r1(t.carbs_g), fat_g: r1(t.fat_g) };
}

/** Picked items in menu order: [{ item, qty }]. */
export function picked(chain, sel) {
  return chain.items.filter((i) => sel[i.id] > 0).map((item) => ({ item, qty: sel[item.id] }));
}

export const qtyLabel = (q) => (q === 0.5 ? 'Half' : q === 1 ? '' : q % 1 === 0.5 ? `${Math.floor(q)}½×` : `${q}×`);

/** One-line summary of the order, used in the saved meal's portion text (max 40 letters for logs). */
export function orderSummary(chain, sel) {
  const n = picked(chain, sel).length;
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/** Fields for a My foods record (the order saved as one favorite food, per serving = the whole order). */
export function favoriteFood(chain, sel, name) {
  const t = totalsFor(chain, sel);
  return { name: String(name || '').trim() || `${chain.name} order`, serving: orderSummary(chain, sel), ...t, favorite: true };
}
