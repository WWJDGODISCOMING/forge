// Security rule tests. They run against the local Firebase emulator only (the "demo-" project ID
// guarantees the emulator can never touch a real Firebase project). No cloud, no cost.
//   cd tests/rules && npm install && npm test
// Needs Node 20+ and Java 21+. See SETUP.md → "Optional: run the security rule tests".
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, collectionGroup, getDocs,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-forge';
let env;
const rec = (uid, id, extra = {}) => ({
  id, user_id: uid, created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
  source: 'manual', deleted: false, ...extra,
});
const weight = (uid, id) => rec(uid, id, { kg: 90, day: '2026-10-07' });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const as = (uid) => env.authenticatedContext(uid).firestore();

test('owner can create, read, update and delete their own record', async () => {
  const db = as('alice');
  const ref = doc(db, 'users/alice/weights/w1');
  await assertSucceeds(setDoc(ref, weight('alice', 'w1')));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, { kg: 89, updated_at: '2026-10-08T00:00:00Z' }));
  await assertSucceeds(updateDoc(ref, { deleted: true, deleted_at: '2026-10-08T00:00:00Z' }));
  await assertSucceeds(deleteDoc(ref));
});

test('profile/main: the how-to tour fields (tour, tour_seen_at) can be created and updated by the owner only', async () => {
  const db = as('alice');
  const ref = doc(db, 'users/alice/profile/main');
  const profile = rec('alice', 'main', { goal: 'lose', weightKg: 70, heightCm: 165, tour: 'pending' });
  await assertSucceeds(setDoc(ref, profile));
  await assertSucceeds(updateDoc(ref, { tour: 'seen', tour_seen_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z' }));
  await assertFails(setDoc(doc(as('bob'), 'users/alice/profile/main'), profile));
  await assertFails(updateDoc(doc(as('bob'), 'users/alice/profile/main'), { tour: 'pending', updated_at: '2026-10-08T13:00:00Z' }));
  await assertFails(updateDoc(ref, { tour: 'pending', user_id: 'bob' }));
});

test('weights: tombstoning a weight.csv import that Withings now covers (superseded: true) is allowed; an un-delete is not', async () => {
  const db = as('alice');
  const ref = doc(db, 'users/alice/weights/c_1');
  await assertSucceeds(setDoc(ref, rec('alice', 'c_1', { kg: 93.3, day: '2024-03-05', measured_at: '2024-03-05T12:00:00Z', source: 'withings_csv' })));
  await assertSucceeds(updateDoc(ref, { deleted: true, deleted_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', superseded: true }));
  await assertFails(updateDoc(doc(as('bob'), 'users/alice/weights/c_1'), { superseded: false }));
});

test('settings/main: saving earned badges (awards_seen map) keeps working', async () => {
  const db = as('alice');
  const ref = doc(db, 'users/alice/settings/main');
  await assertSucceeds(setDoc(ref, rec('alice', 'main')));
  await assertSucceeds(updateDoc(ref, { awards_seen: { first: '2026-09-07T10:00:00Z' }, updated_at: '2026-10-08T00:00:00Z' }));
  await assertSucceeds(updateDoc(ref, { awards_seen: { first: '2026-09-07T10:00:00Z', ten: '2026-10-08T10:00:00Z' }, updated_at: '2026-10-08T01:00:00Z' }));
  await assertFails(updateDoc(ref, { awards_seen: { first: '2026-09-07' }, user_id: 'bob' }));
});

test('settings/main: exercise_prefs (Recommend more / less) saves, clears and stays private', async () => {
  const db = as('alice');
  const ref = doc(db, 'users/alice/settings/main');
  await assertSucceeds(setDoc(ref, rec('alice', 'main')));
  await assertSucceeds(updateDoc(ref, { exercise_prefs: { db_curl: 'more', bb_back_squat: 'less' }, updated_at: '2026-10-26T00:00:00Z' }));
  await assertSucceeds(updateDoc(ref, { exercise_prefs: {}, updated_at: '2026-10-26T00:01:00Z' }));
  await assertFails(updateDoc(doc(as('bob'), 'users/alice/settings/main'), { exercise_prefs: { db_curl: 'less' } }));
});

test('owner can list their own collection', async () => {
  const db = as('alice');
  await setDoc(doc(db, 'users/alice/weights/w1'), weight('alice', 'w1'));
  await assertSucceeds(getDocs(collection(db, 'users/alice/weights')));
});

test('another user cannot read, list or write my data', async () => {
  await assertSucceeds(setDoc(doc(as('alice'), 'users/alice/weights/w1'), weight('alice', 'w1')));
  const bob = as('bob');
  await assertFails(getDoc(doc(bob, 'users/alice/weights/w1')));
  await assertFails(getDocs(collection(bob, 'users/alice/weights')));
  await assertFails(setDoc(doc(bob, 'users/alice/weights/w2'), weight('bob', 'w2')));
  await assertFails(setDoc(doc(bob, 'users/alice/weights/w2'), weight('alice', 'w2')));
  await assertFails(deleteDoc(doc(bob, 'users/alice/weights/w1')));
});

test('collection-group queries are denied, even for the owner', async () => {
  await setDoc(doc(as('alice'), 'users/alice/weights/w1'), weight('alice', 'w1'));
  await assertFails(getDocs(collectionGroup(as('alice'), 'weights')));
  await assertFails(getDocs(collectionGroup(as('bob'), 'weights')));
});

test('signed-out visitors get nothing', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, 'users/alice/weights/w1')));
  await assertFails(getDocs(collection(anon, 'users/alice/weights')));
  await assertFails(setDoc(doc(anon, 'users/alice/weights/w1'), weight('alice', 'w1')));
});

test('records must carry the standard fields and matching ids', async () => {
  const db = as('alice');
  await assertFails(setDoc(doc(db, 'users/alice/weights/w1'), { kg: 90, day: '2026-10-07' }));
  await assertFails(setDoc(doc(db, 'users/alice/weights/w1'), weight('alice', 'different-id')));
  await assertFails(setDoc(doc(db, 'users/alice/weights/w1'), weight('bob', 'w1')));
});

test('created_at and user_id cannot change; standard fields cannot be removed', async () => {
  const db = as('alice');
  const ref = doc(db, 'users/alice/weights/w1');
  await setDoc(ref, weight('alice', 'w1'));
  await assertFails(updateDoc(ref, { created_at: '2020-01-01T00:00:00Z' }));
  await assertFails(updateDoc(ref, { user_id: 'bob' }));
  await assertFails(updateDoc(ref, { source: deleteField() }));
  await assertFails(updateDoc(ref, { deleted: deleteField() }));
});

test('only known collections are allowed', async () => {
  await assertFails(setDoc(doc(as('alice'), 'users/alice/secrets/x'), rec('alice', 'x')));
  await assertFails(getDocs(collection(as('alice'), 'users/alice/secrets')));
});

test('basic type checks', async () => {
  const db = as('alice');
  await assertFails(setDoc(doc(db, 'users/alice/weights/w1'), rec('alice', 'w1', { kg: '90', day: '2026-10-07' })));
  await assertFails(setDoc(doc(db, 'users/alice/weights/w1'), rec('alice', 'w1', { kg: 0, day: '2026-10-07' })));
  await assertFails(setDoc(doc(db, 'users/alice/profile/other'), rec('alice', 'other', { goal: 'lose', weightKg: 90, heightCm: 180 })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/profile/main'), rec('alice', 'main', { goal: 'lose', weightKg: 90, heightCm: 180 })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/workouts/k1'), rec('alice', 'k1', { location_id: 'l1', exercises: [], started_at: '2026-10-07T10:00:00Z', status: 'active' })));
  await assertFails(setDoc(doc(db, 'users/alice/workouts/k2'), rec('alice', 'k2', { exercises: [], started_at: '2026-10-07T10:00:00Z', status: 'active' })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/locations/l1'), rec('alice', 'l1', { name: 'Home', equipment: [], weight_inventory: {} })));
});

test('deeper paths are denied', async () => {
  const db = as('alice');
  await assertFails(setDoc(doc(db, 'users/alice/weights/w1/notes/n1'), rec('alice', 'n1')));
  await assertFails(getDoc(doc(db, 'users/alice/weights/w1/notes/n1')));
});

test('private collection is closed even to the owner', async () => {
  const db = as('alice');
  await assertFails(setDoc(doc(db, 'users/alice/private/withings'), rec('alice', 'withings')));
  await assertFails(getDoc(doc(db, 'users/alice/private/withings')));
});

test('the users/{uid} document itself is closed', async () => {
  await assertFails(setDoc(doc(as('alice'), 'users/alice'), { x: 1 }));
  await assertFails(getDoc(doc(as('alice'), 'users/alice')));
});

test('workouts: pause fields are typed (v0.3.0)', async () => {
  const db = as('alice');
  const base = rec('alice', 'k1', { location_id: 'l1', exercises: [], started_at: '2026-10-08T10:00:00Z', status: 'active' });
  const ref = doc(db, 'users/alice/workouts/k1');
  await assertSucceeds(setDoc(ref, { ...base, paused_at: null, paused_ms: 0 }));
  await assertSucceeds(updateDoc(ref, { paused_at: '2026-10-08T10:20:00Z', updated_at: '2026-10-08T10:20:00Z' }));
  await assertSucceeds(updateDoc(ref, { paused_at: null, paused_ms: 300000, updated_at: '2026-10-08T10:25:00Z' }));
  await assertSucceeds(updateDoc(ref, { status: 'done', duration_ms: 3600000, updated_at: '2026-10-08T11:30:00Z' }));
  await assertFails(updateDoc(ref, { paused_ms: -5 }));
  await assertFails(updateDoc(ref, { paused_ms: '300000' }));
  await assertFails(updateDoc(ref, { paused_at: 12345 }));
  await assertFails(updateDoc(ref, { duration_ms: -1 }));
});

// ---------- v0.4.0: Withings (server-written collections) ----------
const serverDoc = (uid, id, extra = {}) => ({ ...rec(uid, id), source: 'withings', ...extra });

async function seed(path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), path), data); });
}

test('body_measures, health_daily, integrations: the owner can read them; others and signed-out visitors cannot', async () => {
  await seed('users/alice/body_measures/w_1', serverDoc('alice', 'w_1', { metrics: { weight_kg: 82.3 } }));
  await seed('users/alice/health_daily/2026-10-08', serverDoc('alice', '2026-10-08', { steps: 9000 }));
  await seed('users/alice/integrations/withings', { connected: true, model: 'Body Comp' });
  const alice = as('alice');
  await assertSucceeds(getDoc(doc(alice, 'users/alice/body_measures/w_1')));
  await assertSucceeds(getDocs(collection(alice, 'users/alice/body_measures')));
  await assertSucceeds(getDoc(doc(alice, 'users/alice/health_daily/2026-10-08')));
  await assertSucceeds(getDoc(doc(alice, 'users/alice/integrations/withings')));
  const bob = as('bob');
  await assertFails(getDoc(doc(bob, 'users/alice/body_measures/w_1')));
  await assertFails(getDocs(collection(bob, 'users/alice/health_daily')));
  await assertFails(getDoc(doc(bob, 'users/alice/integrations/withings')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice/body_measures/w_1')));
});

test('the owner cannot create or freely update server-written records, or hard-delete them', async () => {
  const alice = as('alice');
  await assertFails(setDoc(doc(alice, 'users/alice/body_measures/w_9'), serverDoc('alice', 'w_9', { metrics: { weight_kg: 70 } })));
  await assertFails(setDoc(doc(alice, 'users/alice/health_daily/2026-10-09'), serverDoc('alice', '2026-10-09')));
  await assertFails(setDoc(doc(alice, 'users/alice/integrations/withings'), { connected: true }));
  await seed('users/alice/body_measures/w_1', serverDoc('alice', 'w_1', { metrics: { weight_kg: 82.3 }, needs_review: false }));
  await seed('users/alice/integrations/withings', { connected: true });
  await assertFails(updateDoc(doc(alice, 'users/alice/body_measures/w_1'), { metrics: { weight_kg: 60 }, updated_at: '2026-10-09T00:00:00Z' }));
  await assertFails(updateDoc(doc(alice, 'users/alice/body_measures/w_1'), { deleted: true, source: 'manual', updated_at: '2026-10-09T00:00:00Z' }));
  await assertFails(updateDoc(doc(alice, 'users/alice/integrations/withings'), { connected: false }));
  await assertFails(deleteDoc(doc(alice, 'users/alice/body_measures/w_1')), 'hard delete would let the sync write it back');
  await assertFails(deleteDoc(doc(alice, 'users/alice/integrations/withings')));
});

test('deleting a body measurement is a tombstone the owner can set but never undo', async () => {
  await seed('users/alice/body_measures/w_1', serverDoc('alice', 'w_1', { metrics: { weight_kg: 82.3 } }));
  await seed('users/alice/health_daily/2026-10-08', serverDoc('alice', '2026-10-08', { steps: 1 }));
  const alice = as('alice');
  const ref = doc(alice, 'users/alice/body_measures/w_1');
  await assertSucceeds(updateDoc(ref, { deleted: true, deleted_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }));
  await assertFails(updateDoc(ref, { deleted: false, updated_at: '2026-10-09T00:01:00Z' }));
  await assertFails(updateDoc(ref, { deleted: 'yes', updated_at: '2026-10-09T00:01:00Z' }));
  await assertSucceeds(updateDoc(doc(alice, 'users/alice/health_daily/2026-10-08'), { deleted: true, deleted_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }));
  await assertFails(updateDoc(doc(as('bob'), 'users/alice/body_measures/w_1'), { deleted: true, updated_at: '2026-10-09T00:00:00Z' }));
});

test('a flagged weigh-in can be confirmed (needs_review/reviewed_at only)', async () => {
  await seed('users/alice/body_measures/w_2', serverDoc('alice', 'w_2', { needs_review: true }));
  const ref = doc(as('alice'), 'users/alice/body_measures/w_2');
  await assertSucceeds(updateDoc(ref, { needs_review: false, reviewed_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }));
  await assertFails(updateDoc(ref, { needs_review: 'no', updated_at: '2026-10-09T00:00:00Z' }));
  await assertFails(updateDoc(ref, { reviewed_at: 5, updated_at: '2026-10-09T00:00:00Z' }));
});

test('Withings weights (w_*) stay ordinary weights: the owner can soft-delete and confirm them', async () => {
  await seed('users/alice/weights/w_3', { ...weight('alice', 'w_3'), source: 'withings', grpid: 3, review: true });
  const ref = doc(as('alice'), 'users/alice/weights/w_3');
  await assertSucceeds(updateDoc(ref, { review: false, reviewed_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }));
  await assertSucceeds(updateDoc(ref, { deleted: true, deleted_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }));
});

test('top-level server collections are closed to everyone; private/shortcut too', async () => {
  for (const ctx of [as('alice'), env.unauthenticatedContext().firestore()]) {
    for (const path of ['oauth_states/abc', 'withings_users/424242', 'shortcut_tokens/deadbeef']) {
      await assertFails(getDoc(doc(ctx, path)));
      await assertFails(setDoc(doc(ctx, path), { uid: 'alice' }));
    }
    await assertFails(getDocs(collection(ctx, 'withings_users')));
  }
  const alice = as('alice');
  await assertFails(getDoc(doc(alice, 'users/alice/private/shortcut')));
  await assertFails(setDoc(doc(alice, 'users/alice/private/shortcut'), { token_hash: 'x' }));
});

test('exactly what the sync writes (functions/test fixture): "That\'s me", soft-delete and tombstone all pass', async () => {
  // tests/rules/fixtures/applygroups.json is generated from functions/src/sync.js applyGroups and checked
  // against it by a functions test, so this can't drift from the real documents.
  const docs = JSON.parse(readFileSync(new URL('./fixtures/applygroups.json', import.meta.url), 'utf8'));
  for (const [path, d] of Object.entries(docs)) await seed(path, d);
  const alice = as('alice');
  const t = '2026-10-11T00:00:00.000Z';
  // The restored, flagged weigh-in: confirm it in both places, like the app does.
  await assertSucceeds(updateDoc(doc(alice, 'users/alice/body_measures/w_12'), { needs_review: false, reviewed_at: t, updated_at: t }));
  await assertSucceeds(updateDoc(doc(alice, 'users/alice/weights/w_12'), { review: false, reviewed_at: t, updated_at: t }));
  // Delete the other one in both places.
  await assertSucceeds(updateDoc(doc(alice, 'users/alice/body_measures/w_11'), { deleted: true, deleted_at: t, updated_at: t }));
  await assertSucceeds(updateDoc(doc(alice, 'users/alice/weights/w_11'), { deleted: true, deleted_at: t, updated_at: t }));
});

// ---- v0.11.0: foods (My foods) and food_logs ----
const food = (uid, id, extra = {}) => rec(uid, id, { name: 'Greek yoghurt', kcal: 130, protein_g: 17, carbs_g: 6, fat_g: 4, serving: '1 cup', ...extra });
const foodLog = (uid, id, extra = {}) => rec(uid, id, {
  day: '2026-10-09', meal: 'lunch', name: 'Greek yoghurt', kcal: 130, protein_g: 17, carbs_g: 6, fat_g: 4, servings: 1.5, ...extra,
});
const T9 = '2026-10-09T00:00:00Z';
const defined = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));

test('foods and food_logs: the owner can create, read, update, tombstone and delete', async () => {
  const db = as('alice');
  const f = doc(db, 'users/alice/foods/f1');
  await assertSucceeds(setDoc(f, food('alice', 'f1')));
  await assertSucceeds(getDoc(f));
  await assertSucceeds(updateDoc(f, { kcal: 140, updated_at: T9 }));
  await assertSucceeds(updateDoc(f, { deleted: true, deleted_at: T9, updated_at: T9 }));
  await assertSucceeds(deleteDoc(f));
  const l = doc(db, 'users/alice/food_logs/l1');
  await assertSucceeds(setDoc(l, foodLog('alice', 'l1', { food_id: 'f1' })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/food_logs/l2'), foodLog('alice', 'l2'))); // quick add: no food_id
  await assertSucceeds(updateDoc(l, { servings: 2, updated_at: T9 }));
  await assertSucceeds(updateDoc(l, { deleted: true, deleted_at: T9, updated_at: T9 }));
  await assertSucceeds(getDocs(collection(db, 'users/alice/food_logs')));
  await assertSucceeds(deleteDoc(l));
});

test('foods and food_logs: another uid, and signed-out visitors, get nothing', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/alice/foods/f1'), food('alice', 'f1'));
    await setDoc(doc(ctx.firestore(), 'users/alice/food_logs/l1'), foodLog('alice', 'l1'));
  });
  const bob = as('bob');
  const anon = env.unauthenticatedContext().firestore();
  for (const path of ['users/alice/foods/f1', 'users/alice/food_logs/l1']) {
    await assertFails(getDoc(doc(bob, path)));
    await assertFails(deleteDoc(doc(bob, path)));
    await assertFails(updateDoc(doc(bob, path), { kcal: 1, updated_at: T9 }));
    await assertFails(getDoc(doc(anon, path)));
  }
  await assertFails(getDocs(collection(bob, 'users/alice/foods')));
  await assertFails(getDocs(collection(bob, 'users/alice/food_logs')));
  await assertFails(setDoc(doc(bob, 'users/alice/foods/f2'), food('alice', 'f2')));
  await assertFails(setDoc(doc(bob, 'users/alice/food_logs/l2'), foodLog('alice', 'l2')));
  await assertFails(setDoc(doc(bob, 'users/bob/foods/f3'), food('alice', 'f3'))); // user_id must be the writer
  await assertFails(setDoc(doc(anon, 'users/alice/foods/f4'), food('alice', 'f4')));
});

test('foods: wrong types and out-of-range values are denied', async () => {
  const db = as('alice');
  const bad = [
    { name: '' }, { name: 'x'.repeat(81) }, { name: 5 }, { name: undefined },
    { kcal: -1 }, { kcal: 5001 }, { kcal: '130' }, { kcal: undefined },
    { protein_g: -1 }, { protein_g: 501 }, { carbs_g: -0.1 }, { carbs_g: 501 }, { fat_g: -1 }, { fat_g: 501 }, { fat_g: '4' },
    { serving: 'x'.repeat(41) }, { serving: 3 }, { serving: undefined },
  ];
  let i = 0;
  for (const extra of bad) {
    const id = `b${i++}`;
    await assertFails(setDoc(doc(db, `users/alice/foods/${id}`), defined(food('alice', id, extra))));
  }
  // The limits themselves are fine.
  await assertSucceeds(setDoc(doc(db, 'users/alice/foods/ok1'), food('alice', 'ok1', { name: 'x'.repeat(80), kcal: 5000, protein_g: 500, carbs_g: 500, fat_g: 500, serving: 'x'.repeat(40) })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/foods/ok2'), food('alice', 'ok2', { name: 'x', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, serving: '' })));
  // v0.16.44: the optional barcode (8–14 digits) and favorite (bool) are type-checked.
  await assertSucceeds(setDoc(doc(db, 'users/alice/foods/bc1'), food('alice', 'bc1', { barcode: '096619123456', favorite: true })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/foods/bc2'), food('alice', 'bc2', { barcode: '12345678', favorite: false })));
  for (const [k, extra] of [['bc3', { barcode: '123456789012345' }], ['bc4', { barcode: '12345abc' }], ['bc5', { barcode: 96619123456 }],
    ['bc6', { barcode: '1234567' }], ['bc7', { favorite: 'yes' }], ['bc8', { favorite: 1 }]]) {
    await assertFails(setDoc(doc(db, `users/alice/foods/${k}`), food('alice', k, extra)));
  }
  // An update that breaks a rule is denied too.
  await assertFails(updateDoc(doc(db, 'users/alice/foods/ok1'), { kcal: 5001, updated_at: T9 }));
});

test('food_logs: wrong types and out-of-range values are denied', async () => {
  const db = as('alice');
  const bad = [
    { day: '2026-10-9' }, { day: '10/09/2026' }, { day: 20261009 }, { day: '2026-10-09T10:00' }, { day: undefined },
    { meal: 'brunch' }, { meal: 'Lunch' }, { meal: undefined },
    { name: '' }, { name: 'x'.repeat(81) }, { kcal: -1 }, { kcal: 5001 }, { kcal: '130' },
    { protein_g: 501 }, { carbs_g: -1 }, { fat_g: 501 },
    { servings: 0 }, { servings: -1 }, { servings: 20.5 }, { servings: '1' }, { servings: undefined },
    { food_id: 7 }, { food_id: null },
  ];
  let i = 0;
  for (const extra of bad) {
    const id = `b${i++}`;
    await assertFails(setDoc(doc(db, `users/alice/food_logs/${id}`), defined(foodLog('alice', id, extra))));
  }
  await assertSucceeds(setDoc(doc(db, 'users/alice/food_logs/ok1'), foodLog('alice', 'ok1', { servings: 20, kcal: 5000, meal: 'snack', food_id: 'f1' })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/food_logs/ok2'), foodLog('alice', 'ok2', { servings: 0.25, kcal: 0, meal: 'breakfast' })));
  await assertSucceeds(setDoc(doc(db, 'users/alice/food_logs/ok3'), foodLog('alice', 'ok3', { meal: 'dinner' })));
  await assertFails(updateDoc(doc(db, 'users/alice/food_logs/ok1'), { servings: 21, updated_at: T9 }));
  await assertFails(updateDoc(doc(db, 'users/alice/food_logs/ok1'), { meal: 'brunch', updated_at: T9 }));
});

// ---- saved_meals (v0.16.75): favorite meals ----
const savedMeal = (uid, id, extra = {}) => rec(uid, id, {
  name: 'Chicken and rice', meal: 'dinner', items: [{ name: 'Chicken', kcal: 250, protein_g: 40, carbs_g: 0, fat_g: 8, servings: 1 }], ...extra,
});

test('saved_meals: the owner can create, read, update (rename, last used), tombstone and delete', async () => {
  const db = as('alice');
  const ref = doc(db, 'users/alice/saved_meals/m1');
  await assertSucceeds(setDoc(ref, savedMeal('alice', 'm1')));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(db, 'users/alice/saved_meals')));
  await assertSucceeds(updateDoc(ref, { name: 'Dinner', last_used_at: T9, updated_at: T9 }));
  await assertSucceeds(updateDoc(ref, { deleted: true, deleted_at: T9, updated_at: T9 }));
  await assertSucceeds(setDoc(doc(db, 'users/alice/saved_meals/m2'), savedMeal('alice', 'm2', { meal: undefined })));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice/saved_meals/m2')));
});

test('saved_meals: another uid and signed-out visitors get nothing', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'users/alice/saved_meals/m1'), savedMeal('alice', 'm1')); });
  const bob = as('bob');
  await assertFails(getDoc(doc(bob, 'users/alice/saved_meals/m1')));
  await assertFails(getDocs(collection(bob, 'users/alice/saved_meals')));
  await assertFails(setDoc(doc(bob, 'users/alice/saved_meals/m2'), savedMeal('alice', 'm2')));
  await assertFails(deleteDoc(doc(bob, 'users/alice/saved_meals/m1')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice/saved_meals/m1')));
});

test('saved_meals: wrong types and sizes are denied', async () => {
  const db = as('alice');
  const item = { name: 'Egg', kcal: 70, protein_g: 6, carbs_g: 0, fat_g: 5, servings: 1 };
  const bad = [
    { name: '' }, { name: 'x'.repeat(41) }, { name: 7 }, { name: undefined },
    { items: [] }, { items: Array.from({ length: 21 }, () => item) }, { items: 'eggs' }, { items: undefined }, { items: { a: item } },
    { meal: 'brunch' }, { meal: 7 }, { last_used_at: 5 },
  ];
  let i = 0;
  for (const extra of bad) {
    const id = `b${i++}`;
    await assertFails(setDoc(doc(db, `users/alice/saved_meals/${id}`), defined(savedMeal('alice', id, extra))));
  }
  await assertSucceeds(setDoc(doc(db, 'users/alice/saved_meals/ok1'), savedMeal('alice', 'ok1', { name: 'x'.repeat(40), items: Array.from({ length: 20 }, () => item), meal: 'snack', last_used_at: T9 })));
  await assertFails(updateDoc(doc(db, 'users/alice/saved_meals/ok1'), { items: [], updated_at: T9 }));
  await assertFails(updateDoc(doc(db, 'users/alice/saved_meals/ok1'), { created_at: '2020-01-01T00:00:00Z' }));
  await assertFails(updateDoc(doc(db, 'users/alice/saved_meals/ok1'), { user_id: 'bob' }));
});

test('foods and food_logs: created_at and user_id cannot change, standard fields cannot be removed', async () => {
  const db = as('alice');
  for (const [col, d] of [['foods', food('alice', 'x1')], ['food_logs', foodLog('alice', 'x1')]]) {
    const ref = doc(db, `users/alice/${col}/x1`);
    await setDoc(ref, d);
    await assertFails(updateDoc(ref, { created_at: '2020-01-01T00:00:00Z' }));
    await assertFails(updateDoc(ref, { user_id: 'bob' }));
    await assertFails(updateDoc(ref, { source: deleteField() }));
    await assertFails(updateDoc(ref, { deleted: deleteField() }));
    await assertFails(updateDoc(ref, { kcal: deleteField() }));
    await assertFails(updateDoc(ref, { name: deleteField() }));
    await assertFails(setDoc(doc(db, `users/alice/${col}/other`), { ...d, id: 'x1' })); // id must match the path
  }
});

// ---- meal_plans (v0.16.22): one doc per Monday; read and delete by the owner, written only by Cloud Functions ----
const MON = '2026-10-19';
const meal = (slot) => ({ slot, id: 'd-chicken-veg', name: 'Roast chicken with vegetables', servings: 1, kcal: 600, protein_g: 45, carbs_g: 50, fat_g: 20,
  ingredients: [{ name: 'chicken', qty: '5 oz' }], steps: ['Roast until cooked through.'] });
const fiveMeals = ['breakfast', 'lunch', 'dinner', 'snack1', 'snack2'].map(meal);
const plan = (uid, id = MON) => rec(uid, id, {
  source: 'ai', weekStart: id, days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${19 + i}`, meals: fiveMeals })),
});

test('meal_plans: the owner can read and delete a week but cannot create or change one', async () => {
  const ref = doc(as('alice'), `users/alice/meal_plans/${MON}`);
  await assertFails(setDoc(ref, plan('alice')));
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `users/alice/meal_plans/${MON}`), plan('alice')); });
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(getDocs(collection(as('alice'), 'users/alice/meal_plans')));
  await assertFails(updateDoc(ref, { source: 'rules', updated_at: '2026-10-19T09:00:00Z' }));
  await assertSucceeds(deleteDoc(ref));
});

test('meal_plans: nobody else and nobody signed out can read, write or delete', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `users/alice/meal_plans/${MON}`), plan('alice')); });
  const ref = (db) => doc(db, `users/alice/meal_plans/${MON}`);
  await assertFails(getDoc(ref(as('bob'))));
  await assertFails(setDoc(ref(as('bob')), plan('alice')));
  await assertFails(updateDoc(ref(as('bob')), { source: 'ai' }));
  await assertFails(deleteDoc(ref(as('bob'))));
  await assertFails(getDocs(collection(as('bob'), 'users/alice/meal_plans')));
  const out = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(ref(out)));
  await assertFails(setDoc(ref(out), plan('alice')));
  await assertFails(deleteDoc(ref(out)));
});
