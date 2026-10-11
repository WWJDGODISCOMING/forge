// Runs INSIDE the page (serialised with toString), so it must not reference anything outside itself.
// Returns a list of human-readable problems for the screen that is currently showing.
export function detect(opts = {}) {
  const problems = [];
  const vw = window.innerWidth;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (n.parentElement && n.parentElement.tagName === 'DETAILS' && !n.parentElement.open && n.tagName !== 'SUMMARY') return false; // closed disclosure
    }
    return true;
  };
  const label = (el) => {
    const t = (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}> "${t}"`;
  };
  const allowed = (el) => !!el.closest('[data-layout-ok]');
  const lines = (el) => {
    // most text lines in any one text node inside el (an icon or a second, smaller label on the same row isn't a wrap)
    let most = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const tops = new Set();
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top / 6));
      most = Math.max(most, tops.size);
    }
    return most;
  };

  // 1. Things that must stay on one line, and must not clip their text.
  const oneLine = 'button:not(.icon-btn), .btn, .chip span, .chip-btn, .pill, .seg span, .tabbar a, .rings-legend b, .stats b, .learn-more summary, .pick-text > *, .bc-tile > *, .g-text > span:first-child, .card-link, .nb-title, .tool';
  document.querySelectorAll(oneLine).forEach((el) => {
    if (!vis(el) || allowed(el)) return;
    if (el.querySelector('small, br, p') && !el.matches('.bc-tile')) return; // deliberate two-line controls
    if (el.matches('button:not(.btn):not(.chip-btn)') && el.querySelectorAll(':scope > *').length >= 2) return; // a card-like button: its labels are checked on their own
    const n = lines(el);
    if (n > 1 && !opts.largeText) problems.push(`wraps to ${n} lines: ${label(el)}`);
    else if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') problems.push(`clipped (${el.scrollWidth}>${el.clientWidth}): ${label(el)}`);
  });
  // Any ellipsis that is actually cutting text.
  document.querySelectorAll('*').forEach((el) => {
    if (el.children.length || !el.textContent.trim()) return;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && vis(el) && !allowed(el)) problems.push(`ellipsis cutting text: ${label(el)}`);
  });

  // 2. Tap targets.
  document.querySelectorAll('a[href], button, select, summary, input:not([type=hidden]), [role=button], [role=tab]').forEach((el) => {
    if (allowed(el)) return;
    if (el.matches('input[type=radio], input[type=checkbox]') && (getComputedStyle(el).opacity === '0' || el.closest('.seg, .choice, .chip'))) return; // the visible label is the target
    if (el.matches('input[type=checkbox][role=switch], input.switch')) return;
    if (!vis(el) || el.closest('svg')) return;
    if (el.matches('input[type=checkbox]') && el.closest('label, .g-row, .row') && el.closest('label, .g-row, .row').getBoundingClientRect().height >= 43.5) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight * 6) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' && el.tagName === 'A') return; // inline text link
    if (r.width < 43.5 || r.height < 43.5) problems.push(`tap target ${Math.round(r.width)}×${Math.round(r.height)}: ${label(el)}`);
  });

  // 2b. Controls must not sit on top of each other (a stepper whose + runs into its neighbour, for example).
  const hit = [...document.querySelectorAll('a[href], button, select, summary')].filter((e) => vis(e) && !e.closest('svg, #nav, #navbar, #quicklog') && !e.matches('.insight-x') && !allowed(e));
  const boxes = hit.map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.bottom > 0 && r.top < window.innerHeight * 3);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, ra] = boxes[i];
      const [b, rb] = boxes[j];
      if (a.contains(b) || b.contains(a)) continue;
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 3 && h > 3) problems.push(`controls overlap (${Math.round(w)}×${Math.round(h)}): ${label(a)} and ${label(b)}`);
    }
  }

  // 3. Page-level overflow.
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) problems.push(`page scrolls sideways (${de.scrollWidth}>${vw})`);
  document.querySelectorAll('main *').forEach((el) => {
    if (!vis(el) || allowed(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && !el.closest('[data-scroll-x], .hscroll')) problems.push(`off-screen right (${Math.round(r.right)}>${vw}): ${label(el)}`);
  });

  // 4. Last content must clear the tab bar at the bottom of the page.
  const nav = document.getElementById('nav');
  const main = document.getElementById('main');
  if (nav && !nav.hidden && main) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    let worst = null, bottom = 0;
    for (const e of main.querySelectorAll('*')) {
      if (!vis(e) || e.closest('svg') || e.closest('[data-layout-ok]')) continue;
      let fixed = false;
      for (let n = e; n && n !== document.body; n = n.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(n).position)) fixed = true;
      if (fixed) continue;
      const b = e.getBoundingClientRect().bottom;
      if (b > bottom) { bottom = b; worst = e; }
    }
    const top = nav.getBoundingClientRect().top;
    const fab = document.getElementById('quicklog');
    const fabTop = fab && fab.classList.contains('on') ? fab.getBoundingClientRect().top : top;
    if (worst && bottom > Math.min(top, fabTop) + 1) problems.push(`content runs under the tab bar (${Math.round(bottom)}>${Math.round(top)}): ${label(worst)} (scrollY ${Math.round(window.scrollY)} of ${document.documentElement.scrollHeight})`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return problems;
}
