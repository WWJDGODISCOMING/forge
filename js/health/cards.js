// HTML for the W2b cards: insight cards, the goal path, the Body Profile grid and sparklines.
// Strings only (no DOM calls), so Today, Body and the Trends screen share them.
import { esc } from '../ui.js';
import { addDays, daysBetween } from '../weight/smoothing.js';
import { weightToDisplay, weightUnit, formatWeight } from '../units.js';
import { FFMI_BANDS, FMI_BANDS } from './bodyprofile.js';
import { icon, emptyState } from '../ui/icons.js';
import { chartWidth } from '../ui/charts.js';

const fmtDate = (key, withYear = false) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }).replace(/ /g, ' '); // a date never splits across lines

// ---- insight cards ----

export function insightCardsHtml(cards) {
  return cards.map((c) => `
    <article class="insight ${esc(c.tone || 'neutral')}" data-insight="${esc(c.id)}">
      <a class="insight-main" href="${esc(c.href)}">
        <b class="insight-title">${esc(c.title)}</b>
        <span class="insight-body">${esc(c.body)}</span>
        <span class="insight-why"><b>Why:</b> ${esc(c.why)}</span>
        <span class="insight-do"><b>Try:</b> ${esc(c.todo)}</span>
        ${c.note ? `<small class="insight-note">${esc(c.note)}</small>` : ''}
      </a>
      <button class="insight-x" data-dismiss="${esc(c.id)}" aria-label="Hide “${esc(c.title)}” for 7 days">${icon('close')}</button>
    </article>`).join('');
}

/** Today's compact form: dot + title + one line; tap to open Why / Try inline. */
export function compactInsightsHtml(cards) {
  return cards.map((c) => `
    <article class="insight compact ${esc(c.tone || 'neutral')}" data-insight="${esc(c.id)}">
      <button class="insight-head" data-insight-toggle aria-expanded="false">
        <b class="insight-title">${esc(c.title)}</b>
        <span class="insight-body">${esc(c.body)}</span>
      </button>
      <div class="insight-more" hidden>
        <span class="insight-why"><b>Why:</b> ${esc(c.why)}</span>
        <span class="insight-do"><b>Try:</b> ${esc(c.todo)}</span>
        ${c.note ? `<small class="insight-note">${esc(c.note)}</small>` : ''}
        <span class="row gap"><a class="btn ghost small grow" href="${esc(c.href)}">See details</a><button class="btn ghost small grow" data-dismiss="${esc(c.id)}">Hide for 7 days</button></span>
      </div>
    </article>`).join('');
}

/** Wire the dismiss buttons under root. dismiss(id) saves it; the screen redraws from the settings change. */
export function bindInsightCards(root, dismiss, rerender) {
  root.querySelectorAll('[data-insight-toggle]').forEach((b) => {
    b.onclick = () => {
      const more = b.parentElement.querySelector('.insight-more');
      more.hidden = !more.hidden;
      b.setAttribute('aria-expanded', String(!more.hidden));
    };
  });
  root.querySelectorAll('[data-dismiss]').forEach((b) => {
    b.onclick = () => { dismiss(b.dataset.dismiss); const card = b.closest('.insight'); if (card) card.remove(); if (rerender) rerender(); };
  });
}

// ---- sparkline of {day, v} points ----

/** minSpan: the smallest value range the full height stands for (default 5% of the mean), so a steady
 * metric draws nearly flat, centred, instead of being stretched to fill the box. */
export function sparkSvg(points, today, days = 28, { width = 84, height = 28, minSpan } = {}) {
  const from = addDays(today, -(days - 1));
  const pts = points.filter((p) => p.day >= from && p.day <= today);
  if (pts.length < 2) return '<svg viewBox="0 0 84 28" class="spark" aria-hidden="true"></svg>';
  const vals = pts.map((p) => p.v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const span = Math.max(hi - lo, minSpan > 0 ? minSpan : Math.abs(mean) * 0.05) || 1;
  const mid = (hi + lo) / 2;
  const d = pts.map((p, i) => {
    const x = 2 + (daysBetween(from, p.day) / (days - 1)) * (width - 4);
    const y = 2 + (0.5 - (p.v - mid) / span) * (height - 4);
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ---- goal path ----

/** A small chart: the last 28 days of trend, then a dashed line to the goal with the 80% band shaded. */
export function goalPathSvg(path, series, today, goalKg, units, { width = chartWidth(), height = 150 } = {}) {
  const from = addDays(today, -27);
  const pts = series.filter((p) => p.day >= from && p.day <= today);
  if (pts.length < 2) return '';
  const endDay = path.status === 'ok' ? (path.lateDay || addDays(path.etaDay, Math.max(14, daysBetween(today, path.etaDay)))) : today;
  const span = Math.max(1, daysBetween(from, endDay));
  const L = 40, R = 10, T = 10, B = 22;
  const vals = pts.map((p) => p.trend).concat(path.status === 'ok' ? [goalKg] : []);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const pad = Math.max(0.4, (max - min) * 0.15);
  min -= pad; max += pad;
  const x = (day) => L + (daysBetween(from, day) / span) * (width - L - R);
  const y = (kg) => T + (1 - (kg - min) / (max - min)) * (height - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.trend).toFixed(1)}`).join(' ');
  const now = pts[pts.length - 1];
  let proj = '';
  if (path.status === 'ok') {
    const g = y(goalKg).toFixed(1);
    const x0 = x(today).toFixed(1), y0 = y(now.trend).toFixed(1);
    const slow = path.lateDay ? `${x(path.lateDay).toFixed(1)},${g}` : `${x(endDay).toFixed(1)},${y0}`; // no end to the band: the slow edge stays level
    proj = `<polygon class="gp-band" points="${x0},${y0} ${x(path.earlyDay).toFixed(1)},${g} ${slow}"/>
      <line class="gp-proj" x1="${x0}" y1="${y0}" x2="${x(path.etaDay).toFixed(1)}" y2="${g}"/>
      <line class="gp-goal" x1="${L}" x2="${width - R}" y1="${g}" y2="${g}"/>
      <text x="${L + 4}" y="${Math.max(T + 9, Math.min(height - B - 4, Number(g) - 4)).toFixed(1)}" class="axis" text-anchor="start">Goal ${esc(formatWeight(goalKg, units, 0))}</text>`;
  }
  const disp = (kg) => weightToDisplay(kg, units).toFixed(0);
  return `<svg viewBox="0 0 ${width} ${height}" class="chart goalpath" role="img" aria-label="Weight trend and projection to your goal">
    <text x="${L - 6}" y="${(y(max - pad) + 4).toFixed(1)}" class="axis" text-anchor="end">${disp(max - pad)}</text>
    <text x="${L - 6}" y="${(y(min + pad) + 4).toFixed(1)}" class="axis" text-anchor="end">${disp(min + pad)}</text>
    ${proj}<path d="${line}" class="trend"/>
    <text x="${L}" y="${height - 5}" class="axis">${fmtDate(from)}</text>
    <text x="${width - R}" y="${height - 5}" class="axis" text-anchor="end">${fmtDate(endDay)}</text>
  </svg>`;
}

export function goalPathHtml(path, energy, { series, today, goalKg, units }) {
  const unit = weightUnit(units);
  const perWeek = (kg) => `${weightToDisplay(Math.abs(kg), units).toFixed(1)} ${unit}`;
  let head;
  switch (path.status) {
    case 'none': head = '<p class="muted">Weigh in a few more times over a couple of weeks and your goal date appears here.</p>'; break;
    case 'nogoal': head = '<p class="muted">Set a goal weight in Settings → Profile to see when you will get there.</p>'; break;
    case 'reached': head = '<p class="big-title">You have reached your goal weight</p>'; break;
    case 'flat': head = '<p>Your trend is flat right now, so there is no date yet. A small change in food or training will get it moving.</p>'; break;
    case 'away': head = '<p>Your trend is moving a little away from your goal. That is normal and it can turn around. No date for now: a small change in food or training usually does it.</p>'; break;
    case 'far': head = '<p>At this pace your goal is more than five years away. A small change in food or training would bring it much closer.</p>'; break;
    default: {
      // Show the year on both ends of the range whenever either one is outside this year, so it never reads backwards.
      const yr = [path.earlyDay, path.lateDay].some((d) => d && d.slice(0, 4) !== today.slice(0, 4));
      head = `<p class="big-title">Around ${fmtDate(path.etaDay, true)}</p>
      <p class="small muted">Likely between ${fmtDate(path.earlyDay, yr)} and ${path.lateDay ? fmtDate(path.lateDay, yr) : 'later, the pace is still settling'}.</p>${daysBetween(today, path.etaDay) > 365 ? '<p class="small">That\'s more than a year at your current pace.</p>' : ''}`;
    }
  }
  const pace = path.slopePerWeek != null ? `<p class="small" data-pace>Pace: <b>${path.slopePerWeek < 0 ? 'down' : 'up'} ${perWeek(path.slopePerWeek)} a week</b> · usual safe limit about ${perWeek(path.capKgPerWeek)} a week.${path.overCap && path.status !== 'away' ? ' That is a little fast. Eating a bit more protects your muscle.' : ''}</p>` : '';
  const en = energy ? `<p class="small" data-energy>Energy balance from your body changes: about <b>${energy.kcalPerDay > 0 ? '+' : '−'}${Math.round(Math.abs(energy.kcalPerDay) / 10) * 10} kcal a day</b> <span class="muted">(estimate${energy.usedLean ? '' : ', fat only'})</span></p>` : '';
  const chart = ['ok', 'away', 'flat', 'far'].includes(path.status) && Number.isFinite(goalKg) ? goalPathSvg(path, series, today, goalKg, units) : '';
  return `<div class="card stack" data-goalpath>
    <p class="label">Goal path</p>
    ${head}${chart}${pace}${en}
    <p class="small muted">Based on your last 4 weeks. The range shows how much your weigh-ins bounce around.</p>
  </div>`;
}

// ---- body profile ----

export function bodyProfileHtml(bp, { sex, age }) {
  const who = `${sex === 'male' ? 'men' : sex === 'female' ? 'women' : 'adults'}${age ? `, you are ${age}` : ''}`;
  let inner;
  if (bp.status === 'needs-height') {
    inner = emptyState({ icon: 'person', title: 'Add your height', text: 'Body Profile needs your height to compare lean mass and body fat.', action: { href: '#/profile', label: 'Open profile' } });
  } else if (bp.status === 'needs-comp') {
    inner = emptyState({ icon: 'scale', title: 'Needs body fat from your scale', text: 'Body Profile needs your height plus fat mass or fat-free mass. Weigh in on a smart scale barefoot and it appears.', action: { href: '#/withings', label: 'Scale settings' } });
  } else {
    const cells = [];
    for (let row = 3; row >= 0; row--) {
      for (let col = 0; col < 4; col++) {
        const dots = [
          ...bp.trail.filter((t) => t.col === col && t.row === row).map((t) => `<i class="bp-trail" title="${esc(t.month)}"></i>`),
          bp.col === col && bp.row === row ? '<i class="bp-now" aria-hidden="true"></i><span class="bp-you" aria-hidden="true">You</span>' : '',
        ].join('');
        cells.push(`<div class="bp-cell r${row} c${col}">${dots}</div>`);
      }
    }
    inner = `<div class="bp-wrap"><span class="bp-y">Fat →</span>
      <div class="bp-grid" role="img" aria-label="You: lean mass ${FFMI_BANDS[bp.col]}, body fat ${FMI_BANDS[bp.row]}">${cells.join('')}</div>
      <span></span><div class="bp-x"><span>Low</span><span>Lean mass →</span><span>High</span></div></div>
      <p><b>Lean mass: ${FFMI_BANDS[bp.col]}</b> (FFMI ${bp.ffmi.toFixed(1)}) · <b>Body fat: ${FMI_BANDS[bp.row]}</b> (FMI ${bp.fmi.toFixed(1)})</p>
      <p class="small muted">The bright dot (You) is now. Faint dots are earlier months. Ranges are approximate and not adjusted for age.</p>`;
  }
  return `<div class="card stack" data-bodyprofile>
    <p class="label">Body profile</p>${inner}
    <details class="learn-more"><summary>What is this?</summary>
      <p class="small muted" style="margin-top:8px">FFMI is your lean mass divided by height squared. FMI is your fat mass divided by height squared. Putting both on one grid tells you more than BMI, which can’t tell muscle from fat. Based on Kyle UG et al., “Body composition interpretation”, Nutrition 2003;19:597-604. The bands are approximate adult reference ranges for ${who}, not adjusted for age. General information, not medical advice.</p>
    </details>
  </div>`;
}
