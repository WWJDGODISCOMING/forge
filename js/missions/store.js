// Missions from live state. Everything is derived from weights, body_measures, workouts, cardio and
// health_daily and food_logs; the only stored state is in settings/main:
//   missions_started  the first local day missions counted for XP (never earlier: no retroactive XP)
//   mission_steps     step target (default 8,000)       mission_bed   bedtime target 'HH:MM' (default 23:00)
//   missions_seen     { day: [mission ids already shown as done] } for the last two weeks, so a check springs once
import { state, units as getUnits } from '../state.js';
import { patch } from '../db.js';
import { currentTargets } from '../derived.js';
import { streak } from '../workouts/awards.js';
import {
  DEFAULTS, indexDays, missionsFor, missionXP, weekDots, allDone, dayXP, localDay, shiftDay, MISSION_XP, ALL_DONE_XP,
} from './core.js';
import { dayDetail, pastDays, firstDay, neighbours } from './day-core.js';
import { PERFECT_WEEK_XP, recordTier } from './celebrate-core.js';
import { missionBadges, newMissionBadges, currentStreak } from './badges.js';

const XP_BADGE = 100;
export const today = () => localDay(Date.now());

export function missionSettings() {
  const st = state.settings || {};
  return {
    steps: Number.isFinite(st.mission_steps) && st.mission_steps > 0 ? st.mission_steps : DEFAULTS.steps,
    bed: typeof st.mission_bed === 'string' && /^\d{1,2}:\d{2}$/.test(st.mission_bed) ? st.mission_bed : DEFAULTS.bed,
  };
}
export const startedDay = () => (state.settings && state.settings.missions_started) || null;

/** Food logging is optional: the protein mission exists only once there are logs (state.food_logs). */
const foodLogs = () => (state.food_logs && state.food_logs.length ? state.food_logs : null);

const liveIndex = () => indexDays({
  weights: state.weights, bodyMeasures: state.body_measures, workouts: state.workouts, cardio: state.cardio,
  healthDaily: state.health_daily, foodLogs: foodLogs(),
});

function targets() {
  const s = missionSettings();
  const t = foodLogs() ? currentTargets() : null;
  return { steps: s.steps, bed: s.bed, proteinG: t ? t.proteinG : 0 };
}

/** The plan has nothing left for today: the weekly goal was already met before today, and nothing is done yet today. */
function restDayToday() {
  const goal = (state.profile && state.profile.trainingDays) || 3;
  const st = streak(state.workouts, state.cardio || [], goal);
  return st.thisWeek.done >= goal;
}

/** Today's missions with totals: { list, done, total, xp, bonus, all }. */
export function todayMissions() {
  const day = today();
  const idx = liveIndex();
  const list = missionsFor(day, idx, { targets: targets(), restDay: restDayToday() });
  const all = allDone(list);
  return { day, list, done: list.filter((m) => m.done).length, total: list.length, xp: dayXP(list), bonus: ALL_DONE_XP, all, started: !!startedDay() };
}

const dayData = () => ({
  weights: state.weights, bodyMeasures: state.body_measures, workouts: state.workouts, cardio: state.cardio,
  healthDaily: state.health_daily, foodLogs: state.food_logs,
});
function dayTargets() {
  const t = state.profile ? currentTargets() : null;
  return { ...targets(), calories: t ? t.calories : null, proteinG: t ? t.proteinG : 0 };
}

/** One past (or present) day, read-only: see js/missions/day-core.js. */
export function dayView(day) {
  const data = dayData();
  const t = dayTargets();
  const first = firstDay(data, startedDay());
  return { ...dayDetail(day, data, { targets: t, today: today() }), ...neighbours(day, { first, today: today() }), first };
}

/** Today back to the first day with data, newest first. */
export function dayList() {
  return pastDays(dayData(), { targets: dayTargets(), today: today(), startedDay: startedDay() });
}

/** Rolling week for the Awards screen. */
export function weekProgress() {
  return weekDots(today(), liveIndex(), { targets: targets() }, startedDay());
}

/** Missions done and on offer over the 7 days starting `monday` (days before missions started or after today are skipped); null before any counted day. */
export function weekMissionCounts(monday) {
  const start = startedDay();
  if (!start) return null;
  const idx = liveIndex();
  const t = targets();
  let done = 0;
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const day = shiftDay(monday, i);
    if (day < start || day > today()) continue;
    const list = missionsFor(day, idx, { targets: t, restDay: false });
    done += list.filter((m) => m.done).length;
    total += list.length;
  }
  return total ? { done, total } : null;
}

/** XP earned in the last 7 days (never before missions started): mission XP plus 100 per mission badge, as bonusXP sums it. */
export function weekXP(badges = extraBadges()) {
  const start = startedDay();
  if (!start) return 0;
  const week = shiftDay(today(), -6);
  const from = week > start ? week : start;
  const fromBadges = badges.filter((b) => b.earned && b.earned.at.slice(0, 10) >= from).length * XP_BADGE;
  return missionXP(from, today(), liveIndex(), { targets: targets() }) + fromBadges;
}

/** What Coach needs: today's missions, the rolling week, the XP earned in it, and the weigh-in streak in days. */
export function missionsSummary() {
  return { started: !!startedDay(), today: todayMissions(), week: weekProgress(), weekXP: weekXP(), streak: currentStreak([...liveIndex().weigh], today()) };
}

/** Mission badges (streaks, body composition), keeping any already saved in awards_seen. */
export function extraBadges() {
  const idx = liveIndex();
  return missionBadges({ weighDays: [...idx.weigh], bodyMeasures: state.body_measures || [], seen: (state.settings && state.settings.awards_seen) || {}, units: getUnits(), perfectWeeks: perfectWeekEnds() });
}

/** Mission badges earned since missions started that Today hasn't celebrated yet. */
export function unseenMissionBadges() {
  return newMissionBadges(extraBadges(), state.settings && state.settings.awards_seen, startedDay());
}

/**
 * XP from outside workouts: missions since missions_started, plus +100 for each mission badge earned on or
 * after that day (badges you already had on the day this shipped are seeded without XP).
 */
export function bonusXP(badges = extraBadges()) {
  const start = startedDay();
  if (!start) return 0;
  const idx = liveIndex();
  const fromBadges = badges.filter((b) => b.earned && b.earned.at.slice(0, 10) >= start).length * XP_BADGE;
  // the Perfect Week badge pays its 100 once (above); each later week pays 100 more
  const extraWeeks = Math.max(0, perfectWeekEnds().filter((d) => d >= start).length - 1) * PERFECT_WEEK_XP;
  return missionXP(start, today(), idx, { targets: targets() }) + fromBadges + extraWeeks;
}

/** Options that awardsFor needs to include missions: { extraBadges, bonusXP }. */
export function awardOpts() {
  const badges = extraBadges();
  return { extraBadges: badges, bonusXP: bonusXP(badges) };
}

/** First run: remember today as the day missions started counting. A no-op once saved. */
export function ensureStarted() {
  if (state.partial || !state.settings || state.settings.missions_started) return;
  patch('settings', 'main', { missions_started: today() });
}

export function setMissionSetting(key, value) {
  if (state.partial) return;
  patch('settings', 'main', { [key]: value });
}

/** Ids already shown as done today (so only a newly finished mission animates). */
export function seenToday() {
  const seen = (state.settings && state.settings.missions_seen) || {};
  return new Set(seen[today()] || []);
}

/** Remember today's done missions; keeps the last 14 days. Writes only when something changed. */
export function rememberDone(ids) {
  if (state.partial || !state.settings) return;
  const day = today();
  const seen = (state.settings.missions_seen) || {};
  const have = new Set(seen[day] || []);
  if (ids.every((id) => have.has(id))) return;
  const keep = shiftDay(day, -14);
  const next = Object.fromEntries(Object.entries(seen).filter(([d]) => d >= keep));
  next[day] = [...new Set([...have, ...ids])];
  state.settings.missions_seen = next; // right away, like missions_cele
  patch('settings', 'main', { missions_seen: next });
}

/** The highest celebration tier already played today (missions_cele), so each tier plays once per day. */
export function celebratedTier(day = today()) {
  const cele = (state.settings && state.settings.missions_cele) || {};
  return Number(cele[day]) || 0;
}

export function recordCelebrated(tier, day = today()) {
  if (state.partial || !state.settings) return;
  const next = recordTier(state.settings.missions_cele, day, tier);
  state.settings.missions_cele = next; // right away, so a re-render before the save lands can't replay it
  patch('settings', 'main', { missions_cele: next });
}

/** The last day of each Perfect Week earned (perfect_weeks), oldest first. */
export const perfectWeekEnds = () => [...((state.settings && state.settings.perfect_weeks) || [])].sort();

export function recordPerfectWeek(day = today()) {
  if (state.partial || !state.settings) return;
  const next = [...new Set([...perfectWeekEnds(), day])].sort();
  state.settings.perfect_weeks = next;
  patch('settings', 'main', { perfect_weeks: next });
}

export { MISSION_XP, ALL_DONE_XP };
