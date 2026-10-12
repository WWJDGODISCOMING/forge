// Two-step sign-in (TOTP authenticator codes) on top of Firebase Auth multi-factor. This file is the logic only: the
// Firebase pieces (multiFactor, TotpMultiFactorGenerator, getMultiFactorResolver) are passed in as `sdk`, so the tests
// drive it with stubs and nothing here touches the network by itself. The setup key is only ever held in memory here and
// handed to Firebase Auth; it is never logged or saved.

export const TOTP_ISSUER = 'Forge';
export const MFA_REQUIRED = 'auth/multi-factor-auth-required';

/** Setup key in groups of 4 (easier to read and type). */
export const groupKey = (k) => String(k || '').replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');

/** The otpauth:// link authenticator apps and Apple Passwords understand. */
export function otpauthUri(secretKey, email, issuer = TOTP_ISSUER, { algorithm = 'SHA1', digits = 6, period = 30 } = {}) {
  const key = String(secretKey || '').replace(/\s+/g, '');
  const i = encodeURIComponent(issuer);
  return 'otpauth://totp/' + i + ':' + encodeURIComponent(email || '') + '?secret=' + encodeURIComponent(key) + '&issuer=' + i + '&algorithm=' + encodeURIComponent(algorithm) + '&digits=' + digits + '&period=' + period;
}

/** 6 digits only; pasted "123 456" works. */
export const cleanCode = (v) => String(v || '').replace(/\D/g, '').slice(0, 6);

/**
 * Submit once when the 6th digit arrives (typed, pasted or autofilled). The same code is never sent twice: it takes a change
 * to the box (or reset(), after a failed try clears it) before it can fire again, so nothing can loop.
 */
export function autoSubmitOnce(submit) {
  let sent = null;
  return {
    check(value) {
      const c = cleanCode(value);
      if (c.length < 6) { sent = null; return false; }
      if (c === sent) return false;
      sent = c;
      submit(c);
      return true;
    },
    reset() { sent = null; },
  };
}

export const isMfaRequired = (err) => !!err && err.code === MFA_REQUIRED;

const NOT_ENABLED = ['auth/operation-not-allowed', 'auth/unsupported-first-factor', 'auth/unsupported-tenant-operation'];
/** True when the Firebase project hasn't had TOTP switched on (SETUP.md, "Two-step sign-in: one-time switch"). */
export function isNotEnabled(err) {
  if (!err) return false;
  if (NOT_ENABLED.includes(err.code)) return true;
  const m = String(err.message || '');
  return /totp/i.test(m) && /not (enabled|allowed)|disabled/i.test(m);
}

export const NOT_ENABLED_TEXT = 'Two‑step sign‑in isn’t switched on for Forge yet (one‑time setup, SETUP.md 7b).';

/** Plain-English text for anything that can go wrong with a code. */
export function mfaErrorMessage(err) {
  if (isNotEnabled(err)) return NOT_ENABLED_TEXT;
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-verification-code': 'That code didn’t work. Check it’s the Forge code and try again.',
    'auth/code-expired': 'That code ran out. Wait for a new one and try again.',
    'auth/missing-verification-code': 'Enter the 6‑digit code.',
    'auth/invalid-multi-factor-session': 'That took too long. Close this and sign in again.',
    'auth/requires-recent-login': 'For safety, enter your password again.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No connection. Try again when you have signal.',
    'auth/second-factor-already-in-use': 'Two‑step sign‑in is already on.',
    'auth/invalid-credential': 'That password is wrong.',
    'auth/wrong-password': 'That password is wrong.',
  };
  return map[code] || 'Something went wrong. Try again.';
}

const totpFactors = (sdk, user) => (sdk.multiFactor(user).enrolledFactors || []).filter((f) => f.factorId === 'totp');

/** { on, factors } for the signed-in user. */
export function mfaStatus(sdk, user) {
  const factors = user ? totpFactors(sdk, user) : [];
  return { on: factors.length > 0, factors };
}

/** Step 1 of turning it on. Throws auth/requires-recent-login (ask for the password, then retry) or a not-enabled error. */
export async function startEnroll(sdk, user) {
  const session = await sdk.multiFactor(user).getSession();
  const secret = await sdk.TotpMultiFactorGenerator.generateSecret(session);
  const uri = otpauthUri(secret.secretKey, user.email, TOTP_ISSUER, {
    algorithm: secret.hashingAlgorithm || 'SHA1', digits: secret.codeLength || 6, period: secret.codeIntervalSeconds || 30,
  });
  return { secret, key: secret.secretKey, uri };
}

/** Step 2: the 6-digit code from the authenticator finishes it. */
export async function finishEnroll(sdk, user, secret, code, name = 'Authenticator app') {
  const c = cleanCode(code);
  if (c.length !== 6) { const e = new Error('short'); e.code = 'auth/missing-verification-code'; throw e; }
  const assertion = sdk.TotpMultiFactorGenerator.assertionForEnrollment(secret, c);
  await sdk.multiFactor(user).enroll(assertion, name);
}

/** Turn it off (after reauthentication): removes every authenticator on the account. */
export async function unenrollAll(sdk, user) {
  for (const f of totpFactors(sdk, user)) await sdk.multiFactor(user).unenroll(f);
}

/** Sign-in or reauth threw auth/multi-factor-auth-required: get what the code sheet needs. */
export function startSignIn(sdk, auth, err) {
  const resolver = sdk.getMultiFactorResolver(auth, err);
  const hint = (resolver.hints || []).find((h) => h.factorId === 'totp');
  if (!hint) { const e = new Error('no totp'); e.code = 'auth/unsupported-first-factor'; throw e; }
  return { resolver, hint };
}

/** The sheet calls this on each try. A wrong code throws and the same resolver can be tried again (no lockout loop on our side). */
export function finishSignIn(sdk, { resolver, hint }, code) {
  const c = cleanCode(code);
  if (c.length !== 6) { const e = new Error('short'); e.code = 'auth/missing-verification-code'; return Promise.reject(e); }
  return resolver.resolveSignIn(sdk.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, c));
}
