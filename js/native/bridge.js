// The native iPhone app (Capacitor shell, docs/ios-setup.md) and the web app run the same code. Everything
// native goes through this file: in a browser every function here is a harmless no-op, so the web app is
// unchanged. Plugins are reached through the Capacitor runtime the shell injects (window.Capacitor), so the
// app still needs no build step or bundler.
//
// Plugins used (installed in the shell, see package.json): Filesystem + Share (js/native/share.js), Haptics, LocalNotifications, StatusBar, Browser, SplashScreen, Keyboard,
// @capgo/capacitor-health (HealthKit; see js/native/health.js) and @capgo/capacitor-native-biometric (the Face ID lock; js/native/lock.js).

const cap = () => (typeof window !== 'undefined' && window.Capacitor) || null;

/** True inside the iPhone app, false in Safari or on the desktop. */
export const isNative = () => {
  const c = cap();
  try { return !!(c && (c.isNativePlatform ? c.isNativePlatform() : c.platform && c.platform !== 'web')); } catch { return false; }
};

/** A native plugin by its registered name, or null. Never throws. */
export function plugin(...names) {
  const c = cap();
  if (!c || !isNative()) return null;
  for (const n of names) {
    try {
      if (c.isPluginAvailable && !c.isPluginAvailable(n)) continue;
      if (c.Plugins && c.Plugins[n]) return c.Plugins[n];
      if (c.registerPlugin) return c.registerPlugin(n);
    } catch { /* try the next name */ }
  }
  return null;
}

const quiet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); return p; };

// ---------- haptics (the Taptic Engine, not the iOS switch trick) ----------
const IMPACT = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
const NOTIFY = { success: 'SUCCESS', warning: 'WARNING', error: 'ERROR' };

/** kind: 'light' | 'medium' | 'heavy' (a tap), 'success' | 'warning' | 'error' (an outcome), 'select' (a picker tick). */
let selecting = false; // iOS only makes the selection generator in selectionStart(); selectionChanged() does nothing without it
export function haptic(kind = 'light') {
  const H = plugin('Haptics');
  if (!H) return false;
  if (kind === 'select' && H.selectionChanged && !selecting) { selecting = true; quiet(H.selectionStart && H.selectionStart()); }
  if (NOTIFY[kind]) quiet(H.notification({ type: NOTIFY[kind] }));
  else if (kind === 'select') quiet(H.selectionChanged ? H.selectionChanged() : H.impact({ style: 'LIGHT' }));
  else quiet(H.impact({ style: IMPACT[kind] || 'LIGHT' }));
  return true;
}

// ---------- the rest timer on the lock screen ----------
export const REST_NOTIFICATION_ID = 4101;
let scheduledEnd = null;
let asked = false;

async function notifications() {
  const N = plugin('LocalNotifications');
  if (!N) return null;
  if (!asked) {
    asked = true;
    try {
      const p = await N.checkPermissions();
      if (p && p.display !== 'granted') await N.requestPermissions();
    } catch { /* the rest timer still works in the app */ }
  }
  return N;
}

/**
 * Keep one "Rest's over" notification in step with the rest timer: scheduled for `endMs` (ms since epoch), or
 * cancelled when endMs is null (rest stopped, paused or over). Same end time → nothing to do.
 */
let wanted = { end: null, title: '', body: '' }; // the latest request; calls run one at a time and apply it
let chain = Promise.resolve(true);

export function syncRestNotification(endMs, { title = 'Rest’s over', body = 'Time for your next set.' } = {}) {
  if (!isNative()) return Promise.resolve(false);
  const end = Number.isFinite(endMs) && endMs > Date.now() + 2000 ? Math.round(endMs / 1000) * 1000 : null;
  wanted = { end, title, body };
  // One at a time, each applying the newest request, so a quick skip after a start can't leave a stale notification.
  chain = chain.then(() => applyRest(), () => applyRest());
  return chain;
}

async function applyRest() {
  const { end, title, body } = wanted;
  if (end === scheduledEnd) return true;
  const N = await notifications();
  if (!N) return false;
  try {
    if (scheduledEnd != null) await N.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
    scheduledEnd = null;
    if (end != null) {
      await N.schedule({ notifications: [{ id: REST_NOTIFICATION_ID, title, body, schedule: { at: new Date(end), allowWhileIdle: true } }] });
      scheduledEnd = end;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------- "refresh the app" reminder (free Apple ID: the app stops opening after 7 days) ----------
export const EXPIRY_NOTIFICATION_ID = 4102;

/** The notification plugin only if notifications are already allowed. Never shows the iOS prompt. */
async function notificationsIfGranted() {
  const N = plugin('LocalNotifications');
  if (!N) return null;
  try {
    const p = await N.checkPermissions();
    return p && p.display === 'granted' ? N : null;
  } catch {
    return null;
  }
}

/**
 * Schedule (atMs) or cancel (null) the one local notification that says the app needs its weekly refresh.
 * Quiet by default: unless notifications are already allowed it does nothing (no prompt at boot).
 * `ask: true` is for a tap on "Remind me", which asks in context first.
 */
export async function scheduleExpiryReminder(atMs, { ask = false } = {}) {
  if (!isNative()) return false;
  let N = await notificationsIfGranted();
  if (!N && ask) {
    const P = plugin('LocalNotifications');
    try {
      if (P && (await P.requestPermissions()).display === 'granted') N = P;
    } catch { /* stays off */ }
  }
  if (!N) return false;
  try {
    await N.cancel({ notifications: [{ id: EXPIRY_NOTIFICATION_ID }] });
    if (atMs != null) {
      await N.schedule({ notifications: [{ id: EXPIRY_NOTIFICATION_ID, title: 'Forge needs its weekly refresh',
        body: 'Plug your iPhone into the Mac mini and double-click Refresh Forge.', schedule: { at: new Date(atMs), allowWhileIdle: true } }] });
    }
    return true;
  } catch {
    return false;
  }
}

// ---------- links that leave the app (Withings sign-in) ----------
/** Open a web page over the app (Safari view): you come straight back when you close it. False on the web. */
export function openExternal(url) {
  const B = plugin('Browser');
  if (!B) return false;
  quiet(B.open({ url, presentationStyle: 'popover' }));
  return true;
}

// ---------- launch splash ----------
/** Take the launch splash down (it stays up until the app calls this: capacitor.config.json → launchAutoHide: false). */
export function hideSplash() {
  const S = plugin('SplashScreen');
  if (!S) return false;
  quiet(S.hide({ fadeOutDuration: 200 }));
  return true;
}

// ---------- keyboard ----------
/**
 * The web view itself shrinks above the keyboard (capacitor.config.json → Keyboard.resize: "native"), so bottom
 * sheets and the set entry sit on top of it; here the focused field is scrolled to the middle of what's left.
 * The key bar above the keyboard stays on deliberately: its Done button is the only way to put away a number pad.
 */
export function setupKeyboard() {
  const K = plugin('Keyboard');
  if (!K) return false;
  quiet(K.setAccessoryBarVisible({ isVisible: true }));
  const reveal = () => {
    const a = document.activeElement;
    if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { a.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' }); } catch { /* old web view */ }
  };
  quiet(K.addListener('keyboardDidShow', () => setTimeout(reveal, 50)));
  return true;
}

// ---------- status bar ----------
/** Light text on the dark theme, dark text on the light one. */
export function syncStatusBar(dark) {
  const S = plugin('StatusBar');
  if (!S) return false;
  quiet(S.setStyle({ style: dark ? 'DARK' : 'LIGHT' }));
  return true;
}
