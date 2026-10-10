// The how-to tour overlay: a spotlight on the real element (everything else dimmed) and a big card at the
// bottom of the screen (the thumb zone) with Back / Next / Skip. Steps and rules live in steps.js.
// Reduced motion: no animation at all (the CSS only animates under no-preference; scrolling is instant).
import { state } from '../state.js';
import { toast } from '../ui.js';
import { TOUR_STEPS, createTour, scrollToClear, shouldStartTour, tourSeenFields, tourOfferFields } from './steps.js';

let active = null;

export const isTourActive = () => !!active;

/** Start the tour if this account is waiting for it (called after a screen renders). */
export function maybeStartTour() {
  if (shouldStartTour(state.profile, !!active)) startTour();
}

const currentRoute = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'today').split('/')[0];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait (up to ms) for a selector to exist: the screen renders after the hash changes. */
async function waitFor(selector, ms = 1800) {
  const until = Date.now() + ms;
  for (;;) {
    const el = selector && document.querySelector(selector);
    if (el || !selector || Date.now() > until) return el || null;
    await pause(50);
  }
}

async function markSeen() {
  const iso = new Date().toISOString();
  state.set({ profile: { ...state.profile, ...tourSeenFields(iso) } }); // so it can't restart before the cloud confirms
  try {
    const { patch } = await import('../db.js');
    patch('profile', 'main', tourSeenFields(iso));
  } catch (e) {
    console.error(e);
  }
}

/** "Show me" / "Not now" on the one-time offer: remember the answer on the profile so it never comes back. */
export async function dismissTourOffer() {
  state.set({ profile: { ...state.profile, ...tourOfferFields() } });
  try {
    const { patch } = await import('../db.js');
    patch('profile', 'main', tourOfferFields());
  } catch (e) {
    console.error(e);
  }
}

/** Show the tour. replay: from Settings (works for any account; you land back where you started). */
export async function startTour({ replay = false } = {}) {
  if (active || !state.profile) return;
  const origin = location.hash || '#/today';
  const prevFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = 'tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tour-title');
  root.setAttribute('aria-describedby', 'tour-body');
  root.innerHTML = `
    <div class="tour-block"></div>
    <div class="tour-spot"></div>
    <div class="tour-card" tabindex="-1">
      <div class="row between center"><p class="small muted" data-count></p><span class="tour-dots" data-dots aria-hidden="true"></span></div>
      <div class="stack tour-text" aria-live="polite"><h2 id="tour-title"></h2><p id="tour-body"></p></div>
      <div class="tour-actions">
        <button class="btn ghost" data-back>Back</button>
        <button class="btn" data-next>Next</button>
      </div>
      <button class="tour-skip" data-skip>Skip tour</button>
    </div>`;
  const q = (s) => root.querySelector(s);
  const spot = q('.tour-spot');
  const card = q('.tour-card');
  const inertEls = ['main', '#nav'].map((s) => document.querySelector(s)).filter(Boolean);

  const tour = createTour(TOUR_STEPS, (how) => {
    close();
    markSeen();
    if (replay || how === 'skipped') toast(how === 'skipped' ? 'Tour skipped. Find it again in Settings.' : 'That’s the tour. Enjoy!');
    if (replay && location.hash !== origin) location.hash = origin;
  });

  const probe = document.createElement('div'); // reads --safe-top (an env() value) as pixels
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--safe-top)';
  root.appendChild(probe);
  const safeTop = () => 12 + (parseFloat(getComputedStyle(probe).paddingTop) || 0);
  // The top bar (Good afternoon, Body…) sits over the page, so a pinned target must start 8px below its bottom edge.
  const minTop = () => {
    const bar = document.getElementById('navbar');
    const shown = bar && !bar.hidden && getComputedStyle(bar).display !== 'none';
    return Math.max(safeTop(), shown ? bar.getBoundingClientRect().bottom + 8 : 0);
  };

  let lastInput = 'pointer'; // the Next pill takes focus (and its ring) only for keyboard users; after a tap the card does
  const onPointer = () => { lastInput = 'pointer'; };
  let raf = 0;
  const place = () => {
    raf = 0;
    if (!active) return;
    if (!state.user || !state.profile) { close(); return; } // signed out underneath us
    const step = tour.step;
    const el = step.target ? document.querySelector(step.target) : null;
    card.style.bottom = '';
    spot.classList.toggle('empty', !el); // no outline without a target: a 0×0 box would paint as a dot
    if (!el) {
      // No target (welcome step, or the element isn't on screen): dim everything, just show the card.
      Object.assign(spot.style, { left: '50%', top: '38%', width: '0px', height: '0px' });
      return;
    }
    const pad = 8;
    const fixed = !!el.closest('.tabbar');
    let r = el.getBoundingClientRect();
    if (!fixed) {
      // Keep the element above the card (measured, so the home indicator inset counts): scroll it, instantly.
      const dy = scrollToClear(r, card.getBoundingClientRect().top, { pad, minTop: minTop(), context: 28 });
      if (dy) {
        scrollBy({ top: dy, behavior: 'instant' });
        r = el.getBoundingClientRect();
      }
    } else {
      card.style.bottom = `${innerHeight - r.top + 14}px`; // the card sits just above the tab bar
    }
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  async function show() {
    const step = tour.step;
    q('[data-count]').textContent = `Step ${tour.index + 1} of ${tour.count}`;
    q('[data-dots]').innerHTML = TOUR_STEPS.map((_, i) => `<i class="${i === tour.index ? 'on' : ''}"></i>`).join('');
    q('#tour-title').textContent = step.title;
    q('#tour-body').textContent = step.body;
    q('[data-back]').hidden = tour.first;
    q('[data-next]').textContent = tour.last ? 'Got it' : 'Next';
    if (step.route && currentRoute() !== step.route) location.hash = `#/${step.route}`;
    const at = tour.index;
    if (step.target) await waitFor(step.target);
    else await pause(0);
    if (!active || at !== tour.index) return; // moved on while the screen was loading
    place();
    (lastInput === 'key' ? q('[data-next]') : card).focus({ preventScroll: true });
  }

  const onKey = (e) => {
    lastInput = 'key';
    if (e.key === 'Escape') { e.preventDefault(); tour.skip(); } else if (e.key === 'ArrowRight') { tour.next(); if (!tour.ended) show(); } else if (e.key === 'ArrowLeft') { tour.back(); show(); } else if (e.key === 'Tab') {
      const btns = [...root.querySelectorAll('button:not([hidden])')];
      const i = btns.indexOf(document.activeElement);
      e.preventDefault();
      btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus({ preventScroll: true });
    }
  };
  const observer = new MutationObserver(schedule); // a screen re-rendering under us: find the element again
  const main = document.querySelector('main');

  function close() {
    if (!active) return;
    active = null;
    cancelAnimationFrame(raf);
    observer.disconnect();
    removeEventListener('resize', schedule);
    removeEventListener('scroll', schedule);
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onPointer, true);
    inertEls.forEach((e) => { e.inert = false; });
    document.body.classList.remove('tour-on');
    root.remove();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
  }

  q('[data-next]').onclick = () => { tour.next(); if (!tour.ended) show(); };
  q('[data-back]').onclick = () => { tour.back(); show(); };
  q('[data-skip]').onclick = () => tour.skip();

  active = { close };
  document.body.appendChild(root);
  document.body.classList.add('tour-on');
  inertEls.forEach((e) => { e.inert = true; });
  addEventListener('resize', schedule);
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onPointer, true);
  if (main) observer.observe(main, { childList: true, subtree: true });
  try {
    await show();
  } catch (e) {
    close(); // never leave Today inert behind a failed step
    throw e;
  }
}
