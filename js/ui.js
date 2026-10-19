// Small UI helpers: escaping, toasts, bottom sheets, confirm.

import { isNative, syncStatusBar } from './native/bridge.js';
import { reducedMotion, DUR } from './ui/motion.js';
import { icon } from './ui/icons.js';
import { checkSvg } from './ui/checkdraw.js';
import { shouldDismiss, rubberBand, dragProgress, velocityOf, pickDetent, crossedDetent, liftProgress } from './ui/gesture.js';
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
  if (name) el.insertAdjacentHTML('afterbegin', name === 'check' ? checkSvg({ size: 18, delay: 150 }) : icon(name));
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
  return hide; // dismiss early (e.g. an Undo whose delete is already written)
}

let sheetCount = 0;
let liftOwner = null; // the first detent sheet to ease the page back; sheets opened on top leave the page alone; a closing owner hands the page to the next detent sheet


/**
 * Opens a bottom sheet: grabber, glass header, drag the grabber or header down to dismiss (a long drag or a
 * quick flick closes it, otherwise it springs back), and an animated exit. `render(body, close)` fills it.
 * Escape and a tap on the dimmed backdrop close it too. Returns close().
 * opts.detents ['medium', 'large']: opens about half the screen tall and drags up to full height (phones only, not with reduced motion;
 * sized to the tallest sheet the screen allows; head.expand() goes to full height). Without it the sheet has a single height.
 */
export function sheet(title, render, opts = {}) {
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
  let ds = null; // detent offsets [0 (large), medium] in px from fully open, once detents are in play
  let rest = 0; // the detent the sheet is resting at
  let armed = false; // focus-to-large only after the open spring has finished
  // Drive the sheet from JS: --sheet-y in px and --sheet-p (backdrop 0..1) set together each frame.
  const place = (y) => {
    dlg.style.setProperty('--sheet-y', `${y}px`);
    const low = ds ? ds[ds.length - 1] : 0; // the backdrop stays full at the lowest detent
    dlg.style.setProperty('--sheet-p', String(1 - dragProgress(Math.max(0, y - low), dlg.offsetHeight - low)));
    if (ds && pages.length && liftOwner?.dlg === dlg) { const l = String(liftProgress(y, ds)); for (const el of pages) el.style.setProperty('--sheet-lift', l); lightBar(Number(l) > 0.5); } // same frame as --sheet-y
  };
  // Detent sheets ease the page behind back (#main and #nav share one transform origin, so they move as one piece).
  let pages = [];
  const willChange = (on) => { for (const el of pages) { if (on) el.style.willChange = 'transform'; else el.style.removeProperty('will-change'); } };
  // Top of the viewport, in each element's own space, measured once before any transform. #nav and #navbar are fixed,
  // so only #main's origin moves as the page behind scrolls (scrollY - its document top; no getBoundingClientRect while lifted).
  let mainTop = 0;
  const measureMain = () => { pages[0]?.style.setProperty('--lift-oy', `${window.scrollY - mainTop}px`); };
  let measureRaf = 0;
  const onScroll = () => { if (!measureRaf) measureRaf = requestAnimationFrame(() => { measureRaf = 0; measureMain(); }); };
  // Native, light theme: the strip above a lifted page is near-black, so the status bar goes light text past halfway.
  let barLight = false;
  const lightBar = (on) => {
    if (on === barLight || !isNative() || window.matchMedia('(prefers-color-scheme: dark)').matches) return;
    barLight = on;
    syncStatusBar(on ? true : false);
  };
  const stopWatching = () => {
    window.removeEventListener('scroll', onScroll);
    if (measureRaf) { cancelAnimationFrame(measureRaf); measureRaf = 0; }
  };
  const lift = () => {
    const prev = liftOwner;
    if (prev && !prev.closing()) return; // a detent sheet is already easing the page back
    liftOwner = { dlg, closing: () => closing, stop: stopWatching, state: () => ({ pages, mainTop, barLight }) };
    if (prev) {
      // Handoff from a sheet that is closing (Log food <-> Snap a meal): keep the page as it is and carry on from it.
      prev.stop();
      ({ pages, mainTop, barLight } = prev.state());
    } else {
      pages = [document.getElementById('main'), document.getElementById('nav'), document.getElementById('navbar')].filter(Boolean);
      for (const el of pages) el.style.setProperty('--lift-oy', `${-el.getBoundingClientRect().top}px`);
      mainTop = pages[0].getBoundingClientRect().top + window.scrollY;
      for (const el of pages) el.classList.add('lifted');
      document.documentElement.classList.add('sheet-lift-on');
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  };
  const unlift = () => {
    if (liftOwner?.dlg !== dlg) return;
    liftOwner = null;
    stopWatching();
    lightBar(false);
    for (const el of pages) {
      el.classList.remove('lifted');
      for (const k of ['--sheet-lift', '--lift-oy', 'will-change']) el.style.removeProperty(k);
      if (!el.getAttribute('style')) el.removeAttribute('style');
    }
    pages = [];
    document.documentElement.classList.remove('sheet-lift-on');
  };
  const atRest = (to) => {
    rest = to;
    if (ds) dlg.classList.toggle('at-medium', to > 0);
  };
  const settle = () => {
    anim = null;
    dlg.style.removeProperty('will-change');
    willChange(false);
    if (rest > 0) { place(rest); return; } // parked at a lower detent: JS keeps owning the position
    dlg.classList.remove('springing');
    dlg.style.removeProperty('--sheet-y');
    dlg.style.removeProperty('--sheet-p');
  };
  const run = (from, to, velocity, onDone, reach, relativeTo) => {
    anim?.stop();
    dlg.classList.add('springing');
    dlg.style.willChange = 'transform';
    willChange(true);
    anim = playSpring({ el: dlg, from, to, velocity, params: SHEET, reach, relativeTo, onUpdate: place, onDone });
  };
  // Move a parked sheet up to full height (a text field got focus, or the food dock opened).
  let hold = false;
  const toLarge = () => {
    if (!ds || closing || drag || rest === 0) return;
    const caught = anim ? anim.stop() : null;
    const from = caught ? caught.value : rest;
    atRest(0);
    run(from, 0, caught ? caught.velocity : 0, () => { armed = true; settle(); });
  };
  const opened = () => {
    settle();
    armed = true;
    if (dlg.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) toLarge(); // focused during the open
  };
  const finish = () => {
    unlift();
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
        let base = rest; // where the sheet was when grabbed (nonzero when caught mid-spring)
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
        willChange(true);
        place(base);
      });
      handle.addEventListener('pointermove', (e) => {
        if (!drag || closing || drag.handle !== handle) return;
        drag.samples.push({ t: e.timeStamp, v: e.clientY });
        const prev = drag.offset;
        drag.offset = rubberBand(drag.base + e.clientY - drag.startY);
        place(drag.offset);
        if (ds && crossedDetent(prev, drag.offset, ds) != null) haptics.select();
      });
      const release = (e) => {
        if (!drag || closing || drag.handle !== handle) return;
        const { offset, samples, base: base0 } = drag;
        const up = e.type !== 'pointercancel';
        if (up) samples.push({ t: e.timeStamp, v: e.clientY }); // a finger held still hands over 0, not the old flick
        const velocity = up ? velocityOf(samples) : 0;
        endDrag();
        const pick = !ds ? null : up ? pickDetent({ offset, velocity, detents: ds, size: dlg.offsetHeight, from: base0 }) : rest;
        if (ds ? pick === 'dismiss' : up && shouldDismiss({ offset, velocity, size: dlg.offsetHeight })) {
          closing = true; forget(); exit(velocity);
        } else {
          const to = ds && !hold ? pick : 0;
          atRest(to);
          run(offset, to, velocity, settle); // snaps back with the finger's speed and a little settle
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
    // Only the dimmed backdrop closes; a drag that ends over the sheet itself also clicks the dialog.
    const r = dlg.getBoundingClientRect();
    if (e.target === dlg && (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right)) close();
  });
  forget = registerSheet(close);
  // Multi-step sheets: head.setStep('Session length', goBack) swaps the title and shows a back chevron; setStep(title, null) goes home.
  const head = {
    expand: toLarge,
    holdLarge(on) { hold = on; }, // while on, the sheet never rests at medium (a drag springs back to full height or dismisses)
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
  if (opts.detents?.length > 1 && !reduced && !window.matchMedia('(min-width: 600px)').matches) {
    // Size to the tallest a sheet can be before measuring, so the stops depend on the screen and not on content
    // that hasn't loaded yet. Medium rests with 50% of the viewport showing.
    dlg.style.height = 'calc(100dvh - var(--safe-top) - 16px)';
    const full = dlg.offsetHeight;
    const medium = Math.round(full - window.innerHeight * 0.5);
    if (medium > 40) {
      ds = [0, medium];
      dlg.style.setProperty('--detent-pad', `${medium}px`); // lets the last row scroll above the screen edge at medium
      dlg.classList.add('detented');
      lift();
      atRest(medium);
      dlg.addEventListener('focusin', (e) => {
        if (armed && e.target.closest('input, textarea, select')) toLarge();
      });
    } else {
      dlg.style.removeProperty('height');
    }
  }
  if (reduced) {
    void dlg.offsetHeight; // lock in the transparent start, then fade in
    dlg.classList.remove('pre');
    armed = true;
  } else {
    // Spring up from off-screen. 'pre' is dropped on the same frame the JS takes over, so nothing flashes.
    const h = dlg.offsetHeight;
    dlg.classList.add('springing');
    dlg.style.setProperty('--sheet-y', `${h}px`);
    dlg.style.setProperty('--sheet-p', '0');
    dlg.classList.remove('pre');
    void dlg.offsetHeight;
    run(h, rest, 0, opened, undefined, h); // relative to the sheet's own height: late content can't pop it into view
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
