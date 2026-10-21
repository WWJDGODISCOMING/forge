// Hard sets per muscle. Hard sets only: leg activity (js/workouts/leg-activity.js) never feeds into this.
import { exerciseById } from './library.js';
import { dayKey } from '../weight/smoothing.js';

/** Hard sets per muscle (primary 1, secondary 0.5) for workouts in [from, to). */
export function setsPerMuscle(workouts, from, to) {
  const out = {};
  for (const w of workouts) {
    const k = dayKey(w.started_at);
    if (k < from || k >= to) continue;
    for (const it of w.exercises || []) {
      const ex = exerciseById(it.exercise_id);
      if (!ex || ex.kind === 'conditioning') continue;
      const n = (it.sets || []).filter((s) => s.done && !s.warmup).length;
      ex.primary.forEach((m) => (out[m] = (out[m] || 0) + n));
      ex.secondary.forEach((m) => (out[m] = (out[m] || 0) + n * 0.5));
    }
  }
  return out;
}
