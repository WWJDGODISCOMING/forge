// Full-screen photo viewer: the tapped thumbnail grows into place, dragging down shrinks it back (Apple Photos style).
// Springs come from js/ui/spring.js so every move can be grabbed mid-flight. Pinch-zoom is not built yet, and
// touch-action leaves the browser's own pinch free for it.
import { esc } from '../ui.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { animateSpring, SHEET } from '../ui/spring.js';
import { registerSheet } from '../ui/sheets.js';
import { velocityOf } from '../ui/gesture.js';
import { PX, containRect, morphFrame, dragAxis, shouldClosePhoto, pastThreshold, dragOffset, dragScale } from './viewmath.js';

const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
const visibleRect = (el) => {
  if (!el || !el.isConnected) return null;
  const r = rectOf(el);
  const inside = r.width > 0 && r.height > 0 && r.left < innerWidth && r.top < innerHeight && r.left + r.width > 0 && r.top + r.height > 0;
  return inside ? r : null;
};

/**
 * openViewer({ src, title, thumb, findThumb, onDelete })
 *  thumb: the tapped thumbnail button; findThumb(): looks it up again on close (the list may have redrawn).
 *  onDelete(): called after the viewer has closed; the caller keeps the confirm step.
 */
export function openViewer({ src, title, thumb, findThumb, onDelete }) {
  const root = document.createElement('div');
  root.className = 'pv';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title);
  root.innerHTML = `<div class="pv-bg"></div><div class="pv-stage"></div>
    <img class="pv-img" src="${esc(src)}" alt="${esc(title)}" draggable="false">
    <div class="pv-bar"><button class="pv-close" aria-label="Close">${icon('close', { size: 22 })}</button><p class="pv-title">${esc(title)}</p></div>
    <div class="pv-foot"><button class="btn danger-ghost" data-del-one>Delete this photo</button></div>`;
  document.body.appendChild(root);
  const bg = root.querySelector('.pv-bg');
  const img = root.querySelector('.pv-img');
  const stage = root.querySelector('.pv-stage');
  const chrome = [root.querySelector('.pv-bar'), root.querySelector('.pv-foot')];
  const thumbImg = thumb ? thumb.querySelector('img') : null;
  const calm = reduced();

  let full = { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const layout = () => {
    const nw = (thumbImg && thumbImg.naturalWidth) || img.naturalWidth;
    const nh = (thumbImg && thumbImg.naturalHeight) || img.naturalHeight;
    full = containRect(nw, nh, rectOf(stage));
    Object.assign(img.style, { left: `${full.left}px`, top: `${full.top}px`, width: `${full.width}px`, height: `${full.height}px` });
  };
  layout();
  img.addEventListener('load', () => { if (!done) { layout(); draw(); } });

  let from = visibleRect(thumb); // where the photo grows from / returns to; null = just fade
  let p = calm ? 1 : 0; // 0 at the thumbnail, 1 full screen
  let dy = 0; // current drag offset
  let dyAtRelease = 0;
  let openSpring = null; // moves p (0 thumb, 1 full)
  let dragSpring = null; // moves dy back to 0
  let unregister = null;
  let thumbRadius = 14;
  const hidden = new Set(); // thumbs hidden under the flying photo
  const hideThumb = (el) => { if (el && !calm) { el.style.visibility = 'hidden'; hidden.add(el); } };
  const stopSprings = () => {
    if (openSpring) { p = openSpring.stop().value / PX; openSpring = null; }
    if (dragSpring) { dy = dragSpring.stop().value; dragSpring = null; }
  };
  let closing = false;
  let done = false;

  if (from && !calm) {
    hideThumb(thumb);
    thumbRadius = parseFloat(getComputedStyle(thumb).borderTopLeftRadius) || thumbRadius;
  }

  const draw = () => {
    const open = Math.min(1, Math.max(0, p));
    const ds = dragScale(dy);
    if (from && !calm) {
      const f = morphFrame(from, full, open, thumbRadius);
      img.style.transform = `translate3d(${f.tx}px, ${f.ty + dy}px, 0) scale(${f.scale * ds})`;
      img.style.clipPath = `inset(${f.insetY}px ${f.insetX}px round ${f.radius}px)`;
      img.style.opacity = '1';
    } else {
      img.style.transform = `translate3d(0, ${dy}px, 0) scale(${ds})`;
      img.style.opacity = String(calm ? 1 : open);
    }
    bg.style.opacity = String(open * (1 - Math.min(1, Math.max(0, dy) / 300)));
    const chromeOpacity = String(Math.max(0, 1 - Math.max(0, dy) / 120) * open);
    chrome.forEach((c) => { c.style.opacity = chromeOpacity; c.style.pointerEvents = closing || +chromeOpacity < 0.5 ? 'none' : ''; });
  };

  function teardown() {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    if (unregister) unregister();
    root.remove();
    hidden.forEach((el) => { el.style.visibility = ''; });
    const back = (findThumb && findThumb()) || thumb;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  // Moves p to `target` on a spring (reduced motion: a plain fade). `then` runs once it settles.
  function go(target, velocity, then) {
    if (openSpring) openSpring.stop();
    if (calm) {
      root.style.transition = 'opacity .15s linear';
      root.style.opacity = String(target);
      p = target;
      draw();
      if (then) setTimeout(then, 150);
      return;
    }
    // The solver's stop rule is sized for pixels (0.4), so spring in px-sized units (p * PX) and divide.
    openSpring = animateSpring({
      from: p * PX, to: target * PX, velocity: velocity * PX, params: SHEET,
      onUpdate: (v) => { p = v / PX; if (closing) dy = dyAtRelease * Math.min(1, Math.max(0, p)); draw(); },
      onDone: then,
    });
  }

  function close(velocity = 0) {
    if (closing) return;
    closing = true;
    stopSprings();
    const back = findThumb && findThumb();
    from = visibleRect(back); // null: the thumb is gone or off-screen, so it just fades
    if (from) hideThumb(back);
    dyAtRelease = dy;
    const travel = Math.max(120, full.height * 0.4);
    go(0, -Math.max(0, velocity) / travel, teardown);
  }

  // A route change closes the viewer straight away (no morph onto the wrong screen).
  function dismissNow() { stopSprings(); closing = true; teardown(); }
  unregister = registerSheet(dismissNow);
  // Keep the edge swipe-back from reaching the page underneath.
  root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
  function onResize() { if (!done) { layout(); draw(); } }
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', onResize);

  root.querySelector('.pv-close').onclick = () => close();
  bg.onclick = () => close();
  root.querySelector('[data-del-one]').onclick = () => {
    dismissNow();
    if (onDelete) onDelete();
  };

  // Drag down to close. Grabbing mid-flight stops the spring and keeps the photo under the finger.
  let drag = null;
  img.addEventListener('pointerdown', (e) => {
    if (closing) return;
    stopSprings();
    drag = { y: e.clientY - dy, x0: e.clientX, axis: null, samples: [{ t: e.timeStamp, v: e.clientY }], over: pastThreshold(dy) };
    if (img.setPointerCapture) img.setPointerCapture(e.pointerId);
  });
  img.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rawY = e.clientY - drag.y;
    if (!drag.axis) drag.axis = dragAxis(e.clientX - drag.x0, rawY);
    if (drag.axis !== 'v') return;
    drag.samples.push({ t: e.timeStamp, v: e.clientY });
    dy = dragOffset(rawY);
    const over = pastThreshold(dy);
    if (over !== drag.over) { drag.over = over; haptics.select(); }
    draw();
  });
  const release = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const vertical = d.axis === 'v';
    const velocity = vertical ? velocityOf(d.samples) : 0;
    if (vertical && shouldClosePhoto({ dx: e.clientX - d.x0, dy, velocity })) { close(velocity); return; }
    // Anything that doesn't close settles back to full size and rest, even a tap or a sideways move mid-flight.
    stopSprings();
    if (calm) { dy = 0; draw(); return; }
    if (p !== 1) go(1, 0);
    if (dy !== 0) dragSpring = animateSpring({ from: dy, to: 0, velocity, params: SHEET, onUpdate: (v) => { dy = v; draw(); } });
  };
  img.addEventListener('pointerup', release);
  img.addEventListener('pointercancel', release);

  img.style.willChange = 'transform';
  draw();
  if (calm) { root.style.opacity = '0'; requestAnimationFrame(() => go(1, 0)); } else go(1, 0);
  haptics.light();
  root.querySelector('.pv-close').focus({ preventScroll: true });

  return { close };
}
