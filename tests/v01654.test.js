import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const tokens = read('css/tokens.css');
const at = tokens.indexOf('@media (prefers-color-scheme: light)');
const blocks = { dark: tokens.slice(0, at), light: tokens.slice(at) };
const hex = (theme, name) => {
  const m = blocks[theme].match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})\\b'));
  if (!m) throw new Error(theme + ' ' + name + ' is not a hex colour');
  return m[1];
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a))); // a translucent fill laid over a solid
const min = (theme, fgVar, bg, what) => { const r = ratio(rgb(hex(theme, fgVar)), bg); assert(r >= 4.5, `${what} (${theme}) ${r.toFixed(2)}:1 < 4.5`); };

const css = read('css/player.css') + read('css/app.css');

test('v0.16.54: Done set label vs its lime fill is 4.5:1 or better, light and dark', () => {
  assert(/--volt:\s*var\(--ring-glow\)/.test(tokens), 'Done set fill is --volt');
  min('light', '--text-1', rgb(hex('light', '--ring-glow')), 'Done set label');
  assert(/prefers-color-scheme: light\) \{ \.pl-done:not\(\.is-done\) \{ color: var\(--text-1\)/.test(css), 'light rule sets the label to --text-1');
  min('dark', '--accent-ink', rgb(hex('dark', '--ring-glow')), 'Done set label');
});

test('v0.16.54: How-To pill is opaque --surface-1 with accent text, 4.5:1 in both themes', () => {
  assert(/\.pl-howto \{[^}]*background: var\(--surface-1\); color: var\(--accent-text\)/.test(css), 'pill uses --surface-1 and --accent-text');
  for (const t of ['light', 'dark']) min(t, '--accent-text', rgb(hex(t, '--surface-1')), 'How-To pill');
});

test('v0.16.54: selected Settings row (Duo unfolded) text vs its fill is 4.5:1 in both themes', () => {
  assert(/\.set-nav-item\[aria-selected="true"\] \{[^}]*background: var\(--deep-fill\); color: var\(--text-1\)/.test(css), 'selected row uses --text-1 on --deep-fill');
  const tint = rgb('#077ca5'); // the light --deep-fill tint (alpha .14) over the page or a card
  for (const bgVar of ['--bg', '--surface-1', '--surface-2']) min('light', '--text-1', over(tint, 0.14, rgb(hex('light', bgVar))), 'Settings selected row on ' + bgVar);
  min('dark', '--text-1', rgb(hex('dark', '--deep-fill')), 'Settings selected row');
});

test('v0.16.54: onboarding action bar is flush to the bottom and may wrap', () => {
  const m = read('css/app.css').match(/\.sticky-actions \{[^}]*\}/)[0];
  assert(/bottom: 0/.test(m) && /flex-wrap: wrap/.test(m), 'bar sits at bottom: 0 and wraps');
});
