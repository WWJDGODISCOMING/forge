// Today rings: three concentric rings that fill on load, with a legend. A ring you close (Training or
// Weekly sets) gets a burst, once per week. Room is left in the legend grid for food rings (Checkpoint C).
import { reducedMotion } from './motion.js';
import { esc } from '../ui.js';
import { icon } from './icons.js';

const COLORS = { training: 'var(--ring-training)', sets: 'var(--ring-sets)', recovery: 'var(--ring-recovery)', calories: 'var(--ring-kcal)', protein: 'var(--ring-protein)' };
// Any ring at 100% glows lime, but only Training and Weekly sets throw confetti (going over on calories isn't a win).
const NO_CONFETTI = new Set(['recovery', 'calories', 'protein']);
// Canvas confetti can't read CSS variables, so the burst keeps plain colours: lime with a cyan sparkle.
const BURST = { training: '#C6FF3D', sets: '#C6FF3D', recovery: '#C6FF3D' };
const SPARKLE = '#3EC8F0';
// v0.16.0 hero: one 240 px cluster of three rings (Training outside, Recovery, Food inside). Weekly sets and
// Protein keep their legend rows and numbers, they just aren't drawn as rings any more.
const SIZE = 240;
const STROKE = 20;
const GAP = 7;
const CLUSTER = ['training', 'recovery', 'calories'];
const radius = (i) => SIZE / 2 - STROKE / 2 - 2 - i * (STROKE + GAP);

/** How much of a second lap an over-target ring shows (0..1); 0 when not over. */
export const overLap = (value) => (value > 1 ? Math.min(1, value - 1) : 0);

const NB = ' '; // numbers never part from their units
const num = (v) => Math.round(v).toLocaleString('en-US');

/** Eaten / target for protein, carbs and fat, with a small label so nobody reads a target as what they ate. */
export function macroTilesHtml(tot, t) {
  const tiles = [['Protein', tot.protein_g, t.proteinG], ['Carbs', tot.carbs_g, t.carbG], ['Fat', tot.fat_g, t.fatG]];
  const aria = tiles.map(([l, e, g]) => `${l} ${num(e)} of ${num(g)} grams`).join(', ');
  return `<div role="group" aria-label="Today of target: ${aria}">
    <p class="food-targets-label" aria-hidden="true">Today of target</p>
    <div class="food-targets" data-food-targets>${tiles.map(([l, e, g]) => `<div><b data-eaten>${num(e)}</b><small data-target>/ ${num(g)}${NB}g</small><span>${l}</span></div>`).join('')}</div></div>`;
}

/** The Food card's text lines: { note, over, protein }. Same wording rules as the Today rings legend. */
export function foodSummary(tot, t) {
  const left = Math.round(t.calories - tot.kcal);
  return {
    over: left < 0,
    note: !tot.kcal ? 'Nothing logged yet' : left >= 0 ? `${num(left)}${NB}kcal left` : `${num(-left)}${NB}kcal over`,
    protein: `${num(tot.protein_g)} of ${num(t.proteinG)}${NB}g protein`,
  };
}

/** The Food card's little ring: calories outside, protein inside. Over the calorie target the lap turns warn with a darker second lap. */
export function foodRingSvg(tot, t, aria) {
  const arc = (r, w, v, color, deep) => {
    const C = 2 * Math.PI * r;
    const dash = (x) => (C * (1 - Math.max(0, Math.min(1, x || 0)))).toFixed(1);
    const lap = deep ? `<circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--warn-deep)" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${dash(deep)}" data-over/>` : '';
    return `<circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" opacity=".17"/>
    <circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${dash(v)}"/>${lap}`;
  };
  const kv = t.calories > 0 ? tot.kcal / t.calories : 0;
  const over = kv > 1;
  const pv = t.proteinG > 0 ? tot.protein_g / t.proteinG : 0;
  return `<svg class="food-card-ring" viewBox="0 0 80 80" width="80" height="80" role="img" aria-label="${esc(aria)}"><g transform="rotate(-90 40 40)">${arc(35, 9, kv, over ? 'var(--warn)' : 'var(--ring-kcal)', overLap(kv))}${arc(23, 9, pv, 'var(--ring-protein)', 0)}</g></svg>`;
}

let insetSeq = 0;
export function ringsHtml(rings) {
  const drawn = CLUSTER.map((k) => rings.find((r) => r.key === k)).filter(Boolean);
  // Recessed track: an inner shadow cut from the ring's own alpha. One ring SVG per page today; the id is unique per call otherwise.
  const insetId = `ring-inset-${++insetSeq}`;
  const inset = `<filter id="${insetId}" x="-10%" y="-10%" width="120%" height="120%"><feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="inv" stdDeviation="1.6"/><feOffset dy="1.4" result="sh"/><feFlood flood-color="black" flood-opacity=".75"/><feComposite in2="sh" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="inner"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="inner"/></feMerge></filter>`;
  const defs = inset + drawn.map((r) => {
    const col = r.over ? 'var(--warn)' : COLORS[r.key];
    return `<linearGradient id="rg-${r.key}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:color-mix(in srgb, ${col} 62%, #fff)"/><stop offset="1" style="stop-color:${col}"/></linearGradient>`;
  }).join('');
  const arcs = drawn.map((r, i) => {
    const R = radius(i);
    const C = 2 * Math.PI * R;
    const v = Math.max(0, Math.min(1, r.value || 0));
    // Over target: the lap turns warn and the overflow is drawn as a darker second lap on top.
    const col = r.over ? 'var(--warn)' : COLORS[r.key];
    const over = r.over ? overLap(r.value) : 0;
    const lap = over ? `<circle class="ring-arc ring-over" data-ring="${r.key}-over" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R}"
        stroke-dasharray="${C.toFixed(1)}" style="stroke:var(--warn-deep);--c:${C.toFixed(1)};--off:${(C * (1 - over)).toFixed(1)}"/>` : '';
    return `<circle class="ring-track" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R}" style="color:${col};filter:url(#${insetId})"/>
      <circle class="ring-arc${v >= 1 && !r.over ? ' ring-closed' : ''}" data-ring="${r.key}" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${R}"
        stroke-dasharray="${C.toFixed(1)}" style="color:${col};stroke:url(#rg-${r.key});--c:${C.toFixed(1)};--off:${(C * (1 - v)).toFixed(1)}"/>${lap}`;
  }).join('');
  const t = rings.find((r) => r.key === 'training');
  const hub = t ? `<div class="rings-hub" aria-hidden="true"><b><span data-tick="rings-days">${t.done}</span><i>/${t.goal}</i></b><small>training days</small></div>` : '';
  const legend = rings.map((r) => `
    <li style="--rc:${r.over ? 'var(--warn)' : COLORS[r.key]}"><span class="ring-dot" aria-hidden="true"></span>
      <span><b>${esc(r.label)}${r.value >= 1 && !r.over ? ` <span class="ring-done">${icon('check', { size: 14 })}</span>` : ''}</b>${(r.lines || [r.text]).map((l) => `<small class="muted">${esc(l)}</small>`).join("")}${r.over && r.extra ? `<small class="warn">${esc(r.extra)}</small>` : ''}</span></li>`).join('');
  const aria = rings.map((r) => `${r.label}: ${r.text}${r.extra ? `, ${r.extra}` : ''}`).join('; ');
  return `<div class="rings" role="img" aria-label="${esc(aria)}">
    <div class="rings-hero"><svg class="rings-svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-hidden="true"><defs>${defs}</defs><g transform="rotate(-90 ${SIZE / 2} ${SIZE / 2})">${arcs}</g></svg>${hub}</div>
    <ul class="rings-legend">${legend}</ul></div>`;
}

const SEEN = 'forge.rings';
function closedBefore(week) {
  try {
    const j = JSON.parse(localStorage.getItem(SEEN) || '{}');
    return j.week === week ? new Set(j.closed || []) : new Set();
  } catch { return new Set(); }
}
function remember(week, closed) {
  try { localStorage.setItem(SEEN, JSON.stringify({ week, closed: [...closed] })); } catch { /* private mode: celebrate again, no harm */ }
}

/** Where each arc is right now (dash offsets by data-ring key), read before a screen redraws so the new arcs can start there. */
export function snapshotRings(root) {
  const from = new Map();
  if (!root) return from;
  root.querySelectorAll('[data-ring]').forEach((a) => {
    const v = parseFloat(getComputedStyle(a).strokeDashoffset);
    if (Number.isFinite(v)) from.set(a.dataset.ring, v);
  });
  return from;
}

/** The offset an arc starts its draw from: where it was (a redraw), or empty (the first draw of the visit). */
export const startOffset = (from, key, circumference) => (from && from.has(key) ? from.get(key) : circumference);

/**
 * Animate the arcs, then burst any earned ring closed for the first time this week.
 * `from` (snapshotRings of the previous draw on this screen) makes a data refresh glide from where the arcs
 * were; without it (the first draw of a visit) they fill from empty.
 */
export function animateRings(root, rings, week, from = null) {
  const still = reducedMotion();
  if (!still) {
    if (from && from.size) {
      const arcs = [...root.querySelectorAll('[data-ring]')];
      const targets = arcs.map((a) => a.style.getPropertyValue('--off'));
      arcs.forEach((a) => {
        a.style.transition = 'none';
        a.style.setProperty('--off', String(startOffset(from, a.dataset.ring, parseFloat(a.style.getPropertyValue('--c')))));
      });
      void root.getBoundingClientRect(); // commit the start position
      requestAnimationFrame(() => arcs.forEach((a, i) => {
        a.style.transition = '';
        a.style.transitionDelay = '0s';
        a.style.setProperty('--off', targets[i]);
      }));
    } else {
      root.classList.add('rings-pre');
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('rings-pre')));
    }
  }
  const seen = closedBefore(week);
  const fresh = rings.filter((r) => !NO_CONFETTI.has(r.key) && r.value >= 1 && !seen.has(r.key));
  if (!fresh.length) return;
  setTimeout(() => {
    if (!root.isConnected) return; // re-rendered meanwhile: the new render celebrates instead
    fresh.forEach((r) => seen.add(r.key));
    remember(week, seen);
    const box = root.querySelector('.rings-svg').getBoundingClientRect();
    import('./fx.js').then(({ burst }) => fresh.forEach((r, k) => setTimeout(() => {
      burst(box.left + box.width / 2, box.top + box.height * 0.08, { count: still ? 0 : 46, colors: [BURST[r.key], SPARKLE, '#FFFFFF'] });
    }, k * 350)));
  }, still ? 0 : 1100);
}
