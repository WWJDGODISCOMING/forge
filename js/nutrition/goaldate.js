// Goal date: what it takes to reach the goal weight by a day you pick. Pure (no browser APIs), so it can be unit tested.
// It only ever suggests a number. The calorie ceiling the user set stays the official target and never changes here.
//
// Safety, in this order:
// - Never more than MAX_LOSS_PCT (about 1%) of body weight a week, or MAX_GAIN_PCT when gaining.
// - Never below the safe floor (CALORIE_FLOORS for the user's sex, and never below a ceiling the user set lower).
// - The ceiling is the official number and is never changed. The hint is the pace the date needs, so it can sit above the
//   ceiling (the user is already eating less than the date needs); recommendLine says so in plain words.
// - If the date can't be met within those limits, say so and suggest the earliest realistic date instead.
import { addDays, daysBetween } from '../weight/smoothing.js';
import { weightToDisplay, weightFromInput, weightUnit } from '../units.js';
import { KCAL_PER_KG, CALORIE_FLOORS, MAX_LOSS_PCT, MAX_GAIN_PCT, MAX_SURPLUS_KCAL } from './targets.js';

const ON_TRACK_BAND = 0.15; // within 15% of the pace you need counts as on track
const NO_ROOM_KG = 0.05; // under this a week there is no pace to suggest (burn at or near the floor)
const WEIGHT_RANGE_KG = [30, 350]; // the goal weights Settings accepts

/** The settings, normalised: { on, day } with day a YYYY-MM-DD string or null. Off unless switched on with a date. */
export function goalDateSettings(settings) {
  const s = settings || {};
  const day = typeof s.goal_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.goal_date) ? s.goal_date : null;
  return { on: s.goal_date_on === true, day };
}

/** The lowest intake we will suggest: the sex floor, or the user's own ceiling when that is lower. */
export function safeFloor(sex, ceiling) {
  const f = CALORIE_FLOORS[sex] || CALORIE_FLOORS.unspecified;
  return Number.isFinite(ceiling) && ceiling > 0 ? Math.min(f, ceiling) : f;
}

/**
 * trendKg: smoothed weight now. goalKg: goal weight. goalDay / today: YYYY-MM-DD. burn: estimated kcal burned a day
 * (Apple Health, else TDEE). ceiling: the user's calorie target. sex: profile sex.
 * actualKgPerWeek: signed trend slope (kg/week) or null. weekKg: signed 7-day trend change or null.
 *
 * status: 'noweight' (need a trend and a goal) | 'reached' | 'nodate' (date is today or past) | 'ok' | 'unrealistic'.
 * noRoom is true when burn leaves no room above the floor (maxKgPerWeek ~ 0): no pace or date is suggested then.
 * With 'ok' / 'unrealistic': kcal (rounded to 10, inside the safety limits), requiredKgPerWeek (signed),
 * suggestedDay (set when unrealistic: the earliest date within the limits), pace (ahead|on|behind|unknown).
 */
export function goalDatePlan({ trendKg, goalKg, goalDay, today, burn, ceiling, sex, actualKgPerWeek = null, weekKg = null }) {
  if (!(trendKg > 0) || !(goalKg > 0)) return { status: 'noweight' };
  const remaining = goalKg - trendKg; // negative = lose
  if (Math.abs(remaining) < 0.1) return { status: 'reached', remaining };
  const losing = remaining < 0;
  const days = goalDay ? daysBetween(today, goalDay) : 0;
  const floor = safeFloor(sex, ceiling);
  const hasBurn = Number.isFinite(burn) && burn > 0;

  // Fastest pace allowed (kg/week, positive): % of body weight, and what the floor / surplus limit leaves.
  const pctCap = ((losing ? MAX_LOSS_PCT : MAX_GAIN_PCT) / 100) * trendKg;
  let energyCap = Infinity;
  if (hasBurn) energyCap = (((losing ? burn - floor : MAX_SURPLUS_KCAL) * 7) / KCAL_PER_KG);
  const maxKgPerWeek = Math.max(0, Math.min(pctCap, energyCap));
  const noRoom = maxKgPerWeek < NO_ROOM_KG;
  const base = { goalDay, goalKg, remaining, losing, days, floor, ceiling: Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null, maxKgPerWeek, noRoom, burn: hasBurn ? burn : null };

  const wantPerWeek = days > 0 ? (Math.abs(remaining) / days) * 7 : Infinity;
  const realistic = days > 0 && wantPerWeek <= maxKgPerWeek + 1e-9;
  const usedPerWeek = realistic ? wantPerWeek : maxKgPerWeek;
  const requiredKgPerWeek = (losing ? -1 : 1) * usedPerWeek;

  let kcal = null;
  if (hasBurn) {
    kcal = burn + (requiredKgPerWeek * KCAL_PER_KG) / 7;
    kcal = Math.round(kcal / 10) * 10;
    if (losing) kcal = Math.max(kcal, floor); // the floor is applied after rounding, so rounding can't break it
  }

  let suggestedDay = null;
  if (!realistic) suggestedDay = !noRoom ? addDays(today, Math.ceil((Math.abs(remaining) / maxKgPerWeek) * 7)) : null;

  // Ahead / on track / behind: your trend's pace toward the goal vs the pace the date needs.
  let pace = 'unknown';
  if (Number.isFinite(actualKgPerWeek) && days > 0) {
    const toward = (losing ? -1 : 1) * actualKgPerWeek; // positive = moving toward the goal
    const need = wantPerWeek;
    if (toward >= need * (1 + ON_TRACK_BAND)) pace = 'ahead';
    else if (toward >= need * (1 - ON_TRACK_BAND)) pace = 'on';
    else pace = 'behind';
  }
  return { status: realistic ? 'ok' : days > 0 ? 'unrealistic' : 'nodate', ...base, kcal, requiredKgPerWeek, suggestedDay, pace, actualKgPerWeek, weekKg };
}

/** The small print under the calorie ceiling, or '' when there is nothing safe and useful to say. fmt(day) formats a date. */
export function recommendLine(plan, fmt) {
  if (!plan || plan.kcal == null || !['ok', 'unrealistic'].includes(plan.status)) return '';
  const n = plan.kcal.toLocaleString('en-US');
  if (plan.noRoom) return '';
  const ahead = plan.losing && plan.ceiling && plan.kcal > plan.ceiling ? `. Your ${plan.ceiling.toLocaleString('en-US')} ceiling is already ahead of that pace.` : '';
  if (plan.status === 'ok') return `To hit ${fmt(plan.goalDay)}: ~${n} cal/day${ahead}`;
  return plan.suggestedDay ? `A safer date is ${fmt(plan.suggestedDay)}: ~${n} cal/day${ahead}` : '';
}

/** Plain, encouraging words for the Goal path sheet's status. */
export function paceWords(plan) {
  switch (plan && plan.pace) {
    case 'ahead': return { label: 'Ahead', text: 'You are ahead of the pace for your date. Nice work. There is no need to speed up.' };
    case 'on': return { label: 'On track', text: 'You are right on the pace for your date. Keep doing what you are doing.' };
    case 'behind': return { label: 'Behind', text: 'A little behind the pace for your date. That is okay: small steady changes add up, and you can move the date.' };
    default: return { label: 'Getting started', text: 'Keep weighing in. After a couple of weeks Forge can tell how you are doing against your date.' };
  }
}

/** The weekly check-in line: this week's trend change next to the weekly change the date needs. */
export function weekLine(plan, units) {
  const unit = weightUnit(units);
  const f = (kg) => weightToDisplay(Math.abs(kg), units).toFixed(1);
  const need = `Your date needs about ${f(plan.requiredKgPerWeek)} ${unit} a week ${plan.losing ? 'down' : 'up'}.`;
  if (plan.weekKg == null) return `This week: keep weighing in. ${need}`;
  const dir = plan.weekKg < -0.04 ? 'down' : plan.weekKg > 0.04 ? 'up' : 'steady';
  return `This week: ${dir === 'steady' ? 'steady' : `${dir} ${f(plan.weekKg)} ${unit}`}. ${need}`;
}

/**
 * The small note under the Goal date fields when something is missing or out of range, else ''.
 * on: switch state. day: the date input's value. weightText: the weight input's text. units: 'imperial' | 'metric'.
 */
export function goalDateNote({ on, day, weightText }, today, units) {
  if (!on) return '';
  if (!day) return 'Pick a date to see your plan.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day <= today) return 'Pick a date after today.';
  const kg = weightText === '' || weightText == null ? NaN : weightFromInput(weightText, units);
  if (!Number.isFinite(kg) || kg < WEIGHT_RANGE_KG[0] || kg > WEIGHT_RANGE_KG[1]) {
    const lo = weightToDisplay(WEIGHT_RANGE_KG[0], units), hi = weightToDisplay(WEIGHT_RANGE_KG[1], units);
    return `Enter a weight between ${Math.round(lo)} and ${Math.round(hi)} ${weightUnit(units)}.`;
  }
  return '';
}
export const GOAL_WEIGHT_RANGE_KG = WEIGHT_RANGE_KG;
