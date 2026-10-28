// HTML for the Long term card and the Longevity cards on Progress → Score (v0.13.0). Strings only, no DOM calls.
import { esc } from '../ui.js';
import { emptyState } from '../ui/icons.js';
import { smoothFull } from './trends.js';
import { sparkSvg } from './cards.js';
import { fmtMetric } from '../withings/body.js';
import { RANGES, WEEKS_MIN } from './longterm.js';
import { FLOORS } from './longevity.js';

export const EMPTY_LONGEVITY = 'Longevity cards appear when your watch or scale sends VO₂max, resting heart rate, HRV or body composition.';

export { smoothFull };

const sign =(n) => (n > 0 ? '+' : n < 0 ? '−' : '');

/** The Long term card. lt: result of longTerm(); range: 90 | 365. */
export function longTermHtml(lt, range, today) {
  const seg = `<div class="seg small" role="radiogroup" aria-label="Long-term range">${[90, 365].map((r) =>
    `<label><input type="radio" name="ltrange" value="${r}" ${r === range ? 'checked' : ''}><span>${r === 90 ? '90 days' : '1 year'}</span></label>`).join('')}</div>`;
  if (lt.status !== 'ok') {
    return `<div class="card stack" data-longterm><p class="label">Long term</p>
      ${emptyState({ art: 'trend', icon: 'chart', title: lt.weeksSoFar ? 'Your long-term view is building' : 'No long-term view yet', text: `Your long-term view starts after ${WEEKS_MIN} weeks of data (${lt.weeksSoFar} of ${WEEKS_MIN} weeks so far).`})}</div>`;
  }
  const pts = smoothFull(lt.points.map((p) => ({ day: p.day, v: p.score })), 21);
  const rows = lt.pillars.map((p) => `<li class="lt-row"><span>${esc(p.label)}</span>
    <b class="${p.delta >= 2 ? 'good' : p.delta <= -2 ? 'warn' : 'muted'}"><span aria-hidden="true">${p.arrow}</span> ${p.delta === 0 ? 'No change' : `${sign(p.delta)}${Math.abs(p.delta)} point${Math.abs(p.delta) === 1 ? '' : 's'}`}</b></li>`).join('');
  return `<div class="card stack" data-longterm><div class="row between center"><p class="label" style="margin:0">Long term</p></div>
    ${seg}
    <div class="lt-spark" role="img" aria-label="Your weekly Forge Score over ${range === 90 ? '90 days' : 'the last year'}">${sparkSvg(pts, today, RANGES[range].days, { width: 300, height: 64 })}</div>
    <p class="big-title" style="margin:0">${esc(lt.sentence)}</p>
    ${rows ? `<ul class="lt-list">${rows}</ul>` : ''}
    <p class="small muted">Weekly averages of your Forge Score. Pillar changes compare your first weeks in this range with your latest.</p></div>`;
}

const FMT_KIND = { vo2max: 'vo2', rhr_bpm: 'bpm', hrv_sdnn_ms: 'ms', visceral_fat: 'index', ffmi: 'index' };

/** One plain sentence with units: "Up 0.6 ml/kg/min in 90 days, about the same". f formats a value in the metric's units. */
export function changeLine(c, f) {
  const n = c.ninety;
  if (!n.enough) return n.words;
  if (n.change == null || Number(f(Math.abs(n.change), false).replace(/,/g, '')) === 0) return 'About the same over the last 90 days.';
  const tail = n.direction === 'flat' ? 'about the same' : n.tone === 'good' ? 'a real improvement' : n.tone === 'bad' ? 'worth keeping an eye on' : '';
  return `${n.change > 0 ? 'Up' : 'Down'} ${f(Math.abs(n.change))} in 90 days${tail ? `, ${tail}` : ''}`;
}

/**
 * The Longevity metrics whose 90-day change is clearest, as [{ key, title, line }] (at most n): each card's own
 * sentence with units. "Clear" = the change in multiples of that metric's noise floor, so bpm and ml/kg/min compare fairly.
 */
export function clearestChanges(cards, units, n = 3) {
  return cards
    .filter((c) => c.ninety.enough && c.ninety.change != null)
    .map((c) => ({ c, size: Math.abs(c.ninety.change) / (FLOORS[c.key] || 1) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, n)
    .map(({ c }) => ({
      key: c.key,
      title: c.title,
      line: changeLine(c, (v, unit = true) => fmtMetric(c.key, v, units, { kind: FMT_KIND[c.key], unit })),
    }));
}

/** One Longevity card. */
function cardHtml(c, units, today) {
  const kind = FMT_KIND[c.key];
  const f = (v, unit = true) => fmtMetric(c.key, v, units, { kind, unit });
  const n = c.ninety;
  const line = changeLine(c, f);
  const subs = [];
  if (c.band) subs.push(`${esc(c.band.label)}${c.key === 'vo2max' ? ' for your age and sex (an estimate)' : ' for your height and sex'}`);
  if (c.key === 'vo2max') {
    if (c.rhr) subs.push(`Resting heart rate ${fmtMetric('rhr_bpm', c.rhr.v, units, { kind: 'bpm' })}`);
    if (c.vascularAge != null) subs.push(`Vascular age ${fmtMetric('vascular_age', c.vascularAge, units, { kind: 'years' })}`);
  }
  if (c.key === 'ffmi' && c.fatFreeKg != null) subs.push(`Fat-free mass ${fmtMetric('fat_free_mass_kg', c.fatFreeKg, units, { kind: 'mass' })}`);
  if (c.key === 'hrv_sdnn_ms' && c.usual) subs.push(c.usual.words);
  return `<a class="card lt-card" href="${c.link}">
    <div class="row between center"><strong>${esc(c.title)}</strong><b class="lt-val">${f(c.latest.v)}</b></div>
    ${n.enough ? `<div class="lt-spark ${n.tone}">${sparkSvg(smoothFull(c.series, 7), today, 90, { width: 300, height: 44 })}</div>` : ''}
    <p class="small ${n.tone === 'good' ? 'good' : n.tone === 'bad' ? 'warn' : 'muted'}" style="margin:0">${esc(line)}</p>
    ${subs.map((s) => `<p class="small muted" style="margin:0">${s}</p>`).join('')}
    <p class="small muted" style="margin:0">${esc(c.why)}</p></a>`;
}

/** The Longevity section: a card per metric with data, or one short line. */
export function longevityHtml(cards, units, today) {
  return `<div class="stack" data-longevity><p class="label" style="margin:0">Longevity</p>${cards.length ? cards.map((c) => cardHtml(c, units, today)).join('') : emptyState({ art: 'ring', icon: 'heart', title: 'No longevity cards yet', text: EMPTY_LONGEVITY, action: { href: '#/apple', label: 'Add Apple Health' } })}
    ${cards.length ? '<p class="small muted">Ranges are general estimates, not medical advice. Everything is compared with your own past, never with other people.</p>' : ''}</div>`;
}
