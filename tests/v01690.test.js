// v0.16.90 (#252): Apple Watch workouts import on open/resume/pull; sign-out keeps auto-read; failures retry. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { workoutsDue, workoutsSince, WORKOUTS_EVERY_MS, WORKOUTS_RETRY_MS, autoReadMode, looksConnected, needsReconnect, mayAutoRead, workoutsKey, workoutsFailedKey, nativeReadKey } from '../js/native/autoread.js';
import { clearPersonalKeys } from '../js/signout.js';
import { planWorkoutImport } from '../js/health/apple-workouts.js';
import { shiftDay } from '../js/health/metrics.js';

const store = (init) => {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => { m.delete(k); }, keys: () => [...m.keys()].sort() };
};

test('a full read under 6 h old still triggers a workout read on resume', () => {
  const now = new Date('2026-10-29T15:00:00');
  const last = now.getTime() - 60 * 60 * 1000;
  eq(autoReadMode({ now, last, today: '2026-10-29', rows: [{ id: '2026-10-29', sleep: { asleep_min: 400 } }] }), null); // no full read...
  assert(workoutsDue({ now, at: now.getTime() - WORKOUTS_EVERY_MS })); // ...but the workout read is due
  assert(!workoutsDue({ now, at: now.getTime() - 1000 }));
});

test('workouts read from the later of last read − 1 day and today − 3', () => {
  const lr = new Date('2026-10-29T08:00:00').getTime();
  eq(workoutsSince({ lastRead: lr, today: '2026-10-29', shift: shiftDay }), '2026-10-28');
  eq(workoutsSince({ lastRead: new Date('2026-10-01T08:00:00').getTime(), today: '2026-10-29', shift: shiftDay }), '2026-10-26');
  eq(workoutsSince({ lastRead: 0, today: '2026-10-29', shift: shiftDay }), '2026-10-26');
});

test('sign-out keeps the uid-scoped Apple Health stamps, so sign-in keeps auto-read working', () => {
  const s = store({ [nativeReadKey('u1')]: '123', [workoutsKey('u1')]: '5', [workoutsFailedKey('u1')]: '6', 'forge.energy.u1': '{}' });
  clearPersonalKeys(s);
  eq(s.keys().join(), [nativeReadKey('u1'), workoutsKey('u1'), workoutsFailedKey('u1')].sort().join());
});

test('a phone with Apple Health rows counts as connected even without the stamp', () => {
  assert(looksConnected({ health: [{ id: '2026-10-28' }] }));
  assert(looksConnected({ cardio: [{ source: 'apple_health' }] }));
  assert(!looksConnected({}));
});

test('after a failed workout read the retry comes within 20 minutes', () => {
  const now = new Date('2026-10-29T15:00:00');
  assert(WORKOUTS_RETRY_MS <= 20 * 60 * 1000);
  assert(!workoutsDue({ now, at: now.getTime() - 60 * 1000, failedAt: now.getTime() - 60 * 1000 }));
  assert(workoutsDue({ now, at: now.getTime() - WORKOUTS_RETRY_MS, failedAt: now.getTime() - WORKOUTS_RETRY_MS }));
});

test('an outdoor 90 min Watch walk becomes an hk_ walk row with the local day', () => {
  const w = { platformId: 'WALK1', workoutType: 'walking', duration: 5400, startDate: '2026-10-29T18:30:00', endDate: '2026-10-29T20:00:00', totalEnergyBurned: 330, totalDistance: 6000, sourceName: 'Apple Watch', sourceId: 'com.apple.health.X', metadata: {} };
  const p = planWorkoutImport([w]);
  eq(p.create.length, 1);
  eq(p.create[0].id, 'hk_WALK1');
  eq(p.create[0].fields.activity, 'walk');
  eq(p.create[0].fields.day, new Date('2026-10-29T18:30:00').toLocaleDateString('en-CA'));
});

const appleSrc = () => readFileSync(new URL('../js/screens/apple.js', import.meta.url), 'utf8');

test('no automatic read without this account stamp on this phone, even when Apple Health rows exist (privacy)', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => { mem.delete(k); } };
  try {
    assert(looksConnected({ health: [{ id: '2026-10-28' }] }));
    assert(!mayAutoRead('wife'), 'no stamp: no auto read');
    mem.set(nativeReadKey('husband'), '123');
    assert(mayAutoRead('husband') && !mayAutoRead('wife'), 'the stamp is per account');
  } finally { delete globalThis.localStorage; }
  const src = appleSrc();
  assert(!/looksConnected/.test(src), 'apple.js never reads on looksConnected');
  assert(/export async function refreshWorkouts[\s\S]*?!lastNative\(\)\) return null/.test(src), 'quick workout read needs lastNative()');
  assert(/export async function autoHealthSync[\s\S]*?if \(!lastNative\(\)\) return null/.test(src), 'auto read needs lastNative()');
});

test('the Settings prompt shows when rows exist but this phone has no stamp for the account', () => {
  const rows = { health: [{ id: '2026-10-28' }], cardio: [] };
  assert(needsReconnect({ last: 0, ...rows }), 'prompt without a stamp');
  assert(!needsReconnect({ last: 123, ...rows }), 'no prompt once connected here');
  assert(!needsReconnect({ last: 0, health: [], cardio: [] }), 'a brand-new account sees the normal Connect button');
  const src = appleSrc();
  assert(src.includes('data-native-reconnect') && src.includes('isn’t reading automatically on this iPhone') && src.includes('Turn Apple Health back on'));
  assert(!src.includes('Refresh Forge'), 'no developer wording');
});

test('a tap during an auto read says it is busy, not that it failed', () => {
  const src = appleSrc();
  assert(src.includes("return 'busy'") && src.includes("n === 'busy'"));
});
