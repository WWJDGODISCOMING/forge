// Haptics for taps on the data screens (v0.16.83, #234). One delegated listener and one table, so a screen
// doesn't need its own wiring. Only the vocabulary in haptic.js is used: select (segments, toggles, steppers),
// light (open a card, row or sheet), medium (start something), success (finish or save something) and warning
// (destructive). Haptics setting is respected inside `haptics`. The matching press-dip is in css/motion.css.
import { haptics, hapticFiredSince } from './haptic.js';

/** [selector, kind]. First match wins, so the specific rows come before the general ones. */
export const PRESS_HAPTICS = [
  // Destructive: warning
  ['[data-del]', 'warning'],
  ['[data-remove]', 'warning'],
  ['[data-rm]', 'warning'],
  ['[data-disconnect]', 'warning'],
  ['[data-notme], [data-notme-day]', 'warning'],
  ['[data-no]', 'warning'],
  // Completing or saving: success
  ['[data-do]', 'success'],
  ['[data-me]', 'success'],
  ['[data-save]', 'success'],
  ['[data-sync]', 'success'],
  ['[data-reimport]', 'success'],
  ['[data-connect]', 'success'],
  ['[data-review-all]', 'success'],
  ['[data-badge-dismiss]', 'success'],
  ['[data-ready-override], [data-ready-again]', 'success'],
  // Starting: medium
  ['[data-start], [data-take]', 'medium'],
  // Segments, toggles, steppers: select
  ['.seg label, .progress-seg a', 'select'],
  ['[data-pillar]', 'select'],
  ['.mg-btn', 'select'],
  ['[data-prev], [data-next]', 'select'],
  ['[data-effort]', 'select'],
  ['.chips .chip, .chips .chip-btn', 'select'],
  ['.aw-flip', 'select'],
  ['[data-ready-why], [data-weight-why]', 'select'],
  // Opening a card, row, sheet or screen: light
  ['[data-open], [data-more], [data-edit], [data-preset], [data-custom], [data-plates]', 'light'],
  ['[data-explain], [data-leg]', 'light'],
  ['[data-compare], [data-lapse], [data-share], [data-print], [data-ex], [data-new], [data-add], [data-log], [data-food-log]', 'light'],
  ['[data-ask], .coach-chip', 'light'],
  ['[data-tour-offer-show], [data-tour-offer-no]', 'light'],
  ['a.card, .nav-card, .trend-row, .dd-link, .ms-badge-links a, .ms-dot a', 'light'],
  ['li.tap', 'light'],
  ['.btn[href], a.link', 'light'],
];

/** The haptic kind for a tapped element, or null. Disabled controls and controls that already tick themselves give none. */
export function pressKind(target) {
  if (!target || !target.closest) return null;
  if (target.classList?.contains('haptic-input')) return null;
  if (target.closest('[data-workout-card]')) return null; // Today's workout cards tick in app.js
  for (const [sel, kind] of PRESS_HAPTICS) {
    const el = target.closest(sel);
    if (!el) continue;
    if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') return null;
    if (el.querySelector?.(':scope > .haptic-input')) return null; // the invisible-switch tick already fired
    return kind;
  }
  return null;
}

/**
 * Fire the haptic for a tap on `target`; returns the kind (or null). `since` is the click's timeStamp: if a
 * haptic already fired at or after it (the control's own handler, openSheet, a flip), stay quiet so nothing ticks twice.
 */
export function pressTap(target, since = Infinity) {
  if (hapticFiredSince(since)) return null;
  const kind = pressKind(target);
  if (kind) haptics[kind]();
  return kind;
}

/** Screens covered here. The player, Food, Train and Settings already give their own haptics. */
export const PRESS_ROUTES = new Set(['today', 'trends', 'weekly', 'score', 'progress', 'history', 'photos', 'body', 'awards', 'metric', 'summary', 'report', 'withings', 'library', 'days', 'locations', 'coach']);
export const onPressRoute = (hash = globalThis.location?.hash || '') => PRESS_ROUTES.has(hash.replace(/^#\/?/, '').split(/[/?]/)[0]);

/** One listener on the document (screens and the sheets over them). */
export function wirePressHaptics(root = document) {
  root.addEventListener('click', (e) => { if (onPressRoute()) pressTap(e.target, e.timeStamp); });
}
