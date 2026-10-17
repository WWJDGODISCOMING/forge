// A damped spring solver. The maths (step) has no DOM, so it is unit-tested; animateSpring drives it with requestAnimationFrame.
// Units: value in px (or any unit), velocity in units per ms (the same unit velocityOf() in gesture.js returns).

/** Slightly under-damped (damping ratio about 0.92), so a flick settles with a tiny bounce. */
export const SHEET = { stiffness: 380, damping: 36, mass: 1 };

const SUB_MS = 1; // fixed sub-step: stable and frame-rate independent (60 Hz and 120 Hz land in the same place)
const MAX_FRAME_MS = 64; // a stalled tab doesn't fast-forward the spring

/** Advance by dtMs. Returns { value, velocity, done }; once done the value is snapped exactly to the target. */
export function step(state, target, dtMs, params = SHEET, { distance = 0.4, speed = 0.005 } = {}) {
  const { stiffness, damping, mass } = params;
  let x = state.value;
  let v = state.velocity; // units/ms
  let left = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
  while (left > 0) {
    const h = Math.min(SUB_MS, left);
    // F = -k x - c v, in seconds: a (units/s^2) = F / m. Convert to units/ms^2 by / 1e6, and c*v with v in units/s.
    const a = (-stiffness * (x - target) - damping * v * 1000) / mass / 1e6;
    v += a * h; // semi-implicit Euler: velocity first, then position
    x += v * h;
    left -= h;
  }
  if (Math.abs(x - target) < distance && Math.abs(v) < speed) return { value: target, velocity: 0, done: true };
  return { value: x, velocity: v, done: false };
}

/**
 * Runs a spring from `from` to `to`. Returns { stop() }: stop() cancels and returns the current { value, velocity }
 * so a gesture can take over mid-flight. onDone fires once, only if the spring settled (not after stop()).
 */
export function animateSpring({ from, to, velocity = 0, params = SHEET, onUpdate, onDone }) {
  let s = { value: from, velocity };
  let last = null;
  let raf = 0;
  let live = true;
  const frame = (now) => {
    if (!live) return;
    const dt = last == null ? 16 : now - last;
    last = now;
    const r = step(s, to, dt, params);
    s = { value: r.value, velocity: r.velocity };
    onUpdate?.(s.value, s.velocity);
    if (r.done) { live = false; onDone?.(); return; }
    raf = requestAnimationFrame(frame);
  };
  onUpdate?.(from, velocity);
  raf = requestAnimationFrame(frame);
  return {
    stop() {
      if (live) { live = false; cancelAnimationFrame(raf); }
      return { value: s.value, velocity: s.velocity };
    },
  };
}

const TRACK_MS = 1000 / 120; // one sample per 120 Hz frame

/**
 * Precomputes the whole spring path so it can play as an accelerated (compositor) animation.
 * Returns { values, velocities, dt, duration }: one sample per dt ms. With `reach`, the track ends the moment it
 * gets to that value (so an exit finishes when the sheet is off-screen, not after the 0.4 px tail).
 */
export function springTrack(from, to, velocity = 0, params = SHEET, { reach } = {}) {
  const values = [from];
  const velocities = [velocity];
  const dir = to >= from ? 1 : -1;
  let s = { value: from, velocity };
  for (let i = 0; i < 1200; i++) { // 10 s at most
    const r = step(s, to, TRACK_MS, params);
    s = { value: r.value, velocity: r.velocity };
    values.push(s.value);
    velocities.push(s.velocity);
    if (r.done || (reach != null && (s.value - reach) * dir >= 0)) break;
  }
  return { values, velocities, dt: TRACK_MS, duration: (values.length - 1) * TRACK_MS };
}

/** Value and velocity (units/ms) of a track at time tMs, interpolated between samples. */
export function trackAt(track, tMs) {
  const last = track.values.length - 1;
  if (last < 1) return { value: track.values[0], velocity: track.velocities[0] };
  const f = Math.min(Math.max(tMs / track.dt, 0), last);
  const i = Math.min(Math.floor(f), last - 1);
  const k = f - i;
  return {
    value: track.values[i] + (track.values[i + 1] - track.values[i]) * k,
    velocity: track.velocities[i] + (track.velocities[i + 1] - track.velocities[i]) * k,
  };
}

/**
 * Plays a spring on `el` as a transform animation. This runs on the compositor, so it reaches 120 Hz on iPhone
 * (requestAnimationFrame is capped at 60 Hz in WKWebView) and doesn't stutter when JS is busy. onUpdate(value, velocity)
 * still fires each frame for things that follow along (the backdrop). Falls back to the rAF driver without el.animate.
 * Same contract as animateSpring: stop() returns { value, velocity } and leaves onUpdate(value) as the last write.
 */
export function playSpring({ el, from, to, velocity = 0, params = SHEET, reach, onUpdate, onDone }) {
  if (!el || typeof el.animate !== 'function') return animateSpring({ from, to, velocity, params, onUpdate, onDone });
  const track = springTrack(from, to, velocity, params, { reach });
  const anim = el.animate(track.values.map((y) => ({ transform: `translateY(${y}px)` })), {
    duration: track.duration, easing: 'linear', fill: 'forwards',
  });
  let live = true;
  let raf = 0;
  let rest = { value: from, velocity };
  const read = () => trackAt(track, anim.currentTime ?? track.duration);
  const tick = () => {
    if (!live) return;
    rest = read();
    onUpdate?.(rest.value, rest.velocity);
    raf = requestAnimationFrame(tick);
  };
  onUpdate?.(from, velocity);
  raf = requestAnimationFrame(tick);
  anim.onfinish = () => {
    if (!live) return;
    live = false;
    cancelAnimationFrame(raf);
    rest = trackAt(track, track.duration);
    onUpdate?.(rest.value, rest.velocity);
    onDone?.();
    anim.cancel();
  };
  return {
    stop() {
      if (live) {
        live = false;
        cancelAnimationFrame(raf);
        rest = read();
        onUpdate?.(rest.value, rest.velocity); // the inline value takes over from the animation
        anim.cancel();
      }
      return { value: rest.value, velocity: rest.velocity };
    },
  };
}
