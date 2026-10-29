// v0.16.71 (#213): home-screen and lock-screen widgets. The snapshot builder, the bridge, and the Swift/Xcode wiring
// (no macOS runner, so the Swift is checked as text). Synthetic data only.
import { readFileSync, existsSync } from 'node:fs';
import { test, eq as strictEq, assert } from './harness.js';
const eq = (a, b, m) => strictEq(JSON.stringify(a), JSON.stringify(b), m);
import { buildSnapshot, snapshotKey, isStale, shouldSend, STALE_MS, REFRESH_MS } from '../js/native/widget-core.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 26, 15, 0, 0);
const series = [100, 99.8, 99.7, 99.5, 99.4, 99.2, 99.1, 99.0, 98.9].map((kg, i) => ({ day: `2026-10-${String(18 + i).padStart(2, '0')}`, trend: kg }));
const base = { now: NOW, day: '2026-10-26', weighedIn: true, steps: 6234.6, stepsGoal: 8000, protein: 91.4, proteinGoal: 140, kcal: 1420.2, kcalCeiling: 2100, series, units: 'metric' };

test('snapshot: rings, calories and the last 7 trend points, rounded', () => {
  const s = buildSnapshot(base);
  eq(s.weigh, true);
  eq(s.steps, { v: 6235, goal: 8000 });
  eq(s.protein, { v: 91, goal: 140 });
  eq(s.kcal, { v: 1420, goal: 2100 });
  eq(s.trend.points.length, 7);
  eq(s.trend.unit, 'kg');
  eq(s.trend.latest, 98.9);
  eq(s.trend.points[0], 99.7);
});

test('snapshot: pounds for imperial; no trend with fewer than two points; no goal leaves that part out', () => {
  const s = buildSnapshot({ ...base, units: 'imperial', series: [{ day: 'a', trend: 80 }, { day: 'b', trend: 79.5 }], kcalCeiling: null, proteinGoal: 0 });
  eq(s.trend.unit, 'lb');
  eq(s.trend.latest, 175.3);
  eq(s.kcal, null);
  eq(s.protein, null);
  eq(buildSnapshot({ ...base, series: [{ day: 'a', trend: 80 }] }).trend, null);
});

test('snapshot: steps not in yet keep the goal with no value; numbers only (no names or text)', () => {
  const s = buildSnapshot({ ...base, steps: null });
  eq(s.steps, { v: null, goal: 8000 });
  const walk = (o) => { for (const v of Object.values(o)) { if (v && typeof v === 'object') walk(v); else assert(typeof v === 'number' || typeof v === 'boolean' || v === null || /^(\d{4}-\d{2}-\d{2}|lb|kg)$/.test(v), `unexpected value ${v}`); } };
  walk(s);
});

test('stale: another day, old, wrong version or missing says Open Forge to update', () => {
  const s = buildSnapshot(base);
  eq(isStale(s, NOW + 1000, '2026-10-26'), false);
  eq(isStale(s, NOW + 1000, '2026-10-27'), true);
  eq(isStale(s, NOW + STALE_MS + 1, '2026-10-26'), true);
  eq(isStale({ ...s, v: 99 }, NOW, '2026-10-26'), true);
  eq(isStale(null, NOW, '2026-10-26'), true);
});

test('hand-off: only when the numbers change, when forced after a minute, or when the last one is 30 minutes old', () => {
  const k = snapshotKey(buildSnapshot(base));
  eq(k, snapshotKey(buildSnapshot({ ...base, now: NOW + 5000 })), 'time alone is not a change');
  eq(shouldSend(null, k, 0, NOW), true);
  eq(shouldSend(k, k, NOW, NOW + 1000), false);
  eq(shouldSend(k, k, NOW, NOW + 1000, true), false);
  eq(shouldSend(k, k, NOW, NOW + 61000, true), true);
  eq(shouldSend(k, k, NOW, NOW + REFRESH_MS), true);
  eq(shouldSend(k, snapshotKey(buildSnapshot({ ...base, steps: 7000 })), NOW, NOW + 1000), true);
});

test('bridge: the app starts it on the iPhone only and the shell caches it offline', () => {
  assert(/if \(isNative\(\)\) import\('\.\/native\/widget\.js'\)/.test(read('js/app.js')));
  const w = read('js/native/widget.js');
  assert(w.includes("plugin('ForgeWidget')") && w.includes('if (!P) return false'), 'a no-op on the web');
}); 

test('Swift and Xcode wiring: widgets in the existing extension, Keychain hand-off (no App Group), forge:// links', () => {
  const widgets = read('ios/App/ForgeLiveActivity/ForgeWidgets.swift');
  for (const f of ['.systemSmall', '.systemMedium', '.accessoryCircular', '.accessoryRectangular', 'Open Forge to update', 'forge://open/', 'minimumScaleFactor']) assert(widgets.includes(f), f);
  assert(!/URLSession|URLRequest|Data\(contentsOf/.test(widgets), 'no network in the widget');
  assert(read('ios/App/ForgeLiveActivity/ForgeLiveActivityBundle.swift').includes('ForgeTodayWidget()'));
  const shared = read('ios/App/App/ForgeWidgetShared.swift');
  assert(shared.includes('kSecAttrAccessGroup') && shared.includes('kSecAttrAccessibleAfterFirstUnlock'));
  assert(!/UserDefaults\(suiteName/.test(shared), 'App Groups need a paid account');
  const plugin = read('ios/App/App/ForgeWidgetPlugin.swift');
  assert(plugin.includes('reloadAllTimelines') && plugin.includes('setSnapshot'));
  assert(read('ios/App/App/ForgeBridgeViewController.swift').includes('ForgeWidgetPlugin()'));
  assert(read('ios/App/App/SceneDelegate.swift').includes('ForgeWidgetPlugin.open'));
  assert(read('ios/App/App/Info.plist').includes('<string>forge</string>'));
  const group = '$(AppIdentifierPrefix)com.christianeverett.forge.shared';
  for (const f of ['ios/App/App/App.entitlements', 'ios/App/ForgeLiveActivity/ForgeLiveActivity.entitlements', 'ios/App/App/Info.plist', 'ios/App/ForgeLiveActivity/Info.plist']) assert(read(f).includes(group), f);
  assert(existsSync(new URL('../ios/App/ForgeLiveActivity/ForgeLiveActivity.entitlements', import.meta.url)));
  const proj = read('ios/App/App.xcodeproj/project.pbxproj');
  for (const f of ['ForgeWidgetShared.swift in Sources', 'ForgeWidgetPlugin.swift in Sources', 'ForgeWidgets.swift in Sources']) assert(proj.includes(f), f);
  eq((proj.match(/ForgeWidgetShared\.swift in Sources \*\/,/g) || []).length, 2, 'shared file is in both targets');
  eq((proj.match(/CODE_SIGN_ENTITLEMENTS = ForgeLiveActivity\/ForgeLiveActivity\.entitlements;/g) || []).length, 2);
});

test('privacy: sign-out and delete clear the widget explicitly; routes are not left pending or doubled', () => {
  const st = read('js/screens/settings.js');
  const so = read('js/signout.js');
  assert(st.includes('signOutCleanly()') && so.indexOf('m.clearWidget()') < so.indexOf('d.signOut'), 'sign-out clears before signOut');
  assert(/accountGone = true;\s*await import\('\.\.\/native\/widget\.js'\)/.test(st), 'delete clears once the account is gone');
  const plugin = read('ios/App/App/ForgeWidgetPlugin.swift');
  assert(plugin.includes('hasListeners("route")') && plugin.includes('pendingRoute = nil'), 'a delivered route is not left pending');
  assert(read('ios/App/ForgeLiveActivity/ForgeWidgets.swift').split('.privacySensitive()').length - 1 >= 3, 'lock-screen numbers are privacy sensitive');
});

test('privacy: a signed-out sync clears once per launch whatever was sent; the same route within 2 s opens once', () => {
  const w = read('js/native/widget.js');
  assert(w.includes('state.user === null && !cleared'), 'no dependence on lastKey');
  assert(w.includes('cleared = true') && w.includes('cleared = false'), 'cleared once, re-armed after a send');
  assert(w.includes('lastRoute.route === route') && w.includes('< 2000'), 'listener plus takeRoute navigates once');
  assert(w.includes('export async function clearWidget') && w.includes('await P.clear()'), 'callers can await the clear');
});
