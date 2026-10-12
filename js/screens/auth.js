import { signIn, signUp, resetPassword, authErrorMessage } from '../auth.js';
import { esc, $, toast } from '../ui.js';
import { MFA_REQUIRED } from '../mfa.js';
import { APP_NAME } from '../../config.js';

let mode = 'signin'; // 'signin' | 'signup' | 'reset'

export function renderAuth(el) {
  const titles = { signin: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' };
  el.innerHTML = `
    <section class="auth">
      <div class="brand">
        <img src="icons/icon-192.png" alt="" width="72" height="72">
        <h1>${esc(APP_NAME)}</h1>
        <p class="muted">Train. Fuel. Track. All in one place.</p>
      </div>
      <form class="card stack" novalidate>
        <h2>${titles[mode]}</h2>
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" autocomplete="email" inputmode="email" required>
        </label>
        ${mode !== 'reset' ? `
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required>
          ${mode === 'signup' ? '<small class="muted">At least 8 characters.</small>' : ''}
        </label>` : ''}
        <p class="error" aria-live="polite"></p>
        <button class="btn" type="submit">${mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}</button>
        <div class="row between small">
          ${mode !== 'signin' ? '<button type="button" class="link" data-mode="signin">I have an account</button>' : '<button type="button" class="link" data-mode="signup">Create an account</button>'}
          ${mode === 'signin' ? '<button type="button" class="link" data-mode="reset">Forgot password?</button>' : ''}
        </div>
      </form>
    </section>`;

  el.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      renderAuth(el);
    })
  );

  const form = $('form', el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password ? form.password.value : '';
    const err = $('.error', el);
    const btn = $('button[type=submit]', el);
    err.textContent = '';
    if (mode === 'signup' && password.length < 8) {
      err.textContent = 'Use at least 8 characters for your password.';
      return;
    }
    btn.disabled = true;
    try {
      if (mode === 'signin') {
        try { await signIn(email, password); } catch (ex) {
          if (!ex || ex.code !== MFA_REQUIRED) throw ex;
          // Two-step sign-in is on: ask for the code (the app signs you in once it's right).
          await (await import('../mfa-ui.js')).promptSignInCode(ex);
        }
      }
      else if (mode === 'signup') await signUp(email, password);
      else {
        await resetPassword(email);
        toast('Check your email for a reset link.');
        mode = 'signin';
        renderAuth(el);
      }
    } catch (ex) {
      if (!ex || ex.code !== 'forge/cancelled') err.textContent = authErrorMessage(ex);
    } finally {
      btn.disabled = false;
    }
  });
}
