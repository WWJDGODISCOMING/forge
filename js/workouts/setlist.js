// Pure helpers for the player's "all sets up front" list (#192). No DOM here, so the tests can run them.
import { validateSet, exercisePRs, replacePRs } from './session-core.js';

/** What set j shows: logged values, else the plan, else the last done set before it (set 2 starts where set 1 ended). */
export function setValues(it, j, defaultReps = null) {
  const s = it.sets[j];
  const before = it.sets.slice(0, j).filter((x) => x.done && !x.warmup === !s.warmup).pop() || it.sets.slice(0, j).filter((x) => x.done).pop();
  return {
    kg: s.weight_kg ?? s.plan_weight_kg ?? (before ? before.weight_kg : null) ?? null,
    reps: s.reps ?? s.plan_reps ?? (before ? before.reps : null) ?? defaultReps,
  };
}

/** One row per set: label ("W1" for warm-ups, then 1, 2, 3…), state (done / current / todo) and values. */
export function setRows(it, curJ, defaultReps = null) {
  let work = 0;
  let warm = 0;
  return it.sets.map((s, j) => {
    const label = s.warmup ? `W${++warm}` : String(++work);
    const v = setValues(it, j, defaultReps);
    return { j, label, warmup: !!s.warmup, state: s.done ? 'done' : j === curJ ? 'current' : 'todo', kg: v.kg, reps: v.reps, rir: s.rir ?? null };
  });
}

/** Add a working set after the last one, planned like the last working set. Returns the new set's index. */
export function addSet(it) {
  const last = [...it.sets].reverse().find((s) => !s.warmup) || {};
  it.sets.push({ warmup: false, plan_weight_kg: last.weight_kg ?? last.plan_weight_kg ?? null, plan_reps: last.reps ?? last.plan_reps ?? null, weight_kg: null, reps: null, rir: null, done: false, completed_at: null });
  return it.sets.length - 1;
}

/** Write an edit from the player into an upcoming set's plan. (Finished sets go through editDoneSet.) */
export function editSet(it, j, { kg, reps }) {
  const s = it.sets[j];
  if (kg !== undefined) s.plan_weight_kg = kg;
  if (reps != null) s.plan_reps = reps;
}

/**
 * Change the result of a finished set: validate like Done set does, then recompute this exercise's records from
 * the sets as they now stand (so a raised set can make a PR and a lowered one takes it away).
 * Returns { ok:false, error } and leaves the set alone, or { ok:true, prs }.
 */
export function editDoneSet(w, it, ex, j, { kg, reps }, history, unit) {
  const s = it.sets[j];
  const r = reps != null ? reps : s.reps;
  const k = kg !== undefined ? kg : s.weight_kg;
  const err = validateSet(ex, s, { reps: r, weightKg: k });
  if (err) return { ok: false, error: err };
  s.reps = r;
  s.weight_kg = k;
  if (ex && ex.id) w.prs = replacePRs(w.prs, ex.id, exercisePRs(ex, it, history, unit));
  return { ok: true, prs: w.prs };
}
