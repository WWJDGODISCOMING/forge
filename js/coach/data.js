// Gathers what Coach's answers need from the app's existing modules (the only place that touches state).
// Nothing is calculated here that another module does not already calculate; answers.js only words it.
import { state, units } from '../state.js';
import { todayKey } from '../ui.js';
import { intel, reportFor, currentReportWeek, currentGoalPath } from '../health/intel.js';
import { currentReadiness, currentScore, readinessOverridden } from '../health/today.js';
import { activeWorkout, currentRecovery, stalledMainLifts, unit } from '../workouts/plan.js';
import { previewPlan } from '../screens/train.js'; // today's plan with any edits made on Train, as Today shows it
import { exerciseById } from '../workouts/library.js';
import { liftChanges } from './lifts.js';
import { missionsSummary } from '../missions/store.js';
import { activeProgram, currentStatus, cutBlocked } from '../body-programs/store.js';
import { PROGRAMS, recommendedId, recommendedWhy } from '../body-programs/core.js';
import { weeklyScores, longTerm } from '../health/longterm.js';
import { longevityCards } from '../health/longevity.js';
import { clearestChanges } from '../health/longview.js';
import { weightSeries, myBodyMeasures, foodTargets } from '../derived.js';

/** The muscles today's plan trains as primary movers, in the order they first appear. */
function planMuscles(plan) {
  const out = [];
  for (const it of (plan && plan.exercises) || []) {
    const ex = exerciseById(it.exercise_id);
    for (const m of (ex && ex.primary) || []) if (!out.includes(m)) out.push(m);
  }
  return out;
}

// Weekly Forge Scores for 90 days, worked out once and again only when the data or the day changes
// (a tap on a chip draws the screen again, and scoring takes a moment).
let weeklyMemo = null;
function weeklyScoresNow(day) {
  const keys = [state.health_daily, state.body_measures, state.weights, state.workouts, state.cardio, state.profile, state.food_logs];
  if (weeklyMemo && weeklyMemo.day === day && keys.every((k, i) => weeklyMemo.keys[i] === k)) return weeklyMemo.value;
  const value = weeklyScores({
    rows: state.health_daily || [], series: weightSeries(), measures: myBodyMeasures(), workouts: state.workouts,
    cardio: state.cardio || [], profile: state.profile || {}, foodLogs: state.food_logs || [], targets: foodTargets(),
  }, day, 14);
  weeklyMemo = { day, keys, value };
  return value;
}

/** The Long term sentence and the clearest Longevity changes, as the Score screen words them. */
function longtermData(today, u) {
  const cards = longevityCards({ rows: state.health_daily || [], measures: myBodyMeasures(), profile: state.profile || {}, today });
  if (!cards.length) return { hasCards: false };
  const lt = longTerm(weeklyScoresNow(today), today, 90);
  return { hasCards: true, sentence: lt.status === 'ok' ? lt.sentence : null, clear: clearestChanges(cards, u) };
}

/** The running program's status, or the program to suggest (none when a cut is blocked by the safety checks). */
function programData() {
  const status = activeProgram() ? currentStatus() : null;
  if (status && !status.finished) return { status };
  const goal = state.profile && state.profile.goal;
  if (!state.profile) return null;
  const id = recommendedId(goal);
  if (id === 'cut4' && cutBlocked()) return { status: null, recommended: null };
  return { status: null, recommended: { ...PROGRAMS[id], why: recommendedWhy(goal) } };
}

export function coachData() {
  const i = intel();
  const today = todayKey();
  const workouts = state.workouts || [];
  const plan = previewPlan();
  const nameOf = (id) => (exerciseById(id) || { name: id }).name;
  return {
    today,
    units: units(),
    unit: unit(),
    goal: i.goal,
    goalKg: state.profile && state.profile.targetWeightKg,
    weights: i.weights,
    trends: i.trends,
    goalPath: currentGoalPath(),
    report: reportFor(currentReportWeek()),
    readiness: currentReadiness(),
    readinessOverridden: readinessOverridden(),
    score: currentScore(),
    plan,
    planMuscles: planMuscles(plan),
    recovery: currentRecovery(),
    activeWorkout: !!activeWorkout(),
    hasTraining: workouts.some((w) => !w.deleted && (w.status === 'done' || w.status === 'active')),
    lifts: liftChanges({ workouts, unit: unit(), today, nameOf }),
    stalled: stalledMainLifts().map((id) => ({ id, name: nameOf(id) })),
    missions: missionsSummary(),
    program: programData(),
    longterm: longtermData(today, units()),
    focus: (state.profile && state.profile.focus_muscles) || [],
  };
}
