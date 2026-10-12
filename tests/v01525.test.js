// v0.15.25: two-step sign-in (TOTP) with a mocked Firebase Auth SDK, plus the lock carry-overs and wiring checks.
import { readFileSync } from 'node:fs';
import { test, eq, assert } from './harness.js';
import {
  groupKey, otpauthUri, cleanCode, isMfaRequired, isNotEnabled, mfaErrorMessage, mfaStatus,
  startEnroll, finishEnroll, unenrollAll, startSignIn, finishSignIn, NOT_ENABLED_TEXT, autoSubmitOnce,
} from '../js/mfa.js';
import { createLock } from '../js/native/lock.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const fail = (code) => Object.assign(new Error(code), { code });
const rejects = async (p) => { try { await p; } catch (e) { return e; } return null; };

/** A fake Firebase Auth multi-factor SDK. `calls` records what was asked of it. */
function fakeSdk({ factors = [], enrollError = null, goodCode = '123456', secretError = null } = {}) {
  const calls = [];
  const list = [...factors];
  const sdk = {
    calls, list,
    multiFactor: () => ({
      get enrolledFactors() { return list; },
      getSession: async () => ({ session: 1 }),
      enroll: async (assertion, name) => {
        calls.push(['enroll', assertion, name]);
        if (enrollError) throw enrollError;
        if (assertion.code !== goodCode) throw fail('auth/invalid-verification-code');
        list.push({ factorId: 'totp', uid: 'f1', displayName: name });
      },
      unenroll: async (f) => { calls.push(['unenroll', f.uid]); list.splice(list.indexOf(f), 1); },
    }),
    TotpMultiFactorGenerator: {
      generateSecret: async () => { if (secretError) throw secretError; return { secretKey: 'JBSWY3DPEHPK3PXP' }; },
      assertionForEnrollment: (secret, code) => ({ kind: 'enroll', secret, code }),
      assertionForSignIn: (uid, code) => ({ kind: 'signin', uid, code }),
    },
    getMultiFactorResolver: (auth, err) => ({
      hints: err.hints || [{ factorId: 'totp', uid: 'f1' }],
      resolveSignIn: async (a) => { calls.push(['resolve', a]); if (a.code !== goodCode) throw fail('auth/invalid-verification-code'); return { user: { uid: 'u1' } }; },
    }),
  };
  return sdk;
}
const user = { uid: 'u1', email: 'test@example.com' };

test('setup key is grouped in 4s and the otpauth link names Forge and the email', () => {
  eq(groupKey('JBSWY3DPEHPK3PXP'), 'JBSW Y3DP EHPK 3PXP');
  eq(groupKey('abcde'), 'abcd e');
  eq(groupKey(''), '');
  const u = otpauthUri('JBSW Y3DP', 'a+b@example.com');
  assert(u.startsWith('otpauth://totp/Forge:a%2Bb%40example.com?'), u);
  assert(u.includes('secret=JBSWY3DP') && u.includes('issuer=Forge') && u.includes('digits=6') && u.includes('period=30'), u);
});

test('codes keep only 6 digits (pasted spaces and dashes are fine)', () => {
  eq(cleanCode('123 456'), '123456');
  eq(cleanCode('12-34-56-78'), '123456');
  eq(cleanCode(null), '');
});

test('enroll: secret, uri, then the code finishes it and the status turns On', async () => {
  const sdk = fakeSdk();
  eq(mfaStatus(sdk, user).on, false);
  const setup = await startEnroll(sdk, user);
  eq(setup.key, 'JBSWY3DPEHPK3PXP');
  assert(setup.uri.includes('Forge:test%40example.com') && setup.uri.includes('secret=JBSWY3DPEHPK3PXP'), setup.uri);
  await finishEnroll(sdk, user, setup.secret, '123 456');
  eq(mfaStatus(sdk, user).on, true);
  eq(sdk.calls[0][2], 'Authenticator app');
});

test('enroll: a wrong code is refused with plain words and nothing is turned on; a short code never reaches Firebase', async () => {
  const sdk = fakeSdk();
  const setup = await startEnroll(sdk, user);
  const e = await rejects(finishEnroll(sdk, user, setup.secret, '000000'));
  eq(e.code, 'auth/invalid-verification-code');
  assert(/didn’t work/.test(mfaErrorMessage(e)), mfaErrorMessage(e));
  eq(mfaStatus(sdk, user).on, false);
  const s = await rejects(finishEnroll(sdk, user, setup.secret, '12 3'));
  eq(s.code, 'auth/missing-verification-code');
  eq(sdk.calls.length, 1); // only the wrong code was sent
});

test('enroll: a recent-login error passes through so the screen can ask for the password, then retry', async () => {
  const sdk = fakeSdk({ secretError: fail('auth/requires-recent-login') });
  const e = await rejects(startEnroll(sdk, user));
  eq(e.code, 'auth/requires-recent-login');
  assert(/password again/.test(mfaErrorMessage(e)));
});

test('sign-in: the resolver path signs in with the right code, and a wrong code can simply be tried again', async () => {
  const sdk = fakeSdk({ factors: [{ factorId: 'totp', uid: 'f1' }] });
  const err = fail('auth/multi-factor-auth-required');
  eq(isMfaRequired(err), true);
  eq(isMfaRequired(fail('auth/wrong-password')), false);
  const ctx = startSignIn(sdk, {}, err);
  eq(ctx.hint.uid, 'f1');
  const bad = await rejects(finishSignIn(sdk, ctx, '654321'));
  eq(bad.code, 'auth/invalid-verification-code');
  assert(/Check it’s the Forge code/.test(mfaErrorMessage(bad)));
  const ok = await finishSignIn(sdk, ctx, '123 456'); // same resolver, no lockout on our side
  eq(ok.user.uid, 'u1');
  eq(sdk.calls.filter((c) => c[0] === 'resolve').length, 2);
  eq(sdk.calls[1][1].uid, 'f1');
});

test('sign-in: an expired code and an old session read plainly; an empty code is not sent', async () => {
  assert(/ran out/.test(mfaErrorMessage(fail('auth/code-expired'))));
  assert(/sign in again/.test(mfaErrorMessage(fail('auth/invalid-multi-factor-session'))));
  const sdk = fakeSdk();
  const ctx = startSignIn(sdk, {}, fail('auth/multi-factor-auth-required'));
  const e = await rejects(finishSignIn(sdk, ctx, ''));
  eq(e.code, 'auth/missing-verification-code');
  eq(sdk.calls.length, 0);
});

test('sign-in: an account whose only second step is not an authenticator app says so instead of crashing', () => {
  const sdk = fakeSdk();
  let e = null;
  try { startSignIn(sdk, {}, Object.assign(fail('auth/multi-factor-auth-required'), { hints: [{ factorId: 'phone', uid: 'p1' }] })); } catch (x) { e = x; }
  assert(e && isNotEnabled(e), 'should surface as a plain "needs a switch" message, not a raw error');
});

test('turn off: removes the authenticator, status goes Off', async () => {
  const sdk = fakeSdk({ factors: [{ factorId: 'totp', uid: 'f1' }] });
  eq(mfaStatus(sdk, user).on, true);
  await unenrollAll(sdk, user);
  eq(mfaStatus(sdk, user).on, false);
  eq(sdk.calls[0][1], 'f1');
  await unenrollAll(sdk, user); // already off: harmless
});

test('turn off: needing a recent sign-in is reported so the screen can ask for the password', async () => {
  const sdk = fakeSdk({ factors: [{ factorId: 'totp', uid: 'f1' }] });
  sdk.multiFactor = () => ({ enrolledFactors: sdk.list, unenroll: async () => { throw fail('auth/requires-recent-login'); } });
  eq((await rejects(unenrollAll(sdk, user))).code, 'auth/requires-recent-login');
});

test('not switched on yet: Firebase errors become the one-time-switch message, never a raw error', async () => {
  for (const code of ['auth/operation-not-allowed', 'auth/unsupported-first-factor']) {
    const sdk = fakeSdk({ secretError: fail(code) });
    const e = await rejects(startEnroll(sdk, user));
    eq(isNotEnabled(e), true);
    eq(mfaErrorMessage(e), NOT_ENABLED_TEXT);
  }
  assert(/isn’t switched on for Forge yet/.test(NOT_ENABLED_TEXT) && /7b/.test(NOT_ENABLED_TEXT));
  eq(isNotEnabled(new Error('TOTP MFA is not enabled for this project')), true);
  eq(isNotEnabled(fail('auth/network-request-failed')), false);
  eq(mfaErrorMessage(new Error('internal stack trace words')), 'Something went wrong. Try again.');
});

test('wiring: sign-in handles the resolver, delete reauth copes with codes, the row sits in Privacy & security, offline shell has the files', () => {
  assert(/MFA_REQUIRED/.test(src('js/screens/auth.js')) && /promptSignInCode/.test(src('js/screens/auth.js')));
  assert(/reauthWithMfa/.test(src('js/screens/settings.js')) && /mfaSettingsHtml\(\)/.test(src('js/screens/settings.js')));
  const ui = src('js/mfa-ui.js');
  assert(/inputmode="numeric" autocomplete="one-time-code"/.test(ui), 'code box attributes');
  assert(/Add to Passwords/.test(ui) && /data-passwords/.test(ui));
  assert(!/console\.|localStorage|sessionStorage|fetch\(/.test(ui + src('js/mfa.js')), 'the setup key is never logged, saved or sent');
  const sw = src('sw.js');
  for (const f of ['css/mfa.css', 'js/mfa.js', 'js/mfa-ui.js', 'js/mfa-sdk.js', 'js/vendor/qrcode/qrcode.js']) assert(sw.includes(`'./${f}'`), `${f} in SHELL`);
  assert(/MIT/.test(src('js/vendor/qrcode/qrcode.js')) && /MIT/.test(src('docs/licenses/qrcode-generator-MIT.txt')));
  assert(!/https?:\/\/(?!www\.opensource\.org|www\.d-project|www\.denso|github\.com)/.test(src('js/vendor/qrcode/qrcode.js').replace(/\/\/.*$/gm, '')), 'the QR generator makes no network calls');
});

test('lock carry-overs: the lock dialog comes back on close while locked, and focus returns after unlock', () => {
  const lock = src('js/native/lock.js');
  assert(/addEventListener\('close'/.test(lock) && /app-locked'\) && !dlg\.open/.test(lock) && /dlg\.showModal\(\)/.test(lock), 'close handler re-shows the lock');
  assert(/prevFocus/.test(lock) && /f\.focus\(/.test(lock), 'focus is remembered and given back');
});

test('SETUP.md has the one-time command; CHANGELOG has the 0.15.24 wording fix and a 0.15.25 What is new', () => {
  const setup = src('SETUP.md');
  assert(/forge-web-f2351/.test(setup) && /adjacentIntervals":5/.test(setup) && /totpProviderConfig/.test(setup) && /gcloud auth print-access-token/.test(setup));
  const log = src('CHANGELOG.md');
  assert(/end closer together on Duo landscape/.test(log) && !/within about 40 px/.test(log));
  assert(/## 0\.15\.25/.test(log));
});

test('auto-submit: the 6th digit submits once; the same code never re-sends until the box changes', () => {
  const sent = [];
  const a = autoSubmitOnce((c) => sent.push(c));
  eq(a.check('12'), false);
  eq(a.check('123 45'), false);
  eq(a.check('123 456'), true);
  eq(a.check('123 456'), false); // same input event again: no loop
  eq(a.check('123456'), false);
  eq(sent.join(','), '123456');
  a.check('123 45'); // edited down, then back up: allowed again
  eq(a.check('123 456'), true);
  a.reset(); // a failed try clears the box
  eq(a.check('654 321'), true);
  eq(a.check('Your code is 987654 ok'), true); // pasted text is cleaned first
  eq(sent.join(','), '123456,123456,654321,987654');
});

test('code boxes use a neutral placeholder, no maxlength, and non-breaking hyphens in the two-step copy', () => {
  const ui = src('js/mfa-ui.js');
  assert(!/placeholder="[^"]*\d/.test(ui), 'placeholder has no digits');
  assert(!/maxlength/.test(ui));
  assert(/autoSubmitOnce/.test(ui) && /dimUntilFull: true/.test(ui), 'both sheets auto-submit; Turn on is dim until 6 digits');
  const copy = (ui + src('js/mfa.js')).replace(/^\s*\/\/.*$|\s\/\/ .*$|\/\*[^]*?\*\//gm, '').replace(/one-time-code|otpauth/g, '');
  assert(!/(two|sign|6)-(step|in|digit)/i.test(copy), 'two-step, sign-in, 6-digit use U+2011');
  assert(/key:/.test(src('js/ui/icons.js')));
});

test('lock: a pass for Passwords is honoured once on the way back; any other trip still locks', async () => {
  const mk = () => {
    let t = 1000;
    const log = [];
    const st = { v: JSON.stringify({ enabled: true, timeout: 0, asked: true }), getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
    const asked = [];
    const lock = createLock({
      device: { available: async () => true, verify: async (r) => { asked.push(r); return 'ok'; } },
      view: { show: (m) => log.push(m), hide: () => log.push('hide'), error() {} }, store: st, session: null, now: () => t,
    });
    return { lock, asked, tick: (ms) => { t += ms; } };
  };
  const r = mk();
  await r.lock.enable();
  const before = r.asked.length;
  r.lock.passFor(120000);
  r.lock.inactive(); r.lock.away(); r.tick(30000); r.lock.back();
  eq(r.lock.state, 'unlocked');
  eq(r.asked.length, before); // no second Face ID
  r.lock.away(); r.tick(1000); r.lock.back(); // the pass was used up
  await Promise.resolve();
  eq(r.asked.length, before + 1);
  const x = mk(); await x.lock.enable(); x.lock.passFor(120000);
  const xb = x.asked.length;
  x.lock.away(); x.tick(121000); x.lock.back(); // came back too late
  assert(x.lock.state !== 'unlocked', 'an expired pass does not unlock');
  await Promise.resolve();
  eq(x.asked.length, xb + 1); // an expired pass still locks and asks once
  const y = mk(); await y.lock.enable(); y.lock.away(); y.tick(1000); y.lock.back(); // no pass at all
  await Promise.resolve();
  assert(y.asked.length >= 2, 'without a pass it locks as before');
});
