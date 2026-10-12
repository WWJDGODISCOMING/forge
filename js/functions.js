// Calling Forge's Cloud Functions (us-east1) from the app. The Functions SDK loads only when a Withings
// screen needs it, so the app shell stays as light as before. The CSP allows exactly one extra origin:
// https://us-east1-forge-web-f2351.cloudfunctions.net (index.html → connect-src).
import { app } from './firebase.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
let fns = null;

async function functions() {
  if (!fns) {
    const { getFunctions, httpsCallable } = await import(SDK);
    const f = getFunctions(app, 'us-east1');
    fns = { f, httpsCallable };
  }
  return fns;
}

/** Call a callable function; resolves to its data, rejects with a friendly message. */
export async function call(name, data = {}, { timeout = 70000 } = {}) {
  if (!navigator.onLine) throw new Error('You’re offline. Try again when you have a connection.');
  const { f, httpsCallable } = await functions();
  try {
    const res = await httpsCallable(f, name, { timeout })(data);
    return res.data;
  } catch (e) {
    throw Object.assign(new Error(friendly(e)), { code: String((e && e.code) || '').replace('functions/', '') });
  }
}

export function friendly(e) {
  const code = String((e && e.code) || '').replace('functions/', '');
  const msg = (e && e.message) || '';
  // Messages Forge's server wrote for you pass straight through.
  if (['failed-precondition', 'unavailable', 'resource-exhausted', 'invalid-argument'].includes(code) && msg && msg !== code) return msg;
  if (code === 'unauthenticated') return 'Sign in again, then try once more.';
  if (code === 'not-found' || (code === 'internal' && (msg === 'internal' || !msg))) {
    // No answer at all (the browser blocks it): usually the functions aren't deployed yet.
    return 'Couldn’t reach Forge’s server functions. If you just updated, deploy them (docs/withings.md, step 10).';
  }
  if (code === 'deadline-exceeded') return 'That took too long. Check your connection and try again.';
  return msg && code === 'internal' ? msg : 'Something went wrong. Try again in a minute.';
}
