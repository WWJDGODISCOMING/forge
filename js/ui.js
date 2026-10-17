// Small UI helpers: escaping, toasts, bottom sheets, confirm.

import { isNative } from './native/bridge.js';
import { reducedMotion, DUR } from './ui/motion.js';
import { icon } from './ui/icons.js';
import { shouldDismiss, rubberBand, dragProgress, velocityOf } from './ui/gesture.js';
import { registerSheet } from './ui/sheets.js';
import { haptics } from './ui/haptic.js';
import { animateSpring, SHEET } from './ui/spring.js';

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
  const run = (from, to, velocity, onDone) => {
    anim?.stop();
    dlg.classList.add('springing');
    dlg.style.willChange = 'transform';
    anim = animateSpring({ from, to, velocity, params: SHEET, onUpdate: place, onDone });
  };
  const finish = () => {
    forget();
    if (dlg.open) dlg.close();
    dlg.remove();
  };
  const exit = (velocity) => {
    dlg.classList.remove('dragging');
    if (reduced) {
      dlg.classList.add('closing'); // CSS fades it out
      setTimeout(finish, DUR.med + 40);
      return;
    }
    const from = anim ? anim.stop().value : parseFloat(dlg.style.getPropertyValue('--sheet-y')) || 0;
    exiting = true;
    run(from, dlg.offsetHeight, Math.max(velocity, 0), finish);
  };
  const close = () => {
    if (closing) return;
    closing = true;
    forget();
    exit(0);
  };
  // Drag to dismiss (pointer events on the grabber and header; the body keeps its own scrolling).
  if (!reduced) {
    for (const handle of dlg.querySelectorAll('.sheet-grab, .sheet-head')) {
      let startY = 0;
      let base = 0; // where the sheet was when grabbed (nonzero when caught mid-spring)
      let offset = 0;
      let samples = null;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        if (closing && !exiting) return;
        if (anim) {
          // Caught mid-flight: stop under the finger. Grabbing a closing sheet cancels the close.
          base = anim.stop().value;
          anim = null;
          if (closing) { closing = false; exiting = false; forget = registerSheet(close); }
        } else base = 0;
        samples = [{ t: e.timeStamp, v: e.clientY }];
        startY = e.clientY;
        offset = base;
        handle.setPointerCapture(e.pointerId);
        dlg.classList.add('dragging');
        dlg.classList.add('springing');
        dlg.style.willChange = 'transform';
        place(offset);
      });
      handle.addEventListener('pointermove', (e) => {
        if (!samples) return;
        samples.push({ t: e.timeStamp, v: e.clientY });
        offset = rubberBand(base + e.clientY - startY);
        place(offset);
      });
      const release = (e) => {
        if (!samples) return;
        const velocity = velocityOf(samples);
        samples = null;
        dlg.classList.remove('dragging');
        if (e.type !== 'pointercancel' && shouldDismiss({ offset, velocity, size: dlg.offsetHeight })) {
          if (!closing) { closing = true; forget(); exit(velocity); }
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
