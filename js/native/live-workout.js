// Runs a live cardio workout. In the iPhone app the local ForgeWorkouts plugin holds an HKWorkoutSession +
// HKLiveWorkoutBuilder (ios/App/App/ForgeLiveWorkout.swift) and a lock-screen Live Activity; on the web the same screen
// runs from timestamps alone. The session is kept in localStorage so a reload or a re-open picks it up again.
// The logic is in js/native/live-session.js (injectable, so tests run it); this file wires in the real plugin, storage and data.
import { state } from '../state.js';
import { put, newRecord } from '../db.js';
import { plugin } from './bridge.js';
import { weightKgFor } from '../workouts/energy.js';
import { unit } from '../workouts/plan.js';
import { createLiveSession } from './live-session.js';

export const weightKg = () => weightKgFor(state.weights, state.profile);

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

const live = createLiveSession({
  plugin: () => plugin('ForgeWorkouts'),
  storage: store,
  weightKg,
  settings: () => state.settings,
  cardio: () => state.cardio,
  miles: () => unit() !== 'kg',
  saveRow: (row) => put('cardio_sessions', newRecord(row.fields, { id: row.id, source: 'forge_live' })),
});

export const current = live.current;
export const liveMetrics = live.liveMetrics;
export const onChange = live.onChange;
/** True while a live workout is running or paused (the one answer for Start, the chips and the live screen). */
export const isActive = live.isActive;
export const restore = live.restore;
export const start = live.start;
export const pause = live.pause;
export const resume = live.resume;
export const finish = live.finish;
export const discard = live.discard;
export const refresh = live.refresh;
/** End a workout the phone still holds that Forge no longer knows about (call on launch). */
export const reconcile = live.reconcile;
