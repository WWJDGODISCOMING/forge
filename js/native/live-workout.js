// Runs a live cardio workout. In the iPhone app the local ForgeWorkouts plugin holds an HKWorkoutSession +
// HKLiveWorkoutBuilder (ios/App/App/ForgeLiveWorkout.swift) and a lock-screen Live Activity; on the web the same screen
// runs from timestamps alone. The session is kept in localStorage so a reload or a re-open picks it up again.
// Nothing here throws: a failed native call just means that workout is kept in Forge only.
import { state } from '../state.js';
import { put, newRecord } from '../db.js';
import { plugin } from './bridge.js';
import { weightKgFor } from '../workouts/energy.js';
import { unit } from '../workouts/plan.js';
import { newLive, pauseLive, resumeLive, endLive, liveToCardio, LIVE_KINDS } from '../workouts/live-core.js';

const KEY = 'forge.live';
const hk = () => plugin('ForgeWorkouts');
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

let session = null; // the core session
let metrics = { kcal: 0, distanceM: 0, hr: null, nativeLive: false, activity: false };
const listeners = new Set();
let handle = null;

export const weightKg = () => weightKgFor(state.weights, state.profile);
export const current = () => session;
export const liveMetrics = () => metrics;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(session, metrics); } catch { /* a screen went away */ } });

function save() {
  const s = store();
  if (!s) return;
  try { if (session && !session.ended_at) s.setItem(KEY, JSON.stringify({ session, metrics })); else s.removeItem(KEY); } catch { /* private mode */ }
}

/** Pick up a workout left running (the app was closed or reloaded). */
export function restore() {
  if (session) return session;
  const s = store();
  try {
    const raw = s && s.getItem(KEY);
    if (raw) { const o = JSON.parse(raw); session = o.session; metrics = { ...metrics, ...o.metrics }; }
  } catch { session = null; }
  if (session) attach();
  return session;
}

/** Native tells us the truth about pause/resume (the Live Activity button) and the live numbers. */
function onNative(e) {
  if (!session || !e) return;
  const at = Number(e.at) || Date.now();
  if (e.paused === true) session = pauseLive(session, at);
  else if (e.paused === false) session = resumeLive(session, at);
  metrics = {
    ...metrics,
    kcal: Number.isFinite(e.kcal) ? e.kcal : metrics.kcal,
    distanceM: Number.isFinite(e.distanceM) ? e.distanceM : metrics.distanceM,
    hr: Number.isFinite(e.hr) && e.hr > 0 ? e.hr : metrics.hr,
  };
  save();
  emit();
}

function attach() {
  const p = hk();
  if (!p || handle || !p.addListener) return;
  try { handle = p.addListener('liveUpdate', onNative); } catch { handle = null; }
}

/** Ask for Health access (heart rate, distance, energy) and start. → the session. Never throws. */
export async function start(kind) {
  if (session && !session.ended_at) return session;
  const at = Date.now();
  session = newLive(kind, at);
  metrics = { kcal: 0, distanceM: 0, hr: null, nativeLive: false, activity: false };
  const p = hk();
  if (p && p.startLive) {
    attach();
    try {
      await p.requestAuthorization();
      const k = LIVE_KINDS[session.kind];
      const r = await p.startLive({ id: session.id, activityType: k.hk, indoor: k.indoor, miles: unit() !== 'kg', start: at, weightKg: weightKg() || 0 });
      metrics.nativeLive = true;
      metrics.activity = !!(r && r.liveActivity);
    } catch { /* kept in Forge only */ }
  }
  save();
  emit();
  return session;
}

export async function pause() {
  if (!session) return;
  session = pauseLive(session, Date.now());
  const p = hk();
  if (p && metrics.nativeLive) { try { await p.pauseLive(); } catch { /* the timer here is the truth */ } }
  save(); emit();
}

export async function resume() {
  if (!session) return;
  session = resumeLive(session, Date.now());
  const p = hk();
  if (p && metrics.nativeLive) { try { await p.resumeLive(); } catch { /* same */ } }
  save(); emit();
}

/** Finish: save to Apple Health (native) and to Forge once, without doubling. → { id, fields } or null when nothing was started. */
export async function finish() {
  if (!session) return null;
  const ended = endLive(session, Date.now());
  const p = hk();
  let saved = null;
  if (p && metrics.nativeLive) {
    try {
      const wanted = state.settings ? state.settings.health_write_workouts !== false : true;
      saved = await p.endLive({ save: wanted, fallbackKcal: Math.round(metrics.kcal || 0), end: ended.ended_at, pauses: ended.pauses });
    } catch { saved = null; }
  }
  const row = liveToCardio(ended, { hk: saved, weightKg: weightKg() });
  if (!(state.cardio || []).some((c) => c.id === row.id)) put('cardio_sessions', newRecord(row.fields, { id: row.id, source: 'forge_live' }));
  session = null;
  metrics = { kcal: 0, distanceM: 0, hr: null, nativeLive: false, activity: false };
  save(); emit();
  return row;
}

/** Throw the workout away (nothing is saved to Forge or Health). */
export async function discard() {
  const p = hk();
  if (p && metrics.nativeLive) { try { await p.endLive({ save: false }); } catch { /* gone anyway */ } }
  session = null;
  metrics = { kcal: 0, distanceM: 0, hr: null, nativeLive: false, activity: false };
  save(); emit();
}

/** Re-sync after the app comes back to the front: native may have paused it from the lock screen. */
export async function refresh() {
  const p = hk();
  if (!session || !p || !metrics.nativeLive || !p.liveState) return;
  try { const r = await p.liveState(); if (r) onNative({ ...r, at: Number(r.at) || Date.now() }); } catch { /* keep going */ }
}
