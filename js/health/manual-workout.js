// Hand-logged workouts (#253). Pure: no DOM, no Firestore. The sheet (js/screens/log-workout.js) calls these.
// Storage decision: every manual workout, strength and "other" included, is a cardio_sessions row with
// `activity: 'strength' | 'other'` (+ `name` for other) and `manual: true`. No sets, so no `workouts` doc: History,
// the weekly goal and the rings already read cardio_sessions.
import { NO_DISTANCE, cardioDistanceKm } from '../cardio-types.js';
import { overlapShare } from './apple-workouts.js';

export const LIMITS = { minutes: [1, 600], kcal: [0, 5000], hr: [30, 230] };
const MERGE_AT = 0.5;

/** Local date ('YYYY-MM-DD') + time ('HH:MM') → a Date in the phone's time zone, or null. */
export function localStart(day, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || ''), t = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!d || !t) return null;
  const out = new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], 0, 0);
  return Number.isNaN(out.getTime()) || out.getDate() !== +d[3] ? null : out;
}

const blank = (v) => v === '' || v == null;
const num = (v) => (blank(v) ? null : Number(v));

/**
 * Check the typed values. → { ok, error, fields } where fields is the row to save (no record fields).
 * input: { activity, name, day, time, min, kcal, dist, hr, notes } (strings ok); `distUnit` is 'km' | 'mi'; `now` a Date.
 */
export function validateManual(input, { distUnit = 'km', now = new Date() } = {}) {
  const bad = (error) => ({ ok: false, error, fields: null });
  const min = num(input.min);
  if (!Number.isFinite(min) || min < LIMITS.minutes[0] || min > LIMITS.minutes[1]) return bad(`Minutes should be between ${LIMITS.minutes[0]} and ${LIMITS.minutes[1]}.`);
  const start = localStart(input.day, input.time);
  if (!start) return bad('Pick a date and a start time.');
  if (start.getTime() > now.getTime()) return bad('That start time hasn’t happened yet.');
  const kcal = num(input.kcal), hr = num(input.hr), dist = num(input.dist);
  if (kcal != null && !(Number.isFinite(kcal) && kcal >= LIMITS.kcal[0] && kcal <= LIMITS.kcal[1])) return bad(`Calories should be between ${LIMITS.kcal[0]} and ${LIMITS.kcal[1]}.`);
  if (hr != null && !(Number.isFinite(hr) && hr >= LIMITS.hr[0] && hr <= LIMITS.hr[1])) return bad(`Heart rate should be between ${LIMITS.hr[0]} and ${LIMITS.hr[1]}.`);
  if (dist != null && !(Number.isFinite(dist) && dist >= 0)) return bad('Distance can’t be negative.');
  const activity = String(input.activity || 'other');
  const name = activity === 'other' ? String(input.name || '').trim().slice(0, 40) : '';
  const km = dist == null ? null : cardioDistanceKm(activity, dist, distUnit);
  return {
    ok: true,
    error: '',
    fields: {
      activity,
      ...(name ? { name } : {}),
      started_at: start.toISOString(),
      day: input.day,
      duration_min: min,
      distance_km: km && km > 0 ? Math.round(km * 1000) / 1000 : null,
      calories: kcal == null ? null : Math.round(kcal),
      avg_hr: hr == null ? null : Math.round(hr),
      notes: String(input.notes || '').trim().slice(0, 200),
      manual: true,
    },
  };
}

export const endOf = (c) => new Date(Date.parse(c.started_at) + (Number(c.duration_min) || 0) * 60000).toISOString();

/** Kinds that count as "the same" for merging: an imported run covers a manual run; 'other' and 'strength' match any non-cardio import. */
const sameKind = (manual, imp) => manual.activity === imp.activity || (manual.activity === 'strength' && imp.activity === 'other') || (manual.activity === 'other' && imp.activity === 'other');

/**
 * Which hand-logged rows an incoming Apple row (fields from workoutToCardio) overlaps by ≥50% of the shorter span.
 * → [{ id, share }] best first. Deleted rows and rows already merged are ignored.
 */
export function planManualMerge(imported, cardio = []) {
  if (!imported || !imported.started_at) return [];
  const iEnd = endOf(imported);
  return (cardio || [])
    .filter((c) => c && c.manual && !c.deleted && !c.merged_into && c.started_at && sameKind(c, imported))
    .map((c) => ({ id: c.id, share: overlapShare(c.started_at, endOf(c), imported.started_at, iEnd) }))
    .filter((m) => m.share >= MERGE_AT)
    .sort((a, b) => b.share - a.share);
}

/** Merging keeps the Watch data: the manual row is soft-deleted (the caller does that); its notes carry over. */
export const mergeNotes = (manual, imported) => [imported.notes, manual.notes].filter(Boolean).join(' · ');

/** The uuid of the Health copy Forge itself wrote for a manual row, or null (never a Watch or other app's workout). */
export const forgeHealthUuid = (row) => (row && row.manual && row.hk_source === 'Forge' && row.hk_uuid ? String(row.hk_uuid) : null);

/** After a merge: ask `del(uuid)` once for each merged manual row that has its own Forge copy in Health. Fire and forget. */
export function dropHealthCopies(rows, del) {
  let n = 0;
  for (const r of rows || []) {
    const uuid = forgeHealthUuid(r);
    if (!uuid) continue;
    n++;
    try { Promise.resolve(del(uuid)).catch(() => {}); } catch { /* best effort */ }
  }
  return n;
}

/** Apple Health type the ForgeWorkouts plugin understands (it knows four). */
export function healthTypeFor(activity) {
  if (activity === 'run') return 'running';
  if (activity === 'walk') return 'walking';
  if (activity === 'strength') return 'traditionalStrengthTraining';
  return 'mixedCardio';
}

/** The saveWorkout payload for a manual row (id doubles as the Health sync id), or null when it can't be sent. */
export function healthPayload(row, version = 1) {
  const start = Date.parse(row && row.started_at), min = Number(row && row.duration_min);
  if (Number.isNaN(start) || !(min > 0)) return null;
  return { id: row.id, version, activityType: healthTypeFor(row.activity), start: new Date(start).toISOString(), end: endOf(row), pauses: [], kcal: Number(row.calories) || 0, indoor: NO_DISTANCE.includes(row.activity) || !row.distance_km };
}
