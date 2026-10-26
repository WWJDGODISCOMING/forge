// Weekly recap: a Today card (Mon–Wed, once per week), a detail sheet, an optional share image, and a list of past recaps
// under Progress. Everything is worked out on this phone from existing data; no AI, nothing leaves the phone unless shared.
import { state, units as getUnits } from '../state.js';
import { esc, $, $$, sheet, toast, todayKey } from '../ui.js';
import { weightToDisplay, weightUnit } from '../units.js';
import { fmtDelta } from '../health/delta.js';
import { reportFor } from '../health/intel.js';
import { shiftWeek } from '../health/weekly.js';
import { buildRecap, recapDue, recapWeekFor, recapText, rowText } from '../health/recap.js';
import { missionSettings, weekMissionCounts } from '../missions/store.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { progressTabs, progressRowsHtml } from './progress.js';
import { shareImage, renderRecapImage } from '../ui/sharecard.js';

const MAX_PAST = 12;
const seenKey = () => `forge.recapSeen.${(state.user && state.user.uid) || ''}`;
const seenWeek = () => { try { return localStorage.getItem(seenKey()); } catch { return null; } };
const markSeen = (monday) => { try { localStorage.setItem(seenKey(), monday); } catch { /* private mode: it comes back on reload */ } };

const dayLabel = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const rangeLabel = (rc) => `${dayLabel(rc.days[0])} – ${dayLabel(rc.days[6])}`;

/** { r (weekly report), rc (recap), weightText } for the week starting `monday`. */
export function recapData(monday) {
  const r = reportFor(monday);
  const rc = buildRecap({ report: r, stepsGoal: missionSettings().steps, missions: weekMissionCounts(monday) });
  const u = getUnits();
  const d = rc.weightChange == null ? null : fmtDelta(weightToDisplay(rc.weightChange, u), { digits: 1, unit: weightUnit(u) });
  const weightText = d ? (d.same ? 'steady' : d.text) : '';
  return { r, rc, weightText };
}

/** One-line headline used on the card and in the list. */
function headline(rc, weightText) {
  if (rc.quiet) return 'A quiet week';
  const w = rc.rows.find((x) => x.key === 'workouts');
  return `${w.value} of ${w.goal} workouts${weightText ? ` · weight ${weightText}` : ''}`;
}

/** The card for Today, or '' when it is not due. */
export function recapCardHtml() {
  const today = todayKey();
  const monday = recapWeekFor(today);
  const { r, rc, weightText } = recapData(monday);
  if (!recapDue({ today, seen: seenWeek(), hasData: r.hasData })) return '';
  return `<button type="button" class="card stack nav-card recap-card" data-recap-card="${monday}" aria-label="Your week recap, ${esc(rangeLabel(rc))}. ${esc(headline(rc, weightText))}. Opens the details.">
    <span class="label">Your week · ${esc(rangeLabel(rc))}</span>
    <span class="big-title">${esc(headline(rc, weightText))}</span>
    <span class="small muted">${esc(rc.tip.text)}</span>
    <span class="small link">See your recap${icon('chev')}</span></button>`;
}

export function bindRecapCard(el) {
  const b = $('[data-recap-card]', el);
  if (b) b.onclick = () => { haptics.select(); openRecap(b.dataset.recapCard); b.remove(); }; // opening marks the week as seen
}

function bodyHtml(rc, weightText, r) {
  const rowsHtml = rc.rows.map((x) => `<li class="recap-row" data-recap-row="${x.key}"><span>${esc(x.label)}</span><b>${esc(rowText(x))}</b>${x.ratio != null ? `<i class="recap-bar" aria-hidden="true"><i style="width:${Math.round(x.ratio * 100)}%"></i></i>` : ''}</li>`).join('');
  return `<div class="stack recap" data-recap>
    <p class="label">${esc(rangeLabel(rc))}</p>
    ${rc.quiet ? '<p class="big-title">A quiet week</p><p class="muted">Nothing was logged, and that is okay. Weeks like this happen.</p>' : `
    <ul class="recap-list">
      ${weightText ? `<li class="recap-row" data-recap-row="weight"><span>Weight trend</span><b>${esc(weightText)}</b></li>` : ''}
      ${rowsHtml}
      <li class="recap-row" data-recap-row="prs"><span>Personal records</span><b>${rc.prs || 0}</b></li>
    </ul>`}
    <div class="card stack suggest" data-recap-tip>
      <p class="label">Focus for this week</p>
      <p class="big-title">${esc(rc.tip.text)}</p>
    </div>
    <div class="recap-actions">
      <button type="button" class="btn bigbtn" data-recap-share>${icon('share')}Share image</button>
      <a class="btn ghost bigbtn" href="#/weekly" data-recap-full>Full weekly report</a>
    </div>
    <p class="disclaimer">General fitness information, not medical advice.</p>
  </div>`;
}

/** The detail sheet for one week. Opening it marks that week as seen, so the Today card steps aside. */
export function openRecap(monday) {
  const { r, rc, weightText } = recapData(monday);
  if (monday === recapWeekFor(todayKey())) markSeen(monday);
  sheet('Your week', (body, close) => {
    body.innerHTML = bodyHtml(rc, weightText, r);
    const full = $('[data-recap-full]', body);
    if (full) full.addEventListener('click', () => close());
    const share = $('[data-recap-share]', body);
    share.onclick = async () => {
      haptics.light();
      try {
        const blob = await renderRecapImage(rc, weightText, rangeLabel(rc), rowText);
        if (!blob) throw new Error('no image');
        const how = await shareImage(blob, `forge-week-${monday}.png`, 'My Forge week');
        if (how === 'downloaded') toast('Image saved');
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        try { await navigator.clipboard.writeText(recapText(rc, rangeLabel(rc), weightText)); toast('Copied to your clipboard'); } catch { toast('Couldn’t share. Try again.'); }
      }
    };
  });
}

/** Past recaps (Progress → Weekly recaps): the last weeks that have anything in them, newest first. */
export function renderRecaps(el) {
  const today = todayKey();
  const first = recapWeekFor(today);
  const items = [];
  for (let i = 0; i < 52 && items.length < MAX_PAST; i++) {
    const monday = shiftWeek(first, -i);
    const { r, rc, weightText } = recapData(monday);
    if (r.hasData) items.push({ monday, rc, weightText });
  }
  el.innerHTML = `
    <section class="stack">
      ${progressTabs('weekly')}
      <h1>Weekly recaps</h1>
      ${items.length ? `<div class="group" data-recap-list>${items.map((x) => `<button type="button" class="g-row" data-recap-open="${x.monday}" aria-label="Recap for ${esc(rangeLabel(x.rc))}. ${esc(headline(x.rc, x.weightText))}">
        <span class="g-text"><span>${esc(rangeLabel(x.rc))}</span><small>${esc(headline(x.rc, x.weightText))}</small></span><span class="chev">${icon('chev')}</span></button>`).join('')}</div>`
    : '<div class="card"><p class="muted">Your first recap shows up after your first week with a weigh-in, a workout or food logged.</p></div>'}
      ${progressRowsHtml()}
      <p class="disclaimer">General fitness information, not medical advice.</p>
    </section>`;
  $$('[data-recap-open]', el).forEach((b) => { b.onclick = () => { haptics.select(); openRecap(b.dataset.recapOpen); }; });
}
