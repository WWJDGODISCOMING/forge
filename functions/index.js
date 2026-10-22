// Forge Cloud Functions (2nd gen, Node 22, us-east1). Thin wiring only: the logic lives in src/ and is
// unit-tested with no network (test/). Every function is capped at 2 instances so a bug or abuse can't
// scale costs.
//
// Secrets (set once in your own Terminal, never in the repo or the app):
//   firebase functions:secrets:set WITHINGS_CLIENT_SECRET
//   firebase functions:secrets:set WITHINGS_WEBHOOK_KEY
//   firebase functions:secrets:set USDA_API_KEY   (food search; a free api.data.gov key)
//   firebase functions:secrets:set XAI_API_KEY    (Snap a meal and the optional meal-plan AI; already set)
// Plain config (asked for at deploy, saved in functions/.env.<project>): WITHINGS_CLIENT_ID.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret, defineString } from 'firebase-functions/params';

import { makeClient, WithingsError } from './src/withings-api.js';
import { startAuth, handleCallback } from './src/oauth.js';
import { handleWebhook } from './src/webhook.js';
import { runTask, reimport } from './src/tasks.js';
import { randomBytes } from 'node:crypto';
import { withToken, NotConnected, NeedsReconnect } from './src/tokens.js';
import { incrementalSync } from './src/sync.js';
import { runDataCheck, saveReport } from './src/datacheck.js';
import { maintainAll, disconnect } from './src/maintenance.js';
import { resultPage } from './src/pages.js';
import { P } from './src/paths.js';
import { handleIngest, importDays, createToken, revokeToken, deleteAppleData, BadPayload, MAX_BODY_BYTES } from './src/health.js';
import { log } from './src/log.js';
import { searchFoods, FoodSearchError } from './src/usda.js';
import { lookupOff } from './src/offood.js';
import { snapMeal, SnapError } from './src/snap.js';
import { personalizeMealPlan as buildAiMealPlan, MealAiError } from './src/mealai.js';
import { askForge as runAskForge, AskForgeError } from './src/askforge.js';

initializeApp();
const REGION = 'us-east1';
setGlobalOptions({ region: REGION, maxInstances: 2, memory: '256MiB' });

const CLIENT_SECRET = defineSecret('WITHINGS_CLIENT_SECRET');
const WEBHOOK_KEY = defineSecret('WITHINGS_WEBHOOK_KEY');
const USDA_KEY = defineSecret('USDA_API_KEY');
const XAI_KEY = defineSecret('XAI_API_KEY');
const CLIENT_ID = defineString('WITHINGS_CLIENT_ID', { description: 'Client ID of your Withings developer app (not secret)' });
const APP_URL = defineString('FORGE_APP_URL', { default: 'https://wwjdgodiscoming.github.io/forge/' });

const project = () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const base = () => `https://${REGION}-${project()}.cloudfunctions.net`;
const redirectUri = () => `${base()}/withingsOAuthCallback`;
const webhookKey = () => WEBHOOK_KEY.value().trim(); // a pasted trailing space must not break every notification
const webhookUrl = () => `${base()}/withingsWebhook?k=${webhookKey()}`;

const db = () => getFirestore();
const api = () => makeClient({ fetch: globalThis.fetch, clientId: CLIENT_ID.value(), clientSecret: CLIENT_SECRET.value() });
const enqueue = (data, opts) => getFunctions().taskQueue(`locations/${REGION}/functions/withingsTask`).enqueue(data, opts);

/** Errors the app can show as they are (everything else becomes a generic message). */
async function friendly(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e instanceof NotConnected) throw new HttpsError('failed-precondition', 'Withings isn’t connected.');
    if (e instanceof NeedsReconnect) throw new HttpsError('failed-precondition', 'Withings needs you to connect again (Settings → Withings).');
    if (e && e.code === 'failed-precondition') throw new HttpsError('failed-precondition', 'Run the check first, then save it.');
    if (e instanceof WithingsError && e.invalidToken) throw new HttpsError('failed-precondition', 'Withings needs you to connect again (Settings → Withings).');
    if (e instanceof WithingsError && e.transient) throw new HttpsError('unavailable', 'Withings is busy. Try again in a few minutes.');
    throw new HttpsError('internal', 'Something went wrong on Forge’s server.');
  }
}

const needUid = (req) => {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth.uid;
};

// ---------- connect ----------
export const withingsAuthStart = onCall({ secrets: [] }, async (req) => {
  const uid = needUid(req);
  return friendly(() => startAuth({ db: db(), api: makeClient({ fetch: globalThis.fetch, clientId: CLIENT_ID.value() }), uid, redirectUri: redirectUri() }));
});

export const withingsOAuthCallback = onRequest({ secrets: [CLIENT_SECRET, WEBHOOK_KEY], invoker: 'public', timeoutSeconds: 30 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method === 'HEAD') { res.status(200).end(); return; } // Withings checks the URL when you save it
  if (req.method !== 'GET') { res.status(405).end(); return; }
  const r = await handleCallback(req.query || {}, { db: db(), api: api(), enqueue, redirectUri: redirectUri(), webhookUrl: webhookUrl(), appUrl: APP_URL.value() });
  if (r.redirect) { res.redirect(302, r.redirect); return; }
  res.status(r.status).type('html').send(resultPage(r.page, APP_URL.value()));
});

// ---------- notifications ----------
export const withingsWebhook = onRequest({ secrets: [WEBHOOK_KEY], invoker: 'public', timeoutSeconds: 10 }, async (req, res) => {
  const r = await handleWebhook({ method: req.method, query: req.query, body: req.body }, { db: db(), enqueue, key: webhookKey() });
  res.status(r.status).type('text').send(r.text);
});

// ---------- the worker: syncs and backfill pages ----------
export const withingsTask = onTaskDispatched({
  secrets: [CLIENT_SECRET],
  timeoutSeconds: 300,
  retryConfig: { maxAttempts: 5, minBackoffSeconds: 60, maxBackoffSeconds: 3600 },
  rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 1 },
}, async (req) => {
  await runTask(req.data, { db: db(), api: api(), enqueue });
});

// ---------- buttons in the app ----------
export const withingsSyncNow = onCall({ secrets: [CLIENT_SECRET], timeoutSeconds: 120 }, async (req) => {
  const uid = needUid(req);
  const ref = db().doc(P.status(uid));
  const wait = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const last = s.exists && s.data().last_manual_sync_at ? Date.parse(s.data().last_manual_sync_at) : 0;
    const left = last + 10 * 60 * 1000 - Date.now(); // Withings asks apps not to poll: at most every 10 min
    if (left > 0) return Math.ceil(left / 60000);
    tx.set(ref, { last_manual_sync_at: new Date().toISOString() }, { merge: true });
    return 0;
  });
  if (wait) throw new HttpsError('resource-exhausted', `Withings asks apps not to sync more often. Try again in ${wait} min.`);
  return friendly(async () => {
    try {
      // withToken: a refused token gets one forced refresh, then needs_reconnect (so the banner shows).
      const r = await withToken({ db: db(), api: api(), uid }, (token) => incrementalSync({ db: db(), api: api(), uid, token, reason: 'manual' }));
      return { created: r.created, updated: r.updated };
    } catch (e) {
      await ref.set({ last_manual_sync_at: null }, { merge: true }).catch(() => {}); // a failed sync doesn't use up the 10 minutes
      throw e;
    }
  });
});

export const withingsReimport = onCall({ secrets: [] }, async (req) => {
  const uid = needUid(req);
  return friendly(async () => {
    const r = await reimport({ db: db(), enqueue, uid, runId: randomBytes(6).toString('hex') });
    if (!r.started && r.reason === 'running') throw new HttpsError('failed-precondition', 'A history import is already running. Give it a few minutes.');
    if (!r.started) throw new HttpsError('failed-precondition', 'Withings isn’t connected.');
    return r;
  });
});

export const withingsDataCheck = onCall({ secrets: [CLIENT_SECRET, WEBHOOK_KEY], timeoutSeconds: 300 }, async (req) => {
  const uid = needUid(req);
  const data = req.data || {};
  if (data.action === 'save') return friendly(() => saveReport({ db: db(), uid, label: data.label }));
  return friendly(() => withToken({ db: db(), api: api(), uid }, (token) => runDataCheck({ db: db(), api: api(), uid, token, webhookUrl: webhookUrl() })));
});

export const withingsDisconnect = onCall({ secrets: [CLIENT_SECRET, WEBHOOK_KEY], timeoutSeconds: 300 }, async (req) => {
  const uid = needUid(req);
  return friendly(() => disconnect({ db: db(), api: api(), uid, webhookUrl: webhookUrl(), deleteData: !!(req.data && req.data.deleteData), deleteApple: !!(req.data && req.data.deleteApple) }));
});

// ---------- daily upkeep (1 Cloud Scheduler job) ----------
export const withingsMaintenance = onSchedule({ schedule: '0 4 * * *', timeZone: 'America/New_York', secrets: [CLIENT_SECRET, WEBHOOK_KEY], timeoutSeconds: 540, retryCount: 1 }, async () => {
  await maintainAll({ db: db(), api: api(), enqueue, webhookUrl: webhookUrl() });
});

// ---------- Apple Health (Shortcut bridge + export import). No secrets: tokens are per user and hashed ----------
export const healthIngest = onRequest({ invoker: 'public', timeoutSeconds: 30, concurrency: 10 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const declared = Number(req.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) { // refused before any work (the platform's own body limit still applies)
    res.status(413).json({ error: 'too_large' });
    return;
  }
  const bodyBytes = Math.max(declared, req.rawBody ? req.rawBody.length : 0);
  let body = req.body;
  if (bodyBytes <= MAX_BODY_BYTES && (typeof body === 'string' || Buffer.isBuffer(body))) {
    try { body = JSON.parse(String(body)); } catch { body = null; }
  }
  try {
    const r = await handleIngest({ method: req.method, headers: req.headers, bodyBytes, body }, { db: db() });
    res.status(r.status).json(r.body);
  } catch {
    log('ingest', { status: 500 });
    res.status(500).json({ error: 'server_error' }); // never echo the cause: it could mention a value
  }
});

export const createShortcutToken = onCall({ secrets: [] }, async (req) => {
  const uid = needUid(req);
  return friendly(() => createToken({ db: db(), uid }));
});

export const revokeShortcutToken = onCall({ secrets: [] }, async (req) => {
  const uid = needUid(req);
  return friendly(() => revokeToken({ db: db(), uid }));
});

export const deleteAppleHealthData = onCall({ secrets: [] }, async (req) => {
  const uid = needUid(req);
  return friendly(() => deleteAppleData({ db: db(), uid }));
});

// The app parses an Apple Health export on the phone and sends only daily summaries (never the zip).
export const importHealthDays = onCall({ secrets: [], timeoutSeconds: 60 }, async (req) => {
  const uid = needUid(req);
  return friendly(async () => {
    try {
      return await importDays({ db: db(), uid, data: req.data });
    } catch (e) {
      if (e instanceof BadPayload) throw new HttpsError('invalid-argument', 'Forge couldn’t read some of that Health data.');
      throw e;
    }
  });
});

// ---------- Food search (USDA FoodData Central). The key never leaves the server; neither it nor the query is logged ----------
export const foodSearch = onCall({ secrets: [USDA_KEY], timeoutSeconds: 20 }, async (req) => {
  const uid = needUid(req);
  try {
    return await searchFoods({ db: db(), uid, data: req.data, apiKey: USDA_KEY.value().trim(), fetch: globalThis.fetch });
  } catch (e) {
    if (e instanceof FoodSearchError) {
      if (e.code === 'invalid') throw new HttpsError('invalid-argument', 'Type at least 2 letters (up to 60).');
      if (e.code === 'limited') throw new HttpsError('resource-exhausted', 'That’s a lot of searches. Try again in a little while.');
      if (e.code === 'busy') throw new HttpsError('unavailable', 'Food search is busy. Try again in a minute.');
      throw new HttpsError('unavailable', 'Food search isn’t available right now.');
    }
    throw new HttpsError('internal', 'Something went wrong on Forge’s server.');
  }
});

// ---------- Open Food Facts (barcode and brand search). Free, no key; neither the barcode nor the query is logged ----------
export const foodBarcode = onCall({ timeoutSeconds: 20 }, async (req) => {
  const uid = needUid(req);
  try {
    return await lookupOff({ db: db(), uid, data: req.data, fetch: globalThis.fetch });
  } catch (e) {
    if (e instanceof FoodSearchError) {
      if (e.code === 'invalid') throw new HttpsError('invalid-argument', 'That barcode or search couldn’t be read.');
      if (e.code === 'limited') throw new HttpsError('resource-exhausted', 'That’s a lot of searches. Try again in a little while.');
      if (e.code === 'busy') throw new HttpsError('unavailable', 'Product lookup is busy. Try again in a minute.');
      throw new HttpsError('unavailable', 'Product lookup isn’t available right now.');
    }
    throw new HttpsError('internal', 'Something went wrong on Forge’s server.');
  }
});

// ---------- Snap a meal (xAI vision). The photo is read from the request, sent to xAI and dropped: never stored or logged ----------
export const snapMealPhoto = onCall({ secrets: [XAI_KEY], timeoutSeconds: 60, memory: '512MiB' }, async (req) => {
  const uid = needUid(req);
  try {
    return await snapMeal({ db: db(), uid, data: req.data, apiKey: XAI_KEY.value().trim(), fetch: globalThis.fetch });
  } catch (e) {
    if (e instanceof SnapError) {
      const details = e.upstream ? { upstream: e.upstream } : undefined; // short, key-free; shown in the app's grey bracket
      if (e.code === 'invalid') throw new HttpsError('invalid-argument', 'That photo couldn’t be read. Try another one.');
      if (e.code === 'toolarge') throw new HttpsError('invalid-argument', 'That photo is too big. Try another one.');
      if (e.code === 'limited') throw new HttpsError('resource-exhausted', 'That’s a lot of photos for now. Try again in a little while, or search for the food.');
      if (e.code === 'busy') throw new HttpsError('unavailable', 'Photo estimates are busy. Try again in a minute.', details);
      if (e.code === 'nofood') throw new HttpsError('failed-precondition', 'I couldn’t spot any food in that photo. Try again closer, or search for it.');
      if (e.code === 'garbled') throw new HttpsError('unavailable', 'That estimate got cut off. Try again.');
      throw new HttpsError('unavailable', 'Photo estimates aren’t available right now.', details);
    }
    throw new HttpsError('internal', 'Something went wrong on Forge’s server.');
  }
});

// ---------- Meal plan AI (xAI text). Preferences go to xAI and are dropped; every meal is checked here before it is returned or saved ----------
export const personalizeMealPlan = onCall({ secrets: [XAI_KEY], timeoutSeconds: 90, memory: '512MiB' }, async (req) => {
  const uid = needUid(req);
  try {
    return await buildAiMealPlan({ db: db(), uid, data: req.data, apiKey: XAI_KEY.value().trim(), fetch: globalThis.fetch });
  } catch (e) {
    if (e instanceof MealAiError) {
      if (e.code === 'invalid') throw new HttpsError('invalid-argument', 'Those food preferences couldn’t be read. Check them and try again.');
      if (e.code === 'limited') throw new HttpsError('resource-exhausted', 'That’s enough AI plans for now. Try again later, or use the standard plan.');
      if (e.code === 'busy') throw new HttpsError('unavailable', 'The AI is busy. Try again in a minute, or use the standard plan.');
      if (e.code === 'garbled') throw new HttpsError('unavailable', 'The AI plan didn’t come out right. Try again, or use the standard plan.');
      throw new HttpsError('unavailable', 'AI meal plans aren’t available right now. The standard plan still works.');
    }
    throw new HttpsError('internal', 'Something went wrong on Forge’s server.');
  }
});

// ---------- Ask Forge (xAI text): "Can I eat this?" The question and today's numbers go to xAI and are dropped; the rules double-check the verdict ----------
export const askForge = onCall({ secrets: [XAI_KEY], timeoutSeconds: 40, memory: '256MiB' }, async (req) => {
  const uid = needUid(req);
  try {
    return await runAskForge({ db: db(), uid, data: req.data, apiKey: XAI_KEY.value().trim(), fetch: globalThis.fetch });
  } catch (e) {
    if (e instanceof AskForgeError) {
      if (e.code === 'invalid') throw new HttpsError('invalid-argument', 'That question couldn’t be read. Try asking it another way.');
      if (e.code === 'limited') throw new HttpsError('resource-exhausted', 'That’s a lot of questions for now. Forge will answer from your numbers instead.');
      if (e.code === 'busy') throw new HttpsError('unavailable', 'The AI is busy. Forge will answer from your numbers instead.');
      if (e.code === 'garbled') throw new HttpsError('unavailable', 'The AI answer didn’t come out right. Forge will answer from your numbers instead.');
      throw new HttpsError('unavailable', 'The AI isn’t available right now. Forge will answer from your numbers instead.');
    }
    throw new HttpsError('internal', 'Something went wrong on Forge’s server.');
  }
});
