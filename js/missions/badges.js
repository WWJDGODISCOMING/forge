// Badges from weigh-ins and body composition. Pure; js/missions/store.js feeds them into the Awards screen.
import { shiftDay } from './core.js';
import { weightToDisplay, weightUnit } from '../units.js';

export const MISSION_BADGES = [
  { id: 'wi7', name: 'Weekly Weigh', how: 'Weigh in 7 days in a row', days: 7 },
  { id: 'wi30', name: 'Scale Habit', how: 'Weigh in 30 days in a row', days: 30 },
  { id: 'wi100', name: 'Steady Hand', how: 'Weigh in 100 days in a row', days: 100 },
  { id: 'bf1', name: 'First Point', how: 'Body fat down 1 point from where you started (needs a Withings scale)', key: 'fat_ratio_pct', drop: 1 },
  { id: 'bf2', name: 'Two Points', how: 'Body fat down 2 points from where you started (needs a Withings scale)', key: 'fat_ratio_pct', drop: 2 },
  { id: 'bf5', name: 'Five Points', how: 'Body fat down 5 points from where you started (needs a Withings scale)', key: 'fat_ratio_pct', drop: 5 },
  { id: 'perfectweek', name: 'Perfect Week', how: 'Finish every daily mission on 7 days in a row', perfect: true },
  { id: 'lean1', name: 'Lean Gain', how: 'Lean mass up 1 kg from where you started (needs a Withings scale)', key: 'fat_free_mass_kg', gain: 1 },
];
export const MISSION_BADGE_IDS = new Set(MISSION_BADGES.map((b) => b.id));

/** The lean-mass goal (stored in kg) in the user's units. */
const leanText = (kg, units) => {
  const v = weightToDisplay(kg, units);
  return `Lean mass up ${units === 'metric' ? v : v.toFixed(1)} ${weightUnit(units)} from where you started (needs a Withings scale)`;
};

const at = (day) => `${day}T12:00:00`; // earned date, a local-noon timestamp string

/**
 * Mission badges to celebrate on Today: earned, not in awards_seen yet, and earned on or after the day missions
 * started (the XP rule: nothing from before is celebrated or paid). Before awards_seen exists nothing is new,
 * because the first run seeds it quietly with everything already earned.
 */
export function newMissionBadges(badges, seen, started) {
  if (!seen || !started) return [];
  return badges.filter((b) => b.id !== 'perfectweek' && b.earned && !seen[b.id] && b.earned.at.slice(0, 10) >= started);
}

/** For each streak length, the first day a run of that many consecutive weigh-in days was reached. */
export function streakDays(days) {
  const sorted = [...new Set(days)].sort();
  const first = {};
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    run = prev && shiftDay(prev, 1) === d ? run + 1 : 1;
    prev = d;
    for (const b of MISSION_BADGES) if (b.days && run >= b.days && !first[b.days]) first[b.days] = d;
  }
  return first;
}

/** Weigh-in days in a row ending today. A day without a weigh-in yet doesn't break it: it still counts back from yesterday. */
export function currentStreak(days, today) {
  const have = new Set(days);
  let day = have.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (have.has(day) && n < 4000) { n++; day = shiftDay(day, -1); }
  return n;
}

const BASE_DAYS = 14;
const NOW_DAYS = 7;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * First day the 7-day average of a metric is `drop` below (or `gain` above) the average of your first 14 days.
 * `points`: [{ day, v }]. Only days after the 14-day baseline window count, so a few early readings can't earn it.
 */
export function compFirstDay(points, { drop = 0, gain = 0 }) {
  const pts = [...points].sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!pts.length) return null;
  const baseEnd = shiftDay(pts[0].day, BASE_DAYS - 1);
  const base = avg(pts.filter((p) => p.day <= baseEnd).map((p) => p.v));
  for (const p of pts) {
    if (p.day <= baseEnd) continue;
    const from = shiftDay(p.day, -(NOW_DAYS - 1));
    const now = avg(pts.filter((q) => q.day >= from && q.day <= p.day).map((q) => q.v));
    if ((drop && base - now >= drop) || (gain && now - base >= gain)) return p.day;
  }
  return null;
}

/**
 * Mission badges as the Awards screen lists them: [{ id, name, how, earned: { at, workoutId: null } | null }].
 * `weighDays`: days with a weigh-in. `bodyMeasures`: body_measures docs (without them the body-comp badges stay locked).
 * `seen`: awards_seen, so a badge once earned stays earned.
 */
export function missionBadges({ weighDays = [], bodyMeasures = [], seen = {}, units = 'imperial', perfectWeeks = [] } = {}) {
  const streaks = streakDays(weighDays);
  const comp = {};
  for (const key of new Set(MISSION_BADGES.filter((b) => b.key).map((b) => b.key))) {
    comp[key] = bodyMeasures
      .filter((d) => d && !d.deleted && !d.needs_review && d.day && d.metrics && Number.isFinite(d.metrics[key]))
      .map((d) => ({ day: d.day, v: d.metrics[key] }));
  }
  return MISSION_BADGES.map((b) => {
    const day = b.perfect ? [...perfectWeeks].sort()[0] : b.days ? streaks[b.days] : compFirstDay(comp[b.key], b);
    const date = day ? at(day) : (seen && seen[b.id]) || null;
    return { id: b.id, name: b.name, how: b.gain ? leanText(b.gain, units) : b.how, earned: date ? { at: date, workoutId: null } : null };
  });
}
