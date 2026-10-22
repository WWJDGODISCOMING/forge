// Pure maths for the chart scrub: where the floating label sits, and when a haptic tick fires. No DOM.

/** Label box (top-left x, y) for a pill w×h over the dot at (px, py): above it, clamped to [minX, maxX], flipped below if there's no room. */
export function labelPlace({ px, py, w, h, minX, maxX, minY = 0, gap = 10 }) {
  const x = Math.max(minX, Math.min(px - w / 2, maxX - w));
  const above = py - gap - h;
  const below = above < minY;
  return { x, y: below ? py + gap : above, below };
}

/** Tick gate: true only when the scrub lands on a different point than last time and `ms` have passed since the last tick. */
export function tickGate(ms = 35) {
  let last = -1;
  let at = -Infinity;
  return (i, now) => {
    if (i === last) return false;
    last = i; // a throttled move still counts as visited, so it never ticks later on the same point
    if (now - at < ms) return false;
    at = now;
    return true;
  };
}

/**
 * What a touch that started on a chart is turning into. A mouse or pen scrubs at once. A finger waits: a mostly
 * horizontal move scrubs, a mostly vertical one is the page scrolling, and holding still for `hold` ms scrubs too.
 * Returns 'scrub' | 'scroll' | 'wait'.
 */
export function scrubIntent({ dx, dy, ms, touch = true, hold = 380, slop = 8 }) {
  if (!touch) return 'scrub';
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= slop && ax > ay * 1.2) return 'scrub';
  if (ay >= slop && ay >= ax) return 'scroll';
  if (ms >= hold && ax < slop && ay < slop) return 'scrub';
  return 'wait';
}

/** A quick, long horizontal swipe pans the dates; a slower drag scrubs. */
export function isFlick({ dx, ms, minPx = 70, maxMs = 220 }) {
  return Math.abs(dx) >= minPx && ms <= maxMs;
}

/**
 * Next selection for the prev/next arrows (and VoiceOver's adjust). dir is -1 (earlier) or +1 (later); `i` is the
 * current point or null. Returns { i, edge }: edge is -1/+1 when the step runs off that end (the caller may pan).
 */
export function stepIndex(i, dir, n) {
  if (n <= 0) return { i: null, edge: 0 };
  const from = i == null ? (dir < 0 ? n : n - 1) : i;
  const to = from + dir;
  if (to < 0) return { i: 0, edge: -1 };
  if (to > n - 1) return { i: n - 1, edge: 1 };
  return { i: to, edge: 0 };
}

/** The spoken value for the adjustable chart: "Oct 15, 209.1 lb, Trend 208.4 lb". */
export function spokenPoint(day, text, trend) {
  return [day, text, trend].filter(Boolean).join(', ');
}

/**
 * Which point to select after a step panned the window. `days` are the new window's points (ascending), `day` the
 * reading that was selected before, `dir` -1 (earlier) or +1 (later): the nearest reading just before / after it,
 * or the closest end if the new window has none that side. -1 when there are no points.
 */
export function restoreIndex(days, day, dir) {
  if (!days.length) return -1;
  if (dir < 0) { for (let i = days.length - 1; i >= 0; i--) if (days[i] < day) return i; return 0; }
  for (let i = 0; i < days.length; i++) if (days[i] > day) return i;
  return days.length - 1;
}
