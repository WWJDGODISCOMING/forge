// Your awards from live state: one place that feeds Today, Awards and the summary the same inputs, and
// keeps settings/main.awards_seen ({ badge id: date earned }) up to date so earned badges stay earned.
import { state } from '../state.js';
import { patch } from '../db.js';
import { awardsFor, workoutAwards, unseenBadges } from './awards.js';
import { exerciseById } from './library.js';
import { awardOpts as missionOpts } from '../missions/store.js';
import { programBadgeList, programBonusXP } from '../body-programs/store.js';

export const goalDays = () => (state.profile && state.profile.trainingDays) || 3;
const seenNow = () => (state.settings && state.settings.awards_seen) || null;
/** Missions and body programs: their extra badges, and their XP (missions' +100 per badge is not paid on program badges). */
const awardOpts = () => {
  const m = missionOpts();
  return { extraBadges: [...m.extraBadges, ...programBadgeList()], bonusXP: m.bonusXP + programBonusXP() };
};
const opts = () => ({ seen: seenNow() || {}, exerciseById, ...awardOpts() });

/** XP, level and badges for the current history. */
export const myAwards = () => awardsFor(state.workouts, state.cardio || [], goalDays(), opts());

/**
 * Save newly earned badges. First run (no awards_seen yet; app.js calls this once everything has loaded):
 * seed silently with everything already earned, so an upgrade never sets off a pile of celebrations.
 * `exceptWorkoutId` leaves out a workout whose summary is about to celebrate its own badges.
 */
export function syncBadges({ exceptWorkoutId = null } = {}) {
  if (!state.settings) return; // settings not loaded yet
  const seen = seenNow();
  const workouts = exceptWorkoutId ? state.workouts.filter((w) => w.id !== exceptWorkoutId) : state.workouts;
  const list = awardsFor(workouts, state.cardio || [], goalDays(), { seen: seen || {}, exerciseById, extraBadges: awardOpts().extraBadges }).badges;
  const add = unseenBadges(list, seen || {});
  if (!seen) patch('settings', 'main', { awards_seen: add || {} });
  else if (add) patch('settings', 'main', { awards_seen: { ...seen, ...add } });
}

/**
 * The summary's awards for one workout (counted as done), celebrating only badges not seen before. Never
 * writes: a save re-renders the screen and would cut the celebration short (rememberBadges does it later).
 */
export function summaryAwards(w) {
  const list = [...state.workouts.filter((x) => x.id !== w.id), { ...w, status: 'done' }];
  return workoutAwards(list, state.cardio || [], goalDays(), w.id, Date.now(), opts());
}

/** After the summary has shown its badges: remember them. */
export function rememberBadges(badges) {
  if (state.partial || !state.settings || !badges.length) return; // never from a screen drawn before everything loaded
  const seen = seenNow() || {};
  const add = Object.fromEntries(badges.filter((b) => b.earned && !seen[b.id]).map((b) => [b.id, b.earned.at]));
  if (Object.keys(add).length) patch('settings', 'main', { awards_seen: { ...seen, ...add } });
}
