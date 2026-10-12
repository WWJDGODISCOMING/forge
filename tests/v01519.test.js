// v0.15.19: the quick-log + (when it shows), the sheet's rows and targets, and Back from Settings children opened by link.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { quickLogVisible, quickLogRows } from '../js/quicklog.js';
import { backTarget, backLabel, noteNavigation, getChildReturn, setSettingsOrigin, TAB_ORDER } from '../js/nav.js';

const p = (hash) => hash.replace(/^#\/?/, '').split('/');
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('quick-log +: shows on every tab root and its Progress siblings', () => {
  for (const r of [...TAB_ORDER, 'score', 'trends', 'weekly', 'progress']) eq(quickLogVisible({ parts: [r] }), true, r);
  eq(quickLogVisible({ parts: [] }), true, 'empty hash is Today');
});

test('quick-log +: hidden in the player, on pushed screens, and on Settings and its children', () => {
  for (const h of ['#/play', '#/session', '#/summary/abc', '#/settings', '#/locations', '#/withings', '#/withings/check', '#/apple', '#/report', '#/profile',
    '#/library', '#/timer', '#/history', '#/awards', '#/metric/weight_kg', '#/photos', '#/coach', '#/program']) {
    eq(quickLogVisible({ parts: p(h) }), false, h);
  }
});

test('quick-log +: hidden while the keyboard, a sheet, a dialog or an overlay is up, during a screen change, and with no tab bar', () => {
  const base = { parts: ['today'] };
  eq(quickLogVisible({ ...base, keyboard: true }), false, 'keyboard');
  eq(quickLogVisible({ ...base, sheets: 1 }), false, 'sheet');
  eq(quickLogVisible({ ...base, dialogs: 1 }), false, 'dialog');
  eq(quickLogVisible({ ...base, overlay: true }), false, 'tour / takeover');
  eq(quickLogVisible({ ...base, busy: true }), false, 'push or pop in flight');
  eq(quickLogVisible({ ...base, navHidden: true }), false, 'sign-in, onboarding, skeleton');
  eq(quickLogVisible({ ...base }), true, 'and back again once all clear');
});

test('quick-log sheet: six rows in order, one-line labels, each with an icon', () => {
  const rows = quickLogRows({});
  eq(rows.map((r) => r.label).join('|'), 'Log food|Log weight|Start workout|Log cardio|Take progress photos|Ask Coach');
  eq(rows.length, 6);
  for (const r of rows) {
    assert(r.icon && r.id, `${r.label} has an icon and id`);
    assert(r.label.length <= 22, `${r.label} is short enough for one line at 320`);
    assert(Boolean(r.go) !== Boolean(r.run), `${r.label}: exactly one of go / run`);
  }
});

test('quick-log sheet: targets go to the existing screens and flows', () => {
  const by = Object.fromEntries(quickLogRows({}).map((r) => [r.id, r]));
  eq(by.food.run, 'logFood');
  eq(by.weight.run, 'logWeight');
  eq(by.workout.run, 'startWorkout');
  eq(by.cardio.run, 'logCardio');
  eq(by.photos.go, '#/photos');
  eq(by.coach.go, '#/coach');
});

test('quick-log sheet: Start workout becomes Resume workout while one is in progress, and opens the player', () => {
  const w = quickLogRows({ active: true, playerRoute: '#/play' }).find((r) => r.id === 'workout');
  eq(w.label, 'Resume workout');
  eq(w.go, '#/play');
  eq(quickLogRows({ active: true, playerRoute: '#/session' }).find((r) => r.id === 'workout').go, '#/session', 'list-view players resume in the list');
  eq(quickLogRows({ active: false }).find((r) => r.id === 'workout').label, 'Start workout');
  eq(quickLogRows({ active: true }).length, 6);
});

test('quick-log: the + is a 56pt lime circle labelled "Quick log", wired in the app shell', () => {
  const css = src('css/quicklog.css');
  assert(/\.ql-fab \{[^}]*width: 56px; height: 56px;[^}]*border-radius: 50%/.test(css), '56pt circle');
  assert(/background: var\(--accent\)/.test(css), 'lime accent');
  assert(/safe-bottom/.test(css) && /safe-right/.test(css), 'inside the safe area');
  assert(/body\.ql-room main \{ padding-bottom/.test(css), 'room for the last card');
  assert(/aria-label', 'Quick log'/.test(src('js/ui/quicklog.js')), 'VoiceOver label');
  assert(src('index.html').includes('css/quicklog.css'), 'stylesheet linked');
  assert(/noteNavigation\(from, to\)/.test(src('js/app.js')) && /mountQuickLog\(\)/.test(src('js/app.js')));
});

test('Back from a Settings child: opened from a screen outside Settings returns there, with its name', () => {
  noteNavigation(p('#/today'), p('#/apple')); // Readiness card -> Apple Health
  eq(backTarget(p('#/apple')), '#/today');
  eq(backLabel(p('#/apple')), 'Today');
  noteNavigation(p('#/body'), p('#/withings')); // Body -> Connect Withings
  eq(backTarget(p('#/withings')), '#/body');
  eq(backLabel(p('#/withings')), 'Body');
  eq(backTarget(p('#/withings/check')), '#/withings', 'Data check still goes back to Withings');
  noteNavigation(p('#/metric/weight_kg'), p('#/withings'));
  eq(backTarget(p('#/withings')), '#/metric/weight_kg', 'keeps the whole link');
  eq(backLabel(p('#/withings')), 'Body');
  noteNavigation(p('#/weight'), p('#/apple'));
  eq(backLabel(p('#/apple')), 'Progress');
});

test('Back from a Settings child: opened from Settings goes to Settings; a cold start falls back to Settings', () => {
  noteNavigation(p('#/body'), p('#/withings'));
  noteNavigation(p('#/settings'), p('#/locations'));
  eq(getChildReturn(), null, 'a stale answer is cleared when you open a child from Settings');
  eq(backTarget(p('#/locations')), '#/settings');
  eq(backLabel(p('#/locations')), 'Settings');
  noteNavigation(p('#/today'), p('#/apple'));
  noteNavigation(null, p('#/apple')); // cold start on the link
  eq(backTarget(p('#/apple')), '#/settings');
  eq(backLabel(p('#/apple')), 'Settings');
  noteNavigation([], p('#/withings'));
  eq(backTarget(p('#/withings')), '#/settings');
});

test('Back from a Settings child: child to child keeps where you started; Settings itself still goes to its tab', () => {
  noteNavigation(p('#/today'), p('#/withings'));
  noteNavigation(p('#/withings'), p('#/withings/check'));
  eq(backTarget(p('#/withings')), '#/today');
  eq(backTarget(p('#/withings/check')), '#/withings');
  setSettingsOrigin('food');
  eq(backTarget(p('#/settings')), '#/food');
  noteNavigation(p('#/food'), p('#/settings')); // not a child: leaves the answer alone
  noteNavigation(p('#/settings'), p('#/apple'));
  eq(backTarget(p('#/apple')), '#/settings');
  setSettingsOrigin('today');
});

test('quick-log sheet: Start workout unlocks audio inside the tap, before any timer or await', () => {
  const code = src('js/ui/quicklog.js');
  assert(/import \{ unlockAudio \} from '\.\/sound\.js'/.test(code), 'imported statically');
  const click = code.slice(code.indexOf('b.onclick'), code.indexOf('});', code.indexOf('b.onclick')));
  const at = click.indexOf('unlockAudio()');
  assert(at > -1, 'unlockAudio runs in the click handler');
  for (const later of ['setTimeout', 'import(', 'await', '.then(']) assert(click.indexOf(later) === -1 || click.indexOf(later) > at, `unlockAudio comes before ${later}`);
});
