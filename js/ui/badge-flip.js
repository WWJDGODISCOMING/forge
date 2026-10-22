// Awards → Badges: each badge is a card that flips in 3D. Tap toggles; a horizontal drag turns it with the
// finger and springs to the front or back on release. A light haptic ticks as it passes edge-on. Only
// transform/opacity change. With Reduce Motion there is no turning: the two sides crossfade.
import { weightToDisplay, weightUnit } from '../units.js';
import { haptics } from './haptic.js';
import { reducedMotion, ease } from './motion.js';

const DRAG_START = 6; // px of horizontal travel before a touch becomes a drag
const FLIP_MS = 420;

// ---------- pure helpers (tested in tests/v01652.test.js) ----------
/** Card angle (0 front … 180 back) while dragging: half a turn per card width, held inside 0–180. */
export const dragAngle = (base, dx, width) => Math.max(0, Math.min(180, base + (dx / Math.max(1, width)) * 180));
/** Where a released card settles (0 or 180): the nearer side, nudged by a flick (vx in px/ms, + = to the right). */
export function settleAngle(angle, vx = 0, base = 0) {
  const lean = angle + Math.max(-1, Math.min(1, vx)) * 45;
  return lean >= 90 ? 180 : 0;
}
/** Did the card pass edge-on (90°) between two angles? */
export const crossedMid = (a, b) => (a - 90) * (b - 90) < 0 || b === 90;

const fmtNum = (n) => Math.round(n).toLocaleString();
const when = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

/** A kg goal as the user sees it: metric as is, imperial rounded to 2 significant figures (220,462 lb -> 220,000). */
export function goalDisplay(kg, units) {
  const v = weightToDisplay(kg, units);
  if (units === 'metric') return v;
  const m = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / m) * m;
}

/** "12,000 lb" style total for the kg-based badges, in the user's units; other units are plain counts. */
function amount(v, unit, units) {
  if (unit.startsWith('kg')) {
    const rest = unit.slice(2).trim(); // 'lifted' or 'in one workout'
    return `${fmtNum(goalDisplay(v, units))} ${weightUnit(units)}${rest ? ` ${rest}` : ''}`;
  }
  return `${fmtNum(v)} ${unit}`;
}

/** The "how to earn it" line; volume badges speak the user's units ("Lift 220,000 lb in total" / "Lift 100 tonnes in total"). */
export function howText(b, units = 'imperial') {
  const p = b.progress;
  if (!p || !p.unit.startsWith('kg')) return b.how;
  const what = p.unit.includes('one workout') ? 'in one workout' : 'in total';
  const n = units === 'metric' ? `${fmtNum(p.goal / 1000)} tonnes` : `${fmtNum(goalDisplay(p.goal, units))} lb`;
  return `Lift ${n} ${what}`;
}

/**
 * What the back of a badge says. `b` is a badge from awardsFor ({ name, how, earned, progress });
 * returns { title, lines: [text], bar: { cur, goal, text } | null, tier, sr } (sr = the whole back as one sentence).
 * bar.cur and bar.goal are in the displayed units.
 */
export function backInfo(b, { tierName = '', units = 'imperial' } = {}) {
  const lines = [howText(b, units)];
  let bar = null;
  const p = b.progress;
  if (b.earned) {
    lines.push(`Earned ${when(b.earned.at)}${p ? ` · ${amount(p.goal, p.unit, units)}` : ''}`);
  } else if (p) {
    const kg = p.unit.startsWith('kg');
    const goal = kg ? goalDisplay(p.goal, units) : p.goal;
    const cur = kg ? Math.min(goal, Math.round(weightToDisplay(p.cur, units))) : p.cur;
    bar = { cur, goal, text: `${fmtNum(cur)} of ${amount(p.goal, p.unit, units)}` };
  } else {
    lines.push('Not earned yet');
  }
  const sr = `${b.name}. ${tierName ? `${tierName} tier. ` : ''}${lines.join('. ')}.${bar ? ` Progress: ${bar.text}.` : ''}`;
  return { title: b.name, lines, bar, tier: tierName, sr };
}

// ---------- the card ----------
/**
 * Wire every `.aw-flip` button under `root`. Each holds `.aw-card` (turns) with `.aw-front` and `.aw-back`.
 * `say(text)` announces the back to VoiceOver when it comes round.
 */
export function wireFlips(root, say = () => {}) {
  for (const btn of root.querySelectorAll('.aw-flip')) wireOne(btn, say);
}

function wireOne(btn, say) {
  const card = btn.querySelector('.aw-card');
  const front = btn.querySelector('.aw-front');
  const back = btn.querySelector('.aw-back');
  let angle = 0; // 0 front, 180 back (in motion: between)
  let raf = 0;

  const paint = (a) => {
    angle = a;
    card.style.setProperty('--rot', `${a}deg`);
  };
  const frontLabel = btn.getAttribute('aria-label');
  const side = (flipped) => {
    const changed = btn.classList.contains('flipped') !== flipped;
    btn.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    btn.classList.toggle('flipped', flipped);
    front.setAttribute('aria-hidden', flipped ? 'true' : 'false');
    back.setAttribute('aria-hidden', flipped ? 'false' : 'true');
    // The button's label overrides its contents, so swap it: VoiceOver re-reads whichever side is up.
    if (frontLabel != null) btn.setAttribute('aria-label', flipped && back.dataset.sr ? back.dataset.sr : frontLabel);
    if (flipped && changed) say(back.dataset.sr || '');
  };

  function animateTo(target) {
    cancelAnimationFrame(raf);
    if (reducedMotion()) {
      haptics.light();
      paint(target);
      side(target === 180);
      return;
    }
    const from = angle;
    if (from === target) { side(target === 180); return; }
    const t0 = performance.now();
    const dur = FLIP_MS * Math.max(0.35, Math.abs(target - from) / 180);
    let last = from;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const a = from + (target - from) * ease.spring(k);
      if (crossedMid(last, a)) haptics.light();
      last = a;
      paint(k >= 1 ? target : Math.max(-8, Math.min(188, a)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    side(target === 180);
    raf = requestAnimationFrame(step);
  }

  const toggle = () => animateTo(btn.classList.contains('flipped') ? 0 : 180);

  let down = null;
  let drag = false;
  let tapped = -1e9; // when a pointer last handled a tap or drag
  btn.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    cancelAnimationFrame(raf);
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, base: angle, t: performance.now(), lastX: e.clientX, lastT: performance.now(), vx: 0, w: btn.getBoundingClientRect().width };
    drag = false;
  });
  btn.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x;
    if (!drag) {
      if (reducedMotion() || Math.abs(dx) < DRAG_START || Math.abs(dx) < Math.abs(e.clientY - down.y)) return;
      drag = true;
      try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      btn.classList.add('dragging');
    }
    const now = performance.now();
    if (now > down.lastT) down.vx = (e.clientX - down.lastX) / (now - down.lastT);
    down.lastX = e.clientX;
    down.lastT = now;
    const a = dragAngle(down.base, dx, down.w);
    if (crossedMid(angle, a)) haptics.light();
    paint(a);
  });
  const end = (e, cancelled) => {
    if (!down || e.pointerId !== down.id) return;
    const wasDrag = drag;
    const d = down;
    down = null;
    drag = false;
    btn.classList.remove('dragging');
    if (wasDrag) {
      const target = cancelled ? (d.base >= 90 ? 180 : 0) : settleAngle(angle, d.vx);
      animateTo(target); // finishes the turn from where the finger left it
      tapped = performance.now(); // the click that follows a drag must not toggle again
    } else if (!cancelled) {
      tapped = performance.now();
      toggle();
    }
  };
  btn.addEventListener('pointerup', (e) => end(e, false));
  btn.addEventListener('pointercancel', (e) => end(e, true));
  // Keyboard, switch control and VoiceOver activate with a click that has no pointer before it.
  btn.addEventListener('click', () => {
    if (performance.now() - tapped < 600) return;
    toggle();
  });
}
