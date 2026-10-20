// v0.16.44: barcode lookup, brand-product fallback, Create food, favorites and recents first. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { cleanBarcode, lookupBarcode, searchBrand, shouldFallback, offItem, labelPrefill, localByBarcode } from '../js/food/off.js';
import { searchLocal } from '../js/food/search.js';
import { cleanFood, logFields } from '../js/food/core.js';
import { createFlow } from '../js/food/flow.js';

const ROW = {
  code: '0096619123456', name: 'Spicy Chicken Strips', brand: 'Just Bare', dataType: 'Open Food Facts', measures: [],
  serving: { g: 84, text: '3 oz (84 g)', real: true }, per100: { kcal: 119, protein_g: 20, carbs_g: 4.8, fat_g: 2.4 },
  perServing: { kcal: 100, protein_g: 16.8, carbs_g: 4, fat_g: 2 },
};
const online = () => true;

test('cleanBarcode: 8–14 digits, spaces and dashes ignored', () => {
  eq(cleanBarcode('0 96619 12345 6'), '0966191234 56'.replace(' ', ''));
  eq(cleanBarcode('12-345-678'), '12345678');
  for (const bad of ['', '1234567', '123456789012345', 'abcdefgh', null]) eq(cleanBarcode(bad), '');
});

test('barcode hit: not in my foods → Open Food Facts item that logs with the portion maths', async () => {
  const calls = [];
  const call = async (name, data) => { calls.push([name, data]); return { found: true, food: ROW }; };
  const r = await lookupBarcode('0096619123456', { foods: [], logs: [] }, { call, online });
  eq(r.state, 'off');
  eq(r.item.key, 'off:0096619123456');
  eq(r.item.food_id, 'off:0096619123456');
  eq(r.item.usda.serving.g, 84);
  eq(calls.length, 1);
  eq(calls[0][0], 'foodBarcode');
  const f = createFlow({ day: '2026-10-20', hour: 12 });
  f.select(r.item);
  const fields = f.commit();
  eq(fields.name, 'Spicy Chicken Strips');
  eq(fields.food_id, 'off:0096619123456');
});

test('barcode hit in my foods answers first and offline, without calling the server', async () => {
  let called = false;
  const call = async () => { called = true; return { found: false }; };
  const foods = [{ id: 'f1', name: 'Strips', kcal: 100, protein_g: 17, carbs_g: 4, fat_g: 2, serving: '3 oz', barcode: '0096619123456', deleted: false }];
  const r = await lookupBarcode('096619123456', { foods, logs: [] }, { call, online: () => false }); // UPC-A without the leading zero
  eq(r.state, 'local');
  eq(r.item.food_id, 'f1');
  assert(!called, 'no server call');
  const logs = [{ id: 'l1', food_id: 'off:0096619123456', name: 'Strips', kcal: 100, protein_g: 17, carbs_g: 4, fat_g: 2, created_at: '2026-10-19T10:00:00Z' }];
  eq(localByBarcode('0096619123456', { foods: [], logs }).kind, 'recent');
});

test('barcode miss leads to Create food with the barcode filled in; the saved food is found by the next scan', async () => {
  const call = async () => ({ found: false });
  const r = await lookupBarcode('0096619123456', { foods: [], logs: [] }, { call, online });
  eq(r.state, 'miss');
  eq(r.code, '0096619123456');
  const off = await lookupBarcode('0096619123456', { foods: [], logs: [] }, { call, online: () => false });
  eq(off.state, 'offline'); // offline and unknown also lead to Create food
  const saved = cleanFood({ name: 'Just Bare spicy strips', kcal: '100', protein_g: '17', carbs_g: '4', fat_g: '2', serving: '3 oz', barcode: r.code, favorite: true });
  assert(saved.ok);
  eq(saved.food.barcode, '0096619123456');
  eq(saved.food.favorite, true);
  const again = await lookupBarcode('0096619123456', { foods: [{ id: 'n1', deleted: false, ...saved.food }], logs: [] }, { call, online });
  eq(again.state, 'local');
  eq((await lookupBarcode('abc', {}, { call, online })).state, 'invalid');
});

test('server trouble on a barcode is "unavailable" (still leads to Create food), never a throw', async () => {
  const r = await lookupBarcode('0096619123456', {}, { call: async () => { throw new Error('down'); }, online });
  eq(r.state, 'unavailable');
});

test('fallback search: runs only when typed search missed, and maps rows to items', async () => {
  assert(shouldFallback({ query: 'just bare', localCount: 0, usda: { state: 'ok', items: [] } }));
  assert(shouldFallback({ query: 'just bare', localCount: 0, usda: { state: 'unavailable', items: [] } }));
  assert(!shouldFallback({ query: 'just bare', localCount: 2, usda: { state: 'ok', items: [] } }), 'my foods answered');
  assert(!shouldFallback({ query: 'just bare', localCount: 0, usda: { state: 'ok', items: [{}] } }), 'USDA answered');
  assert(!shouldFallback({ query: 'j', localCount: 0, usda: { state: 'ok', items: [] } }), 'too short');
  assert(!shouldFallback({ query: 'just bare', localCount: 0, usda: { state: 'offline', items: [] } }), 'offline: nothing to ask');
  let sent = null;
  const r = await searchBrand('just bare spicy chicken', { call: async (n, d) => { sent = d; return { foods: [ROW] }; }, online });
  eq(sent.query, 'just bare spicy chicken');
  eq(r.state, 'ok');
  eq(r.items[0].kind, 'off');
  eq(r.items[0].title, 'Spicy Chicken Strips');
  eq((await searchBrand('chips', { call: async () => ({ foods: [] }), online: () => false })).state, 'offline');
  eq((await searchBrand('chips', { call: async () => { throw new Error('x'); }, online })).state, 'unavailable');
});

test('offItem: same shape as a USDA item so the portion picker works', () => {
  const it = offItem(ROW);
  eq(it.kcal, 100);
  eq(it.brand, 'Just Bare');
  eq(it.serving, '3 oz (84 g)');
  eq(it.usda.per100.protein_g, 20);
  eq(logFields({ item: it, meal: 'lunch', day: '2026-10-20' }).food_id, 'off:0096619123456');
});

test('labelPrefill: one serving from a label photo, never the whole package', () => {
  const p = labelPrefill({ name: 'Strips', brand: 'Just Bare', kcal: 100, protein_g: 17, carbs_g: 4, fat_g: 2, portion: '3 oz', grams: 84, whole: true, servings_per_container: 5, source: 'label' });
  eq(p.kcal, 100);
  eq(p.serving, '3 oz');
  eq(p.name, 'Strips');
});

test('search: favorites, then foods logged lately, then the rest; OFF recents show without a My foods copy', () => {
  const foods = ['Apple chips', 'Apple pie', 'Apple sauce', 'Apple tea'].map((name, i) => ({ id: `f${i}`, name, kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, serving: '', deleted: false, ...(name === 'Apple tea' ? { favorite: true } : {}) }));
  const logs = [{ id: 'l1', food_id: 'f2', name: 'Apple sauce', kcal: 1, created_at: '2026-10-19T10:00:00Z', deleted: false },
    { id: 'l2', food_id: 'off:12345678', name: 'Apple jerky', kcal: 1, created_at: '2026-10-18T10:00:00Z', deleted: false }];
  const names = searchLocal('apple', { foods, logs }).map((i) => i.name);
  eq(names.slice(0, 3).join('|'), 'Apple tea|Apple sauce|Apple jerky');
  eq(searchLocal('', { foods, logs })[0].name, 'Apple tea');
});

test('wiring: scan button and Create food on Log food, labelled for VoiceOver, no motion', () => {
  const food = readFileSync(new URL('../js/screens/food.js', import.meta.url), 'utf8');
  assert(/data-scan-btn[^>]*aria-label="Scan a barcode"/.test(food), 'scan button label');
  assert(food.includes('Brand products') && food.includes('data-create'), 'brand section and create');
  const scan = readFileSync(new URL('../js/screens/food-scan.js', import.meta.url), 'utf8');
  assert(/aria-live="polite"/.test(scan) && scan.includes('Type the number'), 'typed fallback and live status');
  assert(!/animation|transition/.test(readFileSync(new URL('../css/food.css', import.meta.url), 'utf8').split('v0.16.44')[1] || ''), 'no motion in the new CSS');
});
