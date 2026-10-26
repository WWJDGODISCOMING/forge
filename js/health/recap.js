// Weekly recap (v0.16.74): the previous Monday–Sunday in one card. Pure functions, no DOM, no AI; the numbers come from
// weeklyReport (js/health/weekly.js) plus steps and missions. Goals are passed in (read from settings by the caller).
import { weekday, mondayOf, shiftWeek } from './weekly.js';

/** The recap card shows Monday to Wednesday of the new week (a late first open still gets it). */
export const RECAP_DAYS = [1, 2, 3];
export const TIP_BELOW = 0.85; // an area under this share of its goal can be the focus

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const cap = (x) => Math.max(0, Math.min(1, x));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** The Monday of the week a recap covers when opened `today`: always the week before this one. */
export const recapWeekFor = (today) => shiftWeek(mondayOf(today), -1);

/** Should the Today card show? `seen` = the week (Monday key) already opened or hidden on this phone. */
export function recapDue({ today, seen, hasData }) {
  if (!hasData || !RECAP_DAYS.includes(weekday(today))) return false;
  return seen !== recapWeekFor(today);
}

/** One plain tip per area. Gentle: what to try, never what went wrong. */
export const TIPS = {
  workouts: (a) => `Pick your ${a.goal || 3} workout days now and put them in your calendar. Even a short session counts.`,
  protein: () => 'Add one protein-rich food to your first meal. It makes the rest of the day easier.',
  steps: () => 'Try a 10-minute walk after a meal. A few of those add up fast.',
  calories: () => 'Plan your biggest meal first, then fit the rest around it.',
  missions: () => 'Pick just one daily mission to finish every day this week.',
  steady: () => 'Nice rhythm. Keep doing what you did this week.',
  quiet: () => 'A quiet week happens to everyone. Start small: one weigh-in or one short workout.',
};

/**
 * Build the recap. ctx: { report (weeklyReport result), stepsGoal, missions ({ done, total } or null) }.
 * Returns { weekStart, days, quiet, rows, weightChange, weighIns, prs, tip: { id, text }, focus } where each row is
 * { key, label, value, goal (number|null), unit, ceiling?, ratio (0..1|null) } for the areas that have data.
 */
export function buildRecap({ report: r, stepsGoal = 8000, missions = null }) {
  const rows = [];
  const t = r.training;
  rows.push({ key: 'workouts', label: 'Workouts', value: t.workouts, goal: t.planned, unit: '', ratio: t.planned > 0 ? cap(t.workouts / t.planned) : null });
  if (r.nutrition) {
    const n = r.nutrition;
    const kt = num(n.targetKcal);
    rows.push({ key: 'protein', label: 'Protein a day', value: Math.round(n.avgProtein), goal: num(n.targetProtein), unit: 'g', ratio: n.targetProtein > 0 ? cap(n.avgProtein / n.targetProtein) : null });
    rows.push({ key: 'calories', label: 'Calories a day', value: Math.round(n.avgKcal), goal: kt, unit: 'kcal', ceiling: true, ratio: kt > 0 ? cap(n.avgKcal <= kt ? 1 : kt / n.avgKcal) : null });
  }
  if (num(r.steps) != null) rows.push({ key: 'steps', label: 'Steps a day', value: Math.round(r.steps), goal: stepsGoal, unit: '', ratio: stepsGoal > 0 ? cap(r.steps / stepsGoal) : null, ofGoal: true });
  if (missions && missions.total > 0) rows.push({ key: 'missions', label: 'Missions done', value: missions.done, goal: missions.total, unit: '', ratio: cap(missions.done / missions.total) });

  const quiet = !r.hasData;
  let focus = null;
  for (const row of rows) if (row.ratio != null && row.ratio < TIP_BELOW && (!focus || row.ratio < focus.ratio)) focus = row;
  const id = quiet ? 'quiet' : focus ? focus.key : 'steady';
  const tip = { id, text: TIPS[id](focus || {}) };
  return { weekStart: r.weekStart, days: r.days, quiet, rows: quiet ? [] : rows, weightChange: r.weight.change, weighIns: r.weight.weighIns, prs: t.prs, tip, focus: focus ? focus.key : null };
}

/** "5 of 8,000", "120 g · goal 150 g", "2,100 kcal · limit 2,200 kcal". */
export function rowText(row) {
  const u = row.unit ? ` ${row.unit}` : '';
  if (row.goal == null) return `${fmt(row.value)}${u}`;
  if (row.ceiling) return `${fmt(row.value)}${u} · limit ${fmt(row.goal)}${u}`;
  if (row.unit) return `${fmt(row.value)}${u} · goal ${fmt(row.goal)}${u}`;
  return `${fmt(row.value)} of ${fmt(row.goal)}`;
}

/** Plain-text summary for sharing. `weightText` is the already-formatted trend change, or ''. */
export function recapText(rc, weekLabel, weightText = '') {
  const bits = [`Forge recap · ${weekLabel}`];
  if (rc.quiet) bits.push('A quiet week.');
  else {
    if (weightText) bits.push(`Weight trend ${weightText}`);
    for (const r of rc.rows) bits.push(`${r.label} ${rowText(r)}`);
    if (rc.prs) bits.push(`${rc.prs} personal record${rc.prs === 1 ? '' : 's'}`);
  }
  bits.push(`This week: ${rc.tip.text}`, '', 'Shared from Forge');
  return bits.join('\n');
}
