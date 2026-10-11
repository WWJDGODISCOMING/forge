// Folding or rotating the phone resizes the page under the reader. Remember the card at the top of the screen (and how far
// below the bar it sat) while scrolling, and put it back at the same spot after a size change, so the page doesn't jump.
// Nothing is re-rendered: this only nudges the scroll position.
let anchor = null; // { el, top }

const insetTop = () => {
  const bar = document.querySelector('.navbar');
  const r = bar && bar.getBoundingClientRect();
  return r && r.height ? Math.max(0, r.bottom) : 0;
};

/** The card (or heading) whose top edge is closest to the bottom of the nav bar: what the reader is looking at first. */
export function pickAnchor(root = document.getElementById('main')) {
  if (!root) return null;
  const inset = insetTop();
  let best = null;
  for (const el of root.querySelectorAll('.card, h1, h2')) {
    const r = el.getBoundingClientRect();
    if (!r.height || r.bottom <= inset + 1) continue;
    const d = Math.abs(r.top - inset);
    if (!best || d < best.d) best = { el, top: r.top, d };
  }
  return best && { el: best.el, top: best.top };
}

export function captureAnchor() {
  anchor = pickAnchor();
}

const SETTLE_MS = 300;
let settleUntil = 0; // while a fold or rotation settles, keep the card picked before it started; scroll events then aren't the reader

/** Scroll so the remembered element is where it was; no-op if it left the page. Keeps the same card through the whole resize burst. */
export function restoreAnchor() {
  if (!anchor || !anchor.el.isConnected) { anchor = null; captureAnchor(); return; }
  settleUntil = Date.now() + SETTLE_MS;
  const dy = anchor.el.getBoundingClientRect().top - anchor.top;
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'instant' });
}

export function setupResizeAnchor() {
  let raf = 0, width = window.innerWidth;
  const schedule = () => {
    if (Date.now() < settleUntil || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (Date.now() >= settleUntil) captureAnchor(); });
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('hashchange', () => { anchor = null; setTimeout(captureAnchor, 400); });
  let t1 = 0, t2 = 0;
  addEventListener('resize', () => {
    if (window.innerWidth === width) return; // the keyboard opening or closing only changes the height: leave the scroll alone
    width = window.innerWidth;
    restoreAnchor();
    clearTimeout(t1); clearTimeout(t2);
    t1 = setTimeout(restoreAnchor, 120); // again once media-query layouts have settled
    t2 = setTimeout(restoreAnchor, SETTLE_MS);
  });
  setTimeout(captureAnchor, 400);
}
