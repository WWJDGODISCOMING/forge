// Range-change morph for line charts (pure maths, no DOM). Chart paths are "M x,y L x,y …" with x ascending.
// Both lines are sampled on the union of their own vertex x-fractions, so a 7-day line can morph into a 90-day one
// and the morph starts exactly on the old polyline and lands exactly on the new one.

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

/** Each vertex's x as a fraction of its line's own span (0 for a single point). */
const fractions = (pts) => {
  const x0 = pts[0][0];
  const span = pts[pts.length - 1][0] - x0;
  return pts.map((p) => (span > 0 ? (p[0] - x0) / span : 0));
};

/** The line sampled at the given x-fractions of its own span (sorted ascending). */
export function resampleAt(pts, fracs) {
  if (!pts.length) return [];
  const x0 = pts[0][0];
  const span = pts[pts.length - 1][0] - x0;
  const out = [];
  let j = 0;
  for (const f of fracs) {
    const x = x0 + f * span;
    while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
    const a = pts[j];
    const b = pts[Math.min(j + 1, pts.length - 1)];
    const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
    out.push([x, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Parse and resample two chart paths once onto the merged vertex fractions. Null when either is empty. */
export function prepareMorph(from, to) {
  const pa = parsePath(from);
  const pb = parsePath(to);
  if (!pa.length || !pb.length) return null;
  const spanPx = Math.max(pa[pa.length - 1][0] - pa[0][0], pb[pb.length - 1][0] - pb[0][0], 1e-9);
  const eps = 0.05 / spanPx; // merge vertices closer than 0.05 px
  const all = [...fractions(pa), ...fractions(pb), 0, 1].sort((p, q) => p - q);
  const fr = [];
  for (const f of all) if (!fr.length || f - fr[fr.length - 1] > eps) fr.push(f);
  fr[fr.length - 1] = 1;
  return { a: resampleAt(pa, fr), b: resampleAt(pb, fr) };
}

/** Points at progress t (eased) of a prepareMorph result. */
export const morphFrame = (m, t) => lerpPoints(m.a, m.b, easeOut(t));

/** The line points at progress t (eased) between two chart paths. Null when either path is empty. */
export function morphPoints(from, to, t) {
  const m = prepareMorph(from, to);
  return m ? morphFrame(m, t) : null;
}

/** The path at progress t between two chart paths (strings). t >= 1 returns `to` untouched, so the final frame is exact. */
export function morphPath(from, to, t) {
  if (t >= 1) return to;
  const p = morphPoints(from, to, t);
  return p ? toPath(p) : to;
}
