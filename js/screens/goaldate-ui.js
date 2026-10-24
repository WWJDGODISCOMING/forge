// Goal date on Food, Body and the Goal path sheet. The numbers come from js/nutrition/goaldate.js; this file reads state and draws.
// Works with AI off (nothing here calls out), and recalculates every time it draws, so it follows you day by day.
import { state, units as getUnits } from '../state.js';
import { esc, $, sheet, todayKey } from '../ui.js';
import { haptics } from '../ui/haptic.js';
import { addDays, daysBetween, trendChange } from '../weight/smoothing.js';
import { weightToDisplay, weightUnit, formatWeight } from '../units.js';
import { goalDateSettings, goalDatePlan, recommendLine, paceWords, weekLine } from '../nutrition/goaldate.js';
import { intel, currentGoalPath } from '../health/intel.js';
import { currentTargets, weightSeries } from '../derived.js';
import { balanceOn } from './balance-ui.js';
import { chartWidth } from '../ui/charts.js';

const fmtDay = (d, year) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(year || d.slice(0, 4) !== todayKey().slice(0, 4) ? { year: 'numeric' } : {}) }).replace(/ /g, ' '); // a date never splits across lines

/** Average calories burned over the last 7 days that have Apple Health data; falls back to your estimated maintenance (TDEE). */
export function estimatedBurn(today = todayKey()) {
  const burned = [];
  for (let i = 1; i <= 7; i++) {
    const b = balanceOn(addDays(today, -i));
    if (b && (b.active != null || b.restingFrom === 'apple')) burned.push(b.burned);
  }
  if (burned.length >= 3) return { kcal: burned.reduce((a, b) => a + b, 0) / burned.length, from: 'apple' };
  const t = currentTargets();
  return t ? { kcal: t.tdee, from: 'estimate' } : { kcal: null, from: null };
}

/** The plan for today, or null when Goal date is off or there is no goal weight / trend yet. */
export function currentGoalDatePlan() {
  const gd = goalDateSettings(state.settings);
  const p = state.profile || {};
  if (!gd.on || !gd.day || !p.targetWeightKg) return null;
  const series = weightSeries();
  if (!series.length) return null;
  const t = currentTargets();
  const today = todayKey();
  const path = currentGoalPath();
  return goalDatePlan({
    trendKg: series[series.length - 1].trend, goalKg: p.targetWeightKg, goalDay: gd.day, today,
    burn: estimatedBurn(today).kcal, ceiling: t && t.calories, sex: p.sex,
    actualKgPerWeek: path && Number.isFinite(path.slopePerWeek) ? path.slopePerWeek : null,
    weekKg: trendChange(series, 7),
  });
}

/** Small print under the Calories meter on Food, or ''. */
export function goalDateFoodHtml() {
  const text = recommendLine(currentGoalDatePlan(), fmtDay);
  return text ? `<p class="small muted goal-date-line" data-goal-date-line>${esc(text)}</p>` : '';
}

/** The Goal path button on the Body card, or '' while Goal date is off. */
export function goalDateButtonHtml() {
  const gd = goalDateSettings(state.settings);
  return gd.on && gd.day && state.profile && state.profile.targetWeightKg ? '<button type="button" class="btn ghost" data-goal-date-open>Goal path</button>' : '';
}

export function bindGoalDateButton(el) {
  const b = $('[data-goal-date-open]', el);
  if (b) b.onclick = () => { haptics.select(); openGoalDateSheet(); };
}

/** Chart: your trend for the last 28 days (solid) and the straight line the date needs, today to the goal (dashed). */
export function goalDateSvg(plan, series, today, units, width = chartWidth(), height = 170) {
  const from = addDays(today, -27);
  const pts = series.filter((p) => p.day >= from && p.day <= today);
  if (pts.length < 2) return '';
  const endDay = plan.status === 'ok' ? plan.goalDay : plan.suggestedDay || plan.goalDay;
  const span = Math.max(1, daysBetween(from, endDay > today ? endDay : today));
  const L = 40, R = 10, T = 10, B = 22;
  const vals = pts.map((p) => p.trend).concat([plan.goalKg]);
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = Math.max(0.4, (max - min) * 0.15);
  min -= pad; max += pad;
  const x = (day) => L + (daysBetween(from, day) / span) * (width - L - R);
  const y = (kg) => T + (1 - (kg - min) / (max - min)) * (height - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ');
  const now = pts[pts.length - 1];
  const g = y(plan.goalKg).toFixed(1);
  const disp = (kg) => weightToDisplay(kg, units).toFixed(0);
  return `<svg viewBox="0 0 ${width} ${height}" class="chart goalpath" role="img" aria-label="Your weight trend and the pace needed to reach ${esc(formatWeight(plan.goalKg, units, 0))} by ${esc(fmtDay(endDay))}">
    <text x="${L - 6}" y="${(y(max - pad) + 4).toFixed(1)}" class="axis" text-anchor="end">${disp(max - pad)}</text>
    <text x="${L - 6}" y="${(y(min + pad) + 4).toFixed(1)}" class="axis" text-anchor="end">${disp(min + pad)}</text>
    <line class="gp-goal" x1="${L}" x2="${width - R}" y1="${g}" y2="${g}"/>
    <line class="gp-proj" x1="${x(today).toFixed(1)}" y1="${y(now.trend).toFixed(1)}" x2="${x(endDay).toFixed(1)}" y2="${g}"/>
    <path d="${line}" class="trend"/>
    <text x="${L}" y="${height - 5}" class="axis">${fmtDay(from)}</text>
    <text x="${width - R}" y="${height - 5}" class="axis" text-anchor="end">${fmtDay(endDay)}</text>
  </svg>`;
}

export function goalDateSheetHtml(plan, units = getUnits()) {
  if (!plan) return '<p class="muted">Turn on Goal date in Settings and set a goal weight to see your path.</p>';
  if (plan.status === 'noweight') return '<p class="muted">Weigh in once and your path starts here.</p>';
  if (plan.status === 'reached') return '<p class="big-title">You have reached your goal weight</p><p class="small muted">Nice work. You can set a new goal in Settings.</p>';
  if (plan.status === 'nodate') return '<p>Your goal date has passed. Pick a new date in Settings and Forge will work out a plan.</p>';
  const w = paceWords(plan);
  const burnNote = plan.burn == null ? '' : `<p class="small muted">Based on about ${(Math.round(plan.burn / 10) * 10).toLocaleString('en-US')} calories burned a day and your smoothed weight trend. It updates every day.</p>`;
  const unreal = plan.status === 'unrealistic'
    ? `<div class="notice info" data-goal-date-unreal><b>That date is tight.</b> About ${weightToDisplay(plan.maxKgPerWeek, units).toFixed(1)} ${weightUnit(units)} a week is the most Forge suggests (around 1% of your body weight${plan.losing ? ', and never below your safe calorie floor' : ''}). ${plan.suggestedDay ? `A realistic date is <b>${esc(fmtDay(plan.suggestedDay))}</b>.` : ''}</div>`
    : '';
  return `<div class="stack" data-goal-date-sheet>
    <p class="big-title">${esc(formatWeight(plan.goalKg, units, 0))} by ${esc(fmtDay(plan.goalDay))}</p>
    <p data-goal-date-status><b class="gd-status gd-${plan.pace}">${esc(w.label)}.</b> ${esc(w.text)}</p>
    ${goalDateSvg(plan, intel().weights, todayKey(), units)}
    <p class="small muted legend"><span class="key line"></span>your trend <span class="key dash"></span>pace your date needs</p>
    <p class="small" data-goal-date-week>${esc(weekLine(plan, units))}</p>
    ${unreal}${burnNote}
    <p class="small muted">General guidance, not medical advice. Your calorie ceiling does not change on its own.</p>
  </div>`;
}

export function openGoalDateSheet() {
  sheet('Goal path', (body) => { body.innerHTML = goalDateSheetHtml(currentGoalDatePlan()); });
}
