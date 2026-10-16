// Body tab: weight and body composition, goal path, measures, programs and your progress photos. The recovery heatmap
// and the fresh-muscle count moved to Train (v0.15.20), next to the workout; the tile and a link here point there.
import { myBodyMeasures } from '../derived.js';
import { state, units as getUnits } from '../state.js';
import { $, todayKey } from '../ui.js';
import { topInsights, dismissInsight, intel, currentGoalPath, currentEnergy, currentBodyProfile } from '../health/intel.js';
import { insightCardsHtml, bindInsightCards, goalPathHtml, bodyProfileHtml } from '../health/cards.js';
import { currentRecovery, historyIndex } from '../workouts/plan.js';
import { freshCount, recoverySubtitle } from '../workouts/recovery.js';
import { BODY_METRICS, metricSeries, dailySeries, latestAndChange, fmtMetric, heightM, lastWeighInDay, compositionGap, staleCaption, daysBetween, OLD_READING_DAYS } from '../withings/body.js';
import { icon, emptyState } from '../ui/icons.js';
import { programsCard, bindProgramsCard } from '../body-programs/ui.js';
import { weightHeroHtml, weighInsHtml, bindWeight } from './weight.js';

// The card's date: the reading's time, or its day when an older entry has no timestamp (never "Invalid Date").
function bcDate(doc) {
  const d = new Date(doc.measured_at || (doc.day ? `${doc.day}T12:00:00` : NaN));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Body composition tiles: every metric the scale sent (plus BMI, FFMI, FMI), latest value and 30-day change.
function compositionCard() {
  const docs = myBodyMeasures();
  const w = state.integrations && state.integrations.withings;
  if (!docs.length) {
    return `<div class="card">${emptyState({ art: 'scale', icon: 'scale', title: w && w.connected ? 'Importing your history' : 'No body data yet', text: w && w.connected ? 'Your Withings history is on its way. This can take a few minutes.' : 'Connect your Withings scale to see fat, muscle, water and more here.', action: { href: '#/withings', label: w && w.connected ? 'See import progress' : 'Connect Withings' } })}</div>`;
  }
  const u = getUnits();
  const h = heightM(docs, state.profile);
  const latestDay = lastWeighInDay(docs);
  const gap = compositionGap(docs);
  const today = todayKey();
  const fresh = [];
  const old = [];
  BODY_METRICS.forEach((m) => {
    const pts = dailySeries(metricSeries(docs, m.key, { height: h })).map((p) => ({ ...p, at: p.at }));
    const lc = latestAndChange(pts, 30);
    if (!lc) return;
    const ch = lc.change;
    // Older than your latest weigh-in (e.g. the scale couldn't read body composition since): say when, calmly.
    const stale = latestDay && lc.last.day < latestDay;
    const sub = stale ? staleCaption(lc.last.day, today) : ch == null ? '&nbsp;' : `${ch > 0 ? '▲' : ch < 0 ? '▼' : '•'} ${fmtMetric(m.key, Math.abs(ch), u, { unit: false })} · 30d`;
    const tile = `<a class="bc-tile${stale ? ' stale' : ''}" href="#/metric/${m.key}"><span>${m.label}</span><b>${fmtMetric(m.key, lc.last.v, u)}</b><small class="muted">${sub}</small></a>`;
    (stale && daysBetween(lc.last.day, today) > OLD_READING_DAYS ? old : fresh).push({ key: m.key, tile });
  });
  const tiles = fresh.map((t) => t.tile).join('');
  // The Standing HR note sits next to the HR tile: under the grid when it is fresh, inside "Show older" when it is tucked away.
  const hrNote = '<p class="small muted" data-bc-hr>Standing HR is the heart rate your scale measures while you stand. It is usually higher than your resting heart rate.</p>';
  const hrFresh = fresh.some((t) => t.key === 'heart_pulse_bpm');
  const hrOld = old.some((t) => t.key === 'heart_pulse_bpm');
  const olderTiles = old.length ? `<details class="learn-more bc-older" data-bc-older><summary>Show older (${old.length})</summary><div class="bc-grid">${old.map((t) => t.tile).join('')}</div>${hrOld ? hrNote : ''}</details>` : '';
  const last = [...docs].sort((a, b) => (a.measured_at < b.measured_at ? 1 : -1))[0];
  return `<div class="card">
    <div class="row between"><p class="label">Body composition</p><span class="small muted">${last ? bcDate(last) : ''}</span></div>
    ${gap ? `<p class="notice info small" data-bc-gap>Your last ${gap === 1 ? 'weigh-in' : `${gap} weigh-ins`} had no body composition. Stand barefoot with dry feet on the electrodes and keep still until the scale finishes.</p>` : ''}
    <div class="bc-grid">${tiles}</div>${olderTiles}
    ${hrFresh ? hrNote : ''}
    <p class="small muted">From your scale. Tap any number for its chart and what it means.</p>
  </div>`;
}

function insightCards() {
  const cards = topInsights(3);
  return cards.length ? `<div class="insights stack" data-insights>${insightCardsHtml(cards)}</div>` : '';
}

/** Goal path for the Body tab (also used on the weight screen). */
export function goalPathCard() {
  const goalKg = state.profile && state.profile.targetWeightKg;
  return goalPathHtml(currentGoalPath(), currentEnergy(), { series: intel().weights, today: todayKey(), goalKg, units: getUnits() });
}

export function renderBody(el) {
  const rec = currentRecovery();
  const fresh = freshCount(rec);
  const last = historyIndex().done[0];
  // Order (v0.15.21): weight hero, goal path, programs, composition, measures, insights, Progress photos (accent), Recovery link, weigh-ins.
  // Wide (v0.15.24): col-a/col-b on top; below, col-d (photos, insights) on the left and col-c (Recovery link, weigh-ins) on the right.
  el.innerHTML = `
    <section class="stack">
      <h1>Body</h1>
      <div class="body-cols">
      <div class="col col-a">
      ${weightHeroHtml()}
      ${goalPathCard()}
      </div>
      <div class="col col-b">
      ${programsCard()}
      ${compositionCard()}
      ${myBodyMeasures().length ? bodyProfileHtml(currentBodyProfile(), state.profile || {}) : ''}
      </div>
      <div class="col col-d">
      <div data-photos-slot></div>
      ${insightCards()}
      </div>
      <div class="col col-c">
      <a class="card row between center nav-card" href="#/train/recovery" data-recovery-link><div><p class="label">Recovery map</p><p class="small">${recoverySubtitle(fresh, last)}</p></div><span class="chev" aria-hidden="true">${icon('chev')}</span></a>
      ${weighInsHtml()}
      </div>
      </div>
    </section>`;

  bindInsightCards(el, dismissInsight);
  bindProgramsCard(el);
  bindWeight(el, () => renderBody(el));
  import('../photos/cards.js').then((m) => m.mountBodyPhotosCard($('[data-photos-slot]', el)));
}
