import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { liftProgress } from '../js/ui/gesture.js';

const src = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const D = [0, 300];

test('liftProgress: 1 at large, 0 at medium and below, linear between, clamped', () => {
  assert(liftProgress(0, D) === 1, 'large');
  assert(liftProgress(300, D) === 0, 'medium');
  assert(liftProgress(500, D) === 0, 'below medium');
  assert(liftProgress(150, D) === 0.5, 'halfway');
  assert(liftProgress(-40, D) === 1, 'rubber-banded above the top');
});

test('liftProgress: 0 with a single detent', () => {
  assert(liftProgress(0, [0]) === 0 && liftProgress(0, []) === 0, 'one or no detent');
});

test('sheet(): place() sets --sheet-lift only when detents are in play', () => {
  assert(/if \(ds && pages\.length[^\n]*--sheet-lift/.test(src), 'guarded by ds');
  assert((src.match(/\blift\(\);/g) || []).length === 1, 'lift() has one call site');
});

test('sheet(): reduced motion and wide screens never reach lift()', () => {
  const at = src.indexOf('\n      lift();');
  const gate = src.lastIndexOf('if (opts.detents', at);
  const seg = src.slice(gate, at);
  assert(gate > 0 && /!reduced/.test(seg) && /min-width: 600px/.test(seg), 'gated by reduced motion and width');
});

test('sheet(): closing removes the lift class, variables and will-change', () => {
  assert(/const finish = \(\) => \{\s*unlift\(\);/.test(src), 'finish() unlifts');
  assert(src.includes("'--sheet-lift', '--lift-oy', 'will-change'") && src.includes("classList.remove('lifted')"), 'unlift clears everything');
});

test('sheet(): #navbar lifts with #main and #nav, and the page keeps its own background', () => {
  const css = readFileSync(new URL('../css/nav.css', import.meta.url), 'utf8');
  assert(src.includes("document.getElementById('navbar')"), 'navbar joins the lifted group');
  assert(css.includes('#main.lifted, #nav.lifted, #navbar.lifted {'), 'same transform for all three');
  assert(css.includes('#main.lifted { background: var(--bg); min-height: 100dvh') && css.includes('#main.lifted::before {'), 'lifted page paints --bg');
  assert(css.includes('html.sheet-lift-on body { background: transparent'), 'body no longer paints the lift colour');
});

test('sheet(): scrolling the page behind re-measures --lift-oy, and close removes the listener', () => {
  assert(src.includes("addEventListener('scroll', onScroll, { passive: true })"), 'passive scroll listener');
  assert(src.includes('requestAnimationFrame(() => { measureRaf = 0; measureMain(); })'), 'at most once per frame');
  assert(src.includes("removeEventListener('scroll', onScroll)"), 'unlift removes it');
});

test('sheet(): native light theme switches to light status-bar text past halfway, only on a change', () => {
  assert(src.includes('lightBar(Number(l) > 0.5)'), 'threshold at half');
  assert(src.includes('if (on === barLight || !isNative()'), 'native only, and only when the side changes');
  assert(src.includes('lightBar(false);'), 'restored on close');
});

test('sheet(): #main is only looked up once, inside lift()', () => {
  assert((src.match(/getElementById\('main'\)/g) || []).length === 1, 'one lookup');
  assert(/const lift = \(\) => \{[^]*?pages = \[document\.getElementById\('main'\)/.test(src), 'inside lift()');
});

test('sheet(): one owner lifts the page; a sheet stacked on top touches nothing, and only the owner clears it', () => {
  assert(!src.includes('liftOpen'), 'no shared counter');
  assert(src.includes('if (prev && !prev.closing()) return;') && src.includes('liftOwner = { dlg,'), 'first lifter owns the page');
  assert(src.includes('if (liftOwner?.dlg !== dlg) return;') && src.includes('liftOwner = null;'), 'only the owner unlifts');
});

test('sheet(): scrolling behind a lifted page never reads getBoundingClientRect', () => {
  const a = src.indexOf('const measureMain'), b = src.indexOf('const onScroll');
  assert(a > 0 && b > a, 'handlers found');
  const seg = src.slice(a, src.indexOf('// Native, light theme'));
  assert(!seg.includes('getBoundingClientRect') && seg.includes('window.scrollY - mainTop'), 'scrollY minus the recorded document top');
  assert(src.includes('mainTop = pages[0].getBoundingClientRect().top + window.scrollY;') && src.indexOf('mainTop = pages[0]') < src.indexOf("el.classList.add('lifted')"), 'recorded once, before lifted');
});

test('dark mode: the pushed-back page gets a brighter top band against a pure black canvas; light is unchanged', () => {
  const t = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/nav.css', import.meta.url), 'utf8');
  assert(t.includes('--lift-bg: #000;') && t.includes('--lift-hi: .16;') && t.includes('--lift-hi: 0;') && t.includes('--lift-bg: #050506;'), 'tokens');
  assert(css.includes('calc(var(--lift-hi) * var(--sheet-lift))'), 'band scales with lift');
});
