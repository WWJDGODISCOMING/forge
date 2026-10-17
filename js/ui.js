// Small UI helpers: escaping, toasts, bottom sheets, confirm.

import { isNative } from './native/bridge.js';
import { reducedMotion, DUR } from './ui/motion.js';
import { icon } from './ui/icons.js';
import { shouldDismiss, rubberBand, dragProgress, velocityOf } from './ui/gesture.js';
import { registerSheet } from './ui/sheets.js';
import { haptics } from './ui/haptic.js';
import { playSpring, SHEET } from './ui/spring.js';

export { closeAllSheets } from './ui/sheets.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** A glass capsule above the tab bar. toast('Saved', 2600, { icon: 'check' }) adds an icon; the text is never HTML. */
export function toast(message, ms = 2600, { icon: name = '', action = null } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  if (name) el.insertAdjacentHTML('afterbegin', icon(name));
  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;
  el.append(msg);
  let hide = () => {};
  if (action) {
    // { label, onClick }: a button in the capsule (Undo). Tapping it runs once and dismisses the toast.
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-act';
    b.textContent = action.label;
    b.addEventListener('click', () => { b.disabled = true; hide(); action.onClick(); }, { once: true });
    el.append(b);
  }
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let timer = setTimeout(() => hide(), ms);
  hide = () => {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), DUR.med + 20);
  };
}

let sheetCount = 0;

/**
 * Opens a bottom sheet: grabber, glass header, drag the grabber or header down to dismiss (a long drag or a
 * quick flick closes it, otherwise it springs back), and an animated exit. `render(body, close)` fills it.
 * Escape and a tap on the dimmed backdrop close it too. Returns close().
 */
export function sheet(title, render) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet pre';
  const titleId = `sheet-title-${++sheetCount}`;
  dlg.setAttribute('aria-labelledby', titleId);
  dlg.innerHTML = `
    <div class="sheet-grab" aria-hidden="true"><i></i></div>
    <div class="sheet-head">
      <button class="icon-btn sh-back" data-back aria-label="Back" hidden>${icon('back', { size: 20 })}</button>
      <h2 id="${titleId}">${esc(title)}</h2>
      <button class="icon-btn" data-close aria-label="Close">${icon('close', { size: 18 })}</button>
    </div>
    <div class="sheet-body"></div>`;
  document.body.appendChild(dlg);
  haptics.light();
  let closing = false;
  let forget = () => {};
  let anim = null; // the running spring (open, close or release), if any
  let exiting = false; // the running spring is the exit; grabbing it cancels the close
  let drag = null; // the finger on the sheet, if any: one per sheet, so close() can end it
  const reduced = reducedMotion();
  // Drive the sheet from JS: --sheet-y in px and --sheet-p (backdrop 0..1) set together each frame.
  const place = (y) => {
    dlg.style.setProperty('--sheet-y', `${y}px`);
    dlg.style.setProperty('--sheet-p', String(1 - dragProgress(y, dlg.offsetHeight)));
  };
  const settle = () => {
    anim = null;
    dlg.classList.remove('springing');
    dlg.style.removeProperty('--sheet-y');
    dlg.style.removeProperty('--sheet-p');
    dlg.style.removeProperty('will-change');
  };
  const run = (from, to, velocity, onDone, reach) => {
    anim?.stop();
    dlg.classList.add('springing');
    dlg.style.willChange = 'transform';
    anim = playSpring({ el: dlg, from, to, velocity, params: SHEET, reach, onUpdate: place, onDone });
  };
  const finish = () => {
    forget();
    if (dlg.open) dlg.close();
    dlg.remove();
  };
  // velocity: the finger's speed when released as a dismiss; otherwise the running spring's speed carries into the exit.
  const exit = (velocity = null) => {
    dlg.classList.remove('dragging');
    if (reduced) {
      dlg.classList.add('closing'); // CSS fades it out
      setTimeout(finish, DUR.med + 40);
      return;
    }
    const caught = anim ? anim.stop() : null;
    const from = caught ? caught.value : parseFloat(dlg.style.getPropertyValue('--sheet-y')) || 0;
    const v = velocity != null ? Math.max(velocity, 0) : caught ? caught.velocity : 0;
    const h = dlg.offsetHeight;
    exiting = true;
    run(from, h, v, finish, h - 1); // done once it is off-screen, so the invisible sheet never blocks taps
  };
  const endDrag = () => {
    if (!drag) return;
    const { handle, pointerId } = drag;
    drag = null;
    dlg.classList.remove('dragging');
    try { handle.releasePointerCapture(pointerId); } catch { /* already released */ }
  };
  const close = () => {
    if (closing) return;
    closing = true;
    forget();
    endDrag(); // a finger still down must not fight the exit
    exit();
  };
  // Drag to dismiss (pointer events on the grabber and header; the body keeps its own scrolling).
  if (!reduced) {
    for (const handle of dlg.querySelectorAll('.sheet-grab, .sheet-head')) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || drag) return;
        if (closing && !exiting) return;
        let base = 0; // where the sheet was when grabbed (nonzero when caught mid-spring)
        if (anim) {
          // Caught mid-flight: stop under the finger. Grabbing a closing sheet cancels the close.
          base = anim.stop().value;
          anim = null;
          if (closing) { closing = false; exiting = false; forget = registerSheet(close); }
        }
        drag = { handle, pointerId: e.pointerId, startY: e.clientY, base, offset: base, samples: [{ t: e.timeStamp, v: e.clientY }] };
        handle.setPointerCapture(e.pointerId);
        dlg.classList.add('dragging');
        dlg.classList.add('springing');
        dlg.style.willChange = 'transform';
        place(base);
      });
      handle.addEventListener('pointermove', (e) => {
        if (!drag || closing || drag.handle !== handle) return;
        drag.samples.push({ t: e.timeStamp, v: e.clientY });
        drag.offset = rubberBand(drag.base + e.clientY - drag.startY);
        place(drag.offset);
      });
      const release = (e) => {
        if (!drag || closing || drag.handle !== handle) return;
        const { offset, samples } = drag;
        const up = e.type !== 'pointercancel';
        if (up) samples.push({ t: e.timeStamp, v: e.clientY }); // a finger held still hands over 0, not the old flick
        const velocity = up ? velocityOf(samples) : 0;
        endDrag();
        if (up && shouldDismiss({ offset, velocity, size: dlg.offsetHeight })) {
          closing = true; forget(); exit(velocity);
        } else {
          run(offset, 0, velocity, settle); // snaps back with the finger's speed and a little settle
        }
      };
      handle.addEventListener('pointerup', release);
      handle.addEventListener('pointercancel', release);
    }
  }
  dlg.querySelector('[data-close]').addEventListener('click', () => close());
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close(); // tap on the dimmed backdrop
  });
  forget = registerSheet(close);
  // Multi-step sheets: head.setStep('Session length', goBack) swaps the title and shows a back chevron; setStep(title, null) goes home.
  const head = {
    setStep(text, onBack = null) {
      dlg.querySelector('h2').textContent = text;
      const b = dlg.querySelector('.sh-back');
      b.hidden = !onBack;
      b.onclick = onBack;
      const bodyEl = dlg.querySelector('.sheet-body');
      if (!reducedMotion()) {
        bodyEl.classList.remove('step-in', 'step-back');
        void bodyEl.offsetWidth;
        bodyEl.classList.add(onBack ? 'step-in' : 'step-back');
      }
    },
  };
  render(dlg.querySelector('.sheet-body'), close, head);
  dlg.showModal();
  if (reduced) {
    void dlg.offsetHeight; // lock in the transparent start, then fade in
    dlg.classList.remove('pre');
  } else {
    // Spring up from off-screen. 'pre' is dropped on the same frame the JS takes over, so nothing flashes.
    const h = dlg.offsetHeight;
    dlg.classList.add('springing');
    dlg.style.setProperty('--sheet-y', `${h}px`);
    dlg.style.setProperty('--sheet-p', '0');
    dlg.classList.remove('pre');
    void dlg.offsetHeight;
    run(h, 0, 0, settle);
  }
  return close;
}

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const close = sheet(title, (body, closeSheet) => {
      body.innerHTML = `
        <p class="muted">${esc(message)}</p>
        <div class="row gap">
          <button class="btn ghost grow" data-no>Cancel</button>
          <button class="btn grow ${danger ? 'danger' : ''}" data-yes>${esc(confirmLabel)}</button>
        </div>`;
      body.querySelector('[data-no]').onclick = () => { answered = true; closeSheet(); resolve(false); };
      body.querySelector('[data-yes]').onclick = () => { if (danger) haptics.warning(); answered = true; closeSheet(); resolve(true); };
    });
    // resolve false if dismissed another way
    const obs = new MutationObserver(() => {
      if (!document.body.contains(document.querySelector('dialog.sheet')) && !answered) {
        answered = true;
        resolve(false);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true });
    void close;
  });
}

/** Old API: now forwards to the PR explosion in js/ui/fx.js (queued, never stacks). */
export function celebrate(lines) {
  import('./ui/fx.js').then((fx) => lines.forEach((label) => fx.prExplosion({ label, value: null, prev: null })));
}

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDay(key, opts = { month: 'short', day: 'numeric' }) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export const isStandalone = () =>
  isNative() || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
