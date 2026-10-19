import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const css = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
const at = css.indexOf('@media (prefers-color-scheme: light)');
const blocks = { dark: css.slice(0, at), light: css.slice(at) };
const get = (theme, name) => {
  const m = blocks[theme].match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})\\b'));
  if (!m) throw new Error(theme + ' ' + name + ' is not a hex colour');
  return m[1];
};
const lum = (h) => {
  const f = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(1) + 0.7152 * f(3) + 0.0722 * f(5);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pair = (theme, fg, bg, min) => {
  const f = fg.startsWith('#') ? fg : get(theme, fg);
  const b = bg.startsWith('#') ? bg : get(theme, bg);
  const r = ratio(f, b);
  assert(r >= min, theme + ' ' + fg + ' on ' + bg + ': ' + r.toFixed(2) + ' < ' + min);
};

test('palette dark: section 5 contrast pairs', () => {
  pair('dark', '--text-1', '--bg', 14.5);
  pair('dark', '--text-1', '--surface-1', 11.5);
  pair('dark', '--text-1', '--deep-fill', 7.4);
  pair('dark', '--text-2', '--surface-1', 6);
  pair('dark', '--text-2', '--surface-2', 5.1);
  pair('dark', '--text-3', '--bg', 5.4);
  pair('dark', '--accent', '--bg', 10);
  pair('dark', '--accent', '--surface-1', 8);
  pair('dark', '--accent', '--surface-2', 6.8);
  pair('dark', '--accent-ink', '--accent', 10);
  pair('dark', '--accent-ink', '#DADDE4', 14.5);
  pair('dark', '--ring-recovery', '--surface-1', 8.3);
  pair('dark', '--ring-protein', '--surface-1', 6);
  pair('dark', '--ring-win', '--surface-1', 13);
});

test('palette light: body text and accent text pass 4.5:1', () => {
  for (const bg of ['--bg', '--surface-1', '--surface-2']) {
    for (const fg of ['--text-1', '--text-2', '--text-3', '--accent-text']) pair('light', fg, bg, 4.5);
  }
  pair('light', '--accent-ink', '--accent', 4.5);
  pair('light', '--good', '--bg', 4.5);
});

test('palette: ring vars exist in both themes', () => {
  for (const v of ['--deep-fill', '--ring-training', '--ring-recovery', '--ring-kcal', '--ring-protein', '--ring-sets', '--ring-win']) {
    for (const t of ['dark', 'light']) assert(blocks[t].includes(v + ':'), t + ' missing ' + v);
  }
});
