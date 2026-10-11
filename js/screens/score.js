// Progress → Score: your Forge Score (7-day average), the five pillars, what moved it since last week, and
// the raw inputs behind every number. Never compared with any other app's score.
import { state } from '../state.js';
import { restoreAnchor } from '../ui/anchor.js';
import { esc, $, $$ } from '../ui.js';
import { progressTabs } from './progress.js';
import { currentScore } from '../health/today.js';
import { isNative } from '../native/bridge.js';
import { ringSvg, animateScoreRings, scoreColor, round } from '../health/ui.js';
import { PILLARS } from '../health/score.js';
import { weeklyScores, longTerm } from '../health/longterm.js';
import { longevityCards } from '../health/longevity.js';
import { longTermHtml, longevityHtml } from '../health/longview.js';
import { myBodyMeasures, weightSeries, foodTargets } from '../derived.js';
import { todayKey } from '../ui.js';
import { units } from '../state.js';

const DOC_URL = 'https://github.com/christianeverett1988-boop/forge/blob/main/docs/forge-score.md';

let open = null; // which pillar's details are showing
let ltRange = 90; // Long term card: 90 days or 365

// Weekly scores for a year, worked out once and again only when the data or the day changes.
let weeklyMemo = null;
function weekly() {
  const day = todayKey();
  const keys = [state.health_daily, state.body_measures, state.weights, state.workouts, state.cardio, state.profile, state.food_logs];
  if (weeklyMemo && weeklyMemo.day === day && keys.every((k, i) => weeklyMemo.keys[i] === k)) return weeklyMemo.value;
  const value = weeklyScores({
    rows: state.health_daily || [], series: weightSeries(), measures: myBodyMeasures(), workouts: state.workouts,
    cardio: state.cardio || [], profile: state.profile || {}, foodLogs: state.food_logs || [], targets: foodTargets(),
  }, day);
  weeklyMemo = { day, keys, value };
  return value;
}

const pct = (w) => `${Math.round(w * 100)}%`;

function tile(p) {
  const v = p.tracked && p.score != null ? p.score : null;
  return `<button class="pillar${p.tracked ? '' : ' off'}" data-pillar="${p.key}" aria-expanded="${open === p.key}" ${p.tracked ? '' : 'disabled'}>
    <span class="mini">${ringSvg(v, { size: 56, stroke: 7 })}<b>${v == null ? '—' : round(v)}</b></span>
    <span><strong>${esc(p.label)}</strong><small>${p.tracked ? `${pct(p.effective)} of score` : 'Not tracked yet'}</small></span>
  </button>`;
}

function detail(p) {
  const rows = p.components.map((c) => `<li>
    <div class="row"><b>${esc(c.label)}</b><span>${c.value == null ? '—' : round(c.value)}</span></div>
    <div class="bar" aria-hidden="true"><i style="width:${c.value == null ? 0 : round(c.value)}%;background:${scoreColor(c.value)}"></i></div>
    <small>${esc(c.raw || 'Not enough data yet')}</small></li>`).join('');
  return `<div class="card stack" data-detail>
    <div class="row between center"><p class="label" style="margin:0">${esc(p.label)} · ${p.score == null ? '—' : round(p.score)}</p><span class="small muted">${pct(p.effective)} of your score</span></div>
    <ul class="comp-list">${rows}</ul>
    <p class="small muted">Each part is scored 0–100 against a target (or against your own usual). The line under each name shows the real number it was worked out from. The full list of targets is in <a class="link" href="${DOC_URL}" target="_blank" rel="noopener">How the Forge Score works</a>.</p></div>`;
}

// Two columns (>= 840px): Long term moves under "What moved it" so the columns end together. The DOM stays in phone
// order and the card only moves while the wide query matches, so focus and VoiceOver follow the screen on every size.
let wideQuery = null;
let wideListener = null;
function arrangeScoreCols(el) {
  if (typeof matchMedia !== 'function') return;
  if (wideQuery && wideListener) wideQuery.removeEventListener('change', wideListener);
  wideQuery = matchMedia('(min-width: 840px)');
  const apply = () => {
    const slot = $('[data-longterm-slot]', el), home = $('[data-longterm-home]', el), a = $('.col-a', el);
    if (!slot || !home || !a) return;
    const focused = document.activeElement;
    const hadFocus = focused && focused !== document.body && slot.contains(focused);
    if (wideQuery.matches) a.append(slot); else home.after(slot);
    restoreAnchor(); // moving the card changes the page height; keep the one at the top of the screen where it was
    if (hadFocus && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  };
  wideListener = () => { if (el.isConnected) apply(); };
  wideQuery.addEventListener('change', wideListener);
  apply();
}

export function renderScore(el) {
  const s = currentScore();
  const hasData = s.score != null;
  const prevAvg = (() => {
    const v = s.days.slice(0, 7).map((d) => d.score).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();
  const diff = hasData && prevAvg != null ? round(s.score) - round(prevAvg) : null;
  const apple = (state.health_daily || []).length > 0;

  const hero = hasData ? `
    <div class="card stack">
      <div class="score-hero" role="img" aria-label="Forge Score ${round(s.score)} out of 100, 7-day average">
        ${ringSvg(s.score, { size: 212, stroke: 16 })}
        <div class="num"><b data-count>${round(s.score)}</b><small>7-day average</small></div>
      </div>
      <p class="tcenter small ${diff == null || diff === 0 ? 'muted' : diff > 0 ? 'good' : 'warn'}" style="text-align:center">${diff == null ? 'Your first week of scores' : diff === 0 ? 'Same as last week' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} ${diff > 0 ? 'up' : 'down'} from last week`}</p>
      <div class="score-days" role="img" aria-label="Your daily score for the last 14 days">
        ${s.days.map((d, i) => `<span class="${d.score == null ? '' : 'has'}${i === s.days.length - 1 ? ' today' : ''}" style="height:${d.score == null ? 4 : Math.max(6, round(d.score) * 0.56)}px"></span>`).join('')}
      </div>
      <p class="small muted" style="text-align:center">Last 14 days</p>
    </div>` : `
    <div class="card stack" data-no-score>
      <p class="big-title">${s.trackedCount > 0 ? `Based on ${s.trackedCount} of 5 parts so far` : 'Your score starts soon'}</p>
      <p class="muted">Forge scores five things: your body, recovery, sleep, training and (soon) food. It shows a number once at least ${s.minPillars} of them have data, so a score is never built from just one or two.</p>
      <ul class="reasons"><li>Log your weight a few times, or connect your Withings scale.</li><li>Finish a couple of workouts.</li>${apple ? '' : `<li>${isNative() ? 'Connect Apple Health' : 'Add Apple Health'} for recovery and sleep.</li>`}</ul>
      ${apple ? '' : `<p class="small muted">Apple Health adds your recovery and sleep.</p><a class="btn bigbtn" href="#/apple">${isNative() ? 'Connect Apple Health' : 'Add Apple Health'}</a>`}
    </div>`;

  const movers = s.movers.length ? `
    <div class="card stack">
      <p class="label">What moved it this week</p>
      ${s.movers.map((m) => `<button class="link mover" data-open="${m.pillar}" style="min-height:56px">
        <span class="arrow ${m.delta >= 0 ? 'up' : 'down'}" aria-hidden="true">${m.delta >= 0 ? '↑' : '↓'}</span>
        <div><b>${esc(PILLARS[m.pillar].label)}: ${esc(m.label)}</b>
        <small>${m.delta >= 0 ? 'Up' : 'Down'} ${Math.abs(round(m.delta))} points vs last week (${round(m.before)} → ${round(m.now)})</small></div></button>`).join('')}
    </div>` : hasData ? `<div class="card"><p class="label">What moved it</p><p class="muted">Nothing has changed much since last week. Steady is good.</p></div>` : '';

  el.innerHTML = `
    <section class="stack">
      ${progressTabs('score')}
      <h1>Forge Score</h1>
      <div class="pg-cols">
      <div class="col col-a">
      ${hero}
      ${movers}
      </div>
      <div class="col col-b">
      <div class="pillar-grid">${s.pillars.map(tile).join('')}</div>
      <div data-detail-slot>${open ? detail(s.pillars.find((p) => p.key === open)) : ''}</div>
      ${hasData ? `<p class="small muted tcenter" style="text-align:center" data-based-on>Based on ${s.trackedCount} of 5 parts</p>` : ''}
      ${s.notTracked.includes('nutrition') ? `<p class="small muted"><b>Nutrition: not tracked yet.</b> It lights up once you have logged food on 3 of the last 7 days. Until then its 15% is shared among the ${s.trackedCount} part${s.trackedCount === 1 ? '' : 's'} with data, so nothing is counted against you.</p>` : ''}
      <template data-longterm-home></template>
      <div data-longterm-slot>${longTermHtml(longTerm(weekly(), todayKey(), ltRange, { recentScored: hasData }), ltRange, todayKey())}</div>
      ${longevityHtml(longevityCards({ rows: state.health_daily || [], measures: myBodyMeasures(), profile: state.profile || {}, today: todayKey() }), units(), todayKey())}
      <details class="card">
        <summary>How is this worked out?</summary>
        <p class="small muted" style="margin-top:8px">Each day gets a score from 0 to 100, and you see the average of the last 7. Weights: Body 25%, Recovery 20%, Sleep 15%, Training 25%, Nutrition 15%. If a part has no data, its weight is shared out, never scored as zero. Your score is only ever compared with your own past weeks.</p>
      </details>
      </div>
      </div>
      <p class="disclaimer">General fitness information, not medical advice.</p>
    </section>`;

  animateScoreRings(el);
  arrangeScoreCols(el);
  const toggle = (key) => {
    open = open === key ? null : key;
    $$('[data-pillar]', el).forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.pillar === open)));
    $('[data-detail-slot]', el).innerHTML = open ? detail(s.pillars.find((p) => p.key === open)) : '';
    if (open) $('[data-detail]', el).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  $$('[data-pillar]', el).forEach((b) => (b.onclick = () => toggle(b.dataset.pillar)));
  const bindRange = () => $$('input[name=ltrange]', el).forEach((r) => (r.onchange = () => {
    ltRange = Number(r.value);
    $('[data-longterm-slot]', el).innerHTML = longTermHtml(longTerm(weekly(), todayKey(), ltRange, { recentScored: hasData }),ltRange, todayKey());
    bindRange();
  }));
  bindRange();
  $$('[data-open]', el).forEach((b) => (b.onclick = () => { open = null; toggle(b.dataset.open); }));
}
