// Synthetic account for the layout test. Nothing here is real health data.
import { HOME_PRESET, TRAVEL_PRESET } from '../../js/workouts/equipment.js';
import { TOUR_OFFER } from '../../js/tour/steps.js';

const DAY = 86400000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

/** @param {{long?: boolean, empty?: boolean}} opt  long: long names + 4-digit calories; empty: a brand-new account */
export function seed({ long = false, empty = false, active = false, over = false, now = Date.now() } = {}) {
  const rec = (id, extra = {}) => ({ id, user_id: 'u1', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), source: 'manual', deleted: false, ...extra });
  const profile = rec('main', {
    goal: 'lose_fat', sex: 'male', age: 37, heightCm: 180, weightKg: 88, targetWeightKg: 80, activity: 'light',
    trainingDays: 4, sessionMin: 45, experience: 'intermediate', injuries: [], pacePct: 0.5, allowFastPace: false,
    tour: 'seen', tour_seen_at: new Date(now).toISOString(), tour_offer: TOUR_OFFER,
  });
  const settings = rec('main', { units: 'imperial', player: 'guided', haptics: true });
  const locations = [
    rec('l1', { name: long ? 'Downtown Athletic Club & Pool' : 'Home gym', preset: 'home', equipment: [...HOME_PRESET], weight_inventory: {}, is_default: true }),
    rec('l2', { name: long ? 'Hotel fitness room (3rd floor)' : 'Travel', preset: 'travel', equipment: [...TRAVEL_PRESET], weight_inventory: {}, is_default: false }),
  ];
  const out = {
    profile: [profile], settings: [settings], locations: empty ? [] : locations,
    weights: [], workouts: [], cardio_sessions: [], programs: [], exercises: [], body_measures: [], health_daily: [], integrations: [], foods: [], food_logs: [],
  };
  if (empty) { out.locations = []; return out; }
  out.programs.push(rec('p1', { template: 'smart', name: 'Smart', started_at: new Date(now - 9 * DAY).toISOString(), active: true, custom_days: [], deload_started_at: null }));
  for (let i = 40; i >= 0; i -= 2) {
    const t = now - i * DAY;
    out.weights.push(rec(`w${i}`, { kg: 88 - (40 - i) * 0.04, day: dayKey(t), measured_at: new Date(t).toISOString() }));
  }
  const set = (reps, kg) => ({ warmup: false, done: true, reps, weight_kg: kg, plan_reps: reps, plan_weight_kg: kg });
  [2, 5, 9, 12, 16, 19].forEach((ago, k) => {
    const t = now - ago * DAY;
    out.workouts.push(rec(`k${k}`, {
      status: 'done', started_at: new Date(t).toISOString(), finished_at: new Date(t + 2700000).toISOString(), duration_ms: 2700000, location_id: 'l1', day_type: 'upper', prs: [],
      exercises: [
        { exercise_id: 'db_bench_press', role: 'main', superset: null, sets: [set(8, 22), set(8, 22), set(7, 22)] },
        { exercise_id: 'pushup', role: 'accessory', superset: null, sets: [set(12, 0), set(12, 0)] },
      ],
    }));
  });
  [1, 8, 30, 120].forEach((ago, k) => {
    const t = now - ago * DAY;
    // The newest readings carry everything; the older rows only weight + heart rate, so some tiles are "stale".
    const full = k < 2;
    out.body_measures.push(rec(`b${k}`, {
      measured_at: new Date(t).toISOString(), day: dayKey(t), weight_kg: 87.5 - k * 0.2,
      ...(full ? { fat_ratio_pct: 24.1 - k * 0.3, fat_mass_kg: 21, fat_free_mass_kg: 66, muscle_mass_kg: 62, hydration_kg: 48, bone_mass_kg: 3.3 } : {}),
      heart_pulse_bpm: 74 - k,
    }));
  });
  for (let i = 14; i >= 0; i--) {
    out.health_daily.push(rec(dayKey(now - i * DAY), { day: dayKey(now - i * DAY), steps: 7000 + i * 120, hrv_ms: 52 - (i % 5), resting_hr: 58 + (i % 3), sleep_min: 420 + (i % 4) * 8, active_kcal: 480 }));
  }
  if (active) {
    const plan = (reps, kg) => ({ warmup: false, plan_weight_kg: kg, plan_reps: reps, weight_kg: null, reps: null, rir: null, done: false, completed_at: null });
    out.workouts.push(rec('act1', {
      status: 'active', started_at: new Date(now - 600000).toISOString(), finished_at: null, label: 'Upper body', day_type: 'upper', location_id: 'l1', template: 'smart', notes: [], prs: [], deload: false,
      exercises: [
        { exercise_id: 'db_bench_press', role: 'main', superset: null, note: '', warning: null, next_step_id: null, target: { sets: 3, rep_lo: 8, rep_hi: 10, reps: 8, weight_kg: 22, rir: 2, mode: 'hold' }, sets: [plan(8, 22), plan(8, 22), plan(8, 22)] },
        { exercise_id: 'pushup', role: 'accessory', superset: null, note: '', warning: null, next_step_id: null, target: { sets: 2, rep_lo: 10, rep_hi: 12, reps: 10, weight_kg: null, rir: 2, mode: 'hold' }, sets: [plan(10, null), plan(10, null)] },
      ],
    }));
  }
  const t0 = new Date(now); t0.setHours(12, 0, 0, 0);
  const kcal = over ? 3100 : long ? 3880 : 1490; // over: past every target (3,100 of ~2,060 kcal, carbs and fat well over)
  out.foods.push(rec('f1', { name: 'Oatmeal', serving_g: 40, kcal: 150, protein_g: 5, carbs_g: 27, fat_g: 3 }));
  out.food_logs.push(rec('fl1', { day: dayKey(now), meal: 'lunch', name: 'Test meal', kcal, protein_g: over ? 200 : 110, carbs_g: over ? 270 : 150, fat_g: over ? 120 : 40, logged_at: t0.toISOString(), servings: 1 }));
  return out;
}
