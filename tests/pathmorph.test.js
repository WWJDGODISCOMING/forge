// v0.16.4: chart range-morph maths (pure).
import { test, eq as strict, assert } from './harness.js';
import { parsePath, toPath, resample, lerpPoints, morphPath, morphPoints, areaPath, easeOut } from '../js/ui/pathmorph.js';

const eq = (a, b) => strict(JSON.stringify(a), JSON.stringify(b));

test('parsePath and toPath round-trip a chart path', () => {
  const d = 'M44.0,100.5 L120.0,90.0 L200.5,80.2';
  eq(parsePath(d).length, 3);
  eq(toPath(parsePath(d)), d);
});
test('resample keeps the ends and interpolates y by x', () => {
  const r = resample([[0, 0], [10, 100]], 5);
  eq(r.length, 5); eq(r[0], [0, 0]); eq(r[4], [10, 100]); eq(r[2], [5, 50]);
});
test('resample of one point is a flat line', () => {
  const r = resample([[5, 7]], 4);
  eq(r.length, 4); assert(r.every((p) => p[0] === 5 && p[1] === 7));
});
test('lerpPoints blends 0 → a and 1 → b', () => {
  const a = [[0, 0], [10, 10]]; const b = [[0, 20], [10, 30]];
  eq(lerpPoints(a, b, 0), a); eq(lerpPoints(a, b, 1), b); eq(lerpPoints(a, b, 0.5), [[0, 10], [10, 20]]);
});
test('morphPath ends exactly on the target string, starts on the source shape', () => {
  const from = 'M0.0,0.0 L10.0,10.0'; const to = 'M0.0,20.0 L5.0,25.0 L10.0,40.0';
  eq(morphPath(from, to, 1), to);
  const s = parsePath(morphPath(from, to, 0));
  eq(s[0], [0, 0]); eq(s[s.length - 1], [10, 10]);
  const mid = parsePath(morphPath(from, to, 0.5));
  assert(mid[0][1] > 0 && mid[0][1] < 20);
});
test('morphPath falls back to the target when a path is empty', () => {
  eq(morphPath('', 'M0.0,1.0 L2.0,3.0', 0.5), 'M0.0,1.0 L2.0,3.0');
});
test('areaPath closes down to the baseline', () => {
  eq(areaPath([[0, 5], [10, 6]], 50), 'M0.0,5.0 L10.0,6.0 L10.0,50.0 L0.0,50.0 Z');
});
test('easeOut runs 0 → 1 and clamps', () => {
  eq(easeOut(0), 0); eq(easeOut(1), 1); eq(easeOut(2), 1); assert(easeOut(0.5) > 0.5);
});

// Largest vertical gap between a polyline `pts` and the true path `path`, probed on pts' own x.
const yAt = (path, x) => {
  const q = parsePath(path);
  let j = 0;
  while (j < q.length - 2 && q[j + 1][0] < x) j++;
  const a = q[j]; const b = q[Math.min(j + 1, q.length - 1)];
  const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
  return a[1] + (b[1] - a[1]) * t;
};
const gap = (pts, path) => Math.max(...pts.map((p) => Math.abs(p[1] - yAt(path, p[0]))));
const wiggly = toPath(Array.from({ length: 366 }, (_, i) => [44 + (i * 286) / 365, 100 + 60 * Math.sin(i / 3) + 20 * Math.cos(i * 1.7)]));
const short = toPath(Array.from({ length: 8 }, (_, i) => [44 + i * 40.8, 80 + ((i * 37) % 50)]));
for (const [name, a, b] of [['366 → 8', wiggly, short], ['8 → 366', short, wiggly]]) {
  test(`morph ${name} starts on the old line and lands on the new one`, () => {
    assert(gap(morphPoints(a, b, 0), a) <= 0.1, 'start gap');
    assert(gap(morphPoints(a, b, 0.999), b) <= 0.5, 'end gap');
    eq(morphPath(a, b, 1), b);
  });
}
