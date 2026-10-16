// Shared bits for the score rings (Today card, Score screen). The ring fills from empty unless reduced motion is on.
import { reducedMotion } from '../ui/motion.js';

/** Colour token for a 0–100 value: good when strong, accent when fine, warn when middling, ember when low. */
export const scoreColor = (v) => (v == null ? 'var(--surface-3)' : v >= 80 ? 'var(--good)' : v >= 60 ? 'var(--accent-text)' : v >= 40 ? 'var(--warn)' : 'var(--ember)');

let gradId = 0;
/** A ring as SVG. value 0–100 (or null for an empty ring). A strong ring gets the accent gradient stroke and a soft glow. */
export function ringSvg(value, { size = 100, stroke = 10 } = {}) {
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const hero = value != null && value >= 60;
  const id = `sc-g${++gradId}`;
  const defs = hero ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs>` : '';
  const paint = hero ? `stroke:url(#${id})` : `stroke:${scoreColor(value)}`;
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true" class="${hero ? 'sc-hero' : ''}">${defs}<g transform="rotate(-90 ${size / 2} ${size / 2})">
    <circle class="sc-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="sc-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" style="${paint};--c:${c.toFixed(1)};--off:${(c * (1 - v)).toFixed(1)}"
      stroke-dasharray="${c.toFixed(1)}"/></g></svg>`;
}

/** Fill the rings under `root` from empty (skipped with reduced motion). */
export function animateScoreRings(root) {
  if (reducedMotion()) return;
  root.classList.add('sc-pre');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('sc-pre')));
}

/** Delay (ms) before pillar `i` fills. On entry it trails the big ring by 240 ms; scrolled into view later it starts at once. Steps are 60 ms. */
export const pillarDelay = (i, entering = true) => (entering ? 240 : 0) + i * 60;

/**
 * Pillar rings under `grid` fill in a cascade once the grid is on screen, once per render. Rings stay empty until then.
 * Reduced motion (or no IntersectionObserver) leaves them at their final values.
 */
export function revealPillars(grid, { enterWindow = 500 } = {}) {
  if (!grid || reducedMotion() || typeof IntersectionObserver !== 'function') return;
  const t0 = performance.now();
  [...grid.children].forEach((t) => t.style.setProperty('--d', '0ms'));
  grid.classList.add('sc-hold');
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const entering = performance.now() - t0 < enterWindow;
    [...grid.children].forEach((t, i) => t.style.setProperty('--d', `${pillarDelay(i, entering)}ms`));
    requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.remove('sc-hold')));
  }, { threshold: 0.2 });
  io.observe(grid);
}

export const round = (x) => Math.round(x);
