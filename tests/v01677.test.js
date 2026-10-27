// v0.16.77 (#219): smart reminders that skip when done. Synthetic data only.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import {
  KINDS, normalize, anyOn, inQuiet, effectiveMinute, doneToday, message, planReminders, dueBanners, ALL_IDS, BASE_ID,
} from '../js/reminders/core.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const D = (h, m = 0, day = 10) => new Date(2026, 9, day, h, m, 0, 0);
const allOn = (extra = {}) => ({ quiet: { on: false }, ...Object.fromEntries(KINDS.map((k) => [k, { on: true }])), ...extra });
const snap = (o = {}) => ({ weighedIn: false, trained: false, weekMet: false, steps: 3000, stepsGoal: 8000, protein: 40, proteinGoal: 150, foodCount: 0, ...o });

test('v0.16.77: everything is off by default and junk is ignored', () => {
  const s = normalize(undefined);
  assert(!anyOn(s));
  assert(!anyOn(normalize({ weigh: 'yes', steps: { on: 'true' } })));
  eq(normalize({ steps: { on: true, time: '25:99' } }).steps.time, '18:30');
  eq(normalize({ steps: { on: true, time: '6:05' } }).steps.time, '06:05');
  eq(planReminders({ now: D(6), settings: undefined, snap: snap() }).length, 0);
});

test('v0.16.77: quiet hours wrap midnight and move a morning reminder to the end', () => {
  const q = { on: true, from: '22:00', to: '07:00' };
  assert(inQuiet(23 * 60, q)); assert(inQuiet(5 * 60, q)); assert(!inQuiet(12 * 60, q));
  eq(effectiveMinute('06:30', q), 7 * 60);
  eq(effectiveMinute('23:00', q), null);
  eq(effectiveMinute('12:00', q), 12 * 60);
  eq(effectiveMinute('06:30', { ...q, on: false }), 6 * 60 + 30);
});

test('v0.16.77: today\'s reminders skip when the thing is already done', () => {
  assert(doneToday('weigh', snap({ weighedIn: true })));
  assert(!doneToday('weigh', snap()));
  assert(doneToday('steps', snap({ steps: 8000 })));
  assert(!doneToday('steps', snap({ steps: null })));
  assert(doneToday('protein', snap({ protein: 150 })));
  assert(doneToday('protein', snap({ proteinGoal: null })), 'no goal, nothing to nudge');
  assert(doneToday('food', snap({ foodCount: 2 })));
  assert(doneToday('workout', snap({ trained: true })));
  assert(doneToday('workout', snap({ weekMet: true })));
});

test('v0.16.77: plan covers today and the next days, and drops what is done or past', () => {
  const s = allOn();
  const p = planReminders({ now: D(6), settings: s, snap: snap() });
  eq(p.length, KINDS.length * 3);
  assert(new Set(p.map((r) => r.id)).size === p.length, 'ids unique');
  assert(p.every((r) => ALL_IDS.includes(r.id)));
  const done = planReminders({ now: D(6), settings: s, snap: snap({ weighedIn: true, steps: 9000, protein: 160, foodCount: 1, trained: true }) });
  eq(done.length, KINDS.length * 2, 'today skipped for all five, later days stay');
  const late = planReminders({ now: D(20), settings: s, snap: snap() });
  assert(!late.some((r) => r.kind === 'weigh' && new Date(r.at).getDate() === 10), 'past times are not scheduled');
});

test('v0.16.77: text uses your numbers today and stays general later', () => {
  const s = { steps: { on: true, time: '18:30' }, protein: { on: true, time: '19:00' }, quiet: { on: false } };
  const p = planReminders({ now: D(9), settings: s, snap: snap({ stepsGoal: 6000, steps: 2500, proteinGoal: 120, protein: 30.5 }) });
  const t = p.filter((r) => new Date(r.at).getDate() === 10);
  assert(t.find((r) => r.kind === 'steps').body.includes('3,500'));
  assert(t.find((r) => r.kind === 'protein').body.includes('90 g'));
  const later = p.find((r) => r.kind === 'steps' && new Date(r.at).getDate() === 11);
  assert(!/\d/.test(later.body), 'no stale numbers for tomorrow');
  assert(!/\d/.test(message('protein', snap(), false).body));
});

test('v0.16.77: reminder times are read from settings, not fixed', () => {
  const p = planReminders({ now: D(6), settings: { food: { on: true, time: '10:15' }, quiet: { on: false } }, snap: snap() });
  eq(new Date(p[0].at).getHours(), 10);
  eq(new Date(p[0].at).getMinutes(), 15);
  eq(p[0].id, BASE_ID + 3 * 10);
});

test('v0.16.77: web banners show after the time, hide when done, dismissed or in quiet hours', () => {
  const s = { weigh: { on: true, time: '07:30' }, food: { on: true, time: '13:00' }, quiet: { on: true, from: '22:00', to: '07:00' } };
  eq(dueBanners({ now: D(7, 0), settings: s, snap: snap() }).length, 0, 'before the time');
  eq(dueBanners({ now: D(8), settings: s, snap: snap() }).map((b) => b.kind).join(), 'weigh');
  eq(dueBanners({ now: D(14), settings: s, snap: snap() }).map((b) => b.kind).join(), 'weigh,food');
  eq(dueBanners({ now: D(14), settings: s, snap: snap({ weighedIn: true }) }).map((b) => b.kind).join(), 'food');
  eq(dueBanners({ now: D(14), settings: s, snap: snap(), dismissed: ['weigh', 'food'] }).length, 0);
  eq(dueBanners({ now: D(23), settings: s, snap: snap() }).length, 0, 'quiet hours');
});

test('v0.16.77: wiring, labels and honesty are in place', () => {
  const ui = read('js/reminders/ui.js');
  assert(ui.includes('aria-label'), 'switches are labelled for VoiceOver');
  assert(ui.includes('haptics.select'));
  assert(read('js/screens/settings.js').includes('reminderSettingsHtml()'));
  assert(read('js/screens/today.js').includes('data-reminder-banners'));
  assert(read('js/app.js').includes('startReminders'));
  assert(read('sw.js').includes('./js/reminders/core.js'));
  assert(read('js/reminders/core.js').includes('can’t cancel'), 'says what it cannot do');
  assert(/not medical advice/.test(ui));
});
