// Two-step sign-in screens: the code sheet at sign-in, the password sheet, turning it on (Add to Passwords, QR, setup key,
// 6-digit code) and turning it off. The logic and the error text live in js/mfa.js; Firebase loads only when this is used.
import { auth } from './firebase.js';
import { reauth } from './auth.js';
import { loadSdk } from './mfa-sdk.js';
import {
  groupKey, cleanCode, isMfaRequired, mfaErrorMessage, mfaStatus,
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

const CODE_INPUT = '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" placeholder="123 456" enterkeyhint="done" autocapitalize="off" spellcheck="false">';

/** Wire a form's code box: digits only, "Turn on"/"Verify" button works with a pasted or autofilled code. */
function codeForm(body, label, run, onDone) {
  const form = $('form', body);
  const err = $('.error', body);
  const btn = $('button[type=submit]', body);
  const input = form.code;
  input.addEventListener('input', () => { const c = cleanCode(input.value); input.value = c.length > 3 ? c.slice(0, 3) + ' ' + c.slice(3) : c; err.textContent = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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
        <p class="muted">Open your authenticator app, or Apple Passwords, and enter the 6-digit code for Forge.</p>
        <label class="field"><span>6-digit code</span>${CODE_INPUT}</label>
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
        <label class="field"><span>Your password</span><input name="password" type="password" autocomplete="current-password"></label>
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">Continue</button>
      </form>`;
    const form = $('form', body);
    const err = $('.error', body);
    const btn = $('button[type=submit]', body);
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
  const q = 3; // quiet zone, in modules
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
  sheet('Two-step sign-in', (body, close, head) => {
    void head;
    body.innerHTML = '<p class="muted" aria-live="polite">Getting your code ready…</p>';
    const fail = (ex) => {
      body.innerHTML = `<div class="stack"><p class="mfa-msg">${esc(mfaErrorMessage(ex))}</p><button type="button" class="btn ghost" data-ok>OK</button></div>`;
      $('[data-ok]', body).onclick = close;
    };
    withRecent(() => startEnroll(sdk, user)).then(async (setup) => {
      const svg = await qrSvg(setup.uri);
      const shown = groupKey(setup.key);
      body.innerHTML = `
        <div class="stack mfa">
          <p>Forge will ask for a 6-digit code when you sign in, so a stolen password isn’t enough.</p>
          <a class="btn" href="${esc(setup.uri)}" data-passwords>Add to Passwords</a>
          <p class="small muted">Opens Apple Passwords on this iPhone and saves your Forge code there. Then come back and type the code it shows.</p>
          <details class="mfa-more">
            <summary>Use another device or app</summary>
            <div class="mfa-qr">${svg}</div>
            <p class="small muted">Scan this with an authenticator app, or type the key:</p>
            <div class="mfa-keyrow"><code class="mfa-key" data-key>${esc(shown)}</code><button type="button" class="btn ghost" data-copy>Copy</button></div>
          </details>
          <form class="stack" novalidate>
            <label class="field"><span>6-digit code</span>${CODE_INPUT}</label>
            <p class="error" aria-live="polite"></p>
            <button class="btn" type="submit">Turn on</button>
          </form>
        </div>`;
      $('[data-copy]', body).onclick = async () => toast((await copyText(setup.key)) ? 'Setup key copied' : 'Press and hold the key to copy it');
      codeForm(body, 'Turn on', (code) => finishEnroll(sdk, user, setup.secret, code), () => {
        close();
        toast('Two-step sign-in is on');
        onChange();
      });
    }).catch((ex) => { if (!wasCancelled(ex)) fail(ex); else close(); });
  });
}

function openTurnOff(user, sdk, onChange) {
  sheet('Turn off two-step sign-in?', (body, close) => {
    body.innerHTML = `
      <div class="stack">
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
        toast('Two-step sign-in is off');
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
  return `
      <div class="group" data-mfa>
        <button type="button" class="g-row" data-mfa-row><span class="g-ic">${icon('lock')}</span><span class="g-text"><span>Two-step sign-in</span><small data-mfa-note>A code from an authenticator app, as well as your password.</small></span><span class="g-val" data-mfa-state>…</span></button>
      </div>`;
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
