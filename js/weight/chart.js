// Weight chart as plain SVG: dots = weigh-ins, line = smoothed trend, dashed = goal, dotted = projection.
import { weightToDisplay, weightUnit } from '../units.js';
import { daysBetween, addDays } from './smoothing.js';
import { formatDay } from '../ui.js';
import { areaFill, chartWait } from '../ui/linechart.js';
import { chartWidth } from '../ui/charts.js';

export function weightChartSVG(series, { units, goalKg, projection, rangeDays, width = chartWidth(), height = 210 } = {}) {
  if (!series.length) return '';
  const last = series[series.length - 1];
  const startDay = rangeDays ? addDays(last.day, -rangeDays) : series[0].day;
  const pts = series.filter((p) => p.day >= startDay);
  if (!pts.length) return '';

  let endDay = last.day;
  const showProj = projection && !projection.reached && daysBetween(last.day, projection.day) <= Math.max(30, (rangeDays || 365) / 2);

  const values = pts.flatMap((p) => [p.kg, p.trend]);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Only stretch the chart to include the goal if it's close; otherwise the data gets squashed flat.
  const goalInView = Number.isFinite(goalKg) && goalKg >= dataMin - Math.max(2, dataMax - dataMin) && goalKg <= dataMax + Math.max(2, dataMax - dataMin);
  if (goalInView) values.push(goalKg);
  if (showProj && goalInView) endDay = projection.day;
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = Math.max(0.5, (max - min) * 0.12);
  min -= pad;
  max += pad;

  const L = 40, R = 10, T = 12, B = 26;
  const span = Math.max(1, daysBetween(pts[0].day, endDay));
  const x = (day) => L + (daysBetween(pts[0].day, day) / span) * (width - L - R);
  const y = (kg) => T + (1 - (kg - min) / (max - min)) * (height - T - B);
  const disp = (kg) => weightToDisplay(kg, units);

  // y gridlines: 4 nice-ish ticks in the display unit
  const ticks = [];
  for (let i = 0; i <= 3; i++) {
    const kg = min + ((max - min) * i) / 3;
    ticks.push(`<line x1="${L}" x2="${width - R}" y1="${y(kg)}" y2="${y(kg)}" class="grid"/>
      <text x="${L - 6}" y="${y(kg) + 4}" class="axis" text-anchor="end">${disp(kg).toFixed(0)}</text>`);
  }

  const trendPath = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ');
  const dots = pts.map((p) => `<circle cx="${x(p.day).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="2.6" class="dot"/>`).join('');

  const offscale = Number.isFinite(goalKg) && !goalInView
    ? `<text x="${width - R}" y="${goalKg < min ? height - B - 4 : T + 10}" class="axis goal-label" text-anchor="end">Goal ${disp(goalKg).toFixed(0)} ${weightUnit(units)} ${goalKg < min ? '↓' : '↑'}</text>`
    : '';
  const goal = goalInView
    ? `<line x1="${L}" x2="${width - R}" y1="${y(goalKg)}" y2="${y(goalKg)}" class="goal"/>
       <text x="${width - R}" y="${y(goalKg) - 5}" class="axis goal-label" text-anchor="end">Goal ${disp(goalKg).toFixed(0)} ${weightUnit(units)}</text>`
    : '';

  const proj = showProj && goalInView
    ? `<path d="M${x(last.day)},${y(last.trend)} L${x(projection.day)},${y(goalKg)}" class="proj"/>`
    : '';

  const labels = `<text x="${L}" y="${height - 6}" class="axis">${formatDay(pts[0].day)}</text>
    <text x="${width - R}" y="${height - 6}" class="axis" text-anchor="end">${formatDay(endDay)}</text>`;

  return `<svg viewBox="0 0 ${width} ${height}" class="chart${chartWait()}" role="img" aria-label="Weight chart: dots are weigh-ins, line is your trend">
    ${ticks.join('')}${goal}${offscale}${proj}
    ${pts.length > 1 ? areaFill(trendPath, x(pts[0].day).toFixed(1), x(last.day).toFixed(1), (height - B).toFixed(1)) : ''}
    <path d="${trendPath}" class="trend" pathLength="1"/>${dots}${labels}
  </svg>`;
}

/** Small sparkline of the trend for cards. */
export function sparklineSVG(series, days = 30, width = 120, height = 36) {
  if (series.length < 2) return '';
  const last = series[series.length - 1];
  const pts = series.filter((p) => p.day >= addDays(last.day, -days));
  if (pts.length < 2) return '';
  const vals = pts.map((p) => p.trend);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(1, daysBetween(pts[0].day, last.day));
  const d = pts
    .map((p, i) => {
      const px = (daysBetween(pts[0].day, p.day) / span) * (width - 4) + 2;
      const py = max === min ? height / 2 : 2 + (1 - (p.trend - min) / (max - min)) * (height - 4);
      return `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" aria-hidden="true"><path d="${d}"/></svg>`;
}
