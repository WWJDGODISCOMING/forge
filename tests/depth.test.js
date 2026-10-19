import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const tokens = read('css/tokens.css');
const split = tokens.indexOf('prefers-color-scheme: light');
const blocks = { dark: tokens.slice(0, split), light: tokens.slice(split, tokens.indexOf('Old names kept')) };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const decl = (part, name) => { const m = part.match(new RegExp(`${name}:\\s*([^;]+);`)); return m && m[1]; };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const rgba = (s) => { const p = s.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number); return { c: p.slice(0, 3), a: p[3] ?? 1 }; };

// Page under a card top: --bg plus the single brightest ambient stop at its peak.
function pageSpot(part) {
  const bg = hex(decl(part, '--bg') || decl(blocks.dark, '--bg'));
  const stops = [...decl(part, '--ambient-bg').matchAll(/rgba\([^)]+\)/g)].map((m) => rgba(m[0]));
  const top = stops.reduce((m, s) => (s.a > m.a ? s : m));
  return over(top.c, top.a, bg);
}
function cardTop(part) {
  const first = decl(part, '--glass-card').match(/(rgba\([^)]+\)|#[0-9a-f]{6})/i)[1];
  if (first.startsWith('#')) return hex(first);
  const { c, a } = rgba(first);
  return over(c, a, pageSpot(part));
}

for (const mode of ['dark', 'light']) {
  test(`depth: text and accent hold 4.5:1 on the card top over the brightest light (${mode})`, () => {
    const part = blocks[mode];
    const card = cardTop(part);
    for (const name of ['--text-1', '--text-2', '--accent-text']) {
      const r = ratio(hex(decl(part, name).trim()), card);
      assert(r >= 4.5, `${name} is ${r.toFixed(2)}:1 on the ${mode} card top`);
    }
  });

  test(`depth: ${mode} block defines the depth tokens`, () => {
    for (const t of ['--elev-1', '--elev-2', '--elev-3', '--edge-highlight', '--glass-card', '--glass-border', '--ambient-bg', '--glow-accent']) {
      assert(blocks[mode].includes(`${t}:`), `${t} missing in ${mode}`);
    }
  });
}

test('depth: .card still uses --elev-raised, which points at --elev-1', () => {
  assert(/\.card \{[^}]*var\(--elev-raised\)/.test(read('css/app.css')));
  assert(/--elev-raised: var\(--elev-1\)/.test(blocks.dark));
});

test('depth: no backdrop-filter on cards', () => {
  const css = ['app', 'health', 'food', 'nav', 'motion', 'player', 'missions', 'report'].map((n) => read(`css/${n}.css`)).join('\n');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/backdrop-filter/.test(m[2])) continue;
    const bad = m[1].split(',').map((s) => s.trim()).filter((s) => /^(\.card|\.group|\.pillar|\.insight|\.body-hero \.bh-tile|\.bh-tile)(?![\w-])/.test(s));
    assert(bad.length === 0, `backdrop-filter on ${bad.join(', ')}`);
  }
});

test('depth: ambient light is one fixed layer under a transparent body', () => {
  const nav = read('css/nav.css');
  assert(/html \{ background: var\(--bg\); \}/.test(nav) && /body \{ background: transparent; \}/.test(nav));
  assert(/body::before \{[^}]*position: fixed[^}]*var\(--ambient-bg\)/.test(nav));
  assert(!/background-attachment/.test(nav + read('css/app.css')));
  assert(/#vt-surface \{[^}]*var\(--ambient-bg\), var\(--bg\)/.test(read('css/motion.css')));
  assert(/main\.swiping \{[^}]*var\(--ambient-bg\), var\(--bg\)/.test(nav));
  assert(/\.swipe-under \{[^}]*var\(--ambient-bg\), var\(--bg\)/.test(nav));
});

test('depth: reduced transparency removes the ambient layer and makes cards opaque', () => {
  assert(/prefers-reduced-transparency: reduce[^}]*--ambient-bg:[^}]*--tabbar-bg: var\(--bg\)/.test(tokens));
  assert(/html\.reduce-transparency \{[^}]*--ambient-bg/.test(tokens));
});

test('depth: special cards combine --elev-1 with their own ring', () => {
  const css = read('css/app.css') + read('css/health.css') + read('css/food.css');
  for (const sel of ['\\.ready-card', '\\.card\\.prs', '\\.excard\\.superset', '\\.verdict\\.ok', '\\.verdict\\.warn', '\\.suggest', '\\.plan-day\\.today']) {
    assert(new RegExp(`${sel} \\{[^}]*box-shadow: var\\(--elev-1\\),`).test(css), `${sel} should combine --elev-1`);
  }
});
