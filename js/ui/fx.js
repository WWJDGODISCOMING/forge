// Celebration effects on one shared <canvas> plus a few DOM layers:
//   powerUp()     Done set: squash → ✓ pop, aura bloom, sparks, light shake, "+10 XP", segment shine.
//   prExplosion() New PR: gold aura, two bursts, "NEW PR" slam-in card with old → new value.
//   confetti()    Workout complete.
// Rules: under ~900 ms (PR ~1.6 s, tap to dismiss), never blocks input (pointer-events: none except the PR
// card), only transform/opacity/canvas are animated, and the frame loop sleeps when nothing is moving.
// Reduced motion: no sparks, shake or scaling: a colour flash, the ✓, sound and text only.
import { onFrame, reducedMotion, EASE } from './motion.js';
import { sfx, coach } from './sound.js';
import { tick, haptics } from './haptic.js';
import { icon } from './icons.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const COLORS = { ember: '#3EC8F0', volt: '#C6FF3D', gold: '#A8E8FF', white: '#FFFFFF', hot: '#FFB547' };

// ---------- canvas particles ----------
let canvas = null;
let g = null;
let dpr = 1;
const parts = [];
let running = false;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  g = canvas.getContext('2d');
  const size = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  };
  size();
  addEventListener('resize', size);
}

function kick() {
  if (running) return;
  running = true;
  onFrame(() => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      p.life += 1;
      if (p.life > p.max) {
        parts.splice(k, 1);
        continue;
      }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const a = 1 - p.life / p.max;
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = p.color;
      if (p.shape === 'rect') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9);
        g.restore();
      } else {
        g.beginPath();
        g.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    if (!parts.length) {
      g.clearRect(0, 0, innerWidth, innerHeight);
      running = false;
      return false;
    }
    return true;
  });
}

export function burst(x, y, { count = 40, colors = [COLORS.ember, COLORS.volt, COLORS.white], speed = 7, gravity = 0.18, size = 3, life = 42 } = {}) {
  if (reducedMotion()) return;
  ensureCanvas();
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.35 + Math.random() * 0.75);
    parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.25, g: gravity, drag: 0.94,
      size: size * (0.6 + Math.random() * 0.9), color: colors[k % colors.length], life: 0,
      max: life * (0.7 + Math.random() * 0.5), rot: 0, vr: 0, shape: 'dot',
    });
  }
  kick();
}

/** Stop everything mid-air (e.g. leaving the summary screen). */
export function clearParticles() {
  parts.length = 0;
  confettiUntil = 0;
}

let confettiUntil = 0;
export function confetti({ duration = 2000, colors = [COLORS.ember, COLORS.volt, COLORS.gold, COLORS.white] } = {}) {
  if (reducedMotion()) return;
  ensureCanvas();
  confettiUntil = performance.now() + duration;
  onFrame((t) => {
    if (t > confettiUntil) return false;
    for (let k = 0; k < 4; k++) {
      parts.push({
        x: Math.random() * innerWidth, y: -10, vx: (Math.random() - 0.5) * 2.5, vy: 2 + Math.random() * 3, g: 0.05, drag: 0.995,
        size: 4 + Math.random() * 4, color: colors[(Math.random() * colors.length) | 0], life: 0, max: 140 + Math.random() * 60,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, shape: 'rect',
      });
    }
    kick();
    return true;
  });
}

// ---------- DOM layers ----------
function centerOf(el) {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

export function aura(x, y, { size = 260, colors = [COLORS.ember, COLORS.volt], scale = 1.6, dur = 520, gold = false } = {}) {
  const el = document.createElement('div');
  el.className = 'fx-aura';
  el.style.left = `${x - size / 2}px`;
  el.style.top = `${y - size / 2}px`;
  el.style.width = el.style.height = `${size}px`;
  const [a, b] = gold ? [COLORS.gold, COLORS.hot] : colors;
  el.style.background = `radial-gradient(circle, ${a}cc 0%, ${a}66 28%, ${b}33 55%, transparent 70%)`;
  document.body.appendChild(el);
  const anim = reducedMotion()
    ? el.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 360, easing: EASE.out })
    : el.animate(
        [{ transform: 'scale(.35)', opacity: 0.95 }, { transform: `scale(${scale * 0.8})`, opacity: 0.75, offset: 0.4 }, { transform: `scale(${scale})`, opacity: 0 }],
        { duration: dur, easing: EASE.out }
      );
  anim.onfinish = () => el.remove();
}

export function floatText(text, x, y, cls = '') {
  const el = document.createElement('div');
  el.className = `fx-float ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  const move = reducedMotion() ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translate(-50%, 0) scale(.9)', opacity: 0 }, { transform: 'translate(-50%, -18px) scale(1.05)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%, -52px) scale(1)', opacity: 0 }];
  el.animate(move, { duration: 800, easing: EASE.out }).onfinish = () => el.remove();
}

export function shake(el, px = 3) {
  if (!el || reducedMotion()) return;
  el.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${-px}px)` }, { transform: `translateX(${px}px)` }, { transform: `translateX(${-px / 2}px)` }, { transform: 'translateX(0)' }],
    { duration: 150, easing: EASE.out }
  );
}

/** Button squash → spring pop (the ✓ itself comes from the re-render or the caller). */
export function pop(el) {
  if (!el) return;
  if (reducedMotion()) {
    el.animate([{ filter: 'brightness(1.6)' }, { filter: 'brightness(1)' }], { duration: 300 });
    return;
  }
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)', offset: 0.25 }, { transform: 'scale(1.06)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 320, easing: EASE.bounce });
}

export function flash(el, color = COLORS.ember) {
  if (!el) return;
  el.animate([{ boxShadow: `0 0 0 0 ${color}00` }, { boxShadow: `0 0 0 6px ${color}aa` }, { boxShadow: `0 0 0 14px ${color}00` }], { duration: 520, easing: EASE.out });
}

/**
 * Set-complete power-up.
 * opts: { button, hero (element behind which the aura blooms), shakeEl, segment, level 0..1, last, xp }
 */
export function powerUp({ button, hero, shakeEl, segment, level = 0, last = false, xp = 10 } = {}) {
  const origin = button ? centerOf(button) : [innerWidth / 2, innerHeight / 2];
  const center = hero ? centerOf(hero) : origin;
  pop(button);
  if (last) sfx.final();
  else sfx.charge(level);
  if (reducedMotion()) {
    flash(hero || button, COLORS.ember);
  } else {
    setTimeout(() => aura(center[0], center[1], { size: last ? 340 : 240 + level * 60, scale: last ? 2.2 : 1.6 }), 100);
    if (last) setTimeout(() => aura(center[0], center[1], { size: 200, scale: 2.6, colors: [COLORS.volt, COLORS.ember] }), 220);
    setTimeout(() => burst(origin[0], origin[1] - 10, { count: last ? 60 : Math.min(60, 30 + Math.round(level * 30)), speed: last ? 9 : 7 }), 100);
    setTimeout(() => shake(shakeEl, last ? 4 : 2 + Math.round(level * 2)), 120);
  }
  setTimeout(() => floatText(`+${xp} XP`, origin[0], origin[1] - 40, 'xp'), 150);
  if (segment) {
    segment.classList.remove('shine');
    void segment.offsetWidth;
    segment.classList.add('shine');
  }
}

// ---------- celebration queue (PRs, later: level-ups, badges) so they never stack ----------
let chain = Promise.resolve();
export function enqueue(fn) {
  chain = chain.then(() => fn()).catch((e) => console.error(e));
  return chain;
}

/**
 * NEW PR explosion. pr: { label, value, prev, unit, type }. Resolves when dismissed (tap or ~2.2 s).
 */
/**
 * PR explosion: one gold card per set, listing every record that set broke (old → new, counting up),
 * with an aura, sparks and the PR sound. Accepts one record or a list. Tap to dismiss, or it closes itself.
 */
export function prExplosion(prs, { origin } = {}) {
  const list = (Array.isArray(prs) ? prs : [prs]).filter(Boolean);
  if (!list.length) return Promise.resolve();
  return enqueue(() => new Promise((resolve) => {
    const [x, y] = origin ? centerOf(origin) : [innerWidth / 2, innerHeight * 0.42];
    sfx.pr();
    if (!haptics.win()) tick();
    coach.pr();
    const layer = document.createElement('div');
    layer.className = 'fx-pr';
    layer.setAttribute('role', 'status');
    const fmt = (v) => (v == null ? '' : Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());
    const unitOf = (pr) => (pr.unit ? ` ${pr.unit}` : pr.type === 'time' ? 's' : pr.type === 'reps' ? ' reps' : '');
    const whatOf = (pr) => ({ e1rm: 'Est. 1-rep max', weight: 'Heaviest weight', reps: pr.weight ? `Reps at ${fmt(pr.weight)}` : 'Most reps', time: 'Longest hold', volume: 'Best set volume' }[pr.type] || 'Record');
    const title = (list[0].label || '').split(': ')[0];
    layer.innerHTML = `
      <div class="pr-card2">
        <span class="pr-trophy" aria-hidden="true">${icon('trophy', { filled: true, size: 52 })}</span>
        <b class="pr-title">${list.length > 1 ? `${list.length} NEW PRs` : 'NEW PR'}</b>
        <span class="pr-ex">${esc(title)}</span>
        ${list.map((pr, i) => `
          <span class="pr-what">${esc(whatOf(pr))}</span>
          <span class="pr-vals">${pr.prev != null ? `<s>${fmt(pr.prev)}${unitOf(pr)}</s> → ` : ''}<em data-new="${i}">${fmt(pr.value)}</em>${unitOf(pr)}</span>`).join('')}
      </div>`;
    document.body.appendChild(layer);
    const card = layer.querySelector('.pr-card2');
    if (!reducedMotion()) {
      card.animate([{ transform: 'scale(1.6) rotate(-4deg)', opacity: 0 }, { transform: 'scale(.96) rotate(1deg)', opacity: 1, offset: 0.6 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { duration: 300, easing: EASE.bounce });
      aura(x, y, { gold: true, size: 380, scale: 2.4, dur: 700 });
      burst(x, y, { count: 60 + list.length * 15, colors: [COLORS.gold, COLORS.white, COLORS.hot], speed: 10, life: 55 });
      setTimeout(() => burst(innerWidth / 2, innerHeight * 0.38, { count: 50, colors: [COLORS.gold, COLORS.white], speed: 8, life: 50 }), 350);
    } else {
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    // Count each new value up from the old one.
    list.forEach((pr, i) => {
      const el = layer.querySelector(`[data-new="${i}"]`);
      if (pr.prev == null || reducedMotion() || typeof pr.value !== 'number') return;
      const from = pr.prev;
      const start = performance.now() + 250 + i * 120;
      onFrame((t) => {
        if (!el.isConnected) return false;
        const p = Math.min(1, Math.max(0, (t - start) / 600));
        el.textContent = fmt(from + (pr.value - from) * (1 - Math.pow(1 - p, 3)));
        return p < 1;
      });
    });
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      const out = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
      out.onfinish = () => {
        layer.remove();
        resolve();
      };
    };
    layer.addEventListener('click', close);
    setTimeout(close, 2200 + (list.length - 1) * 600);
  }));
}

/** Level-up: a gold card with the new level and name, a burst and the PR chime. Queued after PR cards. */
export function levelUp({ level, name }) {
  return enqueue(() => new Promise((resolve) => {
    sfx.pr();
    if (!haptics.win()) tick();
    const layer = document.createElement('div');
    layer.className = 'lvl-up';
    layer.setAttribute('role', 'status');
    layer.innerHTML = `<div class="lvl-card"><small>LEVEL UP</small><b>${esc(String(level))}</b><span>${esc(name)}</span></div>`;
    document.body.appendChild(layer);
    const card = layer.firstChild;
    if (!reducedMotion()) {
      card.animate([{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(.97)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 360, easing: EASE.bounce });
      aura(innerWidth / 2, innerHeight / 2, { gold: true, size: 360, scale: 2.2, dur: 700 });
      burst(innerWidth / 2, innerHeight / 2, { count: 80, colors: [COLORS.gold, COLORS.volt, COLORS.white], speed: 10, life: 60 });
    }
    setTimeout(() => {
      card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
      setTimeout(() => { layer.remove(); resolve(); }, 260);
    }, 1800);
  }));
}
