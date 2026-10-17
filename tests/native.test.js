// The iPhone app bridge (js/native/*): a no-op on the web; with a (fake) Capacitor shell it calls the plugins.
// HealthKit samples become the same daily summaries the export import makes.
import { readFileSync } from 'node:fs';
import { test, eq, assert, near } from './harness.js';
import { isNative, plugin, haptic, syncRestNotification, openExternal, hideSplash, setupKeyboard, REST_NOTIFICATION_ID } from '../js/native/bridge.js';
import { localStamp, sampleToRecord, sleepRecords, totalToRecord, daysFromHealth, healthPlugin, READ_TYPES } from '../js/native/health.js';
import { cdnRefs, localise, COPY } from '../scripts/build-www.mjs';
import { autoReadMode, hasOvernight } from '../js/native/autoread.js';

function fakeShell({ names = ['Haptics', 'LocalNotifications', 'Browser', 'StatusBar'], permission = 'prompt' } = {}) {
  const calls = [];
  const rec = (name) => new Proxy({}, { get: (_, m) => m === 'then' ? undefined : async (arg) => {
    calls.push([name, m, arg]);
    if (m === 'checkPermissions') return { display: permission };
    return {};
  } });
  const Plugins = Object.fromEntries(names.map((n) => [n, rec(n)]));
  globalThis.window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: (n) => names.includes(n), Plugins } };
  return calls;
}
const web = () => { globalThis.window = {}; };
const tickq = () => new Promise((r) => setTimeout(r, 0));

test('native bridge on the web: everything is a harmless no-op', async () => {
  web();
  eq(isNative(), false);
  eq(plugin('Haptics'), null);
  eq(haptic('success'), false);
  eq(openExternal('https://example.com'), false);
  eq(await syncRestNotification(Date.now() + 60000), false);
});

test('native haptics: taps are impacts, outcomes are notifications', async () => {
  const calls = fakeShell();
  assert(isNative());
  haptic('medium');
  haptic('success');
  haptic('select');
  await tickq();
  eq(JSON.stringify(calls.filter((c) => c[0] === 'Haptics').map((c) => [c[1], c[2]])), JSON.stringify([['impact', { style: 'MEDIUM' }], ['notification', { type: 'SUCCESS' }], ['selectionStart', undefined], ['selectionChanged', undefined]]));
});

test('rest timer on the lock screen: asks once, schedules one notification, moves it, cancels it', async () => {
  const calls = fakeShell();
  const end = Date.now() + 90000;
  await syncRestNotification(end, { body: 'Next: Squat' });
  await syncRestNotification(end); // same end: nothing new
  const N = () => calls.filter((c) => c[0] === 'LocalNotifications').map((c) => c[1]);
  eq(N().join(), 'checkPermissions,requestPermissions,schedule');
  const sched = calls.find((c) => c[1] === 'schedule')[2].notifications[0];
  eq(sched.id, REST_NOTIFICATION_ID);
  eq(sched.body, 'Next: Squat');
  near(sched.schedule.at.getTime(), end, 1000);
  await syncRestNotification(end + 30000); // +30 s
  eq(N().slice(3).join(), 'cancel,schedule');
  await syncRestNotification(null); // stopped or paused
  eq(N().slice(5).join(), 'cancel');
  await syncRestNotification(Date.now() + 1000); // under 2 s left: nothing to schedule
  eq(N().length, 6);
});

test('plugin lookup returns the named plugin, or null when it is missing', () => {
  fakeShell({ names: ['Haptics'] });
  assert(plugin('Haptics') != null);
  eq(plugin('Health'), null);
  fakeShell({ names: ['Health'] });
  assert(healthPlugin() != null, 'the HealthKit plugin registers as Health');
  web();
});

test('HealthKit wrist temperature and VO₂max come through daysFromHealth (the delta needs earlier nights)', () => {
  const at = (d, h) => new Date(2026, 9, d, h).toISOString();
  const nights = [];
  for (let d = 1; d <= 8; d++) nights.push({ value: d === 8 ? 36.9 : 36.5, unit: 'celsius', startDate: at(d, 3), endDate: at(d, 4) });
  nights.push({ value: 35.0, unit: 'celsius', startDate: at(8, 15), endDate: at(8, 16) }); // an afternoon reading is not overnight
  const samples = { appleSleepingWristTemperature: nights, vo2Max: [{ value: 44.2, unit: 'mL/min/kg', startDate: at(8, 9), endDate: at(8, 9) }, { value: 45.0, unit: 'mL/min/kg', startDate: at(8, 18), endDate: at(8, 18) }] };
  const { days } = daysFromHealth({ samples, since: '2026-10-08' });
  eq(days.length, 1);
  eq(days[0].wrist_temp_c, 36.9);
  eq(days[0].wrist_temp_delta_c, 0.4, '36.9 against seven nights at 36.5');
  near(days[0].vo2max, 44.6, 0.06);
  assert(READ_TYPES.includes('appleSleepingWristTemperature') && READ_TYPES.includes('vo2Max'), 'both are asked for');
  assert(!READ_TYPES.includes('walkingHeartRateAverage'), 'the plugin has no walking heart rate');
});

test('Withings sign-in opens over the app in the iPhone app', async () => {
  const calls = fakeShell();
  eq(openExternal('https://account.withings.com/x'), true);
  await tickq();
  eq(calls.find((c) => c[0] === 'Browser')[2].url, 'https://account.withings.com/x');
  web();
});

test('HealthKit → export-style records: local time stamps, sleep stages, daily totals', () => {
  const s = localStamp('2026-10-09T10:41:05Z');
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(s), s);
  const hrv = sampleToRecord('heartRateVariability', { value: 48.2, unit: 'ms', startDate: '2026-10-09T09:00:00Z', endDate: '2026-10-09T09:01:00Z', sourceName: 'Watch' });
  eq(hrv.type, 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN');
  eq(hrv.value, '48.2');
  eq(sampleToRecord('heartRate', { value: 60, startDate: '2026-10-09T09:00:00Z' }), null, 'types Forge does not use are skipped');
  const night = sleepRecords({ hasStageData: true, sourceName: 'Watch', stages: [{ startDate: '2026-10-09T03:00:00Z', endDate: '2026-10-09T04:00:00Z', stage: 'deep' }, { startDate: '2026-10-09T04:00:00Z', endDate: '2026-10-09T05:30:00Z', stage: 'light' }] });
  eq(night.map((r) => r.value.replace('HKCategoryValueSleepAnalysis', '')).join(), 'AsleepDeep,AsleepCore');
  const steps = totalToRecord('steps', { startDate: '2026-10-08T04:00:00Z', value: 8421 });
  eq(steps.sourceName, 'HealthKit');
  eq(totalToRecord('steps', { startDate: '2026-10-08T04:00:00Z', value: 0 }), null);
});

test('HealthKit → daily summaries with the export importer: overnight HRV, sleep minutes, steps from one source', () => {
  const local = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
  const samples = {
    heartRateVariability: [{ value: 40, startDate: local(8, 3), endDate: local(8, 3, 1) }, { value: 50, startDate: local(8, 5), endDate: local(8, 5, 1) }, { value: 90, startDate: local(8, 15), endDate: local(8, 15, 1) }],
    restingHeartRate: [{ value: 58, startDate: local(8, 7), endDate: local(8, 7) }],
    sleep: [{ hasStageData: true, stages: [{ startDate: local(7, 23), endDate: local(8, 1), stage: 'light' }, { startDate: local(8, 1), endDate: local(8, 2), stage: 'deep' }, { startDate: local(8, 2), endDate: local(8, 2, 20), stage: 'awake' }, { startDate: local(8, 2, 20), endDate: local(8, 6, 20), stage: 'rem' }] }],
  };
  const totals = { steps: [{ startDate: local(8, 0), value: 9100 }], calories: [{ startDate: local(8, 0), value: 512.6 }] };
  const { days } = daysFromHealth({ samples, totals, since: '2026-10-08' });
  eq(days.length, 1);
  const d = days[0];
  eq(d.day, '2026-10-08');
  eq(d.hrv_sdnn_ms, 45, 'the 3 pm reading is not overnight');
  eq(d.rhr_bpm, 58);
  eq(d.steps, 9100);
  eq(d.active_kcal, 513);
  eq(d.sleep.asleep_min, 7 * 60, '11 pm–6:20 am minus 20 min awake');
  eq(d.sleep.deep_min, 60);
  eq(d.sleep.awake_min, 20);
  eq(daysFromHealth({ since: '2026-10-08' }).days.length, 0);
});

test('www build: finds the Firebase files the app imports and points them at the bundled copies', () => {
  const t = "import { x } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'; await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js');";
  eq(cdnRefs(t).map((r) => `${r.file}@${r.version}`).join(), 'firebase-firestore.js@12.19.0,firebase-functions.js@12.19.0');
  eq(localise(t), "import { x } from '/vendor/firebase/firebase-firestore.js'; await import('/vendor/firebase/firebase-functions.js');");
  for (const keep of ['index.html', 'js', 'css', 'config.js']) assert(COPY.includes(keep), keep);
  for (const skip of ['functions', 'tests', 'notes', 'docs']) assert(!COPY.includes(skip), `${skip} stays out of the app`);
  web();
});

test('rest notification: a quick start-then-skip never leaves a stale notification', async () => {
  const calls = fakeShell();
  const p1 = syncRestNotification(Date.now() + 120000);
  const p2 = syncRestNotification(null); // skipped before the first call finished
  await Promise.all([p1, p2]);
  const N = calls.filter((c) => c[0] === 'LocalNotifications').map((c) => c[1]).filter((m) => m === 'schedule' || m === 'cancel');
  assert(N[N.length - 1] !== 'schedule', `left scheduled: ${N.join()}`);
  // and the other way round: a skip then a new rest ends with exactly that rest scheduled
  const end = Date.now() + 60000;
  await Promise.all([syncRestNotification(null), syncRestNotification(end)]);
  const last = calls.filter((c) => c[0] === 'LocalNotifications' && c[1] === 'schedule').pop();
  assert(last && Math.abs(last[2].notifications[0].schedule.at.getTime() - end) < 1000, 'the newest rest is the one scheduled');
  await syncRestNotification(null);
  web();
});

test('HealthKit daily totals land on the right day even when buckets start at UTC midnight', () => {
  const utcMidnight = '2026-10-08T00:00:00Z'; // 8 pm Oct 7 in New York, but the bucket is Oct 8
  const r = totalToRecord('steps', { startDate: utcMidnight, value: 5000 });
  const local = new Date(Date.parse(utcMidnight) + 12 * 3600e3);
  eq(r.endDate.slice(0, 10), `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
});

test('splash and keyboard: the splash comes down on request, the keyboard key bar stays on', async () => {
  web();
  eq(hideSplash(), false);
  eq(setupKeyboard(), false);
  const calls = fakeShell({ names: ['SplashScreen', 'Keyboard'] });
  eq(hideSplash(), true);
  eq(setupKeyboard(), true);
  await tickq();
  eq(JSON.stringify(calls.filter((c) => c[0] === 'SplashScreen').map((c) => [c[1], c[2]])), JSON.stringify([['hide', { fadeOutDuration: 200 }]]));
  const k = calls.filter((c) => c[0] === 'Keyboard').map((c) => c[1]);
  assert(k.includes('setAccessoryBarVisible') && k.includes('addListener'), k.join());
  eq(calls.find((c) => c[1] === 'setAccessoryBarVisible')[2].isVisible, true);
  web();
});

test('morning auto-read: reads when today has no overnight data (every 20 min), then falls back to the 6 h rule', () => {
  const at = (h, m, d = 10) => new Date(2026, 9, d, h, m);
  const today = '2026-10-10';
  const none = [{ id: '2026-10-09', hrv_sdnn_ms: 50 }];
  const last = at(23, 0, 9).getTime();
  eq(autoReadMode({ now: at(6, 30), last, today, rows: none }), 'steady'); // 11 PM read is 7.5 h old
  const tried = at(6, 30).getTime(); // that read happened; the app records it as the morning try too
  eq(autoReadMode({ now: at(6, 35), last: tried, today, rows: none, morningAt: tried }), null);
  eq(autoReadMode({ now: at(6, 55), last: tried, today, rows: none, morningAt: tried }), 'morning');
  // the morning rule on its own: last read 2 AM (under 6 h), no data today
  eq(autoReadMode({ now: at(6, 30), last: at(2, 0).getTime(), today, rows: none }), 'morning');
  // a failed morning read backs off 30 minutes
  eq(autoReadMode({ now: at(6, 55), last: tried, today, rows: none, morningAt: tried, morningFailedAt: tried }), null);
  eq(autoReadMode({ now: at(7, 1), last: tried, today, rows: none, morningAt: tried, morningFailedAt: tried }), 'morning');
  // before 4:00 the morning rule stays quiet
  eq(autoReadMode({ now: at(3, 30), last: at(0, 30).getTime(), today, rows: none }), null);
  // today's data is in: only the 6 h rule
  const got = [{ id: today, sleep: { asleep_min: 420 } }];
  assert(hasOvernight(got, today));
  eq(autoReadMode({ now: at(7, 30), last: at(6, 59).getTime(), today, rows: got }), null);
  eq(autoReadMode({ now: at(13, 5), last: at(6, 59).getTime(), today, rows: got }), 'steady');
  // 6:02 read brought HRV and resting HR but no sleep: the night isn't in yet, so 6:25 reads
  const partial = [{ id: today, hrv_sdnn_ms: 50, rhr_bpm: 55 }];
  assert(!hasOvernight(partial, today));
  const six02 = at(6, 2).getTime();
  eq(autoReadMode({ now: at(6, 25), last: six02, today, rows: partial, morningAt: six02 }), 'morning');
  // the morning rule ends at 12:00
  eq(autoReadMode({ now: at(12, 10), last: at(11, 10).getTime(), today, rows: partial }), null);
});

// ---------- weekly refresh countdown (js/native/expiry.js) ----------
import { expiryFrom, expiryInfo, daysLeft, expiryLine, refreshDue, reminderAt, loadExpiry, loadExpiryInfo, whenText, bannerDeadline, refreshRow, dueSoonLine, DAY_MS } from '../js/native/expiry.js';
import { scheduleExpiryReminder, EXPIRY_NOTIFICATION_ID } from '../js/native/bridge.js';

test('expiry: the profile date wins, otherwise build/first-seen + 7 days, otherwise unknown', () => {
  const built = Date.parse('2026-10-09T10:00:00Z');
  eq(expiryFrom({ builtAt: '2026-10-09T10:00:00Z' }), built + 7 * DAY_MS);
  eq(expiryFrom({ builtAt: '2026-10-09T10:00:00Z', expires: '2026-10-15T08:30:00Z' }), Date.parse('2026-10-15T08:30:00Z'));
  eq(expiryFrom(null, built), built + 7 * DAY_MS);
  eq(expiryFrom({ expires: 'nonsense' }), null);
  eq(expiryFrom({}), null);
});

test('expiry: days left round up, the line and the banner follow', () => {
  const exp = Date.parse('2026-10-16T10:00:00Z');
  const at = (iso) => Date.parse(iso);
  eq(daysLeft(exp, at('2026-10-09T10:00:00Z')), 7);
  eq(daysLeft(exp, at('2026-10-09T10:00:01Z')), 7);
  eq(daysLeft(exp, at('2026-10-15T20:00:00Z')), 1);
  eq(daysLeft(exp, at('2026-10-16T09:59:00Z')), 1);
  eq(daysLeft(exp, at('2026-10-17T00:00:00Z')), 0);
  eq(daysLeft(null), null);
  eq(expiryLine(exp, at('2026-10-12T10:00:00Z')), 'App refresh: expires in 4 days');
  eq(expiryLine(exp, at('2026-10-15T12:00:00Z')), 'App refresh: expires in 1 day');
  eq(expiryLine(exp, at('2026-10-17T00:00:00Z')), 'App refresh: due now');
  eq(expiryLine(null), '');
  assert(!refreshDue(exp, at('2026-10-14T09:00:00Z')), 'two days left: no banner');
  assert(refreshDue(exp, at('2026-10-15T10:00:00Z')), 'exactly a day left: banner');
  assert(refreshDue(exp, at('2026-10-16T08:00:00Z')), 'the morning it is due: banner');
  assert(refreshDue(exp, at('2026-10-18T08:00:00Z')), 'already expired: banner');
  assert(!refreshDue(null), 'unknown: no banner');
});

test('expiry: the reminder is the day before, kept between 8:00 and 20:00, never in the past', () => {
  const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const now = local(2026, 10, 9, 12);
  eq(reminderAt(local(2026, 10, 16, 14), now), local(2026, 10, 15, 14));
  eq(reminderAt(local(2026, 10, 16, 3), now), local(2026, 10, 15, 8)); // 3:00 the day before → 8:00
  eq(reminderAt(local(2026, 10, 16, 23), now), local(2026, 10, 15, 20)); // 23:00 → 20:00
  eq(reminderAt(local(2026, 10, 10, 11), now), null); // the day before is already past
  eq(reminderAt(null, now), null);
});

test('expiry: loadExpiry is null on the web; in the app it reads app-install.json', async () => {
  web();
  eq(await loadExpiry(), null);
  fakeShell();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ builtAt: '2026-10-09T10:00:00Z', expires: '2026-10-14T01:02:03Z' }) });
  eq(await loadExpiry(), Date.parse('2026-10-14T01:02:03Z'));
  eq((await loadExpiryInfo()).exact, true);
  web();
  delete globalThis.fetch;
});

test('expiry wording: the deadline says today, tomorrow or the weekday', () => {
  const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const exp = local(2026, 10, 16, 18, 12); // a Friday
  eq(whenText(exp, local(2026, 10, 16, 9)), 'today at 6:12 PM');
  eq(whenText(exp, local(2026, 10, 15, 20)), 'tomorrow at 6:12 PM');
  eq(whenText(exp, local(2026, 10, 12, 9)), 'Fri at 6:12 PM');
  eq(bannerDeadline(exp, local(2026, 10, 15, 20)), 'Stops opening tomorrow at 6:12 PM. Plug your iPhone into the Mac mini and double-click Refresh Forge.');
  assert(bannerDeadline(exp, local(2026, 10, 17, 9)).startsWith('Forge may have stopped opening.'));
  const far = refreshRow(exp, local(2026, 10, 11, 9));
  eq(far.value, '6 days');
  eq(far.sub, 'Good until Fri 6:12 PM');
  assert(far.sub.length <= 28, 'row subtitle fits one line');
  assert(!/ (AM|PM)/.test(far.sub), 'AM/PM never splits from the time');
  assert(!far.due);
  const soon = refreshRow(exp, local(2026, 10, 15, 20));
  assert(soon.due);
  eq(soon.value, '1 day');
  eq(soon.sub, 'Due tomorrow: plug into the Mac mini and double-click Refresh Forge');
});

test('expiry wording: a guessed date has no time, and the sheet explains when "Remind me" is too late', async () => {
  const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const exp = local(2026, 10, 16, 18, 12);
  eq(expiryInfo({ expires: '2026-10-16T18:12:00Z' }).exact, true);
  const guess = expiryInfo({ builtAt: '2026-10-09T10:00:00Z' });
  eq(guess.exact, false);
  eq(guess.at, Date.parse('2026-10-09T10:00:00Z') + 7 * DAY_MS);
  eq(refreshRow(exp, local(2026, 10, 11, 9), false).sub, 'Good until about Fri, Oct 16');
  eq(bannerDeadline(exp, local(2026, 10, 15, 20), false), 'Stops opening around tomorrow. Plug your iPhone into the Mac mini and double-click Refresh Forge.');
  eq(whenText(exp, local(2026, 10, 12, 9), false), 'Fri');
  eq(dueSoonLine(exp, local(2026, 10, 15, 20)), 'Due tomorrow at 6:12 PM: refresh it the next time you’re at the Mac mini.');
  eq(dueSoonLine(exp, local(2026, 10, 15, 20), false), 'Due tomorrow: refresh it the next time you’re at the Mac mini.');
  eq(dueSoonLine(exp, local(2026, 10, 17, 9)), 'Due now: refresh it the next time you’re at the Mac mini.');
});

test('expiry reminder: the "Remind me" tap (ask: true) asks first, then schedules only if allowed', async () => {
  const at = Date.now() + 3 * DAY_MS;
  let calls = fakeShell({ permission: 'prompt' }); // the fake never flips to granted: the user said no
  eq(await scheduleExpiryReminder(at, { ask: true }), false);
  assert(calls.some((c) => c[1] === 'requestPermissions'));
  assert(!calls.some((c) => c[1] === 'schedule'));
  calls = fakeShell({ permission: 'granted' });
  eq(await scheduleExpiryReminder(at, { ask: true }), true);
  assert(calls.some((c) => c[1] === 'schedule'));
  web();
});

test('expiry reminder: boot never asks for permission; it only schedules when already allowed', async () => {
  web();
  eq(await scheduleExpiryReminder(Date.now() + 1e6), false);
  const at = Date.now() + 3 * DAY_MS;
  let calls = fakeShell({ permission: 'prompt' }); // fresh install
  eq(await scheduleExpiryReminder(at), false);
  assert(!calls.some((c) => c[1] === 'requestPermissions'), 'boot must not ask');
  assert(!calls.some((c) => c[1] === 'schedule'));
  calls = fakeShell({ permission: 'granted' });
  eq(await scheduleExpiryReminder(at), true);
  assert(!calls.some((c) => c[1] === 'requestPermissions'));
  const sched = calls.find((c) => c[1] === 'schedule');
  eq(sched[2].notifications[0].id, EXPIRY_NOTIFICATION_ID);
  eq(sched[2].notifications[0].schedule.at.getTime(), at);
  calls.length = 0;
  await scheduleExpiryReminder(null);
  assert(calls.some((c) => c[1] === 'cancel') && !calls.some((c) => c[1] === 'schedule'));
  web();
});

// ---------- iPhone permissions (Info.plist) ----------
const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
const plistString = (key) => (plist.match(new RegExp('<key>' + key + '</key>\\s*<string>([^<]*)</string>')) || [])[1];

test('Info.plist: the camera key exists with the agreed words (without it iOS closes the app when the camera opens)', () => {
  eq(plistString('NSCameraUsageDescription'), 'Forge uses the camera for your progress photos and meal photos. Photos stay on this iPhone unless you choose to analyse a meal.');
  assert(plistString('NSHealthShareUsageDescription'), 'HealthKit text is still there');
});

test('Info.plist: no Photos-library key until a flow really saves to Photos (exports use the share sheet or a download)', () => {
  eq(plistString('NSPhotoLibraryAddUsageDescription'), undefined);
});
