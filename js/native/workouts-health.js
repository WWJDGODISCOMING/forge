// Saves finished Forge workouts to Apple Health through the local ForgeWorkouts plugin (ios/App/App/
// ForgeWorkoutsPlugin.swift), or links them to the Apple Watch workout that already covers the same session.
// A no-op on the web and while the Settings → Apple Health switch is off. Never blocks the summary: everything
// here runs after finishWorkout() has saved. The deciding is pure (js/workouts/energy.js).
import { state } from '../state.js';
import { patch } from '../db.js';
import { plugin } from './bridge.js';
import { healthPayload } from '../health/manual-workout.js';
import { estimateKcal, weightOrDefault, windowFor, pausesFor, activityTypeFor, decide, pickOverlap, accessStatus, pendingPatch, nextVersion } from '../workouts/energy.js';

const hk = () => plugin('ForgeWorkouts');
const SOURCE_NAME = 'Forge';

/** The switch (settings/main.health_write_workouts) is on and this is the iPhone app. */
export const writeEnabled = () => !!hk() && !!(state.settings && state.settings.health_write_workouts);

/** The iPhone app, switch off, and we haven't asked yet. */
export const canOffer = () => !!hk() && !(state.settings && (state.settings.health_write_workouts || state.settings.health_write_prompted));

const weightInfo = () => weightOrDefault(state.weights, state.profile);
const stored = (w) => state.workouts.find((x) => x.id === w.id) || w;

/** Ask for write access. → 'authorized' | 'denied' | 'notDetermined' | 'unavailable' (web). Never throws. */
export async function requestAccess() {
  const p = hk();
  if (!p) return 'unavailable';
  try {
    const r = await p.requestAuthorization();
    return accessStatus(r);
  } catch { return 'denied'; }
}

/** Ask for access and, if granted, turn the switch on. → true when writes are now on. */
export async function enableWrites() {
  const status = await requestAccess();
  if (status === 'denied' || status === 'unavailable') return false;
  patch('settings', 'main', { health_write_workouts: true, health_write_since: new Date().toISOString() });
  return true;
}

/** Link, measure or estimate for one finished workout, and save the outcome on it. Returns the patch (or null). */
export async function sendWorkout(w0) {
  const p = hk();
  const w = stored(w0);
  const win = windowFor(w);
  if (!p || !win || w.status !== 'done' || w.deleted) return null;
  const wt = weightInfo();
  const estimate = estimateKcal(w, wt.kg);
  try {
    const { workouts } = await p.overlappingWorkouts(win);
    let measuredKcal = 0;
    if (!pickOverlap(win, workouts || [])) measuredKcal = ((await p.activeEnergySum(win)) || {}).kcal || 0;
    const d = decide({ win, overlaps: workouts || [], measuredKcal, estimate });
    if (d.action === 'skip') return null; // no time to write (the weight falls back to an estimate, so this is rare)
    if (d.action === 'link') { patch('workouts', w.id, d.patch); return d.patch; }
    const version = nextVersion(w);
    const r = await p.saveWorkout({ id: w.id, version, activityType: activityTypeFor(w), ...win, pauses: pausesFor(w, win), kcal: d.kcal, indoor: true });
    const fields = { hk_uuid: r.uuid, kcal: d.kcal, kcal_source: d.source, kcal_weight_estimated: d.source === 'estimate' && wt.estimated, health_write: 'saved', health_version: version, health_tries: 0 };
    patch('workouts', w.id, fields);
    return fields;
  } catch {
    const fields = pendingPatch(w);
    patch('workouts', w.id, fields);
    return fields;
  }
}

/** A hand-logged cardio row (#253) → Apple Health, once. Asks for access if the switch is off. → 'saved' | 'denied' | 'failed' | 'unavailable'. */
export async function sendManual(row) {
  const p = hk();
  if (!p) return 'unavailable';
  const payload = healthPayload(row);
  if (!payload) return 'failed';
  if (!writeEnabled() && !(await enableWrites())) return 'denied';
  try {
    const r = await p.saveWorkout(payload);
    patch('cardio_sessions', row.id, { hk_uuid: r.uuid, hk_source: SOURCE_NAME, health_write: 'saved' });
    return 'saved';
  } catch { return 'failed'; }
}

/** Called right after finishWorkout(): fire and forget. */
export function afterFinish(w) {
  if (!writeEnabled() || !w) return;
  sendWorkout(w).catch(() => {});
}

/** Re-save an edited workout with the next version (Health replaces the earlier one, no duplicate). */
export async function resync(w0) {
  const p = hk();
  const w = stored(w0);
  if (!p || !w || w.health_write !== 'saved' || !w.hk_uuid || !writeEnabled()) return false;
  const win = windowFor(w);
  if (!win) return false;
  const estimate = estimateKcal(w, weightInfo().kg);
  const kcal = w.kcal_source === 'estimate' && estimate != null ? estimate : w.kcal;
  if (!(kcal > 0)) return false;
  const version = nextVersion(w);
  try {
    const r = await p.saveWorkout({ id: w.id, version, activityType: activityTypeFor(w), ...win, pauses: pausesFor(w, win), kcal, indoor: true });
    patch('workouts', w.id, { hk_uuid: r.uuid, kcal, health_version: version });
    return true;
  } catch { return false; }
}

/** A Forge workout was deleted: remove what Forge wrote (only ever Forge-sourced; the plugin checks). */
export async function removeFor(w0) {
  const p = hk();
  const w = stored(w0);
  if (!p || !w || !w.hk_uuid) return false;
  try { await p.deleteWorkout({ uuid: w.hk_uuid }); return true; } catch { return false; }
}

let retrying = false;
/** On app open or resume: send the workouts that were waiting (offline, or Health was locked). */
export async function retryPending() {
  if (retrying || !writeEnabled()) return 0;
  retrying = true;
  let n = 0;
  try {
    for (const w of state.workouts.filter((x) => x.status === 'done' && !x.deleted && x.health_write === 'pending')) {
      const r = await sendWorkout(w);
      if (r && r.health_write !== 'pending') n++;
    }
  } finally { retrying = false; }
  return n;
}

/** The one-time "Also send the last 7 days" button: same link / measure / estimate rules. Returns how many were handled. */
export async function sendLastDays(days = 7) {
  if (!writeEnabled()) return 0;
  const since = Date.now() - days * 86400000;
  let n = 0;
  for (const w of state.workouts.filter((x) => x.status === 'done' && !x.deleted && !x.health_write && Date.parse(x.finished_at) >= since)) {
    const r = await sendWorkout(w);
    if (r && (r.health_write === 'saved' || r.health_write === 'linked')) n++;
  }
  return n;
}

/** The newest workout Forge saved or linked, for the status line on Settings → Apple Health. */
export function lastSent(workouts = state.workouts) {
  return workouts.filter((w) => !w.deleted && (w.health_write === 'saved' || w.health_write === 'linked'))
    .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))[0] || null;
}

export { SOURCE_NAME };
