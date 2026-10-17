// Focus areas: up to 3 muscle groups the user wants more defined. Pure helpers; the generator and UI share them.
// Honest by design: this adds training volume there. Fat loss is body-wide and comes from the calorie goal.

export const FOCUS_GROUPS = {
  chest: { label: 'Chest', muscles: ['chest'] },
  shoulders: { label: 'Shoulders', muscles: ['front_delts', 'side_delts', 'rear_delts'] },
  arms: { label: 'Arms', muscles: ['biceps', 'triceps', 'forearms'] },
  back: { label: 'Back', muscles: ['lats', 'upper_back', 'traps'] },
  abs: { label: 'Abs/core', muscles: ['abs', 'obliques'] },
  glutes: { label: 'Glutes', muscles: ['glutes'] },
  legs: { label: 'Legs', muscles: ['quads', 'hamstrings', 'calves'] },
};
export const FOCUS_KEYS = Object.keys(FOCUS_GROUPS);
export const MAX_FOCUS = 3;
export const FOCUS_RECOVERY_MIN = 60; // never push a focus muscle that is less recovered than this (%)
export const FOCUS_MAX_ADDED = 4; // extra sets per session, all focus groups together
export const FOCUS_SCORE_BONUS = 6; // small nudge for Smart day types; recovery differences usually outweigh it

export const FOCUS_NOTE = 'Focus areas build muscle there. Fat loss happens across your whole body, through your calorie goal.';

/** Valid, de-duplicated, capped list of group keys. */
export function cleanFocus(list) {
  return [...new Set(Array.isArray(list) ? list : [])].filter((k) => typeof k === 'string' && Object.hasOwn(FOCUS_GROUPS, k)).slice(0, MAX_FOCUS);
}

/** 'Shoulders' or 'Chest, Arms'. */
export const focusLabel = (list) => cleanFocus(list).map((k) => FOCUS_GROUPS[k].label).join(', ');

/** Whether a group is recovered enough to push (every muscle with data must be at or above the minimum). */
export function focusRecovered(key, recovery = {}) {
  const vals = FOCUS_GROUPS[key].muscles.map((m) => recovery[m]).filter((v) => Number.isFinite(v));
  return vals.every((v) => v >= FOCUS_RECOVERY_MIN);
}

/** Groups that are chosen and recovered enough to use today. */
export const activeFocus = (list, recovery) => cleanFocus(list).filter((k) => focusRecovered(k, recovery));

/** Score bonus for a day type: a little for each active focus group it trains. */
export function dayFocusBonus(dayMuscles, list, recovery) {
  let hits = 0;
  for (const k of activeFocus(list, recovery)) if (FOCUS_GROUPS[k].muscles.some((m) => dayMuscles.includes(m))) hits++;
  return hits * FOCUS_SCORE_BONUS;
}
