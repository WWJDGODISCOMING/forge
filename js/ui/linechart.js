// A small SVG chart for body metrics: dots for readings, a 7-day rolling line, an optional dashed line for
// the previous period (shifted onto this one) and optional bars underneath (training sets per week).
// Same classes as the weight chart (grid, axis, dot, trend), so it themes the same. Pure markup.
import { daysBetween, addDays } from '../weight/smoothing.js';
import { formatDay } from '../ui.js';
import { tick } from './haptic.js';
import { labelPlace, tickGate } from './scrubmath.js';
import { parsePath, toPath, areaPath, morphPoints } from './pathmorph.js';

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
  const L = 44, R = 10, T = unit ? 20 : 12, B = 26;
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
  const dots = points.map((p) => `<circle cx="${x(p.day).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.4" class="dot"/>`).join('');
  const scrub = points.map((p) => [Number(x(p.day).toFixed(1)), Number(y(p.v).toFixed(1)), p.day, p.t != null ? String(p.t) : axisLabel(p.v, nt.decimals + 1)]);
  const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<svg viewBox="0 0 ${width} ${height}" class="chart${chartWait()}" role="img" aria-label="${attr(label)}" data-scrub="${attr(JSON.stringify(scrub))}">
    ${unit ? `<text x="${L - 6}" y="10" class="axis unit" text-anchor="end">${attr(unit)}</text>` : ''}
    ${ticks}${barScale}${barEls}
    ${prev.length > 1 ? `<path d="${path(rolling(prev))}" class="prev"/>` : ''}
    ${line.length > 1 ? areaFill(path(line), x(line[0].day).toFixed(1), x(line[line.length - 1].day).toFixed(1), (height - B).toFixed(1)) : ''}
    <path d="${path(line)}" class="trend" pathLength="1"/>${dots}
    <g class="scrub" visibility="hidden"><line y1="${T}" y2="${height - B}" class="scrub-line"/><circle r="4.5" class="scrub-dot"/></g>
    <g class="scrub-pill" opacity="0" pointer-events="none"><rect rx="9" height="22"/><text y="15" text-anchor="middle"/></g>
    <text x="${L}" y="${height - 6}" class="axis">${formatDay(start)}</text>
    <text x="${width - R}" y="${height - 6}" class="axis" text-anchor="end">${formatDay(end)}</text>
  </svg>`;
}

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
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="area-a" stop-opacity=".3"/><stop offset="1" class="area-a" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${lastX},${baseY} L${firstX},${baseY} Z" fill="url(#${id})" class="area"/>`;
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
  svg.classList.add('chart-morph'); // no draw-in on top of the morph
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    if (t >= 1) { trend.setAttribute('d', toLine); if (area) area.setAttribute('d', toArea); return; }
    const pts = morphPoints(from.trend, toLine, t);
    if (!pts) { trend.setAttribute('d', toLine); return; }
    trend.setAttribute('d', toPath(pts));
    if (area && toArea) area.setAttribute('d', areaPath(pts, baseY));
    morphRaf = requestAnimationFrame(step);
  };
  morphRaf = requestAnimationFrame(step);
}

/** Index of the point nearest to x (points sorted by x). Pure. */
export function nearestIndex(xs, x) {
  if (!xs.length) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid; else hi = mid; }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}

/**
 * Touch or drag across a chart to read a value: a line and dot on the nearest reading, and its date and value in
 * `readout`. Lifting the finger keeps the last one shown; a tap outside the chart clears it. Returns an unbind.
 */
export function bindScrub(svg, readout, { dayText = (d) => formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' }) } = {}) {
  if (!svg || !svg.dataset.scrub) return () => {};
  let pts;
  try { pts = JSON.parse(svg.dataset.scrub); } catch { return () => {}; }
  if (!pts.length) return () => {};
  const xs = pts.map((p) => p[0]);
  const g = svg.querySelector('.scrub');
  const ln = g && g.querySelector('line');
  const dot = g && g.querySelector('circle');
  const idle = readout ? readout.textContent : '';
  const pill = svg.querySelector('.scrub-pill');
  const pillBox = pill && pill.querySelector('rect');
  const pillText = pill && pill.querySelector('text');
  const gate = tickGate(35);
  const vbW = svg.viewBox.baseVal.width;
  // The floating label lives inside the SVG, so showing it never reflows the card.
  const place = (px, py, label) => {
    pillText.textContent = label;
    const tw = pillText.getComputedTextLength ? pillText.getComputedTextLength() : 0;
    const w = Math.min((tw || label.length * 6.5) + 18, vbW - 8);
    const { x, y } = labelPlace({ px, py, w, h: 22, minX: 4, maxX: vbW - 4, minY: 2 });
    pillBox.setAttribute('x', x.toFixed(1)); pillBox.setAttribute('y', y.toFixed(1)); pillBox.setAttribute('width', w.toFixed(1));
    pillText.setAttribute('x', (x + w / 2).toFixed(1)); pillText.setAttribute('y', (y + 15).toFixed(1));
    pill.setAttribute('opacity', '1');
  };
  const show = (ev) => {
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = ((ev.clientX - box.left) / box.width) * vb.width;
    const i = nearestIndex(xs, sx);
    if (i < 0) return;
    const [px, py, day, text] = pts[i];
    if (g) { g.setAttribute('visibility', 'visible'); ln.setAttribute('x1', px); ln.setAttribute('x2', px); dot.setAttribute('cx', px); dot.setAttribute('cy', py); }
    const label = `${dayText(day)} · ${text}`;
    if (readout) readout.textContent = label;
    if (pill) place(px, py, label);
    if (gate(i, performance.now())) tick();
  };
  const clear = () => { if (g) g.setAttribute('visibility', 'hidden'); if (pill) pill.setAttribute('opacity', '0'); if (readout) readout.textContent = idle; };
  const down = (ev) => { svg.setPointerCapture && ev.pointerId != null && svg.setPointerCapture(ev.pointerId); show(ev); };
  const move = (ev) => { if (ev.buttons || ev.pointerType === 'touch' || ev.pointerType === 'mouse') show(ev); };
  let unbind = () => {};
  const outside = (ev) => {
    if (!svg.isConnected) return unbind(); // the screen changed: stop listening
    if (!svg.contains(ev.target)) clear();
  };
  svg.style.touchAction = 'pan-y'; // vertical scrolling still works; horizontal drags scrub
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  document.addEventListener('pointerdown', outside);
  unbind = () => {
    svg.removeEventListener('pointerdown', down);
    svg.removeEventListener('pointermove', move);
    document.removeEventListener('pointerdown', outside);
  };
  return unbind;
}
