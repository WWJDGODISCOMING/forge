// Sound and voice coach. Everything is synthesized (Web Audio) or spoken (speechSynthesis): no audio files.
//
// iPhone notes:
// - Audio must be unlocked by a tap: call unlockAudio() from a click handler (the player does it on Start).
// - navigator.audioSession.type = 'ambient' (Safari 16.4+) makes Forge MIX with your music instead of stopping
//   it. Trade-off you chose: with the ringer switch on silent, Forge's sounds are silent too.
// - Speech is primed with a silent utterance during that first tap, because iOS only allows speech that
//   starts from a user gesture until something has been spoken.
// Settings (state.settings): audio_coach 'off' | 'beeps' | 'voice' (default 'voice'), sfx true/false (default true).
import { state } from '../state.js';
import { restPhrase } from '../workouts/session-core.js';

let ctx = null;
let master = null;
let primed = false;

const prefs = () => ({
  coach: (state.settings && state.settings.audio_coach) || 'voice',
  sfx: !state.settings || state.settings.sfx !== false,
});

/** Create the context and master chain (no speech priming) and resume it. Safe outside a gesture; it may just stay suspended. */
function ensureCtx() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== 'ambient') navigator.audioSession.type = 'ambient';
  } catch { /* not supported */ }
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      // a limiter after the master so stacked explosions can't clip
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -10;
      lim.knee.value = 6;
      lim.ratio.value = 12;
      lim.attack.value = 0.002;
      lim.release.value = 0.15;
      master.connect(lim).connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a tap handler: unlocks audio and primes speech. The prime only counts inside a real user activation. */
export function unlockAudio() {
  ensureCtx();
  const ua = typeof navigator !== 'undefined' && navigator.userActivation;
  if (ua && !ua.isActive) return; // not a gesture (Safari 16.4+): a refused prime must not mark us primed
  if (!primed && 'speechSynthesis' in window) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      primed = true;
    } catch { /* ignore */ }
  }
}

function tone({ freq = 880, type = 'sine', ms = 160, gain = 0.22, at = 0, slideTo = null, filter = null }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + ms / 1000);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  let node = o;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + ms / 1000 + 0.05);
}

let noiseBuf = null;
/** One filtered noise burst, a falling sine thump and a short sub-bass tail. Peak gains stay low so stacks don't clip. */
function explosion({ gain, burst, burstHz, thump, thumpHz, tail }) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(burstHz, t0);
  f.frequency.exponentialRampToValueAtTime(120, t0 + burst);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.4 * gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + burst);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + burst + 0.05);
  tone({ freq: thumpHz, slideTo: 38, type: 'sine', ms: thump, gain: 0.45 * gain });
  if (tail) tone({ freq: 34, type: 'sine', ms: tail, gain: 0.25 * gain, at: 0.03 });
}

// per kind: noise length (s), noise filter start (Hz), thump length (ms), thump pitch (Hz), sub-bass tail (ms)
const EXPLOSIONS = {
  pop: { burst: 0.12, burstHz: 2200, thump: 120, thumpHz: 150, tail: 0 },
  thud: { burst: 0.18, burstHz: 1200, thump: 200, thumpHz: 110, tail: 160 },
  boom: { burst: 0.4, burstHz: 1800, thump: 320, thumpHz: 90, tail: 320 },
  finale: { burst: 0.9, burstHz: 2600, thump: 600, thumpHz: 70, tail: 800 },
};

const semi = (f, n) => f * Math.pow(2, n / 12);

/** Coach beeps (count-ins, rest end). Silent when the coach is Off. */
export function beep(freq = 880, ms = 160) {
  if (prefs().coach === 'off') return;
  tone({ freq, ms, gain: 0.25 });
}

/** Sound effects (power-up, PR). Controlled by the separate Sound effects switch. */
export const sfx = {
  /** Set-complete "charge + chime". level 0..1 raises the pitch as the workout builds. */
  charge(level = 0) {
    if (!prefs().sfx) return;
    const up = Math.round(level * 5);
    tone({ freq: 160, slideTo: semi(620, up), type: 'sawtooth', ms: 170, gain: 0.08, filter: 1800 });
    tone({ freq: semi(1318.5, up), ms: 260, gain: 0.16, at: 0.14 });
    tone({ freq: semi(1975.5, up), ms: 320, gain: 0.12, at: 0.2 });
  },
  /** Bigger finish for the last set of an exercise. */
  final() {
    if (!prefs().sfx) return;
    tone({ freq: 140, slideTo: 880, type: 'sawtooth', ms: 220, gain: 0.09, filter: 2200 });
    [1318.5, 1661.2, 1975.5].forEach((f, k) => tone({ freq: f, ms: 360, gain: 0.13, at: 0.16 + k * 0.05 }));
  },
  /** PR: rising arpeggio plus a low thump. */
  pr() {
    if (!prefs().sfx) return;
    tone({ freq: 70, slideTo: 45, type: 'sine', ms: 380, gain: 0.35 });
    [1046.5, 1318.5, 1568, 2093].forEach((f, k) => tone({ freq: f, ms: 300, gain: 0.15, at: 0.08 + k * 0.08, type: 'triangle' }));
    tone({ freq: 2637, ms: 600, gain: 0.08, at: 0.42 });
  },
  /** One celebration explosion: kind is pop | thud | boom | finale, gain 0..1. Obeys the Sound effects switch. */
  boom(kind = 'boom', gain = 1) {
    if (!prefs().sfx) return;
    const e = EXPLOSIONS[kind];
    if (!e) return;
    // celebrations run outside a tap: never prime speech here, and never schedule on a suspended context
    // (currentTime is frozen, so queued booms would all fire together later)
    if (!ensureCtx()) return;
    if (ctx.state !== 'running') {
      try { ctx.resume().catch(() => {}); } catch { /* ignore */ }
      return;
    }
    explosion({ ...e, gain: Math.max(0, Math.min(1, gain)) });
  },
  /** Workout complete. */
  fanfare() {
    if (!prefs().sfx) return;
    [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, k) => tone({ freq: f, ms: 420, gain: 0.14, at: k * 0.11, type: 'triangle' }));
  },
};

// ---------- voice coach ----------
let lastSpoken = 0;
function say(text, { interrupt = false } = {}) {
  if (prefs().coach !== 'voice' || !('speechSynthesis' in window)) return;
  try {
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1;
    u.lang = 'en-US';
    speechSynthesis.speak(u);
    lastSpoken = Date.now();
  } catch { /* ignore */ }
}

export const coach = {
  /** 3-2-1 countdown tick. n = 3, 2, 1. */
  count(n) {
    beep(660, 120);
    say(String(n), { interrupt: true });
  },
  go() {
    beep(990, 260);
    say('Go!', { interrupt: true });
  },
  rest(sec, next) {
    const nxt = next ? ` Next up: ${next}.` : '';
    say(`${restPhrase(sec)}.${nxt}`, { interrupt: true });
  },
  tenSeconds() {
    beep(740, 120);
    say('10 seconds');
  },
  restOver() {
    beep(990, 300);
  },
  lastSet() {
    say('Last set!');
  },
  pr() {
    say('New PR!'); // queued after the rest line, never cutting it off
  },
  workoutDone() {
    say('Workout complete. Great work.', { interrupt: true });
  },
  /** Free text (boxing combos). */
  call(text) {
    say(text.replace(/-/g, ' '), { interrupt: true });
  },
  cancel() {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  },
  get lastSpoken() {
    return lastSpoken;
  },
};

// iPhone suspends (or "interrupts") the audio context when the app goes to the background, a call comes in,
// or the screen locks. Wake it on return, and on any tap (Resume, Count it, Skip, ±15…) since a tap is
// what iOS needs to let audio start again.
function wake() {
  if (ctx && ctx.state !== 'running') {
    try { ctx.resume().catch(() => {}); } catch { /* ignore */ }
  }
}
const ACTIVATION = ['touchend', 'pointerup', 'click', 'keydown'];

/**
 * Unlock audio on the first real activation anywhere, before any celebration can play. A touch pointerdown is NOT an
 * activation (it may start a scroll), so it is ignored unless it is a mouse. Keeps listening until the context is
 * running and speech is primed. Returns the handler (for tests).
 */
export function installUnlock(doc) {
  const opts = { capture: true, passive: true };
  const events = [...ACTIVATION, 'pointerdown'];
  const handler = (e) => {
    if (e.type === 'pointerdown' && e.pointerType !== 'mouse') return;
    unlockAudio();
    const speechOk = primed || !('speechSynthesis' in window);
    if (ctx && ctx.state === 'running' && speechOk) events.forEach((t) => doc.removeEventListener(t, handler, opts));
  };
  events.forEach((t) => doc.addEventListener(t, handler, opts));
  return handler;
}

if (typeof document !== 'undefined') {
  installUnlock(document);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  // touchend / pointerup are the taps iOS accepts as activation for resuming a backgrounded context
  ['pointerdown', 'pointerup', 'touchend'].forEach((t) => document.addEventListener(t, wake, { capture: true, passive: true }));
}
