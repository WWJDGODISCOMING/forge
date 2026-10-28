// Pause-aware workout clock. Pure functions over the stored workout fields:
//   started_at (ISO), paused_at (ISO or null while running), paused_ms (total paused so far).
// Paused time never counts toward the workout's duration, and the paused state survives an app kill
// because it lives on the workout document itself.

export const AWAY_THRESHOLD_MS = 10 * 60 * 1000;
export const MAX_PAUSES = 200;

const capPauses = (list) => (list.length > MAX_PAUSES ? list.slice(-MAX_PAUSES) : list);

const t = (iso) => (iso ? Date.parse(iso) : null);

/** Active (unpaused) milliseconds since the workout started. */
export function elapsedMs(w, now = Date.now()) {
  const start = t(w.started_at);
  if (start == null) return 0;
  const pausedSoFar = w.paused_ms || 0;
  const pausedNow = w.paused_at ? Math.max(0, now - t(w.paused_at)) : 0;
  return Math.max(0, now - start - pausedSoFar - pausedNow);
}

export const isPaused = (w) => !!(w && w.paused_at);

/** Fields to write when pausing. Pausing twice is a no-op. */
export function pauseFields(w, now = Date.now()) {
  if (isPaused(w)) return {};
  return { paused_at: new Date(now).toISOString() };
}

/** Fields to write when resuming: the paused stretch moves into paused_ms. */
export function resumeFields(w, now = Date.now()) {
  if (!isPaused(w)) return {};
  const start = t(w.paused_at);
  const pauses = capPauses([...(w.pauses || []), { start: w.paused_at, end: new Date(Math.max(start, now)).toISOString() }]);
  return { paused_at: null, paused_ms: (w.paused_ms || 0) + Math.max(0, now - start), pauses };
}

/**
 * How long you were away (app closed or in the background) while NOT paused, or 0 if under the threshold.
 * lastSeen: ms timestamp of the last time the app was visible with this workout open.
 */
export function awayGapMs(w, lastSeen, now = Date.now(), threshold = AWAY_THRESHOLD_MS) {
  if (!w || isPaused(w) || !lastSeen) return 0;
  const gap = now - lastSeen;
  return gap > threshold ? gap : 0;
}

/**
 * "Remove it": treat the away stretch as paused time. awayStart (ms) is when you were last seen, so the
 * recorded pause is awayStart .. awayStart + gap however long you wait before tapping. It is clamped so it
 * never overlaps an earlier recorded pause. Without awayStart it falls back to the gap ending at `now`.
 */
export function removeAwayFields(w, gapMs, now = Date.now(), awayStart = null) {
  const gap = Math.max(0, gapMs);
  const old = w.pauses || [];
  if (gap <= 0) return { paused_ms: w.paused_ms || 0, pauses: old };
  const from = awayStart != null ? awayStart : now - gap;
  const lastEnd = old.reduce((m, p) => Math.max(m, t(p.end) || 0), 0);
  const start = Math.max(from, lastEnd);
  const end = from + gap;
  const pauses = end > start ? capPauses([...old, { start: new Date(start).toISOString(), end: new Date(end).toISOString() }]) : old;
  return { paused_ms: (w.paused_ms || 0) + gap, pauses };
}
