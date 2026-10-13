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
