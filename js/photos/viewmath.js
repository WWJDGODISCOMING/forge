// Pure maths for the full-screen photo viewer (no DOM, so it is unit-tested).

export const DISMISS_DISTANCE = 120; // px dragged down
export const DISMISS_SPEED = 0.8; // px/ms downward
export const PX = 1000; // p (0..1) is sprung as p * PX because the solver's stop rule is sized for pixels
export const MIN_SCALE = 0.85; // how small a dragged photo gets

/** Which way a drag is going once it has moved a few px: 'v', 'h' or null (undecided). */
export function dragAxis(dx, dy, slop = 8) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return null;
  return Math.abs(dy) >= Math.abs(dx) ? 'v' : 'h';
}

/** Release decision for a vertical drag. Only downward drags close; a horizontal drag never does. */
export function shouldClosePhoto({ dx = 0, dy, velocity }) {
  if (Math.abs(dx) > Math.abs(dy)) return false;
  if (dy <= 8) return false;
  return dy > DISMISS_DISTANCE || velocity > DISMISS_SPEED;
}

/** Past the dismiss distance? (used for the one haptic tick per crossing) */
export const pastThreshold = (dy) => dy > DISMISS_DISTANCE;

/** Dragging up pulls against the finger; down follows 1:1. */
export const dragOffset = (dy) => (dy < 0 ? dy * 0.2 : dy);

/** Photo scale while dragging: 1 at rest, down to MIN_SCALE by 300 px. */
export const dragScale = (dy) => 1 - (1 - MIN_SCALE) * Math.min(1, Math.max(0, dy) / 300);

/** Where an image of w×h lands when contained in `box` {left, top, width, height}. */
export function containRect(w, h, box) {
  if (!(w > 0 && h > 0)) return { ...box };
  const k = Math.min(box.width / w, box.height / h);
  const width = w * k;
  const height = h * k;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/**
 * One frame of the thumb ↔ full morph. `thumb` and `full` are rects {left, top, width, height}; p is 0 (at the
 * thumb) to 1 (full). The full-size image moves with a uniform scale (never squashed); the thumb's crop (it is
 * object-fit: cover) is reproduced by clipping, so the picture's pixels stay the same all the way.
 * Returns { tx, ty, scale, insetX, insetY, radius }: a translate from the full rect's centre, a uniform scale,
 * and clip-path insets in the image's own (unscaled) space.
 */
export function morphFrame(thumb, full, p, thumbRadius = 14) {
  const s0 = Math.max(thumb.width / full.width, thumb.height / full.height);
  const scale = s0 + (1 - s0) * p;
  const tcx = thumb.left + thumb.width / 2;
  const tcy = thumb.top + thumb.height / 2;
  const fcx = full.left + full.width / 2;
  const fcy = full.top + full.height / 2;
  const visW = thumb.width / s0 + (full.width - thumb.width / s0) * p;
  const visH = thumb.height / s0 + (full.height - thumb.height / s0) * p;
  return {
    tx: (tcx - fcx) * (1 - p),
    ty: (tcy - fcy) * (1 - p),
    scale,
    insetX: Math.max(0, (full.width - visW) / 2),
    insetY: Math.max(0, (full.height - visH) / 2),
    radius: (thumbRadius * (1 - p)) / scale,
  };
}
