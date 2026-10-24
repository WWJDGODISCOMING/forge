// v0.16.61 (#199): the Live Activity declares the .small family (Apple Watch Smart Stack, CarPlay) behind iOS 18 guards.
// Swift can't be compiled here, so these read the source.
import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';

const src = readFileSync(new URL('../ios/App/ForgeLiveActivity/ForgeLiveActivityBundle.swift', import.meta.url), 'utf8');

test('Live Activity adds the small supplemental family, guarded for iOS 18', () => {
  assert(src.includes('.supplementalActivityFamilies([.small])'), 'declares .small');
  assert(/if #available\(iOS 18\.0, \*\) \{\s*self\.supplementalActivityFamilies/.test(src), 'modifier guarded');
  assert(src.includes('.withSmallFamily()'), 'applied to the configuration');
});

test('small layout is picked by activityFamily and shows time, distance, pace and active cal', () => {
  assert(src.includes('@Environment(\\.activityFamily)'), 'reads activityFamily');
  assert(/@available\(iOS 18\.0, \*\)\s*struct FamilyCardView/.test(src), 'family reader is iOS 18 only');
  const small = src.slice(src.indexOf('struct SmallLiveView'), src.indexOf('struct LiveCardView'));
  for (const k of ['ClockText', 'distance(s, a)', 'avgPace', 'activeKcal']) assert(small.includes(k), `small shows ${k}`);
});

test('compact and minimal Dynamic Island views are unchanged', () => {
  assert(src.includes('compactTrailing: {\n                ClockText(state: s).monospacedDigit().frame(maxWidth: 52)'), 'compact trailing');
  assert(src.includes('Image(systemName: s.paused ? "pause.fill" : "figure.run")'), 'minimal');
});
