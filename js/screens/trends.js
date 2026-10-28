// Progress → Trends: every metric with a sparkline, today's value and the 28-day change per week.
// Green or red only where "good" is clear for your goal; everything else stays grey.
import { state, units as getUnits } from '../state.js';
import { esc } from '../ui.js';
import { progressTabs, progressRowsHtml } from './progress.js';
import { intel } from '../health/intel.js';
import { trendRowValue, trendRowSeries, SPARK_MIN_SPAN } from '../health/trends.js';
import { fmtMetric } from '../withings/body.js';
import { fmtAmount } from '../health/insights.js';
import { sparkSvg } from '../health/cards.js';
import { icon, emptyState } from '../ui/icons.js';

const ARROW = { up: 'arrowup', down: 'arrowdown', flat: 'flat' };

function row(t, u, today, weights, second) {
  const tr = t.t28;
  const change = !tr.enough ? 'Not enough data yet' : tr.direction === 'flat' ? 'Steady' : `${fmtAmount(t.key, tr.slopePerWeek, u)} a week`;
  const word = !tr.enough ? 'not enough data' : tr.direction === 'flat' ? 'steady' : `${tr.direction === 'up' ? 'up' : 'down'} ${fmtAmount(t.key, tr.slopePerWeek, u)} a week`;
  const value = fmtMetric(t.key, trendRowValue(t, weights), u, { kind: t.kind });
  return `<a class="g-row trend-row ${esc(t.tone)}"${second ? ' data-col2' : ''} href="#/metric/${esc(t.key)}" aria-label="${esc(t.key === 'weight_kg' ? 'Weight trend' : t.label)}: ${esc(value)}, ${esc(word)}">
    <span class="g-text"><span>${esc(t.key === 'weight_kg' ? 'Weight trend' : t.label)}</span><small>${esc(change)}</small></span>
    ${sparkSvg(trendRowSeries(t, weights), today, 28, { minSpan: SPARK_MIN_SPAN[t.key] })}
    <span class="tr-val"><b>${esc(value)}</b><span class="tr-arrow" aria-hidden="true">${tr.enough ? icon(ARROW[tr.direction]) : ''}</span></span>
  </a>`;
}

export function renderTrends(el) {
  const u = getUnits();
  const i = intel();
  const list = i.trends;
  const goal = (state.profile && state.profile.goal) || 'health';
  const body = list.length ? `
    <h2 class="sec-title">Last 4 weeks</h2>
    <div class="group trend-list" style="--rows:${Math.ceil(list.length / 2)}">${list.map((t, n) => row(t, u, i.today, i.weights, n === Math.ceil(list.length / 2))).join('')}</div>
    <p class="sec-foot">Arrows show the last 4 weeks. A trend only counts when it is bigger than normal day-to-day noise${goal === 'health' || goal === 'endurance' ? '' : ', and green or red shows whether it helps your goal'}. Tap one for the chart.</p>`
    : `<div class="card" data-empty>${emptyState({ art: 'trend', icon: 'chart', title: 'No trends yet', text: 'Weigh in a few times to see trends.', action: { href: '#/body/log', label: 'Log a weigh-in' } })}</div>`;
  el.innerHTML = `
    <section class="stack">
      ${progressTabs('trends')}
      <h1>Trends</h1>
      ${body}
      ${progressRowsHtml()}
      <p class="disclaimer">General fitness information, not medical advice.</p>
    </section>`;
}
