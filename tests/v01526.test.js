// v0.15.26: Snap a meal. A stubbed model (a fake `call`), synthetic foods only, plus the offline/error paths and wiring.
import { readFileSync } from 'node:fs';
import { test, eq, near, assert } from './harness.js';
import { snapRows, rowMacros, totalsOfRows, stepRow, removeRow, isUnsure, swapRow, mealFields, fitSize, prepareImage, estimateMeal, MAX_SIDE } from '../js/food/snap.js';
import { usdaItem } from '../js/food/portion.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FOODS = [
  { name: 'Grilled chicken', portion: '5 oz', grams: 140, kcal: 230, protein_g: 43, carbs_g: 0, fat_g: 5, confidence: 0.8 },
  { name: 'White rice', portion: '1 cup', grams: 158, kcal: 205, protein_g: 4.2, carbs_g: 44.5, fat_g: 0.4, confidence: 0.3 },
  { name: 'Broccoli', portion: '1 cup', grams: 90, kcal: 31, protein_g: 2.5, carbs_g: 6, fat_g: 0.3, confidence: 0.9 },
];
const CHICKEN = usdaItem({
  fdcId: 171477, name: 'Chicken breast, roasted', brand: '', dataType: 'SR Legacy',
  per100: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 }, perServing: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  serving: { g: 100, text: '100 g', real: false }, measures: [],
});
const rejects = async (p) => { try { await p; } catch (e) { return e; } return null; };

test('snapRows: foods become rows at one serving, junk is dropped', () => {
  const rows = snapRows([...FOODS, null, { kcal: 5 }]);
  eq(rows.length, 3);
  eq(rows[0].qty, 1);
  eq(rows[0].portion, '5 oz');
  eq(snapRows(undefined).length, 0);
  eq(snapRows([{ name: 'X', kcal: 'lots' }])[0].kcal, 0);
});

test('portion stepper scales calories and macros, and totals add up', () => {
  let rows = snapRows(FOODS);
  eq(totalsOfRows(rows).kcal, 466);
  rows = rows.map((r) => (r.id === 's0' ? stepRow(r, 1) : r)); // 1 → 1.5
  eq(rows[0].qty, 1.5);
  eq(rowMacros(rows[0]).kcal, 345);
  near(rowMacros(rows[0]).protein_g, 64.5, 1e-9);
  eq(totalsOfRows(rows).kcal, 581);
  eq(stepRow(stepRow({ ...rows[1], qty: 0.25 }, -1), -1).qty, 0.25, 'never below a quarter');
});

test('remove drops a row; low confidence is flagged', () => {
  const rows = snapRows(FOODS);
  eq(removeRow(rows, 's1').map((r) => r.name).join(), 'Grilled chicken,Broccoli');
  eq(rows.map(isUnsure).join(), 'false,true,false');
});

test('swap with a USDA match keeps the photo weight and resets the stepper', () => {
  const rows = snapRows(FOODS);
  const swapped = swapRow({ ...rows[0], qty: 2 }, CHICKEN);
  eq(swapped.kind, 'usda');
  eq(swapped.food_id, 'usda:171477');
  eq(swapped.qty, 1);
  eq(swapped.kcal, 462); // 165 kcal per 100 g × (2 × 140 g)
  assert(/280 g/.test(swapped.portion), swapped.portion);
  const one = swapRow(rows[0], CHICKEN);
  eq(one.kcal, 231); // 165 kcal per 100 g × 140 g
  near(one.protein_g, 43.4, 1e-9);
  assert(/140 g/.test(one.portion), one.portion);
  const noWeight = swapRow({ ...rows[0], grams: 0 }, CHICKEN);
  eq(noWeight.kcal, 165, 'no weight guess: one serving');
  eq(swapRow({ ...rows[0], grams: 0, qty: 2 }, CHICKEN).kcal, 330, 'no weight guess: qty carries over as servings');
});

test('mealFields: one entry per food with the meal, day and servings; empty rows skipped', () => {
  let rows = snapRows(FOODS);
  rows = rows.map((r) => (r.id === 's0' ? stepRow(r, 1) : r));
  rows.push({ id: 'z', name: 'Water', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, portion: '', qty: 1, confidence: 1 });
  const f = mealFields(rows, { meal: 'dinner', day: '2026-10-12' });
  eq(f.length, 3);
  eq(f[0].meal, 'dinner');
  eq(f[0].day, '2026-10-12');
  eq(f[0].kcal, 230);
  eq(f[0].servings, 1.5);
  eq(f[0].portion, '5 oz');
  const swapped = mealFields([swapRow(rows[0], CHICKEN)], { meal: 'lunch', day: '2026-10-12' })[0];
  eq(swapped.food_id, 'usda:171477');
});

test('fitSize shrinks the long side and never enlarges', () => {
  eq(JSON.stringify(fitSize(4032, 3024)), JSON.stringify({ w: MAX_SIDE, h: 768 }));
  eq(JSON.stringify(fitSize(3024, 4032)), JSON.stringify({ w: 768, h: MAX_SIDE }));
  eq(JSON.stringify(fitSize(500, 400)), JSON.stringify({ w: 500, h: 400 }));
  eq(fitSize(0, 10).w, 0);
});

test('prepareImage: shrinks via the decoder/encoder it is given; unreadable files say so plainly', async () => {
  let seen = null;
  const out = await prepareImage({}, { decode: async () => ({ width: 4000, height: 2000 }), encode: async (img, w, h) => { seen = [w, h]; return 'QUJD'; } });
  eq(out, 'QUJD');
  eq(seen.join('x'), '1024x512');
  const e1 = await rejects(prepareImage({}, { decode: async () => { throw new Error('heic'); } }));
  assert(e1 && /couldn’t be opened/.test(e1.message), 'decode failure');
  const e2 = await rejects(prepareImage({}, { decode: async () => ({ width: 0, height: 0 }), encode: async () => 'x' }));
  assert(e2, 'empty image');
});

test('estimateMeal: stubbed model answer → rows; sends the photo only to snapMealPhoto', async () => {
  const calls = [];
  const rows = await estimateMeal('QUJD', async (name, data, opts) => { calls.push([name, data, opts]); return { foods: FOODS }; });
  eq(rows.length, 3);
  eq(calls[0][0], 'snapMealPhoto');
  eq(calls[0][1].image, 'QUJD');
  assert(calls[0][2].timeout >= 60000, 'long enough for a vision model');
});

test('estimateMeal: offline, server errors and an empty answer reach the screen as plain sentences', async () => {
  const offline = await rejects(estimateMeal('x', async () => { throw new Error('You’re offline. Try again when you have a connection.'); }));
  assert(/offline/.test(offline.message));
  const none = await rejects(estimateMeal('x', async () => ({ foods: [] })));
  assert(/couldn’t spot any food/.test(none.message));
  const bad = await rejects(estimateMeal('x', async () => ({})));
  assert(bad, 'missing foods');
});

test('functions.js passes the server’s own photo messages through (invalid-argument, resource-exhausted, unavailable)', () => {
  const f = src('js/functions.js');
  for (const c of ['invalid-argument', 'resource-exhausted', 'unavailable', 'failed-precondition']) assert(f.includes(`'${c}'`), c);
});

test('wiring: Take photo beside search, quick-log row, honest wording, service worker, no photo storage', () => {
  const food = src('js/screens/food.js');
  const sheetSrc = food.slice(food.indexOf('export function openLogFood'));
  assert(sheetSrc.indexOf('data-snap-btn') > sheetSrc.indexOf('name="q"'), 'camera button follows the search field');
  assert(/type="file" accept="image\/\*"/.test(sheetSrc), 'camera or library');
  const snap = src('js/screens/snap.js');
  assert(snap.includes('Looking at your plate') && snap.includes('data-snap-error') && snap.includes('Log meal'), 'analyzing, error and Log meal');
  assert(src('js/food/snap.js').includes('Estimate, check portions'));
  assert(src('js/ui/quicklog.js').includes('snapMeal'), 'quick-log runs it');
  const sw = src('sw.js');
  assert(sw.includes('./js/food/snap.js') && sw.includes('./js/screens/snap.js'), 'cached for offline');
  assert(!/localStorage|indexedDB|put\('photos'/.test(snap + src('js/food/snap.js')), 'the photo is not saved by the app');
});
