import { test, assert } from './harness.js';
import { icon, ICON_NAMES } from '../js/ui/icons.js';

test('icons: every name renders a 24 grid, 2 px, decorative svg', () => {
  assert(ICON_NAMES.length > 30, 'icon names');
  for (const n of ICON_NAMES) {
    const s = icon(n);
    assert(s.startsWith('<svg'), `${n}: svg`);
    assert(s.includes('viewBox="0 0 24 24"'), `${n}: viewBox`);
    assert(s.includes('aria-hidden="true"'), `${n}: aria-hidden`);
    assert(s.includes('stroke-width="2"'), `${n}: stroke-width 2`);
  }
});

test('icons: unknown name is empty, filled twins differ from outline', () => {
  assert(icon('nope') === '', 'unknown');
  for (const n of ['check', 'trophy']) {
    const f = icon(n, { filled: true });
    assert(f && f !== icon(n), `${n}: filled differs`);
  }
});

test('icons: solid trophy/heart/dumbbell, single-path flame outline, filled twins differ', () => {
  const paths = icon('flame').split('<path').length - 1;
  assert(paths === 1, `flame outline has one path, got ${paths}`);
  for (const n of ['trophy', 'heart', 'dumbbell']) {
    const f = icon(n, { filled: true });
    assert(!f.includes('var(--bg)'), `${n}: no bg-colored detail`);
    assert(!f.includes('opacity'), `${n}: no opacity`);
  }
  for (const n of ['trophy', 'flame', 'star', 'heart', 'check', 'camera', 'person', 'dumbbell', 'medal']) {
    assert(icon(n, { filled: true }) !== icon(n), `${n}: filled differs`);
  }
});
