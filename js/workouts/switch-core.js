// Train → Switch workout (v0.16.67), the pure half: build a day from muscle groups, saved workouts, your own list.
// The sheets live in js/screens/train.js. Nothing here touches the DOM or the database.
import { FOCUS_GROUPS, FOCUS_KEYS } from './focus.js';

export const MAX_MUSCLES = 4;
export const MAX_SAVED = 20;
export const MAX_ITEMS = 12;

/** Duration chips on the Up next card: minutes → label ("20m", "1h"). */
export const durationLabel = (min) => (min % 60 === 0 ? `${min / 60}h` : `${min}m`);

// Movement patterns per muscle group: a lead lift first, then accessories (the generator drops accessories first to fit the time).
const GROUP_PATTERNS = {
  chest: [['horizontal_push'], ['chest_fly', 'horizontal_push'], ['horizontal_push']],
  shoulders: [['vertical_push'], ['lateral_raise'], ['rear_delt']],
  arms: [['biceps'], ['triceps'], ['biceps', 'triceps']],
  back: [['vertical_pull', 'horizontal_pull'], ['horizontal_pull'], ['rear_delt', 'shrug']],
  abs: [['core_anti_extension', 'core_flexion'], ['core_rotation', 'core_lateral'], ['core_flexion']],
  glutes: [['hip_thrust', 'hinge'], ['lunge'], ['hip_abduction', 'hip_thrust']],
  legs: [['squat', 'lunge'], ['hinge', 'knee_flexion'], ['knee_extension', 'lunge'], ['calf']],
};

/** Valid, de-duplicated group keys in the order given, capped. */
export const cleanMuscles = (list) =>
  [...new Set(Array.isArray(list) ? list : [])].filter((k) => typeof k === 'string' && FOCUS_KEYS.includes(k)).slice(0, MAX_MUSCLES);

/** 'Chest + Arms'. */
export const musclesLabel = (list) => cleanMuscles(list).map((k) => FOCUS_GROUPS[k].label).join(' + ');

/** A day for the generator: lead lifts of every chosen group first, then accessories round-robin. */
export function muscleDay(list) {
  const keys = cleanMuscles(list);
  const leads = keys.map((k, i) => ({ patterns: GROUP_PATTERNS[k][0], role: i === 0 ? 'main' : 'secondary' }));
  const rest = [];
  for (let n = 1; n < 4; n++) for (const k of keys) if (GROUP_PATTERNS[k][n]) rest.push({ patterns: GROUP_PATTERNS[k][n], role: 'accessory' });
  return { key: 'muscles', label: musclesLabel(keys) || 'Custom', slots: [...leads, ...rest] };
}

const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** One saved/own exercise line, repaired: { exercise_id, sets 1..8, reps_lo, reps_hi }. */
export function cleanItem(it) {
  if (!it || typeof it.exercise_id !== 'string' || !it.exercise_id) return null;
  const lo = num(it.reps_lo, 1, 100, 8);
  const hi = Math.max(lo, num(it.reps_hi, 1, 100, lo));
  return { exercise_id: it.exercise_id, sets: num(it.sets, 1, 8, 3), reps_lo: lo, reps_hi: hi };
}

/** A starting line for an exercise just added to your own workout. */
export const defaultItem = (ex) => cleanItem({ exercise_id: ex.id, sets: 3, reps_lo: (ex.reps || [8, 12])[0], reps_hi: (ex.reps || [8, 12])[1] });

/** A day for the generator from a list of lines. Your own picks are kept as they are; the length chips don't trim them. */
export function itemsDay(items, label = 'My workout', key = 'saved') {
  const lines = (items || []).map(cleanItem).filter(Boolean);
  return {
    key, label, fixed: true,
    slots: lines.map((l) => ({ patterns: [], role: 'secondary', ids: [l.exercise_id], userPicked: true, sets: l.sets, reps: [l.reps_lo, l.reps_hi] })),
  };
}

/** The saved list, repaired: valid entries only, newest first, capped. */
export function cleanSaved(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
    .map((s) => ({ id: s.id, name: s.name.trim().slice(0, 40) || 'My workout', created_at: typeof s.created_at === 'string' ? s.created_at : '', items: (s.items || []).map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS) }))
    .filter((s) => s.items.length)
    .slice(0, MAX_SAVED);
}

/** Add a workout to the front of the list (same id replaces). */
export function addSaved(list, entry) {
  const e = cleanSaved([entry])[0];
  if (!e) return cleanSaved(list);
  return cleanSaved([e, ...cleanSaved(list).filter((s) => s.id !== e.id)]);
}

export const removeSaved = (list, id) => cleanSaved(list).filter((s) => s.id !== id);

/** Lines for saving whatever Train is showing now (a plan's working sets and rep range). */
export const itemsFromPlan = (plan) =>
  (plan.exercises || []).map((it) => cleanItem({ exercise_id: it.exercise_id, sets: it.target.sets, reps_lo: it.target.repLo, reps_hi: it.target.repHi })).filter(Boolean);

/**
 * What Train's "switched to" choice means: { kind:'muscles', groups } | { kind:'saved', id } | { kind:'scratch', name, items }.
 * Returns the day object for the generator, or null (a deleted saved workout falls back to the usual plan).
 */
export function resolveCustomDay(choice, saved = []) {
  if (!choice) return null;
  if (choice.kind === 'muscles') return cleanMuscles(choice.groups).length ? muscleDay(choice.groups) : null;
  if (choice.kind === 'saved') {
    const s = cleanSaved(saved).find((x) => x.id === choice.id);
    return s ? itemsDay(s.items, s.name, 'saved') : null;
  }
  if (choice.kind === 'scratch') return choice.items && choice.items.length ? itemsDay(choice.items, choice.name || 'My workout', 'scratch') : null;
  return null;
}

/** Short stable text for the edits key, so a different switch starts with fresh Replace/Rest edits. */
export const choiceKey = (c) => (!c ? '' : c.kind === 'muscles' ? `m:${cleanMuscles(c.groups).join(',')}` : c.kind === 'saved' ? `s:${c.id}` : `x:${(c.items || []).map((i) => i.exercise_id).join(',')}`);

export const savedSub = (s) => `${s.items.length} exercise${s.items.length === 1 ? '' : 's'}`;
