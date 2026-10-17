import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { pickDetent, crossedDetent } from '../js/ui/gesture.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const D = [0, 300];
const size = 600;

test('pickDetent: settles on the nearest detent', () => {
  assert(pickDetent({ offset: 100, velocity: 0, detents: D, size }) === 0, 'near large');
  assert(pickDetent({ offset: 200, velocity: 0, detents: D, size }) === 300, 'near medium');
});

test('pickDetent: a flick moves exactly one detent each way', () => {
  assert(pickDetent({ offset: 0, velocity: 0.9, detents: D, size }) === 300, 'down from large to medium');
  assert(pickDetent({ offset: 300, velocity: -0.9, detents: D, size }) === 0, 'up from medium to large');
  assert(pickDetent({ offset: 20, velocity: 0.9, detents: D, size }) === 300, 'still one step');
});

test('pickDetent: a down-flick from medium dismisses; a hard up-flick never does', () => {
  assert(pickDetent({ offset: 300, velocity: 0.9, detents: D, size }) === 'dismiss', 'dismiss');
  assert(pickDetent({ offset: 320, velocity: -0.9, detents: D, size }) === 0, 'up to large');
});

test('pickDetent: a flick steps from where the drag began', () => {
  assert(pickDetent({ offset: 250, velocity: 0.9, detents: D, size, from: 0 }) === 300, 'large to medium');
  assert(pickDetent({ offset: 400, velocity: 0.9, detents: D, size, from: 0 }) === 'dismiss', 'past medium dismisses');
  assert(pickDetent({ offset: 100, velocity: -0.9, detents: D, size, from: 300 }) === 0, 'up from medium');
});

test('pickDetent: a slow small drag below medium springs back, a long one dismisses', () => {
  assert(pickDetent({ offset: 340, velocity: 0.1, detents: D, size }) === 300, 'springs back');
  assert(pickDetent({ offset: 300 + 0.36 * 300, velocity: 0.1, detents: D, size }) === 'dismiss', 'long drag');
});

test('crossedDetent: once per crossing, null otherwise', () => {
  assert(crossedDetent(250, 320, D) === 300, 'down across medium');
  assert(crossedDetent(320, 250, D) === 300, 'up across medium');
  assert(crossedDetent(320, 330, D) === null, 'no crossing');
  assert(crossedDetent(300, 300, D) === null, 'no movement');
  assert(crossedDetent(20, -5, D) === 0, 'up across large');
  assert(crossedDetent(320, 340, D) === null, 'not twice');
});

test('sheet(): detents option, haptic on crossing, shouldDismiss kept for plain sheets', () => {
  const ui = src('js/ui.js');
  assert(ui.includes('export function sheet(title, render, opts = {})') && ui.includes('opts.detents'), 'accepts detents');
  assert(ui.includes('crossedDetent(') && ui.includes('haptics.select()'), 'crossing ticks');
  assert(ui.includes('pickDetent(') && ui.includes('shouldDismiss('), 'both release rules');
  assert(src('js/screens/food.js').includes("detents: ['medium', 'large']"), 'food passes it');
  assert(!src('js/screens/session.js').includes('detents:'), 'action menu stays a single height');
  assert(ui.includes("matchMedia('(min-width: 600px)')") && !ui.includes('innerWidth <= 700'), 'wide breakpoint, so the unfolded Duo skips detents');
  assert(ui.includes('opts.detents?.length > 1 && !reduced'), 'no detents with reduced motion');
  assert(ui.includes("dlg.style.height = 'calc(100dvh - var(--safe-top) - 16px)'"), 'sized to the max sheet height before measuring');
  assert(ui.includes('expand: toLarge') && src('js/screens/food.js').includes('head.expand()'), 'dock opening goes to large');
  assert(ui.includes("document.activeElement.matches('input, textarea, select')) toLarge()"), 'focus during the open goes to large');
  assert(ui.includes('from: base0'), 'flick steps from where the drag began');
});
