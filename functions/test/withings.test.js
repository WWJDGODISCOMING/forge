// Functions logic, no network: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb, fakeApi, fakeQueue } from './fake-db.js';
import { decodeValue, METRIC_OF_TYPE } from '../src/meastypes.js';
import { decodeGroup, weightMirror, dayIn, rawHash } from '../src/decode.js';
import { applyGroups, incrementalSync, reconcile90, getmeasSafe } from '../src/sync.js';
import { handleWebhook, notifyTaskId } from '../src/webhook.js';
import { runTask, requestBackfill, backfillTaskId, MAX_PAGES, reimport } from '../src/tasks.js';
import { getAccessToken, NotConnected, withToken, NeedsReconnect } from '../src/tokens.js';
import { startAuth, consumeState, handleCallback } from '../src/oauth.js';
import { runDataCheck, saveReport, walkHistory } from '../src/datacheck.js';
import { maintainUser, maintainAll, disconnect, expireStates } from '../src/maintenance.js';
import { WithingsError, makeClient } from '../src/withings-api.js';
import { clean, log, setSink } from '../src/log.js';
import { P } from '../src/paths.js';

const UID = 'u1';
const WUSER = '424242';
const T0 = Date.parse('2026-10-10T11:00:00Z'); // 7:00 New York
const KEY = 'k'.repeat(48);
const sec = (ms) => Math.floor(ms / 1000);

// A Body Comp-style group: weight, fat %, fat mass, FFM, muscle, water, bone, standing HR, + one segment.
function group(grpid, atMs, kg = 82.3, extra = {}) {
  return {
    grpid, attrib: 0, date: sec(atMs), created: sec(atMs) + 5, modified: sec(atMs) + 5, category: 1, timezone: 'America/New_York',
    measures: [
      { type: 1, value: Math.round(kg * 1000), unit: -3 },
      { type: 6, value: 2140, unit: -2 },
      { type: 8, value: 17612, unit: -3 },
      { type: 5, value: 64688, unit: -3 },
      { type: 76, value: 61500, unit: -3 },
      { type: 77, value: 45100, unit: -3 },
      { type: 88, value: 3188, unit: -3 },
      { type: 11, value: 64, unit: 0 },
    ],
    ...extra,
  };
}

function connected(db, { expiresIn = 3 * 3600 * 1000, now = T0 } = {}) {
  db.put(P.priv(UID), { access_token: 'AT0', refresh_token: 'RT0', expires_at: now + expiresIn, lease_until: 0, withings_userid: WUSER, cursor: sec(now) - 3600 });
  db.put(P.wuser(WUSER), { uid: UID });
  db.put(P.status(UID), { connected: true, model: 'Body Comp' });
}

// ---------- decoding ----------
test('decode: value × 10^unit without float noise; types map to metric keys; segments by position', () => {
  assert.equal(decodeValue(82300, -3), 82.3);
  assert.equal(decodeValue(2140, -2), 21.4);
  assert.equal(decodeValue(64, 0), 64);
  assert.equal(METRIC_OF_TYPE[170], 'visceral_fat');
  const g = group(1, T0, 82.3, {});
  g.measures.push({ type: 174, value: 2100, unit: -3, position: 12 }, { type: 175, value: 3300, unit: -3, position: 2 });
  const b = decodeGroup(g);
  assert.equal(b.metrics.weight_kg, 82.3);
  assert.equal(b.metrics.fat_ratio_pct, 21.4);
  assert.equal(b.metrics.muscle_mass_kg, 61.5);
  assert.equal(b.metrics.heart_pulse_bpm, 64);
  assert.deepEqual(b.segments, { torso: { fat_kg: 2.1 }, right_arm: { muscle_kg: 3.3 } });
  assert.equal(b.raw.length, g.measures.length, 'raw kept untouched');
  assert.equal(b.day, '2026-10-10');
  assert.equal(b.needs_review, false);
});

test('decode: the day is in the group time zone; attrib 1 needs review; hash ignores order', () => {
  assert.equal(dayIn('2026-10-10T02:30:00Z', 'America/New_York'), '2026-10-09');
  assert.equal(dayIn('2026-10-10T02:30:00Z', 'Not/AZone'), '2026-10-09', 'falls back to New York');
  const g = group(2, T0, 80, { attrib: 1 });
  assert.equal(decodeGroup(g).needs_review, true);
  assert.equal(weightMirror(decodeGroup(g)).review, true);
  const h1 = rawHash([{ type: 1, value: 1, unit: 0 }, { type: 6, value: 2, unit: 0 }]);
  const h2 = rawHash([{ type: 6, value: 2, unit: 0 }, { type: 1, value: 1, unit: 0 }]);
  assert.equal(h1, h2);
});

// ---------- idempotent writes and tombstones ----------
test('sync writes: same group twice = one doc; unchanged = no write; a change updates', async () => {
  const db = fakeDb();
  const g = group(100, T0);
  const r1 = await applyGroups(db, UID, [g], { now: T0 });
  assert.equal(r1.created, 1);
  assert.ok(db.dump(P.body(UID, 'w_100')));
  const w = db.dump(P.weight(UID, 'w_100'));
  assert.equal(w.kg, 82.3);
  assert.equal(w.source, 'withings');
  assert.equal(w.day, '2026-10-10');
  const writes = db.stats.writes;
  const r2 = await applyGroups(db, UID, [g], { now: T0 + 1000 });
  assert.equal(r2.unchanged, 1);
  assert.equal(db.stats.writes, writes, 'nothing written when nothing changed');
  const edited = group(100, T0, 81.9, { modified: sec(T0) + 99 });
  const r3 = await applyGroups(db, UID, [edited], { now: T0 + 2000 });
  assert.equal(r3.updated, 1);
  assert.equal(db.dump(P.weight(UID, 'w_100')).kg, 81.9);
  assert.equal(db.dump(P.body(UID, 'w_100')).created_at, new Date(T0).toISOString(), 'created_at kept');
});

test('tombstones win: a body measurement or weight you deleted is never written back', async () => {
  const db = fakeDb();
  await applyGroups(db, UID, [group(7, T0)], { now: T0 });
  // You delete the body measurement in Forge (tombstone), and separately a weight.
  db.put(P.body(UID, 'w_7'), { ...db.dump(P.body(UID, 'w_7')), deleted: true, deleted_at: 'x' });
  const edited = group(7, T0, 79, { modified: sec(T0) + 500 });
  const r = await applyGroups(db, UID, [edited], { now: T0 + 1 });
  assert.equal(r.tombstoned, 1);
  assert.equal(db.dump(P.body(UID, 'w_7')).deleted, true);
  assert.equal(db.dump(P.weight(UID, 'w_7')).kg, 82.3, 'weight untouched too');

  await applyGroups(db, UID, [group(8, T0)], { now: T0 });
  db.put(P.weight(UID, 'w_8'), { ...db.dump(P.weight(UID, 'w_8')), deleted: true });
  await applyGroups(db, UID, [group(8, T0, 77, { modified: sec(T0) + 900 })], { now: T0 + 2 });
  assert.equal(db.dump(P.weight(UID, 'w_8')).deleted, true, 'weight soft-delete never undone');
  assert.equal(db.dump(P.weight(UID, 'w_8')).kg, 82.3);
  assert.equal(db.dump(P.body(UID, 'w_8')).metrics.weight_kg, 77, 'the body doc still updates');
});

test('your review decision survives later edits in Withings', async () => {
  const db = fakeDb();
  await applyGroups(db, UID, [group(9, T0, 80, { attrib: 1 })], { now: T0 });
  db.put(P.weight(UID, 'w_9'), { ...db.dump(P.weight(UID, 'w_9')), review: false, reviewed_at: 'y' });
  db.put(P.body(UID, 'w_9'), { ...db.dump(P.body(UID, 'w_9')), needs_review: false, reviewed_at: 'y' });
  await applyGroups(db, UID, [group(9, T0, 80.4, { attrib: 1, modified: sec(T0) + 77 })], { now: T0 + 5 });
  assert.equal(db.dump(P.weight(UID, 'w_9')).review, false);
  assert.equal(db.dump(P.body(UID, 'w_9')).needs_review, false);
});

// ---------- incremental sync ----------
test('incremental sync: pages with lastupdate (cursor − 5 s), saves the cursor and the latency', async () => {
  const db = fakeDb();
  connected(db);
  const pages = [
    { updatetime: sec(T0), more: 1, offset: 1, timezone: 'America/New_York', measuregrps: [group(1, T0 - 60_000)] },
    { updatetime: sec(T0), more: 0, measuregrps: [group(2, T0 - 120_000)] },
  ];
  const api = fakeApi({ getmeas: () => pages.shift() });
  const r = await incrementalSync({ db, api, uid: UID, token: 'AT', now: () => T0, reason: 'notify' });
  assert.equal(r.created, 2);
  assert.equal(api.calls[0][2].lastupdate, sec(T0) - 3600 - 5);
  assert.equal(api.calls[1][2].offset, 1);
  assert.equal(db.dump(P.priv(UID)).cursor, sec(T0));
  const st = db.dump(P.status(UID));
  assert.equal(st.last_latency_s, 60);
  assert.deepEqual(st.latencies_s, [60]);
});

test('90-day reconcile tombstones only groups Withings no longer has, never on a partial list', async () => {
  const db = fakeDb();
  const day = 86400_000;
  await applyGroups(db, UID, [group(1, T0 - 10 * day), group(2, T0 - 20 * day), group(3, T0 - 30 * day)], { now: T0 });
  const api = fakeApi({ getmeas: { more: 0, measuregrps: [group(1, T0 - 10 * day), group(3, T0 - 30 * day)] } });
  const r = await reconcile90({ db, api, uid: UID, token: 'AT', now: () => T0 });
  assert.equal(r.removed, 1);
  assert.equal(db.dump(P.body(UID, 'w_2')).deleted, true);
  assert.equal(db.dump(P.body(UID, 'w_2')).deleted_by, 'withings');
  assert.equal(db.dump(P.weight(UID, 'w_2')).deleted, true);
  assert.equal(db.dump(P.body(UID, 'w_1')).deleted, false);
  const endless = fakeApi({ getmeas: { more: 1, offset: 5, measuregrps: [] } });
  const r2 = await reconcile90({ db, api: endless, uid: UID, token: 'AT', now: () => T0 });
  assert.equal(r2.aborted, true);
  assert.equal(db.dump(P.body(UID, 'w_1')).deleted, false);
});

// ---------- webhook ----------
test('webhook: HEAD 200, bad key 404, appli ≠ 1 ignored, unknown user 200 no-op, good one enqueues and answers 200', async () => {
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  const deps = { db, enqueue: q.enqueue, key: KEY, now: () => T0 };
  assert.equal((await handleWebhook({ method: 'HEAD', query: {} }, deps)).status, 200);
  assert.equal((await handleWebhook({ method: 'POST', query: { k: 'nope' }, body: { userid: WUSER, appli: '1' } }, deps)).status, 404);
  assert.equal((await handleWebhook({ method: 'POST', query: {}, body: { userid: WUSER, appli: '1' } }, deps)).status, 404);
  assert.equal((await handleWebhook({ method: 'POST', query: { k: KEY }, body: { userid: WUSER, appli: '44' } }, deps)).status, 200);
  assert.equal((await handleWebhook({ method: 'POST', query: { k: KEY }, body: { userid: '999', appli: '1' } }, deps)).status, 200);
  assert.equal(q.tasks.length, 0, 'nothing queued so far');
  const body = { userid: WUSER, appli: '1', startdate: String(sec(T0) - 10), enddate: String(sec(T0)) };
  const ok = await handleWebhook({ method: 'POST', query: { k: KEY }, body }, deps);
  assert.equal(ok.status, 200);
  assert.equal(q.tasks.length, 1);
  assert.equal(q.tasks[0].data.uid, UID);
  assert.equal(q.tasks[0].id, notifyTaskId(UID, body, T0));
  assert.match(q.tasks[0].id, /^[A-Za-z0-9_-]{1,500}$/, 'valid Cloud Tasks name');
  // Withings retries the same notification: still one task, still 200.
  assert.equal((await handleWebhook({ method: 'POST', query: { k: KEY }, body }, deps)).status, 200);
  assert.equal(q.tasks.length, 1);
  assert.equal(db.dump(P.status(UID)).last_notify_at, new Date(T0).toISOString());
});

test('webhook: 503 when it can tell before replying that something failed (lookup or enqueue)', async () => {
  const db = fakeDb();
  connected(db);
  const body = { userid: WUSER, appli: '1', startdate: '1', enddate: '2' };
  const failing = { db, enqueue: async () => { throw Object.assign(new Error('UNAVAILABLE'), { code: 14 }); }, key: KEY };
  assert.equal((await handleWebhook({ method: 'POST', query: { k: KEY }, body }, failing)).status, 503);
  const badDb = { doc: () => ({ get: async () => { throw new Error('down'); } }) };
  assert.equal((await handleWebhook({ method: 'POST', query: { k: KEY }, body }, { db: badDb, enqueue: async () => {}, key: KEY })).status, 503);
});

test('webhook replies without calling Withings (the sync runs in the task)', async () => {
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  const t = Date.now();
  await handleWebhook({ method: 'POST', query: { k: KEY }, body: { userid: WUSER, appli: '1', startdate: '3', enddate: '4' } }, { db, enqueue: q.enqueue, key: KEY });
  assert.ok(Date.now() - t < 200);
});

// ---------- tasks: notify sync and the backfill chain ----------
test('task: a notify task runs one incremental sync', async () => {
  const db = fakeDb();
  connected(db);
  const api = fakeApi({ getmeas: { updatetime: sec(T0), more: 0, measuregrps: [group(5, T0 - 30_000)] } });
  const q = fakeQueue();
  const r = await runTask({ kind: 'notify', uid: UID }, { db, api, enqueue: q.enqueue, now: () => T0 });
  assert.equal(r.created, 1);
  assert.equal(api.calls.filter((c) => c[0] === 'getmeas').length, 1);
  assert.equal(q.tasks.length, 0, 'a sync never queues more work');
});

test('backfill: nothing in the job writes to a trigger path (no Firestore-triggered functions exist)', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8'));
  assert.ok(!/onDocument(Created|Written|Updated|Deleted)/.test(src), 'no Firestore triggers');
  assert.ok(/onTaskDispatched/.test(src));
});

test('backfill: a stale run (you reconnected) stops its chain', async () => {
  const db = fakeDb();
  connected(db);
  db.put(P.status(UID), { ...db.dump(P.status(UID)), backfill: { run_id: 'new' } });
  const q = fakeQueue();
  const r = await runTask({ kind: 'backfill', uid: UID, runId: 'old', end: sec(T0), year: 2020, page: 3, offset: 3 }, { db, api: fakeApi(), enqueue: q.enqueue, now: () => T0 });
  assert.equal(r.skipped, 'stale_run');
  assert.equal(q.tasks.length, 0);
});

test('task: disconnected since it was queued → dropped quietly', async () => {
  const r = await runTask({ kind: 'notify', uid: UID }, { db: fakeDb(), api: fakeApi(), enqueue: async () => {} });
  assert.equal(r.skipped, 'not_connected');
});

// ---------- tokens ----------
test('tokens: a valid token is used as is; a near-expiry one is refreshed and SAVED before use', async () => {
  const db = fakeDb();
  connected(db);
  const api = fakeApi({ refreshToken: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 10800 } });
  assert.equal(await getAccessToken({ db, api, uid: UID, now: () => T0 }), 'AT0');
  assert.equal(api.calls.length, 0);
  let savedBeforeUse = null;
  const api2 = fakeApi({ refreshToken: () => ({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 10800 }) });
  const later = T0 + 3 * 3600 * 1000 - 60_000; // 1 min left
  const tok = await getAccessToken({ db, api: api2, uid: UID, now: () => later });
  savedBeforeUse = db.dump(P.priv(UID));
  assert.equal(tok, 'AT1');
  assert.equal(savedBeforeUse.refresh_token, 'RT1');
  assert.equal(savedBeforeUse.access_token, 'AT1');
  assert.equal(savedBeforeUse.lease_until, 0);
  assert.equal(api2.calls[0][1], 'RT0', 'refreshed with the stored refresh token');
});

test('tokens: two callers at once → one refresh (the lease); the second waits and reuses it', async () => {
  const db = fakeDb();
  connected(db, { expiresIn: 0 });
  let refreshes = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const api = fakeApi({ refreshToken: async () => { refreshes++; await gate; return { access_token: 'ATn', refresh_token: 'RTn', expires_in: 10800 }; } });
  const sleep = async () => { release(); await new Promise((r) => setTimeout(r, 5)); };
  const [a, b] = await Promise.all([
    getAccessToken({ db, api, uid: UID, now: () => T0, sleep }),
    getAccessToken({ db, api, uid: UID, now: () => T0, sleep }),
  ]);
  assert.equal(refreshes, 1);
  assert.equal(a, 'ATn');
  assert.equal(b, 'ATn');
});

test('tokens: invalid refresh → one retry, then needs_reconnect; not connected → NotConnected', async () => {
  const db = fakeDb();
  connected(db, { expiresIn: 0 });
  const api = fakeApi({ refreshToken: new WithingsError(401, 'refresh') });
  await assert.rejects(getAccessToken({ db, api, uid: UID, now: () => T0, sleep: async () => {} }));
  assert.equal(api.calls.length, 2);
  assert.equal(db.dump(P.status(UID)).needs_reconnect, true);
  await assert.rejects(getAccessToken({ db: fakeDb(), api, uid: UID }), NotConnected);
});

// ---------- OAuth ----------
test('oauth: state is one-time and expires after 10 minutes', async () => {
  const db = fakeDb();
  const { url } = await startAuth({ db, api: fakeApi(), uid: UID, redirectUri: 'https://x/cb', now: () => T0 });
  const state = new URL(url).searchParams.get('state');
  assert.match(state, /^[a-f0-9]{64}$/);
  assert.equal(await consumeState(db, state, T0 + 1000), UID);
  assert.equal(await consumeState(db, state, T0 + 2000), null, 'used up');
  const { url: url2 } = await startAuth({ db, api: fakeApi(), uid: UID, redirectUri: 'https://x/cb', now: () => T0 });
  assert.equal(await consumeState(db, new URL(url2).searchParams.get('state'), T0 + 11 * 60_000), null, 'expired');
  assert.equal(await consumeState(db, '../../x', T0), null);
  await assert.rejects(startAuth({ db, api: fakeApi(), uid: null, redirectUri: 'x' }));
});

test('oauth callback: exchanges the code first, stores tokens server-side, maps the user, subscribes, starts one backfill', async () => {
  const db = fakeDb();
  const api = fakeApi({
    requestToken: { userid: 424242, access_token: 'AT', refresh_token: 'RT', expires_in: 10800, scope: 'user.info,user.metrics' },
    getdevice: { devices: [{ type: 'Scale', model: 'Body Comp', model_id: 13 }] },
  });
  const q = fakeQueue();
  const { url } = await startAuth({ db, api, uid: UID, redirectUri: 'https://x/cb', now: () => T0 });
  const state = new URL(url).searchParams.get('state');
  const r = await handleCallback({ state, code: 'c0de' }, { db, api, enqueue: q.enqueue, redirectUri: 'https://x/cb', webhookUrl: `https://x/wh?k=${KEY}`, appUrl: 'https://app/', now: () => T0, newRunId: () => 'run1' });
  assert.equal(r.redirect, 'https://app/withings-connected.html');
  assert.equal(api.calls[0][0], 'requestToken', 'the 30-second code is exchanged before anything else');
  assert.equal(db.dump(P.priv(UID)).refresh_token, 'RT');
  assert.equal(db.dump(P.wuser(WUSER)).uid, UID);
  const st = db.dump(P.status(UID));
  assert.equal(st.connected, true);
  assert.equal(st.model, 'Body Comp');
  assert.equal(st.subscription_ok, true);
  assert.ok(!JSON.stringify(st).includes('RT') && !JSON.stringify(st).includes(WUSER), 'no tokens or Withings user id in the app-readable doc');
  assert.equal(q.tasks.length, 1);
  assert.equal(q.tasks[0].data.kind, 'backfill');
  // Replaying the same callback URL (back button) does nothing.
  const again = await handleCallback({ state, code: 'c0de' }, { db, api, enqueue: q.enqueue, redirectUri: 'https://x/cb', webhookUrl: 'w', appUrl: 'a', now: () => T0 });
  assert.equal(again.page, 'expired');
  assert.equal(q.tasks.length, 1);
});

test('oauth callback: denied, failed exchange and a Withings account linked elsewhere', async () => {
  const db = fakeDb();
  const mk = async () => new URL((await startAuth({ db, api: fakeApi(), uid: UID, redirectUri: 'r', now: () => T0 })).url).searchParams.get('state');
  const base = { db, enqueue: fakeQueue().enqueue, redirectUri: 'r', webhookUrl: 'w', appUrl: 'a', now: () => T0 };
  assert.equal((await handleCallback({ error: 'access_denied', state: await mk() }, { ...base, api: fakeApi() })).page, 'denied');
  assert.equal((await handleCallback({ state: await mk(), code: 'x' }, { ...base, api: fakeApi({ requestToken: new WithingsError(503, 'requesttoken') }) })).page, 'exchange_failed');
  db.put(P.wuser(WUSER), { uid: 'someone-else' });
  const r = await handleCallback({ state: await mk(), code: 'x' }, { ...base, api: fakeApi({ requestToken: { userid: WUSER, access_token: 'a', refresh_token: 'b' } }) });
  assert.equal(r.page, 'other_account');
  assert.equal(db.dump(P.priv(UID)), undefined, 'no tokens stored');
});

// ---------- data check ----------
test('disconnect: revokes, deletes tokens and mapping; deleteData also removes synced docs and Withings weights', async () => {
  const db = fakeDb();
  connected(db);
  await applyGroups(db, UID, [group(1, T0), group(2, T0 - 86400_000)], { now: T0 });
  db.put(P.weight(UID, 'manual1'), { id: 'manual1', kg: 80, source: 'manual' });
  db.put(`${P.healthCol(UID)}/2026-10-09`, { steps: 1 });
  const api = fakeApi();
  const r = await disconnect({ db, api, uid: UID, webhookUrl: 'w', deleteData: true, now: () => T0 });
  assert.equal(r.revoked, true);
  assert.equal(db.dump(P.priv(UID)), undefined);
  assert.equal(db.dump(P.wuser(WUSER)), undefined);
  assert.equal(db.dump(P.body(UID, 'w_1')), undefined);
  assert.equal(db.dump(P.weight(UID, 'w_1')), undefined);
  assert.ok(db.dump(`${P.healthCol(UID)}/2026-10-09`), 'Apple Health days are not Withings data');
  assert.ok(db.dump(P.weight(UID, 'manual1')), 'your own weigh-ins stay (delete-everything removes them itself)');
  assert.equal(db.dump(P.status(UID)), undefined);
});

// ---------- logging and the HTTP client ----------
test('log: only codes, counts and durations get through; tokens and health values never do', () => {
  const lines = [];
  setSink((l) => lines.push(l));
  log('sync', { count: 3, ms: 120, access_token: 'abc', refresh_token: 'def', weight_kg: 82.3, value: 82.3, code: 'f'.repeat(40), status: 401 });
  setSink((l) => console.log(l));
  const out = JSON.parse(lines[0]);
  assert.deepEqual(out, { count: 3, ms: 120, status: 401, event: 'sync' });
  assert.deepEqual(clean({ count: 82.3 }), {}, 'non-integers (health values) dropped');
});

test('client: form POST with the bearer token; HTTP and JSON statuses become WithingsError; transient vs permanent', async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push([url, init]); return { ok: true, json: async () => ({ status: 0, body: { ok: 1 } }) }; };
  const c = makeClient({ fetch, clientId: 'cid', clientSecret: 'sec' });
  await c.getmeas('TOKEN', { meastypes: [1, 6], lastupdate: 5 });
  assert.equal(seen[0][0], 'https://wbsapi.withings.net/measure');
  assert.equal(seen[0][1].headers.Authorization, 'Bearer TOKEN');
  const body = new URLSearchParams(seen[0][1].body);
  assert.equal(body.get('action'), 'getmeas');
  assert.equal(body.get('meastypes'), '1,6');
  assert.equal(body.get('category'), '1');
  const u = new URL(c.authorizeUrl({ redirectUri: 'https://r/cb', state: 's' }));
  assert.equal(u.origin + u.pathname, 'https://account.withings.com/oauth2_user/authorize2');
  assert.equal(u.searchParams.get('scope'), 'user.info,user.metrics,user.activity');
  const bad = makeClient({ fetch: async () => ({ ok: false, status: 502 }), clientId: 'c' });
  await assert.rejects(bad.getdevice('t'), (e) => e.transient && e.status === 'http_502');
  const rl = makeClient({ fetch: async () => ({ ok: true, json: async () => ({ status: 601 }) }), clientId: 'c' });
  await assert.rejects(rl.getdevice('t'), (e) => e.transient);
  const perm = makeClient({ fetch: async () => ({ ok: true, json: async () => ({ status: 503 }) }), clientId: 'c' });
  await assert.rejects(perm.getdevice('t'), (e) => !e.transient, 'JSON 503 = invalid params, not an outage');
  const inv = makeClient({ fetch: async () => ({ ok: true, json: async () => ({ status: 401 }) }), clientId: 'c' });
  await assert.rejects(inv.getdevice('t'), (e) => e.invalidToken);
});

// ---------- review fixes ----------
test('webhook: a quick Withings retry is one task; the same measurement changed later is a new task', async () => {
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  const body = { userid: WUSER, appli: '1', startdate: '10', enddate: '20' };
  await handleWebhook({ method: 'POST', query: { k: KEY }, body }, { db, enqueue: q.enqueue, key: KEY, now: () => T0 });
  await handleWebhook({ method: 'POST', query: { k: KEY }, body }, { db, enqueue: q.enqueue, key: KEY, now: () => T0 + 10_000 });
  assert.equal(q.tasks.length, 1);
  await handleWebhook({ method: 'POST', query: { k: KEY }, body }, { db, enqueue: q.enqueue, key: KEY, now: () => T0 + 30 * 60_000 });
  assert.equal(q.tasks.length, 2);
});

test('reconcile never wipes history on an empty or much shorter answer', async () => {
  const db = fakeDb();
  const day = 86400_000;
  const groups = Array.from({ length: 20 }, (_, i) => group(500 + i, T0 - (5 + i) * day));
  await applyGroups(db, UID, groups, { now: T0 });
  const empty = await reconcile90({ db, api: fakeApi({ getmeas: { more: 0, measuregrps: [] } }), uid: UID, token: 'AT', now: () => T0 });
  assert.equal(empty.aborted, true);
  const short = await reconcile90({ db, api: fakeApi({ getmeas: { more: 0, measuregrps: groups.slice(0, 10) } }), uid: UID, token: 'AT', now: () => T0 });
  assert.equal(short.aborted, true, '10 of 20 missing is suspicious');
  assert.ok(groups.every((g) => db.dump(P.body(UID, `w_${g.grpid}`)).deleted === false), 'nothing deleted');
  const two = await reconcile90({ db, api: fakeApi({ getmeas: { more: 0, measuregrps: groups.slice(2) } }), uid: UID, token: 'AT', now: () => T0 });
  assert.equal(two.removed, 2, 'a couple deleted in the Withings app is normal');
});

test('a measurement the reconcile removed comes back if Withings sends it again; one YOU deleted never does', async () => {
  const db = fakeDb();
  await applyGroups(db, UID, [group(1, T0), group(2, T0)], { now: T0 });
  const mark = (path, by) => db.put(path, { ...db.dump(path), deleted: true, deleted_at: 'x', ...(by ? { deleted_by: by } : {}) });
  mark(P.body(UID, 'w_1'), 'withings'); mark(P.weight(UID, 'w_1'), 'withings');
  mark(P.body(UID, 'w_2'), null); mark(P.weight(UID, 'w_2'), null);
  await applyGroups(db, UID, [group(1, T0), group(2, T0)], { now: T0 + 5 });
  assert.equal(db.dump(P.body(UID, 'w_1')).deleted, false);
  assert.equal('deleted_by' in db.dump(P.body(UID, 'w_1')), false, 'tombstone fields dropped, never null');
  assert.equal(db.dump(P.weight(UID, 'w_1')).deleted, false);
  assert.equal(db.dump(P.body(UID, 'w_2')).deleted, true);
  assert.equal(db.dump(P.weight(UID, 'w_2')).deleted, true);
});

test('sync: if Withings rejects the type list, it asks again without one; token and outage errors still surface', async () => {
  const calls = [];
  const api = fakeApi({ getmeas: (_t, o) => { calls.push(o.meastypes); if (o.meastypes) throw new WithingsError(503, 'getmeas'); return { more: 0, measuregrps: [] }; } });
  await getmeasSafe(api, 'AT', { lastupdate: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], undefined);
  await assert.rejects(getmeasSafe(fakeApi({ getmeas: new WithingsError(401, 'getmeas') }), 'AT', {}), (e) => e.invalidToken);
  await assert.rejects(getmeasSafe(fakeApi({ getmeas: new WithingsError('http_502', 'getmeas') }), 'AT', {}), (e) => e.transient);
});

test('an expired refresh token (Withings JSON 503) → needs_reconnect', async () => {
  const db = fakeDb();
  connected(db, { expiresIn: 0 });
  await assert.rejects(getAccessToken({ db, api: fakeApi({ refreshToken: new WithingsError(503, 'refresh') }), uid: UID, now: () => T0, sleep: async () => {} }));
  assert.equal(db.dump(P.status(UID)).needs_reconnect, true);
});

test('reconnecting with a different Withings account drops the old link', async () => {
  const db = fakeDb();
  connected(db);
  const api = fakeApi({ requestToken: { userid: 777, access_token: 'a', refresh_token: 'b', expires_in: 10800 } });
  const state = new URL((await startAuth({ db, api, uid: UID, redirectUri: 'r', now: () => T0 })).url).searchParams.get('state');
  await handleCallback({ state, code: 'c' }, { db, api, enqueue: fakeQueue().enqueue, redirectUri: 'r', webhookUrl: 'w', appUrl: 'a/', now: () => T0 });
  assert.equal(db.dump(P.wuser(WUSER)), undefined);
  assert.equal(db.dump(P.wuser('777')).uid, UID);
});

// ---------- W1 review fixes (v0.4.0 review) ----------
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const FIXTURE = new URL('../../tests/rules/fixtures/applygroups.json', import.meta.url);
const hasNullDeleteFields = (d) => d.deleted_at === null || d.deleted_by === null;

/** Exactly what the sync writes: a new weigh-in, and one restored after a reconcile removal. */
async function syncedDocs() {
  const db = fakeDb();
  await applyGroups(db, 'alice', [group(11, T0), group(12, T0, 80, { attrib: 1 })], { now: T0 });
  db.put(P.body('alice', 'w_12'), { ...db.dump(P.body('alice', 'w_12')), deleted: true, deleted_at: 'x', deleted_by: 'withings' });
  db.put(P.weight('alice', 'w_12'), { ...db.dump(P.weight('alice', 'w_12')), deleted: true, deleted_at: 'x', deleted_by: 'withings' });
  await applyGroups(db, 'alice', [group(12, T0, 80, { attrib: 1, modified: sec(T0) + 60 })], { now: T0 + 1000 });
  return {
    'users/alice/body_measures/w_11': db.dump(P.body('alice', 'w_11')),
    'users/alice/weights/w_11': db.dump(P.weight('alice', 'w_11')),
    'users/alice/body_measures/w_12': db.dump(P.body('alice', 'w_12')),
    'users/alice/weights/w_12': db.dump(P.weight('alice', 'w_12')),
  };
}

test('sync never writes deleted_at / deleted_by as null (the rules only accept strings); restores drop them', async () => {
  const docs = await syncedDocs();
  for (const [path, d] of Object.entries(docs)) {
    assert.equal(hasNullDeleteFields(d), false, path);
    assert.equal(d.deleted, false, path);
  }
  assert.equal('deleted_by' in docs['users/alice/body_measures/w_12'], false, 'restored doc has no deleted_by');
});

test('the rules-test fixture is exactly what the sync writes (regenerate: UPDATE_FIXTURES=1 npm test)', async () => {
  const docs = await syncedDocs();
  if (process.env.UPDATE_FIXTURES) {
    mkdirSync(new URL('../../tests/rules/fixtures/', import.meta.url), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify(docs, null, 2)}\n`);
  }
  assert.deepEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')), JSON.parse(JSON.stringify(docs)));
});

test('webhook proof: only notification syncs of weigh-ins count; Sync now and HR-only readings do not', async () => {
  const run = async (reason, groups) => {
    const db = fakeDb();
    connected(db);
    const api = fakeApi({ getmeas: { updatetime: sec(T0), more: 0, measuregrps: groups } });
    await incrementalSync({ db, api, uid: UID, token: 'AT', now: () => T0, reason });
    return db.dump(P.status(UID));
  };
  const manual = await run('manual', [group(31, T0 - 60_000)]);
  assert.equal(manual.latencies_s, undefined, 'Sync now a minute later is not "arrived on its own"');
  assert.ok(manual.last_weigh_in_at, 'but the weigh-in time is still recorded');
  assert.equal((await run('maintenance', [group(32, T0 - 60_000)])).latencies_s, undefined);
  const hrOnly = { ...group(33, T0 - 60_000), measures: [{ type: 11, value: 64, unit: 0 }] };
  assert.equal((await run('notify', [hrOnly])).latencies_s, undefined, 'a heart-rate-only reading is not a weigh-in');
  assert.deepEqual((await run('notify', [group(34, T0 - 90_000)])).latencies_s, [90]);
});

test('reconcile restores its own removals when Withings lists the weigh-in again; never yours', async () => {
  const db = fakeDb();
  const day = 86400_000;
  const groups = Array.from({ length: 10 }, (_, i) => group(700 + i, T0 - (5 + i) * day));
  await applyGroups(db, UID, groups, { now: T0 });
  const missing = groups.filter((g) => g.grpid !== 700);
  const r1 = await reconcile90({ db, api: fakeApi({ getmeas: { more: 0, measuregrps: missing } }), uid: UID, token: 'AT', now: () => T0 });
  assert.equal(r1.removed, 1);
  assert.equal(db.dump(P.body(UID, 'w_700')).deleted_by, 'withings');
  // You delete another one yourself.
  db.put(P.body(UID, 'w_701'), { ...db.dump(P.body(UID, 'w_701')), deleted: true, deleted_at: 'y' });
  db.put(P.weight(UID, 'w_701'), { ...db.dump(P.weight(UID, 'w_701')), deleted: true, deleted_at: 'y' });
  // Withings lists 700 again (it was a hiccup) and, of course, still lists 701.
  const r2 = await reconcile90({ db, api: fakeApi({ getmeas: { more: 0, measuregrps: groups } }), uid: UID, token: 'AT', now: () => T0 + 1000 });
  assert.equal(r2.restored, 1);
  const b = db.dump(P.body(UID, 'w_700'));
  const w = db.dump(P.weight(UID, 'w_700'));
  assert.equal(b.deleted, false);
  assert.equal(w.deleted, false);
  assert.equal('deleted_by' in b || 'deleted_at' in b || 'deleted_by' in w, false, 'tombstone fields removed, not nulled');
  assert.equal(db.dump(P.body(UID, 'w_701')).deleted, true, 'yours stays deleted');
});


// ---------- v0.4.1: the whole history, in yearly windows ----------
// A fake Withings account that misbehaves the ways the live import suggested:
//   - startdate 0 / missing → only data since 2025-01-07 (what Christian got);
//   - one request never reaches back more than 400 days from its enddate;
//   - small pages (offset/more).
const JAN7_2025 = Date.parse('2025-01-07T00:00:00Z') / 1000;
function withingsAccount(groups, { pageSize = 3 } = {}) {
  const calls = [];
  const getmeas = (_t, o) => {
    calls.push(o);
    let lo = Number(o.startdate) || 0;
    const hi = Number(o.enddate) || Infinity;
    if (!lo) lo = JAN7_2025; // "not set": default window
    lo = Math.max(lo, hi - 400 * 86400); // range cap
    const inRange = groups.filter((g) => g.date >= lo && g.date < hi).sort((a, b) => b.date - a.date);
    const off = Number(o.offset) || 0;
    const page = inRange.slice(off, off + pageSize);
    const more = off + pageSize < inRange.length;
    return { updatetime: sec(T0), more: more ? 1 : 0, offset: more ? off + pageSize : 0, measuregrps: page };
  };
  return { api: fakeApi({ getmeas }), calls };
}
// Weigh-ins from 2009-12-31 to Oct 2026: 2 a year plus a heart-rate-only reading in 2016.
const HISTORY = (() => {
  const out = [group(9000, Date.parse('2009-12-31T12:00:00Z'))];
  let id = 9001;
  for (let y = 2010; y <= 2026; y++) for (const m of [2, 8]) {
    const t = Date.parse(`${y}-${String(m).padStart(2, '0')}-15T12:00:00Z`);
    if (t < T0) out.push(group(id++, t));
  }
  out.push({ ...group(id++, Date.parse('2016-05-01T12:00:00Z')), measures: [{ type: 11, value: 60, unit: 0 }] });
  return out;
})();
const runAll = async (db, api, q) => {
  let task;
  let n = 0;
  while ((task = q.take())) {
    await runTask(task.data, { db, api, enqueue: q.enqueue, now: () => T0 });
    if (++n > 500) throw new Error('runaway');
  }
  return n;
};

test('history: one open-ended request would stop at Jan 7 2025; the yearly walk gets back to Dec 31 2009', async () => {
  const acct = withingsAccount(HISTORY);
  // What v0.4.0 did:
  const old = await acct.api.getmeas('AT', { startdate: 0, enddate: sec(T0) + 3600 });
  assert.ok(old.measuregrps.every((g) => g.date >= JAN7_2025), 'the bug, reproduced');
  // v0.4.1:
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  await requestBackfill({ db, enqueue: q.enqueue, uid: UID, runId: 'r1', now: () => T0 });
  await runAll(db, acct.api, q);
  const bf = db.dump(P.status(UID)).backfill;
  assert.equal(bf.done, true);
  assert.equal(bf.from, '2009-12-31T12:00:00.000Z', 'the real oldest date');
  assert.equal(bf.groups, HISTORY.length);
  assert.equal(bf.weighins, HISTORY.length - 1);
  const stored = [...db.docs.keys()].filter((k) => k.startsWith(`users/${UID}/body_measures/`)).length;
  assert.equal(stored, HISTORY.length, 'every group stored');
  // Every request had a real startdate and the run's pinned enddate; no window is wider than a year.
  const bfCalls = acct.calls.slice(1); // everything after the v0.4.0-style probe above
  assert.ok(bfCalls.every((c) => c.startdate > 0 && c.enddate - c.startdate <= 366 * 86400));
  assert.equal(new Set(bfCalls.map((c) => c.enddate > Date.UTC(2026, 0, 1) / 1000 ? 'pinned' : 'year')).has('pinned'), true);
  // It stopped after three empty years below 2009 and never went before 2005.
  const years = Object.keys(bf.years).map(Number).sort();
  assert.equal(years[0], 2006);
  assert.equal(bf.years[2008].p0.g + bf.years[2007].p0.g + bf.years[2006].p0.g, 0);
  // "Last weigh-in" is set by the backfill too.
  assert.equal(db.dump(P.status(UID)).last_weigh_in_at, new Date(Math.max(...HISTORY.filter((g) => g.measures.some((m) => m.type === 1)).map((g) => g.date * 1000))).toISOString());
});

test('history: a gap year in the middle doesn\'t stop the walk early; it only stops below 2009', async () => {
  const sparse = HISTORY.filter((g) => !new Date(g.date * 1000).toISOString().startsWith('2013') && !new Date(g.date * 1000).toISOString().startsWith('2014') && !new Date(g.date * 1000).toISOString().startsWith('2015'));
  const acct = withingsAccount(sparse);
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  await requestBackfill({ db, enqueue: q.enqueue, uid: UID, runId: 'r', now: () => T0 });
  await runAll(db, acct.api, q);
  assert.equal(db.dump(P.status(UID)).backfill.from, '2009-12-31T12:00:00.000Z');
});

test('history: one request = one run of each page, even when a page is retried; counts aren\'t inflated', async () => {
  const acct = withingsAccount(HISTORY);
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  await requestBackfill({ db, enqueue: q.enqueue, uid: UID, runId: 'r1', now: () => T0 });
  await requestBackfill({ db, enqueue: q.enqueue, uid: UID, runId: 'r1', now: () => T0 }); // double tap
  assert.equal(q.tasks.length, 1);
  const seen = new Set();
  let task;
  while ((task = q.take())) {
    assert.ok(!seen.has(task.id), 'no task id runs twice');
    seen.add(task.id);
    await runTask(task.data, { db, api: acct.api, enqueue: q.enqueue, now: () => T0 });
    await runTask(task.data, { db, api: acct.api, enqueue: q.enqueue, now: () => T0 }); // Cloud Tasks retry
  }
  assert.equal(db.dump(P.status(UID)).backfill.groups, HISTORY.length, 'retries set counts, never add');
});

test('history: re-import on an existing connection is idempotent, keeps your deletions, and refuses a double start', async () => {
  const acct = withingsAccount(HISTORY);
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  await requestBackfill({ db, enqueue: q.enqueue, uid: UID, runId: 'a', now: () => T0 });
  await runAll(db, acct.api, q);
  const first = [...db.docs.keys()].filter((k) => k.includes('/body_measures/')).length;
  db.put(P.body(UID, 'w_9000'), { ...db.dump(P.body(UID, 'w_9000')), deleted: true, deleted_at: 'x' });
  const started = await reimport({ db, enqueue: q.enqueue, uid: UID, runId: 'b', now: () => T0 + 60_000 });
  assert.equal(started.started, true);
  const again = await reimport({ db, enqueue: q.enqueue, uid: UID, runId: 'c', now: () => T0 + 61_000 });
  assert.equal(again.started, true, 'nothing has moved yet: a stuck start can be retried');
  let t;
  while ((t = q.take()) && t.data.runId !== 'c') await runTask(t.data, { db, api: acct.api, enqueue: q.enqueue, now: () => T0 + 62_000 }); // b's chain: stale, stops
  await runTask(t.data, { db, api: acct.api, enqueue: q.enqueue, now: () => T0 + 62_000 }); // run c's first page
  const busy = await reimport({ db, enqueue: q.enqueue, uid: UID, runId: 'd', now: () => T0 + 63_000 });
  assert.equal(busy.reason, 'running');
  await runAll(db, acct.api, q);
  assert.equal([...db.docs.keys()].filter((k) => k.includes('/body_measures/')).length, first, 'same docs, no duplicates');
  assert.equal(db.dump(P.body(UID, 'w_9000')).deleted, true, 'your deletion stays');
  assert.equal((await reimport({ db: fakeDb(), enqueue: q.enqueue, uid: UID, runId: 'z' })).reason, 'not_connected');
});

test('history: stops (and says why) if the offset inside a year doesn\'t advance, or past the page cap', async () => {
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  await requestBackfill({ db, enqueue: q.enqueue, uid: UID, runId: 'r', now: () => T0 });
  const stuck = fakeApi({ getmeas: { more: 1, offset: 0, measuregrps: [group(1, T0)] } });
  const r = await runTask(q.take().data, { db, api: stuck, enqueue: q.enqueue, now: () => T0 });
  assert.equal(r.stopped, true);
  assert.equal(q.tasks.length, 0);
  assert.equal(db.dump(P.status(UID)).backfill.error, 'offset_stuck');
  const capped = await runTask({ kind: 'backfill', uid: UID, runId: 'r', end: sec(T0), year: 2020, page: MAX_PAGES - 1, offset: 0 }, { db, api: fakeApi({ getmeas: { more: 0, measuregrps: [] } }), enqueue: q.enqueue, now: () => T0 });
  assert.equal(capped.stopped, true);
  assert.equal(q.tasks.length, 0);
});

test('a new backfill run replaces the old record (no leftover year, offset or dates)', async () => {
  const db = fakeDb();
  connected(db);
  db.put(P.status(UID), { ...db.dump(P.status(UID)), backfill: { run_id: 'old', offset: 900, from: '2019-01-01T00:00:00.000Z', finished_at: 'x', done: true, years: { 2019: { p0: { g: 5, w: 5 } } } } });
  await requestBackfill({ db, enqueue: fakeQueue().enqueue, uid: UID, runId: 'new', now: () => T0 });
  const bf = db.dump(P.status(UID)).backfill;
  assert.equal(bf.run_id, 'new');
  assert.equal(bf.from, null);
  assert.deepEqual(bf.years, {});
  assert.equal(bf.finished_at, undefined);
  assert.equal(bf.year, 2026);
  assert.equal(db.dump(P.status(UID)).model, 'Body Comp');
});

test('data check walks the same years: "Withings has" covers the whole account, with weigh-ins per year', async () => {
  const acct = withingsAccount(HISTORY, { pageSize: 50 });
  const db = fakeDb();
  connected(db);
  const r = await runDataCheck({ db, api: acct.api, uid: UID, token: 'AT', webhookUrl: 'w', now: () => T0 });
  assert.equal(r.withings_weight_groups, HISTORY.length - 1);
  assert.equal(r.years_withings[2009].weighins, 1);
  assert.equal(r.years_withings[2016].groups, 3);
  assert.equal(r.years_withings[2016].weighins, 2);
  assert.equal(r.types[1].first, '2009-12-31T12:00:00.000Z');
  assert.equal(r.truncated, false);
});

test('data check: if Withings refuses the type list, it walks with every type instead', async () => {
  const acct = withingsAccount(HISTORY, { pageSize: 50 });
  const api = fakeApi({ getmeas: (t, o) => { if (o.meastypes) throw new WithingsError(2555, 'getmeas'); return acct.api.getmeas(t, o); }, notifyList: { profiles: [] } });
  const db = fakeDb();
  connected(db);
  const r = await runDataCheck({ db, api, uid: UID, token: 'AT', webhookUrl: 'w', now: () => T0 });
  assert.equal(r.types_list_rejected, true);
  assert.equal(r.withings_weight_groups, HISTORY.length - 1);
  await assert.rejects(walkHistory(fakeApi({ getmeas: new WithingsError(522, 'getmeas') }), 'AT', { now: () => T0 }), (e) => e.transient, '522 = try later, not "rejected"');
});

test('data check: your deletions and "Not me" count as accounted for; reconcile removals as missing; report replaced whole', async () => {
  const db = fakeDb();
  connected(db);
  const hrOnly = { ...group(41, T0 - 3 * 86400_000), measures: [{ type: 11, value: 60, unit: 0 }] };
  await applyGroups(db, UID, [group(40, T0), hrOnly, group(42, T0 - 86400_000), group(43, T0 - 2 * 86400_000)], { now: T0 });
  db.put(P.body(UID, 'w_42'), { ...db.dump(P.body(UID, 'w_42')), deleted: true, deleted_at: 'z' }); // yours
  db.put(P.body(UID, 'w_43'), { ...db.dump(P.body(UID, 'w_43')), deleted: true, deleted_at: 'z', deleted_by: 'withings' }); // reconcile
  db.put(P.status(UID), { ...db.dump(P.status(UID)), data_check: { types: { 170: { count: 9 } } }, last_reconcile: { removed: 0, aborted: true, suspicious: 40 } });
  const api = fakeApi({ getmeas: (_t, o) => (o.startdate >= Date.UTC(2026, 0, 1) / 1000 ? { more: 0, measuregrps: [group(40, T0), hrOnly, group(42, T0 - 86400_000), group(43, T0 - 2 * 86400_000)] } : { more: 0, measuregrps: [] }), notifyList: { profiles: [] } });
  const r = await runDataCheck({ db, api, uid: UID, token: 'AT', webhookUrl: 'w', now: () => T0 });
  assert.equal(r.withings_weight_groups, 3);
  assert.equal(r.stored_weight_groups, 2, 'yours counts; the reconcile-removed one does not; HR-only is not a weigh-in');
  assert.equal(r.stored_not_me, 1);
  assert.equal(r.years_forge['2026'], 2);
  assert.equal(r.last_reconcile.aborted, true);
  assert.equal(db.dump(P.status(UID)).data_check.types[170], undefined, 'no stale types from an older report');
});

// ---------- v0.4.1: tokens and maintenance ----------
test('tokens: an access token Withings refuses → one forced refresh; refused again → needs_reconnect, no retries', async () => {
  const db = fakeDb();
  connected(db);
  const api = fakeApi({ refreshToken: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 10800 } });
  const seen = [];
  const ok = await withToken({ db, api, uid: UID, now: () => T0 }, async (t) => { seen.push(t); if (t === 'AT0') throw new WithingsError(401, 'getmeas'); return 'done'; });
  assert.equal(ok, 'done');
  assert.deepEqual(seen, ['AT0', 'AT1']);
  await assert.rejects(withToken({ db, api, uid: UID, now: () => T0 }, async () => { throw new WithingsError(401, 'getmeas'); }), NeedsReconnect);
  assert.equal(db.dump(P.status(UID)).needs_reconnect, true);
  const r = await runTask({ kind: 'notify', uid: UID }, { db, api: fakeApi({ refreshToken: { access_token: 'x', refresh_token: 'y', expires_in: 10800 }, getmeas: new WithingsError(401, 'getmeas') }), enqueue: async () => {}, now: () => T0 });
  assert.equal(r.skipped, 'needs_reconnect', 'returned, not thrown: Cloud Tasks won\'t retry five times');
});

test('tokens: a refresh whose lease was taken over doesn\'t overwrite the newer pair', async () => {
  const db = fakeDb();
  connected(db, { expiresIn: 0 });
  const api = fakeApi({ refreshToken: async () => {
    // While we wait for Withings, our lease runs out and another call stores its pair.
    db.put(P.priv(UID), { ...db.dump(P.priv(UID)), lease_id: 'someone-else', access_token: 'ATx', refresh_token: 'RTx', expires_at: T0 + 3 * 3600_000 });
    return { access_token: 'ATmine', refresh_token: 'RTmine', expires_in: 10800 };
  } });
  const tok = await getAccessToken({ db, api, uid: UID, now: () => T0 });
  assert.equal(tok, 'ATmine', 'our token still works for this call');
  assert.equal(db.dump(P.priv(UID)).refresh_token, 'RTx', 'the stored pair is not overwritten');
});

test('tokens: if saving the new pair keeps failing, the call fails and the old refresh token is still stored', async () => {
  const db = fakeDb();
  connected(db, { expiresIn: 0 });
  const api = fakeApi({ refreshToken: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 10800 } });
  const real = db.runTransaction.bind(db);
  let n = 0;
  db.runTransaction = (fn, o) => (++n === 1 ? real(fn, o) : Promise.reject(Object.assign(new Error('UNAVAILABLE'), { code: 14 })));
  await assert.rejects(getAccessToken({ db, api, uid: UID, now: () => T0, sleep: async () => {} }), (e) => e.status === 'save_failed' && e.transient);
  db.runTransaction = real;
  assert.equal(db.dump(P.priv(UID)).refresh_token, 'RT0');
});

test('maintenance: each step runs on its own (a reconcile error doesn\'t skip the backfill resume); resumes at the stored year/offset', async () => {
  const db = fakeDb();
  connected(db);
  db.put(P.status(UID), { ...db.dump(P.status(UID)), backfill: { done: false, end: sec(T0), year: 2014, offset: 6, page: 9, updated_at: new Date(T0 - 7 * 3600_000).toISOString() } });
  let n = 0;
  const api = fakeApi({
    refreshToken: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 10800 },
    notifyList: { profiles: [] },
    getmeas: (_t, o) => { n++; if (o.meastypes && o.meastypes.length === 1) throw new WithingsError('http_502', 'getmeas'); return { updatetime: sec(T0), more: 0, measuregrps: [] }; },
  });
  const q = fakeQueue();
  const r = await maintainUser({ db, api, enqueue: q.enqueue, uid: UID, webhookUrl: 'https://x/wh?k=1', now: () => T0 });
  assert.equal(r.resubscribed, true);
  assert.equal(r.reconcile_error, 'http_502');
  assert.equal(r.backfill_resumed, true);
  assert.deepEqual([q.tasks[0].data.year, q.tasks[0].data.offset, q.tasks[0].data.page, q.tasks[0].data.end], [2014, 6, 9, sec(T0)]);
  assert.ok(n >= 2);
});

test('maintenance deletes expired one-time OAuth states', async () => {
  const db = fakeDb();
  db.put('oauth_states/old', { uid: 'u', expires_at: T0 - 1 });
  db.put('oauth_states/new', { uid: 'u', expires_at: T0 + 60_000 });
  assert.equal(await expireStates(db, () => T0), 1);
  assert.equal(db.dump('oauth_states/old'), undefined);
  assert.ok(db.dump('oauth_states/new'));
  db.put('oauth_states/old2', { uid: 'u', expires_at: T0 - 1 });
  await maintainAll({ db, api: fakeApi(), enqueue: async () => {}, webhookUrl: 'w', now: () => T0 });
  assert.equal(db.dump('oauth_states/old2'), undefined, 'runs even with no connected users');
});

test('readings are labelled with the scale that took them', async () => {
  const db = fakeDb();
  await applyGroups(db, UID, [{ ...group(77, T0), model: 'Body+' }], { device: { model: 'Body Comp' }, now: T0 });
  assert.equal(db.dump(P.body(UID, 'w_77')).model, 'Body+');
});

// ---------- v0.4.4: task payloads ----------
test('runTask: a backfill task without a numeric year/end (queued by v0.4.0) is dropped, no API call, no chain', async () => {
  const db = fakeDb();
  connected(db);
  const q = fakeQueue();
  let calls = 0;
  const api = fakeApi({ getmeas: () => { calls++; return { more: 0, measuregrps: [] }; } });
  const bad = [
    { kind: 'backfill', uid: UID, runId: 'r', page: 0, offset: 0 },
    { kind: 'backfill', uid: UID, runId: 'r', end: sec(T0), page: 0 },
    { kind: 'backfill', uid: UID, runId: 'r', end: sec(T0), year: 'abc', page: 0 },
    { kind: 'backfill', uid: UID, runId: 'r', end: sec(T0), year: NaN, page: 0 },
    { kind: 'backfill', uid: UID, runId: 'r', end: sec(T0), year: 2020, page: -1 },
    { kind: 'backfill', uid: UID, runId: 'r', end: sec(T0), year: 2020, page: 0, offset: -5 },
  ];
  for (const data of bad) {
    const r = await runTask(data, { db, api, enqueue: q.enqueue, now: () => T0 });
    assert.equal(r.skipped, 'bad_task', JSON.stringify(data));
  }
  assert.equal(calls, 0);
  assert.equal(q.tasks.length, 0);
});

// v0.14.6: year windows stop one second before New Year (Withings' enddate is inclusive).
import { yearWindow as yw } from '../src/sync.js';
test('yearWindow: a reading at exactly 00:00:00 on Jan 1 belongs to the new year only', () => {
  const far = Date.UTC(2030, 0, 1) / 1000;
  const newYear = Date.UTC(2025, 0, 1) / 1000;
  const y24 = yw(2024, far);
  const y25 = yw(2025, far);
  assert.equal(y24.end, newYear - 1);
  assert.equal(y25.start, newYear);
  const inWin = (w, t) => t >= w.start && t <= w.end;
  assert.equal([y24, y25].filter((w) => inWin(w, newYear)).length, 1);
  assert.equal(yw(2026, Date.UTC(2026, 5, 1) / 1000).end, Date.UTC(2026, 5, 1) / 1000, 'a pinned end inside the year still wins');
});
