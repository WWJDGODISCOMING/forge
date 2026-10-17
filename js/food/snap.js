// Snap a meal: the pure part. A photo goes to the snapMealPhoto function, which sends back a short list of foods
// with the numbers for the portion it can see. Here those become editable rows (portion stepper, swap for a USDA
// food, remove) and finally food_logs fields. No DOM, no Firestore, tested (tests/v01526.test.js).
// Every row keeps the estimate as ONE serving (`portion`, e.g. "5 oz") and a `qty` multiplier, so the logged entry
// reads "1½ × 5 oz" like any other food and editing it later works the same way.
import { logFields, stepServings } from './core.js';
import { capQuery } from './search.js';
import { macrosFor, portionItem, MAX_GRAMS } from './portion.js';

export const MAX_SIDE = 1024; // the longest side the photo is shrunk to before it leaves the phone
export const JPEG_QUALITY = 0.8;
export const LOW_CONFIDENCE = 0.5;
export const ESTIMATE_NOTE = 'Estimate, check portions';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** The server's foods → editable rows. */
export function snapRows(foods) {
  return (Array.isArray(foods) ? foods : []).filter((f) => f && f.name).map((f, i) => ({
    id: `s${i}`, kind: 'photo', name: String(f.name).slice(0, 80), portion: String(f.portion || '').slice(0, 40), grams: num(f.grams),
    kcal: num(f.kcal), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g), fat_g: num(f.fat_g),
    confidence: num(f.confidence), qty: 1,
    ...(f.brand ? { brand: String(f.brand).slice(0, 60) } : {}), ...(f.product ? { product: String(f.product).slice(0, 80) } : {}),
    ...(f.source === 'label' || f.source === 'estimate' ? { source: f.source } : {}),
    ...(f.note ? { note: String(f.note).slice(0, 120) } : {}),
  }));
}

/** "brand product" for the USDA search, or '' when the label wasn't read. Not repeated if the product already starts with the brand; at most 60 characters (what the USDA search accepts). */
export function matchQuery(r) {
  const brand = String((r && r.brand) || '').trim();
  const product = String((r && r.product) || '').trim();
  if (!brand || !product) return '';
  const b = brand.toLowerCase(), p = product.toLowerCase();
  const has = p === b || p.startsWith(`${b} `); // whole words only: brand "Kind" is not in "Kinder Bueno"
  return capQuery(has ? product : `${brand} ${product}`);
}

/** Calories and macros for a row at its current portion. */
export function rowMacros(r) {
  const q = num(r.qty) || 1;
  return { kcal: Math.round(r.kcal * q), protein_g: Math.round(r.protein_g * q * 10) / 10, carbs_g: Math.round(r.carbs_g * q * 10) / 10, fat_g: Math.round(r.fat_g * q * 10) / 10 };
}

export function totalsOfRows(rows) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const r of rows) { const m = rowMacros(r); t.kcal += m.kcal; t.protein_g += m.protein_g; t.carbs_g += m.carbs_g; t.fat_g += m.fat_g; }
  return { kcal: t.kcal, protein_g: Math.round(t.protein_g), carbs_g: Math.round(t.carbs_g), fat_g: Math.round(t.fat_g) };
}

export const stepRow = (r, dir) => ({ ...r, qty: stepServings(r.qty, dir) });
export const removeRow = (rows, id) => rows.filter((r) => r.id !== id);

/** "Not sure" for a shaky guess, so the row asks for a second look. */
export const isUnsure = (r) => r.kind === 'photo' && r.confidence < LOW_CONFIDENCE;

/**
 * Swap a row for a USDA match (an item from usdaItem). The USDA numbers are used for the weight the row has
 * now (grams × portion steps, if the photo had a weight), else for that many servings. The portion stepper starts again at 1.
 */
export function swapRow(r, usda) {
  const q = num(r.qty) > 0 ? r.qty : 1;
  const g = r.grams > 0 ? Math.min(MAX_GRAMS, Math.round(r.grams * q * 10) / 10) : 0; // the portion the user dialled in
  const it = g ? portionItem(usda, { mode: 'weight', unit: 'g', grams: g }) : portionItem(usda, { mode: 'servings', servings: q });
  return {
    id: r.id, kind: 'usda', name: usda.name, brand: usda.brand || '', portion: it.portion, grams: g, kcal: it.kcal, protein_g: it.protein_g,
    carbs_g: it.carbs_g, fat_g: it.fat_g, confidence: 1, qty: 1, food_id: usda.food_id,
  };
}

/** food_logs fields for every row (rows with no calories are skipped). One entry per food, same meal and day. */
export function mealFields(rows, { meal, day }) {
  return rows.filter((r) => r.kcal > 0 || r.protein_g > 0).map((r) => logFields({
    item: { name: r.name, kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, portion: r.portion, brand: r.brand, food_id: r.food_id },
    servings: r.qty, meal, day,
  }));
}

/** Size to draw a photo at: longest side at most MAX_SIDE, never enlarged. */
export function fitSize(w, h, max = MAX_SIDE) {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Photo (File/Blob) → base64 JPEG (no data: prefix), shrunk on this phone. `deps` lets tests stand in for the browser.
 * Throws an Error with a friendly message when the picture can't be read.
 */
export async function prepareImage(file, deps = {}) {
  const decode = deps.decode || (async (f) => {
    if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(f); } catch { /* fall through to <img> */ } }
    const url = URL.createObjectURL(f);
    try {
      return await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = url; });
    } finally { URL.revokeObjectURL(url); }
  });
  const encode = deps.encode || (async (img, w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
  });
  let img;
  try { img = await decode(file); } catch { throw new Error('That photo couldn’t be opened. Try another one.'); }
  const { w, h } = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!w) throw new Error('That photo couldn’t be opened. Try another one.');
  const out = await encode(img, w, h);
  if (!out) throw new Error('That photo couldn’t be opened. Try another one.');
  return out;
}

/** The small grey bracket under a failure, e.g. "[503 · xAI 403: bad key]". Empty when the server gave no upstream note. */
export function upstreamTag(err) {
  const note = err && typeof err.upstream === 'string' ? err.upstream.trim().slice(0, 140) : '';
  if (!note) return '';
  const http = { unavailable: '503', 'resource-exhausted': '429', internal: '500' }[err.code];
  return `[${http ? `${http} · ` : ''}${note}]`;
}

/** Ask the server. `call` is js/functions.js call (injected for tests). Resolves to rows; rejects with a friendly message. */
export async function estimateMeal(b64, call) {
  const res = await call('snapMealPhoto', { image: b64, mime: 'image/jpeg' }, { timeout: 65000 });
  const rows = snapRows(res && res.foods);
  if (!rows.length) throw Object.assign(new Error('I couldn’t spot any food in that photo. Try again closer, or search for it.'), { code: 'failed-precondition' });
  return rows;
}
