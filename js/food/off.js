// Packaged foods that USDA misses (store brands like Costco's): a barcode scan and a brand search through Open Food
// Facts, which the foodBarcode Cloud Function calls for us (free, no key). Pure where it can be, so it is unit
// tested; `call` is injected (js/functions.js in the app).
//
// A barcode is looked up in this order: a food you saved with that barcode (works offline), a food you logged
// before, then Open Food Facts. A miss leads to Create food with the barcode filled in.
import { usdaItem } from './portion.js';
import { unitMacros, portionText } from './snap.js';
import { capQuery } from './search.js';

/** The digits of a scanned or typed barcode when it is 8–14 digits long, else ''. */
export function cleanBarcode(text) {
  const t = String(text == null ? '' : text).replace(/[\s-]+/g, '');
  return /^\d{8,14}$/.test(t) ? t : '';
}

/** UPC-A (12) and EAN-13 (13) differ only by a leading zero: compare without it. */
const same = (a, b) => a === b || a.replace(/^0+/, '') === b.replace(/^0+/, '');

/** An Open Food Facts row from the server → a Log food item (same shape as a USDA item so the portion picker works). */
export function offItem(row) {
  const it = usdaItem({ ...row, fdcId: row.code });
  return { ...it, key: `off:${row.code}`, kind: 'off', food_id: `off:${row.code}`, barcode: row.code };
}

/** My foods with this barcode as a Log food item, or null. */
export function localByBarcode(code, { foods = [], logs = [] } = {}) {
  const f = foods.find((x) => x && !x.deleted && x.barcode && same(String(x.barcode), code));
  if (f) {
    return {
      key: `mine:${f.id}`, kind: 'mine', name: f.name, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g,
      serving: f.serving || '', food_id: f.id,
    };
  }
  // Something you logged from a scan before: it has no portion maths left, so it comes back as one logged serving.
  const l = logs.filter((x) => x && !x.deleted && x.food_id && String(x.food_id).startsWith('off:') && same(String(x.food_id).slice(4), code))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
  if (l) {
    return {
      key: `recent:f:${l.food_id}`, kind: 'recent', name: l.name, kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g, fat_g: l.fat_g,
      serving: l.portion || '', ...(l.brand ? { brand: l.brand } : {}), food_id: l.food_id,
    };
  }
  return null;
}

/**
 * Barcode → { state: 'local' | 'off' | 'miss' | 'offline' | 'unavailable' | 'invalid', item?, code, message? }.
 * 'miss' (and 'offline' / 'unavailable', which can't tell) lead to Create food with the barcode filled in.
 */
export async function lookupBarcode(text, ctx = {}, { call, online = () => (typeof navigator === 'undefined' || navigator.onLine !== false) } = {}) {
  const code = cleanBarcode(text);
  if (!code) return { state: 'invalid', code: '' };
  const mine = localByBarcode(code, ctx);
  if (mine) return { state: 'local', item: mine, code };
  if (!online()) return { state: 'offline', code };
  try {
    const res = await call('foodBarcode', { barcode: code }, { timeout: 12000 });
    if (res && res.found && res.food) return { state: 'off', item: offItem(res.food), code };
    return { state: 'miss', code };
  } catch (e) {
    return { state: 'unavailable', code, message: e && e.message ? e.message : '' };
  }
}

/** Brand and name search through Open Food Facts → { state: 'ok' | 'offline' | 'unavailable', items }. */
export async function searchBrand(query, { call, online = () => (typeof navigator === 'undefined' || navigator.onLine !== false) } = {}) {
  const q = capQuery(query);
  if (q.length < 2) return { state: 'ok', items: [] };
  if (!online()) return { state: 'offline', items: [] };
  try {
    const res = await call('foodBarcode', { query: q }, { timeout: 12000 });
    return { state: 'ok', items: (res && Array.isArray(res.foods) ? res.foods : []).map(offItem) };
  } catch (e) {
    return { state: 'unavailable', items: [], message: e && e.code === 'resource-exhausted' && e.message ? e.message : '' };
  }
}

/** Should the brand search run by itself? Only when typed search missed: nothing from you and nothing from USDA. */
export function shouldFallback({ query, localCount, usda }) {
  if (String(query || '').trim().length < 2 || localCount > 0) return false;
  return !usda || usda.state === 'unavailable' || usda.state === 'limited' || (usda.state === 'ok' && !(usda.items || []).length);
}

/** A label-photo estimate (a snapRows row) → the Create food form's starting values, per ONE serving. */
export function labelPrefill(row) {
  const m = unitMacros({ ...row, whole: false });
  const name = String(row.product || row.name || '').slice(0, 80);
  return {
    name, serving: portionText({ ...row, whole: false }).slice(0, 40),
    kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g,
  };
}
