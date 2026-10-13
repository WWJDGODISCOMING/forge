// v0.16.3: chart scrub label placement and haptic tick gating (pure).
import { test, eq, assert } from './harness.js';
import { labelPlace, tickGate } from '../js/ui/scrubmath.js';

const base = { w: 100, h: 22, minX: 4, maxX: 336, minY: 2 };

test('scrub label centres above the dot', () => {
  const r = labelPlace({ ...base, px: 170, py: 100 });
  eq(r.x, 120); eq(r.y, 68); eq(r.below, false);
});
test('scrub label clamps at the left and right edges', () => {
  eq(labelPlace({ ...base, px: 10, py: 100 }).x, 4);
  eq(labelPlace({ ...base, px: 335, py: 100 }).x, 236);
});
test('scrub label flips below the dot when there is no room above', () => {
  const r = labelPlace({ ...base, px: 170, py: 20 });
  eq(r.below, true); eq(r.y, 30);
});
test('tick fires only on a new point and at most every 35 ms', () => {
  const g = tickGate(35);
  eq(g(3, 0), true);
  eq(g(3, 10), false); // same point
  eq(g(4, 20), false); // too soon
  eq(g(4, 200), false); // 4 was already visited
  eq(g(5, 205), true);
  eq(g(6, 250), true);
  assert(g(5, 400) === true, 'going back to a different point ticks again');
});
