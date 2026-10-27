// v0.16.83 (#234): haptics + press feedback on the data screens. Each mapped control fires the right kind.
import { test, assert, eq } from './harness.js';
import { readFileSync } from 'node:fs';
import { haptics } from '../js/ui/haptic.js';
import { PRESS_HAPTICS, PRESS_ROUTES, pressTap, pressKind, onPressRoute } from '../js/ui/press-haptics.js';

const VOCAB = ['select', 'light', 'medium', 'success', 'warning'];
const parts = (sel) => sel.split(',').map((x) => x.trim());

/** A stand-in element: closest(sel) matches when sel (a comma list) includes the one selector it was built for. */
const fake = (selector, extra = {}) => ({
  classList: { contains: () => false },
  closest(sel) { if (sel.includes('workout-card')) return null; return parts(sel).includes(selector) ? this : null; },
  querySelector: () => null,
  getAttribute: () => null,
  ...extra,
});

function stub() {
  const fired = [];
  const real = {};
  for (const k of VOCAB) { real[k] = haptics[k]; haptics[k] = () => { fired.push(k); return true; }; }
  return { fired, restore() { for (const k of VOCAB) haptics[k] = real[k]; } };
}

test('every row in the table uses only the existing vocabulary', () => {
  for (const [sel, kind] of PRESS_HAPTICS) assert(VOCAB.includes(kind), `${sel} -> ${kind}`);
});

test('each mapped control fires its haptic kind exactly once', () => {
  const s = stub();
  try {
    PRESS_HAPTICS.forEach(([sel, kind], row) => {
      for (const one of parts(sel)) {
        s.fired.length = 0;
        pressTap(fake(one));
        eq(s.fired.length, 1, `${one} fires once`);
        // the first row naming a selector decides its kind
        const first = PRESS_HAPTICS.findIndex(([x]) => parts(x).includes(one));
        eq(s.fired[0], PRESS_HAPTICS[first][1], `${one} fires ${PRESS_HAPTICS[first][1]}`);
        if (first === row) eq(s.fired[0], kind, `${one} is ${kind}`);
      }
    });
  } finally { s.restore(); }
});

test('the controls the issue names: segments select, cards open light, delete warns, done succeeds', () => {
  eq(pressKind(fake('.seg label')), 'select');
  eq(pressKind(fake('.mg-btn')), 'select');
  eq(pressKind(fake('[data-open]')), 'light');
  eq(pressKind(fake('a.card')), 'light');
  eq(pressKind(fake('[data-del]')), 'warning');
  eq(pressKind(fake('[data-do]')), 'success');
});

test('disabled controls, controls with their own switch tick, and unmapped things stay quiet', () => {
  eq(pressKind(fake('[data-del]', { disabled: true })), null);
  eq(pressKind(fake('.seg label', { querySelector: () => ({}) })), null);
  eq(pressKind(fake('.nothing')), null);
  eq(pressKind(null), null);
});

test('only the listed screens are covered; the player, Food and Settings keep their own haptics', () => {
  for (const r of PRESS_ROUTES) assert(onPressRoute(`#/${r}`), r);
  assert(onPressRoute('#/metric/weight_kg'), 'sub-routes count');
  for (const r of ['play', 'food', 'settings', 'train']) assert(!onPressRoute(`#/${r}`), r);
});

test('the new controls get the press-dip, inside 100 ms, and Reduce Motion drops the movement', () => {
  const css = readFileSync(new URL('../css/motion.css', import.meta.url), 'utf8');
  for (const c of ['mg-btn', 'pp-thumb', 'coach-chip', 'pillar', 'mover', 'pick', 'dd-link', 'trend-row', 'nav-card']) {
    assert(css.includes(`.${c}:active`), `.${c} dips`);
  }
  assert(/--t-press: 80ms/.test(css), 'dip lands inside 100 ms');
  assert(/prefers-reduced-motion: reduce\)[\s\S]*\.mg-btn:active[^{]*\{ transform: none/.test(css), 'reduced motion: no movement');
});
