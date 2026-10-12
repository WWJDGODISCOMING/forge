// Two-step sign-in screens: the code sheet at sign-in, the password sheet, turning it on (Add to Passwords, QR, setup key,
// 6-digit code) and turning it off. The logic and the error text live in js/mfa.js; Firebase loads only when this is used.
import { auth } from './firebase.js';
import { reauth } from './auth.js';
import { appLock } from './native/lock.js';
import { loadSdk } from './mfa-sdk.js';
import {
  groupKey, cleanCode, autoSubmitOnce, isMfaRequired, mfaErrorMessage, mfaStatus,
  startEnroll, finishEnroll, unenrollAll, startSignIn, finishSignIn,
} from './mfa.js';
import { esc, $, sheet, toast } from './ui.js';
import { icon } from './ui/icons.js';

const CANCELLED = Object.assign(new Error('Cancelled.'), { code: 'forge/cancelled' });
export const wasCancelled = (e) => !!e && e.code === 'forge/cancelled';

/** A sheet that resolves with whatever `done(value)` is given, or with undefined when it is dismissed another way. */
function askSheet(title, render) {
  return new Promise((resolve) => {
    let finished = false;
    const end = (v) => { if (finished) return; finished = true; obs.disconnect(); resolve(v); };
    let dlg = null;
    const obs = new MutationObserver(() => { if (dlg && !dlg.isConnected) end(undefined); });
    const close = sheet(title, (body, closeSheet, head) => {
      dlg = body.closest('dialog');
      render(body, (v) => { end(v); closeSheet(); }, head);
    });
    void close;
    obs.observe(document.body, { childList: true });
  });
}

const CODE_INPUT = '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" placeholder="––– –––" enterkeyhint="done" autocapitalize="off" spellcheck="false">';

/** Wire a form's code box: digits only, "Turn on"/"Verify" button works with a pasted or autofilled code. */
function codeForm(body, label, run, onDone, { dimUntilFull = false } = {}) {
  const form = $('form', body);
  const err = $('.error', body);
  const btn = $('button[type=submit]', body);
  const input = form.code;
  const auto = autoSubmitOnce(() => { if (!btn.disabled && !btn.hidden) form.requestSubmit(); });
  const dim = (full) => { if (dimUntilFull) btn.classList.toggle('ghost', !full); };
  dim(false);
  input.addEventListener('input', () => {
    const c = cleanCode(input.value);
    input.value = c.length > 3 ? c.slice(0, 3) + ' ' + c.slice(3) : c;
    err.textContent = '';
    dim(c.length === 6);
    auto.check(c);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const r = await run(input.value);
      onDone(r);
    } catch (ex) {
      err.textContent = mfaErrorMessage(ex);
      if (ex && ex.code === 'auth/invalid-multi-factor-session') btn.hidden = true;
      input.value = ''; // a wrong code is just tried again; nothing here locks you out
      auto.reset();
      dim(false);
      input.focus();
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  setTimeout(() => input.focus({ preventScroll: true }), 120);
}

/** The code sheet for a sign-in (or reauth) that threw auth/multi-factor-auth-required. Resolves with the credential, or throws "cancelled". */
export async function promptSignInCode(error) {
  const sdk = await loadSdk();
  let ctx;
  try { ctx = startSignIn(sdk, auth, error); } catch (ex) { throw Object.assign(ex, { message: mfaErrorMessage(ex) }); }
  const out = await askSheet('Enter your code', (body, done) => {
    body.innerHTML = `
      <form class="stack" novalidate>
        <p class="muted">Open your authenticator app, or Apple Passwords, and enter the 6‑digit code for Forge.</p>
        <label class="field"><span>6‑digit code</span>${CODE_INPUT}</label>
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">Verify</button>
      </form>`;
    codeForm(body, 'Verify', (code) => finishSignIn(sdk, ctx, code), done);
  });
  if (!out) throw CANCELLED;
  return out;
}

/** Sign in or reauth step for the auth screen / delete flow: runs `fn`, and if a code is asked for, shows the sheet. */
export async function withSecondStep(fn) {
  try { return await fn(); } catch (e) { if (!isMfaRequired(e)) throw e; return promptSignInCode(e); }
}

/** reauth() that also copes with an account that has two-step sign-in on. */
export const reauthWithMfa = (password) => withSecondStep(() => reauth(password));

function passwordSheet() {
  return askSheet('Enter your password', (body, done) => {
    body.innerHTML = `
      <form class="stack" novalidate>
        <p class="muted">For safety, Forge asks for your password again before changing this.</p>
        <input type="email" name="username" autocomplete="username" value="${esc((auth.currentUser && auth.currentUser.email) || '')}" hidden tabindex="-1" aria-hidden="true">
        <label class="field"><span>Your password</span><input name="password" type="password" autocomplete="current-password"></label>
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">Continue</button>
      </form>`;
    const form = $('form', body);
    const err = $('.error', body);
    const btn = $('button[type=submit]', body);
    setTimeout(() => form.password.focus({ preventScroll: true }), 120);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      try { await reauthWithMfa(form.password.value); done(true); } catch (ex) {
        if (wasCancelled(ex)) { done(false); return; }
        err.textContent = mfaErrorMessage(ex);
        btn.disabled = false;
      }
    });
  });
}

/** Run `fn`; if Firebase wants a recent sign-in, ask for the password once and run it again. */
async function withRecent(fn) {
  try { return await fn(); } catch (e) {
    if (!e || e.code !== 'auth/requires-recent-login') throw e;
    if (!(await passwordSheet())) throw CANCELLED;
    return fn();
  }
}

// ---------- the QR code (vendored MIT generator, drawn here as an SVG; nothing leaves the phone) ----------
export async function qrSvg(text) {
  const qr = (await import('./vendor/qrcode/qrcode.js')).default(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 4; // quiet zone, in modules
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const s = n + q * 2;
  return `<svg viewBox="0 0 ${s} ${s}" role="img" aria-label="QR code for your authenticator app" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
}

// ---------- turning it on ----------
function openEnroll(user, sdk, onChange) {
  sheet('Two‑step sign‑in', (body, close, head) => {
    void head;
    body.innerHTML = '<p class="muted" aria-live="polite">Getting your code ready…</p>';
    const fail = (ex) => {
      body.innerHTML = `<div class="stack"><p class="mfa-msg">${esc(mfaErrorMessage(ex))}</p><button type="button" class="btn ghost" data-ok>OK</button></div>`;
      $('[data-ok]', body).onclick = close;
    };
    withRecent(() => startEnroll(sdk, user)).then(async (setup) => {
      const svg = await qrSvg(setup.uri);
      const shown = groupKey(setup.key);
      const groups = shown.split(' ').map((g) => `<span class="mfa-g">${esc(g)}</span>`).join(' ');
      body.innerHTML = `
        <div class="stack mfa">
          <p>Forge will ask for a 6‑digit code when you sign in, so a stolen password isn’t enough.</p>
          <p class="mfa-step"><b class="mfa-n">1</b><span>Add Forge to Passwords</span></p>
          <a class="btn" href="${esc(setup.uri)}" data-passwords>Add to Passwords</a>
          <p class="small muted">Opens Apple Passwords on this iPhone and saves your Forge code there. Then come back here.</p>
          <details class="mfa-more">
            <summary><span>Use another device or app</span><span class="chev" aria-hidden="true">${icon('chev')}</span></summary>
            <div class="mfa-qr">${svg}</div>
            <p class="small muted">Scan this with an authenticator app, or type the key:</p>
            <div class="mfa-keyrow"><code class="mfa-key" data-key>${groups}</code><button type="button" class="btn ghost" data-copy>Copy key</button></div>
          </details>
          <p class="mfa-step"><b class="mfa-n">2</b><span>Type the 6‑digit code it shows</span></p>
          <form class="stack" novalidate>
            <label class="field"><span>6‑digit code</span>${CODE_INPUT}</label>
            <p class="error" aria-live="polite"></p>
            <button class="btn ghost" type="submit">Turn on</button>
          </form>
        </div>`;
      $('[data-passwords]', body).addEventListener('click', () => {
        // Passwords asks for Face ID itself, so coming back from it must not ask again (once, within 2 minutes).
        const lock = appLock();
        if (lock) lock.passFor(120000);
        const back = () => {
          if (!body.isConnected) { document.removeEventListener('visibilitychange', back); return; }
          if (document.visibilityState !== 'visible') return;
          document.removeEventListener('visibilitychange', back);
          setTimeout(() => { const i = $('input[name=code]', body); if (i && i.isConnected) i.focus(); }, 250);
        };
        document.addEventListener('visibilitychange', back);
      });
      $('[data-copy]', body).onclick = async () => toast((await copyText(setup.key)) ? 'Setup key copied' : 'Press and hold the key to copy it');
      codeForm(body, 'Turn on', (code) => withRecent(() => finishEnroll(sdk, user, setup.secret, code)), () => {
        close();
        toast('Two‑step sign‑in is on');
        onChange();
      }, { dimUntilFull: true });
    }).catch((ex) => { if (!wasCancelled(ex)) fail(ex); else close(); });
  });
}

function openTurnOff(user, sdk, onChange) {
  sheet('Two‑step sign‑in', (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <p><b>Turn off two‑step sign‑in?</b></p>
        <p>Anyone who knows your password will be able to sign in to Forge. You can turn it back on any time.</p>
        <p class="error" aria-live="polite"></p>
        <div class="row gap">
          <button type="button" class="btn ghost grow" data-no>Keep it on</button>
          <button type="button" class="btn danger grow" data-yes>Turn off</button>
        </div>
      </div>`;
    $('[data-no]', body).onclick = close;
    const yes = $('[data-yes]', body);
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        await withRecent(() => unenrollAll(sdk, user));
        close();
        toast('Two‑step sign‑in is off');
        onChange();
      } catch (ex) {
        yes.disabled = false;
        if (!wasCancelled(ex)) $('.error', body).textContent = mfaErrorMessage(ex);
      }
    };
  });
}

// ---------- Settings → Privacy & security row ----------
export function mfaSettingsHtml() {
  return `<button type="button" class="g-row" data-mfa-row><span class="g-ic">${icon('key')}</span><span class="g-text"><span>Two‑step sign‑in</span><small data-mfa-note>Your password plus a 6‑digit code.</small></span><span class="g-val" data-mfa-state>…</span><span class="chev">${icon('chev')}</span></button>`;
}

export function bindMfaSettings(el) {
  const row = $('[data-mfa-row]', el);
  if (!row) return;
  const state = $('[data-mfa-state]', el);
  let sdk = null;
  const refresh = () => {
    const on = !!sdk && mfaStatus(sdk, auth.currentUser).on;
    state.textContent = sdk ? (on ? 'On' : 'Off') : '';
    row.dataset.on = on ? '1' : '0';
  };
  loadSdk().then((s) => { sdk = s; refresh(); }).catch(() => { state.textContent = ''; });
  row.addEventListener('click', async () => {
    try { if (!sdk) sdk = await loadSdk(); } catch { toast('No connection. Try again when you have signal.'); return; }
    const user = auth.currentUser;
    if (!user) return;
    if (mfaStatus(sdk, user).on) openTurnOff(user, sdk, refresh);
    else openEnroll(user, sdk, refresh);
  });
}
