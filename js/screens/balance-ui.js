// Eaten vs burned on Today and Food. The numbers come from js/nutrition/balance.js; this file only reads state and draws.
import { state } from '../state.js';
import { esc, sheet, todayKey, formatDay } from '../ui.js';
import { dayTotals } from '../food/core.js';
import { dayBalance, fmt, deficitText, deficitShort, weekTotals, weekText, loadEnergy } from '../nutrition/balance.js';
import { shiftDay } from '../health/metrics.js';
import { currentWeightKg } from '../derived.js';

const energyMap = () => (state.energy && Object.keys(state.energy).length ? state.energy : loadEnergy(state.user && state.user.uid));

/** The day's balance from what's on this phone (Apple energy) or in health_daily, or null with nothing to show. */
export function balanceOn(day, now = new Date(), logs = state.food_logs) {
  const e = energyMap()[day] || {};
  const row = (state.health_daily || []).find((r) => (r.id || r.day) === day);
  const active = e.active != null ? e.active : row && row.active_kcal != null ? row.active_kcal : null;
  return dayBalance({ eaten: dayTotals(logs, day).kcal, active, basal: e.resting, profile: state.profile && { ...state.profile, weightKg: currentWeightKg() || state.profile.weightKg }, today: day === todayKey(), now });
}

/** One line under Today's Food row, or ''. */
export function todayBalanceLine() {
  const b = balanceOn(todayKey());
  if (!b || (b.active == null && b.restingFrom !== 'apple')) return ''; // a prorated formula alone isn't worth a line on Today
  return `<p class="small muted balance-line" data-balance-line><span class="nb">Burned ${fmt(b.burned)} so far</span></p>`;
}

/** The deficit line right under the Calories line on Today (its own line, so the headline stays on one row) (same calculation and colours as the Food card's), or ''. The ceiling next to it never moves. */
export function todayDeficitHtml(b = balanceOn(todayKey())) {
  if (!b || (b.active == null && b.restingFrom !== 'apple')) return '';
  const d = deficitShort(b.deficit, b.eaten);
  const shown = b.partial && d && d !== 'Even' ? `${d} so far` : d; // not the ceiling: the day isn't over
  return d ? `<p class="small balance-deficit" data-today-deficit><b class="nb balance-net ${b.partial ? 'now' : b.deficit > 0 ? 'good' : 'over'}">${esc(shown)}</b></p>` : '';
}

/** The compact block under the Calories meter on the Food tab (a button: opens the 7-day sheet), or ''. */
export function balanceBlock(day) {
  const b = balanceOn(day);
  if (!b) return '';
  const d = deficitText(b.deficit, b.eaten);
  const shown = b.partial && d && d !== 'Even' ? `${d} so far` : d; // the day isn't over: no verdict, no warning colour
  const parts = [b.resting != null ? `resting ${fmt(b.resting)}` : '', b.active != null ? `active ${fmt(b.active)}` : ''].filter(Boolean).join(' + ');
  return `<button type="button" class="balance-block" data-balance aria-label="Eaten ${fmt(b.eaten)}, burned ${fmt(b.burned)}${shown ? `, ${esc(shown)}` : ''}. Open the last 7 days">
    <span class="label">Eaten vs burned</span>
    <span class="balance-nums"><span class="nb">Eaten <b>${fmt(b.eaten)}</b></span> · <span class="nb">Burned <b>${fmt(b.burned)}</b></span></span>
    <span class="small muted">${esc(parts)}${b.partial ? ' so far' : ''}</span>
    ${d ? `<b class="nb balance-net ${b.partial ? 'now' : b.deficit > 0 ? 'good' : 'over'}">${esc(shown)}</b>` : ''}</button>`;
}

/** The last 7 days (ending at `today`), oldest first: { day, balance }. */
export function lastSevenDays(today = todayKey(), now = new Date()) {
  return Array.from({ length: 7 }, (_, i) => { const day = shiftDay(today, i - 6); return { day, balance: balanceOn(day, now) }; });
}

export function openBalanceSheet() {
  const rows = lastSevenDays();
  const top = Math.max(1, ...rows.flatMap((r) => (r.balance ? [r.balance.eaten, r.balance.burned] : [])));
  const total = weekText(weekTotals(rows));
  sheet('Eaten vs burned', (body) => {
    body.innerHTML = `<div class="stack" data-balance-sheet>
      <div class="balance-bars" role="list">${rows.map((r) => {
        const b = r.balance;
        const label = formatDay(r.day, { weekday: 'short' });
        if (!b) return `<div class="bb-day" role="listitem" aria-label="${esc(label)}: no data"><span class="bb-cols"></span><small class="muted">${esc(label)}</small></div>`;
        const d = deficitText(b.deficit, b.eaten);
        return `<div class="bb-day" role="listitem" aria-label="${esc(`${label}: eaten ${fmt(b.eaten)}, burned ${fmt(b.burned)}${d ? `, ${d}` : ''}`)}">
          <span class="bb-cols"><i class="bb-eat" style="height:${(b.eaten / top) * 100}%"></i><i class="bb-burn" style="height:${(b.burned / top) * 100}%"></i></span>
          <small class="muted">${esc(label)}</small></div>`;
      }).join('')}</div>
      <p class="small muted legend"><i class="bb-eat-sw"></i> Eaten <i class="bb-burn-sw"></i> Burned</p>
      ${total ? `<p><b data-week-deficit>${esc(total)}</b></p>` : '<p class="small muted">Log food and let Apple Health sync to see the week add up.</p>'}
      <p class="small muted">Your calorie target already allows for the activity level you picked. Burned is resting energy plus what your Apple Watch measured. Burning more doesn’t raise your target.</p>
    </div>`;
  });
}
