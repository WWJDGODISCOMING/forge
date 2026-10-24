// Pure workout-session logic shared by the guided player and the list view:
// the order sets are done in (supersets alternate), what to rest after a set, and set validation.

import { detectPRs, toUnit } from './progression.js';
import { restFromPref } from './restprefs.js';

export const REST = { main: 150, secondary: 120, accessory: 75, warmup: 45, timed: 60 };

/** Default rest choices in Settings (seconds), and what new installs get. */
export const REST_DEFAULT_CHOICES = [30, 45, 60, 90, 120, 180];
export const REST_DEFAULT_SEC = 60;

export const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Settings row title, e.g. "Rest between sets · 1:00". */
export const restDefaultTitle = (settings) => `Rest between sets · ${fmtClock(restDefaultSec(settings))}`;

/** The saved default rest (settings/main.rest_default_sec), or 1:00 when missing or not one of the choices. */
export function restDefaultSec(settings) {
  const v = settings && settings.rest_default_sec;
  return REST_DEFAULT_CHOICES.includes(v) ? v : REST_DEFAULT_SEC;
}

const working = (sets) => sets.map((s, j) => [s, j]).filter(([s]) => !s.warmup);
const warm = (sets) => sets.map((s, j) => [s, j]).filter(([s]) => s.warmup);

/**
 * The order of every set in the workout, as [{ i, j }] (exercise index, set index).
 * - Normal exercise: its warm-ups, then its working sets.
 * - Superset (consecutive exercises sharing a letter): all members' warm-ups first, then rounds that
 *   alternate members: A1 set 1 → B1 set 1 → (rest) → A1 set 2 → B1 set 2 …
 */
export function buildQueue(exercises) {
  const q = [];
  let i = 0;
  while (i < exercises.length) {
    const g = exercises[i].superset;
    if (!g) {
      exercises[i].sets.forEach((_, j) => q.push({ i, j }));
      i++;
      continue;
    }
    const members = [];
    while (i < exercises.length && exercises[i].superset === g) members.push(i++);
    for (const m of members) for (const [, j] of warm(exercises[m].sets)) q.push({ i: m, j });
    const rounds = Math.max(...members.map((m) => working(exercises[m].sets).length));
    for (let r = 0; r < rounds; r++) {
      for (const m of members) {
        const w = working(exercises[m].sets)[r];
        if (w) q.push({ i: m, j: w[1] });
      }
    }
  }
  return q;
}

/** First step at or after `from` whose set isn't done, or -1 when everything is done. */
export function nextOpenStep(queue, exercises, from = 0) {
  for (let k = Math.max(0, from); k < queue.length; k++) {
    const { i, j } = queue[k];
    if (!exercises[i].sets[j].done) return k;
  }
  for (let k = 0; k < Math.min(from, queue.length); k++) {
    const { i, j } = queue[k];
    if (!exercises[i].sets[j].done) return k;
  }
  return -1;
}

/** "Set 2 of 4", warm-ups counted separately. */
export function setLabel(exercise, j) {
  const s = exercise.sets[j];
  if (s.warmup) {
    const w = warm(exercise.sets);
    return { warmup: true, n: w.findIndex(([, k]) => k === j) + 1, of: w.length };
  }
  const w = working(exercise.sets);
  return { warmup: false, n: w.findIndex(([, k]) => k === j) + 1, of: w.length };
}

/** Superset tag like "A1" / "A2" (letter + position in the group), or null. */
export function supersetTag(exercises, i) {
  const g = exercises[i].superset;
  if (!g) return null;
  let pos = 0;
  for (let k = 0; k <= i; k++) if (exercises[k].superset === g) pos++;
  return `${g}${pos}`;
}

/**
 * Rest after completing step k (null = go straight to the next set, e.g. mid-superset).
 * ex: library entry for the exercise just done.
 */
export function restAfter(queue, exercises, k, ex, { deload = false, defaultSec = null, pref = null } = {}) {
  const { i, j } = queue[k];
  const it = exercises[i];
  const s = it.sets[j];
  const next = queue[k + 1];
  if (it.superset && next && !s.warmup && next.i !== i && exercises[next.i].superset === it.superset) {
    // Same round of a superset (A1 set 2 → B1 set 2): go straight to the next member, no rest.
    const round = setLabel(it, j).n;
    const nextSet = exercises[next.i].sets[next.j];
    if (!nextSet.warmup && setLabel(exercises[next.i], next.j).n === round) return null;
  }
  // The exercise's own rest timer setting (the player's Rest timer chip) beats everything below.
  const own = restFromPref(pref, !!s.warmup);
  if (own && own.off) return null;
  if (own) return { sec: own.sec, label: s.warmup ? 'Warm-up rest' : it.superset ? 'Rest (superset)' : 'Rest' };
  const custom = REST_DEFAULT_CHOICES.includes(defaultSec) ? defaultSec : null;
  if (s.warmup) return { sec: custom ? Math.min(REST.warmup, custom) : Math.round(REST.warmup * (deload ? 0.8 : 1)), label: 'Warm-up rest' };
  if (it.rest_sec) return { sec: it.rest_sec, label: it.superset ? 'Rest (superset)' : 'Rest' }; // set in the preview's ⋯ menu
  return { sec: autoRest(it, ex, { deload, defaultSec: custom }), label: it.superset ? 'Rest (superset)' : 'Rest' };
}

/**
 * The rest an exercise gets when it has no rest of its own: the Settings default if there is one
 * (never cut down for a deload week, you picked it), otherwise by exercise type (× 0.8 in a deload week).
 * The app always passes restDefaultSec(), so the by-type branch is only reached in tests.
 */
export function autoRest(it, ex, { deload = false, defaultSec = null } = {}) {
  if (REST_DEFAULT_CHOICES.includes(defaultSec)) return defaultSec;
  const sec = ex && ex.timed ? REST.timed : it.superset ? REST.accessory : REST[it.role] || 90;
  return deload ? Math.round(sec * 0.8) : sec;
}

/** True when every working set of exercise i is done (used for the "last set" escalation). */
export function exerciseComplete(exercise) {
  return working(exercise.sets).every(([s]) => s.done);
}

/** Checks a set before it's completed. Returns an error message or null. */
export function validateSet(ex, s, { reps, weightKg }) {
  if (!reps || reps < 1) return ex && ex.timed ? 'Enter the seconds first.' : 'Enter your reps first.';
  const loaded = ex && !['bodyweight', 'band', 'other', 'backpack'].includes(ex.load) && !ex.timed;
  if (loaded && weightKg == null && !s.warmup) return 'Enter the weight first.';
  return null;
}

/** Working-set counts and stats for the summary. */
export function sessionStats(exercises, toDisplay) {
  let sets = 0;
  let volume = 0;
  for (const it of exercises) {
    for (const s of it.sets) {
      if (!s.done || s.warmup) continue;
      sets++;
      if (s.weight_kg && s.reps) volume += toDisplay(s.weight_kg) * s.reps;
    }
  }
  return { sets, volume: Math.round(volume) };
}

/**
 * "vs last time" for one exercise: compares this session's sets with the previous session's (same unit).
 * Loaded lifts: top weight change, else reps at the top weight. Bodyweight/timed: best reps/seconds.
 * Returns { text, tone: 'up'|'down'|'same' } or null when there's no previous session.
 */
export function versusLast(ex, now, prev, unit = 'lb') {
  if (!prev || !prev.length || !now.length) return null;
  const tone = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'same');
  if (ex.timed || ['bodyweight', 'band', 'other', 'backpack'].includes(ex.load)) {
    const d = Math.max(...now.map((s) => s.reps || 0)) - Math.max(...prev.map((s) => s.reps || 0));
    return { text: d === 0 ? 'Same as last time' : `${d > 0 ? '+' : ''}${d}${ex.timed ? 's' : ' reps'}`, tone: tone(d) };
  }
  const top = (sets) => sets.reduce((m, s) => Math.max(m, s.weight || 0), 0);
  const tn = top(now);
  const tp = top(prev);
  if (Math.abs(tn - tp) > 0.05) {
    const d = Math.round((tn - tp) * 10) / 10;
    return { text: `${d > 0 ? '+' : ''}${d} ${unit}`, tone: tone(d) };
  }
  const repsAt = (sets, w) => Math.max(0, ...sets.filter((s) => Math.abs((s.weight || 0) - w) < 0.05).map((s) => s.reps || 0));
  const d = repsAt(now, tn) - repsAt(prev, tp);
  return { text: d === 0 ? 'Same as last time' : `${d > 0 ? '+' : ''}${d} rep${Math.abs(d) === 1 ? '' : 's'}`, tone: tone(d) };
}

/**
 * Records for one exercise in this session, from its done working sets vs earlier history.
 * Used when a set is completed and again when one is undone, so an undone set can't leave a PR behind.
 */
export function exercisePRs(ex, item, history, u) {
  if (!ex || !ex.id) return [];
  const sets = item.sets
    .filter((x) => x.done && !x.warmup)
    .map((x) => ({ weight: x.weight_kg == null ? null : Math.round(toUnit(x.weight_kg, u) * 10) / 10, reps: x.reps }));
  return detectPRs(ex, sets, history).map((p) => {
    const withUnit = p.type === 'e1rm' || p.type === 'weight' || p.type === 'volume' ? ` ${u}` : '';
    const rec = { exercise_id: ex.id, type: p.type, value: p.value, prev: p.prev ?? null, unit: withUnit.trim() || null, label: `${ex.name}: ${p.label}${withUnit}` };
    if (p.weight != null) rec.weight = p.weight;
    return rec;
  });
}

/** Replace one exercise's records in the workout's list with a recomputed set. */
export const replacePRs = (prs, exerciseId, recs) => [...(prs || []).filter((q) => q.exercise_id !== exerciseId), ...recs];

/** How the voice coach says a rest: "Rest 2 minutes 30", "Rest 1 minute", "Rest 45 seconds". */
export function restPhrase(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `Rest ${s} seconds`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `Rest ${m} ${m === 1 ? 'minute' : 'minutes'}${r ? ` ${r}` : ''}`;
}
