// An in-app camera for progress photos on the iPhone: a full-screen viewfinder with last time's photo of the same
// pose as a faint ghost, so each set lines up. The picture is taken on this phone and handed back as a File; nothing
// is uploaded. On the web, and anywhere the camera can't open, Take photo keeps using the system camera input.
import { isNative } from '../native/bridge.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { esc, toast } from '../ui.js';

/** The viewfinder is for the iPhone app only, and only where the page can open a camera. */
export const canViewfinder = (native = isNative(), env = globalThis) =>
  !!native && !!(env.navigator && env.navigator.mediaDevices && env.navigator.mediaDevices.getUserMedia);

/** Ghost opacity steps cycled by the ghost button: faint, stronger, off. */
export const GHOST_LEVELS = [0.35, 0.6, 0];
export const nextGhost = (level) => GHOST_LEVELS[(GHOST_LEVELS.indexOf(level) + 1) % GHOST_LEVELS.length] ?? GHOST_LEVELS[0];
const ghostName = (level) => (level === GHOST_LEVELS[0] ? 'faint' : level === 0 ? 'off' : 'stronger');

/** The real system-camera button: a genuine tap on this label opens the picker, so it works after a failed start. */
export const systemCameraHtml = () => `<label class="btn small">${icon('camera')}<span>Take photo</span><input type="file" accept="image/*" capture="environment" hidden data-file></label>`;

/**
 * One camera at a time. Every start gets a token; a stream that arrives after a newer start, a stop or a close is
 * stopped on the spot, so the camera light can't stay on behind a closed viewfinder. start() resolves true when
 * this stream is the live one and false when it was superseded.
 */
export function createCamera({ getUserMedia, video }) {
  let stream = null;
  let token = 0;
  let closed = false;
  const release = (s) => { if (s) s.getTracks().forEach((t) => t.stop()); };
  const stop = () => { token++; release(stream); stream = null; };
  const start = async (facing) => {
    stop();
    const mine = token;
    let s;
    try {
      s = await getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    } catch (e) {
      if (closed || mine !== token) return false;
      throw e;
    }
    if (closed || mine !== token) { release(s); return false; }
    stream = s;
    video.classList.toggle('vf-mirror', facing === 'user');
    video.srcObject = s;
    try {
      await video.play();
    } catch (e) {
      if (mine !== token) return false;
      stop();
      throw e;
    }
    return mine === token;
  };
  return { start, stop, close: () => { closed = true; stop(); } };
}

/** Self-timer choices in seconds (0 = off); the last choice is remembered on this phone. */
export const TIMER_STEPS = [0, 3, 10];
export const TIMER_KEY = 'forge.photoTimer';
export const nextTimer = (t) => TIMER_STEPS[(TIMER_STEPS.indexOf(t) + 1) % TIMER_STEPS.length] ?? 0;
export const timerLabel = (t) => (t ? `Timer ${t} seconds` : 'Timer off');
export const loadTimer = (store = globalThis.localStorage) => {
  try { const n = Number(store.getItem(TIMER_KEY)); return TIMER_STEPS.includes(n) ? n : 0; } catch { return 0; }
};
export const saveTimer = (t, store = globalThis.localStorage) => { try { store.setItem(TIMER_KEY, String(t)); } catch { /* private mode: not remembered */ } };

/**
 * A countdown of whole seconds. onTick(n) fires at once with the full count and then each second down to 1;
 * onDone() fires after the last second. cancel() stops it for good. Timers are injectable for tests.
 */
export function createCountdown({ seconds, onTick, onDone, setT = setTimeout, clearT = clearTimeout }) {
  let n = seconds;
  let id = null;
  let live = true;
  const step = () => {
    id = null;
    if (!live) return;
    if (n <= 0) { live = false; onDone(); return; }
    onTick(n);
    n--;
    id = setT(step, 1000);
  };
  step();
  return { cancel: () => { live = false; if (id != null) clearT(id); id = null; }, get active() { return live; } };
}

/**
 * Draw the current video frame (mirrored for the front camera) and give back a JPEG File. Rejects, never hangs:
 * a canvas that makes no blob within `ms` is an error, so the caller can close the camera and say so.
 */
export function grabFrame({ video, makeCanvas = () => document.createElement('canvas'), facing, ms = 5000, setT = setTimeout, clearT = clearTimeout }) {
  return new Promise((resolve, reject) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) { reject(new Error('The camera isn’t ready yet.')); return; }
    let timer = null;
    try {
      // The clock starts before any drawing, so a slow draw counts too. A toBlob callback that arrives after the
      // timeout is harmless: the promise has already settled, and a second resolve or reject is ignored.
      timer = setT(() => reject(new Error('The photo took too long.')), ms);
      const c = makeCanvas();
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, w, h);
      c.toBlob((b) => {
        if (timer != null) clearT(timer);
        if (!b) reject(new Error('The photo couldn’t be made.'));
        else resolve(new File([b], 'pose.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    } catch (e) {
      if (timer != null) clearT(timer);
      reject(e);
    }
  });
}

const timerText = (t) => (t ? `${t}s` : 'Timer');
const STOPPED = 'The camera stopped. Close this and tap Take photo again.';

/**
 * openViewfinder({ label, ghostUrl }) → Promise<File | null>. null when closed without a shot. Rejects (so the caller
 * falls back to the system camera) only when the first start fails; a failed flip or a failed restart after the app
 * comes back shows a short message and keeps the viewfinder open.
 */
export function openViewfinder({ label, ghostUrl = '' }) {
  return new Promise((resolve, reject) => {
    const opener = document.activeElement;
    // Its own modal <dialog>: the Progress photos sheet is a modal dialog, so anything mounted outside it is inert and
    // sits below the top layer. showModal() puts the camera above the sheet and keeps taps off the sheet's backdrop.
    const root = document.createElement('dialog');
    root.className = 'vf';
    root.setAttribute('aria-label', `${label} photo`);
    let timer = loadTimer();
    let counting = null;
    let level = ghostUrl ? GHOST_LEVELS[0] : 0;
    let facing = 'environment';
    let settled = false;
    let busy = false;
    const ghostLabel = () => `Last time's photo: ${ghostName(level)}`;
    root.innerHTML = `
      <video class="vf-video" playsinline muted></video>
      ${ghostUrl ? `<img class="vf-ghost" src="${esc(ghostUrl)}" alt="" style="opacity:${level}">` : ''}
      <div class="vf-top"><button type="button" class="vf-btn" data-close aria-label="Cancel">${icon('close')}</button><b class="vf-title">${esc(label)}</b><button type="button" class="vf-btn vf-pill" data-timer aria-label="${timerLabel(timer)}">${timerText(timer)}</button>${ghostUrl ? `<button type="button" class="vf-btn vf-pill" data-ghost aria-pressed="true" aria-label="${ghostLabel()}">Last time</button>` : '<span class="vf-gap"></span>'}</div>
      <div class="vf-count" data-count aria-hidden="true" hidden></div>
      <p class="vf-msg" role="status" aria-live="polite" data-msg hidden></p>
      <div class="vf-bottom"><span class="vf-gap"></span><button type="button" class="vf-shutter" data-shoot aria-label="Take photo" aria-disabled="true"></button><button type="button" class="vf-btn" data-flip aria-label="Flip camera">${icon('refresh')}</button></div>`;
    const q = (s) => root.querySelector(s);
    const video = q('video');
    const shutter = q('[data-shoot]');
    const flipBtn = q('[data-flip]');
    const msg = q('[data-msg]');
    const count = q('[data-count]');
    const timerBtn = q('[data-timer]');
    const cam = createCamera({ getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), video });
    const say = (text) => { msg.textContent = text; msg.hidden = !text; };
    const setShutter = (on) => { shutter.setAttribute('aria-disabled', String(!on)); };
    const ready = () => setShutter(!!(video.videoWidth && video.videoHeight));
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    const onVisible = async () => {
      if (settled) return;
      if (document.visibilityState === 'hidden') { stopCount(); cam.stop(); setShutter(false); return; }
      say('');
      try { await run(); } catch { if (!settled) say(STOPPED); }
    };
    const stopCount = () => {
      if (counting) counting.cancel();
      counting = null;
      count.hidden = true;
      shutter.classList.remove('vf-counting');
      shutter.setAttribute('aria-label', 'Take photo');
    };
    // Close cleanly whatever happens: timers off, camera released, nothing left over the page.
    const teardown = () => {
      settled = true;
      try { stopCount(); } catch { /* keep closing */ }
      try { cam.close(); } catch { /* keep closing */ }
      try { video.pause(); video.srcObject = null; } catch { /* keep closing */ }
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      try { root.close(); } catch { /* not open */ }
      root.remove();
      document.querySelectorAll('.vf').forEach((n) => n.remove());
      try { if (opener && opener.focus) opener.focus(); } catch { /* the opener is gone */ }
    };
    const finish = (file) => { if (settled) return; teardown(); resolve(file); };
    // A camera error closes the camera, says so gently and hands back nothing, so the page is never left stuck.
    const fail = () => {
      if (settled) return;
      teardown();
      try { toast('The camera had a hiccup. Try Take photo again.', 3200, { icon: 'camera' }); } catch { /* no toast host */ }
      resolve(null);
    };
    // One camera start; Flip and the shutter wait while it is in flight.
    const run = async () => {
      busy = true; flipBtn.disabled = true; setShutter(false);
      try {
        const live = await cam.start(facing);
        if (live) ready();
        return live;
      } finally {
        busy = false; flipBtn.disabled = false;
      }
    };
    video.addEventListener('loadedmetadata', ready);
    q('[data-close]').addEventListener('click', () => finish(null));
    flipBtn.addEventListener('click', async () => {
      if (busy || settled) return;
      stopCount();
      const before = facing;
      facing = facing === 'environment' ? 'user' : 'environment';
      haptics.select();
      say('');
      try {
        await run();
      } catch {
        if (settled) return;
        facing = before;
        say('Couldn’t switch cameras.');
        try { await run(); } catch { if (!settled) say(STOPPED); }
      }
    });
    const g = q('[data-ghost]');
    if (g) {
      g.addEventListener('click', () => {
        level = nextGhost(level);
        q('.vf-ghost').style.opacity = String(level);
        g.setAttribute('aria-pressed', String(level > 0));
        g.setAttribute('aria-label', ghostLabel());
        haptics.select();
      });
    }
    const shoot = async () => {
      stopCount();
      if (settled) return;
      haptics.medium();
      try {
        finish(await grabFrame({ video, facing }));
      } catch {
        fail();
      }
    };
    timerBtn.addEventListener('click', () => {
      if (settled) return;
      stopCount();
      timer = nextTimer(timer);
      saveTimer(timer);
      timerBtn.textContent = timerText(timer);
      timerBtn.setAttribute('aria-label', timerLabel(timer));
      haptics.select();
    });
    shutter.addEventListener('click', () => {
      if (settled) return;
      if (counting) { stopCount(); haptics.select(); return; } // tap the shutter again to cancel the countdown
      if (shutter.getAttribute('aria-disabled') === 'true' || !video.videoWidth || !video.videoHeight) return;
      if (!timer) { shoot(); return; }
      shutter.classList.add('vf-counting');
      shutter.setAttribute('aria-label', 'Cancel timer');
      count.hidden = false;
      counting = createCountdown({
        seconds: timer,
        onTick: (n) => { count.textContent = String(n); haptics.select(); },
        onDone: () => { counting = null; shoot(); },
      });
    });
    root.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); }); // Escape
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisible);
    document.body.appendChild(root);
    try { root.showModal(); } catch { root.setAttribute('open', ''); }
    shutter.focus();
    // Only this first start rejects (the caller then offers the system camera).
    run().catch((e) => { if (!settled) { teardown(); reject(e); } });
  });
}
