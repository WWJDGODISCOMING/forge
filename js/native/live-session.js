// The live workout session logic, with everything it touches passed in (the native plugin, storage, the clock, the
// settings and where the finished row goes). That keeps it free of Firebase and the DOM, so tests/v01659.test.js can run
// discard, end, restore and the native clean-up for every kind (jog, walk, run) against a mock plugin.
// js/native/live-workout.js wires the real parts. Nothing here throws: a failed native call just means Forge-only.
import { newLive, pauseLive, resumeLive, endLive, liveToCardio, adoptNativePauses, endPayload, LIVE_KINDS } from '../workouts/live-core.js';

export const KEY = 'forge.live';
export const NATIVE_WAIT_MS = 4000; // a native call that never answers must not keep a workout alive
const EMPTY = () => ({ kcal: 0, distanceM: 0, hr: null, nativeLive: false, activity: false });

/**
 * deps: plugin() → the ForgeWorkouts plugin or null · storage() → localStorage-like or null · now() → ms
 *       updateRow(row) → patches that row with the Health numbers (default saveRow) · weightKg() → number|null · settings() → settings doc · cardio() → saved cardio rows · miles() → bool
 *       saveRow(row) → writes the finished cardio row · waitMs → cap on any native call
 *       ready() → true (or a promise of it) once the saved cardio rows are loaded: a recovered workout is judged against them
 */
export function createLiveSession(deps) {
  const d = { now: Date.now, waitMs: NATIVE_WAIT_MS, weightKg: () => null, settings: () => null, cardio: () => [], miles: () => false, saveRow: () => {}, updateRow: null, ready: () => true, storage: () => null, plugin: () => null, ...deps };
  d.updateRow = d.updateRow || d.saveRow; // patches the row written at End with what the phone measured
  let session = null;
  let metrics = EMPTY();
  let handle = null;
  let capped = null; // { id, payload }: a workout whose native end timed out, so the phone may still be running it
  let reconciling = null;
  let stray = null; // the phone's snapshot of a workout Forge lost track of that has real data: waits for Save / Discard
  const listeners = new Set();
  const gone = new Set(); // ids of workouts that were ended or discarded: nothing may bring them back

  /** Wait for a native call, but never longer than `ms`. → { value, timedOut }. Never throws. */
  const quick = (promise, ms = d.waitMs) => new Promise((resolve) => {
    const t = setTimeout(() => resolve({ value: null, timedOut: true }), ms);
    Promise.resolve(promise).then((value) => { clearTimeout(t); resolve({ value, timedOut: false }); }, () => { clearTimeout(t); resolve({ value: null, timedOut: false }); });
  });
  const call = (p, name, ...args) => { try { return typeof p[name] === 'function' ? p[name](...args) : null; } catch { return null; } };

  // Native endLive calls that haven't settled yet. The phone keeps reporting a workout until its end finishes, and a
  // second endLive on the same HealthKit builder could double-save or throw, so nothing sends another while one is out.
  let endsInFlight = 0;
  /** endLive with the cap. → { value, timedOut }. A timed-out call stays counted until the phone finally answers. */
  function endNative(p, payload, onSettled) {
    const raw = call(p, 'endLive', payload);
    endsInFlight += 1;
    Promise.resolve(raw).then((v) => v, () => null).then((v) => { endsInFlight -= 1; if (onSettled) onSettled(v); });
    return quick(raw);
  }

  const emit = () => listeners.forEach((fn) => { try { fn(session, metrics); } catch { /* a screen went away */ } });
  function save() {
    const s = d.storage();
    if (!s) return;
    try { if (session && !session.ended_at) s.setItem(KEY, JSON.stringify({ session, metrics })); else s.removeItem(KEY); } catch { /* private mode */ }
  }

  const isActive = () => !!(session && !session.ended_at);

  function onNative(e) {
    if (!session || !e || (e.id && e.id !== session.id)) return; // nothing running here, or an event for another workout
    const at = Number(e.at) || d.now();
    if (Array.isArray(e.pauses)) session = adoptNativePauses(session, e); // the phone saw every pause, even ones while we were in the background
    else if (e.paused === true) session = pauseLive(session, at);
    else if (e.paused === false) session = resumeLive(session, at);
    metrics = {
      ...metrics,
      failed: e.failed === true ? true : metrics.failed,
      kcal: Number.isFinite(e.kcal) ? e.kcal : metrics.kcal,
      distanceM: Number.isFinite(e.distanceM) ? e.distanceM : metrics.distanceM,
      hr: Number.isFinite(e.hr) && e.hr > 0 ? e.hr : metrics.hr,
    };
    save();
    emit();
  }

  function attach() {
    const p = d.plugin();
    if (!p || handle || !p.addListener) return;
    try { handle = p.addListener('liveUpdate', onNative); } catch { handle = null; }
  }

  /**
   * The phone may still hold a workout (HealthKit session + Live Activity) that Forge no longer knows about: a native
   * end that timed out, or the web view's storage lost. If Forge has no live workout but the phone reports one, end it.
   * Nothing is saved to Health unless it is the very workout Forge just finished (and then with the same payload).
   * → 'ended' | 'none'. Safe to call any time, any number of times.
   */
  function reconcile({ wait = d.waitMs } = {}) {
    if (reconciling) return reconciling;
    reconciling = (async () => {
      const p = d.plugin();
      if (isActive() || endsInFlight > 0 || !p || typeof p.liveState !== 'function' || typeof p.endLive !== 'function') return 'none'; // an end already out: wait for it
      const r = (await quick(call(p, 'liveState'), wait)).value;
      if (isActive() || endsInFlight > 0 || !r || typeof r !== 'object' || r.ending || !Object.keys(r).length) return 'none'; // nothing running on the phone, one already ending, or JS started one meanwhile
      // The phone's snapshot carries an id on newer builds; without one, the only thing it can be is the workout that just timed out, or a stray.
      const mine = capped && (!r.id || r.id === capped.id);
      if (!mine && Number(r.elapsed) > 60000) { // a recovered workout with real data: ask, never discard it quietly (#254)
        let known = false;
        if (r.id) { try { known = await knownId(r.id); } catch { return 'none'; } } // rows not loaded yet: don't judge against an empty list, a later call decides
        if (isActive() || endsInFlight > 0) return 'none';
        if (known) return savedStray(p, r); // already in History (killed during "Saving…"): finish it quietly, no question
        stray = { ...r };
        listeners.forEach((fn) => { try { fn(session, metrics); } catch { /* a screen went away */ } });
        return 'stray';
      }
      const payload = mine ? capped.payload : { save: false };
      const id = mine ? capped.id : null;
      const res = await endNative(p, payload, () => { if (id && capped && capped.id === id) capped = null; });
      if (!res.timedOut) capped = null;
      return 'ended';
    })().finally(() => { reconciling = null; });
    return reconciling;
  }

  /** True when this id is already a saved row (its id or live_id) or was ended here. Waits for the rows to load; false (undecided) when they never do. */
  async function knownId(id) {
    if (gone.has(id)) return true;
    const ok = await Promise.race([Promise.resolve(d.ready()).catch(() => false), new Promise((res) => setTimeout(() => res(false), Math.max(d.waitMs * 3, 1)))]);
    if (!ok) throw new Error('rows not loaded');
    return (d.cardio() || []).some((c) => c && (c.id === id || c.live_id === id));
  }

  /** The phone still holds a walk whose row is already in History: end it with save:true, no question. → 'saved' */
  async function savedStray(p, r) {
    const ended = endLive(strayToSession(r), d.now());
    const payload = endPayload(ended, { weightKg: d.weightKg(), settings: d.settings() });
    const id = r.id;
    gone.add(id);
    const res = await endNative(p, payload, () => { if (capped && capped.id === id) capped = null; });
    if (res.timedOut) { capped = { id, payload }; return 'saved'; }
    const saved = res.value;
    if (saved && typeof saved === 'object' && Object.keys(saved).length && (d.cardio() || []).some((c) => c && c.id === id)) {
      d.updateRow(liveToCardio(Array.isArray(saved.pauses) ? adoptNativePauses(ended, saved) : ended, { hk: saved, weightKg: d.weightKg() }));
    }
    return 'saved';
  }

  // restore() runs on every Train and Today draw, so its check of the phone is rate-limited.
  const RECONCILE_EVERY_MS = 30000;
  let lastSoon = -Infinity;
  function reconcileSoon() {
    const t = d.now();
    if (t - lastSoon < RECONCILE_EVERY_MS) return;
    lastSoon = t;
    reconcile().catch(() => {});
  }

  /** Pick up a workout left running (the app was closed or reloaded). Safe to call any number of times. */
  function restore() {
    if (session) return session;
    const s = d.storage();
    try {
      const raw = s && s.getItem(KEY);
      if (raw) {
        const o = JSON.parse(raw);
        const ok = o && o.session && LIVE_KINDS[o.session.kind] && !o.session.ended_at && !gone.has(o.session.id);
        if (ok) { session = o.session; metrics = { ...metrics, ...o.metrics }; } else s.removeItem(KEY); // a stale or finished leftover is dropped, not revived
      }
    } catch { session = null; }
    if (session) attach(); else reconcileSoon(); // nothing here: make sure the phone isn't still running one
    return session;
  }

  /** Ask for Health access and start. → the session. Never throws. */
  async function start(kind) {
    if (isActive()) return session;
    await reconcile({ wait: Math.min(1500, d.waitMs) }); // a workout the phone still holds would make this start fail
    if (isActive()) return session;
    const at = d.now();
    session = newLive(kind, at);
    metrics = EMPTY();
    const mine = session.id;
    const p = d.plugin();
    if (p && p.startLive) {
      attach();
      try {
        if (p.requestAuthorization) await p.requestAuthorization();
        const k = LIVE_KINDS[session.kind];
        const r = await p.startLive({ id: mine, activityType: k.hk, indoor: k.indoor, miles: d.miles(), start: at, weightKg: d.weightKg() || 0 });
        if (!session || session.id !== mine) { // ended or discarded while the phone was still starting it: stop it now
          call(p, 'endLive', { save: false });
          return session;
        }
        metrics.nativeLive = true;
        metrics.activity = !!(r && r.liveActivity);
      } catch { /* kept in Forge only */ }
    }
    save();
    emit();
    return session;
  }

  async function pause() {
    if (!session) return;
    session = pauseLive(session, d.now());
    const p = d.plugin();
    if (p && metrics.nativeLive) await quick(call(p, 'pauseLive')); // the timer here is the truth
    save(); emit();
  }

  async function resume() {
    if (!session) return;
    session = resumeLive(session, d.now());
    const p = d.plugin();
    if (p && metrics.nativeLive) await quick(call(p, 'resumeLive'));
    save(); emit();
  }

  /** Finish: save to Apple Health (native) and to Forge once, without doubling. → { id, fields } or null when nothing was started. */
  async function finish() {
    if (!session) return null;
    let ended = endLive(session, d.now());
    const native = metrics.nativeLive;
    const weight = d.weightKg();
    const payload = endPayload(ended, { weightKg: weight, settings: d.settings() });
    gone.add(ended.id);
    session = null; // cleared first: from here nothing can restore it, whatever the native side does
    metrics = EMPTY();
    save(); emit();
    // The Forge row goes in FIRST, from the JS clock, before any native wait: if the phone locks or iOS kills the app
    // during "Saving…", History still has the walk. The Health numbers are patched in when the phone answers (#254).
    const first = liveToCardio(ended, { weightKg: weight });
    if (!(d.cardio() || []).some((c) => c.id === first.id)) d.saveRow(first);
    const p = d.plugin();
    if (!(p && native)) return first;
    const id = ended.id;
    const r = await endNative(p, payload, () => { if (capped && capped.id === id) capped = null; }); // answered late: the phone has ended it
    const saved = r.value;
    // Timed out: the phone may still be ending it. Remembered so a later launch or return to the front can retry, but
    // only once the first call has settled (reconcile() does nothing while it is out).
    if (r.timedOut) capped = { id, payload };
    if (!saved || typeof saved !== 'object' || !Object.keys(saved).length) return first;
    if (Array.isArray(saved.pauses)) ended = adoptNativePauses(ended, saved); // lock-screen pauses the screen never heard
    const row = liveToCardio(ended, { hk: saved, weightKg: weight });
    d.updateRow(row);
    return row;
  }

  /** A phone-held workout (more than a minute of data) that Forge lost track of, waiting for the user's choice, or null. */
  const pendingStray = () => stray;

  function strayToSession(r) {
    const k = r.kind && LIVE_KINDS[r.kind] ? r.kind : 'walk';
    const at = Number(r.startedAt) || (d.now() - (Number(r.elapsed) || 0));
    return { ...newLive(k, at, r.id || undefined), pauses: Array.isArray(r.pauses) ? r.pauses : [], pausedAt: r.paused ? (Number(r.pausedAt) || d.now()) : null };
  }

  /** Rebuild the lost workout from the phone's snapshot and carry on with it (the user chose to keep it). → the session or null. */
  function adoptStray() {
    const r = stray;
    if (!r || isActive()) return null;
    stray = null;
    session = strayToSession(r);
    metrics = { ...EMPTY(), nativeLive: true, kcal: r.kcal || 0, distanceM: r.distanceM || 0, hr: r.hr || null };
    attach(); save(); emit();
    return session;
  }

  /** The user chose Discard for a recovered workout: end it on the phone without saving. */
  async function dropStray() {
    stray = null;
    const p = d.plugin();
    if (p) await endNative(p, { save: false });
  }

  /** Throw the workout away (nothing is saved to Forge or Health). */
  async function discard() {
    const p = d.plugin();
    const native = metrics.nativeLive;
    if (session) gone.add(session.id);
    session = null; // cleared first, so the screen, the chips and a reload all see "no workout" at once
    metrics = EMPTY();
    save(); emit();
    capped = null;
    if (p && native) {
      await endNative(p, { save: false }); // stops the HealthKit session and the Live Activity; a timeout is retried by a later reconcile()
    }
  }

  /** Re-sync after the app comes back to the front: native may have paused it from the lock screen, or still hold a stray. */
  async function refresh() {
    const p = d.plugin();
    if (!session) { await reconcile(); return; }
    if (!p || !metrics.nativeLive || !p.liveState) return;
    const r = (await quick(call(p, 'liveState'))).value;
    if (r) onNative({ ...r, at: Number(r.at) || d.now() });
  }

  return {
    current: () => session,
    liveMetrics: () => metrics,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    isActive, restore, start, pause, resume, finish, discard, refresh, reconcile, pendingStray, adoptStray, dropStray,
  };
}
