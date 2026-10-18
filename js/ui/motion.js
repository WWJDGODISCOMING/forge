// Motion system: one shared animation loop (sleeps when nothing is animating), count-ups, and
// View Transitions for screen changes. Tokens live in css/motion.css (--t-fast/med/slow, --ease-*).

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
  // Shared element: the outgoing element gets the name now (so the old screen is captured with it), the incoming
  // one right after the update. Only one element holds the name at a time, and both lose it when the morph ends.
  const sharedOn = shared && !reducedMotion();
  const tag = (sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.viewTransitionName = shared.name;
    return el;
  };
  const untag = () => document.querySelectorAll(shared.from + ',' + shared.to).forEach((el) => { el.style.viewTransitionName = ''; });
  if (sharedOn) tag(shared.from);
  const vt = document.startViewTransition(async () => {
    if (sharedOn) untag(); // the old screen is already captured; keep the name unique on the page
    await update();
    if (sharedOn) tag(shared.to);
  });
  return vt.finished.catch(() => {}).finally(() => {
    delete document.documentElement.dataset.vt;
    if (sharedOn) untag();
  });
}

/** Which ring morphs for a route change: Today ↔ Score only. Pure, so it can be tested. */
export function sharedRingFor(from, to) {
  const f = from[0] || 'today';
  const t = to[0] || 'today';
  if (f === 'today' && t === 'score' && !from[1]) return { name: 'score-ring', from: '#main .score-mini', to: '#main .score-hero' };
  if (f === 'score' && t === 'today' && !to[1]) return { name: 'score-ring', from: '#main .score-hero', to: '#main .score-mini' };
  return null;
}
