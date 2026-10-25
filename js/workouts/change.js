// Train → Change today's workout: the pure bits (edit snapshots, Undo, what each option would do).
// The sheet and the toast live in js/screens/train.js. Nothing here touches the DOM or the database.

/** Session lengths offered for "today only" (minutes). */
export const LENGTHS = [20, 30, 45, 60];

export const blankEdits = (key = '') => ({ key, forced: {}, rest: {}, avoid: [] });

/** Everything Undo has to bring back: the preview edits, the focus, the length and the place. */
export function takeSnapshot({ edits, dayOverride = null, minOverride = null, locationId = null, choice = null }) {
  return {
    edits: { key: edits.key, forced: { ...edits.forced }, rest: { ...edits.rest }, avoid: [...edits.avoid] },
    dayOverride, minOverride, locationId,
    choice: choice ? structuredClone(choice) : null, // Switch: muscle groups, a saved workout or your own list
  };
}

/** A private copy of a snapshot, ready to become the live state again. */
export const restoreSnapshot = (snap) => takeSnapshot({ ...snap });

/** Has the user moved away from the recommended workout (so "Back to recommended" has something to do)? */
export const isChanged = ({ edits, dayOverride, minOverride, choice = null }) =>
  !!(dayOverride || minOverride || choice || edits.avoid.length || Object.keys(edits.forced).length);

/** Exercises the user picked by hand (⋯ → Replace). */
export const pickedIds = (edits) => new Set(Object.values(edits.forced));

/**
 * New exercises, same focus. Steers away from what's showing now. Hand-picked replacements stay
 * (and aren't steered away from) unless `replacePicks`.
 */
export function withSwapAvoid(edits, currentIds, { replacePicks = false } = {}) {
  const keep = replacePicks ? new Set() : pickedIds(edits);
  return {
    ...edits,
    avoid: [...new Set([...edits.avoid, ...currentIds.filter((id) => !keep.has(id))])],
    forced: replacePicks ? {} : { ...edits.forced },
  };
}

/** Move Rest-timer choices along with their slot when exercise i is swapped for another. */
export function carryRest(rest, beforeIds, afterIds) {
  const out = { ...rest };
  const moved = [];
  beforeIds.forEach((id, i) => {
    const to = afterIds[i];
    if (to && to !== id && out[id] != null && !afterIds.includes(id)) moved.push([id, to]);
  });
  for (const [from, to] of moved) { out[to] = out[from]; delete out[from]; }
  return out;
}

/** How many of the slots now hold a different exercise. */
export function swapResult(beforeIds, afterIds) {
  const changed = afterIds.filter((id) => !beforeIds.includes(id)).length;
  return { changed, total: afterIds.length, state: changed === 0 ? 'none' : changed === afterIds.length ? 'all' : 'some' };
}

export function swapMessage({ changed, total, state }) {
  if (state === 'none') return 'No other moves fit here.';
  if (state === 'all') return `${changed} exercise${changed === 1 ? '' : 's'} swapped`;
  return `${changed} of ${total} swapped`;
}

/** Why "New exercises" is greyed out, or '' when it can run. */
export const noSwapReason = (locName, focusLabel) => `No other moves fit ${locName} for ${focusLabel}. Try a different focus or location.`;

export const lengthMessage = (focusLabel, min) => `${focusLabel}${min ? ` · ${min} min` : ''}`;
