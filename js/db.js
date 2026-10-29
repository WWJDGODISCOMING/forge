// Data layer. All user data lives under users/{uid}/{collection}/{id} (one level deep; workout sets are
// stored inside their workout document, so a whole session is one record).
// Writes are "fire and forget": they land in the on-device cache instantly and sync when online.
import {
  doc,
  setDoc,
  updateDoc,
  deleteField,
  collection,
  onSnapshot,
  getDocs,
  writeBatch,
  terminate,
  waitForPendingWrites,
  clearIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, auth } from './firebase.js';
import { state } from './state.js';

// Every collection the app writes. Export, delete-everything and firestore.rules use this list.
export const COLLECTIONS = ['profile', 'settings', 'locations', 'weights', 'workouts', 'cardio_sessions', 'programs', 'exercises', 'foods', 'food_logs', 'meal_plans', 'saved_meals'];
// Added after the first release. Until firestore.rules is republished they can't be read, so export and
// delete-everything treat "permission denied" on these as empty instead of failing.
export const NEWER_COLLECTIONS = ['foods', 'food_logs', 'meal_plans', 'saved_meals'];

// Written only by Cloud Functions (Withings sync; Apple Health from W2). The app reads them, includes them
// in exports and in delete-everything, and may only mark a record deleted (a tombstone the sync respects)
// or confirm a flagged weigh-in. put()/patch()/softDelete() refuse them.
export const READ_ONLY_COLLECTIONS = ['body_measures', 'health_daily', 'integrations'];
const readOnly = (col) => {
  if (READ_ONLY_COLLECTIONS.includes(col)) throw new Error(`${col} is written by the server only`);
};

const uid = () => auth.currentUser && auth.currentUser.uid;
const now = () => new Date().toISOString();

export function newId() {
  return crypto.randomUUID();
}

/** Builds a record with the standard fields every document carries. */
export function newRecord(data, { id = newId(), source = 'manual' } = {}) {
  const t = now();
  return { id, user_id: uid(), created_at: t, updated_at: t, source, deleted: false, ...data };
}

// ---- sync status ----
// Driven by Firestore's own hasPendingWrites flag on every watched collection, so writes made offline in an
// earlier session (still queued in the on-device cache) show as "Saving…" until the server confirms them.
const pendingByCol = new Map();

export function updateSync() {
  const pending = [...pendingByCol.values()].some(Boolean);
  const status = !navigator.onLine ? 'offline' : pending ? 'saving' : 'synced';
  if (state.sync !== status) state.set({ sync: status });
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', updateSync);

function reportWriteError(err) {
  console.error(err);
  window.dispatchEvent(new CustomEvent('forge:error', { detail: 'Couldn’t save to the cloud: ' + (err.code || err.message) }));
}

// ---- writes ----
export function put(col, record) {
  readOnly(col);
  setDoc(doc(db, 'users', uid(), col, record.id), record).catch(reportWriteError);
  return record;
}

export function patch(col, id, changes) {
  readOnly(col);
  updateDoc(doc(db, 'users', uid(), col, id), { ...changes, updated_at: now() }).catch(reportWriteError);
}

/** Imported Apple workouts already in Firestore, deleted ones included (the live lists hide them): Map id → { deleted }. */
export async function importedCardioIds() {
  const snap = await getDocs(collection(db, 'users', uid(), 'cardio_sessions'));
  const m = new Map();
  snap.docs.forEach((d) => { if (d.id.startsWith('hk_')) m.set(d.id, { deleted: !!d.data().deleted }); });
  return m;
}

/** Removes one field from a record (the profile's own protein goal going back to Auto). */
export function unsetField(col, id, field) {
  readOnly(col);
  updateDoc(doc(db, 'users', uid(), col, id), { [field]: deleteField(), updated_at: now() }).catch(reportWriteError);
}

export function softDelete(col, id) {
  if (col === 'body_measures' || col === 'health_daily') return tombstone(col, id);
  patch(col, id, { deleted: true, deleted_at: now() });
}

/** Delete a server-written record for good: deleted: true, which the sync never undoes. */
export function tombstone(col, id) {
  const t = now();
  updateDoc(doc(db, 'users', uid(), col, id), { deleted: true, deleted_at: t, updated_at: t }).catch(reportWriteError);
}

/**
 * "That's me" / "Not me" for a weigh-in in the review queue. item: { id, hasBody, hasWeight } — a reading
 * may have only a body_measures doc (no weight: heart rate only) or only a weights doc (weight.csv import),
 * and updating a document that doesn't exist fails, so each side is written only when it exists.
 */
export function reviewBodyMeasure(item, isMe) {
  const it = typeof item === 'string' ? { id: item, hasBody: true, hasWeight: true } : item;
  const t = now();
  if (isMe) {
    if (it.hasBody) updateDoc(doc(db, 'users', uid(), 'body_measures', it.id), { needs_review: false, reviewed_at: t, updated_at: t }).catch(reportWriteError);
    if (it.hasWeight) updateDoc(doc(db, 'users', uid(), 'weights', it.id), { review: false, reviewed_at: t, updated_at: t }).catch(reportWriteError);
  } else {
    bulkNotMe([it]);
  }
}

/**
 * "Not me" for many weigh-ins at once (a whole day, or everything under a weight): the body measurement
 * gets a tombstone the sync respects, and the weigh-in is deleted. Batched (≤400 writes per batch).
 */
export function bulkNotMe(items) {
  const t = now();
  const writes = [];
  for (const it of items) {
    if (it.hasBody) writes.push(['body_measures', it.id, { deleted: true, deleted_at: t, updated_at: t }]);
    if (it.hasWeight) writes.push(['weights', it.id, { deleted: true, deleted_at: t, updated_at: t, review: false, reviewed_at: t }]);
  }
  return commitInBatches(writes.map(([col, id, data]) => (b) => b.update(doc(db, 'users', uid(), col, id), data)));
}

/**
 * Tombstone weight.csv imports that Withings now also has (superseded: true keeps them out of the data
 * check's csv count, because the Withings copy is the one that's counted). Batched.
 */
export function supersedeWeights(ids) {
  const t = now();
  return commitInBatches(ids.map((id) => (b) => b.update(doc(db, 'users', uid(), 'weights', id), { deleted: true, deleted_at: t, updated_at: t, superseded: true })));
}

/** Add many new records to a user collection (e.g. a weight.csv import), batched. */
export function putMany(col, records) {
  readOnly(col);
  return commitInBatches(records.map((r) => (b) => b.set(doc(db, 'users', uid(), col, r.id), r)));
}

async function commitInBatches(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = writeBatch(db);
    ops.slice(i, i + size).forEach((op) => op(batch));
    // Offline, commit() only resolves once the server has it; the writes are already in the local cache.
    batch.commit().catch(reportWriteError);
  }
  return ops.length;
}

// ---- reads ----
/**
 * Live list of a collection (deleted records filtered out). Returns an unsubscribe function.
 * onError(err) is called if the listener fails (e.g. permission-denied when the rules aren't published).
 */
export function watch(col, cb, onError) {
  let first = true;
  return onSnapshot(
    collection(db, 'users', uid(), col),
    { includeMetadataChanges: true },
    (snap) => {
      pendingByCol.set(col, snap.metadata.hasPendingWrites);
      updateSync();
      // Skip metadata-only updates (e.g. "write confirmed") so screens don't redraw for nothing.
      if (!first && snap.docChanges().length === 0) return;
      first = false;
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.deleted)); // server status docs carry no id field
    },
    (err) => {
      console.error(col, err);
      pendingByCol.delete(col);
      if (onError) onError(err);
    }
  );
}

export async function readAll(col) {
  const snap = await getDocs(collection(db, 'users', uid(), col));
  return snap.docs.map((d) => d.data());
}

// ---- delete everything ----
export async function deleteAllUserData() {
  if (!navigator.onLine) throw new Error('You need a connection to delete your cloud data.');
  // Server-written data (Withings tokens, body measures, Apple Health days) goes first, through the
  // server: the app can't delete those itself. Skipped only if you never had any.
  const count = (col) => getDocs(collection(db, 'users', uid(), col)).then((x) => x.size, () => 0); // rules not published yet → none
  const serverData = (await Promise.all(READ_ONLY_COLLECTIONS.map(count))).some((n) => n > 0);
  // The same call also removes private/food_search (USDA search counter), which only the server can delete, so it
  // runs for everyone. With no server data it is best effort: not reaching the server mustn't block deleting the rest.
  try {
    const { call } = await import('./functions.js');
    await call('withingsDisconnect', { deleteData: true, deleteApple: true }); // Withings data, Apple Health data, food search
  } catch (e) {
    if (serverData) throw e;
  }
  for (const col of COLLECTIONS) {
    const snap = await getDocs(collection(db, 'users', uid(), col)).catch((e) => {
      if (NEWER_COLLECTIONS.includes(col)) return { docs: [] }; // rules not republished: nothing could have been saved there
      throw e;
    });
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
}

/** Waits (up to `ms`) for queued writes to reach the cloud. Never throws; offline writes just stay queued. */
export async function flushWrites(ms = 4000) {
  await Promise.race([waitForPendingWrites(db).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

/** Wipes the on-device copy. Call after the account is deleted. */
export async function clearLocalCache() {
  await terminate(db);
  await clearIndexedDbPersistence(db);
}
