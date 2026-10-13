// Range-change morph for line charts (pure maths, no DOM). Chart paths are "M x,y L x,y …" with x ascending.
// Both lines are resampled onto the same N x-fractions, so a 7-day line can morph into a 90-day one.

/** "M1,2 L3,4" → [[1,2],[3,4]] */
export function parsePath(d) {
  const out = [];
  const re = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(d || ''))) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

/** [[x,y],…] → "M…L…" at one decimal, like the chart's own paths. */
export function toPath(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

/** n points evenly spaced in x along the polyline (linear in y). A single point becomes a flat line. */
export function resample(pts, n = 48) {
  if (!pts.length) return [];
  const x0 = pts[0][0];
  const x1 = pts[pts.length - 1][0];
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? x0 : x0 + ((x1 - x0) * i) / (n - 1);
    while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
    const a = pts[j];
    const b = pts[Math.min(j + 1, pts.length - 1)];
    const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
    out.push([x, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Point-by-point blend of two equal-length resampled lines; t 0 → a, 1 → b. */
export function lerpPoints(a, b, t) {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
}

/** Ease-out cubic. */
export const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Closed area path under a line down to baseY. */
export function areaPath(pts, baseY) {
  if (!pts.length) return '';
  return `${toPath(pts)} L${pts[pts.length - 1][0].toFixed(1)},${baseY.toFixed(1)} L${pts[0][0].toFixed(1)},${baseY.toFixed(1)} Z`;
}

/** The line points at progress t (eased) between two chart paths. Null when either path is empty. */
export function morphPoints(from, to, t, n = 48) {
  const a = resample(parsePath(from), n);
  const b = resample(parsePath(to), n);
  if (!a.length || a.length !== b.length) return null;
  return lerpPoints(a, b, easeOut(t));
}

/** The path at progress t between two chart paths (strings). t >= 1 returns `to` untouched, so the final frame is exact. */
export function morphPath(from, to, t, n = 48) {
  if (t >= 1) return to;
  const p = morphPoints(from, to, t, n);
  return p ? toPath(p) : to;
}
