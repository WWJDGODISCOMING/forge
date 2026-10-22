import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { tabTapAction, TAB_MODULE, TAB_ORDER } from '../js/nav.js';
import { decodeImages } from '../js/ui/decode.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('v0.16.55: tapping another tab switches to it', () => {
  eq(tabTapAction({ sameTab: false, depth: 0, scrollY: 0 }), 'switch');
  eq(tabTapAction({ sameTab: false, depth: 2, scrollY: 500 }), 'switch');
});

test('v0.16.55: re-tapping a tab root scrolls to the top', () => {
  eq(tabTapAction({ sameTab: true, depth: 0, scrollY: 900 }), 'top');
  eq(tabTapAction({ sameTab: true, depth: 0, scrollY: 0 }), 'top');
});

test('v0.16.55: on a deeper screen the first re-tap scrolls to the top, the second pops to the root', () => {
  eq(tabTapAction({ sameTab: true, depth: 1, scrollY: 600 }), 'top');
  eq(tabTapAction({ sameTab: true, depth: 1, scrollY: 0 }), 'root');
  eq(tabTapAction({ sameTab: true, depth: 2, scrollY: 4 }), 'root');
});

test('v0.16.55: every tab has a module to load on touchstart, and the module file exists', () => {
  eq(JSON.stringify(Object.keys(TAB_MODULE).sort()), JSON.stringify([...TAB_ORDER].sort()));
  for (const name of Object.values(TAB_MODULE)) assert(read(`js/screens/${name}.js`).length > 0, name);
  assert(/nav\.addEventListener\('touchstart'/.test(read('js/app.js')), 'app.js listens for touchstart on the tab bar');
});

test('v0.16.55: chrome has no rubber-band, selection, callout or tap flash', () => {
  const nav = read('css/nav.css');
  assert(/html, body \{ overscroll-behavior: none; \}/.test(nav), 'page does not rubber-band');
  assert(/\.navbar, \.tabbar[^{]*\{[^}]*user-select: none[^}]*-webkit-touch-callout: none/.test(nav), 'bars are not selectable');
  assert(/-webkit-tap-highlight-color: transparent/.test(read('css/app.css')), 'no tap highlight');
});

test('v0.16.55: the first frame is the app background in both themes (no white flash)', () => {
  const html = read('index.html');
  assert(/html,body\{background:#040B0E/.test(html), 'dark first frame');
  assert(/prefers-color-scheme:light\)\{html,body\{background:#EEF1F5/.test(html), 'light first frame');
});

test('v0.16.55: decodeImages waits for images but never longer than the cap', async () => {
  const slow = { src: 'a.jpg', complete: false, decode: () => new Promise(() => {}) };
  const done = { src: 'b.jpg', complete: true, decode: () => Promise.resolve() };
  const root = { querySelectorAll: () => [slow, done] };
  const t = Date.now();
  await decodeImages(root, 30);
  assert(Date.now() - t < 500, 'returned at the cap');
  let decoded = false;
  const fast = { src: 'c.jpg', complete: false, decode: async () => { decoded = true; } };
  await decodeImages({ querySelectorAll: () => [fast] }, 500);
  assert(decoded, 'decode() was awaited');
  await decodeImages({ querySelectorAll: () => [] });
});
