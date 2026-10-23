import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { fillOf, isUrgent, countdownSecond, easedFill, dashOffset, URGENT_S } from '../js/ui/restring.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('restring: fill is clamped and safe for a zero total', () => {
  assert(fillOf(45, 90) === 0.5, 'half');
  assert(fillOf(100, 90) === 1 && fillOf(-5, 90) === 0 && fillOf(5, 0) === 0, 'clamped');
});

test('restring: urgent only in the last 10 s and not at zero', () => {
  assert(!isUrgent(URGENT_S + 0.5) && isUrgent(URGENT_S) && isUrgent(0.2) && !isUrgent(0), 'window');
});

test('restring: one tick each for 3, 2 and 1, never repeated', () => {
  assert(countdownSecond(3.0, -1) === 3 && countdownSecond(2.0, 3) === 2 && countdownSecond(0.5, 2) === 1, 'sequence');
  assert(countdownSecond(2.9, 3) === 0 && countdownSecond(0.9, 1) === 0, 'no repeat');
  assert(countdownSecond(8, -1) === 0 && countdownSecond(0, 1) === 0, 'outside the window');
});

test('restring: a nudge starts on the old fill and lands on the live one', () => {
  assert(easedFill(0.5, 0.2, 0) === 0.7, 'starts on the old fill');
  assert(easedFill(0.5, 0.2, 1) === 0.5, 'ends on the target');
  assert(easedFill(0.5, -0.2, 0.5) > 0.3 && easedFill(0.5, -0.2, 0.5) < 0.5, 'between');
  assert(dashOffset(1) === 0 && dashOffset(0) === 283, 'offset');
});

test('restring: the player wires the gradient, urgency and nudge; reduced motion drops the pulse', () => {
  const js = src('js/screens/player.js'), css = src('css/player.css'), timer = src('js/timer.js');
  assert(js.includes('restGrad') && js.includes('is-urgent') && js.includes('easedFill'), 'player wiring');
  assert(css.includes(".rest-ring.is-urgent { animation: none; }"), 'reduced motion');
  assert(timer.includes('haptics.light()') && timer.includes('countdownSecond'), 'timer ticks');
});
