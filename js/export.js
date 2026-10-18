// Export your data (JSON for everything, CSV per collection). Works offline from the on-device cache.
import { COLLECTIONS, NEWER_COLLECTIONS, READ_ONLY_COLLECTIONS, readAll } from './db.js';
import { todayKey } from './ui.js';
import { VERSION } from './version.js';
import { exerciseById } from './workouts/library.js';
import { toCSV } from './csv.js';
import { BODY_COLUMNS, bodyRows } from './export-body.js';
import { deliver } from './deliver-file.js';
import { cardioCsvRows, CARDIO_CSV_COLUMNS } from './cardio-types.js';

export async function exportJSON() {
  const out = { app: 'forge', version: VERSION, exported_at: new Date().toISOString(), data: {} };
  for (const col of COLLECTIONS) out.data[col] = await readAll(col).catch((e) => { if (NEWER_COLLECTIONS.includes(col)) return []; throw e; });
  // Server-written (Withings body measurements, Apple Health days, connection status; never tokens).
  for (const col of READ_ONLY_COLLECTIONS) out.data[col] = await readAll(col).catch(() => []);
  await deliver(`forge-export-${todayKey()}.json`, JSON.stringify(out, null, 2), 'application/json');
}

export async function exportWeightsCSV() {
  const rows = (await readAll('weights'))
    .filter((r) => !r.deleted)
    .sort((a, b) => (a.measured_at < b.measured_at ? -1 : 1))
    .map((r) => ({ ...r, lb: (r.kg / 0.45359237).toFixed(2), kg: r.kg.toFixed(3) }));
  const csv = toCSV(rows, ['day', 'measured_at', 'kg', 'lb', 'source', 'id']);
  await deliver(`forge-weights-${todayKey()}.csv`, csv, 'text/csv');
}

export async function exportWorkoutsCSV() {
  const workouts = (await readAll('workouts')).filter((w) => !w.deleted && w.status === 'done')
    .sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  const rows = [];
  for (const w of workouts) {
    for (const it of w.exercises || []) {
      const ex = exerciseById(it.exercise_id);
      let n = 0;
      for (const s of it.sets || []) {
        if (!s.done) continue;
        rows.push({
          date: w.started_at.slice(0, 10), started_at: w.started_at, workout: w.label, location_id: w.location_id,
          exercise: ex ? ex.name : it.exercise_id, exercise_id: it.exercise_id, set: s.warmup ? 'W' : ++n,
          weight_kg: s.weight_kg == null ? '' : s.weight_kg.toFixed(3),
          weight_lb: s.weight_kg == null ? '' : (s.weight_kg / 0.45359237).toFixed(1),
          reps_or_seconds: s.reps, rir: s.rir ?? '', workout_id: w.id,
        });
      }
    }
  }
  const csv = toCSV(rows, ['date', 'started_at', 'workout', 'exercise', 'set', 'weight_lb', 'weight_kg', 'reps_or_seconds', 'rir', 'exercise_id', 'location_id', 'workout_id']);
  await deliver(`forge-workouts-${todayKey()}.csv`, csv, 'text/csv');
}

export async function exportCardioCSV() {
  const csv = toCSV(cardioCsvRows(await readAll('cardio_sessions')), CARDIO_CSV_COLUMNS);
  await deliver(`forge-cardio-${todayKey()}.csv`, csv, 'text/csv');
}

export async function exportFoodCSV() {
  const rows = (await readAll('food_logs').catch(() => [])).filter((r) => !r.deleted)
    .sort((a, b) => (a.day + a.created_at < b.day + b.created_at ? -1 : 1))
    .map((r) => ({ ...r, total_kcal: Math.round(r.kcal * r.servings), total_protein_g: Math.round(r.protein_g * r.servings * 10) / 10 }));
  const csv = toCSV(rows, ['day', 'meal', 'name', 'servings', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'total_kcal', 'total_protein_g', 'food_id', 'source', 'id']);
  await deliver(`forge-food-${todayKey()}.csv`, csv, 'text/csv');
}

export async function exportBodyCSV() {
  const rows = bodyRows(await readAll('body_measures').catch(() => []));
  const csv = toCSV(rows, ['day', 'measured_at', ...BODY_COLUMNS, 'needs_review', 'model', 'source', 'grpid', 'id']);
  await deliver(`forge-body-${todayKey()}.csv`, csv, 'text/csv');
}
