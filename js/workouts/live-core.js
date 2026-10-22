// Live cardio workout: the state machine, the numbers on the live screen and the record we keep. Pure (no DOM, no
// native calls) so tests/v01651.test.js can drive it. The screen is js/screens/live.js, the iPhone side is
// js/native/live-workout.js and ios/App/App/ForgeLiveWorkout.swift.
import { CARDIO_TYPES } from '../cardio-types.js';

const MI_KM = 1.609344;

/** What can be started live. `hk` is the HealthKit activity name the Swift side maps; distance only where the phone can measure it. */
export const LIVE_KINDS = {
  jog_in_place: { label: 'Jog in place', hk: 'running', indoor: true, distance: false, met: 8.0 },
  walk: { label: 'Walk', hk: 'walking', indoor: false, distance: true, met: 3.8 },
  run: { label: 'Run', hk: 'running', indoor: false, distance: true, met: 9.8 },
};
export const LIVE_ORDER = ['jog_in_place', 'walk', 'run'];
export const RESTING_KCAL_PER_KG_HOUR = 1; // resting energy, a standard rule of thumb (1 kcal per kg per hour)

/** A fresh session. `at` is a ms timestamp. */
export function newLive(kind, at, id = `live_${at.toString(36)}`) {
  if (!LIVE_KINDS[kind]) kind = 'jog_in_place';
  return { id, kind, started_at: at, ended_at: null, pauses: [], pausedAt: null };
}

export const isPaused = (s) => s.pausedAt != null;
export const isEnded = (s) => s.ended_at != null;

/** Pause at `at`. Pausing twice, or after the end, changes nothing (the Live Activity button and the screen can both fire). */
export function pauseLive(s, at) {
  if (isEnded(s) || isPaused(s) || at < s.started_at) return s;
  return { ...s, pausedAt: at };
}

export function resumeLive(s, at) {
  if (isEnded(s) || !isPaused(s)) return s;
  const end = Math.max(at, s.pausedAt);
  return { ...s, pausedAt: null, pauses: [...s.pauses, { start: s.pausedAt, end }] };
}

/** End at `at`; an open pause is closed first. */
export function endLive(s, at) {
  if (isEnded(s)) return s;
  const r = resumeLive(s, at);
  return { ...r, ended_at: Math.max(at, s.started_at) };
}

/** Active (moving) milliseconds: elapsed time minus pauses. */
export function activeMs(s, now) {
  const stop = isEnded(s) ? s.ended_at : isPaused(s) ? s.pausedAt : now;
  let ms = Math.max(0, stop - s.started_at);
  for (const p of s.pauses) ms -= Math.max(0, Math.min(p.end, stop) - Math.max(p.start, s.started_at));
  return Math.max(0, ms);
}

/** "7:05" or "1:02:09". */
export function fmtElapsed(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Distance text in the user's unit ('mi' | 'km'), two decimals. */
export function fmtDistance(meters, unit) {
  const km = Math.max(0, meters || 0) / 1000;
  return (unit === 'km' ? km : km / MI_KM).toFixed(2);
}

/** Average pace as "9'15\"" per mi or km; "--'--\"" until there is enough distance (30 m) to mean something. */
export function fmtPace(meters, ms, unit) {
  if (!(meters >= 30) || !(ms > 0)) return '--\'--"';
  const perUnit = (ms / 1000) / ((meters / 1000) / (unit === 'km' ? 1 : MI_KM));
  const total = Math.round(perUnit);
  return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, '0')}"`;
}

/** Active kcal: what the phone measured when it has, else MET × kg × active hours. null when neither is possible. */
export function activeKcal(kind, ms, weightKg, measured) {
  if (measured > 0) return Math.round(measured);
  const met = (LIVE_KINDS[kind] || LIVE_KINDS.jog_in_place).met;
  if (!(weightKg > 0)) return null;
  return Math.round(met * weightKg * (ms / 3600000));
}

/** Total kcal = active + resting for the same time (resting is an estimate). */
export function totalKcal(active, ms, weightKg) {
  if (active == null) return null;
  return active + (weightKg > 0 ? Math.round(RESTING_KCAL_PER_KG_HOUR * weightKg * (ms / 3600000)) : 0);
}

/**
 * The cardio row to keep when a live workout ends. `hk` is what the phone saved to Apple Health
 * ({ uuid, kcal, distanceM, avgHr, maxHr } or null on the web / when saving to Health is off).
 * Carries ForgeWorkoutId-style identity (`live_…` id + hk_uuid) so the Apple Health importer (#146) never adds it twice.
 */
export function liveToCardio(s, { hk = null, weightKg = null, now = s.ended_at } = {}) {
  const ms = activeMs(s, now);
  const kcal = activeKcal(s.kind, ms, weightKg, hk && hk.kcal);
  const km = hk && hk.distanceM > 0 && LIVE_KINDS[s.kind].distance ? Math.round(hk.distanceM / 10) / 100 : null;
  const day = new Date(s.started_at).toLocaleDateString('en-CA');
  const fields = {
    activity: s.kind,
    started_at: new Date(s.started_at).toISOString(),
    day,
    duration_min: Math.max(1, Math.round(ms / 60000)),
    distance_km: km,
    calories: kcal,
    avg_hr: hk && hk.avgHr ? Math.round(hk.avgHr) : null,
    notes: 'Recorded live in Forge',
    live_id: s.id,
  };
  if (hk && hk.maxHr) fields.max_hr = Math.round(hk.maxHr);
  if (hk && hk.uuid) { fields.hk_uuid = hk.uuid; fields.hk_source = 'Forge'; }
  return { id: s.id, fields };
}

/** True when a cardio row already covers this Apple Health workout uuid (a live workout Forge wrote itself). */
export const alreadyLive = (cardioRows, platformId) => (cardioRows || []).some((c) => !c.deleted && c.live_id && c.hk_uuid === platformId);

/** The words on the lock screen / screen reader line. */
export function liveSummaryLine(s, now, unit, { distanceM = 0, kcal = null } = {}) {
  const k = LIVE_KINDS[s.kind];
  const parts = [`${CARDIO_TYPES[s.kind] || k.label} ${fmtElapsed(activeMs(s, now))}`];
  if (k.distance && distanceM > 0) parts.push(`${fmtDistance(distanceM, unit)} ${unit}`);
  if (kcal != null) parts.push(`${kcal} active kcal`);
  if (isPaused(s)) parts.push('paused');
  return parts.join(', ');
}
