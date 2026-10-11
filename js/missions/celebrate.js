// Playing the mission celebrations (the rules are in celebrate-core.js, which the tests cover).
//   1 first mission  the check springs, the card pops and glows lime, one medium tap.
//   2 next missions  a bigger pop, a small burst from the check, the progress bar fills and flashes, medium then heavy.
//   3 finale         screen shake, lime aura from the card, edge glow, particles, bloom, toast and XP count up,
//                    a rising run of heavy taps ending in success.
//   Perfect Week     a once-a-week takeover after the finale (7 of 7 days).
// Rules: transform/opacity/canvas only, pointer-events: none (the Perfect Week takeover is the one thing a tap skips),
// anything you do (tap, key, change screen) cuts it short, and it queues behind PR and level-up cards (fx.enqueue).
import { reducedMotion, EASE, countUp } from '../ui/motion.js';
import { burst, aura, enqueue, confetti, clearParticles } from '../ui/fx.js';
import { isNative, haptic } from '../native/bridge.js';
import { hapticsOn } from '../ui/haptic.js';
import { badgeSVG } from '../ui/badges.js';
import { shareImage } from '../ui/sharecard.js';
import { todayMissions, seenToday, celebratedTier, recordCelebrated, weekProgress, perfectWeekEnds, recordPerfectWeek } from './store.js';
import { tierToPlay, effectsFor, hapticPlan, vibratePattern, perfectWeekDue, weekStreak, PERFECT_WEEK_XP } from './celebrate-core.js';

const VOLT = '#C6FF3D';
const COLORS = [VOLT, '#FFFFFF', '#E6FF9A'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- one run at a time, cut short by any input ----------
let current = null;

function startRun() {
  const run = { timers: [], anims: [], els: [], stops: [], done: null, ended: false };
  run.at = (ms, fn) => { run.timers.push(setTimeout(() => { if (!run.ended) fn(); }, ms)); };
  run.anim = (el, frames, opts) => { const a = el.animate(frames, { fill: 'both', ...opts }); run.anims.push(a); return a; };
  run.layer = (cls, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    if (html) el.innerHTML = html;
    document.body.appendChild(el);
    run.els.push(el);
    return el;
  };
  run.haptics = (kind) => {
    if (!hapticsOn()) return;
    if (isNative()) for (const s of hapticPlan(kind)) run.at(s.t, () => haptic(s.kind));
    else if (navigator.vibrate) navigator.vibrate(vibratePattern(kind));
  };
  run.end = () => {
    if (run.ended) return;
    run.ended = true;
    run.timers.forEach(clearTimeout);
    run.anims.forEach((a) => { try { a.cancel(); } catch { /* already gone */ } });
    run.els.forEach((el) => el.remove());
    run.stops.forEach((fn) => fn());
    removeEventListener('pointerdown', cut, true);
    removeEventListener('keydown', cut, true);
    removeEventListener('hashchange', cut, true);
    if (current === run) current = null;
    run.done?.();
  };
  const cut = (e) => { if (!run.keep || e.type === 'hashchange') { clearParticles(); if (navigator.vibrate) navigator.vibrate(0); run.end(); } };
  addEventListener('pointerdown', cut, true);
  addEventListener('keydown', cut, true);
  addEventListener('hashchange', cut, true);
  if (current) current.end();
  current = run;
  return run;
}

const finish = (run, ms) => new Promise((resolve) => { run.done = resolve; run.at(ms, () => run.end()); });
const screenCenter = () => [innerWidth / 2, innerHeight * 0.4];
const onScreen = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
};
// Fixed effects are drawn at screen coordinates, so a card that is scrolled out of view gets the screen center instead.
const centerOf = (el) => {
  if (!onScreen(el)) return screenCenter();
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

/** A decaying translate/rotate shake as keyframes: peaks at the start, settles to nothing. */
export function shakeFrames(amp, steps = 22) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const d = (1 - k) ** 2 * amp;
    const s = i % 2 ? -1 : 1;
    out.push({ transform: i === steps ? 'none' : `translate(${(s * d).toFixed(2)}px, ${(-s * d * 0.45).toFixed(2)}px) rotate(${(s * d * 0.06).toFixed(3)}deg)`, offset: k });
  }
  return out;
}

function shakeScreen(run, amp, dur) {
  for (const id of ['main', 'navbar', 'nav']) {
    const el = document.getElementById(id);
    if (el && !el.hidden) run.anim(el, shakeFrames(amp), { duration: dur, easing: 'linear' });
  }
}

// The glow lives inside the card (absolute, inset 0), so it follows the card however the page scrolls.
function glowOver(run, card, fx) {
  if (!card) return;
  const g = document.createElement('div');
  g.className = 'ms-glow';
  g.setAttribute('aria-hidden', 'true');
  card.appendChild(g);
  run.els.push(g);
  run.anim(g, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: fx.fade ? 500 : 800, easing: EASE.out });
}

function toast(run, xp) {
  const t = run.layer('ms-toast', `<b>All missions done 🔥</b><small class="ms-toast-xp">+0 XP</small>`);
  t.removeAttribute('aria-hidden');
  t.setAttribute('role', 'status');
  const frames = reducedMotion()
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
    : [{ opacity: 0, transform: 'translateY(-14px) scale(.94)' }, { opacity: 1, transform: 'none', offset: 0.14 }, { opacity: 1, transform: 'none', offset: 0.85 }, { opacity: 0, transform: 'translateY(-8px)' }];
  run.anim(t, frames, { duration: 3000, easing: EASE.out });
  countUp(t.querySelector('.ms-toast-xp'), xp, { dur: 900, delay: 250, format: (v) => `+${Math.round(v)} XP` });
}

// ---------- tiers 1 to 3 ----------
function playTier(tier, { fresh, xp }) {
  const fx = effectsFor(tier, reducedMotion());
  const run = startRun();
  const card = document.querySelector('.ms-card, .ms-done');
  const row = fresh.length ? document.querySelector(`[data-mission="${CSS.escape(fresh[fresh.length - 1])}"] .ms-check`) : null;
  const [cx, cy] = centerOf(card);
  const [kx, ky] = row ? centerOf(row) : [cx, cy];
  run.haptics(tier);

  if (card && fx.pop > 1) run.anim(card, [{ transform: 'scale(1)' }, { transform: `scale(${fx.pop})`, offset: 0.35 }, { transform: 'scale(1)' }], { duration: tier === 1 ? 420 : 520, easing: EASE.bounce });
  else if (card && fx.fade) run.anim(card, [{ opacity: 0.6 }, { opacity: 1 }], { duration: 300 });
  glowOver(run, card, fx);

  if (tier === 2) {
    const fill = document.querySelector('.ms-bar > i');
    const flash = document.querySelector('.ms-bar-flash');
    if (fill && !fx.fade) {
      const to = getComputedStyle(fill).getPropertyValue('--f') || '1';
      const m = todayMissions();
      run.anim(fill, [{ transform: `scaleX(${Math.max(0, (m.done - 1) / m.total)})` }, { transform: `scaleX(${to.trim()})` }], { duration: 520, easing: EASE.out });
    }
    if (flash) run.anim(flash, [{ opacity: 0 }, { opacity: 0.95, offset: 0.4 }, { opacity: 0 }], { duration: 560 });
    if (fx.particles) burst(kx, ky, { count: 24, colors: COLORS, speed: 5, gravity: 0.12, size: 2.6, life: 34 });
  }

  if (tier === 3) {
    if (fx.shake) shakeScreen(run, 9, 1200);
    if (fx.aura) {
      aura(cx, cy, { size: 300, scale: 2.4, dur: 700, colors: [VOLT, '#8BE000'] });
      run.at(260, () => aura(cx, cy, { size: 420, scale: 2.8, dur: 800, colors: [VOLT, '#FFFFFF'] }));
    }
    if (fx.particles) {
      burst(cx, cy, { count: 90, colors: COLORS, speed: 10, gravity: 0.14, size: 3, life: 52 });
      run.at(300, () => burst(cx, cy, { count: 40, colors: COLORS, speed: 7, gravity: 0.1, size: 2.4, life: 44 }));
    }
    const edge = run.layer('ms-edge');
    run.anim(edge, fx.fade
      ? [{ opacity: 0 }, { opacity: 0.7, offset: 0.3 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.35, offset: 0.4 }, { opacity: 0.9, offset: 0.62 }, { opacity: 0 }], { duration: 1300, easing: 'linear' });
    const bloom = run.layer('ms-bloom');
    run.anim(bloom, [{ opacity: 0 }, { opacity: fx.fade ? 0.25 : 0.55, offset: 0.35 }, { opacity: 0 }], { duration: 420, easing: EASE.out });
    run.at(1000, () => run.anim(run.layer('ms-bloom'), [{ opacity: 0 }, { opacity: 0.4, offset: 0.4 }, { opacity: 0 }], { duration: 400 }));
    if (fx.toast) toast(run, xp);
    return finish(run, 3100);
  }
  return finish(run, 900);
}

// ---------- Perfect Week ----------
async function shareCard(n, streak) {
  const W = 1080;
  const H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0e1116';
  g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H * 0.45, 800);
  rg.addColorStop(0, '#c6ff3d66');
  rg.addColorStop(1, '#0e111600');
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  const font = 'system-ui, -apple-system, sans-serif';
  g.fillStyle = VOLT;
  g.font = `900 44px ${font}`;
  g.fillText('FORGE', W / 2, 150);
  g.fillStyle = '#fff';
  g.font = `900 110px ${font}`;
  g.fillText('PERFECT WEEK', W / 2, 900);
  g.fillStyle = VOLT;
  g.font = `900 260px ${font}`;
  g.fillText(`#${n}`, W / 2, 1150);
  g.fillStyle = '#9aa4b0';
  g.font = `600 44px ${font}`;
  g.fillText('Every mission, 7 days in a row', W / 2, 1260);
  if (streak > 1) g.fillText(`${streak} weeks running`, W / 2, 1330);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

function playPerfectWeek({ n, streak }) {
  const reduced = reducedMotion();
  const run = startRun();
  run.keep = true; // a tap skips to the end instead of cutting everything
  const bg = run.layer('pw-bg');
  const stage = run.layer('pw-stage');
  stage.removeAttribute('aria-hidden');
  stage.setAttribute('role', 'dialog');
  stage.setAttribute('aria-label', 'Perfect Week');
  const [cx, cy] = [innerWidth / 2, innerHeight * 0.42];
  run.haptics('week');

  const showEmblem = (instant) => {
    if (stage.dataset.shown) return;
    stage.dataset.shown = '1';
    stage.innerHTML = `<div class="pw-card">
      <div class="pw-medal">${badgeSVG('perfectweek', { shine: true, size: 132, label: 'Perfect Week' })}</div>
      <h2 class="pw-title">Perfect Week</h2>
      <p class="pw-n">#${n}</p>
      <p class="pw-streak">${streak > 1 ? `${streak} weeks in a row` : 'Every mission, 7 days in a row'}</p>
      <p class="pw-xp"><span class="pw-xp-n">+0 XP</span></p>
      <div class="pw-actions"><button type="button" class="btn pw-share">Share</button><button type="button" class="btn ghost pw-close">Continue</button></div>
    </div>`;
    const card = stage.firstElementChild;
    const medal = stage.querySelector('.pw-medal');
    if (instant || reduced) run.anim(card, [{ opacity: 0 }, { opacity: 1 }], { duration: instant ? 120 : 400 });
    else {
      run.anim(card, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      run.anim(medal, [{ transform: 'scale(.3) rotate(-14deg)', opacity: 0 }, { transform: 'scale(1.12) rotate(2deg)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 700, easing: EASE.bounce });
    }
    countUp(stage.querySelector('.pw-xp-n'), PERFECT_WEEK_XP, { dur: instant ? 0 : 1000, delay: instant ? 0 : 400, format: (v) => `+${Math.round(v)} XP` });
    stage.querySelector('.pw-close').onclick = (e) => { e.stopPropagation(); closeUp(); };
    stage.querySelector('.pw-share').onclick = async (e) => {
      e.stopPropagation();
      try { const blob = await shareCard(n, streak); if (blob) await shareImage(blob, `forge-perfect-week-${n}.png`); } catch { /* cancelled */ }
    };
    stage.dataset.ready = '1';
  };
  const closeUp = () => {
    run.keep = false;
    run.anim(stage, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 });
    run.anim(bg, [{ opacity: 0.95 }, { opacity: 0 }], { duration: 250 });
    run.at(260, () => run.end());
  };
  // A tap before the emblem shows skips ahead to it; after, it dismisses.
  stage.addEventListener('click', () => {
    if (!stage.dataset.shown) {
      run.timers.forEach(clearTimeout);
      run.stops.forEach((fn) => fn());
      clearParticles();
      if (navigator.vibrate) navigator.vibrate(0);
      showEmblem(true);
    } else closeUp();
  });

  run.anim(bg, [{ opacity: 0 }, { opacity: 0.95 }], { duration: reduced ? 300 : 450, easing: EASE.out });
  if (reduced) {
    run.at(350, () => showEmblem(false));
    return new Promise((resolve) => { run.done = resolve; });
  }
  // charge-up: lime builds around the edges
  const edge = run.layer('pw-edge');
  run.anim(edge, [{ opacity: 0 }, { opacity: 0.35, offset: 0.4 }, { opacity: 0.55, offset: 0.7 }, { opacity: 1, offset: 1 }], { duration: 1600, easing: 'linear' });
  run.anim(edge, [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 400, iterations: 4, easing: 'ease-in-out' });
  // eruption
  run.at(1600, () => {
    shakeScreen(run, 16, 1600);
    aura(cx, cy, { size: 360, scale: 3.4, dur: 900, colors: [VOLT, '#8BE000'] });
    aura(cx, cy, { size: 240, scale: 4.2, dur: 1100, colors: ['#FFFFFF', VOLT] });
    burst(cx, cy, { count: 120, colors: COLORS, speed: 13, gravity: 0.14, size: 3.2, life: 60 });
    confetti({ duration: 1600, colors: [VOLT, '#FFFFFF', '#FFC94D'] });
    const ring = run.layer('pw-ring');
    Object.assign(ring.style, { left: `${cx - 60}px`, top: `${cy - 60}px` });
    run.anim(ring, [{ transform: 'scale(.2)', opacity: 0.95 }, { transform: 'scale(14)', opacity: 0 }], { duration: 1000, easing: EASE.out });
    run.anim(run.layer('pw-bloom'), [{ opacity: 0 }, { opacity: 0.8, offset: 0.2 }, { opacity: 0 }], { duration: 600 });
    run.anim(edge, [{ opacity: 1 }, { opacity: 0.25 }], { duration: 900 });
  });
  run.at(2300, () => showEmblem(false));
  return new Promise((resolve) => { run.done = resolve; });
}

// ---------- the one entry point ----------
let watcher = null; // waits for the card to scroll into view (tiers 1 and 2)
let owed = new Set(); // missions finished but not celebrated yet because the card never showed, kept across re-renders

/**
 * Called after Today renders. Plays the highest tier not yet played today, but only if a mission was finished since
 * the card was last shown (so a reload, resume or re-render never replays). Tiers 1 and 2 wait until the missions card
 * is at least half on screen and are recorded only when they play, so leaving Today first just defers them to the next
 * time the card shows. The finale is full screen, so it plays right away.
 */
export function celebrateMissions() {
  if (watcher) { watcher.disconnect(); watcher = null; }
  const m = todayMissions();
  if (!m.started || !m.list.length) return;
  const seen = seenToday();
  const fresh = m.list.filter((x) => x.done && (!seen.has(x.id) || owed.has(x.id))).map((x) => x.id);
  const tier = tierToPlay({ done: m.done, total: m.total, celebrated: celebratedTier(m.day), hasNew: fresh.length > 0 });
  if (!tier) { owed = new Set(); return; }
  const play = () => {
    owed = new Set();
    recordCelebrated(tier, m.day);
    enqueue(() => playTier(tier, { fresh, xp: m.xp }));
    if (tier === 3 && perfectWeekDue(weekProgress(), perfectWeekEnds(), m.day)) {
      recordPerfectWeek(m.day);
      const ends = perfectWeekEnds();
      enqueue(() => playPerfectWeek({ n: ends.length, streak: weekStreak(ends) }));
    }
  };
  const card = document.querySelector('[data-missions]');
  if (tier === 3 || !card || typeof IntersectionObserver === 'undefined') { play(); return; }
  owed = new Set(fresh);
  watcher = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) return;
    watcher.disconnect();
    watcher = null;
    play();
  }, { threshold: [0.5] });
  watcher.observe(card);
}
