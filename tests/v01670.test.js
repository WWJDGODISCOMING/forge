// v0.16.70: Withings steps. Where a day's steps came from, and the calm "Reconnect to add steps" check.
// Synthetic data only.
import { test, eq } from './harness.js';
import { stepsSourceLabel, needsActivityScope } from '../js/steps-source.js';
import { dayDetail } from '../js/missions/day-core.js';
import { indexDays, missionsFor } from '../js/missions/core.js';
import { newerDays } from '../js/nutrition/balance.js';

test('steps source label: Withings only when it won; Apple Health for older rows; nothing without steps', () => {
  eq(stepsSourceLabel({ steps: 8000, steps_source: 'withings' }), 'from Withings');
  eq(stepsSourceLabel({ steps: 8000, steps_source: 'apple' }), 'from Apple Health');
  eq(stepsSourceLabel({ steps: 8000 }), 'from Apple Health');
  eq(stepsSourceLabel({ sleep: {} }), '');
  eq(stepsSourceLabel(null), '');
});

test('reconnect note: only a live link with known scopes that lack user.activity', () => {
  eq(needsActivityScope({ connected: true, scopes: 'user.info,user.metrics' }), true);
  eq(needsActivityScope({ connected: true, scopes: 'user.info,user.metrics,user.activity' }), false);
  eq(needsActivityScope({ connected: true, scopes: null }), false);
  eq(needsActivityScope({ connected: false, scopes: 'user.info' }), false);
  eq(needsActivityScope({ connected: true, needs_reconnect: true, scopes: 'user.info' }), false, 'the existing reconnect banner covers it');
  eq(needsActivityScope(undefined), false);
});

test('Past days and missions carry the steps source', () => {
  const day = '2026-10-09';
  const data = { weights: [], bodyMeasures: [], workouts: [], cardio: [], healthDaily: [{ id: day, steps: 9100, steps_source: 'withings' }], foodLogs: [] };
  eq(dayDetail(day, data, { targets: { steps: 8000 }, today: '2026-10-10' }).stepsSource, 'from Withings');
  const m = missionsFor(day, indexDays(data), { targets: { steps: 8000, bed: '23:00', proteinG: 0 }, restDay: false }).find((x) => x.id === 'steps');
  eq(m.progress.source, 'from Withings');
  eq(m.done, true);
});

test('Apple auto-read compares the phone with Apple\'s own number, not the higher stored steps', () => {
  const won = [{ id: '2026-10-09', steps: 9000, apple_steps: 6000, steps_source: 'withings' }];
  eq(newerDays([{ day: '2026-10-09', steps: 6000 }], won).length, 0, 'Withings won and Apple is unchanged: no re-post');
  eq(newerDays([{ day: '2026-10-09', steps: 9000 }], won).length, 1, 'Apple changed to equal the Withings number: posts');
  eq(newerDays([{ day: '2026-10-09', steps: 6100 }], won).length, 1, 'Apple changed: posts');
  const old = [{ id: '2026-10-09', steps: 5000 }];
  eq(newerDays([{ day: '2026-10-09', steps: 5000 }], old).length, 0, 'an older row with no source compares as before');
  eq(newerDays([{ day: '2026-10-09', steps: 5200 }], old).length, 1);
  const onlyW = [{ id: '2026-10-09', steps: 9000, steps_source: 'withings' }];
  eq(newerDays([{ day: '2026-10-09', steps: 9000 }], onlyW).length, 1, 'Withings-only day: Apple has never posted');
});
