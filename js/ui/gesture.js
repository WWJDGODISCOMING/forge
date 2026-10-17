// Pure maths for drag gestures (sheet drag-to-dismiss, edge swipe-back). No DOM, so it's unit-tested.

/** Speed in px/ms from recent samples [{t, v}] (v = y or x), using only the last `windowMs`. */
export function velocityOf(samples, windowMs = 100) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) {
    if (last.t - s.t <= windowMs) { first = s; break; }
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.v - first.v) / dt : 0;
}

/**
 * After letting go of a sheet: close it when it was dragged past 35% of its height, or flicked down fast.
 * A hard flick up always keeps it open. `offset` and `velocity` point down (positive = towards closing).
 */
export function shouldDismiss({ offset, velocity, size, fraction = 0.35, flick = 0.5 }) {
  if (velocity < -flick) return false;
  if (velocity > flick && offset > 8) return true;
  return offset > size * fraction;
}

/**
 * Sheet detents. `detents` are resting offsets in px from fully open (e.g. [0, 320]); `size` is the sheet height.
 * A flick (> 0.5 px/ms) moves one detent from `from` (where the drag began; default the nearest detent): down
 * goes to the first detent at or below the release point, else dismisses. Otherwise it
 * settles on the nearest detent, dismissing only past 35% of the height left below the lowest detent.
 * Returns the detent offset to settle on, or 'dismiss'.
 */
export function pickDetent({ offset, velocity, detents, size, from, fraction = 0.35, flick = 0.5 }) {
  const ds = [...detents].sort((a, b) => a - b);
  const last = ds.length - 1;
  const nearest = (y) => {
    let n = 0;
    for (let i = 1; i <= last; i++) if (Math.abs(ds[i] - y) < Math.abs(ds[n] - y)) n = i;
    return n;
  };
  const near = nearest(offset);
  if (Math.abs(velocity) > flick) {
    const start = nearest(from ?? ds[near]); // step from where the drag began, so a long flick can't skip a detent
    if (velocity > 0) {
      for (let i = start + 1; i <= last; i++) if (ds[i] >= offset) return ds[i];
      return 'dismiss';
    }
    return ds[Math.max(0, start - 1)];
  }
  if (offset > ds[last] && offset - ds[last] > (size - ds[last]) * fraction) return 'dismiss';
  return ds[near];
}

/** The detent passed between two drag samples (either direction), or null. Landing exactly on one counts as reaching it. */
export function crossedDetent(prevOffset, offset, detents) {
  if (offset === prevOffset) return null;
  const down = offset > prevOffset;
  for (const d of detents) {
    if (down ? d > prevOffset && d <= offset : d < prevOffset && d >= offset) return d;
  }
  return null;
}

/** Dragging past the top (negative) gets stiffer the further you pull, like iOS; down is 1:1. */
export function rubberBand(offset, limit = 80) {
  if (offset >= 0) return offset;
  const pull = -offset;
  return -(limit * (1 - 1 / (pull / limit + 1)));
}

/** 0..1 for how far a sheet has been dragged down, for fading the backdrop. */
export const dragProgress = (offset, size) => (size > 0 ? Math.min(1, Math.max(0, offset / size)) : 0);

/** Parent-screen parallax during a swipe-back: starts 30% to the left of rest and slides to 0 as the screen leaves. */
export function parallaxOffset(dx, width, back = 30) {
  if (!(width > 0)) return 0;
  const progress = Math.min(1, Math.max(0, dx / width));
  return +(-back * (1 - progress)).toFixed(2);
}

/** Edge swipe-back: how dark the dim scrim behind the sliding screen is. Full strength at rest, gone once it has slid across. */
export function scrimOpacity(dx, width, max = 0.5) {
  if (!(width > 0)) return max;
  const progress = Math.min(1, Math.max(0, dx / width));
  return +(max * (1 - progress)).toFixed(3);
}

/** Edge swipe-back: go back when dragged past 40% of the width or flicked right. */
export function shouldPop({ dx, velocity, width }) {
  if (dx <= 0) return false;
  return velocity > 0.5 || dx > width * 0.4;
}
