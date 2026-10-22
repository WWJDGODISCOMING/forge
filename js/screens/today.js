import { state, units as getUnits } from '../state.js';
import { esc, $, isStandalone, isIOS } from '../ui.js';
import { weightToDisplay, weightUnit } from '../units.js';
import { trendChange } from '../weight/smoothing.js';
import { sparklineSVG } from '../weight/chart.js';
import { weightSeries, currentTargets, latestWeighIn } from '../derived.js';
import { openLogWeight } from './weight.js';
import { readingLabel } from '../weight/reading.js';
import { activeWorkout, historyIndex, activeProgram } from '../workouts/plan.js';
import { deloadInfo } from '../workouts/generator.js';
import { dayKey } from '../weight/smoothing.js';
import { restoreAnchor } from '../ui/anchor.js';
import { todayKey } from '../ui.js';
import { playerRoute, previewPlan, startPlan } from './train.js';
import { todayRings } from '../workouts/rings.js';
import { weekOf } from '../workouts/awards.js';
import { exerciseById } from '../workouts/library.js';
import { ringsHtml, animateRings, snapshotRings, foodSummary, foodRingSvg } from '../ui/rings.js';
import { tourOfferDue } from '../tour/steps.js';
import { currentReadiness, currentScore, readinessOverridden, overrideReadiness } from '../health/today.js';
import { ringSvg, animateScoreRings, round } from '../health/ui.js';
import { icon } from '../ui/icons.js';
import { isNative } from '../native/bridge.js';
import { lastNativeRead } from '../native/autoread.js';
import { completionCards, afterCompletionCards } from '../body-programs/ui.js';
import { missionsCard, afterMissionsRender, badgeCelebrationCards, afterBadgeCelebrations } from '../missions/ui.js';
import { coachData } from '../coach/data.js';
import { availableQuestions } from '../coach/answers.js';
import { dayTotals } from '../food/core.js';
import { pickAlert, topFlag, reportOrScore } from '../home-order.js';

/** "Ask Coach: <first question that has an answer>", or just "Ask Coach". */
function coachTeaser() {
  try {
    const q = availableQuestions(coachData(), todayKey())[0];
    return q ? `Ask Coach: ${q.label}` : 'Ask Coach';
  } catch (e) { return 'Ask Coach'; }
}
import { topInsights, dismissInsight, reportFor, currentReportWeek, currentGoalPath } from '../health/intel.js';
import { compactInsightsHtml, bindInsightCards } from '../health/cards.js';
import { goalLine } from '../health/goalpath.js';
import { showReportCard, mondayOf } from '../health/weekly.js';
import { weekTitle } from '../health/weektext.js';
import { loadExpiryInfo, refreshDue } from '../native/expiry.js';
import { todayBalanceLine, todayDeficitHtml } from './balance-ui.js';
import { askButton, bindAsk } from './ask.js';
import { livePillHtml, bindLiveChips } from '../ui/live-chip.js';
import { refreshBannerHtml, openRefreshSheet } from '../native/refresh-ui.js';

/** Today's food against targets, for the rings. */
function foodToday(t) {
  const tot = dayTotals(state.food_logs, todayKey());
  return { kcal: tot.kcal, protein_g: tot.protein_g, targetKcal: t.calories, targetProtein: t.proteinG };
}

/** Food as one compact row (Food is a tab now): a small ring, today's numbers and Log food. Meals, macros and the "Why these numbers?" explainer live on the Food tab. */
function foodRow(t) {
  const tot = dayTotals(state.food_logs, todayKey());
  const n = (v) => Math.round(v).toLocaleString('en-US');
  const sum = foodSummary(tot, t);
  const aria = `Food today: ${n(tot.kcal)} of ${n(t.calories)} kcal, ${n(tot.protein_g)} of ${n(t.proteinG)} g protein`;
  return `<div class="card food-card food-row-compact" data-food-card data-tour="food">
    ${foodRingSvg(tot, t, aria)}
    <a class="food-card-text" href="#/food" aria-label="Food: ${n(tot.kcal)} of ${n(t.calories)} kcal. See meals">
      <p class="label">Food</p>
      <p class="food-card-kcal"><b data-tick="today-kcal">${n(tot.kcal)}</b> <small>of ${n(t.calories)} kcal</small></p>
      ${todayDeficitHtml()}
      <p class="small ${sum.over ? 'over' : 'muted'}"><span class="nb">${esc(sum.note)}</span> · <span class="nb">${esc(sum.protein)}</span></p>
      ${todayBalanceLine()}
    </a>
    <button class="btn small food-log-btn" data-food-log aria-label="Log food"><span class="fl-plus" aria-hidden="true">+</span><span class="fl-txt">Log food</span></button>
  </div>`;
}

/** One line at the very top of Today: opens Coach. Kept to a single line, normal size, so Today stays short. */
function coachLine() {
  return `<a class="card coach-line nav-card" href="#/coach" data-coach-card>
    <span class="coach-line-ic" aria-hidden="true">${icon('help')}</span><span class="coach-line-text">${esc(coachTeaser())}</span><span class="chev" aria-hidden="true">${icon('chev')}</span></a>`;
}

/** Once, after an update that adds screens: offer the tour to people who have already seen it. */
function tourOfferCard() {
  if (!tourOfferDue(state.profile)) return '';
  return `<div class="card stack tour-offer" data-tour-offer>
    <p class="label">New: Food and photos</p>
    <p class="small">Log meals on the Food tab, find your progress photos, and ask Coach. Want a one-minute look?</p>
    <div class="row gap"><button class="btn grow" data-tour-offer-show>Show me</button><button class="btn ghost grow" data-tour-offer-no>Not now</button></div></div>`;
}

function workoutCard() {
  const active = activeWorkout();
  if (active) {
    // Every set done but not saved yet (the app was closed on the Workout complete card): go straight back to it.
    const allDone = (active.exercises || []).some((x) => x.sets.length) && active.exercises.every((x) => x.sets.every((s) => s.done));
    return `<a class="card resume" data-tour="workout" data-workout-card="resume" href="${allDone ? '#/play' : playerRoute()}"><p class="label">${allDone ? 'All sets done' : 'Workout in progress'}</p>
      <p class="big-title">${esc(active.label)}</p><span class="btn">${allDone ? 'Finish' : 'Resume'}</span></a>`;
  }
  const doneToday = historyIndex().done.filter((w) => dayKey(w.started_at) === todayKey());
  if (doneToday.length) {
    const w = doneToday[0];
    const sets = (w.exercises || []).reduce((n, it) => n + it.sets.filter((x) => x.done && !x.warmup).length, 0);
    return `<div class="card" data-tour="workout" data-workout-card="done"><p class="label">Today’s workout</p>
      <p class="big-title">${icon('check', { filled: true })} ${esc(w.label)}</p>
      <p class="small muted">${sets} sets${(w.prs || []).length ? ` · ${w.prs.length} PR${w.prs.length === 1 ? '' : 's'} ${icon('trophy', { filled: true })}` : ''}. Recovery starts now.</p>
      <a class="btn ghost" href="#/history">See history</a></div>`;
  }
  const plan = previewPlan(); // with any edits you made on Train
  if (!plan || !plan.exercises.length) return '';
  return `<div class="card" data-tour="workout" data-workout-card="start"><div class="row between center card-head"><p class="label">Today’s workout${plan.deload ? ' · deload' : ''}</p><a class="card-link" href="#/train">See plan${icon('chev', { size: 14 })}</a></div>
    <div class="row between center gap"><div class="grow-min"><p class="big-title">${esc(plan.label)}</p>
    <p class="small muted">${plan.exercises.length} exercises · ${plan.est_minutes} min</p>
    <p class="small muted one-line" data-layout-ok data-workout-place>${esc(plan.location.name)}</p></div><button class="btn small" data-start>Start</button></div>
    ${plan.readiness ? `<p class="small ${plan.readiness === 'red' ? 'warn' : 'muted'}">Readiness ${plan.readiness}: ${plan.readiness === 'red' ? 'a lighter day' : 'one less set on accessories'}</p>` : ''}
  </div>`;
}

const LEVEL_WORD = { green: 'Green', amber: 'Amber', red: 'Red' };
const LEVEL_DO = {
  green: 'Good to train as planned.',
  amber: 'Go a little easier today: one set less on each accessory.',
  red: 'Your body is asking for a lighter day. Forge made today’s workout short and easy. Mobility or a walk works too.',
};

/** Readiness (Green / Amber / Red) from Apple Health, or a gentle prompt to set it up. */
function readinessCard() {
  const r = currentReadiness();
  const hasHealth = (state.health_daily || []).length > 0;
  if (r.status === 'none' && !hasHealth) {
    return `<a class="card row between center nav-card" href="#/apple" data-readiness>
      <div><p class="label">Readiness</p><p>${isNative() ? 'Connect Apple Health to see how ready you are each morning.' : 'Add your Apple Watch data to see how ready you are each morning.'}</p></div><span class="chev" aria-hidden="true">${icon('chev')}</span></a>`;
  }
  if (r.status === 'building' || r.status === 'none') {
    const have = Math.min(r.needed, r.baselineDays || 0);
    return `<a class="card stack nav-card" href="#/apple" data-readiness><p class="label">Readiness</p>
      <p>Getting to know your normal: <b data-count>${have} of ${r.needed} days</b>.</p>
      <div class="ready-progress"><i style="width:${Math.round((have / r.needed) * 100)}%"></i></div>
      <p class="small muted">${isNative() ? (lastNativeRead(state.user && state.user.uid) ? `Forge has your history. Readiness fills in as your Watch records more nights: ${Math.max(0, r.needed - have)} to go.` : 'Tap here and choose Connect Apple Health: it reads your history right away.') : 'Import your Health export in Settings → Apple Health to get there today.'}</p></a>`;
  }
  if (r.status === 'waiting') {
    return `<a class="card stack nav-card" href="#/apple" data-readiness><p class="label">Readiness</p>
      <p>Waiting for this morning’s Watch data.</p><p class="small muted">${isNative() ? 'Open Forge after you wake up and it reads Apple Health by itself. Or tap here and choose Read Apple Health now.' : 'It arrives when your Shortcut runs after you wake up.'}</p></a>`;
  }
  const over = readinessOverridden();
  const bars = r.parts.filter((p) => p.key !== 'load').map((p) => `<span class="${p.dir === 'bad' ? 'bad' : p.dir === 'low' ? 'low' : p.dir === 'good' || p.dir === 'ok' ? 'ok' : 'meh'}" title="${esc(p.text)}"><i></i></span>`).join('');
  return `<div class="card ready-card ${r.level}" data-readiness>
    <div class="ready-head"><span class="ready-pill">${LEVEL_WORD[r.level]}</span><button class="link small ready-why-btn" data-ready-why aria-expanded="false">Why?</button></div>
    ${r.stale ? '<p class="ready-stale" data-ready-stale>Based on yesterday · waiting for this morning’s data. Today’s workout isn’t changed yet.</p>' : ''}
    <p class="ready-why">${esc(r.reason)}</p>
    <p class="ready-do">${over && r.level !== 'green' ? 'You chose to train as planned today.' : LEVEL_DO[r.level]}</p>
    ${r.level === 'red' && !over && !r.stale ? '<button class="btn ghost bigbtn" data-ready-override>Train as planned anyway</button>' : ''}
    ${over && r.level !== 'green' ? '<button class="btn ghost bigbtn" data-ready-again>Use Readiness again</button>' : ''}
    <div class="ready-bars" aria-hidden="true">${bars}</div>
    <ul class="ready-parts" data-ready-parts hidden>${r.parts.map((p) => `<li class="${p.dir === 'bad' ? 'bad' : p.dir === 'low' ? 'warn' : p.dir === 'good' ? 'good' : ''}">${esc(p.text)}</li>`).join('')}</ul>
  </div>`;
}

/** The 7-day Forge Score, with a tap-through to the Score screen. */
function scoreCard() {
  const s = currentScore();
  if (s.score == null) return '';
  return `<a class="card score-card" href="#/score" data-score>
    <div class="score-mini">${ringSvg(s.score, { size: 84, stroke: 11 })}<b data-count>${round(s.score)}</b></div>
    <div><p class="label" style="margin:0">Forge Score</p><p class="small muted">7-day average${s.movers[0] ? ` · ${esc(s.movers[0].label)} ${s.movers[0].delta >= 0 ? 'up' : 'down'}` : ''}</p></div>
    <span class="chev" aria-hidden="true">${icon('chev')}</span></a>`;
}

/** Sunday / Monday: the weekly report, with its one suggestion. Titled by the week it covers, with this week's live count beside it. */
function weeklyCard() {
  if (!showReportCard(todayKey())) return '';
  const wk = currentReportWeek();
  const r = reportFor(wk);
  if (!r.hasData) return '';
  const cur = mondayOf(todayKey());
  const now = wk === cur ? null : reportFor(cur).training; // this week so far (on Sunday the report already is this week)
  return `<a class="card stack nav-card" href="#/weekly" data-weekly-card>
    <div class="row between center"><p class="label">${esc(weekTitle(r, todayKey()))}</p>${now ? `<span class="small muted nb" data-week-live>This week ${now.workouts}/${now.planned} so far</span>` : ''}</div>
    <p class="big-title">${r.training.workouts} of ${r.training.planned} workouts${r.score.delta ? ` · Score ${r.score.delta > 0 ? 'up' : 'down'} ${Math.abs(round(r.score.delta))}` : ''}</p>
    <p class="small muted">${esc(r.suggestion.text)}</p><span class="small link">See the full report${icon('chev')}</span></a>`;
}

/** At most 2 compact insight cards (ranked by severity × recency); tap to expand, hide for 7 days. Full cards live on Body. */
function insightsBlock() {
  const r = currentReadiness();
  // Readiness already says "short sleep" when it is amber or red for sleep: don't say it twice.
  const sleepShown = r.status === 'ok' && r.level !== 'green' && (r.parts || []).some((p) => p.key === 'sleep' && (p.dir === 'bad' || p.dir === 'low'));
  const cards = topInsights(4).filter((c) => !(sleepShown && c.id === 'anomaly:sleep')).slice(0, 2);
  return cards.length ? `<div class="insights stack" data-insights>${compactInsightsHtml(cards)}</div>` : '';
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Two columns (>= 840px): slot numbers on the left or right. The DOM stays in the phone's reading order and only
// moves into columns while the wide query matches, so VoiceOver and Tab order follow the screen on every size.
const LEFT_SLOTS = new Set(['1']); // Ask Coach stays first on the left; workout, food, report and photo stay right (Food stays high in its column: lower down, a fold can't scroll far enough to keep it where the reader had it)
const FLEX_SLOTS = ['3', '4', '6', '9', '10']; // rings, missions, weight, readiness, insights: they go on whichever side leaves the two columns closest in height (a rest day has no workout card, so the right column is shorter)
let wideQuery = null;
let wideListener = null;
function arrangeTodayCols(el) {
  if (typeof matchMedia !== 'function') return;
  if (wideQuery && wideListener) wideQuery.removeEventListener('change', wideListener);
  wideQuery = matchMedia('(min-width: 840px)');
  const apply = () => {
    const host = $('[data-today-cols]', el);
    if (!host) return;
    const focused = document.activeElement; // moving a node drops focus to the page, so put it back (VoiceOver, keyboard)
    const hadFocus = focused && focused !== document.body && host.contains(focused);
    const slots = [...host.querySelectorAll('.slot')].sort((a, b) => Number(a.dataset.o) - Number(b.dataset.o));
    if (wideQuery.matches) {
      const a = document.createElement('div'); a.className = 'col col-a';
      const b = document.createElement('div'); b.className = 'col col-b';
      host.replaceChildren(a, b);
      const side = new Map(FLEX_SLOTS.map((o) => [o, 'a']));
      const put = () => { for (const sl of slots) (LEFT_SLOTS.has(sl.dataset.o) || side.get(sl.dataset.o) === 'a' ? a : b).append(sl); };
      put();
      const gap = () => Math.abs(a.getBoundingClientRect().height - b.getBoundingClientRect().height);
      let best = null;
      for (let mask = 0; mask < 1 << FLEX_SLOTS.length; mask++) { // 5 slots: 32 tries, measured on the real layout
        FLEX_SLOTS.forEach((o, i) => side.set(o, mask & (1 << i) ? 'b' : 'a'));
        put();
        const d = gap();
        if (!best || d < best.d - 0.5) best = { d, mask };
      }
      FLEX_SLOTS.forEach((o, i) => side.set(o, best.mask & (1 << i) ? 'b' : 'a'));
      put();
    } else {
      host.replaceChildren(...slots);
    }
    restoreAnchor(); // moving the cards changes the page height; keep the one at the top of the screen where it was
    if (hadFocus && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  };
  wideListener = () => { if (el.isConnected) apply(); };
  wideQuery.addEventListener('change', wideListener);
  apply();
}

export function renderToday(el) {
  const u = getUnits();
  const t = currentTargets();
  const series = weightSeries();
  const latest = series.length ? series[series.length - 1] : null;
  const change = trendChange(series, 7);
  const reading = latestWeighIn();
  const goal = state.profile.goal;
  const goalKg = state.profile.targetWeightKg;
  const fmtGoalDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.slice(0, 4) !== todayKey().slice(0, 4) ? { year: 'numeric' } : {}) }).replace(/ /g, ' '); // keep a date together
  const goalSentence = goalKg ? goalLine(currentGoalPath(), fmtGoalDay) : ''; // same fit as the Goal path card

  // Arrow color: green when the trend moves the way your goal wants.
  let arrow = '→', tone = 'neutral';
  if (change != null && Math.abs(change) >= 0.05) {
    arrow = change < 0 ? '↓' : '↑';
    const wantDown = goal === 'lose' || goal === 'recomp';
    const wantUp = goal === 'muscle';
    tone = (wantDown && change < 0) || (wantUp && change > 0) ? 'good' : wantDown || wantUp ? 'warn' : 'neutral';
  }

  const installHint = isIOS() && !isStandalone();
  const program = activeProgram();
  const deload = !!program && deloadInfo(program, state.profile.experience).deload;
  const rings = todayRings({ workouts: state.workouts, cardio: state.cardio || [], profile: state.profile, exerciseById, deload, food: foodToday(t) });

  const ringsBefore = snapshotRings($('.rings-card', el)); // a data refresh redraws Today: the arcs glide on from here
  const flag = topFlag(t.flags);
  // One banner at a time, most important first (see ALERT_PRIORITY); the losers wait for their turn.
  const alert = pickAlert({
    flags: () => (flag ? `<div class="notice ${flag.level}" data-alert="flags">${esc(flag.message)}</div>` : ''),
    install: () => (installHint ? `
      <div class="notice info" data-alert="install">
        <b>Install this app first.</b> Tap the Share button, then <b>Add to Home Screen</b>, and open it from there.
        iPhone can erase data from websites you don’t open for 7 days. Installed apps are protected.
      </div>` : ''),
    'program-done': () => completionCards(),
    badge: () => badgeCelebrationCards(),
    'tour-offer': () => tourOfferCard(),
  });
  const report = reportOrScore({ weekly: weeklyCard(), score: scoreCard() }); // never both
  el.innerHTML = `
    <section class="stack today-stack">
      <header class="today-head">
        <p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1>${greeting()}</h1>
      </header>

      ${livePillHtml()}
      <div class="alert-slot" data-alert-slot>${alert.html}</div>

      <div class="today-cols" data-today-cols>
      <div class="slot" data-o="1">${coachLine()}</div>


      <div class="slot" data-o="2">${workoutCard()}</div>


      <div class="slot" data-o="3">
      <div class="card rings-card">
        <div class="row between center"><p class="label">Training and food</p>
          <span class="row gap"><a class="link small" href="#/weekly" data-this-week>This week</a><a class="link small" href="#/awards">Awards ${icon('chev', { size: 14 })}</a></span></div>
        ${ringsHtml(rings)}
      </div>
      </div>


      <div class="slot" data-o="4">${missionsCard()}</div>


      <div class="slot" data-o="5">${foodRow(t)}${askButton('ask-entry--today')}</div>


      <div class="slot" data-o="6">
      <div class="card weight-card">
        <div class="row between center card-head"><p class="label">Weight</p><a class="card-link" href="#/body/weight">See chart${icon('chev', { size: 14 })}</a></div>
        <div class="row between center weight-main" ${reading ? 'role="link" tabindex="0" data-weight-open' : ''}>
          <div class="weight-text">
            <p class="small muted" data-weight-when>${reading ? esc(readingLabel(reading, todayKey())) : ''}</p>
            <p class="hero-num">${reading ? `<span data-count data-tick="today-weight">${weightToDisplay(reading.kg, u).toFixed(1)}</span> <small>${weightUnit(u)}</small>` : '—'}</p>
            <p class="small ${tone}" data-weight-trend>${!latest || change == null ? 'Log a few days to see your trend' : `<span class="nw">Trend ${weightToDisplay(latest.trend, u).toFixed(1)}</span> · <span class="nw">${arrow} ${Math.abs(weightToDisplay(change, u)).toFixed(1)} this week</span>`}</p>
          </div>
          ${sparklineSVG(series)}
        </div>
        <div class="row between center weight-actions">
          <button class="weight-why small" type="button" data-layout-ok data-weight-why aria-expanded="false" aria-controls="weight-why-text">What’s trend weight?</button>
          <button class="btn small" data-log type="button">Log weight</button>
        </div>
        <p class="small muted" id="weight-why-text" data-weight-why-text hidden>Your trend smooths out daily ups and downs from water and salt, so it shows the real direction. Today’s number is just what the scale said.</p>
        ${goalSentence ? `<p class="small muted" data-goal-line>${esc(goalSentence)}</p>` : ''}
      </div>
      </div>


      <div class="slot" data-o="7">${report.html}</div>


      <div class="slot" data-o="8"><div data-photo-reminder></div></div>

      <div class="slot" data-o="9">${readinessCard()}</div>


      <div class="slot" data-o="10">${insightsBlock()}</div>

      </div>

      <p class="disclaimer">General fitness information, not medical advice.</p>
    </section>`;

  arrangeTodayCols(el);
  $('[data-log]', el).onclick = openLogWeight;
  $('[data-weight-why]', el).onclick = (e) => {
    const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
    e.currentTarget.setAttribute('aria-expanded', String(open));
    $('[data-weight-why-text]', el).hidden = !open;
  };
  bindAsk(el);
  bindLiveChips(el);
  $('[data-food-log]', el).onclick = () => import('./food.js').then((m) => m.openLogFood());
  const why = $('[data-ready-why]', el);
  if (why) why.onclick = () => {
    const list = $('[data-ready-parts]', el);
    list.hidden = !list.hidden;
    why.setAttribute('aria-expanded', String(!list.hidden));
    why.textContent = list.hidden ? 'Why?' : 'Hide';
  };
  const override = $('[data-ready-override]', el);
  if (override) override.onclick = () => {
    overrideReadiness(true);
    renderToday(el); // the plan and the card both redraw as "train as planned"
  };
  const again = $('[data-ready-again]', el);
  if (again) again.onclick = () => {
    overrideReadiness(false);
    renderToday(el);
  };
  const refreshSlot = isNative() ? $('[data-alert-slot]', el) : null; // the app-expiry banner outranks every other alert, so it takes the slot when it arrives
  if (refreshSlot) loadExpiryInfo().then((info) => {
    if (!refreshSlot.isConnected || !info || !refreshDue(info.at)) return;
    refreshSlot.innerHTML = refreshBannerHtml(info.at, info.exact);
    $('[data-app-refresh-banner]', refreshSlot).addEventListener('click', openRefreshSheet);
  });
  bindInsightCards(el, dismissInsight);
  afterMissionsRender();
  afterBadgeCelebrations(el);
  afterCompletionCards(el);
  import('../photos/cards.js').then((m) => m.mountPhotoReminder($('[data-photo-reminder]', el)));
  const sc = $('[data-score]', el);
  if (sc) animateScoreRings(sc);
  animateRings($('.rings-card', el), rings, weekOf(new Date().toISOString()), ringsBefore);
  const offerShow = $('[data-tour-offer-show]', el);
  if (offerShow) {
    offerShow.onclick = () => import('../tour/tour.js').then((m) => { m.dismissTourOffer(); m.startTour({ replay: true }); });
    $('[data-tour-offer-no]', el).onclick = () => import('../tour/tour.js').then((m) => m.dismissTourOffer());
  }
  const start = $('[data-start]', el);
  if (start) start.onclick = () => {
    const plan = previewPlan();
    if (plan && plan.exercises.length) startPlan(plan);
  };
}
