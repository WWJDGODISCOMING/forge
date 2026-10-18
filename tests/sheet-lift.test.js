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
  assert(/if \(ds && pages\.length\)[^\n]*--sheet-lift/.test(src), 'guarded by ds');
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
  assert(css.includes('#main.lifted { background: var(--bg)'), 'lifted page paints --bg');
  assert(css.includes('html.sheet-lift-on body { background: transparent'), 'body no longer paints the lift colour');
});

test('sheet(): scrolling the page behind re-measures --lift-oy, and close removes the listener', () => {
  assert(src.includes("addEventListener('scroll', onScroll, { passive: true })"), 'passive scroll listener');
  assert(src.includes('requestAnimationFrame(() => { measureRaf = 0; measure(); })'), 'at most once per frame');
  assert(src.includes("removeEventListener('scroll', onScroll)"), 'unlift removes it');
});

test('sheet(): native light theme switches to light status-bar text past halfway, only on a change', () => {
  assert(src.includes('lightBar(Number(l) > 0.5)'), 'threshold at half');
  assert(src.includes('if (on === barLight || !isNative()'), 'native only, and only when the side changes');
  assert(src.includes('lightBar(false);'), 'restored on close');
});

test('sheet(): #main is only looked up once, inside lift()', () => {
  assert((src.match(/getElementById\('main'\)/g) || []).length === 1, 'one lookup');
  assert(/const lift = \(\) => \{\s*pages = \[document\.getElementById\('main'\)/.test(src), 'inside lift()');
});
