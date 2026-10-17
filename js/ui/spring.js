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
