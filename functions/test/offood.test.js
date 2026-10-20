// Open Food Facts lookups, no network: node --test test/
// Fixtures have the field names the real API returns; the numbers are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.js';
import { setSink } from '../src/log.js';
import { validateOffInput, normalizeProduct, lookupOff } from '../src/offood.js';
import { createCache, FoodSearchError } from '../src/usda.js';

setSink(() => {});
const STRIPS = {
  code: '0096619123456', product_name: 'Spicy Chicken Strips', brands: 'Just Bare, Costco', serving_size: '3 oz (84 g)', serving_quantity: 84,
  nutriments: { 'energy-kcal_100g': 119, proteins_100g: 20, carbohydrates_100g: 4.8, fat_100g: 2.4 },
};
const reply = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

test('validateOffInput: barcodes are 8–14 digits, queries 2–60 characters', () => {
  assert.deepEqual(validateOffInput({ barcode: ' 0096619 123456 ' }), { barcode: '0096619123456' });
  for (const bad of [{ barcode: '123' }, { barcode: 12345678 }, { barcode: 'abcdefgh' }, { query: 'a' }, { query: 'x'.repeat(61) }, {}, null]) {
    assert.throws(() => validateOffInput(bad), FoodSearchError);
  }
});

test('normalizeProduct: per-100 g numbers, the printed serving, a short brand; kJ-only energy is converted; no energy → null', () => {
  const f = normalizeProduct(STRIPS);
  assert.equal(f.name, 'Spicy Chicken Strips');
  assert.equal(f.brand, 'Just Bare');
  assert.deepEqual(f.serving, { g: 84, text: '3 oz (84 g)', real: true });
  assert.equal(f.perServing.kcal, 100);
  assert.equal(f.perServing.protein_g, 16.8);
  const kj = normalizeProduct({ code: '12345678', product_name: 'Thing', nutriments: { energy_100g: 418.4 } });
  assert.equal(kj.per100.kcal, 100);
  assert.deepEqual(kj.serving, { g: 100, text: '100 g', real: false });
  assert.equal(normalizeProduct({ code: '12345678', product_name: 'No numbers', nutriments: {} }), null);
  assert.equal(normalizeProduct({ code: 'x', product_name: 'Bad code', nutriments: { 'energy-kcal_100g': 1 } }), null);
});

test('barcode hit returns the food; a miss says found: false', async () => {
  const db = fakeDb();
  const hit = await lookupOff({ db, uid: 'u', data: { barcode: '0096619123456' }, fetch: reply({ status: 1, product: STRIPS }), cache: createCache() });
  assert.equal(hit.found, true);
  assert.equal(hit.food.code, '0096619123456');
  const miss = await lookupOff({ db, uid: 'u', data: { barcode: '99999999' }, fetch: reply({ status: 0 }), cache: createCache() });
  assert.deepEqual(miss, { found: false });
  const gone = await lookupOff({ db, uid: 'u', data: { barcode: '88888888' }, fetch: reply({}, 404), cache: createCache() });
  assert.equal(gone.found, false);
});

test('brand search keeps usable rows, drops repeats, and a second identical search is served from the cache', async () => {
  const db = fakeDb();
  let calls = 0;
  const fetch = async (url, opts) => {
    calls++;
    assert.match(String(opts.headers['User-Agent']), /Forge/);
    assert.match(url, /search_terms=just%20bare/);
    return { ok: true, status: 200, json: async () => ({ products: [STRIPS, { ...STRIPS, code: '0096619000001' }, { code: '12345678', product_name: 'Nothing' }] }) };
  };
  const cache = createCache();
  const r = await lookupOff({ db, uid: 'u', data: { query: 'just bare' }, fetch, cache });
  assert.equal(r.foods.length, 1);
  await lookupOff({ db, uid: 'u', data: { query: 'Just Bare' }, fetch, cache });
  assert.equal(calls, 1);
});

test('upstream trouble maps to busy / down', async () => {
  const db = fakeDb();
  await assert.rejects(lookupOff({ db, uid: 'u', data: { query: 'chips' }, fetch: reply({}, 429), cache: createCache() }), (e) => e.code === 'busy');
  await assert.rejects(lookupOff({ db, uid: 'u', data: { query: 'chips' }, fetch: reply({}, 503), cache: createCache() }), (e) => e.code === 'down');
  await assert.rejects(lookupOff({ db, uid: 'u', data: { query: 'chips' }, fetch: async () => { throw new Error('net'); }, cache: createCache() }), (e) => e.code === 'down');
});
