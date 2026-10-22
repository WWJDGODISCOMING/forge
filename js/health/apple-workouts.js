// Apple Watch workouts → Forge cardio rows (Phase 1: read only). Pure: no plugin, no Firestore. The caller
// (js/screens/apple.js) reads the workouts with js/native/health.js, looks up which ids already exist, and writes
// the rows this plans. Rows are `hk_<HealthKit UUID>`, so a second read finds and updates the same doc.
import { NO_DISTANCE } from '../cardio-types.js';
import { alreadyLive } from '../workouts/live-core.js';

export const FORGE_SOURCE_ID = 'com.christianeverett.forge'; // capacitor.config.json appId: Phase 2's own writes
const INDOOR_JOG_M = 200;

const MAP = {
  running: 'run', runningTreadmill: 'run',
  walking: 'walk',
  cycling: 'bike', bikingStationary: 'bike',
  rowing: 'row', rowingMachine: 'row',
  elliptical: 'elliptical',
  stairClimbing: 'stairs', stairs: 'stairs', stepTraining: 'stairs', stairClimbingMachine: 'stairs',
  boxing: 'boxing', kickboxing: 'boxing',
  highIntensityIntervalTraining: 'hiit',
  jumpRope: 'jump_rope',
};

/** "mixedCardio" → "Mixed cardio". */
export function readableType(t) {
  const s = String(t || 'other').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const isIndoor = (w) => {
  const m = w.metadata || {};
  const v = m.HKIndoorWorkout ?? m.indoor ?? m.isIndoor;
  return w.workoutType === 'runningTreadmill' || v === true || v === 1 || v === '1' || v === 'true';
};

/** Forge cardio key for an Apple workout; `notes` is set only for the catch-all. */
export function mapActivity(w) {
  const t = w.workoutType;
  const dist = Number(w.totalDistance);
  if (t === 'running' || t === 'runningTreadmill') {
    const meters = Number.isFinite(dist) ? dist : 0;
    return isIndoor(w) && meters < INDOOR_JOG_M ? { activity: 'jog_in_place' } : { activity: 'run' };
  }
  if (MAP[t]) return { activity: MAP[t] };
  if (typeof t === 'string' && t.startsWith('swimming')) return { activity: 'swim' };
  return { activity: 'other', notes: `${readableType(t)} · Apple Watch` };
}

const ms = (x) => Date.parse(x);
/** Overlap as a share of the shorter of the two spans (0 when they don't meet). */
export function overlapShare(aStart, aEnd, bStart, bEnd) {
  const a0 = ms(aStart), a1 = ms(aEnd), b0 = ms(bStart), b1 = ms(bEnd);
  if (![a0, a1, b0, b1].every(Number.isFinite)) return 0;
  const shorter = Math.min(a1 - a0, b1 - b0);
  if (shorter <= 0) return 0;
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / shorter;
}

/** Why a workout is not imported ('forge' | 'linked'), or null. */
export function skipReason(w, forgeWorkouts = [], cardio = []) {
  if (w.sourceId === FORGE_SOURCE_ID || (w.metadata && w.metadata.ForgeWorkoutId)) return 'forge';
  if (alreadyLive(cardio, w.platformId)) return 'forge'; // a live workout Forge recorded and saved to Health itself (#153)
  for (const f of forgeWorkouts) {
    if (f.deleted || !f.finished_at || f.apple_workout_uuid !== w.platformId) continue;
    if (overlapShare(w.startDate, w.endDate, f.started_at, f.finished_at) >= 0.5) return 'linked';
  }
  return null;
}

const localDay = (iso) => new Date(iso).toLocaleDateString('en-CA');

/** kcal for a workout: its own total, else the sum of the active-energy samples from the same source in its window. */
export function workoutKcal(w, energySamples = []) {
  const own = Math.round(Number(w.totalEnergyBurned));
  if (own > 0) return own;
  const t0 = ms(w.startDate), t1 = ms(w.endDate);
  let sum = 0;
  for (const s of energySamples) {
    if (w.sourceId && s.sourceId && s.sourceId !== w.sourceId) continue;
    const a = ms(s.startDate);
    if (a >= t0 && a < t1) sum += Number(s.value) || 0;
  }
  return Math.round(sum) || null;
}

/** One Apple workout → the cardio fields (without the standard record fields), or null when it can't be used. */
export function workoutToCardio(w, energySamples = []) {
  if (!w || !w.platformId || !Number.isFinite(ms(w.startDate))) return null;
  const { activity, notes } = mapActivity(w);
  const dist = Number(w.totalDistance);
  const secs = Number(w.duration) || (ms(w.endDate) - ms(w.startDate)) / 1000 || 0;
  return {
    activity,
    started_at: new Date(w.startDate).toISOString(),
    day: localDay(w.startDate),
    duration_min: Math.max(1, Math.round(secs / 60)),
    distance_km: NO_DISTANCE.includes(activity) || !(dist > 0) ? null : Math.round(dist / 10) / 100,
    calories: workoutKcal(w, energySamples),
    avg_hr: w.avg_hr ?? null,
    max_hr: w.max_hr ?? null,
    notes: notes || '',
    hk_uuid: w.platformId,
    hk_source: w.sourceName || 'Apple Watch',
  };
}

/**
 * workouts: plugin workouts (with optional avg_hr / max_hr / energySamples).
 * existing: Map of cardio doc id → { deleted } for ids that exist in Firestore (live or deleted).
 * → { create: [{ id, fields }], update: [{ id, fields }], skipped: n }.
 * A deleted doc is never rewritten or revived; Forge-written and linked workouts are skipped.
 */
export function planWorkoutImport(workouts, { existing = new Map(), forgeWorkouts = [], cardio = [] } = {}) {
  const out = { create: [], update: [], skipped: 0 };
  const seen = new Set();
  for (const w of workouts || []) {
    const id = w && w.platformId ? `hk_${w.platformId}` : null;
    if (!id || seen.has(id) || skipReason(w, forgeWorkouts, cardio)) { out.skipped++; continue; }
    seen.add(id);
    const have = existing.get(id);
    if (have && have.deleted) { out.skipped++; continue; }
    const fields = workoutToCardio(w, w.energySamples);
    if (!fields) { out.skipped++; continue; }
    (have ? out.update : out.create).push({ id, fields });
  }
  return out;
}

/** The "Apple Watch" tag History shows on an imported row. */
export const sourceTag = (c) => (c && c.source === 'apple_health' ? (c.hk_source || 'Apple Watch') : 'Manual');
