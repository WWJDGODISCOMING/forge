// Calories for a finished Forge workout, and the rules for sending it to Apple Health. Pure.
// kcal = MET × body weight (kg) × active hours. MET values are from the Compendium of Physical Activities
// (2024 update): resistance training 3.5 light / 5.0 moderate / 6.0 vigorous; circuit training, HIIT and
// conditioning 8.0. An estimate for the Activity rings and the summary line, never an input to progression,
// deload, recovery or the generator (tests/v01650.test.js checks nothing there imports this file).
import { exerciseById } from './library.js';

export const MET = { light: 3.5, moderate: 5.0, vigorous: 6.0, conditioning: 8.0 };
export const LINK_OVERLAP = 0.5; // a Watch workout covering this much of the shorter one counts as the same session
export const COVER_LINK = 0.8; // any workout type covering this much of the Forge session counts as the same session
export const DEFAULT_WEIGHT_KG = 75; // used for the estimate only when there is no weigh-in and no profile weight
export const MEASURED_SHARE = 0.7; // measured energy this close to the estimate is used instead of it
export const MAX_TRIES = 5;

const doneWorking = (w) => (w.exercises || []).flatMap((it) => (it.sets || []).filter((s) => s.done && !s.warmup).map((s) => ({ it, s })));
const kindOf = (it) => { const ex = exerciseById(it.exercise_id); return ex ? ex.kind : null; };
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };

/** Share of done working sets that come from conditioning exercises (0 to 1). */
export function conditioningShare(w) {
  const sets = doneWorking(w);
  return sets.length ? sets.filter(({ it }) => kindOf(it) === 'conditioning').length / sets.length : 0;
}

/** Average seconds between finishing one set and the next, ignoring gaps over 10 minutes. null with under 2 timed sets. */
export function averageRestSec(w) {
  const t = doneWorking(w).map(({ s }) => Date.parse(s.completed_at)).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] <= 600000) gaps.push((t[i] - t[i - 1]) / 1000);
  return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
}

/** 'conditioning' | 'vigorous' | 'light' | 'moderate' for a finished workout. */
export function intensity(w) {
  if (conditioningShare(w) >= 0.5) return 'conditioning';
  if (w.deload) return 'light';
  const rirs = doneWorking(w).map(({ s }) => s.rir).filter((r) => typeof r === 'number');
  if (rirs.length) {
    if (rirs.filter((r) => r >= 4).length > rirs.length / 2) return 'light';
    const rest = averageRestSec(w);
    if (median(rirs) <= 1 && rest != null && rest < 90) return 'vigorous';
  }
  return 'moderate';
}

export const metFor = (w) => MET[intensity(w)];

/** The latest weight in kg from state.weights, else profile.weightKg, else null. */
export function weightKgFor(weights, profile) {
  const rows = (weights || []).filter((r) => !r.deleted && Number(r.kg) > 0);
  rows.sort((a, b) => String(a.measured_at || a.date || a.id).localeCompare(String(b.measured_at || b.date || b.id)));
  const last = rows[rows.length - 1];
  const kg = last ? Number(last.kg) : Number(profile && profile.weightKg);
  return kg > 0 ? kg : null;
}

/** { kg, estimated }: the real weight, else DEFAULT_WEIGHT_KG marked as an estimate. */
export function weightOrDefault(weights, profile) {
  const kg = weightKgFor(weights, profile);
  return kg ? { kg, estimated: false } : { kg: DEFAULT_WEIGHT_KG, estimated: true };
}

/** Whole kcal, or null when there is no weight or no time. */
export function estimateKcal(w, weightKg) {
  const ms = Number(w && w.duration_ms);
  if (!(weightKg > 0) || !(ms > 0)) return null;
  return Math.round(metFor(w) * weightKg * (ms / 3.6e6));
}

/** HealthKit activity type name: strength, bodyweight/circuit → functional, conditioning-dominated → mixedCardio. */
export function activityTypeFor(w) {
  if (conditioningShare(w) >= 0.5) return 'mixedCardio';
  const its = (w.exercises || []).filter((it) => (it.sets || []).some((s) => s.done));
  const bw = its.filter((it) => { const ex = exerciseById(it.exercise_id); return ex && ex.load === 'bodyweight'; }).length;
  return its.length && bw / its.length >= 0.7 ? 'functionalStrengthTraining' : 'traditionalStrengthTraining';
}

/** The recorded pauses that have both ends, in ms, oldest first. */
export function closedPauses(w) {
  return (Array.isArray(w && w.pauses) ? w.pauses : [])
    .map((p) => ({ start: Date.parse(p && p.start), end: Date.parse(p && p.end) }))
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * The window written to Health: started_at plus the active time. When pauses were recorded the window also spans
 * them, so the active time inside it is still duration_ms.
 */
export function windowFor(w) {
  const start = Date.parse(w.started_at);
  const ms = Number(w.duration_ms);
  if (Number.isNaN(start) || !(ms > 0)) return null;
  const paused = closedPauses(w).filter((p) => p.start >= start).reduce((n, p) => n + (p.end - p.start), 0);
  return { start: new Date(start).toISOString(), end: new Date(start + ms + paused).toISOString() };
}

/** The pauses to send to Health: ISO start/end, inside the window. */
export function pausesFor(w, win = windowFor(w)) {
  if (!win) return [];
  const a = Date.parse(win.start), b = Date.parse(win.end);
  return closedPauses(w).filter((p) => p.start >= a && p.end <= b).map((p) => ({ start: new Date(p.start).toISOString(), end: new Date(p.end).toISOString() }));
}

/** Share of the shorter of two windows that the overlap covers. Touching edges = 0. */
export function overlapShare(a, b) {
  const as = Date.parse(a.start), ae = Date.parse(a.end), bs = Date.parse(b.start), be = Date.parse(b.end);
  const over = Math.min(ae, be) - Math.max(as, bs);
  const shorter = Math.min(ae - as, be - bs);
  return over > 0 && shorter > 0 ? over / shorter : 0;
}

/** requestAuthorization result → 'denied' if either Workouts or Active Energy was refused (separate toggles in the iOS sheet). */
export function accessStatus(r) {
  if (r && (r.workout === 'denied' || r.energy === 'denied')) return 'denied';
  return (r && r.workout) || 'notDetermined';
}

// HKWorkoutActivityType raw values that are the same kind of session as a Forge workout: cross training 11,
// functional strength 20, traditional strength 50, core 59, HIIT 63, mixed cardio 73.
const STRENGTH_RAW = new Set([11, 20, 50, 59, 63, 73]);
const STRENGTH_NAMES = /strength|hiit|highintensity|crosstraining|mixedcardio|core/i;
export function isStrengthLike(o) {
  const t = o && (o.activityType ?? o.type);
  if (typeof t === 'number') return STRENGTH_RAW.has(t);
  return typeof t === 'string' && STRENGTH_NAMES.test(t);
}

/** Share of the Forge window that the other workout covers. */
export function coverShare(win, o) {
  const ws = Date.parse(win.start), we = Date.parse(win.end);
  const over = Math.min(we, Date.parse(o.end)) - Math.max(ws, Date.parse(o.start));
  return over > 0 && we > ws ? over / (we - ws) : 0;
}

/**
 * The overlapping non-Forge workout to link to: the most-overlapping one that is strength-like and reaches
 * LINK_OVERLAP of the shorter session, or of any type and covers COVER_LINK of the Forge session. Otherwise null,
 * so a walk next to a lift doesn't swallow it (Health de-dupes the exercise minutes).
 */
export function pickOverlap(win, workouts) {
  let best = null;
  let bestShare = 0;
  for (const o of workouts || []) {
    const sh = overlapShare(win, o);
    const ok = (isStrengthLike(o) && sh >= LINK_OVERLAP) || coverShare(win, o) >= COVER_LINK;
    if (ok && sh > bestShare) { best = o; bestShare = sh; }
  }
  return best;
}

/**
 * What to do after a workout finishes. `overlaps` are Health workouts in the window, `measuredKcal` the
 * de-duplicated active energy in it, `estimate` the MET estimate (or null).
 * → { action: 'link', patch } | { action: 'save', kcal, source } | { action: 'skip', reason }
 */
export function decide({ win, overlaps, measuredKcal, estimate }) {
  const o = pickOverlap(win, overlaps);
  if (o) {
    const patch = { apple_workout_uuid: o.uuid, kcal_source: 'apple_watch', health_write: 'linked' };
    if (o.kcal != null) patch.kcal = Math.round(o.kcal);
    if (o.avgHr != null) patch.avg_hr = Math.round(o.avgHr);
    return { action: 'link', patch };
  }
  const m = Number(measuredKcal) || 0;
  if (estimate != null && m >= MEASURED_SHARE * estimate && m > 0) return { action: 'save', kcal: Math.round(m), source: 'measured' };
  if (estimate == null && m > 0) return { action: 'save', kcal: Math.round(m), source: 'measured' };
  if (estimate != null) return { action: 'save', kcal: estimate, source: 'estimate' };
  return { action: 'skip', reason: 'no-weight' };
}

/** The patch after a Health call failed: pending, with the try count. Gives up (null) after MAX_TRIES. */
export function pendingPatch(w) {
  const tries = (Number(w.health_tries) || 0) + 1;
  return tries >= MAX_TRIES ? { health_write: 'failed', health_tries: tries } : { health_write: 'pending', health_tries: tries };
}

/** The version to save an edited workout with: one more than the last saved. */
export const nextVersion = (w) => (Number(w.health_version) || 0) + 1;

/** The status line on the summary: { text, action? } or null. `native` = iPhone app, `enabled` = the Health write switch. */
export function healthStatus(w, { native, enabled }) {
  if (!native || !w) return null;
  if (w.health_write === 'linked') return { text: 'Linked to Apple Watch workout' };
  if (w.health_write === 'saved') return { text: 'Saved to Apple Health' };
  if (w.health_write === 'pending') return { text: 'Pending retry' };
  if (w.health_write === 'failed') return { text: 'Couldn’t send to Apple Health' };
  if (!enabled) return { text: 'Not sent — turn on', action: 'turn-on' };
  return null;
}

/** Whole minutes for a finished workout: duration_ms, else finished_at - started_at - paused_ms. null when unknown. */
export function durationMin(w) {
  if (!w) return null;
  let ms = Number(w.duration_ms);
  if (!(ms > 0)) ms = Date.parse(w.finished_at) - Date.parse(w.started_at) - (Number(w.paused_ms) || 0);
  return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : null;
}

/** " · 42 min" for History rows and the detail sheet, or "" when unknown. */
export function durationText(w) {
  const m = durationMin(w);
  return m ? ` · ${m} min` : '';
}

/** The summary / history line for the calories: "≈ 180 kcal (estimate)", "180 kcal (Apple Watch)", "180 kcal (measured)". */
export function kcalLine(w) {
  if (!w || !(w.kcal > 0)) return null;
  const k = Math.round(w.kcal);
  if (w.kcal_source === 'apple_watch') return `${k} kcal (Apple Watch)`;
  if (w.kcal_source === 'measured') return `${k} kcal (measured)`;
  return `≈ ${k} kcal (estimate)`;
}
