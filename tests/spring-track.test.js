import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { springTrack, trackAt, playSpring, SHEET } from '../js/ui/spring.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('track: starts at from, ends exactly on to, one sample per 120 Hz frame', () => {
  const t = springTrack(0, 300, 0, SHEET);
  assert(t.values[0] === 0, 'starts at from');
  assert(t.values[t.values.length - 1] === 300, 'ends on target');
  assert(Math.abs(t.dt - 1000 / 120) < 1e-9, '1/120 s');
  assert(Math.abs(t.duration - (t.values.length - 1) * t.dt) < 1e-9, 'duration matches samples');
  assert(t.velocities.length === t.values.length, 'a velocity per sample');
});

test('track: no overshoot at critical damping', () => {
  const p = { stiffness: 380, damping: 2 * Math.sqrt(380), mass: 1 };
  const up = springTrack(0, 100, 0, p);
  assert(Math.max(...up.values) <= 100 + 1e-9, 'rising stays below target');
  const down = springTrack(100, 0, 0, p);
  assert(Math.min(...down.values) >= -1e-9, 'falling stays above target');
});

test('track: reach ends it as soon as the value gets there', () => {
  const full = springTrack(0, 300, 0, SHEET);
  const cut = springTrack(0, 300, 0, SHEET, { reach: 299 });
  assert(cut.duration < full.duration, 'shorter than the full settle');
  assert(cut.values[cut.values.length - 1] >= 299, 'reaches the threshold');
  assert(cut.values[cut.values.length - 2] < 299, 'and stops right there');
});

test('track: value and velocity by time', () => {
  const t = springTrack(0, 300, 0.5, SHEET);
  assert(trackAt(t, 0).value === 0 && trackAt(t, 0).velocity === 0.5, 'start');
  assert(trackAt(t, t.duration).value === 300, 'end');
  assert(trackAt(t, t.duration + 500).value === 300, 'clamped past the end');
  assert(trackAt(t, -5).value === 0, 'clamped before the start');
  const mid = trackAt(t, t.dt * 10.5);
  const lo = Math.min(t.values[10], t.values[11]);
  const hi = Math.max(t.values[10], t.values[11]);
  assert(mid.value >= lo && mid.value <= hi, 'interpolates between samples');
  assert(trackAt(t, 100).velocity > 0, 'moving towards the target');
});

test('track: sheets play springs as accelerated transform animations', () => {
  const sp = src('js/ui/spring.js');
  assert(/\.animate\(/.test(sp) && /easing: 'linear'/.test(sp) && /fill: 'forwards'/.test(sp), 'playSpring uses el.animate');
  assert(/playSpring\(/.test(src('js/ui.js')), 'ui.js plays sheets with playSpring');
});

test('track: relative (percent) mode starts fully hidden and ends at 0%', () => {
  const calls = [];
  const anim = { currentTime: 0, cancel() {} };
  const el = { offsetHeight: 400, animate(kf) { calls.push(kf); return anim; } };
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const a = playSpring({ el, from: 300, to: 0, relativeTo: 300 });
    const kf = calls[0];
    assert(kf[0].transform === 'translateY(100%)', 'first keyframe fully hidden');
    assert(kf[kf.length - 1].transform === 'translateY(0%)', 'last keyframe at rest');
    assert(Math.abs(a.stop().value - 400) < 1e-6, 'a grab converts with the current height');
  } finally { globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = caf; }
});

test('sheets open relative to their own height', () => {
  assert(/run\(h, rest, 0, .*undefined, h\)/.test(src('js/ui.js')), 'open path passes relativeTo');
});
