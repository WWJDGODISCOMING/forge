// v0.16.91 (#254): a long live Walk must not vanish on End. Row written before the native end, Forge-saved Health
// workouts imported when no row exists, no silent discard of a recovered session, sign-out asks first.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { createLiveSession, KEY } from '../js/native/live-session.js';
import { skipReason, planWorkoutImport } from '../js/health/apple-workouts.js';
import { askLiveBeforeSignOut } from '../js/signout.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function rig({ endLive, liveState } = {}) {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const rows = [];
  const calls = [];
  const upsert = (r) => { const i = rows.findIndex((x) => x.id === r.id); const row = { id: r.id, ...r.fields }; if (i < 0) rows.push(row); else rows[i] = { ...rows[i], ...row }; };
  const plugin = {
    requestAuthorization: async () => ({}),
    addListener: () => ({ remove() {} }),
    startLive: async () => ({ liveActivity: false }),
    pauseLive: async () => ({}), resumeLive: async () => ({}),
    liveState: liveState || (async () => ({})),
    endLive: (o) => { calls.push(o); return endLive ? endLive(o) : Promise.resolve({}); },
  };
  const make = (now) => createLiveSession({ plugin: () => plugin, storage: () => storage, waitMs: 30, now, settings: () => ({ health_write_workouts: true }), weightKg: () => 70, cardio: () => rows, saveRow: upsert, updateRow: upsert });
  return { make, rows, calls, store };
}

test('#254 finish() with a native end that never answers still writes exactly one row, first', async () => {
  const r = rig({ endLive: () => new Promise(() => {}) });
  let t = 1_700_000_000_000;
  const live = r.make(() => t);
  await live.start('walk');
  t += 90 * 60000;
  const p = live.finish();
  assert(r.rows.length === 1, 'row written synchronously, before the native wait');
  const row = await p;
  eq(r.rows.length, 1);
  eq(row.fields.duration_min, 90);
  assert(r.store.get(KEY) === undefined, 'live record cleared');
});

test('#254 a reload during "ending" finds the row and does not duplicate it', async () => {
  const r = rig({ endLive: () => new Promise(() => {}) });
  let t = 1_700_000_000_000;
  const a = r.make(() => t);
  await a.start('walk');
  t += 60 * 60000;
  a.finish(); // the app is "killed" while Saving…
  const b = r.make(() => t); // relaunch with the same storage and rows
  assert(b.restore() === null, 'nothing to restore');
  eq(r.rows.length, 1);
  eq(r.rows[0].duration_min, 60);
});

test('#254 the Health numbers are patched into the same row when the phone answers', async () => {
  const r = rig({ endLive: async () => ({ uuid: 'hk-9', kcal: 321, distanceM: 5000, elapsedMs: 3600000 }) });
  let t = 1_700_000_000_000;
  const live = r.make(() => t);
  await live.start('walk');
  t += 3600000;
  await live.finish();
  eq(r.rows.length, 1);
  eq(r.rows[0].hk_uuid, 'hk-9');
  eq(r.rows[0].calories, 321);
  eq(r.rows[0].distance_km, 5);
});

const forgeWalk = { platformId: 'U1', sourceId: 'com.christianeverett.forge', workoutType: 'walking', startDate: '2026-10-29T14:00:00.000Z', endDate: '2026-10-29T15:30:00.000Z', duration: 5400, metadata: { ForgeWorkoutId: 'live_abc' } };

test('#254 skipReason imports a Forge-source walk with no row, skips it when the row exists', () => {
  eq(skipReason(forgeWalk, [], []), null);
  eq(skipReason(forgeWalk, [], [{ id: 'live_abc', live_id: 'live_abc' }]), 'forge');
  eq(skipReason(forgeWalk, [], [{ id: 'x', hk_uuid: 'U1', live_id: 'live_abc' }]), 'forge');
  eq(skipReason(forgeWalk, [], [{ id: 'live_abc', live_id: 'live_abc', deleted: true }]), null);
});

test('#254 planWorkoutImport brings the lost walk back as its live row, never over a deleted or existing one', () => {
  const plan = planWorkoutImport([forgeWalk], {});
  eq(plan.create.length, 1);
  eq(plan.create[0].id, 'live_abc');
  eq(plan.create[0].fields.live_id, 'live_abc');
  eq(plan.create[0].fields.duration_min, 90);
  eq(planWorkoutImport([forgeWalk], { existing: new Map([['live_abc', { deleted: true }]]) }).create.length, 0);
  eq(planWorkoutImport([forgeWalk], { existing: new Map([['live_abc', { deleted: false }]]) }).update.length, 0);
});

test('#254 reconcile never discards a >1 min phone session; it waits for Save / Discard', async () => {
  const r = rig({ liveState: async () => ({ id: 'live_zz', kind: 'walk', startedAt: 1_700_000_000_000, elapsed: 20 * 60000, kcal: 80, paused: false, pauses: [] }) });
  const live = r.make(() => 1_700_001_200_000);
  eq(await live.reconcile(), 'stray');
  eq(r.calls.length, 0); // no endLive at all
  assert(live.pendingStray(), 'pending');
  const s = live.adoptStray();
  eq(s.id, 'live_zz');
  eq(s.kind, 'walk');
  assert(live.isActive(), 'running again');
});

test('#254 a stray under a minute is still ended without saving; Discard ends it with save:false', async () => {
  const r = rig({ liveState: async () => ({ id: 'live_q', elapsed: 20000 }) });
  const live = r.make(() => 1);
  eq(await live.reconcile(), 'ended');
  eq(r.calls[0].save, false);
  const r2 = rig({ liveState: async () => ({ id: 'live_q', elapsed: 600000 }) });
  const l2 = r2.make(() => 1);
  await l2.reconcile();
  await l2.dropStray();
  eq(r2.calls[0].save, false);
  eq(l2.pendingStray(), null);
});

test('#254 sign-out with a running live workout asks first, and stops when declined', async () => {
  let asked = null;
  eq(await askLiveBeforeSignOut({ active: async () => ({ kind: 'walk' }), ask: async (o) => { asked = o; return false; } }), false);
  eq(asked.title, 'End and save your walk?');
  eq(await askLiveBeforeSignOut({ active: async () => ({ kind: 'walk' }), ask: async () => true }), true);
  eq(await askLiveBeforeSignOut({ active: async () => null, ask: async () => { throw new Error('no prompt'); } }), true);
  assert(read('js/screens/settings.js').includes('askLiveBeforeSignOut'), 'Settings sign-out asks');
  assert(read('js/signout.js').includes('m.finish()'), 'sign-out saves the workout instead of discarding it');
});

test('#254 Swift recovers the HealthKit session on launch', () => {
  assert(read('ios/App/App/ForgeLiveWorkout.swift').includes('recoverActiveWorkoutSession'), 'recoverActiveWorkoutSession');
  assert(read('ios/App/App/ForgeWorkoutsPlugin.swift').includes('live.recover()'), 'liveState recovers first');
});
