import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { step, SHEET, animateSpring } from '../js/ui/spring.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Run to rest at a given frame size. Returns the trace of values. */
function run(from, to, velocity, params, frameMs, maxMs = 4000) {
  let s = { value: from, velocity };
  const trace = [];
  for (let t = 0; t < maxMs; t += frameMs) {
    const r = step(s, to, frameMs, params);
    s = { value: r.value, velocity: r.velocity };
    trace.push(r.value);
    if (r.done) return { trace, done: true };
  }
  return { trace, done: false };
}

test('spring: settles exactly on the target from both directions', () => {
  for (const [from, to] of [[0, 300], [300, 0]]) {
    const r = run(from, to, 0, SHEET, 16.67);
    assert(r.done, `settles ${from} to ${to}`);
    assert(r.trace[r.trace.length - 1] === to, 'snaps to target');
  }
});

test('spring: no overshoot at critical damping', () => {
  const p = { stiffness: 380, damping: 2 * Math.sqrt(380 * 1), mass: 1 };
  const up = run(0, 100, 0, p, 16.67);
  assert(Math.max(...up.trace) <= 100 + 1e-9, 'rising stays below target');
  const down = run(100, 0, 0, p, 16.67);
  assert(Math.min(...down.trace) >= -1e-9, 'falling stays above target');
});

test('spring: the sheet spring bounces only a little', () => {
  const r = run(0, 300, 0, SHEET, 16.67);
  assert(Math.max(...r.trace) < 306, 'tiny settle at most');
});

test('spring: 60 Hz and 120 Hz agree within 0.5 px', () => {
  for (const ms of [100, 200, 350]) {
    const at = (frame) => {
      let s = { value: 0, velocity: 0 };
      for (let t = 0; t < ms - 1e-6; t += frame) s = step(s, 300, frame, SHEET);
      return s.value;
    };
    assert(Math.abs(at(1000 / 60) - at(1000 / 120)) < 0.5, `${ms} ms`);
  }
});

test('spring: a starting velocity carries over (moves that way first)', () => {
  assert(step({ value: 100, velocity: 2 }, 100, 16, SHEET).value > 100, 'positive velocity moves up first');
  assert(step({ value: 100, velocity: -2 }, 100, 16, SHEET).value < 100, 'negative velocity moves down first');
});

test('spring: stop() reports the current value and velocity', () => {
  const g = globalThis;
  const saved = [g.requestAnimationFrame, g.cancelAnimationFrame];
  let cb = null;
  g.requestAnimationFrame = (fn) => { cb = fn; return 1; };
  g.cancelAnimationFrame = () => {};
  try {
    let done = 0;
    const h = animateSpring({ from: 0, to: 100, velocity: 0, onUpdate: () => {}, onDone: () => done++ });
    cb(0); cb(16); cb(32);
    const r = h.stop();
    assert(r.value > 0 && r.value < 100, 'mid-flight value');
    assert(r.velocity > 0, 'moving towards the target');
    assert(done === 0, 'onDone not called by stop()');
  } finally {
    g.requestAnimationFrame = saved[0];
    g.cancelAnimationFrame = saved[1];
  }
});

test('spring: sheets use the spring engine with a reduced-motion branch; iOS asks for 120 Hz', () => {
  const ui = src('js/ui.js');
  assert(/playSpring\(/.test(ui), 'ui.js uses playSpring');
  assert(/const reduced = reducedMotion\(\)/.test(ui) && /if \(reduced\)/.test(ui), 'reduced-motion branch');
  assert(/<key>CADisableMinimumFrameDurationOnPhone<\/key>\s*<true\/>/.test(src('ios/App/App/Info.plist')), 'ProMotion key');
});
