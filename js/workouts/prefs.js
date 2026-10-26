// Recommend more / Recommend less (v0.16.72), the pure half. Saved in settings as
// exercise_prefs: { [exercise_id]: 'more' | 'less' }. No entry means neither. No DOM, no database.

export const PREF_MORE = 'more';
export const PREF_LESS = 'less';
export const MAX_PREFS = 400;

// Generator score nudges. "More" beats a favorite (+15); "less" is steep but not a ban, so a slot
// with no other fit still gets the move.
export const PREF_SCORE = { more: 30, less: -60 };

/** Valid entries only (known value, non-empty id), capped. Anything else is dropped. */
export function cleanPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_PREFS) break;
    if (id && id.length <= 80 && (v === PREF_MORE || v === PREF_LESS)) out[id] = v;
  }
  return out;
}

/** 'more', 'less' or '' (neither). */
export const prefOf = (prefs, id) => (prefs && (prefs[id] === PREF_MORE || prefs[id] === PREF_LESS) ? prefs[id] : '');

/** A new map with `id` set to 'more', 'less' or cleared (any other value). Tapping the same choice again clears it. */
export function setPref(prefs, id, value) {
  const next = { ...cleanPrefs(prefs) };
  if (!id) return next;
  if ((value === PREF_MORE || value === PREF_LESS) && next[id] !== value) next[id] = value;
  else delete next[id];
  return next;
}

/** Score nudge for the generator. */
export const prefScore = (prefs, id) => PREF_SCORE[prefOf(prefs, id)] || 0;

/** Picker ordering: more first (-1), neither (0), less last (1). */
export const prefRank = (prefs, id) => ({ more: -1, less: 1 }[prefOf(prefs, id)] || 0);

export const PREF_LABELS = { more: 'Recommend more', less: 'Recommend less' };

/** Words for VoiceOver on the control. */
export function prefAria(name, value) {
  return value === PREF_MORE ? `${name}: recommend more, selected`
    : value === PREF_LESS ? `${name}: recommend less, selected`
      : `${name}: no preference`;
}

/** The Settings list: [{ id, value }] for ids we know, grouped more first then less, A to Z by name inside each. Unknown ids are skipped. */
export function prefRows(prefs, nameOf) {
  const rows = Object.entries(cleanPrefs(prefs)).map(([id, value]) => ({ id, value, name: nameOf(id) })).filter((r) => r.name);
  return rows.sort((a, b) => (a.value === b.value ? a.name.localeCompare(b.name) : a.value === PREF_MORE ? -1 : 1));
}

/** One-line summary for the Settings row. */
export function prefSummary(prefs) {
  const p = cleanPrefs(prefs);
  const more = Object.values(p).filter((v) => v === PREF_MORE).length;
  const less = Object.values(p).filter((v) => v === PREF_LESS).length;
  if (!more && !less) return 'None set';
  return [more ? `${more} more` : '', less ? `${less} less` : ''].filter(Boolean).join(' · ');
}

/** Small deterministic hash of text to 0..n-1, for week-to-week variety that doesn't flicker on re-render. */
export function hashPick(text, n) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}
