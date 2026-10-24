// Totals for the workout summary: volume (weight x reps for weighted moves), total reps, hold time for timed
// moves, and the change against the last comparable workout. Pure; a display only, never an input to progression.
// Unilateral moves are logged per side, so their reps and volume count both sides (doubled).

const doneWorking = (w) => (w.exercises || []).flatMap((it) => (it.sets || []).filter((s) => s.done && !s.warmup).map((s) => ({ it, s })));

/** { volume (display unit), reps, holdSec } for a finished workout. `lookup(id)` gives the library exercise (or null). */
export function workoutTotals(w, lookup, toDisplay = (kg) => kg) {
  let volume = 0;
  let reps = 0;
  let holdSec = 0;
  for (const { it, s } of doneWorking(w)) {
    const ex = lookup(it.exercise_id) || {};
    const sides = ex.unilateral ? 2 : 1;
    const n = Number(s.reps) || 0;
    if (ex.timed) {
      holdSec += n * sides;
      continue;
    }
    reps += n * sides;
    if (s.weight_kg > 0 && n) volume += toDisplay(s.weight_kg) * n * sides;
  }
  return { volume: Math.round(volume), reps, holdSec: Math.round(holdSec) };
}

/** The latest earlier finished workout with the same label (the same day of the plan), else null. */
export function comparableWorkout(w, all) {
  const label = w.label || '';
  if (!label) return null;
  const prev = all.filter((x) => x.id !== w.id && x.status === 'done' && !x.deleted && x.started_at < w.started_at && (x.label || '') === label);
  prev.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return prev[0] || null;
}

/** Short source tag shown on the Calories tile. */
export const KCAL_TAG = { apple_watch: 'Apple Watch', measured: 'measured', estimate: 'est.' };

/** The calories to show for a workout: { kcal, source: 'apple_watch'|'measured'|'estimate' } (saved number first, else the estimate), or null. */
export function kcalReading(w, estimate) {
  if (w && w.kcal > 0) return { kcal: Math.round(w.kcal), source: w.kcal_source === 'apple_watch' || w.kcal_source === 'measured' ? w.kcal_source : 'estimate' };
  return estimate != null && estimate > 0 ? { kcal: Math.round(estimate), source: 'estimate' } : null;
}

/** Last time's calories, only when it is the same kind of number (never a Watch number against an estimate); else null. */
export function kcalComparable(cur, prev) {
  return cur && prev && cur.source === prev.source ? prev.kcal : null;
}

/** '2:05' style hold time; '45 s' under a minute. */
export function fmtHold(sec) {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Change vs last time → { text, tone: 'up'|'down'|'same' } or null when there's nothing to compare. */
export function deltaText(now, prev, fmt = (v) => v.toLocaleString()) {
  if (prev == null || (!prev && !now)) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return { text: 'Same as last time', tone: 'same' };
  return { text: `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))} vs last`, tone: d > 0 ? 'up' : 'down' };
}

/** One set as plain words: '10 reps x 30 lb', '12 reps', '45 s x 25 lb', '45 s'. */
export function setLine(s, ex, u) {
  const load = s.weight && s.weight > 0 ? ` x ${s.weight} ${u}` : '';
  if (ex && ex.timed) return `${s.reps} s${load}`;
  return `${s.reps} ${s.reps === 1 ? 'rep' : 'reps'}${load}`;
}
