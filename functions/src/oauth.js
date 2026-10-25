// Connecting Withings (OAuth 2.0 authorization code).
//
// The home-screen app and Safari don't share storage on iPhone, so the callback never relies on a Firebase
// sign-in in the browser: withingsAuthStart (called from the signed-in app) stores a one-time `state` →
// uid, and the callback finds you through it. The app learns "connected" from its Firestore listener on
// users/{uid}/integrations/withings, so nothing has to be handed back to it.
import { randomBytes } from 'node:crypto';
import { P } from './paths.js';
import { tokenFields } from './tokens.js';
import { requestBackfill } from './tasks.js';
import { APPLI_ACTIVITY } from './withings-api.js';
import { hasActivityScope, syncActivitySafe } from './activity.js';
import { log } from './log.js';

export const STATE_TTL_MS = 10 * 60 * 1000;

/** withingsAuthStart: a one-time state for this uid, and the Withings authorize URL. */
export async function startAuth({ db, api, uid, redirectUri, now = () => Date.now() }) {
  if (!uid) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
  const state = randomBytes(32).toString('hex');
  await db.doc(P.state(state)).set({ uid, expires_at: now() + STATE_TTL_MS });
  return { url: api.authorizeUrl({ redirectUri, state }) };
}

/** Use up a state (one time). Returns the uid, or null if missing or expired. */
export async function consumeState(db, state, now) {
  if (!state || !/^[a-f0-9]{64}$/.test(state)) return null;
  const ref = db.doc(P.state(state));
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    tx.delete(ref);
    const d = s.data();
    return d.expires_at > now ? d.uid : null;
  });
}

/**
 * withingsOAuthCallback (GET). Returns { redirect } on success or { status, page } with a short message.
 *   deps: { db, api, enqueue, redirectUri, webhookUrl, appUrl, now, newRunId }
 * The code is exchanged FIRST: Withings authorization codes expire after 30 seconds.
 */
export async function handleCallback(query, deps) {
  const { db, api, enqueue, redirectUri, webhookUrl, appUrl, now = () => Date.now(), newRunId = () => randomBytes(6).toString('hex') } = deps;
  if (query.error) return { status: 400, page: 'denied' };
  const uid = await consumeState(db, String(query.state || ''), now());
  if (!uid) return { status: 400, page: 'expired' };
  if (!query.code) return { status: 400, page: 'denied' };

  let tok;
  try {
    tok = await api.requestToken({ code: String(query.code), redirectUri });
  } catch (e) {
    log('oauth_exchange_failed', { status: typeof e.status === 'number' ? e.status : 0 });
    return { status: 502, page: 'exchange_failed' };
  }
  const withingsUser = String(tok.userid || '');
  if (!withingsUser) return { status: 502, page: 'exchange_failed' };

  // One Withings account ↔ one Forge account.
  const mapRef = db.doc(P.wuser(withingsUser));
  const existing = await mapRef.get();
  if (existing.exists && existing.data().uid !== uid) return { status: 409, page: 'other_account' };

  const t = now();
  const before = await db.doc(P.priv(uid)).get();
  const oldUser = before.exists ? before.data().withings_userid : null;
  if (oldUser && oldUser !== withingsUser) await db.doc(P.wuser(oldUser)).delete(); // reconnected with another Withings account
  await db.doc(P.priv(uid)).set({ ...tokenFields(tok, t), withings_userid: withingsUser, cursor: Math.floor(t / 1000), connected_at: t });
  await mapRef.set({ uid, connected_at: new Date(t).toISOString() });
  await db.doc(P.status(uid)).set({
    connected: true, connected_at: new Date(t).toISOString(), scopes: tok.scope || null, needs_reconnect: false,
    last_error_code: null, subscription_ok: null,
  }, { merge: true });

  // Best effort from here: the device, the notification subscription and the backfill. Each records its
  // own failure on the status doc; daily maintenance retries the subscription and the backfill.
  const token = tok.access_token;
  try {
    const dev = await api.getdevice(token);
    const devices = (dev.devices || []).map((d) => ({ type: d.type || null, model: d.model || null, model_id: d.model_id ?? null, last_session: d.last_session_date ? new Date(d.last_session_date * 1000).toISOString() : null }));
    const scale = devices.find((d) => /scale/i.test(d.type || '')) || devices[0];
    await db.doc(P.status(uid)).set({ devices, model: scale ? scale.model : null }, { merge: true });
  } catch (e) {
    await db.doc(P.status(uid)).set({ last_error_code: `getdevice_${e.status || 'x'}` }, { merge: true });
  }
  try {
    await api.notifySubscribe(token, webhookUrl, 1);
    await db.doc(P.status(uid)).set({ subscription_ok: true }, { merge: true });
  } catch (e) {
    await db.doc(P.status(uid)).set({ subscription_ok: false, last_error_code: `subscribe_${e.status || 'x'}` }, { merge: true });
  }
  // Steps: subscribe to activity notifications and pull the last 7 days. Separate from the weight
  // subscription so a refusal here (no user.activity scope granted) never marks weigh-ins as "Off".
  if (hasActivityScope(tok.scope)) {
    try {
      await api.notifySubscribe(token, webhookUrl, APPLI_ACTIVITY);
      await db.doc(P.status(uid)).set({ activity_subscription_ok: true }, { merge: true });
    } catch {
      await db.doc(P.status(uid)).set({ activity_subscription_ok: false }, { merge: true });
    }
    await syncActivitySafe({ db, api, uid, token, now });
  }
  try {
    await requestBackfill({ db, enqueue, uid, runId: newRunId(), now });
  } catch {
    await db.doc(P.status(uid)).set({ last_error_code: 'backfill_enqueue' }, { merge: true });
  }
  log('connected');
  return { redirect: `${appUrl}withings-connected.html` };
}
