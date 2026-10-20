// The weekly report as plain text for Share. It repeats only what is on the report cards (Score, workouts, weight
// trend change, the one suggestion) plus a short footer. Pure, so it is tested with synthetic data.
import { weightToDisplay, weightUnit } from '../units.js';
import { fmtDelta } from './delta.js';
import { mondayOf, shiftWeek } from './weekly.js';

const day = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

/** 'Last week · Oct 12 – Oct 18' for a finished week; 'This week so far · …' while it is still running. */
export const weekTitle = (r, today) => {
  const lead = r.partial ? 'This week so far' : today && r.days[0] === shiftWeek(mondayOf(today), -1) ? 'Last week' : 'Week';
  return `${lead} · ${day(r.days[0])} – ${day(r.days[6])}`;
};

/** `thisWeek` ({ workouts, planned }) adds this week's live count when the report is for a finished week. */
export function reportText(r, units, thisWeek = null, today = '') {
  const bits = [`Forge weekly report · ${weekTitle(r, today)}`];
  if (r.score.now != null) {
    const d = r.score.delta == null ? null : fmtDelta(r.score.delta);
    bits.push(`Forge Score ${Math.round(r.score.now)}${d && !d.same ? ` (${d.text})` : ''}`);
  }
  bits.push(`Workouts ${r.training.workouts}/${r.training.planned}${r.training.prs ? ` · ${r.training.prs} PR${r.training.prs === 1 ? '' : 's'}` : ''}`);
  if (r.weight.change != null) {
    const d = fmtDelta(weightToDisplay(r.weight.change, units), { digits: 1, unit: weightUnit(units) });
    bits.push(`Weight trend ${d.same ? 'steady' : d.text}`);
  }
  if (r.nutrition) bits.push(`Food ${r.nutrition.daysLogged}/7 days logged · about ${Math.round(r.nutrition.avgKcal).toLocaleString()} kcal, ${Math.round(r.nutrition.avgProtein)} g protein a day`);
  if (thisWeek && !r.partial) bits.push(`This week so far: ${thisWeek.workouts}/${thisWeek.planned} workouts`);
  bits.push(`Next week: ${r.suggestion.text}`, '', 'Shared from Forge');
  return bits.join('\n');
}
