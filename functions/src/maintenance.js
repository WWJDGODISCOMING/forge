// Daily upkeep (04:00 New York) for each connected account, and Disconnect.
//   - refresh the token (keeps the year-long refresh token alive)
//   - make sure the body-measure notification subscription exists (Withings cancels it after 20 days of
//     failed deliveries) and re-subscribe if not
//   - incremental sync (catches anything a missed notification would have brought)
//   - 90-day reconcile (groups deleted in the Withings app)
//   - resume a backfill that stopped (no progress for 6 hours)
//   - delete expired one-time OAuth states
// Each step runs on its own, so one failure doesn't skip the rest.
import { randomBytes } from 'node:crypto';
import { P } from './paths.js';
import { getAccessToken, NotConnected } from './tokens.js';
import { incrementalSync, reconcile90 } from './sync.js';
import { backfillTaskId, enqueueOnce } from './tasks.js';
import { log } from './log.js';
import { deleteAppleData } from './health.js';
import { deleteFoodSearchData } from './usda.js';
import { deleteSnapData } from './snap.js';
import { deleteMealAiData } from './mealai.js';

export async function maintainUser({ db, api, enqueue, uid, webhookUrl, now = () => Date.now() }) {
  const out = { uid, ok: true };
  let token;
  try {
    token = await getAccessToken({ db, api, uid, now, force: true });
  } catch (e) {
    if (e instanceof NotConnected) return { uid, skipped: 'not_connected' };
    throw e;
  }
  const statusRef = db.doc(P.status(uid));
  try {
    const n = await api.notifyList(token, 1);
    const ok = (n.profiles || []).some((p) => p.callbackurl === webhookUrl);
    if (!ok) await api.notifySubscribe(token, webhookUrl, 1);
    await statusRef.set({ subscription_ok: true, subscription_checked_at: new Date(now()).toISOString(), ...(ok ? {} : { resubscribed_at: new Date(now()).toISOString() }) }, { merge: true });
    out.resubscribed = !ok;
  } catch (e) {
    await statusRef.set({ subscription_ok: false, last_error_code: `subscribe_${e.status || 'x'}` }, { merge: true });
  }
  try {
    const dev = await api.getdevice(token);
    const devices = (dev.devices || []).map((d) => ({ type: d.type || null, model: d.model || null, model_id: d.model_id ?? null, last_session: d.last_session_date ? new Date(d.last_session_date * 1000).toISOString() : null }));
    await statusRef.set({ devices }, { merge: true });
  } catch { /* the device list is informational */ }
  // Each step on its own: one failing (a Withings hiccup in the reconcile, say) never skips the others.
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      out.ok = false;
      out[`${name}_error`] = String(e.status || e.code || 'x');
      await statusRef.set({ last_error_code: `${name}_${e.status || e.code || 'x'}` }, { merge: true }).catch(() => {});
    }
  };
  await step('sync', async () => {
    const s = await incrementalSync({ db, api, uid, token, now, reason: 'maintenance' });
    out.synced = s.created + s.updated;
  });
  await step('reconcile', async () => {
    const r = await reconcile90({ db, api, uid, token, now });
    out.removed = r.removed;
    await statusRef.set({ last_reconcile: { at: new Date(now()).toISOString(), removed: r.removed, restored: r.restored || 0, aborted: !!r.aborted, suspicious: r.suspicious || 0 } }, { mergeFields: ['last_reconcile'] });
  });
  await step('backfill', async () => {
    const st = (await statusRef.get()).data() || {};
    const bf = st.backfill || {};
    const stale = !bf.done && !bf.error && bf.end && (!bf.updated_at || now() - Date.parse(bf.updated_at) > 6 * 3600 * 1000);
    if (!stale) return;
    // Continue where it stopped (same year, offset and pinned end) under a fresh run id.
    const runId = randomBytes(6).toString('hex');
    await statusRef.set({ backfill: { run_id: runId } }, { merge: true });
    await enqueueOnce(enqueue, { kind: 'backfill', uid, runId, end: bf.end, year: bf.year, offset: bf.offset || 0, page: bf.page || 0 }, backfillTaskId(uid, runId, bf.page || 0));
    out.backfill_resumed = true;
  });
  await statusRef.set({ last_maintenance_at: new Date(now()).toISOString() }, { merge: true });
  return out;
}

/** Every connected account (one, here, but done properly): one user's trouble never stops the others. */
export async function maintainAll(deps) {
  await expireStates(deps.db, deps.now).catch(() => {}); // abandoned Connect taps, whoever made them
  const users = await deps.db.collection(P.wusers()).get();
  const results = [];
  for (const d of users.docs) {
    const uid = d.data().uid;
    try {
      results.push(await maintainUser({ ...deps, uid }));
    } catch (e) {
      await deps.db.doc(P.status(uid)).set({ last_error_code: `maintenance_${e.status || e.code || 'x'}` }, { merge: true }).catch(() => {});
      results.push({ uid, ok: false });
      log('maintenance_failed', { status: typeof e.status === 'number' ? e.status : 0 });
    }
  }
  return results;
}

/**
 * Disconnect: revoke the notification, delete tokens and the Withings-user mapping, mark disconnected.
 * deleteData also deletes the synced Withings data (body_measures, the Withings weights and the status doc).
 * deleteApple additionally deletes Apple Health (health_daily, the Shortcut token and status) — "Delete
 * everything" passes both; the Withings dialog passes only deleteData.
 */
export async function disconnect({ db, api, uid, webhookUrl, deleteData = false, deleteApple = false, now = () => Date.now() }) {
  const privRef = db.doc(P.priv(uid));
  const priv = await privRef.get();
  let revoked = null;
  if (priv.exists) {
    try {
      const token = await getAccessToken({ db, api, uid, now });
      await api.notifyRevoke(token, webhookUrl, 1);
      revoked = true;
    } catch {
      revoked = false; // still disconnect here; Withings drops the subscription after 20 days of 404s
    }
    const wuid = priv.data().withings_userid;
    if (wuid) await db.doc(P.wuser(wuid)).delete();
    await privRef.delete();
  }
  let deleted = 0;
  if (deleteData) {
    deleted += await deleteAll(db, await db.collection(P.bodyCol(uid)).get());
    deleted += await deleteAll(db, await db.collection(P.weightCol(uid)).where('source', '==', 'withings').get());
    await db.doc(P.status(uid)).delete();
  } else {
    await db.doc(P.status(uid)).set({ connected: false, disconnected_at: new Date(now()).toISOString(), subscription_ok: null }, { merge: true });
  }
  // Apple Health data is separate from Withings: it goes only when asked (Delete everything, or its own button).
  if (deleteApple) {
    deleted += (await deleteAppleData({ db, uid })).deleted;
    await deleteFoodSearchData({ db, uid, now: now() }); // the food-search counter lives in private/, which the app can't delete (kept while its hour is open)
    await deleteSnapData({ db, uid, now: now() });
    await deleteMealAiData({ db, uid, now: now() });
  }
  return { revoked, deleted };
}

async function deleteAll(db, snap) {
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => b.delete(db.doc(d.ref.path)));
    await b.commit();
  }
  return snap.docs.length;
}

/** Delete one-time OAuth states older than their 10-minute life (abandoned Connect taps). */
export async function expireStates(db, now = () => Date.now()) {
  const old = await db.collection('oauth_states').where('expires_at', '<', now()).limit(400).get();
  if (!old.docs.length) return 0;
  const b = db.batch();
  old.docs.forEach((d) => b.delete(db.doc(d.ref.path)));
  await b.commit();
  return old.docs.length;
}
