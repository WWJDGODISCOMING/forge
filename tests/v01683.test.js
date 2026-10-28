// v0.16.83 (#234): haptics + press feedback on the data screens. Each mapped control fires the right kind.
import { test, assert, eq } from './harness.js';
import { readFileSync } from 'node:fs';
import { haptics, noteHaptic } from '../js/ui/haptic.js';
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

test('a control whose own handler already ticked during the click gets no second haptic', () => {
  const s = stub();
  try {
    // Real handlers go through haptics and record the time; the stub plays that part for the screen's own tick.
    const ownTick = (kind) => { haptics[kind](); noteHaptic(); };
    const clickAt = performance.now();
    ownTick('select'); // e.g. toggleGroup() on .mg-btn, or openSheet()'s light tap
    pressTap(fake('.mg-btn'), clickAt);
    eq(s.fired.length, 1, 'exactly one haptic in total');
    eq(s.fired[0], 'select');
    // a later click with no handler tick still fires once
    s.fired.length = 0;
    pressTap(fake('[data-open]'), performance.now() + 5);
    eq(s.fired.length, 1, 'no handler tick: the delegated one fires');
    eq(s.fired[0], 'light');
  } finally { s.restore(); }
});

const ownHaptic = (selector) => fake(selector, {
  closest(sel) { return sel.includes('own-haptic') || parts(sel).includes(selector) ? this : null; },
});

test('a handler that ticks after an await gets exactly one haptic when it opts out', async () => {
  const s = stub();
  try {
    const clickAt = performance.now();
    pressTap(ownHaptic('[data-save]'), clickAt); // the delegated listener runs at once, before the awaited save resolves
    await Promise.resolve();
    haptics.success(); // the handler's own tick once the save resolves
    eq(s.fired.length, 1, 'exactly one haptic in total');
    // without the opt-out the same tap would tick twice
    s.fired.length = 0;
    pressTap(fake('[data-save]'), clickAt);
    await Promise.resolve();
    haptics.success();
    eq(s.fired.length, 2, 'no opt-out: the double tick this guards against');
  } finally { s.restore(); }
});

test('data-own-haptic makes pressKind return null', () => {
  eq(pressKind(ownHaptic('[data-save]')), null);
  eq(pressKind(fake('[data-save]')), 'success');
});

test('controls whose handler ticks after an await or only on success carry data-own-haptic', () => {
  const rows = [['photos/capture.js', 'data-save'], ['screens/withings.js', 'data-connect'], ['screens/withings.js', 'data-sync'],
    ['screens/withings.js', 'data-reimport'], ['screens/withings.js', 'data-save'], ['screens/protein-goal.js', 'data-save'], ['screens/coach.js', 'data-do']];
  for (const [file, attr] of rows) {
    const src = readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
    const buttons = src.match(new RegExp(`<button[^>]*\\b${attr}\\b[^>]*>`, 'g')) || [];
    assert(buttons.length > 0, `${file} ${attr}`);
    for (const b of buttons) assert(b.includes('data-own-haptic'), `${file}: ${b}`);
  }
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
