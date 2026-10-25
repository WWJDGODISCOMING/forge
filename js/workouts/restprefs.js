// Per-exercise rest (v0.16.65): { on, warm, work } saved per exercise in settings/main.rest_prefs.
// `on: false` means no rest timer after that exercise's sets. `warm` / `work` are seconds in 0:15 steps
// (null = no value of its own, so the usual rest applies). It beats the dots-menu rest and the Settings default.
export const REST_STEP = 15;
export const REST_MIN = 15;
export const REST_MAX = 600;

/** Every duration the wheel offers: 0:15 … 10:00 in 0:15 steps. */
export const REST_WHEEL = Array.from({ length: REST_MAX / REST_STEP }, (_, n) => (n + 1) * REST_STEP);

/** A saved duration snapped to the wheel, or null when it isn't a usable number. */
export function snapRest(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(REST_MAX, Math.max(REST_MIN, Math.round(v / REST_STEP) * REST_STEP));
}

/** The saved pref for an exercise, cleaned up ({ on, warm, work }), or null if there is none. */
export function restPref(settings, exerciseId) {
  const raw = settings && settings.rest_prefs && settings.rest_prefs[exerciseId];
  if (!raw || typeof raw !== 'object') return null;
  return { on: raw.on !== false, warm: snapRest(raw.warm), work: snapRest(raw.work) };
}

/** The whole rest_prefs map with one exercise's pref set (or removed when `pref` is null), for patch('settings','main',…). */
export function withRestPref(settings, exerciseId, pref) {
  const all = { ...((settings && settings.rest_prefs) || {}) };
  if (pref) all[exerciseId] = { on: pref.on !== false, warm: snapRest(pref.warm), work: snapRest(pref.work) };
  else delete all[exerciseId];
  return all;
}

/**
 * What a pref says for one set: { off: true } for no rest, { sec } for its own time, or null to use the usual rest.
 * Warm-up sets read `warm`, working sets read `work`.
 */
export function restFromPref(pref, warmup) {
  if (!pref) return null;
  if (!pref.on) return { off: true };
  const sec = warmup ? pref.warm : pref.work;
  return sec ? { sec } : null;
}

/** Chip text, e.g. "Rest 1:30", "Rest off", "Rest 0:30 · 1:30" (warm-up · working). */
export function restChipText(pref, fmt) {
  if (!pref) return 'Rest timer';
  if (!pref.on) return 'Rest off';
  if (pref.warm && pref.work) return `Rest ${fmt(pref.warm)} · ${fmt(pref.work)}`;
  const sec = pref.work || pref.warm;
  return sec ? `Rest ${fmt(sec)}` : 'Rest timer';
}
