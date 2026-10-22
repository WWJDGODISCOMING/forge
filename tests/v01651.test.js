// v0.16.51: live workout. Synthetic data only.
import { readFileSync, existsSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import {
  LIVE_KINDS, newLive, pauseLive, resumeLive, endLive, activeMs, isPaused, fmtElapsed, fmtDistance, fmtPace,
  activeKcal, totalKcal, liveToCardio, alreadyLive, adoptNativePauses, endPayload, healthWriteWanted, liveNote,
} from '../js/workouts/live-core.js';
import { planWorkoutImport } from '../js/health/apple-workouts.js';
import { VERSION } from '../js/version.js';

const T0 = Date.parse('2026-10-22T10:00:00Z');
const MIN = 60000;

test('pause and resume take the paused time out of the clock', () => {
  let s = newLive('run', T0);
  eq(activeMs(s, T0 + 10 * MIN), 10 * MIN);
  s = pauseLive(s, T0 + 10 * MIN);
  assert(isPaused(s));
  eq(activeMs(s, T0 + 30 * MIN), 10 * MIN, 'frozen while paused');
  s = resumeLive(s, T0 + 15 * MIN);
  eq(activeMs(s, T0 + 20 * MIN), 15 * MIN);
  s = endLive(s, T0 + 25 * MIN);
  eq(activeMs(s, T0 + 99 * MIN), 20 * MIN, 'ending stops the clock');
  eq(s.pauses.length, 1);
});

test('double pause / resume / end (screen + lock-screen button) change nothing', () => {
  let s = newLive('walk', T0);
  const p1 = pauseLive(s, T0 + MIN);
  eq(pauseLive(p1, T0 + 2 * MIN), p1);
  eq(resumeLive(s, T0 + MIN), s);
  const e = endLive(p1, T0 + 5 * MIN); // ended while paused: the pause closes
  eq(e.pauses.length, 1);
  eq(activeMs(e, T0 + 5 * MIN), MIN);
  eq(endLive(e, T0 + 9 * MIN), e);
  eq(pauseLive(e, T0 + 9 * MIN), e);
});

test('formatting: clock, distance in mi and km, pace', () => {
  eq(fmtElapsed(7 * 1000 + 5 * MIN), '5:07');
  eq(fmtElapsed(3725000), '1:02:05');
  eq(fmtDistance(1609.344, 'mi'), '1.00');
  eq(fmtDistance(5000, 'km'), '5.00');
  eq(fmtPace(1609.344, 9 * MIN + 15000, 'mi'), '9\'15"');
  eq(fmtPace(1000, 6 * MIN, 'km'), '6\'00"');
  eq(fmtPace(10, MIN, 'mi'), '--\'--"', 'too little distance to mean anything');
});

test('kcal: measured wins, else MET × kg × hours; total adds resting; unknown weight is null, not a made-up number', () => {
  eq(activeKcal('run', 30 * MIN, 80, 123.4), 123);
  eq(activeKcal('jog_in_place', 30 * MIN, 80, 0), Math.round(8.0 * 80 * 0.5));
  eq(activeKcal('jog_in_place', 30 * MIN, null, 0), null);
  eq(totalKcal(320, 30 * MIN, 80), 320 + 40);
  eq(totalKcal(320, 30 * MIN, null), 320);
  eq(totalKcal(null, MIN, 80), null);
});

test('jog in place has no distance; walk and run do', () => {
  assert(!LIVE_KINDS.jog_in_place.distance && LIVE_KINDS.jog_in_place.indoor);
  assert(LIVE_KINDS.walk.distance && LIVE_KINDS.run.distance);
  assert(newLive('nope', T0).kind === 'jog_in_place');
});

test('liveToCardio: minutes without pauses, Health uuid kept, no distance for jog in place', () => {
  let s = newLive('run', T0, 'live_x');
  s = endLive(resumeLive(pauseLive(s, T0 + 10 * MIN), T0 + 12 * MIN), T0 + 32 * MIN);
  const { id, fields } = liveToCardio(s, { hk: { uuid: 'U-1', kcal: 301.6, distanceM: 4200.4, avgHr: 151.2, maxHr: 170.4 }, weightKg: 80 });
  eq(id, 'live_x');
  eq(fields.duration_min, 30);
  eq(fields.calories, 302);
  eq(fields.distance_km, 4.2);
  eq(fields.avg_hr, 151);
  eq(fields.hk_uuid, 'U-1');
  eq(fields.hk_source, 'Forge');
  const jog = liveToCardio(endLive(newLive('jog_in_place', T0, 'live_j'), T0 + 10 * MIN), { hk: { uuid: 'U-2', kcal: 0, distanceM: 900 }, weightKg: 80 });
  eq(jog.fields.distance_km, null);
  eq(jog.fields.calories, Math.round(8.0 * 80 * (10 / 60)));
  const web = liveToCardio(endLive(newLive('walk', T0, 'live_w'), T0 + 20 * MIN), { hk: null, weightKg: 70 });
  eq(web.fields.hk_uuid, undefined);
  eq(web.fields.calories, Math.round(3.8 * 70 / 3));
});

test('no duplicate against the Apple Health import (#146): by metadata and by the stored Health uuid', () => {
  const hkw = (extra = {}) => ({ platformId: 'U-1', startDate: '2026-10-22T10:00:00Z', endDate: '2026-10-22T10:30:00Z', duration: 1800, workoutActivityType: 'running', sourceName: 'Forge', ...extra });
  eq(planWorkoutImport([hkw({ metadata: { ForgeWorkoutId: 'live_x' } })]).create.length, 0, 'metadata');
  eq(planWorkoutImport([hkw({ sourceId: 'com.christianeverett.forge' })]).create.length, 0, 'source');
  const cardio = [{ id: 'live_x', live_id: 'live_x', hk_uuid: 'U-1' }];
  assert(alreadyLive(cardio, 'U-1'));
  eq(planWorkoutImport([hkw()], { cardio }).create.length, 0, 'uuid on the Forge row');
  eq(planWorkoutImport([hkw()], { cardio: [] }).create.length, 1, 'a real Watch workout still imports');
  assert(!alreadyLive([{ id: 'live_x', live_id: 'live_x', hk_uuid: 'U-1', deleted: true }], 'U-1'));
});

test('0.16.51 wiring: version, service worker, route, native methods, plist keys, project files', () => {
  eq(VERSION, '0.16.51');
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert(read('sw.js').includes("const VERSION = '0.16.51'"));
  for (const f of ['js/workouts/live-core.js', 'js/native/live-workout.js', 'js/screens/live.js', 'css/live.css']) assert(read('sw.js').includes('./' + f), f + ' cached');
  assert(read('index.html').includes('css/live.css'));
  assert(read('js/app.js').includes("live: () => import('./screens/live.js')"));
  const plugin = read('ios/App/App/ForgeWorkoutsPlugin.swift');
  for (const m of ['startLive', 'pauseLive', 'resumeLive', 'endLive', 'liveState']) assert(plugin.includes(`name: "${m}"`), m);
  const plist = read('ios/App/App/Info.plist');
  assert(plist.includes('NSSupportsLiveActivities') && plist.includes('NSMotionUsageDescription'));
  const proj = read('ios/App/App.xcodeproj/project.pbxproj');
  assert(proj.includes('ForgeLiveWorkout.swift in Sources') && proj.includes('ForgeLiveShared.swift in Sources'));
  assert(read('ios/App/App/ForgeLiveWorkout.swift').includes('HKLiveWorkoutBuilder'));
  assert(read('ios/App/ForgeLiveActivity/ForgeLiveActivityBundle.swift').includes('DynamicIsland'));
});

test('iPhone-only end: the MET estimate is the fallback energy when weight is known, 0 when it is not (the rings still move)', () => {
  const ended = endLive(newLive('run', T0, 'live_f'), T0 + 30 * MIN);
  const withWeight = endPayload(ended, { weightKg: 80, settings: { health_write_workouts: true } });
  eq(withWeight.fallbackKcal, Math.round(9.8 * 80 * 0.5));
  assert(withWeight.fallbackKcal > 0);
  eq(endPayload(ended, { weightKg: null, settings: { health_write_workouts: true } }).fallbackKcal, 0);
  eq(withWeight.end, ended.ended_at);
});

test('Apple Health write for a live workout follows the same off-by-default switch as #147', () => {
  const ended = endLive(newLive('walk', T0, 'live_h'), T0 + 10 * MIN);
  assert(!healthWriteWanted(undefined) && !healthWriteWanted({}) && !healthWriteWanted({ health_write_workouts: false }));
  assert(healthWriteWanted({ health_write_workouts: true }));
  eq(endPayload(ended, { weightKg: 70, settings: {} }).save, false, 'a missing setting means no Health write');
  eq(endPayload(ended, { weightKg: 70, settings: null }).save, false);
  eq(endPayload(ended, { weightKg: 70, settings: { health_write_workouts: true } }).save, true);
});

test('pause AND resume on the lock screen while backgrounded: the phone keeps the pauses, so Forge and Health agree', () => {
  // The screen never heard: the user paused at +10 and resumed at +14 from the lock screen; the app came back at +20.
  const s = newLive('run', T0, 'live_lock');
  const back = adoptNativePauses(s, { pauses: [{ start: T0 + 10 * MIN, end: T0 + 14 * MIN }] });
  assert(!isPaused(back));
  eq(activeMs(back, T0 + 20 * MIN), 16 * MIN, '20 minutes minus the 4 paused');
  eq(activeMs(s, T0 + 20 * MIN), 20 * MIN, 'without the phone\'s list the paused time was counted');
  // a pause still open when the app comes back
  const open = adoptNativePauses(s, { pauses: [], pausedAt: T0 + 18 * MIN });
  assert(isPaused(open));
  eq(activeMs(open, T0 + 30 * MIN), 18 * MIN);
  // end: the phone's closed pause list and elapsed time make the Forge row
  const ended = adoptNativePauses(endLive(s, T0 + 30 * MIN), { pauses: [{ start: T0 + 10 * MIN, end: T0 + 14 * MIN }, { start: T0 + 20 * MIN, end: T0 + 22 * MIN }] });
  eq(activeMs(ended, ended.ended_at), 24 * MIN);
  eq(liveToCardio(ended, { hk: { uuid: 'U-9', kcal: 200 }, weightKg: 80 }).fields.duration_min, 24);
  eq(liveToCardio(ended, { hk: { uuid: 'U-9', kcal: 200, elapsedMs: 31 * MIN }, weightKg: 80 }).fields.duration_min, 31, 'the phone\'s own elapsed time is the truth');
  // junk from native is ignored
  eq(adoptNativePauses(s, {}), s);
  eq(adoptNativePauses(s, { pauses: [{ start: 'x', end: 1 }, { start: 5, end: 2 }] }).pauses.length, 0);
});

test('Swift keeps the real pause / resume moments, returns them with the elapsed time, prepares the session, reports failures', () => {
  const sw = readFileSync(new URL('../ios/App/App/ForgeLiveWorkout.swift', import.meta.url), 'utf8');
  assert(sw.includes('pauseLog.append') && sw.includes('"pauses"') && sw.includes('"elapsed"') && sw.includes('"elapsedMs"') && sw.includes('"pausedAt"'));
  assert(sw.includes('session.prepare()') && sw.indexOf('session.prepare()') < sw.indexOf('session.startActivity(with: start)'), 'prepare before the session starts');
  assert(/didFailWithError[\s\S]*"failed"/.test(sw), 'a failed session tells the screen');
});

test('the Xcode project has a real ForgeLiveActivity extension target that Refresh Forge builds and embeds', () => {
  const proj = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const bare = proj.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"/g, '""');
  eq(bare.split('{').length, bare.split('}').length, 'braces balance');
  eq(bare.split('(').length, bare.split(')').length, 'parentheses balance');
  const defined = new Set([...proj.matchAll(/\b([0-9A-F]{24})\b(?: \/\*[^*]*\*\/)? = \{/g)].map((m) => m[1]));
  const used = new Set(proj.match(/\b[0-9A-F]{24}\b/g));
  for (const id of used) assert(defined.has(id), `${id} is used but never defined`);
  const obj = (id) => {
    const at = proj.search(new RegExp(`\\b${id}\\b(?: /\\*[^*]*\\*/)? = \\{`));
    const i = proj.indexOf('{', at);
    let depth = 0;
    for (let j = i; j < proj.length; j++) { if (proj[j] === '{') depth++; else if (proj[j] === '}' && --depth === 0) return proj.slice(i, j + 1); }
    return '';
  };
  const ids = (text) => [...text.matchAll(/\b([0-9A-F]{24})\b/g)].map((m) => m[1]);
  const isa = (id, kind) => new RegExp(`isa = ${kind};`).test(obj(id));
  const targets = [...defined].filter((id) => isa(id, 'PBXNativeTarget')).map((id) => ({ id, t: obj(id) }));
  const ext = targets.find((x) => /name = ForgeLiveActivity;/.test(x.t));
  const app = targets.find((x) => /name = App;/.test(x.t));
  assert(ext && app, 'both targets exist');
  assert(ext.t.includes('productType = "com.apple.product-type.app-extension"'));
  // The file names each target's Sources phase builds
  const sourcesOf = (t) => {
    const phase = ids(t.t).find((id) => isa(id, 'PBXSourcesBuildPhase'));
    const files = obj(phase).replace(/^[\s\S]*?files = \(/, '');
    return ids(files).map((bf) => { const ref = obj(bf).match(/fileRef = ([0-9A-F]{24})/); return ref ? (obj(ref[1]).match(/path = ([\w.]+);/) || [])[1] : null; });
  };
  const extSrc = sourcesOf(ext), appSrc = sourcesOf(app);
  assert(extSrc.includes('ForgeLiveActivityBundle.swift') && extSrc.includes('ForgeLiveShared.swift'), 'extension sources: ' + extSrc);
  assert(appSrc.includes('ForgeLiveShared.swift') && appSrc.includes('ForgeLiveWorkout.swift'), 'app sources: ' + appSrc);
  // App depends on the extension and embeds it in Foundation Extensions (dstSubfolderSpec 13)
  const dep = ids(app.t).map(obj).find((o) => /isa = PBXTargetDependency;/.test(o));
  assert(dep && dep.includes(`target = ${ext.id}`), 'App depends on the extension');
  const embed = ids(app.t).map(obj).find((o) => /isa = PBXCopyFilesBuildPhase;/.test(o));
  assert(embed && /dstSubfolderSpec = 13;/.test(embed) && embed.includes('ForgeLiveActivity.appex'), 'embedded in Foundation Extensions');
  // Build settings
  const cfgs = (t) => ids(obj(ids(t.t).find((id) => isa(id, 'XCConfigurationList')))).map(obj).filter((o) => /isa = XCBuildConfiguration;/.test(o));
  const extCfgs = cfgs(ext), appCfgs = cfgs(app);
  eq(extCfgs.length, 2);
  for (const c of extCfgs) {
    for (const need of ['PRODUCT_BUNDLE_IDENTIFIER = com.christianeverett.forge.ForgeLiveActivity;', 'CODE_SIGN_STYLE = Automatic;', 'INFOPLIST_FILE = ForgeLiveActivity/Info.plist;',
      'IPHONEOS_DEPLOYMENT_TARGET = 17.0;', 'SKIP_INSTALL = YES;', 'SWIFT_VERSION = 5.0;', 'TARGETED_DEVICE_FAMILY = 1;',
      'LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks";']) assert(c.includes(need), need);
    assert(!c.includes('DEVELOPMENT_TEAM'), 'no hard-coded team');
    assert(!/APPLICATION_GROUPS|app-group/i.test(c), 'no App Group');
    for (const key of ['MARKETING_VERSION', 'CURRENT_PROJECT_VERSION']) eq(c.match(new RegExp(`${key} = ([^;]+);`))[1], appCfgs[0].match(new RegExp(`${key} = ([^;]+);`))[1], key + ' matches the app');
  }
  for (const c of appCfgs) assert(c.includes('IPHONEOS_DEPLOYMENT_TARGET = 15.0;'), 'the app stays at iOS 15');
  assert(existsSync(new URL('../ios/App/ForgeLiveActivity/Info.plist', import.meta.url)));
  assert(readFileSync(new URL('../scripts/Refresh Forge.command', import.meta.url), 'utf8').includes('ForgeLiveActivity'), 'Refresh Forge knows the extension');
  const setup = readFileSync(new URL('../docs/ios-setup.md', import.meta.url), 'utf8');
  assert(!/New → Target/.test(setup) && setup.includes('nothing to do'), 'no manual Xcode step is asked for');
});

test('Health copy matches the behaviour: off until switched on, distance listed; discard, run/walk icons and the live chip exist', () => {
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const plist = read('ios/App/App/Info.plist');
  assert(plist.includes('walking and running distance') && plist.includes('It is off until you turn it on'));
  assert(read('docs/app-store-checklist.md').includes('off by default, for live workouts too'));
  const screen = read('js/screens/live.js');
  assert(screen.includes('data-discard') && screen.includes('live.discard()') && screen.includes('data-health') && screen.includes('SHORT_WORKOUT'));
  assert(!read('js/native/live-workout.js').includes('!== false'));
  const icons = read('js/ui/icons.js');
  assert(/^\s+run: /m.test(icons) && /^\s+walk: /m.test(icons));
  assert(read('js/screens/train.js').includes('bindLiveChips') && read('js/screens/today.js').includes('livePillHtml'));
});

test('running-screen note tells the truth about Apple Health', () => {
  const b = { failed: false, nativeLive: true, activity: false, healthOn: false, inApp: true };
  eq(liveNote(b), 'Kept in Forge. Apple Health is off for this one.');
  eq(liveNote({ ...b, healthOn: true }), 'Saving to Apple Health when you end.');
  eq(liveNote({ ...b, activity: true }), 'On your lock screen. Kept in Forge.');
  eq(liveNote({ ...b, activity: true, healthOn: true }), 'On your lock screen. Saving to Apple Health when you end.');
  eq(liveNote({ ...b, nativeLive: false }), 'Kept in Forge. Live Apple Health workouts need iOS 26.');
  eq(liveNote({ ...b, nativeLive: false, inApp: false }), 'Kept in Forge. Open the iPhone app to also fill your Apple rings.');
  assert(liveNote({ ...b, failed: true }).includes('stopped'));
});
