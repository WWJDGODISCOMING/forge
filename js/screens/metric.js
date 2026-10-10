// One body metric in detail (Body → tap a tile): latest value, this period vs. the previous one, a chart
// over 7/30/90/365 days or everything (with the previous period dashed), training sets per week underneath
// for muscle, and the explainer sheet ("What is this?") from data/metrics.json.
import { myBodyMeasures, mySuspects } from '../derived.js';
import { state, units as getUnits } from '../state.js';
import { esc, $, $$, sheet, todayKey } from '../ui.js';
import { addDays, daysBetween } from '../weight/smoothing.js';
import { weightToDisplay } from '../units.js';
import { lineChartSVG, bindScrub, unitOf } from '../ui/linechart.js';
import { metricDef, metricPoints, metricEmptyChoice, dailySeries, fmtMetric, heightM, periodAverage } from '../withings/body.js';
import { trendMetric, trendsFor, notEnoughText } from '../health/trends.js';
import { intel } from '../health/intel.js';
import { fmtAmount } from '../health/insights.js';
import { weekOf } from '../workouts/awards.js';
import { icon, emptyState } from '../ui/icons.js';
import { vo2Series } from '../health/longevity.js';
import { isNative } from '../native/bridge.js';
let unbindScrub = () => {};

let range = 90; // 7 / 28 / 90 / 365 days, or 0 for everything
let explainers = null;

export function loadExplainers() {
  if (!explainers) explainers = fetch('data/metrics.json').then((r) => r.json()).then((j) => j.metrics || {}).catch(() => ({}));
  return explainers;
}

/** Working sets per week (Monday), from finished workouts. */
export function weeklySets(workouts) {
  const m = new Map();
  for (const w of workouts) {
    if (w.deleted || w.status !== 'done') continue;
    const n = (w.exercises || []).reduce((a, it) => a + (it.sets || []).filter((s) => s.done && !s.warmup).length, 0);
    if (!n) continue;
    const wk = weekOf(w.started_at);
    m.set(wk, (m.get(wk) || 0) + n);
  }
  return [...m].map(([day, value]) => ({ day: addDays(day, 3), value })); // drawn mid-week
}

export function openExplainer(key) {
  const def = metricDef(key) || trendMetric(key);
  sheet(def ? def.label : 'About this metric', (body) => {
    body.innerHTML = '<div class="skeleton block"></div>';
    loadExplainers().then((all) => {
      const e = all[key];
      if (!e) { body.innerHTML = '<p class="muted">No explainer yet.</p>'; return; }
      const row = (t, v) => (v ? `<p class="label">${t}</p><p>${esc(v)}</p>` : '');
      body.innerHTML = `<div class="stack explainer">${row('What it is', e.what)}${row('How it’s measured', e.how)}${row('What moves it', e.moves)}${row('Typical ranges', e.ranges)}${row('Accuracy', e.caveats)}${row('In Forge', e.in_forge)}
        <p class="small muted">General information, not medical advice.</p></div>`;
    });
  });
}

export function renderMetric(el, key) {
  const apple = trendMetric(key);
  const def = metricDef(key) || (apple && apple.source === 'apple' ? apple : null);
  if (!def) { location.replace('#/body'); return; }
  const u = getUnits();
  const docs = myBodyMeasures();
  const h = heightM(docs, state.profile);
  const sus = mySuspects();
  // Apple Health metrics come from health_daily (one value a day); the rest from the scale (or hand-logged weights).
  // VO₂max reads the same merged Apple + scale series as the Longevity card.
  const daily = def === apple
    ? (intel().series.get(key) || []).map((p) => ({ ...p, at: `${p.day}T12:00:00` }))
    : key === 'vo2max' ? vo2Series(state.health_daily || [], docs).map((p) => ({ day: p.day, v: p.v, at: `${p.day}T12:00:00` }))
      : dailySeries(metricPoints(docs, key, { height: h, weights: state.weights.filter((w) => !sus.has(w.id)) }));
  const fmt = (v, o = {}) => fmtMetric(key, v, u, { ...o, kind: def.kind });
  // The same trend the Trends screen uses: Theil–Sen slope, Mann–Kendall significance, noise floor.
  const tr = trendMetric(key) ? trendsFor(daily, key, todayKey())[28] : null;
  const trendLine = !tr ? '' : !tr.enough ? notEnoughText(key, tr.n)
    : tr.direction === 'flat' ? 'Over the last 4 weeks this is steady.'
      : `Over the last 4 weeks this is going ${tr.direction} by about ${fmtAmount(key, tr.slopePerWeek, u)} a week.`;
  const disp = (v) => (def.kind === 'mass' ? weightToDisplay(v, u) : v);
  const last = daily[daily.length - 1];
  const end = todayKey();
  const days = range || (daily.length ? Math.max(7, daysBetween(daily[0].day, end)) : 30);
  const from = addDays(end, -days);
  const shown = daily.filter((p) => p.day >= from);
  const prevFrom = addDays(from, -days);
  const prev = range ? daily.filter((p) => p.day >= prevFrom && p.day < from).map((p) => ({ day: addDays(p.day, days), v: disp(p.v) })) : [];
  const avgNow = periodAverage(daily, from, addDays(end, 1));
  const avgPrev = range ? periodAverage(daily, prevFrom, from) : null;
  const delta = avgNow != null && avgPrev != null ? avgNow - avgPrev : null;
  // "−4.0 lb", "+3 ms"; a change that rounds to nothing at the shown precision is "same".
  const deltaText = (d) => {
    const n = Number(fmt(Math.abs(d), { unit: false }).replace(/,/g, ''));
    return n === 0 ? 'same' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
  };
  const showSets = def.overlay === 'sets' || $$('input[name=sets]:checked', el).length > 0;
  const bars = showSets ? weeklySets(state.workouts) : [];

  const wConnected = !!(state.integrations.withings && state.integrations.withings.connected);
  const choice = metricEmptyChoice(key, wConnected);
  const emptyText = def === apple
    ? isNative() ? { text: 'Connect Apple Health and your readings show up here.', action: { href: '#/apple', label: 'Connect Apple Health' } } : { text: 'Turn on the Apple Health bridge and your readings show up here.', action: { href: '#/apple', label: 'Set up Apple Health' } }
    : { text: key === 'weight_kg' ? 'Log your weight and it shows up here.' : wConnected ? 'The data check shows whether Withings sends this one.' : 'Connect Withings to bring your readings in.', action: choice.primary };
  el.innerHTML = `
    <section class="stack">
      <div class="row between center"><h1>${esc(def.label)}</h1><button class="btn ghost small" data-explain>What is this?</button></div>
      ${last ? `
      <div class="card stack">
        <div class="stats">
          <div><span>Latest</span><b data-count>${esc(fmt(last.v))}</b></div>
          <div><span>${range ? `${range}-day avg` : 'Average'}</span><b data-count>${avgNow == null ? '—' : esc(fmt(avgNow))}</b></div>
          <div><span>${range ? `vs previous ${range} days` : 'vs previous'}</span><b>${delta == null ? '—' : esc(deltaText(delta))}</b></div>
        </div>
        <div class="seg small" role="radiogroup" aria-label="Range">
          ${[[7, '7d'], [28, '28d'], [90, '90d'], [365, '1y'], [0, 'All']].map(([d, l]) => `<label><input type="radio" name="range" value="${d}" ${range === d ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
        ${shown.length ? lineChartSVG(shown.map((p) => ({ day: p.day, v: disp(p.v), t: fmt(p.v) })), { prev, bars, unit: unitOf(fmt), label: `${def.label} chart`, fromDay: from, toDay: end }) : '<p class="muted small">No readings in this range.</p>'}
        ${shown.length ? '<p class="small muted chart-readout" data-readout aria-live="polite">Touch the chart to read a day.</p>' : ''}
        <p class="small muted legend"><span class="key dot"></span>readings <span class="key line"></span>7-day average ${prev.length ? '<span class="key dash"></span>previous period' : ''} ${bars.length ? '<span class="key bar"></span>training sets/week' : ''}</p>
        ${def.overlay !== 'sets' ? `<label class="g-row sw"><span class="g-text"><span>Show training sets per week</span></span><input type="checkbox" switch name="sets" ${showSets ? 'checked' : ''}></label>` : ''}
        ${trendLine ? `<p data-trend-line>${esc(trendLine)}</p>` : ''}
        <p class="small muted">Last reading ${def === apple || key === 'vo2max' ? new Date(last.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : new Date(last.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${daily.length.toLocaleString()} days with readings</p>
      </div>` : `<div class="card">${emptyState({ icon: def === apple ? 'heart' : 'scale', title: `No ${esc(def.label.toLowerCase())} readings yet`, ...emptyText })}${def !== apple && choice.secondary ? `<a class="link" href="${choice.secondary.href}">${choice.secondary.label}</a>` : ''}</div>`}
      ${key === 'bmi' ? '<p class="small muted">BMI ignores muscle. Look at FFMI and FMI too.</p>' : ''}
    </section>`;

  $('[data-explain]', el).onclick = () => openExplainer(key);
  unbindScrub();
  unbindScrub = bindScrub($('svg.chart', el), $('[data-readout]', el));
  $$('input[name=range]', el).forEach((r) => r.addEventListener('change', () => { range = Number(r.value); renderMetric(el, key); }));
  const sets = $('input[name=sets]', el);
  if (sets) sets.addEventListener('change', () => renderMetric(el, key));
}
