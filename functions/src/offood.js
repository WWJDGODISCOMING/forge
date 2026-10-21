// Open Food Facts for Log food: a barcode lookup and a brand/name search, for packaged items USDA misses (Costco
// and other store brands). Free, no key. The app only ever sees a small normalised list, in the same shape as
// usda.js rows. Nothing here logs the barcode or the query: the only logger is log.js and we hand it counts and
// durations. No network in tests: `fetch` is injected.
import { log } from './log.js';
import { FoodSearchError, meterSearch, tidyCase, shortBrand, createCache } from './usda.js';

export const OFF_BASE = 'https://world.openfoodfacts.org';
export const USER_AGENT = 'Forge/1.0 (personal fitness app; https://forge-web-f2351.web.app)'; // Open Food Facts asks every client to identify itself
export const FIELDS = 'code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments';
export const MAX_RESULTS = 20;
export const TIMEOUT_MS = 6000;
const sharedCache = createCache();

const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, hi) => Math.min(hi, Math.max(0, x));
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** { barcode } (8–14 digits) or { query } (2–60 characters). Throws FoodSearchError('invalid'). */
export function validateOffInput(data) {
  const d = data && typeof data === 'object' ? data : {};
  if (d.barcode !== undefined && d.barcode !== null) {
    const code = typeof d.barcode === 'string' ? d.barcode.replace(/\s+/g, '') : '';
    if (!/^\d{8,14}$/.test(code)) throw new FoodSearchError('invalid');
    return { barcode: code };
  }
  if (typeof d.query !== 'string') throw new FoodSearchError('invalid');
  const query = clean(d.query);
  if (query.length < 2 || query.length > 60) throw new FoodSearchError('invalid');
  return { query };
}

const n100 = (nu, key) => {
  const v = Number(nu && nu[`${key}_100g`]);
  return Number.isFinite(v) && nu[`${key}_100g`] !== null && nu[`${key}_100g`] !== '' ? v : null;
};

/** One Open Food Facts product → { code, name, brand, dataType, serving, measures: [], per100, perServing }, or null when it has no name or energy. */
export function normalizeProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const code = String(p.code || '');
  if (!/^\d{8,14}$/.test(code)) return null;
  let name = tidyCase(clean(p.product_name) || clean(p.generic_name));
  if (!name) return null;
  if (name.length > 70) name = `${name.slice(0, 69).trimEnd()}…`;
  const nu = p.nutriments;
  let kcal = n100(nu, 'energy-kcal');
  if (kcal === null) { const kj = n100(nu, 'energy'); if (kj !== null) kcal = kj / 4.184; }
  if (kcal === null) return null;
  const per100 = {
    kcal: Math.round(clamp(kcal, 900)),
    protein_g: r1(clamp(n100(nu, 'proteins') ?? 0, 100)),
    carbs_g: r1(clamp(n100(nu, 'carbohydrates') ?? 0, 100)),
    fat_g: r1(clamp(n100(nu, 'fat') ?? 0, 100)),
  };
  const sg = Number(p.serving_quantity);
  const real = Number.isFinite(sg) && sg > 0 && sg <= 2000;
  const label = clean(p.serving_size).slice(0, 30);
  const serving = real ? { g: r1(sg), text: label || `${Math.round(sg)} g`, real: true } : { g: 100, text: '100 g', real: false };
  const f = serving.g / 100;
  return {
    code, name, brand: shortBrand(clean(p.brands).split(',')[0]), dataType: 'Open Food Facts', serving, measures: [], per100,
    perServing: { kcal: Math.round(per100.kcal * f), protein_g: r1(per100.protein_g * f), carbs_g: r1(per100.carbs_g * f), fat_g: r1(per100.fat_g * f) },
  };
}

async function get({ fetch, url }) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 429) throw new FoodSearchError('busy');
  if (res.status === 404) return null;
  if (!res.ok) throw new FoodSearchError('down');
  return res.json();
}

/**
 * { barcode } → { found: boolean, food? }. { query } → { foods: [...up to 20] }. Counts against the same
 * 120-an-hour budget as foodSearch (cached answers are free).
 */
export async function lookupOff({ db, uid, data, fetch, now = () => Date.now(), cache = sharedCache }) {
  const input = validateOffInput(data);
  const t = now();
  const ck = input.barcode ? `b|${input.barcode}` : `q|${input.query.toLowerCase()}`;
  const hit = cache.get(ck, t);
  if (hit) { log('food_off', { status: 200, reason: 'cache' }); return hit; }
  const meter = await meterSearch({ db, uid, now: t });
  if (meter.limited) { log('food_off', { status: 429 }); throw new FoodSearchError('limited'); }
  let out;
  try {
    if (input.barcode) {
      const body = await get({ fetch, url: `${OFF_BASE}/api/v2/product/${input.barcode}.json?fields=${FIELDS}` });
      const food = body && body.status !== 0 ? normalizeProduct({ ...body.product, code: (body.product && body.product.code) || input.barcode }) : null;
      out = food ? { found: true, food } : { found: false };
    } else {
      const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(input.query)}&search_simple=1&action=process&json=1&page_size=${MAX_RESULTS * 2}&fields=${FIELDS}`;
      const body = await get({ fetch, url });
      const seen = new Set();
      const foods = (body && Array.isArray(body.products) ? body.products : []).map(normalizeProduct).filter((f) => {
        if (!f) return false;
        const k = `${f.name.toLowerCase()}|${f.brand.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, MAX_RESULTS);
      out = { foods };
    }
  } catch (e) {
    log('food_off', { status: e instanceof FoodSearchError && e.code === 'busy' ? 429 : 502 });
    throw e instanceof FoodSearchError ? e : new FoodSearchError('down');
  }
  cache.set(ck, out, t);
  log('food_off', { status: 200, ms: now() - t });
  return out;
}
