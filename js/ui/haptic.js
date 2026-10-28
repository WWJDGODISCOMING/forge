// Haptics on iPhone.
// Safari has no navigator.vibrate. Since iOS 18, a real tap on a native switch control
// (<input type="checkbox" switch>) gives a system haptic tick. So big action buttons (Done set) are labels
// with an invisible switch laid over them: your finger taps the switch itself, iOS ticks, and we listen for
// its `change` event. Where switches aren't supported it's a plain invisible checkbox, so the button still
// works, just without the tick. Marked experimental; Settings → Haptic tick turns it off.
import { state } from '../state.js';
import { isNative, haptic as nativeHaptic } from '../native/bridge.js';

// In the iPhone app (js/native/bridge.js) the Taptic Engine is called directly, so the switch trick is off there.
const NATIVE = isNative();

const supportsSwitch = (() => {
  try {
    return 'switch' in document.createElement('input');
  } catch {
    return false;
  }
})();

export const hapticsOn = () => !state.settings || state.settings.haptics !== false;
export const hapticSupport = () => (NATIVE ? 'native' : supportsSwitch ? 'switch' : globalThis.navigator?.vibrate ? 'vibrate' : 'none');
const useSwitch = () => hapticsOn() && supportsSwitch && !NATIVE;
/** A native tap where the app can; true if it did. */
let lastTap = 0;
// When any haptic last fired, on the same clock as Event.timeStamp, so a delegated listener can tell whether a
// screen's own handler already ticked for the click it's looking at.
let lastFiredAt = -Infinity;
const now = () => globalThis.performance?.now?.() ?? Date.now();
/** Record that a haptic just fired. */
export const noteHaptic = () => { lastFiredAt = now(); };
/** True if a haptic has fired at or after `t` (an Event.timeStamp). */
export const hapticFiredSince = (t) => lastFiredAt >= t;
const nativeTap = (kind = 'light') => {
  const ok = NATIVE && hapticsOn() && nativeHaptic(kind);
  if (ok) { lastTap = Date.now(); noteHaptic(); }
  return ok;
};

/**
 * The haptic vocabulary. Each returns true if it fired. All are native-only and gated by Settings → Haptic tick,
 * except `select`, which may fall back to navigator.vibrate on browsers that have it.
 */
export const haptics = {
  select() {
    if (nativeTap('select')) return true;
    if (hapticsOn() && !NATIVE && globalThis.navigator?.vibrate) { navigator.vibrate(10); noteHaptic(); return true; }
    return false;
  },
  light: () => nativeTap('light'),
  medium: () => nativeTap('medium'),
  success: () => nativeTap('success'),
  heavy: () => nativeTap('heavy'),
  warning: () => nativeTap('warning'),
  /** A big win (PR, badge): a heavy thud (at least 150 ms after any tap before it), then success 120 ms later. */
  win() {
    if (!NATIVE || !hapticsOn()) return false;
    const wait = Math.max(0, lastTap + 150 - Date.now());
    setTimeout(() => {
      nativeTap('heavy');
      setTimeout(() => nativeTap('success'), 120);
    }, wait);
    return true;
  },
};

/** A light tap in the iPhone app only (quick-log open and pick); the web has no equivalent. */
export const lightTap = () => haptics.light();

/** The invisible control to put inside a <label class="haptic-btn">. Listen for `change` on it. */
export function hapticInput(attrs = '') {
  return `<input type="checkbox" ${useSwitch() ? 'switch' : ''} class="haptic-input" ${attrs}>`;
}

/** A light tick where the browser has navigator.vibrate (not iPhone Safari: there only a real tap on a switch ticks). */
export function tick() {
  haptics.select();
}

/**
 * Give a tappable element the invisible-switch trick: a real finger tap on the switch ticks on iOS 18+, and
 * `fn(host)` runs once per tap. Programmatic clicks don't tick, so this only helps for direct taps.
 */
function addSwitch(host, fn) {
  let input = host.querySelector(':scope > .haptic-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'haptic-input';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', () => {
      input.checked = false;
      nativeTap('select');
      fn(host);
    });
    host.appendChild(input);
  }
  // Settings → Haptic tick can change at any time, so the `switch` attribute follows it.
  if (useSwitch()) input.setAttribute('switch', '');
  else input.removeAttribute('switch');
}

/** Tab bar: a tap on a tab is a switch tap. `onTab(link)` decides what to do (change tab, scroll to top). */
export function hapticTabs(nav, onTab) {
  nav.querySelectorAll('a').forEach((a) => addSwitch(a, onTab));
}

/** Segmented controls inside root: choosing a segment ticks, then picks it exactly as a normal tap would. */
export function hapticSegments(root) {
  root.querySelectorAll('.seg > label').forEach((label) => addSwitch(label, () => {
    const radio = label.querySelector('input[type=radio]');
    if (radio && !radio.checked) radio.click();
  }));
  root.querySelectorAll('.progress-seg > a').forEach((a) => addSwitch(a, () => { location.hash = a.getAttribute('href'); }));
}

/** Wire a haptic button: fn runs once per real tap. */
export function onHapticTap(input, fn) {
  if (!input) return;
  input.addEventListener('change', (e) => {
    input.checked = false;
    if (!nativeTap('medium') && globalThis.navigator?.vibrate && hapticsOn()) navigator.vibrate(12);
    fn(e);
  });
}
