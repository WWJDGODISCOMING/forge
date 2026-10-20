// Edge swipe-back for detail screens: drag from the left 20px of the screen and the current screen follows your
// finger over a dim scrim that lightens as it slides; let go past 40% of the width (or flick right) and it pops,
// otherwise it springs back. Reduced motion: no drag at all (like the sheets); a swipe past the threshold just
// pops, with the router's crossfade.
import { shouldPop, velocityOf, scrimOpacity, parallaxOffset } from './gesture.js';
import { reducedMotion, EASE, DUR } from './motion.js';

const EDGE = 20;

// What shows behind the sliding screen: a snapshot of the parent screen (its markup, kept by the router when you pushed
// into this one) with a dim scrim on it. With no snapshot it's a plain surface layer under the scrim.
function makeUnderlay(snap) {
  const u = document.createElement('div');
  u.className = 'swipe-under';
  u.setAttribute('aria-hidden', 'true');
  // The parent screen as it was when you left it (one level kept by the router), sliding in from -30% like iOS.
  u.innerHTML = (snap ? '<div class="snap-wrap"><main class="snap" inert></main></div>' : '') + '<i></i>';
  if (snap) {
    const m = u.querySelector('main.snap');
    m.innerHTML = snap.html;
    m.style.transform = `translateY(${-(snap.scroll || 0)}px)`;
  }
  document.body.prepend(u);
  return u;
}

/**
 * attachSwipeBack({ el, canSwipe, onPop })
 *  el        the element that moves (main)
 *  canSwipe  () => boolean, true on detail screens (never on the guided workout)
 *  onPop     ({ crossfade }) => Promise|void, called after the slide-out finishes (crossfade: true under reduced
 *            motion, where nothing slid, so navigate with the normal transition)
 */
export function attachSwipeBack({ el, canSwipe, onPop, getSnapshot = () => null }) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let tracking = false;
  let horizontal = false;
  let samples = [];
  let under = null;

  const reset = () => {
    tracking = false;
    horizontal = false;
    samples = [];
  };

  const setScrim = (x) => {
    if (!under) return;
    under.querySelector('i').style.opacity = scrimOpacity(x, window.innerWidth);
    const wrap = under.querySelector('.snap-wrap');
    if (wrap) wrap.style.transform = `translateX(${parallaxOffset(x, window.innerWidth)}%)`;
  };

  document.addEventListener('touchstart', (e) => {
    reset();
    if (e.touches.length !== 1 || !canSwipe() || document.querySelector('dialog[open]')) return;
    const t = e.touches[0];
    if (t.clientX > EDGE) return;
    tracking = true;
    startX = t.clientX;
    startY = t.clientY;
    dx = 0;
    samples = [{ t: e.timeStamp, v: t.clientX }];
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return reset(); // it's a scroll
      if (dx > 8) horizontal = true;
      else return;
    }
    samples.push({ t: e.timeStamp, v: t.clientX });
    if (reducedMotion()) return; // no drag: only the release counts
    e.preventDefault(); // we own the gesture now: stop the page scrolling
    if (!under) {
      under = makeUnderlay(getSnapshot());
      el.style.setProperty('--amb-top', `${-el.getBoundingClientRect().top}px`);
      el.classList.add('swiping');
    }
    setScrim(Math.max(0, dx));
    el.style.transition = 'none';
    el.style.transform = `translateX(${Math.max(0, dx)}px)`;
  }, { passive: false });

  const end = () => {
    if (!tracking) return;
    const moved = horizontal;
    const width = window.innerWidth;
    const pop = moved && shouldPop({ dx, velocity: velocityOf(samples), width });
    reset();
    if (!moved) return;
    if (reducedMotion()) {
      if (pop) onPop({ crossfade: true });
      return;
    }
    el.style.transition = `transform ${DUR.med}ms ${EASE.spring}`;
    el.style.transform = pop ? `translateX(${width}px)` : 'translateX(0)';
    if (under) {
      under.querySelector('i').style.transition = `opacity ${DUR.med}ms ${EASE.spring}`;
      const wrap = under.querySelector('.snap-wrap');
      if (wrap) wrap.style.transition = `transform ${DUR.med}ms ${EASE.spring}`;
      setScrim(pop ? width : 0);
    }
    const clear = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.classList.remove('swiping');
      el.style.removeProperty('--amb-top');
      if (under) under.remove();
      under = null;
    };
    // On a pop the old screen stays off to the right until the previous screen has been drawn.
    const done = () => (pop ? Promise.resolve(onPop({ crossfade: false })).finally(clear) : clear());
    setTimeout(done, DUR.med + 20);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}
