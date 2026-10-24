// HTML for the W2b cards: insight cards, the goal path, the Body Profile grid and sparklines.
// Strings only (no DOM calls), so Today, Body and the Trends screen share them.
import { esc } from '../ui.js';
import { addDays, daysBetween } from '../weight/smoothing.js';
import { weightToDisplay, weightUnit, formatWeight } from '../units.js';
import { FFMI_BANDS, FMI_BANDS, markPositions } from './bodyprofile.js';
import { icon, emptyState } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
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

// A change in lean or fat mass in the user's unit, one decimal, with a real minus sign ("+0.1 lb", "−0.2 lb").
function signed(kg, units) {
  const v = Number(weightToDisplay(kg, units).toFixed(1));
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)} ${weightUnit(units)}`;
}

// Grid units to the overlay: the grid is 4 cells with a 4px gap between them, so a point at (col + f) cells sits at
// col × (cell + gap) + f × cell. CSS gets it exact; the SVG line uses a nominal gap of BP_GAP cells (a 57px cell).
const BP_GAP = 0.07;
const bpLeft = (p) => `calc(${p.x.toFixed(3)} * (25% - 3px) + ${p.col * 4}px)`;
const bpTop = (p) => `calc(${p.y.toFixed(3)} * (25% - 3px) + ${(3 - p.row) * 4}px)`;
const bpSpot = (p) => `left:${bpLeft(p)};top:${bpTop(p)}`;

// A thin dashed line with a small head from last week's spot to this week's, in the same overlay as the dots.
function bpArrow(from, to) {
  const pt = (p) => [p.x + p.col * BP_GAP, p.y + (3 - p.row) * BP_GAP];
  const [x1, y1] = pt(from);
  const [x2, y2] = pt(to);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const gapEnd = Math.min(0.23, len * 0.35); // stop just short of the You dot (9px dot + 4px glow)
  const gapStart = Math.min(0.13, len * 0.2); // and of the ring (7px)
  const [ex, ey] = [x2 - ux * gapEnd, y2 - uy * gapEnd];
  const [sx, sy] = [x1 + ux * gapStart, y1 + uy * gapStart];
  const hl = Math.min(0.16, (len - gapEnd - gapStart) * 0.4); // the head is at most 40% of the drawn segment
  const hw = hl * 0.625;
  const head = [[ex - ux * hl - uy * hw, ey - uy * hl + ux * hw], [ex, ey], [ex - ux * hl + uy * hw, ey - uy * hl - ux * hw]].map((q) => q.map((n) => n.toFixed(3)).join(',')).join(' ');
  const size = 4 + 3 * BP_GAP;
  return `<svg class="bp-arrow" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none" aria-hidden="true" data-bp-arrow><line x1="${sx.toFixed(3)}" y1="${sy.toFixed(3)}" x2="${ex.toFixed(3)}" y2="${ey.toFixed(3)}"/><polyline points="${head}"/></svg>`;
}

/** Tapping the Last week marker shows or hides its date and values, with a light haptic. */
export function bindBodyProfile(root) {
  const b = root.querySelector('[data-bp-last]');
  const d = root.querySelector('[data-bp-detail]');
  if (!b || !d) return;
  b.onclick = () => {
    haptics.light();
    d.hidden = !d.hidden;
    b.setAttribute('aria-expanded', String(!d.hidden));
  };
}

export function bodyProfileHtml(bp, { sex, age }, units = 'imperial') {
  const who = `${sex === 'male' ? 'men' : sex === 'female' ? 'women' : 'adults'}${age ? `, you are ${age}` : ''}`;
  let inner;
  if (bp.status === 'needs-height') {
    inner = emptyState({ art: 'profile', icon: 'person', title: 'Add your height', text: 'Body Profile needs your height to compare lean mass and body fat.', action: { href: '#/profile', label: 'Open profile' } });
  } else if (bp.status === 'needs-comp') {
    inner = emptyState({ art: 'scale', icon: 'scale', title: 'Needs body fat from your scale', text: 'Body Profile needs your height plus fat mass or fat-free mass. Weigh in on a smart scale barefoot and it appears.', action: { href: '#/withings', label: 'Scale settings' } });
  } else {
    const cells = [];
    const lw = bp.lastWeek;
    const mk = markPositions(bp);
    for (let row = 3; row >= 0; row--) {
      for (let col = 0; col < 4; col++) {
        const dots = [
          ...bp.trail.filter((t) => t.col === col && t.row === row).map((t) => `<i class="bp-trail" title="${esc(t.month)}"></i>`),
          bp.col === col && bp.row === row ? `<span class="bp-you${bp.y - (3 - row) > 0.5 ? ' up' : ''}" aria-hidden="true">You</span>` : '', // the label sits on the side of the cell away from the dot
        ].join('');
        cells.push(`<div class="bp-cell r${row} c${col}">${dots}</div>`);
      }
    }
    const side = mk.last ? (mk.last.col === 0 ? ' l0' : mk.last.col === 3 ? ' l3' : '') : '';
    const over = `<div class="bp-over">${mk.line ? bpArrow(mk.last, mk.you) : ''}<i class="bp-now" style="${bpSpot(mk.you)}" aria-hidden="true"></i>${mk.last ? `<button type="button" class="bp-last${side}" style="${bpSpot(mk.last)}" data-bp-last aria-expanded="false" aria-label="Last week, ${esc(fmtDate(lw.day))}. Tap for details."><i aria-hidden="true"></i><span aria-hidden="true">Last week</span></button>` : ''}</div>`;
    const here = `You: lean mass ${FFMI_BANDS[bp.col]}, body fat ${FMI_BANDS[bp.row]}`;
    const then = lw ? `. Last week: lean mass ${FFMI_BANDS[lw.col]}, body fat ${FMI_BANDS[lw.row]}` : '';
    inner = `<div class="bp-wrap"><span class="bp-y">Fat →</span>
      <div class="bp-gridbox"><div class="bp-grid" role="img" aria-label="${here}${then}">${cells.join('')}</div>${over}</div>
      <span></span><div class="bp-x"><span>Low</span><span>Lean mass →</span><span>High</span></div></div>
      <p><b>Lean mass: ${FFMI_BANDS[bp.col]}</b> (FFMI ${bp.ffmi.toFixed(1)}) · <b>Body fat: ${FMI_BANDS[bp.row]}</b> (FMI ${bp.fmi.toFixed(1)})</p>
      ${lw ? `<p class="small" data-bp-since>Since last week: <span class="nw">lean mass <b>${signed(lw.dLeanKg, units)}</b></span>, <span class="nw">fat <b>${signed(lw.dFatKg, units)}</b></span></p>
      <p class="small bp-detail" data-bp-detail hidden role="status">Last week, ${esc(fmtDate(lw.day))}: lean mass ${formatWeight(lw.ffmKg, units)}, fat ${formatWeight(lw.fatKg, units)}.</p>` : ''}
      <p class="small muted">The bright dot (You) is now.${lw ? ' The ringed dot is last week.' : ''} Faint dots are earlier months. Ranges are approximate and not adjusted for age.</p>`;
  }
  return `<div class="card stack" data-bodyprofile>
    <p class="label">Body profile</p>${inner}
    <details class="learn-more"><summary>What is this?</summary>
      <p class="small muted" style="margin-top:8px">FFMI is your lean mass divided by height squared. FMI is your fat mass divided by height squared. Putting both on one grid tells you more than BMI, which can’t tell muscle from fat. Based on Kyle UG et al., “Body composition interpretation”, Nutrition 2003;19:597-604. The bands are approximate adult reference ranges for ${who}, not adjusted for age. General information, not medical advice.</p>
    </details>
  </div>`;
}
