// The app lock (iPhone app only): Face ID, falling back to the device passcode. Covers a cold launch and a resume after the
// chosen timeout. While the app is not in front it is covered by a blurred shield, so the app-switcher snapshot never shows
// a photo. The web app/PWA has no Face ID, so everything here is a no-op there.
//
// "No flash": js/lock-boot.js (a plain script in <head>) puts `app-locked` on <html> before the first paint when the lock is
// on, and css/lock.css hides everything but #lock while that class is there. This module takes it from there.
import { isNative, plugin } from './bridge.js';

const KEY = 'forge.lock';
export const TIMEOUTS = [
  { ms: 0, label: 'Immediately' },
  { ms: 60000, label: '1 min' },
  { ms: 300000, label: '5 min' },
];

/** What's saved on this phone: { enabled, timeout (ms), asked }. The lock belongs to the phone, not to an account. */
export function readSettings(store = localStorage) {
  let s = null;
  try { s = JSON.parse(store.getItem(KEY) || 'null'); } catch { /* unreadable: defaults */ }
  const t = s && TIMEOUTS.some((o) => o.ms === s.timeout) ? s.timeout : 0;
  return { enabled: !!(s && s.enabled), timeout: t, asked: !!(s && s.asked) };
}

export function writeSettings(patch, store = localStorage) {
  const next = { ...readSettings(store), ...patch };
  try { store.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: lives until the app closes */ }
  return next;
}

/** After leaving the app at `hiddenAt`, is it time to lock on coming back? */
export const shouldLock = (settings, hiddenAt, now) =>
  !!settings.enabled && (hiddenAt == null || now - hiddenAt >= settings.timeout);

/** How the device answered: 'ok' | 'cancel' (backed out) | 'failed' | 'unavailable' (no Face ID and no passcode). */
export function outcomeOf(err) {
  if (!err) return 'ok';
  const code = String(err.code ?? '');
  const msg = String(err.message || err).toLowerCase();
  if (code === '11' || code === '15' || code === '16' || /cancel/.test(msg)) return 'cancel'; // app, system, user
  if (code === '14' || /passcode (is )?not set/.test(msg)) return 'unavailable'; // the plugin's PASSCODE_NOT_SET
  return 'failed';
}

/** The device side. `bio` is the NativeBiometric plugin (or a stub in tests). */
export function createDevice(bio = plugin('NativeBiometric')) {
  return {
    supported: () => !!bio,
    /** Face ID or a device passcode is set up. */
    async available() {
      if (!bio) return false;
      try { return !!(await bio.isAvailable({ useFallback: true })).isAvailable; } catch { return false; }
    },
    /** Face ID first; the passcode button on the same prompt is the fallback. */
    async verify(reason = 'Unlock Forge') {
      if (!bio) return 'unavailable';
      try {
        await bio.verifyIdentity({ reason, title: 'Unlock Forge', useFallback: true, fallbackTitle: 'Use passcode', maxAttempts: 3 });
        return 'ok';
      } catch (e) { return outcomeOf(e); }
    },
  };
}

/**
 * The state machine. `view.show('locked' | 'shield')` / `view.hide()` draw it. States: 'off', 'locked', 'shield' (away or
 * covered, still unlocked), 'unlocked'. Everything is injected so the tests can drive it.
 */
export function createLock({ device, view, store, now = Date.now } = {}) {
  let state = 'off';
  let hiddenAt = null;
  let authing = false;
  let waiters = [];
  const settings = () => readSettings(store);
  const set = (s) => {
    state = s;
    if (s === 'locked') view.show('locked');
    else if (s === 'shield') view.show('shield');
    else view.hide();
    if (s === 'unlocked' || s === 'off') { const w = waiters; waiters = []; w.forEach((f) => f()); }
  };

  const api = {
    get state() { return state; },
    /** True while the Face ID prompt is up; the app must not reload under it. */
    get busy() { return authing; },
    /** Resolves once the app is not locked (immediately when it isn't). */
    whenUnlocked: () => (state === 'locked' || state === 'shield' ? new Promise((r) => waiters.push(r)) : Promise.resolve()),

    /** Cold launch (and every reload): locked before anything is drawn when the lock is on. */
    start() {
      if (!settings().enabled) { set('off'); return state; }
      set('locked');
      api.unlock();
      return state;
    },

    /** The prompt. Resolves to the outcome; stays locked unless it's 'ok'. */
    async unlock() {
      if (state !== 'locked' || authing) return null;
      authing = true;
      view.error('');
      let out;
      try { out = await device.verify('Unlock Forge'); } finally { authing = false; }
      hiddenAt = null;
      if (out === 'ok') { set('unlocked'); return out; }
      if (out === 'unavailable') {
        // No Face ID and no passcode on the phone: nobody is being kept out, and locking you out for good helps no one.
        set('unlocked');
        return out;
      }
      view.error(out === 'cancel' ? '' : 'That didn’t work. Try again.');
      return out;
    },

    /** The app left the front (inactive or backgrounded). The Face ID prompt itself does this too, so it's ignored. */
    away() {
      if (authing || !settings().enabled) return;
      if (state === 'unlocked') { hiddenAt = now(); set('shield'); }
    },

    /** Back in front. */
    back() {
      if (authing || !settings().enabled) return;
      if (state === 'shield') {
        if (shouldLock(settings(), hiddenAt, now())) { set('locked'); api.unlock(); } else { hiddenAt = null; set('unlocked'); }
      } else if (state === 'locked') api.unlock();
    },

    /** Face ID/passcode for a sensitive step (turning the lock off). → true when the person is who they say. */
    async confirm(reason = 'Confirm it’s you') {
      if (authing) return false;
      authing = true;
      try { return (await device.verify(reason)) === 'ok'; } finally { authing = false; }
    },

    /** Turn the lock on: checks that Face ID or a passcode works first. → 'ok' | 'unavailable' | 'cancel' | 'failed'. */
    async enable() {
      if (!(await device.available())) return 'unavailable';
      if (authing) return 'failed';
      authing = true;
      let out;
      try { out = await device.verify('Turn on the Forge lock'); } finally { authing = false; }
      if (out !== 'ok') return out;
      writeSettings({ enabled: true, asked: true }, store);
      set('unlocked');
      return 'ok';
    },

    /** Turn the lock off: needs Face ID/passcode. → true when it is off now. */
    async disable() {
      if (!settings().enabled) return true;
      if (!(await api.confirm('Turn off the Forge lock'))) return false;
      writeSettings({ enabled: false }, store);
      set('off');
      return true;
    },

    setTimeoutMs(ms) { writeSettings({ timeout: ms }, store); },
  };
  return api;
}

// ---------- the real thing ----------
const root = () => document.documentElement;

/** Draws the lock on the page: classes on <html> (css/lock.css) and the markup of #lock in index.html. */
export function pageView() {
  const el = () => document.getElementById('lock');
  const inertBehind = (on) => {
    for (const c of document.body.children) {
      if (c.id === 'lock' || /^(SCRIPT|NOSCRIPT)$/.test(c.tagName)) continue;
      if (on) c.setAttribute('inert', ''); else c.removeAttribute('inert');
    }
  };
  return {
    show(mode) {
      root().classList.toggle('app-locked', mode === 'locked');
      root().classList.toggle('app-shield', mode === 'shield');
      inertBehind(true);
      // Sheets and dialogs sit in the top layer above everything; close them so nothing shows through.
      if (mode === 'locked') import('../ui/sheets.js').then((m) => m.closeAllSheets()).catch(() => {});
      if (mode === 'locked') document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch { /* gone */ } });
      const e = el();
      if (e) e.setAttribute('aria-hidden', mode === 'locked' ? 'false' : 'true');
      if (mode === 'locked' && e) { const b = e.querySelector('[data-unlock]'); if (b) b.focus({ preventScroll: true }); }
    },
    hide() {
      root().classList.remove('app-locked', 'app-shield');
      inertBehind(false);
      const e = el();
      if (e) e.setAttribute('aria-hidden', 'true');
    },
    error(msg) {
      const e = el() && el().querySelector('[data-lock-error]');
      if (e) e.textContent = msg;
    },
  };
}

let current = null;
export const appLock = () => current;

/** True in the iPhone app: the Settings row and the first-run ask only exist there. */
export const lockSupported = () => isNative() && !!plugin('NativeBiometric');

/** Boot: call as early as possible. Safe on the web (does nothing). */
export function setupLock() {
  if (current || !isNative()) return current;
  const view = pageView();
  current = createLock({ device: createDevice(), view, store: localStorage });
  const btn = document.querySelector('#lock [data-unlock]');
  if (btn) btn.addEventListener('click', () => current.unlock());
  current.start();
  const App = plugin('App');
  if (App && App.addListener) {
    try {
      const h = App.addListener('appStateChange', (s) => (s && s.isActive ? current.back() : current.away()));
      if (h && h.catch) h.catch(() => {});
    } catch { /* the page events below cover it */ }
  }
  // Fallbacks (and the web view's own signal): the page being hidden or shown again.
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? current.back() : current.away()));
  window.addEventListener('pagehide', () => current.away());
  return current;
}
