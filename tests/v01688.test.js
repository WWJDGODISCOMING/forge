// v0.16.88 (#247): sign-out wipes per-user data and always reaches signOut().
import { test, eq, assert } from './harness.js';
import { signOutCleanly, clearPersonalKeys, DEVICE_KEYS } from '../js/signout.js';

const fakeStore = (init) => {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()].sort(),
  };
};
const seed = () => fakeStore({
  'forge.energy.u1': '{}', 'forge.live': '{}', 'forge.rest': '{}', 'forge.lastSeen.w1': '1',
  'forge.readiness.override': '2026-10-29', 'forge.proteinHelper.u1': 'x', 'forge.reminders.u1': 'x',
  'forge.withings.csvRows': '3', 'forge.lock': '{"on":true}', 'forge.seen': '1', 'other.key': 'keep',
});
const run = async (over = {}) => {
  const calls = [];
  const storage = seed();
  const mark = (n) => async () => { calls.push(n); };
  await signOutCleanly({
    storage: () => storage, flush: mark('flush'), stopRest: mark('rest'), stopLive: mark('live'),
    clearReminders: mark('rem'), clearAiPlans: mark('ai'), clearWidget: mark('widget'),
    signOut: mark('signOut'), clearLocalCache: mark('cache'), reload: () => calls.push('reload'), ...over,
  });
  return { calls, storage };
};

test('signOutCleanly leaves only device keys', async () => {
  const { storage } = await run();
  const left = storage.keys();
  assert(left.every((k) => k === 'other.key' || DEVICE_KEYS.includes(k)), left.join());
  eq(left.join(), 'forge.lock,forge.seen,other.key');
});

test('signOutCleanly runs signOut, then clearLocalCache, then reload', async () => {
  const { calls } = await run();
  eq(calls.slice(-3).join(), 'signOut,cache,reload');
});

test('a rejected step still reaches signOut and the cache wipe', async () => {
  const boom = async () => { throw new Error('import failed'); };
  const { calls, storage } = await run({ clearAiPlans: boom, stopLive: boom, flush: boom });
  assert(calls.includes('signOut') && calls.includes('cache') && calls.includes('reload'));
  eq(storage.getItem('forge.energy.u1'), null);
});

test('clearPersonalKeys ignores a broken store', () => {
  eq(clearPersonalKeys({ get length() { throw new Error('x'); } }).length, 0);
});
