// Pure helpers for the player's History sheet and Replace (#194). No DOM, so the tests can run them.
import { e1rm } from './progression.js';

/** How hard a set was, for picking the best one: estimated 1-rep max when weighted, else reps (or seconds held). */
function score(set, weighted) {
  if (weighted && set.weight) return e1rm(set.weight, set.reps) ?? set.weight * 0.001;
  return set.reps || 0;
}

/** The best set of a session (first one wins a tie), or null if it has none. */
export function bestSet(sets, { timed = false } = {}) {
  const weighted = !timed && sets.some((s) => s.weight);
  let best = null;
  for (const s of sets || []) if (!best || score(s, weighted) > score(best, weighted)) best = s;
  return best;
}

/** "135 × 8", "12", "45 s". */
export function setText(s, { timed = false } = {}) {
  return `${s.weight ? `${s.weight} × ` : ''}${s.reps}${timed ? ' s' : ''}`;
}

/** The newest `limit` sessions as rows: { date, deload, sets: [text], best: text }. */
export function historyRows(sessions, { timed = false, limit = 8 } = {}) {
  return (sessions || []).slice(0, limit).map((s) => {
    const b = bestSet(s.sets, { timed });
    return { date: s.date, deload: !!s.deload, sets: s.sets.map((x) => setText(x, { timed })), best: b ? setText(b, { timed }) : '' };
  });
}

/** One value per session, oldest first, for the trend: best estimated 1-rep max, or best reps / hold. */
export function trendValues(sessions, { timed = false, limit = 12 } = {}) {
  return (sessions || []).slice(0, limit).reverse().map((s) => {
    const b = bestSet(s.sets, { timed });
    if (!b) return null;
    const weighted = !timed && s.sets.some((x) => x.weight);
    const v = score(b, weighted);
    return weighted ? Math.round(v * 10) / 10 : v;
  }).filter((v) => v != null);
}

/** Points for a small line chart in a w × h box (pad px inside). A single value draws one centred dot. */
export function sparkPoints(values, w = 300, h = 80, pad = 8) {
  if (!values.length) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (n) => (values.length === 1 ? w / 2 : pad + (n / (values.length - 1)) * (w - pad * 2));
  const y = (v) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2));
  return values.map((v, n) => ({ x: Math.round(x(n) * 10) / 10, y: Math.round(y(v) * 10) / 10, v }));
}

/** Up, down or flat across the trend, in plain words (never a judgement). */
export function trendWords(values) {
  if (values.length < 2) return 'Do it a couple more times to see a trend.';
  const a = values[0];
  const b = values[values.length - 1];
  if (Math.abs(b - a) < 0.5) return 'Holding steady.';
  return b > a ? 'Trending up.' : 'Trending down.';
}

/**
 * Put `fresh` (a new entry built for the replacement move) in the place of `old`, keeping the slot's targets:
 * the same number of working sets with the same rep targets, its superset, role and rest. Warm-ups and weights come
 * from `fresh`, since they depend on the move. Returns null when a set is already done (the caller says why).
 */
export function replaceKeepingTargets(old, fresh) {
  if (old.sets.some((s) => s.done)) return null;
  const oldWork = old.sets.filter((s) => !s.warmup);
  const freshWork = fresh.sets.filter((s) => !s.warmup);
  const warm = fresh.sets.filter((s) => s.warmup);
  const tpl = freshWork[0] || { plan_weight_kg: null };
  const work = oldWork.map((s, n) => ({
    ...(freshWork[n] || tpl), warmup: false, plan_reps: s.plan_reps ?? (freshWork[n] || tpl).plan_reps ?? null,
  }));
  const out = { ...fresh, role: old.role, superset: old.superset, sets: [...warm, ...work] };
  if (old.target) out.target = { ...fresh.target, sets: oldWork.length, rep_lo: old.target.rep_lo, rep_hi: old.target.rep_hi, reps: old.target.reps };
  if (old.rest_sec) out.rest_sec = old.rest_sec;
  return out;
}
