// v0.16.60 (#197): the You label is placed clear of the You dot, the Last week ring and pill, the arrow and the trail dots. Synthetic geometry only.
import { test, assert } from './harness.js';
import { bodyProfile } from '../js/health/bodyprofile.js';
import { bodyProfileHtml, bpPlace } from '../js/health/cards.js';

const doc = (day, fat, ffm) => ({ id: day, day, metrics: { weight_kg: fat + ffm, fat_mass_kg: fat, fat_free_mass_kg: ffm } });

test('You label is rendered in the overlay, above the Last week pill', () => {
  const p = bodyProfile({ measures: [doc('2026-10-23', 16, 64), doc('2026-10-16', 17, 63)], heightM: 1.8, sex: 'male' });
  const html = bodyProfileHtml(p, { sex: 'male', age: 30 });
  const over = html.slice(html.indexOf('class="bp-over"'));
  assert(/class="bp-you"[^>]*data-row="\d"[^>]*data-col="\d"/.test(over), 'You label inside the overlay');
});

const rectHit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const base = (over = {}) => ({
  box: { w: 240, h: 240 }, cell: { l: 60, t: 60, r: 120, b: 120 }, you: { x: 90, y: 90, r: 9, glow: 13 },
  ring: { x: 90, y: 74, r: 8 }, pill: { l: 62, r: 118, h: 14 }, label: { w: 22, h: 10 }, line: { x1: 90, y1: 80, x2: 90, y2: 76 }, trails: [], below: false, ...over,
});
const labelRect = (g, p) => ({ l: g.you.x + p.dx - g.label.w / 2, r: g.you.x + p.dx + g.label.w / 2, t: g.you.y + p.dy - g.label.h / 2, b: g.you.y + p.dy + g.label.h / 2 });
const pillRect = (g, p) => { const t = p.pill === 'above' ? g.ring.y - 10 - g.pill.h : g.ring.y + 10; return { l: g.pill.l, r: g.pill.r, t, b: t + g.pill.h }; };

test('You label avoids the pill when Last week sits in the same cell above the dot', () => {
  const g = base();
  const p = bpPlace(g);
  assert(p.clear, 'a clear spot exists');
  assert(!rectHit(labelRect(g, p), pillRect(g, p)), 'label clear of the pill');
  assert(!rectHit(labelRect(g, p), { l: 81, r: 99, t: 81, b: 99 }), 'label clear of the You dot');
  const r = labelRect(g, p);
  assert(r.l >= 61 && r.r <= 119 && r.t >= 61 && r.b <= 119, 'label inside the cell');
});

test('You label avoids the pill, ring and trail dots when Last week is in another cell', () => {
  const g = base({ ring: { x: 30, y: 30, r: 8 }, pill: { l: 8, r: 64, h: 14 }, line: { x1: 38, y1: 38, x2: 78, y2: 78 }, trails: [{ l: 92, t: 100, r: 100, b: 108 }], below: true });
  const p = bpPlace(g);
  const r = labelRect(g, p);
  assert(p.clear && !rectHit(r, pillRect(g, p)) && !rectHit(r, g.trails[0]), 'clear of pill and trail');
  assert(r.l >= 61 && r.r <= 119 && r.t >= 61 && r.b <= 119, 'inside the cell');
});

test('bpPlace flips the pill below the ring when above would leave the grid', () => {
  const g = base({ ring: { x: 90, y: 12, r: 8 }, pill: { l: 62, r: 118, h: 14 }, line: null });
  assert(bpPlace(g).pill === 'below', 'pill below');
});
