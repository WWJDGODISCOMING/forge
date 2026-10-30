// When the iPhone app reads Apple Health by itself. Two rules:
//  - the steady one: the last read is 6 h old;
//  - the morning one: it's between 4:00 and 12:00 and today's sleep isn't in health_daily yet (HRV usually syncs
//    during the night, but the sleep session is written only after waking), at most every 20 minutes.
// A failure backs the steady rule off for 6 h and the morning rule for 30 minutes.
import { indexDays } from '../health/metrics.js';

export const STEADY_EVERY_MS = 6 * 3600 * 1000;
export const MORNING_EVERY_MS = 20 * 60 * 1000;
export const MORNING_BACKOFF_MS = 30 * 60 * 1000;
export const MORNING_FROM_HOUR = 4;
export const MORNING_UNTIL_HOUR = 12;

/** Is last night's sleep for `today` (YYYY-MM-DD) in the health_daily rows? HRV or resting HR alone don't count. */
export function hasOvernight(rows, today) {
  const r = indexDays(rows).get(today);
  return !!r && !!r.sleep && r.sleep.asleep_min != null;
}

export const TODAY_EVERY_MS = 3 * 60 * 1000; // the cheap re-read of today's totals (steps, energy, exercise)

/** Is a cheap today-only re-read due? (Independent of the 6 h full read: reopening the app refreshes today.) */
export const todayDue = ({ now, todayAt = 0 }) => now.getTime() - todayAt >= TODAY_EVERY_MS;

export const FOREGROUND_GAP_MS = 60 * 1000;
/**
 * Run `fn` whenever the app comes back to the front (visibilitychange → visible), at most once per `gap` ms.
 * Returns a function that stops watching. `doc` is the document (a fake in tests).
 */
export function watchForeground(doc, fn, { gap = FOREGROUND_GAP_MS, now = () => Date.now() } = {}) {
  let at = -Infinity;
  const on = () => {
    if (doc.visibilityState !== 'visible') return;
    const t = now();
    if (t - at < gap) return;
    at = t;
    fn();
  };
  doc.addEventListener('visibilitychange', on);
  return () => doc.removeEventListener('visibilitychange', on);
}

export const BACKFILL_BACKOFF_MS = 20 * 60 * 1000;

/**
 * → 'backfill' | 'steady' | 'morning' | null.
 * { now: Date, last: ms of the last read, today, rows, failedAt, morningAt: ms of the last morning try, morningFailedAt,
 *   backfill: true while the one-time 30-day workouts + energy read (v0.16.45) hasn't happened on this phone, backfillFailedAt }
 */
export function autoReadMode({ now, last, today, rows, failedAt = 0, morningAt = 0, morningFailedAt = 0, backfill = false, backfillFailedAt = 0 }) {
  const t = now.getTime();
  if (backfill && t - backfillFailedAt >= BACKFILL_BACKOFF_MS) return 'backfill'; // right away: not after the 6 h wait
  if (t - last >= STEADY_EVERY_MS && t - failedAt >= STEADY_EVERY_MS) return 'steady';
  if (now.getHours() >= MORNING_FROM_HOUR && now.getHours() < MORNING_UNTIL_HOUR && !hasOvernight(rows, today)
    && t - morningAt >= MORNING_EVERY_MS && t - morningFailedAt >= MORNING_BACKOFF_MS) return 'morning';
  return null;
}

/** When Apple Health was last read on this phone for this account (ms; 0 = never). Per account on a shared phone. */
export const nativeReadKey = (uid) => `forge.healthkit.last.${uid || ''}`;
export function lastNativeRead(uid) {
  try { return Number(localStorage.getItem(nativeReadKey(uid))) || 0; } catch { return 0; }
}

/** The one-time 30-day read of Apple Watch workouts and resting/active energy, done once per account on this phone. */
export const backfillKey = (uid) => `forge.healthkit.backfill30.${uid || ''}`;
export function backfillDone(uid) {
  try { return !!localStorage.getItem(backfillKey(uid)); } catch { return false; }
}
export function markBackfillDone(uid) {
  try { localStorage.setItem(backfillKey(uid), String(Date.now())); } catch { /* private mode */ }
}

// ---------- Apple Watch workouts: the quick read (#252) ----------
// Workouts used to come only with the 6 h full read. The quick path reads just the workouts since the last good
// workout read (minus a day), at most every 3 minutes, and a failed read is remembered separately and retried soon.
export const WORKOUTS_EVERY_MS = 3 * 60 * 1000;
export const WORKOUTS_RETRY_MS = 5 * 60 * 1000; // after a failure (well inside 20 min)
export const WORKOUTS_LOOKBACK_DAYS = 3;

export const workoutsKey = (uid) => `forge.healthkit.workouts.${uid || ''}`;
export const workoutsFailedKey = (uid) => `forge.healthkit.workoutsFailedAt.${uid || ''}`;
const num = (k) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const put = (k, v) => { try { if (v) localStorage.setItem(k, String(v)); else localStorage.removeItem(k); } catch { /* private mode */ } };
/** When workouts were last read successfully on this phone (ms; 0 = never). */
export const lastWorkoutRead = (uid) => num(workoutsKey(uid));
export const lastWorkoutFailure = (uid) => num(workoutsFailedKey(uid));
export function markWorkoutRead(uid, t = Date.now()) { put(workoutsKey(uid), t); put(workoutsFailedKey(uid), 0); }
export function markWorkoutFailed(uid, t = Date.now()) { put(workoutsFailedKey(uid), t); }

/** Is a quick workout read due? `at` = ms of the last try in this session; `failedAt` = ms of the last failure (0 = none). */
export function workoutsDue({ now, at = 0, failedAt = 0 }) {
  const gap = failedAt ? WORKOUTS_RETRY_MS : WORKOUTS_EVERY_MS;
  return now.getTime() - at >= gap;
}

/** First day to ask HealthKit for: the later of (last good workout read − 1 day) and (today − 3). `shift(day, n)` adds days. */
export function workoutsSince({ lastRead, today, shift }) {
  const floor = shift(today, -WORKOUTS_LOOKBACK_DAYS);
  if (!lastRead) return floor;
  const d = shift(new Date(lastRead).toLocaleDateString('en-CA'), -1);
  return d > floor ? d : floor;
}

/** Rows from Apple Health prove an account was connected on some phone, but not on this one. Never a reason to read this phone by itself. */
export const looksConnected = ({ cardio = [], health = [] }) => health.length > 0 || cardio.some((c) => c && c.source === 'apple_health');

/** Automatic reads (open, resume, pull, quick workouts) need this account's own read stamp on this phone. */
export const mayAutoRead = (uid) => !!lastNativeRead(uid);

/** No stamp for this account on this phone, yet Apple Health rows exist (an older build wiped the stamp, or another phone sent them): ask, never read. */
export const needsReconnect = ({ last, cardio, health }) => !last && looksConnected({ cardio, health });
