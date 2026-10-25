// Withings notifications (POST application/x-www-form-urlencoded: userid, startdate, enddate, appli).
// They carry no signature, so the payload is only a hint: the sync reads from the stored cursor anyway.
//
// Withings counts any reply ≥ 400 or a slow reply as a failure and retries (10 s, ~1–10 min, ~1 h, ~4 h).
// Its docs give no exact timeout, so this handler never syncs inline: it validates, enqueues one task and
// answers 200 in well under a second. The task does the Withings + Firestore work.
//   HEAD                    → 200 (Withings checks the URL before subscribing)
//   wrong or missing ?k=    → 404, nothing done
//   appli 16                → an activity (steps) task
//   other appli             → 200, ignored (we only subscribe to body measures and activity)
//   unknown userid          → 200, ignored (a stale subscription; maintenance cleans up)
//   lookup/enqueue failure  → 503, so Withings retries (failures we can see before replying)
import { timingSafeEqual } from 'node:crypto';
import { P } from './paths.js';
import { log } from './log.js';

const same = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/**
 * Task id for one notification. Withings' quick retries of the same notification (10 s later) land in the
 * same 2-minute bucket and become one task; a genuinely new change to the same measurement later is a new
 * task (Cloud Tasks keeps used ids blocked for about an hour).
 * Withings' appli=16 notifications send `date`, not startdate/enddate, so those ids dedupe by the 2-minute
 * bucket alone. That is fine: every activity sync re-reads the last 7 days anyway.
 */
export const notifyTaskId = (uid, p, received) => `${Number(p.appli) === 16 ? 'na' : 'n'}-${uid}-${Number(p.startdate) || 0}-${Number(p.enddate) || 0}-${Math.floor(received / 120000)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 480);

/**
 * req: { method, query, body } (body already parsed into an object). deps: { db, enqueue(data, {id}), key, now }.
 * Returns { status, text }.
 */
export async function handleWebhook(req, { db, enqueue, key, now = () => Date.now() }) {
  if (req.method === 'HEAD' || req.method === 'GET') {
    // HEAD is Withings' URL check. A GET (someone poking the URL) learns nothing either way.
    if (req.method === 'HEAD') return { status: 200, text: '' };
    return same(req.query && req.query.k, key) ? { status: 200, text: 'ok' } : { status: 404, text: 'not found' };
  }
  if (req.method !== 'POST') return { status: 405, text: '' };
  if (!same(req.query && req.query.k, key)) return { status: 404, text: 'not found' };
  const p = req.body || {};
  const appli = Number(p.appli);
  if (appli !== 1 && appli !== 16) {
    log('notify_ignored', { appli: Number.isInteger(appli) ? appli : -1 });
    return { status: 200, text: 'ignored' };
  }
  const withingsUser = String(p.userid || '').replace(/[^0-9]/g, '');
  if (!withingsUser) return { status: 200, text: 'ignored' };
  let uid;
  try {
    const m = await db.doc(P.wuser(withingsUser)).get();
    if (!m.exists) {
      log('notify_unknown_user');
      return { status: 200, text: 'ignored' };
    }
    uid = m.data().uid;
  } catch {
    return { status: 503, text: 'retry' };
  }
  const received = now();
  try {
    await enqueue({ kind: appli === 16 ? 'activity' : 'notify', uid, received_at: received, startdate: Number(p.startdate) || null, enddate: Number(p.enddate) || null }, { id: notifyTaskId(uid, p, received) });
  } catch (e) {
    if (e && e.code !== 'functions/task-already-exists' && !/already exists/i.test(e.message || '')) {
      log('notify_enqueue_failed');
      return { status: 503, text: 'retry' };
    }
    // Same notification already queued (a Withings retry): fine.
  }
  try {
    await db.doc(P.status(uid)).set({ last_notify_at: new Date(received).toISOString() }, { merge: true });
  } catch { /* status only; the sync still runs */ }
  return { status: 200, text: 'ok' };
}
