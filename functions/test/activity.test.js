// Withings steps (getactivity): parsing, the Apple Health merge, scope, webhook routing. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb, fakeApi, fakeQueue } from './fake-db.js';
import { parseActivity, hasActivityScope, syncActivity, upsertWithingsSteps, stripWithingsSteps } from '../src/activity.js';
import { upsertDays, resolveSteps, deleteAppleData } from '../src/health.js';
import { handleWebhook, notifyTaskId } from '../src/webhook.js';
import { runTask } from '../src/tasks.js';
import { handleCallback, startAuth } from '../src/oauth.js';
import { maintainUser, disconnect } from '../src/maintenance.js';
import { makeClient, SCOPE } from '../src/withings-api.js';
import { P } from '../src/paths.js';

const UID = 'u1';
const KEY = 'k'.repeat(48);
const T0 = Date.parse('2026-10-10T15:00:00Z');
const act = (date, steps) => ({ date, steps, timezone: 'America/New_York' });

async function connected(db, scopes = 'user.info,user.metrics,user.activity') {
  await db.doc(P.priv(UID)).set({ access_token: 'AT', refresh_token: 'RT', expires_at: T0 + 3600000, withings_userid: '424242', cursor: 1 });
  await db.doc(P.status(UID)).set({ connected: true, scopes });
  await db.doc(P.wuser('424242')).set({ uid: UID });
}

test('parse: valid dates and whole plausible step counts only', () => {
  const out = parseActivity({ activities: [act('2026-10-09', 8123), act('2026-10-10', 0), act('nope', 5), act('2026-10-08', -4), act('2026-10-07', 900000), { date: '2026-10-06' }, act('2026-10-05', 4999.6)] });
  assert.deepEqual(out, [{ day: '2026-10-09', steps: 8123 }, { day: '2026-10-10', steps: 0 }, { day: '2026-10-05', steps: 5000 }]);
  assert.deepEqual(parseActivity({}), []);
});

test('merge: higher of Apple and Withings wins, the source is recorded, nothing is added together', () => {
  assert.deepEqual(pick(resolveSteps({ apple_steps: 6000, withings_steps: 7500 })), { steps: 7500, steps_source: 'withings' });
  assert.deepEqual(pick(resolveSteps({ apple_steps: 9000, withings_steps: 7500 })), { steps: 9000, steps_source: 'apple' });
  assert.deepEqual(pick(resolveSteps({ apple_steps: 7500, withings_steps: 7500 })), { steps: 7500, steps_source: 'apple' }, 'a tie stays Apple');
  assert.deepEqual(pick(resolveSteps({ withings_steps: 3000 })), { steps: 3000, steps_source: 'withings' });
  assert.deepEqual(pick(resolveSteps({ steps: 4000 })), { steps: 4000, steps_source: 'apple' }, 'an older doc has Apple steps and no apple_steps');
  assert.deepEqual(pick(resolveSteps({ steps: 4000, withings_steps: 5000 })), { steps: 5000, steps_source: 'withings' });
});
const pick = (d) => ({ steps: d.steps, steps_source: d.steps_source });

test('merge in Firestore: either order gives the same day, a later Apple post can win back, repeats write nothing', async () => {
  const db = fakeDb();
  const day = '2026-10-09';
  await upsertWithingsSteps({ db, uid: UID, days: [{ day, steps: 7000 }], now: () => T0 });
  let d = db.dump(P.health(UID, day));
  assert.equal(d.steps, 7000);
  assert.equal(d.steps_source, 'withings');
  assert.deepEqual(d.sources, ['withings']);
  await upsertDays({ db, uid: UID, days: [{ day, fields: { steps: 6500 } }], source: 'apple_shortcut', now: () => T0 });
  d = db.dump(P.health(UID, day));
  assert.equal(d.steps, 7000);
  assert.equal(d.steps_source, 'withings');
  assert.equal(d.apple_steps, 6500);
  await upsertDays({ db, uid: UID, days: [{ day, fields: { steps: 8200 } }], source: 'apple_shortcut', now: () => T0 });
  d = db.dump(P.health(UID, day));
  assert.equal(d.steps, 8200, 'Apple went higher: not 8200 + 7000');
  assert.equal(d.steps_source, 'apple');
  assert.equal(d.withings_steps, 7000);
  const before = db.stats.writes;
  await upsertWithingsSteps({ db, uid: UID, days: [{ day, steps: 7000 }], now: () => T0 + 1000 });
  assert.equal(db.stats.writes, before, 'the same numbers again are no write');
});

test('merge: a day you deleted stays deleted', async () => {
  const db = fakeDb();
  await db.doc(P.health(UID, '2026-10-09')).set({ id: '2026-10-09', day: '2026-10-09', deleted: true });
  const r = await upsertWithingsSteps({ db, uid: UID, days: [{ day: '2026-10-09', steps: 5000 }], now: () => T0 });
  assert.deepEqual(r, { written: 0, skipped: 1 });
  assert.equal(db.dump(P.health(UID, '2026-10-09')).steps, undefined);
});

test('sync: asks for the last 7 days, writes under the user, records the time; idempotent', async () => {
  const db = fakeDb();
  await connected(db);
  const api = fakeApi({ getactivity: { activities: [act('2026-10-09', 7000), act('2026-10-10', 1200)] } });
  const r = await syncActivity({ db, api, uid: UID, token: 'AT', now: () => T0 });
  assert.equal(r.days, 2);
  const [, , q] = api.calls.find((c) => c[0] === 'getactivity');
  assert.deepEqual([q.startdateymd, q.enddateymd], ['2026-10-04', '2026-10-11']);
  assert.equal(db.dump(P.health(UID, '2026-10-10')).withings_steps, 1200);
  assert.ok(db.dump(P.status(UID)).activity_synced_at);
  const w = db.stats.writes;
  await syncActivity({ db, api, uid: UID, token: 'AT', now: () => T0 });
  // only the status stamp may change on a repeat, never the day docs
  assert.ok(db.stats.writes - w <= 1);
});

test('scope: without user.activity the sync is a quiet no-op and never calls Withings', async () => {
  assert.equal(hasActivityScope('user.info,user.metrics'), false);
  assert.equal(hasActivityScope('user.info,user.metrics,user.activity'), true);
  assert.equal(hasActivityScope(null), true);
  const db = fakeDb();
  await connected(db, 'user.info,user.metrics');
  const api = fakeApi();
  assert.deepEqual(await syncActivity({ db, api, uid: UID, token: 'AT', now: () => T0 }), { skipped: 'no_scope' });
  assert.ok(!api.calls.some((c) => c[0] === 'getactivity'));
});

test('client: requests the activity scope; getactivity posts the date window and steps field', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, json: async () => ({ status: 0, body: { activities: [] } }) }; };
  const c = makeClient({ fetch, clientId: 'id', clientSecret: 's' });
  assert.ok(SCOPE.split(',').includes('user.activity'));
  assert.ok(new URL(c.authorizeUrl({ redirectUri: 'https://x/cb', state: 's' })).searchParams.get('scope').includes('user.activity'));
  await c.getactivity('AT', { startdateymd: '2026-10-04', enddateymd: '2026-10-11' });
  assert.ok(calls[0].url.endsWith('/v2/measure'));
  const p = new URLSearchParams(calls[0].body);
  assert.equal(p.get('action'), 'getactivity');
  assert.equal(p.get('startdateymd'), '2026-10-04');
  assert.equal(p.get('data_fields'), 'steps');
});

test('webhook: appli 16 enqueues an activity task, appli 1 still a notify task, others are ignored', async () => {
  const db = fakeDb();
  await connected(db);
  const q = fakeQueue();
  const call = (body) => handleWebhook({ method: 'POST', query: { k: KEY }, body }, { db, enqueue: q.enqueue, key: KEY, now: () => T0 });
  assert.equal((await call({ userid: '424242', appli: '16', startdate: '2026-10-09', enddate: '2026-10-10' })).status, 200);
  assert.equal(q.tasks[0].data.kind, 'activity');
  assert.match(q.tasks[0].id, /^na-/);
  await call({ userid: '424242', appli: '1', startdate: 1, enddate: 2 });
  assert.equal(q.tasks[1].data.kind, 'notify');
  assert.equal((await call({ userid: '424242', appli: '4' })).text, 'ignored');
  assert.equal(q.tasks.length, 2);
  assert.notEqual(notifyTaskId(UID, { appli: 16 }, T0), notifyTaskId(UID, { appli: 1 }, T0));
});

test('task: activity kind syncs steps only; notify syncs weights then steps; a missing scope does not fail it', async () => {
  const db = fakeDb();
  await connected(db);
  const api = fakeApi({ getactivity: { activities: [act('2026-10-10', 4321)] }, getmeas: { measuregrps: [], updatetime: 5 } });
  const r = await runTask({ kind: 'activity', uid: UID }, { db, api, enqueue: fakeQueue().enqueue, now: () => T0 });
  assert.equal(r.days, 1);
  assert.ok(!api.calls.some((c) => c[0] === 'getmeas'));
  await runTask({ kind: 'notify', uid: UID }, { db, api, enqueue: fakeQueue().enqueue, now: () => T0 });
  assert.ok(api.calls.some((c) => c[0] === 'getmeas'));
  assert.equal(db.dump(P.health(UID, '2026-10-10')).steps, 4321);

  const db2 = fakeDb();
  await connected(db2, 'user.info,user.metrics');
  const r2 = await runTask({ kind: 'activity', uid: UID }, { db: db2, api: fakeApi(), enqueue: fakeQueue().enqueue, now: () => T0 });
  assert.equal(r2.skipped, 'no_scope');
});

test('task: a rate limit on the activity task is retried; on a combined sync it never fails the weights', async () => {
  const { WithingsError } = await import('../src/withings-api.js');
  const db = fakeDb();
  await connected(db);
  const api = fakeApi({ getactivity: new WithingsError(601, 'getactivity'), getmeas: { measuregrps: [], updatetime: 5 } });
  await assert.rejects(runTask({ kind: 'activity', uid: UID }, { db, api, enqueue: fakeQueue().enqueue, now: () => T0 }), (e) => e.transient);
  await runTask({ kind: 'manual', uid: UID }, { db, api, enqueue: fakeQueue().enqueue, now: () => T0 });
  assert.equal(db.dump(P.status(UID)).activity_error, '601');
});

test('connect: subscribes to appli 16 as well as 1 and pulls steps; no scope granted → no activity calls', async () => {
  for (const [scope, wantActivity] of [['user.info,user.metrics,user.activity', true], ['user.info,user.metrics', false]]) {
    const db = fakeDb();
    const api = fakeApi({ requestToken: { userid: 424242, access_token: 'AT', refresh_token: 'RT', expires_in: 10800, scope }, getactivity: { activities: [act('2026-10-10', 999)] } });
    const { url } = await startAuth({ db, api, uid: UID, redirectUri: 'https://x/cb', now: () => T0 });
    const state = new URL(url).searchParams.get('state');
    await handleCallback({ state, code: 'c' }, { db, api, enqueue: fakeQueue().enqueue, redirectUri: 'https://x/cb', webhookUrl: 'w', appUrl: 'a/', now: () => T0, newRunId: () => 'r' });
    const applis = api.calls.filter((c) => c[0] === 'notifySubscribe').map((c) => c[3]);
    assert.deepEqual(applis, wantActivity ? [1, 16] : [1]);
    assert.equal(db.dump(P.health(UID, '2026-10-10')) != null && db.dump(P.health(UID, '2026-10-10')).steps === 999, wantActivity);
    assert.equal(db.dump(P.status(UID)).subscription_ok, true, 'weigh-in notifications are unaffected');
  }
});

test('maintenance keeps the activity subscription alive; disconnect revokes it and delete-data removes only Withings steps', async () => {
  const db = fakeDb();
  await connected(db);
  const api = fakeApi({ notifyList: { profiles: [] }, getactivity: { activities: [act('2026-10-10', 3000), act('2026-10-09', 2000)] }, getmeas: { measuregrps: [], updatetime: 5 } });
  await maintainUser({ db, api, enqueue: fakeQueue().enqueue, uid: UID, webhookUrl: 'w', now: () => T0 });
  assert.deepEqual(api.calls.filter((c) => c[0] === 'notifySubscribe').map((c) => c[3]), [1, 16]);
  await upsertDays({ db, uid: UID, days: [{ day: '2026-10-10', fields: { steps: 3500 } }], source: 'apple_shortcut', now: () => T0 });
  await stripWithingsSteps({ db, uid: UID, now: () => T0 });
  assert.equal(db.dump(P.health(UID, '2026-10-09')), undefined, 'a Withings-only day is removed');
  const kept = db.dump(P.health(UID, '2026-10-10'));
  assert.equal(kept.steps, 3500);
  assert.equal(kept.steps_source, 'apple');
  assert.equal(kept.withings_steps, undefined);
  const api2 = fakeApi();
  await disconnect({ db, api: api2, uid: UID, webhookUrl: 'w', now: () => T0 });
  assert.deepEqual(api2.calls.filter((c) => c[0] === 'notifyRevoke').map((c) => c[3]), [1, 16]);
});

test('delete Apple Health data: Withings steps stay (and win), Apple-only days go, safe to run twice', async () => {
  const db = fakeDb();
  await connected(db);
  await upsertDays({ db, uid: UID, days: [{ day: '2026-10-08', fields: { steps: 6000, resting_hr: 55 } }, { day: '2026-10-09', fields: { steps: 9000, resting_hr: 56 } }], source: 'apple_shortcut', now: () => T0 });
  await upsertWithingsSteps({ db, uid: UID, days: [{ day: '2026-10-09', steps: 7000 }], now: () => T0 });
  assert.equal(db.dump(P.health(UID, '2026-10-09')).steps_source, 'apple');
  for (let i = 0; i < 2; i++) {
    const r = await deleteAppleData({ db, uid: UID, now: () => T0 });
    assert.equal(r.deleted, i === 0 ? 1 : 0);
    assert.equal(db.dump(P.health(UID, '2026-10-08')), undefined, 'an Apple-only day is deleted');
    const kept = db.dump(P.health(UID, '2026-10-09'));
    assert.equal(kept.steps, 7000);
    assert.equal(kept.steps_source, 'withings');
    assert.equal(kept.withings_steps, 7000);
    assert.equal(kept.apple_steps, undefined);
    assert.equal(kept.resting_hr, undefined);
    assert.deepEqual(kept.sources, ['withings']);
  }
});
