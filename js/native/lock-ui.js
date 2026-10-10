// Settings → Privacy & security (the lock toggle and timeout) and the one-time "Lock Forge with Face ID?" ask.
import { isNative } from './bridge.js';
import { appLock, lockSupported, readSettings, writeSettings, TIMEOUTS } from './lock.js';
import { esc, $, sheet, toast } from '../ui.js';
import { icon } from '../ui/icons.js';

/** The section's markup. On the web there's no toggle, just one line saying why. */
export function privacySettingsHtml(store = localStorage) {
  const supported = lockSupported();
  const s = readSettings(store);
  const note = isNative()
    ? 'Update the iPhone app with Refresh Forge to get the Face ID lock.'
    : 'Face ID lock is available in the iPhone app.';
  return `
      <p class="sec-title">Privacy &amp; security</p>
      <div class="group" data-privacy>
        ${supported ? `
        <label class="g-row sw"><span class="g-ic">${icon('lock')}</span><span class="g-text"><span>Lock Forge with Face ID</span><small>Hides Forge in the app switcher too.</small></span><input type="checkbox" switch name="applock" ${s.enabled ? 'checked' : ''}></label>
        <div class="g-row col static" data-lock-timeout ${s.enabled ? '' : 'hidden'}><span>Lock after leaving</span>
          <div class="seg" role="radiogroup" aria-label="Lock after leaving the app">
            ${TIMEOUTS.map((t) => `<label><input type="radio" name="locktime" value="${t.ms}" ${s.timeout === t.ms ? 'checked' : ''}><span>${esc(t.label)}</span></label>`).join('')}
          </div>
        </div>` : `
        <div class="g-row static"><span class="g-ic">${icon('lock')}</span><span class="g-text"><span>Face ID lock</span><small>${note}</small></span></div>`}
      </div>`;
}

const failText = {
  unavailable: 'Set a passcode in iPhone Settings first, then try again.',
  failed: 'Face ID didn’t work, so the lock stays as it was.',
};

export function bindPrivacySettings(el) {
  const box = $('[data-privacy]', el);
  const sw = box && $('input[name=applock]', box);
  if (!sw) return;
  const timeoutRow = $('[data-lock-timeout]', box);
  sw.addEventListener('change', async () => {
    const lock = appLock();
    const want = sw.checked;
    sw.disabled = true;
    try {
      let ok;
      if (want) {
        const out = lock ? await lock.enable() : 'failed';
        ok = out === 'ok';
        if (!ok && out !== 'cancel') toast(failText[out] || failText.failed, 4500);
      } else ok = lock ? await lock.disable() : true; // turning it off needs Face ID or the passcode
      if (!ok) sw.checked = !want;
      else if (timeoutRow) timeoutRow.hidden = !want;
    } finally { sw.disabled = false; }
  });
  box.querySelectorAll('input[name=locktime]').forEach((r) =>
    r.addEventListener('change', () => { if (appLock()) appLock().setTimeoutMs(Number(r.value)); else writeSettings({ timeout: Number(r.value) }); })
  );
}

/** Ask once, after onboarding (and after the tour), whether to turn the lock on. Rendered on Today. */
export function shouldAsk(s, { supported, tourBusy }) {
  return !!supported && !s.asked && !s.enabled && !tourBusy;
}

/** One thing at a time: not over a running tour, the tour invite card, or the "Updated to" note. */
const otherPromptUp = ({ tourBusy, noteSettled }) =>
  !!tourBusy || !noteSettled || !!(typeof document !== 'undefined' && document.querySelector('[data-tour-offer], dialog[open]'));

export function maybeAskLock({ tourBusy = false, noteSettled = true, store = localStorage } = {}) {
  const lock = appLock();
  if (!lock || !shouldAsk(readSettings(store), { supported: lockSupported(), tourBusy: otherPromptUp({ tourBusy, noteSettled }) })) return false;
  lock.whenUnlocked().then(() => {
    // Asked is saved only once the sheet is actually shown; if something else came up meanwhile, a later Today visit asks.
    if (otherPromptUp({ tourBusy: false, noteSettled }) || readSettings(store).asked) return;
    writeSettings({ asked: true }, store);
    showAsk(lock); // never over the lock screen
  });
  return true;
}

function showAsk(lock) {
  sheet('Lock Forge with Face ID?', (body, close) => {
    body.innerHTML = `
      <p>Your workouts, weight and progress photos stay private if someone picks up your phone. You can change this any time in Settings → Privacy &amp; security.</p>
      <div class="row gap">
        <button type="button" class="btn ghost grow" data-no>Not now</button>
        <button type="button" class="btn grow" data-yes>Turn on</button>
      </div>`;
    $('[data-no]', body).onclick = close;
    $('[data-yes]', body).onclick = async () => {
      close();
      const out = await lock.enable();
      if (out === 'ok') toast('Forge is locked with Face ID');
      else if (out !== 'cancel') toast(failText[out] || failText.failed, 4500);
    };
  });
}
