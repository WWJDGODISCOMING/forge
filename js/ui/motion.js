// Motion system: one shared animation loop (sleeps when nothing is animating), count-ups, and
// View Transitions for screen changes. Tokens live in css/motion.css (--t-fast/med/slow, --ease-*).

import { transitionKind } from '../nav.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- the single rAF loop ----------
const tasks = new Set();
let raf = 0;
/** Run fn(timeMs) every frame until it returns false. Returns a cancel function. */
export function onFrame(fn) {
  tasks.add(fn);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => tasks.delete(fn);
}
function loop(t) {
  raf = 0;
  for (const fn of [...tasks]) {
    let keep;
    try { keep = fn(t); } catch (e) { console.error(e); keep = false; }
    if (keep === false) tasks.delete(fn);
  }
  if (tasks.size) raf = requestAnimationFrame(loop);
}

export const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  spring: (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
};

// Shared easing + durations; these mirror the CSS tokens in css/motion.css (--ease-*, --t-*).
export const EASE = {
  out: 'cubic-bezier(.2, .8, .2, 1)',
  spring: 'cubic-bezier(.32, .72, 0, 1)', // iOS sheet / push feel
  bounce: 'cubic-bezier(.34, 1.56, .64, 1)', // small pops
};
export const DUR = { fast: 120, med: 280, slow: 450 };

/** Splits "+182.4 lb" or "2,150" into a prefix, a number and a suffix. Returns null if there is no number. */
export function parseCountText(text) {
  const m = /^([^\d]*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const num = m[2];
  return {
    prefix: m[1],
    suffix: m[3],
    value: parseFloat(num.replace(/,/g, '')),
    decimals: num.includes('.') ? num.split('.')[1].length : 0,
    grouped: num.includes(','),
  };
}

/** Text for the number `v` in the same shape as the parsed original: same decimals, grouping, prefix, suffix. */
export function formatCount(parsed, v) {
  const n = Number(v).toLocaleString('en-US', {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
    useGrouping: parsed.grouped,
  });
  return `${parsed.prefix}${n}${parsed.suffix}`;
}

const counted = new Set();
/** While a ring morph runs: selector of the incoming ring, which shows its final arc and number from the first frame. */
let finalRing = null; // comma-joined selectors of every incoming morph part
/** Mark the incoming morph parts under `root` as final, so they are not drawn in from empty. */
export function keepRingFinal(root) {
  if (finalRing) root.querySelectorAll(finalRing).forEach((el) => el.classList.add('sc-final'));
}
const onScreen = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};
/** Call when you move to another screen, so its numbers count up again on the next visit. */
export const resetCounters = () => counted.clear();

/**
 * Count up every [data-count] element (plain text only) under root, once per screen visit. Re-renders on the
 * same screen leave the numbers alone. Reduced motion: nothing to do, the text is already the final value.
 */
export function animateCounters(root) {
  if (reducedMotion()) return;
  root.querySelectorAll('[data-count]').forEach((el, i) => {
    if (el.children.length || counted.has(i)) return;
    counted.add(i);
    if (finalRing && el.closest(finalRing)) return; // the ring that is flying in carries its value, no count-up
    const parsed = parseCountText(el.textContent);
    if (!parsed || !Number.isFinite(parsed.value) || parsed.value === 0) return;
    countUp(el, parsed.value, { format: (v) => formatCount(parsed, v), dur: 800 });
  });
}

/** Animate a number in an element from 0 (or `from`) to `to`. */
export function countUp(el, to, { from = 0, dur = 900, format = (v) => Math.round(v).toLocaleString(), delay = 0 } = {}) {
  if (!el) return;
  if (reducedMotion() || dur <= 0) {
    el.textContent = format(to);
    return;
  }
  el.textContent = format(from);
  const start = performance.now() + delay;
  onFrame((t) => {
    if (!el.isConnected) return false;
    const p = Math.min(1, Math.max(0, (t - start) / dur));
    el.textContent = format(from + (to - from) * ease.out(p));
    return p < 1;
  });
}

/**
 * Run a DOM update as a View Transition when supported (Safari 18+), tagged with a direction so CSS can
 * slide tabs or push/pop detail screens. Falls back to an instant update. Reduced motion → crossfade (CSS).
 */
export function viewTransition(update, kind = 'fade', shared = null) {
  if (!document.startViewTransition) {
    // No View Transitions: swap straight away and fade the new screen in (no layout jump).
    return Promise.resolve(update()).then(() => {
      const main = document.getElementById('main');
      if (!main || reducedMotion()) return;
      main.classList.remove('route-fade');
      void main.offsetWidth;
      main.classList.add('route-fade');
    });
  }
  document.documentElement.dataset.vt = kind;
  // Shared parts ({ name, from, to, toFinal }): each outgoing element gets its name now (so the old screen is captured
  // with it), the incoming one right after the update. A name is held by one element at a time, and all are cleared
  // when the morph ends. A part whose outgoing element is off screen, or whose incoming one is, just crossfades.
  const parts = (shared ? [].concat(shared) : []).filter((p) => !reducedMotion() && onScreen(document.querySelector(p.from)));
  const untag = () => parts.forEach((p) => document.querySelectorAll(p.from + ',' + p.to).forEach((el) => { el.style.viewTransitionName = ''; }));
  if (parts.length) {
    parts.forEach((p) => { document.querySelector(p.from).style.viewTransitionName = p.name; });
    finalRing = parts.map((p) => p.toFinal).join(',');
  }
  const vt = document.startViewTransition(async () => {
    if (parts.length) untag(); // the old screen is already captured; keep the names unique on the page
    await update();
    parts.forEach((p) => {
      const el = document.querySelector(p.to);
      if (onScreen(el)) el.style.viewTransitionName = p.name;
    });
  });
  return vt.finished.catch(() => {}).finally(() => {
    delete document.documentElement.dataset.vt;
    if (parts.length) { untag(); finalRing = null; }
  });
}

/**
 * Which ring morphs for a route change. Score is the Progress tab root, so Today to Score is a 'tab' change:
 * it morphs only when the Score card was tapped (`cardTap`), and on the way back when Score was opened that way
 * (`fromCard`). Tab-bar taps, deep links and every other pair give null. Pure, so it can be tested.
 */
export function ringMorphFor(from, to, { cardTap = false, fromCard = false, reduced = false } = {}) {
  if (reduced || transitionKind(from, to) !== 'tab') return null;
  const ring = sharedRingFor(from, to);
  if (!ring) return null;
  return (ring.from.endsWith('score-mini') ? cardTap : fromCard) ? ring : null;
}

/** Today and Score ring names and selectors. */
export function sharedRingFor(from, to) {
  const f = from[0] || 'today';
  const t = to[0] || 'today';
  if (f === 'today' && t === 'score' && !from[1]) return { name: 'score-ring', from: '#main .score-mini', to: '#main .score-hero', toFinal: '.score-hero' };
  if (f === 'score' && t === 'today' && !to[1]) return { name: 'score-ring', from: '#main .score-hero', to: '#main .score-mini', toFinal: '.score-mini' };
  return null;
}

/**
 * Every shared part for a route change: the Score ring (see ringMorphFor) or the Weight number and chart. Weight is
 * the Body tab root, so Today to Body is a 'tab' change: it morphs only when the Weight card was tapped (`weightTap`),
 * and back when Body was opened that way (`weightFromCard`). Returns an array of parts, or null. Pure.
 */
export function heroMorphFor(from, to, { cardTap = false, fromCard = false, weightTap = false, weightFromCard = false, foodTap = false, foodFromCard = false, foodToday = true, reduced = false } = {}) {
  if (reduced) return null;
  const ring = ringMorphFor(from, to, { cardTap, fromCard, reduced });
  if (ring) return [ring];
  if (transitionKind(from, to) !== 'tab') return null;
  const f = from[0] || 'today';
  const t = to[0] || 'today';
  if (f === 'today' && !from[1] && t === 'body' && to[1] === 'weight' && weightTap) {
    return [
      { name: 'weight-num', from: '#main .weight-card .hero-num', to: '#main [data-weight-hero] .stats > div:first-child b', toFinal: '[data-weight-hero] .stats > div:first-child b' },
      { name: 'weight-chart', from: '#main .weight-card .spark', to: '#main [data-weight-hero] .chart', toFinal: '[data-weight-hero] .chart' },
    ];
  }
  if (f === 'body' && from[1] === 'weight' && t === 'today' && !to[1] && weightFromCard) {
    return [
      { name: 'weight-num', from: '#main [data-weight-hero] .stats > div:first-child b', to: '#main .weight-card .hero-num', toFinal: '.weight-card .hero-num' },
      { name: 'weight-chart', from: '#main [data-weight-hero] .chart', to: '#main .weight-card .spark', toFinal: '.weight-card .spark' },
    ];
  }
  // Food: the card grows into the Food totals card (and back). Only when Food shows today, so the numbers match.
  if (foodToday && f === 'today' && !from[1] && t === 'food' && !to[1] && foodTap) {
    return [
      { name: 'food-card', from: '#main [data-food-card]', to: '#main [data-food-totals]', toFinal: '[data-food-totals]' },
      { name: 'food-kcal', from: '#main .food-card-kcal b', to: '#main [data-food-totals] .meter-row--big .meter-val b', toFinal: '[data-food-totals] .meter-row--big .meter-val b' },
    ];
  }
  if (foodToday && f === 'food' && !from[1] && t === 'today' && !to[1] && foodFromCard) {
    return [
      { name: 'food-card', from: '#main [data-food-totals]', to: '#main [data-food-card]', toFinal: '[data-food-card]' },
      { name: 'food-kcal', from: '#main [data-food-totals] .meter-row--big .meter-val b', to: '#main .food-card-kcal b', toFinal: '.food-card-kcal b' },
    ];
  }
  return null;
}
