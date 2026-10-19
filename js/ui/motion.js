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
export const onScreen = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};
/** Call when you move to another screen, so its numbers count up again on the next visit. */
export const resetCounters = () => { counted.clear(); resetTicks(); };

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
 * Roll a number to a new value, reusing countUp. Starts from `from` (default: the number now shown in `el`), keeps the
 * shown format (grouping, decimals, prefix/suffix) and does nothing when the value is unchanged. Reduced motion: instant.
 */
export function tickTo(el, to, { from, format, dur = 600 } = {}) {
  if (!el) return false;
  const cur = parseCountText(el.textContent);
  const start = from ?? (cur ? cur.value : null);
  const fmt = format || (cur ? (v) => formatCount(cur, v) : undefined);
  if (start == null || !Number.isFinite(start) || !Number.isFinite(to) || start === to) return false;
  countUp(el, to, { from: start, dur, format: fmt });
  return true;
}

const shown = new Map(); // data-tick key -> the text last shown, cleared when you move to another screen
const shownFill = new Map(); // data-fill key -> last bar width (%)
export const resetTicks = () => { shown.clear(); shownFill.clear(); };
/**
 * After a render: every [data-tick="key"] whose text differs from what that key showed last rolls from the old number
 * to the new one; every [data-fill="key"] bar grows from its old width. First sight of a key only records it, so
 * navigation and first paint never animate.
 */
export function settleTicks(root) {
  root.querySelectorAll('[data-tick]').forEach((el) => {
    const key = el.dataset.tick;
    const text = el.textContent;
    const prev = shown.get(key);
    shown.set(key, text);
    if (prev === undefined || prev === text || el.children.length) return;
    const a = parseCountText(prev);
    const b = parseCountText(text);
    if (a && b) tickTo(el, b.value, { from: a.value, format: (v) => formatCount(b, v) });
  });
  root.querySelectorAll('[data-fill]').forEach((el) => {
    const key = el.dataset.fill;
    const w = parseFloat(el.style.width) || 0;
    const prev = shownFill.get(key);
    shownFill.set(key, w);
    if (prev === undefined || prev === w || reducedMotion() || !el.animate) return;
    el.animate([{ width: `${prev}%` }, { width: `${w}%` }], { duration: 450, easing: EASE.out });
  });
}

/**
 * Resolve with `find()` as soon as it returns something, or null after `timeout` ms. `subscribe(cb)` calls cb whenever
 * the page may have changed and returns an unsubscribe function (a MutationObserver on #main in the app). Pure of the DOM,
 * so it can be tested with a fake.
 */
export function whenFound(find, { timeout = 300, subscribe } = {}) {
  const now = find();
  if (now || !subscribe) return Promise.resolve(now || null);
  return new Promise((resolve) => {
    let off = () => {};
    let timer = null;
    const done = (v) => { clearTimeout(timer); off(); resolve(v); };
    off = subscribe(() => { const el = find(); if (el) done(el); });
    timer = setTimeout(() => done(find() || null), timeout);
  });
}
const watchMain = (cb) => {
  const main = document.getElementById('main');
  if (!main) return () => {};
  const mo = new MutationObserver(cb);
  mo.observe(main, { childList: true, subtree: true });
  return () => mo.disconnect();
};

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
  // Optional keys: `gate` (selector that must be on screen, default `from`), `hide` (elements that carry their own
  // name, cleared while the part runs so they travel inside its snapshot), and `surface` (one side is a full-screen
  // surface made here; `content` is the player on the other side, named `${name}-content`, `contentSide` is 'to' or 'from').
  const parts = (shared ? [].concat(shared) : []).filter((p) => !reducedMotion() && onScreen(document.querySelector(p.gate || p.from)));
  const contentName = (p) => p.name + '-content';
  const hidden = [];
  const hide = () => parts.forEach((p) => p.hide && document.querySelectorAll(p.hide).forEach((el) => {
    if (!hidden.some((h) => h[0] === el)) hidden.push([el, el.style.viewTransitionName]);
    el.style.viewTransitionName = 'none';
  }));
  const makeSurface = () => {
    let s = document.getElementById('vt-surface');
    if (!s) { s = document.createElement('div'); s.id = 'vt-surface'; document.body.appendChild(s); }
    return s;
  };
  const untag = () => parts.forEach((p) => document.querySelectorAll([p.from, p.to, p.content].filter(Boolean).join(',')).forEach((el) => { el.style.viewTransitionName = ''; }));
  if (parts.length) {
    hide();
    parts.forEach((p) => {
      if (p.surface && p.from === '#vt-surface') makeSurface(); // the way back starts from the full-screen surface
      document.querySelector(p.from).style.viewTransitionName = p.name;
      if (p.content && p.contentSide === 'from') { const c = document.querySelector(p.content); if (c) c.style.viewTransitionName = contentName(p); }
    });
    finalRing = parts.map((p) => p.toFinal).join(',');
  }
  const vt = document.startViewTransition(async () => {
    if (parts.length) { untag(); document.getElementById('vt-surface')?.remove(); } // the old screen is already captured; keep the names unique on the page
    await update();
    hide();
    for (const p of parts) {
      if (p.surface && p.to === '#vt-surface') makeSurface();
      // A part marked `wait` has an incoming element that fills in after the screen draws (e.g. the Body photos card
      // reads from IndexedDB): give it a moment. If it never shows, the outgoing one leaves with its page (CSS :only-child).
      const el = p.wait
        ? await whenFound(() => { const e = document.querySelector(p.to); return onScreen(e) ? e : null; }, { timeout: 300, subscribe: watchMain })
        : document.querySelector(p.to);
      if (onScreen(el)) el.style.viewTransitionName = p.name;
      if (p.content && p.contentSide === 'to') { const c = document.querySelector(p.content); if (onScreen(c)) c.style.viewTransitionName = contentName(p); }
    }
  });
  return vt.finished.catch(() => {}).finally(() => {
    delete document.documentElement.dataset.vt;
    if (parts.length) {
      untag(); finalRing = null;
      document.getElementById('vt-surface')?.remove();
      hidden.forEach(([el, v]) => { if (el.isConnected) el.style.viewTransitionName = v; });
    }
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
export function heroMorphFor(from, to, { cardTap = false, fromCard = false, weightTap = false, weightFromCard = false, foodTap = false, foodFromCard = false, foodToday = true, photosTap = false, photosFromCard = false, workoutTap = false, workoutFromCard = false, reduced = false } = {}) {
  if (reduced) return null;
  // Photos is a push/pop (Body to Progress photos), so it is decided before the tab-only parts below.
  const kind = transitionKind(from, to);
  if (kind === 'push' && photosTap && from[0] === 'body' && !from[1] && to[0] === 'photos' && !to[1]) {
    return [{ name: 'photo-thumbs', from: '#main [data-photos-card] .pp-thumbs', to: '#main .pp-session .pp-thumbs', toFinal: '.pp-session .pp-thumbs', wait: true }];
  }
  if (kind === 'pop' && photosFromCard && from[0] === 'photos' && !from[1] && to[0] === 'body' && !to[1]) {
    return [{ name: 'photo-thumbs', from: '#main .pp-session .pp-thumbs', to: '#main [data-photos-card] .pp-thumbs', toFinal: '[data-photos-card] .pp-thumbs', wait: true }];
  }
  // Workout: the Today card grows into the player (push), and back to the Resume card (pop) when opened that way.
  // Finishing goes to the summary, and a finished workout has a 'done' card, so neither morphs.
  const isPlayer = (r) => (r[0] === 'play' || r[0] === 'session') && !r[1];
  const PLAYER = '#main [data-player], #main [data-list]';
  const WORKOUT_HIDE = '[data-hero], .rest-ring'; // these carry their own pl-hero name; inside the card morph they travel with it
  if (kind === 'push' && workoutTap && (from[0] || 'today') === 'today' && !from[1] && isPlayer(to)) {
    return [{ name: 'workout-card', from: '#main [data-workout-card]:not([data-workout-card="done"])', to: '#vt-surface', toFinal: '#vt-surface', surface: true, content: PLAYER, contentSide: 'to', hide: WORKOUT_HIDE }];
  }
  if (kind === 'pop' && workoutFromCard && isPlayer(from) && (to[0] || 'today') === 'today' && !to[1]) {
    return [{ name: 'workout-card', from: '#vt-surface', gate: PLAYER, to: '#main [data-workout-card="resume"]', toFinal: '[data-workout-card="resume"]', surface: true, content: PLAYER, contentSide: 'from', hide: WORKOUT_HIDE }];
  }
  const ring = ringMorphFor(from, to, { cardTap, fromCard, reduced });
  if (ring) return [ring];
  if (kind !== 'tab') return null;
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
