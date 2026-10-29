// Main lifts' estimated 1-rep max, best in each 4-week block, for Coach's "Am I getting stronger?". Pure.
import { buildIndex } from '../workouts/history.js';
import { e1rm } from '../workouts/progression.js';
import { addDays, dayKey } from '../weight/smoothing.js';

export const BLOCK_DAYS = 28;

const best = (sessions, [from, to]) => {
  let top = null;
  for (const s of sessions) {
    const day = dayKey(s.date);
    if (s.deload || day < from || day > to) continue;
    for (const set of s.sets) {
      const e = e1rm(set.weight, set.reps);
      if (e && (top == null || e > top)) top = e;
    }
  }
  return top == null ? null : Math.round(top);
};

/**
 * workouts: stored docs; unit 'lb' | 'kg'; nameOf(id) gives the exercise name. Block 0 is the last 28 days,
 * block 1 the 28 before, block 3 the 28 days that ended 12 weeks ago. Returns
 * [{ id, name, now, before4, before12, change4, change12 }] in the display unit (null where a block has no
 * data), for exercises done as a 'main' lift in the last 16 weeks. Deload sessions are left out.
 */
export function liftChanges({ workouts, unit, today, nameOf }) {
  const idx = buildIndex(workouts, unit);
  const since = addDays(today, -(BLOCK_DAYS * 4 - 1));
  const mains = new Set();
  for (const w of idx.done) {
    if (dayKey(w.started_at) < since) continue;
    for (const ex of w.exercises || []) if (ex.role === 'main') mains.add(ex.exercise_id);
  }
  const win = (n) => [addDays(today, -(BLOCK_DAYS * (n + 1) - 1)), addDays(today, -BLOCK_DAYS * n)];
  const out = [];
  for (const id of mains) {
    const h = idx.historyFor(id);
    const now = best(h, win(0));
    const before4 = best(h, win(1));
    const before12 = best(h, win(3));
    out.push({
      id, name: nameOf(id), now, before4, before12,
      change4: now != null && before4 != null ? now - before4 : null,
      change12: now != null && before12 != null ? now - before12 : null,
    });
  }
  return out.filter((l) => l.now != null).sort((a, b) => (a.name < b.name ? -1 : 1));
}
