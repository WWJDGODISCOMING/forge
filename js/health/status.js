// What Apple Health data has arrived: the last day, and for each kind of data when it was last seen and how
// many of the last 28 days have it. Drives Settings → Apple Health ("Data check" for the Watch side).
import { shiftDay, indexDays } from './metrics.js';

export const FIELDS = [
  ['hrv', 'HRV', (r) => r.hrv_sdnn_ms != null],
  ['rhr', 'Resting heart rate', (r) => r.rhr_bpm != null],
  ['sleep', 'Sleep', (r) => r.sleep && r.sleep.asleep_min != null],
  ['temp', 'Wrist temperature', (r) => r.wrist_temp_delta_c != null || r.wrist_temp_c != null],
  ['resp', 'Breathing rate', (r) => r.resp_rate != null],
  ['spo2', 'Blood oxygen', (r) => r.spo2_avg_pct != null],
  ['steps', 'Steps', (r) => r.steps != null],
  ['active', 'Active energy', (r) => r.active_kcal != null],
  ['exercise', 'Exercise minutes', (r) => r.exercise_min != null],
  ['vo2', 'Cardio fitness', (r) => r.vo2max != null],
  ['walkhr', 'Walking heart rate', (r) => r.walking_hr_avg != null],
  ['workouts', 'Workouts', (r) => Array.isArray(r.workouts) && r.workouts.length > 0],
];

/** rows: health_daily docs. → { lastDay, days, fields: [{ key, label, lastDay, count28 }] } */
export function fieldStatus(rows, today, cardio = []) {
  const days = indexDays(rows);
  const from = shiftDay(today, -27);
  const fields = FIELDS.map(([key, label, has]) => {
    let lastDay = null;
    let count28 = 0;
    for (const [d, r] of days) {
      if (!has(r)) continue;
      if (!lastDay || d > lastDay) lastDay = d;
      if (d >= from && d <= today) count28++;
    }
    return { key, label, lastDay, count28 };
  });
  // Workouts: Apple Watch sessions imported as cardio count too (health_daily.workouts from the Shortcut still does).
  const w = fields.find((f) => f.key === 'workouts');
  const wdays = new Set(cardio.filter((c) => !c.deleted && c.source === 'apple_health').map((c) => c.day).filter(Boolean));
  for (const d of wdays) {
    if (!w.lastDay || d > w.lastDay) w.lastDay = d;
    if (d >= from && d <= today && !(days.get(d) && FIELDS[11][2](days.get(d)))) w.count28++;
  }
  const keys = [...days.keys()].sort();
  return { lastDay: keys.length ? keys[keys.length - 1] : null, days: keys.length, fields };
}

