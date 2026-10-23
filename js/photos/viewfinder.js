// An in-app camera for progress photos on the iPhone: a full-screen viewfinder with last time's photo of the same
// pose as a faint ghost, so each set lines up. The picture is taken on this phone and handed back as a File; nothing
// is uploaded. On the web, and anywhere the camera can't open, Take photo keeps using the system camera input.
import { isNative } from '../native/bridge.js';
import { icon } from '../ui/icons.js';
import { haptics } from '../ui/haptic.js';
import { esc } from '../ui.js';

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

const STOPPED = 'The camera stopped. Close this and tap Take photo again.';

/**
 * openViewfinder({ label, ghostUrl }) → Promise<File | null>. null when closed without a shot. Rejects (so the caller
 * falls back to the system camera) only when the first start fails; a failed flip or a failed restart after the app
 * comes back shows a short message and keeps the viewfinder open.
 */
export function openViewfinder({ label, ghostUrl = '' }) {
  return new Promise((resolve, reject) => {
    const opener = document.activeElement;
    const root = document.createElement('div');
    root.className = 'vf';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `${label} photo`);
    let level = ghostUrl ? GHOST_LEVELS[0] : 0;
    let facing = 'environment';
    let settled = false;
    let busy = false;
    const ghostLabel = () => `Last time's photo: ${ghostName(level)}`;
    root.innerHTML = `
      <video class="vf-video" playsinline muted></video>
      ${ghostUrl ? `<img class="vf-ghost" src="${esc(ghostUrl)}" alt="" style="opacity:${level}">` : ''}
      <div class="vf-top"><button type="button" class="vf-btn" data-close aria-label="Cancel">${icon('close')}</button><b class="vf-title">${esc(label)}</b>${ghostUrl ? `<button type="button" class="vf-btn vf-pill" data-ghost aria-pressed="true" aria-label="${ghostLabel()}">Last time</button>` : '<span class="vf-gap"></span>'}</div>
      <p class="vf-msg" role="status" aria-live="polite" data-msg hidden></p>
      <div class="vf-bottom"><span class="vf-gap"></span><button type="button" class="vf-shutter" data-shoot aria-label="Take photo" aria-disabled="true"></button><button type="button" class="vf-btn" data-flip aria-label="Flip camera">${icon('refresh')}</button></div>`;
    const q = (s) => root.querySelector(s);
    const video = q('video');
    const shutter = q('[data-shoot]');
    const flipBtn = q('[data-flip]');
    const msg = q('[data-msg]');
    const cam = createCamera({ getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), video });
    const say = (text) => { msg.textContent = text; msg.hidden = !text; };
    const setShutter = (on) => { shutter.setAttribute('aria-disabled', String(!on)); };
    const ready = () => setShutter(!!(video.videoWidth && video.videoHeight));
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    const onVisible = async () => {
      if (settled) return;
      if (document.visibilityState === 'hidden') { cam.stop(); setShutter(false); return; }
      say('');
      try { await run(); } catch { if (!settled) say(STOPPED); }
    };
    const teardown = () => {
      settled = true;
      cam.close();
      root.remove();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      if (opener && opener.focus) opener.focus();
    };
    const finish = (file) => { if (settled) return; teardown(); resolve(file); };
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
    shutter.addEventListener('click', () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (shutter.getAttribute('aria-disabled') === 'true' || !w || !h) return;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, w, h);
      haptics.medium();
      c.toBlob((b) => finish(b ? new File([b], 'pose.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.92);
    });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisible);
    document.body.appendChild(root);
    shutter.focus();
    // Only this first start rejects (the caller then offers the system camera).
    run().catch((e) => { if (!settled) { teardown(); reject(e); } });
  });
}
