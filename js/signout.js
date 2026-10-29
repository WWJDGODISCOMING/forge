// Sign out and leave nothing of the last person on the phone (#247). Every step is best effort: one failing
// (say a dynamic import offline) must never stop signOut() from running.

// Device-level keys that stay after sign-out: they describe this phone, not a person. Anything else that
// starts with "forge." is per user or per session and is wiped. A new key is wiped unless it is added here.
export const DEVICE_KEYS = [
  'forge.lock', // app lock settings (a device choice)
  'forge.lock.passUntil', // sessionStorage only; listed for completeness
  'forge.seen', // first-run tour was shown on this phone
  'forge.seenVersion', // last version seen (What's new)
  'forge.install.firstSeen', // install date, for the TestFlight/expiry notice
  'forge.nativeCleaned', // one-off native cleanup done
  'forge.library.collapsed', // library section layout
  'forge.rateSets', // "rate every set" switch
  'forge.photoTimer', // camera timer choice
];

/** Removes every "forge." key that is not a device key. Returns the keys removed. */
export function clearPersonalKeys(store, keep = DEVICE_KEYS) {
  const gone = [];
  try {
    const keys = [];
    for (let i = 0; i < store.length; i++) keys.push(store.key(i));
    for (const k of keys) {
      if (k && k.startsWith('forge.') && !keep.includes(k)) { store.removeItem(k); gone.push(k); }
    }
  } catch { /* storage unavailable */ }
  return gone;
}

const real = () => ({
  storage: () => { try { return globalThis.localStorage || null; } catch { return null; } },
  flush: () => import('./db.js').then((m) => m.flushWrites()),
  stopRest: () => import('./timer.js').then((m) => m.stopRest()),
  stopLive: () => import('./native/live-workout.js').then((m) => (m.isActive() ? m.discard() : null)),
  clearReminders: () => import('./reminders/store.js').then((m) => m.clearReminders()),
  clearAiPlans: () => import('./food/meal-ai.js').then((m) => m.clearAllAiPlans()),
  clearWidget: () => import('./native/widget.js').then((m) => m.clearWidget()),
  signOut: () => import('./auth.js').then((m) => m.signOut()),
  clearLocalCache: () => import('./db.js').then((m) => m.clearLocalCache()),
  reload: () => { location.hash = ''; location.reload(); },
});

/** The whole sign-out. `deps` is for tests. */
export async function signOutCleanly(deps = {}) {
  const d = { ...real(), ...deps };
  const best = async (fn) => { try { await fn(); } catch (e) { console.warn('sign-out step failed', e); } };
  await best(d.flush);
  await best(d.stopRest);
  await best(d.stopLive);
  await best(d.clearReminders);
  await best(d.clearAiPlans);
  await best(d.clearWidget);
  await best(() => { const s = d.storage(); if (s) clearPersonalKeys(s); });
  await best(d.signOut);
  await best(d.clearLocalCache);
  await best(() => { const s = d.storage(); if (s) clearPersonalKeys(s); }); // anything written while the steps above ran
  d.reload();
}
