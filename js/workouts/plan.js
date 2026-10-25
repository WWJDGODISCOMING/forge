// Glue between stored data and the generator: active location/program, today's plan, starting a workout.
import { state, units } from '../state.js';
import { put, patch, newRecord } from '../db.js';
import { generateWorkout, deloadInfo } from './generator.js';
import { PROGRAMS } from './programs.js';
import { fatigueAt, recoveryPct } from './recovery.js';
import { buildIndex } from './history.js';
import { fromUnit, isStalled, topWeight } from './progression.js';
import { allExercises, exerciseById } from './library.js';
import { readinessForGenerator } from '../health/today.js';

export const unit = () => (units() === 'metric' ? 'kg' : 'lb');

export function activeLocation() {
  const locs = state.locations;
  if (!locs.length) return null;
  const last = state.settings && state.settings.last_location_id;
  return locs.find((l) => l.id === last) || locs.find((l) => l.is_default) || locs[0];
}

export function setActiveLocation(id) {
  patch('settings', 'main', { last_location_id: id });
}

export function activeProgram() {
  return state.programs.find((p) => p.active) || null;
}

export function startProgram(template, extra = {}) {
  for (const p of state.programs) if (p.active) patch('programs', p.id, { active: false });
  return put('programs', newRecord({
    template,
    name: PROGRAMS[template]?.name || 'Program',
    started_at: new Date().toISOString(),
    active: true,
    custom_days: [],
    deload_started_at: null,
    ...extra,
  }));
}

export function activeWorkout() {
  return state.workouts.find((w) => w.status === 'active') || null;
}

let idx = null;
/** Recomputed only when the workouts list or the unit changes (each Firestore snapshot is a new array). */
export function historyIndex() {
  if (idx && idx.src === state.workouts && idx.unit === unit()) return idx;
  idx = buildIndex(state.workouts, unit());
  idx.src = state.workouts;
  idx.unit = unit();
  return idx;
}

export function currentRecovery(now = Date.now()) {
  const recent = state.workouts.filter((w) => !w.deleted && (w.status === 'done' || w.status === 'active'));
  return recoveryPct(fatigueAt(recent, exerciseById, now));
}

/** Plan for today (not saved). dayType overrides the program's choice. */
export function planToday({ dayType, locationId, forced, avoidIds, sessionMin, restSec, customDay } = {}) {
  const location = locationId ? state.locations.find((l) => l.id === locationId) : activeLocation();
  const program = activeProgram();
  if (!location || !state.profile) return null;
  const templ = program ? program.template : 'smart';
  const h = historyIndex();
  const inProgram = h.done.filter((w) => !program || w.program_id === program.id);
  return {
    location,
    program,
    ...generateWorkout({
      programKey: templ,
      program,
      dayType,
      location,
      profile: state.profile,
      unit: unit(),
      exercises: allExercises(),
      historyFor: h.historyFor,
      daysSince: (id) => h.daysSince(id),
      recovery: currentRecovery(),
      doneCount: inProgram.length,
      lastDayType: h.done[0] ? h.done[0].day_type : null,
      settings: state.settings || {},
      forced: forced || {},
      avoidIds: avoidIds || [],
      sessionMin: sessionMin || null,
      restSec: restSec || {},
      customDay: customDay || null,
      readiness: readinessForGenerator(),
    }),
  };
}

/** Turns a plan into a stored workout (sets pre-filled with targets) and returns it. */
export function startWorkout(plan) {
  const u = unit();
  const kg = (x) => (x == null ? null : fromUnit(x, u));
  const exercises = plan.exercises.map((it) => ({
    exercise_id: it.exercise_id,
    role: it.role,
    superset: it.superset,
    ...(it.rest_sec ? { rest_sec: it.rest_sec } : {}),
    note: it.target.note || '',
    warning: it.warning || null,
    next_step_id: it.target.nextStepId || null,
    target: { sets: it.target.sets, rep_lo: it.target.repLo, rep_hi: it.target.repHi, reps: it.target.reps, weight_kg: kg(it.target.weight), rir: it.target.rir, mode: it.target.mode },
    sets: [
      ...it.warmups.map((w) => ({ warmup: true, plan_weight_kg: kg(w.weight), plan_reps: w.reps, weight_kg: null, reps: null, rir: null, done: false, completed_at: null })),
      ...Array.from({ length: it.target.sets }, () => ({ warmup: false, plan_weight_kg: kg(it.target.weight), plan_reps: it.target.reps, weight_kg: null, reps: null, rir: null, done: false, completed_at: null })),
    ],
  }));
  return put('workouts', newRecord({
    location_id: plan.location.id,
    program_id: plan.program ? plan.program.id : null,
    template: plan.program ? plan.program.template : 'smart',
    day_type: plan.dayType,
    label: plan.label,
    deload: !!plan.deload || !!plan.readinessDeload, // a Readiness-red light day is kept out of progression like a deload
    notes: plan.notes || [],
    status: 'active',
    started_at: new Date().toISOString(),
    finished_at: null,
    exercises,
    prs: [],
  }));
}

/** Main lifts that stalled in recent sessions (drives the "take a deload?" prompt). */
export function stalledMainLifts() {
  const h = historyIndex();
  const program = activeProgram();
  if (!program || deloadInfo(program, state.profile.experience).deload) return [];
  const mains = new Set();
  for (const w of h.done.slice(0, 6)) for (const ex of w.exercises || []) if (ex.role === 'main') mains.add(ex.exercise_id);
  return [...mains].filter((id) => {
    const hist = h.historyFor(id);
    return hist.length >= 3 && isStalled(hist, topWeight(hist[0].sets));
  });
}

export function startDeload() {
  const p = activeProgram();
  if (p) patch('programs', p.id, { deload_started_at: new Date().toISOString() });
}
