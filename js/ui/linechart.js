// A small SVG chart for body metrics: dots for readings, a 7-day rolling line, an optional dashed line for
// the previous period (shifted onto this one) and optional bars underneath (training sets per week).
// Same classes as the weight chart (grid, axis, dot, trend), so it themes the same. Pure markup.
import { daysBetween, addDays } from '../weight/smoothing.js';
import { formatDay } from '../ui.js';
import { scrubLayer } from './scrub.js';
import { axisNeedsYear, dotStyle } from './chartmath.js';
import { parsePath, toPath, areaPath, prepareMorph, morphFrame } from './pathmorph.js';

/** Rolling mean over the previous `n` days for each point (by calendar day, not by count). */
export function rolling(points, n = 7) {
  return points.map((p) => {
    const from = addDays(p.day, -(n - 1));
    const xs = points.filter((q) => q.day >= from && q.day <= p.day).map((q) => q.v);
    return { day: p.day, v: xs.reduce((a, b) => a + b, 0) / xs.length };
  });
}

/**
 * Round tick values covering [min, max]: steps of 1, 2, 2.5 or 5 × 10^k, about `count` of them.
 * Returns { ticks, step, decimals } — decimals is what the step needs (0.5 → 1, 0.25 → 2, 5 → 0).
 */
export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [], step: 1, decimals: 0 };
  if (max - min < 1e-9) { min -= 0.5; max += 0.5; }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw - 1e-12) || 10 * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (String(Number((step / mag).toFixed(6))).includes('.') ? 1 : 0));
  return { ticks, step, decimals };
}

/** The unit a formatter puts after its number ("lb", "%", "bpm"), or '' for plain scores. */
export const unitOf = (fmt) => {
  const u = String(fmt(1)).replace(/^[^\d]*[\d.,]+\s*/, '').trim();
  return /\d/.test(u) ? '' : u; // "0 h 01 min", "5 ft 3 in": no single unit to show
};

/** An axis number: grouped thousands, the tick step's decimals. */
export const axisLabel = (v, decimals) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * points: [{ day, v, t? }] in display units, oldest first (t: the value as text for the tap readout, e.g. "151.2 lb").
 * prev: same shape, already shifted onto this range. bars: [{ day, value }] (training sets per week; own scale along
 * the bottom third, its top labelled). unit: shown above the axis ("lb", "%"). barUnit: label for the bar scale.
 * The SVG carries data-scrub with the points' positions, for bindScrub().
 */
export function lineChartSVG(points, { prev = [], bars = [], fmt = null, unit = '', barUnit = 'sets', label = 'Chart', width = 340, height = 210, fromDay = null, toDay = null } = {}) {
  if (!points.length) return '';
  const start = fromDay || points[0].day;
  const end = toDay || points[points.length - 1].day;
  const vals = [...points.map((p) => p.v), ...prev.map((p) => p.v)];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const pad = Math.max(Math.abs(max) * 0.01, (max - min) * 0.1, 0.1);
  const nt = niceTicks(min - pad, max + pad, 4);
  min = nt.ticks[0];
  max = nt.ticks[nt.ticks.length - 1];
  // Left gutter fits the widest tick label at the largest axis size (13.75 units, about 7.7 per digit), never under 44.
  const widest = Math.max(...nt.ticks.map((v) => String(fmt ? fmt(v) : axisLabel(v, nt.decimals)).length));
  const L = Math.max(44, Math.ceil(widest * 7.7) + 8), R = 10, T = unit ? 20 : 12, B = 26;
  const span = Math.max(1, daysBetween(start, end));
  const x = (day) => L + (daysBetween(start, day) / span) * (width - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (height - T - B);
  const ticks = nt.ticks.map((v) => `<line x1="${L}" x2="${width - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="axis" text-anchor="end">${fmt ? fmt(v) : axisLabel(v, nt.decimals)}</text>`).join('');
  const shownBars = bars.filter((b) => b.day >= start && b.day <= end);
  const maxBar = Math.max(1, ...shownBars.map((b) => b.value));
  const barH = (height - T - B) * 0.33;
  const barW = Math.max(3, ((width - L - R) / span) * 5);
  const barEls = shownBars.map((b) => {
    const h = (b.value / maxBar) * barH;
    return `<rect x="${(x(b.day) - barW / 2).toFixed(1)}" y="${(height - B - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" class="bar" rx="2"/>`;
  }).join('');
  const barScale = shownBars.length ? `<line x1="${L}" x2="${width - R}" y1="${(height - B - barH).toFixed(1)}" y2="${(height - B - barH).toFixed(1)}" class="bar-top"/><text x="${width - R}" y="${(height - B - barH - 3).toFixed(1)}" class="axis bar-label" text-anchor="end">${maxBar} ${barUnit}</text>` : '';
  const path = (ps) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const line = rolling(points);
  const ds = dotStyle(points.length, 2.4);
  const dots = points.map((p) => `<circle cx="${x(p.day).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${ds.r}" class="dot${ds.dense ? ' dense' : ''}"/>`).join('');
  const yr = axisNeedsYear(start, end) ? { year: 'numeric', month: 'short', day: 'numeric' } : undefined;
  const avgText = (v) => `${axisLabel(v, nt.decimals + 1)}${unit ? ` ${unit}` : ''}`;
  const scrub = points.map((p, i) => [Number(x(p.day).toFixed(1)), Number(y(p.v).toFixed(1)), p.day, p.t != null ? String(p.t) : axisLabel(p.v, nt.decimals + 1), `7-day avg ${avgText(line[i].v)}`]);
  const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<svg viewBox="0 0 ${width} ${height}" class="chart${chartWait()}" role="img" aria-label="${attr(label)}" data-scrub="${attr(JSON.stringify(scrub))}">
    ${unit ? `<text x="${L - 6}" y="10" class="axis unit" text-anchor="end">${attr(unit)}</text>` : ''}
    ${ticks}${barScale}${barEls}
    ${prev.length > 1 ? `<path d="${path(rolling(prev))}" class="prev"/>` : ''}
    ${line.length > 1 ? areaFill(path(line), x(line[0].day).toFixed(1), x(line[line.length - 1].day).toFixed(1), (height - B).toFixed(1)) : ''}
    ${dots}<path d="${path(line)}" class="trend" pathLength="1"/>
    ${scrubLayer(T, height - B)}
    <text x="${L}" y="${height - 6}" class="axis">${formatDay(start, yr)}</text>
    <text x="${width - R}" y="${height - 6}" class="axis" text-anchor="end">${formatDay(end, yr)}</text>
  </svg>`;
}

export { bindScrub, scrubBar, scrubLayer, nearestIndex, backToLatestHtml, bindBackToLatest } from './scrub.js';

/** Class that holds the draw-in until the screen has landed. Set once at mount, so timing never changes mid-animation; range/unit taps have no view transition and start at once. */
export function chartWait() {
  const vt = typeof document !== 'undefined' ? document.documentElement?.dataset?.vt : '';
  return vt ? (vt === 'push' || vt === 'pop' ? ' chart-wait-push' : ' chart-wait') : '';
}

/** Unique per chart instance, so two charts on one screen never share a gradient. */
let gradSeq = 0;

/** Soft accent → transparent fill under a line (`line` is an "M…L…" path), with its own gradient id. */
export function areaFill(line, firstX, lastX, baseY) {
  const id = `ar${++gradSeq}`;
  // The clip rect grows left → right with the draw-in (CSS), so the fill never shows ahead of the line.
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="area-a" stop-opacity=".3"/><stop offset="1" class="area-a" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}c"><rect class="area-clip" x="${(Number(firstX) - 1).toFixed(1)}" y="0" width="${(Number(lastX) - Number(firstX) + 2).toFixed(1)}" height="${(Number(baseY) + 1).toFixed(1)}"/></clipPath></defs>
    <path d="${line} L${lastX},${baseY} L${firstX},${baseY} Z" fill="url(#${id})" class="area" clip-path="url(#${id}c)"/>`;
}

/** The chart's current trend and fill paths, to morph from after a re-render. Null when there's no chart. */
export function grabChart(root) {
  const svg = root && root.querySelector('svg.chart');
  const trend = svg && svg.querySelector('.trend[pathLength]');
  const area = svg && svg.querySelector('.area');
  return trend ? { trend: trend.getAttribute('d'), area: area ? area.getAttribute('d') : null } : null;
}

let morphRaf = 0;

/**
 * Glide a freshly rendered chart's line and fill from the `from` paths (grabChart) to its own, ~450 ms ease-out.
 * Only `d` changes; the final frame restores the exact rendered strings. No-op under reduced motion.
 */
export function morphChart(svg, from, ms = 450) {
  cancelAnimationFrame(morphRaf);
  const trend = svg && svg.querySelector('.trend[pathLength]');
  if (!trend || !from || !from.trend || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const area = svg.querySelector('.area');
  const toLine = trend.getAttribute('d');
  const toArea = area && area.getAttribute('d');
  const baseY = toArea ? parsePath(toArea).slice(-2)[0][1] : 0;
  const prep = prepareMorph(from.trend, toLine);
  if (!prep) return;
  svg.classList.add('chart-morph'); // no draw-in on top of the morph
  if (area) area.removeAttribute('clip-path'); // the morphing fill spans old → new extents
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    if (t >= 1) { trend.setAttribute('d', toLine); if (area) area.setAttribute('d', toArea); return; }
    const pts = morphFrame(prep, t);
    trend.setAttribute('d', toPath(pts));
    if (area && toArea) area.setAttribute('d', areaPath(pts, baseY));
    morphRaf = requestAnimationFrame(step);
  };
  morphRaf = requestAnimationFrame(step);
}

