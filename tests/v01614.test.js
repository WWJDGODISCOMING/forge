// v0.16.14: Snap a meal reads packaged foods. Client side: new fields on rows and the "Find exact match" query. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { capQuery } from '../js/food/search.js';
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

test('matchQuery and capQuery keep the search within 60 characters at a word boundary', () => {
  const brand = 'B'.repeat(29) + ' ' + 'C'.repeat(30); // 60 chars
  eq(brand.length, 60);
  eq(matchQuery({ brand, product: 'Chewy Bar' }), brand);
  const product = Array.from({ length: 10 }, (_, i) => 'word' + i + 'xx').join(' '); // 79 chars
  const q = matchQuery({ brand: 'Nature', product: product + ' abc' });
  assert(q.length <= 60 && q.startsWith('Nature word0xx'));
  assert(!q.endsWith(' ') && product.startsWith(q.slice(7)));
  eq(capQuery('x'.repeat(80)).length, 60);
  eq(capQuery('short  name'), 'short name');
});

test('matchQuery only drops the brand when the product starts with the whole brand word', () => {
  eq(matchQuery({ brand: 'Kind', product: 'Kinder Bueno' }), 'Kind Kinder Bueno');
  eq(matchQuery({ brand: 'Kind', product: 'Kind Bar' }), 'Kind Bar');
});

test('the Find exact match chip names its food', () => {
  assert(src('js/screens/snap.js').includes('aria-label="Find exact match for ${esc(r.name)}"'));
  assert(/\.snap-match \{[^}]*white-space: nowrap/.test(src('css/food.css')));
});
