// v0.16.91 (#254): a long live Walk must not vanish on End. Row written before the native end, Forge-saved Health
// workouts imported when no row exists, no silent discard of a recovered session, sign-out asks first.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { createLiveSession, KEY } from '../js/native/live-session.js';
import { skipReason, planWorkoutImport } from '../js/health/apple-workouts.js';
import { askLiveBeforeSignOut, signOutCleanly } from '../js/signout.js';

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

test('#254 sign-out saves the walk (row write) before the flush, so nothing is lost', async () => {
  const order = [];
  await signOutCleanly({ storage: () => null, stopRest: async () => order.push('rest'), stopLive: async () => order.push('row'), flush: async () => order.push('flush'),
    clearReminders: async () => {}, clearAiPlans: async () => {}, clearWidget: async () => {}, signOut: async () => order.push('signOut'), clearLocalCache: async () => order.push('cache'), reload: () => {} });
  assert(order.indexOf('row') < order.indexOf('flush'), `order was ${order.join(',')}`);
  assert(order.indexOf('flush') < order.indexOf('signOut') && order.indexOf('flush') < order.indexOf('cache'), 'flush before sign-out and cache clear');
  const src = read('js/signout.js');
  assert(src.includes('m.pendingStray()') && src.includes('m.adoptStray()'), 'a phone-held stray is adopted before it is finished');
});

test('#254 a phone-held stray counts as a running workout at sign-out, and is adopted and ended under this account', async () => {
  const stray = { id: 'live_s1', kind: 'run', startedAt: 1_700_000_000_000, elapsed: 30 * 60000, paused: false, pauses: [] };
  const r = rig({ liveState: async () => stray, endLive: async () => ({ uuid: 'hk-s', kcal: 200, distanceM: 4000, elapsedMs: 1800000 }) });
  let t = 1_700_001_800_000;
  const live = r.make(() => t);
  eq(await live.reconcile(), 'stray');
  let asked = null;
  eq(await askLiveBeforeSignOut({ active: async () => (live.isActive() ? live.current() : (live.pendingStray() ? { kind: live.pendingStray().kind } : null)), ask: async (o) => { asked = o; return true; } }), true);
  eq(asked.title, 'End and save your run?');
  assert(live.adoptStray(), 'adopted');
  await live.finish();
  eq(r.rows.length, 1);
  eq(r.rows[0].id, 'live_s1');
  eq(live.pendingStray(), null);
  assert(!live.isActive(), 'nothing left running');
  assert(r.calls.length === 1 && r.calls[0].save !== false, 'ended on the phone once, with a save');
  eq(r.store.get(KEY), undefined);
  assert(read('js/signout.js').includes('await m.reconcile()'), 'the real check asks the phone');
});

test('#254 a phone session whose walk is already in History is ended with save:true, no question', async () => {
  const stray = { id: 'live_k1', kind: 'walk', startedAt: 1_700_000_000_000, elapsed: 40 * 60000, paused: false, pauses: [] };
  const r = rig({ liveState: async () => stray, endLive: async () => ({ uuid: 'hk-k', kcal: 150, distanceM: 3000, elapsedMs: 2400000 }) });
  r.rows.push({ id: 'live_k1', live_id: 'live_k1', duration_min: 40 });
  const live = r.make(() => 1_700_002_400_000);
  eq(await live.reconcile(), 'saved');
  eq(live.pendingStray(), null);
  eq(r.calls.length, 1);
  assert(r.calls[0].save !== false, 'saved to Health');
  eq(r.rows.length, 1);
  eq(r.rows[0].hk_uuid, 'hk-k');
  // matched through live_id on a different row id
  const r2 = rig({ liveState: async () => stray });
  r2.rows.push({ id: 'other', live_id: 'live_k1' });
  eq(await r2.make(() => 1_700_002_400_000).reconcile(), 'saved');
  // ended here earlier in this run (in `gone`) but the row list is empty: still no question
  let held = null;
  const r3 = rig({ liveState: async () => held || {} });
  const l3 = r3.make(() => 1_700_000_000_000);
  await l3.start('walk');
  held = { ...stray, id: l3.current().id };
  await l3.finish();
  r3.rows.length = 0;
  r3.calls.length = 0;
  eq(await l3.reconcile(), 'saved');
  eq(l3.pendingStray(), null);
});

test('#254 the decision waits for the cardio rows; unloaded rows decide nothing', async () => {
  const stray = { id: 'live_w1', kind: 'walk', startedAt: 1, elapsed: 40 * 60000, paused: false, pauses: [] };
  let loaded = false;
  const rows = [{ id: 'live_w1' }];
  const calls = [];
  const mk = () => createLiveSession({ plugin: () => ({ liveState: async () => stray, endLive: (o) => { calls.push(o); return Promise.resolve({}); } }), storage: () => null, waitMs: 30, cardio: () => (loaded ? rows : []), ready: () => loaded, now: () => 5 });
  const a = mk();
  eq(await a.reconcile(), 'none');
  eq(a.pendingStray(), null);
  eq(calls.length, 0);
  loaded = true;
  eq(await a.reconcile(), 'saved');
  eq(calls.length, 1);
  assert(read('js/native/live-workout.js').includes('ready: cardioReady'), 'the real session waits for state.loaded.cardio');
});

test('#254 the Keep / Discard sheet: Keep first and focused, Discard asks again', () => {
  const src = read('js/native/stray-prompt.js');
  assert(src.includes('Discard this') && src.includes('won’t be saved to Forge or Apple Health') && src.includes('Go back'), 'discard confirm copy');
  assert(src.indexOf('data-keep') > -1 && src.includes("focusSoon('[data-keep]')"), 'Keep takes first focus');
  assert(src.includes('onclick = confirmDrop'), 'Discard opens the confirm, not the end');
});

test('#254 Swift: one recovery at a time, and the Live Activity comes back', () => {
  const sw = read('ios/App/App/ForgeLiveWorkout.swift');
  assert(sw.includes('recovering') && sw.includes('startActivity()'), 'recovering flag and startActivity after recover');
});
