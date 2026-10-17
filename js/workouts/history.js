// Turns stored workouts into per-exercise history (most recent first), in the display unit.
// Each session carries `deload` so progression and stall checks can skip deload weeks, while PRs,
// charts and History still show them.
import { toUnit, e1rm } from './progression.js';
import { exerciseRir } from './effort.js';

/** workouts: stored docs. unit: 'lb' | 'kg'. Only finished workouts count as history. */
export function buildIndex(workouts, unit) {
  const done = workouts
    .filter((w) => w.status === 'done' && !w.deleted)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  const sessions = new Map();
  const lastDone = new Map();
  for (const w of done) {
    const t = Date.parse(w.finished_at || w.started_at);
    for (const ex of w.exercises || []) {
      const sets = (ex.sets || [])
        .filter((s) => s.done && !s.warmup)
        .map((s) => ({
          weight: s.weight_kg == null ? null : Math.round(toUnit(s.weight_kg, unit) * 10) / 10,
          reps: s.reps,
          rir: s.rir,
          planReps: s.plan_reps ?? null,
        }));
      if (!sets.length) continue;
      if (!sessions.has(ex.exercise_id)) sessions.set(ex.exercise_id, []);
      sessions.get(ex.exercise_id).push({ date: w.started_at, workoutId: w.id, deload: !!w.deload, rir: exerciseRir(ex), sets });
      if (!lastDone.has(ex.exercise_id)) lastDone.set(ex.exercise_id, t);
    }
  }
  return {
    done,
    /** Every session of an exercise, deloads included (progression filters them itself). */
    historyFor: (id) => sessions.get(id) || [],
    daysSince: (id, now = Date.now()) => (lastDone.has(id) ? (now - lastDone.get(id)) / 86400000 : null),
  };
}

/**
 * Best marks for one exercise from its sessions (display unit): estimated 1-rep max, heaviest weight,
 * most reps in a set, longest hold for timed work, plus the date each was set.
 */
export function exerciseRecords(sessions, ex = {}) {
  const r = { e1rm: null, heaviest: null, reps: null, hold: null };
  for (const s of sessions || []) {
    for (const set of s.sets || []) {
      if (ex.timed) {
        if (set.reps && (!r.hold || set.reps > r.hold.value)) r.hold = { value: set.reps, date: s.date };
        continue;
      }
      if (set.reps && (!r.reps || set.reps > r.reps.value)) r.reps = { value: set.reps, weight: set.weight, date: s.date };
      if (set.weight && (!r.heaviest || set.weight > r.heaviest.value)) r.heaviest = { value: set.weight, reps: set.reps, date: s.date };
      const e = e1rm(set.weight, set.reps);
      if (e && (!r.e1rm || e > r.e1rm.value)) r.e1rm = { value: Math.round(e), date: s.date };
    }
  }
  return r;
}
