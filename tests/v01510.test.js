// v0.15.10: weight card shows the latest reading as the hero; honest "not enough" message. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { pickLatest, readingLabel } from '../js/weight/reading.js';
import { dailyWeights, smooth } from '../js/weight/smoothing.js';
import { notEnoughText, MIN_POINTS } from '../js/health/trends.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('latestWeighIn is the newest reading, not the smoothed trend', () => {
  const weights = [
    { id: 'a', day: '2026-10-08', kg: 94, source: 'withings', measured_at: '2026-10-08T11:00:00Z' },
    { id: 'b', day: '2026-10-09', kg: 94.4, source: 'withings', measured_at: '2026-10-09T11:00:00Z' },
    { id: 'c', day: '2026-10-10', kg: 96, source: 'withings', measured_at: '2026-10-10T11:30:00Z' },
  ];
  eq(pickLatest(weights).kg, 96);
  const s = smooth(dailyWeights(weights));
  assert(s[s.length - 1].trend < 96, 'the trend lags the reading');
});

test('latestWeighIn skips weigh-ins waiting for review and handles none', () => {
  const w2 = [
    { id: 'a', day: '2026-10-08', kg: 94, source: 'manual', measured_at: '2026-10-08T11:00:00Z' },
    { id: 'b', day: '2026-10-10', kg: 60, source: 'withings', review: true, measured_at: '2026-10-10T11:00:00Z' },
  ];
  eq(pickLatest(w2).kg, 94);
  eq(pickLatest(w2, new Set(['a'])), null);
  eq(pickLatest([]), null);
});

test('readingLabel: Today, Yesterday, Latest', () => {
  assert(readingLabel({ day: '2026-10-10', source: 'withings', measured_at: '2026-10-10T11:30:00Z' }, '2026-10-10').startsWith('Today'));
  eq(readingLabel({ day: '2026-10-09' }, '2026-10-10'), 'Yesterday');
  assert(readingLabel({ day: '2026-10-01' }, '2026-10-10').startsWith('Latest · '));
});

test('notEnoughText names the count and the advice', () => {
  assert(notEnoughText('weight_kg', 3).includes('Only 3 weigh-ins'));
  assert(notEnoughText('weight_kg', 1).includes('Only 1 weigh-in in'));
  assert(notEnoughText('steps', 2).includes('Only 2 readings'));
});

test('notEnoughText: none, one, and enough readings that still show no direction', () => {
  assert(notEnoughText('weight_kg', 0).startsWith('No weigh-ins in the last 4 weeks.'));
  assert(notEnoughText('steps', 0).startsWith('No readings in the last 4 weeks.'));
  assert(!/Only no/.test(notEnoughText('steps', 0)));
  assert(notEnoughText('steps', 1).startsWith('Only 1 reading in'));
  const n = notEnoughText('weight_kg', MIN_POINTS + 2);
  eq(n, 'Not enough change between readings to call a 4-week direction yet.');
  assert(!n.includes('Only'));
});

test('Today weight card puts the reading first and the trend under it', () => {
  const t = src('js/screens/today.js');
  assert(t.includes('data-weight-when') && t.includes('data-weight-trend'));
  assert(t.includes('What’s trend weight?'));
  assert(t.includes('<p class="label">Weight</p>'));
});
