// Press and drag across a chart to read it (Apple Health / Withings style). The maths is in scrubmath.js; the SVG
// layers come from scrubLayer(), the readout row from scrubBar(), and bindScrub() wires pointer events to them.
import { formatDay } from '../ui.js';
import { tick } from './haptic.js';
import { icon } from './icons.js';
import { labelPlace, tickGate, scrubIntent, isFlick, stepIndex, spokenPoint } from './scrubmath.js';

/** The scrub line, enlarged dot and floating label, hidden until bindScrub() lights them. y1/y2: the line's extent in the viewBox. */
export function scrubLayer(y1, y2) {
  return `<g class="scrub"><line y1="${y1}" y2="${y2}" class="scrub-line"/><circle r="11" class="scrub-halo"/><circle r="6.5" class="scrub-dot"/></g>
    <g class="scrub-pill" pointer-events="none"><rect rx="9" height="22"/><text y="15" text-anchor="middle"/><text class="scrub-sub" y="31" text-anchor="middle"/></g>`;
}

/** The readout row under a chart: earlier / later arrows (44 px targets) around the line that says what is selected. */
export function scrubBar(idle = 'Touch and drag the chart to read a day.') {
  const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<div class="scrub-bar"><button type="button" class="icon-btn scrub-step prev" data-scrub-prev aria-label="Earlier reading">${icon('chev')}</button><p class="small muted chart-readout" data-readout aria-live="polite">${attr(idle)}</p><button type="button" class="icon-btn scrub-step" data-scrub-next aria-label="Later reading">${icon('chev')}</button></div>`;
}

/** Index of the point nearest to x (points sorted by x). Pure. */
export function nearestIndex(xs, x) {
  if (!xs.length) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid; else hi = mid; }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}

/**
 * Press and drag across a chart to read it: a line follows the finger, snapping to the nearest reading with a bigger
 * dot and a floating label ("209.1 lb · Oct 15" over the trend). The label also goes in `readout`. A tick on each snap;
 * lifting fades the line out. A finger starts scrubbing on a horizontal move or a long press, so the page still scrolls
 * (a mouse starts at once). A quick long swipe calls `onPan(-1 | 1)` (earlier / later); the arrows beside `readout`
 * ([data-scrub-prev] / [data-scrub-next]) step one reading and call it too when they run off the end. The SVG becomes
 * an adjustable slider for VoiceOver (swipe up/down) and arrow keys. Pointer events only. Returns an unbind.
 * Point tuples: [x, y, day, text, trendText?]. Options: dayText, onPan, onSelect(i | null), slider (default true).
 */
export function bindScrub(svg, readout, { dayText = (d) => formatDay(d, { month: 'short', day: 'numeric' }), onPan = null, onSelect = null, slider = true } = {}) {
  if (!svg || !svg.dataset.scrub) return () => {};
  let pts;
  try { pts = JSON.parse(svg.dataset.scrub); } catch { return () => {}; }
  if (!pts.length) return () => {};
  const xs = pts.map((p) => p[0]);
  const g = svg.querySelector('.scrub');
  const ln = g && g.querySelector('line');
  const dot = g && g.querySelector('.scrub-dot');
  const halo = g && g.querySelector('.scrub-halo');
  const idle = readout ? readout.textContent : '';
  const pill = svg.querySelector('.scrub-pill');
  const pillBox = pill && pill.querySelector('rect');
  const [pillText, pillSub] = pill ? pill.querySelectorAll('text') : [];
  const host = svg.parentElement;
  const prevBtn = host && host.querySelector('[data-scrub-prev]');
  const nextBtn = host && host.querySelector('[data-scrub-next]');
  const gate = tickGate(35);
  const vbW = svg.viewBox.baseVal.width;
  let sel = null;
  let active = false;
  let down = null; // { id, x, y, t, touch, last }
  let hold = 0;
  let moved = false; // a scrub just happened: swallow the click that follows so a card link doesn't open
  const label = (i) => { const [, , day, text] = pts[i]; return `${text} · ${dayText(day)}`; };
  // The floating label lives inside the SVG, so showing it never reflows the card.
  const place = (px, py, main, sub) => {
    pillText.textContent = main;
    pillSub.textContent = sub || '';
    const measure = (t, s) => (t.getComputedTextLength ? t.getComputedTextLength() : 0) || s.length * 6.5;
    const w = Math.min(Math.max(measure(pillText, main), sub ? measure(pillSub, sub) : 0) + 18, vbW - 8);
    const h = sub ? 38 : 22;
    const { x, y } = labelPlace({ px, py, w, h, minX: 4, maxX: vbW - 4, minY: 2, gap: 14 });
    pillBox.setAttribute('x', x.toFixed(1)); pillBox.setAttribute('y', y.toFixed(1)); pillBox.setAttribute('width', w.toFixed(1)); pillBox.setAttribute('height', h);
    pillText.setAttribute('x', (x + w / 2).toFixed(1)); pillText.setAttribute('y', (y + 15).toFixed(1));
    pillSub.setAttribute('x', (x + w / 2).toFixed(1)); pillSub.setAttribute('y', (y + 31).toFixed(1));
    pill.classList.add('on');
  };
  const showAt = (i) => {
    if (i < 0) return;
    const [px, py, day, text, trend] = pts[i];
    const changed = i !== sel;
    sel = i;
    if (g) {
      g.classList.add('on');
      ln.setAttribute('x1', px); ln.setAttribute('x2', px);
      for (const c of [dot, halo]) if (c) { c.setAttribute('cx', px); c.setAttribute('cy', py); }
    }
    const full = label(i);
    if (readout) readout.textContent = trend ? `${full} · ${trend}` : full;
    if (pill) place(px, py, full, trend || '');
    if (slider) { svg.setAttribute('aria-valuenow', String(i)); svg.setAttribute('aria-valuetext', spokenPoint(dayText(day), text, trend)); }
    if (changed && onSelect) onSelect(i);
    if (changed && gate(i, performance.now())) tick();
  };
  const fromEvent = (ev) => {
    const box = svg.getBoundingClientRect();
    return nearestIndex(xs, ((ev.clientX - box.left) / box.width) * svg.viewBox.baseVal.width);
  };
  const fade = () => { if (g) g.classList.remove('on'); if (pill) pill.classList.remove('on'); };
  const clear = () => { fade(); sel = null; if (readout) readout.textContent = idle; if (onSelect) onSelect(null); };
  const begin = (ev) => {
    active = true;
    moved = true;
    try { svg.setPointerCapture(down.id); } catch { /* synthetic events have no live pointer */ }
    showAt(fromEvent(ev));
  };
  const onDown = (ev) => {
    if (ev.pointerType === 'mouse' && ev.button) return;
    const touch = ev.pointerType === 'touch';
    down = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), touch, last: ev };
    moved = false;
    clearTimeout(hold);
    if (!touch) return begin(ev);
    hold = setTimeout(() => { if (down && !active) begin(down.last); }, 380); // long press: scrub without moving
  };
  const onMove = (ev) => {
    if (!down || ev.pointerId !== down.id) return;
    down.last = ev;
    if (active) return showAt(fromEvent(ev));
    const intent = scrubIntent({ dx: ev.clientX - down.x, dy: ev.clientY - down.y, ms: performance.now() - down.t, touch: down.touch });
    if (intent === 'scroll') { clearTimeout(hold); down = null; return; }
    if (intent === 'scrub') { clearTimeout(hold); begin(ev); }
  };
  const onUp = (ev) => {
    clearTimeout(hold);
    if (!down || ev.pointerId !== down.id) return;
    const was = active;
    const dx = ev.clientX - down.x;
    const ms = performance.now() - down.t;
    active = false;
    down = null;
    if (!was) return;
    try { svg.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    if (ev.type === 'pointerup' && onPan && isFlick({ dx, ms })) { clear(); onPan(dx > 0 ? -1 : 1); return; } // dragging right pulls earlier dates in
    fade();
    if (onSelect) onSelect(null);
  };
  const step = (dir) => {
    const r = stepIndex(sel, dir, pts.length);
    if (r.edge && onPan && sel === (r.edge < 0 ? 0 : pts.length - 1)) { clear(); onPan(r.edge); return; }
    if (r.i != null) showAt(r.i);
  };
  const onKey = (ev) => {
    const dir = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[ev.key];
    if (dir) { ev.preventDefault(); step(dir); }
    else if (ev.key === 'Home') { ev.preventDefault(); showAt(0); }
    else if (ev.key === 'End') { ev.preventDefault(); showAt(pts.length - 1); }
    else if (ev.key === 'Escape') clear();
  };
  const eat = (ev) => { if (moved) { ev.stopPropagation(); ev.preventDefault(); moved = false; } };
  const noScroll = (ev) => { if (active && ev.cancelable) ev.preventDefault(); }; // after a long press the page must not start scrolling under the finger
  const noMenu = (ev) => ev.preventDefault();
  const prevClick = () => step(-1);
  const nextClick = () => step(1);
  let unbind = () => {};
  const outside = (ev) => {
    if (!svg.isConnected) return unbind(); // the screen changed: stop listening
    const arrow = ev.target.closest && ev.target.closest('[data-scrub-prev],[data-scrub-next]');
    if (!svg.contains(ev.target) && !arrow) clear();
  };
  svg.style.touchAction = 'pan-y'; // vertical scrolling still works; horizontal drags scrub
  if (slider) {
    const lastPt = pts[pts.length - 1];
    svg.setAttribute('role', 'slider');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-roledescription', 'chart, adjustable');
    svg.setAttribute('aria-valuemin', '0');
    svg.setAttribute('aria-valuemax', String(pts.length - 1));
    svg.setAttribute('aria-valuenow', String(pts.length - 1));
    svg.setAttribute('aria-valuetext', spokenPoint(dayText(lastPt[2]), lastPt[3], lastPt[4]));
    svg.addEventListener('keydown', onKey);
  }
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('touchmove', noScroll, { passive: false });
  svg.addEventListener('contextmenu', noMenu);
  svg.addEventListener('click', eat, true);
  if (prevBtn) prevBtn.addEventListener('click', prevClick);
  if (nextBtn) nextBtn.addEventListener('click', nextClick);
  document.addEventListener('pointerdown', outside);
  unbind = () => {
    clearTimeout(hold);
    svg.removeEventListener('keydown', onKey);
    svg.removeEventListener('pointerdown', onDown);
    svg.removeEventListener('pointermove', onMove);
    svg.removeEventListener('pointerup', onUp);
    svg.removeEventListener('pointercancel', onUp);
    svg.removeEventListener('touchmove', noScroll);
    svg.removeEventListener('contextmenu', noMenu);
    svg.removeEventListener('click', eat, true);
    if (prevBtn) prevBtn.removeEventListener('click', prevClick);
    if (nextBtn) nextBtn.removeEventListener('click', nextClick);
    document.removeEventListener('pointerdown', outside);
  };
  return unbind;
}
