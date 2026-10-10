// Trend engine (W2b): Theil–Sen slope + Mann–Kendall significance per metric over 7, 28 and 90 days.
// A trend counts only when it is significant (p < 0.05) AND bigger than the metric's noise floor per week.
// Pure functions, no DOM. Formulas and thresholds are written down in docs/trends.md.
import { shiftDay, indexDays, GET } from './metrics.js';
import { daysBetween, addDays } from '../weight/smoothing.js';
import { rolling } from '../ui/linechart.js';
import { metricSeries, dailySeries } from '../withings/body.js';

export const WINDOWS = [7, 28, 90];
export const MIN_POINTS = 6; // fewer readings than this in a window → "not enough data"
export const P_LIMIT = 0.05;

/**
 * Noise floor per week: a weekly change smaller than this is treated as noise. Mirrors `noise_floor_per_week`
 * in data/metrics.json (a test keeps the two in step), so the trend code works before that file is fetched.
 */
export const NOISE_FLOOR = {
  weight_kg: 0.1, fat_ratio_pct: 0.25, fat_mass_kg: 0.15, fat_free_mass_kg: 0.15, muscle_mass_kg: 0.15,
  hydration_kg: 0.2, visceral_fat: 0.1, heart_pulse_bpm: 0.5,
  hrv_sdnn_ms: 1, rhr_bpm: 0.5, sleep_min: 5, steps: 300, exercise_min: 3,
};

/** The metrics the trend engine and the Trends screen cover, in display order. */
export const TREND_METRICS = [
  { key: 'weight_kg', label: 'Weight', kind: 'mass', source: 'body' },
  { key: 'fat_ratio_pct', label: 'Body fat', kind: 'pct', source: 'body' },
  { key: 'fat_mass_kg', label: 'Fat mass', kind: 'mass', source: 'body' },
  { key: 'fat_free_mass_kg', label: 'Fat-free mass', kind: 'mass', source: 'body' },
  { key: 'muscle_mass_kg', label: 'Muscle', kind: 'mass', source: 'body' },
  { key: 'hydration_kg', label: 'Water', kind: 'mass', source: 'body' },
  { key: 'visceral_fat', label: 'Visceral fat', kind: 'index', source: 'body' },
  { key: 'heart_pulse_bpm', label: 'Standing heart rate', kind: 'bpm', source: 'body' },
  { key: 'hrv_sdnn_ms', label: 'HRV', kind: 'ms', source: 'apple' },
  { key: 'rhr_bpm', label: 'Resting heart rate', kind: 'bpm', source: 'apple' },
  { key: 'sleep_min', label: 'Sleep', kind: 'sleep', source: 'apple' },
  { key: 'steps', label: 'Steps', kind: 'count', source: 'apple' },
  { key: 'exercise_min', label: 'Exercise minutes', kind: 'minutes', source: 'apple' },
];
export const trendMetric = (key) => TREND_METRICS.find((m) => m.key === key) || null;

// ---- statistics ----

/** Standard normal CDF (erfc by Numerical Recipes' Chebyshev fit, error < 1.2e-7). */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  const cdf = 1 - 0.5 * erfc; // Φ(|z|)
  return z >= 0 ? cdf : 1 - cdf;
}

/** Median of a list of numbers (null when empty). */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Theil–Sen: median of all pairwise slopes. points: [[x, y], ...]. Returns { slope, intercept } or null. */
export function theilSenFit(points) {
  const s = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[j][0] !== points[i][0]) s.push((points[j][1] - points[i][1]) / (points[j][0] - points[i][0]));
    }
  }
  const slope = median(s);
  if (slope == null) return null;
  return { slope, intercept: median(points.map(([x, y]) => y - slope * x)) };
}

/**
 * Mann–Kendall trend test on values in time order. Variance is tie-corrected; p is two-sided from the
 * normal approximation with the usual continuity correction. Returns { n, S, varS, z, p }.
 */
export function mannKendall(ys) {
  const n = ys.length;
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(ys[j] - ys[i]);
  const ties = new Map();
  for (const y of ys) ties.set(y, (ties.get(y) || 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  let z = 0;
  if (varS > 0) z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = varS > 0 ? Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) : 1;
  return { n, S, varS, z, p };
}

/**
 * One metric over one window ending on `today`. series: [{ day, v }] (one per day, any order).
 * Returns { metric, window, slopePerWeek, p, direction: 'up'|'down'|'flat', enough, n }.
 * `flat` means no trend we can trust: not significant, or smaller than the noise floor.
 */
export function trendFor(series, { metric, window, today, floor = NOISE_FLOOR[metric] ?? 0 }) {
  const from = shiftDay(today, -(window - 1));
  const pts = series.filter((p) => p.day >= from && p.day <= today && Number.isFinite(p.v)).sort((a, b) => (a.day < b.day ? -1 : 1));
  const out = { metric, window, slopePerWeek: null, p: null, direction: 'flat', enough: pts.length >= MIN_POINTS, n: pts.length };
  if (!out.enough) return out;
  const fit = theilSenFit(pts.map((q) => [daysBetween(from, q.day), q.v]));
  if (!fit) return { ...out, enough: false };
  const mk = mannKendall(pts.map((q) => q.v));
  out.slopePerWeek = fit.slope * 7;
  out.p = mk.p;
  if (mk.p < P_LIMIT && Math.abs(out.slopePerWeek) > floor) out.direction = out.slopePerWeek > 0 ? 'up' : 'down';
  return out;
}

/** All windows for one metric: { 7: trend, 28: trend, 90: trend }. */
export function trendsFor(series, metric, today, floors = NOISE_FLOOR) {
  return Object.fromEntries(WINDOWS.map((w) => [w, trendFor(series, { metric, window: w, today, floor: floors[metric] ?? 0 })]));
}

// ---- series from the app's data ----

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** The value a Trends row shows: for weight, the smoothed trend (as on the Weight tab); otherwise the last reading. */
export function trendRowValue(t, weights = []) {
  const tr = t.key === 'weight_kg' && weights.length ? weights[weights.length - 1].trend : null;
  return Number.isFinite(tr) ? tr : t.last.v;
}

/** Rolling mean that keeps only points with a full `n`-day window behind them (no partial-window hook at the left edge).
 * Falls back to the raw points when too little is left to draw a line. */
export function smoothFull(points, n) {
  if (!points.length) return points;
  const from = addDays(points[0].day, n - 1);
  const full = rolling(points, n).filter((p) => p.day >= from);
  return full.length >= 2 ? full : points;
}

const APPLE_KEYS = new Set(TREND_METRICS.filter((m) => m.source === 'apple').map((m) => m.key));

/** Smallest range a Trends sparkline stretches to full height, per metric (units as stored). */
export const SPARK_MIN_SPAN = { sleep_min: 30, hrv_sdnn_ms: 6, rhr_bpm: 3, steps: 1500, exercise_min: 10, fat_ratio_pct: 1, weight_kg: 1 };

/** The points a Trends row's sparkline draws: weight → the smoothed trend line; daily Apple Health metrics
 * → a 7-day rolling mean (full windows only); scale readings stay raw. */
export function trendRowSeries(t, weights = []) {
  if (APPLE_KEYS.has(t.key)) return smoothFull(t.series, 7);
  if (t.key !== 'weight_kg') return t.series;
  const pts = weights.filter((w) => Number.isFinite(w.trend)).map((w) => ({ day: w.day, v: w.trend }));
  return pts.length ? pts : t.series;
}

/**
 * Daily series for every trend metric: Map(metric → [{ day, v }]) oldest first.
 * weights: the weight series [{ day, kg }] (yours, already de-duplicated); measures: body_measures docs;
 * rows: health_daily docs.
 */
export function buildSeries({ weights = [], measures = [], rows = [] }) {
  const out = new Map();
  out.set('weight_kg', weights.filter((p) => Number.isFinite(p.kg)).map((p) => ({ day: p.day, v: p.kg })));
  for (const m of TREND_METRICS) {
    if (m.source !== 'body' || m.key === 'weight_kg') continue;
    out.set(m.key, dailySeries(metricSeries(measures, m.key)).map((p) => ({ day: p.day, v: p.v })));
  }
  const days = indexDays(rows);
  const apple = { hrv_sdnn_ms: GET.hrv, rhr_bpm: GET.rhr, sleep_min: GET.sleep, steps: GET.steps, exercise_min: GET.exercise };
  const keys = [...days.keys()].sort();
  for (const [k, get] of Object.entries(apple)) {
    out.set(k, keys.map((d) => ({ day: d, v: num(get(days.get(d))) })).filter((p) => p.v != null));
  }
  return out;
}

/** Which way is "good" for a metric, given the user's goal: 'up', 'down' or null when it depends. */
export function goodDirection(metric, goal) {
  switch (metric) {
    case 'weight_kg': return goal === 'lose' || goal === 'recomp' ? 'down' : goal === 'muscle' ? 'up' : null;
    case 'fat_ratio_pct': case 'fat_mass_kg': case 'visceral_fat': return goal === 'muscle' ? null : 'down';
    case 'fat_free_mass_kg': case 'muscle_mass_kg': return 'up';
    case 'heart_pulse_bpm': case 'rhr_bpm': return 'down';
    case 'hrv_sdnn_ms': case 'sleep_min': case 'steps': case 'exercise_min': return 'up';
    default: return null; // water: depends on the day
  }
}

/** 'good' | 'bad' | 'neutral' for a trend direction: colour only where good is unambiguous. */
export function tone(metric, direction, goal) {
  const g = goodDirection(metric, goal);
  if (!g || direction === 'flat') return 'neutral';
  return g === direction ? 'good' : 'bad';
}

/**
 * Everything the Trends screen and insights need, per metric:
 * { key, label, kind, series, last, trends: {7,28,90}, t28, tone }. Metrics with no readings in 90 days are left out.
 */
export function allTrends({ series, today, goal = 'health', floors = NOISE_FLOOR }) {
  const list = [];
  for (const m of TREND_METRICS) {
    const s = series.get(m.key) || [];
    const recent = s.filter((p) => p.day >= shiftDay(today, -89) && p.day <= today);
    if (!recent.length) continue;
    const trends = trendsFor(s, m.key, today, floors);
    list.push({ ...m, series: s, recent, last: recent[recent.length - 1], trends, t28: trends[28], tone: tone(m.key, trends[28].direction, goal) });
  }
  return list;
}

/** Why there's no 4-week direction yet. Says how many readings there are, so it can't contradict a smoothed line the user can see. */
export function notEnoughText(key, n) {
  if (n >= MIN_POINTS) return 'Not enough change between readings to call a 4-week direction yet.';
  const count = (w) => (n === 0 ? `No ${w}s in the last 4 weeks.` : `Only ${n} ${w}${n === 1 ? '' : 's'} in the last 4 weeks.`);
  if (key === 'weight_kg') return `${count('weigh-in')} The trend line is your smoothed average. Weigh in 3+ times a week for a reliable 4-week direction.`;
  return `${count('reading')} Forge needs ${MIN_POINTS} in 4 weeks to call a direction.`;
}
