// Pure maths for swipe-to-delete rows (Mail / Health style). No DOM, so it's unit-tested.
// Positions are leftward travel in px: 0 = closed, `openW` = the Delete action fully shown.

export const AXIS_SLOP = 10; // px of movement before we decide horizontal or vertical
export const EDGE_ZONE = 28; // touches starting this close to the left edge belong to swipe-back
export const OPEN_FRACTION = 0.4; // release past this share of the Delete action's width and the row snaps open
export const LONG_FRACTION = 0.7; // past this share of the row's width, letting go deletes
export const FLICK = 0.5; // px/ms

/** 'h' once the finger has moved far enough sideways, 'v' if it went up/down first, null while undecided. */
export function swipeAxis(dx, dy, slop = AXIS_SLOP) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
}

/** Is this touch start inside the swipe-back edge zone? */
export const inEdgeZone = (x, zone = EDGE_ZONE) => x < zone;

/** Leftward travel for a drag: `base` is where the row started (0 or openW), dx the finger's x change. Clamped to the row; pulling right past closed is stiff. */
export function swipeTravel(base, dx, width, limit = 40) {
  const t = base - dx;
  if (t >= 0) return Math.min(t, width);
  const pull = -t;
  return -(limit * (1 - 1 / (pull / limit + 1)));
}

/** True while the drag is past the long-swipe line (for the one-shot haptic). */
export const pastLong = (travel, width) => travel > width * LONG_FRACTION;

/**
 * After letting go: 'delete' (long swipe), 'open' (snap to the Delete action) or 'closed'.
 * `velocity` is the finger's x speed in px/ms (negative = leftwards).
 */
export function swipeRelease({ travel, velocity, width, openW }) {
  if (travel > width * LONG_FRACTION) return 'delete';
  if (velocity < -FLICK) return 'open';
  if (velocity > FLICK) return 'closed';
  return travel > openW * OPEN_FRACTION ? 'open' : 'closed';
}
