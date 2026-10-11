import { state, units as getUnits } from '../state.js';
import { put, newRecord, softDelete, tombstone } from '../db.js';
import { esc, $, $$, sheet, toast, todayKey, formatDay, confirmSheet } from '../ui.js';
import { tick } from '../ui/haptic.js';
import { weightToDisplay, weightFromInput, weightUnit, formatWeight } from '../units.js';
import { trendChange, weeklyRate, dayKey } from '../weight/smoothing.js';
import { weightChartSVG } from '../weight/chart.js';
import { timeOf, readingLabel } from '../weight/reading.js';
import { weightSeries, mySuspects, latestWeighIn } from '../derived.js';
import { SCALE_SOURCES } from '../withings/review.js';
import { progressTabs } from './progress.js';
import { icon, emptyState } from '../ui/icons.js';
import { goalPathCard } from './body.js';
import { currentGoalPath } from '../health/intel.js';
import { goalProjection } from '../health/goalpath.js';

const SOURCE_LABELS = { manual: 'Manual', withings: 'Withings', withings_csv: 'Withings (export)', apple_shortcut: 'Apple Health (Shortcut)', apple_health: 'Apple Health' };
let range = 90;
let showAll = false;
const HISTORY_LIMIT = 20;

export { timeOf, readingLabel };

export function openLogWeight() {
  const u = getUnits();
  const series = weightSeries();
  const last = series.length ? series[series.length - 1].kg : state.profile && state.profile.weightKg;
  sheet('Log weight', (body, close) => {
    body.innerHTML = `
      <form class="stack" novalidate>
        <label class="field big-input">
          <span>Weight (${weightUnit(u)})</span>
          <input name="w" type="number" inputmode="decimal" step="0.1" placeholder="${last ? weightToDisplay(last, u).toFixed(1) : ''}" autofocus>
        </label>
        <label class="field"><span>Date</span><input name="day" type="date" value="${todayKey()}" max="${todayKey()}"></label>
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">Save</button>
      </form>`;
    const form = $('form', body);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const kg = weightFromInput(form.w.value, u);
      if (!Number.isFinite(kg) || kg < 25 || kg > 350) {
        $('.error', body).textContent = 'Enter a weight.';
        return;
      }
      const day = form.day.value || todayKey();
      const measured = day === todayKey() ? new Date() : new Date(day + 'T08:00:00');
      put('weights', newRecord({ kg, day, measured_at: measured.toISOString() }));
      tick();
      close();
      toast(`Saved ${formatWeight(kg, u)}`);
    });
  });
}

export function renderWeight(el) {
  const u = getUnits();
  const series = weightSeries();
  const goalKg = state.profile && state.profile.targetWeightKg;
  const projection = goalKg ? goalProjection(currentGoalPath()) : null; // the dotted line: same date as the Goal path card
  const change7 = trendChange(series, 7);
  const rate = weeklyRate(series);
  const latest = series.length ? series[series.length - 1] : null;
  const reading = latestWeighIn();
  const entries = [...state.weights].sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1));
  // Days whose trend point is a scale reading (earliest Withings weigh-in): typed-in entries those days are shown but not used.
  const sus = mySuspects();
  const asking = (w) => w.review || sus.has(w.id);
  const trendDays = new Map();
  for (const w of [...state.weights].filter((x) => SCALE_SOURCES.has(x.source) && !asking(x)).sort((a, b) => (a.measured_at < b.measured_at ? -1 : 1))) {
    if (!trendDays.has(w.day)) trendDays.set(w.day, w.id);
  }

  el.innerHTML = `
    <section class="stack">
      ${progressTabs('weight')}
      <div class="row between center">
        <h1>Weight</h1>
        <button class="btn small" data-log aria-label="Log weight"><span>+ Log<span class="hide-xs"> weight</span></span></button>
      </div>
      ${latest ? `
      <div class="card">
        <div class="stats stats-2">
          <div><span>${reading ? esc(reading.day === todayKey() ? 'Today' : readingLabel(reading, todayKey())) : 'Latest'}</span><b data-count>${formatWeight(reading ? reading.kg : latest.kg, u)}</b></div>
          <div><span>Trend</span><b data-count>${formatWeight(latest.trend, u)}</b></div>
          <div><span>7 days</span><b data-count>${change7 == null ? '—' : `${change7 > 0 ? '+' : ''}${weightToDisplay(change7, u).toFixed(1)}`}</b></div>
          <div><span>Per week</span><b data-count>${rate == null ? '—' : `${rate > 0 ? '+' : ''}${weightToDisplay(rate, u).toFixed(2)}`}</b></div>
        </div>
        <div class="seg small" role="radiogroup" aria-label="Range">
          ${[[30, '30d'], [90, '90d'], [365, '1y'], [0, 'All']].map(([d, l]) =>
            `<label><input type="radio" name="range" value="${d}" ${range === d ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
        ${weightChartSVG(series, { units: u, goalKg, projection, rangeDays: range || null })}
        <p class="small muted legend"><span class="key dot"></span>weigh-ins <span class="key line"></span>trend ${goalKg ? '<span class="key dash"></span>goal' : ''}</p>
      </div>
      <div class="group"><a class="g-row" href="#/photos" data-photos-row><span class="g-ic">${icon('camera')}</span><span class="g-text"><span>Progress photos</span><small>Weekly photos, compare, time-lapse</small></span><span class="chev">${icon('chev')}</span></a></div>
      ${goalPathCard()}
      <div class="group">
        <a class="g-row" href="#/history"><span class="g-ic">${icon('list')}</span><span class="g-text"><span>History</span><small>Workouts and cardio</small></span><span class="chev">${icon('chev')}</span></a>
        <a class="g-row" href="#/awards"><span class="g-ic">${icon('trophy')}</span><span class="g-text"><span>Awards</span><small>Levels and badges</small></span><span class="chev">${icon('chev')}</span></a>
        <a class="g-row" href="#/coach"><span class="g-ic">${icon('help')}</span><span class="g-text"><span>Ask Coach</span><small>Answers from your own data</small></span><span class="chev">${icon('chev')}</span></a>
      </div>` : `<div class="card">${emptyState({ icon: 'scale', title: 'No weigh-ins yet', text: 'Log your first weight and your trend starts here.', action: { attr: 'data-log-empty', label: 'Log weight' } })}</div>
      <div class="group"><a class="g-row" href="#/photos" data-photos-row><span class="g-ic">${icon('camera')}</span><span class="g-text"><span>Progress photos</span><small>Weekly photos, compare, time-lapse</small></span><span class="chev">${icon('chev')}</span></a></div>`}

      ${entries.length ? `
      <h2>Weigh-ins</h2>
      <ul class="list">
        ${(showAll ? entries : entries.slice(0, HISTORY_LIMIT)).map((w) => `
          <li>
            <div><b>${formatWeight(w.kg, u)}</b><small class="muted">${formatDay(w.day, { weekday: 'short', month: 'short', day: 'numeric' })}${timeOf(w)} · ${esc(SOURCE_LABELS[w.source] || w.source)}${asking(w) ? ' · <a href="#/withings">is this you?</a>' : ''}${!asking(w) && trendDays.has(w.day) && trendDays.get(w.day) !== w.id ? ' · not in trend (earlier scale reading used)' : ''}</small></div>
            <button class="icon-btn" data-del="${esc(w.id)}" data-src="${esc(w.source || '')}" aria-label="Delete this weigh-in">${icon('trash')}</button>
          </li>`).join('')}
      </ul>
      ${!showAll && entries.length > HISTORY_LIMIT ? `<button class="btn ghost" data-all>Show all ${entries.length}</button>` : ''}` : ''}
      <p class="small muted">Trend = 10%-per-day smoothed average, so single weigh-ins (water, salt) don’t swing it much.</p>
    </section>`;

  $('[data-log]', el).onclick = openLogWeight;
  const logEmpty = $('[data-log-empty]', el);
  if (logEmpty) logEmpty.onclick = openLogWeight;
  const all = $('[data-all]', el);
  if (all) all.onclick = () => { showAll = true; renderWeight(el); };
  $$('input[name=range]', el).forEach((r) =>
    r.addEventListener('change', () => {
      range = Number(r.value);
      renderWeight(el);
    })
  );
  $$('[data-del]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      const fromScale = b.dataset.src === 'withings';
      const ok = await confirmSheet({
        title: 'Delete weigh-in?',
        message: fromScale ? 'This removes it from Forge on all devices. It stays in the Withings app, and Forge won’t bring it back.' : 'This removes it from your history on all devices.',
        confirmLabel: 'Delete', danger: true,
      });
      if (!ok) return;
      softDelete('weights', b.dataset.del);
      if (fromScale && state.body_measures.some((d) => d.id === b.dataset.del)) tombstone('body_measures', b.dataset.del);
    })
  );
}
