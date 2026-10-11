// Folding or rotating the phone resizes the page under the reader. Remember the card at the top of the screen (and how far
// below the bar it sat) while scrolling, and put it back at the same spot after a size change, so the page doesn't jump.
// Nothing is re-rendered: this only nudges the scroll position.
let anchor = null; // { el, top }

const insetTop = () => {
  const bar = document.querySelector('.navbar');
  const r = bar && bar.getBoundingClientRect();
  return r && r.height ? Math.max(0, r.bottom) : 0;
};

/** The first card or section whose bottom edge is still below the nav bar. */
export function pickAnchor(root = document.getElementById('main')) {
  if (!root) return null;
  const inset = insetTop();
  for (const el of root.querySelectorAll('.card, .slot, section, h1, h2')) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > inset + 1) return { el, top: r.top };
  }
  return null;
}

export function captureAnchor() {
  anchor = pickAnchor();
}

/** Scroll so the remembered element is where it was; no-op if it left the page. */
export function restoreAnchor() {
  if (!anchor || !anchor.el.isConnected) { captureAnchor(); return; }
  const dy = anchor.el.getBoundingClientRect().top - anchor.top;
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'instant' });
  captureAnchor();
}

export function setupResizeAnchor() {
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; captureAnchor(); }); };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('hashchange', () => { anchor = null; setTimeout(captureAnchor, 400); });
  let t = 0;
  addEventListener('resize', () => { restoreAnchor(); clearTimeout(t); t = setTimeout(restoreAnchor, 120); }); // again once media-query layouts have settled
  setTimeout(captureAnchor, 400);
}
