// v0.16.14: Snap a meal reads packaged foods. Client side: new fields on rows and the "Find exact match" query. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { snapRows, matchQuery, isUnsure } from '../js/food/snap.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BAR = { name: 'Cookies n creme bar', portion: '1 bar', grams: 36, kcal: 150, protein_g: 3, carbs_g: 25, fat_g: 4, confidence: 0.8, brand: 'CLIF Kid', product: 'Zbar Cookies n Creme', net_weight_g: 36, source: 'label' };

test('snapRows keeps brand, product and source when present, and stays the same without them', () => {
  const [r] = snapRows([BAR]);
  eq(r.brand, 'CLIF Kid'); eq(r.product, 'Zbar Cookies n Creme'); eq(r.source, 'label');
  const [plain] = snapRows([{ name: 'Rice', kcal: 200 }]);
  assert(!('brand' in plain) && !('product' in plain) && !('source' in plain));
  eq(snapRows([{ name: 'X', source: 'bogus' }])[0].source, undefined);
});

test('matchQuery builds "brand product" only when both were read', () => {
  eq(matchQuery({ brand: 'CLIF Kid', product: 'Zbar Cookies n Creme' }), 'CLIF Kid Zbar Cookies n Creme');
  eq(matchQuery({ brand: 'Oreo', product: 'Oreo Thins' }), 'Oreo Thins');
  eq(matchQuery({ brand: 'CLIF Kid' }), '');
  eq(matchQuery({ product: 'Bar' }), '');
  eq(matchQuery(null), '');
});

test('a flagged item shows as unsure and carries its reason', () => {
  const [r] = snapRows([{ ...BAR, confidence: 0.4, note: 'Calories looked too high for the weight, so they were lowered.' }]);
  assert(isUnsure(r));
  assert(r.note.includes('too high'));
});

test('the result sheet wires Find exact match and the From label tag', () => {
  const s = src('js/screens/snap.js');
  assert(s.includes('data-match') && s.includes('Find exact match') && s.includes('From label'));
  assert(!/api[_-]?key|XAI/i.test(s));
});
