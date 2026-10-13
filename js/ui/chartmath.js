// Small pure helpers for the line charts (no DOM).
import { daysBetween } from '../weight/smoothing.js';

/** An axis end shows its year when the chart spans more than ~300 days or the two end days fall in different years. */
export function axisNeedsYear(startDay, endDay) {
  if (!startDay || !endDay) return false;
  return daysBetween(startDay, endDay) > 300 || startDay.slice(0, 4) !== endDay.slice(0, 4);
}

/** Dot size for a reading: past ~120 points they shrink and fade so the trend line reads as the hero. */
export function dotStyle(count, r = 2.4) {
  return count > 120 ? { r: 1.6, dense: true } : { r, dense: false };
}
