// Mission celebrations, the pure part (no DOM): which tier plays, how often, what it does, and the Perfect Week rules.
// js/missions/celebrate.js plays the result. Tiers: 1 first mission, 2 middle missions, 3 the finale (the last one, whatever the count).
import { shiftDay } from './core.js';

export const PERFECT_WEEK_XP = 100;

/** Tier for `done` of `total` missions. The last mission always gets the finale, so 2 missions are tier 1 then 3. */
export function tierFor(done, total) {
  if (!(total > 0) || !(done > 0)) return 0;
  if (done >= total) return 3;
  return done === 1 ? 1 : 2;
}

/**
 * The tier to play now, or 0. Only a mission finished since the card was last shown (`hasNew`) plays, only tiers above
 * the highest already played today (`celebrated`), and only the highest one if several were skipped. Undoing never plays.
 */
export function tierToPlay({ done, total, celebrated = 0, hasNew = false }) {
  const t = tierFor(done, total);
  return hasNew && t > (celebrated || 0) ? t : 0;
}

/** The highest tier played per day (missions_cele), keeping the last two weeks. */
export function recordTier(cele, day, tier) {
  const keep = shiftDay(day, -14);
  const next = Object.fromEntries(Object.entries(cele || {}).filter(([d]) => d >= keep));
  next[day] = Math.max(tier, next[day] || 0);
  return next;
}

/** Haptic steps [{ t (ms), kind }]. Tier 3 is ten heavy impacts that speed up over 1.2 s, then a success. */
export function hapticPlan(tier) {
  if (tier === 1) return [{ t: 0, kind: 'medium' }];
  if (tier === 2) return [{ t: 0, kind: 'medium' }, { t: 80, kind: 'heavy' }];
  if (tier === 3) {
    const gaps = [0, 240, 200, 160, 130, 105, 85, 70, 60, 50]; // accelerating
    let t = 0;
    const steps = gaps.map((g) => ({ t: (t += g), kind: 'heavy' }));
    steps.push({ t: 1200, kind: 'success' });
    return steps;
  }
  if (tier === 'week') {
    // a long charge-up, a big burst at the eruption (1.6 s), then a success pattern
    const steps = [];
    let t = 0;
    let gap = 300;
    for (let k = 0; t < 1500; k++) {
      steps.push({ t: Math.round(t), kind: k % 4 === 3 ? 'heavy' : 'medium' });
      t += gap;
      gap = Math.max(50, gap * 0.82);
    }
    steps.push({ t: 1600, kind: 'heavy' }, { t: 1660, kind: 'heavy' }, { t: 1730, kind: 'heavy' });
    steps.push({ t: 2300, kind: 'medium' }, { t: 2420, kind: 'success' });
    return steps;
  }
  return [];
}

/** navigator.vibrate pattern (on, off, on, ...) for the same steps. */
export function vibratePattern(tier) {
  const ms = { light: 10, medium: 18, heavy: 30, success: 45 };
  const out = [];
  let end = 0;
  for (const s of hapticPlan(tier)) {
    const on = ms[s.kind] || 15;
    if (!out.length) out.push(on);
    else out.push(Math.max(10, s.t - end), on);
    end = s.t + on;
  }
  return out;
}

/** What a tier does, given reduced motion: no shake or particles then, but the haptics, a fade/scale and the toast stay. */
export function effectsFor(tier, reduced) {
  return {
    shake: tier === 3 && !reduced,
    particles: tier >= 2 && !reduced,
    aura: tier === 3 && !reduced,
    pop: tier >= 1 && !reduced ? [1, 1.04, 1.07, 1.1][tier] : 1,
    fade: reduced && tier >= 1,
    toast: tier === 3,
    haptics: true,
  };
}

/** The rolling seven days (weekDots) are all counted and all complete. */
export function sevenOfSeven(days) {
  return Array.isArray(days) && days.length === 7 && days.every((d) => d.counted && d.all);
}

/**
 * A Perfect Week is due: seven of seven days, and the previous one (`ends`) ended at least 7 days back, so weeks never
 * overlap and a long streak earns one a week. Days are local YYYY-MM-DD strings, so time zones and DST can't shift it.
 */
export function perfectWeekDue(days, ends, today) {
  if (!sevenOfSeven(days)) return false;
  const last = [...(ends || [])].sort().pop();
  return !last || last <= shiftDay(today, -7);
}

/** Weeks in a row: each ending exactly 7 days after the one before, counted back from the newest. */
export function weekStreak(ends) {
  const sorted = [...new Set(ends || [])].sort();
  let n = sorted.length ? 1 : 0;
  for (let i = sorted.length - 1; i > 0 && shiftDay(sorted[i - 1], 7) === sorted[i]; i--) n++;
  return n;
}
