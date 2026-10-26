// What the home-screen and lock-screen widgets show, as one small snapshot of numbers. Pure functions, no DOM, no state.
// The iPhone app hands this to the ForgeWidget plugin (js/native/widget.js); the widget never goes online.
// Numbers only: no names, photos, food names or places.

export const WIDGET_SNAPSHOT_VERSION = 1;
const TREND_POINTS = 7;

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const whole = (x) => (num(x) == null ? null : Math.max(0, Math.round(x)));
const tenth = (x) => Math.round(x * 10) / 10;

/** { v, goal } with whole numbers, or null when there is no goal to measure against. */
function progress(v, goal) {
  const g = whole(goal);
  if (!g) return null;
  return { v: whole(v) || 0, goal: g };
}

/**
 * Build the snapshot.
 *   now        ms since epoch (when it was made; the widget calls it stale after a day)
 *   day        local 'YYYY-MM-DD' it describes
 *   weighedIn  today's weigh-in mission is done
 *   steps / stepsGoal · protein / proteinGoal · kcal / kcalCeiling   today's numbers (null goal → that part is left out)
 *   series     smoothed weight points [{ day, trend }] with trend in kg, oldest first
 *   units      'imperial' | 'metric'
 */
export function buildSnapshot({ now, day, weighedIn = false, steps = null, stepsGoal = null, protein = null, proteinGoal = null, kcal = null, kcalCeiling = null, series = [], units = 'imperial' } = {}) {
  const imperial = units !== 'metric';
  const show = (kg) => tenth(imperial ? kg * 2.2046226218 : kg);
  const pts = (series || []).filter((p) => p && num(p.trend) != null).slice(-TREND_POINTS).map((p) => show(p.trend));
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    at: Math.round(now),
    day,
    weigh: !!weighedIn,
    steps: num(steps) == null ? (whole(stepsGoal) ? { v: null, goal: whole(stepsGoal) } : null) : progress(steps, stepsGoal),
    protein: progress(protein, proteinGoal),
    kcal: progress(kcal, kcalCeiling),
    trend: pts.length >= 2 ? { unit: imperial ? 'lb' : 'kg', latest: pts[pts.length - 1], points: pts } : null,
  };
}

/** The same snapshot without the time it was made: two with the same key need no new hand-off. */
export function snapshotKey(s) {
  if (!s) return '';
  const { at, ...rest } = s; // eslint-disable-line no-unused-vars
  return JSON.stringify(rest);
}

export const REFRESH_MS = 30 * 60 * 1000;
/** Send when the numbers changed, when forced, or when the last hand-off is old enough that the widget might call it stale. */
export const shouldSend = (prevKey, key, lastAt, now, force = false) => prevKey !== key || (force && now - lastAt >= 60 * 1000) || now - lastAt >= REFRESH_MS;

/** Past this age the widget says "Open Forge to update" instead of showing numbers that may be wrong. */
export const STALE_MS = 24 * 3600 * 1000;
export const isStale = (s, now, day) => !s || s.v !== WIDGET_SNAPSHOT_VERSION || (day != null && s.day !== day) || now - s.at > STALE_MS || now < s.at - 3600 * 1000;
