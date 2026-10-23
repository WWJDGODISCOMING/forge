// v0.16.58 (#187): the Body profile "Last week" marker. Synthetic readings only.
import { readFileSync } from 'node:fs';
import { test, eq, near, assert } from './harness.js';
import { bodyProfile } from '../js/health/bodyprofile.js';
import { bodyProfileHtml } from '../js/health/cards.js';

const doc = (day, fat, ffm) => ({ id: day, day, metrics: { weight_kg: fat + ffm, fat_mass_kg: fat, fat_free_mass_kg: ffm } });
const bp = (measures) => bodyProfile({ measures, heightM: 1.8, sex: 'male' });

test('Last week: picks the reading closest to 7 days back, inside 5 to 10 days', () => {
  const p = bp([doc('2026-10-12', 18, 62), doc('2026-10-15', 17, 63), doc('2026-10-17', 16.5, 63.5), doc('2026-10-23', 16, 64)]);
  // 10-15 is 8 days back and 10-17 is 6: both are 1 off 7, so the newer wins.
  eq(p.lastWeek.day, '2026-10-17');
  near(p.lastWeek.dLeanKg, 0.5, 1e-9);
  near(p.lastWeek.dFatKg, -0.5, 1e-9);
  eq(bp([doc('2026-10-14', 18, 62), doc('2026-10-16', 17, 63), doc('2026-10-23', 16, 64)]).lastWeek.day, '2026-10-16');
});

test('Last week: hidden with no reading 5 to 10 days back', () => {
  eq(bp([doc('2026-10-20', 17, 63), doc('2026-10-23', 16, 64)]).lastWeek, null); // 3 days
  eq(bp([doc('2026-10-10', 17, 63), doc('2026-10-23', 16, 64)]).lastWeek, null); // 13 days
  eq(bp([doc('2026-10-23', 16, 64)]).lastWeek, null);
  assert(bp([doc('2026-10-13', 17, 63), doc('2026-10-23', 16, 64)]).lastWeek, '10 days is still in');
  assert(bp([doc('2026-10-18', 17, 63), doc('2026-10-23', 16, 64)]).lastWeek, '5 days is still in');
});

test('Last week markup: marker, line, since-line in the user\'s unit, detail on tap', () => {
  const p = bp([doc('2026-10-16', 18, 62), doc('2026-10-23', 16, 64)]); // fat 5.56→4.94 FMI, ffm 19.1→19.75
  const html = bodyProfileHtml(p, { sex: 'male' }, 'metric');
  assert(html.includes('data-bp-last') && html.includes('>Last week<'), 'marker labelled');
  assert(html.includes('Since last week: lean mass <b>+2.0 kg</b>, fat <b>−2.0 kg</b>'), html);
  assert(html.includes('data-bp-detail') && /Last week, [A-Z][a-z]+\s\d+: lean mass 62\.0 kg, fat 18\.0 kg/.test(html), 'detail text');
  const lb = bodyProfileHtml(p, { sex: 'male' }, 'imperial');
  assert(lb.includes('+4.4 lb') && lb.includes('−4.4 lb'), lb);
  const none = bodyProfileHtml(bp([doc('2026-10-23', 16, 64)]), { sex: 'male' }, 'metric');
  assert(!none.includes('data-bp-last') && !none.includes('Since last week') && !none.includes('data-bp-arrow'), 'hidden');
});

test('Last week: same cell draws no line; the marker is offset so You stays visible', () => {
  const p = bp([doc('2026-10-16', 16, 64), doc('2026-10-23', 16.1, 64.1)]);
  eq(p.lastWeek.col, p.col);
  const html = bodyProfileHtml(p, { sex: 'male' }, 'metric');
  assert(html.includes('bp-last same') && !html.includes('data-bp-arrow'));
  assert(html.includes('class="bp-now"'), 'You dot still there');
});

test('Last week: tap haptic and Duo-safe styles', () => {
  const cards = readFileSync(new URL('../js/health/cards.js', import.meta.url), 'utf8');
  assert(cards.includes('haptics.light()'), 'light haptic on tap');
  const css = readFileSync(new URL('../css/health.css', import.meta.url), 'utf8');
  assert(/\.bp-last span[^}]*white-space: nowrap/.test(css) && /\.bp-gridbox \{[^}]*min-width: 0/.test(css));
});
