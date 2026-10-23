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

/**
 * openViewfinder({ label, ghostUrl }) → Promise<File | null>. null when closed without a shot. Rejects (so the caller
 * falls back to the system camera) when the camera can't start.
 */
export function openViewfinder({ label, ghostUrl = '' }) {
  return new Promise((resolve, reject) => {
    const root = document.createElement('div');
    root.className = 'vf';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `${label} photo`);
    let level = ghostUrl ? GHOST_LEVELS[0] : 0;
    let facing = 'environment';
    let stream = null;
    let settled = false;
    root.innerHTML = `
      <video class="vf-video" playsinline muted></video>
      ${ghostUrl ? `<img class="vf-ghost" src="${esc(ghostUrl)}" alt="" style="opacity:${level}">` : ''}
      <div class="vf-top"><button type="button" class="vf-btn" data-close aria-label="Cancel">${icon('close')}</button><b class="vf-title">${esc(label)}</b>${ghostUrl ? '<button type="button" class="vf-btn vf-pill" data-ghost>Last time</button>' : '<span class="vf-gap"></span>'}</div>
      <div class="vf-bottom"><span class="vf-gap"></span><button type="button" class="vf-shutter" data-shoot aria-label="Take photo"></button><button type="button" class="vf-btn" data-flip aria-label="Flip camera">${icon('refresh')}</button></div>`;
    const q = (s) => root.querySelector(s);
    const video = q('video');
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const finish = (file) => {
      if (settled) return;
      settled = true;
      stop();
      root.remove();
      document.removeEventListener('keydown', onKey);
      resolve(file);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    const start = async () => {
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        video.classList.toggle('vf-mirror', facing === 'user');
        video.srcObject = stream;
        await video.play();
      } catch (e) {
        if (!settled) { settled = true; stop(); root.remove(); document.removeEventListener('keydown', onKey); reject(e); }
      }
    };
    q('[data-close]').addEventListener('click', () => finish(null));
    q('[data-flip]').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; haptics.select(); start(); });
    const g = q('[data-ghost]');
    if (g) {
      g.addEventListener('click', () => {
        level = nextGhost(level);
        q('.vf-ghost').style.opacity = String(level);
        g.setAttribute('aria-pressed', String(level > 0));
        haptics.select();
      });
    }
    q('[data-shoot]').addEventListener('click', () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, w, h);
      haptics.medium();
      c.toBlob((b) => finish(b ? new File([b], 'pose.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.92);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    start();
  });
}
