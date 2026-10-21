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

/**
 * → 'steady' | 'morning' | null.
 * { now: Date, last: ms of the last read, today, rows, failedAt, morningAt: ms of the last morning try, morningFailedAt }
 */
export function autoReadMode({ now, last, today, rows, failedAt = 0, morningAt = 0, morningFailedAt = 0 }) {
  const t = now.getTime();
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
