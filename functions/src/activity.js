// Withings daily steps (Measure v2 getactivity) into the same per-day doc Apple Health uses
// (users/{uid}/health_daily/{day}), so the missions, Past days and the leg-activity stripe need no new reader.
//   - the Withings number lives in `withings_steps`, Apple's in `apple_steps`; `steps` is the higher of the
//     two (never the sum) and `steps_source` says which one won, 'apple' on a tie (see resolveSteps);
//   - idempotent: a day whose numbers didn't change is not written; a day you deleted stays deleted;
//   - one request covers the 7-day window, so it is rate-limit friendly.
import { P } from './paths.js';
import { WithingsError } from './withings-api.js';
import { mergeDay, resolveSteps } from './health.js';

export const WINDOW_DAYS = 7;
const MAX_PAGES = 3;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Did this connection get the activity scope? Unknown scopes (null) count as yes: the call tells us. */
export function hasActivityScope(scopes) {
  if (typeof scopes !== 'string' || !scopes.trim()) return true;
  return scopes.split(/[,\s]+/).includes('user.activity');
}

/** getactivity body → [{ day, steps }]: valid dates and whole, plausible step counts only. */
export function parseActivity(body) {
  const out = new Map();
  for (const a of (body && body.activities) || []) {
    const steps = a && typeof a.steps === 'number' ? Math.round(a.steps) : null;
    if (!a || !DAY_RE.test(String(a.date)) || steps == null || steps < 0 || steps > 200000) continue;
    out.set(a.date, steps);
  }
  return [...out].map(([day, steps]) => ({ day, steps }));
}

/** Write Withings steps for days. Returns { written, skipped }. */
export async function upsertWithingsSteps({ db, uid, days, now = () => Date.now() }) {
  const nowIso = new Date(now()).toISOString();
  const refs = days.map((d) => db.doc(P.health(uid, d.day)));
  if (!refs.length) return { written: 0, skipped: 0 };
  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    let written = 0;
    let skipped = 0;
    snaps.forEach((snap, i) => {
      const cur = snap.exists ? snap.data() : null;
      if (cur && cur.deleted) { skipped++; return; }
      const next = mergeDay(cur, { uid, day: days[i].day, fields: { withings_steps: days[i].steps }, source: 'withings', nowIso });
      if (!next) return;
      tx.set(refs[i], next);
      written++;
    });
    return { written, skipped };
  });
}

/**
 * Pull the last 7 days of steps. A missing scope is a calm no-op ({ skipped: 'no_scope' }); Withings errors
 * propagate (the caller decides whether they are worth a retry).
 */
export async function syncActivity({ db, api, uid, token, now = () => Date.now() }) {
  const st = await db.doc(P.status(uid)).get();
  if (st.exists && !hasActivityScope(st.data().scopes)) return { skipped: 'no_scope' };
  const t = now();
  // Dates here are UTC; the 7-day window plus one day of slack at the end covers US Eastern evenings.
  const days = new Map();
  let offset;
  let pages = 0;
  do {
    const body = await api.getactivity(token, { startdateymd: ymd(t - (WINDOW_DAYS - 1) * 86400000), enddateymd: ymd(t + 86400000), offset });
    for (const d of parseActivity(body)) days.set(d.day, d.steps);
    offset = body.more ? body.offset : undefined;
  } while (offset != null && ++pages < MAX_PAGES);
  const r = await upsertWithingsSteps({ db, uid, days: [...days].map(([day, steps]) => ({ day, steps })), now });
  await db.doc(P.status(uid)).set({ activity_synced_at: new Date(t).toISOString(), activity_error: null }, { merge: true });
  return { days: days.size, ...r };
}

/**
 * "Delete Withings data": take the Withings step numbers back out of health_daily. A day that only Withings
 * filled is deleted; a day Apple Health also filled keeps Apple's number.
 */
export async function stripWithingsSteps({ db, uid, now = () => Date.now() }) {
  const snap = await db.collection(P.healthCol(uid)).get();
  const nowIso = new Date(now()).toISOString();
  const mine = snap.docs.filter((d) => d.data().withings_steps != null);
  for (let i = 0; i < mine.length; i += 400) {
    const b = db.batch();
    for (const d of mine.slice(i, i + 400)) {
      const { withings_steps, steps, steps_source, ...rest } = d.data(); // eslint-disable-line no-unused-vars
      const ref = db.doc(d.ref.path);
      const sources = (rest.sources || []).filter((s) => s !== 'withings');
      if (rest.apple_steps == null && !sources.length) { b.delete(ref); continue; }
      b.set(ref, resolveSteps({ ...rest, ...(rest.apple_steps != null ? { steps: rest.apple_steps } : {}), sources, updated_at: nowIso }));
    }
    await b.commit();
  }
  return mine.length;
}

/** syncActivity that never throws: the weight sync must not fail because steps did. Records a quiet code. */
export async function syncActivitySafe(deps) {
  try {
    return await syncActivity(deps);
  } catch (e) {
    const code = e instanceof WithingsError ? String(e.status) : 'x';
    await deps.db.doc(P.status(deps.uid)).set({ activity_error: code }, { merge: true }).catch(() => {});
    return { error: code, status: e.status, transient: e instanceof WithingsError && e.transient };
  }
}
