// Body programs from live state. Everything is derived from weights, workouts, cardio and health_daily; the only
// stored state is in settings/main:
//   body_program          { id, started: 'YYYY-MM-DD' } for the running program, or null (one at a time)
//   body_program_history  [{ id, started, ended, weeksHit, early? }] for programs that are over
//   awards_seen           the program badges, once their completion card has been seen (as for mission badges)
import { state, units as getUnits } from '../state.js';
import { patch } from '../db.js';
import { weightSeries, currentWeightKg, currentTargets } from '../derived.js';
import { indexDays, localDay } from '../missions/core.js';
import { newMissionBadges } from '../missions/badges.js';
import { missionSettings, startedDay, ensureStarted } from '../missions/store.js';
import {
  PROGRAMS, canStart, checkStart, programStatus, paceBand, finishedEntry, endedEntry, programBadges, programXP, progressDays, summaryFor, entryCompleted,
} from './core.js';

const today = () => localDay(Date.now());
const settings = () => state.settings || {};

export const activeProgram = () => {
  const p = settings().body_program;
  return p && PROGRAMS[p.id] && /^\d{4}-\d{2}-\d{2}$/.test(p.started || '') ? p : null;
};
export const programHistory = () => (Array.isArray(settings().body_program_history) ? settings().body_program_history : []);

/** Everything weekGoals needs, from live state. */
export function programData() {
  const profile = state.profile || {};
  const kg = currentWeightKg() || profile.weightKg || 0;
  return {
    idx: indexDays({ weights: state.weights, bodyMeasures: state.body_measures, workouts: state.workouts, cardio: state.cardio, healthDaily: state.health_daily }),
    series: weightSeries(),
    progress: progressDays(state.workouts || []),
    trainingDays: profile.trainingDays || 3,
    steps: missionSettings().steps,
    band: paceBand(currentTargets(), kg, { allowFastPace: !!profile.allowFastPace }),
    units: getUnits(),
  };
}

/** The running program's status, or null. */
export function currentStatus(data = programData()) {
  const p = activeProgram();
  return p ? programStatus(p, today(), data) : null;
}

/** The cut can't start when the safety checks say no deficit (under 18, underweight): { message } or null. */
export function cutBlocked() {
  const t = currentTargets();
  const stop = t && t.flags.find((f) => f.level === 'stop');
  return stop ? { message: stop.message } : null;
}

/** Start a program. One at a time: refused while another runs. Returns true when saved. */
export function startProgram(id) {
  if (!state.settings || !canStart(state.settings, id)) return false;
  if (id === 'cut4' && cutBlocked()) return false;
  ensureStarted(); // XP counts from the day missions started; a no-op once saved
  patch('settings', 'main', { body_program: { id, started: today() } });
  return true;
}

function finish(entry) {
  patch('settings', 'main', { body_program: null, body_program_history: [...programHistory(), entry] });
}

/** End the running program now. It goes to history as ended early: no finish bonus, no badge. */
export function endProgram() {
  const p = activeProgram();
  if (!p) return false;
  finish(endedEntry(p, today(), programData()));
  return true;
}

/**
 * Move the running program's start to `day` (today or earlier). Only `started` changes: the weeks and goals are worked
 * out from it and from the data already logged, so nothing is deleted or rewritten. Returns { ok, previous, reason }.
 */
export function changeStartDate(day) {
  const p = activeProgram();
  if (!p) return { ok: false, previous: null, reason: 'No program is running.' };
  const c = checkStart(day, today());
  if (!c.ok) return { ok: false, previous: p.started, reason: c.reason };
  patch('settings', 'main', { body_program: { ...p, started: day } });
  return { ok: true, previous: p.started, reason: '' };
}

let settling = null;
/**
 * After the last week, make the program history (once). Call only when everything has loaded, or the weeks
 * would be judged on partial data.
 */
export function settleProgram() {
  const p = activeProgram();
  if (!p || !state.settings) return false;
  const key = `${p.id}@${p.started}`;
  if (settling === key) return false;
  const data = programData();
  if (!programStatus(p, today(), data).finished) return false;
  settling = key;
  finish(finishedEntry(p, data));
  return true;
}

/** Program badges (Awards list), keeping any already saved in awards_seen. */
export function programBadgeList() {
  return programBadges(programHistory(), settings().awards_seen || {});
}

/** XP from programs: +50 per week hit, +250 for each finished program, from missions_started on. */
export function programBonusXP() {
  return programXP({ history: programHistory(), active: currentStatus(), missionsStart: startedDay() });
}

/** Completion cards to show on Today: finished programs whose badge hasn't been seen yet. */
export function unseenCompletions() {
  const hist = programHistory();
  const series = weightSeries();
  return newMissionBadges(programBadgeList(), settings().awards_seen, startedDay()).map((b) => {
    const entry = hist.filter((e) => PROGRAMS[e.id] && PROGRAMS[e.id].badge === b.id && entryCompleted(e)).sort((a, c) => (a.ended < c.ended ? -1 : 1))[0];
    return entry && { badge: b, entry, def: PROGRAMS[entry.id], summary: summaryFor(entry, { series, workouts: state.workouts || [] }) };
  }).filter(Boolean);
}
