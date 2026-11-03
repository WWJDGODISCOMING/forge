// Writing Withings measure groups into Firestore, idempotently:
//   - one body_measures doc per grpid (w_<grpid>); the same group twice is one doc, and an unchanged group
//     (same raw hash and modified time) is no write at all;
//   - a weights mirror (w_<grpid>) so the weight chart, trend and targets work unchanged;
//   - TOMBSTONES WIN: a doc YOU deleted in Forge is never written again, for either collection, whatever
//     Withings sends later. Docs the 90-day reconcile marked deleted (deleted_by: 'withings') come back if
//     Withings sends them again, so a bad Withings answer can never lose data for good.
// Plus the three ways measures arrive: incremental (webhook / Sync now / maintenance), one backfill page,
// and the 90-day reconcile that notices groups deleted in the Withings app.
import { P } from './paths.js';
import { ALL_TYPES } from './meastypes.js';
import { WithingsError } from './withings-api.js';
import { decodeGroup, weightMirror, docId } from './decode.js';

const CHUNK = 150; // groups per transaction (≤ 300 reads, ≤ 300 writes)
const iso = (ms) => new Date(ms).toISOString();

function standard(uid, id, nowIso, existing) {
  return existing
    ? { id, user_id: uid, created_at: existing.created_at || nowIso, updated_at: nowIso, source: 'withings', deleted: false }
    : { id, user_id: uid, created_at: nowIso, updated_at: nowIso, source: 'withings', deleted: false };
}

/**
 * Write decoded groups. Returns { created, updated, unchanged, tombstoned, newIds }.
 *   device: { model } for the model field; now: ms.
 */
export async function applyGroups(db, uid, groups, { device = null, tz = null, now = Date.now() } = {}) {
  const out = { created: 0, updated: 0, unchanged: 0, tombstoned: 0, newIds: [] };
  const nowIso = iso(now);
  for (let i = 0; i < groups.length; i += CHUNK) {
    const chunk = groups.slice(i, i + CHUNK).map((g) => decodeGroup(g, { device, tz }));
    await db.runTransaction(async (tx) => {
      const bodyRefs = chunk.map((b) => db.doc(P.body(uid, docId(b.grpid))));
      const weightRefs = chunk.map((b) => db.doc(P.weight(uid, docId(b.grpid))));
      const snaps = await tx.getAll(...bodyRefs, ...weightRefs);
      const bodySnaps = snaps.slice(0, chunk.length);
      const weightSnaps = snaps.slice(chunk.length);
      const res = { created: 0, updated: 0, unchanged: 0, tombstoned: 0, newIds: [] };
      chunk.forEach((b, k) => {
        const id = docId(b.grpid);
        const bs = bodySnaps[k];
        const prev = bs.exists ? bs.data() : null;
        if (prev && prev.deleted === true && prev.deleted_by !== 'withings') { res.tombstoned++; return; } // you deleted it: leave both alone
        const restoring = !!(prev && prev.deleted === true); // only reconcile deletions get here
        const same = !restoring && prev && prev.raw_hash === b.raw_hash && prev.w_modified === b.w_modified;
        if (same) res.unchanged++;
        else {
          // Keep your "that's me / not me" decision across later edits in Withings.
          const reviewed = prev && prev.reviewed_at ? { needs_review: prev.needs_review, reviewed_at: prev.reviewed_at } : {};
          // A full set (no merge): restoring a reconcile-deleted doc drops deleted_at/deleted_by entirely. The rules
          // only accept those fields as strings when present, so never write them as null.
          tx.set(bodyRefs[k], { ...standard(uid, id, nowIso, prev), ...b, ...reviewed });
          if (prev) res.updated++;
          else { res.created++; res.newIds.push(id); }
        }
        // Weights mirror: first sight, or when Withings' modified time / the value changes. Never un-delete.
        const w = weightMirror(b);
        const ws = weightSnaps[k];
        const wprev = ws.exists ? ws.data() : null;
        if (!w || (wprev && wprev.deleted === true && wprev.deleted_by !== 'withings')) return; // never un-delete yours
        if (wprev && !wprev.deleted && wprev.w_modified === b.w_modified && wprev.kg === w.kg && wprev.day === w.day) return;
        const keepReview = wprev && wprev.reviewed_at ? { review: wprev.review, reviewed_at: wprev.reviewed_at } : {};
        tx.set(weightRefs[k], { ...standard(uid, id, nowIso, wprev), ...w, w_modified: b.w_modified, ...keepReview });
      });
      Object.assign(out, {
        created: out.created + res.created, updated: out.updated + res.updated, unchanged: out.unchanged + res.unchanged,
        tombstoned: out.tombstoned + res.tombstoned, newIds: [...out.newIds, ...res.newIds],
      });
    });
  }
  return out;
}

/**
 * getmeas with our full type list; if Withings rejects the list itself (a permanent, non-token error, e.g.
 * an unknown type), ask again without `meastypes`, which returns every type the app may read.
 */
export async function getmeasSafe(api, token, params) {
  try {
    return await api.getmeas(token, { ...params, meastypes: ALL_TYPES });
  } catch (e) {
    if (!(e instanceof WithingsError) || e.transient || e.invalidToken) throw e;
    return api.getmeas(token, { ...params, meastypes: undefined });
  }
}

/**
 * Incremental sync from the stored cursor (`lastupdate`, a few seconds of overlap), all pages.
 * Records last_sync_at and, for weigh-ins that are new and recent, the end-to-end latency.
 */
/** Forge's own 10-minute wait between manual syncs (not a Withings limit). */
export const cooldownMessage = (ago) => `You synced ${ago} min ago. Forge waits 10 minutes between manual syncs.`;

export const CURSOR_OVERLAP_S = 48 * 3600; // a group can become visible in Withings' API long after its `modified` time
export const RECENT_WINDOW_S = 7 * 86400;
export const CATCHUP_FLAG = 'catchup_0_16_95';
export const CATCHUP_START_S = Date.UTC(2026, 9, 25, 4) / 1000; // Oct 25 2026 00:00 EDT

export async function incrementalSync(args) {
  const { db, uid, now = () => Date.now() } = args;
  try {
    return await runIncremental(args);
  } catch (e) {
    // A failed attempt is recorded apart from the last success, so "Last synced" never hides it.
    await db.doc(P.status(uid)).set({ last_sync_attempt_at: iso(now()) }, { merge: true }).catch(() => {});
    throw e;
  }
}

async function runIncremental({ db, api, uid, token, now = () => Date.now(), maxPages = 25, reason = 'sync' }) {
  const privSnap = await db.doc(P.priv(uid)).get();
  const priv = privSnap.exists ? privSnap.data() : {};
  const statusSnap = await db.doc(P.status(uid)).get();
  const status = statusSnap.exists ? statusSnap.data() : {};
  const device = status.model ? { model: status.model } : null;
  const nowS = Math.floor(now() / 1000);
  const since = Math.max(0, Number(priv.cursor || 0) - CURSOR_OVERLAP_S);
  let pages = 0;
  let cursor = null;
  const totals = { created: 0, updated: 0, unchanged: 0, tombstoned: 0, newIds: [], groups: [] };
  // One paged getmeas read; every group is written (idempotent by grpid). Returns the last body and whether paging finished.
  const readAll = async (params) => {
    let offset;
    let n = 0;
    let body;
    do {
      body = await getmeasSafe(api, token, { ...params, offset });
      const groups = body.measuregrps || [];
      const r = await applyGroups(db, uid, groups, { device, tz: body.timezone, now: now() });
      for (const k of ['created', 'updated', 'unchanged', 'tombstoned']) totals[k] += r[k];
      totals.newIds.push(...r.newIds);
      totals.groups.push(...groups.filter((g) => r.newIds.includes(docId(g.grpid))));
      offset = body.more ? body.offset : undefined;
      n++;
    } while (offset != null && n < maxPages);
    pages += n;
    return { body, complete: offset == null };
  };

  const inc = await readAll({ lastupdate: since });
  // Never store a cursor ahead of our own clock, and only once every page is in.
  cursor = Math.min(inc.body.updatetime || nowS, nowS);
  // Recent-window pass: catches a weigh-in the cursor already skipped (manual + daily maintenance).
  if (reason === 'manual' || reason === 'maintenance') await readAll({ startdate: nowS - RECENT_WINDOW_S, enddate: nowS + 3600 });
  // One-time catch-up for groups missed before this fix.
  const catchup = !priv[CATCHUP_FLAG];
  if (catchup) await readAll({ startdate: CATCHUP_START_S, enddate: nowS + 3600 });

  const privPatch = { [CATCHUP_FLAG]: true };
  if (inc.complete) privPatch.cursor = cursor;
  await db.doc(P.priv(uid)).update(privPatch);
  // Webhook proof: only syncs started by a Withings notification count, and only new weigh-ins (a group with
  // meastype 1) less than 6 hours old. A Sync now / maintenance catch-up is not "arrived on its own".
  const t = now();
  const weighIns = reason === 'notify' ? totals.groups.filter((g) => (g.measures || []).some((m) => m.type === 1)) : [];
  const fresh = weighIns.map((g) => Math.round((t - Number(g.date) * 1000) / 1000)).filter((s) => s >= 0 && s < 6 * 3600);
  const statusPatch = { last_sync_at: iso(t), last_sync_ok_at: iso(t), last_sync_attempt_at: iso(t), last_sync_reason: reason, last_sync_created: totals.created };
  if (fresh.length) {
    const latest = Math.min(...fresh);
    statusPatch.last_latency_s = latest;
    statusPatch.latencies_s = [...(status.latencies_s || []), latest].slice(-7);
  }
  const anyWeight = totals.groups.filter((g) => (g.measures || []).some((m) => m.type === 1));
  if (anyWeight.length) statusPatch.last_weigh_in_at = iso(Math.max(status.last_weigh_in_at ? Date.parse(status.last_weigh_in_at) : 0, ...anyWeight.map((g) => Number(g.date) * 1000)));
  await db.doc(P.status(uid)).set(statusPatch, { merge: true });
  return { ...totals, pages, cursor, groups: undefined };
}

// ---------- full-history backfill: one calendar year at a time ----------
// One open-ended request (startdate=0 → now) came back with only the last ~21 months of a 16-year account,
// with no error and no "more". So the history is walked in explicit windows: calendar years (UTC), newest
// first, each with a real startdate/enddate and offset paging inside it, all under an enddate pinned when
// the run starts. The walk stops once it is older than OLDEST_EXPECTED and EMPTY_YEARS_TO_STOP years in a
// row came back empty, and never goes before HARD_FLOOR_YEAR (Withings' first scales).
export const OLDEST_EXPECTED_YEAR = 2009;
export const EMPTY_YEARS_TO_STOP = 3;
export const HARD_FLOOR_YEAR = 2005;

/** startdate and enddate (both inclusive, as Withings reads them) in epoch seconds for calendar year `y`: Jan 1 00:00:00 to Dec 31 23:59:59 UTC, clipped to the run's pinned end. */
export function yearWindow(y, end) {
  const start = Date.UTC(y, 0, 1) / 1000;
  // Withings treats enddate as inclusive, so stop one second before next year: a reading at exactly 00:00:00 on
  // Jan 1 then belongs to the new year only, and per-year counts can't include it twice.
  const stop = Math.min(Date.UTC(y + 1, 0, 1) / 1000 - 1, end);
  return { start, end: stop };
}

const sumYear = (yr) => Object.values(yr || {}).reduce((a, p) => ({ g: a.g + (p.g || 0), w: a.w + (p.w || 0) }), { g: 0, w: 0 });

/** After finishing year `y`: is the walk done? (Pure; uses the per-year counts so retries can't skew it.) */
export function walkDone(years, y) {
  if (y - 1 < HARD_FLOOR_YEAR) return true;
  if (y > OLDEST_EXPECTED_YEAR) return false;
  let empty = 0;
  for (let k = y; k < y + EMPTY_YEARS_TO_STOP; k++) {
    if (years[k] && sumYear(years[k]).g === 0) empty++;
    else break;
  }
  return empty >= EMPTY_YEARS_TO_STOP;
}

/** Per-year totals { year: { groups, weighins } } from the stored page counts. */
export function yearTotals(years) {
  return Object.fromEntries(Object.entries(years || {}).map(([y, pages]) => { const t = sumYear(pages); return [y, { groups: t.g, weighins: t.w }]; }));
}

const hasWeight = (g) => (g.measures || []).some((m) => m.type === 1);

/**
 * One backfill page: year `year`, `offset` inside it, under the run's pinned `end` (epoch s).
 * Every count is SET per (year, page) rather than added, so a retried page can't inflate anything.
 * Returns { groups, more, offset, nextYear, done }.
 */
export async function backfillPage({ db, api, uid, token, year, end, offset = 0, page = 0, now = () => Date.now() }) {
  const statusSnap = await db.doc(P.status(uid)).get();
  const status = statusSnap.exists ? statusSnap.data() : {};
  const w = yearWindow(year, end);
  const body = w.start < w.end
    ? await getmeasSafe(api, token, { startdate: w.start, enddate: w.end, offset: offset || undefined })
    : { measuregrps: [], more: 0 };
  const groups = body.measuregrps || [];
  await applyGroups(db, uid, groups, { tz: body.timezone, now: now() });
  const prev = status.backfill || {};
  const years = { ...(prev.years || {}) };
  years[year] = { ...(years[year] || {}), [`p${offset || 0}`]: { g: groups.length, w: groups.filter(hasWeight).length } };
  const more = !!body.more && groups.length > 0;
  const nextOffset = more ? Number(body.offset) : null;
  const yearDone = !more;
  const done = yearDone && walkDone(years, year);
  const dates = groups.map((g) => Number(g.date) * 1000);
  const weighDates = groups.filter(hasWeight).map((g) => Number(g.date) * 1000);
  const from = Math.min(prev.from ? Date.parse(prev.from) : Infinity, ...dates);
  const to = Math.max(prev.to ? Date.parse(prev.to) : 0, ...dates);
  const totals = Object.values(yearTotals(years)).reduce((a, t) => ({ g: a.g + t.groups, w: a.w + t.weighins }), { g: 0, w: 0 });
  const patch = {
    backfill: {
      ...prev,
      years,
      groups: totals.g,
      weighins: totals.w,
      year: yearDone ? year - 1 : year,
      offset: nextOffset,
      page: page + 1,
      done,
      from: Number.isFinite(from) ? iso(from) : prev.from || null,
      to: to > 0 ? iso(to) : prev.to || null,
      updated_at: iso(now()),
      ...(done ? { finished_at: iso(now()) } : {}),
    },
  };
  // "Last weigh-in" on the Withings card: the newest weigh-in seen anywhere (sync or backfill).
  const lastSeen = Math.max(status.last_weigh_in_at ? Date.parse(status.last_weigh_in_at) : 0, ...weighDates);
  if (lastSeen > 0) patch.last_weigh_in_at = iso(lastSeen);
  await db.doc(P.status(uid)).set(patch, { mergeFields: ['backfill', ...(lastSeen > 0 ? ['last_weigh_in_at'] : [])] });
  return { groups: groups.length, more, offset: nextOffset, nextYear: yearDone ? year - 1 : year, done };
}

/**
 * Groups deleted in the Withings app don't send a notification. Compare the last 90 days (minus a day at
 * each edge) of weigh-in groups (meastype 1):
 *   - Forge's copies Withings no longer has are marked deleted_by: 'withings';
 *   - any copy the reconcile removed earlier that Withings lists again is restored (a lastupdate sync
 *     wouldn't re-send an unchanged group, so this is what makes removals reversible);
 *   - SAFETY STOP: if Withings' answer is empty, or more than max(3, 20% of Forge's weigh-ins in the window)
 *     would be removed, nothing is removed (deleting in the Withings app is one or two at a time).
 * Docs YOU deleted are never touched. Returns { removed, restored, aborted, suspicious }.
 */
export async function reconcile90({ db, api, uid, token, now = () => Date.now() }) {
  const end = Math.floor(now() / 1000);
  const start = end - 90 * 86400;
  const ids = new Set();
  let offset;
  let pages = 0;
  do {
    const body = await api.getmeas(token, { meastypes: [1], startdate: start, enddate: end, offset });
    for (const g of body.measuregrps || []) ids.add(docId(g.grpid));
    offset = body.more ? body.offset : undefined;
    if (++pages > 40) return { removed: 0, aborted: true }; // something's odd: don't delete on a partial list
  } while (offset != null);
  const lo = iso((start + 86400) * 1000);
  const hi = iso((end - 86400) * 1000);
  const snap = await db.collection(P.bodyCol(uid)).where('measured_at', '>=', lo).where('measured_at', '<=', hi).get();
  const t = iso(now());
  const restored = await restoreBack(db, uid, snap.docs.filter((d) => { const x = d.data(); return x.deleted === true && x.deleted_by === 'withings' && ids.has(d.id); }), t);
  const candidates = snap.docs.filter((d) => { const x = d.data(); return x.source === 'withings' && !x.deleted && x.metrics && x.metrics.weight_kg != null; });
  const gone = candidates.filter((d) => !ids.has(d.id));
  if (gone.length && (ids.size === 0 || gone.length > Math.max(3, Math.ceil(candidates.length * 0.2)))) {
    return { removed: 0, restored, aborted: true, suspicious: gone.length };
  }
  for (let i = 0; i < gone.length; i += 200) {
    const batch = db.batch();
    for (const d of gone.slice(i, i + 200)) {
      batch.update(db.doc(P.body(uid, d.id)), { deleted: true, deleted_at: t, deleted_by: 'withings', updated_at: t });
      const w = await db.doc(P.weight(uid, d.id)).get();
      if (w.exists && !w.data().deleted) batch.update(db.doc(P.weight(uid, d.id)), { deleted: true, deleted_at: t, deleted_by: 'withings', updated_at: t });
    }
    await batch.commit();
  }
  return { removed: gone.length, restored };
}

/** Undo the reconcile's own removals (body doc and its weight), dropping deleted/deleted_at/deleted_by. */
async function restoreBack(db, uid, docs, t) {
  const clean = (x) => {
    const { deleted_at, deleted_by, ...rest } = x; // eslint-disable-line no-unused-vars
    return { ...rest, deleted: false, updated_at: t };
  };
  for (let i = 0; i < docs.length; i += 200) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 200)) {
      batch.set(db.doc(P.body(uid, d.id)), clean(d.data()));
      const w = await db.doc(P.weight(uid, d.id)).get();
      if (w.exists && w.data().deleted === true && w.data().deleted_by === 'withings') batch.set(db.doc(P.weight(uid, d.id)), clean(w.data()));
    }
    await batch.commit();
  }
  return docs.length;
}
