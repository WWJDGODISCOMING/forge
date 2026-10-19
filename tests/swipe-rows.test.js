import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { swipeAxis, inEdgeZone, swipeTravel, pastLong, swipeRelease } from '../js/ui/swipemath.js';
import { createPendingDelete } from '../js/ui/pendingdelete.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('swipeAxis: waits for the slop, then picks the bigger direction', () => {
  assert(swipeAxis(5, 3) === null);
  assert(swipeAxis(-14, 4) === 'h');
  assert(swipeAxis(4, 14) === 'v');
  assert(swipeAxis(-11, 11) === 'v'); // a tie goes to scrolling
});

test('inEdgeZone: swipe-back owns the left edge', () => {
  assert(inEdgeZone(10) && !inEdgeZone(60));
});

test('swipeTravel: follows the finger 1:1, clamps to the row, resists pulling right', () => {
  assert(swipeTravel(0, -50, 350) === 50);
  assert(swipeTravel(88, -20, 350) === 108);
  assert(swipeTravel(88, 30, 350) === 58);
  assert(swipeTravel(0, -999, 350) === 350);
  const r = swipeTravel(0, 100, 350);
  assert(r < 0 && r > -40, String(r));
});

test('swipeRelease: thresholds and flicks', () => {
  const o = { width: 350, openW: 88 };
  assert(swipeRelease({ ...o, travel: 20, velocity: 0 }) === 'closed');
  assert(swipeRelease({ ...o, travel: 60, velocity: 0 }) === 'open');
  assert(swipeRelease({ ...o, travel: 20, velocity: -0.8 }) === 'open');
  assert(swipeRelease({ ...o, travel: 88, velocity: 0.8 }) === 'closed');
  assert(swipeRelease({ ...o, travel: 260, velocity: 0 }) === 'delete');
  assert(swipeRelease({ ...o, travel: 260, velocity: 0.8 }) === 'delete');
  assert(pastLong(250, 350) && !pastLong(200, 350));
});

test('pending delete: Undo cancels the write', () => {
  const calls = []; let fire;
  const p = createPendingDelete({ commit: (id) => calls.push(id), setT: (f) => { fire = f; return 1; }, clearT: () => { fire = null; } });
  p.queue('a');
  assert(p.has('a'));
  assert(p.undo('a') === true);
  assert(fire === null && calls.length === 0 && p.undo('a') === false);
});

test('pending delete: the timer writes it once', () => {
  const calls = []; let fire;
  const p = createPendingDelete({ commit: (id) => calls.push(id), setT: (f) => { fire = f; return 1; }, clearT: () => {} });
  p.queue('a'); fire();
  assert(calls.join() === 'a' && !p.has('a'));
});

test('pending delete: flush (hidden / navigating) writes now; a second delete writes the first', () => {
  const calls = [];
  const p = createPendingDelete({ commit: (id) => calls.push(id), setT: () => 1, clearT: () => {} });
  p.queue('a'); p.queue('b');
  assert(calls.join() === 'a', calls.join());
  p.flush();
  assert(calls.join() === 'a,b' && p.size === 0);
});

test('swipe rows are wired to food and weigh-ins, keeping the existing delete paths', () => {
  const food = src('js/screens/food.js');
  assert(food.includes('bindSwipeRows') && food.includes('createPendingDelete'));
  assert(/visibilitychange/.test(food) && /hashchange/.test(food), 'flushes when hidden or leaving');
  assert(food.includes('Removed ') && food.includes("label: 'Undo'"));
  assert(food.includes('data-del'), 'sheet delete stays');
  const w = src('js/screens/weight.js');
  assert(w.includes('bindSwipeRows') && w.includes('confirmSheet') && w.includes("tombstone('body_measures'") && w.includes('data-del'));
  const row = src('js/ui/swiperow.js');
  assert(row.includes('haptics.select') && row.includes('haptics.warning') && row.includes('reducedMotion'));
  assert(row.includes('swipeAxis') && row.includes('velocityOf') && row.includes('animateSpring'));
});
