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
