// Leg activity from steps and leg-heavy cardio, for display next to "Sets per muscle this week" ONLY.
//
// RULE: this is not training volume. Hard-set counts (setsPerMuscle) never include it, and nothing that drives
// progression, deload, recovery, rings or leg-day suggestions imports this file (a test checks that).
//
// The unit is an "activity-equivalent", not a set:
//  - Steps: per day, extra = max(0, steps − 3,000) (3,000 ≈ a sedentary baseline); stepUnits += extra / 2,500.
//    10,500 steps → 3.0 units for that day.
//  - Cardio adds only an intensity bonus on top of steps (so a jog is never counted twice), per duration_min:
//      run, jog_in_place, hiit, jump_rope: 1 unit per 15 min (steps already cover the volume)
//      bike, peloton, elliptical, stairs, row: 1 unit per 12 min (mostly non-step loading)
//      walk, swim, boxing, other: 0 (steps cover walking; the others aren't leg-dominant)
//  - Each source is spread over the muscles with the weights below.
//  - Weekly cap 4.0 units per muscle, rounded to 0.5, so it can never look like a training dose (the hard-set
//    band starts at 10).
import { indexDays } from '../health/metrics.js';

export const STEP_BASELINE = 3000;
export const STEPS_PER_UNIT = 2500;
export const CAP = 4;

const W_STEP = { calves: 1, quads: 0.7, glutes: 0.5, hamstrings: 0.35 };
const W_BIKE = { quads: 1, glutes: 0.5, hamstrings: 0.35, calves: 0.3 };
const W_STAIR = { quads: 0.9, glutes: 0.9, calves: 0.6, hamstrings: 0.4 };
const W_ROW = { quads: 0.7, glutes: 0.6, hamstrings: 0.5, calves: 0.2 };

/** activity → { minPerUnit, weights } for the activities that earn a bonus. */
export const CARDIO_RULES = {
  run: { minPerUnit: 15, weights: W_STEP }, jog_in_place: { minPerUnit: 15, weights: W_STEP },
  hiit: { minPerUnit: 15, weights: W_STEP }, jump_rope: { minPerUnit: 15, weights: W_STEP },
  bike: { minPerUnit: 12, weights: W_BIKE }, peloton: { minPerUnit: 12, weights: W_BIKE },
  elliptical: { minPerUnit: 12, weights: W_STAIR }, stairs: { minPerUnit: 12, weights: W_STAIR },
  row: { minPerUnit: 12, weights: W_ROW },
};
export const LEG_MUSCLES = ['quads', 'hamstrings', 'glutes', 'calves'];

const dayOf = (c) => c.day || (c.started_at ? new Date(c.started_at).toLocaleDateString('en-CA') : '');
const cap = (x) => Math.min(CAP, Math.round(x * 2) / 2);

/**
 * from inclusive, to exclusive (YYYY-MM-DD). → null with no step data and no qualifying cardio, else
 * { quads, hamstrings, glutes, calves, sources: { stepUnits, cardioUnits, days, steps, minutes: { activity: min } } }.
 */
export function legActivity({ healthDaily = [], cardio = [], from, to }) {
  const raw = Object.fromEntries(LEG_MUSCLES.map((m) => [m, 0]));
  let stepUnits = 0, cardioUnits = 0, steps = 0;
  const days = new Set();
  const minutes = {};
  let hasSteps = false;
  for (const [day, r] of indexDays(healthDaily)) {
    if (day < from || day >= to || r.steps == null || !Number.isFinite(Number(r.steps))) continue;
    hasSteps = true;
    steps += Number(r.steps);
    const u = Math.max(0, Number(r.steps) - STEP_BASELINE) / STEPS_PER_UNIT;
    if (u > 0) days.add(day);
    stepUnits += u;
    for (const m of LEG_MUSCLES) raw[m] += u * W_STEP[m];
  }
  let qualifying = false;
  for (const c of cardio) {
    const rule = CARDIO_RULES[c.activity];
    const day = dayOf(c);
    if (c.deleted || !rule || day < from || day >= to || !(c.duration_min > 0)) continue;
    qualifying = true;
    const u = c.duration_min / rule.minPerUnit;
    cardioUnits += u;
    days.add(day);
    minutes[c.activity] = (minutes[c.activity] || 0) + c.duration_min;
    for (const m of LEG_MUSCLES) raw[m] += u * rule.weights[m];
  }
  if (!hasSteps && !qualifying) return null;
  const out = {};
  for (const m of LEG_MUSCLES) out[m] = cap(raw[m]);
  return { ...out, sources: { stepUnits, cardioUnits, days: days.size, steps, minutes } };
}

/** Sheet text: "From 52,300 steps and 45 min of jogging this week. …" */
export function legSummary(a) {
  const s = a.sources;
  const parts = [];
  if (s.steps > 0) parts.push(`${Math.round(s.steps).toLocaleString('en-US')} steps`);
  const jog = (s.minutes.run || 0) + (s.minutes.jog_in_place || 0);
  if (jog) parts.push(`${Math.round(jog)} min of jogging`);
  const other = Object.entries(s.minutes).filter(([k]) => k !== 'run' && k !== 'jog_in_place').reduce((n, [, v]) => n + v, 0);
  if (other) parts.push(`${Math.round(other)} min of other leg cardio`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || 'your steps';
  return `From ${list} this week. Shown separately because it isn’t hard sets: it doesn’t count toward your 10–20 sets, progression or leg-day suggestions.`;
}
