// Progress → Weekly report: one Monday–Sunday week, worked out on this phone from your existing data.
import { units as getUnits } from '../state.js';
import { esc, $, toast, formatDay } from '../ui.js';
import { weightToDisplay, weightUnit } from '../units.js';
import { fmtDelta } from '../health/delta.js';
import { reportText } from '../health/weektext.js';
import { progressTabs, progressRowsHtml } from './progress.js';
import { reportFor, currentReportWeek } from '../health/intel.js';
import { todayKey } from '../ui.js';
import { shiftWeek, mondayOf } from '../health/weekly.js';
import { ringSvg, round } from '../health/ui.js';
import { icon, emptyState } from '../ui/icons.js';

const MAX_WEEKS_BACK = 52;
let weekStart = null;

const dash = '—';

/** Headline for the week: the Forge Score change as one big number. */
function scoreHead(delta) {
  const d = delta == null ? null : fmtDelta(delta);
  if (!d) return '<p class="big-title">First week of scores</p>';
  if (d.same) return '<p class="big-title">Same as the week before</p>';
  return `<p class="hero-num w-hero" role="img" aria-label="${d.text} points ${d.sign > 0 ? 'up' : 'down'}"><span data-count>${d.text}</span> <small>points ${d.sign > 0 ? 'up' : 'down'}</small></p>`;
}

/**
 * One report line. dv is the change as a number (null = no comparison). A change that rounds to nothing at the
 * shown precision reads "same as last week" in neutral text. good: true / false = which way is good, null = no colour.
 */
function line(label, now, dv, { good = null, digits = 0, unit = '', post = '', note = null } = {}) {
  const d = dv == null ? null : fmtDelta(dv, { digits, unit });
  let cls = '';
  let html = note || '';
  if (d && d.same) html = 'same as last week';
  else if (d) {
    cls = good == null ? '' : (d.sign > 0) === good ? 'good' : 'warn';
    html = `${icon(d.sign > 0 ? 'arrowup' : 'arrowdown')} ${d.text}${post}`;
  }
  return `<li><span>${esc(label)}</span><b>${now}</b><small class="${cls}">${html}</small></li>`;
}

export { reportText };

export function renderWeekly(el) {
  const u = getUnits();
  const wu = weightUnit(u);
  const current = currentReportWeek();
  if (!weekStart || weekStart > current) weekStart = current;
  const r = reportFor(weekStart);
  const isCurrent = weekStart === current;
  const canBack = weekStart > shiftWeek(current, -MAX_WEEKS_BACK);
  const mass = (kg) => (kg == null ? null : weightToDisplay(kg, u)); // a change in your units
  const massOpts = { digits: 1, unit: wu };
  const wGood = r.goal === 'lose' || r.goal === 'recomp' ? false : r.goal === 'muscle' ? true : null;

  const scoreBlock = r.score.now != null ? `
    <div class="card stack" data-w-score>
      <p class="label">Forge Score</p>
      <div class="row gap center"><div class="score-mini">${ringSvg(r.score.now, { size: 84, stroke: 9 })}<b>${round(r.score.now)}</b></div>
        <div>${scoreHead(r.score.delta)}<p class="small muted">7-day average</p></div></div>
      <ul class="w-lines">${r.score.pillars.map((p) => line(p.label, p.now == null ? dash : round(p.now), p.delta, { good: true })).join('')}</ul>
    </div>` : '';

  const t = r.training;
  const body = r.hasData ? `
    <div class="pg-cols">
    <div class="col col-a">
    ${scoreBlock}
    <div class="card stack" data-w-body>
      <p class="label">Body</p>
      <ul class="w-lines">
        ${line('Weight trend', r.weight.now == null ? dash : `${weightToDisplay(r.weight.now, u).toFixed(1)} ${wu}`, mass(r.weight.change), { ...massOpts, good: wGood })}
        ${r.comp.fat.now != null ? line('Fat mass', `${weightToDisplay(r.comp.fat.now, u).toFixed(1)} ${wu}`, mass(r.comp.fat.change), { ...massOpts, good: r.goal === 'muscle' ? null : false }) : ''}
        ${r.comp.lean.now != null ? line('Fat-free mass', `${weightToDisplay(r.comp.lean.now, u).toFixed(1)} ${wu}`, mass(r.comp.lean.change), { ...massOpts, good: true }) : ''}
      </ul>
      <p class="small muted">${r.weight.weighIns} weigh-in${r.weight.weighIns === 1 ? '' : 's'} this week.</p>
    </div>
    <div class="card stack" data-w-training>
      <p class="label">Training</p>
      <ul class="w-lines">
        ${line('Workouts', `${t.workouts} of ${t.planned}`, null, { note: t.workouts >= t.planned ? 'Goal met' : null })}
        ${line('Volume', `${Math.round(weightToDisplay(t.volumeKg, u)).toLocaleString()} ${wu}`, t.volumeChangePct, { good: true, post: '% vs last week' })}
        ${line('Personal records', t.prs ? `${t.prs} ${icon('trophy', { filled: true })}` : '0', null)}
        ${line('Cardio', `${Math.round(t.cardioMin)} min`, null)}
      </ul>
    </div>
    </div>
    <div class="col col-b">
    ${r.nutrition ? `
    <div class="card stack" data-w-nutrition>
      <p class="label">Nutrition</p>
      <ul class="w-lines">
        ${line('Days logged', `${r.nutrition.daysLogged} of 7`, null)}
        ${line('Average calories', `${Math.round(r.nutrition.avgKcal).toLocaleString()} kcal`, null, { note: r.nutrition.targetKcal ? `target ${r.nutrition.targetKcal.toLocaleString()}` : null })}
        ${line('Average protein', `${Math.round(r.nutrition.avgProtein)} g`, null, { note: r.nutrition.targetProtein ? `target ${r.nutrition.targetProtein} g` : null })}
      </ul>
      <p class="small muted">Averages cover the days you logged.</p>
    </div>` : ''}
    ${r.recovery.hrv.now != null || r.recovery.rhr.now != null || r.recovery.sleep.now != null ? `
    <div class="card stack" data-w-recovery>
      <p class="label">Recovery</p>
      <ul class="w-lines">
        ${r.recovery.hrv.now != null ? line('Average HRV', `${Math.round(r.recovery.hrv.now)} ms`, r.recovery.hrv.change, { good: true, unit: 'ms' }) : ''}
        ${r.recovery.rhr.now != null ? line('Resting heart rate', `${Math.round(r.recovery.rhr.now)} bpm`, r.recovery.rhr.change, { good: false, unit: 'bpm' }) : ''}
        ${r.recovery.sleep.now != null ? line('Sleep a night', `${Math.floor(r.recovery.sleep.now / 60)} h ${String(Math.round(r.recovery.sleep.now % 60)).padStart(2, '0')}`, r.recovery.sleep.change, { good: true, unit: 'min' }) : ''}
      </ul>
    </div>` : ''}
    ${r.best || r.worst ? `<div class="card stack" data-w-bestworst>
      ${r.best ? `<p><span class="label">Best this week</span><br><b>${esc(r.best.label)}</b> <span class="good">moved the right way</span></p>` : ''}
      ${r.worst ? `<p><span class="label">Needs a look</span><br><b>${esc(r.worst.label)}</b> <span class="warn">moved the wrong way</span></p>` : ''}
    </div>` : ''}
    <div class="card stack suggest" data-w-suggest>
      <p class="label">One thing for next week</p>
      <p class="big-title">${esc(r.suggestion.text)}</p>
    </div>
    <button class="btn bigbtn" data-share>${icon('share')}Share</button>
    </div>
    </div>` : `
    <div class="card" data-empty>${emptyState({ icon: 'calendar', title: 'Nothing logged this week', text: 'Log a weigh-in or a workout and this report fills in. Use the arrows above to see an earlier week.', action: { href: '#/body/log', label: 'Log a weigh-in' } })}</div>`;

  el.innerHTML = `
    <section class="stack">
      ${progressTabs('weekly')}
      <h1>Weekly report</h1>
      <div class="row between center week-nav">
        <button class="btn ghost" data-prev aria-label="Previous week" ${canBack ? '' : 'disabled'}>${icon('back')}</button>
        <div class="tcenter" style="text-align:center"><b>${formatDay(r.days[0])} – ${formatDay(r.days[6])}</b><small class="muted" style="display:block">${isCurrent ? (r.partial ? 'So far this week' : 'Last full week') : 'Mon–Sun'}</small></div>
        <button class="btn ghost" data-next aria-label="Next week" ${isCurrent ? 'disabled' : ''}>${icon('chev')}</button>
      </div>
      ${body}
      ${progressRowsHtml()}
      <p class="disclaimer">General fitness information, not medical advice.</p>
    </section>`;

  $('[data-prev]', el).onclick = () => { weekStart = shiftWeek(weekStart, -1); renderWeekly(el); };
  $('[data-next]', el).onclick = () => { weekStart = shiftWeek(weekStart, 1); renderWeekly(el); };
  const share = $('[data-share]', el);
  if (share) share.onclick = async () => {
    const cur = mondayOf(todayKey());
    const text = reportText(r, u, weekStart !== cur ? reportFor(cur).training : null, todayKey());
    const copy = async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied to your clipboard'); } catch { toast('Couldn’t copy. Try again.'); }
    };
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: 'My Forge week', text }); } catch (e) { if (e && e.name !== 'AbortError') await copy(); /* cancelled: nothing to do */ }
  };
}
