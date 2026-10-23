import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { canViewfinder, nextGhost, GHOST_LEVELS } from '../js/photos/viewfinder.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const cam = { navigator: { mediaDevices: { getUserMedia() {} } } };

test('v0.16.56: the viewfinder is for the iPhone app with a camera only (a no-op on the web)', () => {
  eq(canViewfinder(true, cam), true);
  eq(canViewfinder(false, cam), false);
  eq(canViewfinder(true, { navigator: {} }), false);
  eq(canViewfinder(true, {}), false);
});

test('v0.16.56: the ghost button cycles faint, stronger, off, then faint again', () => {
  eq(nextGhost(GHOST_LEVELS[0]), GHOST_LEVELS[1]);
  eq(nextGhost(GHOST_LEVELS[1]), 0);
  eq(nextGhost(0), GHOST_LEVELS[0]);
  assert(GHOST_LEVELS[1] > GHOST_LEVELS[0], 'stronger is stronger');
});

test('v0.16.56: capture sheet uses the viewfinder with a system-picker fallback; the shell caches it', () => {
  const c = read('js/photos/capture.js');
  assert(/canViewfinder\(\)/.test(c) && /openViewfinder\(/.test(c), 'wired');
  assert(/capture="environment"/.test(c) && /pick\.setAttribute\('capture'/.test(c), 'fallback kept');
  assert(read('sw.js').includes("'./js/photos/viewfinder.js'"), 'in the offline shell');
  assert(/\.vf-btn \{ min-width: 44px; height: 44px/.test(read('css/photos.css')), '44 pt targets');
});

test('v0.16.56: the tab-bar decision is written down', () => {
  assert(/\*\*Tab bar\*\* \| \*\*Keep the CSS glass bar/.test(read('docs/ios-setup.md')), 'decision in docs/ios-setup.md');
});
