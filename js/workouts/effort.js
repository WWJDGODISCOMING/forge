// Effort ratings (Fitbod-style): one "How many more reps could you have done?" per exercise, asked after
// its last working set. The answer (reps in reserve, RIR) feeds nextTarget. Pure functions.
import { e1rm } from './progression.js';

export const EFFORT_CHOICES = [0, 1, 2, 3, 4]; // 4 means "4 or more"
export const effortLabel = (r) => (r == null ? '' : r >= 4 ? '4+' : String(r));

const workingDone = (item) => (item.sets || []).filter((s) => s.done && !s.warmup);

/** The hardest working set: highest estimated 1RM (reps alone for bodyweight). All equal → the last one. */
export function hardestSet(sets) {
  let best = null;
  let bestScore = -1;
  for (const s of sets) {
    const score = e1rm(s.weight_kg ?? s.weight, s.reps) ?? (s.reps || 0);
    if (score >= bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Any working set logged below what was planned (the numbers already tell the story). */
export function missedReps(item) {
  return workingDone(item).some((s) => s.plan_reps != null && (s.reps || 0) < s.plan_reps);
}

/**
 * Should the "How many more reps could you have done?" prompt show now?
 * Only once every working set is done, and not for timed work, warm-ups, missed reps,
 * sets already rated with the per-set buttons, or an exercise already rated or skipped.
 */
export function shouldAskEffort(item, ex = {}) {
  if (!item || ex.timed) return false;
  const working = (item.sets || []).filter((s) => !s.warmup);
  if (!working.length || !working.every((s) => s.done)) return false;
  if (item.effort_rir !== undefined || item.effort_skipped) return false;
  if (working.some((s) => s.rir != null)) return false;
  if (missedReps(item)) return false;
  return true;
}

const validRir = (v) => (Number.isInteger(v) && v >= 0 && v <= 4 ? v : null);

/**
 * The exercise's rating: the one given after the last set, else the rating on its hardest rated set.
 * An explicit null on effort_rir means the rating was cleared (don't fall back to the per-set ratings).
 * Only integers 0–4 count; anything else is null.
 */
export function exerciseRir(item) {
  if (item.effort_rir !== undefined) return validRir(item.effort_rir);
  const rated = workingDone(item).filter((s) => validRir(s.rir) != null);
  if (!rated.length) return null;
  return validRir(hardestSet(rated).rir);
}

/** Rate an exercise (0–4, 4 = "4 or more"); null clears it (and stops the prompt asking again). */
export function setEffort(item, rir) {
  if (rir == null) {
    item.effort_rir = null; // cleared on purpose: keeps older per-set ratings from showing through
    return item;
  }
  item.effort_rir = Math.min(4, Math.max(0, Math.round(rir)));
  delete item.effort_skipped;
  return item;
}
