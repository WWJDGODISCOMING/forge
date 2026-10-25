// Past days: what each day's missions looked like, with the real values. Pure functions, no DOM, no state.
// Built only from data the app already stores (weights, body_measures, workouts, cardio, health_daily, food_logs).
import { indexDays, missionsFor, localDay, shiftDay, dayXP, allDone, MOVE_MIN } from './core.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDayKey = (s) => typeof s === 'string' && DAY_RE.test(s) && localDay(new Date(`${s}T12:00:00`)) === s;
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const dayOf = (r, t) => r.day || localDay(t);
const MAX_DAYS = 800; // the list never grows past this many rows

/** The last weigh-in on `day` (kg) and the last body-fat reading (%), or nulls. */
function weighIn(day, { weights = [], bodyMeasures = [] }) {
  let kg = null; let kgAt = '';
  let fat = null; let fatAt = '';
  for (const w of weights) {
    if (!w || w.deleted || w.review || num(w.kg) == null || dayOf(w, w.measured_at) !== day) continue;
    const at = w.measured_at || '';
    if (kg == null || at >= kgAt) { kg = w.kg; kgAt = at; }
  }
  for (const b of bodyMeasures) {
    if (!b || b.deleted || b.needs_review || dayOf(b, b.measured_at) !== day) continue;
    const m = b.metrics || {};
    const at = b.measured_at || '';
    if (num(m.fat_ratio_pct) != null && (fat == null || at >= fatAt)) { fat = m.fat_ratio_pct; fatAt = at; }
    if (num(m.weight_kg) != null && kg == null) { kg = m.weight_kg; kgAt = at; }
  }
  return { kg, fatPct: fat };
}

/** What was eaten on `day`: { kcal, proteinG, logged }. */
function eaten(day, foodLogs) {
  let kcal = 0; let protein = 0; let logged = 0;
  for (const f of foodLogs || []) {
    if (!f || f.deleted || dayOf(f, f.logged_at || f.at) !== day) continue;
    const s = num(f.servings) ?? 1;
    logged++;
    kcal += (num(f.kcal) || 0) * s;
    protein += (num(f.protein_g) || 0) * s;
  }
  return { kcal: Math.round(kcal), proteinG: Math.round(protein), logged };
}

/** Workouts (done) and cardio sessions that started on `day`, oldest first. */
function trainedOn(day, { workouts = [], cardio = [] }) {
  const out = [];
  for (const w of workouts) {
    if (!w || w.deleted || w.status !== 'done' || localDay(w.started_at) !== day) continue;
    const min = num(w.duration_ms) != null ? Math.round(w.duration_ms / 60000) : null;
    out.push({ kind: 'workout', name: w.label || 'Workout', minutes: min, at: w.started_at });
  }
  for (const c of cardio) {
    if (!c || c.deleted || localDay(c.started_at) !== day) continue;
    out.push({ kind: 'cardio', name: c.label || c.type || c.kind || 'Cardio', minutes: num(c.duration_min), at: c.started_at, counts: num(c.duration_min) >= MOVE_MIN });
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * One day in full.
 *   data     { weights, bodyMeasures, workouts, cardio, healthDaily, foodLogs }
 *   opts     { targets: { steps, bed, proteinG, calories }, today }
 * Returns { day, isToday, isFuture, missions (missionsFor, judged like the live card), done, total, xp, all,
 *           weighIn, steps (null = no Apple Health row), calories: { kcal, ceiling, logged }, protein, training, empty }
 */
export function dayDetail(day, data, { targets = {}, today = localDay(Date.now()) } = {}) {
  const foodLogs = data.foodLogs && data.foodLogs.length ? data.foodLogs : null;
  const idx = indexDays({ ...data, foodLogs });
  const missions = missionsFor(day, idx, { targets, restDay: false });
  const row = idx.health.get(day);
  const food = eaten(day, data.foodLogs);
  const training = trainedOn(day, data);
  const w = weighIn(day, data);
  const steps = row && num(row.steps) != null ? row.steps : null;
  const ceiling = num(targets.calories) > 0 ? Math.round(targets.calories) : null;
  const empty = w.kg == null && w.fatPct == null && steps == null && !food.logged && !training.length;
  return {
    day, isToday: day === today, isFuture: day > today,
    missions, done: missions.filter((m) => m.done).length, total: missions.length, xp: dayXP(missions), all: allDone(missions),
    weighIn: w, steps, stepGoal: targets.steps || null,
    calories: { kcal: food.kcal, ceiling, logged: food.logged },
    protein: { g: food.proteinG, target: num(targets.proteinG) > 0 ? Math.round(targets.proteinG) : null, logged: food.logged },
    training, empty,
  };
}

/** Earliest day with any stored data or the day missions started, whichever is earlier. null when there is nothing. */
export function firstDay(data, startedDay = null) {
  let first = startedDay && isDayKey(startedDay) ? startedDay : null;
  const see = (d) => { if (d && (!first || d < first)) first = d; };
  for (const w of data.weights || []) if (w && !w.deleted) see(dayOf(w, w.measured_at));
  for (const b of data.bodyMeasures || []) if (b && !b.deleted) see(dayOf(b, b.measured_at));
  for (const w of data.workouts || []) if (w && !w.deleted && w.status === 'done') see(localDay(w.started_at));
  for (const c of data.cardio || []) if (c && !c.deleted) see(localDay(c.started_at));
  for (const r of data.healthDaily || []) if (r && !r.deleted && DAY_RE.test(r.id || r.day || '')) see(r.id || r.day);
  for (const f of data.foodLogs || []) if (f && !f.deleted) see(dayOf(f, f.logged_at || f.at));
  return first;
}

/** Newest first: today back to the first day with anything (at most MAX_DAYS). Each: { day, done, total, all, empty }. */
export function pastDays(data, { targets = {}, today = localDay(Date.now()), startedDay = null } = {}) {
  const first = firstDay(data, startedDay);
  if (!first) return [];
  const out = [];
  for (let d = today, n = 0; d >= first && n < MAX_DAYS; d = shiftDay(d, -1), n++) {
    const x = dayDetail(d, data, { targets, today });
    out.push({ day: d, done: x.done, total: x.total, all: x.all, empty: x.empty });
  }
  return out;
}

/** The day before/after, or null at the ends (no days after today, none before the first day). */
export function neighbours(day, { first, today }) {
  const prev = first && shiftDay(day, -1) >= first ? shiftDay(day, -1) : null;
  const next = day < today ? shiftDay(day, 1) : null;
  return { prev, next };
}
