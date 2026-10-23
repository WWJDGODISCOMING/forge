// Shared timer helpers: screen wake lock, clock formatting, and the rest timer.
// Timers run from timestamps, not tick counts, so they stay accurate if the phone stutters or the app is
// backgrounded (iPhone freezes web timers while locked; when you come back the time is still right).
// The rest timer can pause (with the workout) and carries a "next up" preview for the full-screen rest.
import { unlockAudio as unlock, beep as coachBeep, coach } from './ui/sound.js';
import { haptics } from './ui/haptic.js';
import { countdownSecond } from './ui/restring.js';
import { syncRestNotification, haptic as nativeHaptic } from './native/bridge.js';

export const unlockAudio = unlock;

/** Kept for older callers: a coach beep. */
export function beep({ freq = 880, ms = 160 } = {}) {
  coachBeep(freq, ms);
}

export function buzz(pattern = [200, 100, 200]) {
  if (nativeHaptic('success')) return; // the iPhone app: a real "done" buzz
  if (navigator.vibrate) navigator.vibrate(pattern); // ignored on iPhone; see js/ui/haptic.js for the switch trick
}

// ---------- wake lock (installed web apps on iOS 18.4+) ----------
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}
// iOS drops the wake lock when the app goes to the background; take it back when we return. If a request
// fails (iOS sometimes refuses one that isn't tied to a tap), try again on the next tap.
let wantAwake = false;
let pausedSleep = false; // paused for a while: let the screen sleep until Resume
let pauseTimer = null;
const shouldBeAwake = () => wantAwake && !pausedSleep;
export function setWantAwake(v) {
  wantAwake = v;
  if (!v) {
    pausedSleep = false;
    clearTimeout(pauseTimer);
  }
  keepAwake(shouldBeAwake());
}
/** Workout paused: keep the screen on for 5 minutes, then let it sleep. */
export function pauseAwake(ms = 5 * 60000) {
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => {
    pausedSleep = true;
    keepAwake(false);
  }, ms);
}
/** Workout resumed: screen on again. */
export function resumeAwake() {
  clearTimeout(pauseTimer);
  pausedSleep = false;
  keepAwake(shouldBeAwake());
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && shouldBeAwake()) keepAwake(true);
});
document.addEventListener('pointerdown', () => {
  if (shouldBeAwake() && !wakeLock) keepAwake(true);
}, { capture: true, passive: true });

export const fmtClock = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- rest timer ----------
// rest = { end, total, label, next: { name, detail } | null, pausedLeft: ms | null, said10, ticked }
let rest = null;
let tick = null;
// The rest timer survives the app being closed: its end time is saved on every change and restored on
// launch (app.js drops it if no workout is running). A rest that ran out while closed just ends quietly.
const REST_KEY = 'forge.rest';
function persistRest() {
  try {
    if (rest) localStorage.setItem(REST_KEY, JSON.stringify({ ...rest, next: rest.next ? { name: rest.next.name, detail: rest.next.detail } : null }));
    else localStorage.removeItem(REST_KEY);
  } catch { /* private mode */ }
}
try {
  const saved = JSON.parse(localStorage.getItem(REST_KEY) || 'null');
  if (saved && (saved.pausedLeft != null || saved.end > Date.now() + 1000)) rest = { ...saved, said10: true, ticked: -1 };
  else if (saved) localStorage.removeItem(REST_KEY);
} catch { /* ignore */ }
if (rest) setTimeout(() => run(), 0);
const listeners = new Set();
export const onRestChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

/** next: optional { name, detail, speak } for the preview card and the voice line. */
export function startRest(seconds, label = 'Rest', next = null) {
  rest = { end: Date.now() + seconds * 1000, total: seconds, label, next, pausedLeft: null, said10: seconds <= 12, ticked: -1 };
  coach.rest(seconds, next && next.speak);
  run();
}
export function adjustRest(delta) {
  if (!rest) return;
  if (rest.pausedLeft != null) rest.pausedLeft = Math.max(0, rest.pausedLeft + delta * 1000);
  else rest.end += delta * 1000;
  rest.total = Math.max(5, rest.total + delta);
  if (restRemaining() > 12) rest.said10 = false;
  run();
}
export function stopRest() {
  rest = null;
  run();
}
export function pauseRest() {
  if (!rest || rest.pausedLeft != null) return;
  rest.pausedLeft = Math.max(0, rest.end - Date.now());
  run();
}
export function resumeRest() {
  if (!rest || rest.pausedLeft == null) return;
  rest.end = Date.now() + rest.pausedLeft;
  rest.pausedLeft = null;
  run();
}
export const restRemaining = () => (rest ? (rest.pausedLeft != null ? rest.pausedLeft : rest.end - Date.now()) / 1000 : 0);
export const restInfo = () => (rest ? { ...rest, left: restRemaining(), paused: rest.pausedLeft != null } : null);

function run() {
  clearInterval(tick);
  persistRest();
  // iPhone app: a "Rest's over" notification for the lock screen, kept in step with every change (no-op on the web).
  syncRestNotification(rest && rest.pausedLeft == null ? rest.end : null, { body: rest && rest.next && rest.next.name ? `Next: ${rest.next.name}` : 'Time for your next set.' });
  render();
  if (!rest || rest.pausedLeft != null) return;
  tick = setInterval(() => {
    if (!rest) return clearInterval(tick);
    const left = restRemaining();
    if (left <= 10.2 && !rest.said10 && left > 4) {
      rest.said10 = true;
      coach.tenSeconds();
    }
    const whole = countdownSecond(left, rest.ticked);
    if (whole) {
      rest.ticked = whole;
      coachBeep(660, 90);
      haptics.light();
    }
    if (left <= 0) {
      coach.restOver();
      buzz();
      rest = null;
      clearInterval(tick);
    }
    render();
  }, 200);
}

// Small bar used by the list view. The guided player draws its own full-screen rest (body.playing hides this).
function render() {
  let bar = document.getElementById('restbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'restbar';
    bar.className = 'restbar';
    bar.setAttribute('role', 'timer');
    bar.innerHTML = `
      <div class="restfill"></div>
      <span class="restlabel"></span>
      <b class="restclock"></b>
      <div class="row gap">
        <button class="icon-btn" data-rest="-15" aria-label="15 seconds less">−15</button>
        <button class="icon-btn" data-rest="15" aria-label="15 seconds more">+15</button>
        <button class="icon-btn" data-rest="skip" aria-label="Skip rest">Skip</button>
      </div>`;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rest]');
      if (!b) return;
      if (b.dataset.rest === 'skip') stopRest();
      else adjustRest(Number(b.dataset.rest));
    });
    document.body.appendChild(bar);
  }
  document.body.classList.toggle('resting', !!rest);
  if (!rest) {
    bar.classList.remove('show');
  } else {
    const left = restRemaining();
    bar.classList.add('show');
    bar.querySelector('.restlabel').textContent = rest.pausedLeft != null ? `${rest.label} · paused` : rest.label;
    bar.querySelector('.restclock').textContent = fmtClock(left);
    bar.querySelector('.restfill').style.transform = `scaleX(${Math.max(0, Math.min(1, left / rest.total))})`;
  }
  listeners.forEach((fn) => fn(restInfo()));
}
