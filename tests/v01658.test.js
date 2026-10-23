// v0.16.58 (#187): the Body profile "Last week" marker. Synthetic readings only.
import { readFileSync } from 'node:fs';
import { test, eq, near, assert } from './harness.js';
import { bodyProfile, markPositions, bandFraction, LINE_MIN } from '../js/health/bodyprofile.js';
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
  assert(html.includes('Since last week: <span class="nw">lean mass <b>+2.0 kg</b></span>, <span class="nw">fat <b>−2.0 kg</b></span>'), html);
  assert(html.includes('data-bp-detail') && /Last week, [A-Z][a-z]+\s\d+: lean mass 62\.0 kg, fat 18\.0 kg\.</.test(html) && !html.includes('FMI 4.9,'), 'detail text, no indices');
  const lb = bodyProfileHtml(p, { sex: 'male' }, 'imperial');
  assert(lb.includes('+4.4 lb') && lb.includes('−4.4 lb'), lb);
  const none = bodyProfileHtml(bp([doc('2026-10-23', 16, 64)]), { sex: 'male' }, 'metric');
  assert(!none.includes('data-bp-last') && !none.includes('Since last week') && !none.includes('data-bp-arrow'), 'hidden');
});

test('Positions sit inside the cell and move with FFMI and FMI', () => {
  const a = bp([doc('2026-10-23', 16, 64)]);
  const b = bp([doc('2026-10-23', 16, 65)]);   // more lean mass, same cell
  const c = bp([doc('2026-10-23', 15, 64)]);   // less fat
  eq(a.col, b.col); eq(a.row, c.row);
  assert(b.x > a.x && c.y > a.y, 'more lean moves right, less fat moves down');
  for (const p of [a, b, c]) assert(p.x > p.col && p.x < p.col + 1 && p.y > 3 - p.row && p.y < 4 - p.row, 'inside its cell');
  eq(bandFraction(0, [17, 19, 21], 0), 0);
  eq(bandFraction(99, [17, 19, 21], 3), 1);
  near(bandFraction(18, [17, 19, 21], 1), 0.5, 1e-9);
});

test('Last week: a move inside one cell still draws the line, and the ring stays clear of You', () => {
  const p = bp([doc('2026-10-16', 17.5, 62.5), doc('2026-10-23', 16.3, 63.7)]);
  eq(p.lastWeek.col, p.col); eq(p.lastWeek.row, p.row);
  const m = markPositions(p);
  assert(m.line, 'line for a within-cell move');
  assert(Math.hypot(m.last.x - m.you.x, m.last.y - m.you.y) >= 0.4, 'ring kept well apart from You');
  const html = bodyProfileHtml(p, { sex: 'male' }, 'metric');
  assert(html.includes('data-bp-arrow') && html.includes('class="bp-now"') && html.includes('data-bp-last'));
  assert(html.includes('Last week: lean mass') && html.includes('aria-label="You:'), 'grid label has last week too');
});

test('Last week: about the same spot draws no line but both dots show', () => {
  const p = bp([doc('2026-10-16', 16, 64), doc('2026-10-23', 16, 64.01)]);
  const m = markPositions(p);
  assert(Math.hypot(p.lastWeek.x - p.x, p.lastWeek.y - p.y) < LINE_MIN);
  assert(!m.line && m.last, 'no line');
  assert(Math.hypot(m.last.x - m.you.x, m.last.y - m.you.y) >= 0.4, 'ring still visible beside You');
  const html = bodyProfileHtml(p, { sex: 'male' }, 'metric');
  assert(!html.includes('data-bp-arrow') && html.includes('data-bp-last') && html.includes('class="bp-now"'));
});

test('Last week: tap haptic and Duo-safe styles', () => {
  const cards = readFileSync(new URL('../js/health/cards.js', import.meta.url), 'utf8');
  assert(cards.includes('haptics.light()'), 'light haptic on tap');
  const css = readFileSync(new URL('../css/health.css', import.meta.url), 'utf8');
  assert(/\.bp-last span[^}]*white-space: nowrap/.test(css) && /\[data-bp-since\] \.nw/.test(css) && /\.bp-gridbox \{[^}]*min-width: 0/.test(css));
});
