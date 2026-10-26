// The task-queue worker (withingsTask). Every heavy job runs here, never in a Firestore trigger, so nothing
// the job writes can start another run:
//   notify / manual / maintenance → one incremental sync
//   backfill                      → ONE page, then enqueues the next page (deterministic id per run+page)
// Cloud Tasks drops a second task with the same id, so a retried page can't start a second chain:
// one backfill request = one run of each page.
import { P } from './paths.js';
import { withToken, NotConnected, NeedsReconnect } from './tokens.js';
import { incrementalSync, backfillPage } from './sync.js';
import { syncActivitySafe } from './activity.js';
import { WithingsError } from './withings-api.js';
import { log } from './log.js';

export const MAX_PAGES = 2000; // Withings pages are hundreds of groups: 2,000 pages is far beyond any real history

export const backfillTaskId = (uid, runId, page) => `bf-${uid}-${runId}-${page}`.replace(/[^A-Za-z0-9_-]/g, '_');

const already = (e) => e && (e.code === 'functions/task-already-exists' || /already exists/i.test(e.message || ''));

/** Enqueue, treating "already queued" as success. */
export async function enqueueOnce(enqueue, data, id, opts = {}) {
  try {
    await enqueue(data, { id, ...opts });
    return true;
  } catch (e) {
    if (already(e)) return false;
    throw e;
  }
}

/**
 * Start a backfill run (OAuth callback, Re-import history, or maintenance resuming one). The run pins its
 * end time and starts at the current calendar year. Ids are w_<grpid>, so re-running is idempotent, and
 * anything you deleted stays deleted.
 */
export async function requestBackfill({ db, enqueue, uid, runId, now = () => Date.now() }) {
  const end = Math.floor(now() / 1000) + 3600;
  const year = new Date(now()).getUTCFullYear();
  // A fresh run replaces the whole backfill record (no leftover offset/dates from an earlier run).
  await db.doc(P.status(uid)).set({ backfill: { run_id: runId, requested_at: new Date(now()).toISOString(), end, year, offset: null, page: 0, done: false, groups: 0, weighins: 0, years: {}, from: null, to: null } }, { mergeFields: ['backfill'] });
  return enqueueOnce(enqueue, { kind: 'backfill', uid, runId, end, year, offset: 0, page: 0 }, backfillTaskId(uid, runId, 0));
}

/** A backfill task payload we can walk: integer year and page, numeric pinned end, non-negative offset. */
export function validBackfill(d) {
  const page = d.page ?? 0;
  const offset = d.offset ?? 0;
  return Number.isInteger(d.year) && d.year >= 1990 && d.year <= 2200
    && Number.isFinite(d.end) && d.end > 0
    && Number.isInteger(page) && page >= 0
    && Number.isFinite(offset) && offset >= 0;
}

/**
 * Handle one task. Throwing makes Cloud Tasks retry it (transient trouble); returning ends it.
 * deps: { db, api, enqueue, now }
 */
export async function runTask(data, { db, api, enqueue, now = () => Date.now() }) {
  const { kind, uid } = data || {};
  if (!uid || !kind) return { skipped: 'bad_task' };
  // A backfill page needs a calendar year and a pinned end time (tasks queued by v0.4.0 have neither): drop it
  // rather than walk yearWindow(NaN) and chain empty pages up to MAX_PAGES.
  if (kind === 'backfill' && !validBackfill(data)) return { skipped: 'bad_task' };
  try {
    return await withToken({ db, api, uid, now }, (token) => work(token));
  } catch (e) {
    if (e instanceof NotConnected) return { skipped: 'not_connected' }; // disconnected since: drop it
    if (e instanceof NeedsReconnect) return { skipped: 'needs_reconnect' }; // the app shows the banner; no retries
    throw e;
  }

  async function work(token) {
    if (kind === 'backfill') {
      // A newer run replaced this one (reconnect): stop this chain.
      const s = await db.doc(P.status(uid)).get();
      const current = s.exists && s.data().backfill ? s.data().backfill.run_id : null;
      if (current && current !== data.runId) return { skipped: 'stale_run' };
      const page = data.page || 0;
      const r = await backfillPage({ db, api, uid, token, year: data.year, end: data.end, offset: data.offset || 0, page, now });
      log('backfill_page', { page, count: r.groups });
      if (r.done) return { kind, page, done: true };
      // Bounded: inside a year the offset must move on, and no run takes more than MAX_PAGES tasks.
      if ((r.more && !(r.offset > (data.offset || 0))) || page + 1 >= MAX_PAGES) {
        await db.doc(P.status(uid)).set({ backfill: { error: r.more && !(r.offset > (data.offset || 0)) ? 'offset_stuck' : 'too_many_pages', done: false } }, { merge: true });
        log('backfill_stopped', { page });
        return { kind, page, more: false, stopped: true };
      }
      await enqueueOnce(enqueue, { kind: 'backfill', uid, runId: data.runId, end: data.end, year: r.nextYear, offset: r.more ? r.offset : 0, page: page + 1 }, backfillTaskId(uid, data.runId, page + 1));
      return { kind, page, more: r.more, year: r.nextYear };
    }
    if (kind === 'activity') {
      const a = await syncActivitySafe({ db, api, uid, token, now });
      log('activity', { count: a.days || 0 });
      if (a.transient) throw new WithingsError(a.status, 'getactivity'); // rate limit / outage: Cloud Tasks retries
      return { kind, days: a.days || 0, skipped: a.skipped };
    }
    const r = await incrementalSync({ db, api, uid, token, now, reason: kind });
    log('sync', { reason: String(kind), count: r.created + r.updated });
    await syncActivitySafe({ db, api, uid, token, now }); // steps ride along; never fails the weight sync
    return { kind, created: r.created, updated: r.updated };
  }
}

/**
 * Re-import history on an existing connection (Settings → Withings → Re-import history). Refuses while a
 * run is still moving (progress in the last 30 minutes), so a double tap can't start two walks.
 */
export async function reimport({ db, enqueue, uid, runId, now = () => Date.now() }) {
  const s = await db.doc(P.status(uid)).get();
  const st = s.exists ? s.data() : {};
  if (!st.connected) return { started: false, reason: 'not_connected' };
  const bf = st.backfill || {};
  const moving = !bf.done && !bf.error && bf.updated_at && now() - Date.parse(bf.updated_at) < 30 * 60 * 1000;
  if (moving) return { started: false, reason: 'running' };
  await requestBackfill({ db, enqueue, uid, runId, now });
  return { started: true };
}
