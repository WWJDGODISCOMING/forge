// v0.16.59 (#196): the live workout session logic, run for real against a mock ForgeWorkouts plugin and storage, for
// every kind (Jog in place, Walk, Run). js/native/live-session.js takes its plugin and storage as arguments, so
// none of this needs Firebase or a browser.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import { createLiveSession, KEY } from '../js/native/live-session.js';
import { LIVE_ORDER, LIVE_KINDS } from '../js/workouts/live-core.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const body = (src, start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a + 1); return src.slice(a, b < 0 ? undefined : b); };
const KINDS = LIVE_ORDER; // jog_in_place, walk, run
const WAIT = 40; // the native cap, shortened for the tests
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function rig({ hang = [], settings = { health_write_workouts: true }, nativeId = true } = {}) {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const calls = [];
  const rows = [];
  let nativeRunning = null; // what the "phone" thinks is running
  let listener = null;
  let hung = hang;
  const releases = [];
  const never = new Promise(() => {});
  const plugin = {
    requestAuthorization: async () => ({}),
    addListener: (name, fn) => { listener = fn; return { remove() {} }; },
    startLive: async (o) => { calls.push(['startLive', o.id]); nativeRunning = { id: o.id }; return { liveActivity: true }; },
    pauseLive: async () => { calls.push(['pauseLive']); return {}; },
    resumeLive: async () => { calls.push(['resumeLive']); return {}; },
    liveState: async () => {
      calls.push(['liveState']);
      if (hung.includes('liveState')) return never;
      return nativeRunning ? { paused: false, at: Date.now(), kcal: 1, ...(nativeId ? { id: nativeRunning.id } : {}) } : {};
    },
    endLive: (o) => {
      calls.push(['endLive', o]);
      if (hung.includes('endLive')) return new Promise((res) => { releases.push(() => { nativeRunning = null; res({ uuid: 'hk-1' }); }); }); // answers only when released
      nativeRunning = null;
      return Promise.resolve(o && o.save === false ? {} : { uuid: 'hk-1', kcal: 50, elapsedMs: 120000 });
    },
  };
  const live = createLiveSession({
    plugin: () => plugin, storage: () => storage, waitMs: WAIT, settings: () => settings, weightKg: () => 70, miles: () => true,
    cardio: () => rows, saveRow: (r) => rows.push({ id: r.id, ...r.fields }),
  });
  return { live, store, calls, rows, plugin, emit: (e) => listener && listener(e), stray: (id) => { nativeRunning = { id }; }, running: () => nativeRunning, setHang: (h) => { hung = h; }, release: () => { releases.splice(0).forEach((f) => f()); } };
}
const endCalls = (r) => r.calls.filter((c) => c[0] === 'endLive');

for (const kind of KINDS) {
  test(`${kind}: discard stops everything, saves nothing, and nothing comes back after a reload`, async () => {
    const r = rig();
    await r.live.start(kind);
    assert(r.live.isActive() && r.store.has(KEY), 'running and persisted');
    await r.live.discard();
    assert(!r.live.isActive() && r.live.current() === null && !r.store.has(KEY), 'cleared in memory and storage');
    eq(endCalls(r).length, 1);
    eq(endCalls(r)[0][1].save, false);
    eq(r.rows.length, 0, 'nothing saved to Forge');
    eq(r.running(), null, 'the phone stopped too');
    assert(r.live.restore() === null && !r.live.isActive(), 'restore after discard brings nothing back');
    // a reload: a new module instance over the same storage (even with the old payload left behind)
    const reloaded = rig();
    assert(reloaded.live.restore() === null);
  });

  test(`${kind}: End and save finishes once, saves one row, and a reload brings nothing back`, async () => {
    const r = rig();
    await r.live.start(kind);
    const id = r.live.current().id;
    const row = await r.live.finish();
    eq(row.id, id);
    eq(r.rows.length, 1);
    eq(r.rows[0].activity, kind);
    assert(!r.live.isActive() && !r.store.has(KEY));
    eq(endCalls(r)[0][1].save, true, 'the Health setting is passed on');
    assert(r.live.restore() === null, 'nothing comes back');
    assert((await r.live.finish()) === null, 'a second End does nothing');
    eq(r.rows.length, 1, 'no double save');
  });

  test(`${kind}: End when native endLive never answers still finishes within the cap, with the done row`, async () => {
    const r = rig({ hang: ['endLive'] });
    await r.live.start(kind);
    const t0 = Date.now();
    const row = await r.live.finish();
    const took = Date.now() - t0;
    assert(row && row.fields.activity === kind, 'the done screen gets a row');
    assert(took < WAIT * 4, `finished in ${took}ms, the cap is ${WAIT}ms`);
    eq(r.rows.length, 1);
    assert(!r.live.isActive() && !r.store.has(KEY));
    assert(r.live.restore() === null, 'nothing comes back after a timed-out end');
  });

  test(`${kind}: discard when native endLive never answers returns within the cap and stays discarded`, async () => {
    const r = rig({ hang: ['endLive'] });
    await r.live.start(kind);
    const t0 = Date.now();
    await r.live.discard();
    assert(Date.now() - t0 < WAIT * 4, 'within the cap');
    assert(!r.live.isActive() && r.live.restore() === null && !r.store.has(KEY));
  });

  test(`${kind}: a late liveUpdate for an ended or discarded workout is ignored; another id never touches a running one`, async () => {
    for (const how of ['finish', 'discard']) {
      const r = rig();
      await r.live.start(kind);
      const id = r.live.current().id;
      await r.live[how]();
      let seen = 0;
      r.live.onChange(() => { seen += 1; });
      r.emit({ id, paused: true, kcal: 99, at: Date.now() });
      assert(!r.live.isActive() && r.live.current() === null && !r.store.has(KEY), `${how}: still gone`);
      eq(seen, 0, `${how}: no redraw`);
    }
    const r = rig();
    await r.live.start(kind);
    r.emit({ id: 'other', paused: true, kcal: 99 });
    assert(!r.live.current().pausedAt && r.live.liveMetrics().kcal === 0, 'another workout id is ignored');
    r.emit({ id: r.live.current().id, paused: true, kcal: 7, at: Date.now() });
    assert(r.live.current().pausedAt && r.live.liveMetrics().kcal === 7, 'its own update lands');
  });

  test(`${kind}: Start workout works straight after a discard and after an end`, async () => {
    for (const how of ['discard', 'finish']) {
      const r = rig();
      await r.live.start(kind);
      const first = r.live.current().id;
      await r.live[how]();
      assert(!r.live.isActive(), `${how}: nothing blocks Start`);
      await tick(3); // a new id needs a new millisecond
      const s = await r.live.start(kind);
      assert(s && r.live.isActive() && s.id !== first, `${how}: a fresh workout runs`);
      eq(r.live.current().kind, kind);
    }
  });

  test(`${kind}: a saved session that already ended, or of an unknown kind, is dropped, not revived`, () => {
    const r = rig();
    r.store.set(KEY, JSON.stringify({ session: { id: 'x', kind, started_at: 1, ended_at: 5, pauses: [], pausedAt: null }, metrics: {} }));
    assert(r.live.restore() === null && !r.store.has(KEY));
    r.store.set(KEY, JSON.stringify({ session: { id: 'y', kind: 'swim', started_at: 1, ended_at: null, pauses: [], pausedAt: null }, metrics: {} }));
    assert(r.live.restore() === null && !r.store.has(KEY), 'unknown kind dropped');
  });

  test(`${kind}: a really running saved session is picked up, and restore is idempotent`, () => {
    const r = rig();
    r.store.set(KEY, JSON.stringify({ session: { id: 'z', kind, started_at: Date.now() - 5000, ended_at: null, pauses: [], pausedAt: null }, metrics: { nativeLive: true } }));
    const a = r.live.restore();
    assert(a && a.kind === kind);
    assert(r.live.restore() === a && r.live.isActive());
  });
}

test('native zombie: a phone session Forge has lost (storage gone) is ended without saving', async () => {
  const r = rig();
  r.stray('lost-1');
  eq(await r.live.reconcile(), 'ended');
  eq(endCalls(r).length, 1);
  eq(endCalls(r)[0][1].save, false);
  eq(r.running(), null);
  eq(await r.live.reconcile(), 'none', 'nothing left to end');
});

test('native zombie: reconcile leaves a running Forge workout alone', async () => {
  const r = rig();
  await r.live.start('run');
  eq(await r.live.reconcile(), 'none');
  eq(endCalls(r).length, 0);
});

for (const kind of KINDS) {
  for (const how of ['finish', 'discard']) {
    test(`${kind}: a capped ${how} sends exactly one native end while it is pending, and nothing after it settles`, async () => {
      const r = rig({ hang: ['endLive'] });
      await r.live.start(kind);
      await r.live[how](); // times out; the phone keeps reporting the workout until the first end settles
      await tick(WAIT * 2);
      eq(await r.live.reconcile(), 'none', 'no second end while the first is out');
      r.live.restore(); await r.live.refresh(); // launch / foreground paths too
      await tick(WAIT * 2);
      eq(endCalls(r).length, 1, 'exactly one endLive');
      assert(r.running(), 'the phone still reports it (hung)');
      r.release(); // the first end finally settles and the phone is clear
      await tick(5);
      eq(await r.live.reconcile(), 'none');
      eq(endCalls(r).length, 1, 'still exactly one');
    });
  }
}

test('reconcile treats a phone snapshot marked ending as nothing running', async () => {
  const r = rig();
  r.plugin.liveState = async () => ({ ending: true, id: 'x' });
  eq(await r.live.reconcile(), 'none');
  eq(endCalls(r).length, 0);
});

test('native zombie: once the timed-out end has settled but the phone still holds the workout, it is ended again without saving a second time', async () => {
  for (const nativeId of [true, false]) { // newer builds report the id; older ones don't
    const r = rig({ hang: ['endLive'], nativeId });
    await r.live.start('walk');
    const id = r.live.current().id;
    await r.live.finish(); // times out; the phone still thinks it is running
    r.release(); // the first call settles without clearing the phone (e.g. it failed)
    await tick(5);
    r.setHang([]);
    r.stray(id);
    eq(await r.live.reconcile(), 'ended');
    const last = endCalls(r).pop();
    eq(last[1].save, false, `nativeId ${nativeId}: the first call settled (it saved), so the retry never saves again`);
    eq(r.running(), null);
  }
});

test('native zombie: a different stray id is ended with save:false, even right after a capped end', async () => {
  const r = rig({ hang: ['endLive'] });
  await r.live.start('run');
  await r.live.finish();
  r.release();
  await tick(5);
  r.setHang([]);
  r.stray('someone-else');
  await r.live.reconcile();
  eq(endCalls(r).pop()[1].save, false);
});

test('native zombie: restore() with nothing saved checks the phone, and Start clears a stray first', async () => {
  const r = rig();
  r.stray('old');
  assert(r.live.restore() === null);
  await tick(WAIT);
  eq(r.running(), null, 'restore reconciled in the background');
  r.stray('old2');
  await r.live.start('jog_in_place');
  assert(endCalls(r).some((c) => c[1].save === false), 'the stray was ended before the new start');
  eq(r.running().id, r.live.current().id, 'the phone now runs the new one');
});

test('native zombie: a silent liveState never hangs Start', async () => {
  const r = rig({ hang: ['liveState'] });
  const t0 = Date.now();
  await r.live.start('walk');
  assert(Date.now() - t0 < WAIT * 6 && r.live.isActive());
});

test('discard during a slow native start does not leave the phone running', async () => {
  const r = rig();
  let release;
  r.plugin.startLive = (o) => new Promise((res) => { release = () => { r.stray(o.id); res({ liveActivity: true }); }; });
  const starting = r.live.start('run');
  await tick(5);
  await r.live.discard();
  release();
  await starting;
  await tick(3);
  eq(r.running(), null, 'ended as soon as the phone finished starting');
  assert(!r.live.isActive());
});

test('the early skeleton exit is read-only: only Today and Train, and everything that remembers waits for full data', () => {
  const a = read('js/app.js');
  assert(a.includes("const EARLY_ROUTES = new Set(['today', 'train'])") && a.includes('EARLY_ROUTES.has(currentRoute())'));
  const st = read('js/state.js');
  assert(st.includes('get partial()') && st.includes('LOADED_KEYS.some'));
  const ms = read('js/missions/store.js');
  for (const fn of ['ensureStarted', 'setMissionSetting', 'rememberDone', 'recordCelebrated', 'recordPerfectWeek']) {
    assert(body(ms, `function ${fn}`, '\n}\n').includes('state.partial'), `${fn} waits for full data`);
  }
  const ui = read('js/missions/ui.js');
  for (const fn of ['afterMissionsRender', 'badgeCelebrationCards', 'afterBadgeCelebrations']) assert(body(ui, `function ${fn}`, '\n}\n').includes('state.partial'), `${fn} waits for full data`);
  assert(read('js/workouts/awards-store.js').includes('state.partial'), 'rememberBadges waits for full data');
});

test('the live screen styles ship with the app shell, and a cold #/live draws the picker unless a workout really exists', () => {
  assert(read('index.html').includes('<link rel="stylesheet" href="css/live.css">'), 'in the main stylesheet set');
  const sw = read('sw.js');
  assert(sw.includes("'./css/live.css'") && sw.includes("'./js/native/live-session.js'"), 'precached');
  assert(read('scripts/build-www.mjs').includes("'css'"), 'copied into the native app');
  const r = body(read('js/screens/live.js'), 'export function renderLive', '\n}\n');
  assert(r.indexOf('live.restore()') < r.indexOf('showRunning(el)') && r.indexOf('showRunning(el)') < r.indexOf('pickerHtml()'), 'the timer only when a session exists, else the picker');
  const app = read('js/app.js');
  assert(app.includes('m.restore();') && app.includes('m.reconcile()'), 'launch reconciles the phone');
});

test('Walk and Run are covered by the same tests as Jog', () => {
  eq(KINDS.join(), 'jog_in_place,walk,run');
  for (const k of KINDS) assert(LIVE_KINDS[k], k);
});
