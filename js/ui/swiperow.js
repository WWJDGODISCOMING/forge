// Swipe-to-delete rows (Mail / Health style): drag a row left to show a red Delete, a long swipe deletes.
// bindSwipeRows(root, { rows, onDelete, onRemoved }): onDelete(li) -> boolean|Promise (false = keep, the row springs closed),
// then the row collapses and onRemoved(li) does the actual removal. Touch/pen only; the web keeps its buttons.
import { velocityOf } from './gesture.js';
import { swipeAxis, inEdgeZone, swipeTravel, pastLong, swipeRelease } from './swipemath.js';
import { animateSpring, SHEET } from './spring.js';
import { reducedMotion } from './motion.js';
import { haptics } from './haptic.js';
import { icon } from './icons.js';

const COLLAPSE = { stiffness: 380, damping: 2 * Math.sqrt(380), mass: 1 }; // critical: no bounce below zero height
const OPEN_W = 96; // the Delete action's width when snapped open (>= 44 pt tap target)

let openRow = null; // the one row that is snapped open
let swallow = false; // eat the click that follows a drag or a tap that only closed a row
const swallowSoon = () => { swallow = true; setTimeout(() => { swallow = false; }, 350); };

const kids = (li) => [...li.children].filter((c) => !c.classList.contains('swipe-act'));

function paint(li, travel) {
  const x = -travel;
  for (const c of kids(li)) c.style.transform = travel ? `translateX(${x}px)` : '';
  const act = li.querySelector('.swipe-act');
  if (act) {
    act.style.transform = `translateX(${100 + (x / (li.offsetWidth || 1)) * 100}%)`;
    act.style.pointerEvents = travel > 8 ? 'auto' : 'none';
  }
}

function settle(li, from, to, velocity = 0, onDone) {
  if (reducedMotion()) { paint(li, to); onDone?.(); return { stop: () => ({ value: to, velocity: 0 }) }; }
  return animateSpring({ from, to, velocity: -velocity, params: SHEET, onUpdate: (v) => paint(li, v), onDone });
}

function setOpen(li, open) {
  const act = li.querySelector('.swipe-act');
  if (act) { act.tabIndex = open ? 0 : -1; act.setAttribute('aria-hidden', open ? 'false' : 'true'); }
  li.classList.toggle('swipe-open', open);
}

function closeRow(li, velocity = 0) {
  if (!li) return;
  const cur = li._travel ?? 0;
  if (openRow === li) openRow = null;
  setOpen(li, false);
  li._anim?.stop();
  li._anim = settle(li, cur, 0, velocity, () => li.classList.remove('swiping'));
  li._travel = 0;
}

function collapse(li, done) {
  if (reducedMotion()) {
    const a = li.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    if (a) a.onfinish = done; else done();
    return;
  }
  const cs = getComputedStyle(li);
  const h = li.offsetHeight;
  const pt = parseFloat(cs.paddingTop) || 0;
  const pb = parseFloat(cs.paddingBottom) || 0;
  li.style.height = `${h}px`;
  li.style.minHeight = '0';
  li.style.overflow = 'hidden';
  li.style.pointerEvents = 'none';
  animateSpring({
    from: h, to: 0, params: COLLAPSE,
    onUpdate: (v) => {
      const k = Math.max(0, v / h);
      li.style.height = `${Math.max(0, v)}px`;
      li.style.paddingTop = `${pt * k}px`;
      li.style.paddingBottom = `${pb * k}px`;
      li.style.opacity = String(Math.min(1, k * 1.5));
    },
    onDone: done,
  });
}

export function bindSwipeRows(root, { rows = 'li', onDelete, onRemoved, label = 'Delete', buzz = true }) {
  const rowW = (li) => li.offsetWidth;

  async function remove(li) {
    if (buzz) haptics.warning(); // a confirm sheet buzzes on its own Delete
    const w = rowW(li);
    li._anim?.stop();
    li._busy = true;
    li.classList.add('swiping');
    const from = li._travel ?? 0;
    // keep the Delete showing while we check (a confirm sheet; nothing for Undo-able deletes)
    const hold = Math.max(from, OPEN_W);
    li._anim = settle(li, from, hold);
    li._travel = hold;
    let ok = false;
    try { ok = await onDelete(li); } catch { ok = false; }
    li._busy = false;
    if (!ok || !li.isConnected) { closeRow(li); return; }
    if (openRow === li) openRow = null;
    li._anim?.stop();
    li._anim = settle(li, li._travel, w, 0, () => collapse(li, () => onRemoved?.(li)));
    li._travel = w;
  }

  for (const li of root.querySelectorAll(rows)) {
    li.classList.add('swipe-row');
    li._travel = 0;
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'swipe-act';
    act.tabIndex = -1;
    act.setAttribute('aria-hidden', 'true'); // VoiceOver uses the row's own delete (button, or the edit sheet)
    act.innerHTML = `<span>${icon('trash', { size: 22 })}${label}</span>`;
    act.addEventListener('click', (e) => { e.stopPropagation(); if (!li._busy) remove(li); });
    li.append(act);
    paint(li, 0);

    let sx = 0, sy = 0, base = 0, axis = null, tracking = false, samples = [], crossed = false, id = null;
    li.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || li._busy || e.target.closest('.swipe-act')) return;
      if (inEdgeZone(e.clientX)) return;
      sx = e.clientX; sy = e.clientY; axis = null; tracking = true; id = e.pointerId; crossed = false;
      li._anim?.stop();
      base = li._travel ?? 0;
      samples = [{ t: e.timeStamp, v: e.clientX }];
    });
    li.addEventListener('pointermove', (e) => {
      if (!tracking || e.pointerId !== id) return;
      const dx = e.clientX - sx;
      if (!axis) {
        axis = swipeAxis(dx, e.clientY - sy);
        if (axis === 'v') { tracking = false; return; }
        if (axis !== 'h') return;
        if (openRow && openRow !== li) closeRow(openRow);
        try { li.setPointerCapture(id); } catch { /* ignore */ }
        li.classList.add('swiping');
      }
      if (reducedMotion()) return; // no drag; a swipe still opens on release
      samples.push({ t: e.timeStamp, v: e.clientX });
      if (samples.length > 8) samples.shift();
      const travel = swipeTravel(base, dx, rowW(li));
      li._travel = travel;
      paint(li, travel);
      const past = pastLong(travel, rowW(li));
      if (past && !crossed) haptics.select();
      crossed = past;
    });
    const end = (e, cancelled) => {
      if (!tracking || e.pointerId !== id) return;
      tracking = false;
      if (axis !== 'h') return;
      swallowSoon();
      const width = rowW(li);
      const travel = reducedMotion() ? swipeTravel(base, e.clientX - sx, width) : (li._travel ?? 0);
      const v = cancelled ? 0 : velocityOf(samples);
      const r = cancelled ? (base > 0 ? 'open' : 'closed') : swipeRelease({ travel, velocity: v, width, openW: OPEN_W });
      if (r === 'delete') { li._travel = Math.max(travel, 0); remove(li); return; }
      if (r === 'open') {
        if (openRow && openRow !== li) closeRow(openRow);
        openRow = li;
        setOpen(li, true);
        li._anim = settle(li, Math.max(0, travel), OPEN_W, v);
        li._travel = OPEN_W;
      } else closeRow(li, v);
    };
    li.addEventListener('pointerup', (e) => end(e, false));
    li.addEventListener('pointercancel', (e) => end(e, true));
  }

  // A tap on an open row only closes it; a click right after a drag is not a tap.
  root.addEventListener('click', (e) => {
    if (e.target.closest('.swipe-act')) return;
    if (swallow) { e.preventDefault(); e.stopPropagation(); return; }
    const li = e.target.closest('.swipe-row');
    if (li && li === openRow) { e.preventDefault(); e.stopPropagation(); closeRow(li); }
  }, true);
}

// One set of global listeners: tapping elsewhere or scrolling closes the open row.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (openRow && !openRow.contains(e.target)) { closeRow(openRow); swallowSoon(); }
  }, true);
  window.addEventListener('scroll', () => { if (openRow) closeRow(openRow); }, { capture: true, passive: true });
}
