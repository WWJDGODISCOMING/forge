import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { haptics } from '../js/ui/haptic.js';
import { state } from '../js/state.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('haptics: vocabulary has all six kinds', () => {
  for (const k of ['select', 'light', 'medium', 'success', 'heavy', 'warning']) assert(typeof haptics[k] === 'function', k);
});

test('haptics: no-op (false) off the native app and when Haptic tick is off', () => {
  for (const on of [true, false]) {
    state.settings = { ...(state.settings || {}), haptics: on };
    for (const k of ['select', 'light', 'medium', 'success', 'heavy', 'warning', 'win']) {
      assert(haptics[k]() === false, `${k} (haptics ${on})`);
    }
  }
});

test('haptics: key actions are bound to a haptic kind', () => {
  const need = [
    ['js/screens/train.js', 'haptics.medium()'],
    ['js/screens/weight.js', 'haptics.success()'],
    ['js/screens/food.js', 'haptics.success()'],
    ['js/screens/food.js', 'haptics.select()'],
    ['js/photos/capture.js', 'haptics.success()'],
    ['js/ui/fx.js', 'haptics.win()'],
    ['js/screens/settings.js', 'haptics.select()'],
    ['js/screens/settings.js', 'haptics.warning()'],
    ['js/ui.js', 'haptics.warning()'],
    ['js/ui.js', 'haptics.light()'],
  ];
  for (const [f, s] of need) assert(src(f).includes(s), `${f}: ${s}`);
  // Missions keep their own tiered plan (celebrate-core hapticPlan), so they are not doubled up here.
  assert(src('js/missions/celebrate.js').includes('hapticPlan'), 'mission haptics');
});

test('haptics: native path calls the right plugin methods and respects the toggle', async () => {
  const calls = [];
  const rec = (name) => (arg) => { calls.push([name, arg && (arg.style || arg.type), Date.now()]); return Promise.resolve(); };
  const Haptics = { selectionStart: rec('selectionStart'), selectionChanged: rec('selectionChanged'), impact: rec('impact'), notification: rec('notification') };
  const prev = globalThis.window;
  globalThis.window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: { Haptics } } };
  try {
    const h = (await import('../js/ui/haptic.js?native')).haptics;
    state.settings = { ...(state.settings || {}), haptics: true };
    for (const k of ['select', 'select', 'light', 'medium', 'heavy', 'success', 'warning']) assert(h[k]() === true, k);
    // bridge.js starts the selection generator once per page, and other suites may already have done it
    const got = calls.map((c) => c[0] + ':' + c[1]).filter((s, i) => !(s.startsWith('selectionStart') && i === 0)).join();
    assert(calls.filter((c) => c[0] === 'selectionStart').length <= 1, 'selectionStart at most once');
    assert(got === 'selectionChanged:undefined,selectionChanged:undefined,impact:LIGHT,impact:MEDIUM,impact:HEAVY,notification:SUCCESS,notification:WARNING', got);
    state.settings.haptics = false;
    calls.length = 0;
    for (const k of ['select', 'light', 'medium', 'success', 'heavy', 'warning', 'win']) assert(h[k]() === false, k + ' off');
    assert(calls.length === 0, 'nothing recorded when off');
    state.settings.haptics = true;
    calls.length = 0;
    h.medium();
    const t0 = Date.now();
    assert(h.win() === true, 'win');
    await new Promise((r) => setTimeout(r, 450));
    const heavy = calls.find((c) => c[1] === 'HEAVY');
    assert(heavy && heavy[2] - t0 >= 140, 'heavy waits for the medium to land');
    assert(calls.some((c) => c[1] === 'SUCCESS'), 'success follows');
  } finally {
    if (prev === undefined) delete globalThis.window; else globalThis.window = prev;
  }
});
