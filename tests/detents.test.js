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
  assert(pickDetent({ offset: 100, velocity: 0.9, detents: D, size, from: 300 }) === 300, 'released above medium lands on medium');
  assert(pickDetent({ offset: 340, velocity: 0.9, detents: D, size, from: 300 }) === 'dismiss', 'below medium dismisses');
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
  const toLargeBody = ui.slice(ui.indexOf('const toLarge = () => {'), ui.indexOf('const opened = () => {'));
  assert(toLargeBody.includes('atRest(0);') && toLargeBody.split('run(').length === 2, 'toLarge parks at large (atRest(0)) and starts exactly one spring, so settle() cannot drop back to medium');
  assert(toLargeBody.indexOf('atRest(0);') < toLargeBody.indexOf('run('), 'toLarge sets the rest detent before the spring runs');
  assert(ui.includes('from: base0'),'flick steps from where the drag began');
  const food = src('js/screens/food.js');
  assert(food.indexOf('data-quick-toggle') < food.indexOf('class="food-scroll"') && food.indexOf('data-quick hidden') < food.indexOf('class="food-scroll"'), 'Quick add sits above the results list');
  const css = src('css/food.css');
  assert(!/\.sheet-body[^{]*\{[^}]*mask-image/.test(css) && !/\.food-dock \{[^}]*mask-image/.test(css), 'no fade mask on the sheet body or the dock, so Add can never be faded');
  assert(!/\.food-dock::after/.test(css) && !/\.food-dock::before/.test(css), 'no solid cover is painted under the dock');
  assert(/\.food-body \.food-dock \{[^}]*position: static;[^}]*flex: 0 1 auto/.test(css) && /\.food-dock > \[data-add\] \{ flex: none/.test(css) && food.includes('class="food-dock-main"'), 'the dock is pinned in the flex column and Add sits outside its small scroller');
  assert(/\.food-body \.food-scroll > \* \{ flex: none/.test(css), 'list rows keep their height, so the list scrolls instead of clipping');
  assert(/at-medium \.sheet-body\.food-body \{ padding-bottom: var\(--detent-pad/.test(css), 'medium pads the body, so the column ends at the screen edge');
  assert(/sheet-body\.food-body[^{]*\{[^}]*overflow: hidden/.test(css) && food.includes("body.classList.add('food-body')"), 'the sheet body does not scroll; the list does');
});
