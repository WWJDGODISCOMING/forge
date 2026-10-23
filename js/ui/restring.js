// Pure maths for the rest ring: how full it is, when it turns urgent, which second gets a haptic, and how a
// ±15 s nudge eases from the old fill to the new one. No DOM, so it is unit tested.
export const URGENT_S = 10;
export const CIRC = 283;

/** 0..1 fill of the ring. */
export const fillOf = (left, total) => (total > 0 ? Math.max(0, Math.min(1, left / total)) : 0);

/** The last 10 seconds (and not once the rest is over). */
export const isUrgent = (left) => left > 0 && left <= URGENT_S;

/** The whole second (3, 2 or 1) that needs a tick now, or 0 when none; `last` is the second already ticked. */
export function countdownSecond(left, last) {
  const whole = Math.ceil(left);
  return whole >= 1 && whole <= 3 && whole !== last ? whole : 0;
}

/** After a nudge the ring shows `target + gap * (1 - eased progress)`, so it glides from the old fill to the live one. */
export function easedFill(target, gap, progress) {
  const p = Math.max(0, Math.min(1, progress));
  const e = 1 - Math.pow(1 - p, 3);
  return target + gap * (1 - e);
}

export const dashOffset = (fill) => CIRC * (1 - Math.max(0, Math.min(1, fill)));
